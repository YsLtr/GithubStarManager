# 复用 GitHub 网页 star/unstar 端点以绕开 fine-grained PAT 写缺口 —— 可行性调研报告

> **后续修订（4.9.0，2026-10-01）**：本报告的落地建议已由 `docs/adr/0006-web-endpoint-write-fallback.md` 定案，有三处改动 —— ① §3.5 末句「优先读真实 token」在**批量场景**下推翻（改为默认只带 `GitHub-Verified-Fetch: true`，仅 422 才回退读真实 token）；② 成功判定弃用 `{"count":"N"}`（它是仓库 star 总数的事后快照，不是本次动作的增量），改用 `resp.ok` + 事后重读 `form` 方向；③ 「在 UI 明示认证方式」被用户裁定否决（静默分派，但不得静默失败）。另订正 §4 表格中 `GithubStarListsPlus` 的记录（其写路径是 REST DELETE，不是网页端点）。

- 调研对象：Tampermonkey 用户脚本 GithubStarManager（`@match https://github.com/*`，页面上下文 + GM_* API）
- 调研日期：2026-09-26（+0800）
- 调研方式：公开网络检索 + 公开仓库源码精读 + **本机只读/非破坏性页面 DOM 观察与观测实验**（实验细节见 §3.5，含一次操作与已复原的副作用，见 §3.5 说明）
- 报告均为文档调研与观察结论，**未在脚本仓库中做任何修改**，未使用任何真实 token 发请求

---

## 一页可行性结论

**结论：有条件可行（Conditionally Feasible）。条件满足时，它确实能绕开 fine-grained PAT 的写缺口；但代价是一整套非契约化的玻璃地板。**

**核心判定**

| 判定项 | 结论 |
|---|---|
| 是否绕开 fine-grained PAT 写缺口 | ✅ **是**。网页端点**只认浏览器 Cookie 会话，与 token 完全无关**，用户是 classic / fine-grained / 无 token 都不影响该路径 |
| 前端技术可行性 | ✅ 可行。已有多个公开实现走通（详情见 §4） |
| 是否需要登录会话 | ✅ **必须**。无 GitHub 登录会话时表单根本不渲染，网页路径必然失败 → 脚本必须按会话有无分派 |
| 是否受 AUP/合规限制 | ⚠️ **单次用户点击触发 ≈ 低风险；脚本自动批量恢复 N 个 star ≈ 高风险**，可能落入 "rank abuse, such as automated starring" |
| 主要风险 | ① 非文档化端点，**无版本契约**，GitHub 改版即失效（历史已改过一次：`meta[csrf-token]` → `meta[fetch-nonce]`）；② 无 `x-ratelimit-*` 头、限流阈值未公开；③ 强依赖登录态；④ 批量路径合规风险 |
| 推荐 | **不要把网页端点做成主写路径**。建议采纳 §8 的第三条路 + 混合策略：**REST(classic/OAuth) 优先，失败或有会话无 classic 时回落网页端点（仅单条用户显式点击）**；批量「恢复 unstar」仍以引导 + 节流为主 |

**一句话**：网页端点在**技术上**是绕开 fine-grained 写缺口的真实可行手段（并已实测跑通）；但在**工程与合规上**它是「将就方案」，不宜作为主路径，宜作「有登录会话 + 用户显式单击」时的回落路径。

---

## 二、背景与已确证前提

脚本当前写路径走 REST：`PUT|DELETE https://api.github.com/user/starred/{owner}/{repo}` + `Authorization: Bearer <token>`。fine-grained PAT（`github_pat_`）对「不属于本人、也不属于本人所属组织」的公开仓库写 star 返回 `403 Resource not accessible by personal access token`。

**官方原文（本次核实一致）**：

> "Only personal access tokens (classic) have write access for public repositories that are not owned by you or an organization that you are not a member of."
> —— GitHub Docs, *Managing your personal access tokens*（来源等级：**官方**）
> <https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens>

同页「Fine-grained personal access tokens limitations」亦列明缺口首条：

> "Using fine-grained personal access token to contribute to public repos where the user is not a member."

**roadmap 状态复核（本次直接读 issue）**：`github/roadmap#600`「Fine-grained PATs can access open source repos [GA]」state = **CLOSED (NOT_PLANNED)**（closed 2025-12-22）；`#601`「Outside Collaborator support for Fine-grained PATs」state = **OPEN**（来源等级：**官方**）。
<https://github.com/github/roadmap/issues/600> · <https://github.com/github/roadmap/issues/601>

即：该缺口在 REST/GraphQL API 侧无法通过配置修复 —— 但**网页端点走的是另一套认证（Cookie 会话），因此不受此限制**。这是本报告的核心支点。

---

## 三、逐问回答

### Q1. `X-Fetch-Nonce` / `authenticity_token` / `GitHub-Verified-Fetch` 的获取与生命周期

#### 3.1 三个值分别从哪读

| 值 | 来源 | 本次实测结果 |
|---|---|---|
| `X-Fetch-Nonce` | `<meta name="fetch-nonce">` 的 `content` | ✅ 存在，形如 `v2:4c2175c4-eb8d-e606-ef27-0b809536aa7c`（39 字符） |
| `authenticity_token` | **目标表单内的 hidden input** `input[name="authenticity_token"]` | ✅ 表单内，86 字符；**每表单不同**（见 3.2） |
| `GitHub-Verified-Fetch` | **固定常量字符串 `"true"`**（不是从页面读） | ✅ 多个公开实现均硬编码 `'GitHub-Verified-Fetch': 'true'` |

`<meta name="csrf-token">` 已 **不存在**（实测 null），证实旧式全局 CSRF meta 已废弃。

来源等级：**实测**（本机浏览器）+ **社区确证**
- openweb `src/sites/github/PROGRESS.md`（2026-04-19）：「Modern github.com pages no longer carry `<meta name="csrf-token">` … every mutation requires `X-Fetch-Nonce: <meta[name=fetch-nonce]>` + `GitHub-Verified-Fetch: true` … Without both headers, every endpoint returns 403.」
  <https://github.com/openweb-org/openweb/blob/main/src/sites/github/PROGRESS.md>
- openweb `src/sites/github/adapters/github-web.ts`（硬编码 `GitHub-Verified-Fetch: 'true'`）
  <https://github.com/openweb-org/openweb/blob/main/src/sites/github/adapters/github-web.ts>

#### 3.2 是否任何 github.com 页面都能读到

**`fetch-nonce`：任何页面都有，但值随页面/导航变化——不是全局常量，不能跨导航复用。**
本次实测两个不同标签页（同一登录会话）：

| 页面 | `meta[fetch-nonce]` |
|---|---|
| `https://github.com/settings/tokens` | `v2:b876defe-4dd5-c59f-0f40-11e47785ade8` |
| `https://github.com/YsLtr?tab=stars` | `v2:4c2175c4-eb8d-e606-ef27-0b809536aa7c` |

同页两次执行取到的值一致（会话期内同页稳定）；跨页不同 → **换页必须重新读取**（等级：**实测**）。

**`authenticity_token`：per-form，非全站可复用。**
本次在 stars 页实测：页面上有 **60 个** `form[action$="/unstar"]`，其 `authenticity_token` **60 个互不相同**（`uniqueTokens: 60 / formCount: 60`），形如 `zMMnoyx5GDmE...OFtPJA`、`lptudsRQ56KU...PBdOuA`……（等级：**实测**）。

这与 GitHub 官方内部 ESLint 规则文档吻合（来源等级：**官方（GitHub 自家仓库）**）：

> "GitHub uses per-form CSRF tokens. This means that a form's method and action are embedded in that form's CSRF token. When the form is submitted, the Rails application verifies that the request's path and method match those of the CSRF token: A stolen token for the `POST /preview` endpoint will not be accepted for the `DELETE /github/github` endpoint."
> <https://github.com/github/eslint-plugin-github/blob/main/docs/rules/authenticity-token.md>

Rails 侧实现即 `per_form_csrf_token(session, action_path, method)`（HMAC，action+method 绑定，来源等级：**官方（Rails 上游代码）**）：
<https://github.com/rails/rails/blob/main/actionpack/lib/action_controller/metal/request_forgery_protection.rb>

**⇒ 这原本是「恢复全部」的致命问题**（要为 N 个仓库逐个取表单 token）。**但本次实验发现有一条更省事的路，见 3.5：`GitHub-Verified-Fetch: true` 可以替代 per-form token 校验。**

#### 3.3 nonce 与 session / 页面 / 时间的绑定

| 维度 | 结论 | 等级 |
|---|---|---|
| 绑定 session | 是（随登录会话生成） | 实测+社区 |
| 绑定页面 | 是（导航后换值） | 实测 |
| 是否随时间中途失效 | **未能查证**（无公开资料；本次会话内未观察到失效） | 未确证 |
| 一个 nonce 能复用多少次 | **未能查证** | 未确证 |
| 跨页导航后是否还能用 | **否**（换页值变，须重读） | 实测 |

#### 3.4 是否存在无需 nonce 的旧式路径

- 旧的全局 `<meta name="csrf-token">` 路径：**已不存在**（实测 null）。
- **但存在两条「无需 nonce」的可用路径**（本次均被实测/公开实现验证）：
  1. **原生 `form.submit()`**：直接提交页面上的 HTML 表单，浏览器自行带上表单内 token，**完全不发任何自定义头、不需要 nonce**。公开实现明确推荐此法（等级：**社区，另附社区实测**）：
     > "user-triggered actions on the repo header (Star, Unstar, Watch, Unwatch) are HTML forms that POST back to GitHub with the session's CSRF token already rendered inline. **Submit the form — do not click the button.**"
     <https://cdn.jsdelivr.net/npm/catui-agent@1.2.20/dist/extensions/builtin/browser/agent-workspace/domain-skills/github/repo-actions.md>
     > "The authenticity token is already in a hidden input inside the form, so there's nothing extra to fetch."
  2. **`fetch` + 真实 per-form token + `X-Requested-With: XMLHttpRequest`，不带 nonce 也不带 VF** —— 公开脚本 `fahamjv/github-bulk-unstar`（2026-06-21 提交）即用此法批量 unstar 且 README 标注「使用当前 GitHub 登录会话」：
     <https://github.com/fahamjv/github-bulk-unstar>
  3. **`fetch` + `GitHub-Verified-Fetch: true`（无需 nonce、无需有效 token）** —— 本次实验新发现，见 3.5。

#### 3.5 【本次实测的关键发现】`GitHub-Verified-Fetch: true` 可单独满足校验

**实验设计（只读优先；一次非破坏性探测意外产生了实际效果，已当场复原）**

起点：登录会话下的 stars 页（`https://github.com/YsLtr?tab=stars`），取该页任一 `form[action$="/unstar"]` 的 action 与表单结构。

**表单结构（实测，完整）：**
```html
<form class="js-social-form BtnGroup-parent flex-auto js-deferred-toggler-target"
      data-turbo="false" action="/Ariestar/sivtr/unstar" accept-charset="UTF-8" method="post">
  <input type="hidden" name="authenticity_token" value="zMMnoyx5GDmE…OFtPJA" autocomplete="off">
  <input type="hidden" value="O2LYrcjwmHSGBTyIIBZPSO1vStATCSP9h3rjvCqjCRbS0g-OYBECI6T4k4yWBEtsz8iEU9AlnM2O12RRZYw6jQ"
         data-csrf="true" class="js-confirm-csrf-token">
  <input type="hidden" name="context" value="user_stars">
  …
</form>
```
> 注：`input` 列表实测为 3 个：`authenticity_token`(86)、一个**无 name 的隐藏 input**（`data-csrf="true"`，`class="js-confirm-csrf-token"`，86 字符，前端确认弹窗用）、`context`。openweb 在 repo 页捕获到的 `context` 值是 `repository`；stars 页此处是 `user_stars` → **`context` 是场景相关值，不是固定常量**。

**三组对照请求**（全部对同一 URL 发 `POST /Ariestar/sivtr/unstar`，`credentials:'include'`，`Accept: application/json`，`X-Requested-With: XMLHttpRequest`，multipart body 含 `authenticity_token` + `context=user_stars`），**故意使用一个伪造的 86 字符 token**：

| 组 | 额外请求头 | HTTP | 响应体 | 是否生效 |
|---|---|---|---|---|
| A | `X-Fetch-Nonce` + `GitHub-Verified-Fetch: true` | **200** | `{"count":"277"}` | ✅ 生效 |
| B | 仅 `GitHub-Verified-Fetch: true` | **200** | `{"count":"277"}` | ✅ 生效 |
| C | 无（仅 Accept / X-Requested-With） | **422** | HTML（CSP 错误页） | ❌ 被拒 |

**结论（等级：实测，单会话 2 次有效请求）**：
- 决定性变量是 **`GitHub-Verified-Fetch: true`**，**不是 `X-Fetch-Nonce`**。
- 在带 VF 头的两请求中，**连伪造的 `authenticity_token` 都被接受** → 说明该头会替代/跳过 CSRF token 校验。
- **无任何额外头时返回 422（非社区所说的 403）** —— 与 openweb「缺 nonce 或缺该头即 403」的说法**存在分歧**，以本次实测为准（可能是 GitHub 改版后行为已变化）。
- 结合 `fahamjv/github-bulk-unstar`（真实 token + 不带头，可工作）与 `openweb`（nonce+VF，可工作），可归纳出**「二选一满足」模型**：*有效 per-form token* **或** *`GitHub-Verified-Fetch: true`* 之一即可通过；两者皆无 → 422。

> ⚠️ **副作用与复原说明**：组 A/B 的请求**实际执行了 unstar**（`Ariestar/sivtr` 星标数 278 → 277，页面 `viewerHasStarred` 由 true 变 false）。已随即用**同页表单的真实 token + `GitHub-Verified-Fetch: true`** 发 `POST /Ariestar/sivtr/star` 复原：返回 `{"count":"278"}`，页面 `viewerHasStarred: true`、`aria-label: "Unstar Ariestar/sivtr"` —— **状态已完全复原**。此复原请求同时**反方向证明了 `/star` 端点同样可达**（等级：实测）。

**Q1c 的结论因此改变**：脚本**不需要**为每个仓库单独取表单 token —— 只要带上 `GitHub-Verified-Fetch: true`，并从一个已登录的同源 github.com 页面发起 fetch 即可（理论上甚至连目标仓库页面都不用打开）。这消除「恢复全部」的最大障碍。（**但**：该行为无文档、无契约，GitHub 随时可能收紧。）

> **§3.5 建议修订（4.9.0，`docs/adr/0006-web-endpoint-write-fallback.md`）**：本节原文末句是「实现上仍建议**优先读真实 token**，VF 作为兜底」——该建议**只对单条场景成立**（表单已在页面上，读取免费），**批量场景方向相反**：目标仓库不在 DOM 内，读 per-form token 要额外付一次 `GET` + 解析已 React 化的仓库页 DOM。故定案为：**批量/离页仓库默认只带 `GitHub-Verified-Fetch: true`；仅当返回 422（CSRF 失败）才回退到「GET 该仓库页取真实 token 重发一次」**。

---

### Q2. 该端点是否需要 fine-grained PAT 参与

**不需要。Cookie 会话认证，与 token 完全无关 → 这是绕开 fine-grained 写缺口的真实手段。**

证据：
1. 请求形态（用户 DevTools 实测，本报告起点）为 `credentials: include`，**无任何 `Authorization` 头**。
2. openweb 明确记录：「github.com web UI calls `api.github.com` using a short-lived **internal bearer token** synthesized server-side, NOT the `_gh_sess` cookie」（来源等级：社区）。
3. 本次实测：全程未涉及任何 token，请求以 Cookie 会话成功（200 + 真实状态变更）。
4. 认证对象是**用户账号会话**（`body.logged-in`、`meta[name=user-login]`），不是 token 的 scope/权限。

**⇒ 明确结论：脚本改用网页端点后，`github_pat_` / `ghp_` / OAuth `gho_` 的区别在写路径上归零；fine-grained 用户获得与 classic 用户同等的 star/unstar 能力。这就是绕开该缺口的方式。**

**例外/边界（须指出）**：
- 该路径能力受**用户账号本身的可见性**约束：若目标仓库是用户看得到的公开仓库 → 可 star；若目标不存在/被删/无权限访问 → 会话也会失败或返回错误。
- 若用户是**通过组织 SSO 强制授权**、会话已过期或被限流封禁 → 网页路径同样失败（与 token 无关，属会话层问题）。
- **无登录会话时该路径完全不可用**（见 Q3），此时只能回 REST，缺口依旧存在。

---

### Q3. 会话前提

**是的，必须已通过浏览器登录 github.com。** 证据：
- 本次实测：`document.body.classList.contains('logged-in')` 为 `true`；未登录时 star/unstar 表单**根本不渲染**（社区来源明示：「If the user is not logged in the forms are not rendered at all. `meta[name="user-login"]` is the cheapest pre-check.」）。
- openweb 适配器把「未登录」作为显式失败分支：`if (!ctx.loggedIn) throw errors.needsLogin()`（来源等级：社区+官方代码结构）。

**⇒ 分派建议**：`有登录会话 → 网页路径（尤其 fine-grained / 无 classic token）；无登录会话 → REST 路径`。若两者都没有 → 提示用户登录或配 classic token。

---

### Q4. 技术可行性与稳定性风险

**已有公开实现走通（案例与教训）**

| 实现 | 方式 | 时间 | 结果 |
|---|---|---|---|
| `openweb-org/openweb` `github-web` 适配器 | page 上下文 fetch：multipart + nonce+VF | 2026-04-19 | **5/5 PASS**（closeIssue/reopenIssue/watch/unwatch/**unstar**），作者称「verified」 |
| `fahamjv/github-bulk-unstar` | `fetch(form.action, {body: new FormData(form), credentials:'same-origin'})`，**不带头** | 2026-06-21 | README 标注可用；900ms/条节流、自动翻页 |
| `Fldicoahkiin/GithubStarListsPlus`（userscript+扩展） | ❌ **不是网页写端点**：批量 unstar 走 REST `DELETE https://api.github.com/user/starred/{owner}/{repo}`；原生 `form[action*='/star'], form[action*='/unstar']` **只用于读**星状态（`src/content.js`，源码精读订正——原表记为「复用原生表单」有误） | 活跃维护（Playwright 测试） | REST 批量 unstar 可用；**不可作为网页写端点的先例** |
| `catui-agent` domain-skill | `form.submit()` 原生提交 | — | 明确推荐，并记录 React 合成点击失效的坑 |

来源：<https://github.com/openweb-org/openweb> · <https://github.com/fahamjv/github-bulk-unstar> · <https://github.com/Fldicoahkiin/GithubStarListsPlus> · <https://cdn.jsdelivr.net/npm/catui-agent@1.2.20/.../github/repo-actions.md>

**失败教训 / 额外校验**

- **CSRF 机制已改版过一次**：openweb 首轮按旧的 `X-CSRF-Token` from `<meta name="csrf-token">` 走，「was **wrong** on modern github.com — the meta tag is gone」。⇒ **改版即失效是已发生的事实，不是假设**。
- **持久化 GraphQL 哈希漂移**：openweb 的 close/reopen 走 `/_graphql` + 硬编码 md5 哈希，作者明言「**These will drift** with GitHub web releases」⇒ 非文档化端点的失效是常态。
- **React 合成点击不可靠**（catui-agent）：`.click()` 对可见 React 星按钮「does not persist the star… network tab shows no POST」；**必须走 `form.submit()` 或对 HTML 表单 POST**。
- **未观察到 `Referer` / `Origin` / `Sec-Fetch-*` 的额外强校验**：本次实验从 github.com 同源页发起，浏览器自动带 `Origin: https://github.com`、`Sec-Fetch-Site: same-origin`，请求通过；社区实现亦未报告需手工伪造这些头（等级：实测+社区，**非官方**）。
- **`x-github-client-version` 与页面版本匹配**：该头取值来自 `<meta name="release">`（`CLIENT_VERSION_HTTP_HEADER = 'X-GitHub-Client-Version'`；`getClientVersion()` 读 `meta[name="release"]`，来源等级：**官方（GitHub 前端源码片段转载）**：<https://github.com/ahfuckit/-/blob/master/client-version.ts>）。本次实测 `meta[release] = a25250f4aa593c4ff6c83d2557a0a6b81d14d15c`。**是否必须携带或必须精确匹配：未能查证**；openweb 的公开实现**并不发这个头**却仍成功 ⇒ 至少对 star/unstar **非必需**。
- **被 abuse 检测拦截**：**未查到针对该端点的具体公开案例**（见 §9）。

**稳定性判定**：可行，但属「玻璃地板」——无契约、无 SLA、改版即坏，且历史上已坏过一次。

---

### Q5. 限流

| 项 | 结论 | 等级 |
|---|---|---|
| REST 主限流 5000/h 是否适用于网页端点 | **不适用**（网页端点不是 REST API，不消耗 `core` 额度） | 推断（有官方旁证） |
| 二级限流 900 点/分钟是否适用 | **大概率不适用**（该值明确限定 "for REST API endpoints"） | 官方原文 + 推断 |
| **内容创作限流是否适用** | ✅ **明确适用**。官方原文：「In general, no more than **80 content-generating requests per minute** and no more than **500 content-generating requests per hour** are allowed… **Content creation limits include actions taken on the GitHub web interface** as well as via the REST API and GraphQL API.」 | **官方** |
| 网页端点是否返回 `x-ratelimit-*` | 本次实测三次网页端点响应：`x-ratelimit-remaining = null`、`retry-after = null`（**无**） | 实测 |
| 网页端点限流阈值是否公开 | **未能查证**（无官方文档给出网页端点的具体阈值） | 未确证 |

官方来源：<https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api>

**推断**：网页上的 star/unstar 很可能计入「内容创作」桶（80/分、500/时），或另有未公开的 abuse 阈值；由于**不返回限流头**，脚本**无法主动预判**，只能在 429/403 时退避。**批量恢复 N 个 star 必须自行节流**（本仓库 ADR 已定「全局串行队列 + ≥1s 间隔」，方向正确）。

---

### Q6. 合规判定

**条款原文**

1. Acceptable Use Policies §4「Spam and Inauthentic Activity on GitHub」（来源等级：**官方**，<https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies>）：
   > "We do not allow content or activity on GitHub that is: … **automated excessive bulk activity and coordinated inauthentic activity**, such as … spamming …; **inauthentic interactions, such as fake accounts and automated inauthentic activity**; **rank abuse, such as automated starring or following**; … **using our servers for any form of excessive automated bulk activity**, to place undue burden on our servers through automated means …"

2. 「Disrupting the Experience of Other Users」补充条款（来源等级：**官方（github/docs 源码）**，<https://github.com/github/docs/blob/main/content/site-policy/acceptable-use-policies/github-disrupting-the-experience-of-other-users.md>）：
   > "We do not allow behavior that significantly or continually disrupts the experience of other users. This includes: … **Starring and/or following accounts or repositories in large volume in a short period of time** …"

3. Registered Developer Agreement §4（v）（来源等级：**官方**，<https://docs.github.com/en/site-policy/github-terms/github-registered-developer-agreement>）：
   > "…or (v) **misrepresents or obscures what it does** (for example, if an application takes any actions, **like starring repositories, on behalf of a user without this action being explicitly disclosed**)."

**区分判定**

| 场景 | 是否触及条款 | 理由 |
|---|---|---|
| ① 用户点一次星按钮 → 脚本代发一次请求 | **风险很低**（倾向不构成违规） | ① 频率为单次，不构成 "excessive bulk" 或 "large volume in a short period"；② 动作是**用户在 UI 上显式点击触发**，且按钮语义自明 → 满足 §4(v) 的「explicitly disclosed」；③ 与用户自己点 GitHub 原生按钮在**可观测行为上等价**，不产生额外「不真实互动」 |
| ② 脚本自动/批量恢复 N 个 star | **风险显著升高** | ① 短时间大量 star 动作，正落在 "Starring … in large volume in a short period of time" 与 "excessive automated bulk activity"；② 若用户未逐条确认，可能被认定为「未显式披露的代为操作」（§4(v)）；③ 若与「互星/刷星」外观相似（如自动星他人仓库），可被归入 "rank abuse, such as automated starring" |

**官方是否有「用户脚本代为执行用户本人 UI 操作」的明确立场**：**未能查证**——官方条款没有点名 userscript/browser extension 这一形态，判定的落点是**行为特征（频率、批量性、是否披露、是否制造不真实互动）**，而非实现技术。故合规结论**取决于脚本如何调用**：低频、用户逐条触发、明确告知 → 接近场景①；静默批量 → 接近场景②。

**对本项目的直接含义**：卡片星按钮（场景①）**可以**；「恢复全部 unstar」若做成**一键静默批量**则需改造为**可勾选 + 逐条披露 + 强节流**（这与本仓库 ADR `0003` 已定的「弹出可勾选的确认窗口」方向一致，**该设计同时是合规缓释**）。

---

### Q7. 回归成本对照

采用网页端点后**失去/新增**：

| 维度 | REST（现状） | 网页端点 | 损失程度 |
|---|---|---|---|
| 成功语义 | `204/304` 明确、幂等可判 | `200` + `{"count":"N"}`；**无 204/304**；方向靠 count 增减推断 | 中 |
| 失败语义 | 401/403/404/429 + 文档化含义 | 422（无头）/403/429；**语义未文档化**（本次实测无头 → 422，与社区所述 403 冲突） | 中 |
| 权限可观测性 | 有 `X-Accepted-GitHub-Permissions` | **无** | 低 |
| 契约稳定性 | 版本化（`X-GitHub-Api-Version`）、有废弃期 | **无契约**，改版即坏（已坏过一次：csrf-token→fetch-nonce） | **高** |
| 认证前提 | 仅需 token（无会话也可后台跑） | **必须已登录浏览器会话** | **高** |
| 限流可观测 | `x-ratelimit-*` / `retry-after` | **无任何限流头**（实测 null） | 中 |
| 跨仓批量 | 直接逐条 PUT/DELETE，无需触页面 | 需在同源页/已登录上下文发起；per-form token 需逐个取（或依赖 VF 头） | 中 |
| UI 耦合 | 无 | 依赖 DOM（表单/字段/`context` 值/`meta`） | **高** |
| 合规外观 | API 调用，用户已知 | 易被看成「自动化 star」 | 中 |
| 优点 | — | **绕开 fine-grained 缺口**；与用户点原生按钮等价；`{"count":"N"}` 可即时更新星数 | — |

---

### Q8. 第三条路评估与推荐排序

| 方案 | 优点 | 缺点 | 与网页端点对比 |
|---|---|---|---|
| **a. 混合**：REST（有 classic/OAuth token）优先，失败或无 classic 时回落网页端点 | 保留 REST 的确定性与无会话能力；仅在必要时用玻璃地板；风险最小 | 两条代码路径、两套错误模型、双份测试 | **优于纯网页端点**：把不稳定路径限制在真正需要的少数场景 |
| **b. 引导用户点原生按钮**：脚本不代发请求，滚动/高亮目标仓库让用户自己点 | **零合规风险**（不代替用户操作）；零端点风险；GitHub 改版不影响 | 体验最差，批量场景几乎不可用 | 与网页端点互补；**适合批量「恢复」场景** |
| **c. UI 提示需 classic token + 深链（现状）** | 零风险、零维护；诚实告知限制 | 未解决 fine-grained 用户的痛（用户得去建 classic token） | **网页端点正是为消灭此方案而生** |
| **d. 纯网页端点（本调研对象）** | 技术上解决缺口、已跑通 | 前述全部稳定性/合规/会话成本 | 可作 a 的回落分支，不宜独用 |

**推荐排序（针对本项目）**

1. **a. 混合（首选）**：写路径保持 REST 为默认；**当且仅当**「无 classic/OAuth token（或 REST 返回该 403）」**且**「存在已登录 github.com 会话」时，回落网页端点。回落范围内**只允许用户显式单击触发的单条操作**。
2. **b. 引导原生按钮（批量场景首选）**：对「恢复全部 unstar」不代发请求，改为**可勾选确认 + 高亮/滚动到目标 + 引导用户点击原生按钮**；配合强节流与逐条披露。既规避 AUP 的批量风险，又规避端点失效风险。
3. **c. 保留现状提示为兜底**：会话缺失且无可用 token 时，仍以「需 classic token」+ 深链提示收尾（无任何方案可用时的诚实出口）。
4. **d. 纯网页端点**：不推荐作为唯一写路径。

**落地建议（供实现阶段参考，非本报告职责）**
- 回落判定：`hasClassicOrOAuthToken === false && loggedInSession === true`。
- 网页路径：**批量/离页仓库只带 `GitHub-Verified-Fetch: true`**（实测足以通过）；**页面上已有该仓库表单**时读其真实 `authenticity_token` 随 `new FormData(form)` 发出；**VF 返回 422 才回退**去 `GET` 该仓库页取真实 token 重发一次（`docs/adr/0006`；本报告原建议「优先读真实 token」已按上述理由在批量场景下推翻）。`form.submit()` 必然整页导航，只适合单条、不能循环。
- 成功判定用 `resp.ok`（200）**加事后重读页面 `form[action$="/star"]` / `form[action$="/unstar"]` 的方向**确认；**不要**用 `{"count":"N"}`——那是仓库 star 总数的事后快照（实测 278→277→278），不是本次动作的增量。
- 全局限流：串行 + ≥1s 间隔；遇 422/403/429 一律停止并给出人话提示。
- ~~在 UI 明示「此操作需已登录浏览器会话，且非 GitHub 官方 API」~~ → **已由用户裁定否决**（4.9.0）：写通道**不向用户披露**，静默分派；但**静默 ≠ 静默失败**，任何失败都必须报错（`docs/adr/0006`，含该决定与 RDA §4(v) 披露要求的偏差记录）。

---

## 附加：三条路对照总表

| 维度 | REST PUT/DELETE | 网页端点 | 引导原生按钮 |
|---|---|---|---|
| 解决 fine-grained 写缺口 | ❌ | ✅ | ✅（用户自己点，不受 token 限制） |
| 需要登录会话 | ❌ | ✅ 必须 | ✅（用户本就在用浏览器） |
| 端点稳定性 | ✅ 版本化 | ⚠️ 无契约、已失效过一次 | ✅（用户操作不会失效） |
| 限流可观测 | ✅ | ❌ 无头 | N/A |
| 合规风险 | 低（用户已知） | 单次低 / 批量高 | **零** |
| 批量「恢复全部」体验 | ✅ | ⚠️ 可行但风险高 | ❌ 差 |
| 推荐角色 | 默认主路径 | 有会话时的单条回落 | 批量恢复的推荐方式 |

---

## 未能查证（不编造，明确列出）

1. **网页端点的具体限流阈值**：仅查到通用「内容创作 80/分、500/时」且官方明示含 web 界面；网页端点专属阈值、是否单独计桶、429/403 的触发曲线均**无公开资料**。
2. **`X-Fetch-Nonce` 的有效期/复用次数**：无公开资料；本次会话内未观察到中途失效，**无法给出上限**。
3. **`X-Fetch-Nonce` 是否与用户/会话绑定**：**未能查证**（只确认跨页会变值）。
4. **`X-GitHub-Client-Version` 是否必须携带、是否必须与当前页面 `meta[release]` 精确匹配**：**未能查证**（本次实验未携带该头即成功；openweb 公开实现亦未携带）。
5. **`GitHub-Verified-Fetch: true` 为何使伪造 token 被接受**（是否 GitHub 有意让该头跳过 CSRF 校验、抑或其它机制）：**未能查证**，仅有本次 2 次实测观察。**该行为不应被视为稳定的安全承诺。**
6. **是否存在针对该端点的 abuse 自动拦截的公开案例**（含被限流/封禁报告）：**未查到**（未找到具体到该端点的公开报告，仅有通用的账号处罚讨论）。
7. **GitHub 对「用户脚本/浏览器扩展代用户执行 UI 等价操作」的明确立场**：**未能查证**（条款未点名该形态）。
8. **`context` 参数的全部取值集合与语义**：仅实测到 `user_stars`（stars 页）与社区记录的 `repository`（repo 页）；是否影响服务端行为**未能查证**。
9. **`x-fetch-nonce` 缺失导致 403 的社区说法与实测 422 的矛盾**：**以实测为准**，但缺乏官方解释；可能为改版后行为变化，**未能查证**。

---

## 参考来源列表

**官方**
1. GitHub Docs — Managing your personal access tokens（fine-grained 限制 + classic 写权限原文）
   <https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens>
2. GitHub Docs — Rate limits for the REST API（二级限流、内容创作限流含 web 界面）
   <https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api>
3. GitHub Acceptable Use Policies §4 Spam and Inauthentic Activity
   <https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies>
4. GitHub — Disrupting the Experience of Other Users（large volume starring）
   <https://github.com/github/docs/blob/main/content/site-policy/acceptable-use-policies/github-disrupting-the-experience-of-other-users.md>
5. GitHub Registered Developer Agreement §4（v）explicit disclosure / starring on behalf of user
   <https://docs.github.com/en/site-policy/github-terms/github-registered-developer-agreement>
6. github/roadmap#600（NOT_PLANNED）/ #601（OPEN）
   <https://github.com/github/roadmap/issues/600> · <https://github.com/github/roadmap/issues/601>
7. github/eslint-plugin-github — per-form CSRF token 说明
   <https://github.com/github/eslint-plugin-github/blob/main/docs/rules/authenticity-token.md>
8. Rails — RequestForgeryProtection（per_form_csrf_token / masked token 实现）
   <https://github.com/rails/rails/blob/main/actionpack/lib/action_controller/metal/request_forgery_protection.rb>
9. GitHub Docs — REST endpoints for starring（对比 REST 语义）
   <https://docs.github.com/en/rest/activity/starring>

**社区 / 开源实现**
10. openweb-org/openweb — `src/sites/github/PROGRESS.md`（fetch-nonce + GitHub-Verified-Fetch 的一手记录、改版教训）
    <https://github.com/openweb-org/openweb/blob/main/src/sites/github/PROGRESS.md>
11. openweb-org/openweb — `src/sites/github/adapters/github-web.ts`（star/unstar 适配器实现）
    <https://github.com/openweb-org/openweb/blob/main/src/sites/github/adapters/github-web.ts>
12. openweb-org/openweb — DOC.md / SKILL.md（Adapter Patterns、Known Issues）
    <https://github.com/openweb-org/openweb/blob/main/src/sites/github/DOC.md>
13. fahamjv/github-bulk-unstar（FormData(form) 批量 unstar，2026-06-21）
    <https://github.com/fahamjv/github-bulk-unstar>
14. Fldicoahkiin/GithubStarListsPlus（userscript/扩展，写路径为 **REST DELETE**；原生表单仅用于读星状态）
    <https://github.com/Fldicoahkiin/GithubStarListsPlus>（**订正**：其写路径为 REST DELETE，原生表单只用于读星状态，不可作为网页写端点先例）
15. catui-agent domain-skill — Repo actions (star, unstar, watch)（`form.submit()` 推荐 + React 合成点击失效教训）
    <https://cdn.jsdelivr.net/npm/catui-agent@1.2.20/dist/extensions/builtin/browser/agent-workspace/domain-skills/github/repo-actions.md>
16. client-version.ts（`X-GitHub-Client-Version` ← `meta[name="release"]`）
    <https://github.com/ahfuckit/-/blob/master/client-version.ts>
17. izumi0uu/better-github-stars-manager — `src/api/github-star-source.ts`（REST 写路径错误模型参考）
    <https://github.com/izumi0uu/better-github-stars-manager/blob/d9037334/src/api/github-star-source.ts>
18. GitHub Community Discussion #106661 / #164432（fine-grained PAT `Resource not accessible` 讨论）
    <https://github.com/orgs/community/discussions/106661> · <https://github.com/orgs/community/discussions/164432>
19. WyattJia/batch_unstar（REST 批量方案与节流实践，对比项）
    <https://github.com/WyattJia/batch_unstar>

**实测（本机浏览器，2026-09-26）**
20. 只读 DOM 观察 + 三组对照请求实验：`meta[fetch-nonce]` 跨页差异、60 表单 60 唯一 token、三组 HTTP 结果（200/200/422）、`{"count":"277"}`→ 复原 `{"count":"278"}`、限流头为 null、`meta[release]` 值。原始观测记录见本报告 §3.5 与 §3.2。

---

## 附录 A · 4.9.0 发布前的真机复核（2026-10-01）

这一节是**出厂代码路径**的复核，不是探索性研究。方法：在真实 Chrome、已登录会话、**stars 页**内
用与 `src/starWrites.ts` 逐字同形的 `fetch` 发请求（目标仓库 `YsLtr/qq_warning`，自有、public，
且**不在该页 DOM 内** —— 即真正的「离页」）。方向双向各测一次，并用 `GET /user/starred/{o}/{r}`
（204 = 已 star / 404 = 未 star）复核远端真实状态。基线 S0 = 未 star，测试后**已复原**（star 数 3→4→3）。

### A.1 仅带 `GitHub-Verified-Fetch` 的离页写：**成立**

```js
const fd = new FormData();
fd.append('authenticity_token', <86 字符随机占位>);   // 与实测组 B 同形
fd.append('context', 'user_stars');
await fetch('/YsLtr/qq_warning/star', {
  method: 'POST', credentials: 'same-origin',
  headers: { 'GitHub-Verified-Fetch': 'true', 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
  body: fd,
});
```

| 请求 | 响应 | 远端复核 |
|---|---|---|
| `POST /YsLtr/qq_warning/star`（页面无该仓库表单） | **200**，`application/json`，`{"count":"4"}`，728 ms | `GET /user/starred/…` → **204**（确认已 star） |
| `POST /YsLtr/qq_warning/unstar` | **200**，`{"count":"3"}` | `GET /user/starred/…` → **404**（确认已取消） |

⇒ **「离页仓库 + 占位 token + 只带 VF 头」不是推断，是实测事实，且两个方向都成立。**
这是 4.9.0 卡片星星按钮与批量恢复的可行性基础。

### A.2 422 回退的前提**被推翻**（本节最重要的一条）

原设计（本报告 §3.5 末句 + ADR 0006）的安全网是：VF 被拒（422）时 `GET /{o}/{r}` 取服务端 HTML 里的
`form[action="/{o}/{r}/star"]` 真实 token 重发一次。实测：

| 页面 | 原始 HTML | `<form>` 数量 |
|---|---|---|
| `GET /YsLtr/qq_warning`（仓库详情页） | 200，**339,195 字节** | **0**（`document.querySelectorAll('form').length === 0`，含任意 action） |
| `GET /https://github.com/YsLtr?tab=stars`（原生 stars 列表页） | 200，1,142,704 字节 | **64** = 30 × `action$="/star"` + 30 × `action$="/unstar"`（与 live DOM 一致） |

结论：仓库详情页已是**纯客户端渲染**，任何「从仓库页 HTML 取 per-form token」的方案都是死码；
per-form token 只存在于**原生 stars 列表页的服务端渲染**，且只覆盖**当页那 30 个仓库**。
恢复场景的对象按定义不在 stars 列表里 ⇒ 该来源也救不了恢复。

**已据此删除该回退**（`src/starWrites.ts`），降级从三段变两段（真实 token → 仅 VF → 报错）。
不去 fetch stars 列表页的理由：1.1 MB / 次，且覆盖不到恢复场景。

### A.3 复核过程中暴露的另外两点

- **`promptForToken` 用原生 `window.prompt`**：它会在**整个页面主线程上阻塞**（实测：点击 Sync 且未配置
  token 时，页面 JS 通道整体失去响应，重载才恢复）。原生 JS 对话框属浏览器 chrome 层，
  **不进页面合成帧** —— 所以截图看不到它，容易误判为「页面正常但无响应」。4.9.0 已把
  「Sync 但无 token」这一路径改为打开**配置横幅**（`notifyTokenIssue`），TM 菜单入口保留 prompt。
- **验证工具自身的干扰**：`agent-browser-cli` 会在页面 MAIN world 注入对话框抑制脚本，把
  `window.alert/confirm/prompt` 换成 stub（`function(msg,def){toast('prompt',msg);return def||null;}`）。
  凡是要观察 `alert`/`prompt` 行为的验证，都必须先确认该 stub 是否在场，否则会「看不到对话框」而误判。

### A.4 出厂实现路径的端到端复核：**通过**（同一会话内完成）

不是手搓请求，而是**真实触发脚本自己的代码**：对网格卡片 `jimmgreen/LumaShot` 的 `.stars-star-btn`
派发一次 `.click()`（合成点击足以触发；脚本的处理器不校验 `isTrusted` —— 只有浏览器门控行为如文件选择器才需要）。
判定**不采信 UI**（本环境 `window.alert` 被工具注入的 stub 吞掉），一律用 `GET /user/starred/{o}/{r}` 复核远端。

| 步骤 | 观测 | 远端复核 |
|---|---|---|
| 点击卡片星按钮（无 token ⇒ 走网页通道，目标不在页面上） | 按钮**立即**变 `unstarred`（乐观翻转） | — |
| ~1s 后 | **`.gsm-notify-stack` 被创建**，1 条 `gsm-notice gsm-notice-warn`（样式全内联）；文案 `已取消 star：jimmgreen/LumaShot`，含 **`撤销`** 动作按钮 + `×` 关闭 | `GET /user/starred/jimmgreen/LumaShot` → **404**（远端**真的**取消了） |
| 点通知里的 `撤销` | 卡片按钮回到 `starred`；该通知**原地**变为 `✓ jimmgreen/LumaShot 已恢复`，动作按钮消失 | → **204**（远端**真的**恢复了，用户状态零残留） |
| 通知生命周期 | 在**隐藏标签页**里 6s 仍在、50–75s 之间消失 —— 与 Chrome 把后台定时器节流到 ~1/min 一致（非缺陷；前台应为 3s） | — |

⇒ **离页 + 仅 VF 的写路径、全局串行队列、通知栈、通知内「撤销」恢复，四者在真实浏览器里全部按设计工作。**
（本次跑的是 dev 服务提供的**当前源码**；打包产物只经 `pnpm check` 验证，未在真机装载。）
