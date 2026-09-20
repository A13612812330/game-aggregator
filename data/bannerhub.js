/**
 * data/bannerhub.js — BannerHub 社区模拟器配置索引（只读）
 *
 * 数据来源：https://github.com/The412Banner/bannerhub-game-configs
 *   BannerHub 是安卓端「手机跑 PC 游戏」的模拟器，社区把每款游戏在各机型上跑通的配置
 *   导出成 JSON 上传到这个仓库。本模块把仓库聚合成本地索引，用于：
 *     ① 给本地库条目挂「手机可玩」徽标
 *     ② 提供独立的「📱 手机可玩」频道（按配置数/机型筛选）
 *     ③ 详情抽屉里展示某游戏的支持机型与逐条配置
 *
 * 索引由 tools/build-bannerhub.js 生成，本模块只读。
 */
const fs = require('fs');
const path = require('path');

const INDEX = path.join(__dirname, 'bannerhub.json');
const FILES = path.join(__dirname, 'bannerhub-files.json');

let idx = null;            // 索引对象
let filesCache = null;     // 逐条配置（懒加载）
const matchCache = new Map();

/** 归一化：去掉一切非字母数字，用于跨源名字匹配 */
function normKey(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}
/** 库内标题「中文名/English Name/支持网络联机」→ 多个候选钥匙 */
function titleKeys(title) {
  const out = new Set();
  const t = String(title || '');
  for (const p of t.split('/').map((x) => x.trim()).filter(Boolean)) {
    out.add(normKey(p));
    out.add(normKey(p.replace(/[-–—].*$/, '')));
  }
  out.add(normKey(t));
  out.add(normKey(t.replace(/[-–—].*$/, '')));
  out.delete('');
  return [...out].filter((k) => k.length >= 4);
}

function load(force) {
  if (idx && !force) return idx;
  try {
    idx = JSON.parse(fs.readFileSync(INDEX, 'utf-8'));
  } catch (e) {
    idx = { builtAt: 0, stats: { games: 0, configs: 0 }, keyIndex: {}, games: [], recent: [] };
  }
  matchCache.clear();
  return idx;
}
function ensure() { return idx || load(); }

/** 本地库标题 → BannerHub 条目（无则 null），带缓存 */
function lookup(title) {
  const d = ensure();
  const cacheKey = String(title || '');
  if (matchCache.has(cacheKey)) return matchCache.get(cacheKey);
  let hit = null;
  for (const k of titleKeys(title)) {
    const i = d.keyIndex[k];
    if (i !== undefined && d.games[i]) { hit = d.games[i]; break; }
  }
  if (matchCache.size > 20000) matchCache.clear();
  matchCache.set(cacheKey, hit);
  return hit;
}
/** 给库条目挂 bh 字段（原地不改原对象，返回浅拷贝） */
function attach(g) {
  if (!g) return g;
  const h = lookup(g.title);
  if (!h) return g;
  return Object.assign({}, g, {
    bh: { k: h.k, p: h.p, c: h.c, dv: h.dv, gp: h.gp, t: h.t, n: h.n },
  });
}

function stats() {
  const d = ensure();
  return Object.assign({ ok: true, builtAt: d.builtAt, repo: d.repo, site: d.site }, d.stats);
}

/** 频道列表：搜索 + 排序 + GPU 过滤 + 分页
 *  sort: 'configs'(默认,配置数倒序) | 'recent'(最近上传) | 'name'(名称)
 */
function list(opts = {}) {
  const d = ensure();
  const q = String(opts.q || '').trim().toLowerCase();
  const gpu = String(opts.gpu || '').trim().toLowerCase();
  const sort = opts.sort || 'configs';
  const limit = Math.min(parseInt(opts.limit, 10) || 60, 300);
  const offset = parseInt(opts.offset, 10) || 0;
  // libOnly：只返回「命中本地库」的游戏（即能在站内看详情/封面），
  // 手游专区用「手机可玩 + 有实测配置」时开启，避免出现点不开的条目。
  const libOnly = !!(opts.libOnly === true || opts.libOnly === '1' || opts.libOnly === 1);

  let pool = d.games;
  if (q) {
    const qk = normKey(q);
    pool = pool.filter((g) => g.p.toLowerCase().includes(q) || (qk && normKey(g.p).includes(qk)));
  }
  if (gpu) {
    const gk = normKey(gpu);   // "adreno 830" / "mali-g57" / "Adreno830" 统一成 adreno830
    pool = pool.filter((g) => (g.gp || []).some((x) => normKey(x).includes(gk)));
  }
  if (libOnly) pool = pool.filter((g) => !!libMatch(g));

  const arr = pool.slice();
  if (sort === 'name') arr.sort((a, b) => a.p.localeCompare(b.p));
  else if (sort === 'recent') arr.sort((a, b) => (b.t || 0) - (a.t || 0));
  else arr.sort((a, b) => (b.c || 0) - (a.c || 0) || (b.t || 0) - (a.t || 0));

  const total = arr.length;
  const items = arr.slice(offset, offset + limit).map((g) => {
    const lib = libMatch(g);   // 反查：该 BH 游戏在本地库里的条目 id
    return {
      k: g.k, p: g.p, c: g.c, t: g.t, dv: g.dv, gp: g.gp, n: g.n,
      libId: lib ? lib.id : null,
      libTitle: lib ? lib.title : null,
      libUrl: lib ? lib.url : null,
      libCover: lib ? (lib.cover || null) : null,
    };
  });
  return { ok: true, total, offset, limit, sort, q, gpu, libOnly, items };
}

/* 反查本地库（惰性建索引，避免启动时多读一遍 15k 条） */
let libByKey = null;
function buildLibIndex() {
  libByKey = new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'games.json'), 'utf-8'));
    const arr = Array.isArray(raw) ? raw : (raw.items || raw.games || []);
    for (const it of arr) {
      for (const k of titleKeys(it.title)) if (!libByKey.has(k)) libByKey.set(k, it);
    }
  } catch (e) { /* 无库文件 */ }
}
function libMatch(bhGame) {
  if (!libByKey) buildLibIndex();
  return libByKey.get(normKey(bhGame.k)) || null;
}

/** 逐条配置（懒加载 1.5MB 明细文件） */
function configs(key) {
  if (!filesCache) {
    try { filesCache = JSON.parse(fs.readFileSync(FILES, 'utf-8')); } catch (e) { filesCache = {}; }
  }
  const raw = filesCache[key] || [];
  const d = ensure();
  const base = d.raw || 'https://raw.githubusercontent.com/The412Banner/bannerhub-game-configs/main/configs/';
  const repo = 'https://github.com/The412Banner/bannerhub-game-configs/tree/main/configs/';
  return raw.slice(0, 200).map(([phone, gpu, ts, file]) => ({
    phone, gpu, ts, file,
    date: ts ? new Date(ts * 1000).toISOString().slice(0, 10) : '',
    url: base + encodeURIComponent(key) + '/' + encodeURIComponent(file),
    page: repo + encodeURIComponent(key),
  }));
}

/* ★ `libMatch` 必须导出：机型兼容的卡片要显示封面（`data/bhcover.js` 在用它），
   原来只是模块内部的私有函数。**不要再写第二份「键 → 库内条目」的匹配** —— 那就漂移了。 */
module.exports = { load, ensure, normKey, titleKeys, lookup, attach, stats, list, configs, libMatch, configCount: () => (ensure().games || []).length };
