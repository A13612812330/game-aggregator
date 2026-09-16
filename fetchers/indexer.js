/**
 * fetchers/indexer.js — 本地游戏库索引器
 * XDGAME 全量列表爬取：www.xdgame.com/list/1/list_{n}.html(最近更新,~35条/页,共 N 页)
 * 每页卡片:封面(steam header)、类型标签、游戏名、大小、评分星、更新日期。
 * 注意：xdgame.com 与 xdgamer.com 是两套内容平行的域名(同 ID ≠ 同游戏)，
 *       本库数据全部属于 xdgame.com，URL 必须拼该域，否则详情会错位。
 */
const cheerio = require('cheerio');
const { getHtml } = require('../shared');

const HOST_XDLIST = 'https://www.xdgame.com';

async function parseXdListPage(html) {
  const $ = cheerio.load(html);
  const out = [];
  $('.game-list li').each((_, el) => {
    const $li = $(el);
    const sd = $li.attr('data-sd');          // 更新时间戳(秒)
    const pd = $li.attr('data-pd');          // 发布/收录时间戳
    const $cover = $li.find('a.grid-cover img').first();
    const $link = $li.find('a[href*="/game/"]').first();
    const href = $li.find('a.grid-cover').attr('href') || '';
    const id = (href.match(/\/game\/(\d+)\.html/) || [])[1];
    if (!id) return;
    const title = ($li.find('.tit').first().text() || $cover.attr('alt') || '').trim();
    if (!title) return;
    const cover = $cover.attr('data-original') || $cover.attr('data-litpic') || '';
    const genre = ($li.find('.type').first().text() || '').trim();
    let size = null;
    const sizeTxt = ($li.find('.size').first().text() || '').trim();
    const sm = sizeTxt.match(/(\d+(?:\.\d+)?)\s*(GB|MB|TB)/i);
    if (sm) size = sm[1] + sm[2].toUpperCase();
    let score = null;
    const st = ($li.find('.rank').first().text() || '').trim();
    const sn = parseFloat(st);
    /* ★ v10.8 范围校验：`.rank` 里偶尔不是评分而是名次/其它数字
       （实测 xd-3160「蜗牛克利德」落了 54），直接当 10 分制会污染
       「评分最高」排序与详情页展示。与 xdgamer.detail 的既有判定保持一致。 */
    if (!isNaN(sn) && sn > 0 && sn <= 10) score = sn;
    let date = null;
    const d = ($li.find('.data').first().text() || '').trim();
    const dm = d.match(/(\d{4}-\d{2}-\d{2})/);
    if (dm) date = dm[1];
    // 卡内其余文本兜底日期/大小(个别模板差异)
    if (!date) {
      const dt = ($li.find('.news').first().text() || '').trim().match(/(\d{4}-\d{2}-\d{2})/);
      if (dt) date = dt[1];
    }
    out.push({
      id: 'xd-' + id,
      source: 'xdgamer',
      title,
      cover: cover && !/defaultpic|\.gif/i.test(cover) ? cover : null,
      genres: genre ? [genre] : [],
      size,
      score,
      dateLabel: date,
      updatedTs: sd ? sd * 1000 : null,
      publishTs: pd ? pd * 1000 : null,
      url: HOST_XDLIST + href,
    });
  });
  return out;
}

/** 抓取某页(带重试与限速) */
async function fetchXdPage(n) {
  const url = `${HOST_XDLIST}/list/1/list_${n}.html`;
  const html = await getHtml(url);
  return parseXdListPage(html);
}

/** 找出最近更新列表最大页数(从第 1 页分页 DOM 提取) */
async function maxXdPages() {
  const html = await getHtml(`${HOST_XDLIST}/list/1/list_1.html`);
  const nums = [...html.matchAll(/list_(\d+)\.html/g)].map((m) => parseInt(m[1], 10));
  return nums.length ? Math.max(...nums) : 0;
}

/**
 * 批量索引 XDGAME 最近更新页
 * @param {number} start 起始页(1)
 * @param {number} end 结束页(含)
 * @param {Function} onProgress ({page, got, run}) 每页回调
 */
async function indexXdRange(start, end, onProgress) {
  const db = require('../data/gamesDb');
  let got = 0;
  for (let p = start; p <= end; p++) {
    try {
      const items = await fetchXdPage(p);
      const r = db.upsert(items);
      got += items.length;
      if (onProgress) onProgress({ page: p, got: r.total, added: r.added, updated: r.updated, run: got });
      await new Promise((res) => setTimeout(res, 160)); // 限速
    } catch (e) {
      if (onProgress) onProgress({ page: p, error: String(e.message || e) });
      await new Promise((res) => setTimeout(res, 1200));
    }
  }
  db.persist();
  return { pages: end - start + 1, got };
}

module.exports = { parseXdListPage, fetchXdPage, maxXdPages, indexXdRange };
