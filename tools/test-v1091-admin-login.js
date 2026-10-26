#!/usr/bin/env node
/**
 * test-v1091-admin-login.js — v10.91「管理员账号（用户名 + 密码）」
 *
 * 用户口径（2026-10-20）：「为什么要令牌，不如直接给我一个管理员账号，
 *   设置成 liyou，密码为 ******」。
 *
 * 本套件守的不变量（不是"有没有这段代码"）：
 *   ① **口令只在服务端比对**——public/ 里不许出现任何明文口令常量。
 *      前端硬编码对比等于把密码公开（View Source 就有），比令牌更糟。
 *   ② 落盘只存派生值：scrypt + 随机 salt，且文件不入库。
 *   ③ 会话是**随机串**，服务端内存保管；过期 / 重启即失效。
 *   ④ 三条通道**并存**：回环 / 会话 / 令牌。令牌不能因为加了账号被顺手删掉——
 *      抓取脚本、verify-online、各测试套件全靠它做无头鉴权。
 *   ⑤ 登录接口是唯一"公网可打"的写敏感端点 ⇒ 必须自带防爆破，
 *      且限流要按**真实客户端 IP**（XFF）算，否则一个人爆破锁死所有人。
 *   ⑥ 任何能反映权限状态的端点自己要在护栏里（铁律 161）。
 *
 * ★ C 段为什么起子进程而不是打 8124：
 *   要在不使用真实口令的前提下测「正确密码能登录」，只能给服务端一对测试凭据。
 *   `GAMEHUB_ADMIN_USER/PASS` 的优先级高于 data/admin-account.json ⇒
 *   子进程用 env 覆盖，**不碰用户的真实账号文件**，也不把口令写进本文件。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

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
function sliceEndpoint(src, needle) {
  const i = src.indexOf(needle);
  if (i < 0) return '';
  const n = src.indexOf('\napp.', i + needle.length);
  return src.slice(i, n > i ? n : i + 3000);
}

/* ═════════ A. 账号存储层 ═════════ */
console.log('\n-- A. 账号存储（data/admin-account.js）--');
const ACC = read('data/admin-account.js');

ok(fs.existsSync(path.join(ROOT, 'data/admin-account.js')), 'A1 账号模块存在');
ok(/crypto\.scryptSync\(/.test(ACC), 'A2 用 scrypt 派生（不是 md5/sha1，也不是明文比较）');
ok(/crypto\.randomBytes\(16\)/.test(ACC), 'A3 salt 每次随机 16 字节');
ok(/timingSafeEqual/.test(ACC), 'A4 比较用 timingSafeEqual（防时序侧信道）');
ok(/GAMEHUB_ADMIN_USER/.test(ACC) && /GAMEHUB_ADMIN_PASS/.test(ACC), 'A5 支持 env 覆盖（部署时不落盘）');
ok(/\$envU[\s\S]{0,40}return \{[\s\S]{0,120}source: 'env'/.test(ACC.replace(/\n/g, ' ')) || /source: 'env'/.test(ACC),
  'A6 env 优先级高于文件');

/* 落盘文件：只许有派生值 */
const accPath = path.join(ROOT, 'data', 'admin-account.json');
if (fs.existsSync(accPath)) {
  const j = JSON.parse(fs.readFileSync(accPath, 'utf8'));
  ok(!!j.user && /^[0-9a-f]{32}$/.test(j.salt) && /^[0-9a-f]{64}$/.test(j.hash),
    'A7 账号文件结构正确（user + 32 位 hex salt + 64 位 hex hash）', 'user=' + j.user);
  ok(!('pass' in j) && !('password' in j) && !('plain' in j), 'A8 账号文件里没有明文字段');
  const accIsSecret = (() => {
    try { return fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').includes('data/admin-account.json'); } catch (e) { return false; }
  })();
  ok(accIsSecret, 'A9 data/admin-account.json 已进 .gitignore（凭据不入库）');
} else {
  ok(false, 'A7 账号文件存在', '缺 data/admin-account.json（跑 node tools/set-admin-account.js）');
  ok(false, 'A8 账号文件里没有明文字段');
  ok(false, 'A9 data/admin-account.json 已进 .gitignore（凭据不入库）');
}

/* ═════════ B. 服务端接线 ═════════ */
console.log('\n-- B. 服务端接线 --');
const loginEP = sliceEndpoint(SERVER, "app.post('/api/admin/login'");
ok(!!loginEP, 'B1 POST /api/admin/login 存在');
ok(!/adminGuard\(req, res\)/.test(loginEP), 'B2 登录接口本身不能 guarded（否则未登录的人永远进不来）');

const guard = sliceEndpoint(SERVER, 'function adminGuard(');
ok(/sessOf\(req\)/.test(guard) && /_adminVia = 'session'/.test(guard), 'B3 adminGuard 接受会话通道');
ok(/x-admin-token/i.test(guard), 'B4 令牌通道仍在（脚本/无头核验不被顺手砍掉）');
ok(guard.indexOf('isLoop && hostLocal') < guard.indexOf('sessOf(req)')
  && guard.indexOf('sessOf(req)') < guard.indexOf('x-admin-token'),
  'B5 三通道优先级：回环 → 会话 → 令牌');

ok(/LOGIN_MAX\s*=\s*8/.test(SERVER) && /function loginThrottle/.test(SERVER), 'B6 有失败次数上限与限流函数');
ok(/function clientIp[\s\S]{0,400}x-forwarded-for/.test(SERVER),
  'B7 限流按真实客户端 IP（XFF 优先）', '只按 socket 地址算会让一个人爆破锁死所有人');
ok(/GLOBAL_FAIL/.test(SERVER) && /function globalBlocked/.test(SERVER), 'B8 有全站兜底闸门（防 XFF 伪造绕过）');
ok(/HttpOnly/.test(SERVER) && /SameSite=Lax/.test(SERVER), 'B9 会话 Cookie 带 HttpOnly + SameSite=Lax');
ok(/x-forwarded-proto/.test(SERVER) && /;\s*Secure/.test(SERVER), 'B10 只有 https 才加 Secure（本地 http 加了浏览器不写）');
ok(/app\.post\('\/api\/admin\/logout'/.test(SERVER), 'B11 POST /api/admin/logout 存在（能真的注销）');
ok(/app\.get\('\/api\/admin\/account'/.test(sliceEndpoint(SERVER, "app.get('/api/admin/account'")) || /app\.get\('\/api\/admin\/account'/.test(SERVER),
  'B12 GET /api/admin/account 存在');

const accEP = sliceEndpoint(SERVER, "app.get('/api/admin/account'");
ok(/adminGuard\(req, res\)/.test(accEP), 'B13 账号状态端点自己 guarded（铁律 161）');
ok(!/hash|salt/.test(accEP), 'B14 账号状态端点不回传 hash / salt');

const verifyEP = sliceEndpoint(SERVER, "app.get('/api/admin/verify'");
ok(/adminGuard\(req, res\)/.test(verifyEP), 'B15 verify 仍 guarded（v10.90 的探针语义不变）');
ok(/_adminUser|account:/.test(verifyEP), 'B16 verify 回传账号名（前端据此显示"当前是谁"）');

/* ═════════ C. 前端 ═════════ */
console.log('\n-- C. 前端（public/admin.html）--');
ok(/id="acctName"/.test(ADMIN) && /id="acctBtn"/.test(ADMIN), 'C1 顶栏是账号条（名字 + 登录/退出按钮）');
ok(/id="lgUser"/.test(ADMIN) && /id="lgPass"/.test(ADMIN), 'C2 登录弹窗有用户名 / 密码输入');
ok(/fetch\('\/api\/admin\/login'/.test(ADMIN), 'C3 登录请求发往服务端（不是前端比对）');
/* ★ C4 判据是「结构」而不是「某个特定字符串」：
 *   v10.112 之前的写法是「反斜杠 + 具体口令 + 反斜杠」的正则字面量，有两个毛病：
 *     ① 口令一改，这条就恒绿（守着一个已经不存在的值）
 *     ② 脱敏把口令换成六个星号后，正则里会出现「星号紧跟斜杠」的组合，
 *        而这个组合正是块注释的结束符 ⇒ 整个文件语法错误（本轮实际踩到）
 *   改成查「明文口令直比」这种**写法**是否存在：前端/服务端都不许出现 p === '字面量'。
 *   真正的防线在 A 段（A2 查 scryptSync、A5 查明文不落盘），这条只兜「前端比对」这一种退路。 */
ok(!/\bp\s*===\s*'[^']{6,}'/.test(ADMIN) && !/\bp\s*===\s*'[^']{6,}'/.test(SERVER),
  'C4 ★ public/ 与 server.js 里都没有「明文口令直比」（口令只在派生值里）');
ok(/const SKEY = 'gh_admin_sid'/.test(ADMIN), 'C5 会话键名集中一处');
ok(/if \(!fallback && s\) h\['X-Admin-Session'\] = s/.test(ADMIN), 'C6 正常路径走 X-Admin-Session 头');
ok(/sid=' \+ encodeURIComponent\(s\)/.test(ADMIN), 'C7 403 才降级到 ?sid=（不把会话写进 URL 的常规路径）');
ok(/localStorage\.removeItem\(SKEY\)/.test(ADMIN), 'C8 会话失效时清本地 sid（不再一直发无效请求）');
ok(/登录已失效/.test(ADMIN) && /需要管理员账号/.test(ADMIN),
  'C9 横幅区分「从未登录」与「登录已失效」');
ok(/localStorage\.removeItem\(TKEY\)/.test(ADMIN), 'C10 账号登录成功后清掉旧令牌（不留两条凭据）');
ok(/id="lgPaneTok"/.test(ADMIN) && /id="lgSwitch"/.test(ADMIN), 'C11 令牌入口仍在（弹窗里可切换）');
ok(/\$\('lmask'\)\.classList\.contains\('on'\)\) closeLogin/.test(ADMIN), 'C12 Esc 先关登录弹窗');
ok(/id="authBar"/.test(ADMIN) && /function openLogin/.test(ADMIN), 'C13 未登录时内容区有横幅且能直接点去登录');
ok(!/id="tkInput"[^>]*>\s*<button[^>]*onclick="saveToken\(\)"/.test(ADMIN),
  'C14 顶栏不再直接暴露令牌输入框（人走账号，令牌退到弹窗）');

/* ═════════ D. 端到端（子进程 + 测试凭据） ═════════ */
const TUSER = 'tester-v1091';
const TPASS = 'test-pass-9271';
let child = null;

function freePort() {
  return new Promise((res) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });
}
async function waitUp(base, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(base + '/'); if (r.ok) return true; } catch (e) { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}
const jget = async (r) => { try { return await r.json(); } catch (e) { return {}; } };
const XFF = { 'X-Forwarded-For': '198.51.100.77' };

(async () => {
  console.log('\n-- D. 端到端（子进程：env 测试凭据，不碰真实账号文件）--');
  const port = await freePort();
  const BASE = 'http://127.0.0.1:' + port;
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(port), GAMEHUB_ADMIN_USER: TUSER, GAMEHUB_ADMIN_PASS: TPASS }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const cleanup = () => { try { child.kill(); } catch (e) { /* 已退出 */ } };
  process.on('exit', cleanup);

  const up = await waitUp(BASE, 40000);
  ok(up, 'D1 子进程服务已就绪', 'port=' + port);

  if (up) {
    /* 无凭据 + 转发头 ⇒ 必须 403（回环豁免被关掉） */
    let r = await fetch(BASE + '/api/admin/verify', { headers: Object.assign({}, XFF) });
    ok(r.status === 403, 'D2 无凭据（线上形态）→ 403', 'HTTP ' + r.status);

    /* 回环仍然免登录（阳性对照：改鉴权没有把本机体验弄坏） */
    r = await fetch(BASE + '/api/admin/verify');
    const jLoop = await jget(r);
    ok(r.status === 200 && jLoop.via === 'loopback', 'D3 本机回环仍免登录（阳性对照）', 'via=' + jLoop.via);

    /* 错密码 */
    r = await fetch(BASE + '/api/admin/login', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, XFF),
      body: JSON.stringify({ user: TUSER, pass: 'wrong-pass' }),
    });
    let j = await jget(r);
    ok(r.status === 401 && !j.sid, 'D4 错密码 → 401 且不签发会话', 'HTTP ' + r.status);
    ok(!/不存在|未找到|no such user/i.test(String(j.error || '')), 'D5 错误信息不区分「用户名错」与「密码错」（防枚举）');

    /* 对密码 */
    r = await fetch(BASE + '/api/admin/login', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, XFF),
      body: JSON.stringify({ user: TUSER, pass: TPASS }),
    });
    j = await jget(r);
    const sid = j.sid || '';
    const setCookie = String(r.headers.get('set-cookie') || '');
    ok(r.status === 200 && j.ok && sid.length >= 32, 'D6 正确账号密码 → 200 + 会话', 'sid=' + sid.length + ' 字符');
    ok(/gh_sid=/.test(setCookie) && /HttpOnly/i.test(setCookie), 'D7 同时下发 HttpOnly Cookie', setCookie.slice(0, 60));
    ok(!/Secure/i.test(setCookie), 'D8 http 下不带 Secure（带了浏览器不写）');

    /* 会话能用 */
    r = await fetch(BASE + '/api/admin/verify', { headers: Object.assign({ 'X-Admin-Session': sid }, XFF) });
    j = await jget(r);
    ok(r.status === 200 && j.via === 'session' && j.user === TUSER, 'D9 带会话 → 200 via=session', 'user=' + j.user);

    r = await fetch(BASE + '/api/admin/overview', { headers: Object.assign({ 'X-Admin-Session': sid }, XFF) });
    ok(r.status === 200, 'D10 会话可读受保护端点', 'HTTP ' + r.status);

    /* 伪造会话不行 */
    r = await fetch(BASE + '/api/admin/verify', { headers: Object.assign({ 'X-Admin-Session': 'f'.repeat(48) }, XFF) });
    ok(r.status === 403, 'D11 伪造会话串 → 403（不是"有串就放行"）', 'HTTP ' + r.status);

    /* 登出立即失效 */
    r = await fetch(BASE + '/api/admin/logout', {
      method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, XFF), body: JSON.stringify({ sid }),
    });
    ok(r.status === 200, 'D12 登出 → 200');
    r = await fetch(BASE + '/api/admin/verify', { headers: Object.assign({ 'X-Admin-Session': sid }, XFF) });
    ok(r.status === 403, 'D13 登出后同一会话立即失效', 'HTTP ' + r.status);

    /* 令牌通道没被破坏 */
    const tok = (() => { try { return require(path.join(ROOT, 'data', 'admin-token.json')).token; } catch (e) { return ''; } })();
    if (tok) {
      r = await fetch(BASE + '/api/admin/verify', { headers: Object.assign({ 'X-Admin-Token': tok }, XFF) });
      j = await jget(r);
      ok(r.status === 200 && j.via === 'token', 'D14 令牌通道仍然有效（脚本不受影响）', 'via=' + j.via);
    } else {
      ok(false, 'D14 令牌通道仍然有效（脚本不受影响）', 'data/admin-token.json 缺失');
    }

    /* 限流：同一 IP 连错到上限后转 429；且**不同 IP 不受牵连**（这是本轮修过的坑） */
    const IP2 = { 'X-Forwarded-For': '198.51.100.78', 'Content-Type': 'application/json' };
    let last = 0, hits = 0;
    for (let i = 0; i < 10; i++) {
      const rr = await fetch(BASE + '/api/admin/login', { method: 'POST', headers: IP2, body: JSON.stringify({ user: TUSER, pass: 'bad' + i }) });
      last = rr.status;
      if (rr.status === 429) { hits = i + 1; break; }
    }
    ok(last === 429 && hits === 9, 'D15 同 IP 连错 8 次后第 9 次 → 429', '第 ' + hits + ' 次触发');
    const rOther = await fetch(BASE + '/api/admin/login', {
      method: 'POST',
      headers: Object.assign({}, XFF, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ user: TUSER, pass: TPASS }),
    });
    ok(rOther.status === 200, 'D16 ★ 别的 IP 不受牵连（限流按 XFF 算，不按 socket）', 'HTTP ' + rOther.status);
  } else {
    ['D2 无凭据（线上形态）→ 403', 'D3 本机回环仍免登录（阳性对照）', 'D4 错密码 → 401 且不签发会话',
      'D6 正确账号密码 → 200 + 会话', 'D9 带会话 → 200 via=session', 'D11 伪造会话串 → 403',
      'D13 登出后同一会话立即失效', 'D15 同 IP 连错 8 次后第 9 次 → 429', 'D16 ★ 别的 IP 不受牵连']
      .forEach((n) => ok(false, n, '子进程未就绪，无法实测'));
  }

  cleanup();
  console.log('\n====');
  console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  if (fail) console.log('失败项：\n  - ' + fails.join('\n  - '));
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  try { if (child) child.kill(); } catch (err) { /* ignore */ }
  console.error('套件异常: ' + e.message + '\n' + (e.stack || ''));
  process.exit(1);
});
