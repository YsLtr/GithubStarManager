import {
  ARROW_DOWN_SVG,
  ARROW_UP_SVG,
  CHECK_SVG,
  NATIVE_PAGE_SIZE,
  SORT_OPTIONS,
  TRIANGLE_DOWN_SVG,
  TYPE_OPTIONS,
} from './constants';
import { getNativeFilterBar, getNativeFilterRow, getStarsMainColumn, hideNativeNode, showNativeNode } from './dom';
import { filterState, hasActiveFilter } from './state';
import { loadAllNotes } from './storage/notes';
import { loadRepoCache } from './storage/repoCache';
import { isStarredByViewer, loadViewerCacheForView } from './cardState';
import { renderCardTagAndNoteAreas } from './cardAreas';
import { getOtherPageRepos, isReadOnlyView } from './viewContext';
import { loadAllTags } from './storage/tags';
import { buildCardFromCache, createStarButtonForCached } from './ui/cards';
import { refreshTagFilterBar, refreshTagPillStates } from './ui/tagFilter';
import { escapeHtml, isDesktop } from './utils';
import type { FilteredRepo, RepoData, TypeFilter } from './types';

/**
 * 筛选/排序引擎（4.1.0 全本地化；4.2.0 Type 接管；4.4.0 Type/Language 多选 + 勾选不收起）：
 * - `queryRepos()`：唯一查询管线（type → lang → tags AND → search → 排序），
 *   browse 态、标签筛选、搜索、facet 候选计算全部走它（R2）；
 * - `sortResults()`：4 排序键 × asc/desc + 缺失值恒沉底 + 名称决胜（R1/R4/R5）；
 * - `initFiltersFromUrl()`：进页时从 URL 参数初始化（URL 只读不写，R6/D3）；
 * - `updateLocalFilterControls()`：常驻本地 Type/Language/Sort(+方向) 接管原生菜单（4.4.0 起容器只建一次 + 原位刷新）。
 */

/* 原生节点的隐藏/还原（4.9.1）：4.13.0 上移到 dom.ts，本模块改为 import —— 他人页视图
 * （otherStarsView.ts）也要隐藏原生条目，两处共用一份实现，标记纪律才不会漂移。 */
/** facet 候选计算时可跳过的约束维度 */
type QuerySkip = 'lang' | 'type';

/**
 * 按 filterState.sort/direction 就地排序。
 * 规则（§4.3）：缺失值恒沉底、不随方向翻转；平局按仓库名决胜；全确定性。
 * `created` = starredAt（Recently starred）、`updated` = updatedAt=pushed_at（Recently active，4.8.0 修正：与 GitHub 原生同义）、
 * `stars`/`forks` = 计数值（Most stars / Most Forks，后者为本地扩展）。
 */
function sortResults(results: FilteredRepo[]): void {
  const dir = filterState.direction === 'asc' ? -1 : 1; // 比较器基准 = desc
  const tie = (a: FilteredRepo, b: FilteredRepo): number =>
    (a.data.name || '').localeCompare(b.data.name || '');

  results.sort((a, b) => {
    const key = filterState.sort;
    if (key === 'stars' || key === 'forks') {
      const av = key === 'stars' ? a.data.stars : a.data.forks;
      const bv = key === 'stars' ? b.data.stars : b.data.forks;
      if (av === undefined && bv === undefined) return tie(a, b);
      if (av === undefined) return 1;
      if (bv === undefined) return -1;
      if (av !== bv) return (bv - av) * dir;
      return tie(a, b);
    }
    const av = key === 'created' ? a.data.starredAt : a.data.updatedAt;
    const bv = key === 'created' ? b.data.starredAt : b.data.updatedAt;
    if (!av && !bv) return tie(a, b);
    if (!av) return 1;
    if (!bv) return -1;
    if (av !== bv) return (av < bv ? 1 : -1) * dir;
    return tie(a, b);
  });
}

/**
 * Type 判定（4.2.0）：对齐原生 7 项（Can be sponsored 无 API 字段，D2 已定案省略）。
 * 四标志缺省（undefined）按 false 处理——4.2.0 升级回补阀门保证 star 条目首轮整表后必有值。
 */
function typeMatches(data: RepoData, type: TypeFilter): boolean {
  switch (type) {
    case 'public':
      return !data.private;
    case 'private':
      return !!data.private;
    case 'source':
      return !data.fork;
    case 'fork':
      return !!data.fork;
    case 'mirror':
      return !!data.mirror;
    case 'template':
      return !!data.isTemplate;
    default:
      return true;
  }
}

/** 唯一查询管线：type → lang 约束 → tags AND → search 全文 → 排序。skip = 算该 facet 候选时忽略自身约束（D1 替换语义）。 */
function queryRepos(skip?: QuerySkip): FilteredRepo[] {
  // 他人 star 页（4.13.0）：表格是**页面原生条目的内存投影**，顺序即 GitHub 的顺序。
  // 刻意**不套用** filterState（他人页没有筛选 UI，V2）：沿用我自己页上残留的筛选条件
  // 会让网格莫名其妙变空 —— 那不是筛选，是看起来坏了。详见 viewContext.ts。
  const otherPage = getOtherPageRepos();
  if (otherPage) {
    return Object.keys(otherPage.repos).map((repoId) => ({ repoId, data: otherPage.repos[repoId] }));
  }
  const cache = loadRepoCache();
  const allTags = loadAllTags();
  const allNotes = loadAllNotes();
  const terms = filterState.searchQuery.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
  const results: FilteredRepo[] = [];

  for (const repoId in cache) {
    const data = cache[repoId];
    // Type 筛选（多选 OR：命中任一已选类型即过，4.4.0）
    if (skip !== 'type' && filterState.types.length > 0) {
      if (!filterState.types.some((t) => typeMatches(data, t))) continue;
    }
    // 语言筛选（多选 OR）；LANG_NONE 哨兵 = 无语言仓库（菜单 None 项，4.3.2）
    if (skip !== 'lang' && filterState.langs.length > 0) {
      const hit = filterState.langs.some((l) =>
        l === LANG_NONE ? !data.lang : (data.lang || '').toLowerCase() === l.toLowerCase()
      );
      if (!hit) continue;
    }

    // 标签筛选（多选 AND）
    const repoTags = allTags[repoId] || [];
    if (filterState.tags.length > 0 && !filterState.tags.every((ft) => repoTags.includes(ft))) {
      continue;
    }

    // 搜索：每个词都必须至少命中一个字段（作者/仓库名/描述/标签/备注；
    // 语言字段不参与全文匹配，D5：避免 ASC 命中 javascript 的噪音）
    if (terms.length > 0) {
      const name = (data.name || '').toLowerCase();
      const [author, repo] = name.split('/');
      const desc = (data.desc || '').toLowerCase();
      const tagTexts = repoTags.map((t) => t.toLowerCase());
      const note = (allNotes[repoId] || '').toLowerCase();
      const hit = terms.every(
        (term) =>
          (author || '').includes(term) ||
          (repo || '').includes(term) ||
          desc.includes(term) ||
          tagTexts.some((t) => t.includes(term)) ||
          note.includes(term)
      );
      if (!hit) continue;
    }

    results.push({ repoId, data });
  }

  sortResults(results);
  return results;
}

/**
 * Tags 候选（R3 共现收窄，加选语义）：
 * 结果集（含全部当前约束）内出现的标签 ∪ 已选标签（已选恒可见，可取消）。
 * 可见性 ⇔ 加入该标签后仍有 ≥1 条结果 = 该标签在结果集内出现 ≥1 次。
 * 按命中数降序、平局字母序。注意：这是 applyFilters 链上独立于 queryRepos 的
 * 第二次全遍历（464 条约 2.3ms，当前无感）；合并进单遍查询 = 审查报告 A 案。
 */
export function computeTagCandidates(): string[] {
  const allTags = loadAllTags();
  const counts = new Map<string, number>();
  for (const { repoId } of queryRepos()) {
    for (const tag of allTags[repoId] || []) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  for (const tag of filterState.tags) {
    if (!counts.has(tag)) counts.set(tag, 0); // 已选恒可见（结果为空也可取消）
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag);
}

/**
 * 全缓存是否至少有一个标签（与筛选约束无关）。
 * Tags 按钮的渲染门槛：用户从未打过标签 → 不渲染按钮；
 * 有标签但当前约束（type/lang/搜索）筛空了候选 → 仍渲染按钮 + 面板空态提示。
 */
export function hasAnyTags(): boolean {
  const allTags = loadAllTags();
  for (const repoId in allTags) {
    if (allTags[repoId].length > 0) return true;
  }
  return false;
}

/**
 * Language 候选（多选，D1 忽略自身维度约束——否则选完就剩一项没法加选）：
 * `queryRepos('lang')` 里出现的语言 ∪ 已选语言（已选恒可见，可取消）。
 */
function computeLanguageCandidates(): string[] {
  const langs = new Set<string>();
  for (const { data } of queryRepos('lang')) {
    if (data.lang) langs.add(data.lang);
  }
  for (const l of filterState.langs) {
    if (l !== LANG_NONE) langs.add(l);
  }
  return Array.from(langs).sort((a, b) => a.localeCompare(b));
}

/** Language 菜单「None」哨兵值：无语言仓库（data.lang 为空；linguist 无同名语言，不会撞车） */
export const LANG_NONE = '(none)';
/** None 在界面上的显示文案 */
const LANG_NONE_LABEL = 'None';

/** 无语言仓库是否存在（当前约束下动态收窄，D1；已选恒可见） */
function hasLangNoneCandidate(): boolean {
  if (filterState.langs.includes(LANG_NONE)) return true;
  for (const { data } of queryRepos('lang')) {
    if (!data.lang) return true;
  }
  return false;
}

/**
 * Type 候选（多选，同 Language 忽略自身维度约束）：
 * `queryRepos('type')` 结果里能命中的 type 值 ∪ 已选 type；菜单顺序固定为原生序。
 */
function computeTypeCandidates(): TypeFilter[] {
  const present = new Set<TypeFilter>();
  for (const { data } of queryRepos('type')) {
    for (const opt of TYPE_OPTIONS) {
      if (typeMatches(data, opt.value)) present.add(opt.value);
    }
  }
  for (const t of filterState.types) present.add(t); // 已选恒可见（可取消）
  return TYPE_OPTIONS.map((o) => o.value).filter((v) => present.has(v));
}

/**
 * 本地分页渲染（4.0.0 browse 态 → 4.4.0 起筛选态统一走这里）：
 * 缓存 → 查询管线 → 切 NATIVE_PAGE_SIZE/页渲染。Type 的 Public/Sources 这类大集合
 * 筛选不再一次平铺全部结果卡（渲染卡顿根因），单次渲染恒 ≤ 30 张。
 * 搜索高亮在此应用——翻页后的新卡片同样带高亮。
 * @returns 查询结果总数（applyFilters 拿去渲信息条计数，避免二次全遍历）
 */
export function renderBrowsePage(page: number): number {
  const gridContainer = document.querySelector('.stars-grid-container');
  if (!gridContainer) return 0;

  // 他人 star 页（4.13.0；4.14.0 起「只读」不再全页一刀切）：与本方自己的页三处差异
  //   1. 星标按钮：**本人整表缓存可用时照建**（4.13.0 修订，用户要求「卡片上要有 star 按钮」）。
  //      状态来源必须是**本人缓存成员关系**，不是页面 DOM —— 真机实测：他人页原生星按钮显示的
  //      是**页面主人**的状态（`mattn?tab=stars` 30 条全是 `Starred`/`/unstar` 表单，而本人缓存里
  //      一条都没有），照抄它等于把「对方收藏了」当成「我收藏了」。看不到本人缓存（从未同步）时
  //      无从得知 ⇒ 退回不建按钮，宁缺勿假。
  //   2. 标签/备注**逐仓库**决定可编辑性（`cardState` 三态，4.14.0）：本人 star 了的卡片可编辑，
  //      没 star 的只读；已 unstar 但数据仍在 24h 宽限期备份里的，**只读但仍然显示**标签与备注。
  //      分派在 `cardAreas.renderCardTagAndNoteAreas`（唯一入口）。此前这里是页级布尔
  //      `readOnly ? 只读渲染器 : 可编辑渲染器`，而 `starCheck.syncCardAfterStarChange` 另有一处
  //      无判据的调用 ⇒ 「点一下 star 整页变可编辑」。
  //   3. 不做本地分页：数据只有页面这一页，脚本也不挂分页器（V3）——翻页交给 GitHub 原生分页器。
  // 第 3 条顺带避免一个真实事故：若某路由一页超过 NATIVE_PAGE_SIZE(30) 条，
  // 按 30 分页会让多出来的条目**静默消失**且没有分页器可供翻页。
  const readOnly = isReadOnlyView();
  // 他人页星标状态：本次会话里本页写入过的以覆盖值为准，否则看本人缓存成员关系
  // （缓存不可用时 `canShowStar` 为假 ⇒ 不建按钮，见上方第 1 条）
  // 星按钮的两个前提：① 有本人整表缓存（否则无从知道状态）；② **有登录者身份**
  // （`octolytics-actor-id`）—— 未登录访客没有「我」这个概念，缓存可能还是上一个会话/账号的，
  // 建出来的按钮既发不出请求也代表不了任何人 ⇒ 不建（宁缺勿假）。
  // 4.14.0：同一条成员关系也决定**标签/备注是否可编辑**（见上方第 2 条）——
  // `canShowStar` 与 `viewerCache` 同源，故「不建星按钮」与「不可编辑」在不该猜的场景下同时成立。
  // 4.14.0：这两条**只有一份实现**（`cardState.loadViewerCacheForView`）——
  // 此前这里内联了 `hasApiData() && !!getViewerId()`，而 `cardState` 里又写了一遍，
  // 正是「两处各判一次、判据漂移」的同一种缺陷模式（本次要修的就是它）。
  // `viewerCache === null` 同时意味着「星按钮不建」与「全部卡片只读」，两者同源。
  const viewerCache = readOnly ? loadViewerCacheForView() : null;
  const canShowStar = !readOnly || viewerCache !== null;
  const results = queryRepos();
  const pageSize = readOnly ? Math.max(results.length, 1) : NATIVE_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(results.length / pageSize));
  filterState.page = Math.min(Math.max(1, page), totalPages);
  filterState.totalPages = totalPages;
  const start = (filterState.page - 1) * pageSize;
  const terms = filterState.searchQuery.toLowerCase().split(/\s+/).filter((t) => t.length > 0);

  // 底部本地分页器常驻：innerHTML 清空会把它一并删掉（4.4.0 审查 🟡-1：4.0.0 起底部
  // 分页器实际只活到首帧渲染就被清空）——先摘下、渲染完插回，顶部克隆在标题行不受影响
  const bottomPager = gridContainer.querySelector<HTMLElement>('.paginate-container.gsm-local-pager');
  if (bottomPager) bottomPager.remove();

  gridContainer.innerHTML = '';
  for (const { repoId, data } of results.slice(start, start + pageSize)) {
    const card = buildCardFromCache(repoId, data);
    gridContainer.appendChild(card);
    // 标签/备注：唯一分派点（他人页逐仓库三态，本方自己的页永远可编辑）
    renderCardTagAndNoteAreas(card, readOnly ? 'other' : 'own', viewerCache);
    if (readOnly) {
      if (canShowStar) createStarButtonForCached(card, data, isStarredByViewer(repoId, viewerCache));
      continue; // 他人页没有搜索 UI（terms 恒为空）⇒ 不做高亮
    }

    createStarButtonForCached(card, data);
    if (terms.length > 0) highlightMatchesInCard(card, terms);
  }
  if (bottomPager) gridContainer.appendChild(bottomPager);
  if (!readOnly) updateLocalPagers();
  return results.length;
}

/** 同步顶/底两份本地分页器：页码文字 + Previous/Next 禁用态 */
function updateLocalPagers(): void {
  document.querySelectorAll<HTMLElement>('.paginate-container.gsm-local-pager').forEach((pager) => {
    // 4.10.0 跳页：**不需要**为输入态加跳过门 —— 进入编辑态是把页码按钮 replaceWith
    // 成 input，所以编辑中的那份连 `.gsm-page-info` 都查不到，文字写入天然是空操作；
    // 而 prev/next 的禁用态必须照常更新，否则编辑期间发生渲染会让它与真实页码脱节
    // （曾整份跳过 → 顶部那份永远停在旧页码/旧禁用态，见 4.10.0 审查 P1-1）。
    const info = pager.querySelector('.gsm-page-info');
    if (info) info.textContent = `${filterState.page} / ${filterState.totalPages}`;
    pager
      .querySelector('[data-gsm-page="prev"]')
      ?.classList.toggle('disabled', filterState.page <= 1);
    pager
      .querySelector('[data-gsm-page="next"]')
      ?.classList.toggle('disabled', filterState.page >= filterState.totalPages);
  });
}

/** 转义正则元字符 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 在搜索结果卡片内高亮命中词：只包文本节点不改结构；语言字段已退出全文搜索故不扫 meta */
function highlightMatchesInCard(card: HTMLElement, terms: string[]): void {
  if (terms.length === 0) return;
  const re = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
  const roots = card.querySelectorAll(
    '.stars-card-header a, .stars-card-desc, .stars-card-tags, .stars-card-notes'
  );
  roots.forEach((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) textNodes.push(node as Text);
    for (const textNode of textNodes) {
      const parent = textNode.parentElement;
      if (!parent || parent.closest('textarea, input, [contenteditable="true"], script, style')) continue;
      const text = textNode.nodeValue;
      if (!text || !re.test(text)) continue;
      re.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0;
      for (const m of text.matchAll(re)) {
        const idx = m.index ?? 0;
        if (idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)));
        const mark = document.createElement('mark');
        mark.className = 'gsm-search-hit';
        mark.textContent = m[0];
        frag.appendChild(mark);
        last = idx + m[0].length;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      textNode.replaceWith(frag);
    }
  });
}

/** 渲染结果计数信息条（含 Clear filter）：tags/lang/type/search 任一激活即出现 */
function renderFilterInfoBar(count: number): void {
  // 移除旧信息条
  document.querySelectorAll('.stars-tag-info-bar').forEach((el) => el.remove());

  if (!hasActiveFilter()) return;

  const colLg9 = getStarsMainColumn();
  if (!colLg9) return;
  const gridContainer = colLg9.querySelector('.stars-grid-container');
  if (!gridContainer) return;

  // 隐藏原生 clear filter 条
  const nativeBar = getNativeFilterBar(colLg9);
  if (nativeBar) hideNativeNode(nativeBar);

  const bar = document.createElement('div');
  bar.className = 'stars-tag-info-bar TableObject border-bottom color-border-muted py-3';

  const infoDiv = document.createElement('div');
  infoDiv.className = 'TableObject-item TableObject-item--primary';
  const infoSpan = document.createElement('span');
  infoSpan.setAttribute('role', 'status');

  // 拼装筛选描述（sort/direction 属浏览状态，不进信息条）
  let desc = '<strong>' + count + '</strong> repos';
  if (filterState.searchQuery) {
    desc += ' matching "<strong>' + escapeHtml(filterState.searchQuery) + '</strong>"';
  }
  if (filterState.tags.length > 0) {
    desc += ' with tags: ' + filterState.tags.map((t) => '<strong>' + escapeHtml(t) + '</strong>').join(', ');
  }
  if (filterState.types.length > 0) {
    const labels = filterState.types.map((t) => TYPE_OPTIONS.find((o) => o.value === t)?.label || t);
    desc += ' · type: <strong>' + escapeHtml(labels.join(', ')) + '</strong>';
  }
  if (filterState.langs.length > 0) {
    const names = filterState.langs.map((l) => (l === LANG_NONE ? LANG_NONE_LABEL : l));
    desc += ' · language: <strong>' + escapeHtml(names.join(', ')) + '</strong>';
  }
  infoSpan.innerHTML = desc;
  infoDiv.appendChild(infoSpan);

  const clearLink = document.createElement('a');
  clearLink.className = 'issues-reset-query text-normal TableObject-item text-right';
  clearLink.href = '#';
  clearLink.innerHTML = '<svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16" data-view-component="true" class="octicon octicon-x issues-reset-query-icon mt-1"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"></path></svg> Clear filter';
  clearLink.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation(); // 不冒泡到 index.ts 的原生 Clear filter 拦截器，避免 exitCustomMode 双跑
    exitCustomMode();
  });

  bar.appendChild(infoDiv);
  bar.appendChild(clearLink);

  colLg9.insertBefore(bar, gridContainer);
}

/**
 * 应用当前筛选状态（4.4.0 统一漏斗）：browse 与筛选态都走本地分页渲染，
 * 只有原生 clear 条显隐与信息条随态切换——大集合筛选不再平铺全部结果卡。
 * 常驻本地控件**原位刷新**（容器只建一次），Type/Language 菜单的 popover
 * 在勾选过程中保持打开（勾选不收起）。
 */
export function applyFilters(opts: { keepPage?: boolean } = {}): void {
  // 窄视口（4.9.1）：整条渲染/控件管线一行都不跑。这是**兜底门**——回调可能来自
  // 回滚之前排的队（如 search.ts 的 50ms 定时器），而 applyFilters 会往 GitHub 原生筛选行
  // 里插控件、把原生菜单设成 display:none；在手机宽度上发生这些就是纯残留。
  if (!isDesktop()) return;
  // 他人 star 页（4.14.0）：同样一行都不跑。它没有脚本筛选栏（D26/V2），`queryRepos()` 对投影来源
  // 也刻意忽略 `filterState` —— 这里插进去的控件没有任何作用，却会落到**页面主人**的原生筛选行上
  // （`updateLocalFilterControls` 会把原生三个菜单设成 `display:none`、`refreshTagFilterBar` 会插入
  // Tags 按钮、筛选信息条也会冒出来）。
  //
  // 为什么需要这道门：`filterState` 是**跨页共享的模块态**（`viewContext.ts` 明确进他人页不清、
  // 离开也不清），而 `starCheck.syncCardAfterStarChange` 会在「有激活筛选」时调本函数 ⇒
  // 「在自己页筛过标签 → Turbo 切到别人的 stars 页 → 在卡片上点 star」就会踩中。
  // 此前唯一的防护是「他人页入口刻意直调 renderBrowsePage 绕过 applyFilters」，属实现约定而非不变量。
  if (isReadOnlyView()) return;
  document.querySelectorAll('.stars-grid-card-cached').forEach((el) => el.remove());

  // 2. 常驻本地控件（Type / Language / Sort+方向）原位刷新，同时保证原生菜单持续隐藏
  updateLocalFilterControls();
  // Tags 候选随当前约束刷新（R3，4.3.4）：type/lang/搜索/勾选变化后原位收窄回填——
  // 杜绝「切了 Type/Language 后 chip 列表还是旧全集」与「空结果取消勾选后面板永久空白」
  refreshTagFilterBar();

  const filtered = hasActiveFilter();
  const colLg9 = getStarsMainColumn();

  // 3. 原生 clear filter 条：筛选态藏（信息条顶替）、browse 态还
  if (colLg9) {
    const nativeBar = getNativeFilterBar(colLg9);
    if (nativeBar) {
      if (filtered) hideNativeNode(nativeBar);
      else showNativeNode(nativeBar);
    }
  }
  if (!filtered) {
    document.querySelectorAll('.stars-tag-info-bar').forEach((el) => el.remove());
  }

  // 4. 统一分页渲染：筛选变化回第 1 页；unstar 翻卡等「结果集变、条件没变」的调用传
  // { keepPage: true } 保住当前页码（4.4.0 审查 🟡-3）；纯翻页（pagination.ts 直调
  // renderBrowsePage）不经这里、页码不回卷
  const total = renderBrowsePage(opts.keepPage ? filterState.page : 1);

  // 5. 筛选态：计数信息条（总数 = 查询结果全集，非当前页）
  if (filtered) renderFilterInfoBar(total);
}

/** 退出全部筛选（Clear filter 本地化）：清 tags/langs/types/search，保留 sort/direction（D4）→ 干净地址栏 */
export function exitCustomMode(): void {
  filterState.tags = [];
  filterState.langs = [];
  filterState.types = [];
  filterState.searchQuery = '';
  filterState.page = 1;
  const searchInput = document.querySelector<HTMLInputElement>(
    'input[placeholder*="Search starred"]'
  );
  if (searchInput) searchInput.value = '';
  applyFilters();
  refreshTagPillStates();
  history.pushState({}, '', location.pathname + '?tab=stars');
  // pushState 后的 search 串登记为「已解析」：sort/direction 是用户浏览状态，
  // 不能被 initFiltersFromUrl 当作新入口冲回缺省（R6 防覆盖规则）
  markUrlParsed();
}

/* ================================================================
 * URL 入口匹配（R6）：URL 只读不写（D3）。
 *
 * 进页 / turbo 到达时解析 sort/direction/language/type 初始化 filterState；
 * 防覆盖：只在「筛选相关参数」变化时才覆盖状态 —— frame 重渲染、
 * exitCustomMode 的 pushState、无关参数（page 等）都不会冲掉用户本地选择。
 * q 沿用 search.ts 现有自动激活，不在此处理。
 * ================================================================ */
let lastParsedUrlSignature: string | null = null;

function urlFilterSignature(): string {
  const p = new URLSearchParams(location.search);
  return (
    `sort=${p.get('sort') ?? ''}|direction=${p.get('direction') ?? ''}|` +
    `language=${p.get('language') ?? ''}|type=${p.get('type') ?? ''}`
  );
}

/** 把当前 URL 的筛选参数登记为「已解析」（下次不覆盖状态） */
function markUrlParsed(): void {
  lastParsedUrlSignature = urlFilterSignature();
}

/** URL 语言值 → 缓存中的规范 casing（菜单勾选态比对是大小写不敏感的，但显示用原名防重影） */
function canonicalLangName(raw: string): string {
  const lower = raw.toLowerCase();
  for (const data of Object.values(loadRepoCache())) {
    if (data.lang && data.lang.toLowerCase() === lower) return data.lang;
  }
  return lower;
}

/** 进页时 Sort/方向/语言/Type 与 URL 参数匹配（仅 URL 筛选参数变化时覆盖本地状态） */
export function initFiltersFromUrl(): void {
  const sig = urlFilterSignature();
  if (sig === lastParsedUrlSignature) return;
  lastParsedUrlSignature = sig;

  const p = new URLSearchParams(location.search);
  // 'forks' 为本地扩展项：URL 永不写入（D3），出现时宽容识别（仅作进页解析兜底）
  const sort = p.get('sort');
  filterState.sort =
    sort === 'created' || sort === 'updated' || sort === 'stars' || sort === 'forks'
      ? sort
      : 'created';
  filterState.direction = p.get('direction') === 'asc' ? 'asc' : 'desc';
  // URLSearchParams 已解码（`jupyter+notebook` → 空格、`c%23` → `c#`），匹配时大小写不敏感
  // 4.4.0 多选：逗号分隔（`?language=javascript,python`）；`none`（或 `(none)`）= 无语言（4.3.2）
  const langParam = p.get('language') || '';
  filterState.langs = langParam
    ? Array.from(
        new Set(
          langParam
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            // 大小写归一（4.4.0 审查 🟡-2）：`?language=none,None` 必须合并成一个哨兵、
            // `JavaScript,javascript` 不能存成双变体（取消看似无效 / 菜单重影双行都打勾）
            // —— 先映射到缓存规范 casing / LANG_NONE，再去重。缓存没有的值取
            // lowercase 形态（匹配本就不区分大小写，且不在候选列表中、不会重影）
            .map((s) => (/^\(?none\)?$/i.test(s) ? LANG_NONE : canonicalLangName(s)))
        )
      )
    : [];
  // 4.4.0 多选：逗号分隔（`?type=fork,source`）；非法值丢弃
  const VALID_TYPES: readonly string[] = [
    'public',
    'private',
    'source',
    'fork',
    'mirror',
    'template',
  ];
  const typeParam = p.get('type') || '';
  filterState.types = typeParam
    ? Array.from(
        new Set(
          typeParam
            .split(',')
            // 大小写归一（4.4.0 审查 🟡-2）：`?type=Fork,FORK` 合并为一项
            .map((s) => s.trim().toLowerCase())
            .filter((s) => VALID_TYPES.includes(s))
        )
      ) as TypeFilter[]
    : [];
  filterState.page = 1;
}

/* ================================================================
 * 常驻本地筛选控件（R2 + R5；4.2.0 Type 接管；4.4.0 Type/Language 多选 +
 * 勾选不收起）。结构约束：容器**只创建一次**（缺失才建），之后每次
 * applyFilters 原位刷新（按钮文案 / 勾选态 / 候选列表）——整体重建会把开着
 * 的 popover 拆掉，「勾选后面板保持打开」依赖这一点（与 Tags 面板
 * refreshTagFilterBar 同一模式）。
 * ================================================================ */

/** 常驻隐藏原生 Type/Language/Sort action-menu（节点保留：getNativeFilterRow 依赖其锚点） */
function hideNativeFilterMenus(): void {
  for (const id of [
    'stars-type-filter-menu-button',
    'stars-language-filter-menu-button',
    'stars-sort-menu-button',
  ]) {
    const btn = document.getElementById(id);
    const menu = btn ? btn.closest('action-menu') : null;
    if (menu instanceof HTMLElement) hideNativeNode(menu);
  }
}

/** 重建或原位刷新常驻本地控件（幂等，applyFilters 每次调用） */
function updateLocalFilterControls(): void {
  hideNativeFilterMenus();

  const filterRow = getNativeFilterRow();
  if (!filterRow) return;

  const typeContainer = filterRow.querySelector<HTMLElement>('.gsm-type-filter');
  if (!typeContainer) {
    // 首次创建：布局 [Tags][Type][Language][Sort│↓]，锚点 = Tags 之后（无 Tags 时行首）
    const tagFilter = filterRow.querySelector('.stars-tag-filter');
    const anchorNode: ChildNode | null = tagFilter || filterRow.firstChild;
    const typeMenu = buildTypeMenu();
    const langMenu = buildLangMenu();
    const sortMenu = buildSortGroup();
    if (anchorNode && anchorNode.parentNode === filterRow) {
      filterRow.insertBefore(typeMenu, anchorNode.nextSibling);
    } else {
      filterRow.appendChild(typeMenu);
    }
    filterRow.insertBefore(langMenu, typeMenu.nextSibling);
    filterRow.insertBefore(sortMenu, langMenu.nextSibling);
  }

  // 创建与刷新统一走原位更新（新建容器的动态内容也在这里补齐）
  refreshTypeMenu(filterRow.querySelector<HTMLElement>('.gsm-type-filter')!);
  const langContainer = filterRow.querySelector<HTMLElement>('.gsm-lang-filter');
  if (langContainer) refreshLangMenu(langContainer);
  const sortContainer = filterRow.querySelector<HTMLElement>('.gsm-sort-filter');
  if (sortContainer) refreshSortGroup(sortContainer);
}

/**
 * 多选菜单项（4.4.0）：label **后置** ✓（需求原文「在该筛选条件后打钩」）。
 * 未选项的 check 以 visibility:hidden 占位——勾选/取消时行宽与文字位置不跳。
 */
function buildMultiSelectItem(label: string, checked: boolean, onClick: () => void): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'ActionListItem';
  li.setAttribute('role', 'none');
  const content = document.createElement('a');
  content.className = 'ActionListContent';
  content.setAttribute('role', 'menuitemcheckbox');
  content.setAttribute('aria-checked', String(checked));
  const labelEl = document.createElement('span');
  labelEl.className = 'ActionListItem-label';
  labelEl.textContent = label;
  const check = document.createElement('span');
  check.className = 'ActionListItem-visual ActionListItem-visual--trailing gsm-check-visual';
  check.innerHTML = CHECK_SVG;
  check.style.visibility = checked ? 'visible' : 'hidden';
  content.append(labelEl, check);
  content.addEventListener('click', (e) => {
    e.preventDefault();
    onClick();
  });
  li.appendChild(content);
  return li;
}

/* ---------------- Type（多选 OR） ---------------- */

/** Type 候选切换：命中任一已选类型即过（OR）；再次点击取消 */
function toggleTypeSelection(value: TypeFilter): void {
  const idx = filterState.types.indexOf(value);
  if (idx >= 0) filterState.types.splice(idx, 1);
  else filterState.types.push(value);
  applyFilters();
}

/** Type 按钮文案：无选中 = Type；单选 = Type: X；多选 = Type: N selected（对齐 Tags 风格） */
function typeButtonLabel(): string {
  const n = filterState.types.length;
  if (n === 0) return 'Type';
  if (n === 1) {
    const l = filterState.types[0];
    const opt = TYPE_OPTIONS.find((o) => o.value === l);
    return 'Type: ' + (opt ? opt.label : l);
  }
  return `Type: ${n} selected`;
}

/** Type 容器骨架（只建一次）：按钮 + popover overlay + 空 ul；内容全走 refreshTypeMenu */
function buildTypeMenu(): HTMLElement {
  const typeContainer = document.createElement('div');
  typeContainer.className = 'stars-custom-filter gsm-type-filter mb-1 mb-lg-0 mr-2';

  const typeBtnEl = document.createElement('button');
  typeBtnEl.type = 'button';
  typeBtnEl.id = 'stars-custom-type-button';
  typeBtnEl.setAttribute('popovertarget', 'stars-custom-type-overlay');
  typeBtnEl.setAttribute('aria-haspopup', 'true');
  typeBtnEl.className = 'Button--secondary Button--medium Button';
  typeBtnEl.innerHTML =
    '<span class="Button-content"><span class="Button-label"></span></span>' +
    '<span class="Button-visual Button-trailingAction">' +
    TRIANGLE_DOWN_SVG +
    '</span>';

  const typeOverlay = document.createElement('anchored-position');
  typeOverlay.id = 'stars-custom-type-overlay';
  typeOverlay.setAttribute('anchor', 'stars-custom-type-button');
  typeOverlay.setAttribute('align', 'start');
  typeOverlay.setAttribute('side', 'outside-bottom');
  typeOverlay.setAttribute('anchor-offset', 'normal');
  typeOverlay.setAttribute('popover', 'auto');

  const typeInner = document.createElement('div');
  typeInner.className = 'Overlay Overlay--size-auto';
  const typeBody = document.createElement('div');
  typeBody.className = 'Overlay-body Overlay-body--paddingNone';
  const typeList = document.createElement('ul');
  typeList.className = 'ActionListWrap--inset ActionListWrap';
  typeList.setAttribute('role', 'menu');

  typeBody.appendChild(typeList);
  typeInner.appendChild(typeBody);
  typeOverlay.appendChild(typeInner);
  typeContainer.appendChild(typeBtnEl);
  typeContainer.appendChild(typeOverlay);
  return typeContainer;
}

/** Type 原位刷新：按钮文案 + has-active + 菜单项重绘（popover 保持打开，勾选不收起） */
function refreshTypeMenu(typeContainer: HTMLElement): void {
  const btn = typeContainer.querySelector('.Button');
  if (btn) {
    btn.classList.toggle('has-active', filterState.types.length > 0);
    const labelEl = btn.querySelector('.Button-label');
    if (labelEl) labelEl.textContent = typeButtonLabel();
  }
  const typeList = typeContainer.querySelector<HTMLUListElement>('ul');
  if (!typeList) return;

  typeList.innerHTML = '';
  // All：勾选态 = 本维度无任何已选；点击清空本维度其余选择（面板不收起）
  typeList.appendChild(
    buildMultiSelectItem('All', filterState.types.length === 0, () => {
      filterState.types = [];
      applyFilters();
    })
  );
  for (const value of computeTypeCandidates()) {
    const opt = TYPE_OPTIONS.find((o) => o.value === value);
    if (!opt) continue;
    typeList.appendChild(
      buildMultiSelectItem(opt.label, filterState.types.includes(value), () =>
        toggleTypeSelection(value)
      )
    );
  }
}

/* ---------------- Language（多选 OR） ---------------- */

/** 语言已选判定（大小写不敏感：URL 入口的值与缓存值可能大小写不同） */
function langSelected(lang: string): boolean {
  return filterState.langs.some((l) => l.toLowerCase() === lang.toLowerCase());
}

/** 语言候选切换：命中任一已选语言即过（OR）；LANG_NONE = 无语言仓库；再次点击取消 */
function toggleLangSelection(lang: string): void {
  const idx = filterState.langs.findIndex((l) => l.toLowerCase() === lang.toLowerCase());
  if (idx >= 0) filterState.langs.splice(idx, 1);
  else filterState.langs.push(lang);
  applyFilters();
}

/** Language 按钮文案：无选中 = Language；单选 = Language: X；多选 = Language: N selected */
function langButtonLabel(): string {
  const n = filterState.langs.length;
  if (n === 0) return 'Language';
  if (n === 1) {
    const l = filterState.langs[0];
    return 'Language: ' + (l === LANG_NONE ? LANG_NONE_LABEL : l);
  }
  return `Language: ${n} selected`;
}

/** Language 容器骨架（只建一次），同 buildTypeMenu */
function buildLangMenu(): HTMLElement {
  const langContainer = document.createElement('div');
  langContainer.className = 'stars-custom-filter gsm-lang-filter mb-1 mb-lg-0';

  const langBtnEl = document.createElement('button');
  langBtnEl.type = 'button';
  langBtnEl.id = 'stars-custom-lang-button';
  langBtnEl.setAttribute('popovertarget', 'stars-custom-lang-overlay');
  langBtnEl.setAttribute('aria-haspopup', 'true');
  langBtnEl.className = 'Button--secondary Button--medium Button';
  langBtnEl.innerHTML =
    '<span class="Button-content"><span class="Button-label"></span></span>' +
    '<span class="Button-visual Button-trailingAction">' +
    TRIANGLE_DOWN_SVG +
    '</span>';

  const langOverlay = document.createElement('anchored-position');
  langOverlay.id = 'stars-custom-lang-overlay';
  langOverlay.setAttribute('anchor', 'stars-custom-lang-button');
  langOverlay.setAttribute('align', 'start');
  langOverlay.setAttribute('side', 'outside-bottom');
  langOverlay.setAttribute('anchor-offset', 'normal');
  langOverlay.setAttribute('popover', 'auto');

  const langInner = document.createElement('div');
  langInner.className = 'Overlay Overlay--size-auto';
  const langBody = document.createElement('div');
  langBody.className = 'Overlay-body Overlay-body--paddingNone';
  const langList = document.createElement('ul');
  langList.className = 'ActionListWrap--inset ActionListWrap';
  langList.setAttribute('role', 'menu');

  langBody.appendChild(langList);
  langInner.appendChild(langBody);
  langOverlay.appendChild(langInner);
  langContainer.appendChild(langBtnEl);
  langContainer.appendChild(langOverlay);
  return langContainer;
}

/** Language 原位刷新：All languages + 候选 + None（末尾，4.3.2）；popover 保持打开 */
function refreshLangMenu(langContainer: HTMLElement): void {
  const btn = langContainer.querySelector('.Button');
  if (btn) {
    btn.classList.toggle('has-active', filterState.langs.length > 0);
    const labelEl = btn.querySelector('.Button-label');
    if (labelEl) labelEl.textContent = langButtonLabel();
  }
  const langList = langContainer.querySelector<HTMLUListElement>('ul');
  if (!langList) return;

  langList.innerHTML = '';
  langList.appendChild(
    buildMultiSelectItem('All languages', filterState.langs.length === 0, () => {
      filterState.langs = [];
      applyFilters();
    })
  );
  for (const lang of computeLanguageCandidates()) {
    langList.appendChild(
      buildMultiSelectItem(lang, langSelected(lang), () => toggleLangSelection(lang))
    );
  }
  // None 项放菜单末尾（字母序候选之后）；当前约束下存在才展示，D1 动态收窄
  if (hasLangNoneCandidate()) {
    langList.appendChild(
      buildMultiSelectItem(LANG_NONE_LABEL, filterState.langs.includes(LANG_NONE), () =>
        toggleLangSelection(LANG_NONE)
      )
    );
  }
}

/* ---------------- Sort + 方向（单选，行为不变：选择后收起） ---------------- */

/**
 * Sort 合并组骨架（R5 split button）：左段 = Sort by 菜单，右段 = 纯方向 icon
 * （无文字，点击切换 asc/desc），中间只有一条竖线分隔（CSS 边框重叠）。
 * 方向态只由 icon（↑/↓）表达——不加 has-active 蓝圈（用户 4.2.0 反馈：多余）。
 */
function buildSortGroup(): HTMLElement {
  const sortContainer = document.createElement('div');
  sortContainer.className = 'stars-custom-filter gsm-sort-filter mb-1 mb-lg-0 ml-2';

  const group = document.createElement('div');
  group.className = 'gsm-sort-group';

  // --- 左段：Sort by 菜单按钮 ---
  const sortBtnEl = document.createElement('button');
  sortBtnEl.type = 'button';
  sortBtnEl.id = 'stars-custom-sort-button';
  sortBtnEl.setAttribute('popovertarget', 'stars-custom-sort-overlay');
  sortBtnEl.setAttribute('aria-haspopup', 'true');
  sortBtnEl.className = 'Button--secondary Button--medium Button';
  sortBtnEl.innerHTML =
    '<span class="Button-content"><span class="Button-label"></span></span>' +
    '<span class="Button-visual Button-trailingAction">' +
    TRIANGLE_DOWN_SVG +
    '</span>';

  // --- 右段：方向切换（纯 icon） ---
  const dirBtn = document.createElement('button');
  dirBtn.type = 'button';
  dirBtn.id = 'stars-custom-dir-button';
  dirBtn.className = 'Button--secondary Button--medium Button gsm-dir-btn';
  dirBtn.setAttribute('aria-label', '切换排序方向');
  dirBtn.addEventListener('click', () => {
    filterState.direction = filterState.direction === 'desc' ? 'asc' : 'desc';
    applyFilters();
  });

  group.append(sortBtnEl, dirBtn);
  sortContainer.appendChild(group);

  // --- Sort 菜单 overlay ---
  const sortOverlay = document.createElement('anchored-position');
  sortOverlay.id = 'stars-custom-sort-overlay';
  sortOverlay.setAttribute('anchor', 'stars-custom-sort-button');
  sortOverlay.setAttribute('align', 'start');
  sortOverlay.setAttribute('side', 'outside-bottom');
  sortOverlay.setAttribute('anchor-offset', 'normal');
  sortOverlay.setAttribute('popover', 'auto');

  const sortInner = document.createElement('div');
  sortInner.className = 'Overlay Overlay--size-auto';
  const sortBody = document.createElement('div');
  sortBody.className = 'Overlay-body Overlay-body--paddingNone';
  const sortList = document.createElement('ul');
  sortList.className = 'ActionListWrap--inset ActionListWrap';
  sortList.setAttribute('role', 'menu');

  sortBody.appendChild(sortList);
  sortInner.appendChild(sortBody);
  sortOverlay.appendChild(sortInner);
  sortContainer.appendChild(sortOverlay);
  return sortContainer;
}

/**
 * Sort 原位刷新：左段文案 + 右段方向 icon + 菜单项 radio 勾选态。
 * Sort 仍为单选（menuitemradio，选择后收起面板）——多选化只针对 Type/Language。
 */
function refreshSortGroup(sortContainer: HTMLElement): void {
  const sortLabelEl = sortContainer.querySelector('.Button-label');
  if (sortLabelEl) {
    const active = SORT_OPTIONS.find((o) => o.key === filterState.sort) || SORT_OPTIONS[0];
    sortLabelEl.textContent = 'Sort by: ' + active.label;
  }
  const dirBtn = sortContainer.querySelector<HTMLElement>('#stars-custom-dir-button');
  if (dirBtn) {
    const isAsc = filterState.direction === 'asc';
    dirBtn.title = isAsc ? '排序方向：升序（点击切为降序）' : '排序方向：降序（点击切为升序）';
    dirBtn.innerHTML =
      '<span class="Button-content">' + (isAsc ? ARROW_UP_SVG : ARROW_DOWN_SVG) + '</span>';
  }
  const sortList = sortContainer.querySelector<HTMLUListElement>('ul');
  if (!sortList) return;

  sortList.innerHTML = '';
  SORT_OPTIONS.forEach((opt) => {
    const li = document.createElement('li');
    li.className = 'ActionListItem';
    li.setAttribute('role', 'none');
    const content = document.createElement('a');
    content.className = 'ActionListContent';
    content.setAttribute('role', 'menuitemradio');
    content.setAttribute('aria-checked', String(filterState.sort === opt.key));
    const label = document.createElement('span');
    label.className = 'ActionListItem-label';
    label.textContent = opt.label;
    content.appendChild(label);
    content.addEventListener('click', (e) => {
      e.preventDefault();
      filterState.sort = opt.key;
      sortContainer.querySelector<HTMLElement>('#stars-custom-sort-overlay')?.hidePopover();
      applyFilters();
    });
    li.appendChild(content);
    sortList.appendChild(li);
  });
}
