/* 反证：把 v10.72「下载按钮 → 自动解压」的打坏点逐个打坏，
 *        tools/test-v1072-download.js 的**对应断言必须变红**。
 *
 * 为什么必须做：断言全绿也可能是**假绿** —— 护栏写歪、或根本没走到被守护的分支，
 * 照样打印 ✅。判据只有一个：把被守护的行为**故意打坏**，对应断言必须变红。
 *
 * 十个打坏点各代表一族：
 *   ① 单源派生漏重建（派生页没拿到新函数）—— 本项目最高频坑 #1
 *   ② ★ 浮层 DOM 写进主源 HTML —— 会踩 page-assets.js 记着的
 *      「主源有、派生页没有 ⇒ addEventListener of null 中断整段脚本」那个坑
 *   ③ CSS 的 `[hidden]` 兜底被删 —— 作者样式 display:flex 会顶掉 hidden 属性
 *   ④ ★ 属性生成器的「仅本机」判断被放宽 —— 线上点了会解在云端容器里（最难发现的假成功）
 *   ⑤ ★ 产物路径样式被删 —— 用户看不到「东西解到哪了」
 *   ⑥ ★★ 提前止损退化成「下完再说」—— 本版的核心承诺，去掉一个 break 就能退化
 *   ⑦ ★★ 小文件（<512B）的 HTML 补判被拿掉 —— 小错误页会被当文件照存下来
 *   ⑧ 魔数判据写歪（startsWith → ===）—— hex 字符串长度是字节数的两倍，必错
 *   ⑨ ★ sniff 不再走 sniffBuffer（单一真源被切断）—— 两份判据开始各自漂移
 *   ⑩ open 的目录护栏被注释掉 —— 变成「打开本机任意目录」的洞
 *
 * ★ v10.73 对本文件的改造（2026-10-14）：①⑤⑥⑦ 四个锚点随语义升级失效
 *   （`exdBtn` 改名 `exdAttr`、`.exd-go` 换成 `.exd-path`、bail 文案改了、
 *   `expectArchive` 删除）。**必须跟着改锚点**，否则「靶子存在性预检」会直接拦住 ——
 *   这条预检就是专门为「反证静默失效」设的（v10.71 出过：格式改了没跟，整步失效）。
 *
 * ★ 纪律：
 *   · 每个坏点**独立**打坏 → 跑 → 还原，互不干扰；
 *   · 打坏前先断言「锚点真的被改动了」（没改动 = 靶子没了 = 反证会假过）；
 *   · 期望变红哪条**必须精确到断言名**，不能只看「红了几条」；
 *   · 全部还原后必须复跑一次全绿，否则「还原」本身可能是假的。
 *
 * 跑法：node tools/test-v1072-download-counterproof.js
 *       （**不进 SUITES**：它的期望是「红」，混进汇总会把条数搅乱）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SUITE = path.join(__dirname, 'test-v1072-download.js');

/* ★ 取汇总的判据必须与套件当前的收尾格式一致 ——「通过 n/m（失败 f）」。
 *   （v10.71 改过格式，v1071 的反证就因为没跟着改而**整步失效**，本轮才发现。） */
const SUM_ANY = /通过 \d+ \/ \d+（失败 \d+）/;
const SUM_ALL_GREEN = /^通过 (\d+) \/ (\d+)（失败 0）$/;

/** 跑一次套件，返回它打印的全部输出 */
function runSuite() {
  try {
    return execFileSync(process.execPath, [SUITE],
      /* ★ 铁律 38：stdio 显式写全（前置闸 check-stdio-guard.js 会扫这行） */
      { encoding: 'utf8', timeout: 180000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    return String(e.stdout || '') + String(e.stderr || '');
  }
}

const CASES = [
  {
    label: '① 单源派生漏重建：派生页没拿到 exdAttr（改主源忘了重建）',
    file: 'public/unpack.html',
    break: (s) => s.replace('function exdAttr(url, game, cat) {', '/* 派生页漏重建：exdAttr 不见了 */'),
    need: ['P1 ★ 五页都有 exdAttr 函数（v10.73：由 exdBtn 改成属性串生成器）'],
  },
  {
    label: '② ★ 浮层 DOM 被写进主源 HTML（会中断派生页整段脚本）',
    file: 'public/index.html',
    break: (s) => s.replace('<body>', '<body>\n<div id="exDock" hidden></div>'),
    need: ['P7 ★★ 主源 HTML 里**没有** id="exDock" 标签（浮层必须由 JS 现创建）'],
  },
  {
    label: '③ CSS 的 [hidden] 兜底被删（display:flex 会顶掉 hidden 属性）',
    file: 'public/index.html',
    break: (s) => s.replace(/\n\s*\.exd-pw\[hidden\]\{display:none\}/, ''),
    need: ['P4 五页都保留了 .exd-pw[hidden]（否则 hidden 会被 display:flex 顶掉）'],
  },
  {
    label: '④ ★ 属性生成器的「仅本机」判断被放宽（线上也会渲染）',
    file: 'public/index.html',
    break: (s) => s.replace("if (!url || !exdLocal()) return '';", "if (!url) return '';"),
    need: ["P9 按钮只在**本机**渲染（非 localhost 返回空串）"],
  },
  {
    label: '⑤ ★ 产物路径样式被删（用户看不到「东西解到哪了」）',
    file: 'public/index.html',
    break: (s) => s.replace(/\n\s*\.exd-path\{[^}]*\}/, ''),
    need: ['P3 ★ 五页都有「产物路径」样式 .exd-path（v10.73 新增，替掉 .exd-go）'],
  },
  {
    label: '⑥ ★★ 提前止损退化成「下完再说」（去掉 HTML 那处的 break）',
    file: 'data/extractor.js',
    break: (s) => s.replace(
      "        early = bail('返回的是 HTML 页面而不是文件（网盘页 / 需要登录的中间页 / 错误页）', { notArchive: true, head: 'html' });\n        break;",
      "        early = bail('返回的是 HTML 页面而不是文件（网盘页 / 需要登录的中间页 / 错误页）', { notArchive: true, head: 'html' });\n        /* break 被反证删掉 —— 退化成「下完再说」 */"),
    need: ['E8b ★★ 服务端观察到我们**提前断开**（是止损，不是下完再说）'],
  },
  {
    label: '⑦ ★★ 小文件（<512B）的 HTML 补判被拿掉 —— 小错误页会被当文件照存下来',
    file: 'data/extractor.js',
    break: (s) => s.replace(
      "      const v = judge(true);\n      if (v && v.kind === 'html') {",
      "      const v = judge(true);\n      if (v && v.kind === 'htmlx') {"),
    need: ['E2 小 HTML → notArchive + 不落盘'],
  },
  {
    label: '⑧ 魔数判据写歪（hex.startsWith → hex ===，长度差两倍必错）',
    file: 'data/extractor.js',
    break: (s) => s.replace('if (hex.startsWith(sig)) return m.fmt;', 'if (hex === sig) return m.fmt;'),
    need: ['S1 ★ 阳性对照 zip', 'S2 ★ 阳性对照 rar', 'S3 ★ 阳性对照 7z'],
  },
  {
    label: '⑨ ★ sniff 不再走 sniffBuffer（单一真源被切断）',
    file: 'data/extractor.js',
    break: (s) => s.replace('    return sniffBuffer(buf.slice(0, n));',
      '    return null;   /* 单一真源被反证切断 */\n    /* eslint-disable no-unreachable */'),
    need: ['M1 ★ 两条路结果一致（zip）'],
  },
  {
    label: '⑩ open 的目录护栏被注释掉（会变成「打开本机任意目录」的洞）',
    file: 'server.js',
    break: (s) => s.replace(
      "    return res.status(400).json({ ok: false, error: '只允许打开解压目录内的路径：' + root });",
      "    /* 护栏被反证注释掉 */"),
    need: ['V5 ★ open 的护栏：必须落在 DEFAULT_DEST 之内（判据带 return，防被注释骗）'],
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

    /* ★★ 判据要**精确到断言名**：只数「红了几条」会把「级联崩溃」当成通过。 */
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
console.log('\n✅ 反证全部通过：' + CASES.length + '/' + CASES.length +
  ' 打坏点都让预期的断言变红了，且还原后复跑全绿。');
