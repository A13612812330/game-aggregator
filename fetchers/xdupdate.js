/**
 * fetchers/xdupdate.js — XD 官网 `/update/` 页的**八个榜单**
 *
 * 为什么另起一个 fetcher（v10.75）：
 *   旧源是首页 `.hot-soft .plate-list`，实测**每档只有 10 行**（全站榜剔掉 1 条工具后 9 行），
 *   而首页要展示 11 个 ⇒ v10.74 只能靠「本地库热度补位」凑数。
 *   实测 `https://www.xdgame.com/update/` 页 **SSR 直出 8 个 `[data-panel]`、每档各 100 行、无 AJAX**
 *   ⇒ 换到这里之后不再需要补位（补位逻辑保留为源站故障时的兜底）。
 *
 * 结构（实测 2026-10-14，8 个 panel 全部命中）：
 *   <ul class="tab-panel …" data-panel="hot">
 *     <li>
 *       <em class="rk">1</em>                 名次（★ 只有 recent 面板没有这个节点）
 *       <span class="up-category">角色扮演</span>  分类标签
 *       <span class="up-badge is-new">新游</span>  徽标（★ 只有 recent 面板有）
 *       <i class="up-thumb"><img class="lazy" src="/images/defaultpic.gif"
 *                                data-original="真图"></i>   封面（真图在 data-original）
 *       <a class="tit" href="/game/191.html">赛博朋克2077/Cyberpunk 2077</a>
 *       <a class="link" href="/game/191.html">查看</a>
 *       <time class="num">381,875 热度</time>   数值（语义随 panel 变，见下）
 *     </li>
 *
 * ★ `a.tit` 的 `title` 属性实测是**空串**（首页那套源是有 title 的），名字只能取节点文本
 *   ⇒ 若沿用旧写法的 `$a.attr('title')` 会拿到 ''，再退回 text（text 里混着「查看」两字）。
 *   本模块**只读 `a.tit` 的 text**，并剥掉前后空白。
 *
 * `time` 的语义随 panel（实测）：
 *   hot/month/quarter/year → `381,875 热度`   good → `2,141 赞`
 *   rank                   → `10 分`          size → `554 GB`
 *   recent                 → `2026-10-14`（是**日期**，不是数值）
 *   ⇒ 统一放进 `value`（原样文本）与 `valueKind`（热度/赞/分/容量/日期），由展示层决定怎么用。
 */
const cheerio = require('cheerio');
const { getHtml } = require('../shared');
const { coverOf } = require('./xdrank');

const PAGE = 'https://www.xdgame.com/update/';
const HOME = 'https://www.xdgame.com/';
const PANELS = ['recent', 'hot', 'month', 'quarter', 'year', 'good', 'rank', 'size'];

let cache = null;
let cacheAt = 0;
const TTL = 30 * 60 * 1000; // 30 分钟（与 xdrank 同口径：官网热度为日更级）

/** 解析 `<time>` 文本 → { value, valueKind }（纯函数，便于离线回归） */
function readValue(txt) {
  const s = String(txt || '').replace(/\s+/g, ' ').trim();
  if (!s) return { value: '', valueKind: '' };
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) return { value: s, valueKind: 'date' };
  if (/赞$/.test(s)) return { value: s, valueKind: 'like' };
  if (/分$/.test(s)) return { value: s, valueKind: 'score' };
  if (/(?:GB|MB|TB|KB)$/i.test(s)) return { value: s, valueKind: 'size' };
  if (/热度$/.test(s)) return { value: s, valueKind: 'hot' };
  return { value: s, valueKind: '' };
}

/**
 * ★★ 源站**小图升级**为 Steam 高清横版（实测 2026-10-14）
 *
 * 实测：`/update/` 榜条目自带的封面里，形如
 *   `https://shared.cdn.queniuqe.com/community_assets/images/apps/<appid>/<hash>.jpg`
 * 的**只有 32×32**（Steam 社区缩略图）；XD 自己的 `/uploads/allimg/*-L.*` 也只有 128–244px。
 * 这些图放进首页改造后的大图位（轮播 ~560px 高、卡片 ~185px 高）会糊成马赛克。
 *
 * 但那个路径里的 `<appid>` **就是 Steam appid** ⇒ 可换成 Steam 标准 header：
 *   `https://shared.cdn.queniuqe.com/store_item_assets/steam/apps/<appid>/header.jpg`
 *   —— 实测 **HTTP 200 / 460×215 jpeg / 60KB**（与本地库 cover 同一个 CDN）。
 *
 * ⚠️ header.jpg 不是每款都有（下架/未上 Steam 的会 404）⇒ 调用方必须把原图当**兜底**
 *   传给前端（`coverAlt`），由 `onerror` 回退。**不能只发升级后的地址**。
 *
 * @returns {{cover:string, coverAlt:string}} coverAlt 仅在真发生了升级时非空
 */
const SMALL_COVER_RE = /community_assets\/images\/apps\/(\d+)\//;
const STEAM_HEADER = (id) => `https://shared.cdn.queniuqe.com/store_item_assets/steam/apps/${id}/header.jpg`;
function upgradeCover(u) {
  const url = String(u || '');
  const m = url.match(SMALL_COVER_RE);
  if (!m) return { cover: url, coverAlt: '' };
  return { cover: STEAM_HEADER(m[1]), coverAlt: url };
}

/**
 * 解析单个 panel 的 `<li>` 列表（纯函数，接受 cheerio 实例）。
 * @returns {Array<{gid,url,name,cover,rank,category,badge,dateLabel,value,valueKind}>}
 */
function parseRows($, $panel) {
  const rows = [];
  $panel.find('li').each((_, li) => {
    const $li = $(li);
    const $a = $li.find('a[href*="/game/"]').first();
    const href = $a.attr('href') || '';
    const gid = (href.match(/game\/(\d+)\.html/) || [])[1];
    if (!gid) return; // 广告位等非游戏行
    const $img = $li.find('img').first();
    const t = $li.find('time').first();
    const { value, valueKind } = readValue(t.text());
    const rk = parseInt(($li.find('em.rk').first().text() || '').trim(), 10);
    const up = upgradeCover(coverOf($img.attr('src'), $img.attr('data-original') || $img.attr('data-src')));
    rows.push({
      gid,
      url: HOME + 'game/' + gid + '.html',
      /* ★ 只读 a.tit 的 text：实测该节点的 title 属性是空串 */
      name: ($li.find('a.tit').first().text() || '').replace(/\s+/g, ' ').trim(),
      cover: up.cover,
      coverAlt: up.coverAlt,
      rank: Number.isFinite(rk) && rk > 0 ? rk : rows.length + 1,
      category: ($li.find('span.up-category').first().text() || '').trim(),
      badge: ($li.find('span.up-badge').first().text() || '').trim(),
      dateLabel: valueKind === 'date' ? value : '',
      value,
      valueKind,
    });
  });
  return rows;
}

/**
 * 抓取指定的若干 panel。
 * @param {string[]} [names] 默认 ['recent','hot','month','year']（首页只用到这几档）
 * @param {boolean}  [force] 忽略缓存
 * @returns {Promise<Object<string, Array>>} { hot: [...], month: [...] }，另附 `_at` 抓取时刻
 */
async function panels(names, force = false) {
  const want = (Array.isArray(names) && names.length ? names : ['recent', 'hot', 'month', 'year'])
    .filter((n) => PANELS.includes(n));
  const needFetch = force || !cache || Date.now() - cacheAt >= TTL
    || want.some((n) => !cache[n]);
  if (needFetch) {
    const html = await getHtml(PAGE);
    const $ = cheerio.load(html);
    const out = {};
    for (const n of PANELS) {
      const $p = $(`[data-panel="${n}"]`);
      if (!$p.length) continue; // 源站改版/缺档：不写进缓存，下次重试
      out[n] = parseRows($, $p);
    }
    const got = PANELS.filter((n) => Array.isArray(out[n]));
    if (!got.length) {
      throw new Error('XD /update/ 未找到任何 [data-panel] 榜单（可能改版）：' + PAGE);
    }
    out._at = Date.now();
    cache = out;
    cacheAt = Date.now();
  }
  const ret = { _at: cache._at || cacheAt };
  for (const n of want) ret[n] = cache[n] || [];
  return ret;
}

module.exports = { panels, parseRows, readValue, upgradeCover, PANELS, PAGE, HOME };
