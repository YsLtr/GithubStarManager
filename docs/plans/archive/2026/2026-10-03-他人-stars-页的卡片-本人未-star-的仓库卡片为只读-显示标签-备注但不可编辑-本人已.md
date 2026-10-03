---
title: 他人 stars 页卡片按「本人是否 star」逐卡片决定标签/备注可编辑性
status: done
created: 2026-10-03
session: 01a1019d-a27d-75a0-ac30-e74d88bb2f0e
approved: 2026-10-03
completed: 2026-10-03
---
# 他人 stars 页：按「本人是否 star」逐卡片决定可编辑性

- 状态：**待审查**
- 版本目标：**4.14.0**（改动触碰他人页核心契约，且用户可见行为变化）
- 相关模块：`src/filters.ts`、`src/readonly.ts`、`src/starCheck.ts`、`src/ui/cards.ts`、`src/ui/tagFilter.ts`、`src/viewContext.ts`、`src/storage/pendingDelete.ts`
- 相关文档：`docs/adr/0009-other-users-stars-page-readonly-grid.md`（需追加口径收窄）、`AGENTS.md` D26
- 调研证据：`.pi/tmp/research-other-stars-editable-cards.md`（联网，536 行）、`.pi/tmp/scout-other-stars-editstate.md`（代码库现状，193 行）

---

## 1. 目标与用户场景

用户在**他人的 stars 页面**网格卡片上：

1. 本人**已 star** 的仓库 → 卡片的标签/备注**可编辑**（可加标签、删标签、改备注）。
2. 本人**未 star** 的仓库 → 卡片**只读**（显示已有标签/备注文本，无任何编辑控件）。
3. 在卡片上点 star → 该卡片**变为可编辑**；点 unstar → 立刻**变为不可编辑**。
4. unstar 之后，若该仓库**仍在本人的 24 小时宽限期缓冲列表（`stars_pending_delete`）里** → 卡片的标签与备注**继续显示**（数据来自宽限期备份），但**不可编辑**。

一句话：**可编辑性 = 「本人已 star」这个逐仓库事实；可见性 = 「数据还在（活区或宽限期备份）」这个逐仓库事实。两者解耦。**

---

## 2. 缺陷根因（现状，带证据）

| 现象 | 根因 | 证据 |
|---|---|---|
| 「点了 star 就整页变成可编辑」 | 只读是**视图级单一布尔**，不是逐仓库状态 | `src/viewContext.ts:70-72` `isReadOnlyView()` 只判 `otherPage !== null`；`src/filters.ts:256` 取一次、`:286-294` 用它决定**全部**卡片的标签/备注渲染器 |
| 点 star 后卡片真的换成可编辑控件 | 点击成功的副作用链**无条件**调可编辑渲染器，且全函数无只读判断 | `src/ui/cards.ts:175` → `src/starCheck.ts:147-150`（`renderTags` / `renderNotes`，二者直接绑 `saveTags` / `saveNote`） |
| unstar 后标签/备注立刻消失 | `markRepoUnstarred` 把标签/备注搬进备份并**清空活区** | `src/storage/pendingDelete.ts:70-84`（`:76-77` 备份、`:82-83` 清空、`:80-81` 从 cache 删除） |
| 「24h 内仍显示」目前**无任何实现** | 没有任何渲染器从 pending 读数据 | `src/readonly.ts:82-102` 的只读渲染器只读 `getTags` / `getNote`（活区） |
| 在他人页筛过东西后再点 star，会去改**别人页面**的原生筛选栏 | `applyFilters` 只有 `!isDesktop()` 一道门；`filterState` 是跨页共享模块态且进出他人页**不清** | `src/filters.ts:431-442`（`:439` `updateLocalFilterControls` → `:584-595` 对原生菜单 `hideNativeNode`、`:442` `refreshTagFilterBar`、`:466` 信息条）；`src/starCheck.ts:154` 是唯一能间接激活它的路径；`src/viewContext.ts:12-21` 明确 filterState 跨页保留 |

补充：`other-starstate` 夹具场景点了星也取消了星，但**只断按钮状态**，不查渲染器类型与写入增量 ⇒ 本缺陷在现有夹具下一路漏过（`.diag/assert-otherstars.js:293-343`）。

---

## 3. 设计

### 3.1 卡片三态（单一判据导出）

判定函数（放 `src/viewContext.ts`，因为它需要 `starOverrides`；只读是纯判定、不建节点）：

```
type CardState = 'editable' | 'locked-pending' | 'locked-empty';

isStarredByViewer(repoId)  // 既有逻辑，从 filters.ts:264-267 上移：
  = getViewStarOverride(repoId)  // 本页写入成功后的内存覆盖
    ?? !!viewerCache?.[repoId]    // 本人整表缓存成员关系

getCardState(repoId):
  if (!hasApiData() || !getViewerId()) return 'locked-*'   // 宁缺勿假（D9）
  if (isStarredByViewer(repoId))       return 'editable'
  if (pendingInGrace(repoId))          return 'locked-pending'   // 24h 内
  return 'locked-empty'
```

- `pendingInGrace(repoId)`：`pending[repoId]?.unstarredAt + GRACE_PERIOD > Date.now()`，**渲染时现算**，不依赖 `cleanupExpiredUnstarred()` 是否跑过（它只在 `init()` 与导入后跑：`src/index.ts:56`、`:568`）。
- 三者的渲染差异：

| 状态 | 数据来源 | 渲染器 | 控件 |
|---|---|---|---|
| `editable` | 活区 `getTags` / `getNote` | 可编辑渲染器（带上下文开关） | 有 + / × / textarea |
| `locked-pending` | 宽限期备份的 `_tags` / `_note` | 只读渲染器 | 无 |
| `locked-empty` | 活区（通常为空） | 只读渲染器 | 无 |

> 读侧统一为「**活区优先，活区为空再看宽限期备份**」；两者不会同时有值（`markRepoStarred` 会把备份还原进活区并删除备份条目）。

### 3.2 渲染分派点必须唯一

新增 `src/cardAreas.ts`（或在 `readonly.ts` 内新增导出，二者取其一，实现时定），唯一导出：

```
renderCardTagAndNoteAreas(card: HTMLElement): void
```

职责：读 `card.dataset.repoId` → 算状态 → 调对应渲染器 → 在卡片两个区域容器上写身份标记属性 `data-gsm-card-state="editable|pending|empty"`（纯属性、无样式、随节点销毁）。**所有**渲染入口只许走它：`filters.renderBrowsePage` 的循环、`starCheck.syncCardAfterStarChange`、以及未来任何重绘点。禁止再出现第二处 `readOnly ? A : B` 三元式——今天的缺陷正是分派漂移的产物。

### 3.3 写路径

- **乐观性**：可编辑性只认「已提交」状态（内存覆盖表 / 整表缓存），**不**读按钮 DOM class、**不**读在途请求。点 star 后进卡片仍是只读，成功回调的重绘才补上控件。（代价：成功后约 1 个队列间隔内仍是只读，可接受；避免「写失败回滚后星星已回退、标签却已改」的不一致。）
- **宽限期备份的建立判据**：`markRepoUnstarred(repoId, seed?)` 改为「**有东西要保全就必须建备份**」——`cache[repoId]` 存在，**或** `seed` 给出（他人页卡片的投影数据），**或**该 repoId 有非空标签/备注 ⇒ 建 pending 条目；三者皆无 ⇒ 什么都不做。
  理由：今天缓存里没有该条目时 `markRepoUnstarred` 直接 `return`（`src/storage/pendingDelete.ts:72-73`），而他人页允许「star（只在内存覆盖里）→ 加标签 → unstar」这条顺序 ⇒ 标签会**永远**留在活区，而只读卡片又没有删除入口，用户再也清不掉它。
- **标签渲染器的上下文开关**：`renderTags(container, opts?)`，`opts.filterToggle = false`（他人页）时 ① 胶囊不绑「切换筛选」点击；② 不加 `stars-tag-active`；③ 保存后不调 `applyFilters()` / `refreshTagPillStates()`。默认 `true` = 与今天逐字相同的行为（本方自己的页零变化）。`renderNotes` 无需改动（其编辑路径本就不依赖 `applyFilters`）。
  **不**新写一份他人页专用可编辑渲染器——两份实现必然漂移，而漂移就是本次要修的缺陷。
- **`applyFilters` 补只读门**：首部增加 `if (isReadOnlyView()) return;`（与既有 `!isDesktop()` 门并列），并在 `syncCardAfterStarChange` 的 `applyFilters` 之前判视图（他人页直接 return）。

### 3.4 观感与提示

- 只读态**不新增任何可见装饰**：不加说明行、不加徽章、不加禁用态控件。唯一提示是只读节点的原生 `title`，按状态分叉：
  - `locked-pending` → 「已取消 star：标签与备注保留 24 小时，期间不可编辑」
  - `locked-empty` / 无数据 → 无节点、无提示（沿用现状行为）
- 只读样式继续走既有的 `src/styles/readonly.css`（`.gsm-ro-tags` / `.gsm-ro-tag`，整体在桌面断点内），**不新增**他人页专属样式表。标签行/备注行的高度稳定性由既有 `min-height` 保证（`src/styles/base.css:235-241` 22px、`:346-352` 20px），控件增减不改变卡片高度。
- `role` / ARIA：**不**加 `role="textbox"` + `aria-readonly`、**不**加 `inert`、**不**用 `aria-disabled` 的禁用态控件（研究结论：`aria-readonly` 只对 9 个 widget role 有效，把「标签+备注」这一簇编辑入口包进 textbox 是错误语义；`inert` 无默认视觉提示；整簇禁用会踩禁用态的全部负面项）。
- 焦点回收（最小必要）：派发函数在重绘前记 `wasFocused = card.contains(document.activeElement)`，重绘后若为真则把焦点交给该卡片的星按钮（无按钮时交给卡片自身并加 `tabindex="-1"`）。常见路径（点星按钮）本就无焦点丢失，这条只为「后台同步判定外部取关时用户正聚焦在卡片内的编辑控件」兜底。
- 不做主动播报：不加 `aria-live` / `role="status"` 区域（无 WCAG 条款要求「控件消失必须播报」；4.1.3 只约束**已经存在**的状态消息）。

### 3.5 回滚与痕迹（D20 纪律）

- 本次**不新增任何页面级持久状态**：无新存储键、无新页面级标记。
- 不写 GitHub 原生节点的任何属性 ⇒ 不需要 `GSM_HIDDEN_ATTR` 这类标记。
- 新增的卡片内节点全部住在 `.stars-grid-container` 内，随网格节点被 `src/viewTeardown.ts:39-41`（第 2 项）一并删除；只读样式表沿用 `src/readonly.ts` 的 `styleEl` 句柄 + `exitReadOnlyMode()`（由 `exitOtherStarsView()` 调用，`src/otherStarsView.ts:162-174`）。
- `data-gsm-card-state` 是**挂在自造节点上的身份属性**，随节点销毁，不进回滚清单；但要在 `viewTeardown` 第 2 项的注释与夹具断言里登记（便于断言与排查）。
- 窄视口（D18）：所有新增路径都在 `enterOtherStarsView()` 的 `isDesktop()` 门之后，`applyFilters` 也只读门之外仍有 `!isDesktop()` 门 ⇒ 零痕迹不变。

---

## 4. 具体改动清单（文件级）

| # | 文件 | 改动 |
|---|---|---|
| C1 | `src/viewContext.ts` | 新增 `getViewerCache()`、`isStarredByViewer(repoId)`（从 `filters.ts` 上移）、`isRepoEditable(repoId)`、`isRepoInGrace(repoId)`、`readCardDisplayData(repoId)`（活区→备份的读侧回退）、`CardState` 类型 |
| C2 | `src/cardAreas.ts`（新，或并入 `readonly.ts`） | 唯一分派 `renderCardTagAndNoteAreas(card)` + `data-gsm-card-state` 标记 + 焦点回收 |
| C3 | `src/readonly.ts` | `renderTagsReadOnly` / `renderNotesReadOnly` 支持传入数据（而非只读活区）；`BADGES_TITLE` 拆成 pending / 默认两条文案 |
| C4 | `src/filters.ts` | 渲染循环改调 C2 的分派；`applyFilters` 首部加 `isReadOnlyView()` 门；`canShowStar` / `viewerCache` / `isStarredByViewer` 迁往 C1 |
| C5 | `src/starCheck.ts` | `syncCardAfterStarChange` 改为视图感知：按钮外观照旧 → 调 C2 分派 → 他人页直接 return（不调 `applyFilters`） |
| C6 | `src/ui/tagFilter.ts` | `renderTags(container, opts?)` 增加 `filterToggle` 上下文开关（默认 true） |
| C7 | `src/ui/cards.ts` | unstar 分支传 `seed`：`markRepoUnstarred(repoId, data)` |
| C8 | `src/storage/pendingDelete.ts` | `markRepoUnstarred(repoId, seed?)` 的建立判据（见 3.3）；新增 `getPendingInGrace(repoId, now?)`（与 `listRestorable` 同判据、单条查询） |
| C9 | `src/styles/base.css` | 仅在需要时补 `.gsm-ro-*` 在可编辑卡片旁的对齐细节（预计**不需要**改动；若要改，只动脚本自有 class） |
| C10 | `docs/adr/0009-*.md` | 追加一节：零写入口径收窄为「渲染路径零写入，用户动作才写」+ 三态模型 + 逐仓库可编辑 |
| C11 | `AGENTS.md` | D26 补逐仓库可编辑性；「验证」小节更新夹具场景与断言清单；新增 D29 条目 |
| C12 | `package.json` / `vite.config.ts` | 版本 4.13.0 → 4.14.0（`vite.config.ts` 读 `package.json`，改一处） |
| C13 | `.diag/gen-otherstars-harness.cjs` | 新增场景 `other-editstate`（混合可编辑/只读）、`other-pending`（宽限期内只读但显示数据）、`other-nocache-edit`（无缓存 ⇒ 全只读） |
| C14 | `.diag/assert-otherstars.js` | 新断言组 R21（混合态）/ R22（unstar → 只读 + 备份仍在 + 写入增量）/ R23（24h 边界：过期备份不显示）/ R24（他人页零筛选控件）；既有零写入断言改为**按场景**表达 |

---

## 5. 验收标准

### 5.1 静态
- `pnpm check` 绿（tsc + build）。
- `node scripts/verify-css.cjs` EXIT 0。
- `pnpm test:exportimport` 51/0（不回归）。
- dist 头部 `@grant` **恰 5 项**；`@version` 为 4.14.0。

### 5.2 夹具（`.diag/otherstars-harness.html`，**URL 必须带 `?tab=stars`**）

| 断言 | 期望 |
|---|---|
| R21 混合态 | 同一页上同时存在 `data-gsm-card-state="editable"`（有 `.stars-tag-add`，点击可进 `.stars-tag-input`）与 `="pending"/"empty"`（0 个可编辑控件、`.gsm-ro-*` 存在）；`__errors` 空 |
| R22a 点 star 后 | 该卡片 `state` 由 locked-* 变 `editable`、出现可编辑控件、`.gsm-ro-*` 从该卡片消失；**其它卡片状态不变** |
| R22b 点 unstar 后 | 该卡片立刻变只读（0 个可编辑控件）、**标签/备注仍显示**（来自备份）、`data-gsm-card-state="pending"`；`__gmWrites` 有且仅有预期的写入（pending + 活区清空） |
| R22c 24h 边界 | 把备份的 `unstarredAt` 改到 25h 前 ⇒ 只读渲染且**无数据**（不显示标签/备注）；改到 23h 前 ⇒ 显示 |
| R23 他人页零筛选污染 | 先在 own 场景筛一个标签，再进入他人页并点星 ⇒ 原生筛选行**无** `.gsm-type-filter` / `.gsm-lang-filter` / `.gsm-sort-filter` / `.stars-tag-filter`，原生三个菜单未被 `display:none`，无 `.stars-tag-info-bar` |
| R24 零网络不变 | 他人页所有场景 `__gsmFetchLog.length === 0`（含点星、编辑标签/备注全过程） |
| R2（改口径后） | 「本人缓存与页面无交集」的场景下 `inputs/textareas/tagDel/tagAdd === 0`；渲染路径 `__gmWrites` 为 0；**新增**断言允许用户动作后的写入 |
| 窄视口 `#narrow` | 全部场景零痕迹不变（无 `gsm-*` 节点、无标记、无内联 display、`grid=0`） |
| 自己的页 `own` | 零回归：可编辑控件、脚本分页器、顶部翻页器、已 star 悬停才现身的观感全部照旧 |

### 5.3 真机（登录态，`getAnimations().finish()` 冻结过渡后量测）
- 打开一个他人 stars 页（本人缓存的成员关系与页面有交集，可用本地缓存手工构造交集）。
- 点 star → 卡片出 `+` 与备注编辑入口；输入标签后回车保存 → 存储里写入的是 `stars_tags_<登录者 id>`。
- 点 unstar → 编辑控件消失、标签与备注**仍在**（只读文本）。
- 打开 TM 菜单 → 恢复该仓库 → 卡片回到可编辑且数据完好。
- 全程 DevTools Network 面板**零请求**（`api.github.com` 无新增）。

### 5.4 独立审查轮
发布前再跑一轮外部审查（只读复核 + 自建复现实验），重点：`applyFilters` 门是否真的拦住他人页、写路径是否只触及登录者命名空间、夹具新场景是否只是「碰巧全绿」。

---

## 6. 口径变更与不可逆点

1. **放宽 D26「零存储写入」**为「页面加载与渲染路径零写入；用户显式动作（点星、增删标签、写备注）才写，且只写登录者命名空间」。**零网络不放宽**。
2. `markRepoUnstarred` 的语义从「缓存里有它才备份」变为「有东西要保全就备份」⇒ 在他人页 unstar 一个从未进入整表缓存的仓库，会产生一条 pending 条目；若随后 re-star，该仓库会**进入本人整表缓存**（`markRepoStarred` 的既有行为）。后者是行为变化，需要在新 ADR 一节里写明（这是**正确**的：此刻我确实 star 了它）。
3. `applyFilters` 新增只读门 ⇒ 他人页再也无法通过任何间接路径触发筛选管线（此前只在入口处绕过，属防御性收口）。

---

## 7. 已知局限与风险

1. **可编辑性依赖本人整表缓存的时效**：他人页不在我的缓存里但已被我在别处 star 的仓库（例如刚在 github.com 原生界面 star、脚本尚未同步）会显示为只读。这是「不拉取」的必然代价；重新全量同步即可修正。
2. **本页新 star 且从未在缓存里的仓库**：可编辑性只在本次页面会话有效（内存覆盖表），刷新页面后回到只读——直到下一次全量同步把它写进缓存。属预期。
3. **陈旧数据窗口仍存在**：交付物不引入任何请求，宽限期判据用本地时钟现算；系统时钟被改会造成窗口偏移（`listRestorable` 同源，非本次引入）。
4. **`data-gsm-card-state` 是新增的身份属性**：只挂自造节点、随节点销毁；若未来有人按它做样式，需记得它不参与回滚（它跟着节点走）。
5. 夹具 `__gmWrites` 的断言口径改为「按场景表达」后，**必须保持**既有场景的零写入断言不被削弱（否则等于放松了 D26 的护栏）。

---

## 8. 可变决策（默认值即执行值，供审查逐条过目）

| # | 选择 | 已生效默认值 | 依据 | 改动代价 |
|---|---|---|---|---|
| V1 | 他人页是否允许真的写入标签/备注 | **允许写入**，仅限本人已 star 的卡片，且只写登录者命名空间；渲染路径仍零写入，零网络不变 | 需求要求「unstar 后仍显示标签与备注」，不开放写入则退化为纯只读展示；`docs/adr/0009:24`、`AGENTS.md` D26 为现行原文 | 中 —— 需同步改 ADR 0009、AGENTS.md、夹具断言口径 |
| V2 | 只读卡片的编辑控件处置 | **完全不渲染**（不建禁用态按钮、不建只读输入框） | 调研 §6：`aria-readonly` 仅限 9 个 widget role、`inert` 无视觉提示、整簇禁用踩禁用态全部负面项 | 低 |
| V3 | 宽限期内是否显示一行可见状态说明 | **不显示**，仅只读节点 `title` 按状态分叉 | 用户既往裁定「不加说明行/提示条」；调研虽建议显示，但明确「未找到 WCAG 强制要求」 | 低 —— 本方案最可能有分歧处，请重点过目 |
| V4 | 状态切换是否给屏读用户程序化播报 | **不注册**（不加 `aria-live` / `role="status"`） | 调研 §3：无 WCAG 条款要求「控件消失必须播报」；4.1.3 只约束已存在的状态消息 | 低 |
| V5 | 可编辑性是否跟随星按钮的乐观翻转 | **只认已提交状态**（内存覆盖表 → 整表缓存） | `src/ui/cards.ts:139` 乐观翻转 vs `:170-173` 成功后才落数据；调研 §5（可编辑性须与已提交状态同源） | 低 |
| V6 | 无本人缓存 / 未登录访客的可编辑性 | **一律不可编辑**（仍可只读显示） | 复用既有 `canShowStar` 的宁缺勿假口径（`src/filters.ts:262`） | 低 |
| V7 | 他人页「点标签 = 切换筛选」是否保留 | **关闭**：点标签不筛选、不加选中高亮、保存后不调 `applyFilters()` | 他人页无筛选栏，`queryRepos` 对投影刻意忽略 `filterState`（`src/filters.ts:95-101`） | 低 |

---

## 9. 任务清单

| # | 任务 | 验收 |
|---|---|---|
| T1 | 状态判定层：`viewContext` 的三态判定与读侧回退 | 纯逻辑可在无 DOM 环境下断言；`own` 视图下前后行为逐字不变 |
| T2 | 唯一分派 `renderCardTagAndNoteAreas` + 焦点回收 + `data-gsm-card-state` | `grep` 确认全仓库只有一处 `readOnly ? ... : ...` 的标签/备注分派 |
| T3 | 写路径：`markRepoUnstarred(seed?)` 的建立判据 + `getPendingInGrace` | 单测/夹具证明「无缓存但有标签」的 unstar 会建备份，且 24h 后消失 |
| T4 | `renderTags` 的 `filterToggle` 上下文开关 | `own` 场景回归全绿；他人页点击标签不产生筛选副作用 |
| T5 | `syncCardAfterStarChange` 视图感知 + `applyFilters` 只读门 | 新断言 R23 证明他人页零筛选污染 |
| T6 | 只读文案分叉与样式收口（V3 默认值） | 夹具断言 title 文案按状态分叉；只读卡片样式无新增可见装饰 |
| T7 | 夹具与断言：新场景 + 零写入断言按场景改写 | 新增 R21–R24 全绿；既有 13 组场景零回归 |
| T8 | 文档与版本：ADR 0009 追加、AGENTS.md D26/D29、版本 4.14.0 | `pnpm check` 绿、`verify-css` EXIT 0、51/0、`@grant` 恰 5、`@version` 4.14.0 |
| T9 | 真机验证（登录态）+ 独立审查轮 | 见 §5.3 / §5.4 |

---

## 10. 引用

- 本仓库调研：`.pi/tmp/research-other-stars-editable-cards.md`（§1 `aria-readonly` 适用范围、§3 状态切换与焦点、§4 软删除惯例、§5 乐观 UI、§6 隐藏 vs 禁用对照表）、`.pi/tmp/scout-other-stars-editstate.md`
- W3C WAI，*Understanding SC 4.1.3: Status Messages* — <https://www.w3.org/WAI/WCAG22/Understanding/status-messages>
- W3C WAI，*ARIA22: Using role=status to present status messages* — <https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA22>
- medialize/ally.js，*Mutating the active element*（浏览器实测：移除焦点元素一律回退 `<body>`） — <https://github.com/medialize/ally.js/blob/master/docs/tutorials/mutating-active-element.md>
- Smashing Magazine，*Hidden vs. Disabled In UX*（判据：「用户以后还能交互吗」） — <https://www.smashingmagazine.com/2024/05/hidden-vs-disabled-ux/>
- USWDS，*Disabled States Research Findings 2023* — <https://github.com/uswds/uswds/wiki/Disabled-States-Research-Findings-2023>
- MDN，`aria-readonly` — <https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-readonly>
- MDN，`inert` — <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/inert>
- React，`useOptimistic`（失败回滚到乐观更新前的样子） — <https://react.dev/reference/react/useOptimistic>

```text
Verdict: Compose — 「逐仓库三态判定 + 单一渲染分派 + 复用既有可编辑渲染器（加上下文开关）」 — 依据：无现成库/组件可采纳（本仓库自有的只读渲染器与可编辑渲染器都已存在，缺的只是分派判据）；联网证据否决了 ARIA 只读语义与 inert 两条现成路线，产品惯例与 WCAG 4.1.3 只给出「要能被感知」的判据而无现成构件，故以「复用既有渲染器 + 一个上下文开关 + 一个纯判定函数」组合实现，最小改动面。
```
