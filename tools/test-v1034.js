#!/usr/bin/env node
/* tools/test-v1034.js —— v10.34「2-B 解包字段校准」的常驻防线
 *
 * 为什么要有它：v10.34 改的是 `data/spec-dict.js` 里的四处**看起来很小**的地方，
 *   但每一处都能悄悄让「四维判定」整体失真，而且**页面不会报错**：
 *     · 关键词顺序反了 ⇒ 一条关键词变成死词（cpu_abi 归了 cpu，arch 永远缺）
 *     · 裸版本号乱认 ⇒ `VULKAN_VERSION:"1.3"` 被当成「支持 DX 1.3」
 *     · 要求档字段名漏了 ⇒ `minRequirements.space` 进 unknown
 *     · 记录名只看顶层 ⇒ 机型认不出来，切换器显示「记录 #1」
 *   实测代价（`tools/_probe-spec.js`）：假阴性 8,309 款、14,552 款从可判掉成待确认。
 *
 * 口径：全部**行为级**断言（跑 classify / extract / judge 看结果），
 *   只有「接口不许被牵连改动」那一条读源码，且**先剥注释**再判。
 *   纯离线、无网络、无 CDP；退出码挂在失败数上（run-all 靠它）。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const dict = require(path.join(ROOT, 'data', 'spec-dict.js'));
const match = require(path.join(ROOT, 'data', 'spec-match.js'));

let pass = 0, fail = 0;
const ok = (cond, name, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name + (detail ? '  — ' + detail : '')); }
  else { fail++; console.log('  × FAIL  ' + name + (detail ? '  — ' + detail : '')); }
};
const eq = (got, want, name) => ok(got === want, name, '得到 ' + JSON.stringify(got) + '，期望 ' + JSON.stringify(want));

const ex = (obj) => dict.extract(JSON.stringify(obj));
const prof = (obj) => ex(obj).records[0].profile;
const cls = (key, anc) => {
  const c = dict.classify({ key, anc: anc || '', value: 'x' });
  return c ? c.group : '';
};
const dimOf = (p, spec, dim) => match.judge(p, spec).dims.find((d) => d.dim === dim);
/* ⚠️ 取值一律走这两个**防崩**助手。
   反证实测踩到：`prof(...).api.find(a=>a.kind==='dx').v` 在实现被打坏后是
   `undefined.v` ⇒ **TypeError 直接崩**，套件的 FAIL 行压根没打印出来 ——
   于是「断言抓住问题」变成「进程崩了」，反证工具只看到「没有任何 FAIL 行」。
   断言必须能**报出结论**，而不是把自己崩掉。 */
const dxV = (obj) => { const a = (prof(obj).api || []).find((x) => x.kind === 'dx'); return a ? a.v : null; };
const archRaw = (obj) => { const a = prof(obj).arch; return a ? a.raw : null; };
const ramGb = (obj) => { const r = prof(obj).ram; return r ? r.gb : null; };
const stGb = (obj) => { const s = prof(obj).storage; return s ? s.gb : null; };

/* ================= ① 键名通道顺序：cpu_abi 必须归 arch ================= */
console.log('\n=== ① 关键词顺序（arch 必须在 cpu 之前，否则 cpuabi 是死词） ===');
{
  /* ★ 行为级：直接看规则表里的相对位置，而不是在源码里找字符串 —— 顺序本来就该被断言 */
  const ai = dict.KEY_RULES.findIndex((r) => r.group === 'arch');
  const ci = dict.KEY_RULES.findIndex((r) => r.group === 'cpu');
  ok(ai >= 0 && ci >= 0 && ai < ci, '★ KEY_RULES 里 arch 排在 cpu 之前（顺序即优先级）',
    'arch@' + ai + ' cpu@' + ci);

  eq(cls('cpu_abi'), 'arch', '★ cpu_abi 归「架构」（原先归 cpu ⇒ arch 维度永远缺）');
  eq(cls('cpuabi'), 'arch', 'cpuabi 归架构');
  eq(cls('CPU_ABI'), 'arch', 'CPU_ABI 大小写归一后仍归架构');
  eq(cls('cpu_arch'), 'arch', 'cpu_arch 归架构');
  eq(cls('cpuarchitecture'), 'arch', 'cpuarchitecture 归架构');
  eq(cls('arch'), 'arch', 'arch 归架构');
  eq(cls('abi'), 'arch', 'abi 归架构');

  /* 反向：不许把 cpu 这条通道整条吃掉 */
  eq(cls('cpu'), 'cpu', '反向：cpu 自己仍归处理器');
  eq(cls('cpu_model'), 'cpu', '反向：cpu_model 仍归处理器');
  eq(cls('processor'), 'cpu', '反向：processor 仍归处理器');
  eq(cls('soc'), 'cpu', 'soc 归处理器（解包 JSON 常写 device.soc）');
  /* 反向：gpu 仍在 arch 之前（gpu_architecture 不能被 arch 抢走） */
  eq(cls('gpu_architecture'), 'gpu', '★ 反向：gpu_architecture 仍归显卡（gpu 排在 arch 前）');
  eq(cls('vram'), 'vram', '反向：vram 仍归显存（没被 ram 截走）');
}

/* ================= ② 图形接口：裸版本号不许冒充 DX ================= */
console.log('\n=== ② 值通道（裸版本号无法自证是 DX） ===');
{
  const vk = prof({ arch: 'arm64-v8a', memory: '12 GB', VULKAN_VERSION: '1.3' });
  const vkDx = (vk.api || []).filter((a) => a.kind === 'dx');
  eq(vkDx.length, 0, '★ VULKAN_VERSION:"1.3" 不再被认成「支持 DX 1.3」', JSON.stringify(vk.api));
  ok((vk.api || []).some((a) => a.kind === 'vulkan'), '同一个键仍被认成 vulkan（不是丢掉）', JSON.stringify(vk.api));

  const vk2 = prof({ arch: 'arm64-v8a', vulkan: '1.3' });
  eq((vk2.api || []).filter((a) => a.kind === 'dx').length, 0, 'vulkan:"1.3" 也不冒充 DX');

  const gl = prof({ arch: 'x86_64', OPENGL_VERSION: '4.6' });
  eq((gl.api || []).filter((a) => a.kind === 'dx').length, 0, 'OPENGL_VERSION:"4.6" 不冒充 DX');

  /* ★ 最要紧的一条：伪造的 DX 会把 dxCap 上限压到 1.3 ⇒ 全线假阴性 */
  eq(match.dxCap(vk), null, '★ VULKAN_VERSION 的配置，dxCap 为 null（不再被压成 DX 1.3）');
  eq(match.dxCap(prof({ arch: 'x86_64', VULKAN_VERSION: '1.3' })), null,
    '★ 纯 VULKAN_VERSION 的 x86 配置，dxCap 仍为 null ⇒ dx 判 unknown 而不是 fail');

  /* 正向：真 DX 必须继续认（不能为了修假阳性把真值一起打死）。
     用 `dxV()` 取值 —— 实现若被打坏，这里要**报红**而不是抛 TypeError。 */
  eq(dxV({ DX_VERSION: '11' }), 11, '正向：DX_VERSION:"11" → dx 11');
  eq(dxV({ directx: '9.0c' }), 9, '正向：directx:"9.0c" → dx 9');
  eq(dxV({ d3d: 12 }), 12, '正向：d3d:12 → dx 12');
  eq(dxV({ '图形接口': 'DirectX 11' }), 11, '正向：中文键「图形接口」的值含 DirectX → dx 11');
  eq(prof({ minRequirements: { dx: 12 } }).req.dx, 12, '正向：要求档 dx 仍进 p.req.dx（≠ 能力）');
  eq((prof({ minRequirements: { dx: 12 } }).api || []).length, 0, '★ 反向：要求档 dx 不许进自身能力表');
  /* 层通道不受影响 */
  ok(match.dxCap(prof({ arch: 'arm64-v8a', compatibility: { dxvk: '2.4' } })).max === 11,
    '反向：dxvk 层仍给出 DX11 上限');
  ok(match.dxCap(prof({ arch: 'arm64-v8a', compatibility: { vkd3d: '2.12' } })).max === 12,
    '反向：vkd3d 层仍给出 DX12 上限');
}

/* ================= ③ 存储：space 要认，namespace 不许混进来 ================= */
console.log('\n=== ③ storage 关键词（space 认，namespace 不认） ===');
{
  eq(prof({ minRequirements: { space: '70 GB' } }).req.storage, 70, '★ minRequirements.space 进「要求档存储」');
  eq(stGb({ space: '70 GB' }), 70, '裸 space 键进自身存储');
  eq(stGb({ storagespace: '70 GB' }), 70, 'storagespace 仍进存储');
  eq(stGb({ storage: '70 GB' }), 70, 'storage 仍进存储');
  eq(stGb({ disk_free: '需要 13 GB 可用空间' }), 13, '中文脏值「需要 13 GB 可用空间」仍能解析');

  /* ★ 排除项：不兜住的话「未识别」会被算成「已识别」，识别率虚高。
     注意**为什么要断言「键的分类」而不是「画像里有没有值」**：
     `namespace:'x'` 即便被归进 storage，`toGB('x')` 也解不出数字 ⇒ 画像照样是 null，
     那条断言**永远是绿的**（反证实测抓出来的假绿）。真正会变的是分类结果与识别率。 */
  ok(cls('namespace') !== 'storage', '★ 反向：namespace 这个键不许归到存储（否则识别率虚高）', cls('namespace'));
  const ns = ex({ namespace: 'x', memory: '16 GB' });
  ok(ns.records[0].unknown.some((u) => u.key === 'namespace'),
    '★ 反向：namespace 老老实实留在「未识别」里（否则识别率虚高）', JSON.stringify(ns.records[0].unknown.map((u) => u.key)));
  const st = dict.KEY_RULES.find((r) => r.group === 'storage');
  ok(st && st.not && st.not.test('namespace') && !st.not.test('space'), 'storage 规则带排除项且不误伤 space');
}

/* ================= ④ 记录名：机型 / 嵌套 / 既有行为 ================= */
console.log('\n=== ④ nameOf（机型 · 嵌套 · 不许退化） ===');
{
  eq(prof({ device: { model: 'Xiaomi 24095PCADG', ram: '12 GB' } }).name, 'Xiaomi 24095PCADG',
    '★ device.model（嵌套）能取到机型');
  eq(prof({ '机型': '小米 15', '内存': '12 GB' }).name, '小米 15', '★ 中文键「机型」能取到机型');
  eq(prof({ device_model: 'SM-S938B' }).name, 'SM-S938B', 'device_model 能取到机型');
  eq(prof({ device: { name: 'Odin 2' } }).name, 'Odin 2', 'device.name 能取到');
  eq(prof({ device: { model: 'Xiaomi 24095PCADG' }, game: { title: 'Cyberpunk 2077' } }).name,
    'Xiaomi 24095PCADG', '★ 机型与游戏名同时在时，取机型（这份 JSON 描述的是运行环境）');
  eq(prof({ game: { title: 'Cyberpunk 2077' } }).name, 'Cyberpunk 2077', '只有 game.title 时取游戏名');
  /* ★ 既有行为不许退化（v10.20 就有这条断言，改 nameOf 最容易撞坏它） */
  eq(prof({ game: 'Cyberpunk 2077', memory: '16 GB' }).name, 'Cyberpunk 2077',
    '★ 不退化：顶层 game 是**字符串**时仍取作记录名');
  eq(prof({ name: '配置 A' }).name, '配置 A', '不退化：顶层 name 仍取作记录名');
  const arr = ex([{ name: '张三的手机' }, { name: '李四的平板' }]);
  eq(arr.records[0].profile.name, '张三的手机', '不退化：数组记录逐条取名');
  eq(arr.records[1].profile.name, '李四的平板', '不退化：第二条记录也取名');
  eq(prof({ a: 1, b: 2 }).name, '', '反向：没有任何名字键时给空串（不许瞎编）');
}

/* ================= ⑤ 端到端：四维判定（真跑 judge） ================= */
console.log('\n=== ⑤ 端到端四维判定 ===');
{
  const spec = { ramGb: 8, storageGb: 40, dx: 11 };
  /* 解包工具最常见的写法：cpu_abi + 兼容层齐全 */
  const good = prof({ cpu_abi: 'arm64-v8a', memory: '12 GB', storage_free: '256 GB', compatibility: { box64: '0.3.4', dxvk: '2.4', turnip: '24.1' } });
  eq(archRaw({ cpu_abi: 'arm64-v8a', memory: '12 GB', storage_free: '256 GB', compatibility: { box64: '0.3.4', dxvk: '2.4', turnip: '24.1' } }),
    'arm64-v8a', '★ 只有 cpu_abi 也能拿到 arch');
  eq(dimOf(good, spec, 'arch').state, 'ok', 'ARM + box64 ⇒ arch 通过');
  eq(dimOf(good, spec, 'dx').state, 'ok', 'dxvk ⇒ DX11 要求通过');
  /* 「流畅」只由**内存余量**决定（≥ 2 倍），这是 v10.22 校准过的口径。
     12/8 = 1.5 < 2 ⇒ 只到「可跑」；换成 4 GB 要求的游戏才够 2 倍。 */
  eq(match.judge(good, spec).verdict, 'ok', '四维齐备但内存只有 1.5 倍 ⇒ 判「可跑」');
  eq(match.judge(good, { ramGb: 4, storageGb: 40, dx: 11 }).verdict, 'smooth',
    '内存 ≥ 2 倍 ⇒ 判「流畅」（口径没被这次改动牵连）');

  /* ⚠️ 「ARM 缺转译层」这条口径**已在 v10.35 由用户决策改掉**（原判 fail ⇒ 现判 unknown）。
     本套件只保留「改完仍是 unknown」这个**事实断言**，专门盯它被**悄悄改回 fail**；
     完整口径断言 + 反证见 tools/test-v1035.js / tools/_counterproof-v1035.js。
     （改判的理由与实测数字写在 data/spec-match.js 的 cmpArch 上方注释里。） */
  const noTr = prof({ cpu_abi: 'arm64-v8a', memory: '12 GB', storage_free: '256 GB', compatibility: { dxvk: '2.4' } });
  eq(dimOf(noTr, spec, 'arch').state, 'unknown', '★ ARM 且兼容层里没有 x86 转译层 ⇒ arch 判「待确认」（v10.35 口径）');
  eq(match.judge(noTr, spec).verdict, 'maybe', '★ 缺转译层信息 ⇒ 整款「待确认」，**不许**判「不可跑」（v10.35 口径）');

  /* 反向：既有口径不许被顺手改掉 */
  eq(dimOf(prof({ memory: '16 GB' }), spec, 'arch').state, 'skip', '反向：没标架构且无 ARM 专用层 ⇒ arch skip');
  eq(dimOf(prof({ compatibility: { turnip: '24.1' } }), spec, 'arch').state, 'unknown',
    '反向：没标架构但有 turnip ⇒ arch unknown（提示补 arch）');
  eq(dimOf(prof({ arch: 'x86_64', memory: '16 GB' }), spec, 'arch').state, 'ok', '反向：x86 直接执行 ⇒ arch ok');
}

/* ================= ⑥ 接口与版本（只读源码一遍，先剥注释） ================= */
console.log('\n=== ⑥ 词典版本 / 接口未被牵连 ===');
{
  const DICT_SRC = fs.readFileSync(path.join(ROOT, 'data', 'spec-dict.js'), 'utf8');
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  const DICT_C = stripComments(DICT_SRC);

  eq(dict.DICT_VERSION, 'v10.34', '词典版本号已随内容 +1');
  ok(/v10\.34/.test(DICT_C), '源码里确有 v10.34 的说明（防「只改版本号不改内容」）');
  /* ⚠️ 这里**故意不写**「源码里不许出现 cpu 排在 arch 前」这种字符串反向断言：
     文件头注释里**特意**解释了旧写法，字符串判会假红（v10.33 实测踩过，说明要先剥注释）；
     而且顺序这件事在 ① 已有**行为级**断言（看规则表里的相对下标），不必再来一条脆的。 */

  /* 设计约束：这一版**只改词典**，接口 / 前端一律不动 */
  const SERVER_C = stripComments(fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8'));
  ok(/specDict\.extract\(/.test(SERVER_C), '★ 反向：/api/spec/analyze 仍走 specDict.extract（接口没被牵连）');
  ok(/specMatch\.analyze\(/.test(SERVER_C), '★ 反向：仍走 specMatch.analyze');
  const UNPACK = fs.readFileSync(path.join(ROOT, 'public', 'unpack.html'), 'utf8');
  ok(/\/api\/spec\/analyze/.test(UNPACK), '★ 反向：解包页仍打同一个接口（本轮不改前端字节）');
  ok(/DIM_NAME = \{ arch/.test(UNPACK), '★ 反向：前端四维命名表仍在（页面仍按 arch/dx/ram/storage 展示）');
}

console.log('\n============================');
console.log('  通过 ' + pass + '/' + (pass + fail) + '（失败 ' + fail + '）');
console.log('============================');
process.exit(fail ? 1 : 0);
