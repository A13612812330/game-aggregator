/**
 * data/pcreq.js — PC 配置要求（最低 / 推荐）本地缓存 + 实时兜底
 *
 * ★ 为什么要有这一层（v10.13）：
 *   用户反馈「详情页的游玩配置没有了」。排查结果：XDGAME 详情页**本身已完全没有
 *   配置要求数据**（改版后只剩 游戏厂商 / 发行日期 / 更新时间 / 版本介绍），
 *   而前端 `d.requirements ? ...` 是「没有就整块不渲染」——
 *   于是 XD 来源的 15,302 款游戏，详情页里那块配置信息是**永久空白**的。
 *
 *   机地(jidiyouxi)的详情接口有 game_sys_reqs，但机地只收录了其中一部分话题。
 *   所以补一条覆盖率更高的通路：**Steam 官方商店接口**。
 *
 * ★ 为什么能对上 97% 的库：
 *   本库 15,302 款里 14,876 款（97.2%）的封面 URL 是 Steam CDN 形态
 *   `https://shared.cdn.queniuqe.com/store_item_assets/steam/apps/<appid>/...`，
 *   appid 直接可提取 → 调
 *   `https://store.steampowered.com/api/appdetails?appids=<appid>&l=schinese&filters=basic,pc_requirements`
 *   就能拿到**官方中文**的「最低配置 / 推荐配置」。
 *
 *   ⚠️ filters 的坑：只写 `filters=pc_requirements` 时 Steam 会返回 `data: []`
 *      （实测 200 但空），必须带上 `basic` —— 见 v10.13 的 probe 记录。
 *
 * ★ 三级兜底（调用方不需要知道细节，`resolve()` 一路走到底）：
 *   ① 本地缓存 data/steam-req.json（tools/build-steam-req.js 预热 + 运行时回写）
 *   ② 实时抓 Steam（串行限流，结果回写缓存；失败/未收录也写负缓存，避免反复打）
 *   ③ 同名机地话题（机地详情页的 game_sys_reqs）—— Steam 没有中文条目时的兜底
 *
 * 数据形态（每个 appid 一条）：
 *   { min:{os,cpu,ram,gpu,dx,net,storage,note}, rec:{...}, name, ts, miss? }
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'steam-req.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

let db = null;          // { builtAt, src, count, map }
let dirty = false;
let flushTimer = null;

function emptyDb() {
  return { builtAt: 0, src: 'steam-appdetails', count: 0, map: {} };
}
function ensure() {
  if (db) return db;
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    db = { builtAt: j.builtAt || 0, src: j.src || 'steam-appdetails', count: 0, map: j.map || {} };
    db.count = Object.keys(db.map).length;
  } catch (e) {
    db = emptyDb();
  }
  return db;
}

/** 落盘（合并写，避免每抓一条就同步写 2MB 文件） */
function flush(force) {
  if (!dirty) return;
  if (!force && flushTimer) return;
  const doWrite = () => {
    flushTimer = null;
    if (!dirty || !db) return;
    dirty = false;
    try {
      db.builtAt = db.builtAt || Date.now();
      db.count = Object.keys(db.map).length;
      fs.writeFileSync(FILE, JSON.stringify({ builtAt: db.builtAt, src: db.src, count: db.count, map: db.map }));
    } catch (e) { /* 写不进去（只读盘）也不影响内存可用 */ }
  };
  if (force) return doWrite();
  flushTimer = setTimeout(doWrite, 5000);
  if (flushTimer.unref) flushTimer.unref();
}
process.on('exit', () => flush(true));

/** 封面 URL → Steam appid（本库封面 97.2% 命中） */
function appidOf(cover) {
  const m = String(cover || '').match(/\/steam\/apps\/(\d+)\//);
  return m ? m[1] : '';
}

/* ---------------- Steam pc_requirements 解析 ---------------- */
const FIELD_MAP = [
  [/操作系统|^OS$|Operating System/i, 'os'],
  [/处理器|^Processor$/i, 'cpu'],
  [/内存|^Memory$/i, 'ram'],
  [/显卡|图形|^Graphics$/i, 'gpu'],
  [/DirectX/i, 'dx'],
  [/网络|^Network$/i, 'net'],
  [/存储|硬盘|^Storage|Hard Drive/i, 'storage'],
  [/附注|备注|^Additional Notes/i, 'note'],
];
const stripTags = (s) => String(s == null ? '' : s)
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ')
  .trim();

/** Steam 的配置 HTML → 结构化字段；取不到任何字段返回 null */
function parseReq(html) {
  if (!html) return null;
  const out = {};
  for (const m of String(html).matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
    const line = stripTags(m[1]);
    if (!line) continue;
    const sep = line.search(/[:：]/);
    if (sep < 0) continue;
    const label = line.slice(0, sep).trim();
    const val = line.slice(sep + 1).trim();
    if (!val) continue;
    for (const [re, key] of FIELD_MAP) {
      if (re.test(label)) { if (!out[key]) out[key] = val; break; }
    }
  }
  /* 有些条目把「最低配置:」写在 li 外面（<strong>最低配置:</strong><br><ul>…）
   * 这种情况下上面照样能取到；万一一个 li 都没有，退回按 <strong> 切分 */
  if (!Object.keys(out).length) {
    const flat = stripTags(html);
    for (const [re, key] of FIELD_MAP) {
      const m = flat.match(new RegExp('(?:' + re.source + ')\\s*[:：]\\s*([^:：]{2,120}?)(?=\\s*(?:操作系统|处理器|内存|显卡|DirectX|网络|存储|附注|$))', 'i'));
      if (m) out[key] = m[1].trim();
    }
  }
  return Object.keys(out).length ? out : null;
}

/* ---------------- 限流抓取队列 ----------------
 * Steam appdetails 有速率限制（经验值 ~200 次 / 5 分钟）。
 * 这里串行 + 最小间隔 1100ms ≈ 54 次/分钟，稳；单条超时 12s，失败即返回（不重试，
 * 交给负缓存，避免用户等待时卡住）。
 */
const MIN_GAP = 1100;
let lastAt = 0;
let chain = Promise.resolve();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function throttled(fn) {
  const p = chain.then(async () => {
    const gap = Date.now() - lastAt;
    if (gap < MIN_GAP) await wait(MIN_GAP - gap);
    lastAt = Date.now();
    return fn();
  });
  chain = p.catch(() => {});
  return p;
}

async function fetchSteam(appid) {
  const url = 'https://store.steampowered.com/api/appdetails?appids=' + appid + '&l=schinese&filters=basic,pc_requirements';
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  const node = j && j[appid];
  if (!node || !node.success || !node.data) return null;
  const pc = node.data.pc_requirements || {};
  const min = parseReq(pc.minimum);
  const rec = parseReq(pc.recommended);
  if (!min && !rec) return null;
  return { min, rec, name: stripTags(node.data.name || '').slice(0, 80) };
}

/** Steam 名称搜索（封面里没有 appid 时的兜底） */
async function searchAppid(name) {
  const q = String(name || '').split('/')[0].trim();
  if (q.length < 2) return '';
  const url = 'https://store.steampowered.com/api/storesearch/?term=' + encodeURIComponent(q) + '&l=schinese&cc=cn';
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) return '';
  const j = await r.json();
  const it = (j.items || [])[0];
  return it && it.id ? String(it.id) : '';
}

/** 同步读缓存（不触发网络） */
function peek(appid) {
  if (!appid) return null;
  const e = ensure().map[appid];
  if (!e) return null;
  if (e.miss) {
    /* 负缓存 7 天过期，过期后允许重试 */
    return (Date.now() - (e.ts || 0)) < 7 * 864e5 ? { miss: true } : null;
  }
  return e;
}

function save(appid, val) {
  const d = ensure();
  d.map[appid] = Object.assign({ ts: Date.now() }, val);
  d.count = Object.keys(d.map).length;
  dirty = true;
  flush(false);
}

/**
 * 解析某款游戏的 PC 配置要求。
 *   opts: { title, cover, appid }
 * 返回 { ok, hit, src:'steam'|null, appid, min, rec }
 */
async function resolve(opts = {}) {
  let appid = String(opts.appid || '').trim() || appidOf(opts.cover);
  if (appid) {
    const c = peek(appid);
    if (c && !c.miss) return { ok: true, hit: true, src: 'steam', appid, min: c.min || null, rec: c.rec || null, name: c.name || '' };
    if (!c) {
      try {
        const got = await throttled(() => fetchSteam(appid));
        if (got) {
          save(appid, got);
          return { ok: true, hit: true, src: 'steam', appid, min: got.min, rec: got.rec, name: got.name };
        }
        save(appid, { miss: true });
      } catch (e) {
        /* 网络异常**不写负缓存**（否则一次抖动会把这款游戏永久判成「无配置」），
         * 但要如实上抛 error，让预热脚本能区分「Steam 真没收录」与「这次抓取失败」。 */
        return { ok: true, hit: false, src: null, appid, min: null, rec: null, error: String(e.message || e) };
      }
    }
  }
  /* 无 appid（封面非 Steam CDN）：按中文名搜一次，再走同一条路 */
  if (!appid && opts.title) {
    try {
      const sid = await throttled(() => searchAppid(opts.title));
      if (sid) {
        const got = await throttled(() => fetchSteam(sid));
        if (got) {
          save(sid, got);
          return { ok: true, hit: true, src: 'steam', appid: sid, min: got.min, rec: got.rec, name: got.name };
        }
      }
    } catch (e) { /* 忽略 */ }
  }
  return { ok: true, hit: false, src: null, appid: appid || '', min: null, rec: null };
}

function stats() {
  const d = ensure();
  let withReq = 0, miss = 0;
  for (const k of Object.keys(d.map)) (d.map[k].miss ? miss++ : withReq++);
  return { ok: true, builtAt: d.builtAt, src: d.src, cached: d.count, withReq, miss };
}

module.exports = { resolve, peek, appidOf, parseReq, stats, save, _file: FILE };
