# 考证：GitHub 仓库时间字段 `updated_at` / `pushed_at` 的权威语义

> 调查日期：2026-09-25（UTC）
> 范围：只做字段事实考证，不涉及任何脚本修改建议。
> 来源优先级：官方 OpenAPI 描述仓库 > 官方 GraphQL 参考 > GitHub 社区讨论（含员工回复）> Stack Overflow（标注为社区来源）。
> 凡标注「实测」的条目，均为本次调查当场对 `api.github.com` / `github.com` 公开端点取证得到的**一手数据**，非二手转述。

---

## 一、结论速查表

| # | 问题 / 字段 | 权威语义 | 触发条件 | 证据强度 | 来源 |
|---|---|---|---|---|---|
| 1 | REST `repository.updated_at` | 「仓库对象」最后一次被更新的时间（GitHub 侧元数据） | 描述、主页、主语言、topics、可见性等对象字段变化；**提交只有在其导致对象字段变化时才带动它** | 官方 GraphQL 有定义；REST OpenAPI **无字段级 description** | [GraphQL Repository.updatedAt](#q6)；[SO 47 赞答案](#q1) |
| 2 | REST `repository.pushed_at` | 最后一次 **push 到该仓库任一分支**的时间（≈ 最后一次 git 提交） | 任何分支的 push；网页端编辑文件＝一次 commit，同样算 | 社区来源（47 赞、被 GitHub 社区引用为答案），**REST OpenAPI 无字段级 description** | [SO accepted answer](#q1)；[GitHub Discussion #24442](#q1) |
| 3 | `updated_at` 与 `pushed_at` 的恒等关系 | **不存在**「`updated_at` 恒 ≥ `pushed_at`」的官方保证 | — | 官方文档未声明；实测 15 个热门仓库中有 **3 个** `pushed_at > updated_at` | [实测](#q3)；[SO 追问](#q3) |
| 4 | Stars 页 **"Recently active"** 排序键 | **官方文档未定义**；实测＝按 `pushed_at` 降序 | — | 官方文档只列选项名；**实测页面顺序对 `pushed_at` 0 违规、对 `updated_at` 11 违规** | [官方文档](#q4)；[实测](#q4) |
| 5 | REST `GET /user/starred?sort=updated` 的 `updated` | 官方原文明确：`updated` = **when the repository was last pushed to** | — | **官方 OpenAPI 参数级 description（硬证据）** | [OpenAPI](#q5) |
| 6 | GraphQL `Repository.updatedAt` / `pushedAt` | `updatedAt` = 对象最后更新时间；`pushedAt` = 仓库最后被 push 的时间 | 与 REST 语义一致 | 官方 GraphQL 参考（字段级 description） | [GraphQL](#q6) |
| 7 | 单次 REST 调用取「最新提交时间」 | `/repos/{o}/{r}` 返回的 `pushed_at` 即近似值；若需**精确 commit 时间**用 `/repos/{o}/{r}/commits?per_page=1`（默认分支，`commit.committer.date`）或 GraphQL `defaultBranchRef.target ... on Commit { committedDate }` | — | 官方 OpenAPI 路径存在 + 实测返回形状 | [实测](#q7) |

---

## 二、逐问详答

### Q1. `updated_at` 到底是什么语义？会因哪些操作变化？

**官方 REST 侧：字段级描述缺失。** 官方 OpenAPI 源（`github/rest-api-description`，即 docs.github.com 生成的唯一上游）中，`repository` / `full-repository` / `minimal-repository` 三个 schema 的 `updated_at` **只有类型、格式与 example，没有 description**：

```jsonc
// api.github.com.json → components.schemas.repository.properties
"updated_at": {"type":"string","format":"date-time","example":"2011-01-26T19:14:43Z","nullable":true}
"pushed_at":  {"type":"string","format":"date-time","example":"2011-01-26T19:06:43Z","nullable":true}
```

（实测：下载 <https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json> 后用 node 解析 `components.schemas.repository.properties` 所得；同样在 dereferenced YAML 中确认 `pushed_at:` 后紧接 `type/format/example`，无 `description` 键。）

**官方 GraphQL 侧（权威定义）：**
> `updatedAt` (`DateTime!`) — "Identifies the date and time when the object was last updated."
> 来源：<https://docs.github.com/en/graphql/reference/repos>（Repository 对象字段表）

**社区来源（Stack Overflow，47 赞、被采纳）：** 该答案是本次能找到的最详细且被 GitHub 官方社区当作答案引用的解释，作者 Ivan Zuzak（github3.py 作者，SO 19k 声望）：
> "UPDATE: the behavior described below wasn't intended. `pushed_at` will be updated any time a commit is pushed to any of the repository's branches. `updated_at` will be updated any time the repository object is updated, e.g. when the description or the primary language of the repository is updated. **It's not necessary that a push will update the `updated_at` attribute -- that will only happen if a push triggers an update to the repository object.** For example, if the primary language of the repository was Python, and then you pushed lots of JavaScript code -- that might change the primary language to JavaScript, which updates the repository object's language attribute and in turn updates the `updated_at` attribute. Previously, the primary language was getting updated after every push, even if it didn't change (which wasn't intended), so it triggered an update to `updated_at`."
> 来源：<https://stackoverflow.com/questions/15918588/github-api-v3-what-is-the-difference-between-pushed-at-and-updated-at>（用 StackExchange API 取回原文：<https://api.stackexchange.com/2.3/questions/15918588/answers?site=stackoverflow&filter=withbody>）

**GitHub 官方社区讨论 #24442**（标题 "Difference between `updated_at` and `pushed_at` in repositories list response"）的答复原文：
> "`pushed_at` will be updated any time a commit is pushed to any of the repository's branches. `updated_at` will be updated any time the repository object is updated, e.g. when the description or the primary language of the repository is updated. The difference is that `pushed_at` represents the date and time of the last commit, whereas the `updated_at` represents the date and time of the last change the the repository. A change to the repository might be a commit, but it may also be other things, such as changing the description of the repo, creating wiki pages, etc."
> 来源：<https://github.com/orgs/community/discussions/24442>
> ⚠️ **员工身份未确证**：该帖答复者未显示 GitHub 员工徽标，且帖内答复**直接标注其来源为 Stack Overflow 链接**；因此这条只能算「社区来源转述」，不能算官方口径。

**结论：** `updated_at` = 仓库**对象**（GitHub 侧元数据）的最后更新时间；标星、加 topic、改描述等元数据变更会改它；**普通代码 push 不必然改它**（取决于该 push 是否引起仓库对象字段变化）。

---

### Q2. `pushed_at` 是什么语义？与 `updated_at` 的准确区别？

**官方 REST 侧：同样缺字段级 description**（见 Q1 的 OpenAPI 摘录）。官方文字表述只出现在 **GraphQL** 与 **starred 端点的 sort 参数**里：

**官方 GraphQL：**
> `pushedAt` (`DateTime`) — "Identifies the date and time when the repository was last pushed to."
> 来源：<https://docs.github.com/en/graphql/reference/repos>

**官方 OpenAPI（`/user/starred` 的 `sort` 参数，参数级 description）：**
> "The property to sort the results by. `created` means when the repository was starred. **`updated` means when the repository was last pushed to.**"
> 来源：OpenAPI `components.parameters.sort-starred`（同 Q1 下载源）

**社区来源（SO accepted answer）：**
> "The difference is that `pushed_at` represents the date and time of the last commit, whereas the `updated_at` represents the date and time of the last change the the repository. […] In other words, commits are a subset of updates[…]"

**结论：** `pushed_at` ≈ 「最后一次向该仓库推送 git 提交的时间」（任意分支，不限于默认分支）；`updated_at` 是「GitHub 仓库对象最后一次被改的时间」，语义严格说**包含**非代码活动（issues/PR/wiki/设置等，视实现而定），但**不保证每次都随 push 变化**。

---

### Q3. 两个字段的更新关系：是否有「`updated_at` 恒 ≥ `pushed_at`」的官方说明？

**没有找到任何官方说明**（docs.github.com 的 REST star 端点页、GraphQL 参考均无此不变式表述）。

**社区层面存在两种相反说法：**
- SO accepted answer 断言："the `pushed_at` timestamp will therefore either be the same as the `updated_at` timestamp, or it will be an earlier timestamp."（即 `pushed_at ≤ updated_at`）
- 同帖后续追问与回答**否定了这一断言**：提问者给出反例（"pushed: 2022-08, updated: 2022-07"），回答者 `@clayne` 明确回复：
  > "No, a repository can be setup with description, etc. and left alone and then commits are pushed to the _git_ repository involved with it continuously after that point. `updatedAt` involves the GH-specific set of attributes associated with the 'repo.' `pushedAt` involves the time of the last git commit to the git repo directly involved with the GH 'repo.'"
  > 来源：<https://github.com/orgs/community/discussions/24442>（引用 SO 讨论）与 <https://stackoverflow.com/questions/15918588/github-api-v3-what-is-the-difference-between-pushed-at-and-updated-at>

**本次实测（避免只凭社区争论）：** 依次请求 20 个热门仓库的 `GET /repos/{owner}/{repo}`（公开、未认证），其中 5 个返回 "Moved Permanently" 重定向而失败，**15 个有效样本**如下：

| 仓库 | `updated_at` | `pushed_at` | 关系 |
|---|---|---|---|
| sindresorhus/got | 2026-09-24T19:26:08Z | 2026-09-20T13:25:54Z | pushed < updated |
| cli/cli | 2026-09-25T07:51:59Z | 2026-09-25T07:51:36Z | pushed < updated |
| nodejs/node | 2026-09-25T06:51:14Z | 2026-09-25T03:32:04Z | pushed < updated |
| rust-lang/rust | 2026-09-25T07:43:57Z | 2026-09-25T05:41:31Z | pushed < updated |
| chromium/chromium | 2026-09-25T07:58:04Z | 2026-09-25T07:57:58Z | pushed < updated |
| react/react-native | 2026-09-25T07:18:47Z | 2026-09-25T06:33:45Z | pushed < updated |
| openai/codex | 2026-09-25T07:58:32Z | 2026-09-25T06:20:56Z | pushed < updated |
| denoland/deno | 2026-09-25T03:51:29Z | 2026-09-22T00:30:07Z | pushed < updated |
| kubernetes/kubernetes | 2026-09-25T07:02:15Z | 2026-09-25T07:00:28Z | pushed < updated |
| vuejs/core | 2026-09-25T07:06:52Z | 2026-09-25T06:35:54Z | pushed < updated |
| torvalds/linux | 2026-09-25T07:58:40Z | 2026-09-25T00:11:44Z | pushed < updated |
| python/cpython | 2026-09-25T07:35:26Z | 2026-09-25T05:24:07Z | pushed < updated |
| **mooyoul/get-orientation** | 2026-04-23T11:51:20Z | 2026-09-25T04:54:25Z | **pushed > updated（反例）** |
| **vercel/vercel** | 2026-09-25T01:42:15Z | 2026-09-25T07:42:10Z | **pushed > updated（反例）** |
| **Homebrew/homebrew-cask** | 2026-09-25T07:38:17Z | 2026-09-25T07:56:10Z | **pushed > updated（反例）** |

**结论：** 「`updated_at` ≥ `pushed_at`」**不成立**（15 个有效样本中 3 个反例，等于 20%）。`updated_at` 与 `pushed_at` 是**互相独立**的两条时间线，二者没有可靠的先后方向。README 编辑本身是提交，故**一定**计入 `pushed_at`（因为它是 commit）；它是否带动 `updated_at` 取决于是否改到对象字段（README 内容本身通常不改对象字段）。

---

### Q4. Stars 页面的 "Recently active" 排序用哪个字段？

**官方文档：只有选项名，没有定义。** 官方帮助页原文：
> "To sort stars, select the **Sort by:** dropdown menu, then select **Recently starred**, **Recently active**, or **Most stars**."
> 来源：<https://docs.github.com/en/get-started/exploring-projects-on-github/saving-repositories-with-stars>（对应源文件：<https://github.com/github/docs/blob/main/content/get-started/exploring-projects-on-github/saving-repositories-with-stars.md>）

**本次找到的次强证据（官方产物，非文档）：** stars 页的排序菜单 HTML 里，选项标签与其 URL 参数一一对应：

| 菜单标签 | 实际 URL |
|---|---|
| Recently starred | `?direction=desc&sort=created&tab=stars` |
| **Recently active** | **`?direction=desc&sort=updated&tab=stars`** |
| Most stars | `?direction=desc&sort=stars&tab=stars` |

（实测：抓取 <https://github.com/sindresorhus?tab=stars> 后解析 `#stars-sort-menu-list` 中的锚点。）

即 **"Recently active" → `sort=updated`**，与 `/user/starred?sort=updated` **同一个参数值**。

**关键实测（决定性）：** 抓取 `https://github.com/sindresorhus?direction=desc&sort=updated&tab=stars`，解析出页面实际渲染的前 25 个仓库顺序，再逐个请求 `GET /repos/{owner}/{repo}` 取两字段对照：

- 页面顺序对 **`pushed_at`：0 处违规**（完全单调不增）
- 页面顺序对 **`updated_at`：11 处违规**

典型反例（页面相邻位置，`updated_at` 明显乱序但 `pushed_at` 严格递减）：

| 页面位次 | 仓库 | `updated_at` | `pushed_at` |
|---|---|---|---|
| 1 | PostHog/posthog | 07:58:48Z | 08:00:14Z |
| 2 | chromium/chromium | 07:58:04Z | 07:57:58Z |
| 7 | antiwork/gumroad | 06:19:34Z | 07:47:23Z |
| 8 | vercel/vercel | 01:42:15Z | 07:42:10Z |
| 20 | swiftlang/swift-experimental-string-processing | 2026-09-23 | 2026-09-25 |
| 21 | mooyoul/get-orientation | 2026-04-23 | 2026-09-25 |

**对 API 端的交叉验证：** `GET /users/sindresorhus/starred?sort=updated&direction=desc`（3 页 ×100）返回的 300 条结果里：
- 按 `updated_at` 降序有 **104 处违规**
- 按 `pushed_at` 降序有 **0 处违规**

**结论：**
- GitHub 产物的字面证据（`sort=updated` 与 `/user/starred` 共享参数名）**支持**「Recently active 内部按 `pushed_at` 排序」。
- 实测数据显示 **UI 顺序与 API 的 `pushed_at` 完全一致**，与 `updated_at` 明显不一致。
- 但是：**没有任何官方文档或 GitHub 员工答复明确写出「Recently active = pushed_at」**。因此严谨表述应为：**「与 `pushed_at` 一致（实测强证据），官方定义未确证」**。

---

### Q5. REST `GET /user/starred?sort=updated` 的 `updated` 对应哪个字段？

**这是本次唯一拿到的「官方字段级硬证据」，且结论与直觉相反：**

OpenAPI 源 `components.parameters.sort-starred` 原文：
> `sort` (string) — "The property to sort the results by. `created` means when the repository was starred. **`updated` means when the repository was last pushed to.**"

同一参数被 `GET /user/starred` 与 `GET /users/{username}/starred` **共用**（两处 `parameters[1]` 都 `$ref: "#/components/parameters/sort-starred"`，实测解析确认）。

> 来源：<https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json>（字段名 `sort-starred`）
> 渲染页：<https://docs.github.com/en/rest/activity/starring?apiVersion=2022-11-28>（渲染页只显示 "The property to sort the results by."，**丢掉了后半句对 `updated` 的定义**——所以必须看 OpenAPI 源才能拿到定义。）

**注意：** `sort=updated` 在 `/orgs/{org}/repos` 与 `/user/repos` 上的枚举里包含 `created / updated / pushed / full_name`，其中 `pushed` 与 `updated` **并列存在**；但该端点**同样没有字段级说明**。只有 starred 端点的枚举是 `created / updated` 两项，且 `updated` 被明确写成 "last pushed to"。

**结论：** 在 **starred 端点**的语境下，`sort=updated` 的排序键官方定义为 **「仓库最后一次被 push 的时间」**，即 `pushed_at`。

---

### Q6. GraphQL `Repository.updatedAt` 与 `pushedAt` 的官方描述

官方 GraphQL 参考（Repository 对象）原文，两字段语义与 REST 一致：

| GraphQL 字段 | 类型 | 官方 description 原文 |
|---|---|---|
| `pushedAt` | `DateTime` | "Identifies the date and time when the repository was last pushed to." |
| `updatedAt` | `DateTime!` | "Identifies the date and time when the object was last updated." |

（注意 `pushedAt` 可空、`updatedAt` 非空。）

**排序枚举也把二者分开：**
> `RepositoryOrderField` — "Properties by which repository connections can be ordered."
> `CREATED_AT` Order repositories by creation time. / `NAME` / **`PUSHED_AT` Order repositories by push time.** / `STARGAZERS` / **`UPDATED_AT` Order repositories by update time.**

**精确「最后一次提交」的官方字段：**
> `Commit.committedDate` (`DateTime!`) — "The datetime when this commit was committed."
> （另有 `Commit.pushedDate` 已废弃："`pushedDate` is no longer supported. Removal on 2023-07-01 UTC."）
> `Repository.defaultBranchRef` (`Ref`) — "The Ref associated with the repository's default branch."

来源：<https://docs.github.com/en/graphql/reference/repos>、<https://docs.github.com/en/graphql/reference/commits>

---

### Q7. 能否用单个 REST 调用取到某个仓库的最新提交时间？

**能（近似），但不能保证是精确的 commit 时间；要精确需要第二个端点。**

**(a) `GET /repos/{owner}/{repo}` —— 返回 `pushed_at`，不返回 commit 时间。**
实测（未认证）：该响应中 `pushed_at` / `updated_at` / `created_at` **均存在**，但没有「最新提交时间」字段。`pushed_at` 是"最后一次 push"的时间，通常比最后一次 commit 晚几秒（与 CI/批量 push 有关），**不是 commit 的 committer date**。

**(b) `GET /repos/{owner}/{repo}/commits?per_page=1` —— 单次调用即得默认分支最新 commit。**
实测（`sindresorhus/got`）：
```
top-level is array: true, len 1
commit.committer.date = 2026-09-20T13:25:49Z
commit.author.date    = 2026-09-18T13:30:55Z
committer.login       = sindresorhus
```
与同一仓库 REST 的 `pushed_at = 2026-09-20T13:25:54Z` 相差 **5 秒**；与 stars 页 / `.atom` feed 的 `<updated>2026-09-20T13:25:49Z` 完全一致。
`sha` 参数默认值官方原文："SHA or branch to start listing commits from. **Default: the repository's default branch (usually `main`)**"。
> 来源：OpenAPI `/repos/{owner}/{repo}/commits`（summary "List commits"）

**(c) GraphQL 单次调用（更省额度）：**
```graphql
{ repository(owner:"sindresorhus", name:"got") {
    pushedAt
    updatedAt
    defaultBranchRef { target { ... on Commit { committedDate } } } } }
```
`defaultBranchRef` 与 `Commit.committedDate` 均为官方字段（见 Q6）。注：本次未认证 GraphQL 调用被限流，**该查询未实测成功**，仅依据官方字段定义成立。

**(d) 补充：`GET /repos/{owner}/{repo}/commits/{branch}.atom`（RSS/Atom）**
实测 `https://github.com/sindresorhus/got/commits/main.atom` 首个 `<updated>` = `2026-09-20T13:25:49Z`，与 (b) 一致。非 REST API，不作为主渠道。

---

## 三、未确证项（明确列出）

1. **Stars 页 "Recently active" 的官方定义：未确证。** 官方帮助页只写选项名（"select Recently starred, Recently active, or Most stars"），没有语义说明；未找到 GitHub 员工答复、changelog 或 GraphQL/OpenAPI 中关于该 UI 排序键的定义。本报告给出的「＝`pushed_at`」结论**建立在实测证据上**（UI 顺序对 `pushed_at` 0 违规 / 对 `updated_at` 11 违规，API `sort=updated` 300 条对 `pushed_at` 0 违规），**不是官方声明**。
2. **REST repo 对象的 `updated_at` / `pushed_at` 字段级 description：官方缺失。** `github/rest-api-description` 中这两个属性只有 `type/format/example`。相关 issue 可作旁证：<https://github.com/github/rest-api-description/issues/1872>（2022-11-18 提交，2025-11-04 关闭，涉及 `pushed_at` schema 定义不准确，**与语义定义无关**）。因此 Q1/Q2 中「对象更新 vs 分支 push」的语义主要来自 GraphQL 字段定义 + 社区来源。
3. **`updated_at` 的精确触发集合：未确证。** 「改描述会变、加 topic 会变、issues/PR/wiki 会变」的条目出自社区来源（SO / Discussion #112102），**官方未逐条列出**。其中 Discussion #112102 是**无答复的提问帖**（"0 replies"、页面显示 Unanswered），**不能作为权威来源**。
4. **「`updated_at` 恒 ≥ `pushed_at`」：已被实测反证，不是「未确证」而是「不成立」。** 但反方向的严格规则（何时 `pushed_at > updated_at`）官方未说明。
5. **GitHub Discussion #24442 答复者的员工身份：未确证**（无员工徽标），且答复本身引用 Stack Overflow，故按社区来源计。
6. **GraphQL `defaultBranchRef.target ... on Commit { committedDate }` 查询：未实测成功**（未认证 GraphQL 被限流），仅依据官方字段定义。
7. **`facebook/react`、`golang/go`、`flutter/flutter`、`microsoft/vscode`、`tensorflow/tensorflow` 的 `GET /repos/...`：实测失败**（返回 "Moved Permanently"，`facebook/react` 已迁移）——这属于重定向行为，不影响字段结论。

---

## 四、参考来源清单

**官方（一手）**

1. OpenAPI 原始描述（repo 对象字段、`/user/starred` 的 `sort-starred` 参数定义、`/repos/{owner}/{repo}/commits`）：
   <https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json>
2. 同上，dereferenced YAML（用于确认 `pushed_at` 无 description）：
   <https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/dereferenced/api.github.com.deref.yaml>
3. REST 文档渲染页 — REST API endpoints for starring（`/user/starred`，渲染页丢失了 `updated` 的定义）：
   <https://docs.github.com/en/rest/activity/starring?apiVersion=2022-11-28>
4. REST 文档渲染页 — REST API endpoints for repositories：
   <https://docs.github.com/en/rest/repos/repos?apiVersion=2022-11-28>
5. GraphQL 参考 — Repository（`updatedAt` / `pushedAt` / `RepositoryOrderField` / `defaultBranchRef`）：
   <https://docs.github.com/en/graphql/reference/repos>
6. GraphQL 参考 — Commit（`committedDate`、已废弃的 `pushedDate`）：
   <https://docs.github.com/en/graphql/reference/commits>
7. 帮助页 — Sorting and filtering stars on your stars page（只列选项名）：
   <https://docs.github.com/en/get-started/exploring-projects-on-github/saving-repositories-with-stars>
   源文件：<https://github.com/github/docs/blob/main/content/get-started/exploring-projects-on-github/saving-repositories-with-stars.md>
8. 帮助页 — Editing files in your repository（网页端编辑＝产生一次 commit）：
   <https://docs.github.com/en/repositories/working-with-files/managing-files/editing-files>
9. GitHub 官方 issue — `[Schema Inaccuracy] bad definition for pushed_at property in many webhooks schemas`：
   <https://github.com/github/rest-api-description/issues/1872>

**社区（标注为社区来源）**

10. Stack Overflow — "GitHub API V3 : what is the difference between pushed_at and updated_at?"（accepted answer，47 赞，作者 Ivan Zuzak）：
    <https://stackoverflow.com/questions/15918588/github-api-v3-what-is-the-difference-between-pushed-at-and-updated-at>
    （API 原文取回：<https://api.stackexchange.com/2.3/questions/15918588/answers?site=stackoverflow&filter=withbody>）
11. GitHub Community Discussion #24442（答复者员工身份未确证，答复引用 SO）：
    <https://github.com/orgs/community/discussions/24442>
12. GitHub Community Discussion #112102（**无答复的提问帖**，仅作参考不作依据）：
    <https://github.com/orgs/community/discussions/112102>

**本次一手实测（无外部 URL，可用同法复现）**

13. `GET https://api.github.com/repos/{owner}/{repo}` — 15 个仓库的 `updated_at`/`pushed_at` 对照（3 个反例）。
14. `GET https://api.github.com/users/sindresorhus/starred?sort=updated&direction=desc&per_page=100&page=1..3` — 300 条，按 `pushed_at` 0 违规、按 `updated_at` 104 违规。
15. `GET https://github.com/sindresorhus?direction=desc&sort=updated&tab=stars` — 页面前 25 项顺序对 `pushed_at` 0 违规、对 `updated_at` 11 违规；排序菜单 HTML 中 "Recently active" → `sort=updated`。
16. `GET https://api.github.com/repos/sindresorhus/got/commits?per_page=1` — `commit.committer.date = 2026-09-20T13:25:49Z`；同仓库 `pushed_at = 2026-09-20T13:25:54Z`。
17. `GET https://github.com/sindresorhus/got/commits/main.atom` — 首个 `<updated>` = `2026-09-20T13:25:49Z`。

**Verdict: Compose — 官方 OpenAPI 源（`/user/starred` 的 `sort-starred` 定义）+ 官方 GraphQL 字段定义 + 现场一手实测 — 理由：REST 文档渲染页与 repo schema 均无字段级 description（见来源 1、2 的 node 解析结果），单靠官方文档无法回答 Q1–Q4，必须组合「官方 GraphQL 字段定义（Q6）」+「官方 OpenAPI 参数定义（Q5，唯一硬证据）」+「当场对公开端点取证（Q3/Q4/Q7）」，并把无官方定义处明确标为未确证。**
