// 到货页快照（外部 unstar 检测层，P1 + P2.5 的「发现」半边）。
//
// 每次 Stars 内容真实到货（直载转换、Turbo 重渲染、原地翻页换入）记录
// {repoId: 'owner/repo'}，与**上一次同 URL 到货**做 diff；消失的仓库只作为
// 候选交给 starCheck 的 API 核对，双 404 确认前绝不动数据（2026-09-22 决策，
// 记录见 AGENTS.md）。
//
// 语义要点：
// - 快照按「规范化页 URL」分键。原地翻页不 pushState，翻页到货用**取回内容的
//   href** 作键；直载 / Turbo 到货用 location.href（page=1 归一化删除、query 排序）。
//   当前内容对应的键由 currentKey 跟踪：Turbo 保留 frame 时重复 transform 也落在
//   正确的键上，不会把第 2 页内容记到第 1 页键下。
// - 消失 ≠ unstar：新 star 顶入、排序变化同样会把仓库挤出本页 → 204 即位移。
// - 空到货（0 张卡，含转换失败）不更新快照：不能把渲染失败当成全量 unstar。
// - 同键首次到货只建基线不产候选；持久化后跨会话的同页 diff 才有基线可比。
// - 读卡片只取非 cached 的原页卡（筛选/搜索拼出的缓存卡不算到货内容）。

import { STORAGE_KEYS } from './constants';
import { gmGet, gmSet } from './gm';
import { enqueueVerify, onExternalUnstarConfirmed } from './starCheck';
import { isDesktop } from './utils';
import type { PageSnapshots } from './types';

/** 单次到货交给核对的候选上限（P2.5 预算） */
const PER_ARRIVAL_CAP = 8;
/** 单次消失数量超过它 → 应走全量比对（P4 全量拉取，尚未落地） */
const FULL_SYNC_THRESHOLD = 12;

let currentKey: string | null = null;

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

  if (prev) {
    const missing: { repoId: string; path: string }[] = [];
    for (const id in prev) {
      if (!(id in arrival)) missing.push({ repoId: id, path: prev[id] });
    }
    if (missing.length > 0) handleMissing(missing);
  }

  // 仅当前键内容变化才写盘（Turbo 事件会重复触发本函数，内容相同不产生写放大）
  if (!prev || JSON.stringify(prev) !== arrivalJson) {
    all[key] = arrival;
    gmSet(STORAGE_KEYS.pageSnapshots, all);
  }
}

function handleMissing(missing: { repoId: string; path: string }[]): void {
  if (missing.length > FULL_SYNC_THRESHOLD) {
    console.log(
      `[github-stars-grid] 快照检测到 ${missing.length} 个仓库从本页消失（> ${FULL_SYNC_THRESHOLD}，` +
        `疑似整段位移或大范围变动）：本页仅核对前 ${PER_ARRIVAL_CAP} 个；` +
        '全量比对（P4 全量拉取）落地后这类场景应优先走整表 diff'
    );
  } else {
    console.log(
      `[github-stars-grid] 快照检测到 ${missing.length} 个仓库从本页消失（位移/排序变化也会触发）：` +
        `交 API 核对 ${Math.min(missing.length, PER_ARRIVAL_CAP)} 个，双 404 确认前不动数据`
    );
  }
  enqueueVerify(missing.slice(0, PER_ARRIVAL_CAP));
}

/** 确认 unstar 后从所有页快照清除该 repoId（防止换页后再次被列为候选） */
function purgeRepoFromSnapshots(repoId: string): void {
  const all = gmGet<PageSnapshots>(STORAGE_KEYS.pageSnapshots, {});
  let changed = false;
  for (const key in all) {
    if (repoId in all[key]) {
      delete all[key][repoId];
      changed = true;
    }
  }
  if (changed) {
    gmSet(STORAGE_KEYS.pageSnapshots, all);
    console.log(`[github-stars-grid] repoId ${repoId} 已从全部到货页快照清除`);
  }
}

// starCheck 确认回调（starCheck 不反向依赖本模块，避免循环 import）
onExternalUnstarConfirmed(purgeRepoFromSnapshots);
