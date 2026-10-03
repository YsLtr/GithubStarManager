import { gmGet, gmSet } from '../gm';
import { GRACE_PERIOD, STORAGE_KEYS } from '../constants';
import { loadRepoCache, saveRepoCache } from './repoCache';
import { getTags, saveTags } from './tags';
import { getNote, saveNote } from './notes';
import type { PendingDeleteEntry, PendingDeleteMap, RepoData } from '../types';

export function loadPendingDelete(): PendingDeleteMap {
  return gmGet<PendingDeleteMap>(STORAGE_KEYS.pendingDelete, {});
}

export function savePendingDelete(all: PendingDeleteMap): void {
  gmSet(STORAGE_KEYS.pendingDelete, all);
}

/**
 * 单条查询：该仓库是否**仍在** 24h 宽限期内（4.14.0）。
 *
 * 判据与 `listRestorable` 逐字一致（`unstarredAt + GRACE_PERIOD > now`），但**渲染时现算** ——
 * 刻意不依赖 `cleanupExpiredUnstarred()` 是否跑过：它只在 `init()` 与导入后各跑一次
 * （`index.ts:56` / `:568`），一个开着超过 24h 的标签页里，过期条目会一直挂在存储里。
 * 只看「pending 里有没有」就会显示一份早该消失的数据。
 *
 * @returns 在宽限期内的条目本身（含 `_tags` / `_note` 备份）；`null` = 不在（从未 unstar / 已超期）
 */
export function getPendingInGrace(repoId: string, now = Date.now()): PendingDeleteEntry | null {
  if (!repoId) return null;
  const entry = loadPendingDelete()[repoId];
  if (!entry) return null;
  return (entry.unstarredAt || 0) + GRACE_PERIOD > now ? entry : null;
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
 * 记录 unstar：把数据移入待删除区（24h 宽限期），并备份标签与备注。
 * 宽限期内重新 star 可完整恢复（`markRepoStarred`）。
 *
 * ## 建立备份的判据：「**有东西要保全就必须建**」（4.14.0 修订）
 *
 * 旧实现是 `if (!cache[repoId]) return;` —— 只认本人整表缓存。那条判据在他人 stars 页上会漏：
 * 那页允许「点 star（只在 `viewContext` 的内存覆盖里，**不进缓存**）→ 给卡片加标签 → 点 unstar」，
 * 此时缓存里没有该仓库 ⇒ 直接 return ⇒ ① 数据不备份（宽限期里看不到标签）、② 活区**不被清空**
 * ⇒ 标签永久留在存储里，而只读卡片又没有删除入口，用户再也清不掉它。
 *
 * 现在只要满足任一条就建备份：本人缓存有该条目 / 调用方给了 `seed`（他人页卡片上的投影数据）/
 * 该仓库当下有非空标签或备注。三者皆无 = 无物可保 ⇒ 什么都不做（与旧行为一致）。
 *
 * 注：`cache[repoId]` 不存在时不写缓存（本来就没有可删的条目）。
 *
 * @param seed 他人 stars 页传入的投影数据 —— 它只存在于内存里，不落整表缓存（零网络、零缓存写入）
 */
export function markRepoUnstarred(repoId: string, seed?: RepoData): void {
  const cache = loadRepoCache();
  const existing = cache[repoId];
  const tags = getTags(repoId);
  const note = getNote(repoId);
  if (!existing && !seed && tags.length === 0 && !note) return;

  const pending = loadPendingDelete();
  pending[repoId] = Object.assign({}, existing || seed || {}, {
    unstarredAt: Date.now(),
    _tags: tags,
    _note: note,
  });
  savePendingDelete(pending);

  if (existing) {
    delete cache[repoId];
    saveRepoCache(cache);
  }
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
