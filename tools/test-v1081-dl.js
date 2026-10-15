/** tools/test-v1081-dl.js — v10.81 直链改造防线（静态离线 · 秒级）
 *
 * 守四件事：
 *   ① `/api/res/game` 的 ?t= 分支修复（gamesDb.search 返回对象，[0] 恒 undefined 的老 bug）
 *   ② FLiNG 修改器直链：fetcher 产物 / 读取层 / trainners match 挂 dl / 流代理 + SSRF 白名单
 *   ③ Thunderstore MOD 直链：fetcher 产物 / 读取层 / /api/ts/mods / 前端第四路接线
 *   ④ 前端两处渲染与角标计数（FLiNG 按钮分治文案 + TS 段 + 空态守卫）
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
const FLINGDL = read('data/flingdl.js');
const TSMODS = read('data/tsmods.js');

console.log('== ① /api/res/game ?t= 修复 ==');
/* 老写法 `gamesDb.search(t, 1)[0]` 对对象取 [0] 恒 undefined —— 必须走 .items */
ok('res/game 用 search().items 取首条（老 [0] 写法不得回归）',
  /gamesDb\.search\(t, 1\)\.items \|\| \[\]\)\[0\]/.test(SRV) && !/gamesDb\.search\(t, 1\)\[0\]/.test(SRV));
ok('/api/ts/mods 的 ?t= 同口径（不吃同一个坑）',
  /gamesDb\.search\(t, 1\)\.items \|\| \[\]\)\[0\]/.test(SRV));

console.log('== ② FLiNG 直链 ==');
ok('fetcher 产物 data/fling-dl.json 存在且形状正确', (() => {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/fling-dl.json'), 'utf8'));
    return j && j.stats && typeof j.stats.pages === 'number' && j.items && typeof j.items === 'object';
  } catch (e) { return false; }
})());
ok('flingdl.attach 只认 fling_* 来源（别的源不许误挂）',
  /\/\^fling_\(main\|archive\)\$\//.test(FLINGDL));
ok('flingdl 下发的是流代理 URL（源站直链有 Referer 防盗链，不许直接给）',
  FLINGDL.includes("'/api/dl/fling?u=' + encodeURIComponent(l.zip)"));
ok('流代理白名单：路径形态锁 /wp-content/uploads/ 且禁 ..',
  SRV.includes("u.startsWith('/') && u.includes('/wp-content/uploads/') && !u.includes('..')"));
ok('流代理白名单：完整 URL 只认 flingtrainer 域（防 SSRF）',
  /archive\\\.\)\?flingtrainer\\\.com\\\//.test(SRV));
ok('流代理带 Referer 取上游（防盗链绕行的正体）',
  /Referer: 'https:\/\/flingtrainer\.com\/'/.test(SRV));
ok('上游 hard timeout 30s（铁律：一侧源站必须硬超时）',
  /AbortSignal\.timeout\(30000\)/.test(SRV));
ok('trainers/match 给条目挂 dl（前端 GCM 段的输入）',
  SRV.includes('const dl = flingdl.attach(x);') && SRV.includes('...(dl ? { dl } : {})'));
ok('trainers/match 下发 origin/officialUrl（前端分治文案要认 origin）',
  SRV.includes('origin: x.origin, officialUrl: x.officialUrl'));
ok('fetcher 产出物包含 zip/rar/exe 过滤（死 token 空 path 不落库）',
  read('tools/fetch-fling-dl.js').includes('/\\.(zip|rar|exe)$/i'));

console.log('== ③ Thunderstore MOD 直链 ==');
ok('fetcher 产物 data/thunderstore.json 存在且形状正确', (() => {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/thunderstore.json'), 'utf8'));
    return j && j.stats && typeof j.stats.matched === 'number' && Array.isArray(j.games);
  } catch (e) { return false; }
})());
ok('tsmods.slim 行形状：links[{label,url,cls}] + page + srcLabel',
  TSMODS.includes("links: [{ label: '直链 zip', url: p.url, cls: 'pri' }]")
  && TSMODS.includes("page: 'https://thunderstore.io/package/' + p.ns + '/' + p.name + '/'"));
ok('tsmods 直链用官方 download 口（302→CDN zip 无防盗链，不需流代理）',
  TSMODS.includes('官方 download 口') && !TSMODS.includes('/api/dl/fling'));
ok('/api/ts/mods 端点在场且给 community',
  SRV.includes("app.get('/api/ts/mods'") && SRV.includes('tsmods.slim(id, limit)'));
ok('fetcher 未用被禁的全量端点 /c/<c>/api/v1/package/（门 1 铁律；★ 剥注释再判 —— 防线注释自己提过它）',
  (() => {
    const src = read('tools/fetch-thunderstore.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    return !src.includes('/api/v1/package/');
  })());

console.log('== ④ 前端接线 ==');
ok('dlUniLoad：mod 页签并行取 ts 第四路',
  /const \[community, gcm, gtr, ts\] = await Promise\.all\(\[/.test(IDX)
  && IDX.includes("k === 'mod' ? dlUniFetchTs(st.ctx) : Promise.resolve([])"));
ok('角标计数加 ts.length（新来源必须计数）',
  /st\.cnt\[k\] = community\.count \+ gcm\.length \+ gtr\.length \+ ts\.length;/.test(IDX));
ok('dlUniFetchTs：失败返回 [] 不拖垮整页（与 dlUniFetchGt 同策略）',
  /async function dlUniFetchTs\(ctx\)/.test(IDX) && /catch \(e\) \{ return \[\]; \}/.test(IDX));
ok('MOD 页签渲染 TS 段（TS 徽标 + 直链 zip 按钮）',
  IDX.includes("if (kind === 'mod' && (d.ts || []).length)") && IDX.includes('<span class="k gt">TS</span>'));
ok('TS 段源码位置在机地帖渲染之前（能直下的排前面）',
  IDX.indexOf("if (kind === 'mod' && (d.ts || []).length)")
    < IDX.indexOf('out.push(dlModRowsHtml(c.items, kind))'));
ok('GCM 段分治文案：有 FLiNG 直链时不再说「一律不含下载地址」',
  IDX.includes("风灵月影（FLiNG）官方文件可直下") && IDX.includes('const nDl = gcm.filter((it) => (it.dl || []).length).length;'));
ok('空态守卫：机地没有但 TS/GT 有时不许说「没有收录」（v10.53 同坑不再踩）',
  /\(gtr\.length \|\| \(d\.ts \|\| \[\]\)\.length \? '' :/.test(IDX));
ok('FLiNG 按钮带文件名 title（title="' + ' 语法锚）',
  IDX.includes("esc(l.file || 'FLiNG 修改器文件')"));

console.log(`\n${pass} / ${pass + fail}`);
if (fail) process.exit(1);
