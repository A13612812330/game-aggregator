/* 反证：把 v10.74「首页榜单前 5 名轮播 + 13 个展示位 + 本地库补位」的十四个打坏点逐个打坏，
 *        tools/test-v1074-rank-carousel.js 的**对应断言必须变红**。
 *
 * 为什么必须做：断言全绿也可能是**假绿** —— 判据写歪、或根本没走到被守护的分支，照样打印 ✅。
 *   判据只有一个：把被守护的行为**故意打坏**，对应断言必须变红。
 *   ★★ v10.73 的反证实测照出「4 条假绿 + 1 个真 bug」—— 那不是意外，是这一步的常态。
 *
 * ★★ v10.75 对**第 ②③④⑥⑧⑫** 六个锚点的更新（其余 8 个原样可用）：
 *   ②③⑥⑧ 失效原因都是**被守护的代码本身换了写法**（去重补了 `jidiUrl`、补位条目加了 `coverQ`、
 *     封面判据改成 `(g.url || g.jidiUrl)`、服务端变量从 `mapped` 改名 `fused`）；
 *   ④ 是**守点换了**（整条热度展示被删，改为负向守卫「不许加回来」）；
 *   ⑫ 是列数口径从 5→4 变成 4→3。
 *   ⇒ 反证套件**不是一次写好就永久有效**：它绑的是「源码当前长什么样」，
 *     所以每次改被守护的代码，**必须重跑靶子预检**（本文件开头就拦这个）。
 *
 * 十四个打坏点各代表一族：
 *   ① 补位函数整体瘫痪（不补了）—— 首页后半截直接空着，这是本版最核心的承诺
 *   ② ★★ 去重只按 url（机地 topic 页 vs XD 游戏页是**同款不同 url**）⇒ 首页同款占两个位
 *   ③ 补位条目不带 `filled` 标记 ⇒ 前端无从区分，只能照常显示
 *   ④ ★★ 把热度数字加回来 —— 融合后两源口径不同（XD 给「热度」、机地给「分」），
 *      相加或挑一个都是**编数据**；本轮已删，此点专防「下轮顺手加回来」
 *   ⑤ 工具条目（运行库 / 检测工具）不过滤 ⇒ 全站榜第 1 名那条又回来了
 *   ⑥ 不要求封面 ⇒ 首页出现首字色块卡
 *   ⑦ 不按 hot 降序 ⇒ 补进来的不是最热的那几条
 *   ⑧ ★ 服务端漏接补位（模块 import 了但没调）⇒ 「写好了」与「生效了」是两件事
 *   ⑨ ★★ `cleanPlate` 里写死的 `slice(0, 10)` 加回来
 *      （它从来没生效过，却是与「首页展示数」**各自写死的第二个数**，改一个忘一个就静默砍数据）
 *   ⑩ ★★ 重渲前不调 `rkCarStop()` —— 旧 interval 继续推已销毁的 DOM，
 *      用户感知是「点一下跳两格」（本版最容易踩的坑）
 *   ⑪ ★★ 轮播可见性类从 `.cur` 改回 `.on` —— 与 `rankMark()` 撞车，
 *      打开任意详情会把**所有** slide 一起点亮
 *   ⑫ 卡片列数退回 4 列（「卡片放大」的主要来源就是列从 4 减到 3）
 *   ⑬ ★ 派生页漏重建（单源派生没同步）—— 本项目最高频坑 #1
 *   ⑭ ★★ 移动端写死轮播高度 —— `height` 压过 `aspect-ratio`，最窄一档又开始裁图；
 *      **390 视口测不出来**（282÷2.14 恰好 = 132），是「实拍全绿而防线红」的那一类
 *
 * ★ 纪律（与 v1071 / v1072 / v1073 一致）：
 *   · 每个坏点**独立**打坏 → 跑 → 还原，互不干扰；
 *   · 打坏前先断言「锚点真的被改动了」（没改动 = 靶子没了 = 反证会假过）；
 *   · 期望变红哪条**必须精确到断言**，不能只看「红了几条」；
 *   · 全部还原后必须复跑一次全绿，否则「还原」本身可能是假的。
 *
 * ★★ 铁律 113：本文件**绝不许与别的反证套件并发跑**（它们改的正是被断言的源文件）。
 *   ⚠️⚠️ 另加一条本轮实测的教训，比铁律 113 更宽：**也不许在浏览器层全量跑的时候跑** ——
 *     本反证会改 `public/index.html`，而 8123 常驻服务是**按请求现读磁盘**的
 *     ⇒ 浏览器套件会加载到被故意打坏的页面，那一轮全量会凭空多出一堆红。
 *     反证是「改仓库的排他操作」：**先确认没有别的实测在跑，再动**。
 *
 * 跑法：node tools/test-v1074-rank-carousel-counterproof.js     ← 单独跑，不要并行
 *       （**不进 SUITES**：它的期望是「红」，混进汇总会把条数搅乱）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SUITE = path.join(__dirname, 'test-v1074-rank-carousel.js');

/* ★ 取汇总的判据必须与套件当前的收尾格式一致 ——「通过 n / m（失败 f）」。
 *   （v10.71 改过格式，v1071 的反证因为没跟着改而**整步失效**，v10.72 才发现。） */
const SUM_ANY = /通过 \d+ \/ \d+（失败 \d+）/;
const SUM_ALL_GREEN = /^通过 (\d+) \/ (\d+)（失败 0）$/;

/** 跑一次套件，返回它打印的全部输出 */
function runSuite() {
  try {
    return execFileSync(process.execPath, [SUITE],
      /* ★ 铁律 38：stdio 显式写全（前置闸 check-stdio-guard.js 会扫这行） */
      { encoding: 'utf8', timeout: 240000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    return String(e.stdout || '') + String(e.stderr || '');
  }
}

const CASES = [
  {
    label: '① 补位函数整体瘫痪（源站不够 13 条也不补了）',
    file: 'data/rank-fill.js',
    break: (s) => s.replace('  const srcN = base.length;\n  if (srcN >= target) return { list: base, filled: 0, srcN };',
      '  const srcN = base.length;\n  return { list: base, filled: 0, srcN };   /* 反证：补位瘫痪 */\n  if (srcN >= target) return { list: base, filled: 0, srcN };'),
    need: ['A1'],
  },
  {
    label: '② ★★ 去重只按 url（同款不同 url 会被补进来，首页同一款占两个位）',
    file: 'data/rank-fill.js',
    /* ⚠️ 必须连 `&&` 一起删：只删判据那行会留下悬空运算符 ⇒ **语法错误**，
     *   整套会以「级联崩溃」的形式变红，看着像反证通过了，其实什么都没验到。 */
    break: (s) => s.replace("        !seenUrl.has(g.url) &&\n        !seenUrl.has(g.jidiUrl) &&\n        !seenTitle.has(String(g.title || '').trim())",
      '        !seenUrl.has(g.url) &&\n        !seenUrl.has(g.jidiUrl)'),
    need: ['A4'],
  },
  {
    label: '③ 补位条目不带 `filled` 标记（前端无从区分源站榜与补位）',
    file: 'data/rank-fill.js',
    break: (s) => s.replace('out.push({ ...g, rank: out.length + 1, filled: true, coverQ: coverScore(g.cover) });',
      'out.push({ ...g, rank: out.length + 1, coverQ: coverScore(g.cover) });   /* 反证：不带 filled */'),
    need: ['A3'],
  },
  {
    label: '④ ★★ 卡片把热度数字加回来（负向守卫：融合后两源口径不同，不许编一个「综合热度」）',
    file: 'public/index.html',
    /* ★★ v10.75 换了打坏方式：v10.74 是「补位条目照常显示 🔥 热度」，而本轮**整条热度展示被删掉**
       （两源数值口径不同，相加或挑一个都是编数据）⇒ 打坏点改成「把它加回来」，
       对应的守卫是 D13（负向：rankCard / rkSlideHtml 两段都不许出现 🔥 与 fmtHot）。 */
    break: (s) => s.replace('<div class="s">${g0 ? `<span class="tag">',
      '<div class="s">${"🔥 "}${g0 ? `<span class="tag">'),
    need: ['D13'],
  },
  {
    label: '⑤ 工具条目不过滤（全站榜第 1 名「XDGAME游戏运行库检测工具」会回来）',
    file: 'data/rank-fill.js',
    break: (s) => s.replace('        !TOOL_RE.test(g.title || \'\') &&', '        true &&   /* 反证：工具条目不过滤 */'),
    need: ['A5'],
  },
  {
    label: '⑥ 不要求封面（首页会出现首字色块卡）',
    file: 'data/rank-fill.js',
    break: (s) => s.replace('        g.cover &&\n        (g.url || g.jidiUrl) &&', '        (g.url || g.jidiUrl) &&'),
    need: ['A6'],
  },
  {
    label: '⑦ 不按 hot 降序（补进来的不是最热的那几条）',
    file: 'data/rank-fill.js',
    break: (s) => s.replace('.sort((a, b) => (Number(b.hot) || 0) - (Number(a.hot) || 0));',
      '.sort((a, b) => (Number(a.hot) || 0) - (Number(b.hot) || 0));   /* 反证：升序 */'),
    need: ['A7'],
  },
  {
    label: '⑧ ★ 服务端漏接补位（模块 import 了但没调 —— 「写好了」不等于「生效了」）',
    file: 'server.js',
    break: (s) => s.replace('      const f = rankFill.fillRank(fused, dbAll);',
      '      const f = { list: fused.slice(0, rankFill.RANK_SHOW_N), filled: 0, srcN: 0 };   /* 反证：漏接补位 */'),
    need: ['B2'],
  },
  {
    label: '⑨ ★★ cleanPlate 里写死的 `slice(0, 10)` 加回来（与「首页展示数」各自写死的第二个数）',
    file: 'fetchers/xdrank.js',
    break: (s) => s.replace('const capped = Number(max) > 0 ? clean.slice(0, Number(max)) : clean;',
      'const capped = clean.slice(0, 10);   /* 反证：写死的 10 又回来了 */'),
    need: ['C4c'],
  },
  {
    label: '⑩ ★★ 重渲前不调 rkCarStop()（旧 interval 推已销毁的 DOM ⇒ 用户感知「点一下跳两格」）',
    file: 'public/index.html',
    /* ★★ 锚点必须容忍 **CRLF**：`public/*.html` 是全 CRLF（实测 7951 个 CRLF / 7951 个 LF，
       即全是成对的），而本文件用 `\n` 写多行锚点时**一条都不会命中**。
       ⇒ 这类「锚点没命中」会被下面的靶子预检拦住（本轮实测就被拦了一次），
         但拦住的代价是整轮反证白跑 —— 所以多行锚点一律用 `\r?\n`，别赌换行符。 */
    break: (s) => s.replace(/  rkCarStop\(\);\r?\n  const list = rankCache\[rankPeriod\] \|\| \[\];/,
      '  const list = rankCache[rankPeriod] || [];   /* 反证：重渲前没停 */'),
    need: ['D7'],
  },
  {
    label: '⑪ ★★ 轮播可见性类从 `.cur` 改回 `.on`（与 rankMark 撞车 ⇒ 打开详情全部张一起亮）',
    file: 'public/index.html',
    break: (s) => s.replace('.rk-car .slide.cur{opacity:1;z-index:2}',
      '.rk-car .slide.on{opacity:1;z-index:2}   /* 反证：占用 .on */'),
    need: ['D4', 'D5'],
  },
  {
    label: '⑫ 卡片列数退回 4 列（3 列才是 v10.75「卡片放大」的来源：列越少每列越宽）',
    file: 'public/index.html',
    break: (s) => s.replace('.rk-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}',
      '.rk-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}   /* 反证：退回 4 列 */'),
    need: ['D10'],
  },
  {
    label: '⑭ ★★ 移动端写死轮播高度（height 会连宽度一起扭曲，且可能溢出父容器）',
    file: 'public/index.html',
    /* ★ 这个打坏点对应 v10.75 **真抓到的问题**：`@media(max-width:420px)` 里 v10.74 留下的
       `.rk-car{height:132px}`。实测反证（390 视口动态注入 height）：
         无 height → 350×164（撑满）｜132px → **282×132**（宽被反算）｜200px → **428×200**（溢出父容器 350）
       ⇒ `aspect-ratio` + 确定 `height` 时 `width:auto` 由 height×ratio 推出，**不撑满父容器**。
       ⚠️ 390 视口下两组比例都恰好 = 2.14 ⇒ **单看比例判据照不出来**，只有守源码才拦得住。
       它是「实拍全绿而防线红」的那一类，必须留在反证里。 */
    break: (s) => s.replace('.rk-car{margin-bottom:9px}',
      '.rk-car{height:132px;margin-bottom:9px}   /* 反证：移动端写死高度 */'),
    need: ['D17b'],
  },
  {
    label: '⑬ ★ 派生页漏重建（单源派生没同步 —— 本项目最高频坑 #1）',
    file: 'public/emulator.html',
    break: (s) => s.replace('function rkCarouselHtml(list) {', '/* 反证：派生页漏重建，轮播函数没了 */'),
    need: ['E1'],
  },
];

/* ============ 断言 id 契约（把「need 写歪」变成机器能拦的事） ============
 * ★ 本文件不照抄断言全名（名字里有 ·/→/引号，抄一次就漂一次），改用**断言 id**
 *   （A1 / C4c / D13 …）匹配 —— 但 id 有「A1 会误配 A10」这类前缀陷阱，
 *   所以 ① 匹配时要求 `id + 空格` 边界；② 先验证每个 id 在套件里**唯一存在**。 */
const suiteSrc = fs.readFileSync(SUITE, 'utf8');
const IDS = [...suiteSrc.matchAll(/chk\('([A-Za-z0-9]+) /g)].map((m) => m[1]);
const idCount = new Map();
for (const x of IDS) idCount.set(x, (idCount.get(x) || 0) + 1);
function hit(fails, id) { return fails.some((l) => l === id || l.startsWith(id + ' ')); }

/* ============ 备份（一次全备，任何情况下都要还原） ============ */
const files = [...new Set(CASES.map((c) => c.file))];
const backups = new Map();
for (const f of files) backups.set(f, fs.readFileSync(path.join(ROOT, f), 'utf8'));
function restoreAll() {
  for (const [f, s] of backups) fs.writeFileSync(path.join(ROOT, f), s);
}

let bad = 0;
try {
  console.log('断言 id 契约检查（need 写歪 / 指向不存在的断言 = 反证会假过）\n' + '─'.repeat(74));
  for (const c of CASES) {
    for (const id of c.need) {
      const n = idCount.get(id) || 0;
      const ok = n === 1;
      if (!ok) bad++;
      console.log((ok ? '  ✅ ' : '  ❌ ') + c.label.split('（')[0].split(' ')[0] + '  need ' + id
        + (ok ? '' : '  —— 在套件里出现 ' + n + ' 次（必须恰好 1 次）'));
    }
  }
  if (bad) { console.log('\n❌ 断言 id 契约不过 —— 先修本文件。'); process.exit(1); }

  console.log('\n靶子存在性预检（锚点对不上 = 反证会假过，必须先拦住）\n' + '─'.repeat(74));
  for (const c of CASES) {
    const orig = backups.get(c.file);
    const broken = c.break(orig);
    const ok = broken !== orig;
    console.log((ok ? '  ✅ ' : '  ❌ ') + c.label.split('（')[0].split(' ')[0] + '  锚点' + (ok ? '命中' : '**没命中**'));
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

    /* ★★ 判据要**精确到断言**：只数「红了几条」会把「级联崩溃」当成通过。 */
    const missed = c.need.filter((id) => !hit(fails, id));
    if (missed.length) {
      console.log('   ❌ 反证不充分 —— 这些断言打坏后**没变红**（假绿）：');
      missed.forEach((m) => console.log('      ' + m));
      if (fails.length) console.log('      实际变红的：' + fails.map((l) => l.split(' ')[0]).join(' '));
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
