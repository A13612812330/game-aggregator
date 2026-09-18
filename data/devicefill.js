/* data/devicefill.js —— 机型「芯片」补全：三级降级，能本地解决的绝不上网
 *
 * 背景（v10.18）：详情页机型清单要求每台都显示「品牌 + 型号 + 芯片」，但实测
 *   全库 1,048 台机型里 **18 台（1.7%）** 拿不到芯片。看这 18 台才发现它们不是
 *   同一类问题，一刀切「全部联网」既慢又多半白跑：
 *
 *   ┌ A 串内芯片   `Odin2 QCS8550` / `T10Plus T606` / `A266M s5e8825` / `W09 Maleoon 920C`
 *   │              → 上游没给 GPU，但**芯片号就写在机型串里** ⇒ 本地解析，0 网络
 *   ├ B 代号写法   `SM S711B`（空格）应为 `SM-S711B` → MobileModels 能译成
 *   │              `Samsung Galaxy S23 FE` ⇒ 本地归一，0 网络（但芯片仍需 C 步）
 *   └ C 真没收录   `Honor Magic8 Lite` / `Honor Magic7 Lite` / `motorola moto g(20)`
 *                  → 本地全空 ⇒ **联网** kalvo 取 芯片组/GPU（实测三家全中）
 *
 *   三级全落空（如 `itel S666LN`）就**如实返回空**，前端显示「未收录」—— 不编造。
 *
 * ⚠️ kalvo **只认营销名、不认内部代号**（`MTN-NX3` 搜出 0 条），所以 C 步必须传
 *    A/B 步译出来的**型号名**，绝不能把原始代号丢过去。
 * ⚠️ 抓 kalvo 必须 `execFileSync('curl')`（node fetch/https 一律 403），这是全项目共识。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/** 缓存文件。`DEVICEFILL_CACHE` 是给回归测试用的隔离出口（不设就走正式文件） */
const FILE = process.env.DEVICEFILL_CACHE || path.join(__dirname, 'device-fill.json');
const TOKENS = path.join(__dirname, 'chip-tokens.json');

/** 命中缓存 30 天、未命中 3 天 —— 与 devicespec 同一套口径（未命中更该重试） */
const TTL_HIT = 30 * 24 * 3600 * 1000;
const TTL_MISS = 3 * 24 * 3600 * 1000;

let _cache = null;
let _dirty = false;

/* ------------------------------------------------------------------ 缓存 */

function load() {
  if (_cache) return _cache;
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    _cache = (j && j.items && typeof j.items === 'object') ? j : { builtAt: 0, items: {} };
  } catch (e) {
    /* 首次运行文件不存在是正常的；其它错误要吼一声，否则「库空了」零报错 */
    if (e.code !== 'ENOENT') console.error('[devicefill] 缓存读取失败', e.message);
    _cache = { builtAt: 0, items: {} };
  }
  return _cache;
}

/**
 * 落盘。⚠️ 这里曾经写成 `if (_writes < 3) flush()` 想做「同一 tick 合并写」的节流，
 * 结果是个**静默丢数据**的坑：一个进程里只有前 3 次 put 会落盘，其余全丢在内存里
 * （实测批量联网 12 台 → 磁盘只剩 3 条，重启后 9 条白跑一遍网络）。
 * 改成与 `devicespec.js` **同一套模式**（`_dirty` + 写穿）：一个语义只留一种写法。
 * 条目量级是几百条、文件几十 KB，写穿的代价可以忽略。
 */
function flush(force) {
  if (!_dirty && !force) return;
  const c = load();
  c.builtAt = Date.now();
  try { fs.writeFileSync(FILE, JSON.stringify(c)); _dirty = false; }
  catch (e) { console.error('[devicefill] 缓存写入失败', e.message); }
}

function put(raw, rec) {
  load().items[raw] = Object.assign({ at: Date.now() }, rec);
  _dirty = true;
  flush();
}

function cached(raw) {
  const it = load().items[raw];
  if (!it) return null;
  const ttl = it.chip ? TTL_HIT : TTL_MISS;
  if (Date.now() - (it.at || 0) > ttl) return null;
  return it;
}

function stats() {
  const c = load();
  const all = Object.values(c.items);
  return {
    builtAt: c.builtAt, total: all.length,
    withChip: all.filter((x) => x.chip).length,
    fromOnline: all.filter((x) => x.chipSrc === 'kalvo').length,
    miss: all.filter((x) => !x.chip).length,
    file: 'data/device-fill.json',
  };
}

/* --------------------------------------------------- ① 串内芯片号 → 芯片 */

/** 归一芯片号：大写、去分隔符（`Mali-G57 MP1`→`MALIG57MP1`、`s5e8825`→`S5E8825`） */
const tokKey = (s) => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');

let _tokIdx = null;
/** 从**现有数据**建「芯片号 → {soc, gpu, vendor}」索引；只剩两张官方 part number 靠手工表 */
function tokenIndex() {
  if (_tokIdx) return _tokIdx;
  const idx = {};
  /* 同一个 GPU 名被几个不同 SoC 用过 —— `Mali-G57` 这种家族名被几十颗 SoC 共用，
     若按「GPU 名反查 SoC」就会给出一颗**具体但很可能错**的 SoC（实测 `Mali-G57 MP1`
     被撞成 `Dimensity 7025`）。所以只在「GPU 名唯一归属某颗 SoC」时才敢报 SoC。
     ⚠️ 必须按**基名**统计：`Mali-G57 MP1` 与 `Mali-G57 MC2` 的归一键不同（`MALIG57MP1`
     vs `MALIG57MC2`），只按全名统计会各算 1 个归属、护栏永远不触发。 */
  const gpuOwners = new Map();
  const noteGpu = (gpu, soc) => {
    const full = tokKey(gpu);
    if (full.length < 3 || !soc) return;
    const base = full.replace(/(MP|MC)\d+$/, '');
    for (const n of new Set([full, base])) {
      if (!gpuOwners.has(n)) gpuOwners.set(n, new Set());
      gpuOwners.get(n).add(soc);
    }
  };
  const add = (k, v, viaGpu) => {
    const n = tokKey(k);
    if (n.length < 3) return;
    if (!idx[n]) idx[n] = Object.assign({ viaGpu: !!viaGpu }, v);
  };

  try {
    /* gpu-soc：url 末段就是厂家-型号 slug（`/en/soc/unisoc-t606`），且带 GPU */
    const gs = require('./gpu-soc.json');
    for (const x of gs.list || []) {
      noteGpu(x.gpu, x.name);
      const slug = String(x.url || '').split('/').filter(Boolean).pop() || '';
      const parts = slug.split('-').filter(Boolean);
      for (let i = 1; i < parts.length; i++) {
        add(parts.slice(i).join(''), { soc: x.name, gpu: x.gpu || '', vendor: x.vendor || '' }, false);
      }
      add(slug.replace(/^[a-z]+-/, ''), { soc: x.name, gpu: x.gpu || '', vendor: x.vendor || '' }, false);
    }
    /* soc-db：`chips` 是**数组**（1444 条），不是对象 —— 第一版按对象遍历，索引全空，
       结果 `MALLOON920C` 怎么都查不到（soc-db 的 `kirin8020` 明明写着 gpu=Maleoon 920C）。 */
    const db = require('./soc-db.json');
    for (const c of db.chips || []) {
      const v = { soc: c.name || '', gpu: c.gpu || '', vendor: c.vendor || '' };
      noteGpu(c.gpu, c.name);
      if (c.id) add(c.id, v, false);
      if (c.model) add(c.model, v, false);
      if (c.name) add(c.name, v, false);
      if (c.gpu) add(c.gpu, Object.assign({}, v), true);
    }
  } catch (e) { console.error('[devicefill] 建芯片号索引失败', e.message); }

  try {
    const manual = JSON.parse(fs.readFileSync(TOKENS, 'utf8'));
    for (const k of Object.keys(manual)) {
      if (k.startsWith('_')) continue;
      idx[tokKey(k)] = Object.assign({}, manual[k], { manual: true });
    }
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[devicefill] chip-tokens 读取失败', e.message);
  }

  /* 后处理：GPU 名有多个归属 → 只报 GPU，不报 SoC（宁少不错） */
  for (const n of gpuOwners.keys()) {
    const owners = gpuOwners.get(n);
    const hit = idx[n];
    if (hit && owners.size > 1) { delete idx[n].soc; idx[n].ambiguousGpu = owners.size; }
  }

  _tokIdx = idx;
  return idx;
}

/** 查一个芯片号（`t606` / `SM8650` / `MALLOON920C`） */
function chipByToken(tok) {
  const k = tokKey(tok);
  if (k.length < 3) return null;
  return tokenIndex()[k] || null;
}

/**
 * 从机型串尾部抠出可能的芯片号并查表。
 * `Odin2 Portal QCS8550` → QCS8550；`A266M s5e8825` → s5e8825；`T10Plus T606` → T606
 *
 * 从**右往左**扫，命中即返回（芯片号几乎总在末尾，前面的多半是机型名）。
 * ⚠️ 有些芯片号**本身带空格**（`Maleoon 920C` / `Mali-G57 MP1`），只试单个 token
 *    会漏，所以还要试「相邻 2~3 个 token 拼起来」。
 */
function chipFromString(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const parts = s.split(/[\s/|,，+]+/).filter(Boolean);
  for (let i = parts.length - 1; i >= 0 && i >= parts.length - 3; i--) {
    const hit = chipByToken(parts[i]);
    if (hit && (hit.soc || hit.gpu)) return Object.assign({ token: parts[i] }, hit);
  }
  /* 多词芯片号：从尾部拼 2~3 个 token 再试（`Maleoon 920C` 走这里） */
  for (let n = 2; n <= 3; n++) {
    if (parts.length < n) break;
    const joined = parts.slice(-n).join('');
    const hit = chipByToken(joined);
    if (hit && (hit.soc || hit.gpu)) return Object.assign({ token: parts.slice(-n).join(' '), joined: true }, hit);
  }
  /* 整串当一个号（`SM8650` 这种），但要求长度够，免得把机型名当芯片号 */
  if (tokKey(s).length >= 5) {
    const hit = chipByToken(s);
    if (hit && (hit.soc || hit.gpu)) return Object.assign({ token: s }, hit);
  }
  return null;
}

/* ----------------------------------------------- ② 代号归一 + 本地库查询 */

/** `SM S711B` → `SM-S711B`；`HONOR MTN NX3` 不强改（品牌靠 resolve 剥） */
function normalizeCode(raw) {
  let s = String(raw || '').trim();
  /* 已知前缀后面被写成空格：SM / SM- / SC / SH / XT / LG 等 */
  s = s.replace(/^(SM|SC|SH|SCH|SPH|SGH|SAMSUNG)\s+/i, (m) => m.trim().toUpperCase() + '-');
  /* `MTN NX3` / `BRP NX3` 这类「字母块 + 空格 + 字母数字块」补回连字符 */
  s = s.replace(/^([A-Z]{2,4})\s+([A-Z]{1,3}\d[A-Z0-9]*)$/i, '$1-$2');
  return s.replace(/\s{2,}/g, ' ').trim();
}

let _dm = null, _dmk = null;
function deps() {
  if (!_dm) _dm = require('./device-match');
  if (!_dmk) _dmk = require('./devicemarket');
  return { dm: _dm, dmk: _dmk };
}

/** 本地查芯片：配对索引 → 串内芯片号 → 全空 */
function fillLocal(raw) {
  const { dm, dmk } = deps();
  const input = String(raw == null ? '' : raw).trim();
  if (!input) return { m: '', name: '', chip: '', chipSrc: '', gpu: '', soc: '', online: false };

  const mk = dmk.resolve(input);
  const name = mk.display || input;

  /* 查配对索引（先原串、再归一后的代号 —— `SM S711B` 就是靠这一步救回来的） */
  const tries = [input];
  const norm = normalizeCode(input);
  if (norm !== input) tries.push(norm);
  if (mk.resolved && mk.market) tries.push(mk.market);
  for (const q of tries) {
    let r = null;
    try { r = dm.findDevice(q); } catch (e) { r = null; }
    if (r && (r.soc || r.gpu)) {
      return {
        m: input, name, chip: r.soc || r.gpu, soc: r.soc || '', gpu: r.gpu || '',
        chipSrc: 'pair', approx: !!r.approx,
        code: mk.resolved ? mk.code : '', market: mk.market || '', resolved: !!mk.resolved,
        online: false,
      };
    }
  }

  /* 配对索引没有 → 串内芯片号（这一步是新加的，专治 `Odin2 QCS8550` 这类） */
  const tk = chipFromString(input);
  if (tk) {
    return {
      m: input, name, chip: tk.soc || tk.gpu, soc: tk.soc || '', gpu: tk.gpu || '',
      chipSrc: 'token', token: tk.token,
      code: mk.resolved ? mk.code : '', market: mk.market || '', resolved: !!mk.resolved,
      online: false,
    };
  }

  return {
    m: input, name, chip: '', soc: '', gpu: '', chipSrc: '',
    code: mk.resolved ? mk.code : '', market: mk.market || '', resolved: !!mk.resolved,
    online: false,
  };
}

/* --------------------------------------------------- ③ 联网（kalvo 兜底） */

/**
 * kalvo 搜不到的写法要先整理。⚠️ 这里踩过一个**真配错**，规则不能想当然：
 *
 *   `motorola moto g(20)` 第一版把括号整段删掉 → 查询词退化成 `moto g`
 *   → kalvo 匹配到 `Motorola Moto G (2022)`（**另一台手机**，Dimensity 700）。
 *
 *   所以括号要分两类：
 *     · 内容是**短的字母数字**（`20` / `2a` / `2023`）→ 那是型号本身，去括号但**留下内容**
 *       （同时给出「连写」与「空格」两种写法：`moto g20` 与 `moto g 20`）
 *     · 其余（`国际版本` / 别名清单）→ 整段丢
 */
function relaxQueries(name) {
  const out = [];
  const push = (v) => {
    const s = String(v == null ? '' : v).trim().replace(/\s{2,}/g, ' ');
    if (s && !out.includes(s)) out.push(s);
  };
  const raw = String(name == null ? '' : name).trim();
  /* `sep=''` 连写（`moto g20`）、`sep=' '` 空格（`Nothing Phone 2a`）—— 两种都试，
     连写更像官方写法，排前面 */
  const withKeep = (sep) => raw
    .replace(/[(（]\s*([0-9A-Za-z][0-9A-Za-z +]{0,5})\s*[)）]/g, (m, c) => sep + c + sep)
    .replace(/[(（][^)）]*[)）]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  push(withKeep(''));                                  // `motorola moto g(20)` → `motorola moto g20`
  push(withKeep(' '));                                 // → `motorola moto g 20`
  push(out[0] && out[0].replace(/\s+(5G|4G|LTE)$/i, ''));
  push(raw);
  /* 品牌词重复时剥掉重复的那一节：`Honor HONOR Magic8 Lite` → `Honor Magic8 Lite` */
  const w = (out[0] || raw).split(/\s+/);
  if (w.length > 2 && w[0].toLowerCase() === w[1].toLowerCase()) push(w.slice(1).join(' '));
  return out;
}

const nameNorm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
const nameToks = (s) => String(s == null ? '' : s)
  .split(/[\s/|,，+()（）\-–—]+/).map((t) => t.trim()).filter((t) => /[a-z0-9\u4e00-\u9fa5]/i.test(t));

/** 常见手机品牌。**表外的词一律当作「认不出」**，不参与否决 —— 宁可放过，也不误杀表外的小众品牌。 */
const BRANDS = new Set(`
  samsung xiaomi redmi poco honor huawei motorola nokia sony asus acer lenovo meizu nubia
  zte tecno infinix itel oppo vivo realme oneplus google apple lg htc sharp aquos tcl
  alcatel blackview ulefone doogee cubot oukitel umidigi nothing fairphone vertu energizer
  wiko lava micromax karbonn panasonic fujitsu kyocera crosscall gigaset doro archos
  coolpad gionee smartisan leeco zopo elephone hotwav blu cricket
`.trim().split(/\s+/));
/** 简称先归到正式品牌名再比交集（`motorola moto g20` ↔ `Motorola Moto G20`） */
const BRAND_ALIAS = { moto: 'motorola', motorolla: 'motorola', mi: 'xiaomi', pocophone: 'poco' };
/** 认得出几个品牌（`Xiaomi POCO F7` → {xiaomi, poco}；认不出 → 空集） */
function brandSet(s) {
  const out = new Set();
  for (const t of nameToks(s)) {
    const n = BRAND_ALIAS[nameNorm(t)] || nameNorm(t);
    if (BRANDS.has(n)) out.add(n);
  }
  return out;
}

/**
 * 搜到的结果**是不是同一台**（防跨源误配，见 skill `cross-source-name-matching`）。
 *
 * v10.18 加固（原来只有「末位 token 子串命中」一条，**太松**）：
 *   实测 `ZTE Blade A73` 被 kalvo 的 `Samsung Galaxy A73` 判成了同一台 —— 因为 `a73`
 *   只是结果的**子串**。更早还踩过 `Moto G (2022)` 含 `g20` 三个字符于是冒充 `Moto G20`。
 *   所以改成三道闸，任何一道不过就否决：
 *
 *   ① **品牌冲突一票否决**：两边都认得出品牌、且没有交集 → 一定是别的牌子。
 *   ② **长词（≥4 字符、非品牌）必须全部出现**：`Blade` / `Note` 这种最有区分度的词
 *      一旦对不上，就不是同一台。
 *   ③ **末位 token（型号号 `g20` / `F7`）**：≥4 字符允许子串；≤3 字符必须**整词相等**，
 *      因为短串太容易蒙中（`g20` 会命中 `G (2022)`）。
 */
function plausible(q, matched) {
  const m = nameNorm(matched);
  if (!m) return false;
  const t = nameToks(q);
  if (!t.length) return false;

  const qb = brandSet(q), mb = brandSet(matched);
  if (qb.size && mb.size && ![...qb].some((b) => mb.has(b))) return false;   // ①

  const isBrand = (x) => BRANDS.has(BRAND_ALIAS[x] || x);
  const longs = t.map(nameNorm).filter((x) => x.length >= 4 && !isBrand(x));
  if (longs.some((x) => !m.includes(x))) return false;                        // ②

  const last = nameNorm(t[t.length - 1]);
  if (last.length >= 4) return m.includes(last);                              // ③
  if (last.length >= 2) {
    const mset = new Set(nameToks(matched).map(nameNorm));
    if (mset.has(last)) return true;
  }
  /* 末位 token 对不上就**否决**，不再退到「某个长词命中」的兜底：
     那条兜底等于「型号号错了也认」，实测会让 `Wiko Power U30` 认成 `Power U20`。
     宁可退回「未收录」（不编造），也不安一个错的芯片。 */
  return false;
}

/** 太泛的查询词（`moto g` —— alnum 只有 5 个字符）宁可不用：它会把别台手机匹配进来 */
const tooGeneric = (q) => nameNorm(q).length < 6;

/**
 * kalvo 的 soc 值常是**多地区版本**串，末尾会留下悬空分隔符：
 *   `Samsung Exynos 2200 (国际版本) / Qualcomm Snapdragon 8 Gen 1 (美国) /`
 *   → 那个尾巴 `/` 会原样进徽标的 title，读起来像没写完。清掉首尾分隔符。
 */
const tidyVal = (s) => String(s == null ? '' : s)
  .replace(/^[\s/、,，;；|]+/, '').replace(/[\s/、,，;；|]+$/, '')
  .replace(/\s{2,}/g, ' ').trim();
/** 出口统一清洗：chip / soc / gpu 三个值都过一遍（缓存命中与新鲜结果走同一条路） */
function clean(r) {
  if (!r) return r;
  const soc = tidyVal(r.soc), gpu = tidyVal(r.gpu);
  const chip = tidyVal(r.chip) || soc || gpu;
  return Object.assign({}, r, { soc, gpu, chip });
}

let _ds = null;
/**
 * 联网取芯片。返回 null 表示 kalvo 也没有（或**匹配结果不可信**）—— 调用方必须如实标「未收录」。
 * @param {string} name 营销名（不是内部代号）
 */
async function fillOnline(name) {
  if (!_ds) _ds = require('./devicespec');
  const cands = relaxQueries(name);
  /* 泛查询词排在后面；万一全是泛的（短名），也别一个都不试 */
  const ordered = cands.filter((q) => !tooGeneric(q)).concat(cands.filter(tooGeneric));
  for (const q of ordered) {
    let r = null;
    try { r = await _ds.hardware(q); } catch (e) { r = null; }
    if (!r || !r.ok) continue;
    /* 结果名与查询词对不上 → 判为误配，**换下一个查询词**，绝不把这个芯片安上去 */
    if (!plausible(q, r.name)) continue;
    const d = Array.isArray(r.digest) ? r.digest : [];
    const get = (k) => { const x = d.find((i) => i.key === k); return (x && x.value) || ''; };
    const soc = tidyVal(get('soc')), gpu = tidyVal(get('gpu'));
    if (soc || gpu) {
      return { chip: soc || gpu, soc, gpu, matched: r.name || q, query: q, url: r.url || '' };
    }
  }
  return null;
}

/** 单台补全：本地优先，必要时联网；结果落盘 */
async function fill(raw, opt = {}) {
  const online = opt.online !== false;
  const force = !!opt.force;
  const input = String(raw == null ? '' : raw).trim();
  if (!input) return { m: '', name: '', chip: '', chipSrc: '', online: false, fromCache: false };

  if (!force) {
    const c = cached(input);
    if (c) return clean(Object.assign({}, c, { fromCache: true }));
  }

  let r = fillLocal(input);

  /* 本地没芯片才联网（这是「能本地解决绝不上网」的闸门） */
  if (!r.chip && online) {
    const name = r.market || r.name || input;
    const on = await fillOnline(name);
    if (on) {
      r = Object.assign({}, r, { chip: on.chip, soc: on.soc, gpu: on.gpu, chipSrc: 'kalvo', online: true, matched: on.matched, query: on.query });
    } else {
      r.online = true;          // 试过了（用于区分「没试」和「试了没有」）
      r.tried = true;
    }
  }

  r = clean(r);
  put(input, {
    name: r.name, chip: r.chip, soc: r.soc || '', gpu: r.gpu || '',
    chipSrc: r.chipSrc, code: r.code || '', market: r.market || '',
    resolved: !!r.resolved, matched: r.matched || '', query: r.query || '',
  });
  return Object.assign({}, r, { fromCache: false });
}

/** 批量补全（默认串行 3 并发；kalvo 是正常站点，不打它） */
async function batch(list, opt = {}) {
  const arr = (list || []).map((x) => String(x || '').trim()).filter(Boolean).slice(0, opt.limit || 60);
  const conc = Math.max(1, Math.min(4, opt.concurrency || 3));
  const out = {};
  let i = 0;
  async function worker() {
    while (i < arr.length) {
      const k = arr[i++];
      try { out[k] = await fill(k, opt); }
      catch (e) { out[k] = { m: k, name: k, chip: '', chipSrc: '', error: e.message }; }
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));
  return out;
}

/** 只做本地（同步、绝不打网络）—— 列表首屏用它，联网那批再单独异步补 */
function localBatch(list) {
  const out = {};
  for (const x of list || []) { const k = String(x || '').trim(); if (k) out[k] = fillLocal(k); }
  return out;
}

module.exports = {
  fill, batch, fillLocal, localBatch, fillOnline,
  chipByToken, chipFromString, normalizeCode, relaxQueries, plausible,
  tidyVal, brandSet, stats, load, flush, FILE,
  _setCache: (o) => { _cache = o; },
};
