import type { SortKey, TypeFilter } from './types';

/** 视口宽度 >= 此值时启用桌面端布局（与 styles/base.css 中的 @media 断点保持一致） */
export const MOBILE_BREAKPOINT = 768;
/** 视口宽度 >= 此值时启用三栏布局（与 styles/wide.css 中的 @media 断点保持一致） */
export const WIDE_BREAKPOINT = 1200;
/** unstar 后数据的宽限期：24 小时 */
export const GRACE_PERIOD = 24 * 60 * 60 * 1000;

/** 每页卡片数（与 GitHub 原生分页一致；4.0.0 本地切页用） */
export const NATIVE_PAGE_SIZE = 30;

/** Sort 菜单项（顺序 = Recently starred / Recently active / Most stars / Most Forks；Most Forks 为本地扩展，原生无） */
export const SORT_OPTIONS: ReadonlyArray<{ key: SortKey; label: string }> = [
  { key: 'created', label: 'Recently starred' },
  { key: 'updated', label: 'Recently active' },
  { key: 'stars', label: 'Most stars' },
  { key: 'forks', label: 'Most Forks' },
];

/** Type 菜单项（4.2.0，对齐原生 7 个可判项；Can be sponsored 无 API 字段，D2 已定案省略。顺序 = 原生序） */
export const TYPE_OPTIONS: ReadonlyArray<{ value: TypeFilter; label: string }> = [
  { value: 'public', label: 'Public' },
  { value: 'private', label: 'Private' },
  { value: 'source', label: 'Sources' },
  { value: 'fork', label: 'Forks' },
  { value: 'mirror', label: 'Mirrors' },
  { value: 'template', label: 'Templates' },
];

export const STORAGE_KEYS = {
  repoCache: 'stars_repo_cache',
  pendingDelete: 'stars_pending_delete',
  /** 旧版无用户隔离的标签键（迁移用） */
  legacyTags: 'stars_tags',
  /** 旧版无用户隔离的备注键（迁移用） */
  legacyNotes: 'stars_notes',
  tagsPrefix: 'stars_tags_',
  notesPrefix: 'stars_notes_',
  /** GitHub PAT（classic ghp_ / fine-grained github_pat_），外部 unstar 核对用 */
  githubPat: 'github_pat',
  /** P4 全量同步元数据：{etag, lastFullSyncAt, count}（ETag 快筛 + API 模式判定 + 本地分页总数） */
  fullSyncMeta: 'stars_full_sync_meta',
  /** 语言色全局映射缓存（4.3.0：运行时从 linguist languages.yml 获取并缓存，不按仓库存色、不硬编码） */
  langColors: 'stars_lang_colors',
  /** Hide Lists 开关（4.5.0：TM 菜单「隐藏 Lists 区块」，默认 true = 隐藏；false = Lists 原生内容正常显示） */
  hideLists: 'stars_hide_lists',
} as const;

/** 4.0.10 起只清不写的历史键（3.0.9–4.0.9 的到货快照/裁决/位移管线已删）：init 一次性删除 GM + localStorage 镜像 */
export const LEGACY_STORAGE_KEYS = ['stars_page_snapshots', 'stars_star_verdicts', 'stars_shift_pending'] as const;

export const STAR_FILL_SVG = '<svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16" class="octicon octicon-star-fill"><path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"></path></svg>';
export const STAR_EMPTY_SVG = '<svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16" class="octicon octicon-star"><path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Zm0 2.445L6.615 5.5a.75.75 0 0 1-.564.41l-3.097.45 2.24 2.184a.75.75 0 0 1 .216.664l-.528 3.084 2.769-1.456a.75.75 0 0 1 .698 0l2.77 1.456-.53-3.084a.75.75 0 0 1 .216-.664l2.24-2.183-3.096-.45a.75.75 0 0 1-.564-.41L8 2.694Z"></path></svg>';

export const STAR_META_SVG = '<svg aria-label="star" role="img" height="16" viewBox="0 0 16 16" version="1.1" width="16" data-view-component="true" class="octicon octicon-star">' +
  '<path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Zm0 2.445L6.615 5.5a.75.75 0 0 1-.564.41l-3.097.45 2.24 2.184a.75.75 0 0 1 .216.664l-.528 3.084 2.769-1.456a.75.75 0 0 1 .698 0l2.77 1.456-.53-3.084a.75.75 0 0 1 .216-.664l2.24-2.183-3.096-.45a.75.75 0 0 1-.564-.41L8 2.694Z"></path></svg>';

export const FORK_META_SVG = '<svg aria-label="fork" role="img" height="16" viewBox="0 0 16 16" version="1.1" width="16" data-view-component="true" class="octicon octicon-repo-forked">' +
  '<path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z"></path></svg>';

/** GitHub Primer 下拉按钮的下三角图标（Language / Sort 按钮共用） */
export const TRIANGLE_DOWN_SVG = '<svg aria-hidden="true" height="16" viewBox="0 0 16 16" width="16" class="octicon octicon-triangle-down">' +
  '<path d="m4.427 7.427 3.396 3.396a.25.25 0 0 0 .354 0l3.396-3.396A.25.25 0 0 0 11.396 7H4.604a.25.25 0 0 0-.177.427Z"></path>' +
  '</svg>';
/** Primer octicons check-16（4.4.0 Type/Language 多选菜单项的「已选」对勾） */
export const CHECK_SVG = '<svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16" class="octicon octicon-check"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path></svg>';

/** Primer octicons arrow-down-16（Sort 方向按钮：降序） */
export const ARROW_DOWN_SVG = '<svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16" class="octicon octicon-arrow-down"><path d="M13.03 8.22a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L3.47 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018l2.97 2.97V3.75a.75.75 0 0 1 1.5 0v7.44l2.97-2.97a.75.75 0 0 1 1.06 0Z"></path></svg>';
/** Primer octicons arrow-up-16（Sort 方向按钮：升序） */
export const ARROW_UP_SVG = '<svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16" class="octicon octicon-arrow-up"><path d="M3.47 7.78a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0l4.25 4.25a.751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018L9 4.81v7.44a.75.75 0 0 1-1.5 0V4.81L4.53 7.78a.75.75 0 0 1-1.06 0Z"></path></svg>';

/** GitHub Primer sync 图标（同步按钮；来源 primer/octicons sync-16.svg） */
export const SYNC_SVG = '<svg aria-hidden="true" height="16" viewBox="0 0 16 16" width="16" class="octicon octicon-sync"><path d="M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z"></path></svg>';

