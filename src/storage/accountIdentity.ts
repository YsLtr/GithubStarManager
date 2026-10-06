/**
 * token 身份（= 数据归属账号）—— 4.18.0 新增。
 *
 * ## 为什么需要它
 *
 * 风险 21：标签 / 备注 / 宽限期备份原先按**页面登录者**（`octolytics-actor-id`）隔离，而屏幕上的
 * stars 列表由 `GET /user/starred`（带 token）决定 ⇒ 配错 token 时「屏幕上是 A 的列表、标签却记在
 * B 名下」。修法是让归属跟 **token 账号**走，于是需要一处「这个 token 属于谁」的**同步**查询。
 *
 * ## 分层与依赖
 *
 * 本模块是**叶子**：只依赖 `constants` / `gm` / `tokenConfig`（后者只依赖 constants + gm）。
 * **不要**让它 import `accountGuard`（那会把网络 + 失效上报 + starWrites 拖进存储层的依赖闭包，
 * 见 D9 的分层铁律与 tests/exportImport 的依赖闭包清单）。
 * `accountGuard.ts` 反过来 import 本模块（`fingerprint` / `getTokenIdentitySync` / `rememberTokenIdentity` /
 * `resolveTokenIdentity`），实现只有一处。
 *
 * ## 身份缓存不是安全边界
 *
 * `STORAGE_KEYS.accountIdentity` 是「**曾经见过这份凭证**」的本地缓存（键 = 凭证指纹，值 = `{ id, login }`），
 * 只用于免掉重复的 `GET /user`。能读写 GM 存储的人可以改它 ⇒ **归属 id 可被伪造**。
 * 因此任何**判定类**用途都不得把它当作可信证据（本脚本的判定用途只有展示与归属说明，且会同步复算）。
 *
 * ## 实测依据（2026-10-06 真机）
 *
 * 零权限 fine-grained PAT 调 `GET /user` **可以**拿到 `id`（两张官方权限表均未收录该端点，
 * 属文档空白而非能力缺口）。故 classic 与 fine-grained 走同一条身份解析路径，不需要 unknown 兜底分支。
 * 证据：`docs/research-finegrained-getuser.md`、`.pi/tmp/risk21-research.md` §3。
 */
import { STORAGE_KEYS } from '../constants';
import { gmGet, gmSet } from '../gm';
import { detectTokenKind, notifyTokenIssue } from '../tokenConfig';

/** token 所属账号的最小身份（数字 `id` 是官方明文「durable user ID」，`login` 可改、只作展示） */
export interface TokenIdentity {
  id: string;
  login: string;
}

/** 凭证指纹 → token 身份。**不存 token 明文**（只存哈希与数字 ID） */
interface IdentityCache {
  [fingerprint: string]: TokenIdentity;
}

/**
 * 凭证指纹：内联 FNV-1a（32 位）。
 * 刻意**不用 `crypto.subtle.digest`**：它要求 secure context，且在脚本沙箱里的可用性未经验证
 * （仓库现有先例只有无条件可用的 `crypto.getRandomValues`，见 starWrites.ts 的 placeholderToken）。
 * 本指纹只用于「这份凭证是否已经查过」的本地缓存命中，不承担安全职责 —— 碰撞的后果仅是
 * 复用一次同凭证的结论或少发一次请求。
 */
export function fingerprint(token: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i += 1) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * **同步**取这份 token 的身份：命中指纹缓存即返回，否则 `null`。
 * 纯查表 —— 零网络、零写入。存储层的归属解析（`getStorageUserId`）只能用它。
 */
export function getTokenIdentitySync(token: string): TokenIdentity | null {
  if (!token) return null;
  const cache = gmGet<IdentityCache>(STORAGE_KEYS.accountIdentity, {});
  return cache[fingerprint(token)] ?? null;
}

/** 记下一份凭证的身份（**只在成功拿到身份后调用**；失败留下的空条目会让下次求值点跳过重试） */
export function rememberTokenIdentity(token: string, identity: TokenIdentity): void {
  if (!token) return;
  const fp = fingerprint(token);
  const cache = gmGet<IdentityCache>(STORAGE_KEYS.accountIdentity, {});
  gmSet(STORAGE_KEYS.accountIdentity, { ...cache, [fp]: identity });
}

/** 网络解析的结果。`dead` = 401（token 失效，另走失效上报链）；`unknown` = 其余一切失败（临时性） */
export type TokenIdentityResult =
  | { ok: true; identity: TokenIdentity }
  | { ok: false; reason: 'dead' | 'unknown' };

/**
 * 取 token 身份（`GET /user`）。**唯一**的网络身份解析实现，`accountGuard` 也用它。
 *
 * 401 = token 失效/撤销，那是**另一件事**（不是归属不符）⇒ 走既有的失效上报链（由它打开配置横幅），
 * 本函数返回 `dead`；403/429/5xx/网络失败一律返回 `unknown`。**只有成功才写缓存**。
 */
export async function resolveTokenIdentity(token: string): Promise<TokenIdentityResult> {
  let resp: Response;
  try {
    resp = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } catch (err) {
    console.warn('[github-star-manager] 取 token 身份失败（网络层）', err);
    return { ok: false, reason: 'unknown' };
  }

  if (resp.status === 401) {
    notifyTokenIssue('401 Bad credentials：Token 已失效或被撤销');
    return { ok: false, reason: 'dead' };
  }
  if (!resp.ok) {
    console.warn(`[github-star-manager] 取 token 身份失败（HTTP ${resp.status}）`);
    return { ok: false, reason: 'unknown' };
  }

  try {
    const data = (await resp.json()) as { id?: unknown; login?: unknown };
    const id = typeof data.id === 'number' ? String(data.id) : typeof data.id === 'string' ? data.id : '';
    if (!id) return { ok: false, reason: 'unknown' };
    const identity: TokenIdentity = { id, login: typeof data.login === 'string' ? data.login : '' };
    rememberTokenIdentity(token, identity);
    return { ok: true, identity };
  } catch (err) {
    console.warn('[github-star-manager] 解析 token 身份响应失败', err);
    return { ok: false, reason: 'unknown' };
  }
}

/** 保存 token 的结果（调用方据此给提示；`kind` 仅用于日志文案） */
export interface TokenSaveOutcome {
  result: 'saved' | 'saved-unverified' | 'cleared' | 'invalid' | 'dead';
  kind: string | null;
}

/**
 * **token 的唯一写入点**（4.18.0 起：`tokenConfig.saveToken` / `starCheck.promptForToken` /
 * 配置面板内联保存三处全部改走这里）。
 *
 * 顺序不可颠倒：**先写身份、再写 token**（`resolveTokenIdentity` 内部已 `rememberTokenIdentity`）。
 * 于是「token 存在」通常也蕴含「它的身份已知」（唯一例外是下面的 `saved-unverified` 分支：
 * 保存时确认失败仍落库 token，身份留空）⇒ `getStorageUserId()` 的读路径只需查表 —— 这正是
 * 「id 与 token 绑定」的落点（此前身份只在页面渲染时被动填充，组合 B 下永不填充）。
 *
 * `dead`（401）：既已上报失效链，就不必保存一个死 token。
 * `unknown`（网络 / 5xx / 429）：**仍然保存**、身份留空。取舍见方案 §7-3：身份查询能力已实测对两类
 * 凭证都可用，走到这一支只意味**临时性故障**；拒绝保存会把一次网络抖动变成「用户存的 token 没了」。
 */
export async function setTokenVerified(raw: string): Promise<TokenSaveOutcome> {
  const tok = raw.trim();
  if (!tok) {
    gmSet(STORAGE_KEYS.githubPat, '');
    return { result: 'cleared', kind: null };
  }
  const kind = detectTokenKind(tok);
  if (!kind) return { result: 'invalid', kind: null };

  const res = await resolveTokenIdentity(tok);
  if (res.ok) {
    gmSet(STORAGE_KEYS.githubPat, tok);
    return { result: 'saved', kind };
  }
  if (res.reason === 'dead') return { result: 'dead', kind };

  gmSet(STORAGE_KEYS.githubPat, tok);
  console.warn(
    '[github-star-manager] 未能确认 Token 所属账号（临时故障），已保存 token。'
    + '本次归属暂按当前登录账号处理；若该账号不是 Token 的主人，标签/备注/宽限期备份会暂存在登录者的命名空间下，'
    + '下次加载身份确认成功后会切到 Token 账号（此窗口内写的数据不会自动搬过去）。'
  );
  return { result: 'saved-unverified', kind };
}

