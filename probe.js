/**
 * probe.js — DOM 结构探测器
 * 抓取两个源站首页与示例详情页，输出结构化字段，用于确定 fetcher 选择器。
 * 用法: node probe.js [home|detail]
 */
const cheerio = require('cheerio');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
  const html = await r.text();
  return { url: r.url, status: r.status, html };
}

const log = (t, o) => console.log('\n===== ' + t + ' =====\n' + (typeof o === 'string' ? o : JSON.stringify(o, null, 2)));

async function probeJidiHome() {
  const { html } = await get('https://jidiyouxi.com/');
  const $ = cheerio.load(html);
  log('JIDI home title', $('title').text());
  // 收集所有 topic/detail 链接及其卡片文本
  const seen = new Set();
  const cards = [];
  $('a[href*="/topic/detail/"]').each((i, el) => {
    const href = $(el).attr('href');
    const id = (href.match(/topic\/detail\/(\d+)/) || [])[1];
    if (!id || seen.has(id)) return;
    seen.add(id);
    const text = $(el).text().replace(/\s+/g, ' ').trim().slice(0, 160);
    const img = $(el).find('img').first();
    cards.push({ id, href, text, img: img.attr('src') || img.attr('data-src') || null });
  });
  log('JIDI topic cards (first 8)', cards.slice(0, 8));

  // 社区/帖子流 post/detail
  const seenP = new Set();
  const posts = [];
  $('a[href*="/post/detail/"]').each((i, el) => {
    const href = $(el).attr('href');
    const id = (href.match(/post\/detail\/(\d+)/) || [])[1];
    if (!id || seenP.has(id)) return;
    seenP.add(id);
    const text = $(el).text().replace(/\s+/g, ' ').trim().slice(0, 120);
    posts.push({ id, href, text });
    if (posts.length >= 5) return false;
  });
  log('JIDI post links (first 5)', posts);
}

async function probeXdHome() {
  const { html } = await get('https://www.xdgamer.com/');
  const $ = cheerio.load(html);
  log('XD home title', $('title').text());
  const seen = new Set();
  const items = [];
  $('a[href*="/game/"], a[href*="game/"]').each((i, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(/game\/(\d+)\.html/);
    if (!m) return;
    const id = m[1];
    if (seen.has(id)) return;
    seen.add(id);
    const parent = $(el).closest('li, div').first();
    const text = parent.text().replace(/\s+/g, ' ').trim().slice(0, 160) || $(el).text().replace(/\s+/g, ' ').trim().slice(0, 160);
    items.push({ id, href, parentTag: parent.length ? parent.prop('tagName') : '-', parentClass: (parent.attr('class') || '').slice(0, 60), text });
    if (items.length >= 10) return false;
  });
  log('XD items (first 10)', items);
}

async function probeJidiDetail() {
  const { html, url } = await get('https://jidiyouxi.com/topic/detail/2134034298');
  const $ = cheerio.load(html);
  log('JIDI detail url', url);
  log('JIDI detail title', $('title').text());
  // 常见信息块
  const out = { h1: $('h1').first().text().trim().slice(0, 80), ogImage: $('meta[property="og:image"]').attr('content') || null, ogDesc: $('meta[property="og:description"]').attr('content') || null };
  log('JIDI detail basic', out);
  // 查找像"发行日期/更新时间/大小/评分"的行
  const info = [];
  $('div, span, p, li').each((i, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (/发行日期|更新时间|游戏大小|语言|版本|评分|游戏类型|更新日期/.test(t) && t.length < 120 && t.length > 4) {
      info.push(t);
    }
    if (info.length >= 25) return false;
  });
  log('JIDI detail info-lines', info.slice(0, 25));
}

async function probeXdDetail() {
  const { html, url } = await get('https://www.xdgamer.com/game/14843.html');
  const $ = cheerio.load(html);
  log('XD detail url', url);
  log('XD detail title', $('title').text());
  const out = { h1: $('h1').first().text().trim().slice(0, 80) || $('title').text().slice(0, 80), ogImage: $('meta[property="og:image"]').attr('content') || null };
  log('XD detail basic', out);
  const info = [];
  $('div, span, p, li, th, td').each((i, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (/更新时间|发行时间|发布日期|游戏大小|语言|版本|类型|专题/.test(t) && t.length < 120 && t.length > 4) {
      info.push(t);
    }
    if (info.length >= 25) return false;
  });
  log('XD detail info-lines', info.slice(0, 25));
}

(async () => {
  const arg = process.argv[2] || 'home';
  try {
    if (arg === 'detail') { await probeJidiDetail(); await probeXdDetail(); }
    else { await probeJidiHome(); await probeXdHome(); }
  } catch (e) { console.error('PROBE ERROR:', e.message); process.exit(1); }
  process.exit(0);
})();
