/** 仓库元数据（缓存于 GM storage） */
export interface RepoData {
  name: string;
  desc?: string;
  lang?: string;
  stars?: number;
  forks?: number;
  /** 展示用相对时间文本，如 `Updated 3 days ago` */
  updated?: string;
  /** star 时间（ISO，P4 全量同步回填；Sort「Recently starred」排序依据） */
  starredAt?: string;
  /** ISO 时间戳，用于排序 */
  updatedAt?: string;
  /** Type 筛选四标志（4.2.0）：REST repo 对象的 private / fork / is_template / mirror_url，parseItem 回填 */
  private?: boolean;
  /** 是否 fork（API `fork`） */
  fork?: boolean;
  /** 是否模板（API `is_template`） */
  isTemplate?: boolean;
  /** 是否镜像（API `mirror_url != null`） */
  mirror?: boolean;
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

export type SortKey = 'stars' | 'updated' | 'created' | 'forks';

/** 排序方向（desc = 默认；asc = 反向，缺失值仍恒沉底） */
export type SortDirection = 'desc' | 'asc';

/** Type 筛选（'' = All；对齐原生 7 个可判项，D2 已定案省略 Can be sponsored） */
export type TypeFilter = '' | 'public' | 'private' | 'source' | 'fork' | 'mirror' | 'template';

/** P4 全量同步元数据（4.0.0 API 主模式：ETag 条件快筛 + TTL 兜底 + 本地分页总数） */
export interface FullSyncMeta {
  /** 整表首页（per_page=100&page=1）响应的 ETag（强校验规范形 "hex"，4.0.5 起剥 W/ 前缀） */
  etag?: string;
  /** 逐页 ETag 基线（4.0.4 快筛）：强校验规范形（4.0.5 剥 W/），全部 304 才算无变化；含空值则下次直接整表重建 */
  etags?: string[];
  /** 尾页（内容页数 +1）的越界空页 ETag（4.0.9 条件探尾：304=仍空免额度；200 空=刷新；尾页转正/整表兜底后清空） */
  tailEtag?: string;
  /** 上次成功整表的时间戳 */
  lastFullSyncAt?: number;
  /** 上次整表的 star 总数（本地分页总页数 = ceil(count/30)） */
  count?: number;
}
