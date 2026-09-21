// 仓库详情页断言：内嵌 JSON 提取 + unstar/re-star 宽限期流程
// 用法：agent-browser-cli exec --tab <id> --file tests/smoke/assert-detail.js
(async () => {
  const out = { errors: window.__errors || [] };
  const store = window.__gmStore;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const btn = () => document.querySelector('button[data-testid="star-button"]');
  const clickStar = () => btn().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

  try {
    // 详情页不应注入本项目样式（扩展自己的 style 不算）
    out.ourStyleInjected_shouldBeFalse = Array.from(document.querySelectorAll('style'))
      .some((s) => (s.textContent || '').includes('.stars-grid-card'));
    out.gridShouldBeAbsent = document.querySelectorAll('.stars-grid-container').length;

    // 1. 内嵌 JSON 提取
    out.cached = store.stars_repo_cache['123'] || null;

    // 2. 点 star 按钮（aria-label 从 Unstar 翻到 Star）→ 应移入待删除区并备份标签/备注
    btn().setAttribute('aria-label', 'Star alpha/one');
    clickStar();
    await sleep(1200);
    out.afterUnstar = {
      cacheHas123: '123' in store.stars_repo_cache,
      pending: store.stars_pending_delete['123'] || null,
      tagsAfter: store['stars_tags_999'],
      notesAfter: store['stars_notes_999']
    };

    // 3. 再点回来（Star → Unstar）→ 应从待删除区完整恢复
    btn().setAttribute('aria-label', 'Unstar alpha/one');
    clickStar();
    await sleep(1200);
    out.afterRestar = {
      cacheHas123: '123' in store.stars_repo_cache,
      restored: store.stars_repo_cache['123'] || null,
      pendingEmpty: Object.keys(store.stars_pending_delete).length,
      tagsRestored: store['stars_tags_999'],
      notesRestored: store['stars_notes_999']
    };
  } catch (e) {
    out.errors.push('assert: ' + e.message + ' @ ' + (e.stack || '').split('\n')[1]);
  }
  return JSON.stringify(out, null, 1);
})();
