import { isStarsPage } from './boot';
import { transformStarsList } from './transform';
import { isDesktop } from './utils';

/** 翻页进行中：防连点（拦截已发生，重复点击直接吞掉） */
let pagingInFlight = false;

/**
 * 原地翻页拦截：点分页 Next/Prev/页码时不走 Turbo frame 导航，
 * 自己 fetch 新页 HTML、把 frame 内容原地换掉再重建网格。
 *
 * 为什么不用默认路径：Turbo frame 导航会先触发 `turbo:before-frame-render`，
 * 我们在那里给 frame 挂 `gsm-turbo-hidden`（整块藏住）+ 播入场动画 →
 * 网络往返期间列表空白、到达后淡入 = 用户看到的「闪一下」。
 * 原地替换则旧内容一直可见，新数据到达才一次性换入，且不触发任何 turbo 事件。
 *
 * 关键点：
 * - 注册在 **window 捕获阶段**且必须在 document-start 执行（先于页面所有脚本），
 *   `stopImmediatePropagation` 一处干掉 Turbo 的 click 监听（无论它挂 document
 *   捕获/冒泡）与本脚本其它 click 监听（starsNavPending 不被误置位）；
 * - 不解析分页参数（游标值不固定）：直接取链接 `href` 去 fetch；
 * - 不 pushState：原生 frame 翻页不改地址栏（链接无 data-turbo-action），
 *   地址栏保持 ?tab=stars，与原生行为一致；
 * - 中键/Ctrl/Shift 点击（新标签打开）不拦截，交给浏览器。
 *
 * 失败（网络/结构失配）回落 `location.href` 整页导航，绝不卡死。
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
      const link = t.closest<HTMLAnchorElement>('a');
      // 只拦 Stars frame 内分页器上的链接（原生隐藏份 + 我们克隆进网格的那份）
      if (!link || !link.closest('.paginate-container')) return;
      const frame = document.getElementById('user-starred-repos');
      const href = link.getAttribute('href');
      if (!frame || !frame.contains(link) || !href) return;

      e.preventDefault();
      e.stopImmediatePropagation();
      if (pagingInFlight) return;
      void swapPageInPlace(frame, href, link);
    },
    { capture: true, passive: false }
  );
}

/** fetch 新页 → 原地换入 frame → 重建网格；任一步失败回落整页导航。 */
/** fetch 新页 → 原地换入 frame → 重建网格；任一步失败回落整页导航。期间 sourceLink 内转圈。 */
async function swapPageInPlace(frame: HTMLElement, href: string, sourceLink: HTMLAnchorElement): Promise<void> {
  pagingInFlight = true;
  // Primer loading 态规范：按钮内转圈 + 文字透明占位（宽度不变、无布局跳动）+ aria-busy
  sourceLink.classList.add('gsm-pager-loading');
  sourceLink.setAttribute('aria-busy', 'true');
  try {
    const url = new URL(href, location.href).href;
    const resp = await fetch(url, { credentials: 'same-origin' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const doc = new DOMParser().parseFromString(await resp.text(), 'text/html');
    const newFrame = doc.getElementById('user-starred-repos');
    const newCol = newFrame && newFrame.querySelector('.col-lg-9');
    if (!newFrame || !newCol) throw new Error('响应缺少 Stars frame 内容');

    // 原地换入：这一刻旧内容才被替换，全程无隐藏 = 无闪动。
    // 不动 frame[src]：Turbo 监听 src 属性变化会触发二次加载（再闪一次）。
    frame.innerHTML = newFrame.innerHTML;

    // 新内容是服务端原始 HTML（无 .stars-grid-container）→ transform 走完整重建：
    // 提取缓存、标签、备注、分页器克隆、右栏搬运、筛选栏与 applyFilters 全部重来。
    if (!transformStarsList()) throw new Error('新内容转换失败');
    console.log('[github-stars-grid] 原地翻页完成:', url);
  } catch (err) {
    console.error('[github-stars-grid] 原地翻页失败，回落整页导航:', err);
    location.href = href;
  } finally {
    // 换入成功时 transform 已整块重建 DOM（此节点多半已脱离文档，remove 无害）
    sourceLink.classList.remove('gsm-pager-loading');
    sourceLink.removeAttribute('aria-busy');
    pagingInFlight = false;
  }
}
