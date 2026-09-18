/* 验证 aliasSane 护栏：该拦的拦住、该放的放行 */
const pc = require('../data/phonecfg.js');

// 借道 libMatch 的公开行为做黑盒验证（aliasSane 未导出，走真实链路更可信）
const cases = [
  // [源名, 期望是否应命中, 说明]
  ['FLOWERS 夏篇', false, '误配（Wylde Flowers）必须被拦'],
  ['120日元', false, '本地库确实没有，不该硬配'],
  ['Ever 17', true, '英文段交叉，应命中 时空轮回/Ever 17'],
  ['星界战士', true, '精确中文名，应命中'],
  ['最终幻想7：重生', true, '本地库有多段标题，应命中'],
  ['破门而入：行动小队', true, '带冒号，应命中'],
  ['', false, '空名不应命中'],
];

let pass = 0, fail = 0;
for (const [name, want, why] of cases) {
  const it = pc.libMatch(name);
  const got = !!it;
  const good = got === want;
  if (good) pass++; else fail++;
  console.log(`${good ? '  PASS' : '× FAIL'}  ${name || '(空)'}  →  ${it ? it.title : 'null'}`);
  console.log(`        ${why}（期望${want ? '命中' : '不命中'}）`);
}
console.log(`\n结果：${pass} / ${pass + fail} 通过`);

// 顺带抽查：已学习且**确实命中**的别名，人工复核有无明显错配
const fs = require('fs');
const path = require('path');
const j = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'cn-names.json'), 'utf8'));
console.log('\n=== 已学习别名命中抽样（人工复核用）===');
let shown = 0;
for (const [src, alts] of Object.entries(j.aliases || {})) {
  if (shown >= 25) break;
  const it = pc.libMatch(src);
  if (it) { console.log(`  ${src}  →  ${it.title}`); shown++; }
}

/* ★★ v10.22 补：退出码必须跟着失败数走。
   本套件原先只打印「结果：n / m 通过」却始终 exit 0 ⇒ 单独跑时红绿不分，
   且「打坏护栏看断言是否变红」的反证手法对它失效（判据是退出码）。
   判据：输出里的 n/m 是给人看的，**退出码才是给脚本看的**。 */
process.exit(fail ? 1 : 0);
