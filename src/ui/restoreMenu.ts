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
// Stars 视图才注入的样式表）。**颜色/投影一律在打开时从页面现场解析**（`ui/theme.ts`）：
// GitHub 已删掉 `--color-*` 一代变量，写旧名就会在暗色主题下命中浅色兜底（issue #1）。
// 失败只报结果，不暴露写通道实现（ADR 0006）。

import { gmRegisterMenuCommand } from '../gm';
import { applyFilters } from '../filters';
import { estimateBatchSeconds, restoreMany, restoreOne, type RestoreOutcome } from '../restore';
import { formatRemaining, listRestorable, type RestorableEntry } from '../storage/pendingDelete';
import { listTombstones, removeTombstones, type TombstoneEntry } from '../storage/tombstone';
import { pushNotice } from './notifications';
import { borderCss, resolveUiTheme } from './theme';

let keyHandler: ((e: KeyboardEvent) => void) | null = null;

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

  // 主题现场解析（每次打开一次）：用户可能在两次打开之间切了 light / dark
  const theme = resolveUiTheme();

  const overlay = el('div', {
    position: 'fixed',
    inset: '0',
    zIndex: '9999',
    background: theme.backdrop,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  });
  overlay.className = 'gsm-restore-overlay';

  const box = el('div', {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    width: 'min(560px, 92vw)',
    maxHeight: 'min(640px, 86vh)',
    padding: '20px 22px',
    background: theme.canvas,
    border: borderCss('1px', theme.border),
    borderRadius: theme.radiusLarge,
    boxShadow: theme.floatingShadow,
    fontFamily: 'inherit',
    color: theme.fg,
  });
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', '取消 / 异常的 Star 仓库');

  const title = el('div', { fontSize: '18px', fontWeight: '600' }, '♻️ 取消 / 异常的 Star 仓库');
  const hint = el(
    'div',
    { fontSize: '13px', color: theme.fgMuted },
    '取消 star 的仓库：标签与备注保留 24 小时，期间可恢复。异常仓库：同步确认已无法访问（404/410/451），卡片显示为灰色，仍可筛选与编辑。',
  );

  const listStyle: Partial<CSSStyleDeclaration> = {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    overflowY: 'auto',
    border: borderCss('1px', theme.border),
    borderRadius: theme.radiusMedium,
    padding: '8px',
    minHeight: '80px',
  };
  const sectionTitle = (text: string): HTMLElement =>
    el('div', { fontSize: '13px', fontWeight: '600', color: theme.fg, marginTop: '2px' }, text);

  // 两个分区：已取消的 Star（24h 宽限期）与异常的 Star（墓碑）。分开显示，动作也分开。
  const restorableTitle = sectionTitle('已取消的 Star（24 小时内可恢复）');
  const list = el('div', listStyle);
  const abnormalTitle = sectionTitle('异常的 Star（仓库已无法访问）');
  const abnormalList = el('div', listStyle);

  // 底部状态行 + 按钮行
  const status = el('div', { fontSize: '13px', color: theme.fgMuted, minHeight: '18px' });
  // 按钮跟着各自分区走（用户裁定）：勾选/恢复只对「已取消」有意义，删除只对「异常」有意义，
  // 混成一排会让人以为「恢复选中」也能作用于异常仓库。
  const actionRow = (): HTMLElement =>
    el('div', { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' });
  const restorableActions = actionRow();
  const abnormalActions = actionRow();
  const actions = actionRow();

  const btnPrimary: Partial<CSSStyleDeclaration> = {
    cursor: 'pointer',
    fontSize: '14px',
    padding: '6px 14px',
    borderRadius: theme.radiusMedium,
    border: borderCss('1px', theme.btnPrimaryBorder),
    background: theme.btnPrimaryBg,
    color: theme.btnPrimaryFg,
  };
  const btnPlain: Partial<CSSStyleDeclaration> = {
    cursor: 'pointer',
    fontSize: '14px',
    padding: '6px 14px',
    borderRadius: theme.radiusMedium,
    border: borderCss('1px', theme.btnBorder),
    background: theme.btnBg,
    color: theme.btnFg,
  };

  const btnAll = el('button', btnPlain, '全选');
  const btnNone = el('button', btnPlain, '全不选');
  const btnRun = el('button', btnPrimary, '恢复选中');
  const btnStop = el('button', btnPlain, '取消执行');
  const btnClose = el('button', btnPlain, '关闭');
  const btnDeleteAll = el('button', btnPlain, '删除全部异常');
  const btnAbnormalAll = el('button', btnPlain, '全选');
  const btnAbnormalNone = el('button', btnPlain, '全不选');
  const btnAbnormalRun = el('button', btnPlain, '删除选中');
  (btnAll as HTMLButtonElement).type = 'button';
  (btnNone as HTMLButtonElement).type = 'button';
  (btnRun as HTMLButtonElement).type = 'button';
  (btnStop as HTMLButtonElement).type = 'button';
  (btnClose as HTMLButtonElement).type = 'button';
  (btnDeleteAll as HTMLButtonElement).type = 'button';
  (btnAbnormalAll as HTMLButtonElement).type = 'button';
  (btnAbnormalNone as HTMLButtonElement).type = 'button';
  (btnAbnormalRun as HTMLButtonElement).type = 'button';
  btnStop.hidden = true;
  btnDeleteAll.hidden = true;
  btnAbnormalAll.hidden = true;
  btnAbnormalNone.hidden = true;

  const close = el('button', {
    position: 'absolute',
    top: '10px',
    right: '12px',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontSize: '20px',
    lineHeight: '1',
    color: theme.fgMuted,
  }, '×');
  (close as HTMLButtonElement).type = 'button';
  (close as HTMLButtonElement).setAttribute('aria-label', '关闭');
  // 执行中禁用关闭：否则窗口一关，「取消执行」按钮就跟着没了，而后续条目仍在发（ADR 0003）
close.addEventListener('click', () => {
  if (!running) closeDialog();
});

  /** 当前窗口内还活着的行（repoId → 行状态） */
  const rows = new Map<string, { entry: RestorableEntry; box: HTMLElement }>();
  /** 异常分区当前还活着的行（repoId → 行节点） */
  /** 异常分区当前还活着的行（repoId → 行节点） */
  const abnormalRows = new Map<string, HTMLElement>();
  /** 已勾选的「已取消」条目 */
  const checked = new Set<string>();
  /** 已勾选的「异常」条目 */
  const abnormalChecked = new Set<string>();
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
    (btnDeleteAll as HTMLButtonElement).disabled = running;
    (btnDeleteAll as HTMLButtonElement).hidden = abnormalRows.size === 0;
    (btnDeleteAll as HTMLButtonElement).textContent =
      abnormalRows.size > 0 ? `删除全部异常（${abnormalRows.size}）` : '删除全部异常';
    // 异常分区的批量删除：与「已取消」一样先勾选，避免误点（删除不可撤销）
    const an = abnormalChecked.size;
    (btnAbnormalRun as HTMLButtonElement).textContent = an > 0 ? `删除选中（${an}）` : '删除选中';
    (btnAbnormalRun as HTMLButtonElement).disabled = running || an === 0;
    (btnAbnormalRun as HTMLButtonElement).style.opacity =
      (btnAbnormalRun as HTMLButtonElement).disabled ? '0.6' : '';
    for (const b of [btnAbnormalAll, btnAbnormalNone] as HTMLButtonElement[]) {
      b.disabled = running;
      b.hidden = abnormalRows.size === 0;
    }
  }

  function removeRow(repoId: string): void {
    rows.get(repoId)?.box.remove();
    rows.delete(repoId);
    checked.delete(repoId);
    if (rows.size === 0 && !list.querySelector('.gsm-restore-empty')) {
      const empty = el(
        'div',
        { fontSize: '13px', color: theme.fgMuted, padding: '8px' },
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
      borderRadius: theme.radiusMedium,
      // `transparent` 是**几何占位**（与列表容器的 1px 描边对齐，不额外吃内边距），不是主题色。
      // D35 只禁颜色字面量；CSS 关键字的 transparent 表达「没有颜色」。这里没有任何状态会改它
      // （行不响应 hover，勾选态只体现在 checkbox 上）—— 别再照抄成「hover 用」。
      border: '1px solid transparent',
    });

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    // 原生 checkbox 的选中色由主题 token 决定：暗色主题下默认的亮蓝白勾会与深底打架
    cb.style.accentColor = theme.checked;
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
      { flex: '0 0 auto', fontSize: '12px', color: theme.fgMuted },
      marks.join(' · '),
    );

    const remain = el(
      'span',
      { flex: '0 0 auto', fontSize: '12px', color: theme.fgMuted, minWidth: '56px', textAlign: 'right' },
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

  function removeAbnormalRow(repoId: string): void {
    abnormalRows.get(repoId)?.remove();
    abnormalRows.delete(repoId);
    abnormalChecked.delete(repoId);
    if (abnormalRows.size === 0 && !abnormalList.querySelector('.gsm-restore-empty')) {
      const empty = el(
        'div',
        { fontSize: '13px', color: theme.fgMuted, padding: '8px' },
        '当前没有异常仓库。'
      );
      empty.className = 'gsm-restore-empty';
      abnormalList.appendChild(empty);
    }
    refreshButtons();
  }

  /** 异常分区的一行：可勾选（批量删除用）＋单行删除。仓库已不可访问，没有恢复动作。 */
  function bindAbnormalRow(entry: TombstoneEntry): void {
    const row = el('div', {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '6px 8px',
      borderRadius: theme.radiusMedium,
      border: '1px solid transparent',
    });

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.style.accentColor = theme.checked;
    cb.addEventListener('change', () => {
      if (cb.checked) abnormalChecked.add(entry.repoId);
      else abnormalChecked.delete(entry.repoId);
      refreshButtons();
    });

    const name = el('span', { flex: '1 1 auto', fontSize: '14px', wordBreak: 'break-all' }, entry.name);

    const marks: string[] = [];
    if (entry.tags.length > 0) marks.push(`${entry.tags.length} 个标签`);
    if (entry.hasNote) marks.push('备注');
    marks.push(`HTTP ${entry.status}`);
    const extra = el(
      'span',
      { flex: '0 0 auto', fontSize: '12px', color: theme.fgMuted },
      marks.join(' · '),
    );

    const del = el('button', {
      ...btnPlain,
      fontSize: '13px',
      padding: '3px 10px',
      flex: '0 0 auto',
    }, '删除');
    (del as HTMLButtonElement).type = 'button';
    del.addEventListener('click', () => {
      if (running) return;
      if (!window.confirm(`删除异常仓库 ${entry.name}？\n其标签与备注也会一并删除，不可撤销。`)) return;
      if (removeTombstones([entry.repoId]) > 0) {
        removeAbnormalRow(entry.repoId);
        applyFilters({ keepPage: true });
      }
    });

    row.append(cb, name, extra, del);
    abnormalRows.set(entry.repoId, row);
    abnormalList.appendChild(row);
  }

  (btnDeleteAll as HTMLButtonElement).addEventListener('click', () => {
    if (running) return;
    const n = abnormalRows.size;
    if (n === 0) return;
    const ok = window.confirm(
      `删除全部 ${n} 个异常 Star 仓库？\n\n` +
        '· 仓库已无法访问，删除后不再出现在网格与恢复窗口；\n' +
        '· 它们的标签与备注也会一并删除；\n' +
        '· 操作不可撤销。\n\n确定删除吗？'
    );
    if (!ok) return;
    const removed = removeTombstones();
    abnormalRows.clear();
    abnormalChecked.clear();
    abnormalList.replaceChildren();
    const empty = el('div', { fontSize: '13px', color: theme.fgMuted, padding: '8px' }, '当前没有异常仓库。');
    empty.className = 'gsm-restore-empty';
    abnormalList.appendChild(empty);
    refreshButtons();
    status.textContent = `已删除 ${removed} 个异常仓库。`;
    applyFilters({ keepPage: true });
  });

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

  (btnAbnormalAll as HTMLButtonElement).addEventListener('click', () => {
    abnormalList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((cb) => {
      cb.checked = true;
    });
    for (const repoId of abnormalRows.keys()) abnormalChecked.add(repoId);
    refreshButtons();
  });
  (btnAbnormalNone as HTMLButtonElement).addEventListener('click', () => {
    abnormalList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((cb) => {
      cb.checked = false;
    });
    abnormalChecked.clear();
    refreshButtons();
  });
  (btnAbnormalRun as HTMLButtonElement).addEventListener('click', () => {
    if (running) return;
    const ids = [...abnormalChecked].filter((id) => abnormalRows.has(id));
    if (ids.length === 0) return;
    const ok = window.confirm(
      `删除选中的 ${ids.length} 个异常 Star 仓库？\n\n` +
        '· 仓库已无法访问，删除后不再出现在网格与恢复窗口；\n' +
        '· 它们的标签与备注也会一并删除；\n' +
        '· 操作不可撤销。\n\n确定删除吗？'
    );
    if (!ok) return;
    const removed = removeTombstones(ids);
    for (const id of ids) removeAbnormalRow(id);
    status.textContent = `已删除 ${removed} 个异常仓库。`;
    applyFilters({ keepPage: true });
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
      const cancelText = summary.cancelled ? '（已停止，部分未执行）' : '';
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

  restorableActions.append(btnAll, btnNone, btnRun, btnStop);
  abnormalActions.append(btnAbnormalAll, btnAbnormalNone, btnAbnormalRun, btnDeleteAll);
  actions.append(btnClose);
  box.append(title, hint, restorableTitle, list, restorableActions, abnormalTitle, abnormalList, abnormalActions, status, actions, close);
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
      { fontSize: '13px', color: theme.fgMuted, padding: '8px' },
      '当前没有可恢复的条目。'
    );
    empty.className = 'gsm-restore-empty';
    list.appendChild(empty);
  } else {
    for (const e of entries) bindRow(e);
  }
  const tombstones = listTombstones();
  if (tombstones.length === 0) {
    const empty = el(
      'div',
      { fontSize: '13px', color: theme.fgMuted, padding: '8px' },
      '当前没有异常仓库。'
    );
    empty.className = 'gsm-restore-empty';
    abnormalList.appendChild(empty);
  } else {
    for (const e of tombstones) bindAbnormalRow(e);
  }
  refreshButtons();
}

/** TM 菜单注册（任意 github.com 页面可用） */
export function registerRestoreMenu(): void {
  gmRegisterMenuCommand('♻️ 取消/异常的 Star 仓库', () => {
    openRestoreDialog();
  });
}
