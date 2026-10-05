# GithubStarManager — Agent Handoff

> 架构 / 模块职责 / 数据流 / 存储模型 / 约束以 **`DEVELOPER.md`** 为准（权威文档，勿在此重复）。
> 本文件只记录：**当前状态、仍生效的设计决策、调试要点、下一步**。
> 历史过程一律查 `git log`（提交信息本身写得很详细），本文件不写「上一轮改了什么」。

---

## 交接 · 下一轮：风险 21 的归属（标签/备注/宽限期备份跟 **token 账号**走）

> 交接时间：**2026-10-05 22:10 +0800**
>
> 上一轮 **4.17.0「导入导出策略改版」**（硬口径 **D32**；格式修订见 `docs/adr/0001` / `0005` 的「4.17.0 修订」段）
> 已通过**三轮**独立审查（前两轮各 3 名审查员 + 本轮 3 名）与静态 / 夹具回归。净变化四件事：① 导出包去掉 `data.repoCache`、导入按「该仓库在不在整表
> 缓存里」逐仓库分派（不在 ⇒ 24h 宽限期）⇒ **风险 22 因消除前提而消除**；② 新增最小标识 `data.repoNames`
> （让宽限期条目能被手动恢复）；③ 无整表缓存时导入**前**自动同步一次；④ **标签合并由「取并集」改为「覆盖」**
> （用户裁定）⇒ **风险 23 消解**。验证数字、A/B 反证与审查过程见 gbrain `people/me`（不在本文件维护计数）。

### 下一轮要做什么（用户 2026-10-05 口述口径，原话）

> 风险21中，备份应当也有所属标记，归属到某一用户下。切换账号会导致当前配置token与登录账号不一致的警告，
> tag/备注应当只跟token账号走。用户忽略警告就已知晓此时内容不属于此登录账户而是属于token所属账户。

**归属 = 读路径账号**：有 token ⇒ **token 账号**；无 token ⇒ 登录会话。论据：屏幕上是**谁的**列表完全由
`GET /user/starred`（带 token）决定（`fullSync.ts` 的 `Authorization: Bearer`），**展示与归属必须同账号**，
否则屏幕上是 A 的列表、标签却记在 B 名下 —— 那正是风险 21 的形状。
⇒ **D27 的「隔离账号 = 登录者」要改写**；`exportImport.ts` 的包身份（`user.id`）与导入归属校验同源，一并改。
（正常情况 token 主人 == 登录者 ⇒ 两侧 id 相等 ⇒ 键不变、**零数据迁移**。）

### 动手前必须裁决（照用户措辞**字面**实现会坏的地方）

1. **「加所属标记」不能达成隔离 —— 必须键分区**：`PendingDeleteMap` 是 `Record<repoId, entry>`，两个账号对
   **同一 repoId** 各有一条备份时会**互相顶掉**（加 `owner` 字段只是「有标记地被顶掉」）。可行形态只有
   `stars_pending_delete_<归属id>`（与 tags/notes 同构：读不到即空表）。
2. **归属 id 只能同步取，不能在存储层 await**：token 账号 id 只在 `GET /user`（异步）里，而 `getStorageUserId()`
   被存储层**同步**调用（tags/notes/exportImport）⇒ 复用**已有**的指纹缓存 `STORAGE_KEYS.accountIdentity`
   （`{ [token指纹]: { id, login } }`）按指纹同步查表。**不得**改成「读取时顺手发一次身份请求」——
   会同时破坏他人页零网络（D26）与 D25 的省额度口径。
3. **组合 B 有一处永久缺口**：`accountGuard.run()` 在 `!hasWebSession()` 时**直接返回 unknown 且完全不发身份
   请求**（注释原文「组合 B：写路径只在 token 上，无错号风险」）⇒ 该组合下指纹缓存**永不填充**，而
   `getViewerId()` 有值（今天标签**读得到**）⇒ 若改成「只认 token、查不到读空」，这批**有 token 但无
   `user-login` meta** 的用户的标签会**永久读不到**。默认降级：未命中时**回退 `getViewerId()`**。
4. **「忽略警告 = 已知晓」在当前披露面上不成立**：D25 的横幅可被**永久关闭**
   （`stars_account_banner_dismissed = <tokenId>#<sessionId>`，同组合不再重弹），且求值只在本人页发生
   （但注意 `mountAccountGuard` 挂在 `runFullSync` 的 finally 上 ⇒ **他人页手动同步时也可能出现**）⇒
   错号是**持续状态**，「一次性知晓」承担不了持续告知。要补两件：① 横幅文案写明归属
   （「标签/备注属于 @<tokenLogin>」）；② 一处**不可关闭**、在数据所在处可见的归属显示。
5. **还差一个字段**：决定「有哪些卡片」的是 `stars_repo_cache`，只给 pending 加归属仍答不了「这个网格是谁的
   列表」⇒ 与既有**风险 14**（`stars_full_sync_meta` 不记账号归属）同源，需一并加账号字段。
6. **写通道的镜像错配要写清**：`setStarState` 在 classic 下写 token 主人、fine-grained / 无 token 下写**登录者**、
   classic 遇 403 permission-denied 还会**回落网页端点** ⇒「有 fine-grained token 的用户 unstar」那次写落在
   登录者名下。本口径仍把该备份记在 **token 账号**下（与屏幕一致的读路径归属）。

**前提（D30）**：以上免迁移代码都靠「开发阶段 / 无已有用户」；**该前提一旦失效，依据立刻作废、必须重判**。

**落点**：`src/storage/tags.ts`（`getStorageUserId`）/ `notes.ts` / `pendingDelete.ts`（全表读写与键名）/
`cardState.ts`（`hasViewerIdentity`）/ `constants.ts`（键前缀）/ `starCheck.ts` / `fullSync.ts`
（`stars_full_sync_meta` 加账号）/ `ui/accountBanner.ts`（归属文案）/ `exportImport.ts`（包身份与归属校验）。
---

## 当前状态

版本 **4.17.0**（`package.json` 为单一版本源，`vite.config.ts` 读它写入脚本头）。

> 交接时间：**2026-10-05**。每轮的提交信息与 `docs/plans/archive/2026/` 的实施计划都是历史权威，
> 本文件只留**仍生效**的口径与下一步（已完成的过程记录一律压缩为「口径 + 指针」）。

**4.17.0（当前版本）**：**导入导出改版**（硬口径 **D32**）—— 导出包只剩 `tags`/`notes`/`repoNames`；
导入逐仓库分派（**在整表缓存里 ⇒ 活区；否则 ⇒ 24h 宽限期**）、**两条去向同一条胜负规则**
（包内归一化后非空 ⇒ 覆盖，非并集）、无整表缓存时导入前同步一次。风险 **22 / 23** 均由此消除。

**4.16.2**：**修掉「本人 stars 页 unstar 后标签/备注直接消失」**（硬口径见 **D31**）——
用户在本人页点卡片星按钮取消 star 后，标签整行消失、备注只剩「添加备注…」占位；同一份数据在**他人**页
却正常只读显示。根因是同一概念的**第二处判据漂移**：`markRepoUnstarred()` 把数据搬进 24h 宽限期备份并
清空活区，而 `cardAreas` 的 `own` 分支**无条件**调可编辑渲染器、只读活区（`other` 分支走 `cardState` 三态、
会读备份）。修法沿用 D29 的纪律：判定只在 `cardState.ts` 一处（新增 `getOwnPageCardState`），
本人页收窄为**二态**（命中宽限期 ⇒ `locked-pending` 只读但仍显示；其余 ⇒ `editable`，逐字不变）。
夹具新增场景 `own-unstar` + 断言组 **R29**，含 A/B 反证（回退后 `R29_betaTagTexts` 变 `[]`、
`R29_betaEditorAfterClick` 变 `1`）。上一个版本 **4.16.1**：**修掉「同步后重渲染把用户弹回页顶」**（硬口径已并入 **D12**）——
`renderBrowsePage` 由「`innerHTML=''` + 逐张 `appendChild`」改为**分片建好后一次 `replaceChildren`**，
并删掉 `applyFilters` 里那句重复的 `.stars-grid-card-cached` 整批预删除。根因是**拆建之间出现了「空网格」中间态**：
那一刻整页只剩一屏高（真机实测 `docH` 2787 → 957），浏览器重算滚动范围后把 `scrollY` 夹到 0，
而重建**不会**把位置还回来（A/B 实测：旧 2599→0 / 1812→0，原子替换两条都保持原值）。**无 API / 存储 / UI 变化**、
`package.json` 外无其它版本引用。上一个版本 **4.16.0** 为「删除整批版本迁移代码」批次（见 **D30**）；**4.15.0** 为「按 ponytail 口径精简」批次（零用户可见行为变化）。再上一个功能版本 **4.14.0**：他人 stars 页的卡片改为「逐仓库」可编辑 —— 用户报「他人 star 页面的卡片会因为点了
star 就变成可编辑状态」。根因是**只读被判成了页级单一布尔**，且分派写了两处、判据不一致：
`filters.renderBrowsePage` 有判据，而 `starCheck.syncCardAfterStarChange` **无条件**调可编辑渲染器
（后者在点星成功的回调链上）。详见 **D29** 与 `docs/adr/0009` 的「追加 7」。一句话口径：

1. **三态逐仓库判定**（新模块 `src/cardState.ts`）：`editable`（本人已 star）/ `locked-pending`
   （已 unstar 但数据仍在 **24h 宽限期备份**里）/ `locked-empty`（两者都不是）。
2. **可编辑性只认「已提交」状态**（内存覆盖表 → 本人整表缓存），不认乐观翻转、不认在途请求。
3. **未 star 但仍在宽限期内的卡片：只读，但仍显示标签与备注**（数据来自 `stars_pending_delete`
   的 `_tags`/`_note` —— 活区此刻已被 `markRepoUnstarred` 清空，所以只读渲染器改为**接受调用方传入的数据**）。
4. **渲染分派唯一入口**：`src/cardAreas.ts` 的 `renderCardTagAndNoteAreas(card, 'own' | 'other', viewerCache)`。
   禁止再出现第二处 `readOnly ? A : B` —— 两处判据不一致**就是**这个缺陷。
5. **口径收窄**：「零存储写入」→「**渲染路径**零写入，用户显式动作才写、且只写登录者命名空间」；
   **零网络不变**。顺带给 `applyFilters()` 补了 `isReadOnlyView()` 早退门（否则「在自己页筛过标签 →
   切到别人的页 → 点 star」会往**页面主人**的原生筛选行插控件）。
6. **他人页点标签不再切换筛选**（`renderTags` 的 `filterToggle` 上下文开关，默认 `true` = 自有页逐字不变）。
7. **发布前独立审查**（外部 reviewer）抓到 **1 P1 + 4 P2**（详见 D29 末条）：
   P1 = 只读卡片的备注容器上残留可编辑 click 监听 ⇒ **点一下仍能弹编辑器并真的写盘**（容器在重绘间
   复用，`innerHTML = ''` 摘不掉监听）→ 已修（`ui/notes.ts` 的 `disposeNotesEditor()` + 唯一分派点先摘）；
   P2 ×2 已修（登出页泄露全局宽限期备份 / `isStarredByViewer` 两份实现），P2 ×2 登记为观察项。

**4.13.0 提要**（他人的 star 页 = 零网络只读网格）：4.12.0 的「原生列表 + 只读徽章」在真机上确实工作，但**用户几乎
永远看不到**（实测 mattn 前 100 个 starred 与本人 21 个带标签/备注的仓库**交集为 0**）。用户因此裁定「用脚本网格」，
并给出决定性约束：**只获取页面中已有的数据，不拉取**。落地形态 = 投影层 `src/domRepos.ts`（DOM 原生条目 → `RepoData`，
两条路线）+ 只存内存的来源 `src/viewContext.ts`（无他人缓存键）+ 呈现层与本方自己的页共用 `src/layoutStyles.ts` 的
布局主表 + 只藏原生条目、翻页与筛选**委派原生控件**。
完整口径见 **D26** 与 **`docs/adr/0009`**（含 4.14.0 的逐仓库可编辑修订）。
> **这一轮的逐条过程**（④-⑩：`!important` 隐藏、布局主表抽出、头像作用域、说明行移除、顶部翻页器与对齐、
> topics 归宿、未登录兼容、布局标记接管、以及审查轮修掉的 P1）**已全部归入 `git log` 与
> `docs/adr/0008` / `0009`**，此处不复述。仍然生效、且最容易踩的硬口径只有下面这几条：
>
> 1. **隐藏原生条目必须带 `!important`**（`hideNativeNode` 用 `setProperty(...,'important')`）：GitHub 的
>    `.d-block{display:block!important}` 会压过不带 important 的内联 `display:none`。
> 2. **布局接管只认 `gsm-stars-layout` 标记**（`markStarsLayout()` 打在承载 stars 内容的那个 `.Layout` 上），
>    不许按 `.Layout--sidebarPosition-start` 这类骨架类选元素 —— 登出页有两个那种布局，页头会被一起改写。
> 3. **尺寸规则认标记、过渡规则不认**（方向相反，别为「一致性」统一）：`exitStarsView` 在同一同步任务里
>    既撤尺寸规则又摘标记，过渡若认标记就没有 after-change 声明 ⇒ 回退尺寸瞬跳（审查轮 P1）。
> 4. **搬 topics 必须 `closest` 找内容布局**，不许 `document.querySelector` 取第一个；隐藏原生列的 CSS
>    绑在搬运成功的 `[data-gsm-topics-src]` 上（「搬走了才藏」）。
> 5. **只读网格的星按钮状态只认本人缓存**：他人页原生星按钮显示的是**页面主人**的状态，照抄就会点出 unstar。
> 6. **未登录的 stars 页也接管**（无徽章 / 无星按钮 / 仍零网络），但**没有** `user-list-menu[data-repository-id]` ⇒
>    `repoId` 退回仓库全名。
> 7. **`viewContext` 是模块态**（Turbo 换 DOM 冲不掉）：回自己页必须 `exitOtherStarsViewIfActive()` 复位，否则把别人的列表画在我自己的页上。
> 8. **零网络的隐藏陷阱**：卡片渲染里的 `getLangColor()` 在色表未命中时会**间接**发 linguist 请求 ⇒ 进入他人页必须
>    `setLangColorFetchEnabled(false)`、退出恢复。**不设这个闸，零网络断言必挂。**

**验证记录**（4.13.0 / 4.14.0 当时的逐条夹具结果与真机数值已归入 `git log` 与 `docs/adr/0009`；此处只留**仍生效的验
证口径**，下次改动照这些跑）：

**静态口径**：`pnpm check` 绿（tsc --noEmit + build）、`test:exportimport` 全过、动 CSS 时 `verify-css` EXIT 0、
dist 头部 `@grant` 恰 5 项。
**滚动位置口径（4.16.1）**：重绘前后 `window.scrollY` 必须不变，且过程内 `docH` **不得**低于 `innerHeight`
（中间态判据）。可跑 `.diag/probe-ab-replace.js`（夹具）与 `.diag/probe-ab-live.js`（真机，跑完还原节点）；
跑真机版前先 `document.getAnimations().forEach(a => { try { a.finish(); } catch {} })`，否则后台标签页读到起点值。

- **夹具 URL 必须带 `?tab=stars`**，否则 `isStarsPage()` 为假、脚本根本不转换，`grid:0` 会被**误读成全绿**。
  场景名以 `.diag/gen-otherstars-harness.cjs` 的 `scenario ===` 分支为准（现 **18 组**：17 个显式场景 + 生成器无分支的隐式 `own`；断言侧另有 `#narrow` 窄视口。
  **别在此维护数量** —— 同 `isDesktop()` 的处置，以 `grep -o "scenario === '[a-z-]*'" .diag/gen-otherstars-harness.cjs` 为准）。
- **恒成立的不变量**：各组 `__errors` 全空；他人页 `fetch=0` / `writes=0`；窄视口 `gsm-*` 节点与标记全 0。
  ⚠️ 4.14.0 起「他人页编辑控件必须为 0」**不再**恒成立（本人已 star 的卡片可编辑），它收窄为
  「没有默认打开的编辑器」「只读卡片 0 控件」「渲染路径零写入」「零网络」。
- **断言要挑与视口无关的观测量**（隐藏标签页下也稳定）：**R19** 退出后痕迹清零 **且**声明了 transition 的规则仍
  匹配侧栏/头像（钳合实测：认标记版 = 0/0、修复版 = 1/1）；**R20** 布局标记自愈（摘掉标记后重进必须补回；
  `/stars/{login}` 记为 N/A —— 该路由无 frame）。归属判定另有 `.diag/assert-scope.cjs`（21 项）。
- **量测前先冻结过渡**：`document.getAnimations().forEach(a => a.finish())`，否则隐藏标签页里读到的是起点值。
- **仍需人工确认（只剩观感）**：① 卡片密度；② TM 安装页里授权清单仍**恰 5 项**；③ 真机 Turbo 导航
  「本人页 ↔ 他人页」往返的手感；④ **登出态**观感（页头应保持 GitHub 原样 —— 夹具咬合证明改前页头头像会被压到
  120px、轨道被换成我们的三栏）。

**4.11.1 提要**（仍生效的口径已归入 D8 / D25 与 `docs/adr/0007`，此处只留一句）：删掉配置横幅里那个**永远无效**的
「立即同步」按钮与归属横幅上的 classic 深链按钮，净效果 = 「配置横幅只引导配置，归属横幅只引导去配置」。

> **交接第一件事**：`@version` 一升，**用 dev 脚本的人就必须重装 dev loader**（重开安装页原地更新），否则 TM 菜单整体消失。
> 机制见下「dev 模式必须知道的四件事」第 4 条。正式版不受影响。

**4.11.0 提要**（仍生效的口径已全部归入 **D25** 与 `docs/adr/0007`，此处只留一句）：补上「Token 归属校验」+ 不符时的常驻
可关闭警告横幅 —— 两侧各取**数字 ID** 比对（页面 `octolytics-actor-id`（**登录者**）vs `GET /user` 的 `id`；**不取**
`octolytics-dimension-user_id`，那是页面主人，会让每个他人的 stars 页假阳性）、**只告警不阻断**、取不到任一侧即
`unknown`（不冒充相符也不误报）、指纹缓存命中后稳态零请求。规划与验收标准见归档方案
`docs/plans/archive/2026/2026-10-02-补上-token-归属校验环节-比对脚本-token-身份与浏览器当前登录账号-不符时在现有配置.md`
（联网查证证据 `.pi/tmp/research-token-identity.md`；两轮独立审查共修 3 P1 + 4 P2，逐条口径与仿真断言表见本文「下一步」第 9 条）。

**4.10.0 提要**（仍生效的口径已全部归入 D22–D24，此处只留一句）：分页按钮可跳页（原位输入 + window-capture 委托）+
所有同步入口驱动头部 Sync 按钮（`SyncState` 单一真相、`mountSyncButton` 是唯一视图）+ 删旧的整按钮刷新态 +
`pushNotice` 视口门；另一轮发布前独立审查修掉 1 P0 + 3 P1。细节查 `git log` 与归档方案
`docs/plans/archive/2026/2026-10-02-分页按钮可跳页-*.md`（联网调研证据 `docs/research-pager-jump-a11y-spinner.md`）。

**4.9.2 提要**（仍生效的口径已全部归入 D18–D21，此处只留一句）：窄视口完全惰性 + `viewTeardown` 幂等回滚 +
`lifecycle` 世代号 + GM 权限 8→5；另有一轮独立审查修掉 5 处真缺陷（原生搜索拦截未解绑、回滚后仍发整表 API、
桌面 Hide Lists 回归、首次安装 Lists 标题行外露、topics 回填无身份校验）——实现细节查 `git log` 与
`docs/plans/archive/2026/2026-10-02-优化手机端-窄视口-脚本行为-…-精简-gm-权限.md`。

**更早的版本**（改动细节查 `git log` 与对应 ADR；此处只保留仍生效的口径）

- **4.9.1**：通知栈锚在全局头部下方（`header-wrapper` 底边 +8px）；观感 = GitHub 自己的 `.flash` 内联消息族
  （**不要**回退 Primer `Toast` 族）；同步后立即重渲染、删掉「点击刷新」提示。现行口径见 **D11 / D12**。
- **4.9.0**：写路径两条通道（REST / 网页端点）静默分派；全局串行变异队列（≥1s，排队中再点 = 撤销）；
  变化简报 + 恢复菜单；导入后不自动同步（**4.17.0 已收窄**：无整表缓存时导入**前**同步一次）；配置横幅两条 Token 深链。见 `docs/adr/0003`–`0006` 与 **D3 / D9 / D10**。

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

- 手动同步 = **两个等价入口**：TM 菜单「🔄 立即全量同步」、标题行 Sync 按钮；一律经条件快筛后才决定是否整表。（4.11.1 移除了配置横幅里那个「立即同步」按钮：无 token 时它只会把同一条要求配置的提示重写一遍，有 token 时横幅本就随同步成功撤除。）
- 界面与 TM 菜单**不出现** P2.5 / P4 / 核对 等开发阶段表述（仅控制台日志与代码注释保留）。
- GitHub **没有**创建个人 PAT 的 API，快捷获取永久只能靠预填 URL 深链。预填参数表（fine-grained 的
  Pre-filling … using URL parameters）见上面的个人访问令牌文档；classic 的 `?scopes=` 预填官方**未文档化**。
  组织级端点 `/orgs/{org}/personal-access-tokens` 是审批/撤销管理，**非创建**。

**D9 · 导入导出（4.7.0）**

- 导出包**只含本地权威数据（标签 / 备注）+ 每个仓库的最小标识 `owner/repo`**（`data.repoNames`，4.17.0）；
  **不含** `github_pat`、同步元数据（ETag 基线）、宽限期备份，
  也**不含描述性仓库元数据**（语言 / star 数 / 描述 —— 4.17.0 起移除，由同步承载，理由见 `docs/adr/0001` 的
  「4.17.0 修订」段）。`repoNames` 不是展示数据，它是「恢复」这个写请求的目标地址，缺了它恢复入口不可用。
- **导入按「本地是否确认已 star」逐仓库分派**（4.17.0）——判据就是**该仓库在不在 `stars_repo_cache` 里**，
  与 `hasApiData()` 无关（两者可背离，见 D32 的审查修正段）：**在** ⇒ 写活区；**不在**（未 star / 从未同步 /
  缓存里就是没有它）⇒ 进入 **24h 宽限期**（带 `_tags`/`_note`/`name`；**不重置** `unstarredAt`；
  **两者皆空且此前无有效条目 ⇒ 什么都不做**（超期条目按「不存在」），不制造空条目去走 24h 倒计时）。
- **胜负规则两边相同**（**4.17.0 修订 ③**，用户裁定推翻原「标签取并集」）：**包内该字段非空 ⇒ 覆盖目标；
  为空 / 缺省 ⇒ 保留目标**（标签与备注；**`name` 相反 —— 已有名字优先**，包里的名字只用来补空，见 D32）
  ⇒ 曾登记的**风险 23 随之消解**。
  **归一化在分派之前只做一次**：标签先 `dedupe` + 剔空白项再判空（曾只活区去重 ⇒ 恢复时带出重复 pill），
  备注按 trim 后为空；**单条标签文本本身不 trim**。
  **「空」必须保留而非清空**（仓库可能只出现在 `notes` 里 ⇒ 把空当清空 = 「导入一份没说它标签的文件、它的标签没了」）。
  **已接受代价**：导入较旧的包会覆盖你之后新加的同仓库标签（确认框与提示已写明）。
  **导入不再往 `stars_repo_cache` 写任何条目** ⇒ 风险 22 的触发前提不复存在（见风险 22 与 D32）。
- 无整表缓存（`hasApiData()` 为假）时**先自动同步一次**（唯一例外，见 `docs/adr/0005` 的「4.17.0 修订」）；
  同步失败**不阻断**导入 —— 未能确认的仓库一律进宽限期，提示**写死** 24h 补救窗口。
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
- **重绘期间网格不得出现「空态」（4.16.1）**：`renderBrowsePage` 是**唯一**拆建点，且必须
  **分片建好再一次 `replaceChildren`**；`applyFilters` 里那句 `.stars-grid-card-cached` 整批预删除已删，
  **不得**以任何形式恢复「先清空 → 再重建」的二段式（别处加预删除、改回 `innerHTML=''`、或改成
  `remove()` 后再逐张 append 都算）。理由：清空那一刻网格为空 ⇒ 整页只剩一屏高（真机实测 `docH`
  2787 → 957）⇒ 浏览器重算滚动范围把 `scrollY` 夹到 0，而重建**不会**把位置还回来
  （A/B：旧 2599→0 / 1812→0；原子替换 2599→2599 / 1812→1812）。刻意**不**用「保存并还原 `scrollY`」
  代替 —— 位置在原子替换下根本不会动，多写一次反而打断用户期间自己的滚动与 `overflow-anchor`。
  可复跑的 A/B：`.diag/scroll-clamp-probe.html` + `.diag/probe-ab-replace.js`（`docH@flush` 是中间态
  是否被布局观察到的判据）；真机版 `.diag/probe-ab-live.js`（**跑完必须把原节点 `replaceChildren` 还回**）。

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
  保留的 5 类各有硬理由（`:has()` 退路有 `cssTarget=safari15` 背书；12×150ms 重试 + 双 4s 兜底防白屏；
  GM↔localStorage 镜像层是 dev/非 TM 的唯一数据通道（**仍保留**）；
  `starWrites` 两段式与 `fullSync` 完整性阀门有真机实测/ADR 红线）。
  **4.16.0 更新**：「`tags`/`notes` 旧键迁移」这一条已按 **D30** 删除（原措辞在删除后成为假断言）；
  其中 `notes` 那条旧键**从来就没有迁移路径**（`migrateNotesIfNeeded` 全历史零命中），
  4.15.0 只删了它的常量。
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

**D25 · Token 归属校验：不符只告警、不阻断（4.11.0）**

- **要解决的问题**：写路径静默分派（ADR 0006）使「有 classic token → 写到 token 主人」「无 classic token → 写到浏览器登录者」，
  而读路径永远用 token ⇒ token 与登录会话分属两账号时，**fine-grained 场景下读与写方向相反**（显示已 star → 发 unstar）。
  4.10.0 及之前全库无任何比对（`hasWebSession()` 只判有没有会话、从不读 meta 值；无 `GET /user`）。
- **比对键 = 数字 ID**（页面 **`octolytics-actor-id`（登录者）** vs `GET /user` 的 `id`）。**不用 `login`**：官方明文 login 可改名、
  id 持久，用 login 会在改名后产生**永久误报**（唯一出路只剩重配 token）。`login` 只用于文案。
- **必须取「登录者」而非「页面主人」**（第二轮审查 P1-2，真机实测）：`octolytics-dimension-user_id`（= 既有
  `getStarsUserId()`）是**被访问者**的 id —— 打开他人 stars 页时它与登录者不同，用它做比对键会让每个他人的 stars 页
  都假阳性，并断言「浏览器登录的是 @页面主人」。**取不到 actor-id 时不回退到 dimension-\***（回退等于恢复假阳性）。
  实测表（登录态、只读同源 fetch，工装 `.diag/probe-viewer-id.js`）：
  `user-login`/`octolytics-actor-id` 恒为登录者（YsLtr / 130123551），`octolytics-dimension-user_id` 在他人页变为 10111（mattn）。
- **只在「有 token + 有登录会话 + 两侧 id 都取到」时判定**；其余组合（有 token 无会话 / 无 token）一律 `unknown`。
  取不到任一侧或请求失败 = `unknown`，**既不冒充相符也不误报不符** —— 页面 meta **无官方契约**（`csrf-token` 曾消失，
  是同类前例），要求是「失效 = 退回今天的行为」，不是「失效 = 满屏误报」。
- **`GET /user` 401 不算归属不符**：走既有 `notifyTokenIssue` → 配置横幅。**不阻断写路径**：网页端点通道是 fine-grained 用户
  唯一的写能力，且用户可能**刻意**双账号（个人号读、工作号写）；处置交给用户。**不做写前校验**（会污染写路径失败语义）、
  **不做周期轮询**（纯耗额度）。
- **UI = `div.gsm-account-banner`**（`role="alert"`，**两个**控件：打开既有配置面板 / 关闭），落位**复用**
  `placeSetupBanner`，但**不复用 `.gsm-setup-banner` 类名** —— 那个类名有 4 条撤除路径（内联保存、保存回调、同步成功后、
  `viewTeardown` 第 3 项），复用会让警告在「保存了新 token」「同步成功」时被静默删掉且再无重建时机。已登记进
  `viewTeardown` 第 3 项选择器串；关闭键 `stars_account_banner_dismissed`（= `<tokenId>#<sessionId>`，组合一变重新武装）
  属**页面级偏好**，不随视口回滚。
  **横幅上不放开深链按钮**（用户裁定）：classic 深链在配置面板里已有同款入口（`快速获取 Token（classic，推荐）`），
  且面板同时给出 fine-grained 深链与粘贴行 —— 「打开 Token 配置」一步就能拿到全部出路，横幅不再放只开一条深链的按钮。
- **求值点三处**：Token 保存成功后（`index.ts` 的 `setTokenSavedHandler`）、桌面转换成功出口（紧随 `scheduleProbeSync`）、
  `runFullSync` 的 `finally`（同步链唯一全覆盖点）。全部 fire-and-forget，**不得**进入同步关键路径或影响 `SyncState`（D23）。
- **窄视口惰性**：求值首行判视口 → `unknown`（不建节点、不发请求）。横幅样式在 `@media` 之外，靠 JS 门守（同 D18）；
  变宽时由既有 `transformAndReveal(false)` 重新求值。**异步返回后必须复判**（4.11.0 发布前审查 P1）：
  `mountAccountGuard` 捕获 `currentGeneration()`，`.then` 里先判世代、再判视口 —— 否则慢网下一次 `GET /user`
  就能在手机上凭空建出完整样式的警告横幅（求值在途时收窄 → teardown 跑完 → 延迟返回照样建节点）。
- **文案按写通道分叉，且 classic 分支**不得**做确定性断言**（4.11.0 发布前审查 P1 + 用户质询后复审）：
  `AccountVerdict.writeTarget` 由 `isClassicCredential(token)` 决定 —— classic 走 REST ⇒ 通常记到 **token 主人**；
  fine-grained / 无 classic 走网页端点 ⇒ 记到**浏览器登录者**。但 classic 分支**不能说「一定」**：
  `setStarState` 在 REST 返回 403（非限速）且存在登录会话时**会回落网页端点**（`src/starWrites.ts:299`），
  那一次写落到登录者名下（实测：`DELETE /user/starred/…` → 403 后紧跟 `POST /{o}/{r}/unstar`，
  见 `.diag/assert-account-fallback.js`）。故 classic 措辞为「**通常**也记到 @A……**若 @A 被拒绝，会改以 @B 的身份进行**」；
  只有 fine-grained 那条路（有会话时只走网页端点、失败不跨通道回落）才允许直说「会记录到 @B」。
- **`hasToken` 区分「确定没配 token」与「取不到身份」**（4.11.0 发布前审查 P2）：前者横幅前提已消失 ⇒ 允许撤掉；
  后者（含判定异常，保守取 `hasToken: true`）**不得**抹掉已显示的警告。
- **接入 `setHideListsRepositionHandler`**：与配置横幅同一套落位规则，开关切换时一并 `repositionAccountBanner()`。
- **额度**：首次 +1 次 primary 请求，指纹缓存（`stars_account_identity`，FNV-1a 内联哈希，**不存 token 明文**、
  不用 `crypto.subtle`）命中后稳态零请求。
- **文案**：沿用 ADR 0006「不向用户披露通道」，只讲后果与两条出路，不出现「网页端点 / 浏览器登录会话 / REST」等实现词。
- 完整口径、依据与已知局限：**`docs/adr/0007-token-account-match-check.md`**。

**D26 · 他人的 star 页 = 零网络只读网格（4.13.0；取代 4.12.0 的「原生列表 + 只读徽章」形态）**

> **4.12.0 的旧形态**（保留此段只为解释历史与排查口径）：只读模式**保留原生列表**、把本人已有的标签/备注
> 以只读徽章贴进原生命中条目（`.gsm-ro-tags` / `.gsm-ro-notes`）。它在真机上确实工作，
> 但**用户几乎永远看不到** —— 实测 mattn 前 100 个 starred 仓库与本人 21 个带标签/备注的仓库**交集为 0**。
> 用户因此裁定「用脚本网格」，随后给出决定性约束：**只获取页面中已有的数据，不拉取，做网格**。

- **判定仍为三态**（`src/pageScope.ts` 的 `getStarsPageScope()`）：`own` / `other` / `unknown`。
  主判据 = `octolytics-actor-id`（登录者）vs `octolytics-dimension-user_id`（页面主人）；id 取不到退到 login 比对；
  `/stars/{login}` 路由没有 dimension-* 元数据，只能比路径段。**取不到就判 `unknown`，绝不回退成 `own`**；
  `unknown` 与 `other` 同处置（都按他人页渲染只读网格）。**注意措辞**：4.12.0 时这两者「都不接管」，
  4.13.0 起他人页是**接管**的（只读网格）—— 分派点 `index.ts` 判的是 `scope !== 'own'`，
  所以 `unknown` **也会**出网格（未登录访客同理）。
- **零网络 = 硬约束**：数据只来自**页面已渲染的原生条目**的一次投影（`src/domRepos.ts`），
  不调 API、不预取、不做条件请求、不做归属校验请求。**必须**同时压住那条**间接**请求：
  卡片渲染里的 `getLangColor()` 在色表未命中时会顺手发一次 linguist 请求 ——
  故 `otherStarsView` 进入时调 `setLangColorFetchEnabled(false)`、退出时恢复（否则零网络断言必挂）。
  工装判据：他人页 `__gsmFetchLog.length === 0` **且** `__gmWrites.length === 0`（零网络 + 零存储写入）。
- **零存储（4.14.0 收窄为「渲染路径零写入」）**：投影只存内存（`src/viewContext.ts`）；不写**任何**
  他人页专属键、不碰 `stars_repo_cache` / `stars_full_sync_meta`；标签/备注仍读**我自己的**命名空间（D27）。
  **没有**他人缓存键，也**不**进导出包。4.13.0 的「全程零存储写入」按用户需求放宽为：
  **只有用户显式动作（点星、增删标签、写备注）才写，且只写登录者命名空间**；
  页面加载与渲染路径**仍然零写入**（工装判据：渲染后 `__gmWrites.length === 0`）。详见 **D29**。
- **标签/备注逐仓库可编辑（4.14.0，详见 D29）**：分派唯一入口 = `cardAreas.renderCardTagAndNoteAreas()`；
  三态由 `cardState.ts` 判定（`editable` / `locked-pending` / `locked-empty`）。
  `readonly.ts` 只负责画「不可编辑的样子」，**数据由调用方传入**（宽限期卡片的数据在备份里，
  活区已被清空 —— 渲染器自己读活区就会显示成空）。
  **不挂脚本分页器**（`updateLocalPagers` 不调用），也不挂脚本筛选栏。
- **只藏原生条目**：经 `dom.ts` 的 `hideNativeNode`（打 `GSM_HIDDEN_ATTR`，由 `viewTeardown` 第 5 项还原）；
  **原生分页器、原生筛选栏**（以及`/stars/{login}` 上那个**第二个** `ul.repo-list` = Starred topics 列表）
  **一律不动** —— 翻页是对齐 GitHub 自己那套 `after`/`before` 游标（实测 HTML stars 页 `?page=N` 被忽略），
  脚本自造分页器只会给出无法兑现的页码。
  **必须带 `!important`**：原生条目挂着 Primer utility 类 `col-12 d-block width-full`，而
  `.d-block{display:block!important}` 会压过不带 important 的 inline `display:none` —— 真机实测「30 个条目
  标记与 inline style 全写对、computed 仍是 block」，页面变成「网格在上、原生列表照旧跟在下面」。
  本方自己的页没踩到这条，是因为它用**类 + CSS** 隐藏（`.stars-original-hidden{display:none!important}`）。
- **侧栏头像只缩页主那一张**（4.13.0 真机事故）：布局表里的头像规则**不能**用裸
  `.Layout-sidebar .avatar-user` —— 它会把侧栏里**所有**头像一网打尽，包括 Sponsors 区块里那排小头像
  （真机 mattn 页：13 个 35px 头像被撑成 120px，在 `.d-flex.flex-wrap` 里被迫逐个换行、竖排成一列）。
  现在用 `.avatar-user.width-full`（页主头像带 `width-full`）与 `a[href*="avatars"] img`
  （页主头像的链接指向头像图本身，小头像指向 `/login`）两条，各只命中 1 个元素、互为冗余。
  `persistent.css` 的 transition 同族选择器必须一起改，否则过渡仍落在那排小头像上。
  **真机对照**：同一用户的 Overview 页（脚本不生效）赞助头像也是 35px ⇒ 现在与原生完全一致；
  页主头像 296px → 120px（这是本脚本的既有意图）。
- **不加说明行/提示条**（用户裁定）：曾有一行 `@login 的 star · 本页 N 个 · 只读`，
  用户判定是多余的描述文字 ⇒ 移除。页面标题（GitHub 自己的「Starred repositories」）已经说清这是什么。
- **未登录访客的 stars 页也接管**（用户 2026-10-03 要求「继续兼容未登录的 stars 页」）。原先
  `enterOtherStarsView()` 以 `!getViewerId()` 直接放弃（理由：没有登录者则标签/备注无从归属）——
  那只是**装饰缺省**，不该连网格一起放弃：页面条目是公开渲染的，只读网格本身仍有用。现在的缺省是：
  无徽章（命名空间为空，**不是**读错别人的）、无星按钮（没有「我」也没有凭据 ⇒ `canShowStar` 为假）、
  依旧零网络零写入。真机实测（`body.logged-out`）：**登出页没有 `user-list-menu[data-repository-id]`**
  （30 条 `h3 a` 齐全而它 0 个），所以 `domRepos` 的 `repoId` 多了「退回仓库全名」的兜底，
  而 `li` 路线的仓库特征改用 `a[href$="/stargazers"]`（不能用 `h3 a` 的 href 像不像 `owner/repo`
  —— `/topics/{name}` 也是 `a/b` 形状）。
- **搬 topics 必须认「内容布局」，不能取文档里第一个 `.Layout`**（4.13.0 真机事故：用户报
  「Starred topics 怎么跑 header 上了」）。**登出的 profile 页上有两个 `.Layout.Layout--sidebarPosition-start`**：
  第 0 个是**页头**（左栏头像 + 右栏标签栏，实测 y96 / 高 192 / 不含 stars 内容），第 1 个才是**内容**布局
  （y289 / 高 2320，`#user-starred-repos` 在它里面）。`moveTopicsToRightSidebar()` 原用
  `document.querySelector` ⇒ 把右栏塞进了页头布局（实测 `hasSidebar:true, hasGrid:false`，topics 出现在
  header 区）。现改为 `colLg3.closest('.Layout.Layout--sidebarPosition-start')`（从被搬的那一列往上找，
  必然是内容布局），找不到就**不搬**。配套加固：隐藏原生 `.col-lg-3` 的 CSS 绑上出处标记
  `[data-gsm-topics-src]` ⇒ 语义变成「**搬走了才藏**」，搬不动时原生列照常显示 topics（不会凭空消失）。
  修后真机：右栏 `layoutIndex 1` / x1480（第三栏）/ 与内容同顶，页头布局仍是 2 个子节点未被碰。
- **布局接管只认标记类 `gsm-stars-layout`，不许按骨架类选元素**（用户 2026-10-03 要求「继续兼容未登录的
  stars 页」时暴露的真问题）：profile 页上 `.Layout.Layout--sidebarPosition-start` **可能不止一个** ——
  登出的页面有两个（#0 页头「头像 + 标签栏」、#1 内容布局），而 base/wide/persistent 三张表里的
  `--Layout-sidebar-width: 180px`、`grid-template-columns: 180px 1fr 220px`、`.Layout-sidebar{width:180px}`、
  连带头像与侧栏内部的一堆规则原本都按 `.Layout--sidebarPosition-start` 选元素 ⇒ **页头被一起改写**
  （夹具咬合实测：页头布局被标上标记、`grid-template-columns` 变成我们的轨道，页头头像被
  `.Layout-sidebar a[href*="avatars"] img` 压到 **120px**）。现在：`ensureLayoutStyles()` 调 `markStarsLayout()`（`dom.ts`），标记只打在
  **承载 stars 内容的那个 `.Layout`** 上（`findStarsLayout()` 从 `#user-starred-repos` / 网格 / 原生条目
  往上 `closest`，找不到就不标），CSS 全部改按 `.Layout.gsm-stars-layout` / `.gsm-stars-layout .Layout-sidebar`
  选元素；`removeLayoutStyles()` 同步 `unmarkStarsLayout()`。**`markStarsLayout()` 必须留在
  `!isDesktop()` 早退之后**（首版误插到函数外 = 模块顶层执行 ⇒ 窄视口也留了 class，违反 D18 的零痕迹）。
- **分工：尺寸规则认标记，过渡规则不认**（4.13.0 发布前审查抓到的回归，见 ADR 0009 追加 6）。
  `persistent.css` 里那四条 `transition`（`.Layout--sidebarPosition-start` 的 `grid-template-columns`、
  `.Layout-sidebar` 的 width、页主头像的宽高、状态徽章位置）**故意不带** `gsm-stars-layout` 标记。
  理由：`exitStarsView` 的顺序是 `removeLayoutStyles()` —— 撤尺寸规则（180 → 原生）**并且**摘标记，
  全在**同一个同步任务**里；过渡若也认标记，after-change style 里就没有 transition 声明 ⇒ 回弹不启动、
  尺寸**瞬跳**。夹具 A/B（可观测量 = 「声明了 transition 且实际匹配该元素的规则数」）：认标记时退出后为
  **0**、不认标记时为 **1**；侧栏实测 180 → 1584 一帧完成。反过来，**尺寸规则必须继续认标记** —— 那才是
  「不改写页头布局」的关键。两者看着像同一件事，其实是两个相反的要求，**不要为了「一致」把它们统一**。
  过渡选择器与 4.13.0 之前**逐字相同**（真机实测两代 `?tab=stars` 承载 stars 内容的布局都带
  `Layout--sidebarPosition-start`）。
- **`enterOtherStarsView()` 的幂等早退要顺带补标记**（自愈）：早退在 `ensureLayoutStyles()` **之前**，
  而「接管中途抛错 → `deactivateStars()` 撤表撤标记 → 网格已留在页面上」之后，再进会走早退 ⇒ 永久停在
  「有网格、布局却是 GitHub 原生」的半吊子状态（实测 `marked=0 / cols=none / 侧栏被原生拉到 1263px`）。
- **卡片上的星按钮：建，但状态只认本人缓存**（用户 2026-10-03 要求「卡片上要有 star 按钮」，含两轮修正）。
  状态来源**必须**是本人整表缓存的成员关系 —— 真机实测：他人页**原生**星按钮显示的是**页面主人**的状态
  （`mattn?tab=stars` 30 条全是 `Starred`/`/unstar` 表单，而本人缓存里一条都没有），照抄它等于把
  「对方收藏了」当成「我收藏了」，点一下就会发出 unstar。本人缓存不可用（从未同步）⇒ 退回**不建按钮**（宁缺勿假）。
  两轮用户裁定：① **已 star 的实心星不许再靠 hover 才现身**（旧 CSS 只给 `.unstarred` 写了 `opacity:1`，
  `.starred` 只在卡片 hover 时出现 ⇒ 屏幕上恰恰是「已加星的看不到按钮」）。**该常驻可见被用户明确限定在
  只读网格上**：规则写成 `.stars-grid-container.gsm-other-stars .stars-star-btn.starred{opacity:1}`，
  标记类由 `otherStarsView.ts` 挂在只读网格容器上 ⇒ **本方自己的页保持原观感**（已 star 悬停才现身，
  真机实测自己的页 `opacity:0`、他人页 `1`）。② 本页写入过的结果记进 `viewContext` 的**内存覆盖表**
  （`setViewStarOverride`，`resetViewContext` 时清空），否则一次重渲染就退回未加星外观
  （`markRepoStarred` 只在待删除区有该条目时才恢复，不污染整表缓存是刻意的）。
- **只读备注与自己卡片的备注「同款」**（用户两轮裁定：不要「备注：」前缀、不要左侧竖线）：
  `readonly.ts` 直接给节点挂 `stars-card-notes-text gsm-ro-notes` —— 样式来自自己卡片那一条规则，
  `readonly.css` 里**不再有任何 `.gsm-ro-notes` 声明**。同一个类而非复制声明 ⇒ 两者不可能漂移。
  `.gsm-ro-notes` 只作身份标记（回滚清单与断言按它找人）。
- **原生分页器在标题行右侧也放一份克隆件**（用户要求）：原生那份只在页面**底部**，翻到一半想翻页得先滚到底。
  实现走 `src/topPager.ts` 的 `mountTopPager(scope, source)`（**两条路径共用**：本方自己的页传
  `.gsm-local-pager`，他人页传原生 `.paginate-container`）。克隆件保留原生 href（`after`/`before` 游标），
  点击行为与点底部那份一致 —— 真机实测点顶部「Next」→ 页面 2 的 30 个条目渲染出来、克隆件随帧重渲染
  重新挂上（带上了「Previous」）、**无重复**。**底部那份原样不动**（V5/D6）。
  克隆前会摘掉 `id`（避免页面出现重复 id）；回滚按 `.gsm-top-pager` 删节点、按 `.gsm-header-row` 摘类。
- **克隆件竖向对齐到同一行里的筛选控件（用户要求「把分页器和其他筛选项对齐」）**。成因：新版页面把 GitHub
  自己的筛选栏塞进了标题行，包装节点带 `tmp-mt-3 mb-n1`（上 16px / 下 −4px，**上下不等**）；本行是
  `align-items: center`，flex 对齐的是**外边距盒** ⇒ 包装节点整体下移 (16 − (−4))/2 = **10px**，而没有这些
  外边距的克隆件就比筛选控件高出 10px（真机实测：克隆件 y156 / 筛选控件 y166）。
  处置：把该兄弟节点的**计算外边距原样抄到克隆件的内联样式**上（`getComputedStyle(ref).marginTop/Bottom`），
  两者外边距盒等高同中心 ⇒ 可视盒精确对齐（真机修正后 delta = 0）。**不碰 GitHub 自己的节点**，
  只写我们自有节点的内联样式 ⇒ 回滚随节点一起消失，不需要 data 标记。旧代页面标题行里只有 h2（无筛选栏）
  ⇒ 找不到兄弟节点、保持纯居中，行为不变（真机 mattn 页实测克隆件内联外边距为空）。
- **已知并接受：`.gsm-header-row` 的 flex 会把新代页面的两行并成一行**。新代骨架原生是
  「标题一行 / 筛选栏一行」（实测行高 74、标题占满 1056、筛选栏 y182 另起一行），我们加 flex 后变成
  「标题 + 筛选栏 + 分页器同一行」（行高 64、标题被挤到 166、筛选栏挤到 707）。这是用户要的形态
  （分页器与筛选项同一行且对齐），属方案 A「接管呈现层」的一部分，不是缺陷。
- **呈现层与本方自己的页完全一致**（用户裁定，方案 A）：注入 `base + wide` 两张布局表
  （`src/layoutStyles.ts` 的 `ensureLayoutStyles` / `removeLayoutStyles`，与自己的页共用）⇒ 左栏收窄 180px、
  ≥1200px 三栏、网格满宽多列；并把对方的 **Starred topics 搬进脚本右栏**（原生 `.col-lg-3` 由 CSS 隐藏）。
  搬运/归还实现住在 `dom.ts`（`moveTopicsToRightSidebar` / `restoreTopicsFromRightSidebar`），
  本方页、他人页、`viewTeardown` 第 1 项三处共用。**卡片/网格的样式全在这两张表里** ——
  不注入就只是「一堆没有样式的行」（真机：`display:block`、单列、卡片无描边）。
  `/stars/{login}` 没有 `#user-starred-repos` / `.Layout` ⇒ 搬不动也不搬（topics 留原处，无害）。
- **刻意不套用 `filterState`**：他人页没有脚本筛选栏，若沿用我自己页上残留的筛选条件，网格会莫名变空
  —— 那不是筛选，是看起来坏了。他人页顺序 = 页面条目顺序。
- **不接管的情形**（一律什么都不做）：未登录（无登录者身份 ⇒ 标签/备注无从归属）、
  取不到页面主人、条目数为 0、宿主两条路线都认不出。GitHub 自己的空态/错误态比我们造一个更合适。
- **`exitOtherStarsView()` 负责收干净**（`viewTeardown` 第 11 项 + 往返入口都调它）：抹网格、
  **归还 topics**、撤布局主表、复位来源、恢复语言色请求。归还 topics 必须在**这里**做，不能只靠
  `viewTeardown` 第 1 项 —— `exitOtherStarsViewIfActive()` 在「他人页 → 我自己的页」路径上不经过 teardown。
- **`viewContext` 是模块态，Turbo 换 DOM 冲不掉它** ⇒ 回到自己的页必须复位，否则
  `queryRepos()` 仍读上一次的投影，**把别人的列表画在我自己的页上**（工装 `scenario=roundtrip` 抓到的真实缺陷）。
  复位入口是 `exitOtherStarsViewIfActive()`：**只在处于投影态时**退出（无条件调会顺手删掉我自己页上那张网格）。
- **分派点**：`transformAndReveal()` 的 `!isDesktop()` 早退之后、`ensureStarsSetup()` 之前（先于一切注入）。
  `document-start` 的 `installBootHide()` **只能按 URL 判断**（那时 head 未解析、读不到任何身份 meta），
  所以他人页分支必须自己 `revealAfterTransform(false)` —— 不揭示就是永久白屏（只有 4s 兜底救）。
  他人页**不挂**Sync 按钮、**不显示**配置横幅与归属横幅（那三者属于「我自己的账号」语境）；TM 菜单照常。
- **排查「脚本没反应」**：先看 `.stars-grid-container` 是否存在 + 控制台那条「只读网格 / 未接管（原因）」日志。
  另外注意：该页与你的标签/备注**没有交集**时网格本来就不会有徽章 —— 这是预期，不是缺陷（ADR 0009 局限第 1 条）。
- 完整口径与已知局限：**`docs/adr/0009-other-users-stars-page-readonly-grid.md`**
  （4.12.0 的旧形态见 `docs/adr/0008`，其只读铁律与回滚纪律仍有效）。

**D27 · 标签/备注的隔离账号 = 登录者（4.12.0，修掉既有风险第 16 条）**

- `getStarsUserId()` → **`getStorageUserId()`**，来源从 `octolytics-dimension-user_id`（页面主人）
  改为 `octolytics-actor-id`（登录者）。原实现让**他人的 stars 页**读写那个人的命名空间，是实打实的既存缺陷。
- 本人页上两者数值相等 ⇒ 自有页的键与数据**不变**（无需迁移）；他人页从「读对方」变为「读我的」。
- **取不到身份时读空表、写 no-op + console warn**，**不回落** `stars_tags` / `stars_notes` 无隔离旧键
  （回落会把不属于任何账号的存量数据当成自己的显示出来）。标签那条旧键的迁移已按 **D30**（4.16.0）删除，
  裸键残留无任何读者；备注那条旧键从无迁移路径。
- 连带：`exportImport` 的导出包 `user.id` 与导入归属校验同源改用登录者 id（可观察的行为变化，见 ADR 0008）。
- 「登录者是谁」只有 `pageScope.ts` 一份实现：`accountGuard.ts` 的 `getViewerId` / `getSessionLogin` 已上移到那里复用。

**D28 · 两条与实测不符的旧口径（4.12.0 纠正）**

- `?page=N` 对 **HTML** stars 页**无效**：实测 `page=2/3/9999` 返回的都是第 1 页内容（不是空页），
  真实翻页是 **`after=` / `before=` 游标**。旧文档写的「远端 `?page=N` 越界静默返回空结果」只对 **API** 成立
  （`GET /user/starred?page=9999` → `[]`；但 `per_page×page` 超限是 **422**）。
- `form[action$="/star"]` **不会**误命中 `/unstar`（合成元素 + 真实页面元素双重实测 `false`）；
  真正会误命中的是**去掉斜杠**的写法（`[action*="star"]` / `[action$="star"]`）。
  对本脚本而言这条已不重要：写路径早已改用**精确**匹配 `form[action="/{o}/{r}/star"]`（那条口径继续有效，
  理由从「后缀会误命中」改为「精确匹配更不易随改版漂移」）。
- 另补一条既有文档未收录的新路由：**`/stars/{login}`**（他人的新版 stars 页，200）。
  它**缺** `octolytics-dimension-user_id`、`body` 无 `mine`、`<title>` 形态也不同，
  条目 DOM 与 profile 标签页不一样 ⇒ 任何依赖 `dimension-*` / `mine` / title 的逻辑在该路由上都会失效。
  `/stars`（本人新版页）同样存在；脚本对它**不做任何接管**（结构未支持）。

---

**D29 · 他人 stars 页的标签/备注：逐仓库可编辑（4.14.0）**

> 完整口径与工装证据见 **`docs/adr/0009`「追加 7」**；这里只留最容易踩的硬口径。

- **要解决的问题**：4.13.0 的「只读」是**页级单一布尔**（`isReadOnlyView()` = `otherPage !== null`），
  而分派写了**两处**：`filters.renderBrowsePage`（有判据）与 `starCheck.syncCardAfterStarChange`
  （**无条件**调 `renderTags`/`renderNotes`）。后者在「卡片星按钮点击成功」的回调链上 ⇒
  **点一下 star，这张卡（乃至整页后续重绘）就变成可编辑**。用户报的正是这个。
- **三态逐仓库判定**（`src/cardState.ts`，纯判定：不碰 DOM / 不发请求 / 不写存储）：
  | 状态 | 判据 | 数据来源 | 控件 |
  |---|---|---|---|
  | `editable` | 本人 star 了它 | 活区 | 有 |
  | `locked-pending` | 不在缓存，但在 `stars_pending_delete` 里且**未超 24h** | **宽限期备份** | 无（数据仍显示） |
  | `locked-empty` | 两者都不是 | 活区（多半为空） | 无 |
- **唯一分派入口** = `src/cardAreas.ts` 的 `renderCardTagAndNoteAreas(card, view, viewerCache)`。
  `filters` 与 `starCheck` 两处都只走它。**禁止**再写出第二处 `readOnly ? A : B`。
- **可编辑性只认「已提交」状态**：`getViewStarOverride()`（内存覆盖表，只在本页写入**成功**后写）
  → 本人整表缓存成员关系。**不读**按钮 DOM class、**不读**在途请求 —— 否则写失败回滚后会留下
  「星星已回退、标签却已改过」的不一致。
- **前置条件 = `hasApiData() && getViewerId()`**（与 `canShowStar` 同源、是它的子集）。
  缺任一项 ⇒ **全部卡片不可编辑**（仍只读显示）。**宁缺勿假**，不猜。
- **`readonly.ts` 的渲染器改为接受调用方传入的数据**：宽限期卡片的标签/备注在**备份**里，
  活区已被 `markRepoUnstarred` 清空。渲染器自己读活区就会把这些卡片显示成空
  —— 那正是「unstar 后标签立刻消失」的成因。取数在 `cardState.readCardDisplayData()`
  （**活区优先，活区为空再看备份**）。
- **宽限期判据渲染时现算**（`pendingDelete.getPendingInGrace`）：不依赖 `cleanupExpiredUnstarred()`
  是否跑过（它只在 `init()` 与导入后各跑一次；开了 24h 以上的标签页里过期条目还挂在存储里）。
- **`markRepoUnstarred(repoId, seed?)` 的判据 = 「有东西要保全就必须建备份」**（缓存有 / 给了 `seed` /
  有非空标签备注，三者占一）。旧判据只认缓存 ⇒ 他人页「点 star（只在内存覆盖里）→ 加标签 → unstar」
  这条顺序下**不备份也不清空**，标签会永久留在活区而只读卡片没有删除入口（用户再也清不掉）。
  连带的正确行为变化：那条路径 unstar 后若 re-star，该仓库会**进入本人整表缓存**（此刻我确实 star 了它）。
- **`hasApiData` 已从 `fullSync.ts` 迁到 `storage/repoCache.ts`**（`fullSync` 以同名 re-export 转发，
  调用方不变）：`cardState` 不依赖 `fullSync`，否则会形成
  `cardState → fullSync → starCheck → cardAreas → cardState` 的导入环。
- **`applyFilters()` 补了 `isReadOnlyView()` 早退门**：`filterState` 是**跨页共享模块态**
  （进他人页不清、离开也不清），而 `starCheck` 会在「有 active 筛选」时调它 ⇒「在自己页筛过标签 →
  Turbo 切到别人的 stars 页 → 在卡片上点 star」会往**页面主人**的原生筛选行插脚本控件、
  把原生三个菜单设成 `display:none`。此前唯一的防护是「他人页入口刻意直调 `renderBrowsePage`
  绕过 `applyFilters`」，属实现约定而非不变量。
- **他人页点标签不切换筛选**：`renderTags(container, { filterToggle })`，默认 `true`（自有页**逐字不变**）；
  他人页传 `false` ⇒ 不绑筛选点击、不加 `stars-tag-active`、保存后不调 `applyFilters`/`refreshTagPillStates`。
  `ui/notes.ts` 无需改动（其编辑路径本就不依赖 `applyFilters`）。
- **观感与 a11y 的四处「不做」**（都有证据，见 ADR 追加 7）：① 只读卡片**不渲染**任何编辑控件
  （不建 `aria-disabled` 灰按钮、不建只读输入框）；② **不加** `role="textbox"` + `aria-readonly`、
  **不加** `inert`（`aria-readonly` 只对 9 个 widget role 有效，把「标签 + 备注」包进 textbox 是错误语义）；
  ③ **不加**可见说明行 / 徽章（唯一提示是只读节点的原生 `title`，按状态分叉）；④ **不做**主动播报
  （无 WCAG 条款要求「控件消失必须播报」；4.1.3 只约束**已经存在**的状态消息）。
- **一条状态驱动的样式**：不可编辑卡片的备注区 `cursor: default`（在 **`base.css`**，不在按需注入的
  `readonly.css` —— 「卡片上什么都没有」的 `locked-empty` 也需要它）。选择器认
  `[data-gsm-card-state='locked-*']`；属性**两态都写、两个视图都写**（4.14.0 起他人页、**4.16.2 起本人页**，
  见 **D31**）⇒ 本人页取消 star 后那张卡片也命中本规则。属性随卡片节点销毁，不进回滚清单。
- **焦点回收**：分派函数在重绘前记 `card.contains(document.activeElement)`，为真则把焦点交还该卡片的
  星按钮（无按钮时交给卡片自身 + `tabindex="-1"`）。常见路径（点星按钮）本就不丢焦点；这条兜的是
  「后台同步判定外部取关时，用户正聚焦在本卡片的标签输入框 / 备注 textarea 上」——浏览器实测
  移除焦点元素会一律回退 `<body>`。
- **发布前独立审查轮**（外部 reviewer，只读复核 + 自建复现实验）抓到 **1 P1 + 4 P2**，
  P1 与两条 P2 已修，另两条登记为观察项。完整证据见 `docs/adr/0009`「追加 7 的发布前独立审查轮」。
  - **P1（已修）：只读卡片点一下仍能弹出备注编辑器并写盘。** 备注的编辑入口是挂在**容器本身**上的
    click 监听，而容器在重绘间**复用**（`innerHTML = ''` 摘不掉它）⇒ 从可编辑切到只读后，
    「只读」卡片点一下照样弹 `textarea`、blur 后真的落盘，随后又被只读渲染覆盖（输入被静默吞掉）。
    修法：`ui/notes.ts` 导出 `disposeNotesEditor()`（`WeakMap` 记住那枚监听），
    `cardAreas` 在**唯一分派点**上、不管哪个分支都先摘。**标签那一路没有这个问题** ——
    `ui/tagFilter.renderTags` 的监听都挂在子节点上，随 `innerHTML = ''` 一起销毁。
    **教训**：既有断言 `R16_betaLockedControlsAfterUnstar` / `R21_betaLockedControlCount` 都是
    **静态快照**（「此刻没有控件」），而缺陷只在**点了之后**才显现 ⇒ 新增**动态**断言组 `R25`
    （点只读卡片的备注区：编辑器 0、控件 0、文本仍在、写入 0；**对照组**点可编辑卡片必须进编辑态）
    与 `R27`（自己的页「点开 → 输入 → blur 提交」仍然落盘）。
  - **P2（已修）：登出页显示了 `stars_pending_delete` 里的私密数据。** 那个键是**单份全局键**、
    不按账号分片（与 D27 的命名空间键不同），属于**上一个登录的人**。修法：`cardState.hasViewerIdentity()`
    作唯一身份判据，没有它时既不判 `locked-pending`、也不读备份。**A/B 实证**（场景 `other-logout-pending`）：
    修复后 `leaksTags/leaksNote=false`、`roBadges=0`；钳合（身份判据恒真）下是 `true/true`、`roBadges=2`。
  - **P2（已修）：`isStarredByViewer` 有两份实现**（`filters.ts` 内联 + `cardState.ts`）——
    「两处各判一次」正是本次要修的缺陷模式。现在 `filters` 直接 import `cardState` 的版本，
    `canShowStar` 也改为由 `loadViewerCacheForView()` 派生。
  - **P2（登记，未修）**：逐卡约 5 次 `GM_getValue`（30 条约 150+ 次同步 IPC）。真要省得给存储层加
    「读缓存 + 写失效」，会改动全脚本共用的新鲜度语义 ⇒ 与本版本主题无关，登记待立项。
  - **P2（登记，未修）**：他人页上 **D12 的「同步后立即重渲染」不生效**（`rerenderAfterSync` 走
    `applyFilters`，被只读门挡住）。这是净收益，但 D12 的措辞是全局的 ⇒
    **D12 只适用于本方自己的 stars 页**；他人页刷新的路径是重新投影原生条目，不由同步驱动。
- **验收状态**：静态全绿（`pnpm check` / `verify-css` EXIT 0 / `test:exportimport` **全过（项数以实际输出为准）** /
  `@grant` 恰 5 项）；夹具 18 组场景（窄视口另跑 `#narrow` **1 组**）全跑过（场景数以 `.diag/gen-otherstars-harness.cjs`
  的 `scenario ===` 分支为准）；`__errors` 全空、他人页 `fetch`/`writes` 为 0、窄视口 `grid=0` 且 `gsm` 节点 0。新增场景：
  `other-editstate`（同一页 `editable` + `locked-pending` 并存）、`other-pending-expired`
  （超 24h ⇒ 不再显示）、`other-nocache-edit`（无缓存 ⇒ 全只读）、
  `other-logout-pending`（登出 + 备份里有私密数据 ⇒ 一个字符都不许出现）、
  `own-deadfields`（4.16.0：读路径纯读 —— 有死字段也不写盘、字段原样保留；R28 已做 A/B 反证）。
---

**D30 · 版本迁移代码已整批删除（4.16.0）**

- **前提（用户 2026-10-04 裁定）**：本脚本处于**开发阶段，不存在任何已有用户** ⇒「更早的构建可能在磁盘上
  留下旧形态数据」不再是需要承担的成本。**这不是「以后也不许有迁移」** —— 真发布后若需要，按下面的判据重新立项。
- **判定边界（唯一判据）**：in-scope = 其**唯一存在理由**是「本脚本更早的构建可能留下旧形态数据」的代码。
  **out-of-scope（一律不要往这里归类）**：环境兼容（GM 缺席↔可用）、**GitHub 页面代际兼容**（多代骨架同时在线）、
  本页会话的 DOM 回滚、活功能与缓存。
- **迁移专用删除判据**（比 D21 那条更具体，专治这类代码）：① 已经**没有写入者**再写旧形态；② 触发的唯一后果是
  「dev 自己的存储里留下**无读者**的惰性数据」；③ 残留数据对功能零影响；④ **零测试覆盖** ⇒ 删除是静默的，
  **必须在原地留墓碑注释 + 在本文件记账**（否则下次没人知道它曾经存在过）。
- **删掉的**（每处源码里都留了「曾用过什么 / 何时删 / 为何删」注释）：
  - `migrateTagsIfNeeded()` + `STORAGE_KEYS.legacyTags`（裸键 `stars_tags`）—— 自 4.13.0 起无写入者。
  - `isPlausibleLangName` / `DEAD_REPO_FIELDS` / `loadRepoCache` 的清洗与**写回** —— 顺带修掉一处真实误删：
    该正则的字符类不含 `*`，而 linguist 的 `F*` 与 `Pro*C` 是合法顶层语言名；且它只在读路径、
    从不在写路径，从来不是防御。**收益的形状：`loadRepoCache()` 现在是纯读，读函数不再写存储。**
  - `DATA_REV` / `FullSyncMeta.dataRev` 阀门 + `typeFlagsComplete` 阀门 —— 删除依据有两层，**别把第二层说成第一层**：
    ① **（决定性）** 本前提「开发阶段 / 无已有用户」：阀门唯一能修的是「由 ≤4.7.x 构建写入的缓存」
    （`dataRev` 生于 4.8.0 且初值就是 2 ⇒ 更早的缓存没有该字段，`undefined !== 2` 恒真、阀门必触发）。
    ② **（辅助，不足以单独成立）** 48h TTL：`baselineOk` 要求 `lastFullSyncAt` 在 `FULL_SYNC_TTL_MS` 内，
    所以**超过 48h** 的旧缓存本来就无条件整表。
    ⚠️ **48h 这条并不足以证明不可达**（4.16.0 发布前审查纠正）：一个「48h 前由 ≤4.7.x 写入」的缓存
    会同时满足 `baselineOk` 与阀门条件 ⇒ 阀门确实可达。真正堵住这个窗口的是 ①，以及「改过脚本头必须
    重装 dev loader」这条机制。**下次若在没有 ① 的前提下看到类似阀门，不要引用这段来删它。**
    另有一条独立事实：导入路径**从不写** `stars_full_sync_meta`，所以阀门连导入进来的旧语义数据都看不见
    （其覆盖本就不完整）。顺带消掉新装用户会看到的一条不成立日志（新装时 `meta.dataRev` 为 `undefined`，
    原会报「缓存代次旧（updatedAt 语义=updated_at）」）。
- **刻意保留的**（都写进了当时那轮方案的拒绝清单，别重开）：
  - `gm.ts` 的 **localStorage → GM 回写**：服务**环境转移**而非版本迁移，且「GM 一时全部缺席」是
    **被本文档记录、且会反复发生**的失败模式（改过脚本头 → dev loader 的 key 对不上）。
    **删它会造出真实的静默丢数据链**：GM 缺席期写入的数据只在镜像 → GM 恢复后 `gmGet` 返回默认值
    （该分支是唯一的桥）→ 下一次 `saveTags` 先读到 `{}` 再写盘 ⇒ **覆盖该窗口内全部标签**。
  - `SENSITIVE_KEYS` 的**永久拒镜像**半（安全不变量）；其中的「清历史镜像残留」半属遗留代码但保留
    （不值得为省 8 行把一个活凭证永久留在代码声明「禁入」的命名空间）。
  - `starCheck` 的 pending+cache 自愈：守的是**当前构建内**两个存储区的一致性，不是跨构建迁移。
- **不涉及数据格式**：`EXPORT_SCHEMA_VERSION` 仍为 1、导出包字段集不变、导入校验不变 ⇒ 回滚无需数据迁移。
  **副产品**：读路径不再清洗 ⇒ 异源包里的多余字段会**原样保留**（无读者、不报错、`lang` 渲染走
  `escapeHtml` + 颜色回落常量，故无 XSS）。
- **残留（可接受）**：dev 自己的 TM 存储里可能留下无读者的 `stars_tags`，以及缓存里的 `updated`/`langColor`/`ts`。
  想清干净就在 TM 里清一次本脚本的存储 —— **不要**为此加 `GM_deleteValue`（那会把用户可见的授权清单从 5 项涨回 6 项）。
- **新增的动态守卫**：夹具场景 `own-deadfields`（R28）锁住「读路径不写存储」——预置三个死字段后断言
  `__gmWrites` 里没有 `stars_repo_cache`、且三字段原样保留。**已做 A/B 验证该断言不是空转**：把清洗加回去时
  它确实变红（`cacheWrites=['stars_repo_cache']` / `fieldsKept=[]`）。改夹具或动 `loadRepoCache` 时跑它。
- **发布前独立审查轮（三名审查员并行，覆盖 4.15 Tier A/B + 4.16 迁移 + 跨批次/测试/文档）**：
  - **抓到 1 个真缺陷（已修）**：读期清洗曾**顺带**挡住一部分非字符串 `lang`（对象的字符串化含 `[`，
    不合其字符类 ⇒ 被剔），删掉后**导入一枚 `lang` 为对象/数字/布尔的包 ⇒ `getLangColor` 对 `lang?.trim()`
    抛 TypeError ⇒ 整页转换中断，表现是「网格容器建好、原生条目已隐藏、0 张卡片」的空网格**（不是少显示一块）。
    修法**不是把清洗搬回来**，而是在信任边界补一行类型校验（`exportImport.validateRepoCache`：
    `lang` 必须字符串或缺省）+ 4 条断言。**注意这条老守卫本来也不完整**：`RegExp.test(123)` 会强转成 `"123"`
    并匹配 ⇒ 数字/布尔**一直**是放行的（即该崩溃类别早于 4.16 就存在，4.16 只是又开了对象的那个口子）。
    其余字段都不抛（`escapeHtml` 走 `textContent` 强转、`Number()`、`Date.parse` 都宽容）——**只有 `lang` 是这一类**。
  - **纠正了一处我自己写的过度论证（重要教训）**：原墓碑写「两阀门经证明不可达（48h TTL）」，但阀门写在
    `if (!baselineOk)` **之前**、不受 TTL 约束，且 `typeFlagsComplete` **有一个活的缺标志写入者**（4.14.0 起：
    他人页 unstar 把 DOM 投影当 seed 存进宽限期备份，re-star 再把该条目写进整表缓存，而投影不产出四标志）。
    **决定性依据是「开发阶段 / 无已有用户」这一前提，不是 TTL**；那条路径之所以仍可删，是因为它**必然自愈**
    （re-star 必使该仓库落到列表首位 ⇒ 首页 ETag 变 ⇒ 下次同步必进 freshIds ⇒ branch C 写回四标志），
    且阀门从未保护过「re-star 到下次同步之间」那个窗口（筛选器读缓存，不读同步结果）。
    **不要在没有「无已有用户」前提时引用这段来删同类阀门。**
  - 文档修正 6 处：场景数自相矛盾（`16` vs `17`）、D21「保留的 6 类」实为 5、D30 的过度论证、
    `DEVELOPER.md` 的「换血路径 = 48h TTL」（实为**三条** `baselineOk` 失败条件）、4 处失效源码注释
    （`cardState.ts` 称 `loadRepoCache` 会「遍历全表并回写」、`index.ts` 三处「迁移」）、
    漏掉的第 5 个夹具生成器 `gen-readonly-harness.cjs` 的 `dataRev` 种子。
  - **顺手拔掉一个地雷**：`.diag/gen-lang-colors.cjs` 会 `fs.writeFileSync('src/langColors.ts', …)`
    且其模板还是 per-repo `langColor` 时代的 `getLangColor(lang, stored?)` —— **跑一次就把活实现覆盖掉**。
    它零引用、且其语义随 `DEAD_REPO_FIELDS` 删除彻底作废 ⇒ 已删除（`src/langColors.ts` 里对它的引用同步改写）。
  - **沿用既有约定抑制计数漂移**：`test:exportimport` 的项数**不再写死数字**（写「以实际输出为准」）——
    同 D18/D19 对 `isDesktop()` 的处置（「以 `grep` 为准，不要在此维护数量」）。本次就实际踩到：
    47 → 补 4 条守卫后变 51，写死的数字两次都过时。
- **决策过程与逐条证据**：`docs/plans/archive/2026/2026-10-04-将此脚本作为开发阶段-无任何已有用户来处理-清理其中冗余的迁移代码.md`。

**D31 · 本人 stars 页的只读显示 = 二态（4.16.2）**

- **要解决的问题**：本人页 unstar 后标签/备注**直接消失**（他人页同场景正常）。根因是 `own` 分支无条件走
  可编辑渲染器（只读活区），而 unstar 已把数据搬进 `stars_pending_delete` 并清空活区 —— 数据还在，只是没人去取。
- **判定只有一处**：`src/cardState.ts`。两个入口共用一份取数：
  `getCardState(repoId, viewerCache)` = 他人页三态（4.14.0 原样）；`getOwnPageCardState(repoId)` = 本人页**二态**（新）。
  `readCardDisplayData(repoId, state, now)` 改为**接受已算好的 state**、只负责取数（活区优先；活区为空**且**
  state 为 `locked-*` 才读备份）。**禁止**再出现第二处判据 —— `filters.renderBrowsePage` / `starCheck` 两处
  调用点只传视图，不进判定。
- **本人页为什么不用「三态」**（即不引入 `locked-empty`）：① 那一支要拿整表缓存判成员关系，链路依赖
  **无官方契约**的页面 meta `octolytics-actor-id`（风险 13 的 `csrf-token` 前例）—— 失效会让**整页**失去
  编辑能力，代价远大于本缺陷；② 本人页卡片只来自本人整表缓存，unstar 时该仓库已被移出 ⇒
  「没 star 却有标签」的卡片**从不进入网格**，造只读态是空转（用户 2026-10-05 亦确认「那应该不显示才对」）。
- **行为不变式**：`editable` 时活区为空就返回空，**不许**读备份 —— 否则一条陈旧 pending 条目会让本人页
  凭空显示不属于它的数据。
- **只读形态零新增**：复用 `readonly.ts` 两个渲染器 + `CARDS_TITLE_PENDING` 文案；不加可见提示、不加控件、
  不加恢复按钮（恢复入口是卡片上那个未加星外观的星按钮）；`disposeNotesEditor()` 照旧先摘（容器复用，
  `innerHTML=''` 摘不掉备注监听 —— D29 的 P1）。
- **`data-gsm-card-state` 现在两态都写、本人页也写**（4.16.0/4.14.0 起他人页本就两态都写）⇒ `base.css` 的
  `cursor: default` 在本人页自动生效。**本次自查抓到并修掉的一处回归**：重写时把它挪进了只读分支
  ⇒ 他人页可编辑卡片不再写该属性（`R2_editableCards` 0、`R16_betaAreaAfterStar` `null`），已改回两态都写。
- **只读态是「临时显示态」**（用户 2026-10-05 确认）：`markRepoUnstarred` 已把该仓库移出整表缓存 ⇒
  下一次**整页重绘**（激活筛选下的同步、翻页、导入后重绘）它就不再出现在网格里。**不**把宽限期条目注入
  `queryRepos()` 结果（那会让「已 unstar 的仓库继续出现在我的列表里」，且要给查询管线加第三条半来源）。
- **导入路径**（**4.17.0 已改，取代本节原先的「导入路径不动」口径**）：导入按「本地确认已 star」逐仓库分派 ——
  在缓存里 ⇒ 写活区；**不在 ⇒ 进 24h 宽限期**（用户 2026-10-05 明确要求；两者皆空且无旧条目则不建条目）。
  ⇒ 原先「导入的标签留在活区、不渲染、无 UI 入口」那条现状**不再成立**；代价是这些标签进入 24h 倒计时
  （提示里写死补救窗口与「同步到已 star 即自动恢复」）。见 **D32** 与 `docs/adr/0001` 的「4.17.0 修订」段。
- **两条已知局限**：① `stars_pending_delete` 是全局单键且不记归属 ⇒ **多账号**浏览器下本人页可能读到上一个
  账号的备份（登出不受影响）—— **风险 21，下一轮修**；② ~~导入造成「缓存与 pending 并存」时点一次星会抹掉备份~~
   —— **4.17.0 已消除**（见风险 22）。
- **验证**：夹具场景 `own-unstar` + 断言组 **R29**（`.diag/assert-otherstars.js`），跑法见该文件头注释；
  A/B 反证表与逐条观测量见 `docs/adr/0009`「追加 8」。18 个场景重跑 `__errors` 全空，窄视口 `R10_*` 仍全 0。
- **夹具保真度边界（已知局限）**：`own-unstar` 是**直接种存储**模拟终态，覆盖渲染分派而**不驱动**
  真实点击链（点星 → 写请求 → `markRepoUnstarred` → own 分派）。那条链的结论是**代码层读出来的**，
  故真机确认不可省。另：**改完 `.diag/gen-*` 后先用探针确认夹具活着**（夹具不生效的表现是「断言全绿」；
  本次审查员用「加载 `scenario=own` 后改写 `__gsmScenario='own-unstar'` 再跑」做了独立空转反证，
  R29 有 8 条观测量变红 ⇒ 非空转）。

**D32 · 导入导出改版：风险 22 由「消除前提」修复（4.17.0）**

- **导出包只剩 `tags` + `notes` + `repoNames`**（`data.repoCache` 移除；类型转**可选**以兼容旧包）。
  `EXPORT_SCHEMA_VERSION` **仍为 1**：旧包的 `repoCache` **照旧校验、内容一律忽略**（绝不写入缓存）。
  论据与 Considered Options 的推翻见 `docs/adr/0001` 的「4.17.0 修订」。
- **导入 = 逐仓库分派**（唯一实现 `applyImportPackage()`；纯逻辑层**不触发同步** —— D9 分层铁律）。
  判据 = **`stars_repo_cache` 的成员关系**（在 ⇒ 写活区；`if (!localCache[repoId])` ⇒ 24h 宽限期）。
  **胜负规则两条去向相同**（见 D9）：包内该字段**归一化后**非空 ⇒ 覆盖；为空 / 缺省 ⇒ 保留。
- **无整表缓存时由 UI 层先同步一次**（`ui/exportImportMenu.ts`；`runFullSync` **签名未改**，只是**新增一个调用点**
  —— D23 的「五个调用点」按「签名不变、允许为新增流程加入口」读）；同步失败 / 被并发丢弃 ⇒ 按「未确认」进宽限期。
  ⇒ **部分推翻 `docs/adr/0005`**（已追加、未改写）。
- **`addPendingFromImport(repoId, tags, note, name)`** = 宽限期入口：与活区**同一条胜负规则**、
  **不重置** `unstarredAt`（不用导入给备份续命）、**超期条目按「不存在」处理**（否则合并出的条目「出生即超期」）。
  `markRepoUnstarred` / `markRepoStarred` / `confirmExternalUnstar` **本次一行未动**。
- **风险 22 因此消除**：导入不再写 `stars_repo_cache` **且**分派以缓存成员关系为唯一判据 ⇒「缓存与宽限期并存」
  不可能由导入产生 ⇒「用空活区覆盖非空备份」那支**不再可达**（**刻意不修**破坏点，写了就是死代码）。
  ⚠️ **判据不许再带上 `hasApiData()`** —— 首版这么写，审查员最小复现跑出并存态与数据丢失（`markRepoStarred`
  只写缓存、不写 meta，两者可背离）。**教训：证明「某状态不可达」必须穷举它的构造者**，不是列举已知正常流程。
  回归锁 = `tests/exportImport/run.cjs` 的 `[12]`；`cacheAvailable` 因此只是**展示标志**，**不参与分派**。
- **`data.repoNames`**（`owner/repo`）是「恢复」这个写请求的**目标地址**，不是展示数据：**查不到就不写**（不编造）、
  **绝不写进 `stars_repo_cache`**（会把风险 22 的前提造回来，有断言钉住）、只写宽限期条目的 `name`、**空不覆盖非空**。
  仍不可恢复的两种情形：导出方本地也查不到名字 / 导入的是旧包（无 `repoNames`）⇒ 报「仓库名缺失」，
  下一次成功同步（`fullSync` 分支 B 的 `saveRepoData`）补齐后即可恢复。
- **宽限期出口是既有行为**（无需新代码）：`fullSync` **分支 B**（远端有、本地无）调 `markRepoStarred()`
  （标签回活区 + 条目写回缓存 + 删 pending），紧跟 `saveRepoData(patch)` 用**远端**元数据补齐。
- **提示口径**：报告「本地不存在 x 个仓库，其标签/备注已放入 24h 宽限期」（与代码同字）；无缓存 / 同步失败分支
  **写死**「请在 24 小时内完成一次同步，否则它们的标签/备注会被删除」。
- **验证**：`pnpm test:exportimport` 以实际输出为准（**别写死数字**）；A/B 反证 ≈7 轮（禁用分派 / 恢复写缓存 /
  判据带 `hasApiData()` / `buildRepoNames` 恒空 / 不传名字 / 名字写进缓存，各自变红）；夹具 `*_errors` 全空、基线键未变。
  逐条过程见 `docs/plans/archive/2026/` 的归档方案 §7–§9 与 gbrain `people/me`。

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
- **隐藏标签页会把过渡冻在起点值**（4.13.0 又踩一次，两次都误判成「布局没生效」）：JS 挂
  `gsm-anim-prepare` 起手一帧后撤掉，那条 `grid-template-columns` 过渡在**后台标签页里 `currentTime` 恒为 0**
  （实测 `getAnimations()` = 一条 running 的 CSSTransition，`time: 0`）⇒ `computedStyle` 报的是**起点值**
  296px，而目标值其实是 180px。量测前先 `document.getAnimations().forEach(a => { try { a.finish(); } catch {} })`
  把动画一次性推到目标值，再读 computed —— 这样**在后台标签页也能拿到真实值**（`Page.bringToFront` 未必能抢回焦点）。
- **`agent-browser-cli` 的 `open` / `exec` 返回值里的 `tab_id` 字段不可信**（4.13.0 踩了两次，第二次真的改坏了
  用户的标签页）：它反映的是**会话态**而不是「本次实际执行/新开的那个标签」。按它去 `Page.navigate` 会导航到
  别的标签（我因此两次把用户正在用的 `happycoding.xyz` 标签导到 `?tab=repositories`，只能用 `open` 重新打开、
  丢失原状态）。正确做法：**只用 `agent-browser-cli tabs` 列表按 URL 找 id**；注意 `tabs` 会把 URL
  **截断到约 65 字符**，所以匹配要用靠前的片段（如 `.diag/`），别用文件名。
- **夹具伪造 matchMedia，但真实 CSS 媒体查询看的是 `innerWidth`**（4.13.0 的 A/B 被它骗过一次）：夹具的
  `matchMedia('(min-width: 768px)')` 返回伪造值（JS 以为桌面），而 `@media` 看真实宽度 ⇒ 易出现
  「JS 注入了样式表、CSS 却不生效」的假象。**量测带媒体查询的 CSS 前先确认 `window.innerWidth`**，
  且 `Emulation.setDeviceMetricsOverride` 可能在 `Page.navigate` 后丢失（要重新设并回读）。
  更稳的做法：挑**与视口无关**的观测量（例如 `el.matches(selector)` 数「哪些规则声明了 transition」，
  忽略媒体查询是否生效），夹具场景因此不受窗口宽度影响。
- **读 `computedStyle` 前要等过渡结束**：按钮上挂着 `80ms` 的 transition，同步读取会拿到**起点值**，
  极易误判成「hover 监听没生效」。等 ~250ms 再读（实测 rest→hover→active→hover→rest 五态可完整复现）。
- **`visibilityState` 会自己掉回 hidden**：`Page.bringToFront` 之后页面可能又变 hidden（rAF/scroll/定时器全停）。
  可靠写法是 `{"method":"Page.bringToFront","params":{},"allowFocus":true}`，并在每次量测前回读 `document.visibilityState`。
- **冻结标签页会返回过期的 `computedStyle`（4.13.0 踩过，代价是一次错误结论）**：后台标签页里布局从不重算，
  `getComputedStyle` 给的是**最后一次渲染时**的值。判据很硬：**「连 inline `!important` 都改不动 computed 值」
  = 这不是 CSS 问题，是标签页被冻结了**（inline important 在任何活着的文档里都必胜）。
  当时据此误判「注入的布局样式不生效」，而同一 URL 在可见标签页上是另一套数值（单列 296px ↔ 三列 180px）。
  `Page.bringToFront` + `allowFocus` 与 `Page.setWebLifecycleState('active')` **都不保证**变 visible
  （窗口本身没焦点时仍是 hidden）—— 可靠做法是 `agent-browser-cli open --focus <url>` 新开一个标签页，
  **先回读 `document.visibilityState === 'visible'` 再量测**。
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
| stars 列表项 | `col-12…py-4.border-bottom` | `…tmp-py-4.border-bottom.color-border-muted`。**类里有 `d-block`** ⇒ `.d-block{display:block!important}` 会压过不带 important 的 inline `display:none`（逐条隐藏时必须 `setProperty(...,'important')`） |
| repoId | `data-toggle-for` / `details-user-list-<id>` | `user-list-menu[data-repository-id]` |
| 原生筛选栏 | `.TableObject.border-bottom` + `mt-5` | flex 行 + `tmp-mt-5`，锚点 `#stars-language-filter-menu-button` |
| 详情页 | `.BorderGrid` / `#repo-stars-counter-star` / `.starred form[action$="/unstar"]` | React + CSS-module；star 按钮 `button[data-testid="star-button"]`，状态在 `aria-label`（4.9.0 起脚本**完全不碰详情页** —— 监听与读取器都已删，决策 D17） |
| 搜索框 | `input[name=q]`、`form[action$="tab=stars"]` | **未变**，原拦截逻辑仍有效 |
| Lists 标题行 | `.my-3…` + 内联隐藏即可 | `tmp-my-3…`，且 `.d-flex` 的 `!important` 压过内联 `display:none`，必须 `element.style.setProperty('display','none','important')` |
| 网页写端点表单 | `form[action$="/star"\|"/unstar"]`（后缀选择器） | 仍是**精确**匹配 `form[action="/{o}/{r}/star"]`，但理由变了：2026-10-03 实测**推翻**「`action$="/star"` 会被 `/unstar` 命中」（合成元素 + 真实元素均 `false`；真正会误命中的是去掉斜杠的 `[action*="star"]`）。保留精确匹配是因为它更不易随改版漂移 |
| 他人页星标状态 | —— | **`div.starring-container` 是否有 `on` 类**（服务端渲染；实测 127 条目零假阳零假阴）。`aria-label` / 按钮文字 / `octicon-star-fill` / `/star`、`/unstar` 表单**都不能**判状态（每条目两表单永远并存 30/30，靠 CSS 显隐）。登出时一个开关都不渲染 ⇒ 只能判 unknown |
| stars 页骨架（**两代并存**） | —— | 旧代 `#user-starred-repos > .col-lg-9` + `.col-lg-3`，标题「Starred repositories」，搜索框「Search starred repositories」；新代 `#user-starred-repos > .col-lg-12`（**无 topics 列**），标题「Stars」，搜索框「Search stars」。**同一个 `?tab=stars` URL 随账号返回不同代际**（实测 mattn=旧、Kuddev=新）⇒ 选择器必须有退路（`getStarsMainColumn()` 找不到 `.col-lg-9` 就退到 frame/`main`） |
| 条目内部四块 | （此前只解析标题） | **两条路由的条目内部完全相同**：`div.d-inline-block.mb-1`（标题 `h3 a[href]`）/ `div.float-right.d-flex`（操作）/ `div.py-1`（描述 `p`，可为空）/ `div.f6.color-fg-muted.mt-2`（元信息：`[itemprop=programmingLanguage]`、`a[href$="/stargazers"]`、`a[href$="/forks"]`、`relative-time[datetime]`）。计数文本**含千分位逗号**；元信息块必须按**直接子节点**取（条目内的 Lists 浮层里也有 `div.f6`） |
| 条目「时间」语义 | —— | **同一位置两条路由语义不同**：`?tab=stars` 是 `Updated`（→ `updatedAt`）、`/stars/{login}` 是 `Starred`（→ `starredAt`）。要读 `relative-time` **前一个文本节点**的标签来分派，不能一律塞 `updatedAt` |
| stars 页 URL 形态 | 只有 `/{login}?tab=stars` | 另有 **`/stars`**（本人新版页）与 **`/stars/{login}`**（他人新版页，200）。后者**缺** `octolytics-dimension-user_id`、无 `body.mine`，条目 DOM 也不同；`/{login}/stars` 是 404。另：`?page=N` 在 HTML 页被**忽略**（返回第 1 页），真实翻页是 `after=`/`before=` 游标 |

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
13. **归属校验依赖**无官方契约**的页面 meta**（`octolytics-actor-id` / `user-login`）：一旦被改名或移除，本功能**静默失效**
   （判 `unknown`、不弹任何东西，其余行为不变——这是有意的降级方向）。同类前例：`meta[name="csrf-token"]` 曾在 github.com 上
   普遍存在，如今已完全消失。真机复查手法：只读探针枚举 `document.querySelectorAll('meta')` 看字段是否还在。
   普遍存在，如今已完全消失。真机复查手法：只读探针枚举 `document.querySelectorAll('meta')` 看该字段是否还在。
14. **「无 token + 有登录会话」组合不做归属校验**（V5 有意收窄）：该组合下网格缓存可能来自上一个账号（`hasApiData()` 与
   账号无关 = D6），但 `stars_full_sync_meta` **不记录账号归属**，要先加字段才能可靠告警，属独立改动。
15. **GHES / SAML SSO 下页面身份 meta 行为未确证**（GitHub Docs 全站含各 GHES 版本、`github/docs` 抽查、相关 issue 与
   userscript 社群均无权威来源）：届时本功能可能完全失效，但仍为 `unknown`（不误报）。
16. ~~**非本人 stars 页的既有缺口**~~ —— **4.12.0 已修**（见 D26/D27）：
    `getStarsUserId()` 取的是 `octolytics-dimension-user_id` = **页面主人**，而它被用作标签/备注的存储键命名空间
    与导入包归属校验；实测（登录态，`/mattn?tab=stars`）该值 = 10111（mattn）而登录者 `octolytics-actor-id` = 130123551（YsLtr）
    ⇒ 在他人 stars 页上脚本读写的是**那个人的命名空间**。
    修法：存储键改用登录者 id（`getStorageUserId()`）；他人的 stars 页不再被接管，只做只读装饰（D26）。
    保留此条是为了记录**曾经的**行为与实测数据（`exportImport` 的 `user.id` 语义随之变化，属可观察变化）。
17. **他人页网格的真实局限**（4.13.0 起，4.14.0 修订；见 D26/D29 与 ADR 0009，全部是**设计属性**而非缺陷）：
    ① **可编辑性依赖本人整表缓存的时效**（4.14.0 新增）：他人页上「不在我的缓存里但我在别处 star 过」的仓库
       （例如刚在 github.com 原生界面 star、脚本尚未同步）会显示为**只读**，直到下一次全量同步把它写进缓存。
       这是「不拉取」的必然代价。本页新 star 且从未进缓存的仓库，可编辑性只在**本次页面会话**有效
       （内存覆盖表，`resetViewContext()` 时清空）⇒ 刷新页面后回到只读，直到下次同步。
    ② **徽章只在我有对应数据时出现**：`locked-empty` 卡片只在我给那个仓库导入过标签/备注时才有内容；
       实测 mattn 前 100 个 starred 与本人 21 个带标签/备注的仓库**交集为 0** ⇒ 未 star 的卡片通常一片空白。
    ③ **只有本页数据**：无跨页筛选/搜索，翻页只能靠原生分页器；本条是「不拉取」的直接代价。
    ④ **字段缺失即降级**：DOM 里没有的就不渲染（例：`/stars/{login}` 的描述实测恒为空 ⇒ 卡片显示「No description」）。
    ⑤ **`viewContext` 是模块态**：任何「离开他人页」的路径都必须复位（`exitOtherStarsViewIfActive` / `viewTeardown` 第 11 项），
       漏了就串数据（往返把别人的列表画在我的页上）。
    ⑥ **依赖 GitHub 的条目结构**：改版 ⇒ 退化为「不接管」（功能消失、不破坏页面、不留残次网格）。
    ⑦ **呈现层接管了页面框架**（方案 A，用户裁定）：他人页的左栏被收窄、对方的 Starred topics 被搬进脚本右栏、
    **页主头像被缩到 120px**（该页 Sponsors/成就徽章等其它图片不受影响 —— 选择器已收窄到页主头像那一个）、
    Lists 区块按用户的「隐藏 Lists」开关隐藏。**功能层仍未接管**：无脚本分页器/筛选栏/同步按钮/横幅。
    **4.14.0 变化**：卡片的星按钮**要建**（4.13.0 已定），标签/备注**已 star 的卡片可编辑**；
    仍是**零 API 请求**，存储写入只发生在用户显式动作上且只落登录者命名空间（见 D29）。
    ⑧ **GitHub 现在有三套并存的 stars 页面骨架**（真机实测同一 `?tab=stars` URL 会随账号返回不同代际）：
    - **旧代**（如 `mattn`）：`#user-starred-repos > .col-lg-9` + `.col-lg-3`（Starred topics 列），
      标题「Starred repositories」，搜索框 placeholder「Search starred repositories」，有原生分页器；
    - **新代**（如 `Kuddev` / `Norman-bury`，仍是 `?tab=stars`）：`#user-starred-repos > .col-lg-12`
      （**没有 topics 列**），标题只有「**Stars**」，搜索框「Search stars」；**GitHub 自己的筛选栏就在标题行内**
      （`div.position-relative` 的第 2 个子节点 `div.d-flex.flex-column.flex-lg-row.tmp-mt-3.mb-n1`，
      原生是「标题一行 / 筛选栏一行」两行）；
    - **`/stars/{login}`**：`main` 里的 `ul.repo-list`，**没有** `#user-starred-repos` / `.Layout`。

    后果：**任何依赖骨架的选择器都必须有退路**。现状：主列用 `getStarsMainColumn()`（找不到 `.col-lg-9`
    就退到 frame / `main`）、topics 搬运与 `col-lg-3` 隐藏在新代自动跳过、布局表里针对
    `#user-starred-repos` / `.Layout` 的规则只在旧代生效 ⇒ 新代是「GitHub 自己的全宽单列 + 我们的卡片网格」，
    观感与本方页**不完全一致**（这是有意的：不猜它的新骨架）。`/stars/{login}` 的描述字段实测恒为空
    ⇒ 卡片显示「No description」。
    排查「脚本没反应」：看控制台那条「只读网格 / 未接管（原因）」+ `.stars-grid-container` 是否存在 +
    网格 computed `display` 是不是 `grid`（是 `block` = 布局表没注入）。

---

18. **布局接管已按标记收窄，但仍是「视图级」的写操作**（4.13.0 已修主体，剩两点）：
    ① 布局表里的 `.container-xl{max-width:1600px}` 是**页面容器**（布局的祖先），没法用后代标记限定 ⇒
    登出页的页头所在容器也会被加宽（纯宽度，无位置跳变）；
    ② `/stars/{login}` 路由上**根本没有 `.Layout` 元素**（真机实测 `document.querySelectorAll('.Layout').length === 0`）
    ⇒ 标记无从落下，该路由从不进入三栏接管（网格整宽 + 2 列），**这是既有行为**（改前那套骨架选择器同样匹配不到）。
    真要修 ② 得先给那代路由找新的列容器，属独立改动。

19. **他人页的两条已知（发布前审查轮登记、刻意未修）**（4.14.0）：
    ① **逐卡存储读取偏多**：约 5 次 `GM_getValue` / 卡（`getTags` + `getNote` + `loadPendingDelete`，
    各自还会读一次 localStorage 镜像）⇒ 30 条约 150+ 次同步 IPC。要省下来得给存储层加「读缓存 + 写失效」，
    那会改动**全脚本共用**的新鲜度语义 ⇒ 与本版本主题（他人页正确性）无关，登记待立项。
    ② **他人页上 D12 的「同步后立即重渲染」不生效**（`rerenderAfterSync` → `applyFilters`，被只读门挡住）。
    这是**净收益**（他人页的筛选栏/分页器本就不该被脚本驱动），但 D12 的措辞是全局的 ⇒
    **D12 只适用于本方自己的 stars 页**；他人页刷新数据的路径是重新投影原生条目，不由同步驱动。

20. **本人页 unstar 后的只读态是「临时显示态」**（4.16.2，用户 2026-10-05 确认接受）：`markRepoUnstarred` 会
    把该仓库移出整表缓存 ⇒ 下一次**整页重绘**（翻页、导入后重绘、同步后重渲染）它就不再出现在网格里。
    ⚠️ **有激活筛选/搜索时是「立即消失」**而不是「留到下次重绘」：`starCheck` 在那条路径上会紧跟一句
    `applyFilters({ keepPage: true })`，而 `queryRepos()` 此刻已经没有该仓库了。这是既有行为（本次未触及），
    与用户「而不是直接消失」的字面表述有差 —— 已被裁定为预期，此处只是把触发条件写清；
    数据本身在 24h 宽限期内仍可由 TM 菜单「恢复取消的 star」找回。**不**为此把宽限期条目注入 `queryRepos()`
    （那会让「已 unstar 的仓库继续出现在我的列表里」，且要给查询管线加第三条半来源，牵动分页计数与筛选 facet）。
    另：**导入**的标签若落在「本人没 star」的仓库上，**4.17.0 起改为进入 24h 宽限期**（用户 2026-10-05 裁定，
    取代原先「留在活区、不渲染、无 UI 入口」的现状）—— 24h 内同步到「远端已 star」即自动恢复，超期未 star 即删除；
    见 **D32** 与 D31 末条。

21. **`stars_pending_delete` 不记归属 ⇒ 多账号浏览器下本人页可能读到上一个账号的备份**（4.16.2 登记；
    **4.17.0 已定口径与修法，实现留给下一轮** —— 见文首「交接 · 下一轮」）：该键是**单份全局键**、条目不记 owner，
    而 `cardState` 的身份门只判「**有没有**登录者」（`hasViewerIdentity()`）、不判「这条是不是他的」⇒ 换账号后，
    两个账号**都 star 了同一仓库**时，本人页可能把「我自己已 star 的卡片」判成 `locked-pending` 并显示上一个账号的
    标签/备注。他人页自 4.14.0 起已有同一问题，4.16.2 把作用面扩到本人页。
    **4.17.0 定的口径（用户裁定）**：归属跟 **读路径账号**走（有 token ⇒ **token 账号**；无 token ⇒ 登录会话）——
    屏幕上是**谁的**列表完全由 `GET /user/starred`（带 token）决定，**展示与归属必须同账号**。⇒ **D27 的
    「隔离账号 = 登录者」要改写**，导出包 `user.id` 同源一并改。
    **三处照字面实现会坏 + 一处永久缺口**（详见文首交接）：① 加 `owner` 字段**不构成隔离**（map 以 repoId 为键 ⇒
    同仓库互相顶掉），必须**键分区** `stars_pending_delete_<归属id>`；② 归属 id 只能从**已有**的指纹缓存
    `stars_account_identity` 同步取（存储层不能 await，也不许为此发请求）；③ **组合 B**（有 token、无 `user-login`
    meta）下 `accountGuard` **永不**写指纹缓存 ⇒ 若「查不到就读空」，这批用户的标签会**永久读不到**，
    默认回退 `getViewerId()`；④ 「忽略横幅 = 已知晓」**不成立**（横幅可**永久关闭**，且求值只在本人页 ——
    他人页手动同步那个口子除外；而错号是
    持续状态）⇒ 须补一处不可关闭、在数据所在处可见的归属显示。
    **登出**场景不受影响（无身份 ⇒ 一个字符都不读，夹具 `other-logout-pending` 已钳合实证）。
    真机复查手法：换账号后在同一浏览器打开本人 stars 页，看两账号都 star 过的仓库是否变只读。
22. **~~导入路径下点一次星按钮会抹掉已有的宽限期备份~~ —— 4.17.0 已消除（由导入导出策略变更消除）**。
    **原记录**：`markRepoUnstarred()` 无条件用当前**活区**覆盖 `_tags`/`_note`，而「缓存条目 + 非空 pending 条目」
    这种并存态**只经 import 可达** ⇒ 点一次星就把 24h 内可恢复的数据写成空。
    **处置是消除前提，不是修补破坏点**：导入不再写缓存 **且**分派只认缓存成员关系 ⇒ 并存态不可达 ⇒
    该分支不再是活代码（`markRepoUnstarred` 4.17.0 一行未动）。首版论证被审查推翻的经过与纪律见 D32。

23. **~~宽限期备份的标签是「非空整体替换」，与活区的「取并集」不对称~~ —— 4.17.0 修订 ③ 已消解**
    （用户裁定统一为覆盖，见 D9）。**不要再把任一侧改回并集**（＝「同一份导入因仓库是否已 star 而结果不同」）；
    测试锁 `[10]`/`[14]`/`[3]`（活区那侧归 `[3]`/`[4]`/`[12]`），**A/B 改回并集即变红**。原推理链与最小复现见 gbrain `people/me`。
    **仍存的小偏差（🟢 纯展示）**：进宽限期的仓库不计入 `notesSkippedEmpty`（只影响提示文案）。
    ~~宽限期路径不去重~~ —— **已修**：标签的归一化（去重 + 剔空白项）现在**只做一次、在分派之前**，
    两条去向拿到同一份数组（曾只活区去重 ⇒ 恢复时带出重复 pill）。


## 下一步

1. **本次升级（`@version` 4.16.2 → 4.17.0）→ 若你在用 dev 脚本，必须重装 dev loader**：重开
   <http://127.0.0.1:5173/__vite-plugin-monkey.install.user.js> 让 TM 原地更新，否则 TM 菜单会整体消失
   （机制见「dev 模式必须知道的四件事」第 4 条：`@version` 变了 → 脚本头变了 → mountGmApi 的 key 对不上）。
   正式版不受影响；`@version` 变了却没重装，表现是「TM 菜单空了」+「同步说未配置 token」。
2. **本轮（4.17.0 覆盖语义）的真机确认**（行为层已由 `tests/exportImport` 120 项 + 夹具 19 组覆盖）：
   导入一份**较旧**的包（标签与你本地不同）⇒ 确认框应写明「文件里的标签/备注**覆盖**本地的」，
   完成后报告里出现「**其中被替换掉的本地标签 N 条**」；再导入一份**只给备注、不给标签**的包 ⇒
   该仓库**已有的标签必须原样保留**（这是「空不清空」的反向锁，别漏）。
   另：`name` 的合并是**已有名字优先**（包里的名字只补空）—— 若你希望反过来，说一声，D9/D32 一起改。

3. **4.14.0 的真机确认（只能在真 github.com + TM 上做；行为层已由夹具 18 组场景覆盖）**：
   - 他人 stars 页上，本人缓存与页面**有交集**时才看得到效果 —— 若交集为 0（实测常见），
     可用 TM 菜单先「立即全量同步」把当前账号的 star 拉进缓存，再打开自己的 stars 页给其中一两个加标签，
     然后去任意他人的 stars 页看那几张卡片是否可编辑；
   - 点 star ⇒ **只有那张卡片**变可编辑；点 unstar ⇒ 立即不可编辑、**标签与备注仍在**（只读）；
     打开 TM 菜单 →「恢复取消的 star」⇒ 回到可编辑且数据完好；
   - 全程 DevTools Network 面板**零 `api.github.com` 请求**；
   - TM 安装页里的**授权清单仍恰 5 项**（dist 头部已核为 5 项，但 TM 的展示需真机确认）。
   （以上行为层已由夹具 18 组场景覆盖；真机只补观感与安装页核对。）
4. **`docs/adr/0006` 剩余两项不可观测项**：`?scopes=repo` 预填是否真的勾上（被 sudo/passkey 门拦住，
   **不得**声称可用或不可用）、`context=user_stars` 服务端是否据其分支（实测 200 但不可知）。
   离页仓库 + 仅 VF 头**已实测成立**（见「当前状态」的实测结论），不必重复验。
5. ~~4.13.0 验收状态~~ —— 已全部通过，逐项证据在 `docs/adr/0009` 与 `git log`；只剩**观感层面**的人工确认（4 条，见上「验证记录」末条）。
6. 后续阶段（详见 `todo` 与 `DEVELOPER.md` §13）：GraphQL 分页调研、周期自动同步。
   ~~非本人 star 页 `GET /users/{u}/starred` 接入~~ —— 4.12.0 已按「只读模式」收口（D26）；
   若将来要让他人页也显示完整卡片网格（**已实现**：4.13.0 的零网络投影网格 + 4.14.0 的逐仓库可编辑），
   要进一步「跨页/全量」则需 `GET /users/{u}/starred` 匿名 60/hr 额度 + 游标翻页 + 独立缓存键，
   动手前先重新评估额度与用户价值。
7. 未消化的架构建议：单遍 facet 计算、响应式漏斗（见 `starmgr-arch-review-report.md`）。
8. fine-grained PAT 写他人公开仓库的能力缺口由 GitHub 控制（roadmap#600 NOT_PLANNED、#601 OPEN）——将来若补齐，
   可回头简化 `docs/adr/0006` 的网页端点通道。
9. ~~4.9.2 / 4.10.0 / 4.11.0 的验证记录~~ —— 三批已全部跑完（静态 + 仿真页断言 + 部分真机），逐条断言表与
   审查轮表格在 `git log` 与对应的 `docs/plans/archive/2026/` 方案里。**仍生效的只有这些**：
   - 可重跑的仿真工装：`.diag/gen-viewport-harness.cjs`（窄视口/跨断点）、`.diag/gen-jump-harness.cjs`（跳页）、
     `.diag/gen-account-harness.cjs`（归属横幅），以及各自的 `assert-*.js`。**URL 必须带 `?tab=stars`**。
   - 4.9.2 的 R1–R4 修复、4.10.0 的 T9 断言、4.11.0 的 A1–A11 断言都已是**回归基线**，
     没有具体要复现的缺陷时不必重跑。
   - 仍待真机确认（行为层已由仿真覆盖，真机只做观感与安装页核对）：真·窄窗口观感、Turbo 导航面板、
     **TM 安装页授权清单恰 5 项**、导出能触发 `GM_download`、TM 菜单项齐全。
   - ⚠️ 改工装后必须先用探针确认夹具状态：**场景不生效的表现是「断言全绿」**（4.11.0 第二轮审查踩过 ——
     反引号把外层模板字符串截断成 `SyntaxError`、以及一次替换留下空的前置分支 `else if (c) {}`）。
10. **原生 `fetch` 语言色通道有一个新观察项**：它现在受页面 CSP `connect-src` 约束（已实测该主机在白名单内），
  且失败是静默降级（灰圈）。GitHub 若收紧 CSP，表现是语言色全部变灰点 —— 届时把 `gmFetchText` 加回来即可。
11. ~~4.10.0（分页跳页 + 同步按钮联动）的验证记录~~ —— 已跑完，逐条断言表与发布前审查表（1 P0 / 3 P1 / 7 P2）
   在 `git log` 与 `docs/plans/archive/2026/` 的方案里。**仍生效的只有这一条**：
   **被并发丢弃的同步不广播 `failed`**，只留 console —— 改成 failed 会把正在转的按钮停下、谎报失败（见 D23）。

12. ~~4.11.0（Token 归属校验 + 不符警告横幅）的验证记录~~ —— 已跑完（A1–A11 断言表 + 两轮独立审查表），
    逐条证据在 `git log` 与 `docs/plans/archive/2026/` 的方案里。**仍生效的只有这几条**：
    - **归属校验不可能产生「相符」的可见证据**（相符时按设计零痕迹）：真机验证只能真的换成另一个账号的
      token，或改本地缓存 `stars_account_identity`。这是特性，不是缺陷。
    - **两处夹具自身缺陷**（比被测代码的缺陷更值得记住）：① 夹具缺 `octolytics-actor-id` ⇒「夹具全绿」掩盖了
      「取错身份字段」；② 生成脚本里的反引号截断外层模板字符串、以及一次替换留下空的前置分支
      `else if (c) {}` ⇒ **场景静默失效**。**改工装后先用探针确认夹具状态**（`.diag/probe-nomseata.js` 抓过）。
    - **「双清」坑会发生在测工装侧**：`gm.ts` 的 `gmGet` 有「GM 值 == 默认值且镜像有数据 → 写回 GM」的迁移路径，
      只清 GM 侧会被 localStorage 镜像**原地复活**（表现是「横幅刚出现就被关掉」）。
    - 真机只补：横幅观感（位置 / 配色 / 关闭手感）与 **TM 安装页授权清单恰 5 项**。

## 快速构建约定

不跑 `tests/smoke/`（快速构建期），改完只 `pnpm check`，由用户在真实页面判断成功与否。

---

## 常用命令

```bash
pnpm check     # tsc --noEmit + build（改完必跑）
pnpm build     # → dist/github-star-manager.user.js
pnpm dev       # HMR，需先解决上面 CSP 那条；入口 http://127.0.0.1:5173/__vite-plugin-monkey.install.user.js
pnpm build && node scripts/verify-css.cjs   # 产物 CSS 与源 CSS 等价性
pnpm test:exportimport   # 导入导出纯逻辑断言（无需浏览器；项数以实际输出为准，别写死数字）
node scripts/ratelimit-probe.cjs --repo <me/repo>   # 限流实测探针（默认 dry-run，零网络请求）
```

---

## 建议技能

- `agent-browser-cli`：真机 DOM 探查、注入验证、截图、受信任点击。**先读「真机调试要点」** ——
  里面记了两个会白费时间的坑（它的 `open`/`exec` 返回值里的 `tab_id` 不可信、会导航到**别的**标签；
  `tabs` 列表把 URL 截断到 ~65 字符），以及「隐藏标签页冻结过渡 ⇒ computedStyle 报起点值」这条。
- 夹具与断言可重复运行：`node .diag/gen-otherstars-harness.cjs` 后用 `file://.../?tab=stars&scenario=<名>`
  打开，再 `agent-browser-cli exec --tab <id> --file .diag/assert-otherstars.js`（场景名见该文件头部注释）。
- **改 `src/` 后必须重新 `node .diag/gen-otherstars-harness.cjs`** —— 夹具是把 dist 内联进去生成的，
  不会自动跟随 `pnpm build`。
- ⚠️ **批量跑夹具的三道门**（`.pi/tmp/run-scenarios.sh` 已内置，可直接用）：① **场景名必须在生成器里有对应分支**
  （白名单也要含**隐式**的 `own`）—— 这一道是必要的，因为下面②的回读**只验「URL 参数有没有丢」**：生成器把参数
  原样回读，随便一个不存在的场景名（`bogus-xyz`）也会报 `(OK)`；
  ② **回读 `window.__gsmScenario` + `location.hash`** —— `agent-browser-cli open` 经 `python subprocess` 调用会丢掉
  `&scenario=X`，夹具静默回退成隐式 `own`，于是「断言全绿但跑的不是你要的场景」（bash 里用双引号传 URL 不会丢）；
  ③ **挑标签页按 `title` 精确匹配**（`GSM harness: <scenario><hash>`；`tabs` 把 URL 截断到 ~65 字符，不能按 URL 认），
  **禁止 `harness_tabs | tail -1`** —— 残留页会让它拿到别的（或同名旧）场景页 ⇒ 假红或假绿；跑完顺手关掉夹具页。
  该脚本的 `fail` 计数**也含** NO TAB / 场景不符 / 解析失败 —— 别只 grep `errors:`。
  仍不能覆盖的情形：**场景分支被删但名字还在生成器里**（此时①也放行）—— 那会让断言「少跑几组」，靠 `(OK)` 组数比对兜。
- ⚠️ **未提交改动做破坏性 A/B 实验时，禁止 `git checkout -- <file>` 还原**（会把未提交的实现一起抹掉）：
  `cp` 到 `.pi/tmp/` → 改 `src/` → 跑 → `cp` 还原 → 核对 `git diff --stat` 与实验前一致。
