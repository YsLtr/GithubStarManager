# ADR 0009 · 他人 star 页的零网络只读网格

- 状态：**已采纳**（4.13.0）
- 决策日期：2026-10-03
- 相关：ADR 0008（他人页只读，本 ADR 取代其**呈现方式**，只读铁律不变）、AGENTS.md D20/D26/D27
- 证据：`.diag/gen-otherstars-harness.cjs` + `.diag/assert-otherstars.js`（8 组断言，全绿）、
  本次真机实测的字段可得性清单（`src/domRepos.ts` 文件头）、`.pi/tmp/scout-other-stars-grid.md`（接缝侦察）

## 背景

用户先报「在别人的 stars 页上，我没 star 过的仓库也显示成实心黄星」。4.12.0 的修法是**保留原生列表 + 注入只读标签/备注徽章**，
真机验证确认它在工作，但**用户几乎永远看不到东西**：实测 mattn 前 100 个 starred 仓库与本人 21 个带标签/备注的仓库
**交集为 0**（本人只给自己的收藏打过标签，随机他人页首页命中率 <1%）。

用户随后裁定「用脚本网格」，并给出**决定性约束**：

> 只获取页面中已有的数据，不拉取，做网格。

此前两版方案分别因「不全量拉取（徽章看不见 / 筛选会说谎 / 分页无处可跳）」与「整表拉取（违反不拉取）」被否。
本 ADR 记录满足该约束的最终形态。

## 决策

**他人 star 页 = 把页面上已渲染的原生条目投影成脚本卡片网格，全程零网络、零存储写入。**

1. **数据只来自 DOM**（`src/domRepos.ts`）：不调 API、不预取、不做条件请求、不做归属校验请求、不落盘。
   连带取消：他人缓存键、额度/ETag 模型、`fullSync` 扫描引擎泛化（前一版最大的回归面）。
2. **字段可得性写在代码里**（`domRepos.ts` 文件头表格）。实测要点：
   - 两条路由（`/{login}?tab=stars` 与 `/stars/{login}`）**条目容器不同、内部四块结构相同**；
   - `name` 取 `h3 a[href]` 的 **href**（第三方 utags 脚本会往 `h3` 里插按钮污染文本）；
   - `stars`/`forks` 文本含**千分位逗号**（`1,361`）；
   - 时间字段**按前一个文本节点的标签分派**：`Updated` → `updatedAt`，`Starred` → `starredAt`
     （两条路由同一位置显示的语义不同，实测同一仓库两处值不同 ⇒ 不看标签一律写 `updatedAt` 就是谎报）；
   - **不读星状态**：只读模式不渲染星按钮，故绕开了 `.starring-container.on` 的歧义。
3. **只存内存**（`src/viewContext.ts`）：一次「页面 → 内存表」的投影，随导航丢弃；**不写任何存储键**。
   标签/备注仍从**我自己的**命名空间读（D27）。
4. **只读渲染复用**（`filters.renderBrowsePage` 的只读分支）：不建星按钮、标签/备注走 `readonly.ts` 的只读渲染器、
   不挂脚本分页器。`cards.ts` 与 `ui/tagFilter.ts` / `ui/notes.ts` 的**构建逻辑一字未改**
   （后者直接绑 `saveTags` / `saveNote`，属「我自己的页」的写路径，故只共享卡片容器而不共享渲染器）。
5. **分页与筛选委派原生控件**：只藏原生**条目**，原生分页器/筛选栏/Lists 一律不动。
   理由：实测 HTML stars 页 `?page=N` **被忽略**（真实翻页是 `after`/`before` 游标），
   而 D22 的本地分页/跳页语义建立在「整表在手」之上 —— 只有本页数据时挂本地分页器等于给出无法兑现的页码。
   筛选同理：他人页没有脚本筛选栏，故**刻意不套用** `filterState`（沿用我自己页残留的筛选会让网格莫名变空）。
6. **不接管的情形**：未登录、取不到页面主人、条目数为 0、宿主两条路线都认不出 —— 一律什么都不做
   （GitHub 自己的空态/错误态比我们造一个更合适）。
7. **零网络的实现细节（重要）**：卡片渲染会经 `getLangColor()` 在**色表未命中**时顺手发一次 linguist 请求
   —— 这条**间接**路径同样违反零网络（工装实测：不设闸时 `fetchLog` 恰有一条 `languages.yml`）。
   故在 `langColors.ts` 的唯一出口 `fetchLangColors()` 设闸（`setLangColorFetchEnabled`），
   进入他人页关闭、退出恢复；关掉后「已缓存色表照用、未命中则灰点」，正是「只用缓存」的口径。

## 为什么不选其它方案

- **4.12.0 的原生列表 + 徽章**：信息密度太低（交集为 0 时脚本完全不可见），用户已裁定改用网格。
- **拉取（按需或整表）**：违反「不拉取」；且匿名额度只有 60/hr、304 仍计数（详见前一版的实测数据，本方案不用）。
- **本地分页/筛选/搜索**：只有当前页数据，标注「仅本页」也仍是两种语义；委派原生的行为最诚实。

## 后果与已知局限

- **标签/备注只在「我也给那个仓库打过标签/写过备注」时出现**：这是数据的性质，不是缺陷。
  编辑入口仍只在**我自己的** stars 页（与他人页零写入口的裁定一致）—— 因此**不能**给「对方 star 了但我没 star」的
  仓库打标签（它不会出现在我的列表里）。
- **单页条目数上限**：数据只有这一页（30 条左右），翻页靠原生分页器；跨页筛选/搜索在本设计下不存在。
- **字段缺失即降级**：DOM 里没有的字段就不渲染（例如 `/stars/{login}` 路由的描述实测恒为空 ⇒ 卡片显示「No description」）。
- **`viewContext` 是模块态**：Turbo 换 DOM 冲不掉它 ⇒ 必须靠 `exitOtherStarsViewIfActive()` 复位。
  工装的 `roundtrip` 场景抓到的真实缺陷（从他人页回到自己的页会把**别人的**列表画在我自己的页上）就是漏了这一步。
- **依赖 GitHub 的条目结构**：改版 ⇒ 退化为「不接管」（功能消失，但不破坏页面、不留残次网格）。
- **明确不做**：`/users/{u}/starred` 及其一切派生（缓存/条件请求/额度策略）、他人数据落盘、
  脚本分页器与跳页、脚本筛选栏与搜索拦截、`/stars`（无登录名段的本人新版页）、对方的私有可见 star。

## 4.13.0 发布前的真机修正（两个缺陷 + 一次口径升级）

首版按上面的「只藏条目、不接管布局」实现，`pnpm check` 与 8 组仿真断言全绿，**用户真机打开 `/mattn?tab=stars` 报「网格没有应用」**。
真机排查出两个独立缺陷，各自的根因都在「仿真的保真度」上：

### 缺陷 1：原生条目根本没被藏住（标记与 inline style 全写对，computed 仍是 `block`）

`div.col-12` 条目带着 Primer utility 类 `col-12 d-block width-full`，而 `.d-block{display:block!important}`
会**压过不带 important 的 inline `display:none`**。实测（真机）：30 个条目的 `data-gsm-hidden` 与
`style="display: none"` 全部写对，`getComputedStyle(el).display` 依旧是 `block`，条目仍占据布局空间
⇒ 网格插在列表上方、原生 30 条原样跟在下面，页面高达 7441px。

- 为什么自己的页没踩到：本方隐藏原生列表用的是**类 + CSS**（`.stars-original-hidden{display:none!important}`），
  而 `hideNativeNode` 的调用点（原生筛选菜单）恰好都没有 `d-block`。**同一份 `display:none`，在被 `!important`
  压制的场合就是无效写入**。修法：`hideNativeNode` 一律 `setProperty('display','none','important')`。
- 为什么仿真没抓到：夹具只为 Lists 标题行复现了 `.d-flex{!important}` 陷阱，**没有**给星标条目复现
  `.d-block{!important}`（当时脚本还从不逐条隐藏，夹具没这个需求）。修法：夹具补上该规则。
- 为什么断言没抓到：`R3_visibleNativeItems` 当时数的是「**没有** `data-gsm-hidden` 标记的条目」，
  是**属性探测**而不是可见性探测。修法：改为真实的可见性探测（`offsetParent` + 高度）。
  **咬合实测**：把 `hideNativeNode` 改回不带 important → 该断言由 0 变 2（复现真机症状）；改回后重新为 0。

### 缺陷 2：卡片/网格的样式根本没注入

卡片与网格的样式全在**布局主表**（`base.css` 的 `.stars-grid-container` / `.stars-grid-card` / 卡片内部 +
`wide.css` 的三栏宽度）里，而首版只读了「不接管页面」这一条，把 `ensureStyles()` 整个跳过
⇒ 卡片无边框、网格 computed `display: block`、卡片单列铺满 —— 屏幕上就是「一堆没有样式的行」。
真机实测：`gridDisplay: 'block'`、`grid-template-columns: none`、`gap: normal`。

修法：把样式生命周期从 `index.ts` 抽成 **`src/layoutStyles.ts`**（`ensureLayoutStyles` / `removeLayoutStyles`），
两条展示路径共用；他人页进入时注入、退出时撤表。

### 口径升级：他人页的**呈现层**与本方自己的页完全一致（用户裁定）

注入布局表就意味着「收窄左栏」这类规则一并生效，于是出现一个必须由用户拍板的问题：他人页要不要连
**页面框架**一起接管。用户选择 **方案 A = 观感与自己的页完全一致**，因此：

- 注入 `base + wide`（左栏收窄到 180px、≥1200px 三栏、网格满宽 3–4 列）；
- **把对方的 Starred topics 搬进脚本右栏**，原生 `.col-lg-3` 由 `base.css` 隐藏（内容不丢、也不留空列）；
  `.Layout.Layout--sidebarPosition-start` 缺失的 `/stars/{login}` 路由搬不动，topics 留在原处（无害）；
- 搬运/归还实现**上移到 `dom.ts`**（`moveTopicsToRightSidebar` / `restoreTopicsFromRightSidebar`），
  本方页、他人页、`viewTeardown` 三处共用 —— 首版只在 `transform.ts` 里写了搬运，他人页没得用；
- **仍然不做**（用户更早的裁定，未被本次覆盖）：星标按钮、标签/备注编辑入口、脚本分页器/跳页、
  脚本筛选栏与搜索拦截、头部同步按钮、配置横幅与归属横幅、任何 API 请求、任何存储写入。

### 测量教训：冻结的后台标签页会返回**过期**的 computed style

排查缺陷 2 时一度得出「注入的样式不生效」的错误结论，证据是「连 inline `!important` 都改不动 computed width」。
真相是该标签页 `visibilityState === 'hidden'`（浏览器窗口不在前台），**布局从未重算**：
后台标签页里 `getComputedStyle` 返回的是最后一次渲染时的值，因此看起来「CSS 完全不生效」。
`Page.bringToFront` + `allowFocus` 也不一定能让它变 visible（窗口本身没有焦点），
`Page.setWebLifecycleState('active')` 同样不行。**可靠做法是 `agent-browser-cli open --focus` 新开标签页，
先回读 `document.visibilityState === 'visible'` 再测量**。这次同一条 URL 在可见标签页上是
`352px ×3 列 / 侧栏 180px`，与冻结页的「单列 / 296px」完全相反。

### 顺带修掉的一个**校验脚本**缺陷

`scripts/verify-css.cjs` 有两个问题：① 只用打包器生成的变量名 `base_default` 定位 CSS，
CSS 导入搬家后被常量折叠进 `gmAddStyle("...")`，脚本直接崩；② **它永远 `EXIT 0`**（只打印差异、不设退出码），
且比较前不抹平「源码有注释换行 / 产物压缩过 / 压缩器会合并同选择器规则、把 `::before` 写成 `:before`、
把四条定位展开成 `inset`、补 `-webkit-` 前缀」这些形变 ⇒ 每次都打印一堆差异却「通过」。
现在：抽取不依赖变量名 + 归一化后**按单个选择器聚合属性名集合**比对 + 差异即失败 + 关键标记哨兵
（防「抽到的更少 ⇒ 差异更少 ⇒ 假绿」）。**咬合实测**：源里多写一条属性而产物未重建 ⇒ EXIT 1；恢复 ⇒ EXIT 0。

### 真机验收（同日，两条路由，均为可见标签页）

| 项 | `/{login}?tab=stars` | `/stars/{login}` |
|---|---|---|
| 网格 | `display:grid`，3 列 × 352px | `display:grid`，2 列 × 355px |
| 卡片 | 30 张，`display:flex`，1px 描边 | 10 张，同 |
| 原生条目 | 全部隐藏（可见 0） | 仓库列表 10 条全隐藏（同页第二个 `ul.repo-list` = topics 列表，**未动**） |
| 原生筛选栏 / 分页器 | 筛选栏可见可用、分页器未打标记 | 无筛选栏（该路由不提供） |
| 侧栏与 topics | 侧栏 180px、topics 已搬入右栏、原生列隐藏 | 无 `.Layout` 结构 ⇒ 不搬（预期） |
| 只读 | 星按钮 0、输入框 0、脚本分页器 0、同步按钮 0 | 同 |
| 网络 | 无 `/user/starred`、无 `languages.yml`（仅 GitHub 自身遥测） | 同 |
| 说明行 | `@mattn 的 star · 本页 30 个 · 只读` | `@mattn 的 star · 本页 10 个 · 只读` |

本方自己的 stars 页同步回归：3 列网格 / 30 卡片 / 30 星按钮 / 上下两个本地分页器 / 顶部同步按钮 / 侧栏 180px /
topics 在右栏 / 无只读徽章与说明行 / 控制台无错误 —— 样式与 topics 的共用重构没有破坏本方路径。

## 同轮追加的两处修正（同用户反馈）

### 侧栏头像：选择器过宽，把 Sponsors 小头像一起撑大

用户报「sponsor 出现明显异常，头像大小全都竖向排列且和页主大小一致了」。

根因不是新代码，而是布局表里一条**既有**规则：`base.css` 缩小页主头像用的是
`.Layout-sidebar .avatar-user, .Layout-sidebar a[href*="avatars"] img`。对方页面上，侧栏里的头像**远不止页主那一张** ——
真机 mattn 页侧栏共 54 张 `img`：页主头像 1 张、Sponsors 区块 13 张（`img.avatar-user`，链接指向 `/user`）、
成就徽章 16 张、组织头像 24 张。裸 `.avatar-user` 与 `a[href*="avatars"]` 两族选择器把 13 张赞助头像
一起设成 `120px !important`，它们在 `.d-flex.flex-wrap` 里放不下，被迫逐个换行 ⇒ 竖排成一列且和页主一样大。

本方自己的页没暴露，是因为**侧栏里没有别的头像**（其「Sponsoring」是页签不是侧栏区块）；
这条缺陷对任何有 Sponsors 区块的用户页都成立。

修法：把尺寸选择器收窄到页主那一个，两条互为冗余、各命中 1 个元素：

| 选择器 | 命中数 | 为什么只命中页主 |
|---|---|---|
| `.Layout-sidebar .avatar-user.width-full` | 1 | 页主头像带 `width-full`（铺满容器），小头像不带 |
| `.Layout-sidebar a[href*="avatars"] img` | 1 | 页主头像的链接指向头像图片本身；小头像的链接是 `/login` |

失败方向都是良性的（都不命中时头像维持容器原宽 180px，不会被撑爆或压扁）。
`persistent.css` 里同族的 transition 选择器一并收窄 —— 否则过渡仍落在那排小头像上。
**真机对照**：同一用户 Overview 页（脚本不生效）的赞助头像也是 35px ⇒ 现在与原生完全一致；
页主头像 296px → 120px 是脚本的既有意图（保留）。

### 移除网格上方的说明行

首版在网格上方插了一行 `@login 的 star · 本页 N 个 · 只读`（当初的理由是「只有本页数据，得说清」）。
用户判定是**多余的描述文字** ⇒ 移除 `buildInfoRow` / `INFO_CLASS` 及其断言口径（现在断言「必须为 0」）。
页面标题（GitHub 自己的「Starred repositories」）已经说清这是什么；「只有本页数据」这件事由
**原生分页器仍在原位**表达，不需要一行文案。

### 两者都补进了工装

- 夹具的 `.Layout-sidebar` 从「只有一个昵称」补成**真机结构**：页主头像（`a[href*="avatars"]` +
  `img.avatar-user.width-full`）+ Sponsors 区块（标题 + `.d-flex.flex-wrap` 里两张 `img.avatar-user`，
  链接指向 `/user`）。首版夹具根本没有侧栏头像，所以这条既有规则的问题从未被覆盖。
- 新增断言 R13：页主头像 120px 且赞助头像 20px。**咬合实测**：把选择器回退成裸 `.avatar-user`
  ⇒ 赞助头像由 20 变 120（复现用户报告的现象）；恢复后回到 20。

## 追加：顶部快捷翻页器 + GitHub 的两代 stars 页面骨架

### 用户要求：原生分页器也要在标题行右侧出现一份

原生分页器只挂在**页面底部**（`#user-starred-repos > div > div.col-lg-9 > div.paginate-container > div`），
翻到一半要翻页必须滚到底 —— 用户要求把它也放到主内容右上角。

做法：抽 `src/topPager.ts` 的 `mountTopPager(scope, source)`，**两条展示路径共用**：

| 路径 | `source` | 结果 |
|---|---|---|
| 本方自己的页 | 脚本自造的 `.gsm-local-pager` | 顶部克隆件随 `updateLocalPagers()` 更新页码 |
| 他人页只读网格 | GitHub **原生** `.paginate-container` | 克隆件保留原生 `after`/`before` 游标 href |

零风险点：`cloneNode(true)` **不复制事件监听**（既有认知，见 D22 的浮层取舍），所以原生那份的交互不受影响；
克隆前摘掉 `id`（原生分页器可能带 id，克隆会造出重复 id）；
**底部那份原样不动**（V5/D6：原生控件不改造）。

**真机实测**（`/mattn?tab=stars`）：克隆件在标题行右侧（x=1305，行右边界 1456 → 贴右），
文本 `PreviousNext`、Next 指向真实游标 URL；**点击顶部 Next → 页面 2 的 30 个条目渲染出来**，
克隆件随帧重渲染重新挂上并带上了「Previous」，**无重复节点**，原生底部那份 `display:block` 未被标记。
回滚：`.gsm-top-pager` 由 `viewTeardown` 第 2 项删、`.gsm-header-row` 由第 4 项摘，`exitOtherStarsView` 另收一次。

### 顺带查明：同一个 `?tab=stars` 有两代页面骨架

用户问「为什么 mattn 和 Kuddev 的 stars 页布局不一致：一个标题是 Starred repositories，另一个是 Stars」。
实测答案是 **GitHub 自己在灰度两套页面**，与脚本无关：

| | 旧代（`mattn`） | 新代（`Kuddev`，仍为 `?tab=stars`） |
|---|---|---|
| 主列 | `.col-lg-9` **+** `.col-lg-3` | 只有 `.col-lg-12`（**没有 topics 列**） |
| 标题 | 「Starred repositories」 | 「**Stars**」 |
| 搜索框 placeholder | 「Search starred repositories」 | 「Search stars」 |
| 条目容器内的列表 | `div.col-12` 条目 | 同左（条目本身未变） |

**注意**：页面上「有没有原生分页器」**不能**当判据（Kuddev 只有 3 个 star ⇒ 单页 ⇒ 本来就没有分页器）。

脚本对两代的处置是**同一套退路**，不猜新骨架：
`getStarsMainColumn()` 取 `.col-lg-9`，取不到就退到 `#user-starred-repos` / `main`；
topics 搬运与 `#user-starred-repos .col-lg-3` 的隐藏在新代自然跳过（那里没有这一列）；
布局表里针对 `#user-starred-repos` / `.Layout` 的规则在新代不生效 ⇒ 新代呈现为
「GitHub 自己的全宽单列 + 我们的卡片网格」。两者都能出网格（实测新代 3 列 ×341px）。
`/stars/{login}` 是第三种骨架（`main > ul.repo-list`，无 `#user-starred-repos`），已在前面覆盖。

### 追加 2：克隆件的竖向对齐（用户要求「把分页器和其他筛选项对齐」）

**问题**：新代骨架把 GitHub 自己的筛选栏放进了标题行，包装节点带 `tmp-mt-3 mb-n1`
（计算值 = margin-top 16px / margin-bottom −4px，**上下不等**）。`.gsm-header-row` 是
`align-items: center`，flex 对齐的是**外边距盒** ⇒ 包装节点整体下移 (16 − (−4)) / 2 = **10px**，
而克隆件没有这些外边距，于是比同行的筛选控件高出 10px。真机实测：

| | 裸克隆（未对齐） | 修正后 |
|---|---|---|
| 克隆件 y | 156 | 207 |
| 筛选控件 y | 166 | 207 |
| delta | **−10** | **0** |

**做法**：`mountTopPager` 里找标题行内除 h2 之外的第一个兄弟元素，把它的
`getComputedStyle(...).marginTop/Bottom` 原样写到克隆件的**内联样式**上 ⇒ 两者外边距盒等高同中心。

- **只写我们自己的节点**，不碰 GitHub 的节点 ⇒ 回滚不需要 data 标记（节点一删，内联样式随之消失）。
- 旧代页面标题行里只有 h2（无筛选栏）⇒ 找不到兄弟节点、不写任何外边距，行为与 4.13.0 首版一致
  （真机 mattn 页实测克隆件内联外边距为空字符串）。
- 夹具侧可复现：新增场景 `other-newgen`（在标题行内插入带 16px/−4px 外边距的筛选栏），
  断言 R15；**咬合实测**：注释掉对齐代码 ⇒ `R15_deltaY` 由 0 变 **−10** 且内联外边距为空。

**同时记录一个「已知并接受」的副作用**：`.gsm-header-row` 的 flex 把新代页面的
「标题一行 / 筛选栏一行」并成了同一行（行高 74→64、标题 1056→166、筛选栏另起一行→挤到 707px）。
这正是「分页器与筛选项同一行且对齐」所要的形态，属方案 A「接管呈现层」的延伸，不是缺陷。

### 追加 3：卡片星按钮与备注观感（用户三轮裁定）

**① 卡片要有 star 按钮，但状态只认本人缓存。** 首版按「页面内零写入口（V6）」不建按钮，用户要求加上。
关键约束来自真机实测：他人页**原生**星按钮显示的是**页面主人**的状态 ——

| 页面 | 原生按钮状态 | 本人缓存里有没有这些仓库 |
|---|---|---|
| `mattn?tab=stars`（30 条） | 30 条全 `Starred` + `/unstar` 表单 | **0 条**（`GET /user/starred/…` 全 404） |

⇒ 照抄原生 DOM 会把「对方收藏了」当成「我收藏了」（点一下发出的是 unstar）。故状态一律取
**本人整表缓存的成员关系**；缓存不可用（从未同步）时**不建按钮**（宁缺勿假）。
夹具 `scenario=other-starstate` 咬合实测：把状态改成恒 `starred`（模拟照抄 DOM）⇒ 未收藏的 beta/two
显示为已加星、点击发出 `POST /beta/two/unstar`。

**② 已 star 的实心星常驻可见。** 旧 CSS 只给 `.unstarred` 写了 `opacity:1`，`.starred` 仅靠
`.stars-grid-card:hover` 现身 ⇒ 他人页上「有的卡右上角有星、有的什么都没有」，而看不见的恰恰是已加星的那些。
咬合实测：回退该声明 ⇒ 断言读到 `opacity: 0`。**该规则对自己的页同样生效**（30 个实心星常驻）。

**③ 本页写入过的状态要记住。** 在他人页给一个自己没 star 过的仓库加星，`markRepoStarred()` 是 no-op
（待删除区没有该条目 —— 不污染整表缓存是刻意的），于是任何一次重渲染都会退回未加星外观。
`viewContext` 因此加一张**内存覆盖表**（`setViewStarOverride` / `getViewStarOverride`），
`resetViewContext()` 时清空。

**④ 只读备注与自己卡片的备注同款。** 曾自加「备注：」`::before` 前缀与左侧 `border-left` 竖线，
用户两轮裁定都判为多余 ⇒ 改为直接复用自己卡片的 `.stars-card-notes-text`，
`readonly.css` 里不再有 `.gsm-ro-notes` 的任何声明（同一个类，两者不可能漂移）。
夹具断言 R5 锁住四项：`borderLeftWidth=0`、`paddingLeft=0`、`marginTop=0`、`::before content=none`；
咬合实测：把旧样式加回来 ⇒ 分别读到 2px / 8px / 6px / `"BITE-PREFIX"`。

### 追加 4：常驻可见的实心星**只作用于只读网格**（用户裁定）

追加 3 的第 ② 条最初把 `.stars-star-btn.starred{opacity:1}` 写成了**全局**规则，于是本方自己的页
也从「悬停才现身」变成 30 个实心星常驻。用户随即裁定**限定到只读网格上**，处置：

- 只读网格容器多挂一个标记类：`gsm-other-stars`（`otherStarsView.ts` 的 `RO_GRID_CLASS`，
  随网格节点一起建/删，回滚不需要额外条目）。
- 规则改为后代选择器 `.stars-grid-container.gsm-other-stars .stars-star-btn.starred { opacity: 1 }`，
  放在 `base.css` 里紧挨通用 `.stars-star-btn` 块（**不放 `readonly.css`**：那份样式表只在
  存在标签/备注时才注入，而按钮可见性与数据无关）。

真机实测（两侧对照）：

| | 网格类 | 已 star 按钮 `opacity` |
|---|---|---|
| `Norman-bury?tab=stars`（他人只读网格） | `stars-grid-container gsm-other-stars` | **1** |
| `YsLtr?tab=stars`（本方自己的页） | `stars-grid-container` | **0**（悬停才现身，原观感） |

夹具断言两向都锁住：R16（`R16_gridMarker=true` + `R16_alphaOpacity=1`）、
R7（`R7_gridMarker=false` + `R7_starredOpacity=0`）。
咬合实测：删掉该作用域规则 ⇒ 只读网格的 `alphaOpacity` 由 1 变 **0**。

### 追加 5：未登录访客的兼容 + topics 归宿（两个 `.Layout` 的真机事故）

**① 未登录也接管。** 原先 `enterOtherStarsView()` 首行 `if (!getViewerId() || !ownerLogin) return false`
—— 以「没有登录者 ⇒ 标签/备注无从归属」为由整体放弃。用户要求「继续兼容未登录的 stars 页」后改为：
网格照建，只是**三个缺省**：无徽章（命名空间为空）、无星按钮（`hasApiData() && getViewerId()` 两者缺一不可）、
不触发任何同步。真机实测（`body.logged-out`）：

| | `mattn?tab=stars` | `Norman-bury?tab=stars` | `/stars/Norman-bury` |
|---|---|---|---|
| 卡片 | 30 | 30 | 10 |
| 星按钮 / 徽章 / 编辑控件 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| 读请求 / 存储写入 | 0 / 0 | 0 / 0 | 0 / 0 |
| 原生条目（隐藏 / 可见） | 30 / 0 | 30 / 0 | — |

**登出页的条目**没有 `user-list-menu[data-repository-id]`（30 条 `h3 a` 齐全而它 0 个）⇒ `repoId`
退回仓库全名；`li` 路线的仓库特征改用 `a[href$="/stargazers"]`（不能用「`h3 a` 的 href 像 `owner/repo`」——
`/topics/{name}` 也是那个形状）。

**② 「Starred topics 跑到 header 上」** —— 用户报的真机事故。根因：**登出的 profile 页有两个
`.Layout.Layout--sidebarPosition-start`**：

| # | 位置 | 实测 | 含 stars 内容 | 用途 |
|---|---|---|---|---|
| 0 | y96 / 高 192 | 左栏头像 + 右栏标签栏 | **否** | 页头 |
| 1 | y289 / 高 2320 | `#user-starred-repos` 在它里面 | **是** | 内容 |

`moveTopicsToRightSidebar()` 用 `document.querySelector` 取「文档里第一个」⇒ 右栏落进**页头**布局
（实测 `hasSidebar:true / hasGrid:false`），观感正是「topics 出现在 header 区」。
修法：`colLg3.closest('.Layout.Layout--sidebarPosition-start')`（从被搬的那一列自己往上找），
找不到就不搬。修后实测：右栏 `layoutIndex=1`、x1480（第三栏）、与内容同顶；页头布局仍 2 个子节点。

**③ 顺带加固：隐藏原生列改绑「搬运成功」标记。** base.css 原为
`turbo-frame#user-starred-repos .col-lg-3{display:none!important}`（无条件）⇒ 一旦搬不动，topics
既没搬走又被藏起来 = **凭空消失**。现改为 `.col-lg-3[data-gsm-topics-src]`（搬运成功才打的出处标记），
语义变成「搬走了才藏」。

**夹具复现**：新增场景 `other-twolayout`（在内容布局前插入页头诱饵布局）+ 断言 R18；
**咬合实测**：把 `closest` 换回 `document.querySelector` ⇒ `R18_sidebarInHeaderLayout` 由 false 变
**true**、`headerLayoutChildren` 由 2 变 3。

### 追加 6：布局接管改为「认标记」，不再认骨架类（4.13.0，用户报「已登录，开始改」）

**问题（用户裁定 + 夹具/真机双向复现）**：布局样式表（`base.css` / `wide.css` / `persistent.css`）原本按
**骨架类** `.Layout.Layout--sidebarPosition-start`、`.Layout-sidebar`、`.Layout-main` 选元素。
登录态下 profile 页只有一个 `.Layout--sidebarPosition-start`（头像侧栏与 stars 内容同属它，真机实测
`layoutCount=1`），所以一直看不出问题；**登出的页面有两个**（#0 页头：头像 + 标签栏；#1 内容：
`#user-starred-repos` 在它里面）⇒ 页头被**一起改写**。

**咬合实测（夹具 `other-twolayout` + 临时把标记逻辑改回「取文档里第一个」）**：

| 指标 | 期望（修复后） | 咬合（回到旧行为） |
|---|---|---|
| `<html>` 布局是否被标记 | `false` | **`true`** |
| 页头布局 `grid-template-columns` | `none`（无人动它） | **`180px 1fr 220px`** |
| 页头头像宽度 | `460`（夹具原值） | **`120px`**（被我们的头像规则压扁） |
| 内容布局是否被标记 | `true` | `false` |
| 内容布局 `grid-template-columns` | `180px 1fr 220px` | `none` |

**做法**：新增标记类 `gsm-stars-layout`（`constants.STARS_LAYOUT_CLASS`）+ `dom.ts` 的
`findStarsLayout()` / `markStarsLayout()` / `unmarkStarsLayout()`：

- 归属判定：从**我们一定会插进去的那个位置**往上找 —— `.stars-grid-container` → `#user-starred-repos`
  → 主列 → 任一原生条目，然后 `.closest('.Layout')`。**不用** `document.querySelector('...--sidebarPosition-start')`
  （登出页的第一个是页头，真机事故：topics 被塞进页头右栏）。
- 找不到布局 ⇒ **不标记**，布局规则整体不生效（Github 原生布局原样保留）——失败方向是「少做」。
- 生命周期：`ensureLayoutStyles()` 注入 ⇒ 标记；`removeLayoutStyles()` 撤表 ⇒ 摘标记。**调用必须留在
  `!isDesktop()` 早退之后** —— 首版误插到函数外（模块顶层执行）导致窄视口也留 class，被新断言
  `R10_markedLayouts` 抓个正着（`0` 期望 vs `1` 实测）。
- CSS 侧：所有布局/侧栏规则改前缀（`.Layout.gsm-stars-layout`、`.gsm-stars-layout .Layout-sidebar`、
  `.gsm-stars-layout .Layout-main`），**相对特异性顺序刻意保持不变**（措辞经 4.13.0 审查修正：并非每个选择器的特异性数值都不变 ——
  后代规则各多了一个类，`.Layout-sidebar` 0,1,0→0,2,0、`.Layout-main` 0,1,0→0,2,0、
  `html.gsm-anim-prepare …` 0,2,1→0,3,1；但那是**单向棘轮**，只会更赢不会更输，**互相之间**的顺序处处不变）。
  刻意**没有**引入 `.Layout--sidebarPosition-start.gsm-stars-layout` 那种 0,3,0 的写法 —— 那会让
  `wide.css` 的三栏规则与 `html.gsm-anim-prepare` 的过渡起点规则**特异性相等**，后者只能靠源序决胜，
  展开动画就有从 180px 直接跳的风险（实测现行写法下 `gsm-anim-prepare` 稳定压过 wide 三栏）。

**验证**：夹具 11 个场景全绿（新增/扩展断言 `R18_contentMarked` / `R18_headerMarked` / `R18_headerCols` /
`R18_headerAvatarWidth` / `R14_markedLayouts` / `R7_markedLayouts` / `R10_markedLayouts` /
`R11_after_markedLayouts` / `R11_after_markedHoldsGrid`），窄视口标记数回 `0`、往返后标记落在承载网格的布局上；
真机（登录态，量测前 `finish()` 冻结过渡）自己的页与 `mattn?tab=stars` 均 `marked=1`、
`cols=180px 1088px 220px`、侧栏 180、页主头像 120、赞助头像 35、30 卡 3 列 352px。

#### 审查轮追加：一个只有「非显然观测量」才能抓到的回归（P1）

独立审查（只读复核 + 自建 A/B）发现：把 `persistent.css` 的 transition 规则**也**改成认标记之后，
**退出时的回弹过渡永远不会播**。机制：`exitStarsView → removeLayoutStyles()` 在**同一个同步任务**里
先撤尺寸规则（180 → 原生）、再摘标记 ⇒ after-change style 里已无 transition 声明 ⇒ 过渡不启动。

我自己的断言当时**全绿**，因为夹具里没有任何关于 transition 的观测量 —— 这正是「按行为断言，而不是按
标记/属性断言」的教训。为此新增两个**确定性、与视口无关**的观测量（隐藏标签页下也稳定）：

| 断言 | 观测量 | 修复后 | 钳合实测（transition 认标记） |
|---|---|---|---|
| **R19** | 退出后「痕迹清零」**且**「声明了 transition 且实际匹配侧栏/头像的规则数 ≥ 1」 | marked=0 / grid=0 / layoutStyles=0，**sidebarTr=1 / avatarTr=1** | marked=0 / grid=0 / layoutStyles=0，**sidebarTr=0 / avatarTr=0** |
| **R20** | 人为摘掉标记后派发 `turbo:frame-render` 重进 ⇒ 标记自愈 | `markerRemoved=0 → markerHealed=1`，网格仍在 | `markerHealed=0` |

**修法**：transition 规则**恢复为 4.13.0 之前的逐字原样**（不认标记），尺寸规则继续认标记。于是
`persistent.css` 与 HEAD 的差异只剩「赞助头像选择器」那一条（属另一处修复）。真机实测两代
`?tab=stars` 骨架承载 stars 内容的 `.Layout` 都带 `Layout--sidebarPosition-start`，故原选择器仍然命中。

**同时简化的三处**（审查建议）：`findStarsLayout()` 四跳锚点链 → **两跳**（后两跳不可达）、
收回模块内不 export、`markStarsLayout()` 返回 `void`；`moveTopicsToRightSidebar()` 改为**复用**
`findStarsLayout()`，不再重复写一遍骨架选择器（语义也更直白：**标记的那个布局，就是右栏该去的地方**）。

**残留（未修，已登记为风险 18）**：`/stars/{login}` 路由上没有 `.Layout` 元素（真机
`querySelectorAll('.Layout').length === 0`）⇒ 该路由从不进入三栏接管，这是**既有行为**；
`.container-xl{max-width:1600px}` 作用于布局的祖先，无法用后代标记限定。

---

## 追加 7：只读**不再是整页一刀切** —— 逐仓库三态（4.14.0）

### 起因：一个真实缺陷

用户报：「他人 star 页面的卡片会因为点了 star 就变成可编辑状态。」

根因不在只读本身，而在**「只读」被判成了页级单一布尔**，且分派写了两处、判据不一致：

- `filters.renderBrowsePage`：`readOnly ? renderTagsReadOnly : renderTags`（这一处是对的）；
- `starCheck.syncCardAfterStarChange`：**无条件**调 `renderTags` / `renderNotes`（可编辑渲染器，
  直接绑 `saveTags` / `saveNote`），全函数**没有任何只读判断**。

于是「在他人页点一下 star」→ 写成功 → `syncCardAfterStarChange` → 标签/备注被换成带 `+` / `×` /
`textarea` 的可编辑控件。两处判据不一致**就是**这个缺陷。

### 决策：可编辑性与可见性解耦，都按**逐仓库**事实判定

| 状态 | 判据 | 数据来源 | 编辑控件 |
|---|---|---|---|
| `editable` | 本人 star 了它（内存覆盖表 → 本人整表缓存） | 活区 `stars_tags_*` / `stars_notes_*` | 有 |
| `locked-pending` | 不在缓存，但 `stars_pending_delete` 里有它且 **未超 24h** | **宽限期备份**的 `_tags` / `_note` | 无（**数据仍显示**，用户裁定） |
| `locked-empty` | 两者都不是 | 活区（多半为空；导入的标签可能在此） | 无 |

- 判定层 = 新模块 `src/cardState.ts`（纯判定：不碰 DOM、不发请求、不写存储）；
  渲染分派 = 新模块 `src/cardAreas.ts` 的 `renderCardTagAndNoteAreas(card, 'own' | 'other', viewerCache)`，
  **唯一入口**（`filters` 与 `starCheck` 都只走它）。
- **可编辑性只认「已提交」状态**：不读星按钮的 DOM class、不读在途请求。乐观翻转与「排队中撤销」
  都不改变可编辑性 —— 否则写失败回滚后会留下「星星已回退、标签却已改过」的不一致。
- **前置条件**与既有 `canShowStar` 同源且是它的子集：`hasApiData() && getViewerId()`。
  任一不满足 ⇒ 一律不可编辑（未登录访客、从无整表缓存）。**宁缺勿假**。
- **他人页点标签不再切换筛选**：`renderTags` 新增上下文开关 `filterToggle`（默认 `true` =
  本方自己的页逐字不变；他人页传 `false`）。由此顺带**必须**给 `applyFilters()` 补一道
  `isReadOnlyView()` 早退门 —— `filterState` 是跨页共享模块态（进他人页不清、离开也不清），
  而 `starCheck` 会在「有激活筛选」时调它 ⇒「在自己页筛过标签 → 切到别人的 stars 页 → 点 star」
  会往**页面主人**的原生筛选行插脚本控件、把原生菜单设成 `display:none`。此前唯一的防护是
  「他人页入口刻意直调 `renderBrowsePage` 绕过 `applyFilters`」，属实现约定而非不变量。

### 口径收窄：「零存储写入」→「**渲染路径**零写入」

4.13.0 的硬约束是「全程零网络、零存储写入」。4.14.0 按用户需求收窄为：

- **零网络：不变**（连间接的 linguist 色表请求也仍然被 `setLangColorFetchEnabled(false)` 关掉）；
- **零存储写入：收窄为「页面加载与渲染路径零写入」** —— 只有**用户显式动作**（点星、增删标签、
  写备注）才写，且只写**登录者**自己的命名空间（`stars_tags_<登录者 id>` / `stars_notes_<登录者 id>`）。
  仍然不写 `stars_repo_cache`（除既有的 `markRepoUnstarred/Starred` 语义外）、不写
  `stars_full_sync_meta`、**不新增任何他人页专属缓存键**；页面投影仍只存内存。

### `markRepoUnstarred` 的判据从「缓存里有它」改为「**有东西要保全**」

旧实现 `if (!cache[repoId]) return;` 在他人页会漏：那页允许「点 star（只在 `viewContext` 的
内存覆盖里，**不进缓存**）→ 加标签 → 点 unstar」，此时缓存里没有该仓库 ⇒ 直接 return ⇒
① 数据不备份（宽限期里看不到标签）、② 活区**不被清空** ⇒ 标签永久留在存储里，而只读卡片
又没有删除入口，用户再也清不掉它。现在只要满足任一条就建备份：缓存有该条目 / 调用方给了
`seed`（他人页卡片上的投影数据）/ 该仓库当下有非空标签或备注。三者皆无 = 无物可保 ⇒ 什么都不做。

**连带的行为变化**：在他人页 unstar 一个从未进入整表缓存的仓库会产生一条 `pending` 条目；
若随后 re-star，该仓库会**进入本人整表缓存**（`markRepoStarred` 的既有行为）。这是**正确**的：
此刻「我」确实 star 了它。

### 观感与可访问性（两条**有证据的「不做」**）

- 只读卡片**不渲染任何编辑控件**，也**不加** ARIA 只读语义：`aria-readonly` 只对 9 个 widget role
  有效（把「标签 + 备注」这一簇编辑入口包进 `role="textbox"` 是错误语义）；`inert` 无默认视觉提示；
  `aria-disabled` 的禁用态会踩到低对比 / 不可聚焦 / 像坏了等全部负面项。
  详见 `.pi/tmp/research-other-stars-editable-cards.md`（含 W3C / MDN / USWDS / Smashing 的原文引用）。
- **不加可见说明行、不加徽章**（沿用用户既往裁定）。唯一的提示是只读节点上的原生 `title`，
  按状态分叉：宽限期内 =「已取消 star：标签与备注保留 24 小时，期间不可编辑」，其余为默认文案。
- 状态切换时**加一条焦点回收**（重绘前记 `card.contains(document.activeElement)`，重绘后把焦点
  交还该卡片的星按钮）：最常见的路径（点星按钮）不会丢焦点，这条兜的是「后台同步判定外部取关时
  用户正聚焦在本卡片的标签输入框 / 备注 textarea 上」——浏览器实测移除焦点元素会一律回退 `<body>`。
- 一条**状态驱动**的样式：不可编辑卡片的备注区 `cursor: default`（`base.css`，4.14.0）。
  `.stars-card-notes` 原有的 `cursor: text` 对本方自己的页是对的，但对点了没反应的只读卡片
  是明摆的谎。规则认 `[data-gsm-card-state='locked-*']`，该属性在 4.14.0 时**只存在于他人页**（自有页走
  `view: 'own'` 分支、不写），故当时自有页观感一字不变。**4.16.2 修订**：本人页也会写该属性
  （取消 star 后的 `locked-pending` 卡片必须命中本规则）—— 见追加 8。放 `base.css` 而非 `readonly.css`：
  后者是**按需**注入的，而「卡片上什么都没有」的 `locked-empty` 恰恰也需要这条。

### 工装（`.diag/otherstars-harness.html` + `assert-otherstars.js`）

新增三个场景与 `R21` 断言组，并把既有断言按新口径重述：

| 场景 | 覆盖 |
|---|---|
| `other-editstate` | 同一页上 `editable` 与 `locked-pending` 并存；宽限期卡片**显示备份数据**且 0 控件；点标签不产生筛选副作用；加标签只写 `stars_tags_999` |
| `other-pending-expired` | 备份超 24h ⇒ 判据**现算**、不再显示（`locked-empty`，无徽章） |
| `other-nocache-edit` | 无整表缓存 ⇒ 全部 `locked-empty`（活区数据仍只读显示）、无星按钮、零写入 |

口径重述（**不是**放松）：`R2_controlsInLockedCards` 必须恒为 0、`R2_inputs`/`R2_textareas` 恒为 0
（没有「默认打开」的编辑器）、`R2_fetch`/`R2_writes` 恒为 0；`R5_ownerDataLeaked` 恒为 false
（页面主人命名空间的数据一个字符都不许出现在网格里）。4.13.0 那句「他人页编辑控件必须为 0」
只在「页面条目与本人缓存**无交集**」时成立 —— 那正是 `other-nocache` 场景。

`R16`（`other-starstate`）补上了这个缺陷的**正面断言**：点 star ⇒ 该卡片 `locked-empty → editable`
（另一张不受影响）；再点 unstar ⇒ `editable → locked-pending`、控件归零、`pending` 里出现该仓库、
存储写入恰为 `stars_pending_delete` + `stars_tags_999` + `stars_notes_999`（**只落登录者命名空间**），
全程 `fetch` 增量为 0。

### 一条工装教训（本机窗口宽度）

`agent-browser-cli` 没有视口控制，而夹具伪造的是 `matchMedia`（JS 侧判宽屏真）、**真实 CSS 媒体查询
看的是 `window.innerWidth`**。本机窗口一度只有 604px ⇒ 两张布局表（都在 `@media (min-width:768px)` 里）
一条都不生效，`R12_gridDisplay` 读出 `block`、`R13_ownerAvatarW` 读出 260，与实现对错无关。
处置：把与视口有关的断言要么**先确认 `innerWidth ≥ 768`**（夹具现会记录 `R21_viewportWide`），
要么改用**与视口无关**的观测量 —— 例如「哪些规则声明了 `cursor` 且实际匹配该元素」
（`R21_betaNotesCursorRules`），这与 R19 的 transition 计数是同一手法。

另一个坑：`tabs` 列表把 URL 截断到约 65 字符，而所有 `file://` 夹具的 URL 前缀完全相同 ⇒
无法按 URL 区分场景。已在夹具里把场景名写进 `document.title`（`GSM harness: <scenario><hash>`），
外部按 title 找 tab。**注意**：生成脚本整段在模板字符串里，注释中**不许出现反引号**（会截断外层串）。

### 追加 7 的发布前独立审查轮（外部 reviewer，只读复核 + 自建复现实验）

结论：**1 P1 + 4 P2**。P1 与两条 P2 已修，另两条登记为已知项（下方逐条）。

#### P1（已修）：只读卡片的备注区**仍可点开编辑器并写盘**

- **成因**：备注的编辑入口是挂在**容器本身**上的 click 监听（`ui/notes.ts`），而容器在重绘之间是
  **复用**的（`innerHTML = ''` 只换内容）。`renderNotesReadOnly()` 只清 `innerHTML`，
  **摘不掉容器上的监听** ⇒ 从 `editable` 切到 `locked-*` 之后，点一下被宣称为「只读」的卡片照样弹出
  `textarea`，blur 后**真的写盘**，随后重绘又只按只读渲染 ⇒ 用户输入被静默吞掉（re-star 时还会被
  宽限期备份覆盖）。对照：`ui/tagFilter.renderTags` 的监听都在**子节点**上，`innerHTML = ''` 一并销毁
  ⇒ 只有备注这一路有该问题。
- **修法**：`ui/notes.ts` 用 `WeakMap<HTMLElement, handler>` 记住那枚监听，导出
  `disposeNotesEditor(container)`；`renderNotes` 每次渲染前先摘旧监听（顺带修掉「反复重绘在同一容器上
  **叠加**监听」这个一直存在的行为），`cardAreas.renderCardTagAndNoteAreas()` 在**唯一分派点**上，
  不论哪个分支都先摘 —— 不把这条正确性只寄托在 `renderNotes` 的内部实现上。
- **为什么既有断言全绿**：`R16_betaLockedControlsAfterUnstar` / `R21_betaLockedControlCount` 都是
  **静态快照**（「此刻 DOM 里没有控件」），而缺陷只在**点了之后**才显现。这是「按静态形状断言」的教训，
  与 4.13.0 那次 transition 回归同源（见上文「审查轮追加」）。
- **新增动态断言 `R25`**（`other-editstate` / `other-pending-expired` / `other-nocache-edit` 三场景）：

  | 观测量 | 修复后 | 说明 |
  |---|---|---|
  | `R25_lockedEditorAfterClick` | `0` | 点只读卡片的备注区，**不得**出现 `.stars-card-notes-edit` |
  | `R25_lockedControlsAfterClick` | `0` | 同卡片控件总数仍为 0 |
  | `R25_lockedNoteStillShown` | `缓冲期备注` | 只读文本原样还在 |
  | `R25_lockedWritesDelta` | `0` | 该次点击零写入 |
  | `R25_editableEditorAfterClick` | `1` | **对照组**：同样手法点可编辑卡片，必须真的进编辑态 |
  | `R25_editableEditorAfterEscape` / `R25_notesWritesTotal` | `0` / `0` | Escape 取消不留写入 |
  | `R25_fetchTotal` | `0` | 全程零网络 |

  另补 `R27`（`own` 场景）：自己的页上「点击 → 输入 → blur 提交」仍然落盘
  （`R27_editorOpened=1`、`R27_editorClosedAfterBlur=0`、`R27_noteTextAfterCommit='R27 写入验证'`、
  `R27_writes=['stars_notes_999']`）—— 证明修复只摘监听，没有顺手关掉编辑能力。

#### P2-1（已修）：登出页显示了 `stars_pending_delete` 里的数据

`stars_pending_delete` 是**单份全局键**，不按账号分片（与 D27 的 `stars_tags_<id>` 命名空间键不同），
它属于**上一个登录的人**。未登录访客照常查它 ⇒ D26 明文要求的「登出页无徽章」被破坏。
修法：`cardState.hasViewerIdentity()`（= `!!getViewerId()`）作为**唯一身份判据**，
没有它时 `getCardState` 判 `locked-empty`、`readCardDisplayData` 也不看备份。

**A/B 实证**（新增夹具场景 `other-logout-pending`：body 登出 + 身份清空 + 备份里带着私密串，
且该仓库**不在**本人缓存里 —— 否则会先命中 `editable` 而掩盖问题）：

| 观测量 | 修复后 | 钳合（`hasViewerIdentity()` 恒为 true = 修复前） |
|---|---|---|
| `R26_leaksPendingTags` / `R26_leaksPendingNote` | `false` / `false` | **`true` / `true`** |
| `R26_roBadges` / `R26_roTagPills` | `0` / `0` | **`2` / `1`** |
| `R26_grid` / `R26_cards` | `1` / `2` | `1` / `2`（登出页仍接管，只读网格照出） |
| `R26_starButtons` / `R26_fetch` / `R26_writes` | `0` / `0` / `0` | `2`（钳合副作用：身份被强行伪造）/ `0` / `0` |

#### P2-2（已修）：`isStarredByViewer` 有两份实现

`filters.ts` 里内联了一份 `override ?? viewerCache[repoId]`，`cardState.ts` 里又有一份 ——
「两处各判一次、判据漂移」**正是本次要修的缺陷模式**。现在 `filters` 直接 import `cardState` 的版本；
顺带把 `canShowStar` 也改为由 `loadViewerCacheForView()` 的结果派生（`viewerCache !== null`），
`hasApiData() && getViewerId()` 那串判据在 `filters.ts` 里**不再出现第二遍**。

#### P2-3（登记，未改）：逐卡存储读取次数偏多

实测约 5 次 `GM_getValue` / 卡（`getTags` + `getNote` + `loadPendingDelete`，各自还会读一次
localStorage 镜像），30 条约 150+ 次同步 IPC。**本轮不改**：真正省下来要靠给三个存储模块加
「读缓存 + 写失效」，那会改动**全脚本**共用的存储层新鲜度语义，风险与收益不匹配（本版本的主题是
他人页的正确性）。登记为观察项，将来若真机感到卡顿再单独立项。

#### P2-4（登记，未改）：他人页上 D12 的「同步后立即重渲染」不生效

`rerenderAfterSync` 走 `applyFilters()`，而后者现在被他自己的 `isReadOnlyView()` 早退门挡住 ⇒
他人页同步完成后网格不重绘。这是**净收益**（他人页的筛选栏/分页器本就不该被脚本驱动），
但 D12 的措辞是全局的，故在此显式登记：**D12 只适用于本方自己的 stars 页**。
他人页刷新数据的路径是「重新投影原生条目」（`domRepos` + `queryRepos`），不由同步驱动。

---

## 追加 8：本人 stars 页 unstar 后的只读显示（4.16.2）

### 问题

用户在本人 stars 页点卡片星按钮取消 star 后，卡片的**标签与备注立即消失**（标签整行没了、备注只剩
「添加备注…」占位），而同一账号在**他人** stars 页看到同一份数据时却正常只读显示。

### 根因：同一概念的第二处判据漂移（`own` / `other`）

`cardAreas.renderCardTagAndNoteAreas` 是标签/备注区的唯一渲染分派点，但它对两个视图的处置不对称：
`'other'` 走 `cardState` 的三态判定（只读时读 **24h 宽限期备份**），`'own'` 则**无条件**调可编辑渲染器，
而可编辑渲染器只读**活区**。而 `markRepoUnstarred()` 恰恰在 unstar 时把数据搬进备份并**清空活区**
（`saveTags(repoId, [])` / `saveNote(repoId, '')`）。于是数据还在，只是没人去备份里取。

这与 4.14.0 修掉的「`filters` 有判据、`starCheck` 没有判据」是**同一种缺陷模式**，漂移轴从
`filters`/`starCheck` 换成了 `own`/`other`。修复方式沿用同一纪律：判据只在 `cardState.ts` 一处。

### 设计

- **own 视图二态**（`cardState.getOwnPageCardState`）：命中 24h 宽限期备份 ⇒ `locked-pending`
  （只读、仍显示备份里的数据）；其余一律 `editable`（与 4.13.0 起的既有行为逐字相同）。
- **刻意不引入 `locked-empty`**（即不复用 `getCardState(repoId, loadViewerCacheForView())`）：
  ① 那一支要拿整表缓存判成员关系，链路依赖**无官方契约**的页面 meta `octolytics-actor-id`：
  meta 一旦改名或消失，本人页**全部卡片**会失去编辑能力（加不了标签、写不了备注）—— 比本缺陷严重得多；
  ② 本人页的卡片只来自本人整表缓存（`queryRepos` 的 own 路径），而 unstar 时该仓库已被移出缓存
  ⇒ 「没 star 却有标签」的卡片**从不进入网格**，给它造只读态是空转（用户 2026-10-05 亦确认
  「那应该不显示才对」）。
- **取数拆成两步**：`readCardDisplayData(repoId, state, now)` 不再自算 `state`，只负责取数
  （活区优先；活区为空**且** state 为 `locked-*` 时读备份）。宽限期是**单份全局键**，
  `hasViewerIdentity()` 这道门保留在取数函数内 —— 未登录访客不得看到「上一个登录者」的数据（追加 7 的 P2-1）。
  **行为不变式**：`editable` 时活区为空就返回空，不许去读备份（否则一条陈旧 pending 条目会让本页
  凭空显示不属于它的数据）。
- **只读形态零新增**：复用 `readonly.ts` 的两个渲染器（4.14.0 已改为接受调用方传入的数据）与既有文案
  `CARDS_TITLE_PENDING`；不加可见提示、不加控件、不加恢复按钮（恢复入口就是那张卡片上已变成未加星外观
  的星按钮）。`disposeNotesEditor()` 照旧在唯一分派点上先摘 —— 容器在重绘间复用，`innerHTML = ''` 摘不掉
  备注编辑监听（追加 7 的 P1）。
- **`data-gsm-card-state` 现在本人页也有**：4.14.0 起该属性两态都写（`editable` 也写，夹具按它读数），
  4.16.2 起本人页也写 ⇒ `base.css` 的 `cursor: default` 规则在本人页自动生效。原注释里
  「它只存在于他人页 / 自有页不写该属性」的措辞已同步改正（`cardAreas.ts`、`base.css`、本 ADR 追加 7）。
- **本次修复中自查发现并修掉的一处回归**：重写时把 `dataset[STATE_ATTR] = state` 挪进了只读分支
  ⇒ 他人页可编辑卡片不再写该属性，`R2_editableCards` 变 0、`R16_betaAreaAfterStar` 从 `'editable'` 退化
  （探针实测：容器在重绘间复用 ⇒ 读到的是**陈旧值** `'locked-empty'`，而不是 `null`；两种取值都会让基线变红）。
  已改回「两态都写」，两个基线断言恢复（`R2_editableCards=2` / `R16_betaAreaAfterStar='editable'`）。

### 验证

夹具新增场景 `own-unstar`（本人页；缓存含 123/456；456 的活区已清空、数据在 1 小时前的宽限期备份里），
断言组 **R29**。跑法见 `.diag/assert-otherstars.js` 头部注释。

**A/B 反证**（把 `cardAreas` 的 own 分支临时改回「无条件可编辑渲染」后重跑）：

| 观测量 | 修复后 | 反证（回退） |
|---|---|---|
| `R29_betaState` | `'locked-pending'` | `null` |
| `R29_betaTagTexts` | `['缓冲标签']` | **`[]`**（标签整行消失 = 用户报的缺陷） |
| `R29_betaNoteText` | `'缓冲备注'` | `null` |
| `R29_betaEditorAfterClick` | `0` | **`1`**（点一下弹编辑器，且有写盘能力） |
| `R29_betaControls` / `...AfterClick` | `0` / `0` | `1` / `2` |
| `R29_betaNotesCursor` | `'default'` | `'text'` |
| `R29_alphaState` / `R29_alphaControls` | `'editable'` / `3` | 同（同页对照：修复没有把本人页改成一律只读） |
| `R29_apiReqs` / `R29_writesDeltaAfterClick` | `0` / `0` | `0` / `0` |

`R29_fetchUrls` 恒为 `["GET https://raw.githubusercontent.com/github/linguist/...languages.yml"]`
—— 本人页允许这一次语言色表请求（既有行为；他人页才用 `setLangColorFetchEnabled(false)` 压掉它），
**API 请求始终为 0**。

**回归基线**：`.diag` 的 **18 个场景**全部重跑，`__errors` 全空；他人页 `fetch`/`writes` 仍为 0；
窄视口（`#narrow`）`grid`/`gsm` 节点/标记全 0（`R10_*`）；`R7_*`（本人页既有网格路径）、
`R27_*`（备注写路径）、`R28_*`（读路径纯读）不变。

### 已知局限（刻意接受，用户 2026-10-05 确认）

1. **只读态是临时显示态**：`markRepoUnstarred` 已把该仓库移出整表缓存 ⇒ 下一次整页重绘
   （有激活筛选时的同步、翻页、导入后重绘）它就不再出现在网格里。**不**把宽限期条目注入查询结果
   （那会让「已 unstar 的仓库继续出现在我的 stars 列表里」，与 unstar 语义冲突，且要给查询管线
   新增第三条半来源）。数据本身在宽限期内仍可通过 TM 菜单「恢复取消的 star」找回。
2. **夹具 `own-unstar` 的保真度边界**：它**直接种存储**模拟「已 unstar」的终态，覆盖的是
   `renderBrowsePage` 的渲染分派；**不驱动**真实链条「点星 → 发写请求 → `markRepoUnstarred` 删缓存 →
   `starCheck` 的 own 分派」（那需要 fetch 写桩，参考 `other-starstate`）。真实链条的**关键分岔已在代码层
   逐条核对**（见本 ADR 第 1 条引用链），但结论是**读出来的**、不是**跑出来的** ⇒ 真机确认（T5）不可省。
3. **多账号浏览器下本人页可能读到上一个账号的宽限期备份**（发布前审查登记、**本次不修**）：
   `stars_pending_delete` 是**单份全局键**、条目里不记归属，而 `cardState` 的身份门只判「**有没有**登录者」
   （`hasViewerIdentity()`），不判「这条备份是不是他的」。⇒ 同一浏览器换账号后，若两张账号都 star 了同一仓库，
   本人页可能把**自己已 star 的卡片**判成 `locked-pending` 并显示上一个账号的标签/备注。
   **本次修复把作用面从他人页扩到本人页**（他人页 4.14.0 起就有同一问题）。不并入本批次的理由：
   要真修得给 pending 条目加归属字段并决定「缺字段怎么办」，属**存储格式 + 迁移语义**的独立改动。
   ⚠️ 与之同类的**登出**场景**不**受影响（无身份 ⇒ `hasViewerIdentity()` 为假 ⇒ 一个字符都不读），
   那条已在追加 7 的 P2-1 用夹具 `other-logout-pending` 钳合实证过。
4. **导入路径下点一次星按钮可能抹掉已有的宽限期备份**（发布前审查发现、**本次不修**）：
   `markRepoUnstarred()` 无条件用**当前活区**覆盖 `_tags` / `_note`。而「该仓库既在整表缓存里、
   又已有一条非空 pending 条目」这种并存状态**只经 `import` 可达**（正常 unstar 会同时删掉缓存条目）。
   此时活区是空的 ⇒ 点一次星按钮就把那 24h 内**本可恢复**的标签/备注写成空。
   不并入本批次的理由：`markRepoUnstarred` 本次一行未动，且「何时该保留旧备份」是**宽限期语义**的选择
   （空活区也可能是用户真的删光了标签 —— 那时覆盖才对），需要它自己的判据与验收。
5. **跨 24h 边界可能出现一帧「只读 + 空」**（登记的观察项，不修）：判定与取数是**两次独立的**
   `getPendingInGrace()` 调用，若正好卡在宽限期到期的毫秒之间，卡片会以 `locked-pending` 的外观渲染一次
   空内容，下一次重绘即恢复。代价是毫秒级窗口里的**一帧**，而消除它要给取数函数再开一个「传入已取到的备份」
   的口子（多一层耦合），收益不抵成本。
6. **导入的标签落在「本人没 star」的仓库上时**，现行行为是留在活区、不渲染、无 UI 入口。
   「导入即搬进宽限期」的字面读法**未采纳**：宽限期到期会**永久删除**条目（`cleanupExpiredUnstarred`），
   那会让导入进来的数据在 24h 后被静默删掉；且 ADR 0001/0005 把导入定义为「数据搬运、落盘即完成」，
   不该顺带触发删除倒计时。若要改，属独立改动（需同步改 ADR 0001/0005 的口径）。
