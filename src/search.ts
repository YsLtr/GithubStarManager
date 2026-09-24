import { applyFilters } from './filters';
import { filterState } from './state';
import { refreshTagPillStates } from './ui/tagFilter';

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

  // 页面带 ?q= 参数时自动激活搜索（R6：q 沿用现有自动激活，不经 initFiltersFromUrl）
  const existingQ = new URLSearchParams(location.search).get('q');
  if (existingQ) {
    searchInput.value = existingQ;
    setTimeout(() => activateSearch(existingQ), 50);
  }
}

/** 进入搜索：全量缓存搜索（4.0.0 起纯本地；4.1.0 起无「模式」概念，状态即真相） */
export function activateSearch(query: string): void {
  if (!query) { clearSearch(); return; }

  filterState.searchQuery = query;
  applyFilters();
}

/** 退出搜索（tags 仍激活则保持筛选态） */
export function clearSearch(): void {
  filterState.searchQuery = '';

  const searchInput = document.querySelector<HTMLInputElement>('input[placeholder*="Search starred"]');
  if (searchInput) searchInput.value = '';

  applyFilters();
  refreshTagPillStates();
}
