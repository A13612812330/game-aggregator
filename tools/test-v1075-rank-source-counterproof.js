/* 反证：把 v10.75「榜单换源（XD /update/ 八档）+ 双源加权融合 + 封面优选」的十三个打坏点逐个打坏，
 *        tools/test-v1075-rank-source.js 的**对应断言必须变红**。
 *
 * 为什么必须做：断言全绿也可能是**假绿** —— 判据写歪、或根本没走到被守护的分支，照样打印 ✅。
 *   判据只有一个：把被守护的行为**故意打坏**，对应断言必须变红。
 *   ★★ 本项目实测过多次：v10.73 的反证照出「4 条假绿 + 1 个真 bug」；v10.75 的 A7 也是这样
 *      被照出「补位只剩 1 条时 `every` 恒真」的退化（见 test-v1074 的 A7 注释）。
 *
 * 十三个打坏点各代表一族：
 *   ① ★★ 去掉**名次相对位置对齐**（直接用源站绝对名次）—— 这是本版第一版踩的真坑：
 *      两源规模悬殊（XD 100 / 机地 12）⇒ 机地 12 条会整片压过 XD 前 45 名，名义 50/50 实际被主导
 *   ② ★ 权重改成 90/10（拍板是 50/50，改常量必须被发现）
 *   ③ 工具条目（运行库 / 检测工具）不过滤 ⇒ XD 人气榜第 1 名那条又回来了
 *   ④ ★★ 去掉库内 `jidiUrl` 桥接（`xd-<gid>` ↔ `jidi-<tid>` 的配对是唯一可靠的同游戏识别）
 *   ⑤ ★★ zhKey 不剥**书名号** ⇒「《全面战争：幕府将军2》完全版」与库内「全面战争：幕府将军2」失配
 *   ⑥ ★ zhKey 长度护栏一刀切 ≥3 ⇒ 2 字中文名（剑星/鸣潮）整类被误杀
 *   ⑦ 封面质量分全返回 1 ⇒ 「哪张更像 460×215」失去判据
 *   ⑧ ★★ 同名提优护栏从 `≤1` 放宽到 `≤4` ⇒ 会把**已经正确的大图**换成别人的图
 *   ⑨ 日期被当成热度值（`2026-10-14` 落进 hot）⇒ recent 档的日期语义丢失
 *   ⑩ 小图升级不保留 `coverAlt` ⇒ header.jpg 404 时前端没有回退燃料（实测会 404）
 *   ⑪ 「最近更新」档的 src 从 `xdgamer` 改成 `both` ⇒ 与拍板（仅 XD）不符
 *   ⑫ `Promise.allSettled` 换成 `Promise.all` ⇒ 任一侧源站抽风就整档挂掉
 *   ⑬ 轮播把热度数字加回来 ⇒ 与「两源口径不同、不编综合热度」的决策冲突
 *
 * ★ 纪律（与 v1071 / v1072 / v1073 / v1074 一致）：
 *   · 每个坏点**独立**打坏 → 跑 → 还原，互不干扰；
 *   · 打坏前先断言「锚点真的被改动了」（没改动 = 靶子没了 = 反证会假过）；
 *   · 期望变红哪条**必须精确到断言**，不能只看「红了几条」；
 *   · 全部还原后必须复跑一次全绿，否则「还原」本身可能是假的。
 *
 * ★★ 铁律 113：本文件**绝不许与别的反证套件并发跑**（它们改的正是被断言的源文件）。
 *   ⚠️ 本套件打坏 `public/index.html`（第 ⑬ 点）⇒ 也**不许在浏览器层全量跑的时候跑**：
 *     8123 常驻服务是**按请求现读磁盘**的，浏览器套件会加载到被故意打坏的页面。
 *     反证是「改仓库的排他操作」：**先确认没有别的实测在跑，再动**。
 *
 * 跑法：node tools/test-v1075-rank-source-counterproof.js     ← 单独跑，不要并行
 *       （**不进 SUITES**：它的期望是「红」，混进汇总会把条数搅乱）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SUITE = path.join(__dirname, 'test-v1075-rank-source.js');

/* ★ 取汇总的判据必须与套件当前的收尾格式一致（`通过 n / m（失败 f）`）。
 *   ⚠️ 这里**必须带 `m` 标志或自己锚定行边界**：不带 `m` 时 `^…$` 只在整段输出上匹配，
 *      而汇总行不在开头 ⇒ 正则永远匹配不上，于是「基线」被误判成「不是全绿」，
 *      整轮反证在第一关就退出（v10.71 出过同类问题：格式改了、反证没跟着改，整步静默失效）。 */
const SUM_ANY = /(?:^|\n)通过 (\d+) \/ (\d+)（失败 (\d+)）(?:\n|$)/;

/** 跑一次套件，返回它打印的全部输出 */
function runSuite() {
  try {
    return execFileSync(process.execPath, [SUITE],
      /* ★ 铁律 38：stdio 显式写全（前置闸 check-stdio-guard.js 会扫这行） */
      { encoding: 'utf8', timeout: 240000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    return String(e.stdout || '') + String(e.stderr || '');
  }
}

const CASES = [
  {
    label: '① ★★ 去掉名次相对位置对齐（直接用源站绝对名次）',
    file: 'data/rank-merge.js',
    break: (s) => s.replace('  return 1 + Math.max(0, Math.min(1, norm)) * (N_REF - 1);',
      '  return r;   /* 反证：不做名次对齐，直接用绝对名次 */'),
    /* ★★ need 是 **A2**（榜尾对齐语义），不是 A15（前 11 里机地 ≤6）——
       第一版 need 写的 A15，实测**不红**：排序 tie-break 里「XD 名次优先」会把名次交错开，
       即使不做对齐，前 11 里机地也只有 5 条 ⇒ A15 绿。
       ⇒ 守**算法语义**（A2：榜尾必须映射到同一个参考深度）才对得上这个打坏点；
         A15 守的是「结果形态」，两者不能互相替代（已把这条教训写进套件 A15 的注释）。 */
    need: ['A2'],
  },
  {
    label: '② ★ 权重改成 90/10（拍板是 50/50）',
    file: 'data/rank-merge.js',
    break: (s) => s.replace('const W_JIDI = 0.5;    // 机地权重',
      'const W_JIDI = 0.9;    /* 反证：权重失衡 */'),
    need: ['A5'],
  },
  {
    label: '③ 工具条目（运行库 / 检测工具）不过滤',
    file: 'data/rank-merge.js',
    break: (s) => s.replace('const TOOL_RE = /(运行库|检测工具)/;',
      'const TOOL_RE = /(?!)/;   /* 反证：工具条目不过滤 */'),
    need: ['A12'],
  },
  {
    label: '④ ★★ 去掉库内 jidiUrl 桥接（两源同游戏识别桥）',
    file: 'data/rank-merge.js',
    break: (s) => s.replace('    if (t && !byTid.has(t)) byTid.set(t, g);',
      '    if (false && t && !byTid.has(t)) byTid.set(t, g);   /* 反证：不建 tid 索引 */'),
    need: ['A8'],
  },
  {
    label: '⑤ ★★ zhKey 不剥书名号（《…》与书外同名分属两个键）',
    file: 'data/rank-merge.js',
    break: (s) => s.replace("  s = s.replace(/[《》]/g, '').trim();", '  /* 反证：不剥书名号 */'),
    need: ['A18'],
  },
  {
    label: '⑥ ★ zhKey 长度护栏一刀切 ≥3（2 字中文名整类被误杀）',
    file: 'data/rank-merge.js',
    break: (s) => s.replace("  if (/[\\u4e00-\\u9fa5]/.test(s)) return s.length >= 2 ? s.toLowerCase() : '';",
      "  if (/[\\u4e00-\\u9fa5]/.test(s)) return s.length >= 3 ? s.toLowerCase() : '';   /* 反证：一刀切 */"),
    need: ['A20'],
  },
  {
    label: '⑦ 封面质量分全返回 1（「哪张更像 460×215」失去判据）',
    file: 'data/rank-merge.js',
    break: (s) => s.replace('  if (/store_item_assets\\/steam\\/apps\\/[^/]+\\//i.test(s)) return /\\/header/i.test(s) ? 4 : 3;',
      '  /* 反证：不分级 */'),
    need: ['B1'],
  },
  {
    label: '⑧ ★★ 同名提优的两道护栏**一起**放宽（外层 ≤1→≤4 且内层严格大于→不差就换）',
    file: 'data/rank-merge.js',
    /* ⚠️ 这个打坏点改过两版，两版都不红，原因都是**打坏点选歪**、断言没歪：
       ① 只放宽外层 `coverScore(cands[0]) <= 1` → `<= 4`：被**内层**「新封面必须**严格大于**原得分」
          接住了（4 > 4 不成立）⇒ 不触发。
       ② 只放宽内层 `>` → `>=`：外层 `<= 1` 根本不让进分支（原封面 4 分）⇒ 也不触发。
       ⇒ 必须**两道一起放宽**才能真的造出「把已正确的大图换成另一张」的场景。
       这条教训值得留：**「反证不充分」有两种病因** —— 断言写歪（假绿）**或**打坏点选歪（没打到）。
          前者要改断言，后者要改打坏点；不查清就动手改断言，会把有效的守卫改松。 */
    break: (s) => s
      .replace('    if (coverScore(cands[0]) <= 1) {',
        '    if (coverScore(cands[0]) <= 4) {   /* 反证：外层护栏放宽 */')
      .replace('coverScore(alt.cover) >= 3 && coverScore(alt.cover) > coverScore(cands[0])',
        'coverScore(alt.cover) >= 3 && coverScore(alt.cover) >= coverScore(cands[0])   /* 反证：不差就换 */'),
    need: ['B6'],
  },
  {
    label: '⑨ 日期被当成热度值（`2026-10-14` 的日期语义丢失）',
    file: 'fetchers/xdupdate.js',
    break: (s) => s.replace("  if (/^\\d{4}-\\d{1,2}-\\d{1,2}$/.test(s)) return { value: s, valueKind: 'date' };\n",
      '  /* 反证：日期判据删除 */\n'),
    need: ['C1'],
  },
  {
    label: '⑩ 小图升级不保留 coverAlt（header 404 时前端没有回退燃料）',
    file: 'fetchers/xdupdate.js',
    break: (s) => s.replace('  return { cover: STEAM_HEADER(m[1]), coverAlt: url };',
      "  return { cover: STEAM_HEADER(m[1]), coverAlt: '' };   /* 反证：不留回退 */"),
    need: ['C5'],
  },
  {
    label: '⑪「最近更新」档的 src 从 xdgamer 改成 both（与拍板「仅 XD」不符）',
    file: 'server.js',
    break: (s) => s.replace("  recent: { label: '最近更新', src: 'xdgamer', tip: 'XD 官网 · 最近更新' },",
      "  recent: { label: '最近更新', src: 'both', tip: 'XD 官网 · 最近更新' },   /* 反证 */"),
    need: ['D2'],
  },
  {
    label: '⑫ Promise.allSettled 换成 Promise.all（任一侧抽风就整档挂）',
    file: 'server.js',
    break: (s) => s.replace('      const [pnRes, jdRes] = await Promise.allSettled([',
      '      const [pnRes, jdRes] = await Promise.all([   /* 反证：一挂全挂 */'),
    need: ['D6'],
  },
  {
    label: '⑬ 轮播把热度数字加回来（与「两源口径不同、不编综合热度」冲突）',
    file: 'public/index.html',
    break: (s) => s.replace('<div class="meta2">${src}${meta.join(\'\')}</div>',
      '<div class="meta2">${src}${"🔥 "}${meta.join(\'\')}</div>   <!-- 反证：热度回来了 -->'),
    need: ['D12'],
  },
];

/* ============ 断言 id 契约（把「need 写歪」变成机器能拦的事） ============
 * ★ 本文件不照抄断言全名（名字里有 ·/→/引号，抄一次就漂一次），改用**断言 id**
 *   （A1 / B6 / D12 …）匹配 —— 但 id 有「A1 会误配 A10」这类前缀陷阱，
 *   所以 ① 匹配时要求 `id + 空格` 边界；② 先验证每个 id 在套件里**唯一存在**。 */
const suiteSrc = fs.readFileSync(SUITE, 'utf8');
const IDS = [...suiteSrc.matchAll(/chk\('([A-Za-z0-9]+) /g)].map((m) => m[1]);
const idCount = new Map();
for (const x of IDS) idCount.set(x, (idCount.get(x) || 0) + 1);
function hit(fails, id) { return fails.some((l) => l === id || l.startsWith(id + ' ')); }

/* ============ 备份（一次全备，任何情况下都要还原） ============ */
const files = [...new Set(CASES.map((c) => c.file))];
const backups = new Map();
for (const f of files) backups.set(f, fs.readFileSync(path.join(ROOT, f), 'utf8'));
function restoreAll() {
  for (const [f, s] of backups) fs.writeFileSync(path.join(ROOT, f), s);
}

let bad = 0;
try {
  console.log('断言 id 契约检查（need 写歪 / 指向不存在的断言 = 反证会假过）\n' + '─'.repeat(74));
  for (const c of CASES) {
    for (const id of c.need) {
      const n = idCount.get(id) || 0;
      const ok = n === 1;
      if (!ok) bad++;
      console.log((ok ? '  ✅ ' : '  ❌ ') + c.label.split('（')[0].split(' ')[0] + '  need ' + id
        + (ok ? '' : '  —— 在套件里出现 ' + n + ' 次（必须恰好 1 次）'));
    }
  }
  if (bad) { console.log('\n❌ 断言 id 契约不过 —— 先修本文件。'); process.exit(1); }

  console.log('\n靶子存在性预检（锚点对不上 = 反证会假过，必须先拦住）\n' + '─'.repeat(74));
  for (const c of CASES) {
    const orig = backups.get(c.file);
    const broken = c.break(orig);
    const ok = broken !== orig;
    console.log((ok ? '  ✅ ' : '  ❌ ') + c.label.split('（')[0].split(' ')[0] + '  锚点' + (ok ? '命中' : '**没命中**'));
    if (!ok) bad++;
  }
  if (bad) { console.log('\n❌ 有 ' + bad + ' 个打坏点的问题 —— 先修本文件，再谈反证。'); process.exit(1); }

  const base = runSuite();
  const m0 = base.match(SUM_ANY);
  const green = !!(m0 && Number(m0[3]) === 0);
  console.log('\n基线（未打坏）：' + (green
    ? '通过 ' + m0[1] + ' / ' + m0[2] + '（全绿 ✓）'
    : '**基线不是全绿 —— 先修套件**'));
  if (!green) { console.log(base.slice(-1500)); process.exit(1); }
  const total = Number(m0[1]);
  if (total !== Number(m0[2])) { console.log('❌ 基线有失败项。'); process.exit(1); }

  let failures = 0;
  for (const c of CASES) {
    fs.writeFileSync(path.join(ROOT, c.file), c.break(backups.get(c.file)));
    const out = runSuite();
    restoreAll();
    const fails = [...out.matchAll(/❌ ([A-Za-z0-9]+) /g)].map((m) => m[1]);
    const mm = out.match(SUM_ANY);
    const allGreen = !!(mm && Number(mm[3]) === 0);
    const ok = c.need.every((id) => hit(fails, id));
    if (!ok) failures++;
    console.log('\n▶ ' + c.label);
    console.log('   ' + (out.match(/通过 \d+ \/ \d+（失败 \d+）/) || ['(无汇总)'])[0]
      + '   变红 ' + fails.length + ' 条' + (allGreen ? '（**没变红**）' : ''));
    console.log('   ' + (ok ? '✅ 期望的断言已变红：' + c.need.join(' + ')
      : '❌ 反证不充分 —— 这些断言打坏后**没变红**（假绿）：\n      ' + c.need.join(', ')
        + '\n      实际变红的：' + (fails.join(', ') || '(无)')));
  }

  console.log('\n◀ 全部还原后复跑');
  const after = runSuite();
  const m1 = after.match(SUM_ANY);
  const green1 = !!(m1 && Number(m1[3]) === 0);
  console.log('   ' + (green1 ? '通过 ' + m1[1] + ' / ' + m1[2] + '（失败 0）\n   ✅ 还原干净'
    : '**还原后不是全绿** —— 还原可能也是假的'));
  if (!green1) failures++;

  console.log('\n' + (failures
    ? '❌ 反证失败 ' + failures + ' 项'
    : '✅ 反证全部通过：' + CASES.length + '/' + CASES.length + ' 打坏点都让预期的断言变红了，且还原后复跑全绿。'));
  process.exit(failures ? 1 : 0);
} catch (e) {
  restoreAll();
  console.error('FATAL', e);
  console.error('（已尝试还原被改动的文件）');
  process.exit(2);
}
