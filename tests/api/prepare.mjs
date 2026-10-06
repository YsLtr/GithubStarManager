import { build } from 'vite';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
await build({ root, configFile: false, logLevel: 'warn', define: { __SCRIPT_SLUG__: JSON.stringify('github-star-manager') },
  build: { outDir: 'tests/api/.build', emptyOutDir: true, minify: false,
    lib: { entry: 'tests/api/entry.ts', formats: ['cjs'], fileName: () => 'api.cjs' } } });
