/**
 * data/game-name.js — 「端游库游戏名」→ 展示名 / 英文名 的**唯一真源**
 *
 * ── 为什么要有这一层（2026-10-10 用户口径）────────────────────────────────
 * 用户原话：「应该是游戏名称导致 XD 的游戏名称有点小问题，他会用 / 进行分隔
 *           中英文游戏名称以及标签等」。
 * 端游库（xdgame）的 `title` 是 `中文名/英文名/标签` 用 `/` 直接拼起来的一长串：
 *   赛博朋克2077/Cyberpunk 2077
 *   上古卷轴5：周年纪念版/上古卷轴5：天际10周年重制版/The Elder Scrolls V: Skyrim Special Edition
 *   星露谷物语/Stardew Valley/支持网络联机
 * 直接铺到卡片上 ⇒ 标题折 2~3 行、卡片高度参差（实测库内 19,430 款里 **16,248 款含 `/`**，83.6%）。
 *
 * ── 分段实测（全库 19,430 款 → 34,305 个段）──────────────────────────────
 *   段频次 ≥ 8 的段**恰好只有 3 个**，且**全部只出现在末位**：
 *       支持网络联机 814 次 · 支持VR 30 次 · 附历代合集 15 次
 *     出现在**首位**的次数：0 ；出现在**中间**的次数：0
 *   ⇒ 「从尾部剥掉标签段、取第一段」是**精确**的，不会误伤任何真实游戏名。
 *
 * ── 标签的判定（不写死名单）──────────────────────────────────────────────
 *   `deriveTags()` 从库本身推导：**末位出现 ≥ TAG_MIN_TAIL 次** 且 **从未出现于首位**。
 *   第二条是关键护栏 —— 一款真游戏哪怕重复收录 8 次，它也一定当过首段；
 *   而「支持网络联机」这种后缀标签永远不可能当首段。两条同时满足才判为标签。
 *   实测该规则在全库上导出的就是上面那 3 个，与人工盘点一致。
 *
 * ⚠️ 本文件只管「名字怎么拆成展示形态」。**跨源匹配**用的归一化钥匙在
 *    `data/name-normalize.js`（另一件事，别混）。
 */
'use strict';

/** 含 CJK（含扩展 A 区与兼容区）——判「这一段是不是中文名」 */
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/** 标签段判定门槛：在**末位**至少出现这么多次，且从未出现在首位。 */
const TAG_MIN_TAIL = 8;

/** 兜底标签表（库没加载起来时用；实测与 deriveTags() 在全库上的结果一致）。 */
const FALLBACK_TAGS = ['支持网络联机', '支持VR', '附历代合集'];

/** 按 `/` 切段（去掉空段与首尾空白）。 */
function segments(title) {
  return String(title == null ? '' : title)
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 从一批库标题里推导「标签段」。规则见文件头：末位 ≥8 次 且 从未在首位。 */
function deriveTags(titles) {
  const tail = new Map();
  const head = new Set();
  for (const t of titles || []) {
    const p = segments(t);
    if (p.length < 2) continue;
    head.add(p[0]);
    const last = p[p.length - 1];
    tail.set(last, (tail.get(last) || 0) + 1);
  }
  const out = [];
  for (const [seg, n] of tail) if (n >= TAG_MIN_TAIL && !head.has(seg)) out.push(seg);
  return out;
}

let tagCache = null;

/** 标签集合（惰性：首次调用时从端游库推导；库不可用时回落 FALLBACK_TAGS）。 */
function tagSet() {
  if (tagCache) return tagCache;
  let tags = FALLBACK_TAGS;
  try {
    const gamesDb = require('./gamesDb');
    gamesDb.load();
    const titles = (gamesDb.all() || []).map((g) => g.title);
    const derived = deriveTags(titles);
    /* ★ 只有在推导出非空结果时才采信 —— 空结果说明库没就位，
     *   静默清空标签表会让「星露谷物语/Stardew Valley/支持网络联机」又把标签当名字。 */
    if (derived.length) tags = derived;
  } catch (e) { /* 库没起来不致命：用兜底表 */ }
  tagCache = new Set(tags);
  return tagCache;
}

/** 只有单元测试/重建索引时需要强制重算（库换了要重推）。 */
function resetTags() { tagCache = null; }

/** 剥掉尾部的标签段（保留至少一段，避免整串被剥空）。 */
function coreSegments(title) {
  const p = segments(title);
  const tags = tagSet();
  while (p.length > 1 && tags.has(p[p.length - 1])) p.pop();
  return p;
}

/** 展示名：剥尾标签后的**第一段**。无斜杠时原样返回（去掉首尾空白）。 */
function displayName(title) {
  const p = coreSegments(title);
  const raw = String(title == null ? '' : title).trim();
  return stripTailLabel(p[0] || raw);
}

/** 粘在段尾的**已知标签尾巴**（不是 `/` 分隔，而是空格连着）—— 实测 34 条：
 *    `红色沙漠/Crimson Desert voices38` · `霍格沃茨之遗/Hogwarts Legacy voices38`
 *  `voices38` = 「38 国配音」的版本标注，与 `/` 分隔的标签是同一类东西，只是写在了英文段里。
 *  ★ 只摘**这一种**已知形态：不加宽到「任意尾部单词」—— 那是游戏名的一部分。 */
const TAIL_LABEL_RE = /\s+voices?\s*\d*\s*$/i;

/** 摘掉段尾的已知标签尾巴。 */
function stripTailLabel(s) {
  return String(s == null ? '' : s).replace(TAIL_LABEL_RE, '').trim();
}

/** 英文名：剥尾标签后，**首个不含 CJK、且不等于展示名**的段；没有就返回 ''。
 *
 *  取「首个不含 CJK 的段」而不是「第二段」，是因为中文别名可能有多个：
 *    料理模拟器/烹饪模拟器/Cooking Simulator  → 展示名 料理模拟器 / 英文名 Cooking Simulator
 *    上古卷轴5：周年纪念版/上古卷轴5：天际10周年重制版/The Elder Scrolls V: … → 要的是最后那段
 */
function enName(title) {
  const p = coreSegments(title).map(stripTailLabel);
  const disp = displayName(title);
  const key = (s) => String(s).toLowerCase().replace(/\s+/g, '');
  for (let i = 0; i < p.length; i++) {
    if (!p[i] || CJK.test(p[i])) continue;
    if (key(p[i]) === key(disp)) continue;
    return p[i];
  }
  return '';
}

module.exports = {
  CJK, TAG_MIN_TAIL, FALLBACK_TAGS, TAIL_LABEL_RE,
  segments, deriveTags, tagSet, resetTags, coreSegments, stripTailLabel, displayName, enName,
};
