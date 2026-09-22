# GithubStarManager — Agent Handoff

> 项目架构/模块/数据流/存储模型/约束以 **`DEVELOPER.md`** 为准（权威文档，勿在别处重复）。
> 本文件只记录「当前在做什么、做到哪了、下一步」。

---

## 当前交接（2026-09-22 15:38 +0800）

### 目标
GitHub 2026 改版适配（f117ef4）、Lists+FOUC（2c84884）、GM 兼容层+Turbo 动画（c376192）、mountGmApi（bc6b19d）、3.0.3 三 bug（0d6e913）、3.0.4 直载动画+兜底误撤、3.0.5 取消冗余整页 visit（554bcf1）、3.0.6 Set status 裁剪修复（569174d）、3.0.7 分页原地翻页（bffa4e8）、3.0.8 顶部翻页器+转圈（270ba4d）均已提交。本轮 = **3.0.9 外部 unstar 检测（P1+P2.5）+ PAT 双格式 + 3.0.10 位移判定（按排序算预期页、挂起→预期页成员检测，不存顺序）**（设计决策 D1–D4 见下方「数据同步设计决策」），`pnpm check` 通过，待提交与真机验证。

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
**3.0.5 补丁（同日 09:45；用户报「进入 ?tab=stars 仍旧整页刷新」）**：CDP 受信任点击抓链——GitHub 的 profile frame 带 `data-turbo-action`，Turbo FrameController 在 `fetchResponseLoaded → proposeVisitIfNavigatedWithAction` 于 frame 渲染完 **8ms 后补一次同 URL 整页 Drive visit**（`updateHistory:false`、`willRender:false`，纯重复）；该 visit 触发我们 `before-render → installBootHide` 的整页隐藏 + body 级渲染 = 用户看到的「整页刷新」（真机 boot 挂/摘日志与 152ms 空白窗口完全吻合，且 window/probe 状态未丢 = 非真刷新）。修法：`registerNavListeners()` 闭包记 `lastFrameRenderAt`（user-profile-frame/user-starred-repos 的 frame-render），`turbo:before-visit` 在 **1s 内且同 URL** 时 `preventDefault()`——下载 bundle 切片确认 `proposeVisit = allows && (...)`，取消即短路、无 `location.href` fallback；history 由 frame 的 action 自己维护（`changeHistory: if(this.action)`），被取消的 visit 本就 `updateHistory:false`，前进后退不受影响。**已热注入真机验证**：修复后两次 tab 往返无 `turbo:visit`/`before-render`/`turbo:load`、boot 0 次切换、grid 正常、URL 正确。**预期控制台变化**：tab 切换不再打印「防闪烁隐藏已挂载/解除」（before-render 不再触发，属正常）；仅直载/F5 与前进/后退仍走整页隐藏。
**3.0.6 补丁（同日 10:00；用户报「Set status 悬浮展开后被遮挡」，确认就是裁剪）**：药丸静息态 = emoji 圆圈（36px），**悬停时 React 展开成完整药丸 101px（right=352）**，而我们 `.h-card{overflow:hidden}` 的裁剪边界在 x=344（180px 窄栏右缘）→ 展开部分右侧 8px 被切（命中测试 x346/350 原返回 Layout/MAIN 而非药丸）。修法：`overflow: hidden` → **`overflow: clip` + `overflow-clip-margin: 16px`**（裁剪职责保留、边界外扩 16px；16 < 列间距 24 不碰 Stars 网格）。真机验证：注入后命中 x346/350 返回 BUTTON/circle-badge 栈、截图圆角完整。**排查坑**：刷新页面后 React partial 水合有数秒延迟，期间药丸测得 36px 且悬停不展开——早期「clip 把药丸压塌」是误判（实为水合未完成）。`top` 悬停态 `document.elementsFromPoint` 会忽略 pointer-events:none 的 tool-tip，验证遮挡要换用元素自身坐标 + 截图。
**3.0.7 补丁（同日 10:55；用户报「点分页 Next 闪一下才加载下一页」，要求直接截取数据原地更新）**：根因 = 分页链接在 `turbo-frame#user-starred-repos` 内（`.paginate-container` 下的 `a.btn.BtnGroup-item`），点击走 Turbo frame 导航 → 我们在 `before-frame-render` 给 frame 挂 `gsm-turbo-hidden` 整块藏住 + frame-render 后播入场动画 → 网络往返期间空白、到达后淡入 = 「闪」。修法：新模块 `src/pagination.ts`——**window 捕获阶段**拦分页链接点击（document-start 注册，先于 Turbo 一切 document 监听；`preventDefault`+`stopImmediatePropagation` 一处干掉 Turbo 与本脚本的 starsNavPending 误置位），直接取链接 `href`（**不解析游标参数，值不固定**）fetch 新页 HTML，`frame.innerHTML` 原地换入 + `transformStarsList()` 完整重建；不 pushState（原生 frame 翻页不改地址栏，链接无 data-turbo-action）；中键/Ctrl/Shift 不拦截；失败回落 `location.href`。**不动 frame[src]**（Turbo 监听 src 属性变化会二次加载再闪一次）。真机受信任点击端到端验证：首卡 utags→Lithe-IDEA→Ditto 连翻两页、`turbo:frame-render/visit/before-render` 与 `gsm-turbo-hidden` 计数全 0、地址栏保持 ?tab=stars、控制台两条「原地翻页完成」。**排查坑**：CDP Input 对**后台标签页静默失效**（tab `active:false` 时 click 不到达页面、无任何报错）——真机点击测试必须先 `Page.bringToFront` 再重测坐标（前台化后布局会偏移约 56px）。
**3.0.8 补丁（同日 11:20；用户要求顶部复制分页器 + 点击转圈动画）**：① **顶部快捷翻页器**——`src/transform.ts` 末尾新增私有 `mountTopPager(colLg9, gridContainer)`（在 `appendChild(gridContainer)` 后调用，随 transform 完整重建同步，原地翻页后自动换新页状态）：克隆网格底部的 `.paginate-container` 挂到 `h2.f3-light`（「Starred repositories」）的父容器 `div.position-relative` 上并加 `gsm-top-pager` 类，父容器加 `gsm-header-row` 变 flex 两端对齐实现「行右边」（实测 topRect 右缘 = 行右缘 1456）；保留 `paginate-container` 类 → 分页拦截/转圈对顶底两份一视同仁，无需改 pagination.ts 的匹配逻辑。② **转圈动画**——按 Primer 官方 Button loading 态规范（文字保留透明占位防布局跳动 + aria-busy）：`swapPageInPlace` 签名加 `sourceLink`，开头加 `gsm-pager-loading` + `aria-busy=true`，`finally` 里摘除（成功时节点已被 transform 重建、脱离文档，remove 无害）；CSS 在 `base.css`：文字 `color:transparent` 占位保留，`::before` 画 14px 边框转圈（`border-top-color` 用 `var(--fgColor-default)` 适配暗色）+ `gsm-spin` keyframes + `pointer-events:none`/`cursor:progress`。**真机验证**（CDP `Network.emulateNetworkConditions` 限速 2s 拉开观察窗口 + 受信任点击顶部 Next）：点击即 `loading:1`、截图见 Next 内转圈而 Previous 文字保留、完成后 `loadingNow:0`；第 2 页顶/底 Previous 由 disabled 按钮变可点链接（状态同步 ✓）、首卡 utags→Lithe-IDEA、topRect 无跳动。**注意**：计数 `[aria-busy]` 时页面全局会有 ~60 个 GitHub 自己的 busy 区块，别误判。

### 本轮改了什么（3.0.8 → 3.0.10，本次，待提交）

| 文件 | 改动 |
|---|---|
| `src/starCheck.ts` | **新增（确认层 P2.5）**：PAT 存取与前缀校验（`ghp_`/`github_pat_`）、TM 菜单注册（`GM_registerMenuCommand` + prompt，非法前缀拒绝保存、只显示掩码）、`GET /user/starred/{owner}/{repo}` 串行核对队列（204=仍 star 只记裁决；404 间隔 1.5s **双确认**才走 unstar 宽限备份+清快照+卡片翻空星；条间隔 200ms、网络失败重试 1 次）、速率守卫（余量 <50 / 余量 0 / retry-after → 暂停至 reset+30s）、401/403 熔断当前 token（403 读 `X-Accepted-GitHub-Permissions` 给权限修复提示，换 token 自动恢复）、裁决缓存（starred 24h / unstarred 7d）、无 token 时只提示一次绝不改数据 |
| `src/snapshot.ts` | **新增（检测层 P1 + 位移判定）**：`stars_page_snapshots` 按规范化页 URL（去 hash、page=1 归一、query 排序）记 `{repoId: owner/repo}`，**不存顺序**；同页成员 diff 出「消失」后 `expectationKey()` 按排序参数+页码算预期页——有模型（`created`+desc → 本页+1 / `asc` → 本页−1）→ `stars_shift_pending` 挂起（本页不核对，cap 60/TTL 30d），无模型（`updated`/`stars`、升序第 1 页）→ 直接 ≤8 核对（>12 提示走 P4）；到货先 `resolvePending()`：在到货页可见=位移确认即清、预期页缺失=才核对；`currentKey` 跟踪当前内容所属键（原地翻页不 pushState、Turbo 保留 frame 时防记错键）；空到货不更新也不结算；确认回调同时清全部快照与挂起（回调注册避免与 starCheck 循环 import）；内容未变不写盘 |
| `src/gm.ts` | +`gmRegisterMenuCommand()`（调用时判定，非 TM 环境降级为 info 日志） |
| `src/index.ts` | `transformAndReveal` 成功分支 +`recordArrival()`；`init()` 无条件 +`registerTokenMenu()` |
| `src/pagination.ts` | 原地换页成功后 +`recordArrival(url)`（键 = 取回内容的 href） |
| `src/constants.ts` / `src/types.ts` | +`github_pat` / `stars_page_snapshots` / `stars_star_verdicts` / `stars_shift_pending` 四键；+`StarVerdict` / `VerdictMap` / `PageSnapshots` / `ShiftPendingEntry` / `ShiftPendingMap` 类型 |
| `vite.config.ts` | grant +`GM_registerMenuCommand`（仍显式声明，不靠 `$` 推断） |
| `package.json` | 3.0.8 → **3.0.10** |

**3.0.10 补丁（同日 15:38；用户反馈：`/2akouwu/reverify` 被「新 star 挤到下一页」误判核对，并提出「按排序方式和每页数量直接计算」）**：位移判定改为**无序方案**（不存顺序、快照形状不变、零迁移）。线上实测排序参数 `sort=created/updated/stars` + `direction=desc/asc`（每页 30 卡）：`created`+desc（默认）消失 → 预期页 = 本页+1 挂起、**本页不核对**；`asc` → 预期页 = 本页−1；`updated`/`stars` → 无位移模型直接核对。任何页到货先结算：挂起项**在到货页可见 = 位移确认即清**；**预期页缺失 = 「本该在本页却没有」才核对**；方向猜错（上拉 / 一次跨多页）由 API 204 无害兜底。确认 unstar 后同步清挂起。

**三 bug 根因（用户 2026-09-22 报告，本轮已修）**：① `@match */*` 匹配不到单段路径 `/YsLtr`，且 `init()` 在非 stars 页早退不挂导航监听 → profile 直入/点 Stars 均无效；② `visibility:hidden` 可被后代覆盖（GitHub 还有 app 层 CSS 未查全），且揭示后网格 `gsm-grid-in` 淡入 0.3s——「页面出现后内容再淡入」被当成闪；③ `gmAddStyle` 注入的布局样式**没有任何移除路径**，同文档 turbo 离开后 180px 侧边栏/120px 头像规则仍生效。
**约束（永久生效）**：禁止 `import {GM_*} from '$'`（顶部一次性捕获与 document-start 不兼容，会固化成 undefined）；GM 一律走 `src/gm.ts`。

**Turbo 导航模型**：profile 标签链接均 `data-turbo-frame="user-profile-frame"`（`user-starred-repos` 嵌套其中、侧边栏/头像在 frame 外持久存在）。**进**：`before-frame-render` 用 `detail.newFrame` 判断目标是 Stars 才藏 frame（切去 Repositories 绝不隐藏），`frame-render` 后 `transformAndReveal(true)`——**Turbo 按 id 保留嵌套 starred frame（src 未变不发 frame-render），profile-frame 分支必须主动调用**；入场动画 = `transformAndReveal` 开头先挂 `gsm-anim-prepare`（让样式注入瞬间停在 296 起点）→ 解除隐藏 → 强制 reflow → 摘 prepare（296→180 过渡）。**出**：`before-frame-render` 非目标 + `frame-render` 非 stars + `turbo:load` 非 stars 三处调 `exitStarsView()`（撤主样式表 → 原生恢复，transition 在常驻表里 → 180→296 带动画回弹）。4s 兜底 = `armNavFailsafe` + boot FAILSAFE。移动端全程不隐藏。

### 数据存储（已向用户说明）
- 主存储 GM：`stars_tags_<userId>` / `stars_notes_<userId>` / `stars_repo_cache` / `stars_pending_delete`（取不到 userId 回退 `stars_tags`/`stars_notes`）；localStorage 镜像同键加前缀 `github-stars-grid::`。
- 迁移仅当 GM 为默认值时触发：GM 已有旧数据时，dev 写进 localStorage 的新数据**不会合并**。
- 核对相关（3.0.9/3.0.10 新增）：`github_pat`（PAT）、`stars_page_snapshots`（到货页快照）、`stars_star_verdicts`（API 裁决缓存）、`stars_shift_pending`（位移挂起：被挤出的仓库 → 预期页，出现即清、缺失才核对）——机制见 DEVELOPER.md §5/§6，决策见下方「数据同步设计决策」。

### 数据同步设计决策（2026-09-22 定稿，用户逐条确认）

**D1 · 到货快照 diff（检测层，3.0.9 已实现）**：`stars_page_snapshots` 按**规范化页 URL** 记录每次到货的 `{repoId: owner/repo}`；成员真相以到货页为准，同页 diff 的「消失」只产生候选。原地翻页不改地址栏 → 翻页到货用**取回内容的 href** 作键（`snapshot.ts` 的 `currentKey` 跟踪，Turbo 保留 frame 时的重复 transform 也落在正确键上）。同键首访只建基线（持久化 → 跨会话可比）；空到货不更新（渲染失败不能当全量 unstar）。

**D2 · 确认层（P2.5，3.0.9 已实现）**：双 404 确认**默认开启**（间隔 1.5s）；**不做同源 repo 页面 fallback**（用户定：抓页面太重）；网络失败 / 401 / 403 / 意外状态一律「不确定只当 stale」不改数据；预算 = 单次到货核对 ≤8、队列 ≤24、条间隔 200ms、速率余量 <50 或 retry-after 即暂停到 reset+30s（认证限额 5000/h）；单次缺失 >12 → 提示走 P4 全量（落地前只核前 8）。确认后复用 unstar 管线：缓存移入 `stars_pending_delete` 宽限备份、清标签/备注、**全量清快照**、卡片原地翻未 star；复 star 24h 内可恢复。

**D3 · Token 双格式（用户定：classic / fine-grained 都要）**：
- classic `ghp_`：有效 token 即可读全部 `/user/starred*`；**核对私有仓库需勾 `repo` scope**——无 scope 时「无权限的私有仓库 404」与「真 unstar 404」不可区分（D2 已排除页面 fallback，只能靠 token scope 规避），此为已知局限。
- fine-grained `github_pat_`：官方 fine-grained 权限表 **“User permissions for Starring”** 列出全部 5 个端点（`GET /user/starred`、`GET/PUT/DELETE /user/starred/{owner}/{repo}`、`GET /users/{username}/starred`）→ 勾 **Account permissions → Starring → Read** + 仓库范围 **All repositories**（2026-06-30 stargazers 端点收紧名单**不含**这些端点）。
- 配置入口：TM 菜单「⭐ 设置 GitHub Token」（任意 github.com 页可用）；存储键 `github_pat`；按前缀校验、非法拒绝保存；401/403 自动熔断当前 token，换 token 自动恢复。

**D4 · 位移判定（3.0.10，用户 2026-09-22 反馈 reverify 误核对后定，修订 D1 的「消失→候选→API」）**：a) 「被新 star 挤到下一页」的消失**不触发核对**——按排序方式+每页数量直接算预期页（`created`+desc → 本页+1；`created`+asc → 本页−1；`updated`/`stars` 与升序第 1 页 → 无位移模型），消失先挂起 `stars_shift_pending`；b) 核对只发生在「本该在本页出现却没有出现」= 挂起项在预期页缺失（无模型排序仍直接有界核对，≤8 / >12 走 P4 照旧）；c) 结算用**集合成员检测、不存顺序**——挂起项在任何到货页出现即确认清（顺序只用于同货次区分尾部/中部，推迟到预期页成员检测等价且更简单，用户指出按排序+页数直接计算即可）；d) 方向猜错（上拉到页码更小的一页 / 一次跨多页）由「预期页缺失 → API 204」无害兜底；e) 确认 unstar 后清全部快照**与挂起**。

**未实现（后续阶段）**：P3 local-first 首屏（缓存快照先渲染再由到货校正）；P4 全量拉取比对（整表 diff，收编「单页缺失猜测」与 >12 场景；GraphQL/REST 分页与 ETag 优化届时调研）。

**来源**：
- fine-grained 端点权限表（“User permissions for Starring” 段）: https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens
- Starring API 204/404 语义: https://docs.github.com/en/rest/activity/starring
- REST 速率限制（认证 5000/h）: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- X-Accepted-GitHub-Permissions 响应头（403 修复提示）: https://github.blog/changelog/2023-08-10-x-accepted-github-permissions-header-for-fine-grained-permission-actors/

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

1. **用户重装 `dist/github-stars-grid.user.js`（3.0.10）前台验证**：① 直进 `?tab=stars`：揭示无闪烁，且**至少观察 10 秒**页面不回退原生（3.0.3 是揭示后约 4s 被误撤样式）；② profile 点 Stars 出网格；③ 离开/返回时侧边栏恢复与收缩动画正常；④ 悬停 `Set status` 圆圈展开成完整药丸、右侧不再被切（水合完成需数秒，刚刷新时圆圈悬停不展开属正常）；⑤ **点分页 Next/Prev：旧内容保持可见直到新页换入，全程无空白/无淡入**（3.0.7 原地翻页；地址栏保持 ?tab=stars 属预期）；⑥ **「Starred repositories」行右侧有 Previous/Next 快捷份，点击后按钮内转圈、文字不消失、按钮不变宽**（3.0.8）；⑦ **TM 菜单出现「⭐ 设置 GitHub Token」**（= grant+注册生效），配置 PAT（classic `ghp_`，或 fine-grained `github_pat_` = Account permissions → Starring → Read + All repositories）；⑧ **位移判定（3.0.10 核心）**：默认排序（Recently starred）在第 1 页新 star 一个仓库后，被挤到第 2 页的原尾部仓库只应见「位移挂起：N 个…本页不核对」且**不发 API 请求**（reverify 即上次误核对的用例）；翻到第 2 页该仓库出现 →「位移确认：…清除挂起、不核对」；只有挂起项在预期页**缺失**才见「…预期在本页却没有出现：交 API 核对」（未配 token 时见「未配置 token」提示属预期）；切 Most stars / Recently active 排序翻页见「快照检测到 N 个仓库从本页消失（当前排序无位移模型…）」直接核对属预期；⑨ **外部 unstar 端到端**：用**脚本感知不到的方式**取消 star（另一浏览器/手机 App，或 F12 里 `fetch('https://api.github.com/user/starred/<owner>/<repo>',{method:'DELETE',headers:{Authorization:'Bearer <PAT>'}})` —— 详情页/卡片上的星星按钮会走脚本自己的管线，测不到 API 核对路径），重进该页等 ~2s 见「★ 核对确认外部 unstar」，标签/备注已进宽限期（24h 内重 star 恢复）。若仍闪：要控制台 `script loaded / 防闪烁隐藏已挂载 / 防闪烁解除 / 原地翻页完成` 各行原文。
2. **dev HMR 在 github.com 上需要浏览器放行 CSP**：GitHub 的 `script-src` 白名单不含 `127.0.0.1`，dev loader 的动态 import 必被拒（`Failed to fetch dynamically imported module`）。插件绕不过，需装 CSP 放行扩展 + 允许 Local Network Access 弹窗。详见 `DEVELOPER.md` §2「dev 模式在 github.com 上的两个前置条件」。
3. **两个脚本不能同时启用**：`transformStarsList()` 见到 `.stars-grid-container` 就提前返回，正式版先跑会让 dev 版"改了没反应"。开发时在 Tampermonkey 里禁用正式版。
4. 真机验证必须**前台**：Chrome 冻结后台标签页后测量/交互全部失真（曾误判样式失效）。
5. `todo` 文件按上次决定继续留在未跟踪状态，未纳入提交。

### 下一步

1. 等 3.0.10 验证结果。原要点照旧：`防闪烁解除` 原因必须是 `转换成功(直载)`；观察 10s 无回退 = 兜底闭环；悬停药丸完整 = 裁剪闭环；翻页无闪 = 原地翻页闭环；顶部翻页器+转圈 = 3.0.8 闭环。**3.0.9/3.0.10 新要点**：TM 菜单有「⭐ 设置 GitHub Token」；位移判定三连——新 star 后见「位移挂起…本页不核对」（零 API 请求）、到预期页见「位移确认」、预期页缺失才见「预期在本页却没有出现…交 API 核对」、updated/stars 排序见「无位移模型」直接核对；外部 unstar 后重进见「★ 核对确认外部 unstar」（步骤见「阻塞」⑧⑨）。若 403：按控制台 `X-Accepted-GitHub-Permissions` 提示行对照 D3 权限指引改 token。
2. **快速构建阶段（2026-09-22 起，用户已定）**：不跑 `tests/smoke/`，不写测试 fixture/断言；改完只 `pnpm check`，由用户在真实页面判断是否成功。
3. 若 GitHub 再改版：先跑 `tests/diag/selectors.js` 定位失配点，再改 `src/dom.ts` 的 helper（**只改 helper，不要在业务模块里写选择器**）。
4. 数据同步后续阶段（方向已定、未排期）：**P3** local-first 首屏渲染（缓存快照先显 + 到货校正）；**P4** 全量拉取比对（GraphQL/REST 分页整表 diff + ETag，收编「单页缺失猜测」与 >12 场景）。见「数据同步设计决策」。

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
