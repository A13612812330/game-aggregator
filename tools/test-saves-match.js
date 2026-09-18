/* tools/test-saves-match.js — 云存档「清单名 ↔ 端游库」匹配回归
 *
 * 背景（v10.6）：build-saves.js 原实现只有「精确钥匙」一层，导致清单英文短名
 * （`Resident Evil 2`）与库内全名（`Resident Evil 2:Remake`）对不上 → libId 落空
 * → 前端云存档卡片点了不进详情页。补两层匹配后必须守住两件事：
 *   ① 该拦的：作品号/系列名/跨词子串**一律不能**配错（错配比不配更糟 —— 挂错封面）；
 *   ② 该放的：加个 `Remake / Remastered / HYPERVISOR / 复刻` 后缀的同款**必须**命中。
 *
 * 只测拦截会退化成「永不匹配」，所以两组用例数量相当。
 */
const M = require('./build-saves.js');

/* ============ 第一组：纯函数护栏（确定性，不依赖数据） ============ */
const unit = [
  // [函数, 参数..., 期望, 说明]
  ['numConflict', 'residentevil0', 'residentevil3remake', true, '数字全不重叠 → 冲突'],
  ['numConflict', 'residentevil2', 'residentevil2remake', false, '数字重叠 → 不冲突'],
  ['numConflict', 'crysis', 'crysis2remastered', false, '一方无数字 → 不冲突（交给修饰词护栏）'],
  ['extraIsDecoration', 'residentevil2remake', 'residentevil2', true, '多出的 remake 是修饰词'],
  ['extraIsDecoration', 'silenthill2remake', 'silenthill2', true, '同上'],
  ['extraIsDecoration', 'starcraftremastered', 'starcraft', true, '纯字母键也要能判过（旧词边界实现会误杀）'],
  ['extraIsDecoration', 'farcry5hypervisor', 'farcry5', true, 'hypervisor 是复刻标记 → 放行'],
  ['extraIsDecoration', 'anotherworld20thanniversaryedition', 'anotherworld', true, '20th 序数 + 纪念版 → 放行'],
  ['extraIsDecoration', 'riseofthetombraider20yearcelebration', 'riseofthetombraider', true, '20year + 庆典版 → 放行'],
  ['extraIsDecoration', 'bussimulator21nextstop', 'bussimulator21', true, 'next stop 是副标题修饰 → 放行'],
  ['extraIsDecoration', 'citytransportsimulator2026hypervisor', 'citytransportsimulator2026', true, '复刻标记后缀 → 放行'],
  ['extraIsDecoration', 'baldursgate3', 'baldursgate', false, '多出的 3 是作品号 → 拦'],
  ['extraIsDecoration', 'anthem9', 'anthem', false, '多出的 9 是作品号 → 拦'],
  ['extraIsDecoration', 'bioshock2remastered', 'bioshock', false, '多出的 2 是作品号（后面有修饰词也不行）→ 拦'],
  ['extraIsDecoration', 'assassinscreediiiremastered', 'assassinscreedii', false, 'II 与 III 是不同作 → 拦'],
  ['extraIsDecoration', 'starcraft2legacyofthevoid', 'starcraft', false, '系列号 + 副标题 → 拦'],
  ['extraIsDecoration', 'demonstimeline', 'elin', false, '跨词子串（Tim-ELIN-e）→ 残渣拼不出修饰词，拦'],
  ['extraIsDecoration', 'vespera', 'vesper', false, '★ 复核抓到的真实误配：只多一个字母 a → 拦'],
  ['extraIsDecoration', 'bulletstormvr', 'bulletstorm', false, '★ VR 是独立作品，不算同款版本 → 拦'],
  ['extraIsDecoration', 'worldwarzvr', 'worldwarz', false, '★ 同上（僵尸世界大战VR）→ 拦'],
  ['extraIsDecoration', 'sniperelitevrhypervisor', 'sniperelitevr', true, 'VR 版自身的复刻包仍可放行'],
  ['extraIsDecoration', 'gta5legacy', 'gta5', false, 'legacy 不在修饰白名单 → 保守拦'],
];

/* ============ 第二组：真实索引上的端到端匹配 ============ */
const cases = [
  // —— 该放的：加版本/复刻后缀的同款 ——
  ['Resident Evil 2', 'xd-89', '清单短名 ↔ 库内 `Resident Evil 2:Remake`'],
  ['Crysis 2', 'xd-5007', '清单短名 ↔ 库内精制版'],
  ['Crysis 3', 'xd-5006', '同上'],
  ['Silent Hill 2', 'xd-8922', '清单短名 ↔ 寂静岭2：重制版'],
  ['Far Cry 5', 'xd-13975', '清单短名 ↔ 孤岛惊魂5-虚拟机版'],
  ['Warriors Orochi 4', 'xd-824', '中英编号不一致（无双大蛇3 ↔ Orochi 4）'],
  ['Sniper Elite V2', 'xd-4491', '罗马数字后缀 + 重制版'],
  ['StarCraft', 'xd-4525', '纯字母查询（旧锚点实现下永远命中不了）'],
  ['Another World', 'xd-6821', '纯字母查询 + 20周年纪念版'],
  ['Bus Simulator 21', 'xd-3127', '副标题副标 `Next Stop`'],
  ['Baldur\'s Gate', 'xd-415', '裸名应命中「加强版」，而不是「博德之门3」'],
  ['BioShock', 'xd-301', '裸名应命中「生化奇兵：重制版」，而不是第 2 代'],
  ['Mortal Kombat 1', 'xd-15861', '多复刻包并存 → 取修饰最少（voices38 短于 HYPERVISOR）'],
  // —— 该拦的：作品号 / 歧义 / 异版本 ——
  ['Anthem', null, '库内只有「ANTHEM#9」，不同款'],
  ["Assassin's Creed II", null, '库内只有 III 重制版，罗马数字不同'],
  /* ★ v10.22 校准（**预期变更，非退化**）：机地全量话题入库后，
     库里多了 `Dead Island Definitive Edition`（jidi-909253908，就是死亡岛1的加强版）
     与同名原版 `Crysis`（jidi-338848314）——
     原先断言 null 的前提是「库内只有 2 / 只有重制版」，那个前提已经不成立。
     现在两条都比过去**更对**：裸名优先命中同名原版 / 1 代加强版，
     而不是退而求其次找「死亡岛2」「孤岛危机：重制版」。 */
  ['Dead Island', 'jidi-909253908', 'v10.22：库里已有 1 代加强版 → 不再判「找不到」'],
  ['Crysis', 'jidi-338848314', 'v10.22：库里已有同名原版 → 精确同名优先于 XD 的「重制版」'],
  ['Age of Wonders', null, '库内只有 4'],
  ['Vesper', null, '★ 复核抓到的真实误配（Vespera）'],
  ['Sniper Elite', null, '★ 库内只有 VR 版，VR 不等于同款'],
  ['World War Z', null, '★ 库内只有 VR 版'],
  ['', null, '空名不命中'],
];

let pass = 0, fail = 0;
const bad = [];

console.log('=== ① 纯函数护栏 ===');
for (const [fn, a, b, want, why] of unit) {
  let got;
  try { got = M[fn](a, b); } catch (e) { got = 'ERR:' + e.message; }
  const good = got === want;
  good ? pass++ : (fail++, bad.push(fn + '(' + a + ',' + b + ')'));
  console.log(`${good ? '  PASS' : '× FAIL'}  ${fn}(${a}, ${b}) = ${got}（期望 ${want}）`);
  console.log(`        ${why}`);
}

console.log('\n=== ② 真实索引端到端匹配 ===');
const idx = M.buildIndex();
console.log(`  索引：端游库 ${idx.pcCount} 款 ｜ 手游中心 ${idx.mobKeys} 键 ｜ 禁模糊系列名 ${idx.pcSeries} 个`);
for (const [query, wantId, why] of cases) {
  const k = M.normKey(query);
  const rec = M.matchRec(idx.pcByName, idx.pcAnchor, k, true);
  const got = rec ? rec.id : null;
  const good = got === wantId;
  good ? pass++ : (fail++, bad.push(query || '(空)'));
  console.log(`${good ? '  PASS' : '× FAIL'}  「${query || '(空)'}」 → ${rec ? '[' + rec.id + '] ' + rec.title : 'null'}（期望 ${wantId || 'null'}）`);
  console.log(`        ${why}`);
}

console.log(`\n结果：${pass} / ${pass + fail} 通过`);
if (bad.length) console.log('未通过：' + bad.join(' ｜ '));
process.exit(fail ? 1 : 0);
