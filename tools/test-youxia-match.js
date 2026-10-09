/* tools/test-youxia-match.js — 「游侠存档 × 端游库」名称匹配层回归 —— 第 41 道防线
 *
 * 为什么单独开一道（v10.46）：
 *   这条链路此前**零测试覆盖** —— tools/test-saves-match.js 测的是另一条路
 *   （Ludusavi manifest 的**路径**匹配），跟游侠的**标题前缀**匹配毫无关系。
 *   而这一层错的代价是**静默的且成规模的**：口径一旦走偏，几百条存档会整批
 *   「看起来没有」，而页面照常渲染 —— v10.46 就真的发生过一次（1,952 vs 2,043）。
 *
 * 分组：
 *   A. 代际护栏查询口径 genAdjReject（本轮修正的核心，逐条带真实样本）
 *   B. matchYxEntry 三个分支（书名号 / 首段 / 收缩）+ 反例守卫
 *   C. shrinkCandidates 下限（≥3 字，2 字收缩是误配重灾区）
 *   D. 源码反向锚点（防回退到「拿整条标题问护栏」的旧口径）
 *   E. 落盘数据 ↔ 当前匹配代码 的一致性（缓存存在时才跑，缺缓存跳过）
 */
const fs = require('fs');
const path = require('path');

const yx = require('../fetchers/youxiaSave');
const { buildLibIndex } = require('../data/mod-match');

let pass = 0, fail = 0;
const bad = [];
function t(ok, label, detail) {
  if (ok) pass++; else { fail++; bad.push(label); }
  console.log(`${ok ? '  PASS' : '× FAIL'}  ${label}${detail ? '  —— ' + detail : ''}`);
}

/* ============ A. 代际护栏口径 ============ */
console.log('=== A. genAdjReject：只有「紧贴命中键的那一位数字」才算代际 ===');
{
  const lib = (title) => ({ id: 'lib-x', title });
  const R = yx.genAdjReject;

  /* —— 真代际：必须拒（这 5 类都是从旧落盘结果里逐条核对出来的真错配）—— */
  t(R('仙剑奇侠传6 全流程全节点通关存档', '仙剑奇侠传', lib('仙剑奇侠传/Sword and Fairy')) === true,
    '仙剑奇侠传6 → 命中「仙剑奇侠传」（库只有 1 代）⇒ 拒');
  t(R('仙剑奇侠传3外传问情篇 简繁体中文通用版V1.20升级档免CD补丁修正版', '仙剑奇侠传', lib('仙剑奇侠传/Sword and Fairy')) === true,
    '仙剑奇侠传3外传 → 同上，紧贴位是 3 ⇒ 拒');
  t(R('三位一体2 v1.15升级档+免DVD补丁THETA版', '三位一体', lib('三位一体/Trine')) === true,
    '三位一体2 → 命中「三位一体」⇒ 拒');
  t(R('进击的巨人2 全剧情通关存档', '进击的巨人', lib('进击的巨人/Attack on Titan')) === true,
    '进击的巨人2 → 命中「进击的巨人」⇒ 拒');
  t(R('永恒之柱2：死亡之火 v3.0.2.0027升级档+免DVD补丁CODEX版', '永恒之柱', lib('永恒之柱/Pillars of Eternity')) === true,
    '永恒之柱2 → 命中「永恒之柱」⇒ 拒');

  /* —— 版本号 / 等级 / 序号：必须放行（旧口径「整条标题」正是在这里大面积误拒）—— */
  t(R('泰拉瑞亚 地图存档v1.2', '泰拉瑞亚', lib('泰拉瑞亚/Terraria')) === false,
    '泰拉瑞亚 v1.2 ⇒ 紧贴位是空格，版本号不参与代际 ⇒ 放行');
  t(R('厕所穿越记 v1.47升级档+免DVD补丁RAiN版', '厕所穿越记', lib('厕所穿越记/Unepic')) === false,
    '厕所穿越记 v1.47 ⇒ 放行');
  t(R('龙珠：超宇宙 80级全技能初始存档', '龙珠：超宇宙', lib('龙珠：超宇宙/DRAGON BALL XENOVERSE')) === false,
    '龙珠：超宇宙 80级 ⇒ 80 是等级，不在紧贴位 ⇒ 放行');
  t(R('特殊行动：一线生机 2号升级档+免DVD补丁SKIDROW版', '特殊行动：一线生机', lib('特殊行动：一线生机/Spec Ops: The Line')) === false,
    '特殊行动：一线生机 2号升级档 ⇒ 放行');
  t(R('愤怒的小鸟季节版V2.4全关卡三星全金蛋存档', '愤怒的小鸟季节版', lib('愤怒的小鸟：季节版/Angry Birds Seasons')) === false,
    '愤怒的小鸟季节版V2.4 ⇒ 紧贴位是字母 V ⇒ 放行');

  /* —— 只认 1 位：两位数字在存档标题里基本是量词 —— */
  t(R('丧尸围城2：绝密档案50级弗兰克大叔S评价存档', '丧尸围城2：绝密档案', lib('丧尸围城2：绝密档案/Dead Rising 2: Off the Record')) === false,
    '50级 的 50 是等级：只认 1 位 ⇒ 不当代际 ⇒ 放行');

  /* —— 紧贴位**不跨空白**：空格后的数字是补丁序号/数量/版本，不是代际 ——
     这 5 条来自一次真实实验：跨空白版本把匹配从 2,043 打到 2,012，
     多拒的 31 条逐条核对全是真匹配。 */
  t(R('迸发 6号升级档单独免DVD补丁CODEX版', '迸发', lib('迸发/机甲狂潮/巨浪/The Surge')) === false,
    '「迸发 6号升级档」：6 是补丁序号，跨空白取数会误拒 ⇒ 必须放行');
  t(R('无主之地2 4职业初始修改档', '无主之地2', lib('无主之地2/Borderlands 2')) === false,
    '「无主之地2 4职业…」：4 是职业数 ⇒ 放行');
  t(R('星界边境 8.0有三千伤害的弓的存档', '星界边境', lib('星界边境/Starbound')) === false,
    '「星界边境 8.0…」：8.0 是版本 ⇒ 放行');
  t(R('火炬之光2  1号升级档+免DVD补丁RELOADED版', '火炬之光2', lib('火炬之光2/Torchlight II')) === false,
    '「火炬之光2  1号」：1 是补丁序号（连两个空格也不例外）⇒ 放行');

  /* —— 库条目自己带那个数字 ⇒ 是同一代，放行 —— */
  t(R('鬼泣5 完美存档', '鬼泣5', lib('鬼泣5/Devil May Cry 5')) === false,
    '鬼泣5 → 库条目本身就是鬼泣5 ⇒ 放行（护栏只做「查询有、命中没有」这一个方向）');

  /* —— 边界与健壮性 —— */
  t(R('', '', lib('x')) === false, '空输入不抛错且判不拒');
  t(R('某游戏 存档', '某游戏', null) === false, 'lib 为 null 时不抛错且判不拒');
  t(R('某游戏 存档', '不存在的键', lib('x')) === false, '锚点不在标题里 ⇒ 判不拒（不产生凭空拒绝）');
  t(R('剑星 完美存档', '剑星', lib('剑星/Stellar Blade')) === false,
    '2 字短名（剑星）照常放行 —— 收紧护栏不能把短名一起误杀');
}

/* ============ B. matchYxEntry 三个分支 ============ */
console.log('\n=== B. matchYxEntry 分支 ===');
{
  const lib = [
    { id: 'L1', title: '泰拉瑞亚/Terraria' },
    { id: 'L2', title: '黑道圣徒/Saints Row' },
    { id: 'L3', title: '艾尔登法环/ELDEN RING' },
    { id: 'L4', title: '热血/Hot Blood' },
    { id: 'L5', title: '剑星/Stellar Blade' },
    { id: 'L6', title: '仙剑奇侠传/Sword and Fairy' },
    { id: 'L7', title: '迸发/机甲狂潮/巨浪/The Surge' },
    { id: 'L8', title: '无主之地2/Borderlands 2' },
  ];
  const { byName } = buildLibIndex(lib);

  const b = yx.matchYxEntry({ id: '1', title: '《艾尔登法环》全结局存档', game: '艾尔登法环' }, byName);
  t(b.how === 'bracket' && b.lib && b.lib.id === 'L3', '① 书名号命中 ⇒ how=bracket（精确，最可靠）');

  const a1 = yx.matchYxEntry({ id: '2', title: '泰拉瑞亚 地图存档v1.2', game: '' }, byName);
  t(a1.how === 'prefix' && a1.key === '泰拉瑞亚' && a1.lib.id === 'L1',
    '② 首段整段命中且标题带**版本后缀**（泰拉瑞亚 地图存档v1.2）⇒ prefix，版本号不干扰',
    a1.how + '/' + a1.key);

  const a1b = yx.matchYxEntry({ id: '2b', title: '迸发 6号升级档单独免DVD补丁CODEX版', game: '' }, byName);
  t(a1b.how === 'prefix' && a1b.key === '迸发',
    '② 首段命中的分支**不做代际判定**（空格后是「6号」补丁序号，判了就会误拒）',
    a1b.how + '/' + a1b.key);

  const a1c = yx.matchYxEntry({ id: '2c', title: '无主之地2 4职业初始修改档', game: '' }, byName);
  t(a1c.how === 'prefix' && a1c.key === '无主之地2',
    '② 首段命中：紧贴位不跨空白（空格后的 4 是职业数，不是第 4 代）', a1c.how + '/' + a1c.key);

  const a2 = yx.matchYxEntry({ id: '3', title: '剑星 完美存档', game: '' }, byName);
  t(a2.how === 'prefix' && a2.lib.id === 'L5', '② 首段命中放行 2 字中文名（剑星）');

  const a3 = yx.matchYxEntry({ id: '4', title: '黑道圣徒3超完美存档', game: '' }, byName);
  t(a3.how === 'none' && a3.genReject === true,
    '③ 收缩到「黑道圣徒」但紧贴位是 3 ⇒ 代际护栏拒绝（不把 3 代存档挂到 1 代）',
    a3.how + '/genReject=' + a3.genReject);

  const a4 = yx.matchYxEntry({ id: '5', title: '热血无赖 全收集存档', game: '' }, byName);
  t(a4.how === 'none', '③ 2 字收缩不许命中（「热血无赖」→「热血」一律拒绝：宁可漏，也不误挂）', a4.how + '/' + a4.key);

  const a5 = yx.matchYxEntry({ id: '6', title: '《寂静岭：Townfall》已通关存档', game: '寂静岭：Townfall' }, byName);
  t(a5.how === 'none', '① 书名号但库里没有 ⇒ 直接判未匹配（不拿标题去前缀猜）', a5.how);

  t(yx.matchYxEntry({ id: '7', title: '', game: '' }, byName).how === 'none', '空标题不抛错');

  /* 返回结构：how 必须可审计 —— bracket / prefix 混在一起就分不清「真匹配」和「猜的」 */
  t(['bracket', 'prefix', 'none'].includes(a1.how) && typeof a1.klen === 'number',
    '返回值可审计：how 三态 + klen 长度');
}

/* ============ C. shrinkCandidates ============ */
console.log('\n=== C. shrinkCandidates：前缀收缩下限 ===');
{
  const c = yx.shrinkCandidates('黑道圣徒3超完美存档');
  t(c.length === 0 || Math.min(...c.map((x) => x.length)) >= 3, '收缩候选一律 ≥3 字', '最短 ' + Math.min(...c.map((x) => x.length)));
  t(yx.shrinkCandidates('剑星 完美存档').length === 0, '首段仅 2 字时无收缩候选（2 字收缩是误配重灾区）');
  t(yx.shrinkCandidates('').length === 0, '空串返回空数组');
  const long = yx.shrinkCandidates('仙剑奇侠传3外传问情篇 简繁体中文通用版');
  t(long.every((x) => x.length >= 3), '长名收缩结果仍全部 ≥3 字');
  t(!long.includes('仙剑奇侠传3外传问情篇'), '收缩候选不含整段本身（整段由调用方先精确试过）');
}

/* ============ D. 源码反向锚点 ============ */
console.log('\n=== D. 源码口径锚点（防静默回退）===');
{
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'fetchers', 'youxiaSave.js'), 'utf8');
  t(/if \(genAdjReject\(item\.title, c, lib\)\) return Object\.assign\(\{\}, rej, \{ genReject: true \}\);/.test(SRC),
    '前缀通道②（收缩命中）走 genAdjReject，且锚点是**收缩候选 c**（不是整条标题、也不是 first）');
  /* ★ 反向断言 1：护栏不许拿「整条标题」当查询参数 —— 那正是本轮多拒 91 条的成因 */
  t(!/numMismatchByTitle\(item\.title/.test(SRC),
    '反向：源码中不存在 numMismatchByTitle(item.title …)（旧口径已清除）');
  /* ★ 反向断言 2：分支①（首段整段命中）**不得**做代际判定 ——
     实测理由：its 检索键恒等于「首个空白前那一段」，紧贴位必是空白；
     跨空白取数会把这 31 条补丁序号判成代际（匹配 2,043 → 2,012，31/31 全是真匹配）。 */
  t(!/genAdjReject\(item\.title, first, lib\)/.test(SRC),
    '反向：分支① 不得做代际判定（跨空白取数会误拒 31 条补丁序号，实测过）');
  /* 共享护栏仍用于精确通道（不能因为改口径把它一起删了） */
  t(/numMismatchByTitle\(item\.game, lib\)/.test(SRC),
    '精确通道仍用共享护栏 numMismatchByTitle(item.game, lib)（没被顺手删掉）');
  /* 紧贴位不跨空白（genAdjReject 内不得出现先剥空白的写法） */
  t(!/slice\(i \+ String\(matchedRaw\)\.length\)\.replace\(\/\^\\s\+\//.test(SRC),
    '反向：紧贴位取数不跨空白（跨空白版实测误拒 31 条）');
}

/* ============ E. 落盘数据 ↔ 当前匹配代码 ============ */
console.log('\n=== E. data/saves-youxia.json 与当前匹配代码一致 ===');
{
  const ROOT = path.join(__dirname, '..');
  const FILE = path.join(ROOT, 'data', 'saves-youxia.json');
  const CACHE = path.join(ROOT, 'data', '_yx-list-raw.json');
  if (!fs.existsSync(FILE)) {
    console.log('  （跳过：data/saves-youxia.json 不存在，先跑 node tools/fetch-saves-youxia.js）');
  } else {
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const st = d.stats || {};
    const items = d.items || [];
    t(items.length > 1000, `条目量级正常（${items.length} 条）`);
    t(st.matched === st.matchBracket + st.matchPrefix, 'stats：matched = 书名号 + 前缀');
    t(st.listTotal === st.matchBracket + st.matchPrefix + st.matchNone,
      'stats：listTotal = 三态之和（没漏统计）');
    t(items.every((x) => x.id && x.libId), '每条都有 id 与 libId（libId 是列表要用的关联键）');
    t(items.every((x) => x.matchHow === 'bracket' || x.matchHow === 'prefix'),
      'matchHow 只有 bracket / prefix（none 的不该进落盘）');
    t(items.every((x) => x.libTitle && x.sourceUrl), '每条都带 libTitle 与 sourceUrl（详情要跳转）');
    const bracket = items.filter((x) => x.matchHow === 'bracket').length;
    const prefix = items.filter((x) => x.matchHow === 'prefix').length;
    t(items.length === st.detailTotal, 'stats.detailTotal 与 items 长度一致');
    if (st.crashed === 0) t(items.length === st.matched, '无崩溃时：落盘条数 == matched');

    /* ★ 关键一致性断言：拿缓存列表按**当前代码**重算一遍，三态必须与落盘 stats 完全相同。
       这一条正是本轮事故的探测器 —— 匹配口径改了但数据没重跑时，它会红。 */
    if (!fs.existsSync(CACHE)) {
      console.log('  （跳过重算比对：data/_yx-list-raw.json 不存在）');
    } else {
      const gamesDb = require('../data/gamesDb');
      gamesDb.load();
      const { byName } = buildLibIndex(gamesDb.all());
      const list = JSON.parse(fs.readFileSync(CACHE, 'utf8')).items || [];
      let mb = 0, mp = 0, mn = 0;
      for (const it of list) {
        const m = yx.matchYxEntry(it, byName);
        if (m.how === 'bracket') mb++; else if (m.how === 'prefix') mp++; else mn++;
      }
      t(mb === st.matchBracket && mp === st.matchPrefix && mn === st.matchNone,
        '★ 用当前代码重算缓存列表 ⇒ 三态与落盘 stats 完全相同（口径改了但没重跑数据会在这里红）',
        `重算 ${mb}/${mp}/${mn} vs 落盘 ${st.matchBracket}/${st.matchPrefix}/${st.matchNone}`);
      t(bracket === st.matchBracket && prefix === st.matchPrefix,
        'items 里的 matchHow 计数与 stats 一致');
    }
  }
}

console.log(`\n结果：${pass} / ${pass + fail} 通过`);
if (bad.length) console.log('未通过：\n  - ' + bad.join('\n  - '));
process.exit(fail ? 1 : 0);
