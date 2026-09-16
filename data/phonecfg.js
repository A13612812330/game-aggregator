/**
 * phonecfg.js — 「手机可玩配置库」索引模块
 *
 * 数据来源：tools/build-phonecfg.py 把《基础测试数据.xlsx》转成 data/phonecfg.json
 * （人工实测记录：某款 PC 游戏 在某机型 上用某套兼容层/驱动配置跑通的完整参数 + 帧率 + 备注）
 *
 * 与 bannerhub.js 的分工：
 *   - bannerhub = 社区共享库（GitHub，14003 份配置，机型是真实手机型号）
 *   - phonecfg  = 本项目自建实测库（1037 条记录，机型是高通芯片代号，但含帧率与问题备注）
 *   两者互补：社区库看「覆盖面」，实测库看「能不能跑 + 跑多少帧 + 有什么坑」。
 */
const fs = require('fs');
const path = require('path');

const IDX = path.join(__dirname, 'phonecfg.json');

let idx = null;
let byKey = null;
let matchCache = new Map();

function normKey(s) {
  const t = String(s == null ? '' : s).toLowerCase();
  return t
    .replace(/[\s\u3000]+/g, '')
    .replace(/[·・:：,，.。!！?？"'“”‘’()（）\[\]【】<>《》|｜/\\~～\-—_+*&#@$%^&;；]/g, '');
}

/**
 * 由「副标题截断」产生的系列名钥匙（如 `metalgearsolid` / `合金装备`）。
 * 它们无区分度，不能参与包含式匹配，否则同系列不同作品会互相误命中。
 * 由 titleKeys() 在切分副标题时顺手登记，load() 时清空重建。
 */
const SERIES_KEYS = new Set();

/** 游戏名 → 多把归一化钥匙（与构建脚本保持同构）
 *  第 1 把 = 完整名；后续 = 按 / 与副标题分隔符截断后的「系列名」→ 登记到 SERIES_KEYS
 */
function titleKeys(title) {
  const t = String(title == null ? '' : title).trim();
  if (!t) return [];
  const out = new Set();
  for (const part of t.split(/[/／|｜]/)) {
    const p = part.trim();
    if (!p) continue;
    const k1 = normKey(p);
    if (k1) out.add(k1);
    const base = p.split(/[：:（(\[【]/)[0].trim();
    const k2 = normKey(base);
    if (k2) { out.add(k2); if (k2 !== k1) SERIES_KEYS.add(k2); }
  }
  out.delete('');
  return [...out];
}

function load(force) {
  if (idx && !force) return idx;
  try {
    idx = JSON.parse(fs.readFileSync(IDX, 'utf8'));
  } catch (e) {
    idx = { builtAt: 0, source: '', stats: {}, games: [], records: [] };
  }
  byKey = new Map();
  SERIES_KEYS.clear();          // 与 byKey 同步重建，避免跨次 load 残留
  for (const g of idx.games || []) {
    for (const k of titleKeys(g.title)) {
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(g);
    }
  }
  matchCache = new Map();
  return idx;
}

function ensure() { return load(); }

/**
 * 英文/数字钥匙的「安全包含」判断。
 *
 * 为什么不能直接用 String.includes：
 *   查询 key `demonstimeline` 与库内 key `elin` 之间会命中 —— 因为
 *   **Tim-ELIN-e** 里恰好藏着连续子串 "elin"，导致两款毫不相干的游戏被判为同一款。
 *   中文没有单词边界概念，但中文 key 极短时（如「天」「雨」）同样会滥命中。
 *
 * 规则：
 *   ① 含 CJK 的 key：要求完全相等，或一方长度 >= 4 且为另一方的子串（中文按「整名包含」，不做词切分）；
 *   ② 纯 ASCII key：要求完全相等，或「按非字母数字切词后，短 key 的全部词都能在长 key 中以完整词出现」。
 */
function safeContains(longKey, shortKey) {
  if (longKey === shortKey) return true;
  const hasCjk = /[\u4e00-\u9fff\u3040-\u30ff]/.test(shortKey);
  if (hasCjk) {
    // 中文：长 key 必须包含短 key，且短 key 至少 2 字（避免「天」这种单字滥配）
    return shortKey.length >= 2 && longKey.includes(shortKey);
  }
  // 英文/数字：按词切分，短 key 的每个词都必须在长 key 中以完整词出现
  const words = shortKey.split(/(?=[0-9])|(?<=[0-9])/).join('').match(/[a-z]+|[0-9]+/g) || [];
  if (!words.length) return longKey === shortKey;
  const lw = longKey.match(/[a-z]+|[0-9]+/g) || [];
  return words.every((w) => lw.includes(w));
}

/** 按游戏名反查实测记录聚合（供卡片徽标 / 详情区块） */
function lookup(title) {
  const t = String(title == null ? '' : title).trim();
  if (!t) return null;
  if (matchCache.has(t)) return matchCache.get(t);
  ensure();
  let hit = null;
  const keys = titleKeys(t);
  // ① 钥匙全等优先
  for (const k of keys) {
    const arr = byKey.get(k);
    if (arr && arr.length) {
      hit = arr[0];
      break;
    }
  }
  // ② 退化：安全包含式匹配（避免 demonstimeline ↔ elin 这类跨词误命中）
  if (!hit && keys.length) {
    let best = null, bestLen = -1;
    for (const k of keys) {
      if (k.length < 4) continue;
      // 只用「完整名钥匙」做包含式匹配。副标题截断产生的系列名钥匙
      // （如 `metalgearsolid` / `合金装备`）无区分度，会把同系列不同作品混为一谈，
      // 必须排除在包含式匹配之外——它们仍可参与第 ① 步的精确匹配。
      if (SERIES_KEYS.has(k)) continue;
      for (const [bk, arr] of byKey) {
        if (bk.length < 4 || SERIES_KEYS.has(bk)) continue;
        const longK = k.length >= bk.length ? k : bk;
        const shortK = k.length >= bk.length ? bk : k;
        if (safeContains(longK, shortK) && longK.length > bestLen) {
          best = arr[0];
          bestLen = longK.length;
        }
      }
    }
    hit = best;
  }
  matchCache.set(t, hit);
  return hit;
}

/** 给库内条目挂 pc 字段（原始条目不可变） */
function attach(g) {
  const h = lookup(g && g.title);
  if (!h) return g;
  return Object.assign({}, g, {
    pc: {
      k: h.k, t: h.title, c: h.n, ok: h.okN,
      chips: h.chips, gpus: h.gpus, tiers: h.tiers,
      best: h.bestLabel, bestMid: h.bestMid,
      cfg: h.hasCfgN, noteN: (h.notes || []).length,
    },
  });
}

/** 概览统计 */
function stats() {
  ensure();
  const s = idx.stats || {};
  const pcGames = (idx.games || []).filter((g) => g.okN > 0).length;
  return Object.assign({}, s, {
    pcGames,
    builtAt: idx.builtAt || 0,
    source: idx.source || '',
  });
}

/** 列表：q 关键词 / chip 芯片 / tier 帧率档 / ok 仅看可玩 / sort / limit / offset */
function list(opts) {
  ensure();
  const o = opts || {};
  let pool = (idx.games || []).slice();

  if (o.ok === '1' || o.ok === true) pool = pool.filter((g) => g.okN > 0);
  if (o.tier) {
    const t = String(o.tier);
    pool = pool.filter((g) => (g.tiers || []).includes(t));
  }
  if (o.chip) {
    const c = String(o.chip);
    pool = pool.filter((g) => (g.chips || []).includes(c));
  }

  const q = String(o.q == null ? '' : o.q).trim();
  if (q) {
    const kq = normKey(q);
    pool = pool.filter((g) => {
      if (!kq) return true;
      if (normKey(g.title).includes(kq)) return true;
      return (g.keys || []).some((k) => k.includes(kq));
    });
  }

  const sort = String(o.sort || 'fps');
  if (sort === 'name') pool.sort((a, b) => String(a.title).localeCompare(String(b.title), 'zh'));
  else if (sort === 'cfg') pool.sort((a, b) => (b.hasCfgN || 0) - (a.hasCfgN || 0) || String(a.title).localeCompare(String(b.title), 'zh'));
  else pool.sort((a, b) => (b.bestMid || 0) - (a.bestMid || 0) || (b.okN || 0) - (a.okN || 0));

  const total = pool.length;
  const offset = Math.max(0, parseInt(o.offset, 10) || 0);
  const limit = Math.min(300, Math.max(1, parseInt(o.limit, 10) || 36));
  const page = pool.slice(offset, offset + limit);
  // 挂本地库（XD/机地）详情与封面：命中则前端可显示封面 + 点开统一详情抽屉
  const items = page.map((g) => Object.assign({}, g, { lib: briefLib(libMatch(g.title)) }));
  const libHit = items.filter((g) => g.lib).length;
  return { ok: true, total, offset, limit, items, libHit, builtAt: idx.builtAt || 0 };
}

/** 某款游戏的全部实测记录（含每条完整配置） */
function records(keyOrTitle) {
  ensure();
  const q = String(keyOrTitle == null ? '' : keyOrTitle).trim();
  if (!q) return { ok: true, title: '', items: [] };
  const kq = normKey(q);
  let items = (idx.records || []).filter((r) => normKey(r.game) === kq);
  if (!items.length) {
    const hit = lookup(q);
    if (hit) {
      const hk = normKey(hit.title);
      items = (idx.records || []).filter((r) => normKey(r.game) === hk);
    }
  }
  const order = { 流畅: 0, 可玩: 1, 勉强: 2, 卡顿: 3, 不可用: 4, '': 5 };
  items = items.slice().sort((a, b) => (order[a.fpsTier] == null ? 5 : order[a.fpsTier]) - (order[b.fpsTier] == null ? 5 : order[b.fpsTier]));
  return {
    ok: true,
    title: items.length ? items[0].game : q,
    lib: briefLib(libMatch(items.length ? items[0].game : q)),
    items,
  };
}

/** 芯片代号 → 可读名 */
function chipName(code) {
  ensure();
  return (idx.chipMap || {})[code] || code || '';
}

/* ================= 本地库（XD + 机地）反查：补详情与封面 =================
 *
 * 为什么不能复用 bannerhub.js 的 titleKeys：
 *   那套是为「数据源是英文名」设计的 —— `normKey` 会把中文清成空串，
 *   且最后过滤 `length >= 4`。实测库的数据是**中文名**（星界战士），
 *   而本地库标题是多段式（`星界战士/星座上升/Astral Ascent`），
 *   用那套钥匙必然 6.8% 命中率。
 *
 * 本模块改用「保留 CJK 的多段钥匙」：
 *   把标题按 / ｜ 拆段，每段各自归一（**保留中文**）后作为独立钥匙，
 *   这样「星界战士」能同时匹配到实测库条目和本地库多段标题。
 */
const libByKey = new Map();
const libByEn = new Map();
/** 联网学习的别名表：<归一源名> → [别名…]（由 tools/learn-cn-names.js 产出）
 *  用途：实测库写「120日元」，Steam 官方叫「120 Yen Stories」，
 *  本地库可能只有英文段 —— 把学到的中英别名一起当钥匙，命中率直接抬起来。
 */
const aliasByKey = new Map();
let libLoaded = false;

/** 别名可用性护栏（第二道防误配）
 *
 * 学名脚本已按相似度阈值过滤，但「字面像、游戏不同」的漏网者仍可能挂错封面
 * （已被抓到的实例：`FLOWERS 夏篇` 被 Steam 搜到 `Wylde Flowers`，
 *  两者共享 "flowers"，Dice 系数 0.64 越过了阈值）。
 *
 * 只做「片段包含」是拦不住的 —— 共享一个单词就够。所以改成**双向覆盖率**：
 *   源名归一后记 A，本地库标题记 B，取 A 中所有 k-gram 在 B 里的命中比例。
 *   要求
 *     ① 一方完整包含另一方  或
 *     ② 覆盖率 ≥ 0.5（即源名字面有一半以上能在标题里找到）
 * 这样 `flowers夏篇`（A=flowers夏篇）对 `怀德花卉wyldeflowers`（B）：
 *   k=2 → A 的 gram 有 fl/lo/ow/we/er/rs/s夏/夏篇，B 里只命中 fl..rs 共 6/8 = 0.75…
 *   仍然偏高。因此再补一条**特征词检验**：A 里最长的连续字符段（这里 "flowers"）
 *   不得是 B 中某个**不同单词**的一部分 —— 即 B 必须有以该段为前缀的独立词。
 */
function aliasSane(srcRaw, libItem) {
  const src = normKey(srcRaw);
  const tgt = normKey(libItem && libItem.title || '');
  if (!src || !tgt) return false;
  if (src.includes(tgt) || tgt.includes(src)) return true;

  const cjk = /[\u4e00-\u9fff]/.test(src);
  const k = cjk ? 2 : 4;

  // ① 覆盖率：A 的 k-gram 有多少能在 B 里找到
  let hit = 0, tot = 0;
  for (let i = 0; i + k <= src.length; i++) { tot++; if (tgt.includes(src.slice(i, i + k))) hit++; }
  const cover = tot ? hit / tot : 0;
  if (cover < 0.5) return false;

  // ② 特征词检验：取 A 里最长的 ASCII 连续段，它必须是 B 里的**独立词**
  //    （以该段开头且完整），而不是某个更长单词的一截。
  //    例：A 的 "flowers" 在 B="…wyldeflowers" 里只是 "wyldeflowers" 的后半截 → 判否。
  const feat = (src.match(/[a-z0-9]{3,}/g) || []).sort((a, b) => b.length - a.length)[0];
  if (feat && tgt.includes(feat)) {
    const isWordStart = new RegExp('(^|[^a-z0-9])' + feat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!isWordStart.test(tgt)) return false;
  }
  return true;
}

function loadAliases() {try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'cn-names.json'), 'utf8'));
    const map = (raw && raw.aliases) || {};
    for (const [src, list] of Object.entries(map)) {
      if (!src || !Array.isArray(list)) continue;
      const keys = new Set(aliasByKey.get(src) || []);
      for (const a of list) {
        const k = normKey(a);
        if (k) keys.add(k);
      }
      if (keys.size) aliasByKey.set(src, keys);
    }
  } catch (e) { /* 未学习过则静默：只是匹配率低一点，不影响可用性 */ }
}

/** 本地库标题 → 多把**保留中文**的钥匙 */
function libKeys(title) {
  const t = String(title == null ? '' : title).trim();
  if (!t) return [];
  const out = new Set();
  for (const part of t.split(/[/／|｜]/)) {
    const p = part.trim();
    if (!p) continue;
    const k = normKey(p);            // ← 复用本模块的 normKey（保留 CJK）
    if (k) out.add(k);
  }
  const whole = normKey(t);
  if (whole) out.add(whole);
  return [...out];
}

function loadLib() {
  if (libLoaded) return;
  libLoaded = true;
  loadAliases();
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'games.json'), 'utf8'));
    const arr = Array.isArray(raw) ? raw : (raw.items || raw.games || []);
    for (const it of arr) {
      for (const k of libKeys(it.title)) {
        if (!libByKey.has(k)) libByKey.set(k, it);   // 先到先得，避免长标题覆盖短名
      }
      // 辅助索引：每个 / 分隔段里的英文词组（取最长的一段，避免 "The" 这种噪音）
      for (const part of String(it.title || '').split(/[/／|｜]/)) {
        const cands = part.match(/[a-z][a-z0-9 :'’\-]{3,}/gi) || [];
        for (const c of cands) {
          const k = normKey(c);
          // 只收 ≥6 字符的英文段，短词（The/Game/Plus）区分度太低会滥配
          if (k.length >= 6 && !libByEn.has(k)) libByEn.set(k, it);
        }
      }
    }
  } catch (e) { /* 无库文件时静默降级：站点仍可用，只是没有封面 */ }
}

/** 实测库条目 → 本地库条目（命中返回本地库原始条目，无则 null）
 *
 * 三层策略（与 lookup 的思路一致，但钥匙保留中文）：
 *   ① 中文/英文**精确钥匙**：`星界战士` ↔ `星界战士/星座上升/Astral Ascent`
 *   ② 英文段交叉：实测库叫 `Ever 17`，本地库是 `时空轮回/Ever 17 - The Out of Infinity`
 *      → 取本地库每段的「首个英文词组」建辅助索引
 *   ③ 放弃：宁可返回 null 也不滥配（详情/封面挂错比不挂更糟）
 */
function libMatch(title) {
  loadLib();
  const t = String(title == null ? '' : title).trim();
  if (!t) return null;
  for (const k of libKeys(t)) {
    const it = libByKey.get(k);
    if (it) return it;
  }
  // ② 联网学到的别名：`120日元` → { `120yen`, `120yenstories` } → 本地库
  //    ★ 护栏：别名必须与查询名「同文种或同长相」，否则宁可不用。
  //      学名过程已有相似度阈值，但字面像而实际不同款的（flowers夏篇 ≠ Wylde Flowers）
  //      可能漏网 —— 这里再加一道：别名与原名完全无公共子串则拒绝。
  const whole = normKey(t);
  const al = aliasByKey.get(whole);
  if (al) {
    for (const k of al) {
      const it = libByKey.get(k) || libByEn.get(k);
      if (it && aliasSane(t, it)) return it;
    }
  }
  // ③ 英文段交叉：抽出查询里的纯英文片段（≥4 字符），到英文索引里找
  const en = t.match(/[a-z][a-z0-9 :'’\-]{3,}/gi) || [];
  for (const frag of en) {
    const k = normKey(frag);
    if (k.length >= 4) {
      const it = libByEn.get(k);
      if (it) return it;
    }
  }
  return null;
}

/** 精简本地库条目为前端需要的字段 */
function briefLib(it) {
  if (!it) return null;
  return {
    id: it.id, title: it.title, url: it.url || '',
    cover: it.cover || '', score: it.score || '', size: it.size || '',
    date: it.date || '', genres: it.genres || [], src: it.src || '',
  };
}

module.exports = {
  load, ensure, normKey, titleKeys, lookup, attach, stats, list, records, chipName,
  libMatch, briefLib, libKeys, loadAliases,
};
