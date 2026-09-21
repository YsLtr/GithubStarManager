import { TRIANGLE_DOWN_SVG } from './constants';
import { getNativeFilterBar, getNativeFilterRow, getStarsMainColumn } from './dom';
import { filterState } from './state';
import { loadAllNotes } from './storage/notes';
import { loadRepoCache } from './storage/repoCache';
import { getTags, loadAllTags } from './storage/tags';
import { buildCardFromCache, createStarButtonForCached } from './ui/cards';
import { renderNotes } from './ui/notes';
import { refreshTagPillStates, renderTagFilterBar, renderTags } from './ui/tagFilter';
import { escapeHtml } from './utils';
import type { FilteredRepo, SortKey } from './types';

/** 按当前排序方式就地排序（stars 降序 / updated 降序，缺失值排最后） */
function sortResults(results: FilteredRepo[]): void {
  if (filterState.sort === 'stars') {
    results.sort((a, b) => (b.data.stars || 0) - (a.data.stars || 0));
  } else {
    results.sort((a, b) => (b.data.updatedAt || '').localeCompare(a.data.updatedAt || ''));
  }
}

/** 标签（+ 语言）筛选：从缓存中取出所有命中标签的仓库 */
export function getTagFilteredRepos(ignoreLang: boolean): FilteredRepo[] {
  const allTags = loadAllTags();
  const cache = loadRepoCache();
  const results: FilteredRepo[] = [];

  for (const repoId in allTags) {
    const tags = allTags[repoId];
    if (!filterState.tags.every(ft => tags.includes(ft))) continue;
    const data = cache[repoId];
    if (!data) continue;
    // 语言筛选（ignoreLang=true 时跳过，用于构建语言列表）
    if (!ignoreLang && filterState.lang && (data.lang || '').toLowerCase() !== filterState.lang.toLowerCase()) continue;
    results.push({ repoId, data });
  }

  sortResults(results);
  return results;
}

/** 全缓存搜索：每个词都必须至少命中一个字段（作者/仓库名/描述/语言/标签/备注） */
export function searchCacheRepos(query: string, ignoreLang: boolean): FilteredRepo[] {
  const cache = loadRepoCache();
  const allTags = loadAllTags();
  const allNotes = loadAllNotes();
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 0);
  if (terms.length === 0) return [];

  const results: FilteredRepo[] = [];
  for (const repoId in cache) {
    const data = cache[repoId];
    const name = (data.name || '').toLowerCase();
    const [author, repo] = name.split('/');
    const desc = (data.desc || '').toLowerCase();
    const lang = (data.lang || '').toLowerCase();
    const tags = (allTags[repoId] || []).map(t => t.toLowerCase());
    const note = (allNotes[repoId] || '').toLowerCase();

    // 每个词都必须至少命中一个字段
    const allMatch = terms.every(term =>
      (author || '').includes(term) ||
      (repo || '').includes(term) ||
      desc.includes(term) ||
      lang.includes(term) ||
      tags.some(t => t.includes(term)) ||
      note.includes(term)
    );
    if (!allMatch) continue;

    // Tags 联动：如有激活的 tag 筛选，须同时满足
    if (filterState.tags.length > 0) {
      const repoTags = allTags[repoId] || [];
      if (!filterState.tags.every(ft => repoTags.includes(ft))) continue;
    }
    // Language 联动
    if (!ignoreLang && filterState.lang &&
        (data.lang || '').toLowerCase() !== filterState.lang.toLowerCase()) continue;

    results.push({ repoId, data });
  }

  sortResults(results);
  return results;
}

/** 从 GitHub 原生筛选按钮的文案里读出当前 Language / Sort */
export function inheritNativeFilters(): void {
  // 读取当前 Language
  const langBtn = document.querySelector('#stars-language-filter-menu-button');
  if (langBtn) {
    const text = (langBtn.textContent || '').trim();
    const match = text.match(/Language:\s*(.+)/);
    if (match && match[1].trim().toLowerCase() !== 'all') {
      filterState.lang = match[1].trim();
    }
  }
  // 读取当前 Sort
  const sortBtn = document.querySelector('#stars-sort-menu-button');
  if (sortBtn) {
    const text = (sortBtn.textContent || '').trim();
    if (text.includes('Most stars')) {
      filterState.sort = 'stars';
    } else if (text.includes('Recently active')) {
      filterState.sort = 'updated';
    }
    // "Recently starred" → 默认保持 'stars'，因为缓存里没有 star 时间
  }
}

/** 渲染结果计数信息条（含 Clear filter） */
export function renderFilterInfoBar(count: number): void {
  // 移除旧信息条
  document.querySelectorAll('.stars-tag-info-bar').forEach(el => el.remove());

  if (!filterState.searchQuery && filterState.tags.length === 0) return;

  const colLg9 = getStarsMainColumn();
  if (!colLg9) return;
  const gridContainer = colLg9.querySelector('.stars-grid-container');
  if (!gridContainer) return;

  // 隐藏原生 clear filter 条
  const nativeBar = getNativeFilterBar(colLg9);
  if (nativeBar) nativeBar.style.display = 'none';

  const bar = document.createElement('div');
  bar.className = 'stars-tag-info-bar TableObject border-bottom color-border-muted py-3';

  const infoDiv = document.createElement('div');
  infoDiv.className = 'TableObject-item TableObject-item--primary';
  const infoSpan = document.createElement('span');
  infoSpan.setAttribute('role', 'status');

  // 拼装筛选描述
  let desc = '<strong>' + count + '</strong> repos';
  if (filterState.searchQuery) {
    desc += ' matching "<strong>' + escapeHtml(filterState.searchQuery) + '</strong>"';
  }
  if (filterState.tags.length > 0) {
    desc += ' with tags: ' + filterState.tags.map(t => '<strong>' + escapeHtml(t) + '</strong>').join(', ');
  }
  if (filterState.lang) {
    desc += ' · language: <strong>' + escapeHtml(filterState.lang) + '</strong>';
  }
  infoSpan.innerHTML = desc;
  infoDiv.appendChild(infoSpan);

  const clearLink = document.createElement('a');
  clearLink.className = 'issues-reset-query text-normal TableObject-item text-right';
  clearLink.href = '#';
  clearLink.innerHTML = '<svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16" data-view-component="true" class="octicon octicon-x issues-reset-query-icon mt-1"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"></path></svg> Clear filter';
  clearLink.addEventListener('click', (e) => {
    e.preventDefault();
    // 导航到干净的 stars 页面 — 一并清掉预先存在的原生筛选
    const baseUrl = new URL(location.href);
    location.href = baseUrl.pathname + '?tab=stars';
  });

  bar.appendChild(infoDiv);
  bar.appendChild(clearLink);

  colLg9.insertBefore(bar, gridContainer);
}

/** 应用当前筛选状态：渲染缓存卡片 / 退出自定义模式 / 联动原生筛选 */
export function applyFilters(): void {
  // 1. 移除旧的缓存卡片
  document.querySelectorAll('.stars-grid-card-cached').forEach((el) => el.remove());

  const cards = document.querySelectorAll('.stars-grid-card:not(.stars-grid-card-cached)');
  const gridContainer = document.querySelector('.stars-grid-container');
  const paginator = gridContainer ? gridContainer.querySelector<HTMLElement>('.paginate-container') : null;

  const hasSearch = filterState.searchQuery.length > 0;
  const hasTags = filterState.tags.length > 0;

  // 2. 无任何自定义筛选 → 退出自定义模式
  if (!hasTags && !hasSearch) {
    if (filterState.tagMode || filterState.searchMode) {
      // 保留 Language/Sort 写回 URL
      const baseUrl = new URL(location.href);
      const targetParams = new URLSearchParams();
      targetParams.set('tab', 'stars');
      if (filterState.lang) {
        targetParams.set('language', filterState.lang.toLowerCase());
      }
      if (filterState.sort === 'updated') {
        targetParams.set('sort', 'updated');
      } else if (filterState.sort === 'stars') {
        targetParams.set('sort', 'stars');
      }

      filterState.lang = '';
      filterState.sort = 'stars';
      filterState.tagMode = false;
      filterState.searchMode = false;
      filterState.searchQuery = '';

      // 触发导航 — 重载页面后由服务端应用正确筛选
      location.href = baseUrl.pathname + '?' + targetParams.toString();
      return;
    }

    cards.forEach((card) => card.classList.remove('stars-tag-filtered'));
    if (paginator) paginator.style.display = '';
    updateNativeFilters(false);

    // 移除 info bar 并恢复原生 clear filter 条
    document.querySelectorAll('.stars-tag-info-bar').forEach(el => el.remove());
    const colLg9 = getStarsMainColumn();
    if (colLg9) {
      const nativeBar = getNativeFilterBar(colLg9);
      if (nativeBar) nativeBar.style.display = '';
    }
    return;
  }

  // 3. 首次进入自定义模式 → 继承原生筛选
  if (!filterState.tagMode && !filterState.searchMode) {
    inheritNativeFilters();
  }
  if (hasTags) filterState.tagMode = true;
  if (hasSearch) filterState.searchMode = true;

  // 4. 隐藏原始卡片和分页器
  cards.forEach((card) => card.classList.add('stars-tag-filtered'));
  if (paginator) paginator.style.display = 'none';

  // 5. 获取结果
  let results: FilteredRepo[];
  if (hasSearch) {
    results = searchCacheRepos(filterState.searchQuery, false);
    // 补充原生搜索结果中未命中缓存搜索的仓库
    const cacheIds = new Set(results.map(r => r.repoId));
    const cache = loadRepoCache();
    filterState.nativeSearchResults.forEach(rid => {
      if (cacheIds.has(rid)) return;
      const data = cache[rid];
      if (!data) return;
      if (filterState.lang && (data.lang || '').toLowerCase() !== filterState.lang.toLowerCase()) return;
      if (hasTags) {
        const tags = getTags(rid);
        if (!filterState.tags.every(ft => tags.includes(ft))) return;
      }
      results.push({ repoId: rid, data });
    });
  } else {
    results = getTagFilteredRepos(false);
  }

  if (!gridContainer) return;

  // 6. 为每个结果构建缓存卡片
  results.forEach(({ repoId, data }) => {
    const cachedCard = buildCardFromCache(repoId, data);
    gridContainer.appendChild(cachedCard);

    // 星星按钮
    createStarButtonForCached(cachedCard, data);

    // 标签
    const tagsContainer = cachedCard.querySelector<HTMLElement>('.stars-card-tags');
    if (tagsContainer) renderTags(tagsContainer);

    // 备注
    const notesContainer = cachedCard.querySelector<HTMLElement>('.stars-card-notes');
    if (notesContainer) renderNotes(notesContainer);
  });

  // 7. 展示计数信息条
  renderFilterInfoBar(results.length);

  // 8. 切换筛选栏为自定义 Language/Sort
  updateNativeFilters(true);
}

/**
 * 切换原生 / 自定义筛选按钮。
 * tagMode=true 时隐藏原生 Type/Language/Sort，插入自定义 Language/Sort 按钮。
 */
export function updateNativeFilters(tagMode: boolean): void {
  const typeBtn = document.querySelector('#stars-type-filter-menu-button');
  const langBtn = document.querySelector('#stars-language-filter-menu-button');
  const sortBtn = document.querySelector('#stars-sort-menu-button');

  const typeMenu = typeBtn ? typeBtn.closest('action-menu') : null;
  const langMenu = langBtn ? langBtn.closest('action-menu') : null;
  const sortMenu = sortBtn ? sortBtn.closest('action-menu') : null;

  if (tagMode) {
    // 隐藏原生 Type / Language / Sort action-menu
    if (typeMenu) (typeMenu as HTMLElement).style.display = 'none';
    if (langMenu) (langMenu as HTMLElement).style.display = 'none';
    if (sortMenu) (sortMenu as HTMLElement).style.display = 'none';

    // 移除旧的自定义按钮
    document.querySelectorAll('.stars-custom-filter').forEach(el => el.remove());

    // 插入点：Tags 筛选按钮之后
    const filterRow = getNativeFilterRow();
    if (!filterRow) return;

    const tagFilter = filterRow.querySelector('.stars-tag-filter');
    const insertAfter = tagFilter || filterRow.firstChild;

    // --- 自定义 Language 按钮 ---
    const langContainer = document.createElement('div');
    langContainer.className = 'stars-custom-filter mb-1 mb-lg-0';

    // 收集筛选结果里出现的语言（忽略语言筛选本身）
    const allResults = filterState.searchQuery
      ? searchCacheRepos(filterState.searchQuery, true)
      : getTagFilteredRepos(true);
    // 补充原生搜索结果的语言
    if (filterState.searchQuery && filterState.nativeSearchResults.length > 0) {
      const cache = loadRepoCache();
      const existingIds = new Set(allResults.map(r => r.repoId));
      filterState.nativeSearchResults.forEach(rid => {
        if (!existingIds.has(rid)) {
          const data = cache[rid];
          if (data) allResults.push({ repoId: rid, data });
        }
      });
    }
    const langSet = new Set<string>();
    allResults.forEach(({ data }) => { if (data.lang) langSet.add(data.lang); });
    const languages = Array.from(langSet).sort((a, b) => a.localeCompare(b));

    const langBtnLabel = filterState.lang ? 'Language: ' + filterState.lang : 'Language';
    const langBtnEl = document.createElement('button');
    langBtnEl.type = 'button';
    langBtnEl.id = 'stars-custom-lang-button';
    langBtnEl.setAttribute('popovertarget', 'stars-custom-lang-overlay');
    langBtnEl.setAttribute('aria-haspopup', 'true');
    langBtnEl.className = 'Button--secondary Button--medium Button';
    if (filterState.lang) langBtnEl.classList.add('has-active');
    langBtnEl.innerHTML =
      '<span class="Button-content"><span class="Button-label"></span></span>' +
      '<span class="Button-visual Button-trailingAction">' +
        TRIANGLE_DOWN_SVG +
      '</span>';
    const langLabelEl = langBtnEl.querySelector('.Button-label');
    if (langLabelEl) langLabelEl.textContent = langBtnLabel;

    const langOverlay = document.createElement('anchored-position');
    langOverlay.id = 'stars-custom-lang-overlay';
    langOverlay.setAttribute('anchor', 'stars-custom-lang-button');
    langOverlay.setAttribute('align', 'start');
    langOverlay.setAttribute('side', 'outside-bottom');
    langOverlay.setAttribute('anchor-offset', 'normal');
    langOverlay.setAttribute('popover', 'auto');

    const langInner = document.createElement('div');
    langInner.className = 'Overlay Overlay--size-auto';
    const langBody = document.createElement('div');
    langBody.className = 'Overlay-body Overlay-body--paddingNone';
    const langList = document.createElement('ul');
    langList.className = 'ActionListWrap--inset ActionListWrap';
    langList.setAttribute('role', 'menu');

    // "All languages" 选项
    const allLi = document.createElement('li');
    allLi.className = 'ActionListItem';
    allLi.setAttribute('role', 'none');
    const allContent = document.createElement('a');
    allContent.className = 'ActionListContent';
    allContent.setAttribute('role', 'menuitemradio');
    allContent.setAttribute('aria-checked', String(!filterState.lang));
    const allLabel = document.createElement('span');
    allLabel.className = 'ActionListItem-label';
    allLabel.textContent = 'All languages';
    allContent.appendChild(allLabel);
    allContent.addEventListener('click', (e) => {
      e.preventDefault();
      filterState.lang = '';
      langOverlay.hidePopover();
      applyFilters();
      renderTagFilterBar();
      refreshTagPillStates();
    });
    allLi.appendChild(allContent);
    langList.appendChild(allLi);

    languages.forEach((lang) => {
      const li = document.createElement('li');
      li.className = 'ActionListItem';
      li.setAttribute('role', 'none');
      const content = document.createElement('a');
      content.className = 'ActionListContent';
      content.setAttribute('role', 'menuitemradio');
      content.setAttribute('aria-checked', String(filterState.lang.toLowerCase() === lang.toLowerCase()));
      const label = document.createElement('span');
      label.className = 'ActionListItem-label';
      label.textContent = lang;
      content.appendChild(label);
      content.addEventListener('click', (e) => {
        e.preventDefault();
        filterState.lang = lang;
        langOverlay.hidePopover();
        applyFilters();
        renderTagFilterBar();
        refreshTagPillStates();
      });
      li.appendChild(content);
      langList.appendChild(li);
    });

    langBody.appendChild(langList);
    langInner.appendChild(langBody);
    langOverlay.appendChild(langInner);
    langContainer.appendChild(langBtnEl);
    langContainer.appendChild(langOverlay);

    // --- 自定义 Sort 按钮 ---
    const sortContainer = document.createElement('div');
    sortContainer.className = 'stars-custom-filter mb-1 mb-lg-0 ml-2';

    const sortOptions: Array<{ key: SortKey; label: string }> = [
      { key: 'stars', label: 'Most stars' },
      { key: 'updated', label: 'Recently active' }
    ];
    const sortBtnLabel = 'Sort by: ' + (sortOptions.find(o => o.key === filterState.sort) || sortOptions[0]).label;
    const sortBtnEl = document.createElement('button');
    sortBtnEl.type = 'button';
    sortBtnEl.id = 'stars-custom-sort-button';
    sortBtnEl.setAttribute('popovertarget', 'stars-custom-sort-overlay');
    sortBtnEl.setAttribute('aria-haspopup', 'true');
    sortBtnEl.className = 'Button--secondary Button--medium Button';
    sortBtnEl.innerHTML =
      '<span class="Button-content"><span class="Button-label"></span></span>' +
      '<span class="Button-visual Button-trailingAction">' +
        TRIANGLE_DOWN_SVG +
      '</span>';
    const sortLabelEl = sortBtnEl.querySelector('.Button-label');
    if (sortLabelEl) sortLabelEl.textContent = sortBtnLabel;

    const sortOverlay = document.createElement('anchored-position');
    sortOverlay.id = 'stars-custom-sort-overlay';
    sortOverlay.setAttribute('anchor', 'stars-custom-sort-button');
    sortOverlay.setAttribute('align', 'start');
    sortOverlay.setAttribute('side', 'outside-bottom');
    sortOverlay.setAttribute('anchor-offset', 'normal');
    sortOverlay.setAttribute('popover', 'auto');

    const sortInner = document.createElement('div');
    sortInner.className = 'Overlay Overlay--size-auto';
    const sortBody = document.createElement('div');
    sortBody.className = 'Overlay-body Overlay-body--paddingNone';
    const sortList = document.createElement('ul');
    sortList.className = 'ActionListWrap--inset ActionListWrap';
    sortList.setAttribute('role', 'menu');

    sortOptions.forEach((opt) => {
      const li = document.createElement('li');
      li.className = 'ActionListItem';
      li.setAttribute('role', 'none');
      const content = document.createElement('a');
      content.className = 'ActionListContent';
      content.setAttribute('role', 'menuitemradio');
      content.setAttribute('aria-checked', String(filterState.sort === opt.key));
      const label = document.createElement('span');
      label.className = 'ActionListItem-label';
      label.textContent = opt.label;
      content.appendChild(label);
      content.addEventListener('click', (e) => {
        e.preventDefault();
        filterState.sort = opt.key;
        sortOverlay.hidePopover();
        applyFilters();
        renderTagFilterBar();
        refreshTagPillStates();
      });
      li.appendChild(content);
      sortList.appendChild(li);
    });

    sortBody.appendChild(sortList);
    sortInner.appendChild(sortBody);
    sortOverlay.appendChild(sortInner);
    sortContainer.appendChild(sortBtnEl);
    sortContainer.appendChild(sortOverlay);

    // 把自定义按钮插到 Tags 之后
    if (insertAfter && insertAfter.nextSibling) {
      filterRow.insertBefore(langContainer, insertAfter.nextSibling);
      filterRow.insertBefore(sortContainer, langContainer.nextSibling);
    } else {
      filterRow.appendChild(langContainer);
      filterRow.appendChild(sortContainer);
    }
  } else {
    // 恢复原生 action-menu
    if (typeMenu) (typeMenu as HTMLElement).style.display = '';
    if (langMenu) (langMenu as HTMLElement).style.display = '';
    if (sortMenu) (sortMenu as HTMLElement).style.display = '';

    // 移除自定义筛选按钮
    document.querySelectorAll('.stars-custom-filter').forEach(el => el.remove());
  }
}
