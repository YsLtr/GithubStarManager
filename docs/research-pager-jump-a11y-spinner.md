# 联网调研报告：分页跳页输入控件 与 同步按钮「只转图标」加载态

> 调研日期：**2026-10-02**（本机系统时间 `Fri Oct 2 2026`，所有 URL 均在该日实测抓取）
> 调研对象：GithubStarManager（TypeScript + Tampermonkey 用户脚本，注入 github.com `?tab=stars`）
> 交付问题：(1) GitHub 自己怎么做分页跳页；(2) 页码输入控件的可访问性规范；(3) 「只让 octicon 旋转、按钮文字与几何不变」的既有权威实现与规范。
> 方法：`web_search` 多角度检索 + 对官方文档/Primer 源码**精读原文** + 对 **github.com 线上 DOM 直接抓取**做一手实测；关键结论至少两个独立来源一致。
>
> 口径说明：本报告的「实测」= 我在 2026-10-02 用 `curl`（带浏览器 UA，走本机代理）拉取线上页面得到的原始 HTML，属一手证据但**不是官方契约**；「官方」= W3C/WAI/WHATWG/MDN/GitHub Docs/Primer 官方文档。

---

## 0. 结论速览（TL;DR）

| # | 问题 | 结论 | 关键证据 |
|---|---|---|---|
| 1 | GitHub 自身有没有「输入页码跳页」的 UI？ | **没有。** github.com 线上的分页块里 0 个 `<input>`；Primer 的分页组件（React 版与 CSS 版）API 里也没有任何跳页入参 | 实测 `github.com/primer/react/labels?page=2` 原始 HTML；Primer React `Pagination` props 表；Primer CSS `pagination.scss` |
| 2 | github.com 的分页长什么样（可对齐的既有模式）？ | 新 UI = `<nav aria-label="Pagination">` + 页码链接（`aria-label="Page N"`、当前页 `aria-current="page"`）+ `Previous`/`Next`（`aria-label="Previous/Next Page"`、`rel="prev/next"`、octicon chevron 内联在文字旁）。**旧 UI = 纯文本 `a/span/em`，含 `.gap` 省略号** | 同上（实测 HTML 片段见 §1.1、§1.2） |
| 3 | 官方 `?page=N` 语义？ | 1-based；REST：`page` + `per_page`（默认 30，上限 100），越界不报错、**静默截断到上限**；网页端：`?page=1` 是第一个（实测 `page=0`/`page=abc` 回落到第 1 页，`page=999` 返回 200 空结果，**不 404**） | GitHub REST 官方文档；本机 curl 实测 |
| 4 | 页码输入框该用 `type=number` 还是 `inputmode=numeric`？ | **优先 `inputmode="numeric"` + `pattern`，不要（或谨慎使用）`type="number"`**：`type=number` 隐式角色是 `spinbutton`，会引入方向键意外改值、非数字输入无任何反馈两个问题 | MDN `<input type="number">` Accessibility 段；APG Spinbutton Pattern |
| 5 | 打开/关闭与焦点管理有没有规范可抄？ | 有：**HTML Popover API（`popover="auto"`）免费提供 Esc 关闭 + 点击外部关闭（light dismiss）+ 焦点进入/返回 invoker + 隐式 `aria-expanded`/`aria-details`**；若不能用它，就按 APG Dialog 的键盘条款手写（Esc 关闭、关闭后焦点回到触发元素） | MDN Popover API / popover 属性；APG Dialog (Modal) Pattern |
| 6 | 「只转图标」有没有 GitHub 官方实现可抄？ | **有，而且就是 GitHub 自己的按钮加载态**：`primer/react` 的 `ButtonBase` 在 loading 时**保留文字、只把 leading/trailing visual 换成 `<Spinner>`**，加 `aria-disabled`、移除 `onClick`、用隐藏 live region 播报 | `ButtonBase.tsx` 源码（逐条见 §3.1） |
| 7 | 旋转该怎么写 CSS？ | 抄 Primer 的 `.anim-rotate`：`animation: rotate-keyframes 1s linear infinite` + `@keyframes rotate-keyframes { 100% { transform: rotate(360deg) } }`，作用在 **`<svg>` 元素本身**（外层 svg 有 CSS 布局盒，`transform-box` 按 border-box，默认 `transform-origin: 50% 50%` 就是中心）；**不要**用 SVG SMIL `<animateTransform>` | Primer CSS `animations.scss` + 官方动画工具文档；Primer PR #1251（含 Chrome SMIL 冻结 bug 说明）；MDN `transform-box` |
| 8 | 持续旋转要不要照顾 `prefers-reduced-motion`？ | **要**（Primer 自己的动效指南明确要求包 `@media (prefers-reduced-motion: no-preference)`）；但注意 **Primer 自己的 `.anim-rotate` 并没有加这层媒体查询** —— 规范与实现存在分歧，需自己处理，并保留文字/播报作为非动画替代 | Primer 动效指南；WCAG C39；WCAG 2.2.2 Understanding（Note 4 把加载动画列为可豁免的 essential） |

---

## 1. 问题一：GitHub 自己怎么做分页跳页

### 1.1 一手实测：github.com 线上分页块的完整结构

抓取目标：`https://github.com/primer/react/labels?page=2`（该页**仍是服务端渲染**，能直接拿到分页 HTML；Stars 页与新 Issues 页的分页是客户端渲染的，SSR HTML 里抓不到）。

实测得到的原始结构（节选，去掉路径 `d` 与 CSS-module 哈希）：

```html
<nav class="prc-Pagination-PaginationContainer-HEhGo" aria-label="Pagination" data-component="Pagination">
  <div class="prc-Pagination-TablePaginationSteps-cAXs3" data-hidden-viewport-ranges="">
    <a class="prc-Pagination-Page-Etgqf" data-component="Pagination.PreviousPage"
       rel="prev" href="/primer/react/labels?page=1" aria-label="Previous Page">
      <svg data-component="Pagination.PreviousPageIcon" aria-hidden="true" focusable="false"
           class="octicon octicon-chevron-left" viewBox="0 0 16 16" width="16" height="16"
           fill="currentColor" display="inline-block" overflow="visible">…</svg>Previous</a>
    <a class="prc-Pagination-Page-Etgqf" data-component="Pagination.Page"
       href="/primer/react/labels?page=1" aria-label="Page 1">1</a>
    <a class="prc-Pagination-Page-Etgqf" data-component="Pagination.Page"
       href="/primer/react/labels?page=2" aria-label="Page 2" aria-current="page">2</a>
    …（Page 3 … Page 6）
    <a class="prc-Pagination-Page-Etgqf" data-component="Pagination.NextPage"
       rel="next" href="/primer/react/labels?page=3" aria-label="Next Page">Next
      <svg … class="octicon octicon-chevron-right" …></svg></a>
  </div>
</nav>
```

**同一页全文 `<input>` 计数 = 0**（实测 `re.findall(r'<input[^>]*>', html)` 返回空列表）。

> 一手结论：**GitHub 自身没有「输入页码跳页」UI**。它的跳页手段是「点页码链接」或「直接改 URL 的 `?page=`」。

### 1.2 组件层面佐证：Primer 的两套分页 API 都没有跳页入参

**(a) Primer React `Pagination`（dotcom 当前正在用的那套，CSS module 类名与 §1.1 实测完全对应）**

官方 props 表（`https://primer.style/product/components/pagination/`，2026-10-02 读取）：

| Prop | 默认 | 类型 | 说明 |
|---|---|---|---|
| `currentPage` | 必填 | `number` | 当前页 |
| `pageCount` | 必填 | `number` | 总页数 |
| `hrefBuilder` | — | `(page:number)=>string` | 由页码生成链接 |
| `marginPageCount` | `1` | `number` | 左右两端恒定展示的页数 |
| `onPageChange` | — | `(e,n)=>void` | 点页码时回调 |
| `showPages` | `true` | `boolean \| {narrow?,regular?,wide?}` | 是否展示单个页码 |
| `surroundingPageCount` | `2` | `number` | 当前页两侧展示几个 |
| `renderPage` | — | `(props)=>ReactNode` | 自定义单个页码 |

→ **无跳页输入**。源码 `https://github.com/primer/react/blob/main/packages/react/src/Pagination/Pagination.tsx`（2026-10-02 读取原文）里，组件根就是一坨纯链接：

```tsx
return (
  <nav className={clsx(classes.PaginationContainer, className)}
       aria-label="Pagination" data-component="Pagination" {...rest}>
    <div className={classes.TablePaginationSteps} data-hidden-viewport-ranges={…}>
      {pageElements}
    </div>
  </nav>
)
```

（`Pagination.tsx` 全文只有这一处 `aria-label`，没有 `input`、没有 `labels` prop —— 与某些文档站的 `labels` prop 描述不同，以源码为准。）

**(b) Primer CSS 旧版 `.pagination`（github.com 老页面仍在用）**

源码 `https://raw.githubusercontent.com/primer/css/main/src/pagination/pagination.scss`（2026-10-02 读取）显示：`.pagination` 的子元素只有 `a` / `span` / `em`，语义类名是
`.previous_page` / `.next_page` / `.current` / `.gap`（省略号）/ `.disabled`，`[aria-current]` 与 `[aria-disabled='true']` 有对应样式。
它还内建了**响应式降级**：`0→sm` 只显示 `[Previous][Next]`；`sm→md` 追加首/末页 + 当前页码 + `.gap`；`md+` 全显。

→ 即便在「页码太多要折叠」的场景，GitHub 的选择也是**一个 `.gap` 文本省略号**，而不是输入框。

**(c) 社区对照（说明这是「别的项目会做、GitHub 不做」）**

第三方项目提出并实现了同类需求：nautobot/nautobot issue **#9037 "Add a 'Go to page' to the paginator"**（创建 2026-06-01，2026-07-13 由 PR #9206 关闭）。其验收标准原文：「There is an input box near the `per_page` dropdown that accepts an integer and sends that as the `page` query param」。
<https://github.com/nautobot/nautobot/issues/9037>

→ 这说明「分页器 + 跳页输入框」是被广泛接受的 UI 模式，**只是 GitHub 不用它**。所以本改动属于「在 GitHub 页面上引入 GitHub 没有的控件」，没有原生样式可直接继承，需要自造并自己承担 a11y 责任。

### 1.3 `?page=N` 的官方语义

**REST API（官方文档，2026-10-02 读取，文档内示例使用 `X-GitHub-Api-Version: 2026-03-10`，属当前口径）**
<https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api>

- 分页由 `link` 响应头驱动：`rel="prev" / "next" / "first" / "last"`，形如
  `<https://api.github.com/repositories/1300192/issues?page=2>; rel="prev", …?page=1>; rel="first"`。
- 页码参数就是 `page`；`per_page` 控制每页条数，**"For most endpoints, the maximum value of `per_page` is `100`. If you specify a value greater than the maximum, GitHub does not return an error. Instead, the value is automatically reduced to the maximum"**。
- 链路示例里 `page=1` 代表第一页 ⇒ **1-based**（与 `rel="prev"`/`rel="next"` 的组合可自证：`page=2` 的 prev 是 `page=1`）。

**Web UI（本机 curl 实测，2026-10-02，非官方契约）**

| 请求 | HTTP | 结果 |
|---|---|---|
| `…/issues?q=…&page=1` | 200 | 正常列表 |
| `…&page=2` | 200 | 内容与第 1 页不同（体现翻页生效） |
| `…&page=0` | 200 | 内容与第 1 页一致（回落到第 1 页） |
| `…&page=abc` | 200 | 内容与第 1 页一致（回落到第 1 页） |
| `…&page=999` | 200 | 200 + 空结果集，**不返回 404** |

> 对本脚本的含义（供上级决策，不是本报告的主张）：既然 `?page=` 越界只给空结果而不报错，**「跳页」的越界校验必须由本地代码自己做**（夹取到 `[1, totalPages]`），不能指望服务端兜底。

### 1.4 本节结论

1. **GitHub 自身没有分页跳页输入框** —— 线上 DOM 零 `<input>`、Primer 两套分页 API 零相关入参、旧版 CSS 的折叠方案是 `.gap` 文本。
2. 可对齐的「既有模式」只有三样：`<nav aria-label="Pagination">` 容器、页码链接 `aria-label="Page N"` + 当前页 `aria-current="page"`、`Previous`/`Next` 用 `rel` 与可见的 octicon chevron。
3. 因此本脚本的「点击 `1 / 12` → 输入页码」在 GitHub 里**没有先例可抄样式**，但有**可对齐的语义标注规范**（§2.5）。

---

## 2. 问题二：页码输入控件的可访问性规范

### 2.1 输入类型：`type="number"` vs `inputmode="numeric"`

| 来源 | 原文要点 | URL |
|---|---|---|
| MDN `<input type="number">`（2026-10-02 读取） | **Accessibility 段**：「The implicit role for the `<input type="number">` element is `spinbutton`. **If spinbutton is not an important feature for your form control, consider _not_ using `type="number"`. Instead, use `inputmode="numeric"` along with a `pattern` attribute**」；同段警告：「there is a risk of users **accidentally incrementing** a number when they're trying to do something else. Additionally, if users try to enter something that's not a number, **there's no explicit feedback about what they're doing wrong**」；正文另给推荐写法 `<input type="text" inputmode="numeric" pattern="\d*" />` | <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/number> |
| MDN `inputmode`（页面最后修改 **2026-04-17**） | `numeric` = 「Numeric input keyboard, but only requires the digits 0–9」；`text` 是默认值 | <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/inputmode> |
| APG Spinbutton Pattern（2026-10-02 读取） | 若用 spinbutton 语义，**必须**补 `role` 与 `aria-valuenow/valuemin/valuemax`，可见标签用 `aria-labelledby`、否则用 `aria-label`；**「The spinbutton element has `aria-invalid` set to `true` if the value is outside the allowed range. Note that most implementations prevent input of invalid values」**；键盘约定 Up/Down 加减、Home/End 到边界 | <https://www.w3.org/WAI/ARIA/apg/patterns/spinbutton/> |

**对本脚本的判定**：页码输入框**不需要**「方向键上下微调」这个交互模型 —— 用户是「一次跳到某页」，不是「逐页 +1」。因此：
- **首选**：`type="text"` + `inputmode="numeric"` + `pattern="[0-9]*"`（移动端出纯数字键盘，且不引入 spinbutton 语义、不引入方向键误改值）。
- **若用 `type="number"`**：则必须同时给 `min="1"` / `max="{totalPages}"`，并自行处理「非数字没有反馈」这一缺口（见 §2.4），否则按 MDN 的口径就是把已知缺陷引进来了。

### 2.2 命名（accessible name）

- W3C WAI《Forms Tutorial → Labeling Controls》（2026-10-02 读取，官方教程）：
  - 优先用 `<label for>` 显式关联；
  - **`aria-label`**：「can also be used to identify form controls. This approach is well supported by screen readers and other assistive technology, but, unlike the `title` attribute, the information is **not conveyed to visual users**. The approach should therefore only be used when the label of the control is **clear from the surrounding content**」；
  - 需要「视觉隐藏但 AT 可见」时用 `.visuallyhidden`（1px 裁切），并强调**不要**与 `visibility: hidden` 混淆。
  <https://www.w3.org/WAI/tutorials/forms/labels/>
- 对本脚本：分页器上的输入框**周围确实有上下文**（它替换的正是 `1 / 12` 这个位置、旁边就是 Previous/Next），所以 `aria-label` 是合规选择；但更稳的是「一个视觉隐藏的 `<label>`」或直接给出可见提示文字，因为脚本 UI 没有全局说明语境。

**建议的可访问名取值**（组合「当前/总数/动作」三要素，避免只播报一个裸数字）：
- 输入框：`aria-label="跳转到页码，共 12 页"`
- 触发按钮（把 `1 / 12` 的容器变成按钮）：可访问名应包含当前页与总数，例如 `aria-label="第 1 页，共 12 页，点击跳转到指定页"`。

> 对照 GitHub 自己怎么命名分页内的链接：`aria-label="Page 1"`（页码链接）、`aria-label="Previous Page"` / `"Next Page"`（前后翻页）—— **它给每个可点元素都写了明确的名字，而不是只靠数字文本**（§1.1 实测 HTML）。这可以当成命名风格的既有基线。

### 2.3 开合、焦点管理与键盘

**(a) 首推：HTML Popover API（`popover="auto"`）—— 免费拿到全部要求**

MDN《Popover API → Using》原文（2026-10-02 读取）：

> **auto state, and "light dismiss"**: 「The popover can be "light dismissed" — this means that you can hide the popover by **clicking outside it**. The popover can also be closed, using browser-specific mechanisms such as **pressing the Esc key**. Usually, only one `auto` popover can be shown at a time」

> **Popover accessibility features**: 「When the popover is shown, the keyboard focus navigation order is updated so that the popover is next in the sequence … Conversely, **when closing the popover via the keyboard (usually via the Esc key), focus is shifted back to the invoker**. … an implicit **`aria-details`** and **`aria-expanded`** relationship is set up between them」

<https://developer.mozilla.org/en-US/docs/Web/API/Popover_API/Using>、<https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/popover>

「打开时聚焦到输入框」在 popover 内可用 `autofocus` 属性（MDN：`autofocus` 是布尔属性，**元素嵌套在 dialog 或 popover 中时也在其显示时聚焦**）：
<https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/autofocus>

**浏览器支持（重要约束）**：Popover API 属 **Baseline 2024 —— Chrome/Edge 114、Firefox 125、Safari 17**。
<https://web.dev/blog/popover-api>、<https://caniuse.com/popover-api>
⚠️ 本仓库 `vite.config.ts` 的构建目标是 **`cssTarget=safari15`**（见 `AGENTS.md` D19 相关口径）⇒ **Safari 15/16 不支持 `popover`**。若采用该 API，必须像脚本里既有做法那样做能力检测 + 手写回退（MDN 给的检测方式：`Object.hasOwn(HTMLElement.prototype, 'popover')`）。

**(b) 回退/手写路径：按 APG Dialog (Modal) Pattern 的键盘条款**

APG Dialog 键盘交互（2026-10-02 读取）原文要点：
- 「When a dialog opens, **focus moves to an element inside** the dialog」（一般放第一个可聚焦元素）；
- 「**Escape**: Closes the dialog」；
- Note 2：「When a dialog closes, **focus returns to the element that invoked** the dialog unless …the invoking element no longer exists」。
<https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/>

> 对本脚本：这个「跳页输入」是**非模态**的轻量浮层（不是模态对话框，不需要焦点陷阱）。但「打开聚焦输入框 / Esc 关闭 / 关闭后焦点回到触发按钮 / 点外部关闭」这四条，Popover 与 APG Dialog 给的是同一套答案，可直接作为验收清单。

**(c) Enter 提交**

用真实 `<form>` 包住输入框时，按 Enter 会触发**隐式提交**（implicit submission）—— WHATWG HTML 标准第 4.10.22.2 节：「If the user agent supports letting the user submit a form implicitly (for example … hitting the 'enter' key while a text control is focused implicitly submits the form), then doing so … must cause the user agent to fire a click event at that default button」。
<https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#implicit-submission>
→ 即：**不要手写 Enter 监听**，用 `<form>` + `<button type="submit">` 就得到标准行为（并在提交时 `preventDefault()` 阻止真实导航）。

**(d) 移动端回车键文案**

`enterkeyhint="go"`：MDN 定义「Typically meaning to **take the user to the target of the text they typed**」——语义正好契合「跳页」。
<https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/enterkeyhint>

### 2.4 失败输入（越界 / 非数字）怎么处理

证据链：
1. APG Spinbutton：越界时给 `aria-invalid="true"`，同时指出主流实现是**直接阻止非法输入**（`https://www.w3.org/WAI/ARIA/apg/patterns/spinbutton/`）。
2. MDN `type=number`：「if users try to enter something that's not a number, **there's no explicit feedback about what they're doing wrong**」——即原生不做提示（`https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/number`）。
3. §1.3 实测：服务端对越界 `?page=` **不报错、静默返回空结果**，所以「让服务端兜底」这条路在本项目不成立。

**推荐做法（按本仓库场景收敛）**：
- **非法字符**：在 `input` 事件里直接滤掉非数字（等价于 APG 所说的「prevent input of invalid values」），配套 `pattern="[0-9]*"` + `inputmode="numeric"`。
- **越界数字**：不要静默失焦了事。两种都可接受，二选一并保持一致：
  a. **夹取（clamp）**到 `[1, totalPages]` 后立即跳页（对用户最省事，且与脚本现有 `renderBrowsePage` 的「无效页直接 return」逻辑兼容）；
  b. **拒绝 + 报错**：设 `aria-invalid="true"` 并就地给出可见错误文本（`1–12`），焦点留在输入框。
- **空输入 / 与当前页相同**：无需报错，直接关闭浮层（脚本现有拦截逻辑本来就 `page === cur` 时 return）。

### 2.5 与 GitHub 既有语义的对齐点（可直接抄）

| 场景 | GitHub/Primer 的既有做法 | 出处 |
|---|---|---|
| 分页是一个区域 | `<nav aria-label="Pagination">` | §1.1 实测 HTML；`Pagination.tsx` |
| 当前页标识 | 当前页元素 `aria-current="page"`（且**只标一个**） | §1.1 实测；MDN「When a link within a set of pagination links is styled to indicate the user is currently on that page, `aria-current="page"` should be set on that link」「Only mark one element in a set of elements as current」；**并注明**「If the element representing the current page … was **not a link**, the `aria-current` is optional」 → 我们这个是**按钮**，所以 `aria-current` 可省，不要硬加 <https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-current> |
| 前后翻页 | `rel="prev"` / `rel="next"` + 可见文字 + 装饰性 octicon（`aria-hidden="true"`、`focusable="false"`） | §1.1 实测 HTML（chevron SVG 同时带 `aria-hidden="true"` 与 `focusable="false"`） |

### 2.6 页码输入控件 —— 建议值对照表

| 属性/行为 | 建议值 | 依据 | 备选与代价 |
|---|---|---|---|
| 元素 | `<input type="text" inputmode="numeric" pattern="[0-9]*">` | MDN input number 的 Accessibility 段（明确建议避开 `type=number`）；MDN `inputmode` | `type="number"` + `min/max`：会带 spinbutton 语义与方向键误改值风险，且非数字无反馈 |
| 可访问名 | `aria-label="跳转到页码，共 N 页"` 或视觉隐藏 `<label>` | W3C Labeling Controls（`aria-label` 与 `.visuallyhidden` 两种合法路径） | 只靠 `placeholder`：placeholder 不是标签，且输入后消失 |
| 移动键盘 | `enterkeyhint="go"` | MDN enterkeyhint | 不设：UA 自行推断 |
| 打开 | `popover="auto"` + `autofocus`（或手写：打开即 `focus()`） | MDN Popover API；MDN autofocus；APG Dialog「focus moves to an element inside」 | Popover 在 Safari 15/16 不可用（本仓库 `cssTarget=safari15`）→ 需能力检测 + 回退 |
| Esc 关闭 | 依赖 Popover 原生行为；回退路径手写 `keydown` → `Escape` | MDN Popover；APG Dialog「Escape: Closes the dialog」 | —— |
| 点外部关闭 | `popover="auto"` 的 light dismiss；回退路径手写 `document` 捕获监听 | MDN Popover（light dismiss 定义） | 用 `popover="manual"` 会**失去** light dismiss 与 Esc，必须自己全写 |
| 关闭后焦点 | 回到触发按钮（Popover 原生 / 手写 `trigger.focus()`） | MDN Popover a11y 段；APG Dialog Note 2 | 不还焦点 = 键盘用户被丢回页面开头 |
| Enter 提交 | `<form>` + `<button type="submit">` | WHATWG HTML「implicit submission」 | 手写 keydown：需自己处理 IME composition，容易漏 |
| 非法字符 | 输入时过滤（`pattern` + `input` 过滤） | APG Spinbutton「prevent input of invalid values」 | 放任输入再报错：需额外的 `aria-invalid` + 错误文本 |
| 越界 | 夹取或明确报错，**不依赖服务端** | §1.3 实测（`?page=999` 返回 200 空结果）；APG「aria-invalid … if the value is outside the allowed range」 | 静默失焦：用户不知道发生了什么 |

---

## 3. 问题三：同步按钮「只让 octicon 旋转」的权威实现

### 3.1 GitHub 自己的实现就是「只换图标」——`primer/react` `ButtonBase`

源码（2026-10-02 从 GitHub raw 读取全文）：
<https://github.com/primer/react/blob/main/packages/react/src/Button/ButtonBase.tsx>

关键逐条（引号内为源码注释/代码原文）：

1. **文字永远保留**：`{children && (<span data-component="text" className={classes.Label} id={loading ? \`${uuid}-label\` : undefined}>{children}</span>)}` —— loading 时不隐藏文字。
2. **只把 leading/trailing visual 换成 spinner**：
   `renderModuleVisual` 内 `{loading ? <Spinner size="small" /> : isElement(Visual) ? Visual : <Visual />}`，注释：*「Replace the leading visual with a loading spinner」*；若没有 leading visual，才退化为「在文字旁插一个 spinner」（`renderModuleVisual(Spinner, loading, 'loadingSpinner', false)`）。
3. **不禁用、不摘除**：`aria-disabled={loading ? true : undefined}`，`onClick={loading ? undefined : onClick}`（loading 时移除点击处理）。
4. **保住焦点与可访问名**：
   - 外层 `ConditionalWrapper if={typeof loading !== 'undefined'}` 注释原文：*「If we just checked for `loading` as a boolean, the wrapper wouldn't be rendered when `loading` is `false`. Then, the component re-renders in a way that **the button will lose focus when switching between loading states**」* —— 即 DOM 结构在 true/false 之间必须**保持同形**。
   - `aria-labelledby`：注释原文 *「aria-labelledby is needed because **the accessible name becomes unset when the button is in a loading state**」*，loading 时把它指向 label span 的 id。
5. **隐藏 live region 播报**：
   ```tsx
   {loading && (
     <VisuallyHidden>
       <AriaStatus id={loadingAnnouncementID}>{loadingAnnouncement}</AriaStatus>
     </VisuallyHidden>
   )}
   ```
   默认 `loadingAnnouncement = 'Loading'`。

同族 props 文档（`https://primer.style/product/components/button/`，2026-10-02 读取）：
- `loading: boolean` —— "When true, the button is in a loading state."
- `loadingAnnouncement: string` —— "The content to announce to screen readers when loading. **This requires `loading` prop to be true**."

=> 这就是「按钮几何不变、文字不变、只有图标处转圈」的官方实现范式。本脚本要做的改动与之同构（差别仅在于：脚本的 Sync 按钮是**自造 DOM**，不是 Primer 组件）。

### 3.2 Primer 的按钮加载态 a11y 指南（可直接当验收清单）

`https://primer.style/product/components/button/accessibility/`（2026-10-02 读取）「Button loading state」原文：

> 「For loading buttons, **don't remove them from the DOM or add `disabled`** to avoid disrupting focus and keyboard navigation. Instead, add **`aria-disabled="true"`** to indicate the loading state. Include a **visually hidden, ARIA live region (using `aria-live="polite"`)** message like "Saving profile" to communicate status. **The live region must be present on page load, but the message inside the live region should only be rendered while the Button is in a loading state.** If there's an error, shift focus to a relevant heading, such as an `<h2>` in the error banner.」

⚠️ **对本脚本的落地注意**（与仓库既有回滚纪律冲突点）：Primer 要求「live region 在页面加载时就存在」；但本仓库 D18/D20 要求「窄视口 = 脚本没装过，不留任何自造节点」。两者需要取舍：建议改为「**首次进入桌面视图时**建一次（幂等），跨断点 teardown 时随视图一并移除」，并把该取舍记入决策 —— 不要为了满足 primer 的字面要求在 document-start 就挂节点。

### 3.3 旋转动画怎么写才不跑偏

**(a) 抄 Primer 的 `.anim-rotate`**

`https://raw.githubusercontent.com/primer/css/main/src/utilities/animations.scss`（2026-10-02 读取）文件末尾原文：

```scss
/* Rotate an element 360 degrees over and over, used for spinners */
.anim-rotate {
  animation: rotate-keyframes 1s linear infinite;
}
@keyframes rotate-keyframes {
  100% { transform: rotate(360deg); }
}
```

官方工具文档（`https://primer.style/product/css-utilities/animations/`）：「**Rotate** `.anim-rotate` Will rotate the element indefinitely around **the coordinate specified by `transform-origin`**. Most elements have a default of `transform-origin: 50% 50%` and will **rotate around the center**.」

**(b) 必须用 CSS 动画，不要用 SVG SMIL —— 有真实事故记录**

Primer PR #1251（**2021-03-23 创建并于同日合并**）标题 *"Add generic anim-rotate-360 class for use by view_components/spinner"*，正文原文：

> 「The current implementation of `SpinnerComponent` in `primer/view_components` uses an SVG with **SMIL animations** … This unfortunately triggers a **bug in Chrome** … where a page with SVGs with infinitely-repeating SMIL animations that is placed in the background will trigger a **linear task to emit, then run, events for each frame** that would have been run, as soon as the page is returned to the foreground. … For GitHub.com webpages, this can take **seconds, or even minutes**, where the Chrome tab is **frozen**, or even locking up the entire OS if memory is limited.」

其 diff 就是把 `<animateTransform attributeName="transform" type="rotate" from="0 8 8" to="360 8 8" dur="1s" repeatCount="indefinite" />` 换成 `class="anim-rotate-360" style="transform-origin: 8px 8px;"`（最终落地时类名保留为 `.anim-rotate`）。
<https://github.com/primer/css/pull/1251>

> 对本脚本的含义：**页面会被缩到后台标签/最小化**，而 `AGENTS.md` 已记录「后台标签页里 scroll 事件与 rAF 都被冻结」。因此这条 Chrome SMIL 冻结 bug 对本脚本是**现实风险**（同步可能持续数秒以上），务必用 CSS `animation`（本仓库现有 `.gsm-pager-loading::after` 伪元素转圈已经是 CSS 动画，改造时保持 CSS 动画即可）。

**(c) 该在哪一层加动画：`transform-origin` / `transform-box`**

- 外层 `<svg>`（octicon 根元素）**有 CSS 布局盒**：MDN `transform-box`（页面最后修改 **2026-04-20**）——`transform-box` 初始值是 `view-box`，但「**For elements with associated CSS layout box, acts as `border-box`**」。⇒ 直接旋转外层 `<svg>` 时，`transform-origin: 50% 50%` 就是它的中心，**无需**额外设置。
- 只有在旋转 **SVG 内部子元素**（`<path>` / `<g>`）时才需要 `transform-box: fill-box`。MDN 同页示例原文：「`transform-box: fill-box` is used to make the `transform-origin` the center of the bounding box, so the rectangle spins in place. **Without it, the transform origin is the center of the SVG canvas, and so you get a very different effect**」。
<https://developer.mozilla.org/en-US/docs/Web/CSS/transform-box>

> 实操建议：类名加在 `<svg>` 上；若为了「只转箭头那一段」而必须转 `<path>`，**务必**同时写 `transform-box: fill-box`，否则会出现「绕画布中心公转」的经典 bug。

### 3.4 持续旋转与 `prefers-reduced-motion`

**(a) Primer 自己的动效指南要求包媒体查询**

`https://primer.style/accessibility/design-guidance/motion-and-animation/`（2026-10-02 读取）「Support reduced motion」节原文：

> 「One way to give people control over CSS-based animations is to check whether the user has enabled the reduced motion setting … using the `prefers-reduced-motion` media query」
> ```css
> @media (prefers-reduced-motion: no-preference) { /* Animations and transitions go here */ }
> ```
> 「**For engineers**: Wrap CSS transitions and animations in `@media (prefers-reduced-motion: no-preference)` so they don't run for users who have asked for reduced motion. For JavaScript-driven motion, check `window.matchMedia('(prefers-reduced-motion: reduce)')` and adjust behaviour accordingly. **Make sure motion can be paused or stopped if it lasts longer than five seconds.**」
> 设计侧同页：「**Avoid using motion to convey essential information without an alternative.**」

**(b) ⚠️ 规范与实现的分歧（必须记录，别照抄一半）**

- Primer 官方动效指南要求包 `@media (prefers-reduced-motion: no-preference)`；
- 但 **Primer CSS 自己的 `animations.scss` 里 `.anim-rotate` 并没有任何 `prefers-reduced-motion` 包裹**（§3.3(a) 全文已核）。
  ⇒ 即「GitHub 的官方旋转工具类不照顾减动效偏好」。这是**冲突**，本报告以官方指南文字为准：新增的旋转应自行包 `@media`。
- Primer React `<Spinner>` 是否内部处理了 reduced motion：**未能查证**（只读了 props 文档与 `ButtonBase` 的调用点，未逐行审 `Spinner` 组件实现）。

**(c) WCAG 侧**

- WCAG 技术 **C39**（Using the CSS `prefers-reduced-motion` query to prevent motion）给出两种写法：`@media (prefers-reduced-motion: reduce) { …禁用… }` 或反向 `@media (prefers-reduced-motion: no-preference) { …动画… }`；测试程序为「打开系统减动效设置 → 检查该交互动效是否被抑制（除非它是 essential）」。
  <https://www.w3.org/WAI/WCAG22/Techniques/css/C39.html>
- WCAG **2.2.2 Pause, Stop, Hide** 的判定条件是「(1) starts automatically, (2) **lasts more than five seconds**, (3) is presented in parallel with other content」；且 **Note 4 原文**：「An animation that occurs as part of a **preload phase** or similar situation can be considered **essential** if interaction cannot occur during that phase for all users and if not indicating progress could confuse users or cause them to think that content was frozen or broken.」
  <https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html>
  ⇒ 同步中的转圈可按 Note 4 归入 essential（不强制提供暂停）；但 Primer 的「>5s 要可暂停/停止」与「减动效偏好」两条仍建议遵守，成本极低。

**(d) 加载态的语义播报（与动画互为替代）**

- `aria-busy`：MDN（页面最后修改 **2025-06-23**）——「used in **ALL** roles」，「The `aria-busy` attribute with a value of `true` can be added to an element currently being updated or modified, to inform the assistive technology that it should wait until the modifications or changes are complete before exposing the content to the user」。适合加在**被同步更新的列表区域**上（脚本同步完会重渲染网格）。
  <https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-busy>
- 按钮自身：按 §3.2 用隐藏 `aria-live="polite"` 区域播报「正在同步」（Primer 的 `loadingAnnouncement`），**不要**只靠转圈传达状态。
- Primer React `<Spinner>` 的 props（`https://primer.style/product/components/spinner/`，2026-10-02 读取）——`srText` 默认 `"Loading"`，文档明确「Set to `null` if the **loading state is displayed in a text node somewhere else on the page**」；另有 `delay`（`true`=1000ms、`'short'`=300ms、`'long'`=1000ms 或自定义毫秒）用于「避免闪一下就消失的 spinner」。⇒ **`delay` 这个概念值得借鉴**：同步如果 <300ms 完成，闪一下转圈反而是噪音（本仓库已有通知栈 3s 自动消失等同类节流思想）。

### 3.5 「只转图标」改造的验收清单（汇总自 §3.1–3.4）

| 验收项 | 期望 | 依据 |
|---|---|---|
| 按钮文字 | 保持可见、保持几何不变 | `ButtonBase.tsx`（文字 span 始终渲染） |
| 旋转对象 | **仅** `<svg class="octicon …">`（外层 svg） | Primer `.anim-rotate` 用法 + MDN `transform-box` |
| 动画实现 | CSS `animation`（`1s linear infinite`，`rotate(360deg)`），**禁用 SMIL** | Primer `animations.scss`；PR #1251 的 Chrome 冻结事故 |
| 若转的是 `<path>` | 必须 `transform-box: fill-box` | MDN transform-box 示例 |
| 减动效 | 包 `@media (prefers-reduced-motion: no-preference)`，或提供 `reduce` 下的静态替代 | Primer 动效指南；WCAG C39 |
| 交互 | loading 中 `aria-disabled="true"`；`onClick` 摘除；**不**用 `disabled`、**不**摘 DOM | Primer Button a11y 指南；`ButtonBase.tsx` |
| 播报 | 隐藏 `role=status`/`aria-live="polite"` 区域，文案仅 loading 期间渲染 | Primer Button a11y 指南；`ButtonBase.tsx` 的 `AriaStatus` |
| 焦点 | 切换 loading 前后 DOM 结构同形，避免按钮丢焦点 | `ButtonBase.tsx` 的 `ConditionalWrapper` 注释 |
| 结果区域 | 可给被替换的列表容器加 `aria-busy="true"` | MDN aria-busy |
| 时长 | 极短同步考虑延迟起转（借鉴 Spinner 的 `delay`） | Primer Spinner props |

---

## 4. 未能查证 / 存疑事项

1. **GitHub 是否在某个冷门页面存在跳页输入**：在 `web_search`（中/英/日多角度）与本机对 labels 页、issues 页、stars 页的抓取中均**未发现**；结论「GitHub 自身没有」在证据上是**反向证明**（零 `<input>` + 组件 API 无此入参），无法穷举全站。故措辞为「未能查证到，且现有证据均指向没有」。
2. **Primer React `<Spinner>` 内部是否处理 `prefers-reduced-motion`**：未逐行审实现，**未能查证**。
3. **`popover` 在 Safari 15/16 上的具体降级表现**：Popover API 自 Safari 17 起支持（caniuse/web.dev）；Safari 15/16 下 `popover` 属性与 `showPopover()` 均不存在，脚本必须自行能力检测，**未实测**该降级路径。
4. **`?scopes=repo` 预填**（与本报告无关，属仓库既有未决项）等：未涉及。
5. 本报告所有「实测」均来自 **2026-10-02** 的一次抓取；GitHub 前端迭代频繁，**DOM 类名（`prc-Pagination-*` 的哈希后缀）随时会变**，语义（`aria-label`/`aria-current`/`rel`）相对稳定，实现时应只依赖语义属性，不要依赖 CSS-module 哈希类名。

---

## 5. 参考来源（按主题分组，均于 2026-10-02 访问）

**GitHub / Primer 官方文档与源码**
1. Primer React `Pagination` 组件 props — <https://primer.style/product/components/pagination/>
2. Primer React `Pagination.tsx` 源码（`<nav aria-label="Pagination">`，无 input）— <https://github.com/primer/react/blob/main/packages/react/src/Pagination/Pagination.tsx>
3. Primer CSS `pagination.scss`（`.paginate-container` / `.pagination` / `.gap` / 响应式降级）— <https://github.com/primer/css/blob/main/src/pagination/pagination.scss>
4. Primer React `ButtonBase.tsx`（loading 态官方实现）— <https://github.com/primer/react/blob/main/packages/react/src/Button/ButtonBase.tsx>
5. Primer Button props（`loading` / `loadingAnnouncement`）— <https://primer.style/product/components/button/>
6. Primer **Button 可访问性指南**（Button loading state 四条要求）— <https://primer.style/product/components/button/accessibility/>
7. Primer Spinner props（`srText` / `delay` / `aria-label` 已废弃）— <https://primer.style/product/components/spinner/>
8. Primer CSS 动画工具文档（`.anim-rotate` 说明）— <https://primer.style/product/css-utilities/animations/>
9. Primer CSS `animations.scss` 源码（`.anim-rotate` + `@keyframes rotate-keyframes`）— <https://raw.githubusercontent.com/primer/css/main/src/utilities/animations.scss>
10. Primer CSS PR #1251（2021-03-23 合并；SMIL → CSS 动画，含 Chrome 后台标签冻结 bug 说明）— <https://github.com/primer/css/pull/1251>
11. Primer 动效与动画可访问性指南（`prefers-reduced-motion` / >5s 可暂停 / 非动画替代）— <https://primer.style/accessibility/design-guidance/motion-and-animation/>
12. GitHub REST 官方文档：Using pagination in the REST API（`page` / `per_page` 上限 100 / `link` 头）— <https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api>
13. 第三方同类需求（说明 GitHub 不做这件事）：nautobot/nautobot issue #9037 "Add a 'Go to page' to the paginator"（2026-06-01 开，2026-07-13 关）— <https://github.com/nautobot/nautobot/issues/9037>

**W3C / WAI（规范）**
14. WAI-ARIA APG：Spinbutton Pattern（`aria-invalid`、防非法输入、按键约定）— <https://www.w3.org/WAI/ARIA/apg/patterns/spinbutton/>
15. WAI-ARIA APG：Dialog (Modal) Pattern（打开聚焦、Esc 关闭、关闭后焦点回到 invoker）— <https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/>
16. W3C WAI Forms Tutorial：Labeling Controls（`<label for>` / `aria-label` / `visuallyhidden`）— <https://www.w3.org/WAI/tutorials/forms/labels/>
17. WCAG 2.2 技术 **C39**（`prefers-reduced-motion`）— <https://www.w3.org/WAI/WCAG22/Techniques/css/C39.html>
18. WCAG 2.2.2 Pause, Stop, Hide — Understanding（含 Note 4：preload/加载动画可视为 essential）— <https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html>
19. WHATWG HTML Standard §4.10.22.2 Implicit submission（Enter 提交 `<form>` 默认按钮）— <https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#implicit-submission>

**MDN**
20. `<input type="number">`（隐式角色 spinbutton；建议改用 `inputmode="numeric"` + `pattern`；两条风险）— <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/number>
21. `inputmode` 全局属性（页面最后修改 2026-04-17）— <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/inputmode>
22. `enterkeyhint` 全局属性（`go` 的语义）— <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/enterkeyhint>
23. Popover API 使用指南（light dismiss / Esc / 焦点顺序与返回 / 隐式 `aria-details`+`aria-expanded`）— <https://developer.mozilla.org/en-US/docs/Web/API/Popover_API/Using>
24. `popover` 全局属性（`auto` / `hint` / `manual` 三种状态差异）— <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/popover>
25. `autofocus` 全局属性（在 popover/dialog 显示时聚焦）— <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/autofocus>
26. `transform-box`（初始值 `view-box`；有 CSS 布局盒时按 border-box；子元素需 `fill-box`）— <https://developer.mozilla.org/en-US/docs/Web/CSS/transform-box>
27. `aria-busy`（页面最后修改 2025-06-23）— <https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-busy>
28. `aria-current`（分页链接用 `page`；非链接元素时可省）— <https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-current>

**浏览器支持**
29. web.dev：Popover API 属 Baseline 2024（Chrome 114 / Firefox 125 / Safari 17）— <https://web.dev/blog/popover-api>
30. caniuse：Popover API — <https://caniuse.com/popover-api>

**本机一手实测（2026-10-02，非官方契约）**
31. `https://github.com/primer/react/labels?page=2` 原始 HTML：分页 `<nav aria-label="Pagination" data-component="Pagination">` 全文结构；全页 `<input>` 计数 0
32. `https://github.com/primer/react/issues?q=is%3Aissue+is%3Aopen&page={1,2,0,abc,999}` 的 HTTP 状态与内容规模对比（越界 200 + 空结果；`page=0`/`abc` 回落第 1 页）
