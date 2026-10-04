/**
 * 卡片「标签 / 备注」两个区域的**唯一渲染分派点**（4.14.0）。
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
 * - `'own'`：本方自己的 stars 页。**永远可编辑**，并且不查任何逐仓库状态 —— 与 4.13.0 的行为
 *   逐字相同（包括不写 `data-gsm-card-state`，避免给自己的页引入无谓的 DOM 变化）。
 * - `'other'`：他人的 stars 页。逐仓库三态（见 `cardState.ts`），可编辑性取决于「本人是否 star」。
 *
 * @param view 视图类型
 * @param viewerCache `'other'` 视图的成员关系依据（**调用方一次读好**，避免逐卡读盘）。
 *   `null` = 不可用（无整表缓存 / 未登录）⇒ 全部卡片只读。
 */
import { readCardDisplayData } from './cardState';
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

  // 本方自己的页：逐字沿用既有行为，不查状态、不写状态标记
  if (view === 'own') {
    if (tagsContainer) renderTags(tagsContainer);
    if (notesContainer) renderNotes(notesContainer);
    return;
  }

  const repoId = card.dataset.repoId || '';
  if (!repoId) return;

  // 焦点回收：只在「焦点确实落在本卡片内」时才接管。
  // 最常见路径（点卡片上的星按钮）不会丢焦点 —— 星按钮不消失，故这条几乎总是空操作；
  // 它兜的是「后台同步判定外部取关时，用户正聚焦在本卡片的标签输入框 / 备注 textarea 上」：
  // 控件连同内容被重绘掉，浏览器实测会一律把焦点回退到 <body>，键盘用户就此丢掉位置。
  const hadFocus = card.contains(document.activeElement);

  const { state, tags, note } = readCardDisplayData(repoId, viewerCache);
  const title = state === 'locked-pending' ? CARDS_TITLE_PENDING : CARDS_TITLE_LOCKED;

  if (tagsContainer) {
    tagsContainer.dataset[STATE_ATTR] = state;
    if (state === 'editable') {
      // 他人页传 filterToggle: false —— 点标签不切换筛选、保存后不调 applyFilters（见 TagRenderOptions）
      renderTags(tagsContainer, { filterToggle: false });
    } else {
      renderTagsReadOnly(tagsContainer, tags, title);
    }
  }
  if (notesContainer) {
    notesContainer.dataset[STATE_ATTR] = state;
    // 备注的编辑入口是**挂在容器本身**上的 click 监听（见 `ui/notes.disposeNotesEditor` 的注释），
    // 而容器节点在重绘之间是**复用**的：`renderNotesReadOnly()` 的 `innerHTML = ''` 摘不掉它。
    // 不显式摘 ⇒ 「只读」卡片点一下照样弹出 textarea、blur 后真的写盘，随后又被只读渲染覆盖
    // （用户输入被静默吞掉）。这是 4.14.0 发布前审查抓到的 P1。
    // 可编辑分支也先摘：`renderNotes` 自己也会摘，这里调一次是幂等的，但**不能只依赖它** ——
    // 若将来有人改掉 `renderNotes` 的内部实现，这道门仍在唯一分派点上。
    disposeNotesEditor(notesContainer);
    if (state === 'editable') {
      renderNotes(notesContainer);
    } else {
      renderNotesReadOnly(notesContainer, note, title);
    }
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
