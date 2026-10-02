---
title: 补上 token 归属校验与不符警告横幅
status: done
created: 2026-10-02
session: 01a0fc9e-394a-72f8-ba3a-818efb6df338
approved: 2026-10-02
completed: 2026-10-02
---
# 方案：Token 归属校验 + 不符时的常驻可关闭警告

> 状态：待用户审查（deep-plan 规划闭环产出）
> 目标版本：4.11.0
> 唯一可写文件：本文件（deep-plan 硬写保护；批准后解锁其余文件）

---

## 1. 目标与非目标

### 1.1 目标

补上当前缺失的一环：**比对脚本持有的 GitHub token 属于哪个账号，与浏览器当前登录的账号是否为同一个**。两者不符时，在**与现有配置横幅相同的位置**插入一条**常驻、可手动关闭**的警告，说明风险所在，并引导用户更换 Token（或调整登录账号）。

### 1.2 为什么现在做（缺口证据）

4.10.0 及之前，全仓库**没有任何一处**比对两侧身份：

| 侧 | 现状 | 证据 |
|---|---|---|
| 浏览器侧身份 | 只被用于「存储键隔离」与「导入包归属校验」，**从不与 token 比对** | `src/storage/tags.ts:6-9`（`getStarsUserId()` 读 `meta[name="octolytics-dimension-user_id"]`）；消费者 `src/storage/exportImport.ts:138-147` |
| 会话存在性 | 只判**有没有**登录（`body.logged-in` + meta 非空），**从不读 meta 的值** | `src/starWrites.ts:93-99`（`hasWebSession`，未 export，仅 2 处调用：`starWrites.ts:299`、`306`） |
| token 侧身份 | **根本不存在**：全库无 `GET /user`、不读 `x-oauth-scopes` | `api.github.com` 引用仅 3 处，全是 `/user/starred*`：`src/fullSync.ts:347`、`src/fullSync.ts:571`、`src/starWrites.ts:124` |
| 保存 token 时 | 无任何验证请求；唯一动作是 `runFullSync('button')` | `src/index.ts:507-513` |

### 1.3 真实错号路径（本功能的动机）

1. **fine-grained token 属 A + 浏览器登录 B**：`src/starWrites.ts:294-317` 的静默分派把写操作交给 Cookie 会话（B），而网格里的星标数据来自 A 的 `/user/starred` ⇒ 用户在 A 的数据上点击，操作落到 B，**方向相反**（显示已 star → 发 `unstar`）。
2. **classic token 属 A + 浏览器登录 B**：读与写都在 A 上（自洽），但脚本占位的正是 B 的 stars 页面 ⇒ 用户在 B 的页面上看到 A 的星标列表，认知与页面上下文不符。
3. **批量恢复**（`src/restore.ts:42-45`）与卡片星按钮共用 `setStarState`，同样受影响。

### 1.4 明确不做（非目标）

- 不阻断写路径（见 V2）。
- 不做「每次写前校验」（见 V3）、不做周期性复检（见 V4）。
- 不引入多 token 支持、不自动在多个 token 里挑一个匹配当前账号（见 D11）。
- 不处理「无 token + 有登录会话」组合（见 V5）。
- 不给 `stars_full_sync_meta` 加账号字段（见 V6）。
- 不改窄视口策略：窄视口**完全惰性**，本功能一个节点都不建（见 D7）。
- 不碰详情页（D17 既有裁定）。

---

## 2. 事实基础（P2 查证结果）

完整报告：`/.pi/tmp/research-token-identity.md`（联网查证，32 KB，逐条带 URL 与原文）、`/.pi/tmp/scout-banner-map.md`、`/.pi/tmp/scout-identity-hooks.md`（file:line 现状图）。

| # | 事实 | 强度 | 来源 |
|---|---|---|---|
| F1 | `GET /user` 对 **fine-grained PAT 不需要任何权限** | 官方文档 | 端点页原文「The fine-grained token does not require any permissions.」<https://docs.github.com/en/rest/users/users> |
| F2 | classic PAT 无 scope 也**能认证成功**（`read:user` 只决定返回公开版还是私有版用户对象） | 官方文档 | 同页原文「A token without scopes still authenticates as the token's owner」 |
| F3 | 官方汇总页 `endpoints-available-for-fine-grained-personal-access-tokens` **漏列** `GET /user`；该页只收录「需要权限」的端点（两组反例交叉验证）⇒ **漏列 ≠ 不可用** | 官方文档 + 反例验证 | 同上 + `https://docs.github.com/en/rest/authentication/endpoints-available-for-fine-grained-personal-access-tokens` |
| F4 | 响应含 `login` 与数字 `id`；`id` 持久，`login` **可改名** | 官方文档 | <https://docs.github.com/en/rest/users/users> |
| F5 | `GET /user` 在 primary 限流下按**请求数**计 1（「1 点/5 点」表属 secondary，不作用于 primary） | 官方文档 + 本仓库 D1 实测 | <https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api> |
| F6 | 真机实测（2026-10-02，已登录 Chrome）：`meta[name="user-login"]` = `YsLtr`、`octolytics-dimension-user_login` = `YsLtr`、`octolytics-dimension-user_id` / `octolytics-actor-id` = `130123551` | 本机实测 | 报告 §4.1（`agent-browser-cli` 只读 DOM 探针） |
| F7 | 这些 meta **无任何官方契约**：`octolytics-*` 是 GitHub 自家埋点（GitHub 员工 2013 年公开说明）；`csrf-token` 曾是惯例、**今天已完全消失** ⇒ meta 会无声变更 | 官方人员发言 + 社区实证 + 本机实测 | 报告 §4.3；<https://github.com/pengwynn/pingwynn/issues/6> |
| F8 | `github-url-detection` v11.2.4（rgh 现依赖）至今仍用 `meta[name="user-login"]` 取 `getLoggedInUser()`；**refined-github 已实现同构比对**（token 的 `GET /user` `.login` vs 登录用户，不一致即抛错） | 社区实证（现役代码） | <https://github.com/refined-github/refined-github/blob/main/source/github-helpers/github-token.ts>、`.../api.tsx` |
| F9 | **不存在**「用浏览器会话查当前账号」的官方 API；从已登录页面对 `api.github.com` 发带凭据请求被 CORS 拦死（`ACAO: *` 且无 `ACAC`），不带凭据返回 401 | 官方文档 + 本机实测 | 报告 §5 |
| F10 | GHES / SAML SSO 下的 meta 行为 **未确证**（GitHub Docs 全站含各 GHES 版本、github/docs 抽查、相关 issue 与脚本社群均无权威来源） | 未确证 | 报告 §4.4 / §8 |

**⇒ 关键推论**：token 侧身份只能靠**新增一次 `GET /user`** 取得（F1/F2 证明两类已支持凭证都拿得到）；浏览器侧身份只能靠**无契约的 DOM meta**（F6–F8 证明其可用但会变），故必须有「取不到就不判定」的降级路径（F7 + D5）。

---

## 3. 设计决策（P1 自问自答，13 条）

> 每条均已在 deep-plan 中记录（含证据与置信度）。

| ID | 决策 | 置信度 |
|---|---|---|
| D1 | 比对键用**数字 user id**（浏览器侧 `octolytics-dimension-user_id`，token 侧 `GET /user` 的 `id`）；`login` 只用于文案 | high |
| D2 | token 身份用 `GET /user` 取得；fine-grained 免权限有官方原文背书 | high |
| D3 | 求值点只有三个：token 保存后 / 桌面转换成功后 / 全量同步 finally；**不做写前校验** | high |
| D4 | 仅「有 token + 有登录会话 + 两侧 id 都取到」时才判定；其余组合不判定 | high |
| D5 | 身份取不到 / 请求失败 = **unknown 静默降级**，不冒充相符也不误报不符；401 走既有 `notifyTokenIssue` | high |
| D6 | 警告用**独立节点 + 独立 class**（`.gsm-account-banner`），但**复用 `placeSetupBanner`** 的落位规则 | high |
| D7 | 窄视口不建任何节点（首行 `!isDesktop()` 门），变宽时靠既有 `transformAndReveal(false)` 重新评估 | high |
| D8 | 新节点登记进 `viewTeardown` 第 3 项选择器串；关闭状态键属页面级偏好、不随视口回滚 | high |
| D9 | 额度：只新增 1 次 primary 请求，指纹缓存命中后稳态为 0 | high |
| D10 | 产出 ADR 0007 + 决策 D25，并把两条不确定项写进「已知风险」 | high |
| D11 | 不引入多 token 支持，不自动切换凭证 | high |
| D12 | 凭证指纹用内联 FNV-1a（不用 `crypto.subtle`，其在脚本沙箱的可用性未验证） | high |
| D13 | 警告文案**结果导向**，不披露写通道（沿用 ADR 0006 / `writeFailureMessage` 既有裁定） | high |

---

## 4. 可变决策表（用户可能另有偏好，均已生效默认值）

| ID | 选择 | 已生效默认值 | 改动代价 |
|---|---|---|---|
| V1 | 关闭后的重新武装粒度 | 写 GM 键 `stars_account_banner_dismissed` = `tokenId#sessionId`；**仅当组合变化才重弹**（换 token / 换登录账号），重开页面不弹 | 低 |
| V2 | 不符时是否阻断写路径 | **不阻断**（保留 fine-grained 用户唯一写能力；用户可能刻意双账号） | 中 |
| V3 | 是否加「每次写前」求值点 | **不加**（只防结构性错号，不追求写瞬间即时确认） | 中 |
| V4 | 是否周期性复检身份 | **不加轮询**（纯耗额度；需世代号 + 视口复判三重守卫） | 低-中 |
| V5 | 「无 token + 有登录会话」组合是否告警 | **本期不告警**，记为已知风险（需先给缓存加账号字段） | 中 |
| V6 | 缓存元数据是否顺带记账号 ID | **不记**（不动 `stars_full_sync_meta` 结构，避免迁移与导出包牵连） | 低 |
| V7 | 横幅是否内联 token 输入框 | **不内联**（只给 classic 深链 / 打开配置面板 / 关闭三个控件，避免两套保存状态机） | 中 |
| V8 | id 拿不到时是否降级用 login 名称比对 | **不降级**（login 改名会造成永久误报，误报比漏报更伤可信度） | 低 |

---

## 5. 实现方案

### 5.1 模块划分（遵守 D9 的分层铁律：纯逻辑不碰 DOM 交互）

新增两个模块：

**`src/accountGuard.ts`** —— 判定与缓存（网络 + 存储 + 读取 DOM meta 的既有函数，不含布局/弹窗）

```ts
export type AccountMatch = 'match' | 'mismatch' | 'unknown';

export interface AccountVerdict {
  state: AccountMatch;
  /** 仅在 mismatch 时有值，用于文案 */
  tokenLogin?: string;
  sessionLogin?: string;
}

/** 唯一入口：幂等、去重、可并发安全调用 */
export async function evaluateAccountMatch(): Promise<AccountVerdict>;
```

实现要点：

1. **首行视口门**：`if (!isDesktop()) { console.log(...); return { state: 'unknown' }; }`（与 `showSetupBanner` 同位同写法，`src/index.ts:226-232`）。
2. **取浏览器侧**：`getStarsUserId()`（复用，`src/storage/tags.ts:6-9`）+ login 文案用 `meta[name="octolytics-dimension-user_login"]` —— **该 meta 目前在 `src/` 零消费者**，本次首次启用；空串即视为「取不到」。两侧 id 任一为空 → `unknown`。
3. **取 token 侧**（有 token 时才需要）：
   - `const token = getToken(); if (!token) return { state: 'unknown' };`（V5：无 token 本期不判定）
   - `hasWebSession()` 为假 → `unknown`（无会话 = 无错号风险，D4/B 组合）。注意该函数当前未 export，需 export 或在本模块内重写同一判据 —— **取 export 复用**，避免两份判据漂移。
   - 指纹 = `fnv1a(token)`；查缓存键 `STORAGE_KEYS.accountIdentity`：命中且 `tokenId` 与当前 `sessionId` **不同**则直接 `mismatch`（零请求）；命中且相同 → `match`（零请求）。
   - 未命中 → `GET https://api.github.com/user`（`Authorization: Bearer`、`X-GitHub-Api-Version: 2022-11-28`），成功则写缓存 `{[fingerprint]: {id, login}}`，失败（401/403/网络）→ `unknown` 且**不写缓存**（下次求值点重试）；401 同时调既有 `notifyTokenIssue('401 Bad credentials：Token 已失效或被撤销')`。
   - **单飞**：模块级 `let inflight: Promise<AccountVerdict> | null`，并发求值点共用同一 Promise（三个求值点可能同帧触发）。
4. **判定**：`tokenId === sessionId ? 'match' : 'mismatch'`。

**`src/ui/accountBanner.ts`** —— 警告横幅的创建/移除/关闭

```ts
export function showAccountBanner(verdict: AccountVerdict): void; // 幂等
export function removeAccountBanner(): void; // 供 viewTeardown 第 3 项路径之外显式调用（可选）
export function mountAccountGuard(): void;   // 组合：evaluate + 关闭态判定 + show
```

### 5.2 警告横幅的 DOM 与样式

结构（同现有横幅的 flex 语言，复用落位函数）：

```
div.gsm-account-banner
├─ span.gsm-account-msg        ← 结果导向文案（D13）
├─ button.btn                 「换成与当前登录匹配的 classic Token」→ openClassicTokenCreator()
├─ button.btn                 「打开 Token 配置」→ showSetupBanner()（已存在时其幂等分支只刷文案）
└─ button.btn.gsm-account-dismiss  「关闭」（右上/末尾）
```

- 落位：`placeSetupBanner(bar, host)`，`host = getStarsMainColumn() || document.getElementById('user-starred-repos')`；取不到 host 直接 return（与 `src/index.ts:240-242` 同口径）。与配置横幅并存时插在其之前（同一落位路径天然确定顺序，`prepend`/`before` 语义见 `src/index.ts:326-335`）。
- 样式：新增 `.gsm-account-banner` 规则，写在 `src/styles/base.css` 现有 `.gsm-setup-banner` 规则块旁（`base.css:660-713` 之后），**沿用同一套 Primer 变量与尺度**（`--bgColor-*-muted` 底 + 1px 真描边 + 6px 圆角 + `12px 16px` 内边距，见 D11）。**不新建 `@media` 门**（窄视口由 JS 门负责，同 D18）。
- 关闭按钮交互：`withHover` 式的三态（如不走 notifications 的内部工具，则直接 `style.opacity` 0.7/0.5 与 notifications 的 `.flash-close` 口径对齐），点击 → 写 `STORAGE_KEYS.accountBannerDismissed = tokenId#sessionId` → `bar.remove()`。
- 关闭态判定：`showAccountBanner` 前先比对当前 `tokenId#sessionId` 与已存值，相同则跳过。

### 5.3 触发点接入（三处，全部走同一 `mountAccountGuard()`）

| # | 位置 | 说明 |
|---|---|---|
| 1 | `src/index.ts` token 保存回调链（`507-513`） | 保存成功后立刻评估，让用户在配置流程里当场看到不符 |
| 2 | `src/index.ts` `transformAndReveal` 的成功出口（`196-204`，紧随 `scheduleProbeSync()`） | 冷启动 / Turbo 进页；覆盖「浏览器换号但 token 未变」 |
| 3 | `src/fullSync.ts` `runFullSync` 的 finally（`797-809`） | 覆盖同页换号；且此时缓存（若有）刚被刷新 |

三处均为**异步 fire-and-forget**（`void mountAccountGuard()`），不得进入 `runFullSync` 的关键路径，也不得影响同步状态机（D23 的 `SyncState` 只由同步推进）。

### 5.4 存储键（`src/constants.ts` 追加两个）

```ts
accountIdentity: 'stars_account_identity',        // { [fingerprint]: { id, login } }
accountBannerDismissed: 'stars_account_banner_dismissed', // '<tokenId>#<sessionId>'
```

均为非敏感键（存哈希与数字 ID，非 token 本身），按既有 `stars_*` 前缀约定（`src/constants.ts:33-46`）。

### 5.5 生命周期与回滚

- `viewTeardown.ts` 第 3 项选择器串（`src/viewTeardown.ts:56-62`）追加 `.gsm-account-banner`。
- 关闭状态键与身份缓存键**不随视口回滚**（D8 / D20 的「视图级 vs 页面级」边界）。
- 无新增持久监听、无新增定时器 ⇒ 不需要 `lifecycle` 作用域（横幅上的监听随节点一起销毁）。

---

## 6. 验收标准（可验证）

| # | 断言 | 判定方式 |
|---|---|---|
| A1 | 真·不符（token=A、浏览器=B）时，桌面端出现 `.gsm-account-banner`，位置与 `.gsm-setup-banner` 同容器/同落位规则 | 仿真页断言（桩 `/user` 返回另一 id）+ 真机观感 |
| A2 | 相符时不出现任何节点，且**不产生 DOM 痕迹**（零 `.gsm-account-banner`） | 仿真页断言 |
| A3 | 关闭后本会话不再出现；`reload` 后仍不出现（组合未变）；换 token 或换会话 id 后重新出现 | 仿真页断言（三次加载） |
| A4 | 窄视口下**零痕迹**：无节点、无类名、无内联样式、无标记；`grid = 0` 保持 | 仿真页断言（复用既有窄视口零残留口径） |
| A5 | 身份 meta 缺失 → `unknown`，**不弹**任何 UI | 仿真页断言（删 meta） |
| A6 | `GET /user` 失败（401 / 网络错）→ `unknown`，不弹 mismatch 警告；401 走既有 `notifyTokenIssue` 链路 | 仿真页断言（桩网络错 / 桩 401） |
| A7 | 稳态零额外请求：第二次求值不发 `GET /user`（指纹缓存命中） | 仿真页断言（计数 fetch） |
| A8 | 相符/不符**都不改变写路径行为**（点星仍按原逻辑走、失败文案不变） | 仿真页断言 + 代码审查（`setStarState` 未被改） |
| A9 | 收窄视口回滚后 `.gsm-account-banner` 被移除；拖回桌面若组合仍不符则重现 | 仿真页断言（复用既有桌面↔窄往返工装） |
| A10 | `pnpm check` 绿 / `node scripts/verify-css.cjs` EXIT 0 / `pnpm test:exportimport` 51-0 不回归 / dist 头部 `@grant` 仍恰 5 项 | 命令行 |
| A11 | 文案不含「网页端点 / 浏览器会话 / GitHub-Verified-Fetch / REST」等通道词（D13） | 代码审查 + dist grep |

---

## 7. 任务分解（T1–T8）

见 `deep_plan_task` 清单（同一份内容，此处不重复）。

| ID | 标题 | 主要产出 |
|---|---|---|
| T1 | 新增身份缓存键与常量 | `src/constants.ts` 两个键 |
| T2 | 实现 `src/accountGuard.ts` 判定与缓存 | 新模块 + `hasWebSession` export |
| T3 | 实现 `src/ui/accountBanner.ts` 横幅 + 样式 | 新模块 + `src/styles/base.css` 规则 |
| T4 | 接入三个求值点 | `src/index.ts` ×2、`src/fullSync.ts` ×1 |
| T5 | 登记回滚清单 | `src/viewTeardown.ts` 第 3 项 |
| T6 | 仿真页断言（A1–A9） | `.diag/gen-account-harness.cjs` + `assert-account-*.js` |
| T7 | 静态验证（A10/A11） | `pnpm check` / `verify-css` / `test:exportimport` / dist grep |
| T8 | 文档：ADR 0007 + AGENTS.md D25 + 已知风险两条 | `docs/adr/0007-token-account-match-check.md`、`AGENTS.md` |

---

## 8. 验证计划

1. **静态**：`pnpm check`（tsc + build）→ `node scripts/verify-css.cjs`（CSS 等价性）→ `pnpm test:exportimport`（51 项，应无回归）→ dist 头部 `@grant` 计数 = 5 → dist 内 grep 通道词为零。
2. **仿真页**（`.diag/` 工装，gitignore）：复用 `gen-jump-harness.cjs` 的注入范式（UTF-8 安全解码 + **URL 必须带 `?tab=stars`** + `html.replace(needle, () => text)` 函数形式），夹具需含身份 meta（`octolytics-dimension-user_id` / `_user_login` / `user-login` / `body.logged-in` —— 注意现有 `tests/smoke/fixture.html` 只有前两个且**没有** `logged-in`）。`fetch` 全部用桩，零真实网络。
3. **真机**（`agent-browser-cli`，桌面且**前台标签页**）：① 用当前真实账号（token 相符）确认不弹；② 手动把 `stars_account_identity` 缓存写成另一个 id 触发 mismatch，确认横幅位置/观感/关闭/重载行为；③ 窄窗口确认零痕迹；④ TM 安装页核对授权清单仍为 5 项。

---

## 9. 风险与未确证

1. **页面身份 meta 无契约**（F7）：`csrf-token` 的前例证明 GitHub 会无声移除 meta。若 `octolytics-dimension-user_id` 消失 ⇒ 本功能静默失效（unknown），脚本其余行为不变 —— 这是**有意的降级方向**。已实测的对照探测脚本未入库，下次可用同一手法复查。
2. **GHES / SAML SSO 下 meta 行为未确证**（F10）：用户群体若含 GHES，本功能可能完全失效（仍为 unknown，不误报）。
3. **不符时仍允许写**（V2）：有意保留用户选择权，代价是「知道有风险仍可能误操作」。横幅文案必须把后果写清。
4. **「无 token + 有登录会话」组合未覆盖**（V5）：缓存可能来自上一个账号，本期只记风险不改缓存结构。
5. **`login` 仅用于文案**：token 响应与页面 meta 的 login 若因改名不一致，文案可能显示不同的名字 —— 判定仍以 id 为准，不受影响。
6. **多标签页**：一个标签换了 token，另一个标签的关闭态/缓存不即时同步（与既有「TM 菜单标签不跨标签同步」同源，属既有局限）。

---

## 10. 文档产出

- 新增 `docs/adr/0007-token-account-match-check.md`：记录比对键选择（id 而非 login）、仅 A 组合判定、unknown 静默降级、meta 非契约的接受理由、不阻断写、仅桌面端、以及「静默分派不披露通道」在新增 UI 上的延续。
- `AGENTS.md` 新增 **D25** 条目 + 「已知风险」两条（meta 无契约 / GHES 未确证）+ 「下一步」更新。
- `DEVELOPER.md` 若含模块清单（按该文件既有章节），追加两个新模块的一句话职责。
