// 导入导出（4.7.0）：**纯逻辑层**——只读写存储、构造/校验/合并数据，
// 不碰 DOM、不弹对话框、不触发同步。所有交互（confirm / alert / 文件选择 / 下载）
// 在 ui/exportImportMenu.ts，两边通过纯数据对象通信，便于单测与真机诊断。
//
// 导出内容 = **只有本地权威数据**（标签 / 备注）。
// 刻意不含：`github_pat`（敏感，跨设备搬运无必要）、同步元数据（ETag 基线与 token 身份 +
// 远端瞬时状态绑定，跨设备导入会让「全 304 = 无变化」误判为「缓存即现值」）、
// 宽限期备份（临时状态，搬过去已近乎过期）、以及**仓库元数据**（4.17.0 改）—— 元数据由同步
// 承载，不该由导出包背（详见 docs/adr/0001 的追加段）。**唯一例外是 `data.repoNames`（4.17.0）**：
// 每个仓库的 `owner/repo` 随包带走用于展示/缺 ID 的名称降级；数字 ID 可在恢复执行时解析。
// 它只是**已有信息**的搬运（名字本来就在整表缓存里），
// 不含语言 / star 数 / 描述，且导入侧**只写进宽限期条目、不写整表缓存**。
//
// **两段例外（4.23.0）**：`data.tombstones` 与 `data.grace` 各自携带「网格上已看不到的那些仓库」
// （墓碑：卡片还在但灰；宽限期：卡片已不在网格里，只剩 24h 恢复窗口）。它们在活区里没有入口，
// 不带就是永久丢失（墓碑还丢描述/语言/star 数，卡片复现不出来）；而它们本来也**不会**由同步重建
// （墓碑不会出现在远端星标列表里，宽限期仓库同理）。两段都只在非空时才写入包（旧包形状不变）。
// 1.x 的旧包仍可能带 `data.repoCache`：**校验它、但内容一律忽略**（不再写入缓存）。
import { EXPORT_KIND, EXPORT_SCHEMA_VERSION, GRACE_PERIOD } from '../constants';
import { loadAllNotes, saveNote } from './notes';
import { addPendingFromImport, loadPendingDelete, restorePendingFromExport } from './pendingDelete';
import { hasApiData, loadRepoCache, saveRepoCache } from './repoCache';
import { getStorageUserId, loadAllTags, saveTags } from './tags';
import type { RepoCache, RepoData, TagMap } from '../types';
import { repoFullName } from '../api/repoTarget';

/** 导出包顶层结构（`data` 之外的字段是协议元信息，不参与合并） */
export interface ExportPackage {
  kind: string;
  schemaVersion: number;
  /** ISO 8601 UTC：文件名给人看，这个字段给程序看 */
  exportedAt: string;
  user: { id: string };
  data: {
    tags: TagMap;
    notes: Record<string, string>;
    /** 可选的 `owner/repo` 展示/名称降级提示。数字 ID 可在恢复执行时独立解析。
     * **导入侧只把它写进宽限期条目，绝不写 `stars_repo_cache`** —— 写入缓存会把
     * 风险 22 的触发前提（缓存条目与宽限期条目并存）重新造出来。 */
    repoNames?: Record<string, string>;
    repoCache?: RepoCache;
    /** 墓碑条目（4.23.0）：元数据 + 墓碑判定，用于在另一台机器上复现灰卡。 */
    tombstones?: Record<string, ExportTombstone>;
    /** 宽限期条目（4.23.0）：标签/备注 + 原始 `unstarredAt`，剩余时间原样搬过去。 */
    grace?: Record<string, ExportGrace>;
  };
}

/** 导出包里的墓碑条目：足够复现卡片（名称/描述/语言/star/fork/时间/四标志）+ 墓碑判定本身 */
export interface ExportTombstone {
  name: string;
  desc?: string;
  lang?: string;
  stars?: number;
  forks?: number;
  updatedAt?: string;
  starredAt?: string;
  private?: boolean;
  fork?: boolean;
  isTemplate?: boolean;
  mirror?: boolean;
  /** 判定时刻（ms） */
  at: number;
  /** 探测到的 HTTP 状态 */
  status: number;
}

/** 导出包里的宽限期条目：标签/备注 + 原始 `unstarredAt`（导入侧据此判断是否已超时） */
export interface ExportGrace {
  name: string;
  tags: string[];
  note: string;
  unstarredAt: number;
}

/** 导入结果报告：供 UI 层拼提示文案 */
export interface ImportReport {
  /** 导入后本地标签关联的仓库数 */
  tagRepos: number;
  /** 本次**覆盖写入**了标签的仓库数（包内该仓库标签非空才写；与本地内容相同则不算） */
  tagsWritten: number;
  /** 其中被覆盖掉的**本地标签关联数**（破坏性部分，提示里单独说；与 `notesOverwritten` 对称） */
  tagsRemoved: number;
  /** 写入/覆盖的备注数（不含与本地相同的） */
  notesApplied: number;
  /** 其中覆盖了本地已有非空备注的数量（破坏性部分，提示里要单独说） */
  notesOverwritten: number;
  /** 因文件里是空备注而跳过、未删除本地备注的数量 */
  notesSkippedEmpty: number;
  /** 交由 24h 宽限期接管的仓库数（`stars_repo_cache` 里没有它的），含合并进已有条目的 */
  pendingAdded: number;
  /** 由包内 `data.tombstones` 重建的墓碑条目数（本地缓存已有该仓库 ⇒ 跳过，不覆盖） */
  tombstonesRestored: number;
  /** 由包内 `data.grace` 重建的宽限期条目数（保留原始剩余时间） */
  graceRestored: number;
  /** 包里已经超过 24h 的宽限期条目数 —— **直接消失**（不建条目、不写标签备注） */
  graceExpired: number;
  /** 包里在宽限期、但本地已是 star 状态的仓库数 —— 标签/备注直接写进活区 */
  graceAppliedActive: number;
  /** 本次导入时本地是否**有**整表缓存（`hasApiData()`）。**纯展示标志，不参与分派** —— 分派只看
   * 「该仓库在不在 `stars_repo_cache` 里」（两者可背离，见 D32 的「发布前独立审查」段）。
   * UI 据此把提示里的「本机尚未同步过」补上。 */
  cacheAvailable: boolean;
}

/** 校验失败原因（UI 直接展示；文案面向用户，不含内部术语） */
type ValidateResult = { ok: true; pkg: ExportPackage } | { ok: false; reason: string };

/** 判空统一判据：**trim 后为空**（导出清洗、导入合并、saveNote 三处一致） */
function isEmptyText(s: string): boolean {
  return !s.trim();
}

/** 去重但**保持原顺序**（导入写盘前用：包内重复项不制造重复的标签 pill；调用方同时用 `.filter(t=>t.trim())` 剔空白项） */
function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}

/** 两个标签数组是否逐字相同（顺序敏感 —— 相同就不写盘，导入因此天然幂等） */
function sameTags(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

/**
 * 构造导出包。`userId` 缺失（未登录 / 取不到 ID）时返回 null —— 不降级到无隔离的旧键，
 * 那会把数据写进「下次登录后读不到」的键，等于静默丢数据。
 */
export function buildExportPackage(): ExportPackage | null {
  const userId = getStorageUserId();
  if (!userId) return null;

  const tags = loadAllTags();
  const notes = loadAllNotes();

  // 备注清洗：trim 后为空的**不写入**导出包（避免把「空备注」当成「要删除对方备注」的指令）；
  // 其余文本原样保留、不 trim（用户在备注里有意写的前导空格不能被吃掉）。
  const keptNotes: Record<string, string> = {};
  for (const repoId of Object.keys(notes)) {
    if (!isEmptyText(notes[repoId])) keptNotes[repoId] = notes[repoId];
  }


  const data: ExportPackage['data'] = {
    tags,
    notes: keptNotes,
    repoNames: buildRepoNames([...Object.keys(tags), ...Object.keys(keptNotes)]),
  };
  // 两段都只在非空时才写入（旧包的形状不变，`data` 段仍是那三项）
  const tombstones = buildTombstones();
  if (Object.keys(tombstones).length > 0) data.tombstones = tombstones;
  const grace = buildGrace();
  if (Object.keys(grace).length > 0) data.grace = grace;

  return {
    kind: EXPORT_KIND,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    user: { id: userId },
    data,
  };
}

/**
 * 导出墓碑（4.23.0）：卡片在网格里但已灰，元数据只有本地整表缓存有 ——
 * 同步**不会**重建它（墓碑的定义就是「不在远端星标列表里」），不带就是永久丢描述/语言/star 数。
 * 标签与备注仍走 `data.tags` / `data.notes`（它们在**活区**），这里只带元数据与墓碑判定。
 */
function buildTombstones(): Record<string, ExportTombstone> {
  const cache = loadRepoCache();
  const out: Record<string, ExportTombstone> = {};
  for (const repoId of Object.keys(cache)) {
    const data = cache[repoId];
    const t = data.tombstone;
    if (!t) continue;
    const item: ExportTombstone = { name: data.name, at: t.at, status: t.status };
    // 逐个字段搬运（不用展开）：`RepoData` 里还有 `ts` / `unstarredAt` 这类与卡片无关的字段
    if (data.desc !== undefined) item.desc = data.desc;
    if (data.lang !== undefined) item.lang = data.lang;
    if (data.stars !== undefined) item.stars = data.stars;
    if (data.forks !== undefined) item.forks = data.forks;
    if (data.updatedAt !== undefined) item.updatedAt = data.updatedAt;
    if (data.starredAt !== undefined) item.starredAt = data.starredAt;
    if (data.private !== undefined) item.private = data.private;
    if (data.fork !== undefined) item.fork = data.fork;
    if (data.isTemplate !== undefined) item.isTemplate = data.isTemplate;
    if (data.mirror !== undefined) item.mirror = data.mirror;
    out[repoId] = item;
  }
  return out;
}

/**
 * 导出宽限期（4.23.0）：这些仓库的标签/备注已从**活区**搬进 `stars_pending_delete_*`，
 * 所以 `data.tags` / `data.notes` 里根本没有它们（见 `markRepoUnstarred()` 的清空动作）。
 * 带原始 `unstarredAt`：导入侧据此算出剩余时间，已超时的条目**直接消失**（不新建、不续命）。
 * 只导出仍在宽限期内的条目 —— 超期条目按 ADR 0003 本来就算已删除。
 */
function buildGrace(): Record<string, ExportGrace> {
  const pending = loadPendingDelete();
  const now = Date.now();
  const out: Record<string, ExportGrace> = {};
  for (const repoId of Object.keys(pending)) {
    const e = pending[repoId];
    const at = e.unstarredAt || 0;
    if (at + GRACE_PERIOD <= now) continue;
    out[repoId] = { name: e.name || '', tags: e._tags || [], note: e._note || '', unstarredAt: at };
  }
  return out;
}

/**
 * 包内每个仓库的 `owner/repo` —— 展示和名称降级提示。
 *
 * 手动恢复按数字 ID 解析当前名称后适配星标端点，缺少提示不会阻断恢复。
 * 名字本来就在本地整表缓存里（`RepoData.name` = GitHub 的 `full_name`），所以这不新增任何采集，
 * 只是把已有信息随包带走。**只写名字，不写其它元数据** —— 语言 / star 数 / 描述仍由同步承载
 * （4.17.0 移除 `repoCache` 的理由不变，见 `docs/adr/0001`）。
 *
 * 缓存里查不到就不写这个键（**不编造**）；数字 ID 仍可在恢复执行时独立解析。
 */
function buildRepoNames(repoIds: string[]): Record<string, string> {
  const cache = loadRepoCache();
  const names: Record<string, string> = {};
  for (const repoId of repoIds) {
    const name = cache[repoId]?.name;
    if (repoFullName(name)) names[repoId] = name;
  }
  return names;
}

/** 结构校验（严格）：任一项不符即整包拒绝 —— 不部分解析、不写任何键 */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 逐条校验标签表：值必须是字符串数组 */
function validateTagMap(v: unknown, path: string): string | null {
  if (!isPlainObject(v)) return `${path} 不是对象`;
  for (const k of Object.keys(v)) {
    const arr = v[k];
    if (!Array.isArray(arr) || arr.some((t) => typeof t !== 'string')) return `${path}.${k} 不是字符串数组`;
  }
  return null;
}

function validateNoteMap(v: unknown, path: string): string | null {
  if (!isPlainObject(v)) return `${path} 不是对象`;
  for (const k of Object.keys(v)) {
    if (typeof v[k] !== 'string') return `${path}.${k} 不是字符串`;
  }
  return null;
}

/** 逐条校验「repoId → owner/repo」表：值必须是字符串（**语义**上的不合格在导入侧按「没有名字」降级） */
function validateNameMap(v: unknown, path: string): string | null {
  if (!isPlainObject(v)) return `${path} 不是对象`;
  for (const k of Object.keys(v)) {
    if (typeof v[k] !== 'string') return `${path}.${k} 不是字符串`;
  }
  return null;
}

function validateRepoCache(v: unknown, path: string): string | null {
  if (!isPlainObject(v)) return `${path} 不是对象`;
  for (const k of Object.keys(v)) {
    const entry = v[k];
    if (!isPlainObject(entry)) return `${path}.${k} 不是对象`;
    if (typeof entry.name !== 'string') return `${path}.${k}.name 缺失或不是字符串`;
    // lang 必须是字符串或缺省（4.16.0 补）。**渲染路径会对它调 `.trim()`**
    // （`langColors.getLangColor`）⇒ 对象/数字/布尔会抛 TypeError，把整页转换打断，
    // 表现是「网格容器建好、原生条目已隐藏、0 张卡片」的空网格（不是少显示一块）。
    // 这是删除读期清洗后暴露的信任边界缺口：旧清洗曾**顺带**挡掉一部分非字符串
    // （对象的字符串化含 `[` 不合其字符类 ⇒ 被剔），但从未完整（数字/布尔会被放行）。
    // 其它字段（desc/stars/forks/updatedAt）各自都不抛：escapeHtml 走 textContent 强转、
    // Number(...) 与 Date.parse 都是宽容的 —— 只有 lang 是这一类。
    if (entry.lang !== undefined && typeof entry.lang !== 'string') {
      return `${path}.${k}.lang 不是字符串`;
    }
  }
  return null;
}

/** 逐条校验墓碑段（4.23.0）：`name` 与墓碑判定必须齐备，其余元数据可选但类型要对 */
function validateTombstones(v: unknown, path: string): string | null {
  if (!isPlainObject(v)) return `${path} 不是对象`;
  for (const k of Object.keys(v)) {
    const e = v[k];
    if (!isPlainObject(e)) return `${path}.${k} 不是对象`;
    if (typeof e.name !== 'string') return `${path}.${k}.name 缺失或不是字符串`;
    if (typeof e.at !== 'number' || !Number.isFinite(e.at)) return `${path}.${k}.at 不是数字`;
    if (typeof e.status !== 'number' || !Number.isFinite(e.status)) return `${path}.${k}.status 不是数字`;
    // 与 `validateRepoCache` 同一条理由：`lang` 是渲染路径唯一会对它调 `.trim()` 的字段
    if (e.lang !== undefined && typeof e.lang !== 'string') return `${path}.${k}.lang 不是字符串`;
    for (const f of ['desc', 'updatedAt', 'starredAt']) {
      if (e[f] !== undefined && typeof e[f] !== 'string') return `${path}.${k}.${f} 不是字符串`;
    }
    for (const f of ['stars', 'forks']) {
      if (e[f] !== undefined && (typeof e[f] !== 'number' || !Number.isFinite(e[f]))) {
        return `${path}.${k}.${f} 不是数字`;
      }
    }
    for (const f of ['private', 'fork', 'isTemplate', 'mirror']) {
      if (e[f] !== undefined && typeof e[f] !== 'boolean') return `${path}.${k}.${f} 不是布尔值`;
    }
  }
  return null;
}

/** 逐条校验宽限期段（4.23.0）：标签必须是字符串数组、`unstarredAt` 必须是数字（缺失就判不了超时） */
function validateGrace(v: unknown, path: string): string | null {
  if (!isPlainObject(v)) return `${path} 不是对象`;
  for (const k of Object.keys(v)) {
    const e = v[k];
    if (!isPlainObject(e)) return `${path}.${k} 不是对象`;
    if (typeof e.name !== 'string') return `${path}.${k}.name 缺失或不是字符串`;
    if (!Array.isArray(e.tags) || e.tags.some((t) => typeof t !== 'string')) return `${path}.${k}.tags 不是字符串数组`;
    if (typeof e.note !== 'string') return `${path}.${k}.note 不是字符串`;
    if (typeof e.unstarredAt !== 'number' || !Number.isFinite(e.unstarredAt)) {
      return `${path}.${k}.unstarredAt 不是数字`;
    }
  }
  return null;
}

/**
 * 校验导出包并检查归属：`kind` / `schemaVersion` / `user.id` 任一不符即拒绝。
 * 注意 repoId 键**不含用户命名空间**，所以 user.id 是包的自声明归属、不是隔离手段，
 * 身份校验必须在导入侧显式执行（ADR 0001）。
 */
export function validateExportPackage(raw: unknown): ValidateResult {
  if (!isPlainObject(raw)) return { ok: false, reason: '文件内容不是 JSON 对象' };
  if (raw.kind !== EXPORT_KIND) return { ok: false, reason: '不是本脚本导出的文件（kind 不匹配）' };
  if (raw.schemaVersion !== EXPORT_SCHEMA_VERSION) {
    return { ok: false, reason: `导出包版本不支持：文件为 ${String(raw.schemaVersion)}，本脚本支持 ${EXPORT_SCHEMA_VERSION}` };
  }
  if (typeof raw.exportedAt !== 'string') return { ok: false, reason: '缺少导出时间' };

  const user = raw.user;
  if (!isPlainObject(user) || typeof user.id !== 'string' || !user.id) {
    return { ok: false, reason: '导出包未标注所属用户' };
  }
  const currentId = getStorageUserId();
  if (!currentId) return { ok: false, reason: '当前页面取不到 GitHub 用户 ID（未登录？），无法确认归属，已拒绝导入' };
  if (user.id !== currentId) {
    return { ok: false, reason: `导出包属于用户 ${user.id}，当前登录用户为 ${currentId}，不允许跨账号导入` };
  }

  const data = raw.data;
  if (!isPlainObject(data)) return { ok: false, reason: '缺少 data 段' };
  let err = validateTagMap(data.tags, 'tags') ?? validateNoteMap(data.notes, 'notes');
  // repoNames：4.17.0 起的可选项（缺省 = 旧包／导出方也不知道名字）⇒ 只在存在时校验类型
  if (!err && data.repoNames !== undefined) err = validateNameMap(data.repoNames, 'repoNames');
  // repoCache 只在**存在**时校验（1.x 旧包可能带）—— 4.17.0 起新包不再写它，且内容一律忽略
  if (!err && data.repoCache !== undefined) err = validateRepoCache(data.repoCache, 'repoCache');
  if (!err && data.tombstones !== undefined) err = validateTombstones(data.tombstones, 'tombstones');
  if (!err && data.grace !== undefined) err = validateGrace(data.grace, 'grace');
  if (err) return { ok: false, reason: `数据格式不合法：${err}` };

  return { ok: true, pkg: raw as unknown as ExportPackage };
}

/**
 * 写活区（标签 + 备注）的**唯一实现**（4.23.0 抽出来）：普通分派与「宽限期条目但本地已 star」
 * 两处都走它，避免同一条胜负规则出现两份实现（曾因两份实现造出风险 23）。
 *
 * 规则（用户 2026-10-05 裁定）：**包内非空 ⇒ 覆盖本地；为空 / 缺省 ⇒ 保留本地**。
 * 「缺省」与「空」在这里必须分开：`undefined` = 这个仓库没出现在备注表里（不算「跳过空备注」）。
 */
function applyToActive(
  repoId: string,
  incomingTags: string[],
  incomingNote: string | undefined,
  ctx: { localTags: TagMap; localNotes: Record<string, string>; report: ImportReport }
): void {
  const { localTags, localNotes, report } = ctx;

  // 1. 标签：包内非空 ⇒ 覆盖。为空/缺省 ⇒ 保留本地 —— 一个仓库可能只出现在 `notes` 里
  //    （有备注没标签），把「空」当成「清空本地标签」就等于「导入一份没说它标签的文件，标签没了」。
  const local = localTags[repoId] || [];
  if (incomingTags.length > 0 && !sameTags(local, incomingTags)) {
    saveTags(repoId, incomingTags);
    localTags[repoId] = incomingTags;
    report.tagsWritten += 1;
    report.tagsRemoved += local.filter((t) => !incomingTags.includes(t)).length;
  }

  // 2. 备注：导入优先，空值跳过
  if (incomingNote === undefined) return;
  if (isEmptyText(incomingNote)) {
    report.notesSkippedEmpty += 1;
    return;
  }
  const localNote = localNotes[repoId] || '';
  if (incomingNote === localNote) return; // 无变化，不写盘也不计入
  if (localNote) report.notesOverwritten += 1; // 覆盖了本地非空备注：破坏性部分，提示里单独说明
  saveNote(repoId, incomingNote);
  localNotes[repoId] = incomingNote;
  report.notesApplied += 1;
}

/**
 * 应用导入包（**破坏性**：备注可能被覆盖，且不做自动备份）。
 *
 * ## 逐仓库分派（4.17.0）
 *
 * 每个仓库按「**本地是否确认已 star**」决定去向（用户 2026-10-05 裁定）：
 *
 * - **确认已 star**（该仓库在整表缓存 `stars_repo_cache` 里）⇒ 写**活区**。**两条路都是同一条规则**
 *   （CONTEXT.md「导入覆盖规则」）：**包内该字段非空 ⇒ 覆盖目标；为空 / 缺省 ⇒ 保留目标**
 *   （标签与备注一致；备注的空值判据是 trim 后为空）。
 * - **其余一律 ⇒ 24h 宽限期**（`stars_pending_delete_<归属id>`，带 `_tags` / `_note`）。「其余」= `stars_repo_cache`
 *   里没有它 —— 既可能是「确实未 star」，也可能是「从未同步过 / 缓存为空」。这两者不必也无法区分：
 *   网格只来自整表缓存，缓存里没有的仓库渲染不出卡片、也没有 UI 入口 ⇒ 写活区等于静默丢弃；
 *   进宽限期至少有 24h 窗口与恢复入口，且下一次成功同步发现「远端已 star」时由 `fullSync` 的
 *   分支 B 自动移出宽限期（`markRepoStarred()` + 远端元数据回填）。
 *
 * 判据是**成员关系、不是 `hasApiData()`** —— 那是渲染层的「有没有完整整表缓存」门，与「这个仓库在不在
 * 缓存里」是两个量，且可以背离（见下面「曾用过什么」）。
 *
 * **无缓存时的「先同步一次」由调用方（UI 层）编排** —— 本模块是纯逻辑层，按 D9 的分层铁律
 * **不触发同步**（见 `ui/exportImportMenu.ts`）。
 *
 * ## 与风险 22 的关系（4.17.0）
 *
 * 本函数**不再往 `stars_repo_cache` 写任何条目**，且分派**以缓存成员关系为唯一判据** ⇒「缓存条目与
 * 宽限期条目并存」不可能由导入产生 ⇒ `markRepoUnstarred()` 那条「用空活区覆盖非空备份」的分支
 * 不再可达（该函数 4.17.0 一行未动）。旧包里的 `data.repoCache` 仍然**校验**，但内容被忽略
 * （不再写入）—— 详见 docs/adr/0001 追加段。
 *
 * **曾用过什么（4.17.0 发布前独立审查抓到的反例，同日删）**：首版分派条件写成
 * `hasApiData() && cache[repoId]`，多出来的那半个 `hasApiData()` 是错的 —— 它读
 * `stars_full_sync_meta`，而 `markRepoStarred()`（恢复窗口与「他人页 re-star」的落点）**只写缓存、
 * 不写 meta** ⇒「缓存里已有该仓库、`hasApiData()` 仍为假」是可达状态，此时**已在缓存里的仓库会被判成
 * 「未确认」而进宽限期**，并存态与风险 22 一起复活。判据收敛到成员关系后，「不可能由导入产生」才成立。
 * 回归锁 = 夹具 `[12]`（`tests/exportImport/run.cjs`）。
 *
 * 写入按仓库逐个进行，只在有实际变化时落盘。
 */
export function applyImportPackage(pkg: ExportPackage): ImportReport {
  const localTags = loadAllTags();
  const localNotes = loadAllNotes();
  const localCache = loadRepoCache();
  const cacheAvailable = hasApiData();

  const report: ImportReport = {
    tagRepos: 0,
    tagsWritten: 0,
    tagsRemoved: 0,
    notesApplied: 0,
    notesOverwritten: 0,
    notesSkippedEmpty: 0,
    pendingAdded: 0,
    tombstonesRestored: 0,
    graceRestored: 0,
    graceExpired: 0,
    graceAppliedActive: 0,
    cacheAvailable,
  };

  // 0. 墓碑（4.23.0）：**先**重建元数据，后面的标签/备注循环才会认「该仓库在缓存里」而写活区
  //    （墓碑卡片的标签/备注仍在活区 ⇒ 它们本来就在 `data.tags` / `data.notes` 里）。
  //    本地已有该仓库 ⇒ 跳过：本地是权威（可能已 re-star / 已重新同步），不拿一份旧快照覆盖。
  const tombstones = pkg.data.tombstones || {};
  let cacheChanged = false;
  for (const repoId of Object.keys(tombstones)) {
    if (localCache[repoId]) continue;
    const t = tombstones[repoId];
    const entry: RepoData = { name: t.name, tombstone: { at: t.at, status: t.status } };
    if (t.desc !== undefined) entry.desc = t.desc;
    if (t.lang !== undefined) entry.lang = t.lang;
    if (t.stars !== undefined) entry.stars = t.stars;
    if (t.forks !== undefined) entry.forks = t.forks;
    if (t.updatedAt !== undefined) entry.updatedAt = t.updatedAt;
    if (t.starredAt !== undefined) entry.starredAt = t.starredAt;
    if (t.private !== undefined) entry.private = t.private;
    if (t.fork !== undefined) entry.fork = t.fork;
    if (t.isTemplate !== undefined) entry.isTemplate = t.isTemplate;
    if (t.mirror !== undefined) entry.mirror = t.mirror;
    localCache[repoId] = entry;
    report.tombstonesRestored += 1;
    cacheChanged = true;
  }
  if (cacheChanged) saveRepoCache(localCache);

  // 1. 宽限期（4.23.0）：包里带原始 `unstarredAt` ⇒ 已超时的条目**直接消失**（不建、不续命）。
  //    本地已是 star 状态（缓存在）⇒ 标签/备注直接写活区，与普通仓库同一条胜负规则。
  const grace = pkg.data.grace || {};
  const graceIds = new Set(Object.keys(grace));
  for (const repoId of graceIds) {
    const g = grace[repoId];
    const tags = dedupe(g.tags.filter((t) => t.trim()));
    if (localCache[repoId]) {
      applyToActive(repoId, tags, g.note, { localTags, localNotes, report });
      report.graceAppliedActive += 1;
      continue;
    }
    const r = restorePendingFromExport(repoId, { name: g.name, tags, note: g.note, unstarredAt: g.unstarredAt });
    if (r === 'restored') report.graceRestored += 1;
    else if (r === 'expired') report.graceExpired += 1;
  }

  // 两个表都可能只覆盖一部分仓库 ⇒ 先合并**仓库集合**，再逐仓库分派（不能分两趟各写一遍）
  // 宽限期段已按自己的规则处理过的仓库不再走这一趟（同一仓库两处数据时以宽限期段为准）。
  const repoIds = new Set(
    [...Object.keys(pkg.data.tags), ...Object.keys(pkg.data.notes)].filter((id) => !graceIds.has(id))
  );

  for (const repoId of repoIds) {
    // 归一化**只做一次、在分派之前** —— 两条去向必须拿到同一份标签（曾只有活区去重 ⇒ 宽限期能把
    // 重复项带进活区，卡片出现重复 pill）。同时剔掉空白项：`['']` 手改得出，若不剔会被判成「非空」而覆盖本地。
    const incomingTags = dedupe((pkg.data.tags[repoId] || []).filter((t) => t.trim()));
    // 「包内有没有这个键」与「值是空」是两件事：只有前者才计入 notesSkippedEmpty
    //（否则一个只带标签的仓库会被算成「跳过了一条空备注」）
    const incomingNote = pkg.data.notes[repoId];

    if (!localCache[repoId]) {
      // 未确认 ⇒ 宽限期（新建 / 合并进已有条目的判定都在 pendingDelete 里 —— 同一概念一处实现）
      // 名字只进宽限期条目（`name` 字段），**不写整表缓存** —— 见 ExportPackage.data.repoNames 的注释
      // 与 DOM/请求边界共用纯名称校验。不合格按没有名称处理，数字 ID 仍可恢复。
      const rawName = pkg.data.repoNames?.[repoId] ?? '';
      const name = repoFullName(rawName);
      if (addPendingFromImport(repoId, incomingTags, incomingNote || '', name)) report.pendingAdded += 1;
      continue;
    }

    applyToActive(repoId, incomingTags, incomingNote, { localTags, localNotes, report });
  }

  report.tagRepos = Object.keys(loadAllTags()).length;
  return report;
}
