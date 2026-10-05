/**
 * 卡片标签/备注的**可编辑性 / 可见性判定层**（4.14.0；4.16.2 起也服务本人 stars 页）。
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
 * - **可编辑性** = 逐仓库事实（他人页用「本人是否 star」判；本人页只判「是否命中 24h 宽限期」）；
 * - **可见性** = 「数据还在」——活区（`stars_tags_*` / `stars_notes_*`）**或** 24h 宽限期备份
 *   （`stars_pending_delete` 的 `_tags` / `_note`）。
 *
 * ## 态
 *
 * | 状态 | 含义 | 数据来源 | 编辑控件 |
 * |---|---|---|---|
 * | `editable` | 他人页：本人已 star；本人页：未命中宽限期 | 活区 | 有（+ / × / textarea） |
 * | `locked-pending` | 已 unstar，但仍在 24h 宽限期内 | 宽限期备份 | 无（用户裁定：**仍显示**其标签与备注） |
 * | `locked-empty` | 两者都不是（**只有他人页会产出**） | 活区（通常为空；导入的标签可能落在这里） | 无 |
 *
 * ## 本方自己的页（4.16.2）
 *
 * 本人页只走**二态**：命中 24h 宽限期备份 ⇒ `locked-pending`（只读，但仍显示备份里的标签与备注）；
 * 其余一律 `editable`（与 4.13.0 起的既有行为逐字相同）。**刻意不引入 `locked-empty`**：
 *
 * ① 那一支要拿整表缓存判成员关系，链路依赖**无官方契约**的页面 meta `octolytics-actor-id`
 *    （`loadViewerCacheForView`；同类前例：`csrf-token` 曾普遍存在、如今完全消失，见 AGENTS.md 已知风险 13）
 *    —— meta 一旦改名或消失，本人页**全部卡片**会失去编辑能力（加不了标签、写不了备注），
 *    那是比本模块要修的缺陷严重得多的回归；
 * ② 本人页的卡片只来自本人整表缓存（`filters.queryRepos` 的 own 路径），而 unstar 时该仓库已被移出缓存
 *    ⇒ 「没 star 却有标签」的卡片**从不进入网格**，给它造只读态是空转。
 *
 * ## 纪律
 *
 * - **纯判定**：不碰 DOM、不发请求、**不写存储**（只读 `gmGet`）。渲染在 `cardAreas.ts`。
 * - **他人页的整表缓存由调用方一次读好后传入**（`viewerCache`），避免逐卡重复读盘（`loadRepoCache()`
 *   是一次 `gmGet` 深拷贝，逐卡调用仍会重复读盘）。4.16.0 起 `loadRepoCache()` 是纯读（不再遍历全表、不再回写）。
 * - `viewerCache === null` = 不可用（从无整表缓存 / 取不到登录者身份）⇒ **一律不可编辑**，
 *   与 `filters.renderBrowsePage` 既有的「宁缺勿假」口径同源（`canShowStar`）。
 * - 宽限期判据**渲染时现算**，不依赖 `cleanupExpiredUnstarred()` 是否跑过（它只在 `ensureStarsSetup()`
 *   与仓库详情页两处跑；一个开着超过 24h 的标签页里，过期条目会一直挂在存储里）。
 */

import { hasApiData, loadRepoCache } from './storage/repoCache';
import { getPendingInGrace } from './storage/pendingDelete';
import { getNote } from './storage/notes';
import { getTags } from './storage/tags';
import { getViewerId } from './pageScope';
import { getViewStarOverride } from './viewContext';
import type { RepoCache } from './types';

/** 卡片在**他人页**的呈现状态（逐仓库三态） */
type CardState = 'editable' | 'locked-pending' | 'locked-empty';

/**
 * 卡片在**本人页**的呈现状态：只可能是这两态。
 *
 * 收窄到**类型层**而不只是注释 —— 本人页永不产出 `locked-empty`（见文件头「本方自己的页」），
 * 让编译器替我们守住这条，比靠注释提醒可靠。
 */
type OwnCardState = 'editable' | 'locked-pending';

/** 卡片的标签/备注展示数据（`state` 由调用方持有 —— 它拿它选渲染器，取数这里不需要它） */
interface CardDisplayData {
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

/**
 * **他人页**：逐仓库三态判定。
 *
 * `viewerCache === null`（无整表缓存 / 无登录者身份）时**永不返回 `editable`** —— 宁缺勿假。
 * 本人页不要用它（那会让本人页整页只读，理由见文件头的「本方自己的页」）。
 */
export function getCardState(repoId: string, viewerCache: RepoCache | null, now = Date.now()): CardState {
  if (viewerCache && isStarredByViewer(repoId, viewerCache)) return 'editable';
  if (!hasViewerIdentity()) return 'locked-empty';
  return getPendingInGrace(repoId, now) ? 'locked-pending' : 'locked-empty';
}

/**
 * **本人页**：逐仓库二态判定（4.16.2）。
 *
 * 只问一件事：「这个仓库是不是刚被取消 star、数据还在 24h 宽限期备份里？」
 * - 命中 ⇒ `locked-pending`（只读，但仍显示备份里的标签与备注）；
 * - 其余 ⇒ `editable`（今天的行为，含「活区里有数据」「活区为空」「取不到登录者身份」三种情形）。
 *
 * 判据与 `getCardState` 共用 `getPendingInGrace()`（渲染时现算、不信「pending 里有没有」），
 * 但**不读** `viewerCache`、**不读**整表缓存成员关系 —— 理由见文件头。
 * 没有登录者身份时直接返回 `editable`：宽限期备份是全局单键，那时读它看到的是别人的数据。
 */
export function getOwnPageCardState(repoId: string, now = Date.now()): OwnCardState {
  if (!hasViewerIdentity()) return 'editable';
  return getPendingInGrace(repoId, now) ? 'locked-pending' : 'editable';
}

/**
 * 卡片的标签/备注展示数据：**活区优先，活区为空再看宽限期备份**。
 *
 * `state` 由**调用方算好后传入**（4.16.2 起）：两个视图的判定不同（见上面两个函数），
 * 取数却是同一件事 —— 让本函数自己算会逼着它认识 `view`，或者逼着两个调用方各写一份取数。
 *
 * 两者不会同时有值：`pendingDelete.markRepoUnstarred()` 把数据搬进备份的同时清空活区
 * （`saveTags(repoId, [])` / `saveNote(repoId, '')`），`markRepoStarred()` 则反向还原。
 * 活区优先只是为了兜住「导入的标签落在了一个既没 star、也没备份的仓库上」这类边角 ——
 * 那种仓库属 `locked-empty`（仅他人页会产出），但数据确实存在，仍应只读展示。
 *
 * **行为不变式**：`editable` 时活区为空就返回空，**不许**去读备份 ——
 * 本页从没 unstar 过的仓库若恰好撞上同一 repoId 的一条陈旧 pending 条目，
 * 会凭空显示一份不属于它的数据。这是本人页与「他人页只读显示」最容易混淆的一处。
 */
export function readCardDisplayData(
  repoId: string,
  state: CardState,
  now = Date.now(),
): CardDisplayData {
  const tags = getTags(repoId);
  const note = getNote(repoId);
  if (tags.length > 0 || note) return { tags, note };

  // 宽限期备份是**单份全局键**、不按账号分片 ⇒ 只在有登录者身份、且确实处于只读态时才看它
  const grace = state !== 'editable' && hasViewerIdentity() ? getPendingInGrace(repoId, now) : null;
  if (grace) return { tags: grace._tags || [], note: grace._note || '' };
  return { tags, note };
}
