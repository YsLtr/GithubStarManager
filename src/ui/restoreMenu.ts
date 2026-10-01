// TM 菜单「恢复已取消的 star」窗口（4.9.0，ADR 0003 / 0006 决策 D23）。
//
// 形态（用户裁定）：**可勾选列表 + 一键「恢复选中」**，并且**每行之后一个 star 按钮**
// 可直接单条恢复；两种入口都走同一个全局串行队列（相邻请求 ≥1s）。
//
// 其他定案：
// - 执行前 `confirm` 显示**条数与预估耗时**（串行 ≥1s/条）；
// - 执行中逐条显示进度（`3/15 · owner/repo`），**可取消**（只停后续，已发出的不回滚）；
// - **不自动重试**；
// - 只列**仍在 24h 宽限期内**的条目（超期即删除标签/备注，不留墓碑行）；
// - 每条显示**剩余时长**（列表按剩余时间升序，最该先处理的在前）。
//
// 样式全内联（同 exportImportMenu：TM 菜单可在任意 github.com 页面打开，不能依赖只有
// Stars 视图才注入的样式表）。失败只报结果，不暴露写通道实现（ADR 0006）。

import { gmRegisterMenuCommand } from '../gm';
import { estimateBatchSeconds, restoreMany, restoreOne, type RestoreOutcome } from '../restore';
import { formatRemaining, listRestorable, type RestorableEntry } from '../storage/pendingDelete';
import { pushNotice } from './notifications';

let keyHandler: ((e: KeyboardEvent) => void) | null = null;

const boxStyle: Partial<CSSStyleDeclaration> = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  width: 'min(560px, 92vw)',
  maxHeight: 'min(640px, 86vh)',
  padding: '20px 22px',
  background: 'var(--color-canvas-default, #fff)',
  border: '1px solid var(--color-border-default, #d0d7de)',
  borderRadius: '12px',
  boxShadow: '0 8px 40px rgba(0,0,0,0.35)',
  fontFamily: 'inherit',
  color: 'var(--color-fg-default, #1f2328)',
};

function closeDialog(): void {
  if (keyHandler) {
    window.removeEventListener('keydown', keyHandler);
    keyHandler = null;
  }
  document.querySelector('.gsm-restore-overlay')?.remove();
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style: Partial<CSSStyleDeclaration>,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node.style, style);
  if (text !== undefined) node.textContent = text;
  return node;
}

function openRestoreDialog(): void {
  closeDialog();

  const overlay = el('div', {
    position: 'fixed',
    inset: '0',
    zIndex: '9999',
    background: 'rgba(0,0,0,0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  });
  overlay.className = 'gsm-restore-overlay';

  const box = el('div', boxStyle);
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', '恢复已取消的 star');

  const title = el('div', { fontSize: '18px', fontWeight: '600' }, '♻️ 恢复已取消的 star');
  const hint = el(
    'div',
    { fontSize: '13px', color: 'var(--color-fg-muted, #656d76)' },
    '取消 star 时标签与备注会被保留 24 小时，期间可以在这里恢复。超时的条目已从列表消失。',
  );

  // 列表容器（可滚动）
  const list = el('div', {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    overflowY: 'auto',
    border: '1px solid var(--color-border-default, #d0d7de)',
    borderRadius: '8px',
    padding: '8px',
    minHeight: '80px',
  });

  // 底部状态行 + 按钮行
  const status = el('div', { fontSize: '13px', color: 'var(--color-fg-muted, #656d76)', minHeight: '18px' });
  const actions = el('div', { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' });

  const btnPrimary: Partial<CSSStyleDeclaration> = {
    cursor: 'pointer',
    fontSize: '14px',
    padding: '6px 14px',
    borderRadius: '6px',
    border: '1px solid var(--color-border-default, #d0d7de)',
    background: 'var(--color-btn-primary-bg, #1f883d)',
    color: '#fff',
  };
  const btnPlain: Partial<CSSStyleDeclaration> = {
    cursor: 'pointer',
    fontSize: '14px',
    padding: '6px 14px',
    borderRadius: '6px',
    border: '1px solid var(--color-border-default, #d0d7de)',
    background: 'var(--color-btn-bg, #f6f8fa)',
    color: 'var(--color-btn-text, #1f2328)',
  };

  const btnAll = el('button', btnPlain, '全选');
  const btnNone = el('button', btnPlain, '全不选');
  const btnRun = el('button', btnPrimary, '恢复选中');
  const btnStop = el('button', btnPlain, '取消执行');
  const btnClose = el('button', btnPlain, '关闭');
  (btnAll as HTMLButtonElement).type = 'button';
  (btnNone as HTMLButtonElement).type = 'button';
  (btnRun as HTMLButtonElement).type = 'button';
  (btnStop as HTMLButtonElement).type = 'button';
  (btnClose as HTMLButtonElement).type = 'button';
  btnStop.hidden = true;

  const close = el('button', {
    position: 'absolute',
    top: '10px',
    right: '12px',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontSize: '20px',
    lineHeight: '1',
    color: 'var(--color-fg-muted, #656d76)',
  }, '×');
  (close as HTMLButtonElement).type = 'button';
  (close as HTMLButtonElement).setAttribute('aria-label', '关闭');
  // 执行中禁用关闭：否则窗口一关，「取消执行」按钮就跟着没了，而后续条目仍在发（ADR 0003）
close.addEventListener('click', () => {
  if (!running) closeDialog();
});

  /** 当前窗口内还活着的行（repoId → 行状态） */
  const rows = new Map<string, { entry: RestorableEntry; box: HTMLElement }>();
  const checked = new Set<string>();
  let running = false;
  const cancelToken = { cancelled: false };

  function refreshButtons(): void {
    const n = checked.size;
    (btnRun as HTMLButtonElement).textContent = n > 0 ? `恢复选中（${n}）` : '恢复选中';
    (btnRun as HTMLButtonElement).disabled = running || n === 0;
    (btnRun as HTMLButtonElement).style.opacity = (btnRun as HTMLButtonElement).disabled ? '0.6' : '';
    (btnAll as HTMLButtonElement).disabled = running;
    (btnNone as HTMLButtonElement).disabled = running;
    (btnClose as HTMLButtonElement).disabled = running;
  }

  function removeRow(repoId: string): void {
    rows.get(repoId)?.box.remove();
    rows.delete(repoId);
    checked.delete(repoId);
    if (rows.size === 0 && !list.querySelector('.gsm-restore-empty')) {
      const empty = el(
        'div',
        { fontSize: '13px', color: 'var(--color-fg-muted, #656d76)', padding: '8px' },
        '当前没有可恢复的条目。'
      );
      empty.className = 'gsm-restore-empty';
      list.appendChild(empty);
    }
    refreshButtons();
  }

  function bindRow(entry: RestorableEntry): void {
    const row = el('div', {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '6px 8px',
      borderRadius: '6px',
      border: '1px solid transparent',
    });

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.addEventListener('change', () => {
      if (cb.checked) checked.add(entry.repoId);
      else checked.delete(entry.repoId);
      refreshButtons();
    });

    const name = el('span', { flex: '1 1 auto', fontSize: '14px', wordBreak: 'break-all' }, entry.name);

    const marks: string[] = [];
    if (entry.tags.length > 0) marks.push(`${entry.tags.length} 个标签`);
    if (entry.hasNote) marks.push('备注');
    const extra = el(
      'span',
      { flex: '0 0 auto', fontSize: '12px', color: 'var(--color-fg-muted, #656d76)' },
      marks.join(' · '),
    );

    const remain = el(
      'span',
      { flex: '0 0 auto', fontSize: '12px', color: 'var(--color-fg-muted, #656d76)', minWidth: '56px', textAlign: 'right' },
      `剩 ${formatRemaining(entry.remainingMs)}`,
    );

    // 每行一个 star 按钮：单条直点，不必先勾选
    const one = el('button', {
      ...btnPlain,
      fontSize: '13px',
      padding: '3px 10px',
      flex: '0 0 auto',
    }, '☆ 恢复');
    (one as HTMLButtonElement).type = 'button';
    one.addEventListener('click', () => {
      if (running) return;
      (one as HTMLButtonElement).disabled = true;
      status.textContent = `正在恢复 ${entry.name}…`;
      void restoreOne({ repoId: entry.repoId, name: entry.name }).then((r) => {
        if (r.ok) {
          status.textContent = `✓ ${entry.name} 已恢复`;
          removeRow(entry.repoId);
        } else {
          status.textContent = `✗ ${entry.name}：${r.message || '恢复失败'}`;
          (one as HTMLButtonElement).disabled = false;
          // ADR 0003：失败一律 alert 一行文字（不隐藏按钮、不代替用户判断状态）
          window.alert(`恢复失败：${entry.name} —— ${r.message || '未知原因'}`);
        }
      });
    });

    row.append(cb, name, extra, remain, one);
    rows.set(entry.repoId, { entry, box: row });
    list.appendChild(row);
  }

  (btnAll as HTMLButtonElement).addEventListener('click', () => {
    list.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((cb) => {
      cb.checked = true;
    });
    for (const repoId of rows.keys()) checked.add(repoId);
    refreshButtons();
  });
  (btnNone as HTMLButtonElement).addEventListener('click', () => {
    list.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((cb) => {
      cb.checked = false;
    });
    checked.clear();
    refreshButtons();
  });

  (btnClose as HTMLButtonElement).addEventListener('click', () => closeDialog());
  (btnStop as HTMLButtonElement).addEventListener('click', () => {
    cancelToken.cancelled = true;
    status.textContent = '正在停止…（已发出的请求不会回滚）';
  });

  (btnRun as HTMLButtonElement).addEventListener('click', () => {
    if (running) return;
    const targets = [...checked]
      .map((id) => rows.get(id)?.entry)
      .filter((e): e is RestorableEntry => !!e);
    if (targets.length === 0) return;
    const seconds = estimateBatchSeconds(targets.length);
    const ok = window.confirm(
      `将恢复 ${targets.length} 个仓库的 star。\n\n` +
        `· 逐个执行，每次间隔至少 1 秒，预计约 ${seconds} 秒完成；\n` +
        `· 执行中可以点「取消执行」停住后续（已经恢复的不会回滚）；\n` +
        `· 失败不会自动重试。\n\n确定开始吗？`
    );
    if (!ok) return;

    running = true;
    cancelToken.cancelled = false;
    btnStop.hidden = false;
    refreshButtons();
    status.textContent = `0/${targets.length} 开始…`;

    void restoreMany(targets, {
      token: cancelToken,
      onProgress: (done, total, result: RestoreOutcome) => {
        status.textContent = `${done}/${total} ${result.ok ? '✓' : '✗'} ${result.name}${
          result.ok ? '' : `：${result.message || '失败'}`
        }`;
        if (result.ok) removeRow(result.repoId);
      },
    }).then((summary) => {
      running = false;
      btnStop.hidden = true;
      refreshButtons();
      const failedText = summary.failed.length > 0 ? `，失败 ${summary.failed.length} 个` : '';
      const cancelText = summary.cancelled ? '（已取消，部分未执行）' : '';
      status.textContent = `完成：成功 ${summary.succeeded}/${summary.total}${failedText}${cancelText}`;
      if (summary.failed.length > 0) {
        // 批量汇总也走 alert（ADR 0003 失败分支）：逐条列失败原因，3s 通知承载不了这个信息量
        const lines = summary.failed.map((f) => `· ${f.name}：${f.message || '失败'}`).join('\n');
        window.alert(`恢复完成：成功 ${summary.succeeded}/${summary.total}${cancelText}\n\n失败 ${summary.failed.length} 个：\n${lines}`);
      } else {
        pushNotice(`恢复完成：成功 ${summary.succeeded}/${summary.total}${cancelText}`, 'success');
      }
    });
  });

  actions.append(btnAll, btnNone, btnRun, btnStop, btnClose);
  box.append(title, hint, list, status, actions, close);
  overlay.appendChild(box);

  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay && !running) closeDialog();
  });

  document.body.appendChild(overlay);

  keyHandler = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && !running) closeDialog();
  };
  window.addEventListener('keydown', keyHandler);

  // 填充列表
  const entries = listRestorable();
  if (entries.length === 0) {
    const empty = el(
      'div',
      { fontSize: '13px', color: 'var(--color-fg-muted, #656d76)', padding: '8px' },
      '当前没有可恢复的条目。'
    );
    empty.className = 'gsm-restore-empty';
    list.appendChild(empty);
  } else {
    for (const e of entries) bindRow(e);
  }
  refreshButtons();
}

/** TM 菜单注册（任意 github.com 页面可用） */
export function registerRestoreMenu(): void {
  gmRegisterMenuCommand('♻️ 恢复已取消的 star（24h 内）', () => {
    openRestoreDialog();
  });
}
