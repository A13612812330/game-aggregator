/**
 * data/mod-match.js — 「跨源名称匹配」的匹配键与索引构建（**单一真源**）
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
function normKey(s) {
  return String(s || '').toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[：:·・,，.。!！?？'"“”‘’()（）\[\]【】《》<>~～\-–—_+*&/／|｜\\]/g, '');
}

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

module.exports = { normKey, keyUsable, buildLibIndex, matchLib, CJK_RE };
