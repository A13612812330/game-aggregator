/**
 * tools/test-daily-sync.js —— 守护 tools/daily-sync.js（每日维护「一条命令」版）
 *
 * 本套件守六件事：
 *   ① 选择器纯函数：任务结束判定 / 增减展示 / 状态判定 / 计数
 *   ② ★ `--dry` 的**行为级**保证：声明了 write 的步骤一个都不许真跑
 *   ③ 摘要：体积上限、行数上限、状态码行、空输入不崩
 *   ④ 数据口径：分源条数必须读 bySource（写错会**静默**显示成 "?"）
 *   ⑤ 实现约束：node 路径不写死、python 不写死用户名、没有复活的内层 dry 判断
 *   ⑥ 参数解析 + 服务在线时的字段实测
 *
 * ★ 为什么 ② 要写成行为断言而不是「数源码里出现了几次 if (ctx.dry)」：
 *   第一版就是靠内层手写 if 拦的，结果漏了 3 步（XD / BannerHub / 机地同步），
 *   `--dry` 嘴上说不写、实际把三个任务都真跑了 —— 而且**没有任何报错**。
 *   数源码次数的断言拦不住「内层又手写一份」，只有把决策抽成 planStep 才能真守住。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  — ' + extra : '')); }
  else { fail++; console.log('  × FAIL ' + name + (extra ? '  — ' + extra : '')); }
}
function eq(a, b, name, extra) {
  ok(a === b, name, (extra || '') + '  得到 ' + JSON.stringify(a) + '，期望 ' + JSON.stringify(b));
}
/** 去注释：源码侧断言必须看**代码**，不能把解释性注释也算进去。 */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const DS = require(path.join(ROOT, 'tools', 'daily-sync'));
const SRC = strip(fs.readFileSync(path.join(ROOT, 'tools', 'daily-sync.js'), 'utf8'));

/* ================= ① 纯函数 ================= */
console.log('\n=== ① 选择器纯函数 ===');
{
  eq(DS.isTaskDone(null), true, 'run 为 null ⇒ 任务已结束');
  eq(DS.isTaskDone(undefined), true, 'run 为 undefined ⇒ 已结束');
  eq(DS.isTaskDone({}), false, '空对象（done 未设）⇒ 未结束');
  eq(DS.isTaskDone({ done: false }), false, 'done=false（服务里的初始值）⇒ 未结束');
  eq(DS.isTaskDone({ done: 0 }), false, '★ done=0 ⇒ 未结束（0 是假值，但语义是「没完成」）');
  eq(DS.isTaskDone({ done: 1790131140651 }), true, 'done=时间戳（服务用 Date.now() 落完成态）⇒ 已结束');

  eq(DS.fmtDelta(1, 5), ' (+4)', '增量显示带符号');
  eq(DS.fmtDelta(5, 3), ' (-2)', '减少同样带符号');
  eq(DS.fmtDelta(5, 5), '', '★ 无变化不显示 (+0) —— 摘要要干净，别塞一堆噪音');
  eq(DS.fmtDelta(null, 5), '', '缺基线时宁可不显示，不要编一个数字出来');
  eq(DS.fmtDelta('x', 5), '', '非数字同样不显示');

  eq(DS.dispWidth('abc'), 3, 'ASCII 算 1 宽');
  eq(DS.dispWidth('服务体检'), 8, '★ CJK 算 2 宽（否则摘要会参差不齐）');
  eq(DS.padLabel('服务体检', 12), '服务体检    ', '补到 12 显示宽度（4 个空格）');
  eq(DS.padLabel('超长标签名打不住', 4), '超长标签名打不住', '★ 已超宽 ⇒ 不截断（截断会丢信息）');
}

/* ================= ② 状态判定与计数 ================= */
console.log('\n=== ② 状态判定 ===');
{
  const R = (status, critical) => ({ status, critical: !!critical });
  eq(DS.decideStatus([]), 'DAILY_OK', '空列表 ⇒ OK');
  eq(DS.decideStatus([R('ok'), R('ok')]), 'DAILY_OK', '全成功 ⇒ DAILY_OK');
  eq(DS.decideStatus([R('ok'), R('blocked'), R('skip')]), 'DAILY_OK',
    '★ 阻塞与跳过**都不算失败**（xlsx 缺失是外部原因，不该判成「今天挂了」）');
  eq(DS.decideStatus([R('ok'), R('fail')]), 'DAILY_PARTIAL', '有普通失败 ⇒ DAILY_PARTIAL');
  eq(DS.decideStatus([R('fail', true)]), 'DAILY_FAIL', '关键步骤失败 ⇒ DAILY_FAIL');
  eq(DS.decideStatus([R('fail'), R('fail', true)]), 'DAILY_FAIL',
    '★ 关键失败优先于普通失败（服务都不可用了，不该只报「部分失败」）');

  const t = DS.tally([R('ok'), R('ok'), R('fail'), R('skip'), R('blocked')]);
  eq(JSON.stringify(t), JSON.stringify({ ok: 2, fail: 1, skip: 1, blocked: 1 }), 'tally 分类计数正确');
}

/* ================= ③ ★ --dry 行为级保证 ================= */
console.log('\n=== ③ ★ --dry 必须拦住每一个有写副作用的步骤 ===');
{
  const dryOpts = { dry: true, skip: new Set() };
  const wetOpts = { dry: false, skip: new Set() };
  const writes = DS.STEP_DEFS.filter((d) => d.write);
  const reads = DS.STEP_DEFS.filter((d) => !d.write);

  // ★ 用精确值而不是 >=7：漏标一个 write 标记就等于「那步在 --dry 下会真跑」，
  //   而 `>=7` 恰好漏掉这种情况（write 少一个、read 多一个，总数仍是 8）。
  //   增删步骤时必须同步改这一行 —— 这是刻意的：改步骤却不改守护清单，就该红。
  eq(writes.length, 8, 'STEP_DEFS 恰好 8 个有写副作用的步骤（9 步里的 health 是只读）');
  eq(reads.length + writes.length, DS.STEP_DEFS.length, 'read + write 覆盖全部步骤（没有漏标的）');

  for (const d of writes) {
    eq(DS.planStep(d, dryOpts).run, false, '★ --dry 拦住了「' + d.label + '」');
    eq(DS.planStep(d, wetOpts).run, true, '非 --dry 时「' + d.label + '」照常执行');
  }
  for (const d of reads) {
    eq(DS.planStep(d, dryOpts).run, true, '只读步骤「' + d.label + '」在 --dry 下仍执行（否则体检没输出）');
  }

  const one = writes[0];
  eq(DS.planStep(one, { dry: false, skip: new Set([one.key]) }).run, false, '--skip 能拦住步骤');
  eq(DS.planStep(one, { dry: true, skip: new Set([one.key]) }).kind, 'skip',
    '★ 同一一步两个理由时，显式 --skip 优先于 --dry（顺序不能反）');
  eq(DS.planStep(one, dryOpts).kind, 'dry', '--dry 拦截的 kind 标记为 dry（日志要区分得开）');
  eq(DS.planStep(one, undefined).run, true, '缺 opts 时不拦（默认跑）');
}

/* ================= ④ 摘要 ================= */
console.log('\n=== ④ 摘要格式与体积 ===');
{
  const rows = DS.STEP_DEFS.map((d, i) => ({
    key: d.key, label: d.label,
    status: d.key === 'phonecfg' ? 'blocked' : 'ok',
    detail: '示例详情 ' + i,
  }));
  const meta = {
    stamp: '2026-09-23 10:42:28 (周三)', health: '✅ 已在运行', elapsed: '28s',
    status: 'DAILY_OK', libLine: '库总量 19051 = xdgamer 15426 + jidi 3625 · 双料 13448',
    builtAtLine: '产物 builtAt：mobilehub 09-23 10:42', notes: ['补回 xlsx'],
  };
  const s = DS.buildSummary(rows, meta);
  ok(Buffer.byteLength(s, 'utf8') < 8192, '★ 摘要 < 8KB（实测 ' + Buffer.byteLength(s, 'utf8') + ' 字节）');
  ok(s.split('\n').length <= 24, '★ 行数 ≤ 24（防有人把原始输出塞进摘要）', s.split('\n').length + ' 行');
  ok(s.includes('DAILY_OK'), '摘要末行含状态码（自动化工具读这一行判成败）');
  ok(s.includes('库总量'), '含库总量行');
  ok(s.includes('待办：'), '含待办行');
  for (const d of DS.STEP_DEFS) ok(s.includes(d.label), '摘要里出现步骤「' + d.label + '」');

  const empty = DS.buildSummary([], {});
  ok(typeof empty === 'string' && empty.includes('DAILY_OK'), '空 rows 不崩，且给出默认状态');
  const noMeta = DS.buildSummary(null, null);
  ok(typeof noMeta === 'string', 'null 入参不崩（防御性）');
}

/* ================= ⑤ 数据口径（防静默变 ?） ================= */
console.log('\n=== ⑤ 分源条数必须读 bySource（行为级 + 静态） ===');
{
  // ★ 行为级：喂**真实形状**的输入。
  //   只查「源码里出现过 bySource」是假断言 —— 反证实测：把汇总段改成读错层级，
  //   那种断言照样全绿（因为 stepJidi 里也有 bySource，把静态检查撑起来了）。
  const real = { ok: true, total: 19051, bySource: { xdgamer: 15426, jidi: 3625 }, dual: 13448 };
  const sc = DS.sourceCounts(real);
  eq(sc.xdgamer, 15426, '★ 分源条数从 bySource 下取到 xdgamer');
  eq(sc.jidi, 3625, '★ 同上取到 jidi');

  const flat = DS.sourceCounts({ total: 19051, xdgamer: 15426, jidi: 3625 });
  eq(flat.xdgamer, null, '★ 只有顶层键时返回 null（顶层本就没这两个键，不许瞎猜出数字来）');
  eq(flat.jidi, null, '★ 同上 —— 若有人把取值改回顶层，这两条会立刻红');
  eq(DS.sourceCounts(null).xdgamer, null, 'null 入参不崩');
  eq(DS.sourceCounts({}).jidi, null, '空对象不崩');

  ok(/lib\.bySource/.test(SRC),
    '★ 汇总段读的是 lib.bySource（收窄到 lib. 前缀 —— 裸 bySource 会被别的函数撑成假绿）');
  ok(!/lib\.xdgamer/.test(SRC), '★ 不许再写成 lib.xdgamer（顶层没有这个键）');
  ok(!/lib\.jidi\b/.test(SRC), '★ 不许再写成 lib.jidi（同上）');
  ok(/st\.synced|synced/.test(SRC), '机地同步展示 got 用 synced 字段');
  ok(!/st\.total\b/.test(SRC),
    '★ 机地上报的 total 是**全库总量**、不是 jidi 源条数，不许直接展示（会得到 jidi 19051 这种误导数字）');
}

/* ================= ⑥ 实现约束 ================= */
console.log('\n=== ⑥ 实现约束（防退回写死路径） ===');
{
  ok(/process\.execPath/.test(SRC), '跑 node 子进程用 process.execPath（谁启动我，就用谁）');
  ok(!/22\.22\.2-2/.test(SRC),
    '★ 源码不含 22.22.2-2 —— 那个目录实测不存在，原 automation prompt 就栽在这上面（每天白试错一轮）');
  ok(/os\.homedir\(\)/.test(SRC), 'python 路径按 os.homedir() 推导（跨用户可用）');
  ok(!/Users[\\/]+komo/.test(SRC), '★ 不写死用户名');
  ok(/findPython/.test(SRC), '有 findPython 做多候选兜底');
  ok(/AbortController/.test(SRC), 'HTTP 请求有超时保护（AbortController）');
  ok(/timeoutMs/.test(SRC), '子进程有超时保护');
  ok(/require\.main === module/.test(SRC), '★ 有 require.main 保护 —— 否则套件 require 它时会**真跑一遍全流程**');
  ok(/catch/.test(SRC), '有错误捕获（每步失败不中断）');

  for (const f of ['isTaskDone', 'planStep', 'decideStatus', 'tally', 'buildSummary', 'fmtDelta', 'parseArgs', 'readProduct', 'sourceCounts', 'fmtSteamreq', 'readPrewarm']) {
    ok(typeof DS[f] === 'function', '导出可测函数 ' + f);
  }
  ok(Array.isArray(DS.STEP_DEFS) && DS.STEP_DEFS.length >= 9, '导出 STEP_DEFS（9 步）');
}

/* ================= ⑦ 参数解析 ================= */
console.log('\n=== ⑦ 参数解析 ===');
{
  const p = DS.parseArgs(['--dry', '--json', '--skip=saves,trainers', '--timeout-bh=12345']);
  eq(p.dry, true, '--dry 识别');
  eq(p.asJson, true, '--json 识别');
  eq(p.skip.has('saves'), true, '--skip=saves,trainers 拆出 saves');
  eq(p.skip.has('trainers'), true, '--skip=saves,trainers 拆出 trainers');
  eq(p.t.bh, 12345, '--timeout-bh 可覆盖该步超时');
  const q = DS.parseArgs([]);
  eq(q.dry, false, '默认非 dry');
  eq(q.asJson, false, '默认非 json');
  eq(q.skip.size, 0, '默认不跳过任何步骤');
  ok(q.t.xd > 0 && q.t.bh > 0 && q.t.jidi > 0 && q.t.script > 0 && q.t.net > 0 && q.t.steamreq > 0,
    '各步有默认超时（按类别：xd / bh / jidi / script / net / steamreq —— 按**性质**分组，不是按步骤名）');
  ok(q.t.steamreq >= 600000,
    '★ steamreq 超时 ≥10 分钟（实测 1.08s/条 × 上限 500 条 ≈ 9 分钟，留余量应对限流退避）');
}

/* ================= ⑧ 服务在线时：字段实测（离线则跳过） ================= */
console.log('\n=== ⑧ 服务在线时的字段实测 ===');
{
  const code = 'fetch("http://localhost:8123/api/library/stats")' +
    '.then(function(r){return r.json()})' +
    '.then(function(j){console.log(JSON.stringify(j))})' +
    '.catch(function(){console.log("{}")})';
  const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', timeout: 20000 });
  let st = null;
  try { st = JSON.parse(String(r.stdout || '{}').trim()); } catch (e) { st = null; }
  if (st && st.bySource) {
    ok(typeof st.bySource.xdgamer === 'number', '实测服务返回 bySource.xdgamer = ' + st.bySource.xdgamer);
    ok(typeof st.bySource.jidi === 'number', '实测服务返回 bySource.jidi = ' + st.bySource.jidi);
    eq(st.xdgamer, undefined, '★ 顶层确实没有 xdgamer 键（当场印证「第一版写错」这件事）');
    eq(st.jidi, undefined, '★ 顶层确实没有 jidi 键');
  } else {
    console.log('  SKIP  服务未在线，跳过动态实测（字段名用法已由 ⑤ 静态覆盖）');
  }
}

/* ================= ⑨ v10.39：配置要求预热增量 ================= */
console.log('\n=== ⑨ ★ 配置要求预热增量（v10.39 新增步） ===');
{
  /* ★★ 本版最该守的一条：steamreq 必须标 write:true。
     漏标 ⇒ `--dry`（只读模式）会**真联网跑 9 分钟并写盘** —— 与 v10.38 踩过的
     「--dry 把三个任务都真跑了」是同一类事故，而且这步的代价更大（联网 + 慢 + 写两个产物）。 */
  const sr = DS.STEP_DEFS.find((d) => d.key === 'steamreq');
  ok(!!sr, '★ STEP_DEFS 里有 steamreq 步');
  eq(sr && sr.write, true, '★★ steamreq 标了 write:true（否则 --dry 会真联网跑 9 分钟并写盘）');
  eq(DS.planStep(sr, { dry: true, skip: new Set() }).run, false, '★ --dry 确实拦住了预热步');
  eq(DS.planStep(sr, { dry: true, skip: new Set() }).kind, 'dry', '拦截理由是 dry（不是别的）');
  eq(DS.planStep(sr, { dry: false, skip: new Set() }).run, true, '非 --dry 时照常执行');

  /* 这步有两个子环节，缺一不可：只预热不重建 ⇒ 派生索引不跟上（v10.37 教训） */
  ok(/build-steam-req\.js/.test(SRC), '调 build-steam-req.js（① 联网补缓存）');
  ok(/build-spec-req\.js/.test(SRC), '★ 同时调 build-spec-req.js（② 重建派生索引，缺了就是白抓）');
  const i1 = SRC.indexOf('build-steam-req.js');
  const i2 = SRC.indexOf('build-spec-req.js');
  ok(i1 >= 0 && i2 > i1, '★ 顺序正确：先预热再重建（索引的输入是缓存产物）');
  ok(/r1\.code == null/.test(SRC), '★ 预热超时（code 为 null）单独判定，不静默当成成功');

  /* fmtSteamreq 行为断言（喂真实形状，不查字符串出现过） */
  const before = { stats: { total: 16371, withDx: 10535 } };
  const after = { stats: { total: 17177, withDx: 10567 } };
  const full = DS.fmtSteamreq(before, after, { done: 500, total: 925, ok: 480, miss: 15, err: 5, throttled: 2 }, 500);
  ok(/500\/925/.test(full), '摘要报出「本次 done/total」', full.slice(0, 52));
  ok(/命中 480/.test(full), '摘要报命中数');
  ok(/未收录 15/.test(full), '★ 未收录必须显示（不写负缓存 ⇒ 次日还会再试，藏了就等于骗）');
  ok(/失败 5/.test(full), '★ 失败必须显示');
  ok(/限流 2/.test(full), '触发限流时如实报出');
  ok(/16371 → 17177（\+806）/.test(full), '对照库前后规模与增量如实报出');
  ok(/★DX 10567/.test(full), '报出 DX 覆盖数（与「缺 DX」影响面直接相关）');
  ok(/仍有积压/.test(full), '★ 待抓顶到上限 ⇒ 明确说「仍有积压，次日续补」');
  const clean = DS.fmtSteamreq(before, after, { done: 10, total: 10, ok: 10, miss: 0, err: 0 }, 500);
  ok(!/仍有积压/.test(clean), '★ 没顶到上限时**不**报积压（不 over-claim）');
  ok(!/未收录/.test(clean), '零未收录时不显示该字段（等同不显示 (+0)）');
  const noProg = DS.fmtSteamreq(before, after, null, 500);
  ok(typeof noProg === 'string' && /17177/.test(noProg), 'progress 产物缺失时不崩，仍报出对照库规模');
  ok(typeof DS.fmtSteamreq(null, null, null, 500) === 'string', '全 null 入参不崩（防御性）');
}

console.log('\n============================');
console.log('  通过 ' + pass + '/' + (pass + fail) + '（失败 ' + fail + '）');
console.log('============================');
process.exit(fail ? 1 : 0);
