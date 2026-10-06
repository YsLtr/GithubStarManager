// ID 寻址能力探针：默认零网络；--run 也仅允许 GET，不创建/改名仓库、不改变 star。
// Token 仅从 stdin 或专用环境变量读取；报告只记录选定字段，不保存响应正文/凭证。
'use strict';
const fs = require('node:fs');
const readline = require('node:readline');
const API = 'https://api.github.com';
const args = process.argv.slice(2);
const outputAt = args.indexOf('--out');
const output = outputAt >= 0 ? args[outputAt + 1] : '';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') { if (!args[++i]) throw Error('--out requires path'); }
  else if (!['--run', '--token-stdin'].includes(args[i])) throw Error('Unknown option');
}
if (!args.includes('--run')) {
  console.log('dry-run: GET identity, one starred sample, first owned-repo page, public/private ID/name comparisons, ID-star route controls, historical transfer redirect; max 40 requests. No mutations.');
  process.exit(0);
}
const report = { startedAt: new Date().toISOString(), mode: 'GET-only', apiVersion: '2022-11-28', records: [], checks: {}, limitations: [] };
let requestCount = 0;
function save() {
  report.requestCount = requestCount;
  if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
}
async function readToken() {
  if (!args.includes('--token-stdin')) return process.env.GITHUB_TARGET_PROBE_TOKEN || '';
  console.log('Waiting for token on stdin (not logged).');
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  return new Promise(resolve => {
    let received = false;
    rl.once('line', line => { received = true; rl.close(); process.stdin.pause(); resolve(line.trim()); });
    rl.once('close', () => { if (!received) resolve(''); });
  });
}
async function main() {
  const token = await readToken();
  if (!token) throw Error('Missing token');
  async function get(path, label, authenticated = true) {
    let url = API + path;
    const chain = [];
    for (let hop = 0; hop < 4; hop++) {
      if (++requestCount > 40) throw Error('Request budget exhausted');
      if (new URL(url).origin !== API) throw Error('Redirect outside API origin rejected');
      const started = Date.now();
      const r = await fetch(url, {
        method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(25000),
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'GithubStarManager-target-probe', ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const entry = { label, authenticated, hop, status: r.status, elapsedMs: Date.now() - started,
        remaining: r.headers.get('x-ratelimit-remaining'), limit: r.headers.get('x-ratelimit-limit'),
        scopes: r.headers.get('x-oauth-scopes'), requestId: r.headers.get('x-github-request-id'),
        cors: r.headers.get('access-control-allow-origin') };
      report.records.push(entry); chain.push(r.status); save();
      console.log(JSON.stringify(entry));
      if ([401, 403, 429].includes(r.status)) throw Error(`Stopped at ${label}: HTTP ${r.status}`);
      if (Number(entry.remaining) < 10 && entry.remaining !== null) throw Error('Low rate limit');
      if ([301, 302, 307, 308].includes(r.status)) {
        url = new URL(r.headers.get('location'), url).href;
        await r.body?.cancel(); continue;
      }
      const body = await r.json().catch(() => null);
      return { status: r.status, body, chain, finalPath: new URL(url).pathname };
    }
    throw Error('Redirect limit');
  }
  const self = await get('/user', 'identity');
  if (self.status !== 200 || !self.body?.id) throw Error('Identity unavailable');
  const byId = await get(`/user/${self.body.id}`, 'user-by-id');
  report.checks.userByIdMatches = byId.body?.id === self.body.id;
  const starList = await get('/user/starred?per_page=1&sort=created&direction=desc', 'starred-positive-control-list');
  const ownList = await get('/user/repos?affiliation=owner&per_page=100&sort=updated', 'owned-repository-first-page');
  if (!Array.isArray(ownList.body) || !Array.isArray(starList.body)) throw Error('Unexpected list shape');
  const own = ownList.body.filter(r => r.owner?.id === self.body.id);
  report.checks.ownedSampleCounts = { public: own.filter(r => !r.private).length, private: own.filter(r => r.private).length };
  async function compare(repo, label) {
    const id = await get(`/repositories/${repo.id}`, `${label}:id`);
    const name = await get(`/repos/${repo.full_name}`, `${label}:name`);
    report.checks[label] = { idStatus: id.status, nameStatus: name.status,
      idMatches: id.body?.id === repo.id, nameIdMatches: name.body?.id === repo.id,
      namesMatch: id.body?.full_name === name.body?.full_name,
      ownerMatches: id.body?.owner?.id === repo.owner?.id, private: !!repo.private };
    if (repo.private) {
      const anonId = await get(`/repositories/${repo.id}`, `${label}:anonymous-id`, false);
      const anonName = await get(`/repos/${repo.full_name}`, `${label}:anonymous-name`, false);
      report.checks[label].anonymous = { idStatus: anonId.status, nameStatus: anonName.status };
    }
  }
  for (const privacy of [false, true]) {
    const repo = own.find(r => r.private === privacy);
    if (repo) await compare(repo, privacy ? 'own-private' : 'own-public');
    else report.limitations.push(`No ${privacy ? 'private' : 'public'} owned sample on first page`);
  }
  const sample = starList.body[0];
  if (sample) {
    await compare(sample, 'starred-sample');
    const named = await get(`/user/starred/${sample.full_name}`, 'star-state:name-positive-control');
    const numeric = await get(`/user/starred/${sample.id}`, 'star-state:direct-numeric-candidate');
    const nested = await get(`/user/starred/repositories/${sample.id}`, 'star-state:nested-id-candidate');
    report.checks.starReadRoutes = { positiveControl: named.status, directNumeric: numeric.status, nestedId: nested.status };
  } else report.limitations.push('Empty starred list: no positive control');
  const absent = await get('/repositories/0', 'invalid-id-zero');
  report.checks.invalidIdStatus = absent.status;
  const moved = await get('/repos/github/linguist', 'historical-transfer:old-name', false);
  if (moved.status === 200 && moved.body?.id) {
    const stable = await get(`/repositories/${moved.body.id}`, 'historical-transfer:id', false);
    const current = await get(`/repos/${moved.body.full_name}`, 'historical-transfer:current-name', false);
    report.checks.historicalTransfer = { oldName: 'github/linguist', currentName: moved.body.full_name,
      repoId: moved.body.id, oldNameChain: moved.chain, oldNameFinalPath: moved.finalPath,
      stableIdMatches: stable.body?.id === moved.body.id, currentIdMatches: current.body?.id === moved.body.id };
  }
  report.limitations.push('classic only; no mutations; no synthetic rename/name-reuse; no browser Cookie/CSP test; private names and IDs omitted');
  report.completedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ checks: report.checks, limitations: report.limitations }));
}
main().catch(() => {
  // 不打印任意异常对象，避免第三方 fetch 错误意外带出请求头。
  report.failed = true; save(); console.error('Probe stopped; inspect sanitized records for the last completed request.'); process.exitCode = 1;
});
