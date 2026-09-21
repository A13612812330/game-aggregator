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
 *   静态套件已有 23 套，手敲 `node tools/test-*.js` 容易漏跑（漏跑的那套往往就是
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
  'test-download.js',
  'test-twin.js',
  'test-covers.js',
  'test-card-parity.js',
  'test-pages-sync.js',
  'test-shared-destructure.js',
  'test-report.js',
  'test-match-release.js',
  'test-audit-apps.js',
  'test-launcher.js',
  'test-v1026-jidiposts.js',
  'test-v1027-dlpop.js',
  'test-v1028-detail.js',
  'test-v1029-detail.js',
  'test-v1030-cards.js',
];
/* 刻意**不登记**的：
 *   · test-search-ui.js  —— 用 puppeteer，属第二层「浏览器实拍」，本脚本跑不了
 *   · test-emuhub.js     —— 已废弃的兼容壳，内部 require('./test-emulator-page.js')，
 *                           登记它只会把同一批断言算两遍（不是漏登记）
 *   · check-inline-syntax.js —— 它不是「断言套件」而是**前置闸**（见下面的 PREFLIGHT）：
 *                           只吐文件数、不吐断言数，混进 SUITES 会把条数汇总口径搅浑。 */

/* 前置闸 —— 在跑任何断言**之前**执行。
 * ★ 为什么必须有：`public/*.html` 的内联脚本是 3400~4700 行的单块 JS，
 *   一旦语法坏了（注释里出现提前闭合序列、模板串里塞了反引号），
 *   后面所有套件都会以「找不到标记 / 断言失败」的形式集体翻红 —— 看着像几十处功能坏了，
 *   实际只有一处手误。先过语法闸，报错才能**精确到行列**。
 * 判据：退出码非零 ⇒ 直接计入 crashed，最终 process.exit(1)。
 *
 * ② check-card-rules.js —— 卡片族 CSS「全量枚举」闸（2026-09-18 v10.30 新增）。
 *   ★ 与断言套件的分工：套件只能守住**它已知的选择器**；有人新加一条断点（如
 *     `.skeleton .sk-th{width:112px;height:66px}`），套件照样绿，样式却已漂。
 *   本闸反过来——先枚举 2 页实际规则体，再判「图片槽有没有定高」「卡片容器圆角有没有走变量」，
 *   所以它能抓到「测试还不知道的那条断点」。本轮实测就是靠它揪出 3 个未知选择器
 *   （.sm-row .go2 / .emu-card .cfg-btn / .rel-row .rel-it .why）。
 *   ⚠️ 它维护两张**显式例外表**（.emu-card .cov 顶部横幅 92px 等），并**自检陈旧**：
 *     表里登记、代码里已不存在的选择器也会报错，避免「例外表」退化成「静默跳过」。 */
const PREFLIGHT = [
  { name: 'check-inline-syntax.js', args: ['public/index.html', 'public/emulator.html', 'public/unpack.html'] },
  { name: 'check-card-rules.js', args: [] },
];

let pass = 0, fail = 0;
const crashed = [];
const missing = [];
const noExit = [];

/**
 * 套件是否**把退出码挂在失败数上**。
 *
 * ★★ 为什么必须先查这个（v10.22 实测踩到）：本脚本靠**解析输出**里的 `n / m` 统计成绩，
 *   所以即使某套件永远 exit 0，全量汇总**仍然是对的** —— 但这是「险过」：
 *     · 单独跑 `node tools/test-xxx.js`（`WORKFLOW.md` 步骤 8 就是这么写的）时，
 *       `echo $?` 得到 0 ⇒ **红的被当成绿的**；
 *     · 标准反证判据（打坏护栏 → 退出码非零）**对它完全失效**，
 *       等于这道护栏**验不了**，和没有差不多。
 *   实测当时有 2 套中招：`test-report.js` 与 `test-alias-guard.js`（都已补）。
 *
 * 只认两种写法的「挂在失败数上」：
 *   · `process.exit(fail ? 1 : 0)` / `process.exit(fail.length ? 1 : 0)`
 *   · `if (fail) process.exitCode = 1`
 * ★ 故意**不认** catch 里的 `process.exit(1)` —— 那只覆盖「脚本崩了」，
 *   不覆盖「断言失败了」，正是本函数要区分的东西。
 */
function exitTiedToFailures(src) {
  const NAMES = /^(fail|fails|failures|failed|bad|errs|nFail)$/;
  const m1 = [...src.matchAll(/process\.exit\s*\(\s*([A-Za-z_$][\w$]*)(?:\.length)?\s*\?/g)];
  if (m1.some((m) => NAMES.test(m[1]))) return true;
  if (/process\.exitCode\s*=\s*1/.test(src) && /\bif\s*\(\s*(fail|fails|failures|failed|bad|errs|nFail)\b/.test(src)) return true;
  return false;
}

/* ---------- 前置闸 ---------- */
let preOk = 0;
for (const pf of PREFLIGHT) {
  const file = path.join(ROOT, 'tools', pf.name);
  if (!fs.existsSync(file)) { missing.push(pf.name); continue; }
  let out = '', code = 0;
  try {
    out = execFileSync(process.execPath, [file, ...(pf.args || [])], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000,
    });
  } catch (e) {
    code = e.status == null ? -1 : e.status;
    out = String(e.stdout || '') + String(e.stderr || '');
  }
  if (code !== 0) crashed.push(`${pf.name} (前置闸 exit ${code})`);
  else preOk++;
  if (!QUIET) {
    console.log(`\n${'='.repeat(68)}\n  [前置闸] ${pf.name}  exit=${code}\n${'='.repeat(68)}`);
    console.log(out.trim());
  } else {
    console.log(`  ${code === 0 ? '✅' : '❌'} [前置闸] ${pf.name}  exit=${code}`);
  }
}

for (const s of SUITES) {
  const file = path.join(ROOT, 'tools', s);
  if (!fs.existsSync(file)) { missing.push(s); continue; }

  if (!exitTiedToFailures(fs.readFileSync(file, 'utf8'))) noExit.push(s);

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
console.log(`前置闸：${preOk} / ${PREFLIGHT.length} 通过`);
console.log(`通过 ${pass} / 失败 ${fail}`);
if (missing.length) console.log(`⚠️ 清单里的文件不存在：${missing.join(', ')}`);
if (noExit.length) {
  console.log(`⚠️ 退出码不随失败变（单独跑时红绿不分，且反证验不了）：${noExit.join(', ')}`);
  console.log('   ⇒ 在该套件末尾补 `process.exit(fail ? 1 : 0)`');
}
console.log(`异常退出：${crashed.length ? crashed.join(', ') : '无'}`);
console.log(`${'#'.repeat(52)}`);

if (fail || crashed.length || missing.length || noExit.length) {
  console.log('\n⚠️ 静态防线未全绿 —— 先修这里，别急着跑实拍。');
  process.exit(1);
}
console.log('\n✅ 静态防线全绿。接下来：浏览器实拍（加大超时、分批跑）→ 线上验收。');
