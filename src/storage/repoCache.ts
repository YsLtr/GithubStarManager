import { gmGet, gmSet } from '../gm';
import { STORAGE_KEYS } from '../constants';
import type { RepoCache, RepoData } from '../types';

/** linguist 语言名的字符域：字母/数字/空格/#/+'-.（C++、F#、Ren'Py、1C Enterprise、G-code 皆合法）。
 * 4.3.1 前的 DOM 提取曾把 2026 版详情页 Watch/Fork 计数条（"Watch1 (1)"）当语言写进缓存，此门挡住该类脏值。 */
function isPlausibleLangName(lang: string): boolean {
  return /^[A-Za-z0-9+#'.\-_ ]{1,40}$/.test(lang);
}

/** 4.8.0 起已死、读取时一并剔掉的历史字段（曾经有写入点、后被整体废弃，存量数据自愈清洗）：
 * - updated：缓存的相对时间展示文本（原详情页提取写入，4.8.0 起渲染时现算）
 * - langColor：per-repo 语言色（4.3.0 语言色运行时化后废除，渲染走 stars_lang_colors 全局映射） */
const DEAD_REPO_FIELDS = ['updated', 'langColor'] as const;

/** 读取全部仓库缓存（所有用户共享）。读取即清洗：历史脏值与死字段一次性剔除并写回 */
export function loadRepoCache(): RepoCache {
  const all = gmGet<RepoCache>(STORAGE_KEYS.repoCache, {});
  let dirty = false;
  for (const id in all) {
    const entry = all[id] as RepoData & Record<string, unknown>;
    const lang = entry.lang;
    if (lang !== undefined && !isPlausibleLangName(lang)) {
      delete entry.lang;
      dirty = true;
    }
    for (const f of DEAD_REPO_FIELDS) {
      if (f in entry) {
        delete entry[f];
        dirty = true;
      }
    }
  }
  if (dirty) saveRepoCache(all);
  return all;
}

export function saveRepoCache(all: RepoCache): void {
  gmSet(STORAGE_KEYS.repoCache, all);
}

/** 读取单个仓库缓存，未命中返回 null */

/** 合并写入单个仓库缓存，并刷新 ts */
export function saveRepoData(repoId: string, data: Partial<RepoData>): void {
  const all = loadRepoCache();
  all[repoId] = Object.assign({}, all[repoId] || {}, data, { ts: Date.now() });
  saveRepoCache(all);
}
