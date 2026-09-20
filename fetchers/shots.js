/**
 * fetchers/shots.js —— 截图 URL 归一（两个 fetcher **共用同一份**，不写第二遍）
 *
 * ★ v10.25 为什么要有这个文件
 *   v10.24 实测发现：详情页「游戏预览」区域，两个源站**都抓错了**——
 *     · 机地 `jidi.js` 用「抓整页 img」，命中的是 `topic/cover`，
 *       而那是**详情页下半部分相关推荐列表里别的游戏的封面**；
 *     · XD  `xdgamer.js` 用 `img.lazy[data-original]` 且要求路径含 `/uploads/`，
 *       命中的是**文章配图**（常常就是封面本身）。
 *   真实数据两边都完整存在，只是没读对字段（修法见各自 fetcher 的注释）。
 *   归一规则必须只有一处 —— 否则下次改尺寸策略，同一条记录会出现两个不同 URL。
 *
 * ★ Steam CDN 尺寸后缀（实测 2026-09-20）
 *   `…/store_item_assets/steam/apps/<appid>/ss_<hash>.600x338.jpg`   → 200 / 67KB
 *   `…/store_item_assets/steam/apps/<appid>/ss_<hash>.1920x1080.jpg` → 200 / 573KB
 *   同一张图换后缀即可，两个尺寸都真实存在 ⇒ 缩略图用 600x338、大图用 1920x1080。
 *
 *   ⚠️ ★ 探测可用性**绝对不能用 HEAD**：该 CDN 对 HEAD 一律返回 404（假信号），
 *      只有 GET 才准。2026-09-20 我因此一度误判「截图全挂」。
 *      （同族：PITFALLS 里「假红 / 假绿」那一类 —— 探针本身说谎。）
 */

/** 尺寸后缀：600x338（缩略）/ 1920x1080（大图）/ 少数站点给 360x203、240x135 */
const SZ_RE = /\.(?:600x338|1920x1080|360x203|240x135|293x165)\.jpg(?=$|[?#])/i;
/** 只认源站截图形态：Steam 资源路径。其它一律不当作截图（避免混进 logo / 头图 / 表情） */
const SHOT_RE = /\/store_item_assets\/steam\/apps\/\d+\/|ss_[0-9a-f]{20,}/i;
/** 同一张图的稳定身份 = 路径里那段 `ss_<hash>`；没有它就退回文件名 */
const idOf = (u) => {
  const m = String(u || '').match(/ss_[0-9a-f]{16,}/i);
  if (m) return m[0].toLowerCase();
  try {
    return new URL(u).pathname.split('/').pop().toLowerCase();
  } catch (e) { return String(u || '').toLowerCase(); }
};

function withSize(u, size) {
  const s = String(u || '');
  if (!SZ_RE.test(s)) return s;                                  // 没有尺寸后缀就原样用
  return s.replace(SZ_RE, '.' + size + '.jpg');
}
const thumbOf = (u) => withSize(u, '600x338');
const fullOf = (u) => withSize(u, '1920x1080');

/**
 * 归一成一个截图列表。入参可为字符串数组，或 `[{urls:{default:{urls:[...]}}}]` 这种机地结构。
 * 返回 `[{ t: 缩略图, f: 大图 }]`，按 `ss_<hash>` 去重，最多 limit 张。
 *
 * ★ 为什么返回对象而不是纯 URL 字符串：
 *   前端画廊要「缩略图条」和「大图」两个尺寸。若只给一个 URL、让前端自己换后缀，
 *   那条尺寸规则就有两份实现（服务端一份、前端一份），迟早漂移。
 *   ⇒ 形态由服务端一次定清楚，前端不再做任何 URL 改写。
 */
function list(input, limit = 12) {
  const out = [];
  const seen = new Set();
  const push = (u) => {
    const s = String(u || '').trim();
    if (!s || !/^https?:/i.test(s)) return;
    if (!SHOT_RE.test(s)) return;                                // 只收截图形态
    const k = idOf(s);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ t: thumbOf(s), f: fullOf(s) });
  };
  for (const it of (Array.isArray(input) ? input : [])) {
    if (typeof it === 'string') { push(it); continue; }
    /* 机地形态：{ urls: { default|540|360|240: { urls: [u] } } }
     * ★ 实测这几个尺寸键**给的是同一个 URL**（都是 600x338），所以按固定优先级取一个就够。 */
    const u = it && it.urls;
    if (u) {
      for (const key of ['default', '540', '360', '240', '0']) {
        const arr = u[key] && u[key].urls;
        if (Array.isArray(arr) && arr.length) { push(arr[0]); break; }
      }
    }
  }
  return out.slice(0, limit);
}

/**
 * 合并两组**已经归一过**的截图（`[{t,f}]`），按 `ss_<hash>` 去重，先出现的优先。
 *
 * ★ v10.25 为什么需要它（不能直接用上面的 `list()`）：
 *   `list()` 吃的是**上游原始形态**（字符串 / 机地 `{urls:{…}}` 对象），
 *   而 `detail()` 返回的 `shots` 已经是 `{t,f}` —— 把 `{t,f}` 再喂给 `list()` 会一张都收不到
 *   （`list()` 里没有 `item.f` 这条分支），于是「双源合并」会静默变成「一张都没加」。
 *   两件事分开写，比在 `list()` 里加一条模糊分支安全。
 *
 * ★ 去重键必须与 `list()` 用同一个 `idOf`：两个源给的是同一套 Steam CDN 地址，
 *   机地 9 张 + XD 8 张实测有大量重叠 ⇒ 按 `ss_<hash>` 去重后得到的是**并集**。
 */
function merge(a, b, limit = 24) {
  const out = [];
  const seen = new Set();
  for (const src of [a, b]) {
    for (const it of (Array.isArray(src) ? src : [])) {
      if (!it) continue;
      const f = typeof it === 'string' ? it : (it.f || it.t || '');
      if (!f || !/^https?:/i.test(f)) continue;
      const k = idOf(f);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(typeof it === 'string' ? { t: thumbOf(f), f: fullOf(f) } : { t: it.t || thumbOf(f), f: it.f || fullOf(f) });
    }
  }
  return out.slice(0, limit);
}

module.exports = { list, merge, thumbOf, fullOf, idOf, SHOT_RE, SZ_RE };
