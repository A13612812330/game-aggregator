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
const { genNums } = require('./name-normalize');

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

/* ────────────────────────────────────────────────────────────────────────────
 * ★ v10.55 子串回退（subMatch）—— 修「端游资源页整批无关联」
 *
 * 【为什么必须加】
 *   匹配键一直只有「精确命中」一条路（`byName.get(k)`）。而 MOD 源的 `game` 是**泛称**，
 *   端游库的 title 是**具体版本名**，两边常差一个版本后缀 —— 精确键必然全漏。
 *   实测（2026-10-10）：mods 8,943 条里 **1,867 条（20.9%）libId 为空**；
 *   而 `data/mods.js` 默认 `matchedOnly = true` ⇒ 这些条目在端游资源页**一条都不显示**。
 *   大头：`Grand Theft Auto V 传承版` **536 条** · `荒野大镖客2` 148 · `街头霸王6` 137 ·
 *        `黑神话:悟空` 127 · `巫师3：狂猎` **94**（用户报障样本）· `明末：渊虚之羽` 56 …
 *
 * 【为什么不能只做正向】
 *   第一版探针只查「库键 ⊃ 查询键」，结果 GTA V **候选为「无」**。
 *   真相是反向：条目键 `grandtheftautov传承版` ⊃ 库键 `grandtheftautov`（库键更**短**）。
 *   ⇒ 必须**双向**子串，否则最大的一头（536 条）直接漏掉。
 *
 * 【为什么不用长度比例当主判据】
 *   第一版用「短/长 ≥ 0.6」，把 `巫师3：狂猎`(5) 挂到了 `巫师3狂猎重制版`(8) ——
 *   因为正确的 `巫师3狂猎次世代版`(9) 比例 5/9=0.556 被挡在门外。
 *   ⇒ 比例只能是**粗筛**，真正的护栏是**数字一致**（见 G2）。
 *
 * 【五道护栏】缺一不可，宁可少救不可错配：
 *   G1 短键可用     —— 这里比索引键更严：CJK ≥ 3 / 纯 ASCII ≥ 4（索引层是 CJK ≥ 2）
 *   G2 数字一致     —— 查询带数字 ⇒ 候选键必须含（`genNums`，与项目既有代际护栏同源）
 *                      实测挡掉：`HELLDIVERS 2` → `Hell Dive`、`侏罗纪世界进化3` → `侏罗纪世界进化`
 *   G3 比例粗筛     —— 短/长 ≥ 0.5（只用于砍掉明显无关的长尾）
 *   G4 变体降级     —— 候选键含 虚拟机版/HYPERVISOR/Demo/试玩… ⇒ **不自动挂**
 *                      （见过 5 个 game 名被挂到「-虚拟机版」，那是另一种内容）
 *   G5 唯一/仲裁    —— 剩余多候选时取 **id 序号最小**者（= 更早收录的主条目），
 *                      并把 basis 标成 `substring-ambiguous` 供审计
 *                      实测仲裁正确：`巫师3：狂猎` → **xd-120**（MOD 标题写「巫师3次世代」，
 *                      且手游中心/修改器两侧也都指向 xd-120）；`剑与魔法` → xd-8221（VR 原版）
 * ──────────────────────────────────────────────────────────────────────────── */
const SUB_RATIO = 0.5;
const VARIANT_DOWN = /(虚拟机版|hypervisor|demo|试玩|序章|体验版|先行版|抢先体验)/i;
const SUB_CACHE = new WeakMap();

function subKeyUsable(k) { return !!k && k.length >= (CJK_RE.test(k) ? 3 : 4); }

/** 子串回退用的候选键清单（按 byName 缓存，避免每次重建） */
function subKeys(byName) {
  let c = SUB_CACHE.get(byName);
  if (!c) { c = { keys: [...byName.keys()] }; SUB_CACHE.set(byName, c); }
  return c.keys;
}

/** 取 id 末段数字用于仲裁（`xd-120` → 120 / `jidi-573742718` → 573742718；取不到给 Infinity） */
function idSeq(id) {
  const m = String(id || '').match(/(\d+)\s*$/);
  return m ? Number(m[1]) : Infinity;
}

/** 子串回退：返回 { it, k, basis, n } 或 null */
function subMatch(k, byName) {
  if (!subKeyUsable(k)) return null;
  const qNums = genNums(k);
  const cands = new Map();          // libId -> { k, it, down }
  for (const lk of subKeys(byName)) {
    if (lk === k) continue;
    const isLibLong = lk.length > k.length;
    const short = isLibLong ? k : lk;
    const long = isLibLong ? lk : k;
    if (!long.includes(short)) continue;
    if (short.length / long.length < SUB_RATIO) continue;   // G3
    if (!subKeyUsable(short)) continue;
    const it = byName.get(lk);
    if (!it || cands.has(it.id)) continue;
    if (qNums.length && !qNums.some((x) => genNums(lk).includes(x))) continue;   // G2
    cands.set(it.id, { k: lk, it, down: VARIANT_DOWN.test(lk) });               // G4
  }
  if (!cands.size) return null;
  const pool = [...cands.values()].filter((c) => !c.down);
  if (!pool.length) return null;                     // 只剩降级变体 ⇒ 不猜
  if (pool.length === 1) return { ...pool[0], basis: 'substring', n: cands.size };
  pool.sort((a, b) => idSeq(a.it.id) - idSeq(b.it.id));                          // G5
  return { ...pool[0], basis: 'substring-ambiguous', n: cands.size };
}

/** 条目侧游戏名 → 端游库条目：按 `/` 分段逐个试，命中即返回
 *  ① 精确键（原路径，结果不变）；② 精确未中才走子串回退（v10.55）
 *  ★ 顺序保证「已匹配的不会因为加回退而改变结果」——回退只填空白。
 *  ★ 需要知道「怎么匹配上的」用 `matchWithBasis`（产物里落 `matchBasis` 字段供审计）。 */
function matchWithBasis(game, byName) {
  const g = String(game || '').trim();
  if (!g) return { it: null, basis: '' };
  const segs = g.split('/');
  for (const seg of segs) {
    const k = normKey(seg);
    if (!keyUsable(k)) continue;
    const hit = byName.get(k);
    if (hit) return { it: hit, basis: 'exact' };
  }
  const whole = byName.get(normKey(g));
  if (whole) return { it: whole, basis: 'exact' };
  for (const seg of segs) {
    const r = subMatch(normKey(seg), byName);
    if (r) return { it: r.it, basis: r.basis };
  }
  return { it: null, basis: '' };
}

/** 兼容入口：只要条目（`tools/fetch-gtrainers.js` 等在用） */
function matchLib(game, byName) {
  return matchWithBasis(game, byName).it;
}

/* ★ v10.46：本模块**不再导出 `normKey`**。
 *   导出它就等于对外开了一条「从 mod-match 拿键」的路 —— 而键的算法已收口到
 *   data/name-normalize.js（见上面 normKey 的定义处），多一条转发路径只会让下一个人
 *   继续从两个地方取键。要用键请直接 `require('../data/name-normalize')`。
 *   （`tools/test-shared-destructure.js` 的规则是「用了某模块的导出名就必须从该模块解构」，
 *     所以「转发导出」在这里不是无害的兼容层，而是会持续产生告警的错位。） */
module.exports = { keyUsable, buildLibIndex, matchLib, matchWithBasis, subMatch, subKeyUsable, CJK_RE, SUB_RATIO };
