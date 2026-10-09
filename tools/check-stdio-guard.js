#!/usr/bin/env node
/**
 * tools/check-stdio-guard.js —— 子进程 stdin 沙箱守卫（v10.46 新增）
 *
 * ── 为什么需要它 ───────────────────────────────────────────────
 * 在 WorkBuddy 沙箱里，**node 起子进程时如果 stdin 是 pipe（node 的默认值！）
 * 会直接 EBUSY（errno -4082）**，子进程根本起不来。
 *
 * 实测对照（`git --version` / `node -v` / `whoami` / `echo hi`，7 种组合）：
 *   默认(三路 pipe) ✗ · stdio:'pipe' 显式 ✗ · ['pipe','pipe','pipe'] ✗
 *   stdio:'ignore' ✓ · ['ignore','pipe','pipe'] ✓ · ['inherit','pipe','pipe'] ✓
 *   ⇒ **判据只看 stdin**，与 stdout/stderr 无关。
 *
 * 与 `NODE_OPTIONS` **无关**（清空无效、换系统 node 无效、提权无效）——那是最初的错误归因。
 *
 * ── 为什么它值得一道防线 ───────────────────────────────────────
 * 这个坑的失败方式是**静默的、并且会让防线自己说谎**：
 *   · `try { execFileSync(...) } catch (e) { out = e.stdout + e.stderr }`
 *     ⇒ EBUSY 被吞成 `out=''` ⇒ 看起来像「打坏后一条都没红」⇒ **反证整体反转成"护栏是假绿"**；
 *   · `test-report.js` 那种 `ok(threw, ...)` ⇒ 直接判失败 ⇒ 看起来像代码坏了。
 * 两种都会把**环境问题**伪装成**代码问题**，或者更糟——伪装成"守卫有效"。
 *
 * ── 判据（只做静态检查，不跑子进程）────────────────────────────
 * 对每个 `execFileSync / execFile / execSync / spawnSync / spawn(` 调用：
 *   ① 用**括号配对**取出完整调用文本；
 *   ② 取**最后一个实参**（options）：
 *      · 不是对象字面量（变量 / 函数调用） ⇒ UNKNOWN，必须登记例外（可能是 STDIO 常量）
 *      · 对象字面量里没有 `stdio` ⇒ **DANGEROUS**（默认 stdin=pipe）
 *      · `stdio: 'pipe'` ⇒ DANGEROUS ／ `'ignore'`/`'inherit'` ⇒ OK
 *      · `stdio: [...]` ⇒ 看第 0 项：pipe ⇒ DANGEROUS，其余 ⇒ OK
 *
 * ★ 例外表自检潮流（同 check-card-rules.js）：登记了但已不存在的调用点同样报错，
 *   避免「例外表」退化成「静默跳过」。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CALL_RE = /\b(execFileSync|execFile|execSync|spawnSync|spawn)\s*\(/g;

/* ---------- 例外表：file#序号 → 理由 ----------
 * ★ 只允许「确实不会走到」或「已用常量传 stdio」这类，且**必须写清理由**。
 *   序号 = 该文件内第几个被扫到的子进程调用（从 1 开始）。
 */
const EXCEPTIONS = {
  'tools/_push-via-api.js#1': 'stdio 由同文件常量 STDIO 传入（`Object.assign({...}, STDIO)`，不在字面量里）',
  'tools/_push-via-api.js#2': '同上（gitRaw）',
  'tools/restart-server.js#1': 'stdio 由同函数常量 NETSTAT_STDIO 传入',
  'tools/restart-server.js#2': '同上（fallback 到 System32\\netstat.exe 那次）',
};

/* ---------- 扫描 ---------- */
function matchParen(s, start) {
  /* start 指向 '('，返回与之配对的 ')' 的下标（跳过字符串与模板串） */
  let depth = 0, i = start, q = null;
  for (; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '\\') { i++; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/* 在调用文本里取「最后一个顶层实参」 */
function lastArg(callText) {
  const a = callText.indexOf('(');
  const inner = callText.slice(a + 1, callText.length - 1);
  let depth = 0, q = null, last = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) last = i + 1;
  }
  return inner.slice(last).trim();
}

function judge(optsText) {
  if (!/^\{/.test(optsText)) return { v: 'UNKNOWN', why: 'options 不是对象字面量' };
  const m = optsText.match(/stdio\s*:\s*([\s\S]*)/);
  if (!m) return { v: 'DANGEROUS', why: "没有 stdio ⇒ stdin 默认 pipe" };
  const rest = m[1].trim();
  if (/^['"`]/.test(rest)) {
    const lit = rest.match(/^['"`]([a-z]+)['"`]/)[1];
    if (lit === 'pipe') return { v: 'DANGEROUS', why: "stdio:'pipe' ⇒ stdin 是 pipe" };
    return { v: 'OK', why: `stdio:'${lit}'` };
  }
  if (rest[0] === '[') {
    const inner = rest.slice(1, rest.indexOf(']'));
    const first = inner.split(',')[0].trim().replace(/^['"`]|['"`]$/g, '');
    if (first === 'pipe') return { v: 'DANGEROUS', why: "stdio[0]='pipe' ⇒ stdin 是 pipe" };
    return { v: 'OK', why: `stdio[0]='${first}'` };
  }
  return { v: 'UNKNOWN', why: 'stdio 取的是非常量' };
}

/* 剥掉注释与**大部分**字符串，避免把「注释里写的 `spawn(`」或
 * 「反证用例里当载荷的 `spawn(...)` 字符串」当成真调用。
 * ★ 但**必须保留 `stdio` 的取值字面量**（`'pipe'` / `'ignore'` / `'inherit'`），
 *   否则 judge 读不到值 —— 第一版整段保留字符串，结果把本轮新加的第 ⑫ 条反证
 *   载荷字符串（`bad: 'p = spawn(cmd, args, {...});'`）误报成一处 DANGEROUS。
 *   ⇒ 策略：字符串内容若**恰好是 stdio 的合法取值**则原样保留，否则掏成空格。
 * 掏空时保持**行号与列号不变**（不改动换行）。 */
const STDIO_TOKENS = new Set(['pipe', 'ignore', 'inherit', 'ipc', 'overlapped']);
/* `/` 之前出现这些有效字符 ⇒ 它在**正则位置**（不是除号）。
 * ★ 必须识别正则字面量：否则形如 `/^['"`]/` 的正则里的引号会被当成字符串开头，
 *   扫描器**整段失步**，后面的注释/字符串全判错 —— 本轮就是这么把自己的注释误报成
 *   一处 DANGEROUS 的（实测：修好这一处后误报消失）。 */
const REGEX_PREV = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
function stripCommentsAndStrings(s) {
  const out = s.split('');
  const n = s.length;
  let i = 0, prevSig = '';
  const blank = (a, b) => { for (let k = a; k < b && k < n; k++) if (out[k] !== '\n') out[k] = ' '; };
  while (i < n) {
    const c = s[i], c2 = s[i + 1];
    if (c === '/' && c2 === '/') { const e = s.indexOf('\n', i); blank(i, e < 0 ? n : e); i = e < 0 ? n : e; continue; }
    if (c === '/' && c2 === '*') { const e = s.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; blank(i, end); i = end; continue; }
    if (c === '/' && (prevSig === '' || REGEX_PREV.has(prevSig))) {
      /* 正则字面量：扫到未转义的 `/`，中途 `[...]` 里的 `/` 不算结束；整体掏空 */
      let j = i + 1, inClass = false;
      while (j < n) {
        const d = s[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '\n') break;
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) break;
        j++;
      }
      blank(i, Math.min(j, n));
      i = Math.min(j, n);
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n) { if (s[j] === '\\') { j += 2; continue; } if (s[j] === c) break; j++; }
      const body = s.slice(i + 1, Math.min(j, n));
      if (!STDIO_TOKENS.has(body)) blank(i + 1, Math.min(j, n));
      i = Math.min(j, n) + 1;
      continue;
    }
    if (!/\s/.test(c)) prevSig = c;
    i++;
  }
  return out.join('');
}

const targets = [];
for (const dir of ['tools', 'fetchers', 'root']) {
  const abs = dir === 'root' ? ROOT : path.join(ROOT, dir);
  for (const f of fs.readdirSync(abs)) {
    if (!f.endsWith('.js')) continue;
    targets.push(dir === 'root' ? f : path.join(dir, f));
  }
}
targets.sort();

const dangerous = [], unknown = [], okList = [];
for (const rel of targets) {
  const p = path.join(ROOT, rel);
  if (!fs.statSync(p).isFile()) continue;
  const s = stripCommentsAndStrings(fs.readFileSync(p, 'utf8'));
  CALL_RE.lastIndex = 0;
  let m, n = 0;
  while ((m = CALL_RE.exec(s))) {
    n++;
    const open = s.indexOf('(', m.index);
    const close = matchParen(s, open);
    if (close < 0) continue;
    const callText = s.slice(m.index, close + 1);
    const line = s.slice(0, m.index).split('\n').length;
    const arg = lastArg(callText);
    const j = judge(arg);
    /* ★ 键必须用**正斜杠**：`path.join` 在 Windows 上产出反斜杠（`tools\_x.js`），
     *   而人写例外表时习惯写正斜杠 ⇒ 两边对不上会让**例外表整表失效**（全报"陈旧"）。
     *   本轮实测踩过：写成 `tools/_push-via-api.js#1` 时守卫报"陈旧登记"。 */
    const key = `${rel.replace(/\\/g, '/')}#${n}`;
    const rec = { key, rel, line, fn: m[1], why: j.why, ex: EXCEPTIONS[key] };
    if (j.v === 'DANGEROUS') dangerous.push(rec);
    else if (j.v === 'UNKNOWN') unknown.push(rec);
    else okList.push(rec);
  }
}

/* ---------- 例外表自检（陈旧登记） ---------- */
const seen = new Set([...dangerous, ...unknown, ...okList].map((r) => r.key));
const stale = Object.keys(EXCEPTIONS).filter((k) => !seen.has(k));

/* ---------- 临时脚本（`_*`）单独归类 ----------
 * `.gitignore` 明确把 `tools/_*` 定义为「临时探针（一次性调试用，**非项目组成**）」
 *   ⇒ 它们不阻断防线（否则每次留个探针就红），但**必须显式列出来 + 计数**，
 *     绝不静默跳过 —— 静默跳过正是本项目最忌讳的那种"看起来全绿"。
 *   ★ 但**反证类**（`_counterproof-*`）不在此列：它是验证机制本身，
 *     起不来会让反证**静默反转**（把"没测到"报成"护栏是假绿"）⇒ 必须当真缺陷处理。
 */
const isTemp = (rel) => path.basename(rel).startsWith('_') && !/^_counterproof-/.test(path.basename(rel));
const tempD = dangerous.filter((r) => isTemp(r.rel) && !r.ex);
const hardD = dangerous.filter((r) => !isTemp(r.rel) && !r.ex);

/* ---------- 输出 ---------- */
let fail = 0;
console.log('=== 子进程 stdin 沙箱守卫（v10.46）===');
console.log(`扫描 ${targets.length} 个文件 · 共 ${dangerous.length + unknown.length + okList.length} 处子进程调用\n`);

console.log(`\n【DANGEROUS】${dangerous.length} 处 —— stdin 是 pipe，沙箱内必然 EBUSY`);
for (const r of dangerous) {
  const tag = r.ex ? `  [已登记例外：${r.ex}]` : (isTemp(r.rel) ? '  [临时脚本，不阻断]' : '  ★ 必须修');
  console.log(`  ❌ ${r.rel}:${r.line}  ${r.fn}(…)  ${r.why}${tag}`);
}
console.log(`\n【UNKNOWN】${unknown.length} 处 —— 需人工确认是否已安全传入 stdio`);
for (const r of unknown) {
  console.log(`  ⚠️  ${r.rel}:${r.line}  ${r.fn}(…)  ${r.why}` + (r.ex ? `  [已登记例外：${r.ex}]` : ''));
}
console.log(`\n【OK】${okList.length} 处（stdin 已显式 ignore/inherit）`);

console.log(`\n【临时脚本（_*，非项目组成）】${tempD.length} 处未处理 —— 不阻断，但不静默：`);
for (const r of tempD) console.log(`  · ${r.rel}:${r.line}`);
console.log('  （反证类 `_counterproof-*` **不算**临时脚本，上面按必须修列出）');

console.log('\n=== 例外表自检 ===');
if (stale.length) {
  console.log('  ❌ 陈旧例外（登记了但调用点已不存在）：' + stale.join(', '));
} else {
  console.log(`  ✅ 例外表无陈旧项（登记 ${Object.keys(EXCEPTIONS).length} 条）`);
}

/* 阻断项 = 非临时的 DANGEROUS + 未登记例外的 UNKNOWN + 陈旧例外 */
const badD = hardD;
const badU = unknown.filter((r) => !r.ex);
fail = badD.length + badU.length + stale.length;

console.log('\n====================================================================');
console.log(`结果：${fail === 0 ? '通过' : '不通过'} —— 未处理 ${badD.length} 处 DANGEROUS + ${badU.length} 处 UNKNOWN，陈旧例外 ${stale.length} 条`);
if (fail) {
  console.log('修法：给该调用加 `stdio: [\'ignore\', \'pipe\', \'pipe\']`（stdout/stderr 留 pipe 以便读输出）。');
}
process.exit(fail ? 1 : 0);
