import { getRepoIdMeta, getSidebarAbout, getToggler, isStarredInToggler } from './dom';
import { saveRepoData } from './storage/repoCache';
import { formatRelative } from './utils';

/** 从 "1,234" / "1.2k" 这类文案里解析出数字 */
function parseCount(text: string): number {
  const m = text.match(/([\d.,]+)\s*([kKmM])?/);
  if (!m) return 0;
  let n = parseFloat(m[1].replace(/,/g, ''));
  if (!isFinite(n)) return 0;
  const unit = (m[2] || '').toLowerCase();
  if (unit === 'k') n *= 1000;
  else if (unit === 'm') n *= 1000000;
  return Math.round(n);
}

/**
 * 新版 React 侧栏的社交统计：`<span class="…socialStat…">376 stars</span>`。
 * 类名带哈希后缀，所以只做子串匹配（`[class*=…]`），靠文案关键词区分。
 */
function parseSocialStat(keyword: string): number {
  const stats = document.querySelectorAll('[class*="socialStat"]');
  for (const el of Array.from(stats)) {
    const text = (el.textContent || '').trim();
    if (!text.toLowerCase().includes(keyword)) continue;
    return parseCount(text);
  }
  return 0;
}

/** relative-time 的可见文本（相对时间在 shadow DOM 里） */
function readRelativeTime(el: Element): string {
  const shadow = el.shadowRoot;
  if (shadow) {
    const t = (shadow.textContent || '').trim();
    if (t) return t;
  }
  return (el.textContent || '').trim();
}

/**
 * 从仓库详情页提取元数据写入缓存（不缓存当前用户未 star 的仓库）。
 *
 * 2026 改版后详情页变成 React 应用，侧栏类名是 CSS-module 哈希
 * （`SidebarAbout-module__socialStat__nnJPx`），旧选择器（`.BorderGrid-cell`、
 * `#repo-stars-counter-star`）全部失效。现在优先读内嵌 JSON
 * （`react-app.embeddedData` → `payload.sidebarAbout`），DOM 只用于兜底
 * JSON 里没有的语言与更新时间。
 */
export function extractAndCacheRepoFromDetailPage(): void {
  const repoIdMeta = getRepoIdMeta();
  const repoId = repoIdMeta ? repoIdMeta.getAttribute('content') : '';
  if (!repoId) return;

  const about = getSidebarAbout();

  // 只缓存当前用户已 star 的仓库
  if (about && about.star) {
    if (about.star.viewerHasStarred === false) return;
  } else {
    const toggler = getToggler(document);
    if (toggler && !isStarredInToggler(toggler)) return;
  }

  // 名称
  const nwoMeta = document.querySelector('meta[name="octolytics-dimension-repository_nwo"]');
  let name = nwoMeta ? nwoMeta.getAttribute('content') || '' : '';
  if (!name && about && about.ownerLogin && about.repoName) {
    name = about.ownerLogin + '/' + about.repoName;
  }

  // 描述
  let desc = about && about.description ? about.description.trim() : '';
  if (!desc) {
    const descEl = document.querySelector('[class*="SidebarAbout-module__description"], .BorderGrid-cell p');
    desc = descEl ? (descEl.textContent || '').trim() : '';
  }

  // 主语言 + 语言色。
  // 新版：语言链接指向 /owner/repo/search?l=javascript，列表第一个即主语言；
  // 旧版：`.list-style-none li` + `.Progress-item` 的背景色。
  let lang = '';
  let langColor = '';
  const langScope = document.querySelector('[class*="SidebarLanguages"]') || document;
  const langLink = langScope.querySelector<HTMLAnchorElement>('a[href*="search?l="]') ||
    document.querySelector<HTMLAnchorElement>('a[href*="search?l="]');
  if (langLink) {
    const nameEl = langLink.querySelector('[class*="languageName"]');
    lang = ((nameEl ? nameEl.textContent : langLink.textContent) || '').replace(/[\d.]+%/g, '').trim();
    if (!lang) {
      const m = (langLink.getAttribute('href') || '').match(/[?&]l=([^&]+)/);
      if (m) lang = decodeURIComponent(m[1]);
    }
    const dot = langLink.querySelector('[class*="languageDot"]');
    if (dot instanceof HTMLElement) {
      langColor = dot.style.backgroundColor || getComputedStyle(dot).backgroundColor || '';
    }
  }
  if (!lang) {
    const firstLangSpan = document.querySelector('.list-style-none li span');
    if (firstLangSpan) lang = (firstLangSpan.textContent || '').trim();
  }
  if (!langColor) {
    const progressItems = document.querySelectorAll<HTMLElement>('.Progress-item');
    for (const pi of Array.from(progressItems)) {
      const bg = pi.style.backgroundColor;
      if (bg) { langColor = bg; break; }
    }
  }

  // Star / Fork 数（新版 JSON 里是精确值；旧版从计数器属性里取）
  let stars = about && typeof about.stargazerCount === 'number' ? about.stargazerCount : 0;
  let forks = about && typeof about.forksCount === 'number' ? about.forksCount : 0;
  if (!stars) {
    const starCounter = document.querySelector('#repo-stars-counter-star, #repo-stars-counter-unstar');
    if (starCounter) {
      const ariaLabel = starCounter.getAttribute('aria-label') || '';
      const ariaMatch = ariaLabel.match(/([\d,]+)\s+users?\s+starred/);
      stars = ariaMatch
        ? parseInt(ariaMatch[1].replace(/,/g, ''), 10) || 0
        : parseCount(starCounter.getAttribute('title') || '');
    }
  }
  if (!stars) stars = parseSocialStat('star');
  if (!forks) {
    const forkCounter = document.querySelector('#repo-network-counter');
    if (forkCounter) forks = parseCount(forkCounter.getAttribute('title') || '');
  }
  if (!forks) forks = parseSocialStat('fork');

  // 更新时间：新版页面上第一个 relative-time 就是默认分支的最新提交
  let updated = '';
  let updatedAt = '';
  const relTime = document.querySelector('.BorderGrid-cell relative-time') ||
    document.querySelector('relative-time[datetime]');
  if (relTime) {
    updatedAt = relTime.getAttribute('datetime') || '';
    const text = readRelativeTime(relTime);
    if (text) updated = 'Updated ' + text;
  }

  // 相对时间优先用 updatedAt 自己算（新渲染的绝对时间太长）
  if (updatedAt) {
    const rel = formatRelative(updatedAt);
    if (rel) updated = 'Updated ' + rel;
  }

  saveRepoData(repoId, { name, desc, lang, langColor, stars, forks, updated, updatedAt });
}

