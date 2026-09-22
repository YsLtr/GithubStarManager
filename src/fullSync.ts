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
// 触发：标题行「Sync」按钮（手动，无 token 先弹配置）+ 快照消失 > 12 自动
// （snapshot.handleMissing，60s 冷却）。写放大控制：交集回填 load/save 各一次整表，
// 新增/恢复/确认各自走既有管线（写次数 = 差异数）。
//
// 已知局限：classic token 无 repo scope 时私有仓库的 star 不在列表里 → 会被误判
// unstar（与 P2.5 核对的 404 歧义同源）；fine-grained 选 All repositories 无此问题。

import { STORAGE_KEYS, SYNC_SVG } from './constants';
import { gmGet, gmSet } from './gm';
import { applyExternalUnstar, getGitHubPat, promptForToken, recordVerdict } from './starCheck';
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

/** 分页拉全量；任何不完整信号都抛错（调用方保证不落地半张表） */
async function pullAllStarred(tok: string): Promise<{ items: RemoteStar[]; pages: number; etag: string | undefined }> {
  const items: RemoteStar[] = [];
  let pages = 0;
  let rawSeen = 0;
  let parseMisses = 0;
  let etag: string | undefined;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const resp = await fetch(`https://api.github.com/user/starred?per_page=${PAGE_SIZE}&page=${page}`, {
      headers: {
        Authorization: `Bearer ${tok}`,
        Accept: 'application/vnd.github.star+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    // 首页 ETag 抓一次（后续 probeAndSync 的 If-None-Match 基线）
    if (page === 1) etag = resp.headers.get('etag') ?? undefined;
    if (resp.status === 401) throw new Error('token 无效（401），TM 菜单可重新设置');
    if (resp.status === 403) {
      const retryAfter = resp.headers.get('retry-after');
      throw new Error(
        retryAfter
          ? `触发次级速率限制（retry-after ${retryAfter}s），稍后再试`
          : '403 权限不足（fine-grained 需 Account permissions → Starring → Read + All repositories）'
      );
    }
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const remainingHeader = resp.headers.get('x-ratelimit-remaining');
    const remaining = remainingHeader === null ? NaN : Number(remainingHeader);
    if (Number.isFinite(remaining) && remaining < RATE_FLOOR) {
      throw new Error(`速率余量 ${remaining} < ${RATE_FLOOR}，本次放弃（留量给核对队列）`);
    }

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
  return { items, pages, etag };
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

/** 手动/自动的共同入口；失败返回 null 且不改动任何数据 */
export async function runFullSync(source: 'button' | 'auto'): Promise<SyncSummary | null> {
  if (syncing) return null;
  let tok = getGitHubPat();
  if (!tok && source === 'button') {
    promptForToken();
    tok = getGitHubPat();
  }
  if (!tok) {
    console.log('[github-stars-grid] P4 同步：未配置 token，已取消（TM 菜单 →「⭐ 设置 GitHub Token」）');
    return null;
  }

  syncing = true;
  console.log('[github-stars-grid] ★ P4 全量拉取开始（GET /user/starred，每页 100）…');
  try {
    const { items, pages, etag } = await pullAllStarred(tok);
    const remoteMap = new Map(items.map((it) => [it.repoId, it]));

    // A. 外部 unstar：本地缓存有、远端无 → 整表即权威确认，走既有宽限管线
    const cacheBefore = loadRepoCache();
    let unstarred = 0;
    for (const repoId of Object.keys(cacheBefore)) {
      if (remoteMap.has(repoId)) continue;
      applyExternalUnstar(repoId, cacheBefore[repoId].name || '');
      recordVerdict(repoId, 'unstarred');
      unstarred += 1;
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
    // 写元数据：ETag 快筛基线 + lastFullSyncAt（TTL/isApiData 判定）+ 本地分页总数
    gmSet(STORAGE_KEYS.fullSyncMeta, { etag, lastFullSyncAt: Date.now(), count: items.length });
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
 * ETag 条件快筛 → 变更时整表：
 * - 距上次整表 < 48h 且有 etag → If-None-Match 探首页：304 = 无变化（免额度）直接返回；
 * - 200（有变化）/ 无 etag / 超 TTL → 整表（runFullSync 自己写新 etag）；
 * - 探测 401/403/网络失败 → 跳过本次（权限问题留给手动 Sync 报详细错误）。
 */
async function probeAndSync(): Promise<void> {
  if (syncing) return;
  if (Date.now() - lastProbeAt < PROBE_COOLDOWN_MS) return;
  const tok = getGitHubPat();
  if (!tok) return;
  lastProbeAt = Date.now();

  const meta = gmGet<FullSyncMeta>(STORAGE_KEYS.fullSyncMeta, {});
  const stale = !meta.lastFullSyncAt || Date.now() - meta.lastFullSyncAt > FULL_SYNC_TTL_MS;
  if (meta.etag && !stale) {
    let resp: Response;
    try {
      resp = await fetch(`https://api.github.com/user/starred?per_page=${PAGE_SIZE}&page=1`, {
        headers: {
          Authorization: `Bearer ${tok}`,
          Accept: 'application/vnd.github.star+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'If-None-Match': meta.etag,
        },
      });
    } catch (err) {
      console.log('[github-stars-grid] ETag 探测网络失败，本次跳过:', err instanceof Error ? err.message : err);
      return;
    }
    if (resp.status === 304) {
      console.log('[github-stars-grid] ETag 304：star 列表无变化（免额度快筛）');
      return;
    }
    if (resp.status !== 200) {
      console.log(`[github-stars-grid] ETag 探测 HTTP ${resp.status}，本次跳过`);
      return;
    }
  }

  await runFullSync('auto');
}


/**
 * 标题行同步按钮：插在顶部翻页器左侧（父容器 .gsm-header-row，h2 flex:1
 * 撑开剩余宽度 → 按钮与翻页器一起贴右）。随 transform 完整重建同步。
 * loading 复用 gsm-pager-loading（文字透明占位 + ::before 转圈）。
 */
export function mountSyncButton(row: HTMLElement): void {
  row.querySelector('.gsm-sync-btn')?.remove();
  const pager = row.querySelector('.gsm-top-pager');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'Button Button--secondary Button--medium gsm-sync-btn';
  btn.title = '同步 GitHub 全量 star 列表（P4 整表比对 + 回填 star 时间）';
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
