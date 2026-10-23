/**
 * GameHub server — 机地 × XDGAME 信息聚合 API
 * 能力：/api/feed 聚合两个源站实时抓取（180s 内存缓存，?refresh=1 强制刷新）
 *      /api/detail?url= 源站详情页实时解析（600s 缓存，域名白名单）
 *      /           静态站点 public/
 */
const path = require('path');
const fs = require('fs');
/* ★ v10.109：临时目录归一 —— 必须在其它 require **之前**执行，
 *   否则先加载的库可能已经缓存了旧的 os.tmpdir()。
 *   用户口径：「后续的 Temp 不要在 C 盘，在项目下的文件夹即可」。
 *   完整背景见 data/runtime-tmp.js 的注释（2026-10-23 C 盘 0 字节导致部署 ENOSPC）。 */
require('./data/runtime-tmp');
const zlib = require('zlib');
const crypto = require('crypto');
const { spawn } = require('child_process');
const express = require('express');
const jidi = require('./fetchers/jidi');
const xdgamer = require('./fetchers/xdgamer');
const download = require('./fetchers/download');
/* ★ v10.91 管理员账号（用户名 + 密码）。模块只在调用时读盘，requiring 本身无副作用。 */
const adminAccount = require('./data/admin-account');
/* ★ v10.25：/api/detail/merged 的截图去重要用**与两个 fetcher 同一份** idOf/merge ——
   抄一份到这里就等于「同一语义两份实现」，下次改尺寸策略必然漂移。 */
const shotsLib = require('./fetchers/shots');
const specDict = require('./data/spec-dict');
const specMatch = require('./data/spec-match');
const extractor = require('./data/extractor');
/* ★ v10.93 云下载引擎：磁力 → 元数据 → 选文件 → 服务端下载 → 保存到电脑。
 *   三个模块都是「加载无副作用」的纯定义（引擎进程懒启动、任务表懒读盘）⇒ 顶层 require 安全。 */
const dlGuard = require('./data/download-guard');
const dlTasks = require('./data/download-tasks');
const dlEngine = require('./data/download-engine');
/* v10.94：零依赖流式 ZIP（store + ZIP64），把「多分卷」一次给用户。
   不用 archiver —— 发布载荷不带 node_modules，多一个依赖就多一个装不上的风险。 */
const zipStream = require('./data/zip-stream');

/* ★ v10.42：端口自增兜底改为「显式开关」，**默认关闭**。
 *   旧行为：`EADDRINUSE ⇒ listen(port + 1, triesLeft - 1)`，最多自增 30 次
 *   （v10.25 的启动器注释里就记着「实测最多 30 次」）。
 *   危害不是「多占一个端口」，而是**让「到底重启了没有」无法判断**：想重启 8123 时端口尚未释放，
 *   于是悄悄起了 8124 副实例 —— 用户看到窗口有日志、浏览器也开了，以为重启成功，
 *   实际 8123 还是旧进程；两个实例共写同一份 `data/**`（本项目多处缓存是「读改写整份 JSON」）
 *   会交叉覆盖；而线上诊断一律以 8123 为准，看到的却是旧代码 ⇒ 排查方向直接跑偏。
 *   确实需要并行跑第二个实例做对照时，显式设 `GAMEHUB_PORT_SHIFT=1`。 */
const ALLOW_PORT_SHIFT = process.env.GAMEHUB_PORT_SHIFT === '1';

const app = express();
/* ★ 端口唯一真源（v10.1）
 *   历史坑：这里原本写 3456，而文件末尾 listen() 里又写了 8123 字面量，两处不一致 ——
 *   接手者读到哪一行就可能得出不同结论，白排查半天。现在统一成本常量，只此一处定义。
 *   实测本机无 PORT 环境变量，所以默认值就是 8123，与启动器 / 文档 / 测试脚本的约定一致。 */
const PORT = parseInt(process.env.PORT, 10) || 8123;

/* ★ v18（2026-10-16，经授权的**最小改动 ①**）：**默认只听回环**。
 *   历史行为：末尾 `app.listen(port)` **没传 host** ⇒ Node 绑 `0.0.0.0`
 *   ⇒ 局域网内任何设备都能访问。而本服务**全站零鉴权 + `ACAO:*`**，
 *   而现在它还要被桌面客户端当**管理页**用（能下载、能解压、能改本机文件）
 *   ⇒ 「管理」能力默认暴露在 LAN 是不能接受的。
 *   逃生开关：确实要用别的设备访问时，显式设 `GAMEHUB_HOST=0.0.0.0`
 *   —— **能力不删，只改默认**（与 v10.42 给端口自增加开关同一思路）。
 *   ⚠️ 桌面客户端（GameIntel.exe）走的就是 `http://127.0.0.1:8123`，不受影响。 */
const HOST = process.env.GAMEHUB_HOST || '127.0.0.1';

/* 进程启动时刻 —— 供 `/api/health` 的实例标识用（比 ts 更能说明「这个实例活了多久」）。 */
const BOOT_AT = Date.now();

// ---------- 内存缓存（支持异步 builder：并发共享同一 Promise，失败自动清理） ----------
const cache = new Map();
/* ★★ v10.76：`ttlMs` 允许传**函数** `(value) => ms` —— 用于「结果**降级**时只短缓存」。
   起因是一次实测：`/api/rank` 首次调用两源并行，机地侧偶发失败 ⇒ 融合退化成「仅 XD」，
   而这份降级结果被 30 分钟 TTL **钉死**（连打三次 `refresh=1` 才恢复 `jidiN=12`）
   ⇒ 用户眼前的「双源加权合并」会静默变成单源，且半小时内无法自愈。
   ★ 一般规律：**降级结果不许按正常 TTL 缓存** —— 失败要能自愈，否则一次抖动 = 长时间错误状态。
   兼容：传数字时行为与改前完全一致（11 个调用点里只有 /api/rank 用了函数形式）。 */
function cached(key, ttlMs, builder) {
  const hit = cache.get(key);
  /* `hit.ttl` 还是函数 = builder 尚在跑（没定型）⇒ 按调用方默认 TTL 判「新鲜」，
     这样并发的第二个请求仍然复用同一个 in-flight promise（与改前行为一致）。
     ★ v10.95 修：TTL 支持**函数形态**后（按结果决定缓存多久），上面那句「按调用方默认
       TTL 判」就落空了 —— `typeof t === 'number'` 为假，会直接走到下面**再建一个 builder**，
       并发去重整段失效（一次弹窗能打出 3 次机地抓取，反而更容易被限流）。
       ⇒ 函数态一律当「还在跑」，直接复用。 */
  if (hit) {
    if (typeof hit.ttl === 'function') return hit.value;
    const t = typeof hit.ttl === 'number' ? hit.ttl : ttlMs;
    if (typeof t === 'number' && Date.now() - hit.ts < t) return hit.value;
  }
  const p = Promise.resolve().then(builder);
  const entry = { ts: Date.now(), value: p, ttl: ttlMs };
  cache.set(key, entry);
  p.then(
    (v) => { if (typeof ttlMs === 'function') entry.ttl = ttlMs(v); },
    () => {
      const cur = cache.get(key);
      if (cur && cur.value === p) cache.delete(key);
    },
  );
  return p;
}

/* ★★ v10.76：给「**某一侧**源站」加硬超时，防慢/挂的那一侧把整个接口拖住。
   实测起因：机地上游被阿里云 WAF 拦住后 `jidi.hotRanks()` 不再「快速失败」而是**挂着** ——
   `getHtml` 是 `timeout 20s × (1 + 1 次重试)` ⇒ 最坏 **40s**，而 `/api/rank` 用 `Promise.allSettled`
   等的是**最慢**的那一侧 ⇒ 点「人气榜」后要等 40s 才出结果
   （探针实测：切档 2.6s 后状态行还停在上一档的文案上）。
   ★ 与 allSettled 的关系：超时后该侧只是变成 `rejected`，**走的是同一条降级路径**，
     不另写分支 —— 又因为降级结果只短缓存 120s，源站恢复后 2 分钟内自愈。
   ★ 为什么必须内部挂 catch：`allSettled` 拿到的是**外层 race**，内层若无人处理，
     Node 22 会抛 UnhandledPromiseRejection（默认直接崩进程）。这里用 `p.then(ok, err)` 兜住。 */
function withTimeout(p, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} 超时 ${ms}ms（按降级处理）`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
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

/* JSON 请求体解析（v10.20 新增）
 *   在此之前全站 POST 都不读 body（都是「触发一个动作」型），所以从没配过 parser。
 *   新增的「解包配置分析」要接收用户整份 JSON，故补上。
 *   上限 12MB —— 解包导出的配置可能有几 MB，但不该成为内存攻击面。 */
app.use(express.json({ limit: '12mb' }));

// 默认首页 = 单页聚合主站 public/index.html（内容库合并 + 聚合搜索）
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
/* ---------- 静态 gzip 直出（v10.78，零依赖） ----------
 * 为什么不用 compression 包：部署载荷不带 node_modules（依赖由宿主环境装），
 * 新增 npm 依赖会牵动整条部署链；zlib 是 Node 内置模块，零成本。
 * 命中条件（三条同时满足）：GET · accept-encoding 带 gzip · 同名 .gz 文件真实存在。
 * ★ .gz 的唯一生产者是 tools/gen-roster.js（构建期预压缩），服务端不做实时压缩 ——
 *   「存在才直出」避免任何路径拼接歧义，未命中一律放行给 express.static。
 * ★ 只有 roster 页有 .gz（10.8MB → 传输约 2MB）；其余文件零影响。 */
const PUB_ROOT = path.join(__dirname, 'public');
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (!/\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) return next();
  let p;
  try { p = decodeURIComponent(req.path); } catch (_) { return next(); }
  if (p.endsWith('/')) p += 'index.html';
  const raw = path.join(PUB_ROOT, p);
  if (!raw.startsWith(PUB_ROOT + path.sep)) return next();   // 路径穿越防护
  const gz = raw + '.gz';
  fs.stat(gz, (err, st) => {
    if (err || !st.isFile()) return next();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    fs.createReadStream(gz).pipe(res);
  });
});
/* ★ v10.96：`/favicon.ico` 回 204 而不是 404。
 *
 * 页面 head 里已经有内联 SVG 的 icon（v10.71），但**部分浏览器仍会额外请求
 * 根目录的 /favicon.ico**（书签栏、PWA 安装、部分 Chromium 版本的预取）。
 * 静态目录里没有这个文件 ⇒ 每个访问者的控制台都挂一条 404 红字，
 * 而它**不是缺陷**、也没法从 HTML 侧消除。204 是「我知道，但这里没有」的正确回答。
 *
 * 全模块抽样时这条 404 是唯一一条「页面错误」，会掩盖真正的 JS 报错 —— 所以必须清掉。
 */
app.get('/favicon.ico', (_req, res) => res.status(204).end());

/* ★ v10.105：线上容器里躺着一个**本仓库从未有过**的文件 `public/overview.html`。
 * 怎么发现的：新加的 `/api/build` 自报线上 7 个 html，其中 `overview.html`（16,319B）
 *   在本地源码、载荷目录、`git log --all` 里**三处都不存在**，但线上 HTTP 200 且内容完整
 *   （一个「规模速览 / 功能 / 数据源」的旧总览页，数字还是 19,397 / 8,943 那套旧口径）。
 * 根因：发布是「保留 + 覆盖」——文件一旦进了容器，就再没有代码路径去删它；
 *   而仓库里对它的引用是 **0**（grep 全站 + 全历史均无）⇒ 没人会发现它还在。
 * 处理：显式 410，让**对外表现与仓库一致**。容器里的物理文件删不掉，但不该再被访问到。
 * ★ 名单只有这一份：410 路由与 `/api/build` 的扫描共用它 ——
 *   两处各写一份的话，自证端点会永远报「线上比本地多一页」，然后下一个人又去查一遍。
 * ⚠️ 若将来真要恢复这个页面，先把它作为源文件提交进 `public/`，再从名单里删掉。 */
const DEAD_PAGES = new Set(['overview.html']);
DEAD_PAGES.forEach((f) => {
  app.get('/' + f, (_req, res) => {
    res.status(410).type('text/plain; charset=utf-8')
      .send(f + ' 已下线：该页从未存在于本仓库，是线上容器的残留文件。');
  });
});

app.use(express.static(path.join(__dirname, 'public')));
// 旧版多页路由收敛：home/search/library 已并入单页主站,老链接 301 至首页
app.get(['/home.html', '/search.html', '/library.html'], (_req, res) => res.redirect(301, '/'));
/* ★ v10.87 管理后台路由：express.static 只认精确路径（/admin/ 会找 admin/index.html 而 404），
 *   显式映射到 public/admin.html —— /admin 与 /admin/ 双形态都收。 */
app.get(['/admin', '/admin/'], (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true, ts: Date.now(), ttl: { feed: 180, detail: 600 },
    /* ★ v18（2026-10-16，经授权的**最小改动 ②**）：实例标识。
     *   为什么要：桌面客户端（GameIntel.exe）会 `fork` 本服务，但它启动时**先探活**
     *   （`/api/health` 通就**复用**、不 fork）⇒ 客户端原有信息分不清眼前这个实例
     *   「是我拉起来的」还是「用户自己早就跑着的」。原先客户端 fork 时设了
     *   `GAMEHUB_SHELL=1`，但**本文件从未读取过它** ⇒ 标记是单向的、等于没有。
     *   现在把 `pid` / `startedAt` / `shell` 一并回出去：
     *     · 客户端拿 `pid` 与自己的 `child.pid` 比对 ⇒ 能确证归属；
     *     · 复用外部实例时 `shell=false` ⇒ 客户端如实标成「外部实例」，不冒认。
     *   ⚠️ 只增字段，**不删不改** `ok` / `ts` / `ttl` —— 老调用方零影响。 */
    pid: process.pid,
    startedAt: BOOT_AT,
    shell: process.env.GAMEHUB_SHELL === '1',
    host: HOST,
    port: PORT,
  });
});

/* ★ v10.105：版本自证端点。
 * 为什么需要：判「线上是不是最新版」按铁律必须比 md5，而不是看 HTTP 200。
 * 但本机 shell 常常出不了网（DNS 直连不通、代理对发布域名 502），
 * 于是「拉线上文件算 md5」这条路在发布机上是断的 —— 每次只能改用人眼比页面特征，等于没验。
 * 改成让**线上自己报**：启动时把 public/*.html 的 md5 与字节数算好缓存在内存里，
 * 任何人（含 WebFetch 这类只走 Agent 网络的通道）都能拉到精确值，与本地文件对一遍即可判版。
 * ⚠️ 只回文件名 / md5 / 字节数，不含任何路径与内容，公开无风险。 */
const BUILD_STAMP = (() => {
  const dir = path.join(__dirname, 'public');
  const out = {};
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.html')) continue;
      /* 已下线的幽灵页不计入：它们只存在于容器磁盘上，出现在自证清单里会让
       * 「线上 vs 本地」永远差一页，把真正的版本差异埋掉。 */
      if (DEAD_PAGES.has(f)) continue;
      const buf = fs.readFileSync(path.join(dir, f));
      out[f] = { md5: crypto.createHash('md5').update(buf).digest('hex').slice(0, 10), bytes: buf.length };
    }
  } catch (e) {
    out._error = String(e && e.message || e);
  }
  return out;
})();
app.get('/api/build', (_req, res) => {
  res.set('cache-control', 'no-store');
  res.json({ ok: true, bootAt: BOOT_AT, files: BUILD_STAMP });
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

/* ================= 🔀 双源详情合并（v10.25 新增） =================
 * 用户口径：「双源有则合并去重显示」。
 *
 * ★ 实测字段互补性（2026-09-20，8 款双源游戏逐个比对 /api/detail）：
 *     字段            机地             XDGAME
 *     游戏截图        6~9 张           5~8 张      ← 同一套 Steam CDN ⇒ 可**去重相加**
 *     PC 配置要求     **有**（最低）    **无**
 *     版本介绍        **无**           **有**      ← 机地页面**从来没有**版本介绍块
 *     游戏介绍        有               有
 *   8 款里 7 款有孪生条目（f12=「无」的那款是黑神话）⇒ 合并的收益是实打实的。
 *
 * ★ 为什么放在服务端，而不是前端拿到两份 detail 自己拼：
 *   ① 去重口径必须与 `fetchers/shots.js` 的 `idOf` **同处一地**（项目铁律 10：
 *      同一语义只留一份实现）。前端拿不到那个模块，抄一份到浏览器必然漂移 ——
 *      而这里的代价是「同一张图出现两次」，肉眼很难发现。
 *   ② 前端「先渲染再补丁」要防「等待期间用户点了下一款游戏」的竞态；
 *      服务端一次给全，没有这个窗口。
 *   ③ 两源都走 `cached(600s)`，第二次打开同一款游戏零成本。
 *
 * ★ 刻意**不做**的合并（都是试过之后否掉的，不是没做）：
 *   · **游戏介绍不做拼接**：两边是同一段文案（长度相近、差异只在排版与本作别名），
 *     拼起来用户看到的是两段几乎一样的话。这类字段的正确做法是「一边有就用那边」。
 *   · **配置要求不做字段级合并**：机地给的是**一整组** `{os,cpu,ram,gpu,storage}`，
 *     没有「最低/推荐」之分；Steam 给的是 `{min,rec}` 两栏。两套结构对不上，
 *     硬合会让这张表变成三种颜色的补丁。⇒ 配置要求的双源合并放在前端
 *     `loadReqBlock`：源站那组当「最低配置」，再向 Steam 补一栏「推荐配置」。
 *
 * 返回：与 /api/detail 同形状的 `detail`（合并后）+ `merge` 溯源块
 *   merge = { on, twin:{source,url,title}, sources:[...], shotsAdded, filled:[...] }
 *   前端只按 `merge` 显示小徽标，**不再自己判**哪些字段是补来的。
 */
app.get('/api/detail/merged', async (req, res) => {
  const target = parseDetailUrl(String(req.query.url || ''));
  if (!target) return res.status(400).json({ ok: false, error: '仅支持机地/XDGAME 详情页链接' });
  if (req.query.refresh === '1') cache.delete('detail:' + target.source + ':' + (target.host || '') + ':' + target.id);
  const loadOne = (t) => cached(
    'detail:' + t.source + ':' + (t.host || '') + ':' + t.id, 600_000,
    () => (t.source === 'jidi'
      ? jidi.detail(t.id)
      : xdgamer.detail(t.id, t.host === 'xdgame.com' ? 'https://www.xdgame.com' : undefined))
  );
  try {
    const d = await loadOne(target);
    const merged = Object.assign({}, d);
    const prov = { on: false, twin: null, sources: [d.source], shotsAdded: 0, filled: [], idOk: false };

    /* 孪生条目：**复用 /api/library/twin 的同一份对齐逻辑**（data/twin.js），
       不在这里另写一套名称匹配 —— 那正是 v10.18 串台两次的根因。
     *
     * ★ 防串台闸门（PITFALLS #11 口径：宁可退回「未合并」，也不安一条错的内容）
     *   `xd-<URL 里的数字>` 与库内 id 实测 20/20 一致，但**不能只靠这个假设**：
     *   twinOf 内部是 `gamesDb.byIdGet(id)`，只要这个 id 落在**别的条目**上，
     *   它会自信地返回那款游戏的机地详情页 —— 表现是「截图 / 版本介绍里混进了
     *   另一款游戏的内容」，界面完全正常、零报错，是最难发现的一类错。
     *   ⇒ 闸门设在**「这个 id 可不可信」**这一步：byIdGet 回来标题对不上就不带 id 去问，
     *      退到纯名称匹配（那条路 twinOf 内部自带 sameGame + 打分闸门）。
     *
     * ⚠️ 一开始我把闸门设在**twin 的标题复核**上，实测**误杀 10%（5/50）**且几乎全是
     *   真同款，已改掉：
     *     · 机地话题标题是**纯英文**时（`Dinocop` / `nophenia`），splitName 把它归进 zh 段，
     *       与当前标题的中文段自然对不上；
     *     · `Train Sim World® 7` 的 `®` 不在 twin.js 的 normTitle 清洗范围内。
     *   教训：闸门要设在**能证伪的那一步**（id → 记录 是一一对应的，可精确验证），
     *   设在模糊的标题相似度上就变成「宁可错杀」了。
     */
    const libId = (target.source === 'jidi' ? 'jidi-' : 'xd-') + target.id;
    let idOk = false;
    try {
      const rec = gamesDb.byIdGet(libId);
      idOk = !!(rec && rec.title && twin.sameGame(d.title || '', rec.title));
    } catch (e) { idOk = false; }
    /* 排查用：id 假设不成立时把推出来的 id 记下来（前端不显示，只在 /api/detail/merged 的
       merge 块里可见）—— 出现这条就说明 URL 里的数字与库内 id 不再一一对应，
       要么是上游改了 URL 规则、要么是库内 id 生成规则变了，两种都得查。 */
    if (!idOk) prov.idMismatch = libId;
    let tw = null;
    try { tw = twin.twinOf({ id: idOk ? libId : '', title: d.title || '', src: target.source }); } catch (e) { tw = null; }
    prov.idOk = idOk;

    if (tw && tw.url) {
      prov.twin = { source: tw.source, url: tw.url, title: tw.title || '' };
      const tt = parseDetailUrl(tw.url);
      let t2 = null;
      if (tt) { try { t2 = await loadOne(tt); } catch (e) { t2 = null; } }
      /* 只要拿到另一源**不同源**的详情，就算合并成立（哪怕一个字段都没补到）——
         前端靠 merge.on 决定要不要显示「已合并 N 张截图」这类小结。 */
      if (t2 && t2.source !== d.source) {
        prov.on = true;
        prov.sources.push(t2.source);

        /* ① 截图：去重相加 */
        const m = shotsLib.merge(d.shots, t2.shots, 24);
        const had = Array.isArray(d.shots) ? d.shots.length : 0;
        if (m.length > had) { merged.shots = m; prov.shotsAdded = m.length - had; }

        /* ② 版本介绍：一边没有就整段拿另一边的（XD 有、机地没有） */
        if (!merged.version && t2.version) { merged.version = t2.version; merged.versionFrom = t2.source; prov.filled.push('version'); }

        /* ③ 游戏介绍：同上，**不拼接**（理由见文件头） */
        if (!(merged.desc || merged.description) && (t2.desc || t2.description)) {
          merged.desc = t2.desc || null; merged.description = t2.description || null;
          merged.descFrom = t2.source; prov.filled.push('desc');
        }
      }
    }
    /* ★ v10.90：人工资料覆盖层**最后**叠上去 —— 详情页的标题/封面/简介/厂商/发售日
     *   以管理页填的为准。只在该 URL 推出的库内 id 可信（idOk）时才叠：
     *   id 不可信时宁可用爬虫原值，也不把 A 游戏的资料贴到 B 游戏上。
     *   前端靠 `merge.profile` 决定要不要显示「含人工资料」小徽标。 */
    prov.profile = [];
    if (idOk) {
      const p = gameProfile.get(libId);
      if (p) {
        if (p.title) merged.title = p.title;
        if (p.cover) merged.cover = p.cover;
        if (p.intro) { merged.desc = p.intro; merged.description = p.intro; merged.descFrom = 'profile'; }
        if (p.developer) merged.developer = p.developer;
        if (p.publisher) merged.publisher = p.publisher;
        if (p.releaseDate) merged.releaseDate = p.releaseDate;
        if ((p.genres || []).length) merged.genres = p.genres;
        prov.profile = Object.keys(p).filter((k) => k !== 'updatedAt');
      }
    }
    res.json({ ok: true, fetchedAt: Date.now(), detail: merged, merge: prov });
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
      const data = await cached(key, searchCacheTtl, async () => {
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
              ? { ok: true, count: xdR.value.length, items: withNKeys(xdR.value) }
              : { ok: false, error: String(xdR.reason && xdR.reason.message || xdR.reason), items: [] },
            jidi: jiR.status === 'fulfilled'
              ? { ok: true, count: jiR.value.length, mode: 'real', items: withNKeys(jiR.value) }
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
    const data = await cached('search:' + q, searchCacheTtl, async () => {
      const [xdR, jidiR] = await Promise.allSettled([xdgamer.search(q), jidi.search(q)]);
      return {
        q, aliasNote, fetchedAt: Date.now(),
        searchUrl: {
          jidi: 'https://jidiyouxi.com/search?keyword=' + encodeURIComponent(q),
          xdgamer: 'https://www.xdgamer.com/search/' + encodeURIComponent(q) + '.html',
        },
        sources: {
          xdgamer: xdR.status === 'fulfilled'
            ? { ok: true, count: xdR.value.length, items: withNKeys(xdR.value) }
            : { ok: false, error: String(xdR.reason && xdR.reason.message || xdR.reason), items: [] },
          jidi: jidiR.status === 'fulfilled'
            ? { ok: true, count: jidiR.value.matched.length, indexed: jidiR.value.indexed, items: withNKeys(jidiR.value.matched) }
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
// GET /api/cold/stats — 冷门隐藏口径自证（v10.84）：现测规则命中数/豁免数，数字不写死
app.get('/api/cold/stats', (_req, res) => {
  res.json({ ok: true, ...coldHide.stats(gamesDb.all()) });
});

/* ═══ v10.109 新游检测（用户需求 ④）══════════════════════════════════
 * 用户口径：「我还想增加一个入口，就是新游检测（遇到新游戏则在这里，我来决定是入库）」
 *   · 判定「新」= 源站出现了、库里没有的（按 id 差集，不看日期字段）
 *   · 「入库」  = 写进库 + 强制可见 + 尝试补详情资料
 *
 * ★ 全部走 adminGuard：候选池里是**未发布的源站条目**，公开出去等于把别人的新游
 *   列表直接搬过来当自己的（而且这些条目还没经过任何人工核对）。
 * ★ scan 是唯一会发外部网络请求的端点 ⇒ 有并发锁（模块内 scanning 标志），
 *   否则连点两下会同时抓 3 页、把源站当压测目标。 */
app.get('/api/admin/new-games', (req, res) => {
  if (!adminGuard(req, res)) return;
  try {
    res.json({
      ok: true,
      ...newGames.list({
        status: String(req.query.status || 'pending'),
        q: String(req.query.q || ''),
        limit: req.query.limit,
        offset: req.query.offset,
      }),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: '读候选池失败: ' + e.message });
  }
});

app.post('/api/admin/new-games/scan', async (req, res) => {
  if (!adminGuard(req, res)) return;
  try {
    const r = await newGames.scan({ pages: (req.body || {}).pages });
    appendAdminLog({ ts: Date.now(), id: '-', title: '新游扫描', op: 'ng-scan', via: req._adminVia || 'unknown' });
    res.json(r);
  } catch (e) {
    /* 并发扫描 / 网络失败都走这里。409 让前端能区分「稍后再试」与「真坏了」。 */
    const busy = /进行中/.test(String(e && e.message));
    res.status(busy ? 409 : 500).json({ ok: false, error: String((e && e.message) || e) });
  }
});

app.post('/api/admin/new-games/admit', async (req, res) => {
  if (!adminGuard(req, res)) return;
  const ids = [].concat((req.body || {}).ids || (req.body || {}).id || [])
    .map(String).filter((x) => /^(xd|jidi)-[A-Za-z0-9_-]+$/.test(x));
  if (!ids.length) return res.status(400).json({ ok: false, error: 'id 不合法（仅支持 xd-*/jidi-*）' });
  try {
    const r = await newGames.admit(ids);
    for (const id of r.admitted) {
      const g = gamesDb.byIdGet(id);
      appendAdminLog({ ts: Date.now(), id, title: g ? g.title : '', op: 'ng-admit', via: req._adminVia || 'unknown' });
    }
    /* 新条目的资源情况还没算过 —— 让冷门判定的资源表作废，下一次请求重新算 */
    coldHide.reload();
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: '入库失败: ' + e.message });
  }
});

app.post('/api/admin/new-games/ignore', (req, res) => {
  if (!adminGuard(req, res)) return;
  const ids = [].concat((req.body || {}).ids || (req.body || {}).id || []).map(String);
  if (!ids.length) return res.status(400).json({ ok: false, error: '缺 id' });
  try {
    const r = newGames.ignore(ids, (req.body || {}).note);
    for (const id of r.ignored) {
      appendAdminLog({ ts: Date.now(), id, title: '', op: 'ng-ignore', via: req._adminVia || 'unknown' });
    }
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: '忽略失败: ' + e.message });
  }
});

/* 候选池的轻量统计（后台侧栏角标用，不带条目） */
app.get('/api/admin/new-games/stats', (req, res) => {
  if (!adminGuard(req, res)) return;
  res.json({ ok: true, ...newGames.stats() });
});

/* 恢复：已忽略 / 已入库 → 待处理（用户改主意）。
 * ★ 只改候选池状态，**不回滚已写进库的数据** —— 见 data/new-games.js 的 restore 注释。 */
app.post('/api/admin/new-games/restore', (req, res) => {
  if (!adminGuard(req, res)) return;
  const ids = [].concat((req.body || {}).ids || (req.body || {}).id || []).map(String);
  if (!ids.length) return res.status(400).json({ ok: false, error: '缺 id' });
  try {
    const r = newGames.restore(ids);
    for (const id of r.restored) {
      appendAdminLog({ ts: Date.now(), id, title: '', op: 'ng-restore', via: req._adminVia || 'unknown' });
    }
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: '恢复失败: ' + e.message });
  }
});

/* ── v10.85 管理页豁免接口（roster 行内「隐藏/显示」按钮的数据面）──
 * GET  /api/admin/hide-overrides              → 当前豁免清单
 * POST /api/admin/hide-overrides {id, op}     → 写 data/hide-overrides.json 旁路文件
 *   op = 'show'（强制显示）/ 'hide'（强制隐藏）/ 'clear'（清除豁免，回到规则判定）
 *   写入后即时生效（cold-hide 的 set 在内存里同步改，gamesDb.applyOpts 的钩子下一拍就是新值）。
 * ★ 仅接受本机回环来源：线上部署在反代后面，remoteAddress 是代理 ⇒ 403。
 *   管理动作是写文件，绝不能暴露给公网访客。 */
function adminLocalOnly(req, res) {
  const ip = String((req.socket && req.socket.remoteAddress) || '');
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true;
  res.status(403).json({ ok: false, error: '管理接口仅限本机使用（8123/8124 回环）' });
  return false;
}

/* ── v10.87 管理鉴权双轨：回环 OR 令牌 ──
 *   v10.85 的 adminLocalOnly 只有回环一条路，线上（反代后 remoteAddress 不是回环）
 *   一律 403 ⇒ 线上管理页只读。用户拍板放开线上管理 ⇒ 加 X-Admin-Token 第二条轨：
 *   · 令牌真源：env GAMEHUB_ADMIN_TOKEN > data/admin-token.json（.gitignore，随载荷上线）
 *   · 每请求现读文件（几行 JSON，开销可忽略）⇒ 改令牌不用重启
 *   · adminLocalOnly 函数**保留**（test-roster J15.4 断言它存在 + 回环语义不变），
 *     回环放行走它，令牌校验走这里 —— 双轨互不影响。
 *   ★ POST 写文件仍走这层护栏：公网访客没有令牌就是 403，与 v10.85 语义向后兼容。 */
function adminToken() {
  if (process.env.GAMEHUB_ADMIN_TOKEN) return String(process.env.GAMEHUB_ADMIN_TOKEN);
  try {
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'admin-token.json'), 'utf8'));
    return typeof j.token === 'string' && j.token ? j.token : null;
  } catch (e) { return null; }
}
/* ── v10.91 登录会话（用户名 + 密码 ⇒ 会话 id）──
 *   为什么用「内存会话 + 随机 id」而不是把用户名密码塞进前端：
 *   前端硬编码校验等于把密码公开（任何人 View Source 就拿到），所以口令只在服务端比对，
 *   浏览器只持有一个**随机串**，它本身没有任何信息量。
 *   · 会话存在**进程内存**：重启 / 发布后全部失效 ⇒ 需要重新登录一次（宁可这样，
 *     也不把会话写盘：写盘就等于再造一份凭据文件）。
 *   · 三通道取 sid：`X-Admin-Session` 头 > `gh_sid` Cookie > `?sid=` / body.sid
 *     （与令牌同一取舍：反代可能剥头，Cookie 又可能被同站策略挡掉）。
 *   · Cookie 走 HttpOnly + SameSite=Lax：正常浏览器路径下 JS 根本拿不到它，减少 XSS 风险。 */
const SESSIONS = new Map();          /* sid -> { user, exp } */
const SESS_COOKIE = 'gh_sid';
const SESS_TTL = 30 * 24 * 3600 * 1000;
const LOGIN_FAIL = new Map();        /* ip -> [失败时间戳] */
const LOGIN_MAX = 8;                 /* 10 分钟内最多失败 8 次 */
const LOGIN_WIN = 10 * 60 * 1000;

function newSid() { return crypto.randomBytes(24).toString('hex'); }
function cookieOf(req, name) {
  const raw = String(req.headers.cookie || '');
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch (e) { return part.slice(i + 1).trim(); }
    }
  }
  return '';
}
function sidOf(req) {
  return String(req.headers['x-admin-session']
    || cookieOf(req, SESS_COOKIE)
    || (req.query && req.query.sid)
    || (req.body && req.body.sid)
    || '');
}
function sessOf(req) {
  const sid = sidOf(req);
  if (!sid) return null;
  const s = SESSIONS.get(sid);
  if (!s) return null;
  if (s.exp < Date.now()) { SESSIONS.delete(sid); return null; }
  return { sid, user: s.user, exp: s.exp };
}
function pruneSessions() {
  const now = Date.now();
  for (const [k, v] of SESSIONS) if (v.exp < now) SESSIONS.delete(k);
  for (const [k, arr] of LOGIN_FAIL) {
    const keep = (arr || []).filter((t) => now - t < LOGIN_WIN);
    if (keep.length) LOGIN_FAIL.set(k, keep); else LOGIN_FAIL.delete(k);
  }
}
function loginThrottle(ip) {
  const now = Date.now();
  const list = (LOGIN_FAIL.get(ip) || []).filter((t) => now - t < LOGIN_WIN);
  LOGIN_FAIL.set(ip, list);
  if (list.length >= LOGIN_MAX) {
    return { ok: false, wait: Math.max(1, Math.ceil((LOGIN_WIN - (now - list[0])) / 1000)) };
  }
  return { ok: true };
}
function loginFailed(ip) {
  const l = LOGIN_FAIL.get(ip) || [];
  l.push(Date.now());
  LOGIN_FAIL.set(ip, l);
  if (LOGIN_FAIL.size > 5000) pruneSessions();
}
function clientIp(req) {
  /* ★ 必须优先取 `X-Forwarded-For`：线上所有请求的 socket 对端都是反代（同一个地址），
   *   只按 socket 计数 ⇒ **一个人爆破就把所有人一起锁在外面**（本机实测踩到：
   *   脚本连错 8 次之后，浏览器用正确密码登录也吃 429）。
   *   取第一段（最靠近用户的那个地址）。 */
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (xff) return xff;
  return String((req.socket && req.socket.remoteAddress) || '') || 'unknown';
}

/* 全站兜底：XFF 可以伪造 ⇒ 按 IP 限流本身可被绕过。
 * 加一道「全站失败总数」闸门，防止无限次爆破；阈值取高（500/10min），
 * 正常使用永远碰不到，只有真的在被爆破时才会触发。 */
let GLOBAL_FAIL = [];
function globalBlocked() {
  const now = Date.now();
  GLOBAL_FAIL = GLOBAL_FAIL.filter((t) => now - t < LOGIN_WIN);
  return GLOBAL_FAIL.length >= 500;
}
function globalFailed() {
  const now = Date.now();
  GLOBAL_FAIL = GLOBAL_FAIL.filter((t) => now - t < LOGIN_WIN);
  GLOBAL_FAIL.push(now);
}

/* ★★ v10.87.1 修正：回环豁免必须排除「经反代而来」的请求。
 *   首发上线实测到真漏洞：线上反代把 socket 对端变成回环，只判 IP 的结果是
 *   `GET /api/admin/log`、`GET /api/admin/hide-overrides` 无令牌直接 200 ——
 *   连 POST 写豁免也一起裸奔到公网。判据改成三条件**全部成立**才免令牌：
 *     ① socket 对端是回环   ② Host 是本地三形态（localhost/127.0.0.1/[::1]）
 *     ③ 没有任何转发头（反代必带 X-Forwarded-* / Forwarded；本地直连没有）
 *   任何一条不成立 ⇒ 走令牌轨。
 * ★ 令牌取三通道：X-Admin-Token 头 > ?token= > body.token。
 *   为什么不止头一条：反代有可能剥自定义头，头被剥时后两条还能通；
 *   前端策略是「先只发头，403 才降级带 query/body」——正常路径不把令牌写进 URL。 */
function adminGuard(req, res) {
  const ip = String((req.socket && req.socket.remoteAddress) || '');
  const isLoop = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  const host = String(req.headers.host || '').toLowerCase();
  const hostLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const fwd = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.headers['forwarded']
    || req.headers['x-forwarded-host'] || req.headers['cf-connecting-ip'];
  if (isLoop && hostLocal && !fwd) { req._adminVia = 'loopback'; return true; }
  /* v10.91：登录会话 —— 人用的通道（账号密码换来的随机 sid）。 */
  const s = sessOf(req);
  if (s) { req._adminVia = 'session'; req._adminUser = s.user; return true; }
  /* 令牌通道保留：抓取脚本 / verify-online / 各测试套件靠它做无头鉴权。 */
  const tok = adminToken();
  const given = String(req.headers['x-admin-token']
    || req.query.token
    || (req.body && req.body.token)
    || '');
  if (tok && given && given === tok) { req._adminVia = 'token'; return true; }
  res.status(403).json({
    ok: false,
    needAuth: true,
    error: '管理接口需要登录管理员账号（/admin 右上角「登录」），或本机回环直连',
  });
  return false;
}

/* ── v10.87 管理操作日志：data/admin-log.jsonl 追加（一行一条 JSON）──
 *   为什么 jsonl 不 json：追加写 O(1)，读「最近 N 条」只 tail，不用整读整写。
 *   写失败不阻断主流程（日志是附属品，豁免本身已落盘）。 */
const ADMIN_LOG_PATH = path.join(__dirname, 'data', 'admin-log.jsonl');
function appendAdminLog(entry) {
  try {
    fs.appendFileSync(ADMIN_LOG_PATH, JSON.stringify(entry) + '\n');
  } catch (e) { /* 日志失败不阻断 */ }
}
function readAdminLog(limit) {
  let lines = [];
  try { lines = fs.readFileSync(ADMIN_LOG_PATH, 'utf8').split('\n').filter(Boolean); } catch (e) { /* 无日志文件 = 空清单 */ }
  const n = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
  const items = [];
  for (let i = lines.length - 1; i >= 0 && items.length < n; i--) {
    try { items.push(JSON.parse(lines[i])); } catch (e) { /* 坏行跳过 */ }
  }
  return { ok: true, total: lines.length, items };
}

app.get('/api/admin/hide-overrides', (req, res) => {
  if (!adminGuard(req, res)) return;
  res.json({ ok: true, overrides: coldHide.overridesSnapshot() });
});
app.post('/api/admin/hide-overrides', (req, res) => {
  if (!adminGuard(req, res)) return;
  const { id, op } = req.body || {};
  if (!/^(xd|jidi)-[A-Za-z0-9_-]+$/.test(String(id || ''))) {
    res.status(400).json({ ok: false, error: 'id 不合法（仅支持库内 xd-*/jidi-* 条目）' });
    return;
  }
  if (!['show', 'hide', 'clear'].includes(String(op))) {
    res.status(400).json({ ok: false, error: "op 必须是 show/hide/clear" });
    return;
  }
  try {
    const overrides = coldHide.setOverride(String(id), String(op));
    const hidden = coldHide.hiddenById(String(id), gamesDb.all());
    const g = gamesDb.byIdGet(String(id));
    /* v10.87：操作留痕 —— 谁（回环/令牌）在什么时候对哪条做了什么，追加进 admin-log.jsonl
     *   via 取 adminGuard 判定的结果，不在这里重判 IP（否则反代下会把令牌操作误记成 loopback）。 */
    appendAdminLog({
      ts: Date.now(), id: String(id), title: g ? g.title : '',
      op: String(op), hidden: !!hidden,
      via: req._adminVia || 'unknown',
    });
    res.json({ ok: true, id, op, hidden, overrides });
  } catch (e) {
    res.status(500).json({ ok: false, error: '写豁免失败: ' + e.message });
  }
});
/* ── v10.88 POST /api/admin/note ── 备注编辑（管理后台唯一的「内容编辑」）
 *   body: { id, note }  note 空串 = 删除
 *   为什么单独一个文件而不混进 hide-overrides：豁免是行为（改列表结果），备注是标注（零副作用），
 *   两者语义不同、回滚粒度也不同。 */
app.post('/api/admin/note', (req, res) => {
  if (!adminGuard(req, res)) return;
  const { id, note } = req.body || {};
  if (!/^(xd|jidi)-[A-Za-z0-9_-]+$/.test(String(id || ''))) {
    return res.status(400).json({ ok: false, error: 'id 不合法（仅支持库内 xd-*/jidi-* 条目）' });
  }
  if (String(note || '').length > 500) {
    return res.status(400).json({ ok: false, error: '备注最长 500 字' });
  }
  try {
    const saved = gameNotes.set(String(id), note);
    const g = gamesDb.byIdGet(String(id));
    appendAdminLog({
      ts: Date.now(), id: String(id), title: g ? g.title : '',
      op: saved.note ? 'note' : 'note-clear', via: req._adminVia || 'unknown',
    });
    res.json({ ok: true, id: saved.id, note: saved.note, noteCount: gameNotes.count() });
  } catch (e) {
    res.status(500).json({ ok: false, error: '写备注失败: ' + e.message });
  }
});

/* ── v10.87 管理后台三端点 ──
 * GET /api/admin/overview  → 页头统计卡一次拿全（冷门口径 + 库构成 + 六个资源源 stats）
 *   为什么不复用六七个零散 stats 端点：管理页首屏要 7 个数字，7 次往返不如 1 次；
 *   全部来自内存表现算，零额外成本。读接口不设防（数据本就公开，/api/*stats 一直可读）。
 *   ★★ v10.88.1 复核：**本端点只回聚合计数，不含任何备注正文** ⇒ 保持公开；
 *   但同批加的 `state.note`（/api/admin/game）与 browse `?admin=1` 的行回填都会带出
 *   备注原文，那两处已升为 adminGuard（**铁律 161**）。
 * GET /api/admin/log?limit= → 最近 N 条管理操作（写接口，设防） */
app.get('/api/admin/overview', (_req, res) => {
  const all = gamesDb.all();
  const ms = mods.stats();
  const sv = saves.stats();
  res.json({
    ok: true,
    cold: coldHide.stats(all),
    lib: gamesDb.stats(),
    notes: { count: gameNotes.count() },
    /* ★ v10.90：人工资料覆盖的规模（仪表盘「资料覆盖」卡用），不参与任何判定 */
    profile: gameProfile.stats(),
    /* ★ v10.88.2：资源域的条目数（左栏角标）。数字全部**现算**，不写死 ——
     *   mods/saves/fitgirl/ts 的产物每天都在刷新，写死会在下一轮变成谎报。
     * ★ v10.90 口径修正：角标 = **条目总数（含未匹配）**，与各模块列表的 total 对齐。
     *   原来 save 用 `inPcLib`（只算匹配进库的 6,334）而列表显示 6,632（全部），
     *   同一个东西两个数字，管理页会当成 bug 报 —— 两处必须同一个口径。 */
    domains: {
      mod: (ms.byKind || {}).mod || 0,
      modifier: trainers.stats().total || 0,
      modifierExtra: (ms.byKind || {}).modifier || 0,
      save: sv.total || 0,
      cloud: sv.withCloud || 0,
      fitgirl: fitgirl.stats().entryTotal || 0,
      ts: tsmods.stats().packages || 0,
    },
    mods: ms,
    trainers: trainers.stats(),
    saves: sv,
    gt: gt.stats(),
    fitgirl: fitgirl.stats(),
    tsmods: tsmods.stats(),
  });
});
app.get('/api/admin/log', (req, res) => {
  if (!adminGuard(req, res)) return;
  res.json(readAdminLog(req.query.limit));
});

/* ── ★ v10.91 管理员账号：登录 / 登出 / 账号状态 ────────────────────────────
 * 用户口径：「为什么要令牌，不如直接给我一个管理员账号」。
 *
 * 与令牌的关系（有意共存，不是没删干净）：
 *   · **人**走账号密码（好记、能改、登录后长期有效）；
 *   · **程序**走令牌（抓取脚本 / verify-online / 测试套件做无头鉴权，
 *     它们没有浏览器、也不该学会登录流程）。
 *   ⇒ adminGuard 三条通道：回环 / 会话 / 令牌，任一成立即放行。
 *
 * ★ 登录接口**不**走 adminGuard（它必须能被未登录的人调用），
 *   所以它自己成了唯一一个「公网可打」的写敏感端点，必须自带防爆破：
 *   同一 IP 10 分钟内失败 8 次 ⇒ 429 + 剩余等待秒数。 */
app.post('/api/admin/login', (req, res) => {
  const ip = clientIp(req);
  const gate = loginThrottle(ip);
  if (!gate.ok) {
    res.status(429).json({ ok: false, error: '尝试次数过多，请 ' + gate.wait + ' 秒后再试' });
    return;
  }
  if (globalBlocked()) {
    res.status(429).json({ ok: false, error: '全站登录失败次数过多（可能正被爆破），请 10 分钟后再试' });
    return;
  }
  const user = String((req.body && req.body.user) || '').trim();
  const pass = String((req.body && req.body.pass) || '');
  if (!adminAccount.stats().configured) {
    res.status(401).json({ ok: false, error: '服务端还没有配置账号：本地执行 node tools/set-admin-account.js <用户名> <密码>' });
    return;
  }
  if (!adminAccount.check(user, pass)) {
    loginFailed(ip);
    globalFailed();
    appendAdminLog({ ts: Date.now(), id: '-', title: '登录失败', op: 'login-fail', via: 'password', user: user.slice(0, 32), ip });
    res.status(401).json({ ok: false, error: '用户名或密码不正确' });
    return;
  }
  const sid = newSid();
  const exp = Date.now() + SESS_TTL;
  SESSIONS.set(sid, { user, exp });
  if (SESSIONS.size > 5000) pruneSessions();
  LOGIN_FAIL.delete(ip);
  /* Cookie 只在「非回环」时加 Secure：本地 8123/8124 是 http，带 Secure 浏览器不写。 */
  const https = String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';
  res.setHeader('Set-Cookie',
    SESS_COOKIE + '=' + sid + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + Math.floor(SESS_TTL / 1000)
    + (https ? '; Secure' : ''));
  appendAdminLog({ ts: Date.now(), id: '-', title: '管理员登录', op: 'login', via: 'password', user, ip });
  res.json({ ok: true, user, sid, exp, ttl: SESS_TTL });
});

app.post('/api/admin/logout', (req, res) => {
  const s = sessOf(req);
  if (s) {
    /* 会话可能在 Cookie / 头 / query 任一通道里 ⇒ 三处都要能清掉 */
    SESSIONS.delete(s.sid);
    appendAdminLog({ ts: Date.now(), id: '-', title: '管理员登出', op: 'logout', via: 'session', user: s.user });
  }
  res.setHeader('Set-Cookie', SESS_COOKIE + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

/* 账号状态（guarded）：设置页显示「当前是谁 / 账号从哪来 / 什么时候改过」，
 * 绝不回传 hash 或 salt。 */
app.get('/api/admin/account', (req, res) => {
  if (!adminGuard(req, res)) return;
  res.json({
    ok: true,
    via: req._adminVia || 'unknown',
    user: req._adminUser || null,
    account: adminAccount.stats(),
    sessions: SESSIONS.size,
    tokenPath: !!adminToken(),
  });
});

/* ── ★ v10.90 GET /api/admin/verify ──
 * 一个**只回答「你这张令牌算不算数」**的探针。
 *
 * 为什么要单独一条：前端「保存令牌」按钮原本只是写 localStorage 就弹「已保存」——
 * 用户拿着错令牌（或者线上令牌文件没随发布带上）时，页面只会给一张空表，
 * 没有任何一句话说明是鉴权失败。有了这条，保存时可以**立刻**给出绿/红结论。
 *
 * ★ 它自己必须 guarded：否则「有没有令牌」都返回 200，探针就失去了判定意义
 *   （这也是铁律 161 的同一个坑：能反映权限状态的端点，本身要在护栏里面）。 */
app.get('/api/admin/verify', (req, res) => {
  if (!adminGuard(req, res)) return;
  res.json({
    ok: true,
    via: req._adminVia || 'unknown',
    user: req._adminUser || null,
    account: adminAccount.stats().user,   /* 只给用户名，不给凭据 */
    at: Date.now(),
  });
});

/* ── ★ v10.103 磁力下载（Komo-Magnet）预留接口 ──
 * 三层分工：网页看/管 · 服务端存配置 · 本机工具真正下载。
 *
 * ★★ 为什么服务端**不代理** aria2 JSON-RPC：
 *    管理页在线上打开时，服务端的 127.0.0.1 是容器自己，不是用户那台机器；
 *    aria2 只跑在用户本机。⇒ 探活 / 加任务 / 看进度一律由**浏览器**直连
 *    http://127.0.0.1:68xx/jsonrpc（v10.102 已实测 HTTPS 页面 fetch 到本机 → 200 / 6ms）。
 *    把 RPC 搬到服务端只会得到「线上永远连不上」，且等于给公网开一个打本机端口的跳板。
 *
 * ★ 所以这两个端点只做服务端该做的事：**存配置** + **给契约元信息**。
 *    工具端还没交付时它们照样 200（setup=null），管理页据此显示「未接入」而不是报错。
 */
const MAGNET_CFG_PATH = path.join(__dirname, 'data', 'magnet-config.json');
const MAGNET_CFG_DEF = {
  port: 6800,                 /* 首个端口；被占用时工具按 6801..6805 顺延（写进 port.txt） */
  secret: 'komomagnet-local', /* 与工具端共用的 RPC token，页面上只读 */
  dir: '',                    /* 空 = 用工具默认目录 %USERPROFILE%\Downloads\KomoMagnet */
  maxConcurrent: 5,
  maxSpeed: '',               /* 形如 '8M'；空串 = 不限速 */
  seedTime: 0,                /* 分钟；0 = 下完不做种 */
  autoLaunch: true,           /* 探不到工具时，网页是否允许用协议唤起它 */
};
const MAGNET_PORTS = [6800, 6801, 6802, 6803, 6804, 6805];

function magnetConfig() {
  let saved = {};
  try {
    const j = JSON.parse(fs.readFileSync(MAGNET_CFG_PATH, 'utf8'));
    if (j && typeof j === 'object') saved = j;
  } catch (e) { /* 文件不存在 / 坏 JSON ⇒ 全默认，不是错误 */ }
  const out = {};
  for (const k of Object.keys(MAGNET_CFG_DEF)) {
    out[k] = Object.prototype.hasOwnProperty.call(saved, k) ? saved[k] : MAGNET_CFG_DEF[k];
  }
  return out;
}

/* 元信息 = 前端与工具端的**唯一契约来源**。
 * ★ 工具端交付后只需要改这一处的 setup / version，管理页不用动。 */
app.get('/api/admin/download/meta', (req, res) => {
  if (!adminGuard(req, res)) return;
  res.json({
    ok: true,
    tool: {
      name: 'Komo-Magnet',
      vendor: 'GameHub',
      /* 交付后把 version 填上、setup 指向真实安装包即可点亮安装入口。
         ★ 现在留 null 而不是指一个 404 路径：死链比「暂无」更糟（用户会反复点）。 */
      version: null,
      setup: null,
      setupNote: '工具端开发中（Komo-Magnet）。装好并常驻后，本页会自动从「未接入」变成「已连接」。',
    },
    scheme: 'komomagnet://add?uri=',
    legacyScheme: 'komoconvert://add?uri=',
    ports: MAGNET_PORTS,
    rpc: { path: '/jsonrpc', secretHint: 'token:<secret>', timeoutMs: 4000 },
    config: magnetConfig(),
    at: Date.now(),
  });
});

app.get('/api/admin/download/config', (req, res) => {
  if (!adminGuard(req, res)) return;
  res.json({ ok: true, config: magnetConfig(), defaults: MAGNET_CFG_DEF });
});

/* 只白名单接受 5 个字段 + 逐项范围校验。
 * ★ 不做「整体覆盖」：body 里没出现的字段保持原值，避免前端少传一个字段就把配置清空。 */
app.post('/api/admin/download/config', (req, res) => {
  if (!adminGuard(req, res)) return;
  const b = (req.body && typeof req.body === 'object') ? req.body : {};
  const cur = magnetConfig();
  const next = Object.assign({}, cur);
  const bad = (m) => res.status(400).json({ ok: false, error: m });

  if (Object.prototype.hasOwnProperty.call(b, 'port')) {
    const p = parseInt(b.port, 10);
    if (!(p >= 1024 && p <= 65535)) return bad('port 需在 1024–65535 之间');
    next.port = p;
  }
  if (Object.prototype.hasOwnProperty.call(b, 'maxConcurrent')) {
    const n = parseInt(b.maxConcurrent, 10);
    if (!(n >= 1 && n <= 16)) return bad('maxConcurrent 需在 1–16 之间');
    next.maxConcurrent = n;
  }
  if (Object.prototype.hasOwnProperty.call(b, 'seedTime')) {
    const n = parseInt(b.seedTime, 10);
    if (!(n >= 0 && n <= 1440)) return bad('seedTime 需在 0–1440 分钟之间');
    next.seedTime = n;
  }
  if (Object.prototype.hasOwnProperty.call(b, 'maxSpeed')) {
    const s = String(b.maxSpeed == null ? '' : b.maxSpeed).trim();
    if (s && !/^\d{1,6}[KMG]$/i.test(s)) return bad("maxSpeed 形如 8M / 512K，留空表示不限速");
    next.maxSpeed = s.toUpperCase();
  }
  if (Object.prototype.hasOwnProperty.call(b, 'dir')) {
    const s = String(b.dir == null ? '' : b.dir).trim();
    if (s.length > 260 || /[\u0000-\u001f]/.test(s)) return bad('dir 不合法（≤260 字符，不含控制字符）');
    next.dir = s;
  }
  if (Object.prototype.hasOwnProperty.call(b, 'autoLaunch')) next.autoLaunch = !!b.autoLaunch;

  try {
    fs.writeFileSync(MAGNET_CFG_PATH, JSON.stringify(next, null, 2) + '\n');
  } catch (e) {
    return res.status(500).json({ ok: false, error: '写配置失败: ' + e.message });
  }
  /* 留痕：配置是**行为开关**（限速/并发/自动唤起），和豁免同档 */
  appendAdminLog({
    ts: Date.now(), id: '-', title: '磁力下载配置', op: 'magnet-config',
    via: req._adminVia || 'unknown', user: req._adminUser || '',
    patch: Object.keys(b).filter((k) => Object.prototype.hasOwnProperty.call(MAGNET_CFG_DEF, k)),
  });
  res.json({ ok: true, config: next, defaults: MAGNET_CFG_DEF });
});

/* ── ★ v10.92 GET /api/admin/env ──
 * 线上运行时**只读自检**：「这台机器能不能跑云下载引擎」不能靠猜。
 *
 * 回答五件事：
 *   ① 平台 / CPU 架构 / Node 版本 / 核数 / 内存（决定 aria2 该拿 x64 还是 arm64）；
 *   ② 磁盘总量与剩余（决定单任务体积上限该设多少）；
 *   ③ aria2c 是否已经在 PATH 或常见位置（没有就要自带二进制或换纯 JS 引擎）；
 *   ④ 出站四路：DNS / HTTPS / TCP-tracker / UDP-DHT（BT 要的是后两个）；
 *   ⑤ 工作目录可写性（任务缓存要落到哪）。
 *
 * ★★ 全部探测**并行 + 单项 2.5s 超时**。这条端点会被当健康检查用：
 *   上一版探针把六个探测串行放在请求路径里，最坏 30s+ 才回第一个字节，
 *   部署平台的 60s 健康检查直接判「服务没起来」，把线上应用换成了探针还起不来。
 *   慢探测必须并行、必须有上限、必须能降级成 false 而不是挂住。
 * ★ 只读：不写盘、不下载任何正文、不 join 任何 swarm；BT 只发一条 DHT ping 看有没有回包。
 * ★ 它自己必须 guarded（同 verify：能反映权限状态的端点要在护栏里）。 */
app.get('/api/admin/env', async (req, res) => {
  if (!adminGuard(req, res)) return;
  const os = require('os');
  const net = require('net');
  const dgram = require('dgram');
  const dns = require('dns');
  const fsm = require('fs');
  /* ★ 用 promisify 版：回调版的 options 是**倒数第二个**实参，而 tools/check-stdio-guard.js
   *   只看「最后一个顶层实参」判 stdio（回调会被判成「options 不是对象字面量」⇒ UNKNOWN）。
   *   promisify 版把 options 放回最后一位，守卫能直接读到 `stdio`。 */
  const execFile = require('util').promisify(require('child_process').execFile);

  /* 单项超时：到点就返回 fallback，不让任何一路拖住整条端点 */
  function cap(p, ms, fallback) {
    return Promise.race([
      Promise.resolve(p).catch((e) => ({ ok: false, err: String((e && e.message) || e).slice(0, 60) })),
      new Promise((r) => setTimeout(() => r(fallback), ms || 2500)),
    ]);
  }

  function tcpProbe(host, port) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const s = new net.Socket();
      let done = false;
      const fin = (ok, note) => {
        if (done) return; done = true;
        try { s.destroy(); } catch (e) { /* 已断开 */ }
        resolve({ ok, ms: Date.now() - t0, note: note || '' });
      };
      s.setTimeout(2500);
      s.once('connect', () => fin(true, 'connected'));
      s.once('timeout', () => fin(false, 'timeout'));
      s.once('error', (e) => fin(false, String((e && e.code) || 'error').slice(0, 40)));
      try { s.connect(port, host); } catch (e) { fin(false, 'connect-throw'); }
    });
  }

  function udpProbe(host, port) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const sock = dgram.createSocket('udp4');
      const payload = Buffer.from('d1:ad2:id20:probe-gh-0000000000e1:q4:ping1:t2:aa1:y1:qe');
      let done = false;
      const fin = (ok, note) => {
        if (done) return; done = true;
        try { sock.close(); } catch (e) { /* 已关 */ }
        resolve({ ok, ms: Date.now() - t0, note: note || '' });
      };
      const timer = setTimeout(() => fin(false, 'timeout'), 2500);
      sock.once('message', (b) => { clearTimeout(timer); fin(true, 'replied ' + b.length + 'B'); });
      sock.once('error', (e) => { clearTimeout(timer); fin(false, String((e && e.code) || 'error').slice(0, 40)); });
      try {
        sock.send(payload, 0, payload.length, port, host, (err) => {
          if (err) { clearTimeout(timer); fin(false, 'send-failed'); }
        });
      } catch (e) { clearTimeout(timer); fin(false, 'send-throw'); }
    });
  }

  const env = {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    release: os.release(),
    cpus: os.cpus().length,
    cpuModel: String((os.cpus()[0] || {}).model || '').slice(0, 80),
    memTotalMB: Math.round(os.totalmem() / 1048576),
    memFreeMB: Math.round(os.freemem() / 1048576),
    pid: process.pid,
    uptimeSec: Math.round(process.uptime()),
    cwd: process.cwd(),
    execPath: process.execPath,
    isRoot: typeof process.getuid === 'function' ? process.getuid() === 0 : null,
    hasApt: fsm.existsSync('/usr/bin/apt-get') || fsm.existsSync('/usr/bin/apt'),
  };

  const disk = {};
  for (const at of ['cwd', 'root']) {
    try {
      const st = fsm.statfsSync(at === 'cwd' ? process.cwd() : '/');
      disk[at] = {
        totalGB: +(st.blocks * st.bsize / 1073741824).toFixed(1),
        freeGB: +(st.bavail * st.bsize / 1073741824).toFixed(1),
      };
    } catch (e) { disk[at] = { err: String(e.message).slice(0, 40) }; }
  }

  const [aria2, shOut, dnsOut, httpsOut, tcp1, tcp2, udp1, udp2] = await Promise.all([
    cap((() => {
      /* 回调式 resolve 改成 promise：options 必须是**最后一个**实参，否则 stdio 守卫读不到 */
      return execFile('sh', ['-c', 'command -v aria2c && aria2c --version | head -1'],
        { timeout: 2500, stdio: ['ignore', 'pipe', 'pipe'] })
        .then(({ stdout }) => ({ ok: true, out: String(stdout).trim().split('\n')[0].slice(0, 80) }))
        .catch(() => ({ ok: false, err: 'not-found' }));
    })(), 2500, { ok: false, err: 'timeout' }),
    cap((() => {
      return execFile('sh', ['-c', 'ls -l /bin/sh 2>&1 | head -1'],
        { timeout: 2000, stdio: ['ignore', 'pipe', 'pipe'] })
        .then(({ stdout }) => ({ ok: true, out: String(stdout).trim().slice(0, 80) }))
        .catch(() => ({ ok: false, err: 'no-sh' }));
    })(), 2000, { ok: false, err: 'timeout' }),
    cap(new Promise((resolve) => {
      const t0 = Date.now();
      dns.lookup('github.com', (err, addr) => resolve(err
        ? { ok: false, err: String(err.code || 'err') }
        : { ok: true, addr, ms: Date.now() - t0 }));
    }), 2500, { ok: false, err: 'timeout' }),
    cap((async () => {
      const t0 = Date.now();
      try {
        const r = await fetch('https://raw.githubusercontent.com/aria2/aria2/master/README.rst', {
          method: 'HEAD', signal: AbortSignal.timeout(2500),
        });
        return { ok: r.ok, status: r.status, ms: Date.now() - t0 };
      } catch (e) { return { ok: false, err: 'fetch-failed' }; }
    })(), 2800, { ok: false, err: 'timeout' }),
    tcpProbe('tracker.opentrackr.org', 1337),
    tcpProbe('tracker.torrent.eu.org', 451),
    udpProbe('dht.transmissionbt.com', 6881),
    udpProbe('tracker.opentrackr.org', 1337),
  ]);

  let writable = false;
  let writeErr = '';
  try {
    const probeFile = require('path').join(os.tmpdir(), 'gh-env-probe-' + process.pid + '.txt');
    fsm.writeFileSync(probeFile, String(Date.now()));
    fsm.unlinkSync(probeFile);
    writable = true;
  } catch (e) { writeErr = String(e.message).slice(0, 60); }

  res.json({
    ok: true,
    at: new Date().toISOString(),
    env,
    disk,
    bin: { aria2: aria2, shell: shOut },
    egress: { dns: dnsOut, https: httpsOut, tcpTrackers: [tcp1, tcp2], udpDht: [udp1, udp2] },
    tmp: { writable, err: writeErr, dir: os.tmpdir() },
  });
});

/* ── ★ v10.90 GET/POST /api/admin/profile ──
 * 「页面管理」改爬虫字段、「游戏库」改资料字段，**写的是同一份** data/game-profile.json。
 *   GET  ?id=<库id>  → { profile: 覆盖差异, effective: 叠加后的展示值, raw: 爬虫原值 }
 *   POST { id, patch } → 逐字段归一；传空字符串 = 删掉该字段（回到爬虫值）
 *
 * ★ 为什么 GET 要同时给 raw 与 effective：管理页必须能显示「这一项被改过，原值是 X」，
 *   否则人工改三个月后没人知道哪条是抓来的、哪条是自己填的（也就无法回滚）。
 * ★ 为什么写操作不接受整条记录覆盖：只接受 patch。整条覆盖会把「另一个页面刚改的字段」
 *   用旧值盖回去（页面管理与游戏库管的是同一份记录的不同字段）。 */
app.get('/api/admin/profile', (req, res) => {
  if (!adminGuard(req, res)) return;
  const id = String(req.query.id || '').trim();
  const g = id ? gamesDb.byIdGet(id) : null;
  if (!g) return res.status(404).json({ ok: false, error: '库内无此 id: ' + id });
  res.json({
    ok: true, id,
    fields: gameProfile.FIELDS,
    profile: gameProfile.get(id),
    /* 弹窗里的「列表状态」与备注要用真值回填，不能前端猜（铁律 154） */
    state: (() => {
      const snap = coldHide.overridesSnapshot();
      return {
        cold: coldHide.isCold(g),
        hidden: coldHide.isHidden(g),
        override: snap.show.includes(id) ? 'show' : (snap.hide.includes(id) ? 'hide' : 'clear'),
        note: gameNotes.get(id),
      };
    })(),
    raw: {
      title: g.title || '', cover: g.cover || '', hot: g.hot || 0, url: g.url || '',
      intro: g.intro || '', genres: g.genres || [], developer: g.developer || '',
      publisher: g.publisher || '', releaseDate: g.releaseDate || '', aliases: g.aliases || [],
    },
    effective: gameProfile.apply({
      id: g.id, title: g.title || '', cover: g.cover || '', hot: g.hot || 0, url: g.url || '',
      intro: g.intro || '', genres: g.genres || [], developer: g.developer || '',
      publisher: g.publisher || '', releaseDate: g.releaseDate || '', aliases: g.aliases || [],
    }),
    completeness: gameProfile.completeness(gameProfile.apply(g)),
  });
});
app.post('/api/admin/profile', (req, res) => {
  if (!adminGuard(req, res)) return;
  const b = req.body || {};
  const id = String(b.id || '').trim();
  if (!id) return res.status(400).json({ ok: false, error: '缺少 id' });
  if (!gamesDb.byIdGet(id)) return res.status(404).json({ ok: false, error: '库内无此 id: ' + id });
  const patch = (b.patch && typeof b.patch === 'object') ? b.patch : {};
  /* 只认白名单字段（前端传了别的就当没传 —— 不让管理接口成为改库结构的后门） */
  const clean = {};
  const dropped = [];
  for (const k of Object.keys(patch)) {
    if (gameProfile.FIELDS.includes(k)) clean[k] = patch[k];
    else dropped.push(k);
  }
  let r;
  try { r = gameProfile.set(id, clean); }
  catch (e) { return res.status(500).json({ ok: false, error: String((e && e.message) || e) }); }
  appendAdminLog({
    ts: new Date().toISOString(), id, title: gamesDb.byIdGet(id).title || id,
    op: 'profile', via: req._adminVia || '', fields: Object.keys(clean), touched: r.touched,
    ...(dropped.length ? { dropped } : {}),
  });
  res.json({ ok: true, id, profile: r.profile, touched: r.touched, ...(dropped.length ? { dropped } : {}) });
});

/* ── ★ v10.90 GET /api/admin/coverage?module=base|mod|trainer|save ──
 * 「运维 → 资源覆盖」从「七个数据源各一根条」改成**按模块分类看**。
 *
 * 【为什么不能只看条数】模块条数（MOD 7,825 条）回答不了管理真正要问的问题：
 *   「库里还有多少款游戏一类资源都没有」。所以这里同时给两样东西：
 *     · sources[]  每个子源的条目数 / 命中游戏数 / 命中率（分类视角）
 *     · missing[]  该模块**一款都没有**的游戏（缺口视角，按热度降序前 N）
 *
 * 【命中集合怎么建】一律用各源自己的索引，**不逐款游戏反查**：
 *   trainers.byLib / saves.byLib 是 O(n) 线性过滤，19,703 款逐个调会变成 O(n²)
 *   （实测会卡住事件循环十几秒）。这里直接拿 ensure() 的 items 建一次 Set。
 *
 * 【口径】total = 端游库全量（19,703），**不是**可见数 —— 冷门被隐藏不等于没有资源。
 */
const COVERAGE_MODULES = {
  base: { label: '本体', sources: [['fitgirl', 'FitGirl Repack']] },
  mod: { label: 'MOD', sources: [['mod', '机地 MOD 帖'], ['ts', 'Thunderstore']] },
  trainer: { label: '修改器', sources: [['trainers', 'CE / 风灵月影'], ['jidiTrainer', '机地修改器帖'], ['gt', 'GTrainers']] },
  save: { label: '存档', sources: [['save', '存档位置'], ['cloud', '云存档']] },
};

/** 建当前进程的命中集合快照（各源数据结构不同，按 key 分支取，不猜字段） */
function coverageSets() {
  const s = {};
  try { s.fitgirl = new Set(Object.keys(fitgirl.RAW.byGame || {})); } catch (e) { s.fitgirl = new Set(); }
  try { s.mod = resGroups.libIdsFor('mod'); } catch (e) { s.mod = new Set(); }
  try { s.ts = new Set((tsmods.RAW.games || []).map((g) => g.libId).filter(Boolean)); } catch (e) { s.ts = new Set(); }
  try { s.jidiTrainer = resGroups.libIdsFor('trainers'); } catch (e) { s.jidiTrainer = new Set(); }
  try {
    s.trainers = new Set((trainers.ensure().items || []).map((x) => x.libId).filter(Boolean));
  } catch (e) { s.trainers = new Set(); }
  try { s.save = resGroups.libIdsFor('saves'); } catch (e) { s.save = new Set(); }
  try {
    const its = saves.ensure().items || [];
    s.saveOwn = new Set(its.map((x) => x.libId).filter(Boolean));
    s.cloud = new Set(its.filter((x) => (x.cloud || []).length).map((x) => x.libId).filter(Boolean));
  } catch (e) { s.saveOwn = new Set(); s.cloud = new Set(); }
  try { s.gt = new Set((gt.ensure().items || []).map((x) => x.libId).filter(Boolean)); } catch (e) { s.gt = new Set(); }
  return s;
}

/** 各子源的命中集合（多个底层来源合并成一个逻辑源） */
function coverageUnion(key, s) {
  switch (key) {
    case 'fitgirl': return s.fitgirl;
    case 'mod': return s.mod;
    case 'ts': return s.ts;
    case 'trainers': return s.trainers;
    case 'jidiTrainer': return s.jidiTrainer;
    case 'gt': return s.gt;
    case 'save': return new Set([...s.save, ...s.saveOwn]);
    case 'cloud': return s.cloud;
    default: return new Set();
  }
}

app.get('/api/admin/coverage', (req, res) => {
  if (!adminGuard(req, res)) return;
  const key = String(req.query.module || 'base').trim();
  const mod = COVERAGE_MODULES[key];
  if (!mod) return res.status(400).json({ ok: false, error: 'module 只支持 ' + Object.keys(COVERAGE_MODULES).join(' / ') });
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 30));

  const all = gamesDb.all();
  const total = all.length;
  const s = coverageSets();

  /* 模块级「一款都没有」判定：所有子源命中集合的并集 */
  const covered = new Set();
  const srcRows = mod.sources.map(([k, label]) => {
    const set = coverageUnion(k, s);
    for (const id of set) covered.add(id);
    return { key: k, label, matched: set.size, rate: total ? Math.round((set.size / total) * 1000) / 10 : 0 };
  });

  /* 条目数从各源 stats 现算（不写死：产物每天在变） */
  const ms = mods.stats();
  const sv = saves.stats();
  const entries = {
    fitgirl: (fitgirl.stats() || {}).entryTotal || 0,
    mod: (ms.byKind || {}).mod || 0,
    ts: (tsmods.stats() || {}).packages || 0,
    trainers: (trainers.stats() || {}).total || 0,
    jidiTrainer: (ms.byKind || {}).modifier || 0,
    gt: (gt.stats() || {}).total || 0,
    save: sv.total || 0,
    cloud: sv.withCloud || 0,
  };
  for (const r of srcRows) r.entries = entries[r.key] || 0;

  /* ★ v10.90：每个子源的产物生成时间（爬虫新鲜度）。
   *   「爬虫可视化」不能只给条数 —— 条数多但两周没更新，和条数少但天天新，
   *   管理动作完全相反。这里如实给每个源自己的 builtAt（没有就 null，不猜）。 */
  const builtAt = {
    fitgirl: (fitgirl.stats() || {}).builtAt,
    mod: ms.builtAt,
    ts: (tsmods.stats() || {}).builtAt,
    trainers: (trainers.stats() || {}).builtAt,
    jidiTrainer: ms.builtAt,
    gt: (gt.stats() || {}).builtAt,
    save: sv.builtAt,
    cloud: sv.builtAt,
  };
  let newest = 0;
  for (const r of srcRows) {
    r.builtAt = builtAt[r.key] || null;
    if (r.builtAt > newest) newest = r.builtAt;
  }

  const missingAll = all.filter((g) => !covered.has(g.id));
  const missing = missingAll
    .slice()
    .sort((a, b) => (b.hot || 0) - (a.hot || 0))
    .slice(0, limit)
    .map((g) => ({ id: g.id, title: g.title, cover: g.cover || '', source: g.source, hot: g.hot || 0 }));

  res.json({
    ok: true, module: key, label: mod.label,
    total, covered: covered.size,
    rate: total ? Math.round((covered.size / total) * 1000) / 10 : 0,
    sources: srcRows,
    builtAt: newest || null,
    missingTotal: missingAll.length,
    missing,
  });
});

/* GET /api/admin/game?id=<库id> — 单游戏详情聚合（管理抽屉唯一数据源）
 *   一发拿全：游戏 meta + 隐藏态 + 七路资源命中（机地帖三分类 / FLiNG / TCS / GTrainers /
 *   云存档 / 存档位置 / FitGirl / Thunderstore）。前端不再对七个 match 端点各发一遍。
 *   ★ 孪生兜底同 /api/res/game 口径：资源常挂在双料记录的另一条上，id 空了换 resId 再查。
 *   ★★ v10.88.1 修正：**不能再当「纯公开读接口」**。v10.88 往 `state` 里加了 `note`
 *   （管理侧私有批注），而这条 handler 沿用了 v10.87 的「不设防」——发布后线上实测：
 *   无令牌 `GET /api/admin/game?id=xd-1` 返回 200，`state.note` 明文可见。
 *   ⇒ 判据升级为 adminGuard（回环三条件 / 令牌三通道），与 log、hide-overrides 同档。
 *   **教训（铁律 161）：给一个「已声明不设防」的端点加进管理侧字段时，必须同步把端点升为需鉴权**；
 *   字段的可见性等级由端点护栏决定，不由字段自己决定。 */
app.get('/api/admin/game', (req, res) => {
  if (!adminGuard(req, res)) return;
  const id = String(req.query.id || '').trim();
  const g = id ? gamesDb.byIdGet(id) : null;
  if (!g) return res.status(404).json({ ok: false, error: '库内无此 id: ' + id });

  /* 孪生归属：resFor 是 roster/首页 chip 的同一真源（铁律：同一语义一份实现） */
  let resId = id, resCounts = { mod: 0, saves: 0, trainers: 0 };
  try { const h = resFor(g); if (h) { resId = h.id; resCounts = h.counts; } } catch (e) { /* 聚合层未起不阻塞 */ }

  /* 隐藏态三问：规则冷门？最终隐藏？有无手工豁免？—— 与 /api/cold/stats 同一 coldHide 真源 */
  const snap = coldHide.overridesSnapshot();
  const ov = snap.show.includes(id) ? 'show' : (snap.hide.includes(id) ? 'hide' : null);

  const byLibBoth = (fn, slim) => {
    let list = fn(id);
    if ((!list || !list.length) && resId && resId !== id) list = fn(resId) || [];
    return (list || []).slice(0, 12).map(slim || ((x) => x));
  };
  const trDl = (x) => { const dl = flingdl.attach(x) || tcsdl.attach(x); return {
    name: x.name, zh: x.zh, version: x.version, source: x.source, libId: x.libId,
    ...(dl ? { dl } : {}) }; };

  res.json({
    ok: true,
    /* ★ v10.90：`game` 是**叠加覆盖值之后**的展示真值（弹窗表单直接吃它）；
     *   `state.profile` 是覆盖层的原始差异（只含人改过的字段），
     *   两者分开给，前端才能标出「这一项是人改的，点这里回到爬虫值」。 */
    game: gameProfile.apply({
      id: g.id, title: g.title, source: g.source, hot: g.hot || 0, score: g.score || null,
      size: g.size || '', dateLabel: g.dateLabel || '', updatedTs: g.updatedTs || null,
      publishTs: g.publishTs || null, genres: g.genres || [], cover: g.cover || '',
      url: g.url || '', jidiUrl: g.jidiUrl || '',
      intro: g.intro || '', developer: g.developer || '', publisher: g.publisher || '',
      releaseDate: g.releaseDate || '', aliases: g.aliases || [],
    }),
    state: { cold: coldHide.isCold(g), hidden: coldHide.isHidden(g), override: ov, resId, resCounts, note: gameNotes.get(g.id), profile: gameProfile.get(g.id) },
    resources: {
      /* resGroups.byLib 内部已做 slimItem 瘦身投影，这里直接用（再 map 一遍是重复劳动） */
      resGroups: {
        mod: resGroups.byLib('mod', resId, 12),
        saves: resGroups.byLib('saves', resId, 12),
        trainers: resGroups.byLib('trainers', resId, 12),
      },
      fling: byLibBoth((k) => trainers.byLib(k), trDl),
      savesYx: byLibBoth((k) => savesYx.byLib(k), (x) => savesYx.slim(x)),
      gt: byLibBoth((k) => gt.byLib(k), (x) => gt.slim(x)),
      fitgirl: byLibBoth((k) => fitgirl.byGame(k), (x) => ({ slug: x.slug, url: x.url, title: x.title, date: x.date, adult: !!x.adult })),
      /* tsmods.byLib 返回的是**原始包**（字段与展示层不对齐），走官方 slim（与 /api/ts/mods 同形） */
      tsmods: byLibBoth((k) => tsmods.slim(k, 8)),
    },
  });
});

/* ── ★ v10.88.2 GET /api/admin/res?kind=fitgirl|ts&q=&page=&size= ──
 * 后台「按资源类型分开管理」的两路补位。
 *
 * 【为什么只补这两个】mod / modifier / save / cloud 四个域**不新增端点** ——
 *   已有 `/api/mods/list`、`/api/trainers/list`、`/api/saves/list` 都带 q/limit/offset，
 *   且行里本来就有 `libId`（= 游戏主键）。再造一份统一端点等于同一语义两份实现，
 *   将来两处口径漂移比没有端点更难查（铁律：同一语义一份实现）。
 *   只有 FitGirl 与 Thunderstore 原本是「按 libId 反查」形态（`byGame` / `byLib`），
 *   没有扁平列表 ⇒ 只有这两路需要在这里补。
 *
 * 【以游戏为主键】每行统一带 `gameId`（端游库 id）+ `gameTitle`。
 *   这是「六个域分开管、但都以游戏为主键」的落点：前端六个视图共用同一个编辑弹窗、
 *   同一条游戏跳转，不需要为每个域各写一套关联逻辑。
 *
 * 【管理侧私有】这个端点只服务 /admin ⇒ 走 adminGuard（铁律 161：别因为「数据本来公开」
 *   就当它不需要鉴权 —— 管理视图会持续加私有字段，每次加都要重新审一遍有没有必要公开）。
 */
const ADMIN_RES_KINDS = ['fitgirl', 'ts'];
app.get('/api/admin/res', (req, res) => {
  if (!adminGuard(req, res)) return;
  const kind = String(req.query.kind || '').trim();
  if (!ADMIN_RES_KINDS.includes(kind)) {
    return res.status(400).json({ ok: false, error: 'kind 只支持 ' + ADMIN_RES_KINDS.join(' / ') });
  }
  const q = String(req.query.q || '').trim().toLowerCase();
  const size = Math.min(200, Math.max(1, parseInt(req.query.size, 10) || 50));
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);

  /* 游戏名只查一次（ts 域 4,331 个包全指同几百款游戏，逐行查库是白烧 CPU） */
  const titleCache = new Map();
  const gameTitle = (gid) => {
    const k = String(gid || '');
    if (titleCache.has(k)) return titleCache.get(k);
    let t = '';
    try { const g = gamesDb.byIdGet(k); t = (g && (g.title || g.name)) || ''; } catch (e) { /* 库未起不阻塞 */ }
    titleCache.set(k, t);
    return t;
  };

  let rows = [];
  if (kind === 'fitgirl') {
    for (const gid of Object.keys(fitgirl.RAW.byGame || {})) {
      for (const it of (fitgirl.RAW.byGame[gid] || [])) {
        rows.push({
          rowId: it.slug, gameId: gid, gameTitle: gameTitle(gid),
          title: it.title || it.slug, date: it.date || '', src: 'FitGirl',
          extra: { adult: !!it.adult },
          links: [{ label: 'Repack 页', url: it.url }],
        });
      }
    }
    rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  } else {
    for (const g of (tsmods.RAW.games || [])) {
      for (const p of (g.packages || [])) {
        rows.push({
          rowId: p.ns + '/' + p.name, gameId: g.libId, gameTitle: gameTitle(g.libId) || g.title || '',
          title: p.name, date: '', src: 'Thunderstore · ' + (p.ns || ''),
          extra: { version: p.version, downloads: p.downloads, size: p.size },
          links: [
            { label: '直链 zip', url: p.url },
            { label: '包详情', url: 'https://thunderstore.io/package/' + p.ns + '/' + p.name + '/' },
          ],
        });
      }
    }
    /* 排序按「游戏分组」而不是纯下载量：Thunderstore 每个社区都带一个 `BepInExPack`
     * 依赖包（3,300 万下载），纯按 downloads 排会让前几页全是同一个包名，
     * 管理时看不出「哪款游戏挂了哪些包」。组内再按下载量降序。 */
    rows.sort((a, b) => String(a.gameTitle).localeCompare(String(b.gameTitle), 'zh')
      || (b.extra.downloads || 0) - (a.extra.downloads || 0));
  }

  if (q) {
    rows = rows.filter((r) => (r.title + ' ' + r.gameTitle + ' ' + r.rowId).toLowerCase().includes(q));
  }
  const total = rows.length;
  res.json({
    ok: true, kind, q, total, page, size,
    pages: Math.max(1, Math.ceil(total / size)),
    /* 未匹配到端游库的行 gameId 可能为空/不在库 —— 如实透出，不假装每条都能跳游戏 */
    items: rows.slice((page - 1) * size, page * size),
  });
});

app.get('/api/hots', async (req, res) => {  if (req.query.refresh === '1') cache.delete('hots');
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
// （fs / zlib 已在文件顶部统一 require —— v10.78 前这里曾重复 require('fs')，已收敛）
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
const coldHide = require('./data/cold-hide'); // ★ v10.84 冷门隐藏（/api/cold/stats 自证；列表层钩子在 gamesDb.applyOpts）
const bannerhub = require('./data/bannerhub');
const phonecfg = require('./data/phonecfg');
/* ★ v10.23：跨源「孪生条目」解析（详情页的「另一源也有收录 / 跨源跳转」用它）。
 *   在这之前那件事长在前端 —— 靠 `/api/library?q=<中文名>` 检索 + 前端 sameGame() 过滤，
 *   也就是**纯名称模糊匹配**；而 v10.22 把 13,448 条机地话题合并进 XD 条目后，
 *   库里独立的 jidi 条目只剩 3,609 条，按名检索命中率掉到 3.5%，
 *   按钮因此几乎永远不显示（用户口径：「机地找同名 ↗ 连按钮都点击不了」）。
 *   现在改成**先按精确键（jidiUrl/jidiId）取**，名称匹配只作兜底且必须过防误配闸门。 */
const twin = require('./data/twin');
/* ★ 手游中心统一索引：社区库 + 实测库**合并成一张表**（v9.2）
 *   前端手游专区默认走它，而不是再分两个页签各查各的。 */
const mobilehub = require('./data/mobilehub');
const xref = require('./data/xref');
const trainers = require('./data/trainers');
const mods = require('./data/mods');
const saves = require('./data/saves');
const savesYx = require('./data/savesYx');
/* ★ v10.47：两个「有真实下载链」的新来源 + 按游戏聚合层 */
const gt = require('./data/gtrainers');
/* ★ v10.81：FLiNG 修改器直链（官网自托管文件，经流代理绕 Referer 防盗链） */
const flingdl = require('./data/flingdl');
/* ★ v10.81/P1b：TheCheatScript 外链（MEGA/Yandex 等，ext ⇒ 前端新标签直开，非流代理） */
const tcsdl = require('./data/tcsdl');
/* ★ v10.81：Thunderstore MOD 直链（门 1：MOD 唯一的自托管直链源，无防盗链） */
const tsmods = require('./data/tsmods');
const fitgirl = require('./data/fitgirl'); // ★ v10.86 FitGirl Repack 匹配库（外链档 + magnet 按需现抓）
const fitgirlParts = require('./data/fitgirl-parts'); // ★ v10.88 下载源解析器（主组/变体/可选附件，跨镜像归并）
const gameNotes = require('./data/game-notes'); // ★ v10.88 管理备注（后台唯一可编辑内容，不影响抓取与匹配）
/* ★ v10.90 资料覆盖层：管理页「页面管理 / 游戏库」改的展示字段（标题/封面/热度/简介/厂商…）
 *   落这里，不回写抓取产物。**只影响输出，不参与匹配**（见 data/game-profile.js 头注释）。 */
const gameProfile = require('./data/game-profile');
/* ★ v10.94 同款折叠：源站把「原版 / 支持网络联机版」收成两条独立帖子，
 *   端游库按帖子入账 ⇒ 后台游戏库与名单页同款多行（实测 895 组 / 930 条）。
 *   只在 `?group=1` 时启用（公开搜索与详情不受影响）。 */
const gameDedupe = require('./data/game-dedupe');
/* ★ v10.58：FR（FearlessRevolution）已摘除。理由：整站在 CF managed challenge 后面（只能有头浏览器
   + 页面上下文 fetch）、阶段② 须一次跑完 ≈3.5h，而 GTrainers 已覆盖同类需求且纯 HTTP 直连。
   ★ 摘除前实测：data/fr.json **从未产出** ⇒ fromFr() 贡献 0 条 ⇒ 零用户可见损失。
   完整 SOP（含参数标定与复活手册）：docs/sop/FR-fearlessrevolution-抓取SOP.md */
const resGroups = require('./data/res-groups');
/* ★★ v10.109 冷门判定的第二道判据（用户口径：「无人问津的游戏自动隐藏」→
 *   追问后拍板「无热度**且无任何下载入口**才藏」）。
 *
 *   为什么在**这里**注入而不是让 cold-hide 自己去 require('./res-groups')：
 *   res-groups → gamesDb → cold-hide 已经是一条真实依赖链，反向再 require 就是
 *   **循环依赖**（Node 会把半初始化的 exports 交出去，症状是「平时好、启动早期炸」）。
 *   ⇒ 由 server 把「有资源的 id 集合」以函数形式注入；cold-hide 不新增任何 require。
 *
 *   ⚠️ 三个 Set 合并成**一个**再返回：`isCold` 要对全库逐条问，若在 isCold 里
 *      做三次 `.has()` 也可以，但合并后冷门 stats 与列表过滤用的**必然是同一份集合**
 *      （三处各拼一次早晚漂移 —— 本项目踩过「同一件事两份实现」的坑）。
 *   ⚠️ 首次调用会触发 resGroups.build()（实测 1.6s），之后 30 分钟 TTL 内走缓存。 */
coldHide.setResourceProvider(() => {
  const out = new Set();
  for (const cat of ['mod', 'trainers', 'saves']) {
    for (const id of resGroups.libIdsFor(cat)) out.add(id);
  }
  return out;
});
/* ★ v10.109 新游检测（用户需求 ④：「遇到新游戏则在这里，我来决定是入库」）。
 *   模块只做「比对 + 记账」，扫描阶段**不写 games.json** —— 写入只发生在用户点「入库」时。
 *   完整口径（为什么按 id 差集、为什么不复用增量索引）见 data/new-games.js 文件头。 */
const newGames = require('./data/new-games');
const searchRank = require('./data/search-rank');
const pcreq = require('./data/pcreq');
const bhparams = require('./data/bhparams');
const emuguide = require('./data/emuguide');
const deviceMatch = require('./data/device-match');
const devicemarket = require('./data/devicemarket');
const devicespec = require('./data/devicespec');
const deviceset = require('./data/deviceset');
const devicefill = require('./data/devicefill');
const related = require('./data/related');
const jiditopics = require('./data/jiditopics');   /* v10.22 机地全量话题库读取层 */
const indexer = require('./fetchers/indexer');
const xdrank = require('./fetchers/xdrank');
/* ★ v10.75：榜单源换成 XD `/update/`（8 档各 100 行，实测 SSR 直出） */
const xdupdate = require('./fetchers/xdupdate');
/* ★ v10.74：首页榜单补位（源站每档只给 10 行，而首页要展示 13 个）—— 纯函数，见模块头。
   ★ v10.75：换源后每档 100 行 ⇒ 本模块降级为**兜底**（源站整档抓挂时才用）。 */
const rankFill = require('./data/rank-fill');
/* ★ v10.75：XD + 机地**双源加权融合**（RRF，名次先做相对位置对齐）—— 纯函数，见模块头 */
const rankMerge = require('./data/rank-merge');

/* ---- 库查询通用选项：容量区间(GB) + 仅看有手机模拟器配置(+实测) ---- */
function libOpts(req) {
  const bhOnly = String(req.query.bh || '') === '1';
  const pcOnly = String(req.query.pc || '') === '1';
  /* ★ v10.5 横切筛选：库里有「修改器 / 云存档」收录的游戏
   *   （两个索引库每条都挂 libId，这里用 id 集合做 O(1) 命中）
   * ★ v10.53：三个**资源维度**筛选（MOD / 修改器 / 存档）+ 一个 MOD 新开关，
   *   全部改走 `data/res-groups.js` 的聚合层 —— 与卡面上的资源 chip **同源**。
   *
   *   为什么换口径（实测对比，2026-10-10）：
   *     · 旧 `🛠 有修改器` = `xref.trainerIds()`（GCM 清单）→ **2,391 款**
   *       但卡面上的 `🛠 N 修改器` 来自聚合层（GTrainers 5,510 + GCM 3,683）→ 3,691 款
   *       ⇒ 1,300 款卡上明明有修改器 chip，却筛不出来。
   *     · 旧 `💾 有云存档` = `xref.saveIds()`（Ludusavi 存档**位置**）→ **6,274 款**，
   *       而聚合层能**下**的存档文件只有 1,377 款 —— 筛出来的 5,119 款卡面上
   *       一个 💾 chip 都没有（v10.46 起「存档给文件不给位置」，位置库已只活在详情弹窗里）。
   *   ⇒ 统一后：筛选命中 = 卡面有对应 chip，两边不可能再对不上。
   *     代价是旧的「位置库」筛选没了 —— 它筛的是卡面看不见的维度，已在 v10.53 文档里说明。
   *   ⚠️ 手游专区 `/emulator.html` 的同类开关**不跟着改**：那边的卡面角标来自
   *     `xref.flags`，筛选与角标本来就是同源自洽的（口径不同但各自不矛盾），
   *     要不要统一属于「模块补齐」那批，不混进本版。 */
  const modOnly = String(req.query.mod || '') === '1';
  const trOnly = String(req.query.tr || '') === '1';
  const svOnly = String(req.query.sv || '') === '1';
  const filters = [];
  if (bhOnly) filters.push((g) => !!bannerhub.lookup(g.title));
  if (pcOnly) filters.push((g) => !!phonecfg.lookup(g.title));
  if (modOnly) { const set = resGroups.libIdsFor('mod'); filters.push((g) => set.has(g.id)); }
  if (trOnly) { const set = resGroups.libIdsFor('trainers'); filters.push((g) => set.has(g.id)); }
  if (svOnly) { const set = resGroups.libIdsFor('saves'); filters.push((g) => set.has(g.id)); }
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

/** ★ v10.60：给「要按同款归并展示」的条目挂**归并键** `nkey`。
 *
 *  用户报的现场（2026-10-12 截图）：搜索联想里「古惑狼™ 4：时机已到」（机地）
 *  与「古惑狼4：时机已到」（XDGAME）各占一行 —— 同一款被拆成两款，
 *  只差一个商标号 `™` 与一个空格。
 *
 *  根因：归并键长在前端的 `smKeyOf()` 里，那份是**自写的第四份归一化**
 *  （`toLowerCase().replace(/\s+/g,'')` —— 只去空白、**不剥任何符号**），
 *  而 `data/name-normalize.js` 早在 v10.36 就把 `™®©` 收进了 `SYMBOLS`。
 *  ⇒ 与 `tools/test-twin.js` 那条「★ 前端不再自带 sameGame（同一语义只留后端一份）」
 *     同一条规矩：**归一化只允许一份实现**，键由服务端下发，前端只消费。
 *
 *  ⚠️ 键的宽度由 `twin.groupKey` 决定（**窄类**，只剥商标号/书名号/中点）——
 *     不能拿 `normKey` 的宽类来当归并键：归并没有第二道闸门兜假阳性，
 *     实测宽类会多出 2 组**假并**（续作被并进前作）。详见 `GROUP_DECOR` 注释。
 *  ⚠️ 键为空时**不挂字段** —— 空键会让所有条目并成一行（比不并更糟）；
 *     前端取不到 `nkey` 时退回旧键，宁可少并。
 *
 *  ★★ v10.61：`withNKey`（单条）→ **`withNKeys`（整批）**。
 *     第二例用户现场（2026-10-12 截图，同一晚）：搜「三国无双」出两行 ——
 *     机地 `真・三国无双 起源` 与 XD `真三国无双：起源`，**Steam AppID 都是 2384580**。
 *     名称键兜不住（机地用中点+空格、XD 用全角冒号，而 `：` 被刻意保留）⇒ 改为
 *     **两级归并**：名称键 ∪（AppID 相同 ∧ 非独立发行 ∧ 名称闸门）。
 *
 *     为什么要**批量**：AppID 相同是「两条目之间的关系」，单条算不出来。若改成
 *     单条算的「AppID 优先」，用户当晚刚修好的古惑狼那组会**被拆回去** ——
 *     机地那条自带 `appid`、XD 那条 cover 是 `www.xdgame.com/uploads/…` 提不到 AppID。
 *     ★ 并查集只 union 不 split ⇒ 结构上**不可能**把原本能并的拆开，只可能多并。
 *     算法与实测账（86 组合并 / 6 组假并嫌疑全挡）全在 `data/twin.js` 的 `groupKeys`。 */
function withNKeys(items) {
  const arr = Array.isArray(items) ? items : [];
  const keys = twin.groupKeys(arr);
  return arr.map((g, i) => (keys[i] ? Object.assign({}, g, { nkey: keys[i] }) : g));
}

/** ★ v10.52：给**搜索命中**的端游条目挂「按游戏聚合的资源计数」（MOD / 存档 / 修改器）。
 *
 *  为什么要挂：搜索的 4 个桶（端游库 / 手游中心 / 修改器 / 云存档）各自回答一个问题，
 *  但**没有任何一个回答「这款游戏有多少 MOD 和存档」**。实测搜「赛博朋克2077」：
 *  搜索返回 pc=2 / mob=1 / tr=3 / sv=1，而同一条游戏在 `/api/res/game` 上是
 *  `{mod:717, saves:48, trainers:7}` —— 717 个 MOD 一个字都没出现。
 *
 *  数据**早就有**：v10.47 建的 `data/res-groups.js` 已经把 4 路来源按游戏收成一组
 *  （机地社区帖 MOD / 游侠存档文件 / GTrainers / GCM 元数据；★ v10.58 起 FR 已摘除），
 *  还导出了 `countsFor(libId)`，注释里写的就是「详情页挂『本游戏有 N 条 MOD / 存档 / 修改器』」。
 *  ⇒ 这里**只是把已有数字带出来**，不重做任何匹配（铁律 17：匹配口径只有一处）。
 *
 *  ⚠️ 计数全 0 时不挂字段 —— 绝大多数条目一条资源都没有，挂 `{0,0,0}` 只是白占回包体积；
 *     前端据此判断「要不要渲染 chip」，空对象与缺字段必须是同一个意思。
 *  ⚠️ 聚合层要 `build()` 一次（有缓存），失败不能拖垮搜索：catch 住，照旧返回。
 *
 *  ★★ v10.62：挂字段前**必须先确认落在副本上**。
 *     两个 `attach` 都有 `if (!h) return g;` —— BH/PC 两库都命中不到时，`withBh(g)`
 *     返回的是**原对象 g 本身**（gamesDb 内存里的那条记录）。原写法 `const o = withBh(g)`
 *     后直接 `o.res = …` ⇒ **原地写库**。
 *
 *     实测到的后果（2026-10-12 排查用户「联想里看不到 MOD/修改器/存档」时撞见）：
 *       · 同一个进程里，`/api/library?q=赛博朋克2077` 带不带 `res`，**取决于此前有没有
 *         人请求过 `/api/search/all`** —— 请求过（被污染）就带，没请求过就不带。
 *         同一次排查里「三国无双」那组两次测出不同结果，就是它（一度让我怀疑改错了代码）。
 *       · 污染**不可逆且跨接口串数据**：该记录在整个进程生命周期里永久带着**当时那一刻**
 *         的计数，库更新后也不变（脏读），并且会漏进 browse / recent / 首页卡片。
 *     ⇒ 一律落在副本上；已是副本时（attach 命中过）不重复拷。 */
function withRes(g) {
  const b = withBh(g);
  const o = (b === g) ? Object.assign({}, g) : b;
  try {
    const h = resFor(g);
    /* ★ 同时带出 `resId`（计数**归属**的那条库内 id）——
     *   它和 `g.id` 可能不同：赛博朋克2077 的 717 个 MOD 挂在 `xd-191`，
     *   而搜索结果首行是机地那条 `jidi-3277800`。前端 chip 必须拿 `resId` 去开弹窗，
     *   否则 `/api/mods/match?id=jidi-3277800` 查不到，只能靠「名称模糊兜底」撞回来
     *   （能撞对，但那是运气不是设计）。 */
    if (h) { o.res = h.counts; o.resId = h.id; }
  } catch (e) { /* 聚合层没起来就照旧返回 —— 少一行 chip，不能让整个搜索失败 */ }
  /* ★ v10.90：最后一步才叠人工覆盖值 —— 上面 resFor / withBh 全部基于**爬虫原始值**，
   *   所以「改了标题以后资源突然没了」这类事故不会发生（匹配与展示在这里分界）。
   *   没有覆盖时 apply 原样返回 o，不额外拷贝。 */
  return gameProfile.apply(o);
}

/** ★ v10.52：资源计数 + 它的**归属条目 id**。查不到返回 null（而不是 `{0,0,0}`）。
 *
 *  为什么必须有孪生兜底（实测踩到）：端游库里同一款游戏常有 jidi / xd 两条
 *  （双料 13,448），而资源条目只挂在**其中一条**上。实测「赛博朋克2077」：
 *      · xd-191        → {mod:717, saves:104, trainers:22}
 *      · jidi-3277800  → {mod:0,   saves:0,   trainers:0}
 *  只查自己那条的话，搜索结果**第一行**（机地那条，也是主行）会显示「没有资源」——
 *  而它下面那条 chips 里反而挂着 717，读起来像 bug。
 *
 *  兜底路径复用 `data/twin.js`（双源对齐的**唯一真源**，铁律 17）：
 *  机地条目走 `jidiIdIndex` 精确键（记忆化 Map，O(1)），XD 条目走 `jidiUrl+tid`。
 *  两条都是精确键，不走名称模糊匹配 —— 这里不需要「尽力而为」，只需要「准」。
 *
 *  ⚠️ 只在**自己那条为 0** 时才去找孪生：绝大多数条目本来就没资源，
 *     每次都查孪生等于给搜索加一趟白跑。
 *  @returns {{counts: {mod:number,saves:number,trainers:number}, id: string}|null} */
function resFor(g) {
  let r;
  try { r = resGroups.countsFor(g.id); } catch (e) { return null; }
  if (r.mod || r.saves || r.trainers) return { counts: r, id: g.id };
  try {
    const tw = twin.twinOf({ id: g.id, title: g.title, src: g.source });
    const t = tw && tw.url ? parseDetailUrl(tw.url) : null;
    if (!t) return null;
    const alt = (t.source === 'jidi' ? 'jidi-' : 'xd-') + t.id;
    if (alt === g.id) return null;                 // 兜回自己 ⇒ 没有另一条，别白算
    const r2 = resGroups.countsFor(alt);
    return (r2.mod || r2.saves || r2.trainers) ? { counts: r2, id: alt } : null;
  } catch (e) { return null; }
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
  /* ★ v10.46：`stdio` 的 stdin 必须 'ignore' —— 沙箱（WorkBuddy）里 node 起子进程时
   *   stdin 若是 pipe（**node 默认值**）⇒ 直接 EBUSY，`/api/bh/refresh` 会永远起不来。
   *   见 tools/check-stdio-guard.js 与 PITFALLS.md 第十八节 6。 */
  const p = spawn(process.execPath, [path.join(__dirname, 'tools', 'refresh-bannerhub.js'), '--json'],
    { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] });
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
//   tr=1 / sv=1         → 只看「修改器」/「存档」库收录到的（v10.5，按端游库 id 关联）
//                         ★ v10.57 起术语统一为「存档」（原名「云存档」，见 data/xref.js 头）
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

// GET /api/xref/stats — 「有修改器 / 有存档」两个横切集合的规模（前端空态与校验用）
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
  /* ★ v10.17：机型清单的「列不全」根因 —— 索引里的 `devices` 取自社区库**聚合摘要**
   *   （`bannerhub.json` 的 `dv`），而那个字段是上游的 **6 格摘要**（全库最大长度就是 6，
   *   255 款游戏正好卡在 6 格）→ 详情页结构性最多只能显示 6 台，多出来的机型被上游丢掉了。
   *   全量在**逐条配置**里（`data/bhparams.json` 的 `device`，写法也更规范：
   *   摘要 `MTN NX3` vs 逐条 `HONOR MTN-NX3`）。
   *   这里把两边并起来（按「剥品牌前缀 + 去分隔符」对齐同一台手机，取信息更全的写法）。
   *   实测（终极漫画英雄vs卡普空3）：6 台 → 11 台。 */
  let devices = [], devMerge = null;
  if (hit) {
    devMerge = deviceset.mergeReport(hit.devices || [], bhparams.cachedDevices(hit.bhKeys || []));
    devices = devMerge.merged;
  }
  res.json({ ok: true, t, hit: hit ? {
    name: hit.name, alt: hit.alt, configs: hit.configs, records: hit.records,
    tier: hit.tier, tiers: hit.tiers, gpus: hit.gpus, chips: hit.chips,
    devices,
    devicesCnt: devices.length,
    /* 诊断用：摘要里有几台、合并后又多出哪几台（前端可据此如实说明） */
    devicesSummary: devMerge ? devMerge.summary : [],
    devicesSummaryCnt: devMerge ? devMerge.summaryCnt : 0,
    devicesAdded: devMerge ? devMerge.added : [],
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
    items: list.map((x) => {
      /* ★ v10.81：fling 条目挂流代理直链（flingdl.attach 返回 [{kind,url,file}]）；
       * ★ P1b：the_cheat_script 条目挂外链（tcsdl.attach 返回 [{kind,url,ext:true}]）。
       *   两个源 origin 互斥，先到先得即可。 */
      const dl = flingdl.attach(x) || tcsdl.attach(x);
      return {
        name: x.name, zh: x.zh, version: x.version, source: x.source,
        origin: x.origin, officialUrl: x.officialUrl,
        libId: x.libId, libTitle: x.libTitle,
        ...(dl ? { dl } : {}),
      };
    }),
  });
});

/* ★ v10.81：Thunderstore MOD 直链 —— GET /api/ts/mods?id=<libId>&t=<名>&limit=N
 *   MOD 页签第四路：机地帖（网盘）之外唯一的**自托管直链**源。按 libId 精确命中；
 *   ?t= 只做 gamesDb 一跳解析（修好的那个 search().items）。 */
app.get('/api/ts/mods', (req, res) => {
  let id = String(req.query.id || '').trim();
  const t = String(req.query.t || '').trim();
  if (!id && t) {
    const g = (gamesDb.search(t, 1).items || [])[0];
    if (g) id = g.id;
  }
  const limit = Math.min(60, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const g = id ? tsmods.byLib(id) : [];
  res.json({
    ok: true, id, t, count: g.length,
    community: g.length ? (tsmods.RAW.games.find((x) => x.libId === id) || {}).community || '' : '',
    items: tsmods.slim(id, limit),
  });
});

/* ★ v10.86：FitGirl Repack —— 本体页签的第三下载档（机地/XD 网盘之外）。
 *   形态与 TCS 外链同款（ext:true 新标签直开原站文章页），零直链维护：
 *   repack 更新换链不落我们库，点开页面永远是最新链。
 *   ?id= 主键（库 id）；?t= 兜底走 gamesDb 一跳解析（同 /api/ts/mods 形态）。 */
app.get('/api/fitgirl/repacks', (req, res) => {
  let id = String(req.query.id || '').trim();
  const t = String(req.query.t || '').trim();
  if (!id && t) {
    const g = (gamesDb.search(t, 1).items || [])[0];
    if (g) id = g.id;
  }
  res.json({
    ok: true, id, t, count: fitgirl.byGame(id).length,
    items: fitgirl.slim(id, 8),
  });
});

/* ★ v10.86：FitGirl magnet 按需现抓。为什么不做进目录快照：目录 82 页是轻量字段
 *   （content 拉全量曾把 6 页撑截断），magnet 在文章正文里 —— 只能单篇按需抓。
 *   ★ 防限速：单篇落 .cache/fitgirl/<slug>.json，TTL 24h（repack 页 stable，正文不常改）。
 *   ★ SSRF 白名单：slug 必须 /^[a-z0-9-]+$/ 且在 fitgirl.json 表内（URL 只由自家数据拼）。
 *   magnet 是开放协议 —— 前端「复制磁力」给任意 BT 客户端用；自研下载器（P3）上线后
 *   只是前端调起目标替换，本端点不变。 */
const FG_MAGNET_TTL = 24 * 3600 * 1000;
app.get('/api/fitgirl/magnet', async (req, res) => {
  const slug = String(req.query.slug || '').trim();
  const id = String(req.query.id || '').trim();
  if (!/^[a-z0-9-]+$/.test(slug) || !fitgirl.has(slug)) {
    return res.status(400).json({ ok: false, error: 'bad slug（白名单外）' });
  }
  const entry = fitgirl.byGame(id).find((x) => x.slug === slug) ||
    { slug, url: 'https://fitgirl-repacks.site/' + slug + '/' };
  const fs = require('fs');
  const path = require('path');
  const cacheDir = path.join(__dirname, '.cache', 'fitgirl');
  const cacheFile = path.join(cacheDir, slug + '.json');
  try {
    const st = fs.statSync(cacheFile);
    if (Date.now() - st.mtimeMs < FG_MAGNET_TTL) {
      const j = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      return res.json({ ...j, cached: true });
    }
  } catch (e) { /* 无缓存/过期，现抓 */ }
  try {
    const r = await fetch(entry.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36' },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const html = await r.text();
    /* 页面里 magnet 的 & 有两种转义形态（&amp; 与 &#038;，实测后者同样在场）—— 还原后再去重 */
    const seen = new Set();
    const magnets = [];
    for (const m of html.matchAll(/magnet:\?xt=urn:btih:[^"'\s<>]+/g)) {
      const mg = m[0].replace(/&amp;/g, '&').replace(/&#0?38;/g, '&');
      if (!seen.has(mg)) { seen.add(mg); magnets.push(mg); }
      if (magnets.length >= 5) break;
    }
    const out = { ok: true, slug, url: entry.url, count: magnets.length, magnets };
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify({ ...out, fetchedAt: new Date().toISOString() }));
    res.json(out);
  } catch (e) {
    res.status(502).json({ ok: false, error: 'FitGirl 抓取失败: ' + String((e && e.message) || e) });
  }
});

/* ── v10.88 GET /api/fitgirl/parts?slug=&id= ──
 *  下载源结构化：主 repack 组 / 变体组 / fg-optional-* 附件组，每组跨 3 个镜像归并。
 *  ★ 为什么按需现抓而不落库：全量落库是十几万条链接（5,811 游戏 × ~30 卷），
 *    fitgirl.json 会从 1.26MB 涨到几十 MB，载荷与每日同步全变重 —— 而收益只是省一次抓取。
 *    体量换收益不划算（v10.88 实测决策，见 docs/versions/v10.88.md）。
 *  ★ 缓存与白名单口径同 magnet：slug 必须在 fitgirl 表内（防 SSRF），24h TTL 落 .cache。 */
const FG_PARTS_TTL = 24 * 3600 * 1000;
/* ★ 缓存结构版本：解析器输出结构变化时 +1，旧缓存在读取时被判失效 ⇒ 自动重抓。
 *   踩过的坑：v10.88 加 mode 字段后，旧缓存返回没有 mode 的对象，前端/探针看到 undefined
 *   却以为代码没生效（TTL 24h 内一直这样）。缓存内容必须自带版本。 */
const FG_PARTS_VER = 2;
app.get('/api/fitgirl/parts', async (req, res) => {
  const slug = String(req.query.slug || '').trim();
  const id = String(req.query.id || '').trim();
  if (!/^[a-z0-9-]+$/.test(slug) || !fitgirl.has(slug)) {
    return res.status(400).json({ ok: false, error: 'bad slug（白名单外）' });
  }
  const entry = fitgirl.byGame(id).find((x) => x.slug === slug) ||
    { slug, url: 'https://fitgirl-repacks.site/' + slug + '/' };
  const fsMod = require('fs');
  const pathMod = require('path');
  const cacheDir = pathMod.join(__dirname, '.cache', 'fitgirl');
  const cacheFile = pathMod.join(cacheDir, slug + '.parts.json');
  const fresh = String(req.query.fresh || '') === '1';
  if (!fresh) {
    try {
      const st = fsMod.statSync(cacheFile);
      if (Date.now() - st.mtimeMs < FG_PARTS_TTL) {
        const j = JSON.parse(fsMod.readFileSync(cacheFile, 'utf8'));
        if (j.v === FG_PARTS_VER) return res.json({ ...j, cached: true });
      }
    } catch (e) { /* 无缓存/过期 ⇒ 现抓 */ }
  }
  try {
    const r = await fetch(entry.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36' },
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const html = await r.text();
    const parsed = fitgirlParts.parse(html);
    const out = {
      ok: true, v: FG_PARTS_VER, slug, url: entry.url,
      fetchedAt: new Date().toISOString(),
      /* mode: inline（分卷可归并）/ container（清单在 paste 或 filecrypt 里）/ none（无下载区） */
      mode: parsed.mode,
      magnet: parsed.magnet,
      sets: parsed.sets,
      containers: parsed.containers.slice(0, 6),
      stats: parsed.stats,
      warnings: parsed.warnings,
    };
    /* 只有「既无分卷也无容器」才算没有下载区；只给容器的帖是正常形态（实测占 40%），
     * 必须 200 返回容器 + 磁力，报 404 会让前端把一半游戏判成「不支持」。 */
    if (parsed.mode === 'none') {
      return res.status(404).json({ ok: false, error: '该帖没有下载区（预告/汇总帖）', slug, url: entry.url, magnet: parsed.magnet });
    }
    fsMod.mkdirSync(cacheDir, { recursive: true });
    fsMod.writeFileSync(cacheFile, JSON.stringify(out));
    res.json(out);
  } catch (e) {
    res.status(502).json({ ok: false, error: 'FitGirl 下载源抓取失败: ' + String((e && e.message) || e) });
  }
});

/* ══════════════════════════════════════════════════════════════════════════
 * ★ v10.93 云下载引擎：磁力 → 元数据 → 选文件 → 服务端下载 → 保存到电脑
 *
 * 用户口径（2026-10-21）：
 *   「用户只操作线上网页，不安装本地下载工具、不唤起第三方客户端；
 *     下载引擎运行在我们自己的服务器。」
 *
 * ★ 为什么 preview 与 batches 必须分成两步，不能一个接口吃下磁力就开下：
 *   磁力链接**不含体积**。要判「≤30 GB」必须先把元数据拉下来（4–9 秒）。
 *   合成一个接口的结果是：用户点了「下载」，等 8 秒，然后被告知「太大了」——
 *   而这 8 秒已经把配额占掉了。分成两步，用户能在看到文件清单时就放弃，不占配额。
 *
 * ★ 为什么 previewId 必须由服务端发、不能把种子路径回传给前端：
 *   一旦前端能传路径，`torrentPath=/etc/passwd` 就能被 addTorrent 读出来。
 *   预览结果留在服务端内存里，前端只拿到一个不透明 id。
 * ══════════════════════════════════════════════════════════════════════════ */

/** previewId → { at, magnet, btih, name, totalBytes, files, torrentPath, dir } —— 含服务器路径，绝不下发 */
const DLP = new Map();
/** ip → [时间戳] —— 预览频次（预览会触发真实 DHT 流量，不设限等于开放 DHT 查询代理） */
const DLP_RATE = new Map();
let dlPreviewBusy = 0;
const DL_PREVIEW_CONCURRENCY = 2;

function dlPurge() {
  const now = Date.now();
  for (const [k, v] of DLP) if (now - v.at > dlGuard.PREVIEW_TTL_MS) DLP.delete(k);
  for (const [k, arr] of DLP_RATE) {
    const keep = arr.filter((t) => now - t < 300000);
    if (keep.length) DLP_RATE.set(k, keep); else DLP_RATE.delete(k);
  }
}

function dlRateOk(ip) {
  const now = Date.now();
  const arr = (DLP_RATE.get(ip) || []).filter((t) => now - t < 300000);
  if (arr.length >= 10) return false;
  arr.push(now);
  DLP_RATE.set(ip, arr);
  return true;
}

function diskFreeBytes() {
  try {
    fs.mkdirSync(dlEngine.ROOT, { recursive: true });
    const s = fs.statfsSync(dlEngine.ROOT);
    const free = Number(s.bavail) * Number(s.bsize);
    return Number.isFinite(free) && free > 0 ? free : -1;
  } catch (e) { return -1; }
}

/** 对外视图：剥掉 rel / absPath 等服务器内部字段 */
function dlTaskView(t) {
  return {
    id: t.id,
    name: t.name,
    btih: t.btih,
    state: t.state,
    /* ★ 两个体积必须都对外：totalBytes = 实际传输量（进度分母，引擎回填），
       selBytes = 所选文件之和（用户勾了什么）。只发前者 ⇒ 勾 69 B 的用户看到「传输 3.9 MB」会困惑；
       只发后者 ⇒ 分母与分子口径不一致，进度会出现 >100%。 */
    totalBytes: t.totalBytes,
    selBytes: t.selBytes || 0,
    completedBytes: t.completedBytes,
    speed: t.speed,
    error: t.error,
    createdAt: t.createdAt,
    expiresAt: t.expiresAt,
    files: (t.files || []).map((f) => ({ index: f.index, name: f.name, length: f.length })),
  };
}

/* 进度同步：500ms 节流。★ 只写内存不落盘（见 download-tasks.patch 的 persist 说明），
   但**状态位变化**必须落盘 —— 否则容器重启后任务表里全是上次的 downloading。 */
let dlLastSync = 0;
let dlSyncing = null;
const DL_TERMINAL = new Set(['ready', 'failed', 'cancelled', 'expired']);
async function dlSync(force) {
  const now = Date.now();
  if (!force && now - dlLastSync < 500) return;
  if (dlSyncing) return dlSyncing;
  dlSyncing = (async () => {
    for (const t of dlTasks.list()) {
      if (!t.gid || DL_TERMINAL.has(t.state)) continue;
      const s = await dlEngine.status(t.gid);
      if (!s.ok) continue;
      const stateChanged = s.state !== t.state;
      const fields = {
        state: s.state,
        completedBytes: s.completedBytes,
        speed: s.speed,
        error: s.error || '',
      };
      /* totalBytes 由引擎回填「实际传输量」（建任务时留 0）：BT 按块传，
         这个数会大于所选文件之和，且它是进度条的**唯一**分母（同口径才不会分子>分母）。 */
      if (s.totalBytes > 0) fields.totalBytes = s.totalBytes;
      if (s.selTotalBytes > 0 && !t.selBytes) fields.selBytes = s.selTotalBytes;
      if (s.state === 'ready') fields.expiresAt = Date.now() + dlGuard.TASK_TTL_MS;
      dlTasks.patch(t.id, fields, { persist: stateChanged });
    }
    dlLastSync = Date.now();
  })().finally(() => { dlSyncing = null; });
  return dlSyncing;
}

/* ── ① POST /api/downloads/previews  { magnet } ── */
app.post('/api/downloads/previews', async (req, res) => {
  const ip = clientIp(req);
  if (!dlRateOk(ip)) return res.status(429).json({ ok: false, error: '预览请求过于频繁，请 5 分钟后再试' });
  const mg = dlGuard.parseMagnet(req.body && req.body.magnet);
  if (!mg.ok) return res.status(400).json({ ok: false, error: mg.reason });
  if (dlPreviewBusy >= DL_PREVIEW_CONCURRENCY) {
    return res.status(429).json({ ok: false, error: '服务器正在解析其他种子，请稍后重试' });
  }
  dlPreviewBusy++;
  const t0 = Date.now();
  try {
    const p = await dlEngine.preview(String(req.body.magnet).trim(), {
      dir: path.join(dlEngine.PREVIEW_ROOT, mg.btih),
    });
    if (!p.ok) return res.status(502).json({ ok: false, error: p.error || '解析失败' });
    if (!p.files.length) return res.status(502).json({ ok: false, error: '种子内没有文件' });
    if (p.totalBytes > dlGuard.MAX_TASK_BYTES) {
      /* 体积超限**不给 previewId**：给了 id 就等于留了一条「稍后再试」的暗示，
         而体积是不会变的。直接回结构化判据，前端据此展示「建议本机客户端」。 */
      return res.status(200).json({
        ok: false, code: 'too-large', name: p.name, totalBytes: p.totalBytes,
        error: '任务体积 ' + dlGuard.gb(p.totalBytes) + ' GB，超过本站单任务上限 '
          + dlGuard.gb(dlGuard.MAX_TASK_BYTES) + ' GB',
      });
    }
    const id = 'pv_' + crypto.randomBytes(9).toString('hex');
    dlPurge();
    if (DLP.size > 200) DLP.delete(DLP.keys().next().value);
    DLP.set(id, {
      at: Date.now(), magnet: String(req.body.magnet).trim(), btih: p.btih,
      name: p.name, totalBytes: p.totalBytes, files: p.files,
      torrentPath: p.torrentPath, dir: p.dir,
    });
    res.json({
      ok: true, previewId: id, name: p.name, btih: p.btih,
      totalBytes: p.totalBytes, tookMs: Date.now() - t0,
      files: p.files.map((f) => ({ index: f.index, name: f.name, length: f.length })),
      limits: {
        maxTaskBytes: dlGuard.MAX_TASK_BYTES,
        maxFiles: dlGuard.MAX_FILES,
      },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: '解析失败: ' + String((e && e.message) || e) });
  } finally {
    dlPreviewBusy--;
  }
});

/* ── ② POST /api/downloads/batches  { previewId, files:[index...] } ── */
app.post('/api/downloads/batches', async (req, res) => {
  const ip = clientIp(req);
  dlPurge();
  const pv = DLP.get(String((req.body && req.body.previewId) || ''));
  if (!pv) return res.status(400).json({ ok: false, error: '预览已过期（30 分钟），请重新解析磁力' });
  const q = dlGuard.checkQuota(ip, dlTasks.list(), Date.now());
  if (!q.ok) return res.status(429).json({ ok: false, code: q.code, error: q.reason });
  const sz = dlGuard.checkSize(pv.totalBytes);
  if (!sz.ok) return res.status(400).json({ ok: false, code: sz.code, error: sz.reason });
  const free = diskFreeBytes();
  if (free > 0) {
    const d = dlGuard.checkDisk(free);
    if (!d.ok) return res.status(503).json({ ok: false, code: d.code, error: d.reason, freeBytes: free });
  }
  /* 选择集：只认 preview 里真实存在的 index（前端传什么都行，服务端重新求交） */
  const want = Array.isArray(req.body.files) ? req.body.files.map(Number) : [];
  const valid = pv.files.filter((f) => !want.length || want.includes(f.index));
  if (!valid.length) return res.status(400).json({ ok: false, error: '没有选中任何文件' });
  const pickedBytes = valid.reduce((a, f) => a + f.length, 0);
  if (pickedBytes <= 0) return res.status(400).json({ ok: false, error: '选中文件体积为 0' });
  const sz2 = dlGuard.checkSize(pickedBytes);
  if (!sz2.ok) return res.status(400).json({ ok: false, code: sz2.code, error: sz2.reason });

  const task = dlTasks.create({
    ip, magnet: pv.magnet, btih: pv.btih, name: pv.name,
    /* ★ 两个体积不能混成一个字段（线上实测两次踩到）：
       · `selBytes` = 所选文件之和 —— 用户**勾了什么**，用于体积上限判定与「所选 69 B」展示；
       · `totalBytes` = 实际**要传多少字节**，交给 aria2 回填（BT 按块传，含同块其它数据）。
       勾 1 个 69 B 的 .bat 实测传输量 4,079,169 B；勾 1 个 103 KB 的 .EXE 传输量 4,194,304 B。
       把它们混用 ⇒「4,079,169 / 69」或「84% 就 ready」，两种错法都出现过。 */
    selBytes: pickedBytes, totalBytes: 0, state: 'queued', files: [],
  });
  const dir = dlTasks.dirOf(task.id);
  try {
    fs.mkdirSync(dir, { recursive: true });
    /* 种子复制进任务目录：预览目录会被定期清理，任务不能依赖它活着 */
    const localTorrent = path.join(dir, '.job.torrent');
    fs.copyFileSync(pv.torrentPath, localTorrent);
    const gid = await dlEngine.addTorrentFile(
      { dir, files: pv.files }, localTorrent, valid.map((f) => f.index),
    );
    let files = [];
    for (let i = 0; i < 12 && !files.length; i++) {
      try {
        const st = await dlEngine.rpc('aria2.tellStatus', [gid, ['files']]);
        const all = dlGuard.sanitizeFiles(st.files || []);
        /* ★ 只保留**已选中**的文件：aria2 的 tellStatus.files 会返回种子内全部条目，
             只是用 selected 标记。若原样存进任务表，「保存到电脑」会列出 48 个分卷里
             根本没下的 47 个，用户点进去得到 404。
           ★ 兜底：万一某些 aria2 版本不回 selected 字段，过滤后会空 ⇒ 退回全部，
             不然任务会变成「有进度但没有可下载文件」。 */
        const sel = all.filter((f) => f.selected);
        files = sel.length ? sel : all;
      } catch (e) { /* 刚入队可能还查不到 */ }
      if (!files.length) await new Promise((r) => setTimeout(r, 250));
    }
    /* rel：文件相对任务目录的路径，保存到电脑时按它定位（对外只给 basename） */
    const withRel = (await dlEngine.rpc('aria2.tellStatus', [gid, ['files']]).catch(() => ({ files: [] })))
      .files || [];
    const relOf = new Map(withRel.map((f) => [Number(f.index), String(f.path || '')]));
    const finalFiles = files.map((f) => {
      const abs = relOf.get(f.index) || '';
      const rel = abs ? path.relative(dir, abs) : f.name;
      return { index: f.index, name: f.name, length: f.length, rel };
    });
    dlTasks.patch(task.id, { gid, state: 'downloading', files: finalFiles, selected: valid.map((f) => f.index) });
    res.json({ ok: true, task: dlTaskView(dlTasks.get(task.id)) });
  } catch (e) {
    dlTasks.patch(task.id, { state: 'failed', error: String((e && e.message) || e) });
    res.status(500).json({ ok: false, error: '入队失败: ' + String((e && e.message) || e) });
  }
});

/* ── ③ GET /api/downloads/tasks  （默认只看自己的 / ?all=1 需管理员） ── */
app.get('/api/downloads/tasks', async (req, res) => {
  const all = String(req.query.all || '') === '1';
  if (all && !adminGuard(req, res)) return;
  try {
    if (!all) await dlSync(false);
  } catch (e) { /* 引擎挂了也照样把表里已有的状态回给前端 */ }
  const ip = clientIp(req);
  /* ★ `?ids=` 显式查询：id 是 80 bit 随机（见 download-tasks.newId），能拿到就是创建者。
     线上实测同一脚本两次请求出口 IP 不同 ⇒ 单靠 IP 过滤会「刚建的任务查不到」。 */
  const ids = String(req.query.ids || '').split(',').map((x) => x.trim()).filter(Boolean);
  const list = dlTasks.list()
    .filter((t) => all || (ids.length ? ids.includes(t.id) : t.ip === ip))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50)
    .map(dlTaskView);
  res.json({ ok: true, count: list.length, engine: dlEngine.info(), tasks: list });
});

/* ── ④ POST /api/downloads/tasks/:id/actions  { action: pause|resume|cancel } ── */
app.post('/api/downloads/tasks/:id/actions', async (req, res) => {
  const t = dlTasks.get(String(req.params.id || ''));
  if (!t) return res.status(404).json({ ok: false, error: '任务不存在' });
  /* ★ 不按 IP 校验：任务 id 是 80 bit 随机，能拿到 id 就说明是创建者（见 newId 注释）。
     IP 会因 NAT/多出口变化，拿它当唯一凭据会把本人挡在外面。 */
  const action = String((req.body && req.body.action) || '');
  if (!['pause', 'resume', 'cancel'].includes(action)) {
    return res.status(400).json({ ok: false, error: 'action 只能是 pause / resume / cancel' });
  }
  try {
    if (action === 'cancel') {
      if (t.gid) { try { await dlEngine.act(t.gid, 'cancel'); } catch (e) { /* 引擎里已没有 */ } }
      dlTasks.patch(t.id, { state: 'cancelled', speed: 0, expiresAt: Date.now() + 60 * 60 * 1000 });
      dlTasks.rmDir(t.id);
    } else {
      if (!t.gid) return res.status(409).json({ ok: false, error: '任务没有可操作的下载句柄（引擎可能重启过）' });
      await dlEngine.act(t.gid, action);
      dlTasks.patch(t.id, { state: action === 'pause' ? 'paused' : 'downloading' });
    }
    await dlSync(true);
    res.json({ ok: true, task: dlTaskView(dlTasks.get(t.id)) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
});

/* ── ⑤ GET /api/downloads/tasks/:id/files/:fid  （保存到电脑） ── */
app.get('/api/downloads/tasks/:id/files/:fid', async (req, res) => {
  const t = dlTasks.get(String(req.params.id || ''));
  if (!t) return res.status(404).json({ ok: false, error: '任务不存在' });
  /* 同上：id 即凭据，不按 IP 卡 */
  if (t.state !== 'ready') return res.status(409).json({ ok: false, error: '文件还没下载完' });
  const fid = Number(req.params.fid);
  const f = (t.files || []).find((x) => x.index === fid);
  if (!f) return res.status(404).json({ ok: false, error: '文件不存在' });
  const base = dlTasks.dirOf(t.id);
  const abs = path.resolve(base, f.rel || f.name);
  /* 路径越界检查：种子里的文件名是可以构造的（`../../etc/passwd`），
     虽然 aria2 会净化，但这是**唯一一个把服务器路径直接交给 fs 的地方**，必须自己再判一次。 */
  if (!abs.startsWith(path.resolve(base) + path.sep)) {
    return res.status(400).json({ ok: false, error: '文件路径越界' });
  }
  if (!fs.existsSync(abs)) return res.status(404).json({ ok: false, error: '文件已不在服务器上（可能已过期清理）' });
  res.download(abs, f.name, (err) => {
    if (err && !res.headersSent) res.status(500).json({ ok: false, error: '读取失败' });
  });
});

/* ── ⑥ GET /api/downloads/tasks/:id/archive  （一键打包成 zip） ──
 * 用户口径（v10.94）：「为什么现在点击下载后并没有拉起下载（自动打包下载到一个压缩包）」。
 * 原来是「每个文件一个保存按钮」—— 一个 7 分卷的包要点 7 次、弹 7 个保存框，
 * 用户的第一反应自然是「点了没反应」。
 *
 * 为什么做成**流式**而不是「先打包落盘再给链接」：
 *   · 落盘要再占一份与任务等大的磁盘（30 GB 上限 ⇒ 再吃 30 GB）；
 *   · 打包期间用户只能干等，没有进度；
 *   · 流式是边读边发，点下去立刻开始传，磁盘增量为 0。
 * 代价：**不支持 Range 续传**（流式不可随机访问）。要续传就用单文件端点，
 *   这一点在前端明写，不让用户点完才发现。
 */
app.get('/api/downloads/tasks/:id/archive', async (req, res) => {
  const t = dlTasks.get(String(req.params.id || ''));
  if (!t) return res.status(404).json({ ok: false, error: '任务不存在' });
  if (t.state !== 'ready') return res.status(409).json({ ok: false, error: '文件还没下载完' });
  const base = path.resolve(dlTasks.dirOf(t.id));
  const list = [];
  for (const f of (t.files || [])) {
    if (!f) continue;
    const abs = path.resolve(base, f.rel || f.name);
    /* 与单文件端点同一道越界检查（种子内文件名可构造） */
    if (!abs.startsWith(base + path.sep)) continue;
    if (!fs.existsSync(abs)) continue;
    list.push({ abs, name: f.name });
  }
  if (!list.length) return res.status(404).json({ ok: false, error: '服务器上没有可打包的文件（可能已过期清理）' });

  const zipName = (String(t.name || 'gamehub-download').replace(/[\\/:*?"<>|\r\n]+/g, '_').trim().slice(0, 80) || 'gamehub-download') + '.zip';
  const asciiFallback = zipName.replace(/[^\x20-\x7e]/g, '_');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition',
    'attachment; filename="' + asciiFallback + '"; filename*=UTF-8\'\'' + encodeURIComponent(zipName));
  res.setHeader('Cache-Control', 'no-store');
  /* 不给 Content-Length（流式未知）⇒ 浏览器显示「未知大小」，但进度条照常走 */
  console.log('[downloads] archive', t.id, list.length + ' files', 'zip=' + zipName);
  const r = await zipStream.pipeZip(res, list);
  console.log('[downloads] archive done', t.id, JSON.stringify(r));
});

/* ── ⑦ GET /api/downloads/debug  （仅管理员：引擎日志 + 原始 tellStatus） ──
 * ★ 为什么必须有这个端点：BT 下载失败有九成不是代码错，而是「没有 seeder / tracker 拒绝 /
 *   端口被封」。只回一个 "failed" 会让人在代码里瞎找。aria2 的 stderr 与 tellStatus 的
 *   numSeeders/connections 才是现场证据。日志含内网路径，所以挂 adminGuard。 */
app.get('/api/downloads/debug', async (req, res) => {
  if (!adminGuard(req, res)) return;
  /* ★ 先 ready()：rpc() 依赖启动时生成的 rpcUrl，没启动时是空串 ⇒
     fetch('') 抛 "Failed to parse URL from "，看起来像代码错，实际只是「引擎还没起」。
     诊断端点自己必须能把引擎拉起来，否则它连「引擎起不起得来」都测不出。 */
  try { await dlEngine.ready(); } catch (e) { /* 下面如实回报 */ }
  const t = req.query.id ? dlTasks.get(String(req.query.id)) : null;
  let raw = null;
  if (t && t.gid) {
    try {
      raw = await dlEngine.rpc('aria2.tellStatus', [t.gid, [
        'status', 'totalLength', 'completedLength', 'downloadSpeed', 'uploadSpeed',
        'numSeeders', 'connections', 'errorMessage', 'errorCode', 'infoHash', 'dir',
      ]]);
    } catch (e) { raw = { error: String(e && e.message) }; }
  } else if (!t) {
    try { raw = { global: await dlEngine.rpc('aria2.getGlobalStat', []) }; } catch (e) { raw = { error: String(e && e.message) }; }
  }
  res.json({ ok: true, engine: dlEngine.info(), aria2: raw, log: dlEngine.log().slice(-2500), tasks: dlTasks.list().length });
});

/* ── ⑥ GET /api/downloads/quota  （前端先问一句，避免点完才被告知超限） ── */
app.get('/api/downloads/quota', (req, res) => {
  const ip = clientIp(req);
  const q = dlGuard.checkQuota(ip, dlTasks.list(), Date.now());
  const free = diskFreeBytes();
  res.json({
    ok: true,
    canStart: q.ok && (free < 0 || free >= dlGuard.MIN_FREE_BYTES),
    reason: q.ok ? '' : q.reason,
    limits: {
      maxTaskBytes: dlGuard.MAX_TASK_BYTES,
      maxActivePerIp: dlGuard.MAX_ACTIVE_PER_IP,
      maxDailyPerIp: dlGuard.MAX_DAILY_PER_IP,
      minFreeBytes: dlGuard.MIN_FREE_BYTES,
      taskTtlMs: dlGuard.TASK_TTL_MS,
    },
    freeBytes: free,
    engine: dlEngine.info(),
  });
});

/* 启动 5 秒后后台预热下载引擎。
 * ★ 延迟 5 秒是因为它要 spawn/apt，放在监听刚建立时会和首屏并发生抢；
 *   5 秒后首屏已出，装东西不再影响任何人。装不上不报错 —— 用户点下载时还有同步兜底。 */
setTimeout(() => {
  try { dlEngine.warmup(); } catch (e) { /* 预热失败不影响站点 */ }
}, 5000).unref();

/* 过期清理与进程收尾。★ 定时器必须 unref：否则测试脚本 require 了 server 就永远不退出。 */
setInterval(() => {
  try {
    const dead = dlTasks.sweep(Date.now());
    for (const t of dead) dlTasks.rmDir(t.id);
    dlPurge();
    /* 预览目录 30 分钟一清（里面有 .torrent，几十 KB，量小但会积） */
    const now = Date.now();
    try {
      for (const d of fs.readdirSync(dlEngine.PREVIEW_ROOT)) {
        const p = path.join(dlEngine.PREVIEW_ROOT, d);
        const st = fs.statSync(p);
        if (now - st.mtimeMs > dlGuard.PREVIEW_TTL_MS) fs.rmSync(p, { recursive: true, force: true });
      }
    } catch (e) { /* 目录不存在 */ }
  } catch (e) { /* 清理失败不影响服务 */ }
}, 10 * 60 * 1000).unref();


/* ★ v10.83 实测记录：曾在此加 /api/mx/mods（Modrinth 补充源），实测 0 产出
 *   （Modrinth 是纯 MC 生态平台，搜索描述命中会混入 MC 模组 —— 见 v10.83.md）⇒ 撤下。
 * ★ v10.81：FLiNG 修改器文件流代理 —— GET /api/dl/fling?u=<zip 路径或完整 URL>
 *   为什么必须代理：FLiNG trainer-files 有 Referer 防盗链（实测无 Referer 403），
 *   浏览器从本站点过去必被拦 ⇒ 服务端带 Referer 取流回传。
 *   ★ 入参白名单（防 SSRF）：路径必须以 /wp-content/uploads/ 开头且无 '..'；
 *     完整 URL 只认 flingtrainer.com / archive.flingtrainer.com 且在 /files/ 或 /wp-content/ 下。 */
app.get('/api/dl/fling', async (req, res) => {
  const u = String(req.query.u || '');
  let target = null;
  if (u.startsWith('/') && u.includes('/wp-content/uploads/') && !u.includes('..')) {
    target = 'https://flingtrainer.com' + u;
  } else {
    /* ★ query 传进来时 Express 已解码 ⇒ archive 直链含空格，不能用 \S+（实测 400 假红） */
    const m = u.match(/^https:\/\/(archive\.)?flingtrainer\.com\/(files|wp-content)\/.+\.(zip|rar|exe)$/i);
    if (m && !u.includes('..')) target = u;
  }
  if (!target) return res.status(400).json({ ok: false, error: 'bad u (白名单外)' });
  try {
    const up = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36',
        Referer: 'https://flingtrainer.com/',
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!up.ok || !up.body) {
      return res.status(502).json({ ok: false, error: 'upstream HTTP ' + up.status });
    }
    const fname = decodeURIComponent((target.split('/').pop() || 'fling-trainer.zip'));
    res.setHeader('Content-Type', up.headers.get('content-type') || 'application/octet-stream');
    const len = up.headers.get('content-length');
    if (len) res.setHeader('Content-Length', len);
    res.setHeader('Content-Disposition', 'attachment; filename="' + fname.replace(/"/g, '') + '"');
    const reader = up.body.getReader();
    req.on('close', () => { try { reader.cancel(); } catch (e) { /* 已结束 */ } });
    reader.closed.catch(() => { /* 上游断流：req 已挂 close 兜底，不致崩进程 */ });
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(value)) {
        await new Promise((r) => res.once('drain', r));
      }
    }
    res.end();
  } catch (e) {
    if (!res.headersSent) res.status(502).json({ ok: false, error: String(e.message || e).slice(0, 120) });
    else try { res.end(); } catch (e2) { /* 已断开 */ }
  }
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
//   ★ v10.25：额外返回 `counts`（按 kind 分开的条数）。详情页底部要出
//   「下载本体 / 修改器 N / Mod N」三个并排按钮，两个数字必须各自独立 ——
//   之前只有一个 `count`（mod + modifier 混在一起），拿它当「修改器数」是错的：
//   实测「艾尔登法环」`count=98`，而其中真正的修改器只有个位数。
app.get('/api/mods/match', (req, res) => {
  const t = String(req.query.t || '').trim();
  const id = String(req.query.id || '').trim();
  const kind = String(req.query.kind || '').trim();
  let all = id ? mods.byLib(id, '') : [];
  if (!all.length && t) {
    let byName = mods.byGame(t);
    if (!byName.length) {
      const r = mods.list({ q: t, all: '1', sort: 'new', limit: 60 });
      byName = r.items || [];
    }
    all = byName;
  }
  const counts = { mod: 0, modifier: 0 };
  for (const x of all) if (counts[x.kind] != null) counts[x.kind]++;
  const list = kind ? all.filter((x) => x.kind === kind) : all;
  /* limit：详情页的「下载入口」摘要只要 12 条，但 v10.25 的「Mod / 修改器」弹窗
     要铺一屏能滚的列表（赛博朋克2077 单类就有 717 条），所以开出口但**封顶 200**，
     避免一次把整库吐给前端。不传 = 12，老调用点行为不变。 */
  const lim = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 12));
  res.json({ ok: true, t, id, kind: kind || '', count: list.length, counts, items: list.slice(0, lim) });
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

/* ================= 💾 游侠「存档文件」 =================
 *
 * 与上面 /api/saves/*（存档**位置**，Ludusavi manifest）互补：
 * 这里回的是**可下载的存档包**（真直链 / 网盘 / eD2K），源站 = 游侠补丁网存档区。
 *
 * ★ 为什么两条线要分开而不是合并成一条：
 *   位置是「每款游戏多行路径」、文件是「每款游戏 N 个可下载包」，且文件侧只在
 *   匹配上端游库的条目上才有 —— 合并会把 saves.js 的 stats / 分页口径全部搞乱。
 *   前端在「存档」模块里同时展示，但后端保持两个独立口径。
 */

// GET /api/saves-yx/stats — 概览（含直链/网盘/eD2K 各通道条数、解析失败率）
app.get('/api/saves-yx/stats', (_req, res) => res.json(savesYx.stats()));

// GET /api/saves-yx/index — { byLib: {libId: 文件数} } —— 卡片计数用（体积小）
app.get('/api/saves-yx/index', (_req, res) => res.json(savesYx.index()));

// GET /api/saves-yx/match?t=<游戏名>&id=<端游库id> — 某款游戏的存档**文件**
//   ★ v10.46：走 `matchSlim` —— 完整条目带 desc / steps / shots 长文（p50 1.8KB/条），
//     前端一个字段都不用；热门游戏十几条就是几十 KB 的纯浪费。要长文请用 savesYx.match()。
app.get('/api/saves-yx/match', (req, res) => {
  const t = String(req.query.t || '').trim();
  const id = String(req.query.id || '').trim();
  const r = savesYx.matchSlim({ t, id });
  res.json({ ok: true, t, id, count: r.count, items: r.items });
});

/* ============ 📦 端游资源「按游戏聚合」（v10.47 三页签的数据底座） ============
 *
 * 用户口径：「MOD 按游戏做卡片而不是按 MOD」「存档只展示真有存档的而不是存档位置的」
 * 「（修改器）同样按游戏聚合」。
 *
 * 这一组接口把**四路来源**按游戏收成一组一组，前端三个页签共用同一套形状：
 *   cat=mod       机地社区帖 MOD（网盘直链）
 *   cat=saves     游侠存档文件 + GTrainers 存档   ← 「真有存档」
 *   cat=trainers  GCM 清单 + GTrainers 修改器     ← ★ v10.58 起 FR 已摘除（原第 4 路）
 *
 * ★ 与既有的 /api/{mods,saves,trainers}/{list,match} **并存不替代**：
 *     - 那些是「按条」的接口，详情页弹窗 / 其它页面还在用，口径不能动；
 *     - 这里是「按游戏组」的汇总，分组键与排序都是新口径。
 *   ⇒ 所以这不是第二套实现，而是同一批数据（data/res-groups.js 直接读那四个模块）
 *     的**另一种视图**；匹配口径只有一处（抓取阶段的 data/mod-match.js）。
 */
const RES_CATS = ['mod', 'saves', 'trainers'];

// GET /api/res/stats?cat=mod|saves|trainers — 概览（组数 / 条目数 / 有下载链比例 / 分源分布）
app.get('/api/res/stats', (req, res) => {
  const cat = String(req.query.cat || '').trim();
  if (!RES_CATS.includes(cat)) {
    /* list=1 → 一次给三个分区（页签数字胶囊用）；否则报错而不是猜一个 */
    if (req.query.list === '1') {
      const out = {};
      for (const c of RES_CATS) out[c] = resGroups.stats(c);
      return res.json({ ok: true, cats: out, srcLabel: resGroups.SRC_LABEL });
    }
    return res.status(400).json({ ok: false, error: 'cat 必须是 mod / saves / trainers' });
  }
  res.json(resGroups.stats(cat));
});

// GET /api/res/groups?cat=&q=&sort=count|game|new&limit=&offset= — 分页取「游戏组」
app.get('/api/res/groups', (req, res) => {
  const cat = String(req.query.cat || '').trim();
  if (!RES_CATS.includes(cat)) return res.status(400).json({ ok: false, error: 'cat 必须是 mod / saves / trainers' });
  res.json(resGroups.groups(cat, {
    q: req.query.q, sort: req.query.sort, src: req.query.src,
    limit: req.query.limit, offset: req.query.offset,
  }));
});

// GET /api/res/items?cat=&key=&limit= — 展开某一组的全部条目（卡内「展开全部 N 条」）
app.get('/api/res/items', (req, res) => {
  const cat = String(req.query.cat || '').trim();
  const key = String(req.query.key || '').trim();
  if (!RES_CATS.includes(cat)) return res.status(400).json({ ok: false, error: 'cat 必须是 mod / saves / trainers' });
  if (!key) return res.status(400).json({ ok: false, error: '缺少 key' });
  res.json(resGroups.items(cat, key, req.query.limit));
});

// GET /api/res/post?src=&id= — 取**单条**原贴正文（v10.50）
//   用户口径：「有部分帖子的我想你能够获取对应的内容（可以点击弹窗展示标题 + 原贴内容
//             + 图片等）且还需要按照原贴的布局放置」。
//   ★ 为什么是「按需单取」而不是把正文塞进 /api/res/items：
//     正文 p50 约 1KB、最长 6000 字。最大一组 717 条 ⇒ 一次性带上就是 ~700KB，
//     而用户点开的是**其中一条**。列表侧只给 `hasPost` 布尔标记，正文一次取一条。
//   ★ src 没有正文时（gt / fr / gcm）回 `has:false` + HTTP 200 ——
//     那是「这个来源本来就没有正文」，不是错误，别用 4xx 让前端当异常处理。
app.get('/api/res/post', (req, res) => {
  const out = resGroups.post(req.query.src, req.query.id);
  if (!out.ok) return res.status(400).json(out);
  res.json(out);
});

// GET /api/res/game?id=<端游库id>&t=<游戏名>&limit= — 详情页一次拿三个分区
//   ★ 详情页「修改器」「存档」两块卡片的**唯一数据源**（v10.47）：只给能下载的条目，
//     「存档位置」不再从这里出（它在 /api/saves/match，只进弹窗的二级位置视图）。
//   ★ id 缺失时按名字反查一次（详情页偶尔只有标题）。
app.get('/api/res/game', (req, res) => {
  const t = String(req.query.t || '').trim();
  let id = String(req.query.id || '').trim();
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 60));
  if (!id && t) {
    /* ★ v10.81 修复：gamesDb.search() 返回 {q,count,items,topScore}（v10.62 四库统一改造后），
     *   老代码 `search(t,1)[0]` 对对象取 [0] 恒 undefined ⇒ 纯名字查询永远空。
     *   前端弹窗一直 id+t 双发所以没炸；roster / 外部直调 ?t= 才会踩到。 */
    const g = (gamesDb.search(t, 1).items || [])[0];
    if (g) id = g.id;
  }
  const out = { ok: true, id, t, counts: { mod: 0, saves: 0, trainers: 0 }, items: { mod: [], saves: [], trainers: [] } };
  if (id) {
    for (const c of RES_CATS) {
      out.items[c] = resGroups.byLib(c, id, limit);
      out.counts[c] = resGroups.byLib(c, id, 100000).length;
    }
  }
  res.json(out);
});

/* ---- 两个新来源的原始概览（排查用：能分别看到「抓了多少 / 匹配多少」）---- */

// GET /api/gt/stats — GTrainers（存档 + 修改器，真实直链）
app.get('/api/gt/stats', (_req, res) => res.json(gt.stats()));

// GET /api/gt/match?t=&id=&cat=saves|trainers — 某款游戏的 GTrainers 条目
app.get('/api/gt/match', (req, res) => {
  const t = String(req.query.t || '').trim();
  const id = String(req.query.id || '').trim();
  const cat = String(req.query.cat || '').trim();
  res.json(Object.assign({ ok: true, t, id, cat }, gt.matchSlim({ t, id, cat })));
});

/* ★ v10.58：`GET /api/fr/stats` 与 `GET /api/fr/match` 已随 FR 摘除
   （require 处的说明 + docs/sop/FR-fearlessrevolution-抓取SOP.md）。
   ★ 旧版这三条新路由曾是「判线上是不是新版」的区分器之一 —— 摘除后**不能再拿 `/api/fr/stats` 判版**，
     判服务端版本改用 `/api/gt/stats`（v10.47 起）与 `/api/res/stats`（见 tools/_probe-doc-numbers.js）。 */

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
  const selfRec = id ? gamesDb.byIdGet(id) : null;
  if (selfRec) coverCands.push(selfRec.cover || '');
  /* ★ v10.25b：机地条目**0% 带 Steam appid**（实测 3,609 条全是 img2.52jidi.com 形态），
   *   而库里 XD 侧 97.4% 带 appid（14,956 / 15,352）—— 于是「补推荐配置」这一栏
   *   对机地来源的 3,609 款游戏**整个失效**（原先只有一行注释承诺，实际一次都没生效）。
   *   这里补一步：借**孪生条目**的封面去问 Steam。
   *
   *   ⚠️ 两道护栏，缺一不可 —— 配置要求是具体数值，安错比不显示更糟：
   *     ① twinOf 自带的 sameGame 闸门 + 分数阈值（TWIN_MIN_SCORE）；
   *     ② 这里再加一道「中文段完全相等」复核，挡住
   *        「艾尔登法环」↔「艾尔登法环 黑夜君临」这类**同系列不同作品**
   *        （它们是两款游戏，推荐配置完全不同）。
   *   任何一步不确定就**不加候选**，退回「只有源站最低配置」那一栏。 */
  if (id && selfRec && !coverCands.some((c) => pcreq.appidOf(c))) {
    try {
      const zhOf = (s) => String(s || '').split('/')[0].trim().toLowerCase();
      const tw = twin.twinOf({ id, title: t || selfRec.title || '', src: selfRec.source || '' });
      const tt = tw && tw.url ? parseDetailUrl(tw.url) : null;
      const sib = tt ? gamesDb.byIdGet((tt.source === 'jidi' ? 'jidi-' : 'xd-') + tt.id) : null;
      if (sib && sib.source !== selfRec.source && zhOf(sib.title) === zhOf(selfRec.title)) {
        coverCands.push(sib.cover || '');
      }
    } catch (e) { /* 找不到孪生就照旧 —— 宁可一栏，也不安一个错的 */ }
  }
  coverCands.push(String(req.query.cover || '').trim());
  const cover = coverCands.find((c) => pcreq.appidOf(c)) || coverCands[0] || '';
  /* ★ v10.33：库里**顶层 `appid` 字段**也要用上，不能只看封面。
   *   实测（19,010 条端游库）：仅封面能解析出 appid 的 14,997，仅顶层字段有的 3,124，
   *   两路都有 10（10/10 一致）⇒ 顶层字段是**唯一**能覆盖那 3,124 条的通路。
   *   而它们恰恰是**机地独有**的游戏（封面是 img2.52jidi.com，不是 Steam CDN）：
   *   「剑星」3489700 ·「渔力全开」4001890 ·「极限竞速：地平线 6」2483190 ——
   *   它们本来就搜不到 Steam，配置要求只能靠这条。
   *   ⚠️ 不补这一步的后果**实测过**：预热已把剑星的 min+rec 完整抓回（appid 3489700），
   *     但线上查「剑星/Stellar_Blade」走的却是名称搜索命中的另一个条目
   *     （`appid=` 空 · `rec=无`）—— **缓存里有、前端读不到**，而且拿到的质量更差。
   *   优先级：仍以 cover 解析出的 appid 为先（保持既有行为不变），它解析不出才用字段。 */
  const appid = (coverCands.map((c) => pcreq.appidOf(c)).find(Boolean)) ||
    String((selfRec && selfRec.appid) || '').trim();
  try {
    const r = await pcreq.resolve({ title: t, cover, appid });
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

/* ================= 📦 解包配置匹配（v10.20） =================
   把用户手里「一份字段名未知的 JSON」（游戏解包 / 兼容层工具导出）解析成配置画像，
   再对撞 Steam 官方配置库，回答「这套配置能跑哪些游戏」。
   ★ 识别词典在 data/spec-dict.js —— 样本字段变了**只改那一个文件**，接口与前端不动。 */
// GET /api/spec/dict — 判定依据自述（前端「凭什么这么判」面板）
app.get('/api/spec/dict', (_req, res) => res.json(specMatch.dictInfo()));

// POST /api/spec/analyze — body: {json|text, idx, q, sort, only, limit}
app.post('/api/spec/analyze', (req, res) => {
  const body = req.body || {};
  const raw = body.json != null ? body.json : body.text;
  if (raw == null || raw === '') return res.status(400).json({ ok: false, error: '没有收到 JSON 内容' });

  let ex;
  try { ex = specDict.extract(raw); }
  catch (e) { return res.status(400).json({ ok: false, error: '解析异常：' + e.message }); }
  if (!ex.ok) return res.status(400).json({ ok: false, error: ex.error });

  const idx = Math.max(0, Math.min(Number(body.idx) || 0, ex.records.length - 1));
  const cur = ex.records[idx];
  const match = specMatch.analyze(cur.profile, {
    q: body.q, sort: body.sort, only: body.only, limit: body.limit,
  });

  /* 条目可能上千条，回包截断，但把「截断了」如实告诉前端（不静默丢） */
  const CAP = 240;
  const cap = (a) => (a.length > CAP ? a.slice(0, CAP) : a);
  res.json({
    ok: true,
    shape: ex.shape,
    stats: ex.stats,
    records: ex.records.map((r) => ({
      idx: r.idx,
      name: r.profile.name || ('记录 #' + (r.idx + 1)),
      ram: r.profile.ram && r.profile.ram.gb,
      layers: Object.keys(r.profile.layer || {}),
      entries: r.entries.length,
    })),
    current: {
      idx, profile: cur.profile,
      entries: cap(cur.entries),
      unknown: cap(cur.unknown),
      truncated: { entries: cur.entries.length > CAP, unknown: cur.unknown.length > CAP },
    },
    match,
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
//   ★ v10.16：顺带给每条补 `disp`（品牌 + 型号）。这里的 `model` 一半是内部代号
//   （`Xiaomi 2412DPC0AG`），列表里直接铺出来玩家认不出 —— 前端显示 `disp`、
//   回填/查询仍用 `model`（后者才是 /api/device/match 认的键）。
app.get('/api/device/models', (req, res) => {
  try {
    const brand = String(req.query.brand || '').trim();
    const q = String(req.query.q || '').trim();
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const models = deviceMatch.models({ brand, q, limit });
    const out = models.map((m) => {
      let disp = '';
      try { const r = devicemarket.resolve(m.model); disp = (r && r.resolved) ? r.display : ''; } catch (e) { disp = ''; }
      return disp ? { ...m, disp } : m;
    });
    res.json({ ok: true, models: out });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// GET /api/device/match?model=Xiaomi 2412DPC0AG&limit=300 — 能跑的游戏
//   ★ v10.16：`device` 上补 `disp`（品牌 + 型号）。用户输进去的常是内部代号，
//   结果卡抬头显示 `Xiaomi Poco X7 Pro` 比回显 `Xiaomi 2412DPC0AG` 有用得多。
app.get('/api/device/match', (req, res) => {
  try {
    const model = String(req.query.model || req.query.m || '').trim();
    if (!model) return res.status(400).json({ ok: false, error: '缺少参数 model' });
    const limit = Math.min(parseInt(req.query.limit, 10) || 300, 1000);
    const r = deviceMatch.matchGames(model, { limit });
    if (!r.ok) return res.status(404).json(r);
    if (r.device) {
      try {
        const mm = devicemarket.resolve(model);
        if (mm && mm.resolved) r.device = { ...r.device, disp: mm.display, codename: mm.codename || '', variant: mm.variant || '' };
      } catch (e) { /* 译不出就照原样返回，不编造 */ }
    }
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// GET /api/device/specs?models=a|b|c — 批量取机型规格（★ v10.14 / v10.16 加品牌型号）
//   详情页要一次铺出「这款游戏跑过的机型清单」（GTA5 有 7 台），
//   若逐台调 /api/device/match 就是 N+1 —— 这里一次算完。
//   单台失败不影响其他（返回 spec:null，前端显示代号即可），不编造。
//
//   ★ v10.16：同时带回 `mkt`（品牌 + 型号）。社区库里的机型名一半是内部代号
//   （`Xiaomi 2412DPC0AG`），玩家认不出是哪台手机 —— 用 MobileModels 的映射译成
//   `Xiaomi POCO X7 Pro`。这里**顺带返回而不是另开端点**，同样是为了躲 N+1。
app.get('/api/device/specs', (req, res) => {
  try {
    const list = String(req.query.models || '').split(/[|,，]/).map((s) => s.trim()).filter(Boolean).slice(0, 40);
    const out = {};
    for (const m of list) {
      let spec = null;
      try {
        const r = deviceMatch.findDevice(m);
        spec = (r && (r.gpu || r.soc))
          ? { soc: r.soc || '', socVendor: r.socVendor || '', gpu: r.gpu || '', cpu: r.cpu || '', score: r.score || 0, brand: r.brand || '', approx: !!r.approx }
          : null;
      } catch (e) { spec = null; }
      let mkt = null;
      try {
        const mm = devicemarket.resolve(m);
        if (mm && mm.display) {
          mkt = { display: mm.display, brand: mm.brand || '', market: mm.short || mm.market || '', codename: mm.codename || '', variant: mm.variant || '', resolved: !!mm.resolved, via: mm.via };
        }
      } catch (e) { mkt = null; }
      /* ★ v10.18：芯片三级降级的**本地两级**（配对索引 → 串内芯片号），同步、0 网络。
         列表首屏要「品牌 + 型号 + 芯片」一次到位，而 `deviceMatch` 只做配对索引，
         像 `Odin2 QCS8550`（芯片号就写在机型串里）会返回空 —— devicefill 补上这一层。 */
      let chip = '', chipSrc = '';
      try {
        const fl = devicefill.fillLocal(m);
        chip = fl.chip || '';
        chipSrc = fl.chipSrc || '';
      } catch (e) { chip = ''; }
      if (!chip && spec) { chip = spec.soc || spec.gpu || ''; chipSrc = 'pair'; }
      out[m] = Object.assign(spec ? { ...spec, mkt } : (mkt ? { mkt } : {}),
        { chip, chipSrc, needFill: !chip });
      if (!spec && !mkt && !chip) out[m] = null;
    }
    res.json({ ok: true, specs: out });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// GET /api/device/market?models=a|b|c — 只取「品牌 + 型号」（不带芯片规格，体积更小）
app.get('/api/device/market', (req, res) => {
  try {
    const list = String(req.query.models || '').split(/[|,，]/).map((s) => s.trim()).filter(Boolean).slice(0, 60);
    res.json({ ok: true, markets: devicemarket.resolveMany(list) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// GET /api/device/hardware?m=<型号名> — 该手机的完整硬件参数（★ v10.16）
//   数据源 zh.kalvo.com：先按**营销名**搜 slug，再抓设备页解析「章节 → 键值表」。
//   ⚠️ 只认营销名，不认内部代号（`X6873` 搜不到）—— 所以调用方应传 devicemarket 译出的名字。
//   缓存 data/device-specs.json：命中 30 天、未命中 3 天（未命中也要缓存，免得每次空跑）。
//   本端点是**允许联网**的少数端点之一（同 /api/pcreq）：未命中时才实时抓 + 落盘，命中即离线。
app.get('/api/device/hardware', async (req, res) => {
  try {
    const m = String(req.query.m || req.query.model || req.query.q || '').trim();
    if (!m) return res.status(400).json({ ok: false, error: '缺少参数 m（型号名）' });
    const force = String(req.query.force || '') === '1';
    const r = await devicespec.hardware(m, { force });
    if (!r || !r.ok) {
      return res.json({ ok: false, model: m, reason: (r && r.reason) || 'not-found' });
    }
    res.json({
      ok: true, model: m,
      name: r.name, url: r.url || '',
      groups: r.groups || [], digest: r.digest || [],
      cached: !!r.cached,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// GET /api/device/hardware-stats — 硬件参数缓存规模（自查用）
app.get('/api/device/hardware-stats', (_req, res) => {
  try { res.json({ ok: true, ...devicespec.stats() }); }
  catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

// GET /api/device/fill?models=a|b|c&online=0|1 — 缺芯片机型的**补全**（★ v10.18）
//   三级降级：① 配对索引 ② 串内芯片号（`Odin2 QCS8555`）③ 联网 kalvo（仅当 ①②都空）
//   默认 online=1；`online=0` 只做本地（同步、秒回），给不想联网的场景用。
//   结果落盘 data/device-fill.json：命中 30 天、未命中 3 天。
//   ⚠️ 补不到就返回空 chip —— **前端显示「未收录」，绝不编造**。
app.get('/api/device/fill', async (req, res) => {
  try {
    const list = String(req.query.models || req.query.m || '').split(/[|,，]/).map((s) => s.trim()).filter(Boolean).slice(0, 60);
    if (!list.length) return res.status(400).json({ ok: false, error: '缺少参数 models' });
    const online = String(req.query.online == null ? '1' : req.query.online) !== '0';
    const force = String(req.query.force || '') === '1';
    const fills = online
      ? await devicefill.batch(list, { online: true, force, limit: 60, concurrency: 3 })
      : devicefill.localBatch(list);
    res.json({ ok: true, online, count: list.length, fills });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// GET /api/device/fill-stats — 补全缓存规模（自查用：联网命中率）
app.get('/api/device/fill-stats', (_req, res) => {
  try { res.json({ ok: true, ...devicefill.stats() }); }
  catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

// GET /api/device/market-stats — 品牌型号映射表规模
app.get('/api/device/market-stats', (_req, res) => {
  try { res.json({ ok: true, ...devicemarket.stats() }); }
  catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
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

// ---------- 双源加权融合榜 /api/rank（v10.75 换源 + 合并） ----------
// 旧源（v10.74 及以前）：XD 官网**首页** `.hot-soft .plate-list`，实测每档只有 10 行
//   ⇒ 首页要 11–13 个只能靠本地库热度补位（补位条目与真榜混排，观感打折）。
// 新源（v10.75）：XD 官网 `/update/` 页 **8 个 panel、每档实测 100 行、SSR 直出无 AJAX**
//   ⇒ 不再需要补位；并与**机地热榜**做加权融合（用户拍板：双源合并给权重）。
// 档位（用户拍板）：
//   recent 最近更新 → **仅 XD**（机地没有「最近更新」这种榜，不硬凑）
//   hot    人气排名 → XD `hot`     + 机地 `weekly`
//   month  月度排名 → XD `month`   + 机地 `monthly`
//   year   年度排名 → XD `year`    + 机地 `annual`
const RANK_META = {
  recent: { label: '最近更新', src: 'xdgamer', tip: 'XD 官网 · 最近更新' },
  hot: { label: '人气排名', src: 'both', tip: 'XD 人气 + 机地本周热榜 · 加权合并' },
  month: { label: '月度排名', src: 'both', tip: 'XD 月度 + 机地本月热榜 · 加权合并' },
  year: { label: '年度排名', src: 'both', tip: 'XD 年度 + 机地历史热榜 · 加权合并' },
};
/** 档位 → 机地 hotRanks() 的键；null = 该档只有 XD（机地没有「最近更新」） */
const RANK_JIDI_KEY = { recent: null, hot: 'weekly', month: 'monthly', year: 'annual' };
/** 旧参数兼容（v10.74 及以前是 week / month / year / community）—— 外部链接与旧前端都可能带 */
const RANK_ALIAS = { week: 'hot', community: 'hot', quarter: 'month', annual: 'year', good: 'hot', rank: 'year', size: 'year' };
const RANK_PERIODS = Object.keys(RANK_META);

app.get('/api/rank', async (req, res) => {
  const raw = String(req.query.p || '');
  const p = RANK_PERIODS.includes(raw) ? raw : (RANK_ALIAS[raw] || 'recent');
  if (req.query.refresh === '1') cache.delete('rank:' + p);
  try {
    /* ★★ v10.76：**降级结果只短缓存 120s**（正常 1800s）。
       实测依据：首调时机地侧偶发失败 ⇒ 融合退化成仅 XD（`jidiOk=false` / `jidiN=0`），
       而 30 分钟 TTL 会把「双源加权合并」静默钉成单源 —— 连打三次 `refresh=1` 才恢复 `jidiN=12`。
       ⇒ 宁可 2 分钟后再试一次，也不要让用户半小时里都看不到机地那 12 条。
       ★ 备注：`recent` 档本来就不抓机地（`RANK_JIDI_KEY.recent === null`）⇒ 它的 `jidiOk`
         天然是 false，**必须**用 `RANK_JIDI_KEY[p]` 一起判，否则该档会被误判成「降级」。 */
    const rankTtl = (v) => (
      RANK_JIDI_KEY[p] && v && v.meta && v.meta.jidiOk === false ? 120_000 : 1_800_000
    );
    const data = await cached('rank:' + p, rankTtl, async () => {
      const dbAll = gamesDb.all();
      const jidiKey = RANK_JIDI_KEY[p] || null;
      /* ★ 两源**并行**抓，且用 allSettled：任一侧挂掉都不该拖垮整档
         （XD 挂了还有机地那 12 条，反之亦然；两边都挂才由下面的判空兜底）。 */
      /* ★★ v10.76：机地侧硬超时 6s（XD 侧实测 1–3s；机地正常时也在 5s 内）。
         不加这条的实测后果：机地挂着时本接口最坏等 **40s**（20s × 2 次），
         用户点「人气榜」看到的是长时间不动。超时 ⇒ allSettled 判 rejected ⇒ 走同一条降级路径。 */
      const [pnRes, jdRes] = await Promise.allSettled([
        xdupdate.panels([p]),
        jidiKey ? withTimeout(jidi.hotRanks(), 6000, '机地热榜') : Promise.resolve(null),
      ]);
      const xdRows = pnRes.status === 'fulfilled' ? (pnRes.value[p] || []) : [];
      const jidiRows = (jidiKey && jdRes.status === 'fulfilled' && jdRes.value)
        ? (jdRes.value[jidiKey] || []) : [];
      /* ★★ 统一走**同一个融合入口**：jidiRows 为空时它自然退化成「仅 XD」，
         不另写一条「只映射 XD」的渲染路径 —— 否则两条路径会各自漂移。 */
      const fused = rankMerge.rrfFuse(xdRows, jidiRows, dbAll);
      /* ★ 兜底补位：新源每档 100 行 ⇒ 正常恒为 0；只在源站整档抓挂时才有用 */
      const f = rankFill.fillRank(fused, dbAll);
      if (!f.list.length) {
        throw new Error(`两源榜单都为空（XD ${pnRes.status} / 机地 ${jidiKey ? jdRes.status : '不适用'}）`);
      }
      return {
        p,
        meta: {
          ...RANK_META[p],
          dropped: fused._dropped || 0,        // XD 侧被滤掉的非游戏条目数
          srcN: f.srcN,                        // 融合候选条数（补位前）
          filled: f.filled,                    // 本地库兜底补了几条（正常 0）
          showN: rankFill.RANK_SHOW_N,
          carN: rankFill.RANK_CAR_N,
          xdN: (fused._srcN || {}).xd || 0,    // XD 有效行数
          jidiN: (fused._srcN || {}).jidi || 0,// 机地行数（0 = 该档单源）
          dualN: fused._dualN || 0,            // 两源都上榜的条数
          /* ★ v10.75 封面质量（**口径 = 前端实际展示的那 11 条**，与 `list.length` 对齐；
             早期版本误用「融合候选池（100 条）」当分子，会算出 `coverBig 94/11` 这种自相矛盾的值）。
             `coverBigN` = 先验大概率 460×215 的条数（展示位是 2.14:1，方图会被裁+放大）。
             `coverSubN` = 靠「同名提优」救回的条数。
             ⚠️ 先验分 ≠ 实测可加载；真实性由前端 onerror 链 + v10.75 实拍套件兜。 */
          coverBigN: f.list.filter((x) => (x.coverQ || 0) >= 3).length,
          coverSubN: f.list.filter((x) => x.coverSub).length,
          xdOk: pnRes.status === 'fulfilled',
          jidiOk: !!(jidiKey && jdRes.status === 'fulfilled'),
        },
        list: f.list.map(withBh),
      };
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
  /* ★★ v10.62：联想面板改走 `withRes`（原先只有 `withBh`）——
   *   这是用户 2026-10-12 报「我要的 mod/修改器/存档也没提供给我」的落点。
   *
   *   联想面板是搜索的**第一入口**（打字 180ms 就出），此前它只挂手机侧字段（bh/pc），
   *   **一个资源计数都不挂** ⇒ 用户在这里永远看不到「N MOD / N 修改器 / N 存档」。
   *   而同一个 `smRow()` 渲染器在搜索结果面板里是**有** chip 的
   *   （`/api/search/all` 的 pc 桶走 withRes）⇒ 同一行 UI，两个入口两个样。
   *
   *   ⚠️ 必须与 `withRes` 的副本保护**同时**上线：修污染前，这里能出现 chip 纯靠
   *     `/api/search/all` 先把对象污染了（顺序依赖），单独改任一处都会露馅。 */
  /* ★ v10.87：admin=1 → 每行带 hidden/cold 标注（管理页徽标），判定走服务端 coldHide 真源 */
  const admin = String(req.query.admin || '') === '1';
  res.json({ ok: true, q: raw, aliasNote, count: r.count, total: gamesDb.stats().total, items: withNKeys(r.items.map((x) => {
    const it = withRes(x);
    if (admin) { it.hidden = coldHide.isHidden(x); it.cold = coldHide.isCold(x); }
    return it;
  })) });
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

/* ================= ★ v10.58 首页「库范围」：手游 / 端游 / 合并 =================
 *
 * `GET /api/library/browse?scope=pc|mob|all`（缺省 `pc`，即原行为不变）：
 *   · pc  端游库（gamesDb）        **19,465** 款
 *   · mob 手游中心（mobilehub）     **3,330** 款
 *   · all 端游库 ∪ 手游**独有**     **21,110** 款
 *
 * ★★ 为什么 `all` 只并「手游独有」而不是全部手游（2026-10-12 实测）：
 *   手游侧 3,330 款 =「已挂 libId」**1,685** +「手游独有」**1,645**；
 *   而那 1,685 款**逐条都在端游库里**（实测 1,685/1,685，0 例外 —— 挂上 libId 本就
 *   意味着它匹配到了端游条目）⇒ 并进来就是同一条游戏出现两次。
 *   用户口径（2026-10-12 拍板）：「手游全部并入」，**手游独有的卡标「仅手机端」、
 *   点击去手机专区**（不开端游抽屉 —— 它没有端游详情，开了就是空抽屉）。
 *
 * ★ 与既有筛选的**口径**（保持与端游侧一致，否则两个视图的同一个开关含义不同）：
 *   · `bh=1` / `pc=1`  → 手游侧按 `sources`（社区库 / 实测库）判，语义天然一致；
 *   · `mod=1` / `tr=1` / `sv=1` → 都要求挂 `libId`（资源条目按端游库 id 关联）
 *     ⇒ **手游独有一律不满足**，勾上后它们会被正确滤掉，不是被漏掉；
 *   · `sizeMin/sizeMax` → 手游侧用 `libSize`（独有恒为空 ⇒ 设了区间就被滤掉）；
 *   · **分类 `g`** → 手游条目**没有分类数据**。所以 `scope=all` 且选了具体分类时，
 *     手游侧**整体不参与**（`gAll` 为假）—— 硬掺进来等于按没有的字段瞎分类。
 *
 * ★ 实现取舍：`all` 不做「全量拼接再排序」——端游侧本来就是全量有序的
 *   （`gamesDb.browse` 每次都全量排好再切片），手游侧也就 3,330 条，
 *   所以两边各排一次、用 `mergePick` **归并取页**，复杂度只和 `offset+limit` 有关。
 */
const dayOf = (ms) => { const d = new Date(ms); return Number.isFinite(d.getTime()) && ms > 0 ? d.toISOString().slice(0, 10) : ''; };

/** 手游条目 → 与端游条目**同形状**（前端 `rowCard` 一套渲染吃两种，不写第二个卡模板）。
 *  ⚠️ `mol`（mobile-only）与 `mob`（手机端数据）是两个不同的东西：
 *     · `mol=true`  ⇒ 端游库没有它，卡上标「仅手机端」、点击去手机专区；
 *     · `mob`       ⇒ 手机端有多少配置 / 实测记录（有 libId 的条目也有）。 */
function projectMobile(x) {
  const ts = Number(x.recent) || 0;                    // unix **秒**
  return {
    id: x.libId || ('mh-' + mobilehub.normKey(x.name)),
    title: x.libTitle || x.name,
    cover: x.libCover || '',
    url: x.libUrl || '',
    source: 'mh',
    score: (typeof x.libScore === 'number' && x.libScore > 0 && x.libScore <= 10) ? x.libScore : null,
    size: x.libSize || '',
    genres: [],
    dateLabel: ts ? dayOf(ts * 1000) : '',
    _sortTs: ts * 1000,
    mol: !x.libId,
    mob: {
      configs: x.configs || 0, records: x.records || 0,
      best: x.bestLabel || '', tier: x.tier || '',
      devices: (x.devices || []).length, gpus: (x.gpus || []).length,
    },
  };
}

/** 两个**已按同一键降序**排好的数组，归并取出 `[offset, offset+limit)`。
 *  不拼接全量（端游 19,465 + 手游 1,645 每次请求都拼一遍太亏）。 */
/* ★ v10.70：`cmp` 是**比较函数**（不是取值函数）。
   改动原因：加 `sizeAsc`（容量升序）/ `title`（名称升序）后必须有「小于」这个
   方向，而旧的 `keyOf(A[i]) >= keyOf(B[j])` 只能表达降序一种方向。
   A 胜出（应排在前面）时该函数返回 <= 0。 */
function mergePick(A, B, cmp, offset, limit) {
  const out = [];
  let i = 0, j = 0, k = 0;
  while ((i < A.length || j < B.length) && out.length < limit) {
    let take;
    if (i >= A.length) take = B[j++];
    else if (j >= B.length) take = A[i++];
    else take = cmp(A[i], B[j]) <= 0 ? A[i++] : B[j++];
    if (k >= offset) out.push(take);
    k++;
  }
  return out;
}

// GET /api/library/browse?g=动作冒险&limit=50&offset=0&sort=updated|hot|score|size|sizeAsc|title&sizeMin=&sizeMax=&bh=1
//   ★ v10.58 新增 `scope=pc|mob|all`（见上方「库范围」整段注释）
//
// ★ v10.53：改用 `withRes` —— 首页「最新收录 / 分类浏览」的卡片从此也带
//   `res`（本款有多少 MOD / 修改器 / 存档）+ `resId`（计数归属的库内 id）。
//   为什么不是只挂 `bh`/`pc` 两个手机端来源：卡片上原本只有「📱 可玩」「🎮 实测」
//   两枚徽标，而**筛选行里已经有 🛠 有修改器 / 💾 有存档 两个开关** ——
//   筛出来的卡片上却没有任何对应标记，等于「筛出来看不见为什么」。
//   挂上 `res` 之后，筛选行的每一个开关在卡面上都有对应 chip（同源，见 libOpts 注释）。
//   ⚠️ `withRes` 内部对全 0 的条目**不挂字段**，所以绝大多数卡片的回包体积不变。
app.get('/api/library/browse', (req, res) => {
  const g = String(req.query.g || '').trim();
  /* ★ v10.70：白名单从 `gamesDb.SORT_KEYS` 取 —— 过去的 `['score','size']`
     写死在这里，加一个排序维度要改两处（这里 + gamesDb 的比较函数），
     漏改一处就变成「前端发了 hot、服务端静默回落 updated」。 */
  const sort = gamesDb.SORT_KEYS.includes(String(req.query.sort || '')) ? String(req.query.sort) : 'updated';
  const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 100);
  const offset = Math.max(0, parseInt(req.query.offset || '0', 10) || 0);
  const scopeRaw = String(req.query.scope || '');
  const scope = ['mob', 'all'].includes(scopeRaw) ? scopeRaw : 'pc';
  const o = libOpts(req);
  /* ★ v10.84 冷门隐藏：列表层默认剔除冷门口径（hot=0 且非近90天新游，见 data/cold-hide.js）。
   *   scope=pc 走 browse 池前过滤；scope=all 复用同一个 o（browse 内部同钩子）；
   *   scope=mob 是手游池，口径只对端游库，天然不受影响。
   *   搜索(/api/search)与详情不过滤 ⇒ 冷门游戏「可搜到、详情可达」；
   *   ?cold=0 显式关掉（管理员/测试逃生口）。 */
  o.excludeCold = String(req.query.cold || '') !== '0';
  /* ★★ v10.88.1：`admin=1` 是「回包多带管理侧字段」的开关（hidden / cold / note），
   *   所以它本身必须过鉴权 —— 否则公开搜索接口加一个 `?admin=1` 就能读到全部备注。
   *   只在这一支里 guard：不带 admin=1 的正常搜索完全不受影响（仍是公开读接口）。
   *   ★ 通用判据（铁律 161）：**参数一出现就改变数据可见性等级的接口**，
   *     这个参数必须自己带鉴权，不能指望「接口整体是公开的」。 */
  const isAdminView = String(req.query.admin || '') === '1';
  if (isAdminView && !adminGuard(req, res)) return;
  /* ★★ v10.112 `hidden=1` 让冷门剔除让位：
   *   池前剔除冷门 + 「只要最终隐藏的行」是互斥的 —— 前者把所有 isHidden 的删掉，
   *   后者只留 isHidden 的 ⇒ 组合起来必然 0 条。后台默认不显示冷门（cold=1）之后，
   *   管理员一选「最终隐藏」就永远空列表，看起来像功能坏了。
   *   ⇒ 显式要「隐藏行」时，就不再剔除冷门。只对 admin 视图生效（非 admin 带 hidden
   *   参数不影响可见性，避免「加个参数就绕开冷门隐藏」）。
   *   ⚠️ test-cold-hide 原本断言 `o.excludeCold =` 只出现一次；这里是有意的第二个入口，
   *   该断言已同步升级为「两处，且都只在 /api/library/browse 内」（不是放宽，是点名两个入口）。 */
  if (isAdminView && String(req.query.hidden || '') === '1') o.excludeCold = false;
  /* ★ v10.87 管理页隐藏态筛选（池前过滤，total 才与行数一致）：
   *   admin=1 且 hidden=1|0 → 只留「最终隐藏」/「最终可见」的行；
   *   判定复用 coldHide.isHidden（与豁免、/api/cold/stats 同一真源）。
   *   ⚠️ test-cold-hide 用 `o.excludeCold\s*=` 计数「赋值只此一处」，新增赋值会被判红。 */
  /* ★★ v10.112 解耦（实测出来的静默失效）：
   *   改前条件是 `isAdminView && !o.excludeCold` —— hidden / asrc / note 三个筛选
   *   **只在 cold=0 时才生效**。以前没炸是因为后台的 cold 开关是死控件（永远发 0）；
   *   一旦开关真的能发 cold=1，这三个筛选会当场全部失效，而且**不报错**：
   *   实测 cold=1&hidden=1 / &asrc=jidi / &note=1 的 total 全部 = 12308 = 与不加筛选一模一样。
   *   本质：「剔除冷门」是池前的一道开关，「附加条件」是另一件事，两者不该互相开关。 */
  if (isAdminView) {
    /* v10.88：管理页需要多条件叠加（隐藏态 + 来源 + 有备注），
     * 所以改成「条件数组 + every」而不是逐个覆盖 o.filter —— 覆盖会让后一个筛选
     * 静默吃掉前一个（列表数字对不上，但不报错）。 */
    const conds = [];
    const hv = String(req.query.hidden || '');
    if (hv === '1') conds.push((g) => coldHide.isHidden(g) === true);
    else if (hv === '0') conds.push((g) => coldHide.isHidden(g) === false);
    /* asrc：来源（xd=XDGAME / jidi=机地）。不复用 `src` 这个参数名 ——
     * 它已被 resGroups 的 `?src=&id=` 语义占用，同名会让两处互相干扰。 */
    const asrc = String(req.query.asrc || '');
    if (asrc === 'xd') conds.push((g) => /xd/i.test(String(g.source || '')));
    else if (asrc === 'jidi') conds.push((g) => /jidi/i.test(String(g.source || '')));
    /* note=1：只看标过备注的（人工核对清单的入口） */
    if (String(req.query.note || '') === '1') conds.push((g) => !!gameNotes.get(g.id));
    if (conds.length) o.filter = (g) => conds.every((f) => f(g));
  }

  /* ★★ v10.90 修正一个静默 bug：`browse` 从来没有 `q` 参数。
   *   管理页（页面管理 / 游戏库）的搜索框一直在发 `?q=`，服务端**静默忽略**，
   *   表现是「搜了没反应、列表还是那 50 条」，而且不报错、分页数字也正常 ——
   *   这类「参数没人接」的 bug 只能靠实测列表内容发现（本轮就是这么发现的）。
   *   命中集合复用 `gamesDb.search` 的同一套归一化与打分（不另写一份模糊匹配），
   *   再与已有筛选**叠加**（不是覆盖 —— 覆盖会让「只看有备注」等条件静默失效）。
   *   ⚠️ gamesDb.search 返回的是**对象** { q, count, items }，不是数组（铁律 148）。 */
  const qq = String(req.query.q || '').trim();
  if (qq) {
    const hit = new Set((gamesDb.search(qq, 5000).items || []).map((x) => x.id));
    const prev = o.filter;
    o.filter = (g) => (!prev || prev(g)) && hit.has(g.id);
  }

  if (scope === 'pc') {
    /* ★ v10.94 `group=1`：把「同一款游戏的多个帖子」折成一行（后台游戏库 / 名单页用）。
     *   真因是源站本身多条帖子（原版 + 「支持网络联机」整合版）被按帖子入账，
     *   不是重复抓取。折叠只影响**展示**，不动 data/games.json，按 id 仍可查。
     *   ⚠️ 折叠必须在**排序后、分页前**做：先分页再折叠会让某页少几行、
     *      total 与实际翻页对不上（这类错不报错，只表现为「后面几页是空的」）。 */
    const groupOn = String(req.query.group || '') === '1';
    let r;
    if (groupOn) {
      const full = gamesDb.browse(g, 1e9, 0, sort, o);
      const col = gameDedupe.collapse(full.items);
      r = {
        genre: full.genre, sort, total: col.items.length, offset, limit,
        merged: col.merged,
        items: col.items.slice(offset, offset + limit),
      };
    } else {
      r = gamesDb.browse(g, limit, offset, sort, o);
    }
    /* ★ v10.87：`admin=1` → 每行带隐藏态标注（hidden 最终态 / cold 规则命中）。
     *   管理页用 `cold=0&admin=1`：cold=0 关掉池前过滤（冷门行也要看见），
     *   admin=1 让每行自带「为什么被藏」的判定 —— 判定在**服务端现算**
     *   （铁律 154：静态产物/列表可变状态必须响应回填，不靠前端猜）。 */
    const admin = isAdminView;
    return res.json({
      ok: true, scope, ...r,
      items: r.items.map((x) => {
        const it = withRes(x);
        if (admin) {
          it.hidden = coldHide.isHidden(x);
          it.cold = coldHide.isCold(x);
          /* v10.88：备注随行回填（管理页要能看到自己标过什么，不能点进详情才知道） */
          it.note = gameNotes.get(x.id);
          /* ★ v10.90 游戏库列表要显示「资料填了几项」与「哪些字段是人改的」。
           *   `it` 已经过 withRes → apply，所以这里算的就是**叠加后**的完整度；
           *   `_prof` 是 apply 打的覆盖字段清单（公开页不看它）。 */
          it.comp = gameProfile.completeness(it);
          it.prof = it._prof || [];
        }
        return it;
      }),
    });
  }

  /** ★ v10.70：排序键**统一从 `gamesDb.cmp(sort)` 取比较函数**。
      过去这里是另写的一份 `keyOf`（只认 score / size / updated），与
      `gamesDb.browse()` 内部那份是**两套口径** —— 新增 hot / sizeAsc / title
      后若不同步，同一个 `sort` 在 `scope=pc` 与 `scope=all` 下会排出不同顺序，
      而且不报错、测试照绿。 */
  const cmp = gamesDb.cmp(sort);
  const gAll = !g || g === '全部' || g === 'all';
  const bhOn = String(req.query.bh || '') === '1';
  const pcOn = String(req.query.pc || '') === '1';
  const needMod = String(req.query.mod || '') === '1';
  const needTr = String(req.query.tr || '') === '1';
  const needSv = String(req.query.sv || '') === '1';
  const minG = o.sizeMin != null && o.sizeMin !== '' ? Number(o.sizeMin) : null;
  const maxG = o.sizeMax != null && o.sizeMax !== '' ? Number(o.sizeMax) : null;
  const setMod = needMod ? resGroups.libIdsFor('mod') : null;
  const setTr = needTr ? resGroups.libIdsFor('trainers') : null;
  const setSv = needSv ? resGroups.libIdsFor('saves') : null;

  const mobPool = mobilehub.all()
    .filter((x) => {
      const srcs = x.sources || [];
      if (bhOn && !srcs.includes('bh')) return false;
      if (pcOn && !srcs.includes('pc')) return false;
      if (setMod && !(x.libId && setMod.has(x.libId))) return false;
      if (setTr && !(x.libId && setTr.has(x.libId))) return false;
      if (setSv && !(x.libId && setSv.has(x.libId))) return false;
      if (minG != null || maxG != null) {
        const gb = gamesDb.sizeGb(x.libSize);
        if (gb == null) return false;
        if (minG != null && gb < minG) return false;
        if (maxG != null && gb >= maxG) return false;
      }
      return true;
    })
    .map(projectMobile)
    .sort(cmp);

  if (scope === 'mob') {
    return res.json({
      ok: true, scope, sort, total: mobPool.length, offset, limit,
      items: mobPool.slice(offset, offset + limit).map(withRes),
    });
  }

  /* scope === 'all'：端游全量（browse 内部已按 sort 排好） ∪ 手游独有 */
  const pcAll = gamesDb.browse(gAll ? '' : g, 1e9, 0, sort, o).items;
  const mol = gAll ? mobPool.filter((x) => x.mol) : [];
  return res.json({
    ok: true, scope, sort, total: pcAll.length + mol.length, offset, limit,
    items: mergePick(pcAll, mol, cmp, offset, limit).map(withRes),
  });
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
  const empty = { ok: true, q: '', pc: { count: 0, items: [], fit: 0 }, mobile: { count: 0, items: [], fit: 0 }, trainer: { count: 0, items: [], fit: 0 }, save: { count: 0, items: [], fit: 0 } };
  if (!raw) return res.json(empty);

  const exp = expandAlias(raw);
  const aliasNote = exp.alias ? { alias: exp.alias, to: exp.q } : null;

  /* ① 端游库（★ v10.52：改用 withRes —— 比 withBh 多挂一个 `res` 计数，
   *   让搜索结果行能直接显示「这款有多少 MOD / 修改器 / 存档」） */
  let pc = { count: 0, items: [] };
  try {
    const r = gamesDb.search(exp.q, limit, libOpts(req));
    pc = { count: r.count, items: withNKeys(r.items.map(withRes)), fit: searchRank.fitOf(r.topScore) };
  } catch (e) { pc = { count: 0, items: [], error: e.message }; }

  /* ② 手游中心（合并索引，含社区库英文名与实测库中文名的别名展开） */
  let mobile = { count: 0, items: [] };
  try {
    const m = mobilehub.list({ q: exp.q, stats: 'all', sort: 'configs', limit });
    mobile = {
      count: m.total,
      fit: searchRank.fitOf(m.topScore),
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
      fit: searchRank.fitOf(r.topScore),
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
      fit: searchRank.fitOf(r.topScore),
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

/* GET /api/library/twin?id=&t=&src= — ★ v10.23：这款游戏在「另一源」的详情页
 *
 * 详情抽屉里两处要用它：
 *   · 「另一源也有收录」卡片
 *   · 底部跨源按钮（机地 ↔ XD 互跳）—— 用户口径：**直接链到游戏详情页**，
 *     查不到就**不显示按钮**（不给「点过去找不到」的中间态）。
 *
 * 为什么单开一个端点，而不是继续用 `/api/library?q=<名>`：
 *   v10.22 把机地全量话题合并进 XD 条目后（机地信息挂在 `jidiUrl`/`jidiId` 上），
 *   名字检索命中率只有 3.5% —— 也就是说 13,000 多款游戏**库里明明有机地详情页**，
 *   前端却查不到。详情页这一处的取数口径必须与「按名模糊搜索」分开。
 *
 * 返回 `twin`（保证带可跳的详情页 URL）或 `null`；`via` 字段如实标注命中路径：
 *   jidiUrl+tid → XD 条目自带的机地 id，精确（占 97% 的命中）
 *   jidiId      → 机地条目反查 XD，精确
 *   name        → 名称兜底（带防误配闸门），**不是**可靠键，排查时以它为准
 */
app.get('/api/library/twin', (req, res) => {
  const id = String(req.query.id || '').trim().slice(0, 64);
  const t = String(req.query.t || '').trim().slice(0, 120);
  const src = String(req.query.src || '').trim().slice(0, 16);
  if (!id && !t) return res.status(400).json({ ok: false, error: '至少需要 id 或 t' });
  try {
    const hit = twin.twinOf({ id, title: t, src });
    res.json({ ok: true, twin: hit || null, via: hit ? hit.via : null });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
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

/* ================= 🗂 机地全量话题库（v10.22） =================
 *
 * 用户口径：「有个很重要的问题，为什么机地的数据那么少」。
 * 根因：老实现只抓机地的**人工精选**（首页 SSR 新游 + 周/月/年热榜），全站只有 **66 条**；
 *       而 XD 一侧有 15,319 条 —— 两个源的份量完全不成比例。
 * 全量其实在签名接口 `/api/topic/get_topics` 里（`limit` 可到 1000 ⇒ 18 次请求抓完）：
 *       **17,220 条**，耗时 32 秒。抓取链见 fetchers/jidiTopics.js / jidiSigned.js。
 *
 * ★ 这里**只读落盘产物**，运行时零联网（与全站「产物一律落盘」的口径一致）。
 * ★ 也**不做名称模糊匹配**：与 XD 对齐走 Steam appid（见 tools/build-spec-req.js）。
 */
app.get('/api/jiditopics/stats', (_req, res) => res.json(jiditopics.stats()));

// GET /api/jiditopics/list?q=&sort=hot|update|score&limit=&offset=&dl=1&hotMin=
app.get('/api/jiditopics/list', (req, res) => {
  res.json(jiditopics.list({
    q: req.query.q,
    sort: req.query.sort,
    limit: req.query.limit,
    offset: req.query.offset,
    dl: String(req.query.dl || '') === '1',
    hotMin: parseInt(req.query.hotMin, 10) || 0,
  }));
});

// GET /api/download?url=<详情页URL>
//   或  /api/download?source=jidi|xdgamer&id=…&host=xdgamer|xdgame
//   —— 「这游戏去哪下」：返回**可直接点开的网盘地址**（v10.22 新增）
//
//   · jidi   ：★ v10.26 优先走话题资源接口 /api/misc/post_list（本体/mod/修改器三专区，
//              实测剑星 22+190+4=216 条）；接口不可用时退回解析详情页 SSR 的
//              topic.ssrData.postsMap/postList（只覆盖首屏 ~10 条，几乎只有本体）。
//              走哪条路如实回在 `engine` 里；`sections` 给各专区条数。
//   · xdgamer：解析详情页 .article-down 的 a.downbtn，再跟随 /plus/download.php 的 302 拿真实地址
//   详见 fetchers/download.js 头部说明。
//
//   ★ 优先吃 `url`：因为 xdgame.com 与 xdgamer.com 是**两套内容独立的平行站**
//     （同 ID ≠ 同游戏），只给 id 而 host 猜错会拉到另一款游戏的资源。
//     复用 parseDetailUrl()，与 /api/detail 同一个白名单与解析口径。
//
//   ★ 为什么带缓存：XD 一次要解 6 个盘口的 302（6 次外部请求），机地要拉一整张详情页。
//     资源列表在几小时内不会变，缓存 30 分钟足够。
//
//   ★★ v10.95：「缓存 30 分钟」只适用于**完整成功**的那一次。
//     用户口径「机地有很多免费的下载本体链接，为什么只显示 XD 的」——
//     实测根因（2026-10-21）：机地取 env 那一步偶发拿不到 ⇒ 本体专区回 405、0 帖，
//     而这份「0 帖」被当成正常结果缓存了 30 分钟；同一进程里 2 秒后现抓同一话题
//     （tid 640827939 星砂岛）→ 本体 3 帖 / 5 条网盘链接。这就是全程只看到 XD 的原因。
//     ⇒ 时长策略单独放进 `data/dl-cache-ttl.js`（能单测）：有专区报错只缓存 60 秒、
//       SSR 兜底 120 秒、完整成功才 30 分钟。
//     ⚠️ 判据是「有没有 error」而不是「有没有链接」——「帖在但没写网盘」是正常空结果，
//        照常缓存，否则每次打开都重打源站，反而更快触发限流。
//   ★★ v10.104 补正根因定性：「拿不到 env」不是「源站改版」，而是源站 SSR 偶发降级，
//     返回 **1188 字节的 SPA 骨架页（HTTP 200 / `APP_INITIAL_STATE={}`）**。
//     已在 `fetchers/jidiSigned.js` 里改成「认出来 → 同路径重试 → 换页面兜底」，
//     并给三专区加 env 单飞预热（并行各自取 env 正是这个降级的触发组合）。
const { dlCacheTtl, searchCacheTtl } = require('./data/dl-cache-ttl');

app.get('/api/download', async (req, res) => {
  const rawUrl = String(req.query.url || '').trim();
  let target = null;
  if (rawUrl) {
    target = parseDetailUrl(rawUrl);
    if (!target) return res.status(400).json({ ok: false, error: '仅支持机地/XDGAME 详情页链接' });
  } else {
    const source = String(req.query.source || '').trim();
    const id = String(req.query.id || '').trim();
    if (!id || (source !== 'jidi' && source !== 'xdgamer')) {
      return res.status(400).json({ ok: false, error: '需要 url，或 source=jidi|xdgamer 与 id' });
    }
    target = { source, id, host: String(req.query.host || '').trim() || undefined };
  }
  const key = 'dl:' + target.source + ':' + (target.host || '') + ':' + target.id;
  /* ★ v10.95：`refresh=1` 强制重抓 —— 与 /api/detail 同一个开关。
   *   起因：机地偶发 405 会把「0 条链接」写进 30 分钟缓存，用户点开只看到 XD 的盘口，
   *   而源站明明有几十条网盘帖。前端「重试」按钮就调这个参数。 */
  if (String(req.query.refresh || '') === '1') cache.delete(key);
  try {
    const data = await cached(key, dlCacheTtl, () => download.resolve({
      source: target.source,
      id: target.id,
      host: target.host,
    }));
    const items = data.items || [];
    res.json({
      ok: true,
      fetchedAt: Date.now(),
      source: data.source,
      id: data.id,
      title: data.title || null,
      subtitle: data.subtitle || null,
      version: data.version || null,
      url: data.url || null,
      /** ★ v10.26 机地：这次走的是接口还是 SSR 兜底（api / ssr），不静默降级 */
      engine: data.engine || null,
      fallbackReason: data.fallbackReason || null,
      /** ★ v10.26 机地：专区汇总 [{key,name,count,returned,withLinks,links}]
       *  —— 本体 / mod / 修改器各自的条数，前端据此分区。XD 侧没有这个维度，为 null。 */
      sections: data.sections || null,
      /** ★ 源站要求登录 / 权限才能取（XD 对部分游戏如此）→ 前端给出明确原因 + 去源站的出口 */
      needAuth: !!data.needAuth,
      /** 只报「有真实地址」的条数，避免前端把解析失败的也算进去 */
      count: items.filter((x) => x.real).length,
      items,
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: String((e && e.message) || e) });
  }
});

/* ================= 📦 解压助手（v10.71 新增） =================
 *
 * 需求原话（2026-10-14）：
 *   「下载直链的压缩包，压缩包中含有压缩包，有没有办法直接自动解压并且检测到如果
 *     还是有压缩包则直接再次解压或增加提醒+再次解压功能」
 *
 * 实测已复现：游侠存档直链下来是 .rar，解开里面**就是一个 .rar**，再解开才是存档目录。
 * ⇒ 落成「固定点迭代」：解一层 → 在产出里再按魔数找压缩包 → 还有就再解，直到到底。
 *
 * 用户拍板的四条口径：
 *   · 输出位置 = **原地解压**（解到压缩包同级目录）
 *   · 原压缩包 = **保留不动**（不删不移）
 *   · 加密包   = **列出 + 逐个填密码后续跑**（不静默跳过、不爆破）
 *   · 网盘链接 = 服务端拿不到（要客户端/登录）⇒ 走原方式，用户手动把文件放进目录后
 *                用 scan / run 处理 —— 所以这里必须同时支持「直链下载」和「扫目录」
 *
 * ★ 长任务**不上 SSE**：全站现状是「内存任务对象 + 前端轮询」（见 /api/library/progress），
 *   这里保持一致，前端轮询 `GET /api/extract/task?id=`。
 * ★ 任务表只留最近 `EX_KEEP` 个：这是常驻进程，不清理会一直涨（PITFALLS 31 同族）。
 * ★ 解压是**写盘**操作 ⇒ 目录必须过护栏（见 exSafeDir），不允许盘符根与系统目录。
 */

const EX_TASKS = new Map();
const EX_KEEP = 24;              /* 只留最近 24 个任务 */
const EX_MAX_CONCURRENT = 2;     /* 同时最多 2 个（7z 吃磁盘，跑太多会互相拖垮） */
/* ★ v10.73：历史是**落盘**的（内存任务表只留 24 个且重启即丢），所以上限单列一支。
   200 条 ≈ 几十 KB，翻起来够用；再多就该用户自己归档了。 */
const EX_HISTORY_MAX = 200;
let exSeq = 0;
let exRunning = 0;

/* ★ 目录护栏：页面上用户可以随手填路径，而解压会往那里写文件。
 *   万一填成 `C:\Windows` 或盘符根，递归解压会把一堆东西写进系统目录。
 *   这里**白名单式地拒绝**，而不是"提醒一下" —— 写盘操作不做乐观假设。 */
const EX_BLOCKED_DIR = [
  /^[a-z]:[\\/]?$/i,                                   /* 盘符根：C: C:\ D:/ */
  /^[a-z]:[\\/](windows|program files|program files \(x86\)|programdata|perflogs|recovery|system volume information)([\\/]|$)/i,
  /^[a-z]:[\\/]users[\\/][^\\/]+[\\/]?(appdata)?$/i,   /* 用户目录根本身 */
  /^\\\\/,                                             /* UNC 网络路径不碰 */
];
function exSafeDir(p) {
  const s = String(p || '').trim();
  if (!s) return { ok: false, error: '目录不能为空' };
  if (!path.isAbsolute(s)) return { ok: false, error: '必须是绝对路径，收到：' + s };
  let norm;
  try { norm = path.resolve(s); } catch (e) { return { ok: false, error: '路径无法解析' }; }
  for (const re of EX_BLOCKED_DIR) {
    if (re.test(norm)) return { ok: false, error: '出于安全考虑，不允许对该目录操作：' + norm };
  }
  return { ok: true, dir: norm };
}

function exEv(t, type, extra) {
  t.events.push(Object.assign({ ts: Date.now(), type }, extra || {}));
  if (t.events.length > 200) t.events.splice(0, t.events.length - 200);
}

function exNewTask(kind, label, params) {
  const id = 'ex' + (++exSeq) + '-' + Date.now().toString(36);
  const t = {
    id, kind, label, params: params || {},
    state: 'running',            /* running | done | need-password | error */
    phase: 'queued',             /* queued | download | extract | done */
    startedAt: Date.now(), finishedAt: null,
    progress: 0,
    bytes: 0, totalBytes: 0,
    events: [],
    report: null,
    error: null,
    needsPassword: [],
    pending: [],                 /* 待密码续跑的文件 [{file, destDir}] */
    /* ★ v10.72：这条直链下回来的**到底是什么**。
     *   下载弹窗里那些按钮给的多半是网盘页（要登录/客户端），服务端取不到 ——
     *   以前只能含糊地说「下载失败」，现在把识别结果如实带出来，
     *   前端能直说「这条是网盘页 / 不是压缩包」，用户一眼知道该改点哪个按钮。 */
    sniffed: null,               /* 落盘时按魔数认出的格式：zip / rar / 7z / … */
    notArchive: false,           /* 地址通、也下得到东西，但内容不是压缩包 */
    contentType: null,           /* 最后一次下载响应的 Content-Type（拿不到就是 null） */
    /* ★ v10.73：一个任务一个文件夹 —— 真实落点（DEFAULT_DEST 下的子目录）。
     *   前端「复制路径 / 打开文件夹」用它，不许再拿 DEFAULT_DEST 顶替
     *   （那会让用户以为东西在该在的地方，实际在子目录里）。 */
    dir: null,
    archive: null,               /* 落盘后是不是压缩包（null = 还没下完） */
  };
  EX_TASKS.set(id, t);
  if (EX_TASKS.size > EX_KEEP) {
    for (const k of [...EX_TASKS.keys()].slice(0, EX_TASKS.size - EX_KEEP)) EX_TASKS.delete(k);
  }
  return t;
}

/* 统一的任务启动器：管并发计数、兜住异常（★ 后台任务抛出去会打挂进程） */
function exRun(t, fn) {
  exRunning++;
  (async () => {
    try { await fn(); } catch (e) {
      t.state = 'error';
      t.error = String((e && e.message) || e);
      exEv(t, 'error', { error: t.error });
    } finally {
      exRunning--;
      if (t.state === 'running') t.state = 'done';
      t.phase = 'done';
      t.finishedAt = t.finishedAt || Date.now();
      t.progress = 100;
      /* ★★ v10.73：终态**一律留档**（含 need-password 与 error —— 「这个包要密码」
       *   和「这个包坏了」恰恰是用户回头最想找的信息）。
       *   放在 finally 里而不是各分支里，是为了**保证没有一条出口能绕过它** ——
       *   散在分支上加，迟早会漏掉新加的那条（本项目已经出过同族的账）。 */
      try { exHistoryPush(t); } catch (e) { /* 留档失败绝不许影响已完成的主产物 */ }
    }
  })();
}

/* 报告 → 前端精简视图（别把 200 条 layer 明细整个甩给浏览器） */
function exSummary(rep) {
  if (!rep) return null;
  return {
    ok: rep.ok, root: rep.root, destDir: rep.destDir,
    reachedDepth: rep.reachedDepth, maxDepth: rep.maxDepth,
    files: (rep.final || []).length,
    layers: (rep.layers || []).map((L) => ({
      depth: L.depth, name: L.name, format: L.format, ok: L.ok,
      produced: L.produced, nothingNew: L.nothingNew, needPassword: L.needPassword,
      skipReason: L.skipReason, err: L.err,
    })),
    needsPassword: rep.needsPassword || [],
    failures: rep.failures || [],
    skipped: rep.skipped || [],
    final: (rep.final || []).slice(0, 200),
  };
}

function exSnapshot(t) {
  return {
    id: t.id, kind: t.kind, label: t.label, state: t.state, phase: t.phase,
    progress: t.progress, bytes: t.bytes, totalBytes: t.totalBytes,
    startedAt: t.startedAt, finishedAt: t.finishedAt,
    error: t.error,
    needsPassword: t.needsPassword,
    /* ★ v10.72：这三项让前端能区分「下载失败」与「下到了但不是压缩包」 */
    sniffed: t.sniffed || null,
    notArchive: !!t.notArchive,
    contentType: t.contentType || null,
    /* ★ v10.73：真实落点（子目录）与「是不是压缩包」 */
    dir: t.dir || t.params.dir || null,
    archive: t.archive === null ? null : !!t.archive,
    game: t.params.game || '',
    cat: t.params.cat || '',
    events: t.events.slice(-60),
    summary: exSummary(t.report),
  };
}

/* ---------- v10.73：下载/解压历史（用户要求「解压助手保留日志以及路径」） ----------
 * 为什么必须落盘：v10.71/v10.72 的任务表 `EX_TASKS` 是**内存态**（只留最近 24 个），
 * 服务一重启就全没了 —— 而用户恰恰是**重启之后**才想起来「刚才那个解到哪了、在哪个目录」。
 * 落点跟着产物走（`Downloads\GameHub\_下载历史.json`），用户在自己的下载目录里就能翻到。
 *
 * ★ 文件名以 `_` 开头 + `.json` 后缀，双保险：`scanDir` 只认魔数，
 *   JSON 永远不会被当成压缩包收进去（否则「扫描 → 解压全部」会多跑一次空转）。
 */
let exHistory = null;                       /* 懒加载：第一次用到才读盘 */
function exHistoryFile() { return path.join(extractor.DEFAULT_DEST, '_下载历史.json'); }
function exHistoryAll() {
  if (exHistory) return exHistory;
  exHistory = [];
  try {
    const j = JSON.parse(fs.readFileSync(exHistoryFile(), 'utf8'));
    if (Array.isArray(j)) exHistory = j.slice(-EX_HISTORY_MAX);
  } catch (e) { /* 首次运行 / 文件损坏：都当空历史，绝不让它影响主流程 */ }
  return exHistory;
}

/**
 * 记一条终态。★ **按 id 覆盖**而不是无脑追加：任务可能跑两趟
 * （第二趟是用户填完密码后的 `need-password` 续跑），追加会让同一次下载
 * 在历史里出现两条、且前一条永远停在「待密码」，看着像失败。
 */
function exHistoryPush(t) {
  const arr = exHistoryAll();
  const rec = {
    id: t.id, at: t.finishedAt || Date.now(),
    game: t.params.game || '', cat: t.params.cat || '',
    url: t.params.url || '',
    dir: t.dir || t.params.dir || '',
    state: t.state,
    sniffed: t.sniffed || null,
    layers: t.report ? (t.report.layers || []).length : 0,
    files: t.report ? (t.report.final || []).length : 0,
    bytes: t.bytes || 0,
    error: t.error || null,
  };
  const i = arr.findIndex((x) => x && x.id === t.id);
  if (i >= 0) arr[i] = rec; else arr.push(rec);
  if (arr.length > EX_HISTORY_MAX) arr.splice(0, arr.length - EX_HISTORY_MAX);
  try {
    fs.mkdirSync(path.dirname(exHistoryFile()), { recursive: true });
    fs.writeFileSync(exHistoryFile(), JSON.stringify(arr, null, 1));
  } catch (e) { /* 写不了历史不许影响已经完成的解压 —— 那才是主产物 */ }
}

/* 跑一次「下载 + 递归解压」的核心（下载与扫目录两条入口共用后一段） */
async function exExtractFile(t, file, passwords, destDir) {
  const rep = await extractor.extractArchive(file, {
    destDir,
    passwords,
    onEvent: (ev) => {
      if (ev.type === 'layer-start') exEv(t, 'layer', { file: path.basename(ev.file), depth: ev.depth, format: ev.format });
      else if (ev.type === 'layer-done') exEv(t, 'layer-ok', { file: path.basename(ev.file), depth: ev.depth, produced: ev.produced });
      else if (ev.type === 'layer-fail') exEv(t, 'layer-fail', { file: path.basename(ev.file), depth: ev.depth, err: ev.err });
      else if (ev.type === 'need-password') exEv(t, 'need-password', { file: ev.name, depth: ev.depth });
    },
  });
  return rep;
}

/* ---------- GET /api/extract/env — 环境自检（7z 在不在） ---------- */
app.get('/api/extract/env', async (_req, res) => {
  try {
    const env = await extractor.envCheck();
    res.json({ ok: true, ...env, defaultDir: extractor.DEFAULT_DEST, running: exRunning });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
});

/* ---------- POST /api/extract/scan { dir } — 扫目录里的压缩包（按魔数） ---------- */
app.post('/api/extract/scan', (req, res) => {
  const d = exSafeDir((req.body && req.body.dir) || extractor.DEFAULT_DEST);
  if (!d.ok) return res.status(400).json({ ok: false, error: d.error });
  try {
    const items = extractor.scanDir(d.dir);
    res.json({
      ok: true, dir: d.dir, count: items.length,
      items: items.map((x) => ({
        file: x.file, name: path.basename(x.file), format: x.format,
        size: x.size, isVolume: x.isVolume, mtime: x.mtime,
      })),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
});

/* ---------- POST /api/extract/download { url, game?, cat?, name?, dir?, passwords? } ----------
 * 下直链 → 递归解压。任务在后台跑，立即返回 id 供轮询。
 *
 * ★★ v10.73：这已经是站点上**唯一的下载通道**（并列的「🗜️ 解压」按钮按用户拍板删掉了，
 *    原「⬇ 直接下载」改为走这里）⇒ 它必须**从不空手而归**：
 *    是压缩包就解，不是就照存，只有 HTML 网页才丢弃。
 *    落点也变了：不再直接把文件堆在 `Downloads\GameHub` 根下，而是
 *    **一个任务一个文件夹** —— `游戏名_类别_原链名`。 */
app.post('/api/extract/download', (req, res) => {
  const b = req.body || {};
  const url = String(b.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ ok: false, error: '需要 http(s) 直链' });
  const root = exSafeDir(b.dir || extractor.DEFAULT_DEST);
  if (!root.ok) return res.status(400).json({ ok: false, error: root.error });
  if (exRunning >= EX_MAX_CONCURRENT) {
    return res.status(409).json({ ok: false, error: `已有 ${exRunning} 个任务在跑，请等一个结束再试` });
  }
  const env = extractor.resolve7z();
  if (!env) return res.status(503).json({ ok: false, error: '未找到 7z.exe，请安装 7-Zip 或设置环境变量 GAMEHUB_7Z' });

  /* 原链名（文件夹名的第三段）。★ 用**服务端自己**从 URL 推出来的名字，不采信前端传的
   *   `b.name` —— 两者此刻同源，但「外面来的字符串一律当不可信」是本项目写盘路径的既定口径。 */
  const originName = extractor.fileNameFromUrl(url, b.name);
  const sub = extractor.taskDir(root.dir, { game: b.game, cat: b.cat, fileName: originName });
  if (!sub.ok) return res.status(400).json({ ok: false, error: sub.error });

  const t = exNewTask('download', url, {
    url, game: b.game || '', cat: b.cat || '', dir: sub.dir, root: root.dir, name: originName,
  });
  t.dir = sub.dir;
  exEv(t, 'queued', { url, dir: sub.dir, name: sub.name });
  exRun(t, async () => {
    /* ── 阶段 1：下载（progress 占 0~40） ──
     * ★ v10.73：`expectArchive` 已删除。它的旧语义（不是压缩包就中止且不落盘）是配着
     *   **并列的第二个按钮**用的；现在只剩一个按钮、它就是「下载」本身，
     *   再丢弃就等于「点了没结果」。 */
    t.phase = 'download';
    exEv(t, 'downloading', { url });
    const dl = await extractor.downloadTo(url, sub.dir, {
      name: originName,
      onProgress: (p) => {
        t.bytes = p.got; t.totalBytes = p.total;
        t.progress = p.total ? Math.min(40, Math.round((p.got / p.total) * 40)) : 10;
      },
    });
    t.contentType = dl.contentType || null;
    if (!dl.ok) {
      /* ★ 务必分两种上报：「地址给的是网页」≠「下载出错了」。
       *   前端对前者的正确动作是「改用原贴/网盘通道」，不是「重试」。 */
      t.notArchive = !!dl.notArchive;
      t.state = dl.notArchive ? 'not-archive' : 'error';
      t.error = dl.error || '下载失败';
      exEv(t, dl.notArchive ? 'not-archive' : 'download-fail', { error: t.error, contentType: t.contentType });
      return;
    }
    t.sniffed = dl.sniffed || null;
    t.archive = !!dl.archive;
    t.progress = 40;

    if (!dl.archive) {
      /* ★★ v10.73：**不是压缩包 ⇒ 照存**，如实标记 `saved`。
       *   这不是失败：用户点的是「下载」，文件已经在他机器上了。
       *   标记成 error 会让浮层报红，用户以为没下到，转头去点网盘 —— 白折腾一趟。 */
      t.state = 'saved';
      exEv(t, 'saved', {
        file: path.basename(dl.file), size: dl.size,
        contentType: t.contentType, head: dl.head || null,
      });
      t.progress = 100;
      return;
    }

    exEv(t, 'downloaded', { file: path.basename(dl.file), size: dl.size, format: t.sniffed });

    /* ── 阶段 2：递归解压（progress 占 40~100） ──
     * ★ 内层包**就地展开**、不套 L1/L2 子目录（用户拍板）：`extractArchive` 的 destDir
     *   默认就是 `path.dirname(file)`，而外层包此刻已经在 sub.dir 里 ⇒ 传 sub.dir
     *   就是「同一个文件夹内迭代到固定点」。 */
    t.phase = 'extract';
    const passwords = (b.passwords || []).map(String).filter(Boolean);
    const rep = await exExtractFile(t, dl.file, passwords, sub.dir);
    t.report = rep;
    t.needsPassword = rep.needsPassword;
    t.pending = rep.needsPassword.map((n) => ({ file: n.file, destDir: sub.dir }));
    t.progress = 100;
    if (rep.needsPassword.length) t.state = 'need-password';
    else t.state = rep.ok ? 'done' : 'error';
    if (t.state === 'error' && !t.error) {
      t.error = rep.failures.length ? ('解压失败：' + rep.failures.map((f) => f.err).filter(Boolean).slice(0, 2).join(' / ')) : '解压未完成';
    }
  });
  res.json({ ok: true, id: t.id, dir: sub.dir, name: sub.name });
});

/* ---------- GET /api/extract/history?n= — 下载/解压历史（含产物路径） ----------
 * ★ v10.73 新增（用户要求「解压助手保留日志以及路径」）。**落盘**的，重启不丢。
 * 返回**倒序**（最新在前）—— 这个列表是给人「找刚才那次」用的，不是给机器读的。 */
app.get('/api/extract/history', (req, res) => {
  const n = Math.min(EX_HISTORY_MAX, Math.max(1, parseInt(req.query.n, 10) || 30));
  const all = exHistoryAll();
  res.json({
    ok: true,
    file: exHistoryFile(),
    total: all.length,
    max: EX_HISTORY_MAX,
    items: all.slice(-n).reverse(),
  });
});

/* ---------- POST /api/extract/run { dir?, files?, passwords? } ----------
 * 扫目录（或按给定文件）→ 逐个递归解压。这是「网盘手动丢入」的主入口。 */
app.post('/api/extract/run', (req, res) => {
  const b = req.body || {};
  const d = exSafeDir(b.dir || extractor.DEFAULT_DEST);
  if (!d.ok) return res.status(400).json({ ok: false, error: d.error });
  if (exRunning >= EX_MAX_CONCURRENT) {
    return res.status(409).json({ ok: false, error: `已有 ${exRunning} 个任务在跑，请等一个结束再试` });
  }
  const env = extractor.resolve7z();
  if (!env) return res.status(503).json({ ok: false, error: '未找到 7z.exe，请安装 7-Zip 或设置环境变量 GAMEHUB_7Z' });

  /* files 给了就只解这些（必须落在 dir 之内 —— 防越权读别的目录）；
   * 没给就按魔数扫整个 dir。 */
  let targets;
  if (Array.isArray(b.files) && b.files.length) {
    targets = [];
    for (const f of b.files) {
      const fp = path.resolve(String(f));
      if (fp !== d.dir && !fp.startsWith(d.dir + path.sep)) {
        return res.status(400).json({ ok: false, error: '文件必须位于目标目录内：' + fp });
      }
      if (extractor.sniff(fp)) targets.push(fp);
    }
    if (!targets.length) return res.status(400).json({ ok: false, error: '给的这些文件里没有认出压缩包（按魔数识别）' });
  } else {
    targets = extractor.scanDir(d.dir).map((x) => x.file);
    if (!targets.length) return res.json({ ok: true, id: null, count: 0, note: '该目录下没有认出压缩包（按魔数识别，不看扩展名）' });
  }

  const t = exNewTask('run', targets.length + ' 个压缩包', { dir: d.dir, files: targets });
  t.dir = d.dir;              /* ★ v10.73：历史里要带「产物路径」，这条入口也得填 */
  exEv(t, 'queued', { count: targets.length, dir: d.dir });
  exRun(t, async () => {
    t.phase = 'extract';
    const passwords = (b.passwords || []).map(String).filter(Boolean);
    const agg = { ok: true, destDir: d.dir, layers: [], needsPassword: [], failures: [], skipped: [], final: [], reachedDepth: 0, maxDepth: 5, root: d.dir, count: targets.length };
    for (let i = 0; i < targets.length; i++) {
      const f = targets[i];
      t.progress = Math.round((i / targets.length) * 100);
      exEv(t, 'file-start', { file: path.basename(f), i: i + 1, n: targets.length });
      const rep = await exExtractFile(t, f, passwords, d.dir);
      agg.layers.push(...rep.layers);
      agg.needsPassword.push(...rep.needsPassword);
      agg.failures.push(...rep.failures);
      agg.skipped.push(...rep.skipped);
      agg.final.push(...rep.final);
      agg.reachedDepth = Math.max(agg.reachedDepth, rep.reachedDepth);
      if (!rep.ok) agg.ok = false;
      /* ★ 熔断：连续 3 个包都是**真故障**（不是"需要密码"、不是"分卷"）就停。
       *   口径同全站：只有 err 算故障；need-password / volume 是数据现状，不算。
       *   不熔断的话，一个坏目录会让任务一直空转到超时才停。 */
      const tailFails = agg.failures.slice(-3);
      if (tailFails.length === 3 && tailFails.every((x) => x.reason === 'error' || x.reason === 'unreadable')) {
        exEv(t, 'circuit-break', { reason: '连续 3 个包都是真故障，已停止（避免空转）' });
        break;
      }
    }
    t.report = agg;
    t.needsPassword = agg.needsPassword;
    t.pending = agg.needsPassword.map((n) => ({ file: n.file, destDir: d.dir }));
    if (agg.needsPassword.length) t.state = 'need-password';
    else t.state = agg.ok ? 'done' : 'error';
  });
  res.json({ ok: true, id: t.id, count: targets.length });
});

/* ---------- GET /api/extract/task?id= — 轮询任务进度 ---------- */
app.get('/api/extract/task', (req, res) => {
  const id = String(req.query.id || '');
  if (!id) {
    return res.json({ ok: true, tasks: [...EX_TASKS.values()].slice(-8).map(exSnapshot), running: exRunning });
  }
  const t = EX_TASKS.get(id);
  if (!t) return res.status(404).json({ ok: false, error: '任务不存在或已过期' });
  res.json({ ok: true, task: exSnapshot(t) });
});

/* ---------- POST /api/extract/password { id, passwords[] } ----------
 * 用户填完密码后**续跑待解的那些包**（只跑 pending，不重跑已成功的）。 */
app.post('/api/extract/password', (req, res) => {
  const b = req.body || {};
  const t = EX_TASKS.get(String(b.id || ''));
  if (!t) return res.status(404).json({ ok: false, error: '任务不存在或已过期' });
  if (!t.pending.length) return res.status(400).json({ ok: false, error: '该任务没有待解密的包' });
  if (t.state === 'running') return res.status(409).json({ ok: false, error: '任务还在跑，请稍候' });
  const passwords = (b.passwords || []).map(String).filter(Boolean);
  if (!passwords.length) return res.status(400).json({ ok: false, error: '请至少填一个密码' });

  const pend = t.pending.slice();
  t.pending = [];
  t.state = 'running';
  t.finishedAt = null;
  exEv(t, 'password-submitted', { count: passwords.length, targets: pend.length });
  exRun(t, async () => {
    let stillNeed = [], fails = [];
    for (const p of pend) {
      const rep = await exExtractFile(t, p.file, passwords, p.destDir || path.dirname(p.file));
      if (t.report) {
        t.report.layers.push(...rep.layers);
        t.report.failures.push(...rep.failures);
        t.report.final.push(...rep.final);
        t.report.reachedDepth = Math.max(t.report.reachedDepth || 0, rep.reachedDepth);
      }
      stillNeed.push(...rep.needsPassword);
      fails.push(...rep.failures);
    }
    t.needsPassword = stillNeed;
    t.pending = stillNeed.map((n) => ({ file: n.file, destDir: path.dirname(n.file) }));
    if (stillNeed.length) {
      t.state = 'need-password';
      exEv(t, 'still-need-password', { count: stillNeed.length });
    } else {
      t.state = fails.length ? 'error' : 'done';
      exEv(t, 'password-ok', { count: pend.length });
    }
  });
  res.json({ ok: true, id: t.id, targets: pend.length });
});

/* ---------- POST /api/extract/open { dir } — 在文件管理器里打开解压产物目录 ----------
 *
 * ★ 为什么护栏收得比别的接口还紧：这是一个「让服务端替网页去执行动作」的接口，
 *   一旦能被任意页面调，它就等于一个「打开本机任意目录」的洞。所以：
 *     ① 必须再走一遍 exSafeDir（拒绝盘符根 / 系统目录 / UNC）
 *     ② 还要求**必须落在 DEFAULT_DEST 之内**（连它的父目录都不许）
 *     ③ 打不开就如实失败，并让前端退回「复制路径」—— 不假装成功
 *
 * ⚠️ 已知局限（如实记，别当它是可靠的）：`explorer.exe` 常把请求转交给已有实例后
 *    **立刻退出**，退出码不可靠（实测常见 rc=1 但窗口确实开了）⇒ 不能用退出码判成败。
 *    这里只能听 180ms 内的 spawn error（覆盖「explorer 不存在 / 被策略拦」这类即时失败）。
 *    ⇒ 前端**必须**同时给「复制路径」，不能只依赖这个按钮。 */
app.post('/api/extract/open', async (req, res) => {
  const d = exSafeDir((req.body && req.body.dir) || extractor.DEFAULT_DEST);
  if (!d.ok) return res.status(400).json({ ok: false, error: d.error });
  const root = path.resolve(extractor.DEFAULT_DEST);
  if (d.dir !== root && !d.dir.startsWith(root + path.sep)) {
    return res.status(400).json({ ok: false, error: '只允许打开解压目录内的路径：' + root });
  }
  try {
    const ch = spawn('explorer.exe', [d.dir], { detached: true, stdio: ['ignore', 'ignore', 'ignore'] });
    let failed = null;
    ch.on('error', (e) => { failed = e; });
    ch.unref();
    await new Promise((s) => setTimeout(s, 180));
    if (failed) {
      return res.status(502).json({ ok: false, error: '打不开文件管理器：' + String((failed && failed.message) || failed) });
    }
    res.json({ ok: true, dir: d.dir });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
});

/* ★ 兜底 404 —— 必须留在**所有路由之后**。
 *   v10.71 加解压助手时它一度被误删（用大段新路由直接替换了它），
 *   后果是所有未匹配路径不再返回结构化 404，而是掉进后续中间件。
 *   这里补回，并由 test-v1071 的静态断言守着「它确实在最后」。 */
app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not Found' }));

/* ★ v10.42：端口被占用时**默认不再静默换端口**，改为响亮失败并给出处理办法。
 *   为什么（2026-09-28 实测踩到）：想重启 8123，`stop` 之后端口尚未释放就启动，
 *   旧实现会一路自增到 8124 起个副实例 —— 三个可见后果：
 *     ① 用户以为重启成功（有日志、浏览器也开了），实际 8123 还是旧进程；
 *     ② 两个实例共写同一份 `data/**`，交叉覆盖；
 *     ③ 线上诊断以 8123 为准，看到的却是旧代码。
 *   逃生开关：`GAMEHUB_PORT_SHIFT=1`（并行跑对照实例时用）。 */
function listen(port, triesLeft) {
  const srv = app.listen(port, HOST, () => {
    console.log(`[GameHub] 聚合站已启动: http://${HOST}:${port}`);
    console.log(`[GameHub] 数据源: 机地 jidiyouxi.com  |  XDGAME xdgamer.com`);
  });
  srv.on('error', (e) => {
    if (e.code !== 'EADDRINUSE') {
      console.error('[GameHub] 启动失败:', e.message);
      process.exit(1);
    }
    if (ALLOW_PORT_SHIFT && triesLeft > 0) {
      console.log(`[GameHub] 端口 ${port} 被占用，GAMEHUB_PORT_SHIFT=1 ⇒ 尝试 ${port + 1} …`);
      listen(port + 1, triesLeft - 1);
      return;
    }
    console.error(`[GameHub] ★ 端口 ${port} 已被占用 —— 本次不会自动换端口（v10.42 起）。`);
    console.error(`[GameHub]   最可能：上一次的服务还在跑（浏览器能打开就说明是它）。`);
    console.error(`[GameHub]   处理：先运行 stop-gamehub.cmd，或杀掉占用 ${port} 的进程，再启动。`);
    console.error(`[GameHub]   若确实要让位到 ${port + 1}：设环境变量 GAMEHUB_PORT_SHIFT=1 后重试。`);
    process.exit(1);
  });
}
listen(PORT, 30);
