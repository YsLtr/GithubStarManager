# GithubStarManager — Agent Handoff

> **权威分工（本文件不重复它们的内容）**
> 架构 / 模块职责 / 数据流 / 存储模型 → **`DEVELOPER.md`**；历史过程 → **`git log`**；决策全文与依据 → **`docs/adr/0001`–`0013`**；实施计划与逐条验证 → **`docs/plans/`**（历史在 `archive/2026/`）；可复用的验证数字 / A/B 反证 → gbrain `people/me`。
> 本文件只留四样：**下一轮交接、当前状态、仍生效的硬口径、调试要点与下一步**。

---

## 本轮交接：4.20.1 —— 脚本重绘摘编辑器时，blur 不算用户提交

交接时间：**2026-10-22 11:45 +0800**；分支 `master`。是 4.20.0（D36）的收尾修正。

- **现象**（用户提问引出）：编辑中卡片被 unstar（`syncCardAfterStarChange(repoId, false)`）后，卡片确实变只读了，但**点一下又能在只读卡片上进编辑态**。
- **根因（推翻了 4.20.0 写进文档的那句「移除时补发的 blur 会被 `isConnected` 挡掉」）**：Chromium 在把聚焦元素**摘出 DOM 之前**就派发 `blur` —— 夹具三处独立探针一致：派发那一刻 `isConnected === true`、`parentNode` 非 null、`document.contains()` 为 true。于是从可编辑翻只读的那次重绘里，编辑器把 blur 当成用户提交：
  1. 草稿被写回**活区**（外部取关后活区该为空 ⇒ 孤儿数据，re-star 时被备份覆盖）；
  2. `commit` 末尾的 `renderNotes()` 又把「点击进编辑」的监听**重新绑上** ⇒ 只读卡片又能点开、又能写字 —— 正是用户看到的那一幕。
- **修法**：判据只能是「这次重绘是谁发起的」。`src/inlineEdit.ts` 新增 `suppressInlineCommit(fn)` / `isInlineCommitSuppressed()`（深度计数，同步作用域）；`ui/notes.ts`、`ui/tagFilter.ts`、`readonly.ts` 在清空容器处把自己包进去，由此产生的 blur 一律不算提交。两个编辑器另加 `finished` 一次性闸（同一次编辑只提交一次），标签的 `Escape` 先落闸再摘节点。
  **`commitInlineEditors()` 不做抑制** —— 销毁路径要的就是提交。
- **回归锁**：`tests/diag/assert-defer-rerender.js` 新增步骤 ⑦（编辑中点星 → 写桩 → 断言 `state=locked-pending`、`grace=草稿`、`live` 为空、`reopened=false`、`tagAdd=false`）。**反证**：撤掉 `notes.ts` / `readonly.ts` 的两处包裹重编重跑 ⇒ `live="unstar-…"` + `reopened=true` 两条变红，装回复绿。
- **验证**：两个守卫全绿（⑦ `unstar={"state":"locked-pending","grace":"unstar-…","live":null,"reopened":false,"tagAdd":false}`；`assert-keep-page.js` 无回归 `2/3 ▸ 2/3 ▸ 2/3 ▸ 1/1`）。另在 `own-unstar` 场景手验正常编辑路径未被抑制误伤：备注 blur 落盘、Escape 取消不落盘、标签 Enter 入库、标签 Escape 不落库。`pnpm check` 绿、dist **219.11 kB**、`@grant` 恰 5 项。
- **边界**：仍是 `file://` 夹具（真机复验只覆盖了挂起/兑现，没覆盖这一条）；网页端点写桩只到「HTTP 204 成功」这一层。

---

## 上一轮交接：4.20.0 —— 编辑会话期间挂起重绘（D36）

交接时间：**2026-10-22 10:40 +0800**；分支 `master`。

- **现象**（用户报告）：「刷新后重渲染页面会让用户从编辑（tag/note）状态退出并丢掉内容」。最典型的一条是**进页自动同步**：`transformAndReveal` 成功后 2s 发 `runFullSync('auto')`，任一可见元数据变化就重绘整张网格 —— 恰好落在「刚刷新完、正在改备注」的那几秒，且这条路径**没有任何用户手势**。
- **口径（用户裁定）**：采用**挂起重绘**（方案 C），并把旧的 D12「同步后立即重渲染，不问是否刷新」与 D12 补**整条删除**（避免两套口径冲突）。**不做**「重绘前 flush 提交」、**不做**「快照 + 重绘后重开编辑器」、不做 keyed 增量渲染（后者留作长期方向）。
- **根因（两条初判被实测推翻，务必照新口径记）**：
  1. Chromium 移除聚焦元素**会补发** `blur`（夹具 `premise_blurOnRemove=true`），但事件目标已在文档外 ⇒ `blur`/`focusout` **传播不到 document**。**第一版实现挂在 `focusout` 上，挂起后再也等不到「编辑结束」，网格永久停在旧画面** —— 夹具当场抓到。现改为 document **捕获**相位的 `blur`。
  2. 草稿不是「彻底丢」，而是「**屏上**丢、存储里可能已经写了」：分片在 `replaceChildren` **之前**按旧值建好，重绘其间的提交只写存储，此后没有第二次渲染。A/B 实测（关掉挂起门）：`stored: 'draft-y'`、`onCard: '添加备注…'`。
- **改动面**：`src/inlineEdit.ts`（新：`hasInlineEditor` / `mergeDraftIntoGraceBackup` / `commitInlineEditors`）、`src/filters.ts`（挂起槽 + 三个结束信号 + `deferApply` / `renderBrowsePageDeferred` / `cancelDeferredApply`）、`src/starCheck.ts`（正在编辑的卡不重画区域；外部取关先并备份再刷只读）、`src/ui/notes.ts` + `src/ui/tagFilter.ts`（提交加 `isConnected` 守卫）、`src/viewTeardown.ts` + `src/otherStarsView.ts`（撤挂起态 + 销毁前提交草稿）、`src/index.ts`（他人页导入后重绘改走 `renderBrowsePageDeferred`）。
- **回归守卫**（**生成器已入库**）：`tests/diag/gen-defer-rerender-harness.cjs`（70 仓库 / 3 页，内联当前 `dist`）→ `agent-browser-cli open --focus "file:///<repo>/.diag/defer-rerender-harness.html?tab=stars"` → `agent-browser-cli exec --tab <id> --file tests/diag/assert-defer-rerender.js`。断言链：编辑态成立 → **无手势**触发整表重绘后编辑框仍在/值不变/网格节点未被换/页码仍第 2 页 → blur 后挂起兑现一次且草稿落盘显示 → 全程网格子节点数从未为 0 → 收窄回滚前草稿已按失焦语义提交。**守卫自带两道环境保险**（收尾时补的）：内部 `until(fn, 3000)` 轮询代替固定短睡眠（后台标签页把 `setTimeout(60)` 钳到 661ms）、④ 的结束信号在 `blur` 没兑现时退到 document `keyup` 并把选择记进 `flushVia` —— 因此**看到红之前先回读 `premise_blurOnRemove` 与 `visibilityState`**，两者为 `false`/`hidden` 时是「标签页没有前台焦点」，不是实现坏了。
- **验证**：守卫全绿（`held={sameCardNode:true,stillEditing:true,value:'draft-…',focused:true,page:2/3}`、`flushed={rebuilt:true,noteShown:'draft-…',stored:'draft-…',editors:0}`、`teardown={saved:'teardown-…',gsmNodesLeft:0}`，`errors: []`）。**反证**：`deferApply` 改成 `if (true) return false;` 重编重跑 ⇒ 5 条断言当场变红（编辑框被摘、草稿 null、焦点丢、网格被重建），还原后复绿。既有 `assert-keep-page.js` 无回归（`2/3 ▸ 2/3 ▸ 2/3 ▸ 1/1`）。`pnpm check` 绿、dist **218.50 kB**、`@grant` 恰 5 项。
- **真机复验（收尾补做，已通过）**：真实 `github.com/YsLtr?tab=stars`（30 张真实卡片）上注入当前 `dist`，用**真实入口**触发整表重绘（点 `#stars-custom-dir-button` 的排序 handler，它调 `applyFilters()` 不传 `keepPage`）⇒ `held={sameCardNode:true,editor:true,value:'draft-real-…',focused:true}`、`flushed={rebuilt:true,editors:0,firstCard 已换}`、`emptyGridHits=0`、控制台各一条挂起与补跑。**零数据污染**：结束编辑用 `Escape`（`notes.ts` 的取消分支），事后回读 `stars_notes_*` / `stars_tags_*` 确认 `polluted=false`、条数不变 —— 真机验证必须这样收尾，否则会把测试草稿写进用户数据。**一处偏离**：注入时把 `matchMedia('(min-width: 768px)')` 答成 `true`（当时窗口只有 604px，按 D18 脚本会完全惰性）；被验证的是挂起/兑现逻辑，布局观感不在内。
- **边界**：真机上**没有**端到端复验「进页自动同步触发重绘」（需真 token + 一次会写远端的真同步）；单卡路径（`syncCardAfterStarChange` 正在编辑 / 外部取关并备份）无夹具覆盖（需真实网络判定外部取关）—— **4.20.1 已用写桩补上夹具步骤 ⑦，见下方本轮交接**。Turbo 换帧（用户点导航）不在保护范围：节点由 Turbo 删除，脚本收不到信号。
- 计划与逐条验证：`docs/plans/archive/2026/2026-10-22-defer-rerender-while-editing.md`；决策全文：`docs/adr/0013-defer-rerender-while-editing.md`。

---

## 上一轮交接：4.19.3 —— 内联 UI 主题从页面现场解析（issue #1）

交接时间：**2026-10-20 22:05 +0800**；分支 `master`。

- **现象与根因**（<https://github.com/YsLtr/GithubStarManager/issues/1>「恢复已取消的 star 弹出菜单暗黑模式不兼容」）：TM 菜单的三个内联 UI（恢复窗口 / 导入大窗 / 通知栈）把颜色写成 `var(--color-canvas-default, #fff)` 这一代变量 + 浅色兜底。GitHub 已把这代变量整体改名成 `--bgColor-*` / `--fgColor-*` / `--borderColor-*`；真机实测（暗色 stars 页）这批 `--color-*` 在 `:root` 上**全部为空**，于是每个 `var()` 都命中硬编码浅色 ⇒ 暗色主题下弹窗白底黑字。
- **口径（用户裁定）**：主题**从原始页面取，禁止自己写**。新增 `src/ui/theme.ts` 的 `resolveUiTheme()`：每次打开 UI 现场解析 —— ① 读页面真实存在的当前一代 token；② token 缺失时**采样 GitHub 原生节点**（`[role=dialog]` / `.Box` / `.btn` / `.Overlay-backdrop` / `.flash*`）的 computed style；③ 两者都取不到 ⇒ 该项留空、调用方**不写**该属性（继承页面），**不编颜色**。遮罩/投影/圆角一并改成页面 token（`--overlay-backdrop-bgColor` / `--shadow-floating-large` / `--borderRadius-*`）。
- **改动面**：`ui/theme.ts`（新）、`ui/restoreMenu.ts`、`ui/exportImportMenu.ts`、`ui/notifications.ts`（`KIND_STYLE` 拆成 `KIND_ICON` path 表 + `theme.notice[kind]`）。
- **回归守卫**：`scripts/verify-theme-tokens.cjs`（**已接入 `pnpm check`**）：禁止已删除的 `--color-(canvas|fg|border|btn|accent|…)` 旧名进入 `src/`，并禁止 `src/ui/` 出现颜色字面量（`#hex` / `rgb()` / `hsl()`）。决策全文见 `docs/adr/0012`，实施与踩坑记录见 `docs/plans/archive/2026/2026-10-20-inline-ui-dark-mode-theme.md`。
- **验证**（真实 <https://github.com/YsLtr?tab=stars> 页，`agent-browser-cli exec` 注入真实 `dist`，`.diag/` 内工装不入库）：暗色下修复前 `boxBg=rgb(255,255,255)` / `boxFg=rgb(31,35,40)`（白底黑字，复现 issue）；修复后 `boxBg=rgb(1,4,9)` / `boxFg=rgb(240,246,252)`，普通按钮 `rgb(33,40,48)`、主按钮 `rgb(35,134,54)`、checkbox accent `rgb(31,111,235)`、遮罩 `rgba(33,40,48,.4)`；同页强制切 light ⇒ 全部回到 `#fff` / `#f6f8fa` / `#0969da`。通知栈实测 info：暗色 `rgba(56,139,253,.1)` + 图标 `rgb(68,147,248)`，亮色 `rgb(221,244,255)` + `rgb(9,105,218)`。截图 `.diag/stars-{before,after}-dark.png` / `stars-after-light.png`。`pnpm check` 绿、dist 214.51 kB、`@grant` 恰 5 项。
- **边界**：`confirm()` / `alert()` 是浏览器原生对话框，主题由浏览器决定，脚本管不到（issue 若要「整窗一致」，需把它们换成页面内弹窗，属另一次决策）。降级路径（token 全缺 → 采样原生节点）未单独构造用例：把 token 置无效会同时打断 GitHub 自己的整页配色，测出来只是黑底，无判别力。
- **审查后加固**（四路代理 + 实机复测，逐条已修，详见计划文档末节）：跨弹窗**自采样**（两个弹窗的关闭函数只删各自遮罩 ⇒ 后开的会采到先开那个写进去的旧主题，issue #1 现象复活）→ `OWN_UI` 子树整棵跳过（两个弹窗 / 通知栈 / 两个横幅 / 标签筛选浮层 / 三个筛选浮层；判据 = 脚本自建**且**会命中 `NATIVE` 某个选择器）；`a[href]` 首个命中是**跳过导航链接**（实测 `rgb(255,255,255)`）→ 强调色改以 `.Link` 优先并排除它，`checked` **禁止**拿文本色兜（会造白勾压白面板）；**主按钮底/前景必须同域配对** —— 底退到 `btnBg` 时前景整个留空，否则只缺 `--button-primary-bgColor-rest` 就会白字压近白底（约 1.05:1，比 issue #1 更难发现，因为按钮看起来「没坏」只是读不出来）；`borderTopColor` 对无边框元素返回 `currentColor` → 采样前查 `border-style`；`sample()` 改**逐元素**推进；导入窗补 `color`（否则中途切主题 → 深底深字）；**语义色不能直接当底色**（暗色 `--bgColor-*-muted` / `-accent-muted` 的 token 原值是 8 位 hex，如 `#388bfd1a`=10%；压在亮色图上是浅字压浅底，旧实现不透明 ⇒ 那是对比度回退）→ 统一走 `theme.ts` 的 `tintOver(base, tint)`，**通知底与拖拽高亮两处都用它**；`canvas` 采样链末位补 `body`（页面画布色），使最差形态不是透明面板。**守卫改成「默认拒绝 + 白名单放行」**：名单式枚举必然漏（`topic-tag` / `diff-blob` / `select-menu` / `state` / `markdown` / `label` / `pr-state` / `avatar` / `alert` / `counter` / `tabnav` 共 11 个前缀都曾漏过，issue #1 的原始写法能原样过闸），白名单只保留实测仍活在 `:root` 上的 62 个变量所属的组（ansi / prettylights / marketing / project / workflow-card / …，全都没有弹窗配色用途）；另补 `#${` 模板拼接、常见具名色、`#0000`/`#fff8` 四位带 alpha 的十六进制，修掉 `--color-marketing-*` 与行尾注释 `#123` 的误报，注释剥离改成**引号感知**（`'a // b --color-x'` 不再假阴性、`'https://…'` 不再被切断），扫描后缀扩到 `.tsx/.js/.jsx/.mjs/.cjs`。

---

## 上一轮交接：4.19.1 —— 本地数据编辑保页码（D12 补）

交接时间：**2026-10-20 17:15 +0800**；分支 `master`。

- **现象与根因**：在第 N（N>1）页增删卡片标签后网格回到第 1 页。根因是 `src/ui/tagFilter.ts` 的删除与提交两个处理器调用 `applyFilters()` 未传 `keepPage`，走默认分支渲染第 1 页；违反既有不变式（`DEVELOPER.md` §7）。修复为两处改传 `applyFilters({ keepPage: true })`。
- **规范落点**：不变式写入 `docs/filters-sort-design-2026-09-23.md` §4.2；调用点名单原在 D12 补与 `DEVELOPER.md` §7 —— **D12 补已于 4.20.0 整条删除**，现行判据见 D36 与 `DEVELOPER.md` §7 的判据表。
- **回归守卫**：`tests/diag/assert-keep-page.js`（手工注入式，与 `tests/diag/selectors.js` 同约定，不随 `pnpm check` 运行）；生成器 `tests/diag/gen-keep-page-harness.cjs` **已入库**（70 仓库 / 3 页，内联当前 `dist`，产物写入被忽略的 `.diag/jump-harness.html`）。跑法：`pnpm build` → `node tests/diag/gen-keep-page-harness.cjs` → `agent-browser-cli open --focus "file:///<repo>/.diag/jump-harness.html?tab=stars"` → `agent-browser-cli exec --tab <id> --file tests/diag/assert-keep-page.js`。夹具开局清掉 `github-star-manager::` 前缀的全部 localStorage 镜像键，使 `src/gm.ts:66-68` 的镜像迁移不会把上次的 `probe-*` 标签带进本次运行。
- **验证**：守卫全绿（`page2=2/3`、`afterAdd=2/3`、`afterDelete=2/3`、`afterPillClick=1/1`、`cleanup=2/3`，`errors` 为空）；反证为撤掉两处修复重编重跑得到 `1/3`、首卡 `owner41/repo41 → owner27/repo27`。`pnpm check` 通过，dist 210.44 kB，`@grant` 恰 5 项。
- **边界**：`tests/smoke/` 不随快速构建期运行；真机 TM 复验未执行。守卫只在可见标签页可信（后台节流下 `setTimeout(60)` 实测 661ms）。
- **本轮审查**：四轮代理审查（static / tests / adversarial / real），末轮裁定不修复并接受 6 条残余风险，见「未决问题」。

---

## 当前状态

版本 **4.20.1**（`package.json` 是单一版本源，`vite.config.ts` 读它写脚本头）。

本轮落点 = 4.20.1（D36 的收尾修正：脚本重绘摘编辑器时 blur 不算用户提交）。版本演进与每轮改了什么查 `git log`，决策依据查 `docs/adr/`。
唯一需要跨版本记住的四条实测结论：
- **主题 token**：GitHub 的 `--color-*` 一代已整体改名（`--bgColor-*` / `--fgColor-*` / `--borderColor-*`）；真机暗色页实测旧名在 `:root` 上**全为空**。内联 UI 一律走 `ui/theme.ts` 的 `resolveUiTheme()`，**不写死颜色**（`scripts/verify-theme-tokens.cjs` 把关）。
- **事件在节点离场后不可用**：移除聚焦元素**会**派发 `blur`，但目标要么已在文档外（`blur`/`focusout` 都传播不到 `document`），要么——**4.20.1 实测，三次一致**——派发发生在**摘除之前**：那一刻 `isConnected` 仍是 `true`、`parentNode` 还在、`document.contains()` 也 true。两个后果都要记住：① 任何「靠 document 上的收尾事件兜住被删节点」的写法都会挂死 ⇒ 要挂在**捕获相位** `blur` 上，或者干脆别删（D36 的做法）；② **`isConnected` 挡不住「脚本重绘摘掉编辑器」** ⇒ 想区分「用户失焦」与「重绘副作用」只能靠发起方标志（`src/inlineEdit.ts` 的 `suppressInlineCommit()`）。
- **限流**（D1）：写入 = 1 点/请求、余量 15× ⇒ **不据此改 1000ms 默认值**（`docs/research-ratelimit-measurement.md`）。
- **网页写端点通道**已双向实测成立（`docs/research-web-star-endpoints.md` 附录 A）。

---

## 仍生效的硬口径

编号**不连续**（D13–D17 无定义，新增决策从 D22 起编）。每条只留最易踩的判据，全文与理由见 `docs/adr/`。

- **D3 · 写路径**：REST 只支持 classic PAT；拿不到时走网页端点通道，`setStarState()` **静默分派但不静默失败**。scope 取 `repo`（`public_repo` 会漏私有仓库而被整表 diff 误判取关）。403 提示**不得**指向「Starring 权限」。
- **D5 · 搜索**：自由文本只搜 作者 / 仓库名 / 描述 / 标签 / 备注；**语言不参与全文匹配**。
- **D6/D7 · 数据权威**：`hasApiData()`（有 `lastFullSyncAt` 且 `count > 0`，与有无 token 无关）⇒ 网格主模式。远端权威 = 成员关系 / 时间 / 元数据；本地权威 = 标签 / 备注（同步绝不写）。**完整性红线**：分页中断 / 解析失败 / 超 200 页 / 速率余量不足 ⇒ 整表放弃。**恢复必须打远端**（只本地回滚会造出「本地有星、远端无星」）。
- **D8 · 同步入口**：TM 菜单与标题行 Sync 按钮等价；界面不出现开发阶段表述。GitHub 无创建 PAT 的 API。
- **D9 · 导入导出**：导出只含本地权威数据 + `repoNames`；下载**只用 `GM_download`**。`storage/exportImport.ts` 是**纯逻辑**（不碰 DOM、不弹框、不触发同步），交互全在 `ui/exportImportMenu.ts`。
- **D10 · 变异队列**：**串行是硬要求、1s 是建议间隔**；卡片星按钮与恢复共用同一队列；点击 → 乐观翻转 → 入队；排队中再点 = 撤销；`.then` 里必须做 handle 身份校验；**不自动重试**；失败文案不暴露通道。
- **D11 · 通知栈**：容器常挂 `document.body`；观感 = GitHub `.flash` 族（**不要**用 Primer `Toast`）。**DOM 顺序铁律**：动作按钮必须在 `box.append(icon, label)` **之后**追加。
- **D12 · ~~同步后立即重渲染~~**：**整条已删除**（4.20.0）。原文「`changed > 0` 且在网格 ⇒ 直接 `applyFilters({keepPage: true})`，不问『是否刷新』」与 D36 直接冲突（D36 要求编辑会话期间挂起）。其中的**唯一仍生效的部分**「重绘期间网格不得出现空态」已并入 D36。原「D12 只适用于本方自己的 stars 页」一条随他人页不跑自动同步而失去对象。
- **D12 补 · ~~页码保持的不变式~~**：**整条已删除**（4.20.0），内容并入 D36 的第三条。
- **D18 · 窄视口（<768px）完全惰性**：语义 = 「脚本没装过」（不注入样式、不建节点、不改 DOM、不弹 UI、不发进页自动同步）。CSS 会自动失效、**JS 不会** ⇒ 门必须开在注入之前（`transformAndReveal()` 首行）；**挂在原生节点上的监听也是写入**，必须由 `lifecycle` 持有并在 teardown 解绑。**TM 菜单项在任何视口都注册**。
- **D19 · 断点单一真相**：只用 `matchMedia('(min-width: 768px)')`（`utils.isDesktop()`），**禁止** `window.innerWidth`；跨断点实时双向切换（150ms debounce）。
- **D20 · 回滚**：`src/viewTeardown.ts` 是唯一回滚点、幂等，只认脚本自有 class 与两类 `data-gsm-*` 标记；**隐藏原生节点必须同时打标记属性**（判据与属性名见 `DEVELOPER.md`）。「隐藏 Lists」属页面级偏好，离开 Stars 去别的 profile 标签时必须原样保留，只在窄视口清干净。
- **D21 · 清理与权限**：没有实测/文档证明救回过场景的兜底就删（原地留一句「曾用过什么」）。**`@grant` 只剩 5 项**（TM 能力徽标按声明的 `@grant` 生成，不做调用分析）。
- **D22 · 分页可跳页**：`N / M` 是 `<button>`，点击后在**同一单元格内原位**换 `<input>`（不做浮层：顶部是 `cloneNode` 克隆件，Popover 超出 `cssTarget=safari15`）。交互走 window-capture 委托（`cloneNode` **不复制事件监听**）。输入类型、宽度实测值、失焦延后一拍等实现细节见 `DEVELOPER.md`。
- **D23 · 同步状态单一真相**：入口多处、状态一处（`fullSync.ts` 的 `SyncState`）、视图一处。**按钮 DOM 形状与文字恒定**，只切 `aria-busy`/`aria-disabled`/`title`（换形状会丢焦点）。**挂载即对齐**；订阅必须显式注销。
- **D24 · 窄视口通知**：门开在 `notifications.ensureContainer()`；绕过 `pushNotice` 直接建节点的路径不受保护。
- **D25 · Token 归属校验**：比对键 = **数字 ID**（`octolytics-actor-id` **登录者** vs `GET /user` 的 `id`；**不取** `octolytics-dimension-user_id`）。只在「有 token + 有登录会话 + 两侧 id 都取到」时判定，其余一律 `unknown`；**只告警不阻断**。UI = `div.gsm-account-banner`（**不复用** `.gsm-setup-banner`）。求值点全部 fire-and-forget；**异步返回后必须复判世代 + 视口**。横幅上**不放**深链按钮。
- **D26 · 他人 star 页零网络**：数据只来自页面**已渲染**原生条目的一次投影（`src/domRepos.ts`）。必须同时关掉语言色拉取（否则色表未命中会间接发 linguist 请求，零网络断言必挂）。只藏原生条目、**不动**原生分页器与筛选栏。**布局接管只认 `gsm-stars-layout` 标记**（登出页有两个 `.Layout`）；尺寸规则认标记、过渡规则不认。`viewContext` 是模块态 ⇒ 回自己页必须复位。
- **D29 · 他人页逐仓库可编辑**：三态判定**只在** `src/cardState.ts`；可编辑性**只认「已提交」状态**。**唯一分派入口** `src/cardAreas.ts` 的 `renderCardTagAndNoteAreas()` —— **禁止**再出现第二处 `readOnly ? A : B`（两处判据不一致就是该缺陷本身）。前置 = `hasApiData() && getViewerId()`，缺则全部只读（**宁缺勿假**）。只读卡片不渲染任何编辑控件。
- **D30 · 迁移代码已整批删除**：前提 = **开发阶段 / 不存在任何已有用户**（2026-10-04 裁定）。**刻意保留**：`gm.ts` 的 localStorage → GM 回写（服务环境转移）、`SENSITIVE_KEYS` 的永久拒镜像半。
- **D31 · 本人页只读显示 = 二态**：`getOwnPageCardState(repoId)`；`readCardDisplayData()` 接受已算好的 state、只负责取数。本人页不引入 `locked-empty`（依赖无官方契约的页面 meta）；`editable` 时活区为空**不许**读备份。卡片状态属性两态都写、两个视图都写。
- **D32 · 导入导出改版**：导出**去掉** `data.repoCache`（旧包照旧校验、内容一律忽略）。导入按 `stars_repo_cache` 成员关系分派 —— ⚠️ **判据不许再带 `hasApiData()`**。胜负规则：**归一化后非空 ⇒ 覆盖；为空 / 缺省 ⇒ 保留**（标签与备注；**`name` 相反 —— 已有名字优先**）。归一化在分派之前只做一次，单条标签文本本身不 trim。`repoNames` 只作名称提示：**查不到就不写**、绝不写进缓存、**空不覆盖非空**。其余细则见 `DEVELOPER.md` §7。
- **D33 · 归属账号 = token 账号**（改写 D27）：取 `GET /user` 的 `id`，取不到才回退登录者，两者皆空 ⇒ **读空表 / 写 no-op + console warn**，**仍不回落**无隔离旧键。四条不可动的形状：① **身份在保存 token 时确定**，顺序钉死「先写身份缓存 → 再落库 token」；401 拒绝保存，网络/5xx/429/**403** **仍保存**（**不得**改成「查不到就拒绝保存」，那是把网络抖动变成「token 没存上」）。② **宽限期备份必须键分区**。③ **两个面不许混**：数据面 = 归属谁；成员关系/可编辑性面 = 浏览器里有没有「我」。④ **配置面板的空输入不清除 token**（「留空 = 清除」只在 TM 菜单那条 prompt 里）。披露只用既有归属横幅（**不新增任何 UI**，用户裁定）：「归档 chip」方案已被显著否定，别再提议。已接受代价：关掉横幅后页面再无归属痕迹；`stars_repo_cache` 仍不分区（风险 14），只落了 `full_sync_meta.accountId`（**只写不判**）。求值点、关闭态键、三道门等细则见 `docs/adr/0010`。
- **D34 · API 目标 ID 优先**：寻址全链路保留数字 ID；`/repositories/{id}` 解析当前全名，ID 404 才可名称查找且必须核验同 ID。星标继续用名称端点（数字候选实测失败）。Cookie 路径用同 ID 原生行 + 精确表单确认目标。元数据 404 ≠ 已取关；限流/401 整轮放弃。细则见 `docs/adr/0011`。
- **D35 · 内联 UI 配色只从页面取**（issue #1）：TM 菜单的内联 UI（`ui/restoreMenu.ts` / `ui/exportImportMenu.ts` / `ui/notifications.ts`）**不许出现任何颜色字面量，也不许引用 `--color-*` 旧一代变量**。一律 `resolveUiTheme()` 现场解析（token → 采样原生节点 → 取不到就**不写该属性**）。判据由 `scripts/verify-theme-tokens.cjs` 在 `pnpm check` 里把关；新增内联 UI 时把新 token 加进 `UiTheme`，不要就地写 `#hex`。`confirm`/`alert` 是浏览器原生对话框，不在本约束内（脚本改不了）。
- **D36 · 编辑会话期间挂起重绘**（4.20.0；4.20.1 补第四条，取代 D12 与 D12 补）：卡片里存在未提交的编辑会话（`.stars-card-notes-edit` / `.stars-tag-input`，判据只在 `src/inlineEdit.ts` 的 `hasInlineEditor()`）⇒ **整条 `applyFilters` 挂起**（不碰任何 DOM，避免「控件刷了、网格没换」的半应用态），编辑结束后补跑一次。**不做**抢救式提交、**不做**快照重开。三条不可动的形状：① **结束信号挂在 document 捕获相位的 `blur`**（不是 `focusout`）—— 提交处理器就地摘节点，摘掉后 `focusout` 目标已在文档外、传播不到 document，靠它收尾会让挂起永久挂死；另配 `keyup` 与 `pointerup`/窗口失焦。② **重绘期间网格不得出现空态**：`renderBrowsePage` 是唯一拆建点，必须分片建好再一次 `replaceChildren`。③ **页码保持**：重绘不改变筛选条件时调用方必须显式传 `applyFilters({ keepPage: true })`（遗漏的表现 = 在第 N 页操作后回第 1 页）；筛选/排序条件变更**不传**，回第 1 页属预期；越界由 `renderBrowsePage` 夹取。挂起槽单例、合并规则「任一方要求回第 1 页则以它为准」。**新增直调 `renderBrowsePage` 的入口必须先确认自己不可能发生在编辑会话期间**；他人页走 `renderBrowsePageDeferred`。销毁路径（`viewTeardown` / `exitOtherStarsView`）必须 `cancelDeferredApply()` 并 `commitInlineEditors()`。唯一例外是**外部取关**：卡片将转只读，草稿改由 `mergeDraftIntoGraceBackup()` 并入宽限期备份，编辑器的 `isConnected` 守卫保证落盘不写进活区。④ **脚本自己发起的重绘不算用户提交**（4.20.1）：Chromium 在**摘除之前**就派发 blur（`isConnected` 仍为 true），所以 `ui/notes.ts` / `ui/tagFilter.ts` / `readonly.ts` 清空容器处必须包 `suppressInlineCommit()`，否则草稿写回活区、且 `commit` 里的 `renderNotes()` 会把编辑监听重新绑上 ⇒ 只读卡片又能点开编辑框。`commitInlineEditors()` 相反，**不做**抑制。第三条的完整判据是一张表（哪种重绘传 `keepPage`），见 `DEVELOPER.md` §7 —— 4.20.0 起不再有「前件包含排序、后句又排除排序」的自相矛盾。

---

## dev 模式必须知道的四件事

1. **dev 下 GM API 不可见**：dev 代码经动态 `import()` 跑在 `unsafeWindow` 作用域，无 GM_api。已用 `server.mountGmApi: true` 解决（仅 dev，产物不变）。
2. **GitHub CSP 拦 dev loader**：`script-src` 白名单不含 `127.0.0.1`，需装 CSP 放行扩展 + 允许 Local Network Access（见 `DEVELOPER.md` §2）。
3. **两个脚本不能同时启用**：正式版先跑会让 dev 版「改了没反应」。
4. **改过脚本头（`@version` 最常触发）后必须重新安装 dev loader** —— 否则 TM 菜单整体消失。机制：`mountGmApi` 靠**由头注释算出的 key**（`md5(头注释).base64url[0:16]`）在两侧传窗口。表现是「TM 菜单空了」**且**「同步说未配置 token」。修：重开 <http://127.0.0.1:5173/__vite-plugin-monkey.install.user.js> 让 TM 原地更新。

---

## 真机调试要点（只留最贵的坑）

- **验证页要选用户真正会用的那一页**：TM 菜单的内联 UI 虽然能在任意 github.com 页面打开，但它实际被点开的地方是 `https://github.com/<me>?tab=stars`（那里同时有脚本接管后的网格与弹窗）。在 issue 详情页验证，主题**结论不受影响**（token 与原生节点采样全站同源），但「真实使用场景下对不对」不成立 —— 我这一轮就先在 issue 页测、被用户纠正过。
- **别新开一堆标签页**：复用已在的 stars 页（`agent-browser-cli tabs` 找一个 connected 的 id）。反复 `open` 同一 URL 会留下一串同标题页面，且新页可能立刻 `未连接`。
- **必须前台标签页**：后台标签的测量/交互/定时器全部失真（定时器节流到 1 次/分钟，CDP 受信任点击静默失效）。先 `{"method":"Page.bringToFront","params":{},"allowFocus":true}`（`allowFocus` 是 **`method` 的同级参数**），每次量测前回读 `document.visibilityState`。
- **冻结标签页会给出过期 `computedStyle`**：判据 —— **「连 inline `!important` 都改不动 computed 值」= 标签页被冻结**。可靠做法是 `agent-browser-cli open --focus <url>` 新开一页并确认 `visibilityState === 'visible'`。过渡冻结则先 `document.getAnimations().forEach(a => { try { a.finish(); } catch {} })` 再读。
- **`agent-browser-cli` 的 `tab_id` 不可信**：只用 `agent-browser-cli tabs` 按 URL **靠前的片段**（如 `.diag/`）找 id —— 它把 URL 截断到约 65 字符。`open` 返回的 id 可能立刻失效（`会话ID … 未连接`），此时重列 `tabs` 换一个 connected 的 id。
- **`screenshot --out` 必须给绝对路径**：给相对路径时它按**守护进程自己的工作目录**解析，会打印 `status: success` + `path`，但文件不在仓库里 —— `Test-Path` 一定要复核，别只信返回 JSON。
- **夹具 URL 必须带 `?tab=stars`**，否则脚本不转换，`grid: 0` 会被**误读成全绿**。改 `src/` 后必须重跑生成器（夹具内联 dist）。场景数以 `grep -o "scenario === '[a-z-]*'"` 为准，别在此维护数量。
- **批量跑夹具的三道门**：① 场景名必须在生成器里有对应分支；② 回读 `window.__gsmScenario` + `location.hash`（`open` 经 `python subprocess` 会丢 `&scenario=X`，静默退化成 `own`）；③ 按 `title` 精确匹配标签页，**禁止 `tail -1`**。`fail` 计数也含 NO TAB / 场景不符 / 解析失败。**改工装后先用探针确认夹具活着**：**场景不生效的表现是「断言全绿」**。
- **未提交改动做破坏性 A/B 时禁止 `git checkout -- <file>` 还原**：`cp` 到 `.pi/tmp/` → 改 `src/` → 跑 → `cp` 还原 → 核对 `git diff --stat` 与实验前一致。
- **清数据要「双清」**：GM_setValue 与 localStorage 镜像（`gmGet` 的迁移路径会自愈单边清理）。

### DOM 变更对照（GitHub 2026 改版，改选择器前先看）

| 位置 | 要点 |
|---|---|
| stars 列表项 | 类里有 `d-block` ⇒ `.d-block{display:block!important}` 压过内联 `display:none`（逐条隐藏必须 `setProperty(...,'important')`） |
| repoId | `user-list-menu[data-repository-id]`；**登出页没有它** ⇒ 退回仓库全名 |
| 原生筛选栏 | 锚点 `#stars-language-filter-menu-button`；上边距在包装节点上（克隆件需抄计算外边距） |
| 详情页 | React + CSS-module；4.9.0 起脚本**完全不碰**详情页 |
| 网页写端点 | **精确**匹配 `form[action="/{o}/{r}/star"]`（`action$="/star"` 不会误命中 `/unstar`） |
| 他人页星标状态 | `div.starring-container` 是否有类 `on`；**`aria-label`/按钮文字/两表单都不能判**（两表单永远并存，靠 CSS 显隐） |
| stars 页骨架 | **两代并存**：旧代 `#user-starred-repos > .col-lg-9` + `.col-lg-3`；新代 `> .col-lg-12`（无 topics 列）⇒ 选择器必须有退路 |
| 条目内部 | 标题 `div.d-inline-block.mb-1 h3 a[href]`、描述 `div.py-1`、元信息 `div.f6.color-fg-muted.mt-2`（按**直接子节点**取） |
| 「时间」语义 | `?tab=stars` 是 `Updated`、`/stars/{login}` 是 `Starred` ⇒ 读 `relative-time` 前一个文本节点分派 |
| URL 形态 | 另有 `/stars`（本人新版）与 `/stars/{login}`（200，**缺** `octolytics-dimension-user_id`）；`/{login}/stars` 是 404。`?page=N` 被**忽略**，真实翻页是 `after=`/`before=` 游标 |

---

## 已知风险 / 未决问题

- **D36 的四条已接受残余**（4.20.0 / 4.20.1 裁定，不修）：① 编辑框挂着不动（用户把窗口丢在那儿）时挂起不自愈，网格停在旧画面直到下次失焦/按键；② Turbo 自己换掉整帧（点导航链接）时节点由 Turbo 删除，脚本收不到信号 —— 鼠标点击会先失焦提交，键盘导航（如 Alt+←）例外；③ 判据是「页面上有编辑器」这一 DOM 事实，**新增第五种卡片内联编辑控件时必须把类名加进 `src/inlineEdit.ts`**，否则它不受保护；④ 分页器的页码输入框**有意排除**（该节点被整体搬进分片、重绘后原样带回）；⑤ 第五种内联编辑器若直接改 `innerHTML` 而不经 `suppressInlineCommit()`，会重演 4.20.1 那个缺陷。
- **未决问题（4.19.1 审查裁定不修复，逐条接受）**：
  ① ~~`DEVELOPER.md` §7 前件「筛选条件未变的重绘」字面上包含**仅改排序**的重绘，与同段「排序条件的变更不传」矛盾~~ —— **4.20.0 已修**：§7 换成一张「哪种重绘传 `keepPage`」的表，前件不再包含排序（`src/filters.ts` 的排序 handler 确实不传）。
  ② 守卫缺起点断言：`tests/diag/assert-keep-page.js` 只把起点首卡与标签写进 `steps`，不写 `errors`；向 localStorage 镜像注入 `probe-leak` 后重载，起点读数异常而 `errors` 仍为空 ⇒「夹具封闭」这一性质无断言守护。
  ③ 夹具镜像清理按前缀全清，含 `stars_lang_colors`（`src/constants.ts:45`，不在 `SENSITIVE_KEYS` 内），每次运行会令 `src/langColors.ts:39` 缓存未命中并触发一次 linguist 请求。④ 该清理失败被 `catch {}` 静默吞掉，无 console 痕迹。
  ⑤ `tests/smoke/fixture.html` 自带的 GM stub 块在生成器注入 head 覆盖后成为死代码（既有问题）。⑥ `assert-keep-page.js` 那条守卫的结论仍只在 `file://` 夹具上（D36 那条已在真机复验，见「本轮交接」）。
- **dev HMR 需浏览器放行 CSP**。**classic token + 私有仓库**：无 `repo` scope 时可能把私有仓库误判 unstar（D3）。
- **`GitHub-Verified-Fetch: true` 是玻璃地板**：无文档无契约（公开来源仅 2 次观测），GitHub 随时可收紧 ⇒ 只作观察项。
- **既有变异请求没有显式 deadline**：可能长时间占用串行队列（元数据读取已覆盖 20 秒超时）。
- **网页通道均无法靠原生表单复核方向**（两种表单同时存在），只能以 HTTP 成功为准。
- **TM 菜单标签不跨标签页同步**；**老版 TM（< 5.0）下「隐藏 Lists」菜单项会累积重复**（功能不受影响）。
- **一键批量恢复会代发请求**，落在 AUP §4 的邻域（缓解 = 严格串行 ≥1s + 进度可见 + 可取消 + 确认弹窗）。「写通道不向用户披露」与 RDA §4(v) 的偏差记在 `docs/adr/0006`。
- **通知栈无条数上限**。**底部份页器提交后焦点会掉到 `BODY`**（有意留下）。（原「兜底颜色是浅色硬编码」已由 4.19.3 的 D35 消除：取不到就留空、不再兜浅色。**注意**：留空的真实后果不是「继承页面」—— `background` 不可继承；`canvas` 有 `body` 画布色兜底所以最差是「页面色的实心面板」，其余字段留空则是透明 + `currentColor` 描边，且遮罩仍拦点击。）
- **D35 的四条已接受残留**（4.19.3 审查裁定，不修）：① `confirm()` / `alert()` 是浏览器原生对话框，亮系统 + 暗页面时流程中途仍会弹白框；② 弹窗配色是**打开那一刻的快照**，批量恢复（≥1s/条，可开几分钟）期间切主题不会跟随；③ 通知是**每条各自解析**，两条通知之间切主题会让栈里出现两种底色（有意选「各自正确」而非「整栈一致」）；④ GitHub 原生 `<dialog showModal>`（如 cmd-K）在 top layer，会把脚本的 `zIndex:9999` 遮罩压在下面且不在其焦点/inert 作用域内 —— 任何 z-index 都赢不了。另：采样依赖 `.Box` / `.btn` / `.Link` 等无官方契约的类名，GitHub 改版时降级方向是「取不到就不写」。
- **归属校验与登录者回退都依赖无官方契约的页面 meta**（`octolytics-actor-id` / `user-login`）：被改名时归属校验**静默失效**（判 `unknown`，有意的降级方向），`getStorageUserId()` 的回退支路也失效。已确认过身份的 token 用户不受影响（走指纹缓存），但 `saved-unverified` 那一支仍依赖 meta。**GHES / SAML SSO 下行为未确证**。
- **归属解析的「快照窗口」**：任何「有 token 但指纹缓存无该凭证」的状态都会在会话首次 `getStorageUserId()` 把归属快照在登录者上、整会话不翻转（有意的取舍）；「身份冷缓存时导出、缓存变热后导入」还会被归属校验拒绝。
- **夹具的非空转守卫**：分区键一改名，夹具若仍种在旧键上会让断言「因读空而全绿」（批量脚本只看 `_errors`）。已为 `other-editstate` / `own-unstar` / `other-logout-pending` 加守卫并把结论折进 `_errors` —— 再改分区键时先确认这三组。
- **关掉归属横幅后，页面上再无「数据属于哪个账号」的痕迹**（不加新 UI 的必然代价）：任一侧身份变化即重新武装。
- **细粒度 token 调 `GET /user` 的文档位置很偏**（在端点页的 fine-grained 折叠小节里）：复读请用原始 HTML 取证。
- **「无 token + 有登录会话」组合不做归属校验**（有意收窄）⇒ 属**风险 14**。`stars_full_sync_meta` 已记 `accountId`（只写不判），做告警时才用它判定。
- **他人页网格的真实局限**（设计属性，非缺陷）：① 可编辑性依赖本人整表缓存时效；② 徽章只在我有数据时出现；③ 只有本页数据，无跨页筛选/搜索；④ DOM 里没有的字段即降级；⑤ `viewContext` 模块态必须复位；⑥ 依赖 GitHub 条目结构，改版即退化为「不接管」；⑦ 呈现层接管了页面框架，功能层未接管；⑧ GitHub 有**三套并存**的 stars 骨架 ⇒ 选择器必须有退路。
- **他人页两条已登记未修**（4.14.0）：① 逐卡约 5 次 `GM_getValue`（30 条约 150+ 次同步 IPC）；② 原 D12「同步后立即重渲染」在他人页不生效 —— 该条已删除（4.20.0），他人页本就**不跑自动同步**，现状是「他人页只在导入后重绘一次，且走 `renderBrowsePageDeferred`」。
- **布局接管的两点残留**：① `.container-xl{max-width:1600px}` 是布局祖先，登出页页头容器也会被加宽（纯宽度）；② `/stars/{login}` 上没有 `.Layout` ⇒ 从不进入三栏接管。
- **本人页 unstar 后的只读态是「临时显示态」**：下一次整页重绘即消失；有激活筛选/搜索时是「立即消失」。已被裁定为预期，不为此把宽限期条目注入 `queryRepos()`。

---

## 下一步

1. **升级 4.20.1 后，用 dev 脚本的人必须重装 dev loader**（机制见「dev 模式」第 4 条）；正式版不受影响。
2. **D36 的剩余真机确认**：挂起/兑现本身已在真机通过（见「本轮交接」），还差**进页自动同步**这一条真实触发源 —— 刷新 `github.com/<me>?tab=stars` 后 2s 内打开某张卡的备注编辑框并打字，看编辑框是否仍在、字还在；点别处后网格补跑一次、备注已落盘。控制台应各有一条「卡片正在编辑：本次重绘推迟到编辑结束后（D36）」与「编辑已结束：补跑挂起的重绘（D36）」。
3. **风险 21 的真机确认**：换一份属于另一个账号的 token ⇒ 横幅应点名两个账号并含归属句；错号期间的标签落在 token 账号命名空间；关掉横幅后换 token 或换登录账号应重新弹出；配置面板留空点「保存并同步」应只报提示、不清除 token。
4. **keepPage 守卫的真机确认**：按「本轮交接」的跑法在真实 github.com 上于第 2 页加/删标签确认页码不变；顺带处理「未决问题」②–④（起点断言、`stars_lang_colors` 被连带清理、清理失败静默）。
5. **`tests/smoke/` 不属于快速构建期**：要跑请按 `DEVELOPER.md` §11（**不随 `pnpm check` 跑**）。
6. **D32 覆盖语义的真机确认**：导入较旧的包 ⇒ 确认框写明「覆盖」、报告出现被替换条数；导入只给备注的包 ⇒ 已有标签必须原样保留（「空不清空」的反向锁）。`name` 合并是已有名字优先。
7. **4.14.0 的真机确认**：点 star ⇒ 只有那张卡变可编辑；点 unstar ⇒ 立即不可编辑但标签与备注仍在；进入/渲染他人页时 DevTools Network **零 `api.github.com` 请求**；TM 安装页授权清单恰 5 项。
8. **`docs/adr/0006` 剩余两项不可观测项**：`?scopes=repo` 预填是否真的勾上（**不得**声称可用或不可用）、`context=user_stars` 服务端是否据其分支。
9. **后续阶段**（见 `todo`）：GraphQL 分页调研、周期自动同步；要让他人页跨页/全量则需 `GET /users/{u}/starred` 匿名 60/hr + 游标翻页 + 独立缓存键，动手前先重估额度与价值。未消化的架构建议：单遍 facet 计算、响应式漏斗。
10. **原生 `fetch` 语言色通道的观察项**：受页面 CSP `connect-src` 约束，失败静默降级为灰圈；GitHub 若收紧 CSP，表现为语言色全灰 ⇒ 届时把 `gmFetchText` 加回来。
11. **两条仍生效的验证纪律**：① 归属校验不可能产生「相符」的可见证据（相符时零痕迹），真机验证只能真换另一个账号的 token，或改本地缓存 `stars_account_identity` —— 这是特性；② **工装自身缺陷比被测代码的缺陷更值得记住**（夹具缺 `octolytics-actor-id` 会让全绿掩盖取错身份字段），改工装后**先用探针确认夹具状态**。

---

## 常用命令

```bash
pnpm check     # tsc --noEmit + 内联 UI 配色守卫 + build（改完必跑）
pnpm build     # → dist/github-star-manager.user.js
pnpm dev       # HMR，需先解决上面 CSP 那条；入口 http://127.0.0.1:5173/__vite-plugin-monkey.install.user.js
pnpm build && node scripts/verify-css.cjs   # 产物 CSS 与源 CSS 等价性
pnpm test:api            # ID 寻址/队列/恢复/同步回归（mock 网络）
pnpm test:exportimport   # 导入导出纯逻辑断言（无需浏览器；项数以实际输出为准）
node scripts/ratelimit-probe.cjs --repo <me/repo>   # 限流实测探针（默认 dry-run）
```

**静态验收口径**：`pnpm check` 绿、`test:exportimport` 全过、动 CSS 时 `verify-css` EXIT 0、dist 头部 `@grant` 恰 5 项；夹具各组 `__errors` 全空、他人页 `fetch = 0` / `writes = 0`、窄视口 `gsm-*` 节点与标记全 0。**快速构建期不跑 `tests/smoke/`**，由用户在真实页面判断。

**建议技能**：`agent-browser-cli`（真机 DOM 探查/注入/截图/受信任点击）—— 用前先读上面「真机调试要点」。夹具与断言可重复运行：`node .diag/gen-otherstars-harness.cjs` → `file://.../?tab=stars&scenario=<名>` → `agent-browser-cli exec --tab <id> --file .diag/assert-otherstars.js`。**生成器已入库**的两组：① `node tests/diag/gen-keep-page-harness.cjs` → `file://.../.diag/jump-harness.html?tab=stars` → `agent-browser-cli exec --tab <id> --file tests/diag/assert-keep-page.js`；② `node tests/diag/gen-defer-rerender-harness.cjs` → `file://.../.diag/defer-rerender-harness.html?tab=stars` → `agent-browser-cli exec --tab <id> --file tests/diag/assert-defer-rerender.js`（D36 挂起重绘守卫；两个生成器都要先 `pnpm build`，且改 `src/` 后必须重跑）。
