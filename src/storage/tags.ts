import { gmGet, gmSet } from '../gm';
import { STORAGE_KEYS } from '../constants';
import { getViewerId } from '../pageScope';
import { fingerprint, getTokenIdentitySync } from './accountIdentity';
import { getToken } from '../tokenConfig';
import type { TagMap } from '../types';

/**
 * 标签 / 备注 / 宽限期备份的**归属账号** id（4.18.0 起口径变更，见 docs/adr/0010）。
 *
 * ## 取值顺序
 *
 * 1. **token 账号**：`getTokenIdentitySync(tok)?.id` —— 按凭证指纹查 `stars_account_identity`。
 *    这份身份是在**保存 token 时**由 `setTokenVerified()` 确认并落库的（先写身份、再写 token），
 *    所以查得到 token 时通常也查得到身份（唯一例外是 `setTokenVerified` 的 `saved-unverified`：
 *    保存时身份确认失败，见那里与 ADR 0010「已接受」第 3 条），本函数只需**同步查表**（零网络、零写入）。
 * 2. **回退登录者**（`octolytics-actor-id`）：没有 token，或身份查询失败（临时故障 / 身份缓存被清）。
 * 3. 两者皆取不到（登出 / GHES / meta 变更）⇒ 返回 ''，调用方**必须**拒绝读写（见各函数护栏），
 *    **不得**回落 `stars_tags` / `stars_notes` 这类无隔离的旧键。
 *
 * ## 为什么归属是 token 账号而不是登录者
 *
 * 屏幕上的 stars 列表来自 `GET /user/starred`（带 token）⇒ **列表属于 token 账号**。若标签按登录者
 * 隔离，配错 token 时就会出现「屏幕上是 A 的列表、标签却记在 B 名下」（风险 21）。官方明文
 * 「Personal access tokens act as your identity … when you make requests to the REST API」。
 *
 * 旧版（4.12.0–4.17.x）取的是登录者；本人页上两侧 id 相等 ⇒ **正常配置下键不变、无需迁移**。
 * 错号期间写在旧键里的数据不迁移也不删除（D30：不再写一次性迁移代码），换回匹配账号即可再见。
 *
 * ## 为什么有一个页面会话级的快照
 *
 * `memo` **不是**「把 id 记住」也不是第二份绑定（绑定在保存时完成），它只兜住一种情况：
 * 保存 token 时身份确认失败（网络抖动，见 `setTokenVerified` 的 `saved-unverified`）⇒ 当下按登录者
 * 分区；若之后网络恢复、身份缓存被填充，同一个会话里键名会从登录者**翻转**到 token 账号，
 * 于是「刚写进去的标签读不到」。快照按**（凭证指纹, 登录者）**自失效：任一侧一变即重算，
 * 不需要在任何写入点挂钩子（token 的写入点已收敛到 `setTokenVerified` 一处，4.18.0）。
 */
let memoFp = '';
let memoViewer = '';
let memoId = '';
let memoValid = false;

export function getStorageUserId(): string {
  const tok = getToken();
  const fp = tok ? fingerprint(tok) : '';
  const viewer = getViewerId();
  // 快照键 = (凭证指纹, 登录者)。带上登录者这一维是必须的：**同一标签页内换登录账号**（token 不变）
  // 时若只记指纹，无 token 的路径会把归属冻在上一个账号上（单测 [6] 的「切到另一用户」就是这样抓出来的）。
  // 于是快照的语义收窄为「同一份凭证 + 同一个登录者」下不翻转，正是 §「为什么有快照」要兜的那一种情况。
  if (memoValid && memoFp === fp && memoViewer === viewer) return memoId;

  const id = (tok ? getTokenIdentitySync(tok)?.id : '') || viewer;
  memoFp = fp;
  memoViewer = viewer;
  memoId = id;
  memoValid = true;
  return id;
}

/** 标签存储键。必须已有隔离 id（调用方先过护栏）——无 id 时的旧键回落已在 4.12.0 删除，
 *  因为它会让「登出 / 取不到身份」读到无隔离的存量数据（见 getStorageUserId 的注释）。 */
function tagsKey(userId: string): string {
  return STORAGE_KEYS.tagsPrefix + userId;
}

/** 读取当前账号的全部标签。取不到隔离 id（登出 / meta 变更）⇒ 返回空表，**不**回落旧键 */
export function loadAllTags(): TagMap {
  const userId = getStorageUserId();
  if (!userId) return {};
  return gmGet<TagMap>(tagsKey(userId), {});
}

/** 覆盖写入单个仓库的标签；空数组等价于删除。取不到隔离 id ⇒ no-op（不写旧键） */
export function saveTags(repoId: string, tagsArray: string[]): void {
  const userId = getStorageUserId();
  if (!userId) {
    console.warn('[github-star-manager] 取不到归属账号（无 token 身份且取不到登录者），已跳过标签写入（避免写进无隔离的旧键）');
    return;
  }
  const key = tagsKey(userId);
  const all = gmGet<TagMap>(key, {});
  if (tagsArray.length === 0) {
    delete all[repoId];
  } else {
    all[repoId] = tagsArray;
  }
  gmSet(key, all);
}

/** 读取单个仓库的标签 */
export function getTags(repoId: string): string[] {
  return loadAllTags()[repoId] || [];
}


/* 曾用过什么（D30 / 4.16.0 删除）：此处原有 `migrateTagsIfNeeded()`，把 4.12.0 之前写在无隔离键
 * `stars_tags` 里的标签搬到 `stars_tags_<登录者id>`（仅当新键不存在时）。
 * 删除理由：自 4.13.0（a56f87f 删掉旧键回落分支）起**再无写入者**写裸键，迁移是一次性动作，
 * 且删除后残留的 `stars_tags` 无任何读者（见 AGENTS.md D30 的删除判据）。 */
