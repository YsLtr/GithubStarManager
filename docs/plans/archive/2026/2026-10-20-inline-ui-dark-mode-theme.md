# 修复 issue #1：内联 UI 的暗色模式不跟随（4.19.3）

实施日期：2026-10-20。决策见 [ADR 0012](../../adr/0012-inline-ui-theme-from-page.md)（D35）。

## 触发

[issue #1](https://github.com/YsLtr/GithubStarManager/issues/1)：**恢复已取消的 star 弹出菜单暗黑模式不兼容 —— 无法和网页内容一样转变为暗黑模式**。

用户随后追加两条硬要求：

1. **用 agent-browser-cli 到真实浏览器验证**（不接受只在 `file://` 夹具上自证）。
2. **theme 从原始页面获取，禁止自己写** —— 这条否掉了首版方案（把 GitHub token 抄成静态 `UI_COLORS` 常量表）。

## 纳入 / 排除

**纳入**（同一根因、同一解析器）：

| 位置 | 症状 |
|---|---|
| `ui/restoreMenu.ts` 恢复窗口 | 弹窗底板、遮罩、标题、提示、列表行、元信息、复选框、两个按钮 |
| `ui/exportImportMenu.ts` 导入大窗 | 底板、虚线描边、标题、提示、关闭按钮、pick 按钮、拖拽高亮 |
| `ui/notifications.ts` 通知栈 | 四种语义色的底色 / 描边 / 图标色、卡片投影、动作按钮三态 |

**排除**：

- `confirm()` / `alert()` —— 浏览器原生对话框，主题由浏览器决定，脚本无法着色。若 issue 要求「整窗一致」，需另立决策把它们换成页面内弹窗（会引入焦点管理与无障碍责任）。
- 页面内**非内联**的脚本 UI（卡片、筛选栏、归属横幅）—— 它们走 `src/styles/*.css`，跟随页面 token，本轮不动。⚠️ 修正（审查发现原表述有误）：`src/styles/` 里**没有** `@media (prefers-color-scheme)`，而且那几份样式表自己仍带着浅色兜底（`var(--borderColor-default, #d0d7de)` / `var(--bgColor-attention-muted, #fff8c5)` 等）—— 属于同一类写法，只是失效形态是「网格边框用错色」而不是白底弹窗。要彻底清除得另立一条决策。

## 根因

三个内联 UI 把颜色写成 `var(--color-canvas-default, #ffffff)` 这一代变量 + 浅色兜底。GitHub 已把整代 `--color-*` 删除，换成 `--bgColor-*` / `--fgColor-*` / `--borderColor-*`。真机（暗色 stars 页）实测这批旧变量在 `:root` 上**全部为空** ⇒ 每个 `var()` 命中硬编码浅色 ⇒ 暗色页面里弹窗白底黑字。

要点：**兜底值本身就是缺陷**。变量名对不对不是关键，「取不到就用浅色」在暗色主题下必然错。

## 改动

1. **新增 `src/ui/theme.ts`** —— `resolveUiTheme()` 在打开那一刻现场解析，三级降级：页面 token → 采样 GitHub 原生节点（`[role=dialog]` / `.Box` / `.btn` / `.btn-primary` / `a[href]` / `.Overlay-backdrop` / `.flash*`）→ 返回空串让调用方跳过该属性。导出 `UiTheme`（canvas/fg/fgMuted/border/accent*/btn*/checked/backdrop/shadow*/radius*/`notice[4 tone]`）与 `borderCss(width, color, style)`。**不缓存**。
2. `ui/restoreMenu.ts` / `ui/exportImportMenu.ts` / `ui/notifications.ts` 改用它；`notifications.ts` 的 `KIND_STYLE` 拆成 `KIND_ICON`（只留图标 path），`BTN_SHADOW` / `CARD_SHADOW` 常量删除（改 `theme.btnShadow` / `theme.restingShadow`）。
3. **新增 `scripts/verify-theme-tokens.cjs`** 并接入 `pnpm check`：拦「旧一代 `--color-*` 变量」与「`src/ui/**` 里的颜色字面量」，`ui/theme.ts` 豁免。
4. `package.json` 版本 4.19.2 → 4.19.3。

## 真机验证（agent-browser-cli，真实 github.com）

方法：把整份 `dist` + GM stub 内联成一个 `.diag/*.js`，`agent-browser-cli exec --tab <id> --file` 注入（扩展上下文，绕过 CSP，等价于 TM 注入）。页面 = **`https://github.com/YsLtr?tab=stars`**（用户实际打开这两个菜单的地方；脚本在本页会接管网格，内联弹窗与页面原生样式共存，是最真实的场景），`colorScheme: dark`，页面底色 `rgb(13,17,23)`。

> 教训：第一轮我图省事把验证页选成了 issue 详情页。**主题解析的结论不受影响**（token 与原生节点采样在整站同源），但 stars 页才是这些菜单真正被点开的位置，也是唯一能同时看到网格与弹窗的地方 —— **验证页要选用户会用的那一页**。

### A/B：恢复窗口（stars 页，同一页面、同一份 DOM 路径）

| 指标 | 修复前（`.diag/prefix.user.js`） | 修复后（4.19.3） |
|---|---|---|
| `boxBg` | `rgb(255,255,255)` | `rgb(1,4,9)` |
| `boxFg` | `rgb(31,35,40)` | `rgb(240,246,252)` |
| `boxBorder` | `rgb(208,215,222)` | `rgba(61,68,77,0.7)` |
| `boxShadow` | 默认 | `rgb(61,68,77) 0 0 0 1px, rgb(1,4,9) 0 24px 48px 0` |
| `overlayBg` | `rgba(0,0,0,0.55)` | `rgba(33,40,48,0.4)` |
| `checkboxAccent` | `auto` | `rgb(31,111,235)` |
| `plainBtn` | 浅色 | `rgb(33,40,48)` / `rgb(240,246,252)` / `rgb(61,68,77)` |
| `primaryBtn` | 浅绿 | `rgb(35,134,54)` / `rgb(255,255,255)` |
| `hintFg` / `rowMetaFg` | 灰（浅色系） | `rgb(145,152,161)` |

**修复前 = 白底黑字，issue 复现。**

### 同页强制 light（证明是跟随、不是写死了一套暗色）

`document.documentElement.setAttribute('data-color-mode','light')` 后重开：

`boxBg` `rgb(255,255,255)`、`boxFg` `rgb(31,35,40)`、边框 `rgba(209,217,224,0.5)`、遮罩 `rgba(200,209,218,0.4)`、`checkboxAccent` `rgb(9,105,218)`、plain btn `rgb(246,248,250)`/`rgb(37,41,46)`、primary `rgb(31,136,61)`。导入窗口同步翻面（`boxBg rgb(255,255,255)`、虚线描边 `rgba(209,217,224,0.5)`）。

### 通知栈（真实触发 `pushNotice`，不是构造节点）

触发路径：清掉 `stars_full_sync_meta` 与 localStorage 镜像后走**导入**（`needSync` 为真 ⇒ 先 `pushNotice('导入前先同步一次…', 'info')`），导出包 `user.id` 用页面真实 actor id（否则归属校验拒绝、表现为「什么都没有」）。

| 指标 | dark | light |
|---|---|---|
| `bg` | `rgba(56,139,253,0.1)` | `rgb(221,244,255)` |
| `border` | `rgba(56,139,253,0.4)` | `rgba(84,174,255,0.4)` |
| `fg` | `rgb(240,246,252)` | `rgb(31,35,40)` |
| `iconColor` | `rgb(68,147,248)` | `rgb(9,105,218)` |
| `shadow` | `rgba(1,4,9,0.6) 0 1px 1px 0, …` | `rgba(31,35,40,0.04) 0 1px 1px 0, …` |

截图（均在 stars 页）：`.diag/stars-before-dark.png`（白底弹窗）、`.diag/stars-after-dark.png`、`.diag/stars-after-light.png`。

### 静态验收

- `pnpm check` 绿：`tsc --noEmit` → `✓ 内联 UI 配色检查通过（53 个 .ts/.css，无旧变量、无颜色字面量）` → `vite build`（dist 214.51 kB，`@version 4.19.3`，`@grant` 恰 5 项）。
- `node scripts/verify-css.cjs` → `CSS 等价性: OK`（本轮不动 `src/styles/`）。
- `pnpm test:exportimport` 153 通过 / 0 失败；`pnpm test:api` 33 通过。

## 踩过的坑（对下一轮有用）

1. **`borderCss('2px dashed', color)` 会静默失效**：拼出来是 `2px dashed solid <color>` 这类非法简写，浏览器**丢弃整条声明** —— 后果是**没有边框**（`border-style` 回到初始值 `none`），不是「退回 currentColor 实线」。修法：`borderCss(width, color, style)` 第三参数。
2. **想验证「token 全缺时的降级」不能靠置无效值**：把解析器读的 token 全部 `setProperty(n, 'initial')` 会同时打断 GitHub 自己的整页配色（body 变透明、前景变黑），页面已经不是「另一套命名的正常页面」，断言只能得到无意义的黑底。该轮已从工装里删除并留注释。
3. **通知触发要比想象中难**：`隐藏 Lists` 开关不推通知；导入路径的 info 通知要求 `hasApiData()` 为假 —— 而 `gmGet` 有 localStorage 镜像迁移，只改 stub 的 `GM_getValue` 不够，必须连镜像键一起临时清掉（脚本结束时按快照还原）。
4. **导入包的 `user.id` 必须取页面真实 actor id**（`meta[name="octolytics-actor-id"]`）：写死假 id 会被归属校验拒，且 `alert` 被中和后表现为「什么都没发生」。
5. 注入式验证会在真实配置里**留下痕迹**（本轮导入包写进了 `stars_pending_delete_<id>` 一条 `424242` 探针）；结束必须清掉并回读 localStorage 确认。本轮已清理并确认 `remaining: []`。

## 失败方向（明确记录）

解析失败 ⇒ 该属性**不写**。**注意别把它说成「继承页面」**：`background` 不是可继承属性，跳过它得到的是**透明面板** —— 一层透明底 + `currentColor` 描边 + 仍然 `inset:0` 拦点击的遮罩，用户看到的是「自己页面上的两层文字叠在一起、页面点不动、只能 Esc 关掉」。唯一例外是 `canvas`：它的采样链末尾加了 `body`（页面画布色），所以最差形态是「一块页面色的实心面板」而不是透明。这是规则（不编颜色）逼出来的形态，比「白底压深色页面」好，但不是「优雅继承」。不接受的是「取不到就兜浅色」。

## 本轮审查（四路代理 + 实机复测，均已处理）

初审结论：**没有阻断项**，报告的 bug 确实修好；问题集中在「降级安全网」与文档措辞。已修：

1. **跨弹窗自采样（真 bug）** —— 两个弹窗的关闭函数只删各自的遮罩，所以「导入窗开着时开恢复窗」会让后者的 `[role="dialog"]` 采样命中前者的盒子，拿到**上一个主题的颜色**（= issue #1 现象复活）。修：`OWN_UI` 前缀子树整棵跳过。实机复测：暗色开导入窗 → 切亮色 → 开恢复窗，后者拿到 `rgb(255,255,255)`（正确），不是前者的 `rgb(1,4,9)`。
2. **`a[href]` 采到跳过导航链接（真 bug）** —— 实机量到第一个 `<a>` 是 `show-on-focus js-skip-to-content`，前景 `rgb(255,255,255)`。拿它当强调色 ⇒ 白勾选框压白面板、白描边。修：强调色优先 `.Link`（实测 `rgb(68,147,248)` = `--fgColor-accent`），并排除跳过链接；`checked` / `btnPrimaryFg` 不再拿强调色兜底。
3. **`.btn` 首个命中可能是主/危险按钮** —— 修：`NATIVE.button` 排除 `.btn-primary` / `.btn-danger`。
4. **`borderTopColor` 对无边框元素返回 `currentColor`** —— 修：采样前要求 `border-style !== none` 且宽度 > 0。
5. **`sample()` 逐选择器而非逐元素推进** —— 首个命中透明就整级作废。修：改成 `querySelectorAll` 遍历，跳过透明/无边框/脚本自有节点。
6. **拖拽高亮的 `''` 语义错**（`exportImportMenu.ts` 的 `highlight()`）—— 用「取不到就不写」导致 `highlight(true)` 的强调色**永久粘住**。修：无条件写（空串 = 撤销 longhand = 回到创建时 shorthand 的值）。这是全仓唯一一处「先写过再恢复」的双态开关。
7. **导入窗没设 `color`，文字靠继承** —— 中途切主题会「深底深字」（实机复现 `bg=rgb(1,4,9)` 配 `fg=rgb(31,35,40)`）。修：面板自己写 `color: theme.fg`。复测 `fg=rgb(240,246,252)`。
8. **语义色是半透明** —— 暗色 `--bgColor-*-muted` 与 `--bgColor-accent-muted` 的 token 原值都是 8 位带 alpha 的十六进制（`#388bfd1a`=10% / `#2ea04326`=15% / `#bb800926`=15% / `#f851491a`=10%），亮色反而全不透明。第一处暴露在通知栈（`position:fixed`，压在亮色图片上会「浅字压浅底」，旧实现是不透明色 ⇒ **对比度回退**）；第二轮自查又在**导入窗的拖拽高亮**发现同一问题（`highlight(true)` 直接把 `backgroundColor` 写成 alpha 色 ⇒ 面板在拖拽过程中整体变半透明）。修：统一用 `theme.ts` 的 `tintOver(base, tint)` —— 底永远用页面 `canvas`（不透明），语义色作为 `backgroundImage` 一层渐变盖上去。实机：通知暗色 `bg=rgb(1,4,9)` + `linear-gradient(rgba(56,139,253,.1), …)`、亮色 `bg=rgb(255,255,255)` + `#ddf4ff`；导入窗拖拽中 `bg` 保持 `rgb(1,4,9)` 不透明、`backgroundImage` 才出现强调色，`dragleave` 后回到 `none`；亮色拖拽 `bg=rgb(255,255,255)` + `linear-gradient(rgb(221,244,255), …)`。
9. **`token()` 接受 `transparent` / `none` / `auto`**（`sample()` 却拒绝）—— 高对比度主题里 `box-shadow: none`、`accent-color: auto` 会被当成有效值。修：统一 `NULL_VALUES`。
10. **守卫漏检与误报** —— 补进 `icon` / `input` / `header` / `menu` / `timeline` / `codemirror` / `calendar` / `diffstat` / `underlinenav` / `workflow` / `checks` / `search` / `sidenav` / `footer` / `ansi` 等同一代前缀；字面量检查前先剔除自定义属性**名**（否则 `--color-marketing-gray-1` 会被 `gray` 规则误判）；`gray`/`grey` 从具名色表里去掉（`whiteSpace` / `blacklist` 本来就因词边界不命中，但 `gray` 误伤面太大）。正反两侧都实测：故意放违规文件 exit 1，删掉后 exit 0。第二轮又补三处：① 十六进制改按 CSS 合法四档长度收（原来 `{3}{3}?` 漏掉 `#0000` / `#fff8` 这类**四位带 alpha** 的写法 —— 而 GitHub 暗色 token 恰好就是 8 位 hex，说明这个形态真实存在）；② `#${` 模板拼接按颜色字面量算；③ 行尾注释先剔除（`// see issue #123` 里的 `#123` 被当成 3 位 hex 误报）。扫描后缀从 `.ts/.css` 扩到 `.tsx/.js/.jsx/.mjs/.cjs`。
11. **`sample()` 的 `SampledProp` 里留着没人用的 `'boxShadow'`** —— 类型层面留着会让人以为「投影也能采样」，实际投影只走 token。第二轮删掉。
12. **`OWN_UI` 少了 `.stars-tag-filter`** —— 该容器里脚本自建了一个 `class="Overlay"` 的浮层（`ui/tagFilter.ts:85`），会命中 `NATIVE.dialog` 的第三级。它只在标签筛选浮层打开时才在 DOM 里，所以第一轮漏了；收录判据（「脚本自建**且**会命中 `NATIVE` 某个选择器」）写进 ADR 之后才补上。
13. **`canvas` 采样链没有页面级兜底** —— 三级（`--overlay-bgColor` → `--bgColor-default` → `NATIVE.dialog`）全落空时会得到透明面板。补 `body` 作为第四级（页面画布色，实测暗色 `rgb(13,17,23)`），最差形态变成「页面色的实心面板」。其余字段仍按「取不到就不写」。
14. **文档不实陈述已订正**：原文说降级会「让页面 color / 背景继承下来」（`background` 不继承，实际是透明面板）、「采样从中取同类语义值」（实际有过滤规则）、「`@media (prefers-color-scheme)`」（`src/styles/` 里没有这个媒体查询，且仍带浅色兜底）、「多几次 `getComputedStyle`」（实际每次 resolve 曾达 ~48 次 root 读，已改为复用一次）、`borderCss` 失败形态的描述、以及把语义色的 alpha 形态写成 `rgba(...,.1)`（token 原值是 8 位 hex，如 `#388bfd1a`；`backgroundColor` 上读出来才是 `rgba()`）。

**未修、明确记录**：主题在**通知生命周期内**切换会让栈内出现两种底色（每条各自解析，有意选择「各自正确」而非「整栈一致」）；弹窗是打开那一刻的快照，长时间开着（批量恢复 ≥1s/条）期间切主题不会跟随；GitHub 原生 `<dialog showModal>`（cmd-K）会把脚本的 `zIndex:9999` 遮罩压在下面且不在其焦点作用域内，任何 z-index 都无解。
