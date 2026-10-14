/* 反证：把 v10.71 解压助手的九个打坏点逐个打坏，
 *        tools/test-v1071-extract.js 的**对应断言必须变红**。
 *
 * 为什么必须做（本项目纪律，也是这一版最该做的一件事）：
 *   断言全绿也可能是**假绿** —— 护栏写歪、或根本没走到被守护的分支，照样打印 ✅。
 *   本轮就真出过一次反面教材：`sniff()` 因为把 hex 字符串长度当字节长度用，
 *   对**所有**压缩包都返回 null，整套解压逻辑静默退化成「不是压缩包，跳过」，
 *   而当时「纯文本不该误判」那条断言**是绿的**（因为什么都认不出来）。
 *   ⇒ 判据只有一个：把被守护的行为**故意打坏**，对应断言必须变红。
 *
 * 九个打坏点各代表一族：
 *   ① 单源派生漏重建（删派生页的 initEx 调用）—— 本项目最高频坑 #1
 *   ② ★ 用大段新路由替换掉 404 兜底 —— 本轮**真实发生过**的事故形态
 *   ③ 语法闸门被掏空（编译改成直接 return）—— 本轮真实事故的另一半
 *   ④ 只给新页接闸门、构建器漏接 —— 「加了一处忘了另一处」族
 *   ⑤ ★ .cmd 用 %1 而不是 %* —— 静默少干活族（拖 3 个只处理 1 个且不报错）
 *   ⑥ CLI 丢掉 --pw 解析 —— 功能截肢族（加密包永远解不了）
 *   ⑦ 报告不提示加密包 —— 用户拿不到「填密码重跑」那条出路
 *   ⑧ 渲染层假设字段齐 —— 一个分组缺字段就把整份报告带崩
 *   ⑨ favicon 丢掉 —— 每页控制台挂 404 族
 *
 * ★ 纪律：
 *   · 每个坏点**独立**打坏 → 跑 → 还原，互不干扰；
 *   · 打坏前先断言「锚点真的被改动了」（没改动 = 靶子没了 = 反证会假过）；
 *   · 期望变红哪条**必须精确到断言名**，不能只看「红了几条」——
 *     红的是别的地方（级联崩溃）不算数；
 *   · 全部还原后必须复跑一次全绿，否则「还原」本身可能是假的。
 *
 * 跑法：node tools/test-v1071-extract-counterproof.js
 *       （不进 SUITES：它们的期望是「红」，混进汇总会把条数搅乱）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SUITE = path.join(__dirname, 'test-v1071-extract.js');

/* ★★ v10.72 修：这里的取汇总正则原本写死成旧格式「通过 n / 失败 f」。
 *   v10.71 把各套件的收尾统一改成「通过 n/m（失败 f）」（★ 斜杠后是**总数**，
 *   不是失败数 —— 见 run-all 取成绩段的约定），于是这个正则**恒不匹配**：
 *     · 「变红 N 条」旁边永远只显示 (无汇总)，人看不出套件到底跑成什么样；
 *     · 更要命的是最后那步「全部还原后必须复跑全绿」—— 判据变成看一个
 *       **永远匹配不到**的字符串，等于这一步的守护**整个消失了**（本轮实测：
 *       反证明明已经在报「❌ 反证失败 1 项」，全量防线却报 3995/0 全绿）。
 *   ⇒ 判据必须跟着产物格式一起改。这类「判据的作用域/形状变了但没人跟着改」
 *     是本项目最贵的一类坑（PITFALLS 105）。 */
const SUM_ANY = /通过 \d+ \/ \d+（失败 \d+）/;
const SUM_ALL_GREEN = /^通过 (\d+) \/ (\d+)（失败 0）$/;

/** 跑一次套件，返回它打印的全部输出 */
function runSuite() {
  try {
    return execFileSync(process.execPath, [SUITE],
      /* ★ 铁律 38：stdio 显式写全（前置闸 check-stdio-guard.js 会扫这行） */
      { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    return String(e.stdout || '') + String(e.stderr || '');
  }
}

const CASES = [
  {
    label: '① 单源派生漏重建：删掉派生页的 initEx() 首屏调用',
    file: 'public/extract.html',
    break: (s) => s.replace(/\ninitEx\(\);/, '\n/* initEx();  ← 被反证删掉 */'),
    need: ['A10 ★ 页面脚本末句就是 initEx();（首屏真的会跑，不是只写在注释里）'],
  },
  {
    label: '② ★ 404 兜底被新路由段顶掉（本轮真实事故的形态）',
    file: 'server.js',
    break: (s) => s.replace(/app\.use\(\(_req, res\) => res\.status\(404\)\.json\(\{ ok: false, error: 'Not Found' \}\)\);/, '/* 404 兜底被反证删掉 */'),
    need: ['B8 404 兜底仍在（app.use + 404 + Not Found）'],
  },
  {
    label: '③ ★ 语法闸门被掏空（编译改成直接 return）',
    file: 'tools/page-assets.js',
    break: (s) => s.replace('function assertScriptSyntax(html, what) {\n  const vm = require(\'vm\');',
      'function assertScriptSyntax(html, what) {\n  return 0;   /* 被反证掏空 */\n  const vm = require(\'vm\');'),
    need: ['C3 ★ 反证 1：`{ 7z: 1 }` 这种未加引号的数字键会变红'],
  },
  {
    label: '④ 只给新页接闸门、构建器漏接（「加一处忘另一处」族）',
    file: 'tools/build-extract-page.js',
    break: (s) => s.replace("A.assertScriptSyntax(out, 'extract.html');",
      "/* A.assertScriptSyntax(out, 'extract.html');  ← 被反证注释掉 */"),
    need: ['C6 build-extract-page.js 落盘前调了语法闸门'],
  },
  {
    label: '⑤ ★ .cmd 用 %1 而不是 %*（拖 3 个只处理 1 个，且不报错）',
    file: '解压助手-拖放.cmd',
    break: (s) => s.replace('"tools\\extract-cli.js" %*', '"tools\\extract-cli.js" %1'),
    need: ['D3 .cmd 用 %* 传全部拖放参数（不是 %1）'],
  },
  {
    label: '⑥ CLI 丢掉 --pw 解析（加密包永远解不了）',
    file: 'tools/extract-cli.js',
    break: (s) => s.replace("else if (a.startsWith('--pw=')) o.passwords.push(a.slice(5));",
      "/* --pw 解析被反证删掉 */"),
    need: ['E3 接受可重复的 --pw='],
  },
  {
    label: '⑦ 报告不提示加密包（用户拿不到「填密码重跑」那条出路）',
    file: 'tools/extract-report.js',
    break: (s) => s.replace('if (rep.needPassword.length) {', 'if (false) {'),
    need: ['F4 待解密区块出现且带重跑命令与复制按钮'],
  },
  {
    label: '⑧ 渲染层假设字段齐（一个分组缺字段就把整份报告带崩）',
    file: 'tools/extract-report.js',
    break: (s) => s.replace(/\n  rep = rep \|\| \{\};[\s\S]*?rep\.stats = rep\.stats \|\| \{\};/, '\n  /* 入参归一被反证删掉 */'),
    need: ['F16 分组缺 failures/needsPassword 时不崩（渲染层不假设采集层字段齐）'],
  },
  {
    label: '⑨ favicon 丢掉（浏览器自动请求 /favicon.ico ⇒ 每页控制台一条 404）',
    file: 'public/index.html',
    break: (s) => s.replace(/<link rel="icon" href="data:image\/svg\+xml,[^"]*">/, '<!-- favicon 被反证删掉 -->'),
    need: ['G · public/index.html 有 rel="icon"'],
  },
];

/* ============ 备份（一次全备，任何情况下都要还原） ============ */
const files = [...new Set(CASES.map((c) => c.file))];
const backups = new Map();
for (const f of files) backups.set(f, fs.readFileSync(path.join(ROOT, f), 'utf8'));
function restoreAll() {
  for (const [f, s] of backups) fs.writeFileSync(path.join(ROOT, f), s);
}

let bad = 0;
try {
  console.log('靶子存在性预检（锚点对不上 = 反证会假过，必须先拦住）\n' + '─'.repeat(74));
  for (const c of CASES) {
    const orig = backups.get(c.file);
    const broken = c.break(orig);
    const ok = broken !== orig;
    console.log((ok ? '  ✅ ' : '  ❌ ') + c.label.split('：')[0] + '  锚点' + (ok ? '命中' : '**没命中**'));
    if (!ok) bad++;
  }
  if (bad) { console.log('\n❌ 有 ' + bad + ' 个打坏点锚点失效 —— 先修本文件，再谈反证。'); process.exit(1); }

  for (const c of CASES) {
    const p = path.join(ROOT, c.file);
    const orig = backups.get(c.file);
    console.log('\n▶ ' + c.label);
    let out = '';
    try {
      fs.writeFileSync(p, c.break(orig));
      out = runSuite();
    } finally {
      fs.writeFileSync(p, orig);
    }
    /* 本套件的失败行是 `  ❌ 名字   extra` */
    const fails = out.split('\n')
      .filter((l) => l.indexOf('❌') >= 0)
      .map((l) => l.replace(/^\s*❌\s*/, '').trim());
    const sum = (out.match(SUM_ANY) || ['(无汇总)'])[0];
    console.log('   ' + sum + '   变红 ' + fails.length + ' 条');

    /* ★★ 判据要**精确到断言名**：只数「红了几条」会把「级联崩溃」当成通过。
     *   比如把整个文件改坏，套件在 require 阶段就炸，输出里一条 ❌ 都没有 ——
     *   它看起来「什么都没红」，而不是「打坏生效了」。
     *   所以期望变红的那条必须点名，且用 startsWith 精确匹配（行尾可能带 extra 信息）。 */
    const missed = c.need.filter((n) => !fails.some((l) => l.startsWith(n)));
    if (missed.length) {
      console.log('   ❌ 反证不充分 —— 这些断言打坏后**没变红**（假绿）：');
      missed.forEach((m) => console.log('      ' + m));
      bad++;
    } else {
      console.log('   ✅ 期望的断言已变红：' + c.need.join(' + '));
    }
  }
} finally {
  /* ★ 无论中途抛什么，都要还原 —— 反证工具把仓库改坏是最不能接受的失败方式 */
  restoreAll();
}

/* 还原后必须复跑一次全绿，否则「还原」本身可能是假的 */
console.log('\n◀ 全部还原后复跑');
const out2 = runSuite();
const sum2 = (out2.match(SUM_ANY) || ['(无汇总)'])[0];
console.log('   ' + sum2);
if (!SUM_ALL_GREEN.exec(sum2)) {
  console.log('   ❌ 还原后未全绿 —— 说明还原不干净（或有别的改动漏进去了）');
  bad++;
} else {
  console.log('   ✅ 还原干净');
}

if (bad) { console.log('\n❌ 反证失败 ' + bad + ' 项'); process.exit(1); }
console.log('\n✅ 反证成立：' + CASES.length + ' 个打坏点各自对应的断言都变红，零假绿。');
