/**
 * data/rank-fill.js — 首页榜单「本地库补位」纯函数（v10.74 新增）
 *
 * 为什么需要它（**实测事实**，2026-10-14）：
 *   XD 官网首页 `.hot-soft .plate-list` 每档 SSR **只有 10 行**（三档实测都是 li 总数 10），
 *   全站榜再剔掉 1 条「XDGAME游戏运行库检测工具」⇒ **只剩 9 条**；
 *   机地社区档的 `hotRanks` 上限也是 `slice(0, 12)`。
 *   而 v10.74 首页要展示 **13 个**（轮播 5 + 卡片 2×4）⇒ 后半截必然空着。
 *   ★ 已实测排除「源站还有更多条目可拿」这条路：`/rank/`、`/top/`、`/hot/`、
 *     `/paihang/`、`/rank.html`、`/hot.html` 全部 **404**（XD 官网没有独立排行榜页）。
 *
 * ★★ 补位条目与源站榜**不同源**，这是本模块唯一必须守住的边界：
 *   标 `filled:true` 交给前端换措辞与配色（「库内热度」而非「🔥 热度」）。
 *   实测依据：榜单条目本身**几乎没有热度值**（周 0/10、月 1/10、全站 3/9 —— 源站榜行
 *   不带热度，库里对应条目又大多没有 `hot`），所以补位条目一旦照常显示
 *   「🔥 34.8 万 热度」，会比第 1–10 名还显眼，看着像「榜单从第 11 名起才变真」。
 *
 * ★ 池子质量实测（2026-10-14）：`hot > 0` 的 **9869 条全部有封面**（9869/9869）。
 *   **仍要求 cover** —— 这是首页展示位，无图卡（首字色块）的观感代价远大于「少补一条」。
 */

const RANK_SHOW_N = 13; // 首页榜单总展示数（轮播 5 + 卡片 8）
const RANK_CAR_N = 5; // 轮播位条数

/** 与源站 `cleanPlate` 同口径的非游戏条目过滤：榜单里混着运行库 / 检测工具 */
const TOOL_RE = /(运行库|检测工具)/;

/**
 * 源站榜单不足 n 条时，用本地库按热度降序补足。**纯函数**，便于离线回归。
 *
 * @param {Array} list 源站榜单（已映射本地库字段、已重编号）
 * @param {Array} all  本地库全量（`gamesDb.all()`）
 * @param {number} [n] 目标条数，默认 13
 * @returns {{list:Array, filled:number, srcN:number}}
 *   list  —— 定长（最多 n）的展示列表；补位条目标 `filled:true`
 *   filled —— 补了几条（0 = 源站本来就够，前端据此决定要不要显示「含库内补位」说明）
 *   srcN  —— 源站原有条数（改动前的长度，供 meta 如实说明）
 */
function fillRank(list, all, n) {
  const target = Number(n) > 0 ? Number(n) : RANK_SHOW_N;
  const base = (Array.isArray(list) ? list : []).slice(0, target);
  const srcN = base.length;
  if (srcN >= target) return { list: base, filled: 0, srcN };

  /* ★ 去重必须**同时**按 url 与 title —— 只按 url 会被「同款不同 url」
     （机地 topic 页 vs XD 游戏页）漏过去，首页上就会出现同一款占两个位。
     这与 `cleanPlate` / `twin.groupKey` 是同一条教训：归并键要多一道。 */
  const seenUrl = new Set();
  const seenTitle = new Set();
  for (const x of base) {
    if (x && x.url) seenUrl.add(x.url);
    if (x && x.title) seenTitle.add(String(x.title).trim());
  }

  const pool = (Array.isArray(all) ? all : [])
    .filter(
      (g) =>
        g &&
        Number(g.hot) > 0 &&
        g.cover &&
        g.url &&
        !TOOL_RE.test(g.title || '') &&
        !seenUrl.has(g.url) &&
        !seenTitle.has(String(g.title || '').trim())
    )
    .sort((a, b) => (Number(b.hot) || 0) - (Number(a.hot) || 0));

  const out = base.slice();
  for (const g of pool) {
    if (out.length >= target) break;
    out.push({ ...g, rank: out.length + 1, filled: true });
  }
  return { list: out, filled: out.length - srcN, srcN };
}

module.exports = { fillRank, RANK_SHOW_N, RANK_CAR_N, TOOL_RE };
