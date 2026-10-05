// 把 storage/exportImport 及其依赖编译成可被 node 直接 require 的 CommonJS（.cjs），
// 供 run.cjs 在无浏览器环境下验证合并语义。产物在 tests/exportImport/.build/（已 gitignore）。
//
// 为什么要这一步：项目是 `"type": "module"`，tsc 产出的 .js 会被 node 当成 ESM，
// 而 tsc 的 commonjs 输出用 exports/require → 必须改扩展名为 .cjs 并补齐 require 的扩展名。
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '../..');
const srcDir = path.join(root, 'src');
const tmp = path.join(__dirname, '.tmp');
const out = path.join(__dirname, '.build');

// 只编译被测模块及其依赖闭包（避免把整个 src 拉进来，也避免 index.ts 的 DOM 依赖）
const FILES = [
  'constants.ts',
  'gm.ts',
  'types.ts',
  'storage/exportImport.ts',
  'storage/notes.ts',
  'storage/pendingDelete.ts',
  'storage/repoCache.ts',
  'storage/tags.ts',
  // 注意：本清单是「依赖闭包」的显式副本，被测模块新增 import 时必须同步补进来
  // 4.12.0：标签/备注的隔离 id 改由 pageScope 提供（登录者 octolytics-actor-id），
  // 于是 pageScope 及其依赖 boot → utils 也进了被测闭包。
  'pageScope.ts',
  'boot.ts',
  'utils.ts',
];

fs.rmSync(tmp, { recursive: true, force: true });
fs.rmSync(out, { recursive: true, force: true });
for (const rel of FILES) {
  const dst = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(srcDir, rel), dst);
}

fs.writeFileSync(
  path.join(tmp, 'tsconfig.json'),
  JSON.stringify(
    {
      compilerOptions: {
        target: 'es2020',
        module: 'commonjs',
        moduleResolution: 'bundler',
        skipLibCheck: true,
        strict: false,
        outDir: out,
      },
      include: ['**/*.ts'],
    },
    null,
    2
  )
);

// 用项目自带的 typescript（npx tsc 解析到本地 devDependency）。
// 容错：被测源码在「无 vite define / 更严类型检查」下会有与本次验证无关的类型噪音
//（如 __SCRIPT_SLUG__ 未声明、Partial<RepoData> 合并），只要求能产出 JS —— 真正的类型门是 `pnpm check`。
try {
  execFileSync('npx', ['tsc', '-p', tmp], { cwd: root, stdio: 'inherit', shell: true });
} catch {
  console.warn('prepare: tsc 报错但已产出 JS，继续（类型门由 pnpm check 负责）');
}

// .js → .cjs，并把 require 的相对路径补上 .cjs（ESM 包下的 CJS 互引要求显式扩展名）
for (const rel of FILES) {
  const jsPath = path.join(out, rel.replace(/\.ts$/, '.js'));
  const cjsPath = jsPath.replace(/\.js$/, '.cjs');
  let code = fs.readFileSync(jsPath, 'utf8');
  // vite 的 define 注入在 node 下不存在：给出与产物一致的默认值
  code = code.replace(/__SCRIPT_SLUG__/g, 'globalThis.__SCRIPT_SLUG__ || "github-star-manager"');
  code = code.replace(/require\("(\.[^"]+)"\)/g, 'require("$1.cjs")');
  fs.writeFileSync(cjsPath, code);
  fs.rmSync(jsPath);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('prepare: 编译完成 →', path.relative(root, out));
