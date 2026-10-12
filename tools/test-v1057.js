#!/usr/bin/env node
/* tools/test-v1057.js —— v10.57 防线：术语统一（「云存档」→「存档」）的负向守护
 *
 * ★ 为什么需要断言，而不是「改完就算」：
 *   全项目「云存档」出现 60+ 次，其中**大多数在注释里**。注释改了会让历史失真
 *   （那些是当时口径的原始记录，比如「v10.5 有修改器 / 有云存档」就是 v10.5 的原话），
 *   不改又会让下轮读注释的人把「云存档」重新捡回界面。本套件的办法：
 *     · **剥掉注释**后断言「用户可见文案零『云存档』」← 界面不许回退
 *     · 注释原文保留 ＋ 另加一条**术语声明**（v10.57 起全局称「存档」）← 历史不失真
 *
 * 分组：
 *   A 主源 index.html 的用户可见文案
 *   B 三张派生页（重建产物）已同步 + 手机专区开关与卡面 chip **同名**
 *   C 数据层口径注释（两套并存的口径已如实记录，防下轮误合并）
 *   D 负向守护：断言本身在位（元断言）+ 开关接线未被改坏
 *
 * 跑法：node tools/test-v1057.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const readPub = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** ★ 剥掉注释，只留「用户可见」部分。
 *
 *  三种注释都要剥：
 *    · HTML  `<!-- … -->`
 *    · 块    `/ * … * /`
 *    · 行    `// …`  ——⚠️ 必须排除 URL：`https://` 里的 `//` 前一个字符是 `:`，
 *            所以用 `(^|[^:])` 做前置断言，否则会把整个 URL 连同后面代码一起吃掉。
 */
function stripComments(s) {
  return String(s)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

let pass = 0, fail = 0;
const t = (ok, name, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`); };
const sec = (s) => console.log('\n── ' + s + ' ──');

/* ============================ A 主源文案 ============================ */
sec('A index.html 用户可见文案（剥注释后）');

const IDX = readPub('index.html');
const IDX_VIS = stripComments(IDX);

t(!/云存档/.test(IDX_VIS), '★ index.html 剥注释后**零**「云存档」',
  (IDX_VIS.match(/云存档/g) || []).length + ' 处');
t(/lb: '存档'/.test(IDX_VIS), "统一搜索分区标签 `lb: '存档'`");
t(/name: '存档 · 放在哪'/.test(IDX_VIS), "搜索分组名 `存档 · 放在哪`（句式与另三组一致）");
t(/存档库无命中/.test(IDX_VIS), '空态文案 `存档库无命中`');
t(/修改器 \/ 存档/.test(IDX_VIS), '搜索框提示 `修改器 / 存档`');
t(/修改器 · 存档 一次搜完/.test(IDX_VIS), '占位文案 `端游 · 手游 · 修改器 · 存档 一次搜完`');
t(/src-badge sv">💾 存档</.test(IDX_VIS), '结果行徽标 `💾 存档`');
t(/>存档位置库<\/a>/.test(IDX_VIS), '详情页跳转 `存档位置库`');
t(/nm: '修改器\/存档'/.test(IDX_VIS), '锚点导航项 `修改器/存档`');
t(/修改器 \+ 存档）/.test(IDX_VIS), '加载文案 `（端游库 + 手游中心 + 修改器 + 存档）`');
t(/到手机专区「🎮 手游中心」可看这款的完整存档路径/.test(IDX_VIS), 'toast 文案已指到真实页签名');
/* 元断言：上面那条「零云存档」若被删掉，本套件就失去意义 —— 用源码自查钉住它 */
t(/function stripComments/.test(fs.readFileSync(__filename, 'utf8')), '元断言：剥注释器仍在（否则 A 组会退化成恒真）');

/* ============================ B 派生页 ============================ */
sec('B 三张派生页（build-* 重建产物）');

for (const f of ['emulator.html', 'resources.html', 'unpack.html']) {
  const vis = stripComments(readPub(f));
  t(!/云存档/.test(vis), `★ ${f} 剥注释后**零**「云存档」`, (vis.match(/云存档/g) || []).length + ' 处');
  t(/name: '存档 · 放在哪'/.test(vis), `${f} 已重建（共享段含新分组名）`);
}

/* ★ 手机专区：开关与卡面 chip 必须**同名** —— v10.53 改了 chip 却漏改开关，
 *   于是「开关叫有云存档、卡面叫有存档」，用户点开看到的是两套词。 */
const EMU = readPub('emulator.html');
const EMU_VIS = stripComments(EMU);
const svBtn = (EMU_VIS.match(/id="emuToggleSv"[^>]*title="([^"]*)"[^>]*>([^<]*)</) || []);
t(svBtn[2] === '💾 有存档', '★ 手机专区开关 #emuToggleSv 文案 = 「💾 有存档」', JSON.stringify(svBtn[2] || null));
t(/Ludusavi/.test(svBtn[1] || ''), '开关 title 如实写明数据源（Ludusavi 存档位置库）', JSON.stringify(svBtn[1] || null));
const chip = (EMU_VIS.match(/class="tg has-sv" title="([^"]*)"[^>]*>([^<]*)</) || []);
t(chip[2] === '💾 有存档', '★ 卡面 chip 文案与开关同名（同为「💾 有存档」）', JSON.stringify(chip[2] || null));
t(svBtn[2] && chip[2] && svBtn[2] === chip[2], '开关文案 ≡ chip 文案（同名才不骗人）');

/* ============================ C 数据层口径注释 ============================ */
sec('C 数据层：两套并存的口径已如实记录');

const XREF = read('data/xref.js');
t(/v10\.57 术语/.test(XREF), 'data/xref.js 含 v10.57 术语声明');
t(/Ludusavi 收录到的\*\*存档位置\*\*/.test(XREF), '记录了口径一：Ludusavi 存档**位置**（6,628 款量级）');
t(/能下到\*\*存档文件/.test(XREF), '记录了口径二：**能下到**存档文件（1,377 款量级）');
t(/不是同一个口径/.test(XREF), '★ 明确写出「两者不是同一个口径」（防下轮当成一个去合并）');
t(/v10\.57 术语/.test(read('data/saves.js')), 'data/saves.js 标题已改并注明原名');
t(/v10\.57 起称「存档」/.test(read('data/mobilehub.js')), 'data/mobilehub.js 的 sv 参数文档已改');

/* ============================ D 负向守护 ============================ */
sec('D 负向守护：界面不许把「云存档」捡回来');

t(/v10\.57 术语统一/.test(IDX), '主源留有术语声明注释（下轮读到旧注释时能对上）');
/* 开关接线没被改坏：改名只该动文案，不该动 id / 绑定 */
t(/emuToggleSv/.test(readPub('emulator.html')), '#emuToggleSv 仍在（只改文案，没删按钮）');
t(/bindToggle\('emuToggleSv', 'sv', 'ghEmuSv'\)/.test(readPub('emulator.html')), "绑定仍是 bindToggle('emuToggleSv', 'sv', 'ghEmuSv')");
t(/id="emuToggleTr"[^>]*>🛠 有修改器</.test(EMU_VIS), '相邻的「🛠 有修改器」未被误改（本版只动存档相关）');
/* 反证靶子在位 */
t(fs.existsSync(path.join(ROOT, 'tools', '_counterproof-v1057-term.js')), '术语统一的反证脚本存在');

console.log('\n' + '='.repeat(58));
console.log(`v10.57 防线：${pass} / ${pass + fail} 通过` + (fail ? `，${fail} 失败` : ''));
if (fail) process.exitCode = 1;
