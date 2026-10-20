# 内联 UI 的配色只从页面现场解析（D35）

状态：已实施，4.19.3。触发项：[issue #1](https://github.com/YsLtr/GithubStarManager/issues/1)「恢复已取消的 star 弹出菜单暗黑模式不兼容 —— 无法和网页内容一样转变为暗黑模式」。实施计划与实测数字见 [计划](../plans/archive/2026/2026-10-20-inline-ui-dark-mode-theme.md)。

## 问题

脚本从 TM 菜单打开的三个内联 UI —— 恢复窗口（`ui/restoreMenu.ts`）、导入大窗（`ui/exportImportMenu.ts`）、通知栈（`ui/notifications.ts`）—— 必须能在**任意 github.com 页面**出现，因此不依赖 Stars 视图注入的样式表，颜色全写在元素 `style` 上。此前写法是两段式：

```js
theme = 'var(--color-canvas-default, #ffffff)'   // 语义 token + 浅色兜底
```

GitHub 已经把整代 `--color-*` 变量删掉，替换为 `--bgColor-*` / `--fgColor-*` / `--borderColor-*` 等新命名。真机（暗色 issue 页，`colorScheme: dark`，页面底色 `rgb(13,17,23)`）实测：`--color-canvas-default` / `--color-fg-default` / `--color-border-default` 在 `:root` 上**全部为空**。于是每个 `var()` 都命中兜底值，弹窗在暗色页面里渲染成 `#fff` 底 + `#1f2328` 字 —— 浅色窗口贴在深色页面上。

关键点：**兜底值本身就是缺陷**。任何「取不到就用浅色」的写法，在暗色主题下都必然错；这与变量名叫得对不对无关。

## 决策

1. **内联 UI 的每个颜色都在「打开那一刻」从页面解析**，不缓存（用户可能在两次打开之间切换主题，`data-color-mode` 变了就要跟着变）。
2. 解析链三级，逐级降级：
   - ① 读 `getComputedStyle(document.documentElement)` 上**当前一代** token（`--bgColor-*` / `--fgColor-*` / `--borderColor-*` / `--button-*-*` / `--overlay-*` / `--shadow-*` / `--borderRadius-*` / `--control-checked-bgColor-rest`）；
   - ② 该 token 为空 ⇒ **采样 GitHub 原生节点**的 computed style。这一级只覆盖 8 个位置（面板底 `canvas`、描边 `border`、强调前景 `accentFg`、次要按钮底/边 `btnBg`/`btnBorder`、主按钮底 `btnPrimaryBg`、勾选框 `checked`、遮罩 `backdrop`），其余字段是「token → 同级 token」或「token → 留空」，**不走采样** —— 「降级到采样原生节点」不是全局保证。语义色 `accentBg` 退到 `canvas` 是**表面色→表面色**，属同级兜底；
   - ③ 都取不到 ⇒ 返回空串，调用方**跳过该属性**。
3. **采样级的三条硬约束 + 一条跨域配对规则**（评审补，见「后果与代价」）：
   - 只采**页面原生**节点，`OWN_UI` 里的脚本节点（两个弹窗 / 通知栈 / 两个横幅 / 标签筛选浮层 / 三个筛选浮层）整棵子树跳过。否则两个弹窗同时在场时，后开的那个会采到先开那个写进去的旧主题值。收录判据 = 「脚本自建**且**会命中 `NATIVE` 某个选择器」；给原生节点补类名（如给原生按钮加 `.btn`）不在此列 —— 那些值仍来自页面样式表。**已知缺口**：脚本在网格里自建的 `<a href>`（卡片标题、`.Link--muted` 计数、分页 `prev`/`next`）会命中 `accentText` 第二级；不把整个网格排除，是因为网格里也有原生节点，一刀切会连带损失正常路径的采样源。走到那一级需要 `--fgColor-accent` 与全部 `.Link` 同时消失，后果仅是「强调色不够强调」（只用于拖拽描边）。
   - **跨域配对**：主按钮的底与前景必须同域。底退到 `btnBg`（默认面）时，`btnPrimaryFg` **整个留空**（继承页面前景色），不能只对 `--fgColor-onEmphasis` 那一级设约束 —— 只缺 `--button-primary-bgColor-rest` 而 `--button-primary-fgColor-rest` 还在时，会得到白字压近白底（约 1.05:1），比 issue #1 更难发现（按钮看起来没坏，只是读不出来）。
   - **逐元素**推进，不是逐选择器推进：首个命中透明/无边框就继续看下一个元素。
   - 采描边时要求 `border-style !== none` 且宽度 > 0（否则 `borderTopColor` 返回 `currentColor`，会得到一道文本色的粗线）。
   - **不做跨域兜底**：文本色不拿面板底色兜、底色不拿文本色兜。`checked` 与 `btnPrimaryFg` 取不到就留空（交给浏览器默认），否则会造出「白勾选框压白面板」这种硬错。主按钮的底/前景还要**成对**成立，见上面那条跨域配对。
4. **语义色不能直接当底色用**：暗色主题下 `--bgColor-*-muted` / `--bgColor-accent-muted` 都是 alpha 色 —— token 原值是 8 位带 alpha 的十六进制（实测 `#388bfd1a`=10% / `#2ea04326`=15% / `#bb800926`=15% / `#f851491a`=10%；`backgroundColor` 上读出来才是 `rgba(56,139,253,0.1)`），亮色反而全不透明。通知是 `position:fixed`、导入窗是全屏遮罩，直接铺 alpha 色会让面板透出下面的页面内容。统一走 `tintOver(base, tint)`：`background` = 页面 `canvas`（不透明），`backgroundImage` = 语义色的一层渐变。两处调用点（通知底、拖拽高亮）**都不许**退回直接写 `background`。
5. **不写任何颜色字面量**。`borderCss(width, color, style)` 在 color 为空时退回 CSS 关键字 `currentColor`（关键字不是自造颜色，它表达「跟随继承的前景色」）。唯一自造值是两档圆角（`12px` / `6px`）—— 几何值不是配色，且 token 级（`--borderRadius-*`）在 GitHub 上恒命中，只是理论上不可达的兜底。
6. 判据自动化：`scripts/verify-theme-tokens.cjs` 拦两种写法 —— 旧一代 `--color-*` 变量（**默认拒绝 + 白名单放行**，不再按前缀枚举：枚举必然漏，`topic-tag` / `diff-blob` / `select-menu` 等 11 个前缀都曾漏过；白名单是实测仍活在 `:root` 上的 62 个变量所属的组，全部没有弹窗配色用途）、`src/ui/**` 里的颜色字面量（十六进制四档长度 3/4/6/8、`#${` 模板拼接、`rgb(` / `hsl(`、常见具名色）。唯一豁免是 `src/ui/theme.ts`：它只做读取，不产生颜色。守卫接入 `pnpm check`。
   ⚠️ **守卫只证明「没有字面量」，证明不了「采到对的元素」**。已知它仍看不见：运行期用 `'#' + hex` 拼出来的颜色、CSS 系统色（`CanvasText` / `AccentColor`）、`src/ui` 之外定义的颜色常量，以及任何一种「值合法但语义错」的采样 —— 后者只能靠真机量测（见计划文档的两套主题数字）。

## 依据

- **用户裁定**：「theme 从原始页面获取，禁止自己写」。这一条直接否掉了首版方案（把 GitHub 的 token 抄成静态 `UI_COLORS` 常量表）—— 静态表在 GitHub 下次改配色或改变量名时会再次静默失效，且失效形态仍是「白底」。
- **可观测性**：同一份产物在同一个页面里强制 `data-color-mode` 反转，所有值随之整体翻面（见计划文档的 A/B 数字）。这排除了「恰好写对了一套暗色」的可能，证明是跟随而非硬编码。
- **失效方向**：③ 的降级让「解析失败」表现为**取不到就留空**，而不是自造一个必然错的值。`canvas` 这一项额外加了 `body` 采样兜底（页面画布色，仍是页面给的），所以最差形态不是「透明面板」而是「一块页面画布色的实心面板」。其余字段留空的后果确实不好看 —— `background` 不可继承，跳过它得到透明；`border` 退成 `currentColor`；遮罩虽透明但仍 `inset:0` 拦点击（页面点不动、只能 Esc 关闭）。这是规则（不编颜色）逼出来的形态，比「白底压深色页面」好，但不该被描述成「优雅继承」。

## 后果与代价

- `ui/theme.ts` 成为内联 UI 的唯一取色入口。新增语义色时扩 `UiTheme` 与解析链，不要在调用点就地写值 —— 否则守卫会报错，而报错的正解不是加豁免。
- `resolveUiTheme()` 每次**只取一次** `getComputedStyle(document.documentElement)` 并全程复用；其余是若干处原生节点采样（各 `querySelectorAll` + 逐元素遍历，跳过脚本自己的节点）。真机实测一次开窗（含整窗 DOM 构建）约 3ms，且都在开窗路径上、不在滚动或渲染热路径，不做缓存。理论最坏情况是某个采样台阶全程落空、要把 `a[href]` 这类大集合走完（stars 页实测 234 个 `<a>`），但那要求 token 缺失 —— github.com 上不会发生。**通知是每条解析一次**，所以主题在两条通知之间被切换时，栈里会出现两种底色（有意接受：宁可各自正确，不要整栈用旧主题）。
- 采样节点的选择器依赖 GitHub 的类名（`.Box` / `.btn` / `.Overlay-backdrop` / `.Link`），属于无官方契约的表面结构。几条实测约束已经写进代码注释，别退回朴素写法：`a[href]` 的第一个命中是全站跳过导航链接（`color-fg-on-emphasis`，暗色下是白），必须排除；`.btn` 的第一个命中可能是主/危险按钮，必须排除；`[role=alert]` 可能是脚本自己的归属横幅，不能当通知语义色来源。
- `--borderRadius-*` 也改成读 token，且 token 缺失时先采样原生弹层/按钮的 `borderTopLeftRadius`；只有两级都取不到才退到 GitHub 的两档常用值（`12px` / `6px`）。圆角是几何值不是颜色，且内联面板全是方角比「圆角略大」更难看 —— 这个兜底是刻意的，与「禁止自造颜色」不冲突。
- **不在本决策范围内**：`confirm()` / `alert()`。它们是浏览器原生对话框，主题由浏览器决定，脚本无法着色。issue 若要求「整窗一致」，需要把这些交互换成页面内弹窗 —— 那是另一次取舍（脚本自己的确认 UI 会引入新的焦点管理与无障碍责任）。**注意**：这意味着「恢复/导入」流程中途仍可能弹出一个白色原生确认框，D35 覆盖不到它。
- **`src/styles/*.css` 不在本决策范围内，且它们自己仍带浅色兜底**（`var(--borderColor-default, #d0d7de)` 等）。那份样式表只在 Stars 视图注入、跟随页面 token，失效形态是「网格边框用错色」而不是白底弹窗；但它属于同一类写法，若要彻底清除需要另立一条。不要以为 D35 已经把它们管住了。

## 相关

- 通知栈的观感口径（`.flash` 族、不用 Primer `Toast`）不变，见 D11；变的只是颜色来源。
- 导入窗口的虚线描边：`borderCss('2px', theme.border, 'dashed')` —— 把 `dashed` 拼进宽度参数会产出**非法简写** `border: 2px dashed solid <c>`，浏览器**丢弃整条声明**，结果是**没有边框**（`border-style` 回到初始值 `none`），而不是退回某个颜色。
