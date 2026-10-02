import { gmAddStyle } from './gm';
import { beginGeneration, createScope } from './lifecycle';
import { teardownStarsView } from './viewTeardown';
import baseCss from './styles/base.css?inline';
import persistentCss from './styles/persistent.css?inline';
import wideCss from './styles/wide.css?inline';
import { installBootHide, isStarsPage, revealBootHide, revealTurboHide } from './boot';
import { applyHideListsGate, getRepoIdMeta, getStarsMainColumn, hideListsSection, isHideListsEnabled } from './dom';
import { applyFilters, exitCustomMode, initFiltersFromUrl } from './filters';
import { hasApiData, registerSyncMenu, runFullSync, scheduleProbeSync } from './fullSync';
import { interceptPagination } from './pagination';
import { registerTokenMenu } from './starCheck';
import {
  notifyTokenSaved,
  openClassicTokenCreator,
  openTokenCreator,
  TOKEN_KIND_HELP,
  pasteFromClipboard,
  saveToken,
  setTokenIssueHandler,
  setTokenSavedHandler,
} from './tokenConfig';
import { cleanupExpiredUnstarred } from './storage/pendingDelete';
import { registerHideListsMenu, setHideListsRepositionHandler } from './ui/hideListsMenu';
import { migrateTagsIfNeeded } from './storage/tags';
import { transformStarsList } from './transform';
import { registerExportImportMenu, setAfterImportHandler } from './ui/exportImportMenu';
import { registerRestoreMenu } from './ui/restoreMenu';
import { isDesktop, subscribeBreakpointChange } from './utils';

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
  // 窄视口**不注入任何样式**（4.9.1）：CSS 全都在媒体查询里、本来也不生效，但注入本身会
  // 在页面上留下两个 <style> 节点（且 persistent 那张从不移除）—— 正是要消掉的"残次内容"。
  if (!isDesktop()) return;
  if (!persistentStyleEl || !persistentStyleEl.isConnected) {
    persistentStyleEl = gmAddStyle(persistentCss);
  }
  if (!layoutStyleEl || !layoutStyleEl.isConnected) {
    layoutStyleEl = gmAddStyle(baseCss + '\n' + wideCss);
  }
}

/** 幂等：门控类 + 样式 + 一次性存储迁移/清理。profile 页直入（样式从未注入过）也走这里。 */
function ensureStarsSetup(): void {
  // 门控类在这里对齐（而不是只在 document-start）：跨断点从窄回到桌面时，
  // teardown 已把 gsm-hide-lists 摘掉，这里负责按当前视口 + 开关重新挂上。
  applyHideListsGate();
  ensureStyles();
  // 存储迁移 / 超期备份清理与视口无关（数据不随窗口大小改变，回滚也不回滚数据）
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
  // 世代推进：让所有**已排队**的转换/重渲染回调自我作废 —— 否则刚拆干净，
  // 上一轮排的那个 150ms 重试就把样式表重新装了回来（4.9.1 修的点）。
  beginGeneration();
  teardownStarsView(reason);
  deactivateStars();
}

/* 4.9.0（决策 D17）：仓库详情页的 star/unstar 监听已删除 —— 星状态真相只由整表同步判定，
 * 与用户从哪个页面点的无关；详情页也不再触碰 GitHub 拥有的 star 按钮 DOM（ADR 0003）。
 * 详细页现在只做「清理超期宽限期备份」后提前返回（见 init）。 */

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
/** 页面级作用域：导航监听与它们的延迟回调都登记在这里（生命周期 = 整个页面，不随回滚释放）。
 *  延迟回调一律走 guardedTimeout：世代被推进（回滚/新一轮转换）后自动作废。 */
const navScope = createScope('gsm-nav');
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
  // 世代推进：本次转换开始后，上一轮排队的重试/延迟回调全部作废
  beginGeneration();
  const root = document.documentElement;

  // **先于一切注入**判定视口（4.9.1）。脚本声明「仅桌面端生效」，窄视口就该完全惰性：
  // 不注入样式表、不建节点、不插配置横幅。旧代码把这道门放在 ensureStarsSetup() 之后，
  // 于是手机上照样挂着两张 <style> + 一条样式完整的配置横幅（.gsm-setup-banner 的样式
  // 在 base.css 里位于媒体查询**之外**，窄视口不会被断点挡掉）。
  if (!isDesktop()) {
    starsNavPending = false;
    revealAfterTransform(false); // 幂等；窄视口本就没藏过页面，这里只为撤销导航兜底
    return;
  }
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
    // Lists 标题行不归门控 CSS 管（那条 CSS-only 兜底 4.9.1 已删），而正常路径是
    // transformStarsList → hideListsSection()，这条分支不转换 ⇒ 必须自己补一次，
    // 否则首次安装/未配 token 时「Lists (5)」标题行孤零零挂在配置横幅上方。
    hideListsSection();
    showSetupBanner();
    return;
  }

  let done = false;
  try {
    // URL 入口匹配（R6）：渲染管线跑之前把 sort/direction/language 对齐 URL（仅 URL 筛选参数变化时覆盖本地状态）
    initFiltersFromUrl();
    done = transformStarsList();
  } catch (err) {
    console.error('[github-star-manager] transformStarsList 执行失败', err);
  }
  if (done) {
    starsNavPending = false;
    revealAfterTransform(animate);
    // API 主模式：进页自动 ETag 快筛 → 变更整表（无 token 内部静默返回）
    scheduleProbeSync();
    return;
  }
  if (retries > 0) {
    if (retries === 12) console.log('[github-star-manager] 转换目标未就绪，150ms 后重试');
    // guardedTimeout：回滚/新一轮转换会推进世代 → 这条重试自动作废（旧代码会一直重试到 12 次，
    // 把刚拆掉的样式表重新装回去）
    navScope.guardedTimeout(() => transformAndReveal(animate, retries - 1), 150);
    return;
  }
  // 重试耗尽：解除隐藏 + 撤样式，恢复原生页面（诊断日志要能一眼看出失配）
  console.error('[github-star-manager] 转换重试耗尽，已恢复原生页面（选择器可能再次失配）');
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
  // 窄视口不显示任何脚本 UI（4.9.1）：横幅的样式不在媒体查询内，手机上会以完整样式出现，
  // 是"残次内容"里最刺眼的一件。需要配置 Token 的窄视口用户走 TM 菜单入口。
  if (!isDesktop()) {
    console.log('[github-star-manager] 窄视口：不显示配置面板（如需配置 Token，请用 TM 菜单「⭐ 设置 GitHub Token」）');
    return;
  }
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

  // 两个快捷入口（4.9.0 用户裁定：两者都给，并说明区别）：
  // classic = 读写都行；fine-grained = 读行、写别人的公开仓库会被 GitHub 拒。
  const focusInput = (): void => {
    tokRow.hidden = false;
    tokInput.focus();
  };
  const quickClassic = document.createElement('button');
  quickClassic.className = 'btn btn-primary';
  quickClassic.type = 'button';
  quickClassic.textContent = '快速获取 Token（classic，推荐）';
  quickClassic.title = TOKEN_KIND_HELP;
  quickClassic.addEventListener('click', () => {
    openClassicTokenCreator();
    focusInput();
  });
  const quickFine = document.createElement('button');
  quickFine.className = 'btn';
  quickFine.type = 'button';
  quickFine.textContent = '快速获取 Token（fine-grained，仅读）';
  quickFine.title = TOKEN_KIND_HELP;
  quickFine.addEventListener('click', () => {
    openTokenCreator();
    focusInput();
  });
  const kindHelp = document.createElement('span');
  kindHelp.className = 'gsm-token-help';
  kindHelp.textContent = TOKEN_KIND_HELP;

  const tokRow = document.createElement('span');
  tokRow.className = 'gsm-token-row';
  tokRow.hidden = false; // 4.0.4：填 token 框常驻（401/403 后面板一出现即可直接粘贴）
  const tokInput = document.createElement('input');
  tokInput.type = 'text';
  tokInput.spellcheck = false;
  tokInput.placeholder = 'ghp_ / gho_（classic）或 github_pat_（也可直接 Ctrl+V 粘贴）';
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
      tokMsg.textContent = '前缀不对：预期 ghp_ / gho_（classic）或 github_pat_（fine-grained）';
      return;
    }
    console.log(`[github-star-manager] Token 已保存（${kind}），自动触发全量同步`);
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


  bar.append(quickClassic, quickFine, kindHelp, sync, tokRow);
  placeSetupBanner(bar, host);
}

/** 配置面板落位（4.5.0 分流）：开关开启（默认）时 Lists 本就被隐藏，面板插到其槽位节点**之前**
 *  （空态 blankslate / 已建 list 容器；节点本身保留不销毁，隐藏交给 hideListsSection + 门控 CSS）；
 *  开关关闭时 Lists 原生内容可见，面板改挂网格列顶（prepend，不占 Lists 位置，撤除后原生内容原样不动）。
 *  切换开关时由 repositionSetupBanner 重挂。 */
function placeSetupBanner(bar: HTMLElement, host: HTMLElement): void {
  if (isHideListsEnabled()) {
    const slot = document.querySelector('#user-profile-frame > div');
    const slotTarget =
      (slot && slot.querySelector(':scope > div.blankslate')) || (slot && slot.querySelector(':scope > #profile-lists-container'));
    // 插入并存（方案 A），绝不 replaceWith：原生节点的隐藏由 hideListsSection 标记 +
    // html.gsm-hide-lists 下的 CSS 负责，节点留着 → 关态撤门控即可原样复活（可逆）。
    // 若用 replaceWith 吃掉节点，关态下 Lists 槽位将永久空白（无还原路径）。
    if (slotTarget && slotTarget !== bar) slotTarget.before(bar);
    else host.prepend(bar);
  } else {
    host.prepend(bar);
  }
}

/** Hide Lists 开关切换后的面板重挂：开关值变了但面板已存在（showSetupBanner 的 exist 分支只刷文案），
 *  需按新落位移一次（🟡-1：否则关态下横幅仍留在 Lists 槽位，与落位设计不符）。 */
function repositionSetupBanner(): void {
  const bar = document.querySelector<HTMLElement>('.gsm-setup-banner');
  if (!bar) return;
  const host = getStarsMainColumn() || document.getElementById('user-starred-repos');
  if (!host) return;
  placeSetupBanner(bar, host);
}

/** 面板主文案：默认 = 首次配置引导；issueDetail = Token 失效/权限不足等具体问题（4.0.2 面板化） */
function bannerMessage(issueDetail?: string): string {
  if (issueDetail) return `🔑 ${issueDetail} —— 请用下方按钮重新配置 Token，保存后会自动全量同步恢复。`;
  return '⭐ GithubStarManager 需要一次性全量同步（GitHub API）：可用下方按钮打开预填好权限的 Token 创建页，或手动填写；保存后会自动开始全量同步。';
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
      navScope.guardedTimeout(() => transformAndReveal(arrive), 100);
    } else if (frameId === 'user-profile-frame') {
      navScope.guardedTimeout(() => {
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
    // 窄视口（4.9.1）：脚本完全惰性 —— 既没有要建立的东西，也没有要收尾的东西
    // （运行中收窄的情况已由断点订阅处理，这里不再需要 exitStarsView）。
    if (!isDesktop()) return;
    if (!isStarsPage()) {
      starsNavPending = false;
      exitStarsView('非 Stars 页 turbo:load');
      return;
    }
    const arrive = starsNavPending;
    navScope.guardedTimeout(() => transformAndReveal(arrive), 200);
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
    // 窄视口（4.9.1）：交回 GitHub 原生行为。本地化 Clear filter 会经 exitCustomMode →
    // applyFilters → hideNativeFilterMenus() 把原生的 Type/Language/Sort 三个 action-menu
    // 设成 display:none —— 在手机上就是「点了一下原始筛选条，三个菜单永久消失」。
    if (!isDesktop()) return;
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

  registerNavListeners();

  // 断点订阅（4.9.1）：运行中把窗口从桌面拖到手机宽度（或反向）时双向切换。
  // 这是修「缩到手机尺寸后留下一地残次内容」的关键 —— 旧代码只在导航时判定视口，
  // 已经建好的网格、被搬走的侧栏、写下的内联样式都不会自己回退。
  subscribeBreakpointChange((desktop) => {
    if (desktop) {
      // 回到桌面：重新走转换管线（与「手动同步后重建网格」同一条路径）
      if (isStarsPage() && !document.querySelector('.stars-grid-container')) transformAndReveal(false);
      return;
    }
    // 收窄到手机宽度：完整回滚成 GitHub 原生页面
    exitStarsView('跨断点收窄(窄视口)');
  });
  // TM 菜单：任意匹配页都可设置/清除核对用 PAT
  registerTokenMenu();
  // 手动同步唯一入口（4.0.3：横幅与标题行的手动同步按钮均已移除）
  registerSyncMenu();
  // Hide Lists 开关（4.5.0）：任意匹配页可切换，默认开 = 隐藏 Lists 区块
  registerHideListsMenu();
  // 恢复已取消的 star（4.9.0）：可勾选 + 一键「恢复选中」+ 每行 star 按钮（ADR 0003）
  registerRestoreMenu();
  // 导入 / 导出（4.7.0）：任意匹配页可用（TM 菜单），数据落盘后不导航
  registerExportImportMenu();
  // 导入完成后的收尾：**只**在「Stars 页且网格已存在」时按当前筛选重绘。
  // 4.9.0 起**不再自动同步**（ADR 0005：导入是数据搬运，落盘即完成；是否拉远端由用户决定）。
  setAfterImportHandler(() => {
    if (isStarsPage() && document.querySelector('.stars-grid-container')) applyFilters({ keepPage: true });
  });
  // 开关切换后重挂已存在的配置面板（🟡-1：关态下面板须挂网格列顶，不占 Lists 槽位）
  setHideListsRepositionHandler(() => repositionSetupBanner());

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
  // 仓库详情页：只做超期备份清理后提前返回（4.9.0 起不再监听该页的 star/unstar）。
  // 4.8.0 起不再从详情页提取缓存数据（extract.ts 已删）：它写的字段 API 全覆盖，
  // 且 DOM 时间字段与 API 语义不一致，曾是回写脏态的源头（zai-org/ZCode 案例）。
  if (isRepoDetailPage) {
    // 详情页：只清理超期备份。不再监听 star/unstar（4.9.0 决策 D17：星状态真相只由整表
    // 同步判定，与用户从哪个页面点的无关），也不再触碰该页 GitHub 拥有的 star 按钮 DOM。
    cleanupExpiredUnstarred();
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
console.log('[github-star-manager] script loaded (document-start)');
// Lists 隐藏门控（4.5.0）：document-start 即按开关决定 CSS 规则是否生效，关闭时不留闪隐窗口
applyHideListsGate();
installBootHide();
// 原地翻页拦截：document-start 同步挂载，先于 Turbo 的 click 监听拿到事件
interceptPagination();
whenReady(() => {
  try {
    init();
  } catch (err) {
    console.error('[github-star-manager] init 失败，解除防闪烁隐藏', err);
    revealTurboHide();
    deactivateStars();
    revealBootHide('init 异常');
  }
});
