/**
 * data/res-groups.js — 端游资源「按游戏聚合」索引（v10.47）
 *
 * ── 为什么需要这一层（用户口径）────────────────────────────────────────────
 * 「MOD 按游戏做卡片而不是按 MOD」+「存档只展示真有存档的而不是存档位置的」+
 * 「（修改器）同样按游戏聚合」。
 * 原来三个分区各是「一卡一条」，条数从几千涨到两万多之后，列表已经没有可读性：
 * 实测 MOD 7,825 条只对应 362 款游戏，最大一组 717 条（赛博朋克2077）——
 * 用户「按游戏做卡片」的判断被数据证实。本模块把 5 路来源**按游戏**收成一组一组。
 *
 * ── 五路来源（互不替代，各自答不同问题）──────────────────────────────────
 *   src=mod  机地社区帖 MOD          有网盘直链            → cat 'mod'
 *   src=yx   游侠补丁网存档文件      直链 + 网盘 + eD2K    → cat 'saves'
 *   src=gt   GTrainers 存档/修改器   **真实文件直链**      → cat 'saves' | 'trainers'
 *   src=fr   FearlessRevolution      CE 表附件直链         → cat 'trainers'
 *   src=gcm  GCM 元数据目录          **无下载链**（刻意）  → cat 'trainers'
 *
 * ── 统一条目形状（前端只认这一种，不必知道来源差异）──────────────────────
 *   { src, cat, id, title, game, libId, libTitle, size, date, downloads,
 *     links: [{label, url, cls}],   ← 下载通道（0 ～ N 个）；空则只能点 page
 *     page,                          ← 源站页（兜底出口，永远有）
 *     note,                          ← 版本 / 口径附注
 *     ts }                           ← 排序用时间戳（各源口径不一，仅作组内排序）
 *
 * ── 分组键 ────────────────────────────────────────────────────────────────
 * 优先用 `libId`（端游库 id，唯一）。少数条目没有 libId（机地未关联的 MOD）⇒
 * 回落到**归一化游戏名**做键。两种键前缀不同（`L:` / `N:`）以免同名撞车。
 * ⚠️ 回调「按游戏名匹配」是抓取阶段做的（fetchers/*.js + data/mod-match.js），
 *    本模块只做**聚合**，不重新做匹配 —— 匹配口径必须只有一处（铁律 17）。
 */
'use strict';

const mods = require('./mods');
const savesYx = require('./savesYx');
const gt = require('./gtrainers');
const fr = require('./fr');
const gcm = require('./trainers');
const gamesDb = require('./gamesDb');
const { normKey } = require('./name-normalize');

/* 与资源页既有配色语义共用一份表（tools/resource-sections.js 的 RES_PAN_CLS 同源） */
const PAN_CLS = {
  '迅雷网盘': 'xunlei', '百度网盘': 'baidu', '夸克网盘': 'quark', '阿里云盘': 'ali',
  '天翼云盘': '189', '移动云盘': '139', '123网盘': '123', '蓝奏云': 'lanzou',
  'UC网盘': 'uc', 'Steam': 'steam', 'PikPak': 'pikpak',
  xunlei: 'xunlei', baidu: 'baidu', quark: 'quark', ali: 'ali', '189': '189',
  '139': '139', '123': '123', lanzou: 'lanzou', uc: 'uc', pikpak: 'pikpak',
};
const panCls = (k) => PAN_CLS[k] || 'other';

/* 来源展示名（前端徽标用；一处定义，避免前端再抄一份） */
const SRC_LABEL = { mod: '机地 MOD', yx: '游侠存档', gt: 'GTrainers', fr: 'FearlessRevolution', gcm: 'GCM 清单' };
/** 来源徽标配色类后缀（配合前端 .tg.src.<key>） */
const SRC_KEY = { mod: 'mod', yx: 'yx', gt: 'gt', fr: 'fr', gcm: 'gcm' };

const MOUNT = { mod: '#mods', saves: '#resSaves', trainers: '#resTrainers' };

/* ─────────────────────────── 归一化：五路 → 统一形状 ─────────────────────────── */

function fromMods() {
  const out = [];
  for (const x of mods.ensure().items || []) {
    if (x.kind !== 'mod') continue;
    const links = (x.links || [])
      .filter((l) => l && l.url && l.kind && l.kind !== '其他链接')
      .map((l) => ({ label: String(l.kind).replace(/网盘$/, ''), url: l.url, cls: panCls(l.kind) }));
    out.push({
      src: 'mod', cat: 'mod', id: String(x.id),
      title: x.title || '', game: x.game || '',
      libId: x.libId || '', libTitle: x.libTitle || '', cover: x.cover || '',
      size: '', date: '', downloads: x.pv || 0, links,
      page: x.url || ('https://52jidi.com/post/detail/' + x.id),
      note: x.author ? ('作者 ' + x.author) : '',
      ts: (x.ut || x.ct || 0) * 1000,
    });
  }
  return out;
}

function fromYx() {
  const out = [];
  for (const x of savesYx.ensure().items || []) {
    const f = x.files || {};
    const links = [];
    /* ★ 真直链排第一：它是唯一「点了就开始下」的通道（其余是网盘/电驴，需要客户端） */
    if (f.direct) links.push({ label: '直链', url: f.direct, cls: 'direct' });
    for (const nd of f.netdisk || []) {
      if (nd && nd.url) links.push({ label: String(nd.kind || '网盘'), url: nd.url, cls: panCls(nd.kind) });
    }
    if (f.thunder) links.push({ label: '迅雷', url: f.thunder, cls: 'xunlei' });
    if (f.ed2k) links.push({ label: 'eD2K', url: f.ed2k, cls: 'ed2k' });
    out.push({
      src: 'yx', cat: 'saves', id: String(x.id),
      title: x.title || '', game: x.game || '',
      libId: x.libId || '', libTitle: x.libTitle || '', cover: x.libCover || x.cover || '',
      size: x.sizeFile || x.size || '', date: x.date || '',
      downloads: 0, links,
      page: x.sourceUrl || '',
      /* 没有解析出文件时**不静默丢条**：留一条附注，前端显示「去源站下载」 */
      note: links.length ? (f.fileName || '') : ('未解析到直链' + (x.fileFailWhy ? '：' + x.fileFailWhy : '')),
      ts: x.date ? Date.parse(x.date) || 0 : 0,
    });
  }
  return out;
}

function fromGt() {
  const out = [];
  for (const x of gt.ensure().items || []) {
    const links = [];
    if (x.direct) links.push({ label: '直链', url: x.direct, cls: 'direct' });
    out.push({
      src: 'gt', cat: x.cat === 'trainers' ? 'trainers' : 'saves', id: String(x.id),
      title: x.title || '', game: x.game || '',
      libId: x.libId || '', libTitle: x.libTitle || '', cover: '',
      size: x.size || '', date: x.date || '',
      downloads: x.downloads || 0, links,
      page: x.sourceUrl || '',
      note: links.length ? '' : '直链未解析出，走源站',
      ts: 0,
    });
  }
  return out;
}

function fromFr() {
  const out = [];
  for (const x of fr.ensure().items || []) {
    const links = (x.attachments || []).map((a) => ({
      label: (a.name || '附件') + (a.version ? ' ' + a.version : ''),
      url: a.url, cls: 'file', size: a.size || '', downloads: a.downloads || 0,
    }));
    out.push({
      src: 'fr', cat: 'trainers', id: String(x.t),
      title: x.title || '', game: x.game || '',
      libId: x.libId || '', libTitle: x.libTitle || '', cover: '',
      size: links.length ? (links[0].size || '') : '', date: '',
      downloads: links.reduce((n, l) => n + (l.downloads || 0), 0), links,
      page: x.sourceUrl || '',
      note: (fr.FORUM_LABEL[x.forum] || '') + (links.length > 1 ? '（' + links.length + ' 个附件）' : ''),
      ts: 0,
    });
  }
  return out;
}

function fromGcm() {
  const out = [];
  for (const x of gcm.ensure().items || []) {
    out.push({
      src: 'gcm', cat: 'trainers', id: String(x.k || x.name || ''),
      title: x.zh || x.name || '', game: x.zh || x.name || '',
      libId: x.libId || '', libTitle: x.libTitle || '', cover: x.libCover || '',
      size: '', date: '', downloads: 0,
      /* ★ GCM 刻意不给下载链：官方走一次性 S3 签名 URL（依赖客户端密钥），
       *   不该也不能离线复现。这里给「获取方式」外链，`links` 故意留空。 */
      links: [],
      page: x.libUrl || 'https://gamezonelabs.com/products/gcm/trainers',
      note: x.version ? ('v ' + x.version) : '',
      /* 无下载链的 GCM 条目排在**同游戏内有下载链的条目之后**（note 排序靠 ts/downloads） */
      ts: 0,
    });
  }
  return out;
}

/* ─────────────────────────── 建索引（按文件 mtime 失效） ─────────────────────────── */

let cache = null;
let sig = '';

function filesSig() {
  const fs = require('fs');
  const path = require('path');
  const d = __dirname;
  return ['mods.json', 'saves-youxia.json', 'gtrainers.json', 'fr.json', 'trainers.json', 'games.json']
    .map((f) => {
      try { return f + ':' + fs.statSync(path.join(d, f)).mtimeMs; } catch (e) { return f + ':x'; }
    }).join('|');
}

function build() {
  const s = filesSig();
  if (cache && s === sig) return cache;

  const all = [].concat(fromMods(), fromYx(), fromGt(), fromFr(), fromGcm());

  /* 端游库 id → 展示名 / 封面（条目自带 libCover 优先，其次这里兜底） */
  let lib = new Map();
  try {
    gamesDb.load();
    lib = new Map((gamesDb.all() || []).map((g) => [g.id, g]));
  } catch (e) { /* 库没起来也不致命：只是没有封面兜底 */ }

  const groups = new Map();      /* key → group */
  const byCat = { mod: [], saves: [], trainers: [] };
  /* ★ 预计算 (key, cat) → 条目数组。
   *   不这么做的话 groupItems() 每次都要全表 filter，而排序（sort=new）会对**每个组**
   *   调一次 ⇒ 362 组 × 7,825 条 = 280 万次比较，每个请求都跑一遍。
   *   Map 查表是 O(1)，这里多花几十 KB 换掉一个隐藏的 O(组 × 条)。 */
  const byKeyCat = new Map();    /* 'cat|key' → [items] */

  for (const it of all) {
    const g = lib.get(it.libId);
    if (g && !it.cover) it.cover = g.cover || '';
    const key = it.libId ? 'L:' + it.libId : (normKey(it.game || it.title) ? 'N:' + normKey(it.game || it.title) : '');
    if (!key) continue;   /* 连游戏名都没有的条目无法归组，跳过（进不来就不会静默消失：有 byCat 计数兜底） */
    let gr = groups.get(key);
    if (!gr) {
      gr = {
        key,
        libId: it.libId || '',
        game: (g && g.title) || it.game || it.libTitle || it.title || '?',
        libTitle: it.libTitle || (g && g.title) || '',
        cover: it.cover || '',
        n: 0, bySrc: {}, cats: {},
      };
      groups.set(key, gr);
    }
    gr.n++;
    gr.bySrc[it.src] = (gr.bySrc[it.src] || 0) + 1;
    gr.cats[it.cat] = (gr.cats[it.cat] || 0) + 1;
    if (!gr.cover && it.cover) gr.cover = it.cover;
    it._g = key; it._i = gr.n;
    if (byCat[it.cat]) byCat[it.cat].push(it);
    const kc = it.cat + '|' + key;
    const bucket = byKeyCat.get(kc);
    if (bucket) bucket.push(it); else byKeyCat.set(kc, [it]);
  }

  /* 组内排序：有下载通道的在前 → 下载数高的在前 → 新的在前 */
  const cmp = (a, b) => (!!(b.links && b.links.length) - !!(a.links && a.links.length))
    || (b.downloads || 0) - (a.downloads || 0)
    || (b.ts || 0) - (a.ts || 0);
  for (const arr of Object.values(byCat)) arr.sort(cmp);

  const gByCat = { mod: [], saves: [], trainers: [] };
  for (const gr of groups.values()) {
    for (const c of Object.keys(gByCat)) {
      if (gr.cats[c]) gByCat[c].push({ key: gr.key, cat: c, n: gr.cats[c] });
    }
  }

  cache = { sig: s, all, groups, byCat, gByCat, lib, byKeyCat };
  sig = s;
  return cache;
}

/* ─────────────────────────── 对外查询 ─────────────────────────── */

/** 某分区里「每组前 3 条」—— 组卡的卡内明文 */
const PREVIEW = 3;

/** 某组在某分区下的全部条目（O(1) 查预计算表） */
function groupItems(cat, key) {
  build();
  return (cache.byKeyCat.get(cat + '|' + key)) || [];
}

/**
 * 分页取「游戏组」。
 *   cat    'mod' | 'saves' | 'trainers'
 *   q      关键词（匹配组名 / 库名 / 组内任意条目标题）
 *   src    只看「含有该来源条目」的组（gt / fr / yx / gcm / mod）
 *   sort   'count'(默认,条目多的在前) | 'game'(按名) | 'new'(组内最新)
 *   limit / offset
 */
function groups(cat, opts = {}) {
  const b = build();
  const list = b.gByCat[cat] || [];
  const q = String(opts.q || '').trim();
  const src = String(opts.src || '').trim();
  const sort = opts.sort || 'count';
  let pool = list;

  /* ★ src 筛在**组**粒度：一个组可能混源（存档 = 游侠 + GTrainers），
   *   筛「GTrainers」时该组仍在，但卡内条目不按源过滤 —— 因为卡内只铺前 3 条，
   *   过滤会让「N 条」这个数与实际能铺出来的条数对不上，反而更难懂。
   *   想看纯源列表请去该源自己的接口（/api/gt/*）。 */
  if (src) {
    const hit = new Set();
    for (const it of b.byCat[cat]) if (it.src === src) hit.add(it._g);
    pool = pool.filter((g) => hit.has(g.key));
  }

  if (q) {
    const ql = q.toLowerCase();
    const qk = normKey(q);
    const hitKeys = new Set();
    /* ① 组名直接命中 */
    for (const g of pool) {
      const gr = b.groups.get(g.key);
      if (!gr) continue;
      const names = [gr.game, gr.libTitle].filter(Boolean);
      if (names.some((n) => String(n).toLowerCase().includes(ql) || (qk && normKey(n).includes(qk)))) hitKeys.add(g.key);
    }
    /* ② 组内条目标题命中（用户搜「整合包」也该搜得到） */
    for (const it of b.byCat[cat]) {
      if (hitKeys.has(it._g)) continue;
      const t = it.title || '';
      if (t.toLowerCase().includes(ql) || (qk && normKey(t).includes(qk))) hitKeys.add(it._g);
    }
    pool = pool.filter((g) => hitKeys.has(g.key));
  }

  const arr = pool.slice();
  const grp = (k) => b.groups.get(k);
  if (sort === 'game') arr.sort((x, y) => String(grp(x.key).game).localeCompare(String(grp(y.key).game), 'zh'));
  else if (sort === 'new') {
    /* 组内最新时间戳 —— 用预计算表，别在比较函数里全表扫 */
    const newestOf = new Map();
    for (const g of arr) {
      const list = b.byKeyCat.get(cat + '|' + g.key) || [];
      let m = 0;
      for (const it of list) if ((it.ts || 0) > m) m = it.ts || 0;
      newestOf.set(g.key, m);
    }
    arr.sort((x, y) => (newestOf.get(y.key) || 0) - (newestOf.get(x.key) || 0)
      || y.n - x.n);
  } else arr.sort((x, y) => y.n - x.n || String(grp(x.key).game).localeCompare(String(grp(y.key).game), 'zh'));

  const limit = Math.min(parseInt(opts.limit, 10) || 24, 200);
  const offset = parseInt(opts.offset, 10) || 0;
  const slice = arr.slice(offset, offset + limit);

  return {
    ok: true, cat, total: arr.length, itemTotal: (b.byCat[cat] || []).length,
    offset, limit, sort, q, src,
    items: slice.map((g) => {
      const gr = grp(g.key);
      const all = groupItems(cat, g.key);
      /* ★★ bySrc 必须按**本分区**统计，绝不能直接用 gr.bySrc。
       *   gr.bySrc 是「这款游戏跨三个分区的来源分布」——MOD 区的赛博朋克2077 因此会
       *   挂上「游侠存档 / GCM 清单」两个徽标，而卡内一条都没有（卡内只铺 cat=mod 的条目），
       *   用户看到徽标会以为点开就有存档。而且 stats() 的 bySrc 是**按分区**算的
       *   （它就是来源下拉的选项与计数来源），两处口径不一致 ⇒ 下拉里选不到卡面显示的那个来源。
       *   实测证据（改前）：/api/res/groups?cat=mod 的赛博朋克2077 回
       *   bySrc={mod:717, yx:48, gcm:3}，而该组在 cat=mod 下的真实条目全是 src=mod。
       *   cats 字段保留跨分区口径（「这款游戏还有什么资源」），语义不同，别混用。 */
      const bySrc = {};
      for (const x of all) bySrc[x.src] = (bySrc[x.src] || 0) + 1;
      return {
        key: g.key, game: gr.game, libId: gr.libId, libTitle: gr.libTitle, cover: gr.cover,
        count: g.n, bySrc, cats: gr.cats,
        items: all.slice(0, PREVIEW),
        more: Math.max(0, all.length - PREVIEW),
      };
    }),
  };
}

/** 展开一组：返回该组在某个分区下的全部条目（有上限，避免 717 条一次性砸下去） */
function items(cat, key, limit = 200) {
  const b = build();
  const all = groupItems(cat, key);
  const lim = Math.min(parseInt(limit, 10) || 200, 500);
  return {
    ok: true, cat, key, total: all.length,
    truncated: all.length > lim,
    items: all.slice(0, lim),
  };
}

function stats(cat) {
  const b = build();
  const g = b.gByCat[cat] || [];
  const it = b.byCat[cat] || [];
  const withLink = it.filter((x) => x.links && x.links.length).length;
  const bySrc = {};
  for (const x of it) bySrc[x.src] = (bySrc[x.src] || 0) + 1;
  return {
    ok: true, cat, groups: g.length, items: it.length, withLink,
    linkPct: it.length ? +(withLink / it.length * 100).toFixed(1) : 0,
    bySrc,
    srcLabel: SRC_LABEL,
  };
}

/** 详情页用：某款游戏在某个分区下的全部条目（瘦身投影，不带 _g/_i 这些内部字段） */
function slimItem(x) {
  return {
    src: x.src, cat: x.cat, id: x.id, title: x.title, game: x.game,
    size: x.size, date: x.date, downloads: x.downloads,
    links: x.links, page: x.page, note: x.note,
    /* 来源展示名一并给出：前端不必自带一份映射表（铁律 17：口径只留一处） */
    srcLabel: SRC_LABEL[x.src] || x.src,
  };
}

function byLib(cat, libId, limit = 60) {
  build();
  const id = String(libId || '');
  if (!id) return [];
  const arr = cache.byKeyCat.get(cat + '|L:' + id) || [];
  return arr.slice(0, limit).map(slimItem);
}

/** 组的总览（详情页挂「本游戏有 N 条 MOD / 存档 / 修改器」） */
function countsFor(libId) {
  build();
  const id = String(libId || '');
  const out = { mod: 0, saves: 0, trainers: 0 };
  if (!id) return out;
  for (const c of Object.keys(out)) out[c] = (cache.byKeyCat.get(c + '|L:' + id) || []).length;
  return out;
}

module.exports = {
  build, groups, items, stats, byLib, countsFor, slimItem,
  SRC_LABEL, SRC_KEY, MOUNT, PREVIEW,
};
