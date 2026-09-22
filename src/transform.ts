import { getRepoIdFromItem, getRepoItems, getStarsMainColumn, hideListsSection } from './dom';
import { extractAndCacheRepoFromCard } from './extract';
import { applyFilters } from './filters';
import { interceptSearchForm } from './search';
import { createStarButton } from './ui/cards';
import { renderNotes } from './ui/notes';
import { renderTagFilterBar, renderTags } from './ui/tagFilter';
import { isDesktop } from './utils';

/**
 * 把 Stars 列表页转换成卡片网格。
 * @returns 是否已完成转换（或已经转换过）
 */
export function transformStarsList(): boolean {
  if (!isDesktop()) return false;

  // Lists 区块（标题行 + 内容）与卡片网格无关，尽早隐藏；
  // 放在所有 early return 之前，turbo-frame 重渲染后再进来一次也不会漏。
  hideListsSection();

  const turboFrame = document.getElementById('user-starred-repos');
  if (!turboFrame) return false;

  const colLg9 = getStarsMainColumn();
  if (!colLg9) return false;

  const repoItems = getRepoItems(colLg9);
  if (repoItems.length === 0) {
    return !!colLg9.querySelector('.stars-grid-container');
  }

  if (colLg9.querySelector('.stars-grid-container')) return true;

  const gridContainer = document.createElement('div');
  gridContainer.className = 'stars-grid-container';

  repoItems.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'stars-grid-card';

    // 提取 repoId
    const repoId = getRepoIdFromItem(item);
    if (repoId) card.dataset.repoId = repoId;

    // 提取 repoName（href）
    const h3 = item.querySelector('h3');
    if (h3) {
      const repoLink = h3.querySelector('a');
      if (repoLink) card.dataset.repoName = repoLink.getAttribute('href') || '';
    }

    const descP = item.querySelector('p[itemprop="description"]');
    const metaDiv = item.querySelector('div.f6.color-fg-muted');

    let cardHTML = '<div class="stars-card-header">';
    if (h3) cardHTML += `<h3>${h3.innerHTML}</h3>`;
    cardHTML += '</div>';

    if (descP) {
      cardHTML += `<p class="stars-card-desc">${(descP.textContent || '').trim()}</p>`;
    } else {
      cardHTML += '<p class="stars-card-desc" style="opacity:0.5;font-style:italic;">No description</p>';
    }

    // 标签容器
    cardHTML += `<div class="stars-card-tags" data-repo-id="${repoId}"></div>`;

    if (metaDiv) {
      const langSpan = metaDiv.querySelector('span.ml-0, span:has(.repo-language-color)');
      const starLink = metaDiv.querySelector('a[href*="/stargazers"]');
      const forkLink = metaDiv.querySelector('a[href*="/forks"]');

      let mainParts = '';
      if (langSpan) mainParts += langSpan.outerHTML;
      if (starLink) mainParts += starLink.outerHTML;
      if (forkLink) mainParts += forkLink.outerHTML;

      let updatedHTML = '';
      const allNodes = Array.from(metaDiv.childNodes);
      let foundUpdated = false;
      for (const node of allNodes) {
        if (node.nodeType === Node.TEXT_NODE && (node.textContent || '').includes('Updated')) {
          foundUpdated = true;
        }
        if (foundUpdated) {
          updatedHTML += node.nodeType === Node.TEXT_NODE ? node.textContent : (node as Element).outerHTML;
        }
      }

      cardHTML += '<div class="stars-card-meta">';
      if (mainParts) cardHTML += `<span class="stars-meta-main">${mainParts}</span>`;
      if (updatedHTML.trim()) cardHTML += `<span class="stars-meta-updated">${updatedHTML.trim()}</span>`;
      cardHTML += '</div>';
    }

    cardHTML += `<div class="stars-card-notes" data-repo-id="${repoId}"></div>`;

    card.innerHTML = cardHTML;
    gridContainer.appendChild(card);
    item.classList.add('stars-original-hidden');

    // 缓存仓库数据
    extractAndCacheRepoFromCard(item, repoId);

    // 星星按钮
    createStarButton(card, item);

    // 渲染标签
    const tagsContainer = card.querySelector<HTMLElement>('.stars-card-tags');
    if (tagsContainer) renderTags(tagsContainer);

    // 渲染备注
    const notesContainer = card.querySelector<HTMLElement>('.stars-card-notes');
    if (notesContainer) renderNotes(notesContainer);
  });

  // 分页器
  const paginator = colLg9.querySelector('.paginate-container:not(.stars-original-hidden)');
  if (paginator) {
    gridContainer.appendChild(paginator.cloneNode(true));
    paginator.classList.add('stars-original-hidden');
  }

  colLg9.appendChild(gridContainer);
  // “Starred repositories” 标题行右侧复制一份分页器（免滚动到底部才能翻页）
  mountTopPager(colLg9, gridContainer);

  // 将 Starred topics 移到右侧边栏
  const colLg3 = turboFrame.querySelector('.col-lg-3');
  const layoutEl = document.querySelector('.Layout.Layout--sidebarPosition-start');
  if (colLg3 && layoutEl) {
    let rightSidebar = layoutEl.querySelector('.stars-right-sidebar');
    if (!rightSidebar) {
      rightSidebar = document.createElement('div');
      rightSidebar.className = 'stars-right-sidebar';
      layoutEl.appendChild(rightSidebar);
    }
    rightSidebar.innerHTML = '';
    while (colLg3.firstChild) {
      rightSidebar.appendChild(colLg3.firstChild);
    }
  }

  // 渲染筛选栏并应用筛选
  renderTagFilterBar();
  interceptSearchForm();
  applyFilters();

  return true;
}

/**
 * 在「Starred repositories」标题行右侧复制一份分页器（顶部快捷翻页）。
 * 克隆网格底部那份（内容一致、状态随页码），保留 `paginate-container` 类
 * → 分页拦截与转圈动画对顶/底两份一视同仁。父容器加 `gsm-header-row` 变
 * flex 两端对齐实现「行右边」。随 transform 完整重建同步（原地翻页后自动更新）。
 */
function mountTopPager(colLg9: HTMLElement, gridContainer: HTMLElement): void {
  const source = gridContainer.querySelector<HTMLElement>('.paginate-container');
  const h2 = colLg9.querySelector<HTMLElement>('h2.f3-light');
  const row = h2 && h2.parentElement;
  if (!source || !row) return;

  row.classList.add('gsm-header-row');
  row.querySelector<HTMLElement>('.gsm-top-pager')?.remove();

  const top = source.cloneNode(true) as HTMLElement;
  top.classList.add('gsm-top-pager');
  row.appendChild(top);
}
