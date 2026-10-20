#!/usr/bin/env node
/**
 * ★ v10.86：FitGirl Repack 落库生成器 —— data/fitgirl.json
 *
 * 输入（全部只读）:
 *   tools/_probe-fg-cat/p*.json      WP REST API 全量目录快照（8,114 帖，轻量字段）
 *   data/games.json                  本体库 19,695 条
 * 输出:
 *   data/fitgirl.json                gameId → repack 帖数组（多源结构的第一个 source）
 *
 * ★ 为什么重跑匹配而不读 _probe-fg-match-result.json：探针产物只存样例
 *   （hitSample 15 / missSample 40），不是全量映射 —— 快照类产物不能当落库源（铁律 155）。
 *
 * ★ 匹配逻辑 = tools/_probe-fg-match.js 最终版原样移植（含五道护栏）：
 *   ① `/` 拼接串分段取英文段 ② 剥版本/年份/DLC 尾巴（纯数字绝不并词）
 *   ③ 续作护栏（余段纯数字/罗马数字只准精确，毙 subnautica-2→subnautica）
 *   ④ 点号缩写别名（Worms W.M.D → worms-wmd）⑤ 罗马数字归一（Solar Empire II → -2）
 *   差异：exact **跨段全收集**（中英别名可能指到不同 repack 帖，全留）；prefix 沿用探针
 *   语义只取首个（prefix 无打分，多收会放进 war 类短前缀的假亲 —— 宁缺毋滥）。
 *
 * ★ adult 打标（第九节方案的单库版）：标题关键词（18+/adult/xxx/porn/nude/hentai/erotic）
 *   + VETO 名单（无关键词已知成人作，如 Tropical Lust）。描述词双信号留给按需单篇抓取时
 *   补充 —— 目录快照为控体量没拉 content 字段。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const CAT_DIR = path.join(__dirname, '_probe-fg-cat');
const OUT = path.join(__dirname, '..', 'data', 'fitgirl.json');
const SITE = 'https://fitgirl-repacks.site/';

/* ---- 1) 目录加载 ---- */
const files = fs.readdirSync(CAT_DIR).filter((f) => /^p\d+\.json$/.test(f))
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
const posts = new Map(); // slug -> { title(已解码), date, categories }
let raw = 0, parseFail = 0;
function decodeWp(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '').trim();
}
for (const f of files) {
  let arr;
  try { arr = JSON.parse(fs.readFileSync(path.join(CAT_DIR, f), 'utf8')); }
  catch (e) { parseFail++; continue; }
  for (const p of arr) {
    raw++;
    if (!posts.has(p.slug)) posts.set(p.slug, { title: decodeWp(p.title.rendered), date: p.date, categories: p.categories });
  }
}
if (parseFail) { console.error('✗ 目录快照解析失败 ' + parseFail + ' 页 —— 快照不完整，先补抓再生成'); process.exit(1); }
console.log('目录: ' + files.length + ' 页 | 原始 ' + raw + ' | 去重 slug ' + posts.size);

/* ---- 2) adult 判定 ---- */
const ADULT_RE = /(\b18\+\b|\badult\b|\bxxx\b|\bporn\b|\bnude\b|\bhentai\b|\berotic\b|\bsex\b|\bn sfw\b|nsfw)/i;
/* 无标题关键词、但人工核验为成人作的 VETO 名单（2026-10-19 抽查实测 Tropical Lust 无关键词） */
const ADULT_VETO = new Set(['tropical-lust']);
const isAdultSlug = (slug, title) => ADULT_VETO.has(slug) || ADULT_RE.test(title);

/* ---- 3) 匹配（探针最终版移植） ---- */
const games = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'games.json'), 'utf8'));
function enSegs(title) {
  return String(title).split(/[/|｜·—]/).map((s) => s.trim())
    .filter((s) => /^[A-Za-z0-9]/.test(s) && /[A-Za-z]{3}/.test(s) && /^[\x20-\x7e]+$/.test(s));
}
function stripTail(s) {
  return s
    .replace(/\(\s*\d{4}\s*\)/g, '')
    .replace(/\+\s*\d+\s*(DLCs?|Bonuses?|Extras?)/gi, '')
    .replace(/\b[Bb]uild\s*\d+\b/g, '')
    .replace(/\bv?\d+(\.\d+)+\b/g, '')
    .replace(/\s+/g, ' ').trim();
}
function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };
const catSlugs = new Set(posts.keys());
const PREFIX_REST_RE = /^(update|patch|hotfix)/;
const NUM_REST_RE = /^(\d+|[ivxlcdm]+)(-\d+)*$/;

/** 单段匹配：返回该段命中的全部 slug（exact 全收集 + 首个 prefix） */
function matchSeg(seg) {
  const hits = [];
  const sl = slugify(stripTail(seg));
  if (!sl || sl.length < 3) return hits;
  if (catSlugs.has(sl)) hits.push(sl);
  /* 点号别名 + 罗马数字别名也按 exact 收 */
  const slDotted = slugify(stripTail(seg.replace(/\./g, '')));
  if (slDotted && slDotted !== sl && catSlugs.has(slDotted)) hits.push(slDotted);
  const slRoman = sl.replace(/(^|-)([ivxlcdm]+)(-|$)/g, (m, a, r, b) => (ROMAN[r] ? a + ROMAN[r] + b : m));
  if (slRoman !== sl && catSlugs.has(slRoman)) hits.push(slRoman);
  if (hits.length) return hits;
  /* prefix：沿用探针语义，只取首个（无打分不滥收） */
  for (const cs of catSlugs) {
    if (cs.startsWith(sl + '-')) {
      const rest = cs.slice(sl.length + 1);
      if (PREFIX_REST_RE.test(rest) || NUM_REST_RE.test(rest)) continue;
      return [cs];
    }
    if (sl.startsWith(cs + '-')) {
      const gRest = sl.slice(cs.length + 1);
      if (NUM_REST_RE.test(gRest)) continue;
      return [cs];
    }
  }
  return hits;
}

const byGame = {};
let checked = 0, matched = 0, adultGames = 0, entryTotal = 0;
for (const g of games) {
  if (!g.title || !g.id) continue;
  const segs = enSegs(g.title);
  if (!segs.length) continue;
  checked++;
  const slugs = new Set();
  for (const seg of segs) for (const s of matchSeg(seg)) slugs.add(s);
  if (!slugs.size) continue;
  const items = [...slugs].map((slug) => {
    const p = posts.get(slug);
    return {
      source: 'fitgirl',
      slug,
      url: SITE + slug + '/',
      title: p.title,
      date: p.date,
      adult: isAdultSlug(slug, p.title),
    };
  }).sort((a, b) => (a.date < b.date ? 1 : -1)); // 新帖在前
  byGame[g.id] = items;
  matched++;
  entryTotal += items.length;
  if (items.some((x) => x.adult)) adultGames++;
}

/* ---- 4) 落库 ---- */
const out = {
  _comment: 'FitGirl Repack 目录 × 本体库匹配（v10.86）。生成器 tools/gen-fitgirl.js，勿手改；' +
    'byGame[id] = repack 帖数组（多源 repacks[] 结构的第一个 source，后续 DODI/ElAmigos 只加采集器）。',
  builtAt: new Date().toISOString(),
  source: 'fitgirl-repacks.site',
  catalogSize: posts.size,
  gamesTotal: games.length,
  checked,
  matchedGames: matched,
  entryTotal,
  adultGames,
  byGame,
};
fs.writeFileSync(OUT, JSON.stringify(out));
console.log('本体库 ' + games.length + ' | 可匹配 ' + checked + ' | 命中游戏 ' + matched +
  '（entry ' + entryTotal + '，成人 ' + adultGames + '）→ data/fitgirl.json');
