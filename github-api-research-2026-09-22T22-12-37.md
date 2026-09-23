# 调研报告：以「我 star 的仓库列表」为主获取内容的 GitHub API 最优方案

> 场景：Tampermonkey 用户脚本，运行在 github.com 页面，已有用户 PAT，通过 `fetch` 直连 `api.github.com`（CORS 可用）。
> 调研日期：2026-09-22。方法：官方文档（docs.github.com）原文精读 + 本机实测（curl 实际请求 api.github.com 验证 ETag/304/payload）+ 业界实践文章交叉验证。
> 标注「实测」的证据为本次调研直接对 api.github.com 发起请求所得；标注「估算」的为基于实测数据的推算，非官方数字。

---

## 0. 概览

- **REST `GET /user/starred` + `Accept: application/vnd.github.star+json` 是本场景的最优解**：每页 100 条、字段完整、原生支持 ETag 条件请求（304 不计速率额度，已实测验证）、实现最简单。
- GraphQL `user.starredRepositories` 字段可裁剪、payload 更小，但**不支持条件请求（无 ETag 缓存）**、需要手写查询与游标翻页，且连接带 `isOverLimit` 截断标记（重度用户列表可能被截断）。
- 两个端点都**没有 `since`/游标配量**；增量感知靠 `sort=created&direction=desc` + 返回的 `starred_at` 只拉第 1 页比对 + ETag 304。
- **API 搜索无法限定「我 star 过的仓库集合」**——官方仓库搜索 qualifier 全表无任何 starred 相关限定；业界做法是全量拉取本地缓存 + 本地搜索。
- 2000 star ≈ 20 页 = 20 请求，占认证额度 5000/h 的 **0.4%**，余量极其充裕；条件请求 304 还不计额度。
- fine-grained PAT 需要 **Starring 用户权限（读/写）**；CORS 官方明示支持任意源（`Access-Control-Allow-Origin: *`），userscript 直连无障碍。

---

## 1. REST `GET /user/starred` vs GraphQL `user.starredRepositories`

### 1.1 REST：`GET /user/starred`

**分页与参数**（官方文档原文，[docs: REST API endpoints for starring](https://docs.github.com/en/rest/activity/starring)）：

> `per_page` integer — *The number of results per page (max 100).* Default: 30
> `sort` string — *The property to sort the results by. `created` means when the repository was starred. `updated` means when the repository was last pushed to.* Default: `created`，可选 `created` / `updated`
> `direction` string — Default: `desc`，可选 `asc` / `desc`

**star+json 媒体类型**（同页原文）：

> *application/vnd.github.star+json: Includes a timestamp of when the star was created.*

该端点的状态码表中**显式包含 `304 Not modified`**（同页原文：`200 OK / 304 Not modified / 401 / 403`）。

**返回字段**（实测：`GET /users/octocat/starred?per_page=1` + `Accept: application/vnd.github.star+json`，条目结构为 `{starred_at, repo}`）：`repo` 是完整 Repository 对象，实测包含你清单里的全部字段：

| 需求字段 | REST (`star+json`) |
|---|---|
| name / 描述 | `name`, `full_name`, `description` ✅ |
| primaryLanguage | `language` ✅ |
| stargazersCount | `stargazers_count` ✅ |
| forksCount | `forks_count` ✅ |
| updatedAt / pushedAt | `updated_at`, `pushed_at` ✅ |
| topics | `topics` ✅ |
| license | `license`（spdx_id 等）✅ |
| 仓库数字 ID | `id`（如 64413545）✅ + `node_id` |
| owner | `owner`（login/id/avatar_url…）✅ |
| star 时间 | `starred_at` ✅（仅 star+json） |

**payload 大小（实测）**：单条 star+json 条目 JSON ≈ **5.7 KB**（`per_page=1` 响应 6343 B，其中条目序列化 5664 B）；纯 `application/vnd.github+json`（无 star 时间）单页 ≈ 6077 B。→ 2000 star 全量 ≈ **12–13 MB（实测外推）**，20 页。

### 1.2 GraphQL：`user.starredRepositories`（`viewer.starredRepositories` 同字段）

官方定义（[docs: GraphQL Users reference](https://docs.github.com/en/graphql/reference/users)，`viewer` 类型即 `User`）：

> `starredRepositories` (StarredRepositoryConnection!): *Repositories the user has starred.*
> Arguments: `after` / `before` / `first` (Int) / `last` (Int) / `orderBy` (StarOrder) / `ownedByViewer` (Boolean)

**每页上限 100**（[docs: Using pagination in the GraphQL API](https://docs.github.com/en/graphql/guides/using-pagination-in-the-graphql-api)）：

> *The value of these arguments must be between 1 and 100.*（`first`/`last`）

**排序**（官方 activity 参考页，经 `docs.github.com/api/article/body` 取正文）：

> `StarOrder` input：`direction` (OrderDirection!)、`field` (StarOrderField!)
> `StarOrderField` 唯一取值：`STARRED_AT` — *Allows ordering a list of stars by when they were created.*

**连接/边字段**（[docs: GraphQL Repos reference](https://docs.github.com/en/graphql/reference/repos)）：

> `StarredRepositoryConnection`: `edges` / `nodes` ([Repository]) / `pageInfo` / `totalCount` / **`isOverLimit` (Boolean!) — *Is the list of stars for this user truncated? This is true for users that have many stars.***
> `StarredRepositoryEdge`: `cursor` / `node` (Repository!) / **`starredAt` (DateTime!) — *Identifies when the item was starred.***

**Repository 字段覆盖**（同页）：`databaseId`（数字主键）、`name`、`nameWithOwner`、`description`、`primaryLanguage`、`stargazerCount`、`forkCount`、`updatedAt`、`pushedAt`、`repositoryTopics`、`licenseInfo`、`owner`、`id`（node id）、`visibility` —— 需求清单全覆盖，且 topics/license 是**子连接/对象按需取**，不取就不出现在 payload 里。

**payload 大小（估算）**：按需选 12 个标量字段（name/描述/语言/star 数/fork 数/时间/topics 名/license/数字 ID/owner）估算每条 **≈ 0.4–0.6 KB**，2000 star ≈ 0.8–1.2 MB —— 约为 REST 的 **1/10**（估算，未能实测：GraphQL 需要认证 token，本次无 token 无法实测；实测无认证 POST /graphql 返回 403）。

**实现复杂度**：REST = `fetch` + 解析 `Link` 头翻页即可；GraphQL = 需写查询、管理 `pageInfo.endCursor` 游标、按点数公式估算成本、处理 10 秒超时（[docs: GraphQL rate limits](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api)：*If GitHub takes more than 10 seconds to process an API request… you will receive a timeout*）与 500,000 节点上限。

**注意**：GraphQL 连接的 `isOverLimit` 说明**重度 star 用户的列表可能被服务端截断**（官方原文见上）；REST `/user/starred` 文档无任何截断声明。对「全量同步」场景这是 REST 的完整性优势。

---

## 2. 增量能力：since / 游标 / ETag / 304

- **两者都没有 `since` 参数**。REST `/user/starred` 官方参数全表只有 `sort`/`direction`/`per_page`/`page`；GraphQL `starredRepositories` 参数全表只有 `first`/`last`/`after`/`before`/`orderBy`/`ownedByViewer`（均为官方原文引用，见 §1）。
- **ETag / 条件请求：REST 明确支持，且已实测**。
  - 官方（[docs: Best practices for using the REST API](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)）：
    > *Making a conditional request does not count against your primary rate limit if a `304 Not Modified` response is returned and the request was made while correctly authorized with an `Authorization` header.*
  - `/user/starred` 端点文档的状态码表显式列出 `304 Not modified`（见 §1）。
  - **实测**：`GET https://api.github.com/users/octocat/starred?per_page=1` 返回 `ETag: W/"17e7d132…"`；带 `If-None-Match: <etag>` 重发 → **`304`**（HTTP 状态实测确认）。
  - `If-Modified-Since` 同属官方条件请求机制（同页原文给出 `if-modified-since` 示例），但要注意 `last-modified` 依赖端点返回该头；**ETag 是必返回的**（实测确认）。业界提醒：两者并不等价，个别端点 ETag 会变而 Last-Modified 不变（[Jamie Magee: Making the most of GitHub rate limits](https://jamiemagee.co.uk/blog/making-the-most-of-github-rate-limits/) 引 StackOverflow 案例）——对本场景以 ETag 为准最稳。
  - CORS 侧无障碍：实测响应头 `Access-Control-Expose-Headers: ETag, Link, Location, … X-RateLimit-* …`，浏览器脚本**可以读到 ETag**（见 §4）。
- **GraphQL 无条件请求**（业界一致结论，[Jamie Magee 博客](https://jamiemagee.co.uk/blog/making-the-most-of-github-rate-limits/)）：
  > *Unfortunately, conditional requests are only available for the REST API… You should also bear in mind that you can make conditional requests to the REST API, but not to the GraphQL API.*
  - 官方 GraphQL 文档中不存在任何 ETag/条件请求机制（GraphQL 主限速文档全文只讲 points，无 conditional；POST 请求本身也不可被标准 HTTP 缓存）。
- **业界如何感知 star 列表变化**（官方 best-practices 原文）：
  > *Make authenticated conditional requests, so that unchanged data does not count against your primary rate limit.*
  > *If you page through a list, use a stable sort order… A stable order, such as the default, stops updates to existing items from reordering the list, although adding or removing items can still shift entries onto other pages.*
  - 对「我 star 的列表」的落地做法：**固定参数（`sort=created&direction=desc&per_page=100&page=1`）+ ETag 条件请求** → 无变化 = 1 次免费 304；有变化则该页返回 200，用条目里的 `starred_at` 与本地缓存的最大 star 时间比对，新增条目集中在第 1 页（`created` 降序即按 star 时间排序，实测该排序语义见 §1 参数说明）。删除（unstar）无法从第 1 页单独看出 → 需要全量 20 页比对或走你项目既有的页面快照 diff 管线。
  - Webhook 不适用：官方建议 *subscribe to webhook events instead of polling*，但 webhook 需要公网接收端，userscript（纯浏览器）无此条件——对个人 star 列表 GitHub 也没有面向个人 token 的推送事件（未查到任何官方「star 事件推送给本人」的通道 → 此点标为**未能查证**，现有机制里最接近的就是 ETag 轮询）。
- **小坑（官方已提醒）**：*Use the same parameters every time you poll the same data. A different page size, page number, or filter produces a different response with a different etag.* —— 缓存 ETag 时务必把完整 URL 参数固定下来。

---

## 3. 搜索：能否 API 搜「我 star 集合内的关键词」？

- **不能**。官方仓库搜索 qualifier 全表（[docs: Searching for repositories](https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories)）覆盖 name/description/topics/readme、`user:`/`org:`、size、followers、forks、**stars（是仓库自己的 star 数，不是「我是否 star 过」）**、created/pushed、language、topic、license、visibility、props、mirror、template、archived、good-first-issues、sponsorable、deployable —— **没有任何 `starred-by:` / `is:starred` 类限定**（本次对该页全文与 [Searching on GitHub 索引页](https://docs.github.com/en/search-github/searching-on-github) 检索 `starred` 命中 0 次）。REST Search 文档（[docs: REST Search](https://docs.github.com/en/rest/search/search)）也只是转发到上述 qualifier 列表：*A query can contain any combination of search qualifiers supported on GitHub.*
- 即使用 `repo:` 逐一枚举也有硬限制（同页原文）：
  > *The GitHub REST API provides **up to 1,000 results for each search**.* / *queries that are longer than 256 characters… or have more than five `AND`, `OR`, or `NOT` operators → "Validation failed"* / *The REST API will find up to 4,000 repositories that match your filters.*
  - 搜索还有独立限速：*For authenticated requests, you can make up to **30 requests per minute** for all search endpoints except Search code*（同页）。
- **结论：官方无此能力，只能全量拉取（20 页）→ 本地缓存 → 本地搜索**。这也正是你们项目现状（`stars_repo_cache` + 本地搜索）的做法；搜索走 API 反而更贵更慢（30/min 限速、1000 结果上限、无法限定 star 集合）。

---

## 4. 写操作权限与 CORS

### 4.1 fine-grained PAT 权限（官方权限表原文）

[docs: Permissions required for fine-grained PATs](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens) — **User permissions for "Starring"**：

| Endpoint | Access |
|---|---|
| `PUT /user/starred/{owner}/{repo}` | **write**（另见端点页：需 + Metadata 仓库读） |
| `DELETE /user/starred/{owner}/{repo}` | **write**（另见端点页：需 + Metadata 仓库读） |
| `GET /user/starred` | **read** |
| `GET /user/starred/{owner}/{repo}` | **read** |

starring 端点页对写端点的原文：

> *The fine-grained token must have the following permission set: **"Starring" user permissions (write) and "Metadata" repository permissions (read)***

读端点：

> *The fine-grained token must have the following permission set: **"Starring" user permissions (read)***

语义：`GET /user/starred/{o}/{r}` 已 star → **204**，未 star → **404**；`PUT`/`DELETE` 成功 → **204**（均见官方状态码表；PUT 另注 *you'll need to set Content-Length to zero*）。403 修复提示可看 `X-Accepted-GitHub-Permissions` 响应头（[GitHub Blog changelog, 2023-08-10](https://github.blog/changelog/2023-08-10-x-accepted-github-permissions-header-for-fine-grained-permission-actors/)）。

### 4.2 从 github.com 页面发请求的 CORS

[docs: Using CORS and JSONP](https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests) 原文：

> *The REST API supports cross-origin resource sharing (CORS) for AJAX requests **from any origin**.*

官方给出的响应头样例（与本机实测一致）：

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Headers: Authorization, Content-Type, If-Match, If-Modified-Since, If-None-Match, If-Unmodified-Since, X-Requested-With
Access-Control-Allow-Methods: GET, POST, PATCH, PUT, DELETE
Access-Control-Expose-Headers: ETag, Link, x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset, …
```

**实测**（`curl -I https://api.github.com/users/octocat/starred`）：`Access-Control-Expose-Headers: ETag, Link, Location, Retry-After, … X-RateLimit-Limit, X-RateLimit-Remaining, …` —— PUT/DELETE 都在 Allow-Methods 里、`Authorization` 在 Allow-Headers 里、`ETag`/`Link`/`X-RateLimit-*` 可被脚本读取。**结论：userscript 直连无任何 CORS 障碍，也不需要预检代理**（带 `Authorization` 的请求会触发 OPTIONS 预检，GitHub 已放行）。

> 补充：2026-07 起 GitHub 对 **stargazers 列表端点**（列出「谁 star 了某仓库」）收紧为管理员/协作者可见（starring 页原文 *Access to the stargazers listing endpoints will be limited to admins and collaborators*），**不影响 `/user/starred`（拉自己的列表）**。

---

## 5. 速率与缓存评估（5000/h，2000 star）

官方原文（[docs: Rate limits for the REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)）：

> *All of these requests count towards your personal rate limit of **5,000 requests per hour**.*

次级限速（同页）：

> *No more than **100 concurrent requests**… No more than **900 points per minute** are allowed for REST API endpoints… Most REST API `GET`, `HEAD`, and `OPTIONS` requests = **1 point**; most `POST`/`PATCH`/`PUT`/`DELETE` = **5 points**.*

**余量测算**：

| 场景 | 请求/点数 | 占比 |
|---|---|---|
| 2000 star 全量（per_page=100）| 20 GET = 20 点 | **0.4%** / 小时 |
| 增量检查（ETag 全 304）| 20 GET，且 **304 不计额度**（官方原文见 §2）| **0%** |
| 每小时整点全量同步 | 20 点/次，理论上限 250 次/小时 | 完全无压力 |
| 写操作（PUT/DELETE 单个）| 5 点/次 + 官方建议 *wait at least one second between each mutative request* | 可忽略 |

**ETag 缓存最佳实践**（[docs: Best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api) 原文要点）：
1. 条件请求 + 带 `Authorization` → 304 **不计主限速**；
2. *Request only the data that you need… keep responses stable, so that more of your polls return 304*；
3. 分页用**稳定排序**，且**每次轮询保持完全相同的参数**（页码/页大小变了 ETag 就变）；
4. 轮询频率看 `x-poll-interval` 头；并发改串行（*make requests serially instead of concurrently*）；
5. 每页各存一个 ETag（20 页 20 个 ETag），或只对第 1 页做高频条件检查、全量比对低频做。

GraphQL 侧对照（[docs: GraphQL rate limits](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api)）：*For users: **5,000 points per hour per user***；单页查询按成本公式（连接请求数 ÷ 100 四舍五入）≈ 0–1 点/页，20 页 ≤ 20 点 —— 速率同样无压力，但**没有 304 免费机制**，每次轮询都是实打实的点数 + 完整响应体流量。

---

## 6. 安全：userscript 里放 PAT 直连 api.github.com 的注意点

官方基线（[docs: Keeping your API credentials secure](https://docs.github.com/en/rest/authentication/keeping-your-api-credentials-secure) 原文）：

> *When creating a personal access token, only select the minimum permissions or scopes needed, and **set an expiration date** for the minimum amount of time you'll need to use the token. GitHub recommends that you use fine-grained personal access tokens instead of personal access tokens (classic).*
> ***Never hardcode authentication credentials like tokens… into your code.***
> *Treat authentication credentials the same way you would treat your passwords… Don't share authentication credentials…*
> 泄露预案：*In the event that your token or other personal access credential has leaked, you will need to: Generate a new credential. Replace the old credential… Delete the old compromised credential.*

落到本场景的具体注意点：

1. **最小权限**：fine-grained PAT 只勾 **Account permissions → Starring → Read（读）/ Read+Write（含写操作）**（§4 权限表），仓库范围可只给 All repositories；配短过期时间。泄露爆炸半径 = 只有 star 读写（+ Metadata 读），不碰 repo 内容。
2. **存储面**：存 Tampermonkey 的 GM 存储（`GM_setValue`，隔离于页面）而不是 `localStorage`——**同源任意脚本（含 XSS、其他脚本）都能读 `localStorage`**；你们项目当前对业务数据做了 `github-stars-grid::` 的 localStorage 镜像，**PAT 键（`github_pat`）绝不能进这个镜像**。
3. **token 只进请求头，不进 URL**：`Authorization: Bearer` 不会出现在 Referer、浏览器历史、服务器访问日志里；到 `api.github.com` 的请求 Referer 是 `github.com` 页面地址，本身不携带凭据（Referrer 只是页面 URL）。绝不要用 `?token=` 查询参数形式。
4. **日志面**：不要 `console.log` 完整请求头/配置对象；报错时打码（`ghp_****`）；F12 Network 面板能看到自己请求的 token——这属于设备本人可见，风险可接受，但**截图/录屏/贴 issue 时注意打码**。
5. **页面上下文暴露面**：脚本运行在 github.com 页面上下界内，若 token 以变量形式存在页面可触达的位置，github.com 一旦 XSS 或用户装了恶意扩展即可被读。缓解：GM 存储按需读取、用完不长期挂全局、TM 的 prompt 输入配置（不写死在脚本源码里，避免发布/同步到公开仓库时泄露——官方 *never hardcode… into your code* 同时也适用于公开分发的用户脚本）。
6. **CORS 不等于泄露**：`Access-Control-Allow-Origin: *` 只意味着「别的网站可以用自己的凭据调 API」，它读不到你脚本里的 token；跨站页面无法读取 github.com 源内的数据。真正的泄露面在「本机存储 + 页面脚本 + 日志」三处。
7. **撤销通道**：token 一旦疑似泄露，GitHub 支持凭据撤销（同页 *you can submit a revocation request through the REST API* / 到 Settings → Developer settings 立即 revoke），并按官方三步走（生成新的→全量替换→删旧的）。

---

## 7. 对照表

| 维度 | REST `GET /user/starred` (+`star+json`) | GraphQL `user.starredRepositories` |
|---|---|---|
| 每页上限 | **100**（`per_page` max 100，默认 30） | **100**（`first/last` 1–100） |
| 排序 | `sort=created/updated` + `direction` | `orderBy{field: STARRED_AT, direction}` |
| star 时间 | ✅ `starred_at`（star+json） | ✅ `edge.starredAt` |
| 需求字段覆盖 | ✅ 全覆盖（实测字段齐） | ✅ 全覆盖（databaseId=数字 ID） |
| 单条 payload | **≈5.7 KB（实测）**，全量 2000≈12–13 MB | **≈0.4–0.6 KB（估算）**，全量 ≈0.8–1.2 MB |
| since/游标增量 | ❌ 无 since；靠排序+ETag | ❌ 无 since；靠游标（仅翻页，非变更检测） |
| ETag / 304 条件请求 | ✅ **支持（官方 304 状态码 + 实测 304，304 不计额度）** | ❌ 不支持（业界一致结论） |
| 列表截断风险 | 未见截断声明 | ⚠️ `isOverLimit`（重度 star 用户可能截断） |
| 限速 | 5000 请求/h；GET=1 点（次级 900 点/min/端点） | 5000 点/h；成本≈0–1 点/页；10s 超时、500k 节点上限 |
| 搜索「我 star 集合内关键词」 | ❌ 两侧均无能力 → 本地搜 | 同左 |
| 写操作 | ✅ PUT/DELETE，fine-grained **Starring write**（+Metadata read） | ✅（`ADD_STAR`/`REMOVE_STAR` mutation，同权限域） |
| CORS（github.com 直连） | ✅ `ACAO:*`，PUT/DELETE/Authorization/If-None-Match 全放行，ETag 可读（实测） | ✅ 同一 API 域，同样支持 |
| 实现复杂度 | **低**：fetch + Link 头翻页 + If-None-Match | 中：查询编写、游标、点数/超时/节点预算 |
| 稳定性注意 | 2026-07 收紧的是 stargazers 列表端点，不影响本端点 | `isOverLimit` 截断 |

---

## 8. 推荐

**Verdict: Adopt — REST `GET /user/starred` + `Accept: application/vnd.github.star+json`（辅以 ETag 条件请求与 `sort=created&desc` 增量）— 理由：字段实测全覆盖、每页 100、`304 Not Modified` 为官方明列状态码且实测通过并免计额度，而 GraphQL 无条件请求机制（业界一致）且有 `isOverLimit` 截断风险；2000 star 全量仅占 5000/h 额度的 0.4%，payload 大（12–13 MB）只影响首次全量，增量只需第 1 页 + 304；实现复杂度最低，最贴合 userscript 直连 CORS 的形态。**

仅在以下情况才考虑 GraphQL：单条 payload 需要压到 ~0.5 KB（例如流量极度受限、或 star 数上万想减少传输），并且愿意放弃 304 免额度缓存、自行处理游标与成本预算——综合收益为负，不建议。

---

## 9. 参考来源

**官方文档（docs.github.com / github.blog）**
1. REST API endpoints for starring — https://docs.github.com/en/rest/activity/starring
2. Best practices for using the REST API（条件请求/304 免额度/稳定排序/串行请求）— https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api
3. Rate limits for the REST API（5000/h、次级限速、点数表）— https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
4. Using CORS and JSONP to make cross-origin requests — https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests
5. Permissions required for fine-grained personal access tokens（User permissions for "Starring"）— https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens
6. Keeping your API credentials secure — https://docs.github.com/en/rest/authentication/keeping-your-api-credentials-secure
7. REST API endpoints for search（1000 结果、30/min、256 字符、5 个布尔符、4000 仓库范围）— https://docs.github.com/en/rest/search/search
8. Searching for repositories（qualifier 全表，无 starred 限定）— https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories
9. Searching on GitHub 索引（检索 starred 命中 0）— https://docs.github.com/en/search-github/searching-on-github
10. GraphQL Users reference（`starredRepositories` 字段与参数）— https://docs.github.com/en/graphql/reference/users
11. GraphQL Repos reference（`StarredRepositoryConnection`/`StarredRepositoryEdge`/`Repository` 字段）— https://docs.github.com/en/graphql/reference/repos
12. Using pagination in the GraphQL API（first/last 1–100）— https://docs.github.com/en/graphql/guides/using-pagination-in-the-graphql-api
13. Rate limits and query limits for the GraphQL API（5000 点/h、成本公式、10s 超时、500k 节点）— https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api
14. X-Accepted-GitHub-Permissions header changelog（2023-08-10）— https://github.blog/changelog/2023-08-10-x-accepted-github-permissions-header-for-fine-grained-permission-actors/
15. Upcoming access restrictions to public API endpoints（stargazers 列表收紧，2026-06-30）— https://github.blog/changelog/2026-06-30-upcoming-access-restrictions-to-public-api-endpoints-and-ui-views/

**业界实践 / 交叉验证**
16. Jamie Magee — Making the most of GitHub rate limits（REST/GraphQL 条件请求差异、ETag vs Last-Modified）— https://jamiemagee.co.uk/blog/making-the-most-of-github-rate-limits/
17. StackOverflow — Which is more reliable for GitHub API conditional requests: ETag or Last-Modified? — https://stackoverflow.com/questions/28060116/which-is-more-reliable-for-github-api-conditional-requests-etag-or-last-modifie/57309763#57309763

**本机实测（2026-09-22，curl 直连 api.github.com，无认证）**
- `GET /users/octocat/starred?per_page=1` + `Accept: application/vnd.github.star+json` → 条目 `{starred_at, repo}`，单条 5664 B；响应含 `ETag`、`Link`、`Access-Control-Expose-Headers`、`X-RateLimit-Limit: 60`（无认证桶）。
- `If-None-Match: <ETag>` 重发同一 URL → **HTTP 304**。
- `POST /graphql`（无认证）→ 403（GraphQL 必须认证，payload 估算未能实测，已标注）。
