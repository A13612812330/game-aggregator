/* tools/test-shared-destructure.js — 守「从 shared 解构」的完整性
 *
 * 为什么要有这一套：
 *   2026-09-21 实测机地同步与机地源搜索连续 6 天抛 `normDate is not defined`，
 *   根因是 `fetchers/jidi.js` 的解构列表漏了 `normDate`（shared.js 早就导出了它）。
 *   这类缺陷的共同特征：
 *     · 报错只在**运行到那一行**时才出现（静态语法检查全绿）
 *     · 一行修复即可，但「有没有别处也漏了」只能靠人肉扫 → 于是没人扫，连续 6 天没人修
 *   ⇒ 需要一个**枚举驱动**的检查：导出清单从 shared.js 源码求值（不是手抄），
 *     对每个引用 shared 的文件逐个比对「用了但没解构」。
 *
 * ★ 判据来源（避免手写清单漏项）：
 *   导出成员 = `shared.js` 里 `module.exports = {...}` 块的实际内容（源码求值）。
 *   新增导出会自动纳入检查范围，不需要改本文件。
 *
 * ★ 运行：node tools/test-shared-destructure.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function chk(name, ok, extra) {
  if (ok) { pass++; console.log('  ✅ ' + name + (extra ? '  — ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  — ' + extra : '')); }
}

/* ---------- ① 从 shared.js 源码求值导出清单（不手抄）---------- */
const sharedSrc = fs.readFileSync(path.join(ROOT, 'shared.js'), 'utf8');
const expBlock = sharedSrc.match(/module\.exports\s*=\s*\{([\s\S]*?)\};/);
const EXPORTS = expBlock
  ? expBlock[1].split(/[,\n]/).map((s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, '').trim())
      .filter((s) => /^[A-Za-z_$][\w$]*$/.test(s))
  : [];

console.log('=== ① 导出清单（源码求值自 shared.js）===');
console.log('    ' + EXPORTS.join(' / ') + '   （共 ' + EXPORTS.length + ' 个）');
chk('导出清单求值成功（>0，否则下面的比对是空转）', EXPORTS.length > 0, EXPORTS.length + ' 个');

/* 函数型成员：使用形态是 `名称(`；常量型成员：使用形态是裸名 */
const FUNC_LIKE = new Set(['getHtml', 'abs', 'normDate', 'ts2label', 'fmtDateTime', 'dateTs', 'extractLinks']);

/* ---------- ② 收集所有引用 shared 的文件 ---------- */
const SKIP_DIRS = new Set(['node_modules', '.git', '_preview', '_deprecated', 'public', 'data-fill']);
function walk(dir, depth, out) {
  if (depth > 3) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    /* 反证脚本的临时副本目录 `_cf134/` `_cf135/` …（逐个点名必然遗忘，用模式） */
    if (/^_cf\d*$/.test(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, depth + 1, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
const files = walk(ROOT, 0, []);
const sharedUsers = files.filter((f) => /require\(\s*['"][^'"]*\/?shared['"]\s*\)/.test(fs.readFileSync(f, 'utf8')));
console.log('\n=== ② 引用 shared 的文件 ===');
sharedUsers.forEach((f) => console.log('    ' + path.relative(ROOT, f)));
chk('引用 shared 的文件数 ≥ 5（少了说明扫描范围塌了）', sharedUsers.length >= 5, sharedUsers.length + ' 个');

/* ---------- ③ 逐文件比对：用了但没解构 ---------- */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

console.log('\n=== ③ 逐文件「用了但没解构」比对 ===');
let missingTotal = 0;
for (const f of sharedUsers) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  const raw = fs.readFileSync(f, 'utf8');
  const body = stripComments(raw);

  /* 解构形态：const { a, b } = require('...shared')   （允许跨行）
     整体命名空间形态：const shared = require(...) 或 require(...).xxx —— 这两种不算遗漏 */
  const nsForm = /(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*['"][^'"]*\/?shared['"]\s*\)/.test(body)
    || /require\(\s*['"][^'"]*\/?shared['"]\s*\)\s*\./.test(body);

  const allDestructured = [];
  let m;
  /* ★ 解构内容用 `[^}]*`（不是 `[\s\S]*?`）：后者会**跨行吞并**，
   *   把下一个 require 的解构内容并进来 —— 实测 `data/gamesDb.js` 因此被误判
   *   「缺 dateTs」（它的 `{ dateTs }` 被并进了上一条 `require('./cover-url')` 的匹配里），
   *   `fetchers/jidiModify.js` 更把函数参数解构也混进了列表。
   *   解构列表里不会出现 `}`，所以 `[^}]*` 既准确又允许跨行写法。 */
  const reD = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*['"][^'"]*\/?shared['"]\s*\)/g;
  while ((m = reD.exec(body))) {
    m[1].split(',').forEach((x) => {
      const n = x.split(':').pop().replace(/\/\*[\s\S]*?\*\//g, '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(n)) allDestructured.push(n);
    });
  }
  const hasDestructure = allDestructured.length > 0;

  const missing = [];
  if (!nsForm) {
    for (const name of EXPORTS) {
      if (allDestructured.includes(name)) continue;
      const re = FUNC_LIKE.has(name)
        ? new RegExp('(?<![\\w$.])' + name + '\\s*\\(')
        : new RegExp('(?<![\\w$.])' + name + '(?![\\w$])');
      if (re.test(body)) {
        /* 再排一次误报：若该名字在本文件里有自己的定义（function x / const x =），不算 shared 的 */
        const ownRe = new RegExp('(?:function\\s+' + name + '\\b|(?:const|let|var)\\s+' + name + '\\s*=)');
        if (!ownRe.test(body)) missing.push(name);
      }
    }
  }

  if (!hasDestructure && !nsForm) {
    console.log('    ' + rel.padEnd(28) + '  (无解构 / 无命名空间，跳过)');
    continue;
  }
  if (missing.length === 0) {
    console.log('    ' + rel.padEnd(28) + '  ✔ ' + (allDestructured.length ? '解构 ' + allDestructured.join(',') : '命名空间形态'));
  } else {
    missingTotal += missing.length;
    console.log('    ' + rel.padEnd(28) + '  ✘ 缺失: ' + missing.join(', ') + '  （已解构: ' + (allDestructured.join(',') || '—') + '）');
  }
}

chk('★ 没有任何文件「用了 shared 成员却没解构」', missingTotal === 0, missingTotal === 0 ? '0 处' : missingTotal + ' 处');

/* ---------- ④ 定点回归：机地那三处必须真的解构到 normDate ---------- */
console.log('\n=== ④ 定点回归（本次故障点）===');
const jidi = stripComments(fs.readFileSync(path.join(ROOT, 'fetchers/jidi.js'), 'utf8'));
const jidiDes = [];
let m2;
const reJ = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*['"][^'"]*\/?shared['"]\s*\)/g;
while ((m2 = reJ.exec(jidi))) m2[1].split(',').forEach((x) => jidiDes.push(x.trim()));
chk('★★ fetchers/jidi.js 解构里有 normDate（连续 6 天故障的直接原因）', jidiDes.includes('normDate'), jidiDes.join(','));
chk('★ fetchers/jidi.js 仍在调用 normDate（否则这条判据是空转）', /(?<![\w$.])normDate\s*\(/.test(jidi));

/* 同一族：jidiHeadless / jidiTopics 也必须齐（它们是同类文件，容易一起漏） */
for (const rel of ['fetchers/jidiHeadless.js', 'fetchers/jidiTopics.js']) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) { console.log('    (跳过不存在的 ' + rel + ')'); continue; }
  const s = stripComments(fs.readFileSync(p, 'utf8'));
  const des = [];
  let m3;
  const reX = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*['"][^'"]*\/?shared['"]\s*\)/g;
  while ((m3 = reX.exec(s))) m3[1].split(',').forEach((x) => des.push(x.trim()));
  const usesNorm = /(?<![\w$.])normDate\s*\(/.test(s);
  chk(rel + '：若调用 normDate 则必须解构到', !usesNorm || des.includes('normDate'),
    usesNorm ? '调用 ✔ 解构 ' + (des.includes('normDate') ? '✔' : '✘') : '未调用（无需）');
}

/* ---------- ⑤ 泛化：**所有**共享模块都要守，而不只是 shared.js ----------
 *
 * ★ v10.36 为什么补这一段：新建 `data/name-normalize.js`（跨源归一化的唯一真源）后，
 *   同一类缺陷**立刻复现**：`data/phonecfg.js` 里解构漏了 `numMismatchByTitle`，
 *   报错是 `ReferenceError: numMismatchByTitle is not defined`，
 *   而且**只在跑到那一行才抛** —— 全量防线只报一句「异常退出：test-alias-guard.js (exit 1)」，
 *   连一条 FAIL 行都没有（与「断言没抓住」长得一模一样，见反证技能的记录）。
 *   根因是本套件**把 shared.js 写死了**。
 *
 * ★ 发现规则**不手写**（手写清单一定会漏，且漏了看不出来）：
 *   扫全仓，把「被 ≥2 个不同文件用**解构**方式 require 的模块」自动认定为共享模块。
 *   新增共享模块无需改本文件；只是把某个模块私有化（引用数降到 1）也会自动退出检查。
 */
function modKey(fromFile, spec) {
  if (!spec.startsWith('.')) return null;                 // 只查仓内相对引用
  const p = path.resolve(path.dirname(fromFile), spec);
  for (const cand of [p, p + '.js', path.join(p, 'index.js')]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

const desUsers = new Map();   // 模块绝对路径 → Set<引用它的文件>
for (const f of files) {
  const body = stripComments(fs.readFileSync(f, 'utf8'));
  const re = /(?:const|let|var)\s*\{[^}]*\}\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m4;
  while ((m4 = re.exec(body))) {
    const t = modKey(f, m4[1]);
    if (!t) continue;
    if (!desUsers.has(t)) desUsers.set(t, new Set());
    desUsers.get(t).add(f);
  }
}

console.log('\n=== ⑤ 自动发现：被 ≥2 个文件解构引用的模块 ===');
const SHARED_TARGETS = [...desUsers.entries()]
  .filter(([, s]) => s.size >= 2)
  .map(([mod, s]) => ({ mod, users: [...s] }))
  .sort((a, b) => b.users.length - a.users.length);
SHARED_TARGETS.forEach((t) => console.log('    ' + path.relative(ROOT, t.mod).replace(/\\/g, '/')
  + '   ← ' + t.users.length + ' 个文件'));
chk('自动发现到 ≥2 个共享模块（0 个说明扫描塌了，本段是空转）', SHARED_TARGETS.length >= 2, SHARED_TARGETS.length + ' 个');
/* ★ 定点回归：v10.36 新建的这个模块必须在检查范围内 —— 否则本段等于没修 */
chk('★ data/name-normalize.js 已被自动纳入检查（v10.36 的漏网点）',
  SHARED_TARGETS.some((t) => t.mod.endsWith('name-normalize.js')));

let missing2 = 0;
for (const { mod, users } of SHARED_TARGETS) {
  const relMod = path.relative(ROOT, mod).replace(/\\/g, '/');
  const src = stripComments(fs.readFileSync(mod, 'utf8'));
  const blk = src.match(/module\.exports\s*=\s*\{([\s\S]*?)\};/);
  if (!blk) { console.log('    ' + relMod + '：module.exports 无法源码求值 ⇒ 跳过（请改成对象字面量）'); continue; }
  const exps = blk[1].split(/[,\n]/)
    .map((s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, '').trim())
    .filter((s) => /^[A-Za-z_$][\w$]*$/.test(s));
  /* 函数型直接从**源码**认（不手写清单）：`function x` / `const x = (…) =>` / `const x = function`
   *  ⇒ 调用形态是 `x(`；常量型用裸名匹配。 */
  const isFunc = (n) => new RegExp('(?:function\\s+' + n + '\\b|(?:const|let|var)\\s+' + n
    + '\\s*=\\s*(?:async\\s*)?(?:function\\b|\\())').test(src);

  for (const f of users) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    const body = stripComments(fs.readFileSync(f, 'utf8'));
    const nsForm = new RegExp('(?:const|let|var)\\s+\\w+\\s*=\\s*require\\(\\s*[\'"][^\'"]*'
      + relMod.split('/').pop().replace('.js', '') + '[\'"]\\s*\\)').test(body);
    const got = [];
    const reD = new RegExp('(?:const|let|var)\\s*\\{([^}]*)\\}\\s*=\\s*require\\(\\s*[\'"][^\'"]*'
      + relMod.split('/').pop().replace('.js', '') + '[\'"]\\s*\\)', 'g');
    let m5;
    while ((m5 = reD.exec(body))) {
      m5[1].split(',').forEach((x) => {
        const n = x.split(':').pop().replace(/\/\*[\s\S]*?\*\//g, '').trim();
        if (/^[A-Za-z_$][\w$]*$/.test(n)) got.push(n);
      });
    }
    if (nsForm && !got.length) continue;
    const miss = [];
    for (const n of exps) {
      if (got.includes(n)) continue;
      const re = isFunc(n) ? new RegExp('(?<![\\w$.])' + n + '\\s*\\(') : new RegExp('(?<![\\w$.])' + n + '(?![\\w$])');
      if (!re.test(body)) continue;
      if (new RegExp('(?:function\\s+' + n + '\\b|(?:const|let|var)\\s+' + n + '\\s*=)').test(body)) continue;
      miss.push(n);
    }
    if (miss.length) {
      missing2 += miss.length;
      console.log('    ✘ ' + relMod + ' ← ' + rel.padEnd(24) + ' 缺失: ' + miss.join(', ')
        + '  （已解构: ' + (got.join(',') || '—') + '）');
    }
  }
}
chk('★ 没有任何文件「用了共享模块成员却没解构」（全部共享模块）', missing2 === 0, missing2 === 0 ? '0 处' : missing2 + ' 处');

console.log('\n通过 ' + pass + '/' + (pass + fail) + '（失败 ' + fail + '）');
/* ★ 写法必须是 `process.exit(fail ? 1 : 0)` 这一种 —— `run-all.js` 的 `exitTiedToFailures()`
 *   用正则认「标识符紧跟 `?`」的形式。首版写成 `fail === 0 ? 0 : 1` 语义相同却认不出，
 *   总闸会报「退出码不随失败变」（反证时红绿不分 = 这套件的护栏等于没有）。 */
process.exit(fail ? 1 : 0);
