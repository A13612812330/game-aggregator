/* v10.111 管理台配色回初版 + 首页「管理后台」入口
 *
 * 【用户原话】「首页在名单下给一个直接进入管理页面的按钮，其次管理页面我要最开始的那种颜色样式」
 *
 * 【这一版有两个独立的坑，各自要留钉子】
 *
 *   ① 首页入口：`setBtnsDisabled()` 里是 `$$('#colSide .mini-btn')` **一把抓**。
 *      管理入口如果图省事复用 `.mini-btn`，那么「增量更新」一跑起来，
 *      **管理入口也会被置灰**（它不是那个操作的状态，却跟着一起点不动）。
 *      ⇒ 所以 A3/A4 钉的是「用独立类」这件事本身，不是某个类名长什么样。
 *
 *   ② 配色回滚：v10.105 换 cream、v10.108 改白，两次都是**颜色**决策。
 *      这次退回 v10.88 初版（蓝 + 深侧栏），有三件事最容易漏：
 *        · 深底上留 `color:var(--txt)`（#1c2330）—— hover 那一下文字直接消失；
 *        · 环境徽标继续吃 `--muted`（浅灰）—— 深侧栏上变成一块白噪点；
 *        · 顺手把骨架也退回去（`.side{position:fixed}` + `.main{margin-left}`）——
 *          用户要的是颜色，不是布局。F 段专门守这一条。
 *
 *   ★ 对比度一律**现算**（WCAG 2.1 相对亮度），不抄记忆、不抄上一版结论。
 *   ★ 反向断言先剥注释再判（铁律 201）：admin.html 的注释里刻意留了旧色号做口径记录。
 *
 * 运行：node tools/test-v10111-admin-color.js
 * 本套件只读文件，不需要起服务。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const results = [];
function ok(name, cond, extra) {
  if (typeof name !== 'string') throw new TypeError('ok(名称, 条件): 第一个参数必须是字符串名称');
  if (typeof cond !== 'boolean') throw new TypeError('ok(名称, 条件): 第二个参数必须是布尔 —— ' + name);
  results.push([cond, name, extra === undefined ? '' : String(extra)]);
  return cond;
}
/* ★ 读不到就返回空串：文档类断言应该**红一条**，不是让整套崩在 readFileSync 上
   （铁律 221 的同一个教训 —— exit=2 比断言红严重一个量级）。 */
const read = (p) => {
  try {
    return fs.readFileSync(path.join(ROOT, p), 'utf8');
  } catch {
    return '';
  }
};
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

const INDEX = read('public/index.html');
const ADMIN_RAW = read('public/admin.html');
const ADMIN = stripComments(ADMIN_RAW);
/* CSS 只取 <style> 里那一段：页面尾部还有脚本，混进来会让「不许出现某色」这类反向断言误伤 */
const CSS = (() => {
  const m = ADMIN.match(/<style>([\s\S]*?)<\/style>/);
  return m ? m[1] : ADMIN;
})();

function tok(name) {
  const m = CSS.match(new RegExp('--' + name + ':\\s*([#a-fA-F0-9(),.\\s]+?);'));
  return m ? m[1].trim() : '';
}
function lum(hex) {
  const c = String(hex).replace('#', '').trim();
  const v = c.length === 3 ? c.split('').map((x) => x + x).join('') : c;
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(v.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const A = lum(a), B = lum(b);
  return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05);
}

console.log('-- A. 首页「管理后台」入口：位置、类名、不被按钮状态绑住 --');
/* ★ 位置判据用 indexOf 比先后，不用行号 —— 行号会随任何一次插入漂移 */
const iRoster = INDEX.indexOf('href="/roster/"');
const iAdmin = INDEX.indexOf('href="/admin"');
ok('A1 首页有指向 /admin 的入口', iAdmin > 0, iAdmin > 0 ? 'index ' + iAdmin : '找不到');
ok('A2 ★ 入口在「完整名单 · Roster」**之后**（用户口径：「名单下」）',
  iRoster > 0 && iAdmin > iRoster, `roster ${iRoster} → admin ${iAdmin}`);
ok('A3 入口用独立类 .side-admin-link', /class="side-admin-link"/.test(INDEX));

/* A4 是本版的核心钉子。判据不看类名，看**入口那一条 anchor 的 class 里有没有 mini-btn**：
   只要没有，setBtnsDisabled 的 `#colSide .mini-btn` 就抓不到它。 */
const adminAnchor = (INDEX.match(/<a[^>]*href="\/admin"[^>]*>/) || [''])[0];
ok('A4 ★★ 管理入口**不是** .mini-btn（否则 setBtnsDisabled 会把它一起置灰）',
  !!adminAnchor && !/class="[^"]*\bmini-btn\b/.test(adminAnchor),
  adminAnchor ? adminAnchor.slice(0, 90) : '取不到 anchor');
ok('A5 增量更新那批按钮的禁用选择器仍只抓 .mini-btn（没被顺手扩到管理入口）',
  /\$\$\('#colSide \.mini-btn'\)\.forEach\(/.test(INDEX) && !/#colSide \.mini-btn,\s*\.side-admin-link/.test(INDEX));
ok('A6 入口是新标签打开（不打断当前浏览/筛选状态）',
  /<a[^>]*href="\/admin"[^>]*target="_blank"/.test(INDEX) && /<a[^>]*href="\/admin"[^>]*rel="noopener"/.test(INDEX));
ok('A7 有 hover 态（白底主色字 → 主色实底白字）',
  /\.side-admin-link\{[^}]*color:var\(--c-primary\)/.test(INDEX)
  && /\.side-admin-link:hover\{[^}]*background:var\(--c-primary\)[^}]*color:#fff/.test(INDEX));

console.log('\n-- B. 四张派生页同步（主源改了不重建 = 只有首页有这个入口）--');
const DERIVED = ['emulator', 'resources', 'unpack', 'extract']
  .map((n) => ({ n, html: read(`public/${n}.html`) }));
DERIVED.forEach(({ n, html }) => {
  ok(`B ${n}.html 含管理入口`, /class="side-admin-link"/.test(html) && /href="\/admin"/.test(html));
});
ok('B5 四张派生页 body 都带 data-page 标记（漏标 ⇒ 顶栏「首页」被拦成回顶部，铁律 150）',
  DERIVED.every(({ n, html }) => new RegExp(`<body[^>]*data-page="${n}"`).test(html)));

console.log('\n-- C. 管理台色板 = v10.88 初版（现取 :root，不看注释）--');
ok('C1 画布 = #eef1f6', tok('canvas').toLowerCase() === '#eef1f6', tok('canvas'));
ok('C2 主区底 = #f4f6f9（初版浅灰）', tok('bg').toLowerCase() === '#f4f6f9', tok('bg'));
ok('C3 卡片底 = #ffffff（卡片恒白，靠 1px 边框与画布分层）', tok('card').toLowerCase() === '#ffffff', tok('card'));
ok('C4 侧栏底 = #111827（初版深灰）', tok('side').toLowerCase() === '#111827', tok('side'));
ok('C5 主色 = #2563eb（初版蓝）', tok('pri').toLowerCase() === '#2563eb', tok('pri'));
ok('C6 边框 = #e3e8ef（初版灰阶）', tok('line').toLowerCase() === '#e3e8ef', tok('line'));
ok('C7 中间两版配色清干净：cream 五值 + 陶土 #e79379 + 白侧栏',
  !/#e8e2d6|#f0ebe1|#f7f2e8|#ebe5d9|#d6d0c2/i.test(CSS)
  && !/#e79379/i.test(CSS)
  && !/--side:\s*#ffffff/i.test(CSS));

console.log('\n-- D. 深侧栏在深底上的可读性（现算对比度）--');
const SIDE = tok('side'), FG = tok('side-fg'), MUTED = tok('side-muted'), ACTIVE = tok('side-active');
ok('D1 能取到侧栏四个值', !!(SIDE && FG && MUTED && ACTIVE), [SIDE, FG, MUTED, ACTIVE].join(' '));
ok('D2 导航正文对侧栏底 ≥ 7:1（AAA）', ratio(FG, SIDE) >= 7, ratio(FG, SIDE).toFixed(2) + ':1');
ok('D3 角标/次要字对侧栏底 ≥ 4.5:1',
  ratio(MUTED, SIDE) >= 4.5, ratio(MUTED, SIDE).toFixed(2) + ':1');
ok('D4 激活态白字对 #1d4ed8 ≥ 4.5:1', ratio('#ffffff', ACTIVE) >= 4.5, ratio('#ffffff', ACTIVE).toFixed(2) + ':1');
/* ★ 这条是本版最容易漏的：深底上留 var(--txt) = #1c2330 ⇒ hover 时文字与背景同色阶 */
ok('D5 ★★ hover 文字必须是 #fff，不能留 var(--txt)（深底深字 = 文字消失）',
  /\.nav a:hover\{[^}]*color:#fff/.test(CSS) && !/\.nav a:hover\{[^}]*color:var\(--txt\)/.test(CSS));
ok('D6 激活态是实底 + 白字（初版形态，不是浅底蓝字）',
  /\.nav a\.on\{background:var\(--side-active\);color:#fff/.test(CSS));
ok('D7 环境徽标不吃 --muted（浅灰底在深侧栏上是一块白噪点）',
  !/\.env-badge\{[^}]*background:var\(--muted\)/.test(CSS));

console.log('\n-- E. 蓝色主色与陶土色的关键差别：它能直接做白字实底 --');
const PRI = tok('pri'), ACC = tok('acc');
ok('E1 --pri 对白字 ≥ 4.5:1（=可做实底，所以不必像陶土那样拆成 pri/acc 两档）',
  ratio(PRI, '#ffffff') >= 4.5, ratio(PRI, '#ffffff').toFixed(2) + ':1');
ok('E2 --acc 与 --pri 同值（蓝色不需要再压深一档）', ACC.toLowerCase() === PRI.toLowerCase(), ACC + ' / ' + PRI);
ok('E3 主按钮仍是 var(--acc) 实底 + var(--pri-fg) 白字',
  /\.btn\.pri\{background:var\(--acc\);border-color:var\(--acc\);color:var\(--pri-fg\)/.test(CSS));
ok('E4 主按钮 hover 是手写的深一档蓝 #1d4ed8（不是 opacity 糊弄）',
  /\.btn\.pri:hover\{background:#1d4ed8/.test(CSS));

console.log('\n-- F. ★ 配色回滚 ≠ 骨架回退（用户说的是「颜色样式」）--');
ok('F1 侧栏仍是浮动卡片 position:relative（初版是 position:fixed）',
  /\.side\{[^}]*position:\s*relative/.test(CSS) && !/\.side\{[^}]*position:\s*fixed/.test(CSS));
ok('F2 主区不再靠 margin-left:230px 让位', !/\.main\{[^}]*margin-left/.test(CSS));
ok('F3 主区仍有圆角 var(--r-xl) 且自身滚动',
  /\.main\{[^}]*border-radius:\s*var\(--r-xl\)/.test(CSS) && /\.main\{[^}]*overflow-y:\s*auto/.test(CSS));
ok('F4 矢量图标仍在（配色回滚不该把 v10.108 的图标成果一起退掉）',
  /\.nav a svg\{[^}]*stroke-width:\s*1\.7/.test(CSS));

console.log('\n-- G. 文档与版本登记 --');
const DOC = read('docs/versions/v10.111.md');
ok('G1 有本版说明 docs/versions/v10.111.md', DOC.length > 600, DOC.length + 'B');
ok('G2 说明里写清了「回的是哪一版配色、为什么、骨架为什么不动」',
  /配色/.test(DOC) && /骨架/.test(DOC) && /3b4f797|f958d5d|v10\.88/.test(DOC));
ok('G3 版本索引登记了 v10.111', /v10\.111/.test(read('docs/versions/README.md')));

const bad = results.filter((r) => !r[0]);
results.forEach((r) => {
  console.log((r[0] ? '  PASS  ' : '  ❌ FAIL  ') + r[1] + (r[2] ? '  → ' + r[2] : ''));
});
console.log('\n' + '='.repeat(68));
console.log('结果：' + (results.length - bad.length) + ' / ' + results.length + ' 通过');
process.exit(bad.length ? 1 : 0);
