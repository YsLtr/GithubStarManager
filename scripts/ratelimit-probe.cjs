#!/usr/bin/env node
/**
 * REST 变异请求限流实测探针（4.9.0 阶段 A）。
 *
 * 回答一个问题：`PUT`/`DELETE /user/starred/{owner}/{repo}` 会不会触发 GitHub 的
 * **二级**限流？以及 primary 的 `x-ratelimit-used` 对变异请求是 +1 还是 +5？
 *
 * 设计依据：`docs/research-ratelimit-protocol.md` §4（安全实测协议）、§4.5（字段表）、
 * §4.7（硬上限）、§4.8（判定矩阵）、§4.9（限流 403 vs 权限 403）。
 * 结论落地：`docs/research-ratelimit-measurement.md`；决策见 `docs/adr/0006`。
 *
 * 安全不变量（缺一不可，任一检查失败即拒绝运行）：
 *   1. 目标仓库 owner.id **必须**等于 token 账号 id；
 *   2. 凭证**必须**是 classic/OAuth（scope 含 repo 或 public_repo）——fine-grained 写他人公开仓库
 *      必然 403，会污染「限流 403」的判定（ADR 0004）；
 *   3. 变异请求总数硬上限 60（≈300 点，远低于 900 点/分钟）；
 *   4. **严格串行**，无并发（并发本身就是二级限流的第一触发条件，本实验不做）；
 *   5. 净状态不变 —— 结束时仓库 star 状态必须回到基线 S0，脚本会校验并报告；
 *   6. 任一次 403/429 立即整轮停止（含所有 GET），进入指数退避恢复流程（60→120→240s，≤3 次）；
 *   7. **默认 `--dry-run`：零网络请求**，只打印计划。真的发请求必须显式 `--run`。
 *
 * 用法：
 *   node scripts/ratelimit-probe.cjs                                  # 打印计划（不发请求）
 *   node scripts/ratelimit-probe.cjs --repo me/myrepo                 # 带仓库的计划
 *   node scripts/ratelimit-probe.cjs --run --repo me/myrepo --token-file ~/.pat
 *   node scripts/ratelimit-probe.cjs --run --repo me/myrepo --levels L0,L1,L2 --gap 1000
 *
 * 凭证来源（只用其一）：`--token-file <path>` → `GITHUB_PROBE_TOKEN` 环境变量。
 * 刻意**不读** `GITHUB_TOKEN`：Actions 签发的 token 是仓库级、发不出用户级 star 操作（报告 §5 A5）。
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

/* ---------------- 常量：来自协议报告的硬约束（改这里等于改协议） ---------------- */

const API = 'https://api.github.com';
const HARD_MAX_MUTATING = 60; // §4.7 单次会话变异请求上限
const L1_REQUESTS = 10; // §4.2 L1 = 10 次 × 1000ms
const L2_REQUESTS_PER_GAP = 20; // §4.3 每级 20 次
const L2_GAPS_MS = [1000, 500, 250]; // §4.3 间隔阶梯（不做 0ms / 背靠背）
const L2_QUIET_MS = 60_000; // §4.3 级间静默 ≥60s
const BACKOFF_MS = [60_000, 120_000, 240_000]; // §4.6 403/429 后指数退避，≤3 次
const BODY_SAMPLE_BYTES = 2048; // §4.5 响应体前 2KB
/** §4.6 只对限流类终止做退避恢复；其余终止（权限/状态异常/网络）直接收尾 */
const RATE_LIMIT_HALTS = new Set(['secondary-rate-limit', 'primary-rate-limit', 'rate-limited-429', 'forbidden-unknown']);

/* ---------------- CLI ---------------- */

function parseArgs(argv) {
  const opts = {
    run: false,
    repo: '',
    repoId: '',
    levels: ['L0', 'L1'], // §4.2：默认只到 L1；L2 需显式开启
    gap: 1000,
    tokenFile: '',
    out: 'docs/research-ratelimit-measurement.jsonl',
    maxMutating: HARD_MAX_MUTATING,
    quiet: L2_QUIET_MS,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--dry-run') opts.run = false;
    else if (a === '--run') opts.run = true;
    else if (a === '--repo') opts.repo = next() || '';
    else if (a === '--repo-id') opts.repoId = next() || '';
    else if (a === '--levels') opts.levels = String(next() || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    else if (a === '--gap') opts.gap = Number(next());
    else if (a === '--token-file') opts.tokenFile = next() || '';
    else if (a === '--out') opts.out = next() || opts.out;
    else if (a === '--max-mutating') opts.maxMutating = Number(next());
    else if (a === '--quiet') opts.quiet = Number(next());
    else if (a === '--help' || a === '-h') opts.help = true;
    else {
      console.error(`未知参数：${a}（--help 看用法）`);
      process.exit(2);
    }
  }
  return opts;
}

const HELP = `REST 变异请求限流实测探针（默认 dry-run，零网络请求）

用法：
  node scripts/ratelimit-probe.cjs [--run] --repo <owner/name> [选项]

选项：
  --run                 真的发请求（不加 = 只打印计划）
  --repo-id <id>       优先用稳定仓库 ID 定位（可单独使用）
  --repo <owner/name>   缺 ID 时的目标/名称降级提示；最终按 owner.id 校验自有仓库
  --levels <L0,L1,L2>   执行的级别（默认 L0,L1）
  --gap <ms>            L1 的请求间隔（默认 1000）
  --max-mutating <n>    变异请求硬上限（默认 60，不可超过 60）
  --quiet <ms>          L2 级间静默（默认 60000）
  --token-file <path>   classic PAT 文件（否则读 GITHUB_PROBE_TOKEN）
  --out <path>          原始记录输出（JSONL，默认 docs/research-ratelimit-measurement.jsonl）
`;

/* ---------------- 小工具 ---------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => {
  const d = new Date();
  const pad = (n, w = 2) => String(Math.abs(n)).padStart(w, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.floor(off / 60))}:${pad(off % 60)}`
  );
};

/** 记录器：JSONL 追加写（--run 才创建文件；dry-run 全程不碰磁盘） */
function makeRecorder(outPath) {
  let fd = null;
  const rows = [];
  return {
    push(row) {
      rows.push(row);
      if (fd === null) {
        fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
        fd = fs.openSync(path.resolve(outPath), 'a');
      }
      fs.writeSync(fd, JSON.stringify(row) + '\n');
    },
    get count() {
      return rows.length;
    },
    /** 最近一条记录（终止时用来回填触发原因，供 §4.6 恢复流程使用） */
    last() {
      return rows.length > 0 ? rows[rows.length - 1] : null;
    },
    close() {
      if (fd !== null) fs.closeSync(fd);
      fd = null;
    },
  };
}

/* ---------------- HTTP ---------------- */

class Halt extends Error {
  constructor(kind, detail) {
    super(`${kind}: ${detail}`);
    this.kind = kind;
  }
}

const HEADER_FIELDS = [
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-used',
  'x-ratelimit-reset',
  'x-ratelimit-resource',
  'retry-after',
  'x-accepted-github-permissions',
  'x-oauth-scopes',
  'x-github-request-id',
  'date',
  'content-type',
];

function pickHeaders(h) {
  const out = {};
  for (const k of HEADER_FIELDS) out[k] = h.get(k);
  return out;
}

/** §4.9 判定矩阵：把一次响应归入我们关心的类别 */
function classify(status, headers, bodyText) {
  if (status === 204) return 'ok';
  if (status === 304) return 'not-modified';
  if (status === 404) return 'not-found';
  if (status === 403 || status === 429) {
    if (/secondary rate limit/i.test(bodyText)) return 'secondary-rate-limit';
    if (/API rate limit exceeded/i.test(bodyText) && headers['x-ratelimit-remaining'] === '0') return 'primary-rate-limit';
    if (/not accessible by (personal access token|integration)/i.test(bodyText)) return 'permission-denied';
    return status === 429 ? 'rate-limited-429' : 'forbidden-unknown';
  }
  if (status >= 200 && status < 300) return 'ok-other';
  return `http-${status}`;
}

/**
 * 发一次请求并记录全字段（§4.5）。requestKind：'read' | 'mutate'。
 * body 为空字符串 → undici 会带上 Content-Length: 0（star 端点要求，官方文档）。
 */
async function request(ctx, { method, url, phase, seq, requestKind, note }) {
  const t0 = performance.now();
  let resp;
  try {
    resp = await fetch(url, {
      method,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'github-star-manager-ratelimit-probe',
      },
      ...(requestKind === 'mutate' ? { body: '' } : {}),
    });
  } catch (err) {
    const row = {
      seq,
      local_time: nowIso(),
      phase,
      method,
      url,
      request_kind: requestKind,
      note: note || null,
      network_error: err instanceof Error ? err.message : String(err),
      latency_ms: Math.round(performance.now() - t0),
    };
    ctx.rec.push(row);
    return { row, ok: false, halted: true, kind: 'network' };
  }
  const ttfbMs = Math.round(performance.now() - t0);
  const raw = await resp.text();
  const totalMs = Math.round(performance.now() - t0);
  const headers = pickHeaders(resp.headers);
  const bodySample = raw.slice(0, BODY_SAMPLE_BYTES);
  const kind = classify(resp.status, headers, raw);

  const usedRaw = headers['x-ratelimit-used'];
  const remainingRaw = headers['x-ratelimit-remaining'];
  const row = {
    seq,
    local_time: nowIso(),
    phase,
    method,
    url,
    request_kind: requestKind,
    note: note || null,
    body_bytes: requestKind === 'mutate' ? 0 : null,
    http_status: resp.status,
    classification: kind,
    used: usedRaw === null ? null : Number(usedRaw),
    remaining: remainingRaw === null ? null : Number(remainingRaw),
    limit: headers['x-ratelimit-limit'] === null ? null : Number(headers['x-ratelimit-limit']),
    reset: headers['x-ratelimit-reset'] === null ? null : Number(headers['x-ratelimit-reset']),
    resource: headers['x-ratelimit-resource'],
    retry_after: headers['retry-after'],
    accepted_permissions: headers['x-accepted-github-permissions'],
    oauth_scopes: headers['x-oauth-scopes'],
    request_id: headers['x-github-request-id'],
    server_date: headers['date'],
    content_type: headers['content-type'],
    ttfb_ms: ttfbMs,
    total_ms: totalMs,
    body_sample: bodySample,
  };
  ctx.rec.push(row);

  if (kind === 'secondary-rate-limit' || kind === 'primary-rate-limit' ||
      kind === 'rate-limited-429' || kind === 'forbidden-unknown') {
    return { row, ok: false, halted: true, kind };
  }
  if (kind === 'permission-denied') {
    // §4.8 D9：权限 403 与限流无关，该轮数据作废
    return { row, ok: false, halted: true, kind };
  }
  return { row, ok: resp.ok, halted: false, kind };
}

async function readStarState(ctx, phase, seq, note) {
  const url = `${API}/user/starred/${ctx.owner}/${ctx.repo}`;
  const r = await request(ctx, { method: 'GET', url, phase, seq, requestKind: 'read', note });
  if (r.halted && (r.kind === 'secondary-rate-limit' || r.kind === 'primary-rate-limit')) throw new Halt(r.kind, 'GET 被限流');
  if (r.row.http_status === 204) return true;
  if (r.row.http_status === 404) return false;
  return null; // 不可判定
}

async function snapshotRateLimit(ctx, phase, seq, note) {
  const r = await request(ctx, {
    method: 'GET',
    url: `${API}/rate_limit`,
    phase,
    seq,
    requestKind: 'read',
    note: `rate_limit snapshot${note ? ' ' + note : ''}`,
  });
  return r;
}

/* ---------------- 前置检查（P0） ---------------- */

async function preflight(ctx) {
  const loginResp = await fetch(`${API}/user`, {
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'github-star-manager-ratelimit-probe',
    },
  });
  const scopes = loginResp.headers.get('x-oauth-scopes');
  const body = await loginResp.json().catch(() => null);
  if (!loginResp.ok || !body) {
    throw new Error(`GET /user 失败（HTTP ${loginResp.status}）——token 是否有效？`);
  }
  ctx.scopes = scopes;
  ctx.login = body.login;

  // 元数据查询属于 P0，不混入变异限流测量；名字只在缺 ID 或 ID 404 时降级。
  const byName = `/repos/${encodeURIComponent(ctx.owner)}/${encodeURIComponent(ctx.repo)}`;
  const readRepo = path => fetch(`${API}${path}`, { headers: {
    Authorization: `Bearer ${ctx.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
  } });
  let repoResp = await readRepo(ctx.repoId ? `/repositories/${ctx.repoId}` : byName);
  if (repoResp.status === 404 && ctx.repoId && ctx.owner && ctx.repo) repoResp = await readRepo(byName);
  const repository = await repoResp.json().catch(() => null);
  if (!repoResp.ok || !repository?.id || typeof repository.full_name !== 'string') throw new Error(`仓库解析失败（HTTP ${repoResp.status}）`);
  if (ctx.repoId && String(repository.id) !== ctx.repoId) throw new Error('仓库名称已指向另一个 ID，拒绝运行');
  if (!body.id || repository.owner?.id !== body.id) throw new Error('目标仓库 owner.id 与 token 账号 ID 不同，拒绝运行');
  ctx.repoId = String(repository.id);
  [ctx.owner, ctx.repo] = repository.full_name.split('/');
  // 门 2：必须是 classic/OAuth（scope 体系）
  const scopeList = String(scopes || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (scopes === null || scopes === '') {
    throw new Error(
      '拒绝运行：响应没有 x-oauth-scopes 头 → 这不是 classic/OAuth token（fine-grained PAT 该头为空）。' +
        'fine-grained 写他人公开仓库必然 403，会污染「限流 403」的判定（docs/adr/0004）。'
    );
  }
  if (!scopeList.includes('repo') && !scopeList.includes('public_repo')) {
    throw new Error(`拒绝运行：scope 为 [${scopeList.join(', ')}]，缺少 repo / public_repo —— 写路径不可用。`);
  }
  console.log(`[P0.3] 身份：${body.login}｜scope：${scopes}`);
}

/* ---------------- 级别执行 ---------------- */

/** 变异请求统一入口：硬上限 + 计数 + 限流即停 */
async function mutate(ctx, phase, seq, wantStar, note) {
  if (ctx.mutating >= ctx.maxMutating) throw new Halt('cap', `已达变异请求硬上限 ${ctx.maxMutating}`);
  ctx.mutating += 1;
  const method = wantStar ? 'PUT' : 'DELETE';
  const url = `${API}/user/starred/${ctx.owner}/${ctx.repo}`;
  console.log(`  → [${phase}] #${ctx.mutating} ${method} ${ctx.owner}/${ctx.repo}${note ? '  (' + note + ')' : ''}`);
  const r = await request(ctx, { method, url, phase, seq, requestKind: 'mutate', note });
  if (r.halted && (r.kind === 'secondary-rate-limit' || r.kind === 'primary-rate-limit' || r.kind === 'rate-limited-429')) {
    throw new Halt(r.kind, `${method} 被限流（HTTP ${r.row.http_status}）`);
  }
  if (r.halted && r.kind === 'permission-denied') throw new Halt('permission-denied', `${method} 权限不足`);
  if (r.halted && r.kind === 'network') throw new Halt('network', '网络错误');
  if (r.row.http_status !== 204 && r.row.http_status !== 304) {
    throw new Halt('unexpected-status', `${method} 返回 HTTP ${r.row.http_status}（非 204/304）`);
  }
  ctx.star = wantStar;
  await sleep(ctx.gap);
  return r;
}

async function runL0(ctx) {
  let seq = ctx.seq();
  console.log('\n[L0] 只读基线（零变异请求）');
  await snapshotRateLimit(ctx, 'L0', seq++, 'before');
  const s0 = await readStarState(ctx, 'L0', seq++, 'baseline star state S0');
  if (s0 === null) throw new Halt('baseline', '无法判定基线 star 状态（非 204/404）');
  ctx.star = s0;
  ctx.s0 = s0;
  console.log(`  S0 = ${s0 ? '已 star（204）' : '未 star（404）'}`);
}

async function runL1(ctx) {
  console.log(`\n[L1] ${L1_REQUESTS} × ${ctx.gap}ms（先读后写，保证正确性）`);
  let seq = ctx.seq();
  for (let i = 1; i <= L1_REQUESTS; i += 1) {
    const want = !ctx.star; // 反转当前状态
    const actual = await readStarState(ctx, 'L1', seq++, `pre-read #${i}`);
    if (actual === null) throw new Halt('l1-read', '先读不可判定，停止');
    if (actual !== ctx.star) {
      ctx.star = actual; // 对账漂移（不该发生）
      console.warn(`  ! 状态漂移：实际 ${actual} ≠ 记录 ${!actual}，已校正`);
    }
    if (actual === want) {
      console.log(`  · #${i} 已是目标状态，跳过本次写（不计数）`);
      continue;
    }
    await mutate(ctx, 'L1', seq++, want, `#${i}/${L1_REQUESTS}`);
  }
  await snapshotRateLimit(ctx, 'L1', seq++, 'after');
  // §4.2 L1→L2 之间静默 ≥60s 由 main 在确认要跑 L2 时执行（不跑 L2 就白等）
}

async function runL2(ctx) {
  console.log(`\n[L2] 每级 ${L2_REQUESTS_PER_GAP} 次，间隔阶梯 ${L2_GAPS_MS.join(' → ')}ms（盲交替）`);
  const savedGap = ctx.gap;
  let seq = ctx.seq();
  for (const gap of L2_GAPS_MS) {
    ctx.gap = gap;
    console.log(`\n  [L2/${gap}ms]`);
    await snapshotRateLimit(ctx, `L2-${gap}`, seq++, 'before');
    for (let i = 1; i <= L2_REQUESTS_PER_GAP; i += 1) {
      await mutate(ctx, `L2-${gap}`, seq++, !ctx.star, `${i}/${L2_REQUESTS_PER_GAP}`);
    }
    // 级末对账：盲交替可能因漂移而错位，这里读一次校正（不计变异）
    const actual = await readStarState(ctx, `L2-${gap}`, seq++, 'reconcile');
    if (actual !== null) ctx.star = actual;
    await snapshotRateLimit(ctx, `L2-${gap}`, seq++, 'after');
    await sleep(ctx.quiet);
  }
  ctx.gap = savedGap;
}

/* ---------------- 止损与恢复（§4.6） ---------------- */

async function recover(ctx, haltKind, row) {
  console.log(`\n⛔ 停止：${haltKind}${row ? `（HTTP ${row.http_status}，request-id ${row.request_id}）` : ''}`);
  console.log('§4.6 止损流程：立即停止一切请求（含 GET /rate_limit 与 /user/starred）');

  if (haltKind === 'permission-denied') {
    console.log('· 判定：权限 403（body 含 Resource not accessible）—— 与限流无关，本轮数据作废。');
    console.log('· 处置：改换 classic PAT（scope repo）；不要继续实验。');
    return;
  }
  if (haltKind === 'cap') {
    console.log('· 判定：达到变异请求硬上限，正常收尾。');
    return;
  }

  const body = row ? String(row.body_sample || '') : '';
  let waitMs = 60_000;
  if (row && row.retry_after && Number(row.retry_after) > 0) waitMs = Number(row.retry_after) * 1000;
  else if (row && row.remaining === 0 && row.reset) waitMs = Math.max(0, row.reset * 1000 - Date.now());

  let attempt = 0;
  let recovered = false;
  while (attempt < BACKOFF_MS.length) {
    const w = attempt === 0 ? waitMs : BACKOFF_MS[attempt];
    console.log(`· 等待 ${Math.round(w / 1000)}s 后做 1 次恢复探测（第 ${attempt + 1}/${BACKOFF_MS.length} 次）…`);
    await sleep(w);
    const r = await request(ctx, {
      method: 'GET',
      url: `${API}/user/starred/${ctx.owner}/${ctx.repo}`,
      phase: 'RECOVER',
      seq: ctx.seq(),
      requestKind: 'read',
      note: `recovery probe #${attempt + 1}`,
    });
    if (r.row.http_status === 204 || r.row.http_status === 404) {
      recovered = true;
      ctx.star = r.row.http_status === 204;
      console.log(`· 已恢复（HTTP ${r.row.http_status}）`);
      break;
    }
    console.log(`· 仍被拒（HTTP ${r.row.http_status}），继续退避`);
    attempt += 1;
  }
  if (!recovered) {
    console.log('· 3 次退避后仍未恢复 → 终止实验，记录「未能验证恢复时间」，24 小时内不再重试。');
    if (/secondary rate limit/i.test(body)) {
      console.log('· 注意：这属于 §4.8 D12（恢复时间远大于 60s）＝更严厉的滥用防护，立即停止全部实验。');
    }
  }
}

/* ---------------- 收尾：净状态校验 ---------------- */

async function verifyNetZero(ctx) {
  const actual = await readStarState(ctx, 'FINAL', ctx.seq(), 'net-zero check');
  const ok = actual === ctx.s0;
  console.log(`\n[净状态校验] S0=${ctx.s0 ? 'starred' : 'unstarred'} → 结束=${actual === null ? '不可判定' : actual ? 'starred' : 'unstarred'} → ${ok ? '✅ 一致' : '❌ 不一致'}`);
  if (!ok) {
    console.log('· 请在网页 UI 手动把该仓库改回基线状态（1 次操作），不要在脚本里连续重试。');
  }
  return ok;
}

/* ---------------- 计划打印 ---------------- */

function printPlan(opts, tokenSource) {
  const l1 = L1_REQUESTS;
  const l2 = L2_GAPS_MS.length * L2_REQUESTS_PER_GAP;
  const willRunL2 = opts.levels.includes('L2');
  const planned = L1_REQUESTS + (willRunL2 ? l2 : 0);
  console.log('════════ REST 变异请求限流实测 · 计划 ════════');
  console.log(`模式            ${opts.run ? '🔴 --run（会真的发请求）' : '🟢 --dry-run（零网络请求）'}`);
  console.log(`测试仓库        ${opts.repoId ? `ID ${opts.repoId}` : opts.repo || '（未指定：--repo-id <id> 或 --repo <owner/name>）'}`);
  console.log(`凭证来源        ${tokenSource}`);
  console.log(`执行级别        ${opts.levels.join(', ')}`);
  console.log(`L1              ${l1} 次 × ${opts.gap}ms（先读后写）`);
  console.log(`L2              ${willRunL2 ? `每级 ${L2_REQUESTS_PER_GAP} 次 × 间隔 [${L2_GAPS_MS.join(', ')}]ms（盲交替）` : '未启用'}`);
  console.log(`计划变异请求数  ${planned}（硬上限 ${opts.maxMutating}）`);
  console.log(`级间静默        ${Math.round(opts.quiet / 1000)}s（L2 每级之间）`);
  console.log(`输出            ${opts.run ? path.resolve(opts.out) : '（dry-run 不写文件）'}`);
  console.log('');
  console.log('硬约束（协议 §4.7）：');
  console.log('  · 只对自有仓库（仓库 owner.id == token 账号 id）');
  console.log('  · 凭证只用 classic/OAuth（scope 含 repo/public_repo）；fine-grained 会被拒绝');
  console.log('  · 严格串行、无并发（并发本身是二级限流的第一触发条件）');
  console.log(`  · 变异请求 ≤ ${HARD_MAX_MUTATING} 次；净状态不变（S0 → S0）`);
  console.log('  · 任一次 403/429 立即整轮停止（含 GET），退避 60→120→240s，≤3 次');
  console.log('');
  console.log('判定口径（§4.8）：');
  console.log('  D1  全 204 且 used 每请求 +1        → primary 按请求数计；5 点表不作用于 primary');
  console.log('  D2  全 204 且 used 每 PUT +5        → 与官方文档冲突，需 ≥2 轮复现后才下结论');
  console.log('  D3  used 增量为 0 或负              → 多区域计数抖动，差分法不可用（只作定性）');
  console.log('  D5  L2 全 204 且累计 ≤60 次         → 未观测到二级限流（与 900 点/分钟一致）');
  console.log('  D6  403 body 含 secondary rate limit → **主问题答案**：star 端点会触发二级限流，且头不可作判据');
  console.log('  D9  403 body 含 Resource not accessible → 权限问题，非限流，该轮作废');
  console.log('  D14 全程 204 但 resource ≠ core     → 请求打到非预期资源族，数据作废');
  console.log('');
  console.log('环境须告知（报告里必须写）：出口 IP 类别（家宽/公司/VPN/云主机）；走 VPN 或云主机时不做 L2。');
  console.log('前提：先关闭 GithubStarManager 自身的自动同步与一切会打 api.github.com 的工具（否则 used 增量被污染）。');
  console.log('═══════════════════════════════════════════');
}

/* ---------------- 主流程 ---------------- */

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return;
  }

  // 上限不可被 CLI 抬高（硬约束）
  if (!Number.isFinite(opts.maxMutating) || opts.maxMutating <= 0) opts.maxMutating = HARD_MAX_MUTATING;
  if (opts.maxMutating > HARD_MAX_MUTATING) {
    console.error(`拒绝：--max-mutating ${opts.maxMutating} 超过协议硬上限 ${HARD_MAX_MUTATING}。`);
    process.exit(2);
  }
  for (const lv of opts.levels) {
    if (!['L0', 'L1', 'L2'].includes(lv)) {
      console.error(`拒绝：未知级别 ${lv}（只接受 L0/L1/L2）。`);
      process.exit(2);
    }
  }

  const tokenFile = opts.tokenFile || process.env.GITHUB_PROBE_TOKEN_FILE || '';
  const tokenSource = tokenFile
    ? `文件 ${path.resolve(tokenFile)}`
    : process.env.GITHUB_PROBE_TOKEN
      ? '环境变量 GITHUB_PROBE_TOKEN'
      : '（未提供：--token-file <path> 或 GITHUB_PROBE_TOKEN）';

  printPlan(opts, tokenSource);

  if (!opts.run) {
    console.log('\n🟢 dry-run 结束：未发出任何网络请求。加 --run 才会真的执行。');
    return;
  }

  /* ---- --run：先过全部闸门，再发第一个请求 ---- */

  if ((!opts.repoId && !opts.repo) || (opts.repoId && !/^[1-9]\d*$/.test(opts.repoId)) ||
      (opts.repo && !/^[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+$/.test(opts.repo))) {
    console.error('\n拒绝：请提供合法 --repo-id <id> 或 --repo <owner/name>。');
    process.exit(2);
  }
  const [owner = '', repo = ''] = opts.repo.split('/');
  if (repo === '.' || repo === '..') {
    console.error('\n拒绝：--repo 格式应为 <owner/name>。');
    process.exit(2);
  }

  let token = '';
  if (tokenFile) {
    if (!fs.existsSync(tokenFile)) {
      console.error(`\n拒绝：token 文件不存在 ${path.resolve(tokenFile)}`);
      process.exit(2);
    }
    token = fs.readFileSync(tokenFile, 'utf8').trim();
  } else {
    token = String(process.env.GITHUB_PROBE_TOKEN || '').trim();
  }
  if (!token) {
    console.error('\n拒绝：未提供 token（--token-file <path> 或 GITHUB_PROBE_TOKEN）。');
    process.exit(2);
  }
  if (token.startsWith('github_pat_')) {
    console.error('\n拒绝：这是 fine-grained PAT。实测必须用 classic PAT（scope repo）——见 docs/adr/0004。');
    process.exit(2);
  }

  const ctx = {
    repoId: opts.repoId,
    token,
    owner,
    repo,
    gap: opts.gap,
    maxMutating: opts.maxMutating,
    quiet: opts.quiet,
    mutating: 0,
    star: null,
    s0: null,
    login: '',
    scopes: null,
    rec: makeRecorder(opts.out),
    _seq: 0,
    seq() {
      this._seq += 1;
      return this._seq;
    },
  };

  let haltKind = null;
  let haltRow = null;
  let fatal = null;

  try {
    await preflight(ctx);
    console.log(`\n[P0] 目标仓库 ${ctx.owner}/${ctx.repo}（ID ${ctx.repoId}）｜间隔 ${ctx.gap}ms｜硬上限 ${ctx.maxMutating}`);
    await snapshotRateLimit(ctx, 'P0', ctx.seq(), 'start');

    if (opts.levels.includes('L0')) await runL0(ctx);
    if (opts.levels.includes('L1')) await runL1(ctx);
    if (opts.levels.includes('L2')) {
      if (ctx.mutating >= ctx.maxMutating) {
        console.log('\n[L2] 跳过：已达变异请求硬上限');
      } else {
        console.log(`\n[级间静默] ${Math.round(ctx.quiet / 1000)}s（§4.2 L1→L2）`);
        await sleep(ctx.quiet);
        await runL2(ctx);
      }
    }
  } catch (err) {
    if (err instanceof Halt) {
      haltKind = err.kind;
      haltRow = ctx.rec.last(); // 触发本次终止的那条记录（供 §4.6 恢复流程读 retry-after / body）
      fatal = err;
    } else {
      fatal = err;
    }
  }

  if (haltKind && RATE_LIMIT_HALTS.has(haltKind)) {
    try {
      await recover(ctx, haltKind, haltRow);
    } catch (e) {
      console.error('恢复流程本身出错：', e);
    }
  } else if (haltKind === 'cap') {
    console.log('\n· 已达变异请求硬上限，正常收尾（非异常）。');
  } else if (haltKind) {
    console.log(`\n⛔ 非限流终止（${haltKind}）：${fatal instanceof Error ? fatal.message : ''}`);
    console.log('· 未进入退避流程（§4.6 只针对 403/429）。请手动确认仓库 star 状态已回到基线。');
  } else if (fatal) {
    console.log(`\n⛔ 异常终止：${fatal instanceof Error ? fatal.message : String(fatal)}`);
    console.log('· 请手动确认仓库 star 状态已回到基线。');
  }

  // 只在**未**命中限流类终止时做净状态校验：限流后继续发请求违反 §4.6 第 1 条（应等退避完再探测）
  let netZero = null;
  if (!(haltKind && RATE_LIMIT_HALTS.has(haltKind))) {
    try {
      netZero = await verifyNetZero(ctx);
    } catch (e) {
      console.warn('净状态校验未能完成：', e instanceof Error ? e.message : e);
    }
  }

  const summary = {
    kind: 'summary',
    local_time: nowIso(),
    repo: `${owner}/${repo}`,
    login: ctx.login,
    scopes: ctx.scopes,
    levels: opts.levels,
    gap_ms: opts.gap,
    mutating_requests: ctx.mutating,
    max_mutating: ctx.maxMutating,
    baseline_star: ctx.s0,
    final_star: ctx.star,
    net_zero: netZero,
    halt: haltKind,
    halt_message: fatal instanceof Error ? fatal.message : fatal ? String(fatal) : null,
    records: ctx.rec.count,
    out: path.resolve(opts.out),
  };
  ctx.rec.push(summary);
  ctx.rec.close();

  console.log('\n════════ 结果摘要 ════════');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\n原始记录：${path.resolve(opts.out)}（${ctx.rec.count} 行）`);
  console.log('下一步：据 §4.8 判定矩阵写结论到 docs/research-ratelimit-measurement.md。');
}

main().catch((err) => {
  console.error('探针异常退出：', err);
  process.exit(1);
});
