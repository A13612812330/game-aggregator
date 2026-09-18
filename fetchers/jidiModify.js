/**
 * fetchers/jidiModify.js — 机地「MOD / 修改器」社区帖子列表抓取
 *
 * 数据源：https://jidiyouxi.com/modify/list  的两个页签（`resource_type` 区分）
 *   resource_type = 1 → 手游      （本项目不用，手游另有手游中心）
 *   resource_type = 2 → MOD       （约 7,800 条）
 *   resource_type = 3 → 修改器     （约 1,100 条）
 *
 * ─────────────────────────────────────────────────────────────
 * ★ 为什么必须走签名（本项目第一次拿下机地的写接口）
 *
 * 机地列表是 SSR 首屏 + 客户端翻页；翻页打的是
 *     POST /api/misc/post_list?websign=<sign>      body 为 text/plain
 * 直接 POST 无论是空 body、还是只带业务参数，都只回
 *     {"ret":-1,"errcode":-1,"msg":"请求参数错误"}
 * 且**签名对错返回的是同一句话**（不会告诉你「签名错」），所以很能误导人。
 *
 * 还原自 `app.<hash>.js` 模块 67052：
 *     sign = websign = "v2-" + md5( String(h_m || 0) + md5( JSON.stringify(body) + "YhD6TCs9VpAl" ) )
 *
 * ★★ 真正的关键在 body —— 不是「业务参数」而是 **整份 env 的展开**：
 *     body = { ...env, ...auth, ...业务参数, h_ts: Date.now(), h_ch }
 *     其中 env 就嵌在列表页 HTML 的 <script id="appState"> 里（含服务端下发的 h_did UUID）。
 *     实测：只发业务参数 → 「请求参数错误」；带上 env 全量 → ret:1 正常返回。
 *     也就是说 服务端在拿 env 里的字段做校验（h_did / host / app 等），
 *     而不是单纯核对我们自己算的签名。
 *     因此本模块**必须先抓一次 /modify/list 的 SSR HTML 取 env**，再开始翻页。
 *     同一个 env 在整轮抓取里复用（签名里的 h_ts/ct 是每次重算的）。
 *
 * ★ 分页：返回体 data.next_cb 形如 '{"offset":20}'，原样回传即可；
 *   服务端 limit 上限实测为 **100**（传 200 仍只回 100）。
 *
 * ★ 条目里最有价值的两个字段：
 *   · `topic.topic` —— 这条 MOD/修改器**属于哪款游戏**（跨源匹配端游库靠它）
 *   · `content`     —— 正文，通常直接带**网盘直链**（夸克/百度/迅雷），这才是用户要的
 *   封面不在条目上，要用 `topic.cover`（数值 id）拼：
 *     https://img2.52jidi.com/topic/cover/id/{topic.cover}/sz/src
 *
 * 用法：
 *   const { poll } = require('./jidiModify');
 *   const items = await poll('mod', { max: 0 });      // 0 = 全量
 */
const { UA, HOST_JIDI } = require('../shared');
/* ★ v10.22：签名与 env 缓存抽到 jidiSigned.js —— **算法只留一份**。
   本文件只保留「MOD / 修改器」这一条业务线自己的分页与字段归一化。
   `getEnv` 的签名与旧版一致（旧调用 `getEnv()` / `getEnv({force:true})` 仍可用）。 */
const { BODY_SALT, REQ_TIMEOUT, websign, extractEnv, getEnv: signedGetEnv } = require('./jidiSigned');

/** 服务端实测上限 100（传更大也只回 100） */
const PAGE_LIMIT = 100;
/** 翻页间隔（毫秒）—— 全量约 90 页，别把人家站点打疼 */
const PAGE_DELAY = 180;

/** 页签 → resource_type */
const TYPES = { mobile: 1, mod: 2, modifier: 3 };
const TYPE_LABEL = { mobile: '手游', mod: 'MOD', modifier: '修改器' };

/** 兼容旧调用形态：getEnv() / getEnv({force}) → 固定取 /modify/list 的 env */
async function getEnv({ force = false } = {}) {
  return signedGetEnv('/modify/list', { force });
}

/** 单页请求 */
async function postList({ sort = 'new', resourceType = 2, offset = null, limit = PAGE_LIMIT } = {}) {
  const env = await getEnv();
  const body = Object.assign(
    {},
    env,
    {
      sort,
      limit,
      resource_type: resourceType,
      next_cb: offset == null ? null : JSON.stringify({ offset }),
      h_ts: Date.now(),
      h_ch: 'other',
    }
  );
  body.h_did = body.h_did || '';
  body.sign = websign(body);
  const url = HOST_JIDI + '/api/misc/post_list?websign=' + encodeURIComponent(websign(body));

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'content-type': 'text/plain',
      Referer: HOST_JIDI + '/modify/list',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQ_TIMEOUT),
  });
  if (!r.ok) throw new Error('post_list HTTP ' + r.status);
  const j = await r.json();
  if (!j || j.ret !== 1) throw new Error('post_list 返回异常: ' + JSON.stringify(j).slice(0, 160));
  return j.data || {};
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 轮询某一类直到取完。
 * @param {'mod'|'modifier'|'mobile'} type
 * @param {{ sort?:string, max?:number, onPage?:Function }} opts  max=0 表示不限量
 */
async function poll(type, opts = {}) {
  const rt = TYPES[type];
  if (!rt) throw new Error('未知类型: ' + type);
  const sort = opts.sort || 'new';
  const max = Number.isFinite(opts.max) ? opts.max : 0;

  const out = [];
  const seen = new Set();
  let offset = null;
  let count = null;
  let page = 0;

  for (;;) {
    const d = await postList({ sort, resourceType: rt, offset });
    const list = Array.isArray(d.list) ? d.list : [];
    page++;
    if (count == null && d.count != null) count = d.count;

    for (const it of list) {
      if (!it || it.id == null) continue;
      const k = String(it.id);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(it);
    }

    if (opts.onPage) opts.onPage({ page, got: out.length, count });
    if (!list.length || !d.more) break;
    if (max > 0 && out.length >= max) break;

    const nxt = typeof d.next_cb === 'string' ? d.next_cb : null;
    let nextOffset = null;
    if (nxt) {
      try { nextOffset = JSON.parse(nxt).offset; } catch { nextOffset = null; }
    }
    if (nextOffset == null) nextOffset = page * PAGE_LIMIT;
    if (nextOffset <= (offset == null ? -1 : offset)) break;   // 防死循环
    offset = nextOffset;

    await sleep(PAGE_DELAY);
  }

  return { type, resourceType: rt, sort, count, fetched: out.length, items: out };
}

/** 一次性取两类（MOD + 修改器） */
async function pollBoth(opts = {}) {
  const mod = await poll('mod', opts);
  const modifier = await poll('modifier', opts);
  return { mod, modifier };
}

/** 正文保留上限。★ 截断后的**总长**必须 ≤ MAX：截断提示本身也占字符，
 *  先减掉提示长度再切，否则会出现 6011 字这种「以为截到 6000 其实超了」的边界。 */
const CONTENT_MAX = 6000;
const CONTENT_NOTE = '…（正文过长已截断）';

/** 条目 → 展示用归一化结构（纯函数，便于离线测试） */
function shape(it) {
  const topic = it.topic || {};
  const coverId = topic.cover;
  const member = it.member || {};
  const raw = String(it.content || '');
  return {
    id: String(it.id),
    kind: it.resource_type === 2 ? 'mod' : 'modifier',
    title: String(it.title || '').trim(),
    game: String(topic.topic || '').trim(),
    gameTid: topic.id || null,
    cover: coverId ? 'https://img2.52jidi.com/topic/cover/id/' + coverId + '/sz/src' : '',
    author: String(member.name || '').trim(),
    ct: it.ct || 0,                       // 发布（秒）
    ut: it.ut || 0,                       // 更新（秒）
    pv: it.pv || 0,
    favors: it.favors || 0,
    content: raw.length > CONTENT_MAX
      ? raw.slice(0, CONTENT_MAX - CONTENT_NOTE.length) + CONTENT_NOTE
      : raw,
    links: extractLinks(raw),
    url: HOST_JIDI + '/post/detail/' + it.id,
  };
}

/* ★ v10.22：网盘识别表与 `extractLinks` 已统一到 `shared.js`。
   本文件曾自带一份（上限 12、不过滤站内链接），与 jidiTopics 那份（上限 20、过滤站内）不一致
   —— 同一段正文在两个功能下抽出不同结果。现只保留一份实现，此处仅按本模块的历史
   契约（上限 12、字段名 `kind`）转调。 */
const { extractLinks: sharedExtractLinks } = require('../shared');

/** 从正文里挖网盘/直链（用户实际要的就是这个） */
function extractLinks(text) {
  return sharedExtractLinks(text, { max: 12 });
}

module.exports = {
  TYPES, TYPE_LABEL, PAGE_LIMIT, BODY_SALT, CONTENT_MAX,
  websign, extractEnv, getEnv, postList, poll, pollBoth, shape, extractLinks,
};
