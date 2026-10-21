/**
 * data/game-dedupe.js — 「同一款游戏被收录成多条」的折叠层（v10.94）
 *
 * ── 为什么需要（2026-10-21 用户口径）──────────────────────────────────────
 * 用户原话：「为什么同个游戏会分成两个」，截图是后台游戏库里的
 *   星露谷物语/Stardew Valley/支持网络联机   xd-7613
 *   星露谷物语/Stardew Valley                xd-542
 * 真因不是重复抓取，而是**源站本身就是两条独立帖子**（一个是「支持网络联机」的整合版，
 * 一个原版），端游库按「帖子」入账 ⇒ 同一款游戏多行。全库实测：
 *   19,732 条 → 18,821 个游戏键，**895 组重复、可合并掉 911 条**（4.6%）。
 *
 * ── 折叠键怎么取（复用 game-name 的唯一真源，不另写一份）─────────────────
 *   `game-name.coreSegments()` 已经处理了「/支持网络联机」「/支持VR」「/附历代合集」
 *   这类**尾部标签**（推导规则：末位 ≥8 次且从未出现在首位）。折叠键再取
 *   「前两段（中文名 + 英文名）」做归一化 —— 第 3 段起是别名/版本说明，
 *   多取会把不同游戏并到一起（这项目被名称匹配坑过，见 cross-source-name-matching）。
 *
 * ── 代表项怎么选 ─────────────────────────────────────────────────────────
 *   优先级：XD 源（有站内详情页） > 热度高 > 更新时间。其余条目收进 `alts`，
 *   由调用方决定怎么展示（后台列表显示「+N 版本」，名单页合并成一行）。
 *
 * ⚠️ 本模块**只折叠展示**，不删数据、不改 data/games.json。原条目仍然可按 id 查到，
 *    所以详情页 / 搜索结果 / 人工覆盖都不受影响。
 */
'use strict';

const gn = require('./game-name');

/** 归一化：去商标符、去分隔标点、去空白、小写。 */
function normSeg(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[\u2122\u00ae\u00a9]/g, '')
    .replace(/[\s\-_·:：'"“”，,。.!！?？()（）\[\]【】]+/g, '');
}

/** 折叠键：核心名的前两段（中文名 + 英文名），无核心名时退回 id。 */
function groupKey(title) {
  const p = gn.coreSegments(title).map(gn.stripTailLabel).filter(Boolean);
  if (!p.length) return '';
  return p.slice(0, 2).map(normSeg).join('|');
}

/** 组内排序分：XD 源优先，其次热度，其次更新时间。 */
function pickScore(g) {
  const src = /xd/i.test(String(g.source || '')) ? 1e12 : 0;
  return src + (Number(g.hot || g.dpv || 0) * 1e3) + Math.min(Number(g.updatedTs || 0) / 1e6, 999);
}

/** 首段归一化（用于「单段标题」的二级归并）。 */
function headKey(title) {
  const p = gn.coreSegments(title).map(gn.stripTailLabel).filter(Boolean);
  return p.length ? normSeg(p[0]) : '';
}

/**
 * 折叠一批库行（**必须已排序**，输出按组首次出现位置排列）。
 *
 * 两级归并（第二级是必须的，否则「星露谷物语」这种**只有中文名**的机地记录会单独成行）：
 *   ① 主键 = 核心名前两段（中文名|英文名）—— 精确，实测零误并；
 *   ② 单段标题（无英文名，如「星露谷物语」）按**首段**并入唯一的两段组。
 *      护栏：首段归一化长度 ≥ 4 且该首段只对应**一个**两段组。
 *      ⚠️ 不能直接用首段当主键：实测会误并 14 组 ——「游戏商店模拟器/Console Shop Simulator」
 *      与「游戏商店模拟器/Game Store Simulator」是不同游戏，「烟花模拟器/Fireworks Mania」
 *      与「烟花模拟器/Fireworks Simulator: Realistic」也是。
 *
 * @returns {{items:Array, merged:number, groups:number}}
 *   items 每项 = 代表行（原样字段） + { dupCount, alts:[{id,title,size,hot,url,source}] }
 */
function collapse(list) {
  const rows = Array.isArray(list) ? list : [];
  const map = new Map();
  for (const g of rows) {
    const k = groupKey(g.title) || ('id:' + g.id);
    let a = map.get(k);
    if (!a) { a = []; map.set(k, a); }
    a.push(g);
  }

  /* ② 单段标题并进唯一的两段组 */
  const headToMulti = new Map();
  for (const [k, arr] of map) {
    if (k.indexOf('|') < 0) continue;                 // 单段组，跳过
    const h = headKey(arr[0].title);
    if (!h) continue;
    let l = headToMulti.get(h);
    if (!l) { l = []; headToMulti.set(h, l); }
    l.push(k);
  }
  const singles = [];
  for (const [k, arr] of map) if (k.indexOf('|') < 0) singles.push(k);
  for (const k of singles) {
    if (k.length < 4) continue;                        // 太短（「不」这类）不并
    const targets = headToMulti.get(k);
    if (!targets || targets.length !== 1) continue;     // 只有一个目标组才并
    const dst = map.get(targets[0]);
    const src = map.get(k);
    if (!dst || !src) continue;
    for (const g of src) dst.push(g);
    map.delete(k);
  }

  const out = [];
  let merged = 0;
  for (const arr of map.values()) {
    if (arr.length === 1) { out.push(arr[0]); continue; }
    const pick = arr.slice().sort((a, b) => pickScore(b) - pickScore(a))[0];
    const rep = Object.assign({}, pick, {
      dupCount: arr.length,
      alts: arr.filter((x) => x !== pick).map((x) => ({
        id: x.id, title: x.title, size: x.size,
        hot: x.hot != null ? x.hot : x.dpv, url: x.url, source: x.source,
      })),
    });
    out.push(rep);
    merged += arr.length - 1;
  }
  return { items: out, merged, groups: map.size };
}

module.exports = { groupKey, headKey, collapse, normSeg, pickScore };
