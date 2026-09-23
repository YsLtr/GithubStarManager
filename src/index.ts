import { gmAddStyle, gmRemove } from './gm';
import { LEGACY_STORAGE_KEYS } from './constants';
import baseCss from './styles/base.css?inline';
import persistentCss from './styles/persistent.css?inline';
import wideCss from './styles/wide.css?inline';
import { installBootHide, isStarsPage, revealBootHide, revealTurboHide } from './boot';
import { getRepoIdMeta, getStarButton, getStarsMainColumn, hideListsSection, isStarButtonActive } from './dom';
import { extractAndCacheRepoFromDetailPage } from './extract';
import { exitCustomMode } from './filters';
import { hasApiData, registerSyncMenu, runFullSync, scheduleProbeSync } from './fullSync';
import { interceptPagination } from './pagination';
import { registerTokenMenu } from './starCheck';
import {
  notifyTokenSaved,
  openTokenCreator,
  pasteFromClipboard,
  saveToken,
  setTokenIssueHandler,
  setTokenSavedHandler,
} from './tokenConfig';
import { cleanupExpiredUnstarred, markRepoStarred, markRepoUnstarred } from './storage/pendingDelete';
import { migrateTagsIfNeeded } from './storage/tags';
import { transformStarsList } from './transform';
import { isDesktop } from './utils';

/* ============================================================
 * 样式生命周期
 *
 * 布局样式（base+wide，含 180px 侧边栏 / 120px 头像 / 三栏网格）只在 Stars
 * 视图存在：离开 Stars（切到 Repositories 等标签、整页导航走人）时整表移除，
 * GitHub 原生布局与尺寸立即恢复；再次进入时重新挂上。
 *
 * persistentCss 是常驻小表（注入后不移除）：
 * - .stars-right-sidebar 默认隐藏：它是脚本追加到持久 .Layout 上的节点，
 *   主表一撤它会以 display:block 挤进网格轨道残留一块空列；
 * - 侧边栏/头像 transition：离开时宽度 180→296 回弹仍需要过渡。
 *
 * 注入顺序恒为「常驻表 → 主表」，同特异性时后插入的主表在 Stars 视图
 * 正确覆盖常驻表的默认隐藏。
 * ============================================================ */
let persistentStyleEl: HTMLStyleElement | null = null;
let layoutStyleEl: HTMLStyleElement | null = null;
let starsSetupDone = false;

function ensureStyles(): void {
  if (!persistentStyleEl || !persistentStyleEl.isConnected) {
    persistentStyleEl = gmAddStyle(persistentCss);
  }
  if (!layoutStyleEl || !layoutStyleEl.isConnected) {
    layoutStyleEl = gmAddStyle(baseCss + '\n' + wideCss);
  }
}

/** 幂等：样式 + 一次性存储迁移/清理。profile 页直入（样式从未注入过）也走这里。 */
function ensureStarsSetup(): void {
  ensureStyles();
  if (starsSetupDone) return;
  starsSetupDone = true;
  migrateTagsIfNeeded();
  cleanupExpiredUnstarred();
}

/** 离开 Stars：撤掉布局主表 + 清掉入场标记。幂等。 */
function deactivateStars(): void {
  layoutStyleEl?.remove();
  document.documentElement.classList.remove('gsm-anim-prepare');
  document.documentElement.classList.remove('gsm-turbo-entry');
}

/** 离开 Stars 的完整收尾：解除一切隐藏 + 撤样式，回到 GitHub 原生视图。幂等。 */
function exitStarsView(reason: string): void {
  revealTurboHide();
  deactivateStars();
  revealBootHide(reason);
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

/* ============================================================
 * Turbo 导航：防闪烁 + 入场过渡 + 离开恢复
 *
 * GitHub 的 profile 标签链接都带 data-turbo-frame="user-profile-frame"，
 * 点击后只替换 frame 内容，不整页刷新 —— document-start 那套管不到。
 * 做法：进 Stars 前先藏住，替换 + 转换完成后再渲染；侧边栏/头像是 frame
 * 外的持久元素，解除隐藏瞬间从原始尺寸平滑收缩。离开 Stars 时撤掉主样式表，
 * 尺寸带过渡地弹回原生值。
 *
 * 这些监听必须在**任何**匹配页都注册：纯 profile 页（无 tab=stars）也要能
 * 响应"点 Stars 标签"的 turbo 事件把用户接进来。
 * ============================================================ */
let starsNavPending = false;
let navFailsafeTimer: number | undefined;

/** 兜底：导航卡死导致一直藏着时最多藏 4s；回调自检——已成功揭示的残余定时器必须无害 */
function armNavFailsafe(): void {
  if (navFailsafeTimer !== undefined) window.clearTimeout(navFailsafeTimer);
  navFailsafeTimer = window.setTimeout(() => {
    navFailsafeTimer = undefined;
    starsNavPending = false;
    // 只有仍处于隐藏（导航真卡死）才兜底退出；成功揭示后若不自检，
    // 到点会误调 exitStarsView 把样式撤掉——表现为「过一会脚本失效、恢复原始页面」
    const stillHidden =
      document.documentElement.classList.contains('gsm-boot-hidden') ||
      !!document.querySelector('.gsm-turbo-hidden');
    if (!stillHidden) return;
    exitStarsView('导航 4s 兜底');
  }, 4000);
}

/** 解除隐藏；animate=true 且本次揭示真的解除了隐藏时，播入场动画（收缩+淡入）。
 *  幂等门 wasHidden：直载（从未藏过？不，直载也藏着——由 animate=false 挡）与
 *  二次调用（首次揭示已摘掉隐藏类）都跳过动画，防止重复入场造成二次闪烁。 */
function revealAfterTransform(animate: boolean): void {
  const root = document.documentElement;
  const wasHidden =
    root.classList.contains('gsm-boot-hidden') || !!document.querySelector('.gsm-turbo-hidden');
  // 成功揭示 = 导航兜底定时器已完成使命，必须撤销；否则它到点后会误撤样式
  if (navFailsafeTimer !== undefined) {
    window.clearTimeout(navFailsafeTimer);
    navFailsafeTimer = undefined;
  }
  revealTurboHide();
  if (!animate || !wasHidden) {
    root.classList.remove('gsm-anim-prepare');
    revealBootHide('转换成功(直载)');
    return;
  }
  root.classList.add('gsm-turbo-entry'); // 卡片淡入：仅真正的 turbo 入场
  root.classList.add('gsm-anim-prepare'); // 过渡起点：原始宽度（此刻还藏着）
  revealBootHide('转换成功(turbo 入场)');
  void (document.body && document.body.offsetHeight); // 强制样式计算，提交过渡起点
  root.classList.remove('gsm-anim-prepare'); // 起点 → 紧凑尺寸，transition 开跑
}

/**
 * 反复尝试转换（frame 渲染后内容可能未就绪），成功即解除隐藏。
 * 失败重试耗尽时解除隐藏并撤掉样式，回落到 GitHub 原生页面。
 */
function transformAndReveal(animate: boolean, retries = 12): void {
  const root = document.documentElement;
  if (animate) {
    // 起点先行：布局样式一注入，侧边栏就会算成 180px。先把 prepare 立好
    // （= 原生 296px），注入与转换全程都停在起点宽度，解除隐藏时一次性过渡。
    root.classList.add('gsm-anim-prepare');
  }
  ensureStarsSetup();

  // 4.0.0 API 主模式：无全量缓存 = 不转换（揭示原生页面 + 配置横幅），避免白屏/半成品网格
  if (!hasApiData()) {
    starsNavPending = false;
    revealAfterTransform(false);
    showSetupBanner();
    return;
  }

  let done = false;
  try {
    done = transformStarsList();
  } catch (err) {
    console.error('[github-stars-grid] transformStarsList 执行失败', err);
  }
  if (done) {
    starsNavPending = false;
    revealAfterTransform(animate);
    // API 主模式：进页自动 ETag 快筛 → 变更整表（无 token 内部静默返回）
    scheduleProbeSync();
    return;
  }
  if (!isDesktop()) {
    // 移动端永远不会转换，别捂着页面
    revealAfterTransform(false);
    return;
  }
  if (retries > 0) {
    if (retries === 12) console.log('[github-stars-grid] 转换目标未就绪，150ms 后重试');
    window.setTimeout(() => transformAndReveal(animate, retries - 1), 150);
    return;
  }
  // 重试耗尽：解除隐藏 + 撤样式，恢复原生页面（诊断日志要能一眼看出失配）
  console.error('[github-stars-grid] 转换重试耗尽，已恢复原生页面（选择器可能再次失配）');
  revealTurboHide();
  deactivateStars();
  revealBootHide('转换失败/重试耗尽');
}

/**
 * 4.0.0 配置横幅：无全量缓存（首次升级 / 未配 token）时显示在列表上方。
 * 内联填 token 框常驻（401/403 自动出现）+ 快速获取 + 立即同步按钮（4.0.4 恢复；原「手动设置」
 * prompt 按钮按用户更正移除）；保存成功自动全量同步 → hasApiData 变 true → 重新出网格。
 */
function showSetupBanner(issueDetail?: string): void {
  const exist = document.querySelector<HTMLElement>('.gsm-setup-banner');
  if (exist) {
    if (issueDetail) {
      const m = exist.querySelector<HTMLElement>('.gsm-setup-msg');
      if (m) m.textContent = bannerMessage(issueDetail);
    }
    return;
  }
  const colLg9 = getStarsMainColumn();
  const host = colLg9 || document.getElementById('user-starred-repos');
  if (!host) return;

  const bar = document.createElement('div');
  bar.className = 'gsm-setup-banner';
  bar.innerHTML = '<span class=gsm-setup-msg></span>';
  bar.querySelector('.gsm-setup-msg')!.textContent = bannerMessage(issueDetail);
  const sync = document.createElement('button');

  // 快捷获取：官方 Template URL 预填 Starring: write 最小权限；生成复制后回粘（填 token 框常驻显示，点快捷键聚焦）
  const quick = document.createElement('button');
  quick.className = 'btn btn-primary';
  quick.type = 'button';
  quick.textContent = '快速获取 Token';
  quick.title = '打开 GitHub 创建页（已预填 Account permissions → Starring: write），生成并复制后回来粘贴';
  quick.addEventListener('click', () => {
    openTokenCreator();
    tokRow.hidden = false;
    tokInput.focus();
  });

  const tokRow = document.createElement('span');
  tokRow.className = 'gsm-token-row';
  tokRow.hidden = false; // 4.0.4：填 token 框常驻（401/403 后面板一出现即可直接粘贴）
  const tokInput = document.createElement('input');
  tokInput.type = 'text';
  tokInput.spellcheck = false;
  tokInput.placeholder = 'github_pat_… 或 ghp_（也可直接 Ctrl+V 到框里）';
  const tokMsg = document.createElement('span');
  tokMsg.className = 'gsm-token-msg';
  const tokPaste = document.createElement('button');
  tokPaste.className = 'btn';
  tokPaste.type = 'button';
  tokPaste.textContent = '从剪贴板粘贴';
  tokPaste.addEventListener('click', () => void pasteFromClipboard(tokInput));
  const tokSave = document.createElement('button');
  tokSave.className = 'btn btn-primary';
  tokSave.type = 'button';
  tokSave.textContent = '保存并同步';
  tokSave.addEventListener('click', () => {
    const kind = saveToken(tokInput.value);
    if (!kind) {
      tokMsg.textContent = '前缀不对：预期 github_pat_（fine-grained）或 ghp_（classic）';
      return;
    }
    console.log(`[github-stars-grid] Token 已保存（${kind}），自动触发全量同步`);
    bar.remove();
    notifyTokenSaved();
  });
  tokRow.append(tokInput, tokMsg, tokPaste, tokSave);
  sync.className = 'btn';
  sync.type = 'button';
  sync.textContent = '立即同步';
  sync.title = '用当前 Token 立即比对 GitHub（逐页 ETag 快筛，无变化零流量）';
  sync.addEventListener('click', () => {
    void runFullSync('button');
  });


  bar.append(quick, sync, tokRow);
  // 顶窗落位：替换 Lists 槽位里的空态（0 个 list）或已建 list 容器（有 list 时该容器
  // 本就被 hideListsSection/CSS 隐藏）；都不在则退回旧行为挂列首
  const slot = document.querySelector('#user-profile-frame > div');
  const slotTarget =
    (slot && slot.querySelector(':scope > div.blankslate')) || (slot && slot.querySelector(':scope > #profile-lists-container'));
  if (slotTarget) slotTarget.replaceWith(bar);
  else host.prepend(bar);
}

/** 面板主文案：默认 = 首次配置引导；issueDetail = Token 失效/权限不足等具体问题（4.0.2 面板化） */
function bannerMessage(issueDetail?: string): string {
  if (issueDetail) return `🔑 ${issueDetail} —— 请用下方按钮重新配置 Token，保存后会自动全量同步恢复。`;
  return '⭐ Stars Grid 4.0 需要一次性全量同步（GitHub API）：可一键预填权限创建 Token，或手动填写；保存后会自动开始全量同步。';
}

function registerNavListeners(): void {
  // Turbo frame 替换前先藏住（标签互切、翻页都走这里），替换+转换完成后再渲染
  document.addEventListener('turbo:before-frame-render', (event) => {
    const frame = event.target as Element;
    if (frame.id !== 'user-profile-frame' && frame.id !== 'user-starred-repos') return;
    if (!isDesktop()) return;
    // 只在目标内容确实是 Stars 列表时才藏：切去 Repositories 等标签不能捂住
    const detail = (event as CustomEvent<{ newFrame?: Element }>).detail;
    const newFrame = detail && detail.newFrame;
    const toStars =
      isStarsPage() ||
      starsNavPending ||
      frame.id === 'user-starred-repos' ||
      !!(newFrame && newFrame.querySelector('#user-starred-repos'));
    if (!toStars) {
      // 切去非 Stars：立刻撤布局样式，别让原生内容顶着 180px 侧边栏渲染
      exitStarsView('切至非 Stars 标签(渲染前)');
      return;
    }
    frame.classList.add('gsm-turbo-hidden');
    armNavFailsafe();
  });

  // GitHub 的 profile frame 带 data-turbo-action：Turbo FrameController 在 frame 渲染完后会
  // 经 proposeVisitIfNavigatedWithAction 补一次整页 Drive visit（实测 8ms 后、同 URL、
  // updateHistory:false，纯重复渲染）。它会触发下面 before-render 的整页隐藏 → 用户看到
  // "整页刷新"。记录 frame 渲染时刻，在 before-visit 上取消这次冗余 visit。
  let lastFrameRenderAt = 0;

  document.addEventListener('turbo:frame-render', (event) => {
    const frameId = (event.target as Element).id;
    if (frameId === 'user-profile-frame' || frameId === 'user-starred-repos') {
      lastFrameRenderAt = performance.now();
    }
    if (frameId === 'user-starred-repos') {
      const arrive = starsNavPending;
      setTimeout(() => transformAndReveal(arrive), 100);
    } else if (frameId === 'user-profile-frame') {
      setTimeout(() => {
        hideListsSection();
        // 兜底：若换进来的不是 Stars 标签内容（无 starred 列表），立即解除并撤样式
        const pf = document.getElementById('user-profile-frame');
        if (!pf) return;
        if (!pf.querySelector('#user-starred-repos')) {
          exitStarsView('切至非 Stars 标签(渲染后)');
        } else {
          // Stars 内容就绪。注意 Turbo 会按 id 保留嵌套的 starred frame（src 未变就不会
          // 重新渲染、也就没有 starred 的 frame-render，必须在这里主动调用。
          // animate 跟随 starsNavPending：直载时 Turbo 也会走一遍初始 frame-render，
          // 无脑 true 会让直载也播入场动画（网格淡入+侧边栏收缩）→ 被当成闪烁
          transformAndReveal(starsNavPending);
        }
      }, 100);
    }
  });

  // 取消 frame 渲染后 1s 内发起的同 URL 冗余整页 visit（Turbo proposeVisitIfNavigatedWithAction）。
  // 被取消时 proposeVisit 直接短路，无 fallback 跳转；history 由 frame 的 action 自己维护，
  // 被取消的 visit 本就 updateHistory:false，故前后退与历史条目均不受影响。
  document.addEventListener('turbo:before-visit', (event) => {
    if (!isDesktop()) return;
    if (!lastFrameRenderAt || performance.now() - lastFrameRenderAt > 1000) return;
    const url = (event as CustomEvent<{ url?: string }>).detail?.url;
    if (!url) return;
    try {
      if (new URL(url, location.href).href !== location.href) return;
    } catch {
      return;
    }
    event.preventDefault();
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
      exitStarsView('非 Stars 页 turbo:load');
      return;
    }
    const arrive = starsNavPending;
    setTimeout(() => transformAndReveal(arrive), 200);
  });

  // 记录"即将切到 Stars 标签"：frame 导航期间 URL 不会立刻变，isStarsPage() 测不到
  document.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (t && t.closest('a[href*="tab=stars"]')) {
      starsNavPending = true;
      armNavFailsafe();
    }
  });

  // 修正 GitHub 原生 "Clear filter"（4.0.0）：全部本地化 — 清状态 → 本地浏览页 → 干净地址栏，不再整页导航
  document.addEventListener('click', (e) => {
    const target = e.target instanceof Element ? e.target : null;
    const link = target ? target.closest('a.issues-reset-query') : null;
    if (!link) return;
    e.preventDefault();
    exitCustomMode();
  });
}

function init(): void {
  // 导航监听必须最先挂：纯 profile 页（非 stars、非仓库详情）也要能响应
  // "点 Stars 标签"，否则从 profile 进 Stars 时没有任何转换逻辑在跑。
  // 4.0.10：一次性清理历史死键（快照/裁决/位移管线已删；GM + localStorage 镜像同删，幂等）
  for (const k of LEGACY_STORAGE_KEYS) gmRemove(k);

  registerNavListeners();
  // TM 菜单：任意匹配页都可设置/清除核对用 PAT
  registerTokenMenu();
  // 手动同步唯一入口（4.0.3：横幅与标题行的手动同步按钮均已移除）
  registerSyncMenu();

  // Token 保存成功（横幅内联 / 失效弹窗 / TM 菜单 prompt 任一入口）→ 撤配置横幅 + 自动全量同步
  setTokenSavedHandler(() => {
    document.querySelector('.gsm-setup-banner')?.remove();
    void runFullSync('button').then((sum) => {
      if (sum && isStarsPage() && !document.querySelector('.stars-grid-container')) transformAndReveal(false);
    });
  });

  // Token 问题（401 / 403 非限速）→ 初始化面板呈现（4.0.2：替代居中弹窗），已有横幅则刷新文案
  setTokenIssueHandler((detail) => showSetupBanner(detail));

  const repoIdMeta = getRepoIdMeta();
  const isRepoDetailPage = !isStarsPage() && !!repoIdMeta;
  // 仓库详情页：缓存数据 + 监听 unstar + 提前返回
  if (isRepoDetailPage) {
    cleanupExpiredUnstarred();
    extractAndCacheRepoFromDetailPage();
    watchRepoStarState(repoIdMeta.getAttribute('content') || '');
    return;
  }

  if (!isStarsPage()) return; // 纯 profile 页等 turbo 接进来

  // Stars 直载：样式 + 迁移 + 转换；转换成功才解除 document-start 的隐藏
  ensureStarsSetup();
  transformAndReveal(false);
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
// 原地翻页拦截：document-start 同步挂载，先于 Turbo 的 click 监听拿到事件
interceptPagination();
whenReady(() => {
  try {
    init();
  } catch (err) {
    console.error('[github-stars-grid] init 失败，解除防闪烁隐藏', err);
    revealTurboHide();
    deactivateStars();
    revealBootHide('init 异常');
  }
});
