import { FORK_META_SVG, STAR_EMPTY_SVG, STAR_FILL_SVG, STAR_META_SVG } from '../constants';
import { getLangColor } from '../langColors';
import { enqueueMutation, type MutationHandle } from '../mutationQueue';
import { pushRestoreNotice } from '../restore';
import { syncCardAfterStarChange } from '../starCheck';
import { setStarState, writeFailureMessage, type StarWriteOutcome } from '../starWrites';
import { markRepoStarred, markRepoUnstarred } from '../storage/pendingDelete';
import { getToken, notifyTokenIssue } from '../tokenConfig';
import { pushNotice } from './notifications';
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
  // 4.8.0：updated（缓存的相对时间文本）字段已删——展示文本一律从 updatedAt 现算，
  // 老数据在等待全量回补期间可能暂无 updatedAt，此时不显示（与旧版缺 updated 的表现一致）
  const updatedText = data.updatedAt ? 'Updated ' + formatRelative(data.updatedAt) : '';
  if (updatedText) cardHTML += `<span class="stars-meta-updated">${escapeHtml(updatedText)}</span>`;

  cardHTML += '</div>';

  cardHTML += `<div class="stars-card-notes" data-repo-id="${repoId}"></div>`;

  card.innerHTML = cardHTML;
  return card;
}

/** 创建星星按钮（仅按钮本身，不含事件） */
function createStarButtonElement(isStarred: boolean): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'stars-star-btn' + (isStarred ? ' starred' : ' unstarred');
  btn.type = 'button';
  btn.title = isStarred ? 'Unstar' : 'Star';
  btn.innerHTML = isStarred ? STAR_FILL_SVG : STAR_EMPTY_SVG;
  return btn;
}

/** 只改按钮外观（不含任何存储/网络副作用）——乐观翻转与回滚都用它 */
function setStarButtonVisual(btn: HTMLButtonElement, isStarred: boolean): void {
  btn.classList.toggle('starred', isStarred);
  btn.classList.toggle('unstarred', !isStarred);
  btn.innerHTML = isStarred ? STAR_FILL_SVG : STAR_EMPTY_SVG;
  btn.title = isStarred ? 'Unstar' : 'Star';
}



/**
 * 为缓存卡片创建星星按钮（4.9.0 重写）。
 *
 * 一次点击的完整语义（ADR 0003 / 0006）：
 * 1. **乐观翻转**：立刻改按钮外观，不等网络；
 * 2. **入全局串行队列**（间隔 ≥1s）——卡片按钮与恢复共用同一个队列；
 * 3. **排队中再次点击 = 撤销排队**（请求不会发出，外观回滚）；执行中点击忽略；
 * 4. 写通道由 `setStarState` 静默分派（REST 或浏览器会话），调用方不感知；
 * 5. 成功 → 落本地权威数据（标签/备注随宽限期备份进出）+ 刷新卡片；
 *    取消 star 还额外推一条带「撤销」按钮的通知；
 * 6. 失败 → 回滚外观 + 结果导向的通知（不暴露通道细节；401 照旧上报配置面板）。
 */
export function createStarButtonForCached(card: HTMLElement, data: RepoData): void {
  const fullName = data.name;
  if (!fullName) return;
  const repoId = card.dataset.repoId || '';
  const btn = createStarButtonElement(!data.unstarredAt);

  /** 本卡片当前在途的一次操作（null = 空闲）；用于「排队中再点撤销」与「执行中忽略」 */
  let inflight: { handle: MutationHandle<StarWriteOutcome>; target: boolean } | null = null;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();

    // 排队中再点 = 撤销排队（ADR 0003：用户改主意时不必等它发出）
    if (inflight && inflight.handle.isQueued()) {
      const target = inflight.target;
      inflight.handle.cancelQueued();
      inflight = null;
      setStarButtonVisual(btn, !target); // 回滚乐观翻转
      pushNotice(`已取消排队：${fullName}`, 'info');
      return;
    }
    if (inflight) return; // 已在执行：不支持中途撤销（请求已发出）

    const target = !btn.classList.contains('starred');
    setStarButtonVisual(btn, target); // 乐观翻转

    const handle = enqueueMutation<StarWriteOutcome>({
      label: fullName,
      run: () => setStarState(getToken(), fullName, target),
    });
    inflight = { handle, target };

    void handle.done.then((outcome) => {
      // 身份校验（必须）：用户可能已「取消排队 → 重新点击」开了新一次操作。
      // 若这里无条件清空/回滚，会把**新操作**的护栏与外观一起搞坏
      // （后果：同一仓库被重复入队并真的发两条写请求，违反 ADR 0003）。
      const isCurrent = inflight !== null && inflight.handle === handle;
      if (isCurrent) inflight = null;
      if (outcome === null) {
        // 排队期被撤销：请求从未发出，回滚外观即可（仅当仍是本操作在管这张卡）
        if (isCurrent) setStarButtonVisual(btn, !target);
        return;
      }
      if (!outcome.ok) {
        if (isCurrent) setStarButtonVisual(btn, !target);
        const message = writeFailureMessage(outcome.reason, outcome.status);
        console.warn(`[github-star-manager] 星标写入失败：${fullName}｜${outcome.reason}｜${outcome.detail || ''}`);
        // ADR 0003「失败分支：一律只 alert 一行文字」——失败通知不能自行消失
        if (isCurrent) window.alert(`${target ? '加星' : '取消 star'}失败：${message}`);
        if (outcome.reason === 'unauthorized') notifyTokenIssue('401 Bad credentials：Token 已失效或被撤销');
        return;
      }
      // 成功：先落本地权威数据（宽限期备份进出），再刷新卡片
      if (repoId) {
        if (target) markRepoStarred(repoId);
        else markRepoUnstarred(repoId);
      }
      syncCardAfterStarChange(repoId, target);
      if (!target) pushRestoreNotice(repoId, fullName, 'manual');
    });
  });

  const header = card.querySelector('.stars-card-header');
  if (header) header.appendChild(btn);
}
