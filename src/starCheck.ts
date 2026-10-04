// GitHub token 与 star 状态存储：外部 unstar 确认层（P2.5）与 P4 全量同步的共用基础。
//
// 4.0.0：原「页快照候选 → enqueueVerify 队列 → 双 404 逐条核对」链路随 API 主模式
// 移除（recordArrival 已无调用者）；星状态判定统一由 P4 全量拉取（fullSync.ts）
// 三方 diff 承担。本文件保留：token 双格式读写/校验、确认外部 unstar 的宽限区管线
// （applyExternalUnstar → confirmExternalUnstar）。4.0.10 审查清理：裁决缓存（recordVerdict，
// 只写不读无界增长）与 snapshot 注册钩子（onExternalUnstarConfirmed，注册者是死代码）随死码簇移除。
// Token 双格式（2026-09-22 调研结论，来源链接记录在 AGENTS.md 决策记录）：
// - classic `ghp_`：有效 token 即可读 /user/starred*；仅涉及公开仓库时无需勾选
//   scope，涉及私有仓库请勾 `repo`——API 无法区分「无权限读取的私有仓库」与
//   「已取消 star」（两者都是 404），无 repo scope 的 classic token 核对私有仓库
//   存在误判风险，这是已知局限（决策：不做同源页面 fallback，抓页面太重）。
// - fine-grained `github_pat_`：需要账号级权限 Account permissions → Starring →
//   Read，仓库范围选 All repositories（官方 fine-grained 端点权限表
//   "User permissions for Starring" 列出全部 5 个 /user/starred* 端点）。
//
import { applyFilters } from './filters';
import { STORAGE_KEYS } from './constants';
import { gmRegisterMenuCommand, gmSet } from './gm';
import { filterState } from './state';
import { getNote, saveNote } from './storage/notes';
import { loadPendingDelete, savePendingDelete } from './storage/pendingDelete';
import { loadRepoCache, saveRepoCache } from './storage/repoCache';
import { getTags, saveTags } from './storage/tags';
import { loadViewerCacheForView } from './cardState';
import { renderCardTagAndNoteAreas } from './cardAreas';
import { setStarButtonVisual } from './ui/cards';
import { isReadOnlyView } from './viewContext';
import type { PendingDeleteMap, RepoCache } from './types';

import {
  detectTokenKind,
  getToken,
  notifyTokenIssue,
  notifyTokenSaved,
  openClassicTokenCreator,
  openTokenCreator,
} from './tokenConfig';
/* ---------------- token ---------------- */

/** 已保存的 PAT；'' = 未配置。实现在 tokenConfig（该模块只依赖 constants/gm，不参与导入环）。 */
export const getGitHubPat = getToken;


/** 输入/清除 PAT（TM 菜单入口；留空 = 删除 token 并重新打开初始化面板） */
function promptForToken(notify = true): void {
  const cur = getGitHubPat();
  const masked = cur ? `${cur.slice(0, 12)}…${cur.slice(-4)}` : '未设置';
  const input = window.prompt(
    'GitHub PAT，用于全量同步 star 列表、以及加星/取消星。\n' +
      '· classic：ghp_ 前缀（OAuth 的 gho_ 同样适用）——读列表与写星标都可用，推荐。\n' +
      '  同步私有仓库需勾选 repo scope；只涉及公开仓库时无需勾选。\n' +
      '· fine-grained：github_pat_ 前缀——可读列表，但 GitHub 不允许它改别人的公开仓库星标。\n' +
      '  仓库范围建议选 All repositories（否则私有仓库的 star 会被漏读而误判为已取关）。\n' +
      '（留空 = 删除当前 token 并重新打开配置面板；保存后立即生效）\n\n' +
      `当前：${masked}`,
    ''
  );
  if (input === null) return;
  const tok = input.trim();
  if (!tok) {
    gmSet(STORAGE_KEYS.githubPat, '');
    console.log('[github-star-manager] token 已清除，外部 unstar 核对与 P4 同步暂停');
    notifyTokenIssue('Token 已清除'); // 重开初始化面板（4.0.3：留空清除后不再静默消失）
    return;
  }
  const kind = detectTokenKind(tok);
  if (!kind) {
    window.alert('无法识别的 token 前缀：预期 ghp_ / gho_（classic）或 github_pat_（fine-grained）。未保存。');
    return;
  }
  gmSet(STORAGE_KEYS.githubPat, tok);
  console.log(`[github-star-manager] token 已保存（${kind}），外部 unstar 核对与 P4 同步生效`);
  if (notify) notifyTokenSaved(); // 保存成功 → 撤配置横幅 + 自动全量同步（index.ts 注册的 handler）
}

/** TM 菜单入口：任意 github.com 页面可设（init 无条件注册） */
export function registerTokenMenu(): void {
  gmRegisterMenuCommand('⭐ 设置 GitHub Token', () => {
    promptForToken();
  });
  gmRegisterMenuCommand('🔑 快捷创建 Token：classic（推荐，可写星标）', () => {
    openClassicTokenCreator();
  });
  gmRegisterMenuCommand('🔑 快捷创建 Token：fine-grained（仅读）', () => {
    openTokenCreator();
  });
}

/* ---------------- 确认外部 unstar 后的数据与 DOM 动作 ---------------- */


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
      `[github-star-manager] ★ 核对确认外部 unstar: ${path}（标签/备注已备份入 24h 宽限期区，` +
        '期间在详情页重新 star 可恢复）'
    );
  }
  syncCardAfterStarChange(repoId, false);
  return !existed;
}

/**
 * 视图同步：把某个仓库的卡片星标态改成 `isStarred`，并按**视图**刷新其标签/备注。
 *
 * 三条调用路径共用：卡片星按钮点击成功后（`ui/cards.ts`）、确认外部取关（`applyExternalUnstar`）、
 * 恢复（`restore.ts`）。
 *
 * ## 4.14.0 修正：本函数必须视图感知
 *
 * 此前它**无条件**调 `renderTags` / `renderNotes`（可编辑渲染器，直接绑 `saveTags` / `saveNote`），
 * 全函数没有任何只读判断。于是「在他人 stars 页点一下 star」→ 成功回调 → 这里 → 标签/备注被换成
 * **可编辑**控件 —— 这就是「点了 star 就变成可编辑状态」的缺陷成因。
 *
 * 现在统一交给 `cardAreas.renderCardTagAndNoteAreas`（唯一分派点）：
 * 他人页逐仓库三态（本人已 star ⇒ 可编辑；已 unstar 但数据还在 24h 宽限期备份 ⇒ 只读但仍显示），
 * 本方自己的页照旧永远可编辑。
 */
export function syncCardAfterStarChange(repoId: string, isStarred: boolean): void {
  const card = document.querySelector<HTMLElement>(`.stars-grid-card[data-repo-id="${repoId}"]`);
  if (!card) return;

  // 外观只由一处定义（`ui/cards.ts` 的 setStarButtonVisual）——不要在这里重画一遍，
  // 「同一概念两处实现、判据漂移」正是 4.14.0 那个缺陷的成因（见 D29 / ADR 0009 追加 7）。
  const btn = card.querySelector<HTMLButtonElement>('.stars-star-btn');
  if (btn && btn.classList.contains('starred') !== isStarred) setStarButtonVisual(btn, isStarred);

  // 他人页：只重画这张卡片的标签/备注，**绝不**往下走到 applyFilters。
  if (isReadOnlyView()) {
    renderCardTagAndNoteAreas(card, 'other', loadViewerCacheForView());
    return;
  }

  renderCardTagAndNoteAreas(card, 'own');

  // 有筛选激活（tags/langs/types/search 任一）时：仓库的成员关系变了，重算筛选结果；
  // 无筛选（browse 态）不动。keepPage: 结果集变但条件没变，不把用户拉回第 1 页（🟡-3）
  if (filterState.tags.length > 0 || filterState.langs.length > 0 || filterState.types.length > 0 || filterState.searchQuery) applyFilters({ keepPage: true });
}

/* ---------------- P4 全量同步的复用入口 ---------------- */

/**
 * P4 整表已确认的外部 unstar（远端权威，跳过逐条双 404；管线与核对确认完全一致）。
 * @returns 是否「新确认」；false = 已在宽限区的缓存回写脏态自愈，不计入本轮 unstar 计数。
 */
export function applyExternalUnstar(repoId: string, path: string): boolean {
  return confirmExternalUnstar(repoId, path);
}

