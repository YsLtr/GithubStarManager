import { getRepoItems, getStarsMainColumn, hideListsSection, moveTopicsToRightSidebar } from './dom';
import { applyFilters } from './filters';
import { interceptSearchForm } from './search';
import { mountSyncButton } from './fullSync';
import { mountTopPager } from './topPager';
import { initLangColors } from './langColors';
import { isDesktop } from './utils';

/**
 * 把 Stars 列表页转换成卡片网格。
 * @returns 是否已完成转换（或已经转换过）
 */
export function transformStarsList(): boolean {
  if (!isDesktop()) return false;
  initLangColors(); // 语言色（4.3.0）：网格初始化即从数据源获取并缓存（每页一次；移动端不出卡片不拉）

  // Lists 区块（标题行 + 内容）与卡片网格无关，尽早隐藏；
  // 放在所有 early return 之前，turbo-frame 重渲染后再进来一次也不会漏。
  hideListsSection();

  const turboFrame = document.getElementById('user-starred-repos');
  if (!turboFrame) return false;

  const colLg9 = getStarsMainColumn();
  if (!colLg9) return false;

  // 4.0.0：原生列表不再解析（数据源 = API 缓存）；空列表 = frame 还没渲染 → 重试
  const repoItems = getRepoItems(colLg9);
  if (repoItems.length === 0 && !colLg9.querySelector('.stars-grid-container')) return false;

  if (colLg9.querySelector('.stars-grid-container')) return true;

  const gridContainer = document.createElement('div');
  gridContainer.className = 'stars-grid-container';

  // 原生列表整体隐藏：4.0.0 起卡片由缓存渲染，原生 DOM 仅作回落显示
  repoItems.forEach((item) => item.classList.add('stars-original-hidden'));

  // 分页器（4.0.0）：原生藏起 + 自造本地分页器（页码/总数来自缓存；顶部分页器克隆它）
  const nativePager = colLg9.querySelector('.paginate-container');
  if (nativePager) nativePager.classList.add('stars-original-hidden');
  gridContainer.appendChild(buildLocalPager());
  colLg9.appendChild(gridContainer);
  // “Starred repositories” 标题行右侧复制一份分页器（免滚动到底部才能翻页）
  // 标题行右侧的顶部翻页器：克隆**本地分页器**（数据源见 topPager.ts 的模块注释）
  const headerRow = mountTopPager(colLg9, gridContainer.querySelector<HTMLElement>('.paginate-container'));
  // 同步按钮（4.0.4 恢复）：贴在顶部翻页器左侧
  if (headerRow) mountSyncButton(headerRow);

  // 将 Starred topics 移到右侧边栏（搬运实现见 dom.ts：他人页视图也要用同一份）
  moveTopicsToRightSidebar();

  // 应用筛选（Tags 候选条由 applyFilters→refreshTagFilterBar 按需创建/收窄/撤条）
  interceptSearchForm();
  applyFilters();

  return true;
}

/**
 * 自造分页器（4.0.0）：本地页码/总数；`data-gsm-page` 供 window 捕获拦截；
 * 顶部分页器克隆它 → 两份都带 `gsm-local-pager` 类，统一被 updateLocalPagers 更新。
 */
function buildLocalPager(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'paginate-container gsm-local-pager';

  const group = document.createElement('div');
  group.className = 'BtnGroup';

  const prev = document.createElement('a');
  prev.className = 'btn BtnGroup-item';
  prev.href = '#';
  prev.dataset.gsmPage = 'prev';
  prev.textContent = 'Previous';

  // 4.10.0：页码指示器由 span 升级为 button —— 它是「点击输入要去的页数」的入口，
  // 必须可聚焦（键盘可达）、可被读屏描述，而不是一块纯视觉文本。
  // 注意：顶部那份是 cloneNode(true) 克隆件，**监听不会被复制**，所以交互一律由
  // pagination.ts 的 window 捕获委托承担（见该文件 / interceptPagination）。
  const info = document.createElement('button');
  info.type = 'button';
  info.className = 'btn BtnGroup-item gsm-page-info';
  info.title = '点击输入要跳到的页码';
  info.textContent = '…';

  const next = document.createElement('a');
  next.className = 'btn BtnGroup-item';
  next.href = '#';
  next.dataset.gsmPage = 'next';
  next.textContent = 'Next';

  group.append(prev, info, next);
  wrap.appendChild(group);
  return wrap;
}

