// 窄视口回滚 / 离开 Stars 收尾（4.9.1）。
//
// 背景：脚本对页面的写入有两类 —— CSS 与 JS。
// CSS（base.css / wide.css / persistent.css）**全部**包在媒体查询里，窄视口自动失效；
// JS 写入的一切（脚本自有节点、class、内联样式、被搬走的原生节点）**不会**失效。
// 于是把窗口缩到手机宽度时，脚本不会「直接失效」，而是留下一地半吊子 DOM ——
// 这就是用户报告的「残次内容」。
//
// 本模块是唯一负责把它们逐项撤销的地方，**幂等**，服务于三条路径：
//   1. 运行中跨断点收窄（matchMedia change → 这里）；
//   2. 转换失败/重试耗尽的回退（原本只撤样式表，撤不干净）；
//   3. 离开 Stars 视图（turbo 切到别的 profile 标签）。
//
// 铁律：**按痕迹回滚**。脚本写过的东西要么带 gsm-*/stars-* 自有 class，要么带
// `data-gsm-hidden` 标记；禁止启发式猜测「这个 inline display 大概是我们设的」——
// 原生节点上的裸 display 无法与 GitHub 自己的样式区分，猜错就是直接改坏别人的页面。

import { clearListsHiddenMarks } from './dom';
import { revealBootHide, revealTurboHide } from './boot';
import { disposeNotificationStack } from './ui/notifications';
import { GSM_HIDDEN_ATTR, GSM_TOPICS_SRC_ATTR } from './constants';
import { unmountSyncButton } from './fullSync';
import { disposeSearchInterception } from './search';
import { isDesktop } from './utils';

export function teardownStarsView(reason: string): void {
  // 留痕（与链上其它转换一致）：网格消失后能一眼看出是谁撤的、为什么撤
  console.log(`[github-star-manager] teardown（回滚到原生视图）：${reason}`);
  // 1) 被搬走的原生内容先还回去：`.col-lg-3`（Starred topics）的整棵子树仍在右栏容器里。
  //    **只还回打了 `GSM_TOPICS_SRC_ATTR` 标记的那个节点**（transform.ts 搬运时打的）。
  //    不能只判 `isConnected`：Turbo 原位重渲染 `#user-starred-repos` 会换出一个**新的** `.col-lg-3`
  //    （内含 GitHub 自己渲染好的 topics），把右栏里的陈旧内容倒进去就是重复的 topics。
  //    无标记 = 不是我们搬过的那一个 ⇒ 直接丢弃右栏内容，什么都不动。
  const rightSidebar = document.querySelector<HTMLElement>('.stars-right-sidebar');
  if (rightSidebar) {
    const colLg3 = document.querySelector<HTMLElement>(
      `#user-starred-repos .col-lg-3[${GSM_TOPICS_SRC_ATTR}]`,
    );
    if (colLg3 && colLg3.isConnected) {
      while (rightSidebar.firstChild) colLg3.appendChild(rightSidebar.firstChild);
      colLg3.removeAttribute(GSM_TOPICS_SRC_ATTR);
    }
    // 无标记的 `.col-lg-3` 是 Turbo 换进来的新节点：宁可不还原，也不能把陈旧内容塞进别人的原生列。
    rightSidebar.remove();
  }

  // 2) 脚本自造节点。
  //    `unmountSyncButton()` 必须在这里显式调用：同步状态的订阅挂在模块上，
  //    只删节点摘不掉订阅（跨断点往返每轮都会多留一个指向游离按钮的闭包）。
  //    `.gsm-sync-status` 是头部按钮旁的读屏播报区（惰性建的，同样要清）。
  unmountSyncButton();
  document
    .querySelectorAll('.stars-grid-container, .gsm-top-pager, .gsm-sync-btn, .gsm-sync-status')
    .forEach((el) => el.remove());

  // 3) 脚本插进原生筛选行的控件 + 信息条 + 配置横幅
  document
    .querySelectorAll(
      '.gsm-type-filter, .gsm-lang-filter, .gsm-sort-filter, .stars-tag-filter, .stars-tag-info-bar, .gsm-setup-banner',
    )
    .forEach((el) => el.remove());

  // 4) 打在 GitHub 标题行上的类（flex 两端对齐，原生没有）
  document.querySelectorAll('.gsm-header-row').forEach((el) => el.classList.remove('gsm-header-row'));

  // 5) 原生节点上的隐藏：只按我们自己的标记撤（filters.ts 写 display 时同时打标记）
  document.querySelectorAll<HTMLElement>(`[${GSM_HIDDEN_ATTR}]`).forEach((el) => {
    el.style.removeProperty('display');
    el.removeAttribute(GSM_HIDDEN_ATTR);
  });

  // 6) 被脚本藏起来的原生列表项 / 原生分页器
  document.querySelectorAll('.stars-original-hidden').forEach((el) => el.classList.remove('stars-original-hidden'));

  // 7) Lists 隐藏：**只在窄视口清**（4.9.2 审查修正）。
  //    桌面下这是「页面级偏好」而非 Stars 视图的一部分 —— `applyHideListsGate()` 在
  //    document-start 就对任意匹配页挂上，门控 CSS 的选择器指向 `#profile-lists-container`
  //    / `blankslate`，都不是 Stars 专属节点。离开 Stars 视图时清掉它 = 切到 Repositories
  //    标签后 Lists 与开关状态相反地冒出来（4.9.2 引入的回归）。
  //    窄视口则是真残留：内联 `display:none !important` 不受媒体查询门控，必须清。
  const root = document.documentElement;
  if (!isDesktop()) {
    clearListsHiddenMarks();
    root.classList.remove('gsm-hide-lists');
  }

  // 8) 过渡/入场状态类（与视口无关）+ frame 上的 turbo 隐藏
  root.classList.remove('gsm-anim-prepare', 'gsm-turbo-entry');
  // 回滚时不做过渡动画：两个过渡起点类都必须摘干净，否则下次进桌面视图会带着旧起点闪一下
  revealTurboHide();
  revealBootHide(reason);

  // 9) 通知栈（含 3 个全局位置监听）：窄视口下已无网格可操作，留着只会成列盖住原生列表。
  //    再次需要时会自行重建（不是永久关闭通知）。
  disposeNotificationStack();

  // 10) 原生搜索框上的 submit/keydown 监听（search.ts）：必须解绑，否则收窄后脚本仍然
  //     preventDefault 掉原生搜索，而本地搜索已被视口门挡住 ⇒ 按回车「什么都不发生」。
  disposeSearchInterception();
}
