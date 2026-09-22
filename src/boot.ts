/**
 * document-start 防闪烁（FOUC）引导。
 *
 * 脚本改为 document-start 后，能在原始 DOM 被解析/绘制之前就执行；
 * 这里在第一时间把整页藏起来，等 transformStarsList 完成转换后再解除，
 * 用户全程只能看到卡片网格，原始列表一帧都不会出现。
 *
 * 注意：
 * - document-start 时 DOM 里只有 <html>，style 只能挂在它下面；
 * - 藏法用 `body { display: none }`：visibility 可被后代元素覆盖（且 GitHub 还有
 *   app 层样式没查全），display 不可被后代覆盖，保证隐藏期间零绘制；
 * - 转换失败/选择器失配时有 4s 兜底，最多退化为"延迟闪烁"，不会永久白屏；
 * - 挂载/解除都打日志（带原因与耗时）：真机若仍报"闪一下"，
 *   控制台一眼能看出隐藏挂没挂上、何时、因何解除。
 */

import { isDesktop } from './utils';

const HIDE_CLASS = 'gsm-boot-hidden';
const HIDE_STYLE_ID = 'gsm-boot-hide-style';
const FAILSAFE_MS = 4000;

let hideInstalledAt = 0;

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
    `html.${HIDE_CLASS} {`,
    // 用 GitHub 的主题变量给"加载中"空白页上底色，深色模式不闪白
    '  background-color: var(--bgColor-default, transparent) !important;',
    '}',
    // display:none 不可被后代覆盖 → 隐藏期间零绘制
    `html.${HIDE_CLASS} body {`,
    '  display: none !important;',
    '}',
  ].join('\n');
  root.appendChild(style);
  root.classList.add(HIDE_CLASS);
  hideInstalledAt = performance.now();
  console.log('[github-stars-grid] 防闪烁隐藏已挂载');

  // 兜底：无论后续发生什么，最多隐藏 FAILSAFE_MS
  window.setTimeout(() => revealBootHide('4s 兜底'), FAILSAFE_MS);
}

/** 解除隐藏。幂等；只在真正解除时打日志（原因 + 挂载以来耗时）。 */
export function revealBootHide(reason = '未注明原因'): void {
  const root = document.documentElement;
  if (!root || !root.classList.contains(HIDE_CLASS)) return;
  const elapsed = hideInstalledAt ? Math.round(performance.now() - hideInstalledAt) : 0;
  console.log(`[github-stars-grid] 防闪烁解除: ${reason} (${elapsed}ms)`);
  root.classList.remove(HIDE_CLASS);
  document.getElementById(HIDE_STYLE_ID)?.remove();
}

/** 解除 Turbo frame 替换期间的隐藏（所有 frame 一起解除）。幂等。 */
export function revealTurboHide(): void {
  document.querySelectorAll('.gsm-turbo-hidden').forEach((el) => el.classList.remove('gsm-turbo-hidden'));
}
