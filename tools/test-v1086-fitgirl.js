#!/usr/bin/env node
/**
 * ★ v10.86 防线：FitGirl Repack 接入（外链档 + magnet 按需现抓）
 * 断言原则：数字现测不写死 —— adult 口径、目录规模都独立重算与数据夹逼。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' —— ' + detail : '')); }
}

/* ============ A. data/fitgirl.json ============ */
console.log('\n── A 落库数据 ──');
const FG = JSON.parse(read('data/fitgirl.json'));
const games = JSON.parse(read('data/games.json'));
const gameIds = new Set(games.map((g) => g.id));

ok('A1 builtAt 可解析且晚于 2026-10-19（生成器产物）',
  !Number.isNaN(Date.parse(FG.builtAt)) && Date.parse(FG.builtAt) > Date.parse('2026-10-19T00:00:00Z'));

/* 目录规模独立重算夹逼 */
const catDir = path.join(__dirname, '_probe-fg-cat');
const slugs = new Set();
for (const f of fs.readdirSync(catDir).filter((f) => /^p\d+\.json$/.test(f))) {
  try { for (const p of JSON.parse(fs.readFileSync(path.join(catDir, f), 'utf8'))) slugs.add(p.slug); } catch (e) { /* 探针快照 */ }
}
ok('A2 catalogSize 与快照独立重算一致（' + slugs.size + '）', FG.catalogSize === slugs.size,
  '表=' + FG.catalogSize + ' 快照=' + slugs.size);

const keys = Object.keys(FG.byGame);
const orphans = keys.filter((k) => !gameIds.has(k));
ok('A3 byGame 全部键都在 games.json 里（无孤儿）', orphans.length === 0,
  orphans.slice(0, 3).join(','));

const entries = keys.flatMap((k) => FG.byGame[k]);
ok('A4 每条 source=fitgirl / slug 规范 / url 与 slug 一致 / adult 是布尔',
  entries.every((x) => x.source === 'fitgirl'
    && /^[a-z0-9-]+$/.test(x.slug)
    && x.url === 'https://fitgirl-repacks.site/' + x.slug + '/'
    && typeof x.adult === 'boolean'));

ok('A5 matchedGames/entryTotal 与 byGame 夹逼',
  FG.matchedGames === keys.length && FG.entryTotal === entries.length);

/* adult 口径独立重算（与生成器同规则，独立实现） */
const ADULT_RE = /(\b18\+\b|\badult\b|\bxxx\b|\bporn\b|\bnude\b|\bhentai\b|\berotic\b|\bsex\b|\bn sfw\b|nsfw)/i;
const ADULT_VETO = new Set(['tropical-lust']);
const badAdult = entries.filter((x) => x.adult !== (ADULT_VETO.has(x.slug) || ADULT_RE.test(x.title)));
ok('A6 adult 打标与独立重算一致（现测 ' + entries.filter((x) => x.adult).length + ' 条）',
  badAdult.length === 0, badAdult.slice(0, 3).map((x) => x.slug).join(','));

ok('A7 命中规模在合理带内（>5000 且 ≤ 可匹配数）',
  keys.length > 5000 && keys.length <= FG.checked);

/* ============ B. 服务端 ============ */
console.log('\n── B 服务端端点 ──');
const SV = read('server.js');
ok('B1 /api/fitgirl/repacks 已注册', SV.includes("app.get('/api/fitgirl/repacks'"));
ok('B2 /api/fitgirl/magnet 已注册', SV.includes("app.get('/api/fitgirl/magnet'"));
ok('B3 SSRF 白名单：slug 正则 + fitgirl.has 表内校验',
  /\!\s*\/\^\[a-z0-9-\]\+\$\/\.test\(slug\)/.test(SV) && SV.includes('fitgirl.has(slug)'));
ok('B4 magnet 走 24h 缓存（.cache/fitgirl + TTL）',
  SV.includes("'.cache', 'fitgirl'") && /FG_MAGNET_TTL\s*=\s*24\s*\*\s*3600/.test(SV));
ok('B5 不做流代理（FitGirl filehoster 不可服务端复刻 —— 终局结论）',
  !/app\.get\('\/api\/fitgirl\/(dl|proxy|stream)'/.test(SV));

/* ============ C. 前端 ============ */
console.log('\n── C 前端接线 ──');
const HTML = read('public/index.html');
ok('C1 dlUniFetchFg 定义且与 dlUniFetchBody 并行（Promise.all）',
  /async function dlUniFetchFg\(/.test(HTML)
  && /Promise\.all\(\[\s*dlUniFetchBody\(st\.ctx\),\s*dlUniFetchFg\(st\.ctx\)\.catch/.test(HTML));
ok('C2 body 页签渲染后追加 FitGirl 段（dlUniPaintFg）',
  /dlUniPaintBody\(d\);\s*dlUniPaintFg\(st\.data\.fg\);/.test(HTML));
/* ★ v10.92 契约变更：行内从「↗ 打开 Repack 页 / ⧉ 复制磁力 / ▸ 分卷清单」三链接
 *   改成「⬇ 直链下载 / ⧉ 磁力链」两个按钮 + 一个 `↗ 原站` 小字链接
 *   （用户口径：只显示直链下载 + 磁力链下载按钮）。原站不能删：帖子里还有安装说明与截图。 */
ok('C3 两个下载按钮 + 原站小链接 + 18+ 角标',
  HTML.includes('data-fg-dl=') && HTML.includes('data-fg-magnet=')
  && HTML.includes('class="fgorg"') && /18\+/.test(HTML));
ok('C4 剪贴板失败有手动复制兜底（不静默失效）',
  /navigator\.clipboard\.writeText/.test(HTML) && /window\.prompt\('自动复制不可用/.test(HTML));
ok('C5 成人条目详情页照样显示（18+ 角标，不隐藏 —— 用户口径）',
  /it\.adult \? ' <span class="tagx"/.test(HTML));

/* ============ D. 数据模块 + 派生页 ============ */
console.log('\n── D 数据模块与派生页 ──');
const FGMOD = read('data/fitgirl.js');
ok('D1 fitgirl.has 白名单函数存在（加载期建索引）',
  /const slugSet = new Set\(\)/.test(FGMOD) && /function has\(slug\)/.test(FGMOD));
ok('D2 slim 上限 ≤8', /Math\.min\(8,/.test(FGMOD));
const derived = ['public/emulator.html', 'public/unpack.html', 'public/extract.html', 'public/resources.html'];
const missing = derived.filter((f) => !read(f).includes('dlUniFetchFg'));
ok('D3 四张派生页随主源重建（含 dlUniFetchFg）', missing.length === 0,
  missing.join(','));

console.log(`\n── v10.86 fitgirl：${pass} / ${pass + fail} 通过${fail ? `（失败 ${fail}）──` : ' ──'}`);
if (fail) process.exitCode = 1;
