// GitHub token 与 star 状态存储：外部 unstar 确认层（P2.5）与 P4 全量同步的共用基础。
//
// 4.0.0：原「页快照候选 → enqueueVerify 队列 → 双 404 逐条核对」链路随 API 主模式
// 移除（recordArrival 已无调用者）；星状态判定统一由 P4 全量拉取（fullSync.ts）
// 三方 diff 承担。本文件保留：token 双格式读写/校验、裁决缓存写入（recordVerdict）、
// 确认外部 unstar 的宽限区管线（applyExternalUnstar → confirmExternalUnstar）。
// Token 双格式（2026-09-22 调研结论，来源链接记录在 AGENTS.md 决策记录）：
// - classic `ghp_`：有效 token 即可读 /user/starred*；仅涉及公开仓库时可不勾
//   scope，涉及私有仓库请勾 `repo`——API 无法区分「无权限读取的私有仓库」与
//   「已取消 star」（两者都是 404），无 repo scope 的 classic token 核对私有仓库
//   存在误判风险，这是已知局限（决策：不做同源页面 fallback，抓页面太重）。
// - fine-grained `github_pat_`：需要账号级权限 Account permissions → Starring →
//   Read，仓库范围选 All repositories（官方 fine-grained 端点权限表
//   "User permissions for Starring" 列出全部 5 个 /user/starred* 端点）。
//
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

import { detectTokenKind, notifyTokenIssue, notifyTokenSaved, openTokenCreator } from './tokenConfig';
/* ---------------- token ---------------- */

export function getGitHubPat(): string {
  return gmGet<string>(STORAGE_KEYS.githubPat, '') || '';
}


/** TM 菜单入口：输入/清除 PAT。任意 github.com 页面可设（init 无条件注册）。 */
/** 输入/清除 PAT（TM 菜单入口；留空 = 删除 token 并重新打开初始化面板） */
export function promptForToken(notify = true): void {
  const cur = getGitHubPat();
  const masked = cur ? `${cur.slice(0, 12)}…${cur.slice(-4)}` : '未设置';
  const input = window.prompt(
    'GitHub PAT，用于全量同步 star 列表与外部 star 变化核对。\n' +
      '· classic：ghp_ 前缀；核对/同步私有仓库需勾选 repo scope（仅公开仓库可不勾）\n' +
      '· fine-grained：github_pat_ 前缀；账号权限 Account permissions → Starring → Write（读列表 Read 也行，但本脚本加星/去星按钮要 Write），\n' +
      '  仓库范围选 All repositories\n' +
      '（留空 = 删除当前 token 并重新打开配置面板；保存后立即生效）\n\n' +
      `当前：${masked}`,
    ''
  );
  if (input === null) return;
  const tok = input.trim();
  if (!tok) {
    gmSet(STORAGE_KEYS.githubPat, '');
    console.log('[github-stars-grid] token 已清除，外部 unstar 核对与 P4 同步暂停');
    notifyTokenIssue('Token 已清除'); // 重开初始化面板（4.0.3：留空清除后不再静默消失）
    return;
  }
  const kind = detectTokenKind(tok);
  if (!kind) {
    window.alert('无法识别的 token 前缀：预期 ghp_（classic）或 github_pat_（fine-grained）。未保存。');
    return;
  }
  gmSet(STORAGE_KEYS.githubPat, tok);
  console.log(`[github-stars-grid] token 已保存（${kind}），外部 unstar 核对与 P4 同步生效`);
  if (notify) notifyTokenSaved(); // 保存成功 → 撤配置横幅 + 自动全量同步（index.ts 注册的 handler）
}

/** TM 菜单入口：任意 github.com 页面可设（init 无条件注册） */
export function registerTokenMenu(): void {
  gmRegisterMenuCommand('⭐ 设置 GitHub Token', () => {
    promptForToken();
  });
  gmRegisterMenuCommand('🔑 快捷创建 GitHub Token（预填最小权限）', () => {
    openTokenCreator();
  });
}

/* ---------------- 裁决缓存 ---------------- */


function loadVerdicts(): VerdictMap {
  return gmGet<VerdictMap>(STORAGE_KEYS.starVerdicts, {});
}


function setVerdict(repoId: string, s: 'starred' | 'unstarred'): void {
  const all = loadVerdicts();
  all[repoId] = { s, ts: Date.now() };
  gmSet(STORAGE_KEYS.starVerdicts, all);
}

/* ---------------- 确认外部 unstar 后的数据与 DOM 动作 ---------------- */

type ConfirmedHandler = (repoId: string) => void;
let onConfirmed: ConfirmedHandler | null = null;

/** snapshot.ts 注册：确认后从所有到货页快照中清除该 repoId */
export function onExternalUnstarConfirmed(fn: ConfirmedHandler): void {
  onConfirmed = fn;
}

/**
 * 确认外部 unstar：走与脚本内 unstar 相同的宽限区管线
 * （缓存条目移入 pendingDelete + 标签/备注备份后清空），复 star 可完整恢复。
 * 幂等 + 自愈：已在 pendingDelete 中不重复写入区，但**仍清掉缓存中的回写脏态**
 * （详情页提取等路径可能把已取关仓库写回缓存，与宽限区并存 → 整表 diff 每轮重复计数，
 * 实测案例：zai-org/ZCode 每次同步恒报 1 个外部 unstar）。
 * @returns 是否「新确认」（首次入宽限区）；已在宽限区的自愈返回 false，供计数去重。
 */
function confirmExternalUnstar(repoId: string, path: string): boolean {
  const pending: PendingDeleteMap = loadPendingDelete();
  const existed = !!pending[repoId];
  const cache: RepoCache = loadRepoCache();
  if (!existed) {
    pending[repoId] = Object.assign({}, cache[repoId] || { name: path.replace(/^\//, '') }, {
      unstarredAt: Date.now(),
      _tags: getTags(repoId),
      _note: getNote(repoId),
    });
    savePendingDelete(pending);
  }
  if (cache[repoId]) {
    delete cache[repoId];
    saveRepoCache(cache);
  }
  if (getTags(repoId).length > 0) saveTags(repoId, []);
  if (getNote(repoId)) saveNote(repoId, '');
  if (!existed) {
    console.log(
      `[github-stars-grid] ★ 核对确认外部 unstar: ${path}（标签/备注已备份入 24h 宽限期区，` +
        '期间在详情页重新 star 可恢复）'
    );
    onConfirmed?.(repoId);
  }
  updateGridCard(repoId);
  return !existed;
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

/**
 * P4 整表已确认的外部 unstar（远端权威，跳过逐条双 404；管线与核对确认完全一致）。
 * @returns 是否「新确认」；false = 已在宽限区的缓存回写脏态自愈，不计入本轮 unstar 计数。
 */
export function applyExternalUnstar(repoId: string, path: string): boolean {
  return confirmExternalUnstar(repoId, path);
}

/** P4 写裁决（unstarred 7d / starred 24h 内免重复核对） */
export function recordVerdict(repoId: string, s: 'starred' | 'unstarred'): void {
  setVerdict(repoId, s);
}
