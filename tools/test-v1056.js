#!/usr/bin/env node
/* tools/test-v1056.js —— v10.56 防线：GT 时间戳 + 源巡检 + 线上验收判据
 *
 * 本版三件事都属于「**静默型**」缺陷，必须各有断言：
 *   ① GT 条目**没有时间戳** ⇒ 按 `ts` 排序时恒 0、永远沉底（实测 2,301 款只有 GT 资源）
 *   ② 外部源改版**静默失效** ⇒ 抓取器不报错、只把空结果落盘（机地搜索曾连续 6 日无人发现）
 *   ③ `verify-online.js` 有 6 条**永远不会再绿**的死断言 ⇒ 第三层防线名存实亡
 *
 * 分组：
 *   A GT 时间戳（tsOf 单元 + 真实数据覆盖率 + 边界不瞎猜）
 *   B 源巡检脚本（结构 + ★「判据不能只看 HTTP 200」的负向断言）
 *   C 线上验收判据（MUST 表自洽 + 魔数已收口 + 两条自洽判据在位）
 *
 * ⚠️ 全部离线（`check-sources.js` 只做**静态**检查，不发网络请求 —— 联网探测不进静态防线）。
 * 跑法：node tools/test-v1056.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const gt = require(path.join(ROOT, 'data', 'gtrainers.js'));
const gtRaw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'gtrainers.json'), 'utf8'));
const SRC_CHECK = fs.readFileSync(path.join(ROOT, 'tools', 'check-sources.js'), 'utf8');
const ONLINE = fs.readFileSync(path.join(ROOT, 'tools', 'verify-online.js'), 'utf8');
const { normKey, genNums, numMismatchByTitle } = require(path.join(ROOT, 'data', 'name-normalize'));

let pass = 0, fail = 0;
const t = (ok, name, extra) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`);
};
const sec = (s) => console.log('\n── ' + s + ' ──');

/* ============================ A GT 时间戳 ============================ */
sec('A GT 时间戳（源站只给文本日期）');

/* A1 tsOf 单元 —— 含「必须返回 0」的边界，防「瞎猜日期」 */
t(gt.tsOf('2014-Jan-11') === Date.UTC(2014, 0, 11), 'tsOf: `2014-Jan-11` → 2014-01-11 UTC',
  String(gt.tsOf('2014-Jan-11')));
t(gt.tsOf('2026-Oct-09') === Date.UTC(2026, 9, 9), 'tsOf: `2026-Oct-09` → 2026-10-09 UTC');
t(gt.tsOf('Cheats [159]') === 0, '★ tsOf: 源站错位值 `Cheats [159]` → 0（**不瞎猜**）');
t(gt.tsOf('') === 0 && gt.tsOf(null) === 0 && gt.tsOf(undefined) === 0, '★ tsOf: 空值 → 0');
t(gt.tsOf('2024-Xyz-01') === 0, '★ tsOf: 非法月份缩写 → 0');
t(gt.tsOf('2026-10-09') === 0, '★ tsOf: 不做 `YYYY-MM-DD` 兜底（源站无此格式，猜了反而错）');

/* A2 导出面（fetcher 要复用同一份实现 —— 铁律 61） */
t(typeof gt.tsOf === 'function', 'tsOf 已导出（供落盘侧复用，避免第二份实现）');

/* A3 真实数据：覆盖率必须「明显高但不是 100%」——正反两侧都断言 */
const items = gt.ensure().items || [];
const withTs = items.filter((x) => x.ts > 0);
t(items.length > 5000, 'GT 条目规模正常', items.length + ' 条');
t(withTs.length / items.length > 0.9, 'GT 补 ts 覆盖率 > 90%（源站 96.9% 可解析）',
  (withTs.length / items.length * 100).toFixed(1) + '%');
t(withTs.length < items.length, '★ 不是全量硬填 —— 确实有一批保持 0（= 源站日期字段错位）',
  (items.length - withTs.length) + ' 条仍为 0');
/* 负数守卫：ts 绝不能是「抓取时间」那种假值（那会让所有 GT 条目都排到最前） */
{
  const span = new Set(withTs.map((x) => new Date(x.ts).getUTCFullYear()));
  t(span.size > 5, '★ ts 年份是**多值**（来自各自 date），不是同一个假时间戳', span.size + ' 个年份');
}

/* A4 源站**有效日期**格式只有一种（若将来混入别的格式，这条会红 ⇒ 提醒补 tsOf）
   ⚠️ 断言不能要求「全部条目都是该格式」—— 那 294 条错位值（`Cheats [159]`）本来就是
      另一种形态、且**应当**保持不可解析。所以只对「看起来像日期」的值要求格式单一。 */
{
  const forms = new Set();
  let oddball = 0;
  for (const x of gtRaw.items || []) {
    const s = String(x.date == null ? '' : x.date).trim();
    if (!s) continue;
    if (/^\d{4}-[A-Za-z]{3}-\d{1,2}$/.test(s)) forms.add('YYYY-Mon-DD');
    else if (/^Cheats\s*\[/.test(s)) oddball++;          // 已知的源站字段错位形态
    else forms.add('UNKNOWN:' + s);                      // 真·新格式 ⇒ 必须让人看见
  }
  t(forms.size === 1 && forms.has('YYYY-Mon-DD'),
    '源站**有效**日期格式单一（YYYY-Mon-DD）⇒ tsOf 覆盖完整', [...forms].join(','));
  t(oddball > 0, '错位值是已知形态 `Cheats [N]`（不是意外的新格式）', oddball + ' 条');
}

/* A5 消费端确实在用 ts（否则补了也没意义） */
{
  const rg = fs.readFileSync(path.join(ROOT, 'data', 'res-groups.js'), 'utf8');
  t(/\(it\.ts \|\| 0\) > m/.test(rg), 'res-groups 的「最新」排序确实消费 ts');
  t(/\(b\.ts \|\| 0\) - \(a\.ts \|\| 0\)/.test(rg), 'res-groups 的组内排序确实消费 ts');
}

/* ============================ B 源巡检 ============================ */
sec('B 源巡检脚本（check-sources.js）');

t(/^(?:'use strict';)?/.test(SRC_CHECK) && SRC_CHECK.includes('const SOURCES = ['), '脚本存在且定义 SOURCES');
{
  const n = (SRC_CHECK.match(/^\s{2}\{\s*$/gm) || []).length;
  t(n >= 10, '源清单 ≥ 10 条（`--json` 的 total 由它决定）', n + ' 条');
}
/* ★ 每种 state 都要有出口 —— 只判 200 就退化成「源改版了照样全绿」 */
t(SRC_CHECK.includes("state = 'down'"), '有 `down` 出口（网络失败 / 非 200）');
t(SRC_CHECK.includes("state = 'degraded'") || SRC_CHECK.includes("state = s.staleDays ? 'stale' : 'degraded'"),
  '★ 有 `degraded` 出口（**200 但内容特征不符** = 改版的形态）');
t(SRC_CHECK.includes("'stale'"), '有 `stale` 出口（GitHub 类源最后提交过久）');
/* ★ 负向：判据不能只有「HTTP 200」—— 每条源都必须带 expect 函数 */
{
  const expectN = (SRC_CHECK.match(/expect:\s*\(/g) || []).length;
  t(expectN >= 10, '★ 每条源都有 `expect()` 内容判据（不是只看状态码）', expectN + ' 条');
}
t(/if \(r\.code !== 200\)/.test(SRC_CHECK), '非 200 先归 down（在 expect 之前短路）');
t(/s\.expect\(parsed\)/.test(SRC_CHECK), 'expect 真的被调用（不是定义了没用）');
t(SRC_CHECK.includes('--json'), '支持 `--json`（供 daily-sync / 反证消费）');
t(SRC_CHECK.includes('process.exitCode = 1'), '异常时设非零退出码（可串进收尾脚本）');
/* 反向：不能把「HTTP 200」当成 ok 的唯一条件（那样 degraded 分支成死码） */
t(!/state = 'ok';[\s\S]{0,80}?if \(r\.code === 200\) \{\s*\}\s*else/.test(SRC_CHECK),
  '★ 负向：ok 不是「仅凭 200」直接给出');

/* ============================ C 线上验收判据 ============================ */
sec('C 线上验收判据（verify-online.js）');

/* C1 MUST 自检：本地首页不存在的串一律不许留在表里（本版修的正是这个） */
{
  const idx = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const t0 = ONLINE.indexOf('启动前先运行 Cheat Engine');
  t(t0 === -1 || ONLINE.slice(Math.max(0, t0 - 400), t0).includes('★'), '已失效特征串 `启动前先运行 Cheat Engine` 不再作为断言项',
    t0 === -1 ? '已删除' : '仅在注释中出现');
  t(!/'是占位符。<br>'/.test(ONLINE.replace(/\/\*[\s\S]*?\*\//g, '')), '失效串 `是占位符。<br>` 已换成现行文案');
  t(idx.includes('是占位符，按自己的账号替换'), '替换后的串在**本地首页确实存在**（可区分新旧）');
}
/* C2 魔数已收口 */
t(/const UPSTREAM_SUMMARY_MAX = \d+;/.test(ONLINE), 'UPSTREAM_SUMMARY_MAX 常量存在',
  (ONLINE.match(/const UPSTREAM_SUMMARY_MAX = (\d+);/) || [])[1]);
{
  const uses = (ONLINE.match(/> UPSTREAM_SUMMARY_MAX/g) || []).length;
  t(uses >= 2, '台数判据改用「严格多于上游摘要」（≥2 处）', uses + ' 处');
  /* ★ 必须**剥掉注释**再数：本版的说明注释里大量引用了旧写法（`>= 9`），
     不剥注释就会把「解释段落」误当成「还在用魔数」。 */
  const code = ONLINE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const hard9 = (code.match(/>= 9/g) || []).length;
  t(hard9 === 0, '★ 负向：**代码里**写死的 `>= 9` 已清零（正是本版修的假红来源）', hard9 + ' 处');
  t((ONLINE.match(/>= 9/g) || []).length > 0, '（对照）注释里仍保留旧写法的说明 —— 剥注释这一步是必要的',
    (ONLINE.match(/>= 9/g) || []).length + ' 处（全在注释）');
}
/* C3 两条「更有区分力」的判据在位 */
t(/spKeys\.length === devs\.length/.test(ONLINE), '逐台性判据在位（台数 == 机型清单台数）');
t(/popN === moreTotal/.test(ONLINE), '弹窗自洽判据在位（行数 == 入口声明数）');
/* C4 反证脚本存在（判据的判据） */
t(fs.existsSync(path.join(ROOT, 'tools', '_counterproof-v1055-live.js')), '线上判据的反证脚本存在');
t(fs.existsSync(path.join(ROOT, 'tools', '_counterproof-v1056-sources.js')), '源巡检的反证脚本存在');

/* ============================ D 无回归：代际护栏未被「中文数字桥接」动过 ============================ */
sec('D ★ 负向守护：中文数字桥接**刻意不做**（本版查证的结论）');

t(genNums('仙剑奇侠传6').length === 1, '护栏仍认阿拉伯数字（`仙剑奇侠传6` → [\'6\']）');
t(genNums('三国志经典').length === 0, '★ 护栏**不**把 `三国志` 的「三」当数字（若变红说明误加了桥接）');
t(genNums('链在一起').length === 0, '★ 护栏**不**把 `在一起` 的「一」当数字');
t(numMismatchByTitle('三国志经典', { title: '三国志经典/Three Kingdoms Classic' }) === false,
  '★ 同款查询→同款条目 不判冲突（护栏不误杀）');
/* 反向：如果有人在 genNums 里加了中文数字映射，上面几条会红 —— 这样本组就是有效守护 */

console.log('\n' + '='.repeat(58));
console.log(`v10.56 防线：${pass} / ${pass + fail} 通过` + (fail ? `，${fail} 失败` : ''));
if (fail) process.exitCode = 1;
