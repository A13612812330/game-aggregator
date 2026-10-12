/* tools/test-mods.js — 「MOD / 修改器」（机地社区帖）抓取层回归 —— 第 9 道防线
 *
 * 这一块出错的代价特别大，因为**错的都是静默的**：
 *   · 签名算错 → 服务端只回一句「请求参数错误」，不告诉你是签名还是参数（v: 排查了一轮才定位）
 *   · body 少字段 → 同上，同一句话
 *   · 匹配键写错 → 匹配率腰斩（55%），但列表照样能出，只是大半卡片「未关联」
 *   · 链接提取写错 → 用户点进去才发现是死链/半截链
 * 所以这层回归分五组把不变量钉死：
 *   A. websign 算法（与站点 app chunk 的还原结果一致、确定性、随 ct 变化）
 *   B. 匹配键（CJK 2 字放行 / ASCII ≥3 / `/` 分段）
 *   C. 网盘链接提取（真实样本、去重、截尾标点、上限）
 *   D. shape 归一（封面拼接、kind 映射、正文截断、id 字符串化）
 *   E. 落盘数据与查询模块的不变量（对真实 data/mods.json 断言）
 */
const { websign, extractLinks, shape, BODY_SALT } = require('../fetchers/jidiModify');
/* ★ v10.46：`normKey` 走**唯一真源** name-normalize（mod-match 不再转发它） */
const { keyUsable, buildLibIndex, matchLib, matchWithBasis, subMatch, subKeyUsable } = require('../data/mod-match');
const { normKey } = require('../data/name-normalize');
const crypto = require('crypto');

let pass = 0, fail = 0;
const bad = [];
function t(ok, label, detail) {
  if (ok) pass++; else { fail++; bad.push(label); }
  console.log(`${ok ? '  PASS' : '× FAIL'}  ${label}${detail ? '  —— ' + detail : ''}`);
}

/* ============ A. websign ============ */
console.log('=== A. websign（还原自站点 app chunk，模块 67052）===');
{
  const md5 = (s) => crypto.createHash('md5').update(String(s), 'utf8').digest('hex');
  const body = { sort: 'new', limit: 100, resource_type: 2, next_cb: null, h_ts: 1700000000000, h_ch: 'other', h_m: 0 };
  const expect = 'v2-' + md5('0' + md5(JSON.stringify(body) + BODY_SALT));
  t(websign(body) === expect, '算法与还原式逐字一致：v2-md5(h_m + md5(json + salt))');
  t(websign(Object.assign({}, body)) === websign(body), '确定性：同样输入得同样签名');
  t(/^v2-[0-9a-f]{32}$/.test(websign(body)), '格式为 v2- + 32 位小写 hex', websign(body));

  const b2 = Object.assign({}, body, { ct: 1 });
  t(websign(b2) !== websign(body), 'body 变化（多一个 ct）→ 签名随之变化');

  const noHm = { a: 1 };
  t(websign(noHm) === 'v2-' + md5('0' + md5(JSON.stringify(noHm) + BODY_SALT)),
    'h_m 缺失时按 0 参与（站点同款 `e.h_m || 0`）');

  /* ★ 关键回归：sign 与 websign 必须**都**等于 websign(bodyWithSign) 的那一次计算，
     即 websign 必须在 body 已含 sign 之后重算 —— 混用顺序会得到「看起来对但服务端拒绝」的值 */
  const b3 = Object.assign({}, body, { sign: 'v2-' + 'x'.repeat(32) });
  t(websign(b3) !== websign(body), 'body 已含 sign 时签名不同（顺序敏感，不能混用）');
}

/* ============ B. 匹配键 ============ */
console.log('\n=== B. 匹配键（长度护栏 + `/` 分段）===');
{
  t(keyUsable('剑星'), '2 字中文名放行（旧 `length>=3` 会误杀：剑星/鸣潮/仁王 全 MISS）');
  t(keyUsable('鸣潮'), '2 字中文名放行②');
  t(!keyUsable('剑'), '1 字中文名拒绝（太短易误配）', String(keyUsable('剑')));
  t(!keyUsable('ab'), '2 字纯 ASCII 拒绝（噪声键）');
  t(keyUsable('abc'), '3 字 ASCII 放行');
  t(!keyUsable(''), '空键拒绝');

  t(normKey('艾尔登法环/ELDEN RING') === '艾尔登法环eldenring', 'normKey 会吃掉 `/`（这正是必须分段的原因）');
  t(normKey('剑星', true) === '剑星', 'normKey 保留中文字符');

  const lib = [
    { id: 'xd-1', title: '艾尔登法环/ELDEN RING' },
    { id: 'xd-2', title: '剑星/Stellar Blade voices38' },
    { id: 'xd-3', title: '龙之剑:觉醒/DragonSword : Awakening' },
  ];
  const { byName } = buildLibIndex(lib);
  t(byName.get('艾尔登法环') && byName.get('艾尔登法环').id === 'xd-1', '库侧 `/` 分段：中文段可命中');
  t(byName.get('eldenring') && byName.get('eldenring').id === 'xd-1', '库侧 `/` 分段：英文段可命中');
  t(byName.get('剑星') && byName.get('剑星').id === 'xd-2', '★ 2 字中文名进入索引（本次修复的核心）');

  t(matchLib('艾尔登法环', byName).id === 'xd-1', '条目侧普通中文名命中');
  t(matchLib('ELDEN RING', byName).id === 'xd-1', '条目侧英文名命中（大小写不敏感）');
  t(matchLib('龙之剑:觉醒/DragonSword : Awakening', byName).id === 'xd-3',
    '★ 条目侧同样是拼接串 → 分段命中（整串归一化会拼成 `龙之剑觉醒dragonswordawakening` 而 MISS）');
  t(matchLib('不存在的游戏', byName) === null, '不命中返回 null');
  t(matchLib('', byName) === null, '空名返回 null');

  /* 反例守卫：不能因为分段就变得过松 —— 拼错的整串仍不该命中 */
  t(matchLib('艾尔登法环2', byName) === null, '守卫：多一个字符不会误配');
}

/* ============ B2. 子串回退（v10.55）============
 * 背景：匹配键长期只有「精确命中」一条路，而 MOD 源的 game 是**泛称**、
 *   端游库 title 是**具体版本名**，差一个版本后缀就整批漏配。
 *   实测 mods 8,943 条里 1,867 条（20.9%）libId 为空，而 mods 列表默认 matchedOnly
 *   ⇒ 端游资源页**一条都不显示**（用户报障：「手机专区的巫师3，端游那边无关联」）。
 *
 * ★ 每一道护栏都必须有「**只有它能挡**」的样本（铁律 63：归因别归错闸）。
 *   下面每条都注明了「其它四道为什么挡不住它」。 */
console.log('\n=== B2. 子串回退的五道护栏（v10.55）===');
{
  const mk = (arr) => buildLibIndex(arr);

  /* G1 短键：CJK ≥3 / ASCII ≥4。
   * 样本 `魔法`(2)：比例 2/4=0.5 过 G3、无数字过 G2、不降级过 G4 ⇒ **只有 G1 能挡**。 */
  const i1 = mk([{ id: 'xd-1', title: '剑与魔法' }]);
  t(subMatch(normKey('魔法'), i1.byName) === null, 'G1 短键：2 字查询键不参与回退（唯一样本：比例/数字/降级都放行）');
  t(subKeyUsable('剑与魔法') && !subKeyUsable('魔法'), 'G1 阈值：CJK 3 放行 / 2 拒绝（比索引层的 CJK 2 更严）');

  /* G2 数字：查询带数字 ⇒ 候选键必须含。
   * ★ 样本必须**让精确路径不可用**，否则 matchLib 走 exact 就对了，测不到 G2。
   *   这里库里只有不带 3 的 `侏罗纪世界：进化`(7) vs 查询 `侏罗纪世界：进化 3`(8)：
   *   比例 7/8=0.875 过 G3、长度过 G1、不降级过 G4 ⇒ **只有 G2 能挡**。 */
  const i2 = mk([{ id: 'xd-A', title: '侏罗纪世界：进化' }]);
  t(subMatch(normKey('侏罗纪世界：进化 3'), i2.byName) === null,
    'G2 数字：带 3 的查询不吃无 3 的候选（比例 0.875 与长度都放行）');
  /* 对照：同一条链路在「无数字」时应当正常命中 —— 证明是 G2 在挡，不是整段失效 */
  const i2c = mk([{ id: 'xd-A', title: '侏罗纪世界：进化 完全版' }]);
  const r2c = subMatch(normKey('侏罗纪世界：进化'), i2c.byName);
  t(r2c && r2c.it.id === 'xd-A', 'G2 对照：无数字查询正常命中（同链路可用 ⇒ 上一条红是 G2 造成的）');
  const i2b = mk([{ id: 'xd-A', title: '侏罗纪世界：进化' }, { id: 'xd-B', title: '侏罗纪世界：进化3' }]);
  t(matchWithBasis('侏罗纪世界：进化 3', i2b.byName).it.id === 'xd-B', 'G2 对照：库里有带 3 的条目时走精确命中，拿 xd-B');
  /* 真实库同款（铁律 35：别只信合成样本） */
  {
    const modsDb = require('../data/mods.json');
    const g = modsDb.items.filter((x) => x.game === '侏罗纪世界：进化 3');
    t(g.length > 0 && g.every((x) => !x.libId), 'G2 数字（真实库）：`侏罗纪世界：进化 3` 不挂到无 3 的 `侏罗纪世界：进化`', g.length + ' 条');
  }

  /* G3 比例（粗筛）：短/长 < 0.5。
   * 样本 `仁王2`(3) vs 库键 `仁王2完全版终极收藏版`(10)：过 G1、数字一致过 G2、不降级过 G4 ⇒ **只有 G3 能挡**。 */
  const i3 = mk([{ id: 'xd-1', title: '仁王2完全版终极收藏版' }]);
  t(subMatch(normKey('仁王2'), i3.byName) === null, 'G3 比例：3/10=0.30 被粗筛挡（数字与长度都放行）');

  /* G4 变体降级：候选含 虚拟机版/HYPERVISOR/Demo… ⇒ 不自动挂。
   * 样本 `怪物猎人：荒野`：比例 6/11=0.545 过 G3、长度过 G1、无数字过 G2 ⇒ **只有 G4 能挡**。 */
  const i4 = mk([{ id: 'xd-1', title: '怪物猎人：荒野-虚拟机版/Monster Hunter Wilds HYPERVISOR' }]);
  t(subMatch(normKey('怪物猎人：荒野'), i4.byName) === null, 'G4 降级：只剩「-虚拟机版」候选时不猜（那是另一种内容）');
  {
    const modsDb = require('../data/mods.json');
    const g = modsDb.items.filter((x) => /^怪物猎人：荒野/.test(x.game || ''));
    t(g.length > 0 && g.every((x) => !x.libId), 'G4（真实库）：`怪物猎人：荒野` 不挂到 -虚拟机版', g.length + ' 条');
  }

  /* G5 仲裁：多候选取 id 序号最小者（已匹配的不因此改变）。
   * 样本 `巫师3：狂猎`：两个候选都是同名变体，长度 5/9 与 5/8 都过 G3 ⇒ 必须仲裁。
   * ★ 这也是本版**唯一需要仲裁**的真实样本（另两个：剑与魔法 / 荒野大镖客）。 */
  const i5 = mk([
    { id: 'xd-120', title: '巫师3：狂猎次世代版/The Witcher 3: Wild Hunt' },
    { id: 'xd-16382', title: '巫师3：狂猎 — 重制版/The Witcher 3: Wild Hunt — Remastered' },
  ]);
  const r5 = subMatch(normKey('巫师3：狂猎'), i5.byName);
  t(r5 && r5.it.id === 'xd-120', 'G5 仲裁：巫师3 → xd-120（次世代版，MOD 标题写的就是「次世代」）');
  t(r5 && r5.basis === 'substring-ambiguous', 'G5 仲裁会**标注**依据（basis=substring-ambiguous）供审计');
  t(r5 && r5.it.id !== 'xd-16382', 'G5 反面：不能是 xd-16382（- 重制版）');

  /* 主路径回归：加了回退，精确命中不能变 */
  const i6 = mk([{ id: 'xd-1', title: '艾尔登法环/ELDEN RING' }, { id: 'xd-2', title: '剑星/Stellar Blade' }]);
  t(matchLib('艾尔登法环', i6.byName).id === 'xd-1', '回归：精确命中路径不受回退影响①');
  t(matchLib('剑星', i6.byName).id === 'xd-2', '回归：精确命中路径不受回退影响②');
  t(matchWithBasis('剑星', i6.byName).basis === 'exact', '回归：精确命中标注 basis=exact');
  t(matchWithBasis('剑星的剑星剑星', i6.byName).it === null, '回归：多字噪声仍不命中（未被回退放开）');

  /* 正向子串链路本身可用（真实样本；反证 F 分支就打这条）
     ★ 断言必须**判空**：直接写 `.it.id` 在回退被删掉时会**抛异常**，
       整套件崩掉 ⇒ 反证里「打坏后没变红」根本读不出来（铁律 58 的同类）。 */
  const i7 = mk([{ id: 'xd-1413', title: '生化危机8：村庄/Resident Evil Village' }]);
  const r7 = matchWithBasis('生化危机8', i7.byName);
  t(!!r7.it && r7.it.id === 'xd-1413', '正向子串：`生化危机8` → `生化危机8：村庄`（回退链路可用）');
  t(r7.basis === 'substring', '正向子串标注 basis=substring');
  const i8 = mk([{ id: 'xd-227', title: '侠盗猎车手5 MOD版/GTA5 MOD版/Grand Theft Auto V' }]);
  const r8 = matchWithBasis('Grand Theft Auto V 传承版', i8.byName);
  t(!!r8.it && r8.it.id === 'xd-227', '反向子串：`Grand Theft Auto V 传承版` → 更短的库键（只做正向时这条必红）');

  /* 真实数据总账 */
  {
    const modsDb = require('../data/mods.json');
    const total = modsDb.items.length, matched = modsDb.items.filter((x) => x.libId).length;
    const rate = matched / total * 100;
    t(rate >= 90, '★ 全库匹配率 ≥ 90%（v10.54 实测 79.1% ⇒ 本次回退是唯一增量来源）', rate.toFixed(1) + '%');
    t(modsDb.stats.matched === matched, 'stats.matched 与 items 实际一致');
    const basisOk = modsDb.items.every((x) => (x.libId ? true : !x.matchBasis));
    t(basisOk, '未匹配条目不残留 matchBasis');
    const subOnly = modsDb.items.filter((x) => x.matchBasis === 'substring' || x.matchBasis === 'substring-ambiguous');
    t(subOnly.length > 500, '回退命中条数 ≥ 500（实测 825）', subOnly.length + ' 条');
    const w3 = modsDb.items.filter((x) => /巫师3/.test(x.game || ''));
    t(w3.length >= 90 && w3.every((x) => x.libId === 'xd-120'),
      '★ 用户报障样本：巫师3 的 MOD 全部关联到 xd-120', w3.filter((x) => x.libId).length + '/' + w3.length);
    const gta = modsDb.items.filter((x) => x.game === 'Grand Theft Auto V 传承版');
    t(gta.length >= 500 && gta.every((x) => x.libId === 'xd-227'),
      '★ 最大一头：GTA V 传承版（反向子串，只做正向时整批漏）', gta.filter((x) => x.libId).length + '/' + gta.length);
  }
}

/* ============ C. 网盘链接提取 ============ */
console.log('\n=== C. 链接提取（用户真正要的东西）===');
{
  const real = '🌟下载链接❗:\n通过网盘分享的文件：噬血代码2\n链接: https://pan.baidu.com/s/1QiOEMBNkzxAUY3G6-XUgCQ?pwd=vvev 提取码: vvev \n--来自百度网盘超级会员v2的分享\n\n我用夸克网盘给你分享了「噬血代码2」\n链接：https://pan.quark.cn/s/b302cb72ec07\n\n分享文件：噬血代码2\n链接：https://pan.xunlei.com/s/VP1T0pa-BZInmR9F-ksC_4VqA1?pwd=pk9y#\n复制这段内容后打开迅雷';
  const l = extractLinks(real);
  t(l.length === 3, `真实正文提取到 3 条链接（实得 ${l.length}）`);
  t(l.map((x) => x.kind).join(',') === '百度网盘,夸克网盘,迅雷网盘',
    '网盘类型识别正确', l.map((x) => x.kind).join(','));
  t(l[0].url === 'https://pan.baidu.com/s/1QiOEMBNkzxAUY3G6-XUgCQ?pwd=vvev', 'URL 完整保留 query（pwd 是提取码，不能丢）', l[0].url);

  t(extractLinks('看 https://pan.quark.cn/s/abc。').length === 1, '中文句号结尾不粘进 URL');
  t(extractLinks('看 https://pan.quark.cn/s/abc。')[0].url === 'https://pan.quark.cn/s/abc', '句号被裁掉');
  t(extractLinks('见（https://pan.quark.cn/s/abc）')[0].url === 'https://pan.quark.cn/s/abc', '中文括号被裁掉');
  t(extractLinks('a https://x.com/1 和 https://x.com/1 重复')[0], '重复链接去重', String(extractLinks('https://x.com/1 https://x.com/1').length));
  t(extractLinks('https://x.com/1 https://x.com/1').length === 1, '去重确实生效');
  t(extractLinks('没有链接的一段话').length === 0, '无链接返回空数组');
  t(extractLinks('').length === 0, '空正文不报错');
  t(extractLinks('www.pan.quark.cn/s/abc').length === 0, '不带协议的裸域名不抓（避免误抓）');

  const many = Array.from({ length: 30 }, (_, i) => 'https://pan.quark.cn/s/' + i).join(' ');
  t(extractLinks(many).length === 12, '单条正文最多抽 12 个链接（防正文爆炸）', String(extractLinks(many).length));
  t(extractLinks('https://www.nexusmods.com/x')[0].kind === '其他链接', '非网盘链接标为「其他链接」');
}

/* ============ D. shape 归一 ============ */
console.log('\n=== D. shape（源站条目 → 展示结构）===');
{
  const raw = {
    id: 12345, ct: 1789000000, ut: 1789100000, pv: 88, favors: 3,
    title: '测试 MOD', resource_type: 2,
    content: 'x'.repeat(7000),
    member: { name: '某作者' },
    topic: { id: 999, topic: '幻兽帕鲁', cover: 285973 },
  };
  const s = shape(raw);
  t(s.id === '12345' && typeof s.id === 'string', 'id 字符串化（源站是数字，前端做 dataset 会比较）');
  t(s.kind === 'mod', 'resource_type=2 → kind=mod');
  t(shape(Object.assign({}, raw, { resource_type: 3 })).kind === 'modifier', 'resource_type=3 → kind=modifier');
  t(s.game === '幻兽帕鲁', 'game 取 topic.topic');
  t(s.cover === 'https://img2.52jidi.com/topic/cover/id/285973/sz/src',
    '封面由 topic.cover 数值 id 拼出（条目本身不带封面 URL）', s.cover);
  t(s.author === '某作者', '作者取 member.name');
  t(s.content.length < 7000 && /截断/.test(s.content), '超长正文被截断并标注', String(s.content.length));
  t(s.content.length <= 6000, '截断后总长不超过 6000 字（含截断提示本身）', String(s.content.length));
  t(s.content.length >= 5900, '截断后仍保留近 6000 字（正文里有使用说明，不能砍太狠）', String(s.content.length));
  t(/\/post\/detail\/12345$/.test(s.url), '原帖 URL 指向机地 post/detail', s.url);
  t(shape({ id: 1, resource_type: 3, topic: { cover: null }, member: {} }).cover === '',
    'topic.cover 缺失时封面为空串（不产出 `.../id/null/sz/src`）');
  t(shape({ id: 1, resource_type: 3 }).game === '' && shape({ id: 1, resource_type: 3 }).author === '',
    'topic/member 缺失时不抛错');
}

/* ============ E. 落盘数据 + 查询模块不变量 ============ */
console.log('\n=== E. data/mods.json 与 data/mods.js（真实数据）===');
{
  const fs = require('fs');
  const path = require('path');
  const FILE = path.join(__dirname, '..', 'data', 'mods.json');
  if (!fs.existsSync(FILE)) {
    console.log('  （跳过：data/mods.json 不存在，先跑 node tools/fetch-mods.js）');
  } else {
    const mods = require('../data/mods');
    const d = mods.ensure();
    const items = d.items || [];
    t(items.length > 1000, `条目量级正常（${items.length} 条）`);
    t(items.every((x) => x.id && x.kind && x.title), '每条都有 id / kind / title');
    t(items.every((x) => x.kind === 'mod' || x.kind === 'modifier'), 'kind 只有 mod / modifier 两种');
    t(items.every((x) => Array.isArray(x.links)), 'links 一律是数组（前端不再正则正文）');
    t(items.every((x) => x.links.every((l) => l.url && l.kind)), '每条 link 都有 url 与 kind');
    t(items.every((x) => !x.cover || /^https:\/\//.test(x.cover)), 'cover 要么为空要么是 https 绝对地址');
    t(items.every((x) => !x.libId || x.libUrl), '命中端游库的条目一定带 libUrl（否则详情跳不动）');
    t(items.filter((x) => x.content && x.content.length > 6000).length === 0, '落盘正文都 ≤6000 字');
    const ts = items.map((x) => x.ut || x.ct).filter(Boolean);
    t(ts.every((v) => v > 1e9 && v < 4e9), '时间戳都是 10 位秒级（不是毫秒混入）');
    t(new Set(items.map((x) => x.game)).size > 100, '覆盖游戏数 > 100');

    const st = mods.stats();
    t(st.total === items.length, 'stats.total 与 items 长度一致');
    t(st.matched === items.filter((x) => x.libId).length, 'stats.matched 由实际 libId 统计得出');
    t(st.byKind.mod + st.byKind.modifier === st.total, 'byKind 之和等于总数');
    t(st.matchedRate >= 60, `匹配率不低于 60%（实测 79.1%，修匹配键前的 55% 视为回归）`, st.matchedRate + '%');

    /* 列表不变量 */
    const all = mods.list({ all: '1', limit: 1 });
    const matched = mods.list({ limit: 1 });
    t(matched.total < all.total, '默认只给命中端游库的（all=1 才放开全量）');
    t(matched.items.every((x) => x.libId), '默认列表里每条都有 libId');
    t(mods.list({ limit: 300 }).items.length === 300, 'limit 上限 300 生效');
    t(mods.list({ limit: 999 }).items.length <= 300, 'limit 超过 300 被夹到 300');
    const p1 = mods.list({ limit: 10, offset: 0 }).items.map((x) => x.id);
    const p2 = mods.list({ limit: 10, offset: 10 }).items.map((x) => x.id);
    t(p1.length === 10 && p2.length === 10 && !p1.some((x) => p2.includes(x)), '分页不重叠');
    const newSorted = mods.list({ limit: 60, sort: 'new' }).items.map((x) => x.ut || x.ct || 0);
    t(newSorted.every((v, i) => i === 0 || newSorted[i - 1] >= v), 'sort=new 按源站更新时间严格倒序');
    const hotSorted = mods.list({ limit: 60, sort: 'hot' }).items.map((x) => x.pv || 0);
    t(hotSorted.every((v, i) => i === 0 || hotSorted[i - 1] >= v), 'sort=hot 按浏览量倒序');
    t(mods.list({ kind: 'modifier', limit: 20 }).items.every((x) => x.kind === 'modifier'), 'kind 过滤生效');
    t(mods.list({ q: '幻兽帕鲁', all: '1', limit: 20 }).total > 0, '关键词可命中游戏名');

    /* topGames 不变量 */
    const top = mods.topGames(10);
    t(top.length === 10, 'topGames 返回 10 条');
    t(top.every((g, i) => i === 0 || top[i - 1].total >= g.total), 'topGames 按条目数降序');
    t(top.every((g) => g.total === g.mod + g.modifier), 'topGames 的 total = mod + modifier');
    const byLibSet = new Set(items.filter((x) => x.libId).map((x) => x.libId));
    t(mods.byLib([...byLibSet][0]).length > 0, 'byLib 能按端游库 id 取到条目');
    t(mods.byLib('不存在的 id').length === 0, 'byLib 对未知 id 返回空数组');
    t(mods.byLib([...byLibSet][0], 'mod').every((x) => x.kind === 'mod'), 'byLib 支持按 kind 二次过滤');
  }
}

console.log(`\n结果：${pass} / ${pass + fail} 通过`);
if (bad.length) console.log('未通过：\n  - ' + bad.join('\n  - '));
process.exit(fail ? 1 : 0);
