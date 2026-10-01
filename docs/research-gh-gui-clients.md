# 建立在 / 依赖 GitHub 官方 CLI `gh` 之上的第三方图形界面客户端调研

> 调研时间：2026-09-25（UTC）
> 数据来源：GitHub REST API（`repos/{owner}/{repo}`、`readme`、`contents`、`git/trees`、`search/code`、`search/repos`、GraphQL）+ 项目 README / 源码原文（通过 API 拉取原始文本核对，非搜索摘要）。
> 所有 stars / 最后 push 时间为 **2026-09-25 UTC 拉取时的值**，会随时间变化。

---

## 0. 判据定义（本报告的收录标准）

| 类别 | 定义 | 本报告处理 |
|---|---|---|
| **A. 真·gh 客户端（扩展）** | 由 `gh xxx` 唤起、通过 `gh extension install` 安装，天然复用 `gh` 登录态 | 收录，标注「gh 扩展」 |
| **B. 真·gh 客户端（调二进制）** | 进程自己 `execFile('gh',…)` / `spawn('gh',…)` / `exec.Command("gh",…)`，复用 `~/.config/gh/hosts.yml`、`gh auth token` | 收录，标注具体的调用文件与行 |
| **C. 复用 gh 凭据但非调用** | 自己直接读 `~/.config/gh/hosts.yml` / 读 `GH_TOKEN` 环境变量，但不 spawn `gh` | 收录并**显式区分**（这是第三态，容易被误归为 B） |
| **D. 直连 API，与 gh 无关** | 自己的 OAuth app / PAT + REST/GraphQL | 单列「被误认为基于 gh」一节 |
| **E. TUI / 编辑器插件（非窗口 GUI）** | 终端 UI 或编辑器内 UI | 单独一节 |

**关键区分点（用户最容易混淆的）**：`gh extension` 生态里绝大多数是 **TUI 或纯 CLI**，真正带**窗口界面**的极少；而带窗口界面的桌面客户端（GitHub Desktop / Gitify / GitKraken）**基本都不用 gh**。

---

## 1. 总览

| 名称 | 仓库 | 界面类型 | 与 gh 的关系 | Stars | 最后 push | 维护状态 |
|---|---|---|---|---|---|---|
| **GitDesktop** | `theBGuy/GitDesktop` | 窗口 GUI（Tauri + React） | **B 调二进制 + C 读凭据**（`resolve_named(["gh"])` + 直接读 `hosts.yml`） | 228 | 2026-09-25 | 活跃 |
| **slint-ui-for-github-cli** | `NigelBreslaw/slint-ui-for-github-cli` | 窗口 GUI（Slint + TS + Node 后端） | **B 调二进制**（`execFile("gh", …)` 全家桶） | 0 | 2026-07-16 | 活跃但极早期 |
| **github-cli-manager** | `matt-bat/github-cli-manager` | 窗口 GUI（Electron） | **B 调二进制**（`spawn(exe, args)`，白名单 `["gh","git"]`） | 1 | 2026-09-13 | 活跃（早期） |
| **ChitHub** | `Amirhat/ChitHub` | 窗口 GUI（Go 单二进制 + 内嵌 WebView） | **B 部分调二进制**（`exec.Command("gh","run","list",…)`），git 操作走 `git` | 17 | 2026-06-22 | 停滞约 3 个月 |
| **GitHub Workbench** | `zoubingwu/gh-workbench` | **浏览器窗口 UI**（+ TUI） | **A gh 扩展**（`gh extension install`，复用 `gh auth login` 账号） | 2 | 2026-08-25 | 活跃但极早期 |
| **GH Notifier** | `EronWright/gh-notifier` | 菜单栏 App（macOS，Swift） | **B 调二进制**（`Process` 执行 `/usr/bin/gh`，失败提示装 gh） | 3 | 2026-05-20 | 缓慢维护 |
| **GitHub CLI UI** | `nickcernis/github-cli-ui` | VS Code 扩展 GUI（QuickPick） | **B 调二进制**（在 IDE 内执行 `gh pr list` / `gh pr checkout`） | 0 | 2024-03-14 | **已停更 2.5 年** |
| **PREx** | `matrujillo10/PREx` | 浏览器 UI（Python 起本地服务） | **B 调二进制**（README 明写 "GitHub access uses the gh CLI"） | 0 | 2026-05-10 | 停滞约 4 个月 |
| **GitKraken CLI (`gk`)** | `gitkraken/gh-gk` | CLI + 与 GitKraken/GitLens GUI 联动 | **A gh 扩展** | 75 | 2024-11-04 | **已停更约 2 年** |
| **gh-dash** | `dlvhdr/gh-dash` | **TUI** | **A gh 扩展 + B + go-gh** | 12554 | 2026-09-22 | 非常活跃 |
| **ghui** | `kitlangton/ghui` | **TUI** | **B 调二进制**（`command.runSchema(schema,"gh",args)`） | 1118 | 2026-09-25 | 非常活跃 |
| **octo.nvim** | `pwntester/octo.nvim` | 编辑器 UI（Neovim，插件在 GUI 版 Neovim 里是窗口界面） | **B 调二进制**（`gh_cmd = "gh"`，`vim.fn.system(gh …)`） | 3386 | 2026-08-28 | 活跃 |
| **lazygit** | `jesseduffield/lazygit` | **TUI** | **B 调二进制（配角）**：仅 `gh auth token` 取 token | 82671 | 2026-09-25 | 非常活跃 |
| **gh-select** | `remcostoeten/gh-select` | **TUI** | **A gh 扩展**（`gh extension install`，`gh select`） | 2 | 2026-09-20 | 活跃但极早期 |
| **gh-repo-explore** | `samcoe/gh-repo-explore` | **TUI** | **A gh 扩展** | 65 | 2023-12-11 | **已停更近 3 年** |
| **gh-dep** | `jackchuka/gh-dep` | **TUI** | **A gh 扩展**（go.mod 依赖 `cli/go-gh/v2`） | 33 | 2026-09-24 | 活跃 |
| **gh-board** | `uzimaru0000/gh-board` | **TUI** | **A gh 扩展** | 22 | 2026-05-26 | 缓慢维护 |
| **gh-news** | `chmouel/gh-news` | **TUI** | **A gh 扩展** | 34 | 2026-09-10 | 活跃 |
| **gh-zen** | `martinkersner/gh-zen` | **TUI** | **A gh 扩展**（go.mod 依赖 `cli/go-gh/v2`） | 1 | 2026-07-03 | 早期 |
| **gh-repo-man** | `2KAbhishek/gh-repo-man` | **TUI** | **A gh 扩展** | 32 | 2026-09-03 | 活跃 |
| **magit-gh** | `jonathanchu/magit-gh` | Emacs 界面（GUI 版 Emacs 可用） | **B 调二进制**（README：「piggybacks on `gh auth login`」，**No token management**） | 25 | 2026-08-19 | 活跃 |
| **gh-manager-cli** | `wiiiimm/gh-manager-cli` | **TUI** | **D 直连 API**（自带 OAuth，见 §3） | 16 | 2026-09-16 | 活跃 |

---

## 2. 真·gh 客户端（带窗口/图形界面）—— 逐条证据

### 2.1 GitDesktop（`theBGuy/GitDesktop`）—— 证据最充分的「窗口 GUI 调 gh」

- 平台/栈：Tauri + React + Rust；描述自述 "keyboard-first Git desktop client"。
- **README 明写**：`All GitHub access goes through the **GitHub CLI (`gh`)**: no OAuth app`，并要求 `gh auth login`。
  <https://github.com/theBGuy/GitDesktop/blob/main/README.md>
- **源码证据（B 类）**：
  - `src-tauri/src/forge/github.rs`：`let gh = crate::agent::resolve_named(&["gh"], None)…`
  - `src-tauri/src/forge/session.rs`：`let bin_names: &[&str] = if is_github { &["gh"] } else { &["glab"] };`（GitLab 走 `glab`，GitHub 走 `gh`）
  - `src-tauri/src/health.rs`：`("gh", &["gh"], Some(&["auth", "status"]))`（启动健康检查执行 `gh auth status`）
  - `src-tauri/src/github/runner.rs`：注释明确说明不走裸 `Command::new("gh")`，而是从注册表/PATH 解析绝对路径（解决 GUI 不继承 shell PATH 的经典问题）
- **源码证据（C 类，读凭据不调 gh）**：
  - `src-tauri/src/github/auth.rs`（文件头注释：*"`gh auth` surface that doesn't need the network"*）：
    - 直接定位并读取 `~/.config/gh/hosts.yml`（`home.join(".config").join("gh")`），注释称 *"The file holds live tokens, so only key NAMES at column 0 can leave"*；
    - 直接读 gh 的环境变量优先级 `<GH_TOKEN, GITHUB_TOKEN, GH_ENTERPRISE_TOKEN, GITHUB_ENTERPRISE_TOKEN>`（注释引用 `gh help environment`）。
- 结论：**同时属于 B（调 gh 二进制）与 C（直接解析 gh 配置/环境变量）**，是"复用 gh 登录态"最彻底的窗口客户端之一。这一点在它 README 里也有：*"gh detects each repo's host from its remote… Settings → Accounts switches the [account]"*。
- ⚠️ 注意：它是**第三方独立项目**，与官方 `github/desktop` 无任何关系（名字接近，极易混淆）。

### 2.2 slint-ui-for-github-cli（`NigelBreslaw/slint-ui-for-github-cli`）

- 平台/栈：Slint（Rust UI）+ TypeScript/Node 后端；创建于 2026-03-30，stars 0（极早期）。
- **README 明写**：*"Slint desktop UI that reads data from the GitHub CLI (`gh`) on your machine."*，并要求 `gh` **≥ 2.89.0**、在 PATH 上、"the app does not ship `gh`"。
  <https://github.com/NigelBreslaw/slint-ui-for-github-cli/blob/main/README.md>
- **源码证据**：`app/src/backend/gh/gh-cli-version.ts` 第一行即 `import { execFile } from "node:child_process";`，导出 `MIN_GH_CLI_VERSION = { major: 2, minor: 89, patch: 0 }`；同目录下 `gh-app-client.ts` 被 README 描述为 *"`gh api` / `gh api graphql` JSON helpers"*。
- 额外证据（登录态复用）：README 写明它直接代理 `gh auth login --web --git-protocol ssh --skip-ssh-key --scopes read:org,read:project,notifications`，并要求 token 具备 `read:org`/`read:project`/`notifications` scope。
- 结论：**B 类，纯 gh 封装**，是目前"明确以 gh 为唯一后端"的窗口 GUI 中最干净的一例，但社区关注度≈0。

### 2.3 github-cli-manager（`matt-bat/github-cli-manager`）

- 平台/栈：Electron（`src/main.js` + `public/` 渲染层）；stars 1。
- **README 明写**：*"Clean, local-only desktop app for managing GitHub operations through silently executed GitHub CLI (`gh`)"*、*"The local GitHub CLI uses the user's existing authentication"*、*"App installer or first-run setup wizard should detect and help install the GitHub CLI"*。
  <https://github.com/matt-bat/github-cli-manager/blob/main/README.md>
- **源码证据**：`src/command-runner.js`
  - `import { spawn } from "node:child_process";`
  - `const ALLOWED_EXECUTABLES = new Set(["gh", "git"]);` ← 可执行文件白名单，只允许 `gh` 与 `git`
  - `validateGhArgs()` 校验 `normalized[0] === "gh"`，并做 `gho_…` / `ghp_…` token 脱敏
- 结论：**B 类**，设计上刻意"不复刻 token，委托给 gh 认证上下文"（README 原话：*"prefer `gh`'s existing authentication context instead of duplicating GitHub tokens"*）。项目还很早（有 Playwright e2e、有 MVP spec 文档），成熟度低。

### 2.4 ChitHub（`Amirhat/ChitHub`）—— 部分依赖，非全面依赖

- 平台/栈：Go 单二进制 + 内嵌 web UI（`web/app.js`、`web/index.html`），描述为 "GitHub Desktop, but for all your repos at once. One native Go binary, no Electron."
- **源码证据（B 类，但是局部）**：`features.go`
  - 行 542：`if _, err := exec.LookPath("gh"); err != nil { … }`
  - 行 546：`cmd := exec.Command("gh", "run", "list", "-L", "1", …)` ← 读 GitHub Actions 运行
  - 行 584/591：`exec.Command("gh", args...)` ← 创建 PR 等
  - 行 602：`return OpResult{… Output: "Could not create a PR (no gh CLI and no web remote)."}`
- 与之对照，所有本地 git 操作走 `git`：`git.go` 行 69/88 `exec.CommandContext(ctx, "git", args...)`（README 原话：*"Git operations shell out to your real `git`, so your existing credentials just work."*）
- 身份/认证：`config.go` 中**没有** token / OAuth 字段（只有 `Theme` 等）；**未查到**它自己的 GitHub API 客户端，推测其 GitHub 侧能力完全委托给 `gh`（**标注为推测**，因为我没有逐文件通读全部 Go 源码）。
- ⚠️ 同名 fork `YasharImandar/ChitHub` **未查证到**：`repos/YasharImandar/ChitHub` 返回 HTTP 404，GitHub 搜索也无该 owner 下的 ChitHub。该 fork 可能已删除/重命名/私有。**未能查证**。
- 维护状态：最后 push 2026-06-22，距今约 3 个月，可视为停滞。

### 2.5 GitHub Workbench（`zoubingwu/gh-workbench`）—— gh 扩展 + 浏览器窗口

- 平台/栈：Go；**是 gh 扩展**（`gh extension install zoubingwu/gh-workbench`，然后 `gh workbench`）。
- **README 明写**：*"It runs as a GitHub CLI extension, finds open work … **awaiting review from the active `gh` account**"*、*"An active account stored by `gh auth login`"*；提供两种界面：终端 TUI（默认）与浏览器界面（`gh workbench --browser`，起 loopback HTTP 服务并打开浏览器）。
  <https://github.com/zoubingwu/gh-workbench/blob/main/README.md>
- 证据效力说明：浏览器模式是"本地服务 + 浏览器窗口"，严格说是 **Web UI 而非原生窗口 GUI**；但它确实提供了图形化的列表/操作界面，且是 gh 扩展（**A 类**），因此列入。
- ⚠️ 注意 README 中同时说明 *"sends API requests directly to the selected GitHub host"* —— 即**取数据可能走 go-gh 的 API 客户端而非 spawn gh 子进程**；但作为 gh 扩展，它**必然**复用 gh 的命令行上下文与 `gh auth login` 凭据。这属于 A 类（扩展）而非 B 类（调二进制）。

### 2.6 GH Notifier（`EronWright/gh-notifier`）—— macOS 菜单栏 App

- 平台/栈：Swift（SwiftPM），打包成 `GH Notifier.app` 菜单栏应用。
- **README 明写**：*"A tiny macOS menu bar app that watches your GitHub notifications via the `gh` CLI."*，前置要求 `gh` 已 `gh auth login`；图表中标注每轮轮询实际执行 `gh api notifications -f all=false`。
  <https://github.com/EronWright/gh-notifier/blob/main/README.md>
- **源码证据**：`Sources/GHNotifier/NotificationFetcher.swift`
  - `let process = Process(); process.executableURL = URL(fileURLWithPath: executable); process.arguments = args`
  - 错误分支包含 `case .ghNotFound:` → *"Could not find the `gh` CLI. Install it from https://cli.github.com and run `gh auth login`."*
  - 行 149 附近出现 `/usr/bin/gh` 作为候选路径
  - 注释中直接写 *"Equivalent to: `gh api -X PATCH notifications/threads/{id}`"*
- 结论：**B 类**，明确的 gh 二进制调用 + 菜单栏 GUI。stars 3，属个人小工具。

### 2.7 GitHub CLI UI for VS Code（`nickcernis/github-cli-ui`）

- 平台/栈：VS Code 扩展（TypeScript），发布在 VS Code Marketplace（`NickCernis.github-cli-ui`）。
- **README 明写**：*"Requires GitHub CLI to be installed and authenticated"*、*"Backed by the official GitHub CLI — no separate keys or authentication to manage."*，并把 `gh pr list` / `gh pr checkout` 等包装成 Command Palette 与 QuickPick 界面。
  <https://github.com/nickcernis/github-cli-ui/blob/main/README.md>
- **源码/行为证据**：README 描述 *"The plugin ran `gh pr checkout [number of selected PR]` for you"*。
- 定位说明：IDE 内 QuickPick 列表属于**轻量图形界面**，不是原生窗口；列为"准 GUI"。
- ⚠️ 维护状态：最后 push **2024-03-14**，已停更约 2.5 年。

### 2.8 PREx（`matrujillo10/PREx`）

- 平台/栈：Python 后端 + 预构建 UI bundle（`prex/_ui_dist/`），启动后打开浏览器。
- **README 明写**：小节标题即 *"GitHub access uses the gh CLI"*，步骤为 `gh auth login` → *"parse + serve UI + open browser"*。
  <https://github.com/matrujillo10/PREx/blob/main/README.md>
- 结论：**B 类**（浏览器窗口 UI + gh 授权）。stars 0、最后 push 2026-05-10，社区关注度≈0，注意别与其同名概念混淆。

### 2.9 GitKraken CLI Extension（`gitkraken/gh-gk`）

- 平台/栈：CLI 扩展（**A 类**），`gh extension install gitkraken/gh-gk`。
- **README 明写**：*"`gk` is the GitKraken command line extension to GitHub CLI (`gh`)"*、*"seamlessly connects with GitKraken Client and GitLens for VS Code for instant Git visualization"*。
  <https://github.com/gitkraken/gh-gk/blob/main/README.md>
- 价值：这是**唯一一个由商业 GUI 客户端厂商（GitKraken）官方提供的 gh 扩展**，作为 GUI ↔ gh 的桥。但 `gk` 本身是命令行工具；**GitKraken Client 本体是否调用 `gh`——未查证到证据**，其官网帮助文档描述的是自有 CLI（`gk-cli`）与自有 provider 机制。**保守结论：GitKraken Client 本体归类为 D（直连自有 OAuth），`gk` 扩展归类为 A**。
- ⚠️ 维护：最后 push **2024-11-04**，已停更约 2 年。

---

## 3. 明确**不用** gh CLI 的图形客户端（"被误认为基于 gh"）

这一节是本次调研最重要的澄清。以下产品常被用户误以为"基于 gh"，但**代码层面不调用 gh 二进制、也不读 gh 配置**，而是走**自己的 OAuth app / PAT + GitHub REST/GraphQL API**。

### 3.1 GitHub Desktop（`desktop/desktop`，21902★）

- **官方文档明确**：`docs/technical/oauth.md` 开头即 —— *"Because GitHub Desktop uses **OAuth web application flow** to interact with the GitHub API and perform actions on behalf of a user, it needs to be **bundled with a Client ID and Secret**."*
  <https://github.com/desktop/desktop/blob/development/docs/technical/oauth.md>
- **代码佐证**：`app/app-info.ts` 中存在 `__OAUTH_CLIENT_ID__` / `__OAUTH_SECRET__` 占位符；认证相关路径为 `app/src/lib/auth.ts`、`app/src/lib/stores/token-store.ts`、`app/src/lib/git/authentication.ts`（自有 token store + git credential trampoline，非 `gh`）。
- **代码搜索反证**：在整个 `desktop/desktop` 仓库中搜索 `"gh.exe"`、`spawn("gh")`、`execFile("gh")`、`cli.github.com` 均**只命中 CI 工作流与发布脚本**（如 `.github/workflows/issue-triage.lock.yml` 用 `gh` 做 issue 分类、`script/draft-release/index.ts` 打印一句提示），**产品运行时代码零命中**。
- **"bundle gh" 类 feature request 的状态**（种子清单中的编号多数对不上，逐个核实结果如下）：

| 引用 | 实际内容 | 状态 |
|---|---|---|
| issue **#11655** | 「Allow user to install "gh CLI" from Desktop」 | **OPEN**，labels `enhancement` + **`not-planned`**（明确不在路线图上），创建 2021-02-26，1 条评论（用户反向请求：「希望 Desktop 里能开一个用当前登录态启动 CLI 的入口」）|
| issue **#6533** | 「How does GitHub Desktop use the credentials after oauth?」 | **CLOSED**（提问帖，非 feature request）|
| PR **#18700** | 「Add support for Git Credential Manager (beta-only)」 | **MERGED**（2024-05-29），但这是**Git Credential Manager**支持，与 gh CLI 无关 |
| PR **#18773** | 「Prompt to sign in to GitHub hosts in credential helper」 | **MERGED**，同上，与 gh CLI 无关 |
| discussion **177763** | 「Github Desktop」社区讨论 | 内容为社区用户解释「**Neither installs the other**」、*"They don't automatically share login credentials"* —— 正是"两者独立"的社区共识文档 |

- **结论**：GitHub Desktop **不使用 gh CLI**，且官方立场是 `not-planned`。

### 3.2 Gitify（`gitify-app/gitify`，5354★）

- **依赖证据**：`package.json` 中认证/网络层为 `@octokit/core`、`@octokit/graphql`、`@octokit/oauth-methods`、`@octokit/plugin-paginate-rest` —— 即 **Octokit + 自有 OAuth flow**。在仓库中搜索 `execFile` / `child_process` / `spawn("gh")` **零命中**。
- **README 证据**：登录方式为 "Login with GitHub"（OAuth app）或 PAT；对 Gitea/Forgejo/Codeberg/GitLab/Bitbucket 使用 PAT，走 **forge adapter** 模式（<https://github.com/gitify-app/gitify/blob/main/README.md>）。
- **结论**：**D 类，与 gh 无关**。菜单栏/托盘 GUI，但认证完全独立。

### 3.3 GitKraken Client / Fork 等其他商业 GUI

- GitKraken 官方帮助文档描述的是自有 CLI（`gk-cli`）与 provider 机制（`gk provider`），未见任何"依赖 gh"的表述：<https://help.gitkraken.com/cli/cli-home/>
- Fork（<https://git-fork.com/>）：官网无 gh 相关表述，**未查证到**其调用 gh 的证据。
- **结论**：归类为 **D（直连 API / 自有认证）**；其中 GitKraken 通过 `gh-gk` 扩展提供了单向桥接（见 §2.9）。

### 3.4 ChitHub 的边界情况（对照用）

ChitHub 是**部分依赖**的典型：本地 git 全走 `git`，只有 GitHub 侧动作（Actions 列表、建 PR）走 `gh`。既不能简单归入 A/B，也不能归入 D。已按"B 部分"标注。

---

## 4. TUI / 编辑器界面专节（非窗口 GUI，但对理解 gh 生态极有价值）

> 本节回答用户隐含问题：「gh 生态里到底有没有图形前端？」—— 答案是：**有，但绝大多数是终端界面（TUI），不是窗口 GUI**。

| 名称 | 形态 | 与 gh 的关系 | Stars | 最后 push | 备注 |
|---|---|---|---|---|---|
| `dlvhdr/gh-dash` | TUI（bubbletea） | **A gh 扩展** + B（`internal/tui/components/tasks/pr.go`: `exec.Command("gh", task.Args...)`）+ `cli/go-gh/v2` | 12554 | 2026-09-22 | gh 生态最成熟的"准图形"界面；README 的 "Under the hood" 明列 `gh` for the GitHub functionality |
| `kitlangton/ghui` | TUI | **B 调二进制**（`src/services/GitHubService.ts`: `command.runSchema(schema, "gh", args)`，另定义 `ghJson`/`ghVoid`） | 1118 | 2026-09-25 | README 要求 `gh auth login`；npm 包 `@kitlangton/ghui` |
| `pwntester/octo.nvim` | Neovim 插件（`gh_cmd = "gh"`，`vim.fn.system(gh …)`，`vim.fn.executable(gh_cmd)`） | **B 调二进制** | 3386 | 2026-08-28 | 在 Neovim GUI 前端里呈现为窗口界面，但本质是编辑器插件 |
| `jesseduffield/lazygit` | TUI | **B（配角）**：`pkg/commands/git_commands/github.go` 中 `ghExecutable()` → `exec.LookPath("gh")`，再 `{ghExe, "auth", "token", "--hostname", host}`；代码注释解释"token 必须来自 gh 本身而非进程内查找"，因为 gh 会 refresh token | 82671 | 2026-09-25 | **只用于 PR 图标功能**；无 gh 时优雅降级 |
| `remcostoeten/gh-select` | TUI | **A gh 扩展** | 2 | 2026-09-20 | README 亦说明"standalone 模式仍使用 gh 认证" |
| `samcoe/gh-repo-explore` | TUI | **A gh 扩展** | 65 | 2023-12-11 | 已停更近 3 年 |
| `jackchuka/gh-dep` | TUI | **A gh 扩展**（go.mod: `cli/go-gh/v2 v2.16.1`） | 33 | 2026-09-24 | Dependabot/Renovate PR 批量管理 |
| `uzimaru0000/gh-board` | TUI | **A gh 扩展** | 22 | 2026-05-26 | Projects V2 看板 |
| `chmouel/gh-news` | TUI | **A gh 扩展** | 34 | 2026-09-10 | 通知阅读器 |
| `martinkersner/gh-zen` | TUI | **A gh 扩展**（go.mod: `cli/go-gh/v2 v2.13.0`） | 1 | 2026-07-03 | 极早期 |
| `2KAbhishek/gh-repo-man` | TUI | **A gh 扩展** | 32 | 2026-09-03 | 仓库批量管理 |
| `jonathanchu/magit-gh` | Emacs 界面 | **B 调二进制**（`magit-gh-utils.el` 的 `magit-gh--check-gh` "Ensure the gh CLI is available"；README：*"No token management — magit-gh piggybacks on `gh auth login`"*） | 25 | 2026-08-19 | 在 GUI Emacs 中即为窗口界面 |
| `wiiiimm/gh-manager-cli` | TUI | **D 直连 API**（见下） | 16 | 2026-09-16 | ⚠️ 见下方警告 |

### ⚠️ 4.1 一个重要的反例：`gh-manager-cli` 名字像 gh 生态但**不用 gh**

- 仓库：`wiiiimm/gh-manager-cli`，npm 包 `gh-manager-cli`，宣称"TUI terminal app to manage GitHub repos"。
- **反证**：其源码树中存在 `src/services/oauth.ts`、`src/ui/components/auth/OAuthMethodSelector.tsx`、`src/ui/components/auth/OAuthProgress.tsx`、`tests/oauth.test.ts`、`wiki/Token-and-Security.md` —— 即**自带 OAuth 流程与自有 token 管理**；仓库内搜索 `gh auth` **零命中**。
- **结论**：**D 类（直连 API）**。名字带 `gh-manager` 纯属命名，与 `gh` CLI 无依赖关系。这正好印证了用户担心的"同名误导"。

---

## 5. gh 扩展生态里"带图形界面"的普查结论

1. **`gh extension browse`** 是 gh 官方自带的**终端交互界面**（会接管终端，要求 width > 100），不是窗口 GUI：
   <https://cli.github.com/manual/gh_extension_browse>
2. **awesome 列表普查**：`kodepandai/awesome-gh-cli-extensions`、`aymanbagabas/awesome-gh-cli-extensions`、`myzkey/awesome-gh-extensions` 三份列表中，**没有任何一个原生窗口 GUI 应用**；栏目只有 Git / GitHub / GitHub Education / Tool / Fun，条目全是 TUI、fzf 包装或纯 CLI：
   <https://github.com/kodepandai/awesome-gh-cli-extensions>
3. **GitHub 官方 gh 扩展不提供 GUI**：`github/*` 的 gh 扩展（gh-aw、gh-stack、gh-skyline、gh-copilot、gh-models、gh-projects、gh-classroom …）全部是 CLI/TUI；已停更的 `github/ghterm`（52★，2015 年最后 push）是 GitHub 官方的**旧 GitHub Terminal 演示**，已明确标注不再维护且与 `gh` CLI 无关：
   <https://github.com/github/ghterm>
4. **GitHub 官方博客对新扩展工具的说明**中亦无 GUI：
   <https://github.blog/developer-skills/github/new-github-cli-extension-tools/>
5. **npm / PyPI 普查**：搜到的 `gh-cli-bin`（PyPI，把 `gh` 本身打包成 wheel）属于**分发工具**不是前端；`gh-llm`、`gh-claude`、`github-inside-claude-code` 是 LLM/agent 侧集成，非 GUI。**Flathub / Snapcraft 未查到「gh CLI 图形前端」类包**（**未能查证**到有效条目）。

### 5.1 用 GitHub code search 主动找"真的 spawn gh"的仓库

`gh search code` 受语法限制（复杂 query 报 422），实测有效的简单短语与结果：

| 查询 | 命中的 GUI/应用类仓库 | 说明 |
|---|---|---|
| `execFile("gh"` | `Marker-Inc-Korea/AutoRAG`（取 `gh auth token`）、`microsoft/purview-dlm-mcp`（`gh auth token`）、`oblien/openship`、`nicobailon/pi-web-access` | 多为后端/工具链，**非 GUI** |
| `spawn("gh"` | `diffusionstudio/editor`（`spawn("gh", ["issue","create",…])`，Electron 桌面编辑器的"DAPI"处理器）、`openclaw/openclaw`、`earendil-works/pi`（`gh gist create` 做会话分享） | `diffusionstudio/editor` 是**窗口 GUI 调 gh** 的一例，但 gh 仅用于内部 issue 上报，非产品功能 |
| `Command::new("gh")` | 无命中 | —— |
| `spawnSync("gh"` | `Wox-launcher/Wox`、`louislam/uptime-kuma` 等 | 均为 CI/发布脚本 |
| `"gh.exe"` | `getpaseo/paseo`、`traycerai/traycer`、`dohooo/helmor`、`sybil-solutions/local-studio` | 多为 **agent 编排/开发环境**类窗口 App；`helmor`（1306★，Tauri）有 `src-tauri/src/forge/bundled.rs` 的 `gh_name` 逻辑，但 gh 用途偏 git/forge 辅助，**未逐条核实其主功能是否依赖 gh** |
| `"built on the GitHub CLI"` / `"wraps the GitHub CLI"` | 零命中 | 说明**没人用这个措辞自我描述**，这类项目只能靠读源码找 |

> 说明：code search 的 repo 结果是**子集**（GitHub 需索引且默认只搜默认分支），因此"未命中"不等于"不存在"。上面 §2 的 B 类判定全部基于**直接读取源码文件原文**，不依赖 code search。

---

## 6. 对照表：一张图看清"谁真的用 gh"

```
                     ┌───────────────────────────────────────────────┐
                     │         复用 gh 生态（登录态 / 扩展机制）      │
                     └───────────────────────────────────────────────┘
 A. gh 扩展（gh xxx 唤起）
    ├─ dlvhdr/gh-dash              TUI   (也 spawn gh)
    ├─ zoubingwu/gh-workbench      浏览器UI + TUI   ← 唯一的"扩展 + 图形界面"组合
    ├─ gitkraken/gh-gk             CLI（桥接商业 GUI）
    ├─ remcostoeten/gh-select       TUI
    ├─ samcoe/gh-repo-explore      TUI
    ├─ jackchuka/gh-dep            TUI
    ├─ uzimaru0000/gh-board        TUI
    ├─ chmouel/gh-news             TUI
    ├─ martinkersner/gh-zen        TUI
    └─ 2KAbhishek/gh-repo-man      TUI

 B. 自己 spawn/exec gh 二进制
    ├─ theBGuy/GitDesktop          ★窗口 GUI（Tauri）   + 直接读 hosts.yml（C）
    ├─ NigelBreslaw/slint-ui-…     ★窗口 GUI（Slint）
    ├─ matt-bat/github-cli-manager ★窗口 GUI（Electron）
    ├─ Amirhat/ChitHub             △窗口 GUI（部分功能）
    ├─ EronWright/gh-notifier      ★菜单栏 App（macOS）
    ├─ nickcernis/github-cli-ui    △VS Code 扩展 GUI
    ├─ matrujillo10/PREx           △浏览器 UI
    ├─ kitlangton/ghui             TUI
    ├─ pwntester/octo.nvim         编辑器 UI
    ├─ jonathanchu/magit-gh        Emacs 界面
    └─ jesseduffield/lazygit       TUI（仅取 token）

 C. 读 gh 配置但不调二进制 → 仅 GitDesktop 一家（同一项目内与 B 并存）

 D. 完全不用 gh（易被误认）★★★
    ├─ desktop/desktop（GitHub Desktop）  自有 OAuth app；#11655 标记 not-planned
    ├─ gitify-app/gitify                  Octokit + OAuth/PAT
    ├─ GitKraken Client / Fork            自有认证（GitKraken 另有 gh-gk 扩展做桥）
    └─ wiiiimm/gh-manager-cli             名字带 gh 但自带 OAuth，零 gh 调用
```

---

## 7. "未能查证"清单（不编造）

| 事项 | 状态 |
|---|---|
| `YasharImandar/ChitHub` fork | **未能查证** —— `repos/YasharImandar/ChitHub` 返回 HTTP 404，GitHub 搜索亦无该仓库 |
| GitHub Desktop 的 "community discussion 177763" 是否为官方讨论 | **未能查证为官方** —— 抓到内容为社区用户对"Desktop 与 gh 互不安装"的解释帖；`repos/desktop/desktop` 的 `has_discussions` 为 `false`，GraphQL 查 discussion #177763 报 NOT_FOUND（需确认该编号属于 `orgs/community` 还是无效） |
| Flathub / Snapcraft 上的 "gh CLI GUI" 包 | **未能查证到有效条目** |
| `dohooo/helmor`（1306★，Tauri）主功能是否依赖 gh | **未逐条核实** —— 仅确认其 `src-tauri/src/forge/bundled.rs` 有 `gh.exe` / `gh` 解析逻辑 |
| ChitHub 是否另有 GitHub REST 调用（除 `gh` 外） | **未查证** —— 未逐文件通读全部 Go 源码；其 GitHub 侧能力推测完全委托 `gh`（**推测**） |
| GitKraken Client / Fork 本体的网络层实现 | **未查证** —— 官网/帮助文档无 gh 相关表述；无开源代码可读，故保守归为 D |

---

## 8. 参考来源列表

**GitHub 官方文档 / 手册**

1. gh 扩展浏览（终端界面，非 GUI）：<https://cli.github.com/manual/gh_extension_browse>
2. GitHub CLI 官方扩展工具博客：<https://github.blog/developer-skills/github/new-github-cli-extension-tools/>
3. 预填 fine-grained PAT 参数 / 无创建 PAT API：<https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens>

**真·gh 客户端（B 类）源码/README**

4. GitDesktop README：<https://github.com/theBGuy/GitDesktop/blob/main/README.md>
5. GitDesktop `src-tauri/src/github/auth.rs`：<https://github.com/theBGuy/GitDesktop/blob/main/src-tauri/src/github/auth.rs>
6. GitDesktop `src-tauri/src/forge/session.rs`：<https://github.com/theBGuy/GitDesktop/blob/main/src-tauri/src/forge/session.rs>
7. slint-ui-for-github-cli README：<https://github.com/NigelBreslaw/slint-ui-for-github-cli/blob/main/README.md>
8. slint-ui `app/src/backend/gh/gh-cli-version.ts`：<https://github.com/NigelBreslaw/slint-ui-for-github-cli/blob/main/app/src/backend/gh/gh-cli-version.ts>
9. github-cli-manager README：<https://github.com/matt-bat/github-cli-manager/blob/main/README.md>
10. github-cli-manager `src/command-runner.js`：<https://github.com/matt-bat/github-cli-manager/blob/main/src/command-runner.js>
11. ChitHub README：<https://github.com/Amirhat/ChitHub/blob/main/README.md>
12. ChitHub `features.go`：<https://github.com/Amirhat/ChitHub/blob/main/features.go>
13. GH Notifier README：<https://github.com/EronWright/gh-notifier/blob/main/README.md>
14. GH Notifier `NotificationFetcher.swift`：<https://github.com/EronWright/gh-notifier/blob/main/Sources/GHNotifier/NotificationFetcher.swift>
15. GitHub CLI UI README：<https://github.com/nickcernis/github-cli-ui/blob/main/README.md>
16. GitHub CLI UI marketplace 页：<https://marketplace.visualstudio.com/items?itemName=NickCernis.github-cli-ui>
17. GitHub Workbench README：<https://github.com/zoubingwu/gh-workbench/blob/main/README.md>
18. PREx README：<https://github.com/matrujillo10/PREx/blob/main/README.md>
19. GitKraken gh-gk README：<https://github.com/gitkraken/gh-gk/blob/main/README.md>

**gh 扩展 / TUI**

20. gh-dash README：<https://github.com/dlvhdr/gh-dash/blob/main/README.md>
21. gh-dash `internal/tui/components/tasks/pr.go`：<https://github.com/dlvhdr/gh-dash/blob/main/internal/tui/components/tasks/pr.go>
22. ghui README：<https://github.com/kitlangton/ghui/blob/main/README.md>
23. ghui `src/services/GitHubService.ts`：<https://github.com/kitlangton/ghui/blob/main/src/services/GitHubService.ts>
24. octo.nvim README：<https://github.com/pwntester/octo.nvim/blob/main/README.md>
25. lazygit README：<https://github.com/jesseduffield/lazygit/blob/master/README.md>
26. lazygit `pkg/commands/git_commands/github.go`：<https://github.com/jesseduffield/lazygit/blob/master/pkg/commands/git_commands/github.go>
27. gh-select README：<https://github.com/remcostoeten/gh-select/blob/main/README.md>
28. gh-repo-explore README：<https://github.com/samcoe/gh-repo-explore/blob/main/README.md>
29. gh-dep README：<https://github.com/jackchuka/gh-dep/blob/main/README.md>
30. gh-board README：<https://github.com/uzimaru0000/gh-board/blob/main/README.md>
31. magit-gh `magit-gh-utils.el`：<https://github.com/jonathanchu/magit-gh/blob/main/magit-gh-utils.el>
32. awesome-gh-cli-extensions（kodepandai）：<https://github.com/kodepandai/awesome-gh-cli-extensions>

**明确不用 gh（D 类）**

33. GitHub Desktop OAuth 文档：<https://github.com/desktop/desktop/blob/development/docs/technical/oauth.md>
34. GitHub Desktop issue #11655（OPEN, not-planned）：<https://github.com/desktop/desktop/issues/11655>
35. GitHub Desktop issue #6533（CLOSED）：<https://github.com/desktop/desktop/issues/6533>
36. GitHub Desktop PR #18700 / #18773（MERGED，GCM 相关，与 gh 无关）：<https://github.com/desktop/desktop/pull/18700> · <https://github.com/desktop/desktop/pull/18773>
37. orgs/community discussion 177763：<https://github.com/orgs/community/discussions/177763>
38. Gitify README：<https://github.com/gitify-app/gitify/blob/main/README.md>
39. Gitify `package.json`（Octokit 依赖）：<https://github.com/gitify-app/gitify/blob/main/package.json>
40. GitKraken CLI 帮助文档：<https://help.gitkraken.com/cli/cli-home/>
41. Fork 官网：<https://git-fork.com/>
42. gh-manager-cli README：<https://github.com/wiiiimm/gh-manager-cli/blob/main/README.md>
43. gh-manager-cli `src/services/oauth.ts`：<https://github.com/wiiiimm/gh-manager-cli/blob/main/src/services/oauth.ts>
44. ghterm（GitHub 官方，已停维护，与 gh CLI 无关）：<https://github.com/github/ghterm>

---

## 9. 结论摘要

1. **窗口 GUI 且真正依赖 `gh` 的项目只有 4 个**：`theBGuy/GitDesktop`（Tauri，最彻底：spawn gh + 直接解析 `hosts.yml`）、`NigelBreslaw/slint-ui-for-github-cli`（Slint，纯 gh 封装但 0 star）、`matt-bat/github-cli-manager`（Electron，白名单 `["gh","git"]`）、`Amirhat/ChitHub`（Go + WebView，**仅部分功能**用 gh）。
2. **菜单栏 / IDE / 浏览器类**另有 4 个：`EronWright/gh-notifier`（macOS 菜单栏，执行 `/usr/bin/gh`）、`nickcernis/github-cli-ui`（VS Code，已停更 2.5 年）、`matrujillo10/PREx`（浏览器 UI）、`zoubingwu/gh-workbench`（**唯一的 gh 扩展 + 图形界面**）。
3. **gh 生态里的"图形前端"绝大多数是 TUI**（gh-dash 12554★、ghui 1118★、octo.nvim 3386★ 等）；awesome 列表与 GitHub 官方 gh 扩展中**没有任何原生窗口 GUI 应用**。
4. **GitHub Desktop 不用 gh，且官方立场是 `not-planned`**（issue #11655）；Gitify 用 Octokit + 自有 OAuth；GitKraken/Fork 用自有认证；`gh-manager-cli` 名字带 gh 但自带 OAuth、零 gh 调用。
5. **存在第三态**：GitDesktop 同时"调 gh 二进制"和"直接读 `~/.config/gh/hosts.yml` / `GH_TOKEN`"，这是复用登录态但不 spawn 进程的形态，判定时需要与"调二进制"区分。