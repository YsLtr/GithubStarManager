// 快捷 Token 配置与失效弹窗（4.0.1）。
//
// 快捷获取：GitHub 2025-08-26 起支持 fine-grained PAT 创建页 Template URL
// （query 参数预填 name/description/expires_in/<permission>，write 含 read），
// 用 `starring=write` 一键带出最小权限——官方权限表把 /user/starred* 全部 5 个
// 端点归在 Account permissions → Starring（列表/查询 = read，加星/去星 = write）。
// 来源：
// - https://github.blog/changelog/2025-08-26-template-urls-for-fine-grained-pats-and-updated-permissions-ui/
// - https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#pre-filling-fine-grained-personal-access-token-details-using-url-parameters
//
// 失效判定（官方 troubleshooting）：401 = Bad credentials（失效/撤销）弹窗；
// 403 必须先排除限速（retry-after 或 x-ratelimit-remaining:0），剩下的才是权限不足。
// https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api
//
// 独立成模块的原因：starCheck → filters → ui/cards 构成导入链，失效上报若放
// starCheck，cards 调它会形成循环导入；本模块只依赖 constants/gm。

import { STORAGE_KEYS } from './constants';
import { gmSet } from './gm';

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
  '&expires_in=none' +
  '&starring=write';

/** 打开预填好的创建页（必须在点击手势里调用，否则会被浏览器弹窗拦截） */
export function openTokenCreator(): void {
  window.open(TOKEN_TEMPLATE_URL, '_blank', 'noopener');
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
    console.warn('[github-stars-grid] 剪贴板读取被拒，请手动 Ctrl+V 粘贴 token');
  }
}

/** 401 / 403(非限速) 统一入口：弹一键更新窗（单例，重复调用只刷新文案） */
export function notifyTokenIssue(detail: string): void {
  const exist = document.querySelector<HTMLElement>('.gsm-token-modal');
  if (exist) {
    const d = exist.querySelector<HTMLElement>('.gsm-token-modal-detail');
    if (d) d.textContent = detail;
    return;
  }

  const modal = document.createElement('div');
  modal.className = 'gsm-token-modal';
  modal.innerHTML =
    '<div class="gsm-token-modal-box" role="dialog" aria-modal="true">' +
    '<div class="gsm-token-modal-title">🔑 GitHub Token 需要配置</div>' +
    '<div class="gsm-token-modal-detail"></div>' +
    '<ol class="gsm-token-modal-steps">' +
    '<li>点「打开创建页」——创建页已预填最小权限（Account permissions → Starring → write）</li>' +
    '<li>点 <b>Generate token</b> 并复制生成的 token</li>' +
    '<li>回来粘贴 →「保存并同步」即自动恢复</li>' +
    '</ol>' +
    '<input type="text" spellcheck="false" autocomplete="off" placeholder="github_pat_… 或 ghp_（也可直接 Ctrl+V 到框里）">' +
    '<div class="gsm-token-modal-actions">' +
    '<span class="gsm-token-msg"></span>' +
    '<button type="button" class="btn" data-act="jump">打开创建页</button>' +
    '<button type="button" class="btn" data-act="paste">从剪贴板粘贴</button>' +
    '<button type="button" class="btn" data-act="later">稍后</button>' +
    '<button type="button" class="btn btn-primary" data-act="save">保存并同步</button>' +
    '</div></div>';
  document.body.appendChild(modal);
  modal.querySelector<HTMLElement>('.gsm-token-modal-detail')!.textContent = detail;

  const input = modal.querySelector<HTMLInputElement>('input')!;
  const msg = modal.querySelector<HTMLElement>('.gsm-token-msg')!;
  modal.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t === modal) {
      modal.remove();
      return;
    }
    const act = t.closest('[data-act]')?.getAttribute('data-act');
    if (act === 'jump') openTokenCreator();
    else if (act === 'paste') void pasteFromClipboard(input);
    else if (act === 'later') modal.remove();
    else if (act === 'save') {
      const kind = saveToken(input.value);
      if (!kind) {
        msg.textContent = '前缀不对：预期 github_pat_（fine-grained）或 ghp_（classic）';
        return;
      }
      console.log(`[github-stars-grid] Token 已更新（${kind}），自动触发全量同步`);
      modal.remove();
      notifyTokenSaved();
    }
  });
}
