/**
 * 他人 star 页卡片的**可编辑性 / 可见性判定层**（4.14.0）。
 *
 * ## 为什么存在
 *
 * 4.13.0 之前，「只读」是**页级单一布尔**（`viewContext.isReadOnlyView()` = `otherPage !== null`）：
 * 一次取值、决定整页所有卡片的标签/备注渲染器。于是「点一下 star」会经
 * `ui/cards.ts` → `starCheck.syncCardAfterStarChange()` 无条件调起**可编辑**渲染器，
 * 整页（或至少该页后续重绘）都变成可编辑 —— 那是缺陷，不是设计。
 *
 * 本模块把它拆成**逐仓库**的两件正交事实：
 *
 * - **可编辑性** = 「本人 star 了这个仓库」——逐仓库事实；
 * - **可见性** = 「数据还在」——活区（`stars_tags_*` / `stars_notes_*`）**或** 24h 宽限期备份
 *   （`stars_pending_delete` 的 `_tags` / `_note`）。
 *
 * ## 三态
 *
 * | 状态 | 含义 | 数据来源 | 编辑控件 |
 * |---|---|---|---|
 * | `editable` | 本人已 star | 活区 | 有（+ / × / textarea） |
 * | `locked-pending` | 已 unstar，但仍在 24h 宽限期内 | 宽限期备份 | 无（用户裁定：**仍显示**其标签与备注） |
 * | `locked-empty` | 两者都不是 | 活区（通常为空；导入的标签可能落在这里） | 无 |
 *
 * ## 纪律
 *
 * - **纯判定**：不碰 DOM、不发请求、**不写存储**（只读 `gmGet`）。渲染在 `cardAreas.ts`。
 * - **本人整表缓存由调用方一次读好后传入**（`viewerCache`），避免逐卡重复读盘（`loadRepoCache()`
 *   是一次 `gmGet` 深拷贝，逐卡调用仍会重复读盘）。4.16.0 起 `loadRepoCache()` 是纯读（不再遍历全表、不再回写）。
 * - `viewerCache === null` = 不可用（从无整表缓存 / 取不到登录者身份）⇒ **一律不可编辑**，
 *   与 `filters.renderBrowsePage` 既有的「宁缺勿假」口径同源（`canShowStar`）。
 * - 宽限期判据**渲染时现算**，不依赖 `cleanupExpiredUnstarred()` 是否跑过（它只在 `init()` 与
 *   导入后各跑一次；一个开着超过 24h 的标签页里，过期条目会一直挂在存储里）。
 */

import { hasApiData, loadRepoCache } from './storage/repoCache';
import { getPendingInGrace } from './storage/pendingDelete';
import { getNote } from './storage/notes';
import { getTags } from './storage/tags';
import { getViewerId } from './pageScope';
import { getViewStarOverride } from './viewContext';
import type { RepoCache } from './types';

/** 卡片的标签/备注呈现状态（逐仓库） */
type CardState = 'editable' | 'locked-pending' | 'locked-empty';

/** 卡片的标签/备注展示数据 + 由哪条判据得出 */
interface CardDisplayData {
  state: CardState;
  tags: string[];
  note: string;
}

/**
 * 读一次「本人整表缓存」，作为本次渲染的成员关系依据。
 *
 * 返回 `null` = **不可用**，两个必要条件缺一不可（与 `filters.renderBrowsePage` 既有口径一致）：
 * ① 完整整表同步过（`hasApiData()`）；② 有登录者身份（`octolytics-actor-id`）——
 * 未登录访客没有「我」，缓存可能还是上一个会话/账号的。
 */
export function loadViewerCacheForView(): RepoCache | null {
  if (!hasApiData() || !hasViewerIdentity()) return null;
  return loadRepoCache();
}

/**
 * 本人是否 star 了它。
 *
 * 顺序**不可颠倒**：内存覆盖表（`viewContext` 的 `starOverrides`，只在本页写入**成功**后写入）
 * 优先于整表缓存的成员关系 —— 他人页上「给一个自己没 star 过的仓库加星」不会进整表缓存。
 *
 * 只认「已提交」状态：**不**读星按钮的 DOM class、**不**读在途请求。乐观翻转与「排队中撤销」
 * 都不改变可编辑性，否则写失败回滚后会留下「星星已回退、标签却已改过」的不一致。
 */
export function isStarredByViewer(repoId: string, viewerCache: RepoCache | null): boolean {
  const override = getViewStarOverride(repoId);
  if (override !== undefined) return override;
  return !!viewerCache?.[repoId];
}

/**
 * 有登录者身份（页面上的 `octolytics-actor-id`）？
 *
 * 它是**只读展示**与**宽限期备份**的共同前提，也是本模块唯一一处身份判据。
 * 注意它与 `stars_tags_*` / `stars_notes_*` 的**命名空间隔离**（D27）不是同一件事：
 * 那两个键按登录者 id 分片，未登录时天然读空；而 `stars_pending_delete` 是**单份全局键**
 * （不按账号分片）—— 未登录访客若照常查它，看到的就是**上一个登录者**的私密标签与备注。
 * D26 明文要求登出页「无徽章（命名空间为空，不是读错别人的）」⇒ 没有登录者身份时
 * 宽限期备份一律不看（判 `locked-empty`）。
 */
function hasViewerIdentity(): boolean {
  return !!getViewerId();
}

/** 逐仓库三态判定 */
export function getCardState(repoId: string, viewerCache: RepoCache | null, now = Date.now()): CardState {
  if (viewerCache && isStarredByViewer(repoId, viewerCache)) return 'editable';
  if (!hasViewerIdentity()) return 'locked-empty';
  return getPendingInGrace(repoId, now) ? 'locked-pending' : 'locked-empty';
}

/**
 * 卡片的标签/备注展示数据：**活区优先，活区为空再看宽限期备份**。
 *
 * 两者不会同时有值：`pendingDelete.markRepoUnstarred()` 把数据搬进备份的同时清空活区
 * （`saveTags(repoId, [])` / `saveNote(repoId, '')`），`markRepoStarred()` 则反向还原。
 * 活区优先只是为了兜住「导入的标签落在了一个既没 star、也没备份的仓库上」这类边角 ——
 * 那种仓库属 `locked-empty`，但数据确实存在，仍应只读展示。
 */
export function readCardDisplayData(
  repoId: string,
  viewerCache: RepoCache | null,
  now = Date.now(),
): CardDisplayData {
  const state = getCardState(repoId, viewerCache, now);
  const tags = getTags(repoId);
  const note = getNote(repoId);
  if (tags.length > 0 || note) return { state, tags, note };

  // 宽限期备份是**单份全局键**、不按账号分片 ⇒ 只在有登录者身份时才看它（理由见 hasViewerIdentity）
  const grace = hasViewerIdentity() ? getPendingInGrace(repoId, now) : null;
  if (grace) return { state, tags: grace._tags || [], note: grace._note || '' };
  return { state, tags, note };
}
