// 转换 + 标签/备注/筛选栏断言（在 tests/smoke/fixture.html 上执行）
// 用法：agent-browser-cli exec --tab <id> --file tests/smoke/assert-transform.js
(function () {
  const out = { errors: window.__errors || [] };
  const text = (el) => (el ? (el.textContent || '').trim() : null);
  try {
    out.cards = document.querySelectorAll('.stars-grid-card').length;
    out.originalHidden = document.querySelectorAll('.stars-original-hidden').length;
    out.gridExists = !!document.querySelector('.stars-grid-container');
    out.paginatorCloned = document.querySelectorAll('.stars-grid-container .paginate-container').length;
    out.rightSidebarTopics = text(document.querySelector('.stars-right-sidebar'));
    out.rightSidebarInsideLayout = !!document.querySelector('.Layout--sidebarPosition-start > .stars-right-sidebar');
    out.tagFilterBtn = !!document.getElementById('stars-tag-filter-button');
    out.tagFilterOptions = document.querySelectorAll('#stars-tag-filter-list .ActionListItem').length;
    out.tagPills = document.querySelectorAll('.stars-card-tags .stars-tag').length;
    out.notesPlaceholders = document.querySelectorAll('.stars-card-notes-placeholder').length;
    out.noteText = text(document.querySelector('.stars-card-notes-text'));
    out.styleInjected = Array.from(document.querySelectorAll('style')).some((s) => (s.textContent || '').includes('.stars-grid-card'));
    out.cacheKeys = Object.keys(window.__gmStore['stars_repo_cache'] || {});
    out.cacheEntry123 = window.__gmStore['stars_repo_cache']['123'];
    out.cacheEntry456 = window.__gmStore['stars_repo_cache']['456'];

    // 点击第一个 tag pill → 进入 tags 自定义模式
    document.querySelector('.stars-card-tags .stars-tag').click();
    out.afterTagClick = {
      cachedCards: document.querySelectorAll('.stars-grid-card-cached').length,
      originalFiltered: document.querySelectorAll('.stars-tag-filtered').length,
      infoBarText: text(document.querySelector('.stars-tag-info-bar')),
      customLangBtn: !!document.getElementById('stars-custom-lang-button'),
      customSortBtn: !!document.getElementById('stars-custom-sort-button'),
      nativeLangHidden: (function () {
        const m = document.getElementById('stars-language-filter-menu-button');
        return m ? getComputedStyle(m.closest('action-menu')).display === 'none' : null;
      })(),
      tagBtnLabel: text(document.querySelector('#stars-tag-filter-button .Button-label')),
      langOptions: document.querySelectorAll('#stars-custom-lang-overlay .ActionListItem').length,
      activeTagPills: document.querySelectorAll('.stars-card-tags .stars-tag.stars-tag-active').length
    };
  } catch (e) {
    out.errors.push('assert: ' + e.message + ' @ ' + (e.stack || '').split('\n')[1]);
  }
  return JSON.stringify(out, null, 1);
})();
