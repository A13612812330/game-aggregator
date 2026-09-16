/**
 * tools/fetch-mods.js — 采集机地「MOD / 修改器」社区帖 → data/mods.json
 *
 * 数据源与签名机制见 fetchers/jidiModify.js 头部说明（要点：body 必须是整份 env 展开）。
 *
 * 产出 data/mods.json：
 *   { builtAt, stats, items: [...] }
 *   items[] 已在抓取层归一化（见 jidiModify.shape）：
 *     id / kind(mod|modifier) / title / game / cover / author / ct / ut / pv / content / links / url
 *   并追加端游库匹配结果：libId / libTitle / libCover / libUrl（用于详情跳转与横切筛选）
 *
 * 用法：
 *   node tools/fetch-mods.js                  # 全量（MOD + 修改器）
 *   node tools/fetch-mods.js --max 300        # 每类只取 300（调试用）
 *   node tools/fetch-mods.js --only mod       # 只取 MOD
 *   node tools/fetch-mods.js --offline        # 用 data/_mod-raw.json 缓存重跑匹配（改匹配逻辑时用）
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const D = path.join(__dirname, '..', 'data');
const CACHE = path.join(D, '_mod-raw.json');
const OUT = path.join(D, 'mods.json');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const OFFLINE = has('--offline');
const ONLY = val('--only', '');
const MAX = parseInt(val('--max', '0'), 10) || 0;

/* 匹配逻辑抽在 data/mod-match.js（**单一真源**，可离线单测）：
 * 按 `/` 分段 + CJK 友好长度护栏。这里不重复实现，避免两边漂移。 */
const { normKey, buildLibIndex, matchLib } = require('../data/mod-match');

void normKey;

(async () => {
  const jm = require('../fetchers/jidiModify');

  let rawMod, rawModifier;
  if (OFFLINE) {
    if (!fs.existsSync(CACHE)) throw new Error('--offline 需要 ' + path.basename(CACHE) + '，先跑一次联网模式');
    const c = JSON.parse(zlib.gunzipSync(fs.readFileSync(CACHE)).toString('utf8'));
    rawMod = c.mod || [];
    rawModifier = c.modifier || [];
    console.log(`来源：本地缓存 ${path.basename(CACHE)}（MOD ${rawMod.length} / 修改器 ${rawModifier.length}）`);
  } else {
    const types = ONLY ? [ONLY] : ['mod', 'modifier'];
    rawMod = []; rawModifier = [];
    for (const t of types) {
      if (!jm.TYPES[t]) throw new Error('未知 --only 值: ' + t);
      const t0 = Date.now();
      const r = await jm.poll(t, { max: MAX, onPage: ({ page, got, count }) => {
        if (page % 10 === 0 || page === 1) process.stdout.write(`\r  ${jm.TYPE_LABEL[t]} 第 ${page} 页 · 已取 ${got}/${count || '?'}   `);
      } });
      process.stdout.write('\r');
      console.log(`${jm.TYPE_LABEL[t]}：源站 ${r.count} 条 → 实取 ${r.fetched} 条（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
      if (t === 'mod') rawMod = r.items; else rawModifier = r.items;
    }
    /* ★ 缓存必须压缩：源站原始条目含 member/post_limiting/god_reviews 等一堆用不上的字段，
       未压缩实测 **87.8MB**，gzip 后约 15MB（差 6 倍）。--offline 重跑匹配时解压即可。 */
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify({ mod: rawMod, modifier: rawModifier }), 'utf8'));
    fs.writeFileSync(CACHE, gz);
    console.log('  已缓存 → ' + path.basename(CACHE) + '（' + (fs.statSync(CACHE).size / 1048576).toFixed(1) + 'MB，gzip）');
  }

  /* 端游库就位 */
  const gamesDb = require('../data/gamesDb');
  gamesDb.load();
  const all = gamesDb.all();
  const { byName } = buildLibIndex(all);
  console.log(`端游库：${all.length} 款 → 名称索引键 ${byName.size} 个（按 / 分段）`);

  const items = [];
  const seen = new Set();
  let matched = 0, withLinks = 0, linkTotal = 0;
  const byKind = {};
  const byKindMatched = {};

  for (const [arr, kind] of [[rawMod, 'mod'], [rawModifier, 'modifier']]) {
    for (const raw of arr) {
      const s = jm.shape(raw);
      if (!s.id || !s.title) continue;
      if (seen.has(s.id)) continue;
      seen.add(s.id);

      byKind[kind] = (byKind[kind] || 0) + 1;
      const lib = matchLib(s.game, byName);
      if (lib) { matched++; byKindMatched[kind] = (byKindMatched[kind] || 0) + 1; }
      if (s.links.length) { withLinks++; linkTotal += s.links.length; }

      items.push({
        id: s.id, kind, title: s.title, game: s.game,
        cover: (lib && lib.cover) ? lib.cover : s.cover,   // 有端游库封面优先（更清晰统一）
        author: s.author, ct: s.ct, ut: s.ut, pv: s.pv, favors: s.favors,
        content: s.content, links: s.links,
        libId: lib ? lib.id : '', libTitle: lib ? lib.title : '', libUrl: lib ? lib.url : '',
        url: s.url,
      });
    }
  }

  const stats = {
    builtAt: Date.now(),
    total: items.length,
    byKind,
    matched,
    matchedRate: items.length ? +(matched / items.length * 100).toFixed(1) : 0,
    byKindMatched,
    withLinks,
    linkRate: items.length ? +(withLinks / items.length * 100).toFixed(1) : 0,
    linkTotal,
  };

  fs.writeFileSync(OUT, JSON.stringify({ builtAt: stats.builtAt, stats, items }), 'utf8');

  console.log('\n=== 采集结果 ===');
  console.log(`条目 ${stats.total} ｜ 命中端游库 ${matched}（${stats.matchedRate}%）`);
  console.log(`   MOD ${byKind.mod || 0}（命中 ${byKindMatched.mod || 0}）｜ 修改器 ${byKind.modifier || 0}（命中 ${byKindMatched.modifier || 0}）`);
  console.log(`含下载链接 ${withLinks} 条（${stats.linkRate}%）· 链接合计 ${linkTotal} 条`);
  console.log(`\n✅ 已写出 data/${path.basename(OUT)}（${(fs.statSync(OUT).size / 1048576).toFixed(1)}MB）`);
})();
