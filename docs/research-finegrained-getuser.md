# 取证：零权限 fine-grained PAT 能否调 `GET /user` 拿到账号 id

> 结论：**能**。官方文档有明文（藏在端点页的「fine-grained access tokens」小节里），并且 2026-10-06 已真机实测。
> 本文件是 `docs/adr/0007` 第 45 行那条依据的**独立复核 + 实测补充**，也是 4.18.0「归属账号 = token 账号」
> 的地基（`src/storage/accountIdentity.ts`）。
> 用途：以后任何人质疑「细粒度 token 拿不拿得到身份」，看这一页即可，不必重新查文档。

---

## 1. 问题与为什么它重要

4.18.0 把「标签 / 备注 / 宽限期备份」的归属从页面登录者改为 **token 账号**，做法是在**保存 token 时**
调一次 `GET /user` 拿到数字 `id` 并以凭证指纹为键持久化（见 `src/storage/accountIdentity.ts` 的
`setTokenVerified` / `rememberTokenIdentity`）。

若 fine-grained PAT 拿不到身份，则这条路径对「配了 fine-grained token 的用户」不成立，就得退回
「归属 = 登录者」并接受风险 21 在这批用户身上继续存在。所以这是一个**决定性的事实问题**，不能靠印象。

---

## 2. 官方依据（原文取证）

出处：<https://docs.github.com/en/rest/users/users>

在 **`GET /user`（Get the authenticated user）** 的 fine-grained 小节下，官方原文：

> **Fine-grained access tokens for "Get the authenticated user"**
> …
> **The fine-grained token does not require any permissions.**

取证方式（可复现，不依赖浏览器渲染）：该页是 JS 渲染的，直接用 `curl` 抓原始 HTML 再剥标签定位即可。
**计数要分清两件事**（2026-10-06 复核）：原始 HTML 里该句出现 **5 次**，但其中 1 次位于页面内嵌的数据模板
（`"no_permission_sets":"…"`）里、**不属于任何端点小节**；**渲染后的正文里只有 4 次**，分属 4 个端点的小节
（`GET /user`、`GET /users/{username}`、`GET /users`、`GET /user/{account_id}`）。
属于 `GET /user` 的那一次紧跟在标题 `Fine-grained access tokens for "Get the authenticated user"` 之后：

```bash
curl -sSL https://docs.github.com/en/rest/users/users -o users-doc.html
# 剥标签后按出现顺序，看每句之前最近的端点标题 → 第 1 处 = "Get the authenticated user"
# （末 1 处落在内嵌 JSON 数据模板里，剥标签后会看到 "no_permission_sets" 之类字段名）
```

同一页 classic 侧另有明文「A token without scopes still authenticates as the token's owner」。
⇒ **两类已支持凭证（`ghp_`/`gho_` 与 `github_pat_`）都拿得到身份，不存在权限缺口。**

### 2.1 官方汇总页为什么「看起来没有它」

`endpoints-available-for-fine-grained-personal-access-tokens` 的 users 章节里**没有** `GET /user`。
解释（沿用 ADR 0007 的交叉验证，非本次新增证据）：该页只收录**需要至少一项权限**的端点，
声明「不需要权限」的端点一律不收录 ⇒ **漏列 ≠ 不可用**。以逐端点的参考页为准。

---

## 3. 真机实测（2026-10-06）

方法：在 github.com 页面控制台里对一个**零权限 fine-grained PAT** 发一次 `GET /user`（只读、单次、token 不落盘）。

结果：**HTTP 200，响应带 `id`** ⇒ 归属解析对 fine-grained 凭证可用。

复测方式（本仓库自带探针，默认 dry-run 不发请求）：

```bash
node scripts/token-identity-probe.cjs --token-file ~/.pat        # 只打印计划
node scripts/token-identity-probe.cjs --token-file ~/.pat --run  # 真的发一次 GET /user
```

探针会打印 HTTP 状态、`id`/`login` 是否存在、以及 `x-ratelimit-remaining` / `-limit`（供确认额度成本）。
**它绝不打印 token 本身。**

---

## 4. 额度与降级

- 额度：`GET /user` 在 primary 限流下按**请求数**计 1；4.18.0 起它只在**保存 token 时**调用一次，
  之后归属解析走指纹缓存（同步查表）⇒ 稳态零请求。
- 降级：身份查询失败（网络 / 5xx / 429）时不阻断 —— `setTokenVerified` 仍保存 token、身份留空，
  归属回退登录者并记录一条 console 警告；401（失效）则走既有失效上报链且不保存。
  这条降级路径保留的意义不是「怕细粒度不可用」（已证可用），而是**怕临时故障变成「token 没存上」**。

---

## 5. 一条方法学记录（避免下次改错文档）

4.18.0 的方案评审期间，联网复核（researcher 子代理）曾报「**未能复现** ADR 0007 的那句官方原文」，
并据此在方案里写下「修正 ADR 0007:45 的依据表述」。后续用**原始 HTML 剥标签定位**复核，证明
**该引文确实存在**（§2），子代理的判断是**抓取失败**（该页 JS 渲染 + 小节折叠，readable 抽取漏掉了该段）。

> 教训：文档类事实的"查不到"必须再换一种取数方式确认（原始 HTML / 另一种提取器）才能当作"不存在"；
> 否则会以「纠错」之名把一条**正确**的依据改坏。因此 ADR 0007 **第 45 行那条依据未做任何修改**
（该 ADR 本轮只改了一处：局限 2 补「4.18.0 字段已加」的注记）。
