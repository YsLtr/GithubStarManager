// 通知栈（4.9.0，ADR 0003）：锚在**全局头部下方**的右侧主界面区（不压在 header 上、也不进 header 的 DOM），
// 头部滚出视口后回落到视口顶部（用户裁定）。
//
// 行为定案：
// - 新条目**从底部追加**（appendChild）；**不设条数上限**；
// - 3s 自动消失；**鼠标悬停整个区域**时暂停计时（含所有条目，不只是悬停的那条）；
// - 带动作按钮的条目（如「恢复」）：动作成功后**原地划掉**、文案换成「✓ owner/repo 已恢复」、
//   移除按钮，并**重置 3s**；
// - 同样的事件不判重（ADR 0003：每次同步各弹一条）。
//
// 观感**照搬 GitHub 自己的 `.flash`**（内联消息族，4.9.1；来源与取值口径见下方常量区注释）——
// 用户 2026-10-02 判定过中间的 Primer `Toast` 版「与卡片格格不入」，**不要**回退到那一族。
// 样式**全内联 + transition**（不用 keyframes、不依赖只有 Stars 视图才注入的样式表）：
// 同步简报可能出现在任意 github.com 页面（如详情页手动同步）。
import { createScope, type LifecycleScope } from '../lifecycle';
import { isDesktop } from '../utils';
type NoticeKind = 'info' | 'warn' | 'success' | 'danger';

interface NoticeOptions {
  kind?: NoticeKind;
  /** 动作按钮文案（给了才渲染按钮），如「恢复」 */
  actionLabel?: string;
  /** 动作回调；抛出/失败由调用方自己提示 */
  onAction?: () => void | Promise<void>;
}

export interface NoticeHandle {
  /** 就地切换为「已完成」形态（划掉 + 去按钮 + 重置倒计时） */
  complete(doneText?: string): void;
  /** 就地更新文案（不动倒计时） */
  update(text: string): void;
  /** 立即移除 */
  dismiss(): void;
}

/** 窄视口下通知被整体拒绝时返回的空句柄（调用方不必判空，划掉/更新/关闭都是无操作） */
const NOOP_NOTICE_HANDLE: NoticeHandle = {
  complete: () => {},
  update: () => {},
  dismiss: () => {},
};

/** 自动消失时长（ADR 0003） */
const NOTICE_LIFETIME_MS = 3000;
const TICK_MS = 100;
/** 入场/离场时长与缓动：`.Toast--animateIn/Out` 的 0.18s + 官方 cubic-bezier */
const SLIDE_MS = 180;
const EASE_IN = 'cubic-bezier(0.22, 0.61, 0.36, 1)';
const EASE_OUT = 'cubic-bezier(0.55, 0.06, 0.68, 0.19)';

/* ---------------- GitHub（Primer）观感：取值全部来自官方来源 ---------------- */
//
// 4.9.1 改口径：观感从 Primer `Toast`（**浮动** toast 族，48px 满饱和图标条 + 三层重投影）
// 换成 GitHub 自己的 `.flash`（**内联消息**族）——后者与本脚本既有 UI 同族：1px 真描边、
// 6px 圆角、语义浅色底、细线图标着强调色，不是"一张漂浮的弹窗"。
// 对照的既有 UI：`.stars-grid-card`（`1px solid var(--borderColor-default)` + 6px + hover `0 1px 3px`）、
// `.gsm-setup-banner`（同描边/圆角，`padding: 12px 16px`）、`restoreMenu` 的按钮（14px / `6px 14px`）。
//
// - 底 / 描边 / 图标色 = 线上 `.flash` 家族的**成套配对**（逐条抄自 github.com 当前样式表）：
//   `.flash`        → `bgColor-accent-muted`    + `borderColor-accent-muted`    + `fgColor-accent`
//   `.flash-warn`   → `bgColor-attention-muted` + `borderColor-attention-muted` + `fgColor-attention`
//   `.flash-error`  → `bgColor-danger-muted`    + `borderColor-danger-muted`    + `fgColor-danger`
//   `.flash-success`→ `bgColor-success-muted`   + `borderColor-success-muted`   + `fgColor-success`
//   实测值：#ddf4ff/#54aeff66/#0969da、#fff8c5/#d4a72c66/#9a6700、#ffebe9/#ff818266/#d1242f、#dafbe1/#4ac26b66/#1a7f37。
// - 只走 GitHub 的 CSS 变量（实测 `:root` 上存在）+ 浅色兜底 ⇒ 自动跟随 light / dark / dimmed。
// - 图标是 `@primer/octicons` 的 `build/data.json` 里 16px **细线**版 path（官方数据直取，非手绘）。
// - 入场时长/缓动沿用 `.Toast--animateIn` 的 0.18s + 官方缓动（`.flash` 本身没有入场动画）。
// - 内边距取 **12px 16px**（与 `.gsm-setup-banner` 一致），不取 `.flash` 的 20px：3s 瞬态通知要更紧凑。

/** 各语义的成套配色（底 / 描边 / 图标色）+ 细线图标 path —— 与 `.flash` 家族一一对应 */
const KIND_STYLE: Record<NoticeKind, { bg: string; border: string; fg: string; icon: string }> = {
  info: {
    bg: 'var(--bgColor-accent-muted, #ddf4ff)',
    border: 'var(--borderColor-accent-muted, #54aeff66)',
    fg: 'var(--fgColor-accent, #0969da)',
    icon: 'M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z',
  },
  success: {
    bg: 'var(--bgColor-success-muted, #dafbe1)',
    border: 'var(--borderColor-success-muted, #4ac26b66)',
    fg: 'var(--fgColor-success, #1a7f37)',
    icon: 'M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm1.5 0a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm10.28-1.72-4.5 4.5a.75.75 0 0 1-1.06 0l-2-2a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018l1.47 1.47 3.97-3.97a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042Z',
  },
  warn: {
    bg: 'var(--bgColor-attention-muted, #fff8c5)',
    border: 'var(--borderColor-attention-muted, #d4a72c66)',
    fg: 'var(--fgColor-attention, #9a6700)',
    icon: 'M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z',
  },
  danger: {
    bg: 'var(--bgColor-danger-muted, #ffebe9)',
    border: 'var(--borderColor-danger-muted, #ff818266)',
    fg: 'var(--fgColor-danger, #d1242f)',
    icon: 'M2.344 2.343h-.001a8 8 0 0 1 11.314 11.314A8.002 8.002 0 0 1 .234 10.089a8 8 0 0 1 2.11-7.746Zm1.06 10.253a6.5 6.5 0 1 0 9.108-9.275 6.5 6.5 0 0 0-9.108 9.275ZM6.03 4.97 8 6.94l1.97-1.97a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l1.97 1.97a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-1.97 1.97a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734L6.94 8 4.97 6.03a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018Z',
  },
};
/** 默认（次要）按钮的静置阴影；token 与兜底值同形 */
const BTN_SHADOW = 'var(--button-default-shadow-resting, 0 1px 0 0 #1f23280a)';
/** 关闭按钮的 ×（Octicon `x`，细线） */
const ICON_X =
  'M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z';
/** 容器阴影：取 `.stars-grid-card:hover` 的 `0 1px 3px rgba(0, 0, 0, 0.08)`（卡片量级，不是悬浮弹窗量级） */
const CARD_SHADOW = '0 1px 3px rgba(0, 0, 0, 0.08)';
/** GitHub 按钮的过渡（`.btn` 的 `80ms cubic-bezier(0.33, 1, 0.68, 1)`） */
const BTN_TRANSITION = 'color 80ms cubic-bezier(0.33, 1, 0.68, 1), background-color 80ms cubic-bezier(0.33, 1, 0.68, 1), border-color 80ms cubic-bezier(0.33, 1, 0.68, 1)';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 16px Octicon：`fill: currentColor` 随前景色，语义已由文本承载故对读屏隐藏 */
function octicon(d: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  svg.appendChild(path);
  return svg;
}

/**
 * 内联样式没有 `:hover` / `:active`，用一对监听补上 GitHub 的交互反馈。
 * `rest` 是常态值（也是鼠标离开后恢复的值），`hover` / `active` 是覆盖值。
 */
function withHover(
  el: HTMLElement,
  rest: Record<string, string>,
  hover: Record<string, string>,
  active?: Record<string, string>,
): void {
  const apply = (v: Record<string, string>): void => {
    for (const k of Object.keys(v)) (el.style as unknown as Record<string, string>)[k] = v[k];
  };
  el.addEventListener('mouseenter', () => apply(hover));
  el.addEventListener('mouseleave', () => apply(rest));
  if (active) {
    el.addEventListener('mousedown', () => apply(active));
    el.addEventListener('mouseup', () => apply(hover));
  }
}

interface Item {
  el: HTMLElement;
  buttonWrap: HTMLElement | null;
  labelEl: HTMLElement;
  remaining: number;
  handle: NoticeHandle;
}

let container: HTMLElement | null = null;
let ticker: number | null = null;
let hovering = false;
const items = new Set<Item>();

/** 通知栈与全局头部底边的间距 */
const HEADER_GAP_PX = 8;
/** GitHub 全局头部（各视图一致的唯一锚点；缺席时退化为视口顶部） */
const HEADER_SELECTOR = 'div.header-wrapper.js-header-wrapper';

/**
 * 把容器钉在全局头部**下方**：头部可见时紧贴其底边，头部滚出视口（底边为负）后夹回视口顶部。
 * 锚点只作几何参考，容器始终挂在 body 上，**不是** header 的子节点。
 */
function syncStackTop(el: HTMLElement): void {
  const hdr = document.querySelector(HEADER_SELECTOR);
  const bottom = hdr ? hdr.getBoundingClientRect().bottom : 0;
  el.style.top = `${Math.max(bottom + HEADER_GAP_PX, HEADER_GAP_PX)}px`;
}
let positionRaf = 0;
/** 通知栈的位置跟踪作用域（4.9.1）：受管监听，随容器一起释放（见 disposeNotificationStack） */
let stackScope: LifecycleScope | null = null;

/** 滚动 / 改窗口时重算锚点（rAF 合帧，避免每个 scroll 都强制布局）。只注册一次，随容器存亡自愈。 */
function ensureStackPositionTracking(): void {
  if (stackScope) return;
  const scope = createScope('gsm-notify-position');
  stackScope = scope;
  const resync = (): void => {
    if (positionRaf) return;
    positionRaf = scope.raf(() => {
      positionRaf = 0;
      if (container && container.isConnected) syncStackTop(container);
    });
  };
  // capture：页面内层滚动容器也能捕获
  scope.addListener(window, 'scroll', resync, { capture: true, passive: true });
  scope.addListener(window, 'resize', resync, { passive: true });
  // 后台标签页里 scroll 事件与 rAF 都被冻结（实测：hidden 时 scrollEvents 恒为 0）→ 回前台补一次
  scope.addListener(document, 'visibilitychange', resync);
}

/**
 * 释放整座通知栈（4.9.1 teardown）：丢弃全部条目、移除容器、解绑 3 个全局位置监听。
 * 下次再弹通知时 ensureContainer 会重建（含重新注册监听）—— 所以回滚不是「永久关闭通知」。
 */
export function disposeNotificationStack(): void {
  for (const item of [...items]) items.delete(item);
  stopTicker();
  hovering = false;
  positionRaf = 0;
  container?.remove();
  container = null;
  stackScope?.dispose();
  stackScope = null;
}

function ensureContainer(): HTMLElement | null {
  // 窄视口零 UI（4.10.0）：门开在**容器入口**而不是 pushNotice —— 这里是所有通知唯一的
  // 落点，同步简报、恢复通知、将来新增的异步通知路径都自动被拦住（单一真相）。
  // 背景：容器是**懒重建**的，窄视口下哪怕只从 TM 菜单触发一次同步，也会把整座通知栈
  // 重新建出来，与「窄视口完全惰性」正面冲突（AGENTS 已知风险第 10 条）。
  if (!isDesktop()) return null;
  if (container && container.isConnected) return container;
  // 容器消失了（Turbo 整页导航把 body 内容换掉）：mouseleave 永不会来，
  // 必须显式复位，否则 hovering 恒 true → 之后所有通知都不再自动消失。
  hovering = false;
  stopTicker();
  const el = document.createElement('div');
  el.className = 'gsm-notify-stack';
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'GithubStarManager 通知');
  Object.assign(el.style, {
    position: 'fixed',
    right: '16px',
    zIndex: '9999',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '8px',
    maxWidth: 'min(450px, 92vw)', // 与 Primer `.Toast` 的 max-width 对齐
    pointerEvents: 'auto',
    fontFamily: 'inherit',
  } as Partial<CSSStyleDeclaration>);
  // 悬停**整个区域**暂停计时（不是逐条）
  el.addEventListener('mouseenter', () => {
    hovering = true;
  });
  el.addEventListener('mouseleave', () => {
    hovering = false;
  });
  document.body.appendChild(el);
  container = el;
  syncStackTop(el); // 锚在全局头部下方（头部缺席 → 视口顶部）
  ensureStackPositionTracking();
  return el;
}

function ensureTicker(): void {
  if (ticker !== null) return;
  ticker = window.setInterval(() => {
    // 容器被导航拆掉后自愈：否则 ticker 与 hovering 都会永久残留
    if (container && !container.isConnected) {
      hovering = false;
      for (const item of [...items]) items.delete(item);
      stopTicker();
      return;
    }
    if (hovering) return;
    for (const item of [...items]) {
      item.remaining -= TICK_MS;
      if (item.remaining <= 0) removeItem(item);
    }
    if (items.size === 0) stopTicker();
  }, TICK_MS);
}

function stopTicker(): void {
  if (ticker === null) return;
  window.clearInterval(ticker);
  ticker = null;
}

/** 入场：从上方 8px 落位 + 淡入（沿用 `.Toast--animateIn` 的 0.18s 与缓动；`.flash` 本身无入场动画） */
function slideIn(el: HTMLElement): void {
  el.style.transition = 'none';
  el.style.transform = 'translateY(-8px)';
  el.style.opacity = '0';
  void el.offsetWidth; // 强制样式计算，提交起点
  el.style.transition = `transform ${SLIDE_MS}ms ${EASE_IN}, opacity ${SLIDE_MS}ms ${EASE_IN}`;
  el.style.transform = 'translateY(0)';
  el.style.opacity = '1';
}

function removeItem(item: Item): void {
  if (!items.has(item)) return;
  items.delete(item);
  item.el.style.transition = `transform ${SLIDE_MS}ms ${EASE_OUT}, opacity ${SLIDE_MS}ms ${EASE_OUT}`;
  item.el.style.transform = 'translateY(-8px)';
  item.el.style.opacity = '0';
  window.setTimeout(() => item.el.remove(), SLIDE_MS);
  if (items.size === 0) stopTicker();
}

/** 组装一条 GitHub `.flash` 形态的通知：一行 `[细线图标][文本][动作按钮?][关闭]`，语义浅色底 + 1px 细描边 */
function buildItem(text: string, kind: NoticeKind, opts: NoticeOptions): Item {
  const style = KIND_STYLE[kind];
  const box = document.createElement('div');
  box.className = `gsm-notice gsm-notice-${kind}`;
  Object.assign(box.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '12px', // `.flash .octicon { margin-right: var(--base-size-12) }` 的等价物
    width: 'max-content',
    maxWidth: 'min(450px, 92vw)',
    padding: '12px 16px', // 与 `.gsm-setup-banner` 一致
    // 真 border（不是 Toast 的 inset box-shadow）—— 与 `.stars-grid-card` / `.gsm-setup-banner` 同手法
    border: `1px solid ${style.border}`,
    borderRadius: 'var(--borderRadius-medium, 0.375rem)',
    background: style.bg,
    boxShadow: CARD_SHADOW,
    color: 'var(--fgColor-default, #1f2328)',
    fontFamily: 'inherit',
    fontSize: 'var(--text-body-size-medium, 0.875rem)',
    lineHeight: '1.5',
  } as Partial<CSSStyleDeclaration>);

  // 图标：16px 细线 octicon，着该语义的强调色（`.flash-warn .octicon { color: var(--fgColor-attention) }`）
  const icon = octicon(style.icon);
  icon.classList.add('gsm-notice-icon');
  icon.style.flex = '0 0 auto';
  icon.style.color = style.fg;

  const label = document.createElement('span');
  label.className = 'gsm-notice-text';
  label.textContent = text;
  Object.assign(label.style, {
    flex: '1 1 auto',
    minWidth: '0',
    wordBreak: 'break-word',
  } as Partial<CSSStyleDeclaration>);

  let buttonWrap: HTMLElement | null = null;
  if (opts.actionLabel && opts.onAction) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gsm-notice-action';
    btn.textContent = opts.actionLabel;
    // 默认（次要）按钮的常态值 —— 同时作为 hover/active 结束后的恢复值
    const rest = {
      background: 'var(--button-default-bgColor-rest, #f6f8fa)',
      borderColor: 'var(--button-default-borderColor-rest, #d1d9e0)',
    };
    Object.assign(btn.style, {
      flex: '0 0 auto',
      cursor: 'pointer',
      // 尺寸对齐 restoreMenu 的按钮（14px / 6px 14px），不用 `.btn-sm` 的小一号档
      padding: '6px 14px',
      fontSize: 'var(--text-body-size-medium, 0.875rem)',
      fontWeight: '500',
      lineHeight: '20px',
      whiteSpace: 'nowrap',
      borderRadius: 'var(--borderRadius-medium, 0.375rem)',
      borderWidth: '1px',
      borderStyle: 'solid',
      boxShadow: BTN_SHADOW,
      transition: BTN_TRANSITION,
      color: 'var(--button-default-fgColor-rest, #25292e)',
      ...rest,
    } as Partial<CSSStyleDeclaration>);
    withHover(
      btn,
      rest,
      { ...rest, background: 'var(--button-default-bgColor-hover, #eff2f5)' },
      { ...rest, background: 'var(--button-default-bgColor-active, #e6eaef)' },
    );
    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.style.opacity = '0.6';
      void (async () => {
        try {
          await opts.onAction!();
        } finally {
          btn.disabled = false;
          btn.style.opacity = '';
        }
      })();
    });
    buttonWrap = btn;
    // 只留引用，**不在这里 append** —— 否则按钮会插到图标之前（DOM 顺序 = [按钮, 图标, 文本, 关闭]）
  }

  // 关闭按钮（GitHub `.flash-close`：无边框透明底、hover opacity .7 / active .5）
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'gsm-notice-close';
  close.setAttribute('aria-label', '关闭');
  Object.assign(close.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: '0 0 auto',
    padding: '2px',
    marginRight: '-6px', // 视觉上贴回 16px 内边距的边
    cursor: 'pointer',
    border: 'none',
    background: 'transparent',
    color: 'inherit',
  } as Partial<CSSStyleDeclaration>);
  close.appendChild(octicon(ICON_X));
  withHover(close, { opacity: '1' }, { opacity: '0.7' }, { opacity: '0.5' });

  const item = {
    el: box,
    buttonWrap,
    labelEl: label,
    remaining: NOTICE_LIFETIME_MS,
    handle: null as unknown as NoticeHandle,
  } as Item;

  // 顺序固定：图标 → 文本 → 动作按钮（若有）→ 关闭
  box.append(icon, label);
  if (buttonWrap) box.append(buttonWrap);
  box.append(close);
  close.addEventListener('click', () => removeItem(item));

  item.handle = {
    complete(doneText?: string): void {
      if (doneText) label.textContent = doneText;
      label.style.textDecoration = 'line-through';
      label.style.color = 'var(--fgColor-muted, #59636e)';
      buttonWrap?.remove();
      item.buttonWrap = null;
      item.remaining = NOTICE_LIFETIME_MS; // 重置 3s（ADR 0003）
    },
    update(next: string): void {
      label.textContent = next;
    },
    dismiss(): void {
      removeItem(item);
    },
  };
  return item;
}

/**
 * 推入一条通知。返回句柄以便后续就地改文案 / 划掉 / 关闭。
 * 容器不存在时懒创建（可出现在任意 github.com 页面）。
 */
export function pushNotice(text: string, kind: NoticeKind = 'info', opts: NoticeOptions = {}): NoticeHandle {
  const host = ensureContainer();
  if (!host) {
    // 窄视口：通知不显示，但也**不静默** —— 至少控制台留一条（用户可从 TM 菜单开控制台）
    console.log(`[github-star-manager] 窄视口：通知未显示（只留在控制台）：${text}`);
    return NOOP_NOTICE_HANDLE;
  }
  const item = buildItem(text, kind, opts);
  host.appendChild(item.el); // 追加 = 新条目出现在**底部**
  items.add(item);
  slideIn(item.el);
  ensureTicker();
  return item.handle;
}
