// GitHub star 状态核对：外部 unstar 检测的确认层（P2.5）。
//
// snapshot.ts 的快照 diff 只会把「从到货页消失」的仓库列为**候选**；一切数据
// 改动都必须经过这里 API 核对的双 404 确认（2026-09-22 决策：默认开启）。
// 无 token / 权限不足 / 网络失败 / 速率受限时一律只记日志，绝不改数据
// （「不确定只当 stale」）。
//
// Token 双格式（2026-09-22 调研结论，来源链接记录在 AGENTS.md 决策记录）：
// - classic `ghp_`：有效 token 即可读 /user/starred*；仅涉及公开仓库时可不勾
//   scope，涉及私有仓库请勾 `repo`——API 无法区分「无权限读取的私有仓库」与
//   「已取消 star」（两者都是 404），无 repo scope 的 classic token 核对私有仓库
//   存在误判风险，这是已知局限（决策：不做同源页面 fallback，抓页面太重）。
// - fine-grained `github_pat_`：需要账号级权限 Account permissions → Starring →
//   Read，仓库范围选 All repositories（官方 fine-grained 端点权限表
//   "User permissions for Starring" 列出全部 5 个 /user/starred* 端点）。
//
// 预算（P2.5 设计）：
// - 每次到货最多交 8 个候选（snapshot.ts 切片）、队列总上限 24；
// - 串行逐条、条间隔 200ms；双 404 间隔 1.5s；网络错误重试 1 次；
// - 速率余量 < 50 / 余量为 0 / retry-after → 暂停到重置时刻；
// - 裁决缓存：starred 24h、unstarred 7d 内不重复核对（确认后还会全量清快照）。

import { applyFilters } from './filters';
import { STAR_EMPTY_SVG, STORAGE_KEYS } from './constants';
import { gmGet, gmRegisterMenuCommand, gmSet } from './gm';
import { filterState } from './state';
import { getNote, saveNote } from './storage/notes';
import { loadPendingDelete, savePendingDelete } from './storage/pendingDelete';
import { loadRepoCache, saveRepoCache } from './storage/repoCache';
import { getTags, saveTags } from './storage/tags';
import { renderNotes } from './ui/notes';
import { renderTags } from './ui/tagFilter';
import type { PendingDeleteMap, RepoCache, VerdictMap } from './types';

/* ---------------- token ---------------- */

export type TokenKind = 'classic' | 'fine-grained';

export function getGitHubPat(): string {
  return gmGet<string>(STORAGE_KEYS.githubPat, '') || '';
}

function detectTokenKind(tok: string): TokenKind | null {
  if (tok.startsWith('github_pat_')) return 'fine-grained';
  if (tok.startsWith('ghp_')) return 'classic';
  return null;
}

/** TM 菜单入口：输入/清除 PAT。任意 github.com 页面可设（init 无条件注册）。 */
/** 输入/清除 PAT（TM 菜单与 P4 同步按钮无 token 时共用） */
export function promptForToken(): void {
  const cur = getGitHubPat();
  const masked = cur ? `${cur.slice(0, 12)}…${cur.slice(-4)}` : '未设置';
  const input = window.prompt(
    'GitHub PAT，用于外部 unstar 核对（P2.5）与 P4 全量同步（Sync 按钮）。\n' +
      '· classic：ghp_ 前缀；核对/同步私有仓库需勾选 repo scope（仅公开仓库可不勾）\n' +
      '· fine-grained：github_pat_ 前缀；账号权限 Account permissions → Starring → Read，\n' +
      '  仓库范围选 All repositories\n' +
      '（留空 = 删除当前 token；保存后立即生效）\n\n' +
      `当前：${masked}`,
    ''
  );
  if (input === null) return;
  const tok = input.trim();
  if (!tok) {
    gmSet(STORAGE_KEYS.githubPat, '');
    console.log('[github-stars-grid] token 已清除，外部 unstar 核对与 P4 同步暂停');
    return;
  }
  const kind = detectTokenKind(tok);
  if (!kind) {
    window.alert('无法识别的 token 前缀：预期 ghp_（classic）或 github_pat_（fine-grained）。未保存。');
    return;
  }
  gmSet(STORAGE_KEYS.githubPat, tok);
  console.log(`[github-stars-grid] token 已保存（${kind}），外部 unstar 核对与 P4 同步生效`);
}

/** TM 菜单入口：任意 github.com 页面可设（init 无条件注册） */
export function registerTokenMenu(): void {
  gmRegisterMenuCommand('⭐ 设置 GitHub Token（核对 + P4 全量同步）', () => {
    promptForToken();
  });
}

/* ---------------- 裁决缓存 ---------------- */

const VERDICT_STARRED_TTL = 24 * 60 * 60 * 1000; // 24h
const VERDICT_UNSTARRED_TTL = 7 * 24 * 60 * 60 * 1000; // 7d

function loadVerdicts(): VerdictMap {
  return gmGet<VerdictMap>(STORAGE_KEYS.starVerdicts, {});
}

function getVerdict(repoId: string): boolean {
  const all = loadVerdicts();
  const v = all[repoId];
  if (!v) return false;
  const ttl = v.s === 'starred' ? VERDICT_STARRED_TTL : VERDICT_UNSTARRED_TTL;
  if (Date.now() - v.ts > ttl) {
    delete all[repoId];
    gmSet(STORAGE_KEYS.starVerdicts, all);
    return false;
  }
  return true;
}

function setVerdict(repoId: string, s: 'starred' | 'unstarred'): void {
  const all = loadVerdicts();
  all[repoId] = { s, ts: Date.now() };
  gmSet(STORAGE_KEYS.starVerdicts, all);
}

/* ---------------- 队列与速率控制 ---------------- */

interface VerifyItem {
  repoId: string;
  path: string;
  attempts: number;
}

const MAX_QUEUE = 24;
const ITEM_SPACING_MS = 200;
const DOUBLE_404_DELAY_MS = 1500;
const RATE_FLOOR = 50;

let queue: VerifyItem[] = [];
const queued = new Set<string>();
let processing = false;
let ratePausedUntil = 0;
/** 当前 token 核对失败（401/403 权限）后熔断，换 token 自动恢复 */
let authBrokenFor = '';
let noTokenWarned = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** snapshot.ts 的候选入口：去重、过滤已知项、限额入队并启动串行核对 */
export function enqueueVerify(items: { repoId: string; path: string }[]): void {
  if (items.length === 0) return;
  const tok = getGitHubPat();
  if (!tok) {
    if (!noTokenWarned) {
      noTokenWarned = true;
      console.log(
        `[github-stars-grid] 有 ${items.length} 个仓库从页面消失待核对，但未配置 token：` +
          'Tampermonkey 菜单 →「⭐ 设置 GitHub Token」（配置前候选仅记录不核对）'
      );
    }
    return;
  }
  noTokenWarned = false;
  if (authBrokenFor === tok) return; // 同一 token 已熔断，不再空转

  const pending: PendingDeleteMap = loadPendingDelete();
  const accepted: VerifyItem[] = [];
  for (const it of items) {
    if (queued.has(it.repoId) || queue.some((q) => q.repoId === it.repoId)) continue;
    if (pending[it.repoId]) continue; // 脚本自己记录的 unstar，无需 API 复核
    if (getVerdict(it.repoId)) continue; // 裁决缓存有效期内
    if (queue.length + accepted.length >= MAX_QUEUE) break;
    accepted.push({ repoId: it.repoId, path: it.path, attempts: 0 });
  }
  if (accepted.length === 0) return;
  queue.push(...accepted);
  accepted.forEach((it) => queued.add(it.repoId));
  console.log(
    `[github-stars-grid] star 核对入队 ${accepted.length} 个: ` +
      accepted.map((it) => it.path).join(', ')
  );
  kick();
}

function kick(): void {
  if (processing) return;
  processing = true;
  void (async () => {
    while (queue.length > 0) {
      if (Date.now() < ratePausedUntil) {
        await sleep(ratePausedUntil - Date.now());
        continue;
      }
      const item = queue.shift();
      if (!item) break;
      queued.delete(item.repoId);
      try {
        await verifyOne(item);
      } catch (err) {
        console.warn('[github-stars-grid] star 核对异常（本条跳过）', item.path, err);
      }
      if (queue.length > 0) await sleep(ITEM_SPACING_MS);
    }
    processing = false;
  })();
}

/* ---------------- API 核对 ---------------- */

interface ApiRes {
  status: number;
}

/** 'owner/repo' → API 路径段；形态异常返回 null（跳过该候选） */
function toApiPath(path: string): string | null {
  const segs = path.replace(/^\//, '').split('/');
  if (segs.length !== 2 || !segs[0] || !segs[1]) return null;
  try {
    return `${encodeURIComponent(decodeURIComponent(segs[0]))}/${encodeURIComponent(
      decodeURIComponent(segs[1])
    )}`;
  } catch {
    return null;
  }
}

async function apiGet(url: string, tok: string): Promise<ApiRes | null> {
  let resp: Response;
  try {
    resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${tok}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } catch (err) {
    console.warn('[github-stars-grid] star 核对网络失败（CORS/断网），本条按未知处理', err);
    return null;
  }

  // 速率信息（GitHub 暴露这些响应头；读不到就跳过守卫）
  const remainingHeader = resp.headers.get('x-ratelimit-remaining');
  const resetHeader = resp.headers.get('x-ratelimit-reset');
  const remaining = remainingHeader === null ? NaN : Number(remainingHeader);
  const reset = resetHeader === null ? NaN : Number(resetHeader);
  if (Number.isFinite(remaining) && Number.isFinite(reset)) {
    if (remaining <= 0) {
      ratePausedUntil = reset * 1000 + 30_000;
      console.warn(`[github-stars-grid] star 核对速率余量用尽，暂停至 ${new Date(ratePausedUntil).toLocaleTimeString()}`);
    } else if (remaining < RATE_FLOOR) {
      ratePausedUntil = reset * 1000 + 30_000;
      console.warn(
        `[github-stars-grid] star 核对速率余量 ${remaining} < ${RATE_FLOOR}，本次会话暂停至 ${new Date(
          ratePausedUntil
        ).toLocaleTimeString()}（限额 5000/h，核对预算远低于此）`
      );
    }
  }

  if (resp.status === 401) {
    authBrokenFor = tok;
    console.error('[github-stars-grid] star 核对: token 无效（401），已熔断；TM 菜单可重新设置');
    return { status: resp.status };
  }
  if (resp.status === 403) {
    const retryAfter = resp.headers.get('retry-after');
    if (retryAfter !== null) {
      ratePausedUntil = Date.now() + Number(retryAfter) * 1000 + 5_000;
      console.warn('[github-stars-grid] star 核对: 触发次级速率限制，按 retry-after 暂停');
      return { status: resp.status };
    }
    if (remaining === 0) return { status: resp.status }; // 已在上面熔断速率
    authBrokenFor = tok;
    const perms = resp.headers.get('x-accepted-github-permissions');
    console.error(
      `[github-stars-grid] star 核对: 403 权限不足，已熔断` +
        (perms ? `（需要权限: ${perms}）` : '') +
        '。fine-grained 需 Account permissions → Starring → Read 且仓库范围 All repositories；' +
        'classic 请确认 token 有效'
    );
    return { status: resp.status };
  }
  return { status: resp.status };
}

async function verifyOne(item: VerifyItem): Promise<void> {
  const tok = getGitHubPat();
  if (!tok || authBrokenFor === tok) return;
  const apiPath = toApiPath(item.path);
  if (!apiPath) return;
  const url = `https://api.github.com/user/starred/${apiPath}`;

  const first = await apiGet(url, tok);
  if (!first) {
    // 网络失败：重试 1 次（attempts 计入总数，最多 2 次尝试）
    if (item.attempts < 1) {
      item.attempts += 1;
      queue.push(item);
      queued.add(item.repoId);
    }
    return;
  }
  if (first.status === 204) {
    setVerdict(item.repoId, 'starred'); // 仍 star：位移/排序导致的页面缺失，不动数据
    return;
  }
  if (first.status === 404) {
    await sleep(DOUBLE_404_DELAY_MS); // 双 404 确认（默认开启）
    const second = await apiGet(url, tok);
    if (!second) return;
    if (second.status === 404) {
      setVerdict(item.repoId, 'unstarred');
      confirmExternalUnstar(item.repoId, item.path);
      return;
    }
    if (second.status === 204) {
      setVerdict(item.repoId, 'starred');
      return;
    }
    console.warn(`[github-stars-grid] star 核对: ${item.path} 复核返回意外状态 ${second.status}，按未知处理`);
    return;
  }
  if (first.status !== 401 && first.status !== 403) {
    console.warn(`[github-stars-grid] star 核对: ${item.path} 返回意外状态 ${first.status}，按未知处理`);
  }
}

/* ---------------- 确认外部 unstar 后的数据与 DOM 动作 ---------------- */

type ConfirmedHandler = (repoId: string) => void;
let onConfirmed: ConfirmedHandler | null = null;

/** snapshot.ts 注册：确认后从所有到货页快照中清除该 repoId */
export function onExternalUnstarConfirmed(fn: ConfirmedHandler): void {
  onConfirmed = fn;
}

/**
 * 双 404 确认外部 unstar：走与脚本内 unstar 相同的宽限区管线
 * （缓存条目移入 pendingDelete + 标签/备注备份后清空），复 star 可完整恢复。
 * 幂等：已在 pendingDelete 中则不重复写。
 */
function confirmExternalUnstar(repoId: string, path: string): void {
  const pending: PendingDeleteMap = loadPendingDelete();
  if (pending[repoId]) return;

  const cache: RepoCache = loadRepoCache();
  const entry: PendingDeleteMap[string] = Object.assign({}, cache[repoId] || { name: path.replace(/^\//, '') }, {
    unstarredAt: Date.now(),
    _tags: getTags(repoId),
    _note: getNote(repoId),
  });
  pending[repoId] = entry;
  savePendingDelete(pending);
  if (cache[repoId]) {
    delete cache[repoId];
    saveRepoCache(cache);
  }
  if (getTags(repoId).length > 0) saveTags(repoId, []);
  if (getNote(repoId)) saveNote(repoId, '');

  console.log(
    `[github-stars-grid] ★ 核对确认外部 unstar: ${path}（标签/备注已备份入 24h 宽限期区，` +
      '期间在详情页重新 star 可恢复）'
  );
  onConfirmed?.(repoId);
  updateGridCard(repoId);
}

/** 视图同步：卡片原地翻成未 star 态并刷新标签/备注（与手动点星星按钮的表现一致） */
function updateGridCard(repoId: string): void {
  const card = document.querySelector<HTMLElement>(`.stars-grid-card[data-repo-id="${repoId}"]`);
  if (!card) return;

  const btn = card.querySelector<HTMLButtonElement>('.stars-star-btn');
  if (btn && btn.classList.contains('starred')) {
    btn.classList.remove('starred');
    btn.classList.add('unstarred');
    btn.innerHTML = STAR_EMPTY_SVG;
    btn.title = 'Star';
  }

  const tagsEl = card.querySelector<HTMLElement>('.stars-card-tags');
  if (tagsEl) renderTags(tagsEl);
  const notesEl = card.querySelector<HTMLElement>('.stars-card-notes');
  if (notesEl) renderNotes(notesEl);

  // 正在标签筛选/搜索视图里：仓库已从缓存移除，重算筛选结果（无筛选条件时不触发，
  // 避免 applyFilters 的退出自定义模式分支引发整页导航）
  if (filterState.tags.length > 0 || filterState.searchQuery) applyFilters();
}

/* ---------------- P4 全量同步的复用入口 ---------------- */

/** P4 整表已确认的外部 unstar（远端权威，跳过逐条双 404；管线与核对确认完全一致） */
export function applyExternalUnstar(repoId: string, path: string): void {
  confirmExternalUnstar(repoId, path);
}

/** P4 写裁决（unstarred 7d / starred 24h 内免重复核对） */
export function recordVerdict(repoId: string, s: 'starred' | 'unstarred'): void {
  setVerdict(repoId, s);
}
