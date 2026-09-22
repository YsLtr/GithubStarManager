import { gmGet, gmSet } from '../gm';
import { STORAGE_KEYS } from '../constants';
import type { RepoCache, RepoData } from '../types';

/** 读取全部仓库缓存（所有用户共享） */
export function loadRepoCache(): RepoCache {
  return gmGet<RepoCache>(STORAGE_KEYS.repoCache, {});
}

export function saveRepoCache(all: RepoCache): void {
  gmSet(STORAGE_KEYS.repoCache, all);
}

/** 读取单个仓库缓存，未命中返回 null */
export function getRepoData(repoId: string): RepoData | null {
  return loadRepoCache()[repoId] || null;
}

/** 合并写入单个仓库缓存，并刷新 ts */
export function saveRepoData(repoId: string, data: Partial<RepoData>): void {
  const all = loadRepoCache();
  all[repoId] = Object.assign({}, all[repoId] || {}, data, { ts: Date.now() });
  saveRepoCache(all);
}
