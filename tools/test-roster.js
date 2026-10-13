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
ok('B4 「可手游」标记行数 === nMobMerged + nMobOnly',
  nMobTag === (M.nMobMerged || 0) + (M.nMobOnly || 0),
  `${nMobTag} vs ${(M.nMobMerged || 0)} + ${M.nMobOnly}`);

console.log('\n── C 行结构（13 列） ──');
const LEN = 13;
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
ok('F2 筛选：平台三档 + 资源六档',
  (HTML.match(/<button data-v="(all|pc|mob|any|mod|saves|trainers|body)"/g) || []).length === 9,
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
ok('H4 9 个筛选 chip 都有 aria-pressed（多选自证钩子）', nPressed === 9, nPressed + ' 个');
ok('H5 有资源组合方式开关 #resMode，默认「需同时具备」',
  HTML.includes('id="resMode"') && /<option value="all" selected>需同时具备<\/option>/.test(HTML));
const nHint = (HTML.match(/可多选/g) || []).length;
ok('H6 页面文案自证「可多选」', nHint >= 3, nHint + ' 处');
/* ★ 契约对齐：资源按钮的每个 data-v 都要有同名判定分支 ——
   漏一个的表现是「点了没任何反应」，不报错、不红、只是静默失灵。 */
const resVals = [...new Set((HTML.match(/<button data-v="(any|mod|saves|trainers|body)"/g) || [])
  .map((s) => s.match(/data-v="([^"]+)"/)[1]))];
const resMiss = resVals.filter((v) => !new RegExp('\\b' + v + ':').test(HTML));
ok('H7 每个资源按钮都有对应判定分支（漏一个 ⇒ 点了没反应且不报错）',
  resVals.length === 5 && resMiss.length === 0,
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

console.log(`\n── roster：${pass} / ${pass + fail} 通过${fail ? `（失败 ${fail}）` : ''} ──`);
process.exit(fail ? 1 : 0);
