#!/usr/bin/env node
/**
 * 抓取 SoC 的 **CPU 核簇描述**（「机型转译」链路最后一跳）
 *
 * ★ 为什么需要这个：
 *   机型 → GPU → SoC 三跳已经通了（device-gpu.js），但第四跳
 *   「SoC → CPU 配置」原来只有 data/device-board.json 这一个来源，
 *   而它**只有 200 条主板记录**（来自 xTheEc0/Android-Device-Hardware-Specs-Database），
 *   对库内 66 个 SoC 只命中 1 个 → 实测「有 SoC 无 CPU」967 台，CPU 覆盖率 **0%**。
 *   用户要的恰恰是「机型对应的cpu等配置」，所以必须补这一层。
 *
 * 数据源：https://nanoreview.net/en/soc/<slug>
 *   SoC 详情页正文里有一句固定的自我介绍：
 *     "It has 2 cores Oryon (Phoenix L) at 4320 MHz and 6 cores Oryon (Phoenix M) at 3530 MHz."
 *   这就是我们要的核心名 + 核数 + 频率，比 soc-db 的 arch/cores 可靠得多
 *   （soc-db 把 SM8750(8 Elite Gen 4) 标成 ARMv8.2-A / 2021，实际是 2024 的 ARMv9 Oryon）。
 *
 * 用法：
 *   node tools/fetch-soc-cpu.js                 # 只抓「库内实际用到」的 SoC（默认，~57 个）
 *   node tools/fetch-soc-cpu.js --all           # 抓 nanoreview 全表 246 个
 *   node tools/fetch-soc-cpu.js --offline       # 用 .cache/soc-cpu/*.html 重跑，不发网络请求
 *
 * 输出：data/soc-cpu.json
 *   { builtAt, src, count, map: { "Snapdragon 8 Elite (Gen 4)": {
 *       cpu: "2 cores Oryon (Phoenix L) at 4320 MHz and 6 cores Oryon (Phoenix M) at 3530 MHz",
 *       cores: 8, clusters: "2+6", clock: 4320, announce: "October 21, 2024", href } } }
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const cheerio = require('cheerio');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const CACHE = path.join(ROOT, '.cache');
const PAGES = path.join(CACHE, 'soc-cpu');
const OUT = path.join(DATA, 'soc-cpu.json');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BASE = 'https://nanoreview.net';

const ARGV = process.argv.slice(2);
const OFFLINE = ARGV.includes('--offline');
const ALL = ARGV.includes('--all');

/** 列表页缓存（由 fetch-soc-map.js 落下），拿 name → href 与 Cores/Clock 列 */
const LIST_CACHE = [1, 2, 3, 4].map((n) => path.join(CACHE, `nanoreview-soclist-${n}.html`));

function normName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[()]/g, ' ')
    .replace(/[^a-z0-9+]+/g, ' ')
    .trim();
}

/** 读列表页缓存 → [{ name, href, cores, clusters, clock, gpu }] */
function readList() {
  const out = [];
  const seen = new Set();
  for (const f of LIST_CACHE) {
    if (!fs.existsSync(f)) continue;
    const $ = cheerio.load(fs.readFileSync(f, 'utf8'));
    $('table tbody tr').each((i, r) => {
      const a = $(r).find('a[href*="/soc/"]').first();
      const href = a.attr('href') || '';
      const name = a.text().replace(/\s+/g, ' ').trim();
      if (!href || !name || seen.has(href)) return;
      seen.add(href);
      const tds = $(r).find('td').map((k, c) => $(c).text().replace(/\s+/g, ' ').trim()).get();
      /* 列序：# | Processor | Rating | AnTuTu | Geekbench | Cores | Clock | GPU */
      const coresRaw = tds[5] || '';
      const m = coresRaw.match(/^(\d+)\s*\(([^)]+)\)/);
      out.push({
        name,
        href,
        cores: m ? Number(m[1]) : (Number(coresRaw) || 0),
        clusters: m ? m[2].trim() : '',
        clock: Number(String(tds[6] || '').replace(/[^\d]/g, '')) || 0,
        gpu: tds[7] || '',
      });
    });
  }
  return out;
}

/** 库内实际用到的 SoC 名（含 device-board 里出现过的，便于将来换源） */
function usedSocs(list) {
  const names = new Set();
  const files = ['device-board.json', 'gpu-soc.json'];
  for (const f of files) {
    const p = path.join(DATA, f);
    if (!fs.existsSync(p)) continue;
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (Array.isArray(j.list)) j.list.forEach((x) => x && x.name && names.add(x.name));
    if (Array.isArray(j.boards)) j.boards.forEach((x) => x && x.soc && names.add(x.soc));
  }
  /* 再从实跑一遍 device-match，把库里真正展示的 SoC 名全收进来 */
  try {
    const dm = require(path.join(DATA, 'device-match'));
    dm.load();
    dm.models({ limit: 100000 }).forEach((d) => d && d.soc && names.add(d.soc));
  } catch (e) {
    console.error('[soc-cpu] 读 device-match 失败（忽略）:', e.message);
  }
  return [...names];
}

/** 同步阻塞（Node 里最省事的做法，跟 fetch-soc-map.js 保持一致） */
const _sab = new Int32Array(new SharedArrayBuffer(4));
function sleep(ms) {
  Atomics.wait(_sab, 0, 0, ms);
}

function cachePathOf(href) {
  return path.join(PAGES, href.replace(/^\/en\/soc\//, '').replace(/[^\w.-]/g, '_') + '.html');
}

function fetchPage(href) {
  const cf = cachePathOf(href);
  if (OFFLINE) {
    return fs.existsSync(cf) ? fs.readFileSync(cf, 'utf8') : null;
  }
  const url = BASE + href;
  let html = '';
  try {
    html = execFileSync('curl', ['-s', '-L', '-m', '35', '-A', UA, url], {
      maxBuffer: 32 * 1024 * 1024,
      encoding: 'utf8',
    });
  } catch (e) {
    console.error('  curl 失败:', href, e.message);
    return null;
  }
  if (!html || html.length < 5000) {
    console.error('  页面过小（可能 404/限流）:', href, html ? html.length : 0);
    return null;
  }
  fs.mkdirSync(PAGES, { recursive: true });
  fs.writeFileSync(cf, html, 'utf8');
  return html;
}

/** 从 SoC 详情页抽 CPU 核簇描述 */
function parsePage(html) {
  const $ = cheerio.load(html);
  const body = $('body').text().replace(/\s+/g, ' ');

  let cpu = '';
  const m1 = body.match(/It has ([^.]*?)\./);
  if (m1 && /core/i.test(m1[1])) cpu = m1[1].trim();

  /* 兜底：`Cores: 8 Clock: 4320 MHz ... It has ...` 没匹配上时，用 Cores/Clock 拼一句 */
  if (!cpu) {
    const mc = body.match(/Cores:\s*(\d+)\s*Clock:\s*(\d+)\s*MHz/i);
    if (mc) cpu = `${mc[1]} cores @ ${mc[2]} MHz`;
  }

  const ann = body.match(/announced on ([A-Z][a-z]+ \d{1,2}, \d{4})/);
  const proc = body.match(/manufactured using a ([^.]*?process technology)/i);

  return {
    cpu,
    announce: ann ? ann[1] : '',
    process: proc ? proc[1].trim() : '',
  };
}

function main() {
  const list = readList();
  if (!list.length) {
    console.error('列表页缓存缺失，请先跑 tools/fetch-soc-map.js');
    process.exit(1);
  }

  const byName = new Map();
  for (const x of list) {
    const k = normName(x.name);
    if (!byName.has(k)) byName.set(k, x);
  }

  let targets;
  if (ALL) {
    targets = list;
  } else {
    const want = usedSocs(list);
    const picked = new Map();       // href → entry
    const unmatched = [];
    for (const w of want) {
      const k = normName(w);
      let hit = byName.get(k);
      if (!hit) hit = list.find((x) => normName(x.name).includes(k) || k.includes(normName(x.name)));
      if (hit) picked.set(hit.href, { ...hit, askedAs: w });
      else unmatched.push(w);
    }
    targets = [...picked.values()];
    if (unmatched.length) {
      console.log(`\n[注意] ${unmatched.length} 个 SoC 在 nanoreview 列表里找不到（多为裸芯片编号，走 soc-db 兜底）：`);
      console.log('  ' + unmatched.join(' | '));
    }
  }

  console.log(`\n准备抓取 ${targets.length} 个 SoC 详情页${OFFLINE ? '（离线模式）' : ''} ...\n`);

  const map = {};
  let ok = 0, fail = 0;
  targets.forEach((t, i) => {
    const html = fetchPage(t.href);
    if (!html) { fail++; return; }
    const p = parsePage(html);
    if (!p.cpu) { fail++; console.error(`  [${i + 1}/${targets.length}] ${t.name} → 未抽到 CPU 描述`); return; }
    map[t.askedAs || t.name] = {
      cpu: p.cpu,
      cores: t.cores,
      clusters: t.clusters,
      clock: t.clock,
      gpu: t.gpu,
      announce: p.announce,
      process: p.process,
      nanoreview: t.name,
      href: t.href,
    };
    ok++;
    if ((i + 1) % 10 === 0 || i === targets.length - 1) {
      console.log(`  [${i + 1}/${targets.length}] 已成功 ${ok} 条 ...`);
    }
    if (!OFFLINE) sleep(1200);      // 礼貌间隔
  });

  const out = {
    builtAt: Date.now(),
    src: 'nanoreview.net/en/soc/<slug>',
    note: 'SoC → CPU 核簇描述（第四跳），device-board.json 未覆盖时兜底',
    count: Object.keys(map).length,
    map,
  };

  /* ★ nanoreview 只按「市场名」索引（Snapdragon 778G），但社区库里的机型名常只写芯片编号
     （`Xiaomi 22101320G` 实际是 SM7325）。借 soc-db 的 id 把编号也挂到同一段描述上：
       id = `snapdragon_778g_sm7325_sm7325_ac` → 市场名命中 → 顺手登记 `sm7325`。 */
  const chipCodes = attachChipCodes(map);
  out.count = Object.keys(map).length;
  out.chipCodes = chipCodes;

  fs.writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf8');

  console.log(`\n✔ 写入 ${path.relative(ROOT, OUT)}：${out.count} 条（成功 ${ok} / 失败 ${fail}）`);
  console.log(`  其中由芯片编号附加的别名 ${chipCodes} 条`);
  console.log(`  体积 ${(fs.statSync(OUT).size / 1024).toFixed(1)} KB`);

  const samples = Object.keys(map).slice(0, 5);
  console.log('\n样例：');
  samples.forEach((k) => console.log(`  ${k}\n    → ${map[k].cpu}`));
  ['sm7325', 'sm8635', 'sdm429w'].forEach((c) => {
    if (map[c]) console.log(`  [编号] ${c}\n    → ${map[c].cpu}`);
  });
}

/** 把 soc-db 里的芯片编号挂到对应市场名的描述上（返回新增条数） */
function attachChipCodes(map) {
  const p = path.join(DATA, 'soc-db.json');
  if (!fs.existsSync(p)) return 0;
  let chips = [];
  try {
    chips = JSON.parse(fs.readFileSync(p, 'utf8')).chips || [];
  } catch (e) {
    console.error('[soc-cpu] soc-db 读取失败，跳过编号附加:', e.message);
    return 0;
  }
  const CODE_RE = /(?:^|[^a-z0-9])((?:sm|mt|msm|sdm)[-_]?\d{3,5}[a-z]{0,3})(?![a-z0-9])/gi;
  const names = Object.keys(map);
  const named = names.map((n) => ({ n, key: normName(n) }));
  let added = 0;
  for (const c of chips) {
    if (!c || !c.id) continue;
    const idKey = normName(String(c.id).replace(/[_-]+/g, ' '));
    const hit = named.find((x) => x.key.length >= 8 && idKey.includes(x.key));
    if (!hit) continue;
    const src = map[hit.n];
    if (!src) continue;
    CODE_RE.lastIndex = 0;
    let m;
    while ((m = CODE_RE.exec(String(c.id) + ' ' + String(c.model || '')))) {
      const code = m[1].toLowerCase().replace(/[_-]/g, '');
      if (map[code]) continue;
      map[code] = Object.assign({}, src, { fromSoc: hit.n });
      added++;
    }
  }
  return added;
}

main();
