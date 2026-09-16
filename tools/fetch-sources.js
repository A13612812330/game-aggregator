#!/usr/bin/env node
/**
 * fetch-sources.js — 抓取三个外部数据源，落盘为本地 JSON
 *
 * 数据源：
 *   1. vitkuz573/soc-db                          → data/soc-db.json      芯片规格（23 厂商）
 *   2. xTheEc0/Android-Device-Hardware-Specs-DB  → data/device-board.json 主板代号 → SoC/CPU
 *   3. The412Banner/Banners-Turnip               → data/turnip.json      Turnip 驱动构建信息
 *
 * 为什么走 api.github.com / raw 而非 git clone：
 *   本机 github.com 主站被拦，只有 api.github.com 与 raw.githubusercontent.com 通。
 *
 * 用法：node tools/fetch-sources.js [--only=soc|board|turnip]
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT = path.join(__dirname, '..', 'data');
const UA = { 'User-Agent': 'gamehub-sources/1.0', Accept: 'application/vnd.github+json' };

function get(url, { raw = false, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: raw ? { 'User-Agent': UA['User-Agent'] } : UA }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return get(res.headers.location, { raw, timeout }).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} ${url}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(new Error(`timeout ${url}`)); });
  });
}

async function getJson(url, opt) {
  return JSON.parse((await get(url, opt)).toString('utf-8'));
}

/** 用 GitHub contents API 拉单文件（大文件带 base64） */
async function getContents(repo, file, ref) {
  const d = await getJson(`https://api.github.com/repos/${repo}/contents/${file}${ref ? '?ref=' + ref : ''}`);
  if (Array.isArray(d)) throw new Error('not a file: ' + file);
  return Buffer.from(d.content, 'base64').toString('utf-8');
}

const log = (...a) => console.log('·', ...a);

/* ─────────────── 1. soc-db ─────────────── */
async function fetchSocDb() {
  log('soc-db: 列目录…');
  const files = await getJson('https://api.github.com/repos/vitkuz573/soc-db/contents/data');
  const vendors = files
    .filter((f) => f.name.endsWith('.json'))
    .map((f) => ({ file: f.name, vendor: f.name.replace(/\.json$/, ''), size: f.size }));

  const chips = [];
  for (const v of vendors) {
    try {
      log(`soc-db: ${v.file} (${(v.size / 1024).toFixed(0)}KB)…`);
      const txt = await getContents('vitkuz573/soc-db', 'data/' + v.file);
      const arr = JSON.parse(txt);
      if (!Array.isArray(arr)) continue;
      for (const c of arr) {
        chips.push({
          id: c.id || '',
          name: c.name || '',
          vendor: c.vendor || v.vendor,
          model: c.model || '',
          gpu: c.gpu || '',
          arch: c.architecture || '',
          cores: c.cores || 0,
          process_nm: c.process_nm || null,
          clock_max: c.clock_max || null,
          year: c.year || null,
          mem_type: c.memory_type || '',
          dsp: c.dsp || '',
          modem: c.modem || '',
          wifi: c.wifi || '',
          bt: c.bluetooth || '',
          src_vendor: v.vendor,
        });
      }
    } catch (e) {
      console.error(`  ! ${v.file} 失败: ${e.message}`);
    }
  }

  const out = {
    builtAt: Date.now(),
    repo: 'vitkuz573/soc-db',
    api: 'https://api.github.com/repos/vitkuz573/soc-db/contents/data',
    vendorFiles: vendors.map((v) => v.file),
    count: chips.length,
    vendors: [...new Set(chips.map((c) => c.vendor))].sort(),
    chips,
  };
  fs.writeFileSync(path.join(OUT, 'soc-db.json'), JSON.stringify(out));
  log(`soc-db: 落盘 ${chips.length} 款芯片 / ${out.vendors.length} 厂商`);
  return out;
}

/* ─────────────── 2. 主板代号 → SoC ─────────────── */
async function fetchBoardDb() {
  log('device-board: 拉 database.json…');
  const txt = await getContents('xTheEc0/Android-Device-Hardware-Specs-Database', 'database.json', 'master');
  const raw = JSON.parse(txt);

  const boards = Object.keys(raw)
    .map((code) => ({
      board: code,
      soc: (raw[code] && raw[code].SoC) || '',
      cpu: (raw[code] && raw[code].CPU) || '',
    }))
    .filter((b) => b.soc || b.cpu);

  const out = {
    builtAt: Date.now(),
    repo: 'xTheEc0/Android-Device-Hardware-Specs-Database',
    api: 'https://api.github.com/repos/xTheEc0/Android-Device-Hardware-Specs-Database/contents/database.json?ref=master',
    count: boards.length,
    boards,
  };
  fs.writeFileSync(path.join(OUT, 'device-board.json'), JSON.stringify(out));
  log(`device-board: 落盘 ${boards.length} 个主板代号`);
  return out;
}

/* ─────────────── 3. Banners-Turnip ─────────────── */
async function fetchTurnip() {
  log('turnip: 拉 releases…');
  const rels = await getJson('https://api.github.com/repos/The412Banner/Banners-Turnip/releases?per_page=15');
  const releases = (Array.isArray(rels) ? rels : []).map((r) => ({
    tag: r.tag_name,
    name: r.name,
    at: r.published_at,
    url: r.html_url,
    assets: (r.assets || []).map((a) => ({
      name: a.name,
      size: a.size,
      dl: a.download_count,
      url: a.browser_download_url,
    })),
  }));

  // README 里有最新构建看板（Mesa 版本 / Vulkan 版本 / commit）
  let latest = null;
  try {
    log('turnip: 解析 README 构建看板…');
    const rm = await getJson('https://api.github.com/repos/The412Banner/Banners-Turnip/readme');
    const readme = Buffer.from(rm.content, 'base64').toString('utf-8');
    const block = readme.match(/<!-- LATEST_BUILD_START -->([\s\S]*?)<!-- LATEST_BUILD_END -->/);
    if (block) {
      const cell = (label) => {
        const m = block[1].match(new RegExp('\\*\\*' + label + '\\*\\*\\s*\\|\\s*([^|\\n]+)'));
        return m ? m[1].trim().replace(/\[`|`\]|\[|\]|\(.*?\)/g, '').trim() : '';
      };
      latest = {
        mesa: cell('Mesa version'),
        vulkan: cell('Vulkan version'),
        commit: cell('Commit'),
        commitDate: cell('Commit date'),
        commitTitle: cell('Commit title'),
        buildDate: cell('Build date'),
        release: cell('Release'),
      };
    }
  } catch (e) {
    console.error('  ! README 解析失败: ' + e.message);
  }

  const out = {
    builtAt: Date.now(),
    repo: 'The412Banner/Banners-Turnip',
    api: 'https://api.github.com/repos/The412Banner/Banners-Turnip/releases',
    site: 'https://github.com/The412Banner/Banners-Turnip/releases/latest',
    latest,
    variants: [
      { key: 'std', name: '标准版 (A6xx/A7xx)', gpus: 'Adreno 600–700 系列（骁龙 600–800，含 7 Gen / 8 Gen 1–3）', match: '-A8xx|-710-720-Test', note: '纯 Mesa main，无补丁' },
      { key: 'a710', name: 'A710/A720/A722 实验版', gpus: 'Adreno 710 / 720 / 722', match: '-710-720-Test', note: '注入硬件条目；建议 TU_DEBUG=sysmem；Winlator 需 WRAPPER_BLIT=1' },
      { key: 'a8xx', name: 'A8xx 实验版', gpus: 'Adreno 810 / 825 / 829 / 830（骁龙 8 Elite）', match: '-A8xx', note: '含 tu8_kgsl_26 等补丁，谨慎使用' },
    ],
    releases,
  };
  fs.writeFileSync(path.join(OUT, 'turnip.json'), JSON.stringify(out));
  log(`turnip: 落盘 ${releases.length} 个 release；最新 ${latest ? latest.mesa + ' / ' + latest.vulkan : '未解析'}`);
  return out;
}

/* ─────────────── main ─────────────── */
(async () => {
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.split('=')[1].split(',') : null;
  const want = (k) => !only || only.includes(k);

  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  const jobs = [];
  if (want('soc')) jobs.push(['soc-db', fetchSocDb]);
  if (want('board')) jobs.push(['device-board', fetchBoardDb]);
  if (want('turnip')) jobs.push(['turnip', fetchTurnip]);

  let fail = 0;
  for (const [name, fn] of jobs) {
    try {
      await fn();
    } catch (e) {
      fail++;
      console.error(`✗ ${name} 失败: ${e.message}`);
    }
  }
  console.log(fail ? `\n完成，${fail} 项失败` : '\n全部完成');
  process.exit(fail ? 1 : 0);
})();
