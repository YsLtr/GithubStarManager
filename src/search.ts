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

/** 进入搜索模式：全量缓存搜索（4.0.0 起不再补充原生 HTML 结果） */
export function activateSearch(query: string): void {
  if (!query) { clearSearch(); return; }

  filterState.searchQuery = query;
  filterState.searchMode = true;

  // 首次进入自定义模式时继承原生筛选
  if (!filterState.tagMode) {
    inheritNativeFilters();
  }

  applyFilters();                        // 立即渲染缓存搜索结果
}

/** 退出搜索模式（tags 仍激活则保持 tag 模式） */
export function clearSearch(): void {
  filterState.searchQuery = '';
  filterState.searchMode = false;

  const searchInput = document.querySelector<HTMLInputElement>('input[placeholder*="Search starred"]');
  if (searchInput) searchInput.value = '';

  applyFilters();
  renderTagFilterBar();
  refreshTagPillStates();
}

