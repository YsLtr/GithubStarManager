import { gmGet, gmSet } from '../gm';
import { STORAGE_KEYS } from '../constants';
import type { FullSyncMeta, RepoCache, RepoData } from '../types';

/**
 * API 数据就绪 = 至少完整整表过一次（全量缓存可渲染 = API 主模式前提）。
 *
 * **定义放在存储层**（4.14.0 从 `fullSync.ts` 迁来）：它读的只是 `stars_full_sync_meta`
 * 这一份存储元数据，而 `cardState.ts` 这类**不依赖 fullSync** 的模块也要用它判断
 * 「本人整表缓存是否可用」——留在 fullSync 会形成 `cardState → fullSync → starCheck →
 * cardAreas → cardState` 的导入环。`fullSync.ts` 仍以同名 re-export 对外提供，既有调用方
 * （`filters.ts` / `index.ts`）无需改动。
 */
export function hasApiData(): boolean {
  const meta = gmGet<FullSyncMeta>(STORAGE_KEYS.fullSyncMeta, {});
  return !!meta.lastFullSyncAt && (meta.count ?? 0) > 0;
}

/* 曾用过什么（D30 / 4.16.0 删除）：此处原有两段「读取即清洗」——`isPlausibleLangName(lang)`
 * 剔掉不合字符域的语言名，以及 `DEAD_REPO_FIELDS`（updated / langColor / ts）剔掉历史死字段，
 * 且两者都会把清洗结果写回存储（读路径带写盘副作用）。删除理由：
 * ① 三个死字段全仓零读者（types.ts 未声明）；② `isPlausibleLangName` 的字符类不含 `*`，
 * 而 linguist 的 `F*` / `Pro*C` 是合法顶层语言名 ⇒ 它实际在做「读取时误删当前合法数据」；
 * ③ 它只在读路径、从不在写路径（lang 的写点 fullSync / domRepos 都不过此门），从来不是防御。
 * 副作用：`loadRepoCache()` 现在是**纯读**，不再写存储（曾让夹具的零写入断言误报）。 */

/** 读取全部仓库缓存（所有用户共享）。纯读 —— 不做任何清洗、不写盘 */
export function loadRepoCache(): RepoCache {
  return gmGet<RepoCache>(STORAGE_KEYS.repoCache, {});
}

export function saveRepoCache(all: RepoCache): void {
  gmSet(STORAGE_KEYS.repoCache, all);
}


/** 合并写入单个仓库缓存 */
export function saveRepoData(repoId: string, data: Partial<RepoData>): void {
  const all = loadRepoCache();
  all[repoId] = Object.assign({}, all[repoId] || {}, data);
  saveRepoCache(all);
}
