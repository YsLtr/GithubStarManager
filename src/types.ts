/** 仓库元数据（缓存于 GM storage） */
export interface RepoData {
  name: string;
  desc?: string;
  lang?: string;
  /** CSS 颜色值，如 `#3178c6` */
  langColor?: string;
  stars?: number;
  forks?: number;
  /** 展示用相对时间文本，如 `Updated 3 days ago` */
  updated?: string;
  /** ISO 时间戳，用于排序 */
  updatedAt?: string;
  /** 缓存写入时间 */
  ts?: number;
  /** 仅在待删除区条目上存在 */
  unstarredAt?: number;
}

/** 待删除区条目：unstar 宽限期内保留的数据 + 标签/备注备份 */
export interface PendingDeleteEntry extends RepoData {
  unstarredAt?: number;
  _tags?: string[];
  _note?: string;
}

/** repoId → 仓库元数据 */
export type RepoCache = Record<string, RepoData>;
/** repoId → 待删除条目 */
export type PendingDeleteMap = Record<string, PendingDeleteEntry>;
/** repoId → 标签数组 */
export type TagMap = Record<string, string[]>;
/** repoId → 备注文本 */
export type NoteMap = Record<string, string>;

/** 筛选结果项 */
export interface FilteredRepo {
  repoId: string;
  data: RepoData;
}

export type SortKey = 'stars' | 'updated';
