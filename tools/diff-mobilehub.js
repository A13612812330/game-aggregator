#!/usr/bin/env node
/**
 * tools/diff-mobilehub.js — 手游中心产物「改动前后」对比（匹配链每次改动都要看）
 *
 * 为什么需要它：任何匹配规则的改动都会同时产生**四种**结果 ——
 *   ① 新增匹配（想要的）        ② 归并（两条例并成一条，也是想要的）
 *   ③ 真退化（原本匹配、现在丢了）④ 换目标（原本匹配 A，现在变成 B）
 * 只盯着 ①（匹配率涨了）会漏掉 ③④ —— 而 ③④ 才是「改坏了」的信号。
 * 本项目历史上正是「只看匹配率」导致过误配漏检（`Assassin s Creed II` → 刺客信条3）。
 *
 * 用法：
 *   node tools/diff-mobilehub.js                    # 与最近一个 .bak- 备份对比
 *   node tools/diff-mobilehub.js data/xxx.json      # 与指定基准对比
 *
 * 退出码：0 = 无真退化；1 = 有真退化（可挂进 CI / 防线）
 */
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..', 'data');
const CUR = path.join(D, 'mobilehub.json');

/* 选基准 */
const arg = process.argv[2];
let basePath = arg ? path.resolve(arg) : null;
if (!basePath) {
  const baks = fs.readdirSync(D).filter((f) => /^mobilehub\.json\.bak-/.test(f))
    .map((f) => [path.join(D, f), fs.statSync(path.join(D, f)).mtimeMs])
    .sort((a, b) => b[1] - a[1]);
  if (!baks.length) { console.log('没有基准：请传入文件，或先备份 data/mobilehub.json'); process.exit(0); }
  basePath = baks[0][0];
}

const oldJ = JSON.parse(fs.readFileSync(basePath, 'utf8'));
const newJ = JSON.parse(fs.readFileSync(CUR, 'utf8'));
const low = (x) => String(x.name || '').toLowerCase();
const om = new Map(oldJ.items.map((x) => [low(x), x]));
const nm = new Map(newJ.items.map((x) => [low(x), x]));

console.log('基准: ' + path.relative(path.join(__dirname, '..'), basePath));
console.log('');
console.log('| 指标 | 改动前 | 改动后 | 差 |');
console.log('|---|---|---|---|');
const rows = [['合并条目', 'total'], ['匹配端游库', 'matched'], ['未匹配', 'unmatched'], ['配置总数', 'configs']];
for (const [label, k] of rows) {
  const a = (oldJ.stats || {})[k] || 0, b = (newJ.stats || {})[k] || 0;
  console.log(`| ${label} | ${a} | ${b} | ${b - a >= 0 ? '+' : ''}${b - a} |`);
}
console.log(`| 匹配率 | ${oldJ.stats.matchedRate}% | ${newJ.stats.matchedRate}% | ${(newJ.stats.matchedRate - oldJ.stats.matchedRate).toFixed(1)}pp |`);
console.log('');

/* ① 新增匹配 */
const gained = [];
for (const [k, n] of nm) {
  const o = om.get(k);
  if (n.libId && o && !o.libId) gained.push(n.name + '  →  ' + n.libTitle);
}
console.log('### ① 新增匹配（' + gained.length + '）');
gained.slice(0, 60).forEach((g) => console.log('  + ' + g));
if (gained.length > 60) console.log('  …另有 ' + (gained.length - 60) + ' 条');
console.log('');

/* ② 归并 */
const gone = oldJ.items.filter((x) => !nm.has(low(x)));
console.log('### ② 归并掉（' + gone.length + '）');
let orphan = 0;
const altIdx = new Map();
for (const x of newJ.items) for (const a of (x.alt || [])) altIdx.set(String(a).toLowerCase(), x);
for (const g of gone) {
  const host = altIdx.get(low(g))
    || newJ.items.find((x) => low(x).includes(low(g)) || low(g).includes(low(x)));
  if (host) console.log('  ⇢ ' + g.name + '  ⇒  「' + host.name + '」（' + (host.libTitle || '未匹配') + '）');
  else { orphan++; console.log('  ✘ ' + g.name + '  ⇒  ⚠️ 找不到并入目标（配置 ' + (g.configs || 0) + '）'); }
}
console.log('');

/* ③ 真退化 */
const lost = [];
for (const [k, o] of om) {
  if (!o.libId) continue;
  const n = nm.get(k);
  if (n && !n.libId) lost.push(o.name + '   原: ' + o.libTitle);
}
console.log('### ③ ★ 真退化（' + lost.length + '）' + (lost.length ? '' : '  ✅ 无'));
lost.forEach((l) => console.log('  ✗ ' + l));
console.log('');

/* ④ 换目标 */
const changed = [];
for (const [k, o] of om) {
  if (!o.libId) continue;
  const n = nm.get(k);
  if (n && n.libId && n.libId !== o.libId) changed.push(o.name + '\n        原: ' + o.libTitle + '\n        新: ' + n.libTitle);
}
console.log('### ④ 换匹配目标（' + changed.length + '）' + (changed.length ? '' : '  ✅ 无'));
changed.forEach((c) => console.log('  ~ ' + c));
console.log('');

/* 守恒检查 */
const oc = oldJ.items.reduce((s, x) => s + (x.configs || 0), 0);
const nc = newJ.items.reduce((s, x) => s + (x.configs || 0), 0);
const totalOk = oldJ.items.length - gone.length === newJ.items.length;
console.log('### 守恒检查');
console.log('  条目: ' + oldJ.items.length + ' - 归并 ' + gone.length + ' = ' + (oldJ.items.length - gone.length)
  + ' ｜ 实际 ' + newJ.items.length + '  ' + (totalOk ? '✅' : '⚠️ 不等（有新增条目，通常正常）'));
console.log('  配置: ' + oc + ' → ' + nc + '  ' + (oc === nc ? '✅ 未丢' : '⚠️ 差异 ' + (nc - oc)));
if (orphan) console.log('  ⚠️ 有 ' + orphan + ' 条归并找不到宿主，需人工确认');

process.exit(lost.length ? 1 : 0);
