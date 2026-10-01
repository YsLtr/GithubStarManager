// 快捷 Token 配置与失效上报（4.0.1 引入；4.0.2 起失效走初始化面板，不再居中弹窗）。
//
// 快捷获取（4.9.0 起**两条深链都给**，并在 UI 说明二者区别；用户裁定）：
// - classic（推荐给写操作）：`/settings/tokens/new?scopes=repo&description=…`。
//   **注意**：官方文档只列了 fine-grained 的预填参数，`?scopes=` 属社区实测（dev.to 2024-08），
//   真机点过一次验证；若不生效则退化为只开创建页并在 UI 写明「请在 Scopes 勾选 repo」。
//   scope 取 `repo` 而非 `public_repo`：`public_repo` 不覆盖私有仓库，会让私有仓库的 star
//   不出现在 GET /user/starred 里而被整表 diff 误判为外部取关（ADR 0004 后果）。
// - fine-grained：GitHub 2025-08-26 起支持 Template URL（query 预填 name/description/
//   expires_in/<permission>，write 含 read），`starring=write` 一键带出最小权限。
//   它**读**够用、**写他人公开仓库必被拒**（ADR 0004）——但网页写路径会静默接管（ADR 0006），
//   故仍接受配置。
// 来源：
// - https://github.blog/changelog/2025-08-26-template-urls-for-fine-grained-pats-and-updated-permissions-ui/
// - https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
//
// 失效判定（官方 troubleshooting）：401 = Bad credentials（失效/撤销）→ 上报初始化面板；
// 403 必须先排除限速（retry-after 或 x-ratelimit-remaining:0），剩下的才是权限不足。
// https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api
//
// 独立成模块的原因：starCheck → filters → ui/cards 构成导入链，失效上报若放
// starCheck，cards 调它会形成循环导入；本模块只依赖 constants/gm。

import { STORAGE_KEYS } from './constants';
import { gmGet, gmOpenInTab, gmSet } from './gm';

export type TokenKind = 'classic' | 'fine-grained';

/**
 * 前缀 → 凭证类型。
 * - `github_pat_` = fine-grained（写他人公开仓库必被 GitHub 拒，ADR 0004）；
 * - `ghp_` = classic PAT、`gho_` = OAuth app user token —— 两者同属 **scope 体系**，
 *   对写路径等价（ADR 0004「OAuth app user token」段），故都归 classic。
 * - GitHub App token（`ghu_`/`ghs_`）**刻意不认**：官方 OpenAPI 对该端点标
 *   `enabledForGitHubApps: false`，收下只会给用户假的期望。
 */
export function detectTokenKind(tok: string): TokenKind | null {
  if (tok.startsWith('github_pat_')) return 'fine-grained';
  if (tok.startsWith('ghp_') || tok.startsWith('gho_')) return 'classic';
  return null;
}

/** 写路径可用凭证：classic PAT 与 OAuth app token（scope 体系）——fine-grained 不在其列 */
export function isClassicCredential(tok: string): boolean {
  return detectTokenKind(tok) === 'classic';
}

/** 已保存的 PAT（GM 层保证该键不落 localStorage 镜像）；'' = 未配置 */
export function getToken(): string {
  return gmGet<string>(STORAGE_KEYS.githubPat, '') || '';
}

/** fine-grained 官方 Template URL：starring=write 覆盖读列表+加星/去星（预填参数官方有文档） */
export const TOKEN_TEMPLATE_URL =
  'https://github.com/settings/personal-access-tokens/new' +
  '?name=GithubStarManager' +
  '&description=GithubStarManager%20userscript%20-%20Account%20permission%3A%20Starring%20write' +
  '&expires_in=90' +
  '&starring=write';

/**
 * classic PAT 深链（4.9.0 新增）：`?scopes=` 预填官方文档**未列**，来源为社区实测，
 * 真机验证过一次；失效时用户仍能在该页手动勾选 `repo`。
 * scope 取 `repo`：见文件头「为什么不取 public_repo」。
 */
export const TOKEN_CLASSIC_URL =
  'https://github.com/settings/tokens/new' +
  '?scopes=repo' +
  '&description=GithubStarManager';

/**
 * 两条深链的能力差异（用户裁定：配置 UI 必须说明区别）。
 * 文案只说**结果**，不提写通道实现（ADR 0006「不向用户披露通道」）。
 */
export const TOKEN_KIND_HELP =
  'classic（ghp_，或 gh oauth 的 gho_）：读写都走官方 REST，可 star/unstar 任意公开仓库。' +
  'fine-grained（github_pat_）：读列表够用，但 GitHub 不允许它 star/unstar 别人的公开仓库。';

/** 打开预填好的 fine-grained 创建页：走 gmOpenInTab（TM 菜单回调无用户激活，裸 window.open 会被弹窗拦截静默吞掉） */
export function openTokenCreator(): void {
  gmOpenInTab(TOKEN_TEMPLATE_URL);
}

/** 打开预填好的 classic 创建页（同上，必须走 gmOpenInTab） */
export function openClassicTokenCreator(): void {
  gmOpenInTab(TOKEN_CLASSIC_URL);
}

/** 前缀校验后写入 GM（敏感键由 gm 层保证不落 localStorage 镜像）；null = 前缀不合法未保存 */
export function saveToken(raw: string): TokenKind | null {
  const tok = raw.trim();
  const kind = detectTokenKind(tok);
  if (!kind) return null;
  gmSet(STORAGE_KEYS.githubPat, tok);
  return kind;
}

type SavedHandler = () => void;
let savedHandler: SavedHandler | null = null;

/** index.ts 注册：任一入口保存成功 → 撤配置横幅 + 自动全量同步 */
export function setTokenSavedHandler(fn: SavedHandler | null): void {
  savedHandler = fn;
}

/** 保存成功通知（横幅内联 / 失效弹窗 / TM 菜单 prompt 共用） */
export function notifyTokenSaved(): void {
  savedHandler?.();
}

/** 点击手势内从剪贴板读 token 填入；被权限拒绝则聚焦输入框提示手动 Ctrl+V */
export async function pasteFromClipboard(input: HTMLInputElement): Promise<void> {
  try {
    input.value = (await navigator.clipboard.readText()).trim();
    input.focus();
  } catch {
    input.focus();
    input.select();
    console.warn('[github-star-manager] 剪贴板读取被拒，请手动 Ctrl+V 粘贴 token');
  }
}

type IssueHandler = (detail: string) => void;
let issueHandler: IssueHandler | null = null;

/** index.ts 注册：Token 问题 → 用初始化面板（横幅）呈现，不再用居中弹窗 */
export function setTokenIssueHandler(fn: IssueHandler | null): void {
  issueHandler = fn;
}

/** 401 / 403(非限速) 统一入口：上报初始化面板；面板未挂载（非 stars 页/dev）则仅日志兜底 */
export function notifyTokenIssue(detail: string): void {
  console.error(`[github-star-manager] Token 问题：${detail}`);
  if (issueHandler) issueHandler(detail);
}
