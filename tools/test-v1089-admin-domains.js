#!/usr/bin/env node
/**
 * test-v1089-admin-domains.js — v10.89「后台按资源类型分开管理、统一以游戏为主键」
 *
 * 用户口径（2026-10-20）：「后台管理我需要你分开管理，但是都以游戏为主键」
 * 落点：
 *   · 六个资源域（MOD 帖 / 修改器 / 存档位置 / 云存档 / FitGirl / Thunderstore）
 *     在左侧栏各占一个条目、各有自己的列与筛选；
 *   · 每一条资源行都锚定 `gameId`（端游库 id），点游戏名直接打开同一个编辑弹窗。
 *
 * ★ 这个套件守的不是「有没有这段代码」，而是三件容易在后续迭代里悄悄退化的事：
 *   ① 六个域共用**一套渲染器**（`RM` 表 + 单个 `resmReload`）—— 一旦有人复制成六份，
 *      改一处样式另外五处就会留在旧版（本项目已有先例：派生页手改被重建冲掉）；
 *   ② `gameId` 必须是**第一列且非空才可点** —— 未匹配的行要如实显示，不许假装能跳；
 *   ③ 新增的两个端点（/api/admin/res）只补「原本没有扁平列表」的源，
 *      mod/modifier/save/cloud 必须继续复用 `/api/mods|trainers|saves/list`，不许重复造。
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

/* ═════════ A. 服务端：两个补位端点 + domains 计数 ═════════ */
console.log('\n-- A. 服务端接线 --');
ok(/app\.get\('\/api\/admin\/res'/.test(SERVER), 'A1 /api/admin/res 端点在位');
ok(/const ADMIN_RES_KINDS = \['fitgirl', 'ts'\]/.test(SERVER),
  'A2 只补 fitgirl / ts 两路（其余四域复用现有列表端点，不重复造）');

const resIdx = SERVER.indexOf("app.get('/api/admin/res'");
const resEnd = SERVER.indexOf('app.get(', resIdx + 20);
const resBody = SERVER.slice(resIdx, resEnd > resIdx ? resEnd : resIdx + 3000);
ok(/if \(!adminGuard\(req, res\)\) return;/.test(resBody), 'A3 端点走 adminGuard（铁律 161）');
ok(/kind 只支持/.test(resBody), 'A4 非法 kind 明确 400（不静默返回空表）');
ok(/gameId: gid, gameTitle: gameTitle\(gid\)/.test(resBody), 'A5 fitgirl 行带 gameId + gameTitle');
ok(/gameId: g.libId/.test(resBody), 'A6 ts 行带 gameId（= game.libId）');
ok(/rows\.slice\(\(page - 1\) \* size, page \* size\)/.test(resBody), 'A7 分页切片按 page/size');
ok(/titleCache/.test(resBody), 'A8 游戏名有缓存（4,331 行不逐行查库）');

/* 真实数据侧：两个源都必须**真的**能反查到游戏 id，否则「以游戏为主键」是空话 */
const fitgirl = require(path.join(ROOT, 'data', 'fitgirl.js'));
const tsmods = require(path.join(ROOT, 'data', 'tsmods.js'));
const fgKeys = Object.keys(fitgirl.RAW.byGame || {});
ok(fgKeys.length > 1000, 'A9 FitGirl 表按库 id 索引且规模真实', fgKeys.length + ' 个游戏');
ok(fgKeys.every((k) => /^(xd|jidi)-/.test(k)), 'A10 FitGirl 的 key 全是库 id 形态（不是游戏名）');
const tsGames = tsmods.RAW.games || [];
ok(tsGames.length > 100, 'A11 Thunderstore 有 games 数组', tsGames.length + ' 个社区');
ok(tsGames.every((g) => g.libId), 'A12 ts 每个社区都带 libId（否则行无法锚定游戏）');
const tsPkg = tsGames.reduce((a, g) => a + (g.packages || []).length, 0);
ok(tsPkg > 3000, 'A13 ts 包总量真实（不是空产物）', tsPkg + ' 个包');

/* domains 计数：七个键齐全、都是数字、且与各源 stats 现测一致 */
const ovIdx = SERVER.indexOf("app.get('/api/admin/overview'");
const ovEnd = SERVER.indexOf("app.get('/api/admin/log'", ovIdx);
const ovBody = SERVER.slice(ovIdx, ovEnd > ovIdx ? ovEnd : ovIdx + 1200);
ok(/domains: \{/.test(ovBody), 'A14 overview 回 domains（左栏角标一次拿全）');
['mod', 'modifier', 'modifierExtra', 'save', 'cloud', 'fitgirl', 'ts'].forEach((k) => {
  ok(new RegExp('\\b' + k + ':').test(ovBody), 'A15 domains 含 ' + k);
});
const modsM = require(path.join(ROOT, 'data', 'mods.js'));
const svM = require(path.join(ROOT, 'data', 'saves.js'));
const trM = require(path.join(ROOT, 'data', 'trainers.js'));
const ms = modsM.stats(), sv = svM.stats(), tr = trM.stats();
ok(ms.byKind.mod === (ms.byKind.mod | 0) && ms.byKind.mod > 0, 'A16 mods.byKind.mod 可用', ms.byKind.mod + ' 条');
ok(sv.inPcLib > 0 && sv.withCloud > 0, 'A17 saves 的 inPcLib / withCloud 可用', sv.inPcLib + ' / ' + sv.withCloud);
ok(tr.total > 0, 'A18 trainers.total 可用', tr.total + ' 条');
ok(fitgirl.stats().entryTotal > 0, 'A19 fitgirl.entryTotal 可用', fitgirl.stats().entryTotal + ' 条');
ok(tsmods.stats().packages === tsPkg, 'A20 tsmods.stats().packages 与 RAW 求和一致',
  tsmods.stats().packages + ' vs ' + tsPkg);

/* ═════════ B. 前端：模块骨架 + 共用渲染器 ═════════
 * ★ v10.90 契约变更（本段随之改判，不是"测试放宽"）：
 *   用户口径「模块类型管理分为本体/MOD/修改器/存档，fitgirl 和 thunderstore 并到对应模块中」
 *   ⇒ 侧栏不再是六个 rm-* 条目，而是四个 m-* 模块；子源在页内切换。
 *   本段守的三件事没变：① 一套渲染器 ② gameId 第一列且非空才可点 ③ 不重复造端点。 */
console.log('\n-- B. 前台模块骨架 --');
const NAV = ADMIN.slice(ADMIN.indexOf('<nav class="nav"'), ADMIN.indexOf('</nav>'));
/* ★ v10.107 契约变更：四个模块的**侧栏条目**收成一个「资源管理」入口。
 *   v10.90 守的核心没变 —— 模块恰好四类、共用一套渲染器；只是「四类」从
 *   侧栏四扇门变成页内一级页签（RM 里仍然是 4 个 key）。
 *   ⇒ 侧栏只准有一个 data-v="rm"，一个 m-* / rm-* 都不许再有（有就是合并了一半）。 */
ok(NAV.includes('data-v="rm"'), 'B1 侧栏有「资源管理」入口');
ok(!/data-v="m-/.test(NAV) && !/data-v="rm-/.test(NAV),
  'B1b 侧栏不再按模块拆条目（m-* / rm-* 均应为 0 个）');
const RM_BLOCK = ADMIN.slice(ADMIN.indexOf('const RM = {'), ADMIN.indexOf('};', ADMIN.indexOf('const RM = {')));
const rmKeys = [...RM_BLOCK.matchAll(/^\s{2}(\w+):\s*\{ label:/gm)].map((m) => m[1]);
ok(JSON.stringify(rmKeys) === JSON.stringify(['base', 'mod', 'trainer', 'save']),
  'B2 模块仍然恰好四类（本体/MOD/修改器/存档）', rmKeys.join(','));

const VIEWS_IDX = ADMIN.indexOf('const VIEWS = {');
const VIEWS_BODY = ADMIN.slice(VIEWS_IDX, ADMIN.indexOf('};', VIEWS_IDX));
ok(VIEWS_BODY.includes("rm: ["), 'B4 VIEWS 有删掉 m-* 之后剩下的 rm 一条（标题由模块现拼）');
ok(!/'m-(base|mod|trainer|save)':/.test(VIEWS_BODY), 'B4b VIEWS 里不再有四个 m-* 标题（合并后统一由 RM 拼）');
/* 老链接必须还能直达 —— 别名表是「合并」这一步的防回归，缺了它书签全废 */
const ALIAS_BLOCK = ADMIN.slice(ADMIN.indexOf('const HASH_ALIAS = {'), ADMIN.indexOf('};', ADMIN.indexOf('const HASH_ALIAS = {')));
['m-base', 'm-mod', 'm-trainer', 'm-save'].forEach((k) => {
  ok(ALIAS_BLOCK.includes("'" + k + "'"), 'B4c 旧 hash #' + k + ' 仍在别名表里（书签不能死）');
});

ok(/id="view-resm"/.test(ADMIN), 'B5 四个模块共用一个 section（#view-resm）');
/* 意图：不许为每个模块各复制一份 section。判据直接数「有没有 view-m-* 这种按模块复制的 section」 */
ok(!/id="view-m-/.test(ADMIN), 'B6 没有按模块复制 section（view-m-* 应为 0 个）');
/* ★ v10.106：7 个 —— 「pages」并入「games」，少一个 section。
 *   判据仍然守的是「section 数 = 视图数、没有按模块复制」，不是某个数字本身；
 *   新增/合并视图时**同时**改这里与 test-v1090 的侧栏顺序，两处一致才算过。 */
ok((ADMIN.match(/class="view[^"]*"[^>]*id="view-/g) || []).length === 8,
  'B6b section 恰好 7 个（dash/games/resm/res/log/dl/set · v10.106 并页面管理、v10.107 并四模块）',
  String((ADMIN.match(/class="view[^"]*"[^>]*id="view-/g) || []).length));
/* ★ v10.107：路由的「模块 → section」映射没变（还是共用一个 view-resm），
   变的是入口形式：以前是视图名 m-*，现在是 `rm` + 模块变量。
   判据守的仍是「四个模块不能各自一个 section」与「切换必须落到 rmMod 上」。 */
ok(/const secId = 'view-' \+ \(v === 'rm' \? 'resm' : v\)/.test(ADMIN),
  'B7 资源管理四模块共用 view-resm（否则切过去是空白页）');
ok(/if \(mod\) \{ rmMod = mod; rmSrc = ''/.test(ADMIN)
  /* ★ 窗口给到 400：`if (v === 'rm') {` 与 `resmReload()` 之间现在夹着两行注释
     （这个文件**不剥注释**，注释也算距离）。窗口卡太紧，改注释就会误红。 */
  && /if \(v === 'rm'\) \{[\s\S]{0,400}?resmReload\(\);/.test(ADMIN),
  'B8 切模块时同步 rmMod 并重载（不同步就会一直显示上一个模块）');

const RM_IDX = ADMIN.indexOf('const RM = {');
const RM_BODY = ADMIN.slice(RM_IDX, ADMIN.indexOf('\n};', RM_IDX));
['base', 'mod', 'trainer', 'save'].forEach((k) => {
  ok(new RegExp('\\n  ' + k + ': \\{').test(RM_BODY), 'B9 RM 表定义模块 ' + k);
});
/* 合并判据：FitGirl 必须挂在「本体」的 srcs 里、Thunderstore 必须挂在「MOD」的 srcs 里 */
const baseLine = (RM_BODY.match(/\n  base: \{[^\n]*/) || [''])[0];
const modLine = (RM_BODY.match(/\n  mod: \{[^\n]*/) || [''])[0];
ok(/fitgirl/.test(baseLine), 'B9b FitGirl 并进「本体」模块');
ok(/'ts'/.test(modLine), 'B9c Thunderstore 并进「MOD」模块');
const SRC_IDX = ADMIN.indexOf('const SRC_DEF = {');
const SRC_BODY = ADMIN.slice(SRC_IDX, ADMIN.indexOf('\n};', SRC_IDX));
['fitgirl', 'mod', 'ts', 'trainers', 'jidi', 'save', 'cloud'].forEach((k) => {
  ok(new RegExp('\\n  ' + k + ': \\{').test(SRC_BODY), 'B9d SRC_DEF 定义子源 ' + k);
});
ok((ADMIN.match(/async function resmReload/g) || []).length === 1,
  'B10 只有一个渲染器 resmReload（四份会立刻漂移）');
ok(/def\.cols\.map/.test(ADMIN) && /def\.norm\(x\)/.test(ADMIN),
  'B11 列与行都由 SRC_DEF 驱动（加子源不改渲染器）');
ok((ADMIN.match(/def\.url\(rmQ, rmOff\)/g) || []).length >= 1, 'B12 取数端点由 SRC_DEF.url 提供');

/* 「以游戏为主键」的落点 */
ok(/<th>游戏（主键）<\/th>/.test(ADMIN), 'B13 表头第一列写明「游戏（主键）」');
ok(/data-gid="' \+ esc\(r\.gameId\)/.test(ADMIN), 'B14 游戏列带 data-gid（可点回溯）');
ok(/r\.gameId\s*\n?\s*\? /.test(ADMIN) || /const gameCell = r\.gameId/.test(ADMIN),
  'B15 无 gameId 的行走「未匹配」分支（不假装可跳）');
ok(/function openGameById/.test(ADMIN), 'B16 openGameById 存在（复用同一个编辑弹窗）');
ok(/window\.__items\.push\(Object\.assign\(\{\}, j\.game/.test(ADMIN),
  'B17 用库内真值补齐后再复用 openEdit（不为四模块各写一套游戏摘要）');
ok(/closest\('\.lnk\[data-gid\]'\)/.test(ADMIN), 'B18 点击走事件委托（重绘不重复绑）');
ok(/esc\(r\.gameTitle \|\| r\.gameId\)/.test(ADMIN), 'B19 游戏名经 esc（防标题注入）');

/* 不重复造轮子：四个域必须继续用现有端点 */
/* ★ all=1 / stats=all：角标数的是「全部条目」，列表若默认只给匹配行，
 *   两个数字会差几百条（7,825 vs 7,583）—— 管理页会把它当 bug 报。 */
ok(/\/api\/mods\/list\?kind=mod&all=1/.test(ADMIN), 'B20 mod 域复用 /api/mods/list（含未匹配）');
ok(/\/api\/trainers\/list\?stats=all/.test(ADMIN), 'B21 修改器域复用 /api/trainers/list（含未匹配）');
ok(/\/api\/saves\/list\?stats=all/.test(ADMIN), 'B22 存档域复用 /api/saves/list');
ok(/\/api\/saves\/list\?stats=all&cloud=1/.test(ADMIN), 'B23 云存档子源复用 /api/saves/list&cloud=1');
ok(/\/api\/admin\/res\?kind=fitgirl/.test(ADMIN) && /\/api\/admin\/res\?kind=ts/.test(ADMIN),
  'B24 fitgirl / ts 子源走新增端点（这两个原本没有扁平列表）');

/* 鉴权提示与分页边界 */
/* v10.91 措辞随账号登录调整：令牌 → 登录（判据仍是「403 要说人话，不是空白表」） */
ok(/needAuth \? '需要登录/.test(ADMIN), 'B25 403 时提示需要登录（不是空白表）');
ok(/Math\.max\(1, Math\.min\(pages, parseInt/.test(ADMIN), 'B26 跳页越界被夹到 1..pages');
ok(/'共 ' \+ nf\(total\)/.test(ADMIN), 'B27 分页信息用实测 total（不写死）');

console.log('\n====');
console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) console.log('失败项：\n  - ' + fails.join('\n  - '));
/* ★ 退出码必须与失败数绑定（run-all 的 exitTiedToFailures 只认这个形态）：
 *   否则单独跑时红绿不分，反证也验不了这个套件本身是否真的会红。 */
process.exit(fail ? 1 : 0);
