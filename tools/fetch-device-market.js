/* tools/fetch-device-market.js —— 从 MobileModels 建「内部代号 → 品牌 + 型号」映射表
 *
 * 数据源：https://github.com/khwang9883/MobileModels （MIT）
 *   brands/*.md 是人工维护的机型汇总，格式（实测三种写法都要吃）：
 *
 *     **[`O10U`] POCO F7 (`onyx`):**        ← 有 [平台码] 前缀（小米系）
 *     `25053PC47G`: POCO F7 国际版          ← 型号行，可多码同行
 *     `25053PC47I`: POCO F7 印度版
 *
 *     **Pixel (`sailfish`):**               ← 无 [平台码] 前缀（Google / 魅族系）
 *     `G-2PW4100`: Pixel (North America)
 *
 *     **Xperia E4 (`Jasmine`):**            ← 一行多个码（Sony 系）
 *     `E2104` `E2105`: Xperia E4
 *
 * 产出 data/device-market.json：
 *   byCode  : 归一码 → { brand, market, codename, variant, file }
 *   byMarket: 归一市场名 → { brand, market, codename, codes[] }
 *
 * 用法：
 *   node tools/fetch-device-market.js            # 用 data/_mm-raw/ 缓存（没有则下载）
 *   node tools/fetch-device-market.js --refresh  # 强制重新下载
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RAW = path.join(ROOT, 'data', '_mm-raw');
const OUT = path.join(ROOT, 'data', 'device-market.json');
const API = 'https://api.github.com/repos/khwang9883/MobileModels/contents/brands';
const CDN = 'https://raw.githubusercontent.com/khwang9883/MobileModels/master/brands/';

/* 本机必须走 curl：node 的 fetch / https 对部分站点会被 TLS 指纹拦（见项目约定）。
   raw.githubusercontent 本身 fetch 也行，但统一走 curl 少一处差异。
   ⚠️ 实测 raw.githubusercontent **会偶发 `Recv failure: Connection was reset`**（单轮跑挂过 10/44 个），
   所以必须重试 —— 否则「文件数少了」是静默的，最后只是映射表小一圈，看不出错。 */
const RETRY = 5;
/** 同步 sleep（Atomics.wait），抓取重试的退避用 —— 不用 async 是为了让主流程保持同步好读 */
function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function curl(url, outFile) {
  let last = null;
  for (let i = 0; i < RETRY; i++) {
    try {
      execFileSync('curl', ['-sS', '-m', '60', '-L', '--retry', '2', url, '-o', outFile],
        { stdio: ['ignore', 'ignore', 'pipe'] });
      if (fs.existsSync(outFile) && fs.statSync(outFile).size > 200) return fs.readFileSync(outFile, 'utf8');
      last = new Error('内容过小（' + (fs.existsSync(outFile) ? fs.statSync(outFile).size : 0) + ' 字节）');
    } catch (e) { last = e; }
    sleepSync(1500 * (i + 1));
  }
  throw last || new Error('下载失败');
}

/* ---------- 品牌名（来自文件名） ---------- */
const BRAND_OF = [
  [/^xiaomi-wear/, 'Xiaomi'],
  [/^xiaomi/, 'Xiaomi'],
  [/^samsung/, 'Samsung'],
  [/^honor/, 'Honor'],
  [/^huawei/, 'Huawei'],
  [/^oppo/, 'OPPO'],
  [/^vivo/, 'vivo'],
  [/^oneplus/, 'OnePlus'],
  [/^realme/, 'realme'],
  [/^nubia/, 'nubia'],
  [/^zte/, 'ZTE'],
  [/^lenovo/, 'Lenovo'],
  [/^meizu/, 'Meizu'],
  [/^sony/, 'Sony'],
  [/^google/, 'Google'],
  [/^asus/, 'ASUS'],
  [/^blackshark/, 'Black Shark'],
  [/^nokia/, 'Nokia'],
  [/^nothing/, 'Nothing'],
  [/^motorola/, 'Motorola'],
  [/^coolpad/, 'Coolpad'],
  [/^letv/, 'Letv'],
  [/^smartisan/, 'Smartisan'],
  [/^apple/, 'Apple'],
  [/^mitv/, 'Xiaomi TV'],
  [/^360shouji/, '360'],
  [/^zhixuan/, 'ZTE'],
];
function brandOf(file) {
  const base = file.replace(/\.md$/, '').toLowerCase();
  for (const [re, b] of BRAND_OF) if (re.test(base)) return b;
  return '';
}

/* 非手机类（手表 / 电视）不参与匹配，否则 `M8` 这类短码会被穿戴设备抢走 */
const SKIP_FILES = new Set(['xiaomi-wear.md', 'mitv_cn.md', 'mitv_global_en.md', 'zhixuan.md']);

/* 归一码：大写 + 只留字母数字。SM-S928B / SM S928B / sms928b → SMS928B */
function codeKey(s) {
  return String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
}
/* 归一市场名：小写 + 去空白标点。POCO F7 → pocof7；用于 /api/device/specs 之外的二次查找 */
function marketKey(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
}

/* ---------- 解析单个 md ---------- */
const RE_HEAD = /^\*\*(.+?)\*\*\s*:?\s*$/;
const RE_BRACKET = /^\[\s*`([^`]+)`\s*\]\s*/;
const RE_TAILCODE = /\s*\(\s*`([^`]+)`\s*\)\s*$/;
const RE_CODES = /^((?:`[^`]+`\s*)+)\s*:\s*(.*)$/;
const RE_TICK = /`([^`]+)`/g;

function parseMd(text, file, brand) {
  const rows = [];
  const lines = text.split(/\r?\n/);
  let cur = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    /* 型号行（先判，因为它也以反引号开头，不会和 ** 混淆） */
    if (line[0] === '`') {
      const m = line.match(RE_CODES);
      if (!m || !cur) continue;
      const codes = [...m[1].matchAll(RE_TICK)].map((x) => x[1]);
      const desc = m[2].trim();
      for (const c of codes) rows.push({ code: c, cur, desc, file, brand });
      continue;
    }

    /* 段落头 */
    if (line.startsWith('**')) {
      const m = line.match(RE_HEAD);
      if (!m) continue;
      let body = m[1].trim().replace(/:$/, '').trim();

      let platform = '';
      const mb = body.match(RE_BRACKET);
      if (mb) { platform = mb[1]; body = body.slice(mb[0].length).trim(); }

      let codename = '';
      const mt = body.match(RE_TAILCODE);
      if (mt) { codename = mt[1]; body = body.slice(0, body.length - mt[0].length).trim(); }

      /* body 里还可能残留括号里的年份 / 地区串，市场名保留原样（展示用） */
      const market = body.replace(/\s+/g, ' ').trim();
      if (!market) { cur = null; continue; }
      cur = { market, codename, platform };
      continue;
    }

    /* 其它行（表头元信息 / 引用 / 列表）不影响状态机 */
  }
  return rows;
}

/* 变体词：从型号行描述里剥出「国际版 / 国行 / 印度版」这类后缀 */
const VARIANT_RE = /(国行版?|国际版|全球版|印度版|中国版|大陆版|港版|台版|日版|韩版|欧版|美版|双卡版?|全网通版?|移动版?|联通版?|电信版?|青春版|标准版|高配版|尊享版|探索版|Pro|Max|Plus|Ultra|Lite|(?:North|Rest of)[^,)]*)/gi;
function variantOf(desc, market) {
  const found = String(desc || '').match(VARIANT_RE);
  if (!found || !found.length) return '';
  /* 描述里去掉市场名本身，剩下的才是变体信息 */
  let s = desc;
  if (market && s.toLowerCase().startsWith(market.toLowerCase())) s = s.slice(market.length);
  return s.replace(/^[\s:：-]+/, '').trim() || found[0];
}

/* ---------- 主流程 ---------- */
function main() {
  const refresh = process.argv.includes('--refresh');
  fs.mkdirSync(RAW, { recursive: true });

  /* 1) 文件清单（走 API，也缓存） */
  const listFile = path.join(RAW, '_list.json');
  let files;
  if (refresh || !fs.existsSync(listFile)) {
    const j = JSON.parse(curl(API, listFile));
    files = j.filter((x) => x.name.endsWith('.md')).map((x) => x.name);
  } else {
    files = JSON.parse(fs.readFileSync(listFile, 'utf8')).filter((x) => x.name.endsWith('.md')).map((x) => x.name);
  }
  files = files.filter((f) => !SKIP_FILES.has(f));

  /* 2) 逐个下载（缺失或 --refresh）+ 解析 */
  const byCode = {};
  const byMarket = {};
  let mdCount = 0, rowCount = 0, conflict = 0;
  const perFile = [];
  const failed = [];

  for (const f of files) {
    const dest = path.join(RAW, f);
    let text;
    if (refresh || !fs.existsSync(dest) || fs.statSync(dest).size < 200) {
      try { text = curl(CDN + f, dest); }
      catch (e) { console.error('  ✗ 下载失败', f, e.message); failed.push(f); continue; }
    } else {
      text = fs.readFileSync(dest, 'utf8');
    }
    mdCount++;

    const brand = brandOf(f);
    const rows = parseMd(text, f, brand);
    rowCount += rows.length;

    for (const r of rows) {
      const k = codeKey(r.code);
      if (!k || k.length < 2) continue;              // 太短的码（如 `M8`）风险高但有价值，保留 ≥2
      const rec = {
        brand: r.brand,
        market: r.cur.market,
        codename: r.cur.codename || '',
        variant: variantOf(r.desc, r.cur.market),
        file: f,
      };
      if (byCode[k]) {
        /* 冲突：保留「市场名更长」的那条（更具体），否则先到先得 */
        conflict++;
        if ((byCode[k].market || '').length >= (rec.market || '').length) continue;
      }
      byCode[k] = rec;
    }
    perFile.push({ file: f, brand, rows: rows.length });
  }

  /* 3) 反向索引：市场名 → 码列表 */
  for (const [k, rec] of Object.entries(byCode)) {
    const mk = marketKey(rec.market);
    if (!mk) continue;
    if (!byMarket[mk]) byMarket[mk] = { brand: rec.brand, market: rec.market, codename: rec.codename, codes: [] };
    if (!byMarket[mk].codes.includes(k)) byMarket[mk].codes.push(k);
  }

  const brands = [...new Set(Object.values(byCode).map((r) => r.brand).filter(Boolean))];
  const out = {
    builtAt: Date.now(),
    source: 'khwang9883/MobileModels (MIT)',
    stats: {
      files: mdCount,
      rows: rowCount,
      codes: Object.keys(byCode).length,
      markets: Object.keys(byMarket).length,
      brands: brands.length,
      conflicts: conflict,
    },
    byCode,
    byMarket,
  };
  fs.writeFileSync(OUT, JSON.stringify(out));

  console.log('文件 %d/%d 个 / 型号行 %d 条', mdCount, files.length, rowCount);
  console.log('唯一码 %d 个 / 唯一机型 %d 个 / 品牌 %d 个（冲突 %d 处，取市场名更长的）',
    out.stats.codes, out.stats.markets, out.stats.brands, conflict);
  console.log('写出 %s  (%s KB)', path.relative(ROOT, OUT), (fs.statSync(OUT).size / 1024).toFixed(0));
  if (failed.length) {
    /* ★ 必须显式报错并置非零退出码 —— 「少抓几个文件」是静默的，
       只会让映射表小一圈，不留神根本看不出来（本脚本首轮就是这么挂了 10/44 个） */
    console.error('\n✗ %d 个文件未抓到：%s', failed.length, failed.join(', '));
    console.error('  重跑本脚本（带重试）补齐后再用；否则映射表不完整。');
  }
  console.log('\n按文件：');
  perFile.sort((a, b) => b.rows - a.rows).slice(0, 14)
    .forEach((x) => console.log('   %s  %s', String(x.rows).padStart(5), x.file));

  if (failed.length) process.exitCode = 2;
}

if (require.main === module) main();
module.exports = { parseMd, codeKey, marketKey, brandOf, variantOf, BRAND_OF, SKIP_FILES };
