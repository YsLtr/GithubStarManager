// ==UserScript==
// @name         GitHub Stars Grid View
// @namespace    https://github.com/YsLtr
// @version      1.7
// @description  将 GitHub Stars 页面的列表视图改为卡片网格视图，缩小左侧个人资料栏，最大化仓库展示空间（仅桌面端生效）
// @author       YsLtr
// @match        https://github.com/*tab=stars*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

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

      /* 侧边栏内容自适应窄宽度 */
      .Layout-sidebar .h-card,
      .Layout-sidebar .js-profile-editable-replace {
        overflow: hidden !important;
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
        margin: 0 0 8px 0 !important;
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

    } /* end @media */
  `);

  // ====== DOM 重构逻辑 ======
  function isDesktop() {
    return window.innerWidth >= MOBILE_BREAKPOINT;
  }

  // ====== 标签存储 ======
  function loadAllTags() {
    return GM_getValue('stars_tags', {});
  }

  function saveTags(repoId, tagsArray) {
    const all = loadAllTags();
    if (tagsArray.length === 0) {
      delete all[repoId];
    } else {
      all[repoId] = tagsArray;
    }
    GM_setValue('stars_tags', all);
  }

  function getTags(repoId) {
    const all = loadAllTags();
    return all[repoId] || [];
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
      span.textContent = tag;

      const del = document.createElement('span');
      del.className = 'stars-tag-del';
      del.textContent = '×';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        const current = getTags(repoId);
        current.splice(idx, 1);
        saveTags(repoId, current);
        renderTags(tagsContainer);
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
      }
    });
    tagsContainer.appendChild(addBtn);
  }

  function transformStarsList() {
    if (!isDesktop()) return false;

    const turboFrame = document.getElementById('user-starred-repos');
    if (!turboFrame) return false;

    const colLg9 = turboFrame.querySelector('.col-lg-9');
    if (!colLg9) return false;

    const repoItems = colLg9.querySelectorAll('.col-12.d-block.width-full.py-4.border-bottom:not(.stars-original-hidden)');
    if (repoItems.length === 0) {
      // 可能已经转换过
      return !!colLg9.querySelector('.stars-grid-container');
    }

    // 如果已经转换过，跳过
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

    // 创建网格容器
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
        // 将元信息分为两组：主信息（语言+star+fork）和更新时间
        const langSpan = metaDiv.querySelector('span.ml-0, span:has(.repo-language-color)');
        const starLink = metaDiv.querySelector('a[href*="/stargazers"]');
        const forkLink = metaDiv.querySelector('a[href*="/forks"]');

        let mainParts = '';
        if (langSpan) mainParts += langSpan.outerHTML;
        if (starLink) mainParts += starLink.outerHTML;
        if (forkLink) mainParts += forkLink.outerHTML;

        // 更新时间：剩余的文本节点 "Updated" + <relative-time> 或纯文本
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

    // 插入到 colLg9 内部末尾
    colLg9.appendChild(gridContainer);

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
