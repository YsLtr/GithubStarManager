// 恢复（4.9.0，ADR 0003）——把宽限期备份里的一条真正加星回远端。
//
// 「恢复」的定义（CONTEXT.md）：真实远端写请求 + 本地数据复原。
// **禁止只做本地回滚**——那会制造「本地有星、远端无星」的状态，下一轮整表同步又会把它
// 判成外部取关（ADR 0003 Considered Options）。
//
// 通道由 `starWrites.setStarState` 静默分派（有 classic/OAuth token → REST；否则用浏览器
// 登录会话走网页端点）；本模块只负责编排：串行队列、进度、取消、失败不掩盖。
//
// 队列语义：本模块**逐条**入队并等它完成（而不是一次把 N 条全推进去）——这样进度天然串行、
// 「取消」只需在入队前判断即可停住后续；已在执行的那条不可撤销（请求已发出）。

import { MUTATION_GAP_MS, enqueueMutation, isMutationQueued } from './mutationQueue';
import { getToken } from './tokenConfig';
import { setStarState, writeFailureMessage, type StarWriteOutcome } from './starWrites';
import { markRepoStarred, type RestorableEntry } from './storage/pendingDelete';
import { syncCardAfterStarChange } from './starCheck';
import { pushNotice, type NoticeHandle } from './ui/notifications';

/** 一条恢复的最终结果（供进度与汇总使用） */
export interface RestoreOutcome {
  repoId: string;
  name: string;
  ok: boolean;
  /** 失败时的用户可见原因（已过 writeFailureMessage） */
  message?: string;
}

/**
 * 恢复单条。走全局串行队列；同仓库已在排队时不重复入队（ADR 0003「同一仓库恒最多一条」）。
 * 成功 → `markRepoStarred()` 复原标签/备注 + 卡片原地翻回。
 */
export async function restoreOne(entry: { repoId: string; name: string }): Promise<RestoreOutcome> {
  const { repoId, name } = entry;
  if (!name.includes('/')) {
    return { repoId, name, ok: false, message: '仓库名缺失，无法恢复。' };
  }
  if (isMutationQueued(name)) {
    return { repoId, name, ok: false, message: '该仓库已在队列中，请稍候。' };
  }

  const handle = enqueueMutation<StarWriteOutcome>({
    label: name,
    run: () => setStarState(getToken(), name, true),
  });
  const outcome = await handle.done;

  if (outcome === null) {
    // 被撤销（排队期取消）——不是失败，也不算成功
    return { repoId, name, ok: false, message: '已取消排队。' };
  }
  if (!outcome.ok) {
    const message = writeFailureMessage(outcome.reason, outcome.status);
    console.warn(`[github-star-manager] 恢复失败：${name}｜${outcome.reason}｜${outcome.detail || ''}`);
    return { repoId, name, ok: false, message };
  }
  markRepoStarred(repoId);
  syncCardAfterStarChange(repoId, true);
  console.log(`[github-star-manager] ★ 已恢复 star：${name}`);
  return { repoId, name, ok: true };
}

export interface BatchOptions {
  /** 每条结束后的回调（含成功与失败），用于进度显示 */
  onProgress?: (done: number, total: number, result: RestoreOutcome) => void;
  /** 取消令牌：在执行每条之前检查；置 true 后不再启动后续条目 */
  token?: { cancelled: boolean };
}

export interface BatchResult {
  total: number;
  succeeded: number;
  failed: RestoreOutcome[];
  cancelled: boolean;
}

/**
 * 批量恢复。**严格串行**（逐条 await，队列自身也保证相邻请求 ≥1s），
 * **执行中可取消**（取消只停后续，已发出的不回滚），**不自动重试**。
 */
export async function restoreMany(entries: RestorableEntry[], opts: BatchOptions = {}): Promise<BatchResult> {
  const total = entries.length;
  const failed: RestoreOutcome[] = [];
  let succeeded = 0;
  let done = 0;
  let cancelled = false;

  for (const e of entries) {
    if (opts.token?.cancelled) {
      cancelled = true;
      break;
    }
    const result = await restoreOne({ repoId: e.repoId, name: e.name });
    done += 1;
    if (result.ok) succeeded += 1;
    else failed.push(result);
    opts.onProgress?.(done, total, result);
  }

  console.log(
    `[github-star-manager] 批量恢复结束：成功 ${succeeded}/${total}` +
      `${failed.length ? `，失败 ${failed.length}` : ''}${cancelled ? '（用户取消，后续未执行）' : ''}`
  );
  return { total, succeeded, failed, cancelled };
}

/** 同一仓库的通知只保留最新一条（ADR 0003：「同一仓库在队列中恒最多一条」的 UI 侧对应） */
const liveNotices = new Map<string, NoticeHandle>();

/** 批量恢复的预估耗时文案（串行 ≥1s/条，给 confirm 用） */
export function estimateBatchSeconds(count: number): number {
  return Math.max(1, Math.round((count * MUTATION_GAP_MS) / 1000));
}

/**
 * 为一条「取消 star」推一条带动作按钮的通知。
 * 文案分野（ADR 0003）：手动取消用「撤销」（用户刚做的动作）；同步简报用「恢复」
 * （用户没做过这个动作，且新增没有对称动作）。
 * 成功后**原地划掉** + 移除按钮（`complete()` 会重置 3s）。
 */
export function pushRestoreNotice(
  repoId: string,
  name: string,
  source: 'manual' | 'report',
): NoticeHandle {
  const text = source === 'manual' ? `已取消 star：${name}` : `检测到取消 star：${name}`;
  const actionLabel = source === 'manual' ? '撤销' : '恢复';
  // 同一仓库重复出现（手动取消后同步又检出该外部取关）时，先撤掉旧条目再推新的，
  // 避免同一条数据挂两个按钮。
  liveNotices.get(repoId)?.dismiss();
  let handle: NoticeHandle | null = null;
  handle = pushNotice(text, 'warn', {
    actionLabel,
    onAction: async () => {
      const r = await restoreOne({ repoId, name });
      if (r.ok) {
        handle?.complete(`✓ ${name} 已恢复`);
      } else {
        // ADR 0003「失败分支：一律只 alert 一行文字」——通知 3s 就没了，失败不能靠它传达
        window.alert(`恢复失败：${r.message || name}`);
      }
    },
  });
  liveNotices.set(repoId, handle);
  return handle;
}
