import { FORK_META_SVG, STAR_EMPTY_SVG, STAR_FILL_SVG, STAR_META_SVG } from '../constants';
import { getLangColor } from '../langColors';
import { markRepoStarred, markRepoUnstarred } from '../storage/pendingDelete';
import { getGitHubPat } from '../starCheck';
import { notifyTokenIssue } from '../tokenConfig';
import { escapeHtml, formatRelative } from '../utils';
import type { RepoData } from '../types';


/** 用缓存数据构建卡片（跨页筛选时使用） */
export function buildCardFromCache(repoId: string, data: RepoData): HTMLDivElement {
  const card = document.createElement('div');
  card.className = 'stars-grid-card stars-grid-card-cached';
  card.dataset.repoId = repoId;

  const repoHref = '/' + (data.name || '');
  card.dataset.repoName = '/' + (data.name || '');

  // 拆出 owner/repo 以匹配页面卡片结构：<span class="text-normal">owner / </span>repo
  const nameParts = (data.name || '').split('/');
  const owner = nameParts[0] || '';
  const repo = nameParts[1] || data.name || 'Unknown';

  let cardHTML = '<div class="stars-card-header">';
  cardHTML += `<h3><a href="${repoHref}"><span class="text-normal">${escapeHtml(owner)} / </span>${escapeHtml(repo)}</a></h3>`;
  cardHTML += '</div>';

  if (data.desc) {
    cardHTML += `<p class="stars-card-desc">${escapeHtml(data.desc)}</p>`;
  } else {
    cardHTML += '<p class="stars-card-desc" style="opacity:0.5;font-style:italic;">No description</p>';
  }

  // 标签容器
  cardHTML += `<div class="stars-card-tags" data-repo-id="${repoId}"></div>`;

  // 元信息
  cardHTML += '<div class="stars-card-meta">';

  let mainParts = '';

  // 语言（匹配页面卡片结构：<span class="ml-0 mr-3"> + <span itemprop="programmingLanguage">）
  if (data.lang) {
    const colorStyle = `background-color: ${getLangColor(data.lang)}`; // 4.3.0：全局 Linguist 映射（未命中灰、获取落地后原地重涂）
    mainParts += `<span class="ml-0 mr-3">` +
      `<span class="repo-language-color" data-gsm-lang="${encodeURIComponent(data.lang)}" style="${colorStyle}"></span> ` +
      `<span itemprop="programmingLanguage">${escapeHtml(data.lang)}</span></span>`;
  }

  // Star 数
  if (data.stars !== undefined) {
    const starsFormatted = Number(data.stars).toLocaleString();
    mainParts += `<a class="Link--muted mr-3" href="/${data.name}/stargazers">${STAR_META_SVG} ${starsFormatted}</a>`;
  }

  // Fork 数
  if (data.forks !== undefined && data.forks > 0) {
    const forksFormatted = Number(data.forks).toLocaleString();
    mainParts += `<a class="Link--muted mr-3" href="/${data.name}/forks">${FORK_META_SVG} ${forksFormatted}</a>`;
  }

  if (mainParts) cardHTML += `<span class="stars-meta-main">${mainParts}</span>`;
  // 4.9.0：updated（缓存的相对时间文本）字段已删——展示文本一律从 updatedAt 现算，
  // 老数据在等待全量回补期间可能暂无 updatedAt，此时不显示（与旧版缺 updated 的表现一致）
  const updatedText = data.updatedAt ? 'Updated ' + formatRelative(data.updatedAt) : '';
  if (updatedText) cardHTML += `<span class="stars-meta-updated">${escapeHtml(updatedText)}</span>`;

  cardHTML += '</div>';

  cardHTML += `<div class="stars-card-notes" data-repo-id="${repoId}"></div>`;

  card.innerHTML = cardHTML;
  return card;
}

/** 创建星星按钮（仅按钮本身，不含事件） */
export function createStarButtonElement(isStarred: boolean): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'stars-star-btn' + (isStarred ? ' starred' : ' unstarred');
  btn.type = 'button';
  btn.title = isStarred ? 'Unstar' : 'Star';
  btn.innerHTML = isStarred ? STAR_FILL_SVG : STAR_EMPTY_SVG;
  return btn;
}

/** 切换星星按钮状态，并同步待删除区数据 */
export function toggleStarButtonState(btn: HTMLButtonElement, card: HTMLElement, nowStarred: boolean): void {
  if (nowStarred) {
    btn.classList.remove('unstarred');
    btn.classList.add('starred');
    btn.innerHTML = STAR_FILL_SVG;
    btn.title = 'Unstar';
    const repoId = card.dataset.repoId;
    if (repoId) markRepoStarred(repoId);
  } else {
    btn.classList.remove('starred');
    btn.classList.add('unstarred');
    btn.innerHTML = STAR_EMPTY_SVG;
    btn.title = 'Star';
    const repoId = card.dataset.repoId;
    if (repoId) markRepoUnstarred(repoId);
  }
}



/** 为缓存卡片创建星星按钮：PUT/DELETE /user/starred/{owner}/{repo}（Bearer PAT，无 CSRF，4.0.0） */
export function createStarButtonForCached(card: HTMLElement, data: RepoData): void {
  if (!data.name) return;
  const btn = createStarButtonElement(!data.unstarredAt);

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (btn.disabled) return;

    const currentlyStarred = btn.classList.contains('starred');
    const tok = getGitHubPat();
    if (!tok) {
      btn.title = '未配置 token：Tampermonkey 菜单 →「⭐ 设置 GitHub Token」';
      return;
    }
    const [owner, repo] = data.name.split('/');
    if (!owner || !repo) return;

    btn.disabled = true;
    try {
      const resp = await fetch(
        `https://api.github.com/user/starred/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
        {
          method: currentlyStarred ? 'DELETE' : 'PUT',
          headers: {
            Authorization: `Bearer ${tok}`,
            'X-GitHub-Api-Version': '2022-11-28',
          },
        }
      );
      if (resp.ok) toggleStarButtonState(btn, card, !currentlyStarred);
      else if (resp.status === 401) notifyTokenIssue('401 Bad credentials：Token 已失效或被撤销');
      else if (
        resp.status === 403 &&
        !resp.headers.get('retry-after') &&
        resp.headers.get('x-ratelimit-remaining') !== '0'
      ) {
        // 排除限速后的 403 才是权限问题（官方 troubleshooting 判定）
        notifyTokenIssue('403 权限不足：fine-grained 需 Account permissions → Starring → Write');
      }
    } catch {
      // 网络错误 — 不做处理
    } finally {
      btn.disabled = false;
    }
  });

  const header = card.querySelector('.stars-card-header');
  if (header) header.appendChild(btn);
}
