/* tools/test-v1014.js — v10.14 回归（第 12 道防线）
 *
 * 覆盖本轮四项修复：
 *   ① 跨源按钮不再指向站点首页（源码级 + 落点规则）
 *   ② GPU 脏值清洗（mobilehub 读取层 + build 脚本）
 *   ③ 手机配置「假阴性」匹配（版本词归一 + libId / 英文别名桥）
 *   ④ 机型 → 芯片规格（三星代号写法差异归一 + 近似标记）
 *
 * 运行：node tools/test-v1014.js      （纯静态 + 模块级，不需要起服务）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  (cond ? pass++ : fail++);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '   [' + extra + ']' : ''}`);
};

const mh = require('../data/mobilehub');
const dm = require('../data/device-match');

/* ================= ② GPU 脏值清洗 ================= */
console.log('\n=== ② GPU 脏值清洗 ===');

const DIRTY = [
  'turnip_v24.2.0_R22',            // 驱动版本串（最高频 ×693）
  'turnip-v24.3.0-R12',            // 同类的连字符写法
  'turnip_v25.0.0_R6',
  'vkpipe-1.0',
  '8Elite-800.34',                 // 驱动构建号（骁龙 8 Elite 的 build）
  'unknown',
  '兼容模式',
  'GPU驱动',
  '23053RN02A',                    // 红米设备编号
  '2412DPC0AI',
  'Retroid Pocket 5',              // 设备名而非 GPU
  'SM8650',                        // SoC 编号（不是 GPU 名）
  'MT6789',
  'MT6855V/AZA',
];
for (const v of DIRTY) ok(`丢弃脏值 ${v}`, mh.cleanGpuOne(v) === '', `→ ${JSON.stringify(mh.cleanGpuOne(v))}`);

const KEEP = ['Adreno 830', 'Mali-G720 MC7', 'Immortalis MC12', 'PowerVR Rogue GE8320', 'Mali-G57'];
for (const v of KEEP) ok(`保留合法 GPU ${v}`, mh.cleanGpuOne(v) === v, `→ ${JSON.stringify(mh.cleanGpuOne(v))}`);

ok('归一 ANGLE 前缀（Xclipse 540）',
  mh.cleanGpuOne('ANGLE Samsung Xclipse 540 on Vulkan 1 3 279') === 'Xclipse 540',
  mh.cleanGpuOne('ANGLE Samsung Xclipse 540 on Vulkan 1 3 279'));
ok('归一 ANGLE 里的 Mali 全名',
  mh.cleanGpuOne('ANGLE ARM Vulkan 1 3 278 Mali-G57 MC2 0x90930010 Mali-G57 MC2-49 1 0') === 'Mali-G57 MC2',
  mh.cleanGpuOne('ANGLE ARM Vulkan 1 3 278 Mali-G57 MC2 0x90930010 Mali-G57 MC2-49 1 0'));
ok('归一下划线（Adreno_814 → Adreno 814）',
  mh.cleanGpuOne('Adreno_814') === 'Adreno 814', mh.cleanGpuOne('Adreno_814'));
ok('去重', mh.cleanGpus(['Adreno 830', 'Adreno 830', 'turnip_v24.2.0_R22']).length === 1);
ok('清洗后为空则返回 []', mh.cleanGpus(['turnip_v24.2.0_R22', 'unknown']).length === 0);

/* 全量：产物落盘 + 读取层视图都不应再出现脏值 */
{
  const d = JSON.parse(read('data/mobilehub.json'));
  let dirtyLeft = 0, before = 0;
  for (const x of d.items || []) for (const g of x.gpus || []) {
    before++;
    if (mh.cleanGpuOne(g) !== g) dirtyLeft++;
  }
  /* 前置：脏值样例确实会被规则干掉（DIRTY 那组断言已逐一验证），此处保证
     `dirtyLeft === 0` 不是因为「规则太松」 —— 松规则不可能通过上面那 14 项。 */
  ok('产物已落盘为清洗后的干净数据（build 已重跑）', dirtyLeft === 0,
    `${dirtyLeft} 个残留 / 共 ${before} 条 GPU`);
  const view = mh.list({ stats: 'all', limit: 300 });
  ok('读取层已清洗（list 返回的 gpus 无脏值）',
    (view.items || []).every((x) => (x.gpus || []).every((g) => mh.cleanGpuOne(g) === g)));
}

/* build 脚本共用同一套规则（否则重建产物又会脏） */
{
  const b = read('tools/build-mobilehub.js');
  ok('build-mobilehub 引入了 cleanGpuOne', /cleanGpuOne/.test(b));
  ok('build 的两处 gpus 写入都做了清洗',
    (b.match(/const v = cleanGpuOne\(x\)/g) || []).length === 2,
    `${(b.match(/const v = cleanGpuOne\(x\)/g) || []).length} 处`);
}

/* ================= ③ 手机配置假阴性 ================= */
console.log('\n=== ③ 手机配置「假阴性」匹配 ===');

ok('版本词归一后能命中（机地「重置版」↔ XD「重制版」）',
  !!mh.lookup('生化危机4重置版'), mh.lookup('生化危机4重置版')?.name || '(未命中)');
ok('libId 精确命中',
  mh.lookup('完全对不上的名字', { libId: 'xd-5828' })?.libId === 'xd-5828');
ok('英文别名桥命中',
  !!mh.lookup('生化危机4重置版', { alts: ['Resident Evil 4'] }));
ok('空输入返回 null', mh.lookup('') === null);

/* ★ 防误配：不同作品不得互认 */
{
  const a = mh.lookup('生化危机4重置版');
  const b = mh.lookup('生化危机2重制版');
  ok('不同作品不会被吸到一起', !a || !b || a.name !== b.name, `${a?.name} vs ${b?.name}`);
}

/* ================= ④ 机型 → 芯片规格 ================= */
console.log('\n=== ④ 机型 → 芯片规格 ===');

ok('小米代号可译', !!(dm.findDevice('Xiaomi 2412DPC0AG') || {}).soc);
ok('三星「SM 空格」写法可译', !!(dm.findDevice('SM S928B') || {}).soc);
ok('三星「samsung SM-连字符」写法可译（v10.14 归一）',
  !!(dm.findDevice('samsung SM-S918U1') || {}).soc,
  (dm.findDevice('samsung SM-S918U1') || {}).soc);
/* ★ 精确命中 vs 基号兜底：库里若恰有该键就是精确答案，不带 approx；
   后缀库里没有（如 S24 Ultra 美版 SM-S928U1 ↔ 库里 sm s928b）才走同代兜底，必须带 approx。 */
ok('精确命中不带 approx',
  dm.findDevice('samsung SM-A065F')?.approx === undefined,
  JSON.stringify({ k: dm.findDevice('samsung SM-A065F')?.k }));
ok('近似命中带 approx 标记（不冒充精确答案）',
  dm.findDevice('samsung SM-S928U1')?.approx === true,
  JSON.stringify({ k: dm.findDevice('samsung SM-S928U1')?.k, soc: dm.findDevice('samsung SM-S928U1')?.soc }));
ok('未知机型返回 null（不编造）', dm.findDevice('Totally Fake Phone 9999') === null);

/* 覆盖率：机型清单里的代号要能译出九成以上 */
{
  const d = JSON.parse(read('data/mobilehub.json'));
  const set = new Set();
  for (const x of d.items || []) for (const v of x.devices || []) set.add(v);
  const all = [...set];
  const okN = all.filter((m) => { const r = dm.findDevice(m); return r && (r.gpu || r.soc); }).length;
  const rate = okN / all.length;
  ok('机型代号可译率 ≥ 95%', rate >= 0.95, `${okN}/${all.length} = ${(rate * 100).toFixed(1)}%`);
}

/* ================= ① 跨源按钮落点 ================= */
console.log('\n=== ① 跨源按钮不再指向站点首页 ===');

{
  const h = read('public/index.html');
  ok('已无「写死站点根」的旧按钮',
    !/class="go \$\{s\.cls === 'jidi' \? 'xd' : 'jidi'\}" href="\$\{s\.cls === 'jidi' \? 'https:\/\/www\.xdgame\.com\/' : 'https:\/\/jidiyouxi\.com\/'\}"/.test(h));
  ok('新增了站内搜索 URL 构造器', /function JIDI_SEARCH/.test(h) && /function XD_SEARCH/.test(h));
  ok('跨源按钮带 id="crossGo"', /id="crossGo"/.test(h));
  ok('linkCounterpart 会改写 href 到该游戏详情页', /go\.setAttribute\('href', hit\.url/.test(h));
  ok('查不到时退到站内搜索（不是首页）', /JIDI_SEARCH\(zh\)/.test(h) && /XD_SEARCH\(zh\)/.test(h));
  ok('XD 搜索用 xdgamer.com（xdgame.com/search 会 404）',
    /xdgamer\.com\/search\//.test(h), (h.match(/xdgamer\.com\/search\/[^']*/) || [])[0]);
  /* ★ v10.14 补：检索词必须剥掉标点 —— 否则「生化危机4：重制版」剥版本词后留下
     尾随冒号（`生化危机4：`），检索不到机地的「生化危机4重置版」，两源都有却仍退到站内搜索。 */
  ok('检索词剥标点（PUNCT 常量）', /const PUNCT = \/\[/.test(h) && /\.replace\(PUNCT, ''\)/.test(h));
  ok('命中优先取「归一后完全相等」的那条',
    /const want = normGameTitle\(zh\)/.test(h) && /cand\.find\(\(it\) => normGameTitle\(splitName\(it\.title\)\.zh\) === want\)/.test(h));
}

/* ★ 行为级：检索词三轮推导（正则与 index.html 内的 PUNCT 一致，这里锁住不变量） */
{
  const PUNCT = /[\s\u3000:：·・\-–—_/／|｜,，.。!！?？'"“”‘’()（）\[\]【】《》<>~～+*&]/g;
  const looseOf = (zh) => String(zh)
    .replace(/重置版|重製版|重制版|重置|高清版|终极版|决定版|完全版|豪华版|年度版/gi, '')
    .replace(PUNCT, '').trim();
  ok('剥版本词+标点：「生化危机4：重制版」→「生化危机4」',
    looseOf('生化危机4：重制版') === '生化危机4', looseOf('生化危机4：重制版'));
  ok('不带尾巴标点的旧写法仍成立：「幻世录 重制版」→「幻世录」',
    looseOf('幻世录 重制版') === '幻世录', looseOf('幻世录 重制版'));
  ok('系列名不同不得收敛成同一个词（防误配前哨）',
    looseOf('古墓丽影：崛起') !== looseOf('古墓丽影：暗影'),
    `${looseOf('古墓丽影：崛起')} vs ${looseOf('古墓丽影：暗影')}`);
}

/* ================= ④ 抽屉渲染 ================= */
console.log('\n=== 抽屉渲染结构 ===');

{
  const h = read('public/index.html');
  ok('参数卡有芯片规格行', /\.d-param \.spec/.test(h) && /const specRow/.test(h));
  ok('手机配置区块有机型清单槽位', /id="bhDevSlot"/.test(h) && /\.d-devlist/.test(h));
  ok('计数改为「机型 · GPU」', /\$\{devCnt\} 款机型/.test(h));
  ok('match 请求带上另一源的 libId 与别名', /qs\.set\('alts'/.test(h) && /resolveCounterpart\(d\)/.test(h));
  ok('跨源解析只查一次（cpCache）', /let cpCache/.test(h));
  ok('sameGame 有防误配闸门（两边都有中文则不退英文）',
    /两边\*\*都有\*\*中文段却不相等时/.test(h) || /return false;\s*\n\s*\}\s*\n\s*const enA/.test(h));
}

{
  const e = read('public/emulator.html');
  ok('[派生页] 同步了 cf-param 的芯片规格行', /\.cf-param \.spec/.test(e) && /const specRow/.test(e));
}

{
  const s = read('server.js');
  ok('新增 /api/device/specs 批量端点', /app\.get\('\/api\/device\/specs'/.test(s));
  ok('/api/bh/params 注入 spec', /spec: specOf\(p\.device\)/.test(s));
  /* ★ v10.14 补：bhparams.json 是**另一条数据链路**（不走 mobilehub 读取层），
     里面存着 `Adreno (TM) 740`；不在这里清洗，同一个 GPU 在机型清单叫 `Adreno 740`、
     在参数卡叫 `Adreno (TM) 740`。cleanGpuOne 是 GPU 命名的唯一事实来源。 */
  ok('/api/bh/params 的 GPU 也走 cleanGpuOne（命名同源）',
    /const cleanGpu = \(g\)/.test(s) && /gpu: cleanGpu\(p\.gpu\)/.test(s) && /mobilehub\.cleanGpuOne/.test(s));
  ok('/api/mobilehub/match 支持 id 与 alts', /const alts = String\(req\.query\.alts/.test(s) && /libId, alts/.test(s));
}

console.log(`\n${'='.repeat(60)}\n结果：${pass} / ${pass + fail} 通过${fail ? `，${fail} 失败` : ''}\n`);
process.exit(fail ? 1 : 0);
