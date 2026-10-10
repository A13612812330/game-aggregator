#!/usr/bin/env node
/**
 * tools/fetch-gtrainers.js — 抓 GTrainers（gtrainers.com）的「存档 + 修改器」
 *
 * ── 这脚本解决什么（用户口径）─────────────────────────────────────────────
 * 「我看了下未有下载链接原因是未获取到真实下载链，这两个是他们原链可以直接获取
 *   根据游戏名称进行匹配」
 * ⇒ GTrainers 的每条资源都有**真实文件直链**（301 直达 .rar），且**免登录免网盘**。
 *   本脚本把它按**游戏名**对到端游库，产出一条可下载的资源记录。
 *
 * ── 两阶段（与 fetch-saves-youxia.js 同一套做法）──────────────────────────
 *   阶段① 分类页全量：saves(catid=30) 206 页 + trainers(catid=28) 306 页，每页 30 条
 *          → 缓存 data/_gt-list-raw.json
 *   粗筛   用**运营标题**生成游戏名候选 → 对端游库名称索引（宽口径，宁可多抓）
 *   阶段② 只对粗筛命中者抓详情页：拿**权威游戏名**（详情页 `Game:` 栏）重新匹配 +
 *          取下载口 `/load/0-0-1-<id>-<fileid>` 并解析 301 得到**真实直链**
 *
 *   ★ 为什么权威匹配必须放在详情页：标题是运营写的（`… - SaveGame 100%`、
 *     `… - Trainer +43 {CheatHappens.com}`），抽名会切坏含 `:`/` - ` 的游戏名
 *     （`GTA: San Andreas - The Definitive Edition`）。详情页的 `Game:` 才是干净值。
 *
 * 用法：
 *   node tools/fetch-gtrainers.js                 # 全量（列表 + 详情 + 落盘）
 *   node tools/fetch-gtrainers.js --list-only     # 只跑阶段①并缓存
 *   node tools/fetch-gtrainers.js --offline       # 用已缓存列表，不重抓
 *   node tools/fetch-gtrainers.js --max-pages 3   # 只抓前 3 页/分类（调试）
 *   node tools/fetch-gtrainers.js --max 50        # 阶段② 最多抓 50 条详情（调试）
 *   node tools/fetch-gtrainers.js --conc 8        # 阶段② 并发（默认 5）
 *   node tools/fetch-gtrainers.js --dry           # 不落盘
 */
const fs = require('fs');
const path = require('path');

const gt = require('../fetchers/gtrainers');
const { buildLibIndex, matchLib } = require('../data/mod-match');

const ROOT = path.join(__dirname, '..');
const D = path.join(ROOT, 'data');
const CACHE = path.join(D, '_gt-list-raw.json');
const OUT = path.join(D, 'gtrainers.json');
const BAK = path.join(ROOT, '_bak', 'gtrainers.json.pre-v1047');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const LIST_ONLY = has('--list-only');
const OFFLINE = has('--offline');
const DRY = has('--dry');
const MAX = parseInt(val('--max', '0'), 10) || 0;
const MAX_PAGES = parseInt(val('--max-pages', '0'), 10) || 0;
/* 阶段② 并发。实测（2026-10-10，本机）：该站单请求约 1s，每条要 2 个请求
 * （详情页 + 下载口 301 探针），所以并发直接决定总时长 —— 3 并发跑 9,346 条要 ~110min，
 * 5 并发约 60min。默认 5：列表阶段用 5 并发已跑通 512 页无风控，详情页不至于更敏感。 */
const CONC = parseInt(val('--conc', '5'), 10) || 5;

/** 简单并发池：最多 n 个在飞；单条抛错不中断整批（错误对象打上 __err 由调用方过滤） */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0, done = 0;
  const worker = async () => {
    while (true) {
      const k = i++;
      if (k >= items.length) return;
      try { out[k] = await fn(items[k], k); }
      catch (e) { out[k] = { __err: String((e && e.message) || e) }; }
      done++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('=== GTrainers 抓取 ===' + (DRY ? '（--dry 不落盘）' : ''));
  const t0 = Date.now();

  /* ───────── 阶段① 列表 ───────── */
  let list = [];
  const useCache = OFFLINE && fs.existsSync(CACHE);
  if (useCache) {
    const c = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
    list = c.items || [];
    console.log('阶段① 跳过（--offline）⇒ 用缓存 ' + list.length + ' 条（缓存于 '
      + new Date(c.builtAt).toISOString().slice(0, 16).replace('T', ' ') + '）');
  } else {
    console.log('阶段① 抓分类页…');
    const failedPages = [];
    let fetchedPages = 0;
    for (const cat of ['saves', 'trainers']) {
      /* 先取第 1 页拿最大页码 */
      const first = await gt.getText(gt.listUrl(cat, 1));
      const maxPage = MAX_PAGES || gt.maxPageIn(first);
      const pages = Array.from({ length: maxPage }, (_, i) => i + 1);
      console.log('  ' + gt.CAT[cat].name + '（catid=' + gt.CAT[cat].id + '）共 ' + maxPage + ' 页');
      const rows = await pool(pages, 5, async (p) => {
        try {
          const html = p === 1 ? first : await gt.getText(gt.listUrl(cat, p));
          return gt.parseList(html, cat);
        } catch (e) { failedPages.push(cat + ':' + p); return []; }
      });
      fetchedPages += pages.length;
      let n = 0;
      const seen = new Set();
      for (const r of rows) for (const x of r) if (!seen.has(x.cat + x.id)) { seen.add(x.cat + x.id); list.push(x); n++; }
      console.log('    → ' + n + ' 条');
      /* 风控判断：失败页过多就不落缓存（免得下轮把残缺当基线） */
      if (failedPages.length > pages.length * 0.25) {
        throw new Error('列表失败页过多（' + failedPages.length + '/' + pages.length + '）⇒ 不落缓存，先排查网络/风控');
      }
    }
    /* ★ 完整性自检（本脚本第一版就栽在这）：分页参数写错时，越界页会**回吐同一页**且 HTTP 仍 200，
     *   于是「失败页 0」却只有几百条 —— 静默少数据。判据用「平均每页条数」而不是绝对值：
     *   正常应接近 PER_PAGE(30)，低于 1/3 就说明分页没生效。 */
    const perPage = list.length / fetchedPages;
    if (fetchedPages > 4 && perPage < gt.PER_PAGE / 3) {
      throw new Error('分页疑似未生效：' + fetchedPages + ' 页只拿到 ' + list.length
        + ' 条（平均 ' + perPage.toFixed(2) + ' 条/页，正常应接近 ' + gt.PER_PAGE
        + '）⇒ 不落缓存。检查 listUrl 的分页形式是否为 <catid>-<page>-1');
    }
    console.log('  合计列表 ' + list.length + ' 条（平均 ' + perPage.toFixed(1) + ' 条/页）｜ 失败页 ' + failedPages.length
      + ' ｜ 耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
    if (!DRY) {
      fs.writeFileSync(CACHE, JSON.stringify({ builtAt: Date.now(), failedPages, items: list }));
      console.log('  已缓存 → ' + path.basename(CACHE) + '（' + (fs.statSync(CACHE).size / 1048576).toFixed(2) + 'MB）');
    }
  }

  const listTotal = list.length;
  const byCat = { saves: 0, trainers: 0 };
  for (const x of list) byCat[x.cat] = (byCat[x.cat] || 0) + 1;
  console.log('列表 ' + listTotal + ' 条 ｜ 存档 ' + byCat.saves + ' · 修改器 ' + byCat.trainers);

  if (LIST_ONLY) { console.log('\n--list-only：到此为止。'); return; }

  /* ───────── 端游库索引 ───────── */
  const gamesDb = require('../data/gamesDb');
  gamesDb.load();
  const all = gamesDb.all();
  const { byName } = buildLibIndex(all);
  console.log('端游库：' + all.length + ' 款 → 名称索引键 ' + byName.size + ' 个');

  /* ───────── 粗筛：标题候选 → 端游库（宽口径，宁可多抓详情） ───────── */
  const pre = [];
  for (const it of list) {
    const cands = gt.gameCandidates(it.title);
    let hit = null, how = '', key = '';
    for (let i = 0; i < cands.length; i++) {
      const m = matchLib(cands[i], byName);
      if (m) { hit = m; how = 'title' + (i + 1); key = cands[i]; break; }
    }
    it.cand = cands;
    if (hit) { it.preLib = { id: hit.id || '', title: hit.title || '' }; it.preHow = how; it.preKey = key; pre.push(it); }
  }
  const preCovered = new Set(pre.map((x) => x.preLib.id)).size;
  console.log('粗筛命中 ' + pre.length + '/' + listTotal + '（'
    + (listTotal ? (pre.length / listTotal * 100).toFixed(1) : 0) + '%）｜ 覆盖端游库 ' + preCovered + ' 款');

  /* ───────── 阶段② 详情（只对粗筛命中） ───────── */
  let targets = pre;
  if (MAX) targets = targets.slice(0, MAX);
  console.log('阶段②：抓 ' + targets.length + ' 条详情（权威游戏名 + 真实直链）');

  let done = 0, dlFail = 0;
  const results = await pool(targets, CONC, async (it) => {
    const html = await gt.getText(it.url);
    const d = gt.parseDetail(html, it.id);
    /* 权威匹配：详情页 `Game:` 优先；失败则回退粗筛结果 */
    let libId = '', libTitle = '', matchHow = '', matchKey = '';
    const auth = d.game ? matchLib(d.game, byName) : null;
    if (auth) { libId = auth.id || ''; libTitle = auth.title || ''; matchHow = 'game'; matchKey = d.game; }
    else { libId = it.preLib.id; libTitle = it.preLib.title; matchHow = it.preHow; matchKey = it.preKey; }

    let direct = '', dlStatus = 0;
    if (d.dlPath) {
      try {
        const r = await gt.resolveDownload(d.dlPath);
        direct = r.url; dlStatus = r.status;
      } catch (e) { dlFail++; }
    }
    await sleep(120); /* 轻微限速，别把源站打急 */
    done++;
    if (done % 25 === 0 || done === targets.length) {
      /* 长跑要能判「还要多久」：并发 5 跑 9,346 条约 60min，没有速率就只能干等。 */
      const sec = (Date.now() - t0) / 1000;
      const eta = done ? sec / done * (targets.length - done) : 0;
      console.log('  … ' + done + '/' + targets.length + '（' + (done / sec).toFixed(2)
        + ' 条/s ｜ 已 ' + (sec / 60).toFixed(1) + 'min ｜ 预计还需 ' + (eta / 60).toFixed(1) + 'min）');
    }
    return {
      id: it.id, cat: it.cat,
      title: it.title,                 /* 展示用：列表页的条目标题 */
      detTitle: d.title || '',         /* 校验用：详情页 <title> */
      game: d.game || '',              /* 权威游戏名 */
      size: it.size || d.size || '',
      date: it.date || d.date || '',
      count: it.count || '',           /* 列表页的「下载数/热度」 */
      views: d.views || 0,
      downloads: d.downloads || 0,
      hash: d.hash || '',
      virustotal: d.virustotal || '',
      dlPath: d.dlPath || '',
      direct, dlStatus,
      sourceUrl: it.url,
      libId, libTitle, matchHow, matchKey,
      cand: it.cand,
    };
  });

  const items = results.filter((r) => r && !r.__err);
  const crashed = results.filter((r) => r && r.__err).length;

  /* ───────── 铁律 26：全失败就不落盘、不动 ts ───────── */
  if (!items.length) {
    const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
    console.log('\n★★ 详情**全部失败** ⇒ 不落盘、不动 ts，返回旧值'
      + (prev ? '（旧 ' + (prev.items || []).length + ' 条）' : '（且无旧值）'));
    if (prev) { prev.stats = Object.assign({}, prev.stats, { allFailed: true }); }
    process.exitCode = 1;
    return;
  }

  const withDirect = items.filter((x) => x.direct).length;
  const byHow = {};
  for (const x of items) byHow[x.matchHow] = (byHow[x.matchHow] || 0) + 1;
  const libCovered = new Set(items.map((x) => x.libId).filter(Boolean)).size;
  const catItems = { saves: items.filter((x) => x.cat === 'saves').length, trainers: items.filter((x) => x.cat === 'trainers').length };

  const stats = {
    builtAt: Date.now(),
    source: 'GTrainers（gtrainers.com）存档区 + 修改器区',
    listTotal, listSaves: byCat.saves, listTrainers: byCat.trainers,
    preMatched: pre.length, preMatchedPct: listTotal ? +(pre.length / listTotal * 100).toFixed(1) : 0,
    detailTotal: items.length, crashed,
    saves: catItems.saves, trainers: catItems.trainers,
    withDirect, directPct: items.length ? +(withDirect / items.length * 100).toFixed(1) : 0,
    dlFail, libCovered,
    matchBy: byHow,
    allFailed: false,
  };

  console.log('\n=== 汇总 ===');
  console.log('列表 ' + listTotal + ' ｜ 粗筛 ' + pre.length + ' ｜ 详情 ' + items.length + '（崩 ' + crashed + '）');
  console.log('存档 ' + catItems.saves + ' · 修改器 ' + catItems.trainers
    + ' ｜ 拿到真实直链 ' + withDirect + '（' + stats.directPct + '%）｜ 解析失败 ' + dlFail);
  console.log('覆盖端游库 ' + libCovered + ' 款 ｜ 匹配口径 ' + JSON.stringify(byHow));

  if (DRY) { console.log('\n--dry：未落盘。'); return; }

  if (fs.existsSync(OUT)) {
    fs.mkdirSync(path.dirname(BAK), { recursive: true });
    fs.copyFileSync(OUT, BAK);
    console.log('已备份旧文件 → _bak/' + path.basename(BAK));
  }
  fs.writeFileSync(OUT, JSON.stringify({ builtAt: stats.builtAt, stats, items }, null, 0));
  console.log('已写出 → data/gtrainers.json（' + (fs.statSync(OUT).size / 1048576).toFixed(2) + 'MB）');
  console.log('总耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
})().catch((e) => { console.error('抓取失败：' + ((e && e.stack) || e)); process.exit(1); });
