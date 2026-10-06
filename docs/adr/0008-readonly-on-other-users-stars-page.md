# ADR 0008 · 他人的 star 页只读模式

- 状态：**已采纳**（4.12.0）
- 决策日期：2026-10-03
- 相关：D25 / ADR 0006（写通道静默分派）/ ADR 0007（Token 归属校验）
- 证据：`.pi/tmp/research-other-user-stars-page.md`（联网 + 真机实测，含 127 条目逐条比对）、
  `.pi/tmp/scout-stars-page-map.md`（现状调用链地图）、`.diag/assert-readonly.js`（仿真页断言）、
  `.diag/assert-scope.cjs`（归属判定 21 项）

## 背景

脚本原先只用 URL 判定是否接管页面：`isStarsPage()` = `/[?&]tab=stars/.test(location.search)`（`src/boot.ts`），
**不看这是谁的页**。而数据层是全局单份的：

- 网格数据来自 `stars_repo_cache`（与账号无关，`repoCache.ts` 注释即写「所有用户共享」），
  `hasApiData()` 也与账号无关 ⇒ 打开他人的 stars 页会**把本人的 star 列表画在别人页面上**，
  并把对方的原生列表整段隐藏；
- 卡片星按钮的实心/空心来自缓存字段 `unstarredAt`，**完全不读页面 DOM** ⇒ 出现「我没 star 过的仓库显示成实心黄星」；
- 标签/备注按**页面主人** id（`octolytics-dimension-user_id`）隔离 ⇒ 在他人页上读写的是**对方**的命名空间（既有风险第 16 条）；
- 进页 2s 自动同步会在任何 stars 页触发整库 API 拉取。

## 决策

**非本人 / 无法判定归属 / 未登录的 star 列表页 = 只读模式。**

1. **归属判定为三态**（`src/pageScope.ts` 的 `getStarsPageScope()`）：`own` / `other` / `unknown`，
   主判据 = `octolytics-actor-id`（登录者）vs `octolytics-dimension-user_id`（页面主人），
   id 取不到退到 login 比对，`/stars/{login}` 路由退到路径段；**取不到就判 unknown，绝不回退成 own**。
2. **unknown 与 other 同处置**（只读）。页面 meta 无官方契约（同类前例：`csrf-token` 已消失），
   失效时的降级方向是「本人页也退回原生列表」，而不是「在别人页面上画出我的数据」。
3. **只做就地装饰、不接管页面**：不建网格、不分页、不搬 topics、不建筛选栏/同步按钮；
   把**本人已有的**标签/备注注入原生命中条目（`.gsm-ro-tags` / `.gsm-ro-notes`）。
4. **徽章纯只读**：不挂任何监听器、不建编辑控件、不写 storage、`cursor: default`、点击无反应；
   唯一的提示是徽章的原生 `title`。**不设任何提示条/横幅**（用户裁定）。
5. **只禁隐式拉取**：只读路径不调用 `scheduleProbeSync()`，故进页 2s 自动整库同步不会发生；
   TM 菜单的「🔄 立即全量同步」与「恢复取消的 star」是用户显式发起、且只操作**本人账号**的数据，
   照常执行、不拦截（用户裁定）。
6. **不碰 GitHub-owned 节点**：不改原生星按钮（它由服务端渲染 `.starring-container.on`，
   精确表达「**登录者**是否已 star」，实测 127 条目零假阳零假阴），不给原生节点设 `display`，
   因此回滚不需要 `data-gsm-*` 标记 —— 只抹脚本自有 class（`viewTeardown` 第 11 项）。
7. **标签/备注命名空间改用登录者 id**（`getStorageUserId()`，原 `getStarsUserId()`）：
   > **4.18.0 更新**：本条已被 **`docs/adr/0010` / D33 改写** —— 归属账号改为 **token 账号**（取不到才回退登录者），
   > 宽限期备份也按同一归属分区。下面这段保留作历史记录。
   本人页上两者数值相等 ⇒ 自有页行为与数据键**不变**；他人页从「读别人的命名空间」变为「读我的」。
   取不到身份时读空表、写 no-op，**不回落** `stars_tags` / `stars_notes` 无隔离旧键。
8. **覆盖新路由** `/stars`（本人）与 `/stars/{login}`（他人）：后者实测 **缺** `octolytics-dimension-user_id`
   且 `body` 无 `mine`，只能靠路径段判定；它的条目 DOM 与 profile 标签页不同，徽章按 best-effort
   （找不到条目即静默跳过，不报错、不猜）。

## 为什么不选其它方案

- **完全跳过（不增强他人页）**：better-github-stars-manager 走的是这条路。我们选只读装饰，
  因为用户要求「仅改变外观，应用部分已有标签或备注」——标签/备注是本脚本的**本地权威数据**，
  在他人页看到它们是有价值的；而这不需要任何额外网络或写能力。
- **自建只读卡片网格**：需要新的「原生条目 → RepoData」解析器、`queryRepos()` 数据源接缝、
  只读卡片与游标翻页方案（实测 `?page=N` 在 HTML stars 页**被忽略**，真实翻页是 `after=`/`before=` 游标），
  工作量约 3–4 倍，且会把「脚本自建星按钮」这个已知冲突点重新引回页面。
- **禁用页面上的原生星按钮**：那是 GitHub 给登录者渲染的正当控件，脚本碰它只多一处待回滚的
  GitHub-owned 节点；用户要的是「脚本不写」，不是「页面不能写」。

## 后果与已知局限

- **失效即降级**：`octolytics-*` / `user-login` 一旦被改名或移除，所有 stars 页（含本人页）
  都会退回只读/原生形态 —— 功能降级，但无数据损坏、无写操作。
- **该页没有任何标签/备注时脚本完全不可见**（无提示条的必然结果）：这是刻意的静默。
- **登出用户看不到标签/备注**（无法确定数据归属）。
- **`exportImport` 的 `user.id` 语义随第 7 条一起变化**：从「页面主人 id」变成「登录者 id」。
  在他人页导出/导入时的行为因此变化（此前会写出对方的 id、并拿对方的 id 做归属校验）。
- **私有仓库**在他人 stars 页是否出现、结构是否一致未实证；取不到标识符就跳过该条目。
- **`/stars/{login}` 的条目结构**（2026-10-03 真机实测后已支持）：该路由的条目是 `ul.repo-list > li`，
  **没有** `#user-starred-repos` / `.col-lg-9` / `div.f6.color-fg-muted` 元数据行，与 profile 标签页完全不同。
  4.12.0 首版只按 div 条目收集 ⇒ 在这条路由上**一个条目都收不到**，样式表都不会注入（零徽章，也没有任何报错）。
  现改为两条互斥路线（div 路线优先，收不到再扫 `li`），实测 `/stars/mattn` 由「收集 0 个」变为「收集 10 个」。
