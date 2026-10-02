// 生命周期层（4.9.1）。
//
// 存在的理由是两个反复踩到的坑：
//
// 1. **监听与定时器不持句柄**：窄视口回滚（teardownStarsView）之后它们照跑 ——
//    转换重试链（150ms × 12）会把刚摘掉的样式表重新注入、turbo:frame-render 会把网格
//    重新建起来。回滚被自己排队的回调撤销，是「脚本没有直接失效、而是留下残次内容」
//    的第二层成因。
// 2. **延迟回调分不清世代**：有些回调（导航兜底等）必须跨越回滚存活，所以不能一律取消；
//    但「上一轮排队的整表转换」必须能在动手前自我作废。
//
// 做法只有两件事：受管登记（释放作用域即全部解绑）+ 世代号（跨越世代即丢弃）。
// 与 mutationQueue 里「.then 必须做 handle 身份校验」是同一个教训（AGENTS.md 决策 D10）。

export interface LifecycleScope {
  readonly name: string;
  /** 受管监听：作用域释放时自动 removeEventListener */
  addListener(
    target: EventTarget,
    type: string,
    handler: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ): void;
  /** 受管一次性定时器（返回 setTimeout id；释放时自动 clearTimeout） */
  timeout(fn: () => void, ms: number): number;
  /**
   * 受管 + **世代守卫**的一次性定时器：触发时若世代已推进（期间发生过转换或回滚）
   * 则静默丢弃。用于「排完队才发现自己已经过期」的转换/重渲染回调。
   */
  guardedTimeout(fn: () => void, ms: number): number;
  /** 受管 requestAnimationFrame */
  raf(fn: FrameRequestCallback): number;
  readonly disposed: boolean;
  /** 释放：解绑全部监听、清掉全部定时器与 rAF。幂等。 */
  dispose(): void;
}

/** 建一个作用域。作用域释放后任何新的登记都会被静默忽略（避免"边拆边建"）。 */
export function createScope(name: string): LifecycleScope {
  const disposers: Array<() => void> = [];
  const timers = new Set<number>();
  const rafs = new Set<number>();
  let disposed = false;

  const scope: LifecycleScope = {
    name,
    get disposed(): boolean {
      return disposed;
    },
    addListener(target, type, handler, options) {
      if (disposed) return;
      target.addEventListener(type, handler, options);
      disposers.push(() => target.removeEventListener(type, handler, options));
    },
    timeout(fn, ms) {
      if (disposed) return -1;
      const id = window.setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
      return id;
    },
    guardedTimeout(fn, ms) {
      const gen = generation;
      return scope.timeout(() => {
        if (gen !== generation) return; // 世代已推进：这次回调属于上一轮
        fn();
      }, ms);
    },
    raf(fn) {
      if (disposed) return -1;
      const id = window.requestAnimationFrame((ts) => {
        rafs.delete(id);
        fn(ts);
      });
      rafs.add(id);
      return id;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const off of disposers.splice(0)) off();
      for (const id of timers) window.clearTimeout(id);
      for (const id of rafs) window.cancelAnimationFrame(id);
      timers.clear();
      rafs.clear();
    },
  };
  return scope;
}

/* ---------------- 世代号 ---------------- */

/**
 * 每完成一次「进入桌面视图（转换）」或「回滚到原生视图（teardown）」就 +1。
 * 排队的异步回调据此判断自己是否已经过期。
 */
let generation = 0;

export function currentGeneration(): number {
  return generation;
}

/** 开启新世代，返回新值。所有以旧世代登记的 guardedTimeout 会在触发时自我作废。 */
export function beginGeneration(): number {
  generation += 1;
  return generation;
}

/** 承诺链里的同款守卫：`ifCurrent(gen, () => …)`，世代已推进则什么都不做。 */
export function ifCurrent(gen: number, fn: () => void): void {
  if (gen === generation) fn();
}
