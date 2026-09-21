import { getNote, saveNote } from '../storage/notes';

/** 渲染卡片备注区，并绑定点击进入编辑态 */
export function renderNotes(notesContainer: HTMLElement): void {
  const repoId = notesContainer.dataset.repoId || '';
  if (!repoId) return;

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

  notesContainer.addEventListener('click', function onEdit(e) {
    e.stopPropagation();
    if (notesContainer.querySelector('.stars-card-notes-edit')) return;

    notesContainer.removeEventListener('click', onEdit);
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
  });
}
