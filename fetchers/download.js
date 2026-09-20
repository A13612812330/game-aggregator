/**
 * fetchers/download.js — 「这游戏去哪下」：统一下载链接取数（v10.22 新增）
 *
 * 需求：详情页原来的「跳转到源站」不够用 —— 用户要的是**直接给下载地址**。
 *
 * ─────────────────────────────────────────────────────────────
 * ① XD（xdgame.com / xdgamer.com）
 *    详情页 HTML 里就有下载区，每条是一个 `<a class="downbtn" data-url data-server>`：
 *        <div class="article-down">
 *          <ul>
 *            <li><a class="downbtn normal"
 *                   data-url="/plus/download.php?open=2&id=15990&uhash=c644a97c7e02e0afae7a6082"
 *                   data-server="百度网盘">…</a></li>
 *            …
 *     `data-url` 指向 `download.php`，**请求它会 302 跳到真实网盘地址**：
 *        302 → https://pan.baidu.com/s/1NLiiYPEniypv1Olsnj_wFA?pwd=b4s5
 *     实测 6 个盘口（百度/天翼/迅雷/夸克/移动/正版购买）全部能解出来，且**不需要 Referer**。
 *
 *     ★ 坑：`Location` 头里的非 ASCII 是 **UTF-8 字节被按 latin1 解码**的乱码：
 *          `（访问码：2o8s）` → `ï¼è®¿é®ç ï¼2o8sï¼`
 *       必须重新按 latin1→utf8 还原，否则链接里的中文提示会碎掉。
 *       还原判据要**双向**：出现 latin1 高位字符才尝试；重解码若产出替换字符 `\uFFFD`
 *       就说明原本就是合法文本，退回原值（避免把正常带重音符号的 URL 弄坏）。
 *
 * ② 机地（jidiyouxi.com）
 *    ★ v10.26 起**优先走列表接口**（`/api/misc/post_list`，见 fetchers/jidiPosts.js）：
 *      机地的话题页把资源分成「本体 / mod / 修改器」三个专区，各自的条数实时可取。
 *      实测（剑星 tid=171085167）：本体 22 / mod 190 / 修改器 4 = **216 条**。
 *      靠返回里的 `resource_type`（1/2/3）分区，`folder_id` 是死参数（服务端不看，见 jidiPosts）。
 *
 *    兜底（接口挂了/改版）才退回老路：解析话题详情页 SSR 的
 *      `topic.ssrData.postsMap` / `postList`，取帖子正文里的网盘直链。
 *      那条路有**结构性上限**：SSR 只嵌首屏 **10 条**、且几乎只有本体 ——
 *      实测同款游戏 SSR 10 条 vs 接口 33 条，且 mod/修改器一条都取不到。
 *      所以它只能当兜底，报文里用 `engine` 如实标出这次是走哪条路（api / ssr）。
 *
 * ★ 设计取舍：
 *   · 只返回「能直接点开的链接」，不返回「需要再点两下的中间页」。
 *   · 排序按帖子热度（dpv）降序 —— 用户点开就想拿到最靠谱的那份。
 *   · 全部结果**带来源标注**（`from`），前端要能说清「这条是 XD 的、那条是机地的」。
 */
const cheerio = require('cheerio');
const { UA } = require('../shared');
const jt = require('./jidiTopics');
const jp = require('./jidiPosts');

const XD_HOSTS = {
  xdgamer: 'https://www.xdgamer.com',
  xdgame: 'https://www.xdgame.com',
};

/**
 * 把「主机名的各种写法」归一到 XD_HOSTS 的键。
 *
 * ★ 必须归一，否则是**静默错源**：server.js 的 parseDetailUrl() 返回的是
 *   `hostname`（`xdgame.com`），而这里的键是短名（`xdgame`）——
 *   `XD_HOSTS['xdgame.com']` 为 undefined，落到兜底 `XD_HOSTS.xdgamer`，
 *   于是「拿 xdgame 的链接去 xdgamer 站上找」，实测返回 404
 *   （xdgamer.com 与 xdgame.com 是两套内容独立的平行站）。
 *   报错只有一句 `XD 详情页 HTTP 404`，完全看不出是「键没归一」。
 *
 * 接受：`xdgame` / `xdgame.com` / `www.xdgame.com` / `https://www.xdgame.com/` …
 * 认不出的一律返回 null，由调用方决定兜底，**不在这里瞎猜**。
 */
function normHost(h) {
  const s = String(h == null ? '' : h).trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/^\/\//, '')
    /* ★ 先砍路径再砍 `.com`：顺序反了的话 `www.xdgame.com/game/1.html` 不满足 `/\.com$/`
       （它结尾是 .html），于是整个串留着 → 认不出 → 又静默兜底到 xdgamer。
       凡「先剥后缀再剥路径」的链式清洗，都要问一句：中间态还能不能匹配上后续规则。 */
    .replace(/[\/?#].*$/, '')
    .replace(/^www\./, '')
    .replace(/\.com$/, '');
  return Object.prototype.hasOwnProperty.call(XD_HOSTS, s) ? s : null;
}

/* ============================================================
 *  小工具
 * ============================================================ */

/**
 * 修 `Location` 头的 latin1↔utf8 乱码。
 * ★ 只在「原字符串确实含 latin1 高位字符」时才尝试；
 *   重解码若出现 `\uFFFD` 说明原串本来就是合法文本 → 退回原值。
 *   两步判据缺一不可：只判第一步会把正常 URL 弄坏，只判第二步则救不了乱码。
 */
function fixMojibake(s) {
  const str = String(s == null ? '' : s);
  /* ★ 触发判据必须覆盖 **C1 控制区**（U+0080–U+009F）——
     实测 `（访问码：2o8s）` 的 UTF-8 首三字节 EF BC 88 被按 latin1 读成
     U+00EF / U+00BC / **U+0088**，而 U+0088 是 C1 控制符，
     只判 `[\u00c0-\u00ff]` 会漏掉它一类；而 C1 字符在任何合法 URL 里都不该出现。 */
  if (!/[\u0080-\u00ff]/.test(str)) return str;
  const out = Buffer.from(str, 'latin1').toString('utf8');
  return out.includes('\uFFFD') ? str : out;
}

/** 网盘里的「访问码 / 提取码」常被塞在链接尾部的中文括号里 —— 拆出来，别污染 URL */
function splitPwd(u) {
  const s = String(u || '').trim();
  const m = s.match(/^([^\u4e00-\u9fa5]+?)[（(]([^）)]*[）)]?)$/);
  if (!m) return { url: s, pwd: null };
  const tail = m[2].replace(/[）)]$/, '');
  return { url: m[1].trim(), pwd: tail || null };
}

/** 网盘识别（与 jidiTopics.NETDISK 同口径） */
function serverOf(u) {
  const hit = jt.NETDISK.find(([re]) => re.test(String(u)));
  return hit ? hit[1] : '其他链接';
}

/* ============================================================
 *  ① XD
 * ============================================================ */

/** 从 XD 详情页 HTML 解析下载列表（纯函数，便于离线测试） */
function parseXdDown(html, host) {
  const base = host || XD_HOSTS.xdgame;
  const $ = cheerio.load(String(html || ''));
  const out = [];

  $('.article-down a.downbtn').each((_i, el) => {
    const $a = $(el);
    let raw = String($a.attr('data-url') || '').replace(/&amp;/g, '&').trim();
    if (!raw) return;
    const server = String($a.attr('data-server') || '').trim() || null;
    const abs = /^https?:/i.test(raw) ? raw : base + (raw.startsWith('/') ? raw : '/' + raw);
    out.push({ server, serverUrl: abs, name: server, real: null, pwd: null, kind: 'downbtn' });
  });

  /* 页面标题与版本串（用户要的「完整的标题」） */
  const pickText = (...c) => {
    for (const x of c) {
      const t = String(x == null ? '' : x).replace(/\s+/g, ' ').trim();
      if (t) return t;
    }
    return null;
  };
  const h1 = $('.article-tit h1').first().clone();
  h1.find('small, .tit-badge, .badge, em').remove();
  const title = pickText(
    $('.article-tit .article-title-text').first().text(),
    h1.text(),
    $('h1').first().text(),
  );
  const body = $('body').text();
  /* 版本串在正文里是这样一排：
       <h4>版本介绍</h4><p>Build.25183906|容量1.6GB|官方简体中文|支持键盘.鼠标</p>
     ★ 早先用 `版本[：:]` 去 body 文本里找 —— **找不到**（原文里没有「版本：」这三个字），
       拿到的是 null。要按「小标题 版本介绍 + 紧跟的 p」定位。
     兜底：页面结构改名时，退到全文里找 `Build.<数字>|…` 那一串。 */
  const vm = String(html || '').match(/<h4[^>]*>\s*版本介绍\s*<\/h4>\s*<p[^>]*>([\s\S]{2,400}?)<\/p>/i);
  const fb = body.match(/Build\.\d+[|\u4e00-\u9fa5][^\n]{0,200}/);
  const version = vm ? vm[1].replace(/\s+/g, ' ').trim() : (fb ? fb[0].replace(/\s+/g, ' ').trim() : null);
  return { title, version, items: out };
}

/**
 * 把 download.php 的 302 解成真实网盘地址（不跟随，避免被跳到网盘页面把响应体拉下来）
 *
 * ★ 实测还有第二种返回：**HTTP 200 + 一个「你没有权限下载：<游戏名>！」页面**。
 *   XD 对部分游戏（实测 `钢铁雄心4`/id=3967 的 10 个盘口全部如此）要求登录/权限，
 *   此时既没有 `Location` 也没有跳转脚本。这不是抓取失败，是**源站的权限策略**。
 *   必须把它与「网络抖动」区分开并把原因带回前端 —— 否则界面上就是
 *   一列沉默的「不可用」，用户完全不知道为什么。
 */
const NEED_AUTH_RE = /你没有权限下载|无权限|没有权限|请先登录|登录后(?:才)?可/;

/**
 * 整组判定：是否「因为权限而全军覆没」。
 * ★ 抽成纯函数是为了能**离线**验这条分支 —— 线上验它需要恰好挑到一款被锁的游戏，
 *   数据一变就验不到了；而这条分支恰恰是「用户看到 0 条链接」时唯一的解释来源。
 * 三个条件缺一不可：
 *   · 有条目（0 个条目的空列表不是「权限问题」，是没解析出盘口）
 *   · 全都没有 real（只要有一条解得出来，就不该弹权限说明）
 *   · 至少一条明确报 needAuth（全是网络超时的话应引导「稍后重试」，不是「去登录」）
 */
function needAuthOf(items) {
  const list = Array.isArray(items) ? items : [];
  return list.length > 0 && list.every((x) => !x.real) && list.some((x) => x.needAuth);
}

async function resolveXdOne(serverUrl) {
  const r = await fetch(serverUrl, {
    method: 'GET',
    headers: { 'User-Agent': UA, Referer: 'https://www.xdgame.com/' },
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
  });
  let loc = r.headers.get('location');
  if (!loc && r.status >= 200 && r.status < 300) {
    /* 少数盘口不回 302 而是直接吐一个跳转页 —— 从 HTML 里捞 meta refresh / location.href */
    const t = await r.text().catch(() => '');
    const m = t.match(/(?:location\.(?:href|replace)\s*=\s*|URL=)['"]?([^'"\s>]+)/i)
      || t.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["']?\s*\d+\s*;\s*url=([^"'>\s]+)/i);
    if (m) loc = m[1];
    else if (NEED_AUTH_RE.test(t)) return { ok: false, status: r.status, needAuth: true };
  }
  if (!loc) return { ok: false, status: r.status };
  const fixed = fixMojibake(loc);
  const { url, pwd } = splitPwd(fixed);
  return { ok: true, status: r.status, url, pwd, server: serverOf(url) };
}

/**
 * 取 XD 的下载列表。
 * @param {string|number} id
 * @param {object} [o] {host:'xdgamer'|'xdgame', resolve:boolean}
 */
async function xd(id, { host = 'xdgamer', resolve = true } = {}) {
  /* ★ 先归一：调用方可能传 `xdgame.com`（parseDetailUrl 给的 hostname）
     也可能传 `xdgame`（脚本里手写的短名）。不归一会静默打到另一个站。 */
  const key = normHost(host) || 'xdgamer';
  const base = XD_HOSTS[key];
  const url = base + '/game/' + id + '.html';
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw new Error('XD 详情页 HTTP ' + r.status);
  const parsed = parseXdDown(await r.text(), base);

  if (resolve && parsed.items.length) {
    /* 并行解析全部盘口；单个失败不影响其余（allSettled） */
    const res = await Promise.allSettled(parsed.items.map((it) => resolveXdOne(it.serverUrl)));
    res.forEach((x, i) => {
      if (x.status !== 'fulfilled' || !x.value.ok) {
        /* ★ 「源站要权限」与「解析失败」必须分开：前者是策略，重试也没用；
           后端带 needAuth 回前端，界面才能说清原因，而不是甩一列沉默的「不可用」。 */
        if (x.status === 'fulfilled' && x.value.needAuth) {
          parsed.items[i].error = '源站要求登录 / 权限';
          parsed.items[i].needAuth = true;
        } else {
          parsed.items[i].error = x.status === 'fulfilled' ? ('HTTP ' + x.value.status) : String(x.reason && x.reason.message);
        }
        return;
      }
      parsed.items[i].real = x.value.url;
      parsed.items[i].pwd = x.value.pwd;
      if (x.value.server && x.value.server !== '其他链接') parsed.items[i].server = x.value.server;
    });
  }

  return {
    source: 'xdgamer',
    id: String(id),
    title: parsed.title,
    version: parsed.version,
    url,
    from: key,
    /* 全部盘口都因为权限拿不到 → 前端据此给出「去源站登录后获取」而不是一列死链接 */
    needAuth: needAuthOf(parsed.items),
    items: parsed.items,
  };
}

/* ============================================================
 *  ② 机地
 * ============================================================ */

/** 把「接口 / SSR」两种形态统一成扁平条目 —— 前端只认这一份字段 */
function flatFrom(sections) {
  const items = [];
  for (const g of sections) {
    for (const p of (g.items || [])) {
      for (const l of (p.links || [])) {
        items.push({
          server: l.kind,
          real: l.url,
          pwd: splitPwd(l.url).pwd,
          postTitle: p.title,
          postId: p.id,
          postUrl: p.url,
          author: p.author,
          tags: p.tags,
          dpv: p.dpv,
          /* ★ v10.27：发布时间（毫秒）。此前只透传了 `ut`（更新时间）→ 前端**无法按时间排**
             （实测 items 里 ct 覆盖 0/210）。弹窗的「最近发布」排序就靠它。 */
          ct: p.ct || null,
          ut: p.ut,
          note: p.note,
          kind: 'post',
          /* ★ v10.26：专区归属（本体 / mod / 修改器）—— 前端据此分区展示 */
          section: g.key,
          sectionName: g.name,
          cover: p.cover,
        });
      }
    }
  }
  return items;
}

/**
 * 取机地某话题的资源。
 *
 * ★ v10.26 起走 `jidiPosts`（三专区接口），**失败才退 SSR**。
 *   为什么要保底：接口依赖 websign 签名 + env（服务端校验 h_did），
 *   任一环被源站调整都会整条链失效；而 SSR 那条只依赖页面结构，两者坏法不同。
 *   `engine` 字段如实告知这次走的哪条路，**不要静默降级** ——
 *   否则下次出问题会以为一直在用接口。
 *
 * @param {string|number} tid
 * @param {object} [o]
 * @param {string} [o.sort='hot']         hot | new | reply
 * @param {number} [o.perSection=50]      每个专区最多取多少条
 */
async function jidi(tid, { sort = 'hot', perSection = 50 } = {}) {
  try {
    const r = await jp.topicPosts({ tid, sort, perSection });
    const groups = r.sections.map((g) => ({
      key: g.key,
      name: g.name,
      /** 源站报的专区总数（可能大于本次取回） */
      count: g.count,
      returned: g.returned,
      withLinks: g.withLinks,
      /* ★ v10.27：该专区是否补抓并合并了 `sort=new` 那批（弹窗说明「最近发布」的数据来源用） */
      merged: !!g.merged,
      mergedAdded: g.mergedAdded || 0,
      /** 本次真正能拼出的网盘链接条数 */
      links: (g.items || []).reduce((n, p) => n + (p.links || []).length, 0),
      error: g.error || null,
    }));
    const items = flatFrom(r.sections);
    /* 任意一条帖子都能给出话题名（topic 是 JSON 字符串，jidiPosts.gameOf 已解析） */
    const first = r.items[0] || null;
    return {
      source: 'jidi',
      id: String(tid),
      title: (first && first.game) || null,
      subtitle: null,
      url: 'https://jidiyouxi.com/topic/detail/' + tid,
      from: 'jidi',
      engine: 'api',
      /** 帖子总数（不是链接数）—— 与老字段同名同义 */
      posts: r.items.length,
      /** ★ 专区汇总：UI 用它出「本体 N / mod N / 修改器 N」 */
      sections: groups,
      items,
    };
  } catch (e) {
    /* 兜底：解析话题详情页 SSR（只覆盖首屏 ~10 条，且几乎只有本体） */
    const d = await jt.postsOf(tid);
    const sections = [{
      key: 'body', name: '本体', count: d.posts.length, returned: d.posts.length,
      withLinks: d.posts.length,
      /* SSR 这条只解析首屏、不按专区、也没有 hot/new 两套 —— 如实标 false，别让前端以为有 */
      merged: false, mergedAdded: 0,
      links: d.posts.reduce((n, p) => n + (p.links || []).length, 0),
      error: '接口不可用，已退回 SSR 首屏',
    }];
    const items = flatFrom([{ key: 'body', name: '本体', items: d.posts }]);
    return {
      source: 'jidi',
      id: String(tid),
      title: d.title,
      subtitle: d.subtitle,
      url: 'https://jidiyouxi.com/topic/detail/' + tid,
      from: 'jidi',
      engine: 'ssr',
      fallbackReason: String((e && e.message) || e),
      posts: d.posts.length,
      sections,
      items,
    };
  }
}

/* ============================================================
 *  ③ 统一入口
 * ============================================================ */

/**
 * @param {object} o
 * @param {'jidi'|'xdgamer'} o.source
 * @param {string|number}  o.id
 * @param {string} [o.host]  仅 XD：'xdgamer' | 'xdgame'
 * @param {boolean} [o.resolve=true]  是否解出真实网盘地址
 */
async function resolve({ source, id, host, resolve: doResolve = true }) {
  if (source === 'jidi') return jidi(id);
  if (source === 'xdgamer') return xd(id, { host: host || 'xdgamer', resolve: doResolve });
  throw new Error('不支持的来源: ' + source);
}

module.exports = {
  XD_HOSTS, normHost,
  NEED_AUTH_RE, needAuthOf,
  fixMojibake, splitPwd, serverOf, parseXdDown, resolveXdOne,
  xd, jidi, resolve,
};
