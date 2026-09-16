/**
 * data/date-norm.js — 日期字段归一化（**单一真源**）
 *
 * 为什么需要它：
 *   两个源站的日期格式不同 —— XDGAME 用 ISO（`2026-09-14`），
 *   机地用斜杠且不补零（`2026/9/9`）。更麻烦的是机地列表页文本里
 *   日期后面紧跟着别的数字，旧正则的贪婪匹配把它们并吞了：
 *
 *       源站真值 `2026/9/8`  →  入库成 `2026/9/89`     （多吞一个 9）
 *       源站真值 `2025/3/4`  →  入库成 `2025/3/48`     （多吞一个 8）
 *
 *   双重后果：
 *     ① 列表日期显示跳序（`8/12 更新` 夹在 `09-14` 与 `09-13` 之间）；
 *     ② 斜杠/畸形日期 `new Date()` 解析失败 → 兜底算出的 updatedTs 成了
 *        **NaN** → 该条在「最新更新」里被当作 0 排到最后，或与日期标签自相矛盾。
 *
 * 规则：
 *   · `2026/9/9` / `2026-09-09` → `2026-09-09`（统一 ISO + 补零）
 *   · `2026/9/89`（被吞位）      → `2026-09-08`（还原，算法见 shared.normDate）
 *   · 解析不出                    → 依次回退 releaseDate → null
 *   · updatedTs 为空/NaN 且能算出日期 → 用该日 00:00 UTC 兜底（保证可排序）
 *
 * 使用方（改这里，两处同时受益）：
 *   · data/gamesDb.js         —— 运行时 load 兜底（防每日增量再带进脏值）
 *   · tools/migrate-dates.js  —— 一次性修历史数据
 */
const { normDate, dateTs } = require('../shared');

/** 单个记录就地归一化。返回 { changed, reason } 便于统计与审计。 */
function normalizeOne(g) {
  if (!g || typeof g !== 'object') return { changed: false };
  const beforeLabel = g.dateLabel;
  const beforeTs = g.updatedTs;
  let reason = null;

  /* ① dateLabel → ISO（含还原被贪婪吃位的畸形值） */
  const iso = normDate(beforeLabel) || normDate(g.releaseDate) || null;
  if (iso !== beforeLabel) {
    g.dateLabel = iso;
    if (beforeLabel == null) reason = 'label:fill';
    else if (/^[^0-9]*(\d{4})[/-](\d{1,2})[/-](\d{1,3})/.test(String(beforeLabel))) {
      /* 原本就是日期形态但值变了 —— 要么补了零，要么还原了被吞的日 */
      const corrupted = String(beforeLabel).match(/[/-](\d{1,3})$/);
      reason = corrupted && +corrupted[1] > 31 ? 'label:repair' : 'label:normalize';
    } else reason = 'label:fill';
  }

  /* ② updatedTs 兜底：NaN / null / 0 都视为缺失。
   *    这里必须显式判 Number.isFinite —— JSON 里 NaN 会序列化成 null，
   *    但内存中若已存在 NaN，`|| 0` 这类写法并不能把它救回来。 */
  const ts = Number(beforeTs);
  if (!Number.isFinite(ts) || ts <= 0) {
    const t = dateTs(g.dateLabel);
    if (t) {
      g.updatedTs = t;
      reason = reason ? reason + '+ts:fill' : 'ts:fill';
    } else if (beforeTs !== null && beforeTs !== undefined) {
      g.updatedTs = null;               // 收拾掉 NaN / 0 这类残值
    }
  }

  return { changed: g.dateLabel !== beforeLabel || g.updatedTs !== beforeTs, reason };
}

/** 批量：就地把数组里每条记录归一化。返回统计对象。 */
function normalizeDates(list) {
  const stat = { total: 0, changed: 0, repair: 0, normalize: 0, fillLabel: 0, fillTs: 0, stillNoDate: 0 };
  for (const g of list || []) {
    if (!g || typeof g !== 'object') continue;
    stat.total++;
    const r = normalizeOne(g);
    if (!r.changed) {
      if (!g.dateLabel) stat.stillNoDate++;
      continue;
    }
    stat.changed++;
    if (r.reason && r.reason.includes('repair')) stat.repair++;
    else if (r.reason && r.reason.includes('normalize')) stat.normalize++;
    if (r.reason && r.reason.includes('label:fill')) stat.fillLabel++;
    if (r.reason && r.reason.includes('ts:fill')) stat.fillTs++;
    if (!g.dateLabel) stat.stillNoDate++;
  }
  return stat;
}

module.exports = { normalizeOne, normalizeDates };
