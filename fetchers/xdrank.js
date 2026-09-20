/**
 * fetchers/xdrank.js — XD 官网 (www.xdgame.com) 官方热度榜
 * 首页 .hot-soft 容器 SSR 直出三档（本周热门 / 当月最热 / 全站最热），
 * 结构：1 个 .soft-plate 内横向 3 个 .plate-list（依次对应三档，各 TOP10-12），
 * 每行 <li><em>排名</em><a href="/game/{id}.html" title="中文/英文名">…</a></li>
 * 返回条目的 url 与本地库 (games.json) 记录的 url 同源同构，可直接映射。
 */
const cheerio = require('cheerio');
const { getHtml } = require('../shared');

const HOME = 'https://www.xdgame.com/';
const KEYS = ['week', 'month', 'year'];

let cache = null;
let cacheAt = 0;
const TTL = 30 * 60 * 1000; // 30 分钟（官网热度为日更级）

/** ★ 从一档榜单原始行里剔除「非游戏条目」并**重编号**（纯函数，便于离线回归）。
 *
 *  为什么必须重编号：源站「全站最热」第 1 名就是 `XDGAME游戏运行库检测工具206.04.13`。
 *  旧实现先 filter 再 slice，但**沿用源站 <em> 序号**，于是：
 *    过滤后剩 9 条、序号是 2..10 → 前端冠军卡吃掉 list[0]（rank=2），
 *    普通卡从 3 开始 → 用户看到「榜单从 3 开始、缺 1 和 2」（原话：少了2）。
 *
 *  @param {Array<{name:string,rank:number}>} rows 源站行（rank 为源站序号）
 *  @returns {{dropped:number, rows:Array}} dropped = 剔除条数；rows 已重排为连续 1..N
 */
function cleanPlate(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const clean = list.filter((x) => !/(运行库|检测工具)/.test(x.name || ''));
  return {
    dropped: list.length - clean.length,
    rows: clean.slice(0, 10).map((x, i) => ({ ...x, rank: i + 1, srcRank: x.rank })),
  };
}

/**
 * ★ 从一行榜单里抠出封面（纯函数，便于离线回归）
 *
 * 源站用的是懒加载：`<img class="lazy" src="/images/defaultpic.gif" data-original="真图">`
 * —— 真图在 **data-original**，`src` 只是占位图。
 *
 * 为什么必须在这里取：旧实现只读 `a[href]` / `a[title]`，把这一行**丢弃**了，
 * 于是服务端只能拿 url 去本地库碰运气匹配 ——
 *   · 库里没收录的（如「DLSS 5 Swapper」这类工具条目）→ `cover:null`，前端只能显示首字占位
 *   · 库里收录了但 url 对不上的 → 同样 `cover:null`
 * 实测 2026-09-20：周榜 10 条里 2 条无图，源站这一行本身**是有图的**。
 *
 * @param {string} src           img 的 src（多半是占位图）
 * @param {string} dataOriginal  img 的 data-original（其次 data-src）
 * @returns {string} 补全后的绝对 URL；取不到返回 ''
 */
function coverOf(src, dataOriginal) {
  let u = String(dataOriginal || '').trim();
  if (!u) {
    /* 没有 data-original 时才退到 src，且必须排除各种懒加载占位图 */
    const s = String(src || '').trim();
    u = /defaultpic\.gif|lazy\.(?:gif|png|svg)$|\/images\/blank/i.test(s) ? '' : s;
  }
  if (!u || /^(?:data:|about:)/i.test(u)) return '';
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('/')) return HOME.replace(/\/+$/, '') + u;
  return /^https?:\/\//i.test(u) ? u : '';
}

/**
 * @returns {Promise<{week:Array,month:Array,year:Array}>}
 *   每档: [{ gid, name, url, img, rank, srcRank }]（rank 为**本站重编号**后的 1..N；
 *   srcRank 保留源站 <em> 序号便于对源站追溯；img 为源站该行的封面，可能为 ''）
 *   `out._dropped = {week:n,month:n,year:n}` 供前端 meta 说明剔除了几条工具条目。
 */
async function rawHot(force = false) {
  if (!force && cache && Date.now() - cacheAt < TTL) return cache;
  const html = await getHtml(HOME);
  const $ = cheerio.load(html);
  const plates = $('.hot-soft .plate-list').toArray();
  if (!plates.length) throw new Error('XD 官网首页未找到 .hot-soft .plate-list 热榜数据（可能改版）');
  const out = {};
  const dropped = {};
  plates.slice(0, 3).forEach((pl, idx) => {
    const rows = [];
    $(pl).find('ul li').each((_, li) => {
      const $li = $(li);
      const $a = $li.find('a[href*="/game/"]').first();
      const href = $a.attr('href') || '';
      const gid = (href.match(/game\/(\d+)\.html/) || [])[1];
      if (!gid) return;
      const name = ($a.attr('title') || '').trim() || $a.text().replace(/\s+/g, ' ').trim();
      const $img = $li.find('img').first();
      rows.push({
        gid,
        name,
        url: HOME + 'game/' + gid + '.html',
        img: coverOf($img.attr('src'), $img.attr('data-original') || $img.attr('data-src')),
        rank: parseInt(($li.find('em').first().text() || '').trim(), 10) || rows.length + 1,
      });
    });
    const cleaned = cleanPlate(rows);
    dropped[KEYS[idx]] = cleaned.dropped;
    out[KEYS[idx]] = cleaned.rows;
  });
  out._dropped = dropped;
  cache = out;
  cacheAt = Date.now();
  return out;
}

/**
 * ★ v10.23：榜单行 → 本地库条目（纯函数，便于离线回归）
 *
 * 为什么不能只按 url 匹配：旧实现 `byUrl.get(it.url)` 一旦落空就写死 `cover:null`，
 * 前端热榜卡片只能退化成「首字」色块。实测两种落空都真实存在：
 *   ① 库里根本没收录 —— 「DLSS 5 Swapper」这类工具条目
 *   ② 库里有、但 url 串差一点 —— http/https、www、尾斜杠任一不同就匹配不上
 * 而**源站这一行本身是带图的**（`img.lazy` 的 `data-original`），所以正确做法是
 * 「本地库精确命中优先 + 源站图兜底」，而不是在「有图」和「没图」之间二选一。
 *
 * 封面优先序：本地库 `cover`（Steam 标准横版 460×215，比例最稳） > 源站行图 > null
 *
 * @param {Array<{url:string,gid?:string,img?:string,rank?:number,name?:string}>} rows 源站榜单行
 * @param {Array<object>} all 本地库全量（gamesDb.all()）
 * @returns {Array<object>} 合并后的榜单条目（每条都保证 `cover` 字段存在）
 */
function mergeRankRows(rows, all) {
  const byUrl = new Map();
  const byId = new Map();
  for (const g of all || []) {
    if (!g) continue;
    if (g.url && !byUrl.has(g.url)) byUrl.set(g.url, g);
    if (g.id && !byId.has(g.id)) byId.set(g.id, g);
  }
  return (rows || []).map((it) => {
    /* ① url 精确匹配（老路）→ ② 按 gid 反查：本地库 id 就是 `xd-<gid>`，
       比 url 字符串匹配稳得多（不必担心中间任一字符差异）。 */
    const rec = byUrl.get(it.url) || (it.gid ? byId.get('xd-' + it.gid) : null) || null;
    const cover = (rec && rec.cover) || it.img || null;
    if (rec) return { ...rec, rank: it.rank || 0, cover };
    return {
      source: 'xdgamer',
      rank: it.rank || 0,
      title: it.name,
      cover,
      genres: [],
      size: null,
      score: null,
      updatedTs: null,
      dateLabel: null,
      url: it.url,
    };
  });
}

module.exports = { rawHot, cleanPlate, coverOf, mergeRankRows, HOME, KEYS };
