/* spec-dict / spec-match 的常驻防线（v10.20 新增）
 *
 * 为什么要有它：本模块吃的是**用户手上一份字段名未知的 JSON**，
 * 识别不到就是静默漏项，而匹配又建立在识别结果上 —— 一旦认错，
 * 输出的是「看起来很确定」的错结论（假精度），比报错危险得多。
 * 开发过程中已经实测踩到三个，全部在这里钉成断言：
 *   ① minRequirements.ram 把设备的 memory 顶掉（要求 ≠ 自身配置）
 *   ② minRequirements.dx 被当成「我支持 DX12」写进能力表（要求 ≠ 能力）
 *   ③ 值 "OnePlus 13 (SM8750)" 整串当 GPU 名 → gpuScore 退化成固定 400 分
 *
 * 纯本地、无网络、无副作用。
 */
const path = require('path');
const dict = require('../data/spec-dict');
const match = require('../data/spec-match');
const { extract, buildProfile, classify, toGB, dxOf, tierOf, normKey } = dict;

let pass = 0, fail = 0;
const ok = (cond, name, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name + (detail ? '  — ' + detail : '')); }
  else { fail++; console.log('  × FAIL  ' + name + (detail ? '  — ' + detail : '')); }
};
const eq = (got, want, name) => ok(got === want, name, '得到 ' + JSON.stringify(got) + '，期望 ' + JSON.stringify(want));

/* ============ ① 基础解析 ============ */
console.log('=== ① 基础解析 ===');
eq(normKey('Gpu_Name'), 'gpuname', 'normKey 去掉下划线并小写');
eq(normKey('min[0].requirements'), 'min0requirements', 'normKey 去掉数字下标与点号');
eq(toGB('需要 13 GB 可用空间').gb, 13, 'toGB 从中文句子里抠出 13 GB');
eq(toGB('2048 MB').gb, 2, 'toGB 把 MB 换算成 GB');
eq(toGB('1 TB').gb, 1024, 'toGB 把 TB 换算成 GB');
eq(toGB('没有数字'), null, 'toGB 认不出时返回 null（不瞎猜 0）');
eq(dxOf('9.0c'), 9, 'dxOf 解析 "9.0c"');
eq(dxOf('DirectX 12'), 12, 'dxOf 解析 "DirectX 12"');
eq(dxOf('需要 13 GB 空间'), null, 'dxOf 不会把内存句误读成 DX 版本');
eq(tierOf('minRequirements'), 'min', 'tierOf 认「最低配置」');
eq(tierOf('recommended'), 'rec', 'tierOf 认「推荐配置」');
eq(tierOf('memory'), '', 'tierOf 中立词不误判档位');

/* ============ ② 身份识别（键名 / 值 / 兼容层） ============ */
console.log('\n=== ② 身份识别 ===');
const c1 = classify({ key: 'gpu', anc: 'gpu', value: 'Adreno 740' });
eq(c1.group, 'gpu', '键名通道：gpu → 显卡');
eq(c1.conf, 'high', '键名通道标为高置信');
const c2 = classify({ key: 'zzz', anc: 'zzz', value: 'Adreno 740' });
eq(c2.group, 'gpu', '值通道：认得出 "Adreno 740"');
eq(c2.conf, 'low', '值通道标为低置信（不冒充确定）');
eq(c2.hit, 'Adreno 740', '★ 值通道回传命中片段，而不是整串');
const c3 = classify({ key: 'device', anc: 'device', value: 'OnePlus 13 (SM8750)' });
eq(c3.hit, 'SM8750', '★ 从 "OnePlus 13 (SM8750)" 里只抠出 SM8750');
const c4 = classify({ key: 'dxvk', anc: 'compatibility.dxvk', value: '2.4' });
eq(c4.group, 'layer', '兼容层：dxvk → layer');
eq(c4.layer, 'dxvk', '兼容层名回传为图层键');
const c5 = classify({ key: 'vram', anc: 'vram', value: '8 GB' });
eq(c5.group, 'vram', '★ vram 不会被 ram 规则先截走');
const c6 = classify({ key: 'memory', anc: 'memory', value: '16 GB' });
eq(c6.group, 'ram', 'memory → 内存');

/* ============ ③ 分层：自身配置 vs 最低要求 ============ */
console.log('\n=== ③ 分层（本次实测踩到的最大坑）===');
const layered = extract({
  device: 'X', memory: '16 GB', storage_free: '256 GB',
  compatibility: { dxvk: '2.4' },
  minRequirements: { ram: '8 GB', storage: '40 GB', dx: '11' },
});
const lp = layered.records[0].profile;
eq(lp.ram.gb, 16, '★ 设备的 16 GB 不被 minRequirements 的 8 GB 顶掉');
eq(lp.ram.src, 'self', 'profile.ram 标注来源为自身配置');
eq(lp.req.ram, 8, '最低要求另存 profile.req.ram');
eq(lp.req.dx, 11, '最低要求里的 dx 另存 profile.req.dx');
eq(lp.api.length, 0, '★ 要求档的 dx 不写进「能力表」（要求≠能力）');
eq(lp.storage.gb, 256, 'storage 同理：自身 256 GB 优先');

const onlyReq = extract({ minRequirements: { ram: '8 GB' } }).records[0].profile;
eq(onlyReq.ram.gb, 8, '只有要求档时，退回用要求值以便仍能出结果');
eq(onlyReq.ram.src, 'req', '★ 但来源标注为 req，前端会提示「取自最低要求」');
ok(onlyReq.borrowed.indexOf('ram') >= 0, 'borrowed 清单记录被借用的字段');

/* ============ ④ 匹配四维度 ============ */
console.log('\n=== ④ 匹配维度判定 ===');
const mkProfile = (o) => extract(o).records[0].profile;

const armNoTr = mkProfile({ arch: 'arm64-v8a', memory: '16 GB' });
const j1 = match.judge(armNoTr, { ramGb: 4, dx: 9 });
eq(j1.dims.find((d) => d.dim === 'arch').state, 'fail', '★ ARM 且无转译层 → arch 判 fail');
eq(j1.verdict, 'no', 'arch fail 直接导致整款不可跑');

const armTr = mkProfile({ arch: 'arm64-v8a', memory: '16 GB', compatibility: { box64: '0.3.4', dxvk: '2.4' } });
eq(match.judge(armTr, { ramGb: 4 }).dims.find((d) => d.dim === 'arch').state, 'ok', 'ARM + box64 → arch 通过');

const x86 = mkProfile({ arch: 'x86_64', memory: '16 GB' });
eq(match.judge(x86, { ramGb: 4 }).dims.find((d) => d.dim === 'arch').state, 'ok', 'x86 直接执行 → arch 通过');

eq(match.dxCap(mkProfile({ compatibility: { dxvk: '2.4' } })).max, 11, 'DXVK → DX 上限 11');
eq(match.dxCap(mkProfile({ compatibility: { 'vkd3d-proton': '2.13' } })).max, 12, 'VKD3D → DX 上限 12');
eq(match.dxCap(mkProfile({ memory: '8 GB' })), null, '无兼容层 → 推不出 DX 能力（返回 null 而非 0）');

const dxOnly11 = mkProfile({ compatibility: { dxvk: '2.4' }, memory: '16 GB' });
eq(match.judge(dxOnly11, { dx: 12 }).verdict, 'no', '★ 只有 DXVK 时，要 DX12 的游戏判不可跑');
eq(match.judge(dxOnly11, { dx: 11 }).verdict, 'ok', 'DXVK 满足 DX11 要求');
eq(match.judge(dxOnly11, { ramGb: 64 }).verdict, 'no', '内存不足判不可跑');

const noDxMark = match.judge(dxOnly11, { ramGb: 4 });
eq(noDxMark.dims.find((d) => d.dim === 'dx').state, 'skip', '★ 游戏未标 dx → skip（不降级为待确认）');
eq(noDxMark.verdict, 'smooth', '★ 仅因游戏缺标注而跳过，不影响判定（内存 16 vs 4 余量 4 倍 → 流畅）');

/* 「我方缺 storage」与「游戏没标 storage」是两回事，前者才是未知：
   游戏标了 50 GB 而配置里没可用空间 → 该项未判定，但结论不因此被推翻 */
const noSto = match.judge(dxOnly11, { ramGb: 4, storageGb: 50 });
ok(noSto.unjudged.indexOf('storage') >= 0, '★ 我方缺可用空间 → 未判定项如实回传');
eq(noSto.verdict, 'smooth', '★ 次要维度未判定时不推翻结论（内存余量足够 → 流畅）');

/* 关键维度缺失才允许降级为「待确认」 */
const noRam = match.judge(mkProfile({ arch: 'x86_64', compatibility: { dxvk: '2.4' } }), { ramGb: 8, dx: 9 });
eq(noRam.verdict, 'maybe', '★ 缺「内存」这一关键维度 → 只能待确认');
eq(noRam.keyUnknown[0], 'ram', 'keyUnknown 明确指出缺的是哪一项');

const missRam = match.judge(mkProfile({ arch: 'x86_64' }), { ramGb: 4 });
eq(missRam.dims.find((d) => d.dim === 'ram').state, 'unknown', '★ 我方配置缺该项 → unknown（是真缺信息）');

/* arch 未标注时的口径：默认跳过；只有出现 ARM 专用层才提示补全 */
eq(match.judge(mkProfile({ memory: '16 GB' }), { ramGb: 4 }).dims.find((d) => d.dim === 'arch').state, 'skip',
  '★ 没标架构 → 跳过（PC 配置本来不写指令集，不能因此全库降级）');
eq(match.judge(mkProfile({ compatibility: { turnip: '24.1' } }), { ramGb: 4 }).dims.find((d) => d.dim === 'arch').state, 'unknown',
  '★ 出现 turnip（仅 ARM）却没标架构 → 提示补全');

const allSkip = match.judge(mkProfile({}), {});
eq(allSkip.verdict, 'unknown', '★ 一个能站住的维度都没有 → 不下结论');

/* ============ ⑤ 真实数据对撞 ============ */
console.log('\n=== ⑤ 真实数据（steam-req.json）===');
const ix = match.index();
ok(!ix.error, 'steam-req.json 可读可解析', ix.error || '');
ok(ix.built >= 600, '配置库规模正常', ix.built + ' 款');

const real = match.analyze(armTr, { limit: 20 });
ok(real.ok, 'analyze 正常返回');
ok(real.stats.scanned === ix.built, '扫描款数与库一致', real.stats.scanned + '');
ok(real.items.length === 20, 'limit 生效', real.items.length + '');
const vset = new Set(real.items.map((i) => i.verdict));
ok([...vset].every((v) => ['smooth', 'ok', 'maybe', 'unknown', 'no'].indexOf(v) >= 0), 'verdict 取值合法', [...vset].join(','));
ok(real.stats.dist.smooth > 0, '真实数据里存在「流畅」档', String(real.stats.dist.smooth));
ok((real.stats.dist.maybe || 0) < real.stats.total * 0.3, '★「待确认」不再占大头（skip 口径生效）', 'maybe=' + (real.stats.dist.maybe || 0) + ' 条（总 ' + real.stats.total + '）');

/* 默认排序：吃配置的游戏排前面，而不是余量最大的小游戏 */
const first3 = real.items.slice(0, 3);
ok(first3.every((i) => i.verdict === 'smooth'), '榜首都是「流畅」档');
ok(first3.some((i) => i.scale >= 10), '★ 榜首出现规模较大的游戏（不是清一色小体量）', first3.map((i) => i.name + ':' + i.scale).join(' | '));
/* 缩写搜索：用户搜「GTA」，而库里叫 Grand Theft Auto V（实拍抓到 0 条才补的） */
eq(match.abbrOf('Grand Theft Auto V 传承版'), 'gtav', 'abbrOf 生成英文首字母缩写');
eq(match.abbrOf('只狼：影逝二度'), '', '纯中文名没有缩写（返回空串而非乱码）');
const gta = match.analyze(armTr, { q: 'GTA', limit: 5 });
ok(gta.items.length > 0 && /Grand Theft Auto/.test(gta.items[0].name),
  '★ 搜「GTA」能命中 Grand Theft Auto V', gta.items.map((i) => i.name).join(' / '));
ok(match.analyze(armTr, { q: 'grand', limit: 5 }).items.length > 0, '字面包含搜索仍然有效');

const byName = match.analyze(armTr, { limit: 5, sort: 'name' });
eq(byName.items[0].verdict, real.stats.dist.smooth > 0 ? real.items[0].verdict : byName.items[0].verdict, 'sort=name 仍是同 verdict 内排序');

/* ARM 无转译层时，不该出现「可跑」的 3A */
const armNo = match.analyze(armNoTr, { limit: 5 });
ok(armNo.items.every((i) => i.verdict === 'no'), '★ 无 x86 转译层 → 全部判不可跑');

/* ============ ⑥ 边界 ============ */
console.log('\n=== ⑥ 边界 ===');
ok(extract('').ok === false, '空字符串 → 明确失败');
ok(extract('   ').ok === false, '纯空白 → 明确失败');
const bad = extract('{不是 JSON');
ok(bad.ok === false && /JSON 解析失败/.test(bad.error), '非法 JSON → 返回可读错误', bad.error);
ok(extract(null).ok === false, 'null → 明确失败');

const arr = extract([{ memory: '8 GB' }, { memory: '16 GB' }]);
eq(arr.shape, 'array', '顶层数组被识别为多记录');
eq(arr.records.length, 2, '每条记录各自解析');
eq(arr.records[1].profile.ram.gb, 16, '第二条记录的画像独立');

let deep = { a: 1 };
for (let i = 0; i < 30; i++) deep = { n: deep };
let deepOk = true;
try { extract(deep); } catch (e) { deepOk = false; }
ok(deepOk, '★ 30 层深嵌套不爆栈（超深度被截断）');

const huge = extract({ memory: '8 GB', note: 'x'.repeat(2000) });
ok(huge.ok, '超长文本不阻断解析');
ok(huge.records[0].unknown.some((u) => u.key === 'note'), '★ 超长值不参与值通道（进 unknown 而非被误判）');

const named = extract({ game: 'Cyberpunk 2077', memory: '16 GB' });
eq(named.records[0].profile.name, 'Cyberpunk 2077', 'nameOf 提取记录名');

/* ============ ⑦ 自述接口 ============ */
console.log('\n=== ⑦ dictInfo（前端「判定依据」面板）===');
const di = match.dictInfo();
ok(di.ok, 'dictInfo 正常');
eq(di.dims.length, 4, '自述四个判定维度');
eq(di.dict, dict.DICT_VERSION, '版本号与词典一致');
ok(di.layers.length >= 3, '自述兼容层→DX 能力映射');

console.log('\n============================');
/* ★ 末行必须是「通过 n/m」这种紧凑格式：tools/run-all.js 用 `(\d+)\s*\/\s*(\d+)`
   取**最后一个**匹配当成绩。写成「通过 78 / 失败 0」会解析失败（中间夹了中文），
   汇总就会显示成 0/650 之类的假数据。 */
console.log('  通过 ' + pass + '/' + (pass + fail) + '（失败 ' + fail + '）');
console.log('============================');
process.exit(fail ? 1 : 0);
