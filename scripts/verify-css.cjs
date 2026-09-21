// 校验构建产物中的 CSS 与源 CSS 是否等价（只允许压缩/等价重写带来的差异）
const fs = require('fs');
const dist = fs.readFileSync('dist/github-stars-grid.user.js', 'utf8');

function grab(name) {
  const i = dist.indexOf('var ' + name + ' = "');
  if (i < 0) throw new Error('not found: ' + name);
  const start = dist.indexOf('"', i) + 1;
  let j = start;
  while (true) {
    if (dist[j] === '\\') { j += 2; continue; }
    if (dist[j] === '"') break;
    j++;
  }
  return JSON.parse(dist.slice(start - 1, j + 1));
}

const builtCss = grab('base_default') + '\n' + grab('wide_default');
const srcCss = fs.readFileSync('src/styles/base.css', 'utf8') + fs.readFileSync('src/styles/wide.css', 'utf8');

function rules(css) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const props = m[2].split(';').filter(Boolean).map(s => s.split(':')[0].trim().toLowerCase()).sort();
    out.push(m[1].trim() + ' -> ' + props.join(','));
  }
  return out;
}

const a = rules(srcCss), b = rules(builtCss);
console.log('rules: src', a.length, '| built', b.length);
const setA = new Set(a), setB = new Set(b);
const onlySrc = a.filter(x => !setB.has(x));
const onlyBuilt = b.filter(x => !setA.has(x));
console.log('only in src:', onlySrc.length);
onlySrc.forEach(x => console.log('  -', x));
console.log('only in built:', onlyBuilt.length);
onlyBuilt.forEach(x => console.log('  +', x));
