#!/usr/bin/env node
/* v10.6 验收：云存档分区「点卡片能否进详情页」的浏览器端实测（出图 + 计数）
 * 用法：先起服务 8123，再 node tools/preview-v106.js */
const fs = require('fs');
const path = require('path');
const BASE = 'http://127.0.0.1:8123/';
const OUT = path.join(__dirname, '..', '_preview');
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
const puppeteer = require(path.join(__dirname, '..', 'node_modules', 'puppeteer-core'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1.5 });
  const log = [];

  await p.goto(BASE + 'emulator.html', { waitUntil: 'networkidle2', timeout: 60000 });
  await p.waitForSelector('#emuGrid .emu-card', { timeout: 30000 });
  await sleep(1500);

  /* 切到「云存档」页签 */
  await p.evaluate(() => { const t = [...document.querySelectorAll('.emu-tab')].find((x) => /云存档/.test(x.textContent)); t && t.click(); });
  await sleep(3000);
  await p.waitForSelector('#svGrid .emu-card', { timeout: 30000 });

  /* 统计首屏「有详情入口 / 无详情入口」 */
  const first = await p.evaluate(() => {
    const cards = [...document.querySelectorAll('#svGrid .emu-card')];
    const noLib = cards.filter((c) => !c.dataset.lib).map((c) => c.dataset.name || '?');
    const cn = document.getElementById('svCount');
    return { n: cards.length, noLib: noLib.length, withLib: cards.length - noLib.length, noLibNames: noLib.slice(0, 12), countText: cn ? cn.textContent.trim() : '' };
  });
  log.push(`云存档首屏 ${first.n} 张卡 ｜ 有详情入口 ${first.withLib} ｜ 无详情入口 ${first.noLib}`);
  if (first.countText) log.push(`  计数文案：${first.countText}`);
  if (first.noLibNames.length) log.push(`  无入口样例：${first.noLibNames.join(' / ')}`);

  /* 抽样：点一张「有详情入口」的卡，验证确实打开抽屉 */
  const probe = await p.evaluate(async () => {
    const c = [...document.querySelectorAll('#svGrid .emu-card[data-lib]')].find((x) => x.querySelector('h4'));
    if (!c) return { skip: true };
    const nm = c.dataset.name;
    c.querySelector('h4').click();
    await new Promise((r) => setTimeout(r, 3200));
    const open = document.getElementById('drawer').classList.contains('show');
    const title = ((document.querySelector('#drawerBody h2') || {}).textContent || '').trim();
    const kv = [...document.querySelectorAll('#drawerBody .kv .k')].map((x) => x.textContent.trim()).slice(0, 6);
    window.closeDetail && window.closeDetail();
    return { nm, open, title, kv };
  });
  log.push(probe.skip ? '抽点：无带详情入口的卡片'
    : `抽点「${probe.nm}」→ 抽屉 ${probe.open ? '已打开' : '未打开'} ｜ 标题「${probe.title}」｜ KV ${probe.kv.join('/')}`);
  await sleep(600);

  const grid = await p.$('#svGrid');
  if (grid) await grid.screenshot({ path: path.join(OUT, 'v106-saves-cards.png') });

  await b.close();
  console.log('\n=== v10.6 云存档点击验收 ===');
  log.forEach((l) => console.log('  ' + l));
})().catch((e) => { console.error('验收失败:', e.message); process.exit(1); });
