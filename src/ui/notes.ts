import { getNote, saveNote } from '../storage/notes';

/**
 * 备注容器上「点一下进编辑态」的那枚监听（每个容器至多一枚）。
 *
 * 为什么要记下来（4.14.0 修 P1）：监听挂在**容器本身**上（不是它的子节点），而容器的 DOM 节点
 * 会被复用 —— 同一张卡片重绘时是 `innerHTML = ''` 换内容，容器还是那一个。
 * ⇒ ① 反复重绘会在同一个容器上**叠加**监听（旧行为，自己的页上一直如此）；
 *   ② 更要命的是**从可编辑切到只读**时（他人页点 unstar / 同步判定外部取关），
 *   `renderNotesReadOnly()` 只清 `innerHTML`，**摘不掉容器上的监听** ⇒ 被宣称为「只读」的卡片
 *   点一下照样弹出 textarea，blur 后**真的写盘**，而随后的重绘又只按只读渲染 ⇒
 *   用户输入被静默吞掉（re-star 时还会被宽限期备份覆盖）。
 *
 * 与 `ui/tagFilter.ts` 的 `renderTags` 对比：那边的监听都挂在**子节点**上，
 * `innerHTML = ''` 一并销毁 ⇒ 没有这个问题。备注这里挂容器的原因是可以点整片区域进编辑态
 * （容器有 `min-height` 与 `padding-top`，只挂文本子节点会让可点区域缩水）。
 */
const editBindings = new WeakMap<HTMLElement, (e: MouseEvent) => void>();

/**
 * 摘掉容器上那枚「点一下进编辑态」的监听（幂等）。
 *
 * `cardAreas.renderCardTagAndNoteAreas()` 在**每次**渲染前都先调它，于是：
 * 「可编辑 → 只读」「只读 → 可编辑」「可编辑 → 可编辑」三条路径都不会留下旧监听。
 * 不走 `lifecycle` 作用域：它挂在卡片自有的容器上，随卡片节点一起销毁，
 * 不需要也不可能由 `viewTeardown` 统一回滚（那时节点已经不在了）。
 */
export function disposeNotesEditor(notesContainer: HTMLElement): void {
  const bound = editBindings.get(notesContainer);
  if (!bound) return;
  notesContainer.removeEventListener('click', bound);
  editBindings.delete(notesContainer);
}

/** 渲染卡片备注区，并绑定点击进入编辑态 */
export function renderNotes(notesContainer: HTMLElement): void {
  const repoId = notesContainer.dataset.repoId || '';
  if (!repoId) return;

  // 先摘旧监听：本函数可能被反复调用（星标变更、标签保存后的整页重绘、同步后重绘），
  // 不摘就会在同一个容器上叠出多枚一模一样的监听。
  disposeNotesEditor(notesContainer);

  const note = getNote(repoId);
  notesContainer.innerHTML = '';

  if (note) {
    const textEl = document.createElement('div');
    textEl.className = 'stars-card-notes-text';
    textEl.textContent = note;
    notesContainer.appendChild(textEl);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'stars-card-notes-placeholder';
    placeholder.textContent = '添加备注…';
    notesContainer.appendChild(placeholder);
  }

  const onEdit = (e: MouseEvent): void => {
    e.stopPropagation();
    if (notesContainer.querySelector('.stars-card-notes-edit')) return;

    // 自己的编辑态：先把入口摘掉，编辑期间再点容器不重复进入
    // （注意这里只摘监听、保留 WeakMap 语义，退出编辑态时 renderNotes 会重新绑）
    notesContainer.removeEventListener('click', onEdit);
    if (editBindings.get(notesContainer) === onEdit) editBindings.delete(notesContainer);
    notesContainer.innerHTML = '';

    const textarea = document.createElement('textarea');
    textarea.className = 'stars-card-notes-edit';
    textarea.value = getNote(repoId);
    textarea.placeholder = '输入备注…';
    notesContainer.appendChild(textarea);
    textarea.focus();

    let cancelled = false;

    function commit() {
      if (cancelled) return;
      const val = textarea.value.trim();
      saveNote(repoId, val);
      renderNotes(notesContainer);
    }

    textarea.addEventListener('blur', () => commit());
    textarea.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { cancelled = true; renderNotes(notesContainer); }
    });
  };

  notesContainer.addEventListener('click', onEdit);
  editBindings.set(notesContainer, onEdit);
}
