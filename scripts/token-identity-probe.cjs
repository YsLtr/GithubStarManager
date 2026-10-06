#!/usr/bin/env node
/**
 * token 身份探针：`GET /user` 能不能拿到数字 id（= 4.18.0 归属解析的地基）。
 *
 * 回答的问题：**这份凭证属于哪个账号**、以及**这个端点是否可用/需不需要权限**。
 * 结论与依据见 `docs/research-finegrained-getuser.md`（含官方原文取证：GET /user 的 fine-grained
 * 小节明文 "The fine-grained token does not require any permissions."）与 `docs/adr/0007`。
 *
 * 安全不变量（缺一不可）：
 *   1. 只发**一个只读**请求（`GET /user`），不改动任何远端状态；
 *   2. 凭证只从 `--token-file` 或环境变量读，**绝不打印 token**（只打印前 11 字符 + 长度级别的指纹前缀）；
 *   3. **默认 dry-run：零网络请求**，真的发请求必须显式 `--run`。
 *
 * 用法：
 *   node scripts/token-identity-probe.cjs --token-file ~/.pat            # 打印计划（不发请求）
 *   node scripts/token-identity-probe.cjs --token-file ~/.pat --run      # 实际探测
 *   GITHUB_PAT=... node scripts/token-identity-probe.cjs --run           # 或走环境变量
 *
 * 退出码：0 = 探测成功且拿到 id；1 = 调用/解析失败；2 = 用法错误；3 = dry-run（未发请求）。
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const API = 'https://api.github.com/user';

function parseArgs(argv) {
  const out = { run: false, tokenFile: '', token: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--run') out.run = true;
    else if (a === '--token-file') out.tokenFile = argv[++i] || '';
    else if (a === '--token') out.token = argv[++i] || '';
    else if (a === '-h' || a === '--help') out.help = true;
    else {
      console.error(`未知参数：${a}`);
      process.exit(2);
    }
  }
  return out;
}

/** 读凭证；来源优先级：--token > --token-file > GITHUB_PAT / GH_TOKEN。**不打印内容**。 */
function readToken(args) {
  if (args.token) return args.token.trim();
  if (args.tokenFile) {
    const p = args.tokenFile.startsWith('~')
      ? path.join(os.homedir(), args.tokenFile.slice(1))
      : args.tokenFile;
    if (!fs.existsSync(p)) {
      console.error(`凭证文件不存在：${p}`);
      process.exit(2);
    }
    return fs.readFileSync(p, 'utf8').trim();
  }
  return (process.env.GITHUB_PAT || process.env.GH_TOKEN || '').trim();
}

/** 凭证类型的粗判（只看前缀，不打印凭证） */
function kindOf(tok) {
  if (tok.startsWith('github_pat_')) return 'fine-grained';
  if (tok.startsWith('ghp_')) return 'classic PAT';
  if (tok.startsWith('gho_')) return 'OAuth (gho_)';
  return '未知前缀（仍会尝试）';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('用法：node scripts/token-identity-probe.cjs [--token-file <path> | --token <tok>] [--run]');
    return 2;
  }

  const tok = readToken(args);
  if (!tok) {
    console.error('没有凭证：用 --token-file / --token / GITHUB_PAT 之一提供。');
    return 2;
  }

  console.log('计划：GET %s', API);
  console.log('  凭证：%s…（%s，共 %d 字符；不打印全文）', tok.slice(0, 11), kindOf(tok), tok.length);
  console.log('  本请求是只读的；只发 1 次；不修改任何远端状态。');

  if (!args.run) {
    console.log('\n[dry-run] 未发任何请求。确认无误后加 --run。');
    return 3;
  }

  const started = Date.now();
  let resp;
  try {
    resp = await fetch(API, {
      headers: { Authorization: `Bearer ${tok}`, 'X-GitHub-Api-Version': '2022-11-28' },
    });
  } catch (err) {
    console.error('网络层失败：', err && err.message);
    return 1;
  }
  const body = await resp.text();
  let data = null;
  try {
    data = JSON.parse(body);
  } catch {
    /* 保留 body 供下面打印片段 */
  }

  const id = data && (typeof data.id === 'number' || typeof data.id === 'string') ? String(data.id) : '';
  console.log('\n结果：');
  console.log('  HTTP %d（%d ms）', resp.status, Date.now() - started);
  console.log('  id      : %s', id ? `${id}（类型 ${typeof data.id}，官方明文 durable user ID）` : '（缺失）');
  console.log('  login   : %s', (data && data.login) || '（缺失）');
  console.log('  额度     : remaining=%s limit=%s', resp.headers.get('x-ratelimit-remaining'), resp.headers.get('x-ratelimit-limit'));
  if (!resp.ok && data && data.message) console.log('  message : %s', data.message);
  if (!resp.ok) console.log('  响应片段 : %s', body.slice(0, 200));

  if (resp.ok && id) {
    console.log('\n判定：该凭证可以调 GET /user并拿到账号 id ⇒ 归属解析（accountIdentity）对该类型凭证可用。');
    return 0;
  }
  if (resp.status === 401) console.log('\n判定：401 = 凭证失效/撤销（与归属无关），换一份凭证再测。');
  else console.log('\n判定：未拿到 id（见上面状态与 message）。403 需先排除权限与限流，详见 docs/research-finegrained-getuser.md。');
  return 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error('探针自身异常：', err);
    process.exit(1);
  }
);
