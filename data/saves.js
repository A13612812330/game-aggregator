/**
 * data/saves.js — 「云存档」索引读取与查询（存档位置库）
 *
 * 数据来自 tools/build-saves.js 产出的 data/saves.json（惰性加载）。
 * 源：Ludusavi manifest（MIT 开源，社区长期维护，约 5.3 万款）
 * —— Game-Save-Manager 自身的存档库在签名 S3 后面，拿不到，故用此等价开源数据。
 *
 * 每条含：
 *   paths[]   存档文件位置（raw 原始占位符 / shown 可读路径 / notes 占位符释义 / tags）
 *   regs[]    注册表存档项
 *   cloud[]   支持云同步的平台（steam / epic / gog / ...）
 *   steamId   Steam appid（与端游库 cover 里的 appid 同口径）
 *   phone     是否「手机能玩」（在手游中心内）★ 手机专区默认筛选口径
 *   libId     端游库 id（可跳端游详情页）
 *
 * 详情页真正的价值：**告诉用户存档放在哪**（也就是「放置位置」）。
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'saves.json');
let cache = null;
let mtime = 0;

function ensure() {
  try {
    const st = fs.statSync(FILE);
    if (cache && st.mtimeMs === mtime) return cache;
    cache = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    mtime = st.mtimeMs;
    return cache;
  } catch (e) {
    cache = cache || { builtAt: 0, stats: {}, items: [] };
    return cache;
  }
}

function normKey(s) {
  return String(s || '').toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[：:·・,，.。!！?？'"“”‘’()（）\[\]【】《》<>~～\-–—_+*&/／|｜\\]/g, '');
}

/** 列表：搜索 + 只看手机能玩 + 只看支持云同步 + 排序 + 分页
 *
 *  q:      关键词（匹配 name / title / mobName）
 *  phone:  '1' 只看手机能玩（在手游中心内）
 *  cloud:  '1' 只看支持云同步的
 *  stats:  'all' 时不限定「手机能玩」
 *  sort:   'paths'(默认,存档项多优先) | 'name' | 'cloud'
 */
function list(opts = {}) {
  const d = ensure();
  const items = d.items || [];
  const q = String(opts.q || '').trim();
  const sort = opts.sort || 'paths';
  const limit = Math.min(parseInt(opts.limit, 10) || 60, 300);
  const offset = parseInt(opts.offset, 10) || 0;
  const pcOnly = !(opts.stats === 'all' || opts.all === '1' || opts.all === true);
  const phoneOnly = opts.phone === '1' || opts.phone === true;
  const cloudOnly = opts.cloud === '1' || opts.cloud === true;

  let pool = items;
  /* 默认口径：手机专区语境下先看「手机能玩」的；stats=all 放开到全量 */
  if (pcOnly || phoneOnly) pool = pool.filter((x) => x.phone);
  if (cloudOnly) pool = pool.filter((x) => (x.cloud || []).length);
  if (q) {
    const ql = q.toLowerCase();
    const qk = normKey(q);
    pool = pool.filter((x) => [x.name, x.title, x.mobName].filter(Boolean)
      .some((n) => String(n).toLowerCase().includes(ql) || (qk && normKey(n).includes(qk))));
  }

  const arr = pool.slice();
  if (sort === 'name') arr.sort((a, b) => String(a.title || a.name).localeCompare(String(b.title || b.name), 'zh'));
  else if (sort === 'cloud') arr.sort((a, b) => (b.cloud || []).length - (a.cloud || []).length || b.paths.length - a.paths.length);
  else arr.sort((a, b) => (b.paths.length + b.regs.length) - (a.paths.length + a.regs.length) || String(a.name).localeCompare(String(b.name), 'en'));

  const total = arr.length;
  return { ok: true, total, offset, limit, sort, q, phoneOnly: pcOnly || phoneOnly, cloudOnly, items: arr.slice(offset, offset + limit) };
}

function stats() {
  const d = ensure();
  const s = d.stats || {};
  const items = d.items || [];
  return {
    ok: true,
    builtAt: d.builtAt || 0,
    total: items.length,
    manifestGames: s.manifestGames || 0,
    phonePlayable: s.phonePlayable || items.filter((x) => x.phone).length,
    inPcLib: s.inPcLib || items.filter((x) => x.libId).length,
    pathCount: s.pathCount || items.reduce((n, x) => n + x.paths.length, 0),
    regCount: s.regCount || items.reduce((n, x) => n + x.regs.length, 0),
    withCloud: s.withCloud || items.filter((x) => (x.cloud || []).length).length,
    withSteam: s.withSteam || items.filter((x) => x.steamId).length,
    source: s.source || 'Ludusavi manifest (MIT)',
  };
}

function lookup(title) {
  const d = ensure();
  const k = normKey(title);
  if (!k) return null;
  for (const x of d.items || []) {
    if (x.k === k || normKey(x.name) === k || (x.title && normKey(x.title) === k)) return x;
  }
  return null;
}

/** 单款查询（详情抽屉用）：先按端游库 id，再按名称 */
function byLib(libId) {
  const d = ensure();
  if (!libId) return null;
  return (d.items || []).find((x) => x.libId === libId) || null;
}
function byKey(k) {
  const d = ensure();
  if (!k) return null;
  return (d.items || []).find((x) => x.k === k) || null;
}

module.exports = { list, stats, lookup, byLib, byKey, ensure, normKey };
