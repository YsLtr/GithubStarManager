/**
 * 页面已渲染条目 → `RepoData`（4.13.0「他人 star 页零网络只读网格」的**投影层**）。
 *
 * ## 为什么存在
 *
 * 他人的 star 页不允许发任何请求（用户口径：只获取页面中已有的数据）。所以网格的数据源**只有**
 * 页面上的原生条目 —— 本模块就是那一次「DOM → 内存表」的投影。**纯读**：不写存储、不发请求、不建节点。
 *
 * ## 两条条目路线（真机实测 2026-10-03，两条路由的条目容器不同、内部结构相同）
 *
 * | 路由 | 条目容器 | 定位方式 |
 * |---|---|---|
 * | `/{login}?tab=stars` | `div.col-12.d-block.width-full.tmp-py-4.border-bottom` | 复用自己的 `getRepoItems()`（`div:has(> div.f6.color-fg-muted)`） |
 * | `/stars/{login}` | `li.tmp-py-4.border-bottom.public` | `li` 不是 `div`，`getRepoItems()` 一条都收不到 ⇒ 退到「最外层 `li` 且含仓库特征（`user-list-menu[data-repository-id]` 或 `a[href$="/stargazers"]`）」 |
 *
 * ## 未登录访客的页面（4.13.0，用户要求「继续兼容未登录的 stars 页」）
 *
 * 真机实测（`Norman-bury?tab=stars`，`body.logged-out`）：条目**照常渲染**（30 个 `h3 a`、描述、语言、
 * star/fork 计数都在），但**没有** `user-list-menu[data-repository-id]`（0 个）、没有 `starring-container`、
 * 没有 star/unstar 表单 —— 那些是「登录用户的收藏/清单控件」。于是 `repoId` 不能只靠数字 id：
 *
 * - 有 `user-list-menu[data-repository-id]`（登录态）⇒ 用数字 id（与本人缓存/标签/备注**同键**）；
 * - 没有（未登录）⇒ 退回**仓库全名**（`owner/repo`）。只读网格里这个 id 只用于卡片去重与建键，
 *   而未登录时本来就没有标签/备注/星按钮，故两者等价可用。
 *
 *
 * 两条路线的**条目内部**是同一套四个块（真机逐一核对）：
 *
 * ```html
 * <div class="d-inline-block mb-1">        <!-- 标题：h3 > a[href] = /owner/repo -->
 * <div class="float-right d-flex">         <!-- 操作区：sponsor / star / lists（只读模式下全部保留但会被藏掉的条目一起藏掉） -->
 * <div class="py-1">                       <!-- 描述：p（可能为空；`/stars/{login}` 上实测恒为空串） -->
 * <div class="f6 color-fg-muted mt-2">     <!-- 元信息：语言 / star / fork / 时间 -->
 * ```
 *
 * ## 字段可得性（这是本设计最脆弱的一环，改选择器前先看这张表）
 *
 * | `RepoData` 字段 | DOM 来源 | 可得性 |
 * |---|---|---|
 * | `name` | `h3 a[href]` 的 `href`（**用 href 不用 textContent**：第三方 utags 脚本会往 `h3` 里插按钮，文本会被污染） | 必有 |
 * | `desc` | `div.py-1 p` 文本 | 可能缺失/为空 ⇒ 留空，由卡片渲染「No description」 |
 * | `lang` | `[itemprop="programmingLanguage"]` | 无语言仓库缺失（实测 30 条里 29 条有） |
 * | `stars` | `a[href$="/stargazers"]` 文本（**含千分位逗号**，如 `1,361` ⇒ 去逗号再解析） | 必有 |
 * | `forks` | `a[href$="/forks"]` 文本（同样含逗号） | fork 数为 0 时缺失 |
 * | `updatedAt` | `relative-time[datetime]`，**且前一个文本节点是 `Updated`** | `?tab=stars` 有 |
 * | `starredAt` | 同上，**前一个文本节点是 `Starred`** | `/stars/{login}` 有 |
 * | `unstarredAt` | **不读** —— 只读模式不渲染星按钮，星状态与网格无关 | 不需要 |
 *
 * 时间字段**按标签分派**：两条路由同一个位置显示的是**不同语义**的时间（profile 标签页是 `Updated`、
 * 新版页是 `Starred`，实测同一仓库两处值不同）。所以不能不管标签一律塞进 `updatedAt` —— 那会把 star 时间
 * 谎报成「Updated」。
 *
 * ## 不猜原则
 *
 * 取不到就留空：缺 `name`（无法定位仓库）的条目整条跳过；其余字段缺失只是少显示一块。
 */

import { getRepoItems } from './dom';
import type { RepoData } from './types';

/** 一个页面条目的投影结果：数字 id（= 标签/备注的存储键）+ 数据 + 原节点（供隐藏/回滚） */
interface PageRepo {
  repoId: string;
  data: RepoData;
  item: HTMLElement;
}

/** 条目四个块的选择器（见文件头结构表） */
const TITLE_LINK = 'h3 a[href]';
const META_BLOCK_SELECTOR = 'div.f6';
const META_BLOCK_CLASS = 'color-fg-muted';

/** 直接子块查找：避开条目内部深层嵌套的同类节点（如 Lists 浮层里也含 `div.f6`） */
function directChild(parent: HTMLElement, predicate: (el: HTMLElement) => boolean): HTMLElement | null {
  for (const child of Array.from(parent.children)) {
    if (child instanceof HTMLElement && predicate(child)) return child;
  }
  return null;
}

function textOf(el: Element | null): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** 从 `a[href$=...]` 的文本里取计数：**必须去千分位逗号**（实测 `1,361`），只保留数字 */
function parseCount(text: string): number | undefined {
  const digits = text.replace(/[^\d]/g, '');
  if (!digits) return undefined;
  const n = Number(digits);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 条目 → `RepoData`。返回 `null` 表示「这条无法定位」（缺 repoId 或缺 name）⇒ 调用方跳过它。
 */
function extractRepoFromItem(item: HTMLElement): PageRepo | null {
  // name：用 href 而非文本（第三方脚本会往 h3 里插按钮，文本不可信）
  const href = item.querySelector<HTMLAnchorElement>(TITLE_LINK)?.getAttribute('href') ?? '';
  const name = href.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!name || !name.includes('/')) return null;

  // repoId：优先 `user-list-menu[data-repository-id]`（它同时是标签/备注的存储键，与本人缓存同键；
  // 每条有两个 —— star/unstar 各一份 —— 取第一个即可）。未登录页面上**没有**这个元素
  // （真机实测：30 条 `h3 a` 齐全而 `user-list-menu` 为 0）⇒ 退回仓库全名。
  const menu = item.querySelector<HTMLElement>('user-list-menu[data-repository-id]');
  const repoId = (menu?.dataset.repositoryId ?? '').trim() || name;

  const data: RepoData = { name };

  const descBlock = directChild(item, (el) => el.tagName === 'DIV' && el.classList.contains('py-1'));
  const desc = textOf(descBlock?.querySelector('p') ?? descBlock);
  if (desc) data.desc = desc;

  // 元信息块必须是**直接子节点**且带 color-fg-muted（条目内的 Lists 浮层里也有 div.f6）
  const meta = directChild(item, (el) => el.matches(META_BLOCK_SELECTOR) && el.classList.contains(META_BLOCK_CLASS));
  if (meta) {
    const lang = textOf(meta.querySelector('[itemprop="programmingLanguage"]'));
    if (lang) data.lang = lang;

    const stars = parseCount(textOf(meta.querySelector('a[href$="/stargazers"]')));
    if (stars !== undefined) data.stars = stars;

    const forks = parseCount(textOf(meta.querySelector('a[href$="/forks"]')));
    if (forks !== undefined) data.forks = forks;

    // 时间：按**前面的标签文本**分派语义（见文件头注释），两边都取不到就都不写
    const rel = meta.querySelector<HTMLElement>('relative-time[datetime]');
    const iso = rel?.getAttribute('datetime') ?? '';
    if (rel && iso) {
      const label = (rel.previousSibling?.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (label.includes('starred')) data.starredAt = iso;
      else if (label.includes('updated')) data.updatedAt = iso;
      // 标签认不出（GitHub 改文案）⇒ 宁可不写：写错会把 star 时间谎报成 Updated
    }
  }

  return { repoId, data, item };
}

/**
 * 页面上所有原生条目的投影。
 *
 * 两条路线互斥：先试自己的 `getRepoItems()`（profile 标签页），**一条都没收到**再试新版页的 `li`。
 * 按 `repoId` 去重（同一仓库在页面上只应有一个条目，但浮层/克隆可能造成重复）。
 * 认不出任何条目 ⇒ 返回空数组，调用方据此放弃接管（不报错、不猜）。
 */
export function collectPageRepos(scope: ParentNode): PageRepo[] {
  const out: PageRepo[] = [];
  const seen = new Set<string>();

  const take = (item: HTMLElement): void => {
    const parsed = extractRepoFromItem(item);
    if (!parsed || seen.has(parsed.repoId)) return;
    seen.add(parsed.repoId);
    out.push(parsed);
  };

  for (const item of getRepoItems(scope)) take(item);
  if (out.length > 0) return out;

  // 新版 stars 页（`/stars/{login}`）：条目是 `li`，取最外层（避免嵌套 li 重复）。
  // 仓库特征（二选一）：登录态是 `user-list-menu[data-repository-id]`；未登录**没有**它，
  // 改用条目内必有而 Starred topics 那种 `li` 必无的 `a[href$="/stargazers"]`。
  // （不能退到「`h3 a` 的 href 像 owner/repo」—— `/topics/{name}` 也是 `a/b` 形状，会把 topics 当仓库。）
  for (const li of scope.querySelectorAll<HTMLElement>('li')) {
    if (li.closest('li') !== li) continue;
    if (!li.querySelector('user-list-menu[data-repository-id], a[href$="/stargazers"]')) continue;
    take(li);
  }
  return out;
}
