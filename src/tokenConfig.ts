// 快捷 Token 配置与失效上报（4.0.1 引入；4.0.2 起失效走初始化面板，不再居中弹窗）。
//
// 快捷获取：GitHub 2025-08-26 起支持 fine-grained PAT 创建页 Template URL
// （query 参数预填 name/description/expires_in/<permission>，write 含 read），
// 用 `starring=write` 一键带出最小权限——官方权限表把 /user/starred* 全部 5 个
// 端点归在 Account permissions → Starring（列表/查询 = read，加星/去星 = write）。
// 来源：
// - https://github.blog/changelog/2025-08-26-template-urls-for-fine-grained-pats-and-updated-permissions-ui/
// - https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#pre-filling-fine-grained-personal-access-token-details-using-url-parameters
//
// 失效判定（官方 troubleshooting）：401 = Bad credentials（失效/撤销）→ 上报初始化面板；
// 403 必须先排除限速（retry-after 或 x-ratelimit-remaining:0），剩下的才是权限不足。
// https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api
//
// 独立成模块的原因：starCheck → filters → ui/cards 构成导入链，失效上报若放
// starCheck，cards 调它会形成循环导入；本模块只依赖 constants/gm。

import { STORAGE_KEYS } from './constants';
import { gmOpenInTab, gmSet } from './gm';

export type TokenKind = 'classic' | 'fine-grained';

export function detectTokenKind(tok: string): TokenKind | null {
  if (tok.startsWith('github_pat_')) return 'fine-grained';
  if (tok.startsWith('ghp_')) return 'classic';
  return null;
}

/** 官方 Template URL：starring=write 覆盖读列表+加星/去星；none = 不过期（闲置 1 年会被 GitHub 自动回收） */
export const TOKEN_TEMPLATE_URL =
  'https://github.com/settings/personal-access-tokens/new' +
  '?name=GithubStarsGrid' +
  '&description=Stars%20Grid%20userscript%20-%20only%20Account%20permission%3A%20Starring%20write' +
  '&expires_in=90' +
  '&starring=write';

/** 打开预填好的创建页：走 gmOpenInTab（TM 菜单回调无用户激活，裸 window.open 会被弹窗拦截静默吞掉） */
export function openTokenCreator(): void {
  gmOpenInTab(TOKEN_TEMPLATE_URL);
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
