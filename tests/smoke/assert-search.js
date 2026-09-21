// 全缓存搜索断言（在干净的 tests/smoke/fixture.html 上执行）
// 用法：agent-browser-cli exec --tab <id> --file tests/smoke/assert-search.js
(function () {
  const out = { errors: window.__errors || [] };
  const text = (el) => (el ? (el.textContent || '').trim() : null);
  try {
    const input = document.querySelector('input[placeholder*="Search starred"]');
    input.value = 'rust';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    out.afterSearch = {
      cachedCards: document.querySelectorAll('.stars-grid-card-cached').length,
      infoBarText: text(document.querySelector('.stars-tag-info-bar')),
      originalFiltered: document.querySelectorAll('.stars-tag-filtered').length,
      customLangBtn: !!document.getElementById('stars-custom-lang-button'),
      langOptions: Array.from(document.querySelectorAll('#stars-custom-lang-overlay .ActionListItem-label')).map((e) => e.textContent)
    };

    // 多词搜索（每个词都要命中）
    input.value = 'rust 第二个';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    out.afterMultiTerm = {
      cachedCards: document.querySelectorAll('.stars-grid-card-cached').length,
      infoBarText: text(document.querySelector('.stars-tag-info-bar'))
    };

    // 搜不到
    input.value = 'zzzznotfound';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    out.afterMiss = {
      cachedCards: document.querySelectorAll('.stars-grid-card-cached').length,
      infoBarText: text(document.querySelector('.stars-tag-info-bar'))
    };
  } catch (e) {
    out.errors.push('assert: ' + e.message + ' @ ' + (e.stack || '').split('\n')[1]);
  }
  return JSON.stringify(out, null, 1);
})();
