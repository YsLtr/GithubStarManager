# StarManager 数据获取架构调研报告（供 GithubStarManager 改造参考）

- 调研对象：`C:\Users\28676\Documents\Program\StarManager`（Tauri 2 桌面应用，Rust 后端 + SvelteKit SPA）
- 调研方式：**本地源码精读**（只读不改），未联网——所有结论均来自代码本身，引用为 `文件:行`
- 参考项目架构权威文档：`StarManager/CLAUDE.md`（数据流：Svelte 组件 → `lib/services/*.ts` (invoke 包装) → Rust `#[tauri::command]` → rusqlite → SQLite）

- ⚠️ 任务描述中的两个符号在该项目中**不存在**：`getAllStarredRepositories` 与 `autoSync.ts` 全仓库无任何匹配（grep 零命中）——**未能查证，判定为任务方记忆偏差**；其功能等价物分别是命令层 `fetch_starred_repos` / `fetch_starred_repos_authenticated` 与「Import 页手动触发」（无任何自动同步模块）。下文第 2 题按实际代码作答。

---

## 概览（一句话）

StarManager 是 **"批量导入一次性拉全量 → 之后一切浏览/搜索/筛选/翻页 100% 走本地 SQLite、零网络"** 的架构：GitHub API 只在用户手动点 Import 和查看 README 时被调用，**没有增量同步、没有轮询、没有 ETag、没有 star/unstar 写操作**。

---

## 1. 内容获取路径：列表 / 详情 / 搜索 / 筛选 / 翻页

| 功能 | 走什么 | 文件:行（关键函数） |
|---|---|---|
| **列表（浏览 + 筛选 + 排序 + 翻页）** | **本地 SQLite**（零网络） | `src-tauri/src/commands/database.rs:36` `get_all_repos()`——语言/分类/标签过滤（`database.rs:55` 起的 WHERE 拼接）、排序列映射（`stargazers_count/updated_at/full_name`，缺省 `starred_at`，`database.rs:41-47`）、`LIMIT/OFFSET` 分页（`database.rs:89`）；前端入口 `src/routes/stars/+page.svelte:20` `getAllRepos($currentFilter)` |
| **搜索** | **本地 SQLite FTS5**（零网络） | `src-tauri/src/commands/database.rs:110` `search_repos()`——每词转 `"<word>"*` 前缀 MATCH（`database.rs:115-119`），查询走 `repos_fts` 虚表（建表+触发器同步见 `src-tauri/src/db/migrations.rs:126-156`）；前端 `src/routes/stars/+page.svelte:18` `searchRepos(query, page, per_page)` |
| **详情（元数据/标签/分类/笔记）** | **本地 SQLite**（零网络） | `src-tauri/src/commands/database.rs:154` `get_repo_by_id()`（连带查 tags、category、`readme_cache`）；前端 `src/routes/stars/[id]/+page.svelte:30` `getRepoById(repoId)` |
| **详情（README 正文）** | **GitHub API** | `src-tauri/src/services/github_client.rs:88` `fetch_readme()` → `GET /repos/{owner}/{repo}/readme`，可选带 `Bearer`（`github_client.rs:97`）；触发点 `src/routes/stars/[id]/+page.svelte:42-47` `loadReadme()`（仅当 `repo.readme` 为空且切到 README tab，`[id]/+page.svelte:89-90`） |
| **筛选选项（语言列表）** | **本地 SQLite** | `src-tauri/src/commands/database.rs:238` `get_languages()` `SELECT DISTINCT language FROM repos`；分类/标签同为本地 CRUD（`database.rs:305+`） |
| **全量拉取 star 列表（仅手动导入）** | **GitHub API** | 见第 2 题 |

**没有 HTML 解析**：全仓库没有对 `github.com` 网页的抓取（唯一的 github.com HTTP 请求是 OAuth 设备码端点，`github_client.rs:127`）。对比：我们的脚本主体是 HTML 解析，这是根本差异。

## 2. 同步时机

- **全量拉取触发点 = 用户手动点 Import 页按钮，仅此一处**：
  - 公开路径：`src/routes/import/+page.svelte:23`（`importByUsername()`）→ 命令 `src-tauri/src/commands/github.rs:7` `fetch_starred_repos` → `github_client.rs:13` `fetch_starred_public()`，`GET /users/{username}/starred?per_page=100&page=N`（`github_client.rs:20`）循环到空页（`github_client.rs:39`）。
  - OAuth 路径：`src/routes/import/+page.svelte:47`（`completeOAuth()`）→ `commands/github.rs:17` `fetch_starred_repos_authenticated` → `github_client.rs:50` `fetch_starred_authenticated()`，`GET /user/starred?per_page=100&page=N` + `Accept: application/vnd.github.star+json`（带回 `starred_at`，`github_client.rs:62`）+ `Authorization: Bearer`（`github_client.rs:63`）。
  - **启动时不拉**：`src/routes/+layout.svelte` 与 `src/routes/+page.svelte`（Dashboard）没有任何 GitHub 调用（grep `onMount|invoke|fetch` 零命中；Dashboard 只调本地 `getDashboardStats`，`+page.svelte:3`）。
- **增量 / 轮询 / ETag：全部没有**（grep `ETag|If-None-Match|setInterval` 零命中；唯一的轮询是 OAuth token 轮询，5 秒/次、最多 60 次，`github_client.rs:145-171`）。
- **`autoSync.ts`：不存在**——没有推送、没有定时拉取、没有后台同步。
- **本地缓存与远端的关系**：
  - **浏览以本地为唯一数据源**（远端不参与浏览路径）。
  - **远端字段权威**：导入时 `INSERT … ON CONFLICT(github_id) DO UPDATE` 覆盖 description/language/stars 等（`commands/github.rs:44-49`），`fetched_at=datetime('now')`（`github.rs:49`）。
  - **本地权威字段**：`notes / ai_summary / category_id` 不在 UPDATE 列表里，永不被导入覆盖（`github.rs:44-50`）；`starred_at` 用 `COALESCE(excluded.starred_at, repos.starred_at)` 保护——公开导入拿不到时间戳时不抹掉旧值（`github.rs:50`）。
  - **只合并、不删除**：全仓库无 `DELETE FROM repos`（grep 零命中）——**远端已 unstar 的仓库永远留在本地**，没有 unstar 检测。
  - `fetched_at` 只写不读：没有任何基于它的过期/刷新策略。

## 3. token 策略

- **配置入口**：设置页一个 password 输入框 `src/routes/settings/+page.svelte:110-111`，保存到 `app_metadata` 键 `github_token`（`src-tauri/src/commands/settings.rs:83-84`），**明文存 SQLite**。
- **classic / fine-grained 不区分**：纯字符串，无前缀校验、无格式提示（对比我们 3.0.9 的 `ghp_`/`github_pat_` 前缀校验）。
- **第二条认证路径 = OAuth 设备流**：`github_client.rs:125` `start_device_flow()`，申请 scope **仅 `read:user`**（`github_client.rs:130`）；拿到的 token **只当场用于本次导入**（`import/+page.svelte:45-47`），**不落盘**。
- **⚠️ 值得注意的坑：设置里的 PAT 全仓库只有一个消费者——README fetch**（`stars/[id]/+page.svelte:47`）。Import 的认证路径用的是 OAuth 现场 token，**设置的 PAT 从不用于导入**；且 settings store 只在打开设置页时才被填充（`settings/+page.svelte:60-61` 是全仓库唯一的 `getSettings` 调用），其他页面 `$settings.github_token` 默认 `null`（`src/lib/stores/settings.ts:5`）——**没进过设置页就直接开详情页，README 会以未认证请求发出**。
- **无 token 降级：完全可用**。降级路径 = 公开导入 `GET /users/{username}/starred`（任意用户名，含他人），代价是 **拿不到 `starred_at` 时间戳**（UI 明示："starred_at timestamps require authentication"，`import/+page.svelte:26`）与私有 star 不可见；浏览/搜索/筛选/翻页本来就全本地，与 token 无关。

## 4. 是否强制 token？

**不强制。** 无 token 用户看到：
- Dashboard 空态："Get started by importing your GitHub stars." + `Import Stars` 按钮（`src/routes/+page.svelte:100-102`）；
- Stars 页空态："No stars found." + `Try a different search term` / `Import Stars`（`src/routes/stars/+page.svelte:74-78`）；
- 两条导入路径任选：公开用户名导入（零配置）或 OAuth 设备流（需自备 OAuth App Client ID，`import/+page.svelte:31-35`）。

应用本身可离线完整浏览已有数据——没有任何"必须先认证"的门槛。

## 5. 网络调用清单（典型会话）

| 动作 | 网络请求数 | 内容 |
|---|---|---|
| 打开应用（Dashboard） | **0** | 全部 SQLite IPC |
| 浏览列表 + 翻页（任意页数） | **0** | `get_all_repos` LIMIT/OFFSET 本地 |
| 搜索（任意次） | **0** | `repos_fts` MATCH 本地 |
| 筛选/排序（任意次） | **0** | 本地 WHERE/ORDER BY |
| 打开详情页（元数据） | **0** | `get_repo_by_id` 本地 |
| 打开详情 README tab | **1/次** | `GET /repos/{o}/{r}/readme`（**`readme_cache` 表只读不写**——全仓库无 `INSERT INTO readme_cache`，缓存是死代码，`migrations.rs:93` 建表后无写入方） |
| star / unstar | **N/A** | **该应用根本没有实现 star/unstar 写操作**（grep `unstar` 零命中；对 GitHub 只有 GET，无 PUT/DELETE `/user/starred/...`） |
| 手动导入 N 个 star | `⌈N/100⌉` | `GET /user/starred?per_page=100&page=N`（认证）或 `GET /users/{u}/starred...`（公开）；OAuth 路径另加 1 次 `POST /login/device/code` + 每 5s 一次 `POST /login/oauth/access_token`（最多 60 次） |

**结论：日常使用（浏览+翻页+搜索+筛选）网络请求为 0；唯一常态网络消耗是 README。** 这正是"本地优先"的极致形态。

## 6. 值得借鉴的坑（代码实证）

1. **错误处理过于粗糙**：`github_client.rs:30,68,105` 一律 `Err(format!("GitHub API error: {}", resp.status()))` → **403 限流、401 坏 token、422 不区分**；无 `X-RateLimit-Remaining` / `retry-after` / `X-Accepted-GitHub-Permissions` 处理（grep `ratelimit|403|retry` 在 Rust 侧零命中）。错误字符串化后前端只 `showToast('Import failed')`（`import/+page.svelte:27-28`），用户无从修复。**我们 3.0.9 的速率守卫 + 401/403 熔断 + 修复提示是明显更优设计，不要退化成这样。**
2. **翻页零延迟**：`fetch_starred_public/authenticated` 的 loop 里**没有任何 `sleep`**（`github_client.rs:21-46 / 58-83`；文件中仅有的 sleep 在 OAuth 轮询，`github_client.rs:145`）——`per_page=100` 连发。**我们 D6 的"页间 100ms"应保留，别抄成无延迟连打。**
3. **导入是"先全量 fetch 完→再一次性 insert"**（`commands/github.rs:11-25`：await 拉完才进 `insert_github_repos`）→ 中途失败时**一条都不写**，天然原子；但代价是大列表无进度反馈——TS 签名里的 `onProgress` 回调是**死参数**（`src/lib/services/github.ts:4,8`，invoke 根本不传）。UI 的 progress 只有 fetching/done 两态（`import/+page.svelte:20-28`）。
4. **终止条件 `is_empty()`**（`github_client.rs:39,77`）：star 数恰为 100 的倍数时多发一次请求（无害但多耗一次配额）；非 2xx 中途失败即整体报错（配合第 3 点反而保住了原子性）。
5. **私有仓库权限问题处理得很弱**：公开端点天然不含私有 star（UI 提示走 OAuth，`import/+page.svelte:68`），但 OAuth 只申请 `read:user`（`github_client.rs:130`）——**对读取私有 star 所需权限而言是可疑的最小 scope**，且拿不到时错误信息只有状态码。与我们 D3/D6g（classic 无 `repo` scope 私有星标缺席 → 误判 unstar）是同一类问题，**他们没有给出解法**。
6. **没有 unstar 检测**：只 upsert 不 delete（`commands/github.rs:44-50`）→ 本地库是"历史并集"，远端取消 star 后本地仍在。**我们 3.0.9/3.1.0 的快照 diff + P4 整表 diff 已经比它完备，这是他们没做、我们必须保留的能力。**
7. **README 缓存表死代码**（`migrations.rs:93` 建表，无写入方）→ 每次开详情 README tab 都打一次 API；**token 明文存库 + settings store 只在设置页才加载**（见第 3 题），认证行为依赖浏览历史，属隐性 bug。

---

## 对照表：StarManager vs GithubStarManager（我们的脚本）

| 维度 | StarManager（桌面，本地权威） | GithubStarManager（用户脚本，页面即主场） |
|---|---|---|
| 列表来源 | 导入后全本地 SQLite | 页面 HTML 解析为主 + 3.1.0 起 P4 API 全量同步（`src/fullSync.ts`） |
| 详情 | 本地元数据 + API 拉 README | 页面本身（无需另拉） |
| 搜索/筛选/翻页 | 全本地（FTS5 / WHERE / LIMIT） | 拦截后走本地缓存（`searchCacheRepos`）+ 原地翻页 fetch HTML（`src/pagination.ts`） |
| 同步时机 | 仅手动 Import，无自动 | 3.1.0 Sync 按钮手动 + 快照消失 >12 自动（**且有位移判定，优于其"只合并不删"**） |
| unstar 检测 | **无**（只合并不删） | 快照 diff + API 双 404 确认 + 宽限管线（**我们更强**） |
| 速率限制处理 | **无** | 余量 <50 暂停 / retry-after / 401·403 熔断（**我们更强**） |
| token | PAT 明文 + OAuth `read:user`，PAT 只用于 README | PAT 双格式前缀校验 + TM 菜单配置（**我们更严**） |
| 页间延迟 | **0ms 连发** | 100ms（**保留我们的**） |
| 强制 token | 否 | 否（无 token 走 HTML + 降级提示） |

## 「改 API 为主」可直接抄 / 不该抄

**可直接抄：**
1. **"远端字段权威 / 本地字段权威"的 upsert 边界**（`commands/github.rs:44-50`）：同步回填只覆盖远端拥有的字段（描述/语言/star 数/starred_at），本地拥有的 notes/标签/备注绝不触碰，`starred_at` 用 COALESCE 保护——与我们 D6c 的权威边界完全同构，可直接套进 `fullSync.ts` 的回填 SQL/GM 存储写入。
2. **认证端点选择**：`GET /user/starred` + `Accept: application/vnd.github.star+json` + `per_page=100` 分页拿 `starred_at`（`github_client.rs:57-63`）——正是我们 P4 已采用的方案，可作为交叉印证；OAuth 设备流（无需嵌 secret 的客户端认证）是未来想免手输 PAT 时的可选升级。
3. **本地优先的交互闭环**：浏览/搜索/筛选/翻页 0 网络（FTS5 + LIMIT/OFFSET + 筛选选项全本地派生），对应我们 P3（缓存先渲染 + 到货校正）的方向——搜索用"每词前缀 MATCH"的简单分词策略（`database.rs:115-119`）也可借鉴到缓存搜索。

**不该抄：**
4. **不要抄它的同步与容错**：无页间延迟连发、403/401/422 不区分、无速率守卫、无 unstar 检测（只合并不删）、无进度回调——这些正是我们 3.0.9/3.1.0 已经解决的问题，照抄会全面倒退；半表失败时它靠"拉完才写"保原子，我们 D6e 的"整表拉不完就不改任何数据"是同一原则的更严版本，继续保留。
5. **不要抄它的 token 管理**：明文存库、无格式校验、OAuth scope 只有 `read:user`、PAT 存了却只给 README 用、settings store 不加载导致认证静默失效——沿用我们的前缀校验 + 401/403 熔断 + `X-Accepted-GitHub-Permissions` 提示（D3），不要引入第二套未落盘的凭据路径。

---

## 来源列表（本地源码，只读调研）

1. `C:\Users\28676\Documents\Program\StarManager\CLAUDE.md` — 架构/数据流权威说明
2. `C:\Users\28676\Documents\Program\StarManager\src-tauri\src\services\github_client.rs` — 全部 GitHub HTTP 调用（L13 公开导入 / L50 认证导入 / L88 README / L125·140 OAuth）
3. `C:\Users\28676\Documents\Program\StarManager\src-tauri\src\commands\github.rs` — 导入命令与 upsert 合并策略（L7-L98）
4. `C:\Users\28676\Documents\Program\StarManager\src-tauri\src\commands\database.rs` — 本地列表/搜索/详情/筛选（L36·L110·L154·L238）
5. `C:\Users\28676\Documents\Program\StarManager\src-tauri\src\db\migrations.rs` — FTS5 与 readme_cache 表（L93·L126-156）
6. `C:\Users\28676\Documents\Program\StarManager\src\routes\import\+page.svelte` — 唯一同步触发点（L23·L47）
7. `C:\Users\28676\Documents\Program\StarManager\src\routes\stars\+page.svelte` / `src\routes\stars\[id]\+page.svelte` — 浏览与详情路径（L18-20 / L47）
8. `C:\Users\28676\Documents\Program\StarManager\src\routes\settings\+page.svelte`、`src\lib\stores\settings.ts`、`src-tauri\src\commands\settings.rs` — token 配置与存储
9. `C:\Users\28676\Documents\Program\StarManager\src\lib\components\stars\StarFilters.svelte` — 筛选选项来源（L58-91）
