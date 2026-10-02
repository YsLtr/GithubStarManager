import { MOBILE_BREAKPOINT } from './constants';

/** HTML 转义，用于把文本拼进 innerHTML 模板 */
export function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * 桌面 / 窄视口的唯一真相：与 CSS 用**同一个媒体查询文本**
 * （base.css 与 persistent.css 的 `@media (min-width: 768px)`）。
 *
 * 刻意**不用** `window.innerWidth`：它与媒体查询在 Safari/WebKit 上口径不同
 * （WebKit 的媒体查询宽度 = clientWidth，不含经典滚动条；bug 52653 至今 OPEN），
 * 会出现「JS 认为桌面、CSS 认为手机」的错位窗口 —— 那正是窄视口残留半个
 * 桌面布局的成因之一。改用 matchMedia 后两者构造性一致。
 *
 * CSS 侧断点写死 768px（CSS 读不到 TS 常量）：改 MOBILE_BREAKPOINT 时必须
 * 同步改 base.css / persistent.css / wide.css 里对应的 @media。
 */
const DESKTOP_QUERY = `(min-width: ${MOBILE_BREAKPOINT}px)`;

/** 拖拽改窗会连发一串 change：合帧到一次，避免半途状态来回翻转 */
const BREAKPOINT_DEBOUNCE_MS = 150;

export function isDesktop(): boolean {
  return window.matchMedia(DESKTOP_QUERY).matches;
}

/**
 * 订阅「跨越 768px 断点」。回调只在**真正跨断点**后触发一次（带 debounce），
 * 返回取消订阅函数。用户把窗口从桌面拖到手机宽度再拖回来时，
 * 脚本靠它做「teardown ←→ 重新转换」的双向切换。
 */
export function subscribeBreakpointChange(onChange: (desktop: boolean) => void): () => void {
  const mql = window.matchMedia(DESKTOP_QUERY);
  let timer: number | undefined;
  const handler = (): void => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = undefined;
      onChange(mql.matches);
    }, BREAKPOINT_DEBOUNCE_MS);
  };
  mql.addEventListener('change', handler);
  return () => {
    if (timer !== undefined) window.clearTimeout(timer);
    mql.removeEventListener('change', handler);
  };
}

/**
 * 把 ISO 时间戳转成 "3 days ago" 这类相对文案。
 *
 * 2026 改版后 stars 页的 `<relative-time>` 在 shadow DOM 里渲染的是绝对
 * 时间（"2026-06-13 06:37:14"），直接存下来会显示得很笨重，所以缓存卡片
 * 统一用这里算出来的相对文案。
 */
export function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (!isFinite(t)) return '';
  const diff = Date.now() - t;
  if (diff < 0) return 'just now';

  const hour = 3600000;
  const day = 86400000;
  if (diff < hour) return 'just now';
  const hours = Math.floor(diff / hour);
  if (hours < 24) return hours === 1 ? '1 hour ago' : hours + ' hours ago';
  const days = Math.floor(diff / day);
  if (days < 30) return days === 1 ? '1 day ago' : days + ' days ago';
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? '1 month ago' : months + ' months ago';
  const years = Math.floor(days / 365);
  return years <= 1 ? '1 year ago' : years + ' years ago';
}
