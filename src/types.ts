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
  /** star 时间（ISO，P4 全量同步回填；Sort「Recently starred」排序依据） */
  starredAt?: string;
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

/** star 核对裁决（API 确认结果；starred 24h / unstarred 7d 内免重复核对） */
export interface StarVerdict {
  s: 'starred' | 'unstarred';
  /** 裁决时间戳 */
  ts: number;
}
/** repoId → 裁决 */
export type VerdictMap = Record<string, StarVerdict>;
/** 到货页快照：规范化页 URL → {repoId: 'owner/repo'} */
export type PageSnapshots = Record<string, Record<string, string>>;

/** 位移挂起条目：上一页被挤出的仓库 → 预期出现的页（出现即清、缺失才核对） */
export interface ShiftPendingEntry {
  o: string;
  n: string;
  /** 预期出现的页键（规范化 URL） */
  expectKey: string;
  /** 被挤出的来源页键 */
  srcKey: string;
  ts: number;
}
export type ShiftPendingMap = Record<string, ShiftPendingEntry>;
/** 筛选结果项 */
export interface FilteredRepo {
  repoId: string;
  data: RepoData;
}

export type SortKey = 'stars' | 'updated' | 'created';

/** P4 全量同步元数据（4.0.0 API 主模式：ETag 条件快筛 + TTL 兜底 + 本地分页总数） */
export interface FullSyncMeta {
  /** 整表首页（per_page=100&page=1）响应的 ETag（含引号原样保存） */
  etag?: string;
  /** 上次成功整表的时间戳 */
  lastFullSyncAt?: number;
  /** 上次整表的 star 总数（本地分页总页数 = ceil(count/30)） */
  count?: number;
}
