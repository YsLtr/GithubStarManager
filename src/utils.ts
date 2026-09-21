import { MOBILE_BREAKPOINT } from './constants';

/** HTML 转义，用于把文本拼进 innerHTML 模板 */
export function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/** 视口是否达到桌面端宽度 */
export function isDesktop(): boolean {
  return window.innerWidth >= MOBILE_BREAKPOINT;
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
