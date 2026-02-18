// ==UserScript==
// @name         GitHub Stars Grid View
// @namespace    https://github.com/YsLtr
// @version      1.4
// @description  将 GitHub Stars 页面的列表视图改为卡片网格视图，缩小左侧个人资料栏，最大化仓库展示空间
// @author       YsLtr
// @match        https://github.com/*tab=stars*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  GM_addStyle(`
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
    }
    /* 隐藏右侧 Starred topics */
    turbo-frame#user-starred-repos .col-lg-3 {
      display: none !important;
    }

    /* ===== 4. 隐藏 Lists 区域（精确匹配标题栏和列表容器，不隐藏父级） ===== */
    turbo-frame#user-profile-frame > div > .my-3.d-flex.flex-justify-between.flex-items-center:has(h2.f3-light),
    turbo-frame#user-profile-frame > div > #profile-lists-container {
      display: none !important;
    }

    /* ===== 5. 网格容器 ===== */
    .stars-grid-container {
      display: grid !important;
      grid-template-columns: repeat(3, 1fr) !important;
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
      flex-grow: 1 !important;
    }

    /* 卡片底部元信息 */
    .stars-grid-card .stars-card-meta {
      font-size: 12px !important;
      color: var(--fgColor-muted, #656d76) !important;
      display: flex !important;
      align-items: center !important;
      flex-wrap: wrap !important;
      gap: 12px !important;
      margin-top: auto !important;
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

    /* 分页器占满整行 */
    .stars-grid-container .paginate-container {
      grid-column: 1 / -1 !important;
    }

    /* 隐藏原始列表项 */
    .stars-original-hidden {
      display: none !important;
    }
  `);

  // ====== DOM 重构逻辑 ======
  function transformStarsList() {
    const turboFrame = document.getElementById('user-starred-repos');
    if (!turboFrame) return false;

    const colLg9 = turboFrame.querySelector('.col-lg-9');
    if (!colLg9) return false;

    // 找到所有 starred repo 项
    const repoItems = colLg9.querySelectorAll('.col-12.d-block.width-full.py-4.border-bottom');
    if (repoItems.length === 0) return false;

    // 如果已经转换过，跳过
    if (colLg9.querySelector('.stars-grid-container')) return true;

    // 隐藏 Lists 区域（精确隐藏标题栏和列表容器，不动父级）
    const profileFrame = document.getElementById('user-profile-frame');
    if (profileFrame) {
      const wrapperDiv = profileFrame.firstElementChild;
      if (wrapperDiv) {
        Array.from(wrapperDiv.children).forEach((child) => {
          // 隐藏 Lists 标题栏（含 h2.f3-light）
          const h2 = child.querySelector('h2.f3-light');
          if (h2 && h2.textContent.includes('Lists')) {
            child.style.display = 'none';
          }
          // 隐藏 Lists 列表容器
          if (child.id === 'profile-lists-container') {
            child.style.display = 'none';
          }
        });
      }
    }

    // 创建网格容器
    const gridContainer = document.createElement('div');
    gridContainer.className = 'stars-grid-container';

    // 为每个 repo 创建卡片
    repoItems.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'stars-grid-card';

      const h3 = item.querySelector('h3');
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

      if (metaDiv) {
        cardHTML += `<div class="stars-card-meta">${metaDiv.innerHTML}</div>`;
      }

      card.innerHTML = cardHTML;
      gridContainer.appendChild(card);

      // 隐藏原始项
      item.classList.add('stars-original-hidden');
    });

    // 分页器
    const paginator = colLg9.querySelector('.paginate-container');
    if (paginator) {
      gridContainer.appendChild(paginator.cloneNode(true));
      paginator.classList.add('stars-original-hidden');
    }

    // 将网格容器插入到 colLg9 内部末尾
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
