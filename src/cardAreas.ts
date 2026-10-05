/**
 * 卡片「标签 / 备注」两个区域的**唯一渲染分派点**（4.14.0；4.16.2 起本人页也有只读分支）。
 *
 * ## 为什么必须只有一处
 *
 * 4.13.0 的分派是两处各写一遍：
 *
 * - `filters.renderBrowsePage` 的三元式 `readOnly ? renderTagsReadOnly : renderTags`（这一处是对的）；
 * - `starCheck.syncCardAfterStarChange` **无条件**调 `renderTags` / `renderNotes`（这一处没有判据）。
 *
 * 于是「在他人页点一下 star」→ 成功回调 → `syncCardAfterStarChange` → 标签/备注被换成**可编辑**控件。
 * 两处判据不一致就是缺陷本身。现在只有一个入口，任何重绘路径都必须经过它。
 *
 * ## 两种视图
 *
 * - `'own'`：本方自己的 stars 页。**默认可编辑**（与 4.13.0 起的既有行为逐字相同）；唯一的例外是
 *   「本人取消过 star、但标签/备注仍在 24h 宽限期备份里」的卡片（4.16.2）—— 那类卡片只读，
 *   且**数据来自备份**：活区此刻已被 `markRepoUnstarred` 清空，只读活区就会显示成空，
 *   也就是用户报的「本人页 unstar 后标签和备注直接消失」（他人页同场景一直正常，因为它读备份）。
 * - `'other'`：他人的 stars 页。逐仓库三态（见 `cardState.ts`），可编辑性取决于「本人是否 star」。
 *
 * 判定**不在这里就地写**：两个视图的判据都住 `cardState.ts`（`getOwnPageCardState` /
 * `getCardState`），本模块只做「判定结果 → 渲染器」的分派。判据一分为二就是 4.13.0 那个缺陷的成因。
 *
 * @param view 视图类型
 * @param viewerCache `'other'` 视图的成员关系依据（**调用方一次读好**，避免逐卡读盘）。
 *   `null` = 不可用（无整表缓存 / 未登录）⇒ 全部卡片只读。`'own'` 视图不用这个参数。
 */
import { getCardState, getOwnPageCardState, readCardDisplayData } from './cardState';
import { CARDS_TITLE_LOCKED, CARDS_TITLE_PENDING, renderNotesReadOnly, renderTagsReadOnly } from './readonly';
import { disposeNotesEditor, renderNotes } from './ui/notes';
import { renderTags } from './ui/tagFilter';
import type { RepoCache } from './types';

/** 卡片区域容器的选择器（`ui/cards.buildCardFromCache` 建的） */
const TAGS_SELECTOR = '.stars-card-tags';
const NOTES_SELECTOR = '.stars-card-notes';

/** 状态身份属性：挂在两个区域容器上，供夹具断言与排查用；不参与样式、随节点一起销毁 */
const STATE_ATTR = 'gsmCardState';

type CardAreaView = 'own' | 'other';

export function renderCardTagAndNoteAreas(
  card: HTMLElement,
  view: CardAreaView,
  viewerCache: RepoCache | null = null,
): void {
  const tagsContainer = card.querySelector<HTMLElement>(TAGS_SELECTOR);
  const notesContainer = card.querySelector<HTMLElement>(NOTES_SELECTOR);
  if (!tagsContainer && !notesContainer) return;

  const repoId = card.dataset.repoId || '';
  // 他人页没有 repoId 就无从判定（也不该拿「页面上没写 id」的卡片去猜成员关系）
  if (!repoId && view === 'other') return;

  const state = repoId
    ? view === 'own'
      ? getOwnPageCardState(repoId)
      : getCardState(repoId, viewerCache)
    : 'editable';
  // 状态身份属性：两个区域容器都写，**可编辑态也写** —— 4.14.0 起他人页就是这么做的
  // （夹具与断言按它读可编辑/只读，例如 R2_editableCards / R16_betaAreaAfterStar）。
  // 4.16.2 起本人页也写：本人页的 pending 卡片唯一可辨的痕迹就是它（见 base.css 的 cursor 规则）。
  if (tagsContainer) tagsContainer.dataset[STATE_ATTR] = state;
  if (notesContainer) notesContainer.dataset[STATE_ATTR] = state;
  // 可编辑：常态路径（本人页的绝大多数卡片、他人页本人已 star 的卡片）
  if (state === 'editable') {
    if (tagsContainer) {
      // 他人页传 filterToggle: false —— 点标签不切换筛选、保存后不调 applyFilters（见 TagRenderOptions）。
      // 本人页保持 true（逐字沿用既有行为：点标签=筛选、保存后刷新候选）。
      renderTags(tagsContainer, { filterToggle: view === 'own' });
    }
    if (notesContainer) {
      // 备注的编辑入口是**挂在容器本身**上的 click 监听（见 `ui/notes.disposeNotesEditor` 的注释），
      // 而容器节点在重绘之间是**复用**的。`renderNotes` 自己也会摘，这里调一次是幂等的，
      // 但**不能只依赖它** —— 若将来有人改掉 `renderNotes` 的内部实现，这道门仍在唯一分派点上。
      disposeNotesEditor(notesContainer);
      renderNotes(notesContainer);
    }
    return;
  }

  // 不可编辑（locked-pending / locked-empty）：只读渲染，数据由 `cardState` 取好传入
  // （宽限期卡片的标签/备注在备份里，活区已被清空 —— 渲染器自己去读活区就会显示成空）。
  //
  // 焦点回收：只在「焦点确实落在本卡片内」时才接管。
  // 最常见路径（点卡片上的星按钮）不会丢焦点 —— 星按钮不消失，故这条几乎总是空操作；
  // 它兜的是「后台同步判定外部取关时，用户正聚焦在本卡片的标签输入框 / 备注 textarea 上」：
  // 控件连同内容被重绘掉，浏览器实测会一律把焦点回退到 <body>，键盘用户就此丢掉位置。
  const hadFocus = card.contains(document.activeElement);

  const { tags, note } = readCardDisplayData(repoId, state);
  const title = state === 'locked-pending' ? CARDS_TITLE_PENDING : CARDS_TITLE_LOCKED;

  if (tagsContainer) {
    renderTagsReadOnly(tagsContainer, tags, title);
  }
  if (notesContainer) {
    // 只读卡片点一下**不能**还能进编辑态：容器在重绘间复用，`innerHTML = ''` 摘不掉那枚监听，
    // 不显式摘 ⇒ 被宣称为「只读」的卡片点一下照样弹 textarea、blur 后真的写盘，随后又被只读渲染覆盖
    // （用户输入被静默吞掉）。这是 4.14.0 发布前审查抓到的 P1。
    disposeNotesEditor(notesContainer);
    renderNotesReadOnly(notesContainer, note, title);
  }

  if (hadFocus) {
    const btn = card.querySelector<HTMLElement>('.stars-star-btn');
    if (btn) {
      btn.focus({ preventScroll: true });
    } else {
      if (!card.hasAttribute('tabindex')) card.tabIndex = -1;
      card.focus({ preventScroll: true });
    }
  }
}
