import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';
import pkg from './package.json' with { type: 'json' };

/** 脚本名/产物名/包名的单一来源（4.6.0）：构建期注入 __SCRIPT_SLUG__，源码不重复写名字 */
const SCRIPT_SLUG = 'github-star-manager';
const SCRIPT_NAME = 'GithubStarManager';
export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/index.ts',
      userscript: {
        name: SCRIPT_NAME,
        namespace: 'https://github.com/YsLtr',
        version: pkg.version,
        description:
          '将 GitHub Stars 页面的列表视图改为卡片网格视图，缩小左侧个人资料栏，最大化仓库展示空间（仅桌面端生效；窄视口 <768px 下完全惰性，不注入样式、不改动页面）',
        author: 'YsLtr',
        // 单条覆盖全站：必须包含纯 profile 根路径 /<user>（旧的 */* 要求两段路径，
        // 匹配不到 /YsLtr → 从 profile 点 Stars 标签时脚本根本没在跑）；
        // ?tab=stars 与仓库详情页也一并覆盖（TM 的 @match 把 query 计入 path）。
        match: ['https://github.com/*'],
        // 不靠 `$` 导入自动推断 grant(那会在 document-start 顶部捕获 GM_*),显式声明
        // （GM_registerMenuCommand: TM 菜单「设置 GitHub Token」入口）
        // 4.9.1 精简为 5 项：TM 的能力徽标是按**声明的 @grant 数组**生成的（不做调用分析），
        // 所以「声明了却用别的通道实现」的授权同样会被算进用户看到的能力清单里 —— 要真变短就得删掉：
        // - GM_xmlhttpRequest  → 语言色改用原生 fetch（该域实测 CORS `*`，见 langColors.ts）
        // - GM_unregisterMenuCommand → 菜单标签改走 GM_registerMenuCommand 的 { id } 原地更新（TM 5.0+）
        // - GM_deleteValue     → 唯一用途是清理 4.0.10 的历史死键，该一次性清理已删除
        grant: ['GM_getValue', 'GM_setValue', 'GM_registerMenuCommand', 'GM_openInTab', 'GM_download'],
        'run-at': 'document-start',
      },
      build: {
        fileName: `${SCRIPT_SLUG}.user.js`,
      },
      server: {
        // dev 下代码跑在页面 realm，沙箱 GM_* 不可见（issue #35）；把已 grant 的 GM_* 复制到
        // unsafeWindow，让 gm.ts 调用时判定在 dev 与正式版一致走 GM 分支。仅影响 pnpm dev，
        // 构建产物不变。官方首选 `$` 导入，但其顶部捕获与 document-start 不兼容已禁用。
        mountGmApi: true,
      },
    }),
  ],
  // 构建期常量注入：源码里不重复写脚本名/产物名（改名只动上面的 SCRIPT_SLUG / SCRIPT_NAME）
  define: {
    __SCRIPT_SLUG__: JSON.stringify(SCRIPT_SLUG),
  },
  // 固定 dev server 端口：dev 模式装进 Tampermonkey 的加载器把入口 URL 写死了，
  // 端口漂移（5173 被占 → 5199/5201）会让已装的 dev 脚本静默失效。
  server: {
    port: 5173,
    strictPort: true,
    // Chrome 130–141 的 Private Network Access 预检要求这个响应头；
    // 142+ 改走 Local Network Access 权限提示（首次会弹窗，必须点允许）。
    headers: { 'Access-Control-Allow-Private-Network': 'true' },
  },
  build: {
    // 保持与手写脚本同等的浏览器兼容性：
    // esbuild 默认会按 modern baseline 把 `min-width` 压成 `(width>=768px)` 区间语法
    // （Safari 16.4+ 才支持），这里显式降低 css target 让它保留 `min-width`。
    target: 'es2020',
    cssTarget: ['chrome100', 'firefox100', 'safari15'],
  },
});
