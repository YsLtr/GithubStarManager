// 到货页快照（外部 unstar 检测层，P1 + P2.5 的「发现」半边）。
//
// 每次 Stars 内容真实到货（直载转换、Turbo 重渲染、原地翻页换入）记录
// {repoId: 'owner/repo'}，与**上一次同 URL 到货**做 presence-diff。消失 ≠ unstar：
// 按「排序方式 + 每页数量」直接算位移模型（2026-09-22 用户决策，见 AGENTS.md D4）——
// 模型可解释的消失**挂起到预期页结案**（出现=位移确认即清；缺失=本该在本页却没有，
// 才交 starCheck 的 API 核对，双 404 前绝不动数据）；无位移模型的排序直接核对。
//
// 语义要点：
// - 快照按「规范化页 URL」分键。原地翻页不 pushState，翻页到货用**取回内容的
//   href** 作键；直载 / Turbo 到货用 location.href（page=1 归一化删除、query 排序）。
//   当前内容对应的键由 currentKey 跟踪：Turbo 保留 frame 时重复 transform 也落在
//   正确的键上，不会把第 2 页内容记到第 1 页键下。
// - **不存顺序**：位移判定只用集合成员性（排序键 star 时间页面 HTML 不提供，
//   存顺序 + 对齐是过度设计；预期页的成员检测等价且更简单）。
// - 排序参数（线上实测）：sort 缺省 / sort=created = 最近 starred；sort=updated =
//   最近活跃；sort=stars = 最多 star；direction 缺省 / desc = 降序，asc = 升序。
//   created+desc 新 star 顶入 → 挤向下一页；created+asc 新 star 沉底 → 只有
//   上方 unstar 会把条目拉向页码更小的一页；updated / stars 排序键独立漂移、
//   跳页无规律 → 无位移模型。
// - 空到货（0 张卡，含转换失败）不更新快照也不结算挂起：不能把渲染失败当成全量
//   unstar；副作用是「列表末页的挂起项」要等 TTL 过期（永不到货的预期页无法结案）。
// - 同键首次到货只建基线不产候选；持久化后跨会话的同页 diff 才有基线可比。
// - 读卡片只取非 cached 的原页卡（筛选/搜索拼出的缓存卡不算到货内容）。

import { STORAGE_KEYS } from './constants';
import { gmGet, gmSet } from './gm';
import { enqueueVerify, getGitHubPat, onExternalUnstarConfirmed } from './starCheck';
import { scheduleFullSync } from './fullSync';
import { isDesktop } from './utils';
import type { PageSnapshots, ShiftPendingMap } from './types';

/** 单次交给核对的候选上限（P2.5 预算） */
const PER_ARRIVAL_CAP = 8;
/** 单次消失数量超过它 → 应走全量比对（P4 全量拉取，尚未落地） */
const FULL_SYNC_THRESHOLD = 12;
/** 位移挂起上限（超出按入队时间淘汰最旧） */
const PENDING_CAP = 60;
/** 位移挂起过期：预期页一直不到货则放弃结案（只 stale 不动数据） */
const PENDING_TTL = 30 * 24 * 3600 * 1000;

let currentKey: string | null = null;

interface Missing {
  repoId: string;
  path: string;
}

/** 页 URL 规范化：去 hash、page=1 视同无 page、query 排序 */
function normalizeKey(url: string): string {
  try {
    const u = new URL(url, location.href);
    u.hash = '';
    if (u.searchParams.get('page') === '1') u.searchParams.delete('page');
    u.searchParams.sort();
    return u.href;
  } catch {
    return url;
  }
}

/**
 * 按排序方式 + 页码算「被挤出本页的仓库应该出现在哪一页」的键。
 * 返回 null = 无位移模型（updated / stars 排序）或无预期页（升序第 1 页），
 * 消失直接交 API 核对。
 */
function expectationKey(key: string): string | null {
  try {
    const u = new URL(key);
    const pageNo = parseInt(u.searchParams.get('page') ?? '1', 10) || 1;
    const sort = u.searchParams.get('sort');
    // 最近 starred（缺省 / created）才有稳定的位移方向
    if (sort !== null && sort !== 'created') return null;
    // desc：新 star 顶入 → 整体下移 → 挤到下一页；asc：新 star 沉底 →
    // 只有上方 unstar 会把条目拉向页码更小的一页
    const asc = u.searchParams.get('direction') === 'asc';
    const target = asc ? pageNo - 1 : pageNo + 1;
    if (target < 1) return null;
    if (target <= 1) u.searchParams.delete('page');
    else u.searchParams.set('page', String(target));
    return normalizeKey(u.href);
  } catch {
    return null;
  }
}

/** 读取当前到货的真实页内容（排除筛选/搜索拼装的缓存卡） */
function readArrival(): Record<string, string> {
  const map: Record<string, string> = {};
  document
    .querySelectorAll<HTMLElement>('.stars-grid-container .stars-grid-card:not(.stars-grid-card-cached)')
    .forEach((card) => {
      const id = card.dataset.repoId;
      const name = card.dataset.repoName;
      if (id && name) map[id] = name;
    });
  return map;
}

/**
 * 到货记录入口。
 * @param fetchedUrl 原地翻页取回内容的 href；直载 / Turbo 到货省略（跟随 currentKey / location）
 */
export function recordArrival(fetchedUrl?: string): void {
  if (!isDesktop()) return;
  const arrival = readArrival();
  if (Object.keys(arrival).length === 0) return;

  const key = normalizeKey(fetchedUrl ?? currentKey ?? location.href);
  currentKey = key;

  const all = gmGet<PageSnapshots>(STORAGE_KEYS.pageSnapshots, {});
  const prev = all[key];
  const arrivalJson = JSON.stringify(arrival);

  // 先结算位移挂起：本页可见 = 位移确认（清）；预期页正是本页却缺失 = 才核对
  resolvePending(key, arrival);

  if (prev) {
    const missing: Missing[] = [];
    for (const id in prev) {
      if (!(id in arrival)) missing.push({ repoId: id, path: prev[id] });
    }
    if (missing.length > 0) {
      const expectKey = expectationKey(key);
      if (expectKey) deferMissing(missing, expectKey, key);
      else handleMissing(missing, '当前排序无位移模型或无预期页');
    }
  }

  // 仅当前键内容变化才写盘（Turbo 事件会重复触发本函数，内容相同不产生写放大）
  if (!prev || JSON.stringify(prev) !== arrivalJson) {
    all[key] = arrival;
    gmSet(STORAGE_KEYS.pageSnapshots, all);
  }
}

/** 结算位移挂起：在任何到货页可见即确认仍 star（无需核对）；预期页缺失才核对 */
function resolvePending(key: string, arrival: Record<string, string>): void {
  const pending = gmGet<ShiftPendingMap>(STORAGE_KEYS.shiftPending, {});
  const ids = Object.keys(pending);
  if (ids.length === 0) return;
  const now = Date.now();
  let changed = false;
  const confirmed: string[] = [];
  const expectedButMissing: Missing[] = [];
  for (const id of ids) {
    const entry = pending[id];
    if (id in arrival) {
      // 可见于任何到货页都算位移确认（可能被挤到更远的页后又被拉回）
      confirmed.push(id);
      delete pending[id];
      changed = true;
      continue;
    }
    if (entry.expectKey === key) {
      expectedButMissing.push({ repoId: id, path: `${entry.o}/${entry.n}` });
      delete pending[id];
      changed = true;
      continue;
    }
    if (now - entry.ts > PENDING_TTL) {
      delete pending[id];
      changed = true;
    }
  }
  if (confirmed.length > 0) {
    console.log(
      `[github-stars-grid] 位移确认：${confirmed.length} 个仓库在到货页可见（仍 star），清除挂起、不核对`
    );
  }
  if (expectedButMissing.length > 0) {
    console.log(
      `[github-stars-grid] ${expectedButMissing.length} 个仓库上一页被挤出、预期在本页却没有出现：` +
        `交 API 核对 ${Math.min(expectedButMissing.length, PER_ARRIVAL_CAP)} 个，双 404 确认前不动数据`
    );
    enqueueVerify(expectedButMissing.slice(0, PER_ARRIVAL_CAP));
  }
  if (changed) gmSet(STORAGE_KEYS.shiftPending, pending);
}

/** 位移模型可解释的消失：挂起到预期页结案（出现即清、缺失才核对），本页不核对 */
function deferMissing(missing: Missing[], expectKey: string, srcKey: string): void {
  const pending = gmGet<ShiftPendingMap>(STORAGE_KEYS.shiftPending, {});
  const now = Date.now();
  let added = 0;
  for (const item of missing) {
    const parts = item.path.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) continue;
    pending[item.repoId] = { o: parts[0], n: parts[1], expectKey, srcKey, ts: now };
    added++;
  }
  if (added === 0) return;
  const ids = Object.keys(pending);
  if (ids.length > PENDING_CAP) {
    ids.sort((a, b) => pending[a].ts - pending[b].ts);
    for (const id of ids.slice(0, ids.length - PENDING_CAP)) delete pending[id];
  }
  for (const id of Object.keys(pending)) {
    if (now - pending[id].ts > PENDING_TTL) delete pending[id];
  }
  gmSet(STORAGE_KEYS.shiftPending, pending);
  console.log(
    `[github-stars-grid] 位移挂起：${added} 个仓库从本页消失（排序模型判定为被挤出，本页不核对），` +
      `挂起到预期页结案（出现即清、缺失才核对）：${expectKey}`
  );
}

/** 无法用位移模型解释的消失：直接交 API 核对（有界） */
function handleMissing(missing: Missing[], reason: string): void {
  if (missing.length > FULL_SYNC_THRESHOLD && getGitHubPat()) {
    console.log(
      `[github-stars-grid] 快照检测到 ${missing.length} 个仓库从本页消失（${reason}，> ${FULL_SYNC_THRESHOLD}，` +
        '疑似大范围变动）：走 P4 全量拉取整表 diff（自动触发，60s 冷却）'
    );
    scheduleFullSync();
    return;
  }
  if (missing.length > FULL_SYNC_THRESHOLD) {
    console.log(
      `[github-stars-grid] 快照检测到 ${missing.length} 个仓库从本页消失（${reason}，> ${FULL_SYNC_THRESHOLD}）：` +
        `未配置 token，仅核对前 ${PER_ARRIVAL_CAP} 个；配置 token 后此类场景自动走 P4 全量比对`
    );
  } else {
    console.log(
      `[github-stars-grid] 快照检测到 ${missing.length} 个仓库从本页消失（${reason}）：` +
        `交 API 核对 ${Math.min(missing.length, PER_ARRIVAL_CAP)} 个，双 404 确认前不动数据`
    );
  }
  enqueueVerify(missing.slice(0, PER_ARRIVAL_CAP));
}

/** 确认 unstar 后从所有页快照与位移挂起中清除该 repoId（防止换页后再次被列为候选） */
function purgeRepoFromSnapshots(repoId: string): void {
  const all = gmGet<PageSnapshots>(STORAGE_KEYS.pageSnapshots, {});
  let changed = false;
  for (const key in all) {
    if (repoId in all[key]) {
      delete all[key][repoId];
      changed = true;
    }
  }
  const pending = gmGet<ShiftPendingMap>(STORAGE_KEYS.shiftPending, {});
  let pendingChanged = false;
  if (repoId in pending) {
    delete pending[repoId];
    pendingChanged = true;
  }
  if (changed) gmSet(STORAGE_KEYS.pageSnapshots, all);
  if (pendingChanged) gmSet(STORAGE_KEYS.shiftPending, pending);
  if (changed || pendingChanged) {
    console.log(`[github-stars-grid] repoId ${repoId} 已从全部到货页快照与位移挂起中清除`);
  }
}

// starCheck 确认回调（starCheck 不反向依赖本模块，避免循环 import）
onExternalUnstarConfirmed(purgeRepoFromSnapshots);
