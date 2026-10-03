/**
 * 只读渲染器（4.13.0 起；4.14.0 起「只读」由 `cardState` 的**逐仓库三态**驱动；4.12.0 遗骸见文末）。
 *
 * ## 谁用本模块
 *
 * `cardAreas.renderCardTagAndNoteAreas()` —— 它算出每张卡片的 `CardState`，只有
 * `locked-pending` / `locked-empty` 才落到这里；`editable` 走 `ui/tagFilter` / `ui/notes`。
 * 本模块**不自己判断该不该只读**，只是「把给定数据画成不可编辑的样子」。
 *
 * ## 职责
 *
 * 卡片的**标签/备注**是纯展示的：不给删除按钮、不给新增输入框、不进编辑态、不写存储、不挂任何监听器
 * —— 唯一的提示是节点上的原生 `title`（用户 2026-10-03 与 4.14.0 两次裁定：只读提示不占可见位置）。
 *
 * 渲染目标就是卡片里那两个既有容器（`buildCardFromCache` 本来就会建，带 `data-repo-id`）：
 *   - `.stars-card-tags`  ← 本模块填 `.gsm-ro-tags`（内含 `span.gsm-ro-tag` 胶囊）
 *   - `.stars-card-notes` ← 本模块填 `.gsm-ro-notes`
 *
 * **数据由调用方传入**（4.14.0）：他人页可能有卡片的标签/备注只在 24h 宽限期备份里
 * （活区已被 `markRepoUnstarred` 清空）—— 见 `renderTagsReadOnly` 的注释。
 *
 * **只读形态**：样式来自 `styles/readonly.css`（整体包在桌面断点内，JS 侧另有视口门）。
 *
 * ## 为什么仍不给他人页写一份专用渲染器
 *
 * 4.14.0 起，他人页上**已 star 的卡片是可编辑的**（用户裁定），可编辑那份直接复用
 * `ui/tagFilter.ts` 的 `renderTags()` 与 `ui/notes.ts` 的 `renderNotes()`，**不复制实现** ——
 * 两份实现必然漂移，而漂移正是 4.13.0「点一下 star 整页变可编辑」这个缺陷的成因。
 * 隔离他人页不需要的副作用（点标签=切换筛选、保存后调 `applyFilters`）由
 * `renderTags()` 的 `filterToggle` 上下文开关承担。本模块只负责**不可编辑**的形态，
 * 两者是互补关系，不是替代关系。
 *
 * ## 4.12.0 遗骸（已删）
 *
 * 4.12.0 曾在他人页**保留原生列表**、把徽章贴进原生命中条目内（`enterReadOnlyMode` / `collectNativeItems` /
 * `decorateItem`）。4.13.0 改为网格渲染后该路径整体删除 —— 原生条目会被隐藏，贴在它内部的徽章自然不可见，
 * 两种呈现不能共存（见 AGENTS.md D26 与 `docs/adr/0008`）。**保留下来的是**：徽章 builder 与 `readonly.css`。
 */

import { gmAddStyle } from './gm';
import readonlyCss from './styles/readonly.css?inline';

/**
 * 只读节点上**唯一**的提示（原生 `title`，不加任何可见装饰 —— 用户 2026-10-03 与 4.14.0 两次裁定：
 * 卡片不要多余描述文字、不要说明行、不要徽章）。
 *
 * 两条文案按**状态**分叉（4.14.0），复现口径见 `docs/adr/0009`：
 * - `CARDS_TITLE_LOCKED`：本人没 star 过这个仓库 —— 数据来自活区（多半是空的，或导入进来的标签）；
 * - `CARDS_TITLE_PENDING`：本人**取消过** star，但标签/备注还在 24h 宽限期备份里 ⇒ 必须说清
 *   「为什么突然不能改」以及「数据不是没了」，否则用户会以为取消 star 就等于删掉标签。
 */
export const CARDS_TITLE_LOCKED = '标签与备注只能在你自己的 stars 页面上修改（本页为只读显示）';
/** 已 unstar、但仍在 24h 宽限期备份里：数据仍在，只是不可编辑 */
export const CARDS_TITLE_PENDING = '已取消 star：标签与备注保留 24 小时，期间不可编辑';

/** 只读样式表句柄（回滚时按它移除；同时保证不重复注入） */
let styleEl: HTMLStyleElement | null = null;

/** 按需注入只读样式表（幂等；要素：节点被 Turbo 换掉后句柄会失联） */
function ensureStyles(): void {
  if (!styleEl || !styleEl.isConnected) styleEl = gmAddStyle(readonlyCss);
}

/** 只读标签行：`div.gsm-ro-tags > span.gsm-ro-tag`（无删除按钮、无新增入口、无监听器） */
function buildTagRow(tags: string[], title: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'gsm-ro-tags';
  row.title = title;
  for (const tag of tags) {
    const pill = document.createElement('span');
    pill.className = 'gsm-ro-tag';
    pill.textContent = tag; // textContent：标签是用户文本
    row.appendChild(pill);
  }
  return row;
}

/**
 * 只读备注行（无编辑态、无监听器）。
 *
 * 观感**与自己卡片的备注完全一致**（用户 2026-10-03 裁定）：直接复用自己卡片备注的文本类
 * `stars-card-notes-text`（base.css 里那一条规则），本模块**不再自带任何备注样式** ——
 * 曾自加「备注：」前缀（`::before`）与左侧一条竖线（`border-left`），都被判为多余。
 * 用同一个类而不是复制一份声明，是为了让两者**不可能漂移**：自己卡片的备注改了样式，这里跟着改。
 * `.gsm-ro-notes` 保留作身份标记（回滚清单与断言按它找人），不再挂样式。
 */
function buildNoteRow(note: string, title: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'stars-card-notes-text gsm-ro-notes';
  row.title = title;
  row.textContent = note; // textContent：备注是用户文本，绝不进 innerHTML
  return row;
}

/**
 * 把标签**只读**渲染进卡片的标签容器。
 *
 * 数据**由调用方传入**（4.14.0）：他人页的 `locked-pending` 卡片要显示的是 24h 宽限期**备份**里的
 * 标签，而活区此刻是空的（`markRepoUnstarred` 已经把数据搬走并清空现位）。渲染器自己去读活区
 * 就会把这些卡片的标签显示成空 —— 那正是 4.13.0「unstar 后标签立刻消失」的成因。
 * 取数职责在 `cardState.readCardDisplayData()`（活区优先、活区为空再看备份）。
 *
 * 先抹后建：数据可能变（导入、切页重渲染），本函数必须收敛到「DOM 与存储一致」。
 * 无标签 ⇒ 留空容器（不显示任何占位）。
 */
export function renderTagsReadOnly(container: HTMLElement, tags: string[], title = CARDS_TITLE_LOCKED): void {
  container.innerHTML = '';
  if (tags.length === 0) return;
  ensureStyles();
  container.appendChild(buildTagRow(tags, title));
}

/** 把备注**只读**渲染进卡片的备注容器（数据同样由调用方传入，理由见 `renderTagsReadOnly`）。无备注 ⇒ 留空容器。 */
export function renderNotesReadOnly(container: HTMLElement, note: string, title = CARDS_TITLE_LOCKED): void {
  container.innerHTML = '';
  if (!note) return;
  ensureStyles();
  container.appendChild(buildNoteRow(note, title));
}

/**
 * 退出只读：移除只读样式表与所有 `.gsm-ro-*` 节点。
 * 只按脚本自有 class 抹除 —— 从不改 GitHub-owned 节点的属性，所以不需要任何标记或启发式还原。
 * 幂等，可重复调用。
 */
export function exitReadOnlyMode(): void {
  styleEl?.remove();
  styleEl = null;
  document.querySelectorAll('.gsm-ro-tags, .gsm-ro-notes').forEach((el) => el.remove());
}
