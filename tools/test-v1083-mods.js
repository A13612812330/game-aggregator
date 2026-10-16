/** tools/test-v1083-mods.js — v10.83 MOD 直链扩量防线（静态离线 · 秒级）
 *
 * 守三件事：
 *   ① TS 扩量：--per 24→50 重抓后 thunderstore.json 包数不许缩水（基线 2,870）
 *   ② Modrinth **不接线**（防回归）：实测 0 产出（纯 MC 生态），server/前端/data 读取层
 *      都不许留 MX 痕迹 —— 谁想再接，先重跑 fetch-modrinth.js 探针拿到非 0 产出再说
 *   ③ 前端四路不动：TS 段渲染 / 角标计数 / 空态守卫保持 v10.81 形态
 *
 * ★ 断言全部「判源码 + 判产物 JSON 形状」，不打网络 —— 网络行为由 _probe 验。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  [' + detail + ']' : '')); }
}

const SRV = read('server.js');
const IDX = read('public/index.html');

console.log('== ① TS 扩量（per 24→50） ==');
const ts = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data/thunderstore.json'), 'utf8')); } catch (e) { return null; } })();
ok('thunderstore.json 可解析且形状完整', !!(ts && ts.stats && Array.isArray(ts.games) && Array.isArray(ts.unmatched)));
ok('TS 包数不缩水（旧基线 2,870）', !!(ts && ts.stats && ts.stats.packages >= 2870), ts && ts.stats ? String(ts.stats.packages) : 'unreadable');
ok('TS 匹配社区数不缩水（基线 254）', !!(ts && ts.stats && ts.stats.matched >= 254), ts && ts.stats ? String(ts.stats.matched) : '');
const tsPkgUrl = ts && ts.games.flatMap((g) => g.packages || []).find((p) => p.url);
ok('TS 包直链仍是官方 download 口（302 → 自家 CDN）', !!tsPkgUrl && /^https:\/\/thunderstore\.io\/package\/download\//.test(tsPkgUrl.url));
ok('抓取器默认 per=24 不许悄悄改（扩量走 --per 显式传参）',
  /arg\('per', '24'\)/.test(read('tools/fetch-thunderstore.js')));

console.log('== ② Modrinth 不接线（0 产出实测，防回归） ==');
ok('server 无 /api/mx/mods 注册（撤下后不许复活；注释里的历史记录不算）',
  !/app\.get\('\/api\/mx\/mods'/.test(SRV) && !SRV.includes("require('./data/modrinth')"));
ok('前端无 dlUniFetchMx / MX 段渲染', !IDX.includes('dlUniFetchMx') && !/MX<\/span>/.test(IDX) && !/d\.mx\b/.test(IDX));
ok('data/ 无 modrinth 读取层与产物（探针产物归 tools/_probe-*）',
  !fs.existsSync(path.join(ROOT, 'data/modrinth.js')) && !fs.existsSync(path.join(ROOT, 'data/modrinth.json')));
ok('探针保留且带双护栏（谁想再接必须先重跑探针）',
  fs.existsSync(path.join(ROOT, 'tools/fetch-modrinth.js')) &&
  /nameGuard\(h, q\)/.test(read('tools/fetch-modrinth.js')) &&
  /loaderGuard\(v, q\)/.test(read('tools/fetch-modrinth.js')) &&
  /0 产出/.test(read('tools/fetch-modrinth.js')));

console.log('== ③ 前端四路不动（v10.81 形态回归闸） ==');
ok('mod 页签仍是四路（community/gcm/gtr/ts，没有第五路）',
  /const \[community, gcm, gtr, ts\] = await Promise\.all\(\[\s*\n\s*dlUniFetchMods\(st\.ctx, k\),/.test(IDX));
ok('st.data 形态不变', /st\.data\[k\] = \{ community, gcm, gtr, ts \};/.test(IDX));
ok('角标计数 = 四路之和（无 mx 项）',
  /st\.cnt\[k\] = community\.count \+ gcm\.length \+ gtr\.length \+ ts\.length;/.test(IDX) && !/ts\.length \+ mx\.length/.test(IDX));
ok('TS 段渲染在（MX 角标不在）',
  /d\.ts\.map\(\(x\) =>/.test(IDX) && !/d\.mx\.map\(\(x\) =>/.test(IDX));
ok('空态守卫保持 v10.81 三路（gtr/ts/gcm，无 mx）',
  /\(d\.ts \|\| \[\]\)\.length \|\| \(kind === 'modifier' && \(d\.gcm \|\| \[\]\)\.some/.test(IDX) && !/\(d\.mx \|\| \[\]\)\.length/.test(IDX));

console.log(fail === 0 ? `\n全部通过 ${pass}/${pass}` : `\n${fail} 条失败 / ${pass} 条通过`);
if (fail) process.exitCode = 1;
