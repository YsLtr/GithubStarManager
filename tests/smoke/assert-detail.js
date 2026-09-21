// 仓库详情页断言：数据缓存 + unstar 移入待删除区（备份标签/备注）
// 用法：agent-browser-cli exec --tab <id> --file tests/smoke/assert-detail.js
(function () {
  const out = { errors: window.__errors || [] };
  const store = window.__gmStore;
  try {
    // 仓库详情页不应注入本项目样式（agent-browser-cli 扩展自己的 style 不算）
    out.ourStyleInjected_shouldBeFalse = Array.from(document.querySelectorAll('style'))
      .some((s) => (s.textContent || '').includes('.stars-grid-card'));
    out.cached = store['stars_repo_cache']['123'] || null;
    out.tagModeNothing = document.querySelectorAll('.stars-grid-card').length;

    // 触发 unstar 表单 submit
    const form = document.querySelector('.starred form[action$="/unstar"]');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    out.afterUnstar = {
      cacheHas123: '123' in store['stars_repo_cache'],
      pending: store['stars_pending_delete']['123'] || null,
      tagsAfter: store['stars_tags_999'],
      notesAfter: store['stars_notes_999']
    };
  } catch (e) {
    out.errors.push('assert: ' + e.message + ' @ ' + (e.stack || '').split('\n')[1]);
  }
  return JSON.stringify(out, null, 1);
})();
