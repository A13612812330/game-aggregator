#!/usr/bin/env node
/**
 * tools/build-mobilehub.js — 生成「手游中心」统一索引 data/mobilehub.json
 *
 * ★ 为什么需要它（v9.2 需求）：
 *   现状是两个库各说各话 ——
 *     · 社区库(tools/build-bannerhub.js → data/bannerhub.json)  2,597 款 / 14,005 份配置
 *     · 实测库(tools/build-phonecfg.py  → data/phonecfg.json)   1,025 款 / 1,037 条记录
 *   同一款游戏（如 GTA V）在两个库里各出现一次，用户要在两个页签之间来回切，
 *   也看不出「这款游戏我到底能不能玩、跑多少帧、有几套配置可抄」。
 *
 *   本脚本把两者**合并成一张表**：
 *     · 按归一化名去重，同款游戏只占一条
 *     · 配置数累加（社区 N 套 + 实测 M 条）
 *     · 同时带实测帧率档与最佳帧率（来自实测库）
 *     · 挂上**端游库匹配结果**（libId/libTitle/libCover…），供默认过滤与详情跳转
 *
 * ★ 默认只显示能匹配端游库的（libId 非空）：
 *   匹配不上的多半是视觉小说/小众日系，端游库里确实没收录；
 *   默认隐藏可让首屏全是「点得进详情、看得到封面」的条目。
 *
 * 本脚本只读两个索引 + games.json，输出 mobilehub.json，不改动上游任何数据。
 */
const fs = require('fs');
const path = require('path');
/* ★ v10.14：GPU 脏值清洗 —— 与读取层共用同一套规则（data/mobilehub.js 的 cleanGpuOne）。
 *   上游 bannerhub 的 `gp` 列混着驱动版本串（turnip_v24.2.0_R22）、驱动构建号（8Elite-800.34）、
 *   包装器前缀（ANGLE … on Vulkan …）、别列串（unknown / 兼容模式 / 红米设备码）——
 *   不清的话「N 种 GPU 跑过」直接虚高，还会把驱动名当 GPU 展示。 */
const { cleanGpuOne } = require('../data/mobilehub');
/* 封面归一化（与 data/gamesDb.js 同一真源）：上游若给相对路径，这里补成绝对 URL */
const { normalizeCover } = require(path.join(__dirname, '..', 'data', 'cover-url'));

const D = __dirname ? path.join(__dirname, '..', 'data') : './data';
const readJson = (f, fb) => { try { return JSON.parse(fs.readFileSync(path.join(D, f), 'utf8')); } catch (e) { return fb; } };

const bh = readJson('bannerhub.json', { games: [] });
const pc = readJson('phonecfg.json', { games: [] });

/* ---------- 归一化与匹配（与 phonecfg.js 同口径，保证结论一致） ---------- */
function normKey(s) {
  return String(s || '').toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[：:·・,，.。!！?？'"“”‘’()（）\[\]【】《》<>~～\-–—_+*&/／|｜\\]/g, '');
}
function libKeys(title) {
  const t = String(title == null ? '' : title).trim();
  if (!t) return [];
  const out = new Set();
  for (const part of t.split(/[/／|｜]/)) {
    const p = part.trim(); if (!p) continue;
    const k = normKey(p); if (k) out.add(k);
  }
  const whole = normKey(t); if (whole) out.add(whole);
  return [...out];
}

/* ---------- 载入端游库索引（多通道） ----------
 *
 * ★ v9.2 修正（这一版把匹配率从 42.7% 拉到 60%+，是提升效果最关键的一处）：
 *   端游库标题是「中文名/英文名/别名/…」的多段结构（有的长达 5 段），
 *   旧策略只取「每段整体」+「每段里的首个英文词组」，于是漏掉大量可命中的形态：
 *     · `Pro Evolution Soccer 2013`  ← 库里是 `实况足球2019/Pro Evolution Soccer 2019/附2018`
 *       含年份后缀，整体归一化后对不上任何一段
 *     · `Tomb Raider`               ← 库里是 `古墓丽影9终极版/Tomb Raider Definitive Edition`
 *       查询是库名的**前缀**，整体相等匹配不到
 *   → 新增三条通道：④ 去版本/年份尾缀  ⑤ 去常见版本词(Definitive/Remastered/Ultimate…) ⑥ 前缀包含
 */
const libByKey = new Map();     // 归一化完整段（含中文）
const libByEn = new Map();      // 英文词组（≥6 字符）
/* ★ 词干索引改为「一个词干 → 多个候选」（v9.3）
 *   原先 Map<stem, item> 只留首次插入的那条，遇到同词干撞车就静默选错：
 *     · `residentevil0` 与 `residentevil3remake` 的词干都是 `residentevil`
 *     · 谁先入库谁赢 → `Resident Evil 0` 被配到 `生化危机3：重制版`
 *   改成数组后，命中时再用「数字一致性护栏」逐条筛，选不出就判未匹配（宁缺勿错）。 */
const libByStem = new Map();    // 词干 → [item, …]（候选项，含其原始归一化 key）
const libList = [];             // 全量条目，供前缀扫描（新）

/* 常见「版本/增强」尾缀词：参与匹配时剔除，让 GTA V 与 GTA V Legacy 归一 */
const EDITION_WORDS = [
  'definitiveedition', 'completeedition', 'ultimateedition', 'specialedition',
  'remastered', 'remake', 'remaster', 'enhancededition', 'goldedition',
  'gameoftheyearedition', 'gotyedition', 'deluxeedition', 'deluxe', 'legacy',
  'ultimate', 'complete', 'edition', 'hypervisor', '支持网络联机', '虚拟机版',
];

/** 去尾缀：去掉「年份 / 版本词 / 罗马数字版本」等，得到可比较的词干 */
function stem(k) {
  let s = k;
  /* 先剥版本词（可能叠加，如 xx Definitive Edition） */
  let changed = true;
  while (changed) {
    changed = false;
    for (const w of EDITION_WORDS) {
      if (s.endsWith(w) && s.length - w.length >= 4) { s = s.slice(0, -w.length); changed = true; }
    }
    /* 再剥尾部数字/年份（2013 / 2021 / 5 / 4） */
    const m = s.match(/(\d{1,4})$/);
    if (m && s.length - m[0].length >= 4) { s = s.slice(0, -m[0].length); changed = true; }
  }
  return s;
}

/** ★ 尾部数字串（含年份）：`residentevil0` → ['0']，`pes2013` → ['2013']，无则 [] */
function tailNums(k) {
  return String(k || '').match(/\d{1,4}/g) || [];
}

/** ★ 严格模式：`query 无数字、库名有数字` 也判冲突（代际不明就不猜）
 *  只在「剥离尾缀后的重试」里用 —— 那时 query 已被人工截短，
 *  再放任词干通道去跨代命中就是猜。实测踩到 `MaxPayne` → 马克思佩恩3。 */
function numConflictStrict(qk, lk) {
  if (numConflict(qk, lk)) return true;
  return !tailNums(qk).length && tailNums(lk).length > 0;
}

/** ★ 库名在 query 之后是否紧跟「续作标记」（阿拉伯数字 / 罗马数字）
 *    `thewitcher`       + `3wildhunt`        → true（该是初代，不是 3）
 *    `assassinscreedii` + `iremastered`      → true（II ≠ III Remastered）
 *    `thewitcher2`      + `assassinsofkings` → false（同代，可接受）
 *  只在严格模式生效；既有五通道的行为**不动**（那是 v9.2 起的历史行为）。
 *  ⚠️ 必须先剥掉版本词再判 —— 首版漏了这步，`iremastered` 里的 `i` 后面紧跟 `r`，
 *     被 `(?![a-z])` 挡掉，于是 `Assassin s Creed II` 又被配到「刺客信条3重制版」。 */
function sequelTail(rest) {
  let r = String(rest || '').toLowerCase();
  let changed = true;
  while (changed) {
    changed = false;
    for (const w of EDITION_WORDS) {
      if (r.endsWith(w) && r.length > w.length) { r = r.slice(0, -w.length); changed = true; }
    }
  }
  r = r.replace(/[^a-z0-9]/g, '');
  if (!r) return false;
  if (/^\d/.test(r)) return true;
  /* 剥完版本词后整串就是一个罗马数字 ⇒ 续作标记（`iiiremastered` → `iii`）。
   * 不用「罗马数字后接任意字母」——那会把 `valley` / `ivory` 这类误判。 */
  return /^(i{1,3}|iv|v|vi{0,3}|ix|x)$/.test(r);
}

/** ★ 数字一致性护栏（v9.3 新增，修「Resident Evil 0 → 生化危机3」这类误配）
 *
 *  背景：词干通道 ④ 会把尾部数字剥掉 —— 这是为了 `PES 2013` ↔ `PES 2019` 这类
 *  「同名不同年」能互相命中。但它同时制造了一个致命副作用：
 *    `Resident Evil 0`  → stem `residentevil`
 *    `Resident Evil 3`  → stem `residentevil`   ← 两者词干完全相同！
 *  而 libByStem 只保留**首次插入**的那条，于是 RE0 会被配到 RE3（反之亦然）。
 *  实测踩到：`Resident Evil 0` 被配到 `生化危机3：重制版`。
 *
 *  护栏：词干命中时，若**两侧都带数字**且**数字集合不相交** → 判为不同代际，拒绝。
 *  在 `yearConflict` 之外单独做，是因为这里比较的是「归一化后的裸数字」（0 / 3 / 2013），
 *  而 yearConflict 只认 4 位年份。 */
function numConflict(queryKey, libKey) {
  const a = tailNums(queryKey), b = tailNums(libKey);
  if (!a.length || !b.length) return false;   // 一边没数字 → 不判冲突（避免误杀）
  return !a.some((x) => b.includes(x));       // 完全不相交 → 冲突
}

/** 往词干索引里塞一个候选（同词干可挂多条） */
function addStem(st, srcKey, it) {
  if (st.length < 5) return;
  let arr = libByStem.get(st);
  if (!arr) { arr = []; libByStem.set(st, arr); }
  /* 同一个 (item, srcKey) 不重复塞 */
  if (arr.some((c) => c.it === it && c.k === srcKey)) return;
  arr.push({ k: srcKey, it });
}

/** ★ 从词干候选里挑一条，用数字一致性护栏筛掉不同代际的
 *  返回 null 表示「有候选但全被判冲突」→ 调用方应视为未匹配，而不是退回乱配。 */
function pickStem(stemKey, queryKey, strict) {
  const cands = libByStem.get(stemKey);
  if (!cands || !cands.length) return null;
  for (const c of cands) {
    /* 用**候选自身的原始 key**（residentevil3remake）比数字，
     * 而不是用词干（residentevil，数字已被剥掉）——这是护栏生效的关键。
     * ★ strict：剥离尾缀后的重试走这条，额外禁止「query 无数字、库名有数字」。 */
    if (strict ? !numConflictStrict(queryKey, c.k) : !numConflict(queryKey, c.k)) return c.it;
  }
  return null;
}

(function loadLib() {
  const raw = readJson('games.json', []);
  const arr = Array.isArray(raw) ? raw : (raw.items || raw.games || []);
  for (const it of arr) {
    libList.push(it);
    const segs = String(it.title || '').split(/[/／|｜]/);
    for (const seg of segs) {
      const p = seg.trim(); if (!p) continue;
      const k = normKey(p);
      if (k && !libByKey.has(k)) libByKey.set(k, it);
      /* 词干索引（≥5 字符才建，避免 `天` 这种单字乱配） */
      addStem(stem(k), k, it);
      /* 段内英文词组（≥6 字符） */
      const cands = p.match(/[a-z][a-z0-9 :'’\-]{3,}/gi) || [];
      for (const c of cands) {
        const e = normKey(c);
        if (e.length >= 6 && !libByEn.has(e)) libByEn.set(e, it);
        addStem(stem(e), e, it);
      }
    }
    /* 整条标题的词干（跨段拼接的少见形态） */
    const whole = normKey(it.title);
    addStem(stem(whole), whole, it);
  }
  let stemTotal = 0;
  for (const [, v] of libByStem) stemTotal += v.length;
  console.log(`端游库索引：完整段 ${libByKey.size} ｜ 英文词组 ${libByEn.size} ｜ 词干 ${libByStem.size}（候选 ${stemTotal}）｜ 条目 ${libList.length}`);
})();

/* 联网学到的别名表 —— 两张表合并：
 *   · data/cn-names.json            由 tools/learn-cn-names.js 产出（针对**实测库**中文名）
 *   · data/mobilehub-names.json     由 tools/learn-mobilehub-names.js 产出（针对**合并后**的英文名）
 * 结构统一为：{ __meta:{…}, aliases:{ "<归一化源名>": ["<归一化目标钥匙>", …] } }
 * 注意：值是**已经归一化**的钥匙，这里不要再 normKey 一次（幂等但没必要），
 *       但为稳妥仍走一遍，防止上游格式漂移。 */
const aliasByKey = new Map();
(function loadAliases() {
  let total = 0, used = 0;
  for (const f of ['cn-names.json', 'mobilehub-names.json']) {
    const a = readJson(f, null);
    if (!a) { console.log(`别名表：${f} 不存在，跳过`); continue; }
    const src = a.aliases || a.pairs || (a.__meta ? {} : a);
    let n = 0;
    for (const [k, v] of Object.entries(src || {})) {
      const keys = (Array.isArray(v) ? v : (v && v.keys) || []).map(normKey).filter(Boolean);
      /* ★ 只收「非空」别名：空数组表示上游学名失败/被否决，
       *   收进来会让 aliasByKey.has() 为真但循环体不执行 —— 无害但会掩盖统计。 */
      if (!keys.length) continue;
      const srcKey = normKey(k);
      /* 两张表可能给同一个源名不同钥匙 → 合并而非覆盖 */
      const prev = aliasByKey.get(srcKey) || [];
      const merged = [...new Set([...prev, ...keys])];
      aliasByKey.set(srcKey, merged);
      n++; total++;
    }
    console.log(`  别名表 ${f}：${n} 条`);
    used += n;
  }
  console.log(`别名表合计：${used} 条去重前 / ${aliasByKey.size} 条去重后`);
})();

/** 查询名 → 端游库条目（五通道，宁可 null 不滥配）
 *
 *  ① 完整段精确     `星界战士`         ↔ `星界战士/星座上升/Astral Ascent`
 *  ② 别名表         `120日元`          ↔ 联网学到的 `120yenstories`
 *  ③ 英文词组交叉   `Ever 17`          ↔ `时空轮回/Ever 17 - The Out of Infinity`
 *  ④ 词干（去版本） `Pro Evolution Soccer 2013` ↔ `…/Pro Evolution Soccer 2019/…`
 *  ⑤ 前缀包含       `Tomb Raider`      ↔ `古墓丽影9终极版/Tomb Raider Definitive Edition`
 *
 *  ★ ④⑤ 是 v9.2 新加，专治「名字带年份/版本尾缀」与「查询是库名前缀」两种最常见漏配。
 */
function libMatchCore(title, opts) {
  const strict = !!(opts && opts.strict);
  const t = String(title == null ? '' : title).trim();
  if (!t) return null;

  /* ① 完整段精确 */
  for (const k of libKeys(t)) { const it = libByKey.get(k); if (it) return it; }

  const whole = normKey(t);

  /* ② 别名表（联网学的官方名） */
  const al = aliasByKey.get(whole);
  if (al) {
    for (const k of al) {
      const it = libByKey.get(k) || libByEn.get(k) || pickStem(stem(k), k);
      if (it) return it;
    }
  }

  /* ③ 英文词组交叉（≥4 字符片段） */
  const en = t.match(/[a-z][a-z0-9 :'’\-]{3,}/gi) || [];
  for (const frag of en) {
    const k = normKey(frag);
    if (k.length >= 4) { const it = libByEn.get(k); if (it) return it; }
    /* ★ 词干命中必须过「数字一致性」护栏（Resident Evil 0 ≠ Resident Evil 3） */
    if (k.length >= 5) { const it = pickStem(stem(k), k, strict); if (it) return it; }
  }

  /* ④ 词干（去年份 / 去版本词）—— 同样过数字护栏 */
  { const it = pickStem(stem(whole), whole, strict); if (it) return it; }

  /* ⑤ 前缀包含：查询是库名的前缀（Tomb Raider ⊂ TombRaiderDefinitiveEdition）
   *    要求查询 ≥8 字符，避免短名（`God`）乱命中。
   *    ⚠️ 反向不做（库名是查询的前缀）——那会把 `GTA V` 配到 `GTA V Legacy` 之外的长标题。
   *    ⚠️ 同样过数字护栏：`Resident Evil 0` 是 `residentevil0hd` 的前缀，
   *       但 `residentevil0` 与 `residentevil3remake` 数字不相交，不该互相命中。
   *    ★ sequelTail：库名在 query 之后是「续作标记」（数字 / 罗马数字）⇒ 不是同一款。
   *      ⚠️ **只对严格模式（剥离尾缀后的重试）生效**，既有通道保持 v9.2 的历史行为。
   *         实测过「对既有通道也生效」的代价：能修掉 1 条误配
   *         （`Assassin s Creed II` → 刺客信条3），却会打掉 4 条**正确**匹配 ——
   *         `Trails in the Sky` → 空之轨迹 the 2nd、`SkullGirls` → Skullgirls 2nd Encore、
   *         `Rise of the Tomb Raider` → 20 Year Celebration、`Command & Conquer Red Alert`
   *         → 红色警戒 2。这些 query 是**系列总称**，库里只收了其中一作，挂上去才有用。
   *         ⇒ 4 退 1 进，明确不划算，故限定作用域。 */
  if (whole.length >= 8) {
    for (const [k, it] of libByEn) {
      if (k.length > whole.length && k.startsWith(whole) && !numConflict(whole, k)
        && !(strict && sequelTail(k.slice(whole.length)))) return it;
    }
    /* 词干前缀：候选可能有多个，逐个用数字护栏筛 */
    for (const [st, cands] of libByStem) {
      if (st.length > whole.length && st.startsWith(whole)) {
        if (strict && sequelTail(st.slice(whole.length))) continue;
        for (const c of cands) if (!numConflict(whole, c.k)) return c.it;
      }
    }
  }

  return null;
}

/* ================= ★ v10.21（#33 第一层）：发布版尾缀剥离 =================
 *
 *  症状（2026-09-18 实测）：手游中心匹配端游库只有 **47.9%**（1,530/3,195），
 *  其中一批**库里有、但名字对不上**的假阴性，成因高度集中：
 *
 *    社区库导出的名字带**发布版标记 / exe 残渣后缀**，而端游库收录的是正式版：
 *      `Stellar Blade Demo`        → 端游库是 `剑星-虚拟机版/Stellar Blade HYPERVISOR`
 *      `MiSide Demo`               → `米塔/MiSide`
 *      `INSIDE Demo`               → `深入/囚禁/Inside`
 *      `Just Cause 4 Reloaded`     → `正当防卫4/Just Cause 4`
 *      `MaxPayne Application`      → `马克思佩恩3/Max Payne 3`
 *      `Euro Truck Simulator 2 Demo` → `欧洲卡车模拟2/…`
 *      `eFootball PES 2021 SEASON UPDATE` → `实况足球2021/eFootball PES 2021`
 *    另有端游库侧的发布组标记（`… voices38` / `… HYPERVISOR`）已由 EDITION_WORDS 处理。
 *
 *  ⚠️ 剥离必须**保守**：只剥「明确表示非正式版/非游戏本体」的词，
 *     且剥完长度不足 3 就放弃 —— 否则 `Sifu` 会被剥成空串，或 `The Witcher Game`
 *     退化成 `The Witcher` 后误配到《巫师3》（实测到，已用长度+原有五通道的
 *     数字护栏兜住：`The Witcher 2 Game` 剥后带 2，不会跳到 3）。
 *
 *  实测收益：新增匹配 **29 条**（47.9% → 48.9%），明细逐条人工核过，全部为真匹配。
 *  ⇒ 这是「零误配风险」的纯增益层，所以放在**原有五通道之后**做兜底（保序不变）。
 */
const RELEASE_SUFFIX = [
  /\s*[-–—]?\s*demo\s*$/i,
  /\s*[-–—]?\s*showcase\s*$/i,
  /\s*[-–—]?\s*season\s*update\s*$/i,
  /\s*[-–—]?\s*multiplayer\s*$/i,
  /\s*[-–—]?\s*application\s*$/i,
  /\s*[-–—]?\s*game\s*$/i,
  /\s*[-–—]?\s*(虚拟机版|支持网络联机|正式版|支持者版|整合版|免安装版)\s*$/,
  /\bvoices\d+\b/gi,
  /\bklite\b/gi,
  /\bHYPERVISOR\b/gi,
  /\b(repack|fitgirl|dodi|codex|plaza|skidrow|empress|rune|tenoke|elamigos|razor1911|3dm)\b/gi,
];
/* ★ 故意**不剥** `Reloaded`：它既可能是发布标记（`Just Cause 4 Reloaded` = JC4），
 *   也可能是作品名本身（`Tropico Reloaded` 是 1+2 合集，≠ 海岛大亨6）。
 *   不可区分 ⇒ 宁可不剥（实测：剥了会把 Tropico Reloaded 错配到海岛大亨6）。 */

/** 反复剥到不再变化（`Stellar Blade Demo` → `Stellar Blade`；多层后缀也能剥净） */
function stripRelease(name) {
  let s = String(name == null ? '' : name);
  for (let i = 0; i < 3; i++) {
    let changed = false;
    for (const re of RELEASE_SUFFIX) {
      const n = s.replace(re, '').trim();
      if (n !== s) { s = n; changed = true; }
    }
    if (!changed) break;
  }
  s = s.replace(/[-–—:]\s*$/, '').replace(/\s{2,}/g, ' ').trim();
  return s.length >= 3 ? s : '';
}

/** 对外入口：原五通道优先，失败才用「剥尾缀后的名字」再走一遍同一套通道（严格模式） */
function libMatch(title) {
  const hit = libMatchCore(title);
  if (hit) return hit;
  const stripped = stripRelease(title);
  if (stripped && stripped !== String(title || '').trim()) return libMatchCore(stripped, { strict: true });
  return null;
}

/* ---------- 合并两个库 ---------- */
/** 合并 key：优先用「端游库命中后的规范名」，否则用库内名字 */
function mergeKey(name, lib) {
  if (lib && lib.title) return 'L:' + lib.id;          // 命中端游库 → 按库 id 归并（最可靠）
  return 'N:' + normKey(name);
}

const merged = new Map();

/* ① 社区库（BannerHub） */
for (const g of (bh.games || [])) {
  const name = g.p || g.k || '';
  if (!name) continue;
  /* 社区库是英文名，先直接匹配；匹配不上时试「去掉版本后缀」的变体 */
  let lib = libMatch(name);
  if (!lib) lib = libMatch(name.replace(/[-–—:].*$/, '').trim());
  const key = mergeKey(name, lib);
  const cur = merged.get(key) || {
    name, alt: [], configs: 0, dl: 0, gpus: [], devices: [], recent: 0,
    records: 0, playable: 0, chips: [], tiers: [], bestLabel: '', bestMid: 0,
    notes: [], exes: [], sources: [], bhKeys: [], lib: null,
  };
  cur.configs += g.c || 0;
  cur.dl += g.n || 0;
  /* ★ 记下社区库仓库键：前端点卡片要拿它去 /api/bh/configs?k= 取逐条配置 */
  if (g.k && !cur.bhKeys.includes(g.k)) cur.bhKeys.push(g.k);
  for (const x of g.gp || []) { const v = cleanGpuOne(x); if (v && !cur.gpus.includes(v)) cur.gpus.push(v); }
  for (const x of g.dv || []) if (!cur.devices.includes(x)) cur.devices.push(x);
  if ((g.t || 0) > cur.recent) cur.recent = g.t || 0;
  if (!cur.sources.includes('bh')) cur.sources.push('bh');
  if (!cur.lib && lib) cur.lib = lib;
  if (name && name !== cur.name) cur.alt.push(name);
  merged.set(key, cur);
}

/* ② 实测库（本项目自建） */
for (const g of (pc.games || [])) {
  const name = g.title || g.k || '';
  if (!name) continue;
  let lib = libMatch(name);
  const key = mergeKey(name, lib);
  const cur = merged.get(key) || {
    name, alt: [], configs: 0, dl: 0, gpus: [], devices: [], recent: 0,
    records: 0, playable: 0, chips: [], tiers: [], bestLabel: '', bestMid: 0,
    notes: [], exes: [], sources: [], bhKeys: [], lib: null,
  };
  cur.records += g.n || 0;
  cur.playable += g.okN || 0;
  if (g.hasCfgN) cur.configs += g.hasCfgN;   // 实测里能导出配置的也计入「可抄配置」
  for (const x of g.chips || []) if (!cur.chips.includes(x)) cur.chips.push(x);
  for (const x of g.gpus || []) { const v = cleanGpuOne(x); if (v && !cur.gpus.includes(v)) cur.gpus.push(v); }
  for (const x of g.tiers || []) if (!cur.tiers.includes(x)) cur.tiers.push(x);
  if ((g.bestMid || 0) > cur.bestMid) { cur.bestMid = g.bestMid || 0; cur.bestLabel = g.bestLabel || ''; }
  for (const nt of g.notes || []) cur.notes.push(nt);
  for (const x of g.exes || []) if (!cur.exes.includes(x)) cur.exes.push(x);
  if (!cur.sources.includes('pc')) cur.sources.push('pc');
  if (!cur.lib && lib) cur.lib = lib;
  /* 实测库名字是中文，优先用它作为显示名（更符合中文用户） */
  if (g.title && g.title !== cur.name) {
    if (!cur.alt.includes(cur.name)) cur.alt.push(cur.name);
    cur.name = g.title;
  }
  merged.set(key, cur);
}

/* ---------- 排序 + 统计 ---------- */
const TIER_ORDER = { '流畅': 4, '可玩': 3, '勉强': 2, '卡顿': 1 };
/* ★ alt 去重 + 截断：社区库里同一款游戏的变体名可能多达 20 个
 *   （`Pro Evolution Soccer 2013` / `…20132` / `…2013 - Real Patch 26` / `…2013 1`…），
 *   全塞给前端只会浪费带宽、也没人看。保留 4 个最"干净"的（短的优先）。 */
function cleanAlt(list, name) {
  const seen = new Set();
  const out = [];
  for (const a of list) {
    const t = String(a || '').trim();
    if (!t || t === name) continue;
    const k = normKey(t);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  out.sort((a, b) => a.length - b.length);
  return out.slice(0, 4);
}

const items = [...merged.values()].map((x) => {
  x.tier = x.tiers.slice().sort((a, b) => (TIER_ORDER[b] || 0) - (TIER_ORDER[a] || 0))[0] || '';
  x.libId = x.lib ? x.lib.id : null;
  x.libTitle = x.lib ? x.lib.title : '';
  x.libCover = x.lib ? normalizeCover(x.lib.cover) : '';   // ★ v10.4 相对路径补域名
  x.libUrl = x.lib ? (x.lib.url || '') : '';
  x.libScore = x.lib ? (x.lib.score || '') : '';
  x.libSize = x.lib ? (x.lib.size || '') : '';
  x.alt = cleanAlt(x.alt, x.name);
  delete x.lib;
  return x;
});
items.sort((a, b) => (b.configs - a.configs) || (b.records - a.records) || a.name.localeCompare(b.name, 'zh'));

const matched = items.filter((x) => x.libId);
const stats = {
  builtAt: Date.now(),
  total: items.length,
  matched: matched.length,
  unmatched: items.length - matched.length,
  matchedRate: items.length ? +(matched.length / items.length * 100).toFixed(1) : 0,
  bhGames: (bh.games || []).length,
  pcGames: (pc.games || []).length,
  configs: items.reduce((s, x) => s + (x.configs || 0), 0),
  records: items.reduce((s, x) => s + (x.records || 0), 0),
  playable: items.reduce((s, x) => s + (x.playable || 0), 0),
  onlyBh: items.filter((x) => x.sources.length === 1 && x.sources[0] === 'bh').length,
  onlyPc: items.filter((x) => x.sources.length === 1 && x.sources[0] === 'pc').length,
  both: items.filter((x) => x.sources.length === 2).length,
};

const out = { builtAt: stats.builtAt, stats, items };
fs.writeFileSync(path.join(D, 'mobilehub.json'), JSON.stringify(out), 'utf8');

console.log('\n=== 手游中心统一索引 ===');
console.log(`合并条目      ${stats.total}`);
console.log(`  ├ 社区库独有 ${stats.onlyBh}`);
console.log(`  ├ 实测库独有 ${stats.onlyPc}`);
console.log(`  └ 两库皆有   ${stats.both}`);
console.log(`匹配端游库    ${stats.matched} / ${stats.total}  (${stats.matchedRate}%)`);
console.log(`未匹配        ${stats.unmatched}`);
console.log(`配置总数      ${stats.configs} ｜ 实测记录 ${stats.records} ｜ 标记可玩 ${stats.playable}`);
console.log(`\n匹配样例（前 12）：`);
for (const x of matched.slice(0, 12)) {
  console.log(`  ${x.name.padEnd(34)} → ${x.libTitle}  [配置 ${x.configs}${x.records ? ' / 实测 ' + x.records : ''}]`);
}
console.log(`\n✅ 已写出 data/mobilehub.json`);
