/**
 * data/rank-fill.js — 首页榜单「本地库补位」纯函数（v10.74 新增，v10.75 降级为兜底）
 *
 * ★★ v10.75 状态变更（**别再照旧注释理解本模块**）：
 *   榜单源已从「XD 首页 `.hot-soft .plate-list`（每档实测只有 10 行）」换成
 *   「XD `/update/` 的 8 个 panel（**每档实测 100 行**）」+ 机地热榜双源融合
 *   ⇒ 每档候选池 108+ 条，**正常情况下永远轮不到补位**。
 *   本模块因此**降级为兜底**：只在源站整档抓取失败 / 返回空表时，才用本地库热度凑够展示位，
 *   以免首页出现「轮播空着 + 卡片只剩几格」的破相。
 *
 * 为什么当初需要它（**保留为历史依据**）：
 *   首页要展示 11–13 个，而旧源每档 SSR **只有 10 行**（全站榜再剔 1 条工具 ⇒ 9 行）；
 *   且已实测排除「源站还有更多可拿」：`/rank/`、`/top/`、`/hot/`、`/paihang/`、
 *   `/rank.html`、`/hot.html` 全部 **404**。（该结论只对**旧源**成立，对 `/update/` 不适用。）
 *
 * ★★ 补位条目与源站榜**不同源**，这是本模块唯一必须守住的边界：
 *   标 `filled:true` 交给前端换措辞与配色（「库内热度」而非「🔥 热度」）。
 *   实测依据：旧源榜单条目**几乎没有热度值**（周 0/10、月 1/10、全站 3/9 —— 源站榜行
 *   不带热度，库里对应条目又大多没有 `hot`），所以补位条目一旦照常显示
 *   「🔥 34.8 万 热度」，会比第 1–10 名还显眼，看着像「榜单从第 11 名起才变真」。
 *
 * ★ 池子质量实测（2026-10-14）：`hot > 0` 的 **9869 条全部有封面**（9869/9869）。
 *   **仍要求 cover** —— 这是首页展示位，无图卡（首字色块）的观感代价远大于「少补一条」。
 */

/* ★ v10.76：展示位随卡片改「3 列 × 3 行」而变成 14（轮播 5 + 卡片 9）。
   ★★ v10.77：卡片改「**5 列 × 3 行 = 15**」（用户口径「参考这个…每一行都铺满而不是遗漏（三行）」）
   ⇒ 展示位变成 **20**（轮播 5 + 卡片 15）。
   ★ 这是**桌面口径**：窄屏（≤760px）由 CSS 的 `nth-child(n+7)` 把卡片收到 6 张（2 列 × 3 行），
     但服务端与骨架仍按 20 备货 —— 窄屏要的是「少显示」，不是「少取数」。
   这个数只在这里定义一处，服务端 meta 与前端分段都从这里取。 */
const RANK_SHOW_N = 20; // 首页榜单总展示数（轮播 5 + 卡片 15）
const RANK_CAR_N = 5;   // 轮播位条数

/* ★ v10.75：非游戏条目判据**合并到单一真源** `data/rank-merge.js`。
   原先它在本文件与 `fetchers/xdrank.cleanPlate` 里各写一份（同段逻辑两处实现）。 */
const { TOOL_RE, coverScore } = require('./rank-merge');

/**
 * 源站榜单不足 n 条时，用本地库按热度降序补足。**纯函数**，便于离线回归。
 * ★ v10.75 起这是**兜底路径**（新源每档 100 条），正常数据下 `filled` 恒为 0。
 *
 * @param {Array} list 源站榜单（已映射本地库字段、已重编号）
 * @param {Array} all  本地库全量（`gamesDb.all()`）
 * @param {number} [n] 目标条数，默认 `RANK_SHOW_N`（v10.77 = 20）
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
    /* ★ v10.75：融合后的条目带可能带 `jidiUrl`，也要进去重集 ——
       否则「库里同一款游戏的 XD 记录」会与「已在榜上的机地条目」重复占位。 */
    if (x && x.jidiUrl) seenUrl.add(x.jidiUrl);
  }

  const pool = (Array.isArray(all) ? all : [])
    .filter(
      (g) =>
        g &&
        Number(g.hot) > 0 &&
        g.cover &&
        (g.url || g.jidiUrl) &&
        !TOOL_RE.test(g.title || '') &&
        !seenUrl.has(g.url) &&
        !seenUrl.has(g.jidiUrl) &&
        !seenTitle.has(String(g.title || '').trim())
    )
    .sort((a, b) => (Number(b.hot) || 0) - (Number(a.hot) || 0));

  const out = base.slice();
  for (const g of pool) {
    if (out.length >= target) break;
    /* ★ v10.75：补位条目也要带 `coverQ` —— 否则 meta 的「封面大图 n/m」会把补位条目算成 0，
       指标就永远偏低且没人知道为什么（补位正常恒为 0，一旦非 0 这个数就是唯一线索）。 */
    out.push({ ...g, rank: out.length + 1, filled: true, coverQ: coverScore(g.cover) });
  }
  return { list: out, filled: out.length - srcN, srcN };
}

module.exports = { fillRank, RANK_SHOW_N, RANK_CAR_N, TOOL_RE };
