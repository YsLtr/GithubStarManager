# 4.21.0 · 内联编辑器的收尾避开「按下到松开」

- 日期：2026-10-27
- 决策：`docs/adr/0014-inline-edit-teardown-after-gesture.md`（D37）
- 关联：`0013`（D36 编辑会话期间挂起重绘）、issue #4「退出编辑->新的交互少一步」

## 1. 纳入 / 排除

纳入：

1. 编辑器提交时，**落盘同步**、**DOM 收尾推迟到手势之后**。
2. `src/inlineEdit.ts` 成为「指针按着没有」的**唯一**判据（`isPressInFlight()` + `armPressTracking()` + `disarmPressTracking()`）。
3. `src/filters.ts` 删掉自有的 `pointerHeld`，改用它；并订阅 `onInlineEditSettled` 补跑挂起重绘。

排除（理由）：

- **不**把备注区做成恒定高度以消除 20px 跳动 —— 全站视觉回退，且症状根因是「收缩发生在按着鼠标的时候」，挪走时序即解决。
- **不**在收尾里重放一次 `click` —— 要猜用户意图，还会触发目标自己的导航/星标副作用。
- **不**用 `requestAnimationFrame` 代替 `pointerup` —— 帧与手势不同源，目标仍可能提前离场。
- **不**要求落盘也推迟 —— 这一击可能直接导航走。

## 2. 缺陷机制（先证伪再动手）

三条初判都在实测中被检查过：

| 初判 | 实测结论 |
|---|---|
| 「监听被某处 `stopPropagation` 吃掉了」 | 否。`__evlog` 里 `pointerdown`/`mousedown`/`pointerup`/`mouseup` 全到，只缺 `click` |
| 「点击落在了被重绘出来的新节点上」 | 否。点击根本没派发 —— `click` 派发给 mousedown/mouseup 目标的**最近公共祖先**，按下节点离场后公共祖先为空 |
| 「是备注编辑框特有的问题」 | 半对。标签编辑器同样中招（卡片高度不变也照样丢 click）；备注编辑框另有 `min-height:40px` 导致的收缩重定向 |

修复前的实录（夹具受信任点击）：

```
pointerdown(card2 .stars-card-notes-text)
mousedown(card2 .stars-card-notes-text)
blur(card1 .stars-tag-input)   → renderTags → renderNotes → applyFilters → renderBrowsePage → replaceChildren
pointerup
mouseup
(no click)
```

修复后同一操作：

```
pointerdown:stars-card-notes-text
mousedown:stars-card-notes-text
pointerup:stars-card-notes-text
click:stars-card-notes-text        ← 落在原目标上
```

同一次点击的结果：卡 2 备注编辑框打开且获焦（`card2Draft` = 原备注、`card2Focused` = true）、卡 1 标签输入框已摘除、`stars_tags_998['1']` 已含刚打的 `trusted-draft`。

## 3. 任务拆分与落地

| 项 | 文件 | 内容 |
|---|---|---|
| 0a | `src/inlineEdit.ts` | `armPressTracking()` / `disarmPressTracking()` / `isPressInFlight()` / `finishInlineEdit()` / `onInlineEditSettled()`；四个信号（document capture `pointerdown`、window capture `pointerup`/`pointercancel`、window `blur`） |
| 0b | `src/ui/notes.ts` | 追加 textarea 后 `armPressTracking()`；`saveNote` 同步、收尾走 `finishInlineEdit` |
| 0b | `src/ui/tagFilter.ts` | 同上；`added` 决定收尾是重画区域 + `applyFilters({keepPage:true})` 还是仅摘输入框 |
| 0c | `src/viewTeardown.ts`、`src/otherStarsView.ts` | `commitInlineEditors()` 之后 `disarmPressTracking()`（D18：监听也是写入） |
| 0d | `src/filters.ts` | 删 `pointerHeld`；`flushPendingRender()` 用 `isPressInFlight()`；订阅 `onInlineEditSettled` |

`disarmPressTracking()` 的两件事都不能省：复位 `pressInFlight`（否则此后每次重绘都判成「还按着」而永不兑现），以及**执行**队列里的收尾（否则被推迟的卡区重绘静默消失）。

## 4. 回归锁

生成器 `tests/diag/gen-edit-click-harness.cjs`（6 仓库单页、每卡预置标签 + 备注、账号 id **998**）→ `.diag/edit-click-harness.html?tab=stars` → `tests/diag/assert-edit-click.js`。

断言的是**使缺陷成立/不成立的不变式**，不是「某个 handler 跑过」：从 `pointerdown` 到 `click` 之间，按下的那个目标必须仍在文档里、`getBoundingClientRect()` 不变；同时要求落盘已同步完成。

五个场景：

- **A** 标签编辑中 → 点另一张卡的备注区：目标不离场、`card2` 进编辑态、标签已落盘。
- **B** 标签编辑中 → 点另一张卡的「+」：目标不离场、`card3` 输入框出现。
- **C** 备注编辑中 → 点另一个标签胶囊的浮层：浮层打开、`card1` 输入框已摘。
- **D** 备注编辑中 → 点上方筛选按钮：筛选信息条出现、网格被筛到 1 张（对照组 —— 它在 `.stars-grid-container` 之外，本来就没坏，加它是防止「修一处坏另一处」）。
- **E** 备注编辑中 → 同卡下方目标：卡片高度变化但目标几何在松手时未变（专治 `min-height` 收缩那条）。

反证（已做）：把 `finishInlineEdit` 改成无条件立即执行、重编重跑 ⇒ **7 条断言变红**，包括 `A：按下的目标在松开前离场`、`A：点卡 2 备注没有进入编辑态（这一击被吃掉了）`、`E：按下到松开之间目标位移 -11.0px`。还原后复绿。

## 5. 验证数字

- `pnpm check` 绿（theme guard 扫 54 个文件）；dist **221.32 kB**，gzip 60.55 kB；`@grant` 恰 5 项；`@version 4.21.0`。
- **受信任点击端到端**（夹具，前台标签 + `Emulation.setFocusEmulationEnabled`）：标签编辑框里打 `trusted-draft` → `agent-browser-cli mouse-click` 真实点击另一张卡的备注区 ⇒ `__evlog` = `pointerdown → mousedown → pointerup → click`（click **落在原目标上**），卡 2 备注编辑框打开且获焦（`card2Draft` = `note-2`、`card2Focused = true`），卡 1 输入框已摘，`stars_tags_998['1'] = [..., 'trusted-draft']`。A–E 是合成事件链，只证明逻辑接对了；浏览器真的这么派发，靠的是这一发。
- edit-click：`errors: []`，`A noteOpened=true cards=6`、`B input3=true cards=6`、`C overlayOpen=true input3Gone=true`、`D filteredCards=1 infoBar=true`、`E noteOpened=true h=214->203`。
- defer-rerender（D36 挂起/兑现 + 4.20.1 第 ⑦ 步）：`errors: []`，`flushVia=blur`，`unstar={"state":"locked-pending","grace":"unstar-…","live":null,"reopened":false,"tagAdd":false}`。
- keep-page：`errors: []`，`2/3 ▸ 2/3 ▸ 2/3 ▸ 1/1`，起点 `firstCard tags=[]`（污染修复后）。

## 6. 本轮踩到的工装缺陷（值得单独记）

三个夹具都是 `file://` **同源**，localStorage 镜像共享。本夹具原先用账号 `999` 播种子，写下的镜像键被 `src/gm.ts:66-68` 的迁移路径搬进 jump 夹具的命名空间 ⇒ `assert-keep-page.js` 的起点首卡带上了 `["tag-6-a",…,"press-draft-3"]`，而**断言仍全绿**（它只关心页码）。

处置：本夹具改用账号 `998`（生成器与断言两处同步），jump 夹具复验恢复 `tags=[]`。**新增夹具必须挑一个没人用的账号 id**。

另：`Emulation.setFocusEmulationEnabled` 必须在**每次 `Page.reload` 之后**重设。窗口不在前台时 `document.visibilityState` 是 `hidden`，受信任点击与 `blur` 都会失真 —— 表现恰好是「守卫全绿但 bug 还在」。

## 7. 边界与残余

见 `docs/adr/0014` §残余风险，以及 `AGENTS.md` 已知风险 ⑥–⑧（按住期间编辑框在屏上、20px 跳动仍在、拖选未专门覆盖）。仍全部是 `file://` 夹具结论，未做真机 TM 复验。
