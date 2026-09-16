#!/usr/bin/env node
/**
 * tools/migrate-dates.js — 一次性修历史日期数据（v10.8）
 *
 * 干的事：
 *   ① dateLabel 归一化：`2026/9/9`→`2026-09-09`，`2026/9/89`→`2026-09-08`（还原被吞位）
 *   ② updatedTs 清残：NaN / 0 一律修掉；能算出日期的用当日 00:00 UTC 兜底
 *   ③ [--fetch] 对仍无日期的机地条目，抓一次源站详情页取官方发布时间戳补齐
 *
 * 用法：
 *   node tools/migrate-dates.js --dry      # 只看会改什么，不落盘
 *   node tools/migrate-dates.js            # 写回（自动备份）
 *   node tools/migrate-dates.js --fetch    # 顺带联网补齐无日期条目（较慢）
 */
const fs = require('fs');
const path = require('path');
const { normDate } = require('../shared');
const { normalizeDates } = require('../data/date-norm');

const DATA_FILE = path.join(__dirname, '..', 'data', 'games.json');
const DRY = process.argv.includes('--dry');
const FETCH = process.argv.includes('--fetch');

(async () => {
  const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  const list = Array.isArray(raw) ? raw : Object.values(raw);
  console.log(`读入 ${list.length} 条`);

  /* 迁移前快照：哪些 dateLabel 会被改成什么 */
  const before = list.map((g) => ({ id: g.id, d: g.dateLabel, t: g.updatedTs }));
  const stat = normalizeDates(list);

  console.log('\n=== 归一化统计 ===');
  console.log(`  总条数            ${stat.total}`);
  console.log(`  发生改动          ${stat.changed}`);
  console.log(`  ├ 还原被吞位的日  ${stat.repair}`);
  console.log(`  ├ 补零/格式统一   ${stat.normalize}`);
  console.log(`  ├ 补上日期        ${stat.fillLabel}`);
  console.log(`  └ 补上 updatedTs  ${stat.fillTs}`);
  console.log(`  仍无日期          ${stat.stillNoDate}`);

  console.log('\n=== 明细（前 60 条改动）===');
  let shown = 0;
  for (let i = 0; i < list.length && shown < 60; i++) {
    const b = before[i];
    const g = list[i];
    if (b.d === g.dateLabel && b.t === g.updatedTs) continue;
    console.log(
      `  ${String(g.id).padEnd(22)} ${JSON.stringify(b.d).padEnd(14)} → ${JSON.stringify(g.dateLabel).padEnd(14)}` +
      ` | ts ${b.t === undefined || b.t === null ? 'null' : b.t} → ${g.updatedTs === undefined || g.updatedTs === null ? 'null' : g.updatedTs}` +
      ` | ${String(g.title || '').slice(0, 22)}`
    );
    shown++;
  }

  /* ③ 仍无日期的条目：联网补齐（仅机地，XD 条目一般都有） */
  const noDate = list.filter((g) => !g.dateLabel);
  console.log(`\n=== 仍无日期 ${noDate.length} 条 ===`);
  noDate.forEach((g) => console.log(`  ${String(g.id).padEnd(22)} ${String(g.title || '').slice(0, 30)} | updatedTs=${g.updatedTs || '(无)'}`));

  if (FETCH && noDate.length) {
    const jidi = require('../fetchers/jidi');
    console.log('\n=== 联网补齐（源站详情页）===');
    for (const g of noDate) {
      const tid = (String(g.id).match(/^jidi-(\d+)$/) || [])[1];
      const url = (String(g.url || '').match(/topic\/detail\/(\d+)/) || [])[1];
      const id = tid || url;
      if (!id) { console.log(`  ${g.id} 非机地条目，跳过`); continue; }
      try {
        const d = await jidi.detail(id);
        const iso = normDate(d.releaseDate);
        if (iso) {
          g.dateLabel = iso;
          if (!Number.isFinite(Number(g.updatedTs)) || Number(g.updatedTs) <= 0) {
            g.updatedTs = Date.parse(iso + 'T00:00:00Z');
          }
          console.log(`  ✅ ${g.id} ${String(g.title).slice(0, 20)} → ${iso}`);
        } else {
          console.log(`  ⚠️ ${g.id} 源站也无发布日期（releaseDate=${JSON.stringify(d.releaseDate)}）`);
        }
      } catch (e) {
        console.log(`  ❌ ${g.id} 抓取失败: ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, 600));   // 礼貌限速
    }
  }

  if (DRY) {
    console.log('\n(--dry 干跑，未写入)');
    return;
  }

  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const bakDir = path.join(__dirname, '..', '_bak');
  if (!fs.existsSync(bakDir)) fs.mkdirSync(bakDir, { recursive: true });
  const bak = path.join(bakDir, `games.json.bak-${ts}`);
  fs.copyFileSync(DATA_FILE, bak);
  fs.writeFileSync(DATA_FILE, JSON.stringify(list), 'utf-8');
  console.log(`\n✅ 已写回 data/games.json`);
  console.log(`   备份：${path.relative(path.join(__dirname, '..'), bak)}`);
})();
