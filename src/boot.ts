/**
 * document-start 防闪烁（FOUC）引导。
 *
 * 脚本改为 document-start 后，能在原始 DOM 被解析/绘制之前就执行；
 * 这里在第一时间把整页藏起来，等 transformStarsList 完成转换后再解除，
 * 用户全程只能看到卡片网格，原始列表一帧都不会出现。
 *
 * 注意：
 * - document-start 时 DOM 里只有 <html>，style 只能挂在它下面；
 * - 转换失败/选择器失配时有 4s 兜底，最多退化为"延迟闪烁"，不会永久白屏。
 */

import { isDesktop } from './utils';

const HIDE_CLASS = 'gsm-boot-hidden';
const HIDE_STYLE_ID = 'gsm-boot-hide-style';
const FAILSAFE_MS = 4000;

export function isStarsPage(): boolean {
  return /[?&]tab=stars/.test(location.search);
}

/** 在原始内容绘制之前调用（document-start），仅 Stars 页面生效。幂等。 */
export function installBootHide(): void {
  const root = document.documentElement;
  if (!root || root.classList.contains(HIDE_CLASS)) return;
  if (!isStarsPage()) return;
  // 移动端永远不做转换，更不能把页面捂住
  if (!isDesktop()) return;

  const style = document.createElement('style');
  style.id = HIDE_STYLE_ID;
  style.textContent = [
    `html.${HIDE_CLASS},`,
    `html.${HIDE_CLASS} body {`,
    '  visibility: hidden !important;',
    // 用 GitHub 的主题变量给"加载中"空白页上底色，深色模式不闪白
    '  background-color: var(--bgColor-default, transparent) !important;',
    '}',
  ].join('\n');
  root.appendChild(style);
  root.classList.add(HIDE_CLASS);

  // 兜底：无论后续发生什么，最多隐藏 FAILSAFE_MS
  window.setTimeout(revealBootHide, FAILSAFE_MS);
}

/** 页面内容转换完成后调用，解除隐藏。幂等。 */
export function revealBootHide(): void {
  document.documentElement.classList.remove(HIDE_CLASS);
  document.getElementById(HIDE_STYLE_ID)?.remove();
}

/** 解除 Turbo frame 替换期间的隐藏（所有 frame 一起解除）。幂等。 */
export function revealTurboHide(): void {
  document.querySelectorAll('.gsm-turbo-hidden').forEach((el) => el.classList.remove('gsm-turbo-hidden'));
}
