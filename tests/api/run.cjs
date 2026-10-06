'use strict';
const assert = require('node:assert/strict');
let clock = 1800000000000;
Date.now = () => clock;
const store = new Map();
const mirror = new Map();
let storageWrites = [];
let session = false;
let nativeTarget = null;
let formReads = [];
const NativeFormData = global.FormData;
// Node 没有 HTMLFormElement：只模拟浏览器 FormData(form) 的字段复制契约。
// 这会实际走产品的表单分支，但不是浏览器 Cookie/TM 端到端证明。
global.FormData = class extends NativeFormData {
  constructor(form) {
    super();
    if (form !== undefined) {
      assert.ok(Array.isArray(form.fields), 'expected native form fixture');
      formReads.push(form);
      for (const [key, value] of form.fields) this.append(key, value);
    }
  }
};
function nativeForm(selector) {
  if (!nativeTarget) return null;
  for (const direction of ['star', 'unstar']) {
    if (selector === `form[action="/${nativeTarget.fullName}/${direction}"]`) {
      return { fields: [['authenticity_token', `native-${direction}-token`], ['context', 'user_stars'], ['fixture', 'preserved']] };
    }
  }
  return null;
}
global.window = { setTimeout: (fn, ms) => { clock += ms; queueMicrotask(fn); return 1; }, clearTimeout() {},
  matchMedia: () => ({ matches: false }), alert() {}, addEventListener() {}, removeEventListener() {} };
global.location = new URL('https://github.com/tester?tab=stars');
global.document = {
  body: { classList: { contains: () => session } },
  querySelector(selector) {
    if (selector === 'meta[name="user-login"]') return { content: session ? 'tester' : '' };
    if (selector === 'meta[name="octolytics-actor-id"]') return { content: '999' };
    return nativeForm(selector);
  },
  querySelectorAll(selector) {
    if (!nativeTarget || selector !== `user-list-menu[data-repository-id="${nativeTarget.repoId}"]`) return [];
    return [{ closest() { return { querySelector(s) {
      if (s === 'h3 a[href]') return { getAttribute: () => '/' + nativeTarget.fullName };
      return nativeForm(s);
    } }; } }];
  },
  getElementById() { return null; }, addEventListener() {}, removeEventListener() {},
};
const clone = value => value === undefined ? value : structuredClone(value);
global.GM_getValue = (key, fallback) => store.has(key) ? clone(store.get(key)) : fallback;
global.GM_setValue = (key, value) => { storageWrites.push(key); store.set(key, clone(value)); };
global.localStorage = { getItem: key => mirror.get(key) ?? null, setItem: (key, value) => mirror.set(key, value), removeItem: key => mirror.delete(key) };
const { targets: t, repositories: api, writes, queue, restore, sync } = require('./.build/api.cjs');
const API = 'https://api.github.com';
let calls = [];
let requestExpectations = [];
function response(status, body, headers = {}) {
  return new Response([204, 304].includes(status) ? null : JSON.stringify(body ?? {}), { status, headers });
}
function mock(steps) {
  calls = [];
  const expectation = { steps: [...steps], violations: [] };
  requestExpectations.push(expectation);
  global.fetch = async (url, init = {}) => {
    calls.push({ url, init, at: clock });
    const step = expectation.steps.shift();
    try {
      assert.ok(step, `unexpected request ${url}`);
      assert.equal(url, step.url);
      assert.equal(init.method || 'GET', step.method || 'GET');
      if (step.check) await step.check(init);
    } catch (error) {
      // 产品会捕获 fetch 异常并返回 network；独立记账，禁止断言被吞成“预期失败”。
      expectation.violations.push(error);
      throw error;
    }
    if (step.throw) throw new Error('offline');
    if (step.delay) clock += step.delay;
    return step.response || response(step.status ?? 200, step.body, step.headers);
  };
  return () => verifyExpectation(expectation);
}
function verifyExpectation(expectation) {
  assert.equal(expectation.violations.length, 0, expectation.violations.map(error => error.message).join('\n'));
  assert.equal(expectation.steps.length, 0, 'all expected requests were exercised');
}
const metadata = (id = '12', fullName = 'new/repo', extras = {}) => ({ url: `${API}/repositories/${id}`, body: { id: Number(id), full_name: fullName }, ...extras });
const state = (status, name = 'new/repo', extras = {}) => ({ url: `${API}/user/starred/${name}`, status, ...extras });
function reset() {
  store.clear(); mirror.clear(); storageWrites = []; session = false; nativeTarget = null; formReads = [];
  requestExpectations = [];
  mock([]); // 每个用例默认零请求；禁止继承上一用例的 fetch。
}
let passed = 0;
async function test(name, fn) {
  reset();
  await fn();
  requestExpectations.forEach(verifyExpectation); // 即使忘记调用 done() 也必须验证所有 mock。
  passed++;
  console.log(`✓ ${name}`);
}

(async () => {
  if (process.env.GSM_API_MOCK_PROBE) {
    await test('intentional harness failure probe', async () => {
      if (process.env.GSM_API_MOCK_PROBE === 'missing') mock([metadata()]);
      else {
        mock(process.env.GSM_API_MOCK_PROBE === 'check'
          ? [metadata('12', 'new/repo', { check: () => assert.fail('intentional request assertion') })] : []);
        // 不调用 done、不检查结果：产品吞掉异常后，每用例总闸仍必须报红。
        await api.resolveRepoTarget('', { repoId: '12' });
      }
    });
    return;
  }
  await test('pure target validation: numeric IDs and name-only DOM keys stay distinct', () => {
    assert.deepEqual(t.repoTarget('old/repo'), { repoId: undefined, fullName: 'old/repo' });
    assert.equal(t.repoTargetKey(t.repoTarget('12', 'old/repo')), 'repo:12');
    assert.equal(t.repoTargetKey({ fullName: 'Owner/Repo' }), 'name:owner/repo');
    for (const name of ['a/b/c', 'a/b?x', 'a/b#x', 'https://a/b', 'a/..', 'a/%2f', ' a/b', 'a/b\\c']) assert.equal(t.repoFullName(name), '');
    for (const id of ['0', '-1', '01', '1.5', 'a/b', 'R_node']) assert.equal(t.numericRepoId(id), '');
  });
  await test('known ID ignores stale/mismatched name hint; ID-only works', async () => {
    const done = mock([metadata()]);
    assert.deepEqual(await api.resolveRepoTarget('credential', { repoId: '12', fullName: 'old/repo' }), { ok: true, target: { repoId: '12', fullName: 'new/repo' } });
    done(); assert.equal(storageWrites.length, 0);
    const done2 = mock([metadata()]);
    assert.equal((await api.resolveRepoTarget('', { repoId: '12' })).ok, true);
    assert.equal(calls[0].init.credentials, 'omit'); assert.equal(calls[0].init.headers.Authorization, undefined); done2();
  });
  await test('ID 404 falls back to name only if returned ID matches', async () => {
    const done = mock([metadata('12', '', { status: 404 }), { url: `${API}/repos/old/repo`, body: { id: 12, full_name: 'new/repo' } }]);
    assert.equal((await api.resolveRepoTarget('', { repoId: '12', fullName: 'old/repo' })).ok, true); done();
    const done2 = mock([metadata('12', '', { status: 404 }), { url: `${API}/repos/old/repo`, body: { id: 99, full_name: 'old/repo' } }]);
    assert.equal((await writes.setStarState('ghp_test', { repoId: '12', fullName: 'old/repo' }, true)).reason, 'target-mismatch');
    assert.ok(calls.every(c => !c.init.method)); done2();
  });
  await test('malformed or wrong-ID metadata never authorizes a write', async () => {
    for (const body of [{ id: 99, full_name: 'new/repo' }, { id: 12 }, null]) {
      const done = mock([metadata('12', '', { body })]);
      assert.equal((await writes.setStarState('ghp_test', { repoId: '12' }, true)).ok, false); done();
    }
  });
  await test('name-only resolves numeric identity; invalid explicit ID fails without network', async () => {
    const done = mock([{ url: `${API}/repos/old/repo`, body: { id: 12, full_name: 'new/repo' } }]);
    assert.equal((await api.resolveRepoTarget('', { fullName: 'old/repo' })).target.repoId, '12'); done();
    const noRequests = mock([]);
    assert.equal((await api.resolveRepoTarget('', { repoId: 'bad', fullName: 'old/repo' })).reason, 'invalid-target'); noRequests();
  });
  await test('401/403/429/500/network never trigger name fallback', async () => {
    for (const [status, reason] of [[401, 'unauthorized'], [403, 'permission-denied'], [429, 'rate-limited'], [500, 'unknown']]) {
      const done = mock([metadata('12', '', { status })]);
      assert.equal((await api.resolveRepoTarget('', { repoId: '12', fullName: 'old/repo' })).reason, reason); done();
    }
    const done = mock([metadata('12', '', { throw: true })]);
    assert.equal((await api.resolveRepoTarget('', { repoId: '12', fullName: 'old/repo' })).reason, 'network'); done();
  });
  await test('redirect result retains identity; cross-origin final response rejected', async () => {
    const r = response(200, { id: 12, full_name: 'new/repo' });
    Object.defineProperty(r, 'url', { value: `${API}/repositories/12` });
    const done = mock([{ url: `${API}/repos/old/repo`, response: r }]);
    assert.equal((await api.resolveRepoTarget('', { fullName: 'old/repo' })).ok, true); done();
    const other = response(200, { id: 12, full_name: 'new/repo' });
    Object.defineProperty(other, 'url', { value: 'https://example.invalid/repository' });
    mock([metadata('12', '', { response: other })]);
    assert.equal((await api.resolveRepoTarget('', { repoId: '12' })).reason, 'target-mismatch');
  });
  await test('star-state 404 is distinct from metadata 404', async () => {
    const done = mock([metadata('12', '', { status: 404 })]);
    assert.equal((await api.checkRepoStarred('', { repoId: '12' })).ok, false); done();
    const done2 = mock([metadata(), state(404)]);
    assert.equal((await api.checkRepoStarred('', { repoId: '12' })).gone, true); done2();
  });
  await test('staged checks discard results when later request exhausts budget', async () => {
    const done = mock([metadata(), state(404), metadata('13', 'new/other', { headers: { 'x-ratelimit-remaining': '9' } })]);
    let committed = false;
    await assert.rejects(async () => { await api.collectStarredChecks('', [{ repoId: '12' }, { repoId: '13' }], 100); committed = true; });
    assert.equal(committed, false); assert.equal(storageWrites.length, 0); done();
    const none = mock([]); await assert.rejects(api.collectStarredChecks('', [{ repoId: '12' }], 12)); none();
  });
  await test('ID-driven write uses current full name and returns resolved target', async () => {
    const done = mock([metadata(), state(204, 'new/repo', { method: 'PUT', check: init => {
      assert.equal(init.redirect, 'error'); assert.equal(init.headers.Authorization, 'Bearer ghp_test');
    } })]);
    const result = await writes.setStarState('ghp_test', { repoId: '12', fullName: 'old/repo' }, true);
    assert.equal(result.target.fullName, 'new/repo'); done();
  });
  await test('REST permission fallback keeps resolved target and actual mutation interval', async () => {
    session = true;
    const done = mock([metadata(), state(403, 'new/repo', { method: 'DELETE' }),
      { url: 'https://github.com/new/repo/unstar', method: 'POST', status: 200 }]);
    const result = await writes.setStarState('ghp_test', { repoId: '12', fullName: 'old/repo' }, false);
    assert.equal(result.via, 'web');
    assert.ok(calls[2].at - calls[1].at >= 1000); done();
  });
  await test('rate-limited REST does not fall back to Cookie', async () => {
    session = true;
    const done = mock([metadata(), state(429, 'new/repo', { method: 'PUT' })]);
    assert.equal((await writes.setStarState('ghp_test', { repoId: '12' }, true)).reason, 'rate-limited'); done();
  });
  await test('Cookie-only private target uses same-ID native row, including hidden rows', async () => {
    session = true; nativeTarget = { repoId: '12', fullName: 'private/current' };
    const done = mock([{ url: 'https://github.com/private/current/star', method: 'POST', check: init => {
      assert.equal(init.body.get('authenticity_token'), 'native-star-token');
      assert.equal(init.body.get('context'), 'user_stars');
      assert.equal(init.body.get('fixture'), 'preserved');
      assert.equal(init.credentials, 'same-origin');
    } }]);
    assert.equal((await writes.setStarState('', { repoId: '12', fullName: 'old/repo' }, true)).target.fullName, 'private/current'); done();
    assert.equal(formReads.length, 1);
  });
  await test('native unstar form uses its own token; HTTP rejection stays a failure with both forms present', async () => {
    session = true; nativeTarget = { repoId: '12', fullName: 'private/current' };
    mock([{ url: 'https://github.com/private/current/unstar', method: 'POST', status: 422, check: init => {
      assert.equal(init.body.get('authenticity_token'), 'native-unstar-token');
    } }]);
    assert.equal((await writes.setStarState('', { repoId: '12' }, false)).reason, 'csrf-failed');
    assert.equal(formReads.length, 1);
  });
  await test('Cookie without API visibility or same-ID DOM does not write stale name', async () => {
    session = true; nativeTarget = { repoId: '99', fullName: 'old/repo' };
    const done = mock([metadata('12', '', { status: 404 }), { url: `${API}/repos/old/repo`, status: 404 }]);
    assert.equal((await writes.setStarState('', { repoId: '12', fullName: 'old/repo' }, true)).ok, false); done();
  });
  await test('queue rejects same ID while executing; canceled items never run', async () => {
    let release; let canceledRan = false;
    const first = queue.enqueueMutation({ key: 'repo:12', label: 'old/repo', run: () => new Promise(r => { release = r; }) });
    // 队列可能处在写间隔等待期；直到第一个任务实际进入 run。
    while (!release) await Promise.resolve();
    assert.equal(queue.enqueueMutation({ key: 'repo:12', label: 'new/repo', run: async () => false }), null);
    const canceled = queue.enqueueMutation({ key: 'repo:13', label: 'other', run: async () => { canceledRan = true; } });
    assert.equal(canceled.cancelQueued(), true); release(true);
    assert.equal(await first.done, true); assert.equal(await canceled.done, null); assert.equal(canceledRan, false);
  });
  await test('name alias queued during same-ID operation cannot write it again after completion', async () => {
    let release;
    const first = queue.enqueueMutation({ key: 'repo:12', label: 'one', run: () => new Promise(r => { release = r; }) });
    while (!release) await Promise.resolve();
    const alias = queue.enqueueMutation({ key: 'name:old/repo', label: 'two', run: async () => queue.claimMutationTarget('repo:12') });
    release(true); await first.done;
    assert.equal(await alias.done, false);
  });
  await test('metadata delays do not collapse actual mutation spacing', async () => {
    const done = mock([metadata('12', 'new/one', { delay: 1400 }), state(204, 'new/one', { method: 'PUT' }),
      metadata('13', 'new/two'), state(204, 'new/two', { method: 'PUT' })]);
    const a = queue.enqueueMutation({ key: 'repo:12', label: 'a', run: () => writes.setStarState('ghp_test', { repoId: '12' }, true) });
    const b = queue.enqueueMutation({ key: 'repo:13', label: 'b', run: () => writes.setStarState('ghp_test', { repoId: '13' }, true) });
    assert.equal((await a.done).ok, true); assert.equal((await b.done).ok, true);
    const mutations = calls.filter(c => c.init.method); assert.ok(mutations[1].at - mutations[0].at >= 1000); done();
  });
  await test('ID-only restore preserves tags/notes and uses resolved name', async () => {
    store.set('github_pat', 'ghp_test');
    store.set('stars_pending_delete_999', { 12: { name: '', unstarredAt: clock, _tags: ['keep'], _note: 'note' } });
    const done = mock([metadata(), state(204, 'new/repo', { method: 'PUT' })]);
    const result = await restore.restoreOne({ repoId: '12', name: '12' });
    assert.equal(result.ok, true); assert.equal(store.get('stars_repo_cache')['12'].name, 'new/repo');
    assert.deepEqual(store.get('stars_tags_999')['12'], ['keep']); assert.equal(store.get('stars_notes_999')['12'], 'note');
    assert.deepEqual(store.get('stars_pending_delete_999'), {}); done();
  });
  await test('failed restore leaves pending data byte-for-byte intact', async () => {
    store.set('github_pat', 'ghp_test');
    store.set('stars_pending_delete_999', { 12: { name: '', unstarredAt: clock, _tags: ['keep'] } });
    const before = clone([...store]);
    const done = mock([metadata('12', '', { status: 404 })]);
    assert.equal((await restore.restoreOne({ repoId: '12', name: '' })).ok, false);
    assert.deepEqual([...store], before); done();
  });
  await test('batch stops after low-budget failure before attempting another target', async () => {
    store.set('github_pat', 'ghp_test');
    const done = mock([metadata('12', '', { headers: { 'x-ratelimit-remaining': '9' } })]);
    const result = await restore.restoreMany([{ repoId: '12', name: '' }, { repoId: '13', name: '' }]);
    assert.equal(result.cancelled, true); assert.equal(result.failed.length, 1); done();
  });
  await test('full-body sync refreshes renamed repository without per-repo lookup', async () => {
    store.set('github_pat', 'ghp_test'); store.set('stars_repo_cache', { 12: { name: 'old/repo' } });
    const done = mock([{ url: `${API}/user/starred?per_page=100&page=1&sort=created&direction=desc`,
      body: [{ starred_at: new Date(clock).toISOString(), repository: { id: 12, full_name: 'new/repo' } }], headers: { etag: '"one"' } }]);
    const result = await sync.runFullSync('auto'); assert.equal(result.unstarred, 0);
    assert.equal(store.get('stars_repo_cache')['12'].name, 'new/repo'); done();
  });
  await test('all-304 path makes no identity or per-repository requests', async () => {
    store.set('github_pat', 'ghp_test'); store.set('stars_repo_cache', { 12: { name: 'old/repo' } });
    store.set('stars_full_sync_meta', { etags: ['"one"'], tailEtag: '"tail"', lastFullSyncAt: clock, count: 1 });
    const done = mock([1, 2].map(page => ({ url: `${API}/user/starred?per_page=100&page=${page}&sort=created&direction=desc`, status: 304 })));
    assert.equal((await sync.runFullSync('auto')).unstarred, 0); assert.equal(calls.length, 2); done();
  });
  function seedHybrid() {
    store.set('github_pat', 'ghp_test');
    const cache = {};
    for (let id = 1; id <= 101; id++) cache[id] = { name: `old/r${id}`, starredAt: new Date(clock - id * 1000).toISOString() };
    store.set('stars_repo_cache', cache);
    store.set('stars_tags_999', { 1: ['do-not-lose'], 2: ['keep'] });
    store.set('stars_notes_999', { 1: 'retained on failure' });
    store.set('stars_full_sync_meta', { etags: ['"one"', '"two"'], tailEtag: '"tail"', lastFullSyncAt: clock, count: 101 });
    return [1, 2, 3].map(page => ({ url: `${API}/user/starred?per_page=100&page=${page}&sort=created&direction=desc`,
      status: page === 1 ? 200 : 304, headers: { etag: '"changed"', 'x-ratelimit-remaining': '100' },
      body: page === 1 ? Array.from({ length: 98 }, (_, i) => ({ starred_at: cache[i + 3].starredAt, repository: { id: i + 3, full_name: cache[i + 3].name } })) : undefined }));
  }
  await test('real mixed sync: later quota failure commits no cache/tags/notes/pending/meta', async () => {
    const pages = seedHybrid(); const before = clone([...store]);
    const done = mock([...pages, metadata('1', 'new/one'), state(404, 'new/one'), metadata('2', '', { headers: { 'x-ratelimit-remaining': '9' } })]);
    assert.equal(await sync.runFullSync('auto'), null);
    assert.deepEqual([...store], before); assert.deepEqual(storageWrites, []); done();
  });
  await test('real mixed sync: metadata 404 preserves local tags; renamed-star 204 preserves membership', async () => {
    const pages = seedHybrid();
    const done = mock([...pages, metadata('1', '', { status: 404 }), { url: `${API}/repos/old/r1`, status: 404 },
      metadata('2', 'new/two'), state(204, 'new/two')]);
    assert.equal((await sync.runFullSync('auto')).unstarred, 0);
    assert.deepEqual(store.get('stars_tags_999'), { 1: ['do-not-lose'], 2: ['keep'] });
    assert.ok(store.get('stars_repo_cache')['1']); assert.equal(store.get('stars_repo_cache')['2'].name, 'new/two'); done();
  });
  await test('mixed sync commits confirmed removals only for ordinary 403/network; 401 abandons all', async () => {
    for (const kind of ['403', 'network', '401']) {
      reset();
      const pages = seedHybrid();
      const before = clone([...store]);
      const done = mock([...pages, metadata('1', 'new/one'), state(404, 'new/one'),
        metadata('2', '', kind === 'network' ? { throw: true } : { status: Number(kind) })]);
      const result = await sync.runFullSync('auto');
      if (kind === '401') {
        assert.equal(result, null);
        assert.deepEqual([...store], before);
        assert.deepEqual(storageWrites, []);
      } else {
        assert.equal(result.unstarred, 1);
        assert.equal(store.get('stars_repo_cache')['1'], undefined);
        assert.ok(store.get('stars_repo_cache')['2']);
        assert.deepEqual(store.get('stars_pending_delete_999')['1']._tags, ['do-not-lose']);
        assert.deepEqual(store.get('stars_tags_999')['2'], ['keep']);
      }
      done();
    }
  });
  await require('./review-timeout.cjs')({ test, api, queue, mock, metadata, state });
  await require('./review-targets.cjs')({ test, mock, metadata, state, store, t, restore });
  console.log(`API regression: ${passed} passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
