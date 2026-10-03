/**
 * 他人 star 页的**零网络只读网格**（4.13.0）。
 *
 * ## 硬约束：不发任何请求
 *
 * 数据只来自**页面上已经渲染好的原生条目**（`domRepos.collectPageRepos` 的一次投影），
 * 不调 API、不预取、不做条件请求、不落盘。见 `docs/plans/` 的零网络方案与 AGENTS.md D29。
 * 因此本模块**不**碰：`fullSync`（同步）、`accountGuard`（归属校验）、`langColors.initLangColors`
 * （语言色请求）、`search.interceptSearchForm`（原生搜索拦截）、`applyFilters`（它会往原生筛选行
 * 插脚本控件，而 V2 明确「不挂脚本筛选栏」）、`mountSyncButton`、配置/归属横幅。
 *
 * ## 接管边界（V5 / D6）
 *
 * - 只隐藏**原生条目**（经 `hideNativeNode` 打 `GSM_HIDDEN_ATTR`，由 `viewTeardown` 统一还原）；
 * - 原生**分页器**、原生**筛选栏**、Lists 区块一律不动 —— 翻页是对齐 GitHub 自己那套
 *   `after`/`before` 游标（真机实测：HTML stars 页 `?page=N` **被忽略**，真实翻页是游标），
 *   脚本自造分页器只会给出无法兑现的页码；
 * - 条目数为 0、宿主认不出、未登录（无登录者身份 ⇒ 标签/备注无从归属）⇒ **放弃接管**，什么都不做
 *   （GitHub 自己的空列表/错误态保持原样，比我们造一个更合适）。
 *
 * ## 只读
 *
 * 卡片由 `ui/cards.ts` 的 `buildCardFromCache` 建（纯 DOM、零监听），然后
 * `filters.renderBrowsePage` 在 `isReadOnlyView()` 下跳过星标按钮、改用 `readonly.ts` 的只读
 * 标签/备注渲染器。页面内不存在任何写入口。
 */

import { getStarsMainColumn, hideListsSection, hideNativeNode, moveTopicsToRightSidebar, restoreTopicsFromRightSidebar } from './dom';
import { ensureLayoutStyles, removeLayoutStyles } from './layoutStyles';
import { collectPageRepos } from './domRepos';
import { renderBrowsePage } from './filters';
import { setLangColorFetchEnabled } from './langColors';
import { mountTopPager } from './topPager';
import { getPageOwnerLogin } from './pageScope';
import { exitReadOnlyMode } from './readonly';
import { getOtherPageRepos, resetViewContext, setOtherPageRepos } from './viewContext';
import { isDesktop } from './utils';
import type { RepoData } from './types';

/** 网格容器（与自己的页同名，复用同一套布局 CSS）。
 *  4.13.0 起**不再加说明行**（曾有一行 `@login 的 star · 本页 N 个 · 只读`）：用户裁定那行是多余的
 *  描述文字，页面标题（GitHub 自己的「Starred repositories」）已经说清这是什么。 */
const GRID_CLASS = 'stars-grid-container';
/** 只读网格的标记类：让「已 star 实心星常驻可见」等只读专属样式**只**作用在他人 star 页的网格上
 *  （本方自己的页用同一个 `.stars-grid-container`，但保持原观感）。随网格节点一起建/删。 */
const RO_GRID_CLASS = 'gsm-other-stars';

/**
 * 列表宿主：条目所在容器 + 网格应插入的位置。
 *
 * 两条路线（真机实测）：
 *   1. `/{login}?tab=stars`：`#user-starred-repos > .col-lg-9`；
 *   2. `/stars/{login}`：`main` 里的 `ul.repo-list`（**没有** `#user-starred-repos` / `.col-lg-9`）。
 */
function findGridAnchor(firstItem: HTMLElement): { parent: HTMLElement; before: HTMLElement } | null {
  const parent = firstItem.parentElement;
  if (!parent) return null;
  // `li` 路线：不要把 div 塞进 `ul`（无效嵌套，列表样式也会干扰）——改插在 `ul` 之前
  if (firstItem.tagName === 'LI') {
    const ul = firstItem.closest('ul');
    if (ul?.parentElement) return { parent: ul.parentElement, before: ul };
  }
  return { parent, before: firstItem };
}

/** 投影的作用域：先试 profile 标签页的主列，再退到 `main` */
function getScanScope(): ParentNode {
  return getStarsMainColumn() ?? document.getElementById('user-starred-repos') ??
    document.querySelector<HTMLElement>('main') ?? document.body;
}

/**
 * 进入他人页只读网格。**幂等**（Turbo 重渲染后可重复调用）。
 *
 * 返回是否已完成接管（`false` = 按设计放弃，调用方无需重试）。
 */
export function enterOtherStarsView(): boolean {
  // 视口门（D18）：窄视口一行 DOM 都不碰，并清掉此前痕迹
  if (!isDesktop()) {
    exitOtherStarsView();
    return false;
  }
  // 未登录也接管（用户 2026-10-03 要求「继续兼容未登录的 stars 页」）。
  // 曾在此处因 `!getViewerId()` 直接放弃 —— 理由是「没有登录者则标签/备注无从归属」，
  // 但那只是**装饰缺省**，不该连网格一起放弃：页面条目是公开渲染的，只读网格本身仍然有用。
  // 未登录时的三个后果，都是设计上的正确缺省：
  //   · 标签/备注：`getStorageUserId()` 为空 ⇒ 命名空间为空 ⇒ 无徽章（不是「读错了别人的」）；
  //   · 星按钮：**不建** —— 没有登录者就无从知道这些仓库在「我」这里是什么状态，
  //     也没有任何可用凭据（判定见 filters.ts 的 canShowStar）；
  //   · 同步/写路径：本来就不进他人页分支。
  const ownerLogin = getPageOwnerLogin();

  // 幂等：已接管则只刷新内容（数据未变，直接复用）。
  // 但**必须先把布局标记补上**（4.13.0 审查补）：早退发生在 `ensureLayoutStyles()`（下面 0b）**之前**，
  // 若上一次接管中途抛错，`deactivateStars()` 会把样式表连同标记一起撤掉，而网格**已经留在页面上** ——
  // 此时再进（Turbo frame-render / 断点往返）会走进这条早退，于是永久停在「有网格、但布局是 GitHub 原生的」
  // 半吊子状态（实测：`marked=0`、`cols=none`、侧栏被原生拉到 1263px）。补一次标记即可自愈。
  if (document.querySelector(`.${GRID_CLASS}`)) {
    ensureLayoutStyles();
    return true;
  }

  const scope = getScanScope();
  const repos = collectPageRepos(scope);
  // 没有任何条目 ⇒ 放弃接管（空列表/结构变更都交给 GitHub 自己的呈现，不猜、不报错）
  if (repos.length === 0) return false;

  const first = repos[0].item;
  const anchor = findGridAnchor(first);
  if (!anchor) return false;

  // 0a) 零网络闸门：关闭语言色请求。卡片渲染里的 getLangColor() 在色表未命中时会顺手发一次
  //     linguist 请求（实测过：不关闸时 fetchLog 恰有一条 languages.yml）—— 那是**间接**网络，
  //     同样违反零网络。关掉后「已缓存的色表照用、未命中则灰点」，正是 V4 的口径。
  setLangColorFetchEnabled(false);

  // 0b) 布局样式表（base+wide）：**卡片与网格的样式全在里面**，不注入就只是「一堆没有样式的行」
  //     （真机事故：网格 computed `display: block`、卡片无边框单列铺满 ⇒ 用户报「网格没有应用」）。
  //     注入后观感与**自己的页**完全一致（收窄左栏 + 满宽多列 + 右栏），并在退出时整表移除。
  ensureLayoutStyles();

  // 0c) Lists 区块与网格无关（受用户开关控制，见 dom.hideListsSection 的门控）
  hideListsSection();

  // 1) 登记来源（仅内存）。**必须在渲染之前** —— queryRepos 会直接读它
  const table: Record<string, RepoData> = {};
  for (const { repoId, data } of repos) table[repoId] = data;
  setOtherPageRepos(table, ownerLogin);

  // 2) 藏原生条目：只藏条目，分页器/筛选栏/Lists 原样（V5/D6）
  for (const { item } of repos) hideNativeNode(item);

  // 3) 网格插到条目原来的位置
  const grid = document.createElement('div');
  grid.className = `${GRID_CLASS} ${RO_GRID_CLASS}`;
  anchor.parent.insertBefore(grid, anchor.before);

  // 3b) Starred topics 搬进脚本右栏（与本方自己的页同一份实现）。base.css 会隐藏原生的
  //     `#user-starred-repos .col-lg-3`，搬走后那一列不会留空也不会丢内容。
  //     `/stars/{login}` 路由没有 `#user-starred-repos` ⇒ 搬不动，topics 留在原处（无害）。
  moveTopicsToRightSidebar();

  // 3c) 原生分页器只有页面**底部**那一份，想翻页得先滚到底 ⇒ 在标题行右侧克隆一份（顶部快捷翻页）。
  //     克隆件保留原生 href（`after`/`before` 游标），点击行为与点底部那份完全一致；
  //     **底部那份原样不动**（V5/D6：原生控件不改造）。翻页本身由 GitHub 自己承担，零额外请求逻辑。
  //     没有分页器时（单页、或 `/stars/{login}` 那代路由不提供分页器）返回 null，什么都不做。
  mountTopPager(scope, scope.querySelector<HTMLElement>('.paginate-container:not(.gsm-top-pager)'));

  // 4) 只读渲染（renderBrowsePage 在 isReadOnlyView() 下不建星按钮/编辑控件、不做本地分页）
  renderBrowsePage(1);
  return true;
}


/**
 * 退出他人页视图：清投影 + 抹网格 + 归还 topics + 撤掉布局主表。
 * 原生条目的 display 由 viewTeardown 按标记统一还原。
 *
 * 归还 topics 必须在**本函数内**做（不能只靠 viewTeardown 第 1 项）：`exitOtherStarsViewIfActive()`
 * 在「他人页 → 我自己的页」的转换路径上会被直接调用，那条路不经过 teardown。
 */
export function exitOtherStarsView(): void {
  document.querySelectorAll(`.${GRID_CLASS}`).forEach((el) => el.remove());
  // 顶部翻页器克隆件 + 标题行上的 flex 类（都属本次接管的产物，必须一起收干净）
  document.querySelectorAll('.gsm-top-pager').forEach((el) => el.remove());
  document.querySelectorAll('.gsm-header-row').forEach((el) => el.classList.remove('gsm-header-row'));
  restoreTopicsFromRightSidebar();
  removeLayoutStyles();
  resetViewContext();
  exitReadOnlyMode();
  // 恢复语言色请求：回到自己的页后仍要能取色表（否则语言点永远灰）
  setLangColorFetchEnabled(true);
}

/**
 * 「他人页 → 我自己的页」的转换入口专用：**若**当前处于他人页视图则完整退出。
 *
 * 为什么必须显式调：`viewContext` 是**模块态**，Turbo 换 DOM 冲不掉它。没有这一步，
 * 回到自己的页后 `queryRepos()` 仍读上一次的投影 ⇒ **把别人的列表画在我自己的页上**
 * （往返串数据；工装 scenario=roundtrip 抓到的真实缺陷）。
 *
 * 返回是否真的退出过（未处于他人页视图时是**无副作用**的空操作 —— 不能无条件调 exit，
 * 那会顺手删掉我自己的页上那张 `.stars-grid-container`）。
 */
export function exitOtherStarsViewIfActive(): boolean {
  if (!getOtherPageRepos()) return false;
  exitOtherStarsView();
  return true;
}

/** 是否已接管（供入口分派判断，不重复投影） */
export function isOtherStarsViewMounted(): boolean {
  return getOtherPageRepos() !== null && !!document.querySelector(`.${GRID_CLASS}`);
}

