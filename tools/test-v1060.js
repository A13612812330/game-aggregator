#!/usr/bin/env node
/* tools/test-v1060.js —— v10.60 防线：**同款归并键只有一份实现**（服务端下发，前端只消费）
 *
 * ★ 本轮修的是用户 2026-10-12 截图报的现场：搜索联想里
 *   「古惑狼™ 4：时机已到」（机地）与「古惑狼4：时机已到」（XDGAME）**各占一行**，
 *   而它们是同一款 —— 只差一个商标号 `™` 与一个空格。
 *
 * ★ 根因不是「没做归一化」，而是**归一化被写了第四份**：
 *   `data/name-normalize.js` 早在 v10.36 就把 `™®©` 收进了 `SYMBOLS`，
 *   而前端 `smKeyOf()` 里那份是自写的（`toLowerCase().replace(/\s+/g,'')`，
 *   只去空白、**不剥任何符号**）。同 `tools/test-twin.js` 那条
 *   「★ 前端不再自带 sameGame（同一语义只留后端一份）」是同一条规矩。
 *
 * ★★ 本套件最要紧的一组是 **A4 / B4**：归并键用的是**窄类** `GROUP_DECOR`，
 *    **不能**拿匹配用的宽类 `SYMBOLS`。这不是洁癖 —— 实测宽类会新并 20 组，
 *    其中 **2 组是假并**（续作被并进前作 / 两款同名不同英译的游戏并成一行）。
 *    归并**没有第二道闸门**（键相等就直接并成一行，界面上看不出错），
 *    所以必须窄；而匹配那道有 `sameGame` 包含护栏 + `numMismatchByTitle` 数字闸兜着。
 *    ⇒ A4 钉「宽类是窄类的**超集**」（防后人把窄类改宽或把宽类塞给归并使用）。
 *
 * 分组：
 *   A 真源：窄类 `GROUP_DECOR` / `decorKey`     D 前端只消费（四页）
 *   B `twin.groupKey`（zh 段 + 窄类）           E 机制与元断言
 *   C 服务端三处下发 `nkey`
 *
 * 跑法：node tools/test-v1060.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const PAGES = ['index.html', 'emulator.html', 'resources.html', 'unpack.html'];
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const readPub = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');
const has = (p) => fs.existsSync(path.join(ROOT, p));

/** 剥注释（同 v10.57/v10.58 套件的实现，逐字一致；行注释要排除 URL 里的 `//`） */
function stripComments(s) {
  return String(s)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
/** 取某个函数声明的**函数体**（从 `function 名(` 起到下一个行首 `}`）——
 *  用来断言「这个函数体里没有/有某样东西」，比全文匹配精确得多。 */
function bodyOf(src, name) {
  const i = src.indexOf('function ' + name);
  if (i < 0) return '';
  const j = src.indexOf('\n}', i);
  return j < 0 ? src.slice(i) : src.slice(i, j);
}

let pass = 0, fail = 0;
const t = (ok, name, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`); };
const sec = (s) => console.log('\n── ' + s + ' ──');

const nn = require('../data/name-normalize');
const twin = require('../data/twin');

/* ============================ A 真源 ============================ */
sec('A 真源 `data/name-normalize.js`：宽窄两族必须分家');

t(typeof nn.GROUP_DECOR === 'object' && nn.GROUP_DECOR instanceof RegExp, '导出 `GROUP_DECOR`（正则）');
t(typeof nn.decorKey === 'function', '导出 `decorKey`（窄类归一化）');

/* A1 —— 用户报的那一类：商标号 */
t(nn.decorKey('古惑狼™ 4：时机已到') === nn.decorKey('古惑狼4：时机已到'),
  '★ A1 剥商标号 `™`：古惑狼两种写法键相等',
  JSON.stringify([nn.decorKey('古惑狼™ 4：时机已到'), nn.decorKey('古惑狼4：时机已到')]));
t(nn.decorKey('Train Sim World® 7') === 'trainsimworld7', 'A1 `®` 也剥', nn.decorKey('Train Sim World® 7'));
t(nn.decorKey('Game©') === 'game', 'A1 `©` 也剥');

/* A2 —— 书名号 / 引号包裹（机地话题标题的外层装饰） */
t(nn.decorKey('《NBA 2K27》') === nn.decorKey('NBA 2K27'), '★ A2 剥书名号：`《NBA 2K27》` ≡ `NBA 2K27`');
t(nn.decorKey('「巫师3」') === nn.decorKey('巫师3'), 'A2 剥 `「」`');
t(nn.decorKey('【测试】X') === nn.decorKey('测试X'), 'A2 剥 `【】`');

/* A3 —— 中点分隔 */
t(nn.decorKey('真・三国无双') === nn.decorKey('真三国无双'), 'A3 剥中点 `・`');
t(nn.decorKey('A·B') === nn.decorKey('AB'), 'A3 剥中点 `·`');

/* A3b —— 空白（含全角空格） */
t(nn.decorKey('古惑狼 4') === nn.decorKey('古惑狼　4'), 'A3b 半角/全角空白等价');
t(nn.decorKey('  X  ') === 'x', 'A3b 首尾空白与大小写归并');

/* ★★ A4 —— 窄类必须**保留**实义分隔符（防后人加宽） */
t(nn.decorKey('A：B') !== nn.decorKey('AB'), '★★ A4 保留 `：`（加宽就会假并 —— 见文件头实测账）');
t(nn.decorKey('A！B') !== nn.decorKey('AB'), '★★ A4 保留 `！`');
t(nn.decorKey('A-B') !== nn.decorKey('AB'), '★★ A4 保留 `-`');
t(nn.decorKey('A—B') !== nn.decorKey('AB'), '★★ A4 保留 `—`');
t(nn.decorKey('A～B') !== nn.decorKey('AB'), '★★ A4 保留 `～`');

/* ★★ A4b —— 元断言：有闸门的那族（SYMBOLS）必须是没闸门那族（GROUP_DECOR）的**超集** */
(function () {
  const wide = '™®©°′″·・:：,，.。!！?？\'"“”‘’()（）[]【】<>《》|｜/\\~～-–—_+*&#@$%^;；＊';
  const narrow = '™®©《》〈〉「」『』【】·・•';
  const wideSet = new Set(wide);
  const missing = [...narrow].filter((c) => !wideSet.has(c) && c !== '〈' && c !== '〉' && c !== '「' && c !== '」' && c !== '『' && c !== '』' && c !== '•');
  t(missing.length === 0, '★★ A4b 窄类里的字符**都在**宽类 `SYMBOLS` 里（有闸门的那族必须更宽）',
    missing.length ? '缺：' + missing.join('') : '');
  /* 逐条用真源核验（不是读注释 —— 注释可以写错） */
  const inWide = (c) => new RegExp('[\\u' + c.codePointAt(0).toString(16).padStart(4, '0') + ']').test(nn.SYMBOLS.source) ||
    nn.SYMBOLS.test(c);
  t(inWide('™') && inWide('®') && inWide('©'), '★★ A4b 商标号确实在 `SYMBOLS` 里（v10.36 就在）');
  t(nn.SYMBOLS.test('：') && !nn.GROUP_DECOR.test('：'), '★★ A4b `：` 只在宽类、不在窄类（两族确实不同）');
})();

/* A5 —— 异常输入不炸、不给 `undefined` */
t(nn.decorKey(null) === '' && nn.decorKey(undefined) === '' && nn.decorKey(123..toString()) === '123',
  'A5 `null`/`undefined` → 空串，数字转字符串');

/* ============================ B twin.groupKey ============================ */
sec('B `twin.groupKey`：zh 段 + 窄类（归并键的唯一算法）');

t(typeof twin.groupKey === 'function', '导出 `groupKey`');
t(twin.groupKey('古惑狼4：时机已到/Crash Bandicoot 4 : It\'s About Time')
  === twin.groupKey('古惑狼™ 4：时机已到/Crash Bandicoot™ 4: It\'s About Time'),
  '★ B1 用户现场两条 → 同键', twin.groupKey('古惑狼™ 4：时机已到/X'));
t(twin.groupKey('NBA 2K27') === twin.groupKey('《NBA 2K27》'), 'B1 书名号两条 → 同键');

/* B2 —— 只用 zh 段：英文段不同也照样归并 */
t(twin.groupKey('艾尔登法环/A') === twin.groupKey('艾尔登法环/B'), 'B2 只看 zh 段（英文段不同也算同款）');

/* B3 —— 沿用「第一个 / 之前」的既有语义（v10.25 定的） */
t(twin.groupKey('艾尔登法环 黑夜君临/ELDEN RING NIGHTREIGN') !== twin.groupKey('艾尔登法环/ELDEN RING'),
  '★ B3 系列另一款不并（`黑夜君临` 是另一款）');

/* ★★ B4 —— 防假并（宽类会在这里翻车，逐条钉死） */
t(twin.groupKey('空中骑士：永不屈服/X') !== twin.groupKey('空中骑士永不屈服/X'),
  '★★ B4 续作不被并进前作（`空中骑士：永不屈服` ≠ `空中骑士永不屈服`）');
t(twin.groupKey('他们来了/It Reaches') !== twin.groupKey('他们来了！/They Are Coming!'),
  '★★ B4 同名不同英译不被并（`他们来了` ≠ `他们来了！`）');

/* B5 —— 不给空键（空键会把所有条目并成一行） */
t(twin.groupKey('') === '' && twin.groupKey(null) === '', 'B5 空输入 → 空键（由调用方决定不挂）');

/* ============================ C 服务端下发 ============================ */
sec('C 服务端：六处喂 `smRows` 的接口都下发 `nkey`');

const SRV = read('server.js');
const SRVC = stripComments(SRV);

/* ★ v10.61：本段随 `withNKey`（单条）→ `withNKeys`（整批）同步。
 *   为什么必须改批量的理由见 `data/twin.js` 的 `groupKeys` 注释：AppID 相同是条目
 *   **之间的关系**，单条算不出来。这里只跟着改「谁在下发」，键的算法由 test-v1061 守。 */
(function () {
  const b = bodyOf(SRVC, 'withNKeys');
  t(!!b, 'C1 定义 `withNKeys()`');
  t(/twin\.groupKeys\(/.test(b), 'C1 用真源 `twin.groupKeys()`（不自写算法）');
  t(/keys\[i\] \? Object\.assign\([^)]*nkey/.test(b), '★ C1 键为空时**不挂**字段（空键会让所有条目并成一行）');
})();

/* ★★ v10.62：两条**都必须把作用域收窄到各自的路由段**。
 *   155 原先钉 `/api/library` 的内层必须是 `withBh` —— v10.62 把它换成了 `withRes`
 *   （联想面板要带资源计数）⇒ 字面串失配、**真红**（本轮 `run-all` 就是它红的）。
 *   而 156 用的是**全文件**正则，恰好两处串长得几乎一样
 *   ⇒ 一旦有人把 `/api/library` 打回 `withBh`，156 会**替它变绿**（`_counterproof-v1062.js` 坏法 A 实测）。
 *   ⇒ 155 改判**意图**（联想的 items 过了 `withNKeys`，不钉内层函数名）；两条都收窄作用域。 */
const LIB_SECT = (SRVC.split("app.get('/api/library', ")[1] || '').split('app.get(')[0];
const ALL_SECT = (SRVC.split("app.get('/api/search/all', ")[1] || '').split("app.get('")[0];
t(/withNKeys\(r\.items\.map\(/.test(LIB_SECT), 'C2 `/api/library`（联想）挂了 `nkey`');
t(/items: withNKeys\(r\.items\.map\(withRes\)\)/.test(ALL_SECT), 'C2 `/api/search/all` 端游桶挂了 `nkey`（且仍是 `withRes`）');
t(/items: withNKeys\(xdR\.value\)/.test(SRVC), 'C3 `/api/search` 源站实时搜索挂了 `nkey`（XDGAME）');
t(/items: withNKeys\(jiR\.value\)/.test(SRVC), 'C3 `/api/search` headless 分支挂了 `nkey`（机地）');
t(/items: withNKeys\(jidiR\.value\.matched\)/.test(SRVC), 'C3 `/api/search` 普通分支挂了 `nkey`（机地）');
t((SRVC.match(/items: withNKeys\(/g) || []).length === 6, 'C3 全站**恰好 6 处**挂（联想 1 + 端游桶 1 + 实时源站 2 分支 × 2 源）',
  '实测 ' + (SRVC.match(/items: withNKeys\(/g) || []).length + ' 处');
/* ★★ C4 反向守卫：不许再有**单条版**。单条算键 = 算不出「两边 AppID 相同」，
 *   实测会反而把用户当晚刚修好的古惑狼那组拆开（一边有 appid、一边没有）。 */
t(!/function withNKey\b|\.map\(withNKey\)/.test(SRVC), '★★ C4 没有残留的单条版 `withNKey`（走回逐条算会漏掉 AppID 那一半）');

/* ============================ D 前端 ============================ */
sec('D 前端四页：只消费下发的键，不再自写归一化');

t(PAGES.every((f) => /it\.nkey/.test(readPub(f))), 'D1 四页 `smKeyOf` 都读 `it.nkey`');
t(PAGES.every((f) => /if \(it && it\.nkey\) return it\.nkey;/.test(readPub(f))), 'D1 四页都是「有键就用」（同一条判断）');

(function () {
  /* ★★ 本组最要紧：函数体里**不许**再出现商标号等归并用的符号类 */
  const bad = [];
  for (const f of PAGES) {
    const b = bodyOf(readPub(f), 'smKeyOf');
    if (/[\u2122\u00ae\u00a9]/.test(b)) bad.push(f + ':商标号');
    if (/《》|GROUP_DECOR|SYMBOLS/.test(b)) bad.push(f + ':归并符号类');
  }
  t(bad.length === 0, '★★ D2 `smKeyOf` 函数体内**没有**任何归并符号类（不再自写第五份）', bad.join(' '));
})();

(function () {
  /* ★ 反向：兜底还在（不是把旧键整个删了 —— 取不到 nkey 时宁可少并，也不能全并成一行） */
  const b = bodyOf(readPub('index.html'), 'smKeyOf');
  t(/splitName\(it\.title\)\.zh/.test(b), '★ D3 兜底仍是「zh 段 + 去空白」（不是新抄一份符号类）');
  t(/'~' \+/.test(b), '★ D3 兜底键带 `~` 前缀（与真键隔离，避免撞车）');
})();

t(/function smGroup\(/.test(readPub('index.html')), 'D4 `smGroup` 仍在（归并逻辑没被删）');
t(PAGES.every((f) => /function smGroup\(/.test(readPub(f))), 'D4 四页都有 `smGroup`');

/* ============================ E 机制与元断言 ============================ */
sec('E 机制与元断言');

(function () {
  const ra = read('tools/run-all.js');
  t(/test-v1060\.js/.test(ra), '★ E1 本套件已登记进 run-all 的 `SUITES`（不登记就等于没跑）');
  t(has('tools/_counterproof-v1060-nkey.js'), 'E2 反证脚本在位');
  t(has('tools/_probe-sugmerge-live.js'), 'E2 实拍探针在位');
  /* ★ 元断言：真源不许被「顺手合并」回一份 —— 窄类/宽类两个常量都必须在 */
  const nns = read('data/name-normalize.js');
  t(/const SYMBOLS =/.test(nns) && /const GROUP_DECOR =/.test(nns), '★ E3 两族字符类都在真源里（没被合并成一份）');
  t(/decorKey/.test(read('data/twin.js')), 'E3 `twin.js` 从真源取 `decorKey`（不是自写）');
})();

console.log('\n' + (fail === 0 ? '='.repeat(28) : '='.repeat(28)));
console.log(`  v10.60 防线：${pass} / ${pass + fail} 通过${fail ? '（失败 ' + fail + '）' : ''}`);
console.log('='.repeat(28) + '\n');
/* ★ 退出码必须挂在失败数上（否则单独跑时红绿不分，反证也验不了）——
   `tools/run-all.js` 的 exitTiedToFailures() 认这个写法。 */
if (fail) process.exitCode = 1;
