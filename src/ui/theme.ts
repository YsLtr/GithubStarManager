// 内联样式 UI 的主题解析（4.19.3，issue #1）。
//
// 为什么不再写字面量 token：
// - TM 菜单的弹窗（「恢复已取消的 star」/「导入」）能在**任意** github.com 页面打开，
//   样式只能全内联 —— 用不上只有 Stars 视图才注入的样式表。
// - 它们此前写的是 `--color-canvas-default` 一代变量，并给每个 `var()` 配了浅色兜底。
//   GitHub 已把这代变量整体改名成 `--bgColor-*` / `--fgColor-*` / `--borderColor-*`：
//   真机实测（2026-10-20，暗色主题的 stars 页）这批旧名在 `:root` 上**全部为空**，
//   于是 `var()` 一律命中硬编码浅色兜底 ⇒ 暗色主题下弹窗是白底黑字 —— 即 issue #1。
//
// 口径（用户裁定）：**主题从页面上取，禁止自己写**。
// 因此这里不保存任何颜色常量，而是在弹窗打开时**现场解析**：
//   1. 先读页面上真实存在的 CSS 自定义属性（当前一代 token，`getComputedStyle` 拿到的
//      已经是该主题下的具体值，天然跟随 light / dark / dimmed，不需要分支）；
//   2. token 缺失时**采样 GitHub 原生节点**的 computed style（同类 UI：`.Box` / `.btn` /
//      `[role=dialog]` / `.Overlay-backdrop`）；
//   3. 两者都取不到 ⇒ 该项留空，调用方**不写**这条属性 —— 宁可少写一条，也不编一个颜色。
//      ⚠️ 别把这一步说成「继承页面」：`background` / `border` / `box-shadow` 都**不是**可继承
//      属性，跳过它们得到的是「透明 + `currentColor` 描边」的裸面板（详见 ADR 0012 的「失效方向」）。
//      唯一例外是 `color`：它可继承，留空才真的回到页面文字色。
//
// 采样级的三条硬约束（评审补，别删）：
//   - **不许采到脚本自己的节点**（`OWN_UI`）。脚本的弹窗/通知里也有 `<button>` / `<a href>` /
//     `class="Overlay"` 的元素，采到自己上一次写进去的值 = 第二层自引用：两个弹窗
//     同时在场时，后开的那个会继承先开那个的旧主题（= issue #1 现象复活）。
//   - **逐元素推进，不是逐选择器推进**：首个命中若透明/无边框，要继续看下一个元素，
//     而不是丢掉整个选择器台阶。
//   - **不做跨域兜底**：文本色不能拿面板底色兜、底色不能拿文本色兜（会造出
//     「白勾选框压白面板」这种硬错）。取不到就留空，交给浏览器默认值。
//
// 联动守卫：`scripts/verify-theme-tokens.cjs` 拒绝旧一代 `--color-*` 名与 `src/ui/` 里的
// 颜色字面量进入源码（改配色后必跑，已接入 `pnpm check`）。它只保证「没有字面量」，
// 保证不了「采到对的元素」—— 后者只能靠真机量测。

/** 通知语义（与 GitHub `.flash` 家族一一对应） */
export type NoticeTone = 'info' | 'success' | 'warn' | 'danger';

/** 内联 UI 用到的一整套颜色/投影。**可能是空串**：空串 = 页面上取不到，调用方跳过该属性 */
export interface UiTheme {
  /** 面板底色（GitHub 弹层语言：`--overlay-bgColor` 优先，回退画布底） */
  canvas: string;
  /** 正文前景 */
  fg: string;
  /** 次要前景（提示行、行内元信息） */
  fgMuted: string;
  /** 默认描边 */
  border: string;
  /** 强调前景（拖入高亮的边框） */
  accentFg: string;
  /** 强调浅底（拖入高亮的底色） */
  accentBg: string;
  /** 次要按钮：GitHub `.btn` 的常态值 */
  btnBg: string;
  btnFg: string;
  btnBorder: string;
  /** 次要按钮的 hover / active 底色 */
  btnBgHover: string;
  btnBgActive: string;
  /** 主按钮：GitHub `.btn-primary` 的常态值 */
  btnPrimaryBg: string;
  btnPrimaryFg: string;
  btnPrimaryBorder: string;
  /** 原生 checkbox 的选中色（`accent-color`）。**取不到就留空** = 浏览器默认（跟随 color-scheme） */
  checked: string;
  /** 遮罩层底色（`--overlay-backdrop-bgColor`，即 GitHub 自己弹窗后面的那层） */
  backdrop: string;
  /** 浮动面板投影（`--shadow-floating-large`） */
  floatingShadow: string;
  /** 卡片级投影（`--shadow-resting-small`） */
  restingShadow: string;
  /** 按钮常态投影（`--button-default-shadow-resting`） */
  btnShadow: string;
  /** 大圆角（`--borderRadius-large`，12px 档） */
  radiusLarge: string;
  /** 中圆角（`--borderRadius-medium`，6px 档） */
  radiusMedium: string;
  /** 四种通知语义的成套配色（底 / 描边 / 图标前景） */
  notice: Record<NoticeTone, { bg: string; border: string; fg: string }>;
}

/**
 * 脚本自己挂在页面上的根节点。采样一律跳过它们的子树。
 * 少一个都会在某条组合路径上采到自己（评审实测：导入窗开着时开恢复窗、归属横幅在场时弹通知）。
 *
 * 收录判据：**脚本自建**、且会命中 `NATIVE` 里某个选择器的根节点。
 * - `.gsm-restore-overlay` / `.gsm-import-overlay` 命中 `[role="dialog"]`，内含 `<button>`；
 * - `.gsm-notify-stack` / `.gsm-account-banner` / `.gsm-setup-banner` 内含 `<button>` 与 `<a href>`；
 * - `.stars-tag-filter` / `.gsm-type-filter` / `.gsm-lang-filter` / `.gsm-sort-filter` 里
 *   各自塞了一个 `class="Overlay"` 的浮层（`ui/tagFilter.ts`、`ui/filters.ts`），命中 `dialog` 台阶。
 *
 * ⚠️ **已知缺口**：脚本仍在网格里自建 `<a href>`（`ui/cards.ts` 的卡片标题与
 * `.Link--muted` 计数、`transform.ts` 的分页 `prev`/`next`）。它们会命中 `accentText`
 * 的第二级。真要走到那一级，说明 `--fgColor-accent` 与全部 `.Link` 都没了 —— 那种世界里
 * 采到的会是 `base.css` 里 `var(--fgColor-accent, #0969da)` 落下的浅色值。窗口极窄且
 * 后果只是「强调色不够强调」（它只用于拖拽高亮的描边），所以没有为它把整个网格排除掉：
 * 网格里也有原生节点，一刀切会连带损失正常路径的采样源。
 *
 * **不**收录「给原生节点加类名」的情况（例如给原生按钮补 `.btn`）：那些节点的颜色仍来自
 * 页面样式表，采到的就是页面值，正是我们想要的。
 */
const OWN_UI = [
  '.gsm-restore-overlay',
  '.gsm-import-overlay',
  '.gsm-notify-stack',
  '.gsm-account-banner',
  '.gsm-setup-banner',
  '.stars-tag-filter',
  // `ui/filters.ts` 的三个筛选浮层：容器是脚本建的，内层还被塞了 `class="Overlay"` 的浮层
  // （`filters.ts:725/822/921`），会命中 `NATIVE.dialog` 的 `.Overlay` 台阶。
  // 它们现在**恰好**无害（借的是原生类名、颜色来自页面 `.Overlay` 规则、且 Primer 给
  // `.Overlay` 的 `border:0` 会让描边采样自行跳过），但那只是运气 —— 清单要与判据一致。
  '.gsm-type-filter',
  '.gsm-lang-filter',
  '.gsm-sort-filter',
].join(', ');

/** 采样用的原生节点选择器：先弹层族，再常规容器；命中即用其 computed style */
const NATIVE = {
  // 末尾的 `body` 是**降级兜底**（只在前面几档全落空时才走到）：
  //   - 底色：body 的背景就是页面画布色，语义上仍是「页面给的」；有它，最差形态就不是透明面板；
  //   - 描边：只有当页面真给 body 画了边框时才可能命中（正常页面不会），无需额外设防；
  //   - 圆角：body 是 0px，`sampleRadius()` 会把 `0px` 当「取不到」跳过。
  dialog: ['[role="dialog"]', 'dialog', '.Overlay', '.Box', 'body'],
  // 排除主/危险按钮：它们是全站第一个 `.btn` 的常见候选（PR 页、设置页），
  // 拿它们的底色当「次要按钮」会得到一片绿/红
  button: ['.btn:not(.btn-primary):not(.btn-danger)', 'button[type="button"]', 'button'],
  primary: ['.btn-primary', '.btn[type="submit"]'],
  backdrop: ['.Overlay-backdrop', '.modal-backdrop'],
  // 强调色优先 `.Link`（真机实测 rgb(68,147,248) = --fgColor-accent）；
  // 退到普通链接，但**必须**排除跳过导航链接：它是全站第一个 `<a>`，前景是 onEmphasis
  // （暗色下是白），拿来当强调色会得到白勾选框 / 白描边 / 白按钮底
  accentText: ['.Link', 'a[href]:not(.show-on-focus):not(.js-skip-to-content)'],
  checkbox: ['input[type="checkbox"]:checked', 'input[type="radio"]:checked'],
} as const;

const EMPTY = '';
/** 取不到 / 等于没写的值（透明、none、auto 都不能当作具体颜色用） */
const NULL_VALUES = new Set(['transparent', 'none', 'rgba(0, 0, 0, 0)', 'initial', 'unset', 'auto']);

function rootStyle(): CSSStyleDeclaration | null {
  const root = document.documentElement;
  return root ? getComputedStyle(root) : null;
}

/** 依次读取自定义属性，返回第一个可用的值（空 / 透明 / none = 该 token 在此页不可用） */
function token(cs: CSSStyleDeclaration | null, names: readonly string[]): string {
  if (!cs) return EMPTY;
  for (const name of names) {
    const value = cs.getPropertyValue(name).trim();
    if (value && !NULL_VALUES.has(value)) return value;
  }
  return EMPTY;
}

/** 能从 computed style 上直接读的、我们需要的那几个属性 */
type SampledProp = 'backgroundColor' | 'color' | 'borderTopColor' | 'accentColor';

/** 这个元素（或它的某个祖先）是脚本自己造的吗？是就别采 */
function isOwnNode(el: Element): boolean {
  return el.closest(OWN_UI) !== null;
}

/**
 * 采样原生节点的 computed style。
 * **逐元素**推进：首个命中透明 ⇒ 看下一个元素，而不是丢掉整个选择器。
 * 描边另外要求真的画了出来（`border-style: none` 时 `borderTopColor` 仍返回 `currentColor`，
 * 拿来当描边色会得到一道文本色的粗线）。
 */
function sample(selectors: readonly string[], prop: SampledProp): string {
  for (const selector of selectors) {
    for (const el of Array.from(document.querySelectorAll(selector))) {
      if (isOwnNode(el)) continue;
      const cs = getComputedStyle(el);
      if (prop === 'borderTopColor') {
        if (cs.borderTopStyle === 'none' || cs.borderTopWidth === '0px') continue;
      }
      const value = cs[prop].trim();
      if (!value || NULL_VALUES.has(value)) continue;
      return value;
    }
  }
  return EMPTY;
}

/** 采样原生节点的圆角（几何值，不是颜色；取不到时返回空串） */
function sampleRadius(selectors: readonly string[]): string {
  for (const selector of selectors) {
    for (const el of Array.from(document.querySelectorAll(selector))) {
      if (isOwnNode(el)) continue;
      const value = getComputedStyle(el).borderTopLeftRadius.trim();
      // `0px` 是「确实没有圆角」，与「读不到」不同 —— 但对内联面板来说无区分意义，按取不到处理
      if (!value || value === '0px') continue;
      return value;
    }
  }
  return EMPTY;
}

/**
 * 现场解析主题。每次打开弹窗时调用一次（用户可能在两次打开之间切换主题，
 * 缓存住就会用上一次的配色）。`getComputedStyle(root)` 只取一次，全程复用。
 */
export function resolveUiTheme(): UiTheme {
  const cs = rootStyle();

  const canvas = token(cs, ['--overlay-bgColor']) || token(cs, ['--bgColor-default']) || sample(NATIVE.dialog, 'backgroundColor');
  const fg = token(cs, ['--fgColor-default']) || sample(['body'], 'color');
  const border =
    token(cs, ['--overlay-borderColor']) || token(cs, ['--borderColor-default']) || sample(NATIVE.dialog, 'borderTopColor');
  const accentFg = token(cs, ['--fgColor-accent']) || sample(NATIVE.accentText, 'color') || fg;
  const btnBg =
    token(cs, ['--button-default-bgColor-rest']) ||
    sample(NATIVE.button, 'backgroundColor') ||
    token(cs, ['--bgColor-muted']);
  const btnFg = token(cs, ['--button-default-fgColor-rest']) || fg;
  // 主按钮底：只有前两级（token / 采样原生主按钮）算「强调域」。第三级退到次要按钮底是
  // 面→面同域兜底，但它已经**不在**强调域里了 —— 下面配前景时必须看这个标记。
  const primaryBgEmphasis =
    token(cs, ['--button-primary-bgColor-rest']) || sample(NATIVE.primary, 'backgroundColor');
  const btnPrimaryBg = primaryBgEmphasis || btnBg;
  // 主按钮前景：**整个强调域**的配对约束 —— 底不在强调域，前景也一律留空。
  //   · 底在强调域 ⇒ `--button-primary-fgColor-rest`（生产路径，= `--fgColor-white`）→ onEmphasis；
  //   · 底退到 `btnBg`（亮色 #f6f8fa 这种默认面）⇒ 前景留空、继承页面前景色（与底同域）。
  // 不能只对 onEmphasis 那一级加约束：只缺 `--button-primary-bgColor-rest` 而
  // `--button-primary-fgColor-rest` 还在时，白字压近白底（1.05:1）照样成立 —— 那比 issue #1
  // 更难发现，因为按钮看起来"没坏"，只是读不出来。
  const btnPrimaryFg = primaryBgEmphasis
    ? token(cs, ['--button-primary-fgColor-rest']) || token(cs, ['--fgColor-onEmphasis'])
    : EMPTY;

  return {
    canvas,
    fg,
    fgMuted: token(cs, ['--fgColor-muted']) || fg,
    border,
    accentFg,
    accentBg: token(cs, ['--bgColor-accent-muted']) || canvas,
    btnBg,
    btnFg,
    btnBorder:
      token(cs, ['--button-default-borderColor-rest']) || sample(NATIVE.button, 'borderTopColor') || border,
    btnBgHover: token(cs, ['--button-default-bgColor-hover']) || btnBg,
    btnBgActive: token(cs, ['--button-default-bgColor-active']) || btnBg,
    btnPrimaryBg,
    // 前景不拿面板底色兜（那是拿背景当文字色，会造出「白底白字」的按钮）；
    // 也不无条件拿 onEmphasis 兜（见上面 `primaryBgEmphasis` 的配对约束）
    btnPrimaryFg,
    btnPrimaryBorder: token(cs, ['--button-primary-borderColor-rest']) || btnPrimaryBg,
    // 勾选框同理：`accent-color` 是**表面色**，不能拿文本强调色兜（暗色下会白勾压白面板）。
    // 取不到就留空 = 浏览器默认，天然跟随 color-scheme
    checked: token(cs, ['--control-checked-bgColor-rest']) || sample(NATIVE.checkbox, 'accentColor'),
    backdrop: token(cs, ['--overlay-backdrop-bgColor']) || sample(NATIVE.backdrop, 'backgroundColor'),
    floatingShadow:
      token(cs, ['--shadow-floating-large']) ||
      token(cs, ['--shadow-floating-medium']) ||
      token(cs, ['--shadow-floating-small']),
    restingShadow: token(cs, ['--shadow-resting-small']) || token(cs, ['--shadow-resting-medium']),
    btnShadow: token(cs, ['--button-default-shadow-resting']),
    // 圆角是几何值不是颜色，但同样先取页面（token → 采样原生弹层/按钮），
    // 最后才退到 GitHub 的两档常用值 —— 内联面板全是方角比「圆角略大」更难看。
    radiusLarge: token(cs, ['--borderRadius-large']) || sampleRadius(NATIVE.dialog) || '12px',
    radiusMedium: token(cs, ['--borderRadius-medium']) || sampleRadius(NATIVE.button) || '6px',
    notice: {
      info: noticeTone(cs, 'accent', 'info'),
      success: noticeTone(cs, 'success', 'success'),
      warn: noticeTone(cs, 'attention', 'warn'),
      danger: noticeTone(cs, 'danger', 'error'),
    },
  };
}

/** 一种语义的成套配色：三类 token 同名换前缀；缺项时用同级 token 递补（不写死颜色） */
function noticeTone(
  cs: CSSStyleDeclaration | null,
  name: 'accent' | 'success' | 'attention' | 'danger',
  flashClass: string,
): { bg: string; border: string; fg: string } {
  // 第三级只认 `.flash` 族：`[role=alert]` 在页面上可能是任意语义的告警条
  // （甚至就是脚本自己的归属横幅），采它会得到「蓝底配红边」这种语义错配
  const flash = () => sample([`.flash-${flashClass}`, '.flash'], 'backgroundColor');
  return {
    bg: token(cs, [`--bgColor-${name}-muted`]) || flash(),
    border: token(cs, [`--borderColor-${name}-muted`]) || token(cs, ['--borderColor-default']),
    fg: token(cs, [`--fgColor-${name}`]) || token(cs, ['--fgColor-default']),
  };
}

/**
 * 描边简写：颜色取不到时退成 `currentColor`（这是 CSS 关键字，等于沿用页面给继承的前景色，
 * 不是自造颜色），避免拼出 `1px solid` 这种非法值。
 * `style` 默认 `solid`；虚线边框（导入窗）传 `'dashed'`——**必须**传，否则 shorthand 非法、
 * 整条 `border` 声明会被丢弃。
 */
export function borderCss(width: string, color: string, style: 'solid' | 'dashed' = 'solid'): string {
  return `${width} ${style} ${color || 'currentColor'}`;
}

/**
 * 把一层语义色盖在**不透明底**上。
 *
 * 为什么不能直接 `background: tint`：暗色主题下 `--bgColor-*-muted` 与 `--bgColor-accent-muted`
 * 都是 **alpha 色**（token 原值是 8 位带 alpha 的十六进制，实测 `#388bfd1a` = 10%、
 * `#2ea04326` = 15%；`getComputedStyle(...).backgroundColor` 上读出来才是 `rgba(56,139,253,0.1)`。
 * 亮色主题反而是不透明的 `#ddf4ff` / `#dafbe1`）。
 * 通知栈是 `position:fixed`、导入窗是整屏遮罩 —— 直接铺 alpha 色会让面板透出下面的页面内容，
 * 撞上浅色图片就是「浅字压浅底」。所以底色永远用页面 `canvas`（不透明），
 * 语义色作为 `background-image` 的一层渐变盖上去。两个值都来自页面，不是自造颜色。
 *
 * 返回的对象可直接展开进 `Object.assign(el.style, ...)`。
 */
export function tintOver(base: string, tint: string): { background: string; backgroundImage: string } {
  if (!tint) return { background: base, backgroundImage: '' };
  // 底都取不到时退回语义色本身：半透明也好过完全不写（至少还能看出强调态）
  if (!base) return { background: tint, backgroundImage: '' };
  return { background: base, backgroundImage: `linear-gradient(${tint}, ${tint})` };
}
