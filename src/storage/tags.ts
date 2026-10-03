import { gmGet, gmSet } from '../gm';
import { STORAGE_KEYS } from '../constants';
import { getViewerId } from '../pageScope';
import type { TagMap } from '../types';

/**
 * 标签/备注的**隔离账号** id。
 *
 * 取值必须是**登录者**（`octolytics-actor-id`），不是页面主人（`octolytics-dimension-user_id`）。
 * 旧版用的是后者，于是打开他人的 stars 页时读写的是**那个人的**命名空间 —— 这是
 * AGENTS.md「已知风险」第 16 条记录的既有缺陷，已在 4.12.0 修正（真机实测：`/mattn?tab=stars` 上
 * dimension_user_id = 10111 而登录者 actor-id = 130123551）。
 *
 * 本人页上两者数值相等 ⇒ 自有页的既有数据继续命中同一个键，无需迁移。
 * 取不到（登出 / GHES / meta 变更）返回 '' ⇒ 调用方**必须**拒绝读写（见下方护栏），
 * **不得**回落 `stars_tags` / `stars_notes` 这类无隔离的旧键：那会把不属于任何账号的存量数据显示出来。
 */
export function getStorageUserId(): string {
  return getViewerId();
}

/** 标签存储键。必须已有隔离 id（调用方先过护栏）——无 id 时的旧键回落已在 4.12.0 删除，
 *  因为它会让「登出 / 取不到身份」读到无隔离的存量数据（见 getStorageUserId 的注释）。 */
function tagsKey(userId: string): string {
  return STORAGE_KEYS.tagsPrefix + userId;
}

/** 读取当前账号的全部标签。取不到隔离 id（登出 / meta 变更）⇒ 返回空表，**不**回落旧键 */
export function loadAllTags(): TagMap {
  const userId = getStorageUserId();
  if (!userId) return {};
  return gmGet<TagMap>(tagsKey(userId), {});
}

/** 覆盖写入单个仓库的标签；空数组等价于删除。取不到隔离 id ⇒ no-op（不写旧键） */
export function saveTags(repoId: string, tagsArray: string[]): void {
  const userId = getStorageUserId();
  if (!userId) {
    console.warn('[github-star-manager] 取不到登录账号，已跳过标签写入（避免写进无隔离的旧键）');
    return;
  }
  const key = tagsKey(userId);
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


/** 把旧版无账号隔离的标签迁移到**当前登录者**的键下（仅当新键为空时）。取不到身份则不迁移。 */
export function migrateTagsIfNeeded(): void {
  const userId = getStorageUserId();
  if (!userId) return;
  const oldData = gmGet<TagMap | null>(STORAGE_KEYS.legacyTags, null);
  const newKey = STORAGE_KEYS.tagsPrefix + userId;
  const newData = gmGet<TagMap | null>(newKey, null);
  if (oldData && !newData) {
    gmSet(newKey, oldData);
  }
}
