import { isStarsPage } from './boot';
import { renderBrowsePage } from './filters';
import { filterState } from './state';
import { isDesktop } from './utils';

/**
 * 本地翻页拦截（4.0.0；4.4.0 起筛选态同样分页）：点 Previous/Next 直接切本地缓存页，
 * 零网络、零 Turbo、零闪烁。
 *
 * - 链接是我们自造的 `a[data-gsm-page]`（顶/底两份都是克隆件），window 捕获阶段拦截
 *   （document-start 注册，先于 Turbo 一切 document 监听；`stopImmediatePropagation`
 *   一处干掉 Turbo 与本脚本其他 click 监听），`preventDefault` 同时挡住 `href="#"` 跳顶；
 * - 不 pushState：地址栏保持 ?tab=stars（与原生 frame 翻页不改地址栏一致）；
 * - 渲染是同步的（缓存切片 + 卡片重建 <30ms），无需 spinner / 防连点标志；
 * - browse 与筛选态（tags/langs/types/search）统一走 renderBrowsePage——Public/Sources
 *   这类大集合筛选不再一次平铺全部结果卡，翻页保持筛选与信息条、只换页（4.4.0）；
 * - 中键/Ctrl/Shift/Alt 不拦截（保持浏览器原生多标签语义）。
 */
export function interceptPagination(): void {
  window.addEventListener(
    'click',
    (e) => {
      if (e.defaultPrevented) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (!isDesktop() || !isStarsPage()) return;

      const t = e.target instanceof Element ? e.target : null;
      if (!t) return;
      const link = t.closest<HTMLAnchorElement>('a[data-gsm-page]');
      if (!link) return;

      e.preventDefault();
      e.stopImmediatePropagation();

      // 4.4.0：筛选态不再藏分页器，翻页同样放行（保持筛选只换页）
      const target = link.dataset.gsmPage || '';
      const cur = filterState.page || 1;
      const total = filterState.totalPages || 1;
      let page: number;
      if (target === 'prev') page = cur - 1;
      else if (target === 'next') page = cur + 1;
      else page = Number.parseInt(target, 10);
      if (!Number.isFinite(page) || page < 1 || page > total || page === cur) return;

      renderBrowsePage(page);
    },
    { capture: true, passive: false }
  );
}
