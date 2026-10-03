/**
 * 布局样式表的生命周期（4.13.0 从 index.ts 抽出，供两条展示路径共用）。
 *
 * 为什么必须共用：他人 star 页要显示的是**和脚本自己的页一样的卡片网格**，
 * 而卡片/网格的样式全在 `base.css`（`.stars-grid-container` / `.stars-grid-card` / 卡片内部）
 * 里，`wide.css` 负责 ≥1200px 的三栏宽度。
 * 4.13.0 首版只在他人页注入只读徽章样式、**没注入这两张表** ⇒ 卡片无边框、网格
 * `display:block`、卡片单列铺满 —— 屏幕上就是「一堆没有样式的行」，用户报「网格没有应用」
 * （真机实测：`.stars-grid-container` computed `display: block`、`grid-template-columns: none`）。
 *
 * 两张表的性质不同（勿混）：
 * - **persistent**：常驻小表，注入后**不移除** —— `.stars-right-sidebar` 的默认隐藏、
 *   侧边栏宽度回弹的 transition 必须在主表撤掉后仍然存在。
 * - **base + wide（布局主表）**：随 Stars 视图存在，离开视图时整表移除（`removeLayoutStyles`），
 *   GitHub 原生布局立即恢复。
 *
 * 注入顺序恒为「常驻表 → 主表」，同特异性时后插入的主表在 Stars 视图正确覆盖常驻表的默认隐藏。
 */
import baseCss from './styles/base.css?inline';
import persistentCss from './styles/persistent.css?inline';
import wideCss from './styles/wide.css?inline';
import { gmAddStyle } from './gm';
import { markStarsLayout, unmarkStarsLayout } from './dom';
import { isDesktop } from './utils';

let persistentStyleEl: HTMLStyleElement | null = null;
let layoutStyleEl: HTMLStyleElement | null = null;

/**
 * 幂等注入。窄视口（<768px）**不注入任何样式**（D18）：CSS 全都在媒体查询里、本来也不生效，
 * 但注入本身会在页面上留下两个 `<style>` 节点（且 persistent 那张从不移除）—— 正是要消掉的「残次内容」。
 */
export function ensureLayoutStyles(): void {
  if (!isDesktop()) return;
  if (!persistentStyleEl || !persistentStyleEl.isConnected) {
    persistentStyleEl = gmAddStyle(persistentCss);
  }
  if (!layoutStyleEl || !layoutStyleEl.isConnected) {
    layoutStyleEl = gmAddStyle(baseCss + '\n' + wideCss);
  }
  // 标记「承载 stars 内容的那个布局」：布局规则（侧栏 180px / 三栏轨道 / 头像尺寸）**只认这个标记**，
  // 见 constants.STARS_LAYOUT_CLASS。注入与标记同处一个同步任务 ⇒ 中间不会有一帧「表在但规则不生效」。
  // 必须留在 `!isDesktop()` 的早退**之后**：窄视口连 class 都不许留（D18 的「零痕迹」含 class）。
  markStarsLayout();
}

/** 撤掉布局主表（幂等）。persistent 表按设计保留。 */
export function removeLayoutStyles(): void {
  layoutStyleEl?.remove();
  layoutStyleEl = null;
  // 表撤了，标记也必须是空的：留着它，之后若有别的样式表（或另一个实例）按此选择器写字，
  // 就会作用到一个「理论上已退出」的布局上。
  unmarkStarsLayout();
}
