/**
 * search-rank.js — 全站搜索「模糊匹配 + 相关度打分」的唯一真源（★ v10.54 新建）
 *
 * ★ 为什么要有这个文件
 *
 *   v10.54 改前实测（`tools/_probe-fuzzy-base.js`）——
 *   同一个查询，四个库给出**互相矛盾**的答案：
 *
 *     查询            端游   手游   修改器  存档
 *     「巫师3 狂猎」    0      1      2      1     ← 端游一枪不放
 *     「艾尔登 法环」   0      2      7      2     ← 同上
 *     「狂猎 巫师」     0      0      0      0     ← 全站 0（纯乱序）
 *     「巫师3」         3      1      2      1     ← 正常
 *
 *   根因有两层，都不是「数据没有」：
 *   ① `data/gamesDb.js` 是四个库里**唯一没做归一化**的 —— 只 `toLowerCase().includes()`。
 *      中文标题里是 `：`/`—`，用户键盘敲的是空格 ⇒ 永远匹配不上。
 *      其余三库走了 `normKey`，所以它们有命中。
 *   ② 那三库虽然归一化了，却**都没有相关度排序** —— 只按各自的业务排序
 *      （configs / lib / paths），等于「命中了但不知道哪条更准」。
 *
 *   ⇒ 匹配与打分是「同一件事」，只允许有一份实现；本文件即那一份。
 *
 * ★ 对外两件事，四个库共用（`gamesDb` / `mobilehub` / `trainers` / `saves`）：
 *   ① `rank(query, names)`     模糊匹配（多词**顺序无关**）+ 分级相关度
 *   ② `sortByRank(query, …)`   按相关度**稳定**排序（同分保持调用方原有业务序）
 *
 * ★ 分级（score **越小越相关**；`NONE` = 不命中）
 *   0 EXACT       归一化后完全相等
 *   1 PREFIX      归一化后以查询开头
 *   2 CONTAINS    连续子串命中 —— ★「查询里的空格 vs 标题里的分隔符」在这一层就被
 *                 `normKey` 抹平（`巫师3 狂猎` → `巫师3狂猎`，标题 `巫师3：狂猎` → 同）
 *   3 TOKEN_ALL   ★ 模糊层：查询拆词后**全部**命中（顺序无关）——
 *                 救「狂猎 巫师」「法环 艾尔登」这类乱序输入
 *   4 TOKEN_SOME  模糊层：覆盖率 ≥ 0.6，覆盖率越高分越小（`4 + (1-覆盖)`）
 *
 * ★ 为什么 token 层「全命中」给 3、「部分命中」才给 4
 *   乱序输入必须能救回来，但救回来 ≠ 不分轻重：全命中排在前、部分命中排在后，
 *   这正是用户要的「准确的权重更高」。用户口径原话：
 *   「我需要的是模糊搜索，准确较高的权重更高」。
 */

const { normKey, genNums } = require('./name-normalize');

/* ---- 相关度分级（score **越小越相关**） ---- */
const EXACT = 0;
const PREFIX = 1;
const CONTAINS = 2;
const TOKEN_ALL = 3;
const TOKEN_SOME = 4;
const NONE = Number.MAX_SAFE_INTEGER;

/** 部分命中时要求的最低覆盖率（低于它视为「不沾边」，不召回）
 *
 *  ★ 为什么是 0.7 而不是 0.6（v10.54 实测定标）：
 *    0.6 时两条**不相关**的条目会越过门槛 ——
 *      · 搜「赛博朋克 2077」→ 召回「赛博朋克商店模拟器」（2/3 = 0.667，只是同前缀不是同款）
 *      · 搜「黑神话 悟空」  → 召回「黑神话时空」        （2/3 = 0.667）
 *    0.7 正好切在这两例之上、而**该留的**留在下面：
 *      · 搜「生化危机4 重制」→「生化危机4重置版」（3/4 = 0.75，"重制/重置"同义，召回是对的）
 *    ⇒ 门槛卡在「同义词召回」与「同前缀误召回」之间。 */
const MIN_COVER = 0.7;

const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const LAT_RE = /[a-z]/;
const DIG_RE = /[0-9]/;

function clsOf(ch) {
  if (LAT_RE.test(ch)) return 'lat';
  if (DIG_RE.test(ch)) return 'dig';
  if (CJK_RE.test(ch)) return 'cjk';
  return '';   // 归一化后基本不该走到（符号已被剥），当分隔符处理
}

/**
 * 查询拆词：
 *   ① 归一化后按「字符类别」分段（CJK 段 / 拉丁段 / 数字段）——
 *      于是「艾尔登 法环」→ [`艾尔登`, `法环`]
 *   ② 长度 ≥ 4 的 CJK 段再按**不重叠 2-gram** 切开 ——
 *      于是「狂猎巫师」→ [`狂猎`, `巫师`]，能命中「巫师3：狂猎」（改前实测 0 命中）
 *
 * ⚠️ 只在「整串 CONTAINS 失败」后才调用，所以正常查询不受影响。
 */
function tokensOf(key) {
  const out = [];
  let buf = '';
  let cls = '';
  const flush = () => {
    if (!buf) return;
    if (cls === 'cjk' && buf.length >= 4) {
      for (let i = 0; i < buf.length; i += 2) out.push(buf.slice(i, i + 2));
    } else out.push(buf);
    buf = '';
    cls = '';
  };
  for (const ch of String(key == null ? '' : key)) {
    const c = clsOf(ch);
    if (!c) { flush(); continue; }
    if (c !== cls) flush();
    cls = c;
    buf += ch;
  }
  flush();
  return out;
}

/** 单个名字对**已归一化的查询**打分（qk / qNums 由 `rank` 算好，避免逐名重算） */
function rankOne(qk, name, qNums) {
  const nk = normKey(name);
  if (!nk) return NONE;
  /* ★ 代际护栏 —— `name-normalize.genNums`（v10.36 为**建库侧**匹配写的）
   *   在 v10.54 第一次用到**读侧搜索**上，因为不加它的实测后果很硬：
   *
   *   搜「生化危机4」→ 20 条，其中 **16 条是纯噪音**：
   *     生化危机5：黄金版 / 生化危机6 / 生化危机7：黄金版 / 生化危机8：村庄 /
   *     生化危机9：安魂曲 / 生化危机：启示录 / …
   *   原因：`生化危机` 被切成 [`生化`,`危机`]，两段都命中 ⇒ 覆盖率 2/3 = 0.667
   *   越过 0.6 门槛，于是**「搜 4 出 5」**。用户口径是「准确较高的权重更高」，
   *   这种召回不是模糊而是失准。
   *
   *   只做**单方向**拒绝（查询有数字 → 名字必须含），不引入新的假阳性 ——
   *   与 v10.36 里 `numMismatchByTitle` 的定论一致（反向拒会把
   *   `Tomb Raider` → `古墓丽影9终极版` 这类**正确**匹配误杀）。
   *   `genNums` 本身已排除 3~4 位年份（`2022` / `2014`）与紧贴字母的数字（`x64`）。
   *
   *   ⚠️ 取数必须用**原始 name**，不能用 nk —— 归一化会吃掉空格把数字粘起来
   *   （`Warfare 2 2009` → `warfare22009` 会被切成 ['2200','9']），这是 v10.36 踩过的坑。 */
  if (qNums.length && !qNums.some((x) => genNums(name).includes(x))) return NONE;
  if (nk === qk) return EXACT;
  if (nk.startsWith(qk)) return PREFIX;
  if (nk.includes(qk)) return CONTAINS;
  const toks = tokensOf(qk);
  if (toks.length >= 2) {
    let hit = 0;
    for (const t of toks) if (nk.includes(t)) hit++;
    if (hit === toks.length) return TOKEN_ALL;
    const cover = hit / toks.length;
    if (cover >= MIN_COVER) return TOKEN_SOME + (1 - cover);
  }
  return NONE;
}

/**
 * 主入口：给一组名字（标题 / 别名 / 中文名 / 英文名 / 库标题 …）打分，取**最优**那条。
 * 返回 score（越小越相关）或 `NONE`（不命中）。
 */
function rank(query, names) {
  const qk = normKey(query);
  if (!qk) return NONE;
  const qNums = genNums(query);
  let best = NONE;
  for (const nm of names || []) {
    if (nm == null || nm === '') continue;
    const s = rankOne(qk, String(nm), qNums);
    if (s < best) {
      best = s;
      if (best === EXACT) break;
    }
  }
  return best;
}

/**
 * 相关度 → 前端**组间**排序用的 0..3 贴合度（**越大越好**）。
 * 与 v10.7 起前端 `paintSearchResult` 里那个 `fit()` 同义 —— v10.54 起由本函数统一给出，
 * 前端不再自算（同一个语义不写第二份实现）。
 *
 * ⚠️ 入参允许 `null`（各库无命中时不报分数）⇒ 必须先判空，否则 `null < NONE` 为真、
 *    会把「没命中」判成 fit 1（组间排序直接错位）。
 */
function fitOf(score) {
  if (score == null) return 0;
  if (score === EXACT) return 3;
  if (score === PREFIX) return 2;
  return score < NONE ? 1 : 0;
}

/**
 * 按相关度**稳定**排序：同分保持调用方传入的原有次序（= 各库自己的业务排序）。
 *
 * @param {string} query
 * @param {Array}  items  已经过口径过滤、且已按业务序排好的数组
 * @param {(it:any)=>string[]} pick  从条目取「参与匹配的名字数组」
 * @returns {{items:Array, topScore:number}}
 */
function sortByRank(query, items, pick) {
  const scored = [];
  for (const it of items) {
    const s = rank(query, pick(it));
    if (s < NONE) scored.push([s, it]);
  }
  scored.sort((a, b) => a[0] - b[0]);   // V8 稳定排序 ⇒ 同分保持业务序
  return { items: scored.map((x) => x[1]), topScore: scored.length ? scored[0][0] : NONE };
}

module.exports = {
  EXACT, PREFIX, CONTAINS, TOKEN_ALL, TOKEN_SOME, NONE, MIN_COVER,
  tokensOf, rank, rankOne, fitOf, sortByRank,
};
