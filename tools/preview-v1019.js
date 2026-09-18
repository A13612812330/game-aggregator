/* tools/preview-v1019.js — v10.19「模拟器指南模块化」实拍 + 断言
 *
 * 本轮修的是三个根因（用户原话：「模拟器指南这个页面太乱了，我需要你模块化显示」）：
 *   ① `var(--c-line)` 在 public/index.html 里**从未定义** → 所有 .eg-* 卡片的
 *      `border:1px solid var(--c-line)` 整条声明失效 → 边框全丢（12 处）
 *   ② 渲染层类名与 CSS **完全脱节**：emulator-sections.js 渲染的 .eg-n / .eg-tx /
 *      .eg-sub / .eg-key / .eg-ch-h / .eg-tier / .eg-ch-b / .eg-ch-note / .eg-list
 *      在 CSS 里**一个都不存在**；而 CSS 精心写好的 .no/.bd/.nm/.sb/.ds/.flag、
 *      .hd/.gen/.tag/.soc/.drv/.nt、.eg-tbl、.eg-tune、.eg-av **全部没被用**。
 *      后果：④优化 ⑥版本 ⑦帧率 退化成浏览器默认圆点列表 = 一坨文字。
 *   ③ 7 个模块平铺、无导航、无卡片边界 → 页面被拉成一整条，找不到"我要看哪一节"。
 *
 * ★★ 断言原则（本项目已多次踩到「假绿」）：
 *    不只看「元素在不在」，一律读 getComputedStyle。
 *    「元素存在但样式落空」正是本轮要修的 bug —— 只断言存在性会 100% 假绿通过。
 *
 * 运行：node tools/preview-v1019.js      （需服务已在 8123 运行）
 * 产出：_preview/v1019-*.png
 */
const fs = require('fs');
const path = require('path');
const { connectBrowser, newPage } = require('./browser');

const BASE = process.env.EMU_BASE || 'http://127.0.0.1:8123';
const OUT = path.join(__dirname, '..', '_preview');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function chk(name, ok, extra) {
  (ok ? pass++ : fail++);
  console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`);
}

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const h = await connectBrowser();
  const page = await newPage(h.browser, { width: 1440, height: 1100 });
  page.on('pageerror', (e) => { console.log('  [页面 JS 报错]', e.message); fail++; });

  await page.goto(BASE + '/emulator.html', { waitUntil: 'networkidle2', timeout: 60000 });
  await wait(2500);
  /* 分区懒加载：必须点一次页签才会拉 /api/emuguide */
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('#emuTabs .emu-tab')].find((x) => x.dataset.et === 'eg');
    if (b) b.click();
  });
  await wait(2500);

  /* ============ A. 模块导航（解决根因③） ============ */
  console.log('\n=== A. 顶部模块导航 ===');
  const nav = await page.evaluate(() => {
    const n = document.getElementById('egNav');
    if (!n) return { missing: true };
    const a = [...n.querySelectorAll('a')];
    const cs = getComputedStyle(n);
    const r = n.getBoundingClientRect();
    return {
      n: a.length,
      sticky: cs.position,
      hrefs: a.map((x) => x.getAttribute('href')),
      onCount: a.filter((x) => x.classList.contains('on')).length,
      h: Math.round(r.height),
    };
  });
  chk('导航条存在', !nav.missing);
  chk('导航恰好 7 个模块', nav.n === 7, `实际 ${nav.n}`);
  chk('导航吸顶（sticky）', nav.sticky === 'sticky', nav.sticky);
  chk('导航真占版面（高>0，非隐藏）', nav.h > 0, nav.h + 'px');
  chk('默认恰好 1 个高亮', nav.onCount === 1, `${nav.onCount} 个`);
  chk('7 个 href 一一对应模块',
    nav.hrefs.join(',') === '#egS1,#egS2,#egS3,#egS4,#egS5,#egS6,#egS7', nav.hrefs.join(','));

  /* ============ B. 模块卡片 + 根因①回归（边框必须真的在） ============ */
  console.log('\n=== B. 模块卡片（var(--c-border) 回归） ===');
  const cards = await page.evaluate(() => {
    const out = [];
    for (let i = 1; i <= 7; i++) {
      const el = document.getElementById('egS' + i);
      if (!el) { out.push({ id: i, missing: true }); continue; }
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      out.push({
        id: i,
        bw: parseFloat(cs.borderTopWidth),
        bc: cs.borderTopColor,
        radius: parseFloat(cs.borderTopLeftRadius),
        w: Math.round(r.width), hgt: Math.round(r.height),
        no: !!el.querySelector('h3 .eg-no'),
      });
    }
    return out;
  });
  for (const c of cards) {
    if (c.missing) { chk(`模块 #egS${c.id} 存在`, false); continue; }
    /* 根因①：修复前 bw 恒为 0（变量未定义 → 整条 border 失效） */
    chk(`#egS${c.id} 卡片边框真的在`, c.bw >= 1, `border-top ${c.bw}px ${c.bc}`);
    chk(`#egS${c.id} 圆角卡片化`, c.radius >= 8, `${c.radius}px`);
    chk(`#egS${c.id} 真占版面`, c.w > 300 && c.hgt > 40, `${c.w}×${c.hgt}`);
    chk(`#egS${c.id} 有序号徽章`, c.no);
  }

  /* ============ C. 根因②回归：类名必须与 CSS 对得上，且有真实样式 ============ */
  console.log('\n=== C. 类名对齐 + 样式落地（根因②回归） ===');
  const cls = await page.evaluate(() => {
    const probe = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return { n: 0, fs: 0 };
      return { n: document.querySelectorAll(sel).length, fs: parseFloat(getComputedStyle(el).fontSize) };
    };
    const li = document.querySelector('#egTune li');
    const tr = document.querySelector('#egWrap .tr:not(.hd)');
    return {
      lyNo: probe('#egStack .eg-ly .no'),
      lyNm: probe('#egStack .eg-ly .bd .nm'),
      lyDs: probe('#egStack .eg-ly .bd .ds'),
      lyFlag: probe('#egStack .eg-ly .flag'),
      chipGen: probe('#egChips .eg-chip .hd .gen'),
      chipTag: probe('#egChips .eg-chip .hd .tag'),
      chipDrv: probe('#egChips .eg-chip .drv .ln'),
      chipNt: probe('#egChips .eg-chip .nt'),
      tuneBox: probe('#egTune.eg-tune'),
      tuneLiFs: li ? parseFloat(getComputedStyle(li).fontSize) : 0,
      tuneBefore: li ? getComputedStyle(li, '::before').content : '',
      avBox: probe('#egAvoid.eg-avoid'),
      avNm: probe('#egAvoid .eg-av .nm'),
      wrapTbl: probe('#egWrap.eg-tbl.w2c'),
      trCols: tr ? getComputedStyle(tr).gridTemplateColumns.split(' ').filter(Boolean).length : 0,
      /* 修复前这里会是 5+4+6+8 = 23 个「孤儿」 .eg-list */
      orphanList: document.querySelectorAll('.eg-list').length,
    };
  });
  chk('#egStack .eg-ly .no × 5 且有样式', cls.lyNo.n === 5 && cls.lyNo.fs >= 11, `${cls.lyNo.n} 个 · ${cls.lyNo.fs}px`);
  chk('#egStack .eg-ly .bd .nm × 5 且有样式', cls.lyNm.n === 5 && cls.lyNm.fs >= 12, `${cls.lyNm.n} 个 · ${cls.lyNm.fs}px`);
  chk('#egStack .eg-ly .bd .ds × 5 且有样式', cls.lyDs.n === 5 && cls.lyDs.fs >= 11, `${cls.lyDs.n} 个 · ${cls.lyDs.fs}px`);
  chk('#egStack .eg-ly .flag（关键徽标）存在', cls.lyFlag.n >= 1, `${cls.lyFlag.n} 个`);
  chk('#egChips .hd .gen × 5 且有样式', cls.chipGen.n === 5 && cls.chipGen.fs >= 12, `${cls.chipGen.n} 个 · ${cls.chipGen.fs}px`);
  chk('#egChips .hd .tag × 5（世代/难度标签）', cls.chipTag.n === 5, `${cls.chipTag.n} 个`);
  chk('#egChips .drv .ln 驱动行存在且有样式', cls.chipDrv.n >= 5 && cls.chipDrv.fs >= 11, `${cls.chipDrv.n} 个 · ${cls.chipDrv.fs}px`);
  chk('#egChips .nt 说明行存在且有样式', cls.chipNt.n === 5 && cls.chipNt.fs >= 11, `${cls.chipNt.n} 个 · ${cls.chipNt.fs}px`);
  chk('#egTune 用 .eg-tune 容器', cls.tuneBox.n === 1, `${cls.tuneBox.n} 个`);
  chk('优化清单条目有样式（非裸 li）', cls.tuneLiFs >= 11, `${cls.tuneLiFs}px`);
  chk('优化清单有 CSS 自动序号（::before counter）', /counter/.test(cls.tuneBefore), cls.tuneBefore);
  chk('#egAvoid 用 .eg-avoid 网格容器', cls.avBox.n === 1, `${cls.avBox.n} 个`);
  chk('#egAvoid .eg-av 避坑卡 × 5', cls.avNm.n === 5, `${cls.avNm.n} 个`);
  chk('#egWrap 是 .eg-tbl.w2c 表格', cls.wrapTbl.n === 1, `${cls.wrapTbl.n} 个`);
  chk('#egWrap 每行两列 grid', cls.trCols >= 2, `${cls.trCols} 列`);
  chk('页面已无失效的 .eg-list 孤儿类', cls.orphanList === 0, `残留 ${cls.orphanList} 个`);

  /* ============ D. 七个模块都有真内容（根因②最容易掩盖的地方） ============ */
  console.log('\n=== D. 七个模块的内容条数 ===');
  /* 这里写**数据条数**（对应 data/emuguide.js 的 STACK/CHIPS/WRAPPERS/TUNING/AVOID/
     VERSIONS/BENCH）。③⑥⑦ 本轮改成了表格容器，会多渲染 1 行表头，故 +1 后比较。
     ⚠️ 首版这里写成了「含表头的总数」又 +1，三条全假红 —— 断言写错和产品出错要分清。 */
  const EXP = { egStack: 5, egChips: 5, egWrap: 4, egTune: 9, egAvoid: 5, egVer: 6, egBench: 8 };
  const cnt = await page.evaluate(() => {
    const out = {};
    for (const id of ['egStack', 'egChips', 'egWrap', 'egTune', 'egAvoid', 'egVer', 'egBench']) {
      const el = document.getElementById(id);
      out[id] = el ? [...el.children].filter((x) => x.textContent.trim().length >= 6).length : -1;
    }
    return out;
  });
  for (const [id, want] of Object.entries(EXP)) {
    /* egWrap / egVer / egBench 改成了表格：内容行 + 1 行表头 */
    const listLike = id === 'egTune' || id === 'egAvoid' || id === 'egStack' || id === 'egChips';
    const got = cnt[id];
    const ok = listLike ? got === want : got === want + 1;
    chk(`${id} 内容 ${want} 条${listLike ? '' : '（+1 表头）'}`, ok, `实际 ${got}`);
  }

  /* ============ E. 导航交互：点击真的会跳 + 高亮跟随 ============ */
  console.log('\n=== E. 导航交互 ===');
  const before = await page.evaluate(() => Math.round(window.pageYOffset));
  /* 点击后连续采样 —— 只报「0 → 0」分不清是「压根没滚」还是「滚了又被拉回」 */
  const trace = await page.evaluate(async () => {
    document.querySelector('#egNav a[href="#egS5"]').click();
    const ys = [];
    for (let i = 0; i < 8; i++) { await new Promise((r) => setTimeout(r, 200)); ys.push(Math.round(window.pageYOffset)); }
    return ys;
  });
  await wait(400);
  const jump = await page.evaluate(() => {
    const a = document.querySelector('#egNav a[href="#egS5"]');
    const onA = document.querySelector('#egNav a.on');
    const t = document.getElementById('egS5');
    return {
      on: a.classList.contains('on'),
      /* 失败时把「高亮实际停在哪一节」打出来 —— 只报 true/false 定位不到根因 */
      onHref: onA ? onA.getAttribute('href') : '(无高亮)',
      top: Math.round(t.getBoundingClientRect().top),
      y: Math.round(window.scrollY),
    };
  });
  chk('点击导航后高亮切到该模块', jump.on, `当前高亮 ${jump.onHref}`);
  chk('点击导航后页面确实滚动了', jump.y !== before, `${before} → ${jump.y} · 轨迹 ${trace.join(',')}`);
  chk('目标模块滚到视口内（未被吸顶导航遮死）', jump.top >= -24 && jump.top <= 240, `top=${jump.top}px`);
  /* ★ 本轮实拍抓到的真 bug：.eg-nav 原来写 top:0，被 .topbar(position:sticky;z-index:60)
     完全盖住 —— 元素在、position 是 sticky、前面所有断言全绿，但**用户根本看不见它**。
     所以必须断言「导航条上沿不高于顶栏下沿」。只断言「存在 / sticky」是抓不到这类问题的。 */
  const layered = await page.evaluate(() => {
    const n = document.getElementById('egNav');
    const tb = document.querySelector('.topbar');
    const nr = n.getBoundingClientRect();
    const tr = tb.getBoundingClientRect();
    return {
      navTop: Math.round(nr.top), tbBottom: Math.round(tr.bottom),
      h: Math.round(nr.height),
    };
  });
  chk('导航条吸在顶栏下方（未被顶栏遮挡）', layered.navTop >= layered.tbBottom - 2,
    `导航 top=${layered.navTop} · 顶栏 bottom=${layered.tbBottom}`);
  chk('导航条确实落在视口内', layered.navTop >= 0 && layered.navTop < 260,
    `top=${layered.navTop}px · 高 ${layered.h}px`);
  await page.screenshot({ path: path.join(OUT, 'v1019-emuguide-nav-jump.png') });

  /* ============ F. 版面健康度 ============ */
  console.log('\n=== F. 版面健康度 ===');
  await page.evaluate(() => document.querySelector('#egS1')?.scrollIntoView({ block: 'start' }));
  await wait(600);
  const health = await page.evaluate(() => ({
    over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    navOver: (() => { const n = document.getElementById('egNav'); return n ? n.scrollWidth - n.clientWidth : 0; })(),
  }));
  chk('桌面 1440 无横向溢出', health.over <= 1, health.over + 'px');
  await page.screenshot({ path: path.join(OUT, 'v1019-emuguide-desktop.png'), fullPage: false });
  await page.evaluate(() => document.querySelector('#egS7')?.scrollIntoView({ block: 'start' }));
  await wait(600);
  await page.screenshot({ path: path.join(OUT, 'v1019-emuguide-bench.png'), fullPage: false });

  /* ============ G. 窄屏 375 ============ */
  console.log('\n=== G. 窄屏 375 ===');
  await page.setViewport({ width: 375, height: 812, isMobile: true });
  await page.goto(BASE + '/emulator.html', { waitUntil: 'networkidle2' });
  await wait(2200);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('#emuTabs .emu-tab')].find((x) => x.dataset.et === 'eg');
    if (b) b.click();
  });
  await wait(2200);
  const mob = await page.evaluate(() => {
    const n = document.getElementById('egNav');
    const s1 = document.getElementById('egS1');
    return {
      over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      navScrollable: n ? n.scrollWidth > n.clientWidth : false,
      navH: n ? Math.round(n.getBoundingClientRect().height) : 0,
      cardW: s1 ? Math.round(s1.getBoundingClientRect().width) : 0,
    };
  });
  chk('窄屏无横向溢出', mob.over <= 1, mob.over + 'px');
  chk('窄屏导航可横向滚动（未撑破页面）', mob.navH > 0, `nav ${mob.navH}px`);
  chk('窄屏模块卡自适应宽度', mob.cardW > 200 && mob.cardW <= 375, mob.cardW + 'px');
  await page.screenshot({ path: path.join(OUT, 'v1019-emuguide-mobile.png') });

  await h.close();
  console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
  console.log('截图：_preview/v1019-*.png');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('实拍失败:', e.message); process.exit(1); });
