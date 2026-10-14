/* 反证：把 v10.73「一个按钮走完下载 + 自动解压」的十二个打坏点逐个打坏，
 *        tools/test-v1073-download.js 的**对应断言必须变红**。
 *
 * 为什么必须做：断言全绿也可能是**假绿** —— 护栏写歪、或根本没走到被守护的分支，
 * 照样打印 ✅。判据只有一个：把被守护的行为**故意打坏**，对应断言必须变红。
 *
 * 十二个打坏点各代表一族：
 *   ① 单源派生漏重建（派生页没拿到新函数）—— 本项目最高频坑 #1
 *   ② ★★ 路径段清洗被整体放宽 —— 一个叫 `..\..\Windows` 的游戏名就能写出落点之外
 *   ③ ★ 清洗不再抹 `..` —— 段里残留可上跳的路径段
 *   ④ ★★ 二次边界校验写成不带分隔符的前缀比较 —— `…\GameHub-evil` 会被骗过
 *   ⑤ ★★ `downloadTo` 一进门就建目录 —— 「网页地址也留空目录」那个 bug 的原形
 *   ⑥ ★★ 历史留档从 `finally` 里挪走 —— 必然有出口能绕过它
 *   ⑦ ★ 历史按 id 覆盖退化成无脑追加 —— 填密码续跑会让同一次出现两条
 *   ⑧ ★ 历史改成顺序返回 —— 用户要找的「刚才那次」沉到列表最底下
 *   ⑨ ★ exSnapshot 不再带 dir —— 前端「复制路径 / 打开文件夹」拿到空值
 *   ⑩ ★ 拼接后的收口被删 —— 段为空就留下 `_`，文件夹名变难看
 *   ⑪ ★★ 保留设备名逃逸被删 —— `{game:con}` 的目录名就是 `con`，Windows 建不出来
 *   ⑫ ★ 属性生成器的「仅本机」判断被放宽 —— 线上点了会解在云端容器里
 *
 * ★ 纪律：
 *   · 每个坏点**独立**打坏 → 跑 → 还原，互不干扰；
 *   · 打坏前先断言「锚点真的被改动了」（没改动 = 靶子没了 = 反证会假过）；
 *   · 期望变红哪条**必须精确到断言名**，不能只看「红了几条」；
 *   · 全部还原后必须复跑一次全绿，否则「还原」本身可能是假的。
 *
 * ★★ 铁律 113：本文件**绝不许与别的反证套件并发跑**！
 *   它们改的正是被断言的源文件，两个实例同时跑会撞出 `EPERM errno -4048`，
 *   而症状看着像「权限/锁/代码 bug」—— 误导性极强（v10.73 实测踩过）。
 *
 * 跑法：node tools/test-v1073-download-counterproof.js     ← 单独跑，不要并行
 *       （**不进 SUITES**：它的期望是「红」，混进汇总会把条数搅乱）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SUITE = path.join(__dirname, 'test-v1073-download.js');

/* ★ 取汇总的判据必须与套件当前的收尾格式一致 ——「通过 n/m（失败 f）」。
 *   （v10.71 改过格式，v1071 的反证因为没跟着改而**整步失效**，后来才发现。） */
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
    file: 'public/extract.html',
    break: (s) => s.replace('function exdAttr(url, game, cat) {', '/* 派生页漏重建：exdAttr 不见了 */'),
    need: ['P1 ★ 五页都还有 exdAttr（本版把它挂到已有 <a> 上）'],
  },
  {
    label: '② ★★ 路径段清洗被整体放宽（分隔符与 `..` 都不拦 ⇒ 爬出落点外）',
    file: 'data/extractor.js',
    /* ⚠️ 必须**两条一起**打坏才是「真的能爬出去」—— 只放宽分隔符的话，
     *   紧接着的 `\.{2,}` 会把 `..` 变成 `_`，`_\_\_\Windows` 仍然落在根内，
     *   连 E1 都照不出来（首版就是这么写的，反证自己报了「反证不充分」）。 */
    break: (s) => s.replace("v = v.replace(/[\\\\/:*?\"<>|]/g, '_');", "v = v.replace(/[:*?\"<>|]/g, '_');")
      .replace(/^ *v = v\.replace\(\/\\\.\{2,\}\/g, '_'\);.*$/m, ''),
    need: ['E1 ★★ 14 个恶意样本：清洗后**全部被接受**且都在根内（靠 taskDir 兜底拒绝不算过）',
      'E3 ★ 名字里不许出现任何路径分隔符（`\\` 与 `/` 都必须被换成 `_`）'],
  },
  {
    label: '③ ★ 清洗不再抹 `..`（段里残留可上跳的路径段）',
    file: 'data/extractor.js',
    /* 用带 `m` 的正则删整行，避免把缩进/行尾注释的空格数写死（写死了下轮改格式就静默失效） */
    break: (s) => s.replace(/^ *v = v\.replace\(\/\\\.\{2,\}\/g, '_'\);.*$/m, ''),
    need: ['E2 ★ 清洗后的段里不许残留 `..`（残留就是可上跳的路径段）'],
  },
  {
    label: '④ ★★ 二次边界校验写成不带分隔符的前缀比较（`…\\GameHub-evil` 会被骗过）',
    file: 'data/extractor.js',
    break: (s) => s.replace('if (!full.startsWith(root + path.sep)) {', 'if (!full.startsWith(root)) {'),
    need: ['T5 ★ 边界判据**必须带分隔符**（`root + path.sep`，否则 `…\\GameHub-evil` 会被前缀骗过）'],
  },
  {
    label: '⑤ ★★ downloadTo 一进门就建目录（「网页地址也留空目录」那个 bug 的原形）',
    file: 'data/extractor.js',
    break: (s) => s.replace('  const ctl = new AbortController();',
      "  fs.mkdirSync(destDir, { recursive: true });   /* 反证：退回「一进门就建」的旧写法 */\n  const ctl = new AbortController();"),
    need: ['T6 ★★ 负向守卫：`downloadTo` 里 `mkdirSync` 必须在**落盘前**（不许一进门就建）'],
  },
  {
    label: '⑥ ★★ 历史留档从 `finally` 里挪走（必然有出口能绕过它）',
    file: 'server.js',
    break: (s) => s.replace('      try { exHistoryPush(t); } catch (e) { /* 留档失败绝不许影响已完成的主产物 */ }',
      '      /* 反证：留档被挪出 finally */'),
    need: ['V3 ★★ `exHistoryPush` 在 `exRun` 的 **finally** 里 —— 保证没有一条出口能绕过它'],
  },
  {
    label: '⑦ ★ 历史按 id 覆盖退化成无脑追加（续跑会让同一次出现两条）',
    file: 'server.js',
    break: (s) => s.replace('  if (i >= 0) arr[i] = rec; else arr.push(rec);', '  arr.push(rec);   /* 反证：覆盖退化成追加 */'),
    need: ['V4 ★ 按 id **覆盖**而不是追加（填密码续跑会让同一次出现在历史里两条）'],
  },
  {
    label: '⑧ ★ 历史改成顺序返回（用户要找的「刚才那次」沉到最底下）',
    file: 'server.js',
    break: (s) => s.replace('    items: all.slice(-n).reverse(),', '    items: all.slice(-n),   /* 反证：忘了倒序 */'),
    need: ['V8 ★ 历史**倒序**返回（给人「找刚才那次」用，不是给机器读）'],
  },
  {
    label: '⑨ ★ exSnapshot 不再带 dir（前端「复制路径 / 打开文件夹」拿到空值）',
    file: 'server.js',
    break: (s) => s.replace('    dir: t.dir || t.params.dir || null,\n', ''),
    need: ['V10 ★★ exSnapshot 如实带出 dir / archive / game / cat'],
  },
  {
    label: '⑩ ★ 拼接后的收口被删（段自带的 `__` 与首尾 `_` 不再抹平）',
    file: 'data/extractor.js',
    break: (s) => s.replace("  name = name.replace(/_{2,}/g, '_').replace(/^_+|_+$/g, '');\n", ''),
    /* ⚠️ 期望必须指向 N3b / N3c，**不能指向 N3** —— N3 那三个样本的段本来就被
     *   `.filter(Boolean)` 挡掉了，收口删掉它们也照样绿（反证 ⑩ 首轮照出的假绿）。 */
    need: ['N3b ★ 段内的 `__` 被抹成 `_`（拼出来的名字不能带双下划线）',
      'N3c ★ 段自带的**首尾** `_` 被抹掉（`_x_` → `x`）'],
  },
  {
    label: '⑪ ★★ 保留设备名逃逸被删（`{game:con}` 得到的目录名就是 `con`，Windows 建不出来）',
    file: 'data/extractor.js',
    break: (s) => s.replace(
      "  if (/^(con|prn|aux|nul|com\\d|lpt\\d)(\\..*)?$/i.test(name)) name = '_' + name;\n", ''),
    need: ['N4b ★★ 整名就是保留设备名时必须转义（`{game:con}` → `_con`，不许还是 `con`）'],
  },
  {
    label: '⑫ ★ 属性生成器的「仅本机」判断被放宽（线上也会渲染）',
    file: 'public/index.html',
    break: (s) => s.replace("  if (!url || !exdLocal()) return '';", "  if (!url) return '';"),
    need: ['P14 ★ exdAttr 仍在「仅本机」闸内（线上点了会解在云端容器里）'],
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
