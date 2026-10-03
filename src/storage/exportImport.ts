// 导入导出（4.7.0）：**纯逻辑层**——只读写存储、构造/校验/合并数据，
// 不碰 DOM、不弹对话框、不触发同步。所有交互（confirm / alert / 文件选择 / 下载）
// 在 ui/exportImportMenu.ts，两边通过纯数据对象通信，便于单测与真机诊断。
//
// 导出内容 = 本地权威数据（标签 / 备注）+ 与之相关的派生数据（有标签或有备注的仓库元数据）。
// 刻意不含：`github_pat`（敏感，跨设备搬运无必要）、同步元数据（ETag 基线与 token 身份 +
// 远端瞬时状态绑定，跨设备导入会让「全 304 = 无变化」误判为「缓存即现值」）、
// 宽限期备份（临时状态，搬过去已近乎过期）。详见 docs/adr/0001-export-import-format.md。
import { EXPORT_KIND, EXPORT_SCHEMA_VERSION } from '../constants';
import { loadAllNotes, saveNote } from './notes';
import { loadRepoCache, saveRepoCache } from './repoCache';
import { getStorageUserId, loadAllTags, saveTags } from './tags';
import type { RepoCache, RepoData, TagMap } from '../types';

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
    repoCache: RepoCache;
  };
}

/** 导入结果报告：供 UI 层拼提示文案 */
export interface ImportReport {
  /** 导入后本地标签关联的仓库数 */
  tagRepos: number;
  /** 本次新增的标签关联数（并集里本地没有的部分） */
  tagsAdded: number;
  /** 写入/覆盖的备注数（不含与本地相同的） */
  notesApplied: number;
  /** 其中覆盖了本地已有非空备注的数量（破坏性部分，提示里要单独说） */
  notesOverwritten: number;
  /** 因文件里是空备注而跳过、未删除本地备注的数量 */
  notesSkippedEmpty: number;
  /** 从包里补入的仓库元数据条数（本地已有条目不覆盖） */
  repoCacheAdded: number;
}

/** 校验失败原因（UI 直接展示；文案面向用户，不含内部术语） */
type ValidateResult = { ok: true; pkg: ExportPackage } | { ok: false; reason: string };

/** 判空统一判据：**trim 后为空**（导出清洗、导入合并、saveNote 三处一致） */
function isEmptyText(s: string): boolean {
  return !s.trim();
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
  const cache = loadRepoCache();

  // 备注清洗：trim 后为空的**不写入**导出包（避免把「空备注」当成「要删除对方备注」的指令）；
  // 其余文本原样保留、不 trim（用户在备注里有意写的前导空格不能被吃掉）。
  const keptNotes: Record<string, string> = {};
  for (const repoId of Object.keys(notes)) {
    if (!isEmptyText(notes[repoId])) keptNotes[repoId] = notes[repoId];
  }

  // repoCache 只带「有标签」或「有**非空**备注」的仓库（用清洗后的 keptNotes，避免
  // 一条只剩空白的备注把无关仓库元数据也拖进包）：元数据随时可由一次同步刷新，
  // 导出只需保证这些仓库导入后立刻有完整卡片（ADR 0001）。
  const keptCache: RepoCache = {};
  for (const repoId of Object.keys(tags)) {
    if (cache[repoId]) keptCache[repoId] = cache[repoId];
  }
  for (const repoId of Object.keys(keptNotes)) {
    if (cache[repoId] && !keptCache[repoId]) keptCache[repoId] = cache[repoId];
  }

  return {
    kind: EXPORT_KIND,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    user: { id: userId },
    data: { tags, notes: keptNotes, repoCache: keptCache },
  };
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

function validateRepoCache(v: unknown, path: string): string | null {
  if (!isPlainObject(v)) return `${path} 不是对象`;
  for (const k of Object.keys(v)) {
    const entry = v[k];
    if (!isPlainObject(entry)) return `${path}.${k} 不是对象`;
    if (typeof entry.name !== 'string') return `${path}.${k}.name 缺失或不是字符串`;
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
  const err =
    validateTagMap(data.tags, 'tags') ??
    validateNoteMap(data.notes, 'notes') ??
    validateRepoCache(data.repoCache, 'repoCache');
  if (err) return { ok: false, reason: `数据格式不合法：${err}` };

  return { ok: true, pkg: raw as unknown as ExportPackage };
}

/**
 * 应用导入包（**破坏性**：备注可能被覆盖，且不做自动备份）。
 * 合并语义（CONTEXT.md「合并优先级」）：
 * - 标签：并集，去重，**本地已有标签排在前面**（顺序稳定，避免无意义重排）；
 * - 备注：以导入文件为准，但「文件里是空备注」**不覆盖**本地非空备注；
 * - 仓库元数据：本地已有条目**不动**，只补空缺（元数据是派生数据，本地更新）。
 * 写入按仓库逐个进行，只在有实际变化时落盘。
 */
export function applyImportPackage(pkg: ExportPackage): ImportReport {
  const localTags = loadAllTags();
  const localNotes = loadAllNotes();
  const localCache = loadRepoCache();

  const report: ImportReport = {
    tagRepos: 0,
    tagsAdded: 0,
    notesApplied: 0,
    notesOverwritten: 0,
    notesSkippedEmpty: 0,
    repoCacheAdded: 0,
  };

  // 1. 标签：并集（本地在前）
  for (const repoId of Object.keys(pkg.data.tags)) {
    const incoming = pkg.data.tags[repoId];
    const local = localTags[repoId] || [];
    const merged = local.slice();
    for (const t of incoming) {
      if (!merged.includes(t)) {
        merged.push(t);
        report.tagsAdded += 1;
      }
    }
    // 本地与包内都为空数组时不写（避免制造空条目）
    if (merged.length > 0) saveTags(repoId, merged);
  }

  // 2. 备注：导入优先，空值跳过
  for (const repoId of Object.keys(pkg.data.notes)) {
    const incoming = pkg.data.notes[repoId];
    const local = localNotes[repoId] || '';
    if (isEmptyText(incoming)) {
      report.notesSkippedEmpty += 1;
      continue;
    }
    if (incoming === local) continue; // 无变化，不写盘也不计入
    if (local && local !== incoming) report.notesOverwritten += 1; // 覆盖了本地非空备注：破坏性部分，提示里单独说明
    saveNote(repoId, incoming);
    report.notesApplied += 1;
  }

  // 3. 仓库元数据：本地有就不动，只补空缺
  const patch: RepoCache = {};
  for (const repoId of Object.keys(pkg.data.repoCache)) {
    if (localCache[repoId]) continue;
    patch[repoId] = pkg.data.repoCache[repoId] as RepoData;
    report.repoCacheAdded += 1;
  }
  if (report.repoCacheAdded > 0) {
    saveRepoCache(Object.assign({}, localCache, patch));
  }

  report.tagRepos = Object.keys(loadAllTags()).length;
  return report;
}
