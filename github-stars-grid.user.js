// ==UserScript==
// @name         GitHub Stars Grid View
// @namespace    https://github.com/YsLtr
// @version      2.2
// @description  将 GitHub Stars 页面的列表视图改为卡片网格视图，缩小左侧个人资料栏，最大化仓库展示空间（仅桌面端生效）
// @author       YsLtr
// @match        https://github.com/*tab=stars*
// @match        https://github.com/*/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ====== 判断页面类型 ======
  const isStarsPage = /[?&]tab=stars/.test(location.search);
  const repoIdMeta = document.querySelector('meta[name="octolytics-dimension-repository_id"]');
  const isRepoDetailPage = !isStarsPage && !!repoIdMeta;

  // ====== 仓库缓存（全局共享） ======
  function loadRepoCache() {
    return GM_getValue('stars_repo_cache', {});
  }

  function saveRepoCache(all) {
    GM_setValue('stars_repo_cache', all);
  }

  function getRepoData(repoId) {
    return loadRepoCache()[repoId] || null;
  }

  function saveRepoData(repoId, data) {
    const all = loadRepoCache();
    all[repoId] = Object.assign({}, all[repoId] || {}, data, { ts: Date.now() });
    saveRepoCache(all);
  }

  // ====== 待删除区（pending delete） ======
  function loadPendingDelete() {
    return GM_getValue('stars_pending_delete', {});
  }
  function savePendingDelete(all) {
    GM_setValue('stars_pending_delete', all);
  }

  function markRepoUnstarred(repoId) {
    const cache = loadRepoCache();
    if (!cache[repoId]) return;
    const pending = loadPendingDelete();
    pending[repoId] = Object.assign({}, cache[repoId], {
      unstarredAt: Date.now(),
      _tags: getTags(repoId)
    });
    savePendingDelete(pending);
    delete cache[repoId];
    saveRepoCache(cache);
    saveTags(repoId, []);
  }

  function markRepoStarred(repoId) {
    const pending = loadPendingDelete();
    if (!pending[repoId]) return;
    const entry = pending[repoId];
    const tags = entry._tags || [];
    delete entry.unstarredAt;
    delete entry._tags;
    const cache = loadRepoCache();
    cache[repoId] = entry;
    saveRepoCache(cache);
    if (tags.length > 0) saveTags(repoId, tags);
    delete pending[repoId];
    savePendingDelete(pending);
  }

  function cleanupExpiredUnstarred() {
    const pending = loadPendingDelete();
    const GRACE_PERIOD = 24 * 60 * 60 * 1000;
    const now = Date.now();
    let changed = false;
    for (const repoId in pending) {
      if (pending[repoId].unstarredAt && (now - pending[repoId].unstarredAt) > GRACE_PERIOD) {
        delete pending[repoId];
        changed = true;
      }
    }
    if (changed) savePendingDelete(pending);
  }

  // ====== 每用户标签存储 ======
  function getStarsUserId() {
    const meta = document.querySelector('meta[name="octolytics-dimension-user_id"]');
    return meta ? meta.getAttribute('content') : '';
  }

  function loadAllTags() {
    const userId = getStarsUserId();
    if (!userId) return GM_getValue('stars_tags', {});
    return GM_getValue('stars_tags_' + userId, {});
  }

  function saveTags(repoId, tagsArray) {
    const userId = getStarsUserId();
    const key = userId ? 'stars_tags_' + userId : 'stars_tags';
    const all = GM_getValue(key, {});
    if (tagsArray.length === 0) {
      delete all[repoId];
    } else {
      all[repoId] = tagsArray;
    }
    GM_setValue(key, all);
  }

  function getTags(repoId) {
    return loadAllTags()[repoId] || [];
  }

  // ====== 迁移旧标签数据 ======
  function migrateTagsIfNeeded() {
    const userId = getStarsUserId();
    if (!userId) return;
    const oldData = GM_getValue('stars_tags', null);
    const newKey = 'stars_tags_' + userId;
    const newData = GM_getValue(newKey, null);
    if (oldData && !newData) {
      GM_setValue(newKey, oldData);
    }
  }

  // ====== 仓库详情页：提取并缓存数据 ======
  function extractAndCacheRepoFromDetailPage() {
    if (!repoIdMeta) return;
    const repoId = repoIdMeta.getAttribute('content');
    if (!repoId) return;

    // Don't cache repos the current user hasn't starred
    const toggler = document.querySelector('.js-toggler-container.starring-container');
    if (toggler) {
      const starredDiv = toggler.querySelector('.starred');
      if (starredDiv && getComputedStyle(starredDiv).display === 'none') return;
    }

    const nwoMeta = document.querySelector('meta[name="octolytics-dimension-repository_nwo"]');
    const name = nwoMeta ? nwoMeta.getAttribute('content') : '';

    // Description
    const descEl = document.querySelector('.BorderGrid-cell p');
    const desc = descEl ? descEl.textContent.trim() : '';

    // Primary language + color
    let lang = '';
    let langColor = '';
    const langItems = document.querySelectorAll('.list-style-none li');
    if (langItems.length > 0) {
      const firstLangSpan = langItems[0].querySelector('span');
      if (firstLangSpan) lang = firstLangSpan.textContent.trim();
    }
    const progressItems = document.querySelectorAll('.Progress-item');
    // First Progress-item with a real background-color
    for (const pi of progressItems) {
      const bg = pi.style.backgroundColor;
      if (bg) {
        langColor = bg;
        break;
      }
    }

    // Stars (precise number)
    let stars = 0;
    const starCounter = document.querySelector('#repo-stars-counter-star') ||
                        document.querySelector('#repo-stars-counter-unstar');
    if (starCounter) {
      const ariaLabel = starCounter.getAttribute('aria-label') || '';
      const ariaMatch = ariaLabel.match(/([\d,]+)\s+users?\s+starred/);
      if (ariaMatch) {
        stars = parseInt(ariaMatch[1].replace(/,/g, ''), 10);
      } else {
        const titleAttr = starCounter.getAttribute('title') || '';
        stars = parseInt(titleAttr.replace(/,/g, ''), 10) || 0;
      }
    }

    // Forks (precise number)
    let forks = 0;
    const forkCounter = document.querySelector('#repo-network-counter');
    if (forkCounter) {
      const titleAttr = forkCounter.getAttribute('title') || '';
      forks = parseInt(titleAttr.replace(/,/g, ''), 10) || 0;
    }

    // Updated (relative time from shadow DOM)
    let updated = '';
    const relTime = document.querySelector('.BorderGrid-cell relative-time');
    if (relTime && relTime.shadowRoot) {
      const shadowText = relTime.shadowRoot.textContent.trim();
      if (shadowText) updated = 'Updated ' + shadowText;
    }
    if (!updated && relTime) {
      // Fallback: use datetime attribute to construct something
      const dt = relTime.getAttribute('datetime');
      if (dt) updated = 'Updated ' + relTime.textContent.trim();
    }

    saveRepoData(repoId, { name, desc, lang, langColor, stars, forks, updated });
  }

  // 仓库详情页只做缓存，不修改 DOM
  if (isRepoDetailPage) {
    cleanupExpiredUnstarred();
    extractAndCacheRepoFromDetailPage();
    // 监听 unstar 表单提交，清除缓存数据
    const unstarForm = document.querySelector('.starred form[action$="/unstar"]');
    if (unstarForm) {
      unstarForm.addEventListener('submit', () => {
        const repoId = repoIdMeta.getAttribute('content');
        if (repoId) markRepoUnstarred(repoId);
      });
    }
    return;
  }

  // 非 Stars 页面且非仓库详情页，不执行
  if (!isStarsPage) return;

  // ====== 以下仅在 Stars 页面执行 ======

  const MOBILE_BREAKPOINT = 768;

  GM_addStyle(`
    /* ========================================
       所有样式仅在桌面端（>= 768px）生效
       ======================================== */
    @media (min-width: ${MOBILE_BREAKPOINT}px) {

      /* ===== 1. 页面容器加宽 ===== */
      .container-xl {
        max-width: 1600px !important;
      }

      /* ===== 2. 缩小左侧个人资料侧边栏 ===== */
      .Layout.Layout--sidebarPosition-start {
        --Layout-sidebar-width: 180px !important;
      }
      .Layout-sidebar {
        width: 180px !important;
        min-width: 180px !important;
      }

      /* 缩小头像 */
      .Layout-sidebar .avatar-user,
      .Layout-sidebar a[href*="avatars"] img {
        width: 120px !important;
        height: 120px !important;
      }
      .Layout-sidebar a[href*="avatars"] {
        width: 120px !important;
        height: 120px !important;
        display: block !important;
      }

      /* 缩小用户名字体 */
      .Layout-sidebar .vcard-names .p-name,
      .Layout-sidebar .vcard-names .p-nickname,
      .Layout-sidebar h1.vcard-names {
        font-size: 16px !important;
      }
      .Layout-sidebar .p-nickname {
        font-size: 14px !important;
      }

      /* 确保侧边栏各区域正常显示 */
      .Layout-sidebar .border-top.pt-3.mt-3.clearfix.hide-sm.hide-md {
        display: block !important;
      }

      /* 头像状态 emoji 移至头像右下角，防止被裁切 */
      .Layout-sidebar .js-profile-editable-replace {
        overflow: visible !important;
      }
      .Layout-sidebar .user-status-container.position-relative {
        position: static !important;
      }
      .Layout-sidebar .user-status-circle-badge-container {
        position: absolute !important;
        top: 86px !important;
        left: 86px !important;
        right: auto !important;
        bottom: auto !important;
        margin: 0 !important;
        z-index: 100 !important;
      }

      /* 侧边栏内容自适应窄宽度 */
      .Layout-sidebar .h-card {
        overflow: hidden !important;
        word-wrap: break-word !important;
      }
      .Layout-sidebar .js-profile-editable-replace {
        word-wrap: break-word !important;
      }

      /* 紧凑按钮与文字 */
      .Layout-sidebar .btn {
        padding: 3px 10px !important;
        font-size: 12px !important;
      }
      .Layout-sidebar .flex-order-2 {
        font-size: 13px !important;
      }

      /* ===== 3. 扩大主内容区域 ===== */
      .Layout-main {
        flex: 1 1 0% !important;
        max-width: calc(100% - 200px) !important;
      }

      /* 移除内部 3/9 分栏，col-lg-9 占满 */
      turbo-frame#user-starred-repos .d-lg-flex.gutter-lg {
        display: block !important;
      }
      turbo-frame#user-starred-repos .col-lg-9 {
        width: 100% !important;
        max-width: 100% !important;
        padding-left: 0 !important;
        padding-right: 0 !important;
      }
      /* 隐藏右侧 Starred topics */
      turbo-frame#user-starred-repos .col-lg-3 {
        display: none !important;
      }

      /* ===== 4. 隐藏 Lists 区域 ===== */
      turbo-frame#user-profile-frame > div > .my-3.d-flex.flex-justify-between.flex-items-center:has(h2.f3-light),
      turbo-frame#user-profile-frame > div > #profile-lists-container {
        display: none !important;
      }

      /* ===== 5. 网格容器 — 自适应列数 ===== */
      .stars-grid-container {
        display: grid !important;
        grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)) !important;
        gap: 16px !important;
        padding: 16px 0 !important;
      }

      /* ===== 6. 卡片样式 ===== */
      .stars-grid-card {
        border: 1px solid var(--borderColor-default, #d1d9e0) !important;
        border-radius: 6px !important;
        padding: 16px !important;
        display: flex !important;
        flex-direction: column !important;
        background: var(--bgColor-default, #ffffff) !important;
        box-sizing: border-box !important;
        min-width: 0 !important;
      }
      .stars-grid-card:hover {
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
      }

      /* 卡片标题 */
      .stars-grid-card .stars-card-header h3 {
        font-size: 14px !important;
        margin: 0 !important;
        font-weight: 600 !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        min-width: 0 !important;
      }
      .stars-grid-card .stars-card-header h3 a {
        color: var(--fgColor-accent, #0969da) !important;
      }

      /* 卡片描述 */
      .stars-grid-card .stars-card-desc {
        font-size: 12px !important;
        line-height: 1.5 !important;
        color: var(--fgColor-muted, #656d76) !important;
        display: -webkit-box !important;
        -webkit-line-clamp: 3 !important;
        -webkit-box-orient: vertical !important;
        overflow: hidden !important;
        margin: 0 0 12px 0 !important;
        min-width: 0 !important;
      }

      /* 卡片底部元信息 — 允许 Updated 时间换行 */
      .stars-grid-card .stars-card-meta {
        font-size: 12px !important;
        color: var(--fgColor-muted, #656d76) !important;
        display: flex !important;
        align-items: center !important;
        flex-wrap: wrap !important;
        gap: 4px 12px !important;
        margin-top: auto !important;
        min-width: 0 !important;
      }
      /* 语言 + star + fork 强制同一行 */
      .stars-grid-card .stars-card-meta .stars-meta-main {
        display: flex !important;
        align-items: center !important;
        flex-wrap: nowrap !important;
        gap: 12px !important;
        white-space: nowrap !important;
      }
      /* Updated 时间强制同一行 */
      .stars-grid-card .stars-card-meta .stars-meta-updated {
        white-space: nowrap !important;
      }
      .stars-grid-card .stars-card-meta a {
        color: var(--fgColor-muted, #656d76) !important;
        text-decoration: none !important;
      }
      .stars-grid-card .stars-card-meta a:hover {
        color: var(--fgColor-accent, #0969da) !important;
      }
      .stars-grid-card .stars-card-meta .repo-language-color {
        position: relative !important;
        top: 1px !important;
        display: inline-block !important;
        width: 12px !important;
        height: 12px !important;
        border-radius: 50% !important;
      }

      /* 标签容器 — 位于描述和元信息之间 */
      .stars-card-tags {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        margin: 0 0 8px 0;
        min-height: 22px;
      }

      /* 单个标签 pill */
      .stars-tag {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 12px;
        line-height: 1.4;
        background: var(--bgColor-accent-muted, #ddf4ff);
        color: var(--fgColor-accent, #0969da);
        white-space: nowrap;
        cursor: pointer;
      }

      /* 标签删除按钮 — 悬浮标签时显示 */
      .stars-tag .stars-tag-del {
        cursor: pointer;
        font-size: 14px;
        line-height: 1;
        width: 0;
        overflow: hidden;
        opacity: 0;
        transition: width 0.15s, opacity 0.15s, margin 0.15s;
      }
      .stars-tag:hover .stars-tag-del {
        width: 12px;
        margin-left: 2px;
        opacity: 0.6;
      }
      .stars-tag .stars-tag-del:hover {
        opacity: 1;
      }

      /* 添加标签按钮 — 悬浮卡片时显示 */
      .stars-tag-add {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        position: relative;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        border: 1px dashed var(--borderColor-default, #d1d9e0);
        color: var(--fgColor-muted, #656d76);
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.15s;
        background: transparent;
      }
      .stars-tag-add::before,
      .stars-tag-add::after {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: currentColor;
        border-radius: 1px;
      }
      .stars-tag-add::before {
        width: 10px;
        height: 1.5px;
      }
      .stars-tag-add::after {
        width: 1.5px;
        height: 10px;
      }
      .stars-grid-card:hover .stars-tag-add {
        opacity: 1;
      }
      .stars-tag-add:hover {
        background: var(--bgColor-accent-muted, #ddf4ff);
        color: var(--fgColor-accent, #0969da);
        border-color: var(--fgColor-accent, #0969da);
      }

      /* 分页器占满整行 */
      .stars-grid-container .paginate-container {
        grid-column: 1 / -1 !important;
      }

      /* 隐藏原始列表项 */
      .stars-original-hidden {
        display: none !important;
      }

      /* 标签筛选隐藏卡片 */
      .stars-tag-filtered {
        display: none !important;
      }

      /* ===== 筛选栏 Tags 按钮 ===== */
      .stars-tag-filter {
        position: relative;
      }
      /* 有选中标签时按钮高亮 */
      .stars-tag-filter .has-active {
        border-color: var(--fgColor-accent, #0969da) !important;
        color: var(--fgColor-accent, #0969da) !important;
      }

      /* 下拉面板 — 匹配 GitHub Overlay 样式 */
      .stars-tag-filter-dropdown {
        display: none;
        position: absolute;
        top: calc(100% + 4px);
        right: 0;
        z-index: 100;
        min-width: 200px;
        max-height: 300px;
        overflow-y: auto;
        background: var(--overlay-bgColor, var(--bgColor-default, #ffffff));
        border-radius: 12px;
        box-shadow: 0 0 0 1px var(--borderColor-default, #d1d9e0), 0 6px 12px -3px rgba(0,0,0,0.15), 0 6px 18px 0 rgba(0,0,0,0.1);
        padding: 4px 0;
      }
      .stars-tag-filter-dropdown.open {
        display: block;
      }

      /* 下拉项 */
      .stars-tag-filter-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 16px;
        cursor: pointer;
        font-size: 13px;
        white-space: nowrap;
      }
      .stars-tag-filter-item:hover {
        background: var(--bgColor-muted, #f6f8fa);
      }

      /* 清除按钮 */
      .stars-tag-filter-clear {
        display: block;
        width: 100%;
        padding: 6px 16px;
        border: none;
        border-top: 1px solid var(--borderColor-default, #d1d9e0);
        background: transparent;
        color: var(--fgColor-accent, #0969da);
        font-size: 13px;
        cursor: pointer;
        text-align: left;
      }
      .stars-tag-filter-clear:hover {
        background: var(--bgColor-muted, #f6f8fa);
      }

      /* 卡片标签 pill 选中态 */
      .stars-tag-active {
        background: var(--fgColor-accent, #0969da) !important;
        color: #ffffff !important;
      }

      /* ===== 星星按钮 ===== */
      .stars-card-header {
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        margin-bottom: 8px !important;
      }
      .stars-card-header h3 {
        flex: 1 !important;
        min-width: 0 !important;
      }
      .stars-star-btn {
        flex-shrink: 0;
        cursor: pointer;
        background: none;
        border: none;
        padding: 2px;
        line-height: 0;
        opacity: 0;
        transition: opacity 0.15s;
        color: var(--fgColor-muted, #656d76);
      }
      .stars-grid-card:hover .stars-star-btn {
        opacity: 1;
      }
      .stars-star-btn.starred {
        color: #e3b341;
      }
      .stars-star-btn.unstarred {
        opacity: 1;
        color: var(--fgColor-muted, #656d76);
      }
      .stars-star-btn:hover {
        opacity: 1 !important;
      }

    } /* end @media */
  `);

  // ====== DOM 重构逻辑 ======
  function isDesktop() {
    return window.innerWidth >= MOBILE_BREAKPOINT;
  }

  // ====== 迁移旧数据 ======
  migrateTagsIfNeeded();
  cleanupExpiredUnstarred();

  // ====== 标签筛选状态 ======
  let activeFilterTags = [];

  function getAllUniqueTags() {
    const all = loadAllTags();
    const set = new Set();
    for (const repoId in all) {
      all[repoId].forEach((t) => set.add(t));
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  // ====== Stars 页面：从卡片 DOM 提取数据并缓存 ======
  function extractAndCacheRepoFromCard(item, repoId) {
    if (!repoId) return;

    // Don't cache repos the current user hasn't starred
    const toggler = item.querySelector('.js-toggler-container.starring-container');
    if (toggler) {
      const starredDiv = toggler.querySelector('.starred');
      if (starredDiv && getComputedStyle(starredDiv).display === 'none') return;
    }

    // Name
    const h3 = item.querySelector('h3');
    let name = '';
    if (h3) {
      const repoLink = h3.querySelector('a');
      if (repoLink) {
        const href = repoLink.getAttribute('href') || '';
        name = href.startsWith('/') ? href.substring(1) : href;
      }
    }

    // Description
    const descP = item.querySelector('p[itemprop="description"]');
    const desc = descP ? descP.textContent.trim() : '';

    // Language
    const metaDiv = item.querySelector('.f6.color-fg-muted');
    let lang = '';
    let langColor = '';
    let stars = 0;
    let forks = 0;
    let updated = '';

    if (metaDiv) {
      // Language name
      const langNameEl = metaDiv.querySelector('span[itemprop="programmingLanguage"]');
      if (langNameEl) lang = langNameEl.textContent.trim();

      // Language color
      const langColorEl = metaDiv.querySelector('span.repo-language-color');
      if (langColorEl) langColor = langColorEl.getAttribute('style') || '';
      // Extract just the color value from style like "background-color: #3178c6;"
      const colorMatch = langColor.match(/background-color:\s*([^;]+)/);
      langColor = colorMatch ? colorMatch[1].trim() : '';

      // Stars (full number on Stars page, e.g., "29,208")
      const starLink = metaDiv.querySelector('a[href*="/stargazers"]');
      if (starLink) {
        const starText = starLink.textContent.replace(/[^\d]/g, '');
        stars = parseInt(starText, 10) || 0;
      }

      // Forks (full number)
      const forkLink = metaDiv.querySelector('a[href*="/forks"]');
      if (forkLink) {
        const forkText = forkLink.textContent.replace(/[^\d]/g, '');
        forks = parseInt(forkText, 10) || 0;
      }

      // Updated text
      const allNodes = Array.from(metaDiv.childNodes);
      let foundUpdated = false;
      let updatedParts = [];
      for (const node of allNodes) {
        if (node.nodeType === Node.TEXT_NODE && node.textContent.includes('Updated')) {
          foundUpdated = true;
        }
        if (foundUpdated) {
          if (node.nodeType === Node.TEXT_NODE) {
            updatedParts.push(node.textContent.trim());
          } else if (node.tagName === 'RELATIVE-TIME' && node.shadowRoot) {
            const shadowText = node.shadowRoot.textContent.trim();
            if (shadowText) updatedParts.push(shadowText);
          } else if (node.tagName === 'RELATIVE-TIME') {
            updatedParts.push(node.textContent.trim());
          }
        }
      }
      if (updatedParts.length > 0) {
        updated = updatedParts.join(' ').replace(/\s+/g, ' ').trim();
      }
    }

    saveRepoData(repoId, { name, desc, lang, langColor, stars, forks, updated });
  }

  // ====== 从缓存构建卡片 ======
  function buildCardFromCache(repoId, data) {
    const card = document.createElement('div');
    card.className = 'stars-grid-card stars-grid-card-cached';
    card.dataset.repoId = repoId;

    const repoHref = '/' + (data.name || '');
    card.dataset.repoName = '/' + (data.name || '');

    // Split owner/repo for header (match page card: <span class="text-normal">owner / </span>repo)
    const nameParts = (data.name || '').split('/');
    const owner = nameParts[0] || '';
    const repo = nameParts[1] || data.name || 'Unknown';

    let cardHTML = '<div class="stars-card-header">';
    cardHTML += `<h3><a href="${repoHref}"><span class="text-normal">${escapeHtml(owner)} / </span>${escapeHtml(repo)}</a></h3>`;
    cardHTML += '</div>';

    if (data.desc) {
      cardHTML += `<p class="stars-card-desc">${escapeHtml(data.desc)}</p>`;
    } else {
      cardHTML += '<p class="stars-card-desc" style="opacity:0.5;font-style:italic;">No description</p>';
    }

    // Tags container
    cardHTML += `<div class="stars-card-tags" data-repo-id="${repoId}"></div>`;

    // Meta
    cardHTML += '<div class="stars-card-meta">';

    let mainParts = '';

    // Language (match page card: <span class="ml-0 mr-3"> + <span itemprop="programmingLanguage">)
    if (data.lang) {
      const colorStyle = data.langColor ? `background-color: ${data.langColor}` : '';
      mainParts += `<span class="ml-0 mr-3">` +
        `<span class="repo-language-color" style="${colorStyle}"></span> ` +
        `<span itemprop="programmingLanguage">${escapeHtml(data.lang)}</span></span>`;
    }

    // Stars SVG (exact copy from GitHub Stars page)
    const starSvg = '<svg aria-label="star" role="img" height="16" viewBox="0 0 16 16" version="1.1" width="16" data-view-component="true" class="octicon octicon-star">' +
      '<path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Zm0 2.445L6.615 5.5a.75.75 0 0 1-.564.41l-3.097.45 2.24 2.184a.75.75 0 0 1 .216.664l-.528 3.084 2.769-1.456a.75.75 0 0 1 .698 0l2.77 1.456-.53-3.084a.75.75 0 0 1 .216-.664l2.24-2.183-3.096-.45a.75.75 0 0 1-.564-.41L8 2.694Z"></path></svg>';
    if (data.stars !== undefined) {
      const starsFormatted = Number(data.stars).toLocaleString();
      mainParts += `<a class="Link--muted mr-3" href="/${data.name}/stargazers">${starSvg} ${starsFormatted}</a>`;
    }

    // Forks SVG (exact copy from GitHub Stars page)
    const forkSvg = '<svg aria-label="fork" role="img" height="16" viewBox="0 0 16 16" version="1.1" width="16" data-view-component="true" class="octicon octicon-repo-forked">' +
      '<path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z"></path></svg>';
    if (data.forks !== undefined && data.forks > 0) {
      const forksFormatted = Number(data.forks).toLocaleString();
      mainParts += `<a class="Link--muted mr-3" href="/${data.name}/forks">${forkSvg} ${forksFormatted}</a>`;
    }

    if (mainParts) cardHTML += `<span class="stars-meta-main">${mainParts}</span>`;
    if (data.updated) cardHTML += `<span class="stars-meta-updated">${escapeHtml(data.updated)}</span>`;

    cardHTML += '</div>';

    card.innerHTML = cardHTML;
    return card;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ====== Star/Unstar 表单提交 ======
  function submitStarForm(formEl) {
    const action = formEl.getAttribute('action');
    const token = formEl.querySelector('input[name="authenticity_token"]').value;
    const context = formEl.querySelector('input[name="context"]');
    const body = new URLSearchParams();
    body.append('authenticity_token', token);
    if (context) body.append('context', context.value);
    return fetch(action, {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      body: body,
      credentials: 'same-origin'
    });
  }

  // ====== SVG 常量 ======
  const STAR_FILL_SVG = '<svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16" class="octicon octicon-star-fill"><path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"></path></svg>';
  const STAR_EMPTY_SVG = '<svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16" class="octicon octicon-star"><path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Zm0 2.445L6.615 5.5a.75.75 0 0 1-.564.41l-3.097.45 2.24 2.184a.75.75 0 0 1 .216.664l-.528 3.084 2.769-1.456a.75.75 0 0 1 .698 0l2.77 1.456-.53-3.084a.75.75 0 0 1 .216-.664l2.24-2.183-3.096-.45a.75.75 0 0 1-.564-.41L8 2.694Z"></path></svg>';

  // ====== 创建星星按钮（当前页卡片） ======
  function createStarButton(card, item) {
    const toggler = item.querySelector('.js-toggler-container.starring-container');
    if (!toggler) return;

    const starredDiv = toggler.querySelector('.starred');
    const isStarred = starredDiv && getComputedStyle(starredDiv).display !== 'none';

    const btn = document.createElement('button');
    btn.className = 'stars-star-btn' + (isStarred ? ' starred' : ' unstarred');
    btn.type = 'button';
    btn.title = isStarred ? 'Unstar' : 'Star';
    btn.innerHTML = isStarred ? STAR_FILL_SVG : STAR_EMPTY_SVG;

    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (btn.disabled) return;
      btn.disabled = true;

      const currentlyStarred = btn.classList.contains('starred');
      const formSelector = currentlyStarred
        ? '.starred form[action$="/unstar"]'
        : '.unstarred form[action$="/star"]';
      const formEl = toggler.querySelector(formSelector);
      if (!formEl) { btn.disabled = false; return; }

      try {
        const resp = await submitStarForm(formEl);
        if (!resp.ok) { btn.disabled = false; return; }

        // Toggle original DOM visibility
        const starredEl = toggler.querySelector('.starred');
        const unstarredEl = toggler.querySelector('.unstarred');
        if (currentlyStarred) {
          // Was starred → now unstarred
          if (starredEl) starredEl.style.display = 'none';
          if (unstarredEl) unstarredEl.style.display = '';
          btn.classList.remove('starred');
          btn.classList.add('unstarred');
          btn.innerHTML = STAR_EMPTY_SVG;
          btn.title = 'Star';
          // Mark as unstarred (delayed cleanup)
          const repoId = card.dataset.repoId;
          if (repoId) markRepoUnstarred(repoId);
        } else {
          // Was unstarred → now starred
          if (unstarredEl) unstarredEl.style.display = 'none';
          if (starredEl) starredEl.style.display = '';
          btn.classList.remove('unstarred');
          btn.classList.add('starred');
          btn.innerHTML = STAR_FILL_SVG;
          btn.title = 'Unstar';
          // Remove unstarred mark if re-starred
          const repoId = card.dataset.repoId;
          if (repoId) markRepoStarred(repoId);
        }
      } catch (_) {
        // Network error — do nothing
      }
      btn.disabled = false;
    });

    const header = card.querySelector('.stars-card-header');
    if (header) header.appendChild(btn);
  }

  // ====== 创建星星按钮（缓存卡片） ======
  function createStarButtonForCached(card, data) {
    if (!data.name) return;

    const isStarred = !data.unstarredAt;
    const btn = document.createElement('button');
    btn.className = 'stars-star-btn' + (isStarred ? ' starred' : ' unstarred');
    btn.type = 'button';
    btn.title = isStarred ? 'Unstar' : 'Star';
    btn.innerHTML = isStarred ? STAR_FILL_SVG : STAR_EMPTY_SVG;

    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (btn.disabled) return;
      btn.disabled = true;

      const currentlyStarred = btn.classList.contains('starred');

      try {
        // Fetch the repo detail page to get a valid CSRF token
        const pageResp = await fetch('/' + data.name, { credentials: 'same-origin' });
        if (!pageResp.ok) { btn.disabled = false; return; }
        const pageHtml = await pageResp.text();
        const doc = new DOMParser().parseFromString(pageHtml, 'text/html');

        // Pick the correct form: starred→unstar, unstarred→star
        const formSelector = currentlyStarred
          ? '.starred form[action$="/unstar"]'
          : '.unstarred form[action$="/star"]';
        const formEl = doc.querySelector(formSelector);
        if (!formEl) { btn.disabled = false; return; }

        const token = formEl.querySelector('input[name="authenticity_token"]');
        if (!token) { btn.disabled = false; return; }

        const action = formEl.getAttribute('action');
        const contextInput = formEl.querySelector('input[name="context"]');

        const body = new URLSearchParams();
        body.append('authenticity_token', token.value);
        if (contextInput) body.append('context', contextInput.value);

        const resp = await fetch(action, {
          method: 'POST',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
          body: body,
          credentials: 'same-origin'
        });
        if (!resp.ok) { btn.disabled = false; return; }

        if (currentlyStarred) {
          btn.classList.remove('starred');
          btn.classList.add('unstarred');
          btn.innerHTML = STAR_EMPTY_SVG;
          btn.title = 'Star';
          const repoId = card.dataset.repoId;
          if (repoId) markRepoUnstarred(repoId);
        } else {
          btn.classList.remove('unstarred');
          btn.classList.add('starred');
          btn.innerHTML = STAR_FILL_SVG;
          btn.title = 'Unstar';
          const repoId = card.dataset.repoId;
          if (repoId) markRepoStarred(repoId);
        }
      } catch (_) {
        // Network error — do nothing
      }
      btn.disabled = false;
    });

    const header = card.querySelector('.stars-card-header');
    if (header) header.appendChild(btn);
  }

  // ====== 筛选栏 UI ======

  // 关闭 GitHub 原生 action-menu 弹窗
  function closeNativeMenus() {
    document.querySelectorAll('anchored-position[popover]').forEach((el) => {
      try { el.hidePopover(); } catch (_) {}
    });
  }

  // 更新 Tags 按钮文字和高亮状态（不重建整个下拉）
  function updateTagFilterButton() {
    const btn = document.querySelector('.stars-tag-filter .Button');
    if (!btn) return;
    const label = btn.querySelector('.Button-label');
    if (label) {
      label.textContent = activeFilterTags.length > 0
        ? `Tags: ${activeFilterTags.length} selected`
        : 'Tags';
    }
    btn.classList.toggle('has-active', activeFilterTags.length > 0);
  }

  function renderTagFilterBar() {
    const toolbar = document.querySelector(
      '.Layout-main .d-flex.flex-column.flex-lg-row.flex-items-center.mt-5'
    );
    const filterRow = toolbar
      ? toolbar.querySelector('.d-flex.flex-justify-end')
      : null;
    if (!filterRow) return;

    const existing = filterRow.querySelector('.stars-tag-filter');
    if (existing) existing.remove();

    const allTags = getAllUniqueTags();
    if (allTags.length === 0 && activeFilterTags.length === 0) return;

    const container = document.createElement('div');
    container.className = 'stars-tag-filter mb-1 mb-lg-0 mr-2';

    // 使用 GitHub Primer Button 结构
    const btnLabel = activeFilterTags.length > 0
      ? `Tags: ${activeFilterTags.length} selected`
      : 'Tags';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'Button--secondary Button--medium Button';
    if (activeFilterTags.length > 0) btn.classList.add('has-active');
    btn.innerHTML =
      '<span class="Button-content"><span class="Button-label"></span></span>' +
      '<span class="Button-visual Button-trailingAction">' +
        '<svg aria-hidden="true" height="16" viewBox="0 0 16 16" width="16" class="octicon octicon-triangle-down">' +
          '<path d="m4.427 7.427 3.396 3.396a.25.25 0 0 0 .354 0l3.396-3.396A.25.25 0 0 0 11.396 7H4.604a.25.25 0 0 0-.177.427Z"></path>' +
        '</svg>' +
      '</span>';
    btn.querySelector('.Button-label').textContent = btnLabel;

    // 下拉面板
    const dropdown = document.createElement('div');
    dropdown.className = 'stars-tag-filter-dropdown';

    allTags.forEach((tag) => {
      const label = document.createElement('label');
      label.className = 'stars-tag-filter-item';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = activeFilterTags.includes(tag);

      const text = document.createTextNode(tag);
      label.appendChild(cb);
      label.appendChild(text);

      label.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const idx = activeFilterTags.indexOf(tag);
        if (idx >= 0) {
          activeFilterTags.splice(idx, 1);
          cb.checked = false;
        } else {
          activeFilterTags.push(tag);
          cb.checked = true;
        }
        updateTagFilterButton();
        applyTagFilter();
        refreshTagPillStates();
      });

      dropdown.appendChild(label);
    });

    // 清除按钮
    if (activeFilterTags.length > 0) {
      const clearBtn = document.createElement('button');
      clearBtn.className = 'stars-tag-filter-clear';
      clearBtn.textContent = '清除筛选';
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        activeFilterTags = [];
        dropdown.classList.remove('open');
        applyTagFilter();
        renderTagFilterBar();
        refreshTagPillStates();
      });
      dropdown.appendChild(clearBtn);
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = !dropdown.classList.contains('open');
      if (willOpen) closeNativeMenus();
      dropdown.classList.toggle('open');
    });

    container.appendChild(btn);
    container.appendChild(dropdown);

    // 点击外部关闭
    document.addEventListener('click', (e) => {
      if (!container.contains(e.target)) {
        dropdown.classList.remove('open');
      }
    });

    // 监听 GitHub 原生菜单打开时关闭 Tags 下拉
    document.addEventListener('toggle', (e) => {
      if (e.target.matches && e.target.matches('anchored-position[popover]') && e.newState === 'open') {
        dropdown.classList.remove('open');
      }
    }, true);

    filterRow.insertBefore(container, filterRow.firstChild);
  }

  // ====== 筛选逻辑（重写：使用缓存代替 API） ======
  function applyTagFilter() {
    // 1. 移除之前的缓存卡片
    document.querySelectorAll('.stars-grid-card-cached').forEach((el) => el.remove());

    const cards = document.querySelectorAll('.stars-grid-card:not(.stars-grid-card-cached)');

    // 2. 如果无筛选标签，显示所有当前页卡片
    if (activeFilterTags.length === 0) {
      cards.forEach((card) => card.classList.remove('stars-tag-filtered'));
      return;
    }

    // 3. 筛选当前页卡片
    const currentPageIds = new Set();
    cards.forEach((card) => {
      const repoId = card.dataset.repoId;
      if (repoId) currentPageIds.add(repoId);
      const tags = repoId ? getTags(repoId) : [];
      const match = activeFilterTags.every((ft) => tags.includes(ft));
      card.classList.toggle('stars-tag-filtered', !match);
    });

    // 4. 从标签数据库查找其他页面中符合条件的仓库
    const allTags = loadAllTags();
    const gridContainer = document.querySelector('.stars-grid-container');
    if (!gridContainer) return;

    const paginator = gridContainer.querySelector('.paginate-container');

    for (const repoId in allTags) {
      if (currentPageIds.has(repoId)) continue;
      const tags = allTags[repoId];
      if (!activeFilterTags.every((ft) => tags.includes(ft))) continue;

      // 5. 从缓存获取仓库数据
      const repoData = getRepoData(repoId);
      if (!repoData) continue; // 无缓存数据则跳过

      // 6. 构建卡片
      const cachedCard = buildCardFromCache(repoId, repoData);

      if (paginator) {
        gridContainer.insertBefore(cachedCard, paginator);
      } else {
        gridContainer.appendChild(cachedCard);
      }

      // 星星按钮
      createStarButtonForCached(cachedCard, repoData);

      // 7. 渲染标签
      const tagsContainer = cachedCard.querySelector('.stars-card-tags');
      if (tagsContainer) renderTags(tagsContainer);
    }
  }

  function refreshTagPillStates() {
    document.querySelectorAll('.stars-card-tags .stars-tag').forEach((pill) => {
      const tagText = pill.childNodes[0].textContent;
      if (activeFilterTags.includes(tagText)) {
        pill.classList.add('stars-tag-active');
      } else {
        pill.classList.remove('stars-tag-active');
      }
    });
  }

  // ====== 标签渲染 ======
  function renderTags(tagsContainer) {
    const repoId = tagsContainer.dataset.repoId;
    if (!repoId) return;

    const tags = getTags(repoId);
    tagsContainer.innerHTML = '';

    tags.forEach((tag, idx) => {
      const span = document.createElement('span');
      span.className = 'stars-tag';
      if (activeFilterTags.includes(tag)) {
        span.classList.add('stars-tag-active');
      }
      span.textContent = tag;

      span.addEventListener('click', (e) => {
        e.stopPropagation();
        const fidx = activeFilterTags.indexOf(tag);
        if (fidx >= 0) {
          activeFilterTags.splice(fidx, 1);
        } else {
          activeFilterTags.push(tag);
        }
        applyTagFilter();
        renderTagFilterBar();
        refreshTagPillStates();
      });

      const del = document.createElement('span');
      del.className = 'stars-tag-del';
      del.textContent = '×';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        const current = getTags(repoId);
        current.splice(idx, 1);
        saveTags(repoId, current);
        renderTags(tagsContainer);
        renderTagFilterBar();
        applyTagFilter();
      });

      span.appendChild(del);
      tagsContainer.appendChild(span);
    });

    const addBtn = document.createElement('span');
    addBtn.className = 'stars-tag-add';
    addBtn.title = '添加标签';
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const name = prompt('输入标签名');
      if (name && name.trim()) {
        const current = getTags(repoId);
        current.push(name.trim());
        saveTags(repoId, current);
        renderTags(tagsContainer);
        renderTagFilterBar();
        applyTagFilter();
      }
    });
    tagsContainer.appendChild(addBtn);
  }

  // ====== DOM 转换 ======
  function transformStarsList() {
    if (!isDesktop()) return false;

    const turboFrame = document.getElementById('user-starred-repos');
    if (!turboFrame) return false;

    const colLg9 = turboFrame.querySelector('.col-lg-9');
    if (!colLg9) return false;

    const repoItems = colLg9.querySelectorAll('.col-12.d-block.width-full.py-4.border-bottom:not(.stars-original-hidden)');
    if (repoItems.length === 0) {
      return !!colLg9.querySelector('.stars-grid-container');
    }

    if (colLg9.querySelector('.stars-grid-container')) return true;

    // 隐藏 Lists 区域（JS 兜底）
    const profileFrame = document.getElementById('user-profile-frame');
    if (profileFrame) {
      const wrapperDiv = profileFrame.firstElementChild;
      if (wrapperDiv) {
        Array.from(wrapperDiv.children).forEach((child) => {
          const h2 = child.querySelector('h2.f3-light');
          if (h2 && h2.textContent.includes('Lists')) {
            child.style.display = 'none';
          }
          if (child.id === 'profile-lists-container') {
            child.style.display = 'none';
          }
        });
      }
    }

    const gridContainer = document.createElement('div');
    gridContainer.className = 'stars-grid-container';

    repoItems.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'stars-grid-card';

      // 提取 repoId
      const toggleEl = item.querySelector('[data-toggle-for*="details-user-list-"]');
      let repoId = '';
      if (toggleEl) {
        const match = toggleEl.getAttribute('data-toggle-for').match(/details-user-list-(\d+)/);
        if (match) repoId = match[1];
      }
      if (repoId) card.dataset.repoId = repoId;

      // 提取 repoName（href）
      const h3 = item.querySelector('h3');
      if (h3) {
        const repoLink = h3.querySelector('a');
        if (repoLink) card.dataset.repoName = repoLink.getAttribute('href') || '';
      }

      const descP = item.querySelector('p[itemprop="description"]');
      const metaDiv = item.querySelector('.f6.color-fg-muted');

      let cardHTML = '<div class="stars-card-header">';
      if (h3) cardHTML += `<h3>${h3.innerHTML}</h3>`;
      cardHTML += '</div>';

      if (descP) {
        cardHTML += `<p class="stars-card-desc">${descP.textContent.trim()}</p>`;
      } else {
        cardHTML += '<p class="stars-card-desc" style="opacity:0.5;font-style:italic;">No description</p>';
      }

      // 标签容器
      cardHTML += `<div class="stars-card-tags" data-repo-id="${repoId}"></div>`;

      if (metaDiv) {
        const langSpan = metaDiv.querySelector('span.ml-0, span:has(.repo-language-color)');
        const starLink = metaDiv.querySelector('a[href*="/stargazers"]');
        const forkLink = metaDiv.querySelector('a[href*="/forks"]');

        let mainParts = '';
        if (langSpan) mainParts += langSpan.outerHTML;
        if (starLink) mainParts += starLink.outerHTML;
        if (forkLink) mainParts += forkLink.outerHTML;

        let updatedHTML = '';
        const allNodes = Array.from(metaDiv.childNodes);
        let foundUpdated = false;
        for (const node of allNodes) {
          if (node.nodeType === Node.TEXT_NODE && node.textContent.includes('Updated')) {
            foundUpdated = true;
          }
          if (foundUpdated) {
            updatedHTML += node.nodeType === Node.TEXT_NODE ? node.textContent : node.outerHTML;
          }
        }

        cardHTML += '<div class="stars-card-meta">';
        if (mainParts) cardHTML += `<span class="stars-meta-main">${mainParts}</span>`;
        if (updatedHTML.trim()) cardHTML += `<span class="stars-meta-updated">${updatedHTML.trim()}</span>`;
        cardHTML += '</div>';
      }

      card.innerHTML = cardHTML;
      gridContainer.appendChild(card);
      item.classList.add('stars-original-hidden');

      // 缓存仓库数据
      extractAndCacheRepoFromCard(item, repoId);

      // 星星按钮
      createStarButton(card, item);

      // 渲染标签
      const tagsContainer = card.querySelector('.stars-card-tags');
      if (tagsContainer) renderTags(tagsContainer);
    });

    // 分页器
    const paginator = colLg9.querySelector('.paginate-container:not(.stars-original-hidden)');
    if (paginator) {
      gridContainer.appendChild(paginator.cloneNode(true));
      paginator.classList.add('stars-original-hidden');
    }

    colLg9.appendChild(gridContainer);

    // 渲染筛选栏并应用筛选
    renderTagFilterBar();
    applyTagFilter();

    return true;
  }

  // ====== 执行转换 ======
  if (!transformStarsList()) {
    const observer = new MutationObserver((mutations, obs) => {
      if (transformStarsList()) {
        obs.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 10000);
  }

  // 监听 Turbo Frame 导航（翻页等）
  document.addEventListener('turbo:frame-render', (event) => {
    if (event.target.id === 'user-starred-repos') {
      setTimeout(transformStarsList, 100);
    }
  });

  document.addEventListener('turbo:load', () => {
    if (window.location.search.includes('tab=stars')) {
      setTimeout(transformStarsList, 200);
    }
  });
})();
