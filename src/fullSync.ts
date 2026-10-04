// P4 · 全量拉取比对（整表 diff + star 时间回填）。
//
// 数据源：GET /user/starred?per_page=100&page=N，Accept: application/vnd.github.star+json
// → [{ starred_at, repository }]（官方 Starring 文档：该 Accept 才带 starred_at；
//   4.0.8 起单遍扫描 scanStarred：波次条件请求一把梭——200 页收正文、304 页用本地切片复用缓存
//   （官方默认序 sort=created&direction=desc 已显式钉死；请求 URL 带参数会换 ETag 表示，升级后首扫全 200 重建基线属预期）。
//
// 权威边界（AGENTS「数据同步设计决策」）：
// - 远端权威 = 星标成员关系、star 时间、仓库元数据（desc/lang/stars/forks/updatedAt=pushed_at）；
// - 本地权威 = 标签与备注（本模块绝不触碰 tags/notes 的写接口）。
//
// 差异三向：
// - 本地有、远端无 → 外部 unstar：全正文模式整表即权威（直接走 starCheck 宽限区管线：缓存→pendingDelete +
//   标签/备注备份 + 快照清 + 卡片翻转）；切片混合模式 local-only 嫌疑先逐条 GET /user/starred/{o}/{r} 双态核对
//   （204=仍 star=切片平局误报保留 / 404=真取关），防同秒 starred_at 跨页互换造成假取关；
// - 远端有、本地无 → 新 star 建缓存条目；若在 24h 宽限区内则走 markRepoStarred 恢复
//   （标签/备注连同恢复）再合并远端元数据；
// - 交集 → 回填 starredAt（解锁 Sort「Recently starred」，AGENTS D5c）+ 元数据刷新。
//
// 完整性红线：分页中断 / 解析失败 / 超页数上限一律整体放弃（catch 里不改任何数据）——
// 半张表绝不能当整表用，否则未拉到的页会被全部误判成外部 unstar。
//
// 触发：TM 菜单「🔄 立即全量同步」/ 标题行 Sync（手动，无 token 先弹配置）+ 进页自动（2s 后，60s 冷却，逐页 ETag 快筛）。
// runFullSync 单遍扫描（4.0.8 合并原 quickCheck+pullAllStarred）：逐页 If-None-Match 一把梭，
// 全 304 免额度早退；200 页收正文、304 页用本地切片（缓存 starred_at 降序复算）组装，无基线/超 TTL/阀门失守回落无条件整表。
// 新增/恢复/确认各自走既有管线（写次数 = 差异数）。
//
// 已知局限：classic token 无 repo scope 时私有仓库的 star 不在列表里 → 会被误判
// unstar（与 P2.5 核对的 404 歧义同源）；fine-grained 选 All repositories 无此问题。

import { STORAGE_KEYS, SYNC_SVG } from './constants';
import { gmGet, gmRegisterMenuCommand, gmSet } from './gm';
import { applyExternalUnstar, getGitHubPat } from './starCheck';
import { applyFilters } from './filters';
import { notifyTokenIssue } from './tokenConfig';
import { pushRestoreNotice } from './restore';
import { loadPendingDelete, markRepoStarred } from './storage/pendingDelete';
import { pushNotice } from './ui/notifications';
import { hasApiData, loadRepoCache, saveRepoCache, saveRepoData } from './storage/repoCache';
import type { FullSyncMeta, RepoCache, RepoData } from './types';
import { currentGeneration, ifCurrent } from './lifecycle';
import { isDesktop } from './utils';
import { mountAccountGuard } from './ui/accountBanner';

interface RemoteStar {
  repoId: string;
  path: string;
  starredAt?: string;
  meta: Partial<RepoData>;
}

/** 一次全量同步的产出摘要（按钮 title 与简报都用它；只在模块内流转） */
interface SyncSummary {
  pages: number;
  total: number;
  added: number;
  restored: number;
  unstarred: number;
  backfilled: number;
}

const PAGE_SIZE = 100;
const MAX_PAGES = 200;
const WAVE_CONCURRENCY = 6; // 波内并发数（官方容忍区间 4-6 取上限：基线 N 页 + 尾页恰好 6 个一波到齐，quiet 扫描单 RTT）
const WAVE_GAP_MS = 1000; // 相邻发波最小间隔（官方建议：并发请求之间至少留 1s）
const RATE_FLOOR = 10;
/** ETag 快筛冷却：进页/frame 重渲染风暴下最多 60s 探一次 */
const PROBE_COOLDOWN_MS = 60_000;
/** 整表 TTL 兜底：ETag 只代表首页，中部变化可能长期 304 → 超时强制整表 */
const FULL_SYNC_TTL_MS = 48 * 60 * 60 * 1000;
let syncing = false;
let lastProbeAt = 0;

/* ================================================================
 * 同步状态（4.10.0）：**模块内单一真相**，头部 Sync 按钮是它唯一的视图。
 *
 * 为什么要有这一层：4.10.0 之前，只有一个入口（标题行按钮）会给自己加
 * `.gsm-pager-loading`，其余三个入口（TM 菜单 / Token 保存后的自动同步 / 进页自动
 * 探测）触发时页面上没有任何反馈 —— 用户看到的就是
 * 「点了没反应，但它其实在跑」。现在改成：`runFullSync` 只负责推进状态并广播，
 * 任何入口触发的同步都会让同一个按钮把它显示出来；旧代码里那套
 * 「整按钮文字变透明 + 伪元素转圈」的写入方式随之删除（4.10.0）。
 * ================================================================ */
type SyncPhase = 'idle' | 'running' | 'failed';

interface SyncState {
  phase: SyncPhase;
  /** phase === 'failed' 的用户可见原因（复用既有失败分类文案，不新造词） */
  reason?: string;
  /** 上一次**成功**同步的摘要，供按钮 title 长期展示 */
  lastSummary?: SyncSummary;
}

type SyncStateListener = (state: SyncState) => void;

let syncState: SyncState = { phase: 'idle' };
const syncStateListeners = new Set<SyncStateListener>();
let lastSyncSummary: SyncSummary | undefined;

/** 当前同步状态的**快照**（按钮挂载时用它做「挂载即对齐」，不必等下一次广播） */
function getSyncState(): SyncState {
  // 返回副本：调用方拿到的是值而不是模块内可变对象，就地改写不会绕过 setSyncState 的广播
  return { ...syncState };
}

/** 订阅同步状态；返回取消订阅函数（teardown 必须显式调用，不能只靠节点被删） */
function subscribeSyncState(listener: SyncStateListener): () => void {
  syncStateListeners.add(listener);
  return () => {
    syncStateListeners.delete(listener);
  };
}

function setSyncState(next: SyncState): void {
  syncState = next;
  // 遍历副本：订阅者在回调里退订/新增订阅不能影响本轮广播
  for (const listener of [...syncStateListeners]) {
    try {
      listener(syncState);
    } catch (err) {
      console.error('[github-star-manager] 同步状态订阅者抛错（已隔离，不影响同步）：', err);
    }
  }
}
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
  // 4.8.0：取 pushed_at（最后 push 到任一分支）而非 updated_at（仓库对象元数据变更）。
  // 「Recently active」必须按 pushed_at 排：GitHub 官方 OpenAPI sort-starred 原文
  // 「`updated` means when the repository was last pushed to」；用 updated_at 会把
  // 「改过描述/被标星但代码停更」的仓库顶到最前。pushed_at 可为 null（空仓库）→ 留空沉底。
  if (typeof repo.pushed_at === 'string') meta.updatedAt = repo.pushed_at;
  // Type 筛选四标志（4.2.0）：REST repo 对象恒有 private/fork/is_template/mirror_url，逐项校验后写入
  if (typeof repo.private === 'boolean') meta.private = repo.private;
  if (typeof repo.fork === 'boolean') meta.fork = repo.fork;
  if (typeof repo.is_template === 'boolean') meta.isTemplate = repo.is_template;
  if ('mirror_url' in repo) meta.mirror = repo.mirror_url != null;
  // 展示文本不再落盘（4.8.0 删 updated 字段）：卡片渲染时由 formatRelative(updatedAt) 现算

  return {
    repoId: String(repo.id),
    path: String(repo.full_name),
    starredAt: typeof item.starred_at === 'string' ? item.starred_at : undefined,
    meta,
  };
}

/**
 * starred 列表 Link 头 → 总页数。
 * - 无 Link 头 = 单页列表 → 1；
 * - 有 Link 头却解析不到 rel="last" → null（调用方必须当错误抛掉，绝不猜页数）。
 * 4.0.10 审查修复（🔴）：GitHub 按请求参数顺序回显 Link（URL 尾是 &sort=…&direction=desc>），
 * 旧正则 /page=(\d+)>;\s*rel="last"/ 恒失配 → 调用方 ?? 1 把整表当 1 页 → 未拉到的页
 * 全被误判成外部 unstar → 标签/备注 24h 宽限后永久删除。现改为定位 rel="last" 的整段
 * 再抽 page 参数（[?&] 前缀防 per_page 误匹配），参数顺序无关。
 */
function parseTotalPages(link: string | null): number | null {
  if (!link) return 1;
  const m = link.match(/<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="last"/);
  if (m) return Number(m[1]);
  // Link 有 next 却无 last = 头部形态异常：页数不可知，交给红线抛错；无 next 的零散头视为单页
  return link.includes('rel="next"') ? null : 1;
}

interface PageFetch {
  page: number;
  etag: string;
  link: string | null;
  body: unknown[];
  /** 304 条件命中：无 body；etag 字段无意义（绝不回读，4.0.4 交替坑），调用方沿用旧基线 */
  notModified?: boolean;
}

/** starred API 统一请求头（If-None-Match 可选：条件快筛用） */
function apiHeaders(tok: string, ifNoneMatch?: string): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${tok}`,
    Accept: 'application/vnd.github.star+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (ifNoneMatch) h['If-None-Match'] = ifNoneMatch;
  return h;
}

/** 401/403 → 人话（限速类附退避提示）；上报统一走 reportAuthIssue（文案单一来源） */
function authIssueMessage(resp: Response): string {
  const retryAfter = resp.headers.get('retry-after');
  const exhausted = resp.headers.get('x-ratelimit-remaining') === '0';
  if (resp.status === 401) return 'token 无效（401），已上报到初始化面板';
  if (resp.status === 403) {
    if (retryAfter) return `触发次级速率限制（retry-after ${retryAfter}s），稍后再试`;
    if (exhausted) return '主速率限制已用尽，稍后再试';
    // 403 的文案不得让用户去「检查 Starring 权限」——fine-grained PAT 先天写不了他人公开仓库，
    // 那是无解方向（ADR 0004）；写路径已由网页端点静默接管（ADR 0006），故只描述结果。
    return '403 权限不足（Token 不能访问该资源）';
  }
  return `HTTP ${resp.status}`;
}

/** 拉取单页（条件可选：命中 304 → notModified；401/403/非 2xx/速率余量/非数组一律抛错——调用方保证不落地半张表） */
async function fetchStarredPage(tok: string, page: number, signal: AbortSignal, ifNoneMatch?: string): Promise<PageFetch> {
  const resp = await fetch(pageUrl(page), {
    cache: 'no-store', // 不读不写浏览器缓存：否则 60s 内的缓存命中/304 合并会让 JS 看到假 200
    signal,
    headers: apiHeaders(tok, ifNoneMatch),
  });
  if (resp.status === 304) {
    // 条件命中：无 body；etag 绝不从 304 响应回读（4.0.4 交替坑），调用方沿用旧基线
    return { page, etag: '', link: null, body: [], notModified: true };
  }
  if (resp.status === 401 || resp.status === 403) {
    reportAuthIssue(resp);
    throw new Error(authIssueMessage(resp));
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

  const remainingHeader = resp.headers.get('x-ratelimit-remaining');
  const remaining = remainingHeader === null ? NaN : Number(remainingHeader);
  if (Number.isFinite(remaining) && remaining < RATE_FLOOR) {
    throw new Error(`速率余量 ${remaining} < ${RATE_FLOOR}，本次放弃（须为逐条核对留出余量）`);
  }

  const body: unknown = await resp.json();
  if (!Array.isArray(body)) throw new Error('响应不是数组（Accept 头未生效？）');
  return {
    page,
    etag: normEtag(resp.headers.get('etag') || ''), // 4.0.5 剥 W/ weak 前缀，存强校验规范形
    link: resp.headers.get('link'),
    body,
  };
}

/** 并发拒绝中取真实根因（我们主动 abort 产生的 AbortError 不能顶掉真正的错误） */
function pickRealError(reasons: unknown[]): unknown {
  return reasons.find((e) => !(e instanceof Error && e.name === 'AbortError')) ?? reasons[0];
}

/**
 * 波次并发执行器（4.0.7，用户令「实现并行」）：按 WAVE_CONCURRENCY 分波发射，
 * 发波间隔 ≥ WAVE_GAP_MS（GitHub 次级限流官方建议并发请求间至少留 1s；慢网下
 * 每波自身耗时自然拉大间隔，快网下靠 sleep 补足整 1s）。
 * 任一任务失败 → 中止在途请求（AbortController）并停止后续波，真实错误原样上抛；
 * 信号被外部主动中止（快筛已定论）同样停止后续波，不算错误。
 */
async function runWaves(
  pagesRange: number[],
  ctrl: AbortController,
  worker: (page: number) => Promise<void>,
): Promise<void> {
  let firstErr: unknown = null;
  for (let i = 0; i < pagesRange.length; i += WAVE_CONCURRENCY) {
    if (firstErr !== null || ctrl.signal.aborted) break;
    const waveStart = Date.now();
    const settled = await Promise.allSettled(
      pagesRange.slice(i, i + WAVE_CONCURRENCY).map((p) => worker(p)),
    );
    const reasons = settled
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => r.reason);
    if (reasons.length > 0) {
      firstErr = pickRealError(reasons);
      ctrl.abort();
      break;
    }
    if (ctrl.signal.aborted) break; // 已定论（快筛）：不等待也不发下一波
    const remain = WAVE_GAP_MS - (Date.now() - waveStart);
    if (remain > 0 && i + WAVE_CONCURRENCY < pagesRange.length) await sleep(remain);
  }
  if (firstErr !== null) throw firstErr;
}

/** 单遍扫描结果（4.0.8）：unchanged=全 304 免额度早退；synced=条目已就绪（正文页权威 + 304 页本地切片） */
interface ScanUnchanged {
  kind: 'unchanged';
  /** 应持久化的尾页越界 ETag：有值=写入；缺省=沿用存储值（unchanged 场景尾页不会转正） */
  nextTailEtag?: string;
}
interface ScanSynced {
  kind: 'synced';
  items: RemoteStar[];
  pages: number;
  etags: string[];
  /** true=304 页用了本地切片（local-only 嫌疑须逐条 API 核对后才判外部 unstar）；false=全正文权威 */
  hybrid: boolean;
  /** 来自正文响应的条目 id（交集元数据刷新只对这些做；切片条目缓存即现值） */
  freshIds: Set<string>;
  bodyPages: number;
  slicePages: number;
  /** 应持久化的尾页越界 ETag：有值=写入（304 沿用 / 200 空刷新）；缺省=清空（尾页转正或整表兜底） */
  nextTailEtag?: string;
}
type ScanOutcome = ScanUnchanged | ScanSynced;

/**
 * 本地切片：缓存全集按 starred_at 降序（与 API 显式排序 sort=created&direction=desc 同序）每 PAGE_SIZE 切一页。
 * 304 页的内容=上次同步=缓存切片，无须重拉；缓存任一条目缺 star 时间 → 切片不可信，返回 null 走整表兜底。
 * 同秒 starred_at 平局的跨页互换不追求逐条对位，由 runFullSync 的逐条核对兜底。
 */
function buildLocalSlices(cache: RepoCache): RemoteStar[][] | null {
  const entries = Object.entries(cache);
  if (entries.length === 0) return null;
  for (const [, e] of entries) {
    if (!e.starredAt) return null; // 阀门 A：缺 star 时间 → 排序模型失效
  }
  const sorted = entries
    .map(([repoId, e]) => ({ repoId, e }))
    .sort((a, b) => (a.e.starredAt! < b.e.starredAt! ? 1 : -1)); // ISO 串直接比较，降序
  const slices: RemoteStar[][] = [];
  for (let i = 0; i < sorted.length; i += PAGE_SIZE) {
    slices.push(
      sorted.slice(i, i + PAGE_SIZE).map(({ repoId, e }) => ({
        repoId,
        path: e.name || '',
        starredAt: e.starredAt,
        meta: { name: e.name, desc: e.desc, lang: e.lang, stars: e.stars, forks: e.forks, updatedAt: e.updatedAt, private: e.private, fork: e.fork, isTemplate: e.isTemplate, mirror: e.mirror },
      })),
    );
  }
  return slices;
}

/**
 * 单条核对：GET /user/starred/{owner}/{repo} → false=仍 star（204，切片误报）/ true=已取关（404）/ null=不可判定。
 * 仅切片混合模式的 local-only 嫌疑用（每条 1 点额度）；全正文模式整表即权威，不走这里。
 */
async function checkStarredGone(tok: string, path: string): Promise<boolean | null> {
  if (!path || !path.includes('/')) return null;
  try {
    const resp = await fetch(`https://api.github.com/user/starred/${path}`, {
      cache: 'no-store',
      headers: apiHeaders(tok),
    });
    if (resp.status === 204) return false;
    if (resp.status === 404) return true;
    if (resp.status === 401 || resp.status === 403) reportAuthIssue(resp);
    return null;
  } catch {
    return null;
  }
}

/**
 * 无条件整表兜底（无基线 / 超 48h TTL / 切片阀门失守共用）：第 1 页先行拿 Link 头预知总页 →
 * 页 2..N 波次并发 → 按页序组装校验；任何不完整信号都抛错（红线：不落地半张表）。
 */
async function pullAllUnconditional(tok: string): Promise<{ items: RemoteStar[]; pages: number; etags: string[] }> {
  const ctrl = new AbortController();
  const first = await fetchStarredPage(tok, 1, ctrl.signal);
  if (first.notModified) throw new Error('无条件拉取收到 304（不应发生）');
  const totalPages = parseTotalPages(first.link);
  if (totalPages === null) {
    // 红线：页数不可知绝不能猜（4.0.10 修 ?? 1 → 1 页误判 → 假外部取关批量删数据的定时雷）
    throw new Error('Link 头含 rel="next" 却解析不到 rel="last"（总页数不可知），整体放弃');
  }
  if (totalPages > MAX_PAGES) {
    throw new Error(`超过 ${MAX_PAGES} 页上限（Link 预知 ${totalPages} 页），结果不完整，整体放弃`);
  }
  const results = new Array<PageFetch | undefined>(totalPages + 1);
  results[1] = first;
  if (totalPages > 1) {
    const rest: number[] = [];
    for (let p = 2; p <= totalPages; p++) rest.push(p);
    await runWaves(rest, ctrl, async (page) => {
      results[page] = await fetchStarredPage(tok, page, ctrl.signal);
    });
  }
  const items: RemoteStar[] = [];
  const etags: string[] = [];
  let rawSeen = 0;
  for (let p = 1; p <= totalPages; p++) {
    const r = results[p];
    if (!r || r.notModified) throw new Error(`第 ${p} 页未取回（并发中断），整体放弃`);
    etags.push(r.etag);
    rawSeen += r.body.length;
    for (const raw of r.body) {
      const it = parseItem(raw);
      if (!it) throw new Error(`第 ${p} 页有解析失败条目（响应形态不符），整体放弃`);
      items.push(it);
    }
  }
  if (rawSeen > 0 && items.length === 0) {
    throw new Error(`拉到 ${rawSeen} 条但解析为 0（响应形态不符），整体放弃`);
  }
  return { items, pages: totalPages, etags };
}

/** 无条件兜底结果打包（hybrid=false：全正文权威，local-only 不需核对） */
async function fullPullOutcome(tok: string): Promise<ScanOutcome> {
  const full = await pullAllUnconditional(tok);
  return {
    kind: 'synced',
    items: full.items,
    pages: full.pages,
    etags: full.etags,
    hybrid: false,
    freshIds: new Set(full.items.map((it) => it.repoId)),
    bodyPages: full.pages,
    slicePages: 0,
  };
}


/**
 * 单遍扫描（4.0.8，合并原 quickCheck + pullAllStarred，用户定「无须两个函数」）：
 * - 有基线（≤48h TTL、逐页 etags 完整）→ 波次条件扫 1..N+1 页（尾页带 tailEtag 条件探增长，304=仍空免额度）：
 *   全 304 且尾页空 → unchanged 免额度早退；否则 200 页收正文、304 页用本地切片组装（不重拉）；
 * - 无基线 / 超 TTL / 切片阀门失守（缓存缺 starred_at、切片盖不住、正文与切片重叠 <50%、尾页满页疑增长超一页）
 *   → 回落无条件整表（Link 预知总页）；
 * - 红线不变：缺页 / 解析失败 / 超页上限 → 抛错，一个字节不落地。
 * 切片合法性：官方序按 starred_at 降序且请求显式钉死；任何成员变化必然使受影响页 ETag
 * 翻转变 200 → 304 页内容=上次同步=本地缓存切片，无「集合变了页还 304」的盲区。
 */
async function scanStarred(tok: string, meta: FullSyncMeta): Promise<ScanOutcome> {
  const baseline = meta.etags?.map(normEtag);
  const baselineOk =
    !!meta.lastFullSyncAt &&
    Date.now() - meta.lastFullSyncAt <= FULL_SYNC_TTL_MS &&
    !!baseline && baseline.length > 0 && baseline.every((e) => !!e);
  // 曾用过什么（D30 / 4.16.0 删除）：此处原有两个「升级回补阀门」——`meta.dataRev !== DATA_REV`
  // （4.8.0，updatedAt 语义由 updated_at 改 pushed_at 时换血一次）与 `typeFlagsComplete(cache)`
  // （4.2.0，缓存缺 Type 四标志则整表回补）。删除理由：两者唯一能修的是「≤4.7.x 写入的缓存」，
  // 而下面的 baselineOk 已要求 lastFullSyncAt 在 FULL_SYNC_TTL_MS（48h）内 —— 更旧的缓存本来就走
  // 无条件整表（语义与四标志一起补齐），阀门的可触发窗口实际不可复现；且导入路径从不写
  // stars_full_sync_meta，阀门连导入进来的旧语义数据都看不见。四标志现由 parseItem 在同步时写入。
  if (!baselineOk) {
    console.log('[github-star-manager] 无逐页基线/超 48h TTL → 无条件整表拉取（重建基线）');
    return fullPullOutcome(tok);
  }

  // ① 波次条件扫描（尾页 N+1 带 tailEtag 条件探增长：304=越界仍空，0 额度 0 body）
  const baselinePages = baseline.length;
  const ctrl = new AbortController();
  const bodyPagesMap = new Map<number, PageFetch>();
  const modPages: number[] = [];
  const scanRange: number[] = [];
  for (let p = 1; p <= baselinePages + (baselinePages < MAX_PAGES ? 1 : 0); p++) scanRange.push(p); // 页数达上限不探尾（增长越界本就超收限）
  await runWaves(scanRange, ctrl, async (page) => {
    const r = await fetchStarredPage(tok, page, ctrl.signal, page <= baselinePages ? baseline[page - 1] : meta.tailEtag); // 尾页带越界 etag 条件探
    if (r.notModified) {
      if (page <= baselinePages) modPages.push(page); // 尾页 304 = 越界仍空：不算内容、不算变化
    } else bodyPagesMap.set(page, r);
  });

  // 尾页越界 ETag 维护（4.0.9 条件探尾）：304 = 越界仍空 → 沿用旧值（绝不从 304 回读）；
  // 200 空 = 刷新；200 有货 = 尾页转正为内容页 → 清空（新越界页下次首探无条件、随后入库）
  let nextTailEtag: string | undefined = meta.tailEtag;
  const tailResp = bodyPagesMap.get(baselinePages + 1);
  if (tailResp) nextTailEtag = tailResp.body.length > 0 ? undefined : tailResp.etag || undefined;

  // ② 变化判定：基线内任一 200（含空页=收缩）或尾页有货 = 有变化
  const hasChange = [...bodyPagesMap.entries()].some(([p, bp]) => bp.body.length > 0 || p <= baselinePages);
  if (!hasChange) return { kind: 'unchanged', nextTailEtag };

  // ③ 正文解析（红线：一条解析失败=整体放弃）；真内容页数 = 304 页与非空正文页的最大者
  const parsedBodies = new Map<number, RemoteStar[]>();
  let rawSeen = 0;
  for (const [p, bp] of bodyPagesMap) {
    const arr: RemoteStar[] = [];
    rawSeen += bp.body.length;
    for (const raw of bp.body) {
      const it = parseItem(raw);
      if (!it) throw new Error(`第 ${p} 页有解析失败条目（响应形态不符），整体放弃`);
      arr.push(it);
    }
    parsedBodies.set(p, arr);
  }
  let contentPages = 0;
  for (const p of modPages) contentPages = Math.max(contentPages, p);
  for (const [p, arr] of parsedBodies) if (arr.length > 0) contentPages = Math.max(contentPages, p);

  // ④ 切片阀门：需要切片但缓存不可切 → 无条件整表兜底
  const needSlicePages = modPages.filter((p) => p <= contentPages);
  let slices: RemoteStar[][] | null = null;
  if (needSlicePages.length > 0) {
    const built = buildLocalSlices(loadRepoCache());
    let usable = built !== null && needSlicePages.every((p) => p <= built.length);
    if (usable && built) {
      for (const [p, arr] of parsedBodies) {
        if (p > contentPages || arr.length === 0) continue; // 空正文页=合法收缩，不比对
        const expectedIds = new Set(built[p - 1].map((it) => it.repoId));
        if (expectedIds.size === 0) continue;
        let overlap = 0;
        for (const it of arr) if (expectedIds.has(it.repoId)) overlap += 1;
        if (overlap / Math.max(expectedIds.size, arr.length) < 0.5) {
          console.log(`[github-star-manager] 切片阀门：第 ${p} 页正文与本地切片重叠过低（${overlap}/${Math.max(expectedIds.size, arr.length)}）→ 排序模型失真`);
          usable = false;
          break;
        }
      }
    }
    if (!usable) {
      console.log('[github-star-manager] 本地切片不可用（缓存缺 star 时间/覆盖不足/模型失真）→ 回落无条件整表');
      return fullPullOutcome(tok);
    }
    slices = built;
  }
  if ((parsedBodies.get(baselinePages + 1)?.length ?? 0) >= PAGE_SIZE) {
    console.log('[github-star-manager] 尾页满页（增长可能超一页）→ 回落无条件整表');
    return fullPullOutcome(tok);
  }

  // ⑤ 按页序组装：正文页用响应、304 页用本地切片；切片平局互换造成的重复只计一次
  const items: RemoteStar[] = [];
  const freshIds = new Set<string>();
  const seen = new Set<string>();
  const etags: string[] = [];
  let slicePages = 0;
  for (let p = 1; p <= contentPages; p++) {
    const body = parsedBodies.get(p);
    if (!body && !slices) throw new Error(`第 ${p} 页需切片但切片不可用（内部状态异常），整体放弃`);
    etags.push(body ? bodyPagesMap.get(p)!.etag : baseline[p - 1] ?? '');
    const source: RemoteStar[] = body ?? slices![p - 1] ?? [];
    if (!body) slicePages += 1;
    for (const it of source) {
      if (seen.has(it.repoId)) continue;
      seen.add(it.repoId);
      items.push(it);
      if (body) freshIds.add(it.repoId);
    }
  }
  return {
    kind: 'synced',
    items,
    pages: contentPages,
    etags,
    hybrid: slicePages > 0,
    freshIds,
    bodyPages: contentPages - slicePages,
    slicePages,
    nextTailEtag,
  };
}


/** starred 列表第 page 页 URL（显式钉死排序：sort=created=按 star 时间、direction=desc——本地切片复算依赖此序，绝不改） */
function pageUrl(page: number): string {
  return `https://api.github.com/user/starred?per_page=${PAGE_SIZE}&page=${page}&sort=created&direction=desc`;
}

/** 鉴权失败统一上报：401 与非限速 403 → 初始化面板（常驻填 token 框）；限速类只由上层日志 */
function reportAuthIssue(resp: Response): void {
  if (resp.status === 401) {
    notifyTokenIssue('401 Bad credentials：Token 已失效或被撤销');
  } else if (resp.status === 403) {
    const retryAfter = resp.headers.get('retry-after');
    const exhausted = resp.headers.get('x-ratelimit-remaining') === '0';
    if (!retryAfter && !exhausted) {
      // 同上：不得再引导「检查 Starring 权限」（ADR 0004）——只说明 token 对该资源无权
      notifyTokenIssue('403 权限不足：当前 Token 无权访问该资源');
    }
  }
}

/* ---------------- 变化简报与重绘（4.9.0，ADR 0003） ---------------- */

interface SyncReportInput {
  total: number;
  added: number;
  restored: number;
  unstarred: number;
  refreshed: number;
  unstarredItems: Array<{ repoId: string; name: string }>;
}

/**
 * 同步收尾的变化简报（ADR 0003）：
 * - **不判重**：每次同步各弹一条（相同摘要意味着中间必有变化，重复显示才诚实）；
 * - 口径只有「取消 star / 新增 / 恢复」三类计数，**元数据刷新不进简报**（只进控制台）；
 * - 无变化也弹「无变化（共 N 个 star）」；
 * - 每条外部取关**各弹一条带「恢复」按钮的通知**（逐条动作，不做「恢复全部」语义）。
 */
function emitSyncReport(source: 'button' | 'auto', r: SyncReportInput): void {
  if (r.added === 0 && r.restored === 0 && r.unstarred === 0) {
    pushNotice(`同步完成：无变化（共 ${r.total} 个 star）`, 'info');
    // 元数据刷新只进控制台（ADR 0003 口径）
    if (r.refreshed > 0) console.log(`[github-star-manager] 同步：元数据刷新 ${r.refreshed} 条（不进简报）`);
    return;
  }
  const parts: string[] = [];
  if (r.unstarred > 0) parts.push(`取消 star ${r.unstarred}`);
  if (r.added > 0) parts.push(`新增 ${r.added}`);
  if (r.restored > 0) parts.push(`恢复 ${r.restored}`);
  const text = `同步完成：${parts.join('、')}（共 ${r.total} 个 star）`;
  // 有外部取关 = 数据有风险 → 用 danger 视觉并保持逐条可恢复；否则只是信息性更新
  pushNotice(text, r.unstarred > 0 ? 'danger' : 'success');
  for (const it of r.unstarredItems) pushRestoreNotice(it.repoId, it.name, 'report');
  if (source === 'auto') console.log('[github-star-manager] 自动同步产出变化，简报已弹出');
  if (r.refreshed > 0) console.log(`[github-star-manager] 同步：元数据刷新 ${r.refreshed} 条（不进简报）`);
}

/**
 * 同步后重绘网格：有增删差异或可见元数据更新就**立即重绘**。
 * 用户裁定：不再问「是否刷新」——自动来源同样直接换列表，简报已经说明发生了什么。
 */
function rerenderAfterSync(changed: number): void {
  if (changed <= 0) return;
  if (!document.querySelector('.stars-grid-container')) return; // 不在网格视图（如详情页）
  applyFilters({ keepPage: true });
}

/** 手动/自动的共同入口；失败返回 null 且不改动任何数据 */
export async function runFullSync(source: 'button' | 'auto'): Promise<SyncSummary | null> {
  if (syncing) {
    // 并发丢弃**不改变状态**：另一次同步正在进行中，按钮正转着就是最准确的信号，
    // 把它改成 failed 反而会让转圈停下、谎报失败。旧代码在这里连日志都没有。
    console.log('[github-star-manager] P4 同步：已有一次同步在进行中，本次触发被忽略（不排队）');
    return null;
  }
  let tok = getGitHubPat();
  if (!tok && source === 'button') {
    // 打开**配置横幅**（内联粘贴行 + 两条快速创建深链），而不是 window.prompt：
    // 原生 prompt 会阻塞整个页面主线程，且 prompt 式入口早已按用户更正撤除（见 index.ts
    // showSetupBanner 注释）；横幅是 ADR 0004 指定的配置入口。自动来源不弹，避免开页即打扰。
    notifyTokenIssue('同步需要 Token —— 请在下方输入框粘贴后点「保存并同步」');
    tok = getGitHubPat();
  }
  if (!tok) {
    console.log('[github-star-manager] P4 同步：未配置 token，已取消（TM 菜单 →「⭐ 设置 GitHub Token」）');
    // 这是**真的要用户做点什么**的终态：广播 failed，按钮 title 会留下原因
    setSyncState({ phase: 'failed', reason: '未配置 Token', lastSummary: lastSyncSummary });
    return null;
  }

  /** 本轮成功产出的摘要；finally 广播终态时用它更新 lastSummary */
  let produced: SyncSummary | undefined;
  /** 非空 = 本轮失败，finally 广播 failed 而不是 idle */
  let failureReason: string | undefined;

  syncing = true;
  setSyncState({ phase: 'running' });
  try {
    // 单遍扫描（4.0.8）：逐页 If-None-Match 一把梭——全 304 免额度早退；200 页收正文、
    // 304 页用本地切片复用缓存（starred_at 降序复算，不重拉）；无基线/超 TTL/阀门失守 → 无条件整表。
    const storedMeta = gmGet<FullSyncMeta>(STORAGE_KEYS.fullSyncMeta, {});
    const scan = await scanStarred(tok, storedMeta);
    if (scan.kind === 'unchanged') {
      console.log(`[github-star-manager] ETag 304：${(storedMeta.etags ?? []).length} 页全部无变化（免额度），跳过整表比对`);
      // 修 304/200 交替：校验值发出去的就是服务端验证过的值，绝不从 304 响应头回读覆盖；
      const healedEt = storedMeta.etags?.map(normEtag);
      gmSet(STORAGE_KEYS.fullSyncMeta, {
        ...storedMeta,
        ...(healedEt ? { etags: healedEt } : {}),
        ...(scan.nextTailEtag ? { tailEtag: scan.nextTailEtag } : {}),
        lastFullSyncAt: Date.now(),
      });
      // 无变化也弹（ADR 0003）：用户需要知道「同步确实跑过了」
      const total = storedMeta.count ?? 0;
      pushNotice(`同步完成：无变化（共 ${total} 个 star）`, 'info');
      produced = { pages: 0, total, added: 0, restored: 0, unstarred: 0, backfilled: 0 };
      return produced;
    }
    console.log(
      `[github-star-manager] ★ P4 扫描：${scan.pages} 页（正文 ${scan.bodyPages} + 本地切片 ${scan.slicePages}，` +
        `${scan.hybrid ? '切片混合模式：local-only 嫌疑逐条核对' : '全正文权威模式'}）→ 三向比对…`
    );
    const remoteMap = new Map(scan.items.map((it) => [it.repoId, it]));

    // A. 外部 unstar：本地缓存有、远端无 → 走既有宽限管线。
    // 全正文模式：整表即权威确认；切片混合模式：嫌疑先逐条 GET 核对（204=切片平局误报保留 / 404=真取关）。
    const cacheBefore = loadRepoCache();
    /** 本轮新确认的外部取关（简报要逐条给「恢复」按钮，故留名字） */
    const unstarredItems: Array<{ repoId: string; name: string }> = [];
    let unstarred = 0;
    for (const repoId of Object.keys(cacheBefore)) {
      if (remoteMap.has(repoId)) continue;
      if (scan.hybrid) {
        const gone = await checkStarredGone(tok, cacheBefore[repoId].name || '');
        if (gone === false) {
          console.log(`[github-star-manager] 嫌疑核对：${cacheBefore[repoId].name || repoId} 仍 star（切片平局误报），保留`);
          continue;
        }
        if (gone === null) {
          console.log(`[github-star-manager] 嫌疑核对不可判定（网络/异常状态），本轮不动：${cacheBefore[repoId].name || repoId}`);
          continue;
        }
      }
      const path = cacheBefore[repoId].name || '';
      if (applyExternalUnstar(repoId, path)) {
        unstarred += 1;
        unstarredItems.push({ repoId, name: path.replace(/^\//, '') || repoId });
      }
    }

    // B. 远端有、本地无：宽限区内 = re-star 恢复；否则 = 新 star 建条目（切片条目必在缓存，天然不进这里）
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

    // C. 交集：回填 star 时间 + 元数据刷新（一次写盘）；切片条目缓存即现值（304 证明未变），跳过刷新不计数
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
      if (!scan.freshIds.has(it.repoId)) continue; // 切片条目：304 证明未变，不写不数
      const m = it.meta;
      let metaChanged = false;
      if (m.desc !== undefined && entry.desc !== m.desc) { entry.desc = m.desc; metaChanged = true; }
      if (m.lang !== undefined && entry.lang !== m.lang) { entry.lang = m.lang; metaChanged = true; }
      if (m.stars !== undefined && entry.stars !== m.stars) { entry.stars = m.stars; metaChanged = true; }
      if (m.forks !== undefined && entry.forks !== m.forks) { entry.forks = m.forks; metaChanged = true; }
      if (m.updatedAt !== undefined && entry.updatedAt !== m.updatedAt) { entry.updatedAt = m.updatedAt; metaChanged = true; }
      if (m.private !== undefined && entry.private !== m.private) { entry.private = m.private; metaChanged = true; }
      if (m.fork !== undefined && entry.fork !== m.fork) { entry.fork = m.fork; metaChanged = true; }
      if (m.isTemplate !== undefined && entry.isTemplate !== m.isTemplate) { entry.isTemplate = m.isTemplate; metaChanged = true; }
      if (m.mirror !== undefined && entry.mirror !== m.mirror) { entry.mirror = m.mirror; metaChanged = true; }
      if (metaChanged) refreshed += 1;
    }
    saveRepoCache(cache);

    const summary: SyncSummary = {
      pages: scan.pages,
      total: scan.items.length,
      added,
      restored,
      unstarred,
      backfilled,
    };
    console.log(
      `[github-star-manager] ★ P4 全量同步完成：${summary.total} 个 star / ${scan.pages} 页` +
        `（正文 ${scan.bodyPages} + 切片 ${scan.slicePages}）— 新增 ${added}、恢复 ${restored}、外部 unstar ${unstarred}、` +
        `回填 star 时间 ${backfilled}、元数据刷新 ${refreshed}`
    );
    document.querySelector('.gsm-setup-banner')?.remove(); // 同步成功即撤配置横幅（缓存已就绪）
    emitSyncReport(source, {
      total: summary.total,
      added,
      restored,
      unstarred,
      refreshed,
      unstarredItems,
    });
    // 有增删差异或可见元数据更新 → **立即重绘**网格（不问「是否刷新」）
    rerenderAfterSync(added + restored + unstarred + backfilled + refreshed);
    // 写元数据：逐页 ETag 基线（304 页沿用旧校验值、正文页用响应值，剥 W/ 规范形）+ lastFullSyncAt + 总数
    const outMeta: FullSyncMeta = { etags: scan.etags, lastFullSyncAt: Date.now(), count: scan.items.length };
    if (scan.nextTailEtag) outMeta.tailEtag = scan.nextTailEtag; // 尾页越界 etag（缺省=清空：尾页转正或整表兜底后新越界页待首探）
    gmSet(STORAGE_KEYS.fullSyncMeta, outMeta);
    const noEtag = scan.etags.filter((e) => !e).length;
    console.log(`[github-star-manager] ETag 基线：${scan.etags.length} 页已保存${noEtag ? `（${noEtag} 页响应缺 ETag 头，下次扫描直接整表）` : '（下次扫描逐页 304 免额度）'}`);
    produced = summary;
    return summary;
  } catch (err) {
    failureReason = err instanceof Error ? err.message : String(err);
    console.error('[github-star-manager] ★ P4 全量同步失败（未改动任何数据）：', failureReason);
    return null;
  } finally {
    syncing = false;
    // 终态只在这里广播一次：正常返回、304 早退、抛错三条路径全覆盖。
    // 旧代码在 catch 里只写 console —— 失败对用户完全不可见（4.10.0 修正）。
    if (produced) lastSyncSummary = produced;
    setSyncState(
      failureReason
        ? { phase: 'failed', reason: failureReason, lastSummary: lastSyncSummary }
        : { phase: 'idle', lastSummary: lastSyncSummary }
    );
    // 归属校验（4.11.0）：覆盖「成功 / 304 早退 / 抛错」三条路径。刻意放在 setSyncState **之后**
    // 且 fire-and-forget：不得进入同步关键路径，也不得影响状态机（按钮 busy / 失败态只由 SyncState 决定，见 D23）。
    // **注意**：无 token 时本函数在 try 之前就 return（见上方「未配置 Token」早退），故这条路径**不覆盖**
    // 「清空 Token」—— 那条由 index.ts 的 token-issue handler 负责复评（第二轮审查 P1-1）。
    mountAccountGuard();
  }
}

/** TM 菜单手动同步入口（与标题行 Sync 按钮等价：都只是触发 runFullSync，
 *  反馈统一由头部按钮这一个视图呈现 —— 「入口多处、状态一处、视图一处」） */
export function registerSyncMenu(): void {
  gmRegisterMenuCommand('🔄 立即全量同步（GitHub API）', () => {
    void runFullSync('button');
  });
}

/* ================================================================
 * 头部 Sync 按钮（4.0.4 恢复；4.10.0 起 = 同步状态的**唯一视图**）
 * ================================================================
 *
 * **失败与「被丢弃」的可见性（4.10.0）**：
 * - 失败：`runFullSync` 把原因广播成 `failed` 态 → 按钮 title 常驻原因 + 红字 20s
 *   （旧代码在 catch 里只写 console，用户完全看不到失败）；
 * - 被并发丢弃：**不**广播 failed（那会把正在转的按钮停下、谎报失败），可见信号是
 *   按钮正在转着的 running 态，外加一条说明为何忽略的控制台日志。
 */
const SYNC_DEFAULT_TITLE =
  '同步 GitHub 全量 star 列表（逐页 ETag 快筛 + 整表比对 + 回填 star 时间）';

/** 已挂载按钮的取消订阅函数；teardown 必须显式注销（只删节点会漏掉订阅） */
let mountedSync: { unsubscribe: () => void } | null = null;
/** 读屏播报区（惰性创建） */
let syncLiveRegion: HTMLElement | null = null;
/** 失败态红色视觉的自动褪去定时器（原因文案留在 title 里，不随之消失） */
let syncFailedVisualTimer: number | undefined;
/**
 * 失败红字保留时长。刻意不是「永久的」：失败可能发生在用户没盯着屏幕的时候
 * （进页自动同步），所以它必须醒目；但也不该长期挂在头部当装饰 —— 十几秒足够
 * 让人注意到，之后 title 里仍能读到原因。
 */
const SYNC_FAILED_VISUAL_MS = 20_000;

/** 只切失败配色，并给它一个自动褪去的时间盒 */
function setSyncFailedVisual(btn: HTMLElement, on: boolean): void {
  if (syncFailedVisualTimer !== undefined) {
    window.clearTimeout(syncFailedVisualTimer);
    syncFailedVisualTimer = undefined;
  }
  btn.classList.toggle('gsm-sync-failed', on);
  if (!on) return;
  syncFailedVisualTimer = window.setTimeout(() => {
    syncFailedVisualTimer = undefined;
    btn.classList.remove('gsm-sync-failed');
  }, SYNC_FAILED_VISUAL_MS);
}

/**
 * 显式注销头部按钮的同步状态订阅（`viewTeardown` 删 `.gsm-sync-btn` 时调用）。
 * 只靠 `isConnected` 兜底是错的：跨断点往返每轮都会在订阅集合里留下一个指向
 * 游离按钮的闭包，越积越多。
 */
export function unmountSyncButton(): void {
  mountedSync?.unsubscribe();
  mountedSync = null;
  syncLiveRegion = null;
  if (syncFailedVisualTimer !== undefined) {
    window.clearTimeout(syncFailedVisualTimer);
    syncFailedVisualTimer = undefined;
  }
}

/** 视觉隐藏的播报区：只在进行中写入文案，且必须能被 teardown 一并清掉 */
function ensureSyncLiveRegion(host: HTMLElement): HTMLElement {
  if (syncLiveRegion && syncLiveRegion.isConnected) return syncLiveRegion;
  const el = document.createElement('span');
  el.className = 'gsm-sync-status';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  host.appendChild(el);
  syncLiveRegion = el;
  return el;
}

/**
 * 标题行 Sync 按钮（4.0.4 恢复；**4.10.0 起改为同步状态的唯一视图**）。
 *
 * 旧实现只有「自己点自己」才有反馈（而那正是被明确否决的整按钮刷新态）；现在
 * TM 菜单 / 配置横幅 / Token 保存 / 进页自动 / 按钮自身五个入口触发的同步，
 * 都由这里同一个按钮显示出来。
 *
 * 契约（勿破坏）：**DOM 形状恒定** —— 只切 `aria-busy` / `aria-disabled` / `title` /
 * 一个错误态 class，既不换图标节点也不换文字节点。Primer 的 `ButtonBase` 源码注释
 * 明确记载「切 loading 前后若 DOM 不同形，按钮会丢焦点」；这同时保证按钮宽度在
 * 同步前后完全不变（用户明确要求「不要整个按钮变成刷新态」）。
 */
export function mountSyncButton(row: HTMLElement): void {
  unmountSyncButton();
  row.querySelector('.gsm-sync-btn')?.remove();
  const pager = row.querySelector('.gsm-top-pager');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'Button Button--secondary Button--medium gsm-sync-btn';
  btn.innerHTML = SYNC_SVG + ' Sync';
  btn.title = SYNC_DEFAULT_TITLE;
  btn.addEventListener('click', () => {
    // 同步中点了也不会有第二次请求（runFullSync 的重入守卫兜底）；CSS 另加
    // pointer-events:none 让「不可点」在观感上也成立
    void runFullSync('button');
  });

  if (pager) row.insertBefore(btn, pager);
  else row.appendChild(btn);

  // 「挂载即对齐」：Token 保存路径下网格（连同按钮）是在同步**之后**才建的，
  // 若只等下一次广播，按钮会先呈空闲再跳变。
  renderSyncButton(btn, row, getSyncState());
  mountedSync = { unsubscribe: subscribeSyncState((state) => renderSyncButton(btn, row, state)) };
}

/** 把状态画到按钮上（唯一视图；只碰属性，绝不碰结构） */
function renderSyncButton(btn: HTMLElement, host: HTMLElement, state: SyncState): void {
  setSyncFailedVisual(btn, state.phase === 'failed');

  if (state.phase === 'running') {
    btn.setAttribute('aria-busy', 'true');
    // 用 aria-disabled 而不是 disabled 属性：保留可聚焦与 title 提示
    // （Primer 按钮加载态指南第一条即「不摘除节点、不用 disabled」）
    btn.setAttribute('aria-disabled', 'true');
    btn.title = SYNC_DEFAULT_TITLE;
    ensureSyncLiveRegion(host).textContent = '正在同步 GitHub star 列表…';
    return;
  }

  btn.removeAttribute('aria-busy');
  btn.removeAttribute('aria-disabled');
  if (syncLiveRegion && syncLiveRegion.isConnected) syncLiveRegion.textContent = '';

  if (state.phase === 'failed') {
    // 失败可见（4.10.0 修正）：旧代码只写 console，用户完全看不到
    btn.title = `上次同步失败：${state.reason ?? '未知原因'}（点此重试）`;
    return;
  }

  const s = state.lastSummary;
  btn.title = s
    ? `上次同步：${s.total} 个 star / ${s.pages} 页 — 新增 ${s.added}、恢复 ${s.restored}、` +
      `外部 unstar ${s.unstarred}、回填 star 时间 ${s.backfilled}`
    : SYNC_DEFAULT_TITLE;
}

/**
 * API 数据就绪 = 至少完整整表过一次（全量缓存可渲染 = API 主模式前提）。
 * 定义已迁到存储层（`storage/repoCache.ts` 的 `hasApiData`，4.14.0）：那里是它唯一的数据来源，
 * 且 `cardState.ts` 需要在**不依赖 fullSync** 的前提下用它，避免导入环。此处只做转发。
 */
export { hasApiData };

/** 进页自动同步（transform 成功后触发）：延迟 2s 让首屏渲染先完成 */
export function scheduleProbeSync(): void {
  // 窄视口（4.9.1）：不发起进页自动同步。手机上既没有网格呈现同步结果，用户也看不到
  // 任何提示（配置横幅在窄视口同样不显示），只会白耗一次网络与额度。手动入口不受影响。
  if (!isDesktop()) return;
  // 世代 + 视口双守卫（4.9.2 审查修正）：这 2s 内若发生回滚（同一世代被推进）或新一轮转换，
  // 本次自动同步必须作废 —— 否则页面已退回 GitHub 原生视图，脚本仍在拉整表 API：
  // 白耗 60/h 额度，且一旦检出变化，emitSyncReport 会在窄视口上把通知栈重建出来（pushNotice
  // 懒重建，disposeNotificationStack 挡不住），与「窄视口不弹任何 UI」正面冲突。
  const gen = currentGeneration();
  window.setTimeout(() => {
    ifCurrent(gen, () => {
      if (!isDesktop()) return;
      void probeAndSync();
    });
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


