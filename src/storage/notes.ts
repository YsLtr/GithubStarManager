import { GM_getValue, GM_setValue } from '$';
import { STORAGE_KEYS } from '../constants';
import { getStarsUserId } from './tags';
import type { NoteMap } from '../types';

/** 备注存储键：按用户隔离，未登录/取不到 ID 时退回旧键 */
function notesKey(userId: string): string {
  return userId ? STORAGE_KEYS.notesPrefix + userId : STORAGE_KEYS.legacyNotes;
}

/** 读取当前用户的全部备注 */
export function loadAllNotes(): NoteMap {
  return GM_getValue<NoteMap>(notesKey(getStarsUserId()), {});
}

/** 覆盖写入单个仓库的备注；空文本等价于删除 */
export function saveNote(repoId: string, text: string): void {
  const key = notesKey(getStarsUserId());
  const all = GM_getValue<NoteMap>(key, {});
  if (!text) {
    delete all[repoId];
  } else {
    all[repoId] = text;
  }
  GM_setValue(key, all);
}

/** 读取单个仓库的备注 */
export function getNote(repoId: string): string {
  return loadAllNotes()[repoId] || '';
}
