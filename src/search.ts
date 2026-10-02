import { applyFilters } from './filters';
import { filterState } from './state';
import { refreshTagPillStates } from './ui/tagFilter';
import { createScope, type LifecycleScope } from './lifecycle';
import { isDesktop } from './utils';

/** 挂在 GitHub 原生 form/input 上的监听，用**作用域**持有（4.9.2 审查修正）。
 *  原先用 `data-gsm-search-bound` 标记串防重复挂载，代价是**摘不掉**已挂的监听：
 *  从桌面收窄到窄视口后，原生搜索框的 submit / Enter 仍被 preventDefault 吞掉，
 *  而 activateSearch→applyFilters 已被视口门挡住 ⇒ 用户「按回车什么都不发生」；
 *  且那个 data 标记本身就是回滚后不该留下的痕迹（违反 D18「脚本没装过」）。
 *  作用域同时解决幂等与回滚：重新转换时先 dispose 上一次，teardown 时 dispose 即全部解绑。 */
let searchScope: LifecycleScope | null = null;

/** 拦截原生搜索表单，改为全缓存搜索 */
export function interceptSearchForm(): void {
  const searchInput = document.querySelector<HTMLInputElement>(
    'input[placeholder*="Search starred"]'
  );
  if (!searchInput) return;

  // 幂等：重新转换时会再调一次 —— 先释放上一次挂的，避免重复监听
  searchScope?.dispose();
  const scope = createScope('gsm-search');
  searchScope = scope;

  // 回调内再判一次视口：matchMedia 变化到 teardown 之间有 150ms debounce 窗口，
  // 期间监听仍在，不能让它把原生行为吞掉。
  const form = searchInput.closest('form');
  if (form) {
    scope.addListener(form, 'submit', (e) => {
      if (!isDesktop()) return; // 窄视口放行原生提交
      e.preventDefault();
      e.stopPropagation();
      activateSearch(searchInput.value.trim());
    });
  }

  scope.addListener(searchInput, 'keydown', (e) => {
    if (!isDesktop()) return;
    if ((e as KeyboardEvent).key !== 'Enter') return;
    e.preventDefault();
    e.stopPropagation();
    activateSearch(searchInput.value.trim());
  });

  // 页面带 ?q= 参数时自动激活搜索（R6：q 沿用现有自动激活，不经 initFiltersFromUrl）
  const existingQ = new URLSearchParams(location.search).get('q');
  if (existingQ) {
    searchInput.value = existingQ;
    scope.timeout(() => activateSearch(existingQ), 50);
  }
}

/** 释放搜索拦截（窄视口回滚 / 离开 Stars 时调用）：解绑监听，恢复原生搜索行为。幂等。 */
export function disposeSearchInterception(): void {
  searchScope?.dispose();
  searchScope = null;
}

/** 进入搜索：全量缓存搜索（4.0.0 起纯本地；4.1.0 起无「模式」概念，状态即真相） */
function activateSearch(query: string): void {
  if (!query) { clearSearch(); return; }

  filterState.searchQuery = query;
  applyFilters();
}

/** 退出搜索（tags 仍激活则保持筛选态） */
function clearSearch(): void {
  filterState.searchQuery = '';

  const searchInput = document.querySelector<HTMLInputElement>('input[placeholder*="Search starred"]');
  if (searchInput) searchInput.value = '';

  applyFilters();
  refreshTagPillStates();
}
