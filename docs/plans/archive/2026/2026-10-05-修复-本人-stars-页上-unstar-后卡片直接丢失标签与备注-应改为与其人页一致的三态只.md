---
title: 修复本人 stars 页 unstar 后卡片标签/备注改为只读显示（不再消失）
status: done
created: 2026-10-05
session: 01a10b57-a4fa-75a7-99e9-56b8ed94b278
approved: 2026-10-05
completed: 2026-10-05
---
# 本人 stars 页 unstar 后卡片标签/备注改为只读显示

- 状态：**待审查**（本轮只规划，不改代码）
- 版本目标：**4.16.2**（V4/V7，用户 2026-10-05 最终裁定）。上一批（`src/filters.ts` 的滚动位置修复）已作为
  **4.16.1** 落地（commit `1f9c1ac`，「fix(filters): preserve scroll position when re-rendering the grid」，
  `package.json` 现为 4.16.1）⇒ 本批次作为 **4.16.2** 单独提交，与它不再交叉。
- 证据来源（写作前我逐条复核过 `file:line`）：
  - `.pi/tmp/scout-ownpage-unstar.md`（本仓现状地图，101 行）
  - `.pi/tmp/research-unstar-local-metadata.md`（联网调研：GitHub 官方零撤销 + 生态先例，Verdict = Compose）

---

## 1. 缺陷与目标

### 1.1 用户报告

> 当前 unstar 后，非本人页面的卡片变为只读，但是本人页面的卡片却直接不显示 tag 和 note。需要修复此问题，让本人页面 unstar 后也变为只读而不是直接消失。

### 1.2 根因（已实证，非推测）

`renderCardTagAndNoteAreas(card, view, viewerCache)` 是标签/备注区的**唯一分派点**（`src/cardAreas.ts:39`），但它对两个视图的处置不对称：

| 视图 | 现状 | 位置 |
|---|---|---|
| `'other'` | 逐仓库三态 → 只读时读**宽限期备份**，数据仍显示 | `src/cardAreas.ts:63-64` → `src/cardState.ts:110-116` |
| `'own'` | 无条件调可编辑渲染器，只读**活区** | `src/cardAreas.ts:49-51` |

而点卡片星按钮取消 star 时，`markRepoUnstarred()` 会把标签/备注**搬进** `stars_pending_delete` 备份并**清空活区**：

```
src/storage/pendingDelete.ts:120  saveTags(repoId, []);
src/storage/pendingDelete.ts:121  saveNote(repoId, '');
src/ui/cards.ts:173               markRepoUnstarred(repoId, data)   // 星按钮成功回调
src/ui/cards.ts:177               syncCardAfterStarChange(repoId, target)
src/starCheck.ts:155              if (isReadOnlyView()) …           // own 页为假
src/starCheck.ts:160              renderCardTagAndNoteAreas(card, 'own')
src/cardAreas.ts:49-51            renderTags / renderNotes          // 只读活区 = 空
```

⇒ 本人页上：标签胶囊整行消失、备注只剩「添加备注…」占位；而数据其实还在备份里、24h 内点星即可完整恢复。

**同一份数据**，他人页显示、本人页不显示 —— 这不是两个功能，是**同一个概念的两处判据**。这与 4.14.0 修掉的
「两处判据不一致」（AGENTS.md D29）是同一种缺陷模式，只是这次的漂移轴从 `filters`/`starCheck` 换成了 `own`/`other`。

### 1.3 目标（完成判据）

1. 本人 stars 页点卡片星按钮取消 star 后，**该卡片的标签与备注立即变为只读展示**，内容与整页重绘前逐字一致；
2. 同一张卡片上**没有**任何编辑控件（无 `+`、无 `×`、无 `input`、无 `textarea`），点备注区不弹编辑器、不写盘；
3. 24h 内点该卡片星按钮重新 star ⇒ **立即回到可编辑**、数据完好（`markRepoStarred` 既有路径）；
4. 24h 过后该卡片若仍在网格里 ⇒ 只读**且不再显示**备份数据（超期即删，ADR 0003）；
5. 本人页上未被取消 star 的卡片**逐字保持今天的行为**（可编辑、`R27` 的备注提交写路径不得回归）；
6. 渲染路径**零新增**存储写入、**零新增**网络请求（D26/D29 硬不变量）。

### 1.4 非目标（明确不做）

- 不改查询/分页/筛选：已 unstar 的仓库在**下一次整页重绘**时照旧从网格消失。
  **用户 2026-10-05 已确认**：「本人页面的只读只是 unstar 后的临时显示态，重渲染/刷新后应当不存在，进去宽限区。」
- 不给「没 star、只有导入标签」的卡片加只读。**用户 2026-10-05 已答**：「那应该不显示才对」。
  核对后确认这与现有实现一致 —— **本人页的卡片只来自本人整表缓存**（own 路径是 `for (const repoId in cache)`，
  `src/filters.ts:106-112`），未 star 的仓库在 unstar 时已被移出缓存 ⇒ 这类卡片在本人页**根本不会被渲染**。
  本项因此是「记录既有不变量」，不是新增行为。
  ⚠️ 用户原话里的「直接进入宽限区」在**导入路径**上可能与现有实现不同（导入的标签落在未 star 仓库上时，
  现行行为是留在活区、无 UI 入口），已提为 **V8** 交用户确认 —— 默认**不做**导入期搬迁，理由是 24h 后会被永久删除。
- 不处理「只读卡片没有删除入口」这个既有缺口：**用户 2026-10-05 已确认**，本人页只读是临时态，
  重渲染/刷新后卡片不存在，数据在宽限区内、由 TM 菜单「恢复取消的 star」承接。
- 不动他人页的任何行为（本修复只在 `view === 'own'` 分支内生效）。

---

## 2. 设计（P1 自问自答的结论）

### D1 · 修复落点：own 分支内新增一支，判定仍在 cardState

`src/cardState.ts` 负责**判定 + 取数**（唯一实现），`src/cardAreas.ts` 只负责**渲染分派**（唯一入口）。

```
renderCardTagAndNoteAreas(card, 'own')
  ├─ 命中 24h 宽限期备份 → 只读渲染（readonly.ts 既有渲染器 + CARDS_TITLE_PENDING）
  └─ 其余（含活区有数据、活区为空、无身份）→ 可编辑渲染（今天的行为，逐字不变）
```

**不**在 `cardAreas` 里内联写 `getPendingInGrace` 判据 —— 判定逻辑只住 `cardState.ts`，否则就是给
同一个概念再开第二处判据。调用点签名不变，`src/filters.ts:302` / `src/starCheck.ts:156,160` 三处实参不动。

### D2 · own 视图判定收窄为二态（`editable` / `locked-pending`），不引入 `locked-empty`

**如果 own 直接复用 `getCardState(repoId, loadViewerCacheForView())` 三态，会造成两类回归：**

1. **`viewerCache === null` 时 `getCardState` 永不返回 `'editable'`**（`src/cardState.ts:97-100`，scout 报告 §3 已实证），
   而 `loadViewerCacheForView()` 依赖页面 meta `octolytics-actor-id`（`src/cardState.ts:61,91`）——
   该 meta **无官方契约**（AGENTS.md 已知风险 13：`csrf-token` 前例「曾普遍存在、如今完全消失」）。
   一旦它改名或消失，**本人页全部卡片会失去编辑能力**：用户再也加不了标签、写不了备注。
   那是比本缺陷严重得多的回归。
2. **`locked-empty` 会顺带收掉「导入标签落在未 star 仓库上」那些卡片现存的编辑/删除入口**
   （AGENTS.md 已知风险 17②；本项目有导入功能，这条路径真实存在），属超范围的行为变化。

⇒ own 视图**只查宽限期备份这一件事**：`hasViewerIdentity() && getPendingInGrace(repoId)` 命中即为
`locked-pending`，否则为 `editable`。**不读** `viewerCache`、**不读**整表缓存成员关系。

*取舍记录*：由此会留下一个小不一致 —— 「本人页上没 star 但活区有标签」的卡片仍可编辑（V1）。代价是文档里
多一句解释；换来的是「meta 失效时本人页编辑能力不受影响」这条安全边界。

**用户 2026-10-05 裁定（V1）**：这类卡片「应该不显示才对」。核对后确认：**本人页的卡片只来自本人整表
缓存**（`src/filters.ts:106-112` 的 `for (const repoId in cache)`），凡未 star 的仓库在 unstar 时已被
`markRepoUnstarred` 移出缓存 ⇒ 它们**从不进入网格**，所以本项在实现上为空、与 D2 的二态收窄一致（都不给
这类卡片造一个只读态）。差异只在**数据生命周期**：用户希望数据「直接进宽限区」，而现行行为是数据留在活区、
无 UI 入口。该差异只在**导入路径**上真实存在 ⇒ 提为 **V8** 交用户确认。

### D3 · 取数逻辑拆成「判定」「取数」两步，own / other 共用取数

`readCardDisplayData` 从「自己算 state 再取数」改为**接受已算好的 state、只负责取数**：

```ts
readCardDisplayData(repoId: string, state: CardState, now = Date.now()): { tags, note }
```

- 活区优先（`getTags` / `getNote`）；
- 活区为空 **且** state 为 `locked-*` ⇒ 读 `getPendingInGrace(repoId, now)` 的 `_tags` / `_note`；
- 宽限期是**单份全局键、不按账号分片** ⇒ `hasViewerIdentity()` 这道门**保留在取数函数内**
  （未登录访客不得看到「上一个登录者」的私密数据，4.14.0 审查 P2）。

调用方各自先取 state：other 用 `getCardState(repoId, viewerCache)`，own 用新增的 `getOwnPageCardState(repoId)`。
两个具名入口同住 `cardState.ts`，比给 `getCardState` 加 `view` 参数更清楚（后者的 `viewerCache` 语义在 own 下无意义）。

**行为不变式（必须保住）**：own 的 `editable` 分支中活区为空时**仍然返回空**，不得去读备份 ——
本页从没 unstar 过的仓库若恰好命中了同一 repoId 的一条陈旧 pending 条目，会凭空显示一份不属于它的数据。

### D4 · 只读形态复用既有件，不新增控件与提示

- 渲染器：`readonly.ts` 的 `renderTagsReadOnly` / `renderNotesReadOnly`（4.14.0 已改为**接受调用方传入的数据**，
  正是为这种场景准备的）；
- 文案：`CARDS_TITLE_PENDING`（「已取消 star：标签与备注保留 24 小时，期间不可编辑」）挂在节点原生 `title` 上，
  **不做**可见说明行/横幅/恢复按钮（用户 2026-10-03 与 4.14.0 两次裁定；AGENTS.md D29）；
- 恢复入口：卡片上那个已变成未加星外观、可再点的星按钮（`markRepoStarred` 还原活区 + 缓存 ⇒ 本次会话内立即恢复可编辑）；
- 必须调 `disposeNotesEditor(notesContainer)`（既有 P1 防线，`src/cardAreas.ts:74`）——
  备注编辑监听挂在**被复用**的容器上，`innerHTML = ''` 摘不掉；不调就会「只读卡片点一下仍能写盘」。

**联网调研印证**（`.pi/tmp/research-unstar-local-metadata.md`，Verdict = Compose）：
GitHub 官方**零撤销、零宽限期**（`DELETE /user/starred/{owner}/{repo}` 文档全文无 undo/grace 字样），
本地兜底是唯一可恢复路径；生态已有同类先例 —— `izumi0uu/better-github-stars-manager`（231★，2026-10-01）
unstar 后保留 tags/notes 不删、`po4yka/ratatoskr-vault`（2026-10-01）用固定 grace window + tombstone；
命名有权威背书（vocab.design 的 holding place、NN/g #3 的 undo、Trust-over-IP 的 tombstone 规范）。
反例 `astralapp/astral`（3585★）是**立即删除**——所以本脚本的宽限期是**取舍**而非行业共识，
但「期间数据继续可见」与既有机制一致，无需改机制，只改呈现分派。

### D5 · 只读形态只在「不改动列表的路径」上成立（卡片随后重绘会消失）

`markRepoUnstarred` 会 `delete cache[repoId]`（`src/storage/pendingDelete.ts:118-119`），
所以下一次整页重绘（有激活筛选时的 `applyFilters({keepPage:true})`、同步后重渲染、翻页、导入后重绘）
时 `queryRepos()` 不再产出该仓库，卡片从网格消失。**不为此把 pending 条目注入查询结果**：
那会让「已 unstar 的仓库继续出现在我的 stars 列表里」，与 unstar 语义冲突，
且要给查询管线（`src/filters.ts:98-105`，两条来源）新增第三条半来源，牵动分页计数与筛选 facet。

*用户可观察的语义*：点取消 star 那一刻起，这张卡片进入「只读 + 数据仍在」；
换页/重绘后它就不在列表里了（数据仍可在 TM 菜单「恢复取消的 star」里找回，24h 内）。
**用户 2026-10-05 已确认**：「本人页面的只读只是 unstar 后的临时显示态，重渲染/刷新后应当不存在，进去宽限区。」
⇒ 本项由「待确认的取舍」转为**已裁定的设计**，不再有争议。

### D6 · `data-gsm-card-state` 会在 own 页出现，三处注释口径必须同步改正

own 的 `locked-pending` 卡片同样写 `data-gsm-card-state='locked-pending'`（写入点仍是唯一分派点），
于是 `src/styles/base.css:362-364` 的 `cursor: default` 在本人页自动生效 —— 这正是所需
（不可编辑的备注区不该有「这里能打字」的光标）。

**必须同时改正的三处失真措辞**（否则留下假断言）：

| 位置 | 现措辞（失真） |
|---|---|
| `src/cardAreas.ts:16-17` | 「'own'：…**永远可编辑**…包括不写 `data-gsm-card-state`」 |
| `src/styles/base.css:358-361` | 「它**只存在于他人页**…⇒ 自有页观感一字不变」 |
| `docs/adr/0009-other-users-stars-page-readonly-grid.md:493-495` | 同上款表述 |

另需同步：`src/filters.ts:301`、`src/starCheck.ts:143`、`DEVELOPER.md:112-115`、
`AGENTS.md` 的 D26/D29 措辞（新增 D31 条目记账），以及 `src/readonly.ts:100` 里那句
「那正是 4.13.0『unstar 后标签立刻消失』的成因」的语境补充。

### D7 · 零网络 / 渲染路径零写入不变量不变

修复只增加**读**：`getPendingInGrace` = `loadPendingDelete()` = `gmGet`（`src/storage/pendingDelete.ts:34-43`）。
不新增 `GM_setValue`、不新增 `fetch`。`cardState.ts` 头注释的「不写存储」纪律继续成立。

### D8 · 夹具必须补场景：现状对「own 页 unstar」零覆盖

scout 报告 §5 实证：own 相关 scenario 只有 `own`(R7/R27)、`own-nocache`、`own-deadfields`(R28)；
唯一 unstar 往返是**他人页**的 `other-starstate`(R16)。本修复的回归面必须在夹具里补上（详见 §4）。

---

## 3. 实施（改动清单）

**基线**：上一批（`src/filters.ts` 的 `replaceChildren` 原子替换 + 删预删除）**已作为 4.16.1 落地**
（commit `1f9c1ac`，`package.json` = 4.16.1，工作区干净）。它注释里写的「4.17.0」是当时的预写版本号，实际发布为 4.16.1 ——
本方案不追踪它、也不改它。**本批次只做卡片标签/备注的只读显示**，在它之上单独提交为 **4.16.2**（scout 报告 §7 已核：它未触碰 `src/filters.ts:302`
的分派调用与实参）。

| # | 文件 | 改动 | 预估 |
|---|---|---|---|
| 1 | `src/cardState.ts` | 新增 `getOwnPageCardState(repoId, now?)`；`readCardDisplayData` 改签名（state 由调用方传入）；更新头注释（own 视图语义 + D3 的行为不变式） | ~35 行 |
| 2 | `src/cardAreas.ts` | own 分支改为「先取 own state → 判 pending → 只读渲染器 / 可编辑渲染器」；更新头注释的「永远可编辑」与「不写状态属性」表述 | ~15 行 |
| 3 | `src/styles/base.css` | 更新 `:354-364` 的注释（该属性现在也存在于本人页的 pending 卡片上）；**规则本身不动** | 注释 |
| 4 | `docs/adr/0009-*.md` | 追加「追加 8」：本人页 unstar 后的只读显示（含 D2 的取舍与理由） | ~40 行 |
| 5 | `DEVELOPER.md` | `cardState.ts` / `cardAreas.ts` 两行说明补 own 分支的三态收窄 | 2 行 |
| 6 | `AGENTS.md` | 新增 **D31**（连同 D26/D29 的交叉引用修正）+ 已知风险/下一步记账 | ~25 行 |
| 7 | `.diag/gen-otherstars-harness.cjs` | 新增夹具场景 `own-unstar`（见 §4） | ~20 行 |
| 8 | `.diag/assert-otherstars.js` | 新增断言组 **R29**（见 §4） | ~45 行 |
| 9 | `package.json` | `version` 4.16.1 → **4.16.2** | 1 行 |
| 10 | `package.json`（可选） | 补 `test:readonly` 之类的夹具跑法脚本 —— 若既有流程是手跑则跳过（V5 的验证流程里写明） | 0-3 行 |

**明确不改**：`src/filters.ts` 的 `queryRepos` / 分页 / 筛选；`src/storage/pendingDelete.ts` 的任何写路径；
`src/readonly.ts` 的渲染器与文案；他人页任何行为。

---

## 4. 验证

### 4.1 静态（必过）

```bash
pnpm check                # tsc --noEmit + build
node scripts/verify-css.cjs   # 动过 CSS 注释 → 产物 CSS 与源 CSS 等价（EXIT 0）
pnpm test:exportimport        # 导入导出纯逻辑断言（项数以实际输出为准）
grep -c '@grant' dist/github-star-manager.user.js   # 仍恰 5 项
```

### 4.2 夹具（行为层主证据）

**生成**：`node .diag/gen-otherstars-harness.cjs`（**改 `src/` 后必须重新生成** —— 夹具把 dist 内联进去）。

**新增场景 `own-unstar`**（本人页）：沿用默认身份（actor-id=999 = dimension-user_id=999 ⇒ 判 own），种子：

- `stars_repo_cache`：`123` 与 `456` 都在（两个都在本人缓存里）；
- `stars_tags_999`：`{ '123': ['我的标签','重要'], '456': ['幽灵标签'] }`、`stars_notes_999`：同上两条；
- `stars_pending_delete`：`{ '456': { name:'beta/two', …, unstarredAt: Date.now()-3600*1000, _tags:['缓冲标签'], _note:'缓冲备注' } }`
  （模拟「1 小时前取消 star，数据已搬进备份、活区已清空」）；
- 期望：**123 可编辑**、**456 只读且显示 `缓冲标签`/`缓冲备注`（不是 `幽灵标签`）**。

**新增断言组 R29**（写进 `.diag/assert-otherstars.js`，接在 R27/R28 之后）：

| 断言 | 期望 | 说明 |
|---|---|---|
| `R29_grid` / `R29_cards` | 网格存在、卡片数 = 2 | 夹具不生效的表现是「断言全绿」⇒ 先锁存在性 |
| `R29_alphaState` | `'editable'` | 同页对照：**不得**过度修复成一律只读 |
| `R29_alphaControls` | `> 0` | 同页对照：可编辑卡片仍有 `+` / `×` |
| `R29_betaState` | `'locked-pending'` | 缺陷的正断言 |
| `R29_betaTagTexts` | `['缓冲标签']` | **数据来自备份**，且不含活区残留 |
| `R29_betaNoteText` | `'缓冲备注'` | 同上 |
| `R29_betaControls` | `0` | 无 `input` / `textarea` / `.stars-tag-add` / `.stars-tag-del` |
| `R29_betaRoTitle` | 含「保留 24 小时」 | 只读提示按状态分叉 |
| `R29_betaNotesCursor` | `'default'`（宽视口下） | D6 的状态属性在本人页生效 |
| `R29_clickLockedNote` | 编辑器 0 **且** `__gmWrites` 增量 0 | **动态**断言（静态快照抓不到「点了才发作」——4.14.0 P1 的教训） |
| `R29_gridMarker` | `false` | 本人页网格**不带** `gsm-other-stars`（只读网格的常驻星按钮外观不得漏到本人页） |
| `R29_starredOpacity` | `'0'` | 本人页观感不变（R7 基线） |
| `R29_writesBefore` / `R29_fetchTotal` | 渲染后 `__gmWrites` 无新增、`apiReqs()` 为 0 | **零写入 / 零网络**硬断言 |
| `R29_errors` | `[]` | 恒成立 |

**A/B 反证（必做）**：把 `cardAreas.ts` 的 own 分支临时回退成「无条件可编辑渲染」，
`R29_betaState` / `R29_betaTagTexts` / `R29_betaNoteText` **必须变红**（否则该断言是空转）。
反证记录写进 ADR 追加 8。

**回归基线（不得回归）**：`R7_*`（本人页原有网格路径、`R7_roBadges === 0`…注意 R29 之后本人页在
pending 状态下**会**出现 `.gsm-ro-*`，故 R7 的 `own` 场景种子里**不能**有 pending 条目 —— 现有 `own` 场景
种子 `stars_pending_delete: {}`，天然满足，无需改）、`R27_*`（备注提交写路径）、`R28_*`（读路径不写盘）、
`R2_*` / `R5_*` / `R16_*` / `R21_*` / `R25_*` / `R26_*`（他人页全部）。

**跑法**（按 AGENTS.md 的坑）：`file://…/?tab=stars&scenario=own-unstar` → 按 `document.title`
（`GSM harness: own-unstar…`）找 tab id → `agent-browser-cli exec --tab <id> --file .diag/assert-otherstars.js`；
量测前先 `document.getAnimations().forEach(a => a.finish())` 并回读 `document.visibilityState === 'visible'`。

### 4.3 真机（只剩观感，行为层已由夹具覆盖）

1. 本人 stars 页点一张带标签/备注的卡片星按钮取消 star ⇒ 标签与备注**仍在**、只读、光标不再提示可打字；
2. 24h 内点同一张卡片的星按钮 ⇒ 立即回到可编辑、数据完好；
3. 打开 TM 菜单「恢复取消的 star」⇒ 该条目在列（既有功能不受影响）；
4. DevTools Network：全程零 `api.github.com` 请求（取消 star 那一次除外）；
5. 有激活标签筛选时取消 star ⇒ 观察「卡片随整页重绘消失」（**V2 已由用户判定为预期**，此处只做观感确认）；
6. TM 安装页授权清单仍**恰 5 项**。

---

## 5. 风险

| # | 风险 | 缓解 |
|---|---|---|
| R1 | 修复把本人页改坏成「一律只读」 | D2 收窄二态 + R29 的 `alphaState='editable'` 同页对照 + R27 回归 |
| R2 | `octolytics-actor-id` 失效（无官方契约，AGENTS.md 风险 13） | D2：own 判定**不依赖** `viewerCache`，meta 失效时最坏退化成「今天的行为」（标签仍消失），**不会**让本人页失去编辑能力 |
| R3 | 只读卡片被点到仍能写盘（4.14.0 抓过的 P1） | 唯一分派点已调 `disposeNotesEditor()`；R29 用**动态**断言（点一下）而非静态快照 |
| R4 | own 的 `editable` 分支误读备份，凭空显示别人的数据 | D3 的行为不变式 + 代码注释；断言里 `alphaState` 与 `betaTagTexts` 一并锁住 |
| R5 | 夹具场景静默失效，断言「全绿」骗过审查 | 先锁 `R29_cards === 2` 存在性 + 必做 A/B 反证（AGENTS.md 既有教训） |
| R6 | 24h 宽限期是**取舍**而非行业共识（生态反例 astral 立即删除） | 机制本身不变（只改呈现分派）；取舍已记录在 D4/D5，V2 已由用户 2026-10-05 确认 |
| R7 | ~~工作区已有的 `src/filters.ts` 未提交改动与本批次混提~~ —— **已消解** | 上一批已于 2026-10-05 作为 4.16.1 落地（commit `1f9c1ac`），工作区干净 ⇒ 本批次在干净基线上单独提交为 4.16.2 |

---

## 6. 拒绝清单（不要重开）

| 拒绝的备选 | 理由 |
|---|---|
| own 复用三态 `getCardState`（引入 `locked-empty`） | D2：meta 失效 ⇒ 本人页全页只读；且这类卡片在本人页本就**不会被渲染**（只来自缓存），给它造只读态是空转 —— 用户 2026-10-05 亦确认「应该不显示才对」 |
| unstar 时不清空活区，让标签留在活区自然显示 | 与 ADR 0003 的宽限期语义冲突；pending 超期清理后活区数据永久残留且卡片仍可编辑（与「只读」相反） |
| 把 pending 条目并入 `queryRepos()` 让卡片常驻 | D5：与 unstar 语义冲突、要给查询管线加第三条半来源；用户 2026-10-05 确认「重渲染/刷新后应当不存在」 |
| **导入时**把「未 star 仓库的标签/备注」直接搬进 24h 宽限期（V8 的字面读法） | 宽限期到期即**永久删除**（`cleanupExpiredUnstarred`，`src/storage/pendingDelete.ts:144-158`）⇒ 导入进来的数据会在 24h 后被静默删掉；且导入导出的语义是「数据搬运」，不该顺带触发删除倒计时（ADR 0001 / 0005） |
| unstar 后强制整页重绘让卡片立刻消失 | 与用户「要只读，不要消失」的诉求直接相反 |
| 给只读卡片加可见提示条 / 「去恢复」按钮 | 用户两次裁定「卡片不要多余描述文字」；恢复入口已存在（星按钮 / TM 菜单） |
| 给只读卡片加 `aria-readonly` / `inert` / 主动播报 | 4.14.0 已逐条评估并否决（`aria-readonly` 只对 9 个 widget role 有效；无 WCAG 条款要求「控件消失必须播报」） |
| 顺带给只读卡片加删除标签入口（修 V6 的既有缺口） | 与「只读卡片不渲染任何编辑控件」裁定冲突，属独立 UI 决策 |
| 用 `gmFetchText` / 任何网络请求判断仓库是否已 unstar | 零网络硬约束（D26） |

---

## 7. 可变决策（请逐条过目）

见 `deep_plan` 的 V1–V8（同内容在下表）：

| # | 选择 | 已生效的默认值 | 改动代价 |
|---|---|---|---|
| V1 | 本人页「没 star、只有导入标签」的卡片 | **维持现状**（不渲染、也不给它造只读态；用户 2026-10-05：「那应该不显示才对」） | 低。数据生命周期与用户原话的差异见 **V8** |
| V2 | unstar 后的只读卡片在整页重绘时消失 | **接受**（用户 2026-10-05 已确认：本人页只读是临时态，重渲染/刷新后不在列表里，数据进宽限区） | 中：要常驻得给查询管线加第三条半来源（分页/facet 连带） |
| V3 | 只读卡片上是否给可见提示（「24h 后永久删除 / 点星可恢复」） | **不加** —— 仅原生 `title` | 低（一处 builder + 一条 CSS），但会重开已被否决的形态 |
| V4/V7 | 本次版本号 | **4.16.2**（用户 2026-10-05 最终裁定；上一批已用掉 4.16.1，见 commit `1f9c1ac`） | 低；升 `@version` 后 dev loader 必须重装（dev 四件事第 4 条） |
| V5 | 验证策略 | **夹具 `own-unstar` + A/B 反证 + 同页可编辑对照**，真机只补观感 | 低-中（约 65 行夹具/断言） |
| V6 | 是否顺带修「只读卡片没有删除入口」 | **不修**（用户 2026-10-05 已确认：本人页只读是临时态，刷新后卡片不存在，数据在宽限区内） | 低：不做只是继续挂在文档里 |
| V8 | **导入**的标签/备注落在「本人没 star」的仓库上时，是否在导入那一刻就把数据搬进 24h 宽限期 | **不做**（现行行为：留在活区、不显示、无 UI 入口） | 低。若改做，这些数据会在 24h 后被 `cleanupExpiredUnstarred` **永久删除** ⇒ 有静默丢数据的风险，故须用户明确点头 |

---

## 8. 任务清单（执行顺序）

- **T1** `src/cardState.ts`：新增 `getOwnPageCardState`；`readCardDisplayData` 改签名；头注释同步（D1/D3）。
- **T2** `src/cardAreas.ts`：own 分支接上 pending 判定与只读渲染；头注释同步（D1/D4/D6）。
- **T3** `src/styles/base.css` 注释更新（规则不动）（D6）。
- **T4** `.diag/gen-otherstars-harness.cjs` 新增 `own-unstar` 场景；`.diag/assert-otherstars.js` 新增 R29；
  重新生成夹具，跑通全部既有场景 + 新场景；做 A/B 反证并记录（D8）。
- **T5** 静态四件套：`pnpm check` / `verify-css` / `test:exportimport` / `@grant` 计数（§4.1）。
- **T6** `package.json` 升 **4.16.2**；文档同步：`DEVELOPER.md`、`docs/adr/0009` 追加 8、`AGENTS.md` D31 + 风险/下一步记账。
- **T7** 真机观感确认（§4.3 的 6 条）—— 需要用户在真 github.com + TM 上做。

---

## 9. 与既有决策的关系

- **D26（他人页只读网格）**：本修复让本人页与它共享同一套「宽限期数据仍显示」的口径。
- **D29（逐仓库可编辑 + 唯一分派点）**：本修复是同一纪律在另一根轴上的收口 ——
  分派点仍唯一，判定仍唯一（`cardState.ts`），只是 `own` 分支不再是无条件。
- **ADR 0003（宽限期 + 恢复菜单）**：机制不变，本次只补上「期间在本人页也要看得见数据」。
- **ADR 0009 追加 7**：其「own 永远可编辑」是**当时**的准确描述，本次修订它（新增「追加 8」），不改写历史。

---

## 10. 修订记录（2026-10-05，用户审查轮）

用户在首次审查里裁定三项，本方案据此修订：

| 用户原话 | 落到哪里 |
|---|---|
| 「V1 是否指的是通过脚本菜单导入，但是本人页面没有 star 的卡片？那应该不显示才对，直接进入宽限区。」 | V1 默认不变（**不给这类卡片造只读态**）；核对后确认本人页**只渲染缓存里的仓库** ⇒ 这类卡片本就不进网格（§1.4 / D2）。「直接进入宽限区」的字面读法（导入期搬迁）单列为 **V8**，默认不做并给出丢数据理由（§6） |
| 「4.17 为另一个进行中的修改，此次仅改为 4.17.1」→ 第二轮「上一个修改仅将版本号改为了 4.16.1，故此次改为 4.16.2」 | V4/V7 = **4.16.2**（4.16.1 已被上一批用掉，见 commit `1f9c1ac`）；原「未提交改动混提」的 R7 随之消解 |
| 「V6 同 V1，本人页面的只读只是 unstar 后的临时显示态，重渲染/刷新后应当不存在，进去宽限区。」 | V6 = **不修**、V2 = **接受**，两项由「待确认取舍」升级为**已裁定设计**（D5 / R6 / §4.3-5） |

**本方案的主体设计（D1–D8）未变**：`cardState` 新增 own 视图判定 + 共用取数，`cardAreas` 的 own 分支
接上既有只读渲染器，夹具新增 `own-unstar` + R29（含 A/B 反证）。
