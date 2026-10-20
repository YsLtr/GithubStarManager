// 回归守卫：非首页（第 2 页）增删卡片标签后页码保持 —— 对应 DEVELOPER.md §7 的 keepPage 不变式。
//
// 用法：
//   node tests/diag/gen-keep-page-harness.cjs   # 生成 70 仓库 / 3 页夹具（内联当前 dist，先跑 pnpm build）
//   agent-browser-cli open --focus "file:///<repo>/.diag/jump-harness.html?tab=stars"
//   agent-browser-cli exec --tab <id> --file tests/diag/assert-keep-page.js
//
// 断言覆盖：① 加标签保页码 ② 删标签保页码 ③ 点标签胶囊（筛选条件变更）回第 1 页。
// 夹具 URL 必须带 ?tab=stars，否则脚本不转换、grid 为 0 会被误读成全绿。
return (async function () {
  const out = { errors: [], steps: [] };
  const q = (s) => document.querySelector(s);
  const qa = (s) => Array.from(document.querySelectorAll(s));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // 顶部那份是标题行克隆件、底部那份是本体；两份读同一状态，取第一个即可
  const pageText = () => {
    const b = q('button.gsm-page-info');
    return b ? b.textContent.trim() : null;
  };
  const pageNo = () => {
    const m = /^(\d+)\s*\/\s*(\d+)$/.exec(pageText() || '');
    return m ? { page: +m[1], total: +m[2] } : null;
  };
  const firstCard = () => {
    const a = q('.stars-grid-container .stars-grid-card a');
    return a ? a.textContent.trim() : null;
  };
  // 首卡断言取不到卡片时报错：否则 null !== null 为假 ⇒ 网格为空时断言静默通过
  const assertFirstCard = (phase, before) => {
    const now = firstCard();
    if (now === null) out.errors.push(phase + '后取不到首卡（网格为空）');
    else if (now !== before) out.errors.push(phase + '后首卡变了: ' + before + ' -> ' + now);
  };
  const pillTexts = () => qa('.stars-grid-container .stars-tag').map((e) => e.textContent.replace('×', '').trim());
  const gotoPage = async (n) => {
    q('button.gsm-page-info').click();
    await wait(60);
    const input = q('input.gsm-page-input');
    if (!input) return false;
    input.value = String(n);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await wait(200);
    return true;
  };
  const addTag = async (name) => {
    const btn = q('.stars-grid-container .stars-grid-card .stars-tag-add');
    if (!btn) return false;
    btn.click();
    await wait(60);
    const input = q('.stars-grid-container .stars-grid-card .stars-tag-input');
    if (!input) return false;
    input.value = name;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await wait(200);
    return true;
  };
  const delTag = async (name) => {
    const pill = qa('.stars-grid-container .stars-grid-card .stars-tag')
      .find((e) => e.textContent.replace('×', '').trim() === name);
    const del = pill ? pill.querySelector('.stars-tag-del') : null;
    if (!del) return false;
    del.click();
    await wait(200);
    return true;
  };

  // 唯一名：确保走真实的新增分支（重名会早退、不经 applyFilters ⇒ 断言空转）。
  // 声明在 try 之外：finally 的清理需要读同一个名字。
  const TAG = 'probe-' + Date.now().toString(36);

  try {
    if (!q('button.gsm-page-info')) return { errors: ['harness 未转换：无分页器（URL 是否缺 ?tab=stars）'], steps: out.steps };


    await gotoPage(2);
    out.steps.push('page2=' + pageText());
    if (!pageNo() || pageNo().page !== 2) return { errors: ['未能进入第 2 页: ' + pageText()], steps: out.steps };

    const cardBefore = firstCard();
    out.steps.push('firstCard=' + cardBefore + ' tags=' + JSON.stringify(pillTexts()));

    // ① 加标签：保页码、首卡不变、胶囊出现
    if (!(await addTag(TAG))) return { errors: ['加标签失败：找不到 .stars-tag-add 或输入框'], steps: out.steps };
    out.steps.push('afterAdd=' + pageText() + ' tags=' + JSON.stringify(pillTexts()));
    if (!pageNo() || pageNo().page !== 2) out.errors.push('加标签后页码变了: ' + pageText());
    assertFirstCard('加标签', cardBefore);
    if (!pillTexts().includes(TAG)) out.errors.push('加标签后胶囊未出现: ' + TAG);

    // ② 删标签：保页码、首卡不变、胶囊消失
    if (!(await delTag(TAG))) out.errors.push('找不到 ' + TAG + ' 胶囊的删除按钮');
    out.steps.push('afterDelete=' + pageText() + ' tags=' + JSON.stringify(pillTexts()));
    if (!pageNo() || pageNo().page !== 2) out.errors.push('删标签后页码变了: ' + pageText());
    assertFirstCard('删标签', cardBefore);
    if (pillTexts().includes(TAG)) out.errors.push('删标签后胶囊仍在: ' + TAG);

    // ③ 点标签胶囊 = 筛选条件变更 ⇒ 回第 1 页（与 ①② 形成对照：保页码只对条件未变的重绘成立）
    if (!(await addTag(TAG))) return { errors: out.errors.concat(['反证阶段加标签失败']), steps: out.steps };
    const target = qa('.stars-grid-container .stars-grid-card .stars-tag')
      .find((e) => e.textContent.replace('×', '').trim() === TAG);
    if (!target) return { errors: out.errors.concat(['反证阶段找不到 ' + TAG + ' 胶囊']), steps: out.steps };
    target.click();
    await wait(200);
    out.steps.push('afterPillClick=' + pageText() + ' cards=' + qa('.stars-grid-container .stars-grid-card').length);
    if (!pageNo() || pageNo().page !== 1) out.errors.push('点胶囊（条件变更）未回第 1 页: ' + pageText());

    return out;
  } catch (e) {
    return { errors: out.errors.concat(['异常: ' + (e && e.message)]), steps: out.steps };
  } finally {
    // 清理放在 finally：失败或异常路径同样要撤掉探针标签，否则会在 GM 存储里残留 probe-*
    try {
      const samePill = qa('.stars-grid-container .stars-grid-card .stars-tag')
        .find((e) => e.textContent.replace('×', '').trim() === TAG);
      if (samePill) { samePill.click(); await wait(200); }
      if (pageNo() && pageNo().total > 1) { await gotoPage(2); await delTag(TAG); }
      out.steps.push('cleanup=' + pageText() + ' tags=' + JSON.stringify(pillTexts()));
    } catch (e) {
      out.steps.push('cleanup 失败: ' + (e && e.message));
    }
  }
})();
