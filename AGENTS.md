# GithubStarManager — Agent Handoff

> 项目架构/模块/数据流/存储模型/约束以 **`DEVELOPER.md`** 为准（权威文档，勿在别处重复）。
> 本文件只记录「当前在做什么、做到哪了、下一步」。

---

## 当前交接（2026-09-22 09:25 +0800）

### 目标
GitHub 2026 改版适配（f117ef4）、Lists+FOUC（2c84884）、GM 兼容层+Turbo 动画（c376192）、mountGmApi（bc6b19d）、3.0.3 三 bug 修复（0d6e913）均已提交。本轮 = **3.0.4 补丁**（直载误播入场动画仍闪 + 兜底定时器 4s 后误撤样式「脚本失效」），待用户重装真机验证。

### 本轮改了什么（3.0.3 → 3.0.4，本次提交）

| 文件 | 改动 |
|---|---|
| `vite.config.ts` | `match` 收敛为单条 **`https://github.com/*`**：旧 `*/*` 要求两段路径，匹配不到纯 `/YsLtr` → profile 页脚本根本没跑 |
| `src/index.ts` | **全量重构**：`registerNavListeners()` 无条件前置（任何匹配页都挂 turbo/click 监听）；样式生命周期 `ensureStarsSetup()/deactivateStars()/exitStarsView()`；`transformAndReveal()` 成为唯一转换入口（重试耗尽=撤样式+恢复原生+大声日志）；删 observer/10s 块与重复 turbo:load；profile→Stars 到达时补注入样式 |
| `src/boot.ts` | 隐藏从 `visibility:hidden` 改为 **`body{display:none!important}`**（不可被后代覆盖、零绘制）；挂载/解除都打日志（原因+耗时） |
| `src/styles/persistent.css` | **新增常驻表**：`.stars-right-sidebar` 默认隐藏（防离开后残留空列）+ 侧边栏/头像 transition（离开时主表被撤，回弹过渡必须还在） |
| `src/styles/base.css` | 4 条 transition 移去常驻表；`gsm-grid-in` 淡入改挂 `html.gsm-turbo-entry`——**直载不播淡入**（揭示后网格再淡入被用户当成闪） |
| `src/gm.ts` | `gmAddStyle` 改为返回 `HTMLStyleElement` 句柄 |
| `package.json` | 3.0.2 → **3.0.3** |

**3.0.4 补丁（同日；用户对 3.0.3 反馈：仍闪 + 过一会恢复原始页面）**：① 直载时 Turbo 也会渲染初始 `user-profile-frame` → profile-frame 分支无条件 `transformAndReveal(true)` → 直载播了入场动画（网格淡入 + 侧边栏收缩）＝用户看到的「闪」→ 改为 `transformAndReveal(starsNavPending)`，并给 `revealAfterTransform` 加 `wasHidden` 幂等门（未处于隐藏绝不播动画，二次调用天然跳过）；② 首次 frame-render 时 `armNavFailsafe` 的 4s 定时器在成功揭示后**从未撤销**，到点误调 `exitStarsView` 整表撤样式 →「过一会脚本失效、恢复原始页面」→ 揭示成功即 `clearTimeout`，且回调自检仍隐藏才退出（残余定时器无害）。

**三 bug 根因（用户 2026-09-22 报告，本轮已修）**：① `@match */*` 匹配不到单段路径 `/YsLtr`，且 `init()` 在非 stars 页早退不挂导航监听 → profile 直入/点 Stars 均无效；② `visibility:hidden` 可被后代覆盖（GitHub 还有 app 层 CSS 未查全），且揭示后网格 `gsm-grid-in` 淡入 0.3s——「页面出现后内容再淡入」被当成闪；③ `gmAddStyle` 注入的布局样式**没有任何移除路径**，同文档 turbo 离开后 180px 侧边栏/120px 头像规则仍生效。
**约束（永久生效）**：禁止 `import {GM_*} from '$'`（顶部一次性捕获与 document-start 不兼容，会固化成 undefined）；GM 一律走 `src/gm.ts`。

**Turbo 导航模型**：profile 标签链接均 `data-turbo-frame="user-profile-frame"`（`user-starred-repos` 嵌套其中、侧边栏/头像在 frame 外持久存在）。**进**：`before-frame-render` 用 `detail.newFrame` 判断目标是 Stars 才藏 frame（切去 Repositories 绝不隐藏），`frame-render` 后 `transformAndReveal(true)`——**Turbo 按 id 保留嵌套 starred frame（src 未变不发 frame-render），profile-frame 分支必须主动调用**；入场动画 = `transformAndReveal` 开头先挂 `gsm-anim-prepare`（让样式注入瞬间停在 296 起点）→ 解除隐藏 → 强制 reflow → 摘 prepare（296→180 过渡）。**出**：`before-frame-render` 非目标 + `frame-render` 非 stars + `turbo:load` 非 stars 三处调 `exitStarsView()`（撤主样式表 → 原生恢复，transition 在常驻表里 → 180→296 带动画回弹）。4s 兜底 = `armNavFailsafe` + boot FAILSAFE。移动端全程不隐藏。

### 数据存储（已向用户说明）
- 主存储 GM：`stars_tags_<userId>` / `stars_notes_<userId>` / `stars_repo_cache` / `stars_pending_delete`（取不到 userId 回退 `stars_tags`/`stars_notes`）；localStorage 镜像同键加前缀 `github-stars-grid::`。
- 迁移仅当 GM 为默认值时触发：GM 已有旧数据时，dev 写进 localStorage 的新数据**不会合并**。

### dev 模式 GM 不可用的原因（已答用户）
dev 代码经动态 `import()` 运行在 **unsafeWindow 作用域**，该作用域没有 GM_api（插件作者原话，issue #35）。官方解法：1 = `from '$'`（因上述根因已禁用）；2 = `server:{mountGmApi:true}` 把全部 GM 挂到 unsafeWindow（仅 dev 生效）——**已决定并加上（2026-09-22）**，dev 下 gm.ts 走 GM 分支、存储位置与正式版一致。来源: https://github.com/lisonge/vite-plugin-monkey/issues/35

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

1. **用户重装 `dist/github-stars-grid.user.js`（3.0.4）前台验证**：① 直进 `?tab=stars`：揭示无闪烁，且**至少观察 10 秒**页面不回退原生（3.0.3 是揭示后约 4s 被误撤样式）；② profile 点 Stars 出网格；③ 离开/返回时侧边栏恢复与收缩动画正常。若仍闪：要控制台 `script loaded / 防闪烁隐藏已挂载 / 防闪烁解除` 三行原文 + 闪烁发生在揭示瞬间还是揭示后约 0.5s。
2. **dev HMR 在 github.com 上需要浏览器放行 CSP**：GitHub 的 `script-src` 白名单不含 `127.0.0.1`，dev loader 的动态 import 必被拒（`Failed to fetch dynamically imported module`）。插件绕不过，需装 CSP 放行扩展 + 允许 Local Network Access 弹窗。详见 `DEVELOPER.md` §2「dev 模式在 github.com 上的两个前置条件」。
3. **两个脚本不能同时启用**：`transformStarsList()` 见到 `.stars-grid-container` 就提前返回，正式版先跑会让 dev 版"改了没反应"。开发时在 Tampermonkey 里禁用正式版。
4. 真机验证必须**前台**：Chrome 冻结后台标签页后测量/交互全部失真（曾误判样式失效）。
5. `todo` 文件按上次决定继续留在未跟踪状态，未纳入提交。

### 下一步

1. 等 3.0.4 验证结果。判读要点：`防闪烁解除` 原因必须是 `转换成功(直载)`（若仍是 turbo 入场 = pending 状态被意外置位）；观察 10s 无回退 = 兜底定时器问题已闭环。
2. **快速构建阶段（2026-09-22 起，用户已定）**：不跑 `tests/smoke/`，不写测试 fixture/断言；改完只 `pnpm check`，由用户在真实页面判断是否成功。
3. 若 GitHub 再改版：先跑 `tests/diag/selectors.js` 定位失配点，再改 `src/dom.ts` 的 helper（**只改 helper，不要在业务模块里写选择器**）。

### 常用命令

```bash
pnpm check     # tsc --noEmit + build（改完必跑）
pnpm build     # → dist/github-stars-grid.user.js（~100ms）
pnpm dev       # HMR，需先解决上面第 2 条；URL: http://127.0.0.1:5173/__vite-plugin-monkey.install.user.js
```

真机调试（无 HMR 时最快的验证路径，`agent-browser-cli` 需在跑）：

```bash
# 1) 把 dist 脚本 base64 后拼成一段 eval 代码（stub 掉 GM_getValue/GM_setValue —— gm.ts 调用时会检测到并使用；GM_addStyle 已弃用不用 stub + 预置 __gmStore）
# 2) agent-browser-cli exec --tab <tabId> --file .diag/run-xxx.js   # .diag/ 已在 .gitignore 里
# 注意：改 transform 逻辑前先 Page.reload，否则幂等检查会提前返回
```

### 建议技能
- `agent-browser-cli`：真机 DOM 探查、注入验证、截图。
