# GithubStarManager — Agent Handoff

> 架构 / 模块职责 / 数据流 / 存储模型 / 约束以 **`DEVELOPER.md`** 为准（权威文档，勿在此重复）。
> 本文件只记录：**当前状态、仍生效的设计决策、调试要点、下一步**。
> 历史过程一律查 `git log`（提交信息本身写得很详细），本文件不写「上一轮改了什么」。

---

## 当前状态

版本 **4.9.1**（`package.json` 为单一版本源，`vite.config.ts` 读它写入脚本头）。

> 交接时间：**2026-10-02 17:10 +0800**。

**4.9.1（未提交时的工作树，本次交接一起提交）**：三处通知栈/同步收尾的行为与观感修订，
细节见 `DEVELOPER.md` §「变化简报与恢复」、`docs/adr/0003` 的「位置与观感」条与 D11/D12：

1. **通知栈定位**：从「视口右上角固定 `top:16px`」改为**锚在全局头部下方**（`header-wrapper` 底边 +8px，
   滚动/改窗口 rAF 重算，头部滚出视口后回落视口顶部 8px）。容器仍挂 `document.body`，**不是** header 子节点。
2. **同步后立即重渲染**：删掉「自动来源 + 最近 10s 有交互 → 弹『点击刷新』」整条分支（含交互追踪三监听），
   手动/自动一视同仁直接 `applyFilters({keepPage:true})`（用户裁定）。
3. **观感换成 GitHub `.flash`**（内联消息族）：语义浅色底 + `borderColor-*-muted` 细描边 + 16px 细线 octicon，
   尺度对齐脚本既有卡片/横幅。**不要**回退到 Primer `Toast` 族（48px 满饱和色条 + 三层悬浮投影，与卡片不同族）。

**4.9.0 已实现并提交**，四组改动：

1. **写路径两条通道 + 静默分派**（`docs/adr/0006-web-endpoint-write-fallback.md`，新增）：`src/starWrites.ts`
   的 `setStarState()` 在「classic/OAuth token（`ghp_`/`gho_`）」与「浏览器登录会话走网页端点」之间自动选择。
   `docs/adr/0004` 的「只支持 classic token」因此收窄为「**REST** 写路径只支持 classic token」。
2. **全局串行变异队列**（`docs/adr/0003`，新增 `src/mutationQueue.ts`）：卡片星按钮与恢复共用一个队列，
   相邻请求**开始时刻**差 ≥1000ms，**排队中再次点击 = 撤销排队**。
3. **变化简报 + 恢复**（`docs/adr/0003`，新增 `src/restore.ts` / `src/ui/notifications.ts` / `src/ui/restoreMenu.ts`）：
   同步收尾弹简报（口径 = 取消 star / 新增 / 恢复，元数据刷新只进控制台；无变化也弹；**不判重**），
   每条外部取关各弹一条带「恢复」按钮的通知；TM 菜单「♻️ 恢复已取消的 star（24h 内）」= 可勾选 +
   一键「恢复选中」+ **每行一个 ☆ 恢复 按钮**（用户裁定：必须实现一键恢复）。失败一律 `alert` 一行文字。
4. **导入后不自动同步**（`docs/adr/0005`）+ 删除详情页 star/unstar 监听（决策 D17）+ 配置横幅改为
   **两条 Token 深链 + 差异说明**（用户裁定：classic 与 fine-grained 都给，并说明区别）。

**未执行的一项（非阻塞）**：`scripts/ratelimit-probe.cjs` 是 REST 变异请求限流的实测探针（默认 `--dry-run`
零网络请求），**尚未真机跑过**——队列的 1000ms 间隔目前只有官方 best-practices 与 Octokit 默认值两个外部
来源支持，没有本地实测数据。执行前置与协议见 `DEVELOPER.md` §6「REST 限流实测」与
`docs/research-ratelimit-protocol.md`。结论落 `docs/research-ratelimit-measurement.md`（尚未创建）。

**2026-10-01 真机复核结果**（`docs/research-web-star-endpoints.md` 附录 A，出厂代码路径、双向、含远端 API 复核）：

| 事项 | 结论 |
|---|---|
| 离页仓库 + 仅 VF 头 + 86 字符占位 token | ✅ **成立、双向**：`POST /star` 200 → API 复核 204；`POST /unstar` 200 → 复核 404。基线已复原。 |
| 422 回退的前提 | ❌ **被推翻**：`GET /{o}/{r}` 原始 HTML（200 / 339 KB）**0 个 `<form>`**（纯客户端渲染）⇒ 回退是死码，**已从 `starWrites.ts` 删除**，降级由三段变两段。per-form token 只在**原生 stars 列表页**有（实测 64 表单 = 30 star + 30 unstar，仅覆盖当页仓库），而恢复场景的仓库不在列表里，故不改为 fetch 列表页。 |
| classic 创建页 `?scopes=repo` 预填 | ⚠️ **无法判定**：`settings/tokens/new` 被 sudo 门（"Confirm access" + passkey）拦住，勾选状态不可观测。`description=` 预填**已确认生效**。**不得**声称可用或不可用。 |
| `context=user_stars` 用于 repo 作用域端点 | 不报错（200），但服务端是否据其分支仍不可知 → 继续只作原样携带。 |
| **4.9.0 写路径端到端**（真实触发脚本代码，非手搓请求） | ✅ **通过**：卡片星按钮点击 → 乐观翻转 → 通知栈出现 `已取消 star：…｜撤销` → API 复核 404（远端真取消了）→ 点「撤销」→ 通知原地变 `✓ … 已恢复` → **API 复核 204（零残留）**。目标用自有仓库 + 用户已 star 的三方仓库各一，结束后状态与初始一致。跑的是 dev 服务的**当前源码**；打包产物仅经 `pnpm check`。 |

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
5. **TM 菜单标签不跨标签页同步**；窄视口下 frame-render 分支的 `hideListsSection()` 无 `isDesktop()` 门（既有行为）。
6. **一键批量恢复会代发请求**，技术上落在 AUP §4「automated starring / large volume in a short period」的邻域；
   用户 2026-10-01 知情后要求实现。缓解：严格串行 ≥1s、进度可见、可取消、不自动重试、确认弹窗显示条数与预估耗时。
   同样地，「写通道不向用户披露」与 RDA §4(v) 的披露要求存在偏差，两者都记在 `docs/adr/0006`。
7. **通知栈无条数上限 + 现在压在内容区上方**：一次同步若检出多条外部取关，会各弹一条（ADR 0003 刻意不设上限、
   不判重）→ 通知可能成列盖住列表右上半屏。缓解只有 3s 自动消失与关闭按钮；若用户反馈碍事，可考虑「同类合并计数」。
8. **通知栈兜底值是浅色硬编码**：正常走 GitHub 的 `--bgColor-*-muted` 等变量（自动适配 dark/dimmed），
   但变量一旦被 GitHub 移除就回落到浅色兜底值 → 暗色主题下会变刺眼（低风险，仅影响兜底路径）。

---

## 下一步

1. **@version 已升到 4.9.1 → 若你在用 dev 脚本，必须重装 dev loader**：重开
   <http://127.0.0.1:5173/__vite-plugin-monkey.install.user.js> 让 TM 原地更新，否则 TM 菜单会整体消失
   （机制见「dev 模式必须知道的四件事」第 4 条：`@version` 变了 → 脚本头变了 → mountGmApi 的 key 对不上）。
   正式版不受影响；`@version` 变了却没重装，表现是「TM 菜单空了」+「同步说未配置 token」。
2. **跑限流实测（阶段 A）**：`node scripts/ratelimit-probe.cjs --run --repo <自有仓库>`，产
   `docs/research-ratelimit-measurement.md`。前置（任一不满足就跳过）：自有仓库、classic PAT（scope `repo`）、
   能关闭脚本自动同步、出口非共享/VPN（走 VPN 只做 L1）。结论只作验证与文档，**不自动改 1s 默认值**。
3. **`docs/adr/0006` 剩余两项不可观测项**：`?scopes=repo` 预填是否真的勾上（被 sudo/passkey 门拦住，
   **不得**声称可用或不可用）、`context=user_stars` 服务端是否据其分支（实测 200 但不可知）。
   离页仓库 + 仅 VF 头**已实测成立**（见「当前状态」表），不必重复验。
4. 后续阶段（详见 `todo` 与 `DEVELOPER.md` §13）：GraphQL 分页调研、周期自动同步、非本人 star 页
   `GET /users/{u}/starred` 接入、分页按钮可跳页。
5. 未消化的架构建议：单遍 facet 计算、响应式漏斗（见 `starmgr-arch-review-report.md`）。
6. fine-grained PAT 写他人公开仓库的能力缺口由 GitHub 控制（roadmap#600 NOT_PLANNED、#601 OPEN）——将来若补齐，
   可回头简化 `docs/adr/0006` 的网页端点通道。

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
