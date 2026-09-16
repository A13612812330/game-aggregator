/**
 * data/related.js — 「同分类更多」的多因子相似度打分（详情抽屉底部推荐位）
 *
 * ★ 为什么不能用「同 genres[0] 就推荐」：
 *   games.json 里**每款游戏只有一个类型标签**（15,302 条里 15,237 条是 1 个），
 *   而「动作冒险」一个标签就占了 5,627 条（36.8%）—— 按它推荐等于随机抽卡。
 *   更糟的是标签里混着**运营标签**：`联机整合`(801) / `免费专区`(673) / `模拟器整合`(38)，
 *   它们描述的是「怎么玩 / 收不收费」，不是「玩什么」，参与推荐会把风马牛不相及的游戏凑到一起。
 *   （用户反馈「同分类更多里的游戏不太适配，可能是标签的原因」就是这个。）
 *
 * 于是改为多因子打分，四个信号各司其职：
 *   ① 类型交集   —— 用 IDF 加权：`恐怖惊悚` 比 `动作冒险` 稀有得多，命中它可信度更高
 *   ② 系列名     —— 标题剥掉副标题/版本词后取同一前缀（`生化危机4` ↔ `生化危机8`）
 *   ③ 评分接近度 —— |Δ评分| 越小越像同一档次的游戏
 *   ④ 容量接近度 —— 用 log2 比值，避免 100GB 与 1GB 被算成「差不多」
 *   最后叠一点新鲜度与小抖动（抖动幅度 < 任一因子的最小间隔，只打散同分，不改排序语义）。
 *
 * 全离线、纯内存，15k 全量跑一遍约几毫秒。
 */
const gamesDb = require('./gamesDb');
const { sizeGb } = gamesDb;

/** 运营标签：描述「怎么玩/收不收费」，不是游戏类型 —— 一律不参与相似度 */
const OP_TAGS = new Set(['免费专区', '联机整合', '模拟器整合', '工具', '其他']);

/** 版本 / 后缀噪声词，剥掉后才能比较「系列」 */
const EDITION_RE = /\s*(重制版|重置版|复刻版|高清版|增强版|经典版|决定版|终极版|豪华版|年度版|完整版|中文版|特别版|终极版|remaster(?:ed)?|definitive|deluxe|ultimate|goty|complete|enhanced|classic|edition)\s*$/gi;
const STOP_SERIES = new Set(['游戏', '中文', '免费', '破解', '整合', '模拟', 'the', 'game']);

/** 取标题里最像「主名」的那一段（多语言斜杠串取含中文的，否则取首段） */
function mainSeg(title) {
  const segs = String(title || '').split('/').map((s) => s.trim()).filter(Boolean);
  if (!segs.length) return '';
  const cjk = segs.find((s) => /[\u4e00-\u9fff]/.test(s));
  return cjk || segs[0];
}

/**
 * 系列名：`刺客信条：奥德赛` → `刺客信条`；`生化危机4 重制版` → `生化危机`；`cyberpunk 2077` → `cyberpunk`。
 * 中文取前 2–4 字、英文取首个单词，两者都要求「在库里出现过 ≥2 次」才认作系列（见 buildSeriesIndex）。
 */
function seriesKey(title) {
  let base = mainSeg(title).toLowerCase();
  base = base.replace(/\s*[-–—|｜~～].*$/, '');
  base = base.replace(EDITION_RE, '');
  base = base.split(/[：:]/)[0].trim();
  base = base.replace(/[\s]+/g, ' ').trim();
  if (!base) return '';
  const mCjk = /^([\u4e00-\u9fff]{2,4})/.exec(base);
  if (mCjk) return STOP_SERIES.has(mCjk[1]) ? '' : mCjk[1];
  const mLat = /^([a-z][a-z0-9'’\- ]{2,18}?)(?:\s*\d|\s*:|$)/.exec(base);
  if (mLat) {
    const k = mLat[1].trim();
    return STOP_SERIES.has(k) ? '' : k;
  }
  return '';
}

/* ── 一次性索引（绑定 games 数组引用，数组变了自动重建） ── */
let idxGames = null;     // WeakMap: 游戏对象 → 系列键
let genreCount = null;   // 类型 → 条目数（算 IDF）
let seriesCount = null;  // 系列键 → 条目数（≥2 才当作系列）
let refGames = null;

function ensureIdx() {
  const all = gamesDb.all();
  if (idxGames && refGames === all) return;
  refGames = all;
  genreCount = new Map();
  seriesCount = new Map();
  idxGames = new WeakMap();
  for (const g of all) {
    for (const t of g.genres || []) {
      if (OP_TAGS.has(t)) continue;
      genreCount.set(t, (genreCount.get(t) || 0) + 1);
    }
    const sk = seriesKey(g.title);
    if (sk) seriesCount.set(sk, (seriesCount.get(sk) || 0) + 1);
    idxGames.set(g, sk);
  }
}

/** 类型权重：越稀有越值钱（动作冒险 36.8% → 约 2.0；恐怖惊悚 6.1% → 约 3.8） */
function genreWeight(tag) {
  const n = genreCount.get(tag) || 1;
  return 1 + Math.log(refGames.length / n);
}

const validScore = (v) => typeof v === 'number' && v > 0 && v <= 10;

/** 按标题在库里找「当前游戏」（详情页拿不到本地 id 时的兜底） */
function findCur({ id, t }) {
  if (id) {
    const hit = gamesDb.byIdGet(id);
    if (hit) return hit;
  }
  const title = String(t || '').trim();
  if (!title) return null;
  const r = gamesDb.search(title, 5);
  const items = r.items || [];
  if (!items.length) return null;
  const want = mainSeg(title).toLowerCase();
  return items.find((x) => mainSeg(x.title).toLowerCase() === want) || items[0];
}

/**
 * 多因子推荐。
 * @param {{id?:string,t?:string,g?:string,limit?:number,exclude?:string[]}} opts
 */
function related(opts = {}) {
  ensureIdx();
  const all = gamesDb.all();
  const limit = Math.min(Math.max(parseInt(opts.limit, 10) || 6, 1), 24);
  const cur = findCur(opts);

  const curGenres = ((cur && cur.genres) || (opts.g ? [opts.g] : []))
    .filter((x) => x && !OP_TAGS.has(x));
  const curScore = cur && validScore(cur.score) ? cur.score : null;
  const curSize = cur ? sizeGb(cur.size) : null;
  const curSeries = cur ? seriesKey(cur.title) : seriesKey(opts.t || '');
  const curZh = cur ? mainSeg(cur.title).toLowerCase() : mainSeg(opts.t || '').toLowerCase();
  const curIds = new Set([].concat(opts.exclude || [], cur ? [cur.id] : []).filter(Boolean));

  /* 候选池：①「有共同类型标签」的 ② 再加上**同系列的**。
     不能只按类型取池子 —— 同一系列常被分到不同标签（生化危机4 是「动作冒险」、
     生化危机8 是「恐怖惊悚」），只按类型取，续作永远进不来。
     当前游戏没有有效类型标签时才放开到全库。 */
  const pool = new Set(curGenres.length
    ? all.filter((g) => (g.genres || []).some((t) => curGenres.includes(t)))
    : all);
  if (curSeries) {
    for (const g of all) if (idxGames.get(g) === curSeries) pool.add(g);
  }
  const base = [...pool];

  const out = [];
  for (const g of base) {
    if (!g || !g.url || !g.title) continue;
    if (curIds.has(g.id)) continue;
    const zh = mainSeg(g.title).toLowerCase();
    if (zh && curZh && zh === curZh) continue;            // 同名（含另一源同款）

    let s = 0;
    const why = [];

    /* ① 类型交集（IDF 加权，取共同标签的均值） */
    const shared = (g.genres || []).filter((t) => curGenres.includes(t) && !OP_TAGS.has(t));
    if (shared.length) {
      const w = shared.reduce((a, t) => a + genreWeight(t), 0) / shared.length;
      s += 3.0 * (w / 4);                                  // 权重 2.0~4.0 → 1.5~3.0 分
    }

    /* ② 系列名（同一系列是「最像」的信号，给最高单项权重）
       ★ 但要过一道「档次一致性」闸：前缀相同 ≠ 同一部作品 ——
         库里 `赛博朋克2077`(9 分/70GB) 和 `赛博朋克SFX`(5 分/1.49GB 音效包) 前缀相同，
         不加闸的话，这类衍生小玩意儿会顶掉正经续作/同档作品。
         评分与容量**都**接近 → 满权重（同一档的续作/同系列）；只要有一项明显不符
         （如 5 分 / 1.5GB 的音效包对 9 分 / 92GB 的本体）→ 降为温和加成，排在正经同档作品之后。 */
    const sk = idxGames.get(g) || '';
    if (curSeries && sk && sk === curSeries && (seriesCount.get(sk) || 0) >= 2) {
      const sgv0 = sizeGb(g.size);
      const scoreNear = (curScore == null || !validScore(g.score)) ? null : Math.abs(g.score - curScore) <= 3.5;
      const sizeNear = (curSize == null || !sgv0) ? null : (Math.max(sgv0, curSize) / Math.min(sgv0, curSize) <= 12);
      const coherence = (scoreNear === false ? 0 : 1) + (sizeNear === false ? 0 : 1);
      s += coherence >= 2 ? 5.5 : 1.8;      // 两道都过才算「同一档」，否则只算弱信号
      if (coherence >= 2) why.push('同系列');
    }

    /* ③ 评分接近度 */
    if (curScore != null && validScore(g.score)) {
      const sim = Math.max(0, 1 - Math.abs(g.score - curScore) / 6);
      if (sim > 0) s += 2.5 * sim;
    }

    /* ④ 容量接近度（log2 比值，1GB 与 2GB 的差距 = 50GB 与 100GB 的差距） */
    const sg = sizeGb(g.size);
    if (curSize && sg) {
      const sim = Math.max(0, 1 - Math.min(1, Math.abs(Math.log2(sg / curSize)) / 3));
      if (sim > 0) s += 1.5 * sim;
    }

    /* ⑤ 新鲜度小加权（近一年的新作略微靠前，权重刻意压小） */
    const t0 = Number(g.updatedTs) || 0;
    if (t0 && Date.now() - t0 < 365 * 864e5) s += 0.4;

    s += Math.random() * 0.5;                              // 打散同分（小于任一因子的最小间隔）
    if (s <= 0) continue;
    out.push({ g, s, why });
  }

  out.sort((a, b) => b.s - a.s || (Number(b.g.updatedTs) || 0) - (Number(a.g.updatedTs) || 0));
  const items = out.slice(0, limit).map(({ g, why }) => Object.assign({}, g, { why }));
  return {
    ok: true,
    /* ★ 只回真实类型标签：`联机整合/免费专区/模拟器整合` 这类运营标签不作为分类展示，
       否则前端标题会变成「同分类更多 · 免费专区」（用户看到的还是错的分组）。 */
    genre: curGenres[0] || null,
    cur: cur ? { id: cur.id, title: cur.title, genres: cur.genres || [], score: cur.score, size: cur.size } : null,
    series: curSeries || '',
    pool: base.length,
    items,
  };
}

module.exports = { related, seriesKey, mainSeg, OP_TAGS, genreWeight, ensureIdx };
