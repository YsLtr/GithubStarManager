import { TRIANGLE_DOWN_SVG } from '../constants';
import { getNativeFilterRow } from '../dom';
import { filterState } from '../state';
import { applyFilters, computeTagCandidates, hasAnyTags } from '../filters';
import { getTags, saveTags } from '../storage/tags';

/** 勾选/取消一个标签筛选条件并重绘。**唯一实现** —— 筛选栏 chip 与卡片标签都走这里 */
function toggleTagFilter(tag: string): void {
  const idx = filterState.tags.indexOf(tag);
  if (idx >= 0) {
    filterState.tags.splice(idx, 1);
  } else {
    filterState.tags.push(tag);
  }
  // applyFilters → refreshTagFilterBar 统一原位重绘（候选收窄 + 空态 + 按钮文案）；
  // pill 选中态同步。**不要**在调用点各写一份。
  applyFilters();
  refreshTagPillStates();
}

/** 同步 Tags 筛选按钮的文案与高亮态 */
function updateTagFilterButton(): void {
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

/**
 * 渲染 Tags 多选筛选栏（原生 Popover API + ActionList 结构）。
 * 私有：创建/撤条只经 refreshTagFilterBar 一条路（4.3.5 删掉全部散点直调，
 * 落实 DEVELOPER.md「候选刷新唯一入口」invariant）。
 */
function renderTagFilterBar(): void {
  const filterRow = getNativeFilterRow();
  if (!filterRow) return;

  const existing = filterRow.querySelector('.stars-tag-filter');
  if (existing) existing.remove();

  // R3 动态收窄：候选 = 当前约束下共现的标签 ∪ 已选；无可选项就不渲染按钮
  // 按钮渲染门槛 = 全缓存至少有一个标签（与筛选约束无关，hasAnyTags）；
  // 当前约束下候选为空时仍渲染按钮、面板内显示空态提示——
  // 候选随约束（type/lang/搜索）动态收窄回填，按钮不能时有时无（4.3.4）
  if (!hasAnyTags()) return;

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

  // 菜单列表容器 — 使用原生 ActionList 结构（勾选后由 renderTagFilterList 原位重绘）
  const menuList = document.createElement('ul');
  menuList.id = 'stars-tag-filter-list';
  menuList.className = 'gsm-tag-chips';
  menuList.setAttribute('role', 'menu');
  renderTagFilterList(menuList);

  overlayBody.appendChild(menuList);
  overlayInner.appendChild(overlayBody);
  overlay.appendChild(overlayInner);

  container.appendChild(btn);
  container.appendChild(overlay);

  filterRow.insertBefore(container, filterRow.firstChild);
}

/**
 * 菜单列表级重绘（R3）：候选随约束动态收窄 + 勾选态同步。
 * 勾选是多选场景，必须**原位更新**（整体重建会把开着的 popover 拆掉）。
 */
function renderTagFilterList(menuList: HTMLUListElement): void {
  menuList.innerHTML = '';

  const candidates = computeTagCandidates();
  if (candidates.length === 0) {
    // 空态（4.3.4）：当前约束（type/lang/搜索）下结果集无标签且无已选——
    // 明示原因，面板不再是一块空白（会被当成坏了）；约束一变即自动回填
    const li = document.createElement('li');
    li.className = 'gsm-tag-chips-empty';
    li.setAttribute('role', 'none'); // role=menu 合法子元素不含裸 li（审查 🟡-1）
    li.textContent = '当前筛选结果暂无标签';
    menuList.appendChild(li);
    return;
  }

  candidates.forEach((tag) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'none');

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'gsm-tag-chip';
    chip.setAttribute('role', 'menuitemcheckbox');
    chip.setAttribute('aria-checked', String(filterState.tags.includes(tag)));
    chip.textContent = tag;

    chip.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleTagFilter(tag);
    });

    li.appendChild(chip);
    menuList.appendChild(li);
  });
}

/**
 * Tags 候选跟随筛选状态刷新（applyFilters 每次调用，4.3.4）：
 * 条已存在 → 原位重绘 chip 列表 + 按钮文案（popover 若开着不关闭）；
 * 条不存在 → 交 renderTagFilterBar 按需创建（用户从未打标签则仍不渲染）。
 * 修复：Type/Language/搜索变化后候选残留脏值（点不存在的 tag 出 0 结果）；
 * 以及空结果集取消勾选后面板被清空、再无回填路径只能整页刷新。
 */
export function refreshTagFilterBar(): void {
  const filterRow = getNativeFilterRow();
  if (!filterRow) return;
  const existing = filterRow.querySelector<HTMLElement>('.stars-tag-filter');
  // 全缓存已无任何标签（如同步管线 confirmExternalUnstar 清空最后一个带标签仓库，
  //   不经 pill × 的预清理）→ 撤条，不留「Tags 按钮在、面板空」的残留（审查 🟡-3）
  if (!hasAnyTags()) {
    existing?.remove();
    return;
  }
  if (!existing) {
    renderTagFilterBar();
    return;
  }
  updateTagFilterButton();
  const menuList = existing.querySelector<HTMLUListElement>('#stars-tag-filter-list');
  if (menuList) renderTagFilterList(menuList);
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

/** `renderTags` 的渲染上下文（4.14.0） */
export interface TagRenderOptions {
  /**
   * 是否把标签点击接到**筛选**上（默认 `true` = 本方自己的 stars 页的既有行为）。
   *
   * 他人 star 页传 `false`，隔离三件事：
   * ① 点胶囊不切换 `filterState`；
   * ② 不加 `stars-tag-active` 选中高亮；
   * ③ 保存后不调 `applyFilters()` / `refreshTagPillStates()`。
   *
   * 为什么必须隔离：他人页**没有**脚本筛选栏（D26），而 `filterState` 是**跨页共享的模块态**
   * （进他人页不清、离开也不清，见 `viewContext.ts`）。若沿用筛选语义，在他人页点一下标签
   * 就会改写一份用户看不见的筛选状态，回到自己的页时列表莫名其妙变少；
   * 更糟的是 `applyFilters()` 会往**别人的**原生筛选行插脚本控件、把原生菜单设成 `display:none`
   * —— 它此前唯一的门是 `!isDesktop()`，没有只读门。
   */
  filterToggle?: boolean;
}

/** 渲染单个卡片上的标签 pill + 内联新增输入框 */
export function renderTags(tagsContainer: HTMLElement, opts: TagRenderOptions = {}): void {
  const repoId = tagsContainer.dataset.repoId || '';
  if (!repoId) return;
  // 默认 true：本方自己的页逐字沿用既有行为（筛选联动 + 保存后刷新候选）
  const filterToggle = opts.filterToggle !== false;

  const tags = getTags(repoId);
  tagsContainer.innerHTML = '';

  tags.forEach((tag, idx) => {
    const span = document.createElement('span');
    span.className = 'stars-tag';
    if (filterToggle && filterState.tags.includes(tag)) {
      span.classList.add('stars-tag-active');
    }
    span.textContent = tag;

    if (filterToggle) {
      span.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleTagFilter(tag);
      });
    }

    const del = document.createElement('span');
    del.className = 'stars-tag-del';
    del.textContent = '×';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      const current = getTags(repoId);
      current.splice(idx, 1);
      saveTags(repoId, current);
      renderTags(tagsContainer, opts);
      if (filterToggle) {
        // applyFilters 会按需创建/收窄/撤条（4.3.5 删冗余直调）
        applyFilters();
      }
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
        renderTags(tagsContainer, opts);
        if (filterToggle) {
          // 新标签入库后 applyFilters→refreshTagFilterBar 会建条/收窄（4.3.5 删冗余直调）
          applyFilters();
        }
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
