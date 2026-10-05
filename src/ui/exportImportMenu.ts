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
 * - 导入**默认不自动同步**（`0005-no-auto-sync-after-import.md`）：落盘即完成、是否拉远端由用户决定。
 *   **4.17.0 收窄的例外**：本机还没有完整整表缓存（`hasApiData()` 为假）时先自动同步一次 ——
 *   分派依据是「该仓库在不在整表缓存里」，而整表缓存为空时这个判据必然全为「不在」，
 *   先同步一次能把「其实已 star」的那批从宽限期里救出来（同步后它们直接写活区）；
 *   注意这是**保守**触发条件：`hasApiData()` 与「缓存里有没有这个仓库」是两个可背离的量（见 D32）。
 *   同步失败**不阻断**导入：未能确认的仓库一律进 24h 宽限期，提示里写死该补救窗口。
 */
import { buildExportFilename } from '../constants';
import { runFullSync } from '../fullSync';
import { gmDownloadFile, gmRegisterMenuCommand } from '../gm';
import {
  applyImportPackage,
  buildExportPackage,
  validateExportPackage,
  type ExportPackage,
  type ImportReport,
} from '../storage/exportImport';
import { hasApiData } from '../storage/repoCache';
import { pushNotice } from './notifications';

/** 导入完成后的收尾动作（index.ts 注入：**仅**在 Stars 页重绘，不触发同步）。放在注入里是为了让 UI 层不反向依赖 index.ts 的初始化顺序 */
type AfterImportHandler = (report: ImportReport) => void;
let afterImport: AfterImportHandler | null = null;

/** index.ts 注册：导入落盘成功后的收尾（重渲染 + 结果提示；同步只在导入**前**、且仅本机无缓存时发生） */
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
      `备注 ${Object.keys(pkg.data.notes).length}）`
  );
}

/* ---------------- 导入 ---------------- */

/** 结果摘要文案（导入完成的 alert 与 console 共用） */
function reportText(r: ImportReport): string {
  const parts = [
    `标签：覆盖写入 ${r.tagsWritten} 个仓库（当前共 ${r.tagRepos} 个仓库带标签）`,
    `备注：写入 ${r.notesApplied} 条`,
  ];
  if (r.tagsRemoved > 0) parts.push(`其中被替换掉的本地标签 ${r.tagsRemoved} 条`);
  if (r.notesOverwritten > 0) parts.push(`其中覆盖本地原有备注 ${r.notesOverwritten} 条`);
  if (r.notesSkippedEmpty > 0) parts.push(`跳过空备注 ${r.notesSkippedEmpty} 条`);
  if (r.pendingAdded > 0) parts.push(`本地不存在 ${r.pendingAdded} 个仓库，其标签/备注已放入 24h 宽限期`);
  return parts.join('；');
}

/** 导入前的摘要：让用户在 confirm 里看到「将发生什么」，而不是抽象的「确定导入？」 */
function confirmText(pkg: ExportPackage, currentId: string, needSync: boolean): string {
  const tagCount = Object.keys(pkg.data.tags).length;
  const noteCount = Object.keys(pkg.data.notes).length;
  const when = new Date(pkg.exportedAt).toLocaleString();
  return (
    `将从导出包导入到当前账号（${currentId}）：\n\n` +
    `导出时间：${when}\n` +
    `带标签的仓库：${tagCount}\n` +
    `备注：${noteCount}\n\n` +
    `导入方式（逐个仓库按本机的 star 记录判断）：\n` +
    `· 本机有该 star 记录 ⇒ 写入该仓库：文件里的标签/备注**覆盖**本地的；\n` +
    `  但文件里没有（或为空）的标签/备注**不会**清空你本地的。\n` +
    `· 本机确认没有该 star（或本机尚未同步过）⇒ 放入 24 小时宽限期，\n` +
    `  期间 star 回来、或任意一次成功同步到「远端已 star」即自动恢复；\n` +
    `  超过 24 小时仍未 star 的，其标签/备注会被删除。\n\n` +
    (needSync
      ? `本机尚未完成过一次完整同步，导入前会先自动同步一次以确认本地 star 记录。\n` +
        `若同步失败（例如未配置 Token），上面的仓库会全部进入 24 小时宽限期 ——\n` +
        `请在 24 小时内完成一次同步，否则它们的标签/备注会被删除。\n\n`
      : '') +
    `注意：导入会**覆盖**这些仓库本地的标签与备注（文件里没给的部分按上面的规则保留），\n` +
    `且不会自动备份，请确认已保存好当前数据。\n\n` +
    `确定导入吗？`
  );
}

/** 导入主流程：读文件 → 解析 → 校验 → confirm →（需要时先同步一次）→ 应用 → 收尾（重绘/提示） */
function importFromFile(file: File): void {
  const reader = new FileReader();
  reader.onerror = () => {
    window.alert('读取文件失败，请重试。');
  };
  // 无整表缓存时要先 await 一次全量同步 ⇒ 回调必须是异步的
  reader.onload = async () => {
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
    // 「本机有没有完整整表缓存」决定导入要不要先同步一次（4.17.0）：分派依据是「本地确认已 star」，
    // 而没有缓存就无从确认。**在 confirm 之前算**，好让用户在对话框里就看到会发生什么。
    const needSync = !hasApiData();
    if (!window.confirm(confirmText(pkg, pkg.user.id, needSync))) {
      console.log('[github-star-manager] 导入已取消（用户取消确认）');
      return;
    }

    if (needSync) {
      pushNotice('导入前先同步一次，以确认本地 star 记录…', 'info');
      try {
        await runFullSync('button');
      } catch (e) {
        // 同步失败**不阻断**导入：未能确认的仓库一律进宽限期，提示里写死 24h 补救窗口。
        //（未配置 Token 时 runFullSync 会自己打开配置横幅并报「未配置 Token」，这里只补一条日志。）
        console.warn('[github-star-manager] 导入前的同步未能完成，未能确认的仓库将进入宽限期：', e);
      }
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
    const pendingHint =
      report.pendingAdded === 0
        ? ''
        : `\n\n${report.pendingAdded} 个仓库本地不存在，其标签/备注已放入 24 小时宽限期：` +
          `\n· 重新 star、或任意一次成功同步到「远端已 star」，即自动恢复；` +
          `\n· 24 小时内没有任何一次成功同步${report.cacheAvailable ? '' : '（本机尚未同步过）'}` +
          `，这些标签/备注会被删除。`;
    window.alert(
      `导入完成。\n\n${reportText(report)}${pendingHint}\n\n如需刷新仓库元数据，请点标题行 Sync 或 TM 菜单「🔄 立即全量同步」。`
    );
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

/* 4.9.0 删掉了无条件的 `runImportSync()`（导入后一定同步）—— ADR 0005：导入是数据搬运，
 * 落盘即完成、是否拉远端由用户决定。**4.17.0 收窄为唯一例外**：本机还没有完整整表缓存时，
 * 导入前先同步一次（没有缓存就无从判断「本地确认已 star」，而那正是逐仓库分派的依据）。
 * 迁移到宽限期的条目由后续同步自然收口：远端已 star ⇒ `fullSync` 分支 B 的 `markRepoStarred()`
 * 把它移回卡片；远端确实没有 ⇒ 留在宽限期，超期按 ADR 0003 删除。 */

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
