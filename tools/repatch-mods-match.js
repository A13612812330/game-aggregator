/**
 * tools/repatch-mods-match.js — 只重算 `data/mods.json` 的**匹配字段**，采集字段逐字节不动。
 *
 * 【为什么需要它 —— 2026-10-10 实测事故】
 *   `tools/fetch-mods.js --offline` 的注释写的是「改匹配逻辑时用」，看起来正好是这条路的工具。
 *   实测**不能这么用**：`--offline` 从 `data/_mod-raw.json`（缓存快照，Sep 15）重建，
 *   而线上的 `mods.json` 是 Oct 10 建的 ⇒ 重建会把「缓存陈旧」一并算进来：
 *     · `linkTotal` 13373 → **12813**（少 560 个网盘链接）
 *     · **421 条**条目的 `links` 数组与旧产物不一致
 *     · 条目集合与 title 完全一致（所以**不会报错、不会红**，纯静默）
 *   这与「改匹配逻辑」这件事毫无关系，属于**把无关变更夹带进发布**。
 *
 * 【本工具的做法】
 *   读现有 `data/mods.json`，只重写这四个字段 + 三个统计量：
 *     · 条目级：`libId` / `libTitle` / `libUrl` / `matchBasis`
 *     · 统计级：`stats.matched` / `stats.matchedRate` / `stats.byBasis`
 *   其余字段（含 `links` / `content` / `cover` / `pv` …）**逐字节保持原值**，
 *   并在写盘前用**深比较**自证「只有白名单字段变了」（见 `assertOnlyWhitelist`）。
 *
 * 【口径】覆盖率守卫与 `data/mod-match.js` 的 `matchWithBasis` 同源 —— 匹配逻辑只有一份实现。
 *
 * 用法：
 *   node tools/repatch-mods-match.js            # 预演（不写盘）
 *   node tools/repatch-mods-match.js --write    # 写盘
 */
const fs = require('fs');
const path = require('path');

const D = path.join(__dirname, '..', 'data');
const FILE = path.join(D, 'mods.json');
const WRITE = process.argv.includes('--write');

const { buildLibIndex, matchWithBasis } = require('../data/mod-match');
const gamesDb = require('../data/gamesDb');

/* 允许被改写的字段（其余一律不许变） */
const WHITELIST = new Set(['libId', 'libTitle', 'libUrl', 'matchBasis']);
const STAT_WHITELIST = new Set(['matched', 'matchedRate', 'byBasis']);

function assertOnlyWhitelist(before, after) {
  const errs = [];
  if (before.items.length !== after.items.length) errs.push(`items 长度变了：${before.items.length} → ${after.items.length}`);
  const n = Math.min(before.items.length, after.items.length);
  let leaked = 0, leakedSample = null;
  for (let i = 0; i < n; i++) {
    const a = before.items[i], b = after.items[i];
    if (a.id !== b.id) { errs.push(`第 ${i} 条 id 变了`); break; }
    for (const k of Object.keys(b)) {
      if (WHITELIST.has(k)) continue;
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
        leaked++;
        if (!leakedSample) leakedSample = { id: b.id, field: k };
      }
    }
    for (const k of Object.keys(a)) if (!(k in b)) errs.push(`第 ${i} 条丢了字段 ${k}`);
  }
  if (leaked) errs.push(`★ 有 ${leaked} 处**白名单之外**的字段被改动（样本 ${JSON.stringify(leakedSample)}）`);
  for (const k of Object.keys(after.stats)) {
    if (STAT_WHITELIST.has(k) || k === 'builtAt') continue;
    if (JSON.stringify(before.stats[k]) !== JSON.stringify(after.stats[k])) errs.push(`stats.${k} 被改动`);
  }
  return errs;
}

(function main() {
  if (!fs.existsSync(FILE)) throw new Error('找不到 ' + FILE);
  const before = JSON.parse(fs.readFileSync(FILE, 'utf8'));

  gamesDb.load();
  const all = gamesDb.all();
  const { byName } = buildLibIndex(all);
  console.log(`端游库 ${all.length} 款 → 名称索引键 ${byName.size} 个`);

  /* 深拷贝后只改白名单字段 */
  const after = JSON.parse(JSON.stringify(before));
  let matched = 0, changed = 0;
  const byBasis = {};
  for (const x of after.items) {
    const r = matchWithBasis(x.game, byName);
    const it = r.it;
    const libId = it ? it.id : '';
    const libTitle = it ? it.title : '';
    const libUrl = it ? it.url : '';
    const matchBasis = r.basis === 'exact' ? '' : r.basis;
    if (libId) matched++;
    if (matchBasis) byBasis[matchBasis] = (byBasis[matchBasis] || 0) + 1;
    if (x.libId !== libId || x.libTitle !== libTitle || x.libUrl !== libUrl || (x.matchBasis || '') !== matchBasis) changed++;
    x.libId = libId; x.libTitle = libTitle; x.libUrl = libUrl; x.matchBasis = matchBasis;
  }
  after.stats.matched = matched;
  after.stats.matchedRate = after.items.length ? +(matched / after.items.length * 100).toFixed(1) : 0;
  after.stats.byBasis = byBasis;

  console.log(`\n匹配：${before.stats.matched} → ${matched}（${before.stats.matchedRate}% → ${after.stats.matchedRate}%）`);
  console.log(`回退命中：${JSON.stringify(byBasis)}`);
  console.log(`匹配字段发生变化的条目 = ${changed}`);

  const errs = assertOnlyWhitelist(before, after);
  if (errs.length) {
    console.log('\n❌ 自证未通过：');
    errs.forEach((e) => console.log('   - ' + e));
    process.exit(1);
  }
  console.log('✅ 自证通过：除 libId/libTitle/libUrl/matchBasis 与 3 个统计量外，其余字段逐字节未变');

  if (!WRITE) { console.log('\n（预演模式，未写盘。加 --write 才落盘）'); return; }
  fs.writeFileSync(FILE, JSON.stringify(after), 'utf8');
  console.log(`\n✅ 已写出 data/mods.json（${(fs.statSync(FILE).size / 1048576).toFixed(1)}MB）`);
})();
