# 4.23.0 · 墓碑与宽限期随导出包走

- 决策：`docs/adr/0016-export-tombstones-and-grace.md`（D39）
- 前置：4.22.0 的墓碑（`docs/adr/0015`）

## 纳入项

1. 导出：`data.tombstones`（元数据 + `at`/`status`）与 `data.grace`（`tags`/`note` + 原始 `unstarredAt`），
   两段都**只在非空时写入**；已超期的宽限期条目不进包。
2. 导入（顺序固定）：墓碑 → 宽限期 → `tags`/`notes` 主循环。
   - 墓碑：本地缓存已有 ⇒ 跳过；没有 ⇒ 建条目 + `tombstone`，标签备注随后进活区。
   - 宽限期：本地已 star ⇒ 标签/备注直接写活区；否则 `restorePendingFromExport()` 按原 `unstarredAt` 重建，
     已超时丢弃。同一 `repoId` 两段都有 ⇒ 以宽限期段为准。
3. `applyToActive()`：写活区的唯一实现（普通分派与「宽限期但已 star」共用）。
4. 校验 `validateTombstones()` / `validateGrace()`：类型错整包拒绝。
5. UI：导入 confirm 增加两段的说明；完成提示补上 `tombstonesRestored` / `graceRestored` / `graceExpired` /
   `graceAppliedActive`；导出控制台补上两段条数。

## 排除项

- 不升 `schemaVersion`：新增字段全部可选，旧包/旧解析器不受影响。
- 不把 `stars_pending_delete_*` 整个键搬过去（仍是一次性搬运，不在目标机保留同名键）。
- 不做「导入已 star 的宽限期仓库时探测远端可达性」：判据仍是「本地整表缓存里有没有它」（同 `0001`）。
- 不加导出前的「有 N 个墓碑/宽限期条目」确认框（TM 导出本来就是一步到位的下载）。

## 验证

- `pnpm test:exportimport` **183 通过**（组 `[17]` 新增 30 条）；
- `pnpm test:api` **37 通过**（墓碑链路未改动）；
- `pnpm check` 绿：dist **236.79 kB**、`@version 4.23.0`、`@grant` 恰 5 项。

## 边界

- 剩余时间依赖两端系统时钟同源：时钟差异大时宽限期实际剩余会偏。
- 未做真机端到端（构造墓碑 + 取消 star 再导出/导入需要真实账号与已删除仓库）。
