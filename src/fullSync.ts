// P4 · 全量拉取比对（整表 diff + star 时间回填）。
//
// 数据源：GET /user/starred?per_page=100&page=N，Accept: application/vnd.github.star+json
// → [{ starred_at, repository }]（官方 Starring 文档：该 Accept 才带 starred_at；
//   参考项目同法实现，页间 100ms）。
//
// 权威边界（AGENTS「数据同步设计决策」）：
// - 远端权威 = 星标成员关系、star 时间、仓库元数据（desc/lang/stars/forks/updatedAt）；
// - 本地权威 = 标签与备注（本模块绝不触碰 tags/notes 的写接口）。
//
// 差异三向：
// - 本地有、远端无 → 外部 unstar：整表拉取本身即权威确认（无需逐条双 404），走
//   starCheck 的宽限区管线（缓存→pendingDelete + 标签/备注备份 + 快照清 + 卡片翻转）；
// - 远端有、本地无 → 新 star 建缓存条目；若在 24h 宽限区内则走 markRepoStarred 恢复
//   （标签/备注连同恢复）再合并远端元数据；
// - 交集 → 回填 starredAt（解锁 Sort「Recently starred」，AGENTS D5c）+ 元数据刷新。
//
// 完整性红线：分页中断 / 解析失败 / 超页数上限一律整体放弃（catch 里不改任何数据）——
// 半张表绝不能当整表用，否则未拉到的页会被全部误判成外部 unstar。
//
// 触发：TM 菜单「🔄 立即全量同步」/ 配置横幅「立即同步」/ 标题行 Sync（手动，无 token 先弹配置）+ 进页自动（2s 后，60s 冷却，逐页 ETag 快筛）。
// 「立即同步」各入口；runFullSync 先逐页 If-None-Match 条件快筛（304 不计主限流，全部 304 免额度退出），命中才整表。
// 新增/恢复/确认各自走既有管线（写次数 = 差异数）。
//
// 已知局限：classic token 无 repo scope 时私有仓库的 star 不在列表里 → 会被误判
// unstar（与 P2.5 核对的 404 歧义同源）；fine-grained 选 All repositories 无此问题。

import { STORAGE_KEYS, SYNC_SVG } from './constants';
import { gmGet, gmRegisterMenuCommand, gmSet } from './gm';
import { applyExternalUnstar, getGitHubPat, promptForToken, recordVerdict } from './starCheck';
import { notifyTokenIssue } from './tokenConfig';
import { loadPendingDelete, markRepoStarred } from './storage/pendingDelete';
import { loadRepoCache, saveRepoCache, saveRepoData } from './storage/repoCache';
import type { FullSyncMeta, RepoData, ShiftPendingMap } from './types';
interface RemoteStar {
  repoId: string;
  path: string;
  starredAt?: string;
  meta: Partial<RepoData>;
}

export interface SyncSummary {
  pages: number;
  total: number;
  added: number;
  restored: number;
  unstarred: number;
  backfilled: number;
  shiftCleared: number;
}

const PAGE_SIZE = 100;
const MAX_PAGES = 200;
const PAGE_GAP_MS = 100;
const RATE_FLOOR = 10;
/** ETag 快筛冷却：进页/frame 重渲染风暴下最多 60s 探一次 */
const PROBE_COOLDOWN_MS = 60_000;
/** 整表 TTL 兜底：ETag 只代表首页，中部变化可能长期 304 → 超时强制整表 */
const FULL_SYNC_TTL_MS = 48 * 60 * 60 * 1000;
let syncing = false;
let lastProbeAt = 0;
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** etag 规范化：GitHub 现返回 weak 形式 W/"..."；RFC 7232 §2.3.2 弱比较下与 "..." 等价（curl 原样/去 W/ 双测 + 浏览器 cache:no-store 实测均回 304）。统一剥 W/ → 存储字段干净、发送形式一致。 */
function normEtag(e: string): string {
  return e.startsWith('W/') ? e.slice(2) : e;
}

/** star+json 条目 → 内部结构；防御 repository / repo / 裸 repo 对象三种形态 */
function parseItem(raw: unknown): RemoteStar | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const repo = (item.repository ?? item.repo ?? item) as Record<string, unknown>;
  if (typeof repo.id !== 'number' || typeof repo.full_name !== 'string') return null;

  const meta: Partial<RepoData> = { name: String(repo.full_name) };
  if (typeof repo.description === 'string') meta.desc = repo.description;
  else if (repo.description === null) meta.desc = '';
  if (typeof repo.language === 'string' && repo.language) meta.lang = repo.language;
  if (typeof repo.stargazers_count === 'number') meta.stars = repo.stargazers_count;
  if (typeof repo.forks_count === 'number') meta.forks = repo.forks_count;
  if (typeof repo.updated_at === 'string') meta.updatedAt = repo.updated_at;
  // 展示文本 updated（"Updated 3 days ago"）API 还原不出来 → 省略该键，合并时保留旧值

  return {
    repoId: String(repo.id),
    path: String(repo.full_name),
    starredAt: typeof item.starred_at === 'string' ? item.starred_at : undefined,
    meta,
  };
}

/** 分页拉全量（无条件整表）；任何不完整信号都抛错（调用方保证不落地半张表）。逐页收集 ETag 作快筛基线。 */
async function pullAllStarred(tok: string): Promise<{ items: RemoteStar[]; pages: number; etag: string | undefined; etags: string[] }> {
  const items: RemoteStar[] = [];
  let pages = 0;
  let rawSeen = 0;
  let parseMisses = 0;
  let etag: string | undefined;
  const etags: string[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const resp = await fetch(`https://api.github.com/user/starred?per_page=${PAGE_SIZE}&page=${page}`, {
      cache: 'no-store', // 不读不写浏览器缓存：否则 60s 内的缓存命中/304 合并会让 JS 看到假 200
      headers: {
        Authorization: `Bearer ${tok}`,
        Accept: 'application/vnd.github.star+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (resp.status === 401) {
      notifyTokenIssue('401 Bad credentials：Token 已失效或被撤销');
      throw new Error('token 无效（401），已上报到初始化面板');
    }
    if (resp.status === 403) {
      const retryAfter = resp.headers.get('retry-after');
      const exhausted = resp.headers.get('x-ratelimit-remaining') === '0';
      if (!retryAfter && !exhausted) {
        // 排除限速后的 403 才是权限问题：上报初始化面板（官方 troubleshooting 判定）
        notifyTokenIssue('403 权限不足：fine-grained 需 Account permissions → Starring → Write + All repositories');
      }
      throw new Error(
        retryAfter
          ? `触发次级速率限制（retry-after ${retryAfter}s），稍后再试`
          : exhausted
            ? '主速率限制已用尽，稍后再试'
            : '403 权限不足（fine-grained 需 Starring → Write）'
      );
    }
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const remainingHeader = resp.headers.get('x-ratelimit-remaining');
    const remaining = remainingHeader === null ? NaN : Number(remainingHeader);
    if (Number.isFinite(remaining) && remaining < RATE_FLOOR) {
      throw new Error(`速率余量 ${remaining} < ${RATE_FLOOR}，本次放弃（留量给核对队列）`);
    }

    // 收集每页 ETag（4.0.4 逐页快筛基线）；首页另存 etag 兼容旧字段
    const pageEtag = normEtag(resp.headers.get('etag') || ''); // 4.0.5 剥 W/ weak前缀，存强校验规范形
    if (page === 1) etag = pageEtag || undefined;
    etags.push(pageEtag);
    const body: unknown = await resp.json();
    if (!Array.isArray(body)) throw new Error('响应不是数组（Accept 头未生效？）');
    pages += 1;
    rawSeen += body.length;
    if (body.length === 0) break;

    for (const raw of body) {
      const parsed = parseItem(raw);
      if (parsed) items.push(parsed);
      else parseMisses += 1;
    }
    if (parseMisses > 0) {
      throw new Error(`${parseMisses}/${rawSeen} 条解析失败（响应形态不符），整体放弃`);
    }
    if (body.length < PAGE_SIZE) break;
    if (page >= MAX_PAGES) throw new Error(`超过 ${MAX_PAGES} 页上限，结果不完整，整体放弃`);
    await sleep(PAGE_GAP_MS);
  }

  if (rawSeen > 0 && items.length === 0) {
    throw new Error(`拉到 ${rawSeen} 条但解析为 0（响应形态不符），整体放弃`);
  }
  return { items, pages, etag, etags };
}

/** 仍 star 的位移挂起直接结案（成员关系已被整表证实；unstar 的由宽限管线清） */
function clearShiftPendingForStarred(starredIds: Set<string>): number {
  const pending = gmGet<ShiftPendingMap>(STORAGE_KEYS.shiftPending, {});
  let n = 0;
  for (const id of Object.keys(pending)) {
    if (starredIds.has(id)) {
      delete pending[id];
      n += 1;
    }
  }
  if (n > 0) gmSet(STORAGE_KEYS.shiftPending, pending);
  return n;
}

/** starred 列表第 page 页 URL */
function pageUrl(page: number): string {
  return `https://api.github.com/user/starred?per_page=${PAGE_SIZE}&page=${page}`;
}


/** 快筛判定：unchanged=逐页全 304（无变化免额度）；changed-byte=任一页 200 字节已变（可能仅元数据抖动）→ 整表比对确认；
 *  changed=结构性变化（尾页变长/基线缺失/超 48h TTL）；error=网络/鉴权问题本次跳过 */
type QuickVerdict = 'unchanged' | 'changed' | 'changed-byte' | 'error';

/**
 * 逐页 ETag 条件快筛（4.0.4，修「首页 304 就跳过、中部变化漏检」）：
 * - 每页各带自己的 If-None-Match（官方每页独立 ETag；304 不计主限流）；全部 304 才算无变化；
 * - 任一页 200 = 有变化即停（位移会让后续页全部失效，不浪费请求）→ 调用方整表；
 * - 基线之外再无条件探一页：有条目 = 总数变长（新增落点不可预设）仍判有变化；
 * - 基线缺失/含空值、超 48h TTL → 直接 changed（整表重建基线）；
 * - 401 / 403（非限速）→ notifyTokenIssue 上报初始化面板（常驻填 token 框），返回 error。
 */
async function quickCheck(tok: string, meta: FullSyncMeta): Promise<QuickVerdict> {
  if (!meta.lastFullSyncAt || Date.now() - meta.lastFullSyncAt > FULL_SYNC_TTL_MS) {
    console.log(`[github-stars-grid] ETag 快筛跳过（${meta.lastFullSyncAt ? '超 48h TTL' : '无基线'}）→ 整表同步`);
    return 'changed';
  }
  const etags = meta.etags?.map(normEtag); // 存量 W/ 前缀读取时统一剥掉（弱比较等价，实测 304）
  if (!etags || etags.length === 0 || etags.some((e) => !e)) {
    console.log('[github-stars-grid] ETag 快筛：无逐页基线（旧版单 etag 或缺数据）→ 整表重建基线');
    return 'changed';
  }
  for (let i = 0; i < etags.length; i++) {
    let resp: Response;
    try {
      resp = await fetch(pageUrl(i + 1), {
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${tok}`,
          Accept: 'application/vnd.github.star+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'If-None-Match': etags[i],
        },
      });
    } catch (err) {
      console.log('[github-stars-grid] ETag 快筛网络失败，本次跳过:', err instanceof Error ? err.message : err);
      return 'error';
    }
    if (resp.status === 200) {
      console.log(`[github-stars-grid] ETag 快筛：第 ${i + 1} 页 200 → 字节已变（可能只是仓库元数据抖动，非收藏变动）→ 整表比对确认`);
      return 'changed-byte';
    }
    if (resp.status !== 304) {
      reportAuthIssue(resp);
      console.log(`[github-stars-grid] ETag 快筛 HTTP ${resp.status}，本次跳过`);
      return 'error';
    }
    if (i < etags.length - 1) await sleep(PAGE_GAP_MS);
  }
  // 尾页之外再探一页（无条件）：有条目 = 总数变长，仍判有变化
  try {
    const extra = await fetch(pageUrl(etags.length + 1), {
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${tok}`,
        Accept: 'application/vnd.github.star+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (extra.status !== 200) {
      reportAuthIssue(extra);
      console.log(`[github-stars-grid] ETag 快筛尾页 HTTP ${extra.status}，本次跳过`);
      return 'error';
    }
    const tail: unknown = await extra.json();
    if (Array.isArray(tail) && tail.length > 0) {
      console.log(`[github-stars-grid] ETag 快筛：尾页之外还有 ${tail.length} 条 → 列表变长，整表同步`);
      return 'changed';
    }
  } catch (err) {
    console.log('[github-stars-grid] ETag 快筛尾页探测失败，本次跳过:', err instanceof Error ? err.message : err);
    return 'error';
  }
  return 'unchanged';
}

/** 鉴权失败统一上报：401 与非限速 403 → 初始化面板（常驻填 token 框）；限速类只由上层日志 */
function reportAuthIssue(resp: Response): void {
  if (resp.status === 401) {
    notifyTokenIssue('401 Bad credentials：Token 已失效或被撤销');
  } else if (resp.status === 403) {
    const retryAfter = resp.headers.get('retry-after');
    const exhausted = resp.headers.get('x-ratelimit-remaining') === '0';
    if (!retryAfter && !exhausted) {
      notifyTokenIssue('403 权限不足：fine-grained 需 Account permissions → Starring → Write + All repositories');
    }
  }
}

/** 手动/自动的共同入口；失败返回 null 且不改动任何数据 */
export async function runFullSync(source: 'button' | 'auto'): Promise<SyncSummary | null> {
  if (syncing) return null;
  let tok = getGitHubPat();
  if (!tok && source === 'button') {
    promptForToken(false); // 自动触发场景不弹重复 prompt；保存成功后的同步由 savedHandler 接管
    tok = getGitHubPat();
  }
  if (!tok) {
    console.log('[github-stars-grid] P4 同步：未配置 token，已取消（TM 菜单 →「⭐ 设置 GitHub Token」）');
    return null;
  }

  syncing = true;
  try {
    // 条件快筛（4.0.4）：逐页 If-None-Match（每页独立 ETag），全部 304 才算无变化；
    // 任一页 200 / 基线缺失或不完整 / 超 48h TTL → 整表。快筛中的 401/403（非限速）上报初始化面板。
    const storedMeta = gmGet<FullSyncMeta>(STORAGE_KEYS.fullSyncMeta, {});
    const verdict = await quickCheck(tok, storedMeta);
    if (verdict === 'unchanged') {
      console.log(`[github-stars-grid] ETag 304：${(storedMeta.etags ?? []).length} 页全部无变化（免额度），跳过整表比对`);
      // 修 304/200 交替：校验值发出去的就是服务端验证过的值，绝不从 304 响应头回读覆盖；
      const healedEt = storedMeta.etags?.map(normEtag);
      gmSet(STORAGE_KEYS.fullSyncMeta, {
        ...storedMeta,
        ...(healedEt ? { etags: healedEt } : {}),
        lastFullSyncAt: Date.now(),
      });
      return { pages: 0, total: storedMeta.count ?? 0, added: 0, restored: 0, unstarred: 0, backfilled: 0, shiftCleared: 0 };
    }
    if (verdict === 'error') return null;
    console.log('[github-stars-grid] ★ P4 全量拉取开始（GET /user/starred，每页 100）…');
    const { items, pages, etag, etags } = await pullAllStarred(tok);
    const remoteMap = new Map(items.map((it) => [it.repoId, it]));

    // A. 外部 unstar：本地缓存有、远端无 → 整表即权威确认，走既有宽限管线
    const cacheBefore = loadRepoCache();
    let unstarred = 0;
    for (const repoId of Object.keys(cacheBefore)) {
      if (remoteMap.has(repoId)) continue;
      if (applyExternalUnstar(repoId, cacheBefore[repoId].name || '')) {
        recordVerdict(repoId, 'unstarred');
        unstarred += 1;
      }
    }

    // B. 远端有、本地无：宽限区内 = re-star 恢复；否则 = 新 star 建条目
    const pending = loadPendingDelete();
    let restored = 0;
    let added = 0;
    for (const it of remoteMap.values()) {
      if (cacheBefore[it.repoId]) continue; // 交集 → C
      const patch: Partial<RepoData> = { ...it.meta };
      if (it.starredAt) patch.starredAt = it.starredAt;
      if (pending[it.repoId]) {
        markRepoStarred(it.repoId);
        saveRepoData(it.repoId, patch);
        restored += 1;
      } else {
        saveRepoData(it.repoId, patch);
        added += 1;
      }
    }

    // C. 交集：回填 star 时间 + 元数据刷新（一次写盘）
    const cache = loadRepoCache();
    let backfilled = 0;
    let refreshed = 0;
    for (const it of remoteMap.values()) {
      const entry = cache[it.repoId];
      if (!entry) continue;
      if (it.starredAt && entry.starredAt !== it.starredAt) {
        entry.starredAt = it.starredAt;
        backfilled += 1;
      }
      const m = it.meta;
      let metaChanged = false;
      if (m.desc !== undefined && entry.desc !== m.desc) { entry.desc = m.desc; metaChanged = true; }
      if (m.lang !== undefined && entry.lang !== m.lang) { entry.lang = m.lang; metaChanged = true; }
      if (m.stars !== undefined && entry.stars !== m.stars) { entry.stars = m.stars; metaChanged = true; }
      if (m.forks !== undefined && entry.forks !== m.forks) { entry.forks = m.forks; metaChanged = true; }
      if (m.updatedAt !== undefined && entry.updatedAt !== m.updatedAt) { entry.updatedAt = m.updatedAt; metaChanged = true; }
      if (metaChanged) refreshed += 1;
    }
    saveRepoCache(cache);

    // D. 位移挂起结算（远端仍 star 的直接清）
    const shiftCleared = clearShiftPendingForStarred(new Set(remoteMap.keys()));

    const summary: SyncSummary = {
      pages,
      total: items.length,
      added,
      restored,
      unstarred,
      backfilled,
      shiftCleared,
    };
    console.log(
      `[github-stars-grid] ★ P4 全量同步完成：${summary.total} 个 star / ${pages} 页 — 新增 ${added}、` +
        `恢复 ${restored}、外部 unstar ${unstarred}、回填 star 时间 ${backfilled}、` +
        `元数据刷新 ${refreshed}、位移挂起结算 ${shiftCleared}`
    );
    document.querySelector('.gsm-setup-banner')?.remove(); // 同步成功即撤配置横幅（缓存已就绪）
    // 写元数据（4.0.5）：逐页 ETag 基线（剥 W/ 规范形）+ 首页 etag（兼容旧字段）+ lastFullSyncAt（TTL/isApiData）+ 总数；
    const outMeta: FullSyncMeta = { etag, etags, lastFullSyncAt: Date.now(), count: items.length };
    gmSet(STORAGE_KEYS.fullSyncMeta, outMeta);
    const noEtag = etags.filter((e) => !e).length;
    console.log(`[github-stars-grid] ETag 基线：${etags.length} 页已保存${noEtag ? `（${noEtag} 页响应缺 ETag 头，下次快筛直接整表）` : '（下次快筛逐页 304 免额度）'}`);
    return summary;
  } catch (err) {
    console.error(
      '[github-stars-grid] ★ P4 全量同步失败（未改动任何数据）：',
      err instanceof Error ? err.message : err
    );
    return null;
  } finally {
    syncing = false;
  }
}

/** TM 菜单手动同步入口（4.0.4：横幅「立即同步」与标题行 Sync 按钮同时恢复，三处等价） */
export function registerSyncMenu(): void {
  gmRegisterMenuCommand('🔄 立即全量同步（GitHub API）', () => {
    void runFullSync('button');
  });
}

/** 标题行 Sync 按钮（4.0.4 恢复）：贴在顶部翻页器左侧，点击 → runFullSync('button') */
export function mountSyncButton(row: HTMLElement): void {
  row.querySelector('.gsm-sync-btn')?.remove();
  const pager = row.querySelector('.gsm-top-pager');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'Button Button--secondary Button--medium gsm-sync-btn';
  btn.title = '同步 GitHub 全量 star 列表（逐页 ETag 快筛 + 整表比对 + 回填 star 时间）';
  btn.innerHTML = SYNC_SVG + ' Sync';
  btn.addEventListener('click', () => {
    void syncFromButton(btn);
  });

  if (pager) row.insertBefore(btn, pager);
  else row.appendChild(btn);
}

async function syncFromButton(btn: HTMLButtonElement): Promise<void> {
  if (syncing || btn.classList.contains('gsm-pager-loading')) return;
  btn.classList.add('gsm-pager-loading');
  btn.setAttribute('aria-busy', 'true');
  try {
    const sum = await runFullSync('button');
    if (sum) {
      btn.title =
        `上次同步：${sum.total} 个 star / ${sum.pages} 页 — 新增 ${sum.added}、恢复 ${sum.restored}、` +
        `外部 unstar ${sum.unstarred}、回填 star 时间 ${sum.backfilled}`;
    }
  } finally {
    btn.classList.remove('gsm-pager-loading');
    btn.removeAttribute('aria-busy');
  }
}

/** API 数据就绪 = 至少完整整表过一次（全量缓存可渲染 = API 主模式前提） */
export function hasApiData(): boolean {
  const meta = gmGet<FullSyncMeta>(STORAGE_KEYS.fullSyncMeta, {});
  return !!meta.lastFullSyncAt && (meta.count ?? 0) > 0;
}

/** 进页自动同步（transform 成功后触发）：延迟 2s 让首屏渲染先完成 */
export function scheduleProbeSync(): void {
  window.setTimeout(() => {
    void probeAndSync();
  }, 2000);
}

/**
 * 进页自动同步（transform 成功后触发）：60s 冷却后走统一 runFullSync('auto')——
 * 内部逐页条件快筛（全部 304 零开销退出），401/403（非限速）自动上报初始化面板。
 */
async function probeAndSync(): Promise<void> {
  if (syncing) return;
  if (Date.now() - lastProbeAt < PROBE_COOLDOWN_MS) return;
  if (!getGitHubPat()) return;
  lastProbeAt = Date.now();
  await runFullSync('auto');
}


