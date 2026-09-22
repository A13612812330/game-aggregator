/**
 * data/mobilehub.js — 「手游中心统一索引」读取与查询
 *
 * 数据来自 tools/build-mobilehub.js 产出的 data/mobilehub.json（惰性加载）。
 * 该索引把**社区配置库（BannerHub）**与**机型实测库（自建）**合并成一张表：
 *   · 同款游戏只占一条（按端游库命中 id 或归一化名归并）
 *   · 配置数累加（社区 N 套 + 实测 M 条）
 *   · 同时带实测帧率档与最佳帧率
 *   · 挂端游库匹配结果（libId/libTitle/libCover…），供详情跳转与默认过滤
 *
 * 对外只需要 list / stats / lookup 三个能力。
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'mobilehub.json');
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

/* ★ v10.36：归一化统一到唯一真源（原先本文件自带一份，与 phonecfg / build-mobilehub
 *   三份的字符类并不一致，且都漏剥商标号 `™®©` —— 见 data/name-normalize.js 文件头）。 */
const { normKey } = require('./name-normalize');

/* ================= ★ v10.14 GPU 脏值清洗 =================
 *
 *  症状：详情页「N 种 GPU 跑过」计数虚高，且把**驱动版本串当成 GPU 展示**。
 *  实测：3,170 条有 GPU 的条目里 **1,049 条（33%）混着脏值**，共 1,056 个。
 *
 *  脏值分四类（都是社区配置导出时把别的字段错填进 GPU 列）：
 *    ① 驱动版本串   turnip_v24.2.0_R22 ×693 / turnip-v24.3.0-R12 ×19 / vkpipe…
 *    ② 驱动构建号   8Elite-800.34 ×51（骁龙 8 Elite 的驱动 build，不是 GPU）
 *    ③ 包装器前缀   「ANGLE Samsung Xclipse 540 on Vulkan 1 3 279」×17 —— 芯片名在后面
 *    ④ 别的列串进来 「unknown」/「兼容模式」/「GPU驱动」/红米设备码 23053RN02A / 「Retroid Pocket 5」
 *
 *  ⚠️ 另有 SM8650 / MT6789 这类 **SoC 编号**（不是 GPU 名）也混进来 —— 直接剔除，
 *     不猜映射：机型那一列现在会带出真正的 SoC/CPU（见 v10.14 机型转译），
 *     在 GPU 列放一个 SoC 编号只会让人误读。
 *
 *  ⚠️ 清洗只在**读取层**做（不动 mobilehub.json）—— 这个文件由 build-mobilehub.js
 *     在线上重跑一次要很久，读取层清洗能立刻生效；同时 build 脚本也加了同一套规则，
 *     下次重建产物同样是干净的（两边共用本模块导出的 cleanGpuOne）。
 */
const GPU_FAMILY = /^(Adreno|Mali|Immortalis|PowerVR|Xclipse|Apple|Maleoon|Vega|Radeon|GeForce|Intel|Exynos|SGX|RDNA)/i;

function cleanGpuOne(g) {
  let s = String(g == null ? '' : g).trim();
  if (!s) return '';
  /* ① 驱动版本串 / 驱动实现名 */
  if (/^(turnip|vkpipe|zink|mesa|wined3d|d8vk|vkd3d)[-_ ]/i.test(s)) return '';
  /* ② 驱动构建号：8Elite-800.34 / 8Gen3-801.2 */
  if (/^[A-Za-z0-9]+-\d{3}\.\d{1,3}$/.test(s)) return '';
  /* ③ 丢弃标记词 */
  if (/^(unknown|n\/a|na|兼容模式|GPU驱动|GPU|驱动|默认|auto)$/i.test(s)) return '';
  /* ④ 红米/设备编号（23053RN02A / 2412DPC0AI） */
  if (/^\d{8,}[A-Za-z]*$/.test(s)) return '';
  /* ⑤ 设备名而非 GPU（Retroid Pocket 5 / AYN Odin3…） */
  if (/^(retroid|ayn|ayaneo|gpd|anbernic|powkiddy)/i.test(s)) return '';
  /* ⑥ ANGLE 包装：把里面的真芯片名抠出来（可能没有 → 丢）
   *   「ANGLE Samsung Xclipse 540 on Vulkan 1 3 279」            → Xclipse 540
   *   「ANGLE ARM Vulkan 1 3 278 Mali-G57 MC2 0x9093… -49 1 0」  → Mali-G57 MC2 */
  if (/^ANGLE\b/i.test(s)) {
    const m = s.match(/(Mali-G\d+[A-Za-z0-9]*(?:\s+MC\d+)?|Mali-[A-Za-z0-9-]+(?:\s+MC\d+)?|Adreno\s*\d+[A-Za-z]*|Xclipse\s*\d+|Immortalis(?:\s+MC\d+)?|PowerVR\s+[A-Za-z0-9-]+(?:\s+[A-Za-z0-9-]+)?)/i);
    s = m ? m[0].trim() : '';
    if (!s) return '';
  }
  /* ⑦ SoC 编号（SM8650 / MT6789 / MT6855V/AZA）—— 不是 GPU 名 */
  if (/^(SM|MT|SDM|MSM)\d/i.test(s)) return '';
  /* ⑧ 归一噪音：Adreno_814 → Adreno 814；(TM) → 去掉 */
  s = s.replace(/([A-Za-z])_+(\d)/g, '$1 $2').replace(/\s*\(TM\)\s*/gi, ' ').replace(/\s{2,}/g, ' ').trim();
  /* ⑨ 兜底：必须长得像 GPU 家族名，否则丢（宁可少一个，也不给假 GPU） */
  return GPU_FAMILY.test(s) ? s : '';
}

/** 清洗一组 GPU 值：去脏 + 去重 + 稳定排序前的保序去重 */
function cleanGpus(arr) {
  const out = [];
  for (const raw of Array.isArray(arr) ? arr : []) {
    const v = cleanGpuOne(raw);
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/* 读取层视图：按文件 mtime 缓存，只有真变了才重建（list 每次调用都过滤，不能每次 map） */
let view = null, viewMtime = -1;
function itemsView(d) {
  if (view && viewMtime === mtime) return view;
  view = (d.items || []).map((x) => {
    const g = cleanGpus(x.gpus);
    const same = g.length === (x.gpus || []).length && g.every((v, i) => v === x.gpus[i]);
    return same ? x : Object.assign({}, x, { gpus: g });
  });
  viewMtime = mtime;
  return view;
}

const TIER_ORDER = { '流畅': 4, '可玩': 3, '勉强': 2, '卡顿': 1 };

/** 频道列表：搜索 + 排序 + GPU/机型 过滤 + 帧率档过滤 + 双料过滤 + 分页
 *
 *  stats: 'matched'(默认，只显示能对上端游库的) | 'all'
 *  only:  'both' → 只看双料（sources 同时含 bh 社区配置库 与 pc 机型实测库）
 *  tr:    '1' → 只看「修改器」库收录到的（与 sv 是 AND 关系，v10.5）
 *  sv:    '1' → 只看「云存档」库收录到的（v10.5）
 *  sort:  'both'(默认) | 'configs' | 'recent' | 'name' | 'fps'
 *  gpu:   GPU 关键词（如 'adreno 830'）
 *  tier:  实测帧率档 '流畅'|'可玩'|'勉强'|'卡顿'
 *
 *  ★ stats 与 only 是 AND 关系：两个都开 = 双料且对上端游库。
 */
function list(opts = {}) {
  const d = ensure();
  const items = itemsView(d);   // ★ v10.14：GPU 脏值在读取层清洗后再参与过滤/展示
  const q = String(opts.q || '').trim();
  const gpu = String(opts.gpu || '').trim().toLowerCase();
  const tier = String(opts.tier || '').trim();
  const sort = opts.sort || 'both';
  const limit = Math.min(parseInt(opts.limit, 10) || 60, 300);
  const offset = parseInt(opts.offset, 10) || 0;
  /* ★ 默认只显示「能对上端游库」的 —— 用户本轮核心诉求：
   *   「手游默认显示跟端游匹配的游戏」 */
  const matchedOnly = !(opts.stats === 'all' || opts.all === '1' || opts.all === true);
  /* ★ v10.1「只看双料」：build 产物里条目的 sources 数组实测只有三种取值
   *   ['bh'] 2139 条 / ['pc'] 934 条 / ['bh','pc'] 88 条 —— 长度 2 即双料。
   *   不做成 stats 的第三个取值，是为了能与「仅看匹配端游」自由组合（AND），
   *   否则用户没法表达「双料 且 有封面能进详情」这个最实用的口径（85 条）。 */
  const bothOnly = opts.only === 'both' || opts.both === '1' || opts.both === true;
  /* ★ v10.5 横切筛选：按「修改器库 / 云存档库」是否收录了这款（靠 libId 关联）。
   *   两者也是 AND 关系，并且**本身就要求有 libId**（没对上端游库就没法关联）。 */
  const trOnly = opts.tr === '1' || opts.tr === true;
  const svOnly = opts.sv === '1' || opts.sv === true;

  let pool = items;
  if (matchedOnly) pool = pool.filter((x) => x.libId);
  if (bothOnly) pool = pool.filter((x) => (x.sources || []).length === 2);
  if (trOnly || svOnly) {
    const xref = require('./xref');
    const tr = trOnly ? xref.trainerIds() : null;
    const sv = svOnly ? xref.saveIds() : null;
    pool = pool.filter((x) => x.libId
      && (!tr || tr.has(x.libId)) && (!sv || sv.has(x.libId)));
  }
  if (q) {
    const qk = normKey(q);
    const ql = q.toLowerCase();
    pool = pool.filter((x) => {
      const names = [x.name, ...(x.alt || []), x.libTitle].filter(Boolean);
      return names.some((n) => String(n).toLowerCase().includes(ql) || (qk && normKey(n).includes(qk)));
    });
  }
  if (gpu) {
    const gk = normKey(gpu);
    pool = pool.filter((x) => (x.gpus || []).some((g) => normKey(g).includes(gk))
      || (x.chips || []).some((c) => normKey(c).includes(gk)));
  }
  if (tier) {
    pool = pool.filter((x) => x.tier === tier || (x.tiers || []).includes(tier));
  }

  /* ★ 「双料优先」权重（v9.3）：
   *   合并后才发现一个结构性问题 —— **帧率数据与社区配置数几乎不重叠**：
   *   社区库配置数高的都是热门大作（PES 3021 套 / GTA5 1177 套），但实测库里没有；
   *   实测库有帧率的（641 条）配置数普遍个位数，纯按 configs 排序时
   *   首屏 24 张里**一张帧率卡都看不到**，用户会觉得「说好的合并呢」。
   *   所以默认排序改成「两类信息都有的优先」，再按配置数：
   *     · hasBoth（既有社区配置 又有实测记录）→ 权重最高
   *     · 有实测帧率 / 有实测记录 → 次之
   *     · 其余按配置数
   */
  const score = (x) => {
    const cfg = x.configs || 0, rec = x.records || 0, fps = x.bestLabel ? 1 : 0;
    let s = 0;
    if (cfg > 0 && (rec > 0 || fps)) s += 1e7;   // 双料：社区配置 + 实测，最能体现合并价值
    else if (fps) s += 5e6;                       // 有实测帧率
    else if (rec > 0) s += 3e6;                   // 有实测记录
    return s + cfg;
  };

  const arr = pool.slice();
  if (sort === 'name') arr.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
  else if (sort === 'recent') arr.sort((a, b) => (b.recent || 0) - (a.recent || 0) || (b.configs || 0) - (a.configs || 0));
  else if (sort === 'fps') arr.sort((a, b) => (b.bestMid || 0) - (a.bestMid || 0) || (b.configs || 0) - (a.configs || 0));
  else if (sort === 'configs') arr.sort((a, b) => (b.configs || 0) - (a.configs || 0) || (b.records || 0) - (a.records || 0));
  else arr.sort((a, b) => score(b) - score(a) || (b.configs || 0) - (a.configs || 0));

  const total = arr.length;
  return { ok: true, total, offset, limit, sort, q, gpu, tier, matchedOnly, bothOnly, trOnly, svOnly, items: arr.slice(offset, offset + limit) };
}

/** 概览统计（含筛选后口径：全量 / 仅匹配端游库） */
function stats() {
  const d = ensure();
  const items = itemsView(d);
  const s = d.stats || {};
  const gpus = new Set();
  const chips = new Set();
  for (const x of items) {
    for (const g of x.gpus || []) gpus.add(g);
    for (const c of x.chips || []) chips.add(c);
  }
  const matched = items.filter((x) => x.libId).length;
  return {
    ok: true,
    builtAt: d.builtAt || s.builtAt || 0,
    total: items.length,
    matched,
    unmatched: items.length - matched,
    matchedRate: items.length ? +(matched / items.length * 100).toFixed(1) : 0,
    configs: s.configs || items.reduce((n, x) => n + (x.configs || 0), 0),
    records: s.records || items.reduce((n, x) => n + (x.records || 0), 0),
    playable: s.playable || items.reduce((n, x) => n + (x.playable || 0), 0),
    onlyBh: s.onlyBh || 0,
    onlyPc: s.onlyPc || 0,
    both: s.both || 0,
    gpus: [...gpus].sort().slice(0, 120),
    chips: [...chips].sort().slice(0, 120),
  };
}

/** 按名称/别名反查单条（抽屉挂徽标用） */
/* ★ v10.13：命中改为「按标题分段」匹配。
 *
 *   症状：详情抽屉里 GTA 5 明明有 1,221 套社区配置，却显示「暂无记录」。
 *   根因：本库标题是多段拼接（`侠盗猎车手5传承版/GTA5传承版/Grand Theft Auto V Legacy`），
 *        而旧的 lookup 是**整串**归一化后去比对 —— normKey 会把 `/` 一并抹掉，
 *        于是得到一个谁都对不上的长键；只有「整串恰好等于某条 name」时才命中。
 *   现在：把标题按 `/ ／ | ｜` 切成段，任一段命中即算命中（与 data/bannerhub.js 的
 *        titleKeys 同思路）。**仍要求整段相等**，不做子串包含 ——
 *        否则「生化危机4」会误命中「生化危机4 重制版」这种不同作品。
 */
function splitTitle(s) {
  return String(s == null ? '' : s).split(/[\/／|｜]/).map((x) => x.trim()).filter(Boolean);
}
/* ★ v10.14：标题键变体 —— 让「重置版 / 重製版 / 重制版」等写法收敛到同一把键。
 *   背景：机地标题是「生化危机4重置版」，mobilehub 里是英文名 `Resident Evil 4`，
 *        两者**怎么归一化都对不上** → 抽屉显示「暂无记录」（假阴性）。
 *   真正的桥是「端游库里的同名条目」（xd/机地 两个源的同一款游戏），
 *   由调用方通过 opts.libId / opts.alts 传进来（见 server.js 的 /api/mobilehub/match）。
 *   这里的变体只作为**最后一道**兜底，所以顺序放在最后。 */
function titleVariants(s) {
  const out = [];
  const push = (v) => { const k = normKey(v); if (k && !out.includes(k)) out.push(k); };
  const base = String(s || '');
  push(base);
  push(base.replace(/重置版|重製版|重制版|重置/gi, '重制版'));
  /* 去掉版本词 —— ⚠️ 必须留够长度，否则「生化危机4重制版」退化成「生化危机4」会吸走别的作品 */
  const stripped = base.replace(/重制版|重置版|重製版|高清版|终极版|决定版|完全版|definitive|remake|remastered|hd/gi, '');
  if (normKey(stripped).length >= 4) push(stripped);
  return out;
}

let idx = null, idxMtime = -1;
let byLib = null, byLibMtime = -1;
function buildIndex(d) {
  idx = new Map();
  byLib = new Map();
  for (const x of itemsView(d)) {
    if (x.libId && !byLib.has(x.libId)) byLib.set(x.libId, x);
    const cands = [x.name, x.libTitle, ...(x.alt || [])];
    for (const c of cands) {
      for (const part of splitTitle(c)) {
        for (const k of titleVariants(part)) {
          /* 长度下限 3：避免 "pc" / "3" 这类短键把不相干的条目吸走 */
          if (k.length >= 3 && !idx.has(k)) idx.set(k, x);
        }
      }
    }
  }
  idxMtime = mtime;
  byLibMtime = mtime;
}

/**
 * 按名称反查单条。
 *   opts.libId  端游库 id（最可靠 —— 同款游戏在两个源里 id 不同，但 mobilehub 侧记的 libId 是唯一的）
 *   opts.alts   额外候选名（例如「另一源」的同款标题，通常是英文名）—— 用来跨中英桥接
 */
function lookup(title, opts = {}) {
  const d = ensure();
  if (!idx || idxMtime !== mtime) buildIndex(d);

  /* ① 先试 libId 精确命中（跨中英最稳） */
  const wantLib = String(opts.libId || '').trim();
  if (wantLib && byLib.has(wantLib)) return byLib.get(wantLib);

  /* ② 再试各方给出的名字：本方标题 → 分段 → 另一源的候选名（含英文） */
  const alts = (opts.alts || []).filter(Boolean);
  const names = [title, ...splitTitle(title), ...alts, ...alts.flatMap(splitTitle)];
  for (const part of names) {
    for (const k of titleVariants(part)) {
      if (k.length >= 3 && idx.has(k)) return idx.get(k);
    }
  }
  return null;
}

module.exports = { list, stats, lookup, ensure, normKey, splitTitle, cleanGpuOne, cleanGpus };
