import { extractAndCacheRepoFromCard } from './extract';
import { applyFilters, inheritNativeFilters } from './filters';
import { filterState } from './state';
import { refreshTagPillStates, renderTagFilterBar } from './ui/tagFilter';

/** 拦截原生搜索表单，改为全缓存搜索 */
export function interceptSearchForm(): void {
  const searchInput = document.querySelector<HTMLInputElement>(
    'input[placeholder*="Search starred"]'
  );
  if (!searchInput) return;

  const form = searchInput.closest('form');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      e.stopPropagation();
      activateSearch(searchInput.value.trim());
    });
  }

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      activateSearch(searchInput.value.trim());
    }
  });

  // 页面带 ?q= 参数时自动激活搜索
  const existingQ = new URLSearchParams(location.search).get('q');
  if (existingQ) {
    searchInput.value = existingQ;
    setTimeout(() => activateSearch(existingQ), 50);
  }
}

/** 进入搜索模式：立即渲染缓存结果，再异步补充原生结果 */
export function activateSearch(query: string): void {
  if (!query) { clearSearch(); return; }

  filterState.searchQuery = query;
  filterState.searchMode = true;
  filterState.nativeSearchResults = [];

  // 首次进入自定义模式时继承原生筛选
  if (!filterState.tagMode) {
    inheritNativeFilters();
  }

  applyFilters();                        // 立即渲染缓存搜索结果
  void fetchNativeSearchResults(query);  // 异步补充原始结果
}

/** 退出搜索模式（tags 仍激活则保持 tag 模式） */
export function clearSearch(): void {
  filterState.searchQuery = '';
  filterState.searchMode = false;
  filterState.nativeSearchResults = [];

  const searchInput = document.querySelector<HTMLInputElement>('input[placeholder*="Search starred"]');
  if (searchInput) searchInput.value = '';

  applyFilters();
  renderTagFilterBar();
  refreshTagPillStates();
}

/** 拉取 GitHub 原生搜索结果，补充缓存中缺失的仓库 */
async function fetchNativeSearchResults(query: string): Promise<void> {
  if (filterState.nativeSearchFetching) return;
  filterState.nativeSearchFetching = true;

  try {
    const currentQ = new URLSearchParams(location.search).get('q');
    let doc: Document;
    if (currentQ === query) {
      // 当前页面已是搜索结果页，直接使用
      doc = document;
    } else {
      const url = location.pathname + '?tab=stars&q=' + encodeURIComponent(query);
      const resp = await fetch(url, { credentials: 'same-origin' });
      if (!resp.ok) { filterState.nativeSearchFetching = false; return; }
      doc = new DOMParser().parseFromString(await resp.text(), 'text/html');
    }

    const items = doc.querySelectorAll('.col-12.d-block.width-full.py-4.border-bottom');
    const newIds: string[] = [];
    items.forEach(item => {
      const toggleEl = item.querySelector('[data-toggle-for*="details-user-list-"]');
      if (!toggleEl) return;
      const m = (toggleEl.getAttribute('data-toggle-for') || '').match(/details-user-list-(\d+)/);
      if (!m) return;
      const repoId = m[1];
      extractAndCacheRepoFromCard(item, repoId);
      newIds.push(repoId);
    });

    filterState.nativeSearchResults = newIds;

    // 仍在同一次搜索 → 重新渲染（缓存已更新，补充结果会出现）
    if (filterState.searchMode && filterState.searchQuery === query) {
      applyFilters();
    }
  } catch {
    // 网络错误，仅展示缓存结果
  }

  filterState.nativeSearchFetching = false;
}
