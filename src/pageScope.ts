/**
 * 页面归属判定（4.12.0）：回答「当前这个 stars 列表页是谁的」。
 *
 * ## 为什么需要
 *
 * 脚本原先只用 URL 判定是否接管页面（`?tab=stars`，见 boot.ts 的 isStarsPage），**不看这是谁的页**。
 * 于是打开他人的 stars 页也会被接管，而数据层是**全局单份**的（`stars_repo_cache` 与账号无关）：
 *   - 在别人的页面上画出**我自己的** star 列表，并把对方的原生列表整段隐藏；
 *   - 卡片星按钮的实心/空心来自缓存字段 `unstarredAt`（`ui/cards.ts`），与页面主人无关
 *     ⇒ 出现「我没 star 过的仓库显示成实心黄星」；
 *   - 标签/备注按**页面主人** id 隔离 ⇒ 在他人页上读写的是**对方**的命名空间。
 *
 * ## 身份字段（真机实测，证据见 .pi/tmp/research-other-user-stars-page.md §2.1）
 *
 * | 字段 | 语义 | 本人页 | 他人页 |
 * |---|---|---|---|
 * | `octolytics-actor-id` | **登录者**数字 id | 130123551 | 130123551 |
 * | `octolytics-dimension-user_id` | **页面主人**数字 id | 130123551 | 10111 (mattn) |
 * | `user-login` / `octolytics-actor-login` | 登录者 login（登出时前者存在但为空串） | YsLtr | YsLtr |
 * | `octolytics-dimension-user_login` | 页面主人 login | YsLtr | mattn |
 *
 * 这些 meta **无官方契约**（同类前例：`meta[name=csrf-token]` 曾在 github.com 普遍存在，如今已完全消失）
 * ⇒ 取不到就判 `unknown`，**既不冒充自己的页，也不误报**（降级方向与 ADR 0007 一致）。
 *
 * ## 分层
 *
 * 本模块只读 DOM / URL：**不建节点、不发请求、不写存储**（纯判定）。
 * 装饰层在 `readonly.ts`，UI 层在 `ui/*`。
 */

import { isStarsPage } from './boot';

/** 归属三态。**不用布尔**：「判定不出来」必须与「确定是别人的」区分开（虽然当前两者同样只读）。 */
type StarsScope = 'own' | 'other' | 'unknown';

/** 新版「我的 stars」页：`/stars`（无登录名段，故必须登录才认得出是自己的） */
const NEW_STARS_SELF = /^\/stars\/?$/;
/** 新版他人 stars 页：`/stars/{login}`（实测 200；该路由上**没有** dimension-* 元数据，只能靠路径段） */
const NEW_STARS_USER = /^\/stars\/([^/]+)\/?$/;

/** `/stars/{login}` 上的页面主人 login（路径段）；非该路由返回 '' */
function ownerLoginFromPath(): string {
  const m = NEW_STARS_USER.exec(location.pathname);
  return m ? decodeURIComponent(m[1]) : '';
}

/** 读一个 meta 的 content 并 trim。刻意**不**用 `instanceof HTMLMetaElement`：该判定在无 DOM 的
 *  环境（Node 下的纯逻辑测试，见 tests/exportImport）会 ReferenceError，而这里只需要一个字符串。 */
function metaContent(name: string): string {
  const meta = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  const raw = meta?.content;
  return typeof raw === 'string' ? raw.trim() : '';
}

/** 登录者数字 id（`octolytics-actor-id`）。取不到返回 '' —— **不**回退到 dimension-*（那是页面主人）。 */
export function getViewerId(): string {
  return metaContent('octolytics-actor-id');
}

/** 登录者 login（`user-login` 优先，回退 `octolytics-actor-login`）。登出时为空串。 */
export function getViewerLogin(): string {
  return metaContent('user-login') || metaContent('octolytics-actor-login');
}

/** 页面主人数字 id（`octolytics-dimension-user_id`）。`/stars/{login}` 路由上不存在。 */
function getPageOwnerId(): string {
  return metaContent('octolytics-dimension-user_id');
}

/** 页面主人 login（`octolytics-dimension-user_login`，回退 `/stars/{login}` 的路径段）。 */
export function getPageOwnerLogin(): string {
  return metaContent('octolytics-dimension-user_login') || ownerLoginFromPath();
}

/**
 * 是否「stars 列表页」——脚本可能接管的三种 URL 形态（实测见 research §6.1）：
 *   1. `/{login}?tab=stars`（传统 profile 标签页，`page=N` **被忽略**、真实翻页是 after/before 游标）
 *   2. `/stars`（本人新版页）
 *   3. `/stars/{login}`（他人新版页）
 * 注意 `/{login}/stars` 是 404，**不**匹配。
 */
export function isStarsListingPage(): boolean {
  if (isStarsPage()) return true;
  return NEW_STARS_SELF.test(location.pathname) || NEW_STARS_USER.test(location.pathname);
}

/**
 * 当前 stars 列表页的归属。
 *
 * 非 stars 列表页返回 `'own'` —— 语义是「不需要拦」，调用方应先判 isStarsListingPage()。
 *
 * 判定顺序（数字 id 优先，login 只作兜底）：
 *   - `/stars`：有会话即 `own`（无登录名段可比），否则 `unknown`；
 *   - `/stars/{login}`：路径段与登录者 login 比对（该路由没有 dimension-* 元数据）；
 *   - `?tab=stars`：两侧 id 都在则比 id；退到 login；登录者侧完全缺失（登出）而页面主人可得 ⇒ `other`；
 *     两侧都取不到 ⇒ `unknown`。
 *
 * **不做**任何「取不到就当自己的」回退：误判成 `own` 的代价是「在别人页面上画出我的星标 + 提供写入口」。
 */
export function getStarsPageScope(): StarsScope {
  if (!isStarsListingPage()) return 'own';

  const viewerId = getViewerId();
  const viewerLogin = getViewerLogin();
  const hasSession = !!viewerId || !!viewerLogin;

  if (NEW_STARS_SELF.test(location.pathname)) {
    return hasSession ? 'own' : 'unknown';
  }

  const ownerFromPath = ownerLoginFromPath();
  if (ownerFromPath) {
    // 无登录名可比（登出）⇒ 页面不可能是「我的」（我根本没登录）
    if (!viewerLogin) return 'other';
    return ownerFromPath.toLowerCase() === viewerLogin.toLowerCase() ? 'own' : 'other';
  }

  const ownerId = getPageOwnerId();
  const ownerLogin = getPageOwnerLogin();

  if (ownerId && viewerId) return ownerId === viewerId ? 'own' : 'other';
  if (ownerLogin && viewerLogin) {
    return ownerLogin.toLowerCase() === viewerLogin.toLowerCase() ? 'own' : 'other';
  }
  if (!hasSession && (ownerId || ownerLogin)) return 'other';
  return 'unknown';
}
