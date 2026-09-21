import { getRepoIdMeta, getToggler, isStarredInToggler } from './dom';
import { saveRepoData } from './storage/repoCache';

/** 从仓库详情页提取元数据写入缓存（不缓存当前用户未 star 的仓库） */
export function extractAndCacheRepoFromDetailPage(): void {
  const repoIdMeta = getRepoIdMeta();
  if (!repoIdMeta) return;
  const repoId = repoIdMeta.getAttribute('content');
  if (!repoId) return;

  // 不缓存当前用户未 star 的仓库
  const toggler = getToggler(document);
  if (toggler && !isStarredInToggler(toggler)) return;

  const nwoMeta = document.querySelector('meta[name="octolytics-dimension-repository_nwo"]');
  const name = nwoMeta ? nwoMeta.getAttribute('content') || '' : '';

  // 描述
  const descEl = document.querySelector('.BorderGrid-cell p');
  const desc = descEl ? (descEl.textContent || '').trim() : '';

  // 主语言 + 语言色
  let lang = '';
  let langColor = '';
  const langItems = document.querySelectorAll('.list-style-none li');
  if (langItems.length > 0) {
    const firstLangSpan = langItems[0].querySelector('span');
    if (firstLangSpan) lang = (firstLangSpan.textContent || '').trim();
  }
  const progressItems = document.querySelectorAll<HTMLElement>('.Progress-item');
  // 取第一个带真实 background-color 的 Progress-item
  for (const pi of progressItems) {
    const bg = pi.style.backgroundColor;
    if (bg) {
      langColor = bg;
      break;
    }
  }

  // Star 数（精确值）
  let stars = 0;
  const starCounter = document.querySelector('#repo-stars-counter-star') ||
                      document.querySelector('#repo-stars-counter-unstar');
  if (starCounter) {
    const ariaLabel = starCounter.getAttribute('aria-label') || '';
    const ariaMatch = ariaLabel.match(/([\d,]+)\s+users?\s+starred/);
    if (ariaMatch) {
      stars = parseInt(ariaMatch[1].replace(/,/g, ''), 10);
    } else {
      const titleAttr = starCounter.getAttribute('title') || '';
      stars = parseInt(titleAttr.replace(/,/g, ''), 10) || 0;
    }
  }

  // Fork 数（精确值）
  let forks = 0;
  const forkCounter = document.querySelector('#repo-network-counter');
  if (forkCounter) {
    const titleAttr = forkCounter.getAttribute('title') || '';
    forks = parseInt(titleAttr.replace(/,/g, ''), 10) || 0;
  }

  // 更新时间（相对时间文本在 shadow DOM 内）
  let updated = '';
  const relTime = document.querySelector('.BorderGrid-cell relative-time');
  if (relTime && relTime.shadowRoot) {
    const shadowText = (relTime.shadowRoot.textContent || '').trim();
    if (shadowText) updated = 'Updated ' + shadowText;
  }
  if (!updated && relTime) {
    // 兜底：shadow DOM 不可用时用 datetime 属性判断
    const dt = relTime.getAttribute('datetime');
    if (dt) updated = 'Updated ' + (relTime.textContent || '').trim();
  }

  saveRepoData(repoId, { name, desc, lang, langColor, stars, forks, updated });
}

/** 从 Stars 列表项（卡片）提取元数据写入缓存（不缓存当前用户未 star 的仓库） */
export function extractAndCacheRepoFromCard(item: Element, repoId: string): void {
  if (!repoId) return;

  // 不缓存当前用户未 star 的仓库
  const toggler = getToggler(item);
  if (toggler && !isStarredInToggler(toggler)) return;

  // 名称
  const h3 = item.querySelector('h3');
  let name = '';
  if (h3) {
    const repoLink = h3.querySelector('a');
    if (repoLink) {
      const href = repoLink.getAttribute('href') || '';
      name = href.startsWith('/') ? href.substring(1) : href;
    }
  }

  // 描述
  const descP = item.querySelector('p[itemprop="description"]');
  const desc = descP ? (descP.textContent || '').trim() : '';

  // 语言 / star / fork / 更新时间
  const metaDiv = item.querySelector('div.f6.color-fg-muted');
  let lang = '';
  let langColor = '';
  let stars = 0;
  let forks = 0;
  let updated = '';
  let updatedAt = '';

  if (metaDiv) {
    // 语言名
    const langNameEl = metaDiv.querySelector('span[itemprop="programmingLanguage"]');
    if (langNameEl) lang = (langNameEl.textContent || '').trim();

    // 语言色
    const langColorEl = metaDiv.querySelector('span.repo-language-color');
    if (langColorEl) langColor = langColorEl.getAttribute('style') || '';
    // 从形如 "background-color: #3178c6;" 的 style 里只取颜色值
    const colorMatch = langColor.match(/background-color:\s*([^;]+)/);
    langColor = colorMatch ? colorMatch[1].trim() : '';

    // Star 数（Stars 页上是完整数字，如 "29,208"）
    const starLink = metaDiv.querySelector('a[href*="/stargazers"]');
    if (starLink) {
      const starText = (starLink.textContent || '').replace(/[^\d]/g, '');
      stars = parseInt(starText, 10) || 0;
    }

    // Fork 数（完整数字）
    const forkLink = metaDiv.querySelector('a[href*="/forks"]');
    if (forkLink) {
      const forkText = (forkLink.textContent || '').replace(/[^\d]/g, '');
      forks = parseInt(forkText, 10) || 0;
    }

    // 更新文本 + updatedAt ISO 时间戳
    const allNodes = Array.from(metaDiv.childNodes);
    let foundUpdated = false;
    const updatedParts: string[] = [];
    for (const node of allNodes) {
      if (node.nodeType === Node.TEXT_NODE && (node.textContent || '').includes('Updated')) {
        foundUpdated = true;
      }
      if (foundUpdated) {
        if (node.nodeType === Node.TEXT_NODE) {
          updatedParts.push((node.textContent || '').trim());
        } else if ((node as Element).tagName === 'RELATIVE-TIME') {
          const el = node as Element;
          if (!updatedAt) updatedAt = el.getAttribute('datetime') || '';
          if (el.shadowRoot) {
            const shadowText = (el.shadowRoot.textContent || '').trim();
            if (shadowText) updatedParts.push(shadowText);
          } else {
            updatedParts.push((el.textContent || '').trim());
          }
        }
      }
    }
    if (updatedParts.length > 0) {
      updated = updatedParts.join(' ').replace(/\s+/g, ' ').trim();
    }
  }

  saveRepoData(repoId, { name, desc, lang, langColor, stars, forks, updated, updatedAt });
}
