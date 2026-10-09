#!/usr/bin/env node
/**
 * tools/test-bhparams-nopoison.js —— ★ v10.41 防线
 *
 *   守护的行为：**`data/bhparams.js` 在「本轮抓取全部失败」时不得改写磁盘缓存。**
 *
 *   为什么值得一条防线（v10.39 一次线上验收 6 条红，当时记为「成因未定论」）：
 *     线上沙箱访问 raw.githubusercontent.com 全部失败 ⇒ 逐条配置抓 0 条 ⇒
 *     旧代码把 `{total:24, items:[]}` 写回 `data/bhparams.json` 并刷新 ts，
 *     于是 ① 好数据被覆盖、② 7 天 TTL 重新计时 ⇒ 机型清单被打回上游 6 格摘要，
 *     且**一周内不会重试** —— 一次网络抖动被放大成一周的退化。
 *
 *   ★ 隔离方式（重要）：`data/bhparams.js` 把缓存路径写死成 `path.join(__dirname,'bhparams.json')`，
 *     直接在项目里跑测试**会写坏真实的 data/bhparams.json**。
 *     所以这里把模块**拷贝到临时目录**，并在同目录放一个 stub `bannerhub.js` 顶替真身，
 *     全程只碰临时目录。真实 data/bhparams.json 只读、不写。
 *
 *   用法：node tools/test-bhparams-nopoison.js
 *         反证：node tools/test-bhparams-nopoison.js --counterproof
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'data', 'bhparams.js');
const REAL_CACHE = path.join(ROOT, 'data', 'bhparams.json');
const KEY = 'ULTIMATE_MARVEL_VS__CAPCOM_3';
const COUNTER = process.argv.includes('--counterproof');

let pass = 0, fail = 0;
const chk = (ok, name, detail = '') => {
  if (ok) pass++; else fail++;
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '  ' + detail : ''));
};

/* ---------- 沙箱：拷贝模块 + stub bannerhub + 构造 fixture 缓存 ---------- */
function makeSandbox(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-nopoison-'));
  let src = fs.readFileSync(SRC, 'utf8');
  if (mutate) src = mutate(src);
  fs.writeFileSync(path.join(dir, 'bhparams.js'), src);

  /* stub：只实现 params() 用到的 bannerhub.configs(k) —— 给 24 份配置（与线上实测同量级） */
  fs.writeFileSync(path.join(dir, 'bannerhub.js'),
    'module.exports={configs:(k)=>{const o=[];for(let i=0;i<24;i++)o.push(' +
    "{url:'https://raw.githubusercontent.com/o/r/'+i+'.json',phone:'HONOR MTN-NX3'," +
    "gpu:'Adreno 740',date:'2026-09-01',ts:1000+i});return o;}};\n");

  /* fixture：1 条好数据、ts 已过期（> 7 天 TTL）⇒ 必然走联网分支（正是要测的那条路） */
  const fixture = {
    [KEY]: {
      ts: Date.now() - 8 * 864e5, total: 24,
      items: [{ device: 'HONOR MTN-NX3', gpu: 'Adreno 740', date: '2026-09-01', ts: 1 }],
    },
  };
  fs.writeFileSync(path.join(dir, 'bhparams.json'), JSON.stringify(fixture));
  return dir;
}

/* ---------- 在沙箱里跑一次 params()，返回 {result, 磁盘缓存} ---------- */
function runCase(dir, net) {
  const okFetch =
    "()=>Promise.resolve({ok:true,json:async()=>({settings:{pc_ls_max_memory:4096," +
    "pc_ls_GPU_DRIVER_x:{name:'Turnip 24.2'},pc_s_resolution_wlocal_1:'1280'," +
    "pc_s_resolution_hlocal_1:'720'},meta:{device:'HONOR MTN-NX3',soc:'Adreno 740',bh_version:'1.0'}})})";
  const badFetch = "()=>Promise.reject(new Error('blocked: raw.githubusercontent.com'))";

  const runner = path.join(dir, 'run.js');
  fs.writeFileSync(runner, `
const path = require('path');
global.fetch = ${net === 'fail' ? badFetch : okFetch};
const m = require(${JSON.stringify(path.join(dir, 'bhparams.js'))});
(async () => {
  const out = await m.params(${JSON.stringify(KEY)}, 3);
  process.stdout.write(JSON.stringify({
    items: (out.items || []).length, cached: !!out.cached,
    allFailed: !!out.allFailed, total: out.total,
  }));
})();
`);
  const stdout = execFileSync(process.execPath, [runner],
    { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
  const disk = JSON.parse(fs.readFileSync(path.join(dir, 'bhparams.json'), 'utf8'));
  return { result: JSON.parse(stdout), disk };
}

/* ================= 正式断言 ================= */
console.log('=== v10.41 防线：抓取全部失败时不得写坏 bhparams 缓存 ===\n');

/* 0) 探针自检：确认真实缓存**没被动过**（本测试全程不许碰它） */
const realBefore = fs.readFileSync(REAL_CACHE);
console.log('【0】隔离自检');
chk(fs.existsSync(REAL_CACHE), '真实 data/bhparams.json 存在（否则测的不是真对象）');

/* 1) 反证前置：fixture 的 TTL 必须真的过期，否则走不到联网分支 */
{
  const d = makeSandbox();
  const fx = JSON.parse(fs.readFileSync(path.join(d, 'bhparams.json'), 'utf8'))[KEY];
  const ageDays = (Date.now() - fx.ts) / 864e5;
  chk(ageDays > 7, '【前置】fixture 缓存已过 7 天 TTL ⇒ 必然走联网分支', ageDays.toFixed(1) + ' 天');
  chk(fx.items.length > 0, '【前置】fixture 里有既有好数据（否则「被覆盖」无从观察）', fx.items.length + ' 条');
  fs.rmSync(d, { recursive: true, force: true });
}

/* 2) 联网失败 ⇒ 磁盘缓存必须**逐字节不变** */
{
  const d = makeSandbox();
  const before = fs.readFileSync(path.join(d, 'bhparams.json'));
  const { result, disk } = runCase(d, 'fail');
  const after = fs.readFileSync(path.join(d, 'bhparams.json'));
  console.log('\n【1】联网全部失败（线上沙箱的真实情形）');
  chk(result.allFailed === true, '返回体标记 allFailed（调用方可区分「真没有」与「没抓到」）', 'allFailed=' + result.allFailed);
  chk(result.items === 1, '返回**保留的旧值**（1 条），不是空数组', result.items + ' 条');
  chk(before.equals(after), '★ 磁盘缓存**逐字节未变**（核心断言）',
    before.equals(after) ? before.length + ' 字节' : `被改写：${before.length} → ${after.length} 字节`);
  chk((disk[KEY].items || []).length === 1, '磁盘上该 key 仍是 1 条好数据（没被打回 0 条）', (disk[KEY].items || []).length + ' 条');
  chk(disk[KEY].ts !== undefined && (Date.now() - disk[KEY].ts) / 864e5 > 7,
    '磁盘上的 ts **未被刷新**（TTL 不会重新计时 ⇒ 下次仍会重试）',
    ((Date.now() - disk[KEY].ts) / 864e5).toFixed(1) + ' 天前');
  fs.rmSync(d, { recursive: true, force: true });
}

/* 3) 联网正常 ⇒ 正常写入（修复不能把正常路径也一起掐掉） */
{
  const d = makeSandbox();
  const { result, disk } = runCase(d, 'ok');
  console.log('\n【2】联网正常（不能误伤正常路径）');
  chk(!result.allFailed, '不标记 allFailed', 'allFailed=' + result.allFailed);
  chk(result.items === 3, '返回本次抓到的 3 条', result.items + ' 条');
  chk((disk[KEY].items || []).length === 3, '磁盘缓存被正常更新为 3 条', (disk[KEY].items || []).length + ' 条');
  chk((Date.now() - disk[KEY].ts) / 864e5 < 0.01, 'ts 被刷新为当前时刻', new Date(disk[KEY].ts).toISOString());
  fs.rmSync(d, { recursive: true, force: true });
}

/* 4) 隔离复查 */
console.log('\n【3】隔离复查');
chk(fs.readFileSync(REAL_CACHE).equals(realBefore), '真实 data/bhparams.json 全程未被本测试改动');

/* ================= 反证 ================= */
if (COUNTER) {
  console.log('\n=== 反证：把守卫去掉，核心断言必须变红 ===');
  /* 变异：还原成「无条件写盘」——即 v10.41 之前的写法 */
  const MUT = (s) => {
    const guardStart = s.indexOf('  if (!items.length && list.length > 0) {');
    const guardEnd = s.indexOf('  c[key] = { ts: Date.now(), total: list.length, items };');
    if (guardStart < 0 || guardEnd < 0) throw new Error('变异锚点没找到（断言/代码已漂移，请检查）');
    return s.slice(0, guardStart) + s.slice(guardEnd);
  };
  const d = makeSandbox(MUT);
  const before = fs.readFileSync(path.join(d, 'bhparams.json'));
  const { result } = runCase(d, 'fail');
  const after = fs.readFileSync(path.join(d, 'bhparams.json'));
  const mutated = !before.equals(after);
  chk(result.allFailed !== true, '变异体：不再标记 allFailed（证明该字段确实来自守卫）', 'allFailed=' + result.allFailed);
  chk(mutated, '★ 变异体：磁盘缓存**被写坏**（原断言在变异体上会红 ⇒ 它不是恒真）',
    mutated ? `${before.length} → ${after.length} 字节` : '竟然没被改写');
  chk(JSON.parse(after.toString('utf8'))[KEY].items.length === 0, '变异体：该 key 被打回 0 条（正是线上症状）');
  fs.rmSync(d, { recursive: true, force: true });
}

console.log('\n' + '='.repeat(58));
console.log(`bhparams 防污染防线：${pass} / ${pass + fail} 通过，${fail} 失败` + (COUNTER ? '（含反证）' : ''));
process.exit(fail ? 1 : 0);
