/**
 * data/mods.js — 「MOD / 修改器」索引读取与查询（机地社区帖）
 *
 * 数据来自 tools/fetch-mods.js 产出的 data/mods.json（惰性加载，按 mtime 失效）。
 * 覆盖两类共约 8,900 条：MOD（resource_type=2）与 修改器（resource_type=3）。
 * 与另一套「修改器」数据（data/trainers.json，来源 Game Cheats Manager）**互不替代**：
 *   · trainers：英文站点的元数据目录，**没有下载地址**，只做「有没有 / 什么版本」
 *   · mods    ：机地社区帖，**带网盘直链**（13,000+ 条链接），是真正能拿到东西的那一套
 *
 * ⚠️ 每条正文 content 可能很长（含完整使用说明 / 按键表），已由抓取层截断至 6000 字。
 *    链接另存为结构化的 links[]，前端优先用 links 渲染，不必再正则正文。
 */
const fs = require('fs');
const path = require('path');
/* ★ v10.58：显示用短名（dtitle）的规则本体在 name-normalize（**单一真源**）——
 *   前端不重算，只消费返回的 dtitle。见 cleanModTitle 的文件头说明。 */
const { cleanModTitle } = require('./name-normalize');

const FILE = path.join(__dirname, 'mods.json');
let cache = null;
let mtime = 0;

/** ★ v10.58：给条目派生 `dtitle`（界面显示用的清洗后短名）。
 *
 *  · 为什么在**返回层**：原始 `title` 是对得上源站的凭据，落盘数据一个字节不改；
 *    派生视图只在出接口时生成，随时可换规则、不用重跑抓取（重跑一次 ≈ 数分钟 + 论坛压力）。
 *  · 为什么**浅拷贝**：`ensure()` 返回的是带缓存的同一批对象，原地赋值会让第二次调用
 *    带着上次的字段（本项目在别处踩过「缓存对象被下游改写」的同类坑）。
 *  · 为什么**不是所有条目都变**：实测 7,825 条 Mod 里只有 751 条会被清洗改写，
 *    其余 7,074 条 `dtitle === title`（保守档只砍确定性高的尾巴）。 */
function deco(x) {
  if (!x) return x;
  return { ...x, dtitle: cleanModTitle(x.title, x.game) };
}

function ensure() {
  try {
    const st = fs.statSync(FILE);
    if (cache && st.mtimeMs === mtime) return cache;
    cache = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    mtime = st.mtimeMs;
    return cache;
  } catch (e) {
    if (e && e.code !== 'ENOENT') console.error('[mods] 索引加载失败:', e.message);
    cache = cache || { builtAt: 0, stats: {}, items: [] };
    return cache;
  }
}

function normKey(s) {
  return String(s || '').toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[：:·・,，.。!！?？'"“”‘’()（）\[\]【】《》<>~～\-–—_+*&/／|｜\\]/g, '');
}

/** 列表：关键词 + 类型 + 仅看命中端游库 + 排序 + 分页
 *
 *  q:      关键词（匹配 title / game / libTitle / author）
 *  kind:   'mod' | 'modifier' | ''(全部)
 *  all:    true 时不过滤（默认只给命中端游库的，与 trainers 的口径一致）
 *  sort:   'new'(默认,按源站更新时间倒序) | 'hot'(浏览量) | 'game' | 'title'
 */
function list(opts = {}) {
  const d = ensure();
  const items = d.items || [];
  const q = String(opts.q || '').trim();
  const kind = String(opts.kind || '').trim();
  const sort = opts.sort || 'new';
  const limit = Math.min(parseInt(opts.limit, 10) || 60, 300);
  const offset = parseInt(opts.offset, 10) || 0;
  const matchedOnly = !(opts.all === '1' || opts.all === true || opts.all === 'all');

  let pool = items;
  if (matchedOnly) pool = pool.filter((x) => x.libId);
  if (kind) pool = pool.filter((x) => x.kind === kind);
  if (q) {
    const ql = q.toLowerCase();
    const qk = normKey(q);
    pool = pool.filter((x) => [x.title, x.game, x.libTitle, x.author].filter(Boolean)
      .some((n) => String(n).toLowerCase().includes(ql) || (qk && normKey(n).includes(qk))));
  }

  const arr = pool.slice();
  if (sort === 'hot') arr.sort((a, b) => (b.pv || 0) - (a.pv || 0) || (b.ut || 0) - (a.ut || 0));
  else if (sort === 'game') arr.sort((a, b) => String(a.game).localeCompare(String(b.game), 'zh') || (b.ut || 0) - (a.ut || 0));
  else if (sort === 'title') arr.sort((a, b) => String(a.title).localeCompare(String(b.title), 'zh'));
  else arr.sort((a, b) => (b.ut || b.ct || 0) - (a.ut || a.ct || 0));

  const total = arr.length;
  return { ok: true, total, offset, limit, sort, q, kind, matchedOnly,
    items: arr.slice(offset, offset + limit).map(deco) };
}

function stats() {
  const d = ensure();
  const s = d.stats || {};
  const items = d.items || [];
  const matched = items.filter((x) => x.libId).length;
  const byKind = {};
  for (const x of items) byKind[x.kind] = (byKind[x.kind] || 0) + 1;
  return {
    ok: true,
    builtAt: d.builtAt || 0,
    total: items.length,
    matched,
    unmatched: items.length - matched,
    matchedRate: items.length ? +(matched / items.length * 100).toFixed(1) : 0,
    byKind,
    withLinks: s.withLinks || 0,
    linkTotal: s.linkTotal || 0,
    games: new Set(items.map((x) => x.game).filter(Boolean)).size,
  };
}

/** 某款游戏的全部 MOD/修改器（详情抽屉用；按端游库 id 精确命中）
 *  ★ v10.58：出接口前经 `deco()` 补 `dtitle`（见其说明） */
function byLib(libId, kind) {
  const d = ensure();
  if (!libId) return [];
  return (d.items || []).filter((x) => x.libId === libId && (!kind || x.kind === kind)).map(deco);
}

/** 按游戏名反查（详情抽屉在没有 libId 时兜底） */
function byGame(game) {
  const d = ensure();
  const k = normKey(game);
  if (!k) return [];
  return (d.items || []).filter((x) => normKey(x.game) === k).map(deco);
}

/** 单条（详情页/预览用） */
function get(id) {
  const d = ensure();
  const it = (d.items || []).find((x) => String(x.id) === String(id)) || null;
  return it ? deco(it) : null;
}

/** 顶部游戏榜：条目数最多的游戏（前端「最热游戏」用） */
function topGames(limit = 20) {
  const d = ensure();
  const m = new Map();
  for (const x of d.items || []) {
    if (!x.game) continue;
    const o = m.get(x.game) || { game: x.game, libId: x.libId || '', cover: x.cover || '', mod: 0, modifier: 0 };
    o[x.kind] = (o[x.kind] || 0) + 1;
    if (!o.cover && x.cover) o.cover = x.cover;
    if (!o.libId && x.libId) o.libId = x.libId;
    m.set(x.game, o);
  }
  const arr = [...m.values()].map((o) => ({ ...o, total: o.mod + o.modifier }));
  arr.sort((a, b) => b.total - a.total);
  return arr.slice(0, limit);
}

module.exports = { list, stats, byLib, byGame, get, topGames, ensure, normKey };
