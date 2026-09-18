/**
 * jiditopics.js — 机地「全量话题库」读取层（v10.22 新增）
 *
 * 数据来源：`data/jidi-topics.json`，由 `tools/build-jidi-topics.js` 抓取落盘。
 * 抓取链路见 `fetchers/jidiTopics.js`（签名见 `fetchers/jidiSigned.js`）。
 *
 * ─────────────────────────────────────────────────────────────
 * ★ 这一层的存在意义（本项目最大的一块数据缺口的收口处）
 *
 * 在此之前，机地一侧在本站只有 **66 条**（`fetchers/jidi.js` 的 libraryCandidates()
 * 只能拿「首页 SSR 新游 + 周/月/年热榜」，那是个人工精选集合），
 * 而 XD 一侧有 15,319 条 —— 用户一眼就看出来「为什么机地的数据那么少」。
 *
 * 实测发现机地有全量话题接口，`limit` 能到 1000 ⇒ **18 次请求抓回 17,220 条**。
 * 本层把它读出来，供三类用途：
 *   ① 与 XD 按 Steam appid 合并进端游库（`tools/sync-jidi-library.js`）
 *   ② 提供 PC 配置要求（`tools/build-spec-req.js` → `spec-req.json` → 解包匹配页）
 *   ③ 直接对外提供「机地全量话题」的检索/热度榜（本文件 + server 的 /api/jiditopics/*）
 *
 * ★ 刻意**不做**的事：
 *   · 不做名称模糊匹配 —— appid 才是跨源对齐的唯一可信键（本项目被名称匹配坑过：
 *     `ZTE Blade A73` 被判成 `Samsung Galaxy A73`）。
 *   · 不编造缺失字段 —— 源站没标的项留空，由调用方如实展示「未标注」。
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'jidi-topics.json');

let _cache = null;
let _mtime = 0;

/** 载入（带 mtime 失效：重跑抓取脚本后**不必重启服务**） */
function load() {
  let st;
  try { st = fs.statSync(FILE); } catch (e) {
    return { items: [], built: 0, error: 'jidi-topics.json 不存在（先跑 node tools/build-jidi-topics.js）' };
  }
  if (_cache && st.mtimeMs === _mtime) return _cache;

  let raw;
  try { raw = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) {
    return { items: [], built: 0, error: 'jidi-topics.json 解析失败：' + e.message };
  }
  const items = Array.isArray(raw) ? raw : (Array.isArray(raw.items) ? raw.items : []);
  _mtime = st.mtimeMs;
  _cache = {
    items,
    built: items.length,
    builtAt: raw.builtAt || null,
    stats: raw.stats || null,
    sort: raw.sort || null,
  };
  return _cache;
}

/** 覆盖率统计：**逐字段分开报**，不合成一个笼统的「完整度」 */
function stats() {
  const d = load();
  if (d.error) return { ok: false, error: d.error, total: 0 };
  const n = d.items.length;
  const has = (f) => d.items.filter((x) => x && x[f] != null && x[f] !== '').length;
  const reqHas = (f) => d.items.filter((x) => x && x.min && x.min[f] != null).length;
  return {
    ok: true,
    total: n,
    builtAt: d.builtAt,
    sort: d.sort,
    /* 用于与抓取脚本的落盘统计对账 —— 对不上说明读取层丢了数据 */
    hasCover: has('cover'),
    hasAppid: has('appid'),
    hasMin: d.items.filter((x) => x && x.min).length,
    hasRec: d.items.filter((x) => x && x.rec).length,
    hasDx: reqHas('dxV'),
    hasRam: reqHas('ram'),
    hasGpu: reqHas('gpu'),
    hasStorage: reqHas('storageGb'),
    /** 有可下载资源帖（mod_cnt > 0）的话题数 */
    downloadable: d.items.filter((x) => x && Number(x.modCnt) > 0).length,
    withHot: d.items.filter((x) => x && Number(x.dpv) > 0).length,
  };
}

/**
 * 检索 / 排序 / 分页。
 * @param {object} o
 * @param {string} [o.q]          关键词（同时匹配中文名与英文名）
 * @param {string} [o.sort]       'hot'（默认，浏览量） | 'update' | 'score'
 * @param {number} [o.limit=50]
 * @param {number} [o.offset=0]
 * @param {boolean} [o.dl]        只看有可下载资源帖的
 * @param {number} [o.hotMin]     热度下限
 */
function list({ q = '', sort = 'hot', limit = 50, offset = 0, dl = false, hotMin = 0 } = {}) {
  const d = load();
  if (d.error) return { ok: false, error: d.error, items: [], total: 0 };
  const kw = String(q).trim().toLowerCase();

  let pool = d.items;
  if (kw) {
    pool = pool.filter((x) => {
      const a = String(x.title || '').toLowerCase();
      const b = String(x.titleEn || '').toLowerCase();
      return a.includes(kw) || b.includes(kw);
    });
  }
  if (dl) pool = pool.filter((x) => Number(x.modCnt) > 0);
  if (hotMin > 0) pool = pool.filter((x) => Number(x.dpv) >= hotMin);

  const mode = ['hot', 'update', 'score'].indexOf(sort) >= 0 ? sort : 'hot';
  pool = pool.slice().sort((a, b) => {
    if (mode === 'update') return (b.updatedAt || 0) - (a.updatedAt || 0) || (b.dpv || 0) - (a.dpv || 0);
    if (mode === 'score') return (b.score || 0) - (a.score || 0) || (b.dpv || 0) - (a.dpv || 0);
    return (b.dpv || 0) - (a.dpv || 0) || (b.pv || 0) - (a.pv || 0);
  });

  const total = pool.length;
  const lim = Math.max(1, Math.min(Number(limit) || 50, 200));
  const off = Math.max(0, Number(offset) || 0);
  return { ok: true, total, offset: off, limit: lim, sort: mode, items: pool.slice(off, off + lim) };
}

/** 热度榜前 N（「可适配游戏优先推热门」的另一条出口） */
function top(n = 20) {
  const r = list({ sort: 'hot', limit: n });
  return r.ok ? r.items : [];
}

module.exports = { FILE, load, stats, list, top };
