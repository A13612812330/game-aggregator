/* data/devicespec.js —— kalvo（zh.kalvo.com）硬件参数：搜索 → 抓页 → 解析 → 缓存
 *
 * ★ 写这块前必须先知道的实测结论（都是花时间试出来的）
 *
 * 1) **搜索接口不需要签名**，只需要三个请求头同时到位：
 *      klv-lang: en            ← 缺它 → 401 unauthorized
 *      X-Requested-With: XMLHttpRequest
 *      Referer: https://zh.kalvo.com/
 *    踩坑记录：`/ajax/search/?q=`（带尾斜杠）缺 klv-lang 一直 401；
 *    只加 X-Requested-With 变 403；只有三者齐了才 200。
 *    站点自己的 `search.js` 是**混淆过**的（字符串数组 + base64），一度让人以为要复算签名——
 *    其实不必，直接用 curl / node fetch 带上面三个头即可。
 *
 * 2) **设备页是纯 SSR HTML**，规格结构干净：
 *      div.cont > h3(章节名) + table > tbody > tr > td(键) + td(值)
 *    直接 curl 拿，不需要浏览器。
 *
 * 3) **它只按「营销名」匹配，解不了内部代号**：
 *      "moto e13" / "G45" / "POCO F7"  → 命中
 *      "X6873" / "X6873 Infinix"       → 空
 *    所以「内部代号 → 品牌+型号」走 device-market.json（MobileModels），
 *    这里只负责「型号名 → 硬件参数」。
 *
 * 4) 搜索是**按空格分词的**，"moto g45 5G" 里多出来的 "5G" 会让结果变空 →
 *    查询失败时自动降级「去掉尾部规格词」再搜一次。
 */
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const ROOT = path.join(__dirname, '..');
const CACHE_FILE = path.join(__dirname, 'device-specs.json');
const HOST = 'https://zh.kalvo.com';
const TTL = 30 * 24 * 3600 * 1000;        // 命中 30 天
const TTL_MISS = 3 * 24 * 3600 * 1000;    // 未命中 3 天（避免每次都去问空结果）

const HDRS = {
  'klv-lang': 'en',
  'X-Requested-With': 'XMLHttpRequest',
  'Referer': HOST + '/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/html;q=0.9,*/*;q=0.8',
};

const mkey = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');

/* 缓存键 —— ★ v10.18 修正：**不能用 mkey**。
 *   mkey 会把标点全抹掉，于是 `moto g(20)`（kalvo 搜不到）与 `moto g20`（搜得到）
 *   归一成同一个键 `motog20` ⇒ 一条「查不到」的失败记录会把**能查到的那条也毒掉**
 *   （实测：修好查询词后仍返回「未收录」，就是这个原因）。
 *   括号、连字符这些标点恰恰决定 kalvo 搜不搜得到，必须留在键里。
 *   改用「小写 + 空白折叠」的原文键；`mkey` 仍保留给别处做宽松比对。
 *   ⚠️ 旧格式的缓存条目会因此变成查不到（只是多一次网络请求，不会返回错数据）。 */
const ckey = (s) => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();

/* ---------- 缓存 ---------- */
let _cache = null;
function cache() {
  if (_cache) return _cache;
  try { _cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch (e) { _cache = null; }
  if (!_cache || !_cache.items) _cache = { builtAt: Date.now(), source: 'zh.kalvo.com', items: {} };
  return _cache;
}
let _dirty = false;
function flush(force) {
  if (!_dirty && !force) return;
  const c = cache();
  c.builtAt = Date.now();
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(c)); _dirty = false; } catch (e) { /* 只读环境也不该炸 */ }
}
function cachePut(k, rec) { const c = cache(); c.items[k] = rec; _dirty = true; flush(); }

/* ---------- 网络（本机统一走 curl，见项目约定） ---------- */
function curlText(url) {
  const { execFileSync } = require('child_process');
  const args = ['-sS', '-m', '30', '-L', '--compressed'];
  for (const [k, v] of Object.entries(HDRS)) args.push('-H', `${k}: ${v}`);
  args.push(url);
  try {
    return execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (e) { return ''; }
}

/** 按营销名搜索 → [{ name, slug, img }] */
function searchMarket(q, limit = 8) {
  const url = `${HOST}/ajax/search/?q=${encodeURIComponent(q)}&_=${Date.now()}`;
  const txt = curlText(url);
  if (!txt || !txt.trim().startsWith('{')) return [];
  let j;
  try { j = JSON.parse(txt); } catch (e) { return []; }
  if (!j || j.result !== true || !Array.isArray(j.response)) return [];
  return j.response.slice(0, limit).map((x) => ({ name: x.name || '', slug: x.slug || '', img: x.img || '' }));
}

/* ---------- 解析（纯函数，测试直接 require） ---------- */
/** 把设备页 HTML 解析成 { title, groups:[{ name, items:[{k,v}] }] } */
function parseSpecs(html) {
  if (!html) return null;
  const $ = cheerio.load(html);
  const title = ($('title').first().text() || '').split('|')[0].trim();

  // 主规格区：div.specs（页面里还有 ads / 推荐位，必须先圈定容器）
  const scope = $('div.specs').length ? $('div.specs') : $.root();
  const groups = [];
  scope.find('div.cont').each((_, el) => {
    const h3 = $(el).find('h3').first().text().trim();
    if (!h3) return;
    const items = [];
    $(el).find('table tr').each((__, tr) => {
      const tds = $(tr).find('td');
      if (tds.length < 2) return;
      const k = $(tds[0]).text().trim();
      /* ★ 值里常有多行（`<br>` 分隔）：微架构 / 版本配置 都是。
         直接 .text() 会把两行粘成一个词（`Cortex-A756x` 其实是 `Cortex-A75` + `6x …`），
         所以先把 <br> 换成可见分隔符再取文本。 */
      const cell = $(tds[1]).clone();
      cell.find('br').replaceWith(' / ');
      const v = cell.text().replace(/\s+/g, ' ').replace(/\s*\/\s*/g, ' / ').trim();
      if (k && v) items.push({ k, v });
    });
    if (items.length) groups.push({ name: h3, items });
  });
  return { title, groups };
}

/** 从解析结果里挑几个「一眼能看懂」的要点，给卡片摘要用 */
const DIGEST_MAP = [
  ['芯片组', 'soc'], ['图形处理器 (GPU)', 'gpu'], ['CPU 核心数', 'cores'],
  ['微架构', 'arch'], ['运行内存 (RAM)', 'ram'], ['屏幕尺寸', 'screen'],
  ['屏幕刷新率', 'hz'], ['电池容量', 'battery'], ['操作系统', 'os'],
];
function digestGroups(groups) {
  const flat = new Map();
  for (const g of groups || []) for (const it of g.items) if (!flat.has(it.k)) flat.set(it.k, it.v);
  const out = [];
  for (const [label, key] of DIGEST_MAP) {
    const v = flat.get(label);
    if (v) out.push({ key, label, value: v });
  }
  return out;
}

/* ---------- 选最优命中 ---------- */
/**
 * 在搜索结果里挑与本机最像的一条。
 *
 * ⚠️ 别写成「完全相等 > 前缀 > 包含 > 第一条」就完事 —— **结果名带品牌前缀、查询词往往不带**：
 *   查询 `POCO F7`，结果 `Xiaomi Poco F7` / `Xiaomi Poco F7 Pro`，
 *   三者归一后谁都不等于谁、也不是谁的前缀，于是全部落到「包含」分支，
 *   **谁先返回谁赢** —— 顺序一变就挑中 `F7 Pro`（实测踩过：F7 返回体里排第一才没露馅）。
 *   所以：① 比之前先剥掉结果名的品牌前缀；② 同为「包含」时取**归一后最短**的那个
 *   （`pocof7` 比 `pocof7pro` 短 → 选 F7）。
 */
const PICK_BRAND = /^(xiaomi|redmi|poco|samsung|huawei|honor|oppo|oneplus|realme|vivo|iqoo|nubia|zte|lenovo|meizu|sony|google|asus|motorola|nokia|nothing|tecno|infinix|itel|tcl|sharp|lg|htc|blackview|oukitel|umidigi|oscal|ulefone|doogee|alcatel)/;
function stripBrandKey(n) { return n.replace(PICK_BRAND, ''); }

function pickBest(results, want) {
  if (!results || !results.length) return null;
  const w = mkey(want);
  if (!w) return results[0];
  let exact = null, prefix = null, contains = null, containsLen = Infinity;
  for (const r of results) {
    const n = mkey(r.name);
    if (!n) continue;
    const nb = stripBrandKey(n);                       // 剥品牌前缀后再比
    if (n === w || nb === w) { exact = exact || r; continue; }
    if (n.startsWith(w) || w.startsWith(nb) || nb.startsWith(w) || n.startsWith(nb)) { prefix = prefix || r; continue; }
    if (n.includes(w) || w.includes(n) || nb.includes(w) || w.includes(nb)) {
      if (nb.length < containsLen) { contains = r; containsLen = nb.length; }
    }
  }
  return exact || prefix || contains || results[0];
}

/** 查询串降级：去掉尾部的规格词（5G / 4G / LTE 等）再搜一次 */
function relaxQuery(q) {
  return String(q || '').replace(/\s+(5G|4G|LTE|Plus|Pro|Max|Ultra)\s*$/i, '').trim();
}

/* ---------- 对外主入口 ---------- */
/**
 * 取一台设备的硬件参数（带缓存；缓存未命中时实时抓并落盘）
 * @param {string} name 型号名，如 "POCO F7" / "moto g45"（不要传内部代号，搜不到）
 * @param {{force?:boolean, offline?:boolean}} opt
 * @returns {{ok:boolean, name:string, slug?:string, groups?:Array, digest?:Array, cached?:boolean, reason?:string}}
 */
function hardware(name, opt = {}) {
  const key = ckey(name);          // ★ v10.18：用保留标点的原文键，别用 mkey（见上面注释）
  if (!key) return { ok: false, name: name || '', reason: 'empty' };
  const c = cache();
  const hit = c.items[key];
  if (!opt.force && hit) {
    const age = Date.now() - (hit.ts || 0);
    if (hit.ok && age < TTL) return { ...hit, cached: true };
    if (!hit.ok && age < TTL_MISS) return { ...hit, cached: true };
  }
  if (opt.offline) return hit ? { ...hit, cached: true } : { ok: false, name, reason: 'offline-miss' };

  let results = searchMarket(name);
  if (!results.length) {
    const alt = relaxQuery(name);
    if (alt && alt !== name) results = searchMarket(alt);
  }
  const best = pickBest(results, name);
  if (!best || !best.slug) {
    const rec = { ts: Date.now(), ok: false, name, reason: 'not-found' };
    cachePut(key, rec);
    return rec;
  }
  const html = curlText(`${HOST}/${best.slug}`);
  const parsed = parseSpecs(html);
  if (!parsed || !parsed.groups.length) {
    const rec = { ts: Date.now(), ok: false, name, slug: best.slug, reason: 'parse-empty' };
    cachePut(key, rec);
    return rec;
  }
  const rec = {
    ts: Date.now(), ok: true,
    name: parsed.title || best.name,
    slug: best.slug,
    url: `${HOST}/${best.slug}`,
    groups: parsed.groups,
    digest: digestGroups(parsed.groups),
  };
  cachePut(key, rec);
  return rec;
}

/** 缓存统计（给 /api 用，也方便自查覆盖率） */
function stats() {
  const c = cache();
  const all = Object.values(c.items || {});
  return {
    builtAt: c.builtAt,
    total: all.length,
    ok: all.filter((x) => x.ok).length,
    miss: all.filter((x) => !x.ok).length,
    file: path.relative(ROOT, CACHE_FILE),
  };
}

module.exports = { hardware, searchMarket, parseSpecs, digestGroups, pickBest, relaxQuery, stats, mkey, CACHE_FILE, TTL, TTL_MISS };
