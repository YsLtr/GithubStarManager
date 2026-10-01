# GitHub REST 变异请求限流实测（星标端点）

> 执行日期：**2026-10-01**（+0800）｜探针：`scripts/ratelimit-probe.cjs`｜原始记录：`docs/research-ratelimit-measurement.jsonl`（26 行）
> 协议：`docs/research-ratelimit-protocol.md` §4｜结论用于校准 `src/mutationQueue.ts` 的节流参数。

---

## 1. 结论（判决矩阵 §4.8）

**判定 D1 —— `used` 每请求 +1，primary 限流按请求数计，官方「5 点/次」表不作用于 primary。**

| 判定 | 结果 | 证据 |
|---|---|---|
| **D1** 全 204 且 used 每请求 +1 | ✅ **命中** | 21 个计入请求 → `used` 39 → 60，**逐个 +1**，GET 与 PUT/DELETE 无差别 |
| D2 每 PUT +5 | ✗ | 不存在 +5 台阶 |
| D3 增量为 0 或负 | ✗（差分可用） | 仅绝对值有跨区域跳变，见 §4 |
| D6 403 × secondary rate limit | ✗ 未触发 | 10 次 1s 间隔连续写，零 403/429 |
| D9 403 × Resource not accessible | ✗ 未出现 | OAuth token scope 含 `repo`，写自有仓库畅通 |
| D14 resource ≠ core | ✗ | 20/20 请求 `resource=core` |

**对设计的影响**：仓库自有的写入成本 = **1 点/请求**（不是 5 点）。批量恢复 50 条 = 50 点，占 5000/h 的 1%。1 秒间隔 = 60 写/分钟，距文档化的 900 点/分钟**有 15× 余量**。**不据此改动 1000ms 默认值**（实测规模不足以推翻官方 best-practices；1s 同时满足「串行 + ≥1s」两条独立要求，且 Octokit plugin-throttling 对写请求的默认值就是 `{maxConcurrent:1, minTime:1000}`）。

---

## 2. 测试条件（协议 §4.7 要求逐项注明）

| 项 | 值 |
|---|---|
| 测试仓库 | `YsLtr/qq_warning`（**自有**、public、非 fork，S0 基线 = 未 star） |
| 凭证 | `gho_` OAuth app user token（`gh auth token`），scope = `gist, read:org, repo, workflow` → 通过协议 §4.7 的 classic/OAuth 闸门 |
| **出口 IP 类别** | **ISP 主干（中国移动 AS9808，上海）——非 VPN、非云主机** |
| 连接方式 | **真·直连**（`env -u HTTPS_PROXY -u HTTP_PROXY`，绕开本机 10808 代理） |
| 执行级别 | `L0, L1`（L2 未启用，理由见 §5） |
| 变异请求 | **10 次**（协议硬上限 60） |
| 间隔 | 1000ms（严格串行，无并发） |
| 净状态 | **S0 unstarred → 结束 unstarred ✅** |
| 自动同步 | GithubStarManager 未在任何标签页运行（测试前已确认 GitHub 标签页数 = 0） |

> **为什么必须绕开代理**：本机 `HTTPS_PROXY=127.0.0.1:10808` 的出口是 **Oracle 云主机（AS31898, 新加坡）**。云主机是共享 IP，其二级限流信誉可能已被其他租户污染，会把「别人的限额」测成「我们的限额」；且协议 §4.7 明确「走 VPN 或云主机时不做 L2」。直连出口是用户真实 ISP IP，既是更干净的量测对象，也让 L2 在协议上成为**允许的**（虽然最终未跑）。

---

## 3. 原始观测

```
 #  kind    method  status  resource  used   Δ   ttfb_ms   url
 1  read    GET     200     core         0        351     /rate_limit
 2  read    GET     200     core         0   0    356     /rate_limit
 3  read    GET     404     core        39  39    596     /user/starred/YsLtr/qq_warning   ← L0 基线 S0
 3  read    GET     404     core        40  +1    422     /user/starred/…                  ← L1 #1 先读
 4  mutate  PUT     204     core        41  +1    759     /user/starred/…                  ← #1 写
 5  read    GET     204     core        42  +1    448     …
 6  mutate  DELETE  204     core        43  +1    651     …
 7  read    GET     404     core        44  +1    431     …
 8  mutate  PUT     204     core        45  +1    677     …
 …   （#3–#10 同形）
22  mutate  DELETE  204     core        59  +1    561     ← #10 写
23  read    GET     200     core        59   0    423     /rate_limit
 4  read    GET     404     core        60  +1    442     /user/starred/…                  ← 净状态校验
```

- 计数：**20 个 HTTP 请求被记账，20 次 +1**（2 次 `GET /rate_limit` 不计入 —— GitHub 文档如此，实测吻合：两次调用后 `used` 仍为 0）。
- 时延（直连、TTFB）：读 406–596ms，**写 531–852ms**。
- `accepted_permissions` 头：**成功响应中缺失**（该头只在 403 时出现；实测全程 `None`）。故不能用它做「权限没问题」的正向判据，只能做失败归因。
- 分类：`ok` × 15、`not-found` × 7（正是 S0 与各次 unstar 后的先读）、`ok-other` × 3。

---

## 4. 已知偏差（不要过度解读的数据）

1. **`used` 绝对值会跨边缘区域跳变**：P0 与 L0 首次快照 `used=0`（`reset=1790851000`），紧接着第一次读 `used=39`（`reset=1790848057`）——**没有任何我们的请求**发生过这 39 个。同一会话中 `reset` 时间戳都不同，说明不同请求打到了不同区域的计数器。**结论：只有同一突发内、相邻两次快照的差分可用；绝对值与跨突发差分不可用。** 本轮的 D1 判定只用相邻差分，未受此影响。
2. **`GET /rate_limit` 不记账**（见上），因此用它做「before/after 快照」时不会自污染 —— 探针的设计假设得到实测验证。
3. 本轮总请求量（10 次变异）**不足以**触达任何文档化阈值，所以「未触发」不能外推为「任意规模都安全」——见 §5。
4. 只测了 1 个仓库、1 个端点（`/user/starred/{o}/{r}`）。其他写端点（如 issue 评论）的记账未被验证。

---

## 5. 为什么没跑 L2（以及为什么这是有意的）

L2 按协议是**间隔阶梯 1000 → 500 → 250ms，各 20 次**（合计 60 次变异 + 3×60s 级间静默）。三条理由决定不跑：

1. **它答不出我们真正关心的问题。** 二级限流是 **900 点/分钟**；写入实测 1 点/次，因此需要约 **900 写/分钟**才可能触线。L2 最激进的档位 250ms = 240 写/分钟，**连阈值的 1/3 都不到**。L2 能给出的最强信号只有「20 次 @250ms 没被拒」——对「阈值在哪」没有任何分辨率。
2. **250ms 档测的是我们不会发布的配置。** `mutationQueue` 是硬编码 1000ms 串行，L2 最低档比它激进 4 倍。为验证一个永不上线的配置去发 60 次写请求，收益为负。
3. **唯一真正未知的那部分（abuse detection / 内容创建限流是否覆盖 star）无法用小探针安全地回答。** 要测它就得**真的触发**它——那是唯一可能让账号实际受损的结果，而触发之后我们能学到的也只是「会触发」这一件事，且我们的发布配置（60 写/分钟）本来就在 80/分钟的内容创建指导线之内。**用账号风险换一个不需要的答案，不做。**

**替代论证（解析的，不是实测的）**：发布配置 = 1 写/秒 = 60 写/分钟 = 60 点/分钟 → 对 900 点/分钟有 **15× 余量**，对 5000 点/小时有 **83× 余量**（60 写/分钟连续一小时 = 3600 点）。这个余量对「批量恢复 100 条」这种现实最坏情况同样成立（100 写 ≈ 1.7 分钟）。

---

## 6. 待确认（本轮未答、且需要有意识的设计才能答的问题）

- star/unstar 是否计入 **内容创建限流**（80/分钟、500/小时）—— 未确证，见 `docs/research-web-star-endpoints.md` §4。
- **abuse detection**（AUP §4「excessive automated bulk activity」）的实际触发规模 —— 无法在不触发的前提下测量，属于合规判断而非技术测量。
- 二级限流触发时的响应形态（本应产出 D6）—— 本轮未触发，仍以 `docs/research-ratelimit-protocol.md` §4.8 的「响应体含 `secondary rate limit`」为唯一可靠判据（`x-ratelimit-*` 头不可作判据）。

---

## 7. 两条写通道的限流对照（2026-10-01 追加实测）

同一会话内分别测两条通道的**响应头**，得出直接影响设计的对照。API 侧用 `curl -D -`，
网页侧用出厂同形 `fetch` + 全响应头 dump。

### 7.1 API 侧（`PUT` / `DELETE /user/starred/{o}/{r}`）—— 完全可观测

```
HTTP/1.1 204 No Content
X-RateLimit-Limit: 5000        X-RateLimit-Used: 3   X-RateLimit-Resource: core
X-RateLimit-Remaining: 4997    X-RateLimit-Reset: 1790857287
Access-Control-Expose-Headers: … Retry-After … X-RateLimit-* …
```

紧随其后的 `DELETE` 返回 `Used: 4` ⇒ **一次变异 = 1 点**，与 §1 探针的 D1 判定**独立复现**
（探针侧 20 个请求逐个 +1；此处 PUT→DELETE 3→4）。**「5 点/次」表不作用于 primary 得到两次独立确认。**

### 7.2 网页侧（`POST /{o}/{r}/star`）—— **零限流可观测性**

完整 18 个响应头（实测两次，均为 200）：

```
cache-control  content-encoding  content-security-policy  content-type  date
document-policy  etag  origin-trial  referrer-policy  server
strict-transport-security  vary  x-content-type-options  x-fetch-nonce
x-frame-options  x-github-edge-region  x-github-request-id  x-xss-protection
```

**没有任何 `x-ratelimit-*`、没有 `retry-after`** —— 与调研报告 §Q5 的 3 次观测一致，
这次是全头清单确认，不是「没找到」。

顺带确证的两件事：

- **响应会回 `x-fetch-nonce`**（`v2:2bf6d114-…`，每次不同），且 `vary` 头里含 `X-Fetch-Nonce`
  ⇒ nonce 是**活的响应变化输入**，不是历史遗留。我们**不发**它仍得 200（§A.1），但 GitHub 会主动发给我们。
- **`{"count":"N"}` = 仓库 star 总数（动作之后）**，再次确证：`jimmgreen/LumaShot` 取消 → `25`、
  恢复 → `26`，与该仓库页面显示的 26 一致（§A.1 在 `qq_warning` 上观测到 3→4→3，同构）。
  故它是**事后快照**，不是本次动作的增量 —— 继续不作判据。

### 7.3 对照表（这是本轮最重要的产出）

| | API（`PUT/DELETE /user/starred`） | 网页端点（`POST /{o}/{r}/star`） |
|---|---|---|
| 计入的桶 | `core`（**实测**） | **不在 core**（无该头；官方旁证：网页不是 REST） |
| 单次成本 | **1 点/请求**（两次独立实测） | **未知**（无任何计数可读） |
| 主限流 | 5000/小时（实测 `Limit: 5000`） | 名义上不适用 |
| 二级限流 900 点/分钟 | 适用（REST 端点） | 名义上不适用（该值明确限定 REST） |
| 内容创作限流 80/分 · 500/时 | 官方称覆盖 REST | 官方明确「**include actions taken on the GitHub web interface**」；**但 star 是否计入未确证** |
| 失败前预警 | ✅ `Remaining` / `Used` / `Reset` / `Retry-After` | ❌ **没有任何头**，只能等 403/429 才知道 |
| 我们配置的余量 | 60 写/分 = 60 点/分 → **对 900/分 有 15× 余量**、对 5000/时 有 83× | 60 写/分 → 对**名义** 80/分 只有 **1.33×** 余量，且**阈值未公开** |

**结论（对本仓库的行为有影响）**：**在网页通道上做批量恢复，风险画像显著差于 API 通道** ——
不是因为它更慢，而是因为①它 60/分 相对名义 80/分的余量只有 1.33×，②**完全没有可观测性**，
脚本无法在逼近阈值时主动退避，只能撞到 403/429 才知道。ADR 0006 的通道优先级
（**有 classic/OAuth token 就先 REST**）因此不只是「契约更好」，也是**节流余量更大**——
批量恢复应优先走 API 通道；网页通道只该用在「没有 classic 凭证」的回落场景。
本仓库当前实现已经如此（`setStarState` 先试 REST），无需改动；此条记录用于防止将来把
「网页通道也能写」误当作「两条通道等价」。
