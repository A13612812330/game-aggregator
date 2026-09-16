/**
 * data/cover-url.js — 封面 URL 归一化（**单一真源**）
 *
 * 为什么需要它：
 *   端游库（XDGAME）里有一批条目的 cover 是**站内相对路径**（`/uploads/allimg/...`），
 *   共 223 条 / 15268。它们直接铺到 `<img src>` 上会打到本站 → 404 → 卡片只剩占位色块。
 *   另有个别脏数据（cover 里存的是分类串，如 `独立,黑暗,悬疑,…`）。
 *
 * 规则：
 *   · ''                       → ''（前端走占位）
 *   · http(s)://…              → 原样
 *   · //cdn…                   → 补 https:
 *   · /uploads/….png|jpg|…     → 补 https://www.xdgame.com 前缀
 *   · 其他（不像图片路径的）    → ''（宁可不显示，也不挂一张注定 404 的图）
 *
 * 使用方（改这里，三处同时受益）：
 *   · data/gamesDb.js          —— 运行时 load / upsert 兜底（防每日增量又带进相对路径）
 *   · tools/build-mobilehub.js —— 构建时写 libCover
 *   · tools/fix-cover-paths.js —— 一次性修历史数据
 */
const XD_BASE = 'https://www.xdgame.com';
const IMG_RE = /\.(png|jpe?g|webp|gif|avif|bmp|svg)(\?|#|$)/i;

function normalizeCover(c) {
  const s = String(c == null ? '' : c).trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('//')) return 'https:' + s;
  if (s.charAt(0) === '/' && IMG_RE.test(s)) return XD_BASE + s;
  return '';
}

/** 批量：就地把数组里每条 g.cover 归一化（返回改动条数） */
function normalizeList(list) {
  let n = 0;
  for (const g of list || []) {
    if (!g || typeof g !== 'object') continue;
    const before = g.cover;
    if (before === undefined) continue;
    const after = normalizeCover(before);
    if (after !== before) { g.cover = after; n++; }
  }
  return n;
}

module.exports = { normalizeCover, normalizeList, XD_BASE, IMG_RE };
