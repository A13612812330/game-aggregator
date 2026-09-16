#!/usr/bin/env node
/**
 * fetch-soc-map.js — 生成「GPU → SoC」映射表（data/gpu-soc.json）
 *
 * 用途：机型库只给到 GPU 名，用户要看的是 CPU。这一步补上中间那跳。
 *
 * 数据源：https://nanoreview.net/en/soc-list/rating （page 1..2，246 条 SoC，212 条带 GPU）
 *   —— 页面是 SSR 表格，每个 <tr> 里 [SoC 名 + 厂商 + GPU] 齐全，cheerio 直接可解析。
 *
 * ★ 为什么必须走 curl 而不是 fetch/https：
 *   本机实测 node 的 fetch 与原生 https **一律 403**（5.7KB 拦截页），
 *   而 curl 同一 URL 稳定 200（317KB）。换了 4 组 header 组合都一样 →
 *   差异在 **TLS 指纹（JA3）**，不是 header。所以这里 execFileSync 调 curl。
 *
 * ★ MP ≡ MC：页面写 `Mali-G925 MP12`，社区库写 `Mali-G720 MC7`，都指核心数。
 *   归一化（见 data/gpu-soc.js 的 normGpuKey）之前，Mali 系一条都对不上。
 *
 * 用法：
 *   node tools/fetch-soc-map.js             # 联网抓取
 *   node tools/fetch-soc-map.js --offline   # 用 .cache 里已抓的 html 重跑解析
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const cheerio = require('cheerio');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'gpu-soc.json');
const CACHE_DIR = path.join(ROOT, '.cache');
const BASE = 'https://nanoreview.net/en/soc-list/rating';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const MAX_PAGES = 4;

const OFFLINE = process.argv.includes('--offline');

const { normGpuKey, modelOf } = require('../data/gpu-soc');

function cacheFile(p) { return path.join(CACHE_DIR, `nanoreview-soclist-${p}.html`); }

function fetchPage(p) {
  const url = p === 1 ? BASE : `${BASE}?page=${p}`;
  const html = execFileSync('curl', ['-s', '-L', '-m', '30', '-A', UA, url], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  return html;
}

/** 解析一页 → [{name, vendor, gpu}] */
function parsePage(html) {
  const $ = cheerio.load(html);
  const rows = [];
  $('tr').each((i, el) => {
    const a = $(el).find('a[href^="/en/soc/"]').first();
    if (!a.length) return;
    const name = a.text().trim();
    if (!name) return;
    const vendor = $(el).find('span.text-gray-small').first().text().trim();
    let gpu = '';
    $(el).find('td').each((j, td) => {
      const t = $(td).text().trim();
      /* GPU 单元格是纯 GPU 名，不会混入其它文本 */
      if (/^(Adreno|Mali|Immortalis|Xclipse|PowerVR|Apple GPU|SGX)/i.test(t)) gpu = t;
    });
    rows.push({ name, vendor, gpu, url: a.attr('href') });
  });
  return rows;
}

(function main() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

  const all = [];
  const seen = new Set();   // 按 SoC 名去重（实测 ?page=3 起会回退成第 1 页内容）
  let pages = 0;

  for (let p = 1; p <= MAX_PAGES; p++) {
    const cf = cacheFile(p);
    let html = null;
    if (OFFLINE) {
      if (!fs.existsSync(cf)) break;
      html = fs.readFileSync(cf, 'utf8');
    } else {
      try {
        html = fetchPage(p);
      } catch (e) {
        console.log(`  第 ${p} 页抓取失败：${e.message}`);
        break;
      }
      if (!html || html.length < 5000) { console.log(`  第 ${p} 页疑似被拦（${html ? html.length : 0}B），停止`); break; }
      fs.writeFileSync(cf, html, 'utf8');
      /* 页间轻微间隔，礼貌抓取（同步 sleep：Atomics.wait 不占 CPU） */
      if (p < MAX_PAGES) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 900);
    }

    const rows = parsePage(html);
    if (!rows.length) { console.log(`  第 ${p} 页无数据，停止`); break; }
    const fresh = rows.filter((r) => !seen.has(r.name));
    for (const r of fresh) seen.add(r.name);
    pages++;
    console.log(`  第 ${p} 页 → ${rows.length} 条（新增 ${fresh.length}）`);
    if (!fresh.length) { console.log('  该页无新增（站点翻页已到底/未生效），停止'); break; }
    all.push(...fresh);
  }

  if (!all.length) {
    console.error('未取到任何 SoC 数据，未写出文件。');
    process.exit(1);
  }

  /* 按 GPU 建索引：精确（含核心数）+ 型号（丢核心数，退化用） */
  const byGpu = {};
  const byModel = {};
  let withGpu = 0;
  for (const r of all) {
    if (!r.gpu) continue;
    withGpu++;
    const k = normGpuKey(r.gpu);
    (byGpu[k] = byGpu[k] || []).push(r);
    const m = modelOf(r.gpu);
    (byModel[m] = byModel[m] || []).push(r);
  }

  const out = {
    builtAt: Date.now(),
    source: BASE,
    pages,
    count: all.length,
    withGpu,
    byGpu,
    byModel,
    list: all,
  };
  fs.writeFileSync(OUT, JSON.stringify(out), 'utf8');

  console.log(`\n✅ ${path.relative(ROOT, OUT)}  ${(fs.statSync(OUT).size / 1024).toFixed(1)}KB`);
  console.log(`   SoC ${all.length} 条（带 GPU ${withGpu}）｜唯一 GPU 键 ${Object.keys(byGpu).length}｜唯一型号 ${Object.keys(byModel).length}`);

  /* 覆盖率自检：拿 bannerhub 的真实 GPU 频次算一遍，避免「表建好了但没用」 */
  try {
    const bf = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'bannerhub-files.json'), 'utf8'));
    const cnt = new Map();
    for (const g of Object.keys(bf)) for (const x of bf[g] || []) {
      const p = String(x[1] || '').trim(); if (p) cnt.set(p, (cnt.get(p) || 0) + 1);
    }
    const tot = [...cnt.values()].reduce((a, b) => a + b, 0);
    let e = 0, m = 0;
    for (const [gpu, n] of cnt) {
      if (byGpu[normGpuKey(gpu)]) e += n;
      else if (byModel[modelOf(gpu)]) m += n;
    }
    console.log(`   覆盖率自检（按配置记录数）：精确 ${(e / tot * 100).toFixed(1)}% ｜ 含型号退化 ${((e + m) / tot * 100).toFixed(1)}%`);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('   覆盖率自检失败:', err.message);
  }
})();
