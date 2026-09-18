/**
 * data/gamesDb.js — 本地游戏库(JSON 单文件持久化 + 内存索引)
 * 数据源：XDGAME 全量列表 / 机地收录增量。搜索走本地内存匹配,毫秒级。
 */
const fs = require('fs');
const path = require('path');
const { normalizeCover, normalizeList } = require('./cover-url');
const { dateTs } = require('../shared');
const { normalizeDates, normalizeOne } = require('./date-norm');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'games.json');

let games = [];          // 全量数组
let byId = new Map();    // id -> game
let dirty = false;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** ★ 排序键（内存态，不落盘）：「最新更新」排序用。
 *  语义（v10.8 用户确认）= **源站更新日期优先，缺失时退回收录时间**。
 *  旧版直接用 updatedTs（= 本站抓取时间），所以昨天刚抓到的 8 月老游戏会插到最前，
 *  列表日期标签跳序。改后日期严格倒序，同日再按收录时间打平。
 *
 *  用 non-enumerable 定义：persist() 里的 JSON.stringify 不会把它写进 games.json，
 *  避免派生字段污染数据文件。 */
function stampSortKey(g) {
  if (!g || typeof g !== 'object') return;
  const t = Number(g.updatedTs);
  const v = dateTs(g.dateLabel) || (Number.isFinite(t) ? t : 0);
  if (Object.prototype.hasOwnProperty.call(g, '_sortTs')) { g._sortTs = v; return; }
  try {
    Object.defineProperty(g, '_sortTs', { value: v, writable: true, configurable: true, enumerable: false });
  } catch (e) { /* 冻结对象等极端情况：排序时回退实时计算 */ }
}
const sortKeyOf = (g) =>
  (typeof g._sortTs === 'number' ? g._sortTs : (dateTs(g.dateLabel) || Number(g.updatedTs) || 0));

function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      games = arr;
      /* ★ v10.4 封面兜底：历史数据里有 223 条 cover 是 XDGAME 站内相对路径
         （/uploads/…），直接铺到 <img> 会打到本站 404。这里就地把它们补成绝对 URL。 */
      normalizeList(games);
      /* ★ v10.8 日期兜底：统一两种源站格式（XD ISO / 机地斜杠）、还原被贪婪吃位的
         畸形日（`2026/9/89`→`2026-09-08`）、清理 NaN updatedTs。同封面兜底一个套路，
         防每日增量再带进脏值。 */
      normalizeDates(games);
      for (const g of games) stampSortKey(g);
      byId = new Map(arr.map((g) => [g.id, g]));
      return games.length;
    }
  } catch (e) {
    /* 首次运行无文件是正常的（ENOENT）；但**依赖/语法错误也会落到这里** ——
       若不打印，外部表现就是「库突然空了」，极难排查。
       （v10.8 实踩：漏了一行 require，load 静默返回 0，页面列表全空却无任何报错。） */
    if (e && e.code !== 'ENOENT') console.error('[gamesDb] 本地库加载失败:', e.message);
  }
  games = []; byId = new Map();
  return 0;
}

function persist() {
  if (!dirty) return;
  ensureDataDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(games), 'utf-8');
  dirty = false;
}
// 批量写入节流(数据大时不每次落盘)
function persistSoon() { setTimeout(persist, 800); }

/** 增量入库:已存在则更新字段 */
function upsert(list) {
  let added = 0, updated = 0;
  for (const g of list) {
    if (!g || !g.id || !g.title) continue;
    /* ★ v10.4 入口归一化：增量索引每次都从源站重抓，源站给的是相对路径 —— 不在这里
       拦一道，修好的历史数据会被下一轮增量覆盖回去。 */
    if (g.cover !== undefined) g.cover = normalizeCover(g.cover);
    /* ★ v10.8 日期入口归一化：与封面同理 —— 增量索引重抓回来的日期可能是斜杠式
       或被贪婪吃位（`2026/9/89`），不在这里拦一道，修好的历史数据会被下一轮增量覆盖回去。 */
    normalizeOne(g);
    const old = byId.get(g.id);
    if (old) { Object.assign(old, g); stampSortKey(old); updated++; }
    else { stampSortKey(g); byId.set(g.id, g); games.push(g); added++; }
  }
  dirty = true;
  persistSoon();
  return { added, updated, total: games.length };
}

/** 容量字符串 → GB 数值（"4.17GB"/"512MB"/"1.2TB" → 4.17/0.5/1228.8；解析不了返回 null） */
function sizeGb(s) {
  const m = /([\d.]+)\s*(TB|GB|MB|KB|B)?/i.exec(String(s == null ? '' : s).trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!isFinite(n)) return null;
  const u = (m[2] || 'GB').toUpperCase();
  return n * ({ B: 1 / 1073741824, KB: 1 / 1048576, MB: 1 / 1024, GB: 1, TB: 1024 }[u] || 1);
}
/** 大小区间 + 附加条件过滤（sizeMin/sizeMax 单位 GB，null/undefined = 不限） */
function applyOpts(pool, opts) {
  const o = opts || {};
  const lo = o.sizeMin == null || o.sizeMin === '' ? null : parseFloat(o.sizeMin);
  const hi = o.sizeMax == null || o.sizeMax === '' ? null : parseFloat(o.sizeMax);
  let out = pool;
  if (lo != null || hi != null) {
    out = out.filter((x) => {
      const v = sizeGb(x.size);
      if (v == null) return false;              // 容量未知的条目在区间筛选下不展示
      if (lo != null && v < lo) return false;
      if (hi != null && v >= hi) return false;
      return true;
    });
  }
  if (typeof o.filter === 'function') out = out.filter(o.filter);
  return out;
}

function search(q, limit = 20, opts) {
  const k = String(q || '').trim().toLowerCase();
  if (!k) return { q, count: 0, items: [] };
  const score = (t) => {
    const s = String(t || '').toLowerCase();
    if (s === k) return 0;
    if (s.startsWith(k)) return 1;
    if (s.includes(k)) return 2;
    const toks = s.split(/[/\s_：:·-]+/);
    if (toks.some((x) => x === k)) return 3;
    if (toks.some((x) => x.startsWith(k))) return 4;
    return 9;
  };
  const scored = [];
  for (const g of games) {
    const sc = Math.min(score(g.title), g.aliases && g.aliases.some((a) => String(a).toLowerCase().includes(k)) ? 3 : 9);
    if (sc < 9) scored.push([sc, g]);
  }
  scored.sort((a, b) => a[0] - b[0] || (b[1].updatedTs || 0) - (a[1].updatedTs || 0));
  const pool = applyOpts(scored.map(([, g]) => g), opts);
  const items = pool.slice(0, limit);
  return { q, count: pool.length, items };
}

/**
 * 库统计。
 *
 * ★ v10.22：为什么不能只报 `bySource`
 *
 * 机地全量话题（17,220 条）入库时，其中 13,611 条与库里已有的 XD 条目
 * **是同一款游戏**（靠封面里的 Steam appid 精确判定，不是模糊匹配），
 * 这些**不重复建卡**，而是把机地侧信息（`jidiId` / `jidiUrl` / 热度）
 * 挂到那条 XD 记录上 —— 否则同一款游戏会在分类流里出现两次。
 *
 * 但这带来一个**读数陷阱**：`bySource` 只数 `source` 字段，
 * 于是机地看着只有 3,609 条，而它实际覆盖了 17,220 款。
 * ⇒ 这里额外给出 `withJidi` / `withXd`（**覆盖数**，含合并过去的），
 *   两个口径都如实报出，避免「同一个数字被两种问法问出两个答案」。
 */
function stats() {
  const bySource = {};
  let withJidi = 0;
  let withXd = 0;
  let dual = 0;
  for (const g of games) {
    bySource[g.source] = (bySource[g.source] || 0) + 1;
    const hasJidi = g.source === 'jidi' || !!g.jidiId;
    const hasXd = g.source === 'xdgamer' || g.source === 'xdgame';
    if (hasJidi) withJidi++;
    if (hasXd) withXd++;
    if (hasJidi && hasXd) dual++;
  }
  return { total: games.length, bySource, withJidi, withXd, dual };
}

/** 分类浏览：按 genres 过滤 + 排序 + 分页（XD 风格分类流）
 *  sort: 'updated'(默认,更新时间倒序) | 'score'(评分倒序) | 'size'(容量倒序)
 *  opts: { sizeMin, sizeMax } 容量区间(GB) | { filter } 自定义谓词
 */
function browse(genre, limit = 50, offset = 0, sort = 'updated', opts) {
  const g = String(genre || '').trim();
  let pool = games;
  if (g && g !== '全部' && g !== 'all') {
    pool = games.filter((x) => (x.genres || []).some((t) => t.includes(g)));
  }
  pool = applyOpts(pool, opts);
  pool = pool.slice().sort((a, b) => {
    const sA = (a.score || 0) <= 10 ? (a.score || 0) : 0;
    const sB = (b.score || 0) <= 10 ? (b.score || 0) : 0;
    /* ★ v10.8：次键统一改用「更新日期优先」的排序键 —— 让同一评分/容量档内的
       条目也按日期倒序，与「最新更新」视图观感一致。 */
    const tA = sortKeyOf(a);
    const tB = sortKeyOf(b);
    if (sort === 'score') {
      return (sB - sA) || (tB - tA);
    }
    if (sort === 'size') {
      return (sizeGb(b.size) || 0) - (sizeGb(a.size) || 0) || (tB - tA);
    }
    /* 日期优先 → 同日再按精确收录时间打平（同日多批抓取时顺序更稳定） */
    return (tB - tA) || ((b.updatedTs || 0) - (a.updatedTs || 0));
  });
  const total = pool.length;
  const items = pool.slice(offset, offset + limit);
  return { genre: g || null, sort, total, offset, limit, items };
}

function byIdGet(id) { return byId.get(id); }
function all() { return games; }

module.exports = { load, upsert, search, stats, browse, byIdGet, all, persist, sizeGb, applyOpts };
