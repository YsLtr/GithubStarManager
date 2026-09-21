import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/index.ts',
      userscript: {
        name: 'GitHub Stars Grid View',
        namespace: 'https://github.com/YsLtr',
        version: pkg.version,
        description:
          '将 GitHub Stars 页面的列表视图改为卡片网格视图，缩小左侧个人资料栏，最大化仓库展示空间（仅桌面端生效）',
        author: 'YsLtr',
        match: ['https://github.com/*tab=stars*', 'https://github.com/*/*'],
        'run-at': 'document-idle',
        // @grant 由插件根据代码里实际用到的 GM API 自动收集
      },
      build: {
        fileName: 'github-stars-grid.user.js',
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
