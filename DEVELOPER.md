# GitHub Stars Grid View — 开发者文档

## 1. 项目概述

**GitHub Stars Grid View** 是一个 Tampermonkey 用户脚本，将 GitHub 个人主页的 Stars 标签页从默认的列表视图改为卡片网格视图，同时缩小左侧个人资料栏以最大化仓库展示空间。

- **运行环境**: Tampermonkey / Greasemonkey 等用户脚本管理器
- **匹配页面**:
  - `https://github.com/*?tab=stars*` — Stars 列表页（主功能）
  - `https://github.com/*/*` — 仓库详情页（数据缓存）
- **生效条件**: 仅桌面端（视口宽度 >= 768px）

## 2. 架构总览

脚本采用单 IIFE 结构，内部分为 11 个逻辑分区：

| 分区 | 名称 | 功能 | 行号范围 |
|------|------|------|----------|
| 0 | Constants | 全局常量集中声明（`MOBILE_BREAKPOINT`、`WIDE_BREAKPOINT`、SVG 图标等） | 18-32 |
| 1 | Utilities | `escapeHtml`, `isDesktop` | 34-46 |
| 2 | Storage — Repo Cache | 仓库缓存 CRUD | 48-68 |
| 3 | Storage — Pending Delete | 待删除区（unstar/restar 宽限期，含标签和备注备份） | 70-121 |
| 4 | Storage — Tags | 标签存储 + 备注存储 + 迁移 + 聚合查询 | 123-172 |
| 5 | Data Extraction | DOM 数据提取并写入缓存 | 174-338 |
| 6 | Styles | CSS 注入（`injectStyles()` 函数），含三栏响应式布局（768px / 1200px 双断点） | 340-749 |
| 7 | Cards & Star Buttons | 卡片构建 + 星星按钮 + 共享 helper | 751-960 |
| 8 | Tag UI | 标签筛选栏 + 筛选逻辑 + 标签渲染 + 备注渲染 | 962-1225 |
| 9 | DOM Transform | `transformStarsList` 主函数 | 1227-1360 |
| 10 | Init & Events | 页面检测 + 初始化 + 事件绑定 | 1362-1415 |

### 分区注释风格

```js
/* ================================================================
 *  SECTION N: SECTION NAME
 * ================================================================ */
```

## 3. 数据流

```
GitHub DOM
    │
    ├─ 仓库详情页 ──► extractAndCacheRepoFromDetailPage() ──► GM_setValue (stars_repo_cache)
    │
    └─ Stars 列表页
         │
         ├─ DOM 列表项 ──► extractAndCacheRepoFromCard() ──► GM_setValue (stars_repo_cache)
         │
         ├─ DOM 列表项 ──► transformStarsList() ──► 卡片网格 DOM
         │                                              │
         │                                              ├─ createStarButton() ──► 星星按钮
         │                                              └─ renderTags() ──► 标签 pill
         │
         └─ 标签筛选（跨页）
              │
              ├─ loadAllTags() ──► 匹配的 repoId 列表
              └─ getRepoData() ──► buildCardFromCache() ──► 缓存卡片 DOM
                                                              │
                                                              ├─ createStarButtonForCached()
                                                              └─ renderTags()
```

## 4. 存储模型

脚本使用 `GM_setValue` / `GM_getValue` 持久化三类数据：

### `stars_repo_cache`

仓库元数据缓存，所有用户共享。

```jsonc
{
  "123456": {               // repoId (GitHub 仓库数字 ID)
    "name": "owner/repo",   // 仓库全名
    "desc": "...",           // 描述
    "lang": "TypeScript",   // 主语言
    "langColor": "#3178c6", // 语言色块颜色
    "stars": 1234,          // star 数
    "forks": 56,            // fork 数
    "updated": "Updated 3 days ago",  // 最后更新文本
    "ts": 1708000000000     // 缓存时间戳
  }
}
```

### `stars_pending_delete`

待删除区，存放已 unstar 但处于宽限期的仓库数据。

```jsonc
{
  "123456": {
    // ... 与 repo cache 相同的字段
    "unstarredAt": 1708000000000,  // unstar 时间戳
    "_tags": ["tag1", "tag2"],     // 备份的标签
    "_note": "备注文本"             // 备份的备注
  }
}
```

### `stars_tags_<userId>`

每用户标签数据，按 GitHub 用户 ID 隔离。

```jsonc
{
  "123456": ["frontend", "tool"],    // repoId → 标签数组
  "789012": ["backend"]
}
```

> 历史遗留：旧版使用 `stars_tags`（无用户隔离），`migrateTagsIfNeeded()` 负责迁移。

### `stars_notes_<userId>`

每用户备注数据，按 GitHub 用户 ID 隔离。

```jsonc
{
  "123456": "这是一条备注",    // repoId → 备注文本
  "789012": "另一条备注"
}
```

## 5. 核心机制

### 待删除区宽限期

当用户 unstar 一个仓库时，数据不会立即删除，而是移入 `stars_pending_delete` 并记录 `unstarredAt` 时间戳。如果用户在 24 小时内重新 star，数据、标签和备注会自动恢复。超过 24 小时的条目在下次脚本加载时由 `cleanupExpiredUnstarred()` 清理。

### 每用户标签隔离

标签存储键包含用户 ID（`stars_tags_<userId>`），因此同一浏览器下不同 GitHub 账号的标签互不干扰。备注存储同理（`stars_notes_<userId>`）。

### 缓存卡片跨页筛选

标签筛选时，当前页卡片通过 CSS class 显隐控制。其他页面的匹配仓库从 `stars_repo_cache` 读取数据，通过 `buildCardFromCache()` 构建临时卡片插入网格。这些缓存卡片使用 `stars-grid-card-cached` class 标记，在筛选条件变化时先全部移除再重建。

### 详情页数据缓存

用户访问仓库详情页时，脚本提取仓库元数据（描述、语言、star/fork 数等）写入缓存。这使得即使用户从未在 Stars 页面浏览过该仓库，跨页筛选时也能显示完整卡片。

### 星星按钮双模式

- **当前页卡片** (`createStarButton`): 直接使用原始 DOM 中的 star/unstar 表单提交 CSRF token
- **缓存卡片** (`createStarButtonForCached`): 先 fetch 仓库详情页获取有效 CSRF token，再提交

两者共享 `createStarButtonElement` (按钮创建) 和 `toggleStarButtonState` (状态切换) helper 函数。

## 6. 功能扩展指南

### 添加新的卡片字段

1. **Section 5** (`extractAndCacheRepoFromDetailPage` / `extractAndCacheRepoFromCard`): 从 DOM 提取新字段并加入 `saveRepoData` 调用
2. **Section 7** (`buildCardFromCache`): 在卡片 HTML 中渲染新字段
3. **Section 9** (`transformStarsList`): 在当前页卡片构建逻辑中渲染新字段

### 添加新的筛选条件

1. **Section 10**: 声明新的筛选状态变量
2. **Section 8**: 在 `renderTagFilterBar` 中添加筛选 UI，在 `applyTagFilter` 中添加筛选逻辑

### 添加新的存储键

1. **Section 2/3/4**: 添加对应的 load/save 函数
2. 如需迁移，参考 `migrateTagsIfNeeded` 实现

### 添加新的 CSS 样式

1. **Section 6** (`injectStyles` 函数内): 在 `@media` 块内添加新规则

### 添加新的 SVG 图标常量

1. **Section 0**: 声明新的 `const` 常量
2. 在需要的分区中引用

## 7. 约束

- **单文件**: 整个脚本必须保持在一个 `.user.js` 文件中（用户脚本规范限制）
- **无构建系统**: 不使用 bundler、transpiler 或任何构建工具
- **仅桌面端**: 所有 CSS 包裹在 `@media (min-width: 768px)` 中，`transformStarsList` 首先检查 `isDesktop()`
- **三栏响应式布局**: 768px ~ 1199px 隐藏左右侧边栏仅显示主内容区；≥ 1200px 显示左侧资料栏 (180px) + 中间卡片网格 + 右侧 Starred Topics (220px)
- **无外部依赖**: 不引入任何第三方库，仅使用浏览器原生 API + Tampermonkey API (`GM_addStyle`, `GM_setValue`, `GM_getValue`)
- **变量作用域**: 所有代码包裹在 IIFE 中，`function` 声明在 IIFE 内提升至作用域顶部，`const`/`let` 按声明顺序初始化（Section 0 的 `const` 最先，Section 10 的 `let activeFilterTags` 在函数调用前）
