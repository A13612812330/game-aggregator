/**
 * probe2.js — 深入探测
 * 1) 机地首页话题卡片的内部 DOM 结构（标题/评分/大小/类型分列）
 * 2) XDGAME 首页按日期分组的容器结构
 * 3) 机地首页是否存在社区 post 流容器
 * 4) 两个站详情页字段结构
 */
const cheerio = require('cheerio');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
  return { url: r.url, html: await r.text() };
}
const log = (t, o) => console.log('\n===== ' + t + ' =====\n' + (typeof o === 'string' ? o : JSON.stringify(o, null, 2)));

async function jidiCardDetail() {
  const { html } = await get('https://jidiyouxi.com/');
  const $ = cheerio.load(html);
  // 定位第一个真实封面卡片的 DOM 结构
  const a = $('a[href*="/topic/detail/"]').first();
  log('JIDI card outerHTML (first 3000 chars)', a.parent().html().slice(0, 3000));
  // post 流是否存在
  log('JIDI post links in html', $('#post-detail', a.parent()).length, '| all a[href*=post/detail] total:', $('a[href*="/post/detail/"]').length);
}

async function xdHomeStructure() {
  const { html } = await get('https://www.xdgamer.com/');
  const $ = cheerio.load(html);
  // 第一个含 game 链接的 LI 完整 outerHTML
  const li = $('li:has(a[href*="/game/"])').first();
  log('XD first LI html', li.html().slice(0, 1500));
  // 统计含 game 链接的 LI 总数及它们所在的容器 class
  const containerInfo = {};
  $('li:has(a[href*="/game/"])').slice(0, 3).each((i, el) => {
    const parent = $(el).parent();
    const key = (parent.attr('class') || '') + ' :: ' + parent.prop('tagName');
    containerInfo[key] = (containerInfo[key] || 0) + 1;
  });
  log('XD li containers', containerInfo);
  // 日期区块：找包含 今日/月日 文本的容器
  const sections = [];
  $('div,ul,section').each((i, el) => {
    const cls = $(el).attr('class') || '';
    const txt = $(el).text().replace(/\s+/g, ' ').trim();
    if (/^(今日|\d{1,2}日|\d+月\d+日)/.test(txt) && txt.length < 80 && /今日|\d+月\d+日/.test(txt.slice(0, 6))) {
      sections.push({ tag: el.name, cls: cls.slice(0, 50), txt: txt.slice(0, 90) });
    }
    if (sections.length > 12) return false;
  });
  log('XD date sections', sections);
}

async function jidiDetail2() {
  const { html } = await get('https://jidiyouxi.com/topic/detail/2134034298');
  const $ = cheerio.load(html);
  const title = $('h1').first().text().trim() || $('title').text().trim();
  log('JIDI detail h1', title.slice(0, 100));
  // 找 info 网格/描述
  const body = $('body').text().replace(/\s+/g, ' ').trim();
  ['发行日期', '更新时间', '游戏大小', '游戏类型', '游戏语言', '游戏版本', '游戏评分'].forEach(k => {
    const idx = body.indexOf(k);
    if (idx >= 0) log('JIDI key[' + k + ']', body.slice(idx, idx + 60));
  });
  // og meta
  log('JIDI og', { image: $('meta[property="og:image"]').attr('content') || null, desc: ($('meta[property="og:description"]').attr('content') || '').slice(0, 120) });
  // 第一张真实封面图
  const real = $('img').map((i, el) => $(el).attr('src') || $(el).attr('data-src') || '').get().filter(s => s && !s.includes('icon') && !s.includes('placeholder') && !s.includes('avatar'));
  log('JIDI real imgs (first 6)', real.slice(0, 6));
}

async function xdDetail2() {
  const { html } = await get('https://www.xdgamer.com/game/14843.html');
  const $ = cheerio.load(html);
  const body = $('body').text().replace(/\s+/g, ' ').trim();
  log('XD detail title', ($('h1').first().text().trim() || $('title').text().trim()).slice(0, 100));
  ['更新时间', '发行时间', '发布时间', '游戏大小', '游戏语言', '游戏类型', '版本', '配置'].forEach(k => {
    const idx = body.indexOf(k);
    if (idx >= 0) log('XD key[' + k + ']', body.slice(idx, idx + 70));
  });
  log('XD og', { image: $('meta[property="og:image"]').attr('content') || null });
  const real = $('img').map((i, el) => $(el).attr('src') || $(el).attr('data-src') || '').get().filter(s => s && !s.includes('icon') && !s.includes('logo') && !s.includes('layui'));
  log('XD imgs (first 6)', real.slice(0, 6));
}

(async () => {
  try {
    await jidiCardDetail();
    await xdHomeStructure();
    await jidiDetail2();
    await xdDetail2();
  } catch (e) { console.error('PROBE2 ERROR:', e.message); }
  process.exit(0);
})();
