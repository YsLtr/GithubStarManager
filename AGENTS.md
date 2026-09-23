# GithubStarManager — Agent Handoff

> 项目架构/模块/数据流/存储模型/约束以 **`DEVELOPER.md`** 为准（权威文档，勿在别处重复）。
> 本文件只记录「当前在做什么、做到哪了、下一步」。

---

## 当前交接（2026-09-23 14:50 +0800）

### 目标
GitHub 2026 改版适配到 4.0.2 全系列（f117ef4 … 1cf8f33，含 4.0.0 API 主模式、4.0.1 槽位+快捷 Token、4.0.2 三修）均已提交。本轮 = **4.0.3 五改**（①任何整表入口一律 ETag 条件化，304 免额度早退；②手动同步收敛 TM 菜单、删横幅「立即同步」与标题行 Sync 按钮、界面去 P2.5/P4 表述；③预填过期 90 天；④留空清 token 立即重开面板；详见「4.0.3 段」与 D8）：`pnpm check` 通过（92.53 kB），**待提交与真机验证**。

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

**3.0.11 补丁（同日；用户报「搜 ASC：网络 1 条、脚本 21 条」+「搜索后 Sort 只剩 2 项」+「匹配字段要高亮」）**：① 根因 = 搜索表单被拦截后主体走 `searchCacheRepos()` **全缓存子串匹配**（当时 6 字段含语言），`ASC` 是 `javascript` 的子串 → 命中全部 JS 语言仓库 → **语言字段退出全文搜索**（只搜 名称/描述/标签/备注，语言仅走下拉筛选，见 D5）；② Sort 只剩 2 项 = 自建菜单写死两项（客户端排序需 `starred_at`，缓存没存）→ **「Recently starred」等 P4 回填后再补（用户定）**；③ 新增**命中高亮**：搜索重建卡片的 标题/描述/标签/备注 命中词包 `<mark class="gsm-search-hit">`（大小写不敏感、只包文本节点不动结构、跳过 textarea/input/contenteditable），CSS 用 Primer `--bgColor-attention-muted` 明暗自适应。

**3.1.0 P4 全量同步（同日 16:45；用户指令「开始实现 P4，同步按钮放标题行右侧翻页器左边」）**：① **新模块 `src/fullSync.ts`**——`GET /user/starred?per_page=100&page=N` + `Accept: application/vnd.github.star+json`（带 `starred_at`；防御 `repository`/`repo`/裸对象三形态，任一条解析失败=整体放弃）、页间 100ms、速率余量 <10 放弃、超 200 页上限放弃、401/403/限流报错带修复提示；**完整性红线：半张表绝不当整表用**——所有失败路径在 catch 里抛错、不改任何数据（否则未拉到的页会全被误判 unstar）。② **整表 diff 三向**：本地有远端无 → `starCheck.applyExternalUnstar()`（= `confirmExternalUnstar` 管线：宽限备份+清快照+卡片翻空星，**整表即权威确认跳过双 404**）+ 写 7d 裁决；远端有本地无 → `saveRepoData()` 建条目 / `pendingDelete` 内则 `markRepoStarred()` 恢复（标签备注连同恢复）；交集 → 回填 `starredAt` + desc/lang/stars/forks/updatedAt 刷新（`updated` 展示文本 API 还原不出，保留旧值）；顺带结算位移挂起（远端仍 star 的直接清）。写放大控制：交集回填整表只 load/save 各 1 次，新增/恢复按差异数走既有管线。③ **Sync 按钮**：`mountTopPager` 改返回标题行（`HTMLElement \| null`），transform 里 `mountSyncButton(headerRow)` 插到 `.gsm-top-pager` 左侧——CSS 把 `.gsm-header-row` 的 `h2` 改 `flex:1` 撑满（去掉 `space-between`），按钮与翻页器一起贴右；loading 复用 `gsm-pager-loading`；无 token 点击先弹 `promptForToken()`（starCheck 把菜单体抽成公共函数，菜单标签改「⭐ 设置 GitHub Token（核对 + P4 全量同步）」）。④ **快照 >12 升级为自动整表**：`snapshot.handleMissing` 消失 >12 **且已配 token** → `scheduleFullSync()`（单飞 + 60s 冷却），否则维持 ≤8 核对 +「配置 token 后自动走 P4」提示。⑤ **Sort 第 3 项落地（D5c 兑现）**：`SortKey + 'created'`、自建菜单 `+{created, Recently starred}`、`sortResults` star 时间降序（未回填沉底、稳定排序保到达序=原生服务端序）、`inheritNativeFilters` 遇原生 Recently starred → `'created'`、退出模式 URL 写回泛化为 `targetParams.set('sort', …)`。

**4.0.0 API 主模式（2026-09-23 07:30；用户定案：全面强制 API + 分期 0/1/2 先行，见 D7）**：**A 安全+ETag**——PAT 移出 localStorage 镜像（gm.ts `SENSITIVE_KEYS`：lsWrite 跳写、gmGet 迁移清镜像，XSS 防护）；新增 `stars_full_sync_meta`（ETag/lastFullSyncAt/count）、`pullAllStarred` 带 `If-None-Match` 条件拉取（304 免额度免拉）、transform 成功后 `probeAndSync` 进页 idle 自动探（无变化免拉、超 TTL 强制整表）、`hasApiData()` 判渲染模式。
**B 渲染源切换**——有全量缓存：`transformStarsList` 不再解析原生卡不再抽缓存（API 已权威），改挂 `renderBrowsePage`（原生列表+原生分页器 `stars-original-hidden` 藏起；`buildCardFromCache`+`createStarButtonForCached` 纯缓存渲染）；**本地分页**：自造 `gsm-local-pager`（`buildLocalPager`，`data-gsm-page`）顶/底两份由 `updateLocalPagers` 同步页码与 disabled，`pagination.ts` 只拦本地页码点击（零 fetch、零 Turbo）；**本地退出**：`exitCustomMode`（pushState `?tab=stars`，Clear filter 不再整页导航）；**搜索纯本地**（`fetchNativeSearchResults`/`nativeSearchResults` 等全删）；**星星按钮纯 API**（PUT/DELETE `/user/starred/{o}/{r}` + Bearer PAT，CSRF 提单/三处检测管线整体移除，失败回落原生 form 路径）；无缓存：原生页 + `.gsm-setup-banner` 横幅（「设置 token」= `promptForToken`、「立即同步」= `runFullSync('button')`，无 token 自动弹配置，完成后 `transformAndReveal` 重建出网格）。
**C 死码清理**——snapshot.ts 删 `recordArrival`/位移/挂起全链只留 `purgeRepoFromSnapshots` 回调；starCheck 删 `enqueueVerify`/`kick`/`verifyOne`/`apiGet` 核对队列与双 404（P4 整表 diff 即权威确认，留 token/裁决写入/宽限区管线）；extract 删 `extractAndCacheRepoFromCard`；dom 删 `getRepoIdFromItem`；fullSync 删 `scheduleFullSync`（`probeAndSync` 接管）；filters 删原生搜索语言补充块与 `getTags` 死 import；+`NATIVE_PAGE_SIZE=30`（constants）。
**4.0.1 Lists 槽位接管 + 快捷 Token 配置（2026-09-23 08:20；用户诉求：初始化 UI 太丑、网格态别露 Lists 空态、Token 获取要快）**：①**顶窗落位**——`showSetupBanner` 不再 `host.prepend`，改为替换 `#user-profile-frame > div` 下的空态 `div.blankslate`（0 个 list 的「Create your first list」）或 `#profile-lists-container`（有 list 时该容器本就被隐藏），都不在则退回旧行为；②**网格态静默隐藏空态**——`dom.ts hideListsSection` 增 blankslate 直接子节点判定 + `base.css` 静态兜底 `turbo-frame#user-profile-frame > div > div.blankslate{display:none!important}`（document-start 即生效，补 JS 首跑前窗口；已建 list 内容区仍走原 `#profile-lists-container` 隐藏 = 有 list 也整体隐藏）；③**快捷获取 Token**——新模块 `src/tokenConfig.ts`：官方 fine-grained PAT Template URL（`settings/personal-access-tokens/new?name=GithubStarsGrid&expires_in=none&starring=write`，GitHub 2025-08-26 changelog，write 含 read = 读列表+加星/去星全覆盖）一跳到预填创建页，横幅「快速获取 Token」→ 新建页复制 → 回横幅内联粘贴行（剪贴板读取/前缀校验/保存并同步；注意 `.gsm-token-row[hidden]` 必须 `!important` 盖过 inline-flex）+ TM 菜单第二项「快捷创建」；④**失效一键更新**——`notifyTokenIssue`：401（拉取/探测/星星按钮）与 403 **排除限速**后（无 `retry-after` 且 `x-ratelimit-remaining`≠0）→ 居中弹窗单例（打开创建页/从剪贴板粘贴/稍后/保存并同步），判定依据官方 troubleshooting；⑤**savedHandler**（init 注册）——任一入口保存成功 → 撤横幅 + `runFullSync('button')`，同步成功后再撤一次横幅 + 重建网格；`tokenConfig` 独立成模块防 `starCheck→filters→ui/cards` 循环导入；`promptForToken(notify)` 加参（runFullSync 按钮路径自己续跑，notify=false 防双跑）；权限文案 Read→Write（星星按钮要 write）。
**4.0.2 三修（2026-09-23 09:10；用户报三问题）**：①**每次进页都全量同步**——实测：GitHub API 回 `Cache-Control: public, max-age=60`、CORS 暴露 ETag、条件请求 304 正常，官方 best-practices 明言「正确带 Authorization 的 304 不计主限流」；根因候选两枚并修：浏览器 HTTP 缓存（60s 内命中直接回缓存 200 不发请求；过期后本地合并 304 → JS 仍见 200）让 probeAndSync 误判「有变化」落入 runFullSync('auto')，且原 200 分支无日志无法区分「无基线」——修复：probe 与整表拉取的 fetch 都加 `cache:'no-store'`，补三条日志（整表后 `ETag 基线：已保存/未获得`、`ETag 探测 200：列表有变化→整表`、`ETag 快筛跳过（无基线/超TTL）`），下次真机看日志即定位；②**TM 菜单「快捷创建」无反应**——菜单回调没有用户激活，裸 `window.open` 被弹窗拦截器静默吞掉；gm.ts 新增 `gmOpenInTab()`（调用时判定），`@grant` 补 `GM_openInTab`，openTokenCreator 改走它，非 TM 环境回退 window.open；③**失效提示面板化**——tokenConfig.notifyTokenIssue 删居中弹窗，改 `setTokenIssueHandler` 回调（与 savedHandler 同模式），index 注册 → `showSetupBanner(detail)`（已有横幅刷新 `.gsm-setup-msg` 文案，否则槽位/列首挂面板），`bannerMessage()` 区分首次配置与失效文案，modal CSS 整块删除（95.39→93.81 kB）。来源：https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api 、https://www.tampermonkey.net/documentation.php?locale=en&q=GM_openInTab
**4.0.3 五改（2026-09-23 14:50；用户问「二次同步为何不走 ETag」并提出 4 项修改 + 2 项调研）**：①**整表入口一律条件化**——`runFullSync` 被 菜单/保存后 直调时 `pullAllStarred` **不带 If-None-Match**（条件化原来只在 probeAndSync 探测里），手动同步因此永远 200 整表；现 runFullSync 开头读 `stars_full_sync_meta`，TTL(48h) 内带 `If-None-Match` 首页条件请求 → 304 走 `notModified` 早退（只刷 `lastFullSyncAt` 保基线、免额度免拉），超 TTL 不带条件强制全量；probe 逻辑不动。②**手动同步入口收敛 TM 菜单**——fullSync 新增 `registerSyncMenu()`（init 注册「🔄 立即全量同步（GitHub API）」，无 token 自动弹配置）；横幅「立即同步」按钮块与标题行 `mountSyncButton/syncFromButton` 整体删除（`SYNC_SVG`、`.gsm-sync-btn` CSS、transform 调用同清，`headerRow` 改裸调 `mountTopPager` 防未使用报错）；「保存并同步」自动路径不变（savedHandler）。③**预填过期 90 天**——tokenConfig Template URL `expires_in=none` → `expires_in=90`（官方参数表合法值 = **1–366 整数或 `none`**，默认 30 天）。④**留空清 token 立即重开面板**——`promptForToken` 空输入分支原本只 `gmSet('')+console` 静默 return（即用户问「为何没弹出」的根因），现补 `notifyTokenIssue('Token 已清除')` → `showSetupBanner`（菜单入口新建、横幅入口刷新文案），prompt 留空提示同步改写。⑤**界面/菜单去开发表述**——bannerMessage 默认文案、prompt 首行、TM 菜单标签（去「核对 + P4 全量同步」）全部改用户语言；P2.5/P4 只留控制台日志与代码注释。调研结论（用户问 1/2）：**官方无创建个人 PAT 的 API**（`/orgs/{org}/personal-access-tokens` 是组织侧审批/撤销管理，非创建），快捷获取只能走预填 URL 深链——来源见 D8。

**三 bug 根因（用户 2026-09-22 报告，本轮已修）**：① `@match */*` 匹配不到单段路径 `/YsLtr`，且 `init()` 在非 stars 页早退不挂导航监听 → profile 直入/点 Stars 均无效；② `visibility:hidden` 可被后代覆盖（GitHub 还有 app 层 CSS 未查全），且揭示后网格 `gsm-grid-in` 淡入 0.3s——「页面出现后内容再淡入」被当成闪；③ `gmAddStyle` 注入的布局样式**没有任何移除路径**，同文档 turbo 离开后 180px 侧边栏/120px 头像规则仍生效。
**约束（永久生效）**：禁止 `import {GM_*} from '$'`（顶部一次性捕获与 document-start 不兼容，会固化成 undefined）；GM 一律走 `src/gm.ts`。

**Turbo 导航模型**：profile 标签链接均 `data-turbo-frame="user-profile-frame"`（`user-starred-repos` 嵌套其中、侧边栏/头像在 frame 外持久存在）。**进**：`before-frame-render` 用 `detail.newFrame` 判断目标是 Stars 才藏 frame（切去 Repositories 绝不隐藏），`frame-render` 后 `transformAndReveal(true)`——**Turbo 按 id 保留嵌套 starred frame（src 未变不发 frame-render），profile-frame 分支必须主动调用**；入场动画 = `transformAndReveal` 开头先挂 `gsm-anim-prepare`（让样式注入瞬间停在 296 起点）→ 解除隐藏 → 强制 reflow → 摘 prepare（296→180 过渡）。**出**：`before-frame-render` 非目标 + `frame-render` 非 stars + `turbo:load` 非 stars 三处调 `exitStarsView()`（撤主样式表 → 原生恢复，transition 在常驻表里 → 180→296 带动画回弹）。4s 兜底 = `armNavFailsafe` + boot FAILSAFE。移动端全程不隐藏。

### 数据存储（已向用户说明）
- 主存储 GM：`stars_tags_<userId>` / `stars_notes_<userId>` / `stars_repo_cache` / `stars_pending_delete`（取不到 userId 回退 `stars_tags`/`stars_notes`）；localStorage 镜像同键加前缀 `github-stars-grid::`。
- 迁移仅当 GM 为默认值时触发：GM 已有旧数据时，dev 写进 localStorage 的新数据**不会合并**。
- 核对/同步相关：`github_pat`（PAT，**4.0.0 起不写 localStorage 镜像**）、`stars_page_snapshots`（到货页快照，4.0.0 起只清不写）、`stars_star_verdicts`（裁决缓存）、`stars_shift_pending`（位移挂起，历史数据）、`stars_full_sync_meta`（ETag/lastFullSyncAt/count，4.0.0 新增）——机制见 DEVELOPER.md §5/§6，决策见下方「数据同步设计决策」D1–D8。

### 数据同步设计决策（2026-09-22 定稿，用户逐条确认）

**D1 · 到货快照 diff（检测层，3.0.9 已实现）**：`stars_page_snapshots` 按**规范化页 URL** 记录每次到货的 `{repoId: owner/repo}`；成员真相以到货页为准，同页 diff 的「消失」只产生候选。原地翻页不改地址栏 → 翻页到货用**取回内容的 href** 作键（`snapshot.ts` 的 `currentKey` 跟踪，Turbo 保留 frame 时的重复 transform 也落在正确键上）。同键首访只建基线（持久化 → 跨会话可比）；空到货不更新（渲染失败不能当全量 unstar）。

**D2 · 确认层（P2.5，3.0.9 已实现）**：双 404 确认**默认开启**（间隔 1.5s）；**不做同源 repo 页面 fallback**（用户定：抓页面太重）；网络失败 / 401 / 403 / 意外状态一律「不确定只当 stale」不改数据；预算 = 单次到货核对 ≤8、队列 ≤24、条间隔 200ms、速率余量 <50 或 retry-after 即暂停到 reset+30s（认证限额 5000/h）；单次缺失 >12 → 提示走 P4 全量（落地前只核前 8）。确认后复用 unstar 管线：缓存移入 `stars_pending_delete` 宽限备份、清标签/备注、**全量清快照**、卡片原地翻未 star；复 star 24h 内可恢复。

**D3 · Token 双格式（用户定：classic / fine-grained 都要）**：
- classic `ghp_`：有效 token 即可读全部 `/user/starred*`；**核对私有仓库需勾 `repo` scope**——无 scope 时「无权限的私有仓库 404」与「真 unstar 404」不可区分（D2 已排除页面 fallback，只能靠 token scope 规避），此为已知局限。
- fine-grained `github_pat_`：官方 fine-grained 权限表 **“User permissions for Starring”** 列出全部 5 个端点（`GET /user/starred`、`GET/PUT/DELETE /user/starred/{owner}/{repo}`、`GET /users/{username}/starred`）→ 勾 **Account permissions → Starring → Read** + 仓库范围 **All repositories**（2026-06-30 stargazers 端点收紧名单**不含**这些端点）。
- 配置入口：TM 菜单「⭐ 设置 GitHub Token」（任意 github.com 页可用）；存储键 `github_pat`；按前缀校验、非法拒绝保存；401/403 自动熔断当前 token，换 token 自动恢复。

**D4 · 位移判定（3.0.10，用户 2026-09-22 反馈 reverify 误核对后定，修订 D1 的「消失→候选→API」）**：a) 「被新 star 挤到下一页」的消失**不触发核对**——按排序方式+每页数量直接算预期页（`created`+desc → 本页+1；`created`+asc → 本页−1；`updated`/`stars` 与升序第 1 页 → 无位移模型），消失先挂起 `stars_shift_pending`；b) 核对只发生在「本该在本页出现却没有出现」= 挂起项在预期页缺失（无模型排序仍直接有界核对，≤8 / >12 走 P4 照旧）；c) 结算用**集合成员检测、不存顺序**——挂起项在任何到货页出现即确认清（顺序只用于同货次区分尾部/中部，推迟到预期页成员检测等价且更简单，用户指出按排序+页数直接计算即可）；d) 方向猜错（上拉到页码更小的一页 / 一次跨多页）由「预期页缺失 → API 204」无害兜底；e) 确认 unstar 后清全部快照**与挂起**。

**D5 · 搜索口径（3.0.11，用户定）**：a) **语言字段退出全文匹配**——自由文本只搜 作者/仓库名/描述/标签/备注，语言只通过下拉筛选指定（`ASC` 子串命中 `JavaScript` 的噪音消除，21 条 → 真实命中）；b) 搜索结果**命中字段高亮**——标题/描述/标签/备注四字段 `<mark class="gsm-search-hit">`（原生 meta 行不扫，语言已不参与匹配）；c) **「Recently starred」排序项等 P4**——客户端按 star 时间排序需要 `starred_at`，缓存未存；P4 用 PAT 拉 `GET /user/starred`（`star+json`）回填后，在自建 Sort 菜单补第 3 项（当前保持两项；`inheritNativeFilters()` 遇原生 Recently starred 回退 'stars' 属已知行为）。

**D6 · P4 全量同步与 Sync 按钮（3.1.0，用户定：「开始实现 P4，按钮放标题行右侧翻页器左边」）**：a) 数据源选 **REST `GET /user/starred` + `Accept: application/vnd.github.star+json`**（GraphQL 未采用，先跑通 REST，ETag/GraphQL 分页优化留后续）——参考项目 GithubStarsManager 同法实现（每页 100、页间 100ms），但本项目须兼容 fine-grained PAT（D3；参考项目只支持 classic）；b) 触发 = 标题行 **Sync** 手动（无 token 先弹配置）+ 快照消失 >12 自动（**且已配 token**；单飞 + 60s 冷却）；c) 权威边界照总则——**远端权威**：星标成员关系、star 时间、仓库元数据；**本地权威**：标签/备注（`fullSync` 绝不写 tags/notes）；d) 整表拉取**即 unstar 的权威确认**，直接复用 P2.5 宽限管线（`confirmExternalUnstar`：备份+清快照+卡片翻转）并写 7d 裁决，跳过逐条双 404；e) **完整性红线**：分页中断 / 解析失败 / 超 200 页上限 → 整体放弃不改任何数据（半表会把未拉到的页全判 unstar）；f) 写放大控制：交集回填整表只 load/save 各 1 次；g) 已知局限：classic 无 `repo` scope 时私有仓库 star 不在列表 → 误判 unstar（与 D3 同源；fine-grained 选 All repositories 无此问题）；h) **D5c 兑现**：Sort 补第 3 项「Recently starred」（`starredAt` 降序，未回填沉底保到达序），`inheritNativeFilters` 遇原生 Recently starred → `'created'`。

**D7 · 全面强制 API（2026-09-23 用户定，覆盖此前「双模式」初案）**：a) **有 PAT → API 主模式全功能；无 PAT → 原生页 + `.gsm-setup-banner` 配置横幅强推**（「立即同步」无 token 自动弹 `promptForToken`，配置完成点同步即出缓存网格）；b) 分期 **0/1/2 本轮已落地**（0 = PAT 移出 localStorage；1 = ETag 条件同步 + 进页自动 probe；2 = 渲染/分页/退出/搜索/星星按钮全本地化），3/4（周期自动同步、原生交互深化）后续；c) 非个人页 `github.com/<u>?tab=stars` 的 API 能力已调研——`GET /users/{u}/starred` 不受 2026-07 stargazers 端点收紧限制、可 unauth（60/h、100/页）、`star+json` 返回 `starred_at`——**本轮未接**（transform 只查本用户缓存），留后续。

**D8 · 同步入口与界面表述收敛（4.0.3，用户 2026-09-23 定，修订 D6b/D7a）**：a) 手动同步**只留 TM 菜单**（横幅/标题行按钮删除；横幅只余 配置/粘贴 两动作，保存成功自动同步）；b) **任何整表入口都带 ETag 条件请求**（TTL 内 If-None-Match、304 免额度早退——覆盖手动与保存后），probe 判定不变；c) 预填 Token 过期固定 **90 天**（`expires_in=90`；官方合法值 = 1–366 整数或 `none`）；d) **留空清除 = 删 token + 立即重开初始化面板**（不再静默消失）；e) **界面与菜单不出现 P2.5/P4/核对 等开发阶段表述**（仅控制台与注释保留）；f) 已调研：**GitHub 没有创建个人 PAT 的 API**（官方文档只给手动网页流程；`/orgs/{org}/personal-access-tokens` 系组织侧对成员 token 的审批/撤销管理，非创建）——快捷获取永久只能靠预填 URL 深链。
- 预填参数表（Pre-filling fine-grained personal access token details using URL parameters）: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
- 组织级 PAT 管理端点（非创建）: https://docs.github.com/en/rest/reference/orgs/personal-access-tokens

**未实现（后续阶段）**：P3 local-first 首屏的**剩余部分**（4.0.0 渲染源已全走缓存 = P3 主体已达成；余 = 无 PAT 用户的本地镜像首屏与到货校正/增量 patch）；P4 余项——GraphQL 分页调研（ETag 已落地）、**周期自动同步**（当前 = 进页 `probeAndSync` + TM 菜单手动，4.0.3 起 Sync 按钮已删）；D7c 非个人页 `GET /users/{u}/starred` 接入。

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

1. **用户重装 `dist/github-stars-grid.user.js`（4.0.0）前台验证**：① **首次装（无 token）**：原生页 + `.gsm-setup-banner` 横幅出现；点「设置 token」弹 PAT 输入（classic `ghp_` / fine-grained `github_pat_` = Account permissions → Starring → Read + All repositories）、「立即同步」按钮转圈 → 控制台「★ P4 全量同步完成」→ 网格自动出现（全量缓存渲染）；② **有 token 重进页**：直接缓存网格无闪烁，控制台见「ETag 304」或「★ P4 全量同步完成」（进页 `probeAndSync` 自动）；③ **本地翻页**：点顶/底 Previous/Next 零网络（Network 无 GitHub 列表请求）、页码「N / M」随缓存与语言/排序筛选联动、按钮内转圈 = `gsm-pager-loading`；④ **搜索** `ASC` 纯本地出结果 + 命中词黄高亮（无 JavaScript 噪音）；⑤ **星星按钮**：点卡片星 → Network 见 `PUT/DELETE /user/starred/...` 204/205，刷新后状态保持，失败回滚；⑥ **退出自定义模式**：标签/搜索清空或点原生 Clear filter → 地址栏回 `?tab=stars` 且**不整页刷新**（pushState）；⑦ 离开/返回 Stars 侧边栏恢复与收缩动画正常、直进 `?tab=stars` 观察 10s 不回退原生；⑧ Sort 三项含 Recently starred（`starredAt` 降序，未回填沉底=到达序）。**判读**：②见「ETag 探测 HTTP 4xx」→ PAT 权限对照 D3；⑤ 404 → 仓库路径/私有权限；横幅不同步消失 → 「立即同步」报 401/403 换 token。若仍闪：要控制台 `script loaded / 防闪烁隐藏已挂载 / 防闪烁解除` 各行原文。
**4.0.1 补充验证（同批重装后一并看）**：①首次装（无 token/无缓存）：Lists 空态被顶窗**原位替换**（横幅出现在 Lists 标题下槽位，不是列首多一块）；②点「快速获取 Token」新开预填创建页（名称 GithubStarsGrid、Account permissions → Starring: write 已勾）→ 生成复制 → 回横幅「从剪贴板粘贴」→ 输入框出现 token →「保存并同步」→ 横幅消失 + 控制台「★ P4 全量同步完成」+ 网格出现；③有 token 网格态：Lists 标题/空态/已建 list 内容全都不显示；④失效 token（401）或低权限 token（403 非限速）触发同步/星星按钮 → 居中弹窗，「打开创建页」预填、「保存并同步」后横幅撤 + 同步重跑；⑤ TM 菜单两项：「⭐ 设置…」prompt 权限文案已是 Write、「🔑 快捷创建…」新开预填页。
**4.0.2 补充验证（同批重装）**：①**进页同步行为**：重装后第一次进页可能整表一次（建基线，控制台见 `ETag 基线：已保存`）；之后每次进页控制台应是 `ETag 304：star 列表无变化（免额度快筛）`，不再出现 `★ P4 全量拉取开始`；若再见整表，看日志属于 `无基线`（etag 没抓到 → 回报，备选 If-Modified-Since / GM_xmlHttpRequest 读头）还是 `200：列表有变化`（真变化）；②**TM 菜单「🔑 快捷创建」**点击应新开预填创建页标签（无报错、非静默无反应），横幅「快速获取 Token」同样；③**失效面板**：用低权限/失效 token 触发 401/403 → 列首或槽位出现 ⚠️ 文案横幅（含快速获取/手动设置/立即同步按钮），**不再有居中遮罩弹窗**；面板内保存后横幅消失并自动同步。
**4.0.3 补充验证（同批重装；作废 4.0.0/4.0.1 清单里「立即同步」按钮相关步骤——按钮已删）**：①横幅只剩「快速获取 Token / 设置 token（+粘贴行）」，标题行只有顶部翻页器、无 Sync 按钮，全界面无 P2.5/P4 字样；②**手动同步走 TM 菜单**「🔄 立即全量同步（GitHub API）」：列表无变化时控制台应打 `ETag 304：star 列表无变化（免额度），跳过整表比对`、Network 只见第一页一条 304（无后续页）；新 star 一颗再同步 → 完整 `★ P4 全量同步完成`（新增 1）；③横幅「保存并同步」同为条件化（304 即完成并撤横幅）；④「快速获取 Token」新开页 **Expiration 默认 90 天**；⑤ TM 菜单「⭐ 设置 GitHub Token」**留空确定** → token 删除且初始化面板立即出现（横幅已在则文案刷新为「Token 已清除」）；⑥失效 token 面板、本地翻页、高亮等 4.0.0/4.0.2 清单项照旧。**判读**：② 若 304 后仍整表 → 看控制台 `ETag 基线` 是否「已保存」（已保存仍 200 → 回报 runFullSync 起始几行日志）；⑤ 面板没出 → 回报 `token 已清除` 那行之后的控制台。
2. **dev HMR 在 github.com 上需要浏览器放行 CSP**：GitHub 的 `script-src` 白名单不含 `127.0.0.1`，dev loader 的动态 import 必被拒（`Failed to fetch dynamically imported module`）。插件绕不过，需装 CSP 放行扩展 + 允许 Local Network Access 弹窗。详见 `DEVELOPER.md` §2「dev 模式在 github.com 上的两个前置条件」。
3. **两个脚本不能同时启用**：`transformStarsList()` 见到 `.stars-grid-container` 就提前返回，正式版先跑会让 dev 版"改了没反应"。开发时在 Tampermonkey 里禁用正式版。
4. 真机验证必须**前台**：Chrome 冻结后台标签页后测量/交互全部失真（曾误判样式失效）。
5. `todo` 文件按上次决定继续留在未跟踪状态，未纳入提交。

### 下一步

1. 等 4.0.3 验证结果：清单 = 「4.0.3 补充验证」（叠加 4.0.2 的 ETag 探测/开新页/失效面板三项；4.0.0/4.0.1 清单涉及「立即同步」按钮的步骤作废）。核心判读：菜单二次同步在列表无变化时必出 `ETag 304…免额度` 且 Network 无整表；留空清 token 必弹面板；预填页过期 = 90 天；全界面无 P4/P2.5 字样。若 304 不出现：查 `ETag 基线` 日志是否「已保存」（已保存却不带条件 → 回报）。
2. **快速构建阶段（2026-09-22 起，用户已定）**：不跑 `tests/smoke/`，不写测试 fixture/断言；改完只 `pnpm check`，由用户在真实页面判断是否成功。
3. 若 GitHub 再改版：先跑 `tests/diag/selectors.js` 定位失配点，再改 `src/dom.ts` 的 helper（**只改 helper，不要在业务模块里写选择器**）。
4. 数据同步后续阶段（**P4 主体已在 3.1.0 落地**，见 D6）：**P3** local-first 首屏（缓存快照先显 + 到货校正 + DOM 增量 patch）；P4 余项——ETag/GraphQL 分页调研、**周期自动同步**（当前 Sync 手动 + 消失 >12 自动，可加定时 idle 同步）。见「数据同步设计决策」。

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
