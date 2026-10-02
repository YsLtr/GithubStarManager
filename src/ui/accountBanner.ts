// Token 归属不符的警告横幅（4.11.0）。判定在 accountGuard.ts，本模块只管**呈现与关闭**。
//
// 为什么是独立节点、独立 class（不复用 .gsm-setup-banner）：
//   `.gsm-setup-banner` 出现在四条撤除路径上（横幅内联保存后 remove、Token 保存回调、
//   同步成功后 remove、viewTeardown 第 3 项）。身份不符**不会**因为「保存了新 token」
//   或「同步成功」而消失 —— 复用那个类名会被这些路径静默删掉，且再也没有重建时机。
//
// 为什么落位委托给 index.ts（setAccountBannerPlacer）：
//   落位规则（Lists 槽位 vs 网格列顶）与 `placeSetupBanner` 是同一套，重写一份必然漂移；
//   而 index.ts 反向 import 本模块，直接 import 会成环 ⇒ 走注册回调（同 setTokenSavedHandler 惯例）。
//
// 文案口径（D13）：只讲**后果**，不出现「网页端点 / 浏览器登录会话 / GitHub-Verified-Fetch / REST」
//   等通道实现词 —— 与 writeFailureMessage 同源，也不推翻 ADR 0006「静默分派不向用户披露通道」的裁定。

import { STORAGE_KEYS } from '../constants';
import { gmGet, gmSet } from '../gm';
import { accountPairKey, evaluateAccountMatch, type AccountVerdict } from '../accountGuard';
import { currentGeneration } from '../lifecycle';
import { openClassicTokenCreator } from '../tokenConfig';
import { isDesktop } from '../utils';
/** 落位回调：由 index.ts 用 placeSetupBanner 实现；返回 false = 找不到宿主（不留下游离节点） */
type BannerPlacer = (bar: HTMLElement) => boolean;
/** 打开既有 Token 配置面板（index.ts 的 showSetupBanner） */
type OpenTokenConfig = () => void;

let placer: BannerPlacer | null = null;
let openTokenConfig: OpenTokenConfig | null = null;

export function setAccountBannerPlacer(fn: BannerPlacer | null): void {
  placer = fn;
}

export function setOpenTokenConfigHandler(fn: OpenTokenConfig | null): void {
  openTokenConfig = fn;
}

/** 当前节点上记录的「哪一对账号」——组合变化时重建文案，避免显示过期的登录名 */
const PAIR_ATTR = 'data-gsm-account-pair';

function isDismissed(verdict: AccountVerdict): boolean {
  const key = accountPairKey(verdict);
  if (!key) return false; // 取不到 id ⇒ 关闭态无从记录，于是每次都弹（宁可重复也不静默）
  return gmGet<string>(STORAGE_KEYS.accountBannerDismissed, '') === key;
}

/**
 * 文案：把「数据来自谁 / 操作记到谁」讲清楚，并给出两条可执行出路。
 *
 * **必须按写通道分叉**（审查 P1-2）：写路径是静默分派的，两种凭证的落点**不一样** ——
 *   · classic / OAuth（`ghp_` / `gho_`）→ 走 REST ⇒ 落到 **token 主人**；
 *   · fine-grained / 无 classic → 走网页端点 ⇒ 落到 **浏览器登录者**。
 * 无条件断言「加星会记到浏览器登录账号」在 classic 场景下是错的，会把用户引向无收益的换号操作 ——
 * 而误报正是本功能最需要避免的东西（ADR 0007）。
 *
 * 但 classic 分支也**不能反向断言「一定记到 token 主人」**：REST 被 403（非限速）拒绝且存在登录会话时，
 * `setStarState` 会回落网页端点，那一次写落在登录者名下。故 classic 分支措辞为「通常 + 回落路径」。
 */
function bannerMessage(verdict: AccountVerdict): string {
  const tokenWho = verdict.tokenLogin || `另一个账号（id ${verdict.tokenId || '未知'}）`;
  const sessionWho = verdict.sessionLogin || `当前账号（id ${verdict.sessionId || '未知'}）`;
  const head = `⚠️ Token 归属与当前登录不一致：Token 属于 @${tokenWho}，而浏览器登录的是 @${sessionWho}。`;
  if (verdict.writeTarget === 'token') {
    // classic / OAuth：REST 通道的账号 = token 主人。但**不能断言「一定」**——`setStarState`
    // 在 REST 返回 403（非限速）**且**存在登录会话时会回落网页端点，那一次写就落到登录者名下
    // （实测证据：DELETE /user/starred/... → 403 后紧跟 POST /{o}/{r}/unstar，
    //  见 .diag/assert-account-fallback.js）。故这里说「通常」，并把回落这条真实路径写出来。
    return (
      head +
      `列表里的星标数据取自 @${tokenWho}，加星 / 取消星通常也记到 @${tokenWho}（不会改动 @${sessionWho}），` +
      `但你正在 @${sessionWho} 的 Stars 页面上操作，容易看错账号。` +
      `若 @${tokenWho} 的 Token 被 GitHub 拒绝，操作会改以 @${sessionWho} 的身份进行。` +
      '请换成与当前登录匹配的 Token，或改用 Token 所属的账号登录。'
    );
  }
  // fine-grained / 无 classic 凭证：写只走会话通道（`setStarState` 在有会话时**不会**再试 REST，
  // 失败也不跨通道回落）⇒ 落点是确定的，可以直说。
  return (
    head +
    `列表里的星标数据取自 @${tokenWho}，但在这里加星 / 取消星会记录到 @${sessionWho}，两边会不一致。` +
    '请换成与当前登录匹配的 Token，或改用 Token 所属的账号登录。'
  );
}

/** 撤掉本模块建的所有横幅节点（幂等） */
function removeExisting(): void {
  document.querySelectorAll('.gsm-account-banner').forEach((el) => el.remove());
}

/**
 * Hide Lists 开关切换后重挂（与 `repositionSetupBanner` 同一触发点）。
 * 不重挂的话：横幅落在 Lists 槽位时，用户关掉「隐藏 Lists」会让原生 Lists 内容在原位冒出来、
 * 而横幅仍紧贴在其上方（同一个落位函数、同一个槽位，却不跟随重挂 —— 与既有 🟡-1 口径不一致）。
 */
export function repositionAccountBanner(): void {
  const bar = document.querySelector<HTMLElement>('.gsm-account-banner');
  if (!bar || !placer) return;
  if (!placer(bar)) bar.remove(); // 宿主没了就别留游离节点
}

/**
 * 建并落位警告横幅。幂等：同「一对账号」已显示则不动；组合已变则重建。
 * 已知关闭态（同一对账号被用户关过）则不显示。
 */
function showAccountBanner(verdict: AccountVerdict): void {
  const pair = accountPairKey(verdict) || '';
  const existing = document.querySelector<HTMLElement>('.gsm-account-banner');
  if (existing && existing.getAttribute(PAIR_ATTR) === pair) return;
  // 已被用户关过的那一对账号：不打扰，但**必须顺手撤掉可能残留的另一对横幅**。
  // 否则「不符(42#999) → 关闭 → 换 token(77#999) → 换回 42」会让屏上停在 77#999 的横幅上，
  // 宣称「Token 属于 @other-user」而当前 token 主人是 @tokenuser（第二轮审查 P2-1，实测）。
  // 注意顺序：同 pair 的幂等早退必须在前，否则每次求值都会重建节点。
  if (isDismissed(verdict)) {
    removeExisting();
    return;
  }
  if (!placer) return; // 未注册落位（非 Stars 流程）⇒ 不建节点

  removeExisting();

  const bar = document.createElement('div');
  bar.className = 'gsm-account-banner';
  bar.setAttribute(PAIR_ATTR, pair);
  bar.setAttribute('role', 'alert');

  const msg = document.createElement('span');
  msg.className = 'gsm-account-msg';
  msg.textContent = bannerMessage(verdict); // textContent：登录名来自 API/DOM，绝不拼 innerHTML

  const getToken = document.createElement('button');
  getToken.className = 'btn btn-primary';
  getToken.type = 'button';
  getToken.textContent = '获取匹配的 Token（classic）';
  getToken.addEventListener('click', () => {
    openClassicTokenCreator();
    openTokenConfig?.(); // 顺带把粘贴行露出来，省一次点击
  });

  const openConfig = document.createElement('button');
  openConfig.className = 'btn';
  openConfig.type = 'button';
  openConfig.textContent = '打开 Token 配置';
  openConfig.addEventListener('click', () => openTokenConfig?.());

  const dismiss = document.createElement('button');
  dismiss.className = 'btn gsm-account-dismiss';
  dismiss.type = 'button';
  dismiss.textContent = '关闭';
  dismiss.title = '关闭这条提示（换 Token 或换登录账号后会再次提醒）';
  dismiss.addEventListener('click', () => {
    const key = accountPairKey(verdict);
    // 关闭态持久化：同一对账号不再打扰；组合一变立刻重新武装
    if (key) gmSet(STORAGE_KEYS.accountBannerDismissed, key);
    bar.remove();
  });

  // DOM 顺序铁律（D11）：动作按钮按 append 顺序落位，不要先 appendChild 再统一 append
  bar.append(msg, getToken, openConfig, dismiss);

  if (!placer(bar)) bar.remove();
}

/**
 * 求值 → 呈现的唯一起点，三个求值点全部调它（fire-and-forget，绝不进入同步关键路径）。
 * 相符时**主动撤掉**可能已过期的横幅（例如另一标签页换了 Token 后这里刚同步完）；
 * unknown 时什么都不做 —— 判定失败不得当作「相符」而抹掉已显示的警告。
 */
export function mountAccountGuard(): void {
  // 延迟返回时**必须复判**（审查 P1-1）：求值在途期间可能已经收窄视口（teardown 跑完）或又发生过一轮转换。
  // 世代号挡「这一轮已经过去了」，视口门挡「窄视口一个节点都不该有」（D18）—— 缺一不可，
  // 否则慢网下一次 `GET /user` 就能在手机上凭空建出 `role="alert"` 的完整样式横幅。
  const gen = currentGeneration();
  void evaluateAccountMatch()
    .then((verdict) => {
      if (gen !== currentGeneration()) return;
      if (!isDesktop()) return;
      if (verdict.state === 'mismatch') {
        showAccountBanner(verdict);
        return;
      }
      // 相符 → 撤掉可能已过期的横幅（例如另一标签页换了 Token 后这里刚同步完）；
      // 确定没配 token → 横幅前提已消失，同样撤掉。
      // 其余 unknown（有 token 但取不到身份 / 请求失败）**什么都不做** —— 判定失败不得抹掉已显示的警告。
      if (verdict.state === 'match' || !verdict.hasToken) removeExisting();
    })
    // 呈现层自己出错绝不能变成 unhandled rejection（三个调用点都在别人的 finally / 回调里）
    .catch((err: unknown) => console.warn('[github-star-manager] 归属警告渲染失败', err));
}
