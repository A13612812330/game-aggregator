/* tools/test-date-norm.js — 日期归一化 / 排序 / 榜单重编号回归（v10.8）
 *
 * 背景（用户反馈两则）：
 *   ① 「最近更新 时间排序有问题」—— 列表里 `9-14 → 8/12 → 9/9 → 9-13` 乱序；
 *   ② 「全站榜少了2」—— 榜单序号从 3 开始、缺 1 和 2。
 *
 * 根因两条，且都是**静默**的（不抛错、不报警）：
 *   · 机地列表页日期后紧跟数字，旧正则 `\d{1,2}` 贪婪并吞 → `2026/9/8` 存成 `2026/9/89`；
 *     斜杠/畸形日期 `new Date()` 解析失败 → 兜底 updatedTs 成 NaN → 排序退化。
 *   · 源站全站榜第 1 名是「XDGAME游戏运行库检测工具」，过滤后沿用源站序号 → 序号断层。
 *
 * 所以这层回归要守住三类：
 *   A. 该还原的必须还原（源站真值已逐条核对）；
 *   B. 该拒绝的必须拒绝（不造非法日期，避免"修出一个更错的显示"）；
 *   C. 排序与序号的不变量（日期非递增、名次连续无缺号）。
 */
const { normDate, dateTs } = require('../shared');
const { normalizeDates, normalizeOne } = require('../data/date-norm');
const { cleanPlate } = require('../fetchers/xdrank');

let pass = 0, fail = 0;
const bad = [];
function t(ok, label, detail) {
  if (ok) pass++; else { fail++; bad.push(label); }
  console.log(`${ok ? '  PASS' : '× FAIL'}  ${label}${detail ? '  —— ' + detail : ''}`);
}

/* ============ ① normDate：该还原的（源站真值已抓取核对）============ */
console.log('=== ① normDate · 源站实测样本（左侧为入库脏值，右侧为源站真值）===');
const realCases = [
  // [入库值, 期望, 说明]
  ['2026/9/89', '2026-09-08', '吞吞堡垒：源站 2026/9/8 被吞成 89'],
  ['2026/9/49', '2026-09-04', '鬼武者：源站 2026/9/4'],
  ['2026/9/39', '2026-09-03', '黎明行者之血：源站 2026/9/3'],
  ['2016/6/69', '2016-06-06', '钢铁雄心IV：源站 2016/6/6'],
  ['2025/3/48', '2025-03-04', 'GTA5：源站 2025/3/4'],
  ['2024/3/88', '2024-03-08', '红警2：源站 2024/3/8'],
  ['2026/9/99', '2026-09-09', '幻世录：源站 2026/9/9（更脏的叠加值）'],
  ['2026/9/9', '2026-09-09', '干净的斜杠式：只补零'],
  ['2026/8/12', '2026-08-12', '同上'],
  ['2020/12/10', '2020-12-10', '两位日不受贪婪影响'],
  ['2026-09-14', '2026-09-14', 'XD 的 ISO 格式直通'],
];
for (const [input, want, why] of realCases) {
  const got = normDate(input);
  t(got === want, `normDate(${JSON.stringify(input)}) = ${JSON.stringify(got)}（期望 ${want}）`, why);
}

/* ============ ② normDate：该拒绝的（不能造出更错的显示）============ */
console.log('\n=== ② normDate · 必须拒绝的输入 ===');
const rejectCases = [
  ['2026/13/1', '月份 13 越界'],
  ['2026/0/5', '月份 0 越界'],
  ['2026/2/30', '2 月没有 30 号'],
  ['2026/4/31', '4 月没有 31 号'],
  ['', '空串'],
  [null, 'null'],
  [undefined, 'undefined'],
  ['更新', '纯文案'],
  ['abc', '非日期'],
  ['2026', '只有年份'],
];
for (const [input, why] of rejectCases) {
  const got = normDate(input);
  t(got === null, `normDate(${JSON.stringify(input)}) = null`, `${why} → 实际 ${JSON.stringify(got)}`);
}

/* ============ ③ dateTs ============ */
console.log('\n=== ③ dateTs · 排序用毫秒 ===');
t(dateTs('2026-09-08') === Date.UTC(2026, 8, 8), 'dateTs 与 Date.UTC 对齐');
t(dateTs('2026/9/89') === Date.UTC(2026, 8, 8), '脏值也能算出正确时间戳');
t(dateTs('abc') === 0, '无法解析返回 0（不返回 NaN）');
t(Number.isFinite(dateTs('2026/13/1')), '月越界返回 0 而非 NaN');

/* ============ ④ normalizeDates：批量兜底与幂等 ============ */
console.log('\n=== ④ normalizeDates · 批量兜底 ===');
const list = [
  { id: 'a', dateLabel: '2026/9/89', updatedTs: 1789310629000 },   // 脏日期 + 有 ts
  { id: 'b', dateLabel: '2026/9/9', updatedTs: null },             // 干净斜杠 + ts 缺失
  { id: 'c', dateLabel: null, updatedTs: 1789310629000 },          // 无日期 + 有 ts
  { id: 'd', dateLabel: null, updatedTs: NaN },                    // 都无 → 不该臆造日期
  { id: 'e', dateLabel: '2026-09-14', updatedTs: 0 },              // ISO + ts=0 残值
];
const stat = normalizeDates(list);
t(list[0].dateLabel === '2026-09-08', '脏值被还原', `→ ${list[0].dateLabel}`);
t(list[1].dateLabel === '2026-09-09' && list[1].updatedTs === Date.UTC(2026, 8, 9), '斜杠式归一化 + ts 兜底');
t(list[2].dateLabel === null, '只有 ts 时**不**凭空造日期（避免假日期污染分组）', `→ ${list[2].dateLabel}`);
t(list[3].dateLabel === null, '两者皆无 → 保持 null');
t(list[4].updatedTs === Date.UTC(2026, 8, 14), 'ts=0 残值被日期兜底修掉', `→ ${list[4].updatedTs}`);
t(Number.isFinite(list[2].updatedTs), '原本有效的 ts 不被破坏');
/* 幂等：再跑一次不应有任何改动 */
const again = normalizeDates(list);
t(again.changed === 0, '幂等：重复归一化不再产生改动', `changed=${again.changed}`);
t(stat.changed > 0, '首轮确有改动（防"测试写了个空断言"）', `changed=${stat.changed}`);

/* 单条入口（upsert 用） */
const fresh = { id: 'f', dateLabel: '2025/3/48', updatedTs: null };
normalizeOne(fresh);
t(fresh.dateLabel === '2025-03-04', 'normalizeOne 入口归一化（防增量抓取再带进脏值）', `→ ${fresh.dateLabel}`);

/* ============ ⑤ cleanPlate：榜单过滤后必须重编号 ============ */
console.log('\n=== ⑤ cleanPlate · 榜单重编号 ===');
/* 源站真实形态：全站榜第 1 行是运行库工具 */
const realPlate = [
  { gid: '8547', name: 'XDGAME游戏运行库检测工具206.04.13', rank: 1 },
  { gid: '191', name: '赛博朋克2077/Cyberpunk 2077', rank: 2 },
  { gid: '2713', name: '极限竞速：地平线5顶级版', rank: 3 },
  { gid: '419', name: '博德之门3/Baldur\'s Gate 3', rank: 4 },
];
const rp = cleanPlate(realPlate);
t(rp.dropped === 1, '剔除 1 条工具条目', `dropped=${rp.dropped}`);
t(rp.rows.length === 3, '剩余 3 条', `len=${rp.rows.length}`);
t(rp.rows.map((x) => x.rank).join(',') === '1,2,3',
  '★ 名次重排为连续的 1..N（旧实现是 2,3,4 → 前端显示从 3 开始）',
  `实际 ${rp.rows.map((x) => x.rank).join(',')}`);
t(rp.rows[0].srcRank === 2, '保留源站序号 srcRank 便于追溯', `srcRank=${rp.rows[0].srcRank}`);
t(rp.rows[0].name.includes('赛博朋克'), '冠军归位到实际第 1 名');

/* 无噪声：序号应与源站一致 */
const cleanPlate2 = cleanPlate([
  { gid: '1', name: '游戏甲', rank: 1 },
  { gid: '2', name: '游戏乙', rank: 2 },
]);
t(cleanPlate2.dropped === 0 && cleanPlate2.rows.map((x) => x.rank).join(',') === '1,2', '无噪声时序号不变');

/* 噪声在中间：后续不能跳号 */
const midNoise = cleanPlate([
  { gid: '1', name: '游戏甲', rank: 1 },
  { gid: '2', name: 'XDGAME游戏检测工具', rank: 2 },
  { gid: '3', name: '游戏丙', rank: 3 },
]);
t(midNoise.rows.map((x) => x.rank).join(',') === '1,2', '噪声在中间也能保持连续', `实际 ${midNoise.rows.map((x) => x.rank).join(',')}`);

/* 上限 10 与超长输入 */
const many = Array.from({ length: 14 }, (_, i) => ({ gid: String(i), name: '游戏' + i, rank: i + 1 }));
t(cleanPlate(many).rows.length <= 10, '至多取 10 条');

/* ============ ⑥ 真实本地库：排序不变量 ============ */
console.log('\n=== ⑥ 本地库排序不变量 ===');
const gamesDb = require('../data/gamesDb');
gamesDb.load();
const all = gamesDb.all();
t(all.length > 1000, `库已加载（${all.length} 条）`);

const nonIso = all.filter((g) => g.dateLabel && !/^\d{4}-\d{2}-\d{2}$/.test(g.dateLabel));
t(nonIso.length === 0, '全库 dateLabel 皆为 ISO 或空', `非 ISO ${nonIso.length} 条`);

const badTs = all.filter((g) => g.updatedTs != null && !Number.isFinite(Number(g.updatedTs)));
t(badTs.length === 0, '全库无 NaN/非法 updatedTs', `非法 ${badTs.length} 条`);

const r = gamesDb.browse('全部', 120, 0, 'updated');
const keyOf = (g) => dateTs(g.dateLabel) || Number(g.updatedTs) || 0;
let inversions = 0, firstBad = null;
for (let i = 1; i < r.items.length; i++) {
  const a = keyOf(r.items[i - 1]), b = keyOf(r.items[i]);
  if (a < b) { inversions++; if (!firstBad) firstBad = `${r.items[i - 1].dateLabel} → ${r.items[i].dateLabel}`; }
}
t(inversions === 0, '「最新更新」前 120 条排序键**非递增**（日期不跳序）',
  inversions ? `${inversions} 处逆序，例如 ${firstBad}` : '无逆序');

/* 排序首选必须是"源站更新日期"而不是抓取时间：
   若仍按 updatedTs 排，很容易被刚抓到的老游戏插到前面。这里用一组构造样本验证语义。 */
const probe = [
  { id: 'x1', dateLabel: '2026-08-12', updatedTs: Date.UTC(2026, 8, 15) },  // 老游戏、昨天抓的
  { id: 'x2', dateLabel: '2026-09-13', updatedTs: Date.UTC(2026, 8, 13) },  // 新游戏
];
probe.sort((a, b) => (keyOf(b) - keyOf(a)) || ((b.updatedTs || 0) - (a.updatedTs || 0)));
t(probe[0].id === 'x2', '★ 日期优先：刚抓到的老游戏不会插到最新之前', `首位=${probe[0].id}`);

console.log(`\n结果：${pass} / ${pass + fail} 通过`);
if (bad.length) console.log('未通过：\n  - ' + bad.join('\n  - '));
process.exit(fail ? 1 : 0);
