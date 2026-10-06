'use strict';
const assert = require('node:assert/strict');

module.exports = async function reviewTimeout({ test, api, queue, mock, metadata, state }) {
  await test('read deadline covers stalled headers and bodies; queue continues after abort', async () => {
    const savedFetch = global.fetch;
    const savedTimer = global.setTimeout;
    global.setTimeout = (fn, ms, ...args) => savedTimer(fn, ms === 20_000 ? 15 : ms, ...args);
    try {
      for (const status of [null, 200, 403, 429]) {
        let aborted = false;
        let started = false;
        global.fetch = async (_url, init) => {
          started = true;
          if (status === null) return new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted headers')); });
          });
          return new Response(new ReadableStream({ start(controller) {
            controller.enqueue(new TextEncoder().encode(status === 200 ? '{"id":12,' : 'partial error'));
            init.signal.addEventListener('abort', () => {
              aborted = true;
              controller.error(new Error('aborted body'));
            });
          } }), { status });
        };
        const first = queue.enqueueMutation({ key: `timeout:${status}`, label: 'timeout',
          run: () => api.resolveRepoTarget('', { repoId: '12' }) });
        const next = queue.enqueueMutation({ key: `after-timeout:${status}`, label: 'next', run: async () => 'continued' });
        assert.ok(first && next);
        let watchdog;
        try {
          const results = await Promise.race([
            Promise.all([first.done, next.done]),
            new Promise((_resolve, reject) => { watchdog = savedTimer(() => reject(new Error(`deadline failed for ${status}`)), 1000); }),
          ]);
          assert.deepEqual(results, [status === 429
            ? { ok: false, reason: 'rate-limited', status: 429 }
            : { ok: false, reason: 'network', status: 0 }, 'continued']);
          assert.equal(started, true, 'non-vacuous: request started');
          assert.equal(aborted, true, 'real AbortSignal reached request/body');
        } finally { clearTimeout(watchdog); }
      }
    } finally {
      global.fetch = savedFetch;
      global.setTimeout = savedTimer;
    }
  });

  await test('onResponse abort propagates unchanged and closes unconsumed body', async () => {
    const savedFetch = global.fetch;
    const marker = new Error('stop complete sync');
    let signal;
    let consumed = false;
    global.fetch = async (_url, init) => {
      signal = init.signal;
      const response = new Response('{}', { status: 200 });
      response.text = async () => { consumed = true; return '{}'; };
      return response;
    };
    try {
      await assert.rejects(api.resolveRepoTarget('', { repoId: '12' }, { onResponse() { throw marker; } }), error => error === marker);
      assert.equal(consumed, false);
      assert.equal(signal.aborted, true);
    } finally { global.fetch = savedFetch; }
  });

  await test('ordinary 403 is indeterminate; 401 and rate limits abandon collected checks', async () => {
    for (const status of [403, 401, 429]) {
      const done = mock([metadata('12', 'new/one'), state(404, 'new/one'), metadata('13', 'new/two', { status })]);
      const pending = api.collectStarredChecks('', [{ repoId: '12' }, { repoId: '13' }], 100);
      if (status === 403) {
        const results = await pending;
        assert.equal(results[0].gone, true);
        assert.deepEqual(results[1], { ok: false, reason: 'permission-denied', status: 403 });
      } else await assert.rejects(pending, /本轮放弃/);
      done();
    }
    const done = mock([metadata('12', 'new/one'), state(404, 'new/one'),
      metadata('13', 'new/two', { status: 403, body: { message: 'secondary rate limit' } })]);
    await assert.rejects(api.collectStarredChecks('', [{ repoId: '12' }, { repoId: '13' }], 100), /限流/);
    done();
  });
};
