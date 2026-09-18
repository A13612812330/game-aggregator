/* data/deviceset.js —— 「机型串」的归一与合并（v10.17）
 *
 * 为什么需要它（用户原话：「还是没有完全展示所有机型」）：
 *   同一款游戏的机型，在两条数据链路里写法不同、条数也不同：
 *     · 社区库**聚合摘要** `data/bannerhub.json` 的 `dv` 字段
 *       —— 上游摘要**只有 6 格**（全库 2,648 条游戏里最大的 dv 长度就是 6，
 *          255 款正好卡在 6 格），多出来的机型被上游丢掉了；
 *       写法也残缺：`MTN NX3`、`BRP NX3`（品牌前缀与连字符都没了）。
 *     · **逐条配置** `data/bhparams.json` 的 `device` 字段
 *       —— 全量、写法规范：`HONOR MTN-NX3`、`samsung SM-A057M`。
 *   详情页的机型清单以前只读前者 → **结构性最多 6 台**，
 *   于是界面上出现「上游汇总了 6 款机型」这种看不懂的提示。
 *
 * 本模块把两边并起来：按「剥品牌前缀 + 去分隔符」的归一键对齐同一台手机，
 * 取值时**优先保留信息更全的那份写法**（有品牌前缀、有连字符的赢）。
 *   `MTN NX3` 与 `HONOR MTN-NX3` → 同一键 `MTNNX3` → 取 `HONOR MTN-NX3`
 * 实测（终极漫画英雄vs卡普空3）：6 台 → 11 台。
 *
 * ★ 品牌前缀表**只有一份**（`data/devicemarket.js` 的 BRAND_PREFIX），
 *   这里只做复用，绝不另写一套（否则同一台手机又会出现两个名字）。
 */
const { stripBrand, codeKey } = require('./devicemarket');

/** 机型身份键：剥品牌前缀 → 去掉所有非字母数字 → 大写
 *  `MTN NX3` / `HONOR MTN-NX3` / `honor mtn nx3` → `MTNNX3`
 *
 *  ⚠️ 只剥**一层**前缀，且 `moto` 既是品牌词又是型号词的一部分，所以
 *  `motorola moto g24`（→`MOTOG24`）与 `moto g24`（→`G24`）**不会**合并。
 *  这是刻意的：强行合并要引入「键集合求交集」，短键（`G24`）跨品牌误合并的风险更大。
 *  本项目两条数据链路对这台机器的写法一致，没有实际影响。 */
function devKey(s) {
  return codeKey(stripBrand(s));
}

/** 「信息量」打分：字母多、带分隔符（品牌前缀/连字符/空格）的写法更可信 */
function richness(s) {
  const t = String(s || '');
  return (t.match(/[A-Za-z]/g) || []).length * 2 + (t.match(/[-_\s]/g) || []).length;
}

/** 两个写法取信息更全的那个（平局保留先来的，保证可复现） */
function betterName(a, b) {
  if (!a) return b;
  if (!b) return a;
  return richness(a) >= richness(b) ? a : b;
}

/**
 * 把多份机型清单并成一份（保序：先出现的键排前面）
 * @param  {...(string[]|undefined|null)} lists
 * @returns {string[]}
 */
function mergeDevices(...lists) {
  const map = new Map();   // key -> 展示写法
  for (const list of lists) {
    for (const raw of list || []) {
      const v = String(raw == null ? '' : raw).trim();
      if (!v) continue;
      const k = devKey(v);
      if (!k) continue;
      map.set(k, map.has(k) ? betterName(map.get(k), v) : v);
    }
  }
  return [...map.values()];
}

/** 合并结果的体检信息（前端要如实说明「哪来的、原有几台」时用） */
function mergeReport(summaryList, ...extraLists) {
  const summary = (summaryList || []).map((x) => String(x || '').trim()).filter(Boolean);
  const merged = mergeDevices(summary, ...extraLists);
  return {
    summary,
    merged,
    summaryCnt: summary.length,
    mergedCnt: merged.length,
    added: merged.filter((v) => !summary.some((s) => devKey(s) === devKey(v))),
  };
}

module.exports = { devKey, richness, betterName, mergeDevices, mergeReport };
