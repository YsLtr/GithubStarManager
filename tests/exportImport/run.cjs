// 合并语义的真机前置验证：用最小 GM stub 跑 storage/exportImport 的纯逻辑，
// 覆盖 ADR 0001 的每条合并规则与拒绝路径。跑法：node .tmp-test/run.js
const path = require('path');

/* ---- 最小 GM stub（内存 store，模拟 gm.ts 的两条腿都走 GM 分支） ---- */
const store = new Map();
global.GM_getValue = (k, d) => (store.has(k) ? store.get(k) : d);
global.GM_setValue = (k, v) => void store.set(k, v);
global.GM_deleteValue = (k) => void store.delete(k);
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

/* ---- 用户 ID：getStorageUserId() 读页面 meta 里的**登录者** octolytics-actor-id ----
 * 4.12.0 起隔离键改用登录者 id（此前是页面主人 octolytics-dimension-user_id）：
 * 桩必须跟着改，否则这里测的就是「取不到身份」的降级路径而不是正常路径。 */
let USER_ID = '111';
global.document = {
  querySelector: (sel) =>
    sel.includes('octolytics-actor-id') ? { content: USER_ID } : null,
};

const { buildExportPackage, validateExportPackage, applyImportPackage } = require('./.build/storage/exportImport.cjs');
const { saveTags, loadAllTags } = require('./.build/storage/tags.cjs');
const { saveNote, loadAllNotes } = require('./.build/storage/notes.cjs');
const { saveRepoData, loadRepoCache } = require('./.build/storage/repoCache.cjs');

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(name, a === e, `期望 ${e}，实际 ${a}`);
}
function reset() { store.clear(); }

/* ================= 1. 导出内容与清洗 ================= */
console.log('\n[1] 导出：内容范围与清洗');
reset();
saveTags('r1', ['a', 'b']);
saveTags('r2', ['c']);
saveNote('r1', '  保留前导空格');
saveNote('r2', '   ');            // 空白备注：写入时即被 saveNote 判空删除
store.set('stars_notes_111', { r1: '  保留前导空格', r3: '  ' }); // 直接塞入存量空白备注
saveRepoData('r1', { name: 'one', stars: 5 });
saveRepoData('r2', { name: 'two' });
saveRepoData('r9', { name: 'unrelated' });   // 无标签无备注 → 不该进包
store.set('github_pat', 'github_pat_SECRET');
store.set('stars_full_sync_meta', { etags: ['x'], count: 3 });

const pkg = buildExportPackage();
ok('导出包非空', !!pkg);
eq('kind 为协议常量', pkg.kind, 'github-star-manager-export');
eq('schemaVersion', pkg.schemaVersion, 1);
eq('user.id 取自当前用户', pkg.user.id, '111');
ok('exportedAt 是 ISO UTC', /^\d{4}-\d{2}-\d{2}T.*Z$/.test(pkg.exportedAt));
eq('repoCache 只含有标签/备注的仓库（r1,r2）', Object.keys(pkg.data.repoCache).sort(), ['r1', 'r2']);
eq('空白备注不进包（r3 被剔除）', Object.keys(pkg.data.notes).sort(), ['r1']);
eq('非空备注文本未被 trim', pkg.data.notes.r1, '  保留前导空格');
ok('不含 github_pat', !JSON.stringify(pkg).includes('SECRET'));
ok('不含同步元数据', !JSON.stringify(pkg).includes('etags'));
ok('不含宽限期备份键', !JSON.stringify(pkg).includes('pending_delete'));

/* ================= 2. 校验：拒绝路径 ================= */
console.log('\n[2] 校验：kind / 版本 / 归属 / 结构');
const good = buildExportPackage();
ok('合法包通过', validateExportPackage(JSON.parse(JSON.stringify(good))).ok);
ok('非对象被拒', !validateExportPackage('nope').ok);
ok('kind 不符被拒', !validateExportPackage(Object.assign({}, good, { kind: 'other' })).ok);
ok('schemaVersion 不符被拒', !validateExportPackage(Object.assign({}, good, { schemaVersion: 2 })).ok);
ok('缺 user 被拒', !validateExportPackage(Object.assign({}, good, { user: {} })).ok);
ok('缺 exportedAt 被拒', !validateExportPackage(Object.assign({}, good, { exportedAt: 1 })).ok);
ok('缺 data 被拒', !validateExportPackage(Object.assign({}, good, { data: null })).ok);
ok('tags 值非数组被拒', !validateExportPackage(Object.assign({}, good, { data: { tags: { r1: 'x' }, notes: {}, repoCache: {} } })).ok);
ok('notes 值非字符串被拒', !validateExportPackage(Object.assign({}, good, { data: { tags: {}, notes: { r1: 5 }, repoCache: {} } })).ok);
ok('repoCache 缺 name 被拒', !validateExportPackage(Object.assign({}, good, { data: { tags: {}, notes: {}, repoCache: { r1: { stars: 1 } } } })).ok);

USER_ID = '222';
const cross = validateExportPackage(JSON.parse(JSON.stringify(good)));
ok('跨账号被拒', !cross.ok);
ok('跨账号拒绝原因含双方 id', !cross.ok && cross.reason.includes('111') && cross.reason.includes('222'), cross.ok ? '' : cross.reason);
USER_ID = '';
ok('取不到 user.id 时拒绝', !validateExportPackage(JSON.parse(JSON.stringify(good))).ok);
USER_ID = '111';

/* ================= 3. 合并语义 ================= */
console.log('\n[3] 合并：标签并集 / 备注优先 / 元数据只补空缺');
reset();
// 本地现状
saveTags('r1', ['local1']);
saveNote('r1', '本地备注');
saveNote('r2', '本地保留');   // 包里是空备注 → 不该被删
saveRepoData('r1', { name: 'local-name', stars: 1 });
// 包内容
const incoming = {
  kind: 'github-star-manager-export',
  schemaVersion: 1,
  exportedAt: new Date().toISOString(),
  user: { id: '111' },
  data: {
    tags: { r1: ['local1', 'incoming2'], r3: ['new'] },
    notes: { r1: '文件备注', r2: '   ', r3: '新备注' },
    repoCache: { r1: { name: 'file-name', stars: 99 }, r3: { name: 'three' } },
  },
};
const rep = applyImportPackage(incoming);
eq('标签并集且本地在前', loadAllTags().r1, ['local1', 'incoming2']);
eq('新仓库标签写入', loadAllTags().r3, ['new']);
eq('备注被文件覆盖', loadAllNotes().r1, '文件备注');
eq('空备注不覆盖本地非空备注', loadAllNotes().r2, '本地保留');
eq('新备注写入', loadAllNotes().r3, '新备注');
eq('已有仓库元数据不被覆盖', loadRepoCache().r1.name, 'local-name');
eq('缺失仓库元数据补入', loadRepoCache().r3.name, 'three');
eq('报告 tagsAdded', rep.tagsAdded, 2);
eq('报告 notesApplied', rep.notesApplied, 2);
eq('报告 notesOverwritten', rep.notesOverwritten, 1);
eq('报告 notesSkippedEmpty', rep.notesSkippedEmpty, 1);
eq('报告 repoCacheAdded', rep.repoCacheAdded, 1);
eq('报告 tagRepos', rep.tagRepos, 2);

/* ================= 4. 幂等：重复导入不产生新变化 ================= */
console.log('\n[4] 幂等：同包再导一次');
const rep2 = applyImportPackage(incoming);
eq('第二轮 tagsAdded = 0', rep2.tagsAdded, 0);
eq('第二轮 notesApplied = 0', rep2.notesApplied, 0);
eq('第二轮 repoCacheAdded = 0', rep2.repoCacheAdded, 0);
eq('标签未被重排', loadAllTags().r1, ['local1', 'incoming2']);

/* ================= 5. saveNote 判空收紧 ================= */
console.log('\n[5] saveNote：trim 后为空 = 删除');
reset();
saveNote('r1', '内容');
saveNote('r1', '   \n  ');
eq('只输空格/换行即清空', loadAllNotes().r1, undefined);
saveNote('r2', ' 保留 ');
eq('非空文本原样保留（不 trim）', loadAllNotes().r2, ' 保留 ');

/* ================= 6. 用户隔离 ================= */
console.log('\n[6] 存储按用户隔离');
reset();
saveTags('r1', ['u111']);
USER_ID = '222';
eq('切到另一用户读不到旧标签', loadAllTags().r1, undefined);
saveTags('r2', ['u222']);
USER_ID = '111';
eq('切回原用户数据仍在', loadAllTags().r1, ['u111']);

/* ================= 7. 导出包的 repoCache 归属（D9 契约） ================= */
// 4.16.0 删除「读取即清洗」后本节的 6 条死字段断言已随之删除（loadRepoCache 现在是纯读，
// 不再剔 updated/langColor/ts 与脏 lang，也不再写回持久化）。这里只保留与迁移无关的 D9 契约。
console.log('\n[7] 导出包只含有标签或有非空备注的仓库');
reset();
saveTags('r1', ['a']);
saveNote('r1', 'n');
saveRepoData('r1', { name: 'one' });
saveRepoData('r2', { name: 'two' }); // 无标签无备注，不该进包
const pkg7 = buildExportPackage();
ok('导出包带上有标签有备注的 r1', !!pkg7.data.repoCache.r1);
ok('导出包不带无标签无备注的 r2', !pkg7.data.repoCache.r2);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
