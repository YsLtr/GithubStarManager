import { gmGet, gmSet } from '../gm';
import { GRACE_PERIOD, STORAGE_KEYS } from '../constants';
import { loadRepoCache, saveRepoCache } from './repoCache';
import { getTags, saveTags } from './tags';
import { getNote, saveNote } from './notes';
import type { PendingDeleteMap } from '../types';

export function loadPendingDelete(): PendingDeleteMap {
  return gmGet<PendingDeleteMap>(STORAGE_KEYS.pendingDelete, {});
}

export function savePendingDelete(all: PendingDeleteMap): void {
  gmSet(STORAGE_KEYS.pendingDelete, all);
}

/**
 * 记录 unstar：把缓存条目移入待删除区，并备份标签与备注。
 * 宽限期内重新 star 可完整恢复。
 */
export function markRepoUnstarred(repoId: string): void {
  const cache = loadRepoCache();
  if (!cache[repoId]) return;
  const pending = loadPendingDelete();
  pending[repoId] = Object.assign({}, cache[repoId], {
    unstarredAt: Date.now(),
    _tags: getTags(repoId),
    _note: getNote(repoId),
  });
  savePendingDelete(pending);
  delete cache[repoId];
  saveRepoCache(cache);
  saveTags(repoId, []);
  saveNote(repoId, '');
}

/** 记录 re-star：从待删除区恢复数据、标签与备注 */
export function markRepoStarred(repoId: string): void {
  const pending = loadPendingDelete();
  if (!pending[repoId]) return;
  const entry = pending[repoId];
  const tags = entry._tags || [];
  const note = entry._note || '';
  delete entry.unstarredAt;
  delete entry._tags;
  delete entry._note;
  const cache = loadRepoCache();
  cache[repoId] = entry;
  saveRepoCache(cache);
  if (tags.length > 0) saveTags(repoId, tags);
  if (note) saveNote(repoId, note);
  delete pending[repoId];
  savePendingDelete(pending);
}

/** 清理超过宽限期（24h）仍未 re-star 的待删除条目 */
export function cleanupExpiredUnstarred(): void {
  const pending = loadPendingDelete();
  const now = Date.now();
  let changed = false;
  for (const repoId in pending) {
    if (pending[repoId].unstarredAt && (now - pending[repoId].unstarredAt) > GRACE_PERIOD) {
      delete pending[repoId];
      changed = true;
    }
  }
  if (changed) savePendingDelete(pending);
}
