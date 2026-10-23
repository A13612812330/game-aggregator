/* v10.107 四个模块收成一个「资源管理」入口
 *
 * 【为什么合】用户口径：「参考站的资源是一个『资源管理』入口，我们拆成了本体/MOD/
 *   修改器/存档四个菜单，要不要也收成一个」→「可以」。
 *   四个模块本来就共用 `#view-resm` 一个 section、一套渲染器，侧栏四扇门通向同一个房间，
 *   换的只是 `rmMod` 一个变量 —— 四扇门是纯重复。
 *
 * 【合并最容易烂在哪】三条，都必须有断言：
 *   ① 只删菜单不删残留：侧栏少了三项，`$('nBase')` / `VIEWS['m-mod']` 还散在代码里，
 *      运行时抛 ReferenceError 或者静默走旧分支 —— 页面看着正常，切模块是错的。
 *   ② 老链接失效：`#m-mod` 曾经可以直接打开，加了书签的人一点就掉到仪表盘。
 *   ③ 数字丢了：侧栏四个角标搬走后，如果没搬到页签上，用户就再也看不到各模块的量。
 *
 * 运行：node tools/test-v10107-rm-merge.js
 * 只读文件，不需要起服务（交互行为在 tools/_probe-rm.js 里实测过，见版本文档）。
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
/* 剥注释再判：本文件的注释里就写着 `data-v="m-base"` 这些「旧写法」，
   不剥会把解释文字判成犯规（铁律 201）。 */
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

const ADMIN_RAW = read('public/admin.html');
const ADMIN = stripComments(ADMIN_RAW);
const CSS = ADMIN.slice(ADMIN.indexOf('<style>'), ADMIN.indexOf('</style>'));
const NAV = ADMIN.slice(ADMIN.indexOf('<nav class="nav"'), ADMIN.indexOf('</nav>'));
const navOrder = [...NAV.matchAll(/data-v="([^"]+)"/g)].map((m) => m[1]);

console.log('\n-- A. 侧栏：七个入口，模块不再各占一条 --');
ok('A1 侧栏恰好 7 项', navOrder.length === 7, navOrder.join(','));
ok('A2 顺序 = 仪表盘 / 游戏库 / 资源管理 / 覆盖与缺口 / 日志 / 磁力 / 设置',
  JSON.stringify(navOrder) === JSON.stringify(['dash', 'games', 'rm', 'res', 'log', 'dl', 'set']),
  navOrder.join(','));
ok('A3 有「资源管理」入口（data-v="rm"）', navOrder.includes('rm'));
ok('A4 反向：侧栏没有任何按模块拆的条目（m-* / rm-* 均应为 0）',
  !/data-v="m-/.test(NAV) && !/data-v="rm-/.test(NAV));
ok('A5 反向：侧栏不再有 nBase/nMod/nTrainer/nSave 角标节点',
  !/id="nBase"|id="nMod"|id="nTrainer"|id="nSave"/.test(ADMIN));

console.log('\n-- B. 页内两级页签：模块（一级）/ 子源（二级） --');
ok('B1 一级页签容器 #rmModTabs 存在', /id="rmModTabs"/.test(ADMIN));
ok('B2 一级页签在二级页签之前（层次不能倒）',
  ADMIN.indexOf('id="rmModTabs"') < ADMIN.indexOf('id="rmTabs"'));
ok('B3 paintModTabs() 按 RM 的 key 渲染四个模块',
  /function paintModTabs\(\)[\s\S]{0,400}?Object\.keys\(RM\)\.map/.test(ADMIN));
ok('B4 页签上的数字来自 MOD_CNT（不是写死）',
  /MOD_CNT && MOD_CNT\[k\] != null[\s\S]{0,120}?nf\(MOD_CNT\[k\]\)/.test(ADMIN));
ok('B5 拿不到数字时只显示名字，不印 0（0 会被读成"这一类一条都没有"）',
  !/MOD_CNT \|\| \{\}|MOD_CNT \?\? \{\}/.test(ADMIN) && /\? '<b class="cnt">'/.test(ADMIN));
ok('B6 modPick(k) 切模块走 go()（不另造第二套切换逻辑）',
  /function modPick\(k\)[\s\S]{0,320}?go\(k === 'base' \? 'rm' : 'rm-' \+ k\)/.test(ADMIN));
ok('B8 resmReload 每次重载都重绘一级页签（否则切模块后页签停在旧模块上）',
  /paintModTabs\(\);\s*\$\('rmTabs'\)\.innerHTML = mod\.srcs\.map/.test(ADMIN));
ok('B7 一级页签比二级重（.mtab.mod 有自己的选中样式，两级不会长得一样）',
  /\.mtab\.mod\.on\{/.test(CSS) && /\.mtab\.mod\{/.test(CSS));

console.log('\n-- C. 路由与老链接 --');
const ALIAS = ADMIN.slice(ADMIN.indexOf('const HASH_ALIAS = {'), ADMIN.indexOf('};', ADMIN.indexOf('const HASH_ALIAS = {')));
['m-base', 'm-mod', 'm-trainer', 'm-save'].forEach((k) => {
  ok('C' + (['m-base', 'm-mod', 'm-trainer', 'm-save'].indexOf(k) + 1) + ' 旧 hash #' + k + ' 在别名表里（书签不能死）',
    ALIAS.includes("'" + k + "'"));
});
ok('C5 go() 把 rm-<模块> / 旧 m-<模块> 都折成「rm + 该模块」',
  /let mod = HASH_ALIAS\[v\] \|\| null;[\s\S]{0,220}?v = 'rm';/.test(ADMIN));
ok('C6 标题与面包屑跟着**当前模块**走（不写死某一个模块）',
  /\['资源管理 · ' \+ RM\[rmMod\]\.label, crmOf\(rmMod\)\]/.test(ADMIN));
ok('C7 hash 带模块（刷新 / 复制地址后仍停在同一格）',
  /const hv = \(v === 'rm'\) \? 'rm-' \+ rmMod : v;/.test(ADMIN));
ok('C8 hashchange 认别名（否则手改地址栏地址变了界面不动）',
  /VIEWS\[v\] \|\| HASH_ALIAS\[v\] \|\| \(v\.indexOf\('rm-'\) === 0 && RM\[v\.slice\(3\)\]\)/.test(ADMIN));
ok('C9 点侧栏「资源管理」保留当前模块（不弹回本体）',
  /go\(v === 'rm' \? 'rm-' \+ rmMod : v\)/.test(ADMIN));
ok('C10 直接进 #rm-mod 时补一次 overview（页签上才有数字）',
  /if \(!MOD_CNT\) loadStats\(\);/.test(ADMIN));

console.log('\n-- D. 反向：旧的按模块写法必须清零 --');
/* ★ 只看 VIEWS 这一块：HASH_ALIAS 里**必须**留着 'm-base' 这些键（老链接要能进），
   拿整份文件判会把别名表判成犯规 —— 范围写错，断言方向就反了。 */
const VIEWS_BLOCK = ADMIN.slice(ADMIN.indexOf('const VIEWS = {'), ADMIN.indexOf('};', ADMIN.indexOf('const VIEWS = {')));
ok('D1 VIEWS 里不再有 m-* 四条（别名表不算）',
  !/'m-(base|mod|trainer|save)':/.test(VIEWS_BLOCK), VIEWS_BLOCK.length + 'B');
ok('D2 不再有「v.indexOf(\'m-\')」这种视图名判断',
  !/v\.indexOf\('m-'\)/.test(ADMIN));
ok('D3 不再有 nBase/nMod 之类的直接取节点',
  !/\$\('n(base|Base|mod|Mod|trainer|Trainer|save|Save)'\)/.test(ADMIN));

console.log('\n-- E. 列表可读性（合并后才暴露的三个排版问题） --');
ok('E1 操作列宽 178px（120px 装不下「查看 + Repack 页」，每行折成两行）',
  /<th style="width:178px">操作<\/th>/.test(ADMIN) && !/<th style="width:120px">操作<\/th>/.test(ADMIN));
ok('E2 操作列不许折行', /#rmRows td:last-child\{white-space:nowrap\}/.test(CSS));
ok('E3 游戏标题单行截断（长标题折两三行会把整张表行高拉得参差不齐）',
  /\.fxrow \.lnk\{display:block;max-width:300px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis\}/.test(CSS));
ok('E4 游戏 id 用**兄弟**选择器（它是 .lnk 的 sibling，写成后代选择器根本不会命中）',
  /\.fxrow td > small\{display:block/.test(CSS) && !/\.fxrow \.lnk small\{/.test(CSS));

console.log('\n-- F. 文档与版本登记 --');
const DOC = read('docs/versions/v10.107.md');
ok('F1 有本版说明 docs/versions/v10.107.md', DOC.length > 500, DOC.length + 'B');
ok('F2 说明里写了「为什么合」（口径来源，不是凭感觉）', /资源管理/.test(DOC) && /重复|同一/.test(DOC));
ok('F3 说明里写了老链接的处理方式', /m-mod|别名/.test(DOC));
ok('F4 版本索引登记了 v10.107', /v10\.107/.test(read('docs/versions/README.md')));
ok('F5 README 更新日志有 v10.107 段', /v10\.107/.test(read('README.md')));
ok('F6 run-all 登记了本套件', /test-v10107-rm-merge\.js/.test(read('tools/run-all.js')));

/* ── 汇总 ── */
const bad = results.filter((r) => !r[0]);
for (const [c, n, e] of results) console.log((c ? '  PASS  ' : '  × FAIL  ') + n + (e ? '  (' + e + ')' : ''));
console.log('\n结果：' + (results.length - bad.length) + ' / ' + results.length + ' 通过');
if (bad.length) console.log('失败项：\n' + bad.map((r) => '  · ' + r[1]).join('\n'));
process.exit(bad.length ? 1 : 0);
