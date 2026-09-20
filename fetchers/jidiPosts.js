/**
 * fetchers/jidiPosts.js — 机地「话题资源专区」抓取（本体 / mod / 修改器）  ★ v10.26 新增
 *
 * ─────────────────────────────────────────────────────────────
 * ★★ 补的是什么缺口
 *
 * 在此之前，机地的下载链接只有一条路：`jidiTopics.postsOf(tid)` 解析**话题详情页的 SSR**
 * （`topic.ssrData.postsMap` / `postList`）。它有两个结构性上限，实测（剑星 tid=171085167）：
 *
 *   · SSR 只嵌**首屏 10 条**，而话题下实际有 **336** 条帖子
 *   · 这 10 条是**不分专区的混合**，且偏「本体」——mod 与修改器几乎进不来
 *
 *   同期实测（渔力全开 tid=2117239899）：
 *     SSR 覆盖 10 条（全是本体），接口覆盖 本体 29 / mod 2 / 修改器 2
 *   ⇒ 也就是说：**用户点「下载」时，mod 与修改器那一整块根本取不到**，
 *     而机地的页面本身是分成「本体 / mod / 修改器」三个 tab 给全的。
 *
 * ★ 真正的列表接口：还是 `/api/misc/post_list`（与 jidiModify 同一个），
 *   但**业务参数完全不同**——这里用 `tid` + `resource_type`，按话题取。
 *
 *   POST /api/misc/post_list?websign=<sign>
 *   body = { ...env, tid, resource_type, c_types:[1,2], sort, offset, limit, next_cb, h_ts, h_ch }
 *   返回 { list[], count, more, next_cb }
 *
 *   实测（剑星）：
 *     resource_type=1 → count 22   （本体）
 *     resource_type=2 → count 190  （mod，**恰好等于话题的 mod_cnt=190**）
 *     resource_type=3 → count 4    （修改器）
 *   `mod` 那个数与 `topic.currentTopic.mod_cnt` 逐位吻合，是「resource_type 就是专区过滤」最强的旁证。
 *
 * ★★ 三个必须记住的坑（都实测过，别再踩）
 *
 *   ① **`folder_id` 是死参数**。详情页 SSR 的 `folder_list` 给的是
 *      `[{folder_id:7,name:'本体'},{6:'mod'},{8:'修改器'},{10:'讨论求助'}]`，
 *      前端也确实把它塞进了请求（`getTopicPosts({tid, folder_id, c_types, sort, t, next_cb, limit})`），
 *      但实测 **folder_id=6/7/8/10 四个值返回的首条 id、count、next_cb 一模一样** ——
 *      服务端根本不看它。专区过滤**只能靠 `resource_type`**。
 *      （所以本文件依然记着 folderId，但它只作「与源站对标」的文档，不参与过滤。）
 *
 *   ② **`topic_id` 这个名字是错的**，用 `tid`。实测 `topic_id=<tid>` → `ret:-1 出现了一个小问题`，
 *      换成 `tid` → ret:1。同一个接口两种叫法只活一个，且**报错信息完全看不出是参数名问题**。
 *
 *   ③ **`c_types` 不能省**。前端固定传 `SUPPORT_POSTS_CTYPE = [1,2]`
 *      （还原自 app chunk：`POST_TYPE = {Post:1, GameReviewPost:2}`）。
 *      不传时服务端会走默认口径，历史数据里混进来的 `resource_type=0`（c_type=3 的评论帖、
 *      标题为空）会排到前面 —— 实测 `sort=new` 不传 c_types 时首条标题是**空字符串**。
 *
 * ★ 排序：`sort` ∈ `hot`（最热，默认，与详情页 SSR 的 selectedSort 一致）/ `new` / `reply`。
 *   ★ 注意 `new` 会把无标题的评论帖排上来，所以 `shapePost` 之后一律**按有标题优先**再排。
 *
 * ★ 分页：`limit` 实测上限 **100**（传 200 仍只回 100）；翻页把上页的 `next_cb` 原样回传。
 *   实测三专区并行各取 100 条总耗时 **624ms**、响应体 187KB+864KB+24KB —— 快的部分是
 *   「并行」，慢的部分是 mod 帖自带的 `imgs` 大 JSON（我们解析完只留必要字段）。
 *
 * 用法：
 *   const jp = require('./jidiPosts');
 *   const r = await jp.topicPosts({ tid: 171085167, sort: 'hot', perSection: 50 });
 *   r.sections.forEach(s => console.log(s.name, s.count, s.items.length));
 */
const { HOST_JIDI, extractLinks } = require('../shared');
const { signedPost } = require('./jidiSigned');

/* ============================================================
 *  ① 专区定义
 * ============================================================ */

/**
 * 三个专区。
 * `folderId` 只作与源站 `folder_list` 对标的文档（**服务端忽略它**，见头部坑①）；
 * 真正生效的过滤键是 `resourceType`。
 * `id`/`name` 取自实测的 `topic.currentTopic.folder_list`：
 *   {folder_id:7,folder_name:'本体'} {6:'mod'} {8:'修改器'} {10:'讨论求助'}
 * 「讨论求助」（10）**不在抓取范围**：那是问答帖，不是资源。
 */
const SECTIONS = [
  { key: 'body', name: '本体', folderId: 7, resourceType: 1 },
  { key: 'mod', name: 'mod', folderId: 6, resourceType: 2 },
  { key: 'modifier', name: '修改器', folderId: 8, resourceType: 3 },
];

/** 与源站前端一致：`SUPPORT_POSTS_CTYPE = [POST_TYPE.Post, POST_TYPE.GameReviewPost]` */
const C_TYPES = [1, 2];
/** 服务端实测上限（传 200 仍只回 100） */
const PAGE_LIMIT = 100;
/** 合法排序（还原自 app chunk 的 TOPIC_SORT 枚举） */
const SORTS = ['hot', 'new', 'reply'];
/** 单条正文截断上限（正文可能有几千字，我们只要链接与摘要） */
const NOTE_MAX = 300;

/* ============================================================
 *  ② 取数
 * ============================================================ */

/**
 * 取某话题**某一个专区**的帖子（单页）。
 *
 * @param {object} o
 * @param {string|number} o.tid
 * @param {number} o.resourceType   1 本体 / 2 mod / 3 修改器
 * @param {string} [o.sort='hot']
 * @param {number} [o.limit=PAGE_LIMIT]
 * @param {number} [o.offset=0]
 * @param {string} [o.nextCb='']    上一页返回的 next_cb，原样回传
 */
async function fetchSection({ tid, resourceType, sort = 'hot', limit = PAGE_LIMIT, offset = 0, nextCb = '' }) {
  const s = SORTS.includes(sort) ? sort : 'hot';
  const data = await signedPost({
    api: '/api/misc/post_list',
    /* Referer 用详情页（请求发起的页面），但 env 必须取列表页那份 ——
       详情页的 appState.env 没有 host 字段，getEnv 会直接抛「未嵌入 env」。
       两者不同正是 v10.26 给 signedPost 加 envPath 的原因。 */
    referer: '/topic/detail/' + tid,
    envPath: '/topic/list',
    body: {
      tid: Number(tid),
      resource_type: Number(resourceType),
      c_types: C_TYPES,
      sort: s,
      offset,
      limit,
      next_cb: nextCb || '',
    },
  });
  const list = Array.isArray(data.list) ? data.list : [];
  return {
    list,
    /** 服务端报的该专区总条数（**可能大于本次取回的条数**，UI 要靠它说「另有 N 条」） */
    count: Number(data.count) || 0,
    more: Number(data.more) || 0,
    nextCb: data.next_cb || '',
  };
}

/** 按需翻页取到 `max` 条（max<=0 表示只取一页） */
async function fetchSectionAll({ tid, resourceType, sort = 'hot', max = 0 }) {
  const out = [];
  const seen = new Set();
  let count = 0;
  let nextCb = '';
  let offset = 0;
  let page = 0;

  for (;;) {
    const r = await fetchSection({ tid, resourceType, sort, limit: PAGE_LIMIT, offset, nextCb });
    page++;
    if (page === 1) count = r.count;

    for (const p of r.list) {
      if (!p || p.id == null) continue;
      const k = String(p.id);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(p);
    }

    if (!r.list.length || !r.more) break;
    /* ★ 截断必须在**这一页收完之后立刻做**，不能只等下一轮循环开头判 ——
       实测 `perSection=50` 却返回了 100 条：一页就是 100（PAGE_LIMIT），
       而「取够了没」是在取完这一页后才判的，于是永远整页带出。
       差 50 条不会报错，只会让响应体白白大一倍。 */
    if (max > 0 && out.length >= max) { out.splice(max); break; }

    let nx = null;
    if (typeof r.nextCb === 'string' && r.nextCb) {
      try { nx = JSON.parse(r.nextCb).offset; } catch { nx = null; }
    }
    if (nx == null) nx = offset + PAGE_LIMIT;
    if (nx <= offset) break;                      // 防死循环
    offset = nx;
    nextCb = r.nextCb;
  }

  return { list: out, count: count || out.length, pages: page };
}

/**
 * 取一个专区，并在**源站总数 > 本次取回**时补抓一页 `sort=new` 合并。
 *
 * ★ 为什么值得多花一次请求（实测 剑星 tid=171085167，2026-09-20）：
 *
 *   | 专区 | 源站总数 | hot 前 50 | new 前 50 | 并集 | 交集 |
 *   |---|---|---|---|---|---|
 *   | 本体 | 22 | 22（取满） | 22（一模一样） | 22 | 22 |
 *   | mod | 190 | 50 | 50 | **63** | 37 |
 *   | 修改器 | 4 | 4（取满） | 4（一模一样） | 4 | 4 |
 *
 *   ⇒ 只有 **mod** 是真不一样。不补抓的话，前端那个「最近发布」开关
 *     只是把同一批帖子重排一遍（最新几帖根本不在数据里）——
 *     一个看着能用、其实骗人的开关，比没有这个开关更糟。
 *   ⇒ 补抓条件卡在 `count > 已取回`：取满了就不存在「最新还不在里面」的问题，
 *     本体 22 帖、修改器 4 帖都不会多发一次请求（实测这两类 hot/new 结果**完全相同**）。
 *
 * ★ 合并用 id 去重；补抓失败**不影响主结果**，但必须留痕（`newError`），
 *   否则「排序切到最近发布没变化」会被当成前端 bug 查半天。
 */
async function fetchSectionSmart({ tid, resourceType, sort = 'hot', max = 0, mergeNew = true }) {
  const base = await fetchSectionAll({ tid, resourceType, sort, max });
  const out = {
    list: base.list,
    count: base.count,
    pages: base.pages,
    /** 是否真的补抓并合并了 `sort=new` 那批 */
    merged: false,
    added: 0,
    newError: null,
  };
  if (mergeNew === false) return out;
  if (!(base.count > base.list.length)) return out;      // 已取满 → 无需补抓

  try {
    const n = await fetchSection({ tid, resourceType, sort: 'new', limit: PAGE_LIMIT, offset: 0 });
    const seen = new Set(base.list.map((p) => String((p && p.id))));
    for (const p of n.list) {
      if (!p || p.id == null) continue;
      const k = String(p.id);
      if (seen.has(k)) continue;
      seen.add(k);
      base.list.push(p);
      out.added++;
    }
    out.merged = out.added > 0;
  } catch (e) {
    out.newError = String((e && e.message) || e);
  }
  return out;
}

/* ============================================================
 *  ③ 归一化（纯函数，便于离线断言）
 * ============================================================ */

/**
 * 帖子里真正有用的标签在 **`game_info.resource_tag`**，不在顶层。
 * ★ 这是实测出来的一个**静默空值**：老代码（jidiTopics.postsOf）读的是 `p.resource_tag`，
 *   而接口/SSR 的帖子结构里该字段在顶层并不存在 —— 于是 `tags` 永远是 `[]`，
 *   界面上「已测试 / 迅雷网盘免费高速」这类徽标从来没显示过，且不报任何错。
 *   两处都读一遍（顶层兼容旧结构），保证不会因为上游调整又变空。
 */
function tagsOf(p) {
  const gi = (p && p.game_info) || {};
  const raw = (Array.isArray(p && p.resource_tag) ? p.resource_tag : null)
    || (Array.isArray(gi.resource_tag) ? gi.resource_tag : []);
  return raw.map((t) => (t && (t.tag || t.name)) || '').filter(Boolean);
}

/**
 * 帖子所属游戏名。
 * ★ `topic` 字段同样是**JSON 字符串**（`"{\"id\":171085167,\"topic\":\"剑星\",…}"`），
 *   不是对象。这里顺手把话题名抠出来 —— 有了它，`download.jidi()` 就**不需要为了一个标题
 *   再拉一次 834KB 的话题详情页**（那正是老链路慢的一半原因）。
 */
function gameOf(p) {
  let t = p && p.topic;
  if (typeof t === 'string') {
    try { t = JSON.parse(t); } catch { return null; }
  }
  const n = t && (t.topic || t.name);
  return n ? String(n).trim() || null : null;
}

/** 条目 → 展示用归一化结构 */
function shapePost(p, sec) {
  /* 上游 list 里混进 null / 无 id 的条目时返回 null，由调用方过滤 ——
     不在这里抛：一条脏数据不该让整批 100 条都取不回来。 */
  if (!p || p.id == null) return null;
  const gi = (p && p.game_info) || {};
  const member = p && p.member;
  const raw = String((p && p.content) || '');
  return {
    id: String(p.id),
    title: String(p.title || '').trim() || null,
    /** 所属游戏（见 gameOf：topic 是 JSON 字符串） */
    game: gameOf(p),
    author: (member && member.name) || null,
    /** 专区归属 —— UI 按它分区/上徽标 */
    section: sec.key,
    sectionName: sec.name,
    resourceType: sec.resourceType,
    /** 发布 / 更新（秒 → 毫秒） */
    ct: p.ct ? p.ct * 1000 : null,
    ut: p.ut ? p.ut * 1000 : null,
    dpv: Number(p.dpv) || 0,
    pv: Number(p.pv) || 0,
    favors: Number(p.favors) || 0,
    reviews: Number(p.reviews) || 0,
    tags: tagsOf(p),
    /** 「虚拟化版 / 解压即撸」这类玩法标记 + 版本串（源站就存在 game_info 里） */
    installation: String(gi.installation || '').trim() || null,
    version: String(gi.version_desc || '').trim() || null,
    links: extractLinks(raw, { max: 12 }),
    url: HOST_JIDI + '/post/detail/' + p.id,
    note: raw ? raw.replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX) : null,
    cover: coverOf(p),
  };
}

/**
 * 帖子缩略图。
 * ★ `imgs` 在**上游是 JSON 字符串**（不是数组）—— 实测 SSR/接口给的形态都是
 *   `"[{\"id\":995325,\"urls\":{\"540\":{\"urls\":[\"http://img2.52jidi.com/…\"]}}}]"`。
 *   直接 `Array.isArray(p.imgs)` 判会恒为假 ⇒ `cover` 永远 null 且不报错
 *   （本项目记过的那类「静默空值」）。这里两种形态都吃。
 */
function coverOf(p) {
  let imgs = p && p.imgs;
  if (typeof imgs === 'string') {
    try { imgs = JSON.parse(imgs); } catch { imgs = null; }
  }
  if (!Array.isArray(imgs) || !imgs.length) return null;
  const u = (imgs[0] && imgs[0].urls) || null;
  if (!u) return null;
  const pick = (k) => (u[k] && Array.isArray(u[k].urls) && u[k].urls[0]) || null;
  return pick('540') || pick('360')
    || (u.origin && Array.isArray(u.origin.urls) && u.origin.urls[0]) || null;
}

/**
 * 专区内的排序：**有标题的优先**，同级按本专区主排序键降序。
 * ★ 为什么不能只信服务端给的顺序：`sort=new` 会把 `resource_type=0` 的评论帖排上来
 *   （实测首条标题为空字符串），直接铺到界面上就是一行「没有名字的资源」。
 *   这里不删它们（信息完整），只是压到后面。
 */
function sortPosts(items, sort) {
  const key = sort === 'new' ? 'ct' : (sort === 'reply' ? 'reviews' : 'dpv');
  return items.slice().sort((a, b) => {
    const at = a.title ? 1 : 0;
    const bt = b.title ? 1 : 0;
    if (at !== bt) return bt - at;
    return (Number(b[key]) || 0) - (Number(a[key]) || 0);
  });
}

/* ============================================================
 *  ④ 三个专区一起取
 * ============================================================ */

/**
 * 取一个话题下**全部专区**的资源帖。
 *
 * @param {object} o
 * @param {string|number} o.tid
 * @param {string} [o.sort='hot']   hot | new | reply
 * @param {number} [o.perSection=50]  每专区最多取多少条（<=0 表示取满）
 * @param {Array}  [o.sections]       只取指定专区（测试用）
 * @param {boolean} [o.mergeNew=true] 未取满的专区补抓一页 `sort=new`（见 fetchSectionSmart）
 * @returns {Promise<{tid:number, sort:string, sections:Array, total:number, items:Array}>}
 */
async function topicPosts({ tid, sort = 'hot', perSection = 50, sections = SECTIONS, mergeNew = true } = {}) {
  const s = SORTS.includes(sort) ? sort : 'hot';
  const list = Array.isArray(sections) && sections.length ? sections : SECTIONS;

  /* ★ 三专区**并行**：实测各 300~540ms，串行要 1.2s+，并行 624ms。
     用 allSettled —— 某一个专区挂掉（或该专区被源站关权限）不该让整轮白跑，
     但**失败必须有痕迹**：该专区返回 `error` 而不是假装「这个专区没有资源」。 */
  const settled = await Promise.allSettled(
    list.map((sec) => fetchSectionSmart({
      tid,
      resourceType: sec.resourceType,
      sort: s,
      max: perSection > 0 ? perSection : 0,
      mergeNew,
    }))
  );

  const out = [];
  let total = 0;
  settled.forEach((r, i) => {
    const sec = list[i];
    if (r.status !== 'fulfilled') {
      out.push({
        key: sec.key, name: sec.name, resourceType: sec.resourceType,
        count: 0, returned: 0, pages: 0, error: String((r.reason && r.reason.message) || r.reason),
        merged: false, mergedAdded: 0, newError: null,
        items: [],
      });
      return;
    }
    const v = r.value;
    const items = sortPosts(v.list.map((p) => shapePost(p, sec)).filter((x) => x && x.id), s);
    total += v.count;
    out.push({
      key: sec.key,
      name: sec.name,
      resourceType: sec.resourceType,
      /** 服务端报的专区总条数 */
      count: v.count,
      /** 本次真正取回的条数（count > returned ⇒ UI 要提示「另有 N 条」） */
      returned: items.length,
      pages: v.pages,
      /** 是否补抓合并了 `sort=new` 那批（前端据此说明「最近发布」的数据来源） */
      merged: !!v.merged,
      mergedAdded: v.added || 0,
      newError: v.newError || null,
      /** 有网盘直链的条数 —— 下载场景真正能用的那部分 */
      withLinks: items.filter((x) => x.links.length).length,
      items,
    });
  });

  const flat = [];
  for (const g of out) flat.push(...g.items);

  return { tid: Number(tid), sort: s, sections: out, total, items: flat };
}

/** 只查「有没有资源 / 各专区多少条」（不拉正文）：给详情页做轻量预判用 */
async function countsOf(tid) {
  const settled = await Promise.allSettled(SECTIONS.map((sec) =>
    fetchSection({ tid, resourceType: sec.resourceType, sort: 'hot', limit: 1 })));
  const out = {};
  settled.forEach((r, i) => {
    out[SECTIONS[i].key] = r.status === 'fulfilled' ? r.value.count : null;
  });
  return out;
}

module.exports = {
  SECTIONS, C_TYPES, PAGE_LIMIT, SORTS, NOTE_MAX,
  fetchSection, fetchSectionAll, fetchSectionSmart,
  tagsOf, coverOf, gameOf, shapePost, sortPosts, topicPosts, countsOf,
};
