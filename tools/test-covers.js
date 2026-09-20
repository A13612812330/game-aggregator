/* 封面（游戏图片）链路的常驻防线（v10.23 新增）
 *
 * 覆盖一块**长期静默缺图、且不报任何错**的东西：热榜/列表卡片的封面。
 *
 * ★ 为什么必须有：这条链路坏掉时**不会报错**，只会「卡片变成首字色块」。
 *   实测 2026-09-20 的两处真实缺口：
 *     ① `fetchers/xdrank.js` 抓榜单时只读 `a[href]` / `a[title]`，
 *        把同一行 `<img class="lazy" data-original="真图">` **整个丢掉了**
 *        —— 源站明明给了图，我们没拿。于是只能拿 url 去本地库碰运气匹配。
 *     ② `server.js` 的 `/api/rank` 只用 `byUrl.get(it.url)` 精确匹配，落空即 `cover:null`。
 *        落空有两种：库里没收录（工具类条目）、库里有但 url 串差一点。
 *        周榜 10 条里因此有 2 条无图（线上实测），而**源站这两条都是有图的**。
 *
 * 本套件钉五件事：
 *   A. `coverOf` 提取规则（懒加载占位图必须被剔除，相对路径必须补全）
 *   B. `cleanPlate` 过滤工具条目时**不许把 img 一起丢掉**
 *   C. `mergeRankRows` 的五条分支（url 命中 / gid 兜底 / 源站图兜底 / 不编造）
 *   D. 全库封面覆盖率（防止将来索引更新又悄悄引入空封面）
 *   E. 接线（server 真的调了它、前端与派生页真的有「有图渲染 img / 无图渲染占位」两个分支）
 *
 * 纯本地、无网络。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const xdrank = require('../fetchers/xdrank');
const gamesDb = require('../data/gamesDb');

let pass = 0, fail = 0;
const ok = (cond, name, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name + (detail ? '  — ' + detail : '')); }
  else { fail++; console.log('  × FAIL  ' + name + (detail ? '  — ' + detail : '')); }
};
const eq = (got, want, name) => ok(got === want, name, '得到 ' + JSON.stringify(got) + '，期望 ' + JSON.stringify(want));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const HOME = xdrank.HOME;

/* ============================================================
 *  ⓪ 前置：库要有货（否则下面全是空跑出来的假绿）
 * ============================================================ */
console.log('=== ⓪ 前置检查 ===');
gamesDb.load();
const ALL = gamesDb.all();
ok(ALL.length > 10000, '本地库有条目', ALL.length + ' 条');
const WITH_COVER = ALL.filter((x) => x.cover && /^https?:/i.test(x.cover));
ok(WITH_COVER.length > 10000, '库内带封面的条目有货', WITH_COVER.length + ' 条');

/* ============================================================
 *  ① coverOf —— 从榜单行的 <img> 里抠封面
 * ============================================================ */
console.log('\n=== ① coverOf 提取规则 ===');
const c = xdrank.coverOf;
eq(c('/images/defaultpic.gif', '//cdn.x/a.jpg'), 'https://cdn.x/a.jpg', '协议相对 // 补 https:');
eq(c('/images/defaultpic.gif', '/uploads/allimg/1-L.png'), HOME.replace(/\/+$/, '') + '/uploads/allimg/1-L.png',
  '站内相对路径补全为绝对 URL（年榜用的是这种）');
eq(c('/images/defaultpic.gif', 'https://cdn.x/a.jpg'), 'https://cdn.x/a.jpg', '绝对 URL 原样保留');
eq(c('/images/defaultpic.gif', ''), '', '★ 只有占位图没有 data-original 时返回空（不许把 defaultpic.gif 当封面）');
eq(c('/images/lazy.gif', ''), '', '★ src 是 lazy 占位图时也必须判空');
eq(c('/images/defaultpic.gif', 'data:image/png;base64,AAA'), '', 'data: URL 不认（不能进 <img src> 当外链）');
eq(c('https://cdn.x/real.jpg', ''), 'https://cdn.x/real.jpg', '没有 data-original 时，真实 src 可以用');
/* 反向验证：把「占位图必须剔除」这条规则拿掉，上面两条就得变红 */
ok(/defaultpic\.gif/.test(read('fetchers/xdrank.js')),
  '★ 源码里确实写了 defaultpic.gif 的剔除（否则「占位图判空」的断言就是在自欺）');

/* ============================================================
 *  ② cleanPlate —— 滤工具条目时不许丢 img
 * ============================================================ */
console.log('\n=== ② cleanPlate 不丢 img ===');
const cleaned = xdrank.cleanPlate([
  { name: '游戏A', img: 'https://x/a.jpg', rank: 1 },
  { name: 'XDGAME游戏运行库检测工具206.04.13', img: 'https://x/tool.png', rank: 2 },
  { name: '游戏B', img: 'https://x/b.jpg', rank: 3 },
]);
eq(cleaned.dropped, 1, '工具条目被滤掉 1 条');
eq(cleaned.rows.length, 2, '剩下 2 条');
eq(cleaned.rows[0].img, 'https://x/a.jpg', '★ 过滤后 img 字段仍在（丢了就等于源站白给图）');
eq(cleaned.rows[1].img, 'https://x/b.jpg', '第二条 img 也在');
eq(cleaned.rows[1].rank, 2, '★ 序号已重编为连续 1..N（源站序号会留下空洞）');

/* ============================================================
 *  ③ mergeRankRows —— 榜单行 → 库条目（五条分支）
 * ============================================================ */
console.log('\n=== ③ mergeRankRows 五条分支 ===');
const LIB = [
  { id: 'xd-9001', source: 'xdgamer', title: '甲/Alpha', url: HOME + 'game/9001.html', cover: 'https://c/a.jpg', genres: ['动作'] },
  { id: 'xd-9002', source: 'xdgamer', title: '乙/Beta', url: HOME + 'game/9002.html', cover: '', genres: ['射击'] },
  { id: 'xd-9003', source: 'xdgamer', title: '丙/Gamma', url: 'https://www.xdgame.com/game/9003.html', cover: 'https://c/c.jpg', genres: [] },
];
const rows = [
  { gid: '9001', name: '甲/Alpha', url: HOME + 'game/9001.html', img: 'https://s/a.jpg', rank: 1 },
  { gid: '9002', name: '乙/Beta', url: HOME + 'game/9002.html', img: 'https://s/b.jpg', rank: 2 },
  { gid: '9003', name: '丙/Gamma', url: 'https://xdgame.com/game/9003.html', img: 'https://s/c.jpg', rank: 3 },
  { gid: '9999', name: '库外条目/Outsider', url: HOME + 'game/9999.html', img: 'https://s/d.jpg', rank: 4 },
  { gid: '9998', name: '彻底没图/NoImage', url: HOME + 'game/9998.html', img: '', rank: 5 },
];
const merged = xdrank.mergeRankRows(rows, LIB);
eq(merged.length, 5, '逐行都有结果（不许丢行）');
eq(merged[0].cover, 'https://c/a.jpg', '① url 命中 → 用库内 cover（Steam 标准横版，比例最稳）');
eq(merged[0].title, '甲/Alpha', '命中时标题用**库内**的（不是源站 name）');
eq(merged[0].genres.join(), '动作', '命中时库内其它字段一并带出');
eq(merged[1].cover, 'https://s/b.jpg', '② url 命中但库内 cover 为空 → 退到源站行图');
eq(merged[2].cover, 'https://c/c.jpg',
  '③ ★ url 串不同（少个 www）但 gid 命中 → 仍取到库内 cover（旧实现这里就是 null）');
eq(merged[3].cover, 'https://s/d.jpg',
  '④ ★ 库里完全没收录 → 用源站行图（旧实现是写死的 cover:null）');
eq(merged[3].source, 'xdgamer', '库外条目仍标注来源');
eq(merged[4].cover, null, '⑤ ★ 两边都没有图 → cover 为 null，不编造');
eq(merged[4].title, '彻底没图/NoImage', '库外条目用源站 name 兜底');
ok(merged.every((x) => 'cover' in x), '★ 每条都保证有 cover 字段（前端靠它二选一，缺字段会掉进 undefined 分支）');
eq(xdrank.mergeRankRows([], LIB).length, 0, '空输入返回空数组（不抛）');
eq(xdrank.mergeRankRows(rows, []).length, 5, '库为空时仍逐行返回（且用源站图）');

/* ============================================================
 *  ④ 全库封面覆盖率（防止索引更新又悄悄引入空封面）
 * ============================================================ */
console.log('\n=== ④ 全库封面覆盖率 ===');
const empty = ALL.filter((x) => !(x.cover && /^https?:/i.test(x.cover)));
eq(empty.length, 0, '★ 全库 100% 有封面（有缺失就跑 node tools/fill-covers.js）');
if (empty.length) console.log('     缺封面样例：' + empty.slice(0, 5).map((x) => x.id).join(', '));
const bySrc = {};
for (const g of ALL) {
  const s = g.source || '?';
  bySrc[s] = bySrc[s] || { n: 0, c: 0 };
  bySrc[s].n++;
  if (g.cover && /^https?:/i.test(g.cover)) bySrc[s].c++;
}
for (const [s, v] of Object.entries(bySrc)) {
  eq(v.c, v.n, '源 ' + s + ' 封面无缺失');
}

/* ============================================================
 *  ⑤ 接线：少一处就静默不生效
 * ============================================================ */
console.log('\n=== ⑤ 接线 ===');
const xdrankSrc = read('fetchers/xdrank.js');
ok(/img: coverOf\(/.test(xdrankSrc), '★ rawHot 的 rows.push 真的带上了 img（只在导出函数里写不算数）');
ok(/module\.exports = \{[^}]*coverOf[^}]*\}/.test(xdrankSrc), 'coverOf 已导出');
ok(/module\.exports = \{[^}]*mergeRankRows[^}]*\}/.test(xdrankSrc), 'mergeRankRows 已导出');

const serverSrc = read('server.js');
ok(/xdrank\.mergeRankRows\(/.test(serverSrc), '★ server 的 /api/rank 真的调用了 mergeRankRows');
ok(!/const byUrl = new Map\(all\.map/.test(serverSrc),
  '★ server 里已无内联的 byUrl 匹配（留着说明改的是死代码，线上还是没图）');
ok(/cover: null, genres: \[\]/.test(serverSrc) === false || !/title: it\.name, cover: null/.test(serverSrc),
  'server 里已无「写死 cover:null」的兜底分支');

/* 前端：有图渲染 <img>、无图渲染首字占位 —— 两个分支都必须在 */
for (const page of ['public/index.html', 'public/emulator.html', 'public/unpack.html']) {
  const p = read(page);
  const hasRank = /\.rk-card/.test(p);
  if (!hasRank) continue;
  ok(/it\.cover \? `<img src=/.test(p), page + ' 有图时渲染 <img>（且带 onerror 兜底）');
  ok(/<div class="ph">/.test(p), page + ' 无图时渲染首字占位 .ph');
  ok(/object-fit:cover/.test(p), page + ' 卡片缩略图用 object-fit:cover（否则源站不同比例的图会拉伸）');
}

/* fill-covers 工具必须存在且是「只填空、不覆写」+ 支持 --dry */
const fillSrc = read('tools/fill-covers.js');
ok(/--dry/.test(fillSrc), 'tools/fill-covers.js 支持 --dry（改数据前先干跑）');
ok(/!\(x\.cover && \/\^https\?:\/i\.test\(x\.cover\)\)/.test(fillSrc),
  '★ fill-covers 只挑 cover 为空的条目（不许覆写已有封面）');
ok(/out === raw/.test(fillSrc), '★ fill-covers 写盘前比对内容（无变化就不写，保证幂等）');

console.log('\n============================');
console.log('  通过 ' + pass + '/' + (pass + fail) + '（失败 ' + fail + '）');
console.log('============================');
process.exit(fail ? 1 : 0);
