# GithubStarManager — Agent Handoff

> 项目架构/模块/数据流/存储模型/约束以 **`DEVELOPER.md`** 为准（权威文档，勿在别处重复）。
> 本文件只记录「当前在做什么、做到哪了、下一步」。

---

## 当前交接（2026-09-22 06:51 +0800）

### 目标
v3.0 迁移到 **Vite + vite-plugin-monkey + TypeScript** 后，**GitHub 2026 改版**把 stars 页和仓库详情页的 DOM 全换了，原选择器全部失配（页面完全不转换）。当前工作 = 适配新 DOM。

### 最新状态
- **迁移已完成并提交**：`a7cf5e2 build: v3.0 迁移到 Vite + vite-plugin-monkey + TypeScript`（源码 19 个 TS 模块 + 2 个 CSS，构建产物单文件 `dist/github-stars-grid.user.js`）。
- **选择器适配已完成、真机验证通过、但尚未提交**（本轮改动全在工作区）。
- 用户已按新方案装好脚本（下一步是让他们在真实页面确认）。
- **Lists (5) 行隐藏修复（2026-09-22 第二轮，未提交，待用户真机确认）**：旧逻辑两处失效——CSS 选择器只认 `my-3`（新类名 `tmp-my-3`）；JS 内联 `display:none` 被页面自带的 `.d-flex{display:flex!important}` 压过。已改为 `dom.ts` 新增 `hideListsSection()`（语义定位 + `setProperty('display','none','important')` + `.stars-lists-hidden` 标记类），`transform.ts` 在所有 early return 前调用，`index.ts` 补 `user-profile-frame` 的 turbo 渲染监听。
- **FOUC 防闪烁（2026-09-22 第三轮，未提交，待用户真机确认）**：`vite.config.ts` 的 `@run-at` 从 `document-idle` 改为 **`document-start`**，新增 `src/boot.ts`：document-start 时同步给 `<html>` 挂 `visibility:hidden!important` 样式把整页藏住（此刻 DOM 只有 html 节点），`transformStarsList()` 成功后才 `revealBootHide()` 解除；4s 兜底强制解除防永久白屏。`index.ts` 主逻辑改为 `whenReady()`（DOMContentLoaded）后执行——document-start 时 querySelector 全是 null。**用户需重新安装 dist 脚本，`@run-at` 元数据变更才会生效**。

### 本轮改了什么（按文件）

| 文件 | 改动 |
|---|---|
| `src/dom.ts` | 新增健壮查询层：`getRepoItems` / `getRepoIdFromItem` / `getStarsMainColumn` / `getNativeFilterRow` / `getNativeFilterBar` / `readEmbeddedJson` / `getSidebarAbout` / `getStarButton` / `isStarButtonActive` |
| `src/transform.ts` `src/filters.ts` `src/search.ts` `src/ui/tagFilter.ts` | 全部改用上面的 helper，不再硬编码 GitHub 类名 |
| `src/extract.ts` | 详情页改读内嵌 JSON（`payload.sidebarAbout`）取描述/语言/star/fork；语言色与更新时间走 DOM 兜底 |
| `src/index.ts` | 新增 `watchRepoStarState()`：React 版 star 按钮不触发表单提交，改为点击后轮询 `aria-label` 翻转判定 unstar/re-star；旧表单监听保留 |
| `src/boot.ts` | 新增 document-start 防闪烁引导：`installBootHide()`（挂隐藏样式 + 4s 兜底）/ `revealBootHide()` / `isStarsPage()` |
| `src/utils.ts` | 新增 `formatRelative()`：新 `relative-time` 的 shadow DOM 吐绝对时间，缓存卡片统一显示成 "Updated 21 days ago" |
| `vite.config.ts` | `server.port=5173` + `strictPort` + `Access-Control-Allow-Private-Network` 头（dev loader URL 写死端口，漂移会静默失效） |
| `tests/smoke/*` | fixture 之前用的是**旧类名**（所以线上崩了测试还全绿），已重写为新 DOM；`assert-detail.js` 增加 unstar→re-star 宽限期流程断言 |
| `tests/diag/selectors.js` | 线上 DOM 体检脚本（统计本项目依赖的每个选择器命中数） |

### DOM 变更对照（GitHub 2026 改版）

| 位置 | 旧 | 新 |
|---|---|---|
| stars 列表项 | `col-12…py-4.border-bottom` | `…tmp-py-4.border-bottom.color-border-muted` |
| repoId | `data-toggle-for` / `details-user-list-<id>` | `user-list-menu[data-repository-id]` |
| 原生筛选栏 | `.TableObject.border-bottom` + `mt-5` | flex 行 + `tmp-mt-5`，锚点 `#stars-language-filter-menu-button` |
| 详情页 | `.BorderGrid` / `#repo-stars-counter-star` / `.starred form[action$="/unstar"]` | React + CSS-module；数据在 `script[data-target="react-app.embeddedData"]` → `payload.sidebarAbout`；star 按钮 `button[data-testid="star-button"]`，状态在 `aria-label` |
| 搜索框 | `input[name=q]`、`form[action$="tab=stars"]` | **未变**，原拦截逻辑仍有效 |
| Lists 标题行 | `.my-3.d-flex.flex-justify-between…` + 内联隐藏即可 | `tmp-my-3…`，且 `.d-flex` 的 `!important` 会压过内联 `display:none`，必须 `setProperty('display','none','important')`（`hideListsSection()`） |

### 真机验证结论（CDP 注入 dist 到已开的 GitHub 标签页）

- stars 页（`github.com/YsLtr?tab=stars`）：30/30 卡片、repoId 全对、缓存 30 条且字段正确（`utags/utags`：JavaScript / 376 stars / 25 forks / 真实描述）、标签栏+药丸+备注正常、点标签进入筛选模式（自建 Language/Sort 出现、原生菜单隐藏）、无运行时错误。
- 详情页（`github.com/utags/utags`）：内嵌 JSON 提取正确（repoId 611661896）、star 按钮识别为已 star、详情页**不**注入本项目样式（符合设计）。

### 阻塞 / 风险 / 待确认

1. **dev HMR 在 github.com 上需要浏览器放行 CSP**：GitHub 的 `script-src` 白名单不含 `127.0.0.1`，dev loader 的动态 import 必被拒（`Failed to fetch dynamically imported module`）。插件绕不过，需装 CSP 放行扩展 + 允许 Local Network Access 弹窗。详见 `DEVELOPER.md` §2「dev 模式在 github.com 上的两个前置条件」。
2. **两个脚本不能同时启用**：`transformStarsList()` 见到 `.stars-grid-container` 就提前返回，正式版先跑会让 dev 版"改了没反应"。开发时在 Tampermonkey 里禁用正式版。
3. 本轮改动**未提交**（见下）。
4. `todo` 文件按上次决定继续留在未跟踪状态，未纳入提交。

### 下一步

1. 让用户装 `dist/github-stars-grid.user.js`，回看真实页面（重点：标签/备注编辑、unstar 宽限期恢复、跨页缓存搜索、1200px 上下的三栏布局、Lists (5) 行已隐藏）。
2. **快速构建阶段（2026-09-22 起，用户已定）**：不跑 `tests/smoke/`，不写测试 fixture/断言；改完只 `pnpm check`，由用户在真实页面判断是否成功。
3. 若 GitHub 再改版：先跑 `tests/diag/selectors.js` 定位失配点，再改 `src/dom.ts` 的 helper（**只改 helper，不要在业务模块里写选择器**）。

### 常用命令

```bash
pnpm check     # tsc --noEmit + build（改完必跑）
pnpm build     # → dist/github-stars-grid.user.js（~100ms）
pnpm dev       # HMR，需先解决上面第 1 条；URL: http://127.0.0.1:5173/__vite-plugin-monkey.install.user.js
```

真机调试（无 HMR 时最快的验证路径，`agent-browser-cli` 需在跑）：

```bash
# 1) 把 dist 脚本 base64 后拼成一段 eval 代码（stub 掉 GM_getValue/GM_setValue/GM_addStyle + 预置 __gmStore）
# 2) agent-browser-cli exec --tab <tabId> --file .diag/run-xxx.js   # .diag/ 已在 .gitignore 里
# 注意：改 transform 逻辑前先 Page.reload，否则幂等检查会提前返回
```

### 建议技能
- `agent-browser-cli`：真机 DOM 探查、注入验证、截图。
