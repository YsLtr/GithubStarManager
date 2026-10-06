# API 目标 ID 优先：认证与读写实测

日期：2026-10-06，13:14–13:16 +0800。结论去向：[修改计划](plans/2026-10-06-id-first-api-targets.md)。

后续：4.19.0 已实施（[ADR 0011](adr/0011-id-first-api-targets.md)），实现层验证见文末；前面的记录是实施前端点调查，不与新实现测试混计。

## 结论

推荐保留“数字 ID 定位仓库 → 当前名称适配星标端点”的设计。GET `/repositories/{id}` 在本次 classic PAT 的公共、私有仓库样本上均成功；直接数字星标路径 `/user/starred/{id}` 的 GET、PUT、DELETE 均为 404，而同仓库的官方名称路径有正确的 204/404 状态变化。

这验证了本次具体候选路由，**不证明不存在任何其他未文档化的 ID 写路由**。

## 实验方法与证据

用户提供临时 classic PAT 并授权测试。响应 `x-oauth-scopes: repo`。凭证只用于发给 api.github.com 的 Authorization 头，通过进程环境传入、运行结束移除；未写入项目文件或浏览器。

- [只读记录](research-api-target-measurement.json)：20 次 GET，包含 301 的第二跳。记录状态、请求 ID、额度和少量布尔校验，不保存响应正文或私有仓库名字/ID。
- [写对照记录](research-api-target-write-measurement.json)：16 次请求，其中 4 次变异（两个数字候选请求均 404，两个官方名称请求均 204）。
- `scripts/api-target-probe.cjs`：只读探针，默认 dry-run，最多 40 次请求，重定向逐跳限制到 api.github.com；401/403/429 或低额度停止。
- `scripts/api-target-write-probe.cjs`：默认 dry-run，选择 token 自有公共仓库，按 owner.id 校验，数字路由与名称路由串行对照，最后 GET 校验基线。最多 6 次变异，相邻变异开始至少间隔 1000ms。限流/凭证失败停止，不继续强行恢复，并将恢复状态记为 unknown。

两份记录合计 **36 次请求、4 次变异**。额度响应来自不同节点，remaining 有回升；不能据此按相邻差值计费。本次没有 401/403/429。

## 只读矩阵

| 验证 | 结果 | 含义 |
|---|---|---|
| GET /user、GET /user/{account_id} | 都 200，id 相同 | 用户 ID 路由可用；凭证身份仍应由 /user 确认 |
| 自有公共仓库：ID vs 名称查询 | 都 200，id、当前名称、owner.id 一致 | classic 公共目标可按 ID 解析 |
| 自有私有仓库：ID vs 名称查询 | 都 200，id、当前名称、owner.id 一致 | classic + repo scope 的私有目标可按 ID 解析 |
| 同一个私有仓库匿名 ID/名称查询 | 都 404 | 真实存在但不可见也会 404；不是“ID 路由坏了”或“仓库删除了”的证明 |
| 已加星样本：ID/名称元数据 | 都 200，同一 ID | 排除错误仓库造成的假阴性 |
| 已加星样本：GET /user/starred/{owner}/{repo} | 204 | 星标查询的正对照 |
| 同一样本：GET /user/starred/{id} | 404 | 直接数字候选未获得状态能力 |
| 同一样本：GET /user/starred/repositories/{id} | 404 | 另一候选未获得状态能力；未对它执行写请求 |
| GET /repositories/0 | 404 | 非法目标负对照 |

自有仓库只取第一页（本次 37 个公共、6 个私有），分别选一个样本；这不是穷举所有仓库或凭证类型。

## 历史转移与重定向

匿名 GET `/repos/github/linguist` 返回 **301**，Location 指向 `/repositories/1725199`，第二跳 **200**，响应 full_name 为 `github-linguist/linguist`。

直接 GET `/repositories/1725199` 与 GET `/repos/github-linguist/linguist` 都返回同一 ID。

这比“手工访问未文档化路由成功”多一层证据：GitHub 自己也把名称路由重定向到 ID 路由。但当前核对的 OpenAPI 没有收录 `/repositories/…`，不把运行实证说成公开稳定契约。

计划因此补充：名称降级要处理重定向并读取最终响应的 full_name；已知 ID 时必须校验最终 id，不能信旧名字或 Location 文本。原名称被新仓库复用时可能不再重定向，该场景本轮未实际构造。

## 写对照与基线复原

公共自有目标：`YsLtr/pi-subagents`，repoId=`1374101984`。测试前通过 /user 与 ID 元数据的 owner.id 确认所有权。未修改仓库内容、名称或设置。

| 步骤 | HTTP | 官方名称 GET 回读 |
|---|---|---|
| 初始基线 | GET 404 | 未加星 |
| PUT /user/starred/1374101984 | 404 | 仍 404，状态未变 |
| PUT /user/starred/YsLtr/pi-subagents | 204 | 204，已加星 |
| DELETE /user/starred/1374101984 | 404 | 仍 204，状态未变 |
| DELETE /user/starred/YsLtr/pi-subagents | 204 | 404，已取关 |
| 收尾与最终基线检查 | 两次 GET 均 404 | **已恢复原始未加星状态** |

本次原始写记录的 `at` 是响应时刻；间隔由探针代码在每次实际 fetch 前控制，不用响应时间差充当请求开始间隔。探针后续已补 `startedAt` 字段供复跑审计，未为补时间字段重复真实写操作。

## 浏览器尝试与剩余边界

使用 agent-browser-cli 新开公共仓库页，再按项目规定调用 Page.bringToFront（allowFocus=true）。两次回读 visibilityState 都不是 visible，因此探针在 fetch 前退出，没有产生浏览器 API 验证结果；随后关闭该测试页。**不能把命令行的 CORS `*` 当作 CSP、TM 沙箱或 Cookie 私有仓库可达性的验证。**

仍未实测：

- fine-grained PAT；当前提供的是 classic，不能用 classic 成功外推。
- 无 API 凭证但 Cookie 可见的私有仓库，以及离页无对应 DOM 表单的恢复。
- 人为改名/转移、原名称被另一个仓库复用；本次只有已存在的历史转移样本。
- API 名称解析到写入之间恰好发生改名的竞态；名称端点适配不能给出原子 ID 写入保证。
- 本阶段尚未实现 resolver、队列和同步改造；后续已完成，验证见文末。

## 复跑

```powershell
node scripts/api-target-probe.cjs
node scripts/api-target-write-probe.cjs
# 上面默认均零网络。实跑前通过进程环境安全设置 GITHUB_TARGET_PROBE_TOKEN：
node scripts/api-target-probe.cjs --run --out <新的只读记录路径>
node scripts/api-target-write-probe.cjs --run --out <新的写记录路径>
```

不要覆盖本次原始记录；写探针会在自有公共仓库临时翻转星标并复原，不能当成只读探针运行。若探针中断或报告 baselineRestored 不是 true，应先核查记录中的目标和原始基线。

## 本地验证

两份探针通过 Node 语法检查和默认 dry-run；stdin 为空的认证读取会在联网前以失败退出。记录完整性校验通过（20 + 16 条、无 failed、baselineRestored=true），新增/修改交付文件未检出 PAT 格式凭证。

`pnpm check` 通过；`pnpm test:exportimport` 为 153 通过 / 0 失败。后者准备阶段仍输出既有 CommonJS 临时编译诊断并继续产出 JS，正式类型检查由前者通过；这些单测不是新探针的网络契约验证。

## 4.19.0 实现层验证

使用用户随后提供的新临时 classic token，直接运行 `tests/api/prepare.mjs` 打包的实际 `api/repositories`、`mutationQueue` 与 `starWrites`，没有在浏览器持久化凭证。

[原始记录](research-api-target-implementation.json)：14 次请求、2 次变异，目标仍为自有公共仓库 `YsLtr/pi-subagents`。
给调用方正确 repoId 和刻意错误的名称 `deliberately/stale`，新实现按 ID 得到当前名称，PUT 204 后读取为已加星；DELETE 204 后读取为未加星。最终 baselineRestored=true。

本地新增 24 组 API/队列/恢复/同步回归全部通过。做过 A/B 反证：临时移除“返回 ID 必须匹配”守卫，回归以 target-mismatch 断言失败退出；源文件逐字节还原后重新构建、回归通过。

7 组真实前台夹具通过（stub 网络）：other-profile、other-editstate、own-unstar、other-logout-pending、other-starstate、roundtrip、other-profile#narrow。场景身份/visibility 与分区种子守卫通过；窄视口脚本节点、标记、请求、写入均零。原生 Cookie 路径的交互验证来自夹具，不等同于真实 Cookie 私有仓库写入。真实 GitHub 页面再次因 visibility 门退出，CSP/TM 真机端到端仍未取得有效结果。
