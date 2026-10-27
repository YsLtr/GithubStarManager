// 生成「编辑中点击别处不能被吞」守卫夹具：tests/diag/assert-edit-click.js 的运行前置。
//
// 场景：标签输入框 / 备注编辑框中已有未提交的文字时，用户直接点击**另一处可操作目标**
// （另一张卡的备注区、另一张卡的「+」、某个标签胶囊、上方筛选按钮）。期望是「这一下点击
// 既提交当前草稿、又落到它自己的目标上」；缺陷形态是点击被吞（只提交草稿，目标动作没发生）。
//
// 与 gen-defer-rerender-harness.cjs 的差别：只要 6 个仓库（单页），并且每张卡都预置
// 标签 + 备注，让「可点目标」在同一屏内可被真实鼠标命中。
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const fixture = fs.readFileSync(path.join(root, 'tests/smoke/fixture.html'), 'utf8');
const bundle = fs.readFileSync(path.join(root, 'dist/github-star-manager.user.js'), 'utf8');

const REPOS = 6;
/**
 * 独立的账号 id（**不是** 999）：三个夹具都是 `file://` 同源，`gm.ts:66-68` 的
 * localStorage 镜像迁移会在「GM 值是默认值 + 存在镜像」时把镜像搬回来 —— 用 999 就会把
 * 本夹具的 `tag-N-a` / `press-draft` 泄进 jump / defer 两个 70 仓库夹具的命名空间
 * （实测过：`firstCard=owner41/repo41 tags=["tag-6-a",…,"press-draft-3"]`）。
 */
const USER_ID = 998;
const langPool = ['TypeScript', 'Rust', 'Go', 'Python'];
const cacheEntries = [];
const tagEntries = [];
const noteEntries = [];
for (let i = 1; i <= REPOS; i += 1) {
  cacheEntries.push(
    `    '${i}': { name: 'owner${i}/repo${i}', desc: '第 ${i} 个仓库的描述', lang: '${langPool[i % langPool.length]}', stars: ${1000 + i}, forks: ${i},` +
      ` starredAt: '2026-08-0${i}T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z', private: false, fork: false }`
  );
  tagEntries.push(`    '${i}': ['tag-${i}-a', 'tag-${i}-b']`);
  noteEntries.push(`    '${i}': 'note-${i}'`);
}

const head = `<script>
/* 本夹具用自己的账号 id（理由见生成器里的 USER_ID 注释） */
document.querySelectorAll('meta[name="octolytics-actor-id"], meta[name="octolytics-dimension-user_id"]').forEach(function (m) {
  m.setAttribute('content', '${USER_ID}');
});
/* ---- 预备数据：hasApiData() 为真 → 走完整「桌面 → 转换」路径；单页 6 张卡 ---- */
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
  'stars_pending_delete_${USER_ID}': {},
  stars_hide_lists: true
};
/* 封闭夹具：清掉 file:// 源里的 localStorage 镜像，保证每次运行起点一致（理由见 gen-defer-rerender-harness.cjs）。 */
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

/* ---- matchMedia 仿真：夹具恒为桌面视口（真机口径见 AGENTS「真机调试要点」） ---- */
(function () {
  const real = window.matchMedia.bind(window);
  const listeners = [];
  window.__gsmForceNarrow = false;
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

const out = path.join(root, '.diag', 'edit-click-harness.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log('已生成 ' + out + '（' + Math.round(html.length / 1024) + ' KB，' + REPOS + ' 个仓库）');
