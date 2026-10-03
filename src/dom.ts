import { GSM_HIDDEN_ATTR, GSM_TOPICS_SRC_ATTR, STARS_LAYOUT_CLASS, STORAGE_KEYS } from './constants';

/* ---------------- 原生节点的隐藏/还原 ----------------
 * 我们对 GitHub 原生节点只做「藏起来」这一种写入。写下时必须同时打 GSM_HIDDEN_ATTR 标记：
 * 回滚（窄视口收窄 / 离开页面）靠标记逐个还原 —— 裸的 inline display 无法与 GitHub
 * 自己的样式区分，猜错就是直接改坏别人的页面（见 viewTeardown.ts 的铁律）。
 * 还原用 removeProperty 而不是赋空串：不留 `style=""` 残迹。
 * 4.13.0：从 filters.ts 上移到本模块（他人页视图也要隐藏原生条目，避免两个模块各写一份）。 */
export function hideNativeNode(el: HTMLElement): void {
  // 必须带 !important：GitHub 原生条目挂着 Primer utility 类（`col-12 d-block width-full`），
  // 而 `.d-block{display:block!important}` 会**压过**不带 important 的 inline display:none
  // —— 真机实测（/mattn?tab=stars）：30 个条目的标记与 inline style 全都写对了，computed 仍是 block，
  // 于是网格插在上方、原生列表原样跟在下面，看起来就像「脚本没生效」。
  // 无 important 也能生效的场合（原生筛选菜单等）不依赖这一点，故本函数一律加重要级。
  el.style.setProperty('display', 'none', 'important');
  el.setAttribute(GSM_HIDDEN_ATTR, '1');
}

export function showNativeNode(el: HTMLElement): void {
  el.style.removeProperty('display');
  el.removeAttribute(GSM_HIDDEN_ATTR);
}
/* ---------------- Starred topics 列的搬运 / 归还 ----------------
 * 4.13.0 从 transform.ts 上移到本模块：**两条展示路径**（自己的页、他人的页）都要把原生
 * `.col-lg-3` 里的 topics 搬进脚本右栏，回滚（viewTeardown 第 1 项）与退出他人页视图都要还回去 ——
 * 三处各写一份必然漂移（首版就是只在自己的页里写了，他人页搬不进去）。
 *
 * 搬运会留下**出处痕迹** `GSM_TOPICS_SRC_ATTR`：teardown 只把内容还回**打了这个标记的那个** `.col-lg-3`。
 * 单靠 `isConnected` 不够 —— Turbo 原位重渲染 `#user-starred-repos` 后会换出一个**新的** `.col-lg-3`
 * （内含 GitHub 自己渲染好的 topics），此时把右栏里的陈旧内容倒进去就是重复的 topics。
 * 新节点的标记是我们清掉的（或从未有过），所以 teardown 见到无标记就直接丢弃右栏内容 —— 那正是对的。
 *
 * ## 右栏必须挂在**装得下 stars 内容**的那个 `.Layout` 上（4.13.0 真机事故）
 *
 * **页面上的 `.Layout.Layout--sidebarPosition-start` 可能不止一个**：登出的 profile 页有两个 ——
 * 第 0 个是**页头**（左栏头像 + 右栏标签栏，实测 y96 / 高 192），第 1 个才是**内容**布局
 * （y289 / 高 2320，`#user-starred-repos` 在它里面）。所以**不能**用 `document.querySelector`
 * 取「文档里第一个」—— 那会把 topics 塞进页头的右栏，观感就是「Starred topics 跑到 header 上去了」。
 * 口径：从**被搬走的那一列自己**往上找最近的 `.Layout`（`closest`），它必然是内容布局。
 * 找不到就**不搬**（宁可不搬也不搬错位置）—— 配套地，隐藏原生列的 CSS 只在搬成功后生效
 * （见 base.css 里带 `[data-gsm-topics-src]` 的那条选择器），所以搬不动时原生列照常显示 topics。
 */

/* ---------------- stars 内容所属布局的标记（4.13.0，见 constants.STARS_LAYOUT_CLASS） ----------------
 * 布局样式表只许作用于**承载我们网格的那个 `.Layout`**。找法见 findStarsLayout：从「我们一定会插进去的
 * 那个位置」往上 `closest` —— 绝不用 `document.querySelector('.Layout--sidebarPosition-start')`
 * （登出页的第一个是页头，真机事故：topics 被塞进页头右栏）。找不到就**不标记**，
 * 于是布局接管整体不生效（GitHub 原生布局原样保留）—— 失败方向是「少做」而不是「改错别人的页面」。 */

/** 承载 stars 内容的那个 `.Layout`；找不到返回 null。
 *
 * 锚点只需两跳（曾写四跳，后两跳经核对**不可达**，按 D21 删除）：
 *   · `getStarsMainColumn()` 以 frame 为**前提**（`#user-starred-repos` 里找 `.col-lg-9`）
 *     ⇒ frame 在则上一跳已返回、frame 不在则它必为 null；
 *   · `getRepoItems(document.body)` 只匹配 profile 标签页那种 `div` 条目，而唯一没有 frame 的
 *     `/stars/{login}` 用的是 `ul.repo-list > li`，且该路由真机 `.Layout` 数为 0 ⇒ 也标不上。
 */
function findStarsLayout(): HTMLElement | null {
  const anchor =
    document.querySelector<HTMLElement>('.stars-grid-container') ??   // 网格已建（最终答案）
    document.getElementById('user-starred-repos');                    // `?tab=stars` 两代骨架都有它
  return anchor?.closest<HTMLElement>('.Layout') ?? null;
}

/** 给承载 stars 内容的布局打标记（幂等）。找不到布局就**不标记** ⇒ 布局规则整体不生效（原生布局原样保留）。 */
export function markStarsLayout(): void {
  const layout = findStarsLayout();
  if (layout && !layout.classList.contains(STARS_LAYOUT_CLASS)) layout.classList.add(STARS_LAYOUT_CLASS);
}

/** 摘掉标记（幂等）。布局样式表撤除时必须同步调用，否则残留 class 会继续满足样式表的选择器。 */
export function unmarkStarsLayout(): void {
  document.querySelectorAll(`.${STARS_LAYOUT_CLASS}`).forEach((el) => el.classList.remove(STARS_LAYOUT_CLASS));
}

/** 把 `#user-starred-repos .col-lg-3` 的整棵子树搬进 `.stars-right-sidebar`。返回是否搬过。 */
export function moveTopicsToRightSidebar(): boolean {
  const colLg3 = document.querySelector<HTMLElement>('#user-starred-repos .col-lg-3');
  if (!colLg3) return false;
  // 归宿 = **`findStarsLayout()` 标记的那个布局**（复用它，不再自己写一遍骨架选择器）：
  // 两个调用点（transform.ts 自己的页、otherStarsView.ts 他人页）都在网格插入**之后**才搬，
  // 所以 findStarsLayout 的锚点必然命中同一个布局 ⇒ 与旧写法等价，且语义更直白：
  // 「我们标记的布局，就是右栏该去的地方」（标记与右栏不可能分家）。找不到布局就**不搬**。
  const layoutEl = findStarsLayout();
  if (!layoutEl) return false;

  let rightSidebar = layoutEl.querySelector<HTMLElement>('.stars-right-sidebar');
  if (!rightSidebar) {
    rightSidebar = document.createElement('div');
    rightSidebar.className = 'stars-right-sidebar';
    layoutEl.appendChild(rightSidebar);
  }
  rightSidebar.innerHTML = '';
  while (colLg3.firstChild) rightSidebar.appendChild(colLg3.firstChild);
  colLg3.setAttribute(GSM_TOPICS_SRC_ATTR, '1');
  return true;
}

/**
 * 归还 topics 并移除右栏。幂等，可重复调用。
 * 见到**无标记**的 `.col-lg-3`（Turbo 换进来的新节点）时宁可不还原，也不把陈旧内容塞进别人的原生列。
 */
export function restoreTopicsFromRightSidebar(): void {
  // `.stars-right-sidebar` 由本模块创建、全文档唯一，故这里可以用 document 级查询：
  // 目的就是「无论如何都收干净」（哪怕上一版曾把它误建在页头布局里）。
  const rightSidebar = document.querySelector<HTMLElement>('.stars-right-sidebar');
  if (!rightSidebar) return;
  const colLg3 = document.querySelector<HTMLElement>(
    `#user-starred-repos .col-lg-3[${GSM_TOPICS_SRC_ATTR}]`,
  );
  if (colLg3 && colLg3.isConnected) {
    while (rightSidebar.firstChild) colLg3.appendChild(rightSidebar.firstChild);
    colLg3.removeAttribute(GSM_TOPICS_SRC_ATTR);
  }
  rightSidebar.remove();
}

import { gmGet } from './gm';
import { isDesktop } from './utils';

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
  return frame.querySelector<HTMLElement>('.col-lg-9');
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

  // 4.9.1：原来这里还有一条「两代工具类名（mt-5 / tmp-mt-5）都写进选择器」的长链兜底，
  // 已删除 —— 它从未有过命中记录，而 Language 按钮 ID 在改版中一直保留。改版时按
  // 「结构特征 + 语义属性」重新锚定即可（本文件的通用原则）。
  return null;
}


/** 原生「Clear filter」信息条（只在原生筛选生效时存在） */
export function getNativeFilterBar(container: ParentNode): HTMLElement | null {
  const bar = container.querySelector<HTMLElement>('.TableObject.border-bottom:not(.stars-tag-info-bar)');
  if (bar) return bar;
  // 4.9.1：原来还有一条「.issues-reset-query → closest('.TableObject')」的回溯兜底，已删除
  // （无命中记录）。注意 index.ts 里拦截原生 Clear filter 点击用的仍是 `.issues-reset-query`
  // 类名本身 —— 那是 GitHub 原生节点上的类，与本函数无关。
  return null;
}

/* ================================================================
 * Stars 页：隐藏与卡片网格无关的原生区块
 * ================================================================ */

/** 打上这个类就会被隐藏（对应 styles/base.css 第 4 节） */
const LISTS_HIDDEN_CLASS = 'stars-lists-hidden';

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
  // 窄视口不挂门控类（4.9.1）：规则本身在媒体查询里不生效，但类实打实留在 <html> 上，
  // 属于"脚本在手机上留下的痕迹"。回到桌面视图时 ensureStarsSetup() 会重新调用本函数。
  document.documentElement.classList.toggle('gsm-hide-lists', isDesktop() && isHideListsEnabled());
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
  // 窄视口（4.9.1）：一行都不该动 GitHub 的 DOM。这里必须显式清残留 —— 从桌面收窄过来时，
  // 之前写下的**内联** display:none !important 不受媒体查询门控，会一直让 Lists 消失。
  if (!isDesktop()) {
    clearListsHiddenMarks();
    return;
  }
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
