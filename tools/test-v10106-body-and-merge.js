/* v10.106 本体「只剩 FitGirl」的真根因 + 后台「页面管理」并入游戏库
 *
 * 【A 段守什么】用户口径：「为什么本体仅 FitGirl 了，不是有机地跟 XD 吗」。
 *   实测（渔力全开 / xd-15568）拆出两个独立缺陷，缺一个都复现：
 *     ① `xdItems` 用 `filter(i => i.real)` 过滤 —— XD 要登录时 6 个盘口的 real 全是
 *        null ⇒ 整类丢光，界面显示「0 / 6 条可用」。盘口页地址 serverUrl 明明是可点的。
 *     ② 归帖键退到 `'u:' + real` —— real 为 null 时 6 个盘口**键全等**，6 行合成 1 行。
 *     ③ 库里 `jidiUrl` 只在同步时合并过一部分；渔力全开 xd-15568 是 null，
 *        而 /api/library/twin 按名命中 jidi-2117239899（35 帖 / 84 地址）——
 *        不补这一路，打开 XD 那条永远看不到机地。
 *   ★ 这三条都不报错、页面照常渲染，只是「少东西」⇒ 必须有形状断言兜住。
 *
 * 【B 段守什么】页面管理 + 游戏库合并。合并最怕「只删菜单不删 DOM」：
 *   侧栏少了「页面管理」，但 #view-pages 还躺在文件里，点 hash 还能进一个死页面。
 *   所以这里同时断言「旧的不在了」和「新的能切」。
 *
 * 运行：node tools/test-v10106-body-and-merge.js
 * 只读文件，不需要起服务。
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
/* 剥注释再判：本文件的解释性注释里就写着 `filter(i => i.real)` 这些「错误写法」，
   不剥会把注释判成犯规（铁律 201）。 */
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

const IDX = stripComments(read('public/index.html'));
const ADMIN = stripComments(read('public/admin.html'));
const ADMIN_CSS = ADMIN.slice(ADMIN.indexOf('<style>'), ADMIN.indexOf('</style>'));
const DL = require('../fetchers/download');

console.log('\n== A. 本体：XD 盘口不再被 real 过滤掉 ==');
/* A1：判据是「过滤条件里出现了 serverUrl」，不是「没有 filter」 */
ok('A1 xdItems 的过滤条件含 serverUrl（只认 real 会把要登录的盘口整类丢光）',
  /const xdItems = xd \?[\s\S]{0,200}?\.filter\(\(i\) => i\.real \|\| i\.serverUrl\)/.test(IDX));
ok('A2 反向：不再存在「只留 real」的写法',
  !/const xdItems = xd \? \(xd\.d\.items \|\| \[\]\)\.filter\(\(i\) => i\.real\)/.test(IDX));
/* A3：归帖键必须能区分同一游戏的多个盘口 */
ok('A3 归帖键在 real 为空时退到 serverUrl（否则 6 个盘口全并成一行 u:null）',
  /const k = it\.postId \|\| it\.postUrl \|\| \('u:' \+ \(it\.serverUrl \|\| it\.real\)\)/.test(IDX));
ok('A4 links 把 serverUrl / needAuth 一路带到渲染层',
  /g\.links\.push\(\{[\s\S]{0,200}?serverUrl: it\.serverUrl \|\| null/.test(IDX));
/* A5：渲染层 —— 有 serverUrl 就必须是 <a>，且标「登录」 */
ok('A5 没有直链但有盘口页时渲染成可点链接（不是不可点的灰字）',
  /if \(l\.serverUrl\) \{[\s\S]{0,400}?'<a class="lk bd-' \+ b\.cls \+ ' need" href="' \+ esc\(l\.serverUrl\)/.test(IDX));
ok('A6 「要登录」有可见标记（.lk-need 角标 + 虚线内圈），不是靠 title 暗示',
  /\.dl-it \.lk\.need\{/.test(IDX) && /\.dl-it \.lk \.lk-need\{/.test(IDX));
/* A7：跨源补齐 —— 只在缺机地那一路时补，且失败静默 */
ok('A7 缺 jidiUrl 时用 /api/library/twin 现查补齐（库里只合并过一部分）',
  /if \(!ctx\.jidi && \/xdgame\\\.com\/i\.test[\s\S]{0,700}?\/api\/library\/twin\?/.test(IDX));
/* ★ 注意：IDX 是**剥过注释**的，所以 catch 体里的说明文字已经没了 ——
   判据只能是「catch 块里没有 throw / 没有把异常再往外抛」，不能去找那句中文。 */
ok('A8 补齐失败必须静默（catch 体内不抛不吞成假数据，XD 那一路照常）',
  /\/api\/library\/twin\?' \+ qs\.toString\(\)\)[\s\S]{0,500}?catch \(e\) \{\s*\}/.test(IDX));
ok('A9 统计口径区分「直链」与「盘口页」（不再一律说「均为源站实时解析」）',
  /const nNeed = v\.items\.filter\(\(x\) => !x\.real && x\.serverUrl\)\.length/.test(IDX));

console.log('\n== A2. 服务端契约（不靠页面文本猜） ==');
/* 真函数的纯解析部分：XD 详情页 HTML ⇒ 每条都必须带 serverUrl 且 real=null */
const xdHtml = '<div class="article-down">'
  + '<a class="downbtn" data-url="/plus/download.php?open=2&id=1&uhash=a" data-server="百度网盘">百度网盘</a>'
  + '<a class="downbtn" data-url="/plus/download.php?open=2&id=1&uhash=b" data-server="迅雷网盘">迅雷网盘</a>'
  + '</div>';
const parsed = DL.parseXdDown(xdHtml, 'https://www.xdgame.com');
ok('A10 parseXdDown 解析出 2 个盘口', parsed.items.length === 2, String(parsed.items.length));
ok('A11 每个盘口都有可点的 serverUrl（这是「要登录也能给出口」的前提）',
  parsed.items.every((x) => /^https:\/\/www\.xdgame\.com\/plus\/download\.php/.test(String(x.serverUrl))));
ok('A12 解析阶段 real 一律为 null（真值要跟随 302 才拿得到，不是这里编的）',
  parsed.items.every((x) => x.real === null));

console.log('\n== B. 后台：页面管理并入游戏库 ==');
const NAV = ADMIN.slice(ADMIN.indexOf('<nav class="nav"'), ADMIN.indexOf('</nav>'));
ok('B1 侧栏不再有「页面管理」', !/data-v="pages"/.test(NAV));
ok('B2 DOM 里也没有 view-pages（只删菜单不删页面 = 留一个 hash 能进的死页）',
  !/id="view-pages"/.test(ADMIN));
ok('B3 游戏库的 10 列齐全', /封面[\s\S]{0,60}游戏名[\s\S]{0,80}游戏ID[\s\S]{0,80}平台[\s\S]{0,80}评分[\s\S]{0,80}更新[\s\S]{0,80}资料[\s\S]{0,80}状态[\s\S]{0,80}备注[\s\S]{0,60}操作/.test(ADMIN));
ok('B4 「同款合并」是页内开关且默认开（不是两个菜单）',
  /let groupSame = true/.test(ADMIN) && /if \(groupSame\) p\.set\('group', '1'\)/.test(ADMIN));
ok('B5 关掉开关后确实换了请求（不是只换个视觉）',
  /function toggleGroup\(\) \{ groupSame = !groupSame;[\s\S]{0,200}?reload\(\); \}/.test(ADMIN));
ok('B6 两种形态在弹窗内可切（pfSetMode 存在且页签有 pages）',
  /function pfSetMode\(mode\)/.test(ADMIN) && /data-m="pages" onclick="pfSetMode\('pages'\)"/.test(ADMIN));
ok('B7 行尾只留一个「编辑」（两个按钮在 1440 宽下竖排，行高被撑开）',
  !/>资料<\/button>'/.test(ADMIN));
/* 负向断言：不许留下指向已删除函数的调用（这类残留只会在点下去那一刻才炸） */
ok('B8 没有指向已删函数的残留调用（pagesReload / pqs）',
  !/pagesReload\(/.test(ADMIN) && !/\bpqs\(/.test(ADMIN));
ok('B9 没有指向已删 DOM 的残留（pRows / pPgBar / nPages）',
  !/pRows|pPgBar|nPages/.test(ADMIN));
ok('B10 主按钮与页码的实底仍然是深一档陶土色（#e79379 配白字只有 2.6:1）',
  /--acc:#bf6a50|--acc: #bf6a50/.test(ADMIN_CSS));

console.log('\n== C. 文档与登记 ==');
const D106 = read('docs/versions/v10.106.md');
ok('C1 有本版说明 docs/versions/v10.106.md', D106.length > 500, D106.length + 'B');
ok('C2 说明里写清了「页面管理已并入游戏库」与判定口径', /并入/.test(D106) && /group/.test(D106));
ok('C3 版本索引登记了 v10.106', /v10\.106/.test(read('docs/versions/README.md')));
ok('C4 本套件已登记 run-all', /test-v10106-body-and-merge\.js/.test(read('tools/run-all.js')));

const bad = results.filter((r) => !r[0]);
results.forEach((r) => console.log((r[0] ? '  PASS  ' : '  ❌ FAIL  ') + r[1] + (r[2] ? '  → ' + r[2] : '')));
console.log('\n' + '='.repeat(68));
console.log('结果：' + (results.length - bad.length) + ' / ' + results.length + ' 通过');
if (bad.length) console.log('失败项：\n' + bad.map((r) => '  · ' + r[1]).join('\n'));
/* ★ 退出码必须无条件给：只在失败时 exit(1)，成功路径会自然退出成 0 之外的码，
   run-all 就无法「单独跑也红绿分明」，反证也验不了（v10.105 的同款返工）。 */
process.exit(bad.length ? 1 : 0);
