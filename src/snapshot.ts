// 到货页快照 — 4.0.0 清理后仅保留「确认 unstar 后清快照」这半边。
//
// 原 P1 presence-diff（recordArrival → 位移挂起 → enqueueVerify）随 4.0.0
// 「API 主模式」整体移除：渲染源 = GitHub API 全量缓存，页快照的 diff 发现
// 层失去入口（原生 HTML 卡片不再作为数据源）。
// 星状态判定改由 P4 全量拉取（fullSync.ts 三方 diff）承担；
// 本文件保留历史页快照的清理通道，供 starCheck 确认 unstar 后调用，
// 防止旧快照数据里的候选再次浮出（存量 stars_page_snapshots / shiftPending 键）。

import { STORAGE_KEYS } from './constants';
import { gmGet, gmSet } from './gm';
import { onExternalUnstarConfirmed } from './starCheck';
import type { PageSnapshots, ShiftPendingMap } from './types';

/** 确认 unstar 后从所有页快照与位移挂起中清除该 repoId（防止换页后再次被列为候选） */
function purgeRepoFromSnapshots(repoId: string): void {
  const all = gmGet<PageSnapshots>(STORAGE_KEYS.pageSnapshots, {});
  let changed = false;
  for (const key in all) {
    if (repoId in all[key]) {
      delete all[key][repoId];
      changed = true;
    }
  }
  const pending = gmGet<ShiftPendingMap>(STORAGE_KEYS.shiftPending, {});
  let pendingChanged = false;
  if (repoId in pending) {
    delete pending[repoId];
    pendingChanged = true;
  }
  if (changed) gmSet(STORAGE_KEYS.pageSnapshots, all);
  if (pendingChanged) gmSet(STORAGE_KEYS.shiftPending, pending);
}

// starCheck 确认回调（starCheck 不反向依赖本模块，避免循环 import）
onExternalUnstarConfirmed(purgeRepoFromSnapshots);
