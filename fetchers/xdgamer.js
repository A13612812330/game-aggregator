/**
 * fetchers/xdgamer.js — XDGAME (www.xdgamer.com)
 * 首页：UL 列表 LI{ 封面 img.lazy[data-original] / 日期 font.news / 标题 a.tit } — “今日更新”流
 * 详情：.article-tit h1 + .info 更新时间 + h4(版本介绍/游戏介绍) + img.lazy 大图
 */
const cheerio = require('cheerio');
const { HOST_XD, getHtml, abs } = require('../shared');
const shotsLib = require('./shots');

/**
 * 截图解析（★ v10.25 新增，抽出成纯函数便于直接测）
 *
 * 站点真实结构（xdgame.com 实测 2026-09-20）：
 *   <h3>游戏截图</h3>
 *   <p><img loading="lazy" data-src="…/steam/apps/1605850/<hash>/ss_<hash>.1920x1080.jpg?t=…"
 *           src="data:image/gif;base64,R0lGOD…"></p>
 *   <p><img …></p> …
 *
 * ⚠️ 真地址在 `data-src`，`src` 是 base64 占位 gif（懒加载）——
 *    只读 `src` 会得到一张 1x1 透明图，看起来「有 img 元素」但没有任何画面。
 *
 * 原实现用 `img.lazy[data-original]` 且要求路径含 `/uploads/`
 *   ⇒ 命中的是**文章配图**（不是截图），且第一张恰好是封面 ⇒ 预览区显示封面重复。
 *
 * 兜底：整页扫「Steam 资源路径」形态的图（`/store_item_assets/steam/apps/<id>/`）。
 *   这条兜底**只认截图形态**（判定在 fetchers/shots.js 的 SHOT_RE），
 *   不会把 logo / 头图 / 表情混进来 —— 所以它是安全的，不是「抓到就算」。
 */
function parseShots($, base) {
  const out = [];
  $('h3, h4').each((_, el) => {
    if (!/游戏截图|游戏预览|^截图/.test($(el).text().trim())) return;
    let n = $(el).next();
    let guard = 0;
    while (n.length && guard++ < 20 && !/^h[1-4]$/i.test(n.prop('tagName') || '')) {
      n.find('img').each((__, im) => {
        const u = $(im).attr('data-src') || $(im).attr('data-original') || $(im).attr('src') || '';
        if (/^https?:/i.test(u)) out.push(abs(base, u));
      });
      n = n.next();
    }
  });
  if (!out.length) {
    $('img[data-src], img[data-original], img').each((_, im) => {
      const u = $(im).attr('data-src') || $(im).attr('data-original') || $(im).attr('src') || '';
      if (/^https?:/i.test(u) && shotsLib.SHOT_RE.test(u)) out.push(abs(base, u));
    });
  }
  return out;
}

async function feed() {
  const html = await getHtml(HOST_XD + '/');
  const $ = cheerio.load(html);
  const items = [];
  const seen = new Set();

  $('li:has(a[href*="/game/"]):has(font.news)').each((_, el) => {
    const $li = $(el);
    const $a = $li.find('a[href*="/game/"]').first();
    const href = $a.attr('href') || '';
    const id = (href.match(/game\/(\d+)\.html/) || [])[1];
    if (!id || seen.has(id)) return;
    seen.add(id);

    const title = $li.find('a.tit').first().text().trim() || $a.text().trim();
    const coverRaw = ($li.find('img.lazy').first().attr('data-original') || $li.find('img').first().attr('src')) || '';
    const dateLabel = ($li.find('font.news').first().text() || '').trim() || '更新';

    items.push({
      id: 'xd-' + id, source: 'xdgamer', kind: 'update', rank: null,
      title: title.replace(/\s+/g, ' ').trim(),
      cover: /defaultpic|logo|\.gif/i.test(coverRaw) ? null : abs(HOST_XD, coverRaw),
      score: null, size: null, genres: [], badge: dateLabel,
      releaseDate: null, dateLabel, url: HOST_XD + href,
    });
  });
  return items;
}

/**
 * 详情解析。host 参数用于 xdgame.com / xdgamer.com 双域（两站内容独立，ID 各自计数），
 * 默认 www.xdgamer.com；库索引数据属于 www.xdgame.com 时须显式传入。
 */
async function detail(id, host) {
  const base = host || HOST_XD;
  const url = `${base}/game/${id}.html`;
  const html = await getHtml(url);
  const $ = cheerio.load(html);

  /* ★ v10.5 改版适配（xdgame.com 改版）：旧选择器 `.article-tit h1` 里的标题
   *   已挪进 `<span class="article-title-text">`。旧代码先 clone h1、再 remove('span')
   *   去徽章 —— 去掉之后剩下的是**空白文本节点**，而空白字符串是 truthy，
   *   于是 `cloneText() || $('h1').text() || …` 被空白短路，title 恒为 ''。
   *   这不是选择器写错，是「|| 短路 + 未 trim」的坑 —— 下面统一「先 trim、再判空」逐级兜底。 */
  const pickText = (...cands) => {
    for (const c of cands) {
      const t = String(c == null ? '' : c).replace(/\s+/g, ' ').trim();
      if (t) return t;
    }
    return '';
  };
  const h1Clone = $('.article-tit h1').first().clone();
  h1Clone.find('small, .tit-badge, .badge, em').remove(); // 剔除“版本更新”等徽章噪音
  const title = pickText(
    $('.article-tit .article-title-text').first().text(),
    h1Clone.text(),
    $('h1').first().text(),
    $('title').text().split(' - ')[0],
  );

  /* 元信息：新版把「游戏厂商 / 游戏发行 / 更新时间」收敛成 .article-meta-item */
  const metaItem = (cls) => pickText($('.article-meta-item.' + cls).first().text()).replace(/^[^：:]*[：:]\s*/, '') || null;
  const publisher = metaItem('game-publisher');
  const releaseDate = metaItem('game-release-date');

  const bodyText = $('body').text();
  let updatedAt = null;
  let updateLabel = null;
  const um = bodyText.match(/更新时间[:：]\s*(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (um) {
    const [, Y, Mo, D, H, Mi] = um.map(Number);
    updatedAt = new Date(Y, Mo - 1, D, H, Mi).getTime();
    updateLabel = `${Y}-${String(Mo).padStart(2, '0')}-${String(D).padStart(2, '0')} ${String(H).padStart(2, '0')}:${String(Mi).padStart(2, '0')}`;
  }
  /* 页面上的 .game-site-updated 比 body 正则更权威，取到就以它为准 */
  const upM = (metaItem('game-site-updated') || '').match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (upM) {
    const [, Y, Mo, D, H, Mi] = upM.map(Number);
    updatedAt = new Date(Y, Mo - 1, D, H, Mi).getTime();
    updateLabel = `${Y}-${String(Mo).padStart(2, '0')}-${String(D).padStart(2, '0')} ${String(H).padStart(2, '0')}:${String(Mi).padStart(2, '0')}`;
  }

  /* 封面：文章正文大图（`/uploads/`）。
   *
   * ★ v10.25 修：原写法会把「随机推荐」侧栏里**别的游戏**的封面当成自己的封面。
   *   XD 详情页的 `/uploads/` 图**只有随机推荐在用** —— 实测 id=15022 全页 5 处，
   *   5 处全是 `<img class="random-recommend-img" data-cover="/uploads/…">`。
   *   即：详情页 hero 区会显示成一款**完全不相干**的游戏。
   *   之所以一直没暴露，是因为前端 `paintDetail` 有 `d.cover || fb.cover` 兜底，
   *   库内封面把它盖住了 —— 也就是说这是个「躺在兜底后面」的错值。
   *
   *   现在显式排除，并且**取不到就返回 null**，让调用方用库内封面兜底
   *   （宁可退回库内那张对的，也不安一张错的 —— 同 PITFALLS 11 的口径）。
   *   ⚠️ 别放宽成「整页扫」：一放宽就会把推荐位/侧栏一起带进来。 */
  const imgs = [];
  const NOT_REC = 'img.random-recommend-img, img[data-cover], .random-recommend img, .side img, .sidebar img';
  $('img.lazy[data-original], img[data-original]').not(NOT_REC).each((_, el) => {
    const u = $(el).attr('data-original') || '';
    if (/\/uploads\//.test(u) && imgs.length < 8) imgs.push(abs(base, u));
  });
  if (!imgs.length) {
    $('img').not(NOT_REC).each((_, el) => {
      const u = $(el).attr('src') || '';
      if (/\/uploads\//.test(u) && imgs.length < 8) imgs.push(abs(base, u));
    });
  }
  const cover = imgs[0] || null;
  /* ★ v10.25：截图**不能**复用 `imgs` —— 那是 `/uploads/` 文章配图，
   *   而且它的第一张就是封面本身，所以「游戏预览」里看到的常是封面重复。
   *   真实截图在正文 `<h3>游戏截图</h3>` 之后，而且是 **1920x1080 高清图**。见 parseShots()。 */
  const shots = shotsLib.list(parseShots($, base), 12);

  // 版本介绍 / 游戏介绍：找 h4（可能带内联样式）后的段落
  const pickAfterH4 = (kw) => {
    let out = '';
    $('h4, h3, .title, .article-tit').each((_, el) => {
      if ($(el).text().trim() !== kw && !$(el).text().trim().startsWith(kw)) return;
      const parts = [];
      let n = $(el).next();
      while (n.length && !/^h[1-4]$/i.test(n.prop('tagName') || '') && parts.length < 12) {
        const tag = n.prop('tagName') || '';
        if (/^p|div|ul|ol|section$/i.test(tag)) {
          const t = n.text().replace(/\s+/g, ' ').trim();
          if (t) parts.push(t);
        }
        n = n.next();
      }
      out = parts.join('\n');
      return false;
    });
    return out || null;
  };

  let version = pickAfterH4('版本介绍');
  let about = pickAfterH4('游戏介绍');
  if (!about) {
    const meta = $('meta[name="description"]').attr('content') || '';
    about = meta.replace(/^游戏介绍\s*/, '').trim() || null;
  }
  if (version && version.length > 400) version = version.slice(0, 400) + '…';
  if (about && about.length > 500) about = about.slice(0, 500) + '…';

  /* 容量：新版没有独立的「游戏大小」字段，容量藏在版本介绍文本里
   *   （"v1.73.3889传承版|容量120GB|官方简体中文|…"），故版本文本优先、全页兜底。 */
  const sizeM = (version || '').match(/容量\s*([\d.]+\s*(?:TB|GB|MB))/i)
    || bodyText.match(/容量\s*([\d.]+\s*(?:TB|GB|MB))/i)
    || bodyText.match(/(?:游戏大小|大小)[：:]\s*([\d.]+\s*(?:TB|GB|MB))/i);
  const size = sizeM ? sizeM[1].replace(/\s+/g, '').toUpperCase() : null;

  /* 类型：面包屑末级（主页 › 电脑游戏 › 动作冒险）。
   *   新版面包屑 href 由 /sort/ 改成 /list/1/ 与 /game/1/，且 nav 与 .article-tit 同级，
   *   旧代码「.article-tit 的 prev 里找 /sort/ 链接」两头都不成立 —— 改为直接查 nav，
   *   倒序取「最细一级且不是站点大类」的那一项。 */
  const genres = [];
  for (const el of $('nav.article-crumbs a, .article-crumbs a').toArray().reverse()) {
    const t = $(el).text().trim();
    const href = $(el).attr('href') || '';
    if (!t || /主页/.test(t)) continue;
    if (/\/(list|sort)\/\d+/.test(href) || /电脑游戏|主机游戏|安卓游戏|游戏库/.test(t)) continue;
    if (!genres.includes(t)) genres.push(t);
    break; // 只要最细一级
  }

  /* 标签：新版正文底部 .article-tags（Steam 标签，比面包屑细得多），去掉前缀 "#" */
  const tags = [];
  $('.article-tags a').each((_, el) => {
    const t = pickText($(el).text()).replace(/^#\s*/, '');
    if (t && !tags.includes(t) && tags.length < 10) tags.push(t);
  });
  /* 面包屑没取到就用前两个标签兜底，保证详情页「游戏类型」不空 */
  if (!genres.length) genres.push(...tags.slice(0, 2));

  /* 评分：新页脚是 Steam 评价组件。[data-steam-score] 为 0.0 = 该游戏暂无评价，
   *   此时保持 null（前端会拿本地库评分兜底），不写 0 —— 否则会污染「评分最高」排序。 */
  const scoreRaw = parseFloat(pickText($('[data-steam-score]').first().text()));
  const score = isFinite(scoreRaw) && scoreRaw > 0 && scoreRaw <= 10 ? scoreRaw : null;
  /* 好评率同理：0% 表示该游戏在源站还没有评价数据，不是「0% 好评」，别当事实展示 */
  const rateRaw = pickText($('[data-steam-raw]').first().text());
  const steamRate = rateRaw && !/^0(\.0+)?%$/.test(rateRaw) ? rateRaw : null;

  return {
    source: 'xdgamer', id, title, cover, score, size, genres, tags,
    publisher, releaseDate, updatedAt, updateLabel, steamRate,
    desc: about, version, shots, url, home: base,
  };
}

async function search(q) {
  const url = `${HOST_XD}/search/${encodeURIComponent(q)}.html`;
  const html = await getHtml(url);
  const $ = cheerio.load(html);
  const items = [];
  const seen = new Set();
  $('li:has(a[href*="/game/"]):has(a.tit)').each((_, el) => {
    const $li = $(el);
    const $a = $li.find('a[href*="/game/"]').first();
    const href = $a.attr('href') || '';
    const id = (href.match(/game\/(\d+)\.html/) || [])[1];
    if (!id || seen.has(id)) return;
    seen.add(id);
    const title = $li.find('a.tit').first().text().replace(/\s+/g, ' ').trim();
    if (!title) return;
    const category = $li.find('> span').first().text().trim();
    const date = $li.find('time').first().text().trim();
    items.push({
      id: 'xd-' + id, source: 'xdgamer', kind: 'update', rank: null,
      title, cover: null, score: null, size: null,
      genres: category ? [category] : [],
      badge: date || null, dateLabel: date || null,
      url: HOST_XD + href,
    });
  });
  return items;
}

const CATEGORIES = [
  { slug: 'pcgame', name: '电脑游戏' },
  { slug: 'host', name: '主机游戏' },
  { slug: 'mobile', name: '安卓游戏' },
  { slug: 'dzmx', name: '动作冒险' },
  { slug: 'jsby', name: '角色扮演' },
  { slug: 'mnjy', name: '模拟经营' },
  { slug: 'qzsj', name: '枪战射击' },
  { slug: 'kbjs', name: '恐怖惊悚' },
  { slug: 'tyjs', name: '体育竞速' },
  { slug: 'xxyz', name: '休闲益智' },
  { slug: 'clzq', name: '策略战棋' },
  { slug: 'jszl', name: '即时战略' },
  { slug: 'gj', name: '修改器/工具' },
];
function catName(slug) {
  const c = CATEGORIES.find((x) => x.slug === slug);
  return c ? c.name : slug;
}

async function category(slug) {
  const url = `${HOST_XD}/sort/${slug}/`;
  const html = await getHtml(url);
  const $ = cheerio.load(html);
  const items = [];
  const seen = new Set();
  $('li:has(a.soft-title):has(a[href*="/game/"])').each((_, el) => {
    const $li = $(el);
    const $a = $li.find('a[href*="/game/"]').first();
    const href = $a.attr('href') || '';
    const id = (href.match(/game\/(\d+)\.html/) || [])[1];
    if (!id || seen.has(id)) return;
    seen.add(id);
    const title = ($li.find('a.soft-title').first().text() || '').replace(/\s+/g, ' ').trim();
    if (!title) return;
    const coverRaw = $li.find('img.lazy').first().attr('data-original') || $li.find('img').first().attr('src') || '';
    let date = null;
    const dtTxt = $li.find('.list-ca').first().text() || '';
    const dm = dtTxt.match(/(\d{4}-\d{2}-\d{2})/);
    if (dm) date = dm[1];
    let size = null;
    const dxTxt = $li.find('.dx').first().text() || '';
    const sm = dxTxt.match(/(\d+(?:\.\d+)?)\s*(GB|MB|TB)/i);
    if (sm) size = sm[1] + sm[2].toUpperCase();
    items.push({
      id: 'xd-' + id, source: 'xdgamer', kind: 'update', rank: null,
      title, cover: /defaultpic|logo|\.gif/i.test(coverRaw) ? null : abs(HOST_XD, coverRaw),
      score: null, size, genres: [catName(slug)],
      badge: date || null, dateLabel: date || null,
      url: HOST_XD + href,
    });
  });
  return { slug, category: catName(slug), items };
}

module.exports = { feed, detail, search, category, CATEGORIES, parseShots };
