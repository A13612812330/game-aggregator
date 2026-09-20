#!/usr/bin/env node
/**
 * tools/test-match-release.js — 「手游中心 × 端游库」匹配链的发布版尾缀层（v10.21 / #33 第一层）
 *
 * 守三件事：
 *  ① 尾缀剥离**确实生效**（产物侧证据：`Stellar Blade Demo` 应挂上「剑星」）
 *  ② 剥离后的重试**不许误配**（严格模式护栏不能被摘掉）
 *  ③ 护栏**不许越界**：它只能作用于剥离路径 —— 实测若对既有通道生效，
 *    会打掉 4 条正确匹配（系列总称 → 库里唯一收录），4 退 1 进
 *
 * ★ 为什么产品侧断言比源码断言更重要：
 *   本层是「人工截短查询名」再去匹配，误配风险天然高。
 *   源码断言只能证明「护栏还在」，产物断言才能证明「护栏真的拦住了」。
 *
 * ⚠️ 本套件读 data/mobilehub.json 产物。**改完 tools/build-mobilehub.js 必须重跑它**，
 *    否则断言会失败 —— 这正是想要的行为（规格源改了却没重建产物，属于静默漂移）。
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL: ' + m); } };

/** 与 tools/build-mobilehub.js 同口径的归一化（去空白 + 去标点） */
const normKey = (s) => String(s == null ? '' : s).toLowerCase()
  .replace(/[\s\u3000]+/g, '')
  .replace(/[：:·・,，.。!！?？'"“”‘’()（）\[\]【】《》<>~～\-–—_+*&/／|｜\\]/g, '');

/* ============ A. 产物侧：尾缀剥离真的生效 ============ */
console.log('=== A. 产物侧：尾缀剥离生效 ===');
const hub = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/mobilehub.json'), 'utf8'));
const items = hub.items || [];
const s = hub.stats || {};
/* ★ 用「name + alt」建归一化索引：剥离后的名字可能只留在 alt 里
 *   （`Stellar Blade Demo` → 与 `Stellar Blade` 归并后，Demo 名进了 alt） */
const byKey = new Map();
for (const x of items) {
  for (const nm of [x.name, ...(x.alt || [])]) {
    const k = normKey(nm);
    if (k && !byKey.has(k)) byKey.set(k, x);
  }
}

ok(items.length > 3000, '产物条目数正常（' + items.length + '）');
ok(s.matched >= 1535, '★ 匹配数不低于本版基线（实测 ' + s.matched + '，基线 1540）');
ok(s.matchedRate >= 48, '★ 匹配率 ≥ 48（实测 ' + s.matchedRate + '%，改动前 47.9%）');
ok(items.length <= 3195, '★ 同款已归并（' + items.length + ' ≤ 改动前 3195）');
/* ★ v10.23：改成「不低于基线」而不是恒等 ——
   社区库还在持续收录，配置数会**变多**；恒等会把「新增」误判成退化。
   真正要守住的是「归并不能丢配置」，即不得低于基线。 */
ok((s.configs || 0) >= 15394, '配置总数不丢（' + s.configs + ' ≥ 基线 15394）—— 归并不能丢配置');

/* 逐例验证：这些名字靠尾缀剥离才匹配上的，且指向正确作品 */
const FIXED = [
  ['Stellar Blade Demo', '剑星'],
  ['MiSide Demo', '米塔'],
  ['INSIDE Demo', 'Inside'],
  ['Kusan City of Wolves Demo', '九山'],
  ['Iron Meat Demo', '钢铁之躯'],
  ['Pixel Empires Demo', '像素帝国'],
  ['Decktamer Demo', '驯牌师'],
  ['Log Riders Demo', '圆木骑士'],
  ['States of Power Demo', '强权列国'],
  ['G-Rebels Demo', '反叛之鹰'],
  ['eFootball PES 2021 SEASON UPDATE', '实况足球2021'],
  ['怪物火车2 支持者版', '怪物火车2'],
  ['Football Manager 26 Demo', '足球经理26'],
];
for (const [nm, want] of FIXED) {
  const x = byKey.get(normKey(nm));
  if (!x) { ok(false, '产物里应有条目「' + nm + '」（name 或 alt）'); continue; }
  ok(!!x.libId && String(x.libTitle).includes(want),
    '★ 「' + nm + '」应匹配到含「' + want + '」的端游条目（实际 ' + (x.libTitle || '未匹配') + '）');
}

/* ============ B. 产物侧：剥离路径不许产生误配 ============ */
console.log('=== B. 产物侧：剥离路径的误配护栏 ===');
/* 这两条若被匹配上，**必然**是 stripRelease 路径干的（原名在库中无对应）——
 * 实测定版时它们确实被误配过，是 sequelTail + numConflictStrict 拦下的。 */
const MUST_STAY_UNMATCHED = [
  ['Tropico Reloaded', 'Tropico 6'],   // Reloaded 是 1+2 合集，不是 6（⇒ 故意不剥 Reloaded）
  ['The Witcher Game', '巫师3'],        // 初代 ≠ 巫师3
];
for (const [nm, wrong] of MUST_STAY_UNMATCHED) {
  const x = byKey.get(normKey(nm));
  if (!x) { ok(true, '「' + nm + '」已归并进其它条目（可接受）'); continue; }
  ok(!x.libId || !String(x.libTitle).includes(wrong),
    '★ 「' + nm + '」不许被配到「' + wrong + '」（实际 ' + (x.libTitle || '未匹配') + '）');
}

/* ★ 如实记录「既有近似挂载」—— 这不是本版引入，也不是 bug，是设计取舍：
 *   端游库对这两款只收了其中一作，挂上去用户至少能看到配置/封面。
 *   写进断言是为了「哪天它变成别的更离谱的目标」时能被发现。 */
const KNOWN_APPROX = [
  ['Assassin s Creed II', '刺客信条'],   // 库里只有 III 重制版 → 近似挂载
  ['MaxPayne', '马克思佩恩'],            // 库里只有 3 → 近似挂载
];
console.log('  · 已知近似挂载（既有设计行为，非本版引入，不算失败）：');
for (const [nm, expect] of KNOWN_APPROX) {
  const x = byKey.get(normKey(nm));
  if (!x) { console.log('    - ' + nm + '：产物无此条（可接受）'); continue; }
  const okk = !x.libId || String(x.libTitle).includes(expect);
  ok(okk, '「' + nm + '」若匹配，目标应仍在「' + expect + '」系列内（实际 ' + (x.libTitle || '未匹配') + '）');
  console.log('    - ' + nm + ' → ' + (x.libTitle || '未匹配'));
}

/* ============ C. 源码侧：护栏不许被摘掉 / 不许越界 ============ */
console.log('=== C. 源码侧：护栏存在性与作用域 ===');
const SRC = fs.readFileSync(path.join(ROOT, 'tools/build-mobilehub.js'), 'utf8');
/* 剥注释再查：注释里**特意**写了这些坑的名字，不剥会误报 */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

ok(/const\s+RELEASE_SUFFIX\s*=/.test(CODE), '有 RELEASE_SUFFIX 尾缀表');
ok(/function\s+stripRelease\s*\(/.test(CODE), '有 stripRelease()');
ok(/function\s+libMatchCore\s*\(\s*title\s*,\s*opts\s*\)/.test(CODE), 'libMatchCore 接受 opts（严格模式入口）');
ok(/libMatchCore\s*\(\s*stripped\s*,\s*\{\s*strict\s*:\s*true\s*\}\s*\)/.test(CODE),
  '★ 剥离后的重试必须走 { strict: true }');
ok(/function\s+sequelTail\s*\(/.test(CODE), '有 sequelTail()（续作标记护栏）');
ok(/function\s+numConflictStrict\s*\(/.test(CODE), '有 numConflictStrict()（代际不明不猜）');

/* ★ 三条具体的防回退 */
ok(!/reloaded/.test((CODE.match(/const\s+RELEASE_SUFFIX\s*=\s*\[[\s\S]*?\];/) || [''])[0]),
  '★ RELEASE_SUFFIX 里不许有 reloaded（Tropico Reloaded 是作品名，剥了会错配到海岛大亨6）');
const seqBody = (CODE.match(/function\s+sequelTail\s*\([\s\S]*?\n\}/) || [''])[0];
/* ⚠️ 只查 `EDITION_WORDS` 这个**常量名**是不够的 —— 反证时把循环体改成 `changed=false`
 *   （循环空转）仍能通过，属假断言。必须同时要求「有循环 + 有尾缀判断」。 */
ok(/EDITION_WORDS/.test(seqBody) && /while\s*\(/.test(seqBody) && /endsWith/.test(seqBody),
  '★ sequelTail 必须先剥版本词再判（须有真在执行的循环 + endsWith 判断，不能只留常量名）');
ok(/i\{1,3\}\|iv\|v\|vi\{0,3\}\|ix\|x/.test(seqBody), 'sequelTail 罗马数字字符集完整（含 viii = v+i{0,3}）');
/* ★ 作用域护栏：sequelTail 在既有通道里必须仍被 strict 约束 */
const prefixBlocks = (CODE.match(/if\s*\(\s*whole\.length\s*>=\s*8\s*\)\s*\{[\s\S]*?\n\s{2}\}/g) || []);
const prefixCode = prefixBlocks.join('\n');
ok(/strict\s*&&\s*sequelTail/.test(prefixCode),
  '★ sequelTail 在既有通道（前缀包含）里必须带 strict 约束 —— 放松会打掉 4 条正确匹配');

/* 尾缀表覆盖的关键形态 */
for (const w of ['demo', 'showcase', 'application', 'voices', 'hypervisor']) {
  ok(new RegExp(w, 'i').test(SRC), '尾缀表覆盖 ' + w);
}
ok(/season\\s\*update|season\\s\+update/i.test(SRC), '尾缀表覆盖 season update');

/* ============ D. 知识沉淀：坑有没有写进注释 ============ */
console.log('=== D. 注释里留下踩坑记录 ===');
ok(/Tropico Reloaded/.test(SRC), '注释记了 Tropico Reloaded 这个坑');
ok(/Creed II|Assassin/.test(SRC), '注释记了刺客信条 II/III 这个坑');
ok(/iremastered|先剥/.test(SRC), '注释记了「先剥版本词再判续作」的原因');
ok(/4 退 1 进|打掉 4 条/.test(SRC), '注释记了「护栏不许越界」的实测数据');

console.log('\n=== 结果 ===');
console.log('通过 ' + pass + '/' + (pass + fail) + '（失败 ' + fail + '）');
process.exit(fail ? 1 : 0);
