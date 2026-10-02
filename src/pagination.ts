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

      // 跳页入口（4.10.0）：点击页码指示器 → 同一单元格内原位换成输入框。
      // 必须排在链接判定之前：按钮不在 `a[data-gsm-page]` 里，两者互不干扰。
      const info = t.closest<HTMLElement>('button.gsm-page-info');
      if (info) {
        e.preventDefault();
        e.stopImmediatePropagation();
        enterPageInput(info);
        return;
      }

      // 4.10.0 起这里同时管两件事：翻页链接与「点击页码跳页」。两者都只调
      // navigateToLocalPage —— 校验口径只有一份，不再各写一套夹取规则。
      const link = t.closest<HTMLAnchorElement>('a[data-gsm-page]');
      if (!link) return;

      e.preventDefault();
      e.stopImmediatePropagation();

      // 4.4.0：筛选态不再藏分页器，翻页同样放行（保持筛选只换页）
      const target = link.dataset.gsmPage || '';
      const cur = filterState.page || 1;
      if (target === 'prev') navigateToLocalPage(cur - 1);
      else if (target === 'next') navigateToLocalPage(cur + 1);
      else navigateToLocalPage(target);
    },
    { capture: true, passive: false }
  );
}

/**
 * 本地跳页的**唯一提交口径**（4.10.0）：Previous/Next 链接与页码输入框都只走这里。
 *
 * 为什么必须收口：`renderBrowsePage()` 自己对 `NaN` 没有守卫（`Math.min/max` 会把 NaN
 * 一路传进 `filterState.page`），而远端 `?page=N` 越界是**静默返回空结果**（GitHub 不报 404），
 * 所以「数字合法性 + 夹取 + 同页早退」只能由本地兜住，且绝不能有两个入口各写一份。
 *
 * 语义（与 4.0.0 以来的静默口径一致，不弹任何提示）：
 * - 非数字 / 空 / 纯空白 → 不跳（返回 false，输入态自行退回文本）；
 * - 数字越界 → 夹取到 [1, totalPages]（`0`/`-1` → 第 1 页，`999` → 末页）；
 * - 夹取后与当前页相同 → 不重绘（返回 false），避免无谓的整页卡片重建。
 *
 * @returns 是否真的发生了翻页
 */
function navigateToLocalPage(raw: unknown): boolean {
  const total = filterState.totalPages || 1;
  const page = clampPageNumber(raw, total);
  if (page === null || page === (filterState.page || 1)) return false;
  renderBrowsePage(page);
  return true;
}

/** 把任意输入折成一个合法页码；非数字返回 null（表示「不跳」而不是「跳到第 1 页」） */
function clampPageNumber(raw: unknown, total: number): number | null {
  let n: number;
  if (typeof raw === 'number') {
    n = raw;
  } else {
    const s = String(raw ?? '').trim();
    // 允许前导负号（`-1` 属「越界」而非「非数字」→ 由下面的夹取落到第 1 页）
    if (!/^-?\d+$/.test(s)) return null;
    n = Number.parseInt(s, 10);
  }
  // 只否掉 NaN：超长数字串会被 parseInt 折成 ±Infinity，那是**越界**，应夹取到边界
  // 而不是当成非法输入退回（否则「越界夹取」的文案在极端输入下不成立）。
  if (Number.isNaN(n)) return null;
  const page = Math.trunc(n);
  if (page < 1) return 1;
  if (page > total) return total;
  return page;
}

/**
 * 页码输入态（4.10.0）：点击页码指示器后，**同一单元格内原位**换成输入框。
 *
 * 为什么不用 popover / 浮层：顶部分页器是 `cloneNode(true)` 的克隆件，
 * `popovertarget` / `anchored-position` 需要 document 级唯一 id 与锚点，克隆会把
 * id 一起复制；原生 Popover API 又属 Baseline 2024（Safari 17+），超出本脚本
 * safari15 的目标面。
 *
 * 为什么监听写在这里、由委托调用：克隆不复制事件监听，任何挂在节点上的监听在顶部
 * 那份上都不存在。输入框本身是**瞬态**节点，监听随它一起消失，因此既不需要
 * lifecycle 作用域，也不留下任何需要回滚的痕迹。
 *
 * 语义（D20）：Enter 提交 / Escape 取消 / 失焦提交（与 ui/notes.ts 的备注编辑同一口径）；
 * 非数字、或夹取后等于当前页 → 不跳、静默退回文本态，不弹任何提示。
 */
function enterPageInput(cell: HTMLElement): void {
  const parent = cell.parentElement;
  if (!parent || parent.querySelector('.gsm-page-input')) return; // 已在编辑态

  const total = filterState.totalPages || 1;
  const cur = filterState.page || 1;

  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'numeric'; // 不用 type=number：spinbutton 语义 + 方向键会意外改值
  input.className = 'btn BtnGroup-item gsm-page-input';
  input.value = String(cur);
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.setAttribute('pattern', '[0-9]*');
  input.setAttribute('enterkeyhint', 'go');
  input.setAttribute('aria-label', `输入页码后回车跳转（共 ${total} 页）`);
  // 与按钮**同宽同高**：按被顶替单元格的实测几何与字体度量写死内联值（含 border-box），
  // 否则输入框比内容驱动的按钮宽/窄一截、高矮一截，整条分页器会跳动。
  // `input` 不继承父级字体（浏览器默认表单控件用系统字体），所以字号/行高必须显式抄过来。
  const rect = cell.getBoundingClientRect();
  const cs = getComputedStyle(cell);
  input.style.boxSizing = 'border-box';
  input.style.width = `${Math.round(rect.width)}px`;
  input.style.fontFamily = cs.fontFamily;
  input.style.fontSize = cs.fontSize;
  input.style.fontWeight = cs.fontWeight;
  input.style.lineHeight = cs.lineHeight;

  cell.replaceWith(input);
  input.focus();
  input.select();

  let settled = false;
  const finish = (commit: boolean): void => {
    if (settled) return;
    settled = true;
    // 先恢复文本态、再跳页：页码文字由 updateLocalPagers 在 renderBrowsePage 末尾重写，
    // 若反序（先跳页后还原），还原出来的按钮会带着**旧页码**直到下一次渲染。
    // 输入框可能已被 Turbo 重渲染摘掉，此时不必（也不能）还原。
    if (input.isConnected) {
      input.replaceWith(cell);
      // 编辑期间可能发生过渲染（页码与总页数都可能已变），按**当前**状态重写单元格文字；
      // Escape 取消不触发渲染，若不管这里，按钮会带着进入编辑态那一刻的旧页码。
      cell.textContent = `${filterState.page || 1} / ${filterState.totalPages || 1}`;
      // 焦点还给单元格（研究结论：关闭输入后不还焦点 = 键盘用户被丢回页面开头）。
      // preventScroll：还原不该让页面跳动。
      cell.focus({ preventScroll: true });
    }
    if (commit) navigateToLocalPage(input.value);
  };

  input.addEventListener('keydown', (ev) => {
    // IME 组成中的回车不是「提交」（手写 keydown 必须自己处理这一步）
    if (ev.isComposing) return;
    if (ev.key === 'Enter') {
      ev.preventDefault();
      finish(true);
      return;
    }
    if (ev.key === 'Escape') {
      // 不让 Escape 冒泡：Turbo 与页面自身也有 Escape 处理
      ev.preventDefault();
      ev.stopPropagation();
      finish(false);
    }
  });
  // 失焦即提交；点击 Previous/Next 时 blur 先于 click —— 先按输入值跳页，
  // 再由链接在**新的**页码上继续 prev/next。
  //
  // 但 blur **不都是**用户提交意图：renderBrowsePage 会先 remove() 底部那份分页器再
  // appendChild 插回（filters.ts），而「移除含焦点的子树」本身就触发 blur —— 那一刻若
  // 同步提交，就会在渲染过程**内部**嵌套再调一次 renderBrowsePage：外层用自己早算好的
  // start 覆盖网格、内层改过的 filterState.page 只留在页码文字上 ⇒「文字第 2 页、内容第 1 页」。
  // （进页自动同步、同步后重渲染、导入后的 applyFilters 都会走到这条路径，与用户无关。）
  // 所以延后一拍再判：仍在文档里 = 真失焦 → 提交；已被摘掉 = 外层渲染接管，静默作废。
  input.addEventListener('blur', () => {
    queueMicrotask(() => {
      if (input.isConnected) finish(true);
    });
  });
}
