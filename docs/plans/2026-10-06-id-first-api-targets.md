# API 请求目标 ID 优先：调查与修改计划

日期：2026-10-06。状态：**4.19.0 已实施**；当前规则见 [ADR 0011](../adr/0011-id-first-api-targets.md)。
下文保留原调查/方案，最后一节记录落地差异与验证；端点证据见 [API 目标测试报告](../research-api-targets.md)。

## 1. 结论与范围

统一目标应是：仓库操作全链路携带数字 repoId，用户身份以数字 accountId 为主；名称用于展示、名称端点适配和缺 ID 时的降级。

不能把所有 HTTP URL 都机械替换为 ID。当前 GitHub 官方星标 REST 契约仍为 `/user/starred/{owner}/{repo}`，网页写端点也使用名称。建议先统一目标解析，再复用既有通道，不引入 GraphQL 写通道。

本轮覆盖 `src/` 的所有 fetch、两个 `scripts/` 探针、目标来源、队列及导入恢复链路。历史 `.diag/` 实验脚本不作为线上请求入口；实施时更新仍在使用的夹具，不批量改写历史取证文件。

## 2. 不统一的位置

| 位置（调查时行号） | 当前行为 | 影响与处理方向 |
|---|---|---|
| `src/starWrites.ts:288` `setStarState` | 只接收 fullName，不接收 repoId | 调用方已有 ID，却在网络边界丢掉；改接目标对象 |
| `src/starWrites.ts:125` `restWrite` | PUT/DELETE `/user/starred/{owner}/{repo}`；分别 encode 两段 | URL 形状符合官方契约，但名称来自缓存；由 ID 解析当前名称后适配 |
| `src/starWrites.ts:112,211` 网页表单/写请求 | 按名称匹配 form/action，再 POST `/{owner}/{repo}/star或unstar` | 没有 ID 关联验证；统一解析目标、验证 form 与目标一致，再保留原 Cookie 通道 |
| `src/ui/cards.ts:113–144` | 无 name 不建按钮；持有 repoId，但只向写接口传 fullName | 改为 ID 可用即具备寻址条件，名称不再是硬门槛 |
| `src/restore.ts:33–44` | 即使有 repoId，name 不含 `/` 仍拒绝恢复；按 name 去重/写入 | ID-only 导入备份无法恢复；改为按 ID 入队、执行时解析 |
| `src/mutationQueue.ts:25–98` | label 同时用于展示和仓库去重；查询仅检查队列内未开始项 | 同 ID 改名无法去重；拆 key/label，并覆盖等待间隔与执行中的目标 |
| `src/fullSync.ts:346,699` | `checkStarredGone` 仅收 name，直接插值 URL，404 即取关 | 与写端点的校验/编码不同；旧名、旧名被复用可能核对错仓库；改为 ID 解析后查询，失败三态处理 |
| `src/domRepos.ts:102–106` | `repoId` 可能是数字 ID，也可能是 `owner/repo`（登出投影） | 不能把任意 repoId 字符串塞入数字 ID 路由；边界显式区分 |
| `src/storage/exportImport.ts:118,287` | repoNames 存名称；导入仅用 includes('/') 检查 | 名称质量检查不统一；保留文件格式，统一名称校验，名称降为提示 |
| `src/storage/pendingDelete.ts:62–89,213` | 缺 name 用 repoId 展示；注释规定补齐名称前不可恢复 | 展示回退可以保留，网络请求不能把展示值当地址；取消“无名不能恢复”限制 |
| `scripts/ratelimit-probe.cjs:270,337,434` | 各处按 owner/repo 拼请求 | 活跃工装同样需要按 ID 解析；保持默认 dry-run |
| `scripts/ratelimit-probe.cjs:293–316` | GET /user 后，用 owner 文本对比 login 判断自有仓库 | 用户侧真实的不统一点；改比仓库响应 owner.id 与 /user 的 id |

已经符合目标、或属于必要例外：

- `storage/accountIdentity.ts:93`：唯一身份网络实现 GET `/user`，取得当前凭证身份；accountGuard 用数字 ID 比对。无需先查 login 或替换为 `/user/{id}`，后者不能证明凭证属于谁。
- `fullSync.ts:222,569`：GET `/user/starred` 的分页、探尾、进页检查统一走同一页面请求实现。这里的 `/user` 是当前凭证主体，不是用户名，不需要转换。
- `pageScope.ts`：页面身份数字 ID 优先、login/路径回退，无网络。`/stars/{login}` 缺页面主人 ID 时继续本地回退，不能为统一 ID 增加进页查询。
- `scripts/token-identity-probe.cjs`：GET `/user`，无需改目标。
- `langColors.ts:20,87`：固定的 linguist 静态资源下载，属于资源地址；保留，避免为取色引入仓库解析请求。
- `tokenConfig.ts` 的 PAT 配置链接、卡片链接及原生分页链接属于导航地址，不是 API 身份判定。

## 3. GitHub 端点证据与边界

核对官方 [REST OpenAPI 固定版本](https://github.com/github/rest-api-description/blob/836ce198db13a6fb194547e53eea99c6ddae495b/descriptions/api.github.com/api.github.com.json)（info.version = 1.1.4）。首轮匿名 GET 调查后，用户提供临时 classic PAT，完成 36 次认证/匿名对照请求（含 4 次变异）；测试目标已恢复基线，详见测试报告。

| 端点 | 证据 | 结论 |
|---|---|---|
| GET `/user` | OpenAPI `users/get-authenticated` | 继续作为凭证身份来源 |
| GET `/user/{account_id}` | OpenAPI `users/get-by-id`；匿名 GET `/user/1` 返回 200、id=1、login=mojombo | 将来确实需要任意用户资料时可按 ID 查；目前产品没有该需求 |
| GET `/users/{username}` | OpenAPI `users/get-by-username` | 任意用户缺 ID 时可降级；不新增无消费者的封装 |
| GET `/repositories/{id}` | 匿名 GET `/repositories/1296269` 返回 200、id=1296269、full_name=octocat/Hello-World，未重定向 | 按数字 ID 解析当前全名可行，但该 OpenAPI **没有 `/repositories/…` 路由**，只算运行实证，不能宣称官方承诺 |
| GET/PUT/DELETE `/user/starred/{owner}/{repo}` | OpenAPI `activity/check-repo-is-starred-by-authenticated-user` / `star-repo-for-authenticated-user` / `unstar-repo-for-authenticated-user` | 官方契约要求名称；该版本未列数字 ID 星标端点 |
| POST GitHub 网页 star/unstar | 项目既有 `docs/research-web-star-endpoints.md` | 继续沿用已验证路径；本轮未重新执行网页写入 |

本次新增确认：

- classic + repo scope 下，公共、私有仓库的 ID/名称元数据查询均 200 且 ID 一致；同一私有仓库匿名查询均 404。
- 直接数字星标候选 `/user/starred/{id}` 的 GET/PUT/DELETE 均 404；官方名称端点在正对照上正确返回 204，PUT/DELETE 后状态回读正确。**不采用该数字候选，也不在运行时先尝试它再退回名称。**
- 历史旧名 `github/linguist` 由 GitHub 301 重定向到 `/repositories/1725199`，响应当前全名 `github-linguist/linguist`；ID 路由不仅可手工访问，也是 GitHub 的重定向目标。

仍未验证：fine-grained、Cookie 私有目标、人为改名与旧名复用、TM/CSP 实际可达性。浏览器尝试因 visibilityState 始终 hidden 在请求前退出；不能记作浏览器通过。只验证过上述具体数字星标候选，不声称排除所有未知路由。

## 4. 推荐设计

### 4.1 统一目标与 URL 构造

新增轻量 `src/api/repoTarget.ts`，负责目标规范化、名称验证、数字 ID 识别、ID 解析与名称端点适配。它不读写标签/备注/整表缓存、不建 UI、不依赖 accountGuard。

业务接口改为 `setStarState(credential, target, wantStar)`，target 携带 `{ repoId?, fullName? }`。数字 ID 用字符串保存、按正整数字符串检查，不把含 `/` 的投影键或 GraphQL node_id 当作数字 ID。名称统一验证为合法的 owner/repo 两段，拒绝额外路径、查询、片段和伪装的 URL，构造请求时逐段编码。

在 DOM 入口把“数字 repoId”和“名称投影键”分开识别；不要求全库存储格式迁移。展示仍可使用原名字或 ID 占位。

### 4.2 解析与降级规则

1. 有有效数字 ID：优先 GET `/repositories/{id}`，核对响应 id 与输入一致，取返回的当前 full_name。
2. 若该 ID 路由返回 404，且有名称提示，可尝试官方 GET `/repos/{owner}/{repo}`；**返回 id 必须等于目标 ID** 才能使用名称。不同 ID 即明确失败，不能写向复用旧名的新仓库。
3. 401、限流、网络失败、5xx 等不做无差别名称重试；按既有失败分类返回。ID 解析失败不能直接拿未经核验的旧名称发写请求。
4. 没有数字 ID、有合法名称：按名称查询仓库元数据，取得数字 ID 和当前 full_name，然后进入同一执行路径。没有稳定 ID 的这条路径无法追溯名字过去指向谁，这是名称降级的固有限制。
5. ID、合法名称都没有：明确失败，不发请求。
6. 解析结果只在一次操作内复用；并发解析可按“实际凭证上下文 + repoId”单飞。初版不增加长期持久化名称映射或跨账号负缓存，避免旧名再次成为事实权威。

名称元数据 GET 必须支持 GitHub 的同 API 主机重定向；校验最终响应 ID、使用最终 full_name。重定向次数设上限，跨源跳转不携带凭证。已知 ID 时，旧名称降级也不能跳过最终 ID 校验。私有仓库实测的 404 证明：404 降级只是一次受控查找，不能据此宣布目标不存在或自动转成取关。

HTTP 层仍按端点能力选地址：仓库查找优先 ID；星标 REST/网页必须使用解析出的名称。GET `/user` 和 GET `/user/starred` 保留。

这是 ID 驱动的地址解析，不是原子性的 ID 写入保证。名称解析到实际写入之间若恰好改名/转移，仍有竞态；只有经验证的直接 ID 写端点或另行设计的 GraphQL 路径才能进一步解决，不能声称本方案彻底消除了它。

### 4.3 两种凭证与零网络边界

- REST 读写使用传入 token；Cookie 网页写仍由 hasWebSession / 既有静默分派决定。repoId 是目标仓库，不决定“替哪个账号操作”。
- 无 token 的网页操作，公共仓库可匿名解析 ID；私有仓库可能不可见。可使用**明确关联同一 repoId 的当前原生仓库条目及其表单**适配地址，不能仅凭全文名称搜索就认定同仓库。
- Cookie 可见、API 不可见且 DOM 也没有可验证目标时，返回无法确认目标。此场景是比原先“凭缓存名直接写”更保守的行为，必须在实施验证中量出影响，不假装 Cookie 权限可以传给 api.github.com。
- ID 解析只在用户操作执行时或本已有的同步核对中发生。卡片渲染、他人页投影、窄视口启动不触发解析请求，继续满足 D18/D26。

### 4.4 队列、恢复及同步联动

- 队列拆 `key` 与 `label`：数字目标用 `repo:<id>`，仅名称目标用规范化 `name:<owner/repo>`，label 只展示。队列维护等待及执行中目标，卡片和恢复走同一去重入口。名字目标解析出 ID 后也需检查冲突；两种别名不能分别排入同一仓库的写操作。
- 在队列实际执行阶段解析目标；已撤销的排队项不发解析请求。保留 `.then` 的 handle 身份检查与失败回滚。
- 新增解析等待后，节流应计到**实际变异请求**，而不是解析开始时刻；REST→网页降级的两次变异也需通过同一间隔门。保留串行、1000ms 默认和不自动重试。
- restoreOne 接受 ID-only 目标。成功后才能 markRepoStarred；解析失败不动本地。已解析出的当前 name 应用于恢复条目的元数据，防止恢复后仍显示旧名；不改变 tags/notes 权威和导入分派规则。
- `checkStarredGone` 改收目标对象，区分“元数据解析失败/404”和“已确认目标上的星标查询 404”。前者返回 unknown，不确认取关；后者保留既有星标状态语义及 GitHub 权限不可见的固有局限。
- 混合扫描先收集核对结论，再提交 diff，避免解析走到一半额度耗尽时已经修改前几条。把新增解析请求计入额度预算；速率余量不足等完整性失败整轮放弃。全 304 早退不得新增请求，正文权威模式不逐仓库补查。
- repoNames 保留 schema v1 形状，降为名称提示/展示与缺 ID 的入口；导入保持纯逻辑，不在 storage/exportImport 中发请求。

## 5. 实施顺序与验收

### 第一步：端点能力验证与解析器

- 已补两个默认 dry-run 的探针：api-target-probe（GET-only）和 api-target-write-probe（自有公共仓库写对照/复原）。当前自动选择样本，尚未提供 --repo-id/--repo；若需固定目标回归再加这两个参数。
- 已验证 classic 公共/私有 ID 查找、同私有目标匿名 404、历史转移、直接数字星标候选失败及名称写入成功。继续补 fine-grained、旧名复用、Cookie 私有目标及浏览器请求可达性；不得为完成矩阵改名用户现有仓库。
- 落地 repoTarget 与独立测试，不把 identity 存储模块拉入 DOM/写通道依赖闭包。
- 出口：给定稳定 ID + 旧名，解析出同一 ID 的新名；名称被复用时不会指向不同 ID；明确记录未文档化路由的退路和失败行为。

### 第二步：卡片与恢复写链

- 修改 starWrites、ui/cards、restore、mutationQueue，更新恢复相关注释与错误文案。
- 测试 ID-only 恢复、同 ID 两个名称的去重、取消后无网络、执行中去重、失败保留备份、队列继续推进、REST 权限失败按原通道规则降级。
- 测试实际两次变异开始时间的间隔，包含解析延迟差异和 REST→网页分支；不得用“队列启动时间”替代真实请求断言。
- 私有仓库仅 Cookie 可见、离页无 DOM 的能力损失必须作为明确验收项。

### 第三步：同步核对与辅助链

- 修改 checkStarredGone 的输入、编码与三态结果消费；核对阶段前置、预算计入解析。
- 测试改名不误判取关、解析 404 不误删、旧名复用不核对错对象、额度中断时全表不落地、全 304 零新增请求。
- 工装探针按 owner.id 校验自有仓库，所有运行期目标使用同一规范；既有测量结果属于旧协议，不修改历史数字。新增元数据请求单独记账，避免污染变异限流统计。

### 第四步：回归和文档

- `pnpm check`、`pnpm test:exportimport`；新增针对解析/请求/队列/同步的测试，现有导入导出单测不会覆盖 starWrites。
- build 后重跑 `node .diag/gen-otherstars-harness.cjs`，更新其请求 stub；确认场景非空转守卫生效，再测他人页初始 fetch=0、窄视口无注入、恢复与错误回滚。
- 端点层真实加星/取关对照已通过且恢复基线；实现落地后仍需验证卡片/恢复编排的完整行为，不能用本次 API 成功替代应用集成验收。
- 更新 DEVELOPER、D32 的“repoNames 是唯一恢复地址”相关表述、D33 的两种账号面边界说明及相关 ADR 的后续决策；旧裁决不静默覆写为已实施。
- 同步修正 starWrites 文件头残留的“422 会取 token 重发”和错误的后缀匹配解释，它们与现代码/既有裁决不符。

不在本计划顺手实施：风险 14 账号缓存分区、GraphQL 分页、GraphQL 写通道、周期同步、UI 新归属提示或旧数据迁移。

## 6. 成本与选择

推荐上述“统一 ID 目标 + 名称端点适配”，而非把 `/user/starred/{owner}/{repo}` 猜改为某个 ID URL。

代价是一次普通操作通常多一次仓库元数据 GET；ID 路由 404 后名称核验可能再多一次。匿名解析受匿名额度约束，批量恢复需纳入预算。以本地旧名称直接拼请求可省掉这些 GET，但不能满足“ID 是目标权威”的要求。

如果第一步证明私有仓库/无 token 的能力损失不可接受，先报告该具体差异，再调整降级策略；不得把未经验证的旧名称回退藏进 resolver，也不得把直接 ID 写端点的猜想作为已验证前提。

本次已确认该权限差异真实存在：同一私有仓库 classic 查询 200、匿名查询 404。因此 Cookie 私有恢复是必须保留的实施验收项，不是纯假设；尚未据此修改既有网页写能力。

## 7. 4.19.0 落地与验证（2026-10-06）

- `api/repoTarget.ts` 是纯校验/构造，`api/repositories.ts` 单独负责联网；导入逻辑未获得联网能力。
- 已接入 starWrites、cards、restore、mutationQueue、fullSync；删除旧 name-only 核对实现。
- Cookie 原生同 ID 行/表单可先于 API 使用，且包含接管后隐藏行；这是避免匿名 API 强制否定私有目标的具体实现。没有原生证据时仍须解析，不能用缓存名直接写。
- 浏览器 GET 使用原生 follow（manual 会 opaque，无法照搬 Node 探针），最终检查 origin/id；变异禁止重定向。
- 不添加持久化名称缓存或单飞表：现有变异队列已串行、批量同步核对也串行，暂无需要额外合并的调用。
- 限流探针新增 --repo-id，P0 元数据解析、owner.id 校验后固定测量目标，不把预检请求混入旧变异统计。旧测量数字未改写。
- 4.19.0 产物头由 package.json 生成；没有新增 GM grant 或 UI。

| 验证 | 结果 |
|---|---|
| pnpm check | 类型检查、构建通过 |
| pnpm test:exportimport | 153 通过 / 0 失败（准备阶段既有临时 CJS 编译诊断保持，正式类型门通过） |
| pnpm test:api | 24 组通过：ID/name、404/错误目标、两通道、节流/取消/去重、ID-only 恢复、真实混合同步无部分提交、全 304 |
| A/B 反证 | 临时移除 ID 匹配守卫后回归失败；源文件逐字节还原、重建后通过 |
| 前台夹具 | other-profile、other-editstate、own-unstar、other-logout-pending、other-starstate、roundtrip、other-profile#narrow 均通过；场景/可见性门与分区种子守卫生效 |
| 真实新实现（源码打包的 API/queue/starWrites） | 14 请求、2 变异；正确 ID + 故意错误名字仍定位正确；PUT/DELETE 204，最终基线已复原，见 research-api-target-implementation.json |

浏览器夹具用 stub 验证交互，不当成真实网页写证据。真实 GitHub 页的 CSP 复测在可见性门处停止；fine-grained、真实 Cookie 私有离页与 TM 沙箱端到端仍待验证。当前实现遇到无可靠目标证据的私有离页请求明确失败。

## 子代理审查与修复复验（2026-10-06）

- 首轮三个独立角度发现非法 ID 降级、名称恢复落键、响应体超时、mock 假绿和无效表单方向复核；均修复，具体边界见 D34 的审查修订。
- 修复后 `pnpm check` 通过，`pnpm test:exportimport` 153 通过 / 0 失败；临时 CommonJS 工装仍输出既有编译诊断，正式类型门无错误。
- API 回归扩展至 33 组通过，包括真实 ReadableStream + AbortSignal 超时、队列继续、名称恢复冲突，以及真实 fullSync 的普通 403 / 网络 / 401 提交矩阵。
- mock 反证：unexpected / missing / check 三个独立子进程均退出 1；即使不调用 done 且产品吞掉 fetch 断言，也会在用例总闸报红。
- 原生表单测试实际进入产品 FormData(form) 分支，但 Node 模拟字段复制，并非真实 Cookie 或浏览器 E2E。之前的 7 组前台夹具、classic 实网双向写入证据仍属修复前验证，本轮未重复实网变异。
- 尚未确证：fine-grained 实网、Cookie 私有离页、TM 沙箱/CSP、真实名称复用及解析到写入之间改名竞态。既有变异请求无显式 deadline，不宣称所有请求均有界或无缺陷。

第二轮交叉复审：coverage_review 检查超时与防假绿，fallback_review 检查目标/恢复/写前钩子，stability_review 交叉检查名称恢复冲突；均未发现新增阻断问题。主代理复跑 33 组 API 回归与三个防假绿子进程，全部符合预期。名称源备份在途更新时采用最新内容，不宣称逐字快照锁或跨标签页原子事务。

## fine-grained 私有仓库实网补验（2026-10-06）

用户提供更新的全仓库 fine-grained token 和指定私有仓库后，直接运行当前源码打包的 repositories / mutationQueue / starWrites。目标 `YsLtr/bilibili-API-collect`（ID `1144496611`），执行时故意传 `deliberately/stale` 名称。

- 新 token 的 `/user`、私有名称元数据和 `/repositories/1144496611` 均 200。
- 初始星标查询 404（已确认仓库可见，因此可判未 star）；PUT 204 后查询 204；DELETE 204 后最终查询 404。
- 共 14 次请求，2 次变异，原始未 star 状态已恢复。报告不含 token，见 `docs/research-api-target-finegrained-private.json`。
- 初始受限 token 身份 200，但私有仓库名称/ID 均 404；classic 同仓库 200，公开仓库可读。对照见 `docs/research-api-target-finegrained-access.json`。仓库授权范围不足可表现为 404，不能据此断言仓库不存在。
- 该实测使用 fine-grained + 无浏览器会话的 REST 分支，证明本方授权私有仓库的 ID-first 实现可用；不代表 fine-grained 能写任意他人仓库。
- Cookie 补验只打开用户指定仓库并读取会话/可见性：会话是 YsLtr，仓库页面可见，但新窗口 focus + Page.bringToFront 后 document.visibilityState 仍为 hidden，按真机验证规则停止，未发 Cookie 变异。Cookie 私有及 TM/CSP 仍不能宣称已通过。
