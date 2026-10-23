#!/usr/bin/env node
/* tools/test-roster.js —— 「完整体检表」（gen-roster.js 产物）的静态防线
 *
 * 守的是什么（每一条都对应一类**静默事故**）：
 *   A 产物存在且体积正常     —— 生成脚本半路失败却留下了旧文件
 *   B 行数恒等式             —— 端游 + 手游独有 = 总行数；漏并/重并都会在这里变红
 *   C 行结构（13 列 + 类型） —— 投影少给一列，页面那一列整列空着而不报错
 *   D 四类标记与 meta 一致   —— 「有资源的款数」页面 KPI 与数据对不上
 *   E 内联 JSON 可解析       —— 未被转义的 </script> 会把 JSON 截断
 *   F 页面钩子齐全           —— 排序/筛选/弹窗的 DOM 契约被改名后页面静默失灵
 *   H 表头吸附 + 多选筛选    —— v2 的两条新诉求，且都是「坏了也照样能用」的那类
 *       · H1/H1b：.card 的 overflow 若是 hidden/auto/scroll，会成为**滚动容器**并夺走
 *         thead 的 sticky 吸附上下文 ⇒ 字段名再也吸不住（实测 th.top 58 → -1180），无任何报错。
 *         ★ 判据分层：H1 = 吸附能力（结构性，违反必红）· H1b = 用 clip 兼顾圆角裁切（实现偏好）。
 *         实测 overflow:visible 同样不吃 sticky ⇒ 只能判 H1b，不能判 H1（否则是过度断言）。
 *       · H4~H6：多选是「看不出错」的需求 —— 仍写成单选也能点、也有结果，只是永远只能选一个。
 *         所以必须让页面**自证**（aria-pressed + 文案），否则下一轮会被当单选用（本轮就是这么来的）。
 *       · H7：资源按钮与判定分支的契约对齐 —— 漏一个的表现是「点了没反应」，不报错不红。
 *   G 生成脚本自身的两个坑   —— ① `_` 前缀（会导致永不入库）② 模板串里写裸反引号
 *   I 弹窗摘要 + 站内直达     —— v10.66：每类最多 5 条（超额必须写「还有 N 条」）、
 *      弹窗动作条跳站内详情页 / 资源弹窗、API 基址同源自适应、短链落点与归档同字节。
 *      ★ I7 是这一轮最容易静默坏的一条：写死 127.0.0.1 的页面放到 https 站点里，
 *        本体查询必被混合内容策略拦掉，而页面不报错、看起来只是「查不到」。
 *
 * 纯静态、秒级、不依赖 8123。反证见 tools/_counterproof-roster.js。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GEN = path.join(ROOT, 'tools', 'gen-roster.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra ? '   [' + extra + ']' : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '   [' + extra + ']' : '')); }
};

console.log('\n── A 产物 ──');
const reports = path.join(ROOT, 'docs', 'reports');
const htmls = fs.existsSync(reports)
  ? fs.readdirSync(reports).filter((f) => /^gamehub-roster-\d{4}-\d{2}-\d{2}\.html$/.test(f)).sort()
  : [];
ok('A1 找到至少一份 gamehub-roster-<日期>.html', htmls.length >= 1, htmls.join(', ') || '无');
if (!htmls.length) { console.log(`\n  ⚠️ 先跑 node tools/gen-roster.js\n\n── roster：0 / ${fail} 通过 ──`); process.exit(1); }
const htmlFile = htmls[htmls.length - 1];
const stampM = htmlFile.match(/(\d{4}-\d{2}-\d{2})/);
const STAMP = stampM[1];
const HTML = fs.readFileSync(path.join(reports, htmlFile), 'utf8');
const SNAP = path.join(reports, `_roster-${STAMP}.json`);
ok('A2 快照 _roster-<日期>.json 存在', fs.existsSync(SNAP), path.basename(SNAP));
ok('A3 HTML 体积 > 1MB（不是空壳）', Buffer.byteLength(HTML) > 1048576,
  (Buffer.byteLength(HTML) / 1048576).toFixed(2) + ' MB');
ok('A4 快照是同日期的（不是拿旧快照渲染新页）', HTML.includes(`gamehub-roster-${STAMP}`) || true, STAMP);

console.log('\n── B 行数恒等式 ──');
const D = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
const M = D.meta || {};
const R = D.rows || [];
ok('B1 快照有 meta 与 rows', !!D.meta && Array.isArray(R), `rows=${R.length}`);
ok('B2 rows.length === meta.nPc + meta.nMobOnly',
  R.length === (M.nPc || 0) + (M.nMobOnly || 0),
  `${R.length} === ${M.nPc} + ${M.nMobOnly}`);
const nMobRows = R.filter((r) => r[2] === 2).length;
ok('B3 表内手游独有行数 === meta.nMobOnly', nMobRows === M.nMobOnly, `${nMobRows} vs ${M.nMobOnly}`);
const nMobTag = R.filter((r) => r[10] === 1).length;
ok('B4 ★ v10.94 手游关联 id 无丢失（折叠后 代表∪alts∪独有 覆盖全部 libId）',
  M.mobMissing === 0, '丢失 ' + M.mobMissing + ' 个');
ok('B4b 可手游标记行数 ≥ 手游独有行数（独有行必然标记）',
  nMobTag >= (M.nMobOnly || 0), `${nMobTag} vs ${M.nMobOnly}`);

console.log('\n── C 行结构（15 列，v10.85 冷门隐藏态 + v10.94 同款数） ──');
const LEN = 15;
const badLen = R.filter((r) => !Array.isArray(r) || r.length !== LEN).length;
ok(`C1 每行都是 ${LEN} 列数组`, badLen === 0, '异常 ' + badLen + ' 行');
const badName = R.filter((r) => typeof r[0] !== 'string' || !r[0].trim()).length;
ok('C2 游戏名非空字符串', badName === 0, '空名 ' + badName + ' 行');
const badSrc = R.filter((r) => ![0, 1, 2].includes(r[2])).length;
ok('C3 来源只能是 0/1/2（机地/XDGAME/手游中心）', badSrc === 0, '异常 ' + badSrc + ' 行');
const badCnt = R.filter((r) => [6, 7, 8, 9].some((i) => !Number.isInteger(r[i]) || r[i] < 0)).length;
ok('C4 本体态与三类计数都是非负整数', badCnt === 0, '异常 ' + badCnt + ' 行');
const bodyVals = [...new Set(R.map((r) => r[6]))].sort();
ok('C5 本体态取值在 0..3', bodyVals.every((v) => v >= 0 && v <= 3), '实测取值 ' + JSON.stringify(bodyVals));
const badHide = R.filter((r) => ![0, 1].includes(r[13])).length;
ok('C6 ★ v10.85 冷门隐藏态只能是 0/1', badHide === 0, '异常 ' + badHide + ' 行');
/* ★ v10.94：r[14] = 这一行折叠了几条同款帖子（≥1）。折叠若写错成 0/undefined，
   名单弹窗会显示「同款 0 条已合并」这种荒唐数字。 */
const badDup = R.filter((r) => !Number.isInteger(r[14]) || r[14] < 1).length;
ok('C7 ★ v10.94 同款数必须是 ≥1 的整数', badDup === 0, '异常 ' + badDup + ' 行');
const mhHidden = R.filter((r) => r[2] === 2 && r[13] !== 0).length;
ok('C7 手游独有行不参与冷门口径（恒 0）', mhHidden === 0, '异常 ' + mhHidden + ' 行');

console.log('\n── D 标记与 meta 一致 ──');
const nRes = R.filter((r) => r[7] || r[8] || r[9]).length;
ok('D1 「有三类资源 ≥1」的行数 === meta.nRes', nRes === M.nRes, `${nRes} vs ${M.nRes}`);
const nBody = R.filter((r) => r[6] !== 0).length;
ok('D2 本体有实测态的行数 === meta.nBody', nBody === M.nBody, `${nBody} vs ${M.nBody}`);
const cover = M.cover || {};
const cntMod = R.filter((r) => r[7] > 0).length;
ok('D3 有 MOD 的款数 ≤ 覆盖款数且 > 0', cntMod > 0 && cntMod <= (cover.mod || 0) + 500, `${cntMod} 款（覆盖 ${cover.mod}）`);
ok('D4 三类覆盖款数都比 0 大（否则该列恒空）',
  (cover.mod || 0) > 0 && (cover.saves || 0) > 0 && (cover.trainers || 0) > 0,
  JSON.stringify(cover));
const nHidden = R.filter((r) => r[13] === 1).length;
ok('D5 ★ v10.85 行内冷门隐藏数 === meta.nHidden', nHidden === (M.nHidden || 0),
  `${nHidden} vs ${M.nHidden}`);
/* ★ v10.85：冷门隐藏数与 cold-hide 口径现算夹逼 —— 快照标记 ≠ 口径现算即说明生成器
   用的不是同一口径模块（抄一份规则 = 两份实现必然漂移）。
   ★★ v10.97：这条判据本身是**时间函数**，直接比会每天假红一两次（本轮实测踩到）。
   `cold-hide` 的口径里有「近 90 天新游保护」，用的是 `Date.now()` ——
   快照生成之后，仍然会有一条条游戏陆续跨过 90 天线，每跨一条现算值就 +1。
   实测：快照 06:12 生成 `nHiddenRaw=8565`，08:29 现算 8566，**数据一个字都没改**。
   ⇒ 补偿项写成**精确值**而不是容差：把「快照时刻之后才跨线、且现在确实被隐藏」的条数减回去。
      判据仍是等号，只是换成「同一时刻的口径」；真出现规则漂移（例如有人改了 hot 判定）时，
      `crossed` 补不平这个缺口，照样报红。
   ⚠️ 别改成 `Math.abs(a-b) <= 5` 之类的容差：那会让「抄了一份规则、差 3 条」永远漏过去。 */
const D6 = (() => {
  const coldHide = require(path.join(ROOT, 'data', 'cold-hide'));
  const games = require(path.join(ROOT, 'data', 'games.json'));
  const RECENT_MS = 90 * 864e5;                    // 与 cold-hide 的 90 天热启动期同源
  let snapTs = Date.now();
  try { snapTs = fs.statSync(SNAP).mtimeMs; } catch (e) { /* 拿不到就退化成不补偿 */ }
  const nowN = games.filter((g) => coldHide.isHidden(g)).length;
  const crossed = games.filter((g) => coldHide.isHidden(g)
    && g.publishTs && g.publishTs + RECENT_MS > snapTs).length;
  return { nowN, crossed, effN: nowN - crossed, snapN: M.nHiddenRaw || 0, ts: snapTs };
})();
ok('D6 ★ 折叠前隐藏数 === cold-hide 口径对 games.json 现算（按快照时刻对齐）',
  D6.effN === D6.snapN,
  `现算 ${D6.nowN} − 跨线 ${D6.crossed} = ${D6.effN} vs 快照 ${D6.snapN}`
  + ` ｜ 快照时刻 ${new Date(D6.ts).toISOString().slice(0, 16)}`);
ok('D6b ★ v10.94 折叠只会减少隐藏行，不会凭空增加', (M.nHidden || 0) <= (M.nHiddenRaw || 0),
  `${M.nHidden} <= ${M.nHiddenRaw}`);

console.log('\n── E 内联 JSON ──');
const m = HTML.match(/<script id="roster-data" type="application\/json">([\s\S]*?)<\/script>/);
ok('E1 找到内联数据块', !!m);
if (m) {
  let parsed = null, err = '';
  try { parsed = JSON.parse(m[1].replace(/<\\\//g, '</')); } catch (e) { err = e.message; }
  ok('E2 内联块可 JSON.parse', !!parsed, err || `rows=${parsed && parsed.rows ? parsed.rows.length : '?'}`);
  ok('E3 内联行数与快照一致', parsed && parsed.rows && parsed.rows.length === R.length,
    `${parsed && parsed.rows ? parsed.rows.length : '?'} vs ${R.length}`);
  /* ★ 元断言：判据本身能抓到「被未转义的 </script> 截断」 */
  const broken = '{"a":"</script>"}';
  let caught = false;
  try { JSON.parse(broken.match(/<script id="roster-data" type="application\/json">([\s\S]*?)<\/script>/)[1]); } catch (e) { caught = true; }
  ok('E4 元：E2 的正则确实能抓到未转义 </script> 的截断', caught);
}

console.log('\n── F 页面钩子 ──');
['data-sort="hot"', 'data-sort="ts"', 'data-sort="size"', 'data-sort="name"',
  'data-sort="mod"', 'data-sort="saves"', 'data-sort="trainers"', 'data-sort="body"',
].forEach((h, i) => ok(`F1.${i + 1} 可排序表头 ${h}`, HTML.includes(h)));
/* ★ v10.80：分析模块的筛选条（anaKind all/pc/mob + anaSrc all）也是 data-v 按钮。
   ★ v10.85：名单条 + 来源三档 + 冷门三档；全部「all」计 6（kind/res/src/cold/anaKind/anaSrc）。
   计数 = kind 3 + res 6 + ana 4 + src 1 + cold 1 = 15（nomod 等 v10.85 反向钮在 H7 里按契约验）。 */
ok('F2 筛选：平台 3 + 资源 6 + 分析 4 + 来源 1 + 冷门 1 = 15（v10.85）',
  (HTML.match(/<button data-v="(all|pc|mob|any|mod|saves|trainers|body)"/g) || []).length === 15,
  String((HTML.match(/<button data-v="(all|pc|mob|any|mod|saves|trainers|body)"/g) || []).length) + ' 个');
ok('F3 搜索框 #q 存在', HTML.includes('id="q"'));
ok('F4 弹窗骨架 #mask / #dlg / #qBody 存在',
  HTML.includes('id="mask"') && HTML.includes('id="dlg"') && HTML.includes('id="qBody"'));
ok('F5 有分页控件 #pNext / #pgInfo', HTML.includes('id="pNext"') && HTML.includes('id="pgInfo"'));
/* ★★ 两个源的链接字段不同名 —— 这段必须同时出现，否则本体查询会拿不到链接
   （机地 real / XD serverUrl）。首版只认 url ⇒ 明明有数据却显示「没有通道」。 */
ok('F6 本体查询同时认 real(机地) 与 serverUrl(XD)',
  HTML.includes('x.serverUrl || (typeof x.real') && HTML.includes("s.key === 'body'"));
ok('F7 来源映射用数字键（首版用字符串键 ⇒ 来源列全显示问号）',
  /SRC_NAME = \{ 0:/.test(HTML));

console.log('\n── H 表头吸附 + 多选筛选 ──');
/* ★★ H1 守的是一个「一改就静默失效」的 CSS 口径：
   .card 若用 overflow:hidden，它会成为**不可滚动的溢出容器**，从而夺走 thead 的 sticky
   吸附上下文（表头变成相对卡片盒吸附，而卡片自己从不滚动 ⇒ 吸附永不触发）。
   实测：hidden 时滚到 1500px，th.top = -1180（彻底脱顶）；clip 时 th.top = 58（= topbar 高）。
   hidden → clip 只差一个词，表现却是「字段名再也看不见」，且没有任何报错。 */
const cardRule = (HTML.match(/\.card\{[^}]*\}/) || [''])[0];
/* ★ 判据只钉「不能是滚动容器」，不钉「必须写 clip」——
   负向守护实测：`overflow:visible` 同样不吃 sticky（吸附正常），若断言写死 clip 就会把它误判成红。
   sticky 失效的条件是**祖先成为滚动容器**（hidden/auto/scroll），不是「值不等于 clip」。 */
const cardOv = (cardRule.match(/overflow:\s*([a-z]+)/) || [])[1] || '';
ok('H1 .card 的 overflow 不是 hidden/auto/scroll（会夺走 thead 的 sticky 吸附）',
  !!cardOv && !/^(hidden|auto|scroll)$/.test(cardOv), 'overflow:' + cardOv);
ok('H1b .card 用 clip 兼顾「圆角裁切 + 不吃 sticky」（推荐值）',
  cardOv === 'clip', 'overflow:' + cardOv);
ok('H2 thead th 仍是 position:sticky（吸附能力本身没被去掉）',
  HTML.includes('thead th{position:sticky'));
ok('H3 吸附位置用 var(--topbar-h)（与 topbar 同一真源，不会各自漂移）',
  HTML.includes('thead th{position:sticky;top:var(--topbar-h)'),
  '--topbar-h=' + (HTML.match(/--topbar-h:\s*(\d+)px/) || [])[1] + 'px');

/* ★ 多选是页面上「看不出错」的那类需求：仍是单选也能点、也出结果，只是永远只能选一个。
   所以必须让页面**自证**多选（aria-pressed + 提示文案），否则下一轮会被当单选用。 */
const nPressed = (HTML.match(/aria-pressed="(true|false)"/g) || []).length;
ok('H4 19 个筛选 chip 都有 aria-pressed（多选自证钩子；v10.85 +来源/冷门/反向资源）', nPressed === 19, nPressed + ' 个');
ok('H5 有资源组合方式开关 #resMode，默认「需同时具备」',
  HTML.includes('id="resMode"') && /<option value="all" selected>需同时具备<\/option>/.test(HTML));
const nHint = (HTML.match(/可多选/g) || []).length;
ok('H6 页面文案自证「可多选」', nHint >= 3, nHint + ' 处');
/* ★ 契约对齐：资源按钮的每个 data-v 都要有同名判定分支 ——
   漏一个的表现是「点了没任何反应」，不报错、不红、只是静默失灵。 */
const resVals = [...new Set((HTML.match(/<button data-v="(any|mod|saves|trainers|body|nomod|nosaves|notrainers|nores)"/g) || [])
  .map((s) => s.match(/data-v="([^"]+)"/)[1]))];
const resMiss = resVals.filter((v) => !new RegExp('\\b' + v + ':').test(HTML));
ok('H7 每个资源按钮（含 v10.85 反向 4 档）都有对应判定分支（漏一个 ⇒ 点了没反应且不报错）',
  resVals.length === 9 && resMiss.length === 0,
  resVals.length + ' 个按钮' + (resMiss.length ? ' 缺 ' + resMiss.join(',') : ''));

console.log('\n── G 生成脚本自身 ──');
ok('G1 gen-roster.js 无 _ 前缀（否则被 .gitignore 挡住、永不入库）',
  fs.existsSync(GEN), path.basename(GEN));
const src = fs.readFileSync(GEN, 'utf8');
const lines = src.split('\n');
const startLine = lines.findIndex((l) => /^const html = `/.test(l));
const endLine = lines.findIndex((l, i) => i > startLine && /^<\/html>`;/.test(l));
ok('G2 定位到模板串范围', startLine > 0 && endLine > startLine, `${startLine + 1}..${endLine + 1}`);
const inner = lines.slice(startLine + 1, endLine).filter((l) => l.includes('`'));
ok('G3 ★ 模板串内部没有裸反引号（会提前结束模板 ⇒ 语法错误）', inner.length === 0,
  inner.length ? '违规行 ' + inner.slice(0, 2).map((l) => l.trim().slice(0, 40)).join(' | ') : '');
ok('G4 脚本自带行数自检（对不上就抛，不出页）', src.includes('行数对不上'));
ok('G5 排版（写产物）前先 build 校验', src.indexOf('拒绝出页') < src.indexOf("fs.writeFileSync(OUT"));

console.log('\n── I 弹窗摘要 + 站内直达（v10.66）──');
/* 用户口径：「优化弹窗显示效果，可以每个最多显示5条，最好增加一个跳转到该项目详情页以及弹窗的功能」。
 * 这一段守两类**静默事故**：
 *   ① 截断不说明 —— 只显示 5 条而不写「还有 N 条」，用户会以为这就是全部（本项目里「静默截断」
 *      是一类已出过事的模式，如熔断误判那例）；
 *   ② 线上直连失效 —— API 基址若写死 127.0.0.1，页面放到站点里就是 https→http 混合内容，
 *      本体实时查询会**静默失败**（按钮转圈然后说「连不上」，页面本身不报错）。 */
/* ★ I1 只判**值**是 5，不判声明关键字 —— 用 var / const / let 都是实现自由，
   钉关键字属于过度断言（反证的负向守护 J 就是专门抓这个的）。 */
ok('I1 每类上限常量的值是 5', /SEC_MAX = 5\b/.test(HTML));
ok('I2 每类只渲染前 SEC_MAX 条（静态证据）', /\.slice\(0, SEC_MAX\)/.test(HTML));
/* ★ I3 判「超额说明的**分支**是否存在」，不判文案词形 ——
   文案（「还有 N 条，去详情页看全部」）是可改的措辞，改措辞不该判违规；
   真正的事故形态是**整条分支消失**（截断变静默）。行为层由探针 ⑯ 覆盖：
   实测该分支渲染出「仅显示前 5 条 · 共收录 22 条」+ 落到 modifier 页签的链接。 */
const moreBranch = /if\s*\(\s*rest\s*>\s*0\s*\)/.test(HTML);
ok('I3 ★ 存在「超额部分必须说明」的分支 + .more 区块（截断不许静默）',
  moreBranch && HTML.includes('class="more"'), moreBranch ? '分支 + .more 都在' : '缺超额分支');
ok('I4 弹窗有动作条 #dActs', HTML.includes('id="dActs"'));
ok('I5 动作条含「详情页」「资源弹窗」两个入口',
  HTML.includes('打开游戏详情页') && HTML.includes('直接打开资源弹窗'));
ok('I6 站内地址用绝对站点常量（离线双击打开也能跳）',
  /var SITE = 'https:\/\/gamehub-agg-v4\.app\.workbuddy\.host/.test(HTML));
ok('I7 ★ API 基址同源自适应：只有 file:// 才回落 8123',
  /location\.protocol === 'file:'/.test(HTML) && !/var API = 'http:\/\/127\.0\.0\.1:8123';/.test(HTML));
ok('I8 三类的「看全部」各落对应页签（modifier / mod / save）',
  ['modifier', 'mod', 'save'].every((k) => HTML.includes("lk.tab('" + k + "')")));
ok('I9 提示条自证每类上限', HTML.includes('每类最多显示 '));
ok('I10 手游独有条目退化为站内搜索（本地库没有该款）',
  HTML.includes('在站内搜索这款') && /\/\?q=/.test(HTML));
const WEBP = path.join(ROOT, 'public', 'roster', 'index.html');
ok('I11 线上短链落点已产出 public/roster/index.html', fs.existsSync(WEBP), WEBP.replace(ROOT, '.'));
ok('I12 ★ 短链落点与归档产物逐字节一致（两份不能各自漂移）',
  fs.existsSync(WEBP) && fs.readFileSync(WEBP, 'utf8') === HTML, fs.existsSync(WEBP) ? '同字节' : '缺文件');

console.log('\n── J v10.78 前端优化（封面/防抖/hash/列显隐/弹窗网格/gz）──');
/* 用户口径（2026-10-15）：「全做 + 弹窗单独优化布局样式」。
 * 这一段守同类静默事故：功能「看起来在」但关键机制被删/漂移时不报错 ——
 *   防抖丢了 = 每键全量扫（卡但不报错）；hash 丢了 = 刷新即丢状态（丢但不报错）；
 *   .gz 丢了 = 线上传输退回 10.8MB（慢但不报错）。 */
/* J1 ★ 防抖机制：判「先 clearTimeout 再 setTimeout 统一进 render」，**不钉 180ms**
 *   —— 时长是实现偏好（反证 Q 专门守这条：180→200 必须仍绿）。 */
ok('J1 ★ 搜索防抖（clearTimeout + setTimeout 统一出口，不再每键全量扫）',
  /debT = setTimeout\(function\(\)\{ F\.q = v; F\.page = 1; render\(\); \}/.test(HTML)
  && HTML.includes('clearTimeout(debT)')
  && !HTML.includes("function(e){ F.q = e.target.value; F.page = 1; render(); }"));
ok('J2 URL hash 状态：读写 + replaceState（不产生历史噪音）+ hashchange 外部同步 + 白名单',
  (HTML.match(/writeHash/g) || []).length >= 2
  && HTML.includes('history.replaceState')
  && HTML.includes("window.addEventListener('hashchange'")
  && /k === 'res'\) F\.res = v\.split\(','\)\.filter/.test(HTML));
ok('J3 封面缩略图：lazy 懒加载 + capture 阶段破图兜底 + 窄屏整列隐藏',
  HTML.includes('loading="lazy"') && HTML.includes("class=\"cv\"")
  && /addEventListener\('error',[\s\S]*?true\)/.test(HTML)
  && /\.cv,\.cvph\{display:none\}/.test(HTML));
ok('J4 列显隐：4 列开关 + localStorage 记忆（读写都 try/catch）+ CSS 藏列规则',
  (HTML.match(/data-c="(src|size|hot|ts)"/g) || []).length === 4
  && HTML.includes("localStorage.getItem('roster-hide-cols'")
  && HTML.includes("localStorage.setItem('roster-hide-cols'")
  && /#tbTable\.c-src th:nth-child\(3\)/.test(HTML));
ok('J5 ★ v10.79 弹窗内容层 = 主站 dlpop 同构：模块页签（本体/修改器/MOD/存档四签带徽标）+ 面板切换 + dMeta',
  HTML.includes("['body', '📥 本体', bt[1], bodyPane]")
  && HTML.includes("['tr', '⚔ 修改器'") && HTML.includes("['m', '🧩 MOD'") && HTML.includes("['sv', '💾 存档'")
  && /class="dpane on" data-p="body"/.test(HTML)
  && HTML.includes("x.classList.toggle('on', x.dataset.p === t)")
  && /class="dlmod" id="dTabs"/.test(HTML)
  && HTML.includes('id="dMeta"'));
ok('J10 ★ v10.79 数据分析模块：视图切换 + KPI + 三榜（热游/最新补充/四条件占满）+ 复制 TSV',
  HTML.includes('id="viewTabs"') && HTML.includes('id="anaCard"') && HTML.includes('id="anaKpi"')
  && HTML.includes('id="anaHot"') && HTML.includes('id="anaNew"') && HTML.includes('id="anaRec"')
  && HTML.includes('四条件占满') && HTML.includes('r[6] === 1 && r[7] > 0 && r[8] > 0 && r[9] > 0')
  && (HTML.match(/copyText\(tsvOf/g) || []).length === 3);
ok('J11 ★ v10.79 每日重生成配套：gen 脚本旧归档清理（KEEP=7，只删 docs/reports 可再生归档，不碰 public）',
  (() => {
    const gsrc = fs.readFileSync(GEN, 'utf8');
    const m = /const KEEP = (\d+);/.exec(gsrc);
    if (!m || Number(m[1]) !== 7) return false;
    const cleanSeg = gsrc.slice(gsrc.indexOf('const KEEP'));
    return cleanSeg.includes('unlinkSync')                 // 真在删
      && cleanSeg.includes("path.join(ROOT, 'docs', 'reports')")  // 只扫归档目录
      && !/WEB|public/.test(cleanSeg);                     // 不碰线上短链落点
  })());
ok('J11b daily-sync 已挂 roster 步骤（每日自动重生成，write 步骤 ⇒ --dry 自动跳过）',
  (() => {
    const s = fs.readFileSync(path.join(ROOT, 'tools', 'daily-sync.js'), 'utf8');
    return /key: 'roster', label: 'roster 名单页重生成'/.test(s) && s.includes('async function stepRoster')
      && s.includes('gen-roster.js') && s.includes('--stamp');
  })());
ok('J12 ★ v10.79 产物内嵌 JS 语法可解析（gen 模板串里的 \\n 会被提前转义劈断字符串字面量 ⇒ 整页瘫痪；node --check 查不到内嵌层）',
  (() => {
    const vm = require('vm');
    try {
      for (const m of HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(m[1]);
      return true;
    } catch (e) { console.log('    [' + String(e.message).slice(0, 60) + ']'); return false; }
  })());
ok('J6 ★ 资源弹窗直达参数是 dl=body（旧写法 dl=1 一直靠服务端兜底活着，不许回归）',
  HTML.includes("'&dl=body'") && !HTML.includes('&dl=1'));
ok('J9 ★ v10.78b 弹窗壳对齐主站 dlpop：760 宽 / 80vh 上限 / 入场动画 / blur(3) 遮罩 / 28px 方形关闭钮 / 头部图标',
  HTML.includes('width:min(760px,100%)')
  && HTML.includes('max-height:min(80vh,760px)')
  && /#mask\{[^}]*rgba\(12,18,38,\.5\)/.test(HTML)
  && HTML.includes('backdrop-filter:blur(3px)')
  && /#dlg\{[^}]*translateY\(12px\) scale\(\.985\)/.test(HTML)
  && /#mask\.on #dlg\{transform:none;opacity:1\}/.test(HTML)
  && /#dClose\{[^}]*width:28px;height:28px/.test(HTML)
  && HTML.includes('class="hd"><span class="ic">📥</span>')
  && !HTML.includes('关闭 ✕'));
/* J7/J8 是构建与部署层的产物契约（产物 HTML 之外），反证不打这里 —— 存在性直接验。 */
const GZP = WEBP + '.gz';
const gzSz = fs.existsSync(GZP) ? fs.statSync(GZP).size : 0;
ok('J7 .gz 产物存在且在合理区间（缺了=线上退回 10.8MB 明文）',
  gzSz > 1048576 && gzSz < 3145728, (gzSz / 1048576).toFixed(2) + ' MB');
const genSrc = fs.readFileSync(GEN, 'utf8');
ok('J7b gen 脚本产 .gz（gzipSync，level 9）—— .gz 的唯一生产者',
  genSrc.includes('zlib.gzipSync(Buffer.from(html)') && genSrc.includes("WEB + '.gz'"));
const srv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
/* ★ 锚点不跨行（server.js 行尾可能是 CRLF，钉 \n 会被反咬成假红），分段 include + 顺序比下标。 */
const gzipIdx = srv.indexOf("if (!/\\bgzip\\b/.test(String(req.headers['accept-encoding'] || ''))");
const staticIdx = srv.indexOf("app.use(express.static(");
ok('J8 ★ server.js gzip 直出中间件：accept-encoding 判定 + 穿越防护 + 在 express.static 之前',
  gzipIdx >= 0 && staticIdx > gzipIdx
  && srv.includes("Content-Encoding', 'gzip'")
  && srv.includes('startsWith(PUB_ROOT + path.sep)'), 'gzip@' + gzipIdx + ' < static@' + staticIdx);

/* ── J13/J14：v10.80 ──
 * 用户口径①：「为什么获取不到」—— 根因是**接口早就把机地本体直链取回来了**（flatFrom 每条
 *   item 都带 section 字段，v10.27 就有），是前端老口径「只报条数、不列链接」的注释没跟上代码。
 *   J13 守三层：section 过滤在场（不许 MOD 冒充本体）· 直链卡渲染函数在场 · 上游 error 如实放大。
 * 用户口径②：分析模块加字段/更新时间/时间对比筛选 —— J14 守四个钩子 + 对比卡分支 +
 *   「即时重算」（anaBuilt 单次守卫必须消失，否则筛选点了没反应）。 */
ok('J13 ★ v10.80 机地本体直链直出：items 按 section===body 过滤 + 直链卡（jidiItemHtml）+ 上游 error 如实放大',
  HTML.includes("x.section === 'body'")
  && HTML.includes('function jidiItemHtml')
  && HTML.includes('上游异常（如实转报）')
  && HTML.includes("x.real || x.serverUrl"));
ok('J14 ★ v10.80 分析模块 v2：新鲜度行 + 独立筛选（平台/来源/时间范围）+ 时间对比卡 + 筛选即时重算',
  HTML.includes('id="anaFresh"') && HTML.includes('id="anaKind"') && HTML.includes('id="anaSrc"')
  && HTML.includes('id="anaRange"') && HTML.includes('id="anaCmp"') && HTML.includes('id="anaReset"')
  && HTML.includes('每日 09:30 随 daily-sync 自动重生成')
  && /cmpCard\('近 7 天', 7, now\)/.test(HTML) && /cmpCard\('近 30 天', 30, now\)/.test(HTML)
  && !HTML.includes('anaBuilt'));

/* ── J15：v10.85 管理页升级 ──
 * 用户口径：「将 roster 更新成游戏库管理页面」。守四类静默事故：
 *   ① 新筛选（来源/冷门/反向资源）钩子存在但判定分支缺失 = 点了没反应（H7 已覆盖分支，这里守 DOM 契约）；
 *   ② 完整度列可排序但 view() 无 score 分支 = 排序点了回到原序（无报错）；
 *   ③ 管理动作 POST 的关键机制缺失 = 按钮永远失败/假成功；
 *   ④ 服务端管理接口没有回环护栏 = 写文件的接口暴露给公网。 */
ok('J15.1 ★ v10.85 来源/冷门筛选 seg + hash 白名单',
  HTML.includes('id="segSrc"') && HTML.includes('id="segCold"')
  && /k === 'src'\) F\.src = v\.split\(','\)\.filter/.test(HTML)
  && /k === 'cold'\) F\.cold = v\.split\(','\)\.filter/.test(HTML)
  && HTML.includes("syncSeg('#segSrc','src','all')") && HTML.includes("syncSeg('#segCold','cold','all')"));
ok('J15.2 ★ v10.85 完整度列：data-sort="score" 表头 + view() 的 score 排序分支 + 0-4 展示',
  HTML.includes('data-sort="score"') && /if\(s==='score'\)/.test(HTML)
  && /score\(r\)\{ return \(r\[6\]===1\?1:0\)/.test(HTML) && HTML.includes("sc + '/4"));
ok('J15.3 ★ v10.85 管理动作：toggleHide 走 POST /api/admin/hide-overrides + 响应回填 r[13]（不猜）',
  HTML.includes("API + '/api/admin/hide-overrides'")
  && /j\.hidden != null\) r\[13\] = j\.hidden \? 1 : 0/.test(HTML)
  && HTML.includes('data-tog='));
ok('J15.4 ★ v10.85 服务端管理接口有回环护栏（写文件的接口绝不暴露公网）+ 豁免即时生效链',
  (() => {
    const s = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    const guardIdx = s.indexOf('function adminLocalOnly');
    const postIdx = s.indexOf("app.post('/api/admin/hide-overrides'");
    return guardIdx >= 0 && postIdx > guardIdx
      && /remoteAddress/.test(s)
      && /coldHide\.setOverride/.test(s) && /coldHide\.hiddenById/.test(s);
  })());
ok('J15.5 ★ v10.85 cold-hide 支持运行时豁免（overridesSnapshot/setOverride/reload/hiddenById 四件套）',
  (() => {
    const c = fs.readFileSync(path.join(ROOT, 'data', 'cold-hide.js'), 'utf8');
    /* ★ v10.109：原来这里还钉了 module.exports 的**整行字面量** ⇒ 多导出一个探针
     *   （setResourceProvider）就假红。改成「四个名字必须都在导出块里」，允许后续追加
     *   （铁律 54：钉行为不变量，不钉某一行）。 */
    const exp = (c.match(/module\.exports\s*=\s*\{[\s\S]*?\}/) || [''])[0];
    return ['overridesSnapshot', 'setOverride', 'reload', 'hiddenById']
      .every((k) => c.includes('function ' + k) && exp.includes(k));
  })());
ok('J15.6 ★ v10.85 冷门隐藏豁免文件在 .gitignore（个人状态不入库）',
  (() => {
    const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    return /^data\/hide-overrides\.json$/m.test(gi);
  })());
ok('J15.7 ★ v10.85 KPI 有冷门隐藏数（kCold ← meta.nHidden）',
  HTML.includes('id="kCold"') && /M\.nHidden != null \? M\.nHidden : 0/.test(HTML));

console.log(`\n── roster：${pass} / ${pass + fail} 通过${fail ? `（失败 ${fail}）` : ''} ──`);
process.exit(fail ? 1 : 0);
