// 生成 keepPage 守卫夹具（70 仓库 = 3 页）：tests/diag/assert-keep-page.js 的运行前置。
//
// 与 gen-viewport-harness.cjs 的差别：
//   1. 缓存里放 70 个仓库（= 3 页，NATIVE_PAGE_SIZE=30），才测得出跳页；
//   2. GM_registerMenuCommand 存下回调到 window.__gmMenus（用来从「另一个入口」触发同步）；
//   3. 暴露 window.__gsmSetFetch(fn) —— 断言里把 fetch 换成挂起/抛错的桩，不碰真网络。
// 其余（matchMedia 仿真、UTF-8 安全的替换方式）与既有工装一致。
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const fixture = fs.readFileSync(path.join(root, 'tests/smoke/fixture.html'), 'utf8');
const bundle = fs.readFileSync(path.join(root, 'dist/github-star-manager.user.js'), 'utf8');

const REPOS = 70;
const langPool = ['TypeScript', 'Rust', 'Go', 'Python', 'C++'];
const cacheEntries = [];
for (let i = 1; i <= REPOS; i += 1) {
  cacheEntries.push(
    `    '${i}': { name: 'owner${i}/repo${i}', desc: '第 ${i} 个仓库的描述', lang: '${langPool[i % langPool.length]}', stars: ${1000 + i}, forks: ${i},` +
      ` starredAt: '2026-08-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z', private: false, fork: false }`
  );
}

const head = `<script>
/* ---- 预备数据：hasApiData() 为真 → 走完整「桌面 → 转换」路径；70 个仓库 = 3 页 ---- */
window.__gmStore = {
  stars_repo_cache: {
${cacheEntries.join(',\n')}
  },
  stars_full_sync_meta: { lastFullSyncAt: Date.now(), count: ${REPOS}, etags: ['W/"x"'] },
  'stars_tags_999': {},
  'stars_notes_999': {},
  'stars_pending_delete_999': {},
  stars_hide_lists: true
};
/* 封闭夹具：gmGet 在「GM 值为默认值 + 存在 localStorage 镜像」时会把镜像迁回 GM（src/gm.ts:66-68），
   上次运行留在 file:// 源里的 probe-* 标签会因此渗进本次读取。开局清掉镜像，保证每次运行起点一致。 */
try {
  const lsPrefix = 'github-star-manager::';
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(lsPrefix)) localStorage.removeItem(key);
  }
} catch { /* 无 localStorage 时忽略 */ }
window.__gmLog = [];
window.__gmMenus = [];
window.GM_getValue = function (key, def) { window.__gmLog.push('getValue:' + key); return key in window.__gmStore ? window.__gmStore[key] : def; };
window.GM_setValue = function (key, value) { window.__gmLog.push('setValue:' + key); window.__gmStore[key] = value; };
window.GM_registerMenuCommand = function (name, fn) { window.__gmLog.push('menu:' + name); window.__gmMenus.push({ name: name, fn: fn }); return 'menu-' + name; };
window.GM_openInTab = function (url) { window.__gmLog.push('openInTab:' + url); };
window.GM_download = function (d) { window.__gmLog.push('download'); };
window.addEventListener('error', (e) => { (window.__errors = window.__errors || []).push('onerror: ' + e.message); });

/* 网络桩：断言里用 __gsmSetFetch 替换；默认走真 fetch（本页为 file://，不会有真请求） */
(function () {
  const realFetch = window.fetch.bind(window);
  window.__gsmFetchLog = [];
  window.__gsmFetchImpl = null;
  window.__gsmSetFetch = function (fn) { window.__gsmFetchImpl = fn; };
  window.fetch = function (input, init) {
    window.__gsmFetchLog.push(String(input && input.url ? input.url : input));
    if (window.__gsmFetchImpl) return window.__gsmFetchImpl(input, init);
    return realFetch(input, init);
  };
})();

/* ---- matchMedia 仿真：#narrow 载入即窄；__gsmSetNarrow 模拟运行中拖宽/拖窄 ---- */
(function () {
  const real = window.matchMedia.bind(window);
  const listeners = [];
  window.__gsmForceNarrow = location.hash === '#narrow';
  window.__gsmSetNarrow = function (narrow) {
    window.__gsmForceNarrow = narrow;
    for (const cb of listeners.slice()) cb({ matches: !narrow, media: '(min-width: 768px)' });
  };
  window.matchMedia = function (q) {
    if (!/min-width:\\s*768px/.test(q)) return real(q);
    return {
      media: q,
      get matches() { return !window.__gsmForceNarrow; },
      addEventListener: function (type, cb) { if (type === 'change') listeners.push(cb); },
      removeEventListener: function (type, cb) { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); },
      addListener: function (cb) { listeners.push(cb); },
      removeListener: function (cb) { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); }
    };
  };
})();
</script>`;

let html = fixture.replace('<!-- GM API stubs（在待测脚本之前注入） -->', '');
// 必须用函数形式替换：dist 里有 `$&` 字面量，字符串替换会被当反向引用展开
html = html.replace('<script src="../../dist/github-star-manager.user.js"></script>', () => head + '\n<script>\n' + bundle + '\n</script>');

const out = path.join(root, '.diag', 'jump-harness.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log('已生成 ' + out + '（' + Math.round(html.length / 1024) + ' KB，' + REPOS + ' 个仓库）');
