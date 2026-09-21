import { TRIANGLE_DOWN_SVG } from '../constants';
import { filterState } from '../state';
import { applyFilters } from '../filters';
import { getAllUniqueTags, getTags, saveTags } from '../storage/tags';

/** 同步 Tags 筛选按钮的文案与高亮态 */
export function updateTagFilterButton(): void {
  const btn = document.querySelector('.stars-tag-filter .Button');
  if (!btn) return;
  const label = btn.querySelector('.Button-label');
  if (label) {
    label.textContent = filterState.tags.length > 0
      ? `Tags: ${filterState.tags.length} selected`
      : 'Tags';
  }
  btn.classList.toggle('has-active', filterState.tags.length > 0);
}

/** 渲染 Tags 多选筛选栏（原生 Popover API + ActionList 结构） */
export function renderTagFilterBar(): void {
  const toolbar = document.querySelector(
    '.Layout-main .d-flex.flex-column.flex-lg-row.flex-items-center.mt-5'
  );
  const filterRow = toolbar
    ? toolbar.querySelector('.d-flex.flex-justify-end')
    : null;
  if (!filterRow) return;

  const existing = filterRow.querySelector('.stars-tag-filter');
  if (existing) existing.remove();

  const allTags = getAllUniqueTags();
  if (allTags.length === 0 && filterState.tags.length === 0) return;

  const container = document.createElement('div');
  container.className = 'stars-tag-filter mb-1 mb-lg-0 mr-2';

  // 使用 GitHub Primer Button 结构 + popovertarget
  const btnLabel = filterState.tags.length > 0
    ? `Tags: ${filterState.tags.length} selected`
    : 'Tags';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'stars-tag-filter-button';
  btn.setAttribute('popovertarget', 'stars-tag-filter-overlay');
  btn.setAttribute('aria-controls', 'stars-tag-filter-list');
  btn.setAttribute('aria-haspopup', 'true');
  btn.className = 'Button--secondary Button--medium Button';
  if (filterState.tags.length > 0) btn.classList.add('has-active');
  btn.innerHTML =
    '<span class="Button-content"><span class="Button-label"></span></span>' +
    '<span class="Button-visual Button-trailingAction">' +
      TRIANGLE_DOWN_SVG +
    '</span>';
  const btnLabelEl = btn.querySelector('.Button-label');
  if (btnLabelEl) btnLabelEl.textContent = btnLabel;

  // anchored-position overlay (popover="auto")
  const overlay = document.createElement('anchored-position');
  overlay.id = 'stars-tag-filter-overlay';
  overlay.setAttribute('anchor', 'stars-tag-filter-button');
  overlay.setAttribute('align', 'start');
  overlay.setAttribute('side', 'outside-bottom');
  overlay.setAttribute('anchor-offset', 'normal');
  overlay.setAttribute('popover', 'auto');

  const overlayInner = document.createElement('div');
  overlayInner.className = 'Overlay Overlay--size-auto';
  const overlayBody = document.createElement('div');
  overlayBody.className = 'Overlay-body Overlay-body--paddingNone';

  // 菜单列表容器 — 使用原生 ActionList 结构
  const menuList = document.createElement('ul');
  menuList.id = 'stars-tag-filter-list';
  menuList.className = 'ActionListWrap--inset ActionListWrap';
  menuList.setAttribute('role', 'menu');

  allTags.forEach((tag) => {
    const li = document.createElement('li');
    li.className = 'ActionListItem';
    li.setAttribute('role', 'none');

    const content = document.createElement('label');
    content.className = 'ActionListContent';
    content.setAttribute('role', 'menuitemcheckbox');
    content.setAttribute('aria-checked', String(filterState.tags.includes(tag)));

    const visual = document.createElement('span');
    visual.className = 'ActionListItem-visual ActionListItem-action--leading';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = filterState.tags.includes(tag);
    visual.appendChild(cb);

    const labelSpan = document.createElement('span');
    labelSpan.className = 'ActionListItem-label';
    labelSpan.textContent = tag;

    content.appendChild(visual);
    content.appendChild(labelSpan);

    content.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const idx = filterState.tags.indexOf(tag);
      if (idx >= 0) {
        filterState.tags.splice(idx, 1);
        cb.checked = false;
        content.setAttribute('aria-checked', 'false');
      } else {
        filterState.tags.push(tag);
        cb.checked = true;
        content.setAttribute('aria-checked', 'true');
      }
      updateTagFilterButton();
      applyFilters();
      refreshTagPillStates();
    });

    li.appendChild(content);
    menuList.appendChild(li);
  });

  overlayBody.appendChild(menuList);
  overlayInner.appendChild(overlayBody);
  overlay.appendChild(overlayInner);

  container.appendChild(btn);
  container.appendChild(overlay);

  filterRow.insertBefore(container, filterRow.firstChild);
}

/** 同步卡片上标签 pill 的选中态 */
export function refreshTagPillStates(): void {
  document.querySelectorAll('.stars-card-tags .stars-tag').forEach((pill) => {
    const tagText = pill.childNodes[0]?.textContent || '';
    if (filterState.tags.includes(tagText)) {
      pill.classList.add('stars-tag-active');
    } else {
      pill.classList.remove('stars-tag-active');
    }
  });
}

/** 渲染单个卡片上的标签 pill + 内联新增输入框 */
export function renderTags(tagsContainer: HTMLElement): void {
  const repoId = tagsContainer.dataset.repoId || '';
  if (!repoId) return;

  const tags = getTags(repoId);
  tagsContainer.innerHTML = '';

  tags.forEach((tag, idx) => {
    const span = document.createElement('span');
    span.className = 'stars-tag';
    if (filterState.tags.includes(tag)) {
      span.classList.add('stars-tag-active');
    }
    span.textContent = tag;

    span.addEventListener('click', (e) => {
      e.stopPropagation();
      const fidx = filterState.tags.indexOf(tag);
      if (fidx >= 0) {
        filterState.tags.splice(fidx, 1);
      } else {
        filterState.tags.push(tag);
      }
      applyFilters();
      renderTagFilterBar();
      refreshTagPillStates();
    });

    const del = document.createElement('span');
    del.className = 'stars-tag-del';
    del.textContent = '×';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      const current = getTags(repoId);
      current.splice(idx, 1);
      saveTags(repoId, current);
      renderTags(tagsContainer);
      renderTagFilterBar();
      applyFilters();
    });

    span.appendChild(del);
    tagsContainer.appendChild(span);
  });

  const addBtn = document.createElement('span');
  addBtn.className = 'stars-tag-add';
  addBtn.title = '添加标签';
  addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (tagsContainer.querySelector('.stars-tag-input')) return;

    addBtn.style.display = 'none';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'stars-tag-input';
    input.placeholder = '标签名';
    tagsContainer.appendChild(input);
    input.focus();

    function commit() {
      const val = input.value.trim();
      if (val) {
        const current = getTags(repoId);
        if (current.includes(val)) { input.remove(); addBtn.style.display = ''; return; }
        current.push(val);
        saveTags(repoId, current);
        renderTags(tagsContainer);
        renderTagFilterBar();
        applyFilters();
      } else {
        input.remove();
        addBtn.style.display = '';
      }
    }

    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
      if (ev.key === 'Escape') { input.remove(); addBtn.style.display = ''; }
    });
    input.addEventListener('blur', () => commit());
  });
  tagsContainer.appendChild(addBtn);
}
