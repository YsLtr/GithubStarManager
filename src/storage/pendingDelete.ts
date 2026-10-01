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

/** 宽限期备份里的一条可恢复条目（恢复窗口与简报用） */
export interface RestorableEntry {
  repoId: string;
  /** `owner/repo`（优先取缓存过的 name，缺失时退回 repoId） */
  name: string;
  /** 入宽限区的时刻（ms） */
  unstarredAt: number;
  /** 距 24h 宽限期结束的剩余毫秒数（>0；超期条目不在列表里） */
  remainingMs: number;
  /** 备份下来的标签（用于窗口里的说明） */
  tags: string[];
  /** 备份下来是否有备注 */
  hasNote: boolean;
}

/**
 * 列出仍在宽限期内、可恢复的条目，剩余时间短的排前面（用户最该先处理的）。
 * 超期条目不会出现在列表里 —— ADR 0003：超期即删除标签/备注，不留墓碑行。
 */
export function listRestorable(now = Date.now()): RestorableEntry[] {
  const pending = loadPendingDelete();
  const out: RestorableEntry[] = [];
  for (const repoId in pending) {
    const e = pending[repoId];
    const at = e.unstarredAt || 0;
    const remainingMs = at + GRACE_PERIOD - now;
    if (remainingMs <= 0) continue;
    out.push({
      repoId,
      name: e.name || repoId,
      unstarredAt: at,
      remainingMs,
      tags: e._tags || [],
      hasNote: !!(e._note && e._note.trim()),
    });
  }
  out.sort((a, b) => a.remainingMs - b.remainingMs);
  return out;
}

/** 剩余时长的可读文案（`23h 41m` / `41m` / `2m`） */
export function formatRemaining(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return '<1m';
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
