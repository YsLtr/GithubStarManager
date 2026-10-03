/**
 * 只读渲染器（4.13.0 起；4.12.0 遗骸保留说明见文末）。
 *
 * ## 职责
 *
 * 他人 star 页的网格里，卡片的**标签/备注**是纯展示的：不给删除按钮、不给新增输入框、不进编辑态、
 * 不写存储、不挂任何监听器 —— 唯一的提示是节点上的原生 `title`（用户 2026-10-03 裁定：
 * 「他人页编辑无效、点击无反应、提示去自己的页面改」）。
 *
 * 渲染目标就是卡片里那两个既有容器（`buildCardFromCache` 本来就会建，带 `data-repo-id`）：
 *   - `.stars-card-tags`  ← 本模块填 `.gsm-ro-tags`（内含 `span.gsm-ro-tag` 胶囊）
 *   - `.stars-card-notes` ← 本模块填 `.gsm-ro-notes`
 *
 * **只读形态**：样式来自 `styles/readonly.css`（整体包在桌面断点内，JS 侧另有视口门）。
 *
 * ## 为什么不用自己的可编辑渲染器
 *
 * 自己的 stars 页用的是 `ui/tagFilter.ts` 的 `renderTags()` 与 `ui/notes.ts` 的 `renderNotes()`，
 * 二者在渲染时**直接**绑 `saveTags` / `saveNote` 并调 `applyFilters()` —— 它们属于「我的页面」的写路径。
 * 他人页零写入口，所以只共享「卡片容器」而不共享渲染器。
 *
 * ## 4.12.0 遗骸（已删）
 *
 * 4.12.0 曾在他人页**保留原生列表**、把徽章贴进原生命中条目内（`enterReadOnlyMode` / `collectNativeItems` /
 * `decorateItem`）。4.13.0 改为网格渲染后该路径整体删除 —— 原生条目会被隐藏，贴在它内部的徽章自然不可见，
 * 两种呈现不能共存（见 AGENTS.md D26 与 `docs/adr/0008`）。**保留下来的是**：徽章 builder 与 `readonly.css`。
 */

import { gmAddStyle } from './gm';
import { getNote } from './storage/notes';
import { getTags } from './storage/tags';
import readonlyCss from './styles/readonly.css?inline';

/** 徽章上的唯一提示：说清「为什么点不动、该去哪里改」 */
const BADGES_TITLE = '标签与备注只能在你自己的 stars 页面上修改（本页为只读显示）';

/** 只读样式表句柄（回滚时按它移除；同时保证不重复注入） */
let styleEl: HTMLStyleElement | null = null;

/** 按需注入只读样式表（幂等；要素：节点被 Turbo 换掉后句柄会失联） */
function ensureStyles(): void {
  if (!styleEl || !styleEl.isConnected) styleEl = gmAddStyle(readonlyCss);
}

/** 只读标签行：`div.gsm-ro-tags > span.gsm-ro-tag`（无删除按钮、无新增入口、无监听器） */
function buildTagRow(tags: string[]): HTMLElement {
  const row = document.createElement('div');
  row.className = 'gsm-ro-tags';
  row.title = BADGES_TITLE;
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
function buildNoteRow(note: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'stars-card-notes-text gsm-ro-notes';
  row.title = BADGES_TITLE;
  row.textContent = note; // textContent：备注是用户文本，绝不进 innerHTML
  return row;
}

/**
 * 把**我自己的**标签只读渲染进卡片的标签容器（读的是登录者命名空间，见 storage/tags.ts）。
 *
 * 先抹后建：数据可能变（导入、切页重渲染），本函数必须收敛到「DOM 与存储一致」。
 * 无标签 ⇒ 留空容器（不显示任何占位）。
 */
export function renderTagsReadOnly(container: HTMLElement): void {
  const repoId = container.dataset.repoId || '';
  if (!repoId) return;
  container.innerHTML = '';
  const tags = getTags(repoId);
  if (tags.length === 0) return;
  ensureStyles();
  container.appendChild(buildTagRow(tags));
}

/** 把**我自己的**备注只读渲染进卡片的备注容器。无备注 ⇒ 留空容器。 */
export function renderNotesReadOnly(container: HTMLElement): void {
  const repoId = container.dataset.repoId || '';
  if (!repoId) return;
  container.innerHTML = '';
  const note = getNote(repoId);
  if (!note) return;
  ensureStyles();
  container.appendChild(buildNoteRow(note));
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
