/**
 * fetchers/jidi.js — 机地 (jidiyouxi.com)
 * 首页 SSR DOM：① 新游推荐区（真实封面 + 发行日期） ② 热门榜序号卡（评分/大小/类型，无 SSR 封面）
 * 详情页：<script id="appState"> 内 window.APP_INITIAL_STATE JSON → topic.currentTopic
 */
const cheerio = require('cheerio');
/* ★ 2026-09-21 修：原先只解构了 `{ HOST_JIDI, getHtml }`，但本文件第 47/265/288 行
 *   都调用 `normDate(...)` —— 机地同步与机地源搜索连续 6 天抛 `normDate is not defined`
 *   （got 0 / added 0，0.7 秒即中止）。`normDate` 早就由 shared.js 导出（L149），
 *   只是这次「日期归一化」重构时漏了这一处导入。
 *   防线：`tools/test-shared-destructure.js` 会扫全项目守这条，避免同类遗漏再发生。 */
const { HOST_JIDI, getHtml, normDate } = require('../shared');
const shotsLib = require('./shots');

const GENRE_SET = new Set([
  '动作','冒险','角色扮演','射击','竞速','模拟','策略','休闲','体育','独立','恐怖','多人',
  '格斗','解谜','生存','开放世界','即时战略','卡牌','roguelike','Roguelike','桌游','教育','音乐','益智',
]);

async function feed() {
  const html = await getHtml(HOST_JIDI + '/');
  const $ = cheerio.load(html);
  const items = [];
  const seen = new Set();

  const push = (it) => {
    if (!it || !it.title || !it.id || seen.has(it.id)) return;
    seen.add(it.id);
    items.push(it);
  };

  // ---------- 区块 A：含“发行日期”且真封面的卡 → 机地游戏更新流 ----------
  $('a[href*="/topic/detail/"]').each((_, el) => {
    const $el = $(el);
    const txt = $el.text().replace(/\s+/g, ' ').trim();
    if (!/发行日期/.test(txt)) return;
    const href = $el.attr('href') || '';
    const id = (href.match(/topic\/detail\/(\d+)/) || [])[1];
    if (!id) return;
    const coverSrc = $el.find('img').first().attr('src') || '';
    if (!coverSrc || /placeholder|icon_/.test(coverSrc)) return;
    let title = '';
    $el.find('span').each((_, s) => {
      const st = $(s).attr('style') || '';
      if (/font-weight\s*:\s*(bold|700)/i.test(st) && !title) title = $(s).text().trim();
    });
    if (!title) title = $el.find('img').first().attr('alt') || '';
    /* ★ 贪婪陷阱：这段文本里「日期」后面紧跟着别的数字（源站原文如 `发行日期: 2026/9/8 9`），
     *   旧写法 `(\d{4}\/\d{1,2}\/\d{1,2})` 会把 `8` 后面的 `9` 一起吞成 `2026/9/89`。
     *   这里放宽到 `\d{1,3}` 让正则完整取到可疑片段，再交给 normDate 做范围校验与还原。 */
    const m = txt.match(/发行日期[:：]\s*(\d{4}\/\d{1,3}\/\d{1,3})/);
    const rel = normDate(m ? m[1] : null) || '';     // ISO `2026-09-08`；无法解析则空串
    push({
      id: 'up-' + id, source: 'jidi', kind: 'update', rank: null, title: title.trim(),
      cover: coverSrc,
      score: null, size: null, genres: [],
      badge: rel ? '发行 ' + rel.slice(5) : '发行',
      releaseDate: rel, dateLabel: rel, url: HOST_JIDI + href,
    });
  });

  // ---------- 区块 B：热门榜序号卡（含 span.score） ----------
  $('a[href*="/topic/detail/"]:has(span.score)').each((i, el) => {
    const $el = $(el);
    const href = $el.attr('href') || '';
    const id = (href.match(/topic\/detail\/(\d+)/) || [])[1];
    if (!id) return;
    const title = ($el.find('span.truncate').first().text() || $el.find('img').first().attr('alt') || '').trim();
    const rankTxt = ($el.find('div').first().text() || '').trim();
    const rank = /^\d+$/.test(rankTxt) ? parseInt(rankTxt, 10) : i + 1;
    const score = parseFloat(($el.find('span.score').first().text() || '').trim()) || null;

    let size = null;
    const genres = [];
    let badge = null;
    $el.find('span').each((_, s) => {
      const t = $(s).text().trim();
      if (!t || t === title) return;
      if (/^\d+(\.\d+)?$/.test(t)) return; // 评分
      const sm = t.match(/^(\d+(?:\.\d+)?)(GB|MB|TB)$/i);
      if (sm && !size) { size = sm[1] + sm[2].toUpperCase(); return; }
      if (/^(新热|热|新|推荐)$/.test(t) && !badge) { badge = t; return; }
      if (GENRE_SET.has(t) && genres.length < 4) { genres.push(t); return; }
    });

    push({
      id: 'rank-' + id, source: 'jidi', kind: 'rank', rank,
      title, cover: null, score, size, genres, badge,
      releaseDate: null, dateLabel: null, url: HOST_JIDI + href,
    });
  });

  return items;
}

/** 详情页 appState 内嵌 JSON */
function extractAppState(html) {
  const m = html.match(/<script id="appState">([\s\S]*?)<\/script>/);
  if (!m) return null;
  const raw = m[1].replace(/^window\.APP_INITIAL_STATE=/, '').trim().replace(/;?\s*$/, '');
  try { return JSON.parse(raw); } catch { return null; }
}

async function detail(id) {
  const url = `${HOST_JIDI}/topic/detail/${id}`;
  const html = await getHtml(url);
  const state = extractAppState(html);
  if (!state || !state.topic || !state.topic.currentTopic) {
    throw new Error('机地详情页未内嵌数据（可能改版）: ' + url);
  }
  const ct = state.topic.currentTopic;
  const gi = ct.game_info || {};
  const score = ct.rating && ct.rating.score != null ? ct.rating.score : null;

  const genres = Array.isArray(gi.genres)
    ? gi.genres.filter((g) => !/^\d+(?:\.\d+)?\s*(GB|MB|TB)$/i.test(String(g)))
    : [];

  let desc = (gi.short_desc || '').trim();
  if (!desc && gi.about_game_txt) {
    desc = String(gi.about_game_txt).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  if (desc.length > 520) desc = desc.slice(0, 520) + '…';

  let cover = null;
  try {
    const cu = ct.cover_urls || {};
    if (cu.origin && cu.origin.urls && cu.origin.urls[0]) cover = cu.origin.urls[0];
    else if (cu.aspect_low && cu.aspect_low.urls && cu.aspect_low.urls[0]) cover = cu.aspect_low.urls[0];
  } catch {}

  const releaseTs = ct.game_release_ts ? ct.game_release_ts * 1000 : null;
  const updateTs = ct.mod_ut ? ct.mod_ut * 1000 : null;
  const releaseDate = gi.release_date || (releaseTs ? new Date(releaseTs).toISOString().slice(0, 10).replace(/-/g, '/') : null);

  // 大小与配置
  let size = gi.storage || null;
  const req = {};
  const sys = gi.game_sys_reqs || gi.pc_requirement || null;
  if (sys && typeof sys === 'object') {
    req.os = sys.os || null; req.cpu = sys.cpu || null; req.ram = sys.ram || null;
    req.gpu = sys.gpu || null; req.storage = sys.storage || null;
  }
  if (!req.os && gi.os) req.os = gi.os;
  if (!req.cpu && gi.cpu) req.cpu = gi.cpu;
  if (!req.ram && gi.ram) req.ram = gi.ram;
  if (!req.gpu && gi.gpu) req.gpu = gi.gpu;
  if (!req.storage && gi.storage) req.storage = gi.storage;
  if (req.storage && /^\d+(?:\.\d+)?\s*(GB|MB)$/i.test(String(req.storage))) size = String(req.storage).toUpperCase();

  /* ★ v10.25：截图改为读**结构化字段** `gi.screenshots`（原写法是抓整页 img）。
   *
   *   原写法为什么是错的：`$('img')` 抓到的第一批是 `img2.52jidi.com/topic/cover/id/<n>/sz/420`，
   *   那是**详情页下半部分「相关推荐」里别的游戏的封面** —— 与本游戏毫无关系。
   *   2026-09-20 用户看到「游戏预览」里一团不相干的图，根因就是这一行。
   *
   *   正确数据本来就在 appState 里：
   *     gi.screenshots[i].urls.default.urls[0]
   *       = https://shared.cdn.queniuqe.com/store_item_assets/steam/apps/1245620/ss_943bf6…600x338.jpg
   *   艾尔登法环实测 **9 张**，URL 与用户提供的参考站**逐字符相同** ⇒ 这就是 Steam 官方截图。
   *
   *   ⚠️ 别再拿 `gi.movie_covers` 当截图：那是**预告片封面**（293x165 的小海报），不是截图。
   *      旧代码把它 append 进 shots，等于把视频封面混进截图条里。
   *   ⚠️ 尺寸后缀由 fetchers/shots.js 统一升到 1920x1080（同 CDN 实测 200 / 573KB）。 */
  const shots = shotsLib.list(gi.screenshots, 12);

  return {
    source: 'jidi', id, title: ct.topic, nameEn: gi.name_en || null,
    cover, score, size, genres,
    releaseDate, updatedAt: updateTs,
    updateLabel: updateTs ? new Date(updateTs).toLocaleString('zh-CN', { hour12: false }) : null,
    publishers: Array.isArray(gi.publishers) ? gi.publishers : null,
    desc: desc || null,
    requirements: Object.keys(req).filter((k) => req[k]).length ? req : null,
    shots, url, home: HOST_JIDI,
  };
}

/**
 * 站内搜索（服务端可用部分）：
 * 机地为客户端动态搜索，服务端只能对“首页 SSR 已收录的游戏库”做本地匹配；
 * 未命中时前端会提供机地站内搜索直达外链（浏览器内完成真实搜索）。
 */
async function search(q) {
  const items = await feed();
  const kw = String(q || '').trim().toLowerCase();
  if (!kw) return { matched: [], indexed: items.length };
  const seenUrl = new Set();
  const matched = [];
  for (const it of items) {
    if (!String(it.title).toLowerCase().includes(kw)) continue;
    // 同游戏可能同时出现在“更新流”与“热榜”，按源 URL 去重
    const key = String(it.url).replace(/\/topic\/detail\/\d+/, '');
    const urlKey = String(it.url);
    const gameId = (urlKey.match(/topic\/detail\/(\d+)/) || [])[1] || urlKey;
    if (seenUrl.has(gameId)) continue;
    seenUrl.add(gameId);
    matched.push(it);
    if (matched.length >= 10) break;
  }
  return { matched, indexed: items.length };
}

/**
 * 机地 周/月/年 三档热榜：任意详情页 appState.topic.{weeklyHots,monthlyHots,annualHots}
 * 用长期存在的高热度话题页作为锚点（艾尔登法环）。
 */
const HOT_ANCHOR = '3279789';

async function hotRanks() {
  const url = `${HOST_JIDI}/topic/detail/${HOT_ANCHOR}`;
  const html = await getHtml(url);
  const state = extractAppState(html);
  if (!state || !state.topic) throw new Error('机地热榜页解析失败（可能改版）: ' + url);
  const out = { weekly: [], monthly: [], annual: [] };
  const map = { weeklyHots: 'weekly', monthlyHots: 'monthly', annualHots: 'annual' };
  for (const [key, period] of Object.entries(map)) {
    const arr = Array.isArray(state.topic[key]) ? state.topic[key] : [];
    arr.slice(0, 12).forEach((x, i) => {
      if (!x || !x.topic) return;
      let cover = null;
      try {
        const cu = x.cover_urls || {};
        if (cu.origin && cu.origin.urls && cu.origin.urls[0]) cover = cu.origin.urls[0];
        else if (cu.aspect_low && cu.aspect_low.urls && cu.aspect_low.urls[0]) cover = cu.aspect_low.urls[0];
      } catch {}
      const gi = x.game_info || {};
      const genres = Array.isArray(gi.genres)
        ? gi.genres.filter((g) => !/^\d+(?:\.\d+)?\s*(GB|MB|TB)$/i.test(String(g)))
        : [];
      out[period].push({
        id: `hot-${period}-${x.tid || x.id}`,
        source: 'jidi', period, rank: i + 1, kind: 'rank',
        title: x.topic, cover,
        score: x.rating && x.rating.score != null ? x.rating.score : null,
        genres, size: gi.storage || null,
        updatedTs: x.mod_ut ? x.mod_ut * 1000 : null,
        url: `${HOST_JIDI}/topic/detail/${x.tid || x.id}`,
      });
    });
  }
  return out;
}

/* ============ 本地库双源合并：机地候选条目（归一化,与 xd 库条目同构） ============ */
// 机地原始标签 → 库内复合分类(与 games.json genres / 前端 CATS 对齐, browse 才能命中)
const G2CAT = [
  [/即时战略/i, '即时战略'],
  [/^策略/i, '策略战棋'],
  [/^(动作|冒险|开放世界|格斗|roguelike)/i, '动作冒险'],
  [/角色扮演/i, '角色扮演'],
  [/射击/i, '枪战射击'],
  [/^(体育|竞速)/i, '体育竞速'],
  [/^模拟/i, '模拟经营'],
  [/^(休闲|益智|解谜|卡牌|音乐)/i, '休闲益智'],
  [/^(恐怖|生存|惊悚)/i, '恐怖惊悚'],
  [/^多人/i, '联机整合'],
  [/^免费/i, '免费专区'],
];
function normalizeGenres(list) {
  const out = Array.isArray(list) ? list.filter((x) => x && typeof x === 'string').slice(0, 6) : [];
  for (const raw of out) {
    for (const [re, cat] of G2CAT) {
      if (re.test(raw) && !out.includes(cat)) out.push(cat);
    }
  }
  return out;
}
/* 旧版就地实现，且正则同样有贪婪吃位问题；现统一委托 shared.normDate（含范围校验与还原） */
const isoDate = (s) => normDate(s);
/**
 * 收集可入库的机地游戏话题（首页 SSR 新游更新 + 周/月/年三档热榜,按 topic id 去重）。
 * 机地为社区话题制,无公开分页列表,可批量收录的上限即"首页 + 热榜"覆盖的话题集合。
 * 返回条目与 xd 库条目同构（id 用 jidi- 前缀,url 指向机地详情）。
 */
async function libraryCandidates() {
  const [fR, hR] = await Promise.allSettled([feed(), hotRanks()]);
  const map = new Map(); // tid -> entry
  const push = (it) => {
    if (!it || !it.title || !it.url) return;
    const tid = (String(it.url).match(/topic\/detail\/(\d+)/) || [])[1];
    if (!tid) return;
    const old = map.get(tid);
    if (old) { // 同名话题: 后到者仅补空缺字段(热榜优先于首页卡)
      for (const k of ['cover', 'score', 'size', 'updatedTs', 'dateLabel']) if (!old[k] && it[k]) old[k] = it[k];
      if (!old.genres.length && it.genres) old.genres = it.genres;
      return;
    }
    let genres = normalizeGenres(it.genres);
    /* ★ 强制归一化：两个源站日期格式不同（XD `2026-09-14` / 机地 `2026/9/9`），
     *   机地旧数据还可能已带污染值（`2026/9/89`）。统一转 ISO 后再落盘，
     *   让「最新更新」的分组键与排序键在全库范围内可比。 */
    let dateLabel = normDate(it.dateLabel) || normDate(it.releaseDate) || null;
    let updatedTs = it.updatedTs || null;
    if (!updatedTs && dateLabel) {
      const t = Date.parse(dateLabel + 'T00:00:00Z');
      if (Number.isFinite(t)) updatedTs = t;   // ★ 防 NaN：斜杠/畸形日期曾让这里静默产出 NaN
    }
    map.set(tid, {
      id: 'jidi-' + tid,
      source: 'jidi',
      title: String(it.title).trim(),
      cover: /^https?:/.test(String(it.cover || '')) ? it.cover : null,
      genres,
      size: it.size || null,
      score: it.score != null && it.score > 0 && it.score <= 10 ? it.score : null,
      updatedTs,
      dateLabel,
      url: String(it.url),
    });
  };
  if (hR.status === 'fulfilled') {
    for (const p of ['weekly', 'monthly', 'annual']) (hR.value[p] || []).forEach(push);
  }
  if (fR.status === 'fulfilled') fR.value.forEach(push);
  return [...map.values()];
}

module.exports = { feed, detail, extractAppState, search, hotRanks, libraryCandidates, normalizeGenres };
