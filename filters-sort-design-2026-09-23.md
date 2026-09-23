# 筛选/排序全本地化 + 排序 bug — 调研与设计（2026-09-23）

> 状态：**设计稿，未动代码**。范围 = 用户 6 项需求（2 项 bug/功能 + 2 项并行功能 + 追加 2 项）。
> 结论先行：排序 bug 的根因是「browse 态渲染完全忽略原生 Sort 选择」；修复方案与
> 「筛选全本地化」是同一件事 —— 用常驻自建筛选栏接管 Type/Language/Sort，
> 状态唯一来源 = `filterState`，进页时从 URL 参数初始化。

---

## 1. 需求清单

| # | 需求 | 性质 |
|---|---|---|
| R1 | 仓库显示顺序没有按照 sort 方式排序 | bug |
| R2 | 所有筛选项本地处理替代（Type、Language、Sort by） | 功能 |
| R3 | 筛选项动态收窄：只显示当前约束下仍有结果的可选值（tags 共现语义） | 功能 |
| R4 | Sort by 增加 Most Forks | 功能 |
| R5 | 排序方向切换（asc/desc）：与 Sort by 合并为一个按钮、竖线分隔、纯 icon、点击切换 | 功能（追加） |
| R6 | 进入页面时 Sort/方向 与 URL 参数匹配（如 `?direction=asc&sort=stars&tab=stars`） | 功能（追加） |

---

## 2. R1 根因分析（证据链）

### 2.1 主因：browse 态渲染与原生 Sort/URL 完全脱钩

数据流现状（4.0.x API 主模式）：

```
原生 Sort/Language/Type 菜单（browse 态可见）
  └─ 点击 → Turbo frame 导航，URL 变 ?sort=…&language=…&type=…（真机探测证实参数名）
  └─ frame-render → transformStarsList() 重建网格
       └─ applyFilters() → 无标签/搜索 → renderBrowsePage(1)
            └─ sortResults() 只看 filterState.sort   ← 问题所在
```

- `filterState.sort` 默认 `'stars'`（`src/state.ts`），**没有任何与原生菜单或 URL 的同步点**。
- `inheritNativeFilters()`（`src/filters.ts`）只在「首次进入自定义模式（标签/搜索激活）」时
  读一次按钮文案（`applyFilters()` 步骤 3 / `search.ts activateSearch()`），browse 态从不调用。
- 于是：用户在原生菜单选 "Recently starred" → URL 变 `sort=created`、按钮文案变、服务端 HTML 重排，
  但网格仍按 `filterState.sort='stars'` 渲染 —— **显示顺序与所选 sort 永远不一致**（除非恰好选 Most stars）。
- 真机证据：当前 URL `https://github.com/YsLtr?direction=desc&sort=created&tab=stars`、
  按钮文案「Sort by: Recently starred」，而网格实际按 stars 降序排。

### 2.2 次因

| # | 问题 | 影响 |
|---|---|---|
| A | 默认 `sort:'stars'` ≠ 原生默认 Recently starred（`sort=created`） | 用户没动菜单时顺序就与按钮显示不符 |
| B | `sortResults` 注释「沉底保到达序」不成立：`for (const repoId in cache)` 对整数型键按**数值升序**枚举（JS 对象属性序），缺 `starredAt` 的条目实际按 repoId（≈仓库创建序）排 | Recently starred 沉底段顺序错 |
| C | `created` 排序依赖 `starredAt` 回填，未跑过全量同步时全部沉底 | 看起来「没排序」（4.0.x 有 PAT 即自动同步，风险低） |

R1 修复 = 本设计 §4.5（全本地筛选栏）+ §4.6（URL 入口匹配）+ §4.3（排序键/方向/决胜），四个问题一并消除。

---

## 3. 调研证据

### 3.1 GitHub 原生筛选菜单（真机 DOM 探测，2026-09-23，tab `github.com/YsLtr?tab=stars`）

**Type**（URL 参数 `type=`）：All / Public(`public`) / Private(`private`) / Sources(`source`) /
Forks(`fork`) / **Can be sponsored(`sponsorable`)** / Mirrors(`mirror`) / Templates(`template`) —— 共 8 项。
（注意：Stars 页 Type **没有** Archived，与 Repositories 页不同。）

**Language**（`language=` slug）：All languages + 当前 star 集里出现过的语言（大小写混合显示名，
URL slug = 小写显示名，如 `jupyter+notebook`、`c%23`、`c%2B%2B`）。

**Sort by**（`sort=`）：Recently starred(`created`) / Recently active(`updated`) / Most stars(`stars`)，
方向参数 `direction=desc|desc`（实测 URL 常带 `direction=desc`；`asc` = 反向）。
**原生无 Most Forks**（R4 为本项目扩展项）。

### 3.2 Type 各项的数据可得性（REST `GET /user/starred` + `star+json` 内嵌完整 repo 对象）

| 选项 | 判定字段 | 可得性 |
|---|---|---|
| Public / Private | `private` / `visibility` | ✅ REST repo 对象 |
| Sources / Forks | `fork` | ✅ |
| Mirrors | `mirror_url != null` | ✅ |
| Templates | `is_template` | ✅ |
| Can be sponsored | **API 返回体无字段**（真机全树键扫描 sponsor 命中 0，见下）；判定仅 GraphQL owner 级 `hasSponsorsListing` | ❌ 已定案省略（D2） |

来源：https://docs.github.com/en/rest/repos/repos （repository object schema：`is_template`/`mirror_url`/`private`/`fork`/`visibility`）、
https://docs.github.com/zh/graphql/reference/sponsors （`hasSponsorsListing`）。

真机实证（2026-09-23，`GET /users/{u}/starred` + `Accept: application/vnd.github.star+json` 真实响应，与 fullSync 同端点形态）：全树 102 键递归扫描 **sponsor-like 键 = 0**（raw grep 亦 0）——返回数据里确实没有；Type 所需字段 `private`/`visibility`/`fork`/`is_template`/`mirror_url` 均在 `repo` 对象（实测值 `false`/`"public"`/`false`/`false`/`null`）。另实测条目形态 = `starred_at` + **`repo`**（文档写 `repository`），`parseItem` 的 `repository ?? repo ?? item` 三形态防御正为此设。

### 3.3 动态筛选项（faceted narrowing）模式调研

业界标准语义（Meilisearch disjunctive facets、yonik multi-select faceting、full-stack-search UX patterns）：

- **跨 facet 合取（AND）**：所有 facet 约束同时生效；
- **同 facet 多选**：加选值 = 在当前结果集内再交（共现收窄），已选值恒保留可取消；
- **同 facet 单选**：切换替换自身值，候选列表计算时**忽略自身当前值**（否则选完就只剩一项、无法直接切换）；
- 统一表述：**「一个选项可见 ⇔ 在当前约束下选择它（多选=加入，单选=替换）能得出 ≥1 条结果；已选值恒可见」**，
  零结果选项隐藏。这正是 R3 的 tags 共现示例的推广。

来源：https://yonik.com/blog/multi-select-faceting/ 、
https://www.full-stack-search.com/search-frontend-ux-patterns/faceted-navigation-filtering/ 、
https://meilisearch-6b28dec2.mintlify.app/capabilities/filtering_sorting_faceting/advanced/disjunctive_facets

**Verdict: Build — custom**（项目约束「无运行时依赖」，无库可引；语义按上述模式自建纯函数）。

---

## 4. 设计

### 4.1 状态模型（`src/state.ts` / `src/types.ts`）

```ts
export type SortKey = 'created' | 'updated' | 'stars' | 'forks';   // +'forks'
export type SortDirection = 'desc' | 'asc';
export type TypeFilter = '' | 'public' | 'private' | 'source' | 'fork' | 'mirror' | 'template';  // ''=All（见 D2）

interface FilterState {
  tags: string[];          // 多选 AND（不变）
  lang: string;            // ''=All（不变）
  type: TypeFilter;        // 新增
  sort: SortKey;           // 默认 'created'（← 原 'stars'，对齐原生默认 Recently starred，修次因 A）
  direction: SortDirection;// 新增，默认 'desc'
  searchQuery: string;
  page: number; totalPages: number;
  // tagMode / searchMode 退场：全本地后没有「模式切换」，只有 hasActiveFilter() 派生判断
}
```

`RepoData` 增 Type 标志（全可选，4.7 回补）：`private?: boolean; fork?: boolean; isTemplate?: boolean; mirror?: boolean`。

### 4.2 统一查询管线（`src/filters.ts` 重构核心）

现状三条高度重复的路径（`renderBrowsePage` / `getTagFilteredRepos` / `searchCacheRepos`）
收编为一个纯函数：

```ts
queryRepos(skip?: 'lang' | 'type'): FilteredRepo[]
// 逐条：type 约束 → lang 约束 → tags AND → search 全文 → sortResults(direction + 决胜)
```

- browse 态、标签筛选、搜索、facet 候选计算全部走它；`highlightMatchesInCard` 原样保留。
- `sortResults()` 入参化方向（不再隐式读全局亦可，读 `filterState` 亦可）。
- 每次筛选状态变化 = 重算结果集 + 重算各 facet 候选 + 重渲染（内存 500 条级过滤，毫秒级，无需缓存）。

### 4.3 排序（R1 修复 + R4 Most Forks）

| SortKey | 比较（desc 基准） | desc 语义 | asc 语义 |
|---|---|---|---|
| `created`（Recently starred） | `starredAt` 降序 | 最近 star 在前 | 最早 star 在前 |
| `updated`（Recently active） | `updatedAt` 降序 | 最近更新在前 | 最久未更新在前 |
| `stars`（Most stars） | `stars` 数值降序 | 最多在前 | 最少在前 |
| `forks`（**Most Forks，R4**） | `forks` 数值降序 | 最多在前 | 最少在前 |

规则：

1. `direction==='asc'` = 比较器取反（GitHub `direction` 同语义）。
2. **缺失值（无 starredAt/updatedAt/计数）恒沉底，不随方向翻转**。
3. **平局决胜 = `name.localeCompare`**，全确定性 —— 修次因 B
   （`for..in` 整数键升序 ≠ 「到达序」，注释同步更正）。
4. Sort 菜单项顺序：Recently starred / Recently active / Most stars / **Most Forks**（原生 3 项后追加，R4）。

### 4.4 动态筛选项（R3）

统一规则（§3.3）：**选项可见 ⇔ 当前约束下选择它结果 ≥1；已选值恒可见**。

各 facet 落地语义：

| Facet | 选择语义 | 候选计算 |
|---|---|---|
| Tags（多选 AND） | 加入/移出 AND 集 | 结果集（含全部当前约束）内出现的标签 ∪ 已选标签 —— 即共现收窄 |
| Language（单选） | 替换 | `queryRepos(skip:'lang')` 中出现的语言 ∪ 当前 lang |
| Type（单选） | 替换 | `queryRepos(skip:'type')` 中命中的 type 值 ∪ 当前 type |

R3 示例在规则下的表现（设无其他约束）：

| 状态 | Tags 可选项 | 说明 |
|---|---|---|
| 未选 | {a, b, c, …} | 全部（初始可选） |
| 选中 a（存在 a+b 共现，无 a+c） | {a, b} | b 共现保留；c 零结果隐藏 |
| 再选中 b | {a, b} | 已选恒可见 |

实现要点：

- 候选计算复用 `queryRepos(skip)`（现 `ignoreLang` 参数泛化）。
- **菜单内勾选/卡片 pill 点击后菜单内容原位重绘**（popover 保持打开）：
  把「菜单列表渲染」抽成独立函数（现 `renderTagFilterBar` 整体重建会把开着的 popover 拆掉，
  多选勾选场景必须原位更新）；单选点击即 `hidePopover()`，整体重建无碍。
- 选项排序：语言字母序（现状）；标签建议按命中数降序、平局字母序（计数为 queryRepos 副产品，零额外成本）。

### 4.5 UI：常驻本地筛选栏（R2 + R5）

filter row 布局（Tags 之后依次）：

```
[Tags ▾]  [Type ▾]  [Language ▾]  [[Sort by ▾ │ ↓]]   ← R5：方向 icon 与 Sort by 合并为一个按钮，只有一条竖线分隔
```

- **原生 Type/Language/Sort 三个 `action-menu` 永久隐藏**（`display:none`，不 remove ——
  `getNativeFilterRow()` 以 `#stars-language-filter-menu-button` 为锚点，保留节点防选择器失配）。
- 自建控件**常驻**（不再随「自定义模式」出现/消失）；`updateNativeFilters()` 的双态切换逻辑删除，
  重构为一次性接管；`inheritNativeFilters()` 删除（被 §4.6 URL 初始化取代）。
- 菜单结构沿用现有 Primer `Button + anchored-position + ActionList` 模式（Language/Sort 自建菜单已是现成模板）。
- **方向按钮（R5）**：与 [Sort by] **合并为一个按钮**（split button）：左段 = Sort by 标签 + 下三角（点击开菜单），
  右段 = **纯方向 icon**（octicon `arrow-down`/`arrow-up`，16px，新增 SVG 常量，**无文字**），中间**只有一条竖线分隔**；
  整组外观 = 一个 `Button--secondary` 按钮（Primer `BtnGroup` 或单按钮双点击区，实现取简）。
  点击右段即翻转 `filterState.direction` → 重渲染；title/aria-label「切换排序方向」。
  `asc` 时整组加 `has-active`（非默认值高亮，与现有惯例一致）。
- 信息条 `renderFilterInfoBar` 出现条件扩展：tags/lang/type/search 任一激活
  （sort/direction 属浏览状态，不算筛选、不进信息条）；desc 增 type 行。
- 「Clear filter」= 清 tags/lang/type/search，**保留 sort/direction**（见 D4）。
- 筛选态保持现状平铺不分页；browse 态本地分页不变（见 D5）。

### 4.6 URL 入口匹配（R6）

`initFiltersFromUrl()`：进页时解析 `location.search`，映射到 `filterState`：

| 参数 | 解析 | 缺省/非法 |
|---|---|---|
| `sort` | `created\|updated\|stars\|forks` → SortKey | `'created'` |
| `direction` | `asc` → `'asc'` | `'desc'` |
| `language` | URL 解码后小写 = 语言显示名小写（真机实测 slug 即小写显示名，`c#`/`c++`/`jupyter notebook` 均直接命中） | `''` |
| `type` | `public\|private\|source\|fork\|mirror\|template` | `''`（All） |
| `q` | 并入 `searchQuery`（沿用 `search.ts` 现有自动激活） | — |

触发与防覆盖：

1. 调用点 = `init()`（直载）与每次 transform 到达（Turbo 进入）前；
2. **仅当 `location.search` ≠ 上次解析时的 search 串才覆盖状态** —— 防 frame 重渲染、
   以及 `exitCustomMode()` 的 `pushState('?tab=stars')` 把用户本地选择冲掉
   （该 pushState 后把当前 search 串登记为「已解析」，且清筛选语义本就保留 sort/direction）;
3. **URL 永远只读不写**（用户定案 2026-09-23：仅为 URL 兼容，此后不管 URL，无双向写回、无后续计划）。

### 4.7 数据层扩展（Type 依赖）

| 位置 | 改动 |
|---|---|
| `fullSync.ts` `parseItem` | 增采 `private`/`fork`/`is_template`/`mirror_url` → 4 个 bool 标志 |
| `buildLocalSlices` | slice meta 同步带标志（304 页切片否则丢字段） |
| 交集 merge 回填 | 标志纳入「条件 patch」比较（沿 4.0.10 不覆盖好数据原则：解析不出不写） |
| 升级回补阀门 | 复用 4.0.8 阀门机制：缓存条目缺 Type 标志 → 判阀门失守 → 一次性无条件整表回补（升级后首扫全 200，同 4.0.8 先例） |
| `extract.ts` | 详情页顺带写已知标志（fail-closed：只写明确解析出的，如 `isArchived` 等现有字段同则） |
| `ui/cards.ts` | 可选：卡片角标显示 Private/Fork/Template/Mirror（提高 Type 筛选可信度，非必需） |

---

## 5. 受影响文件清单

| 文件 | 改动概要 | 量级 |
|---|---|---|
| `src/state.ts` | FilterState +`type`/`direction`，sort 默认 `'created'`，tagMode/searchMode 退场 | 小 |
| `src/types.ts` | `SortKey + 'forks'`、`SortDirection`/`TypeFilter`、`RepoData` +4 标志 | 小 |
| `src/filters.ts` | 核心：`queryRepos` 统一管线、`sortResults`（方向+决胜）、facet 候选计算、筛选栏接管重构（+方向按钮）、`initFiltersFromUrl`、信息条/`exitCustomMode` 扩展；删 `inheritNativeFilters`/双态 `updateNativeFilters` | 大 |
| `src/ui/tagFilter.ts` | 标签候选动态收窄 + 菜单原位重绘 | 中 |
| `src/search.ts` | 删 `inheritNativeFilters` 调用（URL 初始化接管） | 小 |
| `src/fullSync.ts` | parseItem/slices/merge 增标志 + 升级回补阀门 | 中 |
| `src/extract.ts` | 详情页补标志（可选） | 小 |
| `src/constants.ts` | `SORT_OPTIONS`/`TYPE_OPTIONS`、方向箭头 SVG | 小 |
| `src/index.ts` | init/transform 到达时调 `initFiltersFromUrl` | 小 |
| `src/styles/base.css` | 方向按钮微样式（复用 Button 结构则近零） | 小 |

---

## 6. 边界与风险

1. **Type「Can be sponsored」**：API 返回数据无字段（实证见 §3.2），**已定案省略**——本地 Type 7 项（原生 8 项去 Can be sponsored），维持 REST-only（D2）。
2. **`sort=forks` 非原生参数**：URL 只读不写（D3 已定案），仅作进页解析兜底——本地扩展值不进 URL，不存在服务端兼容风险。
3. **存量缓存缺 Type 标志**：未回补前 Type 筛选对旧条目失真——由 §4.7 阀门升级首扫一次性回补兜底；
   无 PAT 用户本就只有配置横幅、无浏览态，无暴露窗口。
4. **多选菜单原位重绘**是 R3 的隐性工作量：现 `renderTagFilterBar` 整体重建会关 popover，必须抽列表级重绘。
5. `direction` 对 `created` 的 asc = 最早 star 在前；缺失 `starredAt` 恒沉底（不翻转）——与 GitHub 服务端行为一致（服务端无缺失值问题，本地属增量回填期的过渡语义）。
6. 移动端（<768px）不转换、不注入，全程无影响（沿用现约束）。

---

## 7. 决策点（D2/D3/D6 已定案；D1/D4/D5 按推荐执行）

| # | 问题 | 推荐 |
|---|---|---|
| D1 | 单选 facet（Language/Type）候选是否忽略自身当前值 | **忽略**（可直接切换，faceted 惯例）；否则选完语言只剩一项、切语言要先清空 |
| D2 | Type「Can be sponsored」 | **已定案（2026-09-23）：省略**——API 返回体无字段实锤，维持 REST-only（D6a），本地 Type 7 项对齐原生 8 项 |
| D3 | URL 双向写回 | **已定案（2026-09-23）：不写，只读**——仅为 URL 兼容，此后不管 URL |
| D4 | 信息条 Clear filter 是否连 sort/direction 清 | **不清**（排序是浏览状态不是筛选） |
| D5 | 筛选态平铺 vs 统一分页 | **保持平铺**（现状；500 条级可接受） |
| D6 | 方向按钮形态 | **已定案（2026-09-23）：与 Sort by 合并为一个按钮，只有一条竖线分隔；右段纯 icon 无文字，点击切换方向** |

---

## 8. 实施分期与验证清单（实现阶段用）

- **4.1.0（A：R1+R4+R5+R6+R3 部分）**：统一查询管线 + 排序键/方向/决胜 + 方向按钮 + Most Forks + URL 入口匹配 + 常驻本地 Language/Sort（原生菜单隐藏）+ Tags 共现收窄。
- **4.2.0（B：R2 补全 + R3 补全）**：Type 数据层回补（parseItem/slices/merge/阀门）+ Type 菜单 + Language/Type 候选动态收窄 + 信息条扩展。

真机验证要点：

1. `?direction=asc&sort=stars&tab=stars` 进页：Sort 显示 Most stars、方向 icon 为 ↑、网格 stars 升序；
2. 裸 `?tab=stars` 进页：Recently starred + Desc、顺序 = starredAt 降序（与按钮一致 = R1 修复判据）；
3. 切 Most Forks：forks 降序；点方向 icon（合并按钮右段、竖线分隔、无文字）：升序、icon 变 ↑、整组高亮；
4. Tags 共现：选 a 后 b 保留、c 消失（R3 示例）；取消 a 恢复全量；菜单勾选过程 popover 不关闭；
5. Language/Type 候选随 tags/search 收窄，切换语言不必先清空（D1）；
6. 原生三个菜单不可见、原生 Clear filter 不出现；Clear filter 只清筛选不改排序；
7. 升级后首扫触发一次性整表回补（阀门日志），此后 Type 筛选对全量条目生效。
