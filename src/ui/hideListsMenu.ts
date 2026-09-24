/**
 * TM 菜单「隐藏 Lists 区块」开关（4.5.0）。
 *
 * 默认开启（= 4.4.0 及之前的一贯行为：Stars 页隐藏 Lists 原生区块）；
 * 关闭后 Lists 原生内容正常显示，初始化 / Token 失效时的配置面板改挂网格列顶
 * （不占用 Lists 位置，见 index.ts showSetupBanner 的落位分流）。
 *
 * 实现要点：
 * - TM 菜单只在脚本加载时注册一次，Turbo SPA 内部导航不重跑脚本，切换后必须
 *   GM_unregisterMenuCommand + 重新注册才能刷新「开/关」标签（TM 5.x id 机制）；
 * - 即时生效走两条腿：applyHideListsGate() 切 <html> 门控类（CSS 规则整体失效/生效），
 *   hideListsSection() 内部按开关打/清 JS 标记（幂等，两个方向调用都正确）。
 */
import { applyHideListsGate, hideListsSection, isHideListsEnabled } from '../dom';
import { gmRegisterMenuCommand, gmSet, gmUnregisterMenuCommand } from '../gm';
import { STORAGE_KEYS } from '../constants';

function menuLabel(): string {
  return `🙈 隐藏 Lists 区块（${isHideListsEnabled() ? '开' : '关'}）`;
}

export function registerHideListsMenu(): void {
  let menuId: unknown;
  const register = (): void => {
    menuId = gmRegisterMenuCommand(menuLabel(), onToggle);
  };
  const onToggle = (): void => {
    gmSet(STORAGE_KEYS.hideLists, !isHideListsEnabled());
    applyHideListsGate();
    hideListsSection();
    console.log(`[github-stars-grid] Hide Lists 切换为 ${isHideListsEnabled() ? '开（隐藏）' : '关（显示）'}`);
    if (menuId !== undefined) gmUnregisterMenuCommand(menuId);
    register();
  };
  register();
}
