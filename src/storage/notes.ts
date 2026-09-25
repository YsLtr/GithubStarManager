import { gmGet, gmSet } from '../gm';
import { STORAGE_KEYS } from '../constants';
import { getStarsUserId } from './tags';
import type { NoteMap } from '../types';

/** 备注存储键：按用户隔离，未登录/取不到 ID 时退回旧键 */
function notesKey(userId: string): string {
  return userId ? STORAGE_KEYS.notesPrefix + userId : STORAGE_KEYS.legacyNotes;
}

/** 读取当前用户的全部备注 */
export function loadAllNotes(): NoteMap {
  return gmGet<NoteMap>(notesKey(getStarsUserId()), {});
}

/** 覆盖写入单个仓库的备注；**trim 后为空**等价于删除（只输入空格/换行 = 清空，4.7.0 与导入导出的判空判据统一）。
 *  注：只影响写入，存量空白备注不做批量清洗（无渲染危害，不值得为显示瑕疵做全体用户写操作）。 */
export function saveNote(repoId: string, text: string): void {
  const key = notesKey(getStarsUserId());
  const all = gmGet<NoteMap>(key, {});
  if (!text.trim()) {
    delete all[repoId];
  } else {
    all[repoId] = text;
  }
  gmSet(key, all);
}

/** 读取单个仓库的备注 */
export function getNote(repoId: string): string {
  return loadAllNotes()[repoId] || '';
}
