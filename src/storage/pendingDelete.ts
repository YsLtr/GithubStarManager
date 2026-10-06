import { gmGet, gmSet } from '../gm';
import { GRACE_PERIOD, STORAGE_KEYS } from '../constants';
import { loadRepoCache, saveRepoCache } from './repoCache';
import { getStorageUserId, getTags, saveTags } from './tags';
import { getNote, saveNote } from './notes';
import type { PendingDeleteEntry, PendingDeleteMap, RepoData } from '../types';

/**
 * 宽限期备份存储键。**按归属账号分区**（4.18.0，风险 21 的修复点之一）。
 *
 * 旧实现是**单份全局键** `stars_pending_delete`（`Record<repoId, entry>`）—— 两个账号对**同一 repoId**
 * 各有一条备份时，抢的是同一个位置：后写的把前一条整个顶掉。给条目加 `owner` 字段救不了这一点
 * （那只是把「静默覆盖」变成「有标记地覆盖」，位置仍然只有一个）。**换个键才是隔离**，
 * 与 `stars_tags_<id>` / `stars_notes_<id>` 同构；分区之后「所属」由键名承载。
 */
function pendingDeleteKey(userId: string): string {
  return STORAGE_KEYS.pendingDeletePrefix + userId;
}

/**
 * 读当前归属账号的宽限期备份。**取不到归属 id ⇒ 空表**（不回落裸键）。
 *
 * 归属 id 为空有两种情形：登出（无登录者）、以及「无 token 且页面取不到 meta」。
 * 两者都不得看到别人的数据 —— 旧实现下这里会读出**上一个登录者**的私密标签与备注。
 */
export function loadPendingDelete(): PendingDeleteMap {
  const userId = getStorageUserId();
  if (!userId) return {};
  return gmGet<PendingDeleteMap>(pendingDeleteKey(userId), {});
}

/** 覆盖写入当前归属账号的宽限期备份；取不到归属 id ⇒ no-op（不写裸键） */
export function savePendingDelete(all: PendingDeleteMap): void {
  const userId = getStorageUserId();
  if (!userId) {
    console.warn('[github-star-manager] 取不到归属账号，已跳过宽限期备份写入（避免写进无隔离的旧键）');
    return;
  }
  gmSet(pendingDeleteKey(userId), all);
}

/**
 * 单条查询：该仓库是否**仍在** 24h 宽限期内（4.14.0）。
 *
 * 判据与 `listRestorable` 逐字一致（`unstarredAt + GRACE_PERIOD > now`），但**渲染时现算** ——
 * 刻意不依赖 `cleanupExpiredUnstarred()` 是否跑过：它只在两处跑 —— `ensureStarsSetup()`
 * （`index.ts:54`）与**仓库详情页**（`index.ts:566`）—— 一个开着超过 24h 的标签页里，
 * 过期条目会一直挂在存储里。
 * 只看「pending 里有没有」就会显示一份早该消失的数据。
 *
 * @returns 在宽限期内的条目本身（含 `_tags` / `_note` 备份）；`null` = 不在（从未 unstar / 已超期）
 */
export function getPendingInGrace(repoId: string, now = Date.now()): PendingDeleteEntry | null {
  if (!repoId) return null;
  const entry = loadPendingDelete()[repoId];
  if (!entry) return null;
  return (entry.unstarredAt || 0) + GRACE_PERIOD > now ? entry : null;
}

/** 宽限期备份里的一条可恢复条目（恢复窗口与简报用） */
export interface RestorableEntry {
  repoId: string;
  /** `owner/repo`（优先取缓存过的 name，缺失时退回 repoId） */
  name: string;
  /** 入宽限区的时刻（ms） */
  unstarredAt: number;
  /** 距 24h 宽限期结束的剩余毫秒数（>0；超期条目不在列表里） */
  remainingMs: number;
  /** 备份下来的标签（用于窗口里的说明） */
  tags: string[];
  /** 备份下来是否有备注 */
  hasNote: boolean;
}

/**
 * 列出仍在宽限期内、可恢复的条目，剩余时间短的排前面（用户最该先处理的）。
 * 超期条目不会出现在列表里 —— ADR 0003：超期即删除标签/备注，不留墓碑行。
 */
export function listRestorable(now = Date.now()): RestorableEntry[] {
  const pending = loadPendingDelete();
  const out: RestorableEntry[] = [];
  for (const repoId in pending) {
    const e = pending[repoId];
    const at = e.unstarredAt || 0;
    const remainingMs = at + GRACE_PERIOD - now;
    if (remainingMs <= 0) continue;
    out.push({
      repoId,
      name: e.name || repoId,
      unstarredAt: at,
      remainingMs,
      tags: e._tags || [],
      hasNote: !!(e._note && e._note.trim()),
    });
  }
  out.sort((a, b) => a.remainingMs - b.remainingMs);
  return out;
}

/** 剩余时长的可读文案（`23h 41m` / `41m` / `2m`） */
export function formatRemaining(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return '<1m';
}

/**
 * 记录 unstar：把数据移入待删除区（24h 宽限期），并备份标签与备注。
 * 宽限期内重新 star 可完整恢复（`markRepoStarred`）。
 *
 * ## 建立备份的判据：「**有东西要保全就必须建**」（4.14.0 修订）
 *
 * 旧实现是 `if (!cache[repoId]) return;` —— 只认本人整表缓存。那条判据在他人 stars 页上会漏：
 * 那页允许「点 star（只在 `viewContext` 的内存覆盖里，**不进缓存**）→ 给卡片加标签 → 点 unstar」，
 * 此时缓存里没有该仓库 ⇒ 直接 return ⇒ ① 数据不备份（宽限期里看不到标签）、② 活区**不被清空**
 * ⇒ 标签永久留在存储里，而只读卡片又没有删除入口，用户再也清不掉它。
 *
 * 现在只要满足任一条就建备份：本人缓存有该条目 / 调用方给了 `seed`（他人页卡片上的投影数据）/
 * 该仓库当下有非空标签或备注。三者皆无 = 无物可保 ⇒ 什么都不做（与旧行为一致）。
 *
 * 注：`cache[repoId]` 不存在时不写缓存（本来就没有可删的条目）。
 *
 * @param seed 他人 stars 页传入的投影数据 —— 它只存在于内存里，不落整表缓存（零网络、零缓存写入）
 */
export function markRepoUnstarred(repoId: string, seed?: RepoData): void {
  const cache = loadRepoCache();
  const existing = cache[repoId];
  const tags = getTags(repoId);
  const note = getNote(repoId);
  if (!existing && !seed && tags.length === 0 && !note) return;

  const pending = loadPendingDelete();
  pending[repoId] = Object.assign({}, existing || seed || {}, {
    unstarredAt: Date.now(),
    _tags: tags,
    _note: note,
  });
  savePendingDelete(pending);

  if (existing) {
    delete cache[repoId];
    saveRepoCache(cache);
  }
  saveTags(repoId, []);
  saveNote(repoId, '');
}

/** 记录 re-star：从待删除区恢复数据、标签与备注 */
export function markRepoStarred(repoId: string): void {
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

/**
 * 导入路径专用：把「某仓库 + 它的标签/备注」放进 24h 宽限期（4.17.0）。
 *
 * ## 为什么不复用 `markRepoUnstarred()`
 *
 * 那个函数的语义是「用户在本脚本里取消了 star」：它**删掉整表缓存条目**、**清空活区**，且
 * **无条件用活区覆盖备份**。导入没有这些前提（导入的仓库本就不在整表缓存里，活区里也不该有它的
 * 数据），复用会把别处的数据一起搅进来；更要紧的是「无条件覆盖」正是**风险 22 的缺陷形态**。
 *
 * ## 三条纪律
 *
 * 0. **不做归一化**：`tags` 由**调用方**先 `dedupe` + 剔空白项后再传进来（唯一调用方 `applyImportPackage` 已在
 *    分派前做一次）。本函数按传进来的数组原样落盘 —— 若直接调用并传 `['  ']`，会被 `length > 0` 判成「有标签」。
 * 1. **空不覆盖非空**：包内该仓库没有标签 / 备注（trim 后为空）⇒ 保留已有条目里的 `_tags`/`_note`。
 *    与活区那条同源（「文件里没给」不构成「清空」的指令）—— 见 `docs/adr/0001` 的覆盖规则。
 * 2. **非空覆盖 · 不续命**：目标已有条目 ⇒ 把非空的 `_tags` / `_note` / `name` **整体替换**进去
 *    （**不是并集** —— 与活区 D9 的规则**相同**：导入的内容更新，理应覆盖；用户 2026-10-05 裁定），
 *    并**保留原 `unstarredAt`** —— 否则一次导入就把一条即将到期的备份重新计时 24h。
 * 3. **名字同理**（4.17.0 随 `data.repoNames` 加入）：已有条目的 `name` 优先，包里的名字只用来**补空**
 *    —— 空名字不得抹掉已有名字（那是恢复入口唯一的地址来源）。
 *
 * **例外（重要）**：已有条目**已超期**时按「不存在」处理（新条目 + `unstarredAt = now`）。否则会
 * 造出一条「**出生即超期**」的条目：上层纪律 2 要求保留原 `unstarredAt`，而那个时刻已过 ⇒ 合并进去的
 * 导入数据既不会出现在恢复窗口（`listRestorable` 跳过超期条目），也不会出现在卡片上（`getPendingInGrace`
 * 渲染时现算）⇒ 等于把刚导入的标签/备注写进一个**谁也读不到**的地方。超期条目按 ADR 0003 本来就算已删除
 * （不留墓碑行），所以这里当它不存在、重新起 24h 计时。
 *
 * @returns 该仓库此刻是否处于宽限期；`false` = 无物可接管且此前没有条目（什么都没做）
 */
export function addPendingFromImport(repoId: string, tags: string[], note: string, name = ''): boolean {
  if (!repoId) return false;
  const pending = loadPendingDelete();
  const existing = pending[repoId];
  const now = Date.now();
  const live = existing && (existing.unstarredAt || 0) + GRACE_PERIOD > now ? existing : undefined;

  const hasTags = tags.length > 0;
  const hasNote = !!(note && note.trim());
  // 无物可接管时不该造一个空条目去走 24h 倒计时（也不该覆盖已有条目的元数据）
  if (!live && !hasTags && !hasNote) return false;

  const entry: PendingDeleteEntry = Object.assign({ name: '' }, live || {}, {
    // 名字来自 4.17.0 的 `data.repoNames`（最小仓库标识，只为让恢复能发出那个写请求）。
    // 若导出方本地也查不到名字 ⇒ 空串 ⇒ `RestorableEntry.name` 回退成数字 repoId，
    // 该条目在成功同步（`fullSync` 分支 B 的 `saveRepoData`）补齐名字前不可手动恢复。
    // **空不覆盖非空**（与标签/备注同一条纪律）：已有名字用它、没有才用包里的，绝不用空串抹掉。
    name: live?.name || name || '',
    unstarredAt: live ? live.unstarredAt ?? now : now,
    _tags: hasTags ? tags : live?._tags || [],
    _note: hasNote ? note : live?._note || '',
  });
  pending[repoId] = entry;
  savePendingDelete(pending);
  return true;
}

/** 清理超过宽限期（24h）仍未 re-star 的待删除条目 */
export function cleanupExpiredUnstarred(): void {
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
