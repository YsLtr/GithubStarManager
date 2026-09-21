import type { SortKey } from './types';

/**
 * 筛选状态。
 *
 * 集中放在一个可变对象里（而不是散落的 `let`），
 * 这样各模块 import 后可直接读写，不受 ESM 绑定只读限制。
 */
export interface FilterState {
  /** 已选中的标签（多选，需全部命中） */
  tags: string[];
  /** 语言筛选，'' = 全部 */
  lang: string;
  /** 排序方式 */
  sort: SortKey;
  /** 是否处于标签筛选模式 */
  tagMode: boolean;
  /** 当前搜索关键词，'' = 无搜索 */
  searchQuery: string;
  /** 是否处于搜索模式 */
  searchMode: boolean;
  /** GitHub 原生搜索返回的 repoId 列表（用于补充缓存未命中的结果） */
  nativeSearchResults: string[];
  /** 防止原生搜索重复 fetch */
  nativeSearchFetching: boolean;
}

export const filterState: FilterState = {
  tags: [],
  lang: '',
  sort: 'stars',
  tagMode: false,
  searchQuery: '',
  searchMode: false,
  nativeSearchResults: [],
  nativeSearchFetching: false,
};
