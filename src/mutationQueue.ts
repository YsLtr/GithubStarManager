// 全局串行变异队列（4.9.0）。
//
// 卡片星按钮与恢复共用**同一个**队列：GitHub 官方 best-practices 对写操作有两条独立要求 ——
// 「串行/排队」（`maxConcurrent: 1`）与「每个请求之间至少等 1 秒」（原文 *"wait at least one
// second between each request. This will help you avoid secondary rate limits."*）。
// Octokit 的 plugin-throttling 对写请求的默认值即 `{ maxConcurrent: 1, minTime: 1000 }`。
// 来源：https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api
//
// 本模块只管**调度**：串行、间隔、排队期可撤销、失败不阻断队列。写什么、怎么判成功、
// 失败怎么归类全在调用方的 `run` 里（见 starWrites.ts）。
//
// 排队语义（ADR 0003）：
// - 卡片乐观翻转后入队；**排队中**再次点击 → 撤销该条（用户改主意不必等它发出）；
// - 已在执行的条目**不可撤销**（请求已发出，撤销只会制造「本地以为没做、远端做了」）；
// - 同一仓库在队列中最多一条（由调用方用 isMutationQueued 判断，避免重复入队）。

/** 相邻两次变异请求的**开始时刻**最小间隔（官方建议值，刻意不自动调参） */
export const MUTATION_GAP_MS = 1000;

/** 队列条目的执行结果由调用方定义（本模块只透传） */
export interface QueuedMutation<T> {
  /** 展示用标识（如 `owner/repo`），用于「同一仓库最多一条」判断与进度显示 */
  label: string;
  run: () => Promise<T>;
}

export interface MutationHandle<T> {
  readonly label: string;
  /** 排队中（尚未开始执行）撤销 → true；已在执行/已完成 → false */
  cancelQueued(): boolean;
  /** 排队中（尚未发出）？执行中与已完成都是 false */
  isQueued(): boolean;
  /** 结果兑现：被撤销时为 null */
  readonly done: Promise<T | null>;
}

interface Item<T> {
  label: string;
  run: () => Promise<T>;
  cancelled: boolean;
  started: boolean;
  resolve: (result: T | null) => void;
}

const queue: Item<unknown>[] = [];
/** 上次变异请求的**开始**时刻（墙钟）；0 = 还没发过 */
let lastStartAt = 0;
let draining = false;

const sleep = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));

/**
 * 入队一次变异操作。返回句柄：`cancelQueued()` 撤销排队中的条目，`done` 兑现结果。
 * 队列自身不抛错：`run` 抛出的异常会被转成「不可能出现的内部错误」并继续处理后续条目
 * （写路径的失败已在 starWrites 里归一为返回值，不会走到这里）。
 */
export function enqueueMutation<T>(mutation: QueuedMutation<T>): MutationHandle<T> {
  let resolve!: (result: T | null) => void;
  const done = new Promise<T | null>((r) => {
    resolve = r;
  });
  const item: Item<T> = {
    label: mutation.label,
    run: mutation.run,
    cancelled: false,
    started: false,
    resolve,
  };
  queue.push(item as Item<unknown>);

  const handle: MutationHandle<T> = {
    label: mutation.label,
    cancelQueued(): boolean {
      if (item.started) return false;
      if (item.cancelled) return true;
      item.cancelled = true;
      return true;
    },
    isQueued(): boolean {
      return !item.started && !item.cancelled;
    },
    done,
  };

  if (!draining) void drain();
  return handle;
}

/** 队列里是否已有该 label 的**未执行**条目（同仓库最多一条） */
export function isMutationQueued(label: string): boolean {
  return queue.some((it) => it.label === label && !it.started && !it.cancelled);
}

/** 未执行的排队条目数（不含正在执行的那条） */
export function queuedMutationCount(): number {
  return queue.filter((it) => !it.started && !it.cancelled).length;
}

async function drain(): Promise<void> {
  draining = true;
  try {
    while (queue.length > 0) {
      const item = queue.shift()!;
      if (item.cancelled) {
        item.resolve(null);
        continue;
      }
      // 间隔按「开始时刻」算：上一次请求开始后至少 MUTATION_GAP_MS 才发下一次
      const wait = lastStartAt + MUTATION_GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      if (item.cancelled) {
        // 等待期间被撤销：请求从未发出，兑现 null
        item.resolve(null);
        continue;
      }
      item.started = true;
      lastStartAt = Date.now();
      let result: unknown = null;
      try {
        result = await item.run();
      } catch (err) {
        console.error('[github-star-manager] 变异请求内部异常（队列继续）：', err);
        result = null;
      }
      item.resolve(result);
    }
  } finally {
    draining = false;
  }
}
