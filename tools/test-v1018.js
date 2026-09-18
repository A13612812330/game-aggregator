#!/usr/bin/env node
/* tools/test-v1018.js — v10.18 静态防线：机型清单三要素（品牌+型号+芯片）+ 未收录自动联网补全
 *
 * 用户原话：「手机模拟器配置的展示样式不太行 ①我要求是全整显示（品牌+型号+芯片）
 *            ②点击可以查看到详细的参数 ③如果未收录则自动联网搜索进行补全」
 *
 * 本轮要钉死的四件事：
 *   ① **三级降级**：本地配对 → 串内芯片号 → 联网 kalvo。能本地解决的绝不上网。
 *   ② **串内芯片号**：`Odin2 QCS8550` / `T10Plus T606` / `A266M s5e8825` / `W09 Maleoon 920C`
 *      上游没给 GPU，但芯片号就写在机型串里 —— 本地解析，0 网络。
 *   ③ **防误配**（★ 本轮真踩到）：`motorola moto g(20)` 的查询词一度退化成 `moto g`，
 *      kalvo 拿它匹配到 `Motorola Moto G (2022)` —— **另一台手机**。
 *      括号里的 `20` 是型号本身，不能删；查询词太泛也不敢用；结果名必须与查询词对得上。
 *   ④ **缓存键不能用归一化**：`moto g(20)`（搜不到）与 `moto g20`（搜得到）被 mkey 归一成
 *      同一个键 ⇒ 一条失败记录毒掉能查的那条（实测就是这个原因让修复看起来「没生效」）。
 *
 * 运行：node tools/test-v1018.js       （需服务在 8123 运行，⑤ 段要打接口）
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const json = (f) => { try { return JSON.parse(read(f)); } catch (e) { return null; } };

let pass = 0, fail = 0;
function ok(c, label, extra) {
  if (c) { pass++; console.log('  PASS', label, extra === undefined ? '' : '— ' + extra); }
  else { fail++; console.log('  FAIL', label, extra === undefined ? '' : '— ' + extra); }
}
const sec = (t) => console.log('\n=== ' + t + ' ===');

const df = require('../data/devicefill');

/* ================== ① 串内芯片号索引与抠取 ================== */
sec('① data/devicefill.js — 芯片号索引 / 串内抠取');
ok(typeof df.chipByToken === 'function' && typeof df.chipFromString === 'function', '导出 chipByToken / chipFromString');
const t606 = df.chipByToken('t606');
ok(t606 && t606.soc === 'Unisoc T606', 'T606 → Unisoc T606（来自 gpu-soc 的 unisoc-t606）', t606 && t606.soc);
ok(t606 && /Mali-G57/.test(t606.gpu), 'T606 带 GPU Mali-G57 MP1', t606 && t606.gpu);
const qcs = df.chipByToken('QCS8550');
ok(qcs && qcs.soc === 'Snapdragon 8 Gen 2', 'QCS8550 → Snapdragon 8 Gen 2（厂商 part number，手工表）', qcs && qcs.soc);
const s5e = df.chipByToken('s5e8825');
ok(s5e && s5e.soc === 'Exynos 1380', 's5e8825 → Exynos 1380（厂商 part number，手工表）', s5e && s5e.soc);
const ml = df.chipByToken('MALEOON920C');
ok(ml && /Kirin 8020/.test(ml.soc || ''), 'MALEOON920C → Kirin 8020（soc-db 的 kirin8020）', ml && (ml.soc || ml.gpu));
ok(ml && ml.gpu === 'Maleoon 920C', 'MALEOON920C 带 GPU 名', ml && ml.gpu);

/* 歧义 GPU 护栏：家族名被多颗 SoC 共用时只报 GPU，不报一颗「具体但很可能错」的 SoC */
const mali = df.chipByToken('MALIG57');
ok(mali && !mali.soc, '★ 歧义 GPU（Mali-G57 被多颗 SoC 共用）不报 SoC', 'ambiguousGpu=' + (mali && mali.ambiguousGpu));
ok(mali && /Mali-G57/.test(mali.gpu), '歧义时仍报 GPU 名', mali && mali.gpu);
const adreno = df.chipByToken('ADRENO740');
ok(adreno && !adreno.soc, '★ Adreno 740 同样被判为歧义（多颗骁龙共用）', 'ambiguousGpu=' + (adreno && adreno.ambiguousGpu));

ok((df.chipFromString('Odin2 QCS8550') || {}).soc === 'Snapdragon 8 Gen 2', 'Odin2 QCS8550 → 抠出 QCS8550');
ok((df.chipFromString('T10Plus T606') || {}).soc === 'Unisoc T606', 'T10Plus T606 → 抠出 T606');
ok((df.chipFromString('A266M s5e8825') || {}).soc === 'Exynos 1380', 'A266M s5e8825 → 抠出 s5e8825');
const multi = df.chipFromString('W09 Maleoon 920C');
ok(multi && multi.joined === true, '★ 多词芯片号：`Maleoon 920C` 要拼相邻 token 才认得出', JSON.stringify(multi && multi.token));
ok(multi && /Kirin 8020/.test(multi.soc || ''), '…并能带出 SoC Kirin 8020', multi && multi.soc);
ok(df.chipFromString('Xiaomi 25053PC47G') === null, '普通内部代号不会被误当芯片号（25053PC47G）');
ok(df.chipFromString('Pocket FIT unknown') === null, '`unknown` 之类不会误判成芯片');

/* ================== ② 代号归一 ================== */
sec('② normalizeCode — 代号写法归一');
ok(df.normalizeCode('SM S711B') === 'SM-S711B', 'SM S711B → SM-S711B（空格补成连字符）');
ok(df.normalizeCode('SM-A057M') === 'SM-A057M', '已经是连字符的不动');
ok(df.normalizeCode('MTN NX3') === 'MTN-NX3', 'MTN NX3 → MTN-NX3');

/* ================== ③ 本地两级（同步、0 网络） ================== */
sec('③ fillLocal — 本地两级（绝不打网络）');
const L = (m) => df.fillLocal(m);
const l1 = L('Xiaomi 25053PC47G');
ok(l1.chip === 'Snapdragon 8s Gen 4' && l1.chipSrc === 'pair', '配对索引命中 → chipSrc=pair', l1.chip);
ok(l1.name === 'Xiaomi POCO F7', '同时给出译名', l1.name);
const l2 = L('Odin2 QCS8550');
ok(l2.chip === 'Snapdragon 8 Gen 2' && l2.chipSrc === 'token', '串内芯片号命中 → chipSrc=token', l2.chip);
const l3 = L('W09 Maleoon 920C');
ok(/Kirin 8020/.test(l3.chip || '') && l3.chipSrc === 'token', '多词芯片号也走本地', l3.chip);
const l4 = L('SM S711B');
ok(l4.name === 'Samsung Galaxy S23 FE', '代号归一后能译出机型名', l4.name);
ok(l4.chip === '' && l4.chipSrc === '', '★ 本地拿不到芯片时**留空**（不编造），交给第 3 级联网', 'chip=' + JSON.stringify(l4.chip));
const l5 = L('Honor MTN-NX3');
ok(l5.chip === '' && l5.name === 'Honor Magic8 Lite', '本地无芯片但有译名 → 联网时用译名查', l5.name);
ok(l5.market === 'HONOR Magic8 Lite', 'market 字段是给 kalvo 用的营销名', l5.market);

/* ================== ④ 查询词整理 + 防误配（本轮真踩到的坑） ================== */
sec('④ relaxQueries / plausible — 防跨源误配');
const rq = df.relaxQueries('motorola moto g(20)');
ok(rq[0] === 'motorola moto g20', '★ 括号内是数字 → **去括号保留内容**（不能连内容一起删）', JSON.stringify(rq[0]));
ok(!rq.includes('moto g'), '★ 不允许退化成 `moto g` 这种泛查询词（会匹配到别的手机）', JSON.stringify(rq));
ok(df.relaxQueries('Nothing Phone (2a)').includes('Nothing Phone 2a'), 'Nothing Phone (2a) → Nothing Phone 2a');
ok(df.relaxQueries('Xiaomi 13 (2023)')[0] === 'Xiaomi 13 2023', 'Xiaomi 13 (2023) → Xiaomi 13 2023');
ok(df.relaxQueries('POCO F7 (国际版本)')[0] === 'POCO F7', 'CJK 括号（国际版本）整段丢');
ok(df.relaxQueries('Honor HONOR Magic8 Lite').some((x) => x === 'HONOR Magic8 Lite'), '重复品牌词剥一层');

ok(df.plausible('motorola moto g20', 'Motorola Moto G20 - 全面参数、价格与评测') === true, '结果名含 `g20` → 判为同一台');
ok(df.plausible('Honor Magic8 Lite', 'Honor Magic8 Lite - 全面参数、价格与评测') === true, 'Honor Magic8 Lite → 同一台');
ok(df.plausible('Xiaomi POCO F7', 'Xiaomi Poco F7 - 全面参数') === true, '大小写不敏感');
ok(df.plausible('ZTE Blade A73', 'Samsung Galaxy A73') === false, '★ 不同品牌的结果判为**不同台**（防误配）');
/* ---- v10.18 加固后的三道闸：① 品牌冲突否决 ② 长词（≥4）必须全部命中 ③ 短型号号必须整词命中 ---- */
ok(df.plausible('motorola moto g20', 'Motorola Moto G (2022) - 全面参数、价格与评测') === false,
  '★ `Moto G (2022)` 不能冒充 `Moto G20`（短型号号以前靠**子串**会蒙中）');
ok(df.plausible('Wiko Power U30', 'Wiko Power U20 - 全面参数') === false,
  '★ 同品牌但型号号不同（U30 ≠ U20）→ 不是同一台');
ok(df.plausible('Redmi Note 13', 'Xiaomi 13 - 全面参数') === false,
  '★ 长词 `Note` 对不上 → 不是同一台');
ok(df.plausible('ZTE Blade A73', 'ZTE Blade A73 - 全面参数、价格与评测') === true, '同品牌 + 型号号整词命中 → 同一台');
ok(df.plausible('Xiaomi POCO F7', 'POCO F7 - 全面参数') === true, '★ 子品牌交集（xiaomi ∩ poco）→ 同一台，不能误杀');
ok(df.plausible('荣耀 Magic8 Lite', 'Honor Magic8 Lite - 全面参数') === true,
  '★ 中文品牌（品牌表外）不参与否决 → 仍能命中');
/* 这条是回归锚点：泛查询词 `moto g` 一旦被送进 kalvo，就会匹配到 Moto G (2022) */
ok(df.relaxQueries('moto g(20)').every((q) => !/^moto g$/i.test(q)), '★ `moto g(20)` 的任何候选查询词都不是 `moto g`');
/* kalvo 的多地区值末尾会留悬空 ` / `，进徽标 title 像没写完 —— 出口统一清洗 */
ok(df.tidyVal('Samsung Exynos 2200 (国际版本) / Qualcomm Snapdragon 8 Gen 1 (美国) /')
  === 'Samsung Exynos 2200 (国际版本) / Qualcomm Snapdragon 8 Gen 1 (美国)',
  '★ 多地区值末尾的悬空「 / 」被清掉', JSON.stringify(df.tidyVal('Samsung Exynos 2200 (国际版本) / Qualcomm Snapdragon 8 Gen 1 (美国) /')));
ok(df.tidyVal('  Snapdragon 8 Gen 3 ') === 'Snapdragon 8 Gen 3', '值首尾空白也被清掉');

/* ================== ⑤ 服务端接口 ================== */
sec('⑤ 服务端 /api/device/specs 与 /api/device/fill');
(async () => {
  const B = 'http://127.0.0.1:8123';
  const get = async (u) => { try { const r = await fetch(B + u); return await r.json(); } catch (e) { return null; } };

  const DEV = ['HONOR MTN-NX3', 'Xiaomi 25053PC47G', 'motorola moto g(20)', 'Odin2 QCS8550', 'samsung SM-A057M'];
  const sp = await get('/api/device/specs?models=' + encodeURIComponent(DEV.join('|')));
  ok(sp && sp.ok, 'GET /api/device/specs 可用', sp ? Object.keys(sp.specs || {}).length + ' 台' : 'null');
  if (sp && sp.specs) {
    ok('chip' in (sp.specs['Xiaomi 25053PC47G'] || {}), '★ 返回体新增 chip（品牌+型号+芯片三要素）');
    ok('chipSrc' in (sp.specs['Xiaomi 25053PC47G'] || {}), '返回体新增 chipSrc（来源可追溯）');
    ok('needFill' in (sp.specs['Xiaomi 25053PC47G'] || {}), '返回体新增 needFill（前端据此触发联网补全）');
    ok(sp.specs['Xiaomi 25053PC47G'].chip === 'Snapdragon 8s Gen 4', '已知机型芯片正确', sp.specs['Xiaomi 25053PC47G'].chip);
    ok(sp.specs['Odin2 QCS8550'].chip === 'Snapdragon 8 Gen 2', '★ 串内芯片号机型在 specs 里就有芯片（不必联网）', sp.specs['Odin2 QCS8550'].chip);
    ok(sp.specs['HONOR MTN-NX3'].needFill === true, '缺芯片的机型 needFill=true', 'true');
    ok(sp.specs['motorola moto g(20)'].needFill === true, 'moto g(20) 也需要联网补');
  }
  const fl = await get('/api/device/fill?models=' + encodeURIComponent('HONOR MTN-NX3|motorola moto g(20)'));
  ok(fl && fl.ok, 'GET /api/device/fill 可用', fl ? JSON.stringify(Object.keys(fl.fills || {})) : 'null');
  if (fl && fl.fills) {
    const a = fl.fills['HONOR MTN-NX3'], b = fl.fills['motorola moto g(20)'];
    ok(a && /Snapdragon 6 Gen 4/.test(a.chip || ''), '★ Honor MTN-NX3 联网补到 Snapdragon 6 Gen 4', a && a.chip);
    ok(a && a.chipSrc === 'kalvo', 'chipSrc=kalvo（来源标注）', a && a.chipSrc);
    ok(b && /Unisoc T700/.test(b.chip || ''), '★ moto g(20) 补到 **Unisoc T700**（不是误配的 Dimensity 700）', b && b.chip);
  }
  const fs2 = await get('/api/device/fill-stats');
  ok(fs2 && fs2.ok && typeof fs2.total === 'number', 'GET /api/device/fill-stats 可用', fs2 && `${fs2.withChip}/${fs2.total} 有芯片，联网 ${fs2.fromOnline}`);
  const nf = await get('/api/device/hardware?m=' + encodeURIComponent('这份型号肯定不存在xyzzy'));
  ok(nf && nf.ok === false, '★ 查不到的型号如实返回 ok:false（不编造）', nf && nf.reason);

  /* ================== ⑥ 前端 ================== */
  sec('⑥ 前端 index.html / emulator.html');
  const IDX = read('public/index.html');
  const EMU = read('public/emulator.html');
  ok(/\.d-devlist \.dv \.sub \.chip\{/.test(IDX), 'index 有芯片徽标样式 .sub .chip');
  ok(/\.d-devlist \.dv \.sub \.chip\.ol\{/.test(IDX), 'index 有「联网补全」配色 .chip.ol（靛蓝）');
  ok(/\.d-devlist \.dv \.sub \.chip\.none\{/.test(IDX), 'index 有「未收录」配色 .chip.none（灰虚线）');
  ok(/\.d-devlist \.dv \.sub \.chip\.wait\{/.test(IDX), 'index 有「联网查询中」态 .chip.wait');
  ok(/\.d-devlist \.dv \.gtag\{/.test(IDX), 'index 有行内「门槛」徽标样式');
  ok(/\.d-devlist-lg\{/.test(IDX), 'index 有表头图例样式（替代旧的独立摘要行）');
  /* 「全整显示」：主行不能再用 nowrap + 省略号截断 */
  const hdB = IDX.slice(IDX.indexOf('.d-devlist .dv .hd b{'), IDX.indexOf('.d-devlist .dv .hd b{') + 260);
  ok(!/white-space:nowrap/.test(hdB) && !/text-overflow:ellipsis/.test(hdB), '★ 主行「品牌+型号」**不截断**（允许折行，这就是「全整显示」）', hdB.replace(/\s+/g, ' ').slice(0, 90));
  ok(/word-break:break-word/.test(hdB), '长型号可断行');
  ok(/\/api\/device\/fill\?models=/.test(IDX), '前端会调 /api/device/fill 做联网补全');
  ok(/chip\.wait/.test(IDX) && /联网查询中/.test(IDX), '联网补全有「联网查询中」的中间态（不是空白）');
  ok(/原地替换/.test(IDX) && /outerHTML = html/.test(IDX), '★ 联网补全只原地替换徽标，不重渲染清单（否则会收掉已展开的面板）');
  ok(!/\.bh-gate\{/.test(IDX), '★ 旧的「门槛小结行」CSS 已删除（不再有重复的摘要行）');
  ok(!/<div id="bhGate"><\/div>/.test(IDX), '★ 旧的 #bhGate 容器已从模板移除');
  ok(!/未收录芯片/.test(IDX), '旧的「未收录芯片」文案已换成徽标');
  ok(!/<i class="dim">/.test(IDX), '旧的无样式芯片文本节点已移除');
  /* 派生页必须同步（改主源必须重建） */
  for (const k of ['.chip.none{', '.chip.ol{', '.chip.wait{', 'd-devlist .dv .gtag', '/api/device/fill?models=', 'chipShort']) {
    ok(EMU.includes(k), '[派生页] 同步了 ' + k);
  }
  ok(!/\.bh-gate\{/.test(EMU), '[派生页] 旧门槛行 CSS 也已清除');

  /* ================== ⑦ 不编造 / 缓存键 ================== */
  sec('⑦ 不编造 + 缓存键修正');
  const unknown = df.fillLocal('Zzz NotAPhone 9999');
  ok(unknown.chip === '', '★ 完全未知的机型返回空芯片（不编造）');
  const spec = read('data/devicespec.js');
  ok(/const ckey = \(s\)/.test(spec), 'devicespec 新增 ckey（保留标点的缓存键）');
  ok(/const key = ckey\(name\)/.test(spec), '★ hardware() 用 ckey 而不是 mkey（否则 `moto g(20)` 与 `moto g20` 撞键）');
  ok(/const mkey = \(s\)/.test(spec), 'mkey 仍保留给宽松比对用');
  const tokens = json('data/chip-tokens.json');
  ok(tokens && tokens.QCS8550 && tokens.S5E8825, 'chip-tokens.json 存在且含两张 part number');
  ok(tokens && typeof tokens._note === 'string' && /印证|part number/.test(tokens._note), 'chip-tokens.json 写清来源依据（可审计）');
  ok(!/T606|MALEOON920C/.test(JSON.stringify(Object.keys(tokens || {}).filter((k) => !k.startsWith('_')))), '★ T606 / Maleoon 920C **不写进手工表**（现有数据里就有，避免双份维护）');

  console.log('\n' + '='.repeat(58));
  console.log(`静态防线：${pass} / ${pass + fail} 通过` + (fail ? `，${fail} 失败` : ''));
  if (fail) process.exitCode = 1;
})().catch((e) => { console.error('运行失败：', e.message); process.exit(1); });
