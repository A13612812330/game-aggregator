/**
 * GameHub server — 机地 × XDGAME 信息聚合 API
 * 能力：/api/feed 聚合两个源站实时抓取（180s 内存缓存，?refresh=1 强制刷新）
 *      /api/detail?url= 源站详情页实时解析（600s 缓存，域名白名单）
 *      /           静态站点 public/
 */
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');
const jidi = require('./fetchers/jidi');
const xdgamer = require('./fetchers/xdgamer');

const app = express();
/* ★ 端口唯一真源（v10.1）
 *   历史坑：这里原本写 3456，而文件末尾 listen() 里又写了 8123 字面量，两处不一致 ——
 *   接手者读到哪一行就可能得出不同结论，白排查半天。现在统一成本常量，只此一处定义。
 *   实测本机无 PORT 环境变量，所以默认值就是 8123，与启动器 / 文档 / 测试脚本的约定一致。 */
const PORT = parseInt(process.env.PORT, 10) || 8123;

// ---------- 内存缓存（支持异步 builder：并发共享同一 Promise，失败自动清理） ----------
const cache = new Map();
function cached(key, ttlMs, builder) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < ttlMs) return hit.value;
  const p = Promise.resolve().then(builder);
  cache.set(key, { ts: Date.now(), value: p });
  p.catch(() => {
    const cur = cache.get(key);
    if (cur && cur.value === p) cache.delete(key);
  });
  return p;
}

// ---------- 源站 URL 白名单（防 SSRF） ----------
// 注意 xdgame.com 与 xdgamer.com 是两套内容独立的平行站(同 ID ≠ 同游戏)，host 需原样保留。
function parseDetailUrl(raw) {
  if (!raw) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  const host = u.hostname.replace(/^www\./, '');
  if (host !== 'jidiyouxi.com' && host !== 'xdgamer.com' && host !== 'xdgame.com') return null;
  let m = u.pathname.match(/^\/topic\/detail\/(\d+)/);
  if (m) return { source: 'jidi', id: m[1], host };
  m = u.pathname.match(/^\/game\/(\d+)\.html/);
  if (m) return { source: 'xdgamer', id: m[1], host };
  return null;
}

// ---------- 路由 ----------
// 全局 CORS:允许 file:// 打开的离线快照 HTML 直连本服务刷新为实时
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// 默认首页 = 单页聚合主站 public/index.html（内容库合并 + 聚合搜索）
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use(express.static(path.join(__dirname, 'public')));
// 旧版多页路由收敛：home/search/library 已并入单页主站,老链接 301 至首页
app.get(['/home.html', '/search.html', '/library.html'], (_req, res) => res.redirect(301, '/'));
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now(), ttl: { feed: 180, detail: 600 } });
});

app.get('/api/feed', async (req, res) => {
  const force = req.query.refresh === '1';
  if (force) cache.delete('feed');
  try {
    const data = await cached('feed', 180_000, async () => {
      const [jidiR, xdR] = await Promise.allSettled([jidi.feed(), xdgamer.feed()]);
      const result = {
        fetchedAt: Date.now(),
        sources: {
          jidi: jidiR.status === 'fulfilled'
            ? { ok: true, count: jidiR.value.length }
            : { ok: false, error: String(jidiR.reason && jidiR.reason.message || jidiR.reason) },
          xdgamer: xdR.status === 'fulfilled'
            ? { ok: true, count: xdR.value.length }
            : { ok: false, error: String(xdR.reason && xdR.reason.message || xdR.reason) },
        },
        items: [
          ...(jidiR.status === 'fulfilled' ? jidiR.value : []),
          ...(xdR.status === 'fulfilled' ? xdR.value : []),
        ],
      };
      return result;
    });
    res.json({ ok: true, ...data });
  } catch (e) {
    res.status(500).json({ ok: false, error: '聚合失败: ' + e.message });
  }
});

app.get('/api/detail', async (req, res) => {
  const target = parseDetailUrl(String(req.query.url || ''));
  if (!target) return res.status(400).json({ ok: false, error: '仅支持机地/XDGAME 详情页链接' });
  const key = 'detail:' + target.source + ':' + (target.host || '') + ':' + target.id;
  if (req.query.refresh === '1') cache.delete(key);
  try {
    const data = await cached(key, 600_000, () =>
      target.source === 'jidi' ? jidi.detail(target.id) : xdgamer.detail(target.id, target.host === 'xdgame.com' ? 'https://www.xdgame.com' : undefined)
    );
    res.json({ ok: true, fetchedAt: Date.now(), detail: data });
  } catch (e) {
    res.status(502).json({ ok: false, error: String((e && e.message) || e) });
  }
});

// 游戏别名词典（别名 → 官方名）：搜索前自动展开，提升俗称命中
const aliases = require('./fetchers/aliases.json');
function expandAlias(raw) {
  const q = String(raw || '').trim();
  const hit = aliases[q];
  if (hit) return { q: hit, alias: q };
  // 后缀含"2/3/4"等数字续作的模糊
  return { q, alias: null };
}

let hdBusy = false; // 机地深度搜索(无头浏览器)并发互斥
app.get('/api/search', async (req, res) => {
  const raw = String(req.query.q || '').trim().slice(0, 40);
  if (!raw) return res.status(400).json({ ok: false, error: '缺少搜索词 q' });
  const exp = expandAlias(raw);
  const q = exp.q;
  const headless = req.query.mode === 'headless';
  const key = (headless ? 'hdsearch:' : 'search:') + q;
  if (req.query.refresh === '1') cache.delete(key);
  const aliasNote = exp.alias ? { alias: exp.alias, to: exp.q } : null;
  if (headless) {
    if (hdBusy) return res.status(429).json({ ok: false, error: '机地深度搜索正忙（单实例串行），请稍候再试' });
    hdBusy = true;
    try {
      const data = await cached(key, 600_000, async () => {
        const jidiHd = require('./fetchers/jidiHeadless');
        const [xdR, jiR] = await Promise.allSettled([xdgamer.search(q), jidiHd.searchJidi(q)]);
        return {
          q, aliasNote, mode: 'headless', fetchedAt: Date.now(),
          searchUrl: {
            jidi: 'https://jidiyouxi.com/search?keyword=' + encodeURIComponent(q),
            xdgamer: 'https://www.xdgamer.com/search/' + encodeURIComponent(q) + '.html',
          },
          sources: {
            xdgamer: xdR.status === 'fulfilled'
              ? { ok: true, count: xdR.value.length, items: xdR.value }
              : { ok: false, error: String(xdR.reason && xdR.reason.message || xdR.reason), items: [] },
            jidi: jiR.status === 'fulfilled'
              ? { ok: true, count: jiR.value.length, mode: 'real', items: jiR.value }
              : { ok: false, error: String(jiR.reason && jiR.reason.message || jiR.reason), items: [] },
          },
        };
      });
      res.json({ ok: true, ...data });
    } catch (e) {
      res.status(500).json({ ok: false, error: '深度搜索失败: ' + e.message });
    } finally {
      hdBusy = false;
    }
    return;
  }
  try {
    const data = await cached('search:' + q, 300_000, async () => {
      const [xdR, jidiR] = await Promise.allSettled([xdgamer.search(q), jidi.search(q)]);
      return {
        q, aliasNote, fetchedAt: Date.now(),
        searchUrl: {
          jidi: 'https://jidiyouxi.com/search?keyword=' + encodeURIComponent(q),
          xdgamer: 'https://www.xdgamer.com/search/' + encodeURIComponent(q) + '.html',
        },
        sources: {
          xdgamer: xdR.status === 'fulfilled'
            ? { ok: true, count: xdR.value.length, items: xdR.value }
            : { ok: false, error: String(xdR.reason && xdR.reason.message || xdR.reason), items: [] },
          jidi: jidiR.status === 'fulfilled'
            ? { ok: true, count: jidiR.value.matched.length, indexed: jidiR.value.indexed, items: jidiR.value.matched }
            : { ok: false, error: String(jidiR.reason && jidiR.reason.message || jidiR.reason), items: [] },
        },
      };
    });
    res.json({ ok: true, ...data });
  } catch (e) {
    res.status(500).json({ ok: false, error: '搜索失败: ' + e.message });
  }
});

// 机地 周/月/年 热榜（缓存 600s）
app.get('/api/hots', async (req, res) => {
  if (req.query.refresh === '1') cache.delete('hots');
  try {
    const data = await cached('hots', 600_000, () => jidi.hotRanks());
    res.json({ ok: true, fetchedAt: Date.now(), hots: data });
  } catch (e) {
    res.status(502).json({ ok: false, error: String((e && e.message) || e) });
  }
});

// XDGAME 分类浏览（缓存 300s）
app.get('/api/category', async (req, res) => {
  const c = String(req.query.c || '').trim();
  if (!c || !xdgamer.CATEGORIES.some((x) => x.slug === c)) {
    return res.status(400).json({ ok: false, error: '未知分类,可选: ' + xdgamer.CATEGORIES.map((x) => x.slug).join(' / ') });
  }
  const key = 'cat:' + c;
  if (req.query.refresh === '1') cache.delete(key);
  try {
    const data = await cached(key, 300_000, () => xdgamer.category(c));
    res.json({ ok: true, fetchedAt: Date.now(), ...data });
  } catch (e) {
    res.status(502).json({ ok: false, error: String((e && e.message) || e) });
  }
});

// 动态生成"离线快照版 HTML"—— server 端实时抓取 + base64 注入,直接返回可双击保存的完整 HTML
const fs = require('fs');
app.get('/snapshot.html', async (req, res) => {
  try {
    const feed = await jidi.feed().catch(() => []);
    const hots = await jidi.hotRanks().catch(() => ({ weekly: [], monthly: [], annual: [] }));
    const cats = {};
    for (const slug of ['dzmx', 'jsby', 'qzsj', 'mnjy', 'xxyz']) {
      cats[slug] = (await xdgamer.category(slug).catch(() => ({ items: [] }))).items || [];
    }
    const snap = {
      fetchedAt: Date.now(),
      sources: {
        jidi: { ok: true, count: feed.filter((i) => i.source === 'jidi').length },
        xdgamer: { ok: true, count: feed.filter((i) => i.source === 'xdgamer').length },
      },
      feedItems: feed,
      hots,
      cats,
    };
    const b64 = Buffer.from(JSON.stringify(snap)).toString('base64');
    const htmlPath = path.join(__dirname, 'public', 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf-8');
    const inject = `<script>(function(){var b64="${b64}";try{window.__SNAPSHOT__=JSON.parse(atob(b64));}catch(e){document.body.setAttribute('data-decode-err',String(e));}})();</script>`;
    const pos = html.indexOf('</style>');
    html = html.slice(0, pos + 8) + '\n' + inject + html.slice(pos + 8);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="GameHub-Snapshot.html"');
    res.send(html);
  } catch (e) {
    res.status(500).send('生成快照失败: ' + e.message);
  }
});

// ================= 本地游戏库(全量索引 + 本地搜索 + 双源合并) =================
const gamesDb = require('./data/gamesDb');
const bannerhub = require('./data/bannerhub');
const phonecfg = require('./data/phonecfg');
/* ★ 手游中心统一索引：社区库 + 实测库**合并成一张表**（v9.2）
 *   前端手游专区默认走它，而不是再分两个页签各查各的。 */
const mobilehub = require('./data/mobilehub');
const xref = require('./data/xref');
const trainers = require('./data/trainers');
const mods = require('./data/mods');
const saves = require('./data/saves');
const pcreq = require('./data/pcreq');
const bhparams = require('./data/bhparams');
const emuguide = require('./data/emuguide');
const deviceMatch = require('./data/device-match');
const related = require('./data/related');
const indexer = require('./fetchers/indexer');
const xdrank = require('./fetchers/xdrank');

/* ---- 库查询通用选项：容量区间(GB) + 仅看有手机模拟器配置(+实测) ---- */
function libOpts(req) {
  const bhOnly = String(req.query.bh || '') === '1';
  const pcOnly = String(req.query.pc || '') === '1';
  /* ★ v10.5 横切筛选：库里有「修改器 / 云存档」收录的游戏
   *   （两个索引库每条都挂 libId，这里用 id 集合做 O(1) 命中） */
  const trOnly = String(req.query.tr || '') === '1';
  const svOnly = String(req.query.sv || '') === '1';
  const filters = [];
  if (bhOnly) filters.push((g) => !!bannerhub.lookup(g.title));
  if (pcOnly) filters.push((g) => !!phonecfg.lookup(g.title));
  if (trOnly) { const set = xref.trainerIds(); filters.push((g) => set.has(g.id)); }
  if (svOnly) { const set = xref.saveIds(); filters.push((g) => set.has(g.id)); }
  return {
    sizeMin: req.query.sizeMin,
    sizeMax: req.query.sizeMax,
    filter: filters.length === 1 ? filters[0] : (filters.length ? (g) => filters.every((f) => f(g)) : undefined),
  };
}
// 给库内条目挂上两个手机端数据源（社区库 bh + 实测库 pc），任一缺失不报错
function withBh(g) {
  const a = bannerhub.attach(g);
  return phonecfg.attach(a);
}

// 手机两库的条目 → 前端卡片字段。两条链路：
//   ① 已有 bannerhub 反查结果的（社区库）→ 平铺 libId/libTitle/libUrl/libCover
//   ② 没有的（实测库，bannerhub 匹配不到）→ 回退用本模块 libMatch 的结果
// 平铺的原因：卡片渲染拿的是扁平的 g.libCover，避免前端到处写 g.lib && g.lib.cover
function withLibFlat(g) {
  const o = Object.assign({}, g);
  let id = o.libId || null, title = o.libTitle || '', url = o.libUrl || '', cover = o.libCover || '';
  if (!id) {
    const it = phonecfg.libMatch(o.p || o.title || '');   // 社区库用 p(项目名)，实测库用 title
    if (it) { id = it.id; title = it.title || ''; url = it.url || ''; cover = it.cover || ''; }
  }
  o.libId = id; o.libTitle = title; o.libUrl = url; o.libCover = cover;
  return o;
}

/* ================= 📱 BannerHub 手机模拟器配置（社区共享） ================= */
// GET /api/bh/stats — 概览
app.get('/api/bh/stats', (_req, res) => res.json(Object.assign(bannerhub.stats(), { refreshing: !!(bhRun && !bhRun.done) })));

/* BannerHub 数据刷新（拉取 codeload 快照 → 重建索引 → 热加载），串行、可查询状态 */
let bhRun = null;   // { startedAt, done, ok, error, result }
app.post('/api/bh/refresh', (_req, res) => {
  if (bhRun && !bhRun.done) return res.json({ ok: true, running: true, startedAt: bhRun.startedAt });
  bhRun = { startedAt: Date.now(), done: false, ok: false, error: null, result: null };
  console.log('[GameHub] BannerHub 刷新开始…');
  const p = spawn(process.execPath, [path.join(__dirname, 'tools', 'refresh-bannerhub.js'), '--json'], { cwd: __dirname });
  let out = '', err = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { err += d; });
  p.on('error', (e) => { bhRun.done = true; bhRun.ok = false; bhRun.error = String(e.message); });
  p.on('close', () => {
    bhRun.done = true;
    try {
      const line = out.trim().split('\n').filter(Boolean).pop() || '{}';
      const j = JSON.parse(line);
      bhRun.ok = !!j.ok;
      bhRun.result = j;
      bhRun.error = j.error || null;
      if (bhRun.ok) bannerhub.load(true);   // 重建索引后热加载，无需重启服务
    } catch (e) {
      bhRun.ok = false;
      bhRun.error = (err || String(e.message)).trim().slice(0, 300);
    }
    console.log('[GameHub] BannerHub 刷新结束:', bhRun.ok ? '成功' : '失败 · ' + bhRun.error);
  });
  res.json({ ok: true, started: true, startedAt: bhRun.startedAt });
});
// GET /api/bh/refresh/state — 刷新任务状态（供前端/自动化轮询）
// 注意：这里的 ok 恒为 true，表示「状态查询成功」；刷新任务本身的成败看 lastOk / error。
// 不要直接把 bhRun 展开到顶层，否则 bhRun.ok=false（运行中）会覆盖掉查询成功的语义，造成误判。
app.get('/api/bh/refresh/state', (_req, res) => {
  const r = bhRun || {};
  res.json({
    ok: true,
    running: !!(bhRun && !bhRun.done),
    never: !bhRun,
    startedAt: r.startedAt || null,
    done: !!r.done,
    lastOk: bhRun ? !!r.ok : null,
    error: r.error || null,
    result: r.result || null,
  });
});

// GET /api/bh/list?q=&sort=configs|recent|name&gpu=&libOnly=1&limit=&offset= — 手机可玩频道列表
// libOnly=1 → 只返回命中本地库的条目（手游专区「手机可玩 + 有实测配置」默认开启）
app.get('/api/bh/list', (req, res) => {
  const r = bannerhub.list({
    q: req.query.q, sort: req.query.sort, gpu: req.query.gpu,
    libOnly: req.query.libOnly,
    limit: req.query.limit, offset: req.query.offset,
  });
  res.json(Object.assign({}, r, { items: (r.items || []).map(withLibFlat) }));
});

// GET /api/bh/match?t=<游戏名>&t2=<备用名> — 按库内标题反查配置（供抽屉/榜单挂徽标）
// 两个候选名依次尝试：源站详情页标题常与库内标题不一致，甚至解析为空
app.get('/api/bh/match', (req, res) => {
  const cands = [req.query.t, req.query.t2].map((x) => String(x || '').trim()).filter(Boolean);
  let h = null, used = '';
  for (const t of cands) { const r = bannerhub.lookup(t); if (r) { h = r; used = t; break; } }
  res.json({ ok: true, t: cands[0] || '', used, hit: h ? { k: h.k, p: h.p, c: h.c, dv: h.dv, gp: h.gp, t: h.t, n: h.n } : null });
});

// GET /api/bh/configs?k=<仓库键> — 某游戏的逐条配置（手机/GPU/日期/下载直链）
//   ★ v10.13：k 允许传**逗号分隔的候选键**。社区仓库里同一款游戏常有多个别名目录
//   （PES2013 / PES_2013 / Pes__2013…），份数差别很大（2 份 vs 2773 份）。
//   这里自动挑「文件最多」的那个键，避免用户点进面板只看到两条配置。
app.get('/api/bh/configs', (req, res) => {
  const cands = String(req.query.k || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!cands.length) return res.status(400).json({ ok: false, error: '缺少参数 k' });
  const d = bannerhub.ensure();
  let k = '', best = -1;
  for (const c of cands) {
    const n = bannerhub.configs(c).length;
    if (n > best) { best = n; k = c; }
  }
  const g = (d.games || []).find((x) => x.k === k) || null;
  if (!g) return res.status(404).json({ ok: false, error: '未收录该游戏' });
  res.json({
    ok: true,
    game: { k: g.k, p: g.p, c: g.c, t: g.t, dv: g.dv, gp: g.gp, n: g.n },
    repo: (d.site || 'https://the412banner.github.io/bannerhub-game-configs/') + '#' + encodeURIComponent(g.k),
    items: bannerhub.configs(k),
  });
});

/* ================= 📱 手游中心·统一索引（社区库 + 实测库 合并） =================
 *
 * ★ 为什么单独做一层（v9.2）：
 *   社区库与实测库原本各有一个页签，同一款游戏（如 GTA V）两边各出现一次，
 *   用户要在两个页签来回切、也看不出「这款到底有几套配置可抄 + 实测多少帧」。
 *   mobilehub 把两者按名字/端游库 id 归并成**一张表**，同款只占一条。
 *   前端手游专区默认走这层，默认只显示**能对上端游库**的（libId 非空）。
 */

// GET /api/mobilehub/stats — 概览（合并总数 / 匹配率 / 配置与实测累加值 / GPU 与机型清单）
app.get('/api/mobilehub/stats', (_req, res) => res.json(mobilehub.stats()));

// GET /api/mobilehub/list?q=&sort=configs|recent|name|fps&gpu=&tier=&stats=all|matched&only=both&tr=1&sv=1&limit=&offset=
//   stats=matched（默认）→ 只返回命中端游库的条目
//   only=both           → 只看双料（社区配置库 + 机型实测库都有），与 stats 是 AND 关系
//   tr=1 / sv=1         → 只看「修改器」/「云存档」库收录到的（v10.5，按端游库 id 关联）
app.get('/api/mobilehub/list', (req, res) => {
  const r = mobilehub.list({
    q: req.query.q, sort: req.query.sort, gpu: req.query.gpu,
    tier: req.query.tier, stats: req.query.stats, only: req.query.only,
    tr: req.query.tr, sv: req.query.sv,
    limit: req.query.limit, offset: req.query.offset,
  });
  /* 挂上 hasTr/hasSv 供卡片角标显示 —— 返回副本，别把标记写回索引缓存 */
  r.items = (r.items || []).map((x) => Object.assign({}, x, xref.flags(x.libId)));
  res.json(r);
});

// GET /api/xref/stats — 「有修改器 / 有云存档」两个横切集合的规模（前端空态与校验用）
app.get('/api/xref/stats', (_req, res) => res.json(xref.stats()));

// GET /api/mobilehub/match?t=<游戏名>&id=<端游库id>&alts=<另一源的标题,英文名…>
//   按名称/别名反查合并条目（抽屉挂徽标用）
//   ★ v10.14：增加 id 与 alts —— 修「机地源条目标题对不上 mobilehub 英文名」的假阴性。
//     机地标题是「生化危机4重置版」、mobilehub 里是 `Resident Evil 4`，单靠归一化永远对不上。
//     抽屉会先解析出「另一源的同款条目」，把它 libId 与标题（常含英文名）一起带过来：
//       · id   → libId 精确命中（最可靠）
//       · alts → 跨中英桥接
app.get('/api/mobilehub/match', (req, res) => {
  const t = String(req.query.t || '').trim();
  const libId = String(req.query.id || '').trim();
  const alts = String(req.query.alts || '').split(/[,，|｜]/).map((s) => s.trim()).filter(Boolean);
  const hit = (t || libId || alts.length) ? mobilehub.lookup(t, { libId, alts }) : null;
  res.json({ ok: true, t, hit: hit ? {
    name: hit.name, alt: hit.alt, configs: hit.configs, records: hit.records,
    tier: hit.tier, tiers: hit.tiers, gpus: hit.gpus, chips: hit.chips,
    devices: hit.devices, devicesCnt: (hit.devices || []).length,
    bestLabel: hit.bestLabel, bestMid: hit.bestMid,
    libId: hit.libId, libTitle: hit.libTitle,
    /* ★ v10.13：把社区仓库键与来源一起带出来 —— 抽屉要按 key 拉「逐条游玩参数」
     *   （以前只返回计数，前端拿不到 key，就只会显示「N 套配置」而看不到配置内容） */
    bhKeys: hit.bhKeys || [], sources: hit.sources || [],
  } : null });
});

// GET /api/bh/params?k=<仓库键>&limit=4 — 逐条「游玩参数」（驱动 / DXVK / 容器 / 翻译层 / 分辨率…）
//   以前前端只能给一个「下载 JSON」链接，用户要下下来才知道内容 —— 这里把内容铺开
//   ★ v10.14：每条附带 spec（机型 → SoC / CPU 核簇 / 性能分），并给出 devices 汇总。
//     理由：社区配置里的机型是**内部代号**（Xiaomi 24095PCADG），对用户毫无意义；
//     系统里本来就有 device-match 的转译能力（1,039 个代号里 1,021 个可译），
//     以前详情页从没调用它 —— 这就是用户说的「详情页里对应的机型和配置没有补全」。
//     放在服务端一次算完，避免前端对每台机型发一次请求（N+1）。
app.get('/api/bh/params', async (req, res) => {
  const k = String(req.query.k || '').trim();
  if (!k) return res.status(400).json({ ok: false, error: '缺少参数 k' });
  try {
    const out = await bhparams.params(k, req.query.limit);
    const specOf = (dev) => {
      if (!dev) return null;
      try {
        const r = deviceMatch.findDevice(dev);
        if (!r || (!r.gpu && !r.soc)) return null;
        return { soc: r.soc || '', socVendor: r.socVendor || '', gpu: r.gpu || '', cpu: r.cpu || '', score: r.score || 0, brand: r.brand || '', approx: !!r.approx };
      } catch (e) { return null; }
    };
    /* ★ v10.14：这里也要过一遍 GPU 清洗 —— bhparams.json 是**另一条数据链路**
       （不走 mobilehub 的读取层），里面存着 `Adreno (TM) 740` 这类带商标后缀的写法。
       不清的话，同一个 GPU 在「机型清单」里叫 `Adreno 740`、在参数卡里叫 `Adreno (TM) 740`。
       cleanGpuOne 是 GPU 命名的**唯一事实来源**（与 mobilehub 读取层同源）。 */
    const cleanGpu = (g) => { try { return mobilehub.cleanGpuOne(g) || ''; } catch (e) { return g || ''; } };
    const items = (out.items || []).map((p) => Object.assign({}, p, {
      gpu: cleanGpu(p.gpu),
      spec: specOf(p.device),
    }));
    /* 机型汇总：去重 + 带规格（前端铺「机型清单」用） */
    const seen = new Map();
    for (const p of items) {
      const d = String(p.device || '').trim();
      if (!d || seen.has(d)) continue;
      seen.set(d, { device: d, gpu: p.gpu || '', spec: p.spec || null, date: p.date || '' });
    }
    res.json(Object.assign({}, out, { items, devices: [...seen.values()] }));
  } catch (e) {
    res.status(502).json({ ok: false, error: String((e && e.message) || e) });
  }
});

/* ================= 🛠 修改器（Game Cheats Manager 公开清单） =================
 *
 *  数据源：https://gamezonelabs.com/api/data/gcm（公开 GET，免密钥）
 *  由 tools/fetch-trainers.js 采集，覆盖 5 个来源共 3,589 条。
 *
 *  ⚠️ 不含下载直链 —— GCM 走一次性 S3 签名 URL（依赖客户端密钥），无法离线复现。
 *     本组接口只提供「有哪些修改器 / 哪个源 / 什么版本 / 对应哪款端游」，
 *     详情页再做「获取引导」。
 */

// GET /api/trainers/stats — 概览（总数 / 匹配率 / 分源分布）
app.get('/api/trainers/stats', (_req, res) => res.json(trainers.stats()));

// GET /api/trainers/list?q=&source=&sort=lib|name|zh|source&stats=all&limit=&offset=
//   stats=matched（默认）→ 只返回能对上端游库的
app.get('/api/trainers/list', (req, res) => {
  res.json(trainers.list({
    q: req.query.q, source: req.query.source, sort: req.query.sort,
    stats: req.query.stats, limit: req.query.limit, offset: req.query.offset,
  }));
});

// GET /api/trainers/match?t=<游戏名>&id=<端游库id> — 某款游戏的修改器（详情抽屉 / 卡片徽标）
//   同 saves/match：精确优先，不中退回子串检索。
app.get('/api/trainers/match', (req, res) => {
  const t = String(req.query.t || '').trim();
  const id = String(req.query.id || '').trim();
  let list = id ? trainers.byLib(id) : [];
  if (!list.length && t) {
    const hit = trainers.lookup(t);
    if (hit) list = hit.libId ? trainers.byLib(hit.libId) : [hit];
  }
  if (!list.length && t) {
    const r = trainers.list({ q: t, stats: 'all', sort: 'lib', limit: 12 });
    list = r.items || [];
  }
  res.json({
    ok: true, t, id, count: list.length,
    items: list.map((x) => ({
      name: x.name, zh: x.zh, version: x.version, source: x.source,
      libId: x.libId, libTitle: x.libTitle,
    })),
  });
});

/* ================= 🔧 MOD / 修改器（机地社区帖 · 带网盘直链） =================
 *
 *  数据源：https://jidiyouxi.com/modify/list 的两个页签（resource_type 2=MOD / 3=修改器）
 *  由 tools/fetch-mods.js 轮询机地 post_list 接口产出 data/mods.json。
 *  ★ 与上面 GCM 那套 trainers **互不替代**：
 *      · trainers 是英文站点元数据目录，只有「有没有 / 什么版本」，没有下载地址
 *      · mods 是机地社区帖，正文里直接带网盘直链（夸克/百度/迅雷…），能真拿到东西
 */

// GET /api/mods/stats — 概览（总数 / 分类 / 匹配率 / 链接数）
app.get('/api/mods/stats', (_req, res) => res.json(mods.stats()));

// GET /api/mods/list?q=&kind=mod|modifier&sort=new|hot|game|title&all=1&limit=&offset=
//   默认只返回能对上端游库的（all=1 放开到全量）
app.get('/api/mods/list', (req, res) => {
  res.json(mods.list({
    q: req.query.q, kind: req.query.kind, sort: req.query.sort,
    all: req.query.all, limit: req.query.limit, offset: req.query.offset,
  }));
});

// GET /api/mods/item?id= — 单条（抽屉/预览）
app.get('/api/mods/item', (req, res) => {
  const it = mods.get(req.query.id);
  res.json(it ? { ok: true, item: it } : { ok: false, error: 'not found' });
});

// GET /api/mods/top?limit= — 条目数最多的游戏（「最热游戏」榜）
app.get('/api/mods/top', (req, res) => {
  res.json({ ok: true, items: mods.topGames(parseInt(req.query.limit, 10) || 20) });
});

// GET /api/mods/match?t=<游戏名>&id=<端游库id>&kind= — 某款游戏的 MOD/修改器（详情抽屉）
//   同 trainers/saves：精确优先，不中退回子串检索。
app.get('/api/mods/match', (req, res) => {
  const t = String(req.query.t || '').trim();
  const id = String(req.query.id || '').trim();
  const kind = String(req.query.kind || '').trim();
  let list = id ? mods.byLib(id, kind) : [];
  if (!list.length && t) {
    let byName = mods.byGame(t);
    if (!byName.length) {
      const r = mods.list({ q: t, all: '1', sort: 'new', limit: 24 });
      byName = r.items || [];
    }
    list = kind ? byName.filter((x) => x.kind === kind) : byName;
  }
  res.json({ ok: true, t, id, count: list.length, items: list.slice(0, 12) });
});

/* ================= 💾 云存档（存档位置库 · Ludusavi 开源清单） =================
 *
 *  数据源：https://github.com/mtkennerly/ludusavi-manifest（MIT）
 *  由 tools/build-saves.js 流式过滤产出。每条含存档文件路径 / 注册表项 /
 *  云同步支持平台 / Steam appid —— 也就是用户要的「存档放置位置」。
 */

// GET /api/saves/stats — 概览
app.get('/api/saves/stats', (_req, res) => res.json(saves.stats()));

// GET /api/saves/list?q=&phone=1&cloud=1&sort=paths|name|cloud&stats=all&limit=&offset=
//   默认只看「手机能玩」（在手游中心内）；stats=all 放开到全量 5,741 款
app.get('/api/saves/list', (req, res) => {
  res.json(saves.list({
    q: req.query.q, phone: req.query.phone, cloud: req.query.cloud,
    sort: req.query.sort, stats: req.query.stats,
    limit: req.query.limit, offset: req.query.offset,
  }));
});

// GET /api/saves/match?t=<游戏名>&id=<端游库id> — 某款游戏的存档位置（详情抽屉）
//   精确命中优先；不中时退回**子串检索**（用户常只输入「只狼」，而库内是全名
//   「只狼：影逝二度/Sekiro: Shadows Die Twice」，精确匹配会白跑一趟）
app.get('/api/saves/match', (req, res) => {
  const t = String(req.query.t || '').trim();
  const id = String(req.query.id || '').trim();
  let hit = (id && saves.byLib(id)) || (t && saves.lookup(t)) || null;
  if (!hit && t) {
    const r = saves.list({ q: t, stats: 'all', sort: 'paths', limit: 1 });
    hit = (r.items || [])[0] || null;
  }
  res.json({ ok: true, t, id, hit });
});

/* ================= 🖥 PC 配置要求（最低 / 推荐） =================
 *
 * 背景（v10.13）：用户反馈「详情页的游玩配置没有了」。根因不是前端坏了 ——
 *   XDGAME 详情页改版后**本身就没有配置要求数据**（只有厂商/发行/更新时间/版本介绍），
 *   而前端 `d.requirements ? … : ''` 是「没有就整块不渲染」，
 *   于是 XD 来源的 15,302 款游戏那块信息**天然永久空白**。
 *
 * 补法与优先级（三级）：
 *   ① 源站自带 —— 机地详情页的 game_sys_reqs（前端 d.requirements 直接用，不走这里）
 *   ② Steam 官方接口 —— 本库 97.2% 的 cover 里带 Steam appid（见 data/pcreq.js）
 *   ③ 同名机地话题 —— ②没命中（冷门/未上架 Steam）时，用本地库里的机地同名条目兜底
 *
 * 缓存：data/steam-req.json（tools/build-steam-req.js 预热 + 命中即回写），
 *       未收录的 appid 写 7 天负缓存，避免每次开详情页都白打一次网络。
 */
// GET /api/pcreq/stats — 缓存概览
app.get('/api/pcreq/stats', (_req, res) => res.json(pcreq.stats()));

// GET /api/pcreq?t=<标题>&cover=<封面URL>&id=<端游库id> — 某款游戏的配置要求
app.get('/api/pcreq', async (req, res) => {
  const t = String(req.query.t || '').trim().slice(0, 120);
  const id = String(req.query.id || '').trim();
  /* ★ 封面候选要**多个**：源站详情抓回来的 d.cover 常是 xdgame 自己的 /uploads/ 图，
   *   里面没有 Steam appid；而本地库的 cover 是 Steam CDN 形态（97.2% 命中）。
   *   谁先解析出 appid 就用谁 —— 只信 d.cover 会让一大半游戏白白判成「无配置」。 */
  const coverCands = [];
  if (id) {
    const it = gamesDb.byIdGet(id);
    if (it) coverCands.push(it.cover || '');
  }
  coverCands.push(String(req.query.cover || '').trim());
  const cover = coverCands.find((c) => pcreq.appidOf(c)) || coverCands[0] || '';
  try {
    const r = await pcreq.resolve({ title: t, cover });
    /* ③ 机地同名兜底：只在 Steam 没命中时走，且必须**中文名完全一致**才认，
     *    否则「生化危机4」会匹配到「生化危机4 重制版」这类不同作品。 */
    if (!r.hit && t) {
      const zh = t.split('/')[0].trim();
      if (zh.length >= 2) {
        const cand = gamesDb.search(zh, 12).items || [];
        const hit = cand.find((x) => x.source === 'jidi' && String(x.title || '').split('/')[0].trim() === zh);
        if (hit) {
          const jid = (String(hit.id || '').match(/(\d+)/) || [])[1];
          try {
            const d = jid ? await cached('pcreq-jidi:' + jid, 86400_000, () => jidi.detail(jid)) : null;
            if (d && d.requirements) {
              return res.json({ ok: true, hit: true, src: 'jidi', appid: r.appid || '', min: d.requirements, rec: null, name: d.title || '' });
            }
          } catch (e) { /* 机地也取不到就维持未命中 */ }
        }
      }
    }
    res.json(r);
  } catch (e) {
    res.status(502).json({ ok: false, error: String((e && e.message) || e) });
  }
});

/* ================= 🧰 工具总览（修改器 + 云存档同屏概览） ================= */

// GET /api/tools/stats — 两个新模块的一句话概览（页签数字回填用）
app.get('/api/tools/stats', (_req, res) => {
  const t = trainers.stats();
  const s = saves.stats();
  res.json({
    ok: true,
    trainers: { total: t.total, matched: t.matched, matchedRate: t.matchedRate, sources: t.sources.length },
    saves: {
      total: s.total, phonePlayable: s.phonePlayable, pathCount: s.pathCount,
      withCloud: s.withCloud, withSteam: s.withSteam,
    },
  });
});

/* ================= 🎮 手机实测配置库（本项目自建·含帧率与问题备注） ================= */
// GET /api/pc/stats — 概览（记录数 / 游戏数 / 可玩数 / 机型 / 帧率分档 / GPU 与兼容层分布）
app.get('/api/pc/stats', (_req, res) => {
  const s = phonecfg.stats();
  res.json(Object.assign({ ok: true, chipMap: phonecfg.ensure().chipMap || {} }, s));
});

// GET /api/pc/list?q=&chip=&tier=&ok=1&sort=fps|cfg|name&limit=&offset= — 可玩游戏列表
app.get('/api/pc/list', (req, res) => {
  const r = phonecfg.list({
    q: req.query.q, chip: req.query.chip, tier: req.query.tier, ok: req.query.ok,
    sort: req.query.sort, limit: req.query.limit, offset: req.query.offset,
  });
  res.json(Object.assign({}, r, { items: (r.items || []).map(withLibFlat) }));
});

// GET /api/pc/match?t=<游戏名>&t2=<备用名> — 按库内标题反查实测记录（供卡片徽标 / 详情区块）
app.get('/api/pc/match', (req, res) => {
  const cands = [req.query.t, req.query.t2].map((x) => String(x || '').trim()).filter(Boolean);
  let h = null, used = '';
  for (const t of cands) { const r = phonecfg.lookup(t); if (r) { h = r; used = t; break; } }
  res.json({
    ok: true, t: cands[0] || '', used,
    hit: h ? {
      k: h.k, t: h.title, n: h.n, ok: h.okN, chips: h.chips, gpus: h.gpus,
      tiers: h.tiers, best: h.bestLabel, bestMid: h.bestMid, cfg: h.hasCfgN, noteN: (h.notes || []).length,
    } : null,
  });
});

// GET /api/pc/records?k=<游戏名> — 某款游戏的全部实测记录（逐条：机型/兼容层/驱动/DXVK/vkd3d/运行库/帧率/备注/exe）
app.get('/api/pc/records', (req, res) => {
  const k = String(req.query.k || '').trim();
  if (!k) return res.status(400).json({ ok: false, error: '缺少参数 k' });
  const r = phonecfg.records(k);
  // 一并返回本地库命中结果：面板里可直接「查看游戏详情」，无需再发一次匹配请求
  const it = phonecfg.libMatch(r.title || k);
  res.json({
    ok: true, title: r.title, chipMap: phonecfg.ensure().chipMap || {}, items: r.items,
    lib: it ? { id: it.id, title: it.title, url: it.url, cover: it.cover } : null,
  });
});

/* ================= 📖 模拟器指南（技术栈 / 芯片驱动 / 优化 / 避坑） ================= */
// GET /api/emuguide — 全部指南内容（体量小，一次返回）
app.get('/api/emuguide', (_req, res) => res.json(emuguide.guide()));

// GET /api/emuguide/chip?c=8gen3 — 某芯片代号 → 推荐驱动/构建（供实测配置面板联动）
app.get('/api/emuguide/chip', (req, res) => {
  const c = String(req.query.c || req.query.code || '').trim();
  if (!c) return res.status(400).json({ ok: false, error: '缺少参数 c' });
  res.json(emuguide.chipAdvice(c));
});

/* ================= 📱 机型兼容查询（选品牌+型号 → 能跑哪些游戏） =================
   数据来自 data/device-match.js：
     · soc-db（1444 款芯片规格，vitkuz573/soc-db）
     · device-board（200 主板代号 → SoC，xTheEc0）
     · turnip（Banners-Turnip 驱动构建）
   核心逻辑：机型 → GPU → 性能档；游戏被「性能 ≤ 用户档」的 GPU 跑过 → 可跑（向下兼容）
*/

// GET /api/device/stats — 机型库规模（子页签数字回填用）
app.get('/api/device/stats', (_req, res) => {
  try {
    const brands = deviceMatch.brands() || [];
    // 机型总数：brands() 返回 [{ name, n }]，n 即该品牌机型数
    const devices = brands.reduce((sum, b) => sum + (Number(b.n) || 0), 0);
    res.json({ ok: true, brands: brands.length, devices });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// GET /api/device/brands — 品牌列表（含机型数）
app.get('/api/device/brands', (_req, res) => {
  try {
    res.json({ ok: true, brands: deviceMatch.brands() });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// GET /api/device/models?brand=小米 / Redmi&q=2412&limit=100 — 机型列表
app.get('/api/device/models', (req, res) => {
  try {
    const brand = String(req.query.brand || '').trim();
    const q = String(req.query.q || '').trim();
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    res.json({ ok: true, models: deviceMatch.models({ brand, q, limit }) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// GET /api/device/match?model=Xiaomi 2412DPC0AG&limit=300 — 能跑的游戏
app.get('/api/device/match', (req, res) => {
  try {
    const model = String(req.query.model || req.query.m || '').trim();
    if (!model) return res.status(400).json({ ok: false, error: '缺少参数 model' });
    const limit = Math.min(parseInt(req.query.limit, 10) || 300, 1000);
    const r = deviceMatch.matchGames(model, { limit });
    if (!r.ok) return res.status(404).json(r);
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// GET /api/device/specs?models=a|b|c — 批量取机型规格（★ v10.14）
//   详情页要一次铺出「这款游戏跑过的机型清单」（GTA5 有 7 台），
//   若逐台调 /api/device/match 就是 N+1 —— 这里一次算完。
//   单台失败不影响其他（返回 spec:null，前端显示代号即可），不编造。
app.get('/api/device/specs', (req, res) => {
  try {
    const list = String(req.query.models || '').split(/[|,，]/).map((s) => s.trim()).filter(Boolean).slice(0, 40);
    const out = {};
    for (const m of list) {
      try {
        const r = deviceMatch.findDevice(m);
        out[m] = (r && (r.gpu || r.soc))
          ? { soc: r.soc || '', socVendor: r.socVendor || '', gpu: r.gpu || '', cpu: r.cpu || '', score: r.score || 0, brand: r.brand || '', approx: !!r.approx }
          : null;
      } catch (e) { out[m] = null; }
    }
    res.json({ ok: true, specs: out });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// GET /api/device/chip?q=8gen3 — 芯片规格（来自 soc-db）
app.get('/api/device/chip', (req, res) => {
  try {
    const q = String(req.query.q || req.query.c || '').trim();
    if (!q) return res.status(400).json({ ok: false, error: '缺少参数 q' });
    res.json({ ok: true, chips: deviceMatch.chipSpec(q) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// GET /api/device/turnip — Turnip 驱动最新构建信息
app.get('/api/device/turnip', (_req, res) => {
  try {
    const t = deviceMatch.turnipInfo();
    if (!t) return res.status(404).json({ ok: false, error: '未抓取到 turnip.json' });
    res.json({ ok: true, ...t });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

gamesDb.load();
bannerhub.load();
phonecfg.load();

// ---------- 双热度合并榜 /api/rank（XD 官方周/月/全站 + 机地社区周） ----------
// week/month/year：XD 官网首页三档 SSR 热度榜 → 映射本地库记录（URL 同源）
// community：机地社区周热度（话题榜）→ 直接返回 jidi hotRanks weekly
const RANK_META = {
  week: { label: '本周热门', src: 'xdgamer', tip: 'XD 官网 · 本周热门' },
  month: { label: '当月最热', src: 'xdgamer', tip: 'XD 官网 · 当月最热' },
  year: { label: '全站最热', src: 'xdgamer', tip: 'XD 官网 · 全站最热' },
  community: { label: '社区热榜', src: 'jidi', tip: '机地 · 社区热度（周）' },
};
app.get('/api/rank', async (req, res) => {
  const p = ['week', 'month', 'year', 'community'].includes(String(req.query.p)) ? String(req.query.p) : 'week';
  if (req.query.refresh === '1') cache.delete('rank:' + p);
  try {
    const data = await cached('rank:' + p, 1_800_000, async () => {
      if (p === 'community') {
        const hots = await jidi.hotRanks();
        return { p, meta: RANK_META[p], list: (hots.weekly || []).slice(0, 12).map((it, i) => withBh({ ...it, rank: it.rank || i + 1 })) };
      }
      const raw = await xdrank.rawHot(); // {week:[],month:[],year:[]}
      const rows = raw[p] || [];
      const all = gamesDb.all();
      const byUrl = new Map(all.map((g) => [g.url, g]));
      const list = rows.map((it) => {
        const rec = byUrl.get(it.url);
        return rec
          ? { ...rec, rank: it.rank || 0 }
          : { source: 'xdgamer', rank: it.rank || 0, title: it.name, cover: null, genres: [], size: null, score: null, updatedTs: null, dateLabel: null, url: it.url };
      });
      return { p, meta: { ...RANK_META[p], dropped: (raw._dropped || {})[p] || 0 }, list: list.map(withBh) };
    });
    res.json({ ok: true, fetchedAt: Date.now(), ...data });
  } catch (e) {
    res.status(502).json({ ok: false, error: String((e && e.message) || e) });
  }
});

/* ---------- 索引状态持久化 data/index-state.json(断点续跑/校准判定基础) ----------
   xdgame.nextPage: 下一个待抓列表页。0=尚未校准; >maxKnown=已校准至末尾; 1..maxKnown=断点位置
   jidi: 机地话题最近一次同步统计
*/
const IDX_STATE_FILE = path.join(__dirname, 'data', 'index-state.json');
const idxState = {
  xdgame: { nextPage: 0, maxKnown: 0, lastFullAt: 0, lastIncrAt: 0, updatedAt: 0 },
  jidi: { synced: 0, added: 0, total: 0, lastSyncAt: 0 },
};
function loadIdxState() {
  try {
    const raw = JSON.parse(fs.readFileSync(IDX_STATE_FILE, 'utf-8'));
    if (raw.xdgame) Object.assign(idxState.xdgame, raw.xdgame);
    if (raw.jidi) Object.assign(idxState.jidi, raw.jidi);
  } catch (e) { /* 首次运行无状态文件 */ }
}
function saveIdxState() {
  try { fs.writeFileSync(IDX_STATE_FILE, JSON.stringify(idxState)); }
  catch (e) { console.error('[GameHub] 索引状态写盘失败:', e.message); }
}
loadIdxState();

let indexRun = null; // XD 列表索引任务(串行)
let jidiRun = null;  // 机地话题同步任务(串行, 与 xd 任务互斥)
const busyRun = () => !!((indexRun && !indexRun.done) || (jidiRun && !jidiRun.done));

/** 统一 XD 列表任务执行器: 运行中每 5 页落一次断点, 结束/中断都保留断点供续跑 */
function startXdTask(start, end, kind) {
  const task = { kind, start, end, page: start - 1, total: gamesDb.stats().total, added: 0, startedAt: Date.now(), done: false };
  indexRun = task;
  const st = idxState.xdgame;
  (async () => {
    try {
      await indexer.indexXdRange(start, end, (p) => {
        task.page = p.page; task.total = p.got; task.added = p.added;
        if (kind === 'calibrate') {
          st.nextPage = p.page + 1; st.updatedAt = Date.now();
          if (p.page % 5 === 0) saveIdxState();
        }
      });
      if (kind === 'calibrate') { st.nextPage = end + 1; st.maxKnown = Math.max(st.maxKnown, end); st.lastFullAt = Date.now(); st.updatedAt = Date.now(); saveIdxState(); }
      if (kind === 'incr') { st.lastIncrAt = Date.now(); st.updatedAt = Date.now(); saveIdxState(); }
      task.done = Date.now();
    } catch (e) {
      task.error = String(e.message || e); task.done = Date.now();
      saveIdxState(); // 中断也落断点 → 下次 calibrate 从断点续跑
    } finally {
      setTimeout(() => { if (indexRun === task) indexRun = null; }, 15000); // 完成态保留 15s 供前端收尾
    }
  })();
  return task;
}

app.get('/api/library/stats', (_req, res) => {
  const st = gamesDb.stats();
  res.json({ ok: true, ...st, running: busyRun() });
});

// GET /api/library?q=&limit=20&sizeMin=&sizeMax=&bh=1 — 本地库即时搜索(别名展开,已含双源)
app.get('/api/library', (req, res) => {
  const raw = String(req.query.q || '').trim().slice(0, 40);
  const limit = Math.min(parseInt(req.query.limit || '20', 10) || 20, 50);
  if (!raw) return res.json({ ok: true, q: '', count: 0, items: [] });
  const exp = expandAlias(raw);
  const aliasNote = exp.alias ? { alias: exp.alias, to: exp.q } : null;
  const r = gamesDb.search(exp.q, limit, libOpts(req));
  res.json({ ok: true, q: raw, aliasNote, count: r.count, total: gamesDb.stats().total, items: r.items.map(withBh) });
});

// GET /api/library/recent?limit=20 — 最近收录(供空态展示)
app.get('/api/library/recent', (_req, res) => {
  const limit = Math.min(parseInt(_req.query.limit || '20', 10) || 20, 50);
  const all = gamesDb.all()
    .filter((g) => g.updatedTs || g.title)
    .sort((a, b) => (b.updatedTs || 0) - (a.updatedTs || 0))
    .slice(0, limit);
  res.json({ ok: true, items: all.map(withBh) });
});

// GET /api/library/related?id=&t=&g=&limit= — ★ v10.11 详情抽屉「同分类更多」
//
//  旧做法是 `browse(g=genres[0], sort=score)` 再随机洗牌 —— 而库里每款只有 1 个标签、
//  「动作冒险」独占 36.8%，等于随机抽卡；标签里还混着 `免费专区/联机整合/模拟器整合`
//  这类运营标签（非游戏类型）。改由 data/related.js 做多因子打分：
//  类型交集(IDF 加权) + 系列名 + 评分接近度 + 容量接近度。
app.get('/api/library/related', (req, res) => {
  try {
    const r = related.related({
      id: String(req.query.id || '').trim(),
      t: String(req.query.t || '').trim(),
      g: String(req.query.g || '').trim(),
      limit: req.query.limit,
    });
    res.json(Object.assign({}, r, { items: (r.items || []).map(withBh) }));
  } catch (e) {
    res.json({ ok: false, error: e.message, items: [] });
  }
});

// GET /api/library/browse?g=动作冒险&limit=50&offset=0&sort=updated|score|size&sizeMin=&sizeMax=&bh=1
app.get('/api/library/browse', (req, res) => {
  const g = String(req.query.g || '').trim();
  const sort = ['score', 'size'].includes(String(req.query.sort || '')) ? String(req.query.sort) : 'updated';
  const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 100);
  const offset = Math.max(0, parseInt(req.query.offset || '0', 10) || 0);
  const r = gamesDb.browse(g, limit, offset, sort, libOpts(req));
  res.json({ ok: true, ...r, items: r.items.map(withBh) });
});

// GET /api/search/all?q=&limit= — ★ 统一全站搜索（端游库 + 手游中心 + 修改器 + 云存档）
//
// 顶栏搜索按钮在「首页」与「手机专区」都用这一个端点，结果**分组返回**：
//   · pc      → 端游库命中（点进源站/本地详情）
//   · mobile  → 手游中心命中（点开「手机能玩吗」面板）
//   · trainer → 修改器命中（有修改器的游戏，点开「修改器」页签）
//   · save    → 云存档命中（有存档位置记录的游戏，点开「云存档」页签）
// v10 起把修改器/云存档也并进来 —— 用户在手机专区点一次搜索，四个库一起搜。
app.get('/api/search/all', (req, res) => {
  const raw = String(req.query.q || '').trim().slice(0, 40);
  const limit = Math.min(parseInt(req.query.limit || '12', 10) || 12, 30);
  const empty = { ok: true, q: '', pc: { count: 0, items: [] }, mobile: { count: 0, items: [] }, trainer: { count: 0, items: [] }, save: { count: 0, items: [] } };
  if (!raw) return res.json(empty);

  const exp = expandAlias(raw);
  const aliasNote = exp.alias ? { alias: exp.alias, to: exp.q } : null;

  /* ① 端游库 */
  let pc = { count: 0, items: [] };
  try {
    const r = gamesDb.search(exp.q, limit, libOpts(req));
    pc = { count: r.count, items: r.items.map(withBh) };
  } catch (e) { pc = { count: 0, items: [], error: e.message }; }

  /* ② 手游中心（合并索引，含社区库英文名与实测库中文名的别名展开） */
  let mobile = { count: 0, items: [] };
  try {
    const m = mobilehub.list({ q: exp.q, stats: 'all', sort: 'configs', limit });
    mobile = {
      count: m.total,
      items: (m.items || []).map((x) => ({
        name: x.name, alt: (x.alt || []).slice(0, 2),
        configs: x.configs, records: x.records, tier: x.tier, bestLabel: x.bestLabel,
        gpus: (x.gpus || []).slice(0, 3),
        libId: x.libId, libTitle: x.libTitle, libCover: x.libCover, libUrl: x.libUrl,
        sources: x.sources,
      })),
    };
  } catch (e) { mobile = { count: 0, items: [], error: e.message }; }

  /* ③ 修改器（不限定「已匹配端游库」，搜得到就该能看到） */
  let trainer = { count: 0, items: [] };
  try {
    const r = trainers.list({ q: exp.q, stats: 'all', sort: 'lib', limit });
    trainer = {
      count: r.total,
      items: (r.items || []).map((x) => ({
        name: x.name, zh: x.zh, version: x.version, source: x.source,
        libId: x.libId, libTitle: x.libTitle, libCover: x.libCover,
      })),
    };
  } catch (e) { trainer = { count: 0, items: [], error: e.message }; }

  /* ④ 云存档（默认口径放开到全量，避免「搜到了却没有」） */
  let save = { count: 0, items: [] };
  try {
    const r = saves.list({ q: exp.q, stats: 'all', sort: 'paths', limit });
    save = {
      count: r.total,
      items: (r.items || []).map((x) => ({
        name: x.name, title: x.title, phone: x.phone,
        paths: (x.paths || []).slice(0, 1).map((p) => p.shown),
        pathCount: (x.paths || []).length, regCount: (x.regs || []).length,
        cloud: x.cloud, steamId: x.steamId,
        libId: x.libId, libCover: x.libCover, mobK: x.mobK,
      })),
    };
  } catch (e) { save = { count: 0, items: [], error: e.message }; }

  res.json({ ok: true, q: raw, aliasNote, pc, mobile, trainer, save });
});

// GET /api/library/go?q= — 直达库中最匹配记录的详情(供搜索直达)
app.get('/api/library/go', (req, res) => {
  const q = String(req.query.q || '').trim();
  const exp = expandAlias(q);
  const r = exp.q ? gamesDb.search(exp.q, 5) : { items: [] };
  const best = r.items[0] || null;
  res.json({ ok: true, q, aliasNote: exp.alias ? { alias: exp.alias, to: exp.q } : null, best: best ? { title: best.title, url: best.url, source: best.source, cover: best.cover } : null });
});

// GET /api/library/item?id=xd-3887 — 按 id 取本地库单条(供手机库卡片点封面直达详情)
// 手机两库(社区配置/实测配置)的卡片只持有匹配到的本地库 id，详情统一走这里 → /api/detail
app.get('/api/library/item', (req, res) => {
  const id = String(req.query.id || '').trim();
  if (!id) return res.status(400).json({ ok: false, error: '缺少参数 id' });
  const it = gamesDb.byIdGet(id);
  if (!it) return res.status(404).json({ ok: false, error: '本地库未收录该 id' });
  res.json({ ok: true, item: withBh(it) });
});

// GET /api/library/index/state — 索引状态(断点/校准/机地同步)
app.get('/api/library/index/state', (_req, res) => {
  res.json({ ok: true, state: idxState, run: indexRun, runJ: jidiRun });
});

// POST /api/library/index?start=1&end=30 — 手动指定范围(调试用,不动断点)
app.post('/api/library/index', async (req, res) => {
  if (busyRun()) return res.status(409).json({ ok: false, error: '索引任务进行中', running: true });
  let start = Math.max(1, parseInt(req.query.start || '1', 10) || 1);
  let end = Math.min(parseInt(req.query.end || '30', 10) || 30, 1000);
  if (start > end) [start, end] = [end, start];
  startXdTask(start, end, 'manual');
  res.json({ ok: true, message: `手动索引任务已开始：第 ${start}-${end} 页`, running: true });
});

// POST /api/library/index/incr?pages=10 — 增量:抓最近 N 页(头部新更),记录 lastIncrAt
app.post('/api/library/index/incr', async (req, res) => {
  if (busyRun()) return res.status(409).json({ ok: false, error: '索引任务进行中', running: true });
  const pages = Math.min(Math.max(1, parseInt(req.query.pages || '10', 10) || 10), 30);
  let max = pages;
  try { max = await indexer.maxXdPages(); } catch (e) { /* 探测失败仍按 pages 抓 */ }
  const end = Math.min(pages, max);
  startXdTask(1, end, 'incr');
  res.json({ ok: true, message: `增量抓取最近 ${end} 页`, running: true });
});

// POST /api/library/index/calibrate — 校准/断点续跑:
//   ① 有断点(1..maxKnown) → 从断点续跑至最新页  ② 未校准 → 尾页抽查全覆盖即视为已校准, 否则全量补齐
app.post('/api/library/index/calibrate', async (req, res) => {
  if (busyRun()) return res.status(409).json({ ok: false, error: '索引任务进行中', running: true });
  const st = idxState.xdgame;
  try {
    const max = await indexer.maxXdPages();
    if (st.nextPage > 0 && st.nextPage <= max) {
      const t = startXdTask(st.nextPage, max, 'calibrate');
      return res.json({ ok: true, message: `从断点第 ${st.nextPage} 页续跑至第 ${max} 页`, running: true });
    }
    if (st.nextPage === 0 || st.nextPage > max) {
      const lastItems = await indexer.fetchXdPage(max).catch(() => []);
      if (lastItems.length) {
        const miss = lastItems.filter((g) => !gamesDb.byIdGet(g.id)).length;
        if (miss === 0) {
          st.nextPage = max + 1; st.maxKnown = max; st.lastFullAt = Date.now(); st.updatedAt = Date.now();
          saveIdxState();
          return res.json({ ok: true, quick: true, message: `库已校准至第 ${max} 页(尾页抽查全覆盖,无需重跑)`, state: { ...st } });
        }
        st.nextPage = st.nextPage || 1;
        const t = startXdTask(st.nextPage, max, 'calibrate');
        return res.json({ ok: true, message: `检测到尾页存在 ${miss} 条缺口,从第 ${st.nextPage} 页补齐至第 ${max} 页`, running: true });
      }
      st.nextPage = st.nextPage || 1;
      const t = startXdTask(st.nextPage, max, 'calibrate');
      return res.json({ ok: true, message: `开始校准：第 ${st.nextPage}-${max} 页(首次约数分钟,可离开页面)`, running: true });
    }
    return res.json({ ok: true, message: '已校准,无需操作' });
  } catch (e) {
    res.status(502).json({ ok: false, error: '校准失败: ' + e.message });
  }
});

// POST /api/library/index/jidi — 机地双源合并:同步首页 SSR 新游 + 周/月/年热榜去重话题入本地库
app.post('/api/library/index/jidi', (req, res) => {
  if (busyRun()) return res.status(409).json({ ok: false, error: '同步任务进行中(机地/XD 互斥)', running: true });
  const task = { kind: 'jidi', got: 0, added: 0, total: gamesDb.stats().total, startedAt: Date.now(), done: false };
  jidiRun = task;
  res.json({ ok: true, running: true, message: '正在同步机地话题(首页新游+周月年热榜)…' });
  (async () => {
    try {
      const cands = await require('./fetchers/jidi').libraryCandidates();
      const r = gamesDb.upsert(cands);
      gamesDb.persist();
      task.got = cands.length; task.added = r.added; task.total = r.total;
      idxState.jidi = { synced: cands.length, added: r.added, total: r.total, lastSyncAt: Date.now() };
      saveIdxState();
    } catch (e) {
      task.error = String(e.message || e);
    } finally {
      task.done = Date.now();
      setTimeout(() => { if (jidiRun === task) jidiRun = null; }, 15000);
    }
  })();
});

app.get('/api/library/progress', (_req, res) => {
  res.json({ ok: true, run: indexRun, runJ: jidiRun, state: idxState });
});

app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not Found' }));

function listen(port, triesLeft) {
  const srv = app.listen(port, () => {
    console.log(`[GameHub] 聚合站已启动: http://localhost:${port}`);
    console.log(`[GameHub] 数据源: 机地 jidiyouxi.com  |  XDGAME xdgamer.com`);
  });
  srv.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && triesLeft > 0) {
      console.log(`[GameHub] 端口 ${port} 被占用，尝试 ${port + 1} …`);
      listen(port + 1, triesLeft - 1);
    } else {
      console.error('[GameHub] 启动失败:', e.message);
      process.exit(1);
    }
  });
}
listen(PORT, 30);
