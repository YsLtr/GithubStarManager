'use strict';
const assert = require('node:assert/strict');

module.exports = async function reviewTargets({ test, mock, metadata, state, store, t, restore }) {
  const API = 'https://api.github.com';
  const nameRead = () => ({ url: API + '/repos/old/repo', body: { id: 12, full_name: 'new/repo' } });
  const seed = () => {
    store.set('github_pat', 'ghp_test');
    store.set('stars_pending_delete_999', { 'old/repo': { name: 'old/repo', unstarredAt: Date.now(), _tags: ['keep'], _note: 'retained' } });
  };
  await test('invalid business IDs cannot silently become name-only requests', async () => {
    for (const id of ['bad', '0', '01', '-1', 'R_node', 'a/b/c']) {
      const target = t.repoTarget(id, 'old/repo');
      assert.equal(target.repoId, id);
      assert.equal(t.repoTargetKey(target), '');
      const done = mock([]);
      assert.equal((await restore.restoreOne({ repoId: id, name: 'old/repo' })).ok, false);
      done();
    }
  });
  await test('name-key restore commits cache, tags and notes under resolved numeric ID', async () => {
    seed();
    const done = mock([nameRead(), state(204, 'new/repo', { method: 'PUT' })]);
    const result = await restore.restoreOne({ repoId: 'old/repo', name: 'old/repo' });
    assert.equal(result.ok, true);
    assert.deepEqual(store.get('stars_repo_cache'), { 12: { name: 'new/repo' } });
    assert.deepEqual(store.get('stars_tags_999'), { 12: ['keep'] });
    assert.deepEqual(store.get('stars_notes_999'), { 12: 'retained' });
    assert.deepEqual(store.get('stars_pending_delete_999'), {});
    done();
  });
  await test('name-key restore refuses every occupied destination before mutation', async () => {
    for (const [key, value] of [
      ['stars_repo_cache', { name: 'existing/repo' }],
      ['stars_tags_999', ['existing']], ['stars_notes_999', 'existing'],
      ['stars_pending_delete_999', { name: 'existing/repo', _tags: ['existing'] }],
    ]) {
      seed();
      for (const other of ['stars_repo_cache', 'stars_tags_999', 'stars_notes_999']) store.delete(other);
      store.set(key, { ...(store.get(key) || {}), 12: value });
      const before = structuredClone([...store]);
      const done = mock([nameRead()]);
      const result = await restore.restoreOne({ repoId: 'old/repo', name: 'old/repo' });
      assert.equal(result.ok, false);
      assert.match(result.message, /原备份已保留/);
      assert.deepEqual([...store], before);
      done();
    }
  });
  await test('name-key restore rechecks destination after in-flight import', async () => {
    seed();
    const original = structuredClone(store.get('stars_pending_delete_999'));
    const done = mock([nameRead(), state(204, 'new/repo', { method: 'PUT', check: () => {
      store.set('stars_tags_999', { 12: ['concurrent import'] });
    } })]);
    const result = await restore.restoreOne({ repoId: 'old/repo', name: 'old/repo' });
    assert.equal(result.ok, false);
    assert.match(result.message, /远端已加星/);
    assert.deepEqual(store.get('stars_pending_delete_999'), original);
    assert.deepEqual(store.get('stars_tags_999'), { 12: ['concurrent import'] });
    assert.equal(store.has('stars_repo_cache'), false);
    done();
  });
};
