// 右上角通知栈（4.9.0，ADR 0003）。
//
// 行为定案：
// - 新条目**从底部追加**（appendChild）；**不设条数上限**；
// - 3s 自动消失；**鼠标悬停整个区域**时暂停计时（含所有条目，不只是悬停的那条）；
// - 带动作按钮的条目（如「恢复」）：动作成功后**原地划掉**、文案换成「✓ owner/repo 已恢复」、
//   移除按钮，并**重置 3s**；
// - 同样的事件不判重（ADR 0003：每次同步各弹一条）。
//
// 样式**全内联 + transition**（不用 keyframes、不依赖只有 Stars 视图才注入的样式表）：
// 同步简报可能出现在任意 github.com 页面（如详情页手动同步），照抄 exportImportMenu 的做法。
// 滑动入场用 transition 完成：先置于屏幕外右侧，下一帧改回 0 即产生滑入动画。

export type NoticeKind = 'info' | 'warn' | 'success' | 'danger';

export interface NoticeOptions {
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

/** 自动消失时长（ADR 0003） */
export const NOTICE_LIFETIME_MS = 3000;
const TICK_MS = 100;
const SLIDE_MS = 220;

const KIND_COLORS: Record<NoticeKind, { bg: string; border: string; fg: string }> = {
  info: { bg: '#ddf4ff', border: '#54aeff', fg: '#0a3069' },
  success: { bg: '#dafbe1', border: '#4ac26b', fg: '#04260f' },
  warn: { bg: '#fff8c5', border: '#d4a72c', fg: '#4d2d00' },
  danger: { bg: '#ffebe9', border: '#ff8182', fg: '#82071e' },
};

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

function ensureContainer(): HTMLElement {
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
    top: '16px',
    right: '16px',
    zIndex: '9999',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '8px',
    maxWidth: 'min(420px, 92vw)',
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

function slideIn(el: HTMLElement): void {
  el.style.transition = 'none';
  el.style.transform = 'translateX(calc(100% + 16px))';
  el.style.opacity = '0';
  void el.offsetWidth; // 强制样式计算，提交起点
  el.style.transition = `transform ${SLIDE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity ${SLIDE_MS}ms ease-out`;
  el.style.transform = 'translateX(0)';
  el.style.opacity = '1';
}

function removeItem(item: Item): void {
  if (!items.has(item)) return;
  items.delete(item);
  item.el.style.transition = `transform ${SLIDE_MS}ms ease-in, opacity ${SLIDE_MS}ms ease-in`;
  item.el.style.transform = 'translateX(calc(100% + 16px))';
  item.el.style.opacity = '0';
  window.setTimeout(() => item.el.remove(), SLIDE_MS);
  if (items.size === 0) stopTicker();
}

function buildItem(text: string, kind: NoticeKind, opts: NoticeOptions): Item {
  const colors = KIND_COLORS[kind];
  const box = document.createElement('div');
  box.className = `gsm-notice gsm-notice-${kind}`;
  Object.assign(box.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 12px',
    borderRadius: '8px',
    border: `1px solid ${colors.border}`,
    background: colors.bg,
    color: colors.fg,
    boxShadow: '0 4px 16px rgba(0,0,0,0.16)',
    fontSize: '13px',
    lineHeight: '1.4',
  } as Partial<CSSStyleDeclaration>);

  const label = document.createElement('span');
  label.className = 'gsm-notice-text';
  label.textContent = text;
  Object.assign(label.style, { flex: '1 1 auto', wordBreak: 'break-word' } as Partial<CSSStyleDeclaration>);

  let buttonWrap: HTMLElement | null = null;
  if (opts.actionLabel && opts.onAction) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gsm-notice-action';
    btn.textContent = opts.actionLabel;
    Object.assign(btn.style, {
      flex: '0 0 auto',
      cursor: 'pointer',
      fontSize: '12px',
      padding: '3px 10px',
      borderRadius: '6px',
      border: `1px solid ${colors.border}`,
      background: '#fff',
      color: colors.fg,
    } as Partial<CSSStyleDeclaration>);
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
  }

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'gsm-notice-close';
  close.setAttribute('aria-label', '关闭');
  close.textContent = '×';
  Object.assign(close.style, {
    flex: '0 0 auto',
    cursor: 'pointer',
    border: 'none',
    background: 'transparent',
    color: colors.fg,
    fontSize: '16px',
    lineHeight: '1',
    opacity: '0.7',
  } as Partial<CSSStyleDeclaration>);

  if (buttonWrap) box.append(label, buttonWrap, close);
  else box.append(label, close);

  const item = {
    el: box,
    buttonWrap,
    labelEl: label,
    remaining: NOTICE_LIFETIME_MS,
    handle: null as unknown as NoticeHandle,
  } as Item;

  close.addEventListener('click', () => removeItem(item));

  item.handle = {
    complete(doneText?: string): void {
      if (doneText) label.textContent = doneText;
      label.style.textDecoration = 'line-through';
      label.style.opacity = '0.75';
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
  const item = buildItem(text, kind, opts);
  host.appendChild(item.el); // 追加 = 新条目出现在**底部**
  items.add(item);
  slideIn(item.el);
  ensureTicker();
  return item.handle;
}
