#!/usr/bin/env node
/**
 * tools/fetch-fr.js — 抓 FearlessRevolution（fearlessrevolution.com）的 Cheat Table / Trainer
 *
 * ── 为什么必须走浏览器（本脚本的全部复杂度都来自这一条）──────────────────
 * 整站在 Cloudflare 挑战后面。实测四条路只有最后一条通：
 *   ① 纯 HTTP（含 /robots.txt、/sitemap.xml）  → 403 + `Cf-Mitigated: challenge`
 *   ② headless Chrome                          → 24s 仍在「请稍候…」
 *   ③ 过挑战后把 cf_clearance 搬到 node fetch  → **仍 403**（CF 还看 TLS/JA3 指纹）
 *   ④ ★ 有头 Chrome + 页面上下文内 fetch        → **通**
 * ⇒ 所以：`connectBrowser({ headless:false, profile })` 过一次挑战，
 *   之后**不再用 page.goto**（导航会重新触发挑战），全部走页面内 `fetch()` ——
 *   同源 XHR 带着已通过的 cf_clearance 与完整浏览器指纹，实测连续多页 200 且 CF 不再出现。
 *   profile 固定成 `.cache/chrome-fr`：cf_clearance 存在里面，第二次起过挑战只要 ~0.8s。
 *
 * ── 两阶段 ────────────────────────────────────────────────────────────────
 *   阶段① 板块列表：f=4 Tables（336 页）/ f=5 Trainers，每页 50 帖 → 缓存 data/_fr-list-raw.json
 *   粗筛   主题标题 → 游戏名候选（frCheat.gameCandidates）→ 端游库名称索引
 *   阶段② 只对命中者抓主题页 → 解析附件（文件名 / 版本 / 大小 / 下载数 / 免登录下载链）
 *
 * ★ 站内搜索不可用（phpBB 只提示 "SEARCH USING GOOGLE"）⇒ 只能遍历板块 + 标题匹配。
 * ⚠️ 传输优化：`page.evaluate` 的返回值要**跨进程序列化**，整页 150KB × 300 页会拖死。
 *    所以页面内先用 DOMParser 取需要的那几个元素，**只回传片段**，
 *    解析仍统一交给 fetchers/frCheat.js（避免解析逻辑散落两处）。
 *
 * 用法：
 *   node tools/fetch-fr.js                    # 全量
 *   node tools/fetch-fr.js --list-only        # 只跑阶段①并缓存
 *   node tools/fetch-fr.js --offline          # 用缓存列表
 *   node tools/fetch-fr.js --max-pages 3      # 每板块只抓 3 页（调试）
 *   node tools/fetch-fr.js --max 50           # 阶段② 最多 50 帖（调试）
 *   node tools/fetch-fr.js --conc 1           # 并发（默认 1，别调高：CF 按速率 429）
 *   node tools/fetch-fr.js --gap 400          # 每请求后的间隔 ms（默认 400）
 *   node tools/fetch-fr.js --backoff 3000     # 429 退避基数 ms（3s→6s→12s）
 *   node tools/fetch-fr.js --eval-timeout 45000  # 单次 evaluate 硬超时 ms（默认 45000）
 *   node tools/fetch-fr.js --ctx-dead 6       # 连续 N 次恢复失败即熔断（默认 6）
 *   node tools/fetch-fr.js --dry              # 不落盘
 *
 * ★★ 会话纪律（2026-10-10 实测，别踩）：
 *   ① **不要在一轮里反复起停脚本**。三次连续短跑（各 --max 60）之后，第四次
 *      「过挑战」直接失败 —— `title` 停在「请稍候…」80s 到顶。CF 是按**会话/速率**
 *      收紧的，重开会话会**重新触发挑战**，profile 里的 cf_clearance 不再够用。
 *      ⇒ 一次跑够（阶段① 全量实测 528.2s / 433 页 / 失败页 0）。
 *   ② 挑战失败是**响亮失败**（抛 `Cloudflare 挑战未通过`），不会静默给空数据。
 *   ③ 阶段① 慢（1.22s/页），阶段② 更慢（1.4k~10k 个主题页）⇒ 阶段① 的缓存
 *      （`data/_fr-list-raw.json`）**必须留着**，`--offline` 直接复用，
 *      否则每次重跑都要再付一次 ~9 分钟。
 */
const fs = require('fs');
const path = require('path');

const fr = require('../fetchers/frCheat');
const { buildLibIndex, matchLib } = require('../data/mod-match');
const { connectBrowser } = require('./browser');

const ROOT = path.join(__dirname, '..');
const D = path.join(ROOT, 'data');
const CACHE = path.join(D, '_fr-list-raw.json');
const OUT = path.join(D, 'fr.json');
const BAK = path.join(ROOT, '_bak', 'fr.json.pre-v1047');
const PROFILE = path.join(ROOT, '.cache', 'chrome-fr');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const LIST_ONLY = has('--list-only');
const OFFLINE = has('--offline');
const DRY = has('--dry');
const MAX = parseInt(val('--max', '0'), 10) || 0;
const MAX_PAGES = parseInt(val('--max-pages', '0'), 10) || 0;
/* 列表阶段并发与请求间隔。
 * ★ 实测（2026-10-10，三轮）：
 *   并发 3 + gap 150ms → 336 页挂 276 页
 *   并发 2 + gap 260ms → 40 页挂 3 页（失败原因清一色 `CF 挑战（429）`）
 *   ⇒ CF 是按**速率**限流（429），不是按总量。串行 + 更大间隔才稳。
 *   ✅ 并发 1 + gap 400ms：**全量 433 页实测 528.2s（8.8min）· 失败页 0 · CF 命中 0**
 *      （2026-10-10 实跑，不是估算）—— 换「一页不丢」是值的。
 * ⚠️ 退避也不能太短：429 是带冷却期的，1.2s/2.4s 那种量级恢复不了（实测那 3 页三次全失败）。 */
const LIST_CONC = parseInt(val('--conc', '1'), 10) || 1;
const FR_GAP = parseInt(val('--gap', '400'), 10) || 400;
/** 429 退避步长（ms）：第 n 次重试等 BACKOFF_MS × n + 抖动 */
const BACKOFF_MS = parseInt(val('--backoff', '3000'), 10) || 3000;
/** 429 之后的等待：3s → 6s → 12s（乘性），再加 0~800ms 抖动避免多 worker 同步撞车 */
const backoffWait = (attempt) => BACKOFF_MS * Math.pow(2, attempt) + Math.floor(Math.random() * 800);
const PER_PAGE = 50;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 并发池：最多 n 个在飞；单条抛错不中断整批 */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (true) {
      const k = i++;
      if (k >= items.length) return;
      try { out[k] = await fn(items[k], k); }
      catch (e) { out[k] = { __err: String((e && e.message) || e) }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

(async () => {
  console.log('=== FearlessRevolution 抓取 ===' + (DRY ? '（--dry 不落盘）' : ''));
  const t0 = Date.now();

  /* ───────── 浏览器：有头 + 固定 profile ─────────
   * ★ 必须用**专用端口**：`connectBrowser` 见到端口上已有实例就**复用**，
   *   而 9222 常被实拍套件占着 —— 那样会复用到 headless 实例，CF 立刻拦。
   *   headed 只用 9333，互不干扰。 */
  const h = await connectBrowser({ headless: false, profile: PROFILE, window: '1280,900', port: 9333 });
  const browser = h.browser;
  /* ★ 用 `let` 而不是 `const`：见下面 `recyclePage()` —— 实测这个 page 会**死掉**，
   *   而 `page.goto` **救不回来**，唯一可行的恢复是**换一个新 page**。 */
  let page = await browser.newPage();

  /** 过挑战：CF 通过后 title 不再是「请稍候 / Just a moment」。返回 title。 */
  async function passChallenge(pg) {
    await pg.goto(fr.BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    let title = '', waited = 0;
    for (let i = 0; i < 20; i++) {
      title = await pg.title().catch(() => '');
      if (!/moment|稍候|Attention/i.test(title)) break;
      await sleep(4000); waited += 4000;
    }
    return { title, waited };
  }

  try {
    const ch = await passChallenge(page);
    console.log('过挑战 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's ｜ title="' + ch.title + '"');
    if (/moment|稍候|Attention/i.test(ch.title)) throw new Error('Cloudflare 挑战未通过（title 仍是「' + ch.title + '」）');

    /* ───────── 硬超时（2026-10-10 实测的坑） ─────────
     * ★★ 实测事故：一次全量跑到 33 分钟时**彻底卡死** —— 浏览器上下文永久失效后，
     *   `recoverFrame()` 的 `page.goto` 一直失败但被 `.catch(()=>{})` 吞掉，
     *   于是 `withRecover` 5 次 → 外层每页 4 次 → **无限循环**：进程 0% CPU、
     *   无 TCP 连接、无子进程、80 分钟无任何落盘，**却一直"在运行"**。
     *   ⇒ 从外部看「卡死」与「在跑」完全一样，这是最坏的一种失败形态。
     * 三道补丁：
     *   ① `page.evaluate` 加**硬超时**（页面内 `fetch()` 没有超时，CF 挂住就永不返回）；
     *   ② `recoverFrame()` 返回**是否真的恢复**（判据 = 能否拿到 title），不再吞掉失败；
     *   ③ **熔断**：连续 N 次恢复失败 ⇒ 直接抛「上下文不可恢复」终止，不再无限重试。
     *   ⚠️ 只熔断「上下文失效」这一类；CF/HTTP/空页面仍按 status 交调用方判断。 */
    const EVAL_TIMEOUT = parseInt(val('--eval-timeout', '45000'), 10) || 45000;
    const CTX_DEAD_MAX = parseInt(val('--ctx-dead', '6'), 10) || 6;
    let ctxDeadStreak = 0;
    const withTimeout = (p, label) => {
      let timer = null;
      const guard = new Promise((_, rej) => {
        timer = setTimeout(() => rej(new Error('evaluate 超时（' + EVAL_TIMEOUT + 'ms）: ' + label)), EVAL_TIMEOUT);
        if (timer.unref) timer.unref();
      });
      return Promise.race([p, guard]).finally(() => { if (timer) clearTimeout(timer); });
    };

    /** 页面上下文内 fetch → 只回传**精简片段**（见文件头「传输优化」） */
    /** 列表页：只回传 topictitle 链接片段 + 分页/总数线索 */
    const pullList = async (url) => withTimeout(page.evaluate(async (u) => {
      const r = await fetch(u, { credentials: 'include' });
      const t = await r.text();
      const doc = new DOMParser().parseFromString(t, 'text/html');
      const links = [...doc.querySelectorAll('a.topictitle')].map((a) => a.outerHTML).join('\n');
      const starts = [...t.matchAll(/[?&](?:amp;)?start=(\d+)/g)].map((m) => +m[1]);
      const tot = (t.match(/([\d,]+)\s+topics?\b/i) || [])[1] || '';
      const cf = /Just a moment|cf-chl/i.test(t);
      /* 429 一般带 Retry-After —— 有就按它等，比自己猜的退避更准 */
      return { status: r.status, retryAfter: r.headers.get('retry-after') || '', links, maxStart: starts.length ? Math.max(...starts) : 0, total: tot, cf };
    }, url), 'list ' + url);
    /** 主题页：只回传标题块 + 附件块 */
    const pullTopic = async (url) => withTimeout(page.evaluate(async (u) => {
      const r = await fetch(u, { credentials: 'include' });
      const t = await r.text();
      const doc = new DOMParser().parseFromString(t, 'text/html');
      const head = doc.querySelector('h2.topic-title');
      const files = [...doc.querySelectorAll('dl.file')].map((d) => d.outerHTML).join('\n');
      return { status: r.status, retryAfter: r.headers.get('retry-after') || '', html: (head ? head.outerHTML : '') + '\n' + files, cf: /Just a moment|cf-chl/i.test(t) };
    }, url), 'topic ' + url);

    /* ───────── frame 自愈（长跑必踩） ─────────
     * ★★ 实测（2026-10-10 全量）：Tables 板块 336 页跑完、进 Trainers 板块时崩在
     *   `Attempted to use a detached Frame`，**一次就把整轮 36 分钟废掉**。
     *   两个原因叠加：
     *     ① 崩的那行（板块**首个**请求）在重试循环**之外**，没有任何保护；
     *     ② 更根本 —— detached Frame 是**浏览器侧上下文失效**，不是 CF 也不是限速，
     *        所以在同一个 frame 上重试 evaluate **永远是同一个错**，
     *        必须让 page 重新回到本域名下、拿到新的 execution context 才有用。
     *   ⇒ 统一包一层：识别 detached / context destroyed ⇒ `page.goto` 回首页恢复上下文再重试。
     *   ⚠️ 这层**只管「上下文没了」**；CF / HTTP / 空页面仍由调用方按 status 判断
     *     （别把业务失败也吞进「重试」里，那会把「没抓到」洗成「抓到了」）。 */
    const isDetached = (e) => /detached Frame|Execution context was destroyed|Target closed|Session closed/i
      .test(String((e && e.message) || e));
    /** ★★ 页面回收 —— 这是本轮最关键的一条修复（2026-10-10 实测复现）。
     *  现象：**跑完一个板块、切下一个板块时 page 上下文必死**（`Attempted to use a detached Frame`），
     *        而且 `page.goto` 回本域名**也救不回来**（本题第一次全量就是这么废掉的：
     *        Tables 336 页跑完，进 Trainers 时崩，整轮 36 分钟归零）。
     *  为什么 `goto` 没用：detached Frame 是**浏览器侧那个 frame 已经没了**，
     *        在死 frame 上做任何操作（包括 goto）都落在同一个死对象上。
     *  唯一可行：**弃掉旧 page、开一个新 page、重新过挑战**（profile 里已有 cf_clearance，
     *        实测第二次过挑战只要 ~1s，所以代价很小）。
     *  ⚠️ 失败与成功都要**如实返回**：调用方靠返回值决定要不要熔断，不能吞。 */
    async function recyclePage(reason) {
      const old = page;
      try { await old.close(); } catch (e) { /* 已经死了，关不掉很正常 */ }
      try {
        page = await browser.newPage();
        const ch = await passChallenge(page);
        if (/moment|稍候|Attention/i.test(ch.title)) return false;
        console.log('    ↻ 已换新 page 并重新过挑战（' + (ch.waited / 1000) + 's）｜原因：' + reason);
        return true;
      } catch (e) {
        return false;
      }
    }
    /** ★ 恢复**必须返回是否真恢复了**：判据 = 能拿到 title（拿到就说明 context 活着）。
     *   原先写成 `await page.goto(...).catch(()=>{})`（吞掉失败、返回 undefined）⇒
     *   调用方**无法区分**「恢复了」和「浏览器已经死了」，只能继续重试 ⇒ 无限循环。 */
    async function recoverFrame() {
      try {
        await page.goto(fr.BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        const t = await page.title();
        if (typeof t === 'string') return true;
      } catch (e) { /* goto 救不回来 ⇒ 走回收 */ }
      return recyclePage('page.goto 无法恢复');
    }
    const withRecover = (fn) => async (url) => {
      let last = null;
      for (let i = 0; i < 5; i++) {
        try { const r = await fn(url); ctxDeadStreak = 0; return r; } catch (e) {
          last = e;
          if (isDetached(e)) {
            console.log('    ⚠ frame 失效 ⇒ 恢复页面上下文后重试（第 ' + (i + 1) + ' 次）');
            const ok = await recoverFrame();
            if (!ok) {
              ctxDeadStreak++;
              console.log('    ✗ 恢复失败（连续 ' + ctxDeadStreak + '/' + CTX_DEAD_MAX + '）');
              /* ★★ 熔断：上下文不可恢复 ⇒ **响亮失败**。
               *   不熔断的后果实测过：0% CPU、无连接、无子进程地空转 80 分钟，
               *   而外部看起来与「正在抓」完全一样。宁可当场红，也不要静默挂着。 */
              if (ctxDeadStreak >= CTX_DEAD_MAX) {
                throw new Error('浏览器上下文不可恢复（连续 ' + ctxDeadStreak + ' 次 recoverFrame 失败）'
                  + ' ⇒ 终止本轮。多半是有头 Edge 已退出/被杀；重跑一次即可。原始错误：' + String((e && e.message) || e));
              }
            }
            await sleep(1200);
          } else await sleep(backoffWait(i));
        }
      }
      throw last;
    };
    const pullListSafe = withRecover(pullList);
    const pullTopicSafe = withRecover(pullTopic);

    /* ───────── 阶段① 列表 ───────── */
    let list = [];
    if (OFFLINE && fs.existsSync(CACHE)) {
      const c = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
      /* ★ 拒绝中间态：增量落盘会写出 `partial:true` 的半份缓存（只有一个板块）。
         静默用它会得到「列表少一半」且**看不出哪里不对**（完整性自检也可能过得去，
         因为平均每页帖数仍然正常）。 */
      if (c.partial) {
        throw new Error('缓存是增量中间态（partial，只有 ' + (c.items || []).length + ' 帖）⇒ 拒绝使用。'
          + '请先不带 --offline 重跑一次，拿到完整缓存。');
      }
      list = c.items || [];
      console.log('阶段① 跳过（--offline）⇒ 用缓存 ' + list.length + ' 条');
    } else {
      console.log('阶段① 抓板块列表…');
      const failedPages = [];
      /** ★ 失败原因必须留证：本脚本第一版把异常吞进 failedPages 只留页码，
       *   结果是「276/336 页失败」但**看不出为什么**（CF？限速？evaluate 上下文被销毁？），
       *   只能靠猜。现在把 message 一起收着，收尾打印前 5 种。 */
      const failWhy = new Map();
      const noteFail = (k, e) => {
        const m = String((e && e.message) || e).slice(0, 160);
        failedPages.push(k);
        failWhy.set(m, (failWhy.get(m) || 0) + 1);
      };
      let fetchedPages = 0;
      for (const fid of Object.keys(fr.FORUM)) {
        const first = await pullListSafe(`${fr.BASE}/viewforum.php?f=${fid}`);
        if (first.cf) throw new Error('板块 ' + fid + ' 首个请求就撞上 CF 挑战 ⇒ 会话已失效');
        const maxStart = first.maxStart || 0;
        const total = first.total ? parseInt(first.total.replace(/,/g, ''), 10) : 0;
        const pages = Math.max(1, Math.ceil((maxStart + PER_PAGE) / PER_PAGE));
        const use = MAX_PAGES ? Math.min(pages, MAX_PAGES) : pages;
        console.log('  ' + fr.FORUM[fid].name + '：' + (total || '?') + ' 主题 → ' + pages
          + ' 页' + (MAX_PAGES ? '（取前 ' + use + ' 页）' : ''));
        const starts = Array.from({ length: use }, (_, i) => i * PER_PAGE);
        /* ★ 页级进度（2026-10-10 补）：原先只有「板块开始 / 板块结束」两行，
         *   于是进程卡死时**日志与「正在跑」长得一模一样**，只能靠 0% CPU + 无 TCP 连接
         *   这类外部迹象反推。现在每页一行「已完/总数 + 帖数 + 用时」，卡在哪一页一眼可见。 */
        const pgT0 = Date.now();
        let donePages = 0;
        const tickPage = (extra) => {
          donePages++;
          console.log('    [' + fr.FORUM[fid].key + '] ' + donePages + '/' + use + ' 页 · ' + extra
            + ' · ' + ((Date.now() - pgT0) / 1000).toFixed(0) + 's');
        };
        /* ★ 并发/限速：实测（2026-10-10）并发 3 + 150ms 时，只有前 ~60 页成功，
         *   之后整批失败（336 页里 276 页挂）⇒ CF 会按**请求速率**收紧。
         *   改成并发 2 + 每请求 260ms（≈7.7 req/s），并对失败做 2 次退避重试。
         *   ⚠️ 重试**必须重新过一遍**（不是复用旧响应），否则重试也白搭。 */
        const rows = await pool(starts, LIST_CONC, async (s) => {
          const u = `${fr.BASE}/viewforum.php?f=${fid}&start=${s}`;
          let lastErr = null;
          for (let attempt = 0; attempt < 4; attempt++) {
            let wait = backoffWait(attempt);
            try {
              const r = s === 0 && attempt === 0 ? first : await pullListSafe(u);
              if (r.cf) { lastErr = Object.assign(new Error('CF 挑战（' + r.status + '）'), { retryAfter: r.retryAfter }); throw lastErr; }
              if (r.status !== 200) { lastErr = Object.assign(new Error('HTTP ' + r.status), { retryAfter: r.retryAfter }); throw lastErr; }
              if (!r.links) { lastErr = new Error('页面无 topictitle（可能是 CF 无提示页）'); throw lastErr; }
              await sleep(FR_GAP);
              const parsed = fr.parseForumList(r.links).map((x) => Object.assign(x, { forum: fid, forumKey: fr.FORUM[fid].key }));
              tickPage(parsed.length + ' 帖');
              return parsed;
            } catch (e) {
              lastErr = e;
              /* 服务端给了 Retry-After 就听它的（取两者较大值） */
              const ra = parseInt(e && e.retryAfter, 10);
              if (ra > 0) wait = Math.max(wait, ra * 1000);
              await sleep(wait);
            }
          }
          noteFail(fid + ':' + s, lastErr);
          tickPage('✗ ' + String((lastErr && lastErr.message) || lastErr).slice(0, 60));
          return [];
        });
        fetchedPages += use;
        let n = 0;
        const seen = new Set();
        for (const r of rows) for (const x of r) if (!seen.has(x.t)) { seen.add(x.t); list.push(x); n++; }
        console.log('    → ' + n + ' 帖');
        /* ★ 板块级增量落盘：全量一次 ~40min，而缓存原先只在**全部跑完**时写一次 ⇒
         *   中途任何异常（实测：detached Frame）都会让已抓到的几百页**全丢**，
         *   只能从零再来 40 分钟。
         *   ⚠️ 这不是「进度落盘」（铁律 20 禁的是把进度挂在频繁写盘上）——
         *     只在**板块边界**写，且写的是**已拿到的数据本身**，不是进度百分比。
         *   ⚠️ 落盘时打 `partial: true`：读缓存的路径必须**拒绝**中间态，
         *     否则会把「只有 Tables 板块」的半份缓存当成完整列表用（静默少一半数据）。 */
        if (!DRY) {
          try {
            fs.writeFileSync(CACHE, JSON.stringify({ builtAt: Date.now(), partial: true, items: list }));
            console.log('    ↳ 增量落盘 ' + list.length + ' 帖（partial，仅防中断）');
          } catch (e) { }
        }
        if (failedPages.length > fetchedPages * 0.25) {
          throw new Error('列表失败页过多（' + failedPages.length + '/' + fetchedPages + '）⇒ 不落缓存');
        }
      }
      const perPage = list.length / fetchedPages;
      /* 完整性自检：CF 撞上时页面仍是 HTML（不是失败），会**静默少数据** ——
       * 判据用平均每页帖数（正常接近 50）。 */
      if (fetchedPages > 3 && perPage < PER_PAGE / 3) {
        throw new Error('列表疑似残缺：' + fetchedPages + ' 页只拿到 ' + list.length
          + ' 帖（平均 ' + perPage.toFixed(1) + '/页，正常应接近 ' + PER_PAGE + '）｜ CF 命中 ' + cfHits);
      }
      console.log('  合计 ' + list.length + ' 帖（平均 ' + perPage.toFixed(1) + '/页）｜ 失败页 '
        + failedPages.length + ' ｜ 耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
      /* ★ 失败原因逐种打印 —— 「276 页失败」这种数字本身没有信息量，
       *   必须看到是 CF 还是 5xx 还是超时，才知道该降速还是该换路。 */
      if (failWhy.size) {
        console.log('  失败原因（共 ' + failedPages.length + ' 页）：');
        [...failWhy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
          .forEach(([m, n]) => console.log('    ×' + n + '  ' + m));
      }
      if (failedPages.length) {
        console.log('  失败页样例：' + failedPages.slice(0, 8).join(', ') + (failedPages.length > 8 ? ' …' : ''));
      }
      if (!DRY) {
        /* cfHits 从失败原因里数出来（改版后不再单独计数，避免两处口径漂移） */
        const cfN = [...failWhy.entries()].filter(([m]) => /CF 挑战/.test(m)).reduce((n, x) => n + x[1], 0);
        fs.writeFileSync(CACHE, JSON.stringify({ builtAt: Date.now(), failedPages, cfHits: cfN, items: list }));
        console.log('  已缓存 → ' + path.basename(CACHE) + '（' + (fs.statSync(CACHE).size / 1048576).toFixed(2) + 'MB）');
      }
    }

    const listTotal = list.length;
    console.log('列表 ' + listTotal + ' 帖');
    if (LIST_ONLY) { console.log('\n--list-only：到此为止。'); return; }

    /* ───────── 粗筛 ───────── */
    const gamesDb = require('../data/gamesDb');
    gamesDb.load();
    const all = gamesDb.all();
    const { byName } = buildLibIndex(all);
    console.log('端游库：' + all.length + ' 款 → 名称索引键 ' + byName.size + ' 个');

    const pre = [];
    for (const it of list) {
      const cands = fr.gameCandidates(it.title);
      it.cand = cands;
      for (let i = 0; i < cands.length; i++) {
        const m = matchLib(cands[i], byName);
        if (m) { it.preLib = { id: m.id || '', title: m.title || '' }; it.preHow = 'title' + (i + 1); it.preKey = cands[i]; pre.push(it); break; }
      }
    }
    const preCovered = new Set(pre.map((x) => x.preLib.id)).size;
    console.log('粗筛命中 ' + pre.length + '/' + listTotal + '（'
      + (listTotal ? (pre.length / listTotal * 100).toFixed(1) : 0) + '%）｜ 覆盖端游库 ' + preCovered + ' 款');

    /* ───────── 阶段② 主题页（只对命中者） ───────── */
    let targets = pre;
    if (MAX) targets = targets.slice(0, MAX);
    console.log('阶段②：抓 ' + targets.length + ' 个主题页（附件）');

    let done = 0, cfHits2 = 0;
    /* ★ 阶段② 沿用与阶段① 同一套限速（见 LIST_CONC 注释）：CF 是按**速率**收紧的，
     *   主题页比列表页更重，速率只许更低不许更高。 */
    const results = await pool(targets, LIST_CONC, async (it) => {
      const u = `${fr.BASE}/viewtopic.php?f=${it.f || 4}&t=${it.t}`;
      let r = null, lastErr = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        let wait = backoffWait(attempt);
        try {
          r = await pullTopicSafe(u);
          if (r.cf) { lastErr = Object.assign(new Error('CF 挑战'), { retryAfter: r.retryAfter }); throw lastErr; }
          if (r.status !== 200) { lastErr = Object.assign(new Error('HTTP ' + r.status), { retryAfter: r.retryAfter }); throw lastErr; }
          lastErr = null; break;
        } catch (e) {
          lastErr = e; r = null;
          const ra = parseInt(e && e.retryAfter, 10);
          if (ra > 0) wait = Math.max(wait, ra * 1000);
          await sleep(wait);
        }
      }
      if (lastErr) {
        if (/CF 挑战/.test(String(lastErr.message))) cfHits2++;
        return { __err: 'fetch: ' + String(lastErr.message).slice(0, 80) };
      }
      const d = fr.parseTopic(r.html);
      await sleep(FR_GAP);
      done++;
      if (done % 50 === 0 || done === targets.length) console.log('  … ' + done + '/' + targets.length);
      if (!d.attachments.length) return { __err: 'no-attach' };
      return {
        t: it.t, f: it.f || '', forum: it.forumKey || '',
        title: it.title,
        topicTitle: d.title || '',
        game: it.preKey || '',
        attachments: d.attachments,
        sourceUrl: `${fr.BASE}/viewtopic.php?f=${it.f || 4}&t=${it.t}`,
        libId: it.preLib.id, libTitle: it.preLib.title,
        matchHow: it.preHow, matchKey: it.preKey,
        cand: it.cand,
      };
    });

    const items = results.filter((r) => r && !r.__err);
    const noAttach = results.filter((r) => r && r.__err === 'no-attach').length;
    const crashed = results.filter((r) => r && r.__err && r.__err !== 'no-attach').length;
    /** 阶段② 的失败也要能看出原因（同阶段①：数字本身没有信息量） */
    const errWhy = new Map();
    for (const r of results) {
      if (r && r.__err) errWhy.set(r.__err, (errWhy.get(r.__err) || 0) + 1);
    }

    /* ───────── 铁律 26：全失败就不落盘、不动 ts ───────── */
    if (!items.length) {
      const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
      console.log('\n★★ 主题页**全部失败** ⇒ 不落盘、不动 ts，返回旧值'
        + (prev ? '（旧 ' + (prev.items || []).length + ' 条）' : '（且无旧值）'));
      if (prev) prev.stats = Object.assign({}, prev.stats, { allFailed: true });
      process.exitCode = 1;
      return;
    }

    /* ───────── 完整性自检（★ 本轮的教训：CF 撞上时页面仍是 HTML，会静默少数据）─────
     * 判据用「抓取失败占目标的比例」，超过 1/4 就说明会话已被限速 ⇒ 不落盘。
     * 这与 fetch-gtrainers.js 的「平均每页条数」是同一类自检：宁可响亮失败，
     * 也不要把残缺清单当下轮基线。 */
    if (targets.length > 8 && crashed > targets.length * 0.25) {
      console.log('\n★★ 主题页失败过多（' + crashed + '/' + targets.length + '）⇒ 不落盘、不动 ts');
      errWhy.forEach((n, m) => console.log('    ×' + n + '  ' + m));
      process.exitCode = 1;
      return;
    }

    const attTotal = items.reduce((n, x) => n + x.attachments.length, 0);
    const libCovered = new Set(items.map((x) => x.libId).filter(Boolean)).size;
    const byForum = {};
    for (const x of items) byForum[x.forum] = (byForum[x.forum] || 0) + 1;

    const stats = {
      builtAt: Date.now(),
      source: 'FearlessRevolution（fearlessrevolution.com）Cheat Engine 表 / Trainer',
      listTotal, preMatched: pre.length,
      preMatchedPct: listTotal ? +(pre.length / listTotal * 100).toFixed(1) : 0,
      topicTotal: items.length, attTotal,
      noAttach, crashed, cfHits: cfHits2, libCovered,
      byForum, allFailed: false,
    };
    console.log('\n=== 汇总 ===');
    console.log('列表 ' + listTotal + ' ｜ 粗筛 ' + pre.length + ' ｜ 有附件的主题 ' + items.length
      + '（无附件 ' + noAttach + ' · 崩 ' + crashed + '）');
    console.log('附件总数 ' + attTotal + ' ｜ 覆盖端游库 ' + libCovered + ' 款 ｜ 板块 ' + JSON.stringify(byForum));
    if (errWhy.size) {
      console.log('失败原因：');
      [...errWhy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
        .forEach(([m, n]) => console.log('  ×' + n + '  ' + m));
    }

    if (DRY) { console.log('\n--dry：未落盘。'); return; }
    if (fs.existsSync(OUT)) {
      fs.mkdirSync(path.dirname(BAK), { recursive: true });
      fs.copyFileSync(OUT, BAK);
      console.log('已备份旧文件 → _bak/' + path.basename(BAK));
    }
    fs.writeFileSync(OUT, JSON.stringify({ builtAt: stats.builtAt, stats, items }, null, 0));
    console.log('已写出 → data/fr.json（' + (fs.statSync(OUT).size / 1048576).toFixed(2) + 'MB）');
    console.log('总耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  } finally {
    try { await h.close(); } catch (e) { /* 已关 */ }
  }
})().catch((e) => { console.error('抓取失败：' + ((e && e.stack) || e)); process.exit(1); });
