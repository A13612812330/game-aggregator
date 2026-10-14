/* tools/test-v1075-rank-source.js — 第一层（静态/离线）：验收「首页榜单换源 + 双源加权融合」这一版
 *
 * v10.75 新增。用户原话（2026-10-14）：
 *   「我认为需要优化榜单源，现在是拿 XD 的 https://www.xdgame.com/update/ 中的
 *     `<div class="left update">…`（8 个 tab）和 https://jidiyouxi.com/ 的
 *     本周最热/本月最热/历史最热 TOP12 片段」
 *   + 三档权重拍板：「最近更新 = 仅 XD；其余三档 = 双源合并，**XD 50% + 机地 50%**」
 *
 * 覆盖四块：
 *   A. `data/rank-merge.js` 融合层（纯函数）—— 名次对齐 / RRF 权重 / 工具过滤 / 桥接 / zhKey
 *   B. **封面质量**（本轮实拍撞出来的真问题）—— 128×128 方图放进 2.14:1 展示位 = 「压缩图片」
 *   C. `fetchers/xdupdate.js` 解析层（纯函数）—— 八档取值语义 / 小图升级
 *   D. `server.js` 接线 —— 四档 meta / 旧参数兼容 / 两源并行
 *
 * ★ 为什么 A/C 用**造假数据 + 假文本**而不是打真源站：
 *   源站状态会变、也会抽风。把防线绑在别人家的可用性上，红了也分不清
 *   「我们坏了」还是「人家抽风」。真实源站的结论由一次性实测记录（见 docs/versions/v10.75.md）。
 *
 * ★ 本套件**不打网络**、**不碰端口**，纯读文件 + 跑纯函数，可在任何时刻单跑。
 *
 * 跑法：node tools/test-v1075-rank-source.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const merge = require('../data/rank-merge');
const xdup = require('../fetchers/xdupdate');
const rf = require('../data/rank-fill');

const sv = read('server.js');
const idx = read('public/index.html');

let pass = 0; let fail = 0;
function chk(name, ok, extra) {
  if (ok) { pass++; console.log('  ✅ ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '   ' + extra : '')); }
}
function hr(t) { console.log('\n' + '─'.repeat(74) + '\n' + t + '\n' + '─'.repeat(74)); }

/* 造库：3 条记录覆盖「XD 游戏页 + 机地话题页成对」的形态（实测覆盖率 68.9%） */
const mkGame = (o) => Object.assign({
  id: 'xd-1', title: '样板游戏', url: 'https://www.xdgame.com/game/1.html',
  cover: 'https://shared.cdn.queniuqe.com/store_item_assets/steam/apps/100/header.jpg',
  genres: ['动作'], size: '10GB', score: 8, hot: 100, dateLabel: '2026-10-01',
}, o || {});
/* 造两源行：XD 行形如 xdupdate.parseRows 的产物；机地行形如 jidi.hotRanks 的产物 */
const xd = (gid, rank, name, extra) => Object.assign({
  gid: String(gid), rank, name, url: 'https://www.xdgame.com/game/' + gid + '.html',
  cover: 'https://shared.cdn.queniuqe.com/store_item_assets/steam/apps/' + gid + '/header.jpg',
  coverAlt: '', category: '动作', badge: '', value: '', valueKind: '', dateLabel: '2026-10-01',
}, extra || {});
const jd = (tid, rank, title, extra) => Object.assign({
  id: 'jidi-' + tid, rank, title, url: 'https://jidiyouxi.com/topic/detail/' + tid,
  cover: 'https://img2.52jidi.com/topic/cover/id/' + tid + '/sz/src',
  genres: ['角色扮演'], size: '5GB', score: 9, period: 'weekly',
}, extra || {});

/* ============================================================
   A. 融合层（data/rank-merge.js）
   ============================================================ */
hr('A. data/rank-merge.js —— 名次对齐 / RRF / 工具过滤 / 桥接');

/* ★★ A1 名次相对位置对齐 —— 本版第一版踩坑后加的，必须守住语义：
   两源规模悬殊（XD 100 条 / 机地 12 条），若直接用**绝对名次**算 RRF，
   机地每个条目 rank 天然很小 ⇒ 名义 50/50、实际机地主导（实测 7/11 挤进前 11）。 */
{
  chk('A1 ★★ 名次对齐语义：机地 #1 ≡ XD #1（同分起点）',
    merge.scaleRank(1, 12) === 1 && merge.scaleRank(1, 100) === 1,
    'jidi#1=' + merge.scaleRank(1, 12) + ' xd#1=' + merge.scaleRank(1, 100));
  chk('A2 ★★ 名次对齐语义：机地榜尾 ≡ XD 榜尾（都映射到参考深度 ' + merge.N_REF + '）',
    Math.abs(merge.scaleRank(12, 12) - merge.N_REF) < 1e-9
      && Math.abs(merge.scaleRank(100, 100) - merge.N_REF) < 1e-9,
    'jidi#12=' + merge.scaleRank(12, 12) + ' xd#100=' + merge.scaleRank(100, 100));
  /* ★ 负向：短榜第 2 名**不许**等于长榜第 2 名 —— 否则「对齐」就没发生
     （12 条榜的第 2 名相对位置是 1/11 ⇒ 对齐后 10.0；100 条榜的第 2 名是 1/99 ⇒ 2.0）。
     ⚠️ 判据写成 `> xd#2 * 5` 会**假红**（10 > 10 不成立）—— 边界值本身就是 5 倍，
        所以取 `* 4`（留一档余量），并在附注里打印两个值便于复核。 */
  chk('A3 ★★ 负向：机地 #2 的对齐名次远大于 XD #2（短榜的相对第 2 名更靠中后段）',
    merge.scaleRank(2, 12) > merge.scaleRank(2, 100) * 4,
    'jidi#2=' + merge.scaleRank(2, 12).toFixed(1) + ' xd#2=' + merge.scaleRank(2, 100).toFixed(1)
      + '（参考深度 ' + merge.N_REF + '）');
  chk('A4 ★ 边界：rank=0 / n=0 / n=1 不炸（返回 0 / 0 / 1）',
    merge.scaleRank(0, 12) === 0 && merge.scaleRank(3, 0) === 0 && merge.scaleRank(1, 1) === 1,
    [merge.scaleRank(0, 12), merge.scaleRank(3, 0), merge.scaleRank(1, 1)].join(' / '));
}

/* ★★ A5 权重真的是 50/50 且**权重参数可调**（拍板值写死在常量里，改动要通过参数） */
chk('A5 ★★ 权重常量 = 50 / 50（用户拍板），RRF_K 与 N_REF 有明确取值',
  merge.W_XD === 0.5 && merge.W_JIDI === 0.5 && merge.RRF_K > 0 && merge.N_REF === 100,
  'W_XD=' + merge.W_XD + ' W_JIDI=' + merge.W_JIDI + ' K=' + merge.RRF_K + ' N_REF=' + merge.N_REF);

/* A6 单源同名的融合分：两边都排第 1 ⇒ 分应约为「各占一半」的两倍 */
{
  const lib = [mkGame({ id: 'xd-1', title: '同名游戏', url: 'https://www.xdgame.com/game/1.html' })];
  const one = merge.rrfFuse([xd(1, 1, '同名游戏')], [], lib);
  const both = merge.rrfFuse([xd(1, 1, '同名游戏')], [jd(7001, 1, '同名游戏')], lib);
  /* ⚠️ 容差取 1e-5 而不是 1e-6：`fusion.xd/jidi/score` 三个字段各自 `toFixed(6)` 后取 Number，
     两个分量各自舍入一次、总和再舍入一次 ⇒ 恒等关系在**第 6 位**上可能差 1 个 ulp
     （实测 0.02381×2 = 0.04762 vs score 0.047619，差 1e-6）。写 1e-6 就会**假红**。 */
  chk('A6 ★★ 双源同榜的融合分 ≈ 两源各半之和（不是取最大、也不是取平均）',
    one[0] && both[0] && both[0].dual === true
      && Math.abs(both[0].fusion.score - (both[0].fusion.xd + both[0].fusion.jidi)) <= 1e-5
      && both[0].fusion.score > one[0].fusion.score,
    '单源 ' + (one[0] && one[0].fusion.score) + ' → 双源 ' + (both[0] && both[0].fusion.score)
      + '（= xd ' + (both[0] && both[0].fusion.xd) + ' + jidi ' + (both[0] && both[0].fusion.jidi) + '）');
  chk('A7 ★★ 双源占一个位（不是两条）：同游戏在两源各出现一次 ⇒ 输出仍只有 1 条',
    both.length === 1 && both[0].srcRank.xd === 1 && both[0].srcRank.jidi === 1,
    'n=' + both.length + ' srcRank=' + JSON.stringify(both[0] && both[0].srcRank));
}

/* ★★ A8 桥接：实测唯一可靠的同游戏识别桥是本地库的 jidiUrl（`xd-<gid>` 与 `jidi-<tid>` 成对）。
   机地行**没有** XD 的 gid，只有 topic/detail/<tid> ⇒ 必须借库里的配对并到同一条。 */
{
  const lib = [mkGame({
    id: 'xd-5037', title: '赛博朋克2077', url: 'https://www.xdgame.com/game/5037.html',
    jidiId: 'jidi-556956292', jidiUrl: 'https://jidiyouxi.com/topic/detail/556956292',
    cover: 'https://shared.cdn.queniuqe.com/store_item_assets/steam/apps/1091500/header.jpg',
  })];
  /* ★★ A8 这条**必须让两源的 zhKey 不同**，否则测不到 tid 桥 ——
     实测（v10.75 反证 ④）：第一版两源都叫「赛博朋克2077」，去掉 byTid 索引后**仍然并成一条**，
     因为落到了「中文名兜底桥」。A8 于是对 byTid 完全免疫（打坏了也不红 = 反证照出的假绿）。
     ⇒ 机地侧标题带上「：终极版」（zhKey 剥后缀后剩 `赛博朋克2077：`，与 XD 侧的 `赛博朋克2077` 不等）
        ⇒ 只留 tid 桥这一条路径可走。
     ★ 教训：测「某条路径」时必须**把其它路径堵掉**，否则断言测的是「至少有一条路径通」，
       而不是「这条路径通」。 */
  const out = merge.rrfFuse([xd(5037, 2, '赛博朋克2077')], [jd(556956292, 10, '赛博朋克2077：终极版')], lib);
  chk('A8 ★★ 库内配对桥：机地 tid ↔ XD gid 并成同一条（靠 jidiUrl 里的 topic/detail/<tid>）',
    out.length === 1 && out[0].dual === true && out[0].id === 'xd-5037',
    'n=' + out.length + ' id=' + (out[0] && out[0].id) + ' dual=' + (out[0] && out[0].dual));
  chk('A9 ★★ 库里这条的 Steam 大图被取用（不是机地那 140×140 小方图）',
    out[0] && /store_item_assets\/steam\/apps\/1091500\/header\.jpg/.test(out[0].cover),
    String(out[0] && out[0].cover).slice(0, 70));
  /* ★ 兜底桥：库内没配对时用中文名在**本次两源榜单之间**互相找（不跨全库扫） */
  const out2 = merge.rrfFuse([xd(99, 1, '兜底游戏')], [jd(7002, 1, '兜底游戏')], []);
  chk('A10 ★ 中文名兜底桥：库内无配对时两源仍能并成一条（只在本次榜单内匹配）',
    out2.length === 1 && out2[0].dual === true, 'n=' + out2.length + ' dual=' + (out2[0] && out2[0].dual));
  /* ★ 负向：名字不同 ⇒ **不许**并入（否则会造出「机甲战魔 = 机战」这种误配） */
  const out3 = merge.rrfFuse([xd(98, 1, '机甲战魔')], [jd(7003, 1, '机战')], []);
  chk('A11 ★★ 负向：名字不同不许并入（防跨源误配 —— 这是 cross-source-name-matching 的红线）',
    out3.length === 2, 'n=' + out3.length);
}

/* ★★ A12 工具过滤（单一真源 TOOL_RE）：实测 XD 人气榜第 1 名就是「XDGAME游戏运行库检测工具」。 */
{
  const lib = [];
  const withTool = merge.rrfFuse([
    xd(1, 1, 'XDGAME游戏运行库检测工具206.04.13'),
    xd(2, 2, '正常游戏A'), xd(3, 3, '正常游戏B'),
  ], [], lib);
  chk('A12 ★★ 工具条目被剔（运行库类不进榜），并如实回带 dropped 计数',
    withTool.length === 2 && withTool._dropped === 1
      && !withTool.some((x) => /运行库/.test(x.title)),
    'n=' + withTool.length + ' dropped=' + withTool._dropped);
  /* ★★ 有效行数必须用**过滤后**的：否则被剔那条会让整档名次对齐整体偏移一位 */
  chk('A13 ★★ 名次对齐用**过滤后**的有效行数（nXdEff），不是源站原始条数',
    withTool._srcN.xd === 2 && withTool._srcN.xdRaw === 3,
    'xdEff=' + withTool._srcN.xd + ' xdRaw=' + withTool._srcN.xdRaw);
  chk('A14 ★ 工具判据只有一份实现（从 rank-merge 导出，rank-fill 引用同一份）',
    merge.TOOL_RE instanceof RegExp && rf.TOOL_RE === merge.TOOL_RE);
}

/* ★★ A15 短榜不许整体占优 —— 这是 scaleRank 存在的**唯一理由**，必须有定量断言。
   造 100 条 XD + 12 条机地（各不重名），看机地条目挤进前 11 的有几条。
   第一版（未对齐）实测 7 条；对齐后应 ≤6 条（即「不主导」）。 */
/* ★★ A15 短榜不许整体占优 —— scaleRank 存在的**动机**就在这条。
   ⚠️ 但它**不是**「去掉名次对齐」那一打坏点的判据（那一条守 A2）—— 实测（v10.75 反证 ①）：
     把 scaleRank 改成返回绝对名次后，前 11 名里机地只有 **5** 条（仍然 ≤6），A15 照样绿。
     原因是排序的 tie-break 里 **XD 名次优先**（`srcRank.xd || 1e9`）⇒ 同分时机地总排在 XD 之后，
     于是名次自然交错，短榜并不会真的「整片占优」。
     ⇒ 结论：**A15 守「结果形态」，A2/A3 守「算法语义」**，两者不能互相替代。 */
{
  const xdRows = Array.from({ length: 100 }, (_, i) => xd(1000 + i, i + 1, 'XD游戏' + (i + 1)));
  const jdRows = Array.from({ length: 12 }, (_, i) => jd(9000 + i, i + 1, '机地游戏' + (i + 1)));
  const out = merge.rrfFuse(xdRows, jdRows, []);
  const top11 = out.filter((x) => x.rank <= 11);
  const jidiInTop = top11.filter((x) => x.source === 'jidi').length;
  chk('A15 ★★ 短榜（机地 12 条）不许整体占优：前 11 名里机地 ≤ 6 条（50/50 权重的应有之义）',
    jidiInTop <= 6, '机地 ' + jidiInTop + ' / 11（未做名次对齐时实测 7）');
  chk('A16 ★ 名次连续且无重复：rank = 1..N',
    out.every((x, i) => x.rank === i + 1), 'N=' + out.length);
  chk('A17 ★ 融合分单调不增（排序真的生效）',
    out.every((x, i) => i === 0 || out[i - 1].fusion.score >= x.fusion.score));
}

/* A18 zhKey 归一化 —— v10.75 修了「书名号」，这是同名提优/两源兜底双双失配的根因 */
{
  chk('A18 ★★ zhKey 剥书名号（`《全面战争：幕府将军2》完全版` → `全面战争：幕府将军2`）',
    merge.zhKey('《全面战争：幕府将军2》完全版') === merge.zhKey('全面战争：幕府将军2/Total War:Shogun 2'),
    JSON.stringify(merge.zhKey('《全面战争：幕府将军2》完全版')));
  chk('A19 ★ zhKey 取「/」前主名 + 去括号 + 去版本后缀',
    merge.zhKey('巫师3：狂猎（次世代版）/The Witcher 3') === '巫师3：狂猎'
      && merge.zhKey('极限竞速：地平线5顶级版/Forza Horizon 5') === '极限竞速：地平线5',
    JSON.stringify([merge.zhKey('巫师3：狂猎（次世代版）/The Witcher 3'), merge.zhKey('极限竞速：地平线5顶级版/Forza Horizon 5')]));
  /* ★ 长度护栏按 CJK 区分（来源：cross-source-name-matching 规范）：
     CJK 2 字合法（剑星/鸣潮），纯 ASCII 2 字不合法（PC/AI 会撞车）。 */
  chk('A20 ★★ 长度护栏按 CJK 区分：CJK 2 字保留、纯 ASCII 2 字丢弃',
    merge.zhKey('剑星') === '剑星' && merge.zhKey('鸣潮') === '鸣潮'
      && merge.zhKey('PC') === '' && merge.zhKey('AI') === '',
    JSON.stringify([merge.zhKey('剑星'), merge.zhKey('鸣潮'), merge.zhKey('PC'), merge.zhKey('AI')]));
}

/* ============================================================
   B. 封面质量（v10.75 实拍撞出来的真问题）
   ============================================================ */
hr('B. 封面质量 —— 「放大适配游戏大图而不是压缩游戏图片」');

/* ★★ 背景（实测）：XD 榜条目自带的图是 128×128（站内 allimg）/ 32–244 方图（社区图），
   机地封面是 140×140（且**无大图变体**：/src、/big/src、/lg/src、/xl/src、/ori/src 全 404）。
   展示位是 2.14:1 ⇒ 方图会被 `object-fit:cover` 上下裁掉近一半 + 放大 3 倍。 */
chk('B1 ★★ coverScore 分级：Steam header 4 / Steam 其他 3 / 社区小图 2 / 其他方图 1 / 空 0',
  merge.coverScore('https://shared.cdn.queniuqe.com/store_item_assets/steam/apps/100/header.jpg') === 4
    && merge.coverScore('https://shared.cdn.queniuqe.com/store_item_assets/steam/apps/100/abc.jpg') === 3
    && merge.coverScore('https://shared.cdn.queniuqe.com/community_assets/images/apps/100/x.jpg') === 2
    && merge.coverScore('https://www.xdgame.com/uploads/allimg/210928/1-21092Q315570-L.jpg') === 1
    && merge.coverScore('https://img2.52jidi.com/topic/cover/id/1044189/sz/src') === 1
    && merge.coverScore('') === 0,
  [4, 3, 2, 1, 1, 0].join('/'));

/* ★★ B2 候选优选：库内大图必须胜出（v10.74 的固定优先级「库 > XD > 机地」取不到最优）
   实测场景：库内 `xd-2174` 封面是 XD 128×128、另有同名的 Steam 460×215。 */
{
  const lib = [mkGame({
    id: 'xd-2174', title: '战神3/God of War III', url: 'https://www.xdgame.com/game/2174.html',
    cover: 'https://www.xdgame.com/uploads/allimg/210928/1-21092Q315570-L.jpg',   // 128×128
  })];
  const out = merge.rrfFuse([xd(2174, 1, '战神3/God of War III', {
    cover: 'https://www.xdgame.com/uploads/allimg/210928/1-21092Q315570-L.jpg',
    coverAlt: '',
  })], [], lib);
  chk('B2 ★★ 源站/库内都是方图时如实标记 coverQ=1（不谎报「已是大图」）',
    out[0] && out[0].coverQ === 1, 'coverQ=' + (out[0] && out[0].coverQ));
  chk('B3 ★ coverAlt 保留次优候选（前端 onerror 回退链的燃料）',
    typeof (out[0] && out[0].coverAlt) === 'string');
}

/* ★★ B4 同名提优：原封面是方图时，去同 zhKey 名下找封面更好的那条（护栏三条） */
{
  const lib = [
    mkGame({ id: 'xd-2174', title: '战神3', url: 'https://www.xdgame.com/game/2174.html', cover: 'https://www.xdgame.com/uploads/allimg/x-L.jpg' }),
    mkGame({ id: 'xd-8561', title: '战神3', url: 'https://www.xdgame.com/game/8561.html', cover: 'https://shared.cdn.queniuqe.com/store_item_assets/steam/apps/2516430/h.jpg' }),
  ];
  const out = merge.rrfFuse([xd(2174, 1, '战神3', { cover: 'https://www.xdgame.com/uploads/allimg/x-L.jpg', coverAlt: '' })], [], lib);
  chk('B5 ★★ 同名提优：桥到方图时，去同 zhKey 名下取封面更好的那条（并如实标 coverSub）',
    out[0] && out[0].coverQ >= 3 && out[0].coverSub === true,
    'coverQ=' + (out[0] && out[0].coverQ) + ' sub=' + (out[0] && out[0].coverSub) + ' → ' + String(out[0] && out[0].cover).slice(0, 60));
  /* ★ 护栏：**最优候选**已经是大图时不许触发（否则会把正确的大图换成别人的图）。
     ⚠️ 第一版这条**假红**，根因是**我把测试数据造错了**：库里 `xd-2174` 那条的 cover 写的是
        XD 方图（`-L.jpg`），于是 cands[0] 本来就是方图、提优**应该**触发 —— 是期望错了，
        不是实现错了。判据要盯的是「**分数最高那个候选**」，不是「xd 行传进来的那个」。
        （同一族的坑：断言描述的是意图，数据必须真的构成那个场景 —— 否则红的是测试。） */
  const lib3big = [
    mkGame({ id: 'xd-2174', title: '战神3', url: 'https://www.xdgame.com/game/2174.html', cover: 'https://shared.cdn.queniuqe.com/store_item_assets/steam/apps/2174/header.jpg' }),
    mkGame({ id: 'xd-8561', title: '战神3', url: 'https://www.xdgame.com/game/8561.html', cover: 'https://shared.cdn.queniuqe.com/store_item_assets/steam/apps/2516430/h.jpg' }),
  ];
  const out2 = merge.rrfFuse([xd(2174, 1, '战神3', {
    cover: 'https://shared.cdn.queniuqe.com/store_item_assets/steam/apps/2174/header.jpg', coverAlt: '',
  })], [], lib3big);
  chk('B6 ★★ 护栏：最优候选已是大图（coverQ≥2）⇒ 同名提优**不触发**（不许把对的图换掉）',
    out2[0] && out2[0].coverSub === false && /apps\/2174\//.test(out2[0].cover),
    'sub=' + (out2[0] && out2[0].coverSub) + ' coverQ=' + (out2[0] && out2[0].coverQ));
  /* ★ 护栏：新封面得分必须 ≥3 —— 否则「提优」会把 1 分换成另一个 1 分（白折腾） */
  const lib3 = [
    mkGame({ id: 'xd-2174', title: '方图游戏', url: 'https://www.xdgame.com/game/2174.html', cover: 'https://www.xdgame.com/uploads/allimg/a-L.jpg' }),
    mkGame({ id: 'xd-5000', title: '方图游戏', url: 'https://www.xdgame.com/game/5000.html', cover: 'https://img2.52jidi.com/topic/cover/id/1/sz/src' }),
  ];
  const out3 = merge.rrfFuse([xd(2174, 1, '方图游戏', { cover: 'https://www.xdgame.com/uploads/allimg/a-L.jpg', coverAlt: '' })], [], lib3);
  chk('B7 ★ 护栏：同名里也没大图（全 ≤2 分）⇒ 不提优，如实保持 coverQ=1',
    out3[0] && out3[0].coverSub === false && out3[0].coverQ === 1,
    'coverQ=' + (out3[0] && out3[0].coverQ) + ' sub=' + (out3[0] && out3[0].coverSub));
}

/* ★ B8 统计口径：`_coverBigN` 必须在**融合候选池**上算，且补位条目也要带 coverQ */
{
  const out = merge.rrfFuse([xd(1, 1, 'A'), xd(2, 2, 'B')], [], []);
  chk('B8 ★★ 融合层回带封面统计（coverBigN / coverSubN / coverBigRate 三个数都在）',
    typeof out._coverBigN === 'number' && typeof out._coverSubN === 'number'
      && typeof out._coverBigRate === 'number',
    'bigN=' + out._coverBigN + ' subN=' + out._coverSubN + ' rate=' + out._coverBigRate);
}

/* ============================================================
   C. 解析层（fetchers/xdupdate.js 纯函数）
   ============================================================ */
hr('C. fetchers/xdupdate.js —— 八档取值语义 / 小图升级');

/* ★★ C1 各 panel 的数值语义**不同**（实测）：hot/month/quarter/year → 热度；good → 赞；
   rank → 分；size → 容量；recent → **日期**（不是数值！）。
   写成「一律当热度」会把「554 GB」和「2026-10-14」都当成热度值。 */
chk('C1 ★★ readValue 区分五类语义：日期 / 热度 / 赞 / 分 / 容量',
  xdup.readValue('2026-10-14').valueKind === 'date'
    && xdup.readValue('381,875 热度').valueKind === 'hot'
    && xdup.readValue('2,141 赞').valueKind === 'like'
    && xdup.readValue('10 分').valueKind === 'score'
    && xdup.readValue('554 GB').valueKind === 'size',
  ['2026-10-14', '381,875 热度', '2,141 赞', '10 分', '554 GB']
    .map((s) => s + '→' + xdup.readValue(s).valueKind).join(' | '));
chk('C2 ★ 容量单位覆盖 GB/MB/TB/KB（不区分大小写）',
  ['GB', 'MB', 'TB', 'KB', 'gb'].every((u) => xdup.readValue('12 ' + u).valueKind === 'size'));
chk('C3 ★ 空值不炸（value/valueKind 都空串）',
  xdup.readValue('').value === '' && xdup.readValue(null).valueKind === '');
/* ★ 负向：日期**不许**被认成数值 —— recent 档的价值全在这个区分上 */
chk('C4 ★★ 负向：`2026-10-14` 不许被认成 hot/like/score/size（recent 档靠它显示日期）',
  !['hot', 'like', 'score', 'size'].includes(xdup.readValue('2026-10-14').valueKind),
  xdup.readValue('2026-10-14').valueKind);

/* C5 小图升级通道 */
{
  const small = 'https://shared.cdn.queniuqe.com/community_assets/images/apps/2685620/abc.jpg';
  const up = xdup.upgradeCover(small);
  chk('C5 ★★ 社区小图（32–244 方图）被升级为 Steam header，**原图保留在 coverAlt**（前端回退燃料）',
    /store_item_assets\/steam\/apps\/2685620\/header\.jpg/.test(up.cover) && up.coverAlt === small,
    up.cover.slice(0, 74));
  const big = 'https://shared.cdn.queniuqe.com/store_item_assets/steam/apps/1/header.jpg';
  chk('C6 ★ 非社区小图 ⇒ 原样返回、不留 coverAlt（不盲目改）',
    xdup.upgradeCover(big).cover === big && xdup.upgradeCover(big).coverAlt === '');
  chk('C7 ★ 空值不炸', xdup.upgradeCover('').cover === '' && xdup.upgradeCover(null).cover === '');
}
/* C8 八档齐全 —— server 侧 alias 依赖这些键名 */
chk('C8 ★★ PANELS 覆盖 8 档（recent/hot/month/quarter/year/good/rank/size）',
  xdup.PANELS.length === 8 && ['recent', 'hot', 'month', 'quarter', 'year', 'good', 'rank', 'size']
    .every((k) => xdup.PANELS.includes(k)), xdup.PANELS.join(','));
chk('C9 ★ 抓取页是 /update/（实测每档 SSR 100 条、无 AJAX）',
  /\/update\/$/.test(xdup.PAGE), xdup.PAGE);

/* ============================================================
   D. 服务端接线
   ============================================================ */
hr('D. server.js —— 四档 meta / 旧参数兼容 / 两源并行');

/* ★★ D1 四档标签与数据源（用户拍板：最近更新=仅 XD；其余三档=双源合并） */
{
  const metaSeg = (sv.match(/const RANK_META = \{[\s\S]*?\n\};/) || [''])[0];
  chk('D1 ★★ 四档齐全：recent 最近更新 / hot 人气排名 / month 月度排名 / year 年度排名',
    /recent:\s*\{\s*label:\s*'最近更新'/.test(metaSeg) && /hot:\s*\{\s*label:\s*'人气排名'/.test(metaSeg)
      && /month:\s*\{\s*label:\s*'月度排名'/.test(metaSeg) && /year:\s*\{\s*label:\s*'年度排名'/.test(metaSeg),
    metaSeg.replace(/\s+/g, ' ').slice(0, 150));
  chk('D2 ★★ 最近更新档 src=xdgamer（**仅 XD**，机地没有「最近更新」这种榜，不硬凑）',
    /recent:\s*\{[^}]*src:\s*'xdgamer'/.test(metaSeg));
  chk('D3 ★★ 其余三档 src=both（双源加权合并，用户拍板）',
    /hot:\s*\{[^}]*src:\s*'both'/.test(metaSeg) && /month:\s*\{[^}]*src:\s*'both'/.test(metaSeg)
      && /year:\s*\{[^}]*src:\s*'both'/.test(metaSeg));
  /* ★ 机地档位映射：recent 必须是 null（不抓机地） */
  chk('D4 ★★ 机地档位映射：recent = null（不抓机地），hot/month/year → weekly/monthly/annual',
    /RANK_JIDI_KEY\s*=\s*\{\s*recent:\s*null,\s*hot:\s*'weekly',\s*month:\s*'monthly',\s*year:\s*'annual'\s*\}/.test(sv),
    (sv.match(/const RANK_JIDI_KEY = \{[^}]*\}/) || [''])[0]);
  /* ★ 旧参数兼容：v10.74 及以前是 week/month/year/community，外部链接与旧前端都可能带 */
  chk('D5 ★★ 旧档位参数有别名映射（week/community → hot 等），非法值落 recent 而不是 400',
    /const RANK_ALIAS = \{/.test(sv) && /RANK_ALIAS\[raw\]\s*\|\|\s*'recent'/.test(sv),
    (sv.match(/const RANK_ALIAS = \{[^}]*\}/) || [''])[0].slice(0, 120));
}

/* ★★ D6 两源**并行**抓 + allSettled（任一侧挂掉不拖垮整档：XD 挂了还有机地，反之亦然） */
{
  const i = sv.indexOf("app.get('/api/rank'");
  const j = sv.indexOf('\napp.', i + 10);
  const seg = i < 0 ? '' : sv.slice(i, j < 0 ? sv.length : j);
  chk('D6 ★★ 两源并行抓取用 Promise.allSettled（不是串行 await，也不许用 all 一挂全挂）',
    /Promise\.allSettled\(\s*\[/.test(seg) && !/Promise\.all\(/.test(seg),
    'seg ' + seg.length + ' 字符');
  chk('D7 ★★ 统一走**同一个融合入口**（jidiRows 为空时自然退化成仅 XD，不另写一条渲染路径）',
    /rankMerge\.rrfFuse\(xdRows,\s*jidiRows,\s*dbAll\)/.test(seg)
      && !/xdrank\.mergeRankRows/.test(seg),
    '旧源 mergeRankRows 已不在 /api/rank 里 = ' + !/xdrank\.mergeRankRows/.test(seg));
  chk('D8 ★★ 两源都为空时**抛错**（不让前端拿到空榜当「正常」）',
    /if\s*\(!f\.list\.length\)\s*\{[\s\S]*?throw new Error/.test(seg));
  chk('D9 ★ 新源抓取模块已接入（require xdupdate）',
    /const xdupdate = require\('\.\/fetchers\/xdupdate'\)/.test(sv));
}

/* D10 前端：四档 pill 与档位常量 */
chk('D10 ★★ 前端四档 pill 与后端四档一一对应（data-p = recent/hot/month/year）',
  ['recent', 'hot', 'month', 'year'].every((p) => new RegExp('data-p="' + p + '"').test(idx)),
  (idx.match(/data-p="[a-z]+"/g) || []).join(' '));
chk('D11 ★ 前端默认档是 recent（最近更新），不是旧默认 week',
  /rankPeriod\s*=\s*'recent'/.test(idx) && !/rankPeriod\s*=\s*'week'/.test(idx));
/* ★ D12 轮播不再显示热度，改显示两源名次（可追溯的事实，而不是编出来的综合热度） */
{
  const i = idx.indexOf('function rkSlideHtml(');
  const j = idx.indexOf('\nfunction ', i + 1);
  const seg = i < 0 ? '' : idx.slice(i, j < 0 ? idx.length : j);
  chk('D12 ★★ 轮播展示**两源名次**（srcRank），不展示任何「热度」数字',
    /srcRank/.test(seg) && !/🔥/.test(seg) && !/热度/.test(seg), 'seg ' + seg.length + ' 字符');
}

/* ============================================================
   验收汇总
   ============================================================ */
/* ⚠️ 收尾汇总行的格式是**约定**：必须写成 `通过 n / m（失败 f）`。
   ★ 本项目有两种收尾格式并存（`── 名字：n / m 通过 ──` 与 `通过 n / m（失败 f）`），
     run-all 的 `\d+\s*\/\s*\d+` 两种都能匹配 —— 但**反证套件只认后者**
     （它的 `SUM_ALL_GREEN` 逐字匹配「失败 0」）。v10.71 就因为改了格式而让 v1071 的反证
     整步静默失效。⇒ 凡是要配反证的套件，一律用后者。 */
console.log('\n\u2500\u2500 榜单换源与双源融合（离线层）\u2500\u2500');
console.log('通过 ' + pass + ' / ' + (pass + fail) + '（失败 ' + fail + '）');
process.exit(fail ? 1 : 0);
