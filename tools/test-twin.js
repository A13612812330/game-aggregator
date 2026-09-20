/* 跨源「孪生条目」链路的常驻防线（v10.23 新增）
 *
 * 覆盖一块**刚修好、且修之前静默错了很久**的东西：
 * 详情抽屉里的「另一源也有收录 / 机地找同名 ↗ 跨源跳转」到底能不能跳到对的详情页。
 *
 * ★ 为什么必须有：这条链路的两个 bug 都是「不报错」型的 ——
 *   ① 取数走的是按名模糊匹配，v10.22 合并机地话题后命中率掉到 **3.5%**，
 *      表现是按钮**永远不显示**（没有任何报错，只像「功能没做」）；
 *   ② 按钮的 `hidden` 属性被 `.go{display:flex}` 压过去 ⇒ 按钮**一直可见但 href 为空**，
 *      表现是「点了没反应」。两者叠加，用户看到的就是「连按钮都点击不了」。
 *
 * 本套件钉四件事：
 *   A. data/twin.js 的解析结果对不对（精确键优先、标题来自机地话题库、不编造）
 *   B. 覆盖率下限（防止有人把精确键分支改坏 —— 那会让覆盖率瞬间掉回 3%）
 *   C. 防误配闸门（同系列不同版本不许互认）
 *   D. 前端 / 派生页 / server 的**接线**（少一处就静默不生效）
 *
 * 纯本地、无网络（只读 data/*.json 与源码文本）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const gamesDb = require('../data/gamesDb');
const twin = require('../data/twin');
const jt = require('../data/jiditopics');

let pass = 0, fail = 0;
const ok = (cond, name, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name + (detail ? '  — ' + detail : '')); }
  else { fail++; console.log('  × FAIL  ' + name + (detail ? '  — ' + detail : '')); }
};
const eq = (got, want, name) => ok(got === want, name, '得到 ' + JSON.stringify(got) + '，期望 ' + JSON.stringify(want));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

gamesDb.load();
const ALL = gamesDb.all();
const XD = ALL.filter((x) => x.source !== 'jidi');
const JD = ALL.filter((x) => x.source === 'jidi');

/* ============================================================
 *  ⓪ 前置：库本身要有货（否则下面全是空跑出来的假绿）
 * ============================================================ */
console.log('=== ⓪ 前置检查 ===');
ok(ALL.length > 10000, '本地库有条目', ALL.length + ' 条');
ok(XD.length > 10000, 'XD 侧有条目', XD.length + ' 条');
ok(JD.length > 1000, '机地独立条目有条目', JD.length + ' 条');
const XD_WITH_JIDI = XD.filter((x) => x.jidiUrl);
ok(XD_WITH_JIDI.length > 10000, 'XD 侧带 jidiUrl（合并过机地）的条目有货', XD_WITH_JIDI.length + ' 条');

/* ============================================================
 *  ① 工具函数：tidOf / joinTitle / normTitle
 * ============================================================ */
console.log('\n=== ① 工具函数 ===');
eq(twin.tidOf('https://jidiyouxi.com/topic/detail/338824746'), '338824746', 'tidOf 抠出话题 id');
eq(twin.tidOf('https://jidiyouxi.com/topic/detail/338824746?from=list'), '338824746', '带查询串也能抠');
eq(twin.tidOf('https://jidiyouxi.com/'), '', '★ 不是详情页 → 空串（不编造 id）');
eq(twin.tidOf(''), '', '空串输入 → 空串');
eq(twin.tidOf(undefined), '', 'undefined 输入 → 空串');
eq(twin.joinTitle('剑星', 'Stellar Blade™'), '剑星/Stellar Blade', 'joinTitle 拼中英并去掉 ™');
eq(twin.joinTitle('剑星', ''), '剑星', '没有英文段时只留中文');
eq(twin.normTitle('生化危机4：重制版'), twin.normTitle('生化危机4重置版'), '版本词收敛：重制版 ≡ 重置版');

/* ============================================================
 *  ② 精确键路径：XD 条目自带的 jidiUrl → 机地详情页
 * ============================================================ */
console.log('\n=== ② 精确键路径（XD → 机地）===');
const SAMPLE_IDS = ['xd-8149', 'xd-15816', 'xd-762'];
for (const id of SAMPLE_IDS) {
  const it = gamesDb.byIdGet(id);
  if (!it) { ok(false, `样本 ${id} 在库中`, '没找到，数据集变了要换样本'); continue; }
  const t = twin.twinOf({ id });
  ok(!!t, `${id} 解析出机地孪生`, it.title);
  if (!t) continue;
  eq(t.source, 'jidi', `${id} 孪生源是机地`);
  eq(t.id, 'jidi-' + twin.tidOf(it.jidiUrl), `${id} 孪生 id 由 jidiUrl 的 tid 推出`);
  eq(t.url, it.jidiUrl, `${id} 跳转地址就是条目自带的 jidiUrl`);
  eq(t.via, 'jidiUrl+tid', `★ ${id} 走的是精确键（不是名称匹配）`);
  ok(/\/(topic\/detail|game)\/\d+/i.test(t.url), `${id} URL 形态是详情页`, t.url);
}

/* 标题应当来自**机地话题库**，而不是照抄 XD 标题 ——
   取一个两源标题明显不同的样本钉住这一点。 */
const DIFF = gamesDb.byIdGet('xd-762');   // 「料理模拟器/烹饪模拟器/Cooking Simulator」
if (DIFF && DIFF.jidiUrl) {
  const t = twin.twinOf({ id: 'xd-762' });
  ok(!!t && t.title !== DIFF.title, '★ 标题取自机地话题库（与 XD 标题不同）',
    t ? `XD「${DIFF.title}」→ 机地「${t.title}」` : '没解析出来');
  const topic = jt.byTid(twin.tidOf(DIFF.jidiUrl));
  ok(!!topic && t && t.title === twin.joinTitle(topic.title, topic.titleEn),
    'twin.title 与机地话题库那一条拼出来的标题一致');
  ok(!!t && !!t.cover, '带上了机地封面（前端卡片要用）', t ? t.cover.slice(0, 56) : '');
} else {
  ok(false, '样本 xd-762 存在且带 jidiUrl', '数据集变了要换样本');
}

/* ============================================================
 *  ③ 覆盖率下限 —— 防「精确键分支被改坏」
 * ============================================================ */
console.log('\n=== ③ 覆盖率（全量扫描，慢但值得）===');
let xdHit = 0;
const xdVia = {};
for (const it of XD) {
  const t = twin.twinOf({ id: it.id });
  if (t) { xdHit++; xdVia[t.via] = (xdVia[t.via] || 0) + 1; }
}
const xdRate = xdHit / XD.length;
console.log(`  XD → 机地 命中 ${xdHit}/${XD.length} = ${(xdRate * 100).toFixed(1)}%  路径分布 ${JSON.stringify(xdVia)}`);
ok(xdRate >= 0.85, '★ XD → 机地 覆盖率 ≥ 85%（实测 90.1%；改坏精确键分支会瞬间掉到 3.5%）',
  (xdRate * 100).toFixed(1) + '%');
const viaExact = (xdVia['jidiUrl+tid'] || 0) / Math.max(1, xdHit);
ok(viaExact >= 0.8, '★ 命中里 ≥80% 走精确键（说明不是靠名称匹配凑出来的）',
  (viaExact * 100).toFixed(1) + '%');
eq(xdVia['jidiUrl+tid'] || 0, XD_WITH_JIDI.length,
  '★ 每一条带 jidiUrl 的 XD 条目都能解析出机地详情页（一个都不能漏）');

let jdHit = 0;
const jdVia = {};
for (const it of JD) {
  const t = twin.twinOf({ id: it.id });
  if (t) { jdHit++; jdVia[t.via] = (jdVia[t.via] || 0) + 1; }
}
const jdRate = jdHit / JD.length;
console.log(`  机地 → XD 命中 ${jdHit}/${JD.length} = ${(jdRate * 100).toFixed(1)}%  路径分布 ${JSON.stringify(jdVia)}`);
ok(jdRate >= 0.15, '机地 → XD 覆盖率 ≥ 15%（实测 20.4%；XD 确实没收录的应当落空）',
  (jdRate * 100).toFixed(1) + '%');

/* 全部 twin 的 URL 都必须是详情页形态 —— 一个列表页/首页混进来都会让按钮点了找不到 */
let badUrl = 0;
for (const it of XD.concat(JD)) {
  const t = twin.twinOf({ id: it.id });
  if (t && !/\/(topic\/detail|game)\/\d+/i.test(t.url)) badUrl++;
}
eq(badUrl, 0, '★ 所有孪生的 URL 都是详情页形态（没有列表页/首页混进来）');

/* ============================================================
 *  ④ 防误配闸门 —— 同系列不同版本不许互认
 * ============================================================ */
console.log('\n=== ④ 防误配闸门 ===');
eq(twin.matchScore('古墓丽影:崛起/Rise of the Tomb Raider', '古墓丽影:暗影/Shadow of the Tomb Raider'), 0,
  '★ 古墓丽影 崛起 ↛ 暗影（共享英文前缀也不认）');
eq(twin.sameGame('古墓丽影:崛起/Rise of the Tomb Raider', '古墓丽影:暗影/Shadow of the Tomb Raider'), false,
  'sameGame 同样拦住 崛起/暗影');
ok(twin.matchScore('侠盗猎车手5/Grand Theft Auto V Enhanced', '侠盗猎车手5增强版/GTA5增强版/Grand Theft Auto V Enhanced') >= 30,
  '★ 同款（增强版）必须认得出 —— 英文段相等是关键分');
eq(twin.matchScore('侠盗猎车手5传承版/GTA5传承版/Grand Theft Auto V Legacy', '侠盗猎车手5/Grand Theft Auto V Enhanced'), 0,
  '★ 传承版(Legacy) ↛ 增强版(Enhanced)：两边都有英文段却互不匹配 → 一票否决');
eq(twin.TWIN_MIN_SCORE, 30, '同款门槛常量是 30（改它等于改语义，测试要同步）');

const GTA_LEGACY = XD.find((x) => /侠盗猎车手5传承版/.test(x.title || ''));
if (GTA_LEGACY) {
  const t = twin.twinOf({ id: GTA_LEGACY.id });
  ok(!t || !/Enhanced/i.test(t.url + t.title), '★ 传承版条目不会被配到机地的 Enhanced 话题',
    t ? '竟配到了 ' + t.title : '未配到（正确）');
} else {
  ok(false, '样本「侠盗猎车手5传承版」存在', '数据集变了要换样本');
}

/* ============================================================
 *  ⑤ 不编造 / 边界
 * ============================================================ */
console.log('\n=== ⑤ 不编造与边界 ===');
eq(twin.twinOf({ id: '__nope__' }), null, '不存在的 id → null（不瞎猜）');
eq(twin.twinOf({}), null, '空参数 → null');
eq(twin.twinOf(), null, '无参数 → null');
eq(twin.twinOf({ id: '', title: 'A' }), null, '标题太短（1 字）→ null');
const NO_JIDI = XD.find((x) => !x.jidiUrl && !twin.twinOf({ id: x.id }));
if (NO_JIDI) {
  ok(true, '确实存在「XD 没收录机地同款」的条目（按钮该隐藏的那种）', NO_JIDI.title);
} else {
  ok(true, '本轮数据里 XD 侧全部有孪生（跳过该样本断言）', '');
}
/* 只在 title 传参、没有 id 时也要能工作（详情页从搜索进入的场景） */
const BY_NAME = twin.twinOf({ title: '赛博朋克2077/Cyberpunk 2077', src: 'jidi' });
ok(BY_NAME === null || !!BY_NAME.url, '只给 title+src 时：要么给可跳详情页，要么 null（不给半成品）');

/* ============================================================
 *  ⑥ 接线：server 路由 / 前端取数 / 派生页同步
 * ============================================================ */
console.log('\n=== ⑥ 接线（少一处就静默不生效）===');
const srv = read('server.js');
ok(/require\('\.\/data\/twin'\)/.test(srv), 'server.js 引入了 data/twin');
ok(/app\.get\('\/api\/library\/twin'/.test(srv), '/api/library/twin 路由存在');
ok(/twin\.twinOf\(/.test(srv), '路由调用了 twinOf');

const idx = read('public/index.html');
ok(/api\/library\/twin/.test(idx), '首页调用了 /api/library/twin');
ok(/function resolveCounterpart\(d, fb\)/.test(idx), 'resolveCounterpart 接收 fb（fb.id 是精确孪生键）');
ok(/function linkCounterpart\(d, fb\)/.test(idx), 'linkCounterpart 接收 fb 并透传');
ok(!/function sameGame\s*\(/.test(idx), '★ 前端不再自带 sameGame（同一语义只留后端一份）');
ok(!/function normGameTitle\s*\(/.test(idx), '★ 前端不再自带 normGameTitle');
ok(!/function hasDetailUrl\s*\(/.test(idx), '★ 前端不再自带 hasDetailUrl');
/* ⚠️ 这条断言必须用**行首锚定**，不能直接 grep 字符串：
   注释里引用了同一串文字（「`[hidden]{display:none!important}` 已在 CSS 开头全局声明」），
   于是把真正的规则整行删掉后，正则仍会被那句注释命中 —— 断言恒绿。
   ★ 本项目在 v10.22 踩过一模一样的坑（`indexOf('DEPRECATED')` 命中了顶部注释里的同名文字），
     判据：断言要打在**承载语义的那一行**上，不是「全文里有没有这串字」。 */
const HIDDEN_RULE = /^ {2}\[hidden\]\{display:none!important\}\s*$/m;
ok(HIDDEN_RULE.test(idx),
  '★ 全局 [hidden] 规则在（行首锚定，避开注释里的同名文字）');
ok(!/\.dlpop\[hidden\]\{/.test(idx), '「.dlpop[hidden]」特例已收口到全局规则，不再各写一份');
ok(/go\.hidden = false/.test(idx) && /go\.setAttribute\('href', hit\.url\)/.test(idx),
  '按钮显形与 href 赋值都在');
/* 撞名检查：linkCounterpart 里再声明一个叫 fb 的 const 会直接 SyntaxError（整段脚本不执行） */
ok(!/const fb = encodeURIComponent/.test(idx),
  '★ linkCounterpart 内没有与参数撞名的 `const fb`（撞名 = 整页脚本 SyntaxError）');

for (const page of ['public/emulator.html', 'public/unpack.html']) {
  const p = read(page);
  ok(/api\/library\/twin/.test(p), page + ' 已同步跨源取数（派生页没重建就会漏）');
  ok(HIDDEN_RULE.test(p), page + ' 已同步全局 [hidden] 规则（行首锚定）');
  ok(!/function sameGame\s*\(/.test(p), page + ' 已同步删除前端 sameGame');
}

console.log('\n============================');
console.log('  通过 ' + pass + '/' + (pass + fail) + '（失败 ' + fail + '）');
console.log('============================');
process.exit(fail ? 1 : 0);
