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
// - 同一目标由队列统一去重，覆盖排队、间隔等待、解析和写请求执行期。

/** 相邻两次变异请求的**开始时刻**最小间隔（官方建议值，刻意不自动调参） */
export const MUTATION_GAP_MS = 1000;

/** 队列条目的执行结果由调用方定义（本模块只透传） */
interface QueuedMutation<T> {
  key: string;
  /** 只展示，不用于去重。 */
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
  keys: Set<string>;
  completionAtEnqueue: number;
  label: string;
  run: () => Promise<T>;
  cancelled: boolean;
  started: boolean;
  resolve: (result: T | null) => void;
}

const queue: Item<unknown>[] = [];
const live = new Set<Item<unknown>>();
let active: Item<unknown> | null = null;
let completion = 0;
const completedKeys = new Map<string, number>();
/** 上次变异请求的**开始**时刻（墙钟）；0 = 还没发过 */
let lastStartAt = 0;
let draining = false;

const sleep = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));

/**
 * 入队一次变异操作。返回句柄：`cancelQueued()` 撤销排队中的条目，`done` 兑现结果。
 * 队列自身不抛错：`run` 抛出的异常会被转成「不可能出现的内部错误」并继续处理后续条目
 * （写路径的失败已在 starWrites 里归一为返回值，不会走到这里）。
 */
export function enqueueMutation<T>(mutation: QueuedMutation<T>): MutationHandle<T> | null {
  if (!mutation.key || isMutationQueued(mutation.key)) return null;
  let resolve!: (result: T | null) => void;
  const done = new Promise<T | null>((r) => {
    resolve = r;
  });
  const item: Item<T> = {
    keys: new Set([mutation.key]),
    completionAtEnqueue: completion,
    label: mutation.label,
    run: mutation.run,
    cancelled: false,
    started: false,
    resolve,
  };
  queue.push(item as Item<unknown>);
  live.add(item as Item<unknown>);

  const handle: MutationHandle<T> = {
    label: mutation.label,
    cancelQueued(): boolean {
      if (item.started) return false;
      if (item.cancelled) return true;
      item.cancelled = true;
      live.delete(item as Item<unknown>);
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

/** 包括正在执行的目标；调用方不用再分别做“检查 + 入队”。 */
export function isMutationQueued(key: string): boolean {
  return [...live].some((it) => it.keys.has(key));
}

/** 名称入口在执行时才拿到 ID，必须再认领一次；同批队列已完成的别名也不能重复写。 */
export function claimMutationTarget(key: string): boolean {
  if (!active) return true; // setStarState 的独立调用仍可用（产品入口全部经过队列）。
  if ([...live].some(it => it !== active && it.keys.has(key))) return false;
  if ((completedKeys.get(key) ?? 0) > active.completionAtEnqueue) return false;
  active.keys.add(key);
  return true;
}

/** 每个真实变异请求（包括 REST → 网页降级）都经过这里，而非把解析起点当写起点。 */
export async function waitForMutationSlot(): Promise<void> {
  const wait = lastStartAt + MUTATION_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastStartAt = Date.now();
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
      active = item;
      let result: unknown = null;
      try {
        result = await item.run();
      } catch (err) {
        console.error('[github-star-manager] 变异请求内部异常（队列继续）：', err);
        result = null;
      }
      item.resolve(result);
      completion += 1;
      for (const key of item.keys) completedKeys.set(key, completion);
      live.delete(item);
      active = null;
    }
  } finally {
    draining = false;
    active = null;
    completedKeys.clear();
  }
}
