/** tools/fetch-fling-dl.js — FLiNG 修改器直链抓取（v10.81 / P1）
 *
 * ── 为什么是这个源 ────────────────────────────────────────────
 * data/trainers.json 里 1,163 条 fling_main / fling_archive 条目只有详情页 URL，
 * 没有下载地址。FLiNG 官网（flingtrainer.com）**自托管文件**（本轮实测链路）：
 *
 *   详情页 /trainer/<slug>/  →  href /downloads/<token>
 *     GET /downloads/<token>  →  302  Location: /download-trainer.php?path=%2Fwp-content%2Fuploads%2F<Y>%2F<M>%2F<Name>.zip
 *     ⇒ 解出 path 参数（URL decode）⇒ **zip 直链** = https://flingtrainer.com + path
 *
 * 实测（2026-10-15）：
 *   · 直链带 Referer 200 application/zip；无 Referer 403 ⇒ **浏览器从本站直接点会被拦**
 *     ⇒ 线上消费必须走服务端流代理 /api/dl/fling（见 server.js）。
 *   · 302 响应的 Set-Cookie 不需要保存 —— 解 Location 就够，不用带 cookie 二跳。
 *
 * ── 输出 ─────────────────────────────────────────────────────
 * data/fling-dl.json
 *   { builtAt, stats{pages, withDl, noDl, err, links}, items: { <officialUrl>: { links: [{zip, file, token}] } } }
 * 只记 officialUrl → links 的映射；与 trainers.json 的 join 由消费方（data/flingdl.js）做。
 *
 * ── 用法 ─────────────────────────────────────────────────────
 *   node tools/fetch-fling-dl.js                 # 全量（约 1,163 页，20 分钟级）
 *   node tools/fetch-fling-dl.js --limit 5       # 试跑
 *   node tools/fetch-fling-dl.js --delay 600     # 放慢
 *   ★ 断点续跑：输出文件里已有的 officialUrl 默认跳过（--fresh 重抓）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { getHtml, UA } = require('../shared');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'fling-dl.json');
const TRAINERS = path.join(ROOT, 'data', 'trainers.json');

/* ---- 参数 ---- */
const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i >= 0 ? (process.argv[i + 1] || true) : d;
};
const LIMIT = parseInt(arg('limit', '0'), 10) || 0;      /* 0 = 全量 */
const DELAY = parseInt(arg('delay', '350'), 10);
const FRESH = arg('fresh', false) === true;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 上一轮的产物：断点续跑用 */
const prev = fs.existsSync(OUT) && !FRESH ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
const done = new Set(Object.keys((prev && prev.items) || {}));

/* 输入：trainers.json 的 fling 条目（officialUrl 去重） */
const trainers = JSON.parse(fs.readFileSync(TRAINERS, 'utf8'));
const fling = trainers.items.filter((x) => /^fling_(main|archive)$/.test(x.origin || '') && x.officialUrl);
const pages = [...new Set(fling.map((x) => x.officialUrl))].filter((u) => !done.has(u));
if (LIMIT) pages.length = Math.min(pages.length, LIMIT);

console.log(`[fling-dl] 目标 ${pages.length} 页（已完成跳过 ${done.size}）delay=${DELAY}ms`);

/* 单页：详情页 → tokens → zip 直链。
 * ★ fling_archive 来源的 officialUrl **本身就是直链**（实测：archive.flingtrainer.com/files/<name>.rar）
 *   —— 这类不用抓详情，直接登记。 */
async function pageLinks(url) {
  if (/^https?:\/\/(archive\.)?flingtrainer\.com\/files\/.+\.(zip|rar|exe)$/i.test(url)) {
    const file = decodeURIComponent(url.split('/').pop() || '');
    return [{ zip: url, file, token: '' }];
  }
  const html = await getHtml(url, { timeoutMs: 20000, retries: 1 });
  const tokens = [...new Set((html.match(/\/downloads\/[A-Za-z0-9,]+/g) || []))];
  const links = [];
  for (const tk of tokens) {
    try {
      const r = await fetch('https://flingtrainer.com' + tk, {
        headers: { 'User-Agent': UA, Referer: url },
        redirect: 'manual',
        signal: AbortSignal.timeout(20000),
      });
      const loc = r.headers.get('location') || '';
      /* 302 → /download-trainer.php?path=%2Fwp-content%2Fuploads%2F...zip */
      const m = loc.match(/[?&]path=([^&]+)/);
      const zip = m ? decodeURIComponent(m[1]) : (/^\/wp-content\/uploads\/.*\.(zip|rar|exe)$/i.test(loc) ? loc : '');
      /* ★ 源站存在「死 token」：302 的 path 只有 %2Fwp-content%2Fuploads%2F（实测 8tdKLq9ZWT9），
         不滤掉会产生 file 为空的垃圾行 ⇒ 只留真实文件名（zip/rar/exe）。 */
      const file = decodeURIComponent((zip.split('/').pop() || ''));
      if (zip && /^\/wp-content\/uploads\//.test(zip) && /\.(zip|rar|exe)$/i.test(file)) {
        links.push({ zip, file, token: tk.slice('/downloads/'.length) });
      }
    } catch (e) { /* 单 token 失败不拖垮整页 */ }
    await sleep(120);
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
    if ((i + 1) % 25 === 0 || i === pages.length - 1) {
      const out = { builtAt: Date.now(), stats: { pages: Object.keys(items).length, withDl, noDl, err, links }, items };
      fs.writeFileSync(OUT, JSON.stringify(out));
      const el = Math.round((Date.now() - t0) / 1000);
      console.log(`  ${i + 1}/${pages.length}  withDl=${withDl} noDl=${noDl} err=${err} links=${links}  (${el}s)`);
    }
    await sleep(DELAY);
  }
  console.log('[fling-dl] done →', OUT);
})();
