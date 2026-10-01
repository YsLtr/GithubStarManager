# 网页端点写回落

当**没有 classic/OAuth token**，或 REST 写请求被 GitHub 拒绝（fine-grained PAT 的先天缺陷）时，写路径改用 GitHub 网页自己的内部端点 `POST https://github.com/{owner}/{repo}/star`（`/unstar`）。它用 **Cookie 会话**认证，**与 token 类型完全无关** —— 这是 fine-grained 用户获得与 classic 用户同等 star/unstar 能力的唯一现实手段，无需用户再去建一个 classic PAT。

## 已定案的行为

- **触发条件**：写操作统一走 `starWrites` 的**静默分派** —— 有 classic / OAuth（`gho_`）token → REST `PUT`/`DELETE /user/starred/{o}/{r}`；否则（无 token，或 REST 返回 `403 Resource not accessible by personal access token`）且存在已登录 github.com 会话 → 网页端点。两条通道对调用方接口一致，调用方不感知通道。
- **凭据**：Cookie 会话（`credentials: 'same-origin'`）+ 请求头 `GitHub-Verified-Fetch: true`。**不发送** `X-Fetch-Nonce`、**不发送** `X-GitHub-Client-Version`。页面 DOM 里**已有该仓库表单**时（单条操作）改读该表单的真实 `authenticity_token` 并随 `new FormData(form)` 一起发出 —— 单条场景下读取是免费的。**批量/离页仓库不取 per-form token**：目标仓库不在当前 DOM 内，而 `authenticity_token` 是 per-form 且与 action+method 绑定（stars 页实测 60 个表单 → 60 个唯一值），逐个去读要多付一次 `GET` + 解析已 React 化的仓库页 DOM；实测证明只带 `GitHub-Verified-Fetch: true` 即可通过（连伪造 token 亦被接受）。
- **成功判定**：`resp.ok`（200），**并在页面上存在该仓库表单时**额外复核方向已翻转（`form[action$="/star"]` = 已取消 / `form[action$="/unstar"]` = 已 star，未翻转即判失败）。复核只可能发生在「表单本来就在页面上」的场景；网格卡片与离页恢复**无从复核**，只能以 200 为准 —— 这是本方案已知的判定弱点（见「未确证」）。**不得**用 `{"count":"N"}` —— 那是该仓库的 star 总数事后快照（实测 278→277→278），不是本次动作的增量，且同名 `count` 字段在 watch 端点返回 `{"count":"1"}`，含义并不统一。
- **失败语义**：**422 = Rails CSRF 校验失败**（如 `InvalidAuthenticityToken`），且**即便带了 `Accept: application/json` 响应体仍是 HTML** → 必须 `resp.text()` 后再 `try { JSON.parse }`；403 = GitHub fetch 校验层。任何一条失败**即整批停止并报错**，**不自动重试**、不猜想；不得静默吞掉。
- **会话检测**：`document.body.classList.contains('logged-in')` **且** `meta[name="user-login"]` 的 `content` **非空串**。只看 meta 是否存在是错的（未登录时可能以空串存在）；`form[action$="/unstar"]` 不能当登录判据（它只说明该仓库已 star）。
- **批量恢复**：脚本**代发**请求（非「引导用户点原生按钮」）—— 一键「恢复选中」+ 恢复列表**每行之后一个 star 按钮**（可单条直点）。两种入口都进同一个**全局串行队列**（变异请求间隔 ≥1s），进度可见、执行中可取消（取消只停后续，已发出的不回滚）。
- **通道优先级与失效降级是两件事**（勿混）：**优先级**是「有 classic/OAuth token 就先 REST，否则/被拒才用网页端点」（见「触发条件」）；**失效降级**指网页端点本身坏掉时往哪退 —— 网页端点 → REST（若此时有可用 token）→ 引导 classic PAT 深链。两层都**不留静默失败**。按「以月为周期」设计失效（半年内已发生 ≥3 起有来源的前端改版事件：「改版多久失效一次」无量化数据）。
- **不向用户披露通道**：UI 与用户可见文案**不出现**「网页端点」「浏览器会话」「GitHub-Verified-Fetch」等实现细节；失败文案保持结果导向（如「恢复失败：权限不足」）。**静默分派 ≠ 静默失败**：任何失败都必须报错。

## 未确证（实现期需真机验证一次，不写进结论）

- **`context` 字段在 repo 作用域端点上的取值**：实测只在 stars 页验证过（`user_stars`）；repo 页观测值为 `repository`，服务端是否据此分支**未能查证**。恢复入口可从任意 github.com 页面打开，故 `context` 只作原样携带、不当作契约。
- **422 回退前提**：假设 `GET /{o}/{r}` 的**服务端 HTML** 里带 `form[action="/{o}/{r}/star"]`。详情页已 React 化，若原始 HTML 不含该表单，回退函数会拿不到 token，退化为直接报 422 —— 即「玻璃地板」的安全网本身也会失效。需真机取一次 HTML 确认。
- **`{"count":"N"}` 的官方定义**：无文档；「仓库 star 总数的事后快照」是从单仓库 278→277→278 观测得出的推断（这也是不用它作判据的原因，而非它已被证明无用）。

## 依据

- 端点形态与凭据：`docs/research-web-star-endpoints.md` §3.5（三组对照实测：A = `X-Fetch-Nonce` + VF → 200、B = **仅 VF** → 200、C = 两者皆无 → 422；决定性变量是 VF 而非 nonce，伪造 token 亦被接受）。实测副作用为真实 unstar（`Ariestar/sivtr` 278 → 277），随后以 `POST /star` 复原至 278，**状态已完全复原**。
- 认证与 token 无关：同文档 Q2（`credentials: 'include'`、无 `Authorization` 头）；旁证 —— GitHub 网页调 api.github.com 时用的是服务端临时合成的内部 bearer token，**不是** `_gh_sess` cookie，故「有登录态就能调 REST」不成立。
- per-form token 绑定：同文档 §3.2（60 表单 60 唯一 token）；表单提交形态 `docs/research-web-endpoint-integration.md` §Q1（`fetch(form.action, {body: new FormData(form)})`；`form.submit()` 必然整页导航，只适合单条、不能循环）。
- 422 语义：同报告 §Q4（含 rails/rails#21948 的 `InvalidAuthenticityToken` → 422 一手日志）；`count` 语义：同报告 §Q5。
- 合规分水岭：Acceptable Use Policy §4 *"rank abuse, such as automated starring"*、*"Starring and/or following accounts or repositories in large volume in a short period of time"*（<https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies>）；Registered Developer Agreement §4(v) *"starring repositories, on behalf of a user without this action being explicitly disclosed"*（<https://docs.github.com/en/site-policy/github-terms/github-registered-developer-agreement>）。

## Considered Options

- **纯 REST（`0004` 的原范围）**：被否决为**唯一**路径。它把 fine-grained 用户挡在写路径之外（该缺陷 GitHub 已宣布不计划补齐），而网页端点用同一份会话就能写。
- **纯网页端点（不保留 REST）**：否决。会失去 API 契约（版本化、`X-GitHub-Api-Version`、废弃期）、失去 `x-ratelimit-*` 可观测性，且要求浏览器会话 —— 无会话时完全不可用。故只作回落。
- **批量改为「引导用户点原生按钮」，脚本不代发**：否决。**用户明确要求实现一键恢复**。该方案的零合规风险优势被用户知情后放弃，改为在技术上收紧（严格串行 ≥1s、进度可见、可取消、**不自动重试**、确认弹窗显示条数与预估耗时）。
- **依赖 `X-Fetch-Nonce`**：否决。无 `GitHub-Verified-Fetch` 时缺它必 403（openweb 记录），而 VF 单独即可通过 ⇒ nonce 是冗余变量，去掉可少读一次 DOM。
- **优先读真实 per-form token、VF 作兜底**（`docs/research-web-star-endpoints.md` §3.5 末句的原建议）：**批量场景下推翻**。那句话是针对单条写的（表单已在页面上，读取免费）；批量下读取要额外付一次 `GET` + React 页 DOM 解析，方向相反。**保留 422 回退**：一旦 VF 被收紧而返回 422，则改为 `GET` 该仓库页取真实 token 重发一次。

## 后果

- **写路径有了两条通道**：`0004` 的「只支持 classic token」因此收窄为「**REST** 写路径只支持 classic token」；本 ADR 是其补充，不是推翻。
- **偏离 RDA §4(v) 的披露要求**：静默分派不向用户披露通道，属**用户知情后接受**的已知偏差，记录在此以便日后回溯。
- **`GitHub-Verified-Fetch: true` 是玻璃地板**：该行为无文档、无契约（公开来源仅 2 次观测），GitHub 随时可收紧。这是保留 422 回退与三段式降级的全部理由。
- **批量请求数**：有 classic token 时每仓库 1 个写请求；无 token 走网页路径时正常情况下同样 1 个；仅 422 回退时变 **3 个**（POST → GET 仓库页取真实 token → 再 POST）。
- **失败文案不得指向无解方向**：403 不再引导用户「检查 Starring 权限」；无任何通道可用时，以 classic PAT 深链收尾。
