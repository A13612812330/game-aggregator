#!/usr/bin/env node
/* tools/run-all.js —— 一键跑完**静态防线**（第一层）
 *
 * 项目三层防线：
 *   ① 静态防线（本脚本）：纯 node / jsdom，秒级，改动后**必跑**
 *   ② 浏览器实拍：`tools/preview-v*.js`、`tools/test-emulator-page.js`、`tools/test-search-ui.js`
 *      —— 含 puppeteer，需服务在 8123 运行；**要加大超时**（120s 默认会 SIGTERM，
 *      看起来像失败其实是超时），且**分批跑**（多套件连同一个 CDP 会抛 detached Frame）
 *   ③ 线上验收：`tools/verify-online.js`（比对线上与本地的 md5，HTTP 200 区分不出新旧）
 *
 * 用法：
 *   node tools/run-all.js            # 跑全部静态套件，输出汇总
 *   node tools/run-all.js --quiet    # 只输出每套的通过数 + 末行汇总
 *
 * 退出码：0 = 全绿；1 = 有失败或套件异常退出。
 *
 * ★ 为什么要有这个脚本（2026-09-19 新增）：
 *   静态套件已有 15 套，手敲 `node tools/test-*.js` 容易漏跑（漏跑的那套往往就是
 *   被改坏的那套）。这里把清单固化，避免"以为跑全了"。
 *   ⚠️ 新增静态套件时**必须**加进下面的 SUITES，否则它会永远不被防线覆盖。
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const QUIET = process.argv.includes('--quiet');

/* 套件清单 —— 新增一个就往这里加一个。
 * 判据不是「有没有用浏览器」，而是「要不要人盯着」（下面这些都无需交互、秒级出结果）。
 * ⚠️ 其中 test-emulator-page.js 用 jsdom 从 http://127.0.0.1:8123 加载真实页面，
 *    所以跑全量静态防线时**服务要在跑**（否则它会整体失败，看起来像代码坏了）。
 * ⚠️ 末行汇总格式：各套件必须以「通过 n/m」结尾，本脚本取**最后一个** `n / m` 当成绩。 */
const SUITES = [
  'test-alias-guard.js',
  'test-emulator-page.js',
  'test-saves-match.js',
  'test-date-norm.js',
  'test-mods.js',
  'test-related-dl.js',
  'test-device-translate.js',
  'test-emulator-structure.js',
  'test-filter-layout.js',
  'test-v1014.js',
  'test-v1015.js',
  'test-v1016.js',
  'test-v1017.js',
  'test-v1018.js',
  'test-spec.js',
  'test-pages-sync.js',
  'test-report.js',
  'test-match-release.js',
];

let pass = 0, fail = 0;
const crashed = [];
const missing = [];

for (const s of SUITES) {
  const file = path.join(ROOT, 'tools', s);
  if (!fs.existsSync(file)) { missing.push(s); continue; }

  let out = '', code = 0;
  try {
    out = execFileSync(process.execPath, [file], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000,
    });
  } catch (e) {
    code = e.status == null ? -1 : e.status;
    out = String(e.stdout || '') + String(e.stderr || '');
  }

  /* 取输出里**最后一个** `n / m` 作为该套件的成绩 */
  const m = out.match(/(\d+)\s*\/\s*(\d+)/g);
  let p = null, t = null;
  if (m && m.length) {
    const last = m[m.length - 1].split('/');
    p = Number(last[0]); t = Number(last[1]);
  }
  if (p != null) { pass += p; fail += (t - p); }
  if (code !== 0) crashed.push(`${s} (exit ${code})`);

  if (!QUIET) {
    console.log(`\n${'='.repeat(68)}\n  ${s}  exit=${code}  ${p != null ? p + '/' + t : 'n/a'}\n${'='.repeat(68)}`);
    console.log(out.trim());
  } else {
    console.log(`  ${p != null && p === t && code === 0 ? '✅' : '❌'} ${s}  ${p != null ? p + '/' + t : 'n/a'}  exit=${code}`);
  }
}

console.log(`\n${'#'.repeat(52)}`);
console.log(`静态防线：${SUITES.length} 套`);
console.log(`通过 ${pass} / 失败 ${fail}`);
if (missing.length) console.log(`⚠️ 清单里的文件不存在：${missing.join(', ')}`);
console.log(`异常退出：${crashed.length ? crashed.join(', ') : '无'}`);
console.log(`${'#'.repeat(52)}`);

if (fail || crashed.length || missing.length) {
  console.log('\n⚠️ 静态防线未全绿 —— 先修这里，别急着跑实拍。');
  process.exit(1);
}
console.log('\n✅ 静态防线全绿。接下来：浏览器实拍（加大超时、分批跑）→ 线上验收。');
