import {
  ARROW_DOWN_SVG,
  ARROW_UP_SVG,
  NATIVE_PAGE_SIZE,
  SORT_OPTIONS,
  TRIANGLE_DOWN_SVG,
  TYPE_OPTIONS,
} from './constants';
import { getNativeFilterBar, getNativeFilterRow, getStarsMainColumn } from './dom';
import { filterState, hasActiveFilter } from './state';
import { loadAllNotes } from './storage/notes';
import { loadRepoCache } from './storage/repoCache';
import { loadAllTags } from './storage/tags';
import { buildCardFromCache, createStarButtonForCached } from './ui/cards';
import { renderNotes } from './ui/notes';
import { refreshTagFilterBar, refreshTagPillStates, renderTagFilterBar, renderTags } from './ui/tagFilter';
import { escapeHtml } from './utils';
import type { FilteredRepo, RepoData, TypeFilter } from './types';

/**
 * 筛选/排序引擎（4.1.0 全本地化；4.2.0 Type 接管）：
 * - `queryRepos()`：唯一查询管线（type → lang → tags AND → search → 排序），
 *   browse 态、标签筛选、搜索、facet 候选计算全部走它（R2）；
 * - `sortResults()`：4 排序键 × asc/desc + 缺失值恒沉底 + 名称决胜（R1/R4/R5）；
 * - `initFiltersFromUrl()`：进页时从 URL 参数初始化（URL 只读不写，R6/D3）；
 * - `updateLocalFilterControls()`：常驻本地 Type/Language/Sort(+方向) 接管原生菜单。
 */

/** facet 候选计算时可跳过的约束维度 */
export type QuerySkip = 'lang' | 'type';

/**
 * 按 filterState.sort/direction 就地排序。
 * 规则（§4.3）：缺失值恒沉底、不随方向翻转；平局按仓库名决胜；全确定性。
 * `created` = starredAt（Recently starred）、`updated` = updatedAt（Recently active）、
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
export function queryRepos(skip?: QuerySkip): FilteredRepo[] {
  const cache = loadRepoCache();
  const allTags = loadAllTags();
  const allNotes = loadAllNotes();
  const terms = filterState.searchQuery.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
  const results: FilteredRepo[] = [];

  for (const repoId in cache) {
    const data = cache[repoId];
    // Type 筛选（单选，替换语义）
    if (skip !== 'type' && filterState.type && !typeMatches(data, filterState.type)) continue;
    // 语言筛选（单选，替换语义）；LANG_NONE = 无语言仓库（菜单 None 项，4.3.2）
    if (skip !== 'lang' && filterState.lang) {
      if (
        filterState.lang === LANG_NONE
          ? !!data.lang
          : (data.lang || '').toLowerCase() !== filterState.lang.toLowerCase()
      ) {
        continue;
      }
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
 * 按命中数降序、平局字母序（计数为 queryRepos 副产品，零额外成本）。
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
 * Language 候选（单选替换语义，D1：忽略自身当前值，否则选完就剩一项没法切）：
 * `queryRepos('lang')` 里出现的语言 ∪ 当前 lang（已选恒可见）。
 */
export function computeLanguageCandidates(): string[] {
  const langs = new Set<string>();
  for (const { data } of queryRepos('lang')) {
    if (data.lang) langs.add(data.lang);
  }
  if (filterState.lang && filterState.lang !== LANG_NONE) langs.add(filterState.lang);
  return Array.from(langs).sort((a, b) => a.localeCompare(b));
}

/** Language 菜单「None」哨兵值：无语言仓库（data.lang 为空；linguist 无同名语言，不会撞车） */
export const LANG_NONE = '(none)';
/** None 在界面上的显示文案 */
export const LANG_NONE_LABEL = 'None';

/** 无语言仓库是否存在（当前约束下动态收窄，D1；已选恒可见） */
function hasLangNoneCandidate(): boolean {
  if (filterState.lang === LANG_NONE) return true;
  for (const { data } of queryRepos('lang')) {
    if (!data.lang) return true;
  }
  return false;
}

/**
 * Type 候选（单选替换语义，同上忽略自身当前值）：
 * `queryRepos('type')` 结果里能命中的 type 值 ∪ 当前 type；菜单顺序固定为原生序。
 */
export function computeTypeCandidates(): TypeFilter[] {
  const present = new Set<TypeFilter>();
  for (const { data } of queryRepos('type')) {
    for (const opt of TYPE_OPTIONS) {
      if (typeMatches(data, opt.value)) present.add(opt.value);
    }
  }
  if (filterState.type) present.add(filterState.type); // 已选恒可见（可切回 All）
  return TYPE_OPTIONS.map((o) => o.value).filter((v) => present.has(v));
}

/** 4.0.0 纯本地浏览态：缓存 → 查询管线 → 切页渲染（无筛选激活时分页浏览全部缓存） */
export function renderBrowsePage(page: number): void {
  const gridContainer = document.querySelector('.stars-grid-container');
  if (!gridContainer) return;

  const results = queryRepos();
  const totalPages = Math.max(1, Math.ceil(results.length / NATIVE_PAGE_SIZE));
  filterState.page = Math.min(Math.max(1, page), totalPages);
  filterState.totalPages = totalPages;
  const start = (filterState.page - 1) * NATIVE_PAGE_SIZE;

  gridContainer.innerHTML = '';
  for (const { repoId, data } of results.slice(start, start + NATIVE_PAGE_SIZE)) {
    const card = buildCardFromCache(repoId, data);
    gridContainer.appendChild(card);
    createStarButtonForCached(card, data);
    const tagsContainer = card.querySelector<HTMLElement>('.stars-card-tags');
    if (tagsContainer) renderTags(tagsContainer);
    const notesContainer = card.querySelector<HTMLElement>('.stars-card-notes');
    if (notesContainer) renderNotes(notesContainer);
  }

  updateLocalPagers();
}

/** 同步顶/底两份本地分页器：页码文字 + Previous/Next 禁用态 */
function updateLocalPagers(): void {
  document.querySelectorAll<HTMLElement>('.paginate-container.gsm-local-pager').forEach((pager) => {
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
export function renderFilterInfoBar(count: number): void {
  // 移除旧信息条
  document.querySelectorAll('.stars-tag-info-bar').forEach((el) => el.remove());

  if (!hasActiveFilter()) return;

  const colLg9 = getStarsMainColumn();
  if (!colLg9) return;
  const gridContainer = colLg9.querySelector('.stars-grid-container');
  if (!gridContainer) return;

  // 隐藏原生 clear filter 条
  const nativeBar = getNativeFilterBar(colLg9);
  if (nativeBar) nativeBar.style.display = 'none';

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
  if (filterState.type) {
    const label = TYPE_OPTIONS.find((o) => o.value === filterState.type)?.label || filterState.type;
    desc += ' · type: <strong>' + escapeHtml(label) + '</strong>';
  }
  if (filterState.lang) {
    desc += ' · language: <strong>' + escapeHtml(filterState.lang === LANG_NONE ? LANG_NONE_LABEL : filterState.lang) + '</strong>';
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

/** 应用当前筛选状态：browse 态分页渲染 / 筛选态平铺 + 信息条；常驻本地控件随状态重建 */
export function applyFilters(): void {
  // 1. 移除旧的缓存卡片
  document.querySelectorAll('.stars-grid-card-cached').forEach((el) => el.remove());

  const cards = document.querySelectorAll('.stars-grid-card:not(.stars-grid-card-cached)');
  const gridContainer = document.querySelector('.stars-grid-container');
  const paginator = gridContainer ? gridContainer.querySelector<HTMLElement>('.paginate-container') : null;

  // 常驻本地控件（Type / Language / Sort+方向）：状态驱动重建，同时保证原生菜单持续隐藏
  updateLocalFilterControls();
  // Tags 候选随当前约束刷新（R3，4.3.4）：type/lang/搜索/勾选变化后原位收窄回填——
  // 杜绝「切了 Type/Language 后 chip 列表还是旧全集」与「空结果取消勾选后面板永久空白」
  refreshTagFilterBar();

  // 2. 无任何筛选激活（sort/direction 属浏览状态）→ browse 态：本地分页
  if (!hasActiveFilter()) {
    cards.forEach((card) => card.classList.remove('stars-tag-filtered'));
    if (paginator) paginator.style.display = '';
    document.querySelectorAll<HTMLElement>('.gsm-top-pager').forEach((el) => {
      el.style.display = '';
    });
    renderBrowsePage(1);

    // 移除 info bar 并恢复原生 clear filter 条
    document.querySelectorAll('.stars-tag-info-bar').forEach((el) => el.remove());
    const colLg9 = getStarsMainColumn();
    if (colLg9) {
      const nativeBar = getNativeFilterBar(colLg9);
      if (nativeBar) nativeBar.style.display = '';
    }
    return;
  }

  // 3. 筛选态（tags/lang/type/search 任一激活）：结果平铺不分页（D5）
  cards.forEach((card) => card.classList.add('stars-tag-filtered'));
  if (paginator) paginator.style.display = 'none';
  // 顶部分页器同藏（它在 headerRow 里，不在 gridContainer 内）
  document.querySelectorAll<HTMLElement>('.gsm-top-pager').forEach((el) => {
    el.style.display = 'none';
  });

  const results = queryRepos();
  if (!gridContainer) return;

  // 4. 为每个结果构建缓存卡片
  results.forEach(({ repoId, data }) => {
    const cachedCard = buildCardFromCache(repoId, data);
    gridContainer.appendChild(cachedCard);

    // 星星按钮
    createStarButtonForCached(cachedCard, data);

    // 标签
    const tagsContainer = cachedCard.querySelector<HTMLElement>('.stars-card-tags');
    if (tagsContainer) renderTags(tagsContainer);

    // 备注
    const notesContainer = cachedCard.querySelector<HTMLElement>('.stars-card-notes');
    if (notesContainer) renderNotes(notesContainer);

    // 搜索模式：高亮命中词（标题 / 描述 / 标签 / 备注）
    if (filterState.searchQuery) {
      highlightMatchesInCard(
        cachedCard,
        filterState.searchQuery.toLowerCase().split(/\s+/).filter((t) => t.length > 0)
      );
    }
  });

  // 5. 展示计数信息条
  renderFilterInfoBar(results.length);
}

/** 退出全部筛选（Clear filter 本地化）：清 tags/lang/type/search，保留 sort/direction（D4）→ 干净地址栏 */
export function exitCustomMode(): void {
  filterState.tags = [];
  filterState.lang = '';
  filterState.type = '';
  filterState.searchQuery = '';
  filterState.page = 1;
  const searchInput = document.querySelector<HTMLInputElement>(
    'input[placeholder*="Search starred"]'
  );
  if (searchInput) searchInput.value = '';
  applyFilters();
  renderTagFilterBar();
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
  const langParam = p.get('language') || '';
  // `?language=none`（或 `(none)`）= 无语言（4.3.2）
  filterState.lang = /^\(?none\)?$/i.test(langParam) ? LANG_NONE : langParam;
  const type = p.get('type');
  filterState.type =
    type === 'public' ||
    type === 'private' ||
    type === 'source' ||
    type === 'fork' ||
    type === 'mirror' ||
    type === 'template'
      ? type
      : '';
  filterState.page = 1;
}

/* ================================================================
 * 常驻本地筛选控件（R2 + R5，4.2.0 Type 接管）：一次性接管，不再随模式切换
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
    if (menu instanceof HTMLElement) menu.style.display = 'none';
  }
}

/** 重建常驻本地控件（Type / Language 菜单 + Sort 合并组）；幂等，applyFilters 每次调用 */
function updateLocalFilterControls(): void {
  hideNativeFilterMenus();
  document.querySelectorAll('.stars-custom-filter').forEach((el) => el.remove());

  const filterRow = getNativeFilterRow();
  if (!filterRow) return;

  // 布局 [Tags][Type][Language][Sort by│↓]：锚点 = Tags 之后（无 Tags 时行首）
  const tagFilter = filterRow.querySelector('.stars-tag-filter');
  const anchorNode: ChildNode | null = tagFilter || filterRow.firstChild;

  const typeContainer = buildTypeMenu();
  const langContainer = buildLangMenu();
  const sortContainer = buildSortGroup();
  if (anchorNode && anchorNode.parentNode === filterRow) {
    filterRow.insertBefore(typeContainer, anchorNode.nextSibling);
  } else {
    filterRow.appendChild(typeContainer);
  }
  filterRow.insertBefore(langContainer, typeContainer.nextSibling);
  filterRow.insertBefore(sortContainer, langContainer.nextSibling);
}

/** 自定义 Type 按钮 + 菜单（候选 = computeTypeCandidates 动态收窄，D1 替换语义；All 恒在） */
function buildTypeMenu(): HTMLElement {
  const typeContainer = document.createElement('div');
  typeContainer.className = 'stars-custom-filter mb-1 mb-lg-0 mr-2';

  const activeOpt = TYPE_OPTIONS.find((o) => o.value === filterState.type);
  const typeBtnEl = document.createElement('button');
  typeBtnEl.type = 'button';
  typeBtnEl.id = 'stars-custom-type-button';
  typeBtnEl.setAttribute('popovertarget', 'stars-custom-type-overlay');
  typeBtnEl.setAttribute('aria-haspopup', 'true');
  typeBtnEl.className = 'Button--secondary Button--medium Button';
  if (filterState.type) typeBtnEl.classList.add('has-active');
  typeBtnEl.innerHTML =
    '<span class="Button-content"><span class="Button-label"></span></span>' +
    '<span class="Button-visual Button-trailingAction">' +
    TRIANGLE_DOWN_SVG +
    '</span>';
  const typeLabelEl = typeBtnEl.querySelector('.Button-label');
  if (typeLabelEl) typeLabelEl.textContent = activeOpt ? 'Type: ' + activeOpt.label : 'Type';

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

  const addItem = (label: string, value: TypeFilter): void => {
    const li = document.createElement('li');
    li.className = 'ActionListItem';
    li.setAttribute('role', 'none');
    const content = document.createElement('a');
    content.className = 'ActionListContent';
    content.setAttribute('role', 'menuitemradio');
    content.setAttribute('aria-checked', String(filterState.type === value));
    const labelEl = document.createElement('span');
    labelEl.className = 'ActionListItem-label';
    labelEl.textContent = label;
    content.appendChild(labelEl);
    content.addEventListener('click', (e) => {
      e.preventDefault();
      filterState.type = value;
      typeOverlay.hidePopover();
      applyFilters();
    });
    li.appendChild(content);
    typeList.appendChild(li);
  };

  addItem('All', '');
  for (const value of computeTypeCandidates()) {
    const opt = TYPE_OPTIONS.find((o) => o.value === value);
    if (opt) addItem(opt.label, value);
  }

  typeBody.appendChild(typeList);
  typeInner.appendChild(typeBody);
  typeOverlay.appendChild(typeInner);
  typeContainer.appendChild(typeBtnEl);
  typeContainer.appendChild(typeOverlay);
  return typeContainer;
}

/** 自定义 Language 按钮 + 菜单（候选 = computeLanguageCandidates 动态收窄，D1 替换语义） */
function buildLangMenu(): HTMLElement {
  const langContainer = document.createElement('div');
  langContainer.className = 'stars-custom-filter mb-1 mb-lg-0';

  const languages = computeLanguageCandidates();
  const langBtnLabel = filterState.lang
    ? 'Language: ' + (filterState.lang === LANG_NONE ? LANG_NONE_LABEL : filterState.lang)
    : 'Language';
  const langBtnEl = document.createElement('button');
  langBtnEl.type = 'button';
  langBtnEl.id = 'stars-custom-lang-button';
  langBtnEl.setAttribute('popovertarget', 'stars-custom-lang-overlay');
  langBtnEl.setAttribute('aria-haspopup', 'true');
  langBtnEl.className = 'Button--secondary Button--medium Button';
  if (filterState.lang) langBtnEl.classList.add('has-active');
  langBtnEl.innerHTML =
    '<span class="Button-content"><span class="Button-label"></span></span>' +
    '<span class="Button-visual Button-trailingAction">' +
    TRIANGLE_DOWN_SVG +
    '</span>';
  const langLabelEl = langBtnEl.querySelector('.Button-label');
  if (langLabelEl) langLabelEl.textContent = langBtnLabel;

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

  // "All languages" 选项
  const allLi = document.createElement('li');
  allLi.className = 'ActionListItem';
  allLi.setAttribute('role', 'none');
  const allContent = document.createElement('a');
  allContent.className = 'ActionListContent';
  allContent.setAttribute('role', 'menuitemradio');
  allContent.setAttribute('aria-checked', String(!filterState.lang));
  const allLabel = document.createElement('span');
  allLabel.className = 'ActionListItem-label';
  allLabel.textContent = 'All languages';
  allContent.appendChild(allLabel);
  allContent.addEventListener('click', (e) => {
    e.preventDefault();
    filterState.lang = '';
    langOverlay.hidePopover();
    applyFilters();
  });
  allLi.appendChild(allContent);
  langList.appendChild(allLi);

  languages.forEach((lang) => {
    const li = document.createElement('li');
    li.className = 'ActionListItem';
    li.setAttribute('role', 'none');
    const content = document.createElement('a');
    content.className = 'ActionListContent';
    content.setAttribute('role', 'menuitemradio');
    content.setAttribute('aria-checked', String(filterState.lang.toLowerCase() === lang.toLowerCase()));
    const label = document.createElement('span');
    label.className = 'ActionListItem-label';
    label.textContent = lang;
    content.appendChild(label);
    content.addEventListener('click', (e) => {
      e.preventDefault();
      filterState.lang = lang;
      langOverlay.hidePopover();
      applyFilters();
    });
    li.appendChild(content);
    langList.appendChild(li);
  });

  // None 项（无语言仓库）放菜单末尾（字母序候选之后）；当前约束下存在才展示，D1 动态收窄
  if (hasLangNoneCandidate()) {
    const noneLi = document.createElement('li');
    noneLi.className = 'ActionListItem';
    noneLi.setAttribute('role', 'none');
    const noneContent = document.createElement('a');
    noneContent.className = 'ActionListContent';
    noneContent.setAttribute('role', 'menuitemradio');
    noneContent.setAttribute('aria-checked', String(filterState.lang === LANG_NONE));
    const noneLabel = document.createElement('span');
    noneLabel.className = 'ActionListItem-label';
    noneLabel.textContent = LANG_NONE_LABEL;
    noneContent.appendChild(noneLabel);
    noneContent.addEventListener('click', (e) => {
      e.preventDefault();
      filterState.lang = LANG_NONE;
      langOverlay.hidePopover();
      applyFilters();
    });
    noneLi.appendChild(noneContent);
    langList.appendChild(noneLi);
  }

  langBody.appendChild(langList);
  langInner.appendChild(langBody);
  langOverlay.appendChild(langInner);
  langContainer.appendChild(langBtnEl);
  langContainer.appendChild(langOverlay);
  return langContainer;
}

/**
 * Sort 合并组（R5 split button）：左段 = Sort by 菜单，右段 = 纯方向 icon
 * （无文字，点击切换 asc/desc），中间只有一条竖线分隔（CSS 边框重叠）。
 * 方向态只由 icon（↑/↓）表达——不加 has-active 蓝圈（用户 4.2.0 反馈：多余）。
 */
function buildSortGroup(): HTMLElement {
  const sortContainer = document.createElement('div');
  sortContainer.className = 'stars-custom-filter mb-1 mb-lg-0 ml-2';

  const group = document.createElement('div');
  group.className = 'gsm-sort-group';

  // --- 左段：Sort by 菜单 ---
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
  const sortLabelEl = sortBtnEl.querySelector('.Button-label');
  if (sortLabelEl) {
    const active = SORT_OPTIONS.find((o) => o.key === filterState.sort) || SORT_OPTIONS[0];
    sortLabelEl.textContent = 'Sort by: ' + active.label;
  }

  // --- 右段：方向切换（纯 icon） ---
  const dirBtn = document.createElement('button');
  dirBtn.type = 'button';
  dirBtn.id = 'stars-custom-dir-button';
  dirBtn.className = 'Button--secondary Button--medium Button gsm-dir-btn';
  const isAsc = filterState.direction === 'asc';
  dirBtn.title = isAsc ? '排序方向：升序（点击切为降序）' : '排序方向：降序（点击切为升序）';
  dirBtn.setAttribute('aria-label', '切换排序方向');
  dirBtn.innerHTML =
    '<span class="Button-content">' + (isAsc ? ARROW_UP_SVG : ARROW_DOWN_SVG) + '</span>';
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
      sortOverlay.hidePopover();
      applyFilters();
    });
    li.appendChild(content);
    sortList.appendChild(li);
  });

  sortBody.appendChild(sortList);
  sortInner.appendChild(sortBody);
  sortOverlay.appendChild(sortInner);
  sortContainer.appendChild(sortOverlay);
  return sortContainer;
}
