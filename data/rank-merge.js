/**
 * data/rank-merge.js — **双源榜单融合**（纯函数，便于离线回归）
 *
 * 背景（用户拍板 v10.75）：首页榜单不再只用 XD，而是「XD + 机地」双源合并并给权重。
 *   实测两源规模悬殊：XD `/update/` 每档 **100 条**，机地热榜每档**只有 12 条**（源站本身条数）。
 *   ⇒ 不能用「按条数归一化」（`(N-rank+1)/N`）：机地池子只有 12，归一化后第 12 名仍有 0.083，
 *     而 XD 第 100 名只有 0.01 ⇒ 机地 12 条会**整片压过 XD 前 45 名**，与权重无关了。
 *   ✅ 正解是 **RRF（Reciprocal Rank Fusion，倒数排名融合）**：只用名次、不用池子大小，
 *     `s_src = w_src / (K + rank_src)`，两源相加。这也是跨源榜单融合的通行做法。
 *
 * ★ 唯一可靠的同游戏识别桥 = **本地库**（实测）：
 *   本地库 19531 条记录形如
 *     { id:'xd-5037', url:'…/game/5037.html', jidiId:'jidi-556956292', jidiUrl:'…/topic/detail/556956292' }
 *   即 `xd-<gid>` 与 `jidi-<tid>` 在库内**是成对的**（覆盖率 68.9%）。
 *   ⇒ 两源条目各自先映射到「本地库那条记录的 id」当作**融合键**，同游戏自然落到同一个键上。
 *   桥命中率实测：XD 人气榜 100 条中 53 条带 jidiUrl。
 *
 * ★ 桥的兜底 = 中文主名（`zhKey`）：库内没配对时，用中文名在**本次两源榜单之间**互相找。
 *   ⚠️ 只在「本次榜单」内匹配，不跨全库扫 —— 全库按名匹配的误配风险由
 *      `cross-source-name-matching` 那套规范负责，不在这里重复实现。
 *
 * 输出条目结构与前端 `rankCard` / `rkSlideHtml` 对齐，另外多了：
 *   · `srcRank: { xd, jidi }` —— 两源各自的名次（0 = 该源未上榜），前端据此展示「XD #2 · 机地 #7」
 *   · `dual: true` —— 两源都上榜（可加「双源」徽标）
 *   · `fusion: { xd, jidi, score }` —— 融合分与两源贡献，便于排障
 *
 * ⚠️ 本模块**不产出「融合热度」这种数字**：两源数值口径不同（XD 给「575,280 热度」，
 *   机地给 9.6 分），硬相加等于编数据。要展示就展示**两个名次**，那是可追溯的事实。
 */

const RRF_K = 20;      // 倒数排名融合常数（越小头部越陡；取 20 与「首页展示 11 个」同量级）
const W_XD = 0.5;      // XD 权重（用户拍板 50/50）
const W_JIDI = 0.5;    // 机地权重
const N_REF = 100;     // 名次对齐的参考深度（见 scaleRank）

/**
 * 非游戏条目判据（**单一真源**）。
 * XD 全站/人气榜第 1 名实测就是 `XDGAME游戏运行库检测工具206.04.13` —— 它是本站工具，不是游戏，
 * 混在榜首会让整张榜的名次都错位一位。
 * ★ 原先这份判据在**两处各自实现**（`fetchers/xdrank.cleanPlate` 里硬编码一份、
 *   `data/rank-fill.js` 里 `TOOL_RE` 一份）—— 典型的「同段逻辑两处实现」（PITFALLS 被记过）。
 *   换源时合并到这里一处，其他模块从这里取。
 */
const TOOL_RE = /(运行库|检测工具)/;

/**
 * ★★ 封面质量分（v10.75 新增）—— **只为「同一游戏的几张候选图里挑最像 460×215 横版的那张」**。
 * 它不是审美评价，是一条**可离线计算的尺寸先验**，依据是本轮实测：
 *   · `store_item_assets/steam/apps/<id>/header.jpg`  ⇒ **460×215**（实测 11/11 命中 2.14:1）
 *   · `store_item_assets/steam/apps/<id>/<hash>.jpg`  ⇒ **460×215**（Steam 统一头图尺寸）
 *   · `xdgame.com/uploads/allimg/*-L.jpg`             ⇒ **128×128**（方图）
 *   · `img2.52jidi.com/topic/cover/…/sz/src`          ⇒ **140×140**（方图，无大图变体：`/src`、`/big/src`、
 *                                                        `/lg/src`、`/xl/src`、`/ori/src` 实测全 404）
 * 为什么必须挑：展示位是 2.14:1。128×128 放进 2.14:1 的容器里 `object-fit:cover` 会**上下裁掉近一半
 * 再横向放大 3 倍** —— 用户说的「压缩游戏图片」就是这个现象，不是图片本身差。
 *
 * ⚠️ 这是**先验**不是**实测**：得分 4 只代表「按 URL 形状判断大概率是 460×215」，
 *   不代表该地址现在返回 200。`apps/5024270/header.jpg`（末日包租公）实测 404 ——
 *   那种情况交给前端的 `onerror` 回退链（`coverAlt` 就是为此保留的次优候选）。
 */
function coverScore(u) {
  const s = String(u || '');
  if (!s) return 0;
  if (/store_item_assets\/steam\/apps\/[^/]+\//i.test(s)) return /\/header/i.test(s) ? 4 : 3;
  if (/community_assets\/images\/apps\//i.test(s)) return 2;
  return 1;   // XD allimg / 机地 cover：实测都是方图
}

/**
 * ★★ 名次**相对位置对齐**（这是第一版踩坑后加的，务必看）
 *
 * 第一版直接用源站原始名次算 RRF，结果**机地 12 条里有 7 条挤进前 11**、XD 前 5 名只剩 3 个
 * —— 名义上 50/50，实际机地主导。根因：RRF 的 `w/(K+rank)` 里 rank 是**绝对名次**，
 * 而机地榜单**总共只有 12 个位置**（源站限定）、XD 有 100 个 ⇒ 机地每个条目的 rank 都天然很小。
 * 名次小 ≠ 更热，只是**那个榜更短**。
 *
 * 修正：先把各源名次归一化成 0..1 的**相对位置**，再映射到统一的参考深度 N_REF：
 *   norm   = (rank - 1) / (N_src - 1)        // 0 = 榜首，1 = 榜尾
 *   scaled = 1 + norm * (N_REF - 1)          // 1..N_REF
 * 语义：**「在本源垫底」与「在本源榜首」的距离，两源等价**。
 *   ⇒ 机地第 1 名 ≡ XD 第 1 名（同分）；机地第 12 名 ≡ XD 第 100 名。
 * 注意不要退回「按条数归一化后直接当分数」（`(N-rank+1)/N`）—— 那是另一个东西，
 * 会让小池子的名次含义被放大，与这里「先对齐再 RRF」不是一回事。
 */
function scaleRank(rank, n) {
  const r = Number(rank) || 0;
  const N = Number(n) || 0;
  if (!r || !N) return 0;
  if (N <= 1) return 1;
  const norm = (r - 1) / (N - 1);
  return 1 + Math.max(0, Math.min(1, norm)) * (N_REF - 1);
}

/** 中文主名归一化键（融合内用）：取「/」前那段、去书名号、去括号内容、去常见版本后缀 */
function zhKey(t) {
  let s = String(t || '').trim();
  s = s.split('/')[0].trim();
  /* ★★ v10.75 修：**书名号必须先去掉**。机地与 XD 都爱给游戏名加《》，
     实测「《全面战争：幕府将军2》完全版」（机地榜）与「全面战争：幕府将军2/Total War:Shogun 2」（库内）
     因为一对书名号分属两个键 ⇒ 同名提优/两源兜底**双双失配**，白白丢掉一张 460×215 大图。
     ⚠️ 剥书名号要在「去括号」之前：`《…》` 与 `（…）` 在字符串里位置不一定谁先。 */
  s = s.replace(/[《》]/g, '').trim();
  s = s.replace(/[（(【[].*?[)）】\]]/g, '').trim();
  s = s.replace(/\s*(?:虚拟机版|增强版|重制版|完全版|顶级版|豪华版|决定版|终极版|传承版|数字豪华版|导演剪辑版|番外篇)\s*$/g, '').trim();
  /* ★ CJK 名允许 2 字（「剑星」「鸣潮」）；纯 ASCII 名要求 ≥3 字，避免 "PC"/"AI" 这类撞车。
     口径来源：cross-source-name-matching 规范（长度护栏须按 CJK 区分）。 */
  if (/[\u4e00-\u9fa5]/.test(s)) return s.length >= 2 ? s.toLowerCase() : '';
  return s.length >= 3 ? s.toLowerCase() : '';
}

/** 从 URL 抠机地话题 tid */
function tidOf(u) {
  return (String(u || '').match(/topic\/detail\/(\d+)/) || [])[1] || '';
}

/** 本地库索引（每次调用重建；19531 条实测 ~10ms 级，且 /api/rank 有 30 分钟缓存兜着） */
function buildIndex(dbAll) {
  const byId = new Map();
  const byUrl = new Map();
  const byTid = new Map();
  /* ★★ byZh（v10.75）：zhKey → **该名下 cover 得分最高**的那条记录。
     「同游戏在库内有多条、封面质量差一个数量级」是本轮实测出来的：
     「战神3」库内两条 —— `xd-2174` 的封面是 XD 128×128 方图、`xd-8561` 的是 Steam 460×215。
     按 id 桥接只会拿到它自己那条，救不了；这里给出「同名里封面最好的那张」。 */
  const byZh = new Map();
  for (const g of dbAll || []) {
    if (!g) continue;
    if (g.id && !byId.has(g.id)) byId.set(g.id, g);
    if (g.url && !byUrl.has(g.url)) byUrl.set(g.url, g);
    const t = tidOf(g.jidiUrl) || (String(g.jidiId || '').match(/jidi-(\d+)/) || [])[1];
    if (t && !byTid.has(t)) byTid.set(t, g);
    const z = zhKey(g.title);
    if (z) {
      const cur = byZh.get(z);
      if (!cur || coverScore(g.cover) > coverScore(cur.cover)) byZh.set(z, g);
    }
  }
  return { byId, byUrl, byTid, byZh };
}

/**
 * 融合两源榜单。
 * @param {Array} xdRows   XD `/update/` 某档的行（fetchers/xdupdate.parseRows 的产物）
 * @param {Array} jidiRows 机地 `hotRanks()` 某档的条目（含 id/url/title/cover/rank/size/score/genres）
 * @param {Array} dbAll    本地库全量（gamesDb.all()）
 * @param {{k?:number,wXd?:number,wJidi?:number}} [opts]
 * @returns {Array} 融合后按分数降序的列表，`rank` 已重排为 1..N
 */
function rrfFuse(xdRows, jidiRows, dbAll, opts = {}) {
  const K = Number(opts.k) > 0 ? Number(opts.k) : RRF_K;
  const wXd = Number.isFinite(opts.wXd) ? opts.wXd : W_XD;
  const wJidi = Number.isFinite(opts.wJidi) ? opts.wJidi : W_JIDI;
  const { byId, byUrl, byTid, byZh } = buildIndex(dbAll);

  /** 融合键 → { xd?, jidi?, key, rec? } */
  const bucket = new Map();
  /** XD 中文名 → 融合键（仅本次榜单内，供兜底） */
  const xdZh = new Map();

  /* ---- ① 装入 XD 行（先剔掉「运行库/检测工具」这类非游戏条目并如实计数） ---- */
  let dropped = 0;
  let nXdEff = 0;
  for (const r of xdRows || []) {
    if (!r || !r.gid) continue;
    if (TOOL_RE.test(r.name || '')) { dropped++; continue; }
    nXdEff++;
    const rec = byId.get('xd-' + r.gid) || byUrl.get(r.url) || null;
    const key = (rec && rec.id) || 'xd-' + r.gid;
    const cur = bucket.get(key) || { key, rec };
    cur.xd = { ...r, rank: Number(r.rank) || 0 };
    if (!cur.rec && rec) cur.rec = rec;
    bucket.set(key, cur);
    const z = zhKey(r.name);
    if (z && !xdZh.has(z)) xdZh.set(z, key);
  }

  /* ---- ② 装入机地行（先按库桥接；库没配对时用中文名在本次 XD 榜内兜底） ---- */
  for (const r of jidiRows || []) {
    if (!r || !r.title) continue;
    const tid = tidOf(r.url);
    const rec = tid ? byTid.get(tid) : null;
    let key = (rec && rec.id) || (tid ? 'jidi-' + tid : '') || String(r.id || '');
    if (!key) continue;
    /* 未被库桥接（key 仍是 jidi-*）⇒ 尝试中文名兜底，命中则**并入那条 XD 条目** */
    if (!rec) {
      const z = zhKey(r.title);
      const hit = z ? xdZh.get(z) : null;
      if (hit) key = hit;
    }
    const cur = bucket.get(key) || { key, rec };
    /* ★ 同一个键已被 XD 行占过且带 rec，则不动 rec（XD 那条的库记录更可能是 xd-* 主记录） */
    if (!cur.rec && rec) cur.rec = rec;
    cur.jidi = { ...r, rank: Number(r.rank) || 0 };
    bucket.set(key, cur);
  }

  /* ---- ③ 打分（名次先做相对位置对齐，见 scaleRank；否则短榜会整体占优） ----
     ★ nXd 必须用**过滤后**的有效行数：若拿原始 100 算，被剔掉的那条会让整档名次对齐整体偏移。 */
  const nXd = nXdEff;
  const nJidi = (jidiRows || []).length;
  const out = [];
  for (const b of bucket.values()) {
    const rXd = b.xd ? b.xd.rank : 0;
    const rJ = b.jidi ? b.jidi.rank : 0;
    const kXd = scaleRank(rXd, nXd);
    const kJ = scaleRank(rJ, nJidi);
    const sXd = kXd ? wXd / (K + kXd) : 0;
    const sJidi = kJ ? wJidi / (K + kJ) : 0;
    const rec = b.rec || null;
    const title = (rec && rec.title) || (b.xd && b.xd.name) || (b.jidi && b.jidi.title) || '';
    /* ---- 封面优选（v10.75）----
       ★ 为什么不是简单的 `(rec && rec.cover) || xd.cover || jidi.cover`（v10.74 的写法）：
         同一游戏常有 2–4 张候选，且**质量差一个数量级**。实测「战神3」：库内 `xd-2174` 给的是
         XD 的 128×128 方图，而 `xd-8561` 给的是 Steam 460×215 —— 旧写法按「库 > XD > 机地」
         的**固定优先级**取，取的正好是小的那张。固定优先级无法表达「哪张更像 2.14:1」。
       ⇒ 改成「按 coverScore 取最优」，落选的次优留给前端 `onerror` 回退（实测 header.jpg 会 404）。
       ★ `Array#sort` 在 V8 是稳定的 ⇒ 同分时保持插入序（库 > XD > XD原图 > 机地），
         这就是「同等质量下仍优先本地库」的保证，不是巧合。 */
    const cands = [];
    const addCand = (u) => { const s = String(u || ''); if (s && !cands.includes(s)) cands.push(s); };
    addCand(rec && rec.cover);
    addCand(b.xd && b.xd.cover);
    addCand(b.xd && b.xd.coverAlt);
    addCand(b.jidi && b.jidi.cover);
    /* ★★ 同名提优（护栏见下）：桥到的库记录封面是方图时，去同 zhKey 名下找封面更好的那条。
       护栏三条：① 只在原封面得分 ≤1（方图）时触发；② 必须 zhKey **完全相等**（不是模糊匹配，
       `zhKey` 本身已带 CJK 长度护栏并剥掉版本后缀）；③ 新封面得分须 ≥3 才替换。
       为什么允许跨记录取图：同名的多条多为**同一游戏的不同发行版**（完全版/重制版/模拟器整合），
       头图通常是同一张。但仍如实计数（`_coverSub`）以便下轮核查。 */
    let coverSub = false;
    if (coverScore(cands[0]) <= 1) {
      const alt = byZh.get(zhKey(title));
      if (alt && alt.cover && coverScore(alt.cover) >= 3 && coverScore(alt.cover) > coverScore(cands[0])) {
        cands.push(alt.cover); coverSub = true;
      }
    }
    cands.sort((x, y) => coverScore(y) - coverScore(x));
    const cover = cands[0] || null;
    const coverAlt = cands[1] || '';
    const genres = (rec && Array.isArray(rec.genres) && rec.genres.length ? rec.genres : null)
      || (b.jidi && Array.isArray(b.jidi.genres) ? b.jidi.genres : [])
      || [];
    const size = (rec && rec.size) || (b.jidi && b.jidi.size) || (b.xd && b.xd.valueKind === 'size' ? b.xd.value : '') || '';
    const score = (rec && rec.score != null ? rec.score : null) != null
      ? rec.score : ((b.jidi && b.jidi.score != null) ? b.jidi.score : null);
    out.push({
      id: (rec && rec.id) || b.key,
      source: b.xd && b.jidi ? 'both' : (b.xd ? 'xdgamer' : 'jidi'),
      title,
      cover,
      coverAlt,
      /* 排障/防线用：0–4（见 coverScore）。4/3 = 大概率 460×215；≤1 = 方图（会被裁+放大）。
         ⚠️ 这是**先验分**，不是「实测已加载」——真实性由前端 onerror 链与 v10.75 实拍套件兜。 */
      coverQ: coverScore(cover),
      coverSub,
      genres: genres.filter(Boolean),
      size: size || null,
      score: score == null ? null : score,
      dateLabel: (rec && rec.dateLabel) || (b.xd && b.xd.dateLabel) || (b.jidi && b.jidi.dateLabel) || '',
      url: (rec && rec.url) || (b.xd && b.xd.url) || (b.jidi && b.jidi.url) || '',
      jidiUrl: (rec && rec.jidiUrl) || (b.jidi && b.jidi.url) || '',
      rank: 0,
      srcRank: { xd: rXd, jidi: rJ },
      dual: !!(b.xd && b.jidi),
      fusion: {
        xd: Number(sXd.toFixed(6)),
        jidi: Number(sJidi.toFixed(6)),
        score: Number((sXd + sJidi).toFixed(6)),
        scaled: { xd: Number(kXd.toFixed(2)), jidi: Number(kJ.toFixed(2)) },
      },
      /* 便于前端在「最近更新」档显示日期 / 在数值档显示原始文本 */
      xdValue: (b.xd && b.xd.value) || '',
      xdValueKind: (b.xd && b.xd.valueKind) || '',
      jidiPeriod: (b.jidi && b.jidi.period) || '',
      category: (b.xd && b.xd.category) || '',
      badge: (b.xd && b.xd.badge) || '',
      /* 两源都没提供分类时，用 XD 的分类标签兜底 */
      filled: false,
    });
    if (!out[out.length - 1].genres.length && b.xd && b.xd.category) out[out.length - 1].genres = [b.xd.category];
  }

  /* ---- ④ 排序：融合分降序 → 两源都在的优先 → XD 名次 → 机地名次 → 标题（稳定收尾） ---- */
  out.sort((a, b) => {
    if (b.fusion.score !== a.fusion.score) return b.fusion.score - a.fusion.score;
    if (a.dual !== b.dual) return a.dual ? -1 : 1;
    const ax = a.srcRank.xd || 1e9; const bx = b.srcRank.xd || 1e9;
    if (ax !== bx) return ax - bx;
    const aj = a.srcRank.jidi || 1e9; const bj = b.srcRank.jidi || 1e9;
    if (aj !== bj) return aj - bj;
    return String(a.title).localeCompare(String(b.title));
  });
  out.forEach((it, i) => { it.rank = i + 1; });
  /* 元信息挂在数组上（与 `fetchRank`/`rawHot` 的 `_dropped` 惯例一致）：
     服务端据此下发 meta，前端如实说明「已滤除 N 条工具条目」「两源各多少条」。 */
  out._dropped = dropped;
  out._srcN = { xd: nXdEff, jidi: nJidi, xdRaw: (xdRows || []).length };
  out._dualN = out.filter((x) => x.dual).length;
  /* ★ 封面质量如实计数（v10.75）—— 这两个数存在的意义是「**让短板可见**」：
     `coverBigN` = 先验大概率 460×215 的条数；`coverSubN` = 靠「同名提优」救回来的条数。
     若下轮 coverBigRate 掉下来，说明源站换图了，必须重跑 fetchers 而不是改阈值。 */
  out._coverBigN = out.filter((x) => x.coverQ >= 3).length;
  out._coverSubN = out.filter((x) => x.coverSub).length;
  out._coverBigRate = out.length ? Number((out._coverBigN / out.length).toFixed(4)) : 0;
  return out;
}

module.exports = {
  rrfFuse, zhKey, tidOf, buildIndex, scaleRank, coverScore,
  RRF_K, W_XD, W_JIDI, N_REF, TOOL_RE,
};
