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
const { normKey, keyUsable, buildLibIndex, matchLib } = require('../data/mod-match');
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
