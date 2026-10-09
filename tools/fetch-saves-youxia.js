#!/usr/bin/env node
/**
 * tools/fetch-saves-youxia.js — 抓游侠补丁网「存档」区 → data/saves-youxia.json
 *
 * 背景：本项目此前**只有存档「位置」**（data/saves.json = Ludusavi manifest，纯路径），
 * 没有「存档文件」。UU 市集虽然 6,735 条，但其详情接口全文无文件字段、下载要走
 * 「登录 + UU 客户端转存」⇒ 给不了文件。游侠这边是**真直链**，故用它补上「文件」。
 *
 * ─────────────────────────────────────────────────────────────
 * ★ 两阶段策略（默认）：**先抓列表 → 按名匹配 → 只对匹配上的抓详情+文件**
 *
 *   为什么不全量抓详情：3,857 条 × 4 跳 ≈ 1.5 万次请求，其中大部分游戏本地库里根本没有，
 *   抓了也是死数据。列表页的标题自带 `《游戏名》`，足够先做一次名称匹配。
 *
 *   阶段①：203 页列表 → 全量条目（id/title/game/cover/size/date）
 *   阶段②：与端游库名称匹配 → 命中的才抓详情 + 解析文件（四跳）
 *
 * 用法：
 *   node tools/fetch-saves-youxia.js              # 两阶段全流程
 *   node tools/fetch-saves-youxia.js --list-only  # 只抓列表（第①阶段）
 *   node tools/fetch-saves-youxia.js --offline    # 用缓存列表重跑第②阶段（改匹配逻辑时用）
 *   node tools/fetch-saves-youxia.js --max 20     # 最多抓 20 条详情（调试）
 *   node tools/fetch-saves-youxia.js --dry        # 只读：算完整但不落盘
 *
 * 产出：
 *   data/_yx-list-raw.json   阶段①缓存（中间产物，.gitignore 已覆盖）
 *   data/saves-youxia.json   { builtAt, stats, items }
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const yx = require('../fetchers/youxiaSave');
const { buildLibIndex } = require('../data/mod-match');

const ROOT = path.join(__dirname, '..');
const D = path.join(ROOT, 'data');
const CACHE = path.join(D, '_yx-list-raw.json');
const OUT = path.join(D, 'saves-youxia.json');
const BAK = path.join(ROOT, '_bak', 'saves-youxia.json.pre-v1046');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const LIST_ONLY = has('--list-only');
const OFFLINE = has('--offline');
const DRY = has('--dry');
const MAX = parseInt(val('--max', '0'), 10) || 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 简单并发池：任务逐个跑，最多 n 个在飞；任一条抛错都不中断整批 */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (true) {
      const k = i++;
      if (k >= items.length) return;
      try { out[k] = await fn(items[k], k); } catch (e) { out[k] = { __err: String((e && e.message) || e) }; }
      await sleep(120); /* 节流：别把对方站打疼，也别触发风控 */
    }
  });
  await Promise.all(workers);
  return out;
}

(async () => {
  /* ───────── 阶段① 列表 ───────── */
  let list;
  if (OFFLINE) {
    if (!fs.existsSync(CACHE)) throw new Error('--offline 需要 ' + path.basename(CACHE) + '，先跑一次联网模式');
    list = JSON.parse(fs.readFileSync(CACHE, 'utf8')).items || [];
    console.log('阶段①：离线，从缓存读入 ' + list.length + ' 条');
  } else {
    const first = await yx.getText(yx.listUrl(1));
    const maxPage = yx.maxPageIn(first);
    console.log('阶段①：列表共 ' + maxPage + ' 页（每页 ' + yx.PER_PAGE + ' 条）');
    list = yx.parseList(first);
    const pages = [];
    for (let p = 2; p <= maxPage; p++) pages.push(p);
    const failedPages = [];
    const got = await pool(pages, 4, async (p) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const html = await yx.getText(yx.listUrl(p));
          const rows = yx.parseList(html);
          if (rows.length) return rows;
          break; /* 页面存在但列表为空 ⇒ 到底了，不算失败 */
        } catch (e) {
          if (attempt === 2) { failedPages.push({ page: p, why: String((e && e.message) || e) }); return []; }
          await sleep(800 * (attempt + 1));
        }
      }
      return [];
    });
    const seen = new Set(list.map((x) => x.id));
    let added = 0;
    for (const rows of got) for (const r of rows) { if (!seen.has(r.id)) { seen.add(r.id); list.push(r); added++; } }
    console.log('  抓得 ' + list.length + ' 条（新增 ' + added + '）｜失败页 ' + failedPages.length);

    /* ★ 落缓存前剔除「重定向到首页」这类伪 200：列表条目为 0 的页已在上游跳过。
       若失败页占比过高，宁可失败退出也不落一份残缺缓存（免得下轮把它当基线）。 */
    if (failedPages.length > maxPage * 0.2) {
      throw new Error('列表失败页过多（' + failedPages.length + '/' + maxPage + '）⇒ 不落缓存，先排查网络/风控');
    }
    if (!DRY) fs.writeFileSync(CACHE, JSON.stringify({ builtAt: Date.now(), maxPage, failedPages, items: list }));
    console.log('  已缓存 → ' + path.basename(CACHE) + '（' + (fs.statSync(CACHE).size / 1048576).toFixed(2) + 'MB）');
  }

  /* 汇总：列表侧统计 */
  const listTotal = list.length;
  const withGame = list.filter((x) => x.game).length;

  if (LIST_ONLY) {
    console.log('\n--list-only：到此为止。列表 ' + listTotal + ' 条，其中标题含《游戏名》' + withGame + ' 条。');
    return;
  }

  /* ───────── 匹配端游库 ───────── */
  const gamesDb = require('../data/gamesDb');
  gamesDb.load();
  const all = gamesDb.all();
  const { byName } = buildLibIndex(all);
  console.log('端游库：' + all.length + ' 款 → 名称索引键 ' + byName.size + ' 个');

  let matched = 0;
  const how = { bracket: 0, prefix: 0, none: 0 };
  const shortPrefix = []; /* 前缀匹配里键长 ≤3 的：最容易误配，单独列出来核对 */
  for (const it of list) {
    const m = yx.matchYxEntry(it, byName);
    how[m.how]++;
    if (!m.lib) continue;
    matched++;
    it.libId = m.lib.id || '';
    it.libTitle = m.lib.title || '';
    it.libCover = m.lib.cover || '';
    it.libUrl = m.lib.url || '';
    it.matchHow = m.how;
    it.matchKey = m.key;
    if (m.how === 'prefix' && m.klen <= 3) shortPrefix.push('「' + it.title + '」 → ' + m.lib.title);
  }
  const libCovered = new Set(list.filter((x) => x.libId).map((x) => x.libId)).size;
  console.log('名称匹配：' + matched + '/' + listTotal
    + '（' + (listTotal ? (matched / listTotal * 100).toFixed(1) : '0') + '%）'
    + '｜ 书名号 ' + how.bracket + ' · 前缀 ' + how.prefix + ' · 未匹配 ' + how.none);
  console.log('覆盖端游库：' + libCovered + ' 款（库里共 ' + all.length + ' 款）');
  if (shortPrefix.length) {
    console.log('★ 短键前缀匹配 ' + shortPrefix.length + ' 条（键长 ≤3，重点核对有无误配），前 8 条：');
    shortPrefix.slice(0, 8).forEach((x) => console.log('   ' + x));
  }

  /* ───────── 阶段② 详情 + 文件（只对匹配上的） ───────── */
  let targets = list.filter((x) => x.libId);
  if (MAX) targets = targets.slice(0, MAX);
  console.log('阶段②：抓 ' + targets.length + ' 条详情（四跳解析文件）');

  let done = 0;
  const results = await pool(targets, 3, async (it) => {
    const html = await yx.getText(it.url);
    const d = yx.parseDetail(html, it.id);
    const files = await yx.resolveFiles(d);
    done++;
    if (done % 20 === 0 || done === targets.length) console.log('  … ' + done + '/' + targets.length);
    return {
      id: it.id,
      title: d.title || it.title,
      game: d.game || it.game,
      gid: d.gid || '',
      cover: it.cover,
      size: it.size,
      sizeFile: files.size || '',
      date: it.date,
      tags: d.tags || [],
      desc: d.desc || '',
      steps: d.steps || [],
      shots: (d.shots || []).slice(0, 4),
      files: files.ok ? {
        direct: files.direct, directRaw: files.directRaw, fileName: files.fileName,
        size: files.size, netdisk: files.netdisk, ed2k: files.ed2k, thunder: files.thunder,
      } : null,
      fileFailWhy: files.ok ? '' : (files.why || ''),
      libId: it.libId, libTitle: it.libTitle, libCover: it.libCover, libUrl: it.libUrl,
      matchHow: it.matchHow || '', matchKey: it.matchKey || '',
      sourceUrl: d.sourceUrl || it.url,
    };
  });

  const items = results.filter((r) => r && !r.__err);
  const crashed = results.filter((r) => r && r.__err).length;

  /* ───────── 铁律 26：全失败就不落盘、不动 ts ───────── */
  if (!items.length) {
    const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
    console.log('\n★★ 详情**全部失败** ⇒ 不落盘、不动 ts，返回旧值'
      + (prev ? '（旧 ' + (prev.items || []).length + ' 条）' : '（且无旧值）'));
    if (prev) prev.stats = Object.assign({}, prev.stats, { allFailed: true });
    process.exitCode = 1;
    return;
  }

  const withFile = items.filter((x) => x.files).length;
  const directN = items.filter((x) => x.files && x.files.direct).length;
  const netdiskN = items.filter((x) => x.files && (x.files.netdisk || []).length).length;
  const ed2kN = items.filter((x) => x.files && x.files.ed2k).length;
  const thunderN = items.filter((x) => x.files && x.files.thunder).length;
  const fileFail = items.filter((x) => !x.files).length;

  const stats = {
    builtAt: Date.now(),
    source: '游侠补丁网 存档区（patch.ali213.net class5）',
    listTotal, withGame, matched, matchedPct: listTotal ? +(matched / listTotal * 100).toFixed(1) : 0,
    matchBracket: how.bracket, matchPrefix: how.prefix, matchNone: how.none, libCovered,
    detailTotal: items.length, crashed,
    withFile, directN, netdiskN, ed2kN, thunderN, fileFail,
    fileFailPct: items.length ? +(fileFail / items.length * 100).toFixed(1) : 0,
    allFailed: false,
  };

  console.log('\n=== 汇总 ===');
  console.log('列表 ' + listTotal + ' ｜ 匹配 ' + matched + ' ｜ 详情 ' + items.length + '（崩 ' + crashed + '）');
  console.log('有文件 ' + withFile + ' ｜ 直链 ' + directN + ' ｜ 网盘 ' + netdiskN
    + ' ｜ eD2K ' + ed2kN + ' ｜ thunder ' + thunderN + ' ｜ 解析失败 ' + fileFail
    + '（' + stats.fileFailPct + '%）');

  if (DRY) { console.log('\n--dry：未落盘。'); return; }

  if (fs.existsSync(OUT)) {
    fs.mkdirSync(path.dirname(BAK), { recursive: true });
    fs.copyFileSync(OUT, BAK);
    console.log('已备份旧文件 → _bak/' + path.basename(BAK));
  }
  fs.writeFileSync(OUT, JSON.stringify({ builtAt: stats.builtAt, stats, items }, null, 0));
  console.log('已写出 → data/saves-youxia.json（' + (fs.statSync(OUT).size / 1048576).toFixed(2) + 'MB）');
})().catch((e) => { console.error('抓取失败：' + (e && e.stack || e)); process.exit(1); });
