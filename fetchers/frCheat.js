/**
 * fetchers/frCheat.js — FearlessRevolution（fearlessrevolution.com）Cheat Table / Trainer 解析
 *
 * ── 为什么是这个源（v10.47 新增）────────────────────────────────────────────
 * 用户口径：「…这两个是他们原链可以直接获取 根据游戏名称进行匹配」。
 * 实测（2026-10-10）确认它给的是**真实附件链**且**免登录可下**：
 *   GET /download/file.php?id=77737
 *     → 206  content-type: application/octet-stream
 *            content-disposition: attachment; filename*=UTF-8''Xenonauts2.CT
 *     文件头 `<?xml version="1.0" encoding="utf-8"?>` = Cheat Engine 表（.CT）原文件
 *   ⇒ 点开即下载，不经过网盘、不需要注册。这正是用户要的「原链可以直接获取」。
 *
 * ── ⚠️ 与 GTrainers 的根本差异：**整站在 Cloudflare 挑战后面** ──────────────
 *   · 纯 HTTP：任何路径（含 /robots.txt、/sitemap.xml）都是 403 + `Cf-Mitigated: challenge`。
 *   · headless Chrome：24s 仍停在「请稍候…」（CF 对 headless 特征敏感）。
 *   · **有头 Chrome：约 20s 放行**（见 tools/browser.js 的 `headless:false` 选项）。
 *   · 过了挑战后把 cookie 搬到 node fetch **仍然 403** —— CF 还看 TLS/JA3 指纹。
 *   ⇒ 结论：**必须全程用同一个浏览器会话**。经验做法见 tools/fetch-fr.js：
 *     一次导航过挑战，之后全部用**页面上下文内的 fetch**（实测连续 4 页 200 且不再触发挑战，
 *     因为同源 XHR 带着已通过的 cf_clearance 与完整指纹）。
 *
 * ── 站点结构（phpBB3）──────────────────────────────────────────────────────
 *   板块列表  /viewforum.php?f=<f>&start=<N>    每页 50 帖
 *             f=4   Tables      （Cheat Engine 表，16,794 主题 / 336 页）
 *             f=5   Trainers
 *   主题页    /viewtopic.php?f=<f>&t=<id>
 *   附件链    /download/file.php?id=<n>          ← 免登录可下
 *   ★ 站内搜索**不可用**（phpBB 只提示 "SEARCH USING GOOGLE FOR BEST RESULTS"），
 *     所以按游戏名取数只能**遍历板块列表 → 用标题匹配**。
 */

const BASE = 'https://fearlessrevolution.com';

/** 要抓的板块。saves 在 FR **不存在**（实测首页板块列表里没有存档板）——
 *  这也正是用户说的「帮我分类补充」：存档来自 GTrainers，修改器来自 FR + GTrainers。 */
const FORUM = {
  4: { key: 'table', name: 'Tables（CE 表）' },
  5: { key: 'trainer', name: 'Trainers' },
};

/* ────────────────────────── 小工具 ────────────────────────── */

const unesc = (s) => String(s || '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/gi, "'")
  .replace(/&nbsp;/g, ' ').replace(/&raquo;/g, '»').replace(/&hellip;/g, '…')
  .trim();
const stripTags = (s) => unesc(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/** 绝对化（FR 的链接是 `./viewtopic.php?...` 形式） */
const abs = (u) => {
  if (!u) return '';
  if (/^https?:/i.test(u)) return u;
  return BASE + '/' + String(u).replace(/^\.\//, '').replace(/^\//, '');
};

/**
 * ★ 从 href 里取查询参数前**必须先还原 HTML 实体**。
 *   phpBB 输出的是 `./viewtopic.php?f=4&amp;t=25220&amp;sid=…`，
 *   直接对原文跑 `[?&]t=` 会匹配不到（`&` 后面跟的是 `amp;t` 而不是 `t`）——
 *   实测症状：`f` 抓得到、`t` 恒为空串，于是主题 id 全丢。
 */
const deamp = (u) => String(u || '').replace(/&amp;/g, '&').replace(/&#0?38;/g, '&');
const qsParam = (u, k) => {
  const m = deamp(u).match(new RegExp('[?&]' + k + '=(\\d+)'));
  return m ? m[1] : '';
};

/* ────────────────────────── ① 板块列表 ────────────────────────── */

/**
 * 解析板块列表页 → 主题数组。
 * phpBB3 的主题链接是 `<a href="./viewtopic.php?f=4&amp;t=25220&amp;sid=…" class="topictitle">标题</a>`。
 * ⚠️ 同一页里 `viewtopic.php` 链接会出现**多次**（标题、跳转最后一帖、页码），
 *    所以只认带 `class="topictitle"` 的那个（不带这个类会把「最后一帖」的日期当成标题）。
 */
function parseForumList(html) {
  const out = [], seen = new Set();
  const re = /<a\b[^>]*class="[^"]*topictitle[^"]*"[^>]*>[\s\S]*?<\/a>/g;
  for (const m of String(html).matchAll(re)) {
    const tag = m[0];
    const href = (tag.match(/href="([^"]+)"/) || [])[1] || '';
    if (!/[?&](?:amp;)?t=\d+/.test(deamp(href))) continue;
    const t = qsParam(href, 't');
    const f = qsParam(href, 'f');
    if (!t || seen.has(t)) continue;
    const title = stripTags(tag.replace(/^<a\b[^>]*>/, '').replace(/<\/a>$/, ''));
    if (!title) continue;
    seen.add(t);
    out.push({ t, f: f || '', title, url: abs(deamp(href)) });
  }
  return out;
}

/** 页面里出现过的最大 start 值（phpBB 分页 `&amp;start=N`），用来判「翻到第几页为止」 */
function maxStartIn(html) {
  const nums = [...String(html).matchAll(/[?&](?:amp;)?start=(\d+)/g)].map((m) => parseInt(m[1], 10));
  return nums.length ? Math.max(...nums) : 0;
}

/** 主题总数：phpBB 在页顶写「16794 topics」。抓不到返回 0（由调用方决定要不要当异常）。 */
function topicTotalIn(html) {
  const m = String(html).match(/([\d,]+)\s+topics?\b/i) || String(html).match(/([\d,]{3,})\s*主题/);
  return m ? parseInt(m[1].replace(/,/g, ''), 10) || 0 : 0;
}

/* ────────────────────────── ② 主题页 ────────────────────────── */

/**
 * 解析主题页 → { title, f, t, attachments[] }
 * 附件块（phpBB3 inline-attachment）：
 *   <div class="inline-attachment"><dl class="file">
 *     <dt>… <a class="postlink" href="./download/file.php?id=77737&amp;sid=…">Xenonauts2.CT</a></dt>
 *     <dd><em>v7.18.3</em></dd>
 *     <dd>(142.16 KiB) Downloaded 476 times</dd>
 *   </dl></div>
 */
function parseTopic(html) {
  const h = String(html);
  const titleM = h.match(/<h2 class="topic-title">[\s\S]{0,400}?<a[^>]*>([\s\S]*?)<\/a>/);
  const hrefM = h.match(/<h2 class="topic-title">[\s\S]{0,400}?<a[^>]*href="([^"]+)"/);
  const href = hrefM ? hrefM[1] : '';
  const atts = [];
  for (const m of h.matchAll(/<dl class="file">([\s\S]*?)<\/dl>/g)) {
    const blk = m[1];
    const idM = blk.match(/download\/file\.php\?id=(\d+)/);
    if (!idM) continue;
    const nmM = blk.match(/<a class="postlink"[^>]*>([\s\S]*?)<\/a>/);
    const verM = blk.match(/<dd>\s*<em>([\s\S]*?)<\/em>\s*<\/dd>/);
    const metaM = blk.match(/\(([\d.]+\s*[KMGT]?i?B)\)\s*Downloaded\s*([\d,]+)\s*times/i);
    atts.push({
      id: idM[1],
      name: nmM ? stripTags(nmM[1]) : '',
      version: verM ? stripTags(verM[1]) : '',
      size: metaM ? metaM[1] : '',
      downloads: metaM ? parseInt(metaM[2].replace(/,/g, ''), 10) || 0 : 0,
      /* ★ 用**不带 sid** 的干净形式落盘：sid 是本会话的，换个人点会失效；
       *   FR 的附件本身免登录可下，去掉 sid 后链接依然有效。 */
      url: `${BASE}/download/file.php?id=${idM[1]}`,
    });
  }
  return {
    title: titleM ? stripTags(titleM[1]) : '',
    f: qsParam(href, 'f'),
    t: qsParam(href, 't'),
    attachments: atts,
  };
}

/* ────────────────────────── ③ 游戏名 ────────────────────────── */

/**
 * 从主题标题里抽游戏名候选。
 *
 * 实测的标题形态（FR 是用户发帖，格式比 GTrainers 野）：
 *   `z Xenonauts 2`                       ← 作者加了单字母前缀（Zanzer 的习惯）
 *   `Dragon's Dogma 2`                    ← 干净的
 *   `Clive Barker's Hellraiser: Revival (Demo)`
 *   `ELDEN RING v1.12 +22 TRAINER`        ← 带版本 + 数量
 *   `Game Name (v1.0) [Steam]`
 * ⇒ 依次剥：前导单字母 / 尾部括号块 / 尾部版本号 / TRAINER|Cheat Table 之类词。
 */
function gameCandidates(title) {
  let t = stripTags(title);
  if (!t) return [];
  const out = [];
  const push = (x) => { x = String(x || '').trim().replace(/\s+/g, ' '); if (x.length >= 2 && !out.includes(x)) out.push(x); };

  /* ① 原样先入（有些标题就是纯游戏名） */
  push(t);
  /* ② 剥前导单字母标记：`z Xenonauts 2` → `Xenonauts 2`
   *    ⚠️ 只在「单字母 + 空格 + 后面还有内容」时剥，避免把 `F.E.A.R.` 这类切坏。 */
  let a = t.replace(/^[A-Za-z]\s+(?=\S)/, '').trim();
  push(a);
  /* ③ 去掉尾部括号/方括号块（(Demo)/(v1.0)/[Steam]），可叠多块 */
  let b = a.replace(/\s*[([][^()[\]]{0,40}[)\]]\s*$/g, '').trim();
  b = b.replace(/\s*[([][^()[\]]{0,40}[)\]]\s*$/g, '').trim();
  push(b);
  /* ④ 砍掉尾部的类型/版本尾巴：`… +22 TRAINER` / `… v1.12` / `… Cheat Table` */
  const c = b.replace(/\s*[-–—|:+]?\s*(?:\+\d+\s*)?(?:TRAINER|Trainer|Cheat\s*Table|Cheat\s*Engine|CT|Table|Editor|Mod|Cheats?)\b[\s\S]*$/i, '').trim();
  push(c);
  const d = c.replace(/\s+v?\d+(?:[.\d]+)?\s*$/i, '').trim();
  push(d);
  return out;
}

module.exports = {
  BASE, FORUM,
  parseForumList, parseTopic, maxStartIn, topicTotalIn, gameCandidates,
  unesc, stripTags, abs,
};
