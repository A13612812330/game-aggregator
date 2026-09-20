/* 反证（_ 前缀 = 草稿）：把「同款聚拢」打坏，tools/test-v1025-search.js 的断言必须变红。
 *
 * 为什么必须做：断言全绿也可能是**假绿** —— 护栏写歪了、或者根本没走到被守护的分支时，
 * 它照样打印 ✅。判据只有一个：把被守护的行为**故意打坏**，对应断言必须变红。
 *
 * 打坏点：smRows() 里 `smGroup(arr).map(...)` → `arr.map(smRow)`（退回 v10.24 的平铺）。
 * 预期变红的断言：A 同一款只占一行 / B 条目守恒 / B 有 2 组挂 chip / D chip 占版面 / D 点得动。
 * 预期**仍绿**的：C 修改器组不聚合（它本来就没走聚合）、E 无溢出。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const F = path.join(__dirname, '..', 'public', 'index.html');
const GOOD = "  return smGroup(arr).map((g) => smRow(g.main) + smAltHtml(g)).join('');";
const BAD = "  return arr.map(smRow).join('');";

const orig = fs.readFileSync(F, 'utf8');
if (orig.indexOf(GOOD) < 0) { console.error('\u274c 锚点没找到 —— 反证无效（代码变了？）'); process.exit(2); }

let out = '';
try {
  fs.writeFileSync(F, orig.replace(GOOD, BAD));
  console.log('\u25b6 已打坏 smRows()：退回「list.map(smRow)」平铺，不做聚拢\n');
  try {
    out = execFileSync(process.execPath, [path.join(__dirname, 'test-v1025-search.js')], { encoding: 'utf8', timeout: 300000 });
  } catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
} finally {
  fs.writeFileSync(F, orig);
  console.log('\u25c0 已还原 index.html');
}

const lines = out.split('\n');
const fails = lines.filter((l) => l.indexOf('\u274c') >= 0);
const sum = lines.find((l) => l.indexOf('\u2500\u2500 ①') >= 0) || '';
console.log('\n打坏后失败的断言：');
fails.forEach((l) => console.log('   ' + l.trim()));
console.log(sum.trim());

const need = ['A 同一款只占一行', 'B 条目守恒 + 确有聚拢', 'D chip 真占版面', 'C 「艾尔登法环」在主行里只出现 1 次'];
const missed = need.filter((n) => !fails.some((l) => l.indexOf(n) >= 0));
if (missed.length) {
  console.log('\n\u274c 反证不充分 —— 这些断言打坏后**没变红**（假绿）：' + missed.join('、'));
  process.exit(1);
}
console.log('\n\u2705 反证成立：打坏 ' + GOOD.slice(9, 40) + '… 后，' + fails.length + ' 条断言变红。');
