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
