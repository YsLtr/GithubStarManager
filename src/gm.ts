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
declare const GM_registerMenuCommand: ((name: string, fn: () => void) => unknown) | undefined;
declare const GM_openInTab: ((url: string, options?: { active?: boolean }) => unknown) | undefined;

declare const GM_deleteValue: ((key: string) => void) | undefined;
declare const GM_xmlHttpRequest: ((details: {
  method?: string;
  url: string;
  timeout?: number;
  onload?: (res: { status: number; responseText: string }) => void;
  onerror?: () => void;
  ontimeout?: () => void;
}) => unknown) | undefined;

const LS_PREFIX = 'github-stars-grid::';
/** 敏感键：只存 GM、绝不进 localStorage 镜像（PAT 已是强制 API 的硬门槛，泄露面必须收紧） */
const SENSITIVE_KEYS = new Set<string>(['github_pat']);
function lsRead(key: string): unknown {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function lsWrite(key: string, value: unknown): void {
  // 敏感键拒写镜像，并顺手清理历史镜像残留
  if (SENSITIVE_KEYS.has(key)) {
    try {
      localStorage.removeItem(LS_PREFIX + key);
    } catch {
      /* 忽略 */
    }
    return;
  }
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
          // 敏感键迁移成功后立即清掉 localStorage 镜像（GM_setValue 抛错则保留镜像防丢）
          if (SENSITIVE_KEYS.has(key)) {
            try {
              localStorage.removeItem(LS_PREFIX + key);
            } catch {
              /* 忽略 */
            }
          }
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

/** 删除键（调用时判定；GM 与 localStorage 镜像一起清）——4.0.10 历史死键一次性清理用 */
export function gmRemove(key: string): void {
  if (typeof GM_deleteValue === 'function') {
    try {
      GM_deleteValue(key);
    } catch (e) {
      console.error('[github-stars-grid] GM_deleteValue 失败', e);
    }
  }
  try {
    localStorage.removeItem(LS_PREFIX + key);
  } catch {
    /* 忽略 */
  }
}



/** 原生 DOM 插入样式(不依赖 GM_addStyle;document.head 未就绪时挂到 html 上) */
/** 原生 DOM 插入样式(不依赖 GM_addStyle;document.head 未就绪时挂到 html 上)。返回节点供调用方持有句柄。 */
export function gmAddStyle(css: string): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);
  return style;
}

/** 注册 Tampermonkey 菜单命令（同样调用时判定；dev/非 TM 环境静默降级为日志） */
export function gmRegisterMenuCommand(name: string, fn: () => void): void {
  if (typeof GM_registerMenuCommand === 'function') {
    try {
      GM_registerMenuCommand(name, fn);
    } catch (e) {
      console.error('[github-stars-grid] GM_registerMenuCommand 失败', e);
    }
  } else {
    console.info('[github-stars-grid] GM_registerMenuCommand 不可用（非 TM 环境），无法打开 token 设置菜单');
  }
}

/** 打开新标签页（调用时判定）：TM 菜单回调没有用户激活，window.open 会被弹窗拦截器
 *  静默吞掉（无报错无跳转）；GM_openInTab 不走弹窗拦截。非 TM 环境回退 window.open。 */
export function gmOpenInTab(url: string): void {
  if (typeof GM_openInTab === 'function') {
    try {
      GM_openInTab(url, { active: true });
      return;
    } catch (e) {
      console.error('[github-stars-grid] GM_openInTab 失败，回退 window.open', e);
    }
  }
  window.open(url, '_blank', 'noopener');
}

/** 跨域文本获取（调用时判定）：GM_xmlHttpRequest 不受页面 CSP/CORS 限制；非 TM 环境回退 fetch */
export function gmFetchText(url: string): Promise<string> {
  if (typeof GM_xmlHttpRequest === 'function') {
    return new Promise((resolve, reject) => {
      try {
        GM_xmlHttpRequest({
          method: 'GET',
          url,
          timeout: 20000,
          onload: (res) => {
            if (res.status >= 200 && res.status < 300) resolve(res.responseText);
            else reject(new Error(`HTTP ${res.status}`));
          },
          onerror: () => reject(new Error('网络错误')),
          ontimeout: () => reject(new Error('超时')),
        });
      } catch (e) {
        reject(e);
      }
    });
  }
  return fetch(url, { cache: 'no-cache' }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  });
}
