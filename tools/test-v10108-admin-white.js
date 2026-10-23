/* v10.108 管理台改白（白底 + recapo 的分节母版 + boardui 的组件形态）
 *
 * 【守什么】这一版**只改视觉**，但「只改样式」的改动最容易在下轮被顺手改回去，
 *   而且改回去之后页面照样能开、功能测试全绿 —— 所以每条都要留形状断言：
 *     · 白底不是「把画布改白」一件事：画布 / 主区 / 卡片 / 侧栏**四个面**都得白，
 *       少一个就会出现「白纸上贴一块米色」的夹生状态；
 *     · 主色在白底上必须重新算对比度（cream 时代那档 #bf6a50 只有 3.89:1）；
 *     · 面板改成「分节」后不许再长回卡片框（那是 recapo 那层参考被丢掉的样子）；
 *     · 侧栏图标从 unicode 字符换成了矢量，得同时验「有 svg」和「旧字符清干净」。
 *   ★ 反向断言一律**先剥注释再判**：本文件与 admin.html 里解释「为什么不用某个值」的
 *     注释本身就含旧色值，不剥会把正当注释判成犯规（铁律 201）。
 *
 * 运行：node tools/test-v10108-admin-white.js
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
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

const ADMIN_RAW = read('public/admin.html');
const ADMIN = stripComments(ADMIN_RAW);
const CSS = ADMIN.slice(ADMIN.indexOf('<style>'), ADMIN.indexOf('</style>'));

/* ── 对比度：现算，不写死。WCAG 2.1 相对亮度公式 ───────────────── */
function hex2rgb(h) {
  const s = h.replace('#', '').trim();
  const n = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}
function lum(h) {
  const [r, g, b] = hex2rgb(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
/** 从 CSS 里取某个变量的值（只取 :root 里第一条） */
function tok(name) {
  const m = CSS.match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{3,6})'));
  return m ? m[1] : null;
}

function fin() {
  const bad = results.filter((r) => !r[0]);
  results.forEach((r) => {
    console.log((r[0] ? '  PASS  ' : '  ❌ FAIL  ') + r[1] + (r[2] ? '  → ' + r[2] : ''));
  });
  console.log('\n' + '='.repeat(68));
  console.log('结果：' + (results.length - bad.length) + ' / ' + results.length + ' 通过');
  process.exit(bad.length ? 1 : 0);
}

console.log('-- A. 白底：四个面都要白，cream 必须清干净（剥注释后判）--');
ok('A1 画布 = #ffffff', /--canvas:\s*#ffffff/i.test(CSS));
ok('A2 主区底 = #ffffff', /--bg:\s*#ffffff/i.test(CSS));
ok('A3 卡片底 = #ffffff（白底靠 1px 边框分层，不靠底色差）', /--card:\s*#ffffff/i.test(CSS));
ok('A4 侧栏底 = #ffffff', /--side:\s*#ffffff/i.test(CSS));
ok('A5 cream 五个值一个不留（#e8e2d6 / #f0ebe1 / #f7f2e8 / #ebe5d9 / #d6d0c2）',
  !/#e8e2d6|#f0ebe1|#f7f2e8|#ebe5d9|#d6d0c2/i.test(CSS));
ok('A6 新灰阶：边框 #e6e8ec + 发丝线 #f0f1f4',
  /--line:\s*#e6e8ec/i.test(CSS) && /--hairline:\s*#f0f1f4/i.test(CSS));
ok('A7 主色没被改掉（换的是底色与灰阶，不是品牌色）', tok('pri') === '#e79379', tok('pri'));

console.log('\n-- B. 白底上的对比度：现算，不抄记忆 --');
const ACC = tok('acc'), TXT = tok('txt'), SUB = tok('sub'), CARD = tok('card');
ok('B1 能取到 --acc / --txt / --sub / --card 四个值',
  !!(ACC && TXT && SUB && CARD), [ACC, TXT, SUB, CARD].join(' '));
const rAcc = ACC ? ratio(ACC, '#ffffff') : 0;
ok('B2 主按钮实底对白字 ≥ 4.5:1（AA，正文级）', rAcc >= 4.5, rAcc.toFixed(2) + ':1');
const rTxt = TXT ? ratio(TXT, CARD) : 0;
ok('B3 正文对卡片底 ≥ 7:1（AAA）', rTxt >= 7, rTxt.toFixed(2) + ':1');
const rSub = SUB ? ratio(SUB, CARD) : 0;
ok('B4 次要文字 ≥ 4.5:1（它承载「更新时间 / 评分」这类事实值）', rSub >= 4.5, rSub.toFixed(2) + ':1');
ok('B5 ★ 主色 --pri 只做浅底/描边，不做白字实底（它自己不到 3:1，白字压不住）',
  (tok('pri') ? ratio(tok('pri'), '#ffffff') : 9) < 3.0 && /--pri-fg:#fff/i.test(CSS));

console.log('\n-- C. 页头：小标签在上、大标题在下（recapo 的层级，不是列表头）--');
ok('C1 面包屑独占一行且排到标题前', /\.top \.crumb\{[^}]*flex-basis:\s*100%/.test(CSS)
  && /\.top \.crumb\{[^}]*order:\s*-1/.test(CSS));
ok('C2 页标题 19px（原来 14px 是列表头尺寸）', /\.top h2\{[^}]*font-size:\s*19px/.test(CSS));
ok('C3 标题前的假斜杠已去掉（面包屑已经表达了路径）', /\.top h2::before\{content:\s*none\}/.test(CSS));

console.log('\n-- D. 面板去框化：白底上「框套框」会让边界打架 --');
ok('D1 .panel 不再是 box + border', /\.panel\{background:\s*none;border:\s*0/.test(CSS));
ok('D2 分节靠标题下的发丝线', /\.panel \.ph\{[^}]*border-bottom:\s*1px solid var\(--line\)/.test(CSS));
ok('D3 内容贴页面、只在标题下留白（padding:14px 0 0）', /\.panel \.pb\{padding:\s*14px 0 0\}/.test(CSS));
ok('D4 .stat 仍是白底卡片（统计卡要能一眼成组）', /\.card\{background:var\(--card\);border:1px solid var\(--line\)/.test(CSS));

console.log('\n-- E. 侧栏：矢量图标 + 分组标题不重复 --');
const navItems = (ADMIN.match(/<a data-v="[a-z]+"/g) || []).length;
ok('E1 侧栏 7 个导航项都在', navItems === 7, navItems + ' 项');
const svgInNav = (ADMIN.match(/<a data-v="[a-z]+"[^>]*><i><svg viewBox="0 0 24 24"/g) || []).length;
ok('E2 7 项各带一个 24 格矢量图标', svgInNav === 7, svgInNav + ' 个');
/* ★ 作用域收到侧栏：全文件里还有别处用几何字符（仪表盘模块卡头部的 ◆ ◈ ⚔ ▣）
   和一句解释性注释（已剥），它们不是本轮改的对象 —— 拿全文件判会把正当用法判成残留。 */
const NAV_BLOCK = ADMIN.slice(ADMIN.indexOf('<nav class="nav"'), ADMIN.indexOf('</nav>'));
ok('E3 侧栏里旧 unicode 图标字符清干净（▦ ▤ ⛃ ◇ ≡ ⇩ ⚙）',
  NAV_BLOCK.length > 200 && !/[▦▤⛃◇≡⇩⚙]/.test(NAV_BLOCK), NAV_BLOCK.length + 'B');
ok('E4 图标跟 currentColor 走（选中时自动变主色）',
  /\.nav a svg\{[^}]*stroke:\s*currentColor/.test(CSS));
/* 模块卡头部：v10.108 之前直接渲染 `m.icon` 的 unicode 字符，在正文里掉成豆腐块。
   侧栏换矢量后这里成了唯一还在赌字体的地方 ⇒ 一并守。 */
ok('E5b 模块卡头部不再渲染 unicode 图标（改走 MOD_ICON 的矢量）',
  /MOD_ICON\[m\.key\]/.test(ADMIN) && !/>' \+ m\.icon \+/.test(ADMIN));
const secCount = (ADMIN.match(/<div class="sec">/g) || []).length;
ok('E5 ★ 分组标题不重复：v10.107 漏删的第二个「内容」已清（3 组：总览 / 内容 / 运维）',
  secCount === 3 && (ADMIN.match(/<div class="sec">内容<\/div>/g) || []).length === 1, secCount + ' 组');

console.log('\n-- F. 资料完整度：常态不该是红色警报 --');
ok('F1 仍是「n/7」口径（没改数据语义）', /comp \+ '\/7/.test(ADMIN));
ok('F2 只有 0 项才走红色档（zero），2/7 这类常态用中性灰',
  /comp === 0 \? 'zero'/.test(ADMIN) && !/'lo'/.test(ADMIN));
ok('F3 条长按 n/7 现算（不是写死 30% 之类的假进度）',
  /width:calc\(var\(--n,0\) \/ 7 \* 100%\)/.test(CSS));
ok('F4 计量条有 title 兜底（条本身读不出具体数字）', /title="资料 7 项里填了几项"/.test(ADMIN));

console.log('\n-- G. 细节：白底上最容易露馅的四处 --');
ok('G1 弹窗遮罩带背景模糊（纯 38% 黑在半透明内容上会糊成一片）', /backdrop-filter:\s*blur/.test(CSS));
ok('G2 滚动条收成细轨（默认浅灰块在长表格里很扎眼）', /::-webkit-scrollbar-thumb\{[^}]*border-radius/.test(CSS));
ok('G3 键盘焦点可见', /:focus-visible\{outline:\s*2px solid/.test(CSS));
ok('G4 输入框焦圈统一成 16%（22% 在白底上是一片粉雾）',
  !/rgba\(231,\s*147,\s*121,\s*\.22\)/.test(CSS) && /rgba\(231,\s*147,\s*121,\s*\.16\)/.test(CSS));

console.log('\n-- H. 文档与版本登记 --');
const DOC = read('docs/versions/v10.108.md');
ok('H1 有本版说明 docs/versions/v10.108.md', DOC.length > 700, DOC.length + 'B');
ok('H2 说明里三个参考各借了哪一层写清楚了（recapo / boardui / designeer）',
  /recapo/i.test(DOC) && /boardui/i.test(DOC) && /designeer/i.test(DOC));
ok('H3 说明里明确写了「没借深色站底色」（不然下轮有人拿参考站来"修正"成深色）',
  /没借/.test(DOC) && /深色/.test(DOC) && /底色/.test(DOC));
ok('H4 版本索引登记了 v10.108', /v10\.108/.test(read('docs/versions/README.md')));
ok('H5 README 更新日志有 v10.108 段', /v10\.108/.test(read('README.md')));
ok('H6 本套件已登记 run-all', /test-v10108-admin-white\.js/.test(read('tools/run-all.js')));
ok('H7 PITFALLS 收进了本轮的坑', /v10\.108/.test(read('PITFALLS.md')));

fin();
