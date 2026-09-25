# GithubStarManager — Agent Handoff

> 架构 / 模块职责 / 数据流 / 存储模型 / 约束以 **`DEVELOPER.md`** 为准（权威文档，勿在此重复）。
> 本文件只记录：**当前状态、待验证清单、仍生效的设计决策、调试要点**。
> 历史过程一律查 `git log`（提交信息本身写得很详细），本文件不写「上一轮改了什么」。

---

## 当前状态

版本 **4.7.0**（`package.json` 为单一版本源，`vite.config.ts` 读它写入脚本头）。

4.7.0 = **导入导出（标签 / 备注 / 相关仓库元数据）**，**尚未真机验证**：

- 纯逻辑 `src/storage/exportImport.ts`（不碰 DOM）+ 交互 `src/ui/exportImportMenu.ts`（TM 菜单「📤 导出数据」「📥 导入数据」）；
- 导出走 `GM_download`（**4.7.0 新增 `@grant`**，TM 会提示权限变更），**刻意不做原生 `<a download>` 兜底**（那等于绕过 TM 的扩展名安全设置）；导入走隐藏 `<input type="file">` + `FileReader`；
- 包格式与合并语义见 `docs/adr/0001-export-import-format.md`，术语见 `CONTEXT.md`；
- 纯逻辑已有 45 项 node 断言：`pnpm test:exportimport`（**全绿**，覆盖导出清洗 / 校验拒绝路径 / 合并 / 幂等 / 用户隔离）。

4.6.0 = 改名与存储身份切换（脚本名 → `GithubStarManager`、产物 `dist/github-star-manager.user.js`、镜像前缀 → `github-star-manager::`；`@namespace` 与 CSS 前缀 `gsm-` 不动）。**改名的代价**：TM 以 `@name` + `@namespace` 判定脚本身份，改名后是另一个脚本、GM 存储为空；镜像前缀同时更换 → 旧数据不自动迁移，按用户决定放弃（装回旧脚本可读旧 GM 存储）。见 `docs/adr/0002-rename-and-storage-identity.md`。

4.5.0「Hide Lists 开关」**已由用户真机验证通过**，其清单保留在下方仅作历史参考。

### 4.7.0 待真机验证清单（重装 `dist/github-star-manager.user.js` 后逐条走）

0. **先确认 TM 接受新增 `@grant GM_download`**（装新版时 TM 会提示权限变更）；控制台有 `[github-star-manager] script loaded (document-start)`。
1. **导出**：TM 菜单「📤 导出数据」→ 文件下载成功；文件名形如 `github-star-manager-<uid>-YYYY-MM-DD-HHmm.json`（本地时间）；打开确认**无 `github_pat`、无 `etags`**，`repoCache` 只含有标签或有备注的仓库。
2. **导出清洗**：包内备注无 trim 后为空的项；非空备注文本未被 trim（前导空格保留）。
3. **同账号往返**：加几个标签/改几条备注 → 导出 → 手动删掉这些标签/备注 → 导入 → `confirm` 摘要数量正确 → 数据恢复 + 结果提示 + **自动同步**。
4. **校验失败**：随便找个 JSON / 把 `schemaVersion` 改成 2 → `alert` 报原因，**不弹 confirm**、数据零变化。
5. **身份不符**：手改包内 `user.id` → 拒绝并提示双方 ID。
6. **空备注不覆盖**：文件里某仓库备注为空白、本地该仓库备注有内容 → 导入后本地备注仍在。
7. **非 Stars 页导入**（仓库详情页）：成功、**无导航**、无重渲染报错。
8. **无 token 导入**：提示跳过自动同步，**不弹 Token 输入框**。
9. **confirm 点取消** → 零写入（刷新后数据未变）。
10. **刷新/新标签页**后导入的数据仍在（GM 存储）。
11. **TM 白名单（重要前提）**：TM 的 `GM_download` 要求扩展名在白名单内，`.json` 是否在**默认**白名单未经确证 —— 若导出时「点了菜单却没文件」，检查 TM 设置（需 Advanced 模式）「下载」区把 `json` 加进去并确认下载功能已开启。**这类失败在脚本内不可观测**（TM 只走 `onerror`，`GM_download` 不抛错也不返回），所以**不会**弹「下载未能启动」；若你看到的是文件静默未出现，那就是它。这是 TM 侧限制，不是脚本缺陷。

### 4.5.0 已验证清单（历史参考，重装 `dist/github-star-manager.user.js` 后逐条走）

1. 默认（未动菜单）：行为与 4.4.0 完全一致 —— Lists 隐藏、banner 插在 Lists 槽位（**原生节点不销毁**）、网格正常。
2. TM 菜单出现「🙈 隐藏 Lists 区块（开）」；点击后立即：Lists 原生内容显示（标题行 + 空态「Create your first list」或 list 内容）、菜单标签变「（关）」、控制台一行 Hide Lists 切换日志。
3. 关闭状态下 F5 / `?tab=stars` 直载 / Turbo 进页：Lists 保持显示且**无闪隐**（若先显示再隐藏一瞬 = 门控前缀漏改，回报）。
4. 关闭状态触发初始化面板（TM 菜单清空 token，或无缓存进页）：banner 挂在**网格列顶**、Lists 内容原地保留；保存并同步成功后 banner 消失、Lists 仍在原位。
5. 关闭状态触发 Token 失效面板（401/403）：落位同 ④。
6. 再点菜单切回「开」：Lists 立即重新隐藏、标签变「（开）」，刷新后仍隐藏。
7. 4.4.0 行为不回归（Type/Language 多选筛选、筛选态分页、同步、搜索高亮）。
8. 面板存在时切换开关：面板**立即迁移**到新落位（关 = 网格列顶 / 开 = Lists 槽位），不刷新页面。
9. 菜单连点多次：菜单项恒为一个，标签「开/关」与 Lists 显隐同步（走 `options.id` 原地更新路径）。
10. **节点可逆性**：开态显示初始化面板 → 关态 → 槽位里 blankslate / list 内容应**原样复活**（不是空白）；再切开态、面板回来仍只一份。

> 若某条失败：先确认装的是新 dist（控制台有 `[github-star-manager] script loaded (document-start)`），再看 `DEVELOPER.md` §6「Hide Lists 开关」的两条腿（CSS 门控 + JS 标记）哪条没生效。

---

## 仍生效的设计决策

历史决策 D1（到货快照 diff）/ D2（双 404 逐条核对）/ D4（位移挂起）**已作废**——随 4.0.0 API 主模式与 4.0.10 死码清理整体删除，星状态真相改由整表 diff 权威判定。以下为现行决策。

**D3 · Token 双格式（两种都要支持）**

- classic `ghp_`：有效 token 即可读全部 `/user/starred*`；**涉及私有仓库须勾 `repo` scope** —— 无 scope 时「无权限的私有仓库 404」与「真 unstar 404」不可区分（已定案不做同源页面 fallback，抓页面太重），属已知局限。
- fine-grained `github_pat_`：账号权限 **Account permissions → Starring → Write**（Read 够读列表，但卡片星星按钮要 PUT/DELETE，故用 Write），仓库范围 **All repositories**。
- 配置入口：TM 菜单「⭐ 设置 GitHub Token」+ 横幅内联粘贴行 + 「快速获取 Token」预填深链（`expires_in=90`）。留空 = 清除 token 并立即重开配置面板。
- 权限表来源：<https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens>（“User permissions for Starring” 段列出全部 5 个 `/user/starred*` 端点）

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
- 交互：破坏性确认用 `window.confirm`、失败用 `window.alert`（**失败不弹 confirm**）；导入不导航，仅在「Stars 页且网格已存在」时重绘；导入后走 `runFullSync('button')` 同路径，**无 token 则提示跳过、不弹 Token 输入框**。
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
| 详情页 | `.BorderGrid` / `#repo-stars-counter-star` / `.starred form[action$="/unstar"]` | React + CSS-module；数据在 `script[data-target="react-app.embeddedData"]` → `payload.sidebarAbout`；star 按钮 `button[data-testid="star-button"]`，状态在 `aria-label` |
| 搜索框 | `input[name=q]`、`form[action$="tab=stars"]` | **未变**，原拦截逻辑仍有效 |
| Lists 标题行 | `.my-3…` + 内联隐藏即可 | `tmp-my-3…`，且 `.d-flex` 的 `!important` 压过内联 `display:none`，必须 `element.style.setProperty('display','none','important')` |

---

## 已知风险 / 待确认

1. **dev HMR 需浏览器放行 CSP**（见上「dev 模式三件事」第 2 条）。
2. **经典 token + 私有仓库**：无 `repo` scope 时同步可能把私有仓库误判 unstar（见 D3，已知局限）。
3. **TM 菜单标签不跨标签页同步**；窄视口下 frame-render 分支的 `hideListsSection()` 无 `isDesktop()` 门（既有行为，非缺陷主线）。

---

## 下一步

1. 用户真机验证上面的 **4.7.0 清单**（导入导出）；发现问题 → 另开修复提交并更新本文件清单。
2. 后续阶段（详见 `todo` 与 `DEVELOPER.md` §13）：GraphQL 分页调研、周期自动同步、非本人 star 页 `GET /users/{u}/starred` 接入、分页按钮可跳页。
3. 未消化的架构建议：单遍 facet 计算、响应式漏斗（见 `starmgr-arch-review-report.md`）。

## 快速构建约定

不跑 `tests/smoke/`（快速构建期），改完只 `pnpm check`，由用户在真实页面判断成功与否。

---

## 常用命令

```bash
pnpm check     # tsc --noEmit + build（改完必跑）
pnpm build     # → dist/github-star-manager.user.js
pnpm dev       # HMR，需先解决上面 CSP 那条；入口 http://127.0.0.1:5173/__vite-plugin-monkey.install.user.js
pnpm build && node scripts/verify-css.cjs   # 产物 CSS 与源 CSS 等价性
pnpm test:exportimport   # 导入导出纯逻辑 45 项断言（无需浏览器）
```

---

## 建议技能

- `agent-browser-cli`：真机 DOM 探查、注入验证、截图、受信任点击。
