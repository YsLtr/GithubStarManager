# GithubStarManager — Agent Handoff

> 项目架构/模块/数据流/存储模型/约束以 **`DEVELOPER.md`** 为准（权威文档，勿在别处重复）。
> 本文件只记录「当前在做什么、做到哪了、下一步」。

---

## 当前交接（2026-09-22 08:57 +0800）

### 目标
GitHub 2026 改版适配已完成并提交（f117ef4）；Lists 隐藏 + document-start FOUC 已提交（2c84884）。本轮收尾 = **GM API 在 document-start 下不可用的根因修复（3.0.2）** + Turbo 切换动画，随本次 handoff 一并提交，等用户真机确认。

### 本轮改了什么（本次提交）

| 文件 | 改动 |
|---|---|
| `src/gm.ts` | **新增 GM 兼容层**：`gmGet/gmSet` 调用时 `typeof` 判定——GM 可用写 GM + 镜像 localStorage；不可用退 localStorage（前缀 `github-stars-grid::`），GM 恢复后自动迁回；`gmAddStyle` 原生 DOM 插 `<style>`，彻底弃用 GM_addStyle |
| `src/storage/{tags,notes,repoCache,pendingDelete}.ts` | GM_* 调用全部改走 gmGet/gmSet，删除 `from '$'` 导入（连同 index.ts 共 17 处调用点） |
| `src/index.ts` | Turbo 切换防闪烁+动画、gmAddStyle 迁移、3 处诊断日志（`script loaded (document-start)` / observer 等待 / 10s 失败——确认后可删） |
| `src/boot.ts` | installBootHide/reveal 按 `isDesktop()` 分桶，移动端不隐藏 |
| `src/styles/base.css` | 侧边栏/头像 width transition、`html.gsm-anim-prepare`、`.gsm-turbo-hidden`、`.stars-grid-container` 的 `gsm-grid-in` 淡入 |
| `vite.config.ts` | `run-at` 去重只留 **document-start**；显式 `grant: ['GM_getValue','GM_setValue']` |
| `package.json` | 3.0.1 → **3.0.2**（3.0.1 是带 bug 构建，版本号必须可区分） |

**GM 根因（用户真机报 `init 失败: GM_addStyle is not a function` → 全功能失效）**：`$` 虚拟模块的 GM_* 被打包成 **bundle 顶部一次性 typeof 捕获（IIFE）**，document-start 执行时 TM 尚未提供 GM_* → 永久固化 undefined → init 中断。旧版 document-idle + CDP 注入测试的 GM stub 双重掩盖了它。产物已验证：`var _GM_*` 捕获 **0 处**、header grant 正确。
**约束（永久生效）**：禁止 `import {GM_*} from '$'`（顶部捕获与 document-start 不兼容）；GM 一律走 `src/gm.ts`。

**Turbo 切换防闪烁 + 动画**：profile 标签链接均 `data-turbo-frame="user-profile-frame"`（`user-starred-repos` 嵌套其中、`.Layout-sidebar`/头像在 frame 外）。`turbo:before-frame-render` 用 `detail.newFrame` 判断目标是 Stars 内容才给 frame 加 `.gsm-turbo-hidden`（切去 Repositories 等绝不隐藏，另有非 Stars 内容兜底解除）；替换+转换完成后 `transformAndReveal()` 解除，4s 兜底。**Turbo 会按 id 保留嵌套 starred frame（src 未变不发 frame-render），profile-frame 渲染分支必须主动 `transformAndReveal(true)`**。解除隐藏前挂一帧 `html.gsm-anim-prepare`（恢复 296px 原始宽）再移除，靠 transition 平滑收缩到 180/120px。移动端全程不隐藏。

### 数据存储（已向用户说明）
- 主存储 GM：`stars_tags_<userId>` / `stars_notes_<userId>` / `stars_repo_cache` / `stars_pending_delete`（取不到 userId 回退 `stars_tags`/`stars_notes`）；localStorage 镜像同键加前缀 `github-stars-grid::`。
- 迁移仅当 GM 为默认值时触发：GM 已有旧数据时，dev 写进 localStorage 的新数据**不会合并**。

### dev 模式 GM 不可用的原因（已答用户）
dev 代码经动态 `import()` 运行在 **unsafeWindow 作用域**，该作用域没有 GM_api（插件作者原话，issue #35）。官方解法：1 = `from '$'`（因上述根因已禁用）；2 = `server:{mountGmApi:true}` 把全部 GM 挂到 unsafeWindow（仅 dev 生效）。**已问用户是否加，待答复。** 来源: https://github.com/lisonge/vite-plugin-monkey/issues/35

### DOM 变更对照（GitHub 2026 改版）

| 位置 | 旧 | 新 |
|---|---|---|
| stars 列表项 | `col-12…py-4.border-bottom` | `…tmp-py-4.border-bottom.color-border-muted` |
| repoId | `data-toggle-for` / `details-user-list-<id>` | `user-list-menu[data-repository-id]` |
| 原生筛选栏 | `.TableObject.border-bottom` + `mt-5` | flex 行 + `tmp-mt-5`，锚点 `#stars-language-filter-menu-button` |
| 详情页 | `.BorderGrid` / `#repo-stars-counter-star` / `.starred form[action$="/unstar"]` | React + CSS-module；数据在 `script[data-target="react-app.embeddedData"]` → `payload.sidebarAbout`；star 按钮 `button[data-testid="star-button"]`，状态在 `aria-label` |
| 搜索框 | `input[name=q]`、`form[action$="tab=stars"]` | **未变**，原拦截逻辑仍有效 |
| Lists 标题行 | `.my-3…` + 内联隐藏即可 | `tmp-my-3…`，且 `.d-flex` 的 `!important` 压过内联 `display:none`，必须 `setProperty('display','none','important')`（`hideListsSection()`，已提交 2c84884） |

### 真机验证结论（CDP 注入 dist 到已开的 GitHub 标签页）

- stars 页（`github.com/YsLtr?tab=stars`）：30/30 卡片、repoId 全对、缓存 30 条且字段正确（`utags/utags`：JavaScript / 376 stars / 25 forks / 真实描述）、标签栏+药丸+备注正常、点标签进入筛选模式（自建 Language/Sort 出现、原生菜单隐藏）、无运行时错误。
- 详情页（`github.com/utags/utags`）：内嵌 JSON 提取正确（repoId 611661896）、star 按钮识别为已 star、详情页**不**注入本项目样式（符合设计）。

### 阻塞 / 风险 / 待确认

1. **用户需重新安装 `dist/github-stars-grid.user.js`（3.0.2）并前台真机验证**：控制台无红色报错（尤其 GM 相关）、网格/标签/备注/缓存正常、**历史标签/备注数据仍在**；有新报错要原文。
2. `server:{mountGmApi:true}` 加不加——已问未答。
3. **dev HMR 在 github.com 上需要浏览器放行 CSP**：GitHub 的 `script-src` 白名单不含 `127.0.0.1`，dev loader 的动态 import 必被拒（`Failed to fetch dynamically imported module`）。插件绕不过，需装 CSP 放行扩展 + 允许 Local Network Access 弹窗。详见 `DEVELOPER.md` §2「dev 模式在 github.com 上的两个前置条件」。
4. **两个脚本不能同时启用**：`transformStarsList()` 见到 `.stars-grid-container` 就提前返回，正式版先跑会让 dev 版"改了没反应"。开发时在 Tampermonkey 里禁用正式版。
5. 真机验证必须**前台**：Chrome 冻结后台标签页后测量/交互全部失真（曾误判样式失效）。
6. `todo` 文件按上次决定继续留在未跟踪状态，未纳入提交。

### 下一步

1. 等用户 3.0.2 验证结果；通过后可删 `index.ts` 的 3 处诊断日志（或保留）。
2. 按用户答复决定是否加 `server:{mountGmApi:true}`（仅改 `vite.config.ts`，不影响产物）。
3. **快速构建阶段（2026-09-22 起，用户已定）**：不跑 `tests/smoke/`，不写测试 fixture/断言；改完只 `pnpm check`，由用户在真实页面判断是否成功。
4. 若 GitHub 再改版：先跑 `tests/diag/selectors.js` 定位失配点，再改 `src/dom.ts` 的 helper（**只改 helper，不要在业务模块里写选择器**）。

### 常用命令

```bash
pnpm check     # tsc --noEmit + build（改完必跑）
pnpm build     # → dist/github-stars-grid.user.js（~100ms）
pnpm dev       # HMR，需先解决上面第 3 条；URL: http://127.0.0.1:5173/__vite-plugin-monkey.install.user.js
```

真机调试（无 HMR 时最快的验证路径，`agent-browser-cli` 需在跑）：

```bash
# 1) 把 dist 脚本 base64 后拼成一段 eval 代码（stub 掉 GM_getValue/GM_setValue —— gm.ts 调用时会检测到并使用；GM_addStyle 已弃用不用 stub + 预置 __gmStore）
# 2) agent-browser-cli exec --tab <tabId> --file .diag/run-xxx.js   # .diag/ 已在 .gitignore 里
# 注意：改 transform 逻辑前先 Page.reload，否则幂等检查会提前返回
```

### 建议技能
- `agent-browser-cli`：真机 DOM 探查、注入验证、截图。
