/**
 * 「Starred repositories / Stars」标题行右侧的顶部快捷翻页器（4.13.0 抽出，供两条展示路径共用）。
 *
 * 为什么共用：分页器在页面**底部**，翻到一半想翻页必须滚到底。两条路径都要在标题行右侧放一份，
 * 但数据源不同：
 *   - 本方自己的页：克隆脚本自造的**本地分页器**（`.gsm-local-pager`，页码来自缓存，由
 *     `updateLocalPagers()` 随渲染更新）；
 *   - 他人页只读网格：克隆 GitHub **原生分页器**（`after`/`before` 游标链接，翻页交给 GitHub 自己）。
 *
 * 两条都只做 `cloneNode(true)` + 挂到标题行，因此：
 *   - 克隆件**不带事件监听**（cloneNode 不复制监听），原生那份的交互不受影响；
 *   - 原生 href / 文字原样保留 ⇒ 点克隆件与点底部那份行为一致。
 *
 * 节律与回滚：克隆件一律带 `.gsm-top-pager` 类，标题行一律加 `.gsm-header-row`（flex 两端对齐，
 * GitHub 原生没有这个类）；两者都在 `viewTeardown` 的回滚清单里（第 2 项删节点、第 4 项摘类）。
 */
import { isDesktop } from './utils';

/** 标题行里那份克隆件的类名（回滚按它删节点） */
export const TOP_PAGER_CLASS = 'gsm-top-pager';

/**
 * 把 `source` 克隆一份挂到 `scope` 内标题行（`h2.f3-light` 的父节点）的右侧。
 *
 * @param scope  含标题行的作用域（本方页 = `.col-lg-9`；他人页 = 投影作用域）
 * @param source 被克隆的分页器（本方页 = 本地分页器；他人页 = 原生 `.paginate-container`）
 * @returns 被加上 `gsm-header-row` 的标题行；缺 source / 标题行时返回 null（调用方无需重试）
 */
export function mountTopPager(scope: ParentNode, source: HTMLElement | null): HTMLElement | null {
  // 窄视口不建任何节点（D18）
  if (!isDesktop()) return null;
  const h2 = scope.querySelector<HTMLElement>('h2.f3-light');
  const row = h2?.parentElement;
  if (!source || !row || !h2) return null;

  row.classList.add('gsm-header-row');
  // 幂等：Turbo 重渲染 / 重复进入时先摘掉旧克隆件，避免越积越多
  row.querySelector<HTMLElement>(`.${TOP_PAGER_CLASS}`)?.remove();

  const top = source.cloneNode(true) as HTMLElement;
  top.classList.add(TOP_PAGER_CLASS);
  // 原生分页器里可能带 id / aria 唯一性属性，克隆件要摘掉以免页面出现重复 id
  top.removeAttribute('id');
  top.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));

  // 竖向对齐到同一行里的**筛选控件**（4.13.0 真机修正）。
  // 新版页面把 GitHub 自己的筛选栏塞进了标题行，那个包装节点自带上下**不等**的
  // 外边距（`tmp-mt-3 mb-n1` = 上 16px、下 −4px）。本行是 `align-items: center`，
  // flex 对齐的是**外边距盒** ⇒ 包装节点因此整体下移 (16 − (−4)) / 2 = 10px，
  // 而克隆件没有这些外边距，于是比筛选控件高出 10px（真机实测：克隆件 y156，
  // 筛选控件 y166）。把兄弟节点的计算外边距原样抄到克隆件上 ⇒ 两者外边距盒等高
  // 同中心 ⇒ 可视盒精确对齐，且不碰 GitHub 自己的节点。
  // 只写**我们自己的节点**内联样式，回滚随节点一起消失，不需要 data 标记；
  // 旧版页面标题行里只有 h2（无筛选栏）⇒ 找不到兄弟节点，保持纯居中，行为不变。
  const ref = Array.from(row.children).find(
    (el): el is HTMLElement => el instanceof HTMLElement && el !== h2,
  );
  if (ref) {
    const cs = getComputedStyle(ref);
    top.style.marginTop = cs.marginTop;
    top.style.marginBottom = cs.marginBottom;
  }
  row.appendChild(top);
  return row;
}
