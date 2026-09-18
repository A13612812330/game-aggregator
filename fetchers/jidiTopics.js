/**
 * fetchers/jidiTopics.js — 机地「游戏话题库」全量抓取（v10.22 新增）
 *
 * ─────────────────────────────────────────────────────────────
 * ★★ 为什么要有这个文件：本项目最大的一块数据缺口
 *
 * 在此之前，本地端游库的机地一侧只有 **66 条**（`fetchers/jidi.js` 的
 * `libraryCandidates()` 只能拿「首页 SSR 新游 + 周/月/年热榜」，那是个**人工精选**集合），
 * 而 XD 一侧有 15,319 条 —— 两个源严重失衡，
 * 于是「机地一侧的封面 / 配置要求 / 热度」在下游全部缺位。
 *
 * 实测发现机地其实有**完整的全量话题列表接口**：
 *     POST /api/topic/get_topics?websign=<sign>     （签名与 env 见 jidiSigned.js）
 *     body = { ...env, offset, limit, next_cb, cur_page:'all_topic', sort, genre }
 *     返回 { list[], more, next_cb, total }
 *   · `total` 字段**恒为 0**（服务端没填），不能拿它当总数 ——
 *     实测用 offset 递增探边界：offset=17000 回 98 条，offset=20000 回 0 条
 *     ⇒ 全量约 **17,198 条**。
 *   · `limit` 实测**可到 1000**（传 1000 就回 1000）⇒ 全量只需 **约 18 次请求**，
 *     而不是照着页面分页的 862 次。这是本模块敢做「全量」的关键。
 *   · `sort`：`update`（默认）/ `hot`（按热度，首条 dpv=348,065 的《剑星》）。
 *
 * ★ 每条 topic 自带的东西远超「一个名字」：
 *   · `game_info.pc_requirement.min/.rec` —— **PC 配置要求**（cpu/ram/os/gpu/storage/net）
 *   · `game_info.game_sys_reqs[]`        —— 人读版配置行，**比 pc_requirement 多出
 *                                           DX 与硬盘空间两项**（实测前 100 条 84 条有，
 *                                           其中 82 条含显卡信息）
 *   · `game_info.header_image_uri`       —— **Steam CDN 图**，里面就带 **Steam appid**
 *   · `dpv`                              —— 浏览量（热度），用来做「可适配游戏优先推热门」
 *   · `rating.score` / `game_info.release_date` / `real_storage`
 *
 *   ⇒ 也就是说：**配置要求不必再去 Steam 逐款查**，机地这边直接给；
 *     而且它给的是「人话版」（"DirectX®： DirectX 9.0c"、"硬盘： 32GB 剩余硬盘空间"），
 *     正好补上 steam-req.json 里大量缺失的 dx / storage 两项。
 *
 * ★ 详情页的下载链接：见 `postsOf(tid)`。机地详情页 SSR 的 appState 里
 *   直接嵌了 `postsMap` / `postList`，每条 post 的 `content` 正文里就是**网盘直链**
 *   （夸克 / 百度 / 迅雷），还有 `resource_tag` 的「已测试」标记与作者。
 *   所以取下载链接**不需要无头浏览器**，解析 SSR 即可。
 *
 * 用法：
 *   const jt = require('./jidiTopics');
 *   const r = await jt.crawlAll({ onPage: (p) => console.log(p) });   // 全量 ~18 次请求
 *   const hot = await jt.fetchPage({ sort: 'hot', limit: 100 });
 */
const { HOST_JIDI, UA, normDate, dateTs, NETDISK, extractLinks } = require('../shared');
const { signedPost } = require('./jidiSigned');

const LIST_PAGE = '/topic/list';
const LIST_API = '/api/topic/get_topics';
/** 实测上限（传 1000 就回 1000） */
const PAGE_LIMIT = 1000;
/** 翻页间隔：只有 ~18 次请求，但别把人家站点打疼 */
const PAGE_DELAY = 260;

/* ============================================================
 *  ① 配置要求归一化
 * ============================================================ */

/** 人读配置行 → 字段名。标签在「：」前面，值在后面。
 *  ★ 顺序即优先级，两边都要放「更具体的在前」：
 *    `存储空间` 要先被 storage 认走，不能被前面的 `系统` 抢；
 *    `\bOS\b` 用词界，否则 `Notes` / `Close` 这类词也会被当成操作系统。 */
const SYS_LABEL = [
  [/系统|操作系统|\bOS\b/i, 'os'],
  [/处理器|\bCPU\b/i, 'cpu'],
  [/内存|\bRAM\b|记忆体/i, 'ram'],
  [/图形|显卡|\bGPU\b|显示卡|显示适配器/i, 'gpu'],
  [/DirectX|显示接口|图形接口|\bDX\b/i, 'dx'],
  [/硬盘|储存|存储|磁盘|空间/i, 'storage'],
  [/网络|网路/i, 'net'],
  [/分辨率|屏幕/i, 'res'],
  [/声卡|音效|音频/i, 'sound'],
  [/附注|备注|注意|其他|其它/i, 'notes'],
];

/** 配置文本里的长段落（2077 的附注有 400+ 字）→ 截断，别把产物撑起来 */
const NOTE_MAX = 200;

/**
 * 解析 `game_info.game_sys_reqs[]`（"标签： 值" 的字符串数组）
 * → { os, cpu, ram, gpu, dx, storage, net, res, sound }
 */
function parseSysReqs(list) {
  const out = {};
  if (!Array.isArray(list)) return out;
  for (const line of list) {
    const s = String(line == null ? '' : line).replace(/\s+/g, ' ').trim();
    if (!s) continue;
    const m = s.match(/^([^：:]{1,12})[：:]\s*(.+)$/);
    if (!m) continue;
    const label = m[1];
    const val = m[2].trim();
    if (!val) continue;
    const hit = SYS_LABEL.find(([re]) => re.test(label));
    if (!hit) continue;
    const k = hit[1];
    if (!out[k]) out[k] = val;
  }
  return out;
}

/** 从任意文本里抠 DirectX 版本号：`DirectX 9.0c` / `DX11` / `DirectX®： 11` → 9 / 11 */
function dxOf(s) {
  const m = String(s == null ? '' : s).match(/(?:direct\s*x|dx)\s*®?[：: ]*\s*(\d{1,2})(?:\.\d+)?/i);
  if (!m) return null;
  const v = +m[1];
  return v >= 8 && v <= 12 ? v : null;
}

/**
 * DX 版本统一入口。
 * ★ 必须能吃**两种形态**，这是实测踩到的坑：
 *   ① 带关键字的：`DirectX 版本: 12`  → dxOf 能认
 *   ② **裸数字**：标签已被 SYS_LABEL 认成 dx，剩下的值就只剩 `12`
 *      —— 此时 dxOf 找不到 "DX" 关键字，会返回 null。
 *      实测后果：200 条样本里 dx 抽取率只有 **2%**，
 *      而同一批数据的 sys_reqs 里明明写着 "DirectX 版本: 12"。
 *      ⇒ 一个「看起来更严格」的解析，实际把 98% 的数据丢掉了。
 */
function dxNum(v) {
  const s = String(v == null ? '' : v);
  const byKw = dxOf(s);
  if (byKw != null) return byKw;
  const bare = s.match(/^\s*(\d{1,2})(?:\.\d+)?\s*$/);
  if (bare) {
    const n = +bare[1];
    return n >= 8 && n <= 12 ? n : null;
  }
  return null;
}

/** 从任意文本里抠容量 GB：`32GB 剩余硬盘空间` / `1 GB` → 32 */
function gbOf(s) {
  const m = String(s == null ? '' : s).match(/(\d+(?:\.\d+)?)\s*(TB|GB|G\b|MB|M\b)/i);
  if (!m) return null;
  let v = +m[1];
  const u = m[2].toUpperCase();
  if (u === 'TB') v *= 1024;
  else if (u === 'MB' || u === 'M') v = v / 1024;
  if (!(v > 0)) return null;
  return Math.round(v * 10) / 10;
}

/**
 * 把 `pc_requirement` + `game_sys_reqs` 合成一份紧凑要求。
 * ★ 显式字段优先，空缺的用 sysReqs 补（sysReqs 的 DX / 硬盘是显式字段里没有的）。
 * ★ 只保留有值的键 —— 空对象不落盘，省体积。
 */
function shapeReq(pc, sysReqs) {
  const o = {};
  const p = (pc && typeof pc === 'object') ? pc : {};
  const fallback = parseSysReqs(sysReqs);

  const take = (k, src) => {
    const v = src[k];
    if (v == null) return;
    let s = String(v).replace(/\s+/g, ' ').trim();
    if (!s) return;
    if (k === 'notes' && s.length > NOTE_MAX) s = s.slice(0, NOTE_MAX) + '…';
    o[k] = s;
  };
  /* ★ 'dx' 必须在列表里 —— 漏了它，`o.dx` 永远是 undefined，
     于是只能退回 `fallback.dx`；而 fallback 的值是**裸数字** "12"，
     再喂给「必须有 DX 关键字」的 dxOf → null。两层都空，抽出来自然是 2%。 */
  for (const k of ['os', 'cpu', 'ram', 'gpu', 'storage', 'net', 'res', 'sound', 'notes', 'dx']) {
    take(k, p);
    if (!o[k] && fallback[k]) o[k] = fallback[k];
  }

  /* DX：先吃已被标签认出来的那格（可能是裸数字），再依次从显卡行、附注里兜 */
  let dx = dxNum(o.dx);
  if (dx == null) dx = dxNum(fallback.dx);
  if (dx == null) dx = dxOf(o.gpu);
  if (dx == null) dx = dxOf(o.notes);
  delete o.dx;                     // 原始文本扔掉，只留数值 —— 与 steam-req 同形，便于合并
  if (dx != null) o.dxV = dx;

  /* 容量：storage 文本 → GB 数值（判定要用数值；原文本保留给用户看） */
  let gb = gbOf(o.storage);
  if (gb == null) gb = gbOf(o.notes);
  if (gb != null) o.storageGb = gb;

  return Object.keys(o).length ? o : null;
}

/* ============================================================
 *  ② 条目归一化
 * ============================================================ */

/** 容量串混在 genres 里（`genres: ["16GB","策略"]`）—— 抠出来扔掉，别当分类 */
const SIZE_RE = /^\s*\d+(?:\.\d+)?\s*(?:TB|GB|MB)\s*$/i;

/** Steam appid：优先从 header_image 的 CDN url 抠，其次从 header_image_uri 前缀 */
function appidOf(gi) {
  const urls = [];
  const hi = gi && gi.header_image;
  if (hi && hi.urls) {
    for (const k of Object.keys(hi.urls)) {
      const u = hi.urls[k] && hi.urls[k].urls;
      if (Array.isArray(u)) urls.push(...u);
    }
  }
  for (const u of urls) {
    const m = String(u).match(/\/apps\/(\d+)\//);
    if (m) return Number(m[1]);
  }
  const uri = gi && gi.header_image_uri;
  const m2 = String(uri || '').match(/^(\d{3,})\//);
  return m2 ? Number(m2[1]) : null;
}

/**
 * 机地 topic → 库内紧凑结构。
 * ★ 刻意**不存** short_desc / about_game_txt / movies —— 那是详情页才要的正文，
 *   17k 条全存会把产物撑到几十 MB，而列表展示根本用不到。
 */
function shapeTopic(it) {
  if (!it) return null;
  const gi = it.game_info || {};
  const rawTitle = String(it.topic || gi.name || '').trim();
  if (!rawTitle) return null;

  /* 标题写法：「中文名/English Name」。拆开存，跨源匹配与检索各取所需 */
  const slash = rawTitle.indexOf('/');
  const title = slash > 0 ? rawTitle.slice(0, slash).trim() : rawTitle;
  const titleEn = (gi.name_en || (slash > 0 ? rawTitle.slice(slash + 1) : '')).trim() || null;

  const genres = (Array.isArray(gi.genres) ? gi.genres : [])
    .map((x) => String(x == null ? '' : x).trim())
    .filter((x) => x && !SIZE_RE.test(x))
    .slice(0, 6);

  const cover = (() => {
    const c = it.cover_urls || {};
    const o = c.origin && c.origin.urls;
    if (Array.isArray(o) && o[0]) return String(o[0]);
    const l = c.aspect_low && c.aspect_low.urls;
    if (Array.isArray(l) && l[0]) return String(l[0]);
    return it.cover ? 'https://img2.52jidi.com/topic/cover/id/' + it.cover + '/sz/src' : null;
  })();

  const min = shapeReq(gi.pc_requirement && gi.pc_requirement.min, gi.game_sys_reqs);
  const rec = shapeReq(gi.pc_requirement && gi.pc_requirement.rec, null);

  const dateLabel = normDate(gi.release_date) || normDate(it.release_date) || null;
  const tid = it.tid || it.id;

  return {
    tid: Number(tid),
    title,
    titleEn,
    cover,
    appid: appidOf(gi),
    genres,
    size: (gi.real_storage || gi.storage || null) || null,
    score: it.rating && it.rating.score != null && it.rating.score > 0 ? Math.round(it.rating.score * 10) / 10 : null,
    /** 浏览量 = 热度。★「可适配游戏优先推热门」就靠它 */
    dpv: Number(it.dpv) || 0,
    pv: Number(it.pv) || 0,
    /** 资源更新数：0 表示这话题下还没有可下载的帖子 */
    modCnt: Number(it.mod_cnt) || 0,
    releaseDate: dateLabel,
    updatedAt: it.ut ? it.ut * 1000 : null,
    min: min || null,
    rec: rec || null,
    url: HOST_JIDI + '/topic/detail/' + tid,
  };
}

/* ============================================================
 *  ③ 取数
 * ============================================================ */

/**
 * 取一页话题。
 * @param {object} o
 * @param {number} [o.offset=0]
 * @param {number} [o.limit=1000]
 * @param {string} [o.sort='update']  'update' | 'hot'
 * @param {string} [o.genre='']
 * @param {string|null} [o.nextCb]   上一页返回的 next_cb，原样回传
 */
async function fetchPage({ offset = 0, limit = PAGE_LIMIT, sort = 'update', genre = '', nextCb = null } = {}) {
  const data = await signedPost({
    api: LIST_API,
    referer: LIST_PAGE,
    body: {
      offset,
      limit,
      next_cb: nextCb == null ? (offset ? JSON.stringify({ offset, top_offset: 0 }) : '') : nextCb,
      cur_page: 'all_topic',
      sort,
      genre,
    },
  });
  const list = Array.isArray(data.list) ? data.list : [];
  return { list, more: Number(data.more) || 0, nextCb: data.next_cb || null };
}

/**
 * 全量/限量抓取。
 * ★ 循环靠 **offset 递增 + 返回空即停**，不依赖 `total`（它恒为 0，是不可信的陷阱字段）。
 * @param {object} o
 * @param {string} [o.sort='update']
 * @param {number} [o.max=0]           0 = 全量
 * @param {number} [o.limit=PAGE_LIMIT]
 * @param {Function} [o.onPage]        ({page, got, offset})
 */
async function crawlAll({ sort = 'update', max = 0, limit = PAGE_LIMIT, onPage } = {}) {
  const seen = new Set();
  const items = [];
  let offset = 0;
  let page = 0;

  for (;;) {
    page++;
    let r;
    try {
      r = await fetchPage({ offset, limit, sort });
    } catch (e) {
      /* 单页失败重试一次（长跑里偶发超时不该让整轮白跑） */
      await sleep(PAGE_DELAY * 2);
      r = await fetchPage({ offset, limit, sort });
    }
    if (!r.list.length) break;

    for (const it of r.list) {
      const tid = it && (it.tid || it.id);
      if (!tid) continue;
      const k = String(tid);
      if (seen.has(k)) continue;
      seen.add(k);
      items.push(it);
    }

    if (onPage) onPage({ page, got: items.length, offset });
    if (max > 0 && items.length >= max) break;
    if (!r.more) break;

    offset += limit;
    await sleep(PAGE_DELAY);
  }

  return { sort, fetched: items.length, pages: page, items };
}

/** 抓取热榜前 N（用于「优先推热门」） */
async function hotTopics(limit = 200) {
  const r = await fetchPage({ offset: 0, limit: Math.min(limit, PAGE_LIMIT), sort: 'hot' });
  return r.list;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================================================
 *  ④ 详情页帖子（下载链接的来源）
 * ============================================================ */

/* ★ 网盘识别表与 `extractLinks` 已统一到 shared.js —— 见那里的说明。
   本模块不再自带一份（曾与 jidiModify 各写一份，同一段正文抽出不同结果）。 */

/** 从详情页 HTML 里取 appState（详情页与列表页同构，但 detail 是独立 JSON 块） */
function extractDetailState(html) {
  const m = String(html || '').match(/<script id="appState"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  const raw = m[1].replace(/^window\.[A-Za-z_$]+=/, '').trim().replace(/;?\s*$/, '');
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * 取某个话题下的帖子（下载来源）。
 *
 * ★ 为什么解析 SSR 而不是调接口：详情页 SSR 的 appState 里**已经嵌了**
 *   `topic.postsMap` / `topic.postList`（首屏那一批），够用且零签名成本。
 *   实测该块里同时含「本体」与「MOD / 补丁」帖，靠 `resource_type` 与 `title` 区分。
 *
 * @returns {Promise<{tid:number, title:string, posts:Array}>}
 */
async function postsOf(tid, { html: given } = {}) {
  const url = HOST_JIDI + '/topic/detail/' + tid;
  let html = given;
  if (!html) {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'zh-CN,zh;q=0.9' },
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) throw new Error('机地详情页 HTTP ' + r.status);
    html = await r.text();
  }
  const j = extractDetailState(html);
  const tp = (j && j.topic) || {};
  /* ★ 帖子在 `topic.ssrData` 里，**不在** topic 顶层 ——
     实测 topic 顶层只有 currentTopic / 热榜，真正的首屏帖子挂在
     `topic.ssrData.postsMap.list`（同结构还有 ssrData.postList）。
     先取 ssrData，再退到顶层，两处都空才算「这话题没有可下载资源」。 */
  const ssr = tp.ssrData || {};
  const raw = (ssr.postsMap && Array.isArray(ssr.postsMap.list) && ssr.postsMap.list.length ? ssr.postsMap.list : null)
    || (Array.isArray(ssr.postList) && ssr.postList.length ? ssr.postList : null)
    || (tp.postsMap && Array.isArray(tp.postsMap.list) ? tp.postsMap.list : null)
    || (Array.isArray(tp.postList) ? tp.postList : []);

  const seen = new Set();
  const posts = [];
  for (const p of raw) {
    if (!p || p.id == null) continue;
    const k = String(p.id);
    if (seen.has(k)) continue;
    seen.add(k);
    const links = extractLinks(p.content);
    if (!links.length) continue;                    // 没有网盘链接的帖子对「下载」无意义
    const tags = (Array.isArray(p.resource_tag) ? p.resource_tag : [])
      .map((t) => (t && t.tag) || '').filter(Boolean);
    posts.push({
      id: String(p.id),
      title: String(p.title || '').trim() || null,
      author: (p.member && p.member.name) || null,
      /** 浏览量：用来把「最热的那份资源」排前面 */
      dpv: Number(p.dpv) || 0,
      pv: Number(p.pv) || 0,
      ct: p.ct ? p.ct * 1000 : null,                 // 发布
      ut: p.ut ? p.ut * 1000 : null,                 // 更新
      tags,
      links,
      url: HOST_JIDI + '/post/detail/' + p.id,
      content: String(p.content || '').slice(0, 800),
    });
  }

  /* 按热度降序：用户要的是「点开就能下」，最热的那份资源应排第一 */
  posts.sort((a, b) => (b.dpv || b.pv || 0) - (a.dpv || a.pv || 0));

  return {
    tid: Number(tid),
    title: String((ssr.topicInfo && ssr.topicInfo.topic) || (tp.currentTopic && tp.currentTopic.topic) || '').trim() || null,
    subtitle: (ssr.topicInfo && (ssr.topicInfo.name_en || null)) || null,
    posts,
  };
}

module.exports = {
  LIST_PAGE, LIST_API, PAGE_LIMIT, PAGE_DELAY, NETDISK, NOTE_MAX,
  parseSysReqs, dxOf, dxNum, gbOf, shapeReq, appidOf, shapeTopic,
  fetchPage, crawlAll, hotTopics, extractLinks, extractDetailState, postsOf,
};
