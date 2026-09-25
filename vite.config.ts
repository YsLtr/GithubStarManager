import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/index.ts',
      userscript: {
        name: 'GithubStarManager',
        namespace: 'https://github.com/YsLtr',
        version: pkg.version,
        description:
          '将 GitHub Stars 页面的列表视图改为卡片网格视图，缩小左侧个人资料栏，最大化仓库展示空间（仅桌面端生效）',
        author: 'YsLtr',
        // 单条覆盖全站：必须包含纯 profile 根路径 /<user>（旧的 */* 要求两段路径，
        // 匹配不到 /YsLtr → 从 profile 点 Stars 标签时脚本根本没在跑）；
        // ?tab=stars 与仓库详情页也一并覆盖（TM 的 @match 把 query 计入 path）。
        match: ['https://github.com/*'],
        // 不靠 `$` 导入自动推断 grant(那会在 document-start 顶部捕获 GM_*),显式声明
        // （GM_registerMenuCommand: TM 菜单「设置 GitHub Token」入口）
        grant: ['GM_getValue', 'GM_setValue', 'GM_registerMenuCommand', 'GM_unregisterMenuCommand', 'GM_openInTab', 'GM_deleteValue', 'GM_xmlHttpRequest'],
        'run-at': 'document-start',
      },
      build: {
        fileName: 'github-star-manager.user.js',
      },
      server: {
        // dev 下代码跑在页面 realm，沙箱 GM_* 不可见（issue #35）；把已 grant 的 GM_* 复制到
        // unsafeWindow，让 gm.ts 调用时判定在 dev 与正式版一致走 GM 分支。仅影响 pnpm dev，
        // 构建产物不变。官方首选 `$` 导入，但其顶部捕获与 document-start 不兼容已禁用。
        mountGmApi: true,
      },
    }),
  ],
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
