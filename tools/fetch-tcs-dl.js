/** tools/fetch-tcs-dl.js — TheCheatScript 修改器外链抓取（v10.81 / P1b）
 *
 * ── 为什么是这个源 & 边界 ─────────────────────────────────────
 * data/trainers.json 里 1,847 条 the_cheat_script 条目只有详情页 URL，没有下载地址。
 * thecheatscript.com（Blogger 站）**不自托管文件**（本轮实测 12 页抽样）：
 *
 *   详情页 → 外链白名单 host（mega.nz 为主 / disk.yandex.com / mediafire 等）
 *
 * ★★ 与 FLiNG 的差别：**没有站内自托管文件 ⇒ 做不了流代理**（MEGA 端到端加密，
 *    Yandex 盘走自家协议）——消费形态是「外链直开」（免提取码、免客户端、网页直下），
 *    比机地「网盘口令」好一档，但不是 CDN 直链。如实标注，不冒充直下。
 *
 * ── 输出 ─────────────────────────────────────────────────────
 * data/tcs-dl.json
 *   { builtAt, stats{pages, withDl, noDl, err, links}, items: { <officialUrl>: { links: [{host, url}] } } }
 * join 由消费方（data/tcsdl.js）做。
 *
 * ── 用法 ─────────────────────────────────────────────────────
 *   node tools/fetch-tcs-dl.js               # 全量（1,847 页，delay 250 ≈ 12 分钟）
 *   node tools/fetch-tcs-dl.js --limit 5     # 试跑
 *   ★ 断点续跑：已有 officialUrl 默认跳过（--fresh 重抓）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { getHtml, UA } = require('../shared');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'tcs-dl.json');
const TRAINERS = path.join(ROOT, 'data', 'trainers.json');

/* ---- 参数 ---- */
const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i >= 0 ? (process.argv[i + 1] || true) : d;
};
const LIMIT = parseInt(arg('limit', '0'), 10) || 0;
const DELAY = parseInt(arg('delay', '250'), 10);
const FRESH = arg('fresh', false) === true;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 外链 host 白名单：只认「点了就能下/打开文件」的盘与文件站（实测分布 mega 为主） */
const HOST_RE = /https?:\/\/((?:www\.)?(mega\.nz|mega\.co\.nz|disk\.yandex\.(?:com|ru)|yadi\.sk|mediafire\.com|drive\.google\.com|dropbox\.com|dropbox\.usercontent\.com|pixeldrain\.com|gofile\.io|onedrive\.live\.com|1fichier\.com|anonfiles\.com))\/[^\s"'<>]+/gi;

const prev = fs.existsSync(OUT) && !FRESH ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
const done = new Set(Object.keys((prev && prev.items) || {}));

const trainers = JSON.parse(fs.readFileSync(TRAINERS, 'utf8'));
const tcs = trainers.items.filter((x) => (x.origin || '') === 'the_cheat_script' && x.officialUrl);
const pages = [...new Set(tcs.map((x) => x.officialUrl))].filter((u) => !done.has(u));
if (LIMIT) pages.length = Math.min(pages.length, LIMIT);

console.log(`[tcs-dl] 目标 ${pages.length} 页（已完成跳过 ${done.size}）delay=${DELAY}ms`);

/* 单页：详情页 → 外链白名单匹配 → 去重截 6 条 */
async function pageLinks(url) {
  const html = await getHtml(url, { timeoutMs: 20000, retries: 1 });
  const seen = new Set();
  const links = [];
  for (const m of html.matchAll(HOST_RE)) {
    const u = m[0].replace(/[),.]+$/, '');
    if (seen.has(u)) continue;
    seen.add(u);
    links.push({ host: m[1].replace(/^www\./, ''), url: u });
    if (links.length >= 6) break;
  }
  return links;
}

(async () => {
  const items = (prev && prev.items) || {};
  let withDl = prev ? prev.stats.withDl : 0, links = prev ? prev.stats.links : 0,
    noDl = prev ? prev.stats.noDl : 0, err = prev ? prev.stats.err : 0;
  const t0 = Date.now();
  for (let i = 0; i < pages.length; i++) {
    const u = pages[i];
    try {
      const ls = await pageLinks(u);
      items[u] = { links: ls };
      if (ls.length) { withDl++; links += ls.length; } else noDl++;
    } catch (e) {
      items[u] = { links: [], err: String(e.message || e).slice(0, 120) };
      err++;
    }
    if ((i + 1) % 50 === 0 || i === pages.length - 1) {
      const out = { builtAt: Date.now(), stats: { pages: Object.keys(items).length, withDl, noDl, err, links }, items };
      fs.writeFileSync(OUT, JSON.stringify(out));
      const el = Math.round((Date.now() - t0) / 1000);
      console.log(`  ${i + 1}/${pages.length}  withDl=${withDl} noDl=${noDl} err=${err} links=${links}  (${el}s)`);
    }
    await sleep(DELAY);
  }
  console.log('[tcs-dl] done →', OUT);
})();
