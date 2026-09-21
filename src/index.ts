import { GM_addStyle } from '$';
import baseCss from './styles/base.css?inline';
import wideCss from './styles/wide.css?inline';
import { installBootHide, isStarsPage, revealBootHide } from './boot';
import { getRepoIdMeta, getStarButton, hideListsSection, isStarButtonActive } from './dom';
import { extractAndCacheRepoFromDetailPage } from './extract';
import { filterState } from './state';
import { cleanupExpiredUnstarred, markRepoStarred, markRepoUnstarred } from './storage/pendingDelete';
import { migrateTagsIfNeeded } from './storage/tags';
import { transformStarsList } from './transform';

/**
 * 注入样式。
 * 只在 Stars 页面调用 —— 这些样式会改变 GitHub 的 Layout 结构，
 * 在仓库详情页注入会误伤侧边栏宽度。
 */
function injectStyles(): void {
  GM_addStyle(baseCss + '\n' + wideCss);
}

/**
 * 仓库详情页：跟踪 star / unstar 状态，维护待删除区。
 *
 * 新版页面是 React 组件，没有表单可监听 —— 按钮是
 * `button[data-testid="star-button"]`，状态体现在 `aria-label`
 * （`Star owner/repo` / `Unstar owner/repo`）与图标填充态上。
 * React 可能整块替换按钮节点，所以点击后短时轮询，而不是只挂
 * MutationObserver（节点被换掉后 observer 会跟丢）。
 * 旧版页面（存在 unstar 表单）仍然走 submit 监听。
 */
function watchRepoStarState(repoId: string): void {
  if (!repoId) return;

  const btn = getStarButton();
  if (btn) {
    let last = isStarButtonActive(btn);

    const apply = (): void => {
      const fresh = getStarButton();
      if (!fresh) return;
      const now = isStarButtonActive(fresh);
      if (now === last) return;
      last = now;
      if (now) markRepoStarred(repoId);
      else markRepoUnstarred(repoId);
    };

    document.addEventListener('click', (e) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target || !target.closest('button[data-testid="star-button"]')) return;
      const timer = window.setInterval(apply, 250);
      window.setTimeout(() => window.clearInterval(timer), 5000);
    });
    return;
  }

  // 旧版页面：监听 unstar 表单提交
  const unstarForm = document.querySelector<HTMLFormElement>('.starred form[action$="/unstar"]');
  if (unstarForm) {
    unstarForm.addEventListener('submit', () => markRepoUnstarred(repoId));
  }
}

function init(): void {
  // 页面类型检测
  const repoIdMeta = getRepoIdMeta();
  const isRepoDetailPage = !isStarsPage() && !!repoIdMeta;
  // 仓库详情页：缓存数据 + 监听 unstar + 提前返回
  if (isRepoDetailPage) {
    cleanupExpiredUnstarred();
    extractAndCacheRepoFromDetailPage();
    watchRepoStarState(repoIdMeta.getAttribute('content') || '');
    return;
  }

  if (!isStarsPage()) return;
  // Stars 页面初始化
  injectStyles();
  migrateTagsIfNeeded();
  cleanupExpiredUnstarred();

  // 执行转换 + MutationObserver + Turbo 事件
  // document-start 防闪烁：转换成功才解除页面隐藏
  let transformed = false;
  try {
    transformed = transformStarsList();
  } catch (err) {
    console.error('[github-stars-grid] transformStarsList 执行失败', err);
  }
  if (transformed) {
    revealBootHide();
  } else {
    const observer = new MutationObserver((_mutations, obs) => {
      if (transformStarsList()) {
        obs.disconnect();
        revealBootHide();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
      observer.disconnect();
      revealBootHide();
    }, 10000);
  }

  document.addEventListener('turbo:frame-render', (event) => {
    const frameId = (event.target as Element).id;
    if (frameId === 'user-starred-repos') {
      setTimeout(transformStarsList, 100);
    } else if (frameId === 'user-profile-frame') {
      // 资料栏（含 Lists 区块）异步渲染完成后再补一刀
      setTimeout(hideListsSection, 100);
    }
  });

  document.addEventListener('turbo:load', () => {
    if (window.location.search.includes('tab=stars')) {
      setTimeout(transformStarsList, 200);
    }
  });

  // 修正 GitHub 原生 "Clear filter" — 强制整页导航到干净的 ?tab=stars
  document.addEventListener('click', (e) => {
    const target = e.target instanceof Element ? e.target : null;
    const link = target ? target.closest('a.issues-reset-query') : null;
    if (!link) return;
    e.preventDefault();
    // 重置搜索状态
    filterState.searchQuery = '';
    filterState.searchMode = false;
    filterState.nativeSearchResults = [];
    filterState.tags = [];
    filterState.tagMode = false;
    const baseUrl = new URL(location.href);
    location.href = baseUrl.pathname + '?tab=stars';
  });
}

/** document-start 时 DOM 尚未解析，等 DOM 就绪后再跑主逻辑 */
function whenReady(fn: () => void): void {
  if (document.readyState !== 'loading') {
    fn();
    return;
  }
  document.addEventListener('DOMContentLoaded', fn, { once: true });
}

// document-start 启动顺序：先同步藏页面（防闪烁），DOM 就绪后再跑主逻辑
installBootHide();
whenReady(() => {
  try {
    init();
  } catch (err) {
    console.error('[github-stars-grid] init 失败，解除防闪烁隐藏', err);
    revealBootHide();
  }
});
