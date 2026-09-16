#!/usr/bin/env node
/* tools/build-steam-req.js — 预热「PC 配置要求」缓存（data/steam-req.json）
 *
 * 背景见 data/pcreq.js 顶部注释：XDGAME 详情页本身没有配置要求，
 * 而本库 97.2% 的封面 URL 里带 Steam appid → 可以拿 Steam 官方中文配置。
 *
 * 本脚本把这张表离线预热一遍（运行时也会按需实时抓 + 回写，
 * 预热只是让「打开详情页」这一步不必等网络）。
 *
 * 用法：
 *   node tools/build-steam-req.js                # 默认按「最近更新」优先，抓 1500 条
 *   node tools/build-steam-req.js --limit=5000
 *   node tools/build-steam-req.js --all          # 全量（约 14,876 条 × 1.1s ≈ 4.5 小时）
 *   node tools/build-steam-req.js --force        # 忽略已有缓存重抓
 *   node tools/build-steam-req.js --gap=1500     # 每条间隔毫秒（默认 1100）
 *   node tools/build-steam-req.js --only=xd-5828,xd-15924   # 只抓指定库 id
 *
 * 特性：
 *   · **断点续跑**：已有缓存直接跳过（除非 --force），中断后重跑接着抓
 *   · 负缓存：Steam 未收录的 appid 也写 {miss:true}，7 天后才允许重试
 *   · 每 50 条打印一次进度 + 命中率，便于长跑观察
 */
const fs = require('fs');
const path = require('path');
const pcreq = require('../data/pcreq');

const ARG = process.argv.slice(2);
const has = (k) => ARG.includes('--' + k);
const val = (k, d) => {
  const hit = ARG.find((x) => x.startsWith('--' + k + '='));
  return hit ? hit.split('=').slice(1).join('=') : d;
};

const ROOT = path.join(__dirname, '..');
const LIMIT = has('all') ? Infinity : parseInt(val('limit', '1500'), 10);
const GAP = parseInt(val('gap', '1100'), 10);
const FORCE = has('force');
const ONLY = String(val('only', '')).split(',').map((s) => s.trim()).filter(Boolean);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function loadLib() {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'games.json'), 'utf8'));
  const arr = Array.isArray(raw) ? raw : (raw.items || raw.games || []);
  return arr.map((it) => ({
    id: it.id || '',
    title: it.title || '',
    cover: it.cover || '',
    updatedTs: it.updatedTs || it.publishTs || 0,
    score: it.score || 0,
    appid: pcreq.appidOf(it.cover),
  }));
}

(async () => {
  let lib = loadLib();
  if (ONLY.length) lib = lib.filter((x) => ONLY.includes(x.id));
  else {
    /* 优先级：最近更新的先（详情页最常从「最新收录 / 热榜」点开） */
    lib.sort((a, b) => (b.updatedTs || 0) - (a.updatedTs || 0));
  }
  const withId = lib.filter((x) => x.appid);
  console.log(`[steam-req] 库内 ${lib.length} 条，带 Steam appid ${withId.length} 条（${(withId.length / (lib.length || 1) * 100).toFixed(1)}%）`);

  let todo = withId;
  if (!FORCE) {
    todo = withId.filter((x) => !pcreq.peek(x.appid));
    console.log(`[steam-req] 已有缓存，跳过 ${withId.length - todo.length} 条；本次待抓 ${todo.length}`);
  }
  todo = todo.slice(0, LIMIT);
  console.log(`[steam-req] 本次抓取 ${todo.length} 条，间隔 ${GAP}ms ≈ ${(todo.length * GAP / 60000).toFixed(1)} 分钟\n`);

  let ok = 0, miss = 0, err = 0;
  const t0 = Date.now();
  for (let i = 0; i < todo.length; i++) {
    const it = todo[i];
    try {
      const r = await pcreq.resolve({ title: it.title, cover: it.cover });
      if (r.hit) ok++; else if (r.error) err++; else miss++;
    } catch (e) { err++; }
    if ((i + 1) % 50 === 0 || i === todo.length - 1) {
      const mins = ((Date.now() - t0) / 60000).toFixed(1);
      console.log(`  ${i + 1}/${todo.length}  命中 ${ok}  未收录 ${miss}  失败 ${err}  用时 ${mins} 分钟`);
    }
    if (i < todo.length - 1) await wait(GAP);
  }
  const s = pcreq.stats();
  console.log('\n[steam-req] 完成。本次命中 ' + ok + ' / 未收录 ' + miss + ' / 失败 ' + err);
  console.log('[steam-req] 缓存总览:', JSON.stringify(s));
  console.log('[steam-req] 缓存文件: ' + pcreq._file);
})().catch((e) => { console.error('[steam-req] 失败:', e.message); process.exit(1); });
