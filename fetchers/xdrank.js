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
 * @returns {Promise<{week:Array,month:Array,year:Array}>}
 *   每档: [{ gid, name, url, rank, srcRank }]（rank 为**本站重编号**后的 1..N；
 *   srcRank 保留源站 <em> 序号便于对源站追溯）
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
      rows.push({
        gid,
        name,
        url: HOME + 'game/' + gid + '.html',
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

module.exports = { rawHot, cleanPlate, HOME, KEYS };
