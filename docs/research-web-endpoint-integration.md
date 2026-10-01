# 回落使用 GitHub 网页内部端点做 star/unstar —— 工程落地调研报告

- 调研对象：Tampermonkey 用户脚本 GithubStarManager（`@match https://github.com/*`，跑在 github.com 页面上下文）
- 调研日期：**2026-10-01（+0800）**
- 调研方式：公开网络检索 + 公开仓库源码精读（部分仓库已克隆到本机只读阅读）+ 交叉核对仓库内既有调研 `docs/research-web-star-endpoints.md`
- **约束遵守**：本次调研**未执行任何真实 star/unstar 请求**，未对任何仓库做状态变更，未修改本仓库任何代码或文档；本报告是唯一输出文件。
- 结论口径：每条结论都标注来源等级 `[官方]` / `[官方员工]` / `[社区]` / `[实测]` / `[未确证]`；冲突处注明分歧。

> **Verdict: Extend — custom（薄封装自研）+ 复用 `fetch(form.action, {body: new FormData(form)})` 与 `form[action$="/unstar"]` 原生表单 — 无任何单一现成库可直接采纳：公开实现只有零散脚本（fahamjv 87 行 DevTools 脚本）、AI agent 适配器（openweb）与提示文档（catui-agent domain-skill），没有任何一个提供「会话检测 + 失败分类 + 降级路径」的完整封装；且三者对失败状态码的口径互相冲突（422 vs 403），必须自建错误模型。**

---

## 一、落地要点清单（每条一行，可直接照做）

1. **不要用 `form.submit()` 做批量**：它必然触发整页导航，每次只提交一个仓库；批量场景一律用 `fetch(form.action, { body: new FormData(form), credentials: 'same-origin' })`。`[社区+实测]`
2. **`fetch` 的 body 直接传 `FormData` 对象，绝不手动设 `Content-Type`**：浏览器会自动补 `multipart/form-data; boundary=...`；手动设 `Content-Type: multipart/form-data`（无 boundary）才是「missing boundary」报错的唯一成因。`[官方(MDN)]`
3. **每次操作现取现用 token**：`form[action$="/star"], form[action$="/unstar"]` 的 `input[name=authenticity_token]` 是 **per-form** 的（stars 页 60 个表单 60 个不同 token）；换页/换仓库必须重取，禁止缓存复用。`[官方(GitHub eslint 规则)+实测]`
4. **`context` 从源表单原样复制**：`new FormData(form)` 会自动带上；手工构造时用源页面表单里的值（stars 页 `user_stars`、repo 页 `repository`），不要硬编码单一值。`[实测+社区]`
5. **请求头最小集**：`Accept: application/json` + `X-Requested-With: XMLHttpRequest` + `credentials: 'same-origin'`（配合真实 per-form token，无需任何 nonce / VF 头即可成功）。`[社区代码+实测]`
6. **不要依赖 `GitHub-Verified-Fetch: true` 作为主路径**：它能免 token 通过校验，但行为未文档化、无稳定性承诺，只作兜底且在 UI 明示「非官方 API」。`[实测（单会话 2 次）]`
7. **会话检测用双判据**：`document.body.classList.contains('logged-in')` **且** `(document.querySelector('meta[name="user-login"]')?.content ?? '') !== ''`；只判断 meta 标签**是否存在**是错的（未登录时该标签可能存在但 content 为空串）。`[实测+社区]`
8. **未登录时表单根本不渲染** → 登录检测失败就直接走 REST/引导分支，不要发请求赌一把。`[社区(catui-agent)]`
9. **成功判定不要只看 `{"count":"N"}`**：用 `resp.ok`（200）+ 事后重新读取页面 `form` 方向（存在 `form[action$="/star"]` = 已取消，`/unstar` = 已 star）双确认；`count` 是全局快照、不是你的动作增量，并发下不可靠。`[实测+推断]`
10. **错误分类必须显式建模**：`ok` / `needsLogin(401|403)` / `csrfRejected(422)` / `forbidden(403)` / `notFound(404)` / `rateLimited(429)` / `endpointChanged(HTML 响应或字段缺失)`——遇到后两者必须**停止并提示，而不是静默失败**。`[官方(Rails/HTTP)+实测]`
11. **响应体形态按状态码分流**：成功（200）且 `Accept: application/json` → JSON；**CSRF 失败（422）即使带了 `Accept: application/json` 也返回 HTML 错误页**，不要盲目 `resp.json()`，先 `resp.text()` 再尝试解析。`[实测]`
12. **端点有效性前置探测**：发请求前检查 `meta[name="fetch-nonce"]` 或目标表单 token 是否存在 + `meta[name="release"]` 是否可读；任一缺失 → 判定「GitHub 前端已改版」，直接进入降级路径。`[社区(openweb)+推断]`
13. **降级路径三段式**：`网页端点失败 → REST(classic/OAuth PAT) → 引导用户点原生按钮 / 给出 classic PAT 深链`；网页端点标记为「本会话已失效」，避免反复重试打爆。`[设计建议，基于社区失败教训]`
14. **全局限流：串行 + ≥1s 间隔**；网页端点不返回 `x-ratelimit-*`，无法主动预判，只能在 422/403/429 时退避。`[官方(内容创作限流)+实测]`
15. **`X-GitHub-Client-Version` 不必发送**：openweb 与仓库既有实测都未携带该头却成功；若确要发，值从 `meta[name="release"]` 现读，勿硬编码。`[社区代码+实测]`
16. **合规自检**：单条用户显式点击 ≈ 低风险；任何「一键静默批量恢复」都需改造为可勾选 + 逐条披露 + 强节流，否则落入 AUP「rank abuse, such as automated starring」。`[官方(AUP)]`

---

## 二、逐问证据明细

### Q1. `form.submit()` 与 `fetch(form.action, {body: new FormData(form)})` 各自怎么做

#### Q1-a `form.submit()` 路径（catui-agent domain-skill）

唯一明确推荐 `form.submit()` 的公开来源是 `catui-agent` 的 domain-skill 文档（jsdelivr CDN 上的 npm 包内容，属**社区**；其仓库不可直接访问，仅 CDN 发行物可读）：

> "user-triggered actions on the repo header (Star, Unstar, Watch, Unwatch) are HTML forms that POST back to GitHub with the session's CSRF token already rendered inline. **Submit the form — do not click the button.**"
> "`form.submit()` sidesteps both problems — it bypasses React entirely and goes straight to the HTML form's POST. **The authenticity token is already in a hidden input inside the form, so there's nothing extra to fetch.**"
> —— <https://cdn.jsdelivr.net/npm/catui-agent@1.2.20/dist/extensions/builtin/browser/agent-workspace/domain-skills/github/repo-actions.md> `[社区]`

它同时给出了**成功判定**与**副作用/失败模式**：

> "**Star count in the rendered button lags the true count by a hydration tick.** The durable signal that 'this worked' is which form is on the page after reload: `form[action$="/star"]` present means unstarred, `form[action$="/unstar"]` means starred. The visible aria-label is reliable once you scroll to the top and wait ~1s after submit; the count inside the button updates on soft navigation and is not a good assertion target."
> "**`form.submit()` bypasses the form's `submit` event listeners** — fine for GitHub's case (the handler is a full navigation), but if a future change wires in `e.preventDefault()` to do an XHR, `form.requestSubmit()` is the safer alternative. Worth trying first if `form.submit()` stops working." `[社区]`

同一文档还记录了**为什么不能点按钮**（对本项目「卡片星按钮」直接相关）：

> "**There are two matching buttons.** The first one `querySelector` returns is a hidden fallback inside the sticky sub-header form with `getBoundingClientRect() == {x:0, y:0, w:0, h:0}`. Coordinate-clicking it does nothing because it has no geometry."
> "**Synthetic `.click()` on the visible React button does not persist the star.** The click fires, `aria-label` stays `Star ...`, network tab shows no POST. GitHub's component swallows the synthetic event somewhere in its React fiber handler." `[社区]`

**结论**：`form.submit()` = 零自定义头、零 token 读取、但**必然整页导航**、且成功只能靠「导航后页面上的表单方向」间接判定。**不适合批量**（N 个仓库 = N 次整页导航，且页面卸载会中断循环）。

#### Q1-b `fetch(form.action, {body: new FormData(form)})` 路径（fahamjv/github-bulk-unstar，真实可用）

`fahamjv/github-bulk-unstar`（DevTools 直接粘贴脚本，README 明示「No token, installation, extension, userscript manager, or setup required」）核心实现 `[社区]`：

```js
const response = await fetch(form.action, {
  method: 'POST',
  body: new FormData(form),
  credentials: 'same-origin',
  headers: {
    Accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  },
});
console.log(`${response.ok ? '✅' : '❌'} ${repo} ${response.status}`);
return response.ok;
```

- **成功判定**：`response.ok`（200）。**副作用**：无导航，页面留在原地（脚本自己循环）。
- **失败模式**：非 2xx 只打印 ❌ / 计入失败，不做细分（这正是本项目需要自己补的部分）。
- **节流**：每条之间 `await sleep(700)`，翻页之间 `await sleep(1200)`；第 2 页起用 `Turbo-Frame: user-starred-repos` 头拉 HTML 再用 `DOMParser` 解析出表单。
- 选择器：`.js-social-container.on form[action$="/unstar"]`（注意它**限定了 `.on`**，即只挑当前处于已 star 状态的容器）。
- 仓库无 open issue（GitHub API 查询 `issues?state=all` 返回空数组），**未见被拦截/失效的公开报告**。`[社区]`
- 来源：<https://github.com/fahamjv/github-bulk-unstar> `[社区]`

openweb 的 `github-web.ts` 用同一思路但**手工构造 FormData 并额外加 nonce+VF 头**（见 Q3/Q7）`[社区]`。

#### Q1-c `FormData` 会不会缺 multipart boundary？——**不会**

这是本节最明确的结论，官方文档有原文警告：

> "**Warning:** When using `FormData` to submit POST requests using `XMLHttpRequest` or the Fetch API with the `multipart/form-data` content type ... **do not explicitly set the `Content-Type` header on the request.** Doing so will prevent the browser from being able to set the `Content-Type` header with the boundary expression it will use to delimit form fields in the request body."
> —— MDN, *Using FormData Objects*，<https://developer.mozilla.org/en-US/docs/Web/API/FormData/Using_FormData_Objects> `[官方]`

即：**只要你把 `FormData` 对象直接交给 `body`，浏览器自动补 `Content-Type: multipart/form-data; boundary=----WebKitFormBoundary...`**。「missing boundary」这个经典错误只在**你手动写了 `Content-Type: multipart/form-data`**（不带 boundary）时才发生（StackOverflow 39280438、github/fetch#505 讨论的正是这一种）。因此 `fetch(form.action, { body: new FormData(form) })` **不会**因 boundary 出错。`[官方(MDN)+社区]`

#### Q1-d `form.submit()` vs `fetch(FormData)` 对照

| 维度 | `form.submit()` | `fetch(action, {body: new FormData(form)})` |
|---|---|---|
| 是否需读 token | 否（表单内已带） | 否（`FormData(form)` 自动带上） |
| 是否需读 nonce / VF | 否 | 否（带真实 token 时） |
| 是否自定义头 | 否 | 是（`Accept` / `X-Requested-With`） |
| 响应形态 | 整页 HTML（导航） | JSON `{"count":"N"}`（200） |
| 成功后页面 | 整页刷新 | 无变化，需自己重绘 |
| 成功判定 | 导航后读 `form[action$=...]` 方向 | `resp.ok` |
| 循环批量 | ❌（每次导航卸载页面） | ✅（配合串行 + 节流） |
| 失败可分类 | ❌（只看到最终页面） | ✅（可读 status） |
| 依赖 | HTML 表单存在 | HTML 表单存在 + 同源 fetch |
| **本项目建议** | 单条、且希望「像用户原样提交」时可用 | **主路径**（批量与单条统一走它） |

---

### Q2. 会话（登录态）检测

**先给最重要的反面结论**：`form[action$="/unstar"]` 的存在**不是**登录判据——它只说明「当前这个仓库已被本人 star」。`form[action$="/star"]` 与 `/unstar` 都只在登录时渲染（见下），但具体哪个存在取决于仓库状态，因此它只能当**辅助确认**，不能当「已登录」的判据。

| 候选判据 | 可靠性 | 公开实现用法 / 依据 |
|---|---|---|
| `document.body.classList.contains('logged-in')` | **高** | openweb 适配器显式用它做门禁：`const loggedIn = document.body.classList.contains('logged-in')` 后 `if (!ctx.loggedIn) throw errors.needsLogin()`。仓库既有实测亦为 `true`。`[社区+实测]` |
| `meta[name="user-login"]` 的 **content 非空** | **高（最便宜）** | catui-agent：「`meta[name="user-login"]` is the cheapest pre-check.」openweb 也用它做二次确认（实测 `user-login=imoonkey`）。`[社区+实测]` |
| `!!document.querySelector("meta[name=user-login]")`（**只看存在**） | **不可靠** | 未登录时该 meta **可能仍存在但 content 为空串**——存在性判断会误判为已登录。（用户观察 + catui-agent 用的是 `!!querySelector(...)` 这一写法，需按 content 判空修正。）`[实测（用户）+社区]` |
| 页面上存在 `form[action$="/star"\|"/unstar"]` | **仅作辅助** | catui-agent：「If the user is not logged in the forms are not rendered at all.」——所以「无任何 star/unstar 表单」⇒ 未登录；但「有表单」只说明登录 + 当前仓库状态，不能跨页推广。`[社区]` |

**落地判据（组合式，两个都很便宜）**：

```js
const loggedIn =
  document.body.classList.contains('logged-in') &&
  (document.querySelector('meta[name="user-login"]')?.content ?? '') !== '';
```

理由：两者相互独立、都不依赖目标仓库状态、都不需要发请求；任一为假即判定未登录，直接进入 REST/引导分支。`[推断，基于社区实现]`

来源：<https://github.com/openweb-org/openweb/blob/main/src/sites/github/adapters/github-web.ts>（`navigateAndExtractRepo` / `navigateAndExtractForm`）· <https://cdn.jsdelivr.net/npm/catui-agent@1.2.20/.../github/repo-actions.md> `[社区]`

---

### Q3. `context` 字段

**已确认的取值**（均为观测值，非官方枚举）：

| 取值 | 出现页面 | 来源等级 |
|---|---|---|
| `user_stars` | stars 页（`https://github.com/<user>?tab=stars`）的 `form[action$="/unstar"]` 内 | `[实测]`（仓库既有调研 §3.5 表单结构） |
| `repository` | repo 页（`https://github.com/<owner>/<repo>`）的 `form[action$="/star"\|"/unstar"]` 内 | `[社区]`（openweb 适配器硬编码 `context: 'repository'`；其 DOC.md 的 probe 表也记录该值） |
| `other` | repositories 页（用户在其他页面实测到） | `[实测（用户）]`，**仅一次观测，未复现** |

**服务端是否因 `context` 不同而行为不同**：**未能查证**。没有任何官方或社区来源说明 `context` 参与鉴权或分支逻辑。可观察到的旁证反而指向「它大概率只是来源标记 / 遥测」：

- 仓库既有实测中，带 `GitHub-Verified-Fetch: true` 时**连伪造的 `authenticity_token` 都被接受**，说明服务端在该路径下并不校验 token 内容——若 `context` 参与校验，同一宽松路径下它多半也不参与。`[实测]`
- openweb 从 repo 页发 `context=repository` 成功；仓库实测从 stars 页发 `context=user_stars` 成功——两者的 `context` 不同、目标端点同为 `/{owner}/{repo}/{star,unstar}`，均 200。`[社区+实测]`

**传错会怎样**：**未能查证**。没有做过「token 取自 A 页、context 传成 B 页值」的对照实验。

**落地建议**：不要猜、不要硬编码。用 `new FormData(form)` 时 `context` 自动来自源表单；手工构造时**原样复制源表单里 `input[name="context"]` 的 value**，这样无论取值集合如何扩展都不会错。`[推断]`

---

### Q4. 失败语义（状态码 + 响应体形态）

**先说清楚一个根本事实**：这套端点**无官方文档**，所有状态码语义都是「Rails 通用行为 + 社区观测」拼出来的，且**社区与实测存在明确分歧**。

| 场景 | 状态码 | 响应体 | 等级 / 依据 |
|---|---|---|---|
| **成功** | **200** | JSON `{"count":"N"}`（带 `Accept: application/json`） | `[实测+社区]` |
| **CSRF / token 校验失败（无任何额外头、无有效 token）** | **422** | **HTML**（Rails 错误页；实测为受 CSP 限制的页面） | `[实测（仓库既有调研三组对照 C 组）]` |
| **CSRF / nonce 缺失（openweb 的口径）** | **403** | 未记录 | `[社区]` openweb PROGRESS.md：「Without both headers, every endpoint returns 403.」 |
| **未登录** | 未确证（openweb 把 web POST 的 401/403 映射为 `needsLogin`） | 未确证 | `[社区（映射逻辑）+未确证（真实码）]` |
| **仓库不存在 / 不可见** | 未确证（推测 404） | 未确证 | — |
| **权限不足** | 基本不适用（Cookie 会话下，公开仓库一律可 star；不可见则等价 404） | — | `[推断]` |
| **被限流** | 未确证（网页端点**不返回** `x-ratelimit-*` / `retry-after`） | 未确证 | `[实测：限流头为 null]` |

#### Q4-a 422 与 403 的区分判据

- **422 = Rails 层的 CSRF / 校验失败**。这是 Rails 的默认行为，有硬证据：`rails/rails#21948` 的生产日志原文——浏览器缓存了带 token 的表单但 session cookie 已被清空，POST 后：

  > `Can't verify CSRF token authenticity` → `Completed 422 Unprocessable Entity in 1ms` → `ActionController::InvalidAuthenticityToken`
  > —— <https://github.com/rails/rails/issues/21948> `[官方(Rails 上游 issue 的一手日志)]`

  生产环境下该错误渲染为 HTML 文案「The change you wanted was rejected」（同 issue 正文）。这与仓库既有实测「无额外头 → 422 + HTML」完全吻合。`[官方+实测]`

- **403 = GitHub 自有的「fetch 校验 / 资源不可达」层**。openweb 观测到缺 `X-Fetch-Nonce` + `GitHub-Verified-Fetch` 时返回 403；其适配器也把 401/403 一并当作 `needsLogin`。`[社区]`

- **分歧处理**：仓库既有实测（2026-09-26，单会话 3 组对照）得到 **422**，openweb（2026-04-19）得到 **403**。两者可能都对——差异来自**请求是否携带了 `X-Fetch-Nonce` 头**：完全不带任何头 → 落到 Rails CSRF → 422；带了 nonce 但 nonce/VF 无效 → 落到 GitHub 的 verified-fetch 校验层 → 403。**本报告按「以实测为准、并注明分歧」处理**。`[实测+社区，分歧]`

- **实用判据**：
  - `422` → **你的 body/token/context 不对，或压根没通过 CSRF**；重取 token 后重试一次，仍失败即判定端点变更。
  - `403` → **头部校验层拒绝**，或会话/权限问题；先查登录态，再查是否漏了 VF/nonce。
  - 两者都**不要**当成「已被限流」；网页端点给不出限流信号。

#### Q4-b 响应体是 HTML 还是 JSON，`accept: application/json` 是否总能拿到 JSON

**不是总能。** 观察到的规则：

- **200（成功）**：带 `Accept: application/json` → JSON（`{"count":"N"}`）。`[实测+社区]`
- **422（失败）**：**即使带了 `Accept: application/json`，返回的仍是 HTML 错误页**（实测如此）。Rails 对 `InvalidAuthenticityToken` 的渲染走异常处理通道，不按 `Accept` 协商。`[实测（仓库既有调研）+官方旁证（Rails 默认行为）]`
- **403（fetch 校验层）**：未记录响应体形态。`[未确证]`

**落地要求**：先 `await resp.text()`，再 `try { JSON.parse(text) } catch { /* 保留 text 前 N 字符做诊断 */ }`；**不要**直接 `resp.json()`（422 时会抛 SyntaxError，把「CSRF 失败」误报成「解析异常」）。`[实测→推断]`

---

### Q5. `{"count":"N"}` 语义

**观测事实**：仓库既有实测中，对 `POST /Ariestar/sivtr/unstar` 返回 `{"count":"277"}`，随后 `POST /Ariestar/sivtr/star` 返回 `{"count":"278"}`，与页面上的星标计数变化一致。`[实测，单仓库]`

**它是「该仓库的 star 总数（stargazers_count）」，而非增量**：

- unstar 后 count 由 278 → 277，star 后 277 → 278——值随操作后的**全局总数**变化，与「+1/-1 增量」不符（增量应恒为 ±1 或省略）。`[实测]`
- 旁证：openweb 的 watch/unwatch 复用同一 `count` 字段名，但返回 `{count: "1"}`——同一个字段名在不同端点含义不同，**说明 `count` 不是统一的「操作成功」信号**。`[社区]`
- 未找到任何官方/社区文档定义该字段语义。`[未确证（语义定义）]`

**能否安全用作「操作已生效」判据**：**不建议**。理由：

1. 它是**事后快照**，不是 delta；不知道 before 值就无法判断。
2. HTTP 200 本身已经表达了「请求被接受」；`count` 只是锦上添花。
3. **并发不可靠（推断）**：因为它是**全局仓库 star 总数**，其他用户同时 star/unstar 会独立改变它 → 存在「count 不变而你的操作成功」与「count 变了但不是因为你」两种情形。**无直接实验证据，标为推断**。`[推断，未确证]`

**建议替代判据**（按优先级）：

1. `resp.ok`（200）+ 事后重新读取页面 `form[action$="/star"]` vs `/unstar` 的方向（catui-agent 推荐的 durable signal）。`[社区]`
2. 触发一次列表重绘 / 重新拉取 `GET /user/starred/{owner}/{repo}`（REST，若可用）或本地缓存整表 diff。
3. 若一定要用 count，则必须**先读 before**（可从上一次响应或页面按钮计数取），比对 **`after === before ± 1`**，把「±1 之外」视为并发污染而非失败。`[推断]`

---

### Q6. 改版风险史与降级路径设计

#### Q6-a 已知的 GitHub 前端端点改版 / 失效事件（全部有来源）

| # | 事件 | 时间 | 影响 | 来源等级 |
|---|---|---|---|---|
| 1 | CSRF 机制从 `<meta name="csrf-token">` 改为 `<meta name="fetch-nonce">` + `GitHub-Verified-Fetch: true`；旧 meta 在现代 github.com **已不存在** | 被 openweb 于 **2026-04-19** 记录为「原方案 was wrong」 | 所有按旧文档实现的自动化脚本整体失效 | `[社区，openweb PROGRESS.md]` |
| 2 | `/_graphql` 持久化查询（persisted query）**md5 哈希随 GitHub 前端版本漂移** | openweb 明言「These will drift with GitHub web releases」 | close/reopen issue 等操作会在 GitHub 发版后随机 4xx | `[社区]` |
| 3 | GitHub 开始把 **PR 页面 React 化**（先改 header），一次打断 refined-github 8 个功能 | **2026-02-05** 报出，2026-04-23 关闭（拆成 3 个新 issue） | DOM 选择器类功能成批失效；作者原话「We're likely going to have another similar issue once they publish the new PR pages in full.」 | `[社区，refined-github#8946]` |
| 4 | GitHub 向**登录用户灰度 React 版 GlobalNav 头部**，新类名带构建哈希、不稳定；脚本改写 React DOM 导致搜索框崩溃 | **2026-06-12** 报出，06-15 修复 | 用户脚本在「被灰度到的账号」上直接坏掉，未登录用户不复现 | `[社区，maboloshi/github-chinese#702]` |
| 5 | `api.github.com` **不接受 `_gh_sess` cookie 做写操作**（web UI 用的是服务端合成的短时内部 bearer token） | openweb 长期记录 | cookie_session 写法对 `api.github.com` 永远失败——这正是要用网页端点的根因之一 | `[社区]` |
| 6 | stars 列表 / 详情页 DOM 大改版（`col-12…py-4` → `tmp-py-4.color-border-muted`、`data-toggle-for` → `user-list-menu[data-repository-id]`、详情页 `#repo-stars-counter-star` → `button[data-testid="star-button"]` + `aria-label`） | 2026 年内 | 选择器全部需要重写 | `[实测（本仓库 AGENTS.md 记录）]` |

#### Q6-b 「这类端点平均多久失效一次」

**未能查证**——没有任何公开来源给出量化频率。

可给出的**定性判断**（基于上表）：近半年（2026-02 → 2026-06）内至少 **3 起互相独立的前端改版**直接打断用户脚本/扩展（#3/#4/#6），CSRF 机制本身也已变过一次（#1）。因此工程上应按「**以月为单位的失效周期**」而非「以年为单位」来设计——即**必须内置可观测的降级路径**。`[推断，基于社区事件时间线]`

#### Q6-c 降级路径设计（端点失效时如何自动回退，而不是静默失败）

设计原则：**把「端点是否还活着」变成可观测状态，而不是每次操作都赌一次。**

1. **前置能力探测（每次会话一次，不每次操作）**
   `meta[name="fetch-nonce"]` 可读？ + 目标页存在 `form[action$="/star"|"/unstar"]` 且含 `input[name="authenticity_token"]`？ + `body.logged-in`？
   任一不满足 → 直接标记 `webEndpoint.unavailable`，不发送请求。`[社区(openweb)做法]`
2. **结构化错误模型**（不要 `boolean`）：
   `ok` / `needsLogin` / `csrfRejected(422)` / `forbidden(403)` / `notFound(404)` / `rateLimited(429)` / `endpointChanged`。
   `endpointChanged` 的触发条件：**期望 JSON 却拿到 HTML**、**期望的表单/token/meta 字段消失**、或 4xx 但响应体不是已知形态。`[本项目建议]`
3. **失败即熔断**：连续 2 次 `endpointChanged` → 本次会话内不再尝试网页端点，UI 明示「GitHub 网页接口可能已变更，已回退」。
4. **三段式回退**：`网页端点 → REST(classic/OAuth PAT) → 引导用户点原生按钮 / classic PAT 深链（<https://github.com/settings/tokens/new?scopes=repo&description=GithubStarManager>）`。
5. **诊断埋点**：失败时记录 `meta[name="release"]` 的值与失败 URL、状态码、响应体前 200 字符——这是下次改版时定位「是哪个前端构建坏掉的」的唯一线索。`[社区（openweb 靠抓 HAR 重捕获哈希）]`
6. **刷新策略**：nonce 跨页会变（实测两页两值），**绝不缓存**；token per-form，**绝不跨仓库复用**。

---

### Q7. `X-GitHub-Client-Version`

**取值来源（明确）**：`<meta name="release">` 的 content。GitHub 前端自身的代码如下（社区镜像文件，内容极短，可直接核对）：

```ts
import {ssrSafeWindow} from '@github-ui/ssr-utils'
const version = ssrSafeWindow?.document?.head?.querySelector<HTMLMetaElement>('meta[name="release"]')?.content || ''
export const CLIENT_VERSION_HTTP_HEADER = 'X-GitHub-Client-Version'
export function getClientVersion() { return version }
```

来源：<https://github.com/ahfuckit/-/blob/master/client-version.ts> `[社区（GitHub 前端源码镜像）]`；仓库既有实测 `meta[release] = a25250f4aa593c4ff6c83d2557a0a6b81d14d15c` `[实测]`。

**是否必需**：**非必需**。两条独立证据：

- openweb 的 `github-web.ts` 只发 `Accept` / `X-Requested-With` / `X-Fetch-Nonce` / `GitHub-Verified-Fetch`（以及 `/_graphql` 的 `Content-Type`），**完全不发 `X-GitHub-Client-Version`**，其 5/5 写操作验证通过。`[社区代码]`
- 仓库既有实测同样未携带该头，星标/unstar 均 200 生效。`[实测]`

**不匹配会怎样**：**未能查证**。没有公开来源描述「发了不匹配的 `X-GitHub-Client-Version` 会被拒」。据该常量在 GitHub 前端的使用位置推测，它用于内部 `api.github.com` 调用的版本标识/遥测，不像是写端点的门禁。`[未确证]`

**落地建议**：**不发送**。若未来确有需要，从 `meta[name="release"]` 现读，绝不硬编码（该值随发版变化）。`[推断]`

---

### Q8. 同类用户脚本 / 扩展先例

| 实现 | 类型 | 写路径实际用什么 | 维护状态 / 风险说明 | 等级 |
|---|---|---|---|---|
| `fahamjv/github-bulk-unstar` | DevTools 粘贴脚本 | ✅ **网页端点** `fetch(form.action, {body: new FormData(form)})`，真实 per-form token，无 nonce/VF | README 明示「No token…」，700ms/1200ms 节流；**无 issue、无被拦截报告** | `[社区]` |
| `openweb-org/openweb` `github-web.ts` | AI agent 适配器 | ✅ **网页端点**，手工 FormData + nonce + `GitHub-Verified-Fetch: true` | 2026-04-19 5/5 PASS；DOC.md 明确记录「缺 nonce+VF 一律 403」「持久化哈希会 drift」「api.github.com 的 cookie 写永远失败」 | `[社区]` |
| `catui-agent` domain-skill | agent 提示文档 | ✅ **`form.submit()`** | 明确推荐并记录 React 合成点击失效、隐藏兜底按钮、`form.submit()` 绕过 submit 监听器 | `[社区（CDN 发行物）]` |
| `Fldicoahkiin/GithubStarListsPlus` | userscript + 扩展 | ❌ **不是网页端点**：bulk unstar 走 REST `DELETE https://api.github.com/user/starred/{owner}/{repo}`（`credentials: 'include'` + 可选 PAT）；网页 `form[action*='/star'|'/unstar']` 仅用于**读取星状态**（`content.js:338/361`） | 活跃维护（含 Playwright e2e）；README 说 token 可选、「only there to improve API quota」 | `[社区源码精读]` |
| `hizzyishome/AbandonOldLove` | 零后端 Web 应用 | ❌ GraphQL + **classic PAT** | README 明确：「**Fine-Grained Tokens ARE NOT SUPPORTED** … You will face a 'Resource not accessible by personal access token' error」 | `[社区]` |
| `izumi0uu/better-github-stars-manager` | Chrome MV3 扩展（~187★） | ❌ REST + **classic PAT**（`repo`+`gist`+可选 `notifications`/`read:user`） | 活跃（含 e2e、商店上架）；未见网页端点写路径 | `[社区]` |
| greasyfork 529914 / 508082「GITHUBSTAR 互赞互粉」 | userscript | ❌ 只做入口链接到第三方 `githubstar.com` 互换服务 | **反面教材**：正是 AUP 点名禁止的「rank abuse / automated starring」形态 | `[社区]` |
| greasyfork 589108「GitHub Repository Tools」/ `yoky-lumen/github-star-list-enhancer` / `leocaseiro` star-list-search | userscript | ❌ 纯只读增强（加 Stars tab、本地筛选排序） | 与写路径无关 | `[社区]` |

**结论**：公开生态里**只有 3 个来源真正走了网页写端点**（fahamjv、openweb、catui-agent），全部是**工具/适配器/文档**而非成熟 userscript；**没有任何一个公开实现附带「被 GitHub 拦截 / 收到 abuse 警告」的经验记录**。因此：

- 「这类端点被 GitHub 主动拦截」的公开案例：**未查到**。`[未确证]`
- 「网页端点写路径」在本项目之外**没有可借鉴的完整错误模型**——这正是 Verdict 定为 `Extend/custom` 的原因。

**对既有仓库文档的一处订正**：`docs/research-web-star-endpoints.md` §4 表格把 `Fldicoahkiin/GithubStarListsPlus` 记为「复用原生 `form[action*='/star'], form[action*='/unstar']`」——该描述**不适用于其写路径**。精读源码后确认：它的 batch unstar 发的是 REST DELETE 请求（`src/shared/service.js` 的 `bulkUnstar()`），网页表单只在 `src/content.js` 里被 `querySelectorAll` 用来**判断某仓库当前是否已 star**。作为「网页端点先例」引用它会误导实现。`[社区源码精读]`

---

## 三、对照表

### 表 1 · 三种写路径的工程属性（REST / 网页端点 / 引导原生按钮）

| 维度 | REST `PUT\|DELETE /user/starred/{o}/{r}` | 网页端点 `POST /{o}/{r}/{star\|unstar}` | 引导用户点原生按钮 |
|---|---|---|---|
| 解决 fine-grained PAT 写缺口 | ❌ | ✅ | ✅ |
| 需登录浏览器会话 | ❌ | ✅ 必须 | ✅（用户本就在浏览器里） |
| 需读 per-form `authenticity_token` | ❌ | ✅（或靠 `GitHub-Verified-Fetch` 兜底） | ❌ |
| 成功语义 | 204/304，明确、幂等 | 200 + `{"count":"N"}`，需二次确认 | 用户肉眼可见 |
| 失败语义 | 401/403/404/429，有文档 | **422（CSRF）/ 403（fetch 层）**，无文档、社区口径冲突 | N/A |
| 响应体 | 恒为 JSON（REST 错误也 JSON） | 成功 JSON；**失败可能是 HTML** | N/A |
| 限流可观测 | ✅ `x-ratelimit-*` / `retry-after` | ❌ 实测为 null | N/A |
| 契约稳定性 | 版本化、有废弃期 | ❌ 无契约；CSRF 机制已变一次，前端改版以月计 | ✅ 不会失效 |
| UI 耦合 | 无 | 高（表单/token/`context`/meta） | 中（需找到按钮） |
| 批量体验 | ✅ | ⚠️ 可行但需串行 + 节流 | ❌ 差 |
| 合规外观 | 低风险 | 单条低 / 批量高 | **零** |

### 表 2 · 逐问结论速查

| 问 | 一句话结论 | 等级 |
|---|---|---|
| Q1 `form.submit()` vs `fetch(FormData)` | 批量必须用 `fetch`+`FormData`；`form.submit()` 必导航、只适合单条；`FormData` 不会缺 boundary | 社区+官方(MDN) |
| Q1 `FormData` boundary | 直传 `FormData` 时浏览器自动补 boundary；手动设 `Content-Type` 才出错 | 官方 |
| Q2 登录检测 | `body.logged-in` 且 `meta[user-login].content !== ''`；只看 meta 存在性不可靠 | 社区+实测 |
| Q3 `context` | `user_stars`/`repository` 已确认，`other` 单次观测；服务端是否受影响**未确证** | 实测/社区+未确证 |
| Q4 422 vs 403 | 422 = Rails CSRF（返回 HTML）；403 = GitHub fetch 校验层；两者口径有分歧，以实测 422 为准 | 官方(Rails)+实测+社区分歧 |
| Q4 JSON 总能拿到吗 | 否。200 是 JSON，422 仍是 HTML，须先 `text()` 再解析 | 实测 |
| Q5 `count` 语义 | 仓库 star 总数（事后快照）；不适合当生效判据，并发可靠性**未确证** | 实测+推断 |
| Q6 失效频率 | 无量化数据（未确证）；半年内 ≥3 起独立前端改版 | 社区+推断 |
| Q7 `X-GitHub-Client-Version` | 值来自 `meta[release]`；**非必需**（两个实现都不发也成功）；不匹配行为未确证 | 社区+实测 |
| Q8 同类先例 | 仅 3 个真用网页写端点，且都是工具/文档；无被拦截的公开案例 | 社区+未确证 |

---

## 四、未能查证（不编造，明确列出）

1. **`context` 的服务端语义与完整取值集合**：只确认 3 个观测值（`user_stars` / `repository` / `other`），**没有任何来源说明它是否影响服务端行为**；「传错会怎样」完全未测。
2. **未登录状态下向该端点 POST 的真实状态码与响应体**：只知「表单不渲染」，未查到 302/401/404 的确切行为。
3. **仓库不存在 / 不可见时的确切状态码**（推测 404，未验证）。
4. **被限流时的确切状态码与响应体**：已知网页端点返回 `x-ratelimit-* = null`，官方只说内容创作限流「包含 web 界面动作」（80/分、500/时），但**网页端点专属阈值、是否单独计桶、触发曲线、429 还是 403 全部无公开资料**。
5. **422 与 403 的社区口径分歧的确切成因**（是否取决于是否携带 `X-Fetch-Nonce`）：本报告的归因是**推断**，无官方解释。
6. **`{"count":"N"}` 的官方定义**：无任何文档；「仓库 star 总数」是基于单仓库 278→277→278 观测的推断；**并发下是否可靠完全未确证**。
7. **`X-GitHub-Client-Version` 不匹配时的行为**（是否会被拒、是否只影响遥测）：无公开来源。
8. **这类端点「平均多久失效一次」的量化数据**：无任何公开统计；只能给半年内 ≥3 起事件的定性描述。
9. **`GitHub-Verified-Fetch: true` 为何能让伪造 `authenticity_token` 被接受**：无官方解释；仓库既有实测仅 2 次观察，**不应视为稳定承诺**。
10. **是否存在针对该端点的 abuse 自动拦截/封禁的公开案例**：**未查到**。仅有通用的「批量 star 触犯 AUP」条款与第三方互赞服务的反面案例。
11. **`form.submit()` 在 stars 页 60 个 unstar 表单场景下的实际行为**：逻辑上每次提交都会导航（页面卸载），但**未做实测**（本次调研明确禁止执行真实请求）。
12. **Greasy Fork 上是否存在以网页端点做 star/unstar 的 userscript**：多轮检索未找到；`findActionContainer`（含 `ul.pagehead-actions` 选择器）的那段代码来源未能定位到具体脚本。

---

## 五、参考来源

### 官方 / 官方上游

1. GitHub Docs — Managing your personal access tokens（fine-grained 写他人公开仓库限制原文）
   <https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens>
2. GitHub Docs — Rate limits for the REST API（内容创作限流含 web 界面；二级限流仅限 REST）
   <https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api>
3. GitHub Acceptable Use Policies §4 Spam and Inauthentic Activity（`rank abuse, such as automated starring`）
   <https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies>
4. GitHub — Disrupting the Experience of Other Users（`Starring … in large volume in a short period of time`）
   <https://github.com/github/docs/blob/main/content/site-policy/acceptable-use-policies/github-disrupting-the-experience-of-other-users.md>
5. GitHub Registered Developer Agreement §4(v)（代人 star 需显式披露）
   <https://docs.github.com/en/site-policy/github-terms/github-registered-developer-agreement>
6. github/eslint-plugin-github — `authenticity-token` 规则（**per-form CSRF token**，action+method 绑定）
   <https://github.com/github/eslint-plugin-github/blob/main/docs/rules/authenticity-token.md>
7. rails/rails — `RequestForgeryProtection`（`per_form_csrf_token` 实现）
   <https://github.com/rails/rails/blob/main/actionpack/lib/action_controller/metal/request_forgery_protection.rb>
8. **rails/rails#21948** —「CSRF protection prevents some webkit users from submitting forms」（`InvalidAuthenticityToken` → **422 Unprocessable Entity** + HTML 的一手日志）
   <https://github.com/rails/rails/issues/21948>
9. MDN — *Using FormData Objects*（**不要手动设 `Content-Type`，否则浏览器无法补 boundary**）
   <https://developer.mozilla.org/en-US/docs/Web/API/FormData/Using_FormData_Objects>
10. github/roadmap#600（NOT_PLANNED）/ #601（OPEN）
    <https://github.com/github/roadmap/issues/600> · <https://github.com/github/roadmap/issues/601>
11. GitHub Docs — REST endpoints for starring（对比 REST 语义）
    <https://docs.github.com/en/rest/activity/starring>

### 社区 / 开源实现（源码精读）

12. **fahamjv/github-bulk-unstar** — `fetch(form.action, {body: new FormData(form), credentials:'same-origin'})` + 真实 token，700ms/1200ms 节流
    <https://github.com/fahamjv/github-bulk-unstar>
13. **openweb-org/openweb** — `src/sites/github/adapters/github-web.ts`（star/unstar 适配器；含 `context: 'repository'`、nonce + VF、错误映射）
    <https://github.com/openweb-org/openweb/blob/main/src/sites/github/adapters/github-web.ts>
14. **openweb-org/openweb** — `src/sites/github/PROGRESS.md`（「csrf-token 已消失」「缺 nonce+VF 一律 403」「持久化哈希会 drift」）
    <https://github.com/openweb-org/openweb/blob/main/src/sites/github/PROGRESS.md>
15. **openweb-org/openweb** — `src/sites/github/DOC.md`（三种端点风味、`api.github.com` cookie 写永远失败、probe 表）
    <https://github.com/openweb-org/openweb/blob/main/src/sites/github/DOC.md>
16. **catui-agent domain-skill** — Repo actions (star, unstar, watch)（`form.submit()` 推荐 + React 合成点击失效 + 隐藏兜底按钮 + 登录检测）
    <https://cdn.jsdelivr.net/npm/catui-agent@1.2.20/dist/extensions/builtin/browser/agent-workspace/domain-skills/github/repo-actions.md>
17. **Fldicoahkiin/GithubStarListsPlus** — `src/shared/service.js`（`bulkUnstar()` 实为 REST DELETE）、`src/content.js`（网页表单仅用于读状态）
    <https://github.com/Fldicoahkiin/GithubStarListsPlus>
18. **hizzyishome/AbandonOldLove** — README「Fine-Grained Tokens ARE NOT SUPPORTED … Resource not accessible by personal access token」
    <https://github.com/hizzyishome/AbandonOldLove>
19. **izumi0uu/better-github-stars-manager** — MV3 扩展，classic PAT（`repo`+`gist`+…）；REST 写路径
    <https://github.com/izumi0uu/better-github-stars-manager>
20. **refined-github/refined-github#8946** —「Features broken on updated PR page」（GitHub React 化 PR 页面 header，一次打断 8 个功能，2026-02-05）
    <https://github.com/refined-github/refined-github/issues/8946>
21. **maboloshi/github-chinese#702** — React GlobalNav 灰度破坏用户脚本（新类名带构建哈希、不稳定，2026-06-12）
    <https://github.com/maboloshi/github-chinese/issues/702>
22. **ahfuckit/-** `client-version.ts` — `CLIENT_VERSION_HTTP_HEADER = 'X-GitHub-Client-Version'` ← `meta[name="release"]`
    <https://github.com/ahfuckit/-/blob/master/client-version.ts>
23. greasyfork 508082 / 529914「GITHUBSTAR 互赞互粉」（AUP 反面形态）
    <https://greasyfork.org/be/scripts/508082-githubstar-github%E4%BA%92%E8%B5%9E%E4%BA%92%E7%B2%89%E4%BA%92star-%E5%BF%AB%E9%80%9F%E7%A7%AF%E7%B4%AFstar-watch%E4%B8%8Efork-%E5%8A%A9%E5%8A%9B%E5%BC%80%E6%BA%90%E9%A1%B9%E7%9B%AE%E6%88%90%E5%8A%9F/code>
24. greasyfork 589108「GitHub Repository Tools」/ `yoky-lumen/github-star-list-enhancer`（只读增强，无写路径）
    <https://greasyfork.org/ckb/scripts/589108-github-repository-tools/code> · <https://github.com/yoky-lumen/github-star-list-enhancer>

### 实测（本仓库既有调研，2026-09-26；本报告仅引用，未重复实验）

25. `docs/research-web-star-endpoints.md` §3.5 三组对照（200/200/**422**）、§3.2（60 表单 60 唯一 token）、§3.1（`csrf-token` 已为 null）、限流头为 null、`meta[release]` 值、`{"count":"277"}` → 复原 `{"count":"278"}`。
26. 本次会话中的用户报测：repositories 页出现 `context=other`（一次观测）；`meta[name=user-login]` 为空串的情形。

### 本次未采纳（检索到但与结论无关，列出以免重复劳动）

- `KnockOutEZ/wigolo` `scripts/star-chart.mjs`（REST `/stargazers` 画图，非写端点）
- greasyfork 574245「GitHub 仓库管理」/ greasyfork 576636「GitHub to Gitingest」（REST / 无写端点）
- `cat-xierluo/legal-skills` github-star-manager（Python + PAT，REST）
- `grep.app` / GitHub Code Search（前者 HTTP 429，后者需登录，均未取到代码检索结果）
