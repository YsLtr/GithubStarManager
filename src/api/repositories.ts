import { encodedRepoName, numericRepoId, repoFullName, starredUrl, type RepoTarget, type ResolvedRepoTarget } from './repoTarget';

export type TargetFailureReason = 'invalid-target' | 'target-mismatch' | 'not-found' | 'unauthorized' | 'permission-denied' | 'rate-limited' | 'network' | 'unknown';
export interface TargetFailure {
  ok: false;
  reason: TargetFailureReason;
  status: number;
}
export type TargetResult = { ok: true; target: ResolvedRepoTarget } | TargetFailure;
export interface ReadOptions {
  /** 同步可在这里检查整个核对阶段的额度；抛错必须向上传递，禁止变成单条 unknown。 */
  onResponse?: (response: Response) => void;
}

export function hasRateLimitSignal(resp: Response, bodyText = ''): boolean {
  return resp.status === 429 || !!resp.headers.get('retry-after') ||
    resp.headers.get('x-ratelimit-remaining') === '0' || /secondary rate limit/i.test(bodyText);
}

interface ApiReadResult { response: Response; body: string }

async function apiRead(url: string, token: string, options: ReadOptions): Promise<ApiReadResult | TargetFailure> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    let resp: Response;
    try {
      // 浏览器 manual 重定向会给 opaqueredirect，读不到 Location。原生 follow 有重定向上限，
      // Fetch 会在跨源跳转时剥离 Authorization；最终地址仍需检查。Cookie 永远不送给 API。
      resp = await fetch(url, { cache: 'no-store', credentials: 'omit', redirect: 'follow', signal: controller.signal,
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
          ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    } catch {
      return { ok: false, reason: 'network', status: 0 };
    }
    // 回调可中止整轮同步，必须在网络/正文错误的 catch 之外调用。
    options.onResponse?.(resp);
    if (resp.url && new URL(resp.url).origin !== 'https://api.github.com') return { ok: false, reason: 'target-mismatch', status: resp.status };
    if (hasRateLimitSignal(resp)) return { ok: false, reason: 'rate-limited', status: resp.status };
    const remaining = resp.headers.get('x-ratelimit-remaining');
    if (remaining !== null && Number(remaining) < 10) return { ok: false, reason: 'rate-limited', status: resp.status };
    let body = '';
    try {
      // fetch 在响应头到达时即兑现；超时必须继续覆盖所需的正文读取。
      if (resp.status === 200 || resp.status === 403) body = await resp.text();
    } catch {
      return { ok: false, reason: 'network', status: 0 };
    }
    return { response: resp, body };
  } finally {
    clearTimeout(timeout);
    controller.abort(); // 早退或回调抛错时也停止未消费的响应体。
  }
}

function failure(resp: Response, text: string): TargetFailure {
  if (resp.status === 401) return { ok: false, reason: 'unauthorized', status: 401 };
  if (resp.status === 404) return { ok: false, reason: 'not-found', status: 404 };
  if (resp.status === 403 || resp.status === 429) {
    return { ok: false, reason: hasRateLimitSignal(resp, text) ? 'rate-limited' : 'permission-denied', status: resp.status };
  }
  return { ok: false, reason: 'unknown', status: resp.status };
}

async function readRepository(path: string, token: string, expectedId: string, options: ReadOptions): Promise<TargetResult> {
  const read = await apiRead(`https://api.github.com${path}`, token, options);
  if ('reason' in read) return read;
  const { response, body } = read;
  if (response.status !== 200) return failure(response, body);
  try {
    const data = JSON.parse(body) as { id?: unknown; full_name?: unknown };
    const id = numericRepoId(data.id);
    const name = repoFullName(data.full_name);
    if (!id || !name) return { ok: false, reason: 'unknown', status: 200 };
    if (expectedId && expectedId !== id) return { ok: false, reason: 'target-mismatch', status: 200 };
    return { ok: true, target: { repoId: id, fullName: name } };
  } catch {
    return { ok: false, reason: 'unknown', status: 200 };
  }
}

/** 不用长期名称缓存，也不在读取时写 stars_repo_cache。只在执行操作时调用。 */
export async function resolveRepoTarget(token: string, target: RepoTarget, options: ReadOptions = {}): Promise<TargetResult> {
  const id = numericRepoId(target.repoId);
  const name = repoFullName(target.fullName);
  if (target.repoId && !id) return { ok: false, reason: 'invalid-target', status: 0 };
  if (id) {
    const result = await readRepository(`/repositories/${id}`, token, id, options);
    if (result.ok || result.reason !== 'not-found' || !name) return result;
    // ID 404 不证明仓库消失；名称只作为另一次查找，最终必须仍为原 ID。
  } else if (!name) return { ok: false, reason: 'invalid-target', status: 0 };
  return readRepository(`/repos/${encodedRepoName(name)}`, token, id, options);
}

export type StarCheckResult = { ok: true; gone: boolean; target: ResolvedRepoTarget } | TargetFailure;
export async function checkRepoStarred(token: string, target: RepoTarget, options: ReadOptions = {}): Promise<StarCheckResult> {
  const resolved = await resolveRepoTarget(token, target, options);
  if (!resolved.ok) return resolved;
  const read = await apiRead(starredUrl(resolved.target.fullName), token, options);
  if ('reason' in read) return read;
  const { response, body } = read;
  if (response.status === 204 || response.status === 404) return { ok: true, gone: response.status === 404, target: resolved.target };
  return failure(response, body);
}

/** 先完成全部核对再交回调用者提交；中途限流/凭证失效不会留下半份 diff。 */
export async function collectStarredChecks(
  token: string, targets: RepoTarget[], remaining: number | null, onResponse?: (response: Response) => void,
): Promise<StarCheckResult[]> {
  const floor = 10;
  // 一条最多 ID + 名称回退 + 星标状态三次显式请求（重定向由响应额度继续约束）。
  if (remaining !== null && remaining < targets.length * 3 + floor) throw new Error('速率余量不足以完成仓库核对，本轮放弃');
  const results: StarCheckResult[] = [];
  for (const target of targets) {
    const result = await checkRepoStarred(token, target, { onResponse: response => {
      onResponse?.(response);
      const header = response.headers.get('x-ratelimit-remaining');
      const observed = header === null ? NaN : Number(header);
      if (remaining !== null) remaining -= 1;
      if (Number.isFinite(observed)) remaining = remaining === null ? observed : Math.min(remaining, observed);
      if (remaining !== null && remaining < floor) throw new Error('仓库核对期间速率余量不足，本轮放弃');
    } });
    if (!result.ok && (result.reason === 'rate-limited' || result.reason === 'unauthorized')) {
      throw new Error(result.reason === 'rate-limited' ? '仓库核对触发限流，本轮放弃' : 'Token 已失效，本轮放弃');
    }
    results.push(result);
  }
  return results;
}
