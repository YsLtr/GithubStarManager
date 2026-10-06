# GithubStarManager — Agent Handoff

> **权威分工（本文件不重复它们的内容）**
> - 架构 / 模块职责 / 数据流 / 存储模型 / 约束 → **`DEVELOPER.md`**
> - 历史过程（每轮改了什么、为什么） → **`git log`**（提交信息写得很详细）
> - 决策全文与依据 → **`docs/adr/0001`–`0011`**；实施计划与逐条验证记录 → **`docs/plans/`**（历史在 `archive/2026/`）
> - 可复用的验证数字 / A/B 反证 / 审查过程 → gbrain `people/me`
>
> 本文件只留四样：**下一轮交接、当前状态、仍生效的硬口径、调试要点与下一步**。

---

## 本轮交接：4.19.0 —— API 目标 ID 优先（D34）

交接时间：**2026-10-06 14:22 +0800**；分支 `master`。用户已授权完成 handoff 并提交本轮全部改动。
仓库写入/恢复/核对统一传数字 ID，名称仅作端点适配；身份与列表仍用 `/user`、`/user/starred`。
实现、边界和证据分别见 `docs/adr/0011-id-first-api-targets.md`、`docs/plans/2026-10-06-id-first-api-targets.md`。

- 三名子代理首轮审查发现的问题均已修复，第二轮交叉复审未发现新增阻断问题：非法 ID 降级、名称恢复落键/冲突、响应体超时、mock 假绿、无效表单方向复核。
- 最终静态/离线验证：`pnpm check`、153 条导入导出测试、33 组 API 回归通过；三种 mock 假绿反证均正确报错。7 组前台夹具来自审查修复前，不冒充最终浏览器复验。
- 实网：classic 公共仓库，以及 **fine-grained + 本方授权私有仓库**，均实际调用源码打包的解析/队列/写入；正确 ID + 故意错误名称可双向操作并恢复原始星标。证据见 `docs/research-api-target-implementation.json`、`docs/research-api-target-finegrained-private.json`。
- **用户已确认所有测试 token 删除（2026-10-06）**。后续不得复用本会话凭证；仓库报告不含 token。重新实网验证需新凭证或已有浏览器会话。
- **下一步**：补真实 Cookie 私有离页及 TM/CSP 验证。本轮浏览器虽已登录 YsLtr，但 focus/bringToFront 后仍为 hidden，按规则停止，未发 Cookie 变异；先用 `agent-browser-cli` 技能确认前台可测环境。
- **保留边界**：元数据读取有 20 秒响应头+正文超时，既有变异请求仍无显式 deadline；名称解析至写入存在竞态，网页只以 HTTP 成功判定。名称键恢复有双次占用检查，数字 ID 恢复沿用既有行为，不宣称所有恢复具有事务保护。D33 归属规则与风险 14 缓存未分区保持原状。

## 前轮：风险 21 —— 标签/备注/宽限期备份跟 **token 账号**走（4.18.0 已完成并过两轮审查）

> 交接时间 **2026-10-06 13:0x +0800**。**4.18.0（风险 21 修复，D33）**已完成：静态 / 夹具回归 + 单测 A/B 反证
> + **两轮独立子代理审查**（code / docs / falsify 各角度，第一轮发现的问题全部修完并复验）。
> 真机部分（错号横幅重弹、跨账号取标签、面板空输入不清 token）仍待用户在自己的账号上确认。

风险 21 已按用户 2026-10-05 口述口径**落地完成**，裁决与落点见 **D33** 与 **`docs/adr/0010`**；
外部事实的取证（含官方原文 + 真机实测）见 **`docs/research-finegrained-getuser.md`**，
复测探针 `scripts/token-identity-probe.cjs`（默认 dry-run）。
仍在生效的前提：**D30（开发阶段 / 无已有用户）** ⇒ 旧键数据不迁移；该前提一旦失效，免迁移结论立刻作废。

**两轮审查的净收益**（教训比修复本身更值钱，都已写进 D33 / ADR 0010 / 已知风险）：
① 分区键改名时**夹具种子没跟着改** ⇒ 三组回归锁「因读空而假绿」，且批量脚本只看 `_errors` ⇒ 报绿
（已修 + 把非空转守卫**折进 `_errors`**，A/B 实测变红）；② `setTokenVerified` 原先**零测试覆盖**
（反转 401 分支可全绿通过）⇒ 新增 `[16]` 锁契约；③ 我在横幅文案里**误删了首句**（classic 分支）；
④ 配置面板空输入**会清掉 token**（相对 HEAD 的行为回归）⇒ 已加护栏。

**下一轮可做的**（都不是本轮的遗留缺陷，而是刻意留下的边界）：
风险 14（`stars_repo_cache` 不按账号分区 ⇒ 网格卡片集合的归属）—— 依据字段已就位（`stars_full_sync_meta.accountId`，
只写不判）；以及 `todo` / `docs/research-index.md`（`DEVELOPER.md` §13 只是这两处的指针）里仍未做的那些 —— GraphQL 分页调研、周期自动同步。

---

## 当前状态

版本 **4.19.0**（`package.json` 是单一版本源，`vite.config.ts` 读它写脚本头）。

- **4.18.0 风险 21 修复（D33）**：标签 / 备注 / 宽限期备份的**归属账号 = token 账号**（`GET /user` 的 `id`，
  按凭证指纹持久化，**保存 token 时**确认：先写身份再落库 token）；取不到身份回退登录者，皆空则拒绝读写。
  宽限期备份由单份全局键改为 **`stars_pending_delete_<归属id>`**。披露**只用既有的归属横幅**（双方身份 + 归属句
  + 任一侧变化即重弹 + 新增 `visibilitychange` 求值点），**不新增任何 UI**。单测 153 条（新增 `[15]`/`[16]`）。
  详见 `docs/adr/0010`。
- **4.17.0 导入导出改版（D32）**：导出包只剩 `tags`/`notes`/`repoNames`；导入按「该仓库在不在 `stars_repo_cache` 里」
  逐仓库分派（**在** ⇒ 活区；**不在** ⇒ 24h 宽限期）；两条去向同一胜负规则（归一化后非空 ⇒ **覆盖**，非并集）；
  无整表缓存时导入**前**自动同步一次。风险 **22 / 23** 均由此消除。
- **4.16.2（D31）**：修掉「本人页 unstar 后标签/备注直接消失」—— 本人页只读显示收窄为**二态** `getOwnPageCardState`，
  判定仍只在 `cardState.ts` 一处。
- **4.16.1（并入 D12）**：`renderBrowsePage` 改「分片建好后一次 `replaceChildren`」，修掉同步重绘把用户弹回页顶。
- **4.14.0（D29）**：他人 stars 页卡片改**逐仓库**可编辑，分派唯一入口 `cardAreas.renderCardTagAndNoteAreas()`。
- **4.13.0（D26）**：他人 star 页 = **零网络**只读网格（投影页面已渲染的原生条目，不拉取）。
- **4.12.0**：他人页只读装饰 + 存储命名空间改用登录者（D26/D27）。**4.11.0**：Token 归属校验 + 警告横幅（D25）。
  **4.10.0**：分页可跳页 + 同步按钮联动（D22/D23）。**4.9.2**：窄视口完全惰性 + 按痕迹回滚（D18–D21）。
  **4.9.0/4.9.1**：写队列与静默分派、通知栈（D3/D10–D12）。更早细节查 `git log`。
- 限流实测已完成（结论 **D1**：primary 按请求数计，本脚本写入 = 1 点/请求，距文档化的余量 15×）
  —— **不据此改 1000ms 默认值**。证据 `docs/research-ratelimit-measurement.md`。
- 网页写端点通道已实测（双向成立、基线可复原；「422 → 取仓库页表单 token」那段前提被推翻、已删，降级只剩两段）
  —— 证据 `docs/research-web-star-endpoints.md` 附录 A。

---

## 仍生效的硬口径（全文见 `docs/adr/` 与 `DEVELOPER.md`；编号**不连续**，D13–D17 无定义，新增决策从 D22 起编）

- **D3 · 写路径凭证**：REST 只支持 classic PAT（fine-grained 对「不属于本人、也不属于本人组织的」公开仓库 `403`）。
  拿不到 classic 时走**网页端点通道** —— 这是 fine-grained 用户唯一的写能力。两条通道由 `setStarState()` **静默分派**、
  **不向用户披露**，但**静默 ≠ 静默失败**，任何失败都必须报错。scope 取 **`repo`**（`public_repo` 会漏私有仓库进缓存
  而被整表 diff 误判取关）。读路径不受限，403 提示**不得**再让用户「检查 Starring 权限」。
- **D5 · 搜索**：自由文本只搜 作者 / 仓库名 / 描述 / 标签 / 备注；**语言不参与全文匹配**（只走下拉筛选）。
- **D6/D7 · 同步与数据权威**：有完整缓存（`hasApiData()` = 有 `lastFullSyncAt` 且 `count > 0`，**与有没有 token 无关**）
  ⇒ 网格主模式；无 ⇒ 原生页 + 配置横幅。**远端权威** = star 成员关系 / 时间 / 仓库元数据；**本地权威** = 标签 / 备注
  （同步绝不写 tags/notes）。**完整性红线**：分页中断 / 解析失败 / 超 200 页 / 速率余量不足 ⇒ 整表放弃、不改任何数据。
  单遍条件扫描（全 304 免额度早退；304 页用本地缓存切片复原）。**恢复必须打远端**（只本地回滚会制造「本地有星、远端无星」）。
- **D8 · 同步入口**：TM 菜单「🔄 立即全量同步」与标题行 Sync 按钮两个等价入口；界面与菜单**不出现** P2.5/P4/核对
  等开发阶段表述（仅控制台与注释保留）。GitHub **没有**创建 PAT 的 API，快捷获取永久只能靠预填 URL 深链。
- **D9 · 导入导出**：导出包只含本地权威数据（标签/备注）+ `repoNames`；**不含** token / ETag 基线 / 宽限期备份 /
  展示性仓库元数据（4.17.0 起移除）。导入逐仓库分派（见 D32），条数口径别写死。下载**只用 `GM_download`**
  （Blob + `<a download>` 能绕过 TM 扩展名白名单，已否决）。分层铁律：`storage/exportImport.ts` 是**纯逻辑**
  （不碰 DOM、不弹框、不触发同步），交互全在 `ui/exportImportMenu.ts`。
- **D10 · 变异请求节流与队列**：**串行是硬要求、1s 是建议间隔**；卡片星按钮与恢复**共用同一队列**。点击 → 乐观翻转 → 入队；
  **排队中再点 = 撤销**；`.then` 里**必须做 handle 身份校验**；**不自动重试**；失败分类文案**不暴露通道**。
- **D11 · 通知栈**：容器常挂 `document.body`（`header-wrapper` 只当几何锚点，头部出视口后夹回顶部 8px）；
  重算走 `scroll`(capture) / `resize` / `visibilitychange` + rAF。观感 = GitHub 自己的 `.flash` 族
  （**不要**用 Primer `Toast`；`--shadow-floating-legacy` 等变量在 github.com 未定义）。**DOM 顺序铁律**：
  动作按钮必须在 `box.append(icon, label)` **之后**追加。
- **D12 · 同步后立即重渲染**：`changed > 0`（增删或可见元数据更新）且在网格 ⇒ 直接 `applyFilters({keepPage: true})`，
  手动与自动一视同仁、不问「是否刷新」。**重绘期间网格不得出现空态**：`renderBrowsePage` 是**唯一**拆建点，
  必须**分片建好再一次 `replaceChildren`**（清空那一刻网格为空 ⇒ 整页只剩一屏高 ⇒ 浏览器把 `scrollY` 夹到 0，
  而重建不会还回来）。刻意**不**用「保存并还原 `scrollY`」代替。**D12 只适用于本方自己的 stars 页**
  （他人页被只读门挡住，属净收益）。
- **D18 · 窄视口（<768px）完全惰性**：语义 = 「脚本没装过」（不注入样式、不建节点、不改 DOM、不弹 UI、不发进页自动同步）。
  CSS 会自动失效、**JS 不会** ⇒ 门必须开在注入之前（`transformAndReveal()` 首行）；**挂在原生节点上的监听也是写入**，
  必须由 `lifecycle` 作用域持有、teardown 解绑（禁止用 data 标记串代替）。判据以 `grep -rn 'isDesktop()' src/` 为准。
  窄视口不显示配置横幅、不发进页自动同步；**TM 菜单项在任何视口都注册**。
- **D19 · 断点单一真相**：判定**只用** `window.matchMedia('(min-width: 768px)')`（`utils.isDesktop()`），
  **禁止** `window.innerWidth`（WebKit 的媒体查询宽度 = `clientWidth`）。跨断点实时双向切换（150ms debounce），
  不要退回「只在导航时判定」或 reload。
- **D20 · 回滚 = 按痕迹 + 世代号**：`src/viewTeardown.ts` 是唯一回滚点、幂等。只认脚本自有 class（`gsm-*` / `stars-*`）
  与两类 `data-gsm-*` 标记；**凡把原生节点设成 `display:none`，必须同时打 `GSM_HIDDEN_ATTR`**。`lifecycle` 的世代号
  让过期回调自我作废（没有它，回滚会被自己排的队撤销）。**回滚边界**：「隐藏 Lists」属**页面级**偏好，
  离开 Stars 去别的 profile 标签时必须原样保留，只在窄视口清干净。
- **D21 · 清理判据与 GM 权限最小化**：没有实测/文档证明救回过场景的兜底就删（原地留一句「曾用过什么」）。
  **`@grant` 只剩 5 项**：`GM_getValue` / `GM_setValue` / `GM_registerMenuCommand` / `GM_openInTab` / `GM_download`
  —— TM 的能力徽标按**声明的 `@grant`** 生成，不做调用分析，要真变短就得删授权。首次安装路径要自己补一次
  `hideListsSection()`。
- **D22 · 分页可跳页**：`N / M` 由 `span` 改为 `<button>`，点击后**同一单元格内原位**换 `<input>`
  （**不做浮层**：顶部那份是 `cloneNode(true)` 克隆件，Popover API 超出 `cssTarget=safari15`）。交互一律走
  `pagination.ts` 的 **window-capture 委托**（`cloneNode` **不复制事件监听**）。唯一提交口径 `navigateToLocalPage()`；
  输入用 `type="text"` + `inputmode="numeric"`（**不要** `type="number"`）；宽度按被顶替按钮实测几何写内联值。
  **失焦提交必须延后一拍**（`queueMicrotask` + 判 `input.isConnected`），否则嵌套渲染会让页码与网格各说各话。
  非法/越界**静默**处理。
- **D23 · 同步状态只有一个真相**：入口多处、状态一处（`fullSync.ts` 的 `SyncState`）、视图一处（`mountSyncButton` 订阅）。
  **按钮 DOM 形状与文字恒定**，只切 `aria-busy`/`aria-disabled`/`title`（换 DOM 形状会丢焦点）；旋转只作用于 `<svg>`
  （禁止 SVG SMIL —— 后台标签回前台会冻结数秒）。「挂载即对齐」：建完先 `renderSyncButton(getSyncState())` 再订阅；
  订阅必须显式注销。**失败要有痕迹**；**被并发丢弃不广播 failed**（只留 console）。
- **D24 · 窄视口通知**：门开在 `notifications.ensureContainer()`（返回 `null` 时 `pushNotice` 交回空句柄）。
  残留约束：**绕过 `pushNotice` 直接建节点的路径**不受这道门保护。
- **D25 · Token 归属校验**：比对键 = **数字 ID**（页面 `octolytics-actor-id`（**登录者**）vs `GET /user` 的 `id`；
  **不取** `octolytics-dimension-user_id` = 页面主人，那会让每个他人 stars 页假阳性）。只在「有 token + 有登录会话 +
  两侧 id 都取到」时判定；其余（含请求失败）一律 `unknown` —— 既不冒充相符也不误报不符。**只告警不阻断**。
  UI = `div.gsm-account-banner`（**不复用** `.gsm-setup-banner` 类名 —— 那个类名有 4 条撤除路径）。
  求值点（Token 保存成功 / 桌面转换成功出口 / **Token 清空**（4.11.0 第二轮加入）/ `runFullSync` 的 finally，
  **4.18.0 起再加 `visibilitychange`** —— 详见 D33），全部 fire-and-forget，不得进同步关键路径；
  **异步返回后必须复判世代 + 视口**。`hasToken` 区分「确定没配」与「取不到身份」，后者不得抹掉已显示的警告。
  文案按写通道分叉，但 classic 分支**不得**做确定性断言（REST 403 会回落网页端点）。
  横幅上**不放**深链按钮（用户裁定）—— 配置面板里两类深链与粘贴行都已并排给出，一步就能拿到全部出路；
  同理 4.11.1 删掉了配置横幅里那个永远无效的「立即同步」按钮。净口径：**配置横幅只引导配置，归属横幅只引导去配置**。
- **D26 · 他人的 star 页 = 零网络只读网格**：数据只来自页面**已渲染**原生条目的一次投影（`src/domRepos.ts`），
  不调 API、不预取、不做条件请求。**必须**同时 `setLangColorFetchEnabled(false)` —— 卡片渲染里的 `getLangColor()`
  在色表未命中时会**间接**发 linguist 请求，否则零网络断言必挂。只藏原生条目（`hideNativeNode`，**必须带 `!important`**：
  `.d-block{display:block!important}` 会压过不带 important 的内联 `display:none`）；原生分页器与筛选栏**一律不动**。
  **布局接管只认 `gsm-stars-layout` 标记**（登出页有两个 `.Layout`，按骨架类选会改写页头）；**尺寸规则认标记、
  过渡规则不认**（别为「一致性」统一 —— 过渡认标记会让退出时尺寸瞬跳）。搬 topics 必须 `closest` 找内容布局、
  隐藏原生列绑在 `[data-gsm-topics-src]` 上（「搬走了才藏」）。**`viewContext` 是模块态**（Turbo 换 DOM 冲不掉）⇒
  回自己页必须 `exitOtherStarsViewIfActive()` 复位。他人页不挂 Sync 按钮、不显示两类横幅；TM 菜单照常。
- **D27 · 隔离账号 = 登录者**（**已被 D33 改写**，仅作历史）：4.12.0–4.17.x 存储键用 `getStorageUserId()`
  = `octolytics-actor-id`。取不到身份时读空表、写 no-op + console warn，不回落无隔离旧键 —— 这两条护栏
  **在 D33 下继续有效**，只是判据换成了归属账号。
- **D29 · 他人页标签/备注逐仓库可编辑**：三态（`editable` / `locked-pending` / `locked-empty`）判定**只在** `src/cardState.ts`；
  可编辑性**只认「已提交」状态**（内存覆盖表 → 本人整表缓存），不读按钮 DOM、不读在途请求；未 star 但仍在 24h 宽限期的卡片
  **只读，但仍显示**标签与备注（数据来自备份，活区已被清空 ⇒ 渲染器**接受调用方传入的数据**）。
  **唯一分派入口** `src/cardAreas.ts` 的 `renderCardTagAndNoteAreas(card, view, viewerCache)` ——
  **禁止**再出现第二处 `readOnly ? A : B`（那两处判据不一致**就是**这个缺陷）。前置条件 = `hasApiData() && getViewerId()`，
  缺则全部只读（**宁缺勿假**）。`ui/notes.ts` 的 `disposeNotesEditor()` 在分派点上必须先摘（容器复用，
  `innerHTML = ''` 摘不掉备注监听 ⇒ 只读卡片点一下仍能弹编辑器并写盘）。他人页点标签**不**切筛选（`filterToggle: false`）。
  只读卡片**不渲染任何编辑控件**、不加 `aria-readonly`/`inert`、不做主动播报。
- **D30 · 版本迁移代码已整批删除**：前提 = **开发阶段 / 不存在任何已有用户**（用户 2026-10-04 裁定）。
  in-scope = 其**唯一存在理由**是「更早构建可能留下旧形态数据」的代码；**out-of-scope**：环境兼容（GM 缺席↔可用）、
  GitHub 页面代际兼容、本页会话 DOM 回滚、活功能与缓存。迁移专用删除判据（四条，见 D30）——缺测试覆盖的删除
  **必须在原地留墓碑注释 + 在本文件记账**。**刻意保留**：`gm.ts` 的 localStorage → GM 回写（服务**环境转移**，
  删它会造出静默丢数据的链）、`SENSITIVE_KEYS` 的永久拒镜像半。
- **D31 · 本人页只读显示 = 二态**：`getOwnPageCardState(repoId)`（他人页仍是三态）；`readCardDisplayData(repoId, state, now)`
  **接受已算好的 state**、只负责取数（活区优先；活区为空**且** state 为 `locked-*` 才读备份）。本人页不引入 `locked-empty`：
  那一支要依赖**无官方契约**的页面 meta，失效代价是整页失去编辑能力，而「没 star 却有标签」的卡片从不进入网格。
  `editable` 时活区为空**不许**读备份。`data-gsm-card-state` **两态都写、两个视图都写**（`base.css` 的 `cursor: default` 靠它）。
- **D32 · 导入导出改版**：导出**去掉** `data.repoCache`（旧包照旧校验、内容**一律忽略**；`EXPORT_SCHEMA_VERSION` 仍为 1）。
  导入按 **`stars_repo_cache` 的成员关系**逐仓库分派 —— ⚠️ **判据不许再带上 `hasApiData()`**（首版这么写，
  审查员最小复现跑出并存态与数据丢失）。胜负规则两条去向相同：**归一化后非空 ⇒ 覆盖；为空 / 缺省 ⇒ 保留**
  （标签与备注；**`name` 相反 —— 已有名字优先**）。**归一化在分派之前只做一次**（标签 `dedupe` + 剔空白项；
  **单条标签文本本身不 trim**）。`addPendingFromImport()` **不重置** `unstarredAt`、**超期条目按「不存在」处理**。
  无整表缓存时由 **UI 层**先同步一次（纯逻辑层**不触发同步** —— D9 分层铁律；同步失败不阻断导入，提示**写死** 24h 窗口）。
  导入**不再往 `stars_repo_cache` 写任何条目** ⇒ 风险 22 的触发前提不复存在。`repoNames` 是「恢复」这个写请求的
  名称提示（4.19.0 起由 D34 改写其“必需地址”地位）：**查不到就不写**、**绝不写进缓存**、只写宽限期条目的 `name`、**空不覆盖非空**。

- **D33 · 归属账号 = token 账号**（4.18.0，改写 D27；全文 `docs/adr/0010`）：标签 / 备注 / 宽限期备份的隔离账号
  取 **token 账号**（`GET /user` 的 `id`），取不到才回退登录者，两者皆空 ⇒ **读空表 / 写 no-op + console warn**，
  **仍不回落**无隔离旧键。三条不可动的形状：
  ① **身份在保存 token 时确定**：`storage/accountIdentity.ts` 的 `setTokenVerified()` 是 token 的**唯一写入点**，
     顺序钉死「先 `rememberTokenIdentity(token, identity)`（内部即写身份缓存）→ 再 `gmSet(githubPat)`」
     （`[16]` 按 `GM_setValue` 写入顺序断言）；
     401 拒绝保存，网络/5xx/429/**403** **仍保存**（归属回退登录者）—— 不得改成「查不到就拒绝保存」
     （那是把网络抖动变成「token 没存上」）。**该分支的触发面比「保存那一刻」宽**：任何「有 token 但身份缓存无记录」
     的状态都会在该会话首次解析时把归属快照在登录者上（整会话不翻转）—— 组合 B + 身份从未确认时是**永久**窗口
     （只能重新配置一次 token 才自愈）。详见 ADR 0010「已接受」第 3 条。
  ② **宽限期备份必须键分区**（`stars_pending_delete_<归属id>`）：单份全局键的行键就是 repoId，加 `owner` 字段
     只是「有标记地被覆盖」，**不是隔离**。
  ③ **两个面不许混**：数据面判据 = `getStorageUserId()`（归属谁）；成员关系/可编辑性面判据 = `getViewerId()`
     存在性（浏览器里有没有「我」）。**风险 21 就是这两者被当成同一件事的后果**。
  ④ **配置面板的空输入不清除 token**（4.18.0 修，与 TM 菜单**有意不同**）：面板会在 401/403 时自动出现，
     用户误点「保存并同步」不该丢凭证 —— 旧实现（`saveToken('')` → 前缀非法）就是只报错不动存储。
     「留空 = 清除」只在 TM 菜单那条 prompt 文案里写明，清除入口也只该在那条路径上。
  披露**只用既有的 `.gsm-account-banner`**（用户 2026-10-06 裁定**不新增任何 UI**；「网格工具栏常驻归属 chip」
  是被**显著否定**的方案，别再提议）：文案含双方身份 + 归属句、
  按写通道分叉且**不得**断言「读写永远同账号」；关闭态键 `<tokenId>#<sessionId>` ⇒ 任一侧变化即重弹；
  `visibilitychange` 是**第五**个求值点（此前四处见上面那行），**三道门缺一不可**
  （`isDesktop()` + `isStarsListingPage()` + `isReadOnlyScope()` ——
  只写后者等于「任意 GitHub 页回到前台都求值」，因为它对非列表页返回 false）。
  已知代价：关掉横幅后页面上再无归属痕迹；`stars_repo_cache` 仍不分区（风险 14），只落了 `full_sync_meta.accountId`
  作将来依据（**只写不判**）。

---

- **D34 · API 目标 ID 优先**（4.19.0，`docs/adr/0011`）：仓库寻址全链路保留数字 ID；
  `/repositories/{id}` 解析当前全名，ID 404 才可名称查找且必须核验同 ID。星标继续用名称端点（数字候选实测失败）。
  Cookie 路径可用同 ID 原生行 + 精确表单确认目标（包含已隐藏的行）；两种证据都没有则失败，不拿缓存旧名写。
  元数据 404 ≠ 已取关；混合同步全部核对完成再提交，限流/401 整轮放弃；普通权限 403 / 网络失败保留该项，其他已确认项仍可提交。
  key/label 分离、队列等待/执行均按 ID 去重，真实变异起点（含降级）间隔 1000ms。
  解析只在操作执行时做；他人页渲染/窄视口不增加网络。D33 账号分工不变；ID-only 可恢复，repoNames 仍可选。

## dev 模式必须知道的四件事

1. **dev 下 GM API 不可见**：dev 代码经动态 `import()` 跑在 `unsafeWindow` 作用域，该作用域没有 GM_api。已用
   `server.mountGmApi: true` 解决（仅 dev，产物不变）。
2. **GitHub CSP 拦 dev loader**：`script-src` 白名单不含 `127.0.0.1`，需装 CSP 放行扩展 + 允许 Local Network Access 弹窗（见 `DEVELOPER.md` §2）。
3. **两个脚本不能同时启用**：正式版先跑会让 dev 版「改了没反应」。
4. **改过脚本头（`@version` 最常触发）后必须重新安装 dev loader** —— 否则 TM 菜单整体消失。
   机制：`mountGmApi` 靠**由头注释算出的 key**（`md5(头注释).base64url[0:16]`）在两侧传窗口，改头就换 key；
   表现是「TM 菜单空了」**且**「同步说未配置 token」。修：重开
   <http://127.0.0.1:5173/__vite-plugin-monkey.install.user.js> 让 TM 原地更新。**正式版不受影响**；
   `gm.ts` 的 `warnMissingGmApi()` 会在控制台直接给出该 URL。

---

## 真机调试要点（只留最贵的坑）

- **必须前台标签页**：后台标签的测量/交互/定时器全部失真（定时器节流到 1 次/分钟，CDP 受信任点击静默失效）。
  先 `{"method":"Page.bringToFront","params":{},"allowFocus":true}`（`allowFocus` 是 **`method` 的同级参数**，写错静默 skipped），每次量测前回读 `document.visibilityState`。
- **冻结标签页会给出过期 `computedStyle`**：判据很硬 —— **「连 inline `!important` 都改不动 computed 值」= 标签页被冻结**，
  不是 CSS 问题。可靠做法是 `agent-browser-cli open --focus <url>` 新开一页并确认 `visibilityState === 'visible'`。
  过渡冻结则先 `document.getAnimations().forEach(a => { try { a.finish(); } catch {} })` 再读。
- **`agent-browser-cli` 的 `tab_id` 不可信**：按它 `Page.navigate` 会导航到**别的**标签（真踩过两次）。
  正确做法：只用 `agent-browser-cli tabs` 按 URL **靠前的片段**（如 `.diag/`）找 id —— 它把 URL 截断到约 65 字符。
- **夹具 URL 必须带 `?tab=stars`**，否则脚本根本不转换，`grid: 0` 会被**误读成全绿**。改 `src/` 后
  **必须重跑 `node .diag/gen-otherstars-harness.cjs`**（夹具内联 dist，不自动跟随 build）。场景数以
  `grep -o "scenario === '[a-z-]*'" .diag/gen-otherstars-harness.cjs` 为准，**别在此维护数量**。
- **批量跑夹具的三道门**（`.pi/tmp/run-scenarios.sh` 已内置）：① 场景名必须在生成器里有对应分支（白名单含隐式 `own`）；
  ② 回读 `window.__gsmScenario` + `location.hash`（`open` 经 `python subprocess` 会丢 `&scenario=X`，静默退化成 `own`）；
  ③ 按 `title` 精确匹配标签页（`GSM harness: <scenario><hash>`），**禁止 `tail -1`**。`fail` 计数**也含**
  NO TAB / 场景不符 / 解析失败 —— 别只 grep `errors:`。**改工装后先用探针确认夹具活着**：
  **场景不生效的表现是「断言全绿」**。另注意夹具伪造 `matchMedia`，而真实 CSS 媒体查询看 `innerWidth` ⇒
  量测带媒体查询的 CSS 前先确认 `window.innerWidth`；更稳的是挑**与视口无关**的观测量。
- **别用 `setInterval` 给通知补种测试数据**（曾把夹具误当真实产出报给用户）。要用循环就必须在同一脚本里做完
  `clearInterval` 与容器清理，且不得当作「样式已生效」的视觉证据。
- **未提交改动做破坏性 A/B 实验时禁止 `git checkout -- <file>` 还原**：`cp` 到 `.pi/tmp/` → 改 `src/` → 跑 →
  `cp` 还原 → 核对 `git diff --stat` 与实验前一致。
- **清数据要「双清」**：GM_setValue 与 localStorage 镜像（`gmGet` 的迁移路径会自愈单边清理，只清一边看不出问题）。
  改 transform 逻辑前先 `Page.reload()`（幂等早退）。

### DOM 变更对照（GitHub 2026 改版，改选择器前先看）

| 位置 | 要点 |
|---|---|
| stars 列表项 | 类里有 `d-block` ⇒ `.d-block{display:block!important}` 压过内联 `display:none`（逐条隐藏必须 `setProperty(...,'important')`） |
| repoId | `user-list-menu[data-repository-id]`；**登出页没有它** ⇒ 退回仓库全名 |
| 原生筛选栏 | 锚点 `#stars-language-filter-menu-button`；上边距在包装节点上（克隆件需抄计算外边距才能对齐） |
| 详情页 | React + CSS-module；4.9.0 起脚本**完全不碰**详情页 |
| 网页写端点 | **精确**匹配 `form[action="/{o}/{r}/star"]`（`action$="/star"` 不会误命中 `/unstar`，精确匹配只是为了不易漂移） |
| 他人页星标状态 | `div.starring-container` 是否有 `on` 类；**`aria-label`/按钮文字/`/star`/`/unstar` 表单都不能判**（两表单永远并存，靠 CSS 显隐）；登出一个开关都不渲染 |
| stars 页骨架 | **两代并存**，同一 `?tab=stars` URL 随账号返回不同代际：旧代 `#user-starred-repos > .col-lg-9` + `.col-lg-3` + 标题「Starred repositories」；新代 `> .col-lg-12`（无 topics 列）+ 标题「Stars」。⇒ 选择器必须有退路（`getStarsMainColumn()` 退到 frame/`main`） |
| 条目内部 | 标题 `div.d-inline-block.mb-1 h3 a[href]`、描述 `div.py-1`、元信息 `div.f6.color-fg-muted.mt-2`（按**直接子节点**取，Lists 浮层里也有 `div.f6`）；计数含千分位逗号 |
| 「时间」语义 | 同一位置两条路由不同：`?tab=stars` 是 `Updated`、`/stars/{login}` 是 `Starred` ⇒ 读 `relative-time` 前一个文本节点分派 |
| URL 形态 | 另有 `/stars`（本人新版）与 `/stars/{login}`（200，**缺** `octolytics-dimension-user_id`、无 `body.mine`）；`/{login}/stars` 是 404。`?page=N` 在 HTML 页被**忽略**，真实翻页是 `after=`/`before=` 游标 |

---

## 已知风险 / 待确认（仍生效的）

- **dev HMR 需浏览器放行 CSP**（见上）。
- **classic token + 私有仓库**：无 `repo` scope 时同步可能把私有仓库误判 unstar（D3 已知局限）。
- **`GitHub-Verified-Fetch: true` 是玻璃地板**：无文档无契约（公开来源仅 2 次观测），GitHub 随时可收紧 ⇒ 只作观察项（若批量下开始 422 即说明收紧了）。
- **既有变异请求没有显式 deadline**：仍可能长时间占用串行队列；4.19.0 新增元数据读取已覆盖响应头和正文 20 秒超时。
- **网页通道均无法靠原生表单复核方向**（两种表单同时存在，脚本 fetch 不更新原生 DOM），只能以 HTTP 成功为准。
- **TM 菜单标签不跨标签页同步**；**老版 TM（< 5.0）下「隐藏 Lists」菜单项会累积重复**（功能不受影响，重进页面恢复）。
- **一键批量恢复会代发请求**，落在 AUP §4 的邻域（用户知情后要求实现；缓解 = 严格串行 ≥1s + 进度可见 + 可取消 + 确认弹窗）。
  「写通道不向用户披露」与 RDA §4(v) 的偏差同样记在 `docs/adr/0006`。
- **通知栈无条数上限**：一次同步检出多条外部取关会各弹一条，可能盖住列表右上半屏。**兜底颜色是浅色硬编码**（暗色主题仅在变量被移除时刺眼）。
- **底部那份分页器提交后焦点会掉到 `BODY`**（有意留下，代价大于收益）；`.gsm-sync-btn[aria-disabled='true']` 的 `cursor: progress` 实际不生效（纯装饰）。
- **归属校验与登录者回退都依赖无官方契约的页面 meta**（`octolytics-actor-id` / `user-login`）：被改名或移除时
  ① 归属校验**静默失效**（判 `unknown`，其余行为不变 —— 有意的降级方向）；② `getStorageUserId()` 的**回退支路**失效。
  注意**已确认过身份的 token 用户不受影响**（归属走指纹缓存，不必读 meta —— 这比 4.17.x 更稳）；但
  `saved-unverified`（保存时身份确认失败）那一支仍会回退登录者 ⇒ **仍依赖 meta**。同类前例：`meta[name="csrf-token"]` 曾普遍存在、如今已消失。
  **GHES / SAML SSO 下行为未确证**（届时可能完全失效，但仍为 `unknown`，不误报）。
- **归属解析的「快照窗口」**：任何「有 token 但指纹缓存无该凭证」的状态，都会在该会话首次 `getStorageUserId()`
  把归属**快照在登录者上**、整会话不再翻转（组合 B + 身份从未确认时是**永久**窗口）。这是有意的取舍
  （宁可一个会话不翻转，也不要中途换命名空间），代价 = 该会话写的数据落在登录者命名空间、下次加载才切到 token 账号；
  「身份冷缓存时导出、缓存变热后导入」还会被归属校验**拒绝**（自己的包导不回来）。前提 D30 失效时须重判。
- **夹具的非空转守卫**：宽限期/标签这类**按账号分区**的键一改名，夹具若仍种在旧键上，相关断言会
  「因为读空而全绿」（批量脚本只看 `_errors`）。本次已为 `other-editstate` / `own-unstar` / `other-logout-pending`
  加 `*_seedIsOnPartitionedKey` / `*_legacyKeyUntouched` 守卫，并**把守卫结论折进这三组的 `*_errors`**
  （只做返回值等于没闸门：批量脚本只判 `_errors`）—— **再改分区键时先确认这三组没变成假绿**。
- **关掉归属横幅后，页面上再无「数据属于哪个账号」的痕迹**（4.18.0 用户裁定不加新 UI 的必然代价）：缓解 =
  任一侧身份变化即重新武装；其余时间只有 console 与 `stars_full_sync_meta.accountId` 可查。
- **细粒度 token 调 `GET /user` 的文档位置很偏**（在端点页的 fine-grained 折叠小节里，readable 提取器易整段漏掉）：
  曾害本项目一次复核报出「引文不存在」并差点改坏 ADR 0007 ⇒ 复读请用原始 HTML 取证，依据见 `docs/research-finegrained-getuser.md`。
- **「无 token + 有登录会话」组合不做归属校验**（有意收窄）：网格缓存可能与账号无关 ⇒ 属**风险 14**。4.18.0 起
  `stars_full_sync_meta` **已记** `accountId`（**只写不判** ⇒ 现有读门不受影响），下一步做告警时才用它判定。
- **他人页网格的真实局限**（设计属性，非缺陷）：① 可编辑性依赖**本人整表缓存的时效**（本页新 star 且从未进缓存的仓库，可编辑性只在**本次页面会话**有效）；② 徽章只在我有对应数据时出现（未 star 的卡片通常一片空白）；③ 只有本页数据，无跨页筛选/搜索；④ DOM 里没有的字段即降级（`/stars/{login}` 的描述实测恒为空）；⑤ `viewContext` 模块态，任何「离开他人页」路径都必须复位；⑥ 依赖 GitHub 条目结构，改版即退化为「不接管」；⑦ **呈现层接管了页面框架**（左栏收窄、topics 搬进右栏、页主头像缩到 120px），功能层仍未接管（无脚本分页器/筛选栏/Sync 按钮/横幅）；⑧ GitHub 有**三套并存**的 stars 骨架 ⇒ 依赖骨架的选择器都必须有退路（新代是「GitHub 自己的全宽单列 + 我们的卡片网格」，观感与本方页不完全一致，属有意）。
- **他人页两条已登记未修**（4.14.0）：① 逐卡约 5 次 `GM_getValue`（30 条约 150+ 次同步 IPC）—— 要省得给存储层加「读缓存 + 写失效」，会改动全脚本共用的新鲜度语义，登记待立项；② 他人页上 D12 的「同步后立即重渲染」不生效（净收益）。
- **布局接管的两点残留**：① `.container-xl{max-width:1600px}` 是页面容器（布局的祖先），没法用后代标记限定 ⇒ 登出页页头容器也会被加宽（纯宽度）；② `/stars/{login}` 上根本没有 `.Layout` ⇒ 从不进入三栏接管（既有行为）。
- **本人页 unstar 后的只读态是「临时显示态」**：下一次整页重绘即消失；**有激活筛选/搜索时是「立即消失」**（`starCheck` 会紧跟 `applyFilters`）。已被裁定为预期；**不**为此把宽限期条目注入 `queryRepos()`。

---

## 下一步

1. **本轮升级（`@version` 4.18.0 → 4.19.0）后，用 dev 脚本的人必须重装 dev loader**（机制见上「dev 模式」第 4 条）；正式版不受影响。
2. **风险 21 的真机确认**（4.18.0 的核心口径，夹具只能覆盖行为层）：换一份**属于另一个账号**的 token ⇒ 横幅应同时
   点名两个账号**并含归属句**、且首句「⚠️ Token 归属与当前登录不一致」在 classic（`ghp_`）与 fine-grained 下都在；
   错号期间加的标签应落在 **token 账号**的命名空间（换回该 token 即再见）；关掉横幅后**换 token 或换登录账号应重新弹出**；
   配置面板**留空**点「保存并同步」应只报提示、**不清除**已有 token（清除只走 TM 菜单那条）。
3. **`tests/smoke/` 已修根因但不属于快速构建期**：两个 fixture 补了 `octolytics-actor-id`（此前缺这一行 ⇒ 自 4.12.0 起
   整套 smoke 断言都在空转），键名已分区。要跑它请按 `DEVELOPER.md` §11 的步骤（**不随 `pnpm check` 跑**）。
4. **D32 覆盖语义的真机确认**：导入一份**较旧**的包 ⇒ 确认框写明「文件里的标签/备注**覆盖**本地的」，报告里出现
   「其中被替换掉的本地标签 N 条」；再导入一份**只给备注、不给标签**的包 ⇒ 该仓库**已有标签必须原样保留**
   （「空不清空」的反向锁，别漏）。`name` 的合并是**已有名字优先** —— 若希望反过来，说一声，D9/D32 一起改。
5. **4.14.0 的真机确认**（只能在真 github.com + TM 上做；行为层已由夹具覆盖）：他人页与本人缓存**有交集**时才看得到效果
   （可用 TM 菜单先「立即全量同步」，再给自己的仓库加标签，然后去他人 stars 页）；点 star ⇒ 只有那张卡变可编辑；
   点 unstar ⇒ 立即不可编辑但**标签与备注仍在**；「恢复取消的 star」⇒ 回到可编辑且数据完好；
   仅进入/渲染他人页时 DevTools Network **零 `api.github.com` 请求**（用户主动 star/恢复按 D34 可解析目标）；TM 安装页**授权清单仍恰 5 项**。
6. **`docs/adr/0006` 剩余两项不可观测项**：`?scopes=repo` 预填是否真的勾上（被 sudo/passkey 门拦住，**不得**声称可用或不可用）、
   `context=user_stars` 服务端是否据其分支。离页仓库 + 仅 VF 头**已实测成立**，不必重验。
7. **后续阶段**（见 `todo`；`DEVELOPER.md` §13 只是指向它的指针）：GraphQL 分页调研、周期自动同步；要让他人页**跨页/全量**则需
   `GET /users/{u}/starred` 匿名 60/hr + 游标翻页 + 独立缓存键，动手前先重估额度与价值。
8. 未消化的架构建议：单遍 facet 计算、响应式漏斗（见 `starmgr-arch-review-report.md`）。
7. **原生 `fetch` 语言色通道的观察项**：受页面 CSP `connect-src` 约束（已实测该主机在白名单内），失败静默降级为灰圈；
   GitHub 若收紧 CSP，表现为语言色全灰 ⇒ 届时把 `gmFetchText` 加回来。
8. **两条仍生效的验证纪律**（别的历史验证记录已归入 `git log` 与归档方案，不必重跑）：
   - **归属校验不可能产生「相符」的可见证据**（相符时按设计零痕迹）—— 真机验证只能真的换另一个账号的 token，
     或改本地缓存 `stars_account_identity`。这是特性，不是缺陷。
   - **工装自身缺陷比被测代码的缺陷更值得记住**：夹具缺 `octolytics-actor-id` 会让「夹具全绿」掩盖「取错身份字段」；
     生成脚本里的反引号会截断外层模板字符串、替换会留下空的前置分支 ⇒ **场景静默失效**。改工装后**先用探针确认夹具状态**。

---

## 常用命令

```bash
pnpm check     # tsc --noEmit + build（改完必跑）
pnpm build     # → dist/github-star-manager.user.js
pnpm dev       # HMR，需先解决上面 CSP 那条；入口 http://127.0.0.1:5173/__vite-plugin-monkey.install.user.js
pnpm build && node scripts/verify-css.cjs   # 产物 CSS 与源 CSS 等价性
pnpm test:api            # ID 寻址/队列/恢复/同步回归（mock 网络）
pnpm test:exportimport   # 导入导出纯逻辑断言（无需浏览器；项数以实际输出为准，别写死数字）
node scripts/ratelimit-probe.cjs --repo <me/repo>   # 限流实测探针（默认 dry-run）
```

**静态验收口径**：`pnpm check` 绿、`test:exportimport` 全过、动 CSS 时 `verify-css` EXIT 0、
dist 头部 `@grant` 恰 5 项；夹具各组 `__errors` 全空、他人页 `fetch = 0` / `writes = 0`、窄视口 `gsm-*` 节点与标记全 0。
**快速构建期不跑 `tests/smoke/`**，由用户在真实页面判断。

**建议技能**：`agent-browser-cli`（真机 DOM 探查/注入/截图/受信任点击）—— 用前先读上面「真机调试要点」；
夹具与断言可重复运行：`node .diag/gen-otherstars-harness.cjs` → `file://.../?tab=stars&scenario=<名>` →
`agent-browser-cli exec --tab <id> --file .diag/assert-otherstars.js`。
