/* v10.105 管理台换肤（对齐参考站 `仪表盘 · GameHub 后台管理`，cream 主题）
 *
 * 【守什么】这一版只动视觉，不动任何业务逻辑 —— 正因为「只动样式」最容易被随手改回去，
 *   而且改回去之后**页面照样能开**（不像功能坏了会报错），所以必须留形状断言：
 *     · 浮动侧栏（.side 不再是 fixed、.main 不再靠 margin-left 让位）
 *     · cream 口径的三个关键色（画布 / 主色 / 侧栏底）
 *     · 页签条由 go() 现写（不是写死一段假标签）
 *     · 环境徽标按 hostname 现判（写死「线上」会在本机说假话）
 *   ★ 反向断言一律**先剥注释再判**：这个文件里解释「为什么不用蓝色」的注释本身
 *     就含 `#2563eb`，不剥会把正当注释判成犯规（铁律 201）。
 *
 * 运行：node tools/test-v10105-admin-theme.js
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
/* 剥注释：/* *\/ 与 <!-- --> 与整行 // 注释都去掉，避免负向断言被解释性文字咬到 */
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

const ADMIN_RAW = read('public/admin.html');
const ADMIN = stripComments(ADMIN_RAW);
const CSS = ADMIN.slice(ADMIN.indexOf('<style>'), ADMIN.indexOf('</style>'));

function fin() {
  const bad = results.filter((r) => !r[0]);
  results.forEach((r) => {
    console.log((r[0] ? '  PASS  ' : '  ❌ FAIL  ') + r[1] + (r[2] ? '  → ' + r[2] : ''));
  });
  console.log('\n' + '='.repeat(68));
  console.log('结果：' + (results.length - bad.length) + ' / ' + results.length + ' 通过');
  process.exit(bad.length ? 1 : 0);
}

console.log('-- A. 设计 token：取自参考站 [data-theme=cream] --');
ok('A1 画布色 = #e8e2d6（参考 --layout-canvas）', /--canvas:\s*#e8e2d6/i.test(CSS));
ok('A2 主色 = #e79379（参考 --primary）', /--pri:\s*#e79379/i.test(CSS));
ok('A3 侧栏底 = #ebe5d9（参考 --sidebar-background）', /--side:\s*#ebe5d9/i.test(CSS));
ok('A4 卡片底 = #f7f2e8（参考 --card）', /--card:\s*#f7f2e8/i.test(CSS));
ok('A5 边框 = #d6d0c2（参考 --border）', /--line:\s*#d6d0c2/i.test(CSS));

console.log('\n-- B. 骨架：浮动侧栏 + 圆角主区 --');
ok('B1 .side 不再是 position:fixed（改浮动卡片）',
  /\.side\{[^}]*position:\s*relative/.test(CSS) && !/\.side\{[^}]*position:\s*fixed/.test(CSS));
ok('B2 .main 不再靠 margin-left:230px 让位',
  !/\.main\{[^}]*margin-left/.test(CSS));
ok('B3 .shell 是 12px 间距的整屏 flex', /\.shell\{[^}]*gap:\s*var\(--gap\)/.test(CSS) && /\.shell\{[^}]*height:\s*100dvh/.test(CSS));
ok('B4 .side 有圆角（参考 .layout-root--floating 的 8px）', /\.side\{[^}]*border-radius:\s*var\(--r-lg\)/.test(CSS));
ok('B5 .main 圆角 10px 且自身滚动', /\.main\{[^}]*border-radius:\s*var\(--r-xl\)/.test(CSS) && /\.main\{[^}]*overflow-y:\s*auto/.test(CSS));

console.log('\n-- C. 组件口径 --');
ok('C1 统计卡 4 列（参考 .stat-grid repeat(4,…)）', /\.g6\{grid-template-columns:\s*repeat\(4/.test(CSS));
ok('C2 统计数字 24px / 600（参考 .stat-card__value）', /\.stat b\{[^}]*font-size:\s*24px/.test(CSS) && /\.stat b\{[^}]*font-weight:\s*600/.test(CSS));
ok('C3 页签条当前签有 2px 主色下划线（参考 .tab__bar）',
  /\.tab\.on::after\{[^}]*height:\s*2px/.test(CSS) && /\.tab\.on::after\{[^}]*background:\s*var\(--pri\)/.test(CSS));
ok('C4 表头用 --muted 底（参考 --table-header-bg）', /th\{[^}]*background:\s*var\(--muted\)/.test(CSS));
ok('C5 主按钮用深一档主色（#e79379 上白字只有 2.6:1，读不了）',
  /\.btn\.pri\{background:\s*var\(--acc\)/.test(CSS));
ok('C6 下载设置的下拉也有同一套边框（否则掉回浏览器灰白控件）', /\.dlcfg select\{[^}]*border:\s*1px solid var\(--line\)/.test(CSS));

console.log('\n-- D. 页签条 / 环境徽标：都得是现算的，不许写死 --');
ok('D1 有页签节点 id="vTab"', /id="vTab"/.test(ADMIN));
ok('D2 go() 里同步页签文案', /const vt = \$\('vTab'\); if \(vt\) vt\.textContent = t;/.test(ADMIN));
ok('D3 ★ 页签同步前先判空（老缓存没这个节点时不能把 go() 打断）',
  !/\$\('vTab'\)\.textContent = t;/.test(ADMIN));
ok('D4 有环境徽标 id="envBadge"', /id="envBadge"/.test(ADMIN));
ok('D5 ★ 环境按 hostname 现判，不写死「线上」',
  /const isLocal = \/\^\(localhost\|127\\\.0\\\.0\\\.1/.test(ADMIN)
  && /eb\.textContent = isLocal \? '本机' : '线上'/.test(ADMIN));
ok('D6 品牌行有 logo 图（参考 .sider-brand__logo 20px）', /class="logo"/.test(ADMIN) && /\.brand \.logo\{[^}]*width:\s*20px/.test(CSS));

console.log('\n-- E. 反向：旧蓝配色必须清干净（剥注释后判） --');
ok('E1 不再有 #2563eb（旧主蓝）', !/#2563eb/i.test(CSS));
ok('E2 不再有 #1d4ed8（旧侧栏选中）', !/#1d4ed8/i.test(CSS));
ok('E3 不再有 rgba(37,99,235（旧 focus 圈）', !/rgba\(37,\s*99,\s*235/i.test(CSS));
ok('E4 侧栏不再是深色 #111827', !/--side:\s*#111827/i.test(CSS));
console.log('   （阳性对照：E5 检查剥注释这一步没有把样式表整体吃掉）');
ok('E5 阳性对照 —— 剥注释后剩下的 CSS 仍含 .side 规则且 > 8KB',
  /\.side\{/.test(CSS) && CSS.length > 8000, 'CSS ' + CSS.length + 'B');

console.log('\n-- F. 文档与版本登记 --');
const DOC = read('docs/versions/v10.105.md');
ok('F1 有本版说明 docs/versions/v10.105.md', DOC.length > 400, DOC.length + 'B');
ok('F2 说明里写清了 token 来源（不是凭印象调色）', /data-theme=cream/.test(DOC));
ok('F3 版本索引登记了 v10.105', /v10\.105/.test(read('docs/versions/README.md')));

console.log('\n-- G. 部署体检时捞出来的两件事 --');
const SERVER = read('server.js');
/* G1：判版不能再依赖「本机拉线上文件」——发布机上 DNS/代理都不通（实测 CONNECT 502、
 * 直连Could not resolve），所以让线上自报 md5 的端点必须存在。 */
ok('G1 有 /api/build 版本自证端点（线上自报 md5，不靠本机出网）',
  /app\.get\('\/api\/build'/.test(SERVER) && /md5:\s*crypto\.createHash\('md5'\)/.test(SERVER));
ok('G2 ★ 该端点只回文件名/md5/字节数，不回绝对路径（公开端点不许泄露部署目录）',
  /app\.get\('\/api\/build'[\s\S]{0,320}?files:\s*BUILD_STAMP/.test(SERVER) && !/BUILD_STAMP[\s\S]{0,200}__dirname *\+/.test(SERVER));
/* G3：线上容器残留文件必须被显式拒绝 —— 仓库里零引用的页面还对外 200，就是「幽灵页」。 */
ok('G3 幽灵页 overview.html 进 DEAD_PAGES 名单且被 410',
  /const DEAD_PAGES = new Set\(\['overview\.html'\]\)/.test(SERVER)
  && /DEAD_PAGES\.forEach[\s\S]{0,240}?status\(410\)/.test(SERVER));
ok('G4 名单定义在 express.static 之前（否则静态中间件先把它 200 出去）',
  SERVER.indexOf('const DEAD_PAGES') < SERVER.indexOf('app.use(express.static('));
/* G5：自证端点要跳过幽灵页。两处各写一份名单的话，线上清单会永远比本地多一页 —— 
 * 那不是"发现了新问题"，而是自己去制造了一个永远修不掉的差异。 */
ok('G5 /api/build 扫描时跳过 DEAD_PAGES（否则线上清单永远多一页）',
  /if \(DEAD_PAGES\.has\(f\)\) continue;/.test(SERVER));

fin();
