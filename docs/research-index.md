# 调研文档索引（状态与去向）

> 建立于 **4.15.0**（2026-10-04）。这些文档承载的是**不可快速重建的实测数据与原文核对**，
> 因此一律**保留**，只在这里登记「结论去哪了 / 还被谁引用」。
>
> **引用数** = 除本文档外，`src/`、`docs/`、`AGENTS.md`、`DEVELOPER.md` 中提到该文件名的文件数
> （复制即失效，仅作相对热度参考）。列「仍被引用」是为了判断**改动前要不要重读它**。

| 文档 | 主题 | 结论去向 | 仍被引用 | 状态 |
|---|---|---:|---|---|
| `research-web-star-endpoints.md` | 复用网页 star/unstar 端点绕开 fine-grained 写缺口（可行性 + 三组对照实测） | `docs/adr/0006`（定案）、`src/starWrites.ts`、D3 | 8 | **仍生效**（附录 A 的「422 回退前提被推翻」是删代码的依据） |
| `research-ratelimit-measurement.md` | REST 变异请求限流实测（判定 D1：1 点/请求、5 点表不作用于 primary） | `DEVELOPER.md` §6、`src/mutationQueue.ts` 的 1000ms 依据说明 | 4 | **仍生效**（原始记录见同目录 `.jsonl`） |
| `research-ratelimit-protocol.md` | 上者的**实测协议**（硬约束、判定矩阵、为何 L2 不跑） | 同上 §5 | 3 | **仍生效**（复跑探针前先读 §4.7） |
| `research-pager-jump-a11y-spinner.md` | 分页跳页控件与「只转图标」加载态（GitHub 自身无跳页输入、Primer loading 范式、SMIL 冻结 bug） | `docs/adr` 无独立条目；口径写进 AGENTS.md **D22/D23** | 2 | **已消化**（不改这些交互就不必重读） |
| `research-updated-vs-pushed-at.md` | 仓库时间字段语义考证（`updated_at` vs `pushed_at`） | AGENTS.md 决策 **D** 段与 `src/fullSync.ts` 的 `parseItem`；4.8.0 定 `updatedAt = pushed_at` | 2 | **已消化** |
| `research-web-endpoint-integration.md` | 网页端点通道的**工程落地**方案调研 | `docs/adr/0006` | 2 | **已消化**（被 `research-web-star-endpoints.md` 的实测覆盖） |
| `research-gh-gui-clients.md` | 第三方 `gh` GUI 客户端调研（竞品/生态考察） | 未进入任何决策或代码 | **0** | **与代码无关**（背景资料） |
| `research-github-gui-coverage.md` | GUI 客户端功能覆盖矩阵（以 `gh` CLI 为标尺） | 未进入任何决策或代码 | **0** | **与代码无关**（背景资料） |

## 判读提示

- **零引用的两份**（`gh-gui-clients` / `github-gui-coverage`）是**竞品与生态考察**，主题是「别的 GitHub GUI 能做什么」，
  与本脚本的功能决策没有传导关系；留着是作为选型背景，删掉也不影响任何代码路径。
  全部调研结论的**正文权威**在各自文档；本表只是索引，不复制它们的结论。
- 「已消化」不等于「可删」：例如 `research-pager-jump-a11y-spinner` 里的两条事实
  （GitHub 侧无跳页输入、Primer loading 的 DOM 不同形会丢焦点）是**改这些交互时的第一手依据**。
- `docs/filters-sort-design-2026-09-23.md`、`docs/github-api-research-2026-09-22T22-12-37.md`、
  `docs/starmgr-arch-review-report.md` 与本表同类，但因文件名不以 `research-` 开头而未列入；
  前两份已随 4.4.0 落地，后者是架构评审（未消化的建议见 AGENTS.md 下一步第 6 条）。
