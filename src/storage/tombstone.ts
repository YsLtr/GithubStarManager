// 墓碑（4.22.0，issue #5）：远端星标列表里消失的仓库，再探测仓库本身是否还可达。
// - 可达（200）= 用户手动取消 star → 走既有 24h 宽限期（starCheck.confirmExternalUnstar）；
// - 不可达（404 / 410 / 451）= 仓库异常 → 留在整表缓存里打 tombstone，卡片变灰。
//
// 「留在整表缓存」是墓碑能工作的全部前提：筛选、标签/备注编辑、导出里的 repoNames 都读这份缓存。
// 标签与备注**不动**（仍在活区），所以它们照常可编辑、照常随导出包走。
import { loadAllNotes, getNote, saveNote } from './notes';
import { loadRepoCache, saveRepoCache } from './repoCache';
import { getTags, loadAllTags, saveTags } from './tags';
import type { RepoData } from '../types';

/** 恢复窗口「异常」分区的一行 */
export interface TombstoneEntry {
  repoId: string;
  name: string;
  tags: string[];
  hasNote: boolean;
  /** 判定时刻（ms） */
  at: number;
  /** 探测到的 HTTP 状态 */
  status: number;
}

/** 打墓碑；已在墓碑上 / 缓存里没有该条目 ⇒ false（幂等，不重复写盘） */
export function markRepoTombstone(repoId: string, status: number): boolean {
  const cache = loadRepoCache();
  const entry = cache[repoId];
  if (!entry || entry.tombstone) return false;
  entry.tombstone = { at: Date.now(), status };
  saveRepoCache(cache);
  return true;
}

/** 仓库重新可达时清墓碑（fullSync 交集分支调用）；不在墓碑上 ⇒ false */
export function clearRepoTombstone(repoId: string): boolean {
  const cache = loadRepoCache();
  const entry = cache[repoId];
  if (!entry?.tombstone) return false;
  delete entry.tombstone;
  saveRepoCache(cache);
  return true;
}

/** 列出全部墓碑，最近判定的排前面 */
export function listTombstones(): TombstoneEntry[] {
  const cache = loadRepoCache();
  const tags = loadAllTags();
  const notes = loadAllNotes();
  const out: TombstoneEntry[] = [];
  for (const repoId in cache) {
    const data: RepoData = cache[repoId];
    const t = data.tombstone;
    if (!t) continue;
    out.push({
      repoId,
      name: data.name || repoId,
      tags: tags[repoId] || [],
      hasNote: !!(notes[repoId] && notes[repoId].trim()),
      at: t.at,
      status: t.status,
    });
  }
  out.sort((a, b) => b.at - a.at);
  return out;
}

/**
 * 删除墓碑（不传 = 全部）。**连同标签与备注一起删**：留着会变成没有任何入口的孤儿数据，
 * 却仍随导出包走。返回实际删除条数。
 */
export function removeTombstones(repoIds?: string[]): number {
  const cache = loadRepoCache();
  const ids = repoIds ?? Object.keys(cache).filter((id) => !!cache[id].tombstone);
  let removed = 0;
  for (const id of ids) {
    if (!cache[id]?.tombstone) continue;
    delete cache[id];
    if (getTags(id).length > 0) saveTags(id, []);
    if (getNote(id)) saveNote(id, '');
    removed += 1;
  }
  if (removed > 0) saveRepoCache(cache);
  return removed;
}
