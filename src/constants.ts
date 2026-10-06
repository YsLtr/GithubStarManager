import type { SortKey, TypeFilter } from './types';

/** 视口宽度 >= 此值时启用桌面端布局（与 styles/base.css 中的 @media 断点保持一致） */
export const MOBILE_BREAKPOINT = 768;
/** unstar 后数据的宽限期：24 小时 */
export const GRACE_PERIOD = 24 * 60 * 60 * 1000;

/* 曾用过什么（D30 / 4.16.0 删除）：此处原有 `DATA_REV`（缓存数据代次：字段语义变更时 +1，
 * 旧代次缓存由 scanStarred 强制一次无条件整表回补）。删除理由见 fullSync.ts 的 scanStarred 墓碑：
 * 48h TTL 已使该阀门不可达。若将来真需要一次换血，从这里拿回来即可（约 3 行 + 一处判据 + 一处写入）。 */

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
  /** 宽限期备份键前缀（4.18.0 起按归属账号分区，见 storage/pendingDelete.ts）。
   *  旧的无隔离键名 `stars_pending_delete` 已删除 —— 它没有读取者，且留着会让「读空」的护栏重新有回落物。 */
  pendingDeletePrefix: 'stars_pending_delete_',
  tagsPrefix: 'stars_tags_',
  notesPrefix: 'stars_notes_',
  /** GitHub PAT（classic ghp_ / fine-grained github_pat_），外部 unstar 核对用 */
  githubPat: 'github_pat',
  /** P4 全量同步元数据：{etags, tailEtag, lastFullSyncAt, count}（ETag 快筛 + API 模式判定 + 本地分页总数） */
  fullSyncMeta: 'stars_full_sync_meta',
  /** 语言色全局映射缓存（4.3.0：运行时从 linguist languages.yml 获取并缓存，不按仓库存色、不硬编码） */
  langColors: 'stars_lang_colors',
  /** Hide Lists 开关（4.5.0：TM 菜单「隐藏 Lists 区块」，默认 true = 隐藏；false = Lists 原生内容正常显示） */
  hideLists: 'stars_hide_lists',
  /** Token 归属校验缓存（4.11.0）：{ [凭证指纹]: { id, login } }。只存哈希与数字 ID，**不存 token 明文**；
   *  指纹命中即零请求（GET /user 只在首次见到该凭证时发一次） */
  accountIdentity: 'stars_account_identity',
  /** 归属不符警告的关闭态（4.11.0）：`<tokenId>#<sessionId>`。仅当该组合变化（换 token / 换登录账号）
   *  才重新弹出 —— 属**页面级偏好**，不随视口回滚（见 viewTeardown 的边界）。 */
  accountBannerDismissed: 'stars_account_banner_dismissed',
} as const;

/** 脚本给「被自己改过 display 的原生节点」打的标记（4.9.1）。teardown 只按这个标记回滚，
 *  绝不靠启发式猜测哪个 inline display 是自己写的（见 viewTeardown.ts 的铁律）。 */
export const GSM_HIDDEN_ATTR = 'data-gsm-hidden';

/** 脚本把 Starred topics 从哪个 `.col-lg-3` 搬走的（4.9.2 审查补）：teardown 只还回打了此标记的那个节点。
 *  单靠 `isConnected` 不够 —— Turbo 原位重渲染 `#user-starred-repos` 会换出**新的** `.col-lg-3`，
 *  把右栏里的陈旧内容倒进去就是重复的 topics（见 transform.ts 的搬运点与 viewTeardown.ts 的回填点）。 */
export const GSM_TOPICS_SRC_ATTR = 'data-gsm-topics-src';

/** 「承载 stars 内容的那个 `.Layout`」的标记类（4.13.0）。
 *
 *  **为什么必须标记**：profile 页上 `.Layout.Layout--sidebarPosition-start` 可能**不止一个** ——
 *  登出的页面有两个：第 0 个是**页头**（头像 + 标签栏），第 1 个才是**内容**布局（`#user-starred-repos` 在它里面）。
 *  布局样式表（base.css / wide.css / persistent.css）里的 `--Layout-sidebar-width: 180px`、
 *  `grid-template-columns: 180px 1fr 220px`、`.Layout-sidebar{width:180px}` 等等原本按
 *  `.Layout--sidebarPosition-start` 选元素 ⇒ 两代骨架下会**连页头一起改写**（不是我们的内容却动了它的布局）。
 *  绑上本标记后语义变成「只接管承载我们网格的那个布局」，页头原样不动（真机：登出页 `mattn?tab=stars`）。
 *
 *  与 `GSM_HIDDEN_ATTR` 的区别：这个标记打在**我们自己选中的布局**上（元素本身仍是 GitHub 的，
 *  但我们只加一个 class，不改它的任何内联样式）⇒ 回滚就是摘掉 class，不必记录「原来长什么样」。 */
export const STARS_LAYOUT_CLASS = 'gsm-stars-layout';

/* ---------------- 导出包（4.7.0 导入导出） ---------------- */

/** 导出包协议身份：**永不随脚本改名变动**（改名只影响文件名 slug）。校验「这是不是本项目的文件」靠它 */
export const EXPORT_KIND = 'github-star-manager-export';
/** 导出包结构版本：**兼容性破坏**才 +1（字段增删若旧包仍可完整解析则不升版）；升版 = 新脚本明确
 * 拒绝旧包而不是部分解析。4.8.0 删除 updated/langColor 死字段属非破坏变更：旧包可完整解析，故保持 1。
 * （4.16.0 起读路径不再清洗未知字段 —— 包里的多余字段会**原样保留**在缓存里，无读者、不报错。） */
export const EXPORT_SCHEMA_VERSION = 1;

/** 本地时区的 `YYYY-MM-DD-HHmm`（文件名用；Windows 禁用字符 `:` 已避开） */
function localStamp(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** 导出文件名：`<脚本 slug>-<用户 id>-<本地时间>.json`。文件名给人看，包内 exportedAt 给程序看（ISO 8601 UTC） */
export function buildExportFilename(userId: string): string {
  return `${__SCRIPT_SLUG__}-${userId}-${localStamp(new Date())}.json`;
}

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

