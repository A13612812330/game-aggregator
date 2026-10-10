/**
 * fetchers/gtrainers.js — GTrainers（gtrainers.com）存档 / 修改器 抓取与解析
 *
 * ── 为什么是这个源（v10.47 新增）────────────────────────────────────────────
 * 用户口径：「存档：https://gtrainers.com/，https://fearlessrevolution.com/，
 *   我看了下未有下载链接原因是未获取到真实下载链，这两个是他们原链可以直接获取
 *   根据游戏名称进行匹配」。
 * 实测确认（2026-10-10）：
 *   · 纯 HTTP 可直连，无需登录、无需浏览器（与 fearlessrevolution 正相反）。
 *   · 详情页的 DOWNLOAD 按钮给出 `/load/0-0-1-<id>-<fileid>` —— **301 直达真实文件**：
 *       GET /load/0-0-1-15857-20
 *         → 301  Location: https://gtrainers.com/saves2026/w/witcher3/gamesaves.rar
 *         → 200  application/x-rar-compressed  1,503,817 B
 *     ⇒ 这正是用户要的「真实下载链」：免登录、免网盘、免客户端。
 *
 * ── 站点结构（uCoz / DLE `load` 模块）──────────────────────────────────────
 *   分类页   /load/categories/{savegames|trainers}/<catid>-<page>-1   ← ★ 注意顺序
 *            （savegames=30 → 206 页；trainers=28 → 306 页；每页 30 条）
 *            ⚠️ `<catid>-1-<page>` 是**错的**：p≥50 后回吐同一页且 HTTP 200，
 *               会静默只剩几百条。详见下面 listUrl() 的注释。
 *   详情页   /load/categories/<cat>/<slug>/<catid>-1-0-<id>
 *   下载链   /load/0-0-1-<id>-<fileid>  （301 → 真实直链）
 *   搜索     POST /load/  body: a=2&query=<游戏名>   （实测 "witcher" → 40 条）
 *
 * ── 关键字段 ──────────────────────────────────────────────────────────────
 *   详情页有 **`Game:` 一栏**，值是游戏名并带 `/search/<游戏名>/` 链接 ——
 *   这是**权威游戏名**（标题里的名字是运营写的，会带 "SaveGame 100%" 这类后缀）。
 *   ⇒ 匹配一律以详情页的 `Game:` 为准；列表阶段的标题只用于**粗筛**（决定要不要抓详情）。
 *
 * ⚠️ 已知边界（实测，不藏着）：
 *   · 站内 `/search/<名>/` 链接是**导航用**，不是抓取口；按名批量取数走 POST /load/。
 *   · 列表页日期有相对值（"Yesterday"），不是所有条目都有绝对日期 —— 落盘时原样保留。
 *   · `DOWNLOAD` 按钮旁有 `data-hash`（sha256）与 `data-virustotal`，一并落盘供前端展示。
 */

const BASE = 'https://gtrainers.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/** 分类 → DLE 的 catid。saves=30 / trainers=28（见站点导航 href） */
const CAT = { saves: { id: 30, seg: 'savegames', name: '存档' }, trainers: { id: 28, seg: 'trainers', name: '修改器' } };
/** 每页 30 条（实测：分类页 `#entryID` 区块数恒为 30） */
const PER_PAGE = 30;

/** 分类页 URL。page 从 1 起。
 *
 * ★ 分页形式是 **`<catid>-<page>-1`**，不是我第一轮写的 `<catid>-1-<page>`。
 *   踩过的坑（实测记录，别再猜）：`30-1-<p>` 只在 p=1/2/3/5 时给出**互不相同**的内容，
 *   p≥50 之后一律**回吐同一页**且 HTTP 仍是 200 ⇒ 全量抓下来只有 527 条（预期 ~15,300），
 *   而失败计数是 0 —— 典型的「静默少数据」。权威来源是页面自己的分页区块：
 *     `<a class="swchItem" href="/load/categories/savegames/30-2-1">2</a>`
 *     `<a … href="/load/categories/savegames/30-206-1">206</a>`
 *   `spages()` 的实现是 `location.assign(link.href)` ⇒ 直接 GET 这个 href 就是对的。
 *   实测校验：`30-2-1` 与 `30-1-1` 的 `#entryID` 集合**完全不同**（这才是真翻页）。
 */
const listUrl = (cat, page) => `${BASE}/load/categories/${CAT[cat].seg}/${CAT[cat].id}-${page}-1`;

/* ────────────────────────── HTTP ────────────────────────── */

/** 取文本。不显式设 Accept-Encoding，让服务端按不压缩返回，省掉解 gzip 的分支。 */
async function getText(url, { referer = BASE + '/', timeout = 25000 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, Referer: referer, Accept: 'text/html,*/*' },
      signal: ac.signal, redirect: 'follow',
    });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
    return await r.text();
  } finally { clearTimeout(t); }
}

/** 解析真实直链：请求下载口，**不允许自动跟随**，从 301 的 Location 里拿真实文件地址。 */
async function resolveDownload(dlPath, { timeout = 25000 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await fetch(BASE + dlPath, {
      headers: { 'User-Agent': UA, Referer: BASE + '/', Accept: '*/*' },
      signal: ac.signal, redirect: 'manual',
    });
    /* 301/302 才带 Location；个别情况会直接 200 吐文件（此时没有更短的地址）。 */
    const loc = r.headers.get('location') || '';
    const status = r.status;
    /* 必须把 body 丢掉，否则大文件会挂在连接上 */
    try { if (r.body && r.body.cancel) await r.body.cancel(); } catch (e) { /* 已结束 */ }
    if (loc) return { url: loc.startsWith('http') ? loc : BASE + loc, status, direct: true };
    return { url: BASE + dlPath, status, direct: false };
  } finally { clearTimeout(t); }
}

/* ────────────────────────── 小工具 ────────────────────────── */

const unesc = (s) => String(s || '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/gi, "'")
  .replace(/&nbsp;/g, ' ').replace(/&raquo;/g, '»').replace(/&laquo;/g, '«')
  .replace(/&hellip;/g, '…').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
  .replace(/&(?:ldquo|rdquo);/g, '"').replace(/&(?:lsquo|rsquo);/g, "'")
  .trim();
/** 压掉标签与多余空白 */
const stripTags = (s) => unesc(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/** 列表页里出现的最大页码（`spages('206', …)`）。用来判「抓到第几页为止」。 */
function maxPageIn(html) {
  const nums = [...String(html).matchAll(/spages\('(\d+)'/g)].map((m) => parseInt(m[1], 10)).filter((n) => n > 0);
  return nums.length ? Math.max(...nums) : 1;
}

/* ────────────────────────── ① 列表 ────────────────────────── */

/**
 * 解析分类页 → 条目数组。
 * 只认 `#entryID<n>` 区块（侧边栏的「最近更新」也是 /load/ 链接，不认区块会把它们混进来，
 * 实测不筛区块时 35 条里混进 5 条侧边栏项）。
 */
function parseList(html, cat) {
  const seg = CAT[cat].seg, cid = CAT[cat].id;
  const out = [];
  const re = new RegExp(`<div id="entryID(\\d+)">([\\s\\S]*?)(?=<div id="entryID|$|</div>\\s*<div class="clr)`, 'g');
  for (const m of String(html).matchAll(re)) {
    const id = m[1], blk = m[2];
    const a = blk.match(new RegExp(`<a href="/load/categories/${seg}/([a-z0-9_]+)/${cid}-1-0-${id}"[^>]*>([\\s\\S]*?)</a>`));
    if (!a) continue;
    const tds = [...blk.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((x) => stripTags(x[1]));
    /* td 顺序：[标题链, 日期, 大小, 计数] —— 标题链本身也含 <td>，所以取「非空且不像日期/大小的尾部」 */
    const tail = tds.slice(-3);
    out.push({
      id, cat,
      slug: a[1],
      url: `${BASE}/load/categories/${seg}/${a[1]}/${cid}-1-0-${id}`,
      title: stripTags(a[2]),
      date: tail[0] || '',
      size: tail[1] || '',
      count: tail[2] || '',
    });
  }
  return out;
}

/* ────────────────────────── ② 详情 ────────────────────────── */

/**
 * 解析详情页。
 * `Game:` 一栏是**权威游戏名**（`<span class="type">Game:</span><p class="text"><noindex><a …>名字</a>`）。
 * 下载口是 `class="feat-mr"` 的那个 `/load/0-0-1-<id>-<fileid>`。
 */
function parseDetail(html, id) {
  const h = String(html);
  const gameM = h.match(/<span class="type">Game:<\/span>\s*<p class="text">[\s\S]{0,200}?<a[^>]*>([\s\S]*?)<\/a>/);
  const game = gameM ? stripTags(gameM[1]) : '';
  /* ★ 详情页**没有** `Size:` 行（实测只有 Game/Posted/Views/Downloads/Our rating）——
   *   大小挂在下载按钮的文本里：`> DOWNLOAD (1.43 Mb)</a>`。 */
  const sizeM = h.match(/class="feat-mr"[^>]*>\s*DOWNLOAD\s*\(([^)]*)\)/i);
  const dateM = h.match(/<span class="type">Posted:<\/span>\s*<p class="text">([\s\S]*?)<\/p>/);
  const viewsM = h.match(/<span class="type">Views:<\/span>\s*<p class="text">([\s\S]*?)<\/p>/);
  const dlM = h.match(/<span class="type">Downloads:<\/span>\s*<p class="text">([\s\S]*?)<\/p>/);
  const btn = h.match(/<a href="(\/load\/0-0-1-[0-9]+-[0-9]+)"[^>]*class="feat-mr"[^>]*>/)
    || h.match(/<a href="(\/load\/0-0-1-[0-9]+-[0-9]+)"[^>]*>/);
  const hash = h.match(/data-hash="([a-f0-9]{32,})"/);
  const vt = h.match(/data-virustotal="([^"]+)"/);
  const titleM = h.match(/<title>([^<]*)<\/title>/);
  return {
    id,
    game,
    /* ★ 详情页的 `<h1>` 是 uCoz 通用壳里的站点 logo（文字恒为 "Home"），**不能当标题**。
     *   站点**没有 og:title**（实测），所以标题只认 `<title>` 标签：
     *   `The Witcher 3: Wild Hunt Remastered - SaveGame 100%`。
     *   ⚠️ 落盘时前端展示的标题仍用**列表页**那份（它是条目标题），这里只做校验与兜底。 */
    title: titleM ? unesc(titleM[1]) : '',
    date: dateM ? stripTags(dateM[1]) : '',
    size: sizeM ? stripTags(sizeM[1]) : '',
    views: viewsM ? parseInt(stripTags(viewsM[1]).replace(/[^\d]/g, ''), 10) || 0 : 0,
    downloads: dlM ? parseInt(stripTags(dlM[1]).replace(/[^\d]/g, ''), 10) || 0 : 0,
    dlPath: btn ? btn[1] : '',
    hash: hash ? hash[1] : '',
    virustotal: vt ? unesc(vt[1]) : '',
  };
}

/* ────────────────────────── ③ 搜索 ────────────────────────── */

/**
 * 站内按名搜索：`POST /load/` + `a=2&query=<名>`。
 * 返回列表页同构的 HTML ⇒ 直接喂 parseList。实测 `query=witcher` → 40 条结果。
 */
async function searchGame(name, { timeout = 25000 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeout);
  try {
    const body = new URLSearchParams({ a: '2', query: String(name || '') });
    const r = await fetch(BASE + '/load/', {
      method: 'POST',
      headers: {
        'User-Agent': UA, Referer: BASE + '/load/', 'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html,*/*',
      },
      body: body.toString(), signal: ac.signal, redirect: 'follow',
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}

/* ────────────────────────── ④ 游戏名候选 ────────────────────────── */

/**
 * 从运营标题里生成**游戏名候选**（1~3 个，从具体到宽泛）。
 * ⚠️ 这只是**粗筛**用的 —— 最终以详情页 `Game:` 字段为准。
 *
 * 为什么需要多候选：GT 的标题是 `<游戏名> - <描述>` 或 `<游戏名>: <描述>`，
 * 但**游戏名自己就含 `:` 与 ` - `**（`GTA: San Andreas - The Definitive Edition`），
 * 一刀切会把真名切坏。所以两种分隔各出一个候选，谁先对上端游库用谁。
 *
 * 实测样例：
 *   `The Witcher 3: Wild Hunt Remastered - SaveGame 100%`   → [「The Witcher 3: Wild Hunt Remastered」, 「The Witcher 3」]
 *   `GTA: San Andreas - The Definitive Edition: SaveGame (…)` → [「GTA: San Andreas」, 「GTA: San Andreas - The Definitive Edition」]
 *   `Clive Barker's Hellraiser: Revival - Trainer +43 {CheatHappens.com}` → [「Clive Barker's Hellraiser: Revival」, 「Clive Barker's Hellraiser」]
 */
function gameCandidates(title) {
  let t = String(title || '').trim();
  if (!t) return [];
  /* 运营后缀：{CheatHappens.com} / (Trainer) / 版本号括号先去掉尾部块 */
  t = t.replace(/\s*\{[^{}]{0,60}\}\s*$/g, '').trim();
  const out = [];
  const dash = t.indexOf(' - ');
  const colon = t.indexOf(': ');
  if (dash > 1) out.push(t.slice(0, dash).trim());
  if (colon > 1) out.push(t.slice(0, colon).trim());
  /* 兜底：整条（去掉明显的类型尾巴） */
  out.push(t.replace(/\s*[-–—:]\s*(?:Save\s?Game|SaveGame|Trainer|Cheat|Cheats|Mod|Editor|Guide|Codes?)\b[\s\S]*$/i, '').trim());
  return [...new Set(out.filter((x) => x && x.length >= 2))];
}

module.exports = {
  BASE, UA, CAT, PER_PAGE,
  listUrl, getText, resolveDownload,
  parseList, parseDetail, maxPageIn, searchGame, gameCandidates,
  unesc, stripTags,
};
