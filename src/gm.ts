// GM API 兼容层。
//
// 起因(2026-09-22 真机复现):@run-at document-start 时,vite-plugin-monkey 对
// `$` 导入的 GM_* 会在 bundle 顶部做一次性 typeof 捕获,而部分 Tampermonkey
// 环境此时 GM_* 尚未就绪,捕获结果被永久固化为 undefined,DOMContentLoaded
// 后调用即 "TypeError: GM_addStyle is not a function"。
//
// 这里改为**调用时**判定:GM 可用就用 GM(与历史数据同一存储位置),不可用就
// 退到 localStorage 并双写;GM 恢复可用时,读取发现 GM 为默认值而 localStorage
// 有数据,会自动把数据迁移回 GM。任何"GM 晚到/永不到"的环境都能正常工作。

// 模块级 ambient 声明:运行时走裸标识符 typeof 查找(未定义也不抛错),
// 即使环境把 GM_* 绑在作用域而非 globalThis 也能命中。
declare const GM_getValue: (<T>(key: string, defaultValue: T) => T) | undefined;
declare const GM_setValue: ((key: string, value: unknown) => void) | undefined;

const LS_PREFIX = 'github-stars-grid::';

function lsRead(key: string): unknown {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function lsWrite(key: string, value: unknown): void {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  } catch (e) {
    console.error('[github-stars-grid] localStorage 写入失败', e);
  }
}

export function gmGet<T>(key: string, defaultValue: T): T {
  if (typeof GM_getValue === 'function') {
    const gmValue = GM_getValue(key, defaultValue);
    const lsValue = lsRead(key);
    // GM 是默认值、localStorage 却有数据(此前 GM 缺席期间写入的)→ 迁移回 GM
    if (lsValue !== undefined && JSON.stringify(gmValue) === JSON.stringify(defaultValue)) {
      if (typeof GM_setValue === 'function') {
        try {
          GM_setValue(key, lsValue);
        } catch {
          /* 迁移失败则维持现状,不影响读取 */
        }
      }
      return lsValue as T;
    }
    return gmValue;
  }
  const lsValue = lsRead(key);
  return lsValue === undefined ? defaultValue : (lsValue as T);
}

export function gmSet(key: string, value: unknown): void {
  if (typeof GM_setValue === 'function') {
    try {
      GM_setValue(key, value);
    } catch (e) {
      console.error('[github-stars-grid] GM_setValue 失败,仅写 localStorage', e);
    }
  }
  // 始终镜像到 localStorage:GM 缺席的会话也能读到最新数据
  lsWrite(key, value);
}

/** 原生 DOM 插入样式(不依赖 GM_addStyle;document.head 未就绪时挂到 html 上) */
export function gmAddStyle(css: string): void {
  const style = document.createElement('style');
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);
}
