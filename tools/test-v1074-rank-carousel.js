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

const rf = require('../data/rank-fill');

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
for (let i = 1; i <= 10; i++) LIB.push(mk(100 + i, { title: '游戏' + i }));   // ① 同名去重
for (let i = 0; i < 8; i++) LIB.push(mk(200 + i, { hot: 300 - i }));          // ② 候选
LIB.push(mk(301, { hot: 9999, title: 'XDGAME游戏运行库检测工具206.04.13' })); // ③ 工具条目
LIB.push(mk(302, { hot: 9998, cover: '' }));                                  // ③ 无封面
LIB.push(mk(303, { hot: 0 }));                                                // ③ hot=0
const SRC = Array.from({ length: 10 }, (_, i) => ({
  id: 'xd-' + (i + 1), title: '游戏' + (i + 1), url: 'https://www.xdgame.com/game/' + (i + 1) + '.html',
  hot: 999999, cover: 'https://img/src' + i + '.jpg', genres: ['动作'], size: '10GB', rank: i + 1,
}));

const r1 = rf.fillRank(SRC, LIB);
chk('A1 ★ 源站 10 条 → 补足到 13 条', r1.list.length === 13, '实际 ' + r1.list.length + ' 条');
chk('A2 ★★ 如实回带 srcN=10 / filled=3（前端 meta 要说明「含几条补位」）',
  r1.srcN === 10 && r1.filled === 3, 'srcN=' + r1.srcN + ' filled=' + r1.filled);
const tail = r1.list.slice(10);
chk('A3 ★★ 补位条目带 `filled:true`，且名次连续 11,12,13',
  tail.length === 3 && tail.every((x) => x.filled === true) && tail.map((x) => x.rank).join(',') === '11,12,13',
  'ranks=' + tail.map((x) => x.rank).join(',') + ' filled=' + tail.map((x) => !!x.filled).join(','));
chk('A4 ★★ 去重：源站榜已有的 title 不会被补进来（同款不许占两个位）',
  !r1.list.some((x) => x.filled && /^游戏\d+$/.test(String(x.title))),
  '补位 title=' + tail.map((x) => x.title).join(' | '));
chk('A5 ★★ 工具条目（运行库 / 检测工具）不许被补进来（与源站 cleanPlate 同口径）',
  !r1.list.some((x) => /(运行库|检测工具)/.test(String(x.title || ''))));
chk('A6 ★★ 补位条目**必须有封面**（首页展示位，色块卡的观感代价大于少补一条）',
  tail.every((x) => !!x.cover), 'cover=' + tail.map((x) => (x.cover ? '有' : '无')).join(','));
chk('A7 ★ 补位按 hot 降序（单调不增）',
  tail.every((x, i) => i === 0 || Number(tail[i - 1].hot) >= Number(x.hot)),
  'hots=' + tail.map((x) => x.hot).join('>='));
chk('A8 ★★ 补进来的是**hot 最高的那 3 条可用条目**（精确到 id，防「补错了条目」）',
  tail.map((x) => x.id).join(',') === 'xd-200,xd-201,xd-202', 'ids=' + tail.map((x) => x.id).join(','));
chk('A9 ★ 负向：补位条目的 hot 必须 > 0（0 / undefined 不许进首页）',
  tail.every((x) => Number(x.hot) > 0), 'hots=' + tail.map((x) => x.hot).join(','));

const r2 = rf.fillRank(SRC.concat(SRC.map((x, i) => ({ ...x, rank: i + 11, url: x.url + '?b' }))), LIB);
chk('A10 ★ 源站本来就够 13 条 ⇒ 一条不补（filled=0，不能画蛇添足）',
  r2.list.length === 13 && r2.filled === 0, 'n=' + r2.list.length + ' filled=' + r2.filled);

const r3 = rf.fillRank([], LIB);
chk('A11 ★ 源站 0 条（如机地锚点页 544）⇒ 全从库补，不崩',
  r3.list.length === 13 && r3.filled === 13 && r3.srcN === 0, 'n=' + r3.list.length + ' filled=' + r3.filled);

const r4 = rf.fillRank(SRC, []);
chk('A12 ★ 本地库为空 ⇒ 返回源站那几条，不崩、也不报错',
  r4.list.length === 10 && r4.filled === 0, 'n=' + r4.list.length);

const r5 = rf.fillRank(null, null);
chk('A13 ★ 两个入参都是 null ⇒ 空数组返回，不抛', Array.isArray(r5.list) && r5.list.length === 0);

chk('A14 ★★ 常量口径：RANK_SHOW_N=13 · RANK_CAR_N=5（13 = 轮播 5 + 卡片 8）',
  rf.RANK_SHOW_N === 13 && rf.RANK_CAR_N === 5, rf.RANK_SHOW_N + ' / ' + rf.RANK_CAR_N);

/* A15 真库池子可用性 —— 补位池在真实数据上确实够用（不依赖网络，只读本地库） */
{
  const db = require('../data/gamesDb');
  db.load();
  const all = db.all();
  const fake = Array.from({ length: 10 }, (_, i) => ({
    id: 'xd-none-' + i, title: '绝不存在的游戏标题ZZ' + i,
    url: 'https://www.xdgame.com/game/nonexist' + i + '.html', hot: 1, cover: 'x', rank: i + 1,
  }));
  const r = rf.fillRank(fake, all);
  const tl = r.list.slice(10);
  chk('A15 ★★ 真库上跑得通：补足 13 条，且补位条目**全部有封面**',
    r.list.length === 13 && tl.length === 3 && tl.every((x) => x.filled && x.cover),
    '库 ' + all.length + ' 条 → 补 ' + r.filled + ' 条，封面 ' + tl.filter((x) => x.cover).length + '/3');
  chk('A16 ★ 真库补位条目的 hot 递减（排序真的生效，不是按数组顺序取前 3）',
    tl.every((x, i) => i === 0 || Number(tl[i - 1].hot) >= Number(x.hot)),
    'hots=' + tl.map((x) => x.hot).join('>='));
}

/* ============================================================
   B. 服务端接线
   ============================================================ */
hr('B. server.js —— /api/rank 接线');

chk('B1 ★ server.js 引入了补位模块', /const rankFill = require\('\.\/data\/rank-fill'\)/.test(sv));
chk('B2 ★★ 真的调了 fillRank（不是只 import 了放着）', /rankFill\.fillRank\(mapped, dbAll\)/.test(sv));
chk('B3 ★★ meta 如实下发 srcN / filled / showN / carN（前端靠它说明「含几条库内补位」）',
  /srcN:\s*f\.srcN/.test(sv) && /filled:\s*f\.filled/.test(sv) &&
  /showN:\s*rankFill\.RANK_SHOW_N/.test(sv) && /carN:\s*rankFill\.RANK_CAR_N/.test(sv));
chk('B4 ★★ 机地档的上限用常量而不是写死 12（原来 12 与「首页展示数」是两个各自写死的数）',
  /hots\.weekly \|\| \[\]\)\.slice\(0, rankFill\.RANK_SHOW_N\)/.test(sv) &&
  !/hots\.weekly \|\| \[\]\)\.slice\(0, 12\)/.test(sv));
chk('B5 ★★ 补位的**顺序**：先 map 出源站条目、再整体补位（不能先 slice 再补 —— 会补在错的位置）',
  sv.indexOf('fillRank(mapped, dbAll)') > sv.indexOf('mapped = xdrank.mergeRankRows(rows, dbAll).map(withBh)'));

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
chk('D10 ★★ 桌面 `.rk-grid` 是 4 列（5 列 → 4 列是「卡片放大」的主要来源：列越少每列越宽）',
  /\.rk-grid\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\);gap:10px\}/.test(idx));
chk('D11 ★★ 卡片确实放大了（封面 42 → 72px、标题 12 → 13.5px、内边距 5px 9px → 9px 12px）',
  /\.rk-card \.th\{width:72px/.test(idx) && /\.rk-card \.bd \.t\{font-size:13\.5px/.test(idx) &&
  /\.rk-card\{[^}]*padding:9px 12px/.test(idx));
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
  chk('D13a ★ 阳性对照：rankCard / rkSlideHtml 两段都取到且互不相同',
    cardSeg.length > 200 && slideSeg.length > 200 && cardSeg !== slideSeg,
    'card ' + cardSeg.length + ' 字符 / slide ' + slideSeg.length + ' 字符');
  chk('D13 ★★ 补位条目的热度措辞**两处都换**（卡片 + 轮播：`📚 库内 x` 而不是 `🔥 x`）',
    /it\.filled \? '📚 库内 ' \+ hot : '🔥 ' \+ hot/.test(cardSeg) &&
    /it\.filled \? '📚 库内 ' \+ hot : '🔥 ' \+ hot \+ ' 热度'/.test(slideSeg));
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
chk('D16 ★★ 骨架高度 = 真卡高度（轮播 200 / 卡片 61）—— 差 1px 就会在骨架→真卡切换时抖一下',
  /height:200px;margin-bottom:10px/.test(idx) && /height:61px/.test(idx));
chk('D17 ★★ 移动端卡片区是 2 列网格（不是横滑单行）',
  /\.rk-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:8px\}/.test(idx));
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
