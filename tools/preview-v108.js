/* tools/preview-v108.js — v10.8 验收出图 + 关键数值
 * ① 全站榜：名次是否连续（1..N）、meta 是否说明剔除条数
 * ② 最新收录：日期分隔条序列是否严格倒序、无重复；卡片日期标签格式是否统一
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://127.0.0.1:8123';
const OUT = path.join(__dirname, '..', '_preview');

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox', '--window-size=1440,1000'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  page.on('pageerror', (e) => console.log('  [页面 JS 报错]', e.message));
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 3000));

  /* ① 全站榜 */
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('#rankPills .stage-pill')].find((x) => x.textContent.includes('全站榜'));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 3000));
  const rank = await page.evaluate(() => {
    const champ = document.querySelector('#rankList .rk-champ');
    const cards = [...document.querySelectorAll('#rankList .rk-card')];
    return {
      champ: champ ? (champ.getAttribute('title') || '').split('/')[0] : null,
      nos: cards.map((c) => (c.querySelector('.no') || {}).textContent || '?'),
      n: cards.length,
      meta: (document.querySelector('#rankMeta') || {}).textContent,
    };
  });
  const seq = rank.nos.map(Number);
  const continuous = seq.every((v, i) => v === i + 2);   // 冠军卡占 1，普通卡应为 2..N
  console.log('=== 全站榜 ===');
  console.log('  冠军卡 :', rank.champ);
  console.log('  普通卡数:', rank.n, '| 序号:', rank.nos.join(','));
  console.log('  名次连续:', continuous ? '✅' : '❌ 有跳号');
  console.log('  meta   :', rank.meta);
  await page.screenshot({ path: path.join(OUT, 'v108-rank-year.png'), clip: { x: 260, y: 70, width: 920, height: 700 } });

  /* ② 最新收录 */
  await page.evaluate(() => {
    const el = document.querySelector('.sec-h');
    if (el) el.scrollIntoView({ block: 'start' });
  });
  await new Promise((r) => setTimeout(r, 3500));
  const recent = await page.evaluate(() => {
    const seps = [...document.querySelectorAll('#libList .date-sep')].map((s) => (s.textContent || '').replace(/\s+/g, ' ').trim());
    /* 列表项是 <article class="row-card">，标题在 <h3>，日期是 .pill.time */
    const rows = [...document.querySelectorAll('#libList .row-card')].map((r) => {
      const t = r.querySelector('h3'); const p = r.querySelector('.pill.time');
      return t ? { d: p ? p.textContent.trim() : '', t: t.textContent.trim().slice(0, 24) } : null;
    }).filter(Boolean);
    return { seps, rows: rows.slice(0, 16) };
  });
  console.log('\n=== 最新收录 ===');
  console.log('  日期分隔条序列:');
  recent.seps.forEach((s, i) => console.log(`    ${i + 1}. ${s}`));
  const dup = recent.seps.filter((s, i) => recent.seps.indexOf(s) !== i);
  console.log('  重复分隔条:', dup.length ? '❌ ' + [...new Set(dup)].join(' / ') : '✅ 无');
  console.log('  前 16 行（日期标签 | 标题）:');
  recent.rows.forEach((r, i) => console.log(`    ${String(i + 1).padStart(2)}. ${(r.d || '(无)').padEnd(7)} ${r.t}`));
  const pills = recent.rows.map((r) => r.d).filter(Boolean);
  /* 注意：空数组的 every() 恒为 true —— 必须先确认真的抓到了行，
     否则"格式统一 ✅"会是假阳性（本轮就踩过：选择器写错，行数为 0 却报通过）。 */
  if (!recent.rows.length) console.log('  ❌ 未抓到任何列表行（选择器可能失效）');
  else {
    const allCompact = pills.length > 0 && pills.every((p) => /^\d{2}-\d{2}$/.test(p));
    console.log(`  日期标签 ${pills.length} 个，格式统一(MM-DD): ${allCompact ? '✅' : '❌ ' + pills.join(',')}`);
  }
  await page.screenshot({ path: path.join(OUT, 'v108-recent-list.png'), clip: { x: 260, y: 70, width: 920, height: 900 } });

  await browser.close();
})();
