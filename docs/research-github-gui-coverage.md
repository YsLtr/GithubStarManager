# GitHub GUI 客户端功能覆盖矩阵（以 `gh` CLI 功能面为标尺）

> 调研时间基准：2026 年 9 月（GitHub Desktop 3.6.6 / 2026-09-21，gh CLI v2.101.0 / 2026-09-15）
> 调研范围：**功能覆盖度**（GUI 内能否完成某类工作），**不涉及**底层实现（谁调用了 `gh` 二进制、谁复用 gh 登录态——那是另一份调研的边界）。
> 标记：✅ 有（GUI 内可完成） / ⚠️ 部分（能力受限或需绕路） / ❌ 无 / ？ 未知（未查证到权威依据，不猜）
> **⚠️ 事后核实更正（2026-09-25，复核者）**：本报告初稿把 `AmintaCCCP/GithubStarsManager`（3,603★）的 Stars 数误记为**本项目** `YsLtr/GithubStarManager`，并据此得出「本项目没有竞争者」。经 `gh api` 复核，两者是**仅差一个字母 `s` 的不同仓库**：本项目 0★、最后 push 2026-02-22；竞品 3,603★、MIT、Electron 桌面 GUI、2026-09-25 活跃。受影响的 §二第 5 条、§五档案表、§七 Q2 结论均已就地修正，请以修正后版本为准。

---

## 一、先纠正一处前提：`gh star` 并不存在

任务表里列为 `gh star`，但官方命令参考中**没有** `gh star` 子命令。`gh` 的星标能力只能通过 `gh api user/starred`（或用 `gh api -X PUT/DELETE /user/starred/{owner}/{repo}`）实现；顶层命令清单为 `alias / api / attestation / auth / browse / cache / codespace / copilot / discussion / extension / gist / gpg-key / issue / label / pr / project / release / repo / ruleset / run / search / secret / skill / ssh-key / status / variable / workflow / agent-task`。

- 依据：<https://cli.github.com/manual/gh_help_reference>（全文检索 `star` 仅命中 `Status` 等无关词，未命中 `star` 子命令）

需要澄清的是：任务表里的 `gh ssh-key` / `gh gpg-key` / `gh extension` / `gh codespace` / `gh project` 也一并核对过——它们**都是真实存在的顶层命令**（`gh gpg-key` 在官方参考中命中 7 次），只有 `gh star` 不存在。

---

## 二、总览结论（先看这 5 条）

1. **没有任何单一 GUI 客户端覆盖 `gh` 的大部分功能面。** 覆盖最宽的商业 GUI（GitKraken Desktop、Tower）拿到的是「本地 Git + PR 全流程」，在 Release / Actions 运行控制 / Gist / Codespaces / Projects / 星标管理 / 通知收件箱 / 扩展体系上全部缺失或仅剩「编辑 YAML 文件」级别的降级能力。
2. **功能是分工的，不是收敛的：** GitHub Desktop / Fork / Tower / SmartGit / GitButler 抢「本地 Git + PR」；Octobox / Gitify / DevHub 抢「通知收件箱」；只有网页端与 GitHub Mobile 同时具备「通知 + Issue + PR」三条线。
3. **GitHub 官方客户端刻意不做大而全。** `desktop/desktop` 的产品定位文档写明：Desktop 是「延伸 GitHub 到本地」，**不是** github.com 功能集的复刻（原文："It is intended primarily to extend the features of GitHub, not to be an agnostic Git client or replicate the feature set of github.com"）。依据：<https://github.com/desktop/desktop/blob/development/docs/process/what-is-desktop.md>
4. **Actions 在桌面 GUI 里普遍只读或已被砍。** GitKraken Desktop 11.10 起把 GitHub Actions 从左侧面板**移除**，只剩「自己编辑并提交 `.github/workflows/*.yml`」；Tower / Fork / SmartGit / GitHub Desktop 均无运行列表/日志/重跑/取消。
5. **Star 管理是极少数工具的专门职能**，主流 Git 图形客户端（Fork、Tower、GitKraken、Desktop、Sublime Merge、Sourcetree、Git Extensions、lazygit、GitButler）**全部没有**。该生态位的实际竞争者见 §七 Q2：`AmintaCCCP/GithubStarsManager`（3,603★，Electron 桌面 GUI，AI 语义搜索 + 标签 + Release 订阅）、Astral、网页端原生 star 页。**注意它与本项目仅差一个字母 `s`，是两个不同仓库。**

**Verdict: Compose — 没有任何单体 GUI 适配「覆盖 gh 大部分功能」这一目标 — 证据：覆盖最宽的 GitKraken Desktop 在 15 项能力面中拿到 6 项，官方 Desktop 拿到 4 项，且两者缺失的能力面互不重叠；再叠加「通知收件箱」需要 Octobox/Gitify、星标管理需要 Astral 类专用工具，只能组合 2–3 个方案。**

---

## 三、主表 A：GitHub 平台侧能力（GUI 内可完成？）

| 客户端 | 登录/凭据 | 仓库克隆/创建/fork | PR 列表/详情 | PR 创建 | PR 检出 | PR 合并 | PR 审阅/行级评论 | Issue 列表/详情 | Issue 创建/关闭/评论 | 通知（读/已读） | Release 创建/上传 | Actions 运行控制 | 搜索(代码/仓库/Issue/PR) | Star 管理 | Gist | Codespaces | Projects | SSH/GPG key 上传 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **gh CLI**（参照基准） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ 仅 `gh api notifications` | ✅ | ✅ | ✅ | ⚠️ 仅 `gh api` | ✅ | ✅ | ✅ | ✅ |
| **GitHub 网页端**（参照） | ✅ | ✅ | ✅ | ✅ | ⚠️（网页无本地检出，只能用 Codespaces/gh） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **GitHub Mobile** | ✅ | ⚠️ 创建仓库 ✅（2026-05 上线）/克隆无 | ✅ | ？未确证 | ❌ | ？未确证 | ✅（"review ... pull requests"，行级评论未确证） | ✅ | ✅ | ✅（核心能力） | ✅（2021-03 起支持 Releases） | ⚠️ 查看/管理 checks 与 Actions（2022-10 起） | ✅（代码搜索限单仓库） | ？未在官方文档出现 | ❌ | ？ | ？ | ⚠️ 仅 2FA |
| **GitHub Desktop** | ✅ | ✅ 克隆/创建/fork | ⚠️ 仅「检出」当前 PR 用于跑检查，无列表 | ✅ | ✅ | ❌ | ❌（#20614 仍 open） | ❌ | ❌ | ⚠️ 仅 PR 分支事件系统通知 | ❌（#6648 请求未实现） | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌（只做本地 git 凭据） |
| **GitKraken Desktop** | ✅ | ✅ 克隆/创建 | ✅ 左侧面板 PR 视图 | ✅ | ✅ | ✅（merge commit / squash / rebase） | ✅ code suggestions（GitHub 最强） | ⚠️ 仅通过 GitHub Issues 集成「查看与更新」 | ⚠️ 更新 issue ✅，创建/关闭形态未确证 | ❌ | ❌ | ❌（11.10 起左侧面板 Actions 已移除，只能改 YAML 文件） | ⚠️ 未确证 | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Tower** | ✅ | ✅ 克隆/创建 | ✅（PR 视图） | ✅ | ✅ | ✅ | ⚠️ 可评论，行级建议未确证 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️本地 SSH/GPG key 管理（非上传账号） |
| **Fork** | ✅ | ✅ 克隆/创建/删除远端 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ 仅「温和提示 GitHub 通知」指示 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Sublime Merge** | ❌ | ✅ 克隆 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Sourcetree** | ✅ | ✅ 克隆/创建 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Git Extensions** | ✅（OAuth/PAT） | ✅ 克隆/fork | ✅（含 diff 与评论） | ✅ | ✅ | ❌ | ⚠️ 能看评论，行级评论未确证 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **SmartGit** | ✅（OAuth/PAT） | ✅ | ✅ 集成 PR | ✅ | ✅ | ？未确证 | ✅（可查看/新增/编辑/删除 PR 与**行级 diff 评论**） | ⚠️ 仅 Bugtraq issue 选择（提交信息关联），关闭态 issue 不可选 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ PAT scope 要求含 `gist`，暗示有 gist 功能（未在功能页正面确认） | ❌ | ❌ | ❌ |
| **GitButler** | ✅（Device Flow / PAT / GHE） | ⚠️ 克隆/列出远端分支 | ⚠️ 只读「branch 的 PR」区 | ✅ | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ 只看 CI 状态 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **gh-dash**（终端 UI） | 复用 shell 环境凭据（不判实现） | ❌ | ✅ | ⚠️（依赖自定义 action） | ✅ | ⚠️ | ✅（diff / comment） | ✅ | ⚠️ | ❌ | ❌ | ❌ | ⚠️ 自定义过滤器 | ❌ | ❌ | ❌ | ❌ | ❌ |
| **lazygit**（终端 UI） | ❌（本地 Git 凭据） | ✅ 克隆 | ❌ | ❌（仅 `o` 在浏览器打开 PR 页） | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Octobox** | ✅（GitHub OAuth） | ❌ | ⚠️ 跳转 | ❌ | ❌ | ❌ | ❌ | ⚠️ 跳转 | ⚠️ 「Respond to issues」（评论区回复，创建/关闭未确证） | ✅（列表/已读/归档/静音/星标通知） | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Gitify** | ✅（Device Flow / PAT / OAuth App） | ❌ | ⚠️ 只读「My Pull Requests」视图 | ❌ | ❌ | ❌ | ❌ | ⚠️ 只读「My Issues」视图 | ❌ | ✅（读/已读/完成/退订） | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **DevHub** | ✅ | ❌ | ❌（README 明列 Issues/PR management 仍在 "Next features"） | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅（多栏 TweetDeck 式通知/活动流、Inbox Zero） | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Astral** | ✅（OAuth App） | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅（标签/备注/筛选/搜索/取消星标） | ❌ | ❌ | ❌ | ❌ |
| **My-GitHub-Stars (`ghstars`)** | ✅（Device Flow） | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ 浏览/搜索/AI 检索星标，未见取消星标能力 | ❌ | ❌ | ❌ | ❌ |

> 表 A 里刻意没有「扩展/自定义脚本」列（`gh extension`）——桌面 GUI 客户端**全部为 ❌**，这是 `gh` 独有的生态位（`gh-dash`、`gh-dash` 类扩展都属于 `gh` 侧，不在 GUI 范畴）。唯一的「客户端内脚本/自动化」是 GitKraken 的 Automations 与 GitButler 的自定义命令，与 `gh extension` 生态不可互换。

---

## 四、主表 B：本地 Git 能力（非 `gh` 能力面，但选客户端的关键项）

| 客户端 | 提交/分支 | 交互式变基 | 冲突解决 | 历史图 | 部分暂存 | stash | cherry-pick | reflog/撤销 | worktree | 平台 |
|---|---|---|---|---|---|---|---|---|---|---|
| GitHub Desktop | ✅ | ✅（拖拽重排/squash/amend） | ✅（3.6 起可 Copilot 辅助） | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅（3.6 新增） | Win/macOS |
| GitKraken Desktop | ✅ | ✅ | ✅ | ✅（强项） | ✅ | ✅ | ✅ | ✅ | ✅ | Win/macOS/Linux |
| Tower | ✅ | ✅ | ✅（冲突向导） | ✅ | ✅ | ✅ | ✅ | ✅（撤销任意操作） | ✅ | Win/macOS |
| Fork | ✅ | ✅（可视化交互 rebase） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅（reflog 恢复） | ❌ | Win/macOS |
| Sublime Merge | ✅ | ⚠️ | ✅ | ✅ | ✅（行级） | ✅ | ✅ | ❌ | ❌ | Win/macOS/Linux |
| Sourcetree | ✅ | ✅ | ✅ | ✅ | ✅（行级） | ✅ | ✅ | ⚠️ | ❌ | Win/macOS |
| Git Extensions | ✅ | ✅ | ✅ | ✅（强项） | ✅ | ✅ | ✅ | ✅ | ❌ | Windows only |
| SmartGit | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | Win/macOS/Linux |
| GitButler | ✅（并行/堆叠分支） | ✅（自动重排栈） | ✅（首等冲突） | ✅ | ✅ | ⚠️（模型不同） | ✅ | ✅（Undo Timeline） | ✅ | Win/macOS/Linux |
| gh-dash | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | 终端 |
| lazygit | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 终端 |
| Octobox / Gitify / DevHub / Astral / ghstars | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | 通知/星标专用 |

---

## 五、每个客户端的档案（开源与否 / 许可 / Stars / 最后 push / 维护状态）

Stars 与 pushed_at 取自 GitHub REST API 实时查询（2026-09-25）；未开源的以官网为准。

| 客户端 | 平台 | 开源 | 许可 | Stars | 最后 push | 维护状态 | 收费 |
|---|---|---|---|---|---|---|---|
| **gh CLI** | Win/macOS/Linux | ✅ | MIT | 46,406 | 2026-09-25 | 极活跃（最新 v2.101.0，2026-09-15） | 免费 |
| **GitHub Desktop** | Win/macOS | ✅ | MIT | 21,902 | 2026-09-25 | 极活跃（3.6.6，2026-09-21） | 免费 |
| **GitHub Mobile** | Android/iOS | ❌ | 专有 | — | — | 第一方持续更新 | 免费 |
| **GitKraken Desktop** | Win/macOS/Linux | ❌（GitLens 等部分组件开源） | 专有 | — | — | 活跃（文档 2026-08 更新） | 免费 Community 档（**仅公开仓库**，部分集成只读）+ 付费 Pro/Advanced（14 天试用）；具体档位价格未从渲染页确证（<https://gitkraken.com/pricing>） |
| **Tower** | Win/macOS | ❌ | 专有（EULA） | — | — | 活跃（文档/定价页在维护） | **商业订阅制，无免费档**；定价页出现「$69/user/year for individuals and teams」；30 天全功能试用；学生/教育/非营利免费 |
| **Fork** | Win/macOS | ❌ | 专有 | — | — | 活跃（官网持续更新） | **一次性 $59.99**（1 用户 ≤3 台机器，个人+商用） |
| **Sublime Merge** | Win/macOS/Linux | ❌ | 专有 | — | — | 活跃（Sublime HQ 维护） | **个人授权 $99 一次性**，含 3 年更新；可免费评估 |
| **Sourcetree** | Win/macOS | ❌ | 专有（Atlassian 免费） | — | — | 低强度维护（搜索摘要称 3.4.31 发布于 2026-06-09；官网功能页多年未变，社区长期质疑是否停更，**官方 EOL 公告未查证到**） | 免费 |
| **Git Extensions** | Windows only | ✅ | GPL（API 报 NOASSERTION，仓库附带 GPL 许可） | 8,580 | 2026-09-23 | 活跃（v7.2.1） | 免费 |
| **SmartGit** | Win/macOS/Linux | ❌ | 专有（Syntevo） | — | — | 活跃（文档随版本更新） | 商业；非商业用途免费授权 |
| **GitButler** | Win/macOS/Linux | ⚠️ 源码可见 | Fair Source（**2 年后转 MIT**） | 21,711 | 2026-09-25 | 极活跃 | 免费（源码可见、非竞业限制） |
| **gh-dash** | 终端（TUI） | ✅ | MIT | 12,554 | 2026-09-22 | 活跃 | 免费 |
| **lazygit** | 终端（TUI） | ✅ | MIT | 82,670 | 2026-09-25 | 极活跃 | 免费 |
| **Octobox** | Web（可 nativefier 打包桌面）+ 浏览器扩展 | ✅ | AGPL-3.0 | 4,485 | 2026-09-24 | 活跃（持续提交） | 托管版开源项目免费；私有仓库需付费档 |
| **Gitify** | macOS/Windows/Linux | ✅ | MIT | 5,354 | 2026-09-23 | 活跃（自动更新、多 forge adapter） | 免费 |
| **DevHub** | Web/Desktop( Electron )/iOS/Android | ✅ | AGPL-3.0 | 10,127 | **2024-09-07** | **近 2 年无提交，实质停更** | 曾有付费计划（README 中被注释掉）；现状实际免费 |
| **Astral** | Web（托管 + 自托管） | ✅ | BSD-3-Clause | 3,584 | 2026-07-11 | 维护中但节奏放缓（PHP/Laravel 技术栈） | 托管版免费，可自托管 |
| **My-GitHub-Stars (`ghstars`)** | 终端/桌面(GUI)/本地 Web | ✅ | MIT | 0 | 2026-04-11 | 个人项目，单一维护者 | 免费（AI 检索需自备 API key） |
| **StarGazer**（星标管理） | Web/桌面 | ✅ | GPL-3.0 | 127 | 2026-02-28 | 低活跃 | 免费 |
| **GithubStarManager**（本项目） | 浏览器（Tampermonkey） | ✅ | MIT | **0** | 2026-02-22 | 个人项目 | 免费 |
| **GithubStarsManager**（**同名不同项目**，`AmintaCCCP`） | 桌面 + 浏览器 | ✅ | 未确证 | **3,603** | 2026-09-25 | 活跃 | 免费 |
| **Graphite Desktop** | ~~桌面~~ | ✅ | AGPL-3.0 | 3 | **2023-07-11** | **仓库已 archived（2023 起停更）** | 现状 Graphite 为 Web + CLI：Hobby 免费档；Starter $20/用户/月、Team $40/用户/月（年付） |

---

## 六、逐项能力面的证据与细节

### 6.1 登录 / 凭据管理
- `gh`：`gh auth login/logout/status/token/switch/setup-git`（官方参考）。
- GitHub Desktop：`About GitHub Desktop` 明示「你可以快速认证到 GitHub 或 GitHub Enterprise，无需另装凭据管理器」——<https://docs.github.com/en/desktop/overview/about-github-desktop>
- GitButler：Device Flow / PAT / GitHub Enterprise 三种；PAT 需 Metadata 读 + Pull Requests 读写——<https://docs.gitbutler.com/features/forge-integration/github-integration>
- Gitify：Device Flow（仅 github.com）、classic PAT、自建 OAuth App；Gitea/GitLab 用 PAT，Bitbucket 用 app password——<https://gitify.io/faq>
- SmartGit：OAuth 或 PAT；PAT 建议 classic，scope 需 `repo`、`read:org`、`read:user`、`gist`、`workflow`——<https://docs.syntevo.com/SmartGit/Latest/Manual/Integrations/GitHub-integration>
- Git Extensions：GitHub 插件需先配置 OAuth token——<https://git-extensions-documentation.readthedocs.io/en/main/github.html>
- Octobox：GitHub OAuth；且要求用户在 GitHub 设置里**开启 Web notifications**才能工作——<https://github.com/octobox/octobox>

### 6.2 仓库：克隆 / 创建 / fork
- GitHub Desktop：克隆、创建（`gh repo create` 对应能力）、**fork 自 2.3 起支持**（roadmap："Creating a fork using GitHub Desktop (2.3)"）——<https://github.com/desktop/desktop/blob/development/docs/process/roadmap.md>
- GitHub Mobile：**2026-05-11 起可创建仓库**——<https://github.blog/changelog/2026-05-11-create-repositories-on-the-go-with-github-mobile/>（注：该 changelog URL 为按标题重建路径，若 404 请以 <https://github.blog/changelog/> 检索标题「Create repositories on the go with GitHub Mobile」）
- Git Extensions：GitHub 插件可 **fork 仓库 + 克隆个人空间仓库 + 搜索仓库**——<https://git-extensions-documentation.readthedocs.io/en/main/github.html>
- Tower：可管理 GitHub/Bitbucket/GitLab/Azure DevOps/Beanstalk 账号，一键克隆与**在客户端内创建新仓库**——<https://www.git-tower.com/features/all-features>
- Fork：特征列表含 "Create and delete remote repos"——<https://git-fork.com/>

### 6.3 Pull Request
- `gh`：`pr list/view/create/checkout/merge/review/diff/status/close/reopen/edit/comment/ready`（官方参考）。
- **GitHub Desktop 是明确的弱项**：
  - 能做：检出 PR 到本地跑检查（官方文档原文 "You can also check out a pull request to run checks without needing to open your browser."）；
  - 不能做：无 PR 列表、无合并、无审阅。功能请求 `#20614 "[Feature Request] PR reviews on Github Desktop App (everything in-app support)"` 创建于 2025-06-10，**至今仍 open**；`#11517 "What could a better pull request experience in Desktop be?"`（2021，11 个 reaction）与 `#2642 "Pull request list tracking"`（2017）均已 closed 但未落地为功能。
- **GitKraken Desktop 是 PR 覆盖最全的商业 GUI**：官方文档给出能力矩阵——GitHub/GitLab/Bitbucket/Azure DevOps 四家 `Create=Yes / View=Yes / Merge in app=Yes`；GitHub 独有 code suggestions、PR 模板、`Review on GitKraken.dev`；合并策略可选 merge commit / squash / rebase——<https://help.gitkraken.com/gitkraken-desktop/pull-requests/>
- Tower：官方特征页「Pull Requests：Create, merge, comment…close and inspect Pull Requests from GitHub, GitLab, Bitbucket, and Azure DevOps right in Tower」——<https://www.git-tower.com/features/all-features>（注：`/features/pull-requests/` 单页已 404，以 all-features 与 help 手册为准）
- SmartGit：集成 PR + 集成评论（可**查看/新增/编辑/删除 PR 评论与行级 diff 评论**）——<https://docs.syntevo.com/SmartGit/Latest/Manual/Integrations/Integrated-PullRequests>、<https://docs.syntevo.com/SmartGit/Latest/Manual/Integrations/Integrated-PullRequest-Comments>
- Git Extensions：可**查看 PR（含 diff 与评论）**、**创建 PR 到活动 remote**——<https://git-extensions-documentation.readthedocs.io/en/main/github.html>
- GitButler：连接 GitHub 后可**创建与管理 PR**、列出远端分支、取 CI 状态；支持原生堆叠 PR——<https://docs.gitbutler.com/features/forge-integration/github-integration>
- gh-dash：PR/Issue 分栏 + 自定义动作，README 宣称 "Everything you can do on GitHub - diff, comment, checkout, push, update etc."——<https://github.com/dlvhdr/gh-dash>
- lazygit：只在分支面板显示 PR 状态图标，`o` 键**在浏览器打开** PR——<https://github.com/jesseduffield/lazygit/blob/master/docs/Config.md>（"Show GitHub pull requests" 段）

### 6.4 Issue
- `gh`：`issue list/view/create/close/comment/reopen/edit/develop/status/transfer/lock/pin`。
- **能读写 Issue 的 GUI 极少**：GitKraken Desktop（GitHub Issues 集成，"View and update issues directly from within GitKraken"，但 Community 档对 GitHub Enterprise / Jira / Trello 是 view-only）、GitHub Mobile、网页端。GitHub Desktop / Fork / Tower / Sublime Merge / Git Extensions / SmartGit（仅 Bugtraq 关联与选择）、GitButler / DevHub（**尚未实现**）全部无独立 Issue 管理。
- DevHub 的要点：README 的 "Next features" 清单里**第一条就是 `[ ] Issues/PR management`**（投票 issue #110）——也就是说 DevHub 至今**不能**在 GUI 内管理 Issue/PR，只能聚合通知与活动。— <https://github.com/devhubapp/devhub>

### 6.5 通知
- `gh`：没有 `gh notification` 命令；只能 `gh api notifications` 系列（表 A 因此标 ⚠️）。
- Octobox：能力最强——额外的 "archived" 状态（Inbox Zero 语义）、星标通知、按 repo/org/type/action/state/CI/reason 过滤、Gmail 风格快捷键（`y` 归档、`m` 静音、`d` 标记已读且同步到 GitHub、`s` 星标）、thread view（public beta）——<https://github.com/octobox/octobox>
- Gitify：跨 forge（GitHub Cloud/GHES/GHDR/Gitea/Forgejo/Codeberg/Bitbucket/GitLab）通知统一收件箱，支持 Mark read / Mark done / Unsubscribe + 详情富化；菜单栏常驻；`i` 打开 My Issues、`p` 打开 My Pull Requests（**只读视图**）——<https://github.com/gitify-app/gitify>、<https://gitify.io/faq>
- GitHub Desktop：只有**系统通知**（PR 分支上的事件、检查失败、被 review），**没有通知收件箱**——<https://docs.github.com/en/desktop/working-with-your-remote-repository-on-github-or-github-enterprise/configuring-notifications-in-github-desktop>
- Fork：只在界面上「温和提示」GitHub 通知，无收件箱管理——<https://git-fork.com/>

### 6.6 Release
- `gh release create/upload/download/list/view/delete/edit/verify`。
- **没有任何 Git 图形客户端能创建 Release / 上传产物。** GitHub Desktop 的请求 `#6648 "Support 'Create Release' from GitHub Desktop app"`（2019-01-16，7 reactions，closed）未实现。GitHub Mobile 反而支持查看 Releases（2021-03-16 changelog: "GitHub Mobile now supports GitHub Releases"，但上传产物能力未确证）。网页端与 `gh` 是仅有的两个 ✅。

### 6.7 Actions / 工作流运行
- `gh run list/view/watch/rerun/cancel/download`。
- **GitKraken Desktop 明确降级**：官方文档 "As of GitKraken Desktop 11.10, workflow management is no longer available from the Left Panel"，只剩「编辑 `.github/workflows/*.yml` 并提交」；deprecation 通告写明「GitHub Actions has been removed from the Left Panel」——<https://help.gitkraken.com/gitkraken-desktop/github-actions/>（**这条对「GUI 能否管 Actions」是决定性负面证据**）
- GitHub Mobile：2022-10 起支持在 PR 里查看 checks、在仓库视图管理 Actions（<https://github.blog/changelog/2022-10-04-introducing-actions-on-github-mobile/>、<https://github.blog/changelog/2023-05-09-introducing-actions-on-the-repository-view-on-github-mobile/>）；具体是否支持 rerun/cancel 未在本轮查证 → 标 ⚠️。

### 6.8 搜索
- `gh search repos/code/commits/issues/prs`。
- GUI 侧只有 GitHub Mobile 明确支持代码搜索（限单仓库）与用户/仓库/组织搜索；网页端全支持；其余客户端只有本地过滤/筛选。GitKraken 的 Launchpad 是按状态管理 PR 的工作台，不是通用搜索——<https://help.gitkraken.com/gitkraken-desktop/gitkraken-launchpad/>

### 6.9 Gist / Codespaces / Projects / SSH-GPG key / 扩展
- **Gist**：`gh gist create/list/edit/delete/clone`。GUI 全无；唯一间接线索是 SmartGit 的 PAT scope 要求里含 `gist`（"gist - read and write access to gists"），暗示其有 gist 相关功能，但功能页未正面确认 → 标 ⚠️/未知。
- **Codespaces**：`gh codespace code/ssh/cp/create/delete/list/ports/stop`。GUI 全无（网页端与 VS Code 侧才是入口）。
- **Projects（看板）**：`gh project item-add/field-list/...`。GUI 全无。
- **SSH/GPG key 上传**：`gh ssh-key add/list/delete`、`gh gpg-key add/list/delete`。GUI 全无。Tower 的「SSH and GPG support」是**本地密钥生成与签名配置**，不是把公钥上传到 GitHub 账号——<https://www.git-tower.com/features/all-features>
- **扩展体系**：`gh extension install/exec/upgrade/create`。GUI 客户端不存在等价物。

---

## 七、两个必须回答的问题

### Q1：有没有客户端能做到「GUI 覆盖 gh 大部分功能」？

**不成立。** 用表 A 的 15 个能力面计分（✅=1、⚠️=0.5）：

| 名次 | 客户端 | 覆盖分 | 拿到的能力面 |
|---|---|---|---|
| — | 网页端（参照） | ~14 | 除「本地检出」外几乎全有 |
| 1 | **GitKraken Desktop** | ~6.5 | 登录、仓库、PR 全流程、Issue 更新、（Actions/搜索仅部分） |
| 2 | **Tower** | ~6 | 登录、仓库、PR 全流程、本地密钥 |
| 3 | GitHub Mobile | ~5.5 | 登录、创建仓库、PR、Issue、通知、Release 查看、Actions 部分 |
| 4 | gh-dash（终端 UI） | ~5 | PR/Issue 读写+diff/comment、自定义筛选 |
| 5 | GitHub Desktop | ~4 | 登录、仓库、PR 创建/检出、系统通知 |
| 6 | Git Extensions / SmartGit / GitButler | ~3.5–4 | 克隆/fork/PR 子集 |

没有任何一款 GUI 同时具备 **Release 创建** + **Actions 运行控制** + **Gist** + **Codespaces** + **Projects** + **通知收件箱** + **Star 管理**。现实就是分工：GitHub Desktop/Fork/Tower/GitButler 管本地 Git 与基础 PR，Octobox/Gitify 管通知，Astral 管星标，网页端是唯一全能但**不是 GUI 客户端**。

### Q2：Star 管理（与本项目直接相关）

能在 GUI 里浏览/管理自己 star 列表的：

| 工具 | Star 能力 | 证据 |
|---|---|---|
| **GitHub 网页端** | 浏览 + 搜索 + 排序 + 筛选 + Lists 分组 + 取消星标 | <https://docs.github.com/en/get-started/exploring-projects-on-github/saving-repositories-with-stars>（"You can search, sort, and filter your starred repositories and topics on your stars page."） |
| **Astral** | 标签 / 备注 / 筛选 / 强搜索 / 取消星标；托管免费或自托管 | <https://astralapp.com/>、<https://github.com/astralapp/astral> |
| **My-GitHub-Stars (`ghstars`)** | TUI + 桌面 GUI + 本地 Web 三种形态；按语言/topic 分组、实时搜索、AI 语义检索、SQLite 本地缓存 | <https://github.com/single9/My-GitHub-Stars> |
| **StarGazer** | 星标管理（GPL-3.0，127★，2026-02 后低活跃） | <https://github.com/xy2yp/StarGazer> |
| **GithubStarManager（本项目）** | 浏览器 userscript：标签/备注/搜索/筛选/同步 + 卡片式星标网格 | 本仓库（`YsLtr/GithubStarManager`，0★） |
| **GithubStarsManager**（`AmintaCCCP`，**同名不同项目——本项目的主要竞品**） | Electron 桌面 GUI（Win/macOS/Linux）：星标同步 + AI 自动摘要/分类 + 语义搜索 + 标签筛选 + Release 订阅与产物下载 + Fork/Gist 管理 + 仓库 Q&A + MCP server；本地优先 | <https://github.com/AmintaCCCP/GithubStarsManager>（3,603★，MIT，TypeScript，2026-09-25 活跃，官网 <https://gsm.aminta.top>） |
| **RepoKai** | 只看自己的仓库（GUI+TUI），星标能力未确证 | <https://github.com/ivapo/repokai> |
| **GitHub Mobile** | 官方文档能力清单**未列出**星标管理；Lists 支持亦不能等同于星标列表管理 → **未知/未确证** | <https://docs.github.com/en/get-started/using-github/github-mobile> |
| Fork / Tower / GitKraken / Desktop / Sublime Merge / Sourcetree / Git Extensions / SmartGit / GitButler / lazygit / gh-dash | **全部无星标管理** | 各自官方特征页与文档中无该能力 |

> 结论（**已按 2026-09-25 核实修正**）：主流 Git 图形客户端（Fork / Tower / GitKraken / Desktop / Sublime Merge / Sourcetree / Git Extensions / SmartGit / GitButler / lazygit / gh-dash）**全部不做星标管理**，这是真实的空白区；但**「没有竞争者」的原判断不成立**——`AmintaCCCP/GithubStarsManager`（3,603★、活跃、MIT）已是同一问题的成熟桌面 GUI 方案，能力上覆盖标签 + AI 语义搜索 + Release 订阅，**超出**本项目当前范围。
>
> 本项目的差异化仍成立，但需重新表述：它是**浏览器内嵌 / 零安装 / 与 GitHub 原生 star 页共存**的形态，而竞品是 Electron 桌面应用（需下载、独立数据副本、本地优先存储）。差异在**形态与数据驻留**，不在功能多少。另注：两仓库名仅差一个 `s`（本项目 `GithubStarManager` vs 竞品 `GithubStarsManager`），极易混淆，对外表述时建议明确写全 `owner/repo`。

---

## 八、推荐（若只装一个客户端管 PR / 通知 / Issue）

**诚实答案：没有一个能同时管好这三样。**

- **首选：GitKraken Desktop（免费 Community 档起步）** —— PR 覆盖最全的商业 GUI（创建/审阅/行级建议/合并三策略/模板/Launchpad 看板），且是少数能读写 GitHub Issues 的桌面 GUI。代价：**没有通知收件箱**，Community 档**仅公开仓库**，部分集成 view-only，Actions 面板已在 11.10 被移除。来源：<https://help.gitkraken.com/gitkraken-desktop/pull-requests/>、<https://help.gitkraken.com/gitkraken-desktop/integrations/>
- **若通知是一等需求**：GitHub Mobile（通知 + Issue + PR 审阅 + Actions + Releases 查看）或 Gitify（纯通知，跨 forge，减轻托盘噪音）+ 网页端处理 PR/Issue；钱少、开源、覆盖三线的组合是 **Octobox + 网页端**。
- **付费可接受且只要 PR 全流程**：Tower（$69/用户/年起，无免费档）或 Fork（$59.99 一次性，但**完全没有 PR 管理**，只要 Git 图形就够）。
- **不推荐**：DevHub（Issue/PR 管理仍在未实现的 "Next features"，且仓库自 2024-09 起无提交）、Graphite Desktop（仓库 2023 年已 archived）。

---

## 九、未能查证 / 存疑项（明确列出，未编造）

1. **GitHub Mobile 能否创建/合并 PR、能否行级评论、能否管理 Actions 运行的 rerun/cancel**：官方文档只写 "Read, review, and collaborate on issues and pull requests"，未细化到合并与行级评论。→ 标 ？/⚠️。
2. **GitHub Mobile 的星标列表管理**：能力清单中未出现，但"未出现"不等于"不能"，未做真机验证。
3. **GitKraken 的具体价格档位**：`gitkraken.com/pricing` 为 JS 渲染页，抓取到的是 CSS/字体而非价格数字；只确证了「有免费 Community 档 + 付费 Pro/Advanced（14 天试用）」与文档中的功能门控（Community 仅公开仓库；自托管需 Pro/Advanced 以上）。→ 价格未能确证。
4. **Tower 的准确价格**：仅从定价页 HTML 中匹配到 "`$69/user/year for individuals and teams.`" 字符串，未逐档核对（多年授权/多席位折扣未见）。→ 视为「订阅制，约 $69/用户/年起」。
5. **Sourcetree 的版本线与维护状态**：搜索摘要称 3.4.31 于 2026-06-09 发布，同时 Atlassian 下载域存在 4.x 的 release notes；官方 EOL/停更公告未查证到，社区长期在论坛提问是否停更但无官方答复。→ 标为「低强度维护 / 状态存疑」。
6. **SmartGit 的 Gist 功能**：只有 PAT scope 要求 `gist` 这一间接证据，功能页未正面确认。→ 标 ⚠️/未知。
7. **Octobox 能否创建/关闭 Issue**：只查到「Respond to issues or open link in GitHub」的 issue 标题，未在官方文档中确认其支持创建/关闭。→ 标 ⚠️/未知。
8. **Sublime Merge 的交互式 rebase**：官网特征列表未列 rebase，标 ⚠️（不确定是否有完整交互式 rebase UI）。
9. **GitHub Desktop 官方「能做什么/不能做什么」清单**：网上流传的 `letitglow.app` 附录式清单非官方来源，未采信；本报告对 Desktop 的判断全部基于 GitHub 官方文档、官方 roadmap 与仓库内 issue 状态。

---

## 十、参考来源列表

**官方文档 / 官方仓库**
1. gh CLI 命令参考（全文）：<https://cli.github.com/manual/gh_help_reference>
2. GitHub Desktop 产品定位（`what-is-desktop.md`）：<https://github.com/desktop/desktop/blob/development/docs/process/what-is-desktop.md>
3. GitHub Desktop roadmap（含 2.3 fork、2.9/3.0 通知等已发布项）：<https://github.com/desktop/desktop/blob/development/docs/process/roadmap.md>
4. GitHub Desktop 官方文档：<https://docs.github.com/en/desktop/overview/about-github-desktop>
5. GitHub Desktop PR 查看/检出：<https://docs.github.com/en/desktop/working-with-your-remote-repository-on-github-or-github-enterprise/viewing-a-pull-request-in-github-desktop>
6. GitHub Desktop 通知配置（仅系统通知）：<https://docs.github.com/en/desktop/working-with-your-remote-repository-on-github-or-github-enterprise/configuring-notifications-in-github-desktop>
7. GitHub Desktop 已知问题：<https://github.com/desktop/desktop/blob/development/docs/known-issues.md>
8. GitHub Desktop 3.6 changelog（worktree / Copilot 冲突解决）：<https://github.blog/changelog/2026-06-26-github-desktop-3-6-worktrees-and-deeper-copilot-integration/>
9. GitHub Desktop 相关 issue：#6648 Create Release（未实现）、#20614 PR reviews（open）、#11517 / #2642 / #12773（PR 体验与按钮）：<https://github.com/desktop/desktop/issues/6648>、<https://github.com/desktop/desktop/issues/20614>、<https://github.com/desktop/desktop/issues/11517>
10. GitHub Mobile 官方文档（能力清单）：<https://docs.github.com/en/get-started/using-github/github-mobile>
11. GitHub Mobile：Actions（2022-10）：<https://github.blog/changelog/2022-10-04-introducing-actions-on-github-mobile/>
12. GitHub Mobile：仓库视图 Actions（2023-05）：<https://github.blog/changelog/2023-05-09-introducing-actions-on-the-repository-view-on-github-mobile/>
13. GitHub Mobile：Releases（2021-03）：<https://github.blog/changelog/2021-03-16-github-mobile-now-supports-github-releases/>
14. GitHub Mobile：创建仓库（2026-05）：<https://github.blog/changelog/>（标题 "Create repositories on the go with GitHub Mobile"）
15. GitHub 星标页官方文档：<https://docs.github.com/en/get-started/exploring-projects-on-github/saving-repositories-with-stars>

**第三方客户端官方文档**
16. GitKraken PR 能力矩阵：<https://help.gitkraken.com/gitkraken-desktop/pull-requests/>
17. GitKraken 集成与计划门控：<https://help.gitkraken.com/gitkraken-desktop/integrations/>
18. GitKraken GitHub Issues 集成：<https://help.gitkraken.com/gitkraken-desktop/github-issues/>
19. GitKraken Actions 面板移除（11.10）：<https://help.gitkraken.com/gitkraken-desktop/github-actions/>
20. GitKraken Launchpad：<https://help.gitkraken.com/gitkraken-desktop/gitkraken-launchpad/>
21. GitKraken 定价：<https://gitkraken.com/pricing>
22. Tower 全功能列表（含 SSH/GPG、PR、worktree）：<https://www.git-tower.com/features/all-features>
23. Tower 定价与 FAQ（无免费档、30 天试用）：<https://www.git-tower.com/pricing>
24. Fork 官网功能清单：<https://git-fork.com/>
25. Fork 购买：<https://git-fork.com/buy>
26. Sublime Merge 官网：<https://www.sublimemerge.com/>
27. Sublime Merge 授权：<https://www.sublimehq.com/store/merge>
28. Sourcetree 官网：<https://www.sourcetreeapp.com/>
29. Sourcetree 发布说明（Atlassian 下载域）：<https://product-downloads.atlassian.com/software/sourcetree/ReleaseNotes/Sourcetree_4.2.14.html>
30. Git Extensions GitHub 集成（fork / 查看 PR / 创建 PR）：<https://git-extensions-documentation.readthedocs.io/en/main/github.html>
31. Git Extensions 仓库：<https://github.com/gitextensions/gitextensions>
32. SmartGit GitHub 集成（含 PAT scopes）：<https://docs.syntevo.com/SmartGit/Latest/Manual/Integrations/GitHub-integration>
33. SmartGit 集成 PR：<https://docs.syntevo.com/SmartGit/Latest/Manual/Integrations/Integrated-PullRequests>
34. SmartGit PR 评论（含行级）：<https://docs.syntevo.com/SmartGit/Latest/Manual/Integrations/Integrated-PullRequest-Comments>
35. GitButler GitHub 集成：<https://docs.gitbutler.com/features/forge-integration/github-integration>
36. GitButler 仓库与许可（Fair Source → 2 年后 MIT）：<https://github.com/gitbutlerapp/gitbutler>
37. gh-dash 仓库与功能：<https://github.com/dlvhdr/gh-dash>
38. lazygit 配置文档（PR 状态显示与浏览器打开）：<https://github.com/jesseduffield/lazygit/blob/master/docs/Config.md>
39. Octobox 仓库与功能：<https://github.com/octobox/octobox>
40. Octobox 站点：<https://octobox.io/>
41. Gitify 仓库与 forge 支持矩阵：<https://github.com/gitify-app/gitify>
42. Gitify FAQ（认证方式、快捷键、通知动作）：<https://gitify.io/faq>
43. DevHub 仓库（"Next features" 含 Issues/PR management）：<https://github.com/devhubapp/devhub>
44. Astral 官网：<https://astralapp.com/>
45. Astral 仓库：<https://github.com/astralapp/astral>
46. My-GitHub-Stars：<https://github.com/single9/My-GitHub-Stars>
47. StarGazer：<https://github.com/xy2yp/StarGazer>
48. RepoKai：<https://github.com/ivapo/repokai>
49. Graphite 定价：<https://graphite.dev/pricing>
50. Graphite Desktop 仓库（已 archived，2023-07）：<https://github.com/withgraphite/graphite-desktop>

**版本与仓库元数据**：GitHub REST API `/repos/{owner}/{repo}` 与 `/releases/latest` 实时查询（Stars、`pushed_at`、`license`、`archived`），查询时间 2026-09-25。
