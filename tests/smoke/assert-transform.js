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
    // Lists 区块必须整行隐藏（标题行带 d-flex，内联 display:none 会被 !important 压过）
    const listsHeading = Array.from(document.querySelectorAll('#user-profile-frame h2.f3-light'))
      .find((h) => (h.textContent || '').includes('Lists'));
    const listsRow = listsHeading ? listsHeading.parentElement : null;
    const listsContainer = document.getElementById('profile-lists-container');
    out.listsRow = listsRow ? {
      computedDisplay: getComputedStyle(listsRow).display,
      height: Math.round(listsRow.getBoundingClientRect().height),
      marked: listsRow.classList.contains('stars-lists-hidden')
    } : null;
    out.listsContainer = listsContainer ? {
      computedDisplay: getComputedStyle(listsContainer).display,
      height: Math.round(listsContainer.getBoundingClientRect().height)
    } : null;
    out.tagFilterOptions = document.querySelectorAll('#stars-tag-filter-list .ActionListItem').length;
    out.tagPills = document.querySelectorAll('.stars-card-tags .stars-tag').length;
    out.notesPlaceholders = document.querySelectorAll('.stars-card-notes-placeholder').length;
    out.noteText = text(document.querySelector('.stars-card-notes-text'));
    out.styleInjected = Array.from(document.querySelectorAll('style')).some((s) => (s.textContent || '').includes('.stars-grid-card'));
    out.cacheKeys = Object.keys(window.__gmStore['stars_repo_cache'] || {});
    out.cacheEntry123 = window.__gmStore['stars_repo_cache']['123'];
    out.cacheEntry456 = window.__gmStore['stars_repo_cache']['456'];


    // 字段级断言（新 DOM 下最容易回归的部分）
    const e123 = window.__gmStore['stars_repo_cache']['123'] || {};
    const e456 = window.__gmStore['stars_repo_cache']['456'] || {};
    out.extracted = {
      name123: e123.name,
      lang123: e123.lang,
      stars123: e123.stars,
      forks123: e123.forks,
      updatedAt123: e123.updatedAt,
      updatedFieldGone: !('updated' in e123), // 4.9.0：updated 字段已删，卡片相对时间由渲染现算
      name456: e456.name,
      lang456: e456.lang,
      stars456: e456.stars,
      forks456: e456.forks,
      updatedAt456: e456.updatedAt
    };
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
