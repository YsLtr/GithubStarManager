# 归属账号 = token 账号（标签 / 备注 / 宽限期备份）

> **4.19.0**：[ADR 0011](0011-id-first-api-targets.md) 只统一仓库请求目标；本 ADR 的 token 账号、
> 浏览器登录者与存储归属分工保持，仓库 ID 不能用来选择操作账号。

本 ADR 记录 4.18.0 把「标签 / 备注 / 宽限期备份」的存储命名空间从**页面登录者**改为 **token 账号**，
以及随之而来的三件事：宽限期备份从单份全局键改为**按键分区**、身份在**保存 token 时**确定并持久化、
披露**全部由既有的归属横幅承担**（不新增任何 UI）。它**改写 D27**（「隔离账号 = 登录者」）。

## 问题陈述（风险 21）

屏幕上的 stars 列表来自 `GET /user/starred` —— **带 token**，所以那份数据属于 **token 账号**
（官方明文：端点页「Lists repositories the **authenticated user** has starred」+「Personal access tokens
**act as your identity** … when you make requests to the REST API」，见 `docs/research-finegrained-getuser.md`）。
而 4.12.0–4.17.x 把标签 / 备注 / 宽限期备份按**浏览器登录者**（`octolytics-actor-id`）隔离。两者一旦不是同一个
账号，就会出现「**屏幕上是 A 的列表、标签却记在 B 名下**」：用户看到的是 A 的仓库，写下的标签落进 B 的命名空间，
换个账号回来标签就"消失"了。

两个账号不一致是**官方承认的常态**，不是异常：浏览器可以同时登录多个账号，`gh` 官方文档记录过真实事故
（"received credentials for wilmartin_microsoft, **did you use the correct account in the browser?**"），
`GH_TOKEN` 也明文优先于已存凭证。

## 决策

### 1. 归属 = token 账号；无 token（或身份暂时取不到）回退登录者；两者皆空则拒绝读写

`getStorageUserId()`（`src/storage/tags.ts`）的解析顺序：

1. `getTokenIdentitySync(getToken())?.id` —— 按**凭证指纹**查 `stars_account_identity` 缓存（**同步**、零网络）；
2. 取不到 ⇒ `getViewerId()`（登录者）；
3. 仍为空 ⇒ `''` ⇒ **归属类**存储读空 / 写 no-op（**不回落** `stars_tags` / `stars_notes` 这类无隔离旧键）。
   受影响的只有分区的三个：`tags` / `notes` / `pendingDelete`。`repoCache` / `langColors` / `fullSyncMeta`
   **不受该 id 门控**（它们是远端派生数据与展示性数据，不按账号隔离 —— 见「已接受」第 5 条）。

保持函数名与签名不变，`tags.ts` / `notes.ts` / `exportImport.ts` 的调用点零改动即跟随新口径。

### 2. 身份在**保存 token 时**确定（不是渲染时被动填充）

`src/storage/accountIdentity.ts` 的 `setTokenVerified(raw)` 是 token 的**唯一写入点**，顺序钉死为
「先 `rememberTokenIdentity(fp, id)`（`GET /user` 成功即写）→ 再 `gmSet(githubPat, tok)`」。
于是**正常路径下**「token 存在」蕴含「它的身份已知」，读路径只需查表 —— 唯一的例外是下面第 3 条的
`saved-unverified` 分支（保存时确认失败，那是有意为之）。

- 401 ⇒ 走既有失效上报链并**拒绝保存**（死 token 没有保存价值）。
- 网络 / 5xx / 429 / **403** ⇒ **仍然保存**、身份留空、`console.warn`：归属回退登录者。取舍见「已接受」第 3 条。
  （403 也归入这一支：它同样只说明「这次查不到」，不足以判定 token 已死。）
- 空串 ⇒ 清除 token（不需要确认）。

这条把三处分散的写入（`tokenConfig.saveToken`、`starCheck.promptForToken` 的两行 `gmSet`、配置面板内联保存）
收敛成一处置信，顺带消除了一个既有缺口：**组合 B（有 token、无登录会话）**下 `accountGuard.run()` 会因
`!hasWebSession()` 早退，身份缓存**永不填充** ⇒ 旧实现下这批用户根本走不到 token 账号这条路径。

### 3. 宽限期备份按归属账号分区：`stars_pending_delete_<归属id>`

原实现是**单份全局键** `stars_pending_delete`，形态 `Record<repoId, entry>` —— **行键就是 repoId**。
两个账号对**同一 repoId** 各有一条备份时抢的是同一个位置：后写的把前一条整个顶掉。

**给条目加 `owner` 字段解决不了它**（用户最初的措辞是「备份应当也有所属标记」）：位置只有一个，加字段只是把
「静默覆盖」变成「有标记地覆盖」。**换个键才是隔离**，与 `stars_tags_<id>` / `stars_notes_<id>` 同构 ——
分区之后「所属」由键名承载，再往条目里塞 owner 就是同一事实的第二份拷贝。

### 4. 判据分工写死（两个面，别混）

| 面 | 判据 | 语义 |
|---|---|---|
| 数据面（标签 / 备注 / 宽限期备份的键） | `getStorageUserId() !== ''` | 「这份数据归属谁」（token 账号，回退登录者） |
| 成员关系 / 可编辑性面 | `getViewerId() !== ''`（`cardState.hasViewerIdentity`） | 「浏览器里有登录会话吗」（**存在性**，不比数值） |

两者都是存在性判定、都不做数值比较 ⇒ 不产生新的错配。分开的理由：决定「这张卡能否编辑」问的是
「浏览器里有没有一个『我』」，决定「数据写进哪个键」问的是「这份列表属于哪个账号」。
**风险 21 正是这两者被当成同一件事的后果。**

### 5. 披露只用既有的归属横幅：**不新增任何 UI**

`div.gsm-account-banner`（4.11.0 起就有）本就在文案里同时点名两个账号，本版各分支补一句归属说明
（「标签、备注与取消 star 后的备份都属于 @&lt;tokenLogin&gt;」）。横幅文案仍按**写通道**分叉，
且**不得**出现「读写永远同账号」这类断言（写通道的镜像错配是真实存在的，见 ADR 0006）。

关闭语义不变：关闭态键 = `<tokenId>#<sessionId>` ⇒ **任一侧变化即重新武装**；两侧任一取不到 ⇒ 每次都弹。
新增第五个求值触发点 `visibilitychange`（此前四处：transform / Token 保存 / Token 清空 / `runFullSync` 的 finally；
用户在本标签页外换了登录账号再回来时复评；**非 own 的 stars 页
直接返回**，以保住 D26 的他人页零网络硬约束）。

**用户裁定（2026-10-06）**：不做「不可关闭的常驻归属显示」（在网格工具栏加归属 chip）。这不只是「没做」，
而是**被显著否定**的决策（用户原话：「在网格工具栏加一个不可关闭的归属 chip 是我显著否定的决策」），
理由 = 不新增任何 UI。AGENTS.md 风险 21 段原先记的「一处不可关闭、在数据所在处可见的归属显示」据此改为**仅横幅**，
代价见「已接受」第 1 条。

⚠️ **后续 agent 不要再提议它**：这条留痕的存在意义就是阻止「归属看不见 ⇒ 加个常驻显示吧」这类重复提案
（风险 21 段早期文本、2026-10-05 的风险 22 归档方案 §连带、以及一次 P1 自问自答都提过它，均已被本裁定推翻）。

## 已接受的后果与降级

1. **关掉横幅后，页面上再无任何归属痕迹**（不加新 UI 的必然代价）。缓解 = 任一侧身份变化即重新武装；
   其余时间只能去存储里查：`stars_account_identity`（归属 id 的取值来源）、`stars_full_sync_meta.accountId`、
   以及 `console` 告警。三者都不是用户界面。
2. **指纹缓存不是安全边界**：它是「曾经见过这份凭证」的本地缓存，能读写 GM 存储的人可以伪造它 ⇒
   归属 id 可被伪造。任何**判定类**用途都不得依赖它（`accountIdentity.ts` 模块注释已写明）。
3. **保存时身份确认失败仍会保存 token**：那一瞬间归属回退登录者，且只在本次页面会话内被**快照**兜住
   （快照键 = 凭证指纹 + 登录者，不是「记住 id」）；
   下次加载若确认成功，命名空间会切到 token 账号 ⇒ 该窗口内写的标签会「看起来消失」。
   之所以不「拒绝保存」：那会把一次网络抖动变成「用户存的 token 没了」——身份查询能力本身对两类凭证
   都已验证可用（官方明文 + 真机实测），走到那一支只意味临时性故障。

   ⚠️ **触发面比「保存那一刻」宽**（对抗性验证指出，2026-10-06 补充）：任何「token 已存在、但身份缓存没有这条
   记录」的状态，都会在**该页面会话的首次 `getStorageUserId()`**（例如 `ensureStarsSetup` → `cleanupExpiredUnstarred`）
   就把归属快照在登录者上，且整会话不再翻转。除保存失败外，能造成该状态的还有：4.18.0 之前就配好的 token、
   身份缓存被清 / 被 GM 存储迁移丢掉。派生后果（都已实测）：该会话的标签 / 备份落在登录者命名空间；
   「身份冷缓存时导出、缓存变热后导入」会因包内 `user.id` 与当前归属不同而被**拒绝**（自己的包导不回来）。
   取舍：这是**有意**选择（见 `tags.ts` 的快照注释 —— 宁可一个会话内不翻转，也不要中途换命名空间），
   且 D30 前提（无已有用户）下这些窗口不可达。**前提失效时此条必须重判。**

   另有一格**永久**窗口：**组合 B（有 token、无登录会话）+ 身份从未确认** ⇒ `getStorageUserId()` 恒为 `''`，
   存储读空 / 写 no-op，且没有任何自动路径会去补确认（`accountGuard` 在无登录者时早退，不会发身份请求）。
   这一格与「有登录会话」的组合不同：后者下次加载就能自愈，前者只能靠重新配置一次 token（或先用登录态配一次）。
4. **不迁移旧数据**：正常配置（token 主人 == 登录者）下两侧 id 相等 ⇒ **键不变、零影响**。
   错号期间写在旧键里的数据不迁移也不删除（D30：迁移代码已整批删除），换回匹配账号即可再见。
5. **`stars_repo_cache` 仍不按账号分区**（风险 14 未解）：本决策只保证「标签 / 备注 / 备份与列表同账号」，
   **卡片集合本身**的归属留待风险 14 —— `stars_full_sync_meta.accountId`（4.18.0 新增，**只写不判**）
   是将来做那条告警的依据。
6. **`GET /user` 的文档位置不显眼**：它在 `docs.github.com/en/rest/users/users` 的
   「Fine-grained access tokens for "Get the authenticated user"」小节里，JS 渲染 + 折叠，
   readable 类提取器容易整段漏掉（本项目的一次复核就漏过，见 `docs/research-finegrained-getuser.md` §5）。
   ⇒ 需要复读时用原始 HTML 取证，别据此改文档。

## 验证与依据

- 单测 153 条全过（`pnpm test:exportimport`），其中本次新增两组：
  - `[15]` 归属解析：归属 = token 账号、键名落在 `stars_tags_999`、组合 B 仍归 token、未命中回退登录者、
    身份缓存为空时皆空则拒绝导出。
  - `[16]` **`setTokenVerified` 自身的契约**：401 不落库 / 200 落库且身份先于 token（按 `GM_setValue` 写入
    顺序断言）/ 网络异常与 5xx 与「200 但缺 id」仍保存且身份留空 / 前缀非法不落库 / 空串清空 / 端到端归属跟随。
  - 跨账号键分区互不可见与「同一 repoId 的两条备份互不覆盖」在既有的 `[6]`（存储按用户隔离）。
  A/B 反证（三处，都实测变红）：`getStorageUserId` 退回只用登录者、分区键退回全局单键、
  401 分支反转成「也保存」⇒ 断言非空转。
- 夹具：own / other-profile（`fetch=0`、`writes=0`）/ `#narrow`（`gsm-*` 节点 0）全绿 —— 新口径未破坏
  D18 惰性与 D26 零网络。
- ⚠️ **夹具教训（本次踩到）**：分区改键后，夹具生成器仍把宽限期种子写进**旧的无分区键**，而产品代码只读分区键
  ⇒ `other-editstate` / `own-unstar` 的 D29/D31 回归锁与 `other-logout-pending` 的防泄漏断言**全部变成「读空假绿」**
  （批量脚本又只看 `_errors`，不看语义值 ⇒ 报绿）。已修：种子改到分区键，并在这三组里加
  `*_seedIsOnPartitionedKey` / `*_legacyKeyUntouched` 两条**非空转守卫**。
  ⚠️ 关键实现细节：守卫**不能只做返回值** —— 批量脚本（`.pi/tmp/run-scenarios.sh`）只判各组的 `*_errors`，
  所以这三组把守卫结论**折进 `_errors`**（`seedGuardErrors()` → `withSeedGuards(window.__errors)`），
  否则它俩只是「打印出来给人看」，不是闸门。A/B 实测：把种子改回裸键 + 重生成夹具 ⇒
  `R21_errors` 出现 `SEED-NOT-ON-PARTITIONED-KEY` / `LEGACY-PENDING-KEY-PRESENT` ⇒ 批量脚本会判失败。
  与 AGENTS.md「场景不生效的表现是断言全绿」同源，值得当一条纪律记住。
- 外部依据：`docs/research-finegrained-getuser.md`（官方原文 + 真机实测），
  复测探针 `scripts/token-identity-probe.cjs`（默认 dry-run）。
- 真机未覆盖项（需用户在自己的账号上做）：错号场景下横幅重弹、跨账号取标签、关掉横幅后换号再弹。
