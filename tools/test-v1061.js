#!/usr/bin/env node
/**
 * tools/test-v1061.js —— v10.61 防线：**两级归并键**（名称键 ∪ AppID+闸门）
 *
 * 【本版修的是什么】
 *   用户 2026-10-12 截图（v10.60 修完古惑狼的**当晚**）：搜「三国无双」出两行 ——
 *   机地 `真・三国无双 起源` 与 XD `真三国无双：起源`，用户问「为什么会有区分开，这是同个游戏」。
 *   硬证据：两条的 **Steam AppID 都是 2384580**（机地自带 `appid` 字段；XD 的 cover 是
 *   `…/steam/apps/2384580/…`）。名称键兜不住是因为机地用「中点+空格」、XD 用「全角冒号」，
 *   而 `：` 被**刻意保留**在窄类里（v10.60 的假并账）。
 *
 * 【实测规模】全库 19,465 条：同 AppID 的跨源双条 **154 组**，其中 103 组名称键相等（会并）、
 *   **51 组不等**（显示两行）。本版新增合并 **86 组**（跨源 32 / 同源 54），
 *   分组数 18,368 → 18,282。
 *
 * 【本套件的写法原则】★ 尽量**不依赖会变的数据**
 *   —— `games.json` 每天预热会变（游戏名可能被源站改名、条数每天涨）。所以：
 *     · B/C 段用**构造样本**（不查库）⇒ 与数据无关；
 *     · D 段用**结构性断言**（对全库成立，与具体条数无关）⇒ 数据变了也仍应通过；
 *     · D6 只用**下界**（≥100 组）⇒ 数据变多不会假红。
 */

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const has = (p) => fs.existsSync(path.join(ROOT, p));
const twin = require('../data/twin');

let pass = 0, fail = 0;
const t = (ok, name, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`); };
const sec = (s) => console.log('\n── ' + s + ' ──');

/* ============================ A 真源 ============================ */
sec('A `data/twin.js` 新增的四个出口');

t(typeof twin.groupKeys === 'function', 'A0 导出 `groupKeys`（批量归并键）');
t(typeof twin.appIdOf === 'function' && typeof twin.isAltEdition === 'function' && typeof twin.mergeGate === 'function',
  'A0 导出 `appIdOf` / `isAltEdition` / `mergeGate`');

/* A1 appIdOf —— 两条来源（字段优先，cover 兜底） */
t(twin.appIdOf({ appid: 2384580 }) === '2384580', 'A1 自带 `appid` 字段优先（机地路径）');
t(twin.appIdOf({ cover: 'https://shared.cdn.queniuqe.com/store_item_assets/steam/apps/2384580/header.jpg?t=1' }) === '2384580',
  'A1 从 cover 的 `/steam/apps/<id>/` 提（XDGAME 路径）');
t(twin.appIdOf({ appid: '123', cover: 'https://x/steam/apps/999/y.jpg' }) === '123', 'A1 字段优先于 cover');
t(twin.appIdOf({ cover: 'https://www.xdgame.com/uploads/allimg/210831/a.jpg' }) === '',
  '★ A1 提不到就返回空串（**不是**猜一个）—— 这正是古惑狼那组 XD 侧的情形');
t(twin.appIdOf(null) === '' && twin.appIdOf({}) === '', 'A1 空输入 → 空串');

/* A2 isAltEdition —— 只测 zh 段 */
t(twin.isAltEdition('红色沙漠：增强版-虚拟机版/Crimson Desert Enhanced HYPERVISOR') === true,
  'A2 `虚拟机版` 在 zh 段 ⇒ true');
t(twin.isAltEdition('红色沙漠/Crimson Desert voices38') === false,
  '★ A2 `voices38` 在**英文段** ⇒ false（那是同一份发行的标记，不该拒绝合并）');
t(twin.isAltEdition('剑星/Stellar Blade HYPERVISOR') === false,
  '★ A2 只在英文段出现 HYPERVISOR ⇒ false（zh 段没写「虚拟机版」就不算 —— 实测 135 条里 127 条 zh 段有，另 8 条两段都有）');

/* A3 mergeGate —— 三条路径 + 短串护栏 */
t(twin.mergeGate('真・三国无双 起源', '真三国无双：起源/DYNASTY WARRIORS: ORIGINS') === true,
  '★ A3 路径①`matchScore`：用户现场两条 ⇒ true');
t(twin.mergeGate('Obenseuer', '奥本瑟尔/Obenseuer') === true,
  '★ A3 路径②四段交叉相等：机地整串当 zh 段、XD 拆两段 ⇒ 也 true（`matchScore` 算不出来这条）');
t(twin.mergeGate('赛菲莉娅/Sephiria', '-怀旧地下城-/UNDERGROUNDED') === false,
  '★★ A3 两条路径都不成立 ⇒ false（**cover 挂错**造成的假并就靠这条挡住）');
t(twin.mergeGate('AB', 'AB CD') === false,
  '★ A3 短串护栏：**包含**路径要求两边 ≥3 字（`AB` ⊂ `AB CD` 但长度不够 ⇒ 不认）');
t(twin.mergeGate('AB', 'AB') === true,
  'A3 完全相等照常认（无害：这种两条名称键本来就相同，走哪条路都并）');
t(twin.mergeGate('', 'x') === false && twin.mergeGate(null, null) === false, 'A3 空串 → false（不抛错）');

/* ============================ B 必须并 ============================ */
sec('B 现场两例必须并成一个键（构造样本，与库数据无关）');

(function () {
  const got = twin.groupKeys([
    { id: 'j', title: '真・三国无双 起源', appid: 2384580 },
    { id: 'x', title: '真三国无双：起源/DYNASTY WARRIORS: ORIGINS', cover: 'https://s/steam/apps/2384580/h.jpg' },
  ]);
  t(got.length === 2 && got[0] === got[1], '★ B1 用户报的组（AppID 2384580）→ 同键', JSON.stringify(got));
})();

(function () {
  /* ★★ 最要紧的一条：**不许回归**
     机地那条自带 appid、XD 那条 cover 是 xdgame.com 的图（提不到 AppID）。
     若键改成「单条算的 AppID 优先」，这里会分别得到 `app:1378990` 与 `古惑狼4：时机已到`
     —— 刚在 v10.60 修好的那组反而被拆回去。批量 + 并查集才两头都保住。 */
  const got = twin.groupKeys([
    { id: 'j', title: '古惑狼™ 4：时机已到/Crash Bandicoot™ 4: It’s About Time', appid: 1378990 },
    { id: 'x', title: '古惑狼4：时机已到/Crash Bandicoot 4 : It’s About Time', cover: 'https://www.xdgame.com/uploads/allimg/210831/a.jpg' },
  ]);
  t(got.length === 2 && got[0] === got[1], '★★ B2 古惑狼（一边有 AppID、一边没有）→ 仍同键（不许被拆回去）', JSON.stringify(got));
})();

/* ============================ C 必须不并 ============================ */
sec('C 假并守卫');

(function () {
  /* ★★ C1 实测记下的一个**真实机制**（写坏法时才发现，别当成常识）：
     虚拟机版不与本体并，其实有**两道保险**同时生效 ——
       ① `isAltEdition` 把它挡在 AppID 分组之外；
       ② 就算放进去了，`matchScore` 的「英文段一票否决」还会再挡一次：
          `Crimson Desert voices38` vs `Crimson Desert Enhanced HYPERVISOR`
          英文段互不匹配、而中文段只是包含（30 分 ≠ 100）⇒ `scoreOf` 直接 `return 0`。
     ⇒ 单独打坏 ① 不会让本条变红（② 兜住了）。所以 `_counterproof-v1061-appid.js`
       的坏法 B 必须**同时**打坏两处才验得动这条断言。 */
  const got = twin.groupKeys([
    { id: 'a', title: '红色沙漠/Crimson Desert voices38', appid: 3321460 },
    { id: 'b', title: '红色沙漠：增强版-虚拟机版/Crimson Desert Enhanced HYPERVISOR', cover: 'https://s/steam/apps/3321460/h.jpg' },
  ]);
  t(got[0] !== got[1], '★ C1 独立发行（虚拟机版）**不**并入本体（两道保险：`isAltEdition` + 英文段一票否决）', JSON.stringify(got));
})();

(function () {
  /* 实测（全库扫描）抓到 6 组这种：cover 挂了别的游戏的图 ⇒ 提取出错误 AppID。
     去掉名称闸门时它们会被并成一行 ⇒ 界面上完全看不出来。 */
  const pairs = [
    ['赛菲莉娅/Sephiria', '-怀旧地下城-/UNDERGROUNDED', 'a'],
    ['超级城市力量/Mega City Force', '巨城警察/Mega City Police', 'b'],
    ['超市模拟器/Supermarket Simulator', '杂货店模拟器/Grocery Store Simulator', 'c'],
    ['欧洲卡车模拟2/Euro Truck Simulator 2', '遨游中国2/中国卡车模拟/CTS6', 'd'],
  ];
  const bad = [];
  for (const [ta, tb] of pairs) {
    const got = twin.groupKeys([
      { id: 'x', title: ta, appid: 111 },
      { id: 'y', title: tb, cover: 'https://s/steam/apps/111/h.jpg' },
    ]);
    if (got[0] === got[1]) bad.push(ta + ' × ' + tb);
  }
  t(bad.length === 0, '★★ C2 AppID 相同但名称不像（=cover 挂错）⇒ 各自独立，4 组全不并', bad.join(' / '));
})();

/* ============================ D 全库结构性断言 ============================ */
sec('D 全库结构性断言（不依赖会变的条数）');

let G = [];
try { G = JSON.parse(read('data/games.json')); } catch (e) { G = []; }
t(Array.isArray(G) && G.length > 1000, 'D0 `data/games.json` 可读且规模正常', String(G.length) + ' 条');

(function () {
  const nk = twin.groupKeys(G);
  /* D1 零回归：名称键相同的任意两条 ⇒ 新键必相同（并查集只 union 不 split ⇒ 结构上必然） */
  const byOld = new Map();
  G.forEach((x, i) => { const k = twin.groupKey(x); if (!byOld.has(k)) byOld.set(k, []); byOld.get(k).push(i); });
  let reg = 0;
  for (const idxs of byOld.values()) {
    if (idxs.length < 2) continue;
    if (new Set(idxs.map((i) => nk[i])).size > 1) reg++;
  }
  t(reg === 0, '★★ D1 零回归：名称键相同的组**没有一组**被拆开', reg + ' 组');

  /* D2 组内连通：多条目组里，任意两条经有限步（名称键相同 ∨ mergeGate）可达 ——
     ★ 注意是**连通**不是「两两直连」：A—B—C 链条是合法的，两两直连会误判 A—C 无依据
     （实测踩到 3 对假红：`烤串大厨! 餐厅模拟器` — `烤肉串模拟器`，中间隔着
     一条名称键相同的条目，是**正确**的连通，不是假并）。 */
  const byNew = new Map();
  G.forEach((x, i) => { const k = nk[i]; if (!byNew.has(k)) byNew.set(k, []); byNew.get(k).push(x); });
  let broken = 0;
  const multi = [...byNew.values()].filter((v) => v.length > 1);
  for (const v of multi) {
    const seen = new Set([0]);
    const q = [0];
    while (q.length) {
      const i = q.shift();
      for (let j = 0; j < v.length; j++) {
        if (seen.has(j)) continue;
        if (twin.groupKey(v[i]) === twin.groupKey(v[j]) || twin.mergeGate(v[i].title, v[j].title)) {
          seen.add(j); q.push(j);
        }
      }
    }
    if (seen.size !== v.length) broken++;
  }
  t(broken === 0, '★★ D2 组内连通：没有一组含「无依据」的条目（实现没引入第三条 union 路径）',
    `${multi.length} 组多条目，${broken} 组不连通`);

  /* D3 空键护栏：键为空 ⇔ 标题为空（键空了会让前端把**所有**条目并成一行，比不并更糟） */
  const emptyKey = G.filter((x, i) => !nk[i]).length;
  const emptyTitle = G.filter((x) => !String(x.title || '').trim()).length;
  t(emptyKey === emptyTitle, '★ D3 只在标题为空时才有空键（不会有「有标题却给空键」的条目）',
    `空键 ${emptyKey} / 空标题 ${emptyTitle}`);

  /* D4 键与输入等长同序（前端按下标/顺序消费，错位会张冠李戴） */
  t(nk.length === G.length, 'D4 键数组与输入等长同序');
})();

(function () {
  /* D5/D6 真实数据的存在性（只用**下界**，条数每天涨也不会假红） */
  let cross = 0;
  const byApp = new Map();
  for (const x of G) {
    const a = twin.appIdOf(x);
    if (!a) continue;
    if (!byApp.has(a)) byApp.set(a, []);
    byApp.get(a).push(x);
  }
  for (const v of byApp.values()) {
    if (v.length > 1 && new Set(v.map((x) => x.source)).size > 1) cross++;
  }
  t(cross >= 100, '★ D5 库里确实存在大量「同 AppID 跨源双条」（下界 100 组）', cross + ' 组');
  t(byApp.size >= 15000, 'D6 AppID 覆盖率健康（下界 15,000 条能提到）', byApp.size + ' 条');
})();

/* ============================ E 服务端 ============================ */
sec('E 服务端：六处下发，且不留单条版');

function stripComments(s) {
  return String(s)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const SRVC = stripComments(read('server.js'));

t((SRVC.match(/items: withNKeys\(/g) || []).length === 6, '★ E1 六处都改批量下发（联想 1 + 端游桶 1 + 实时源站 2 分支 × 2 源）',
  '实测 ' + (SRVC.match(/items: withNKeys\(/g) || []).length + ' 处');
t(/twin\.groupKeys\(arr\)/.test(SRVC), 'E1 `withNKeys` 走真源 `twin.groupKeys()`（不自写算法）');
t(!/function withNKey\b|\.map\(withNKey\)/.test(SRVC), '★★ E2 没有残留的单条版 `withNKey`（逐条算会漏掉 AppID 那一半）');

/* ============================ F 元断言 ============================ */
sec('F 机制与元断言');

t(/test-v1061\.js/.test(read('tools/run-all.js')), '★ F1 本套件已登记进 run-all 的 `SUITES`（不登记就等于没跑）');
t(has('tools/_counterproof-v1061-appid.js'), 'F2 反证脚本在位');
(function () {
  const nn = read('data/name-normalize.js');
  t(/const SYMBOLS =/.test(nn) && /const GROUP_DECOR =/.test(nn), '★ F3 宽窄两族仍在真源里（本轮没把归并偷偷加宽）');
  const tw = read('data/twin.js');
  t(/decorKey\(splitName\(g && g\.title\)\.zh\)/.test(tw), 'F3 `groupKey` 仍走窄类 `decorKey`（名称键那一半没变）');
  t(/GROUP_DECOR/.test(read('data/name-normalize.js')), 'F3 窄类定义仍在（不是被搬到 twin.js 变成第五份）');
})();

console.log('\n============================');
console.log(`  v10.61 防线：${pass} / ${pass + fail} 通过${fail ? `（失败 ${fail}）` : ''}`);
console.log('============================\n');
process.exit(fail ? 1 : 0);
