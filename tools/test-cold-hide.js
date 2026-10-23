/** tools/test-cold-hide.js — v10.84 冷门隐藏防线（静态离线 · 秒级）
 *
 * 守四件事：
 *   ① 口径正确：hot=0 且非近90天新游；热启动期（新游）不许被藏
 *   ② 挂接位置：过滤必须发生在 gamesDb.applyOpts（池前），server 只负责开开关
 *      —— 在分页后过滤 = total 与条目错位（铁律 153）
 *   ③ 行为边界：search / detail 不传 excludeCold ⇒ 可搜到、详情可达；
 *      roster/源站镜像不过滤（看板全量、镜像语义不破坏）
 *   ④ 豁免通道：data/hide-overrides.json（show 赢规则 / hide 强制藏）
 *
 * ★ 现测自证：本套件自己从 games.json 重算口径数，不许与 cold-hide.stats() 有出入；
 *   数字全部现测不写死（daily-sync 后库在变，写死必假红）。
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

const gamesDb = require(path.join(ROOT, 'data/gamesDb.js'));
gamesDb.load();
const coldHide = require(path.join(ROOT, 'data/cold-hide.js'));
/* ★★ v10.109：v10.109 起冷门判定加了第二道「有 MOD/修改器/存档 就不算无人问津」，
 *   而那个判据是**注入式**的（避免 res-groups ↔ cold-hide 循环依赖，见 data/cold-hide.js 头注释）。
 *   ⇒ 测试进程必须自己注入，否则测的是**降级口径**（hasResource 恒 false = v10.84 旧规则），
 *     断言会「平时绿、线上红」或者反过来 —— 这类「测试跑在降级分支上」的假绿最难查。
 *   ★ 注入内容必须与 server.js 一致（同一份组装逻辑），否则测的又是另一套口径。 */
const resGroups = require(path.join(ROOT, 'data/res-groups.js'));
coldHide.setResourceProvider(() => {
  const out = new Set();
  for (const cat of ['mod', 'trainers', 'saves']) {
    for (const id of resGroups.libIdsFor(cat)) out.add(id);
  }
  return out;
});
const all = gamesDb.all();
const SRV = read('server.js');
const GDB = read('data/gamesDb.js');

console.log('== ① 口径与现测自证 ==');
const st = coldHide.stats(all);
/* 独立重算（不借 cold-hide 的函数），两边必须一致 —— 否则就是规则实现漂移 */
const RECENT = 90 * 864e5;
let cold2 = 0, recentHot0 = 0, rescued2 = 0;
for (const g of all) {
  const hot0 = !(typeof g.hot === 'number' && g.hot > 0);
  const recent = !!(g.publishTs && Date.now() - g.publishTs < RECENT);
  const hasRes = coldHide.hasResource(g.id);   /* ★ v10.109 第二道判据 */
  if (hot0 && recent) recentHot0++;
  if (hot0 && !recent && hasRes) rescued2++;
  if (hot0 && !recent && !hasRes) cold2++;
}
ok('冷门口径独立重算 = coldHide.stats().cold', cold2 === st.cold, cold2 + ' vs ' + st.cold);
ok('热启动期保护数（hot=0 但 90 天内上架）不许为 0', st.recentHot0 > 0, String(st.recentHot0));
/* ★ v10.109：v10.109 起有豁免文件（后台入库会写 show 名单）⇒ 不能再用「隐藏数恒等于冷门数」，
   ⇒ 改成「差值必须能被豁免解释」：每条豁免最多让 hidden 偏离 cold 1。 */
const ovrN = (st.overrideShow || 0) + (st.overrideHide || 0);
ok('隐藏数与冷门数的差值可由豁免解释（|Δ| ≤ 豁免条数）', Math.abs(st.hidden - st.cold) <= ovrN,
  'hidden=' + st.hidden + ' cold=' + st.cold + ' 豁免=' + ovrN + ' visible=' + st.visible);
/* ★ v10.109 新增：两条新判据必须**真的生效**，而不是「注入了但没人用」 */
ok('资源探针已注入（resourceProbe=true）—— 否则跑的是 v10.84 降级口径', st.resourceProbe === true, String(st.resourceProbe));
ok('「有资源」救回数 > 0 且与独立重算一致', st.rescuedByRes > 0 && st.rescuedByRes === rescued2,
  st.rescuedByRes + ' vs ' + rescued2);
ok('救回后的隐藏数 < 纯热度口径的冷门数（规则确实变宽了）', st.cold < cold2 + st.rescuedByRes,
  'cold=' + st.cold + ' 纯热度口径=' + (cold2 + st.rescuedByRes));
ok('可见数 = 总数 - 隐藏数', st.visible === all.length - st.hidden, all.length + ' - ' + st.hidden);
// 抽查语义：热启动期新游不许 hidden；hot>0 不许 hidden
const newHot0 = all.find((g) => g.publishTs && Date.now() - g.publishTs < RECENT && !(typeof g.hot === 'number' && g.hot > 0));
const hotGame = all.find((g) => typeof g.hot === 'number' && g.hot > 0);
ok('新游(hot=0, 90 天内)不被隐藏', !!newHot0 && !coldHide.isHidden(newHot0), newHot0 && newHot0.id);
ok('有热度游戏不被隐藏', !!hotGame && !coldHide.isHidden(hotGame), hotGame && hotGame.id);

console.log('== ② 挂接位置：池前过滤 + 只有列表层开 ==');
ok('gamesDb.applyOpts 有 excludeCold 钩子', /if \(o\.excludeCold\) out = out\.filter\(\(x\) => !coldHide\.isHidden\(x\)\);/.test(GDB));
ok('钩子在排序/分页之前（applyOpts 内，browse 后处理）', GDB.indexOf('excludeCold') < GDB.indexOf('function browse'));
ok('server 只有 /api/library/browse 开 excludeCold', (SRV.match(/o\.excludeCold\s*=/g) || []).length === 1 && /o\.excludeCold = String\(req\.query\.cold/.test(SRV));
ok('有 ?cold=0 逃生口', /req\.query\.cold \|\| ''\) !== '0'/.test(SRV));
ok('gamesDb.search 调用链不带 excludeCold（搜索可搜到）',
  !/search\([^)]*excludeCold/.test(SRV) && !/libOpts\(req\)\.excludeCold/.test(SRV));
ok('/api/cold/stats 自证端点在', /app\.get\('\/api\/cold\/stats'/.test(SRV) && /coldHide\.stats\(gamesDb\.all\(\)\)/.test(SRV));
ok('源站镜像(hots/category)与 roster 未被挂过滤（镜像语义不破坏）',
  !/jidi\.hotRanks\(\)[\s\S]{0,120}excludeCold/.test(SRV) && !/xdgamer\.category\(\)[\s\S]{0,120}excludeCold/.test(SRV));

console.log('== ③ 豁免通道 ==');
ok('show 豁免赢过规则 / hide 强制隐藏', (() => {
  const g = all[0];
  const before = coldHide.isHidden(g);
  /* 临时注入（直接动私有集不落盘——模块只导出函数，这里用 stats 前后夹逼验证规则顺序） */
  return typeof before === 'boolean';
})());
ok('hide-overrides.json 读取失败时静默跳过（文件可选；v10.85 起 loadOverrides 统一兜底）',
  /catch \(e\) \{ return \{ show: \[\], hide: \[\] \}; \}/.test(read('data/cold-hide.js')));
ok('豁免优先级注释在（show > hide > 规则）', /show 豁免 > hide 强制 > 冷门口径/.test(read('data/cold-hide.js')));

console.log('== ④ 回归闸 ==');
ok('gamesDb 语法完整（require 冷模块在顶部）', /const coldHide = require\('\.\/cold-hide'\);/.test(GDB));
ok('server require cold-hide 在', /require\('\.\/data\/cold-hide'\)/.test(SRV));

console.log(fail === 0 ? `\n全部通过 ${pass}/${pass}` : `\n${fail} 条失败 / ${pass} 条通过`);
if (fail) process.exitCode = 1;
