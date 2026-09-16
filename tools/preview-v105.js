#!/usr/bin/env node
/* v10.5 验收出图：截图 + 交互实测（需先起服务 8123）
 * 产物：_preview/v105-*.png */
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
  await p.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 1.5 });
  const log = [];

  /* ① 手游中心筛选行（4 开关） */
  await p.goto(BASE + 'emulator.html', { waitUntil: 'networkidle2', timeout: 60000 });
  await p.waitForSelector('#emuGrid .emu-card', { timeout: 30000 });
  await sleep(1600);
  const bar = await p.$('#emulator .emu-bar');
  if (bar) await bar.screenshot({ path: path.join(OUT, 'v105-emu-filter-bar.png') });
  log.push('手游中心筛选行：' + (await p.evaluate(() => [...document.querySelectorAll('#emulator .emu-refresh')].map((e) => e.textContent.trim() + (e.classList.contains('on') ? '[ON]' : '')).join(' | '))));

  /* ② 点「有修改器」→ 列表收缩 + 卡面出现 🛠 角标 */
  await p.evaluate(() => document.getElementById('emuToggleTr').click());
  await sleep(2000);
  const grid = await p.$('#emuGrid');
  if (grid) await grid.screenshot({ path: path.join(OUT, 'v105-emu-has-trainer.png') });
  log.push('有修改器筛选后：' + (await p.evaluate(() => document.getElementById('emuCount').textContent)));

  /* ③ 点卡片正文 → 详情抽屉（点正文不再进配置面板） */
  await p.evaluate(() => { const c = document.querySelector('#emuGrid .emu-card'); if (c) c.click(); });
  await sleep(3000);
  log.push('手游卡片点正文 → drawer=' + (await p.evaluate(() => document.getElementById('drawer').classList.contains('show')))
    + ' / 标题=' + (await p.evaluate(() => (document.querySelector('#drawerBody h2') || {}).textContent || '(空)')));
  const dw = await p.$('#drawer');
  if (dw) await dw.screenshot({ path: path.join(OUT, 'v105-emu-detail-xd.png') });
  await p.evaluate(() => window.closeDetail());
  await sleep(400);

  /* ④ 云存档：卡片正文点击 → 进详情（本轮修复点） */
  await p.evaluate(() => { const t = [...document.querySelectorAll('.emu-tab')].find((x) => /云存档/.test(x.textContent)); t && t.click(); });
  await sleep(3000);
  const svGrid = await p.$('#svGrid');
  if (svGrid) await svGrid.screenshot({ path: path.join(OUT, 'v105-saves-cards.png') });
  await p.evaluate(() => { const c = document.querySelector('#svGrid .emu-card[data-lib] h4'); if (c) c.click(); });
  await sleep(3000);
  log.push('云存档卡片点正文 → drawer=' + (await p.evaluate(() => document.getElementById('drawer').classList.contains('show')))
    + ' / 标题=' + (await p.evaluate(() => (document.querySelector('#drawerBody h2') || {}).textContent || '(空)')));
  await p.evaluate(() => window.closeDetail());
  await sleep(400);

  /* ⑤ 首页筛选条（4 开关） */
  await p.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await p.waitForSelector('#colMain .filter-bar', { timeout: 30000 });
  await sleep(1500);
  const fb = await p.$('#colMain .filter-bar');
  if (fb) await fb.screenshot({ path: path.join(OUT, 'v105-home-filter-bar.png') });
  await p.evaluate(() => document.getElementById('svToggle').click());
  await sleep(1800);
  log.push('首页「有云存档」：' + (await p.evaluate(() => document.getElementById('filterCount').textContent)));
  const fb2 = await p.$('#colMain .filter-bar');
  if (fb2) await fb2.screenshot({ path: path.join(OUT, 'v105-home-filter-active.png') });

  /* ⑥ 首页点一条 XD 卡片，看详情抽屉是否已有厂商/发行日期/标签 */
  await p.evaluate(() => { const c = document.querySelector('#colMain .row-card'); if (c) c.click(); });
  await sleep(3500);
  const kv = await p.evaluate(() => [...document.querySelectorAll('#drawerBody .kv > *')].map((e) => e.textContent.trim()).join(' || '));
  log.push('XD 详情 kv：' + (kv || '(空)').slice(0, 320));
  const dw2 = await p.$('#drawer');
  if (dw2) await dw2.screenshot({ path: path.join(OUT, 'v105-home-detail-xd.png') });

  await b.close();
  console.log(log.join('\n'));
})().catch((e) => { console.error('验收失败:', e.message); process.exit(1); });
