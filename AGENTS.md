# GithubStarManager — Agent Handoff

> **权威分工（本文件不重复它们的内容）**
> 架构 / 模块职责 / 数据流 / 存储模型 → **`DEVELOPER.md`**；历史过程 → **`git log`**；决策全文与依据 → **`docs/adr/0001`–`0011`**；实施计划与逐条验证 → **`docs/plans/`**（历史在 `archive/2026/`）；可复用的验证数字 / A/B 反证 → gbrain `people/me`。
> 本文件只留四样：**下一轮交接、当前状态、仍生效的硬口径、调试要点与下一步**。

---

## 本轮交接：4.19.1 —— 本地数据编辑保页码（D12 补）

交接时间：**2026-10-20 17:15 +0800**；分支 `master`。

- **现象与根因**：在第 N（N>1）页增删卡片标签后网格回到第 1 页。根因是 `src/ui/tagFilter.ts` 的删除与提交两个处理器调用 `applyFilters()` 未传 `keepPage`，走默认分支渲染第 1 页；违反既有不变式（`DEVELOPER.md` §7）。修复为两处改传 `applyFilters({ keepPage: true })`。
- **规范落点**：不变式写入 `docs/filters-sort-design-2026-09-23.md` §4.2；调用点名单在本文 D12 补与 `DEVELOPER.md` §7。
- **回归守卫**：`tests/diag/assert-keep-page.js`（手工注入式，与 `tests/diag/selectors.js` 同约定，不随 `pnpm check` 运行）；生成器 `tests/diag/gen-keep-page-harness.cjs` **已入库**（70 仓库 / 3 页，内联当前 `dist`，产物写入被忽略的 `.diag/jump-harness.html`）。跑法：`pnpm build` → `node tests/diag/gen-keep-page-harness.cjs` → `agent-browser-cli open --focus "file:///<repo>/.diag/jump-harness.html?tab=stars"` → `agent-browser-cli exec --tab <id> --file tests/diag/assert-keep-page.js`。夹具开局清掉 `github-star-manager::` 前缀的全部 localStorage 镜像键，使 `src/gm.ts:66-68` 的镜像迁移不会把上次的 `probe-*` 标签带进本次运行。
- **验证**：守卫全绿（`page2=2/3`、`afterAdd=2/3`、`afterDelete=2/3`、`afterPillClick=1/1`、`cleanup=2/3`，`errors` 为空）；反证为撤掉两处修复重编重跑得到 `1/3`、首卡 `owner41/repo41 → owner27/repo27`。`pnpm check` 通过，dist 210.44 kB，`@grant` 恰 5 项。
- **边界**：`tests/smoke/` 不随快速构建期运行；真机 TM 复验未执行。守卫只在可见标签页可信（后台节流下 `setTimeout(60)` 实测 661ms）。
- **本轮审查**：四轮代理审查（static / tests / adversarial / real），末轮裁定不修复并接受 6 条残余风险，见「未决问题」。

---

## 当前状态

版本 **4.19.1**（`package.json` 是单一版本源，`vite.config.ts` 读它写脚本头）。

本轮落点 = 4.19.1（D12 补）。版本演进与每轮改了什么查 `git log`，决策依据查 `docs/adr/`。
唯一需要跨版本记住的两条实测结论：
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
- **D12 · 同步后立即重渲染**：`changed > 0` 且在网格 ⇒ 直接 `applyFilters({keepPage: true})`，不问「是否刷新」。**重绘期间网格不得出现空态**：`renderBrowsePage` 是唯一拆建点，必须分片建好再一次 `replaceChildren`（清空那一刻网格为空 ⇒ 浏览器把 `scrollY` 夹到 0）。**D12 只适用于本方自己的 stars 页**。
- **D12 补 · 页码保持的不变式**：重绘不改变筛选条件时，调用方必须显式传 `applyFilters({ keepPage: true })`；`applyFilters` 默认分支渲染第 1 页，故遗漏的表现就是「在第 N 页操作后回到第 1 页」。已确认的同类调用点：同步后重绘（`fullSync.ts`）、卡片星标变更（`starCheck`）、导入后重绘（`index.ts`）、卡片标签增删（`ui/tagFilter.ts` 的删除按钮与 `commit()`）。筛选条件本身的变更**不**传该参数，回第 1 页属预期；越界由 `renderBrowsePage` 夹取兜住。⚠️ 本条措辞与排序的关系尚有未决矛盾，见「未决问题」①。
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

---

## dev 模式必须知道的四件事

1. **dev 下 GM API 不可见**：dev 代码经动态 `import()` 跑在 `unsafeWindow` 作用域，无 GM_api。已用 `server.mountGmApi: true` 解决（仅 dev，产物不变）。
2. **GitHub CSP 拦 dev loader**：`script-src` 白名单不含 `127.0.0.1`，需装 CSP 放行扩展 + 允许 Local Network Access（见 `DEVELOPER.md` §2）。
3. **两个脚本不能同时启用**：正式版先跑会让 dev 版「改了没反应」。
4. **改过脚本头（`@version` 最常触发）后必须重新安装 dev loader** —— 否则 TM 菜单整体消失。机制：`mountGmApi` 靠**由头注释算出的 key**（`md5(头注释).base64url[0:16]`）在两侧传窗口。表现是「TM 菜单空了」**且**「同步说未配置 token」。修：重开 <http://127.0.0.1:5173/__vite-plugin-monkey.install.user.js> 让 TM 原地更新。

---

## 真机调试要点（只留最贵的坑）

- **必须前台标签页**：后台标签的测量/交互/定时器全部失真（定时器节流到 1 次/分钟，CDP 受信任点击静默失效）。先 `{"method":"Page.bringToFront","params":{},"allowFocus":true}`（`allowFocus` 是 **`method` 的同级参数**），每次量测前回读 `document.visibilityState`。
- **冻结标签页会给出过期 `computedStyle`**：判据 —— **「连 inline `!important` 都改不动 computed 值」= 标签页被冻结**。可靠做法是 `agent-browser-cli open --focus <url>` 新开一页并确认 `visibilityState === 'visible'`。过渡冻结则先 `document.getAnimations().forEach(a => { try { a.finish(); } catch {} })` 再读。
- **`agent-browser-cli` 的 `tab_id` 不可信**：只用 `agent-browser-cli tabs` 按 URL **靠前的片段**（如 `.diag/`）找 id —— 它把 URL 截断到约 65 字符。
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

- **未决问题（4.19.1 审查裁定不修复，逐条接受）**：
  ① `DEVELOPER.md` §7 前件「筛选条件未变的重绘」字面上包含**仅改排序**的重绘（`src/state.ts:48-55` 的 `hasActiveFilter()` 只含 tags/langs/types/search），而同段后半句又说「排序条件的变更不传」——例外式矛盾。行为侧无冲突（`src/filters.ts:905` / `:972` 确实不传），但读者按前件执行会给排序也加 `keepPage`。同一句已是第三轮被指出。
  ② 守卫缺起点断言：`tests/diag/assert-keep-page.js` 只把起点首卡与标签写进 `steps`，不写 `errors`；向 localStorage 镜像注入 `probe-leak` 后重载，起点读数异常而 `errors` 仍为空 ⇒「夹具封闭」这一性质无断言守护。
  ③ 夹具镜像清理按前缀全清，含 `stars_lang_colors`（`src/constants.ts:45`，不在 `SENSITIVE_KEYS` 内），每次运行会令 `src/langColors.ts:39` 缓存未命中并触发一次 linguist 请求。④ 该清理失败被 `catch {}` 静默吞掉，无 console 痕迹。
  ⑤ `tests/smoke/fixture.html` 自带的 GM stub 块在生成器注入 head 覆盖后成为死代码（既有问题）。⑥ 全部验证都在 `file://` 夹具上，未在真实 github.com 页面跑过。
- **dev HMR 需浏览器放行 CSP**。**classic token + 私有仓库**：无 `repo` scope 时可能把私有仓库误判 unstar（D3）。
- **`GitHub-Verified-Fetch: true` 是玻璃地板**：无文档无契约（公开来源仅 2 次观测），GitHub 随时可收紧 ⇒ 只作观察项。
- **既有变异请求没有显式 deadline**：可能长时间占用串行队列（元数据读取已覆盖 20 秒超时）。
- **网页通道均无法靠原生表单复核方向**（两种表单同时存在），只能以 HTTP 成功为准。
- **TM 菜单标签不跨标签页同步**；**老版 TM（< 5.0）下「隐藏 Lists」菜单项会累积重复**（功能不受影响）。
- **一键批量恢复会代发请求**，落在 AUP §4 的邻域（缓解 = 严格串行 ≥1s + 进度可见 + 可取消 + 确认弹窗）。「写通道不向用户披露」与 RDA §4(v) 的偏差记在 `docs/adr/0006`。
- **通知栈无条数上限**；**兜底颜色是浅色硬编码**。**底部份页器提交后焦点会掉到 `BODY`**（有意留下）。
- **归属校验与登录者回退都依赖无官方契约的页面 meta**（`octolytics-actor-id` / `user-login`）：被改名时归属校验**静默失效**（判 `unknown`，有意的降级方向），`getStorageUserId()` 的回退支路也失效。已确认过身份的 token 用户不受影响（走指纹缓存），但 `saved-unverified` 那一支仍依赖 meta。**GHES / SAML SSO 下行为未确证**。
- **归属解析的「快照窗口」**：任何「有 token 但指纹缓存无该凭证」的状态都会在会话首次 `getStorageUserId()` 把归属快照在登录者上、整会话不翻转（有意的取舍）；「身份冷缓存时导出、缓存变热后导入」还会被归属校验拒绝。
- **夹具的非空转守卫**：分区键一改名，夹具若仍种在旧键上会让断言「因读空而全绿」（批量脚本只看 `_errors`）。已为 `other-editstate` / `own-unstar` / `other-logout-pending` 加守卫并把结论折进 `_errors` —— 再改分区键时先确认这三组。
- **关掉归属横幅后，页面上再无「数据属于哪个账号」的痕迹**（不加新 UI 的必然代价）：任一侧身份变化即重新武装。
- **细粒度 token 调 `GET /user` 的文档位置很偏**（在端点页的 fine-grained 折叠小节里）：复读请用原始 HTML 取证。
- **「无 token + 有登录会话」组合不做归属校验**（有意收窄）⇒ 属**风险 14**。`stars_full_sync_meta` 已记 `accountId`（只写不判），做告警时才用它判定。
- **他人页网格的真实局限**（设计属性，非缺陷）：① 可编辑性依赖本人整表缓存时效；② 徽章只在我有数据时出现；③ 只有本页数据，无跨页筛选/搜索；④ DOM 里没有的字段即降级；⑤ `viewContext` 模块态必须复位；⑥ 依赖 GitHub 条目结构，改版即退化为「不接管」；⑦ 呈现层接管了页面框架，功能层未接管；⑧ GitHub 有**三套并存**的 stars 骨架 ⇒ 选择器必须有退路。
- **他人页两条已登记未修**（4.14.0）：① 逐卡约 5 次 `GM_getValue`（30 条约 150+ 次同步 IPC）；② D12 的「同步后立即重渲染」在他人页不生效（净收益）。
- **布局接管的两点残留**：① `.container-xl{max-width:1600px}` 是布局祖先，登出页页头容器也会被加宽（纯宽度）；② `/stars/{login}` 上没有 `.Layout` ⇒ 从不进入三栏接管。
- **本人页 unstar 后的只读态是「临时显示态」**：下一次整页重绘即消失；有激活筛选/搜索时是「立即消失」。已被裁定为预期，不为此把宽限期条目注入 `queryRepos()`。

---

## 下一步

1. **升级 4.19.1 后，用 dev 脚本的人必须重装 dev loader**（机制见「dev 模式」第 4 条）；正式版不受影响。
2. **keepPage 守卫的真机确认**：按「本轮交接」的跑法在真实 github.com 上于第 2 页加/删标签确认页码不变；顺带处理「未决问题」②–④（起点断言、`stars_lang_colors` 被连带清理、清理失败静默）。
3. **风险 21 的真机确认**：换一份属于另一个账号的 token ⇒ 横幅应点名两个账号并含归属句；错号期间的标签落在 token 账号命名空间；关掉横幅后换 token 或换登录账号应重新弹出；配置面板留空点「保存并同步」应只报提示、不清除 token。
4. **`tests/smoke/` 不属于快速构建期**：要跑请按 `DEVELOPER.md` §11（**不随 `pnpm check` 跑**）。
5. **D32 覆盖语义的真机确认**：导入较旧的包 ⇒ 确认框写明「覆盖」、报告出现被替换条数；导入只给备注的包 ⇒ 已有标签必须原样保留（「空不清空」的反向锁）。`name` 合并是已有名字优先。
6. **4.14.0 的真机确认**：点 star ⇒ 只有那张卡变可编辑；点 unstar ⇒ 立即不可编辑但标签与备注仍在；进入/渲染他人页时 DevTools Network **零 `api.github.com` 请求**；TM 安装页授权清单恰 5 项。
7. **`docs/adr/0006` 剩余两项不可观测项**：`?scopes=repo` 预填是否真的勾上（**不得**声称可用或不可用）、`context=user_stars` 服务端是否据其分支。
8. **后续阶段**（见 `todo`）：GraphQL 分页调研、周期自动同步；要让他人页跨页/全量则需 `GET /users/{u}/starred` 匿名 60/hr + 游标翻页 + 独立缓存键，动手前先重估额度与价值。未消化的架构建议：单遍 facet 计算、响应式漏斗。
9. **原生 `fetch` 语言色通道的观察项**：受页面 CSP `connect-src` 约束，失败静默降级为灰圈；GitHub 若收紧 CSP，表现为语言色全灰 ⇒ 届时把 `gmFetchText` 加回来。
10. **两条仍生效的验证纪律**：① 归属校验不可能产生「相符」的可见证据（相符时零痕迹），真机验证只能真换另一个账号的 token，或改本地缓存 `stars_account_identity` —— 这是特性；② **工装自身缺陷比被测代码的缺陷更值得记住**（夹具缺 `octolytics-actor-id` 会让全绿掩盖取错身份字段），改工装后**先用探针确认夹具状态**。

---

## 常用命令

```bash
pnpm check     # tsc --noEmit + build（改完必跑）
pnpm build     # → dist/github-star-manager.user.js
pnpm dev       # HMR，需先解决上面 CSP 那条；入口 http://127.0.0.1:5173/__vite-plugin-monkey.install.user.js
pnpm build && node scripts/verify-css.cjs   # 产物 CSS 与源 CSS 等价性
pnpm test:api            # ID 寻址/队列/恢复/同步回归（mock 网络）
pnpm test:exportimport   # 导入导出纯逻辑断言（无需浏览器；项数以实际输出为准）
node scripts/ratelimit-probe.cjs --repo <me/repo>   # 限流实测探针（默认 dry-run）
```

**静态验收口径**：`pnpm check` 绿、`test:exportimport` 全过、动 CSS 时 `verify-css` EXIT 0、dist 头部 `@grant` 恰 5 项；夹具各组 `__errors` 全空、他人页 `fetch = 0` / `writes = 0`、窄视口 `gsm-*` 节点与标记全 0。**快速构建期不跑 `tests/smoke/`**，由用户在真实页面判断。

**建议技能**：`agent-browser-cli`（真机 DOM 探查/注入/截图/受信任点击）—— 用前先读上面「真机调试要点」。夹具与断言可重复运行：`node .diag/gen-otherstars-harness.cjs` → `file://.../?tab=stars&scenario=<名>` → `agent-browser-cli exec --tab <id> --file .diag/assert-otherstars.js`。`keepPage` 守卫是唯一**生成器已入库**的一组：`node tests/diag/gen-keep-page-harness.cjs` → `file://.../.diag/jump-harness.html?tab=stars` → `agent-browser-cli exec --tab <id> --file tests/diag/assert-keep-page.js`。
