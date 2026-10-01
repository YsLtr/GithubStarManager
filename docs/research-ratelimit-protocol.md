# GitHub REST API 变异请求限流 — 实测协议调研报告

> 目标：为 Tampermonkey 脚本 **GithubStarManager**（直连 `api.github.com`，操作用户自己的 star 列表）设计一份**安全、可复现、最小风险**的实测协议，回答：
> **`PUT/DELETE /user/starred/{owner}/{repo}` 的限流是否真的会被触发？官方建议的「变异请求间 ≥1 秒」与「每请求 5 点 / 单端点 ≤900 点每分钟」能否在实测中被观测到？**
>
> 调研方式：纯公开来源检索 + 精读（`web_search` / `fetch_content` / `defuddle_fetch` / 原始文档 Markdown）。
> **本次调研未向 `api.github.com` 发出任何请求（包括只读端点），也未执行任何 star/unstar 请求。** 跳过只读端点的原因：本报告的全部结论均可由官方文档与公开实测样本支撑，无需 token 即可完成；同时严格遵守父任务「不要调用 api.github.com 写端点」的约束。
>
> 调研日期：2026-10-01（报告中日期均为来源方原始时间）
> 来源等级标记：**[官方]** / **[官方员工]** / **[社区实测]** / **[推断]** / **[未确证]**

---

## 0. 概览（执行摘要）

1. **二级限流在 HTTP 头里不可见**——这是官方明文 + 两个独立实测样本共同确证的结论。被拒时 `x-ratelimit-remaining` 可以离 0 很远（样本：21 / 22–27 / 4840）。官方原话：*"There is not a way to check the status of your secondary rate limit."* **[官方]**
2. **唯一可靠的判别信号是响应体文案**：`You have exceeded a secondary rate limit...`。主流客户端（Octokit、go-github、hub4j）全都是靠 body 正则匹配来识别的。**[社区实测]**
3. **「5 点/请求」只作用于二级限流，不作用于 primary**——官方文档把点数表放在 *"Calculating points for the secondary rate limit"* 一节之下，而 primary 的表述是 *"5,000 **requests** per hour"*。因此**不能**用 `x-ratelimit-remaining` 每次降 5 来验证点数表。**[推断，基于官方文档结构]**
4. **`GET /rate_limit` 只能看 primary**；官方明确它*不计* primary 但*可能计入* secondary，且没有任何 secondary 字段。**[官方]**
5. **没有任何一条公开实测针对 `PUT/DELETE /user/starred`**。这是一个真实的证据空白——本报告核心交付物的价值即在于此。**[未确证]**
6. 邻近端点的实测显示：**并发与共享 IP 才是高置信度的二级限流触发器**；而**按端点的隐藏上限**可以远低于 900 点/分钟（`search/commits` 实测每 60 秒窗口只放行 2 次）。**[社区实测]**
7. 因此本协议的定位是：**分级推进、只操作自有仓库/自己的 star 列表、净状态不变、以「是否出现 403/429 + body 文案」为唯一判定信号**，并明确规定止损与复原步骤。

---

## 1. Q1 — 二级限流的可观测性

### 1.1 官方规则原文 **[官方]**

来源：<https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api>

- 触发条件（列举 + 兜底）：
  > "You may encounter a secondary rate limit if you: Make too many concurrent requests. No more than 100 concurrent requests are allowed. … Make too many requests to a single endpoint per minute. No more than 900 points per minute are allowed for REST API endpoints … Make too many requests per minute. No more than 90 seconds of CPU time per 60 seconds of real time is allowed. … Create too much content on GitHub in a short amount of time. In general, no more than 80 content-generating requests per minute and no more than 500 content-generating requests per hour are allowed. … "
  > "These secondary rate limits are subject to change without notice. **You may also encounter a secondary rate limit for undisclosed reasons.**"

- 点数表（注意其所在小节标题）：
  > "### Calculating points for the secondary rate limit
  > Some secondary rate limits are determined by the point values of requests. For GraphQL requests, these point values are separate from the point value calculations for the primary rate limit.
  > | Most REST API `GET`, `HEAD`, and `OPTIONS` requests | 1 |
  > | Most REST API `POST`, `PATCH`, `PUT`, or `DELETE` requests | 5 |
  > **Some REST API endpoints have a different point cost that is not shared publicly.**"

- 状态查询能力的天花板：
  > "You can use the headers that are sent with each response to determine the current status of your **primary** rate limit."
  > "**There is not a way to check the status of your secondary rate limit.**"

- 超限响应：
  > "If you exceed your primary rate limit, you will receive a `403` or `429` response, and the `x-ratelimit-remaining` header will be `0`. …
  > If you exceed a secondary rate limit, you will receive a `403` or `429` response and an **error message that indicates that you exceeded a secondary rate limit**. If the `retry-after` response header is present, you should not retry your request until after that many seconds has elapsed. If the `x-ratelimit-remaining` header is `0`, you should not retry your request until after the time … specified by the `x-ratelimit-reset` header. **Otherwise, wait for at least one minute** before retrying. … **Continuing to make requests while you are rate limited may result in the banning of your integration.**"

- 头部抖动警告（对实验设计很关键）：
  > "Because GitHub processes API requests in multiple regions, rate limit values can vary from one response to the next based on the location handling the request. For example, `x-ratelimit-remaining` may be **higher on a later response** than on an earlier one within the same rate limit window. The `x-ratelimit-*` headers are the authoritative source … **avoid logic that depends on an exact remaining count.**"

### 1.2 实测样本 A：`GET /search/issues` 二级 403（完整头 dump） **[社区实测]**

来源：<https://github.com/hub4j/github-api/issues/2009>（2025-01-15，作者 yrodiere，`-Djdk.httpclient.HttpClient.log=all` 原始日志）

请求：`GET https://api.github.com/search/issues?...`（认证）

响应头（节选，原文照录）：

```
x-ratelimit-limit: 30
x-ratelimit-remaining: 21
x-ratelimit-reset: 1736942747
x-ratelimit-resource: search
x-ratelimit-used: 9
x-github-request-id: <NOPE>
（无 retry-after；无 gh-limited-by）
```

状态码 `403`；body 为 `You have exceeded a secondary rate limit. Please wait a few minutes before you try again.`

作者原话：
> "It appears GitHub APIs … can hit a secondary limit and just return a 403 error, with **no particular header indicating that a limit was reached**. No `Retry-After`, no `gh-limited-by`, nothing. **Only the body response explains** … (and in fact waiting 30s/1min is enough)."

**→ 结论：二级限流不体现在 `x-ratelimit-*` 头里。被拒时 remaining = 21 / 30，完全「看起来正常」。**

### 1.3 实测样本 B：`POST /user/repos`（内容创建桶）二级 403 **[社区实测]**

来源：<https://github.com/gofri/go-github-ratelimit/issues/9>（2023-04-28，johnmcollier）

完整响应头（原文摘录）：
```
X-Ratelimit-Limit:[5000]
X-Ratelimit-Remaining:[4840]
X-Ratelimit-Reset:[1682702662]
X-Ratelimit-Resource:[core]
X-Ratelimit-Used:[160]
（无 Retry-After）
```
body：
```
403 You have exceeded a secondary rate limit and have been temporarily blocked from
content creation. Please retry your request again later.
```

**→ 两个要点：**
1. `remaining = 4840/5000`（用了 160）仍然被二级拒 → **再次确证 secondary 与 `x-ratelimit-*` 无关**；
2. 这里触发的是**「内容创建」这条独立规则**，在 `used = 160` 时就被拒——与 900 点/分钟**无关**。
   **注意：star/unstar 是否属于「content creation」桶，官方未说明 [未确证]。**

### 1.4 实测样本 C：144 次请求逐窗口测量（`search/commits`） **[社区实测，单账号/单日]**

来源：<https://picklog.cc/blog/github-secondary-rate-limit>（2026-09-05，03:04–03:21 UTC，`gh` 2.92.0，个人 OAuth token，`gh api -i` 捕获头）

作者的关键观测：
- 26 次二级拒绝中，**`retry-after` 全部缺失**，`x-ratelimit-remaining` 落在 **22–27** 区间；
- 二级拒绝的 body 以 `You have exceeded a secondary rate limit` 开头，且 `documentation_url` 指向 secondary 锚点；primary 则以 `API rate limit exceeded for user ID` 开头；
- **被拒的请求照样消耗 primary 预算**：phase F 中连续 6 次 403 期间 `x-ratelimit-used` 依次为 3,4,5,6,7,8；
- 403 比 200 更快返回（0.43 s vs 1.76 s）→ 紧循环重试会迅速逼近封禁条件；
- `search/commits` 存在**官方从未披露的按端点上限：每 60 秒窗口只放行 2 次**，与 3/6/12/20 秒间隔无关；
- 同一次测量里，**30 次背靠背 `GET /repos/cli/cli` 全部 200**（未见二级限流）；
- 作者记录 phase B 的 core 预算为 `5,000 → 4,898`（变化 102），与其 30 次请求**不符**，作者未解释。

> 来源可信度说明：该站自称「由 AI 运营、无人在键盘前」，属**单一账号、单一 IP、单日**观测，不能作为官方事实；但它提供了目前能找到的**最完整的 secondary 头部级实测记录**。**[社区实测，中等可信度]**

### 1.5 存在 `retry-after` 的样本（并发场景） **[社区实测]**

来源：<https://github.com/orgs/community/discussions/56587>

> "I'm doing multi-threaded only GET requests (simultaneous) … 10 simultaneous GET requests with an interval between each of 0.2 seconds. … 870 GET requests … sometimes I get a 403 error … **on multiple urls with header retry-after: 60** (in seconds). This issue occurs when we access the github api on the server hosting provider GoDaddy … When I access the github api locally on my computer, there is no problem of secondary restrictions never."

**→ 并发 + 共享出口 IP 是高置信度触发器；且并发路径上 `retry-after: 60` 会出现。**

### 1.6 GitHub 为什么故意不给信号 **[官方员工（经社区转述）]**

来源：<https://github.com/hub4j/github-api/issues/2009>（yrodiere 转述 GitHub Support 回复，2025-01-20）

> "1. **Not adding `Retry-After` is essentially obfuscation designed to protect the service against abuse.**
> 2. The `gh-limited-by` header is **never returned by github.com** (only some GitHub Enterprise installs), and there are no plans to add it to this particular endpoint and/or to github.com."

同一 issue 中另一位来自企业的报告者（rozza-sb，2025-08-20，同样与 GitHub Support 沟通过）补充：
> "`gh-limited-by` is the header that isn't used … Separately from that but also confirmed by my support interaction, **`Retry-After` can be obfuscated, as in not appear in the response.**"

注：**这是二手转述，不是 GitHub 官方公开文档**，但与官方文档「无法查询 secondary 状态」的表述完全一致。**[官方员工，等级：转述]**

### 1.7 客户端库是怎么判定的（作为「唯一可行判据」的旁证） **[社区实测 / 库源码]**

`@octokit/plugin-throttling` 源码（<https://github.com/octokit/plugin-throttling.js/blob/main/src/index.ts>）：

```ts
if (/\bsecondary rate\b/i.test(error.message)) {
  // The user has hit the secondary rate limit. (REST and GraphQL)
  // The Retry-After header can sometimes be blank when hitting a secondary rate limit,
  // but is always present after 2-3s, so make sure to set `retryAfter` to at least 60s by default.
  const retryAfter =
    Number(error.response.headers["retry-after"]) ||
    state.fallbackSecondaryRateRetryAfter;   // 默认 60
  ...
}
```
```ts
groups.write = new Bottleneck.Group({
  id: "octokit-write",
  maxConcurrent: 1,
  minTime: 1000,      // ← 官方「变异请求间 ≥1 秒」的落地形式
  ...common,
});
```

`google/go-github` 里也有同类问题：#4180（2026-04-25）——`AbuseRateLimitError.Error()` 会把 `RetryAfter` **悄悄丢掉**；#3438（2025-01-17）——原本在没有 `retry-after` 时会退回 primary 的 reset 时间，**最长可能阻塞 1 小时**，因此新增了 `max retry after duration`。
来源：<https://github.com/google/go-github/issues/4180>、<https://github.com/google/go-github/pull/3438>

**→ 主流库的事实标准：靠 body 文案识别，无 `retry-after` 时默认等 60 秒。**

### 1.8 Q1 结论

| 问题 | 结论 | 等级 |
|---|---|---|
| 二级限流的响应长什么样 | `403`（也见 `429`）+ body 含 `You have exceeded a secondary rate limit…`；`x-ratelimit-*` 可能完全正常；`retry-after` 常常缺失，并发场景可见 `retry-after: 60` | **[官方]** + **[社区实测]** |
| secondary 是否体现在 `x-ratelimit-*` 里 | **不体现**。3 个独立样本（remaining=21 / 22–27 / 4840）均在远非 0 时被 403 | **[官方]** + **[社区实测]** ×3 |
| 判别手段 | 只有 body 文案（`documentation_url` 锚点也可辅助）；`retry-after` 存在与否不能作为「是否为二级」的判据 | **[社区实测]** |

---

## 2. Q2 — 公开的实测数据（star/unstar 专项）

### 2.1 核心事实：**没有任何一条针对 `PUT/DELETE /user/starred` 的公开限流实测** **[未确证]**

检索了 Stack Overflow、GitHub Community Discussions、GitHub Issues（Octokit / go-github / hub4j / gofri）、个人博客、以及多个「批量 unstar」开源工具，**未找到任何一份记录了这个端点被二级限流拒绝的样本**（无头信息、无 body、无次数/间隔记录）。

### 2.2 找到的「批量 unstar/star」工具的限流实践（弱证据，均未给出头信息） **[社区实测，弱]**

| 工具/来源 | 做法 | 是否记录过限流观测 | URL |
|---|---|---|---|
| kiku-jw/github-star-remover | `DELETE /user/starred/*`，**0.5 s 延迟**；README 自称 "Rate Limiting — Built-in delays to respect GitHub API limits"、"5,000 requests/hour … Script includes 0.5s delay (7,200 requests/hour max)" | ❌ 无 | <https://github.com/kiku-jw/github-star-remover> |
| WyattJia/batch_unstar | 拉取 0.5 s / **unstar 1.0 s** 延迟 | ❌ 无 | <https://github.com/WyattJia/batch_unstar> |
| mrdanishsaleem（dev.to，npm `github-unstar-pro`） | Octokit 顺序 `await`，**无显式延迟** | ❌ 无（只处理 404） | <https://dev.to/mrdanishsaleem/unclutter-your-github-stars-creating-an-npm-package-for-effortless-repo-unstarring-4g1f> |
| Veit Heller 博客 | Glamorous Toolkit 循环 `DELETE /user/starred/{o}/{r}` 约 **1400 次**，文中**未提及任何限流** | ❌ 无 | <https://blog.veitheller.de/Unstar_everything,_unfollow_everyone_(sorry).html> |

**注意**：`kiku-jw` 的 0.5 s 延迟明确**违反**官方「≥1 秒」建议，且它的 7,200 req/h「推算」忽略了这个事实——属于「能跑通 ≠ 合规」的典型例子，**不可作为安全依据**。

### 2.3 邻近端点的实测（可作为推断参考）

| 观测 | 数值 | 等级 |
|---|---|---|
| `POST /user/repos`（内容创建）二级拒 | `used = 160` 时被拒 | **[社区实测]** |
| `GET /repos/cli/cli` 背靠背 30 次 | **全部 200**，未触发二级 | **[社区实测]** |
| `GET /search/commits` 每 60 s 窗口 | **只放行 2 次**（3/6/12/20 s 间隔都一样），与 900 点无关 | **[社区实测]** |
| 10 并发 GET × 870（共享 IP） | 403 二级 + `retry-after: 60` | **[社区实测]** |
| 认证、每 2 s 一次、非并发、每次先查 `/rate_limit`，打 `search/code` | **仍被二级拒**，提问者无解 | **[社区实测，提问者自述]** <https://stackoverflow.com/questions/70030298/>（原页对抓取返回 403，正文经镜像核对：<https://codemia.io/knowledge-hub/path/continuously_hitting_the_github_secondary_rate_limit_even_after_following_the_best_practices>） |
| 反复请求同一 `search/issues` URL | 十几次（认证）/ 十几次（匿名）即 403；"waiting 30s/1min is enough" | **[社区实测]** |
| `GET /search/issues`（VS Code 扩展，6 条查询） | 打开 PR 列表即触发二级 403 | **[社区实测]** <https://github.com/microsoft/vscode-pull-request-github/issues/6601> |

### 2.4 对三个子问题的直接回答

| 子问题 | 回答 | 等级 |
|---|---|---|
| 是否有实测能在 900 点/分钟**以内**触发？ | **有，但都不在 star 端点**：内容创建桶（`used=160`）、按端点隐藏上限（`search/commits` 每窗口 2 次）、并发（10 并发）。**star 端点：未确证** | **[社区实测]** / **[未确证]** |
| 是否有人报告 1 秒间隔**已足够**？ | 未找到任何**带数据的**报告。只有工具默认值（1 s / 0.5 s）与 Octokit 的 `minTime: 1000` | **[未确证]** |
| 是否有报告在远低于 900 点/分钟时仍被拒？ | **有**（见上表第 1、3、4、5 行）。但**全部发生在非 star 端点**；star 端点是否也有隐藏桶 → **未确证** | **[社区实测]** / **[未确证]** |

---

## 3. Q3 — `GET /rate_limit` 能提供什么

来源：<https://docs.github.com/en/rest/rate-limit/rate-limit>、<https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api>

官方原文：
> "Accessing this endpoint **does not count against your REST API rate limit**."
> "You can call the `GET /rate_limit` endpoint for a periodic overview of all resource families for the authenticated user. Calling this endpoint does not count against your primary rate limit, but **it can count against your secondary rate limit**."
> "Use `GET /rate_limit` for a periodic overview … and **treat the response headers as authoritative if the two disagree**."
> "[reason header 与 /rate_limit 不一致时] The `x-ratelimit-*` headers are the authoritative source and may differ from values reported by the `GET /rate_limit` endpoint."
> "**There is not a way to check the status of your secondary rate limit.**"

响应结构示例（官方）只包含各 `resources` 家族的 **primary** 计数：

```json
{ "resources": { "core": { "limit": 5000, "used": 1, "remaining": 4999, "reset": 1691591363 },
                 "search": { "limit": 30, "used": 12, "remaining": 18, "reset": 1691591091 },
                 "graphql": { "limit": 5000, "used": 7, "remaining": 4993, "reset": 1691593228 },
                 ... } }
```

**结论：**
1. `GET /rate_limit` **只看得到 primary**（`core` / `search` / `graphql` … 各自的 limit/used/remaining/reset）；
2. **看不到 secondary 计数**，也没有任何字段能反映二级限流（官方明说无法查询）；
3. 它**不计 primary 但可能计 secondary** → 在实验里**绝不能**用轮询 `/rate_limit` 的方式探测二级限流状态，那是反效果（会自伤二级预算）；
4. 由于「多区域计数抖动」，`/rate_limit` 与响应头冲突时以**响应头**为准 → 快照只能作为趋势参考，不能作为精确差分依据。

---

## 4. Q4 — 安全实测协议（核心交付物）

### 4.0 设计原则

| 原则 | 落地 |
|---|---|
| 净状态不变 | 同一自有仓库 star→unstar→star 交替；结束时校验 star 状态 == 基线 |
| 不打第三方 | 只操作用户**自己拥有的仓库**；或只操作「已 star 的自己拥有的仓库」 |
| 串行、无并发 | 全程单进程、单标签页、严格 `await` 串行；先关闭所有其他会打 `api.github.com` 的工具/扩展（**包括 GithubStarManager 自身的周期同步/轮询**） |
| 分级推进 | L0（只读基线）→ L1（10×1s）→ L2（20×1s → 500ms → 250ms）→ 停止 |
| 明确止损 | 任一次 403/429 立即整轮停止 + 进入恢复流程 |
| 全字段记录 | 见 §4.3 |
| 可复现 | 记录时间、时区、出口 IP 类别、PAT 类型/scope、UA、脚本版本 |

### 4.1 P0 — 准备（零变异请求，零风险）

| 步骤 | 动作 | 说明 |
|---|---|---|
| P0.1 | 选定**测试仓库 R**：`R.owner == 自己的登录名` | 这是本协议最关键的风险控制。对自有仓库 star/unstar 不构成 AUP 意义上的「对他人项目的 rank abuse」。若没有自有可 star 仓库，退化为「已 star 的自有仓库」（若没有任何自有仓库，**不要**退化为第三方仓库；宁可放弃实验） |
| P0.2 | 创建 **classic PAT**，scope = `repo` | 依据 ADR `docs/adr/0004-write-requires-classic-pat.md`：写路径只支持 classic PAT；`repo`（而非 `public_repo`）用于覆盖私有仓库、避免整表 diff 误判。**do not** 用 fine-grained PAT（写他人公开仓库必然 403，会污染实验结论） |
| P0.3 | `GET /user`（或 `GET /rate_limit`）确认 token 身份与类型 | 记录 `x-oauth-scopes`；若 header 缺失需在报告中注明（PAT 走 `Authorization: Bearer`） |
| P0.4 | 记录**出口 IP 类别**（家宽 / 公司 / VPN / 云主机） | 因为 community #56587 显示共享 IP 会显著降低阈值。若走 VPN/云主机，**必须**在报告中标注，且不建议做 L2 |
| P0.5 | 记录 `GET /user/starred/{R.owner}/{R.repo}` 的**基线 star 状态 S0** | `204` = 已 star；`404` = 未 star。**注意**：`PUT` 文档还列出了 `304` 状态码，遇到 304 需单独标记 |
| P0.6 | 快照 `GET /rate_limit` 完整 JSON + 本地时间 | 基线 primary |
| P0.7 | 确认所有自动轮询/同步功能已停止 | 否则实验期间的 `x-ratelimit-used` 增量会被污染 |

> 关于「star 端点需要携带什么」：官方文档明确 **`PUT /user/starred/{owner}/{repo}` 需要把 `Content-Length` 设为 0**；成功返回 `204 No Content`；可能的错误码为 `304 / 401 / 403 / 404`。fine-grained 权限集为 `"Starring" user permissions (write)` + `"Metadata" repository permissions (read)`（classic 则用 `repo` scope）。
> 来源：<https://docs.github.com/en/rest/activity/starring>

### 4.2 P1 / L1 — 低强度试水（10 次，间隔 1000 ms）

- 单仓库 R，交替写以保持净状态不变：
  - 设第 0 次请求后状态为 S0。第 *i* 次请求（i = 1..N）的目标状态 = `S0 XOR (i % 2 == 1)`，即：**若当前状态 != 目标状态才发请求**。
  - 更稳的写法：每次请求前先 `GET /user/starred/{R}` 读实际状态（**计入 primary，但确定性更高**），仅当需要变更才发 PUT/DELETE。**代价**：GET 会让 `x-ratelimit-used` 增量中混入只读请求 → 见 §4.5 的「关键读数修正」。
  - 推荐折中：只在 L1 用「先读后写」保证正确性；L2/L3 用「盲交替」以便纯粹观察变异请求的计数效应，并在每级结束时读一次做对账。
- 每次请求之间 `sleep(1000ms)`（严格 ≥1 s 的墙钟差，不要用 `setInterval`）。
- **L1 停止判据（任一命中即停）：**
  1. 任何响应状态 ∉ {204}，除 304/403/429 之外的 4xx/5xx → 停止（基础设施/参数问题，与限流无关）；
  2. 收到 403/429 → **立即停止整轮**，进入 §4.6 止损；
  3. 10 次全部 204 → 记录并升级到 L2（L1 与 L2 之间静默 ≥60 s，并抓一次 `/rate_limit` 快照）。

### 4.3 L2 — 中强度（每级 20 次；间隔阶梯 1000 → 500 → 250 ms）

- 每一级结束：静默 ≥60 s → `GET /rate_limit` 快照 → 记录该级 `x-ratelimit-used` 增量 → 再决定是否降间隔。
- **不要**做「0 ms / 背靠背」级：那已明确属于官方不建议的「a large number of POST/PATCH/PUT/DELETE without waiting」，且对本问题（能否观测到 5 点与 1 s 建议）不需要它。
- **L2 停止判据（任一命中即停，且不再升级）：**
  1. 出现任一次 403/429（无论 primary/secondary）；
  2. 任一级出现非 204；
  3. 累计变异请求数达到 **60 次**上限（硬上限，见 §4.7）；
  4. 单级内观察到 `x-ratelimit-used` 出现**负增量**（多区域抖动）连续 ≥3 次 → 说明差分法在该环境下不可用，停止并只保留定性结论。

### 4.4 L3 —（可选，默认不做）并发探测

- 官方第一触发条件就是「并发 > 100」，而 community #56587 显示 **10 并发 + 共享 IP** 就已触发。
- 并发写同一仓库会互相覆盖状态，因此若一定要做，必须使用**多个自有的不同仓库**。
- **默认不做**。理由：(a) 并发是最接近「automated excessive bulk activity」的形态，AUP 风险最高；(b) 本协议要回答的问题是「变异请求是否被限流」而不是「并发多少会挂」；(c) 已有充足的公开证据。

### 4.5 每次请求必须记录的字段（Q4c）

**单请求级：**

| 字段 | 来源 | 用途 |
|---|---|---|
| `seq`、`local_time`(ISO-8601 带时区)、`phase`(P0/L1/L2) | 脚本 | 复现 |
| `method`、`url`、`owner/repo`、`body_bytes`(=0) | 脚本 | 复现（含 `Content-Length: 0` 校验） |
| `http_status` | 响应 | 主判据（204 / 304 / 403 / 429） |
| `x-ratelimit-limit` | 响应头 | primary 上限 |
| `x-ratelimit-remaining` | 响应头 | **差分主变量** |
| `x-ratelimit-used` | 响应头 | **差分主变量**（比 remaining 更直观） |
| `x-ratelimit-reset` | 响应头 | 窗口边界（epoch 秒） |
| `x-ratelimit-resource` | 响应头 | 必须确认是 `core` 而不是别的资源族 |
| `retry-after` | 响应头 | 有则**必须**照办 |
| `x-accepted-github-permissions` | 响应头 | 区分「权限 403」与「限流 403」（见 §4.9） |
| `x-oauth-scopes` | 响应头 | 确认 classic PAT / scope |
| `x-github-request-id` | 响应头 | **向 Support 求助时的唯一凭据**，必须留 |
| `date` | 响应头 | 服务器时间，用于对齐窗口 |
| `response_body`（前 2 KB，gzip 解码后的 UTF-8） | 响应体 | **二级限流的唯一判据** |
| `latency_ms`（TTFB 与总时长分别记） | 脚本 | picklog 观测到 403 比 200 快得多，可作辅助特征 |
| `star_state_after`（若有先读后写） | 脚本 | 对账 |

**快照级（每级开始/结束各一次）：**

| 字段 | 来源 |
|---|---|
| `GET /rate_limit` 完整 JSON（`resources.core/search/graphql/...` 各自 limit/used/remaining/reset） | 只读 |
| 本地时间、自上一快照的耗时 | 脚本 |
| 本次快照的 `x-ratelimit-used`（core） | 响应头 |

> **关键读数修正**：`GET /rate_limit` **本身不计 primary 但可能计 secondary**，所以它在实验图景里既不是「免费」也不是「纯只读」——**不要高频调用它**，每级 2 次即可。

### 4.6 止损与恢复（Q4e）

**触发条件**：任一次响应 ∈ {403, 429}。

```
1. 立即停止一切请求 —— 包括 GET /user/starred、GET /rate_limit。
   （官方：Continuing to make requests while you are rate limited may result in the banning of your integration.）
2. 解析并记录：
   a. 若 body 含 "secondary rate limit" → 二级限流，记录 x-ratelimit-remaining 与 retry-after 是否存在；
   b. 若 body 含 "API rate limit exceeded" 且 x-ratelimit-remaining == 0 → primary 耗尽；
   c. 若 body 含 "Resource not accessible" / "not accessible by personal access token"
      → 权限问题（见 ADR 0004），不是限流，按权限问题处理并终止实验。
3. 计算等待 W：
   W = retry-after（若存在且为正整数）
       否则 = max(0, x-ratelimit-reset - now)（若 remaining == 0）
       否则 = 60 秒（官方兜底）
4. 等待期间**不发送任何请求**（尤其不要轮询 /rate_limit 探测）。
5. 恢复验证（单次探测）：等待 W 后，发 1 次 GET /user/starred/{R.owner}/{R.repo}
   - 204 或 404 → 认为已恢复；继续做「状态复原」（第 6 步）后结束实验；
   - 仍 403/429 → 指数退避：W = 60 → 120 → 240 秒；最多 3 次。
   - 3 次后仍失败 → 终止实验，记录「未能验证恢复时间」，24 小时内不再重试。
6. 状态复原：确认 R 的 star 状态 == S0。
   - 若不一致：优先在**网页 UI 手动**修正（1 次操作），不要用脚本连续重试；
   - 若连手动也失败，记录为「待复原」，并在报告中明确说明。
7. 结束实验：把本次 403/429 的完整字段（含 x-github-request-id）写入报告。
```

**恢复时长预期（社区观测）：** 二级限流在 `search` 端点约为 **30–65 秒**即恢复，且与 `x-ratelimit-reset` 的 60 秒窗口边界对齐；官方建议「没有 `retry-after` 时至少等 1 分钟」是**保守上限**。**[社区实测]**
（`search/commits` 的 picklog 测量：窗口内第 59.5 秒重试仍 403，下一窗口第 0.1 秒即 200。）

### 4.7 硬上限与「不做」清单

| 项 | 上限 |
|---|---|
| 单次实验会话的变异请求总数 | **≤ 60 次**（≈ 300 点，远低于 900 点/分钟与任何合规阈值） |
| 测试仓库数 | **1 个**（自有）；L3 若做则 ≤3 个（自有） |
| 并发数 | **1**（L3 默认不做） |
| 单个测试仓库的净状态变化 | **0**（S0 → S0） |
| 每日实验轮次 | ≤ 2 轮，轮间 ≥ 1 小时 |
| 403/429 后的重试探测次数 | ≤ 3 次（指数退避） |

### 4.8 判定矩阵（观测结果 → 能得出什么结论）

> **前置修正**：官方把「5 点/请求」放在 *"Calculating points for the secondary rate limit"* 之下，而 primary 的表述是 *"5,000 **requests** per hour"*。因此规范上，**primary 的 `x-ratelimit-*` 应对每个请求（不论 GET 还是 PUT/DELETE）恰好 −1**。若观测到每次 PUT 让 `remaining` −5，那**与官方文档矛盾**，是需要复核的重要发现，而**不是**「点数表生效」的证明。任务描述里的「remaining 每秒降 5 → 说明点数表在生效」这一预设，按官方文档结构**不成立**——这是本报告对需求的一处纠正。

| # | 观测结果 | 可得的结论 | 强度 |
|---|---|---|---|
| D1 | 全部 204；`x-ratelimit-used` 每请求 **+1**（PUT/DELETE 与 GET 相同），无跨区域异常 | primary 按「请求数」计数；5 点表不作用于 primary。**本实验对 primary 记账无新信息** | 确认官方文档（[推断] → 实测） |
| D2 | 全部 204；`x-ratelimit-used` 每 PUT **+5** | **与官方文档冲突**：REST primary 也按点数计。需用不同时段重复至少 2 轮、并排除多区域抖动后再下定论 | 强发现（需复核） |
| D3 | 出现 `x-ratelimit-used` 增量为 0 或**负**、remaining 时高时低 | 命中官方所述的「多区域计数抖动」；**差分法在此环境不可用**，只能做定性结论 | 说明实验环境受限 |
| D4 | L1（10×1 s）全 204 | 「10 次变异请求 @1 s」安全。**不能**外推到「<900 点安全」 | 弱（下界） |
| D5 | L2 各级（20×1 s / 500 ms / 250 ms）全 204，累计 60 次变异 → 300 点，全部落在 60 s 窗口内的最坏情况 ≤ 900 点 | **在 900 点/分钟边界内未观测到二级限流**；与官方「900 点为上限」一致 | 中 |
| D6 | 出现 403/429，body 含 `secondary rate limit`，且 `x-ratelimit-remaining > 0`、无 `retry-after` | **直接回答主问题：star 端点会触发二级限流；且 `x-ratelimit-*` 不能作为判据** | **强**（这正是要抓的现象） |
| D7 | 出现 403/429 + `retry-after: 60` | 与并发/滥用路径样本一致；说明该次触发接近「滥用防护」而非「按端点预算」 | 中 |
| D8 | 出现 403 + body 含 `API rate limit exceeded` + `x-ratelimit-remaining == 0` | primary 耗尽，与 secondary 无关 → 排除；说明实验强度已到小时级上限 | 排除项 |
| D9 | 出现 403 + body 含 `Resource not accessible` / `not accessible by personal access token` | fine-grained PAT 权限缺陷（ADR 0004），**不是限流**；该轮数据作废 | 排除项 |
| D10 | 403 的 `latency_ms` 显著低于同轮 200 的 `latency_ms` | 与 picklog 观测一致（0.43 s vs 1.76 s），可作辅助特征 | 弱（旁证） |
| D11 | 403/429 后的恢复时间 ≈ 60 s（或恰在 `x-ratelimit-reset` 后第一次成功） | 二级限流窗口与 primary 的 60 s 窗口同源 | 中（与社区一致） |
| D12 | 恢复时间远大于 60 s（如 ≥ 300 s） | 触发的是更严厉的滥用防护（可能叠加账户级），需立即终止全部实验 | 强（停止信号） |
| D13 | L1 就出现 403，且出口是 VPN/云主机/共享 IP | 阈值被共享 IP 显著下调（community #56587 同构）；**本轮结论不可外推到家庭宽带** | 说明环境偏差 |
| D14 | 全程 204，但 `x-ratelimit-resource` 不是 `core` | 请求打到了非预期资源族（如代理/中间层重写），数据作废 | 排除项 |

### 4.9 如何区分「限流 403」与「权限 403」

| 特征 | 限流 403 | 权限 403 |
|---|---|---|
| body | `You have exceeded a secondary rate limit…` 或 `API rate limit exceeded for user ID …` | `Resource not accessible by personal access token` / `…by integration` |
| `retry-after` | 可能缺失，可能 60 | 不可能出现 |
| `x-ratelimit-remaining` | 二级时 > 0；primary 时 == 0 | 正常值 |
| `x-accepted-github-permissions` | 无特殊信号 | 会列出所需权限集（如对 star 端点即 `starring=write,metadata=read`） |
| GitHub 官方指引 | <https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api#exceeding-the-rate-limit> | <https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api#resource-not-accessible> |

来源：<https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api>
（官方原文：*"You can use the `X-Accepted-GitHub-Permissions` header to identify the permissions that are required to access the REST API endpoint. The value … is a comma separated list … `X-Accepted-GitHub-Permissions: contents=read` …"*）

---

## 5. Q5 — 替代的低风险验证

| 方案 | 做法 | 能回答什么 | 局限 |
|---|---|---|---|
| A1 只读标定 primary | 连续 N 次 `GET /repos/{o}/{r}`（或 `GET /user`），记录 `x-ratelimit-used` 增量；再用 1 次 PUT 记录增量 | 「GET 是否每次 −1」可零变异确认；「PUT 是否也 −1」**仍需 1 次变异请求** | 无法在「零变异」下回答核心问题；多区域抖动会使差值不稳，需多轮取中位数 |
| A2 `GET /rate_limit` 窗口观测 | 只调 `/rate_limit`，看 `core.used` 的 60 s 窗口内增量 | 只能标定 **primary**；**看不到 secondary** | 官方明说无 secondary 可见性；且调用本身**可能计 secondary**；官方又说 `x-ratelimit-*` 才是权威 → 双源冲突时无法裁决 |
| A3 借 `search` 端点做「廉价的二级触发器」 | 复现 `GET /search/issues` 十几次 | **能验证「无法用头判别、只能看 body」**（这是问题 Q1，不是 Q2） | 与 star 端点**不是同一个桶**；不能推出 star 端点行为；会消耗 search 的独立 primary 配额（30/min） |
| A4 网页 UI 点击 star 按钮 | 人工点击，观察 DevTools Network | 观察 UI 走的请求形态 | **等价于发变异请求**，无风险优势；且无法自动化采样 |
| A5 Actions 的 `GITHUB_TOKEN` | 在 Actions 里调 API | 无 | `GITHUB_TOKEN` 是 1,000 req/h **按仓库**，且**只能操作本仓库资源**——star 是用户级操作，**根本发不出来** |
| A6 全新测试账号 | 隔离风险 | 无 | AUP §4 明确禁止「fake accounts / coordinated inauthentic activity」；新账号本身即风控敏感对象 → **不推荐** |
| A7 只读「他人已公开的实测」 | 就是本报告 Q2 的做法 | 已确认：**star 端点无公开实测** | 证据空白无法靠只读填补 |

**结论（局限）**：二级限流的唯一判据是**响应体文案**，而触发它**必然**需要发出足够多的变异请求。因此「零变异验证」在原理上不可能回答 Q2；任何零变异方案最多只能标定 primary。**这是本协议必须真的发少量变异请求的根本原因**——也就是为什么「最小化风险」比「零风险」是更现实的设计目标。

---

## 6. Q6 — 「1 秒间隔」的效力

### 6.1 官方原文（两句都出自 best-practices）**[官方]**

来源：<https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api>

> "### Avoid concurrent requests
> To avoid exceeding secondary rate limits, you should make requests **serially instead of concurrently**. To achieve this, you can implement a queue system for requests."

> "### Pause between mutative requests
> If you are making a large number of `POST`, `PATCH`, `PUT`, or `DELETE` requests, **wait at least one second between each request**. **This will help you avoid secondary rate limits.**"

**措辞要点**：原文是 *"This will help you avoid"* —— **是缓解建议，不是保证**。官方从未声明「1 秒间隔 ⇒ 不触发二级限流」。

### 6.2 社区对照：支持「1 秒够用/合规」

| 证据 | 内容 |
|---|---|
| Octokit `plugin-throttling` | `groups.write = { maxConcurrent: 1, minTime: 1000 }` —— 官方维护的客户端把「1 秒 + 串行」实现为写请求的默认节流 **[库源码]** |
| WyattJia/batch_unstar | unstar 用 1.0 s 延迟，明写 "RATE LIMITING … 1.0s between requests" **[社区]** |
| Veit Heller | 约 1400 次不间断 `DELETE /user/starred/*`（文中未提延迟）**未提及被限流** **[社区，弱]** |

### 6.3 社区对照：反对「1 秒足够」

| 证据 | 内容 |
|---|---|
| 官方自己的第一触发条件 | 「并发 > 100」被列在**第一条**，而「变异请求 1 秒」只是 best-practice → 官方结构上就承认**并发才是主要触发器** **[官方]** |
| community #56587 | 10 并发 + 共享 IP（GoDaddy）→ 403 + `retry-after: 60`；同一代码在本地机器上「never」触发 **[社区实测]** |
| SO 70030298 | 认证、**每 2 秒**一次、**非并发**、每次预先查 `/rate_limit`，打 `search/code` **仍被二级拒**；有回复者称「只是在浏览器里用 GitHub 搜索也被限流」 **[社区实测]** |
| hub4j #2009 | 反复请求同一 `search/issues` URL，十几到二十几次即 403 **[社区实测]** |
| picklog | `search/commits` 每 60 s 窗口**只放行 2 次**，3/6/12/20 s 间隔都无法改变边界 —— 「按未披露原因」的端点级上限，与 1 秒建议无关 **[社区实测]** |
| gofri #9 | 内容创建桶在 `used = 160` 时触发，远低于 900 点/分钟 **[社区实测]** |

### 6.4 Q6 结论

> **「1 秒间隔」是对「大量变异请求」场景的必要但不充分条件。**
> - 它在**串行**的前提下可有效降低「突发的变异请求密度」，这也是 Octokit 落地的形态（串行 + 1000 ms）；
> - 它**不能**保证越过二级限流：并发的真实触发器（并发数）、按端点的未披露上限、内容创建桶、共享 IP、以及其他「未披露原因」都可能独立触发；
> - **针对 `PUT/DELETE /user/starred` 是否也有隐藏桶 → 未确证**。这正是 §4 协议存在的意义。

---

## 7. 对照表：官方文档 vs 社区实测

| 事项 | 官方文档 | 社区实测 / 库事实 | 一致性 |
|---|---|---|---|
| 变异请求（PUT/DELETE）点数 | 5 点（在 *secondary* 点数表内） | **无 star 端点测量**；`gh-api-benchmark` 作者按 5 点做推算 | **无法验证（star 端点）** |
| 5 点是否作用于 primary | 否 —— primary 表述为 "5,000 **requests** per hour"；点数表属 secondary 小节 | 无显式测量。picklog 记录 core `5,000→4,898`（差 102）与 30 次请求不符，**该数字无法解释** | **未确证** |
| secondary 是否体现在 `x-ratelimit-*` | 不体现（"There is not a way to check the status of your secondary rate limit."） | 3 个独立样本：remaining = 21 / 22–27 / 4840 时仍被 403 | **一致** |
| `retry-after` | 有则遵守；否则至少等 1 分钟 | 常缺失（`search/commits` 26/26 缺；`/user/repos` 缺）；并发场景出现 `60` | 官方允许缺失，**一致** |
| 恢复时长 | ≥ 1 分钟（无 retry-after 时） | 实测 30–65 秒即恢复（picklog）；"waiting 30s/1min is enough"（hub4j #2009） | 官方偏保守 |
| 「1 秒间隔」 | "wait at least one second … will help you avoid" | 未见直接反例；但 2 s 间隔 + 非并发在 `search` 上**仍被拒** | **不能外推** |
| 900 点/分钟（单端点） | 明确 | 有远低于 900 点即被拒的案例（`used=160`、每窗口 2 次）——但**均非 star 端点** | **star 端点未确证** |
| 并发 ≤100 | 明确 | 10 并发 + 共享 IP 即被拒（比 100 更严） | 一致但更严 |
| 内容创建 80/min、500/h | 明确；未列出哪些端点 | `POST /user/repos` 在 `used=160` 被拒 | 一致 |
| 403 vs 429 的选择规则 | 只说「403 或 429」 | 实测样本全是 403；未见 429 样本 | **未确证（何时 429）** |
| `gh-limited-by` | 官方文档中未作为通用手段提及 | Support 确认 github.com **从不返回** | 一致 |
| 401/403/404/304 语义（star 端点） | 官方列出 `204/304/401/403/404` | 无针对 star 的实测 | 未确证 |

---

## 8. 伦理与合规边界

### 8.1 明确「不该做」的实验 **[官方]**

来源：<https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies>

AUP §4（Spam and Inauthentic Activity）原文：
> "We do not allow content or activity on GitHub that is: automated excessive bulk activity and coordinated inauthentic activity, such as spamming … ; inauthentic interactions, such as **fake accounts** and automated inauthentic activity; **rank abuse, such as automated starring or following**; creation of or participation in secondary markets for the purpose of the proliferation of inauthentic activity; … **using our servers for any form of excessive automated bulk activity, to place undue burden on our servers through automated means** …"

AUP §5（Site Access and Safety）：
> "uses our servers to disrupt or to attempt to disrupt … any service, device, data, account or network."

| 禁止项 | 依据 |
|---|---|
| 对**大量第三方仓库**批量 star/unstar（无论是否切回） | AUP §4 "rank abuse, such as automated starring"、"automated excessive bulk activity" |
| 用多账号 / 多 token 轮换以绕过限流 | AUP §4 "fake accounts"、"inauthentic interactions"；API ToS（GitHub ToS §H） |
| 触发 403/429 后继续重试轰炸 | 官方：*"Continuing to make requests while you are rate limited may result in the banning of your integration."* |
| 高并发压测 `api.github.com`（>100 并发 / 大规模背靠背） | AUP §4 "undue burden on our servers through automated means"、§5 "disrupt … any service"、§9 Excessive Bandwidth Use |
| 把实验做成「对真实 star 列表的净变化」（真删星不回填） | 属「automated bulk activity」；也破坏了实验的可逆性前提 |
| 用 Actions 的 `GITHUB_TOKEN` 或新建账号来「隔离风险」 | `GITHUB_TOKEN` 无法 star（用户级操作）；新账号 = AUP 禁止的 fake account |

### 8.2 本协议为何落在可接受范围内

| 维度 | 本协议的做法 | 为什么可接受 |
|---|---|---|
| 操作对象 | **只操作自己拥有的仓库** / 自己的 star 列表（自己对自己） | 不产生对第三方项目的 rank 影响；不构成 "automated starring" 意义上的操纵 |
| 净结果 | star → unstar → star，**净状态不变（S0 → S0）** | 无持久数据变化，无社会性后果 |
| 规模 | 单轮变异请求 **≤60 次**（≈300 点），单仓库，轮间 ≥1 小时 | 远低于 900 点/分钟、80 内容创建/分钟、500/小时、100 并发；也不构成 "excessive bulk activity" |
| 形态 | **严格串行、无并发**，与官方 best-practices 一致 | 正是官方推荐的队列化形态 |
| 停止机制 | 任一次 403/429 立即停止；重试 ≤3 次指数退避 | 严格遵守「不得在被限流期间继续请求」 |
| 目的 | 为**用户自己的工具**做风险标定（节流参数），并将结论公开化 | 与被 AUP 禁止的「刷星/水军」目的不同 |
| 附带要求 | 关闭 GithubStarManager 的周期同步，避免与实验混淆 | 也是减少总请求量的措施 |

> **提示**：本协议的合规性来自于「自己对自己 + 极小规模 + 净状态不变 + 串行」。任何一项被破坏（例如换成第三方仓库、提高到数千次、加入并发），就会滑入 AUP §4/§5 的禁止范围。

---

## 9. 附：可直接使用的记录模板（未执行，仅模板）

> 注意：以下内容为**协议模板**，本次调研**未运行**。请在实际执行时填写。

```
实验元数据
├─ 日期/时区：
├─ 脚本版本 / UA：
├─ 出口 IP 类别（家宽 / 公司 / VPN / 云）：
├─ PAT 类型（classic / fine-grained）与 scope：
├─ 测试仓库 R（owner/repo，owner == 自己）：
├─ 基线 star 状态 S0（204 / 404）：
└─ /rate_limit 基线快照（raw JSON）：

单请求记录（CSV 列）
seq, local_time, phase, method, url, status, rl_limit, rl_remaining, rl_used,
rl_reset, rl_resource, retry_after, accepted_permissions, oauth_scopes,
request_id, server_date, latency_ttfb_ms, latency_total_ms, body_head_2kb
```

**L1/L2 停止判据速查卡**

```
if status == 204:                    continue（记录 used 增量）
elif status in (403, 429):           STOP → §4.6 止损
elif status == 304:                  记录为异常（PUT 文档列出 304，含义待查）→ STOP
elif body 含 "Resource not accessible": STOP（权限问题，非限流）
else:                                STOP（参数/基础设施问题）
累计变异请求 >= 60:                  STOP（硬上限）
```

---

## 10. 未能查证（明确列出）

1. **`PUT/DELETE /user/starred/{owner}/{repo}` 是否有任何公开的实测触发记录**（次数 / 间隔 / 响应头 / body）。→ 检索范围覆盖 Stack Overflow、GitHub Community、Octokit / go-github / gofri / hub4j 的 issues、个人博客、多个批量 unstar 工具仓库，**均无**。
2. **star/unstar 端点是否属于 AUP 之外的「content creation」桶**（80 次/分钟、500 次/小时）——官方未列出适用端点。
3. **star 端点的实际点成本是否为 5**——官方明说「Some REST API endpoints have a different point cost that is not shared publicly」。
4. **一次 PUT/DELETE 是否让 primary 的 `x-ratelimit-used` 恰好 +1**——无实测样本；picklog 的 `5,000→4,898`（30 次请求却变化 102）无法解释，该数字本身可信度存疑。
5. **「1 秒间隔」是否有任何带数据的正/反实测对照**——只有工具默认值，没有对照实验。
6. **403 与 429 在二级限流场景下的选择规则**——官方只说「403 或 429」；本报告收集到的实测样本**全是 403**，未见 429 样本。
7. **二级限流的恢复窗口是否与 primary 的 60 秒窗口严格同源**——只有 picklog 单一账号单日的一条观测。
8. **「只对自己拥有的仓库 star/unstar」是否会被 AUP 的 "automated starring" 覆盖**——官方无针对此情形的明确指引；本协议的合规判断是基于 AUP 条文的**推断**，不是官方确认。
9. **`PUT /user/starred` 的 `304 Not Modified` 语义**（官方文档把它列为可能状态码）——未找到任何解释；协议中把它当作异常处理。
10. **2026-07 起 stargazers 列表端点的新访问限制**（官方 changelog：*"Access to the stargazers listing endpoints will be limited to admins and collaborators."*，<https://docs.github.com/en/rest/activity/starring>、<https://github.blog/changelog/2026-06-30-upcoming-access-restrictions-to-public-api-endpoints-and-ui-views/>）对本实验的**间接**影响（若实验中想通过 stargazers 列表核对 star 是否生效，可能受限）——未进一步验证。

---

## 11. 参考来源列表

### 官方文档
1. Rate limits for the REST API — <https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api>
   （原始 Markdown：<https://github.com/github/docs/blob/main/content/rest/using-the-rest-api/rate-limits-for-the-rest-api.md>）
2. Best practices for using the REST API — <https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api>
3. Troubleshooting the REST API — <https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api>
4. REST API endpoints for rate limits（`GET /rate_limit`）— <https://docs.github.com/en/rest/rate-limit/rate-limit>
5. REST API endpoints for starring（`PUT/DELETE /user/starred/{owner}/{repo}`，含 `Content-Length: 0` 与 fine-grained 权限集）— <https://docs.github.com/en/rest/activity/starring>
6. GitHub Acceptable Use Policies（§4 / §5 / §9）— <https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies>
7. GraphQL rate limits（对照：GraphQL mutation 5 点）— <https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api>
8. 2026-06-30 changelog：stargazers 列表端点访问限制 — <https://github.blog/changelog/2026-06-30-upcoming-access-restrictions-to-public-api-endpoints-and-ui-views/>

### 实测样本与社区证据
9. hub4j/github-api #2009（`GET /search/issues` 二级 403 的**完整头 dump**；Support 回复「不返回 Retry-After 是混淆设计」）— <https://github.com/hub4j/github-api/issues/2009>
10. hub4j/github-api #1975（secondary 限流无法预先查询的架构讨论；GraphQL 的 `RATE_LIMITED` 不体现为 HTTP 错误）— <https://github.com/hub4j/github-api/issues/1975>
11. gofri/go-github-ratelimit #9（`POST /user/repos` 二级 403：`remaining 4840/5000`、`used 160`、无 `Retry-After`）— <https://github.com/gofri/go-github-ratelimit/issues/9>
12. community discussion #56587（10 并发 GET × 870，403 二级 + `retry-after: 60`；本地无此问题）— <https://github.com/orgs/community/discussions/56587>
13. community discussion #141073（匿名用户更低阈值；Support 拒绝披露方法）— <https://github.com/orgs/community/discussions/141073>
14. picklog.cc：144 次请求逐窗口测量 `search/commits`（26 次二级拒绝全无 `retry-after`、`remaining 22–27`、403 也计 `used`、每窗口只放行 2 次）— <https://picklog.cc/blog/github-secondary-rate-limit>
15. oktokit plugin-throttling 源码（`/\bsecondary rate\b/i` 判定；`write` 组 `minTime: 1000`；`fallbackSecondaryRateRetryAfter: 60`）— <https://github.com/octokit/plugin-throttling.js/blob/main/src/index.ts>
16. google/go-github #3438（无 `retry-after` 时退到 primary reset，最长阻塞 1 小时 → 新增 max retry after）— <https://github.com/google/go-github/pull/3438>
17. google/go-github #4180（`AbuseRateLimitError.Error()` 丢失 `RetryAfter`）— <https://github.com/google/go-github/issues/4180>
18. microsoft/vscode-pull-request-github #6601（6 条 GraphQL 查询刷新 PR 列表即触发二级 403，带 request ID）— <https://github.com/microsoft/vscode-pull-request-github/issues/6601>
19. Stack Overflow 70030298：认证、每 2 秒、非并发、每次先查 `/rate_limit`，`search/code` 仍被二级拒 —— <https://stackoverflow.com/questions/70030298/>（原页对抓取返回 403；正文经镜像核对：<https://codemia.io/knowledge-hub/path/continuously_hitting_the_github_secondary_rate_limit_even_after_following_the_best_practices>）
20. ambient-code/gh-api-benchmark（把「每 WRITE = 5 点 vs 900 点/分钟」写进设计文档，并同时度量 5,000 req/h 消耗）— <https://github.com/ambient-code/gh-api-benchmark>

### 批量 unstar/star 工具（限流处理的实践证据，弱）
21. kiku-jw/github-star-remover（0.5 s 延迟，自称「respects rate limits」）— <https://github.com/kiku-jw/github-star-remover>
22. WyattJia/batch_unstar（unstar 1.0 s 延迟）— <https://github.com/WyattJia/batch_unstar>
23. dev.to：npm `github-unstar-pro`（顺序 await，无显式延迟）— <https://dev.to/mrdanishsaleem/unclutter-your-github-stars-creating-an-npm-package-for-effortless-repo-unstarring-4g1f>
24. Veit Heller：约 1400 次 unstar + 170 次 unfollow 的脚本经历（未提限流）— <https://blog.veitheller.de/Unstar_everything,_unfollow_everyone_(sorry).html>

### 本仓库内相关决策（协议设计依据）
25. `docs/adr/0003-sync-report-and-restore.md`（全局串行队列 + 变异请求间隔 ≥1 s）
26. `docs/adr/0004-write-requires-classic-pat.md`（写路径只支持 classic PAT；fine-grained 写他人公开仓库必然 403）
27. `AGENTS.md` D3 / D6–D8（token、同步与数据权威、完整性红线）
