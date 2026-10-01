# GithubStarManager — 开发者文档

> 领域术语见 `CONTEXT.md`；架构决策（ADR）见 `docs/adr/`。

> 本文档描述**当前代码状态**。历史变更过程见 `git log`（提交信息写得较详细）；交接状态与待验证清单见 `AGENTS.md`。

## 1. 项目概述

**GithubStarManager**（4.6.0 前的旧名 `GitHub Stars Grid View`）是一个 Tampermonkey 用户脚本，将 GitHub 个人主页的 Stars 标签页从默认列表视图改为卡片网格视图（并缩小左侧资料栏以最大化展示空间）。4.0.0 起为 **API 主模式**：配置 PAT 后，列表数据全部来自 GitHub API 全量缓存，渲染 / 分页 / 筛选 / 搜索 / 星星增删均在本地完成。

- **运行环境**：Tampermonkey / Violentmonkey 等用户脚本管理器
- **匹配页面**：`https://github.com/*`（单条 @match 覆盖全站；运行时按 `?tab=stars` 与仓库详情页特征分流）
- **生效条件**：仅桌面端（视口宽度 ≥ 768px）
- **产物**：单个 `dist/github-star-manager.user.js`（无运行时依赖）

## 2. 技术栈与命令

| 项 | 值 |
|---|---|
| 构建 | Vite 8 + [vite-plugin-monkey](https://github.com/lisonge/vite-plugin-monkey) 8 |
| 语言 | TypeScript 7（strict，`noUnusedLocals` / `verbatimModuleSyntax`） |
| 包管理 | pnpm（`pnpm-lock.yaml` 已提交） |

```bash
pnpm install        # 安装依赖
pnpm dev            # 开发服务器：改动走 HMR，无需手动往 Tampermonkey 里粘贴
pnpm build          # 产出 dist/github-star-manager.user.js
pnpm typecheck      # tsc --noEmit
pnpm check          # typecheck + build
pnpm test:exportimport   # 导入导出纯逻辑断言（51 项，无需浏览器）
node scripts/verify-css.cjs                      # 产物 CSS 与源 CSS 等价性
node scripts/ratelimit-probe.cjs --repo <me/repo> # 限流实测探针（默认 dry-run，零网络请求）
```

### dev 模式怎么用

`pnpm dev` 启动后，插件会自动在默认浏览器打开安装页：

```
http://127.0.0.1:5173/__vite-plugin-monkey.install.user.js
```

Tampermonkey 里会多出名为 `server:GithubStarManager` 的脚本（与正式版并列，靠前缀区分）。它只是 loader，实际代码通过 ESM 从 dev server 拉取，因此改代码即时生效。

> dev 模式为了兼容各种运行时会把 `@grant` 放宽成 `GM.*` 全家桶，这是插件行为；正式 `build` 产物的 `@grant` = `vite.config.ts` 显式声明列表 ∪ 插件 autoGrant 对源码 GM_* 标识符的 AST 推断结果（跨源并集）。显式列表见 `vite.config.ts` 的 `grant`，**不要依赖推断**。

### dev 模式在 github.com 上的两个前置条件

GitHub 的 CSP 是 `script-src github.githubassets.com 'nonce-…'`，白名单里没有 `127.0.0.1`。dev loader 要往页面里插 `<script type="module" src="http://127.0.0.1:5173/…">`，会被这条策略直接拒绝，控制台表现为 `Failed to fetch dynamically imported module`。**这不是本项目代码的问题，插件也绕不过去**（[vite-plugin-monkey#205](https://github.com/lisonge/vite-plugin-monkey/issues/205)）。所以：

1. **开发用浏览器要装一个放行 CSP 的扩展**，并只把 `github.com` 加进白名单（别全局关，风险大）：
   - [CSP Unblock](https://chromewebstore.google.com/detail/csp-unblock/lkbelpgpclajeekijigjffllhigbhobd)（可按域名开关，推荐）
   - [Disable Content-Security-Policy](https://chromewebstore.google.com/detail/disable-content-security/ieelmcmcagommplceebfedjlakkhpden)
2. **放行 Local Network Access 权限提示**：Chrome 138+ 起公网页面访问 `127.0.0.1` 需用户授权，首次会弹「查找并连接本地网络上的设备」，必须点允许。若被静默拦截，可在 `chrome://flags/#local-network-access-check` 关掉该检查（仅限开发 profile）。

另有第三个坑：dev 代码经动态 `import()` 跑在 `unsafeWindow` 作用域，该作用域**没有 GM_api**（[vite-plugin-monkey#35](https://github.com/lisonge/vite-plugin-monkey/issues/35)）。已用 `vite.config.ts` 的 `server.mountGmApi: true` 解决（仅 dev 生效，产物不变）。

不想折腾扩展时，退路是 `pnpm build` 后把 `dist/github-star-manager.user.js` 重新装进 Tampermonkey —— 构建只要 ~100ms，代价是没有 HMR。

## 3. 目录结构

```
src/
  index.ts            入口：document-start 引导、页面类型分流、样式生命周期、Turbo 导航监听、配置横幅
  constants.ts        断点、宽限期、NATIVE_PAGE_SIZE、存储键（STORAGE_KEYS / LEGACY_STORAGE_KEYS）、SVG、SORT/TYPE 菜单项
  types.ts            存储模型与筛选类型（RepoData / PendingDeleteEntry / TagMap / NoteMap / FullSyncMeta / SortKey / TypeFilter ...）
  state.ts            筛选状态对象 filterState + hasActiveFilter() 派生判断（唯一可变全局状态）
  utils.ts            escapeHtml / isDesktop / formatRelative
  gm.ts               GM API 兼容层（调用时判定；localStorage 兜底与迁移；PAT 不写镜像）
  boot.ts             document-start 防闪烁隐藏生命周期（FOUC）
  dom.ts              DOM 查询工具 + Hide Lists 开关引擎（isHideListsEnabled / applyHideListsGate / hideListsSection / clearListsHiddenMarks）
  transform.ts        列表 → 卡片网格转换（藏原生列表与分页器、挂顶部分页器与 Sync 按钮、Starred Topics 迁右栏）
  filters.ts          筛选引擎：queryRepos 统一查询管线、4 排序键×双向、facet 候选收窄、renderBrowsePage 本地分页、applyFilters、exitCustomMode、initFiltersFromUrl
  search.ts           搜索表单拦截（纯本地）
  pagination.ts       本地分页拦截（只拦自造 data-gsm-page，零网络零 Turbo）
  langColors.ts       语言色引擎：linguist languages.yml 运行时拉取 + 行扫描提取 + GM 缓存 + 未命中补拉/回退重检 + 色点原地重涂
  starCheck.ts        PAT 读写/前缀校验/菜单、外部 unstar 宽限管线（applyExternalUnstar）、卡片星标态刷新（syncCardAfterStarChange）
  tokenConfig.ts      凭据单一来源：getToken / detectTokenKind（ghp_·gho_=classic，github_pat_=fine-grained）/ isClassicCredential、
                      **两条**预填深链（classic `scopes=repo` + fine-grained `starring=write`）与差异文案、剪贴板粘贴、401/403(非限速) 上报
  starWrites.ts       写路径抽象（4.9.0）：setStarState **静默分派** REST（classic/OAuth Bearer）↔ 网页端点（Cookie 会话 + GitHub-Verified-Fetch，
                      422 才回退取页面表单 token 重发一次）、成功判定、失败归一 + writeFailureMessage
  mutationQueue.ts    全局串行变异队列（4.9.0）：间隔 ≥1000ms、排队中可撤销、失败不阻断后续
  restore.ts          恢复编排（4.9.0）：restoreOne / restoreMany（严格串行·可取消·不重试）/ pushRestoreNotice（同仓库通知去重）
  fullSync.ts         API 主模式同步：scanStarred 单遍条件扫描、波次并发、整表 diff、star 时间回填、进页 probe、runFullSync / registerSyncMenu / mountSyncButton / hasApiData
  storage/
    repoCache.ts      仓库缓存 CRUD
    tags.ts           标签存储 + 用户 ID 解析 + 备注键规则 + 迁移
    notes.ts          备注存储（saveNote 判空 = trim 后为空）
    pendingDelete.ts  待删除区（unstar 宽限期，含标签/备注备份 + listRestorable/formatRemaining 供恢复窗口）
    exportImport.ts   导入导出**纯逻辑**（4.7.0）：buildExportPackage / validateExportPackage / applyImportPackage；不碰 DOM、不弹对话框
  ui/
    cards.ts          卡片构建 + 星星按钮（4.9.0：乐观翻转 → 全局队列 → 排队中再点撤销 → 失败回滚 + alert）
    notifications.ts  右上角通知栈（4.9.0）：内联样式 + transition 滑入、3s 自动消失、悬停整区暂停、划掉完成态
    restoreMenu.ts    TM 菜单「♻️ 恢复已取消的 star」（4.9.0）：可勾选 + 一键恢复选中 + 每行 ☆ 按钮 + 进度 + 取消
    tagFilter.ts      标签 pill、筛选栏（原位重绘 = 共现收窄，勾选不关 popover）、pill 选中态同步、refreshTagFilterBar（候选刷新唯一入口）
    hideListsMenu.ts  TM 菜单「🙈 隐藏 Lists 区块」开关（持久键 stars_hide_lists + 标签刷新 + 门控即时生效）
    notes.ts          备注渲染与编辑
    exportImportMenu.ts  TM 菜单「📤 导出 / 📥 导入」交互层（隐藏 file input、confirm/alert、下载触发、结果提示）
  styles/
    base.css          ≥768px 布局与组件样式（第 4 节 Lists 隐藏规则带 html.gsm-hide-lists 门控前缀）
    wide.css          ≥1200px 三栏布局
    persistent.css    常驻小表（注入后不移除：右栏默认隐藏 + 侧边栏/头像过渡）
legacy/
  github-stars-grid.v2.6.user.js   迁移前的单文件版本（冻结，仅供对照/回滚）
tests/smoke/
  fixture.html            仿 GitHub Stars 页面的最小 DOM + GM API stub + 加载构建产物
  fixture-detail.html     仿仓库详情页（宽限期流程：预置缓存 + unstar/re-star）
  assert-transform.js     转换/标签/备注/筛选栏断言
  assert-search.js        搜索断言
  assert-detail.js        详情页宽限期断言（4.8.0 起不再断言缓存提取）
tests/exportImport/
  prepare.cjs             把被测模块编译成 node 可 require 的 .cjs（产物在 .build/，已 gitignore）
  run.cjs                 导入导出纯逻辑断言：导出清洗 / 校验拒绝路径 / 合并语义 / 幂等 / 用户隔离
scripts/
  verify-css.cjs      校验构建产物中的 CSS 与源 CSS 等价
  ratelimit-probe.cjs REST 变异请求限流实测探针（4.9.0，阶段 A）：默认 `--dry-run` **零网络请求**，
                      发请求须显式 `--run`；硬约束见 `docs/research-ratelimit-protocol.md` §4.7
```

> 循环依赖（4.9.0 后仍是唯一一个 SCC）：`ui/tagFilter.ts ↔ starCheck.ts ↔ restore.ts ↔ ui/cards.ts ↔ filters.ts`。环内**零个顶层可执行语句**（只有声明），所有导出都是函数声明，靠提升解析，不会在模块初始化阶段取值，因此安全。**新增模块时不要把互相引用的值用在模块顶层** —— `tokenConfig.ts` 独立成模块、`getGitHubPat` 做成 `export const getGitHubPat = getToken` 的函数别名，都是为了让环外的东西（PAT 读取）保持在环外。


## 4. 数据流

```
GitHub API (PAT)                                GitHub DOM（无缓存 / 详情页）
    │                                                │
    ├─ scheduleProbeSync() 进页 idle 自动（冷却 60s + 有 PAT → 统一 runFullSync('auto')）
    │        │                                      ├─ 详情页 ─► watchRepoStarState（4.8.0 起仅监听 unstar 宽限期，不再写缓存）
    │        └─ scanStarred() 单遍条件扫描          └─ 无缓存首访 ─► 原生页 + .gsm-setup-banner
    │             │                                   （保存成功 savedHandler 自动 runFullSync → transformAndReveal）
    │             ├─ 新增/恢复 ─► saveRepoData / markRepoStarred
    │             ├─ 远端无本地有 ─► applyExternalUnstar（宽限管线）
    │             └─ 交集 ─► 回填 starredAt + 刷新元数据（仅正文页条目）
    │              全程写：GM_setValue (stars_repo_cache + stars_full_sync_meta)
    │
    └─ Stars 列表页（hasApiData() = true）
         │
         ├─ transformStarsList() ─► 藏原生列表/原生分页器（stars-original-hidden）
         │        │
         │        ├─ renderBrowsePage(page) ─► buildCardFromCache() ─► 缓存卡片 DOM
         │        │        ├─ createStarButtonForCached()（API PUT/DELETE）
         │        │        ├─ renderTags() / renderNotes()
         │        │        └─ updateLocalPagers()（顶/底 gsm-local-pager 同步页码与 disabled）
         │        ├─ mountTopPager() / mountSyncButton()
         │        └─ 渲染标签栏 + interceptSearchForm() + applyFilters()
         │
         ├─ 分页：pagination.ts 拦 data-gsm-page ─► renderBrowsePage()（零网络零 Turbo）
         ├─ 退出：exitCustomMode() ─► pushState('?tab=stars')
         └─ 搜索：queryRepos() 纯本地全文（语言不参与匹配）
```

## 5. 存储模型

脚本用 `GM_setValue` / `GM_getValue` 持久化，键名集中在 `src/constants.ts` 的 `STORAGE_KEYS`。

### `stars_repo_cache`

仓库元数据缓存（所有用户共享）。

```jsonc
{
  "123456": {                          // repoId（GitHub 仓库数字 ID）
    "name": "owner/repo",              // 仓库全名
    "desc": "...",                     // 描述
    "lang": "TypeScript",              // 主语言
    "stars": 1234,
    "forks": 56,
    "updatedAt": "2026-09-01T00:00:00Z",   // = REST pushed_at（最后 push；「Recently active」排序依据，卡片相对时间现算源）
    "starredAt": "2026-08-01T00:00:00Z", // star 时间（同步回填；「Recently starred」排序依据）
    "private": false, "fork": false, "isTemplate": false, "mirror": false, // Type 筛选四标志
    "ts": 1708000000000                // 缓存写入时间
  }
}
```

> 颜色不存仓库上：`langColor` 字段已删除，渲染走 `stars_lang_colors` 全局映射（只由语言名决定）。

### `stars_pending_delete`

待删除区，存放已 unstar 但处于宽限期的仓库数据。

```jsonc
{
  "123456": {
    // ... 与 repo cache 相同的字段
    "unstarredAt": 1708000000000,   // unstar 时间戳
    "_tags": ["tag1", "tag2"],      // 备份的标签
    "_note": "备注文本"             // 备份的备注
  }
}
```

`unstarredAt` / `_tags` / `_note` 类型上可选：`markRepoStarred()` 恢复数据前会删掉它们，再把条目挪回 `stars_repo_cache`。

### `stars_tags_<userId>` / `stars_notes_<userId>`

每用户标签 / 备注数据，按 GitHub 用户 ID 隔离（ID 取自 `meta[name="octolytics-dimension-user_id"]`）。

```jsonc
// stars_tags_<userId>
{ "123456": ["frontend", "tool"], "789012": ["backend"] }
// stars_notes_<userId>
{ "123456": "这是一条备注" }
```

> `stars_tags` / `stars_notes`（无用户隔离）是旧键，`migrateTagsIfNeeded()` 负责标签迁移；备注旧键仍作为取不到 userId 时的回退键。

### `github_pat`

字符串，classic token（`ghp_...` classic PAT 或 `gho_...` OAuth app 授权）或 `github_pat_...`（fine-grained），空串 = 未配置。**不写 localStorage 镜像**（`gm.ts` 的 `SENSITIVE_KEYS`：lsWrite 跳过、gmGet 迁移时清历史镜像，XSS 防护）。仅用于 `Authorization: Bearer` 调 `api.github.com`；提示中只显示前 12 后 4 位掩码。

**REST 写路径只支持 classic token**（`docs/adr/0004-write-requires-classic-pat.md`）：fine-grained PAT 对「不属于本人、也不属于本人所属组织」的公开仓库只有 read-only，写操作实测 `403 Resource not accessible by personal access token`；GitHub App token 被官方 OpenAPI 标 `enabledForGitHubApps: false`，根本不可用；OAuth app token（`gho_`）走 scope 体系，与 classic PAT 同构。**但写路径不止 REST 一条**：拿不到 classic token 时改用浏览器登录会话走网页端点（`docs/adr/0006-web-endpoint-write-fallback.md`），fine-grained 用户因此仍能改星标 —— 故「只支持 classic」这句话只在 REST 通道内成立。**scope 取 `repo`**（`public_repo` 不覆盖私有仓库，会让私有仓库的 star 因权限不可见而被整表 diff 误判为外部取关）。读路径（`GET /user/starred`）不受此限，fine-grained token 同步正常——`github_pat_` 前缀**不拒绝配置**，但配置 UI 必须写明它写不了他人公开仓库（`TOKEN_KIND_HELP`，与 classic 深链并排显示）；403 提示**不得**再让用户去检查 Starring 权限。此缺口由 GitHub 控制（roadmap#600 NOT_PLANNED / #601 OPEN），将来补齐可回头放宽。

### `stars_full_sync_meta`

同步元数据与 ETag 基线。

```jsonc
{
  "etag": "\"...\"",        // 首页响应 ETag（规范形，已剥 W/ 前缀）
  "etags": ["...", "..."],  // 逐页 ETag 基线（全部 304 才算无变化；含空值则下次整表重建）
  "tailEtag": "\"...\"",    // 越界空页 ETag（条件探尾：304=仍空免额度）
  "lastFullSyncAt": 1780000000000,
  "count": 464,             // star 总数（本地分页总页数 = ceil(count / 30)）
  "dataRev": 2              // 缓存数据代次（4.8.0）：≠ DATA_REV 时 scanStarred 强制一次整表回补（字段语义变更的存量迁移阀门）
}
```

### `stars_lang_colors`

语言 → 颜色映射缓存（运行时从 linguist `languages.yml` 获取）。不按仓库存色、不硬编码。

### `stars_hide_lists`

布尔，默认 `true`（隐藏 Lists 区块）。TM 菜单「🙈 隐藏 Lists 区块」切换，见 §6。

### `LEGACY_STORAGE_KEYS`（只清不写）

`['stars_page_snapshots', 'stars_star_verdicts', 'stars_shift_pending']` —— 历史到货快照 / 裁决缓存 / 位移管线（均已删除）。`init()` 一次性 `gmRemove`（GM + localStorage 镜像同删，幂等）。

## 6. 核心机制

### 待删除区宽限期

unstar 时数据不立即删除，而是移入 `stars_pending_delete` 并记录 `unstarredAt`；24 小时内重新 star，数据、标签和备注自动恢复。超期条目在下次脚本加载时由 `cleanupExpiredUnstarred()` 清理。

### 外部 unstar 检测

星状态真相**只由整表 diff 权威判定**：扫描远端列表，远端无而本地有 → `applyExternalUnstar()`（宽限管线 + 幂等自愈：已入宽限区不重复写区但仍清缓存脏态）。逐条双 404 核对队列、到货快照、位移挂起等历史链路已随 API 主模式整体移除。

切片混合模式下，local-only 嫌疑先逐条 `checkStarredGone()`：204 = 切片平局误报（保留）/ 404 = 真取关 / null = 本轮不动 —— 防同秒 `starred_at` 跨 304|200 边界互换造成假取关。

### 每用户标签隔离

存储键包含用户 ID，同一浏览器下不同 GitHub 账号的标签 / 备注互不干扰。

### 导入导出（4.7.0，**不新增存储键**）

导入导出只读写既有键（`stars_tags_<uid>` / `stars_notes_<uid>` / `stars_repo_cache`），因此没有新的 `STORAGE_KEYS` 条目。导出包是**一次性文件**，不落盘到 GM 存储。

```jsonc
{
  "kind": "github-star-manager-export",     // 协议身份，永不随脚本改名变动
  "schemaVersion": 1,                       // 字段增删才 +1
  "exportedAt": "2026-09-25T02:30:00.000Z", // ISO 8601 UTC（文件名给人看，此字段给程序看）
  "user": { "id": "12345" },               // 自声明归属；repoId 键不含命名空间，故导入侧必须显式校验
  "data": {
    "tags": { "<repoId>": ["tag"] },
    "notes": { "<repoId>": "文本" },         // 已剔除 trim 后为空的项；非空文本不 trim
    "repoCache": { "<repoId>": { "name": "..." } } // 只含有标签或有备注的仓库
  }
}
```

**不含**：`github_pat`（敏感）、`stars_full_sync_meta`（ETag 基线与 token 身份 + 远端瞬时状态绑定，跨设备导入会让「全 304 = 无变化」误判为「缓存即现值」）、`stars_pending_delete`（临时状态）。
合并语义与拒绝路径见 `docs/adr/0001-export-import-format.md`。

**导入后不自动同步**（4.9.0，`docs/adr/0005-no-auto-sync-after-import.md`，推翻 `0001` 原段落）：导入是数据搬运，落盘即完成，是否拉远端由用户自己决定（标题行 Sync / TM 菜单）。导入的条目若远端不存在该 star，会在下一次同步走既有「外部取关 → 宽限期备份」管线；收尾只做「Stars 页且网格已存在时重绘」。

导入导出**不新增 `@grant`**（`GM_download` 除外，4.7.0 新增）：导出**只用 `GM_download`（Blob 直传），刻意不做原生 `<a download>` 兜底**——原生下载能绕过 TM 的扩展名白名单，等于架空用户的安全设置。TM 侧需开启下载功能且扩展名在白名单，否则**不抛错、只走 `onerror` 回 `not_whitelisted`**（`gmDownloadFile` 观测不到，见 §6）。

导入是**大窗**（4.8.1）：TM 菜单点击 → 全屏遮罩 + 中央拖放大窗（样式全内联，不依赖 Stars 视图的样式表，任意页可用；点遮罩空白 / Esc / × 关闭，**无超时**——用户可能正忙着找文件）→ 窗内**真实点击**「选择文件」（页面级 transient user activation → 唤起 `<input type="file">`）或**拖拽** JSON 进窗（drop 事件不需要 activation，`DataTransfer` 直接给 `File`）→ `FileReader` 读取。拖入时整窗高亮（边框/背景变色 + 提示文案切换「松手开始导入」）。

**不能**在 TM 菜单回调里直接 `input.click()`：扩展 UI 的手势无法转发给页面（TM 维护者 derjanb 原话，[tampermonkey#1827](https://github.com/Tampermonkey/tampermonkey/issues/1827)，NOT_PLANNED），Chrome **静默拒绝**（实测连控制台都无报错）——4.7.0 的实现即因此从未工作过。

**为什么控制台能弹、脚本不能**（用户问过，已实测）：DevTools 控制台手动回车执行时，DevTools 走的是 CDP `Runtime.evaluate` 并**自带 `userGesture:true`**，于是浏览器把这次求值当作「用户手势」；普通页面脚本/userscript 注入的求值是 `userGesture:false`，页面内 `navigator.userActivation.isActive` 为 `false`。实测对照（新标签页、瞬时激活已过期、`Page.setInterceptFileChooserDialog` 拦截避免真弹）：同一个 `input.showPicker()` 调用，`userGesture:false` → `NotAllowedError: HTMLInputElement::showPicker() requires a user gesture`；`userGesture:true` → 成功打开（被拦截）。**结论：能让选择器打开的从来不是「控制台」这个界面，而是 DevTools 附带的 userGesture 标志；页面脚本无从获得该标志。**

已实测排除的旁路：合成事件（isTrusted=false）、label 原生转发（两种关联方式）、`requestIdleCallback` 延迟、prompt 蹭激活（`prompt/confirm/alert` 不在 activation-gated 名单所以能弹，但不赠送激活态）、`window.open`（自身 gated 且消耗激活）、`GM_openInTab`（新页无激活态、@match 外脚本不跑）、`showOpenFilePicker`（github.com 下 API 未暴露）。弹文件选择器的唯一通行证 = **页面上下文内的真实用户输入**（点击/键盘/拖拽）。

### 详情页（4.9.0：只清扫，不监听）

仓库详情页分支只做**一件事**：`cleanupExpiredUnstarred()`（宽限期到期清扫）后提前返回。4.9.0 删除了 `watchRepoStarState()` 与旧版 `form[action$="/unstar"]` 监听（决策 D17）：**星状态真相只由整表同步判定，与用户从哪个页面点的无关**，详情页也不再触碰 GitHub 拥有的 star 按钮 DOM。详情页仍会显示同步简报（TM 菜单手动同步时）。

4.8.0 删除了「详情页提取元数据写缓存」（原 extract.ts）：它写的字段（name/desc/stars/forks）API 全覆盖，而它独有的时间字段是脏数据源——DOM 第一个 `<relative-time>` 与 API 语义不一致（曾互相覆写 `updatedAt`），缓存的相对时间文本（`updated`）永不刷新。**详情页访问不再提前刷新缓存**，元数据一律等同步。

### `updatedAt` 语义 = `pushed_at`（4.8.0 修正）

「Recently active」排序键 `updatedAt` 现取 REST `pushed_at`（最后 push 到任一分支），此前误用 `updated_at`（仓库对象元数据变更，改描述/被标星都会动它，与代码活跃度无关）。依据：GitHub 官方 OpenAPI `sort-starred` 参数原文「`updated` means when the repository was last pushed to」（渲染页丢失该句）；考证记录见 `docs/research-updated-vs-pushed-at.md`。

卡片右下角的 `Updated X ago` 不再落盘（`updated` 字段已删），渲染时由 `formatRelative(updatedAt)` 现算——相对时间随渲染刷新，且不再有「2 条缺文本」的空窗。

存量数据靠 `stars_full_sync_meta.dataRev`（`constants.ts DATA_REV`）迁移：代次不匹配 → `scanStarred` 强制一次无条件整表回补（与 4.2.0 Type 标志回补同一阀门模式），整表重建时写入当前代次。`loadRepoCache()` 读取即清洗 `updated` / `langColor` 两个死字段。

### 同步与进页自动探测

`fullSync.ts`：`GET /user/starred?per_page=100&page=N&sort=created&direction=desc` + `Accept: application/vnd.github.star+json`（带 `starred_at`）。

**单遍扫描 `scanStarred()`**：

- 有基线（≤ 48h TTL、逐页 etags 完整）→ 波次条件扫 `1..N+1`。**不早停**（200 的 body 要收割）；尾页带 `tailEtag` 条件探增长（304 = 越界仍空免额度、不算内容不算变化；200 空 = 刷新；200 有货 = 尾页转正为内容页、清空 tailEtag；304 沿用旧值绝不回读）。
- 全 304 → 免额度早退。
- 200 页 `parseItem` 收正文；**304 页用本地切片组装**（`buildLocalSlices`：缓存按 `starred_at` 降序每 100 切页 —— 304 = 内容与上次同步逐字节一致 = 缓存即现值）。
- 无基线 / 超 TTL / 阀门失守（缓存缺 `starred_at`、切片盖不住、正文×切片重叠 <50%、尾页满页疑增长超一页）→ `pullAllUnconditional`（Link 头预知总页 + 波次拉全，兜底后 tailEtag 清空待首探）。

**整表 diff 三向**：新增/恢复 → `saveRepoData` / `markRepoStarred`；远端无本地有 → `applyExternalUnstar`；交集 → 回填 `starredAt` + 元数据刷新（只对正文页条目做，切片条目 304 证明未变则不写不数；`updated` 展示文本保留旧值）。

**完整性红线**：任何不完整信号（分页中断、解析失败、超 200 页上限、速率余量 <10）都抛错、catch 不改任何数据 —— 半张表会把未拉到的页全判 unstar。

**波次并发**：`runWaves()` —— `WAVE_CONCURRENCY = 6`（官方容忍区间上限，基线 N 页 + 尾页恰好一波到齐）、发波间隔 ≥ `WAVE_GAP_MS = 1000ms`。任一任务失败 → `AbortController` 中止在途 + 停波，`pickRealError()` 滤掉主动 abort 的 AbortError。

**条件请求**：所有 fetch 带 `cache: 'no-store'`（GitHub API 回 `Cache-Control: public, max-age=60`，浏览器缓存会直接回 200 或把本地 304 合并成 200 返回 JS，导致误判「有变化」）。`normEtag()` 剥 `W/` 前缀统一规范形（弱比较等价，实测 304）。正确带 Authorization 的 304 不计主限流。

**触发入口**（三处等价）：TM 菜单「🔄 立即全量同步」、横幅「立即同步」、标题行 Sync 按钮；另有进页 `scheduleProbeSync()`（冷却 60s + 有 PAT → `runFullSync('auto')`）。

**`hasApiData()`** = 有 PAT + `meta.count > 0`，决定「缓存网格」还是「原生页 + 配置横幅」。

### 写路径（4.9.0：两条通道，静默分派）

`starWrites.setStarState(patOrEmpty, 'owner/repo', wantStar)` 是**唯一**的写入口，结果归一为
`{ok:true, via}` 或 `{ok:false, reason, status, detail}`（不抛错）。通道由它**静默分派**，调用方与用户都不感知（ADR 0006）：

| 条件 | 通道 | 成功判据 |
|---|---|---|
| token 是 classic PAT（`ghp_`）或 OAuth（`gho_`） | REST `PUT`/`DELETE /user/starred/{o}/{r}`，`Bearer` | `204`（`304` 一并当成功） |
| 无上述 token，**或** REST 返回权限 403，且 `hasWebSession()` | 网页端点 `POST /{o}/{r}/star`（`/unstar`），Cookie 会话 | `200`，**且在页面上存在该仓库表单时**复核方向已翻转（未翻转即失败） |

网页端点的关键事实（实测见 `docs/research-web-star-endpoints.md` §3.5）：

- 凭据 = Cookie 会话（`credentials:'same-origin'`）+ `GitHub-Verified-Fetch: true`；**不发** `X-Fetch-Nonce`、**不发** `X-GitHub-Client-Version`。
- `authenticity_token` 是 **per-form** 且与 action+method 绑定（stars 页实测 60 表单 60 唯一值）→ **离页仓库不先取 token**，只带 VF 头（实测足以通过）；请求体仍是 multipart 且带 `authenticity_token` + `context`，与实测组 B 同形。
- **仅当返回 422**（Rails CSRF 失败）才回退：`GET /{o}/{r}` → `DOMParser` 取该页 `form[action="/{o}/{r}/star"]` 的真实 token → **重发一次**。故无 token 时正常 1 个请求/仓库，回退时 3 个。
- **422 的响应体是 HTML**（即便带 `Accept: application/json`）→ 一律 `resp.text()` 后再 `try { JSON.parse }`。
- **不用** `{"count":"N"}`：那是仓库 star 总数的事后快照（实测 278→277→278），不是本次动作的增量。
- 会话检测是**双重判据**：`body.logged-in` **且** `meta[name="user-login"]` 的 content **非空串**（只看 meta 是否存在是错的）；`form[action$="/unstar"]` 不能当登录判据。
- `form[action="..."]` 必须**精确**匹配：`action$="/star"` 会被 `/unstar` 命中。

失败原因 → 用户文案见 `writeFailureMessage()`（结果导向，**不暴露通道**）。`requires-classic` 专门给「fine-grained token + 无登录会话」——不能笼统说「没配 token」。

### 全局串行变异队列（4.9.0）

`mutationQueue.ts`：卡片星按钮与恢复**共用同一个队列**（官方 best-practices 的 serial/queue + 「每个请求间至少 1 秒」两条要求；Octokit plugin-throttling 对写请求默认即 `{maxConcurrent:1, minTime:1000}`）。

- 间隔按**开始时刻**算（`MUTATION_GAP_MS = 1000`），首条不等待。
- `enqueueMutation()` 返回句柄：`cancelQueued()` 只对**排队中**（尚未发出）的条目生效；`done` 兑现结果，被撤销兑现 `null`。
- 卡片语义：点击 → **乐观翻转** → 入队；**排队中再点 = 撤销**（回滚外观，请求不发出）；执行中点击忽略。
- 卡片在途操作用 `inflight: {handle, target}` 记录，且 `.then` 里**必须做身份校验**（`inflight.handle === handle`）——否则「撤销 → 重新点击」会让旧条目的回调清掉**新操作**的护栏，同一仓库被重复入队。

### REST 限流实测（4.9.0 阶段 A，**尚未执行**）

队列的 1000ms 间隔目前来自官方 best-practices 与 Octokit 默认值（两个独立来源一致），**没有本地实测数据**。
`scripts/ratelimit-probe.cjs` 是按 `docs/research-ratelimit-protocol.md` §4 实现的最小风险探针，用来回答
「`PUT/DELETE /user/starred` 会不会触发二级限流、primary 记账是 1 还是 5」：

- **默认 `--dry-run`：零网络请求**，只打印计划、硬约束与判定矩阵；真发请求必须显式 `--run`。
- 硬约束（协议 §4.7，CLI 无法抬高）：变异请求 ≤60 次、只对**自有**仓库（owner == token 登录名，否则拒绝运行）、
  凭证必须是 classic/OAuth（`x-oauth-scopes` 缺失即拒绝）、严格串行无并发、净状态不变（S0 → S0，结束时校验）、
  任一次 403/429 立即整轮停止并按 60→120→240s 指数退避（≤3 次）、不做并发探测。
- 判定不以 `x-ratelimit-*` 为准：二级限流的**唯一**可靠信号是响应体含 `secondary rate limit`
  （三个独立实测样本在被 403 时 `x-ratelimit-remaining` 分别为 21 / 22–27 / 4840，且 `retry-after` 可能缺失）。
- 结论产出到 `docs/research-ratelimit-measurement.md`。**执行前置**：自有仓库 + classic PAT（scope `repo`）+
  能关闭本脚本的自动同步 + 出口非共享/VPN；任一不满足就跳过、不阻塞实现。

### 恢复与变化简报（4.9.0）

`restore.ts`（编排）+ `ui/restoreMenu.ts`（窗口）+ `fullSync.ts` 收尾。

- **恢复 = 真实远端写请求**：`restoreOne()` 走队列 → `setStarState(..., true)` → 成功才 `markRepoStarred()`（复原标签/备注）+ `syncCardAfterStarChange()`。**禁止只做本地回滚**（那会制造「本地有星、远端无星」，下一轮同步又判成外部取关）。
- `restoreMany()` **逐条 await**（严格串行）、执行中**可取消**（只停后续，已发出的不回滚）、**不自动重试**、无数量阈值。
- TM 菜单「♻️ 恢复已取消的 star（24h 内）」= 可勾选 + 一键「恢复选中」+ **每行一个 ☆ 恢复 按钮**；`confirm` 显示条数与预估耗时（≥1s/条）。
- **变化简报**（`emitSyncReport`）：任何 `runFullSync` 路径收尾都弹；口径只有「取消 star / 新增 / 恢复」，**元数据刷新只进控制台**；无变化也弹「无变化（共 N 个 star）」（304 免额度早退路径同样弹）；**不判重**；每条外部取关**各弹一条带「恢复」按钮的通知**。
- **通知栈**（`ui/notifications.ts`）：右上角、新条目从底部追加、无条数上限、3s 自动消失、**悬停整个区域暂停计时**、带动作按钮的条目成功后原地划掉并重置 3s。样式全内联（可出现在任意 github.com 页面，不依赖 Stars 视图注入的样式表）。
- **失败一律 `alert` 一行文字**（ADR 0003）：写失败、单条恢复失败、批量恢复的失败汇总都走 `alert`——3s 的通知承载不了「唯一可能造成数据丢失的事件」的反馈。
- **重绘**：有增删差异或可见元数据更新时才 `applyFilters({keepPage:true})`；`source === 'auto'` 且最近 10s 内有用户交互时，改成弹一条可点击的「列表有 N 项变化，点击刷新」。

### 全缓存搜索与筛选联动

搜索与筛选统一走 `queryRepos()` 单管线：关键词按空白拆词，每词必须命中 作者 / 仓库名 / 描述 / 标签 / 备注 之一（**语言不参与全文匹配**，避免 `ASC` 命中 `javascript`）；约束叠加 = type（多选 OR）∩ lang（多选 OR，大小写不敏感；`LANG_NONE='(none)'` = 无语言）∩ tags（多选 AND）∩ 关键词（AND）。命中词以 `<mark class="gsm-search-hit">` 高亮（四字段、大小写不敏感、只包文本节点、跳过输入控件）。

结果统一**本地分页**（browse 与筛选态都走 `renderBrowsePage`，30/页）。自建 Sort 菜单四项：Recently starred / Recently active / Most stars / Most Forks（末项为本地扩展）。排序规则（`sortResults()`）：4 键 × asc/desc，**缺失值恒沉底不随方向翻转**，平局按仓库名决胜；`created` 按 `starredAt`（未回填沉底）；默认 `sort='created'` + `direction='desc'` = 原生默认。方向与 Sort 合并为 split button（方向态只由 ↑/↓ icon 表达）。

初始值由 `initFiltersFromUrl()` 从 URL 参数对齐（**URL 只读不写**）：`language` / `type` 支持逗号分隔多值，`none`/`(none)` = 无语言，非法值丢弃，大小写归一（哨兵合并先于去重）。

### 退出筛选（Clear filter 本地化）

清 tags/langs/types/search、**保留 sort/direction** → 本地渲染第 1 页 + `history.pushState('?tab=stars')` 干净地址栏（不再整页导航）。原生 Language/Sort 常驻隐藏、本地控件常驻。

### Hide Lists 开关

TM 菜单「🙈 隐藏 Lists 区块（开/关）」控制 Stars 页 Lists 原生区块可见性，持久键 `stars_hide_lists`（默认 `true` = 隐藏）。

可见性由**两条腿**共同控制，切换时都要动（`ui/hideListsMenu.ts` 的 `onToggle`）：

1. **CSS 门控类**：`base.css` 第 4 节全部 Lists 隐藏规则（含 CSS-only `:has()` 兜底）都带 `html.gsm-hide-lists` 前缀；`document-start` 同步 `applyHideListsGate()`（GM 缺席时走 localStorage 镜像兜底），开关关闭时连「JS 首跑前一瞬」都不会闪隐。
2. **JS 标记**：`hideListsSection()` 内部首行读开关 —— 关闭时不打标记并清残留（`clearListsHiddenMarks()`），turbo 重渲染的既有调用点零改动。

配置面板落位按开关分流（`index.ts` 的 `placeSetupBanner`）：

- 开（默认）→ **插到 Lists 槽位节点之前** `slotTarget.before(bar)`（插入并存；blankslate / `#profile-lists-container` 节点保留不销毁 —— 隐藏本就由 `hideListsSection` 标记 + 门控 CSS 负责，节点留着才能让关态撤门控后原样复活）。
- 关 → `host.prepend` 挂网格列顶（不占 Lists 位置）。

**开关切换 invariant**：Lists 可见性只能经 `applyHideListsGate()`（CSS 腿）+ `hideListsSection()`（JS 腿）改变，不得直改 `html` 类或标记类；切换后必须刷新 TM 菜单标签（优先 `GM_registerMenuCommand(..., { id })` 原地更新，id 不可得时回退 unregister + 重新注册）；已存在的配置面板经 `setHideListsRepositionHandler` 回调重挂到新落位。

## 7. 状态管理约定

所有跨模块可变状态集中在 `src/state.ts` 的 `filterState`：

```ts
filterState.tags          // 已选标签（多选 AND，需全部命中）
filterState.langs         // 已选语言（多选 OR；大小写不敏感；[] = 全部；可含 LANG_NONE）
filterState.types         // 已选 Type（多选 OR；[] = All）
filterState.sort          // 'created' | 'updated' | 'stars' | 'forks'（默认 'created'）
filterState.direction     // 'desc' | 'asc'（默认 'desc'；缺失值恒沉底不随方向翻转）
filterState.searchQuery   // 当前搜索词，'' = 无搜索
filterState.page          // 本地浏览页码（1-based）
filterState.totalPages    // ceil(count / NATIVE_PAGE_SIZE)
```

是否处于筛选态用 `hasActiveFilter()` 派生（tags/langs/types/search 任一激活）；sort/direction 属浏览状态，不算筛选、不进信息条。「结果集变、条件没变」的调用（如 unstar 翻卡）传 `applyFilters({ keepPage: true })` 保页码。

用对象而不是 `export let`，是因为 ESM 的导入绑定对导入方是只读的，无法跨模块重新赋值。

## 8. 功能扩展指南

### 添加新的卡片字段

1. `fullSync.ts` 的 `parseItem`：从 API repo 对象回填（唯一写入口；DOM 提取已于 4.8.0 删除）
2. `types.ts`：在 `RepoData` 上补字段
3. `ui/cards.ts` 的 `buildCardFromCache()`：渲染缓存卡片
4. `fullSync.ts` 的 `parseItem`：从 API 条目回填（若远端有该字段）
5. `styles/base.css`：加样式

### 添加新的筛选条件

1. `state.ts`：加状态字段
2. `ui/tagFilter.ts`：加筛选 UI（图标按钮 + Popover）
3. `filters.ts`：在 `queryRepos()` 统一管线里加约束，facet 候选计算同处扩展（`computeTagCandidates` / `computeLanguageCandidates` / `computeTypeCandidates`）
4. **候选刷新 invariant**：候选列表只能由 `applyFilters() → refreshTagFilterBar()` 统一原位刷新，不得只在自身交互路径重绘 —— 否则其它维度变化后候选残留脏值，空结果集取消勾选后面板永久空白。
5. **控件刷新 invariant**：常驻筛选控件（Type/Language/Sort）容器**只创建一次**（`updateLocalFilterControls` 缺失才建），内容只能原位刷新 —— 整体重建会拆掉开着的多选 popover。

### 添加新的存储键

1. `constants.ts`：在 `STORAGE_KEYS` 里加键名（敏感键同步加进 `gm.ts` 的 `SENSITIVE_KEYS`）
2. `storage/` 下新建模块（或复用现有模块）实现 load/save
3. 如需迁移，参考 `migrateTagsIfNeeded()`

### 添加新的 SVG 图标

在 `constants.ts` 声明为 `const` 后引用，不要内联在构建 DOM 的代码里。

## 9. 样式与断点

- 样式写在 `src/styles/*.css`，由 `index.ts` 以 `?inline` 导入，再在 **Stars 页面** 通过 `gmAddStyle()` 注入。
- 布局样式（base + wide）只在 Stars 视图存在：离开时整表移除，原生布局立即恢复；`persistent.css` 是常驻小表（注入后不移除）。注入顺序恒为「常驻表 → 主表」。
- 断点常量（`MOBILE_BREAKPOINT = 768`、`WIDE_BREAKPOINT = 1200`）在 `constants.ts`，**CSS 中的 `@media` 数字是手写同步的**，改断点要同时改两处。
- 样式必须只在 Stars 页注入：规则会改写 GitHub 的 `.Layout`（侧边栏压到 180px），在仓库详情页注入会误伤布局。
- `vite.config.ts` 显式设置了 `build.cssTarget`：esbuild 默认会按现代 baseline 把 `@media (min-width: 768px)` 压成区间语法 `(width>=768px)`（Safari 16.4+ 才支持），降低 css target 可保留 `min-width`。
- **隐藏 GitHub 原生区块的两个坑**：① GitHub 工具类带 `!important`（如 `.d-flex { display: flex !important }`），JS 里 `el.style.display = 'none'` 会被压过，必须 `el.style.setProperty('display', 'none', 'important')`；② 间距工具类加了 `tmp-` 前缀（`my-3` → `tmp-my-3`），纯类名选择器会静默失配。现成做法见 `dom.ts` 的 `hideListsSection()`：用语义特征（`h2.f3-light` + 文案）定位，打 `.stars-lists-hidden` 标记类，隐藏规则写在 `base.css` 第 4 节。

## 10. 约束

- **产物单文件**：构建产物必须是单个 `.user.js`，不得使用 `@require` 拉外部运行时。
- **无运行时依赖**：只用浏览器原生 API + GM API。`package.json` 里的依赖全部是 devDependencies。
- **仅桌面端**：`transformStarsList()` 首先检查 `isDesktop()`；所有 CSS 包在 `@media (min-width: 768px)` 内。
- **三栏响应式布局**：768–1199px 隐藏左右侧边栏只留主内容区；≥1200px 为左侧资料栏（180px）+ 中间卡片网格 + 右侧 Starred Topics（220px）。
- **GM API 用法**：一律走 `src/gm.ts` 的 `gmGet / gmSet / gmRemove / gmAddStyle / gmRegisterMenuCommand / gmUnregisterMenuCommand / gmOpenInTab / gmFetchText`（**调用时**判定可用性，document-start 时晚到/缺席都安全，附 localStorage 兜底与迁移）；**禁止** `import { GM_* } from '$'`（bundle 顶部一次性捕获会在 document-start 固化成 undefined）。`@grant` 在 `vite.config.ts` **显式声明**，不要依赖插件自动推断。
- **敏感键不入镜像**：新增敏感存储键必须同步加进 `gm.ts` 的 `SENSITIVE_KEYS`。
- **改名类改动必须做模糊扫描**（4.6.0 教训）：机械替换只覆盖它认识的精确串（如 `github-stars-grid`）。用户可见文案与 URL 深链里常是**空格分词**的形态（`Stars Grid`、`?name=GithubStarsGrid`），精确串 grep 扫不到。改名后必须补一轮模糊扫描（`Stars Grid` / `StarsGrid` / `stars-grid` / 空格变体）并 grep 产物本身，而不只是 grep 源码。
- **名字单源**：脚本名/产物名只写在 `vite.config.ts` 的 `SCRIPT_SLUG` / `SCRIPT_NAME`；需要给源码用时经 `define` 注入 `__SCRIPT_SLUG__`（`src/vite-env.d.ts` 声明）。
- **改产物名/文案必须重打 dist 后再验证**：`dist/*.user.js` 是安装物；改源码不重打重装，真机看到的仍是旧文案（4.6.0 曾因此误判「已改名」）。

## 11. 测试

### 导入导出纯逻辑（4.7.0）

合并语义与校验拒绝路径直接决定数据安全，因此用无浏览器的 node 断言覆盖（不需要 GitHub 页面）：

```bash
pnpm test:exportimport   # = prepare.cjs（编译被测模块 → tests/exportImport/.build/）+ run.cjs（51 项断言）
```

覆盖范围（改动 `storage/exportImport.ts` 或 `storage/notes.ts` 的判空逻辑后必跑）：

- 导出**不含** `github_pat` / 同步元数据（ETag）/ 宽限期备份；`repoCache` 只含有标签或有备注的仓库；空白备注不进包、非空备注不被 trim；
- 校验：`kind` / `schemaVersion` / `user.id` 缺失或不匹配 / 结构不合法 全部拒绝（不部分解析、不写键）；
- 合并：标签并集且本地在前、备注导入优先但空值不覆盖、仓库元数据只补空缺；
- 幂等：同一包连导两次，第二轮 `tagsAdded/notesApplied/repoCacheAdded` 全为 0；
- `saveNote` 判空 = trim 后为空；存储按用户 ID 隔离。
- `loadRepoCache` 读取即清洗：`updated` / `langColor` 死字段与脏 `lang` 一次性剔除并持久化（4.8.0）。


### 构建产物 CSS 等价性

```bash
pnpm build && node scripts/verify-css.cjs
```

比对 `src/styles/*.css` 与产物内联 CSS 的「选择器 → 声明属性集合」，输出应只含注释、等价缩写（如 `top/right/bottom/left` → `inset`）等预期差异。

### 浏览器冒烟测试

`tests/smoke/fixture.html` 是仿 GitHub Stars 页面的最小 DOM，内置 GM API stub（内存 store）并加载 `dist/github-star-manager.user.js`；`fixture-detail.html` 同理仿详情页。断言脚本用 `agent-browser-cli` 注入执行：

```bash
pnpm build
# 打开 fixture（必须带 ?tab=stars，否则脚本会判定为非 Stars 页而提前返回）
agent-browser-cli open "file:///<abs-path>/tests/smoke/fixture.html?tab=stars"
# 用返回的 tab id 跑断言
agent-browser-cli exec --tab <id> --file tests/smoke/assert-transform.js
agent-browser-cli exec --tab <id> --file tests/smoke/assert-search.js
```

> 快速构建期约定：不跑 smoke 测试，改完只 `pnpm check`，由用户在真实页面判断。

## 12. 发布

1. 改 `package.json` 的 `version`（`vite.config.ts` 直接读取它写入脚本头）。
2. `pnpm check`。
3. 跑第 11 节的两项验证。
4. 用 `dist/github-star-manager.user.js` 覆盖安装，或作为 release 附件发布。

## 13. 待办

见仓库根目录 `todo`。
