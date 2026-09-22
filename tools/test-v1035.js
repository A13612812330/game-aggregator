#!/usr/bin/env node
/* tools/test-v1035.js —— v10.35「arch 口径」的常驻防线
 *
 * 为什么要有它：v10.34 让 `cpu_abi` 能读出「这是 ARM」之后，**任何没写 x86 转译层的配置
 *   都被判 arch fail ⇒ 整款「不可跑」**。实测（tools/_probe-spec.js 画像 G，全库）：
 *       v10.33 ⇒ 待确认 14,552 / 信息不足 240 / 不可跑 1,727
 *       v10.34 ⇒ **不可跑 16,519（100%）**  ← 一个键（box64 有没有出现在导出里）翻掉整库
 *       参考组 H（同设备 + 有 box64）⇒ 流畅 10,081 / 可跑 5,739 / 不可跑 699
 *   用户 2026-09-22 决策：**降回「待确认」**。理由（同时写在 data/spec-match.js 的 cmpArch 上方）：
 *     「导出物里没写 box64」与「设备没有 box64」**无法区分**，判错代价不对称
 *     （误判 fail ⇒ 整库显示不可跑；误判 unknown ⇒ 只显示待确认），
 *     且与本文件既有口径一致 —— `req == null → skip`（**没标就一律不降级**）。
 *
 * 本套件钉住三件事，任何一件被改回去都必须变红：
 *   ① ARM + 找不到转译层（不管有没有列别的兼容层）⇒ arch **unknown**，整款不许判「不可跑」；
 *   ② **唯一保留 fail 的情形**：配置**显式声明**转译层不可用（值 = off/disabled/false/无…）；
 *   ③ 既有分支（x86 / 无 arch / 无层 / 空值版本号）不许被顺手带走。
 *   另加一条**影响面**断言：画像 G 跑全库，arch 维度 fail 计数必须为 **0**。
 *
 * 口径：全部**行为级**断言（真跑 extract / judge），不读源码字符串，纯离线、无网络、无 CDP。
 *   退出码挂在失败数上（run-all 靠它）；末尾打印「通过 n / m」——崩了就没有这一行，
 *   好让反证工具把「套件崩了」与「断言没抓住」区分开（见 tools/_counterproof-v1035.js）。
 */
'use strict';
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

const prof = (obj) => dict.extract(JSON.stringify(obj)).records[0].profile;
/* ⚠️ 取值一律走**防崩**助手：实现被打坏后 `dims.find(...)` 可能返回 undefined，
   直接 `.state` 会抛 TypeError ⇒ 套件崩、一行 FAIL 都没打 ⇒ 反证误判。
   断言必须能**报出结论**，不能把自己崩掉。 */
const dimOf = (p, spec, dim) => { const j = match.judge(p, spec); return (j.dims || []).find((d) => d.dim === dim); };
const st = (obj, spec, dim) => { const d = dimOf(prof(obj), spec, dim); return d ? d.state : '(该维度缺失)'; };
const vd = (obj, spec) => { const j = match.judge(prof(obj), spec); return j && j.verdict ? j.verdict : '(无判定)'; };

const SPEC = { ramGb: 8, storageGb: 40, dx: 11 };     /* 通用要求档：四维都能判 */
const ARM_DXVK = { arch: 'arm64-v8a', memory: '12 GB', storage_free: '256 GB', compatibility: { dxvk: '2.4', turnip: '24.1' } };

/* ================= ① 口径核心：缺转译层 ⇒ 待确认，不是不可跑 ================= */
console.log('\n=== ① ARM 缺 x86 转译层 ⇒ arch「待确认」（v10.35 口径） ===');
{
  /* 1) 解包工具最典型的写法：cpu_abi 说明是 ARM，兼容层里只有 dxvk/turnip */
  const g = { cpu_abi: 'arm64-v8a', memory: '12 GB', storage_free: '256 GB', compatibility: { dxvk: '2.4', turnip: '24.1' } };
  eq(st(g, SPEC, 'arch'), 'unknown', '★ 画像 G：cpu_abi=ARM + 无 box64 ⇒ arch「待确认」（v10.34 判 fail）');
  eq(vd(g, SPEC), 'maybe', '★ 画像 G ⇒ 整款「待确认」，**不许**判「不可跑」');

  /* 2) 连兼容层都没有：更没有任何信息可依据 */
  const bare = { arch: 'arm64-v8a', memory: '12 GB', storage_free: '256 GB' };
  eq(st(bare, SPEC, 'arch'), 'unknown', '★ 完全没有兼容层信息 ⇒ arch「待确认」（不许 fail）');
  eq(vd(bare, SPEC), 'maybe', '★ 只有 arch 一个维度缺信息 ⇒ 「待确认」');

  /* 3) 列了「别的」转译层之外的层，也一样 —— 层列表不为空不是「明确不支持」 */
  const wineonly = { arch: 'arm64-v8a', memory: '12 GB', storage_free: '256 GB', compatibility: { wine: '9.0' } };
  eq(st(wineonly, SPEC, 'arch'), 'unknown', '★ 只列了 wine（不是 x86 转译层）⇒ 仍判「待确认」');

  /* 4) 反向：有转译层就必须是 ok（口径放宽不许把这条带走） */
  eq(st({ ...ARM_DXVK, compatibility: { box64: '0.3.4', dxvk: '2.4' } }, SPEC, 'arch'), 'ok', '反向：ARM + box64 ⇒ arch 通过');
  eq(st({ arch: 'arm64-v8a', compatibility: { fex: '2401' } }, SPEC, 'arch'), 'ok', '反向：ARM + FEX ⇒ arch 通过');
  eq(st({ arch: 'arm64-v8a', compatibility: { box86: '0.3.4' } }, SPEC, 'arch'), 'ok', '反向：ARM + box86 ⇒ arch 通过');
}

/* ================= ② 唯一保留 fail 的情形：**显式声明**不可用 ================= */
console.log('\n=== ② 配置显式声明转译层不可用 ⇒ 仍判 fail（唯一保留的情形） ===');
{
  const off = (v) => ({ arch: 'arm64-v8a', memory: '12 GB', storage_free: '256 GB', compatibility: { box64: v } });
  for (const v of ['off', 'disabled', 'false', 'no', 'none', '0', '无', '禁用']) {
    eq(st(off(v), SPEC, 'arch'), 'fail', '★ box64 显式写成「' + v + '」⇒ arch fail（有信息量的明确不支持）');
  }
  eq(vd(off('disabled'), SPEC), 'no', '★ 显式不可用 ⇒ 整款「不可跑」');
  /* 反向：**空值 ≠ 禁用**。导出物里键在值空很常见，那是「没填」不是「不支持」。 */
  eq(st(off(''), SPEC, 'arch'), 'ok', '★ 反向：box64 值为空串 ⇒ 仍算「有转译层」（空值不是禁用）');
  eq(st(off('0.3.4'), SPEC, 'arch'), 'ok', '反向：box64 有版本号 ⇒ 通过');
  eq(st({ arch: 'arm64-v8a', compatibility: { box64: 'OFF' } }, SPEC, 'arch'), 'fail', '反向：大小写不敏感（OFF 也判不可用）');
}

/* ================= ③ 既有分支不许被牵连 ================= */
console.log('\n=== ③ 既有分支不许被这次口径改动带走 ===');
{
  eq(st({ arch: 'x86_64', memory: '16 GB' }, SPEC, 'arch'), 'ok', '反向：x86_64 可直接执行 ⇒ ok');
  eq(st({ arch: 'amd64', memory: '16 GB' }, SPEC, 'arch'), 'ok', '反向：amd64 ⇒ ok');
  eq(st({ arch: 'i386', memory: '16 GB' }, SPEC, 'arch'), 'ok', '反向：i386 ⇒ ok');
  eq(st({ arch: 'mips' }, SPEC, 'arch'), 'unknown', '反向：认不出的架构值 ⇒ unknown（不是 fail）');
  eq(st({ compatibility: { turnip: '24.1' } }, SPEC, 'arch'), 'unknown',
    '反向：没标架构但有 turnip ⇒ unknown（提示补 arch，v10.20 既有口径）');
  eq(st({ memory: '16 GB' }, SPEC, 'arch'), 'skip',
    '★ 反向：既没标架构、又没有 ARM 专用层 ⇒ skip（不是 unknown、更不是 fail）');
}

/* ================= ④ 口径一致性：「只缺信息」一律不许产生 fail ================= */
console.log('\n=== ④ 与既有口径一致：只缺信息 ⇒ 不降级（四种情形都不许出现 fail 维度） ===');
{
  /* ★ 这条是这次口径决策的**依据本身**，必须被钉住：
     同一个文件里，`req == null → skip`（游戏没标要求）与「配置没标转译层」
     属于同一类「没信息」。既然前者不降级，后者也不该单方面降级。 */
  /* 期望值说明：只有**关键维度**（KEY_DIMS = arch / ram）缺信息才降到「待确认」；
     非关键维度缺信息照常给结论 —— 16 GB ÷ 8 GB = 2 倍 ⇒ 「流畅」。
     ★ 这两条与上面两条合起来，才是「只缺信息一律不降级」的完整口径。 */
  const cases = [
    ['缺 arch 转译层信息（关键维度）', { arch: 'arm64-v8a', memory: '12 GB', storage_free: '256 GB' }, 'maybe'],
    ['缺 dx 兼容层信息（非关键维度）', { arch: 'x86_64', memory: '16 GB', storage_free: '256 GB' }, 'smooth'],
    ['配置里没有内存字段（关键维度）', { arch: 'x86_64', storage_free: '256 GB', compatibility: { dxvk: '2.4' } }, 'maybe'],
    ['配置里没有存储字段（非关键维度）', { arch: 'x86_64', memory: '16 GB', compatibility: { dxvk: '2.4' } }, 'smooth'],
  ];
  for (const [label, obj, want] of cases) {
    const j = match.judge(prof(obj), SPEC);
    const fails = (j.dims || []).filter((d) => d.state === 'fail').map((d) => d.dim);
    eq(fails.length, 0, '★ 「' + label + '」不许产生 fail 维度', '实际 fail=' + JSON.stringify(fails));
    eq(j.verdict, want, '★ 「' + label + '」结论=' + want + '（缺信息只降关键维度，不降关键之外）');
  }
}

/* ================= ⑤ 影响面：画像 G 全库 arch 维度 fail 计数必须为 0 ================= */
console.log('\n=== ⑤ 影响面实测：画像 G 全库逐款（不看被 limit 截断的 items） ===');
{
  const ix = match.index();
  if (!ix || !ix.map) {
    ok(false, '★ spec-match.index() 可用（否则影响面无法量化）');
  } else {
    const P = prof({ cpu_abi: 'arm64-v8a', memory: '12 GB', storage_free: '256 GB', compatibility: { dxvk: '2.4', turnip: '24.1' } });
    const H = prof({ arch: 'arm64-v8a', memory: '12 GB', storage_free: '256 GB', compatibility: { box64: '0.3.4', dxvk: '2.4', turnip: '24.1' } });
    let n = 0, gFail = 0, gUnknown = 0, gNo = 0, hOk = 0;
    for (const g of Object.values(ix.map)) {
      if (!g || !g.min) continue;
      n++;
      const j = match.judge(P, g.min);
      const a = (j.dims || []).find((d) => d.dim === 'arch');
      if (a && a.state === 'fail') gFail++;
      if (a && a.state === 'unknown') gUnknown++;
      if (j.verdict === 'no') gNo++;
      const jh = match.judge(H, g.min);
      const ah = (jh.dims || []).find((d) => d.dim === 'arch');
      if (ah && ah.state === 'ok') hOk++;
    }
    ok(n > 1000, '全库比过足够多款（否则结论没有意义）', n + ' 款');
    eq(gFail, 0, '★ 画像 G 全库 arch 维度 fail 计数 = 0（v10.34 是 ' + n + '，100%）');
    eq(gUnknown, n, '★ 画像 G 全库 arch 维度一律「待确认」', gUnknown + '/' + n);
    ok(gNo < n * 0.5, '★ 画像 G 不再「全库 100% 不可跑」',
      '仍判不可跑 ' + gNo + '/' + n + '（' + (n ? (gNo / n * 100).toFixed(1) : 0) + '%），其余由 dx/ram/storage 决定');
    eq(hOk, n, '参考组 H（同设备 + box64）全库 arch 一律 ok', hOk + '/' + n);
  }
}

/* ================= ⑥ 接口未被牵连（只读源码，先剥注释） ================= */
console.log('\n=== ⑥ 接口未被牵连 ===');
{
  const fs = require('fs');
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  /* ⚠️ 这里**故意不写**「源码里必须出现某某提示语」这种反向断言：
     ① ~ ⑤ 已经把行为钉死了，再加一条判「原话」的只在实现改写提示语时**假红**
     （v10.32 的教训：判据要判**形态**，不要判**原话**）。
     接口接线是唯一没法离线用行为断言的东西（起服务才能跑），所以只留这两条。 */
  const S = strip(fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8'));
  ok(/specMatch\.analyze\(/.test(S), '★ 反向：/api/spec/analyze 仍走 specMatch.analyze（接口没被牵连）');
  ok(/specMatch\.dictInfo\(/.test(S), '★ 反向：/api/spec/dict 仍走 specMatch.dictInfo（口径改动没动接口层）');
}

console.log('\n============================');
console.log('  通过 ' + pass + '/' + (pass + fail) + '（失败 ' + fail + '）');
console.log('============================');
process.exit(fail ? 1 : 0);
