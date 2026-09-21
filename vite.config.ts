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
  build: {
    // 保持与手写脚本同等的浏览器兼容性：
    // esbuild 默认会按 modern baseline 把 `min-width` 压成 `(width>=768px)` 区间语法
    // （Safari 16.4+ 才支持），这里显式降低 css target 让它保留 `min-width`。
    target: 'es2020',
    cssTarget: ['chrome100', 'firefox100', 'safari15'],
  },
});
