# GithubStarManager — Agent Handoff

> 架构 / 模块职责 / 数据流 / 存储模型 / 约束以 **`DEVELOPER.md`** 为准（权威文档，勿在此重复）。
> 本文件只记录：**当前状态、仍生效的设计决策、调试要点、下一步**。
> 历史过程一律查 `git log`（提交信息本身写得很详细），本文件不写「上一轮改了什么」。

---

## 当前状态

版本 **4.10.0**（`package.json` 为单一版本源，`vite.config.ts` 读它写入脚本头）。

> 交接时间：**2026-10-02 20:30 +0800**（本机时钟；上一次交接标注的 21:40 与本机 `date` 不符，以本行为准）。

**4.10.0（本次交接的版本）**：两组功能 + 一处顺带修 + 一轮死码清理 + 一轮发布前独立审查修复。规划与验收标准见
`docs/plans/archive/2026/2026-10-02-分页按钮可跳页-点击输入目标页-所有-sync-入口与头部同步按钮完全联动-图标旋转-删除旧的整.md`
（联网调研证据另见 `docs/research-pager-jump-a11y-spinner.md`）：

1. **分页按钮可以跳页** —— 修「页码指示器只显示页数、点击无任何效果」：指示器由静态 `span` 升级为
   `<button type="button" class="btn BtnGroup-item gsm-page-info">`；点击 → **同一单元格内原位换成输入框**
   （`type=text` + `inputmode=numeric`，**不用** `type=number`）→ `Enter` 提交 / `Escape` 取消 / 失焦提交。
   非数字与越界**静默夹取**（`0`/`-1` → 第 1 页，`999` → 末页），夹取后等于当前页则不重绘，全程不弹提示。
   跳页与 `Previous`/`Next` **共用唯一提交口径** `navigateToLocalPage()`（`src/pagination.ts`）。
   交互**全部由 window-capture 委托承担**（不往分页器节点挂监听）—— 顶部分页器是 `cloneNode(true)` 的克隆件，
   **克隆不会复制事件监听**（见 D22）。
2. **所有同步入口都驱动头部 Sync 按钮** —— 修「部分入口点击后无明显回应」：`fullSync.ts` 新增同步状态
   **单一真相**（`SyncState` = idle/running/failed + `getSyncState` / `subscribeSyncState` / `setSyncState`），
   `runFullSync` 只推进状态并在开始/finally 广播；`mountSyncButton` 是该状态的**唯一视图**。
   五个入口（TM 菜单 / 配置横幅 / 标题行按钮 / Token 保存后 / 进页自动）触发的同步，都让按钮内的
   **octicon 旋转**，而按钮文字与几何**恒定不变**（见 D23）。
3. **删除旧刷新态**：`.gsm-pager-loading`（整按钮文字变透明 + `::before` 伪元素转圈）与其全部 `classList`
   读写已删；`@keyframes gsm-spin` 保留并转由新规则复用。git 全历史查证**不存在第二套刷新态实现**
   （`270ba4d` 翻页链接引入 → `fff03cc` Sync 按钮复用 → `91be837` 搬到横幅 → `5284745` 全删 → `67151c9` 恢复），
   用户所说的「旧的整按钮刷新态」就是这一套，现已无任何消费者。
4. **顺带修**：`pushNotice` 的容器入口加视口门 —— 窄视口下从 TM 菜单触发同步不再把通知栈懒重建出来
   （消掉「已知风险」第 10 条的剩余一半，见 D24）。
5. **发布前独立审查轮**（外部 reviewer 复核整批 diff，抓到 1 个 P0 + 3 个 P1，**全部已修**）：
   P0 = 新引入的「失焦即提交」在渲染**内部**嵌套再调一次 `renderBrowsePage`（`renderBrowsePage` 会
   `remove()` 底部那份分页器再插回，而摘掉含焦点的子树本身触发 `blur`）⇒ 页码文字与网格内容各说各话，
   触发路径全与用户无关（进页自动同步 / 同步后重渲染 / 导入后的 `applyFilters`）；改为 **blur 延后一拍
   再判 `input.isConnected`**。P1 = `updateLocalPagers()` 那道过粗的跳过门（编辑态下 prev/next 不更新）、
   关闭输入后焦点掉到 `body`、文档说 `-1` 会夹到第 1 页而实现是「不跳」。顺带清掉重复注释、无消费者的
   `export`、`getSyncState` 返回可变引用等 P2。逐条口径见 **D22 / D23**，验证见「下一步」第 8 条。

> **交接第一件事**：`@version` 已变 ⇒ **用 dev 脚本的人必须重装 dev loader**（重开安装页原地更新），
> 否则 TM 菜单整体消失。正式版不受影响。机制见下「dev 模式必须知道的四件事」第 4 条。

**4.9.2 提要**（仍生效的口径已全部归入 D18–D21，此处只留一句）：窄视口完全惰性 + `viewTeardown` 幂等回滚 +
`lifecycle` 世代号 + GM 权限 8→5；另有一轮独立审查修掉 5 处真缺陷（原生搜索拦截未解绑、回滚后仍发整表 API、
桌面 Hide Lists 回归、首次安装 Lists 标题行外露、topics 回填无身份校验）——实现细节查 `git log` 与
`docs/plans/archive/2026/2026-10-02-优化手机端-窄视口-脚本行为-…-精简-gm-权限.md`。

**更早的版本**（改动细节查 `git log` 与对应 ADR；此处只保留仍生效的口径）

- **4.9.1**：通知栈锚在全局头部下方（`header-wrapper` 底边 +8px）；观感 = GitHub 自己的 `.flash` 内联消息族
  （**不要**回退 Primer `Toast` 族）；同步后立即重渲染、删掉「点击刷新」提示。现行口径见 **D11 / D12**。
- **4.9.0**：写路径两条通道（REST / 网页端点）静默分派；全局串行变异队列（≥1s，排队中再点 = 撤销）；
  变化简报 + 恢复菜单；导入后不自动同步；配置横幅两条 Token 深链。见 `docs/adr/0003`–`0006` 与 **D3 / D9 / D10**。

**限流实测已完成**（2026-10-01 真机执行；`docs/research-ratelimit-measurement.md` + 原始 `.jsonl`）：判定 **D1** ——
`used` 每请求 +1、primary 按请求数计，官方「5 点/次」表**不作用于 primary**；仓库自有的写入成本 = **1 点/请求**，
1s 间隔（60 写/分钟）距文档化的 900 点/分钟有 15× 余量。**结论不据此改动 1000ms 默认值**（实测规模不足以
推翻官方 best-practices；1s 同时满足「串行」与「≥1s」两条独立要求）。L2 按协议**有意未跑**（理由见该文 §5）。
两条写通道的限流**可观测性不对称**：API 侧完全可观测（1 点/次，两次独立确认），网页端点**零限流响应头**。

**网页写端点通道的关键实测结论**（全量证据见 `docs/research-web-star-endpoints.md` 附录 A）

- 离页仓库 + 仅 `GitHub-Verified-Fetch` 头 + 86 字符占位 token → `POST /star` 200（API 复核 204）/
  `POST /unstar` 200（复核 404）：**双向成立**，基线可复原。
- 「422 → 取仓库页表单 token 重发」的前提**被推翻**（仓库页纯客户端渲染、0 个 `<form>`；per-form token 只在
  原生 stars 列表页有，覆盖不到恢复场景的仓库）⇒ 该回退段已删，降级只有两段。
- classic 创建页 `?scopes=repo` 预填**无法判定**（被 sudo + passkey 门拦住）—— **不得**声称可用或不可用。
- `context=user_stars` 用于 repo 作用域端点：200 无报错，服务端是否据其分支不可知 → 只作原样携带。
- 端到端（真机跑脚本代码、非手搓请求）：卡片星按钮 → 乐观翻转 → 通知栈「撤销」→ API 复核 404 →
  点撤销 → API 复核 **204 零残留**，目标仓库状态与初始一致。

**顺带修掉的一个真问题**：`fullSync` 在「点 Sync 但没配 token」时调 `promptForToken` → **原生 `window.prompt`
阻塞整个页面主线程**（实测：页面 JS 通道整体失去响应，重载才恢复；原生对话框属浏览器 chrome 层，
**不进页面合成帧**，截图看不到 ⇒ 极易误判成「页面正常但无响应」）。prompt 式入口早按用户更正撤除，
横幅才是 ADR 0004 指定的入口 —— 已改为 `notifyTokenIssue(...)` 打开配置横幅（TM 菜单入口仍保留 prompt）。

**自动化真机验证的两个环境坑**（下次别再踩）：① 标签页 `visibilityState:'hidden'` 时 Chrome **丢弃
CDP 派发的鼠标事件**（逐字正确的三事件序列 + `elementFromPoint` 确认命中，`window.__clicks` 仍为空）；
② `agent-browser-cli` 会在页面 MAIN world 注入对话框抑制脚本，把 `window.alert/confirm/prompt` 换成 stub；
凡要观察 alert/prompt 的验证必须先确认该 stub 是否在场。另外 `Page.bringToFront` 需
`allowFocus` 作为 **`method` 的同级参数**（不是 `params` 内），否则静默 skipped。

---

## 仍生效的设计决策

历史决策 D1（到货快照 diff）/ D2（双 404 逐条核对）/ D4（位移挂起）**已作废**——随 4.0.0 API 主模式与
> 编号**不连续**：D13–D16 在本文件与 `DEVELOPER.md` 中**都无定义**，D17 只在正文被引用（无独立条目）。
> 需要时查 `git log` 与 `docs/adr/`。**新增决策请从 D22 起编。**
4.0.10 死码清理整体删除，星状态真相改由整表 diff 权威判定。以下为现行决策。

**D3 · 写路径凭证（REST 只支持 classic；另有网页端点通道）**

- **REST** 写路径只按 classic PAT 设计：fine-grained PAT 无法对「不属于本人、也不属于本人所属组织」的公开仓库
  加星/取消星（`403 Resource not accessible by personal access token`，官方原文「Only personal access tokens
  (classic) have write access for public repositories that are not owned by you…」），GitHub App token
  （`ghu_`/`ghs_`）被官方 OpenAPI 标 `enabledForGitHubApps: false`。OAuth app user token（`gho_`）走 **scope** 体系，
  与 classic PAT 同构，可用。
- **但写路径不止 REST**：拿不到 classic token 时改用浏览器登录会话走网页端点 —— 这是 fine-grained 用户获得写能力
  的唯一现实手段。触发条件、凭据、成功判定、失败语义见 `docs/adr/0006-web-endpoint-write-fallback.md`。
  **降级只有两段**（页面有该仓库表单 → 用真实 token；否则仅 VF；都失败即报错）：原第三段「422 → 取仓库页表单
  token 重发」经 2026-10-01 实测证明前提不成立，已删除，见 `docs/research-web-star-endpoints.md` 附录 A。
  两条通道由 `setStarState()` **静默分派**，**不向用户披露**（用户裁定），但**静默 ≠ 静默失败**：任何失败都必须报错。
- **scope 取 `repo`**（非 `public_repo`）：`public_repo` 不覆盖私有仓库，会让私有仓库的 star 不出现在
  `GET /user/starred` 里而被整表 diff 误判为外部取关。用 `repo` 消除该误判，代价是权限更大——刻意选择。
- **读路径不受限**：`GET /user/starred` 无 Additional permissions，fine-grained PAT 同步正常；脚本检测到
  `github_pat_` 前缀时**不拒绝配置**，但在配置 UI 说明其缺陷（`TOKEN_KIND_HELP`，与 classic 深链并排显示）；
  403 提示**不得**再让用户「检查 Starring 权限」。
- 配置入口：TM 菜单「⭐ 设置 GitHub Token」+ 横幅内联粘贴行 + **两条**快速创建深链
  （classic：<https://github.com/settings/tokens/new?scopes=repo&description=GithubStarManager>；
  fine-grained：官方 Template URL 预填 `starring=write`）。留空 = 清除 token 并立即重开配置面板。
- 权限事实来源：<https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens>、
  <https://docs.github.com/en/rest/activity/starring>、`docs/adr/0004-write-requires-classic-pat.md`（含 OAuth device flow
  为何被否决）、`docs/research-web-star-endpoints.md`（网页端点三组对照实测）。

**D5 · 搜索口径**

- 自由文本只搜 **作者 / 仓库名 / 描述 / 标签 / 备注**；**语言不参与全文匹配**（否则 `ASC` 会子串命中 `JavaScript`），
  语言只走下拉筛选。
- 命中词以 `<mark class="gsm-search-hit">` 高亮（四字段、大小写不敏感、只包文本节点、跳过输入控件）。

**D6/D7 · 同步与数据权威（现行总则）**

- 有**完整缓存**（`hasApiData()` = 有 `lastFullSyncAt` 且 `count > 0`，**与当前有没有 token 无关**）→ 网格主模式
  （缓存渲染 + 本地分页 + 本地筛选 + 星星按钮）；无缓存 → 原生页 + `.gsm-setup-banner` 强推配置。
- **权威边界**：远端权威 = 星标成员关系 / star 时间 / 仓库元数据；本地权威 = 标签 / 备注（同步绝不写 tags/notes）。
- **完整性红线**：分页中断、解析失败、超 200 页上限、速率余量不足 → 整表放弃、不改任何数据（半张表会把未拉到的页全判 unstar）。
- 单遍条件扫描：全 304 → 免额度早退；部分 200 → 只有变化页带 body，304 页用本地缓存切片复原。
- **恢复必须打远端**：只做本地回滚会制造「本地有星、远端无星」，下一轮同步又把它判成外部取关。

**D8 · 同步入口与界面表述**

- 手动同步 = **三个等价入口**：TM 菜单「🔄 立即全量同步」、横幅「立即同步」、标题行 Sync 按钮；一律经条件快筛后才决定是否整表。
- 界面与 TM 菜单**不出现** P2.5 / P4 / 核对 等开发阶段表述（仅控制台日志与代码注释保留）。
- GitHub **没有**创建个人 PAT 的 API，快捷获取永久只能靠预填 URL 深链。预填参数表（fine-grained 的
  Pre-filling … using URL parameters）见上面的个人访问令牌文档；classic 的 `?scopes=` 预填官方**未文档化**。
  组织级端点 `/orgs/{org}/personal-access-tokens` 是审批/撤销管理，**非创建**。

**D9 · 导入导出（4.7.0）**

- 导出包**只含本地权威数据 + 与之相关的派生数据**（有标签或有备注的仓库元数据）；**不含** `github_pat`、同步元数据
  （ETag 基线）、宽限期备份——理由见 `docs/adr/0001-export-import-format.md`。
- 合并语义：标签并集（本地在前）、备注以文件为准但**空备注不覆盖**本地非空备注、仓库元数据只补空缺。判空统一为
  **trim 后为空**（`saveNote` 同步收紧）。
- 校验 `kind` + `schemaVersion` + `user.id` **三者齐备才放行**；`kind` 是协议身份、**永不随脚本改名变动**，文件名 slug 才随改名变。
- 交互：破坏性确认用 `window.confirm`、失败用 `window.alert`（**失败不弹 confirm**）；导入不导航，仅在「Stars 页且网格已存在」时重绘；
  **导入后不自动同步**（`docs/adr/0005-no-auto-sync-after-import.md`）。
- 下载：**只用 `GM_download`（4.7.0 新增 `@grant`），不做原生兜底**——Blob + `<a download>` 能绕过 TM 的扩展名白名单，
  等于架空用户的安全设置，已明确否决。TM 侧「下载」未开或扩展名不在白名单时**不抛错、不返回、只走 `onerror`**，故这类失败
  在脚本内**不可观测**：`gmDownloadFile` 返回 true 也不代表文件已落地，只能由 alert 引导用户去 TM 设置（Advanced）加 `json`。
- 分层铁律：`storage/exportImport.ts` 是**纯逻辑**（不碰 DOM、不弹对话框、不触发同步），交互全在 `ui/exportImportMenu.ts`。

**D10 · 变异请求的节流与队列（4.9.0）**

- **串行是硬要求、1s 是建议间隔**（官方 best-practices 两条独立要求；Octokit plugin-throttling 对写请求默认
  `{maxConcurrent: 1, minTime: 1000}`）。卡片星按钮与恢复**共用同一个队列**，间隔按**开始时刻**算。
- 卡片：点击 → 乐观翻转 → 入队；**排队中再点 = 撤销**（请求不发出、外观回滚）；执行中点击忽略。
- `.then` 里**必须做 handle 身份校验**：否则「撤销 → 重新点击」会让旧条目回调清掉新操作的护栏，同一仓库被重复入队。
- **不自动重试**；失败分类（401 / 403 权限 / 403 限流 / 404 / 网络 / 422 CSRF）各有独立文案，文案**不暴露通道**。

**D11 · 通知栈的定位与观感（4.9.1）**

- **定位**：容器常挂 `document.body`，**不是** header 子节点；`header-wrapper` 只当**几何锚点** → `top = max(headerBottom + 8, 8)`。
  头部随页面滚走（实测其 `position: relative`、滚动 400 时 `rect.top = -400`），故头部出视口后**夹回视口顶部 8px**。
  重算走 `scroll`(capture) / `resize` / `visibilitychange` + rAF 合帧。**visibilitychange 不可省**：后台标签页里
  `scroll` 事件与 rAF 都被冻结（实测 scrollEvents 恒为 0），回前台不补一次就会停在过期位置。
- **观感 = GitHub 自己的 `.flash`**（内联消息族，配对 token 逐条抄自线上样式表）：`bgColor-*-muted` 浅底 +
  `borderColor-*-muted` **1px 真描边** + 16px **细线** octicon 着 `fgColor-*`，一套 `KIND_STYLE` 表管全套。
  尺度对齐本脚本既有 UI：6px 圆角、`0 1px 3px rgba(0,0,0,.08)` 阴影、`12px 16px` 内边距、按钮 14px / `6px 14px`。
- **不要用 Primer `Toast` 族**（`bgColor-*-emphasis` 48px 满饱和图标条 + `--shadow-floating-small` 三层投影）：
  那是浮动 toast 语言，用户 2026-10-02 明确判定「与卡片格格不入」。`--shadow-floating-legacy` /
  `--color-overlay-shadow` 在今天的 github.com **都未定义**（探针证实），照抄源码名字会静默失效。
- 交互反馈内联样式没有 `:hover`，用 `withHover()` 一对监听补（按钮三态走 GitHub 默认按钮 token；关闭按钮 `.flash-close` 的 0.7/0.5）。
- **DOM 顺序铁律**：动作按钮必须在 `box.append(icon, label)` **之后**追加，否则按钮会插到图标之前
  （曾真实发生过：`appendChild(btn)` 写在统一 append 之前 → 渲染成 `[按钮][图标][文本][关闭]`）。

**D12 · 同步后立即重渲染（4.9.1，推翻 4.9.0 的抑制策略）**

- `changed > 0`（增删差异 **或** 可见元数据更新）且在网格视图 → 直接 `applyFilters({keepPage:true})`，
  **手动与自动来源一视同仁、不问「是否刷新」**（用户裁定）。
- 4.9.0 的 `INTERACTION_QUIET_MS` / `lastInteractionAt` / `ensureInteractionTracking()` 三监听已整段删除；
  **不要**恢复「弹一条可点击的刷新提示」——那是被明确否决的口径。
- 已知代价（用户裁定接受）：进页自动同步时列表会在用户眼前重排；换来的是「简报说什么，列表就是什么」，不再有「提示与数据不一致」的中间态。

**D18 · 窄视口（<768px）完全惰性（4.9.2）**

- **语义 = 「脚本没装过」**：不注入任何样式表、不建任何节点、不改 GitHub DOM、不弹任何 UI、不发进页自动同步。
  **不做**移动端卡片降级布局（移动端体验交回 GitHub 原生）。
- **CSS 会自动失效，JS 不会** —— 这是「脚本没直接失效、而是留下残次内容」的根因：布局 CSS 全在 `@media` 里，
  但脚本写的节点 / class / **内联样式** / 被搬走的原生节点都不会自己回退，且**内联 `display:none !important`
  不受任何媒体查询门控**（曾让 Lists 区块在手机上永久消失）。
- **门必须开在注入之前**：`transformAndReveal()` 首行判定视口（早于 `ensureStarsSetup` / `ensureStyles` /
  `showSetupBanner`）。其余的门分散在 `applyHideListsGate`、`hideListsSection`（+ `clearListsHiddenMarks()`
  清残留）、`applyFilters`（兜底拦回滚前排队的异步回调）、`scheduleProbeSync`（**排队时与 2s 回调内各判一次**）、
  `turbo:load` / `turbo:before-visit` / `turbo:before-render` / `turbo:before-frame-render`、
  原生 Clear filter 点击拦截（不拦的话会经 `exitCustomMode → applyFilters → hideNativeFilterMenus`
  把原生 Type/Language/Sort 三个菜单设成 `display:none`）、`search.ts` 的两个拦截回调。
  **以 `grep -rn 'isDesktop()' src/` 为准，不要在此维护数量**（曾写「6 处」，审查实测 12 处，计数版必有偏差）。
- **挂在原生节点上的监听也是「JS 写入」**（4.9.2 审查补）：样式表能靠 `@media` 自动失效、节点能靠 teardown 删掉，
  但**事件监听两个都不会**。故原生 form/input 上的监听必须由 `lifecycle` 作用域持有（`search.ts` 的
  `searchScope` + `disposeSearchInterception()`），teardown 时解绑。**禁止**用「data 标记串防重复挂载」代替：
  标记串能防重复，但**摘不掉**已挂的监听，而且标记本身就是回滚后不该留的痕迹。
- **窄视口不显示配置横幅**（用户裁定 V1）：横幅样式在 `base.css` 的媒体查询**之外**，手机上会以完整样式出现，
  是最刺眼的一件残留；需要配置 Token 的窄视口用户走 TM 菜单「⭐ 设置 GitHub Token」。
- **窄视口不发进页自动同步**（用户裁定 V2）：手机上没有网格呈现结果，纯耗额度；TM 菜单手动入口保留。
  该 2s 定时器除排队时判视口外，还挂了**世代号**（`scheduleProbeSync` 的 `ifCurrent`）—— 否则「桌面打开 →
  2s 内收窄」会让页面已退回原生视图却仍在拉整表 API，且检出变化时会把通知栈在窄视口重建出来。
- **TM 菜单项在任何视口都注册**（用户裁定 V6）：菜单不写页面 DOM，且用户可能只是临时缩小窗口。

**D19 · 断点单一真相 + 运行中双向切换（4.9.2）**

- 判定**只用** `window.matchMedia('(min-width: 768px)').matches`（`utils.isDesktop()`），**禁止** `window.innerWidth`：
  Safari/WebKit 的媒体查询宽度 = `clientWidth`（不含经典滚动条，WebKit bug 52653 至今 OPEN），
  用 innerWidth 会出现「JS 认为桌面、CSS 认为手机」的错位窗口。
- 跨断点实时双向切换（`subscribeBreakpointChange`，150ms debounce）：变窄 → 完整 teardown；变宽 → 重新
  `transformAndReveal(false)`。**不要**退回「只在导航时判定」或「reload」两种方案（前者等于没修，后者丢滚动/筛选状态）。
- `WIDE_BREAKPOINT` 常量已删（零消费者）；CSS 侧断点数字仍是手写，改一处要同步 `base.css` / `persistent.css` / `wide.css`。

**D20 · 回滚 = 按痕迹 + 世代号（4.9.2）**

- `src/viewTeardown.ts` 是唯一回滚点，幂等，由 `exitStarsView()` 调用（离开 Stars / 转换失败 / 跨断点收窄共用）。
  **按痕迹回滚**：只认脚本自有 class（`gsm-*` / `stars-*`）与两类 `data-gsm-*` 标记
  （`GSM_HIDDEN_ATTR` = 我们改过它的 display；`GSM_TOPICS_SRC_ATTR` = topics 是从这个节点搬走的，
  回填**只认标记不认 `isConnected`** —— Turbo 原位重渲染会换出一个新的 `.col-lg-3`，倒进去就是重复 topics）；
  **禁止**启发式猜测
  「这个 inline display 大概是我们设的」。
- **凡是把 GitHub 原生节点设成 `display:none`，必须同时打 `GSM_HIDDEN_ATTR` 标记**（现成做法：`filters.ts`
  的 `hideNativeNode` / `showNativeNode`）。裸写 `el.style.display` 是回滚不掉的。
- `src/lifecycle.ts` 提供受管监听/定时器作用域 + **世代号**：`beginGeneration()` 在每次转换与回滚时递增，
  `guardedTimeout()` / `ifCurrent()` 让过期回调自我作废。**没有它，回滚会被自己排的队撤销**
  （150ms×12 的重试链会把刚摘掉的样式表重新装回去）。同 `mutationQueue` 的 handle 身份校验思路。
- 数据层不随视口回滚：存储迁移、超期备份清理、缓存写入与窗口大小无关。
- **回滚边界：视图级 vs 页面级**（4.9.2 审查补）。teardown 只回滚「Stars 视图的产物」，**不得回滚页面级偏好**。
  「隐藏 Lists」属页面级：`applyHideListsGate()` 在 document-start 就对任意匹配页挂上，门控 CSS 的选择器指向
  `#profile-lists-container` / `blankslate` 等**非 Stars 专属**节点。⇒ `clearListsHiddenMarks()` 与摘
  `gsm-hide-lists` **只在 `!isDesktop()` 时做**；离开 Stars 去别的 profile 标签时必须原样保留，否则切到
  Repositories 后 Lists 会与开关状态相反地冒出来（4.9.2 首版真踩过）。反过来窄视口必须清干净：
  那个 `display:none` 是**内联**且带 `!important` 的，不受媒体查询门控。
- 回滚清单第 10 项 = 原生搜索框上的 `submit` / `keydown` 监听（`disposeSearchInterception()`）。

**D21 · 清理判据与 GM 权限最小化（4.9.2）**

- **删兜底的判据**：有没有实测/官方文档证明它曾经救回过场景；没有就删，并在原地留一句「曾用过什么」。
  保留的 6 类各有硬理由（`:has()` 退路有 `cssTarget=safari15` 背书；12×150ms 重试 + 双 4s 兜底防白屏；
  GM↔localStorage 镜像层是 dev/非 TM 的唯一数据通道；`tags`/`notes` 旧键迁移删了会丢用户数据；
  `starWrites` 两段式与 `fullSync` 完整性阀门有真机实测/ADR 红线）。
- **@grant 只剩 5 项**：`GM_getValue` / `GM_setValue` / `GM_registerMenuCommand` / `GM_openInTab` / `GM_download`。
  **TM 的能力徽标按声明的 `@grant` 数组生成，不做调用分析** ⇒「声明了却走别的通道」照样进用户看到的能力清单，
  要真变短就得删授权：linguist 色表改走**原生 `fetch`**（+ AbortController 手搓超时，不用 `AbortSignal.timeout`
  ——它要 Safari 16+），菜单标签改走 `GM_registerMenuCommand` 的 `{ id }` 原地更新（TM **5.0**+；
  4.20 引入的是 `options` 对象本身，`id` 是 5.0 —— 官方文档 <https://www.tampermonkey.net/documentation.php?q=GM_registerMenuCommand>。
  VM 2.15.9+ 同语义；**老版 TM 忽略 `{ id }` 但照旧返回 id ⇒ 每次切换累积一条重复菜单项**（功能不受影响，仅菜单变长），
  且 HEAD 在同样路径上已有此行为，非 4.9.2 引入），
  历史死键清理（含 `GM_deleteValue`）整条删除。
- 已删：4 个零引用符号、3 处旧选择器退路、上一代 `.my-3` CSS-only 兜底、`LEGACY_STORAGE_KEYS` 与它的
  `init()` 清理、只写不读的 `FullSyncMeta.etag`（单数；**复数** `etags`/`tailEtag` 才是 304 快筛基线，它们的读取点
  一处未动）、35 处多余 `export` 关键字，以及 `lifecycle` 里零消费者的 `interval` / `clearTimer`
  （`ifCurrent` / `currentGeneration` 反而在审查后**补上了消费者**：`scheduleProbeSync` 的 2s 定时器）。
- **首次安装路径要自己补一次 `hideListsSection()`**（4.9.2 审查补）：`.my-3` CSS-only 兜底删掉后，
  无缓存分支（`!hasApiData()` → 配置横幅，不走 transform）只剩门控 CSS 藏容器，**标题行会露出来**，
  所以 `transformAndReveal` 的 `!hasApiData()` 分支里必须显式调一次。

**D22 · 分页可跳页（4.10.0）**

- **入口**：分页器中间的 `N / M` 由静态 `span` 改为 `<button type="button" class="btn BtnGroup-item gsm-page-info">`
  （可聚焦、可被读屏描述）。点击 → **同一单元格内原位**换成 `<input class="btn BtnGroup-item gsm-page-input">`，
  提交/Esc/失焦后换回按钮。**不做浮层**：顶部那份是 `cloneNode(true)` 克隆件，`popovertarget` /
  `anchored-position` 需要 document 级唯一 id 与锚点，克隆会把 id 一起复制；而 Popover API 属 Baseline 2024
  （Safari 17+），超出本脚本 `cssTarget=safari15` 的目标面。
- **交互一律走 `pagination.ts` 的 window-capture 委托**（`closest('button.gsm-page-info')`）。
  **禁止**改成往分页器节点挂监听：`cloneNode` **不复制事件监听**，顶部那份会失效。输入框本身是**瞬态**节点，
  监听随它一起销毁 ⇒ 不需要 `lifecycle` 作用域、也不留需要回滚的痕迹。
- **唯一提交口径** `navigateToLocalPage(raw: unknown)`：`Number.isFinite` 守卫 → 夹取 `[1, totalPages]` →
  同页早退 → `renderBrowsePage`。prev/next 与新输入态**都只调它**，不得各写一份校验
  （`renderBrowsePage` 自己对 `NaN` 没有守卫，远端 `?page=N` 越界又是**静默返回空结果**，所以越界只能本地兜）。
- 输入框用 `type="text"` + `inputmode="numeric"` + `pattern="[0-9]*"` + `enterkeyhint="go"`；
  **不要用 `type="number"`**（隐式角色 `spinbutton`、方向键会意外改值、非法输入无反馈）。
  宽度与字体度量**不用固定值** —— JS 在进入编辑态时按被顶替按钮的实测几何写内联值
  （固定 `3.5em` 实测会宽出 21px、整条分页器横向跳动）。进出编辑态整条分页器不重排。
- **`updateLocalPagers()` 不为输入态加跳过门**（4.10.0 发布前审查推翻首版措辞）：进入编辑态是把页码按钮
  `replaceWith` 成 input，那份 `.gsm-page-info` 查不到、文字写入天然是空操作；而 prev/next 的禁用态
  **必须**照常更新 —— 曾「整份跳过」，结果编辑期间发生一次渲染就会让分页器与真实页码脱节。
- **失焦提交必须延后一拍**（4.10.0 发布前审查抓到的 P0）：`renderBrowsePage` 会 `remove()` 底部那份
  分页器再 `appendChild` 插回，而「摘掉含焦点的子树」本身就触发 `blur`；同步提交会在渲染**内部**嵌套
  再调一次 `renderBrowsePage`，外层接着用它早算好的 `start` 覆盖网格 ⇒ 页码文字与网格内容各说各话。
  故 `blur` → `queueMicrotask` → 判 `input.isConnected`：仍在文档里 = 真失焦 → 提交；已被摘掉 = 外层渲染
  接管 → 作废。**不要**改回同步提交，也不要为此给 `renderBrowsePage` 加重入守卫（守卫只会让嵌套那次
  被丢弃、外层照样覆盖，问题依旧）。
- `finish()` 还原单元格时按**当前**页码重写文字（编辑期间可能已渲染过），并 `cell.focus({preventScroll:true})`
  把焦点还给按钮 —— 不还焦点 = 键盘用户被丢回页面开头。
- 非法/越界**静默**处理，不弹提示、不发请求。字符串路径允许**前导负号**（`-1` 属越界 → 第 1 页）；
  数字守卫只否 `NaN`（超长数字串折成 `±Infinity` 属越界 → 夹到边界，不是「不跳」）；IME 组成中的
  `Enter` 不提交（`ev.isComposing` 直接返回）。

**D23 · 同步状态只有一个真相，头部按钮是它唯一的视图（4.10.0）**

- **口径：入口多处、状态一处、视图一处。** `runFullSync()` 签名与五个调用点保持不变；它只推进
  `fullSync.ts` 内的 `SyncState`（idle / running / failed+reason）并在**开始**与 **finally** 各广播一次
  （`subscribeSyncState`）。`mountSyncButton` 订阅它，**任何入口**触发的同步都让同一个按钮显示出来。
- **按钮 DOM 形状与文字恒定**：只切 `aria-busy` / `aria-disabled` / `title`（外加错误态配色 class），
  不换图标节点、不换文字、不加 `disabled` 属性。理由有两层：Primer `ButtonBase` 的源码注释明确记载
  「切 loading 前后若 DOM 不同形，按钮会丢焦点」；且用户 2026-10-02 明确要求**只让 ICON 转**，
  而不是「整个按钮变成刷新态」。
- 旋转由 `.gsm-sync-btn[aria-busy='true'] .octicon-sync` 驱动（作用在 `<svg>` 上，抄 Primer `.anim-rotate`），
  包在 `@media (prefers-reduced-motion: no-preference)` 里；**禁止用 SVG SMIL** —— Primer PR #1251 记录
  无限 SMIL 会让后台标签回前台时冻结数秒以上（与本脚本既有的后台标签冻结观察同源）。
- **挂载即对齐**：`mountSyncButton` 建完按钮先 `renderSyncButton(getSyncState())` 再订阅 ——
  Token 保存路径下网格（连同按钮）是在同步**之后**才建的（`index.ts` 的 `setTokenSavedHandler`）。
- **状态 API 只给模块内用**（4.10.0 发布前审查）：`getSyncState` / `subscribeSyncState` / `SyncState` 等
  都不 `export`（唯一消费者是同文件的 `mountSyncButton`；`viewTeardown` 只拿 `unmountSyncButton`），
  与 D21「删多余 export」同口径。`getSyncState()` 返回**浅拷贝** —— 调用方就地改写不得绕过 `setSyncState` 的广播。
- **订阅必须显式注销**：`unmountSyncButton()` 由 `viewTeardown` 第 2 项调用。**禁止**用 `isConnected` 兜底 ——
  跨断点往返每轮都会在订阅集合里留一个指向游离按钮的闭包。
- **失败与被丢弃都要有痕迹**：失败 → `failed` 态（title 常驻「上次同步失败：<分类文案>（点此重试）」+ 红字 20s
  后自动褪去，文案复用既有失败分类，不新造）；**被并发丢弃不广播 failed**（那会把正在转的按钮停下、谎报失败），
  它由 running 态本身 + 一条说明为何忽略的 console 日志承载。旧代码在 `catch` 里只写 console，失败对用户不可见。
- 加载态另有视觉隐藏的 `aria-live` 播报区 `.gsm-sync-status`（**惰性创建**，文案只在进行中渲染，
  `viewTeardown` 第 2 项一并删除）—— 这是「回滚按痕迹」清单里唯一为本次新增的选择器。
- **证据来源（联网调研，含 URL）**：`docs/research-pager-jump-a11y-spinner.md` —— 要点：GitHub 自身**没有**
  跳页输入（线上页面 `<input>` 计数 0、Primer `Pagination` 无跳页入参）；`?page=N` 越界在 GitHub 侧**静默返回空结果**；
  `type="number"` 的 a11y 缺陷；Primer `ButtonBase` 的 loading 范式（保留文字、只换 visual、`aria-disabled`、
  隐藏 live region，注释明说「DOM 不同形会丢焦点」）；Primer PR #1251 的 SMIL 冻结 bug；
  `.anim-rotate` 与 `prefers-reduced-motion` 在 Primer 自身的实现分歧。

**D24 · 窄视口下通知不再被懒重建（4.10.0）**

- 门开在 `ui/notifications.ts` 的 **`ensureContainer()`**（所有通知唯一的容器入口，返回 `HTMLElement | null`），
  `pushNotice` 在拿到 `null` 时返回**空句柄**（`NOOP_NOTICE_HANDLE`）并留一条 console。
- 背景：容器是**懒重建**的，窄视口下哪怕只从 TM 菜单触发一次同步，也会把整座 `gsm-notify-stack` 建回来，
  与「窄视口完全惰性」正面冲突（原「已知风险」第 10 条的剩余一半）。
- 与 D18 的关系：新增任何**异步通知路径**时不必各自加视口门 —— 只要经过 `pushNotice` 就被拦住；
  但**绕过 `pushNotice` 直接建节点**的路径仍然会破这条约束。
---

## dev 模式必须知道的四件事

1. **dev 下 GM API 不可见**：dev 代码经动态 `import()` 跑在 `unsafeWindow` 作用域，该作用域没有 GM_api
   （[vite-plugin-monkey#35](https://github.com/lisonge/vite-plugin-monkey/issues/35)）。已用 `server.mountGmApi: true`
   解决（仅 dev 生效，产物不变）。
2. **GitHub CSP 拦 dev loader**：`script-src` 白名单不含 `127.0.0.1`，dev loader 的动态 import 必被拒
   （`Failed to fetch dynamically imported module`），插件绕不过去。需装 CSP 放行扩展（只放 `github.com`）+
   允许 Local Network Access 弹窗。详见 `DEVELOPER.md` §2。
3. **两个脚本不能同时启用**：`transformStarsList()` 见到 `.stars-grid-container` 就早退，正式版先跑会让 dev 版
   「改了没反应」。开发时在 Tampermonkey 里禁用正式版。
4. **改过脚本头（`@version` 最常触发）后必须重新安装 dev loader** —— 否则 TM 菜单会整体消失。
   机制：`mountGmApi` 靠一个**由脚本头注释算出的 key**（`md5(头注释).base64url[0:16]`）在 sandbox 与页面域之间
   传窗口；TM 里存的 loader 是安装那一刻的头，改头就换 key，两边对不上 → `gm.api.js` 读不到窗口直接 return
   → 页面域**一个 `GM_*` 都没有**。表现是「TM 菜单空了」**且**「同步说未配置 token」（PAT 按安全设计不写
   localStorage 镜像，GM 一缺席就必然读不到）。
   修：重开 <http://127.0.0.1:5173/__vite-plugin-monkey.install.user.js> 让 TM 更新（同名同 namespace → 原地更新，
   不会变成两个脚本）。**正式版不受影响**（它不走 loader/mountGmApi 那套）。`gm.ts` 的 `warnMissingGmApi()`
   会识别这种情况并在控制台直接给出该 URL。

---

## 真机调试要点

- **必须前台标签页**：Chrome 冻结后台标签后测量/交互/定时器全部失真（后台定时器被节流到 1 次/分钟）。
  CDP 受信任点击对后台标签**静默失效**，先 `Page.bringToFront`。
- **注入 dist 的工装坑**：`atob()` 直 `eval` 会把 bundle 内 UTF-8 字面量按 Latin-1 拆成乱码 —— 必须
  `Uint8Array.from(atob(...), c => c.charCodeAt(0))` + `TextDecoder('utf-8')` 解码后再 eval。
- **幂等早退**：改 transform 逻辑前先 `Page.reload()`，否则 `.stars-grid-container` 幂等检查会提前返回。
- **清数据**：GM_setValue 与 localStorage 镜像**双清**（`gmGet` 迁移路径会自愈单边清理，只清一边看不出问题）。
- **通知栈相关**：`gsm-notify-stack` 的悬停会**暂停整区倒计时**（真实 `mouseenter` 监听，可用来冻住条目做截图/量测）；位置随 header 底边走，量测前先确认 `scrollY` 与 `visibilityState`。
- **别用 `setInterval` 给通知补种测试数据**：页面会持续弹出，看上去就像「脚本自己在反复弹通知」——
  2026-10-02 真踩过并把夹具误当成真实产出报给用户。夹具只推一次；要用循环补种就必须在同一个脚本里
  把 `clearInterval` 与容器清理一起做完，且**不得**把它当作「样式/行为已生效」的视觉证据。
- **验证内部函数**：`.diag/gen-notify-test.cjs` 的做法可复用 —— 复制 dist、把 `init();` 注释掉（避免真实行为干扰）、
  在 IIFE 收尾前 `window.__gsmTest = { pushNotice }`，UTF-8 安全解码后注入。用完 `location.reload()` 清场。
- **读 `computedStyle` 前要等过渡结束**：按钮上挂着 `80ms` 的 transition，同步读取会拿到**起点值**，
  极易误判成「hover 监听没生效」。等 ~250ms 再读（实测 rest→hover→active→hover→rest 五态可完整复现）。
- **`visibilityState` 会自己掉回 hidden**：`Page.bringToFront` 之后页面可能又变 hidden（rAF/scroll/定时器全停）。
  可靠写法是 `{"method":"Page.bringToFront","params":{},"allowFocus":true}`，并在每次量测前回读 `document.visibilityState`。
- **恢复被覆盖的 `console.log`**：注入工装若改过它，用 `iframe.contentWindow.console.log` 取原生实现再赋回
  （`delete console.log` 会把 `console` 打残）。
- **仿真页工装的两个坑**（4.9.2 审查轮踩到）：① 构造 URL **必须带 `?tab=stars`**，否则 `isStarsPage()` 为假、
  脚本根本不转换，`grid: 0` 会被**误读成「窄视口全绿」**；② 把 bundle 内联进 `tests/smoke/fixture.html` 时，
  `html.replace(needle, text)` 要写成**函数形式** —— `html.replace(needle, () => text)`；产物里有 `$&` 字面量
  （`escapeRegExp` 的替换模板），字符串替换会把它当反向引用展开、把 bundle 改坏。

```bash
# 真机注入（.diag/ 已在 .gitignore）
agent-browser-cli exec --tab <tabId> --file .diag/run-xxx.js
```

---

## DOM 变更对照（GitHub 2026 改版，改选择器前先看）

| 位置 | 旧 | 新 |
|---|---|---|
| stars 列表项 | `col-12…py-4.border-bottom` | `…tmp-py-4.border-bottom.color-border-muted` |
| repoId | `data-toggle-for` / `details-user-list-<id>` | `user-list-menu[data-repository-id]` |
| 原生筛选栏 | `.TableObject.border-bottom` + `mt-5` | flex 行 + `tmp-mt-5`，锚点 `#stars-language-filter-menu-button` |
| 详情页 | `.BorderGrid` / `#repo-stars-counter-star` / `.starred form[action$="/unstar"]` | React + CSS-module；star 按钮 `button[data-testid="star-button"]`，状态在 `aria-label`（4.9.0 起脚本**完全不碰详情页** —— 监听与读取器都已删，决策 D17） |
| 搜索框 | `input[name=q]`、`form[action$="tab=stars"]` | **未变**，原拦截逻辑仍有效 |
| Lists 标题行 | `.my-3…` + 内联隐藏即可 | `tmp-my-3…`，且 `.d-flex` 的 `!important` 压过内联 `display:none`，必须 `element.style.setProperty('display','none','important')` |
| 网页写端点表单 | `form[action$="/star"\|"/unstar"]`（后缀选择器） | 只能用**精确**匹配 `form[action="/{o}/{r}/star"]` —— `action$="/star"` 会被 `/unstar` 命中 |

---

## 已知风险 / 待确认

1. **dev HMR 需浏览器放行 CSP**（见上「dev 模式三件事」第 2 条）。
2. **经典 token + 私有仓库**：无 `repo` scope 时同步可能把私有仓库误判 unstar（见 D3，已知局限）。
3. **`GitHub-Verified-Fetch: true` 是玻璃地板**：无文档、无契约（公开来源仅 2 次观测），GitHub 随时可收紧。
   已从 `starWrites.ts` 删除（实测该页纯客户端渲染、0 个 `<form>`），**降级只剩两段**：页面有该仓库表单 → 真实 token；否则仅 VF；都失败即报错。此条风险因此不做缓解，只作观察项：若批量下开始返回 422，说明 GitHub 收紧了 VF 地板。
4. **网页通道的成功判定在网格/离页场景无法复核方向**（页面上没有该仓库表单），只能以 HTTP 200 为准 —— 已知弱点。
5. **TM 菜单标签不跨标签页同步**。（原「窄视口下 frame-render 分支的 `hideListsSection()` 无 `isDesktop()` 门」已在 4.9.2 修掉，见 D18。）
6. **一键批量恢复会代发请求**，技术上落在 AUP §4「automated starring / large volume in a short period」的邻域；
   用户 2026-10-01 知情后要求实现。缓解：严格串行 ≥1s、进度可见、可取消、不自动重试、确认弹窗显示条数与预估耗时。
   同样地，「写通道不向用户披露」与 RDA §4(v) 的披露要求存在偏差，两者都记在 `docs/adr/0006`。
7. **通知栈无条数上限 + 现在压在内容区上方**：一次同步若检出多条外部取关，会各弹一条（ADR 0003 刻意不设上限、
   不判重）→ 通知可能成列盖住列表右上半屏。缓解只有 3s 自动消失与关闭按钮；若用户反馈碍事，可考虑「同类合并计数」。
8. **通知栈兜底值是浅色硬编码**：正常走 GitHub 的 `--bgColor-*-muted` 等变量（自动适配 dark/dimmed），
   但变量一旦被 GitHub 移除就回落到浅色兜底值 → 暗色主题下会变刺眼（低风险，仅影响兜底路径）。
9. **老版 Tampermonkey（< 5.0）下「隐藏 Lists」菜单项会累积重复**（4.9.2 审查发现，**既有行为非新引入**）：
   旧版忽略 `GM_registerMenuCommand` 的 `{ id }` 却仍返回 id，于是每次切换都新建一条菜单项。功能不受影响，
   只是菜单条数变长；重进页面即恢复单条。VM 2.15.9+ 与 TM 5.0+ 行为正常（见 D21）。
10. ~~通知栈没有「窄视口不弹」的硬保证~~ —— **4.10.0 已修**（见 D24）：门开在 `ensureContainer()`，
    窄视口返回 `null`、`pushNotice` 交回空句柄。`scheduleProbeSync` 的 2s 定时器仍另有世代号 + 视口复判
    （见 D18）。残留约束：**绕过 `pushNotice` 直接建节点的路径**不受这道门保护。
11. **底部那份分页器提交后焦点仍会掉到 `BODY`**（4.10.0 审查发现，**有意留下**）：`renderBrowsePage` 会
    `remove()` 底部 pager 再插回，落在里面的焦点无法存活。标题行那份（顶部，也是本功能的入口）不经过
    这条路径，焦点能正常回到按钮。要彻底修就得让 `renderBrowsePage` 也管焦点，代价大于收益。
12. **`.gsm-sync-btn[aria-disabled='true']` 上的 `cursor: progress` 实际不生效**（`pointer-events: none`
    把光标让给了父级）—— 纯装饰，留着不修。

---

## 下一步

1. **@version 已升到 4.10.0 → 若你在用 dev 脚本，必须重装 dev loader**：重开
   <http://127.0.0.1:5173/__vite-plugin-monkey.install.user.js> 让 TM 原地更新，否则 TM 菜单会整体消失
   （机制见「dev 模式必须知道的四件事」第 4 条：`@version` 变了 → 脚本头变了 → mountGmApi 的 key 对不上）。
   正式版不受影响；`@version` 变了却没重装，表现是「TM 菜单空了」+「同步说未配置 token」。
2. **`docs/adr/0006` 剩余两项不可观测项**：`?scopes=repo` 预填是否真的勾上（被 sudo/passkey 门拦住，
   **不得**声称可用或不可用）、`context=user_stars` 服务端是否据其分支（实测 200 但不可知）。
   离页仓库 + 仅 VF 头**已实测成立**（见「当前状态」的实测结论），不必重复验。
3. 后续阶段（详见 `todo` 与 `DEVELOPER.md` §13）：GraphQL 分页调研、周期自动同步、非本人 star 页
   `GET /users/{u}/starred` 接入。（「分页按钮可跳页」已于 4.10.0 完成，见 D22。）
4. 未消化的架构建议：单遍 facet 计算、响应式漏斗（见 `starmgr-arch-review-report.md`）。
5. fine-grained PAT 写他人公开仓库的能力缺口由 GitHub 控制（roadmap#600 NOT_PLANNED、#601 OPEN）——将来若补齐，
   可回头简化 `docs/adr/0006` 的网页端点通道。
6. **4.9.2 的真机验证部分完成**（`pnpm check` + 51 项导入导出断言 + CSS 等价性全过；dist 头部 `@grant` 恰 5 项）。
   **已在真浏览器跑过仿真页**（`.diag/viewport-harness.html` = GitHub 仿真 DOM + 内联 dist + matchMedia 仿真，
   断言脚本 `.diag/assert-viewport.js`；两者都在 gitignore 的 `.diag/` 下，可重跑）：窄视口载入**零痕迹**
   （无自造节点/无 `gsm-*` 类/无内联 display/无标记，Lists 行与原生三个菜单未被动过）；桌面载入网格/顶部翻页器/
   同步按钮/右栏照旧；运行中收窄 → 痕迹全清且 layout 样式表归零（persistent 表按设计常驻，规则全在 `@media` 内）、
   Starred topics 回到原生列、原生菜单 display 复原；再拖回桌面 → 网格重建且无重复节点；收窄后挂机 10s 无新
   `<style>` 注入（世代号生效）；语言色经**原生 fetch** 拿到 694 语言（验证 `GM_xmlhttpRequest` 可删）。

   **审查轮的 5 个修复各自实测**（工装 `.pi/tmp/gen-harness.cjs` → `viewport-harness.html?tab=stars`
   + `.pi/tmp/assert-fixes.js` / `assert-cycle.js`，均在 gitignore 下，可重跑；注意 URL 必须带 `?tab=stars`，
   否则 `isStarsPage()` 为假、脚本根本不转换，会误读成「全绿」）：

   | 修复 | 实测证据 |
   |---|---|
   | R1 搜索监听 | 桌面 `enterPrevented/submitPrevented = true`（拦截有效，无回归）→ 收窄后**双双 false**（原生行为放行）；`data-gsm-search-bound` 计数 0 |
   | R2 2s 自动同步 | `#autoshrink`（700ms 收窄）时间线：收窄前 grid=1（说明确实排过队），此后到 t=6.7s 抓包数**恒为 1**（仅 linguist 色表），无任何 `api.github.com` 请求；审查员修复前实测在同场景有 `2120ms → /user/starred?per_page=100&page=1` |
   | R3 Lists 偏好 | 桌面进 Stars：门控类 true / 标记 2 / 标题行 `display:none` → 触发 `turbo:load` 离开 Stars：门控类**仍 true** / 标记**仍 2**（不再被误清）→ 再收窄：双双清零 |
   | R4 首次安装 | `#nocache`：横幅出现、`listsMarks:2`、标题行 `display:none` 且高度 0（修复前 `flex` / 54px） |
   | 幂等回归 | 桌面→窄→桌面→窄→桌面两轮：`grid/topPager/rightSidebar` 恒为 1、topics 只被搬走一次、搜索拦截每轮都恢复、`__errors` 空 |
   | topics 痕迹标记 | 桌面转换后 `[data-gsm-topics-src]` = 1 → 收窄后 = 0（标记被摘且内容确实回到原生列） |

   **仍需真机确认（只能在真 github.com + TM 上做）**：真·窄窗口下的实际观感、Turbo 导航路径、
   安装页/面板里本脚本的授权清单是否恰为 5 项、导出仍能触发 `GM_download`、TM 菜单项齐全（实测 8 处注册）。
7. **原生 `fetch` 语言色通道有一个新观察项**：它现在受页面 CSP `connect-src` 约束（已实测该主机在白名单内），
  且失败是静默降级（灰圈）。GitHub 若收紧 CSP，表现是语言色全部变灰点 —— 届时把 `gmFetchText` 加回来即可。
8. **4.10.0 的验证（T9，2026-10-02 已跑完）**：静态 = `pnpm check` 绿、`node scripts/verify-css.cjs` EXIT 0、
   `pnpm test:exportimport` 51/0、dist 头部 `@grant` **恰 5 项**、dist 内 `gsm-pager-loading` 0 命中 / 无 SMIL /
   有 `prefers-reduced-motion`。
   **仿真页断言全绿**（工装 `.diag/gen-jump-harness.cjs` → `jump-harness.html` + `assert-jump-{a,b,c,d,e,f,g,h}.js`，
   全部在 gitignore 的 `.diag/` 下，可重跑；**URL 必须带 `?tab=stars`**，否则脚本根本不转换、`grid:0` 会被误读成全绿；
   夹具含 70 个仓库 = 3 页，fetch 用桩、零真实网络）：

   | 断言 | 实测结果 |
   |---|---|
   | 跳页入口 | 点击页码指示器（顶/底两份都测）→ 原位出 `<input>`：已聚焦、已全选、`type=text` + `inputmode=numeric` + `pattern` + `enterkeyhint=go` |
   | 几何不跳动 | 输入框 42×21 vs 按钮 41.9×21、BtnGroup 157.6 vs 157.5 ⇒ 一致（曾用固定 `3.5em` 导致 +21px 横向跳动，已改为按被顶替单元格实测宽度写内联值） |
   | 越界/非法 | `999`→末页 `3 / 3` 且顶底同步；`0`/`-1`→第 1 页；`abc`/空→不跳；**全程 fetch 增量为 0** |
   | 同页不重绘 | 跳当前页后首卡 DOM 引用不变 |
   | Escape / blur | Escape 取消不回退页码；blur 提交生效（与备注编辑同口径） |
   | 编辑态保护 | 输入框开着时经原生搜索 Enter 触发一次真实渲染 → 输入框仍在、值未丢、仍聚焦 |
   | 同步联动（他入口） | 从 **TM 菜单**触发 → 按钮 `aria-busy=true` + `aria-disabled=true` + `.octicon-sync` 动画 `gsm-spin` + live 区「正在同步…」 |
   | 并发丢弃 | 同步中再点按钮 ⇒ **0 个新请求**且仍 busy（不谎报失败） |
   | 失败可见 | 桩网络错 ⇒ busy 清除、`gsm-sync-failed` 上色、title = 「上次同步失败：boom-network（点此重试）」、动画停、live 清空 |
   | a11y 结构 | 同步前/中/后 `outerHTML`（剥属性）**完全一致**、文字恒为 `Sync`、宽度恒 69px |
   | 完整同步 + 简报 | 桩「无变化」整表 ⇒ 通知栈出现「同步完成：无变化（共 70 个 star）」、按钮回 idle 且 title 换成摘要 |
   | 窄视口零残留 | 载入与运行中共测：grid=0、`.gsm-*`/`.stars-*` 节点 0、无 live 区、无通知栈；页面仅有的 3 个内联 `display` 全是夹具自身（无 `data-gsm-hidden`）、2 个 `<style>` 是夹具与 CLI 注入的 |
   | 通知栈视口门 | 窄视口里把一次同步**跑完**（元数据写盘 = 最后一步）⇒ `.gsm-notify-stack` 仍为 0（简报被拦） |
   | 订阅不泄漏 | 收窄回滚后改变状态（running→failed）⇒ **游离按钮的 `aria-busy` 保持 "true"、未染 failed 类**（订阅确已注销） |
   | 挂载即对齐 | 拖回桌面后新按钮立即渲染**当前**状态（running 时 busy+旋转；failed 时上色+title 带原因） |
   | 幂等 | 桌面↔窄视口往返 3 轮：grid/topPager/rightSidebar/syncBtn/infoButtons/topicsMark 恒为 1/1/1/1/2/1，窄侧全 0；往返后跳页与状态驱动仍正常；`__errors` 空 |
   | 动效门 | CDP `Emulation.setEmulatedMedia` 切 `prefers-reduced-motion: reduce` ⇒ 动画 `none`（busy 与文字仍在）；切回 ⇒ `gsm-spin` 1s infinite |

   **发布前独立审查轮**（外部 reviewer，只读复核 + 自建复现实验）抓到 1 P0 / 3 P1 / 7 P2，**P0+P1 已修**，
   P2 修了 5 条（重复注释、陈旧 CSS 注释、无消费者的 `export`、`getSyncState` 可变引用、超长数字串）。
   修复后另跑 **断言 I**（`.diag/assert-jump-i.js`，同一工装，全绿）：

   | 审查项 | 修复后的实测 |
   |---|---|
   | P0 编辑态与内容一致性 | 底部输入框开着 + 触发一次与用户无关的渲染 ⇒ 文字两份都是 `2 / 3` **且**网格首卡 = 第 2 页首卡（修复前：文字 `2 / 3`、内容是第 1 页） |
   | P1 编辑态下 prev/next | 顶部编辑态中渲染把页重置到 1 ⇒ `prev` 带 `disabled`、`next` 可用（此前整份跳过，停在旧禁用态） |
   | P1 焦点归还 | Escape 与 Enter 之后 `document.activeElement` 都是 `BUTTON.gsm-page-info`（修复前是 `BODY`） |
   | P1 `-1` 口径 | 从第 3 页输入 `-1` ⇒ 第 1 页（现已与文档一致） |
   | P2 超长数字 | 400 位 `9` ⇒ 末页 `3 / 3`（修复前「不跳」） |
   | P2 IME | `isComposing: true` 的 Enter ⇒ 输入框仍在、页码未变 |
   | 无回归 | A / B / E / F / G / H 六组旧断言全部复跑通过；`pnpm check` 绿、`verify-css` EXIT 0、51/0、dist `@grant` 恰 5、旧类零命中 |
   **仍需真机确认（只能在真 github.com + TM 上做）**：① 真窗口下点击页码跳页的实际手感（仿真里几何是
   精确对齐的，但字体/缩放的真实观感只能肉眼看）；② TM 安装页/面板里本脚本的授权清单是否恰 5 项
   （dist 头部已核为 5 项，但 TM 的展示需真机确认）；③ 真机 Turbo 导航路径下跳页与同步按钮的观感
   （①②的行为层已由仿真断言覆盖，真机只做观感与安装页核对）。
   **一处刻意的实现收窄**（与方案 T6 的措辞不同）：**被并发丢弃的同步不广播 `failed`**，只留 console ——
   改成 failed 会把正在转的按钮停下、谎报失败（见 D23）。

## 快速构建约定

不跑 `tests/smoke/`（快速构建期），改完只 `pnpm check`，由用户在真实页面判断成功与否。

---

## 常用命令

```bash
pnpm check     # tsc --noEmit + build（改完必跑）
pnpm build     # → dist/github-star-manager.user.js
pnpm dev       # HMR，需先解决上面 CSP 那条；入口 http://127.0.0.1:5173/__vite-plugin-monkey.install.user.js
pnpm build && node scripts/verify-css.cjs   # 产物 CSS 与源 CSS 等价性
pnpm test:exportimport   # 导入导出纯逻辑 51 项断言（无需浏览器）
node scripts/ratelimit-probe.cjs --repo <me/repo>   # 限流实测探针（默认 dry-run，零网络请求）
```

---

## 建议技能

- `agent-browser-cli`：真机 DOM 探查、注入验证、截图、受信任点击。
