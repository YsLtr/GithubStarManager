// 卡片内联编辑会话的探针与「外部取关时的草稿托管」（D36）。
//
// 为什么单独成一个模块：判据被两处共用 —— 重绘挂起门（`filters.ts` 的 `deferApply`）与
// 单卡重绘（`starCheck.ts` 的 `syncCardAfterStarChange`）。两处各写一遍选择器就是
// 「同一概念两处实现、判据漂移」，D29 那个缺陷正是这么来的。
//
// 第二个职责（4.20.1）：判断「这次 blur 是不是用户的意思」。脚本自己清空容器时也会让聚焦的编辑器
// 失焦，而那是重绘副作用 ⇒ 由 `suppressInlineCommit()` 标出来，否则草稿会被写回活区、只读卡片还能
// 再点开编辑框（见该函数的注释）。
//
// 为什么判据是「节点在 DOM 里」而不是「节点有焦点」：这两个编辑器都是**按需节点** ——
// 点开才存在，提交 / 取消即被移除（`ui/notes.ts` 的 textarea、`ui/tagFilter.ts` 的 input），
// 所以「存在」≡「有未提交的草稿」。反过来用 `document.activeElement` 会漏掉一种真实情形：
// 窗口失焦（切到别的应用）后节点与草稿都还在，activeElement 却已经不是它了。
//
// 刻意**不**把分页器的页码输入框算进来：它随 `.paginate-container.gsm-local-pager` 被移进
// 分片、重绘后原样带回（`renderBrowsePage` 的 bottomPager 搬移），本就不会被销毁；
// 把它算进来只会让「在第 N 页跳页时恰好有一次同步回来」变成无谓的挂起。

import { loadPendingDelete, savePendingDelete } from './storage/pendingDelete';

const INLINE_EDIT_SELECTOR = '.stars-card-notes-edit, .stars-tag-input';

/**
 * 页面上是否还有打开着的标签输入框 / 备注编辑框。
 * @param root 限定搜索范围（单卡重绘只关心这一张卡）
 */
export function hasInlineEditor(root: ParentNode = document): boolean {
  return root.querySelector(INLINE_EDIT_SELECTOR) !== null;
}

/**
 * 「脚本自己发起的重绘」期间抑制编辑器的提交。
 *
 * 为什么需要它（4.20.1，实测）：Chromium 在把聚焦元素**摘出 DOM 之前**就派发 `blur` —— blur 派发
 * 那一刻 `isConnected` 仍为 `true`、`parentNode` 还在、`document.contains()` 也 true（夹具实测三次都一样）。
 * 所以「节点已离场 ⇒ 不提交」这条守卫**挡不住**「脚本重绘摘掉编辑器」这件事：编辑器会把这次 blur
 * 当成用户提交，于是
 *   ① 草稿被写回**活区**（外部取关后活区该是空的，写进去的就是谁也读不到的孤儿数据）；
 *   ② `commit` 里的 `renderNotes()` 又把「点击进编辑」的监听重新绑上 —— 只读卡片跟着又能点开编辑框
 *      （用户报的「unstar 后还能在只读卡片上写字」就是这个）。
 *
 * 判据不能是节点状态，只能是「这次重绘是谁发起的」：渲染器清空容器时把自己包进本函数，
 * 由此产生的 blur 一律不算提交。
 *
 * 注意与 `commitInlineEditors()` 的区别：那是**要**提交（节点马上被删，没有第二次机会），
 * 所以它不做抑制。
 */
let suppressDepth = 0;

/** 当前是否处于「脚本重绘中，blur 不算用户提交」 */
export function isInlineCommitSuppressed(): boolean {
  return suppressDepth > 0;
}

/** 把一次脚本发起的容器清空包起来（同步函数，内部 blur 视为重绘副作用） */
export function suppressInlineCommit<T>(fn: () => T): T {
  suppressDepth++;
  try {
    return fn();
  } finally {
    suppressDepth--;
  }
}

/* ================================================================
 * 「按下到松开之间不许改 DOM」：编辑器收尾排到这次手势之后（4.21.0）
 *
 * ## 缺陷（夹具 trusted click 实测，2026-10-27）
 *
 * 编辑框里打了字，直接点**另一处**（另一张卡的备注、另一张卡的「+」、某个标签胶囊）：那一击被
 * 吃掉，效果等同点了空白 —— 只有 tag/备注生效。事件顺序（`.diag` 里的 `__evlog` 原文）：
 *
 *   pointerdown → mousedown(card2 .stars-card-notes-text) → blur(card1 .stars-tag-input)
 *   → [commit：同步 saveTags + renderTags + applyFilters → renderBrowsePage → replaceChildren]
 *   → pointerup → mouseup → **一条 click 都没有**
 *
 * `click` 的目标按规范是「mousedown 与 mouseup 目标的最近公共祖先」；commit 在按下与松开之间把
 * 整张网格换掉，mousedown 的目标节点已不在文档里 ⇒ 公共祖先为空，Chrome 干脆不派发 click。
 * 备注编辑框还有第二重：它 `min-height: 40px`，退出编辑态时卡片高度缩回（实测 208→183），
 * mouseup 便落在**另一个**元素上，click 被重定向到两者共同的祖先，目标处理器同样收不到。
 *
 * 反证：点上方筛选栏是好的 —— 那一排在 `.stars-grid-container` **之外**，网格换掉它还在。
 *
 * ## 所以：数据同步落盘，改 DOM 的部分推迟到手势之后
 *
 * 落盘不能推（这一下点击可能立刻导航走），所以 `saveTags` / `saveNote` 仍在 blur 里同步做；
 * 只把**拆编辑框 / 重画区域 / 重跑筛选**排到 pointerup 之后的一拍 —— 那一拍在 click 派发之后。
 * 没有按住指针时（Tab 失焦、脚本自己 `blur()`）立即执行，与 4.20.1 的行为一致。
 *
 * 已知代价：按住不放期间编辑框仍在屏上（无光标），松手后一拍才收尾。人手按住通常 <1s。
 * ================================================================ */

let pressInFlight = false;
let pressTrackingArmed = false;
/** 排在「这次手势之后」的收尾动作 */
let afterPress: Array<() => void> = [];
/** 「编辑器会话结束了」的通知：重绘挂起门靠它补跑（见 filters.ts）。**只有这一个**订阅者。 */
let settledHandler: (() => void) | null = null;

function onPressDown(): void {
  pressInFlight = true;
}

/**
 * 松手 / 取消 / 窗口失焦：标记复位并兑现排队的收尾。
 *
 * 必须再等一拍（`setTimeout 0`）才动 DOM：`click` 在 mouseup 之后、同一轮事件里派发，
 * 指针一松就拆节点等于又把 click 的目标换掉。
 */
function onPressEnd(): void {
  pressInFlight = false;
  if (afterPress.length === 0) return;
  const queued = afterPress;
  afterPress = [];
  window.setTimeout(() => {
    for (const fn of queued) fn();
  }, 0);
}

/**
 * 开始监听「指针按着没有」。**在编辑框被创建时调**（那时才第一次可能出现「按着的同时失焦」），
 * 不在模块加载时挂 —— 窄视口下脚本必须一行都不碰页面（D18）。幂等：挂一次，到视图销毁才摘。
 */
export function armPressTracking(): void {
  if (pressTrackingArmed) return;
  pressTrackingArmed = true;
  document.addEventListener('pointerdown', onPressDown, true);
  window.addEventListener('pointerup', onPressEnd, true);
  window.addEventListener('pointercancel', onPressEnd, true);
  // 在窗口外松开时页面收不到 pointerup（鼠标没有隐式指针捕获），只能靠窗口失焦兜；
  // 标志卡在 true 会让此后每次编辑器收尾都排进「等松手」而永不兑现。
  window.addEventListener('blur', onPressEnd);
}

/** 此刻是否按着指针（重绘挂起门用它决定「现在能不能换 DOM」） */
export function isPressInFlight(): boolean {
  return pressInFlight;
}

/**
 * 视图销毁时撤掉按压跟踪（D18：脚本撤场后不再碰页面）。两个回滚点各调一次。
 *
 * 必须连状态一起复位：监听没了就再没人来放掉这个标志，留一个 `true` 会让**此后每次**重绘都被
 * 判成「用户还按着鼠标」，挂起重绘就永远不兑现了（网格停在旧画面）。
 */
export function disarmPressTracking(): void {
  if (!pressTrackingArmed) return;
  pressTrackingArmed = false;
  document.removeEventListener('pointerdown', onPressDown, true);
  window.removeEventListener('pointerup', onPressEnd, true);
  window.removeEventListener('pointercancel', onPressEnd, true);
  window.removeEventListener('blur', onPressEnd);
  pressInFlight = false;
  // 排队的收尾就地跑掉而不是丢弃：它们只做「拆编辑框 / 重画本卡区域」这类 DOM 收尾，
  // 调用方随后会整棵拆掉视图，跑一遍是幂等的；丢掉则会在自己的注释里留下「草稿收尾会执行」
  // 的反面事实（谁来读都会以为它已经执行过）。
  const queued = afterPress;
  afterPress = [];
  for (const fn of queued) fn();
}

/** 订阅「编辑器会话结束」（挂起门在里面排一次补跑）。只有一个订阅者，所以只存一个。 */
export function onInlineEditSettled(cb: () => void): void {
  settledHandler = cb;
}

/**
 * 编辑器的 DOM 收尾：没按着指针就立刻做；按着就排到这次手势之后（见本节长注释）。
 * 收尾跑完通知订阅者 —— 挂起重绘可能正因为这个编辑器而挂着。
 */
export function finishInlineEdit(teardown: () => void): void {
  const run = (): void => {
    teardown();
    settledHandler?.();
  };
  if (!pressInFlight) {
    run();
    return;
  }
  afterPress.push(run);
}

/**
 * 视图即将销毁（跨断点收窄 / 离开 Stars / 退出他人页）时，把还开着的编辑器**按失焦语义提交**。
 *
 * 为什么必须显式做：挂起重绘（`filters.ts` 的 `deferApply`）只保住「重绘」这一路；这些路径
 * 是直接删节点，编辑器随卡片一起没。删节点时 blur 会不会派发、派发时节点还在不在文档里，
 * **不同引擎不一致**（Chromium 实测：在摘除**之前**派发，`isConnected` 仍为 true），
 * 而且那一刻视图已在半拆状态、提交处理器里的 `renderNotes()` 会往游离容器里画 ——
 * 所以不能押在引擎行为上，主动提交一次是确定的。
 *
 * 用 `blur()` 而不是自己写落盘逻辑：提交规则（trim、空值不新增、重名不重复）只有编辑器自己
 * 那一份，第二份实现必然漂移（D29 的教训）。它同时也是**唯一不做 `suppressInlineCommit` 抑制**
 * 的调用者 —— 这里要的就是提交。
 */
export function commitInlineEditors(): void {
  document.querySelectorAll<HTMLElement>(INLINE_EDIT_SELECTOR).forEach((el) => {
    el.blur();
  });
}

/**
 * 「卡片已被外部取关」时的草稿托管：把卡上还没提交的草稿**并进 24h 宽限期备份**，
 * 然后由调用方立刻把卡片刷成只读（挂起重绘在这条路径上不成立，见下）。
 *
 * 为什么必须这么做（这条路径是挂起重绘的唯一例外）：
 * 外部取关的管线已经按「本地权威 = 标签/备注」把**当时的**活区内容搬进了备份、并把活区清空
 * （`confirmExternalUnstar`）。卡片随后的状态是 `locked-pending`，读的是备份。此时若还让编辑器
 * 开着、等用户失焦再提交，那次提交会写进**活区** —— 而这条仓库此刻的数据归属在备份里，
 * 活区那份是**谁也读不到**的孤儿数据（`renderNotesReadOnly` / `renderTagsReadOnly` 只读备份），
 * 将来 re-star 时还会被 `markRepoStarred` 的备份值覆盖回去 ⇒ 用户打了字、看着它消失。
 *
 * 并进备份则是同一份数据的**更新值**（草稿一定比备份新：备份取自草稿产生之前的活区），
 * 与「blur 即提交」同义，且 re-star 时随备份一起恢复。
 *
 * 只由 `syncCardAfterStarChange` 在 `isStarred === false` 且该卡有编辑器时调用；其余情形
 * （含编辑器内的用户主动提交）一律走原路径。**前提**：调用方已保证该仓库在宽限期备份里
 * （`confirmExternalUnstar` 无条件建备份）；取不到条目 ⇒ 什么都不写，宁可让随后的只读重绘
 * 丢掉草稿，也不往不确定的位置写用户数据。
 */
export function mergeDraftIntoGraceBackup(repoId: string, card: HTMLElement): void {
  const textarea = card.querySelector<HTMLTextAreaElement>('.stars-card-notes-edit');
  const tagInput = card.querySelector<HTMLInputElement>('.stars-tag-input');
  if (!textarea && !tagInput) return;

  const pending = loadPendingDelete();
  const entry = pending[repoId];
  if (!entry) return;

  // 备注：与 `ui/notes.ts` 的 commit 同一口径（trim 后整段覆盖，空串 = 用户清空了备注）
  if (textarea) entry._note = textarea.value.trim();

  // 标签：与 `ui/tagFilter.ts` 的 commit 同一口径（trim；空值不新增；已存在不重复）
  if (tagInput) {
    const val = tagInput.value.trim();
    if (val && !(entry._tags || []).includes(val)) entry._tags = [...(entry._tags || []), val];
  }

  savePendingDelete(pending);
}
