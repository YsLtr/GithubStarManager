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
declare const GM_registerMenuCommand: ((name: string, fn: () => void, options?: { id?: unknown }) => unknown) | undefined;
/** TM 5.x 返回菜单命令 id（number|string），传入可移除后重注册以刷新菜单标签（4.5.0 Hide Lists 开关用） */
declare const GM_unregisterMenuCommand: ((id: unknown) => void) | undefined;
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
/** GM_download（调用时判定）：TM 侧要求下载功能开启且文件扩展名在白名单内，
 *  失败原因经 onerror 的 download.error 回传（not_enabled/not_whitelisted/not_permitted/not_succeeded）。
 *  文档：https://www.tampermonkey.net/documentation.php?q=api:GM_download */
declare const GM_download:
  | ((details: {
      url: string | Blob | File;
      name: string;
      saveAs?: boolean;
      onload?: () => void;
      onerror?: (err: { error?: string; details?: string }) => void;
    }) => unknown)
  | undefined;

const LS_PREFIX = 'github-star-manager::';
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
    console.error('[github-star-manager] localStorage 写入失败', e);
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
  // GM 缺席（非 TM / dev 挂载失败）→ 退到 localStorage 镜像。注意 PAT 因安全设计**不进镜像**，
  // 故这里读不到 token，症状是「同步报未配置 token」而用户明明配过 —— 必须显式说明。
  warnMissingGmApi('GM_getValue');
  const lsValue = lsRead(key);
  return lsValue === undefined ? defaultValue : (lsValue as T);
}

export function gmSet(key: string, value: unknown): void {
  if (typeof GM_setValue === 'function') {
    try {
      GM_setValue(key, value);
    } catch (e) {
      console.error('[github-star-manager] GM_setValue 失败,仅写 localStorage', e);
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
      console.error('[github-star-manager] GM_deleteValue 失败', e);
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

/**
 * 诊断「GM API 为什么不在」。
 *
 * 两种情况在代码里长得**一模一样**（`typeof GM_xxx !== 'function'`），但成因与出路完全不同：
 *  1. 真·非 TM 环境（或 TM 没给该脚本授权）——无解，属预期。
 *  2. **dev 模式 mountGmApi 失败**：页面域 `document` 上有 `__monkeyWindow-*` 属性（TM 里的 dev loader
 *     确实跑过），但该 key ≠ 本地 dev server 现在按**脚本头注释**算出的 key —— 于是
 *     `__vite-plugin-monkey.gm.api.js` 读不到 sandbox window，直接 return，一个 GM_* 都挂不上。
 *     **改过任何头字段（`@version` 最常触发）后必现**，因为 key 就是头注释的 md5 + base64url 前 16 位。
 *
 * 历史上这条日志把情况 2 报成「非 TM 环境」，把排查带偏过一次（现象是「TM 菜单消失了」，
 * 但脚本分明在 TM 里跑着）。故这里显式区分，并直接给出修复动作。详见 DEVELOPER.md §2。
 */
function missingGmApiReason(): string {
  const loaderKeys = Object.keys(document).filter((k) => k.startsWith('__monkeyWindow-'));
  if (loaderKeys.length > 0) {
    return (
      `dev loader 与本地产物的 window key 不一致（页面是 ${loaderKeys[0]}）——` +
      '改过脚本头（如 @version）后必现，导致 mountGmApi 读不到 sandbox window。' +
      '重新安装 http://127.0.0.1:5173/__vite-plugin-monkey.install.user.js 即可恢复。'
    );
  }
  return '非 TM 环境，或 TM 未给该脚本该授权（@grant 缺项）';
}

/** 首次发现 GM API 缺席时打一条**完整可执行**的诊断；后续调用静默（菜单有 8 项，否则刷屏）。 */
let gmApiWarned = false;
function warnMissingGmApi(missing: string): void {
  if (gmApiWarned) return;
  gmApiWarned = true;
  console.warn(
    `[github-star-manager] GM API 不可用（首个缺失的调用：${missing}）：${missingGmApiReason()}\n` +
      '· 后果：TM 菜单项消失；PAT 读不到（安全设计上 PAT 不写 localStorage 镜像）；' +
      'GM_openInTab / GM_xmlhttpRequest / GM_download 退化为本地回退或失效。\n' +
      '· 页面渲染不受影响：缓存等非敏感数据仍经 localStorage 镜像可用。'
  );
}

/** 注册/更新 Tampermonkey 菜单命令（调用时判定；dev/非 TM 环境静默降级为日志）。
 *  options.id（TM 4.20+）传入既有 id = 原地更新该菜单项的标签（刷新开关态用，避免 unregister+register 的
  *  历史缺陷面）；不传 = 新建，返回值 = 菜单项 id。 */
export function gmRegisterMenuCommand(name: string, fn: () => void, options?: { id?: unknown }): unknown {
  if (typeof GM_registerMenuCommand === 'function') {
    try {
      return GM_registerMenuCommand(name, fn, options);
    } catch (e) {
      console.error('[github-star-manager] GM_registerMenuCommand 失败', e);
    }
  } else {
    // 曾经这里写死「非 TM 环境」——正是这个误报把排查带偏（实为 dev mountGmApi 失败）。
    warnMissingGmApi('GM_registerMenuCommand');
  }
  return undefined;
}

/** 移除菜单命令（4.5.0：与 gmRegisterMenuCommand 返回的 id 配对；仅作 options.id 更新不可用时的回退） */
export function gmUnregisterMenuCommand(id: unknown): void {
  if (typeof GM_unregisterMenuCommand !== 'function') {
    warnMissingGmApi('GM_unregisterMenuCommand');
    return;
  }
  try {
    GM_unregisterMenuCommand(id);
  } catch (e) {
    console.error('[github-star-manager] GM_unregisterMenuCommand 失败', e);
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
      console.error('[github-star-manager] GM_openInTab 失败，回退 window.open', e);
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

/** 触发文件下载（调用时判定）：**只用 GM_download，不做原生兜底**。
 *  - 返回 true = 已交给 TM 下载器；false = GM_download 不存在或同步抛错（调用方须提示）。
 *  - TM 侧「下载」未开 / 扩展名不在白名单 / 缺 downloads 权限时**不抛错、不返回**，只走 onerror
 *    回调（TM 文档：GM_download 返回 { abort }，只有 GM.download 才是 promise）。
 *    故这类失败在此**不可观测**，只能由调用方的 alert 引导用户去 TM 设置加白名单。
 *  - 刻意不写 Blob + <a download> 兜底：那等于绕过 TM 的扩展名安全设置（用户已明确否决）。
 *  文档：https://www.tampermonkey.net/documentation.php?q=api:GM_download */
export function gmDownloadFile(data: Blob, filename: string): boolean {
  if (typeof GM_download !== 'function') {
    warnMissingGmApi('GM_download');
    return false;
  }
  try {
    GM_download({ url: data, name: filename });
    return true;
  } catch (e) {
    console.error('[github-star-manager] GM_download 调用失败', e);
    return false;
  }
}
