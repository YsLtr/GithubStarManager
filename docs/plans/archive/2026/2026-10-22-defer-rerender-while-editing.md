# 4.20.0 · 编辑会话期间挂起重绘（D36）

- 日期：2026-10-22
- 起因：用户报告「刷新后重渲染页面会让用户从编辑（tag/note）状态退出并丢掉内容」
- 裁定：采用「挂起重绘」，并把旧的 D12（同步后**立即**重渲染，不问是否刷新）与 D12 补**整条删除**，合并为本条，避免以后两套口径冲突
- 决策全文：`docs/adr/0013-defer-rerender-while-editing.md`

## 1. 落点

| 文件 | 改动 |
|---|---|
| `src/inlineEdit.ts` | 新增。`hasInlineEditor()` 单一判据 + `mergeDraftIntoGraceBackup()`（外部取关时草稿并入宽限期备份）+ `commitInlineEditors()`（视图销毁前按失焦语义提交） |
| `src/filters.ts` | `applyFilters` 开头的挂起门 + 挂起槽/合并规则/三个结束信号/`deferApply` / `renderBrowsePageDeferred` / `cancelDeferredApply` |
| `src/starCheck.ts` | `syncCardAfterStarChange`：正在编辑的卡片不重画区域；外部取关先并备份再刷只读 |
| `src/ui/notes.ts` / `src/ui/tagFilter.ts` | 提交加 `isConnected` 守卫（节点已离场不落盘，避免外部取关后写进活区） |
| `src/viewTeardown.ts` / `src/otherStarsView.ts` | 撤挂起态 + 销毁前提交草稿 |
| `src/index.ts` | 导入后的他人页重绘改走 `renderBrowsePageDeferred` |
| `src/fullSync.ts` | 注释口径改为「重绘让位于编辑会话」（行为不变，仍是 `applyFilters({keepPage:true})`） |
| `tests/diag/gen-defer-rerender-harness.cjs` / `tests/diag/assert-defer-rerender.js` | 新增回归守卫 |

## 2. 根因（先被实测改写过的两条）

初版分析写了两条判断，夹具实测**都错了**，已按实测改正：

1. ~~「移除聚焦元素不派发 blur（MDN 注明）」~~ → Chromium 实测**会补发** `blur`（`premise_blurOnRemove=true`）。真正的问题是：那个事件的目标已在文档外，`blur`/`focusout` 传播不到 document ⇒ 挂在 document 上的收尾逻辑一条也收不到。**本决策的第一版实现（靠 `focusout` 收尾）因此挂死**，夹具当场抓到：挂起后再也等不到「编辑结束」。
2. ~~「草稿彻底丢」~~ → 准确说法是「**屏上**丢、存储里可能已经写了」。分片在 `replaceChildren` 之前按旧值建好，重绘其间的提交只写存储，此后没有第二次渲染。A/B 实测（临时关掉挂起门）：`stored: 'draft-y'`、`onCard: '添加备注…'`。

因此修复不依赖 blur、不抢在拆节点时提交，只**推迟**。

## 3. 验证

夹具：`node tests/diag/gen-defer-rerender-harness.cjs`（70 仓库 / 3 页，内联当前 `dist`）→ `agent-browser-cli open --focus "file:///<repo>/.diag/defer-rerender-harness.html?tab=stars"` → `agent-browser-cli exec --tab <id> --file tests/diag/assert-defer-rerender.js`。

守卫全绿（`errors: []`）时的实测读数：

```
premise_blurOnRemove=true
page2={"page":2,"total":3}
seeded=true
editing={"repoId":"41","focused":true,"value":"draft-mvixkoks"}      ← 第 2 页首卡开备注编辑框
held={"sameCardNode":true,"stillEditing":true,"value":"draft-mvixkoks","focused":true,"page":{"page":2,"total":3}}
localRerender=已发生                                                   ← 标签 × 的局部重画照常，只有整表重绘被挂起
flushed={"rebuilt":true,"noteShown":"draft-mvixkoks","stored":"draft-mvixkoks","page":{"page":2,"total":3},"editors":0}
teardown={"saved":"teardown-mvixkpnh","gsmNodesLeft":0,"editor":false} ← 跨断点收窄前按失焦语义提交
cleanup={"page":1,"total":3}  tags=0
```

断言链：① 前提探针（只记录不判定）② 编辑态（焦点/值）③ **无手势**触发整表重绘后：编辑框仍在、值不变、网格**节点未被换**、页码仍第 2 页 ④ blur 结束编辑后：网格补跑一次、草稿落盘且显示、页码仍第 2 页、无残留编辑器 ⑤ 全程网格子节点数从未为 0（D12 原子替换）⑥ 收窄回滚前草稿已提交、脚本节点全清。

**反证（必须有）**：把 `deferApply` 改成 `if (true) return false;` 重编重跑，守卫当场变红 ——

```
errors: ["重绘未被挂起：备注编辑框被摘掉了", "挂起期间草稿变了: null",
         "挂起期间焦点离开了编辑框", "挂起期间网格被重建了（首卡节点换了）", "异常: Cannot read properties of null (reading 'blur')"]
held:  {"sameCardNode":false,"stillEditing":false,"value":null,"focused":false}
```

还原后重跑复绿。

**既有守卫无回归**：`node tests/diag/gen-keep-page-harness.cjs` → `assert-keep-page.js` 全绿
（`page2=2 / 3`、`afterAdd=2 / 3`、`afterDelete=2 / 3`、`afterPillClick=1 / 1`、`cleanup=2 / 3`）。

**静态验收**：`pnpm check` 绿（tsc + 内联 UI 配色守卫 + build），dist **218.50 kB**，`@grant` 恰 5 项。

### 收尾时补的工装加固（同一轮，4.20.0）

版本号提到 4.20.0 后重跑守卫，先在**不可见**标签页上跑出一片假红，暴露出守卫自身的两个环境依赖：

- **`visibilityState: hidden` 时 `ta.blur()` 不派发 blur** ⇒ 前提探针变 `premise_blurOnRemove=false`，提交不发生，④⑥ 必然红。守卫原来只写「只在可见标签页可信」，但**红的时候看不出是环境还是实现**。
  改法：④ 先试 `blur`，1.5s 内没兑现就退到实现里的另一条结束信号（document `keyup`），并把走的是哪条记进 `flushVia`；⑥ 的失败文案直接点名「若 `premise_blurOnRemove=false`，说明标签页没有前台焦点，先把窗口切到前台再跑」。
- **固定 `wait(60)` 在后台标签页会被钳到 661ms** ⇒ 进第 2 页失败。改法：新增 `until(fn, 3000)` 轮询（命中即返回，可见标签页下第一次就成立），`gotoPage` / `addTagOn` / 打开编辑框 / 等挂起兑现 / 等 teardown 全部换成它。
- 验证：前台窗口下重跑 —— `premise_blurOnRemove=true`、`flushVia=blur`、`errors: []`；`assert-keep-page.js` 同时无回归（`2/3 ▸ 2/3 ▸ 2/3 ▸ 1/1`）。**注意** `open --focus` 只把标签页置为 active，窗口仍可能是最小化/被遮挡的 —— 判据只看页面内回读的 `visibilityState === 'visible'` 与 `document.hasFocus() === true`。

## 4. 真机复验（4.20.0 收尾补做）

`file://` 夹具之外，另在**真实 github.com** 上跑了一遍（`https://github.com/YsLtr?tab=stars`，30 张真实卡片、19 页）。做法同 4.19.3 那轮：GM stub + 内联当前 `dist` 注入真实页面（临时工装 `.diag/gen-real-defer.cjs`，不入库）。

```
grid=30
editing={"id":"1216634387","focused":true}
held={"sameCardNode":true,"editor":true,"value":"draft-real-…","focused":true,"page":"1 / 1"}
flushed={"rebuilt":true,"page":"1 / 1","editors":0,"firstCard":"1137066830"}   ← 排序方向真的翻了，网格兑现后重建一次
emptyGridHits=0
deferLog=1 / flushLog=1        ← 控制台各一条：「卡片正在编辑：本次重绘推迟到编辑结束后（D36）」+「编辑已结束：补跑挂起的重绘（D36）」
```

- **重绘源是真实入口**：点 `#stars-custom-dir-button`（`filters.ts` 里那个 `applyFilters()` 无 `keepPage` 的排序 handler），不是夹具里的标签 ×。
- **零数据污染**（真机验证的硬要求）：结束编辑用 `Escape`（`notes.ts` 的取消分支，不写盘），随后 `keyup` 兑现挂起。事后回读 `stars_notes_130123551` / `stars_tags_130123551`：`polluted=false`，被测仓库的那条原始备注仍在，71 条备注 / 85 条标签数量不变。
- **一处必须写明的偏离**：注入时把 `matchMedia('(min-width: 768px)')` 答成 `true`。当时那个浏览器窗口只有 604px 宽，按 D18 脚本会完全惰性、连网格都不建。被验证的是 D36 的挂起/兑现逻辑（与视口宽度无关），但**布局观感不是这次验证的对象**。
- 仍**未**覆盖：真机上的「进页自动同步触发重绘」那条真实链路（需要真实 token + 一次真同步，且会真改远端数据）—— 夹具与该探针用等效的无手势重绘源替代；单卡路径（`syncCardAfterStarChange` 正在编辑 / 外部取关并备份）同样未覆盖。

### 仍未覆盖

- **进页自动同步那条真实链路**（2s 后 `runFullSync('auto')`）没有在真机上端到端跑：需要真实 token 与一次真同步（会写远端）。夹具用「另一张卡的标签 ×」、真机探针用「排序方向按钮」作为**等效的无手势重绘源**（同样在编辑器挂着时调到 `applyFilters`），覆盖的是同一条挂起门。
- 单卡路径（`syncCardAfterStarChange` 正在编辑 / 外部取关并备份）无夹具覆盖：需要真实网络触发外部取关判定。→ **4.20.1 已补**（见下一节：写桩 + 夹具步骤 ⑦）。
- Turbo 换帧（用户点导航）不覆盖：节点由 Turbo 删除，脚本收不到信号（ADR 残余风险 2）。

## 5. 4.20.1 修正：脚本重绘摘编辑器时，blur 不算用户提交

本轮收尾时由用户提问引出，**推翻了 4.20.0 写进三份文档的那句「移除时补发的 blur 会被 `isConnected` 守卫挡掉」**。

- **现象**：编辑中卡片被 unstar 后，卡片确实变只读，但点一下又能进编辑态。
- **实测**：在捕获相位拦截那次 blur，读到 `{isConnected: true, parentIsNull: false, ownerDocHas: true}` —— Chromium 在**摘出 DOM 之前**就派发 blur，三个"已离场"判据全都不成立。于是从可编辑翻只读的那次重绘里，编辑器把它当用户提交：① 草稿写回**活区**（外部取关后该为空）；② `commit` 末尾的 `renderNotes()` 把「点击进编辑」监听**重新绑上** ⇒ 只读卡片又能点开、又能写。
- **修法**：判据只能是「这次重绘是谁发起的」。`inlineEdit.suppressInlineCommit()`（深度计数）在 `ui/notes.ts` / `ui/tagFilter.ts` / `readonly.ts` 清空容器处生效；两个编辑器另加 `finished` 一次性闸，标签的 `Escape` 先落闸再摘节点。`commitInlineEditors()` 相反，**不做**抑制。
- **回归锁**：`assert-defer-rerender.js` 新增步骤 ⑦（编辑中点星 → 写桩 → 断言 `state=locked-pending`、`grace=草稿`、`live` 为空、`reopened=false`、`tagAdd=false`）。
- **验证**：守卫全绿，`unstar={"state":"locked-pending","grace":"unstar-…","live":null,"reopened":false,"tagAdd":false}`；`assert-keep-page.js` 无回归。**反证**：撤掉两处包裹重编重跑 ⇒ `live="unstar-…"` + `reopened=true` 两条变红，装回复绿。另手验正常路径未被误伤（备注 blur 落盘 / 备注 Escape 不落盘 / 标签 Enter 入库 / 标签 Escape 不落库）。
- **未覆盖**：这条修复只在 `file://` 夹具上验过；写桩只到 `HTTP 204 成功` 这一层，没走真实网络。

## 6. 文档落点

- `AGENTS.md`：硬口径段删除 D12 / D12 补，新增 D36（4.20.1 补第四条）；「事件在节点离场后不可用」按实测改写；本轮交接改写。
- `DEVELOPER.md` §6/§7/§11：重绘口径、不变式、守卫跑法；新增「内联编辑器的提交时机（4.20.1）」一节。
- `docs/adr/0013`、`docs/adr/README.md`、`docs/plans/README.md`、`docs/INDEX.md`、`docs/filters-sort-design-2026-09-23.md` §4.2 同步登记。
