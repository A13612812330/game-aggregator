#!/usr/bin/env node
/* tools/check-inline-syntax.js —— 给 public/*.html 里的内联脚本做**精确到行列**的语法检查
 *
 * 用法：
 *   node tools/check-inline-syntax.js              # 默认查 public/index.html
 *   node tools/check-inline-syntax.js public/emulator.html public/unpack.html
 *
 * 退出码：0 = 全部通过；1 = 有文件语法错。
 *
 * ★ 为什么需要它（v10.28 实测踩到）：
 *   `public/index.html` 的内联脚本有 **16 万字符 / 3400 行**，整页塞进 `new Function()` 试错时，
 *   报错信息指不到「是哪个字符序列把字符串/注释提前闭合了」。
 *   抽成独立 .js 再 `node --check`，一次就能拿到**精确行列**与 offending token。
 *
 * ★ 它抓到过什么（真实记录）：
 *   · v10.28：注释里写「改走 ** 斜杠 api/download 双星号」时，`** 斜杠` 里的 `斜杠星号`
 *     提前闭合了块注释 ⇒ `SyntaxError: Unexpected identifier`。
 *     与铁律 13「模板串里不能写反引号」同源：**注释里也有会提前闭合的字符序列**。
 *   · 同版：把 `#drawerBody` 写成 markdown 行内代码（反引号）⇒ 模板串提前终止。
 *
 * ⚠️ 抽取规则用「**最后一个** `</script>`」而不是第一个：页面里可能有多个 script 块
 *    （埋点 / 快照数据），取首尾之间会把它们一并算进来。本项目约定内联脚本只有一块，
 *    所以要提醒：**若将来拆成多块，这里必须改成按块分别校验**。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUTDIR = path.join(ROOT, '_test-out');
/* 默认查**三个页面**：派生页各有自己的内联块，只查主源会漏。
 * （改主源后忘了重建派生页 ⇒ 派生页仍带旧脚本，这条顺手能兜住语法层面的一半。） */
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['public/index.html', 'public/emulator.html', 'public/unpack.html'];

if (!fs.existsSync(OUTDIR)) fs.mkdirSync(OUTDIR, { recursive: true });

let bad = 0;
for (const rel of files) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) { console.log('⚠️  找不到 ' + rel); bad++; continue; }
  const html = fs.readFileSync(p, 'utf8');
  const scripts = (html.match(/<script[^>]*>/g) || []).length;
  const a = html.indexOf('<script>');
  const b = html.lastIndexOf('</script>');
  if (a < 0 || b < 0) { console.log('⚠️  ' + rel + ' 里没有内联 script'); bad++; continue; }
  const body = html.slice(a + '<script>'.length, b);
  const out = path.join(OUTDIR, '_inline-' + path.basename(rel).replace(/\.html$/, '') + '.js');
  fs.writeFileSync(out, body, 'utf8');
  let ok = true, msg = '';
  try {
    execFileSync(process.execPath, ['--check', out], { stdio: 'pipe' });
  } catch (e) {
    ok = false;
    msg = String((e.stderr || e.stdout || '')).split('\n').slice(0, 6).join('\n');
  }
  const kb = (Buffer.byteLength(body, 'utf8') / 1024).toFixed(0);
  console.log((ok ? '✅ ' : '❌ ') + rel + '  内联脚本 ' + body.split('\n').length + ' 行 / ' + kb + 'KB'
    + '（script 块 ' + scripts + ' 个）');
  if (!ok) { console.log(msg); bad++; }
}
console.log(bad ? ('\n❌ ' + bad + ' 个文件语法有错') : '\n✅ 全部通过');
/* ★ 末行给 `n / m` 计数：`tools/run-all.js` 取输出里**最后一个** `n / m` 当成绩。
 *   没有这行的话，被 run-all 拉起来时它只会显示 `n/a`（成绩算不进去）。 */
console.log('通过 ' + (files.length - bad) + ' / ' + files.length);
process.exit(bad ? 1 : 0);
