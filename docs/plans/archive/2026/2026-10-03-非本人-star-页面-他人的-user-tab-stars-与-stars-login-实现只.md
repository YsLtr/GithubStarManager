---
title: 他人 star 页只读模式 + 兼容性修正
status: done
created: 2026-10-03
session: 01a0ff6c-dd83-72f8-ba3a-8193095f2e42
approved: 2026-10-03
completed: 2026-10-03
---
# 非本人 star 页（`?tab=stars` 与 `/stars/{login}`）只读阉割模式

- 版本基线：**4.11.1**（`package.json` 单一版本源）
- 规划时间：2026-10-03（本机时钟）
- 状态：**待审查（第二轮：已并入用户对 V3 / V5 / 标签只读 的裁定）**
- 事实来源（本机实测 + 联网查证；报告在仓库内、`.pi/tmp/` 已 gitignore）：
  - `.pi/tmp/research-other-user-stars-page.md`（他人 stars 页原生 DOM 判据 / GitHub 身份字段 / API 端点 / 路由表；含 127 条目逐条比对与匿名实测）
  - `.pi/tmp/scout-stars-page-map.md`（现状调用链地图，文件:行号级）
- 上一轮同名方案文档（内容已被本文件取代，实施期一并删除）：
  `docs/plans/2026-10-03-非本人-star-页面-他人的-user-tab-stars-实现只读阉割模式-不拉整库-api.md`

---

## 1. 问题

脚本用 `isStarsPage()` = `/[?&]tab=stars/.test(location.search)` 判定是否接管页面（`src/boot.ts:25-27`），**只看 URL，不看这是谁的页**。于是打开他人的 stars 页时：

1. 网格数据来自**全局单份**缓存 `stars_repo_cache`（`src/constants.ts:37`，`src/storage/repoCache.ts:8` 注释「所有用户共享」），而 `hasApiData()` 也与账号无关（`src/fullSync.ts:962-965`）⇒ 在别人的页面上画出**我自己的** star 列表，并把对方的原生列表整段隐藏（`src/transform.ts:36-45`）。
2. 卡片星按钮的初态来自缓存字段 `!data.unstarredAt`（`src/ui/cards.ts:116`），**完全不读页面 DOM**，也与页面主人无关 ⇒ 出现「本人没有 star 的仓库显示为实心黄星」这类冲突。
3. 标签/备注的存储键按**页面主人** id 隔离（`src/storage/tags.ts:5-14`、`notes.ts:6-9`，走 `octolytics-dimension-user_id`）⇒ 在他人页上读写的是**对方**的命名空间（AGENTS.md 已知风险第 16 条；本轮已实测确证：`/mattn?tab=stars` 上 `dimension-user_id = 10111` 而登录者 `actor-id = 130123551`）。
4. 进页 2s 自动同步（`src/index.ts:209` → `fullSync.ts:968-995`）会在任何 stars 页触发整库 API 拉取。

## 2. 目标 / 非目标

**目标**

- G1 非本人 / 无法判定归属 / 未登录的 star 列表页 ⇒ **只读模式**：不自动拉整库 API、不产生任何写入口、不把本人缓存画到页面上。
- G2 只读页上「仅改变外观」：就地应用**本人已有的**标签/备注，不重建数据、不接管原生列表。
- G3 修掉「未 star 也显示实心黄星」这一冲突（根因是自建星按钮读缓存，而不是读页面）。
- G4 兼容性：覆盖新路由 `/stars/{login}`；归属无法判定时**不冒充**自己的页；纠正两处与实测不符的既有文档口径。
- G5 不回归：自有 stars 页（`?tab=stars`，登录者 = 页面主人）的行为不变。

**非目标**

- 不做他人页的「只读卡片网格」——见 **V1**。
- 不做他人页的脚本级筛选/搜索——见 **V7**。
- 不给他人页做任何提示条 / 横幅 / 弹窗——见 **V3**。
- 不拦截 TM 菜单的显式同步与批量恢复——见 **V5**。
- 不改写路径本身（`setStarState()` 签名与静默分派不动，理由同 D25「不做写前校验」）。
- 不动详情页、不动窄视口策略（沿用 D18/D19）。
- 不引入任何新依赖。

## 3. 关键事实（本轮落地依据）

| # | 事实 | 证据 |
|---|---|---|
| F1 | 他人 stars 页每个条目携带「**登录者**是否已 star」的可靠信号，判据唯一 = 条目的 `.starring-container` 是否带 `on` 类；服务端渲染，127 个跨 6 用户的条目与本人真实 star 全集（477 条）比对 **0 假阳 0 假阴** | research §1.2/§1.3、§1.5（`github-bulk-unstar`、`hideStarredRepo` 两个独立实现同款判据） |
| F2 | `aria-label` / 按钮文字 / `octicon-star-fill` / `/star` 与 `/unstar` 表单**都不能**判状态 —— 每个条目两个表单永远并存（30/30），靠 CSS 显隐 | research §1.3 |
| F3 | 匿名（登出）时条目上**没有任何** star 开关 ⇒ 只能判 `unknown` | research §1.4 |
| F4 | `octolytics-actor-id` = 登录者；`octolytics-dimension-user_id` = 页面主人；`user-login` = 登录者（登出时存在但为空串）；无 `__PRIMER`、无内联 viewer JSON、**无官方契约** | research §2.1/§2.2 |
| F5 | 既有文档未记录的新路由 **`/stars/{login}`**（他人的新版页，200）：**缺** `octolytics-dimension-user_id`，`body` 无 `mine`，页面结构与 profile 标签页不同 | research §6.1 |
| F6 | `?page=N` 在 **HTML** stars 页被忽略（返回第 1 页内容，不是空页）；真实翻页是 `after=`/`before=` 游标 | research §6.1/§6.3 —— **与现有 AGENTS.md 表述冲突，需纠正** |
| F7 | `form[action$="/star"]` **不会**误命中 `/unstar`（合成元素 + 真实元素双重实测 `false`）；真正会误命中的是去掉斜杠的 `[action*="star"]` | research §1.6 —— **与现有 AGENTS.md「DOM 变更对照」冲突，需纠正** |
| F8 | 条目内可稳定取出数字 repoId（`user-list-menu[data-repository-id]`）与显示名（`h3 a[href="/{o}/{r}"]`） | research §1.3、§7 |
| F9 | 现状：网格数据源硬编码 `loadRepoCache()`（`src/filters.ts:104-105`）；`applyFilters`/分页/筛选/搜索**零网络**；`runFullSync` 恰 4 个调用点（3 个用户显式 + 1 个进页隐式）；写入口只有卡片按钮与批量恢复两处 | scout §4.2/§5.1/§5.2/§5.3 |
| F10 | 现状：`getStarsUserId()` 的全部消费者只有 `tags.ts:18,23,41`、`notes.ts:13,19`、`exportImport.ts:58,142-146`；本人页上它与 actor-id 数值相等 | scout §2.1 |
| F11 | 现状：`viewTeardown` 有 10 项按痕迹回滚；`GSM_HIDDEN_ATTR` 的用途限定为「我们改过它的 display」 | scout §6、`src/constants.ts:53-60` |

## 4. 设计

### 4.1 归属判定（三态，不用布尔）

`src/pageScope.ts`（新，纯逻辑、只读 DOM、不建节点）：

```ts
type StarsScope = 'own' | 'other' | 'unknown';

isStarsListingPage(): boolean          // '?tab=stars' || /stars || /stars/{login}
getViewerId(): string                  // octolytics-actor-id（缺失 → ''）
getViewerLogin(): string               // user-login || octolytics-actor-login
getPageOwnerId(): string               // octolytics-dimension-user_id
getPageOwnerLogin(): string            // octolytics-dimension-user_login || /stars/{login} 路径段
getStarsPageScope(): StarsScope
```

判定顺序：

1. `/stars`（本人新版页，无登录名段）→ 有会话则 `own`，否则 `unknown`。
2. `/stars/{login}`（F5 缺 dimension 元数据）→ 用**路径段**与 viewer login 比对：不等 ⇒ `other`；相等 ⇒ `own`；viewer login 为空 ⇒ `other`。
3. `?tab=stars`：
   - 两侧 id 都在：相等 ⇒ `own`，不等 ⇒ `other`。
   - 退到 login 比对（两侧都在且不等 ⇒ `other`；相等 ⇒ `own`）。
   - viewer 侧完全缺失（登出，F3）而 owner 侧可得 ⇒ `other`。
   - 两侧都取不到 ⇒ `unknown`。
4. `unknown` 与 `other` **同处置**（只读）。**不做**任何「取不到就当自己的」回退。

> 取舍：id 优先（login 可改名，会制造永久误判，`src/accountGuard.ts:94-101` 已有同款论证）；不采用 `<title>` / `body.mine` 作主判据（F5 上二者失效）。

### 4.2 只读模式做什么

`src/readonly.ts`（新）+ `src/styles/readonly.css`（新）：

- **不**调用 `transformStarsList()`：原生条目保持可见、不分页接管、不搬 topics、不建分页器/筛选栏/同步按钮。
- **注入徽章**：遍历原生条目，取 repoId（`user-list-menu[data-repository-id]`）与显示名（`h3 a[href]`），查**本人命名空间**的标签/备注，非空则注入 `.gsm-ro-tags` / `.gsm-ro-notes`（纯展示）。任一项缺失即跳过该条目。
- **徽章是纯展示节点**：不挂 click/键盘处理器，不创建编辑控件，不写 storage，`cursor: default`（点击无反应）；`title="标签/备注只能在你自己的 stars 页面修改"` —— 这就是唯一的「提示」（**不设提示条/横幅**）。
- **不碰** GitHub 的原生节点属性（不改 `display`、不加标记），不渲染任何 `.stars-star-btn`。
- 全程幂等；`/stars/{login}` 上找不到条目就静默什么都不做（best-effort，F5 结构差异未深挖）。

### 4.3 三道封口

| 封口 | 位置 | 行为 |
|---|---|---|
| 不**自动**拉整库 API | 只读路径**不调用** `scheduleProbeSync()` | 进页 2s 自动整表同步不发生（4.11.1 的隐式触发点只有 `index.ts:209` 一处）；手动同步按 V5 照常可用 |
| 不写 | 只读路径不建卡片 ⇒ 无星按钮；`restoreMany()`/`restoreOne()` **不拦截** | 用户显式发起的批量恢复只操作本人 star，属允许范围（V5）；脚本在只读页不提供任何**页面内**写入口 |
| 不误判星标 | 页面层 | 根本不渲染脚本星按钮；原生按钮（`on` 服务端渲染，F1）保持权威 |

### 4.4 命名空间修正（顺带修掉已知风险第 16 条）

- `storage/tags.ts`：`getStarsUserId()` → **`getStorageUserId()`**，来源改为 `octolytics-actor-id`；空值护栏：`loadAllTags()` 返回 `{}`、`saveTags()` no-op + console warn，**不回落** `stars_tags` / `stars_notes` 旧键。
- `storage/notes.ts`：同上。
- `storage/exportImport.ts`：导出包 `user.id` 与导入归属校验改用同一函数（本人页数值不变）。
- 改造后 `getStarsUserId()` 零消费者 ⇒ 按 D21 删除。

### 4.5 接门点（一处分派，其余让路）

| 位置 | 改动 |
|---|---|
| `src/index.ts` `transformAndReveal()` | `!isDesktop()` 早退之后、`ensureStarsSetup()` 之前：`isStarsListingPage() && getStarsPageScope() !== 'own'` ⇒ `enterReadOnlyMode()` + `return`（不注入布局样式、不排同步、不 evaluate 归属横幅） |
| `src/boot.ts` `installBootHide()` | 只读 scope 下**不**给页面加隐藏类（否则原生列表被藏住且无人揭示） |
| `src/index.ts` turbo 路径 | `turbo:load` / `turbo:frame-render` / 断点回宽 重新分派；收窄 → `exitStarsView()` 连带清只读痕迹 |
| `src/viewTeardown.ts` | 新增第 11 项：remove 只读样式表 + `.gsm-ro-tags` / `.gsm-ro-notes` |

### 4.6 不引入的东西

- 不新增 `data-gsm-*` 标记（从不改 GitHub-owned 节点的 `display`，`GSM_HIDDEN_ATTR` 不适用）。
- 不新增提示条 / 横幅 / 弹窗（V3）、不新增 storage 键（V3）、不新增 `@grant`（仍恰 5 项）、不新增网络出口。

## 5. 可变决策表

| # | 选择 | 已生效默认值 | 依据 | 改动代价 |
|---|---|---|---|---|
| V1 | 只读形态 | **保留原生列表 + 只注入本人标签/备注徽章**（不建网格） | 原生 `.starring-container.on` 已正确表达 viewer 星标状态（F1）；自建星按钮正是冲突根源（F9）；`?page=N` 在 HTML 页被忽略（F6） | **高**：改「只读网格」需新增原生→RepoData 解析器、`queryRepos()` 数据源接缝、只读卡片与游标翻页；工作量 3–4 倍 |
| V2 | 原生星按钮 | **不禁用**，交回 GitHub | 那是 GitHub 给登录者渲染的正当控件（research §4）；碰它 = 多一处待回滚的 GitHub-owned 节点 | 低：加一条只读样式 + 回滚项 |
| V3 | 只读提示载体 | **无任何提示条/横幅**；提示只落在徽章 hover 的 `title`；徽章点击无反应、无编辑入口 | 用户裁定；无提示条 ⇒ 不新增 storage 键与回滚项 | 低：加提示条/弹窗需增节点、回滚项、幂等逻辑 |
| V4 | 登出时的标签/备注 | **不显示**（只读且无徽章） | 登出无 `on` 信号（F3）、无 actor-id；按页面主人命名空间展示恰是已知风险 16 号缺陷 | 中：改成「显示」等于固化该缺陷，并要为 legacy 键再定归属口径 |
| V5 | TM 菜单同步/恢复在只读页 | **照常后台执行**（不拦截）；只禁隐式进页自动同步 | 用户裁定「这只会动自己的仓库，与他人页面无关」；3 个显式入口 vs 1 个隐式入口（F9） | 中：改回「一律拒绝」需恢复两道门，并让用户在他人页无法同步自己的数据 |
| V6 | 新路由 `/stars/{login}` | **纳入**归属判定与只读门；徽章 best-effort | F5：不纳入会被它绕过整道门；其条目结构未深挖（research §8-2） | 中：不动则留绕过口；完整支持需补真机实测 |
| V7 | 只读页的筛选/搜索 | **不提供**，交回原生 | 接管原生筛选需挂钩 GitHub-owned 节点（4.9.2 审查抓过的「监听摘不掉」类风险）；只读页只有当前一页条目 | 中：需独立作用域 + 回滚项 + 整帧重渲染后的徽章重注入 |
| V8 | 代码落点 | **新增 `pageScope.ts` + `readonly.ts` + `readonly.css`** | 既有分层铁律；`index.ts` 585 行、`filters.ts` 924 行 | 低：就地加分支会让判定被多处共用时产生循环依赖风险 |

## 6. 任务清单

| # | 任务 | 主要产出 |
|---|---|---|
| T1 | 归属判定层 | `src/pageScope.ts`（三态判定 + 路由识别）；`storage/tags.ts` 的 `getStorageUserId()` + 空值护栏 |
| T2 | 只读装饰层 | `src/readonly.ts` + `src/styles/readonly.css`；幂等注入**只读徽章**（无提示条、无编辑入口、`title` 提示、点击无反应）；`exitReadOnlyMode()` 按 class 全量抹除 |
| T3 | 入口分派 | `transformAndReveal` 分派点；`installBootHide` 让路；turbo / 断点路径全部接门 |
| T4 | 网络封口（显式入口放行） | 确认只读路径不调用 `scheduleProbeSync()`、不挂 Sync 按钮；**验证** TM 菜单同步与批量恢复在只读页照常工作（不拦截）；验证页面内零写入口 |
| T5 | 回滚与窄视口 | `viewTeardown` 第 11 项；跨断点双向切换无残留、无重复 |
| T6 | 命名空间迁移收尾 | `exportImport.ts` 同源改造；`tests/exportImport/run.cjs` 桩同步；`pnpm test:exportimport` 51/0 |
| T7 | 静态验证 | `pnpm check` 绿；`scripts/verify-css.cjs` 纳入 `readonly.css` 且 EXIT 0；dist `@grant` 恰 5 项；无新增 `fetch(` 调用点 |
| T8 | 仿真页断言 + 真机清单 | `.diag/` 工装：own / other / unknown / logged-out / `/stars/{login}` / 窄视口 六场景；真机核对清单 |
| T9 | 文档同步 | AGENTS.md（新决策条目、已知风险 16 更新、F6/F7 纠正、`/stars/{login}` 补记）、DEVELOPER.md、`docs/adr/0008-*`；删除上一轮同名旧方案文档 |

## 7. 验收标准

**行为**

1. `/mattn?tab=stars`（登录者 ≠ 页面主人）：无 `.stars-grid-container`、无 `.stars-star-btn`、原生条目**未被**加 `.stars-original-hidden`、**0 次** `api.github.com` 请求、**无任何提示条/横幅**、徽章按**登录者**命名空间渲染且**点击无反应**（hover 可见「回自己的 stars 页修改」的提示）。
2. 自有 `?tab=stars`：行为与 4.11.1 **一致**（网格/分页/筛选/同步按钮/归属校验入口全部照旧）。
3. TM 菜单「🔄 立即全量同步」在只读页**照常执行**（真发 API、按正常流程写盘、结果进通知栈），页面内仍不出现网格；「恢复取消的 star」同样可用。
4. `/stars/{login}`（他人）：不建网格、不自动发 API 请求；徽章 best-effort。
5. 登出（他人页 / 自有页）：只读、无徽章、无自动 API 请求、无异常。
6. 两侧身份都取不到：只读（不冒充自有页）。
7. 窄视口：只读模式一行 DOM 不碰；宽 → 窄 → 宽 往返后无脚本残留、无重复节点。
8. 离开 Stars（Turbo 导航 / 跨断点收窄）：只读痕迹（样式表 + 徽章节点）全部清除。

**静态**

9. `pnpm check` 绿、`node scripts/verify-css.cjs` EXIT 0、`pnpm test:exportimport` 51/0、dist 头部 `@grant` 恰 5 项。
10. `dist` 内不新增 `fetch(` 调用点（只读路径零网络）。

**文档**

11. AGENTS.md 新增只读模式决策条目；已知风险第 16 条更新为「已修正」；DOM 变更对照两处口径按实测纠正；补记 `/stars/{login}`。

## 8. 风险与已知局限

1. **归属判定依赖无官方契约的页面 meta**（`octolytics-actor-id` / `dimension-user_id` / `user-login`）。一旦 GitHub 改名或移除，判定退化为 `unknown` ⇒ 本人页也会退回原生列表（功能降级、无数据损坏、无写操作）。同类前例：`csrf-token` meta 已消失。真机复查手法：只读探针枚举 `document.querySelectorAll('meta')`。
2. **`/stars/{login}` 的条目 DOM 未实证**（research §8-2）⇒ T8 必须真机核对；未命中即静默跳过徽章（不报错、不猜）。
3. **只读模式在「该页没有任何标签/备注」时完全不可见**（V3 的必然结果）：用户不会看到任何脚本痕迹。若被误认为「脚本失效」，TM 菜单仍在（同步/恢复可用）——这是刻意的静默。
4. **私有仓库 star**（他人页是否出现、结构是否一致）未验证（research §8-8）⇒ 取不到标识符就跳过。
5. **登出用户失去标签/备注可见性**（V4）：有意取舍，可在审查时改。
6. **「同页内点击原生星按钮后 `on` 是否立即翻转」未测**（research §8-6）：只读模式不依赖它（脚本不渲染星状态）；将来若要做「只读星标指示」需先测。
7. **窄视口未验证** `on` 是否照旧渲染（research §8-1）：不影响本方案（窄视口完全惰性）。
8. **命名空间的连带行为变化**：`exportImport` 的 `user.id` 从页面主人改为登录者 id ⇒ 在他人页导出/导入时行为变化（此前会写出对方的 id、且导入校验比对对方的 id）。这是修正，但属可观察变化，需在 T9 写明。

## 9. 回滚与文档影响

- 代码回滚点单一：摘掉 `transformAndReveal` 的分派 + 删 `pageScope.ts` / `readonly.ts` / `readonly.css` + 撤 `viewTeardown` 第 11 项。命名空间改造（4.4）与只读模式**互相独立**，可单独回退（回退后仍建议保留 actor-id 版本，因为它修的是真缺陷）。
- 文档：AGENTS.md（决策条目、已知风险 16、DOM 对照两处）、DEVELOPER.md（模块职责与入口）、新增 `docs/adr/0008`。
- 清理：删除上一轮遗留的 `docs/plans/2026-10-03-非本人-star-页面-他人的-user-tab-stars-实现只读阉割模式-不拉整库-api.md`（内容已被本文件完整取代）。
- 本方案文档完成后归档到 `docs/plans/archive/2026/`。
