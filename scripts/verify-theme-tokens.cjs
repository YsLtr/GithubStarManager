#!/usr/bin/env node
/**
 * 静态守卫（4.19.3，issue #1）：内联 UI 的配色**只能从页面取**，不许自己写。
 *
 * 背景：`ui/restoreMenu.ts` / `ui/exportImportMenu.ts` 的样式是全内联的（TM 菜单能在任意
 * github.com 页面打开，用不上只有 Stars 视图才注入的样式表）。它们此前写成
 * `var(--color-canvas-default, #fff)`：GitHub 已把这代变量整体改名成
 * `--bgColor-*` / `--fgColor-*` / `--borderColor-*`，旧名在 `:root` 上取不到值 ⇒ `var()`
 * 直接命中硬编码浅色兜底 ⇒ 暗色主题下弹窗仍是白底白字（issue #1 的现象）。
 *
 * 因此规则有两条（都静态可判）：
 *   1. 源码里不许出现**已删除的旧一代变量** `--color-(canvas|fg|border|btn|...)`；
 *   2. `src/ui/` 里不许出现**颜色字面量**（`#fff` / `rgb(...)` / `hsl(...)` 等）——
 *      颜色必须由 `resolveUiTheme()` 从当前页面现场解析。
 *
 * 白名单只有两处：`ui/theme.ts` 本身（它是解析器，需要读 token 名与采样选择器），
 * 以及 `styles/*.css`（样式表本来就只在 Stars 视图注入，走 CSS 变量，另由 `verify-css` 管）。
 *
 * 用法：`node scripts/verify-theme-tokens.cjs`（违例时 exit 1 并列出文件:行:内容）
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

/**
 * 旧一代 `--color-*` 变量：**默认禁止，白名单放行**。
 *
 * 之前是名单式枚举（canvas|fg|border|btn|…），评审用构造用例证明这条路必然漏 ——
 * 名单里没有 `topic-tag` / `diff-blob` / `select-menu` / `state` / `markdown` / `label` /
 * `pr-state` / `avatar` / `alert` / `counter` / `tabnav`，于是 issue #1 的原始写法
 * `var(--color-topic-tag-bg)` 能原样过闸。枚举永远追不上 GitHub 的分组名。
 *
 * 改成默认拒绝后，唯一要维护的是「仍然存在、且**不是**弹窗配色那一代」的允许名单：
 * 真机实测 `:root` 上还活着 62 个 `--color-*`，全部落在下面这几组（ansi / prettylights /
 * marketing / project / workflow-card / notifications-row / …），没有一个能用来给面板上色，
 * 所以我们自己也不该用。GitHub 再删一批时，这条规则不需要跟着改。
 */
const LEGACY_ALLOW_RE =
  /^--color-(?:ansi-|prettylights-|marketing-|mktg-|project-|workflow-card-|notifications-row-|bg-discussions-row-|text-white$|user-mention-|diff-blob-selected-line-highlight-)/;
/** 单行里的一个 `--color-*` 变量引用（到名字结束为止） */
const COLOR_VAR_RE = /--color-[A-Za-z0-9-]+/g;

/** 这一行里是否引用了「旧一代」的 `--color-*` 变量（白名单之外的都算） */
function findLegacyTokens(line) {
  const hits = line.match(COLOR_VAR_RE);
  if (!hits) return [];
  return hits.filter((name) => !LEGACY_ALLOW_RE.test(name));
}
/**
 * 颜色字面量：十六进制 / rgb() / hsl() / 具名色。
 * 十六进制按 CSS 合法的四档长度收：3 / 4（带 alpha）/ 6 / 8（带 alpha）。只写 `{3}{3}?` 会漏掉
 * `#0000` / `#fff8` 这类**四位数带 alpha** 的写法。`#${` 也算（运行期拼出来的十六进制同样是
 * 「自己写的颜色」）。
 * 具名色只收**明确无歧义**的那批 —— `gray` / `grey` 故意不在里面：它们会误伤
 * `--color-marketing-gray-1` 这类仍在用的 token。`whiteSpace` / `blacklist` 因词边界天然不命中。
 */
const COLOR_LITERAL_RE =
  /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|#\$\{|\brgba?\(|\bhsla?\(|\b(?:white|black|silver|red|blue|green|yellow|orange|purple|pink|brown|cyan|magenta|navy|teal|olive|maroon|lime|aqua|fuchsia|crimson|gold|tan|beige|ivory|khaki|coral|salmon|plum|orchid|indigo|violet|azure|linen|snow|tomato)\b/;
/** 检查颜色字面量的范围：内联样式层 */
const INLINE_UI_DIRS = [path.join('src', 'ui')];
/** 豁免：解析器自身（它只读页面，不写颜色） */
const WHITELIST_FILES = new Set([path.join('src', 'ui', 'theme.ts')]);

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    // 收全部会被打进产物的源码后缀：漏一个后缀就是一片盲区
    else if (/\.(ts|tsx|js|jsx|mjs|cjs|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** 整行注释（`//` / `/*` / `*` 开头）跳过：旧名与色值在文档里出现是允许的 */
function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('/*') || t.startsWith('*');
}

/**
 * 去掉行尾 `//` 注释 —— **只在字符串字面量之外**。
 *
 * 两个都要防：
 *   - 不剥注释 ⇒ `// see issue #123` 的 `#123` 被当成 3 位 hex（假阳性）；
 *   - 用正则粗暴 `split('//')` ⇒ `const s = 'a // b --color-canvas-default'` 里字符串后半
 *     被切掉，旧变量引用检测不到（假阴性），而 `'https://…'` 也会被误切。
 *
 * 所以按字符走一遍，记住当前是否在 `'` / `"` / `` ` `` 里（含反斜杠转义）。
 */
function stripTrailingComment(line) {
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '/' && line[i + 1] === '/') return line.slice(0, i);
  }
  return line;
}

const allTs = walk(path.join(ROOT, 'src'), []);
const problems = [];

for (const file of allTs) {
  const rel = path.relative(ROOT, file);
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const inlineUi = INLINE_UI_DIRS.some((d) => rel.startsWith(d + path.sep));
  const whitelisted = WHITELIST_FILES.has(rel);

  lines.forEach((line, i) => {
    if (isCommentLine(line)) return;
    // 字符串里的 ` // ` 不算注释，所以这一步对两种检查都安全（不再需要「原文 vs 剥注释」两套）
    const codeLine = stripTrailingComment(line);
    const legacy = findLegacyTokens(codeLine);
    if (legacy.length > 0) {
      problems.push(`${rel}:${i + 1}: 旧一代变量 ${legacy.join(' ')} —— ${line.trim()}`);
      return;
    }
    // 自定义属性**名**是标识符不是颜色值：先剔掉再查字面量
    const code = codeLine.replace(/--[a-zA-Z][\w-]*/g, '');
    // 颜色字面量只在**内联样式层**禁止；`styles/*.css` 是样式表（阴影等仍可用 rgba）
    if (inlineUi && !whitelisted && COLOR_LITERAL_RE.test(code)) {
      problems.push(`${rel}:${i + 1}: 内联 UI 里出现颜色字面量 —— ${line.trim()}`);
    }
  });
}

if (problems.length > 0) {
  console.error('✗ 内联 UI 配色违规（issue #1 的根因就是这样写出来的）:');
  for (const p of problems) console.error('  ' + p);
  console.error('\n颜色必须由 `src/ui/theme.ts` 的 `resolveUiTheme()` 从当前页面现场解析：');
  console.error('token（`--bgColor-*` / `--fgColor-*` / `--borderColor-*` / `--button-*-*`）优先，');
  console.error('其次采样 GitHub 原生节点，都取不到就**不写**该属性（注意：`background` 不可继承，');
  console.error('留空是「透明」而不是「跟随页面」），不要写死颜色。');
  process.exit(1);
}

console.log(`✓ 内联 UI 配色检查通过（${allTs.length} 个 .ts/.css，无旧变量、无颜色字面量）`);
