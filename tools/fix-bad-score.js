#!/usr/bin/env node
/**
 * tools/fix-bad-score.js — 清理越界评分（v10.8）
 *
 * 背景：XD 列表页 `.rank` 元素偶尔不是评分而是名次/其它数字，
 *       早期抓取没有范围校验，留下了 xd-3160 = 54 这种值。
 *       browse 的排序侧已有 `<=10` 防护，但**详情页会把它当评分展示**。
 *
 * 用法：node tools/fix-bad-score.js [--dry]
 */
const fs = require('fs');
const path = require('path');
const DATA_FILE = path.join(__dirname, '..', 'data', 'games.json');

const DRY = process.argv.includes('--dry');
const list = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
const arr = Array.isArray(list) ? list : Object.values(list);

const bad = arr.filter((g) => g && g.score != null && (!Number.isFinite(Number(g.score)) || Number(g.score) <= 0 || Number(g.score) > 10));
console.log(`扫描 ${arr.length} 条，越界评分 ${bad.length} 条`);
bad.forEach((g) => console.log(`  ${String(g.id).padEnd(16)} score=${JSON.stringify(g.score)}  ${g.title}`));

if (!bad.length) { console.log('无需处理'); process.exit(0); }
if (DRY) { console.log('\n(--dry 干跑，未写入)'); process.exit(0); }

for (const g of bad) g.score = null;
const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const bakDir = path.join(__dirname, '..', '_bak');
if (!fs.existsSync(bakDir)) fs.mkdirSync(bakDir, { recursive: true });
fs.copyFileSync(DATA_FILE, path.join(bakDir, `games.json.bak-score-${ts}`));
fs.writeFileSync(DATA_FILE, JSON.stringify(arr), 'utf-8');
console.log(`\n✅ 已把 ${bad.length} 条越界评分置为 null 并写回`);
