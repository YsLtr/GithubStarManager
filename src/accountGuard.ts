// Token 归属校验（4.11.0）：回答「脚本持有的 token 属于哪个账号，浏览器当前登录的是哪个账号」。
//
// 为什么需要它：写路径是**静默分派**的（ADR 0006）——
//   - 有 classic / OAuth token → REST 写，落到 **token 主人**的账号；
//   - 无这样的 token（或 fine-grained 被 403）→ 网页端点写，落到 **浏览器登录者**的账号（starWrites.ts:294-317）。
// 两侧不一致时，网格里的星标数据（来自 token 的 GET /user/starred）与写操作的目标账号不是同一个，
// 且方向恰好相反：显示「已 star」→ 点击发的是 unstar。4.10.0 及之前全库**没有任何一处**比对它们。
//
// 分层铁律（同 exportImport）：本模块只做判定与缓存 —— 网络、存储、读 DOM meta。
// **不建节点、不弹 UI**（那是 ui/accountBanner.ts），也**不改写路径**（ADR 0006 的静默分派不动）。
//
// 判定矩阵（只在一个组合下判定，其余一律 unknown 静默降级）：
//   A 有 token + 有登录会话 + 两侧数字 id 都取到 → 比对，不符才是 mismatch
//   B 有 token + 无登录会话 → 写路径只有 REST、账号由 token 唯一决定 ⇒ 无错号风险，不判定
//   C 无 token → 本期不判定（缓存归属不记录，见 AGENTS.md D25 的已知风险条目）
//   任一侧取不到（meta 缺失 / GHES 改版 / 请求失败）→ unknown，**既不冒充「相符」也不误报「不符」**
//
// 比对键是**数字 id**，不是 login：官方明文 login 可随时间改名、id 持久
// （https://docs.github.com/en/rest/users/users）。用 login 会在用户改名后产生**永久误报**，
// 而长期常驻的误报比漏报更伤害这套 UI 的可信度。
//
// 事实依据（联网查证，证据见 docs/adr/0007 与 .pi/tmp/research-token-identity.md）：
//   - GET /user 对 fine-grained PAT **不需要任何权限**（官方端点页原文），classic 无 scope 也能认证成功
//     ⇒ 两类已支持凭证都拿得到身份，不存在权限缺口；
//   - 官方汇总页 endpoints-available-for-fine-grained-personal-access-tokens **漏列** GET /user，
//     但该页只收录「需要权限」的端点（两组反例交叉验证）⇒ 漏列 ≠ 不可用；
//   - 该请求在 primary 限流下按**请求数**计 1（「1 点/5 点」表属 secondary，不作用于 primary）。
//     指纹缓存命中后稳态零请求，故本功能不消耗可见额度。

import { STORAGE_KEYS } from './constants';
import { gmGet, gmSet } from './gm';
import { getToken, isClassicCredential, notifyTokenIssue } from './tokenConfig';
import { hasWebSession } from './starWrites';
import { isDesktop } from './utils';

/** 三态判定结果。**不 export**：唯一消费者是同模块的 `AccountVerdict.state`（口径同 D21「删多余 export」） */
type AccountMatch = 'match' | 'mismatch' | 'unknown';

export interface AccountVerdict {
  state: AccountMatch;
  /**
   * 是否持有 token。**唯一用途**是区分「确定没配 token」（横幅的前提已消失 ⇒ 可以撤掉它）
   * 与「有 token 但取不到身份 / 判定失败」（`unknown` 不得抹掉已显示的警告）。
   */
  hasToken: boolean;
  /**
   * 有 token 时，写操作实际落到谁名下：classic / OAuth 凭证走 REST ⇒ 落到 token 主人（`token`）；
   * 否则走会话 ⇒ 落到浏览器登录者（`session`）。文案据此分叉 —— 见 ADR 0007 的凭证表。
   */
  writeTarget?: 'token' | 'session';
  /** 以下四个字段只在能取到时才有值（用于文案与关闭态键，**不参与判定**） */
  tokenId?: string;
  sessionId?: string;
  tokenLogin?: string;
  sessionLogin?: string;
}

/** 凭证指纹 → token 身份。**不存 token 明文**（只存哈希与数字 ID） */
interface IdentityCache {
  [fingerprint: string]: { id: string; login: string };
}

/**
 * 凭证指纹：内联 FNV-1a（32 位）。
 * 刻意**不用 `crypto.subtle.digest`**：它要求 secure context，且在脚本沙箱里的可用性未经验证
 * （仓库现有先例只有无条件可用的 `crypto.getRandomValues`，见 starWrites.ts 的 placeholderToken）。
 * 本指纹只用于「这份凭证是否已经查过」的本地缓存命中，不承担安全职责 —— 碰撞的后果仅是
 * 复用一次同凭证的结论或少发一次请求。
 */
function fingerprint(token: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i += 1) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * 页面 meta 里的**登录者**（viewer）身份。`src/` 此前只有 `getStarsUserId()`，而它取的是**页面主人**。
 *
 * 实测（登录态真机、只读同源 fetch，见 `.diag/probe-viewer-id.js`）：
 *
 * | 字段 | 自己的页 `/YsLtr?tab=stars` | 他人页 `/mattn?tab=stars` | 语义 |
 * |---|---|---|---|
 * | `user-login` | YsLtr | **YsLtr** | 登录者 login |
 * | `octolytics-actor-id` / `-login` | 130123551 / YsLtr | **130123551 / YsLtr** | **登录者** id / login |
 * | `octolytics-dimension-user_id` / `-login` | 130123551 / YsLtr | **10111 / mattn** | **页面主人** id / login |
 *
 * ⇒ 比对用的「浏览器侧身份」必须取 **`octolytics-actor-id`**。第一版误用了
 * `octolytics-dimension-user_id`（经 `getStarsUserId()`），于是打开任何他人的 stars 页都会把**页面主人**
 * 当登录者，产生假阳性 + 错误引导（「浏览器登录的是 @mattn」）。
 *
 * 取不到 actor-id 时**不回退**到 dimension-*（那是页面主人，回退等于恢复假阳性），一律返回 null ⇒ 判 unknown
 * （功能静默失效，符合 ADR 0007 的降级方向）。
 */
function getViewerId(): string | null {
  const meta = document.querySelector('meta[name="octolytics-actor-id"]');
  const id = meta instanceof HTMLMetaElement ? meta.content.trim() : '';
  return id || null;
}

/** 页面 meta 里的登录者登录名（文案用；`user-login` 优先，回退 actor-login）。取不到返回 '' 仅影响文案 */
function getSessionLogin(): string {
  for (const name of ['user-login', 'octolytics-actor-login']) {
    const meta = document.querySelector(`meta[name="${name}"]`);
    const v = meta instanceof HTMLMetaElement ? meta.content.trim() : '';
    if (v) return v;
  }
  return '';
}

/** 取 token 身份。任何失败都返回 null（= unknown），**不写缓存**，故下个求值点会自然重试 */
async function fetchTokenIdentity(token: string): Promise<{ id: string; login: string } | null> {
  let resp: Response;
  try {
    resp = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } catch (err) {
    console.warn('[github-star-manager] 归属校验：取 token 身份失败（网络层）', err);
    return null;
  }

  // 401 = token 失效/撤销，那是**另一件事**（不是归属不符）→ 走既有的失效上报链，
  // 由它打开配置横幅；本模块只是返回 unknown。403/429 不当作 token 问题（可能是限流）。
  if (resp.status === 401) {
    notifyTokenIssue('401 Bad credentials：Token 已失效或被撤销');
    return null;
  }
  if (!resp.ok) {
    console.warn(`[github-star-manager] 归属校验：取 token 身份失败（HTTP ${resp.status}）`);
    return null;
  }

  try {
    const data = (await resp.json()) as { id?: unknown; login?: unknown };
    const id = typeof data.id === 'number' ? String(data.id) : typeof data.id === 'string' ? data.id : '';
    if (!id) return null;
    return { id, login: typeof data.login === 'string' ? data.login : '' };
  } catch (err) {
    console.warn('[github-star-manager] 归属校验：解析 token 身份响应失败', err);
    return null;
  }
}

function decide(
  identity: { id: string; login: string },
  sessionId: string,
  sessionLogin: string,
  writeTarget: 'token' | 'session',
): AccountVerdict {
  const shared = {
    hasToken: true,
    writeTarget,
    tokenId: identity.id,
    sessionId,
    tokenLogin: identity.login,
    sessionLogin,
  } as const;
  if (identity.id === sessionId) return { state: 'match', ...shared };
  return { state: 'mismatch', ...shared };
}

/** 无法判定：`hasToken` 决定调用方**是否允许**撤掉已显示的警告（见字段注释） */
function unknown(hasToken: boolean): AccountVerdict {
  return { state: 'unknown', hasToken };
}

async function run(): Promise<AccountVerdict> {
  const token = getToken();
  if (!token) return unknown(false); // 组合 C：无 token ⇒ 横幅前提消失（可撤）；本期不判定
  // 浏览器侧身份必须取**登录者**的 actor-id，不是页面主人（见 getViewerId 注释与实测表）
  const sessionId = getViewerId();
  if (!sessionId) return unknown(true); // 取不到登录者 id（GHES / meta 变更）→ 静默降级
  if (!hasWebSession()) return unknown(true); // 组合 B：写路径只在 token 上，无错号风险

  const sessionLogin = getSessionLogin();
  // classic / OAuth 走 REST ⇒ 写落到 token 主人；fine-grained 或无 classic 时走会话 ⇒ 落到登录者。
  // 文案必须据此分叉：否则 classic 场景下会断言一个**不成立**的后果（审查 P1-2）。
  const writeTarget: 'token' | 'session' = isClassicCredential(token) ? 'token' : 'session';
  const fp = fingerprint(token);
  const cache = gmGet<IdentityCache>(STORAGE_KEYS.accountIdentity, {});
  const cached = cache[fp];
  if (cached) return decide(cached, sessionId, sessionLogin, writeTarget); // 命中 = 零请求

  const identity = await fetchTokenIdentity(token);
  if (!identity) return unknown(true);
  // 只在成功时写缓存：失败留下的空条目会让下次求值点跳过重试
  gmSet(STORAGE_KEYS.accountIdentity, { ...cache, [fp]: identity });
  return decide(identity, sessionId, sessionLogin, writeTarget);
}

/** 单飞：三个求值点可能在同一帧触发，共用同一次判定与同一次网络请求 */
let inflight: Promise<AccountVerdict> | null = null;

/**
 * 唯一入口。幂等、可并发安全调用，**不抛错**（一切异常都归到 unknown）。
 * 窄视口立即返回 unknown（不建节点、不发请求）—— 与 showSetupBanner 的视口门同位同口径。
 */
export function evaluateAccountMatch(): Promise<AccountVerdict> {
  if (!isDesktop()) {
    console.log('[github-star-manager] 窄视口：跳过 Token 归属校验（不显示任何脚本 UI）');
    return Promise.resolve(unknown(true));
  }
  if (inflight) return inflight;
  inflight = run()
    .catch((err: unknown) => {
      console.error('[github-star-manager] 归属校验执行失败', err);
      // hasToken=true 是保守取值：判定失败**不得**让调用方撤掉已显示的警告
      return unknown(true);
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** 关闭态键的取值：`<tokenId>#<sessionId>`；两侧任一缺失则返回 null（关闭态无从记录，于是每次都弹） */
export function accountPairKey(verdict: AccountVerdict): string | null {
  if (!verdict.tokenId || !verdict.sessionId) return null;
  return `${verdict.tokenId}#${verdict.sessionId}`;
}
