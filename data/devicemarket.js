/* data/devicemarket.js —— 把「内部代号」翻成「品牌 + 型号」
 *
 * 数据来自 tools/fetch-device-market.js 生成的 data/device-market.json
 * （源头 GitHub khwang9883/MobileModels，MIT）。
 *
 * 解决的问题（用户原话）：
 *   「Xiaomi 25053PC47G Snapdragon 8s Gen 4 → 显示 xiaomi Poco F7」
 *   社区库里的机型名一半是内部代号（`Xiaomi 2412DPC0AG`），玩家根本认不出是哪台手机。
 *
 * 解析顺序（命中即停，都记下走了哪一步 —— 前端要按可信度区分展示）：
 *   ① 整串归一        `25053PC47G`            → 精确
 *   ② 去品牌前缀      `Xiaomi 25053PC47G` → `25053PC47G`
 *   ③ 逐词尝试        `SM S928B` → `S928B`（三星喜欢用空格不用连字符）
 *   ④ 都失败 → 判定它**本来就是营销名**（如 `motorola moto g45 5G`），
 *      只做「重复品牌词去重 + 大小写规整」，标 resolved=false（没译出代号，不冒充译出）
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'device-market.json');

/* 品牌前缀：只用于「剥掉再去查码」，不用于展示 */
const BRAND_PREFIX = /^(xiaomi|redmi|poco|samsung|sm|huawei|honor|oppo|oneplus|realme|vivo|iqoo|nubia|zte|lenovo|meizu|sony|google|asus|rog|blackshark|black shark|nokia|nothing|motorola|moto|tecno|infinix|itel|lg|htc|sharp|tcl|ulefone|umidigi|oukitel|doogee|blackview|oscal|hisense|smartisan|coolpad|letv|fairphone|panasonic|fujitsu|kyocera|ayaneo|ayn|retroid|moorechip|gpd|anbernic|powkiddy)\s+/i;

/* 品牌展示名规整（把库里的各种写法收敛到一个） */
const BRAND_FIX = [
  [/^xiaomi$/i, 'Xiaomi'], [/^redmi$/i, 'Xiaomi'], [/^poco$/i, 'Xiaomi'],
  [/^samsung$/i, 'Samsung'], [/^huawei$/i, 'Huawei'], [/^honor$/i, 'Honor'],
  [/^oppo$/i, 'OPPO'], [/^oneplus$/i, 'OnePlus'], [/^realme$/i, 'realme'],
  [/^vivo$/i, 'vivo'], [/^iqoo$/i, 'iQOO'], [/^nubia$/i, 'nubia'], [/^zte$/i, 'ZTE'],
  [/^lenovo$/i, 'Lenovo'], [/^meizu$/i, 'Meizu'], [/^sony$/i, 'Sony'],
  [/^google$/i, 'Google'], [/^asus$/i, 'ASUS'], [/^motorola$/i, 'Motorola'],
  [/^nokia$/i, 'Nokia'], [/^nothing$/i, 'Nothing'], [/^black shark$/i, 'Black Shark'],
];
function fixBrand(b) {
  const s = String(b || '').trim();
  for (const [re, v] of BRAND_FIX) if (re.test(s)) return v;
  return s;
}

/** 归一码：大写 + 只留字母数字（`SM-S928B` / `SM S928B` / `sms928b` → `SMS928B`） */
const codeKey = (s) => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
/** 归一名字（用于市场名比对） */
const nameKey = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');

/** 剥掉开头的品牌前缀：`HONOR MTN-NX3` → `MTN-NX3`、`Xiaomi 25053PC47G` → `25053PC47G`
 *  ★ v10.17：对外导出。机型串在不同数据链路里的写法不同（社区库摘要 `MTN NX3` / 逐条配置
 *  `HONOR MTN-NX3`），要按「剥了品牌前缀再归一」才能认出是同一台 —— 这张表必须**只有一份**，
 *  否则两条链路各写一套规则，界面上又会出现「同一台手机两个名字」。
 *  （`data/deviceset.js` 的 devKey 复用它，别在那边重写。） */
function stripBrand(s) { return String(s == null ? '' : s).replace(BRAND_PREFIX, '').trim(); }

let _db = null;
function load() {
  if (_db) return _db;
  try { _db = JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch (e) { _db = { byCode: {}, byMarket: {}, stats: {} }; }
  if (!_db.byCode) _db.byCode = {};
  if (!_db.byMarket) _db.byMarket = {};
  return _db;
}

/** 短码黑名单：这些码含义太泛，命中也不可信（`M8` / `A1` 之类跨品牌撞车） */
function tooShort(code, raw) {
  if (code.length >= 4) return false;
  /* 原始串本来就短（如 `M8`）就当它是完整码，放过 */
  return !(String(raw).trim().length <= code.length + 1);
}

/** 市场名里常有「地区/版本并列」写法（`红魔 11S Pro / 红魔 11S Pro+`），
 *  展示时取第一段，完整串留在 market 里备查 */
function shortMarket(m) {
  const s = String(m || '').trim();
  if (!s) return '';
  const first = s.split(/\s*\/\s*/)[0].trim();
  return first || s;
}

/**
 * 把库里的 market 收拾成「可以直接拼在品牌后面」的样子。
 * ★ v10.17：修两类显示瑕疵（实拍里都出现过）：
 *   ① **品牌词重复**：MobileModels 的 market 自带品牌词（`HONOR Magic8 Lite`），
 *      再拼上 brand 就成了 `Honor HONOR Magic8 Lite`。→ market 开头的品牌词剥掉。
 *   ② **内部代号泄漏**：`Redmi Note 11 Pro+ (pissarro)` 把 codename 印给了用户。
 *      → 尾部括号里是「小写字母开头的短串」（内部代号惯例）时剥掉；
 *        `(2023)` 这种以数字开头的**不动**（那是型号的一部分）。
 */
function tidyMarket(market, brand, codename) {
  let s = shortMarket(market);
  if (!s) return '';
  /* ② 尾部括号：优先按已知 codename 精确剥，再兜底「小写开头短串」
     ⚠️ 库里的写法带反引号（`` Redmi Note 11 Pro+ (`pissarro`) ``），
     所以括号内允许包一层 ` 或 ' 或 " —— 第一版没允许，`(`pissarro`)` 剥不掉。 */
  const tail = (re) => { s = s.replace(re, '').trim(); };
  if (codename) {
    const cn = String(codename).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('\\s*[\\(（]\\s*[`\'"]?\\s*' + cn + '\\s*[`\'"]?\\s*[\\)）]\\s*$', 'i');
    if (re.test(s)) tail(re);
  }
  tail(/\s*[\(（]\s*[`'"]?\s*[a-z][a-z0-9_\- ]{2,19}\s*[`'"]?\s*[\)）]\s*$/);
  /* ① 开头的品牌词（含多词品牌，如 `Black Shark`）：与 brand 同名才剥 */
  const b = String(brand || '').trim();
  if (b && s.toLowerCase().startsWith(b.toLowerCase())) {
    const rest = s.slice(b.length).trim();
    if (rest) s = rest;
  }
  return s;
}

/**
 * 解析一个机型名
 * @returns {{ raw, display, brand, market, codename, variant, code, via, resolved }}
 *   display 是给前端直接显示的「品牌 + 型号」；resolved=false 表示没译出代号，只是清理了名字
 */
function resolve(raw) {
  const db = load();
  const input = String(raw == null ? '' : raw).trim();
  if (!input) return { raw: '', display: '', brand: '', market: '', code: '', via: 'empty', resolved: false };

  const stripped = input.replace(BRAND_PREFIX, '').trim();
  const cands = [];
  const push = (v) => { const k = codeKey(v); if (k && !cands.some((c) => c.code === k)) cands.push({ code: k, from: v }); };
  push(input);                       // ①
  push(stripped);                    // ②
  for (const t of stripped.split(/\s+/)) push(t);   // ③

  for (const c of cands) {
    if (c.code.length < 2) continue;
    if (tooShort(c.code, input)) continue;
    const rec = db.byCode[c.code];
    if (!rec) continue;
    const brand = fixBrand(rec.brand);
    const market = rec.market;
    const short = tidyMarket(market, brand, rec.codename);
    return {
      raw: input,
      brand,
      market,
      short,
      display: [brand, short].filter(Boolean).join(' '),
      codename: rec.codename || '',
      variant: rec.variant || '',
      code: c.code,
      via: c.code === codeKey(input) ? 'exact' : (c.code === codeKey(stripped) ? 'strip-brand' : 'token'),
      resolved: true,
      file: rec.file || '',
    };
  }

  /* ④ 本来就是营销名：只清理重复品牌词（同样要去掉尾部泄漏的内部代号） */
  const cleaned = cleanMarketing(input);
  const rest = tidyMarket(cleaned.rest, cleaned.brand, '') || cleaned.rest;
  return {
    raw: input,
    brand: cleaned.brand,
    market: rest,
    short: rest,
    display: [cleaned.brand, rest].filter(Boolean).join(' ') || cleaned.display,
    codename: '', variant: '', code: '',
    via: 'as-is', resolved: false,
  };
}

/* 厂商全称里的公司词：社区库常把厂商登记成 `TECNO MOBILE LIMITED` / `INFINIX MOBILITY LIMITED`，
   于是机型名变成 `TECNO MOBILE LIMITED TECNO KG6k` —— 展示前要先剥掉 */
const COMPANY_WORDS = /\b(mobile\s+limited|mobility\s+limited|limited|corporation|communications?|electronics|technology|tech\s+co\.?,?\s*ltd\.?|co\.?\s*,?\s*ltd\.?)\b/gi;

/** 营销名清理：`motorola motorola edge 70 fusion plus` → `Motorola Edge 70 fusion plus`
 *            `TECNO MOBILE LIMITED TECNO KG6k` → `TECNO KG6k` */
function cleanMarketing(name) {
  let s = String(name || '').trim();
  s = s.replace(COMPANY_WORDS, ' ').replace(/\s+/g, ' ').trim();   // 先剥公司词
  const words = s.split(/\s+/).filter(Boolean);
  const out = [];
  for (const w of words) {
    if (out.length && out[out.length - 1].toLowerCase() === w.toLowerCase()) continue;  // 相邻重复词去掉
    out.push(w);
  }
  /* 去重后仍可能「品牌词 品牌词」，再做一次全局收敛 */
  let brand = '';
  if (out.length > 1 && out[0].toLowerCase() === out[1].toLowerCase()) out.splice(1, 1);
  const b = fixBrand(out[0] || '');
  if (b && BRAND_PREFIX.test(out[0] + ' ')) brand = b;
  const rest = (brand ? out.slice(1) : out).join(' ');
  const display = [brand, rest].filter(Boolean).join(' ') || out.join(' ');
  return { brand, rest, display };
}

/** 批量解析（给 /api/device/market 用，规避 N+1） */
function resolveMany(list) {
  const out = {};
  for (const n of list || []) out[n] = resolve(n);
  return out;
}

function stats() {
  const db = load();
  return { ...(db.stats || {}), builtAt: db.builtAt || 0, source: db.source || '' };
}

module.exports = { resolve, resolveMany, cleanMarketing, tidyMarket, fixBrand, codeKey, nameKey, stripBrand, stats, load, FILE };
