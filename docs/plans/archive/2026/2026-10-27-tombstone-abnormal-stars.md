# 4.22.0 · 墓碑：仓库消失与手动取消 star 分开

- 触发：<https://github.com/YsLtr/GithubStarManager/issues/5>「再检测仓库状态判断 unstar 原因」
- 决策：`docs/adr/0015-tombstone-abnormal-stars.md`（D38）

## 纳入项

1. 同步 A 段：对「本地缓存有、远端星标列表无」的条目先探测仓库本身。
   - 200 ⇒ 手动取消 star，沿用 `applyExternalUnstar`（24h 宽限期）。
   - 404 / 410 / 451 ⇒ 墓碑：`RepoData.tombstone = { at, status }`，条目留在 `stars_repo_cache`。
   - 其他状态 ⇒ 本轮不动。
   - 全正文模式只查存在性（`collectStarredChecks(..., { existenceOnly: true })`）。
   - 已墓碑条目不重复探测；交集分支清墓碑。
2. 墓碑卡片：`.stars-grid-card-tombstone`，灰底 + 名称/描述/标签/语言点/星标/输入框边框/hover 全灰；
   标签与备注仍在活区（筛选、编辑、导出照旧）。
3. 墓碑卡再次 unstar：不发写请求，直接 `markRepoUnstarred` 进 24h 宽限期；搬备份时剔除 `tombstone`。
4. 恢复窗口：TM 菜单「♻️ 取消/异常的 Star 仓库」，两个分区。异常区可单条/全部删除（连带标签与备注）。

## 排除项（本轮不做）

- 不改导出包 schema：墓碑条目仍在 `stars_repo_cache`，`data.repoNames` 与标签/备注照常随包；
  「描述性元数据跨设备搬运」仍按 ADR 0001 由同步承载。
- 不把墓碑写进 `stars_pending_delete_*`：那会让 24h 后自动消失，与「保留元数据」冲突。
- 不做「重新检测 / 手动标回正常」按钮：仓库重新出现在星标列表时同步会自动清墓碑。
- 不把 403 当墓碑（无法与权限/限流区分）。

## 验证

- `pnpm check` 绿（theme guard + build）。
- `pnpm test:api` **37 通过**，新增：
  - 切片模式：元数据 404 → 墓碑，缓存/标签保留，不进宽限期；
  - 全正文模式：仓库消失 → 墓碑；仓库可达 → 普通 unstar（进宽限期）；
  - 已墓碑不重复探测（只发列表请求）；仓库回归 → 清墓碑；
  - `tombstone.ts` 的 list / remove（删除连带标签与备注）。
- `pnpm test:exportimport` **153 通过**（语义未改动，回归确认）。
- 产物：`@version 4.22.0`、dist **229.59 kB**、`@grant` 恰 5 项、`verify-css` EXIT 0。

## 边界 / 未做真机

- 只在 mock 网络层与纯逻辑验证，未在真实 GitHub 上构造「已删除仓库」做端到端；
  真机验证需一次完整同步 + 一个被删除/下线的 star。
- classic token 无 `repo` scope 时私有仓库 404 会落成墓碑（有意，见 ADR 0015）。
- 全正文模式每个嫌疑条目新增 1–2 次请求；额度不足按既有红线整轮放弃。
