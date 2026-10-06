// 受控写验证：仅 token 自有公共仓库，数字 ID 星标候选与官方名称端点对照，最后恢复基线。
// 默认 dry-run；凭证只读 GITHUB_TARGET_PROBE_TOKEN。最多 6 次变异，间隔至少 1 秒。
'use strict';
const fs = require('node:fs');
const args = process.argv.slice(2);
let out = '';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') { out = args[++i]; if (!out) throw Error('Missing output path'); }
  else if (args[i] !== '--run') throw Error('Unknown option');
}
if (!args.includes('--run')) {
  console.log('dry-run: own public repository only; GET baseline; numeric-ID PUT/DELETE versus name controls; restore and verify baseline. Max 6 mutations, >=1000ms apart.');
  process.exit(0);
}
const report = { startedAt: new Date().toISOString(), records: [], checks: {}, mutationCount: 0 };
let lastMutation = 0;
let count = 0;
let halted = false;
function save() { report.requestCount = count; if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n'); }
async function main() {
  const token = process.env.GITHUB_TARGET_PROBE_TOKEN;
  if (!token) throw Error('Missing credential');
  async function request(path, method, label) {
    if (halted || ++count > 24) throw Error('Request stopped');
    if (method !== 'GET') {
      if (++report.mutationCount > 6) throw Error('Mutation cap');
      await new Promise(resolve => setTimeout(resolve, Math.max(0, lastMutation + 1000 - Date.now())));
      lastMutation = Date.now();
    }
    const startedAt = new Date().toISOString();
    const r = await fetch('https://api.github.com' + path, {
      method, redirect: 'manual', signal: AbortSignal.timeout(25000),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'GithubStarManager-target-probe' },
    });
    const entry = { label, method, status: r.status, startedAt, at: new Date().toISOString(),
      remaining: r.headers.get('x-ratelimit-remaining'), requestId: r.headers.get('x-github-request-id') };
    report.records.push(entry); save(); console.log(JSON.stringify(entry));
    if ([401, 403, 429].includes(r.status)) { halted = true; throw Error('Credential/rate stop'); }
    return { status: r.status, body: await r.json().catch(() => null) };
  }
  const self = await request('/user', 'GET', 'identity');
  if (self.status !== 200 || !self.body?.id) throw Error('Missing identity');
  const repos = await request('/user/repos?affiliation=owner&visibility=public&per_page=100&sort=updated', 'GET', 'own-public-samples');
  const repo = repos.body?.find(r => !r.private && !r.archived && r.owner?.id === self.body.id);
  if (!repo) throw Error('No own public sample');
  const resolved = await request(`/repositories/${repo.id}`, 'GET', 'resolve-id');
  if (resolved.status !== 200 || resolved.body?.id !== repo.id || resolved.body.owner?.id !== self.body.id || resolved.body.private) throw Error('Identity mismatch');
  report.target = { repoId: repo.id, fullName: resolved.body.full_name, ownedByCredential: true, private: false };
  const namePath = '/user/starred/' + resolved.body.full_name.split('/').map(encodeURIComponent).join('/');
  const idPath = `/user/starred/${repo.id}`;
  async function state(label) {
    const r = await request(namePath, 'GET', label);
    if (![204, 404].includes(r.status)) throw Error('Indeterminate state');
    return r.status === 204;
  }
  const baseline = await state('baseline');
  report.checks.baselineStarred = baseline;
  try {
    for (const target of [!baseline, baseline]) {
      const method = target ? 'PUT' : 'DELETE';
      const before = await state(`${method}:before`);
      const candidate = await request(idPath, method, `${method}:numeric-candidate`);
      const afterCandidate = await state(`${method}:after-numeric`);
      report.checks[method] = { numericStatus: candidate.status, stateChanged: afterCandidate !== before };
      if (candidate.status === 404 && afterCandidate !== before) throw Error('Unexpected external state change');
      if (candidate.status !== 404 && candidate.status !== 204) throw Error('Unexpected candidate status');
      if (afterCandidate !== target) {
        const official = await request(namePath, method, `${method}:name-control`);
        report.checks[method].nameStatus = official.status;
        if (official.status !== 204) throw Error('Official mutation failed');
      }
      if (await state(`${method}:verified`) !== target) throw Error('Mutation not confirmed');
    }
  } finally {
    if (!halted) {
      const current = await state('cleanup-state');
      if (current !== baseline) await request(namePath, baseline ? 'PUT' : 'DELETE', 'restore-baseline');
      report.checks.baselineRestored = (await state('final-baseline-check')) === baseline;
    } else report.checks.baselineRestored = null;
    save();
  }
  if (!report.checks.baselineRestored) throw Error('Baseline not restored');
  report.completedAt = new Date().toISOString(); save(); console.log(JSON.stringify(report.checks));
}
main().catch(() => {
  report.failed = true; save(); console.error('Write probe stopped. Check baselineRestored and sanitized records.'); process.exitCode = 1;
});
