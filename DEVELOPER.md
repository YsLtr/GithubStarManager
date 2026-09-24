# GitHub Stars Grid View — 开发者文档

## 1. 项目概述

**GitHub Stars Grid View** 是一个 Tampermonkey 用户脚本，将 GitHub 个人主页的 Stars 标签页从默认的列表视图改为卡片网格视图，同时缩小左侧个人资料栏以最大化仓库展示空间。

- **运行环境**: Tampermonkey / Violentmonkey 等用户脚本管理器
- **匹配页面**:
  - `https://github.com/*?tab=stars*` — Stars 列表页（主功能）
  - `https://github.com/*/*` — 仓库详情页（数据缓存）
- **生效条件**: 仅桌面端（视口宽度 >= 768px）
- **产物**: 单个 `dist/github-stars-grid.user.js`（无运行时依赖）

## 2. 技术栈与命令

| 项 | 值 |
|---|---|
| 构建 | Vite 8 + [vite-plugin-monkey](https://github.com/lisonge/vite-plugin-monkey) 8 |
| 语言 | TypeScript 7（strict，`noUnusedLocals` / `verbatimModuleSyntax`） |
| 包管理 | pnpm（`pnpm-lock.yaml` 已提交） |

```bash
pnpm install        # 安装依赖
pnpm dev            # 开发服务器：改动走 HMR，无需手动往 Tampermonkey 里粘贴
pnpm build          # 产出 dist/github-stars-grid.user.js
pnpm typecheck      # tsc --noEmit
pnpm check          # typecheck + build
```

### dev 模式怎么用

`pnpm dev` 启动后，插件会（首次或脚本头变化时）自动在默认浏览器打开安装页：

```
http://127.0.0.1:5173/__vite-plugin-monkey.install.user.js
```

Tampermonkey 里会多出名为 `server:GitHub Stars Grid View` 的脚本（与正式版并列，靠前缀区分）。
它只是个 loader，实际代码通过 ESM 从 dev server 拉取，因此改代码即时生效。

> 注意：dev 模式为了兼容各种运行时会把 `@grant` 放宽成 `GM.*` 全家桶，这是插件行为；正式 `build` 产物里 `@grant` 是按代码实际用到的 API 精确生成的（当前为 `GM_addStyle` / `GM_getValue` / `GM_setValue`）。


### dev 模式在 github.com 上的两个前置条件

GitHub 的 CSP 是 `script-src github.githubassets.com 'nonce-…'`，白名单里没有 `127.0.0.1`。dev 模式的 loader 要往页面里插一个 `<script type="module" src="http://127.0.0.1:5173/…">`，会被这条策略直接拒绝，控制台表现为 `Failed to fetch dynamically imported module`。**这不是本项目代码的问题，插件也绕不过去**（参见 [vite-plugin-monkey#205](https://github.com/lisonge/vite-plugin-monkey/issues/205)）。所以：

1. **开发用浏览器要装一个放行 CSP 的扩展**，并只把 `github.com` 加进白名单（别全局关，风险大）：
   - [CSP Unblock](https://chromewebstore.google.com/detail/csp-unblock/lkbelpgpclajeekijigjffllhigbhobd)（可按域名开关，推荐）
   - [Disable Content-Security-Policy](https://chromewebstore.google.com/detail/disable-content-security/ieelmcmcagommplceebfedjlakkhpden)
2. **放行 Local Network Access 权限提示**：Chrome 138+ 起，公网页面访问 `127.0.0.1` 需要用户授权，首次会弹「查找并连接本地网络上的设备」，必须点允许。若请求被静默拦截，可在 `chrome://flags/#local-network-access-check` 关掉该检查（仅限开发 profile）。

不想折腾扩展时，退路是 `pnpm build` 后把 `dist/github-stars-grid.user.js` 重新装进 Tampermonkey —— 构建只要 ~100ms，代价是没有 HMR。

## 3. 目录结构

```
src/
  index.ts            入口：页面类型检测、初始化、Turbo / MutationObserver 事件、样式注入
  constants.ts        断点、宽限期、存储键、SVG 常量、SORT/TYPE 菜单项
  langColors.ts       语言色引擎（4.3.0 运行时获取，不硬编码）：linguist languages.yml 拉取（gmFetchText）+ 行扫描提取 + GM 缓存 + 未命中单次补拉/回退重检 + 色点原地重涂
  types.ts            存储模型类型（RepoData / PendingDeleteEntry / TagMap / NoteMap ...）
  state.ts            筛选状态对象 filterState + hasActiveFilter() 派生判断（唯一可变全局状态）
  utils.ts            escapeHtml / isDesktop
  dom.ts              getRepoIdMeta / getToggler / isStarredInToggler（DOM 查询小工具）
  extract.ts          详情页数据提取 → 写缓存（4.0.0：列表卡提取已删，API 为权威源）
  transform.ts        列表 → 卡片网格转换
  filters.ts          筛选引擎（4.1.0 全本地化，4.2.0 Type 接管）：queryRepos 统一查询管线（type/lang/tags/search）、4 排序键×双向+名称决胜、facet 候选收窄、URL 入口匹配 initFiltersFromUrl、常驻本地筛选栏（Type/Language/Sort+方向 split button；Language 含 None=无语言仓库，4.3.2）
  search.ts           搜索表单拦截（4.0.0：纯本地，原生结果补充已删）
  gm.ts              GM API 兼容层（调用时判定；localStorage 兜底与迁移）
  boot.ts            document-start 防闪烁隐藏生命周期（FOUC）
  pagination.ts      本地分页拦截（4.0.0：只拦 data-gsm-page 零网络；原 fetch 换入路径已删）
  starCheck.ts       PAT 菜单、裁决缓存、外部 unstar 宽限管线（4.0.0：双 404 核对队列已删，P4 整表即权威确认；4.0.6：confirmExternalUnstar 幂等+自愈——已入宽限区不重复写区但**仍删缓存回写脏态**，applyExternalUnstar 返回「是否新确认」，整表 A 循环只对新确认 recordVerdict+计数，修复「每次同步恒外部 unstar 1」的并存脏态重复计数）
  tokenConfig.ts       快捷 Token 配置（Template URL 预填 starring=write + expires_in=90、剪贴板粘贴、保存回调）与 401/403(非限速) 失效上报（4.0.2：面板化 setTokenIssueHandler 替代居中弹窗，经 gm.gmOpenInTab 开页；独立成模块防 starCheck→filters→cards 循环导入）
  snapshot.ts        确认 unstar 后清历史快照（4.0.0：recordArrival/位移挂起链已删，仅留 purge 回调）
  fullSync.ts        P4 全量同步：整表 diff、star 时间回填（REST star+json）；4.0.4 手动三入口（TM 菜单 / 横幅「立即同步」/ 标题行 Sync）；runFullSync 单遍扫描 scanStarred（**4.0.8 合并快筛+整表**：条件请求一波流，全 304 免额度早退，200 页收正文、304 页本地切片复用缓存，阀门失守回落无条件整表 Link 预知总页），均经 runWaves() 波次并发（5/波、发波 ≥1s）
  storage/
    repoCache.ts      仓库缓存 CRUD
    tags.ts           标签存储 + 备注键规则 + 迁移
    notes.ts          备注存储
    pendingDelete.ts  待删除区（unstar 宽限期，含标签/备注备份）
  ui/
    cards.ts          卡片构建 + API 星星按钮（4.0.0：PUT/DELETE Bearer PAT，CSRF 双模式已删）
    tagFilter.ts      标签 pill、筛选栏（R3：原位重绘 = 共现收窄，勾选不关 popover）、pill 选中态同步；refreshTagFilterBar = 候选随约束收窄/回填/撤条的唯一入口（applyFilters 每次调用；renderTagFilterBar 已私有化，创建/撤条只经它，4.3.5）
    notes.ts          备注渲染与编辑
  styles/
    base.css          >= 768px 布局与组件样式
    wide.css          >= 1200px 三栏布局
legacy/
  github-stars-grid.v2.6.user.js   迁移前的单文件版本（冻结，仅供对照/回滚）
tests/smoke/
  fixture.html        仿 GitHub Stars 页面的最小 DOM + GM API stub + 加载构建产物
  assert-transform.js 转换/标签/备注/筛选栏断言
  assert-search.js    搜索断言
scripts/
  verify-css.cjs      校验构建产物中的 CSS 与源 CSS 等价
```

### 与 v2.6 单文件分区的对照

| v2.6 分区 | 现在的位置 |
|---|---|
| 0 Constants | `constants.ts` |
| 1 Utilities | `utils.ts` + `dom.ts` |
| 2 Storage — Repo Cache | `storage/repoCache.ts` |
| 3 Storage — Pending Delete | `storage/pendingDelete.ts` |
| 4 Storage — Tags | `storage/tags.ts` + `storage/notes.ts` |
| 5 Data Extraction | `extract.ts` |
| 6 Styles | `styles/base.css` + `styles/wide.css` |
| 7 Cards & Star Buttons | `ui/cards.ts` |
| 8 Tag UI | `ui/tagFilter.ts` + `ui/notes.ts` + `filters.ts` + `search.ts` |
| 9 DOM Transform | `transform.ts` |
| 10 Init & Events | `index.ts` |

迁移中修掉的隐式耦合：

- `extractAndCacheRepoFromDetailPage()` 原来直接引用 Section 10 里的 `repoIdMeta` 变量，现在统一走 `dom.ts` 的 `getRepoIdMeta()`。
- "当前用户是否 star 了该仓库" 的判定原来在 3 处各写一遍，现在统一为 `dom.ts` 的 `isStarredInToggler()`。
- 语言/排序按钮里重复的内联下三角 SVG 提为 `constants.ts` 的 `TRIANGLE_DOWN_SVG`。
- 排序比较器在标签筛选与搜索里各写一遍，现在共用 `filters.ts` 的 `sortResults()`。
- 存储键字面量散落各处，现在集中在 `constants.ts` 的 `STORAGE_KEYS`。

## 4. 数据流

GitHub API (PAT)                                GitHub DOM（无缓存 / 详情页）
    │                                                │
    ├─ probeAndSync() 进页 idle 自动（冷却 60s + 有 PAT → 统一 runFullSync('auto')：scanStarred 单遍扫描——4.0.8 合并快筛+整表，条件请求每次必发、全 304 免额度早退、200 页收正文 / 304 页本地切片复用（波次并发 5/波），基线缺 / 超 TTL / 阀门失守转无条件整表）
    │        │                                      ├─ 详情页 ─► extractAndCacheRepoFromDetailPage()
    │        └─ pullAllStarred() 整表 diff          └─ 无缓存首访 ─► 原生页 + .gsm-setup-banner
    │             │                                   （配置入口 = TM 菜单/横幅；保存成功 savedHandler 自动 runFullSync → transformAndReveal；手动同步只在 TM 菜单）
    │             ├─ 新增/恢复 ─► saveRepoData / markRepoStarred
    │             ├─ 远端无本地有 ─► applyExternalUnstar（宽限管线）+ recordVerdict
    │             └─ 交集 ─► 回填 starredAt + 刷新元数据
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
         ├─ 退出：exitCustomMode() ─► pushState('?tab=stars')（整页导航已删）
         └─ 搜索：queryRepos() 纯本地全文（语言不参与匹配；原生结果补充已删）
                  └─ applyFilters() ─► queryRepos() + renderFilterInfoBar() + updateLocalFilterControls()（常驻本地 Language/Sort+方向，原生 Language/Sort 常驻隐藏）

## 5. 存储模型

脚本使用 `GM_setValue` / `GM_getValue` 持久化数据，键名集中在 `src/constants.ts` 的 `STORAGE_KEYS`（仓库缓存 / 待删除区 / 标签 / 备注 / PAT / 到货页快照 / star 裁决缓存 / 位移挂起）。

### `stars_repo_cache`

仓库元数据缓存，所有用户共享。

```jsonc
{
  "123456": {               // repoId (GitHub 仓库数字 ID)
    "name": "owner/repo",   // 仓库全名
    "desc": "...",          // 描述
    "lang": "TypeScript",   // 主语言
    // 4.3.0 起不再存 langColor：颜色只由语言名决定，渲染走 stars_lang_colors 全局映射（运行时从 linguist languages.yml 获取）
    "stars": 1234,          // star 数
    "forks": 56,            // fork 数
    "updated": "Updated 3 days ago",  // 最后更新文本
    "updatedAt": "2026-09-01T00:00:00Z", // ISO 时间戳（排序用）
    "starredAt": "2026-08-01T00:00:00Z", // star 时间（P4 Sync 回填；「Recently starred」排序用，可选）
    "ts": 1708000000000     // 缓存时间戳
  }
}
```

### `stars_pending_delete`

待删除区，存放已 unstar 但处于宽限期的仓库数据。

```jsonc
{
  "123456": {
    // ... 与 repo cache 相同的字段
    "unstarredAt": 1708000000000,  // unstar 时间戳
    "_tags": ["tag1", "tag2"],     // 备份的标签
    "_note": "备注文本"             // 备份的备注
  }
}
```

`unstarredAt` / `_tags` / `_note` 在类型上是可选的：`markRepoStarred()` 恢复数据前会把它们删掉，再把条目挪回 `stars_repo_cache`。

### `stars_tags_<userId>` / `stars_notes_<userId>`

每用户标签 / 备注数据，按 GitHub 用户 ID 隔离（ID 取自 `meta[name="octolytics-dimension-user_id"]`）。

```jsonc
// stars_tags_<userId>
{ "123456": ["frontend", "tool"], "789012": ["backend"] }
// stars_notes_<userId>
{ "123456": "这是一条备注" }
```

> 历史遗留：旧版使用无用户隔离的 `stars_tags` / `stars_notes`。`migrateTagsIfNeeded()` 负责标签迁移；备注的旧键仍作为取不到 userId 时的回退键使用。

### `github_pat` / `stars_page_snapshots` / `stars_star_verdicts` / `stars_shift_pending`（外部 unstar 核对）

```jsonc
// github_pat（字符串）：“ghp_...” 或 “github_pat_...”；TM 菜单写入，空串 = 未配置
// stars_page_snapshots
{
  "https://github.com/YsLtr?tab=stars": { "123456": "owner/repo", ... },  // 规范化页 URL → 该页上次到货成员
  "https://github.com/YsLtr?page=2&tab=stars": { ... }                      // 原地翻页键 = 取回内容的 href
}
// stars_star_verdicts
{ "123456": { "s": "starred", "ts": 1780000000000 } }   // starred 24h / unstarred 7d 内免重复核对
// stars_shift_pending（被挤出的仓库 → 预期页；到货页出现即清、预期页缺失才核对）
{ "123456": { "o": "owner", "n": "repo", "expectKey": "https://github.com/YsLtr?page=2&tab=stars", "srcKey": "https://github.com/YsLtr?tab=stars", "ts": 1780000000000 } },
```

由 `snapshot.ts`（4.0.0 起仅剩确认 unstar 后的 purge 清理）+ `starCheck.ts` 维护；`stars_shift_pending` 为历史数据（4.0.0 不再产生）。**4.0.0 起 PAT 不写 localStorage 镜像**（gm.ts `SENSITIVE_KEYS`：lsWrite 跳写、gmGet 迁移时清历史镜像，XSS 防护）。`github_pat` 仅用于 `Authorization: Bearer` 调 `api.github.com`，不进仓库、不写日志（提示中只显示前 12 后 4 位掩码）。新增键 `stars_full_sync_meta` 见 §5。

## 6. 核心机制

### 待删除区宽限期

unstar 时数据不会立即删除，而是移入 `stars_pending_delete` 并记录 `unstarredAt`；24 小时内重新 star，数据、标签和备注会自动恢复。超期条目在下次脚本加载时由 `cleanupExpiredUnstarred()` 清理。

### 外部 unstar 检测（4.0.0：P4 整表 diff 承担）

旧「到货快照 diff + 位移挂起 + API 双 404 逐条核对」链路（D1/D2/D4，3.0.9–3.1.0）已随 API 主模式**移除**：snapshot 的 `recordArrival`/位移/挂起全链与 starCheck 的核对队列（`enqueueVerify`/`kick`/`verifyOne`/`apiGet`）均已删除（`recordArrival` 在 API 渲染下无调用者）。星状态真相改由 **`probeAndSync()` 进页 ETag 探测 + 完整整表 diff** 权威判定——远端无本地有 → `applyExternalUnstar()`（宽限管线 + 7d 裁决），无逐条核对、无位移判定（页面位移概念随 HTML 渲染退场）；`purgeRepoFromSnapshots` 保留，用于清理存量 `stars_page_snapshots`/`stars_shift_pending`。PAT 权限指引与设计决策见 AGENTS.md「数据同步设计决策」D1–D7（D7 为现行总则，D1/D2/D4 为历史设计）。

### 每用户标签隔离

存储键包含用户 ID，因此同一浏览器下不同 GitHub 账号的标签/备注互不干扰。

### 缓存卡片跨页筛选

筛选时当前页卡片通过 `.stars-tag-filtered` class 隐藏；其他页面的匹配仓库从 `stars_repo_cache` 读取，用 `buildCardFromCache()` 构建临时卡片插入网格，并打上 `.stars-grid-card-cached` 标记。每次筛选条件变化会先移除全部缓存卡片再重建。

### 详情页数据缓存

用户访问仓库详情页时，脚本提取元数据写入缓存，使从未在 Stars 页浏览过的仓库也能在跨页筛选时显示完整卡片。

### P4 全量同步与进页自动探测（3.1.0；4.0.0 升 API 主模式；4.0.4 逐页 ETag 快筛 + 手动三入口恢复；4.0.5 字节窗口自适应 + ETag 规范形；4.0.6 撤字节窗口门 = 条件快筛每次必发；4.0.7 波次并发；4.0.8 单遍合并 scanStarred + 本地切片复用；4.0.9 尾页 tailEtag 条件探尾 + 并发 6）

`fullSync.ts`：`GET /user/starred?per_page=100&page=N&sort=created&direction=desc` + `Accept: application/vnd.github.star+json`（带 `starred_at`；**4.0.8 起显式钉死排序**——本地切片复算依赖此序，绝不改；URL 带参数换 ETag 表示，升级后首扫全 200 重建基线属预期；单页速率余量 <10 放弃、超 200 页放弃、任一条解析失败整体放弃）。**4.0.8 单遍扫描 `scanStarred()`（合并原 quickCheck + pullAllStarred）**：有基线（≤48h TTL、逐页 etags 完整）→ 波次条件扫 1..N+1（**4.0.9 起尾页带 `tailEtag` 条件探增长**：304=越界仍空免额度、不算内容不算变化；200 空=刷新 tailEtag；200 有货=尾页转正为内容页、清空 tailEtag；304 沿用旧值绝不回读），全 304 免额度早退；200 页收正文、**304 页用本地切片组装**（`buildLocalSlices`：缓存按 starred_at 降序每 100 切页——304 = 内容与上次同步逐字节一致 = 缓存即现值）；无基线/超 TTL/阀门失守（缓存缺 starred_at、切片盖不住、正文×切片重叠 <50%、尾页满页疑增长超一页）→ `pullAllUnconditional`（Link 头预知总页 + 波次拉全，兜底后 tailEtag 清空待首探）。整表 diff 三向——本地有远端无 → `applyExternalUnstar()` 宽限管线（**全正文模式整表即权威确认**；切片混合模式 local-only 嫌疑先逐条 `checkStarredGone()` 双态核对：204=切片平局误报保留 / 404=真取关，防同秒 starred_at 跨页互换假取关）；远端有本地无 → `saveRepoData()` 建条目 / 宽限区内 `markRepoStarred()` 恢复；交集 → 回填 `starredAt` + 元数据刷新（**只对正文页条目做**——切片条目 304 证明未变，不写不数；`updated` 展示文本保留旧值）。**完整性红线**：任何不完整信号都抛错、catch 不改任何数据。
**4.0.0 增强**：`pullAllStarred` 带 `If-None-Match` 条件请求（304 免额度免拉），元数据写 `stars_full_sync_meta`（`etag`/`lastFullSyncAt`/`count`）；transform 成功后 `probeAndSync()` 进页 idle 自动探（无变化免拉、超 TTL 强制整表）；`hasApiData()` = 有 PAT + `meta.count>0` 决定渲染模式；触发（4.0.3 起）= TM 菜单「🔄 立即全量同步」手动（无 token 先弹 `promptForToken`；标题行 Sync 按钮 4.0.3 已删）+ 进页自动 probe（原「快照消失 >12 → scheduleFullSync」入口 4.0.0 已删）。
**4.0.1 增强**：①配置面板顶窗落位——`showSetupBanner` 替换 Lists 槽位的空态 `div.blankslate`（0 list）或 `#profile-lists-container`（有 list，本就隐藏），都不在则退回 prepend；网格态由 `hideListsSection`（blankslate 判定）+ base.css 静态 `> div.blankslate{display:none!important}` 静默隐藏（「有 list 也整体隐藏」不变）；②PAT 三入口统一走 `tokenConfig.ts`：横幅内联粘贴行 / 快速获取官方 Template URL（`starring=write` 一跳预填最小权限）/ TM 菜单，保存回调 `notifyTokenSaved` → savedHandler 撤横幅 + 自动 `runFullSync('button')`；③`notifyTokenIssue` 在 401 与「排除限速的 403」（无 retry-after 且 x-ratelimit-remaining≠0）弹一键更新窗，依据官方 troubleshooting 判定。
**4.0.2 修正**：①`probeAndSync` 与 `pullAllStarred` 的 fetch 加 `cache:'no-store'`——GitHub API 回 `Cache-Control: public, max-age=60`，浏览器缓存会直接回 200（不发请求）或把本地 304 合并成 200 返回 JS，导致每次进页误判「有变化」而整表；配合三条诊断日志（ETag 基线保存 / 探测 200 / 快筛跳过原因）。官方规则（best-practices「Use conditional requests」）：正确带 Authorization 的 304 不计主限流；②开新页统一走 `gm.gmOpenInTab`（TM 菜单回调无用户激活，裸 window.open 被弹窗拦截静默吞掉），`@grant` 增 GM_openInTab；③失效上报 `setTokenIssueHandler` → `showSetupBanner(detail)` 面板文案刷新，modal 及其 CSS 已删。
**4.0.3 增强**：①**任何整表入口都条件化**——原 菜单/保存后 手动调 `runFullSync` → `pullAllStarred` 不带 If-None-Match 永远 200 整表；现 runFullSync 读 meta，TTL(48h) 内首页带条件，304 → `notModified` 早退（只刷 `lastFullSyncAt` 保基线），超 TTL 不带条件强制全量；probe 判定不变。②**手动同步收敛 TM 菜单**——新增 `registerSyncMenu()`（init 注册，无 token 自动弹配置）；横幅「立即同步」按钮与 `mountSyncButton/syncFromButton` 删除（`SYNC_SVG`、`.gsm-sync-btn` CSS、transform 调用同清），保存成功自动同步（savedHandler）不变。③Template URL `expires_in=none` → `90`（官方参数表：1–366 整数或 `none`，默认 30 天）。④`promptForToken` 留空：原本只清存储静默 return，现补 `notifyTokenIssue('Token 已清除')` → 初始化面板重现。⑤界面/菜单去 P2.5/P4 等开发表述（仅控制台与注释保留）。
**4.0.4 修正与恢复（本段修订 4.0.3 的两条判断）**：①「首页单 etag 304 即跳过整表」判据过弱（**中部页变化/移位会漏检**）且 `etag ?? ifNoneMatch` 在响应缺头时落空 → 下次不带条件又 200，形成 **304/200 交替**；改为 **`quickCheck` 逐页条件快筛**：`FullSyncMeta.etags: string[]`（`pullAllStarred` 每页收 `resp.headers.get('etag')`，**空串也入列**——基线含空则下次直接整表重建基线）；`runFullSync` 逐页 If-None-Match（GitHub 每页独立 ETag；304 不计主限流；页间 200ms）：全部 304 → 只写 `{ ...storedMeta, lastFullSyncAt }`（**校验值原样保留，绝不从 304 响应头回读**）；任一 200 → 即刻转整表（该页起后续页已因位移失效）；基线外无条件探 `page=N+1`：有条目 = 总数变长 → 转整表（防「只在尾页追加」漏检）；401/403（非限速）→ `notifyTokenIssue` 报面板、error 早退不整表；`cache:'no-store'` 与 48h TTL 语义不变；`probeAndSync` 瘦身为「冷却 + PAT → `runFullSync('auto')`」。②**手动入口恢复**（撤回 4.0.3 的收敛）：横幅「立即同步」（替换原「手动设置」prompt）+ 标题行 `mountSyncButton`（`SYNC_SVG` 回补 `constants.ts`，spinner 复用 `gsm-pager-loading`）+ TM 菜单 `registerSyncMenu`——三处全走同一条件化 `runFullSync`；横幅填 token 行改 `hidden=false` 常驻（401/403 后面板一出现即可粘贴）。
**4.0.6 撤字节窗口门（修订 4.0.5 的一条设计）**：`byteViableMs` 自适应窗口整套删除（quickCheck 窗口外跳过判定、runFullSync 判亏收缩 `max(30s,龄/2)` 与全 304 回抬、`FullSyncMeta.byteViableMs` 字段——存量 JSON 残键无害）。理由：条件请求带过期 ETag 回 200 与无条件**同价**（响应体本来就要拉）、304 免额度，门只省独立试探阶段 1 个注定 200 的请求，却放弃安静期全 304 整表白嫖、且造成「条件请求失效」观感。保留：48h TTL / 缺基线转整表、`normEtag` 规范形、`changed-byte` 判定与日志、尾页 N+1 探测。
**4.0.6 补充（外部 unstar 恒 1 修复，同批未提交）**：真机探针实锤 `zai-org/ZCode` 同时在 `stars_pending_delete` 与 `stars_repo_cache`（真取关后被某回写路径写回缓存），A 循环每轮调 applyExternalUnstar → confirm 见候选早退但计数已 +1 → 恒报 1。修复：confirm 幂等+自愈（候选在区也清缓存脏态）、applyExternalUnstar 返回是否新确认、A 循环只对新确认计数+写裁决；下次同步自愈归 0。同期答疑：快筛 200 = 响应字节真变（元数据抖动，诚实判定）；只首页 304 判据过弱（中部变化/位移漏检 + etag 落空交替坑），逐页全 304 为正确取舍（304 免额度无 body）。
**4.0.7 波次并发**：`runWaves(pages, ctrl, worker)` 执行器——`WAVE_CONCURRENCY=5`、发波间隔 ≥ `WAVE_GAP_MS=1000`（官方次级限流建议：并发请求间至少 1s；慢网每波耗时自然拉大、快网 sleep 补足）；worker 失败 → `AbortController` 中止在途 + 停波，`pickRealError()` 过滤主动 abort 的 AbortError 上抛真根因；外部主动中止（快筛定论）也停波且不算错误。
**4.0.8 单遍合并 + 本地切片复用（快筛与整表合为 `scanStarred()`，用户定「无须两个函数」）**：官方序实锤（docs：`/user/starred` 默认 `sort=created`+`direction=desc` = 按 starred_at 降序；页码 offset 分页按当下全集现算）→ **任何成员变化必翻受影响页 ETag，页还 304 ⇒ 内容与上次同步逐字节一致 ⇒ 可用缓存切片复原**（缓存每条有 starred_at，切片纯本地计算，无须页快照存储）。扫描 = 波次条件请求 1..N+1 一把梭（**不早停**：200 body 要收割）→ 全 304 + 尾页空 = unchanged 免额度早退 → 否则正文页 `parseItem`、304 页切片组装（重复 id 去重；新基线正文页用响应 etag、304 页沿用旧值绝不回读）。阀门（失守 → 无条件整表兜底）：缓存缺 starred_at / 切片盖不住 304 页 / 正文×切片重叠 <50% / 尾页满页（增长可能超一页）。diff：hybrid 模式 local-only 嫌疑逐条 `checkStarredGone()`（204=切片平局误报保留 / 404=真取关 / null=本轮不动）；交集元数据刷新只对正文页条目（freshIds）。胶水去重：`apiHeaders()` + `authIssueMessage`（401/403 文案单一来源）。收益：常见 churn 只有 churn 页带 body、时延≈一遍波次（比 4.0.7 两阶段再省约一半），全静/全变路径与原行为持平。
**4.0.10 审查修复（code-reviewer top 项）**：① 🔴 `parseTotalPages`——GitHub Link 按请求参数序回显（URL 尾 `&sort=…&direction=desc>; rel="last"`），4.0.8 钉 sort 参数后旧正则 `/page=(d+)>;s*rel="last"/` 恒失配 → `?? 1` 把整表当 1 页 → TTL 到期即假外部取关批量删数据（curl 实锤）；改「定位 rel=last 整段再抽 `[?&]page=`」+ 解析失败抛错不猜页数。② `extract.ts` 星态 fail-closed（未知不写缓存）+ 只写正向解析字段（JSON 真 0 可写、DOM 兜底 0 视为未解析不写）。③ 死码拆除：`snapshot.ts`（全仓零引用）/ `recordVerdict`+裁决缓存 / `onExternalUnstarConfirmed` 钩子 / `shiftPending` 管线 + `SyncSummary.shiftCleared`；三历史键 → `LEGACY_STORAGE_KEYS`，init 一次性 `gmRemove`（GM_deleteValue + localStorage 镜像同删）。

### 星星按钮（4.0.0：纯 API）

`createStarButtonForCached(repo)`：`PUT/DELETE https://api.github.com/user/starred/{owner}/{repo}` + `Authorization: Bearer <PAT>`（无需 CSRF）；点击即乐观翻转，失败回滚并回落原生 form 路径。旧「当前页原生表单 / 缓存卡 fetch CSRF」双模式（`createStarButton`/`submitStarForm`）与三处 unstar 检测管线已整体删除。

### 全缓存搜索与筛选联动

搜索与筛选统一走 `queryRepos()` 单管线（4.1.0，4.2.0 增 type 约束）：把关键词按空白拆词，每个词都必须至少命中作者、仓库名、描述、标签、备注之一（**语言不参与全文匹配**——避免 `ASC` 子串命中 `javascript`，语言只通过下拉筛选指定）；type/lang/标签 AND/搜索四重约束叠加。命中词以 `<mark class="gsm-search-hit">` 高亮（标题 / 描述 / 标签 / 备注四字段，大小写不敏感、只包文本节点、跳过输入控件）。**4.0.0 起纯本地**：原生结果补充已删，结果集 = 全量缓存 ∩ type ∩ lang ∩ 标签 ∩ 关键词。

自建 Sort 菜单四项：Recently starred / Recently active / Most stars / **Most Forks**（4.1.0，末项为本地扩展、原生无）。排序规则（`sortResults()`）：4 键 × asc/desc（右侧方向 icon 点击切换，与 Sort by 合并为 split button；方向态只由 ↑/↓ icon 表达，4.2.0 起不再加 has-active 蓝圈），**缺失值恒沉底不随方向翻转**，平局按仓库名决胜（全确定性，修掉旧「到达序」注释与 `for..in` 整数键序不符的问题）。`created` 按 `starredAt`（P4 Sync 回填，未回填沉底）；默认 `sort='created'` + `direction='desc'` = 原生默认 Recently starred。语言/Type/排序/方向初始值由 `initFiltersFromUrl()` 从 URL 参数（sort/direction/language/type）对齐（R6：URL 只读不写，D3；`inheritNativeFilters()` 已删）。
### 退出筛选（Clear filter 本地化）
Clear filter（信息条与原生拦截两路，均走 `exitCustomMode()`）：清 tags/lang/search、**保留 sort/direction**（D4）→ 本地渲染第 1 页 + `history.pushState('?tab=stars')` 干净地址栏（**整页导航已删**，4.0.0）；pushState 后的 search 串登记为「已解析」，sort/direction 不会被 URL 初始化冲掉。原生 Language/Sort 常驻隐藏、本地控件常驻，不再随模式切换（`updateNativeFilters` 双态逻辑已删）。

## 7. 状态管理约定

所有跨模块可变状态集中在 `src/state.ts` 的 `filterState` 对象里：

```ts
filterState.tags            // 已选标签（多选，需全部命中）
filterState.lang            // 语言筛选，'' = 全部
filterState.type            // Type 筛选（'' = All；7 个可判项，D2 省略 Can be sponsored），4.2.0
filterState.sort            // 'created' | 'updated' | 'stars' | 'forks'（默认 'created' = Recently starred）
filterState.direction       // 'desc' | 'asc'（默认 'desc'；缺失值恒沉底不随方向翻转）
filterState.searchQuery     // 当前搜索词，'' = 无搜索
filterState.page / totalPages  // 本地浏览页码 / 总页数（browse 态本地分页）
// 4.1.0 起 tagMode/searchMode/nativeSearchResults/nativeSearchFetching 均已退场；
// 是否处于筛选态用 state.ts 的 hasActiveFilter() 派生（tags/lang/type/search 任一激活 = 筛选态，平铺不分页）
```

用对象而不是 `export let`，是因为 ESM 的导入绑定对导入方是只读的，无法跨模块重新赋值。

## 8. 功能扩展指南

### 添加新的卡片字段

1. `extract.ts`：从 DOM 提取新字段并加入 `saveRepoData` 调用
2. `types.ts`：在 `RepoData` 上补字段
3. `ui/cards.ts` 的 `buildCardFromCache()`：渲染缓存卡片
4. `transform.ts`：渲染当前页卡片
5. `styles/base.css`：加样式

### 添加新的筛选条件

1. `state.ts`：加状态字段
2. `ui/tagFilter.ts`：加筛选 UI（参考 Tags 按钮的 Popover + ActionList 结构）
3. `filters.ts`：在 `queryRepos()` 统一管线里加筛选逻辑，facet 候选计算同处扩展（`computeTagCandidates` / `computeLanguageCandidates`）
4. **候选刷新 invariant（4.3.4 教训）**：候选列表只能由 `applyFilters() → refreshTagFilterBar()` 统一原位刷新，不得只在自身交互路径重绘——否则其它维度（type/lang/搜索）变化后候选残留脏值，空结果集取消勾选后面板永久空白（只能刷新还原）

### 添加新的存储键

1. `constants.ts`：在 `STORAGE_KEYS` 里加键名
2. `storage/` 下新建模块（或复用现有模块）实现 load/save
3. 如需迁移，参考 `migrateTagsIfNeeded()`

### 添加新的 SVG 图标

在 `constants.ts` 声明为 `const` 后引用，不要内联在构建 DOM 的代码里。

## 9. 样式与断点

- 样式写在 `src/styles/*.css`，由 `index.ts` 以 `?inline` 导入，再在 **Stars 页面** 通过 `GM_addStyle()` 注入。
- 断点常量（`MOBILE_BREAKPOINT = 768`、`WIDE_BREAKPOINT = 1200`）在 `constants.ts` 里，**CSS 中的 `@media` 数字是手写同步的**，改断点要同时改两处。
- 样式必须只在 Stars 页注入：这些规则会改写 GitHub 的 `.Layout` 结构（例如把侧边栏压到 180px），在仓库详情页注入会误伤页面布局。
- `vite.config.ts` 里显式设置了 `build.cssTarget`。esbuild 默认会按现代 baseline 把 `@media (min-width: 768px)` 压成区间语法 `(width>=768px)`（Safari 16.4+ 才支持），降低 css target 可以保留 `min-width`。
- **隐藏 GitHub 原生区块的两个坑**（2026 改版踩过）：① GitHub 工具类带 `!important`（如 `.d-flex { display: flex !important }`），JS 里 `el.style.display = 'none'` 会被压过，必须 `el.style.setProperty('display', 'none', 'important')`；② 间距工具类加了 `tmp-` 前缀（`my-3` → `tmp-my-3`），纯类名选择器会静默失配。现成做法见 `dom.ts` 的 `hideListsSection()`：用语义特征（`h2.f3-light` + 文案）定位，打 `.stars-lists-hidden` 标记类，隐藏规则写在 `base.css` 第 4 节。

## 10. 约束

- **产物单文件**：构建产物必须是单个 `.user.js`，不得使用 `@require` 拉外部运行时。
- **无运行时依赖**：只用浏览器原生 API + GM API。`package.json` 里的依赖全部是 devDependencies。
- **仅桌面端**：`transformStarsList()` 首先检查 `isDesktop()`；所有 CSS 包在 `@media (min-width: 768px)` 内。
- **三栏响应式布局**：768–1199px 隐藏左右侧边栏只留主内容区；>= 1200px 为左侧资料栏 (180px) + 中间卡片网格 + 右侧 Starred Topics (220px)。
- **GM API 用法**：一律走 `src/gm.ts` 的 `gmGet/gmSet/gmAddStyle/gmRegisterMenuCommand`（**调用时**判定可用性，document-start 时晚到/缺席都安全，附 localStorage 兜底与迁移）；**禁止** `import { GM_* } from '$'`（bundle 顶部一次性捕获会在 document-start 固化成 undefined → `GM_addStyle is not a function` 事故）。`@grant` 在 `vite.config.ts` **显式声明**（当前：`GM_getValue` / `GM_setValue` / `GM_registerMenuCommand`），不要依赖插件自动推断。
- **循环依赖**：`filters.ts` 与 `ui/tagFilter.ts` 互相引用（筛选逻辑 ↔ 筛选 UI）。所有导出都是函数声明，运行时靠提升解析，不会在模块初始化阶段取值，因此是安全的；新增模块时不要把这类互相引用的值用在模块顶层。

## 11. 测试

### 构建产物 CSS 等价性

```bash
pnpm build && node scripts/verify-css.cjs
```

比对 `src/styles/*.css` 与产物内联 CSS 的「选择器 → 声明属性集合」，输出只应有注释、等价缩写（如 `top/right/bottom/left` → `inset`）、等价合并等预期差异。

### 浏览器冒烟测试

`tests/smoke/fixture.html` 是一个仿 GitHub Stars 页面的最小 DOM，内置 GM API stub（内存 store）并加载 `dist/github-stars-grid.user.js`。断言脚本用 `agent-browser-cli` 注入执行：

```bash
pnpm build
# 打开 fixture（必须带 ?tab=stars，否则脚本会判定为非 Stars 页而提前返回）
agent-browser-cli open "file:///<abs-path>/tests/smoke/fixture.html?tab=stars"
# 用返回的 tab id 跑断言
agent-browser-cli exec --tab <id> --file tests/smoke/assert-transform.js
agent-browser-cli exec --tab <id> --file tests/smoke/assert-search.js   # 需要新开一个干净 tab
```

已覆盖：网格转换、原始列表隐藏、分页器克隆、Starred Topics 迁移到右侧栏、标签 pill 与筛选栏、备注渲染、数据提取入缓存、点击标签进入自定义模式（缓存卡片 + 信息条 + 自定义 Language/Sort 按钮 + 原生菜单隐藏）、单/多词搜索与无结果。断言里的 `errors` 来自 `window.onerror`，必须为空。

## 12. 发布

1. 改 `package.json` 的 `version`（`vite.config.ts` 直接读取它写入脚本头）。
2. `pnpm check`。
3. 跑第 11 节的两项验证。
4. 用 `dist/github-stars-grid.user.js` 覆盖安装，或作为 release 附件发布。

## 13. 待办

见仓库根目录 `todo`。其中「初始化/刷新功能」「导入导出功能」在缓存架构下都需要新增 storage 模块 + UI 入口。
