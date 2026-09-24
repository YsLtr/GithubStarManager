import { getRepoIdMeta, getSidebarAbout, getToggler, isStarredInToggler } from './dom';
import { saveRepoData } from './storage/repoCache';
import { formatRelative } from './utils';
import type { RepoData } from './types';

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

  // 只缓存当前用户「确证已 star」的仓库（4.0.10 审查修复：星态未知一律不写，fail-closed。
  // 旧逻辑 about.star 缺失 / toggler 找不到时照写缓存——已取关仓库因此复活成脏态（ZCode 案例源头））
  const viewerHasStarred = about?.star?.viewerHasStarred;
  if (viewerHasStarred === false) return;
  if (viewerHasStarred !== true) {
    const toggler = getToggler(document);
    if (!toggler || !isStarredInToggler(toggler)) return;
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

  // 主语言不在此提取（4.3.1）：2026 版详情页没有 SidebarLanguages 模块、也没有 search?l= 链接（有语言的仓库同样没有），
  // 老版兜底 `.list-style-none li span` 在 2026 页面抓到的是 Watch/Fork 计数条（"Watch1 (1)"），曾覆盖 API 的好数据。
  // lang 所有权全归 API parseItem——与 4.3.0 拆 langColor 同一哲学：DOM 提取已死，宁缺勿错。

  // Star / Fork 数（新版 JSON 里是精确值，含真 0；DOM 兜底解析出的 0 视为「未解析」——
  // 不写盘、不覆盖同步写入的好数据，4.0.10 审查修复）
  const jsonStars = about && typeof about.stargazerCount === 'number' ? about.stargazerCount : null;
  const jsonForks = about && typeof about.forksCount === 'number' ? about.forksCount : null;
  let stars = jsonStars ?? 0;
  let forks = jsonForks ?? 0;
  if (jsonStars === null) {
    const starCounter = document.querySelector('#repo-stars-counter-star, #repo-stars-counter-unstar');
    if (starCounter) {
      const ariaLabel = starCounter.getAttribute('aria-label') || '';
      const ariaMatch = ariaLabel.match(/([\d,]+)\s+users?\s+starred/);
      stars = ariaMatch
        ? parseInt(ariaMatch[1].replace(/,/g, ''), 10) || 0
        : parseCount(starCounter.getAttribute('title') || '');
    }
    if (!stars) stars = parseSocialStat('star');
  }
  if (jsonForks === null) {
    const forkCounter = document.querySelector('#repo-network-counter');
    if (forkCounter) forks = parseCount(forkCounter.getAttribute('title') || '');
    if (!forks) forks = parseSocialStat('fork');
  }

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

  // 只写正向解析到的字段（4.0.10：解析失败的 0/空不落盘，防止把同步写入的好数据覆盖成 0/空）
  const patch: Partial<RepoData> = { name };
  if (desc) patch.desc = desc;
  if (jsonStars !== null || stars > 0) patch.stars = stars;
  if (jsonForks !== null || forks > 0) patch.forks = forks;
  if (updated) patch.updated = updated;
  if (updatedAt) patch.updatedAt = updatedAt;
  saveRepoData(repoId, patch);
}

