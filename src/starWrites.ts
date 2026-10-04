// 写路径抽象（4.9.0）：把「加星 / 取消星」这一个动作抽象成**与通道无关**的一次调用。
//
// 通道由本模块**静默分派**（ADR 0006），调用方与用户都不感知走了哪条：
//   1. 有 classic PAT / OAuth token（`ghp_` / `gho_`，scope 体系）→ REST
//      `PUT`/`DELETE https://api.github.com/user/starred/{owner}/{repo}`（返回 204）；
//   2. 无这样的 token，**或** REST 返回 fine-grained 的权限 403（`Resource not accessible
//      by personal access token`）→ 网页端点 `POST https://github.com/{owner}/{repo}/star`
//      （`/unstar`），用浏览器登录会话认证 —— **与 token 类型无关**，这是 fine-grained 用户
//      获得写能力的唯一现实手段；
//   3. 两者都不可用 → `no-credential`，由调用方给出「需要配置 Token 或登录 github.com」。
//
// 网页端点的关键事实（来源：docs/research-web-star-endpoints.md §3.5 三组对照实测，
// A=`X-Fetch-Nonce`+VF→200、B=**仅 VF**→200、C=两者皆无→422；决定性变量是 VF）：
// - 凭据 = Cookie 会话 + `GitHub-Verified-Fetch: true`。**不发** `X-Fetch-Nonce`、
//   **不发** `X-GitHub-Client-Version`；
// - `authenticity_token` 是 **per-form** 且与 action+method 绑定（stars 页实测 60 表单 60 唯一值），
//   故**离页仓库**（批量恢复：目标仓库不在当前 DOM 内）不走「先 GET 取 token」——只带 VF 即可；
//   仅当 VF 返回 422（CSRF 失败）才回退去取真实 token 重发**一次**（ADR 0006 / 决策 D24）；
// - 成功判定 = `resp.ok`（200），**不用** `{"count":"N"}`——那是仓库 star 总数的事后快照
//   （实测 278→277→278），不是本次动作的增量，且同名 `count` 在 watch 端点返回 `{count:"1"}`；
// - 422 = Rails CSRF 失败，**响应体是 HTML**（即便带了 `Accept: application/json`）
//   → 解析必须 `text()` 后再 `try { JSON.parse }`；
// - 失败**不自动重试**、不静默吞掉（ADR 0006「静默分派 ≠ 静默失败」）。

import { isClassicCredential } from './tokenConfig';
import { getUserLogin } from './pageScope';

type StarWriteVia = 'rest' | 'web';

type StarWriteFailure =
  | 'no-credential' // 既无 classic/OAuth token，也无登录会话
  | 'unauthorized' // 401：token 失效
  | 'permission-denied' // 403 非限速：权限不足
  | 'rate-limited' // 403/429：限流（含次级）
  | 'not-found' // 404：仓库不存在或无权访问
  | 'requires-classic' // fine-grained token 写他人公开仓库（GitHub 先天拒绝）且无登录会话可回落
  | 'csrf-failed' // 网页端点 422：CSRF 校验失败
  | 'network' // 网络层错误
  | 'unknown';

interface StarWriteOk {
  ok: true;
  via: StarWriteVia;
}

interface StarWriteErr {
  ok: false;
  reason: StarWriteFailure;
  /** HTTP 状态码（网络错误时为 0） */
  status: number;
  /** 失败细节，只进控制台，不给用户看（用户只看 message） */
  detail?: string;
}

export type StarWriteOutcome = StarWriteOk | StarWriteErr;

/**
 * 用户可见文案：**结果导向**，不出现「网页端点 / 浏览器会话 / GitHub-Verified-Fetch」
 * 之类的通道实现细节（ADR 0006「不向用户披露通道」）。
 */
export function writeFailureMessage(reason: StarWriteFailure, status: number): string {
  switch (reason) {
    case 'no-credential':
      return '需要配置 GitHub Token，或先登录 github.com。';
    case 'unauthorized':
      return 'Token 已失效或在别处被撤销，请重新配置。';
    case 'permission-denied':
      return '权限不足：当前 Token 不能改这个仓库的星标。';
    case 'rate-limited':
      return '请求过于频繁，已暂停。请稍后再试。';
    case 'not-found':
      return '仓库不存在，或当前账号无权访问。';
    case 'requires-classic':
      return '当前 Token 改不了这个仓库的星标（fine-grained 对他人公开仓库只读）。请改用 classic Token，或先登录 github.com 再试。';
    case 'csrf-failed':
      // 4.9.0 起没有「取页面 token 重发」的回退（实测仓库页无表单，见 webWrite 注释）→
      // 刷新页面只在「当前页正好有该仓库表单」时有意义，故同时给出真正可行的出路。
      return 'GitHub 拒绝了这次操作。请刷新页面后重试；若仍失败，请配置 classic Token。';
    case 'network':
      return '网络错误，请检查网络后重试。';
    default:
      return `操作失败（HTTP ${status}）`;
  }
}

/* ---------------- 会话与专有名词 ---------------- */

/**
 * 是否处于已登录 github.com 会话。**双重判据**：
 * `body.logged-in` **且** `meta[name="user-login"]` 的 content 非空串
 * （只看 meta 是否存在是错的——未登录时该 meta 可能以空串存在）。
 *
 * meta 那一腿走 `pageScope.getUserLogin()`（**不带** `octolytics-actor-login` 回退）：
 * 「登录者是谁」全仓只有 `pageScope.ts` 一份实现（D27）；带回归属校验与展示用的回退会
 * 放宽本判据 ⇒ 没真会话时也去试网页端点写。
 * `form[action$="/unstar"]` 不能当登录判据（它只说明该仓库已 star）。
 */
export function hasWebSession(): boolean {
  const body = document.body;
  if (!body || !body.classList.contains('logged-in')) return false;
  return getUserLogin() !== '';
}

/** 网页端点的 form action：**精确**匹配（`$="/star"` 会被 `/unstar` 命中，不能用后缀选择器） */
function formAction(fullName: string, wantStar: boolean): string {
  return `/${fullName}/${wantStar ? 'star' : 'unstar'}`;
}

/** 页面上是否已有该仓库的对应表单（有则读它的真实 token，比 VF 更「正当」且免费） */
function findOnPageForm(fullName: string, wantStar: boolean): HTMLFormElement | null {
  const action = formAction(fullName, wantStar);
  return document.querySelector<HTMLFormElement>(`form[action="${action}"]`);
}

/* ---------------- REST 通道 ---------------- */

function hasRateLimitSignal(resp: Response, bodyText: string): boolean {
  return (
    !!resp.headers.get('retry-after') ||
    resp.headers.get('x-ratelimit-remaining') === '0' ||
    /secondary rate limit/i.test(bodyText)
  );
}

async function restWrite(pat: string, fullName: string, wantStar: boolean): Promise<StarWriteOutcome> {
  const [owner, repo] = fullName.split('/');
  const url = `https://api.github.com/user/starred/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: wantStar ? 'PUT' : 'DELETE',
      headers: {
        Authorization: `Bearer ${pat}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } catch (err) {
    return { ok: false, reason: 'network', status: 0, detail: String(err) };
  }
  // 204 = 成功；304 官方列在可能状态码里但未说明触发条件，保守当成功（ADR 0003 之外的既有权衡）
  if (resp.status === 204 || resp.status === 304) return { ok: true, via: 'rest' };

  if (resp.status === 401) return { ok: false, reason: 'unauthorized', status: 401 };
  if (resp.status === 403 || resp.status === 429) {
    let text = '';
    try {
      text = await resp.text();
    } catch {
      /* 读体失败不影响限流判定 */
    }
    if (hasRateLimitSignal(resp, text)) {
      return { ok: false, reason: 'rate-limited', status: resp.status, detail: text.slice(0, 200) };
    }
    return { ok: false, reason: 'permission-denied', status: resp.status, detail: text.slice(0, 200) };
  }
  if (resp.status === 404) return { ok: false, reason: 'not-found', status: 404 };
  return { ok: false, reason: 'unknown', status: resp.status };
}

/* ---------------- 网页通道 ---------------- */

/** 86 字符占位 token：§3.5 组 B 的实测形态就是「multipart body 带 authenticity_token 字段
 * （值不参与校验，VF 头替代校验）+ 带 VF 头」。长度对齐实测的 86。 */
function placeholderToken(): string {
  const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
  const bytes = new Uint8Array(86);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/** 网页端点请求之间的极短等待（不用于限流，限流由 mutationQueue 统一管） */
const sleep = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));

/**
 * 方向复核：页面上是否已出现「相反方向」的表单。
 * 给一次 400ms 的重试窗口 —— POST 之后 GitHub 可能晚一个 hydration tick 才换掉表单，
 * 只查一次会把「成功但渲染稍慢」误判成失败。
 */
async function directionFlipped(fullName: string, wantStar: boolean): Promise<boolean> {
  for (let i = 0; i < 2; i += 1) {
    if (findOnPageForm(fullName, !wantStar)) return true;
    if (i === 0) await sleep(400);
  }
  return false;
}

/** 离页仓库的请求体：无真实 token 可用（per-form 且不可跨 action 复用），靠 VF 头过校验 */
function offPageBody(): FormData {
  const fd = new FormData();
  fd.append('authenticity_token', placeholderToken());
  // context 是场景相关值（stars 页实测 `user_stars`、repo 页 `repository`）；恢复的条目都来自
  // stars 页的取关，故用 `user_stars`。服务端是否据此分支未能查证 → 原样带上不硬编码别的值。
  fd.append('context', 'user_stars');
  return fd;
}

/**
 * 网页写路径（4.9.0）。
 *
 * **不设 422 回退**（2026-10-01 真机实测推翻原设计，见 ADR 0006「未确证项」）：
 * 原设计是「422 → GET 仓库页 → 取该页 form 的 per-form token → 重发一次」，实测该仓库页
 * （`GET /{owner}/{repo}`，HTTP 200、339 KB）**一个 `<form>` 都没有**（React 全客户端渲染），
 * 故该回退必然拿不到 token、纯属死码。唯一真实存在 per-form token 的地方是**原生 stars 列表页
 * 的服务端渲染**（实测 64 表单：30 star + 30 unstar，且仅覆盖当页仓库），而「恢复」场景的仓库
 * 按定义不在 stars 列表里 —— 用 1.1 MB 的 HTML 换极少能救回的场景，不如明确失败。
 *
 * 因此降级只剩两级：**页面有该仓库表单 → 用它的真实 token；否则仅带 VF 头**。两者都失败就报错。
 */
async function webWrite(
  fullName: string,
  wantStar: boolean,
  tokenOverride?: string,
): Promise<StarWriteOutcome> {
  const action = formAction(fullName, wantStar);
  const form = tokenOverride ? null : findOnPageForm(fullName, wantStar);
  let body: FormData;
  if (tokenOverride) {
    body = new FormData();
    body.append('authenticity_token', tokenOverride);
    body.append('context', 'user_stars');
  } else if (form) {
    // 单条场景：表单就在页面上，直接用它的真实 token（免费且比 VF 更正当）
    body = new FormData(form);
  } else {
    body = offPageBody();
  }

  let resp: Response;
  try {
    resp = await fetch(form ? form.action : action, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'GitHub-Verified-Fetch': 'true',
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json',
      },
      body,
    });
  } catch (err) {
    return { ok: false, reason: 'network', status: 0, detail: String(err) };
  }

  // 422 的响应体是 HTML（即便带 Accept: application/json）→ 一律 text() 后再试 JSON.parse
  let text = '';
  try {
    text = await resp.text();
  } catch {
    /* 读体失败：状态码仍可判定 */
  }
  const json = (() => {
    try {
      return JSON.parse(text || 'null') as unknown;
    } catch {
      return null;
    }
  })();

  if (resp.ok) {
    // 成功判定（ADR 0006）：`resp.ok`（200）**并**在页面存在该仓库表单时复核方向已翻转。
    // 表单不在页面上时（网格视图的卡片、离页恢复）无从复核，只能以 200 为准 —— 该局限
    // 已明文记在 ADR 0006；不用 `{"count":"N"}` 是因为它是仓库 star 总数的事后快照，不是增量。
    if (form && !(await directionFlipped(fullName, wantStar))) {
      return { ok: false, reason: 'unknown', status: 200, detail: 'HTTP 200 但页面表单方向未翻转' };
    }
    return { ok: true, via: 'web' };
  }

  const detail = `HTTP ${resp.status}｜json=${json === null ? 'no' : 'yes'}｜${text.slice(0, 200)}`;
  if (resp.status === 422) return { ok: false, reason: 'csrf-failed', status: 422, detail };
  if (resp.status === 401) return { ok: false, reason: 'unauthorized', status: 401, detail };
  if (resp.status === 403 || resp.status === 429) {
    if (hasRateLimitSignal(resp, text)) return { ok: false, reason: 'rate-limited', status: resp.status, detail };
    return { ok: false, reason: 'permission-denied', status: resp.status, detail };
  }
  if (resp.status === 404) return { ok: false, reason: 'not-found', status: 404, detail };
  return { ok: false, reason: 'unknown', status: resp.status, detail };
}

/* ---------------- 静默分派 ---------------- */

/**
 * 改变某个仓库的星标状态。**静默分派通道**，返回归一化结果（不抛错）。
 * 调用方只需处理 `ok` / `reason`，不需要知道走的是 REST 还是网页端点。
 */
export async function setStarState(
  patOrEmpty: string,
  fullName: string,
  wantStar: boolean,
): Promise<StarWriteOutcome> {
  const parts = fullName.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    // 严格两段：`a/b/c` 若被 split 后静默取前两段，会指向**另一个仓库**——宁可拒绝
    return { ok: false, reason: 'not-found', status: 0, detail: `非法仓库名：${fullName}` };
  }
  if (patOrEmpty && isClassicCredential(patOrEmpty)) {
    const r = await restWrite(patOrEmpty, fullName, wantStar);
    if (r.ok) return r;
    // fine-grained 之外的权限 403 也可以试网页路径：会话是另一套凭据，可能仍然可用
    if (r.reason === 'permission-denied' && hasWebSession()) {
      console.warn('[github-star-manager] REST 写被拒（权限），改用浏览器会话路径重试');
      return webWrite(fullName, wantStar);
    }
    return r;
  }
  // 无 token，或 token 是 fine-grained（写他人公开仓库必被拒，直接走会话路径，省一次无谓请求）
  if (hasWebSession()) return webWrite(fullName, wantStar);
  if (!patOrEmpty) return { ok: false, reason: 'no-credential', status: 0 };
  // 有 fine-grained token 但无登录会话：REST 值得一试（仓库属于本人时它其实能写）
  const r = await restWrite(patOrEmpty, fullName, wantStar);
  if (r.ok) return r;
  // fine-grained + 无登录会话：REST 被 GitHub 先天拒绝，且没有回落通道 → 必须说清是「token 类型」
  // 问题而不是「没配 token」（后者会让已配 token 的用户一头雾水）
  return r.reason === 'permission-denied'
    ? { ok: false, reason: 'requires-classic', status: r.status, detail: r.detail }
    : r;
}
