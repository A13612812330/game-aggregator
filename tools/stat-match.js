/* 统计：接入 cn-names.json 别名后，实测库→本地库的匹配率变化 */
const path = require('path');
const fs = require('fs');
const pc = require('../data/phonecfg.js');

const idx = pc.ensure();
const games = idx.games || [];
const records = idx.records || [];

let hit = 0, miss = 0;
const misses = [];
for (const g of games) {
  const it = pc.libMatch(g.title || g.k || '');
  if (it) hit++; else { miss++; if (misses.length < 20) misses.push(g.title || g.k); }
}
const total = hit + miss;
console.log(`实测库游戏数 ${total}`);
console.log(`命中本地库 ${hit}  (${(hit / total * 100).toFixed(1)}%)`);
console.log(`未命中     ${miss}  (${(miss / total * 100).toFixed(1)}%)`);

const cn = path.join(__dirname, '..', 'data', 'cn-names.json');
if (fs.existsSync(cn)) {
  const j = JSON.parse(fs.readFileSync(cn, 'utf8'));
  console.log(`\n已加载别名表：${Object.keys(j.aliases || {}).length} 条（learnedFrom ${j.__meta?.learnedFrom}，拒收 ${j.__meta?.rejected}）`);
  // 抽查几条学到的名字是否真的能命中
  let ok = 0, bad = 0;
  for (const [src, alts] of Object.entries(j.aliases || {})) {
    const it = pc.libMatch(src);
    if (it) { ok++; if (ok <= 12) console.log(`  ✓ ${src}  →  ${it.title}`); }
    else { bad++; if (bad <= 8) console.log(`  · ${src}  （别名 ${alts.join(' / ')}，本地库仍无）`); }
  }
  console.log(`\n学到的名字里能命中本地库：${ok} /${ok + bad}`);
} else {
  console.log('\n（尚无 cn-names.json）');
}

console.log('\n未命中样例（前 20）：');
for (const m of misses) console.log('  ·', m);
