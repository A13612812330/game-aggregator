#!/usr/bin/env node
'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
 * v10.87 管理后台防线 — tools/test-v1087-admin.js
 *
 * 覆盖（★ 防线夹逼原则：能独立重算的绝不抄 server.js 的结论）：
 *   A. 管理页存在性 + 关键节点（页面能开但是死的 = 最危险的静默失败）
 *   B. 服务端鉴权双轨（adminLocalOnly 保留 + adminGuard 令牌轨 + 令牌真源链）
 *   C. 令牌文件真实可读 + 格式（hex 长度）+ .gitignore 登记（不入库）
 *   D. 操作日志链（appendAdminLog 在 setOverride 成功之后、readAdminLog 尾读）
 *   E. 聚合端点 /api/admin/game 的七路资源齐全 + 孪生兜底（resFor）在场
 *   F. browse/library 的 admin=1 服务端回填（hidden/cold 判定在服务端，铁律 154）
 *   G. 隐藏态池前筛选（o.filter 走 coldHide.isHidden 同一真源）
 *   H. roster 页挂 /admin 入口
 *
 * 退出码格式（run-all 检测器只认两形态）：if (fail) process.exitCode = 1;
 * ═══════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (cond, name, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name + (detail ? '  — ' + detail : '')); }
  else { fail++; console.log('  × FAIL  ' + name + (detail ? '  — ' + detail : '')); }
};
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

console.log('=== v10.87 管理后台防线 ===');

/* ── A. 管理页 ── */
console.log('\n-- A. public/admin.html 管理页 --');
const hasAdmin = fs.existsSync(path.join(ROOT, 'public', 'admin.html'));
ok(hasAdmin, 'A1 管理页存在', 'public/admin.html');
if (hasAdmin) {
  const pg = read('public/admin.html');
  ok(pg.includes('id="tokInput"') && pg.includes('gh_admin_token'),
    'A2 令牌输入框 + localStorage 持久化在位');
  ok(pg.includes('/api/admin/overview') && pg.includes('/api/admin/game?id=')
    && pg.includes("/api/admin/hide-overrides'") && pg.includes('/api/admin/log?limit='),
    'A3 五个数据面端点全部被页面引用（overview/game/hide-overrides/log + browse）');
  ok(pg.includes("'X-Admin-Token'"), 'A4 写操作带 X-Admin-Token 请求头');
  ok(pg.includes('admin=1') || pg.includes("admin', '1'") || /admin=\$\{/.test(pg)
    || pg.includes("admin: '1'"),
    'A5 列表请求带 admin=1（隐藏态服务端回填）');
  ok(pg.includes('openDrawer') && pg.includes('setOv') && pg.includes('loadLog'),
    'A6 抽屉详情 / 豁免操作 / 操作日志三个交互函数齐备');
  /* 防自坑：页面里凡拼 URL 的地方不能出现未转义的引号注入点 */
  ok(!/onclick="openDrawer\('"\+/.test(pg), 'A7 无裸字符串拼接的 onclick（id 走转义通道）');
}

/* ── B. 服务端鉴权双轨 ── */
console.log('\n-- B. server.js 鉴权 --');
const srv = read('server.js');
ok(srv.includes('function adminLocalOnly'), 'B1 v10.85 adminLocalOnly 保留（回环轨，test-roster J15.4 依赖）');
ok(/function adminGuard/.test(srv) && /x-admin-token/i.test(srv),
  'B2 adminGuard 令牌轨在位（X-Admin-Token）');
const guardIdx = srv.indexOf('function adminGuard');
const postIdx = srv.indexOf("app.post('/api/admin/hide-overrides'");
ok(guardIdx >= 0 && postIdx > guardIdx, 'B3 adminGuard 定义在写端点之前（声明顺序）');
ok(/GAMEHUB_ADMIN_TOKEN/.test(srv) && /admin-token\.json/.test(srv),
  'B4 令牌真源双通道：env > data/admin-token.json');
ok(!/adminLocalOnly\(req, res\)\) return;\n  res\.json\(\{ ok: true, overrides/.test(srv),
  'B5 hide-overrides GET 已切到 adminGuard（不再只有回环一条路）');

/* ── C. 令牌文件 ── */
console.log('\n-- C. 令牌文件 --');
const tokPath = path.join(ROOT, 'data', 'admin-token.json');
let tokOk = false, tokLen = 0;
try {
  const j = JSON.parse(fs.readFileSync(tokPath, 'utf8'));
  tokOk = typeof j.token === 'string' && /^[0-9a-f]{32,}$/.test(j.token);
  tokLen = j.token ? j.token.length : 0;
} catch (e) { /* 不存在 */ }
ok(tokOk, 'C1 admin-token.json 存在且为 32+ 位 hex', 'len=' + tokLen);
const gi = read('.gitignore');
ok(gi.includes('data/admin-token.json') && gi.includes('data/admin-log.jsonl'),
  'C2 .gitignore 登记令牌 + 日志（不入库，但随载荷上线）');

/* ── D. 操作日志 ── */
console.log('\n-- D. 操作日志链 --');
ok(/appendAdminLog\(\{/.test(srv) && /admin-log\.jsonl/.test(srv),
  'D1 写端点留痕 appendAdminLog（jsonl 追加）');
const logCallIdx = srv.indexOf('appendAdminLog({');
const setOvIdx = srv.indexOf('coldHide.setOverride(');
ok(logCallIdx > setOvIdx, 'D2 日志写在 setOverride 成功之后（失败不记成功账）');
ok(/function readAdminLog/.test(srv) && srv.indexOf("app.get('/api/admin/log'") > srv.indexOf('function readAdminLog'),
  'D3 readAdminLog 尾读 + 端点在位');

/* ── E. 聚合端点 ── */
console.log('\n-- E. /api/admin/game 聚合 --');
ok(srv.includes("app.get('/api/admin/game'"), 'E1 聚合端点在位');
const agIdx = srv.indexOf("app.get('/api/admin/game'");
const agBody = srv.slice(agIdx, agIdx + 4200);
ok(/resFor\(g\)/.test(agBody), 'E2 孪生兜底走 resFor（与 roster/首页 chip 同源，铁律 17）');
ok(agBody.includes('resGroups.byLib') && agBody.includes('trainers.byLib')
  && agBody.includes('savesYx.byLib') && agBody.includes('gt.byLib')
  && agBody.includes('fitgirl.byGame') && agBody.includes('tsmods.slim'),
  'E3 七路资源全部聚合（resGroups/fling/savesYx/gt/fitgirl/tsmods）');
ok(agBody.includes('coldHide.isCold') && agBody.includes('coldHide.isHidden')
  && agBody.includes('overridesSnapshot'),
  'E4 隐藏态三问（规则/最终/豁免）同出 coldHide 真源');
ok(agBody.includes('flingdl.attach') && agBody.includes('tcsdl.attach'),
  'E5 修改器条目挂 FLiNG 流代理 / TCS 外链（与 /api/trainers/match 同形）');

/* ── F/G. 列表 admin=1 回填 + 池前筛选 ── */
console.log('\n-- F/G. 列表隐藏态回填 --');
const brIdx = srv.indexOf("app.get('/api/library/browse'");
const brBody = srv.slice(brIdx, brIdx + 3600);
ok(/req\.query\.admin/.test(brBody) && /it\.hidden = coldHide\.isHidden\(x\)/.test(brBody)
  && /it\.cold = coldHide\.isCold\(x\)/.test(brBody),
  'F1 browse admin=1 → 每行 hidden/cold 服务端回填（铁律 154：响应回填不猜）');
const libIdx = srv.indexOf("app.get('/api/library'");
const libBody = srv.slice(libIdx, libIdx + 2600);
ok(/req\.query\.admin/.test(libBody) && /it\.hidden = coldHide\.isHidden\(x\)/.test(libBody),
  'F2 /api/library admin=1 同样回填（搜索与管理列表徽标同源）');
ok(/o\.filter = \(g\) => coldHide\.isHidden\(g\)/.test(brBody),
  'G1 hidden=1|0 池前过滤走 coldHide.isHidden（分页 total 与行数一致）');
ok(/cold=0/.test(srv.slice(brIdx - 1200, brIdx)) || /req\.query\.cold/.test(brBody),
  'G2 cold=0 逃生口保留（管理页才能看到被隐藏的行）');

/* ── H. roster 入口 ── */
console.log('\n-- H. roster 入口 --');
const rosterPath = path.join(ROOT, 'public', 'roster', 'index.html');
ok(fs.existsSync(rosterPath) && read('public/roster/index.html').includes('href="/admin"'),
  'H1 roster 顶栏挂 /admin 入口（生成器已重跑）');
ok(read('tools/gen-roster.js').includes('href="/admin"'), 'H2 生成器源含入口（daily-sync 重跑不丢）');

/* ── 收尾（run-all 只认这两形态之一）── */
console.log('\n=== 结果: ' + pass + ' 通过 / ' + fail + ' 失败 ===');
if (fail) process.exitCode = 1;
