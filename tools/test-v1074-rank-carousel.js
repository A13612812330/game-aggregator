/* tools/test-v1074-rank-carousel.js — 第一层（静态/离线）：验收「首页榜单改轮播 + 13 个」这一版
 *
 * v10.74 新增。用户原话（2026-10-14）：
 *   「首页的榜单优化下前五做成轮播图，后面的五个一行一共两行，一共显示13个游戏
 *    （轮播图5个+8个卡片 两行）卡片我需要放大一点」
 *   ★ 原话里「五个一行两行」（=15）与「13 个（轮播5+8）」**互相矛盾**，已当面确认取 **13**。
 *
 * 覆盖四块：
 *   A. 补位纯函数 `data/rank-fill.js` —— 源站每档只 SSR 10 行（全站榜剔工具后 9 行），
 *      而首页要展示 13 个 ⇒ 尾部由**本地库热度**补足，且补位条目必须**可区分**。
 *   B. 服务端接线（`/api/rank`）—— 三处 slice 的上限、meta 如实下发补位条数。
 *   C. `xdrank.cleanPlate` 的截断语义（本版**去掉了写死的 10**，职责上移到展示层）。
 *   D. 主源结构（轮播 / 4 列 2 行 / 卡片放大 / 补位标记 / 定时器纪律）+ 五页同步。
 *
 * ★ 为什么 A 段用**造假数据**而不是打真源站：
 *   源站状态会变、也会抽风（本轮实测机地热榜锚点页连续 `HTTP 544`）。
 *   把防线绑在别人家的可用性上，红了也分不清「我们坏了」还是「人家抽风」。
 *   真实源站的结论由一次性实测记录（见 docs/versions/v10.74.md）。
 *
 * ★ 本套件**不打网络**、**不碰端口**，纯读文件 + 跑纯函数，可在任何时刻单跑。
 *
 * 跑法：node tools/test-v1074-rank-carousel.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const idx = read('public/index.html');
const PAGES = ['public/index.html', 'public/emulator.html', 'public/unpack.html', 'public/resources.html', 'public/extract.html'];
const src = {};
for (const p of PAGES) src[p] = read(p);
const sv = read('server.js');
const xdr = read('fetchers/xdrank.js');

/* ★ 剥注释（沿用 test-v1057 / test-v1070-sort-keys 的既有写法）。
   为什么 C 段必须有它：负向判据若跑在**未剥注释**的源码上，会被「说明这次改动的注释」
   骗成假红 —— 本套件首次跑就是这样（fetchers/xdrank.js 的注释里逐字写了
   `` `clean.slice(0, 10)` ``，于是「源码里已无此写法」判据咬到了那段说明）。
   这与 PITFALLS 104 是同一个坑：**判源码的字符串，先剥注释**。 */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}
const xdrC = stripComments(xdr);
/* ★★ 剥注释后的主源 —— **判源码字符串的断言必须用它**。
   本套件 C 段（fetchers/xdrank）早就记过这条教训（PITFALLS 104：判源码的字符串先剥注释），
   而 v10.75 加 D17b 时**又踩了同一个坑**：那条断言的判据里正好逐字写了
   `` `.rk-car{height:132px}` ``，于是被「解释这次删除」的注释自己咬中 ⇒ 假红。
   ⇒ 凡是「源码里已无 X」的负向判据，一律跑在剥注释后的文本上。 */
const idxC = stripComments(idx);

const rf = require('../data/rank-fill');

/* ★★ v10.75 变更（本段的口径来源，务必看）：
 *   展示数由 **13**（轮播 5 + 卡片 4 列 ×2 行 = 8）改为 **11**（轮播 5 + 卡片 3 列 ×2 行 = 6）。
 *   ⇒ 本段的条数断言**全部改为按 `rf.RANK_SHOW_N` 推导**，不再写死 13。
 *   上一版写死 13，v10.75 一改展示数就**整段红**（16 条红里有 10 条只是这个原因）——
 *   那不是「防线抓到缺陷」，是「防线把实现常量抄成了自己的常量」。
 *   参数化之后：下轮再改展示数，本段一条都不用动。 */
const N = rf.RANK_SHOW_N;   // 首页展示数（v10.75 = 11）
/* ★★ 源站条数取 `N - 3`（而不是写死 8/10）⇒ 补位恒为 **3 条**。
   为什么必须让补位数 ≥2：A7「补位按 hot 降序」用 `every` 判单调性，而 **`every` 在单元素
   数组上恒为 true** —— 展示数改 11 之后若源站仍造 10 条，补位只剩 1 条，A7 就**退化假绿**
   （v10.75 的反证 ⑦ 正是这么照出来的：打坏降序后 A7 没红，倒是 A8 红了）。
   这里的教训是「参数化不能只参数化断言，**造数据的规模**也要跟着推导」。 */
const SRCN = N - 3;
const FILLN = N - SRCN;     // 需要补几条（恒 3）

let pass = 0; let fail = 0;
function chk(name, ok, extra) {
  if (ok) { pass++; console.log('  ✅ ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '   ' + extra : '')); }
}
function hr(t) { console.log('\n' + '─'.repeat(74) + '\n' + t + '\n' + '─'.repeat(74)); }

/* ============================================================
   A. 补位纯函数（离线，假数据）
   ============================================================ */
hr('A. data/rank-fill.js —— 源站不够 13 条时用本地库热度补位');

/* 造数据。
   源站榜 10 条：title `游戏1`..`游戏10`，url `game/1.html`..`game/10.html`。
   本地库：① 10 条与源站榜 **同名**（必须被去重排除，否则首页同一款占两个位）
          ② 8 条补位候选（hot 300 递减）
          ③ 3 条**必须被排除**的：工具条目 / 无封面 / hot=0 */
const mk = (n, o) => Object.assign({
  id: 'xd-' + n, title: '库游戏' + n, url: 'https://www.xdgame.com/game/' + n + '.html',
  hot: 5000 - n, cover: 'https://img/' + n + '.jpg', genres: ['动作'], size: '5GB',
}, o || {});
const LIB = [];
for (let i = 1; i <= SRCN; i++) LIB.push(mk(100 + i, { title: '游戏' + i }));   // ① 同名去重
for (let i = 0; i < 8; i++) LIB.push(mk(200 + i, { hot: 300 - i }));          // ② 候选
LIB.push(mk(301, { hot: 9999, title: 'XDGAME游戏运行库检测工具206.04.13' })); // ③ 工具条目
LIB.push(mk(302, { hot: 9998, cover: '' }));                                  // ③ 无封面
LIB.push(mk(303, { hot: 0 }));                                                // ③ hot=0
const SRC = Array.from({ length: SRCN }, (_, i) => ({
  id: 'xd-' + (i + 1), title: '游戏' + (i + 1), url: 'https://www.xdgame.com/game/' + (i + 1) + '.html',
  hot: 999999, cover: 'https://img/src' + i + '.jpg', genres: ['动作'], size: '10GB', rank: i + 1,
}));

const r1 = rf.fillRank(SRC, LIB);
chk('A1 ★ 源站 ' + SRCN + ' 条 → 补足到 ' + N + ' 条', r1.list.length === N, '实际 ' + r1.list.length + ' 条');
chk('A2 ★★ 如实回带 srcN=' + SRCN + ' / filled=' + FILLN + '（前端 meta 要说明「含几条补位」）',
  r1.srcN === SRCN && r1.filled === FILLN, 'srcN=' + r1.srcN + ' filled=' + r1.filled);
const tail = r1.list.slice(SRCN);
chk('A3 ★★ 补位条目带 `filled:true`，且名次连续 ' + (SRCN + 1) + '…' + N,
  tail.length === FILLN && tail.every((x) => x.filled === true)
    && tail.map((x) => x.rank).join(',') === Array.from({ length: FILLN }, (_, i) => SRCN + 1 + i).join(','),
  'ranks=' + tail.map((x) => x.rank).join(',') + ' filled=' + tail.map((x) => !!x.filled).join(','));
chk('A4 ★★ 去重：源站榜已有的 title 不会被补进来（同款不许占两个位）',
  !r1.list.some((x) => x.filled && /^游戏\d+$/.test(String(x.title))),
  '补位 title=' + tail.map((x) => x.title).join(' | '));
chk('A5 ★★ 工具条目（运行库 / 检测工具）不许被补进来（与源站 cleanPlate 同口径）',
  !r1.list.some((x) => /(运行库|检测工具)/.test(String(x.title || ''))));
chk('A6 ★★ 补位条目**必须有封面**（首页展示位，色块卡的观感代价大于少补一条）',
  tail.every((x) => !!x.cover), 'cover=' + tail.map((x) => (x.cover ? '有' : '无')).join(','));
/* ★ 前置 `tail.length >= 2` 是**必须的**：`every` 在单元素数组上恒为 true，
   补位只剩 1 条时这条会退化成假绿（v10.75 的反证 ⑦ 实测：打坏降序后 A7 没红）。
   ⇒ 凡「单调性 / 有序性」断言，先断言样本量够，否则守的是一个恒真的命题。 */
chk('A7 ★ 补位按 hot 降序（单调不增）', tail.length >= 2 &&
  tail.every((x, i) => i === 0 || Number(tail[i - 1].hot) >= Number(x.hot)),
  '样本 ' + tail.length + ' 条 · hots=' + tail.map((x) => x.hot).join('>='));
chk('A8 ★★ 补进来的是**hot 最高的那 ' + FILLN + ' 条可用条目**（精确到 id，防「补错了条目」）',
  tail.map((x) => x.id).join(',') === Array.from({ length: FILLN }, (_, i) => 'xd-' + (200 + i)).join(','),
  'ids=' + tail.map((x) => x.id).join(','));
chk('A9 ★ 负向：补位条目的 hot 必须 > 0（0 / undefined 不许进首页）',
  tail.every((x) => Number(x.hot) > 0), 'hots=' + tail.map((x) => x.hot).join(','));

const r2 = rf.fillRank(SRC.concat(SRC.map((x, i) => ({ ...x, rank: i + 11, url: x.url + '?b' }))), LIB);
chk('A10 ★ 源站本来就够 ' + N + ' 条 ⇒ 一条不补（filled=0，不能画蛇添足）',
  r2.list.length === N && r2.filled === 0, 'n=' + r2.list.length + ' filled=' + r2.filled);

const r3 = rf.fillRank([], LIB);
chk('A11 ★ 源站 0 条（如机地锚点页 544）⇒ 全从库补，不崩',
  r3.list.length === N && r3.filled === N && r3.srcN === 0, 'n=' + r3.list.length + ' filled=' + r3.filled);

const r4 = rf.fillRank(SRC, []);
chk('A12 ★ 本地库为空 ⇒ 返回源站那几条，不崩、也不报错',
  r4.list.length === SRCN && r4.filled === 0, 'n=' + r4.list.length);

const r5 = rf.fillRank(null, null);
chk('A13 ★ 两个入参都是 null ⇒ 空数组返回，不抛', Array.isArray(r5.list) && r5.list.length === 0);

chk('A14 ★★ 常量口径：RANK_SHOW_N=' + N + ' · RANK_CAR_N=5（' + N + ' = 轮播 5 + 卡片 2 行 × 3 列 = 6）',
  rf.RANK_SHOW_N === 11 && rf.RANK_CAR_N === 5,
  rf.RANK_SHOW_N + ' / ' + rf.RANK_CAR_N + '（卡片位 ' + (N - rf.RANK_CAR_N) + '）');

/* A15 真库池子可用性 —— 补位池在真实数据上确实够用（不依赖网络，只读本地库） */
{
  const db = require('../data/gamesDb');
  db.load();
  const all = db.all();
  const fake = Array.from({ length: SRCN }, (_, i) => ({
    id: 'xd-none-' + i, title: '绝不存在的游戏标题ZZ' + i,
    url: 'https://www.xdgame.com/game/nonexist' + i + '.html', hot: 1, cover: 'x', rank: i + 1,
  }));
  const r = rf.fillRank(fake, all);
  const tl = r.list.slice(SRCN);
  chk('A15 ★★ 真库上跑得通：补足 ' + N + ' 条，且补位条目**全部有封面**',
    r.list.length === N && tl.length === FILLN && tl.every((x) => x.filled && x.cover),
    '库 ' + all.length + ' 条 → 补 ' + r.filled + ' 条，封面 ' + tl.filter((x) => x.cover).length + '/' + FILLN);
  chk('A16 ★ 真库补位条目的 hot 递减（排序真的生效，不是按数组顺序取前 ' + FILLN + '）',
    tl.every((x, i) => i === 0 || Number(tl[i - 1].hot) >= Number(x.hot)),
    'hots=' + tl.map((x) => x.hot).join('>='));
  /* ★ v10.75：补位条目也要带 `coverQ` —— meta 的「封面大图 n/m」按展示列表统计，
     补位条目若缺这个字段会被静默算成 0，指标偏低且没人知道为什么。 */
  chk('A17 ★ 补位条目带 `coverQ`（meta 封面统计按展示列表算，缺字段会静默算 0）',
    tl.every((x) => typeof x.coverQ === 'number'), 'coverQ=' + tl.map((x) => x.coverQ).join(','));
}

/* ============================================================
   B. 服务端接线
   ============================================================ */
hr('B. server.js —— /api/rank 接线');

chk('B1 ★ server.js 引入了补位模块', /const rankFill = require\('\.\/data\/rank-fill'\)/.test(sv));

/* ★★ v10.75：B2/B4/B5 由「匹配旧变量名」改为「匹配**当前**写法 + 断言语义」。
   上一版把 `fillRank(mapped, dbAll)` 这种**变量名**写进了判据，换源时变量从
   `mapped` 改成 `fused` ⇒ 三条一起红，读起来像缺陷，其实只是改名。
   ⇒ 判据改成「在 /api/rank 段内出现了调用」/「顺序关系成立」，与变量名解耦。
   ★ 先取段再判（scope 收窄）：整份 server.js 里 `fillRank(` 只出现一次也说不清
     它出现在哪个路由里 —— 这是 PITFALLS「作用域会假红也会假绿」的同一族。
   ★★ 取段方式本身也踩过坑：首版用 `/app\.get\('\/api\/rank'[\s\S]*?\n\}\);/`，
     靠「行首无缩进的 `});`」当结束锚 —— 而本文件的路由结束是**有缩进**的 `  });`，
     正则于是提前截断（实测只取到 2535 字符，还没到 `fillRank(` 那一行）⇒ B2 假红。
     ⇒ 改成用「下一个顶层 `\napp.` 之前」当边界，不依赖缩进风格。 */
const rankI = sv.indexOf("app.get('/api/rank'");
const rankJ = rankI < 0 ? -1 : sv.indexOf('\napp.', rankI + 10);
const rankSeg = rankI < 0 ? '' : sv.slice(rankI, rankJ < 0 ? sv.length : rankJ);
chk('B2 ★★ 真的调了 fillRank（不是只 import 了放着）',
  /\brankFill\.fillRank\(\s*\w+\s*,\s*dbAll\s*\)/.test(rankSeg), '/api/rank 段 ' + rankSeg.length + ' 字符');
chk('B3 ★★ meta 如实下发 srcN / filled / showN / carN（前端靠它说明「含几条库内补位」）',
  /srcN:\s*f\.srcN/.test(sv) && /filled:\s*f\.filled/.test(sv) &&
  /showN:\s*rankFill\.RANK_SHOW_N/.test(sv) && /carN:\s*rankFill\.RANK_CAR_N/.test(sv));
/* ★★ v10.75 语义变更：机地档**不再有「取前 N 条」这个动作** ——
   旧版因为机地锚点页只给 12 条、又要凑 13 个展示位，所以在这儿 slice。
   新版机地只做**融合的一侧**（12 条原样进 RRF），条数由融合决定，没有上限可写。
   ⇒ 断言从「用常量而不是写死 12」改为「**根本没有条数上限**」，这才是本条真正的意图
     （防的从来不是「写了 12」，而是「有人又在展示层写死一个数」）。 */
chk('B4 ★★ 机地档不再写死条数上限（它只是融合的一侧，展示数由 RANK_SHOW_N 决定）',
  /jidiKey\s*\?\s*jidi\.hotRanks\(\)/.test(rankSeg) && !/\.slice\(0,\s*(?:12|\d+)\)/.test(rankSeg),
  'rankSeg 里有 slice 上限 = ' + /\.slice\(0,\s*\d+\)/.test(rankSeg));
/* B5 的意图 =「先融合、再补位」，即补位看到的是**完整候选池**而不是被截断的一段。
   ★ 判据用**两个调用的相对位置**，不绑变量名（旧版绑了 `mapped`，换源即红）。 */
chk('B5 ★★ 顺序：先 rrfFuse 融合、再 fillRank 补位（补位必须看到完整候选池）',
  rankSeg.indexOf('rankFill.fillRank(') > rankSeg.indexOf('rankMerge.rrfFuse(')
    && rankSeg.indexOf('rankMerge.rrfFuse(') >= 0,
  'rrfFuse@' + rankSeg.indexOf('rankMerge.rrfFuse(') + ' fillRank@' + rankSeg.indexOf('rankFill.fillRank('));

/* ============================================================
   C. cleanPlate 的截断语义（本版去掉写死的 10）
   ============================================================ */
hr('C. fetchers/xdrank.js —— cleanPlate 不再自带「至多 10 条」');

const xd = require('../fetchers/xdrank');
{
  const many = Array.from({ length: 14 }, (_, i) => ({ gid: String(i), name: '游戏' + i, rank: i + 1 }));
  chk('C1 ★★ 不传 max ⇒ 不截断（源站给多少返回多少）', xd.cleanPlate(many).rows.length === 14,
    '实际 ' + xd.cleanPlate(many).rows.length);
  chk('C2 ★ 传 max 才截断（可选护栏仍在）', xd.cleanPlate(many, 13).rows.length === 13,
    '实际 ' + xd.cleanPlate(many, 13).rows.length);
  chk('C3 ★ 截断后名次仍连续 1..N（截断不能破坏重编号）',
    xd.cleanPlate(many, 13).rows.map((x) => x.rank).join(',') === Array.from({ length: 13 }, (_, i) => i + 1).join(','));
  /* ★ 阳性对照（先做，再断言）：剥注释不能把代码本身也剥没了。
     没有这条，C4 一旦「剥过头」就会变成**恒真**（PITFALLS：全绿要先排除全假）。 */
  chk('C4a ★ 阳性对照：剥注释后**真实代码**仍在（否则 C4 会退化成恒真）',
    xdrC.indexOf('const capped = Number(max) > 0 ? clean.slice(0, Number(max)) : clean;') !== -1 &&
    xdrC.indexOf('function cleanPlate(rows, max)') !== -1);
  chk('C4b ★ 阳性对照：剥注释的**确剥掉了注释**（含提到旧写法的那些说明）',
    stripComments('/* clean.slice(0, 10) */ const a = 1;').indexOf('slice(0, 10)') === -1 &&
    stripComments('// clean.slice(0, 10)\nconst b = 2;').indexOf('slice(0, 10)') === -1);
  /* ★ 负向：源码里不许再有 `clean.slice(0, 10)` 这个写法 ——
     它是「与首页展示数脱钩的第二个硬编码」，留着就会在未来静默砍数据。
     ★ 判据跑在 **xdrC（已剥注释）** 上：本套件首跑正是在这里被自己的注释骗成假红
       （注释里逐字写了旧写法），裸判 xdr 会咬到说明文字。 */
  chk('C4c ★★ 负向：剥注释后源码里已无 `clean.slice(0, 10)`（那个 10 从来没生效过，却会静默砍数据）',
    !/clean\.slice\(0, 10\)/.test(xdrC));
}

/* ============================================================
   D. 主源结构
   ============================================================ */
hr('D. public/index.html —— 轮播 / 4 列 2 行 / 卡片放大 / 补位标记');

for (const [fn, why] of [
  ['rkSlideHtml', '轮播单张'],
  ['rkCarouselHtml', '轮播容器'],
  ['rkCarMount', '挂载与起播'],
  ['rkCarStop', '停止定时器'],
  ['rkCarGo', '切换张'],
  ['rkCarPlay', '自动播放'],
]) {
  chk('D1 有 `function ' + fn + '`（' + why + '）', new RegExp('function ' + fn + '\\s*\\(').test(idx));
}

chk('D2 ★★ 负向：`champHtml` 已删干净（冠军卡被轮播取代，留着就是两套实现并存）',
  !/function champHtml\s*\(/.test(idx));
chk('D3 ★★ 负向：`.rk-champ` 样式与渲染都已清掉（五页都不许剩）',
  PAGES.every((p) => !/\.rk-champ/.test(src[p])),
  PAGES.filter((p) => /\.rk-champ/.test(src[p])).join(', ') || '五页皆无');

/* D4 ★★ 语义分离：`.cur` = 轮播当前张 / `.on` = rankMark 的详情联动高亮。
   两者混用 ⇒ 打开任意详情会把**所有** slide 一起点亮。CSS 与 JS 两处都要对。 */
chk('D4 ★★ slide 的可见性类用 `.cur`（CSS 里 `.rk-car .slide.cur{opacity:1…}`）',
  /\.rk-car \.slide\.cur\{opacity:1/.test(idx));
chk('D5 ★★ slide 的可见性类**不是** `.on`（负向：`.rk-car .slide.on` 会让 rankMark 点亮全部）',
  !/\.rk-car \.slide\.on\{/.test(idx));
chk('D6 ★★ JS 侧同步：模板用 `cur` 初值 + 切换用 `toggle(\'cur\'`',
  /class="slide\$\{i === 0 \? ' cur' : ''\}"/.test(idx) &&
  /s\.classList\.toggle\('cur', k === rkCarI\)/.test(idx));

/* D7 ★★ 位置断言（铁律 104：子串判据会被注释骗，所以判**先后**）——
   paintRank 里 `rkCarStop()` 必须在 `el.innerHTML` 赋值**之前**：
   否则旧轮播的定时器会继续操作已被替换掉的 DOM。 */
{
  const i = idx.indexOf('function paintRank()');
  const j = idx.indexOf('async function refreshRank', i);
  const body = i < 0 ? '' : idx.slice(i, j < 0 ? i + 2600 : j);
  const iStop = body.indexOf('rkCarStop()');
  const iHtml = body.indexOf('el.innerHTML');
  chk('D7 ★★ paintRank 里 `rkCarStop()` 在 `el.innerHTML` **之前**（先停再换，否则操作已销毁的 DOM）',
    iStop > -1 && iHtml > -1 && iStop < iHtml, 'stop@' + iStop + ' innerHTML@' + iHtml);
}
chk('D8 ★★ refreshRank 里有 rkCarStop() —— 它有三条出口都会换掉 #rankList 内容（骨架/错误块/真卡）',
  (() => {
    const i = idx.indexOf('async function refreshRank');
    const body = i < 0 ? '' : idx.slice(i, i + 900);
    return body.indexOf('rkCarStop()') > -1;
  })());

chk('D9 ★★ 分段用常量 `RK_CAR_N`（不是写死的 5）—— 服务端 meta 里下发的是同一个数',
  /list\.slice\(0, RK_CAR_N\)/.test(idx) && /list\.slice\(RK_CAR_N\)\.map\(rankCard\)/.test(idx));
/* ★★ v10.75：D10/D11 的**守点变了**（不是把阈值放宽）——
   v10.74 的「放大」= 卡片仍是**横条**、把封面从 42px 加到 72px；
   v10.75 的「放大」= 卡片改**上图下文竖卡**、封面**占满卡宽**（3 列时约 389px），
   并把 4 列收成 3 列。继续守「封面 72px」会在新结构下**恒红**，而且红得没有意义。 */
chk('D10 ★★ 桌面 `.rk-grid` 是 3 列（4 → 3 列是 v10.75「放大」的来源：列越少每列越宽）',
  /\.rk-grid\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\);gap:14px\}/.test(idx));
chk('D11 ★★ 卡片是「上图下文」竖卡 + 封面**占满卡宽**（v10.74 的横条 72px 封面已被取代）',
  /\.rk-card\{display:flex;flex-direction:column/.test(idx) &&
  /\.rk-card \.th\{position:relative;width:100%;aspect-ratio:var\(--cover-ar\)/.test(idx));
chk('D12 ★ 补位条目的两个标记都在：虚线边框 `.libsrc` + 副行 `.lib`',
  /\.rk-card\.libsrc\{border-style:dashed/.test(idx) && /\.rk-card \.bd \.s \.lib\{/.test(idx));
/* ★★ D13 必须**收窄到目标段**（这是反证照出来的假绿，不是我自己想到的）：
 *   首版判据是「`it.filled ? '📚 库内 ' + hot : '🔥 ' + hot` 在**整份文件**里出现」——
 *   而轮播模板 `rkSlideHtml` 里**也有一份**（写成 `… + hot + ' 热度'`，前缀完全相同）
 *   ⇒ 把**卡片侧**那处措辞打坏后，判据仍被轮播那一份满足，照样全绿。
 *   反证实测：打坏点 ④（卡片照常显示「🔥 x 热度」）让套件保持 **57 / 57**，这条就是假绿。
 *   ⇒ 改成从 `rankCard` / `rkSlideHtml` **各自的函数体**里取段，**两侧都必须有**。
 *   同族的坑本项目踩过多次：作用域太宽既会假绿（本条）也会假红（别的函数撑成命中）。 */
function bodyOf(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return '';
  const j = src.indexOf('\nfunction ', i + 1);
  return src.slice(i, j < 0 ? src.length : j);
}
{
  const cardSeg = bodyOf(idx, 'rankCard');
  const slideSeg = bodyOf(idx, 'rkSlideHtml');
  /* 阳性对照：两段都取到了，且**不是同一段** —— 否则上面的「收窄」等于没收窄。 */
  /* ★★ v10.75：D13 的**守点换了**（不是放宽）。
     v10.74 守「补位条目的热度措辞两处都换成 `📚 库内 x`」；
     v10.75 **整条热度展示被移除** —— 融合后两源数值口径不同（XD 给「575,280 热度」、
     机地给 9.6 分），相加或挑一个当「综合热度」都是**编数据**，所以改为展示两源各自的名次。
     ⇒ 改守**负向**：`rankCard` 与 `rkSlideHtml` 两个函数体里都不许再出现热量措辞。
     防的是下一轮有人「顺手把热度加回来」—— 一加回来就会与已有的两源名次并存，
     页面上出现**两个来源说不清的数字**，正是本轮删掉它的原因。
     ★ bodyOf 的收窄照旧（v10.74 由反证逼出来的），阳性对照 D13a 保留。 */
  chk('D13a ★ 阳性对照：rankCard / rkSlideHtml 两段都取到且互不相同',
    cardSeg.length > 200 && slideSeg.length > 200 && cardSeg !== slideSeg,
    'card ' + cardSeg.length + ' 字符 / slide ' + slideSeg.length + ' 字符');
  /* ★★ 判据第一版写成「段内不含『热度』二字」⇒ **假红**：
     `rankCard` 的 title 提示里有一句「（本地库热度补位）」，那是在**说明数据来源**
     （该条目按库内热度排序补进来），不是展示热度数字 —— 把说明文字也判掉属于判据过宽。
     ⇒ 改判「不渲染热度数字」：`🔥` 符号 + `fmtHot(` 调用（`fmtHot` 是唯一的格式化入口）。
     同族教训：**判源码字符串时，要判「实现」而不是「词」** —— 一个词在说明文字里出现
     是合法的，判词必然假红或假绿。 */
  chk('D13 ★★ 负向：卡片与轮播模板都**不再渲染热度数字**（融合后两源口径不同，不许编一个综合热度）',
    !/🔥/.test(cardSeg) && !/🔥/.test(slideSeg)
      && !/fmtHot\(/.test(cardSeg) && !/fmtHot\(/.test(slideSeg),
    'card 🔥=' + /🔥/.test(cardSeg) + ' fmtHot=' + /fmtHot\(/.test(cardSeg)
      + '｜slide 🔥=' + /🔥/.test(slideSeg) + ' fmtHot=' + /fmtHot\(/.test(slideSeg));
  /* ★ 正向对照：删掉热度之后**不能什么都不显示** —— 轮播必须给出两源名次（可追溯的事实）。
     没有这条，「有人把 meta2 整行删掉」也会让 D13 保持绿（负向断言的天然漏洞）。 */
  chk('D13b ★★ 正向对照：轮播改显示**两源名次**（删热度不能变成什么都不显示）',
    /srcRank/.test(slideSeg) && /'XD #'|XD #/.test(slideSeg), 'slide 引用了 srcRank');
}

/* D14 ★★ 轮播容器**只在 JS 里**创建。
   理由：派生页由 page-assets.scriptForSubpage() 从主源整段抽走脚本，而 `#rankStage`
   节点只存在于首页 ⇒ 静态 DOM 在派生页会变成孤儿（v10.73 的浮层踩过同一条）。
   判据用「出现次数 + 位置」：静态写一个会让计数变 2，或让位置跑到函数定义之前。 */
{
  const n = (idx.match(/<div class="rk-car"/g) || []).length;
  chk('D14 ★★ 轮播容器只在 JS 里创建（HTML 里没有静态标签）',
    n === 1 && idx.indexOf('<div class="rk-car"') > idx.indexOf('function rkCarouselHtml'),
    '出现 ' + n + ' 次');
}
chk('D15 ★ 自动播放有纪律：固定间隔常量 + 悬停暂停 + 页面隐藏暂停',
  /const RK_CAR_MS = \d+/.test(idx) && /addEventListener\('mouseenter', rkCarStop\)/.test(idx) &&
  /addEventListener\('mouseleave', rkCarPlay\)/.test(idx) && /visibilitychange/.test(idx));
/* ★★ v10.75：真卡高度不再是定值（`aspect-ratio` 按容器宽算）⇒ **骨架也不能再写死 px**。
   判据从「等于 200px / 61px」改为「与真卡**同结构**」：图区用同一个 `--cover-ar`、文字区固定高。
   守的还是同一件事（骨架→真卡不抖），换的是表达方式 —— 写死 px 在改比例那一刻就失准了。 */
chk('D16 ★★ 骨架与真卡**同结构**（图区 `aspect-ratio:var(--cover-ar)` + 文字区 64px），不写死高度',
  /aspect-ratio:var\(--cover-ar\);border-radius:var\(--cd-r\) var\(--cd-r\) 0 0/.test(idx) &&
  /height:64px;border-radius:0 0 var\(--cd-r\) var\(--cd-r\)/.test(idx) &&
  !/<div class="rk-skel" style="height:200px/.test(idx));
chk('D17 ★★ 移动端卡片区是 2 列网格（不是横滑单行）',
  /\.rk-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:10px\}/.test(idx));
/* ★★ v10.75 新增守点：移动端**不许再写死轮播高度**。
   ⚠️ 危害比「高度被写回定值」大得多 —— 实测反证（390 视口，动态注入 height 看 rect）：
       无 height → `.rk-car` **350×164**（撑满内容区）
       height:132px → **282×132**（宽度被反算 132×2.14）
       height:200px → **428×200**（**超出父容器 350** ⇒ 横向溢出）
   ⇒ `aspect-ratio` 与确定 `height` 并存时，`width:auto` 由 height × ratio 推出，
     **不是撑满父容器**。所以 v10.74 的定高顺带把移动端轮播压窄了 68px，且再调大一点就溢出。
   ★ 这条是「实拍全绿、防线才红」的典型：390 视口下 350/2.14 ≈ 164、282/2.14 = 132，
     两组比例都恰好等于 2.14 ⇒ 单看比例判据（A②/B⑦）**照不出问题**，只有守
     「源码里不许出现定高」才拦得住。 */
chk('D17b ★★ 移动端不写死轮播高度（height 会连宽度一起扭曲，且可能溢出父容器）',
  !/\.rk-car\{height:\d+px/.test(idxC) && /\.rk-car\{margin-bottom:\d+px\}/.test(idxC));
chk('D18 ★★ 顺手修的既有缺陷：≤880 档顶栏搜索按钮收窄（实测 820 视口曾溢出 11px）',
  /\.top-search\{min-width:0;padding:7px 10px\}/.test(idx) && /\.top-search \.kbd\{display:none\}/.test(idx));
chk('D19 ★ 热度措辞只有一处实现（`fmtHot`），没有第二份格式化',
  (idx.match(/function fmtHot\s*\(/g) || []).length === 1);

/* ============================================================
   E. 五页同步（铁律 1：主源是唯一编辑入口）
   ============================================================ */
hr('E. 五页同步（主源改完必须重建四张派生页）');

const readAll = (fn) => PAGES.every((p) => src[p] && fn(src[p]));
chk('E1 ★★ 五页都有轮播三函数（rkSlideHtml / rkCarouselHtml / rkCarMount）',
  readAll((s) => /function rkSlideHtml\s*\(/.test(s) && /function rkCarouselHtml\s*\(/.test(s) && /function rkCarMount\s*\(/.test(s)));
chk('E2 ★★ 五页都有轮播样式（`.rk-car{` + `.rk-car .slide.cur{`）',
  readAll((s) => /\.rk-car\{position:relative/.test(s) && /\.rk-car \.slide\.cur\{opacity:1/.test(s)));
chk('E3 ★★ 五页都不再有 champHtml / .rk-champ（负向：旧实现不许在任何一页残留）',
  readAll((s) => !/function champHtml\s*\(/.test(s) && !/\.rk-champ/.test(s)));
chk('E4 ★ 五页都是 4 列网格 + 补位标记样式',
  readAll((s) => /repeat\(4,minmax\(0,1fr\)\)/.test(s) && /\.rk-card\.libsrc\{border-style:dashed/.test(s)));
chk('E5 ★ 五页都同步了 ≤880 档的顶栏收窄（否则派生页在该档仍溢出）',
  readAll((s) => /\.top-search\{min-width:0;padding:7px 10px\}/.test(s)));
/* ★ 负向：派生页不该有 #rankStage（那是首页专属节点）——
   有的话说明构建器把首页骨架整块搬过去了，轮播会在派生页渲染到一个不存在的容器上。 */
chk('E6 ★★ 负向：只有首页有 `id="rankStage"`（派生页没有这个节点）',
  /id="rankStage"/.test(src['public/index.html']) &&
  ['public/emulator.html', 'public/unpack.html', 'public/resources.html', 'public/extract.html']
    .every((p) => !/id="rankStage"/.test(src[p])));

hr('验收汇总');
console.log('  通过 ' + pass + ' / ' + (pass + fail) + '（失败 ' + fail + '）');
process.exit(fail ? 1 : 0);
