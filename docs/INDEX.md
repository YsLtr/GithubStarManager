# 开发文档索引

> 全局索引。每行一个部分，指向该部分的 `README.md`（范围说明与下辖文件索引）。
> 主题正文的权威在各文件自身；本文只登记位置与主题概要，不复制结论。

## 1. 部分

| 部分 | 范围 | 索引 |
|---|---|---|
| `adr/` | 已采纳的架构决策：取舍、依据、后果 | [`adr/README.md`](adr/README.md) |
| `plans/` | 实施计划与逐条验证记录；历史在 `archive/` | [`plans/README.md`](plans/README.md) |
| 顶层 | 调研报告、设计文档、架构评审 | 本文 §2 |

## 2. 顶层主题文件

| 文件 | 主题 |
|---|---|
| `filters-sort-design-2026-09-23.md` | 筛选与排序全本地化：统一查询管线、排序键与方向、facet 动态收窄；页码口径的规范处 |
| `github-api-research-2026-09-22T22-12-37.md` | 以「本人 star 列表」为主的数据获取方案调研 |
| `research-index.md` | 调研类文档的状态与去向索引（结论落到代码与 ADR 的对应关系） |
| `research-api-targets.md` | 目标寻址以数字 ID 为主：认证与读写实测 |
| `research-finegrained-getuser.md` | 零权限 fine-grained PAT 调 `GET /user` 取账号 id 的取证 |
| `research-ratelimit-measurement.md` | REST 变异请求限流实测（星标端点） |
| `research-ratelimit-protocol.md` | 上者的实测协议：硬约束、判定矩阵、规模取舍 |
| `research-updated-vs-pushed-at.md` | `updated_at` 与 `pushed_at` 的权威语义考证 |
| `research-web-star-endpoints.md` | 复用网页 star/unstar 端点的可行性与三组对照实测 |
| `research-web-endpoint-integration.md` | 网页端点通道的工程落地方案 |
| `research-pager-jump-a11y-spinner.md` | 分页跳页输入控件与「只转图标」加载态调研 |
| `research-gh-gui-clients.md` | 第三方 `gh` GUI 客户端调研（背景资料） |
| `research-github-gui-coverage.md` | GUI 客户端功能覆盖矩阵（背景资料） |
| `starmgr-arch-review-report.md` | 数据获取架构评审与改造建议 |

## 3. 登记在案的布局偏差

布局规定顶层与部分的主题文件达到 9 份即拆到下一层，路径不带日期。当前偏差与解除条件如下。

- **拆分未执行**：顶层 14 份、`adr/` 11 份、`plans/archive/2026/` 12 份均超过 9 份阈值，超 400 行的文件为 `research-ratelimit-protocol.md`（609 行）、`research-web-star-endpoints.md`（447 行）、`research-web-endpoint-integration.md`（425 行）、`research-pager-jump-a11y-spinner.md`（425 行）。
  **解除条件**：拆分须同时改名，而文件名引用分布在 `DEVELOPER.md`、`AGENTS.md`、`docs/` 其余文件与 `src/` 注释中；`DEVELOPER.md` 与 `src/` 不在文档写入范围内，单方面改名将留下失效引用。拆分与改名在同一批改动中执行。
- **两份文件保留日期后缀**：`filters-sort-design-2026-09-23.md` 与 `github-api-research-2026-09-22T22-12-37.md`。
  **解除条件**：与上一条同批处理，避免同一目录内并存两套命名。

## 4. 开放问题

已核对：当前不存在影响上述登记的未知事项。ADR 编号 0001–0011 与 D1–D34 的对应关系由 `AGENTS.md` 的硬口径段维护，本文不复述。
