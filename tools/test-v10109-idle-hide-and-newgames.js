#!/usr/bin/env node
'use strict';
/**
 * tools/test-v10109-idle-hide-and-newgames.js — v10.109 防线
 *
 * 守两件今天新加的事：
 *   ① **冷门判定的第二道判据**：hot=0 且非近 90 天新游，**再加一道「无 MOD/修改器/存档」**
 *      （用户口径：「无人问津的游戏自动隐藏」→ 拍板「无热度且无任何下载入口才藏」）
 *   ② **新游检测**：源站出现了、库里没有的条目进候选池，由用户决定入库/忽略
 *      （用户口径：「遇到新游戏则在这里，我来决定是入库」）
 *
 * ★ 全部数字**现测**，不写死（daily-sync 每天在改库）。
 * ★ ②的写操作跑在 `_tmp/` 里的隔离文件上，**不碰** data/new-games.json
 *   —— 那是用户的决策记录，跑一次测试清空一次就等于「测试把用户的忽略名单吃了」。
 *
 * 四段：
 *   A 冷门第二道判据（纯模块，注入式探针的降级/生效两条路都要验）
 *   B 候选池状态机（隔离文件）
 *   C 服务端路由与鉴权（静态 + 结构）
 *   D 后台 UI 结构（静态）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  [' + detail + ']' : '')); }
}

const SERVER = read('server.js');
const ADMIN = read('public/admin.html');
const COLD = read('data/cold-hide.js');
const NG = read('data/new-games.js');

/* ═══════════════ A. 冷门第二道判据 ═══════════════ */
console.log('\n== A. 冷门判定：无热度 + 非新游 + 无资源 才藏 ==');

const coldHide = require(path.join(ROOT, 'data/cold-hide.js'));

/* A1 未注入 ⇒ 必须退回 v10.84 口径（不能因为缺依赖就把所有游戏都藏了） */
ok('A1 未注入资源探针时 hasResource 恒为 false（退回旧口径，不是全藏）',
  coldHide.hasResource('xd-1') === false && coldHide.stats([]).resourceProbe === false);

/* A2 注入一个**只含一条**的集合，验证 isCold 的三条分支 */
const RES_ID = 'xd-test-withres';
let providerCalls = 0;
coldHide.setResourceProvider(() => {
  providerCalls++;
  return new Set([RES_ID]);
});
const OLD = Date.now() - 200 * 864e5;   // 200 天前上架 ⇒ 不在热启动期
const gNoHotNoRes = { id: 'xd-test-plain', hot: 0, publishTs: OLD };
const gNoHotWithRes = { id: RES_ID, hot: 0, publishTs: OLD };
const gHasHot = { id: 'xd-test-hot', hot: 1234, publishTs: OLD };
const gGrace = { id: 'xd-test-grace', hot: 0, publishTs: Date.now() - 5 * 864e5 };
const gNoHotNoDate = { id: 'xd-test-nodate', hot: undefined };

ok('A2 hot=0 + 老游 + 无资源 ⇒ 判冷', coldHide.isCold(gNoHotNoRes) === true);
ok('A3 hot=0 + 老游 + **有资源** ⇒ 不判冷（第二道判据生效）', coldHide.isCold(gNoHotWithRes) === false);
ok('A4 hot>0 ⇒ 永远不判冷（有热度这条不受影响）', coldHide.isCold(gHasHot) === false);
ok('A5 近 90 天新游 ⇒ 不判冷（热启动期保护没被新判据覆盖掉）', coldHide.isCold(gGrace) === false);
ok('A6 缺 publishTs 且 hot 缺失 ⇒ 判冷（缺日期视同老游，与 v10.84 一致）', coldHide.isCold(gNoHotNoDate) === true);

/* A7 stats 的三项计数同源：cold + rescuedByRes = 纯热度口径 */
const st = coldHide.stats([gNoHotNoRes, gNoHotWithRes, gHasHot, gGrace, gNoHotNoDate]);
ok('A7 stats: cold=2（plain + nodate）', st.cold === 2, String(st.cold));
ok('A8 stats: rescuedByRes=1（withres）', st.rescuedByRes === 1, String(st.rescuedByRes));
ok('A9 stats: recentHot0=1（grace）', st.recentHot0 === 1, String(st.recentHot0));
ok('A10 stats: resourceProbe=true 且 visible = total - hidden',
  st.resourceProbe === true && st.visible === 5 - st.hidden, st.hidden + '/' + st.visible);

/* A11 缓存：同一 TTL 内只算一次 provider（否则列表过滤会反复 build，实测 build 要 1.6s） */
const before = providerCalls;
coldHide.hasResource('xd-a'); coldHide.hasResource('xd-b'); coldHide.hasResource('xd-c');
ok('A11 资源集合在 TTL 内只构建一次（不会每条都重算）', providerCalls === before,
  'provider 被调 ' + (providerCalls - before) + ' 次（应为 0）');

/* A12 reload 作废缓存 —— 否则后台改完数据要等 30 分钟才生效 */
coldHide.reload();
coldHide.hasResource('xd-a');
ok('A12 reload() 会作废资源缓存（改完立即生效，不等 TTL）', providerCalls === before + 1,
  'provider 被调 ' + (providerCalls - before) + ' 次（应为 1）');

/* A13 口径文案必须与实现一致 —— 这行字是用户判断「规则到底是什么」的唯一入口 */
ok('A13 rule 文案包含「无可用资源」（口径变了，文案必须跟着变）', /无可用资源/.test(st.rule), st.rule);
ok('A14 server.js 注入了资源探针（否则线上跑的是降级口径）',
  /coldHide\.setResourceProvider\(/.test(SERVER));

/* A15 防循环依赖：cold-hide 不许自己 require res-groups
 * ★ 必须先剥注释再判 —— 文件头那段「为什么不能 require('./res-groups')」的**说明文字**
 *   本身就带着这个字符串，直接判会永远是红的（本项目踩过「注释咬负向断言」多次）。 */
const COLD_CODE = COLD.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
ok('A15 cold-hide 不 require res-groups（注入式，避免 res-groups↔gamesDb↔cold-hide 循环）',
  !/require\(['"]\.\/res-groups/.test(COLD_CODE));

/* 还原探针，避免影响后续段（B 段不依赖它） */
coldHide.setResourceProvider(null);

/* ★ admit/scan 都是 async ⇒ B 段起整段包进 IIFE 并 await（CJS 没有顶层 await）。
   A 段留在外面：纯同步，失败也不该被 Promise 的异常吞掉。 */
(async () => {
/* ═══════════════ B. 新游候选池状态机（隔离文件） ═══════════════ */
console.log('\n== B. 新游检测：扫描不写库 / 入库 / 忽略 / 退回 ==');

const TMP = path.join(ROOT, '_tmp');
fs.mkdirSync(TMP, { recursive: true });
const TMPFILE = path.join(TMP, '_test-new-games-' + process.pid + '.json');
try { fs.unlinkSync(TMPFILE); } catch (e) { /* 不存在正常 */ }

const newGames = require(path.join(ROOT, 'data/new-games.js'));
newGames._setFile(TMPFILE);
/* ★ 豁免文件也要隔离：admit 会写 show 名单，写真实文件 = 改用户的决定。
   实测教训 —— 第一版没隔离，把真实游戏 xd-8149 写进了 data/hide-overrides.json 的 show，
   而且因为「清理条件依赖 beforeShow」不幂等，**跑第二次就清不掉了**。 */
const TMPOVR = path.join(TMP, '_test-overrides-' + process.pid + '.json');
coldHide._setOverrideFile(TMPOVR);
ok('B1 _setFile 把候选池指向 _tmp（不碰真实 data/new-games.json）',
  newGames._file === TMPFILE, newGames._file);
ok('B2 初始池是空的', newGames.stats().total === 0);

/* B3 扫描**绝不写库** —— 这是本模块与增量索引的根本区别，必须静态钉住 */
const scanBody = (() => {
  const i = NG.indexOf('async function scan(');
  /* ★ 下一个顶层函数**可能是 async 的**（admit 就是）—— 只找 '\nfunction ' 会越过它，
     把 admit 里的 upsert 切进来，于是「scan 不写库」这条断言永远红。
     ⇒ 两种前缀都认，取更近的那个。 */
  const cands = [NG.indexOf('\nfunction ', i + 10), NG.indexOf('\nasync function ', i + 10)]
    .filter((x) => x > 0);
  const j = cands.length ? Math.min(...cands) : -1;
  return NG.slice(i, j > 0 ? j : i + 6000);
})();
ok('B3 scan() 函数体内不调用 upsert / persist（扫描只比对，不写库）',
  !/\.upsert\(/.test(scanBody) && !/\.persist\(/.test(scanBody));
ok('B4 scan() 用 id 差集判定「库里没有」（不是按日期字段筛）',
  /gamesDb\.byIdGet\(g\.id\)/.test(scanBody));

/* B5 用一条**已在库中**的真实 id 造候选：admit 时 upsert 走 updated 分支，不新增行
 *
 * ★★ v10.109 修：B 段必须连**库**一起隔离。
 *    第一版只隔离了候选池（`_setFile`），而 `admit` 的 upsert/persist 写的是**真实**
 *    `data/games.json` —— 实测把真实游戏 `xd-8149`（玩偶冒名者，url 正常）整条覆盖成了
 *    本夹具的内容（标题变成「点老救世记/dotAGE」、url 变空），当场没有任何断言变红，
 *    是另一套无关的 `test-v1015`（库内每条 url 都要能通过详情页正则）先红的。
 *  ⇒ 夹具 id 也从真实库里取，但**读写都走内存假库**。 */
const realDb = require(path.join(ROOT, 'data/gamesDb.js'));
realDb.load();
const existing = realDb.all()[0];
const GAMES_FILE = path.join(ROOT, 'data', 'games.json');
const realBytesBefore = fs.readFileSync(GAMES_FILE);
let persistCalls = 0;
const fakeRows = new Map([[existing.id, { ...existing }]]);
const fakeDb = {
  all: () => Array.from(fakeRows.values()),
  byIdGet: (id) => fakeRows.get(id) || null,
  upsert: (rows) => {
    for (const r of rows || []) fakeRows.set(r.id, { ...(fakeRows.get(r.id) || {}), ...r });
  },
  persist: () => { persistCalls++; },
};
newGames._setDb(fakeDb);
const fake = {
  id: existing.id, source: 'xdgamer', title: existing.title, cover: existing.cover,
  genres: [], size: '', score: null, dateLabel: '', publishTs: null, updatedTs: null,
  url: '', firstSeen: Date.now(), status: 'pending', admitAt: null, note: '',
};
/* 直接落在隔离文件里，再让模块读回来 —— 避免依赖 scan 的网络 */
fs.writeFileSync(TMPFILE, JSON.stringify({ generatedAt: Date.now(), lastScanAt: 0, lastScanPages: 0, candidates: [fake] }, null, 1));
newGames._setFile(TMPFILE);
ok('B5 隔离文件里的候选被读回（total=1, pending=1）',
  newGames.stats().total === 1 && newGames.stats().pending === 1, JSON.stringify(newGames.stats()));

/* B6 忽略 */
const igr = newGames.ignore([existing.id]);
ok('B6 ignore 后状态为 ignored', igr.ignored.length === 1 && newGames.stats().ignored === 1);
const onDisk = JSON.parse(fs.readFileSync(TMPFILE, 'utf8'));
ok('B7 ignore 立刻落盘（不是只改内存）', onDisk.candidates[0].status === 'ignored');

/* B8 恢复 */
const rst = newGames.restore([existing.id]);
ok('B8 restore 后退回 pending（忽略不是永久判决）',
  rst.restored.length === 1 && newGames.stats().pending === 1);

/* B9 入库：upsert 不新增行（id 已在库）+ 写 show 豁免 */
const beforeTotal = fakeDb.all().length;
const beforeShow = coldHide.overridesSnapshot().show.slice();
const adm = await newGames.admit([existing.id]);
ok('B9 admit 返回 admitted 且不新增库内行数（同 id 走 updated 分支）',
  adm.admitted.length === 1 && fakeDb.all().length === beforeTotal,
  beforeTotal + ' → ' + fakeDb.all().length);
/* ★★ v10.109：这条断言是本轮**最该有**的一条 —— 它专门盯「测试把真实库写坏」。
 *   判据不看「总量不变」，而是看**字节**：假库接得住，真实文件就必须一个字节都不动。 */
ok('B9b admit 走假库 ⇒ 真实 data/games.json 字节不变（测试不许改用户数据）',
  Buffer.compare(realBytesBefore, fs.readFileSync(GAMES_FILE)) === 0,
  realBytesBefore.length + 'B → ' + fs.statSync(GAMES_FILE).size + 'B');
ok('B9c admit 只对假库 persist 一次（真实 persist 一次都没被调）',
  persistCalls === 1, 'persistCalls=' + persistCalls);
ok('B10 admit 后候选状态 = admitted', newGames.stats().admitted === 1);
ok('B11 admit 把该 id 写进了 show 豁免（强制可见，不靠热度规则以后也不藏它）',
  coldHide.overridesSnapshot().show.includes(existing.id));

/* B12 入库不存在的候选 ⇒ skipped，不抛（接口层要靠这个区分 400/500） */
let threw = false, skipRes = null;
try { skipRes = await newGames.admit(['xd-not-a-real-candidate-' + Date.now()]); } catch (e) { threw = true; }
ok('B12 admit 未知 id ⇒ 进 skipped 而不是抛异常', !threw && skipRes && skipRes.skipped.length === 1);

/* B13 上限裁剪只裁已处理的，pending 一条不许丢 */
ok('B13 裁剪逻辑保留 pending（注释与代码都指向同一件事）',
  /只裁已处理的|pending 一条不动|MAX_CANDIDATES - pending\.length/.test(NG));

/* 清理：把两个模块都指回真实文件，删掉临时产物。
 * ★ 顺序不能反 —— 先把文件删了再指回去，模块下次 load 会读到一个不存在的路径（静默空池）。
 * ★ 这里的 beforeShow 只用于打印，不再承担「要不要清理」的判定：
 *   豁免写在隔离文件里，真实文件**从头到尾没被碰过**。 */
try {
  if (newGames._file === TMPFILE) newGames._setFile(path.join(ROOT, 'data', 'new-games.json'));
  newGames._setDb(null);
  coldHide._setOverrideFile(path.join(ROOT, 'data', 'hide-overrides.json'));
} catch (e) { /* 指回失败不影响断言结果 */ }
for (const f of [TMPFILE, TMPOVR]) { try { fs.unlinkSync(f); } catch (e) { /* 不存在正常 */ } }
void beforeShow;

/* ═══════════════ C. 服务端路由与鉴权 ═══════════════ */
console.log('\n== C. 服务端：5 个端点 · 全部鉴权 · 扫描有并发锁 ==');

const ROUTES = [
  "app.get('/api/admin/new-games'",
  "app.post('/api/admin/new-games/scan'",
  "app.post('/api/admin/new-games/admit'",
  "app.post('/api/admin/new-games/ignore'",
  "app.get('/api/admin/new-games/stats'",
  "app.post('/api/admin/new-games/restore'",
];
ok('C1 六个端点全部注册', ROUTES.every((r) => SERVER.includes(r)),
  ROUTES.filter((r) => !SERVER.includes(r)).join(' '));

/* 逐个端点确认下一行就调了 adminGuard —— 候选池是未发布的源站条目，不能公开 */
const guarded = ROUTES.map((r) => {
  const i = SERVER.indexOf(r);
  const seg = SERVER.slice(i, i + 260);
  return /adminGuard\(req, res\)/.test(seg);
});
ok('C2 每个端点都先过 adminGuard（候选池不公开）', guarded.every(Boolean),
  guarded.map((x, i) => (x ? '' : ROUTES[i])).filter(Boolean).join(' '));

ok('C3 扫描有并发锁：进行中回 409（连点不会把源站当压测目标）',
  /busy\s*\?\s*409/.test(SERVER) && /扫描进行中/.test(NG));
ok('C4 admit 后让冷门资源表作废（新条目的资源情况要重算）',
  /newGames\.admit[\s\S]{0,400}coldHide\.reload\(\)/.test(SERVER));
ok('C5 admit 会 appendAdminLog（入库是人工决策，必须留痕）',
  /ng-admit/.test(SERVER) && /ng-ignore/.test(SERVER) && /ng-restore/.test(SERVER));
ok('C6 new-games 模块被 server 顶层 require（路由才能用）',
  /require\('\.\/data\/new-games'\)/.test(SERVER));

/* ═══════════════ D. 后台 UI 结构 ═══════════════ */
console.log('\n== D. 后台：入口 · 视图 · 函数 · 口径文案 ==');

const navCount = (ADMIN.match(/<a data-v="/g) || []).length;
ok('D1 侧栏含「新游检测」且总数 = 8', /data-v="new"/.test(ADMIN) && navCount === 8, '侧栏 ' + navCount + ' 项');
ok('D2 VIEWS 注册了 new（否则 go() 会回落仪表盘）', /\n  new: \['新游检测'/.test(ADMIN));
ok('D3 #view-new 视图存在且只有一个', (ADMIN.match(/id="view-new"/g) || []).length === 1);
ok('D4 go() 有 new 分支', /if \(v === 'new'\) newReload\(true\)/.test(ADMIN));
ok('D5 五个前端函数都在',
  ['function ngRow', 'async function newReload', 'async function newScan', 'async function ngAdmit', 'async function ngIgnore', 'async function ngRestore']
    .every((f) => ADMIN.includes(f)));
ok('D6 侧栏角标 = 待处理数（不是总数）', /j\.pending/.test(ADMIN) && /id="nNew"/.test(ADMIN));

/* D7 仪容：扫描主色实底、行内入库描边（一屏几十个实底按钮会互相稀释） */
ok('D7 行内「入库」是描边按钮（ng-go），只有页头「扫描源站」用主色实底',
  /class="btn sm ng-go"/.test(ADMIN) && /\.btn\.ng-go\{border-color/.test(ADMIN)
  && !/class="btn sm pri" onclick="ngAdmit/.test(ADMIN));

/* D8 口径文案必须与实现同源 —— 仪表盘那行字是用户唯一能看到的规则说明 */
ok('D8 仪表盘口径文案含「无 MOD/修改器/存档」', /且无 MOD\/修改器\/存档/.test(ADMIN));
ok('D9 统计卡「冷门隐藏」说明不再是旧的「hot=0 且非新游」', /无热度·非新游·无资源/.test(ADMIN)
  && !/\['冷门隐藏', nf\(c\.hidden\), 'dan', 'hot=0 且非新游'\]/.test(ADMIN));

/* D10 空态必须说「点扫描」，而不是只写「暂无数据」 */
ok('D10 空态引导到「扫描源站」这个动作', /点「扫描源站」/.test(ADMIN));

/* D11 时间列不重复（上架与更新同一天只写一次） */
ok('D11 上架/更新同一天只显示一行（实拍 21 行里 19 行是重复的）',
  /Math\.abs\(g\.updatedTs - g\.publishTs\) > 864e5/.test(ADMIN));

console.log('\n' + (fail ? '❌ ' : '✅ ') + '通过 ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log('\n❌ 运行期异常：' + (e && e.stack || e));
  process.exit(1);
});
