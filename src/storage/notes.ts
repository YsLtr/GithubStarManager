import { gmGet, gmSet } from '../gm';
import { STORAGE_KEYS } from '../constants';
import { getStorageUserId } from './tags';
import type { NoteMap } from '../types';

/** 备注存储键。与标签同一套账号隔离（4.18.0 起 = **归属账号**：token 账号，取不到才回退登录者；
 *  见 tags.ts 的 `getStorageUserId` 注释）；无隔离 id 时的旧键回落已在 4.12.0 删除
 *  （会让登出读到无隔离的存量数据）。 */
function notesKey(userId: string): string {
  return STORAGE_KEYS.notesPrefix + userId;
}

/** 读取当前账号的全部备注。取不到隔离 id（登出 / meta 变更）⇒ 返回空表，**不**回落旧键 */
export function loadAllNotes(): NoteMap {
  const userId = getStorageUserId();
  if (!userId) return {};
  return gmGet<NoteMap>(notesKey(userId), {});
}

/** 覆盖写入单个仓库的备注；**trim 后为空**等价于删除（只输入空格/换行 = 清空，4.7.0 与导入导出的判空判据统一）。
 *  注：只影响写入，存量空白备注不做批量清洗（无渲染危害，不值得为显示瑕疵做全体用户写操作）。
 *  取不到隔离 id ⇒ no-op（不写旧键）。 */
export function saveNote(repoId: string, text: string): void {
  const userId = getStorageUserId();
  if (!userId) {
    console.warn('[github-star-manager] 取不到归属账号（无 token 身份且取不到登录者），已跳过备注写入（避免写进无隔离的旧键）');
    return;
  }
  const key = notesKey(userId);
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
