/**
 * data/trainers.js — 「修改器」索引读取与查询
 *
 * 数据来自 tools/fetch-trainers.js 产出的 data/trainers.json（惰性加载）。
 * 覆盖 5 个来源共 3,589 条：风灵月影 / CE 修改表 / 社区贡献 / 小幸修改器 / GCM 精选。
 * 每条挂端游库匹配结果（libId/libTitle/libCover/libUrl），供详情跳转与默认过滤。
 *
 * ⚠️ 本索引**不含下载直链**：GCM 官方走一次性 S3 签名 URL（依赖客户端密钥），
 *    无法也不应离线复现。详情页只做「信息展示 + 获取引导」。
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'trainers.json');
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

/** 列表：搜索 + 来源筛选 + 仅看命中端游库 + 排序 + 分页
 *
 *  q:       关键词（中英文皆可，匹配 name / zh / libTitle）
 *  source:  来源 key（fling / cheat_table / community / xiaoxing / gcm）
 *  stats:   'matched'(默认，只显示能对上端游库的) | 'all'
 *  sort:    'lib'(默认,有库优先) | 'name' | 'source' | 'zh'
 */
function list(opts = {}) {
  const d = ensure();
  const items = d.items || [];
  const q = String(opts.q || '').trim();
  const source = String(opts.source || '').trim();
  const sort = opts.sort || 'lib';
  const limit = Math.min(parseInt(opts.limit, 10) || 60, 300);
  const offset = parseInt(opts.offset, 10) || 0;
  const matchedOnly = !(opts.stats === 'all' || opts.all === '1' || opts.all === true);

  let pool = items;
  if (matchedOnly) pool = pool.filter((x) => x.libId);
  if (source) pool = pool.filter((x) => x.source === source);
  if (q) {
    const ql = q.toLowerCase();
    const qk = normKey(q);
    pool = pool.filter((x) => [x.name, x.zh, x.libTitle].filter(Boolean)
      .some((n) => String(n).toLowerCase().includes(ql) || (qk && normKey(n).includes(qk))));
  }

  const arr = pool.slice();
  if (sort === 'name') arr.sort((a, b) => String(a.name).localeCompare(String(b.name), 'en'));
  else if (sort === 'zh') arr.sort((a, b) => String(a.zh || a.name).localeCompare(String(b.zh || b.name), 'zh'));
  else if (sort === 'source') arr.sort((a, b) => String(a.source).localeCompare(String(b.source)) || String(a.name).localeCompare(String(b.name), 'en'));
  else arr.sort((a, b) => (b.libId ? 1 : 0) - (a.libId ? 1 : 0) || String(a.zh || a.name).localeCompare(String(b.zh || b.name), 'zh'));

  const total = arr.length;
  return { ok: true, total, offset, limit, sort, q, source, matchedOnly, items: arr.slice(offset, offset + limit) };
}

function stats() {
  const d = ensure();
  const s = d.stats || {};
  const items = d.items || [];
  const matched = items.filter((x) => x.libId).length;
  return {
    ok: true,
    builtAt: d.builtAt || 0,
    total: items.length,
    rawTotal: s.rawTotal || items.length,
    matched,
    unmatched: items.length - matched,
    matchedRate: items.length ? +(matched / items.length * 100).toFixed(1) : 0,
    matchedByZh: s.matchedByZh || 0,
    matchedByEn: s.matchedByEn || 0,
    sources: s.sources || [],
  };
}

/** 按名称反查单条（抽屉挂徽标用） */
function lookup(title) {
  const d = ensure();
  const k = normKey(title);
  if (!k) return null;
  for (const x of d.items || []) {
    if (x.k === k || normKey(x.name) === k || (x.zh && normKey(x.zh) === k)) return x;
  }
  return null;
}

/** 某款游戏的全部修改器条目（详情抽屉用；按库 id 精确命中） */
function byLib(libId) {
  const d = ensure();
  if (!libId) return [];
  return (d.items || []).filter((x) => x.libId === libId);
}

module.exports = { list, stats, lookup, byLib, ensure, normKey };
