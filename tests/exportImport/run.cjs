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
/** 宽限期备份键按归属账号分区（4.18.0，风险 21）。桩里直接塞「存量数据」时必须跟着分区 ——
 *  否则塞进去的是裸键，而读的是分区键，测试就变成在验证「读空」而不是被测逻辑。 */
const pendingKey = () => `stars_pending_delete_${USER_ID}`;
global.document = {
  querySelector: (sel) =>
    sel.includes('octolytics-actor-id') ? { content: USER_ID } : null,
};

const { buildExportPackage, validateExportPackage, applyImportPackage } = require('./.build/storage/exportImport.cjs');
const { saveTags, loadAllTags } = require('./.build/storage/tags.cjs');
const { saveNote, loadAllNotes } = require('./.build/storage/notes.cjs');
const { saveRepoData, loadRepoCache, hasApiData } = require('./.build/storage/repoCache.cjs');
const { loadPendingDelete, addPendingFromImport, markRepoStarred, listRestorable } = require('./.build/storage/pendingDelete.cjs');

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
saveRepoData('r1', { name: 'owner/one', stars: 5 });
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
ok('导出包不再带 repoCache（4.17.0）', pkg.data.repoCache === undefined);
eq('data 段只有 tags / notes / repoNames（无 repoCache）', Object.keys(pkg.data).sort(), ['notes', 'repoNames', 'tags']);
eq('repoNames 带上缓存里已知的名字', pkg.data.repoNames, { r1: 'owner/one' });
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
// repoNames（4.17.0 新增，**可选**）：缺省 = 旧包／导出方也不知道名字 ⇒ 放行；存在则值必须是字符串
ok('repoNames 值非字符串被拒', !validateExportPackage(Object.assign({}, good, { data: { tags: {}, notes: {}, repoNames: { r1: 123 } } })).ok);
ok('repoNames 不是对象被拒', !validateExportPackage(Object.assign({}, good, { data: { tags: {}, notes: {}, repoNames: [] } })).ok);
ok('repoNames 合法时放行', validateExportPackage(Object.assign({}, good, { data: { tags: {}, notes: {}, repoNames: { r1: 'o/r' } } })).ok);
ok('缺 repoNames 的包仍放行（旧包兼容）', validateExportPackage(Object.assign({}, good, { data: { tags: {}, notes: {} } })).ok);
// 4.16.0：lang 必须是字符串或缺省。渲染路径会对它调 .trim()（langColors.getLangColor），
// 非字符串会抛 TypeError 并打断整页转换 ⇒ 停在没有卡片的空网格（不是少显示一块）。
// 这是删除读期清洗（isPlausibleLangName）后暴露的信任边界缺口，故在这里补守卫。
ok('repoCache 的 lang 非字符串被拒（对象）', !validateExportPackage(Object.assign({}, good, { data: { tags: {}, notes: {}, repoCache: { r1: { name: 'o/r', lang: { a: 1 } } } } })).ok);
ok('repoCache 的 lang 非字符串被拒（数字）', !validateExportPackage(Object.assign({}, good, { data: { tags: {}, notes: {}, repoCache: { r1: { name: 'o/r', lang: 123 } } } })).ok);
ok('repoCache 的 lang 为字符串放行', validateExportPackage(Object.assign({}, good, { data: { tags: {}, notes: {}, repoCache: { r1: { name: 'o/r', lang: 'F*' } } } })).ok);
ok('repoCache 的 lang 缺省放行', validateExportPackage(Object.assign({}, good, { data: { tags: {}, notes: {}, repoCache: { r1: { name: 'o/r' } } } })).ok);

USER_ID = '222';
const cross = validateExportPackage(JSON.parse(JSON.stringify(good)));
ok('跨账号被拒', !cross.ok);
ok('跨账号拒绝原因含双方 id', !cross.ok && cross.reason.includes('111') && cross.reason.includes('222'), cross.ok ? '' : cross.reason);
USER_ID = '';
ok('取不到 user.id 时拒绝', !validateExportPackage(JSON.parse(JSON.stringify(good))).ok);
USER_ID = '111';

/* ================= 3. 逐仓库分派（4.17.0） ================= */
console.log('\n[3] 分派：本地确认已 star ⇒ 活区；确认未 star ⇒ 宽限期');
reset();
// 让整表缓存成立（hasApiData() = 有 lastFullSyncAt 且 count > 0）；否则所有仓库都会走「无法确认」
store.set('stars_full_sync_meta', { lastFullSyncAt: Date.now(), count: 2, etags: [] });
// 本地现状：r1 / r2 在整表缓存里（= 确认已 star），r3 不在（= 确认未 star）
saveTags('r1', ['local1', 'localOnly']); // localOnly 只在本地 ⇒ 并集会得到 3 个标签、覆盖只有 2 个（否则这条断言是空转的）
saveNote('r1', '本地备注');
saveNote('r2', '本地保留');   // 包里是空备注 → 不该被删
saveRepoData('r1', { name: 'local-name', stars: 1 });
saveRepoData('r2', { name: 'two' });
// 包内容（含 1.x 才有的 repoCache —— 它必须被忽略）
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
eq('已 star：包内标签**覆盖**本地（用户 2026-10-05 裁定）', loadAllTags().r1, ['local1', 'incoming2']);
eq('已 star：备注被文件覆盖', loadAllNotes().r1, '文件备注');
eq('已 star：空备注不覆盖本地非空备注', loadAllNotes().r2, '本地保留');
eq('未 star：不写活区标签', loadAllTags().r3, undefined);
eq('未 star：不写活区备注', loadAllNotes().r3, undefined);
eq('未 star：进宽限期并带标签', (loadPendingDelete().r3 || {})._tags, ['new']);
eq('未 star：进宽限期并带备注', (loadPendingDelete().r3 || {})._note, '新备注');
ok('已 star：本地元数据不被包覆盖', loadRepoCache().r1.name === 'local-name');
ok('包里的 repoCache 被忽略（未补入 r3）', !loadRepoCache().r3);
eq('报告 tagsWritten', rep.tagsWritten, 1);
eq('报告 tagsRemoved = 1（localOnly 被覆盖掉）', rep.tagsRemoved, 1);
eq('报告 notesApplied', rep.notesApplied, 1);
eq('报告 notesOverwritten', rep.notesOverwritten, 1);
eq('报告 notesSkippedEmpty', rep.notesSkippedEmpty, 1);
eq('报告 tagRepos', rep.tagRepos, 1);
eq('报告 pendingAdded', rep.pendingAdded, 1);
eq('报告 cacheAvailable', rep.cacheAvailable, true);

// 覆盖语义的两个边界（同为 4.17.0 的纪律，见 AGENTS.md D9 / 风险 23 的处置）
// ① 包内**没给**该仓库的标签（它只出现在 notes 里）⇒ 保留本地，不能被「覆盖」清空 ——
//    否则「导入一份没说它标签的文件」会导致它的标签消失。
saveRepoData('r4', { name: 'owner/r4' }); // 必须先在整表缓存里 ⇒ 才会走活区分支
saveTags('r4', ['r4-本地标签']);
applyImportPackage({
  kind: 'github-star-manager-export', schemaVersion: 1, exportedAt: new Date().toISOString(),
  user: { id: '111' }, data: { tags: {}, notes: { r4: '只给备注' } },
});
eq('包内没给标签 ⇒ 保留本地标签', loadAllTags().r4, ['r4-本地标签']);

// ② 包内**给了**非空标签 ⇒ 覆盖，且如实报出被替换掉的本地标签数（破坏性部分，提示里单独说）
saveRepoData('r5', { name: 'owner/r5' }); // 同上：活区才对「覆盖」负责
saveTags('r5', ['旧A', '旧B']);
const repOverwrite = applyImportPackage({
  kind: 'github-star-manager-export', schemaVersion: 1, exportedAt: new Date().toISOString(),
  user: { id: '111' }, data: { tags: { r5: ['新B', '新C'] }, notes: {} },
});
eq('包内非空 ⇒ 整体覆盖（不是并集）', loadAllTags().r5, ['新B', '新C']);
eq('…报告 tagsWritten', repOverwrite.tagsWritten, 1);
eq('…报告 tagsRemoved = 2（旧A / 旧B 被替换掉）', repOverwrite.tagsRemoved, 2);

// ③ 内容完全相同 ⇒ 不写盘（导入因此天然幂等）
const repSame = applyImportPackage({
  kind: 'github-star-manager-export', schemaVersion: 1, exportedAt: new Date().toISOString(),
  user: { id: '111' }, data: { tags: { r5: ['新B', '新C'] }, notes: {} },
});
eq('内容相同 ⇒ tagsWritten = 0', repSame.tagsWritten, 0);
eq('内容相同 ⇒ tagsRemoved = 0', repSame.tagsRemoved, 0);

// ④ 归一化只做一次、两条去向共用（活区与宽限期曾不对称：只有活区去重）
saveTags('r6', ['dup', 'dup']);           // 本地含重复项
saveRepoData('r6', { name: 'owner/r6' }); // 在缓存里 ⇒ 走活区
const repDup = applyImportPackage({
  kind: 'github-star-manager-export', schemaVersion: 1, exportedAt: new Date().toISOString(),
  user: { id: '111' }, data: { tags: { r6: ['x', 'x', 'y'] }, notes: {} },
});
eq('活区：包内重复项先去重再落盘', loadAllTags().r6, ['x', 'y']);
eq('…tagsRemoved 按条目计（本地 2 个 dup 被替换掉）', repDup.tagsRemoved, 2);

// 未 star 的仓库同样先归一化再进宽限期（曾把 ['x','x','y'] 原样写入备份 ⇒ 恢复时带出重复 pill）
applyImportPackage({
  kind: 'github-star-manager-export', schemaVersion: 1, exportedAt: new Date().toISOString(),
  user: { id: '111' }, data: { tags: { r7: ['x', 'x', 'y'] }, notes: {} },
});
eq('宽限期：包内重复项同样先去重', (loadPendingDelete().r7 || {})._tags, ['x', 'y']);

// 空白项剔除：`['']` 手改得出，不剔就会被判成「非空」而覆盖掉本地真标签
saveRepoData('r8', { name: 'owner/r8' });
saveTags('r8', ['real']);
const repBlank = applyImportPackage({
  kind: 'github-star-manager-export', schemaVersion: 1, exportedAt: new Date().toISOString(),
  user: { id: '111' }, data: { tags: { r8: [''] }, notes: {} },
});
eq('包内只有空白项 ⇒ 视为空，保留本地标签', loadAllTags().r8, ['real']);
eq('…且不算一次覆盖写入', repBlank.tagsWritten, 0);

/* ================= 4. 幂等：重复导入不产生新变化 ================= */
console.log('\n[4] 幂等：同包再导一次');
const pendingBefore = Object.keys(loadPendingDelete()).length;
const rep2 = applyImportPackage(incoming);
eq('第二轮 tagsWritten = 0（内容相同不写盘）', rep2.tagsWritten, 0);
eq('第二轮 notesApplied = 0', rep2.notesApplied, 0);
ok('第二轮仍不写缓存', !loadRepoCache().r3);
eq('宽限期条目数未变（未重复新建）', Object.keys(loadPendingDelete()).length, pendingBefore);
eq('宽限期标签未被写成空', (loadPendingDelete().r3 || {})._tags, ['new']);
eq('标签与包内一致（未被重排）', loadAllTags().r1, ['local1', 'incoming2']);

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

// 4.18.0（风险 21 的修复点）：宽限期备份同样按归属账号分区。
// 关键形状 = **同一 repoId 在两个账号下各有一条备份**：旧实现是单份全局键，后写的会整个顶掉前一条。
reset();
USER_ID = '111';
addPendingFromImport('rX', ['tag-A'], 'note-A', 'o/rX');
USER_ID = '222';
addPendingFromImport('rX', ['tag-B'], 'note-B', 'o/rX');
eq('B 账号读到自己的备份（未被 A 顶掉）', loadPendingDelete().rX && loadPendingDelete().rX._tags, ['tag-B']);
USER_ID = '111';
eq('A 账号读到的仍是自己的备份（未被 B 覆盖）', loadPendingDelete().rX && loadPendingDelete().rX._tags, ['tag-A']);
USER_ID = '';
eq('取不到归属 id ⇒ 备份读空（不回落无隔离旧键）', Object.keys(loadPendingDelete()), []);
USER_ID = '111';
/* ================= 7. 导出包：只含标签/备注（不再带 repoCache） ================= */
console.log('\n[7] 导出包不再带仓库元数据（4.17.0）');
reset();
saveTags('r1', ['a']);
saveNote('r1', 'n');
saveRepoData('r1', { name: 'owner/one' }); // 缓存里有它 ⇒ 只随包带走**名字**，不带其它元数据
const pkg7 = buildExportPackage();
ok('导出包不含 repoCache 字段', pkg7.data.repoCache === undefined);
eq('data 段只有 tags / notes / repoNames', Object.keys(pkg7.data).sort(), ['notes', 'repoNames', 'tags']);
eq('只带走名字，其它元数据仍不进包', pkg7.data.repoNames, { r1: 'owner/one' });

/* ================= 8. 「无法确认」⇒ 一律进宽限期，绝不写活区 ================= */
console.log('\n[8] 无整表缓存（无法确认 star 状态）⇒ 全部进宽限期');
reset(); // 无 stars_full_sync_meta ⇒ hasApiData() 为假
const rep8 = applyImportPackage({
  kind: 'github-star-manager-export',
  schemaVersion: 1,
  exportedAt: new Date().toISOString(),
  user: { id: '111' },
  data: { tags: { r5: ['a'] }, notes: { r5: 'n' } },
});
eq('未写活区标签', loadAllTags().r5, undefined);
eq('未写活区备注', loadAllNotes().r5, undefined);
eq('进宽限期', loadPendingDelete().r5._tags, ['a']);
eq('报告 cacheAvailable = false', rep8.cacheAvailable, false);
eq('报告 pendingAdded', rep8.pendingAdded, 1);

/* ================= 9. 旧包（1.x，带 repoCache）仍可导入，但不写缓存 ================= */
console.log('\n[9] 旧包兼容 + 风险 22 的触发前提已消除');
reset();
store.set('stars_full_sync_meta', { lastFullSyncAt: Date.now(), count: 1 }); // 有缓存，但里面没有 r9
const oldPkg = {
  kind: 'github-star-manager-export',
  schemaVersion: 1,
  exportedAt: new Date().toISOString(),
  user: { id: '111' },
  data: { tags: { r9: ['旧包标签'] }, notes: {}, repoCache: { r9: { name: 'nine' } } },
};
ok('旧包（含 repoCache）仍通过校验', validateExportPackage(JSON.parse(JSON.stringify(oldPkg))).ok);
const rep9 = applyImportPackage(oldPkg);
ok('旧包不再往整表缓存写条目（风险 22 的前提不复存在）', !loadRepoCache().r9);
eq('…该仓库进了宽限期', loadPendingDelete().r9._tags, ['旧包标签']);
ok('…宽限期条目没有元数据（name 回退 repoId）', loadPendingDelete().r9.name === '');

/* ================= 10. 宽限期合并纪律 ================= */
console.log('\n[10] 宽限期合并：空不覆盖非空 / 不续命 / 超期按新建');
reset();
const t0 = Date.now() - 3600_000; // 1 小时前进入宽限期
store.set(pendingKey(), { r1: { name: 'one', unstarredAt: t0, _tags: ['原有标签'], _note: '原有备注' } });
addPendingFromImport('r1', [], ''); // 包内该仓库无标签无备注
const e1 = loadPendingDelete().r1;
eq('空标签不覆盖非空备份', e1._tags, ['原有标签']);
eq('空备注不覆盖非空备份', e1._note, '原有备注');
eq('不续命：unstarredAt 未被重置', e1.unstarredAt, t0);
eq('已有元数据被保留', e1.name, 'one');
addPendingFromImport('r1', ['新标签'], '新备注');
const e2 = loadPendingDelete().r1;
eq('非空标签覆盖备份', e2._tags, ['新标签']);
eq('非空备注覆盖备份', e2._note, '新备注');
eq('覆盖时仍不重置 unstarredAt', e2.unstarredAt, t0);
addPendingFromImport('r1', ['新标签'], '   ');
eq('只有空白的备注按「空」处理（trim 判空）', loadPendingDelete().r1._note, '新备注');
const stale = Date.now() - 25 * 3600_000; // 已超期
store.set(pendingKey(), { r2: { name: 'two', unstarredAt: stale, _tags: ['过期标签'] } });
addPendingFromImport('r2', ['新标签'], '');
const e3 = loadPendingDelete().r2;
ok('超期条目按新条目处理（unstarredAt 刷新；否则合并出来的条目出生即超期、数据谁都读不到）', e3.unstarredAt > stale);
eq('超期条目的旧标签不参与合并', e3._tags, ['新标签']);
eq('两处皆空且此前无条目 ⇒ 什么都不做', addPendingFromImport('r3', [], ''), false);
ok('…且未写入存储', !loadPendingDelete().r3);

/* ================= 11. 同步发现「远端已 star」⇒ 移出宽限期 ================= */
// `fullSync` 的分支 B（「远端有、本地无」）就是调 markRepoStarred() + 远端元数据回填；
// fullSync 依赖大量 DOM/网络模块、不在本夹具的依赖闭包里，所以这里直接钉住它依赖的行为契约。
console.log('\n[11] 移出宽限期（fullSync 分支 B 的落点：markRepoStarred）');
reset();
store.set(pendingKey(), { r7: { unstarredAt: Date.now(), _tags: ['t7'], _note: 'n7' } });
markRepoStarred('r7');
eq('标签移回活区', loadAllTags().r7, ['t7']);
eq('备注移回活区', loadAllNotes().r7, 'n7');
ok('条目写回整表缓存', !!loadRepoCache().r7);
ok('宽限期条目被删除', !loadPendingDelete().r7);


/* ===== 12. 风险 22 回归锁：缓存里有、meta 缺失（背离态）仍按「成员关系」分派 ===== */
// 4.17.0 发布前独立审查抓到的反例：分派条件若写成 `hasApiData() && cache[repoId]`，那么
// 「缓存里已有该仓库、stars_full_sync_meta 却缺失」时它会被误判成「未确认」而进宽限期 ⇒
// 「缓存条目 + 宽限期条目」并存态复活，风险 22 原样回归。这个背离态**真实可达**：
// `markRepoStarred()`（恢复窗口与「他人页 re-star」的落点）只写整表缓存、**不写 meta**。
console.log('\n[12] 缓存与 meta 背离时仍按成员关系分派（风险 22 回归锁）');
reset();
addPendingFromImport('r1', ['导入标签'], ''); // 无缓存 ⇒ 先落宽限期
markRepoStarred('r1'); // = 恢复路径：写进整表缓存，且**不**写 stars_full_sync_meta
eq('前置：缓存里有 r1 而 meta 仍缺失', [!!loadRepoCache().r1, hasApiData()], [true, false]);
const rep12 = applyImportPackage({
  kind: 'github-star-manager-export',
  schemaVersion: 1,
  exportedAt: new Date().toISOString(),
  user: { id: '111' },
  data: { tags: { r1: ['追加标签'] }, notes: { r1: '追加备注' } },
});
eq('已在缓存里 ⇒ 写活区（覆盖，不走宽限期）', loadAllTags().r1, ['追加标签']);
eq('备注写进活区', loadAllNotes().r1, '追加备注');
eq('不产生并存态：宽限期里没有 r1', loadPendingDelete().r1, undefined);
eq('报告 pendingAdded = 0', rep12.pendingAdded, 0);
eq('报告 cacheAvailable 仍为 false（它只是展示用标志，不参与分派）', rep12.cacheAvailable, false);

/* ===== 13. 最小仓库名随包带走 ⇒ 导入的宽限期条目可手动恢复（4.17.0） ===== */
console.log('\n[13] repoNames：宽限期条目带回 owner/repo');
reset();
saveTags('r1', ['t']);
saveNote('r1', 'n');
saveRepoData('r1', { name: 'owner/one' }); // 名字已知 ⇒ 随包带走
saveTags('r2', ['t2']); // 有标签但缓存里查不到名字 ⇒ 不写 repoNames（不编造）
const pkg13 = buildExportPackage();
eq('已知名字随包带走', pkg13.data.repoNames, { r1: 'owner/one' });
ok('查不到名字的仓库不进 repoNames', !('r2' in (pkg13.data.repoNames || {})));
ok('只带名字，不带其它元数据（stars 未进包）', !JSON.stringify(pkg13).includes('"stars"'));

reset(); // 导入方：无整表缓存 ⇒ 全部走宽限期
applyImportPackage(pkg13);
eq('宽限期条目带回 owner/repo', loadPendingDelete().r1.name, 'owner/one');
eq('恢复窗口显示真名（不再回退成数字 id）', (listRestorable().find((e) => e.repoId === 'r1') || {}).name, 'owner/one');
eq('无名仓库仍回退 repoId（等同步补齐）', (listRestorable().find((e) => e.repoId === 'r2') || {}).name, 'r2');
ok('名字**不写整表缓存**（风险 22 的前提不复存在）', !loadRepoCache().r1);

/* ===== 14. 名字的合并纪律：空不覆盖非空 ===== */
console.log('\n[14] repoNames 合并：已有名字优先，空名字不抹掉它');
reset();
const mkPkg = (repoNames) => ({
  kind: 'github-star-manager-export',
  schemaVersion: 1,
  exportedAt: new Date().toISOString(),
  user: { id: '111' },
  data: Object.assign({ tags: {}, notes: {} }, repoNames ? { repoNames } : {}),
});
store.set(pendingKey(), { r1: { name: 'owner/keep', unstarredAt: Date.now(), _tags: ['原有'] } });
const pkg14a = mkPkg({ r1: 'owner/other' });
pkg14a.data.tags = { r1: ['来自包'] };
applyImportPackage(pkg14a);
eq('已有名字优先（不被包里的名字改写）', loadPendingDelete().r1.name, 'owner/keep');
eq('非空标签照常覆盖备份（纪律 1 的另一半，见 [10]）', loadPendingDelete().r1._tags, ['来自包']);
reset();
store.set(pendingKey(), { r2: { name: 'owner/keep', unstarredAt: Date.now(), _tags: ['原有'] } });
const pkg14b = mkPkg(null); // 包里没有 repoNames
pkg14b.data.tags = { r2: ['来自包'] };
applyImportPackage(pkg14b);
eq('包里没名字时不抹掉已有名字', loadPendingDelete().r2.name, 'owner/keep');
reset();
store.set(pendingKey(), { r3: { name: '', unstarredAt: Date.now(), _tags: ['原有'] } });
const pkg14c = mkPkg({ r3: 'owner/three' });
pkg14c.data.tags = { r3: ['来自包'] };
applyImportPackage(pkg14c);
eq('已有条目名字为空 ⇒ 用包里的名字补上', loadPendingDelete().r3.name, 'owner/three');
reset();
// 信任边界：手改过的包能把任意串塞进 `repoNames`，而这个名字会被恢复窗口当仓库名显示
const pkg14d = mkPkg({ r4: 'noslash' });
pkg14d.data.tags = { r4: ['t'] };
applyImportPackage(pkg14d);
eq('没有 `/` 的名字按「没有名字」处理（不原样塞进条目）', loadPendingDelete().r4.name, '');
eq('…条目本身照建，只是暂时不可手动恢复', loadPendingDelete().r4._tags, ['t']);
eq('…恢复窗口回退成 repoId（不会显示那串垃圾）', (listRestorable().find((e) => e.repoId === 'r4') || {}).name, 'r4');
/* ================= 15. 归属账号 = token 账号（4.18.0，风险 21 的主修复） ================= */
console.log('\n[15] 归属 = token 账号（指纹缓存命中），取不到才回退登录者');
const { fingerprint } = require('./.build/storage/accountIdentity.cjs');
/** 造一份「已确认身份的 token」：token 写入 + 身份按指纹落缓存（正是 setTokenVerified 的产物） */
function withVerifiedToken(tok, id, login) {
  store.set('github_pat', tok);
  store.set('stars_account_identity', { [fingerprint(tok)]: { id, login } });
}

reset();
saveTags('r1', []); // 让标签表存在，导出包不为空
withVerifiedToken('github_pat_AAA', '999', 'tokuser');
USER_ID = '111';
eq('有 token 身份 ⇒ 导出包归属 = token 账号（不是登录者）', buildExportPackage().user.id, '999');
// 这条要验的是**键名本身**（不是「读到的等于写进去的」那种同义反复）：
// token 账号命名空间里真的有数据，而登录者命名空间里没有。
saveTags('r1', ['归属验证']);
ok('…写进了 token 账号的键 stars_tags_999', !!store.get('stars_tags_999') && store.get('stars_tags_999').r1 !== undefined);
// 登录者的键可能因更早的写入而存在（上面那次空 `saveTags` 留下了空表），所以看的是**有没有这条仓库**。
ok('…登录者的键 stars_tags_111 里没有这条仓库', !(store.get('stars_tags_111') || {}).r1);

// 组合 B（有 token、无登录会话）：旧实现下身份缓存永不填充 ⇒ 这条以前读不到 token 账号的标签
USER_ID = '';
eq('无登录会话但有 token 身份 ⇒ 仍归到 token 账号', buildExportPackage().user.id, '999');

// 身份未命中（临时故障 / 缓存被清）⇒ 回退登录者
withVerifiedToken('github_pat_BBB', '999', 'tokuser'); // 换一份凭证（指纹不同 ⇒ 快照失效）
store.set('stars_account_identity', {}); // 抹掉身份缓存，模拟查不到
USER_ID = '111';
eq('身份查不到 ⇒ 回退登录者', buildExportPackage().user.id, '111');

// 两者皆空 ⇒ 拒绝（既无 token 身份也无登录者）
store.set('github_pat', 'github_pat_CCC');
store.set('stars_account_identity', {});
USER_ID = '';
eq('既无 token 身份又无登录者 ⇒ 拒绝导出', buildExportPackage(), null);
eq('…标签读空（不回落无隔离旧键）', loadAllTags(), {});
store.delete('github_pat');
USER_ID = '111';

/* ================= 16. setTokenVerified：token 唯一写入点的契约（4.18.0） =================
 * 为什么必须锁这里：ADR 0010 把「token 的写入点收敛成一处 + 先确认身份再落库 token」当作**核心不变量**
 * （`getStorageUserId()` 能同步拿到归属 id 全靠它）。但 [15] 是**直接往 store 里塞**凭据与身份的，
 * 绕过了这个函数 —— 于是「401 也保存 token」这类反转在 130 条断言下**全绿**（对抗性验证时实测到）。
 * 本段把契约本身变成断言，并用写入顺序记录锁住「先身份、后 token」。 */
console.log('\n[16] setTokenVerified：唯一写入点 + 先身份后 token');
(async () => {
  const ai = require('./.build/storage/accountIdentity.cjs');
  const { setTokenVerified, fingerprint } = ai;

  /** 记录 GM_setValue 的写入顺序（用来验「先身份、后 token」，不只看最终状态） */
  let writeLog = [];
  const rawSet = global.GM_setValue;
  const spyOn = () => { writeLog = []; global.GM_setValue = (k, v) => { writeLog.push(k); rawSet(k, v); }; };
  const spyOff = () => { global.GM_setValue = rawSet; };

  const tok = (suffix) => `github_pat_${suffix}`;

  // --- 16a 401：拒绝保存（死 token 没有保存价值），且不得写身份 ---
  reset();
  global.fetch = async () => ({ status: 401, ok: false });
  spyOn();
  eq('401 ⇒ 结果 dead', (await setTokenVerified(tok('aaa'))).result, 'dead');
  spyOff();
  eq('…token 未落库', store.get('github_pat'), undefined);
  eq('…身份缓存未写', store.get('stars_account_identity'), undefined);
  eq('…一个 GM 写入都没发生（连清空都没有）', writeLog, []);

  // --- 16b 200 带 id：保存 + 身份落缓存，且**身份先于 token** ---
  reset();
  global.fetch = async () => ({ status: 200, ok: true, json: async () => ({ id: 4242, login: 'tokuser' }) });
  spyOn();
  const r16b = await setTokenVerified(tok('bbb'));
  spyOff();
  eq('200 ⇒ 结果 saved', r16b.result, 'saved');
  eq('…token 已落库', store.get('github_pat'), tok('bbb'));
  eq('…身份写在该凭证指纹下', (store.get('stars_account_identity') || {})[fingerprint(tok('bbb'))], { id: '4242', login: 'tokuser' });
  ok('…**先写身份、后写 token**（顺序不可颠倒）',
    writeLog[0] === 'stars_account_identity' && writeLog[1] === 'github_pat',
    `实际顺序 ${JSON.stringify(writeLog)}`);

  // --- 16c 网络异常 / 5xx / 无 id：仍保存（不能把网络抖动变成「token 没了」），身份留空 ---
  for (const [label, impl] of [
    ['网络异常', async () => { throw new Error('boom'); }],
    ['500', async () => ({ status: 500, ok: false })],
    ['200 但缺 id', async () => ({ status: 200, ok: true, json: async () => ({ login: 'x' }) })],
  ]) {
    reset();
    global.fetch = impl;
    const rr = await setTokenVerified(tok('ccc'));
    eq(`${label} ⇒ saved-unverified`, rr.result, 'saved-unverified');
    eq(`…${label}：token 仍已保存`, store.get('github_pat'), tok('ccc'));
    eq(`…${label}：身份缓存留空（归属回退登录者）`, store.get('stars_account_identity'), undefined);
  }

  // --- 16d 前缀非法 / 空串 ---
  reset();
  global.fetch = async () => { throw new Error('不该被调用'); };
  eq('前缀非法 ⇒ invalid', (await setTokenVerified('not-a-token')).result, 'invalid');
  eq('…未落库', store.get('github_pat'), undefined);
  store.set('github_pat', tok('ddd'));
  eq('空串 ⇒ cleared', (await setTokenVerified('   ')).result, 'cleared');
  eq('…token 被清空', store.get('github_pat'), '');

  // --- 16e 端到端串一次：归属跟着唯一写入点变 ---
  reset();
  USER_ID = '111';
  global.fetch = async () => ({ status: 200, ok: true, json: async () => ({ id: 4242, login: 'tokuser' }) });
  await setTokenVerified(tok('eee'));
  eq('保存后：归属 = token 账号（不是登录者）', buildExportPackage().user.id, '4242');
  await setTokenVerified('');
  eq('清空后：归属回退登录者', buildExportPackage().user.id, '111');
  store.delete('github_pat');

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
