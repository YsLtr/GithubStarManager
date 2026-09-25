# 只支持 classic token

脚本的写路径（卡片星按钮、恢复）**只按 classic PAT 设计**：fine-grained PAT 在任何配置下都无法对「不属于本人、也不属于本人所属组织」的公开仓库执行加星/取消星（实测 `403 Resource not accessible by personal access token`），GitHub App token 更彻底——官方 OpenAPI 对该端点标 `enabledForGitHubApps: false`。快速创建入口因此预填 **classic PAT** 深链。检测到 `github_pat_` 前缀时**不拒绝**（读路径 `GET /user/starred` 不受 Additional permissions 限制，仍可同步），但必须在保存与写失败两处**明确提示其缺陷**。

## 依据

- 官方原文：*"Only personal access tokens (classic) have write access for public repositories that are not owned by you or an organization that you are not a member of."*（<https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens>）
- 同页 fine-grained 限制清单首条：*"contribute to public repos where the user is not a member"*；*"Tokens always include **read-only** access to all public repositories"*。
- 该限制**只针对 fine-grained**：其所在列表标题为 *"some features currently will only work with personal access tokens (classic)"*，对照组仅 fine-grained；2025-03 GA changelog 亦将其列为 fine-grained PATs 的 feature gap。
- 官方 roadmap [github/roadmap#600](https://github.com/github/roadmap/issues/600) 已于 2025-12-22 以 `not_planned` 关闭；[#601](https://github.com/github/roadmap/issues/601) 仍 OPEN。
- GitHub App token 不可用：官方 OpenAPI `enabledForGitHubApps: false`（<https://github.com/github/rest-api-description>），社区症状为 `Resource not accessible by integration`。
- 同构案例：[Stack Overflow #76333420](https://stackoverflow.com/questions/76333420/)（fine-grained + `addStar` 公开仓库 → 同一错误串）；公开来源中**不存在** fine-grained PAT 写他人公开仓库的成功样本。

## OAuth app user token（`gho_`）

官方凭证类型表定义 OAuth app access token 为 Long-lived / Manual / User account，且 *"An OAuth access token is limited via **scopes**"*——与 classic PAT 同属 scope 体系，故 `repo` / `public_repo` 即可写他人公开仓库（实测：`gh` CLI 的 token 带 `repo`，可成功取消他人公开仓库的 star）。它的能力来自 **scope**，不是 `gho_` 前缀本身。

## Considered Options

- **在脚本内实现 OAuth Device Flow（自建 OAuth App）**：经调研否决。两个 device flow 端点与 github.com 同源（实测 `type: "basic"`，无需 `GM_xmlhttpRequest`；官方明确不支持 OPTIONS preflight，故跨源反而不可用），但代价明确：① 需维护一个 OAuth App；② 新注册 App **默认 8 小时 access token + refresh token**（2026-08-14 changelog *"Short-lived tokens are enabled by default for all new applications."*），脚本需实现完整 refresh 生命周期；③ **50 次提交/小时按 client_id 全局共享**——分发型脚本的所有用户同一配额，第 51 人直接失败；④ GitHub 不支持 `verification_uri_complete`，用户仍须手输 8 位码，交互不优于现有预填深链；⑤ Acceptable Use §3 对「暗示与 GitHub 有关联」的冒充风险。收益（省去手动建 PAT）不足以抵偿以上成本。
- **内嵌复用 GitHub CLI 的公开 `client_id`**：否决。Registered Developer Agreement §4(iv)(v) 禁止「登录页暗示与 GitHub 有关联」及「未明确披露而代用户执行 **starring repositories** 等操作」（举例即 starring）；技术上还会共享该 client_id 的 token 桶（10 tokens/user/app/scope），挤掉用户自己的 `gh` token，并可能被随时停用。
- **改用 GitHub App user token（`ghu_`）**：否决。端点 `enabledForGitHubApps: false`，且受 installation 范围约束，覆盖不了任意公开仓库。

## 后果

- 403 `Resource not accessible by personal access token` 的提示**不得**再让用户「检查 Starring 权限」——那会把人引向无解的方向；应说明 fine-grained PAT 的先天缺陷并引导 classic PAT（`public_repo` 覆盖公开仓库、`repo` 另覆盖私有仓库）。
- 401 仍是 token 失效，与 403 分派不同文案（官方：invalid credentials 返回 401）。
- 预填深链的 scope 取 `repo`：`public_repo` 只覆盖公开仓库，会让私有仓库的 star 不出现在 `GET /user/starred` 里，被整表 diff 误判为外部取关（D3 已知局限）。`repo` 消除该误判，代价是权限更大——这是刻意选择，文案需说明。
- 用户以 fine-grained PAT 配置时，读路径（同步）正常，仅写路径受限；脚本在 `github_pat_` 前缀被检测到时说明这一能力差异。