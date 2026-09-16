/* tools/test-device-translate.js — 机型「转译」链路回归 —— 第 11 道防线
 *
 * 把 `SM S938B` / `Xiaomi 22101320G` 这种内部代号翻成人看得懂的配置，
 * 是一条**四跳链路**，每一跳都可能静默出错（查不到就返回 null，界面只是「不显示」）：
 *
 *   机型 →（逐条配对 bannerhub-files）GPU →（gpu-soc 表）SoC →（soc-cpu 表）CPU 核簇
 *
 * 这一版（v10.12）补的是**第四跳**。它原先挂空：
 *   device-board.json 只有 200 条主板，对库内 66 个 SoC 只命中 1 个
 *   → 实测 967 台机型「有 SoC 无 CPU」，CPU 覆盖率 **0%**。
 *   换成 data/soc-cpu.json（tools/fetch-soc-cpu.js 从 nanoreview 抓的 343 条）后 → 92.4%。
 *
 * 顺带修掉一个**只有截图才能发现的真 bug**：
 *   `.dm-info{display:none}` 写在 CSS 规则里，JS 用 `info.style.display = ''`（清内联）
 *   根本盖不住 → 机型信息卡（芯片/GPU/性能档/CPU）**一直是隐藏的**。
 *
 * 本脚本钉死的不变量：
 *   A. 链路的**覆盖率下限**（GPU/SoC/CPU 三项，掉下去就亮灯）
 *   B. 第四跳的**语义正确性**（不是「有值就行」—— 要值对）
 *   C. fmtCpu 句式归一化（nanoreview 句式 / device-board 句式 → 统一紧凑串）
 *   D. 静态护栏：`.dm-info` 的显示必须显式给非 none 值
 *
 * 运行：node tools/test-device-translate.js
 * 依赖：无需服务端
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const dg = require('../data/device-gpu');
const dm = require('../data/device-match');

let pass = 0, fail = 0;
const bad = [];
function t(ok, label, detail) {
  if (ok) pass++; else { fail++; bad.push(label); }
  console.log(`${ok ? '  PASS' : '× FAIL'}  ${label}${detail ? '  —— ' + detail : ''}`);
}

const spec = (m) => dg.specOf(m);

/* ============================================================
 * A. 链路覆盖率下限
 * ============================================================ */
console.log('\n=== A. 四跳链路覆盖率 ===');

dm.load();
const ALL = dm.models({ limit: 100000 });
const nGpu = ALL.filter((d) => d.gpu).length;
const nSoc = ALL.filter((d) => d.soc).length;
const nCpu = ALL.filter((d) => d.cpu).length;
const pct = (n) => (n / ALL.length) * 100;

console.log(`  机型 ${ALL.length} ｜ GPU ${nGpu} (${pct(nGpu).toFixed(1)}%) ｜ SoC ${nSoc} (${pct(nSoc).toFixed(1)}%) ｜ CPU ${nCpu} (${pct(nCpu).toFixed(1)}%)`);

/* 下限设得比实测略低，留一点数据波动的余量，但足以拦住「整跳挂掉」 */
t(pct(nGpu) >= 95, 'GPU 覆盖 ≥ 95%', pct(nGpu).toFixed(1) + '%');
t(pct(nSoc) >= 90, 'SoC 覆盖 ≥ 90%', pct(nSoc).toFixed(1) + '%');
/* ★ CPU 是这一版的主角：修之前是 0%，门槛设在 88% 拦住任何回退 */
t(pct(nCpu) >= 88, 'CPU 覆盖 ≥ 88%（修前为 0%）', pct(nCpu).toFixed(1) + '%');
t(nCpu > nSoc * 0.95, 'CPU 基本跟得上 SoC（不存在整跳真空）', `SoC ${nSoc} → CPU ${nCpu}`);

/* 有 SoC 却没 CPU 的机型，只剩 nanoreview 未收录的那几个老芯片 */
const gapSocs = [...new Set(ALL.filter((d) => d.soc && !d.cpu).map((d) => d.soc))];
t(gapSocs.length <= 6, '「有 SoC 无 CPU」的 SoC 种类 ≤ 6 个', gapSocs.join(' , ') || '无');

/* ============================================================
 * B. 第四跳的语义正确性（值要对，不只是「有值」）
 * ============================================================ */
console.log('\n=== B. CPU 描述语义 ===');

const CASES = [
  /* 机型, 期望 SoC, CPU 必须包含的核心名 */
  ['小米15', 'Snapdragon 8 Elite (Gen 4)', 'Oryon'],
  ['Redmi K80 Pro', 'Snapdragon 8 Elite (Gen 4)', 'Oryon'],
  ['SM S938B', 'Snapdragon 8 Elite (Gen 4)', 'Oryon'],
  ['Redmi Turbo 4', 'Dimensity 8400', 'Cortex-A725'],
  ['iQOO Z9 Turbo', 'Snapdragon 8s Gen 3', 'Cortex'],
  ['红米Note 14 Pro+', 'Snapdragon 7s Gen 3', 'Kryo'],
  ['Google Pixel 9', 'Tensor G4', 'Cortex'],
  ['N49 SM8650', 'Snapdragon 8 Gen 3', 'Cortex-X4'],
  ['Xiaomi 22101320G', 'Snapdragon 778G', 'Kryo'],
  ['24069PC21G SM8635', 'Snapdragon 8s Gen 3', 'Cortex'],
];
for (const [model, wantSoc, wantCore] of CASES) {
  const s = spec(model);
  const okSoc = !!(s && s.soc === wantSoc);
  const okCpu = !!(s && s.cpu && s.cpu.includes(wantCore));
  t(okSoc && okCpu, `${model} → ${wantSoc} + CPU(${wantCore})`,
    s ? `实得 SoC=${s.soc || '空'} / CPU=${s.cpu || '空'}` : 'null');
}

/* ★ 纠偏回归：这几条都是「拿 GPU 反查 SoC」会张冠李戴的典型 ——
   同一颗 GPU 被一整个系列共用，反查只能取 nanoreview 排第一的那个。
   MT6897 的 soc-db id 是 `dimensity_8350_mt6897…`，市场名就该是 Dimensity 8350。 */
console.log('\n--- 同 GPU 系列的纠偏（v10.12 新增 marketFromId / upgradeSoc）---');
const CORRECT = [
  ['TECNO LJ9 MT6897', 'Dimensity 8350', 'Dimensity 9400e'],
  ['2311DRK48G MT6897', 'Dimensity 8350', 'Dimensity 9400e'],
  ['Infinix X6833B MT6789', 'Helio G100', 'Dimensity 1080'],
  ['Xiaomi 22101320G', 'Snapdragon 778G', 'SM7325'],
];
for (const [model, want, wasWrong] of CORRECT) {
  const s = spec(model);
  const got = s ? s.soc : '';
  t(got === want, `${model} → ${want}（不再错成 ${wasWrong}）`, `实得 ${got || '空'}`);
}

/* 芯片编号后缀兜底：SM8750P 在 soc-db 里只登记了 SM8750 */
const sfx = spec('TB322FC SM8750P');
t(!!(sfx && sfx.soc === 'Snapdragon 8 Elite (Gen 4)'), '带后缀编号 SM8750P 退到基号 SM8750', sfx ? sfx.soc : 'null');

/* ============================================================
 * C. fmtCpu 句式归一化
 * ============================================================ */
console.log('\n=== C. fmtCpu 句式归一化 ===');

const FMT = [
  /* nanoreview 句式（长、带 and、MHz） */
  ['1 core Cortex-X925 at 3620 MHz, 3 cores Cortex-X4 at 3300 MHz, and 4 cores Cortex-A720 at 2400 MHz',
    '1×Cortex-X925 @3.62GHz · 3×Cortex-X4 @3.3GHz · 4×Cortex-A720 @2.4GHz'],
  /* device-board 句式（无分隔符、GHz） */
  ['1x Cortex-X925 @ 3.6GHz 3x Cortex-X4 @ 3.3GHz 4x Cortex-A720 @ 2.4GHz',
    '1×Cortex-X925 @3.6GHz · 3×Cortex-X4 @3.3GHz · 4×Cortex-A720 @2.4GHz'],
  /* 带括号的完整核名 */
  ['2 cores Kryo 465 Gold (Cortex-A76) at 2300 MHz and 6 cores Kryo 465 Silver (Cortex-A55) at 1800 MHz',
    '2×Kryo 465 Gold (Cortex-A76) @2.3GHz · 6×Kryo 465 Silver (Cortex-A55) @1.8GHz'],
  /* 单簇 */
  ['8x Cortex-A53 @ 1.8GHz', '8×Cortex-A53 @1.8GHz'],
  /* 空值 / 占位符：不能吐出 '-GHz' 这种东西 */
  ['-', ''],
  ['', ''],
];
for (const [raw, want] of FMT) {
  const got = dg.fmtCpu(raw);
  t(got === want, `fmtCpu(${JSON.stringify(raw.slice(0, 34) + (raw.length > 34 ? '…' : ''))})`, got === want ? '' : `实得 ${JSON.stringify(got)}`);
}

/* 归一化后的串不能出现这些脏东西 */
const dirty = ALL.map((d) => d.cpu).filter((c) => c && (/undefined|NaN|-GHz|\d\.\s*GHz|@\s*GHz/.test(c)));
t(dirty.length === 0, '所有 CPU 串无脏值（undefined / -GHz / 空频率）', dirty.slice(0, 3).join(' | '));

/* ============================================================
 * D. 静态护栏：机型卡必须真的能显示出来
 * ============================================================ */
console.log('\n=== D. 静态护栏（public/emulator.html 与 tools/emulator-sections.js）===');

const emuHtml = fs.readFileSync(path.join(ROOT, 'public', 'emulator.html'), 'utf8');
const sections = fs.readFileSync(path.join(ROOT, 'tools', 'emulator-sections.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

/* ★ 这条是本版最值钱的断言：CSS 里 `.dm-info{display:none}` 是「类规则」，
   `style.display = ''` 只是清掉内联样式，CSS 会继续赢 → 卡片永远不显示。 */
t(/\.dm-info\{[^}]*display\s*:\s*none/.test(indexHtml), '前提仍在：CSS 里 .dm-info 默认 display:none', '');
t(/info\.style\.display\s*=\s*'block'/.test(sections), "源码里 info.style.display = 'block'（不是 ''）", '');
t(/info\.style\.display\s*=\s*'block'/.test(emuHtml), '派生页 emulator.html 已同步该修复', '');
t(!/info\.style\.display\s*=\s*''/.test(sections), "源码里不再有 info.style.display = ''（踩坑写法）", '');

/* CPU 那一行必须真的渲染出来（不是只存在数据里） */
t(/class="dm-info-cpu"/.test(sections), '源码渲染 .dm-info-cpu 行', '');
t(/dv\.cpu\s*\?/.test(sections), 'CPU 行按 dv.cpu 有无条件渲染', '');
t(/dm-info-cpu/.test(emuHtml), '派生页同步了 .dm-info-cpu', '');

/* 长串必须允许换行，否则窄屏会把卡片撑破 */
t(/\.dm-info-cpu code\{[^}]*word-break\s*:\s*break-word/.test(indexHtml), 'CPU 串允许断词换行（word-break）', '');
t(/\.dm-info-cpu code\{[^}]*min-width\s*:\s*0/.test(indexHtml), 'flex 子项有 min-width:0（否则不换行）', '');

/* 数据源必须存在且是本次的产物 */
const socCpuPath = path.join(ROOT, 'data', 'soc-cpu.json');
t(fs.existsSync(socCpuPath), 'data/soc-cpu.json 存在', '');
if (fs.existsSync(socCpuPath)) {
  const sc = JSON.parse(fs.readFileSync(socCpuPath, 'utf8'));
  const keys = Object.keys(sc.map || {});
  const codes = keys.filter((k) => /^(sm|mt|msm|sdm)[0-9]/.test(k));
  t(keys.length >= 300, 'soc-cpu.json 条目 ≥ 300（246 市场名 + 芯片编号别名）', String(keys.length));
  /* nanoreview 只按市场名索引；芯片编号键是 attachChipCodes 借 soc-db 的 id 反挂上去的
     （能挂上的主要是联发科，高通那边 id 常写成 `snapdragon_sm8650`、没有市场名可挂） */
  t(codes.length >= 50, 'soc-cpu.json 含 ≥ 50 个芯片编号别名键', String(codes.length));
  t(!!sc.map.mt6765, 'soc-cpu.json 编号别名可用（mt6765）', sc.map.mt6765 ? sc.map.mt6765.cpu : '空');
}

/* 高通那几个 soc-db 里「id 不带市场名」的，靠 device-alias.json 的 chipMarket 补 */
const aliasPath = path.join(ROOT, 'data', 'device-alias.json');
t(fs.existsSync(aliasPath), 'data/device-alias.json 存在', '');
if (fs.existsSync(aliasPath)) {
  const al = JSON.parse(fs.readFileSync(aliasPath, 'utf8'));
  const cm = al.chipMarket || {};
  t(cm.sm7325 === 'Snapdragon 778G', 'chipMarket: sm7325 → Snapdragon 778G', String(cm.sm7325 || '空'));
  t(cm.sm8635 === 'Snapdragon 8s Gen 3', 'chipMarket: sm8635 → Snapdragon 8s Gen 3', String(cm.sm8635 || '空'));
}

/* ============================================================ */
console.log('\n' + '='.repeat(68));
console.log(`机型转译回归：${pass} / ${pass + fail} 通过`);
if (fail) {
  console.log('失败项：');
  bad.forEach((b) => console.log('  × ' + b));
}
process.exit(fail ? 1 : 0);
