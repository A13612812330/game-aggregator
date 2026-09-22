#!/usr/bin/env node
/* tools/test-v1032.js — v10.32 详情页定位条两处修正 + 配置要求双语搜索（静态防线）
 *
 * 用户本轮口径（原文）：
 *   ①「修改器和存档现在是一行了，所以只需要一个」
 *   ②「有个小问题定位的时候顶部会遮挡部分，应该优化下」
 *   ③「配置要求有没有办法从其他地方补全或者同时用中英文游戏名称进行搜索后补充」
 *
 * 为什么三条都必须静态守卫 —— 都是「改回去没人发现」那种改动：
 *   ① 定位条项的表达形式是 `D_RAIL` 里的一行对象，加回一行就复发，没有任何报错；
 *   ② 跳转余量是一个减数（`- cover - gap`），改回 `- 14` 只是少减 62，
 *      页面照常能滚、不报错、只是**标题又被盖住**；
 *   ③ `pcreq.js` 的搜索通路里，`split('/')[0]`（只取中文段）和 `items[0]`（不校验）
 *      都是**看起来人畜无害**的写法 —— 退回去同样不报错，只是命中率掉回去、
 *      并且重新开始给《心灵杀手2》安上《Beat Saber》的配置要求。
 *
 * ★ 判据写法（本项目铁律）：
 *   · 锚点收窄到被守护的函数体 / 代码片段，不裸写整份源码；
 *   · 每条新机制都配一条**反向断言**（「不许再出现…」）；
 *   · 计数类判据不写等号（`=== 8`）—— 加一个分区就会误报。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const IDX = rd('public/index.html');
const EMU = rd('public/emulator.html');
const UNP = rd('public/unpack.html');
const PCREQ = rd('data/pcreq.js');

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  — ' + extra : '')); }
  else { fail++; console.log('  × FAIL  ' + name + (extra ? '  — ' + extra : '')); }
};
/** 从 `from` 起截一段（比「匹配到下一个行首 }」稳：能扛住嵌套大括号）。 */
const slice = (src, from, len) => {
  const i = src.indexOf(from);
  return i < 0 ? '' : src.slice(i, i + (len || 1800));
};
/** 只取 `const D_RAIL = [...]` 这一段。
 *  ⚠️ 判据必须**限定在块内**而不是整页：派生页（emulator/unpack）里有自己的独立内容，
 *    其中模拟器「工具总览」也有一项 `modifier: { nm: '修改器', ... }` ——
 *    整页判 `nm: '修改器'` 会把它算成「定位条没合并」，那是**假红**（实测踩到过）。 */
const railBlock = (src) => {
  const i = src.indexOf('const D_RAIL =');
  if (i < 0) return '';
  const j = src.indexOf('\n];', i);
  return j < 0 ? '' : src.slice(i, j + 3);
};
const railNames = (src) => (railBlock(src).match(/nm:\s*'([^']*)'/g) || []).join(' · ');

console.log('\n=== ① 定位条：修改器 / 云存档合并成一项 ===');
{
  const RAIL = railBlock(IDX);
  ok(RAIL.length > 100, '取到 D_RAIL 定义');
  ok(/nm:\s*'修改器\/云存档'/.test(RAIL), '★ 有一项名为「修改器/云存档」');
  ok(/k:\s*'trsv'[\s\S]{0,60}sel:\s*\['#trSvSlot'\]/.test(RAIL), '★ 该项指向两块的共同容器 #trSvSlot');
  /* ⚠️ 反向断言必须**精确**匹配项名：`nm: '修改器'` 后面紧跟单引号，
     而 `nm: '修改器/云存档'` 后面是斜杠 —— 用 `'修改器'` 才能只命中「单独那一项」。
     写成 `/修改器/` 会因为合并项的项名里也有这三个字而恒真（假绿）。 */
  ok(!/nm:\s*'修改器'/.test(RAIL), '★★ 反向断言：不再有单独的「修改器」项');
  ok(!/nm:\s*'云存档'/.test(RAIL), '★★ 反向断言：不再有单独的「云存档」项');
  ok(!/sel:\s*\['#trBlock'\]/.test(RAIL), '★★ 反向断言：定位项不再直接指向 #trBlock');
  ok(!/sel:\s*\['#svBlock'\]/.test(RAIL), '★★ 反向断言：定位项不再直接指向 #svBlock');
  /* 两块仍在同一行（合并的前提）——容器还在，否则合并就失去意义 */
  ok(/<div class="d-pair" id="trSvSlot">/.test(IDX), '两块的容器 #trSvSlot 仍在（.d-pair 一行两列）');
}

console.log('\n=== ② 定位跳转：余量要把常驻小标题条的遮挡算进去 ===');
{
  const land = slice(IDX, 'const land = () => {');
  ok(land.length > 200, '取到 land() 函数体');
  ok(/mini\.offsetHeight/.test(land), '★ 读小条实际高度（不写死 62）');
  ok(/hero\.offsetHeight/.test(land), '★ 读大图实际高度当显形阈值（与 dHeroSpy 同源）');
  ok(/const cover = raw >= heroH \? miniH : 0;/.test(land),
    '★ 先算「不含余量」的落点，再判小条会不会显形（没显形就不该减）');
  ok(/raw - cover - gap/.test(land), '★ 落点里减掉小条的遮挡高度');
  ok(/const gap = cover \? 10 : 14;/.test(land), '小条显形时余 10px，否则照旧 14px');
  ok(/const raw = dr\.scrollTop \+ dy;/.test(land), 'raw = 当前位置 + 目标偏移');
  /* ★ 反向断言：要抓的是「余量被写成字面量」这件事本身，而不是旧代码那串确切字样。
     ⚠️ 第一版写成 `!/scrollTop \+ dy - 14/` —— 实测反证时**没红**：把
     `raw - cover - gap` 改成 `raw - 14` 照样绕开 cover，而字面串不匹配。
     现在判 `raw - <数字>` 这种形态，才真正封住「绕开 cover 写死余量」。 */
  ok(!/raw - \d/.test(land), '★★ 反向断言：余量不许写成字面量（必须经过 cover）');
  /* 双趟保险仍在（v10.30 加的，守「将来又有人在顶图高度上做文章」） */
  ok(/setTimeout\(land, 460\)/.test(slice(IDX, 'const land = () => {', 2600)), '双趟 land 保险仍在');
}

console.log('\n=== ③ 配置要求：双语名称搜索 + 三级校验 ===');
{
  ok(/function normName\(/.test(PCREQ), '★ normName（比对用归一化）已定义');
  ok(/function titleParts\(/.test(PCREQ), '★ titleParts（中文段 + 英文段）已定义');
  ok(/function nameMatchLevel\(/.test(PCREQ), '★ nameMatchLevel（两级判定）已定义');
  ok(/function pickBySearch\(/.test(PCREQ), '★ pickBySearch（双语搜索主流程）已定义');
  ok(/function searchCandidates\(/.test(PCREQ), '★ searchCandidates 返回**带名字**的候选（校验要用）');
  /* 反向断言：旧的单语、不校验版本必须已经不存在 */
  ok(!/function searchAppid\(/.test(PCREQ), '★★ 反向断言：旧的 searchAppid（只取中文段）已移除');
  ok(!/const it = \(j\.items \|\| \[\]\)\[0\];/.test(PCREQ), '★★ 反向断言：不再「取 items[0] 直接用、不校验」');
  /* 三级判据齐全（顺序也是判据的一部分：越强越先） */
  const pick = slice(PCREQ, 'async function pickBySearch(');
  const iName = pick.indexOf("how: 'name'");
  const iCross = pick.indexOf("how: 'cross'");
  const iLoose = pick.indexOf("how: 'loose'");
  ok(iName > 0 && iCross > 0 && iLoose > 0, '★ 三级判据都在（name / cross / loose）');
  ok(iName < iCross && iCross < iLoose,
    '★★ 判据顺序：完全相等 → 多段交叉 → 字符串包含（越强越先，顺序也是判据）');
  ok(/nameMatchLevel\(c\.name, parts\) === 2/.test(pick), '★ ① 用「完全相等」筛候选，且是**遍历候选**不是只看首条');
  ok(/perPart\[0\]\.cands[\s\S]{0,200}b\.cands\.some/.test(pick), '★ ② 多段候选交集（与名字形态无关的独立证据）');
  ok(/const exact = cands\.find\(\(c\) => nameMatchLevel\(c\.name, parts\) === 2\);/.test(pick),
    '★ exact 与 loose 分开取，loose 要留到所有段扫完');
  /* 判定等级本身 */
  ok(/if \(q === r\) return 2;/.test(PCREQ), '★ 等级 2 = 归一化后完全相等');
  /* ⚠️ 必须把**闸门真的用在条件里**整句断言。第一版只判 `/minLen/` 与 `/includes\(q\)/`
     分开存在 —— 反证时**打坏了却全绿**：删掉 `q.length >= minLen &&` 之后，
     `const minLen = ...` 那行还在，两个片段各自都还匹配（典型的恒真断言）。 */
  ok(/q\.length >= minLen && r\.includes\(q\)/.test(PCREQ),
    '★ 等级 1 = 包含（且对中文/英文分别设最小长度，防短串乱配）');
  /* 负缓存：搜不到也要记账，否则每次打开详情页都重搜 2.2s */
  ok(/const key = 'q:' \+ normName\(opts\.title\)/.test(PCREQ), '★ 按名称搜索走 `q:` 前缀的缓存键');
  ok(/save\(key, \{ miss: true \}\);/.test(PCREQ), '★★ 未命中写负缓存（避免每次打开都重搜）');
  ok(/searchKeys/.test(PCREQ), 'stats 里把 `q:` 键与 appid 键分开计数（否则「收录多少款」虚高）');
  /* 网络异常不许写负缓存 —— 否则一次抖动会把这款游戏永久判成「无配置」 */
  const after = slice(PCREQ, "if (!appid && opts.title) {", 1500);
  ok(/catch \(e\) \{ \/\* 网络异常不写负缓存/.test(after), '★ 网络异常不写负缓存（与 appid 分支同一铁律）');
}

console.log('\n=== 派生页同步（改主源必须重建） ===');
{
  /* 只判 D_RAIL 块内的项名（派生页有自己的独立内容，整页判会假红） */
  for (const [nm, src] of [['emulator.html', EMU], ['unpack.html', UNP]]) {
    const R = railBlock(src);
    ok(R.length > 100, nm + ' 里取到 D_RAIL 定义');
    ok(/nm:\s*'修改器\/云存档'/.test(R), nm + ' 已同步「修改器/云存档」项');
    ok(!/nm:\s*'修改器'/.test(R), nm + ' 的定位条不含单独的「修改器」项');
    console.log('        （' + nm + ' 的条上项名：' + railNames(src) + '）');
  }
}

console.log('\n============================');
console.log('  通过 ' + pass + '/' + (pass + fail) + '（失败 ' + fail + '）');
console.log('============================');
process.exit(fail ? 1 : 0);
