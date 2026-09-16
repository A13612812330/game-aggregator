#!/usr/bin/env node
/* ============================================================================
 * 筛选条布局回归（浏览器实测）
 * ----------------------------------------------------------------------------
 * 为什么单独存在：jsdom 行为测试**算不出布局**。本轮踩到的两个问题
 *   ① .sort-pills 带 margin:2px 0 12px，在 align-items:center 的父容器里把排序组顶离基线
 *   ② 分段控件是 nowrap 的，把栅格子项 #colMain 的 min-content 撑到 531px，
 *      375 宽的屏上整页横向滚动（实测值）
 * 都属于「测试全绿、线上却错位」——只能真跑浏览器量。
 *
 * 用法：
 *   1) 先在项目根目录起服务：node server.js（端口 8123）
 *   2) node tools/test-filter-layout.js
 * 依赖：edge（msedge.exe）+ puppeteer-core（devDependencies）
 * ========================================================================== */
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://127.0.0.1:8123/';
const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/microsoft-edge',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];
const SHOTS = [
  { w: 360, h: 800, tag: '窄屏 360' },
  { w: 375, h: 812, tag: '窄屏 375' },
  { w: 430, h: 900, tag: '窄屏 430' },
  { w: 760, h: 900, tag: '断点 760' },
  { w: 1024, h: 900, tag: '平板 1024' },
  { w: 1280, h: 900, tag: '桌面 1280' },
];

const R = [];
const t = (cond, name, extra) => R.push([!!cond, name, extra]);

function loadPuppeteer() {
  try {
    return require(path.join(__dirname, '..', 'node_modules', 'puppeteer-core'));
  } catch (e) {
    try { return require('puppeteer-core'); } catch (e2) { return null; }
  }
}

(async () => {
  const puppeteer = loadPuppeteer();
  if (!puppeteer) {
    console.log('SKIP：未安装 puppeteer-core（npm i -D puppeteer-core）');
    process.exit(0);
  }
  const exe = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
  if (!exe) {
    console.log('SKIP：未找到 Edge 可执行文件');
    process.exit(0);
  }
  let reachable = true;
  try {
    const r = await fetch(BASE.replace(/\/$/, '') + '/api/health');
    reachable = r.ok;
  } catch (e) { reachable = false; }
  if (!reachable) {
    console.log(`SKIP：${BASE} 不可达 —— 先在项目根目录跑 node server.js`);
    process.exit(0);
  }

  const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  for (const { w, h, tag } of SHOTS) {
    const p = await b.newPage();
    await p.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await p.setRequestInterception(true);
    p.on('request', (r) => (r.resourceType() === 'image' ? r.abort() : r.continue()));
    await p.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
    await p.waitForSelector('#colMain .filter-bar .size-pill', { timeout: 30000 });
    await sleep(900);

    const m = await p.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const R = (s) => { const e = q(s); return e ? e.getBoundingClientRect() : null; };
      const seg = q('#colMain .size-pills');
      const rows = [...document.querySelectorAll('#colMain .filter-row')];
      return {
        vw: window.innerWidth,
        docScroll: document.documentElement.scrollWidth,
        labels: rows.map((r) => { const l = r.querySelector('.filter-lb'); return l ? l.textContent.trim() : ''; }),
        rowCount: rows.length,
        segCanScroll: seg ? seg.scrollWidth > seg.clientWidth + 1 : false,
        togglesWrapped: R('#bhToggle') && seg ? R('#bhToggle').top > seg.getBoundingClientRect().bottom - 4 : false,
        /* ★ v10.5：四个开关应独占「筛选」行（原先挤在容量行里 → 溢出换行、半行空档） */
        togglesOwnRow: (() => {
          const t = R('#bhToggle'), s = R('#sizePills');
          return !!t && !!s && t.top >= s.bottom - 2;
        })(),
        togglesSameLine: (() => {
          const a = R('#bhToggle'), f = R('#svToggle');
          return !!a && !!f && Math.abs(a.top - f.top) <= 2;
        })(),
        switchCount: document.querySelectorAll('#colMain .bh-toggle').length,
        lbHidden: (() => { const e = q('#colMain .sort-pill .lb'); return e ? getComputedStyle(e).display === 'none' : null; })(),
      };
    });

    t(m.docScroll <= m.vw + 1, `[${tag}] 无横向溢出（scrollWidth ${m.docScroll} ≤ ${m.vw}）`);
    t(m.rowCount === 3, `[${tag}] 三行标签为「排序 / 容量 / 筛选」`, m.labels.join(' / '));
    t(m.switchCount === 4, `[${tag}] 四个只看开关都在（社区有配置 / 有实测记录 / 有修改器 / 有云存档）`, String(m.switchCount));
    if (w <= 430) {
      t(m.togglesWrapped, `[${tag}] 开关不与容量控件抢行`);
      t(m.segCanScroll, `[${tag}] 容量控件可横向滑动`);
    }
    t(m.togglesOwnRow, `[${tag}] 四个开关独占「筛选」行（不再与容量控件抢行）`);
    /* 窄屏放不下四个开关，允许它们在「筛选」行内折行；宽屏必须一行排开 */
    if (w >= 1024) t(m.togglesSameLine, `[${tag}] 宽屏下四个开关同行排开`);
    /* 英文角标收起的断点与 CSS 一致（max-width:760px 含 760） */
    if (w <= 760) t(m.lbHidden === true, `[${tag}] 英文角标已收起（中文档位优先露出）`);
    else t(m.lbHidden === false, `[${tag}] 英文角标保留（宽屏有空间）`);
    await p.close();
  }

  /* 交互：点击后选中态真的迁移（防止只改样式改坏了 data-* 而无人发现） */
  {
    const p = await b.newPage();
    await p.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    await p.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
    await p.waitForSelector('#colMain .filter-bar .size-pill', { timeout: 30000 });
    await sleep(900);
    await p.evaluate(() => document.querySelector('.sort-pill[data-s="score"]').click());
    await sleep(1000);
    const r1 = await p.evaluate(() => ({
      on: [...document.querySelectorAll('#colMain .sort-pill')].filter((e) => e.classList.contains('on')).map((e) => e.dataset.s),
      cnt: document.getElementById('filterCount').textContent,
    }));
    t(r1.on.length === 1 && r1.on[0] === 'score', '[交互] 点「评分最高」后选中态唯一且迁移正确', JSON.stringify(r1.on));
    t(/命中/.test(r1.cnt), '[交互] 计数文案随筛选刷新', r1.cnt);
    await p.evaluate(() => document.getElementById('bhToggle').click());
    await sleep(1000);
    const r2 = await p.evaluate(() => ({
      on: document.getElementById('bhToggle').classList.contains('on'),
      cnt: document.getElementById('filterCount').textContent,
    }));
    t(r2.on === true, '[交互] 点「📱 社区有配置」进入活跃态');
    t(r2.cnt.includes('社区有配置'), '[交互] 计数文案带上开关条件', r2.cnt);
    /* ★ v10.5 两个新开关：切换后命中数应变小且计数文案带上条件 */
    await p.evaluate(() => document.getElementById('bhToggle').click());   // 复位
    await sleep(900);
    await p.evaluate(() => document.getElementById('trToggle').click());
    await sleep(1200);
    const r3 = await p.evaluate(() => ({
      on: document.getElementById('trToggle').classList.contains('on'),
      cnt: document.getElementById('filterCount').textContent,
      n: document.querySelectorAll('#colMain .row-card').length,
    }));
    t(r3.on === true, '[交互] 点「🛠 有修改器」进入活跃态');
    t(r3.cnt.includes('有修改器'), '[交互] 计数文案带上「有修改器」', r3.cnt);
    await p.evaluate(() => document.getElementById('trToggle').click());
    await sleep(1000);
    await p.evaluate(() => document.getElementById('svToggle').click());
    await sleep(1200);
    const r4 = await p.evaluate(() => ({
      on: document.getElementById('svToggle').classList.contains('on'),
      cnt: document.getElementById('filterCount').textContent,
    }));
    t(r4.on === true && r4.cnt.includes('有云存档'), '[交互] 点「💾 有云存档」进入活跃态并更新计数', r4.cnt);
    await p.close();
  }

  /* ================= ★ v10.5：手机专区筛选条「开关不换行」回归 =================
   * 用户反馈：点「仅看匹配端游」后，「只看双料」被挤到下一行。
   * 根因是激活态把文案改成「…（已开）」→ 按钮变宽。jsdom 算不出布局，必须真跑浏览器量：
   *   ① 四种宽度下，「筛选」行的 4 个开关切换前后都保持同一行（top 不变）
   *   ② 切换前后按钮宽度不变（宽度变了就说明又靠改文案表示状态了）
   */
  for (const w of [1280, 1024, 760, 430, 375]) {
    const p = await b.newPage();
    await p.setViewport({ width: w, height: 900, deviceScaleFactor: 1 });
    await p.setRequestInterception(true);
    p.on('request', (r) => (r.resourceType() === 'image' ? r.abort() : r.continue()));
    await p.goto(BASE.replace(/\/$/, '') + '/emulator.html', { waitUntil: 'networkidle2', timeout: 60000 });
    await p.waitForSelector('#emuToggleLib', { timeout: 30000 });
    await sleep(1400);
    const probe = async () => p.evaluate(() => {
      const ids = ['emuToggleLib', 'emuToggleBoth', 'emuToggleTr', 'emuToggleSv'];
      const els = ids.map((i) => document.getElementById(i));
      return {
        tops: els.map((e) => Math.round(e.getBoundingClientRect().top)),
        widths: els.map((e) => +e.getBoundingClientRect().width.toFixed(1)),
        texts: els.map((e) => e.textContent.trim()),
        marks: els.map((e) => (getComputedStyle(e, '::before').content || '').replace(/["']/g, '')),
        rowCount: document.querySelectorAll('#emulator .emu-bar-row').length,
        docScroll: document.documentElement.scrollWidth,
        vw: window.innerWidth,
      };
    });
    const before = await probe();
    await p.evaluate(() => document.getElementById('emuToggleLib').click());  // 切到关
    await sleep(1500);
    const after = await probe();
    /* 同一行判定留 2px 容差：flex 基线对齐会让相邻按钮出现 1px 亚像素差 */
    const sameRow = (tops) => Math.max(...tops) - Math.min(...tops) <= 2;
    const samePattern = before.tops.every((x, i) => Math.abs(x - after.tops[i]) <= 2);
    t(before.rowCount === 3, `[专区 ${w}] 筛选条拆成 3 行（搜索 / 排序 / 筛选）`, String(before.rowCount));
    t(samePattern,
      `[专区 ${w}] 切换「仅看匹配端游」不改变任何开关的换行位置`,
      `${before.tops.join(',')} → ${after.tops.join(',')}`);
    if (w >= 1024) t(sameRow(after.tops), `[专区 ${w}] 宽屏下四个开关同一行`, after.tops.join(','));
    t(before.widths.every((x, i) => Math.abs(x - after.widths[i]) <= 0.5),
      `[专区 ${w}] 切换前后按钮宽度逐像素不变（状态靠定宽伪元素表达）`,
      `${before.widths.join('/')} → ${after.widths.join('/')}`);
    t(before.texts.every((x, i) => x === after.texts[i]),
      `[专区 ${w}] 切换前后按钮文案不变`, before.texts[0] + ' → ' + after.texts[0]);
    t(before.marks[0] === '✓' && after.marks[0] === '○',
      `[专区 ${w}] 状态标记由 CSS ::before 提供（✓ ↔ ○）`,
      `${before.marks[0]} → ${after.marks[0]}`);
    t(before.docScroll <= before.vw + 1, `[专区 ${w}] 无横向溢出（${before.docScroll} ≤ ${before.vw}）`);
    await p.close();
  }

  await b.close();

  const fail = R.filter((r) => !r[0]);
  console.log('\n' + '='.repeat(70));
  for (const [c, n, e] of R) console.log(`${c ? '  PASS' : '× FAIL'}  ${n}${e ? '   [' + e + ']' : ''}`);
  console.log('='.repeat(70));
  console.log(`筛选条布局回归：${R.length - fail.length} / ${R.length} 通过`);
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error('运行失败：', e.message); process.exit(1); });
