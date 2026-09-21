/** 当前页面仓库数字 ID 的 meta 标签（仅仓库详情页存在） */
export function getRepoIdMeta(): HTMLMetaElement | null {
  return document.querySelector('meta[name="octolytics-dimension-repository_id"]');
}

/** 从 star/unstar toggler 容器判断仓库是否已 star */
export function isStarredInToggler(root: Element): boolean {
  const starredDiv = root.querySelector('.starred');
  return !!starredDiv && getComputedStyle(starredDiv).display !== 'none';
}

/** 仓库卡片（列表项）的 star toggler 容器 */
export function getToggler(root: ParentNode): Element | null {
  return root.querySelector('.js-toggler-container.starring-container');
}
