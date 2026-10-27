# 0014 · 内联编辑器的 DOM 收尾排到「按下到松开」之后

- 状态：已采纳（4.21.0，2026-10-27）
- 相关：`0013`（编辑会话期间挂起重绘，D36）、`src/inlineEdit.ts`、`src/ui/notes.ts`、`src/ui/tagFilter.ts`、`src/filters.ts`
- 触发：用户报告 + <https://github.com/YsLtr/GithubStarManager/issues/4>「退出编辑 → 新的交互少一步」

## 背景

编辑标签或备注、打了字之后**直接点另一处**（另一张卡的备注区、另一张卡的「+」、另一个标签胶囊），那一击被吃掉：草稿提交了，点击本身没生效 —— 效果等同点空白。点上方筛选栏则正常。

缺陷不在事件监听，在**浏览器怎么决定 `click` 派发给谁**：`click` 派发到「mousedown 与 mouseup 目标的**最近公共祖先**」。若 mousedown 的那个节点在松手前离场，公共祖先就不存在，Chrome **连 `click` 都不派发**。

夹具受信任点击 + `__evlog` 实录（修复前）：

```
pointerdown(card2 .stars-card-notes-text)
mousedown(card2 .stars-card-notes-text)
blur(card1 .stars-tag-input)      ← 提交处理器在这里同步重画
                                   renderTags → renderNotes → applyFilters → renderBrowsePage → replaceChildren
pointerup
mouseup
(nothing)                          ← 没有 click
```

`commit()` 原本在 `blur` 里**同步**做全套重画，而 blur 发生在 mousedown 之后、mouseup 之前 —— 按下的节点于是死在这一段里。备注编辑框有第二重同样的病因：`min-height:40px`，退出编辑态时卡片高度缩回（实测 208→183），mouseup 落在别的元素上，click 被重定向到共同祖先。

对照组解释了一切：上方筛选栏在 `.stars-grid-container` **之外**，换网格时它本体不动，所以它的 click 一直能落地 —— 这也说明不需要改监听，需要改的是**动 DOM 的时机**。

## 决定

**落盘同步，改 DOM 的收尾推迟到这次手势之后。**

- `saveTags` / `saveNote` 仍在 `blur` 里**同步**执行：这一下点击可能立刻导航走，数据不能等。
- 拆编辑框 / 重画本卡区域 / `applyFilters` 走 `inlineEdit.finishInlineEdit(fn)`：有指针按着就排到 `pointerup` 之后的一拍（`setTimeout 0`，那时 `click` 已派发完），没按着（Tab 失焦、脚本自己 `blur()`）就立即执行 —— 与 4.20.1 的行为完全一致。
- 「按着没有」的判据只有一份实现：`inlineEdit.isPressInFlight()`（`pointerdown` / `pointerup` / `pointercancel` / 窗口 `blur` 四个信号）。`filters.ts` 原先自己维护的 `pointerHeld` 删除，改用它 —— 两处判据不一致就是 4.13.0 那类缺陷。
- 收尾跑完发 `onInlineEditSettled`：挂起重绘可能正等「页面上没有编辑器」，而推迟收尾之后不会再有 blur/keyup 来敲门，不补这一枪网格会停在旧画面。
- 监听**只在编辑器被创建时**挂（`armPressTracking()`），不在模块加载时挂（D18：窄视口一行都不碰页面）；两个回滚点（`viewTeardown` / `exitOtherStarsView`）调 `disarmPressTracking()`，它同时复位标志与队列 —— 留一个 `true` 会让此后每次重绘都判成「用户还按着鼠标」而永不兑现。

## 被否掉的替代方案

| 方案 | 否决理由 |
|---|---|
| 只在 `pointerup` 里再摘节点（不做通用机制） | 两个编辑器各写一遍同样的时序逻辑，第三处新增编辑器必然漏；且「按着没按着」的判断会分裂成两份 |
| 用 `requestAnimationFrame` 代替 `pointerup` | rAF 在 mouseup 之前就可能跑（帧与手势不同源），目标照样离场；后台标签页 rAF 被节流，收尾更不确定 |
| 落盘也推迟 | 这一下点击可能直接导航走，草稿会丢。落盘与 DOM 分离是本决策的核心，不是折中 |
| 抑制 click、提交后在收尾里重放一次 click | 需要猜「用户本来想点哪里」，重放会触发目标自己的导航/星标等副作用，且拿不到原生语义；还给每个目标加一份重放逻辑 |
| 让备注区高度固定（编辑态与文本态同高） | 能消除第二重病因，但所有卡片的备注区要常驻 40px 空白，是全站视觉回退；而它并非必要 —— 症状的根因是「收缩发生在鼠标按着的时候」，把收缩挪到手势之后即解决 |

## 后果

- 按住鼠标不放期间，编辑框留在屏上（无光标），松手后一拍才收尾。人手按住通常 <1s；这是为了让「松手时目标还在原处」而付的确定代价。
- `isPressInFlight()` 成为按压状态的**唯一**判据：任何需要「现在能不能换 DOM」的模块都用它，不要再各自记标志。
- **新增第三种卡片内联编辑器**（与 D36 第 3 条残余的「第五种」同一件事）：打开时 `armPressTracking()`，收尾走 `finishInlineEdit()`，否则它会把用户的下一击吃掉。
- 备注编辑态比文本态高约 20px 这「跳一下」仍在（进入编辑态发生在 click 之后，不再抢点击）；要消除它需另做布局决定，与本条无关。

## 验证

- **夹具**：`tests/diag/gen-edit-click-harness.cjs`（6 仓库单页、每卡预置标签+备注）→ `tests/diag/assert-edit-click.js`。五个场景 A–E（点另一张卡的备注 / 另一张卡的「+」 / 另一个标签胶囊 / 上方筛选按钮 / 同卡备注收缩后点下方目标），断言的是**使其成立的不变式**：从 pointerdown 到 click 之间，按下的目标必须仍在文档里、几何不变；落盘必须已在 blur 里同步发生。
- **反证**：把 `finishInlineEdit` 改成「无条件立即执行」重编重跑 ⇒ 7 条断言变红（含 A 的「按下的目标在松开前离场」与 E 的「位移 -11.0px」），还原后复绿。
- **受信任点击（端到端，非合成事件）**：夹具前台，标签编辑框里打 `trusted-draft`，用 CDP 真实点击另一张卡的备注区 ⇒ `__evlog` 是 `pointerdown → mousedown → pointerup → click`（**click 落在原目标上**），目标卡的备注编辑框打开且获焦，卡 1 的输入框已摘除，存储里 `stars_tags_998['1'] = [..., 'trusted-draft']`。
- **无回归**：`assert-defer-rerender.js`（D36 挂起/兑现 + 4.20.1 的 ⑦）与 `assert-keep-page.js` 全绿。

## 残余风险

1. 三处 `file://` 夹具同源，命名空间必须靠**独立账号 id** 隔离（本夹具用 `998`）。用同一个 id 时 `gm.ts` 的 localStorage 镜像迁移会把种子带进别的夹具 —— 而断言仍全绿，属最难发现的那类坏。
2. 用合成事件测点击类缺陷只能证明「逻辑接对了」，不能证明「浏览器真的这么派发」；结论必须以受信任点击或 `__evlog` 实录为准。窗口不在前台时（`visibilityState === 'hidden'`）受信任点击与 `blur` 都会失真，本仓因此必须先前置 CDP `Emulation.setFocusEmulationEnabled`。
3. 拖选（mousedown 后拖动再松开）属于同一段时序，收尾同样被推迟；未见问题，但没有专门用例。
