/** 纯目标规范化：不访问网络、DOM 或存储，导入导出也可复用。 */
export interface RepoTarget {
  repoId?: string;
  fullName?: string;
}

export interface ResolvedRepoTarget {
  repoId: string;
  fullName: string;
}

export function numericRepoId(value: unknown): string {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return '';
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  return /^[1-9]\d*$/.test(text) ? text : '';
}

export function repoFullName(value: unknown): string {
  if (typeof value !== 'string') return '';
  // 不接受 URL、编码路径、额外路径段和 dot segments；不静默修剪到另一个地址。
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\/[a-zA-Z0-9_.-]+$/.test(value)) return '';
  const repo = value.split('/')[1];
  return repo === '.' || repo === '..' ? '' : value;
}

/** DOM 登出投影可能把 owner/repo 放在 repoId 字段；只在入口把它转换为名称提示。 */
export function repoTarget(repoId: string, fullName = ''): RepoTarget {
  const projectedName = repoFullName(repoId);
  return { repoId: projectedName ? undefined : repoId || undefined,
    fullName: repoFullName(fullName) || projectedName || undefined };
}

export function repoTargetKey(target: RepoTarget): string {
  const id = numericRepoId(target.repoId);
  if (target.repoId && !id) return '';
  const name = repoFullName(target.fullName);
  return id ? `repo:${id}` : name ? `name:${name.toLowerCase()}` : '';
}

export function encodedRepoName(fullName: string): string {
  if (!repoFullName(fullName)) throw new Error('非法仓库地址');
  return fullName.split('/').map(encodeURIComponent).join('/');
}

export function starredUrl(fullName: string): string {
  return `https://api.github.com/user/starred/${encodedRepoName(fullName)}`;
}
