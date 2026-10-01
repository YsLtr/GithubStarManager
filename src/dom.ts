import { STORAGE_KEYS } from './constants';
import { gmGet } from './gm';

/** 当前页面仓库数字 ID 的 meta 标签（仅仓库详情页存在） */
export function getRepoIdMeta(): HTMLMetaElement | null {
  return document.querySelector('meta[name="octolytics-dimension-repository_id"]');
}

/* 4.8.0：isStarredInToggler / getToggler（旧版详情页 star toggler 探测）已随 extract.ts 一并删除，
 * 唯一消费者是详情页缓存提取。 */

/* ================================================================
 * Stars 页：仓库条目与筛选行
 *
 * GitHub 2026 改版把 Primer 工具类从 `py-4` 换成了 `tmp-py-4`，并新增了
 * `color-border-muted`。原来写死整串类名的选择器会整体失配（命中数 0），
 * 所以这里改成「结构特征 + 语义属性」定位，不再依赖工具类名列表。
 * ================================================================ */

/** 仓库列表主列（turbo-frame 内的 col-lg-9） */
export function getStarsMainColumn(): HTMLElement | null {
  const frame = document.getElementById('user-starred-repos');
  if (!frame) return null;
  return frame.querySelector<HTMLElement>('.col-lg-9') ||
    frame.querySelector<HTMLElement>('div[class*="col-lg-9"]');
}

/** 排掉我们自己生成的卡片和已隐藏的原始条目 */
function isRepoItem(el: HTMLElement): boolean {
  return !el.classList.contains('stars-original-hidden') &&
    !el.classList.contains('stars-grid-card') &&
    !el.classList.contains('stars-grid-card-cached');
}

/**
 * 取出仓库条目列表。
 *
 * 首选结构特征：条目本身是 meta 行（`div.f6.color-fg-muted`）的直接父元素 ——
 * 这个特征不随工具类改名而失效，也不会误命中条目内部的嵌套 div。
 * 退路是旧/新两代类名都还保留的 `col-12` + `border-bottom`。
 */
export function getRepoItems(container: ParentNode): HTMLElement[] {
  const selectors = [
    'div:has(> div.f6.color-fg-muted)',
    'div[class*="col-12"][class*="border-bottom"]',
  ];
  for (const sel of selectors) {
    let found: HTMLElement[];
    try {
      found = Array.from(container.querySelectorAll<HTMLElement>(sel));
    } catch {
      continue;  // 浏览器不支持 :has() → 试下一个
    }
    const items = found.filter(isRepoItem);
    if (items.length > 0) return items;
  }
  return [];
}


/**
 * 原生筛选按钮（Type / Language / Sort）所在的那一行。
 *
 * 以 Language 按钮的 ID 为锚点向上找 —— 该 ID 在改版中保留了下来，
 * 而它的外层容器类名（`mt-5` → `tmp-mt-5`）已经变过一轮。
 */
export function getNativeFilterRow(): HTMLElement | null {
  const langBtn = document.getElementById('stars-language-filter-menu-button');
  const row = langBtn ? langBtn.closest('div.d-flex') : null;
  if (row instanceof HTMLElement) return row;

  return document.querySelector<HTMLElement>(
    '.Layout-main .d-flex.flex-column.flex-lg-row.flex-items-center.tmp-mt-5 .d-flex.flex-justify-end,' +
    '.Layout-main .d-flex.flex-column.flex-lg-row.flex-items-center.mt-5 .d-flex.flex-justify-end'
  );
}


/** 原生「Clear filter」信息条（只在原生筛选生效时存在） */
export function getNativeFilterBar(container: ParentNode): HTMLElement | null {
  const bar = container.querySelector<HTMLElement>('.TableObject.border-bottom:not(.stars-tag-info-bar)');
  if (bar) return bar;
  const reset = container.querySelector('.issues-reset-query');
  const viaReset = reset ? reset.closest('.TableObject') : null;
  return viaReset instanceof HTMLElement ? viaReset : null;
}

/* ================================================================
 * Stars 页：隐藏与卡片网格无关的原生区块
 * ================================================================ */

/** 打上这个类就会被隐藏（对应 styles/base.css 第 4 节） */
export const LISTS_HIDDEN_CLASS = 'stars-lists-hidden';

/**
 * Hide Lists 开关读取（4.5.0）：TM 菜单「隐藏 Lists 区块」的持久偏好。
 * 默认 true = 隐藏（4.4.0 及之前的一贯行为）；false = Lists 原生内容正常显示。
 * document-start 也会读（gm 不可用时走 localStorage 镜像兜底，gmSet 双写保证镜像最新）。
 */
export function isHideListsEnabled(): boolean {
  return gmGet(STORAGE_KEYS.hideLists, true);
}

/** 把 Lists 隐藏 CSS 规则的门控类挂/摘到 <html> 上（document-start 与菜单切换共用） */
export function applyHideListsGate(): void {
  document.documentElement.classList.toggle('gsm-hide-lists', isHideListsEnabled());
}

/** 清除此前 hideListsSection 打的隐藏标记（4.5.0 运行中从开切到关时让 Lists 立即显形） */
export function clearListsHiddenMarks(): void {
  document.querySelectorAll<HTMLElement>('.stars-lists-hidden').forEach((el) => {
    el.classList.remove(LISTS_HIDDEN_CLASS);
    // 内联 display 只可能由 hideListsSection 设置（带标记的节点才走到这），一并摘除
    el.style.removeProperty('display');
  });
}

/**
 * 隐藏 Stars 页的 Lists 区块（标题行 + 内容区 + 空态 blankslate）。
 *
 * 两个坑：
 * 1. 标题行容器类名已从 `my-3` 变成 `tmp-my-3`（2026 改版给间距工具类加了 `tmp-` 前缀），
 *    所以定位用「h2.f3-light + 文案含 Lists」这个语义特征，不依赖工具类名；
 * 2. 标题行带 `d-flex`，GitHub 的 `.d-flex { display: flex !important }` 会压过内联
 *    `display:none` —— 内联样式必须带 important，否则设了等于没设（真机验证过）。
 *
 * 幂等，可重复调用（turbo-frame 重渲染后需要再调一次）。4.5.0 起受 Hide Lists 开关控制：
 * 关闭时改由 clearListsHiddenMarks() 清理残留标记（两个既有调用点无需感知开关）。
 */
export function hideListsSection(): void {
  if (!isHideListsEnabled()) {
    // 4.5.0 开关关闭：不打隐藏标记，并清掉此前残留的标记（运行中切换 / turbo 重渲染均幂等）
    clearListsHiddenMarks();
    return;
  }
  const frame = document.getElementById('user-profile-frame');
  const wrapper = frame ? frame.firstElementChild : null;
  if (!wrapper) return;

  Array.from(wrapper.children).forEach((child) => {
    if (!(child instanceof HTMLElement)) return;

    const heading = child.querySelector('h2.f3-light');
    const isListsRow = !!heading && (heading.textContent || '').includes('Lists');
    // 0 个 list 时空态 blankslate（「Create your first list」）也是 wrapper 的直接子节点
    const isListsEmpty = child.classList.contains('blankslate');
    if (!isListsRow && !isListsEmpty && child.id !== 'profile-lists-container') return;

    child.classList.add(LISTS_HIDDEN_CLASS);
    child.style.setProperty('display', 'none', 'important');
  });
}

/* ================================================================
 * 仓库详情页：4.9.0 起本模块**不再**提供任何详情页 star 按钮读取器
 * （getStarButton / isStarButtonActive 已随决策 D17 删除 —— 星状态真相只由整表同步判定，
 * 详情页不再触碰 GitHub 拥有的按钮 DOM）。
 *
 * 内嵌 JSON 提取（readEmbeddedJson / getSidebarAbout / SidebarAboutPayload）已随
 * extract.ts 删除——它服务详情页缓存提取，现无消费者。
 * ================================================================ */
