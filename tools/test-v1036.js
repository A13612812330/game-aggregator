/**
 * tools/test-v1036.js —— v10.36「跨源名字匹配：归一化唯一真源 + 代际护栏 + 尾缀扩展」
 *
 * 本套件守四件事（全部是**行为级**断言，可做反证）：
 *   ① 归一化只有一份实现（三处调用方不允许再自带 char class）
 *   ② 代际数字护栏：错的拦住、对的**不许**误伤
 *   ③ 尾缀扩展：exe 运行环境残渣剥得掉，且**不剥** Tropico Reloaded
 *   ④ 产物自洽 + 三条「曾错配、现已正确」的定点回归
 *
 * ★ 为什么断言写得这么细：本轮改的是**匹配器**，它的失败方式全是「悄悄配错」——
 *   封面挂错、详情跳错，页面上没有任何报错。所以正向（该拦的拦住）与
 *   反向（不该拦的不许拦）必须成对写，否则「把护栏调到最严」也能全绿。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  — ' + extra : '')); }
  else { fail++; console.log('  × FAIL ' + name + (extra ? '  — ' + extra : '')); }
}
function eq(a, b, name, extra) { ok(a === b, name, (extra || '') + '  得到 ' + JSON.stringify(a) + '，期望 ' + JSON.stringify(b)); }
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const NN = require(path.join(ROOT, 'data', 'name-normalize'));
const pc = require(path.join(ROOT, 'data', 'phonecfg'));
const mh = require(path.join(ROOT, 'data', 'mobilehub'));

/* ================= ① 归一化：唯一真源 ================= */
console.log('\n=== ① 归一化只有一份实现 ===');
{
  eq(NN.normKey('Call of Duty®: Modern Warfare® 2 (2009)'), 'callofdutymodernwarfare22009',
    '★ 商标号 ® 必须被剥掉（库内 75 条标题含 ™/®，漏剥 ⇒ 精确通道整个失效）');
  eq(NN.normKey('EA SPORTS™ FIFA 23'), 'easportsfifa23', '™ 必须被剥掉');
  eq(NN.normKey('摇鼠灵™'), '摇鼠灵', 'CJK 名尾部的 ™ 必须被剥掉');
  /* 半角 * 与全角 ＊ **都**在字符类里 ⇒ 两边都归一成 `eden`，库内 `eden*` 与社区名 `eden＊` 才可能相等。
     写成「期望 eden*」是错的（我自己第一版就写错了，跑出来才看见）。 */
  eq(NN.normKey('eden＊'), 'eden', '全角 ＊ 与半角 * 都必须被剥掉（库内 `eden*` 与社区名 `eden＊` 靠这一步才相等）');
  eq(NN.normKey('eden*'), 'eden', '半角 * 同样剥掉（对上一条的对照）');
  eq(NN.normKey('The Sims™ 4 Enchanted by Nature Expansion Pack'), 'thesims4enchantedbynatureexpansionpack',
    '剥符号后仍保留空格删除与大小写折叠');
  ok(/[™®©]/.test(NN.SYMBOLS.source), '★ SYMBOLS 字符类里确实含 ™®©（防「只改注释不改行为」）');

  const CALLERS = ['data/phonecfg.js', 'data/mobilehub.js', 'tools/build-mobilehub.js'];
  for (const rel of CALLERS) {
    const src = strip(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    ok(!/function\s+normKey\s*\(/.test(src), '★ ' + rel + ' 不许再自带 normKey 定义（第二实现 = 漂移源）');
    ok(/name-normalize/.test(src), rel + ' 从 data/name-normalize 取归一化');
  }
  ok(pc.normKey === NN.normKey, '★ data/phonecfg 导出的 normKey 与唯一真源同源（=== 比，不是「行为像」）');
  ok(mh.normKey === NN.normKey, '★ data/mobilehub 导出的 normKey 与唯一真源同源');
}

/* ================= ② 代际数字提取（表驱动） ================= */
console.log('\n=== ② 代际数字：取数口径 ===');
{
  /* 期望值全部是**人工核过**的：注释里写清「为什么是这几个数」 */
  const CASES = [
    ['Call of Duty Modern Warfare 2 2009', ['2'], '★ 不能从归一化钥匙取数：粘成 warfare22009 会切出 [2200,9]'],
    ['Assassin S creed 3', ['3'], '代际数字保留'],
    ['The Sims 1 - Legacy Collection', ['1'], '代际数字保留'],
    ['F1 2014', [], '★ 4 位年份不算代际（F1 2014 靠年份匹配，判冲突会误杀）'],
    ['Dead Space 2008', [], '★ 同理：Dead Space 2008 必须仍能命中'],
    ['Warhammer 40 000 Space Marine', ['40'], '大编号（2 位）算；000 是 3 位、排除'],
    ['啪嗒砰 1+2 重制版', ['1', '2'], '中文名里的代际数字要取到'],
    ['KINGDOM HEARTS HD 2 8 Final Chapter Prologue', ['2', '8'], '空格分隔的两个数字'],
    ['ProjectZomboid32', [], '★ 贴字母的 32 是 exe 位数标记，摘掉（否则 32 位版永远配不上）'],
    ['TheWalkingDead2', [], '★ 同理：贴字母的 2 是版本标记'],
    ['Universe Sandbox x64', [], '★ 同理：x64'],
    ['桥梁建造师3', ['3'], '中文 + 尾部数字'],
    ['Crysis 2 - Maximum Edition', ['2'], ''],
  ];
  for (const [s, want, note] of CASES) {
    eq(JSON.stringify(NN.genNums(s)), JSON.stringify(want), 'genNums(' + JSON.stringify(s) + ')' + (note ? '  ' + note : ''));
  }
}

/* ================= ③ 代际护栏：该拦的拦 / 不该拦的不许拦 ================= */
console.log('\n=== ③ 代际护栏（numMismatchByTitle）===');
{
  const LI = (t) => ({ title: t });
  ok(NN.numMismatchByTitle('Assassin S creed 3', LI('刺客信条1/Assassin\'s Creed')) === true,
    '★ AC3 配到「刺客信条1」⇒ 判冲突');
  ok(NN.numMismatchByTitle('The Sims 1 - Legacy Collection', LI('The Sims™ 4 自然奇境资料片/The Sims™ 4 Enchanted by Nature Expansion Pack')) === true,
    '★ Sims1 配到「The Sims 4」⇒ 判冲突');
  ok(NN.numMismatchByTitle('Crysis 2 - Maximum Edition', LI('孤岛危机：重制版/Crysis Remastered')) === true,
    'Crysis 2 配到「孤岛危机：重制版」⇒ 判冲突');

  /* ★★ 反向：这几条是**正确**匹配，护栏一旦收紧过头就会打掉它们 */
  const KEEP = [
    ['Call of Duty Modern Warfare 2 2009', '使命召唤6：现代战争2（2009）/Call of Duty®: Modern Warfare® 2 (2009)'],
    ['Tomb Raider', '古墓丽影9终极版/Tomb Raider Definitive Edition'],
    ['SkullGirls', 'Skullgirls 2nd Encore'],
    ['Trails in the Sky', '空之轨迹 the 2nd'],
    ['Dead Space 2008', '死亡空间-虚拟机版/Dead Space HYPERVISOR'],
    ['F1 2014', 'F1 2014'],
    ['ProjectZomboid32', '僵尸毁灭工程/Project Zomboid'],
    ['啪嗒砰 1+2 重制版', '啪嗒砰1+2重制版/PATAPON 1+2 REPLAY'],
    ['Warhammer 40 000 Dawn of War', '战锤40k：战争黎明/Warhammer 40,000: Dawn of War - Definitive Edition'],
    ['Poppy Playtime', '波比的游戏时间/罂粟花游戏时间/Poppy Playtime'],
    ['Resident Evil 5', '生化危机5：黄金版/Resident Evil 5：Gold Edition'],
  ];
  for (const [q, t] of KEEP) {
    ok(NN.numMismatchByTitle(q, LI(t)) === false, '★ 反向：' + q + ' → 「' + t + '」不许被判冲突');
  }
  ok(NN.numMismatchByTitle('随便一个名字', null) === false, '反向：无条目 ⇒ 不判冲突（不许崩）');
  ok(NN.numMismatchByTitle('Call of Duty Modern Warfare 2 2009', LI('Call of Duty Modern Warfare 2 2009')) === false,
    '反向：同名同数字 ⇒ 不判冲突');
}

/* ================= ④ 产物：尾缀扩展 + 定点回归 ================= */
console.log('\n=== ④ 手游中心产物（data/mobilehub.json）===');
{
  const MHP = path.join(ROOT, 'data', 'mobilehub.json');
  const hub = JSON.parse(fs.readFileSync(MHP, 'utf8'));
  const byName = new Map();
  for (const x of hub.items) {
    byName.set(mh.normKey(x.name), x);
    for (const a of (x.alt || [])) if (!byName.has(mh.normKey(a))) byName.set(mh.normKey(a), x);
  }
  const libOf = (name) => { const x = byName.get(NN.normKey(name)); return x ? (x.libTitle || '') : null; };

  /* —— 产物自洽（不依赖具体数据规模，不会被库增长打红） —— */
  eq(hub.stats.total, hub.items.length, '产物自洽：stats.total == items.length');
  eq(hub.stats.matched, hub.items.filter((x) => x.libId).length, '产物自洽：stats.matched == 有 libId 的条数');
  eq(hub.stats.unmatched, hub.items.filter((x) => !x.libId).length, '产物自洽：stats.unmatched == 无 libId 的条数');

  /* —— 定点：曾错配、现在必须正确 —— */
  const cod = libOf('Call of Duty Modern Warfare 2 2009');
  ok(cod === null || /现代战争2（2009）|Modern Warfare® 2 \(2009\)/.test(cod),
    '★ 曾错配到《使命召唤16：现代战争》，现在须指向 2009 版（或至少不再指向 16）', cod || '（该条不在产物里）');

  const sims = libOf('The Sims 1 - Legacy Collection');
  ok(sims === null || !/The Sims™ 4/.test(sims),
    '★ 曾错配到「The Sims™ 4 资料片」，现在不许再指向它', sims || '（已不再错配）');

  const ac3 = libOf('Assassin S creed 3');
  ok(ac3 === null || !/刺客信条1/.test(ac3), '★ 曾错配到「刺客信条1」，现在不许再指向它', ac3 || '（已不再错配）');

  /* —— 定点：尾缀扩展带来的真匹配 —— */
  const us = libOf('Universe Sandbox x64');
  ok(us === null || /Universe Sandbox/.test(us), '`Universe Sandbox x64`（x64 是 exe 残渣）应命中 Universe Sandbox', us || '（不在产物里）');
  const ff7 = libOf('FINAL FANTASY VII Steam Edition');
  ok(ff7 === null || /FINAL FANTASY VII/.test(ff7), '`FINAL FANTASY VII Steam Edition`（Steam Edition 是平台残渣）应命中 FF7', ff7 || '（不在产物里）');
  const fifa = libOf('EA SPORTS FIFA 23');
  ok(fifa === null || /FIFA 23/.test(fifa), '★ `EA SPORTS FIFA 23` 曾因库名带 ™ 而配不上，现在应命中', fifa || '（不在产物里）');

  /* —— 反向：不许把「系列总称」类正确匹配打掉 —— */
  const tr = libOf('Tomb Raider');
  ok(tr === null || /Tomb Raider/.test(tr), '★ 反向：`Tomb Raider` 仍应命中「古墓丽影9终极版」（v9.2 起的历史行为，不许收紧）', tr || '（不在产物里）');
  const nfs = libOf('Need For Speed Most Wanted 2005');
  ok(nfs === null || /Most Wanted/.test(nfs), '反向：`Need For Speed Most Wanted 2005` 应命中最高通缉', nfs || '（不在产物里）');
}

/* ================= ⑤ 源码侧：护栏不许被摘掉 / 不许越界 ================= */
console.log('\n=== ⑤ 源码侧：护栏存在性与作用域 ===');
{
  const B = strip(fs.readFileSync(path.join(ROOT, 'tools', 'build-mobilehub.js'), 'utf8'));
  const n = (B.match(/numMismatchByTitle\(/g) || []).length;
  ok(n >= 5, '★ build-mobilehub 的**每条**返回通道都挂了代际护栏（≥5 处，实际 ' + n + '）');
  ok(/numMismatchByTitle\(\s*t\s*,/.test(B), '★ 护栏比的是**原始查询串 t**（不是剥离后的 key —— 见 ② 的取数口径）');
  /* 尾缀表新增项的存在性与来源 */
  const RS = (B.match(/const\s+RELEASE_SUFFIX\s*=\s*\[[\s\S]*?\];/) || [''])[0];
  for (const w of ['d3d|dx', 'x64\\|x86', 'loader\\|launcher', 'steam\\|epic\\|gog']) {
    ok(new RegExp(w).test(RS), '尾缀表覆盖 ' + w);
  }
  ok(!/reloaded/i.test(RS), '★ 反向：尾缀表里仍然不许有 reloaded（Tropico Reloaded 是作品名）');
  /* ★ 第三层守卫：前缀包含通道的阈值没被顺手调高（调高 8→10 会丢 18 条正确匹配、只换 1 条） */
  ok(/whole\.length\s*>=\s*8/.test(B), '★ 前缀包含通道阈值仍是 8（v10.36 实测：调到 10 会丢 18 条正确匹配、只换回 1 条）');
  /* CJK 版本词 */
  ok(/终极版/.test(B) && /豪华版/.test(B), '★ EDITION_WORDS 已含 CJK 版本词（终极版/豪华版…）');
  const S = strip(fs.readFileSync(path.join(ROOT, 'data', 'phonecfg.js'), 'utf8'));
  ok(/numMismatchByTitle\(\s*t\s*,/.test(S), '★ phonecfg 的 libMatch 同样挂了护栏');
}

console.log('\n============================');
console.log('  通过 ' + pass + '/' + (pass + fail) + '（失败 ' + fail + '）');
console.log('============================');
process.exit(fail ? 1 : 0);
