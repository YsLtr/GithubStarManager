import { gmGet, gmSet } from '../gm';
import { STORAGE_KEYS } from '../constants';
import type { TagMap } from '../types';

/** 当前登录用户的 GitHub 数字 ID（用于标签/备注隔离） */
export function getStarsUserId(): string {
  const meta = document.querySelector('meta[name="octolytics-dimension-user_id"]');
  return meta ? meta.getAttribute('content') || '' : '';
}

/** 标签存储键：按用户隔离，未登录/取不到 ID 时退回旧键 */
function tagsKey(userId: string): string {
  return userId ? STORAGE_KEYS.tagsPrefix + userId : STORAGE_KEYS.legacyTags;
}

/** 读取当前用户的全部标签 */
export function loadAllTags(): TagMap {
  return gmGet<TagMap>(tagsKey(getStarsUserId()), {});
}

/** 覆盖写入单个仓库的标签；空数组等价于删除 */
export function saveTags(repoId: string, tagsArray: string[]): void {
  const key = tagsKey(getStarsUserId());
  const all = gmGet<TagMap>(key, {});
  if (tagsArray.length === 0) {
    delete all[repoId];
  } else {
    all[repoId] = tagsArray;
  }
  gmSet(key, all);
}

/** 读取单个仓库的标签 */
export function getTags(repoId: string): string[] {
  return loadAllTags()[repoId] || [];
}


/** 把旧版无用户隔离的标签迁移到当前用户的键下（仅当新键为空时） */
export function migrateTagsIfNeeded(): void {
  const userId = getStarsUserId();
  if (!userId) return;
  const oldData = gmGet<TagMap | null>(STORAGE_KEYS.legacyTags, null);
  const newKey = STORAGE_KEYS.tagsPrefix + userId;
  const newData = gmGet<TagMap | null>(newKey, null);
  if (oldData && !newData) {
    gmSet(newKey, oldData);
  }
}
