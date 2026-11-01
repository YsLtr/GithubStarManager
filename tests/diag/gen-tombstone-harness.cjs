// 生成「墓碑卡片」观感夹具：一页 8 张卡，其中 3 张是墓碑（4.22.0）。
//
// 为什么要夹具：真实页面上造墓碑需要「一个已被删除的 starred 仓库」+ 一次完整同步，
// 两者都不可控（删的是别人/自己的真仓库）。夹具把 `stars_repo_cache` 里的三条预置成
// `tombstone: { at, status }`，其余保持正常 —— 灰卡与正常卡在同屏并排，观感差异直接可比。
//
// 账号 id 用 997（没人用过）：三个夹具都是 file:// 同源，gm.ts:66-68 的 localStorage
// 镜像迁移会按账号命名空间搬数据，撞号会把别处的测试数据带进来。
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const fixture = fs.readFileSync(path.join(root, 'tests/smoke/fixture.html'), 'utf8');
const bundle = fs.readFileSync(path.join(root, 'dist/github-star-manager.user.js'), 'utf8');

const USER_ID = 997;
const REPOS = 8;
const langPool = ['TypeScript', 'Rust', 'Go', 'Python'];
const GONE = { 2: 404, 5: 410, 7: 451 };

const cacheEntries = [];
const tagEntries = [];
const noteEntries = [];
for (let i = 1; i <= REPOS; i += 1) {
  const tomb = GONE[i] ? `, tombstone: { at: 1761550000000, status: ${GONE[i]} }` : '';
  cacheEntries.push(
    `    '${i}': { name: 'owner${i}/repo${i}', desc: '第 ${i} 个仓库的描述文本，用来对比灰卡与非灰卡的可读性',` +
      ` lang: '${langPool[i % langPool.length]}', stars: ${1200 + i * 7}, forks: ${i * 3},` +
      ` starredAt: '2026-08-0${(i % 9) + 1}T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',` +
      ` private: false, fork: ${i % 3 === 0}${tomb} }`
  );
  tagEntries.push(`    '${i}': ['tag-${i}-a', 'tag-${i}-b']`);
  noteEntries.push(`    '${i}': 'note-${i}'`);
}

// 夹具必须补上 GitHub 页面自带的那条全局规则：`svg { fill: currentColor }`
// （Primer 的 primitives 里有它）。缺了它，octicon 的 path 会用 SVG 默认填充色 **黑**，
// 于是 `.stars-star-btn.starred { color: #e3b341 }` 与墓碑的 `color: var(--fgColor-muted)`
// 都看不出效果 —— 表现是「所有卡片的星星都是黑的」，看上去像墓碑样式串到了整页。
const head = `<style>
  svg { fill: currentColor; }
</style>
<script>
/* 本夹具用自己的账号 id（理由见生成器里的 USER_ID 注释） */
document.querySelectorAll('meta[name="octolytics-actor-id"], meta[name="octolytics-dimension-user_id"]').forEach(function (m) {
  m.setAttribute('content', '${USER_ID}');
});
/* ---- 预备数据：3 条墓碑（404 / 410 / 451），其余正常 ---- */
window.__gmStore = {
  stars_repo_cache: {
${cacheEntries.join(',\n')}
  },
  stars_full_sync_meta: { lastFullSyncAt: Date.now(), count: ${REPOS}, etags: ['W/"x"'] },
  'stars_tags_${USER_ID}': {
${tagEntries.join(',\n')}
  },
  'stars_notes_${USER_ID}': {
${noteEntries.join(',\n')}
  },
  'stars_pending_delete_${USER_ID}': { 9: { name: 'owner9/pending', unstarredAt: Date.now() - 3600000, _tags: ['待恢复'], _note: '宽限期备注' } },
  stars_hide_lists: true
};
/* 封闭夹具：清掉 file:// 源里的 localStorage 镜像，保证起点一致 */
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

/* 网络桩：本页为 file://，默认不发真请求 */
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

/* ---- matchMedia 仿真：夹具恒为桌面视口 ---- */
(function () {
  const real = window.matchMedia.bind(window);
  const listeners = [];
  window.__gsmForceNarrow = false;
  window.__gsmSetNarrow = function (narrow) {
    window.__gsmForceNarrow = narrow;
    for (const cb of listeners.slice()) cb({ matches: !narrow, media: '(min-width: 768px)' });
  };
  window.matchMedia = function (q) {
    if (!/min-width:\s*768px/.test(q)) return real(q);
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

const out = path.join(root, '.diag', 'tombstone-harness.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log('已生成 ' + out + '（' + Math.round(html.length / 1024) + ' KB，' + REPOS + ' 个仓库，其中 3 个墓碑）');
