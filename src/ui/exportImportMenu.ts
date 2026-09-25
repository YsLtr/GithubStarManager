/**
 * TM 菜单「导入 / 导出」入口（4.7.0）。
 *
 * 分层：本文件只管**交互**（TM 菜单、隐藏 file input、confirm / alert、下载触发、结果提示），
 * 数据的构造/校验/合并全在 storage/exportImport.ts 的纯逻辑层。
 *
 * 关键取舍（docs/adr/0001-export-import-format.md「交互与流程」）：
 * - 校验失败 → alert 报原因且**不弹 confirm**（不存在可执行的操作，同一种对话框会让用户以为「点确定就能强行导入」）；
 * - 破坏性确认 → `window.confirm`（脚本只跑在 github.com，不引入页面内确认条）；
 * - 导入后不导航、不重渲染；**仅**在「Stars 页且网格已存在」时按当前筛选重绘（由 index.ts 的回调完成）；
 * - 导入完成后直接走标题行 Sync 的同一路径 `runFullSync('button')`；**无 token 时提示并跳过、不弹 Token 输入框**。
 */
import { buildExportFilename } from '../constants';
import { gmDownloadFile, gmRegisterMenuCommand } from '../gm';
import { getGitHubPat } from '../starCheck';
import {
  applyImportPackage,
  buildExportPackage,
  validateExportPackage,
  type ExportPackage,
  type ImportReport,
} from '../storage/exportImport';

/** 导入完成后的收尾动作（index.ts 注入：重渲染 + 触发同步）。放在注入里避免菜单↔fullSync 循环导入 */
export type AfterImportHandler = (report: ImportReport) => void;
let afterImport: AfterImportHandler | null = null;

/** index.ts 注册：导入落盘成功后的收尾（重渲染 + 同步 + 结果提示） */
export function setAfterImportHandler(fn: AfterImportHandler | null): void {
  afterImport = fn;
}

/* ---------------- 导出 ---------------- */

function doExport(): void {
  const pkg = buildExportPackage(); // userId 缺失时返回 null（未登录 / 取不到 ID）
  if (!pkg) {
    window.alert('导出失败：取不到当前 GitHub 用户 ID（未登录？）。');
    return;
  }

  const filename = buildExportFilename(pkg.user.id);
  const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
  const ok = gmDownloadFile(blob, filename);
  if (!ok) {
    window.alert('下载未能启动：本脚本依赖 Tampermonkey 的 GM_download。请在 TM 设置（需 Advanced 模式）的「下载」区把 json 加入允许的扩展名，并确认下载功能已开启。');
    return;
  }
  console.log(
    `[github-star-manager] 已导出：${filename}（标签仓库 ${Object.keys(pkg.data.tags).length}、` +
      `备注 ${Object.keys(pkg.data.notes).length}、仓库元数据 ${Object.keys(pkg.data.repoCache).length}）`
  );
}

/* ---------------- 导入 ---------------- */

/** 结果摘要文案（导入完成的 alert 与 console 共用） */
function reportText(r: ImportReport): string {
  const parts = [
    `标签：新增 ${r.tagsAdded} 条关联（当前共 ${r.tagRepos} 个仓库带标签）`,
    `备注：写入 ${r.notesApplied} 条`,
  ];
  if (r.notesOverwritten > 0) parts.push(`其中覆盖本地原有备注 ${r.notesOverwritten} 条`);
  if (r.notesSkippedEmpty > 0) parts.push(`跳过空备注 ${r.notesSkippedEmpty} 条`);
  if (r.repoCacheAdded > 0) parts.push(`补入仓库元数据 ${r.repoCacheAdded} 条`);
  return parts.join('；');
}

/** 导入前的摘要：让用户在 confirm 里看到「将发生什么」，而不是抽象的「确定导入？」 */
function confirmText(pkg: ExportPackage, currentId: string): string {
  const tagCount = Object.keys(pkg.data.tags).length;
  const noteCount = Object.keys(pkg.data.notes).length;
  const cacheCount = Object.keys(pkg.data.repoCache).length;
  const when = new Date(pkg.exportedAt).toLocaleString();
  return (
    `将从导出包导入到当前账号（${currentId}）：\n\n` +
    `导出时间：${when}\n` +
    `带标签的仓库：${tagCount}\n` +
    `备注：${noteCount}\n` +
    `仓库元数据：${cacheCount}\n\n` +
    `合并方式：标签取并集；备注以文件为准（文件里的空备注不会覆盖你本地已有的备注）。\n` +
    `注意：导入会覆盖你本地与文件同名的备注，且不会自动备份，请确认已保存好当前数据。\n\n` +
    `确定导入吗？`
  );
}

/** 导入主流程：读文件 → 解析 → 校验 → confirm → 应用 → 收尾（同步/提示） */
function importFromFile(file: File): void {
  const reader = new FileReader();
  reader.onerror = () => {
    window.alert('读取文件失败，请重试。');
  };
  reader.onload = () => {
    let raw: unknown;
    try {
      raw = JSON.parse(String(reader.result));
    } catch {
      window.alert('文件不是合法的 JSON，已取消导入。');
      return;
    }

    const result = validateExportPackage(raw);
    if (!result.ok) {
      // 校验失败：alert 报原因，且**不弹 confirm**（此时不存在可执行的操作）
      window.alert(`导入已取消：${result.reason}`);
      return;
    }

    const pkg = result.pkg;
    if (!window.confirm(confirmText(pkg, pkg.user.id))) {
      console.log('[github-star-manager] 导入已取消（用户取消确认）');
      return;
    }

    let report: ImportReport;
    try {
      report = applyImportPackage(pkg);
    } catch (e) {
      console.error('[github-star-manager] 导入写入失败：', e);
      window.alert(`导入写入失败：${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    console.log(`[github-star-manager] 导入完成：${reportText(report)}`);
    window.alert(`导入完成。\n\n${reportText(report)}\n\n接下来会自动同步一次以刷新仓库数据。`);
    afterImport?.(report);
  };
  reader.readAsText(file);
}

/** 唤起导入大窗：全屏遮罩 + 中央拖放区。
 * 两条实测可行路径合一（Chrome 安全模型只认「页面上下文内的真实用户输入」）：
 * - 拖拽：drop 事件不需要 user activation，DataTransfer 直接给 File；
 * - 点击中央大按钮：页面内真实点击 = transient user activation，能唤起 <input type="file">。
 * **不能**在 TM 菜单回调里直接 input.click()——TM 维护者原话「extensions can't forward the
 * user gesture from the popup menu to the scripts callback」（tampermonkey#1827，NOT_PLANNED），
 * Chrome 静默拒绝（控制台都无报错，4.7.0 的实现即因此从未工作过）。
 * 模拟点击（isTrusted=false）、label 转发、prompt 蹭激活、showOpenFilePicker 均已实测排除。
 * 关闭：点遮罩空白 / Esc / 右上角 ×；**无超时**（导入是主动操作，用户可能正忙着找文件）。
 * 样式全内联：不依赖 Stars 视图才注入的样式表，任意 github.com 页面可用。 */
let importDialogKeyHandler: ((e: KeyboardEvent) => void) | null = null;

function pickFile(): void {
  closeImportDialog();

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.style.display = 'none';
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    closeImportDialog();
    if (file) importFromFile(file);
  });

  /* ---- 遮罩层 ---- */
  const overlay = document.createElement('div');
  overlay.className = 'gsm-import-overlay';
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '9999',
    background: 'rgba(0,0,0,0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  } as Partial<CSSStyleDeclaration>);

  /* ---- 中央拖放区 ---- */
  const box = document.createElement('div');
  box.className = 'gsm-import-box';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', '导入 GithubStarManager 数据');
  Object.assign(box.style, {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '14px',
    width: 'min(480px, 86vw)',
    padding: '40px 28px',
    background: 'var(--color-canvas-default, #fff)',
    border: '2px dashed var(--color-border-default, #d0d7de)',
    borderRadius: '12px',
    boxShadow: '0 8px 40px rgba(0,0,0,0.35)',
    fontFamily: 'inherit',
    textAlign: 'center',
    transition: 'border-color 0.15s, background-color 0.15s',
  } as Partial<CSSStyleDeclaration>);

  const title = document.createElement('div');
  title.textContent = '📥 导入数据';
  Object.assign(title.style, {
    fontSize: '20px',
    fontWeight: '600',
    color: 'var(--color-fg-default, #1f2328)',
  } as Partial<CSSStyleDeclaration>);

  const hint = document.createElement('div');
  hint.className = 'gsm-import-hint';
  hint.textContent = '把导出的 JSON 文件拖到这里，或点击下方按钮选择文件';
  Object.assign(hint.style, {
    fontSize: '14px',
    color: 'var(--color-fg-muted, #656d76)',
  } as Partial<CSSStyleDeclaration>);

  const pick = document.createElement('button');
  pick.type = 'button';
  pick.textContent = '选择文件';
  Object.assign(pick.style, {
    cursor: 'pointer',
    fontSize: '15px',
    padding: '8px 22px',
    borderRadius: '6px',
    border: '1px solid var(--color-border-default, #d0d7de)',
    background: 'var(--color-btn-bg, #f6f8fa)',
    color: 'var(--color-btn-text, #1f2328)',
  } as Partial<CSSStyleDeclaration>);
  // 页面内真实点击 = transient user activation，这里 click() 才能唤起文件选择器
  pick.addEventListener('click', () => input.click());

  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', '关闭');
  Object.assign(close.style, {
    position: 'absolute',
    top: '10px',
    right: '12px',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontSize: '20px',
    lineHeight: '1',
    color: 'var(--color-fg-muted, #656d76)',
  } as Partial<CSSStyleDeclaration>);
  close.addEventListener('click', () => closeImportDialog());

  box.append(title, hint, pick, close, input);
  overlay.appendChild(box);

  /* ---- 拖拽：drop 不需要 user activation，DataTransfer 直接给 File ---- */
  let dragDepth = 0;
  const highlight = (on: boolean): void => {
    box.style.borderColor = on ? 'var(--color-accent-emphasis, #0969da)' : 'var(--color-border-default, #d0d7de)';
    box.style.backgroundColor = on ? 'var(--color-accent-subtle, #ddf4ff)' : 'var(--color-canvas-default, #fff)';
    hint.textContent = on ? '松手开始导入' : '把导出的 JSON 文件拖到这里，或点击下方按钮选择文件';
  };
  overlay.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth += 1;
    highlight(true);
  });
  overlay.addEventListener('dragover', (e) => {
    e.preventDefault(); // 必须 preventDefault，否则浏览器直接导航打开该文件
  });
  overlay.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) highlight(false);
  });
  overlay.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    closeImportDialog();
    if (file) importFromFile(file);
  });

  /* ---- 关闭：点遮罩空白（点击目标不是 box 本体/其子元素时）---- */
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) closeImportDialog();
  });

  document.body.appendChild(overlay);

  importDialogKeyHandler = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') closeImportDialog();
  };
  window.addEventListener('keydown', importDialogKeyHandler);
}

function closeImportDialog(): void {
  if (importDialogKeyHandler) {
    window.removeEventListener('keydown', importDialogKeyHandler);
    importDialogKeyHandler = null;
  }
  document.querySelector('.gsm-import-overlay')?.remove();
}

/* ---------------- 菜单注册 ---------------- */

/** 导入后触发同步：与标题行 Sync 同一路径；无 token 时提示并跳过（不弹 Token 输入框） */
export function runImportSync(sync: () => Promise<unknown>): void {
  if (!getGitHubPat()) {
    window.alert('导入已完成，但未配置 GitHub Token，已跳过自动同步。配置 Token 后可在 TM 菜单点「🔄 立即全量同步」。');
    return;
  }
  void sync().then((sum) => {
    if (!sum) {
      // 401/403 已由 fullSync 的 reportAuthIssue → notifyTokenIssue 把**具体原因**写进配置面板；
      // 这里只记日志，不再上报，避免用笼统文案覆盖那条更准确的提示。
      console.warn('[github-star-manager] 导入后的自动同步未成功，数据已导入但仓库元数据可能未刷新');
    }
  });
}

/** TM 菜单注册。导入入口是大窗（全屏遮罩 + 拖放区）：菜单点击只开窗（扩展 UI 无手势可转发，
 * tampermonkey#1827），窗内真实点击选文件或拖拽落 File 才开始导入。 */
export function registerExportImportMenu(): void {
  gmRegisterMenuCommand('📤 导出数据（标签/备注）', () => {
    doExport();
  });
  gmRegisterMenuCommand('📥 导入数据（标签/备注）', () => {
    pickFile();
  });
}
