# 架构决策记录（ADR）

> 范围：已采纳的架构决策 —— 取舍、依据与后果。每条决策的文件名带四位编号，编号一经分配不再复用，新条目续编 `0014`。
> 决策的运行期口径以 `AGENTS.md` 的硬口径段为准；本文只登记决策自身的位置与主题。
> 本目录只收架构取舍。调研取证在 `docs/` 顶层（见 `docs/INDEX.md`），实施计划与验证记录在 `docs/plans/`。

| 编号 | 主题 |
|---|---|
| [`0001`](0001-export-import-format.md) | 导出包格式与导入合并语义 |
| [`0002`](0002-rename-and-storage-identity.md) | 改名与存储身份切换 |
| [`0003`](0003-sync-report-and-restore.md) | 变化简报与恢复 |
| [`0004`](0004-write-requires-classic-pat.md) | REST 写路径只支持 classic token |
| [`0005`](0005-no-auto-sync-after-import.md) | 导入后不自动同步 |
| [`0006`](0006-web-endpoint-write-fallback.md) | 网页端点写回落 |
| [`0007`](0007-token-account-match-check.md) | Token 归属校验：脚本 token 的账号与浏览器登录账号比对 |
| [`0008`](0008-readonly-on-other-users-stars-page.md) | 他人的 star 页只读模式 |
| [`0009`](0009-other-users-stars-page-readonly-grid.md) | 他人 star 页的零网络只读网格 |
| [`0010`](0010-ownership-account-is-token-account.md) | 归属账号 = token 账号（标签、备注、宽限期备份） |
| [`0011`](0011-id-first-api-targets.md) | 仓库请求目标以 ID 为主，名称作端点适配 |
| [`0012`](0012-inline-ui-theme-from-page.md) | 内联 UI 的配色只从页面现场解析 |
| [`0013`](0013-defer-rerender-while-editing.md) | 编辑会话期间挂起重绘（取代「同步后立即重渲染」与页码保持两条旧口径） |

## 状态

十三条均为现行决策，无整条废弃的条目。部分条目内含已被后续决策改写的条款，改写点在各文件正文内就地标注（`0001` 的合并语义与 `repoNames` 限制、`0005` 的导入后不自动同步、`0008` 的归属账号、`0009` 的导入分派判据）；被改写后的有效口径以 `AGENTS.md` 硬口径段与 `DEVELOPER.md` 为准。

`0012` 取代了此前散落在 `ui/restoreMenu.ts` / `ui/exportImportMenu.ts` / `ui/notifications.ts` 里的就地取色写法（`var(--color-*, <浅色兜底>)`），并把「兜底颜色是浅色硬编码」这条已知风险一并消除。

`0013` 取代了原 D12（同步后**立即**重渲染、不问是否刷新）与 D12 补（本地数据编辑保页码）两条旧口径 —— 那两条在 `AGENTS.md` 里是**整条删除**，不是改写：编辑会话存在时重绘让位，页码语义并入 `0013` 的第三条形状。原先「重绘期间网格不得出现空态」的约束保留在 `0013` 里，因为原子 `replaceChildren` 是挂起兑现后仍然必须成立的前提。

## 开放问题

已核对：当前不存在待定的 ADR 条目；`docs/research-index.md` 中「仍生效」的调研结论均已落到上表某一条或 `AGENTS.md` 的硬口径段。
