import { gmAddStyle } from './gm';
import baseCss from './styles/base.css?inline';
import wideCss from './styles/wide.css?inline';
import { installBootHide, isStarsPage, revealBootHide, revealTurboHide } from './boot';
import { getRepoIdMeta, getStarButton, hideListsSection, isStarButtonActive } from './dom';
import { extractAndCacheRepoFromDetailPage } from './extract';
import { filterState } from './state';
import { cleanupExpiredUnstarred, markRepoStarred, markRepoUnstarred } from './storage/pendingDelete';
import { migrateTagsIfNeeded } from './storage/tags';
import { transformStarsList } from './transform';
import { isDesktop } from './utils';

/**
 * 注入样式。
 * 只在 Stars 页面调用 —— 这些样式会改变 GitHub 的 Layout 结构，
 * 在仓库详情页注入会误伤侧边栏宽度。
 */
function injectStyles(): void {
  gmAddStyle(baseCss + '\n' + wideCss);
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

/**
 * Turbo frame 局部切换（标签互切/翻页）防闪烁 + 过渡动画。
 *
 * GitHub 的 profile 标签链接都带 data-turbo-frame="user-profile-frame"，
 * 点击后只替换 frame 内容，不整页刷新 —— document-start 那套管不到。
 * 做法：frame 替换前先藏住，替换 + 转换全部完成后再渲染；
 * 侧边栏/头像在 frame 外，是持久元素，解除隐藏瞬间从原始尺寸平滑收缩。
 */
let starsNavPending = false;
let navFailsafeTimer: number | undefined;

/** 兜底：任何一步没走到，最多藏 4s，退化为"延迟闪烁"而非永久空白 */
function armNavFailsafe(): void {
  if (navFailsafeTimer !== undefined) window.clearTimeout(navFailsafeTimer);
  navFailsafeTimer = window.setTimeout(() => {
    navFailsafeTimer = undefined;
    starsNavPending = false;
    revealTurboHide();
    revealBootHide();
  }, 4000);
}

/** 解除隐藏；animate=true 时让侧边栏/头像从 GitHub 原始尺寸收缩到紧凑尺寸 */
function revealAfterTransform(animate: boolean): void {
  revealTurboHide();
  if (!animate) {
    revealBootHide();
    return;
  }
  const root = document.documentElement;
  root.classList.add('gsm-anim-prepare'); // 过渡起点：临时恢复原始宽度
  void (document.body && document.body.offsetHeight); // 强制样式计算，否则没有过渡
  root.classList.remove('gsm-anim-prepare');
  revealBootHide();
}

/** 反复尝试转换（frame 渲染后内容可能未就绪），成功即解除隐藏 */
function transformAndReveal(animate: boolean, retries = 12): void {
  let done = false;
  try {
    done = transformStarsList();
  } catch (err) {
    console.error('[github-stars-grid] transformStarsList 执行失败', err);
  }
  if (done) {
    starsNavPending = false;
    revealAfterTransform(animate);
    return;
  }
  if (!isDesktop()) {
    // 移动端永远不会转换，别捂着页面
    revealAfterTransform(false);
    return;
  }
  if (retries > 0) {
    window.setTimeout(() => transformAndReveal(animate, retries - 1), 150);
  }
  // 重试耗尽：交给 4s 兜底强制显示
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
    console.log('[github-stars-grid] 首次转换未就绪，转入 MutationObserver 等待');
    const observer = new MutationObserver((_mutations, obs) => {
      if (transformStarsList()) {
        obs.disconnect();
        revealBootHide();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
      observer.disconnect();
      console.error('[github-stars-grid] 10s 内仍未转换成功，选择器可能再次失配，已恢复原页面');
      revealBootHide();
    }, 10000);
  }

  // Turbo frame 替换前先藏住（标签互切、翻页都走这里），替换+转换完成后再渲染
  document.addEventListener('turbo:before-frame-render', (event) => {
    const frame = event.target as Element;
    if (frame.id !== 'user-profile-frame' && frame.id !== 'user-starred-repos') return;
    if (!isDesktop()) return;
    // 只在目标内容确实是 Stars 列表时才藏：切去 Repositories 等标签不能捂住
    const detail = (event as CustomEvent<{ newFrame?: Element }>).detail;
    const newFrame = detail && detail.newFrame;
    const toStars = isStarsPage() || starsNavPending ||
      frame.id === 'user-starred-repos' ||
      !!(newFrame && newFrame.querySelector('#user-starred-repos'));
    if (!toStars) return;
    frame.classList.add('gsm-turbo-hidden');
    armNavFailsafe();
  });

  document.addEventListener('turbo:frame-render', (event) => {
    const frameId = (event.target as Element).id;
    if (frameId === 'user-starred-repos') {
      const arrive = starsNavPending;
      setTimeout(() => transformAndReveal(arrive), 100);
    } else if (frameId === 'user-profile-frame') {
      setTimeout(() => {
        hideListsSection();
        // 兜底：若换进来的不是 Stars 标签内容（无 starred 列表），立即解除，别捂住别的页面
        const pf = document.getElementById('user-profile-frame');
        if (!pf) return;
        if (!pf.querySelector('#user-starred-repos')) {
          revealTurboHide();
        } else {
          // Stars 内容就绪。注意 Turbo 会按 id 保留嵌套的 starred frame（src 未变就不会
          // 重新渲染、也就没有 starred 的 frame-render），必须在这里主动解除隐藏
          transformAndReveal(true);
        }
      }, 100);
    }
  });

  // 整页 Turbo 访问（前进/后退等）：同样先藏后渲染
  document.addEventListener('turbo:before-render', () => {
    if (!isDesktop()) return;
    if (!starsNavPending && !isStarsPage()) return;
    installBootHide();
  });

  document.addEventListener('turbo:load', () => {
    if (!isStarsPage()) {
      starsNavPending = false;
      revealTurboHide();
      revealBootHide();
      return;
    }
    const arrive = starsNavPending;
    setTimeout(() => transformAndReveal(arrive), 200);
  });

  document.addEventListener('turbo:load', () => {
    if (window.location.search.includes('tab=stars')) {
      setTimeout(transformStarsList, 200);
    }
  });

  // 记录"即将切到 Stars 标签"：frame 导航期间 URL 不会立刻变，isStarsPage() 测不到
  document.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (t && t.closest('a[href*="tab=stars"]')) {
      starsNavPending = true;
      armNavFailsafe();
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
// 加载标记：F12 控制台能看到这行 = 脚本已执行；看不到 = TM 没注入（启用状态/@match/未安装）
console.log('[github-stars-grid] script loaded (document-start)');
installBootHide();
whenReady(() => {
  try {
    init();
  } catch (err) {
    console.error('[github-stars-grid] init 失败，解除防闪烁隐藏', err);
    revealBootHide();
  }
});
