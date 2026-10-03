/**
 * 语言 → GitHub 语言色（4.3.0：运行时获取 + 全局缓存，不硬编码）
 *
 * 数据源：github-linguist/linguist `lib/linguist/languages.yml` 的 color 字段（GitHub 前端同源色值）。
 * 该文件十余年来保持「顶层语言名: + 两空格缩进 color: "#xxxxxx"」结构，行扫描提取即可，无需 YAML 依赖。
 *
 * 生命周期（用户定）：
 * 1. 网格初始化时直接从数据源获取并缓存（stars_lang_colors）；
 * 2. 渲染遇到未命中语言 → 再获取一次（单飞合并 + 失败冷却）；
 * 3. 获取成功后仍未命中才记入回退集（灰圈）——一种语言的回退记录只记一次，后续渲染不再触发获取；
 * 4. 后续任何一次获取都拿回退集对照新数据重检命中（已命中的摘出回退集）；
 * 5. 不单独保存每个仓库的语言颜色（颜色只由语言名决定），色表不进脚本源码。
 *
 * 获取失败 / 解析为空一律沿用旧缓存（fail-closed：坏数据不覆盖好缓存）。
 */
import { STORAGE_KEYS } from './constants';
import { gmGet, gmSet } from './gm';

/** 数据源：linguist 官方色表（2026-09-23 curl 实证：200 + CORS `*` + ETag） */
const SOURCE_URL = 'https://raw.githubusercontent.com/github/linguist/master/lib/linguist/languages.yml';
/** 未命中语言的圆点兜底色（GitHub 语言点默认灰） */
const LANG_COLOR_FALLBACK = '#8b949e';
/** 获取失败冷却：防止弱网/离线时每次渲染都打请求 */
const FETCH_COOLDOWN_MS = 30_000;

let colorMap: Record<string, string> = {}; // 语言小写名 → #rrggbb
/** 已确认无色（获取后仍未命中）的语言：渲染直接灰、不重复触发获取 */
const fallbackLangs = new Set<string>();
/** 本获取周期内发现的未命中语言：获取成功后与新数据对照，仍未命中才进回退集 */
const pendingMisses = new Set<string>();
let inflight: Promise<void> | null = null;
let nextFetchAt = 0;
let cacheLoaded = false;
let inited = false;

function loadCache(): void {
  if (cacheLoaded) return;
  cacheLoaded = true;
  const cached = gmGet<Record<string, string> | null>(STORAGE_KEYS.langColors, null);
  if (cached && typeof cached === 'object' && !Array.isArray(cached)) colorMap = cached;
}

/**
 * languages.yml 行扫描提取 语言名 → color。解析式与 .diag/gen-lang-colors.cjs 同源
 * （已对整份 yml 全量解析出 694 语言）；只认两空格缩进的带引号 color，规避别名/列表里的同名字段。
 */
function parseLangColors(yml: string): Record<string, string> {
  const out: Record<string, string> = {};
  let name = '';
  for (const ln of yml.split('\n')) {
    const m = ln.match(/^(?:"([^"]+)"|([^ \t][^:]*)):\s*$/);
    if (m) {
      name = (m[1] || m[2] || '').trim().toLowerCase();
      continue;
    }
    const c = ln.match(/^ {2}color: "(#[0-9a-fA-F]{6})"$/);
    if (c && name) out[name] = c[1];
  }
  return out;
}

/** 数据落地后把已渲染色点原地重涂（不重建网格，保住滚动位置与交互状态） */
function recolorDots(): void {
  document.querySelectorAll<HTMLElement>('[data-gsm-lang]').forEach((el) => {
    const lang = decodeURIComponent(el.dataset.gsmLang || '');
    el.setAttribute('style', `background-color: ${getLangColor(lang)}`);
  });
}

/** 从数据源取整份 languages.yml 文本。
 *
 *  用页面内的原生 `fetch`，**不用 GM_xmlhttpRequest**（4.9.1）：
 *  - 该域名实测返回 `Access-Control-Allow-Origin: *` + `Cross-Origin-Resource-Policy: cross-origin`，
 *    是简单 GET、不需要预检，页面直接 fetch 就能拿到（2026-09-23 与 2026-10-02 两次实测）；
 *  - github.com 的 CSP `connect-src` 已显式列出该主机；
 *  - 少声明一个 @grant，用户看到的能力清单就少一条「full internet access」——
 *    而 TM 的能力徽标是按 @grant 数组生成的（不做调用分析），不删授权就白搭。
 *
 *  超时用 AbortController **手搓**：`AbortSignal.timeout()` 需要 Safari 16+，
 *  而本脚本的 cssTarget 含 safari15，同一轮兼容口径下不用它。 */
const FETCH_TIMEOUT_MS = 20_000;

async function fetchLangColorTable(): Promise<string> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(SOURCE_URL, { cache: 'no-cache', signal: ctrl.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.text();
  } finally {
    window.clearTimeout(timer);
  }
}

/** 从数据源获取语言色并写缓存（单飞；成功后回退集重检命中，失败沿用旧数据 + 冷却） */
/**
 * 语言色请求开关（4.13.0）。他人 star 页的门是「零网络」，而卡片渲染里的 `getLangColor()`
 * 在**色表未命中**时会顺手发一次 linguist 请求 —— 这条**间接**路径同样违反零网络
 * （实测：工装里 `fetchLog` 恰有一条 languages.yml）。故在唯一出口 `fetchLangColors()` 上设闸。
 *
 * 关掉后的表现正是 V4 要的「只用已缓存色表；无缓存则灰点」：色表已在缓存 ⇒ 颜色照旧；
 * 未命中 ⇒ 灰点，不发请求。回滚时必须恢复（`exitOtherStarsView`）。
 */
let fetchEnabled = true;

/** 是否允许发起语言色请求（返回设置前的值，便于调用方原样恢复） */
export function setLangColorFetchEnabled(enabled: boolean): boolean {
  const prev = fetchEnabled;
  fetchEnabled = enabled;
  return prev;
}

function fetchLangColors(): Promise<void> {
  if (!fetchEnabled) return Promise.resolve(); // 他人 star 页：零网络（见 setLangColorFetchEnabled）
  if (inflight) return inflight;
  if (Date.now() < nextFetchAt) return Promise.resolve();
  nextFetchAt = Date.now() + FETCH_COOLDOWN_MS;
  inflight = fetchLangColorTable()
    .then((text) => {
      const parsed = parseLangColors(text);
      const size = Object.keys(parsed).length;
      if (size === 0) throw new Error('解析结果为空'); // fail-closed：不覆盖缓存
      colorMap = parsed;
      gmSet(STORAGE_KEYS.langColors, parsed);
      // （3）本周期未命中且新数据仍无色 → 记入回退集；（4）旧回退记录对照新数据重检，已命中即摘出
      for (const k of pendingMisses) {
        if (!(k in colorMap)) fallbackLangs.add(k);
      }
      for (const k of Array.from(fallbackLangs)) {
        if (k in colorMap) fallbackLangs.delete(k);
      }
      pendingMisses.clear();
      nextFetchAt = 0; // 成功后允许下一次「未命中再获取」
      console.log(`[github-star-manager] 语言色已更新：${size} 语言（当前回退 ${fallbackLangs.size}）`);
      recolorDots();
    })
    .catch((e) => {
      console.warn('[github-star-manager] 语言色获取失败，沿用现有数据', e);
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** 网格初始化（1）：同步载入缓存 + 直接从数据源获取一次（每页一次） */
export function initLangColors(): void {
  loadCache();
  if (inited) return;
  inited = true;
  void fetchLangColors();
}

/** 语言色解析（同步）：命中 → 色；未命中 → 先灰并触发一次获取（2），获取后仍未命中才记回退（3） */
export function getLangColor(lang: string | undefined): string {
  loadCache();
  const key = lang?.trim().toLowerCase();
  if (!key) return LANG_COLOR_FALLBACK;
  const hit = colorMap[key];
  if (hit) return hit;
  if (fallbackLangs.has(key)) return LANG_COLOR_FALLBACK; // 回退只记一次：等下次获取重检，不重复获取
  pendingMisses.add(key);
  void fetchLangColors(); // 未命中语言再获取一次（单飞/冷却内自动合并）
  return LANG_COLOR_FALLBACK;
}
