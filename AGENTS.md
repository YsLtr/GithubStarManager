# GithubStarManager — Agent Handoff

> 架构 / 模块职责 / 数据流 / 存储模型 / 约束以 **`DEVELOPER.md`** 为准（权威文档，勿在此重复）。
> 本文件只记录：**当前状态、待验证清单、仍生效的设计决策、调试要点**。
> 历史过程一律查 `git log`（提交信息本身写得很详细），本文件不写「上一轮改了什么」。

---

## 当前状态

版本 **4.8.1**（`package.json` 为单一版本源，`vite.config.ts` 读它写入脚本头）。

> 交接时间：**2026-09-25 19:05 +0800**。

**仓库里有未实现的定案**：4.9.0 的设计已全部定案并写入 ADR，**代码尚未动**。动手前读这几份 ADR，不要重新发明：

- `docs/adr/0003-sync-report-and-restore.md` —— **变化简报 + 恢复**（通知栈样式与生命周期、简报口径、恢复必须打远端 PUT、失败分支只 `alert`、全局串行队列与 ≥1s 间隔、「撤销」vs「恢复」的用词分野、详情页不检测 star/unstar）。对应 `todo` 的「全量同步的变化提示」「快捷恢复 unstar」。
- `docs/adr/0004-write-requires-classic-pat.md` —— **只支持 classic token**。fine-grained PAT 先天写不了他人公开仓库（`403 Resource not accessible by personal access token`），GitHub App token 更被官方 OpenAPI 标 `enabledForGitHubApps: false`；快速创建入口改为 **classic PAT 深链**，检测到 `github_pat_` 前缀时不拒绝但必须提示缺陷。
- `docs/adr/0005-no-auto-sync-after-import.md` —— **导入后不自动同步**（推翻 `0001` 原段落，`0001` 已加指向说明）。

已先行落盘的两处：`CONTEXT.md` 新增「外部取关 / 恢复 / 变化简报 / classic token / fine-grained token」五个术语；`docs/adr/0004` 从 4.8.0 的版本改写为「只支持 classic token」。

4.9.0 的其余待实现点（ADR 未覆盖的实现选择）：同步有增删差异或可见元数据更新时 `applyFilters({ keepPage: true })` 重绘（自动来源需先判断「最近是否有用户交互」，有交互则改成可点击的「列表有 N 项变化」）；卡片星按钮纳入全局变异请求队列；队列中再次点击可撤销排队；TM 菜单「恢复 unstar」弹出可勾选的确认窗口（含每条剩余时长，24h 超期条目消失）。

**尚未提交**：`AGENTS.md` / `CONTEXT.md` / 三份新 ADR / `todo` 的本次改动（代码未动），见 git status。

---

## 仍生效的设计决策

历史决策 D1（到货快照 diff）/ D2（双 404 逐条核对）/ D4（位移挂起）**已作废**——随 4.0.0 API 主模式与 4.0.10 死码清理整体删除，星状态真相改由整表 diff 权威判定。以下为现行决策。

**D3 · Token（写路径只支持 classic token）**

- 写路径（卡片星按钮、恢复）**只按 classic PAT 设计**：fine-grained PAT 无法对「不属于本人、也不属于本人所属组织」的公开仓库加星/取消星（`403 Resource not accessible by personal access token`，官方原文「Only personal access tokens (classic) have write access for public repositories that are not owned by you…」），GitHub App token（`ghu_`/`ghs_`）被官方 OpenAPI 标 `enabledForGitHubApps: false`。OAuth app user token（`gho_`，或 `gh` CLI 的 token）走 **scope** 体系，与 classic PAT 同构，可用。
- **scope 取 `repo`**（非 `public_repo`）：`public_repo` 不覆盖私有仓库，会让私有仓库的 star 不出现在 `GET /user/starred` 里而被整表 diff 误判为外部取关。用 `repo` 消除该误判，代价是权限更大——刻意选择。
- **读路径不受限**：`GET /user/starred` 无 Additional permissions，fine-grained PAT 同步正常；脚本检测到 `github_pat_` 前缀时不拒绝配置，但在保存与写失败两处提示其缺陷，403 提示**不得**再让用户「检查 Starring 权限」。
- 配置入口：TM 菜单「⭐ 设置 GitHub Token」+ 横幅内联粘贴行 + 快速创建预填深链（**classic PAT**，<https://github.com/settings/tokens/new?scopes=repo&description=GithubStarManager>）。留空 = 清除 token 并立即重开配置面板。
- 权限事实来源：<https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens>、<https://docs.github.com/en/rest/activity/starring>、`docs/adr/0004-write-requires-classic-pat.md`（含 OAuth device flow 为何被否决）。
**D5 · 搜索口径**

- 自由文本只搜 **作者 / 仓库名 / 描述 / 标签 / 备注**；**语言不参与全文匹配**（否则 `ASC` 会子串命中 `JavaScript`），语言只走下拉筛选。
- 命中词以 `<mark class="gsm-search-hit">` 高亮（四字段、大小写不敏感、只包文本节点、跳过输入控件）。

**D6/D7 · 同步与数据权威（现行总则）**

- 有 PAT → API 主模式（全量缓存渲染 + 本地分页 + 本地筛选 + 纯 API 星星按钮）；无 PAT → 原生页 + `.gsm-setup-banner` 强推配置。
- **权威边界**：远端权威 = 星标成员关系 / star 时间 / 仓库元数据；本地权威 = 标签 / 备注（同步绝不写 tags/notes）。
- **完整性红线**：分页中断、解析失败、超 200 页上限、速率余量不足 → 整表放弃、不改任何数据（半张表会把未拉到的页全判 unstar）。
- 单遍条件扫描：全 304 → 免额度早退；部分 200 → 只有变化页带 body，304 页用本地缓存切片复原。

**D8 · 同步入口与界面表述**

- 手动同步 = **三个等价入口**：TM 菜单「🔄 立即全量同步」、横幅「立即同步」、标题行 Sync 按钮；一律经条件快筛后才决定是否整表。
- 界面与 TM 菜单**不出现** P2.5 / P4 / 核对 等开发阶段表述（仅控制台日志与代码注释保留）。
- GitHub **没有**创建个人 PAT 的 API，快捷获取永久只能靠预填 URL 深链（来源：<https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens>）。
- 预填参数表（Pre-filling fine-grained PAT details using URL parameters）同上一链接；组织级端点 `/orgs/{org}/personal-access-tokens` 是审批/撤销管理，**非创建**。

**D9 · 导入导出（4.7.0）**

- 导出包**只含本地权威数据 + 与之相关的派生数据**（有标签或有备注的仓库元数据）；**不含** `github_pat`、同步元数据（ETag 基线）、宽限期备份——理由见 `docs/adr/0001-export-import-format.md`。
- 合并语义：标签并集（本地在前）、备注以文件为准但**空备注不覆盖**本地非空备注、仓库元数据只补空缺。判空统一为 **trim 后为空**（`saveNote` 同步收紧）。
- 校验 `kind` + `schemaVersion` + `user.id` **三者齐备才放行**；`kind` 是协议身份、**永不随脚本改名变动**，文件名 slug 才随改名变。
- 交互：破坏性确认用 `window.confirm`、失败用 `window.alert`（**失败不弹 confirm**）；导入不导航，仅在「Stars 页且网格已存在」时重绘；**导入后不自动同步**（见 `docs/adr/0005-no-auto-sync-after-import.md`：数据落盘即完成，远端不存在的条目会在下次同步走外部取关管线）。
- 下载：**只用 `GM_download`（4.7.0 新增 `@grant`），不做原生兜底**——Blob + `<a download>` 能绕过 TM 的扩展名白名单，等于架空用户的安全设置，已明确否决。TM 侧「下载」未开或扩展名不在白名单时**不抛错、不返回、只走 `onerror`**（TM 文档：`GM_download` 返回 `{ abort }`，只有 `GM.download` 才是 promise），故这类失败在脚本内**不可观测**：`gmDownloadFile` 返回 true 也不代表文件已落地，只能由 alert 引导用户去 TM 设置（Advanced 模式）加 `json`。
- 分层铁律：`storage/exportImport.ts` 是**纯逻辑**（不碰 DOM、不弹对话框、不触发同步），交互全在 `ui/exportImportMenu.ts`。

---

## dev 模式必须知道的三件事

1. **dev 下 GM API 不可见**：dev 代码经动态 `import()` 跑在 `unsafeWindow` 作用域，该作用域没有 GM_api（[vite-plugin-monkey#35](https://github.com/lisonge/vite-plugin-monkey/issues/35)）。已用 `server.mountGmApi: true` 解决（仅 dev 生效，产物不变）。
2. **GitHub CSP 拦 dev loader**：`script-src` 白名单不含 `127.0.0.1`，dev loader 的动态 import 必被拒（`Failed to fetch dynamically imported module`），插件绕不过去。需装 CSP 放行扩展（只放 `github.com`）+ 允许 Local Network Access 弹窗。详见 `DEVELOPER.md` §2。
3. **两个脚本不能同时启用**：`transformStarsList()` 见到 `.stars-grid-container` 就早退，正式版先跑会让 dev 版「改了没反应」。开发时在 Tampermonkey 里禁用正式版。

---

## 真机调试要点

- **必须前台标签页**：Chrome 冻结后台标签后测量/交互/定时器全部失真（后台定时器被节流到 1 次/分钟）。CDP 受信任点击对后台标签**静默失效**，先 `Page.bringToFront`。
- **注入 dist 的工装坑**：`atob()` 直 `eval` 会把 bundle 内 UTF-8 字面量按 Latin-1 拆成乱码 —— 必须 `Uint8Array.from(atob(...), c => c.charCodeAt(0))` + `TextDecoder('utf-8')` 解码后再 eval。
- **幂等早退**：改 transform 逻辑前先 `Page.reload()`，否则 `.stars-grid-container` 幂等检查会提前返回。
- **清数据**：GM_setValue 与 localStorage 镜像**双清**（`gmGet` 迁移路径会自愈单边清理，只清一边看不出问题）。

```bash
# 真机注入（.diag/ 已在 .gitignore）
agent-browser-cli exec --tab <tabId> --file .diag/run-xxx.js
```

---

## DOM 变更对照（GitHub 2026 改版，改选择器前先看）

| 位置 | 旧 | 新 |
|---|---|---|
| stars 列表项 | `col-12…py-4.border-bottom` | `…tmp-py-4.border-bottom.color-border-muted` |
| repoId | `data-toggle-for` / `details-user-list-<id>` | `user-list-menu[data-repository-id]` |
| 原生筛选栏 | `.TableObject.border-bottom` + `mt-5` | flex 行 + `tmp-mt-5`，锚点 `#stars-language-filter-menu-button` |
| 详情页 | `.BorderGrid` / `#repo-stars-counter-star` / `.starred form[action$="/unstar"]` | React + CSS-module；star 按钮 `button[data-testid="star-button"]`，状态在 `aria-label`（4.8.0 起详情页**只读 star 状态**，不再提取元数据——原内嵌 JSON 提取已随 extract.ts 删除） |
| 搜索框 | `input[name=q]`、`form[action$="tab=stars"]` | **未变**，原拦截逻辑仍有效 |
| Lists 标题行 | `.my-3…` + 内联隐藏即可 | `tmp-my-3…`，且 `.d-flex` 的 `!important` 压过内联 `display:none`，必须 `element.style.setProperty('display','none','important')` |

---

## 已知风险 / 待确认

1. **dev HMR 需浏览器放行 CSP**（见上「dev 模式三件事」第 2 条）。
2. **经典 token + 私有仓库**：无 `repo` scope 时同步可能把私有仓库误判 unstar（见 D3，已知局限）。
3. **TM 菜单标签不跨标签页同步**；窄视口下 frame-render 分支的 `hideListsSection()` 无 `isDesktop()` 门（既有行为，非缺陷主线）。

---

## 下一步

1. **实现 4.9.0**（变化简报 + 恢复 + 只支持 classic token + 导入不自动同步）：设计见上文三份 ADR，代码未动。
2. 后续阶段（详见 `todo` 与 `DEVELOPER.md` §13）：GraphQL 分页调研、周期自动同步、非本人 star 页 `GET /users/{u}/starred` 接入、分页按钮可跳页。
3. 未消化的架构建议：单遍 facet 计算、响应式漏斗（见 `starmgr-arch-review-report.md`）。
4. fine-grained PAT 写他人公开仓库的能力缺口由 GitHub 控制（roadmap#600 已 NOT_PLANNED、#601 仍 OPEN）——将来若补齐，可回头放宽 `docs/adr/0004-write-requires-classic-pat.md`。

## 快速构建约定

不跑 `tests/smoke/`（快速构建期），改完只 `pnpm check`，由用户在真实页面判断成功与否。

---

## 常用命令

```bash
pnpm check     # tsc --noEmit + build（改完必跑）
pnpm build     # → dist/github-star-manager.user.js
pnpm dev       # HMR，需先解决上面 CSP 那条；入口 http://127.0.0.1:5173/__vite-plugin-monkey.install.user.js
pnpm build && node scripts/verify-css.cjs   # 产物 CSS 与源 CSS 等价性
pnpm test:exportimport   # 导入导出纯逻辑 51 项断言（无需浏览器）
```

---

## 建议技能

- `agent-browser-cli`：真机 DOM 探查、注入验证、截图、受信任点击。
