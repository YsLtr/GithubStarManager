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

type RepositionHandler = () => void;
let repositionHandler: RepositionHandler | null = null;

/** index.ts 注册（handler 模式，同 tokenConfig 的 setTokenSavedHandler，避免菜单↔banner 循环导入）：
 *  开关切换后按新落位重挂已存在的配置面板（关态下横幅不能留在 Lists 槽位）。 */
export function setHideListsRepositionHandler(fn: RepositionHandler | null): void {
  repositionHandler = fn;
}

function menuLabel(): string {
  return `🙈 隐藏 Lists 区块（${isHideListsEnabled() ? '开' : '关'}）`;
}

export function registerHideListsMenu(): void {
  let menuId: unknown;
  // 刷新标签优先用 TM 4.20+ 的 options.id 原地更新（unregister+register 是 TM 历史缺陷面，
  // #1607 曾致菜单项全消失、标签刷新到 5.4.6224 才修）；id 拿不到时回退 unregister+register。
  const refresh = (): void => {
    if (menuId !== undefined) {
      const updated = gmRegisterMenuCommand(menuLabel(), onToggle, { id: menuId });
      if (updated !== undefined) {
        menuId = updated;
        return;
      }
      gmUnregisterMenuCommand(menuId);
    }
    menuId = gmRegisterMenuCommand(menuLabel(), onToggle);
  };
  const onToggle = (): void => {
    gmSet(STORAGE_KEYS.hideLists, !isHideListsEnabled());
    applyHideListsGate();
    hideListsSection();
    console.log(`[github-stars-grid] Hide Lists 切换为 ${isHideListsEnabled() ? '开（隐藏）' : '关（显示）'}`);
    repositionHandler?.(); // 已存在的配置面板按新落位重挂（🟡-1）
    refresh();
  };
  menuId = gmRegisterMenuCommand(menuLabel(), onToggle);
}
