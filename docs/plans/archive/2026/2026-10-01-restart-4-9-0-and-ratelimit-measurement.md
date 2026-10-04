---
title: 重新规划 4.9.0（变化简报 + 恢复 + 写路径）并新增 REST 限流实测
status: done
created: 2026-10-01
archived: 2026-10-04
---
# 重新规划 4.9.0（变化简报 + 恢复 + 写路径）并新增 REST 限流实测

> 方案路径：`docs/plans/archive/2026/2026-10-01-restart-4-9-0-and-ratelimit-measurement.md`（4.15.0 时归档）
> 生成方式：deep-plan 闭环（P1 自问自答 → P2 子代理查证 → P3 成文 → P4 单一审查）。
> ⚠️ 本机 `deep_plan_*` 工具**未暴露**给本次会话（扩展已注册于 `~/.pi/agent/settings.json:24`，但工具表缺失），因此**harness 级写保护未生效**，纪律靠自觉执行；其余产物契约（方案路径规则、`.pi/tmp/` scratch、决策记录 + 可变决策表、单一审查）保持一致。

---

## 0. P4 审查结果：用户推翻三项默认值（2026-10-01，本轮最终裁定）

| 项 | 原默认 | **用户裁定** | 连锁后果（已并入下方决策与步骤） |
|---|---|---|---|
| **V2** | 引导用户点原生按钮，脚本不代发 | **必须实现一键恢复**；恢复列表**每行后放 star 按钮**，用户可直接点单条 | 脚本代发 → 离页仓库的凭据问题浮现（**D24**：默认只带 `GitHub-Verified-Fetch`，422 才回退）；AUP §4 bulk 风险由用户承担（§7 接受项） |
| **V8** | UI 显式说明认证方式 | **不说明，脚本自己处理，用户无感** | 删除 UI 披露；用户可见文案不得出现「网页端点 / 浏览器会话」等实现细节（**D25**）；RDA §4(v) 披露缺失由用户承担 |
| **B8** | 快速创建只给 classic 深链 | **两者都给，并在 UI 说明二者区别** | 保留 fine-grained 深链 + 新增 classic 深链 + 差异说明；`ghp_`/`github_pat_` 都接受 |

**「列表」的读法**（按最宽覆盖实现，若理解有误请指出）：指**恢复窗口的条目列表**——每行之后一个 star 按钮；同时**变化简报**中每条取关记录也带 star 按钮（ADR 0003 已定案）。

---

## 1. 目标

1. **重新规划 4.9.0**：在既有三份 ADR 的基础上，纳入本轮新增证据（网页内部端点、限流事实核查）后重新确认写路径与恢复方案，并给出可执行步骤。
2. **新增一项实测任务**：用最小风险协议实测「REST 变异请求（`PUT/DELETE /user/starred`）的限流是否真的触发」，把 4.9.0 的队列参数从「照抄官方建议」升级为「本地有数据支撑」。

---

## 2. 决策记录（自问自答）

> 每条含结论 + 证据 + 置信度。证据要么是仓库内 `路径:行号`，要么是 URL，要么是本轮子代理报告的 `路径:行号`。

### D1 · 交付物范围：两个阶段解耦

**结论**：本方案包含「REST 限流实测（阶段 A）」与「4.9.0 实现（阶段 B）」两个阶段，**实测失败或无法执行不阻塞实现**。
**证据**：用户目标原文（要求重新计划 + 实测限流）；`docs/research-ratelimit-protocol.md:244-420`（协议可独立执行，不依赖 4.9.0 代码）。
**置信度**：high。

### D2 · 变化简报与通知栈沿用 ADR 0003 的定案，不重新设计

**结论**：右上角 Notification Stack（新条目**从底部追加**、**不设条数上限**、3s 自动消失、鼠标悬停**整个区域**暂停计时）、简报口径 = 取消 star / 新增 / 恢复（元数据刷新不计入）、无变化也弹、**不判重**、手动取消 star 用「撤销」而同步简报用「恢复」。
**证据**：`docs/adr/0003-sync-report-and-restore.md:1-20`；`docs/adr/0003` 的「已定案的行为」段（第 3–10 行）。
**置信度**：high。

### D3 · 「恢复必须打远端」的措辞需泛化：真实**写请求**，但有两条通道

**结论**：ADR 0003 写的「真实 `PUT`」要泛化为「真实写请求」——写路径有两条：REST（classic token）与网页内部端点（浏览器会话）。**禁止本地伪恢复**这条不变。
**证据**：`docs/adr/0003-sync-report-and-restore.md`（「恢复 = 真实远端写操作」）；`docs/research-web-star-endpoints.md`（网页端点用 Cookie 会话、与 token 无关，可写）。
**置信度**：high。

### D4 · 全局串行队列 + 固定 1000 ms 间隔

**结论**：卡片星按钮与恢复共用**一个全局串行队列**，变异请求间固定 ≥1000 ms。
**证据**：官方 best-practices 两条独立要求（serial/queue 与 pause-between-mutative，后者原文 *"wait at least one second between each request. This will help you avoid secondary rate limits."*，<https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api>）；Octokit `plugin-throttling` 对写请求的默认即 `{ maxConcurrent: 1, minTime: 1000 }`（`docs/research-ratelimit-protocol.md` §6.2）。
**置信度**：high（官方 + 官方维护库双源一致）。

### D5 · 限流实测的风险边界（硬约束）

**结论**：单轮变异请求 **≤60 次**、**单仓库且 owner == 自己**、**净状态不变**（star→unstar→star，结束时校验回基线）、**严格串行无并发**、**任一次 403/429 立即整轮停止**、403 后重试探测 **≤3 次指数退避**（60→120→240s）、每日 ≤2 轮且轮间 ≥1 小时。**不做** L3 并发探测。
**证据**：`docs/research-ratelimit-protocol.md` §4.7（硬上限表）、§4.6（止损与恢复流程）、§4.4（L3 默认不做及其理由）、§8.2（合规论证：自己对自己 + 极小规模 + 净状态不变 + 串行）；AUP §4 原文 *"rank abuse, such as automated starring"*、*"automated excessive bulk activity"*（<https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies>）。
**置信度**：high。

### D6 · 二级限流的**唯一**判据是响应体文案，不是 `x-ratelimit-*`

**结论**：实测判定逻辑不得依赖 `x-ratelimit-remaining` 判断二级限流——头在二级 403 时可能看起来完全正常；`retry-after` **可能缺失**。判据优先级：响应体含 `secondary rate limit` > `retry-after` > `x-ratelimit-remaining == 0`（primary）。
**证据**：官方 *"There is not a way to check the status of your secondary rate limit."*；三个独立实测样本在 `x-ratelimit-remaining` = 21 / 22–27 / **4840** 时仍被 403（`docs/research-ratelimit-protocol.md` §1.2–§1.5、§1.8）；`retry-after` 缺失样本（同报告 §1.4，26/26 次二级拒绝均无该头）。
**置信度**：high（官方 + 多独立实测）。

### D7 · 修正一个前提：「5 点/请求」属于 secondary 点数表，不适用于 primary 记账

**结论**：官方 primary 的表述是 *"5,000 **requests** per hour"*，因此 primary 的 `x-ratelimit-used` 应对**每个请求**（不论 GET 还是 PUT/DELETE）恰好 +1。若实测观测到 PUT 使 `remaining` −5，那是**与官方文档矛盾**的重大发现（需复核），而**不是**「点数表生效」的证明。原设想（「remaining 每秒降 5 → 说明点数表生效」）按文档结构**不成立**。
**证据**：官方 rate-limits 页两处小标题结构（*"Calculating points for the **secondary** rate limit"* 与 *"5,000 requests per hour"*），<https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api>；`docs/research-ratelimit-protocol.md` §4.8「前置修正」。
**置信度**：high（文档结构明确）。**但实际行为未确证**——这正是阶段 A 要回答的问题。

### D8 · 实测必须用 classic PAT + 自有仓库，禁止 fine-grained PAT 参与写测试

**结论**：实测凭证固定为 **classic PAT（scope `repo`）**。用 fine-grained PAT 会对他人仓库必然 403（权限缺陷），污染限流结论。
**证据**：`docs/adr/0004-write-requires-classic-pat.md`；`docs/research-ratelimit-protocol.md` §4.1（P0.2「do not 用 fine-grained PAT」）、§4.9（如何区分限流 403 与权限 403）。
**置信度**：high。

### D9 · 实测脚本落 `scripts/`，结论落 `docs/`

**结论**：新增 `scripts/ratelimit-probe.cjs`（Node，串行、分级、全字段记录、硬上限 60、**默认 `--dry-run` 不发请求**），结论写 `docs/research-ratelimit-measurement.md`。
**证据**：仓库已有 `scripts/verify-css.cjs` 先例（同类可复现工具）；`docs/research-ratelimit-protocol.md` §4.5（必须记录的字段表）、§9（记录模板）。
**置信度**：medium（工程约定选择，非外部事实；改动代价低）。

### D10 · 网页内部端点进写路径，但只作**回落**

**结论**：REST 保持默认主路径；当且仅当 **无 classic/OAuth token，或 REST 返回该 403** 时走网页端点。**单条与批量皆可**（批量形态见 D23；离页仓库凭据见 D24）；通道对用户**不披露**（D25）。
**证据**：`docs/research-web-star-endpoints.md`（网页端点用 Cookie 会话、**与 token 类型无关** → 是绕开 fine-grained 写缺口的真实手段；同时是「玻璃地板」：无契约、无 `x-ratelimit-*`、强依赖会话与 DOM）；AUP §4 合规分水岭（单次点击低风险 / 批量高风险）。
**置信度**：medium-high → 暴露为 V1。

### D11 · 批量「恢复全部」改为**引导用户点原生按钮**，不代发请求
**结论（已被用户裁定推翻，见 §0 与 D23）**：~~批量「恢复全部」改为引导用户点原生按钮，脚本不代发请求~~ → **现行**：脚本代发，一键「恢复选中」+ 每行 star 按钮。原「不代发」的合规理由不再作为默认值，转而作为**用户已知并接受的残余风险**保留（§7）。

**原结论（已作废，保留以记录被接受的残余风险）**：脚本可勾选、定位、高亮，但**不代替用户发请求**。
**证据**：AUP §4 *"rank abuse, such as automated starring"* 与 *"Starring and/or following accounts or repositories in large volume in a short period of time"*（<https://github.com/github/docs/blob/main/content/site-policy/acceptable-use-policies/github-disrupting-the-experience-of-other-users.md>）；RDA §4(v) *"starring repositories, on behalf of a user without this action being explicitly disclosed"*（<https://docs.github.com/en/site-policy/github-terms/github-registered-developer-agreement>）；`docs/research-web-star-endpoints.md`（合规判定表）。
**置信度**：medium → 暴露为 V2。

### D12 · 网页端点凭据：真实 per-form token 优先，`GitHub-Verified-Fetch` 仅兜底

**结论**：优先使用真实 `authenticity_token`：**页面上有表单**（单条操作）直接读；**离页仓库**（批量恢复）先 `GET` 目标仓库页取该页 `form[action$="/star"]` 的 token（见 D24）；**取不到才**用 `GitHub-Verified-Fetch: true`。**一次 422/403 即整批停止并提示**，不重试、不猜想。
**证据**：`GitHub-Verified-Fetch: true` 单独可用属**单会话 2 次观测**、无文档无契约（`docs/research-web-star-endpoints.md` §3.5）；per-form token 有官方背书（github/eslint-plugin-github 文档：per-form CSRF，action+method 绑定）。
**置信度**：medium → 暴露为 V3。

### D13 · 网页端点的会话前提是硬前提

**结论**：必须有已登录 github.com 会话；未登录时原生 star/unstar 表单根本不渲染，该路径必然失败 → 脚本必须按「会话有无」分派。
**证据**：`docs/research-web-star-endpoints.md` Q3 段（未登录表单不渲染；`meta[name=user-login]` 是最廉价的预检）。
**置信度**：high。

### D14 · 版本 4.9.0，单一提交

**结论**：`package.json` 从 `4.8.1` → `4.9.0`（`vite.config.ts:15` 读它写入脚本头），全部改动**一个提交**。
**证据**：`package.json:4`（当前 4.8.1）；`vite.config.ts:15`（version 单一来源）；三份 ADR 均标 4.9.0 定案。
**置信度**：high。

### D15 · ADR 处置：新建 0006，并修订 0004 的适用范围

**结论**：① 新建 `docs/adr/0006-web-endpoint-write-fallback.md`（网页端点写路径：触发条件、凭据获取、成功判定、三段式降级、**静默分派不披露**）；② 修订 `docs/adr/0004` 标题/首段：把「只支持 classic token」限定为「**REST 写路径**只支持 classic token」，并加指向 0006 的说明（fine-grained 用户经网页端点仍可写）；③ 修订 `docs/adr/0003`：「恢复 = 真实写请求」泛化（D3）；**批量恢复由脚本代发（一键 + 行内按钮）** 取代原「仅逐条、不代发」；补「通道不披露」与「不自动重试」。不留任何已知过时的决策文档。
**证据**：domain-modeling 纪律（词表/ADR 与事实冲突须当场纠正）；`docs/adr/0004-write-requires-classic-pat.md:1-3`（现标题「只支持 classic token」已被本轮证据部分推翻）。
**置信度**：high。

### D16 · 明确否决的两条替代路线（沿用并强化）

**结论**：**不做** OAuth Device Flow（需自建 OAuth App、新 App 默认 8h 过期 + refresh、50 提交/小时按 client_id 全局共享、GitHub 不支持 `verification_uri_complete`）；**不内嵌** GitHub CLI 的公开 `client_id`（RDA §4 红线 + token 桶共享）。
**证据**：`docs/adr/0004-write-requires-classic-pat.md`（Considered Options 段，含两条的完整否决依据）。
**置信度**：high。

### D17 · 详情页相关能力收缩（落地 todo 作废项）

**结论**：删除 `watchRepoStarState` 与旧版 `form[action$="/unstar"]` 监听；星状态真相只由整表同步判定，位置无关。
**证据**：`src/index.ts:80-117`（两者为同一功能的两个实现）；`todo:30`（「详情页star/unstar检测」已标作废）。
**置信度**：high。

### D18 · 网页路径的**成功判定**：`resp.ok` + 事后重读表单方向，不用 `{"count":"N"}`

**结论**：`{"count":"N"}` 是该仓库的 **star 总数事后快照**（实测 278→277→278），**不是本次动作的增量**，并发下存在「count 不变而操作成功」「count 变了但不是因为你」两种情形；且同一字段名在 watch 端点返回 `{count: "1"}`，含义并不统一。故成功判定 = **HTTP 200** + **事后重读页面 `form[action$="/star"]`（已取消）/ `form[action$="/unstar"]`（已 star）确认方向**。
**证据**：`docs/research-web-endpoint-integration.md:201-224`（Q5 全节，含 278→277→278 实测与 openweb `{count:"1"}` 旁证）、同报告 `:23`「落地要点 9」、`:48`（按钮内计数滞后一个 hydration tick，不是可靠的断言目标）。
**置信度**：high（语义为实测+推断，但结论方向是保守的「不用它」）。

### D19 · 网页路径的实现形态：真实 per-form token + `new FormData(form)`，**不需要** nonce 或 VF 头

**结论**：批量（逐条循环）必须用 `fetch(form.action, { body: new FormData(form), credentials: 'same-origin' })`；`form.submit()` **必然整页导航**，只适合单条、不能循环。凭据用页面表单里的真实 `authenticity_token`（`FormData(form)` 自动携带），`context` 一并原样带上、**不硬编码**。**不发送** `X-Fetch-Nonce`、**不发送** `GitHub-Verified-Fetch`、**不发送** `X-GitHub-Client-Version`。
**证据**：`docs/research-web-endpoint-integration.md:36-110`（Q1：fahamjv/github-bulk-unstar 用此法批量成功）、同报告 `:136-156`（Q3：`context` 观测到 `user_stars`/`repository`/`other` 三值，服务端是否据此分行**未能查证** → 原样带）、`:261-284`（Q7：`X-GitHub-Client-Version` 非必需，公开实现不发也成功）。**该结论使 V3 的默认值从「VF 兜底」收紧为「完全不用 VF」**，因为它把一条未文档化行为从路径里彻底移除。
**置信度**：medium-high（多来源一致，但均非官方文档）。

### D20 · 会话检测用**双重判据**，且必须判空串

**结论**：`document.body.classList.contains('logged-in')` **且** `meta[name="user-login"]` 的 `content` **非空串**。**只看 meta 是否存在是错的**（未登录时该 meta 可能以空串存在）；`form[action$="/unstar"]` **不能**当登录判据（它只说明该仓库已 star）。
**证据**：`docs/research-web-endpoint-integration.md:111-135`（Q2 全节）。
**置信度**：high。

### D21 · 失败语义必须在实现里显式区分：**422 是 CSRF 失败且响应体是 HTML**

**结论**：网页端点 422 = Rails CSRF 校验失败（如 `InvalidAuthenticityToken`），**即便带了 `Accept: application/json` 响应体仍是 HTML** → 解析必须 `resp.text()` 后再 `try { JSON.parse }`，不得直接 `resp.json()`（会抛）。403 = GitHub fetch 校验层。**四类失败各自对应不同处置**：422 → 端点/凭据失效，停止并降级；403 → 会话或校验层问题；401/404 → 归 REST 侧语义；限额 → 无头可读，只能被动退避。
**证据**：`docs/research-web-endpoint-integration.md:157-200`（Q4 全节，含 rails/rails#21948 的 `InvalidAuthenticityToken` → 422 一手日志）；`docs/research-web-star-endpoints.md` §3.5 的三组对照（200/200/**422**）。
**置信度**：medium-high（社区一手日志 + 实测一致）。

### D22 · 网页路径必须有**三段式降级**，不以「改版多久一次」为依据

**结论**：半年内已发生 ≥3 起有来源的 GitHub 前端改版事件（`csrf-token`→`fetch-nonce`、`/_graphql` 持久化哈希 drift、2026-02 PR 页 React 化打断 refined-github 8 个功能、2026-06 React GlobalNav 灰度、stars DOM 大改等），**「平均多久失效一次」无量化数据**。故按「以月为周期」设计降级：**网页端点 → REST → 引导原生按钮 / classic PAT 深链**，任一层失败即向下，且**不留静默失败**。
**证据**：`docs/research-web-endpoint-integration.md:225-260`（Q6 全节，6 起改版事件逐条带来源）；`docs/research-web-star-endpoints.md`（「玻璃地板」判定与本仓库 `AGENTS.md` 记录的 stars DOM 改版）。
**置信度**：high（事件有来源；周期为无量化的保守假设）。

### D23 · 批量恢复 = 一键「恢复选中」+ 列表每行 star 按钮（用户裁定）

**结论**：TM 菜单恢复窗口 = **可勾选列表** + 一键「恢复选中」；**每一行之后放一个 star 按钮**，可直接单条恢复；两种入口都进同一个全局串行队列（≥1s）。进度以 toast 显示 `3/15 ✓ owner/repo`。执行中**可取消**（取消只停后续，已发出的不回滚）。确认弹窗显示条数与预估耗时。
**证据**：用户 2026-10-01 裁定（§0）；ADR 0003（逐条按钮 + 进度 + 串行队列 + 不持久化）；`AGENTS.md` 交接（勾选 + 串行 PUT + 进度）。
**置信度**：high（用户直接指定）。

### D24 · 离页仓库的网页端点凭据：**默认只带 `GitHub-Verified-Fetch: true`**，422 才回退取真实 token

**结论**：批量恢复的目标仓库不在当前 DOM 里，但**无需**先取 per-form token —— 只带 `GitHub-Verified-Fetch: true` 的 POST 即可通过（本仓库实测）。**仅当该请求返回 422（CSRF 失败）时**，才回退：同源 `GET https://github.com/{owner}/{repo}` → `DOMParser` 取该页 `form[action$="/star"]` 的 `authenticity_token` → **重发一次**（仍失败即整批停止并报错，不重试）。有 classic/OAuth token 时走 REST，本决策不适用（1 次请求/仓库，无 CSRF）。
**证据**：`docs/research-web-star-endpoints.md:117-152`（§3.5 三组对照实测：决定性变量是 VF 而非 nonce，伪造 token 亦被接受）；`docs/research-web-endpoint-integration.md:36-110`（真实 token 路线同样可行）；同文档 `:317`（VF 行为无文档、**不应视为稳定承诺** → 故必须保留回退）。
**是否推翻既有文档**：**是**。本节推翻 `docs/research-web-star-endpoints.md` §3.5 末句「实现上仍建议优先读真实 token」——那句是**针对单条场景**写的（表单已在页面上，读取免费）；批量场景下读取要额外付一次 GET + 已 React 化页面的 DOM 解析，故方向相反。该文档随之修订（A1）。
**置信度**：medium-high（主路径为实测；VF 无文档、仅 2 次观测，故保留 422 回退）。
**回退为何必须逐仓库 GET**：`authenticity_token` 是 **per-form** 且与 action+method 绑定（stars 页实测 60 个表单 → **60 个唯一 token**，`docs/research-web-star-endpoints.md` §3.2）→ 一个仓库的 token **不能**拿去写另一个仓库，故回退路径只能逐仓库读自己页面的表单。

### D25 · 写通道静默分派（用户裁定）：不披露，但**不得静默失败**

**结论**：按「有 classic/OAuth token → REST；否则有登录会话 → 网页端点；二者皆无 → 提示」自动选择。UI 与用户可见文案**不出现**通道实现细节（「浏览器会话」「网页端点」「GitHub-Verified-Fetch」等一律不出现）。失败文案保持**结果导向**（如「恢复失败：权限不足」「恢复失败：请稍后重试」）。**静默 ≠ 静默失败**：任何一条失败都必须报错，不得吞掉。
**证据**：用户 2026-10-01 裁定（§0）；ADR 0003（恢复必须真实写远端）；D22（三段式降级）。
**置信度**：high。

---

## 3. 可变决策表（默认值已生效，按默认值即可直接执行）

| # | 决策项 | 默认值 | 依据 | 改动代价 |
|---|--------|--------|------|----------|
| V1 | 写路径架构 | **REST 优先（classic/OAuth token）；无 token 或 REST 拒绝时走网页端点（单条与批量皆可）** | 用户 2026-10-01 裁定 + §0；`docs/research-web-star-endpoints.md` | 中 — 改纯 REST：fine-grained / 无 token 用户继续无写能力；改纯网页端点：失去 API 契约与「无会话也能写」 |
| V2 | 批量恢复形态 | **一键「恢复选中」＋列表每行 star 按钮**（脚本代发，见 D23） | 用户 2026-10-01 裁定（§0）；ADR 0003（逐条按钮 + 进度 + 串行队列） | 中 — 回到「引导原生按钮」可规避 AUP bulk，但用户已明确否决；改为只允许逐条则失去一键便利 |
| V3 | 网页端点凭据策略 | **离页仓库（批量）只带 `GitHub-Verified-Fetch: true`，不先 GET**；页面上有表单（单条）用真实 per-form token；**仅当 VF 返回 422 时**回退到「GET 该仓库页取真实 token」重发一次（见 D24） | 本仓库实测 `docs/research-web-star-endpoints.md` §3.5（A=nonce+VF→200、B=**仅 VF**→200、C=两者皆无→422，连伪造 token 亦被接受）；`docs/research-web-endpoint-integration.md:36-110`（真实 token 路线同样可行） | 低 — 回退为「真实 token 优先」：每仓库多一次 GET 且要解析已 React 化的仓库页 DOM；回退为「只允许单条」则批量失效 |
| V4 | 限流实测规模 | **≤60 次变异请求 / 单自有仓库 / 净状态不变 / 严格串行 / 任一次 403 即停** | `docs/research-ratelimit-protocol.md` §4.7、§8.2 | 低 — 提高规模可得更强结论，但滑入 AUP「bulk」邻域；降低规模则可能测不出边界 |
| V5 | 实测与实现顺序 | **实测先行（阶段 A），但无自有仓库或无 classic token 时跳过、不阻塞实现**（队列按 Octokit 默认 1s） | D1；`docs/research-ratelimit-protocol.md` §4.1（P0.1 风险控制） | 低 — 改为实测后置：实现先落地、参数后校准；改为强制实测：阻塞风险 |
| V6 | 队列间隔 | **固定 1000 ms（不自动调参）**，实测结论只作验证与文档 | 官方 best-practices；Octokit 默认 `minTime: 1000` | 低 — 改为实测调参需把结论反哺代码，多一轮改动 |
| V7 | 无 token 但已登录用户能否用写路径 | **能**（有会话即走网页端点，这是绕开 fine-grained 缺口最彻底的形式） | `docs/research-web-star-endpoints.md` Q2（与 token 无关） | 中 — 改为「仅配了 token 的用户可用」会让无 token 用户继续只读 |
| V8 | 写通道是否对用户披露 | **不披露（静默分派，用户无感）**（见 D25） | 用户 2026-10-01 裁定（§0）；与 RDA §4(v)「explicitly disclosed」的偏差由用户承担（§7 接受项） | 低 — 改为显式披露只需加一行文案，但用户已明确否决 |

---

## 4. 执行步骤

### 阶段 A · REST 限流实测（独立，可先做）

| 步 | 动作 | 验收方式 |
|----|------|----------|
| A1 | 写 ADR 0006 + 修订 ADR 0004 / 0003（D15）+ `CONTEXT.md` 补术语「网页写路径」+ **修订 `docs/research-web-star-endpoints.md` 两处**：① 订正 `GithubStarListsPlus` 先例（源码精读实为 **REST DELETE**，网页表单只用于**读**星状态，见 `docs/research-web-endpoint-integration.md:285-306`）；② §3.5 末句「优先读真实 token」改为「**批量场景只带 VF、422 才回退读 token**」（D24） | 五份文件交叉引用一致；无「仍建议优先读真实 token」之类过时表述；`git diff --stat` 内无 `src/` 改动 |
| A2 | 新增 `scripts/ratelimit-probe.cjs`：串行、分级（L0 只读基线 → L1 10×1s → L2 20×1s/500ms/250ms）、全字段记录（§4.5 表）、硬上限 60、立停与指数退避、**默认 `--dry-run`** | `node scripts/ratelimit-probe.cjs --dry-run` 打印计划/判据/上限且**零网络请求**；`--run` 才发请求 |
| A3 | 人工在场执行 A2（前台标签页、关闭脚本自动同步、用自有仓库） | 产出 `docs/research-ratelimit-measurement.md`：每次请求全字段 + 按判定矩阵（D1–D14）给出结论 + 基线与复原校验 |
| A4 | 把结论反哺文档（不自动改代码，除非结论与 1s 默认冲突→走 V6 复议） | `DEVELOPER.md` 增一节引用实测结论 |

**A3 前置条件（任一不满足则跳过阶段 A，记录原因，直接进阶段 B）**：自有仓库可用、classic PAT（scope `repo`）可用、能关闭脚本自动同步、出口非共享/VPN 环境（若走 VPN 则只做 L1）。

### 阶段 B · 4.9.0 实现

| 步 | 动作 | 验收方式 |
|----|------|----------|
| B1 | 新增 `src/mutationQueue.ts`：全局串行、≥1000 ms 间隔、**排队中可撤销**、失败分类（401 / 403 权限 / 403 限流 / 404 / 网络） | 单测式自检：连续入队 5 条，相邻请求墙钟差 ≥1000 ms；撤销后该条不再发出 |
| B2 | `src/starWrites.ts`：写路径抽象 + **静默分派**（classic/OAuth token → REST Bearer；否则有登录会话 → 网页端点；**离页仓库默认只带 `GitHub-Verified-Fetch: true`，422 才回退取真实 token**）（见 D19/D24/D25） | REST `204`；网页 **200 + 事后重读 `form[action$="/star"\|"/unstar"]` 方向**（**不得**用 `{"count":"N"}`，见 D18）；两条路径对调用方**接口一致**（调用方不感知通道）；批量场景下**正常情况下每仓库恰好 1 个写请求**（无多余 GET） |
| B3 | `src/ui/cards.ts` 星按钮改走 B1+B2 | 点击 → 乐观翻转；排队中再点可撤销；失败按分类提示 |
| B4 | 新增 `src/ui/notifications.ts`：右上角通知栈（底部追加、不限条数、3s、悬停整区暂停、恢复按钮、划掉动画） | 手动触发 3 条并存；悬停不消失；恢复后划掉并重置 3s |
| B5 | `runFullSync` 收尾接简报（口径见 D2）+ 有增删或可见元数据更新时 `applyFilters({ keepPage: true })` 重绘（自动来源先判「最近是否有用户交互」） | 手动同步无变化也弹；自动同步仅在有变化时重绘 |
| B6 | TM 菜单恢复窗口：**可勾选 + 一键「恢复选中」**（含每条剩余时长；24h 超期条目消失）＋**每行后 star 按钮**（单条直点）→ 统一进 B1 队列，进度 toast `n/N ✓ owner/repo`，可取消（见 D23） | 勾 15 条一键执行时相邻请求墙钟差 ≥1000 ms；单条按钮点击即入队；取消后不再发后续；超期条目不再出现 |
| B7 | 删除导入后的自动同步链路（`runImportSync` / `AfterImportHandler` / `src/index.ts` 注册点），导入按 `docs/adr/0005` 落地 | `rg "runImportSync\|AfterImportHandler"` 无残留；导入后不触发同步 |
| B8 | token **双入口 + 差异说明**：新增 **classic 深链** `<https://github.com/settings/tokens/new?scopes=repo&description=GithubStarManager>`（`scopes=repo` 而非 `public_repo`，理由见 D3/ADR 0004），**保留** fine-grained 深链（现有 `starring=write` Template URL）；配置 UI 写明二者区别：**classic = 读写都走官方 REST、对任意公开仓库可写；fine-grained = 读可用、写他人公开仓库会被 GitHub 拒绝（自动改经你的浏览器登录会话完成）**。`ghp_` 与 `github_pat_` **都接受保存**；403 文案引导 classic（**不得**再提「检查 Starring 权限」）；写路径接受 `gho_` | 配置面板同时可见两条链接与差异说明；`rg "starring=write"` 仍存在（fine-grained 入口保留）；403 分支文案与 ADR 0004 一致 |
| B9 | 删除 `watchRepoStarState` 与旧表单监听（D17） | `rg "watchRepoStarState"` 无残留 |
| B10 | `package.json` → 4.9.0；跑 `pnpm check` | `pnpm check` 通过（tsc + build） |

### 阶段 C · 文档收尾

| 步 | 动作 | 验收方式 |
|----|------|----------|
| C1 | `DEVELOPER.md` 增补：变异队列、写路径双通道、通知栈、实测结论引用 | 与代码一致 |
| C2 | `AGENTS.md` 按 handoff 纪律重写为**单一当前状态**（不加「待验证清单」） | 无版本叙事、无待验证清单 |
| C3 | 单一提交（4.9.0） | `git log -1` 单一提交，含代码 + 文档 |

---

## 5. 非目标

- 不实现 OAuth Device Flow；不内嵌任何第三方 OAuth App 的 `client_id`（D16）。
- 不做并发写入；不做 >100 并发压测；不做背靠背无间隔探测（D5）。
- ~~不把网页端点用于**批量自动**恢复~~ → **已由用户裁定推翻**（V2/§0）：批量代发保留，但**不做自动重试**、**不做定时自动恢复**、**不做无上限并发**。
- 不改动 GitHub 拥有的 DOM（详情页 star 按钮）（D17）。
- 不为实测新建账号或使用 `GITHUB_TOKEN`（AUP 禁 fake account；`GITHUB_TOKEN` 发不出用户级 star 操作）（`docs/research-ratelimit-protocol.md` §5 A5/A6）。
- 不改 fine-grained PAT 的**读**路径（`GET /user/starred` 不受限）。
- 不把限流实测做成长期定时任务（一次性标定，不是监控）。

---

## 6. 开放问题（未能查证，明确列出）

1. **`PUT/DELETE /user/starred` 是否存在任何公开的限流实测**——检索范围覆盖 Stack Overflow / GitHub Community / Octokit / go-github / gofri / hub4j issues / 多个批量 unstar 工具，**均无**（`docs/research-ratelimit-protocol.md` §2.1）。→ 由阶段 A 补。
2. **网页端点的专属限流阈值**：无公开资料；已知官方「内容创作 80/分、500/时**含 web 界面**」，但 star 是否属该桶**未确证**。
3. **`X-Fetch-Nonce` 的有效期与复用次数**、是否与用户/会话绑定：未确证（仅确认跨页会变值）。
4. ~~`{"count":"N"}` 的语义与并发可靠性~~ → **已查证**：是仓库 star 总数事后快照、不作判据（D18）；但其**官方定义**仍无文档，「并发下是否可靠」为推断。另：网页端点的 **403 vs 422** 分工已查清（422 = CSRF/HTML，403 = fetch 校验层，D21）。
5. **`PUT` 返回 `304` 的触发条件**：官方只列状态码，无说明。
6. **403 vs 429 的选择规则**：官方只说「403 或 429」，实测样本全为 403。
7. **`GitHub-Verified-Fetch: true` 在批量/离页场景是否稳定**：仅 2 次单条观测、无文档（`docs/research-web-star-endpoints.md:317`）。→ **实现期用 1 个仓库做单次真机验证**（B6 验收项）；若批量下开始返回 422，则 D24 的 GET 回退成为实际主路径。
8. **`X-GitHub-Client-Version` 是否必需**：未确证（已知公开实现不带它也能成功）。
9. **classic 创建页的 `?scopes=` 预填是否仍有效**：官方文档**只**列了 fine-grained 的预填参数，**未列 classic**；`?scopes=repo&description=` 来自社区实测文章（dev.to，2024-08）→ **实现期真机点一次验证**；不生效则退化为只开 `https://github.com/settings/tokens/new` 并在 UI 里写明「请在 Scopes 勾选 `repo`」。

---

## 7. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 网页端点无契约，GitHub 改版即失效（历史已失效过一次：`meta[csrf-token]` → `meta[fetch-nonce]`） | 仅作回落路径（V1）；失败即停止并回退到 REST/提示，不静默 |
| 限流实测触发 AUP §4 | 硬约束 D5（自有仓库、净状态不变、≤60 次、串行、立停） |
| 实测得出与官方文档矛盾的结论（如 primary 按 5 点计） | 不立即改代码；需 ≥2 轮复现并排除多区域抖动后才下结论（`docs/research-ratelimit-protocol.md` §4.8 D2/D3） |
| 恢复队列期间用户关页/刷新 | 队列不持久化、不续传；未执行的条目仍在宽限期备份中（ADR 0003） |
| fine-grained 用户误以为配了 token 就能写 | **改为配置时一次性说明**（B8 双入口差异文案），不再逐次披露（V8 用户裁定）；实际写路径已由 D25 静默兜住，用户不会遇到「配了 token 却写不了」的结果 |
| **一键批量恢复代发请求**（V2 用户裁定）触发 AUP §4「automated starring」「large volume in a short period of time」 | **用户已明确接受**（§0）。技术上仍保留：严格串行 ≥1s、进度可见、可取消、**不自动重试**、确认弹窗显示条数与预估耗时 |
| **静默分派不披露写通道**（V8 用户裁定）与 RDA §4(v)「explicitly disclosed」冲突 | **用户已明确接受**（§0）；作为已知偏差写入 ADR，便于日后回溯 |
| 无 token 用户批量恢复：若 VF 被 GitHub 收紧，D24 的 422 回退会让每仓库多一次 GET（2 次/仓库，15 条 ≈ 30 请求 / 30s+） | 正常情况 1 次/仓库（V3/D24）；回退仅**逐条失败时**触发且**只重发一次**；有 classic token 时走 REST 完全无此成本；全程进度可见 + 可取消 |
