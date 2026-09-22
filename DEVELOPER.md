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
  constants.ts        断点、宽限期、存储键、SVG 常量
  types.ts            存储模型类型（RepoData / PendingDeleteEntry / TagMap / NoteMap ...）
  state.ts            筛选状态对象 filterState（唯一可变全局状态）
  utils.ts            escapeHtml / isDesktop
  dom.ts              getRepoIdMeta / getToggler / isStarredInToggler（DOM 查询小工具）
  extract.ts          详情页与卡片的数据提取 → 写缓存
  transform.ts        列表 → 卡片网格转换
  filters.ts          筛选引擎：标签/语言/排序/搜索、信息条、原生筛选联动
  search.ts           搜索表单拦截、原生搜索结果补充
  gm.ts              GM API 兼容层（调用时判定；localStorage 兜底与迁移）
  boot.ts            document-start 防闪烁隐藏生命周期（FOUC）
  pagination.ts      原地翻页拦截（window 捕获 + fetch 换入，不走 Turbo frame 导航）
  starCheck.ts       外部 unstar 确认层：PAT 菜单、API 双 404、速率守卫、裁决缓存
  snapshot.ts        到货页快照 diff + 位移挂起/结算：发现外部消失（核对候选），被挤出的到预期页结案
  storage/
    repoCache.ts      仓库缓存 CRUD
    tags.ts           标签存储 + 备注键规则 + 迁移
    notes.ts          备注存储
    pendingDelete.ts  待删除区（unstar 宽限期，含标签/备注备份）
  ui/
    cards.ts          卡片构建 + 星星按钮（当前页 / 缓存双模式）
    tagFilter.ts      标签 pill、筛选栏、pill 选中态同步
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

```
GitHub DOM
    │
    ├─ 仓库详情页 ──► extractAndCacheRepoFromDetailPage() ──► GM_setValue (stars_repo_cache)
    │
    └─ Stars 列表页
         │
         ├─ DOM 列表项 ──► extractAndCacheRepoFromCard() ──► GM_setValue (stars_repo_cache)
         │
         ├─ DOM 列表项 ──► transformStarsList() ──► 卡片网格 DOM
         │                                              │
         │                                              ├─ createStarButton() ──► 星星按钮
         │                                              └─ renderTags() ──► 标签 pill
         │
         └─ 筛选 / 搜索（跨页）
              │
              ├─ getTagFilteredRepos() / searchCacheRepos() ──► buildCardFromCache() ──► 缓存卡片 DOM
              │                                                                          ├─ createStarButtonForCached()
              │                                                                          └─ renderTags() / renderNotes()
              └─ 状态变化 ──► applyFilters() ──► renderFilterInfoBar() + updateNativeFilters()
```

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
    "langColor": "#3178c6", // 语言色块颜色
    "stars": 1234,          // star 数
    "forks": 56,            // fork 数
    "updated": "Updated 3 days ago",  // 最后更新文本
    "updatedAt": "2026-09-01T00:00:00Z", // ISO 时间戳（排序用）
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

由 `snapshot.ts` + `starCheck.ts` 维护（`stars_shift_pending` 位移挂起由 `snapshot.ts` 独占），机制见 §6「外部 unstar 核对」。`github_pat` 仅用于 `Authorization: Bearer` 调用 `api.github.com`，不进仓库、不写日志（提示中只显示前 12 后 4 位掩码）。

## 6. 核心机制

### 待删除区宽限期

unstar 时数据不会立即删除，而是移入 `stars_pending_delete` 并记录 `unstarredAt`；24 小时内重新 star，数据、标签和备注会自动恢复。超期条目在下次脚本加载时由 `cleanupExpiredUnstarred()` 清理。

### 外部 unstar 核对（到货快照 diff + 位移挂起 + API 双 404）

每次 Stars 内容到货（直载转换 / Turbo 重渲染 / 原地翻页换入）由 `snapshot.ts` 先**结算位移挂起**（`stars_shift_pending`：挂起项在任何到货页可见 = 位移确认即清；`expectKey` 正好是本页却缺失 = 「本该在本页却没有出现」才交核对），再与上次同键到货做成员 diff。消失按**排序方式 + 页码**直接算位移模型（`expectationKey()`：`sort` 缺省/`created` 且 `direction` 缺省/`desc` → 预期下一页；`asc` → 预期上一页；`updated`/`stars` 及升序第 1 页 → 无位移模型）：有预期页 → 挂起不核对（cap 60、TTL 30d）；无模型 → 直接交 `starCheck.ts` 串行核对 `GET /user/starred/{owner}/{repo}`（单次 ≤8，>12 提示走 P4）：204 = 仍 star 只记裁决不动数据；404 需间隔 1.5s 两次才确认，随后复用 unstar 宽限管线（`markRepoUnstarred` 同款备份）+ 从全部快照与挂起中清除 + 卡片原地翻未 star。无 PAT / 401 / 403 / 网络失败一律只记日志不改数据；速率余量 <50 暂停至 reset。**位移判定不存顺序**（排序键 star 时间在页面 HTML 中不提供；预期页的成员检测与「存顺序再对齐」等价且更简单——用户决策）。PAT 权限指引与设计决策见 AGENTS.md「数据同步设计决策」。

### 每用户标签隔离

存储键包含用户 ID，因此同一浏览器下不同 GitHub 账号的标签/备注互不干扰。

### 缓存卡片跨页筛选

筛选时当前页卡片通过 `.stars-tag-filtered` class 隐藏；其他页面的匹配仓库从 `stars_repo_cache` 读取，用 `buildCardFromCache()` 构建临时卡片插入网格，并打上 `.stars-grid-card-cached` 标记。每次筛选条件变化会先移除全部缓存卡片再重建。

### 详情页数据缓存

用户访问仓库详情页时，脚本提取元数据写入缓存，使从未在 Stars 页浏览过的仓库也能在跨页筛选时显示完整卡片。

### 星星按钮双模式

- **当前页卡片** (`createStarButton`): 直接使用原始 DOM 中的 star/unstar 表单提交 CSRF token
- **缓存卡片** (`createStarButtonForCached`): 先 fetch 仓库详情页获取有效 CSRF token，再提交

两者共享 `createStarButtonElement` / `toggleStarButtonState`。

### 全缓存搜索与筛选联动

搜索走 `searchCacheRepos()`：把关键词按空白拆词，每个词都必须至少命中作者、仓库名、描述、语言、标签、备注之一；并联动当前激活的标签与语言筛选。同时 `search.ts` 会异步拉取 GitHub 原生搜索结果页，把缓存里缺失的仓库补进缓存并重渲染（`filterState.nativeSearchResults`）。

### 退出自定义模式

当标签与搜索都被清空时，`applyFilters()` 会把当前 Language / Sort 写回 URL 查询串并整页导航到 `?tab=stars`，让 GitHub 服务端重新渲染原生筛选结果。

## 7. 状态管理约定

所有跨模块可变状态集中在 `src/state.ts` 的 `filterState` 对象里：

```ts
filterState.tags            // 已选标签（多选，需全部命中）
filterState.lang            // 语言筛选，'' = 全部
filterState.sort            // 'stars' | 'updated'
filterState.tagMode         // 是否处于标签筛选模式
filterState.searchQuery     // 当前搜索词，'' = 无搜索
filterState.searchMode      // 是否处于搜索模式
filterState.nativeSearchResults  // 原生搜索返回的 repoId 列表
filterState.nativeSearchFetching // 防重复 fetch
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
3. `filters.ts`：在 `getTagFilteredRepos()` / `searchCacheRepos()` / `applyFilters()` 里加筛选逻辑

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
