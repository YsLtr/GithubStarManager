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
//   C 无 token → 本期不判定（归属字段 4.18.0 起已记入 stars_full_sync_meta.accountId，但**只写不判**，
//     要做那条告警时才读它；见 AGENTS.md 已知风险「无 token + 有登录会话」条目）
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

import { getTokenIdentitySync, resolveTokenIdentity } from './storage/accountIdentity';
import { getViewerId, getViewerLogin } from './pageScope';
import { getToken, isClassicCredential } from './tokenConfig';
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



/* 4.12.0：`getViewerId()` / `getSessionLogin()` 已上移到 `pageScope.ts`。
 *
 * 两处都需要「登录者是谁」：本模块（比对 token 归属）与只读模式的归属判定（pageScope 的
 * getStarsPageScope）。按 D21「没有硬理由就别留第二份」合并到 pageScope 单一真相，
 * 这里只 import —— **不要**在本地再写一份读 `octolytics-actor-id` 的实现。
 *
 * 字段语义与实测矩阵见 pageScope.ts 的模块头注释。 */


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
  // 浏览器侧身份必须取**登录者**的 actor-id，不是页面主人（见 pageScope.ts 的字段语义与实测矩阵）
  const sessionId = getViewerId();
  if (!sessionId) return unknown(true); // 取不到登录者 id（GHES / meta 变更）→ 静默降级
  if (!hasWebSession()) return unknown(true); // 组合 B：写路径只在 token 上，无错号风险

  const sessionLogin = getViewerLogin();
  // classic / OAuth 走 REST ⇒ 写落到 token 主人；fine-grained 或无 classic 时走会话 ⇒ 落到登录者。
  // 文案必须据此分叉：否则 classic 场景下会断言一个**不成立**的后果（审查 P1-2）。
  const writeTarget: 'token' | 'session' = isClassicCredential(token) ? 'token' : 'session';
  // 身份查询与指纹缓存在 storage/accountIdentity（4.18.0 抽出，唯一实现）：命中缓存 = 零请求。
  const cached = getTokenIdentitySync(token);
  if (cached) return decide(cached, sessionId, sessionLogin, writeTarget);

  const res = await resolveTokenIdentity(token);
  if (!res.ok) return unknown(true); // 401 已由它上报失效链；其余失败一律静默降级
  return decide(res.identity, sessionId, sessionLogin, writeTarget);
}

/** 单飞：求值点可能在同一帧触发（4.18.0 起共五处，见 bannerMessage 上方注释所在模块的挂载点），共用同一次判定与同一次网络请求 */
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
