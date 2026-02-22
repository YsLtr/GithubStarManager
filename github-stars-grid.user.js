// ==UserScript==
// @name         GitHub Stars Grid View
// @namespace    https://github.com/YsLtr
// @version      2.5
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

  /* ================================================================
   *  SECTION 0: CONSTANTS
   * ================================================================ */

  const MOBILE_BREAKPOINT = 768;
  const WIDE_BREAKPOINT = 1200;
  const GRACE_PERIOD = 24 * 60 * 60 * 1000;

  const STAR_FILL_SVG = '<svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16" class="octicon octicon-star-fill"><path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"></path></svg>';
  const STAR_EMPTY_SVG = '<svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16" class="octicon octicon-star"><path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Zm0 2.445L6.615 5.5a.75.75 0 0 1-.564.41l-3.097.45 2.24 2.184a.75.75 0 0 1 .216.664l-.528 3.084 2.769-1.456a.75.75 0 0 1 .698 0l2.77 1.456-.53-3.084a.75.75 0 0 1 .216-.664l2.24-2.183-3.096-.45a.75.75 0 0 1-.564-.41L8 2.694Z"></path></svg>';

  const STAR_META_SVG = '<svg aria-label="star" role="img" height="16" viewBox="0 0 16 16" version="1.1" width="16" data-view-component="true" class="octicon octicon-star">' +
    '<path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Zm0 2.445L6.615 5.5a.75.75 0 0 1-.564.41l-3.097.45 2.24 2.184a.75.75 0 0 1 .216.664l-.528 3.084 2.769-1.456a.75.75 0 0 1 .698 0l2.77 1.456-.53-3.084a.75.75 0 0 1 .216-.664l2.24-2.183-3.096-.45a.75.75 0 0 1-.564-.41L8 2.694Z"></path></svg>';

  const FORK_META_SVG = '<svg aria-label="fork" role="img" height="16" viewBox="0 0 16 16" version="1.1" width="16" data-view-component="true" class="octicon octicon-repo-forked">' +
    '<path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z"></path></svg>';

  /* ================================================================
   *  SECTION 1: UTILITIES
   * ================================================================ */

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function isDesktop() {
    return window.innerWidth >= MOBILE_BREAKPOINT;
  }

  /* ================================================================
   *  SECTION 2: STORAGE — REPO CACHE
   * ================================================================ */

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

  /* ================================================================
   *  SECTION 3: STORAGE — PENDING DELETE
   * ================================================================ */

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
      _tags: getTags(repoId),
      _note: getNote(repoId)
    });
    savePendingDelete(pending);
    delete cache[repoId];
    saveRepoCache(cache);
    saveTags(repoId, []);
    saveNote(repoId, '');
  }

  function markRepoStarred(repoId) {
    const pending = loadPendingDelete();
    if (!pending[repoId]) return;
    const entry = pending[repoId];
    const tags = entry._tags || [];
    const note = entry._note || '';
    delete entry.unstarredAt;
    delete entry._tags;
    delete entry._note;
    const cache = loadRepoCache();
    cache[repoId] = entry;
    saveRepoCache(cache);
    if (tags.length > 0) saveTags(repoId, tags);
    if (note) saveNote(repoId, note);
    delete pending[repoId];
    savePendingDelete(pending);
  }

  function cleanupExpiredUnstarred() {
    const pending = loadPendingDelete();
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

  /* ================================================================
   *  SECTION 4: STORAGE — TAGS
   * ================================================================ */

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

  function getAllUniqueTags() {
    const all = loadAllTags();
    const set = new Set();
    for (const repoId in all) {
      all[repoId].forEach((t) => set.add(t));
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  function loadAllNotes() {
    const userId = getStarsUserId();
    if (!userId) return GM_getValue('stars_notes', {});
    return GM_getValue('stars_notes_' + userId, {});
  }

  function saveNote(repoId, text) {
    const userId = getStarsUserId();
    const key = userId ? 'stars_notes_' + userId : 'stars_notes';
    const all = GM_getValue(key, {});
    if (!text) {
      delete all[repoId];
    } else {
      all[repoId] = text;
    }
    GM_setValue(key, all);
  }

  function getNote(repoId) {
    return loadAllNotes()[repoId] || '';
  }

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

  /* ================================================================
   *  SECTION 5: DATA EXTRACTION
   * ================================================================ */

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
    const metaDiv = item.querySelector('div.f6.color-fg-muted');
    let lang = '';
    let langColor = '';
    let stars = 0;
    let forks = 0;
    let updated = '';
    let updatedAt = '';

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

      // Updated text + updatedAt ISO timestamp
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
          } else if (node.tagName === 'RELATIVE-TIME') {
            if (!updatedAt) updatedAt = node.getAttribute('datetime') || '';
            if (node.shadowRoot) {
              const shadowText = node.shadowRoot.textContent.trim();
              if (shadowText) updatedParts.push(shadowText);
            } else {
              updatedParts.push(node.textContent.trim());
            }
          }
        }
      }
      if (updatedParts.length > 0) {
        updated = updatedParts.join(' ').replace(/\s+/g, ' ').trim();
      }
    }

    saveRepoData(repoId, { name, desc, lang, langColor, stars, forks, updated, updatedAt });
  }

  /* ================================================================
   *  SECTION 6: STYLES
   * ================================================================ */

  function injectStyles() {
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
        max-width: 100% !important;
      }

      /* 移除内部 3/9 分栏，col-lg-9 占满 */
      turbo-frame#user-starred-repos .d-lg-flex.gutter-lg {
        display: block !important;
        margin-left: 0 !important;
        margin-right: 0 !important;
      }
      turbo-frame#user-starred-repos .col-lg-9 {
        width: 100% !important;
        max-width: 100% !important;
        padding-left: 0 !important;
        padding-right: 0 !important;
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

      /* 内联标签输入框 */
      .stars-tag-input {
        display: inline-flex;
        align-items: center;
        height: 22px;
        padding: 0 8px;
        border-radius: 12px;
        border: 1px solid var(--fgColor-accent, #0969da);
        background: var(--bgColor-default, #ffffff);
        color: var(--fgColor-default, #1f2328);
        font-size: 12px;
        line-height: 1.4;
        outline: none;
        width: 80px;
        box-sizing: border-box;
      }
      .stars-tag-input::placeholder {
        color: var(--fgColor-muted, #656d76);
        opacity: 0.7;
      }

      /* 备注区域 — 位于元信息下方，虚线分隔 */
      .stars-card-notes {
        border-top: 1px dashed var(--borderColor-default, #d1d9e0);
        margin-top: 10px;
        padding-top: 8px;
        min-height: 20px;
        cursor: text;
      }
      .stars-card-notes-text {
        font-size: 12px;
        line-height: 1.5;
        color: var(--fgColor-muted, #656d76);
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 60px;
        overflow-y: auto;
      }
      .stars-card-notes-placeholder {
        font-size: 12px;
        color: var(--fgColor-muted, #656d76);
        opacity: 0;
        font-style: italic;
        transition: opacity 0.15s;
      }
      .stars-grid-card:hover .stars-card-notes-placeholder {
        opacity: 0.5;
      }
      .stars-card-notes-edit {
        width: 100%;
        font-size: 12px;
        line-height: 1.5;
        color: var(--fgColor-default, #1f2328);
        background: var(--bgColor-default, #ffffff);
        border: 1px solid var(--fgColor-accent, #0969da);
        border-radius: 4px;
        padding: 4px 6px;
        outline: none;
        resize: vertical;
        min-height: 40px;
        max-height: 120px;
        box-sizing: border-box;
        font-family: inherit;
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
      /* 有选中标签时按钮高亮 */
      .stars-tag-filter .has-active {
        border-color: var(--fgColor-accent, #0969da) !important;
        color: var(--fgColor-accent, #0969da) !important;
      }
      /* 下拉列表滚动约束 */
      .stars-tag-filter .ActionListWrap {
        min-width: 200px;
        max-height: 300px;
        overflow-y: auto;
      }

      /* 卡片标签 pill 选中态 */
      .stars-tag-active {
        background: var(--fgColor-accent, #0969da) !important;
        color: #ffffff !important;
      }

      /* ===== 自定义 Language / Sort 筛选按钮 ===== */
      .stars-custom-filter .has-active {
        border-color: var(--fgColor-accent, #0969da) !important;
        color: var(--fgColor-accent, #0969da) !important;
      }
      .stars-custom-filter .ActionListWrap {
        min-width: 180px;
        max-height: 300px;
        overflow-y: auto;
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

      /* 隐藏原始 Starred topics 列（内容已被 JS 移走） */
      turbo-frame#user-starred-repos .col-lg-3 {
        display: none !important;
      }

      /* ===== 中等桌面屏幕：隐藏左右侧边栏，主内容全宽 ===== */
      .Layout-sidebar {
        display: none !important;
      }
      .stars-right-sidebar {
        display: none !important;
      }
      .Layout.Layout--sidebarPosition-start {
        grid-template-columns: 1fr !important;
      }
      .Layout-main {
        grid-column: 1 !important;
        max-width: none !important;
      }

    } /* end @media */

    @media (min-width: ${WIDE_BREAKPOINT}px) {
      .Layout-sidebar {
        display: block !important;
        grid-column: 1 !important;
      }
      .Layout.Layout--sidebarPosition-start {
        grid-template-columns: 180px 1fr 220px !important;
      }
      .Layout-main {
        grid-column: 2 !important;
        max-width: none !important;
      }
      .stars-right-sidebar {
        grid-column: 3 !important;
        display: block !important;
        width: 220px !important;
        min-width: 220px !important;
        padding-top: 32px !important;
        overflow: hidden !important;
        word-wrap: break-word !important;
      }
      .stars-right-sidebar h2 {
        font-size: 16px !important;
        margin-bottom: 12px !important;
      }
      .stars-right-sidebar article {
        margin-bottom: 8px !important;
      }
      .stars-right-sidebar article h1 {
        font-size: 14px !important;
      }
    }
  `);
  }

  /* ================================================================
   *  SECTION 7: CARDS & STAR BUTTONS
   * ================================================================ */

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

    // Stars
    if (data.stars !== undefined) {
      const starsFormatted = Number(data.stars).toLocaleString();
      mainParts += `<a class="Link--muted mr-3" href="/${data.name}/stargazers">${STAR_META_SVG} ${starsFormatted}</a>`;
    }

    // Forks
    if (data.forks !== undefined && data.forks > 0) {
      const forksFormatted = Number(data.forks).toLocaleString();
      mainParts += `<a class="Link--muted mr-3" href="/${data.name}/forks">${FORK_META_SVG} ${forksFormatted}</a>`;
    }

    if (mainParts) cardHTML += `<span class="stars-meta-main">${mainParts}</span>`;
    if (data.updated) cardHTML += `<span class="stars-meta-updated">${escapeHtml(data.updated)}</span>`;

    cardHTML += '</div>';

    cardHTML += `<div class="stars-card-notes" data-repo-id="${repoId}"></div>`;

    card.innerHTML = cardHTML;
    return card;
  }

  function createStarButtonElement(isStarred) {
    const btn = document.createElement('button');
    btn.className = 'stars-star-btn' + (isStarred ? ' starred' : ' unstarred');
    btn.type = 'button';
    btn.title = isStarred ? 'Unstar' : 'Star';
    btn.innerHTML = isStarred ? STAR_FILL_SVG : STAR_EMPTY_SVG;
    return btn;
  }

  function toggleStarButtonState(btn, card, nowStarred) {
    if (nowStarred) {
      btn.classList.remove('unstarred');
      btn.classList.add('starred');
      btn.innerHTML = STAR_FILL_SVG;
      btn.title = 'Unstar';
      const repoId = card.dataset.repoId;
      if (repoId) markRepoStarred(repoId);
    } else {
      btn.classList.remove('starred');
      btn.classList.add('unstarred');
      btn.innerHTML = STAR_EMPTY_SVG;
      btn.title = 'Star';
      const repoId = card.dataset.repoId;
      if (repoId) markRepoUnstarred(repoId);
    }
  }

  function createStarButton(card, item) {
    const toggler = item.querySelector('.js-toggler-container.starring-container');
    if (!toggler) return;

    const starredDiv = toggler.querySelector('.starred');
    const isStarred = starredDiv && getComputedStyle(starredDiv).display !== 'none';

    const btn = createStarButtonElement(isStarred);

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
          if (starredEl) starredEl.style.display = 'none';
          if (unstarredEl) unstarredEl.style.display = '';
        } else {
          if (unstarredEl) unstarredEl.style.display = 'none';
          if (starredEl) starredEl.style.display = '';
        }

        toggleStarButtonState(btn, card, !currentlyStarred);
      } catch (_) {
        // Network error — do nothing
      }
      btn.disabled = false;
    });

    const header = card.querySelector('.stars-card-header');
    if (header) header.appendChild(btn);
  }

  function createStarButtonForCached(card, data) {
    if (!data.name) return;

    const isStarred = !data.unstarredAt;
    const btn = createStarButtonElement(isStarred);

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

        toggleStarButtonState(btn, card, !currentlyStarred);
      } catch (_) {
        // Network error — do nothing
      }
      btn.disabled = false;
    });

    const header = card.querySelector('.stars-card-header');
    if (header) header.appendChild(btn);
  }

  /* ================================================================
   *  SECTION 8: TAG UI
   * ================================================================ */

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

    // 使用 GitHub Primer Button 结构 + popovertarget
    const btnLabel = activeFilterTags.length > 0
      ? `Tags: ${activeFilterTags.length} selected`
      : 'Tags';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'stars-tag-filter-button';
    btn.setAttribute('popovertarget', 'stars-tag-filter-overlay');
    btn.setAttribute('aria-controls', 'stars-tag-filter-list');
    btn.setAttribute('aria-haspopup', 'true');
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

    // anchored-position overlay (popover="auto")
    const overlay = document.createElement('anchored-position');
    overlay.id = 'stars-tag-filter-overlay';
    overlay.setAttribute('anchor', 'stars-tag-filter-button');
    overlay.setAttribute('align', 'start');
    overlay.setAttribute('side', 'outside-bottom');
    overlay.setAttribute('anchor-offset', 'normal');
    overlay.setAttribute('popover', 'auto');

    const overlayInner = document.createElement('div');
    overlayInner.className = 'Overlay Overlay--size-auto';
    const overlayBody = document.createElement('div');
    overlayBody.className = 'Overlay-body Overlay-body--paddingNone';

    // 菜单列表容器 — 使用原生 ActionList 结构
    const menuList = document.createElement('ul');
    menuList.id = 'stars-tag-filter-list';
    menuList.className = 'ActionListWrap--inset ActionListWrap';
    menuList.setAttribute('role', 'menu');

    allTags.forEach((tag) => {
      const li = document.createElement('li');
      li.className = 'ActionListItem';
      li.setAttribute('role', 'none');

      const content = document.createElement('label');
      content.className = 'ActionListContent';
      content.setAttribute('role', 'menuitemcheckbox');
      content.setAttribute('aria-checked', String(activeFilterTags.includes(tag)));

      const visual = document.createElement('span');
      visual.className = 'ActionListItem-visual ActionListItem-action--leading';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = activeFilterTags.includes(tag);
      visual.appendChild(cb);

      const labelSpan = document.createElement('span');
      labelSpan.className = 'ActionListItem-label';
      labelSpan.textContent = tag;

      content.appendChild(visual);
      content.appendChild(labelSpan);

      content.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const idx = activeFilterTags.indexOf(tag);
        if (idx >= 0) {
          activeFilterTags.splice(idx, 1);
          cb.checked = false;
          content.setAttribute('aria-checked', 'false');
        } else {
          activeFilterTags.push(tag);
          cb.checked = true;
          content.setAttribute('aria-checked', 'true');
        }
        updateTagFilterButton();
        applyTagFilter();
        refreshTagPillStates();
      });

      li.appendChild(content);
      menuList.appendChild(li);
    });

    overlayBody.appendChild(menuList);
    overlayInner.appendChild(overlayBody);
    overlay.appendChild(overlayInner);

    container.appendChild(btn);
    container.appendChild(overlay);

    filterRow.insertBefore(container, filterRow.firstChild);
  }

  function getTagFilteredRepos(ignoreLang) {
    const allTags = loadAllTags();
    const cache = loadRepoCache();
    let results = [];

    for (const repoId in allTags) {
      const tags = allTags[repoId];
      if (!activeFilterTags.every(ft => tags.includes(ft))) continue;
      const data = cache[repoId];
      if (!data) continue;
      // Language filter (skip when ignoreLang=true, used for building language list)
      if (!ignoreLang && activeFilterLang && (data.lang || '').toLowerCase() !== activeFilterLang.toLowerCase()) continue;
      results.push({ repoId, data });
    }

    // Sort
    if (activeFilterSort === 'stars') {
      results.sort((a, b) => (b.data.stars || 0) - (a.data.stars || 0));
    } else {
      // updated — sort by updatedAt ISO descending, missing values last
      results.sort((a, b) => (b.data.updatedAt || '').localeCompare(a.data.updatedAt || ''));
    }

    return results;
  }

  function inheritNativeFilters() {
    // Read current Language from native button text
    const langBtn = document.querySelector('#stars-language-filter-menu-button');
    if (langBtn) {
      const text = langBtn.textContent.trim();
      const match = text.match(/Language:\s*(.+)/);
      if (match && match[1].trim().toLowerCase() !== 'all') {
        activeFilterLang = match[1].trim();
      }
    }
    // Read current Sort from native button text
    const sortBtn = document.querySelector('#stars-sort-menu-button');
    if (sortBtn) {
      const text = sortBtn.textContent.trim();
      if (text.includes('Most stars')) {
        activeFilterSort = 'stars';
      } else if (text.includes('Recently active')) {
        activeFilterSort = 'updated';
      }
      // "Recently starred" → default to 'stars' since cache has no starred-at time
    }
  }

  function renderTagFilterInfoBar(count) {
    // Remove old info bar
    document.querySelectorAll('.stars-tag-info-bar').forEach(el => el.remove());

    if (activeFilterTags.length === 0) return;

    const colLg9 = document.querySelector('turbo-frame#user-starred-repos .col-lg-9');
    if (!colLg9) return;
    const gridContainer = colLg9.querySelector('.stars-grid-container');
    if (!gridContainer) return;

    // Hide native clear filter bar if present
    const nativeBar = colLg9.querySelector('.TableObject.border-bottom:not(.stars-tag-info-bar)');
    if (nativeBar) nativeBar.style.display = 'none';

    const bar = document.createElement('div');
    bar.className = 'stars-tag-info-bar TableObject border-bottom color-border-muted py-3';

    const infoDiv = document.createElement('div');
    infoDiv.className = 'TableObject-item TableObject-item--primary';
    const infoSpan = document.createElement('span');
    infoSpan.setAttribute('role', 'status');

    // Build filter description
    let desc = '<strong>' + count + '</strong> repos matching tags: ';
    desc += activeFilterTags.map(t => '<strong>' + escapeHtml(t) + '</strong>').join(', ');
    if (activeFilterLang) {
      desc += ' · language: <strong>' + escapeHtml(activeFilterLang) + '</strong>';
    }
    infoSpan.innerHTML = desc;
    infoDiv.appendChild(infoSpan);

    const clearLink = document.createElement('a');
    clearLink.className = 'issues-reset-query text-normal TableObject-item text-right';
    clearLink.href = '#';
    clearLink.innerHTML = '<svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16" class="octicon octicon-x v-align-text-bottom"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"></path></svg> Clear filter';
    clearLink.addEventListener('click', (e) => {
      e.preventDefault();
      // Navigate to clean stars page — clears all filters including pre-existing native ones
      const baseUrl = new URL(location.href);
      location.href = baseUrl.pathname + '?tab=stars';
    });

    bar.appendChild(infoDiv);
    bar.appendChild(clearLink);

    colLg9.insertBefore(bar, gridContainer);
  }

  function applyTagFilter() {
    // 1. Remove old cached cards
    document.querySelectorAll('.stars-grid-card-cached').forEach((el) => el.remove());

    const cards = document.querySelectorAll('.stars-grid-card:not(.stars-grid-card-cached)');
    const gridContainer = document.querySelector('.stars-grid-container');
    const paginator = gridContainer ? gridContainer.querySelector('.paginate-container') : null;

    // 2. When no filter tags — exit tags mode, apply Language/Sort back to page URL
    if (activeFilterTags.length === 0) {
      if (tagModeActive) {
        // Build URL preserving the Language/Sort chosen during tags mode
        const baseUrl = new URL(location.href);
        const targetParams = new URLSearchParams();
        targetParams.set('tab', 'stars');
        if (activeFilterLang) {
          targetParams.set('language', activeFilterLang.toLowerCase());
        }
        if (activeFilterSort === 'updated') {
          targetParams.set('sort', 'updated');
        } else if (activeFilterSort === 'stars') {
          targetParams.set('sort', 'stars');
        }

        activeFilterLang = '';
        activeFilterSort = 'stars';
        tagModeActive = false;

        // Navigate — this reloads the page with the correct server-side filters
        location.href = baseUrl.pathname + '?' + targetParams.toString();
        return;
      }

      cards.forEach((card) => card.classList.remove('stars-tag-filtered'));
      if (paginator) paginator.style.display = '';
      updateNativeFilters(false);

      // Remove info bar and restore native clear filter bar
      document.querySelectorAll('.stars-tag-info-bar').forEach(el => el.remove());
      const colLg9 = document.querySelector('turbo-frame#user-starred-repos .col-lg-9');
      if (colLg9) {
        const nativeBar = colLg9.querySelector('.TableObject.border-bottom:not(.stars-tag-info-bar)');
        if (nativeBar) nativeBar.style.display = '';
      }
      return;
    }

    // 3. Entering tags mode for the first time — inherit native filters
    if (!tagModeActive) {
      inheritNativeFilters();
      tagModeActive = true;
    }

    // 4. Tags mode active — hide all original page cards
    cards.forEach((card) => card.classList.add('stars-tag-filtered'));
    if (paginator) paginator.style.display = 'none';

    // 5. Get sorted/filtered repos from cache
    const results = getTagFilteredRepos(false);
    if (!gridContainer) return;

    // 6. Build cached cards for each result
    results.forEach(({ repoId, data }) => {
      const cachedCard = buildCardFromCache(repoId, data);
      gridContainer.appendChild(cachedCard);

      // Star button
      createStarButtonForCached(cachedCard, data);

      // Tags
      const tagsContainer = cachedCard.querySelector('.stars-card-tags');
      if (tagsContainer) renderTags(tagsContainer);

      // Notes
      const notesContainer = cachedCard.querySelector('.stars-card-notes');
      if (notesContainer) renderNotes(notesContainer);
    });

    // 7. Show info bar with count and clear link
    renderTagFilterInfoBar(results.length);

    // 8. Switch filter bar to custom Language/Sort
    updateNativeFilters(true);
  }

  function updateNativeFilters(tagMode) {
    const typeBtn = document.querySelector('#stars-type-filter-menu-button');
    const langBtn = document.querySelector('#stars-language-filter-menu-button');
    const sortBtn = document.querySelector('#stars-sort-menu-button');

    const typeMenu = typeBtn ? typeBtn.closest('action-menu') : null;
    const langMenu = langBtn ? langBtn.closest('action-menu') : null;
    const sortMenu = sortBtn ? sortBtn.closest('action-menu') : null;

    if (tagMode) {
      // Hide native Type / Language / Sort action-menus
      if (typeMenu) typeMenu.style.display = 'none';
      if (langMenu) langMenu.style.display = 'none';
      if (sortMenu) sortMenu.style.display = 'none';

      // Remove old custom buttons if any
      document.querySelectorAll('.stars-custom-filter').forEach(el => el.remove());

      // Find insertion point: after the Tags filter button
      const filterRow = document.querySelector(
        '.Layout-main .d-flex.flex-column.flex-lg-row.flex-items-center.mt-5 .d-flex.flex-justify-end'
      );
      if (!filterRow) return;

      const tagFilter = filterRow.querySelector('.stars-tag-filter');
      const insertAfter = tagFilter || filterRow.firstChild;

      // --- Custom Language button ---
      const langContainer = document.createElement('div');
      langContainer.className = 'stars-custom-filter mb-1 mb-lg-0';

      // Collect unique languages from tag-filtered repos (ignoring language filter)
      const allResults = getTagFilteredRepos(true);
      const langSet = new Set();
      allResults.forEach(({ data }) => { if (data.lang) langSet.add(data.lang); });
      const languages = Array.from(langSet).sort((a, b) => a.localeCompare(b));

      const langBtnLabel = activeFilterLang ? 'Language: ' + activeFilterLang : 'Language';
      const langBtnEl = document.createElement('button');
      langBtnEl.type = 'button';
      langBtnEl.id = 'stars-custom-lang-button';
      langBtnEl.setAttribute('popovertarget', 'stars-custom-lang-overlay');
      langBtnEl.setAttribute('aria-haspopup', 'true');
      langBtnEl.className = 'Button--secondary Button--medium Button';
      if (activeFilterLang) langBtnEl.classList.add('has-active');
      langBtnEl.innerHTML =
        '<span class="Button-content"><span class="Button-label"></span></span>' +
        '<span class="Button-visual Button-trailingAction">' +
          '<svg aria-hidden="true" height="16" viewBox="0 0 16 16" width="16" class="octicon octicon-triangle-down">' +
            '<path d="m4.427 7.427 3.396 3.396a.25.25 0 0 0 .354 0l3.396-3.396A.25.25 0 0 0 11.396 7H4.604a.25.25 0 0 0-.177.427Z"></path>' +
          '</svg>' +
        '</span>';
      langBtnEl.querySelector('.Button-label').textContent = langBtnLabel;

      const langOverlay = document.createElement('anchored-position');
      langOverlay.id = 'stars-custom-lang-overlay';
      langOverlay.setAttribute('anchor', 'stars-custom-lang-button');
      langOverlay.setAttribute('align', 'start');
      langOverlay.setAttribute('side', 'outside-bottom');
      langOverlay.setAttribute('anchor-offset', 'normal');
      langOverlay.setAttribute('popover', 'auto');

      const langInner = document.createElement('div');
      langInner.className = 'Overlay Overlay--size-auto';
      const langBody = document.createElement('div');
      langBody.className = 'Overlay-body Overlay-body--paddingNone';
      const langList = document.createElement('ul');
      langList.className = 'ActionListWrap--inset ActionListWrap';
      langList.setAttribute('role', 'menu');

      // "All languages" option
      const allLi = document.createElement('li');
      allLi.className = 'ActionListItem';
      allLi.setAttribute('role', 'none');
      const allContent = document.createElement('a');
      allContent.className = 'ActionListContent';
      allContent.setAttribute('role', 'menuitemradio');
      allContent.setAttribute('aria-checked', String(!activeFilterLang));
      const allLabel = document.createElement('span');
      allLabel.className = 'ActionListItem-label';
      allLabel.textContent = 'All languages';
      allContent.appendChild(allLabel);
      allContent.addEventListener('click', (e) => {
        e.preventDefault();
        activeFilterLang = '';
        langOverlay.hidePopover();
        applyTagFilter();
        renderTagFilterBar();
        refreshTagPillStates();
      });
      allLi.appendChild(allContent);
      langList.appendChild(allLi);

      languages.forEach((lang) => {
        const li = document.createElement('li');
        li.className = 'ActionListItem';
        li.setAttribute('role', 'none');
        const content = document.createElement('a');
        content.className = 'ActionListContent';
        content.setAttribute('role', 'menuitemradio');
        content.setAttribute('aria-checked', String(activeFilterLang.toLowerCase() === lang.toLowerCase()));
        const label = document.createElement('span');
        label.className = 'ActionListItem-label';
        label.textContent = lang;
        content.appendChild(label);
        content.addEventListener('click', (e) => {
          e.preventDefault();
          activeFilterLang = lang;
          langOverlay.hidePopover();
          applyTagFilter();
          renderTagFilterBar();
          refreshTagPillStates();
        });
        li.appendChild(content);
        langList.appendChild(li);
      });

      langBody.appendChild(langList);
      langInner.appendChild(langBody);
      langOverlay.appendChild(langInner);
      langContainer.appendChild(langBtnEl);
      langContainer.appendChild(langOverlay);

      // --- Custom Sort button ---
      const sortContainer = document.createElement('div');
      sortContainer.className = 'stars-custom-filter mb-1 mb-lg-0 ml-2';

      const sortOptions = [
        { key: 'stars', label: 'Most stars' },
        { key: 'updated', label: 'Recently active' }
      ];
      const sortBtnLabel = 'Sort by: ' + (sortOptions.find(o => o.key === activeFilterSort) || sortOptions[0]).label;
      const sortBtnEl = document.createElement('button');
      sortBtnEl.type = 'button';
      sortBtnEl.id = 'stars-custom-sort-button';
      sortBtnEl.setAttribute('popovertarget', 'stars-custom-sort-overlay');
      sortBtnEl.setAttribute('aria-haspopup', 'true');
      sortBtnEl.className = 'Button--secondary Button--medium Button';
      sortBtnEl.innerHTML =
        '<span class="Button-content"><span class="Button-label"></span></span>' +
        '<span class="Button-visual Button-trailingAction">' +
          '<svg aria-hidden="true" height="16" viewBox="0 0 16 16" width="16" class="octicon octicon-triangle-down">' +
            '<path d="m4.427 7.427 3.396 3.396a.25.25 0 0 0 .354 0l3.396-3.396A.25.25 0 0 0 11.396 7H4.604a.25.25 0 0 0-.177.427Z"></path>' +
          '</svg>' +
        '</span>';
      sortBtnEl.querySelector('.Button-label').textContent = sortBtnLabel;

      const sortOverlay = document.createElement('anchored-position');
      sortOverlay.id = 'stars-custom-sort-overlay';
      sortOverlay.setAttribute('anchor', 'stars-custom-sort-button');
      sortOverlay.setAttribute('align', 'start');
      sortOverlay.setAttribute('side', 'outside-bottom');
      sortOverlay.setAttribute('anchor-offset', 'normal');
      sortOverlay.setAttribute('popover', 'auto');

      const sortInner = document.createElement('div');
      sortInner.className = 'Overlay Overlay--size-auto';
      const sortBody = document.createElement('div');
      sortBody.className = 'Overlay-body Overlay-body--paddingNone';
      const sortList = document.createElement('ul');
      sortList.className = 'ActionListWrap--inset ActionListWrap';
      sortList.setAttribute('role', 'menu');

      sortOptions.forEach((opt) => {
        const li = document.createElement('li');
        li.className = 'ActionListItem';
        li.setAttribute('role', 'none');
        const content = document.createElement('a');
        content.className = 'ActionListContent';
        content.setAttribute('role', 'menuitemradio');
        content.setAttribute('aria-checked', String(activeFilterSort === opt.key));
        const label = document.createElement('span');
        label.className = 'ActionListItem-label';
        label.textContent = opt.label;
        content.appendChild(label);
        content.addEventListener('click', (e) => {
          e.preventDefault();
          activeFilterSort = opt.key;
          sortOverlay.hidePopover();
          applyTagFilter();
          renderTagFilterBar();
          refreshTagPillStates();
        });
        li.appendChild(content);
        sortList.appendChild(li);
      });

      sortBody.appendChild(sortList);
      sortInner.appendChild(sortBody);
      sortOverlay.appendChild(sortInner);
      sortContainer.appendChild(sortBtnEl);
      sortContainer.appendChild(sortOverlay);

      // Insert custom buttons into filter row after Tags
      if (insertAfter && insertAfter.nextSibling) {
        filterRow.insertBefore(langContainer, insertAfter.nextSibling);
        filterRow.insertBefore(sortContainer, langContainer.nextSibling);
      } else {
        filterRow.appendChild(langContainer);
        filterRow.appendChild(sortContainer);
      }
    } else {
      // Restore native action-menus
      if (typeMenu) typeMenu.style.display = '';
      if (langMenu) langMenu.style.display = '';
      if (sortMenu) sortMenu.style.display = '';

      // Remove custom filter buttons
      document.querySelectorAll('.stars-custom-filter').forEach(el => el.remove());
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
      if (tagsContainer.querySelector('.stars-tag-input')) return;

      addBtn.style.display = 'none';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'stars-tag-input';
      input.placeholder = '标签名';
      tagsContainer.appendChild(input);
      input.focus();

      function commit() {
        const val = input.value.trim();
        if (val) {
          const current = getTags(repoId);
          if (current.includes(val)) { input.remove(); addBtn.style.display = ''; return; }
          current.push(val);
          saveTags(repoId, current);
          renderTags(tagsContainer);
          renderTagFilterBar();
          applyTagFilter();
        } else {
          input.remove();
          addBtn.style.display = '';
        }
      }

      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
        if (ev.key === 'Escape') { input.remove(); addBtn.style.display = ''; }
      });
      input.addEventListener('blur', () => commit());
    });
    tagsContainer.appendChild(addBtn);
  }

  function renderNotes(notesContainer) {
    const repoId = notesContainer.dataset.repoId;
    if (!repoId) return;

    const note = getNote(repoId);
    notesContainer.innerHTML = '';

    if (note) {
      const textEl = document.createElement('div');
      textEl.className = 'stars-card-notes-text';
      textEl.textContent = note;
      notesContainer.appendChild(textEl);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'stars-card-notes-placeholder';
      placeholder.textContent = '添加备注…';
      notesContainer.appendChild(placeholder);
    }

    notesContainer.addEventListener('click', function onEdit(e) {
      e.stopPropagation();
      if (notesContainer.querySelector('.stars-card-notes-edit')) return;

      notesContainer.removeEventListener('click', onEdit);
      notesContainer.innerHTML = '';

      const textarea = document.createElement('textarea');
      textarea.className = 'stars-card-notes-edit';
      textarea.value = getNote(repoId);
      textarea.placeholder = '输入备注…';
      notesContainer.appendChild(textarea);
      textarea.focus();

      let cancelled = false;

      function commit() {
        if (cancelled) return;
        const val = textarea.value.trim();
        saveNote(repoId, val);
        renderNotes(notesContainer);
      }

      textarea.addEventListener('blur', () => commit());
      textarea.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') { cancelled = true; renderNotes(notesContainer); }
      });
    });
  }

  /* ================================================================
   *  SECTION 9: DOM TRANSFORM
   * ================================================================ */

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
      const metaDiv = item.querySelector('div.f6.color-fg-muted');

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

      cardHTML += `<div class="stars-card-notes" data-repo-id="${repoId}"></div>`;

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

      // 渲染备注
      const notesContainer = card.querySelector('.stars-card-notes');
      if (notesContainer) renderNotes(notesContainer);
    });

    // 分页器
    const paginator = colLg9.querySelector('.paginate-container:not(.stars-original-hidden)');
    if (paginator) {
      gridContainer.appendChild(paginator.cloneNode(true));
      paginator.classList.add('stars-original-hidden');
    }

    colLg9.appendChild(gridContainer);

    // 将 Starred topics 移到右侧边栏
    const colLg3 = turboFrame.querySelector('.col-lg-3');
    const layoutEl = document.querySelector('.Layout.Layout--sidebarPosition-start');
    if (colLg3 && layoutEl) {
      let rightSidebar = layoutEl.querySelector('.stars-right-sidebar');
      if (!rightSidebar) {
        rightSidebar = document.createElement('div');
        rightSidebar.className = 'stars-right-sidebar';
        layoutEl.appendChild(rightSidebar);
      }
      rightSidebar.innerHTML = '';
      while (colLg3.firstChild) {
        rightSidebar.appendChild(colLg3.firstChild);
      }
    }

    // 渲染筛选栏并应用筛选
    renderTagFilterBar();
    applyTagFilter();

    return true;
  }

  /* ================================================================
   *  SECTION 10: INIT & EVENTS
   * ================================================================ */

  // 页面类型检测
  const isStarsPage = /[?&]tab=stars/.test(location.search);
  const repoIdMeta = document.querySelector('meta[name="octolytics-dimension-repository_id"]');
  const isRepoDetailPage = !isStarsPage && !!repoIdMeta;

  // 仓库详情页：缓存 + 监听 unstar + 提前返回
  if (isRepoDetailPage) {
    cleanupExpiredUnstarred();
    extractAndCacheRepoFromDetailPage();
    const unstarForm = document.querySelector('.starred form[action$="/unstar"]');
    if (unstarForm) {
      unstarForm.addEventListener('submit', () => {
        const repoId = repoIdMeta.getAttribute('content');
        if (repoId) markRepoUnstarred(repoId);
      });
    }
    return;
  }

  if (!isStarsPage) return;

  // Stars 页面初始化
  injectStyles();
  migrateTagsIfNeeded();
  cleanupExpiredUnstarred();
  let activeFilterTags = [];
  let activeFilterLang = '';      // '' = all languages
  let activeFilterSort = 'stars'; // 'updated' | 'stars'
  let tagModeActive = false;      // tracks whether we're currently in tags mode

  // 执行转换 + MutationObserver + Turbo 事件
  if (!transformStarsList()) {
    const observer = new MutationObserver((mutations, obs) => {
      if (transformStarsList()) {
        obs.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 10000);
  }

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

  // Fix GitHub native "Clear filter" — force full navigation to clean ?tab=stars
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a.issues-reset-query');
    if (!link) return;
    e.preventDefault();
    const baseUrl = new URL(location.href);
    location.href = baseUrl.pathname + '?tab=stars';
  });
})();
