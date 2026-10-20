#!/usr/bin/env node
/**
 * test-v1090-admin-console.js — v10.90「后台重排 + 资料覆盖层」
 *
 * 用户口径（2026-10-20）：
 *   ① 「已填写令牌不能查看」            → 令牌回填 / 👁 明文 / 保存即校验 / 403 横幅
 *   ② 「页面管理…弹窗编辑爬取的内容，显示游戏名+游戏ID+平台+热度，按钮查看，
 *       显示游戏图片，固定每一行的高度，页面跳转可以填写跳转以及附近页面跳转」
 *   ③ 「游戏库是管理游戏资料」          → 简介/类型/厂商/发行/发售日/别名
 *   ④ 「模块类型分为本体/MOD/修改器/存档，fitgirl 和 thunderstore 并到对应模块」
 *   ⑤ 「资源覆盖要分类查看」            → 四模块卡 + 缺口清单
 *   ⑥ 「仪表盘用于爬虫可视化，分模块查看」
 *
 * ★ 本套件守的是「改完之后仍然成立的不变量」，不是「有没有这段代码」：
 *   · 覆盖层**只影响输出**：apply 必须发生在 resFor / withBh **之后**
 *     （提前叠会让「改标题」打断资源匹配，且不报错）；
 *   · 写接口只收白名单字段（不能变成改库结构的后门）；
 *   · 空值 = 删除覆盖（回到爬虫值），不是存空串；
 *   · 角标与列表同一个口径（否则两个数字互相打脸）。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SERVER = read('server.js');
const ADMIN = read('public/admin.html');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  — ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  × FAIL  ' + name + (extra ? '  — ' + extra : '')); }
}
/** 取某段源码：从 start 到下一个 `app.get(`/`app.post(` 起始处（不能固定字符窗口，会切进下一个端点） */
function sliceEndpoint(src, needle) {
  const i = src.indexOf(needle);
  if (i < 0) return '';
  const n = src.indexOf('\napp.', i + needle.length);
  return src.slice(i, n > i ? n : i + 4000);
}

/* ═════════ A. 服务端：三个新端点 + 覆盖层位置 ═════════ */
console.log('\n-- A. 服务端接线 --');
const verifyBody = sliceEndpoint(SERVER, "app.get('/api/admin/verify'");
ok(!!verifyBody, 'A1 /api/admin/verify 端点在位（保存令牌时当场校验）');
ok(/if \(!adminGuard\(req, res\)\) return;/.test(verifyBody),
  'A2 verify 自己 guarded（否则「有没有令牌」都 200，探针失去意义）');

const profGet = sliceEndpoint(SERVER, "app.get('/api/admin/profile'");
const profPost = sliceEndpoint(SERVER, "app.post('/api/admin/profile'");
ok(!!profGet && !!profPost, 'A3 /api/admin/profile 读写两端都在位');
ok(/adminGuard/.test(profGet) && /adminGuard/.test(profPost), 'A4 profile 读写都过 adminGuard');
ok(/raw:/.test(profGet) && /effective:/.test(profGet),
  'A5 GET 同时给 raw 与 effective（管理页要能显示「原值是什么」，否则无法回滚）');
ok(/state:/.test(profGet), 'A6 GET 带 state（列表状态 / 备注用真值回填，不靠前端猜）');
ok(/FIELDS\.includes\(k\)/.test(profPost) && /dropped/.test(profPost),
  'A7 POST 只收白名单字段（传别的当没传，不让写接口变成改库结构的后门）');
ok(/gameProfile\.set\(id, clean\)/.test(profPost), 'A8 POST 走 gameProfile.set（逐字段归一）');

const covBody = sliceEndpoint(SERVER, "app.get('/api/admin/coverage'");
ok(!!covBody, 'A9 /api/admin/coverage 端点在位');
ok(/if \(!adminGuard\(req, res\)\) return;/.test(covBody), 'A10 coverage 走 adminGuard');
ok(/module 只支持/.test(covBody), 'A11 非法 module 明确 400（不静默返回空卡）');
const COV = SERVER.slice(SERVER.indexOf('const COVERAGE_MODULES'), SERVER.indexOf('};', SERVER.indexOf('const COVERAGE_MODULES')));
['base', 'mod', 'trainer', 'save'].forEach((k) => {
  ok(new RegExp('\\n  ' + k + ': \\{').test(COV), 'A12 覆盖口径含模块 ' + k);
});
ok(/fitgirl/.test(COV.match(/\n  base:[^\n]*/)[0]), 'A13 本体只收 FitGirl（并进对应模块）');
const covModLine = COV.match(/\n  mod: \{[^\n]*/)[0];
ok(/'mod'/.test(covModLine) && /'ts'/.test(covModLine), 'A14 MOD = 机地 MOD 帖 + Thunderstore');

/* 覆盖层**位置**：必须在资源归属算完之后才叠 */
const withResIdx = SERVER.indexOf('function withRes(g)');
const withResBody = SERVER.slice(withResIdx, withResIdx + 1200);
const resForPos = withResBody.indexOf('resFor(g)');
const applyPos = withResBody.indexOf('gameProfile.apply(o)');
ok(resForPos > 0 && applyPos > resForPos,
  'A15 覆盖层在 resFor 之后才叠（提前叠会让改标题打断资源匹配，且不报错）',
  'resFor@' + resForPos + ' apply@' + applyPos);

/* browse 的 q：参数被静默忽略过，必须真的接上 */
const browseIdx = SERVER.indexOf("app.get('/api/library/browse'");
const browseBody = SERVER.slice(browseIdx, SERVER.indexOf("if (scope === 'pc')", browseIdx));
ok(/req\.query\.q/.test(browseBody), 'A16 browse 接住 q 参数（v10.89 之前一直被静默忽略）');
ok(/gamesDb\.search\(qq, 5000\)\.items/.test(browseBody),
  'A17 q 复用 gamesDb.search 的归一化（且按返回对象取 .items —— 铁律 148）');
ok(/const prev = o\.filter/.test(browseBody) && /!prev \|\| prev\(g\)/.test(browseBody),
  'A18 q 与既有筛选叠加而不是覆盖（覆盖会让「只看有备注」等条件静默失效）');

/* 角标口径 */
const ovBody = sliceEndpoint(SERVER, "app.get('/api/admin/overview'");
ok(/profile: gameProfile\.stats\(\)/.test(ovBody), 'A19 overview 带资料覆盖规模');
ok(/save: sv\.total \|\| 0/.test(ovBody),
  'A20 左栏「存档」角标用 sv.total（与列表 total 同口径；用 inPcLib 会差 298 条）');

/* 覆盖层模块本身 */
const profMod = require(path.join(ROOT, 'data', 'game-profile.js'));
ok(Array.isArray(profMod.FIELDS) && profMod.FIELDS.length === 10, 'A21 覆盖字段恰好 10 个', profMod.FIELDS.join('/'));
ok(!/'id'|'source'|'publishTs'/.test(JSON.stringify(profMod.FIELDS)),
  'A22 白名单不含 id / source / publishTs（改了会让一切引用失准）');
const profSrc = read('data/game-profile.js');
ok(/renameSync/.test(profSrc), 'A23 落盘用 tmp+rename（半截文件会让整个文件读失败）');
ok(/if \(v === undefined\) \{ if \(f in cur\) \{ delete cur\[f\]/.test(profSrc),
  'A24 空值 = 删除该字段的覆盖（回到爬虫值），不是存空串');
ok(/function apply\(game\)[\s\S]{0,200}if \(!p\) return game;/.test(profSrc),
  'A25 无覆盖时原样返回同一对象（列表 50 行不白造副本）');

/* 真实数据侧：四个模块的命中集合都得建得起来 */
const fitgirl = require(path.join(ROOT, 'data', 'fitgirl.js'));
const tsmods = require(path.join(ROOT, 'data', 'tsmods.js'));
const gamesDb = require(path.join(ROOT, 'data', 'gamesDb.js'));
gamesDb.load && gamesDb.load();
ok(Object.keys(fitgirl.RAW.byGame || {}).length > 1000, 'A26 FitGirl 按库 id 索引且规模真实',
  Object.keys(fitgirl.RAW.byGame).length + ' 款');
ok((tsmods.RAW.games || []).every((g) => g.libId), 'A27 Thunderstore 每个社区都带 libId');
ok(gamesDb.all().length > 19000, 'A28 端游库全量可用（覆盖分母）', gamesDb.all().length + ' 款');

/* ═════════ B. 前端：页面管理 / 游戏库 / 令牌 ═════════ */
console.log('\n-- B. 前台三块 --');
const NAV = ADMIN.slice(ADMIN.indexOf('<nav class="nav"'), ADMIN.indexOf('</nav>'));
const navOrder = [...NAV.matchAll(/data-v="([^"]+)"/g)].map((m) => m[1]);
ok(JSON.stringify(navOrder) === JSON.stringify(['dash', 'pages', 'games', 'm-base', 'm-mod', 'm-trainer', 'm-save', 'res', 'log', 'set']),
  'B1 侧栏顺序：仪表盘 / 页面管理 / 游戏库 / 四模块 / 运维', navOrder.join(','));

ok(/id="view-pages"/.test(ADMIN), 'B2 页面管理有独立 section');
const pageThead = ADMIN.slice(ADMIN.indexOf('id="view-pages"'), ADMIN.indexOf('</thead>', ADMIN.indexOf('id="view-pages"')));
const pageCols = [...pageThead.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1].trim());
ok(pageCols[0] === '封面' && pageCols[1] === '游戏名' && pageCols[2] === '游戏ID'
  && pageCols[3] === '平台' && pageCols[4] === '热度',
  'B3 页面管理列 = 封面 / 游戏名 / 游戏ID / 平台 / 热度 / …', pageCols.join('|'));
ok(/\.fxrow td\{height:56px/.test(ADMIN), 'B4 固定行高 56px（height 才会真的等高，min-height 会被长标题撑开）');
ok(/\.fxrow \.cv\{width:42px;height:42px/.test(ADMIN), 'B5 行内封面 42×42');
ok(/<img class="cv" loading="lazy" src="' \+ esc\(g\.cover\)/.test(ADMIN), 'B6 页面管理真的渲染封面图（不是占位方块）');
ok(/onclick="openProf\(' \+ i \+ ',\\'pages\\',event\)">查看</.test(ADMIN),
  'B7 「查看」= 编辑（打开资料弹窗的爬虫字段形态）');

ok(/function pagerHtml\(total, limit, off\)/.test(ADMIN), 'B8 分页条只有一个实现');
ok(/data-pgjump/.test(ADMIN) && /data-pgok/.test(ADMIN), 'B9 分页条支持「填页码跳转」');
ok(/for \(let d = -2; d <= 2; d\+\+\)/.test(ADMIN), 'B10 分页条有附近页（±2）');
ok(/if \(e\.key === 'Enter'\) jump\(\)/.test(ADMIN), 'B11 跳页输入框回车即跳');
ok(/bindPager\(\$\('pPgBar'\)/.test(ADMIN) && /bindPager\(\$\('gPgBar'\)/.test(ADMIN) && /bindPager\(\$\('rmPgBar'\)/.test(ADMIN),
  'B12 三张表都接了分页条（页面管理 / 游戏库 / 模块）');

ok(/p\.set\('admin', '1'\); p\.set\('cold', '0'\);/.test(ADMIN), 'B13 页面管理走 admin=1&cold=0（冷门也要看得见）');
ok(/function pqs\(\)/.test(ADMIN) && /function qs\(\)/.test(ADMIN), 'B14 两个页面各有自己的查询串（筛选条件不同）');

ok(/id="view-games"/.test(ADMIN) && /资料<\/th>/.test(ADMIN), 'B15 游戏库有「资料」列（完整度）');
ok(/comp \+ '\/7/.test(ADMIN), 'B16 资料完整度按 7 项计');
ok(/openProf\(' \+ i \+ ',\\'games\\',event\)">资料</.test(ADMIN), 'B17 游戏库「资料」按钮开资料弹窗');

ok(/const PF_IDS = \{ title:[\s\S]{0,400}aliases: 'pfAliasIn' \};/.test(ADMIN), 'B18 资料弹窗 10 个字段齐全');
ok(/function pfShowGroups\(mode\)/.test(ADMIN) && /show\(\['pfCrawl'\], mode === 'pages'\)/.test(ADMIN),
  'B19 两种形态：页面管理只露爬虫字段，游戏库只露资料字段');
ok(/'爬取值：' \+ \(brief\(raw\[f\]\)/.test(ADMIN),
  'B20 输入框留空 = 用爬取值（爬取值放 placeholder，不预填成人工值）');
ok(/el\.placeholder = has \? '' : \('爬取值：'/.test(ADMIN),
  'B21 已覆盖的字段不再回显爬取值（避免"看起来没改过"）');

ok(/const TKEY = 'gh_admin_token'/.test(ADMIN), 'B22 令牌键名集中一处');
ok(/\$\('tkInput'\)\.value = tok\(\);/.test(ADMIN), 'B23 保存后回填令牌（原来立刻清空，原文再也看不到）');
ok(/function toggleTk\(\)/.test(ADMIN) && /id="tkEye"/.test(ADMIN), 'B24 👁 可切明文查看已填令牌');
ok(/api\('\/api\/admin\/verify'\)/.test(ADMIN), 'B25 保存令牌时当场校验有效/无效');
ok(/showAuth\(/.test(ADMIN) && /id="authBar"/.test(ADMIN), 'B26 403 在内容区挂横幅（不再只给一张空表）');
ok(/showAuth\(t\s*\?/.test(ADMIN), 'B27 横幅区分「没填令牌」与「令牌不被接受」');

/* 仪表盘 / 资源覆盖 */
ok(/id="dashChips"/.test(ADMIN) && /id="dashMods"/.test(ADMIN), 'B28 仪表盘有模块 chip + 模块卡');
ok(/function paintDashMods\(\)/.test(ADMIN) && /coverage\?module=/.test(ADMIN),
  'B29 模块卡数据来自 /api/admin/coverage（不另造端点）');
ok(/id="resChips"/.test(ADMIN) && /id="resCards"/.test(ADMIN), 'B30 资源覆盖按模块分类（chip + 卡片）');
ok(/class="miss-item"/.test(ADMIN), 'B31 资源覆盖给出缺口清单（能直接安排抓取工作）');
ok(/function resPick\(k\)/.test(ADMIN), 'B32 可只看某一个模块');
ok(/if \(!VIEWS\[v\]\) v = 'dash';/.test(ADMIN),
  'B33 旧 hash（#rm-mod 等）回落仪表盘（否则切过去整页空白）');

/* ═════════ C. HTTP 实测（本机 8124；回环免令牌） ═════════ */
(async () => {
  console.log('\n-- C. 接口实测 --');
  const BASE = process.env.BASE || 'http://127.0.0.1:8124';
  const get = async (p) => {
    try { const r = await fetch(BASE + p); return { status: r.status, j: await r.json().catch(() => null) }; }
    catch (e) { return { status: 0, j: null, err: String(e.message || e) }; }
  };
  const post = async (p, body) => {
    try {
      const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { status: r.status, j: await r.json().catch(() => null) };
    } catch (e) { return { status: 0, j: null, err: String(e.message || e) }; }
  };

  const v = await get('/api/admin/verify');
  ok(v.status === 200 && v.j && v.j.ok && v.j.via === 'loopback', 'C1 verify 回环直通', JSON.stringify(v.j));

  const all = gamesDb.all().length;
  const cb = await get('/api/admin/coverage?module=base&limit=5');
  ok(cb.status === 200 && cb.j.ok, 'C2 coverage base 可用');
  ok(cb.j.total === all, 'C3 分母 = 端游库全量', cb.j.total + ' vs ' + all);
  ok(Math.abs(cb.j.rate - Math.round((cb.j.covered / cb.j.total) * 1000) / 10) < 0.01,
    'C4 rate = covered / total（现算，不是写死）', cb.j.rate + '%');
  const hots = (cb.j.missing || []).map((x) => x.hot);
  ok(hots.every((h, i) => i === 0 || hots[i - 1] >= h), 'C5 缺口按热度降序（先看热门的缺口）');

  const cm = await get('/api/admin/coverage?module=mod&limit=1');
  ok(cm.j.sources.length === 2 && cm.j.sources.map((s) => s.key).join(',') === 'mod,ts',
    'C6 MOD 模块两个子源（机地帖 / Thunderstore）', cm.j.sources.map((s) => s.key).join(','));
  const ct = await get('/api/admin/coverage?module=trainer&limit=1');
  ok(ct.j.sources.length === 3, 'C7 修改器模块三个子源（CE / 机地帖 / GTrainers）');

  const bad = await get('/api/admin/coverage?module=nope');
  ok(bad.status === 400, 'C8 非法 module 返回 400（不静默给空卡）');

  const TID = 'xd-8149';
  const before = await get('/api/admin/profile?id=' + TID);
  ok(before.status === 200 && before.j.ok && 'raw' in before.j && 'effective' in before.j,
    'C9 profile GET 返回 raw / effective / state');

  const wr = await post('/api/admin/profile', { id: TID, patch: { intro: '单测简介', developer: '单测厂商', hot: 42, bogus: 'x' } });
  ok(wr.status === 200 && wr.j.ok && wr.j.touched >= 1, 'C10 profile POST 写入成功', 'touched=' + (wr.j && wr.j.touched));
  ok(wr.j.dropped && wr.j.dropped.includes('bogus'), 'C11 白名单外字段被丢弃并回报（dropped）');

  const after = await get('/api/admin/profile?id=' + TID);
  ok(after.j.effective.hot === 42 && after.j.effective.intro === '单测简介', 'C12 写入后 effective 立刻生效');
  ok(['clear', 'show', 'hide'].includes(after.j.state.override), 'C13 state.override 是三种合法态之一',
    after.j.state.override);

  /* 列表层也要看到覆盖（覆盖层只影响输出，这里是输出点） */
  const q = await get('/api/library/browse?scope=pc&admin=1&cold=0&limit=1&q=' + encodeURIComponent('玩偶冒名者'));
  ok(q.j.total > 0 && q.j.items[0].hot === 42, 'C14 列表行用的是覆盖后的值', 'hot=' + (q.j.items[0] || {}).hot);

  /* 清理：空值 = 删掉覆盖 */
  await post('/api/admin/profile', { id: TID, patch: { intro: '', developer: '', hot: '' } });
  const reset = await get('/api/admin/profile?id=' + TID);
  ok(reset.j.profile === null, 'C15 空值提交后覆盖被删除（回到爬虫值）');

  /* q 真的生效（v10.89 之前被静默忽略） */
  const noQ = await get('/api/library/browse?scope=pc&admin=1&cold=0&limit=1');
  const withQ = await get('/api/library/browse?scope=pc&admin=1&cold=0&limit=1&q=' + encodeURIComponent('Doll'));
  ok(withQ.j.total > 0 && withQ.j.total < noQ.j.total, 'C16 browse 的 q 参数生效（命中数小于全量）',
    withQ.j.total + ' < ' + noQ.j.total);

  console.log('\n====');
  console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  if (fail) console.log('失败项：\n  - ' + fails.join('\n  - '));
  /* ★ 退出码与失败数绑定（run-all 的 exitTiedToFailures 只认这个形态） */
  process.exit(fail ? 1 : 0);
})();
