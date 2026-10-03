// 校验构建产物中的 CSS 与源 CSS 是否等价（只允许压缩/等价重写带来的差异）。
//
// 4.13.0 重写，两个原因：
//   1) **抽取不再依赖打包器变量名**。原脚本只用 `var base_default = "..."` 定位，而 4.13.0 把 CSS
//      导入从 index.ts 挪到 layoutStyles.ts 后，`baseCss + '\n' + wideCss` 被常量折叠成直接传给
//      `gmAddStyle("...")` 的字面量 —— 变量名消失，脚本直接 `not found: base_default`。
//      现在走两条抽取路径：`gmAddStyle("...")` 的直接字面量实参 + `X_default` 变量。
//   2) **原脚本永远不会失败**（只打印差异、不设退出码），且比较前没抹平「源码有注释换行 / 产物压缩过」
//      与「压缩器会合并同选择器规则、把 `from` 写成 `0%`、剥掉属性选择器的引号」这些形变
//      ⇒ 每次打印一堆差异却 EXIT 0，等于没有校验。现在归一化后**按选择器聚合属性名集合**比较，差异即失败。
//
// 比对范围是**四张表**（含 persistent：它也是产物里发出去的 CSS），并断言关键标记都在 ——
// 避免「抽到的更少 ⇒ 差异更少 ⇒ 假绿」。
const fs = require('fs');
const dist = fs.readFileSync('dist/github-star-manager.user.js', 'utf8');

/** 从 start 处的 `"` 开始读一个 JS 双引号字符串字面量（处理反斜杠转义） */
function readLiteral(start) {
  let j = start + 1;
  while (true) {
    if (dist[j] === '\\') { j += 2; continue; }
    if (dist[j] === '"') break;
    j++;
  }
  return JSON.parse(dist.slice(start, j + 1));
}

/** 抽取所有 `gmAddStyle("...")` 的直接字面量实参（主表 base+wide 走这条） */
function grabGmAddStyleLits() {
  const out = [];
  const re = /gmAddStyle\(\s*"/g;
  let m;
  while ((m = re.exec(dist))) out.push(readLiteral(m.index + m[0].length - 1));
  return out;
}

/** 抽取 `var|let|const X_default = "..."`（persistent / readonly 走这条） */
function grabDefaultVars() {
  const out = [];
  const re = /(?:var|let|const) ([A-Za-z_$][\w$]*_default) = "/g;
  let m;
  while ((m = re.exec(dist))) out.push(readLiteral(m.index + m[0].length - 1));
  return out;
}

const pieces = [...grabGmAddStyleLits(), ...grabDefaultVars()];
if (pieces.length === 0) throw new Error('产物里没抽到任何 CSS 字面量');
const builtCss = pieces.join('\n');

const SOURCES = ['base.css', 'wide.css', 'persistent.css', 'readonly.css'];
const srcCss = SOURCES.map((f) => fs.readFileSync('src/styles/' + f, 'utf8')).join('\n');

/** 归一化：源码有注释与换行，产物被压缩过 —— 比较前先抹平这两层差异 */
function normalize(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * 选择器归一化：压缩器会剥掉属性选择器里的引号（`[href*="avatars"]` → `[href*=avatars]`）、
 * 抹掉多余空格，选择器分组的顺序也可能变。等价性只看「一组选择器」，所以剥引号、压空白、
 * 把分组拆开排序后重新拼。
 */
/** 压缩器的选择器形变（都是等价写法，逐条实测过产物）：剥属性选择器引号、去掉组合符两侧空格、
 *  `::before` 写成 `:before`、关键帧步进 `from/to` 写成 `0%/100%`。 */
function normalizeOneSelector(sel) {
  return sel
    .replace(/\[([^\]]*?)=["']([^"']*)["']\]/g, '[$1=$2]')
    .replace(/\s*([>+~])\s*/g, '$1')
    .replace(/::(before|after|first-line|first-letter|placeholder|selection|backdrop|marker)\b/g, ':$1')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^(from|to)$/, (m) => (m === 'from' ? '0%' : '100%'));
}

function splitSelectors(sel) {
  return sel.split(',').map(normalizeOneSelector).filter(Boolean);
}

/** 简写属性与其展开形式等价：压缩器会把 top/right/bottom/left 四条合并成 `inset`。 */
const PROP_ALIASES = { inset: ['top', 'right', 'bottom', 'left'] };

/**
 * 规则表：`归一化选择器 -> 该选择器身上出现过的属性名集合`。
 *
 * 为什么按**选择器聚合**而不是逐条规则比对：压缩器会把同选择器的多条规则合并
 * （`.Layout-sidebar{width;min-width}` + `.Layout-sidebar{display}` → 一条）。
 * 逐条比会因此产生一堆假差异；语义等价性只取决于「这个选择器最终有没有这些属性」。
 */
function ruleTable(css) {
  const table = new Map();
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(normalize(css)))) {
    const props = m[2]
      .split(';')
      // 压缩器会给需要的前缀补 `-webkit-` 版本；前缀与否不是我们关心的等价性维度。
      .map((x) => x.split(':')[0].trim().toLowerCase().replace(/^-(webkit|moz|ms|o)-/, ''))
      // 必须在**映射之后**过滤空串：源码里 `prop: v;\n  }` 会切出一个纯空白片段
      // （压缩产物没有它），留着就与产物对不上、整份比较变成「全部 missing」的假红。
      .filter(Boolean);
    // 关键：把选择器分组**拆成单个选择器**再聚合。压缩器会把声明相同的规则合并成
    // 一个分组（`A,B{display:none}`），按分组比对会把源码里分开写的 A、B 判成「缺失整条规则」。
    for (const sel of splitSelectors(m[1])) {
      if (!table.has(sel)) table.set(sel, new Set());
      for (const p of props) {
        // 简写**替换**为其展开形式（而不是两者都留）：`inset` 与 top/right/bottom/left 是同一件事，
        // 若把 `inset` 也留下，产物侧就会多出一个源码侧没有的属性名。
        for (const q of PROP_ALIASES[p] || [p]) table.get(sel).add(q);
      }
    }
  }
  return table;
}

// 抽取退化的哨兵：各来自一张表；少任何一条都说明抽取或打包出了问题，此时比较没有意义。
for (const marker of ['--Layout-sidebar-width', 'stars-grid-card', '.stars-right-sidebar', 'gsm-ro-tags']) {
  if (builtCss.indexOf(marker) < 0) throw new Error('产物 CSS 缺少关键标记: ' + marker);
}

const srcTable = ruleTable(srcCss);
const builtTable = ruleTable(builtCss);
console.log('selectors: src', srcTable.size, '| built', builtTable.size);

let bad = 0;
for (const [sel, props] of srcTable) {
  const got = builtTable.get(sel);
  if (!got) { console.log('  - 缺失整条规则:', sel); bad++; continue; }
  const miss = [...props].filter((p) => !got.has(p));
  if (miss.length) { console.log('  - 缺属性:', sel, '->', miss.join(',')); bad++; }
}
for (const [sel, props] of builtTable) {
  const src = srcTable.get(sel);
  if (!src) { console.log('  + 产物多出规则:', sel); bad++; continue; }
  const extra = [...props].filter((p) => !src.has(p));
  if (extra.length) { console.log('  + 产物多出属性:', sel, '->', extra.join(',')); bad++; }
}
console.log(bad === 0 ? 'CSS 等价性: OK' : 'CSS 等价性: 发现 ' + bad + ' 处差异');
process.exitCode = bad === 0 ? 0 : 1;
