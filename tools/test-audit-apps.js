#!/usr/bin/env node
/**
 * tools/test-audit-apps.js — 守住「应用 / 链接对账」这个收尾工具（v10.21 新增）
 *
 * ★ 为什么要有它：
 *   `tools/audit-apps.js` 是**收尾判定「线上到底是哪一版」的依据**。
 *   它自己出错，结论会**正好反着来**（把最新的 LIVE 判成「旧版」）——
 *   本项目已因「判定报反」踩过一次，代价是用户端看到旧界面。
 *
 * ★ 本套件守的正是**刚踩过的那三个坑**（都属「改动后看起来更严格、实则报反」）：
 *   ① 门控 `test` 不能按 JSON/text **分流** —— 分流过一次：status===200 时把 body 传进去，
 *      而判据写的是 `(r) => r.status === 200`，于是**永远为假**、LIVE 被判成缺 v10.20。
 *   ② 必须收集**全部**缺口再取最旧的 —— `break` 在第一个缺口会把「停在 v10.18」
 *      报成「尚未发布 v10.21」（都对，但没用；而且掩盖了真实停点）。
 *   ③ `GATES` 必须**由新到旧** —— 顺序反了「取最旧」就变成「取最新」，结论整个反过来。
 *
 * 离线可跑：只读文件 + 跑一次 `--no-net`（不联网）。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL: ' + m); } };

const SRC = (() => { try { return fs.readFileSync(path.join(ROOT, 'tools/audit-apps.js'), 'utf8'); } catch { return ''; } })();
const REPORT = (() => { try { return fs.readFileSync(path.join(ROOT, 'tools/report.js'), 'utf8'); } catch { return ''; } })();

console.log('=== A. 脚本存在与离线可跑 ===');
ok(SRC.length > 2000, 'tools/audit-apps.js 存在且有实质内容', Buffer.byteLength(SRC, 'utf8'));
let out = '', code = 0;
try {
  out = execFileSync(process.execPath, ['tools/audit-apps.js', '--no-net'], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
} catch (e) { code = e.status == null ? -1 : e.status; out = String(e.stdout || '') + String(e.stderr || ''); }
ok(code === 0, '`--no-net` 跑通（exit 0）', 'exit=' + code);
ok(!/undefined|NaN|\[object/.test(out), '★ 输出里没有 undefined/NaN/[object（表格值都取到了）');

console.log('\n=== B. 应用登记真的读出来了 ===');
/* 三条登记来自 applications.yaml ∪ .wbapp_*.genie —— 一条都不许丢（丢一条 = 清理时看漏一个） */
for (const id of ['wbapp_k0YzBHCqnzzK9YrcG5Bru0', 'wbapp_D5cUfPk1IwCJlI3eIgc96h', 'wbapp_WNoF5maytwivZ60TUa6CPA']) {
  ok(out.includes(id), '登记表里有 `' + id + '`');
}
ok(/共\s*\*\*\d+\*\*\s*条登记/.test(out), '给出登记**条数**（可一眼发现又多了一条）');
ok(/设置—数据管理—应用/.test(out), '★ 说明去哪清理（平台无删除接口，只能手工）');

console.log('\n=== C. 必须警告「unpublish 会误伤 LIVE」===');
/* 所有旧 app 的 localDir 是同一个目录 ⇒ sites 的 unpublish 取「同目录最新一次发布」，
   一定会把 LIVE 下掉。这条警告漏了，用户会按着去清链接，然后把正式入口清没。 */
ok(/unpublish/.test(SRC) && /同一本地目录的最新一次发布|同目录最新/.test(SRC),
  '★ 明确写清 unpublish 会取「同目录最新一次发布」');
ok(/会把 v3 一起下掉|会把 LIVE 一起下掉/.test(SRC), '★ 明确写清后果（LIVE 会被一起下掉）');

console.log('\n=== D. 门控不许按 JSON/text 分流（刚踩过的报反坑）===');
/* 反例长这样（已删）：`rr.status === 200 ? rr.body : rr` —— 判据收 body 却比 r.status ⇒ 恒假 */
ok(!/status\s*===\s*200\s*\?\s*\w+\.body\s*:/.test(SRC),
  '★ 没有「按状态码挑 body/text 再传进判据」的写法（会让判据恒假）');
ok(/let body = null/.test(SRC) && /try\s*\{\s*body\s*=\s*JSON\.parse/.test(SRC),
  '统一返回 {status,text,body} 三件套，判据只吃这个对象');
ok(/return \{ status: r\.status, text: \w+, body \}/.test(SRC), '★ 返回对象确实含 status/text/body 三件套');
ok(/test:\s*\(r\)\s*=>\s*r\.body\s*&&\s*r\.body\.total/.test(SRC),
  '数据层门控读 r.body.total（不是把 body 当响应对象用）');
ok(/test:\s*\(r\)\s*=>\s*r\.status\s*===\s*200/.test(SRC), '接口型门控读 r.status');

console.log('\n=== E. 必须收集「全部」缺口再取最旧 ===');
/* break 在第一个缺口 ⇒ 「停在 v10.18」被报成「尚未发布 v10.21」 */
ok(/const missing = \[\];/.test(SRC) && /missing\.push\(g\)/.test(SRC),
  '★ 收集全部缺口（`missing.push`），不是命中即 break');
ok(!/stopBefore\s*=\s*g;\s*break/.test(SRC), '★ 已删掉「第一个缺口就 break」的旧写法');
ok(/missing\[missing\.length\s*-\s*1\]/.test(SRC), '取**最旧**的缺口当停点（末位）');
ok(/由新到旧/.test(SRC), '★ 注释写明 GATES 顺序是「由新到旧」（顺序反了结论整个反过来）');

console.log('\n=== F. GATES 顺序真的是由新到旧 ===');
{
  const block = SRC.slice(SRC.indexOf('const GATES = ['), SRC.indexOf('function probe'));
  const vers = [...block.matchAll(/since:\s*'v(\d+)\.(\d+)'/g)].map((m) => Number(m[1]) * 1000 + Number(m[2]));
  ok(vers.length >= 4, 'GATES 至少 4 个版本门', vers.join(','));
  ok(vers.every((v, i) => i === 0 || vers[i - 1] > v), '★ 版本号严格递减（新 → 旧）', vers.join(' > '));
  /* ⚠️ 编码口径是 `主版本*1000 + 次版本` ⇒ v10.17 = **10017**，不是 1017。
     第一版就把它写成 1017，白红了一次 —— 断言里的字面量同样要复核。 */
  ok(vers[vers.length - 1] === 10017 || vers[vers.length - 1] === 10016,
    '末位是最旧的已知门槛（v10.17/v10.16）', 'v' + String(vers[vers.length - 1]).replace(/(\d\d)(\d{2})/, '$1.$2'));
}

console.log('\n=== G. 与 report.js 同源（LIVE 只能有一个真源）===');
{
  const liveA = (SRC.match(/LIVE:\s*'([^']+)'/) || [])[1] || '';
  const liveB = (REPORT.match(/LIVE:\s*'([^']+)'/) || [])[1] || '';
  ok(!!liveB, 'report.js 里声明了 LIVE', liveB);
  ok(!/LIVE:\s*'/.test(SRC) || liveA === liveB,
    '★ audit-apps 不自己写死 LIVE，而是从 report.js 读（与 LIVE 同源）', liveA || '(未写死)');
  ok(/report\.js/.test(SRC), '注释里点名了真源是 tools/report.js');
}

console.log('\n=== H. 弃用链接的 why 必须与实测一致（防旧说法漂移）===');
/* 旧 why 写着 36aa「碰巧含 v10.18」，复测其实是**与本地逐字节一致**。
   这类文案漂移会让下一个人判断错「哪个域名还能用」。 */
ok(/未登记的别名域名/.test(REPORT), '★ 36aa 的 why 已改成「未登记的别名域名」（不再是旧版描述）');
ok(/停在 v10\.18/.test(REPORT) && /停在 v10\.17/.test(REPORT), 'v2 / join 的 why 写明实测停点');
ok(!/碰巧含 v10\.18/.test(REPORT), '★ 已删掉「碰巧含 v10.18」的过时说法');

console.log('\n通过 ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
