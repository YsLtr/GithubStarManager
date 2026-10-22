// 回归守卫：卡片正在编辑（备注 textarea / 标签输入框）时，任何重绘都必须挂起，编辑结束后补跑
// —— 对应 AGENTS.md 的 D36 与 DEVELOPER.md §7 的重绘契约。
//
// 用法：
//   pnpm build                                   # 夹具内联当前 dist
//   node tests/diag/gen-defer-rerender-harness.cjs
//   agent-browser-cli open --focus "file:///<repo>/.diag/defer-rerender-harness.html?tab=stars"
//   agent-browser-cli exec --tab <id> --file tests/diag/assert-defer-rerender.js
//
// 夹具 URL 必须带 ?tab=stars，否则脚本不转换、grid 为 0 会被误读成全绿。
//
// 断言链（每一步都必须成立，否则「挂起」就是假的）：
//   ① 前提探针：移除聚焦元素到底派不派发 blur（只记录，见下）；
//   ② 第 2 页开备注编辑框、打字：编辑框在、值为草稿、焦点在它上面；
//   ③ 用**无手势**路径触发整表重绘（另一张卡的标签 × ——`saveTags` 后调 `applyFilters`）：
//      编辑框仍在、值不变、网格**没被重建**（首卡节点引用不变）、页码仍是第 2 页；
//   ④ 结束编辑（blur）：挂起被兑现 —— 网格重建一次、草稿已落盘并显示、页码仍第 2 页；
//   ⑤ 全过程网格子节点数从未为 0（D12 的原子替换：不许出现可被布局观察到的空网格）；
//   ⑥ 跨断点收窄（teardownStarsView）时草稿必须按失焦语义提交，不能随节点一起消失；
//   ⑦ 编辑中这张卡被 unstar：草稿并进宽限期备份、活区保持为空、只读卡片点一下不能再进编辑态
//      （4.20.1 的回归锁，见该步骤内的注释）。
//
// 关于 ①：本夹具跑在 Chromium 上，实测「移除聚焦元素**会**派发 blur」，但那个事件的目标已在
// 文档外、传播不到 document —— 所以靠 blur 收尾的写法（本脚本初版就是）在这里必然挂死。
// 真正要守的是 ③：不论 blur 派不派发，草稿都不该被重绘吃掉。
return (async function () {
  const out = { errors: [], steps: [] };
  const q = (s) => document.querySelector(s);
  const qa = (s) => Array.from(document.querySelectorAll(s));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // 轮询而不是「睡固定毫秒」：后台标签页会把 setTimeout 钳到 ≥1s（实测 sleep(60) → 661ms），
  // 固定短等待会让本守卫在**不可见**标签页上报假失败。不可见时本该由人工把窗口切到前台，
  // 但断言不该依赖这个；改成「等条件成立，最多 3s」，可见标签页下第一次就命中，行为不变。
  const until = async (fn, ms = 3000) => {
    const t0 = Date.now();
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() - t0 >= ms) return null;
      await wait(50);
    }
  };
  const cards = () => qa('.stars-grid-container .stars-grid-card');
  const pageNo = () => {
    const b = q('button.gsm-page-info');
    const m = b ? /^(\d+)\s*\/\s*(\d+)$/.exec(b.textContent.trim()) : null;
    return m ? { page: +m[1], total: +m[2] } : null;
  };
  const gotoPage = async (n) => {
    const b = q('button.gsm-page-info');
    if (!b) return false;
    b.click();
    const input = await until(() => q('input.gsm-page-input'));
    if (!input) return false;
    input.value = String(n);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const landed = await until(() => pageNo() && pageNo().page === n);
    return !!landed;
  };
  const addTagOn = async (card, name) => {
    const btn = card.querySelector('.stars-tag-add');
    if (!btn) return false;
    btn.click();
    const input = await until(() => card.querySelector('.stars-tag-input'));
    if (!input) return false;
    input.value = name;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await wait(250);
    return true;
  };
  const delTagOn = async (card, name) => {
    const pill = Array.from(card.querySelectorAll('.stars-tag'))
      .find((e) => e.textContent.replace('×', '').trim() === name);
    const del = pill ? pill.querySelector('.stars-tag-del') : null;
    if (!del) return false;
    // 关键：用合成 click，**不产生 mousedown**，因此不会让正在编辑的 textarea 失焦
    del.click();
    await wait(250);
    return true;
  };

  const TAG = 'probe-' + Date.now().toString(36);
  const NOTE = 'draft-' + Date.now().toString(36);
  let gridObserver = null;

  try {
    if (!q('button.gsm-page-info')) {
      return { errors: ['harness 未转换：无分页器（URL 是否缺 ?tab=stars）'], steps: out.steps };
    }

    // ① 前提探针：只记录，不判定（见文件头）
    {
      const ta = document.createElement('textarea');
      ta.value = 'x';
      document.body.appendChild(ta);
      ta.focus();
      let blurred = false;
      ta.addEventListener('blur', () => { blurred = true; });
      ta.remove();
      out.steps.push('premise_blurOnRemove=' + blurred);
    }

    // ⑤ 全程盯着网格：子节点数一旦为 0 就是违反了原子替换
    const grid = q('.stars-grid-container');
    gridObserver = new MutationObserver(() => {
      if (grid.childElementCount === 0) out.errors.push('网格曾出现空态（D12 原子替换被破坏）');
    });
    gridObserver.observe(grid, { childList: true, subtree: false });

    if (!(await gotoPage(2))) return { errors: out.errors.concat(['未能进入第 2 页']), steps: out.steps };
    out.steps.push('page2=' + JSON.stringify(pageNo()));
    if (!pageNo() || pageNo().page !== 2) return { errors: out.errors.concat(['起点不在第 2 页']), steps: out.steps };

    // 先在**第二张卡**上种一个标签（此刻没有编辑器，重绘立即发生 —— 也是对照：非编辑态不挂起）
    let second = cards()[1];
    if (!(await addTagOn(second, TAG))) return { errors: out.errors.concat(['种标签失败']), steps: out.steps };
    second = cards()[1];
    const seeded = Array.from(second.querySelectorAll('.stars-tag'))
      .some((e) => e.textContent.replace('×', '').trim() === TAG);
    out.steps.push('seeded=' + seeded);
    if (!seeded) return { errors: out.errors.concat(['标签未落到第二张卡']), steps: out.steps };

    // ② 第一张卡开备注编辑框并打字
    const first = cards()[0];
    const repoId = first.dataset.repoId;
    const notes = first.querySelector('.stars-card-notes');
    notes.click();
    let ta = await until(() => first.querySelector('.stars-card-notes-edit'));
    if (!ta) return { errors: out.errors.concat(['点备注区未进入编辑态']), steps: out.steps };
    ta.value = NOTE;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    out.steps.push('editing=' + JSON.stringify({ repoId, focused: document.activeElement === ta, value: ta.value }));
    if (document.activeElement !== ta) out.errors.push('打开编辑框后焦点不在 textarea 上');
    // 记住节点身份：③ 要证明网格没被重建
    window.__gsmProbe = { card: first, gridChildren: grid.childElementCount };

    // ③ 无手势触发整表重绘（第二张卡的标签 ×）
    if (!(await delTagOn(cards()[1], TAG))) return { errors: out.errors.concat(['找不到种下的标签 ×']), steps: out.steps };
    ta = first.querySelector('.stars-card-notes-edit');
    const held = {
      sameCardNode: window.__gsmProbe.card === cards()[0],
      stillEditing: !!ta,
      value: ta ? ta.value : null,
      focused: ta ? document.activeElement === ta : false,
      page: pageNo(),
    };
    out.steps.push('held=' + JSON.stringify(held));
    if (!held.stillEditing) out.errors.push('重绘未被挂起：备注编辑框被摘掉了');
    if (held.value !== NOTE) out.errors.push('挂起期间草稿变了: ' + held.value);
    if (!held.focused) out.errors.push('挂起期间焦点离开了编辑框');
    if (!held.sameCardNode) out.errors.push('挂起期间网格被重建了（首卡节点换了）');
    if (!held.page || held.page.page !== 2) out.errors.push('挂起期间页码变了: ' + JSON.stringify(held.page));
    // 挂起期间标签胶囊应当已经消失（局部重绘照常），整表重绘才挂起
    const stillSeeded = Array.from(cards()[1].querySelectorAll('.stars-tag'))
      .some((e) => e.textContent.replace('×', '').trim() === TAG);
    out.steps.push('localRerender=' + (stillSeeded ? '未发生' : '已发生'));
    if (stillSeeded) out.errors.push('局部重绘也被挂起了（应当只挂起整表重绘）');

    // ④ 结束编辑：blur → commit → document 捕获相位 blur → 挂起兑现
    //    注意「不可见标签页无真相」：窗口没有前台焦点时 ta.blur() 根本不产生 blur（前提探针会显示
    //    premise_blurOnRemove=false），提交不发生 ⇒ 断言全红。这时退到实现里的另一条结束信号
    //    （document keyup），把「走的是哪条」记进 flushVia，别把环境问题读成实现缺陷。
    const beforeFlushNode = cards()[0];
    let flushVia = 'blur';
    ta.blur();
    if (!(await until(() => cards()[0] !== beforeFlushNode, 1500))) {
      flushVia = 'keyup（blur 未派发：标签页无前台焦点）';
      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'x', bubbles: true }));
      await until(() => cards()[0] !== beforeFlushNode);
    }
    out.steps.push('flushVia=' + flushVia);
    const after = {
      rebuilt: cards()[0] !== beforeFlushNode,
      noteShown: (cards()[0].querySelector('.stars-card-notes') || {}).textContent,
      stored: (window.__gmStore['stars_notes_999'] || {})[repoId],
      page: pageNo(),
      editors: qa('.stars-card-notes-edit, .stars-tag-input').length,
    };
    out.steps.push('flushed=' + JSON.stringify(after));
    if (!after.rebuilt) out.errors.push('挂起未被兑现：编辑结束后网格没有补跑重绘');
    if (after.stored !== NOTE) out.errors.push('草稿未落盘: ' + JSON.stringify(after.stored));
    if (after.noteShown !== NOTE) out.errors.push('重绘后卡片上的备注不是草稿: ' + JSON.stringify(after.noteShown));
    if (!after.page || after.page.page !== 2) out.errors.push('兑现后页码变了（keepPage 丢了）: ' + JSON.stringify(after.page));
    if (after.editors !== 0) out.errors.push('结束后仍残留编辑器: ' + after.editors);

    // ⑥ 视图销毁（跨断点收窄 = teardownStarsView）前必须按失焦语义提交：这条路径不走挂起，
    //    节点被直接删掉，而删节点时 blur 的派发时机各引擎不一致（Chromium 在摘除**之前**派发，
    //    那一刻 `isConnected` 仍为 true，见 ⑦）⇒ 不主动提交就是把草稿押在引擎行为上。
    {
      const card = cards()[0];
      const rid = card.dataset.repoId;
      card.querySelector('.stars-card-notes').click();
      const t = await until(() => card.querySelector('.stars-card-notes-edit'));
      if (!t) {
        out.errors.push('teardown 阶段未进入编辑态');
      } else {
        const text = 'teardown-' + Date.now().toString(36);
        t.value = text;
        window.__gsmSetNarrow(true);
        await until(() => !q('.stars-grid-container'));
        const saved = (window.__gmStore['stars_notes_999'] || {})[rid];
        const left = document.querySelectorAll('.stars-grid-container, .gsm-top-pager').length;
        out.steps.push('teardown=' + JSON.stringify({ saved, gsmNodesLeft: left, editor: !!q('.stars-card-notes-edit') }));
        if (saved !== text) out.errors.push('收窄回滚时草稿未提交: ' + JSON.stringify(saved) + '（若 premise_blurOnRemove=false，说明标签页没有前台焦点，blur 不派发 —— 先把浏览器窗口切到前台再跑）');
        if (left !== 0) out.errors.push('收窄回滚后仍残留脚本节点: ' + left);
        if (q('.stars-card-notes-edit')) out.errors.push('收窄回滚后仍残留编辑器');
        // 手工清掉这条探针备注（__gmStore 只活这一次页面加载，不留到下次）
        window.__gmStore['stars_notes_999'][rid] = '';
        // 回到桌面：重新走转换管线，后面的清理步骤还能用
        window.__gsmSetNarrow(false);
        await until(() => q('.stars-grid-container'));
      }
    }

    // ⑦ 正在编辑时这张卡被 unstar（外部取关走同一条 `syncCardAfterStarChange`）：
    //    草稿必须并进 24h 宽限期备份，**不能**写回活区；刷成只读之后**不能再点开编辑框**。
    //    这是 4.20.1 修的缺陷的回归锁：Chromium 在把聚焦元素**摘除之前**就派发 blur
    //    （实测 isConnected 仍为 true），所以单靠 `isConnected` 守卫挡不住「重绘摘编辑器」那一下 ——
    //    编辑器会把它当用户提交：① 草稿写回活区（外部取关后活区该为空）② commit 里的
    //    `renderNotes()` 把「点击进编辑」监听重新绑上 ⇒ 只读卡片又能点开、又能写。
    {
      const card = cards()[0];
      const notes = card && card.querySelector('.stars-card-notes');
      if (!card || !notes) {
        out.errors.push('unstar 阶段找不到可用的卡片');
      } else {
        const rid = card.dataset.repoId;
        notes.click();
        const t = await until(() => card.querySelector('.stars-card-notes-edit'));
        if (!t) {
          out.errors.push('unstar 阶段未进入编辑态');
        } else {
          const text = 'unstar-' + Date.now().toString(36);
          t.value = text;
          // 写桩：目标解析 + 写入成功（不真的发请求，也不碰真数据）
          window.__gmStore['github_pat'] = 'ghp_' + 'p'.repeat(32);
          window.__gsmSetFetch(async (input) => {
            const url = String(input && input.url ? input.url : input);
            if (url.indexOf('/repositories/') !== -1) {
              return new Response(JSON.stringify({ id: Number(rid), full_name: 'probe/repo' }), { status: 200 });
            }
            return new Response(null, { status: 204 });
          });
          card.querySelector('.stars-star-btn').click();
          await until(() => notes.dataset.gsmCardState === 'locked-pending', 5000);
          const state = notes.dataset.gsmCardState;
          const grace = ((window.__gmStore['stars_pending_delete_999'] || {})[rid] || {})._note;
          const live = (window.__gmStore['stars_notes_999'] || {})[rid];
          notes.click(); // 只读卡片点一下：不该再进编辑态
          await wait(150);
          const reopened = !!card.querySelector('.stars-card-notes-edit');
          const tagAdd = !!card.querySelector('.stars-tag-add');
          out.steps.push(
            'unstar=' + JSON.stringify({ state, grace: grace || null, live: live || null, reopened, tagAdd }),
          );
          if (state !== 'locked-pending') out.errors.push('unstar 后卡片未转只读: ' + JSON.stringify(state));
          if (grace !== text) out.errors.push('unstar 时草稿未并进宽限期备份: ' + JSON.stringify(grace));
          if (live) out.errors.push('unstar 时草稿被写回活区（应为空）: ' + JSON.stringify(live));
          if (reopened) out.errors.push('只读卡片点一下又进了编辑态（4.20.1 的缺陷复发）');
          if (tagAdd) out.errors.push('只读卡片仍渲染了「添加标签」入口');
          // 收尾：撤掉写桩与这次探针写入的备份/备注，夹具不留痕
          window.__gsmSetFetch(null);
          delete window.__gmStore['github_pat'];
          delete (window.__gmStore['stars_pending_delete_999'] || {})[rid];
          delete (window.__gmStore['stars_notes_999'] || {})[rid];
        }
      }
    }

    if (window.__errors && window.__errors.length) out.errors.push.apply(out.errors, window.__errors);
    return out;
  } catch (e) {
    return { errors: out.errors.concat(['异常: ' + (e && e.message)]), steps: out.steps };
  } finally {
    // 清理：撤掉探针备注与标签（失败路径也要撤，否则会在 GM 存储里残留）
    try {
      if (gridObserver) gridObserver.disconnect();
      const first = cards()[0];
      if (first) {
        const notes = first.querySelector('.stars-card-notes');
        if (notes && !first.querySelector('.stars-card-notes-edit')) {
          notes.click();
          await wait(40);
          const ta = first.querySelector('.stars-card-notes-edit');
          if (ta) { ta.value = ''; ta.blur(); await wait(250); }
        }
      }
      for (const card of cards()) {
        const pill = Array.from(card.querySelectorAll('.stars-tag'))
          .find((e) => e.textContent.replace('×', '').trim() === TAG);
        const del = pill ? pill.querySelector('.stars-tag-del') : null;
        if (del) { del.click(); await wait(200); }
      }
      out.steps.push('cleanup=' + JSON.stringify({ page: pageNo(), tags: qa('.stars-grid-container .stars-tag').length }));
    } catch (e) {
      out.steps.push('cleanup 失败: ' + (e && e.message));
    }
  }
})();
