#!/usr/bin/env node
/* tools/test-v1066.js —— 主站 URL 直达（?open=）与 roster 弹窗入口的**跨文件契约**
 *
 * 背景（用户口径）：
 *   「优化弹窗显示效果，可以每个最多显示5条，最好增加一个跳转到该项目详情页以及弹窗的功能」
 *   ⇒ roster 弹窗里的「打开游戏详情页 / 直接打开资源弹窗」要真的能跳到**那一款**，
 *     这要求在站点侧支持 ?open=<本地库 id> 直达详情、?open=<id>&dl=<页签> 直达资源弹窗。
 *
 * 守的五类**静默事故**：
 *   A 主站没有 ?open= 分支        —— roster 的按钮点开只是首页，用户以为是站点坏了
 *   B 参数只在主源、派生页没同步   —— /emulator.html 等三页跳过去会掉参数（单源派生体系统的老坑）
 *   C 顺序颠倒                    —— gotoResTab 必须「先 await openDetailById 再 openUniDownload」
 *                                    （注释里写明：弹窗靠抽屉的会话上下文取 id，颠倒会拿到**上一款**的 id）
 *   D dl 取值与 DL_UNI 键漂移      —— roster 拼的 `&dl=modifier` 若与站点页签键不一致，
 *                                    会静默兜底到 body（用户以为「Mod 页签没了」）
 *   E 绕过 gotoResTab 直调弹窗     —— 少了详情上下文，弹窗拿到空 title / 上一个 id
 *
 * 纯静态、秒级、不依赖 8123。行为验收在 tools/_probe-v1066-open.js（浏览器实拍）。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const PAGES = ['index.html', 'emulator.html', 'resources.html', 'unpack.html'];
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra ? '   [' + extra + ']' : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '   [' + extra + ']' : '')); }
};

const idx = read('index.html');
/* boot 段（URL 参数处理那一段）—— A/E 段都在这段里判，先切出来 */
const bootSeg = idx.slice(idx.indexOf("const sp = new URLSearchParams"),
  idx.indexOf("document.documentElement.setAttribute('data-ready'"));

console.log('\n── A 主站 URL 直达 ──');
/* ★ 只判「引用了哪个标识符」，不钉调用形状 ——
   本项目同一处因「钉形状」的断言已反复欠账 4 次（写法一改就假红）。
   形状层面的正确性由 C 段（顺序契约）与浏览器实拍（_probe-v1066-open.js）负责。 */
ok('A1 boot 段读 ?open= 参数', /sp\.get\('open'\)/.test(idx));
ok('A2 boot 段引用 openDetailById（直达详情抽屉）', /openDetailById/.test(bootSeg));
ok('A3 boot 段引用 gotoResTab（详情 + 资源弹窗一条路）', /gotoResTab/.test(bootSeg));
ok('A4 dl 取值经 DL_UNI_KEYS 白名单校验、且有 body 兜底',
  /DL_UNI_KEYS/.test(bootSeg) && /'body'/.test(bootSeg));
ok('A5 既有直达参数没被改坏（?q= / ?c= / ?sort= 三者的分支仍在）',
  /sp\.get\('q'\)/.test(idx) && /sp\.get\('c'\)/.test(idx) && /sp\.get\('sort'\)/.test(idx));

console.log('\n── B 四页同步（单源派生：改主源必须重建）──');
PAGES.forEach((f) => {
  const s = read(f);
  ok(`B ${f} 带 ?open= 分支`, /sp\.get\('open'\)/.test(s));
});

console.log('\n── C gotoResTab 的调用顺序 ──');
const g = idx.match(/async function gotoResTab\([\s\S]*?\n\}/);
ok('C1 定位到 gotoResTab 定义', !!g, g ? g[0].split('\n').length + ' 行' : '未找到');
if (g) {
  const body = g[0];
  const iDetail = body.indexOf('await openDetailById');
  const iPop = body.indexOf('openUniDownload');
  ok('C2 先 await openDetailById 再 openUniDownload（顺序颠倒会拿到上一款的 id）',
    iDetail >= 0 && iPop > iDetail, `detail@${iDetail} pop@${iPop}`);
}

console.log('\n── D roster 页拼的 dl= 必须落在站点页签键内 ──');
const dlUni = (idx.match(/const DL_UNI = \[([\s\S]*?)\];/) || [])[1] || '';
const keys = [...dlUni.matchAll(/k: '([a-z]+)'/g)].map((m) => m[1]);
ok('D1 站点页签键可解析', keys.length > 0, JSON.stringify(keys));
const roster = read(path.join('roster', 'index.html'));
const used = [...roster.matchAll(/lk\.tab\('([a-z]+)'\)/g)].map((m) => m[1]);
ok('D2 roster 用到的页签键都有定义（拼错 ⇒ 静默兜底到 body）',
  used.length > 0 && used.every((k) => keys.includes(k)),
  `roster 用 ${JSON.stringify(used)} ／ 站点有 ${JSON.stringify(keys)}`);
ok('D3 三类资源各用各自的页签（不是三个都填同一个）',
  new Set(used).size === used.length && used.length === 3, JSON.stringify(used));

console.log('\n── E 负向守护 ──');
/* boot 段里不允许**直接**调 openUniDownload：那会绕过 gotoResTab，弹窗拿不到详情上下文。 */
ok('E1 boot 段不直接调 openUniDownload（必须走 gotoResTab）',
  !/openUniDownload/.test(bootSeg), bootSeg.length + ' 字符');

console.log('\n── F 元断言（正则本身要有效）──');
/* 阳性对照：把 op 那一行删掉，A1 的判据必须失配 —— 证明它判的是**这一处**，
   而不是文件里别的什么地方碰巧也有同样字样（本项目踩过多次这类假绿）。 */
const mutant = idx.replace(/const op = \(sp\.get\('open'\) \|\| ''\)\.trim\(\);/, '');
ok('F1 ★ 删掉 op 那一行后 A1 判据失配（判的是目标处，不是巧合）',
  /sp\.get\('open'\)/.test(idx) && !/sp\.get\('open'\)/.test(mutant));
ok('F2 gotoResTab 定位正则能匹配「只有一层」的变体',
  /async function gotoResTab\([\s\S]*?\n\}/.test('async function gotoResTab(a, b, c) {\n  x();\n}'));

console.log(`\n── v10.66：${pass} / ${pass + fail} 通过${fail ? `（失败 ${fail}）` : ''} ──`);
process.exit(fail ? 1 : 0);
