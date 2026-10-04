/**
 * 当前网格的**数据来源**（4.13.0）。这是「这张网格显示的是谁的数据」的唯一真相。
 *
 * ## 两种来源
 *
 * - `own`（默认）：数据来自 `stars_repo_cache`（我自己的整表缓存），一切照旧。
 * - `other`（他人 star 页）：数据来自**页面已渲染的原生条目**的一次投影，**只存在内存里**
 *   （`setOtherPageRepos`），随导航/回滚丢弃 —— 不写任何存储键、不发任何请求。
 *
 * ## 为什么要有这个模块
 *
 * `filters.ts` 的 `queryRepos()` 原先直接 `loadRepoCache()`，把「我自己的表」写死在查询管线里。
 * 投影模式下表格来自内存，于是需要一处显式来源；但它必须**极薄**：只是个「当前表格是谁的」的开关，
 * 不碰存储、不碰 DOM、不含渲染逻辑（那些分别属于 `storage/*` 与 `filters.ts`）。
 *
 * ## 只读与筛选的语义（重要）
 *
 * - 他人页的渲染分派走**逐仓库三态**（4.14.0，`cardState.ts` + `cardAreas.ts`）：
 *   本人 star 了的卡片标签/备注可编辑，没 star 的只读；已 unstar 但数据仍在 24h 宽限期备份里的
 *   只读**但仍显示**。星按钮本身照旧只建在「本人整表缓存可用」时（状态取自缓存成员关系）。
 *   `isReadOnlyView()` 现在的语义收窄为「这是投影来源」——它仍是他人页分支的总开关，
 *   但**不再**单独决定标签/备注可不可编辑。
 * - 他人页**不套用脚本筛选状态**（`filterState` 里的 tags/langs/types/search 一概不参与）：
 *   他人页没有筛选 UI（V2），若沿用我自己页上残留的筛选条件，网格会莫名其妙变空 ——
 *   那不是「筛选」，那是「看起来坏了」。他人页的顺序就按页面上原生条目的顺序（= GitHub 的
 *   star 时间倒序），不做本地排序。
 * - 也因此本模块**不改** `filterState`：进他人页不清、离开也不清，我自己页的筛选状态原样保留。
 */

import type { RepoData } from './types';

/** 他人页的投影结果：登录名（页面身份校验用）+ repoId → 数据 */
interface OtherPageSource {
  ownerLogin: string;
  repos: Record<string, RepoData>;
}

let otherPage: OtherPageSource | null = null;

/**
 * 他人页期间**由本页星标写入**造成的状态覆盖（仅内存，`resetViewContext()` 时清空）。
 *
 * 为什么需要：他人页卡片的星按钮状态取自**本人缓存成员关系**（下面 `isStarredByViewer` 的兜底），
 * 而「在他人页给一个自己没 star 过的仓库加星」不会进本人缓存 —— `pendingDelete.markRepoStarred()`
 * 只在待删除区里有该条目时才恢复，没有条目就是 no-op（刻意的：他人页写入不该污染整表缓存）。
 * 于是若本次会话里发生一次渲染，卡片会**退回未加星外观**。这个 Map 就是那一段记忆。
 *
 * 只服务他人页投影：本方自己的页状态来自缓存里的 `unstarredAt`，写在这里没人读。
 */
const starOverrides = new Map<string, boolean>();

/** 记录/更新一次「本人在他人页看来的星标状态」；非他人页视图为 no-op */
export function setViewStarOverride(repoId: string, starred: boolean): void {
  if (!otherPage) return;
  starOverrides.set(repoId, starred);
}

/** 读取他人页的星标状态覆盖；未发生过写入时返回 undefined（调用方回落到缓存成员关系） */
export function getViewStarOverride(repoId: string): boolean | undefined {
  return starOverrides.get(repoId);
}

/** 进入他人 star 页：登记页面投影结果（仅内存）。`ownerLogin` 是页面主人的登录名（来自 meta/路径）。 */
export function setOtherPageRepos(repos: Record<string, RepoData>, ownerLogin: string): void {
  otherPage = { ownerLogin, repos };
}

/** 当前是否是「他人页投影」来源；是则返回投影表，否则返回 null（= 走我自己的缓存） */
export function getOtherPageRepos(): OtherPageSource | null {
  return otherPage;
}

/**
 * 是否处于「他人页投影」视图（= 表格来自内存投影，不是本人整表缓存）。
 *
 * 4.14.0 起语义**收窄**：它只表示「数据来源是投影」，不再单独决定标签/备注可不可编辑
 * —— 那是 `cardState.getCardState()` 的逐仓库三态。`applyFilters` 与渲染分派仍用它做总开关。
 */
export function isReadOnlyView(): boolean {
  return otherPage !== null;
}


/**
 * 复位为「我自己的表」。**必须在**离开他人页 / 跨断点收窄 / 回滚 时调用 ——
 * 否则回到自己的页会拿着上一次的投影渲染（串数据）。
 */
export function resetViewContext(): void {
  otherPage = null;
  starOverrides.clear();
}
