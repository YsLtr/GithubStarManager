# 改名与存储身份切换

脚本由 `GitHub Stars Grid View` 改名为 `GithubStarManager`。Tampermonkey 以 `@name` + `@namespace` 判定脚本身份，改 `@name` 即等于**在 TM 里换了一个脚本**，其 GM 存储随之归零。本项目额外把 localStorage 镜像前缀一并从 `github-stars-grid::` 换成 `github-star-manager::`，因此旧数据既不会经 GM 回流，也不会经镜像回流——按用户决定**主动放弃旧数据**（旧脚本仍留在 TM 里，装回即可读旧 GM 存储，这是唯一的找回路径）。

只在改名的 4 处生效：`userscript.name`、`build.fileName`、`package.json.name`、镜像前缀。`@namespace` 保持 `https://github.com/YsLtr`（它标识作者，不随项目改名），CSS 类名前缀 `gsm-` 保持不动（它本就是 GitHub Star Manager 的缩写，且已被 `.diag/` 下的诊断脚本大量引用）。

## Consequences

「脚本叫什么」与「数据存在哪里」在此之后保持一致；代价是这次改名无法平滑迁移既有数据，导入导出功能（4.7.0）正是为此后同类变更准备的通道，而不是为它补票。TM 中会短暂出现新旧两条脚本并存，必须手动禁用/删除旧的，否则两者会同时向同一页面注入。
