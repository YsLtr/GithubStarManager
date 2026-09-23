import type { SortDirection, SortKey } from './types';

/**
 * 筛选状态。
 *
 * 集中放在一个可变对象里（而不是散落的 `let`），
 * 这样各模块 import 后可直接读写，不受 ESM 绑定只读限制。
 *
 * 4.1.0：tagMode/searchMode 退场（全本地后没有「模式切换」，只有
 * hasActiveFilter() 派生判断）；新增 direction；sort 默认 'created'
 * （对齐原生默认 Recently starred）。
 */
export interface FilterState {
  /** 已选中的标签（多选，需全部命中） */
  tags: string[];
  /** 语言筛选，'' = 全部 */
  lang: string;
  /** 排序方式 */
  sort: SortKey;
  /** 排序方向（desc = 默认；asc = 反向，缺失值仍恒沉底） */
  direction: SortDirection;
  /** 当前搜索关键词，'' = 无搜索 */
  searchQuery: string;
  /** 本地浏览页码（4.0.0：缓存切页，1-based） */
  page: number;
  /** 本地浏览总页数 = ceil(count / NATIVE_PAGE_SIZE) */
  totalPages: number;
}

export const filterState: FilterState = {
  tags: [],
  lang: '',
  sort: 'created',
  direction: 'desc',
  searchQuery: '',
  page: 1,
  totalPages: 1,
};

/**
 * 是否有任何「筛选」激活（tags/lang/search 任一）。
 * sort/direction 属浏览状态，不算筛选、不进信息条（D4）。
 */
export function hasActiveFilter(): boolean {
  return filterState.tags.length > 0 || !!filterState.lang || !!filterState.searchQuery;
}
