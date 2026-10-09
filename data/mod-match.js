/**
 * data/mod-match.js — 「跨源名称匹配」的匹配键与索引构建
 *
 * ★ 归一化的**唯一真源**是 `data/name-normalize.js`；本模块只负责「键怎么用」——
 *   `/` 切段、长度护栏（CJK 放行 2 字）、索引构建与命中。
 *   v10.46 之前本文件自带一份字符类，与 SYMBOLS 不等价（见下面 normKey 处的说明）。
 *
 * 被 tools/fetch-mods.js 使用；从该脚本里抽出来是为了能**离线单测**
 * （tools/test-mods.js 直接 require 本模块，不用真的联网跑一遍抓取）。
 *
 * 为什么需要这一层 —— 机地的「游戏名」和端游库的「标题」是两个来源，
 * 两边都有同一个坑，处理错一个匹配率就腰斩（实测 55% → 79.1%）：
 *
 *   ① 端游库 title 是**多语言斜杠拼接串**：`艾尔登法环/ELDEN RING`。
 *      整串归一化会把 `/` 吃掉，变成 `艾尔登法环eldenring` 这种拼接怪物 → 永远匹配不上。
 *      → 必须按 `/` 切段，每段单独入索引。
 *
 *   ② 机地侧同样可能是拼接串：`生化危机9：安魂曲/Resident_Evil_Requiem`。
 *      → 条目侧也要按 `/` 分段逐个试。
 *
 *   ③ 索引键的**长度护栏**不能照搬英文场景的 `length >= 3`：
 *      2 字中文游戏名（`剑星`/`鸣潮`/`仁王`/`传送门`）会被整类误杀，而它们在库里明明有。
 *      → 含 CJK 放行 2 字；纯 ASCII 仍要求 ≥3，避免 `ab` 这类噪声键。
 */
/* ★ v10.46：归一化实现**收口到 data/name-normalize.js**（项目声明的唯一真源），
 *   本模块不再自带字符类。
 *   为什么必须收：这里原来有一份**独立**字符类，与 name-normalize 的 SYMBOLS 不等价 ——
 *   本份缺 `™®©°′″#@$%^;；＊`（实测 23,529 个真实名称里 **293 个键不同 = 1.245%**，
 *   例如 `#DRIVE Rally` / `STEINS;GATE` / `180°`）。
 *   同一份数据只要「索引用 A、查询用 B」，这 1.245% 就会**静默漏配**（本项目铁律 17）。
 *   收口的影响面已实测：游侠存档带书名号的 1,625 条命中数 **1211 → 1211（差异 0）** ——
 *   索引与查询同时换键，结果不变；这正是「唯一真源」在本项目里唯一安全的换法。
 *   ⚠️ 是 `tools/test-shared-destructure.js` 的第 ⑤ 段（自动发现共享模块 + 比对解构完整性）
 *     把这处漏网点抓出来的 —— 上一轮 v10.36 收口 SYMBOLS 时漏了本文件。 */
const { normKey } = require('./name-normalize');

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/;

/** 索引键是否可用（见文件头 ③） */
function keyUsable(k) {
  if (!k) return false;
  if (CJK_RE.test(k)) return k.length >= 2;
  return k.length >= 3;
}

/** 建端游库索引：`/` 切段 + 别名，逐段入索引（同键先到先得） */
function buildLibIndex(all, extraKeyOf) {
  const byName = new Map();
  const add = (k, it) => { if (keyUsable(k) && !byName.has(k)) byName.set(k, it); };
  for (const it of all) {
    for (const seg of String(it.title || '').split('/')) add(normKey(seg), it);
    for (const a of it.aliases || []) add(normKey(a), it);
    if (extraKeyOf) add(normKey(extraKeyOf(it)), it);
  }
  return { byName };
}

/** 条目侧游戏名 → 端游库条目：按 `/` 分段逐个试，命中即返回 */
function matchLib(game, byName) {
  const g = String(game || '').trim();
  if (!g) return null;
  for (const seg of g.split('/')) {
    const k = normKey(seg);
    if (!keyUsable(k)) continue;
    const hit = byName.get(k);
    if (hit) return hit;
  }
  return byName.get(normKey(g)) || null;
}

/* ★ v10.46：本模块**不再导出 `normKey`**。
 *   导出它就等于对外开了一条「从 mod-match 拿键」的路 —— 而键的算法已收口到
 *   data/name-normalize.js（见上面 normKey 的定义处），多一条转发路径只会让下一个人
 *   继续从两个地方取键。要用键请直接 `require('../data/name-normalize')`。
 *   （`tools/test-shared-destructure.js` 的规则是「用了某模块的导出名就必须从该模块解构」，
 *     所以「转发导出」在这里不是无害的兼容层，而是会持续产生告警的错位。） */
module.exports = { keyUsable, buildLibIndex, matchLib, CJK_RE };
