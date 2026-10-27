// 守卫：编辑中「点另一处」不能被吃掉（4.21.0）。
//
// 被测缺陷（夹具 trusted click 实测）：编辑框里有未提交文字时点别处，commit 在 mousedown 与
// mouseup 之间同步重画（renderTags / renderNotes / applyFilters → replaceChildren），mousedown 的
// 目标节点因此离场 ⇒ 浏览器**不派发 click**（夹具 __evlog 里连一条 click 都没有），或把它重定向到
// 共同祖先 ⇒ 用户那一下点击静默失效。备注编辑框还有第二重：退出编辑态时卡片高度缩回（实测
// 208→183），mouseup 落在别的元素上，click 同样被重定向。
//
// 断言的是**使其成立的那条不变式**：从 pointerdown 到 click 之间，按下的目标节点必须仍在文档里、
// 几何不变；编辑器自己的收尾必须发生在 click 之后。数据落盘必须仍同步发生（这一击可能导航走）。
//
// 跑法：`pnpm build && node tests/diag/gen-edit-click-harness.cjs` →
//   `agent-browser-cli open --focus "file:///<repo>/.diag/edit-click-harness.html?tab=stars"` →
//   `agent-browser-cli exec --tab <id> --file tests/diag/assert-edit-click.js`
// 夹具必须前台可见（后台标签页的合成事件与计时都会失真）。
(() => {
  const errors = [];
  const steps = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const card = (id) => document.querySelector(`.stars-grid-card[data-repo-id="${id}"]`);
  const fail = (msg) => errors.push(msg);
  // 分区键必须与生成器的 USER_ID 一致（998，不是 fixture.html 里那个 999）：
  // 三个夹具同源，用 999 会把本夹具的种子标签泄进另外两个 70 仓库夹具的命名空间。
  const tags = () => window.GM_getValue('stars_tags_998', {});
  const notes = () => window.GM_getValue('stars_notes_998', {});

  /**
   * 一次点击的按下阶段。同时模拟浏览器在 mousedown 上的默认行为（焦点转移）——
   * 合成事件不带默认动作，不自己补这一步就永远触发不了「编辑中失焦」。
   */
  const press = (target) => {
    const active = document.activeElement;
    const focusable = target.closest('button, input, textarea, a[href], [tabindex], [popovertarget]');
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    if (focusable && focusable !== active) focusable.focus?.();
    else if (active && active !== document.body && !target.contains(active)) active.blur();
  };

  /** 松开 + click（真实链路上 click 由浏览器发；这里手发一次让目标的处理器真的跑） */
  const release = (target) => {
    target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  };

  /** 在按下与 click 之间检查「目标还在原位」这条不变式 */
  const checkHeld = (label, target) => {
    if (!target.isConnected) return fail(`${label}：按下的目标在松开前离场（click 会被丢掉）`);
    const now = target.getBoundingClientRect();
    if (Math.abs(now.top - target.__gsmTop) > 0.5) {
      fail(`${label}：按下到松开之间目标位移 ${(now.top - target.__gsmTop).toFixed(1)}px（click 会被重定向）`);
    }
  };

  const markBox = (target) => { target.__gsmTop = target.getBoundingClientRect().top; };
  const gridCards = () => document.querySelectorAll('.stars-grid-container > .stars-grid-card').length;

  const openTagEditor = (id, value) => {
    const add = card(id).querySelector('.stars-tag-add');
    if (!add) return null;
    add.click();
    const input = card(id).querySelector('.stars-tag-input');
    if (!input) return null;
    input.value = value;
    input.focus();
    return input;
  };

  return (async () => {
    if (location.hash === '#narrow') return { skipped: true };
    // 网格是脚本异步建起来的（GM 读取 + 首帧渲染），不等它就会拿到 null
    for (let i = 0; i < 60 && !document.querySelector('.stars-grid-card[data-repo-id="1"]'); i += 1) {
      await sleep(50);
    }
    if (!card('1')) return { errors: ['夹具没有卡片（场景没生效？）'], steps };

    /* ---------- A：标签输入框开着 → 点另一张卡的备注区 ---------- */
    if (!openTagEditor('1', 'press-draft')) {
      return { errors: ['A：点 + 后没有出现标签输入框'], steps };
    }
    const noteTarget = card('2').querySelector('.stars-card-notes');
    markBox(noteTarget);
    press(noteTarget);
    await sleep(0);
    if (!card('1')?.querySelector('.stars-tag-input')) fail('A：按下瞬间就收掉了卡 1 的输入框（收尾没避开手势）');
    if (!tags()['1']?.includes('press-draft')) fail('A：草稿没有在 blur 里同步落盘（这一击可能导航走）');
    checkHeld('A', noteTarget);
    release(noteTarget);
    await sleep(40);
    if (!card('2').querySelector('.stars-card-notes-edit')) fail('A：点卡 2 备注没有进入编辑态（这一击被吃掉了）');
    if (card('1').querySelector('.stars-tag-input')) fail('A：手势结束后卡 1 的输入框没有收尾（会一直挂着）');
    steps.push(`A noteOpened=${!!card('2').querySelector('.stars-card-notes-edit')} cards=${gridCards()}`);

    /* ---------- B：备注编辑中 → 点另一张卡的「+」 ---------- */
    const add3 = card('3').querySelector('.stars-tag-add');
    markBox(add3);
    press(add3);
    await sleep(0);
    if (!card('2').querySelector('.stars-card-notes-edit')) fail('B：按下瞬间就收掉了卡 2 的备注编辑框');
    checkHeld('B', add3);
    release(add3);
    await sleep(40);
    if (!card('3').querySelector('.stars-tag-input')) fail('B：点卡 3 的 + 没有打开输入框（这一击被吃掉了）');
    if (card('2').querySelector('.stars-card-notes-edit')) fail('B：卡 2 的备注编辑框没在失焦后收尾');
    if (notes()['2'] !== 'note-2') fail(`B：卡 2 的备注被写坏：${JSON.stringify(notes()['2'])}`);
    steps.push(`B input3=${!!card('3').querySelector('.stars-tag-input')} cards=${gridCards()}`);

    /* ---------- C：标签输入框开着 → 点上方筛选栏（对照组，它不在网格里） ---------- */
    const input3 = card('3').querySelector('.stars-tag-input');
    input3.value = 'press-draft-3';
    input3.focus();
    const tagBtn = document.querySelector('#stars-tag-filter-button');
    if (!tagBtn) fail('C：没有 Tags 筛选按钮');
    else {
      markBox(tagBtn);
      press(tagBtn);
      await sleep(0);
      if (!card('3').querySelector('.stars-tag-input')) fail('C：按下瞬间就收掉了卡 3 的输入框');
      checkHeld('C', tagBtn);
      release(tagBtn);
      await sleep(40);
      if (!tags()['3']?.includes('press-draft-3')) fail('C：卡 3 的草稿没落盘');
      if (!document.querySelector('#stars-tag-filter-overlay')?.matches(':popover-open')) {
        fail('C：点 Tags 按钮没有弹出面板');
      }
      steps.push(`C overlayOpen=${document.querySelector('#stars-tag-filter-overlay')?.matches(':popover-open')} input3Gone=${!card('3').querySelector('.stars-tag-input')}`);
    }

    /* ---------- D：备注编辑中 → 点另一张卡的标签胶囊（走 applyFilters；挂起门与推迟收尾合流） ---------- */
    if (document.querySelector('#stars-tag-filter-overlay')?.matches(':popover-open')) {
      document.querySelector('#stars-tag-filter-button')?.click(); // 关掉面板，别挡住底下的卡片
    }
    await sleep(10);
    const note4 = card('4')?.querySelector('.stars-card-notes');
    const pill5 = card('5')?.querySelector('.stars-tag');
    if (!note4 || !pill5) fail('D：卡 4/卡 5 结构不符预期');
    else {
      note4.click();
      const edit4 = card('4').querySelector('.stars-card-notes-edit');
      if (!edit4) fail('D：点卡 4 备注没有进入编辑态');
      else {
        edit4.value = 'note-4-draft';
        markBox(pill5);
        press(pill5);
        await sleep(0);
        if (!card('4').querySelector('.stars-card-notes-edit')) fail('D：按下瞬间就收掉了卡 4 的备注编辑框');
        checkHeld('D', pill5);
        release(pill5);
        await sleep(100);
        if (!document.querySelector('.stars-tag-info-bar')) fail('D：点胶囊没有切换筛选（这一击被吃掉了）');
        if (gridCards() !== 1) fail(`D：筛选后网格应只剩 1 张卡，实际 ${gridCards()}（挂起重绘没补跑）`);
        if (notes()['4'] !== 'note-4-draft') fail(`D：卡 4 的备注草稿没落盘：${JSON.stringify(notes()['4'])}`);
        steps.push(`D filteredCards=${gridCards()} infoBar=${!!document.querySelector('.stars-tag-info-bar')}`);
      }
    }
    // 清理 D 造成的筛选（否则后面的场景只剩一张卡）：点信息条的 Clear filter，等网格回到 6 张
    document.querySelector('.stars-tag-info-bar .issues-reset-query')?.click();
    for (let i = 0; i < 40 && gridCards() < 6; i += 1) await sleep(25);

    /* ---------- E：备注编辑中（高度会缩回的那一格）→ 点下一行的卡片 ---------- */
    const note6 = card('6').querySelector('.stars-card-notes');
    note6.click();
    const edit6 = card('6').querySelector('.stars-card-notes-edit');
    if (!edit6) fail('E：点卡 6 备注没有进入编辑态');
    else {
      edit6.value = 'note-6-draft';
      const heightBefore = card('6').getBoundingClientRect().height;
      const lower = card('1').querySelector('.stars-card-notes');
      markBox(lower);
      press(lower);
      await sleep(0);
      checkHeld('E', lower);
      if (!note6.contains(card('6').querySelector('.stars-card-notes-edit') ?? note6)) {
        fail('E：按下瞬间就收掉了卡 6 的备注编辑框');
      }
      release(lower);
      await sleep(40);
      if (!card('1').querySelector('.stars-card-notes-edit')) fail('E：点下一行卡片没有进入编辑态（这一击被吃掉了）');
      if (notes()['6'] !== 'note-6-draft') fail(`E：卡 6 的草稿没落盘：${JSON.stringify(notes()['6'])}`);
      if (card('6').getBoundingClientRect().height > heightBefore + 0.5) fail('E：收尾后卡 6 没有回到文本态高度');
      steps.push(`E noteOpened=${!!card('1').querySelector('.stars-card-notes-edit')} h=${heightBefore}->${card('6').getBoundingClientRect().height}`);
    }

    return {
      errors: errors.concat(window.__errors || []),
      steps,
      snapshot: { tags1: tags()['1'], tags3: tags()['3'], note6: notes()['6'], cards: gridCards() },
    };
  })();
})();
