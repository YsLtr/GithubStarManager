// 线上 DOM 选择器体检：逐个统计本项目依赖的选择器命中数
// 用法：agent-browser-cli exec --tab <id> --file tests/diag/selectors.js
(function () {
  const q = (s) => document.querySelectorAll(s).length;
  const one = (s) => !!document.querySelector(s);
  const out = { href: location.href, title: document.title, counts: {}, flags: {} };

  const sel = [
    // transform.ts 入口
    'turbo-frame#user-starred-repos',
    'turbo-frame#user-starred-repos .col-lg-9',
    'turbo-frame#user-starred-repos .col-lg-3',
    '.Layout.Layout--sidebarPosition-start',
    // 仓库列表项
    '.col-12.d-block.width-full.py-4.border-bottom',
    'turbo-frame#user-starred-repos .col-12.d-block.width-full.py-4.border-bottom',
    'li.col-12.d-block.width-full.py-4.border-bottom',
    '[data-testid="starred-repo"]',
    'div[id^="user-starred-repos"]',
    '#user-starred-repos',
    '[id*="user-starred-repos"]',
    // 卡片字段
    'h3',
    'h3 > a',
    'p[itemprop="description"]',
    'div.f6.color-fg-muted',
    'span[itemprop="programmingLanguage"]',
    'span.repo-language-color',
    'a[href*="/stargazers"]',
    'a[href*="/forks"]',
    'relative-time',
    // 分组标题 / 列表开关
    'h2.f3-light',
    '[data-toggle-for*="details-user-list-"]',
    '.paginate-container',
    // 原生筛选控件
    '#stars-language-filter-menu-button',
    '#stars-sort-menu-button',
    '#stars-type-filter-menu-button',
    'action-menu',
    '.Button-label',
    '.TableObject.border-bottom',
    'input[placeholder*="Search starred"]',
    // 我们注入的标记
    '.stars-grid-container',
    '.stars-grid-card',
    '.stars-tag-filter',
    '.stars-tag-info-bar',
    '.stars-original-hidden',
  ];
  for (const s of sel) out.counts[s] = q(s);

  out.flags.ourStyleInjected = Array.from(document.querySelectorAll('style'))
    .some((s) => (s.textContent || '').includes('.stars-grid-card'));
  out.flags.turboFrames = Array.from(document.querySelectorAll('turbo-frame')).map((f) => f.id).slice(0, 20);

  // 主列表区域的骨架（只看标签+class，忽略文本）
  const skeleton = (el, depth, maxDepth) => {
    if (depth > maxDepth) return null;
    const tag = el.tagName.toLowerCase();
    const cls = el.className && typeof el.className === 'string' ? el.className.trim() : '';
    const id = el.id ? '#' + el.id : '';
    const kids = Array.from(el.children).map((c) => skeleton(c, depth + 1, maxDepth)).filter(Boolean);
    return { t: tag + id + (cls ? '.' + cls.split(/\s+/).join('.') : ''), ...(kids.length ? { c: kids } : {}) };
  };
  const root = document.querySelector('turbo-frame#user-starred-repos') ||
               document.querySelector('[id*="user-starred-repos"]') ||
               document.querySelector('main') ||
               document.body;
  out.skeleton = skeleton(root, 0, 4);

  return JSON.stringify(out, null, 1);
})();
