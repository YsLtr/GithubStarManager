import { FORK_META_SVG, STAR_EMPTY_SVG, STAR_FILL_SVG, STAR_META_SVG } from '../constants';
import { getToggler, isStarredInToggler } from '../dom';
import { markRepoStarred, markRepoUnstarred } from '../storage/pendingDelete';
import { escapeHtml } from '../utils';
import type { RepoData } from '../types';

/**
 * 提交原生 star/unstar 表单。
 * 缺少 action 或 CSRF token 时返回 null（调用方按失败处理）。
 */
function submitStarForm(formEl: HTMLFormElement): Promise<Response> | null {
  const action = formEl.getAttribute('action');
  const tokenInput = formEl.querySelector<HTMLInputElement>('input[name="authenticity_token"]');
  if (!action || !tokenInput) return null;
  const context = formEl.querySelector<HTMLInputElement>('input[name="context"]');
  const body = new URLSearchParams();
  body.append('authenticity_token', tokenInput.value);
  if (context) body.append('context', context.value);
  return fetch(action, {
    method: 'POST',
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
    body,
    credentials: 'same-origin',
  });
}

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
    const colorStyle = data.langColor ? `background-color: ${data.langColor}` : '';
    mainParts += `<span class="ml-0 mr-3">` +
      `<span class="repo-language-color" style="${colorStyle}"></span> ` +
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
  if (data.updated) cardHTML += `<span class="stars-meta-updated">${escapeHtml(data.updated)}</span>`;

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

/** 为当前页卡片创建星星按钮：直接复用页面上的原生表单与 CSRF token */
export function createStarButton(card: HTMLElement, item: Element): void {
  const toggler = getToggler(item);
  if (!toggler) return;

  const isStarred = isStarredInToggler(toggler);

  const btn = createStarButtonElement(isStarred);

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (btn.disabled) return;
    btn.disabled = true;

    const currentlyStarred = btn.classList.contains('starred');
    const formSelector = currentlyStarred
      ? '.starred form[action$="/unstar"]'
      : '.unstarred form[action$="/star"]';
    const formEl = toggler.querySelector<HTMLFormElement>(formSelector);
    if (!formEl) { btn.disabled = false; return; }

    try {
      const resp = await submitStarForm(formEl);
      if (!resp || !resp.ok) { btn.disabled = false; return; }

      // 同步原生 DOM 的显隐
      const starredEl = toggler.querySelector<HTMLElement>('.starred');
      const unstarredEl = toggler.querySelector<HTMLElement>('.unstarred');
      if (currentlyStarred) {
        if (starredEl) starredEl.style.display = 'none';
        if (unstarredEl) unstarredEl.style.display = '';
      } else {
        if (unstarredEl) unstarredEl.style.display = 'none';
        if (starredEl) starredEl.style.display = '';
      }

      toggleStarButtonState(btn, card, !currentlyStarred);
    } catch {
      // 网络错误 — 不做处理
    }
    btn.disabled = false;
  });

  const header = card.querySelector('.stars-card-header');
  if (header) header.appendChild(btn);
}

/** 为缓存卡片创建星星按钮：先 fetch 仓库详情页拿有效 CSRF token */
export function createStarButtonForCached(card: HTMLElement, data: RepoData): void {
  if (!data.name) return;

  const isStarred = !data.unstarredAt;
  const btn = createStarButtonElement(isStarred);

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (btn.disabled) return;
    btn.disabled = true;

    const currentlyStarred = btn.classList.contains('starred');

    try {
      // 拉取仓库详情页以获取有效 CSRF token
      const pageResp = await fetch('/' + data.name, { credentials: 'same-origin' });
      if (!pageResp.ok) { btn.disabled = false; return; }
      const pageHtml = await pageResp.text();
      const doc = new DOMParser().parseFromString(pageHtml, 'text/html');

      // 选择正确的表单：已 star → unstar，未 star → star
      const formSelector = currentlyStarred
        ? '.starred form[action$="/unstar"]'
        : '.unstarred form[action$="/star"]';
      const formEl = doc.querySelector<HTMLFormElement>(formSelector);
      if (!formEl) { btn.disabled = false; return; }

      const token = formEl.querySelector<HTMLInputElement>('input[name="authenticity_token"]');
      if (!token) { btn.disabled = false; return; }

      const action = formEl.getAttribute('action');
      const contextInput = formEl.querySelector<HTMLInputElement>('input[name="context"]');

      const body = new URLSearchParams();
      body.append('authenticity_token', token.value);
      if (contextInput) body.append('context', contextInput.value);

      const resp = await fetch(action || '', {
        method: 'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        body,
        credentials: 'same-origin',
      });
      if (!resp.ok) { btn.disabled = false; return; }

      toggleStarButtonState(btn, card, !currentlyStarred);
    } catch {
      // 网络错误 — 不做处理
    }
    btn.disabled = false;
  });

  const header = card.querySelector('.stars-card-header');
  if (header) header.appendChild(btn);
}
