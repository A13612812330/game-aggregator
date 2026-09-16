/* tools/preview-v1013.js — v10.13 浏览器实拍 + 断言
 *
 * 验证四件事（对应本次四项改动）：
 *   ① 详情页首图**定高** —— 任何比例的封面都出同一块版（旧写法 128×128 会被撑到 720px）
 *   ② 详情页「配置要求」区块存在且有两栏（最低/推荐）—— XD 源站没数据也能从 Steam 补上
 *   ③ 详情页「手机模拟器配置」区块**常显**（未命中也有说明与入口），命中时铺出逐条游玩参数
 *   ④ 手机专区页签顺序：模拟器指南在最后；社区配置面板里有逐条参数卡
 *
 * 运行：node tools/preview-v1013.js       （需服务已在 8123 运行）
 * 产出：_preview/v1013-*.png
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://127.0.0.1:8123';
const OUT = path.join(__dirname, '..', '_preview');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function chk(name, ok, extra) {
  (ok ? pass++ : fail++);
  console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`);
}

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    args: ['--no-sandbox', '--window-size=1440,1100'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1100 });
  page.on('pageerror', (e) => { console.log('  [页面 JS 报错]', e.message); fail++; });

  /* ================= ① ② ③ 详情抽屉 ================= */
  /* xd-15924 幻世录（Steam 有配置）｜xd-5828 生化危机4（Steam 有配置）｜PES 走手游命中 */
  const CASES = [
    { id: 'xd-15924', name: '幻世录 重制版', needReq: true },
    { id: 'xd-5828', name: '生化危机4 重制版', needReq: true },
  ];

  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 60000 });
  await wait(2500);

  for (const c of CASES) {
    console.log(`\n=== 详情抽屉：${c.name} (${c.id}) ===`);
    const ok = await page.evaluate(async (id) => {
      if (typeof openDetailById !== 'function') return 'openDetailById 未定义';
      await openDetailById(id, '');
      await new Promise((r) => setTimeout(r, 5000));
      return 'ok';
    }, c.id);
    if (ok !== 'ok') { chk('打开详情', false, ok); continue; }

    const r = await page.evaluate(() => {
      const b = document.getElementById('drawerBody');
      const hero = b.querySelector('.d-hero');
      const img = hero ? hero.querySelector('img') : null;
      const heroH = hero ? Math.round(hero.getBoundingClientRect().height) : 0;
      const imgH = img ? Math.round(img.getBoundingClientRect().height) : 0;
      const imgW = img ? Math.round(img.getBoundingClientRect().width) : 0;
      const req = b.querySelector('#reqSlot .d-blk');
      const reqCols = b.querySelectorAll('#reqSlot .d-req .rc').length;
      const reqRows = b.querySelectorAll('#reqSlot .d-req .rr').length;
      const bh = b.querySelector('#bhSlot .d-blk');
      const bhParams = b.querySelectorAll('#bhSlot .d-param').length;
      const bhEmpty = b.querySelector('#bhSlot .d-req-empty');
      return {
        heroH, imgH, imgW,
        imgNatural: img ? img.naturalWidth + 'x' + img.naturalHeight : '',
        reqTitle: req ? req.querySelector('h4').textContent.replace(/\s+/g, ' ').trim() : '',
        reqCols, reqRows,
        reqCpu: (b.querySelector('#reqSlot .d-req .rr span') || {}).textContent || '',
        bhTitle: bh ? bh.querySelector('h4').textContent.replace(/\s+/g, ' ').trim() : '',
        bhParams, bhEmptyText: bhEmpty ? bhEmpty.textContent.replace(/\s+/g, ' ').trim().slice(0, 40) : '',
      };
    });

    console.log(`  首图：容器 ${r.heroH}px ｜ 图 ${r.imgW}×${r.imgH}px ｜ 原始 ${r.imgNatural}`);
    chk('首图容器定高 250px', r.heroH === 250, `实际 ${r.heroH}px`);
    chk('图片铺满容器（contain 不留白）', Math.abs(r.imgH - r.heroH) <= 1 && Math.abs(r.imgW - (r.imgW)) <= 1);
    chk('存在「配置要求」区块', !!r.reqTitle, r.reqTitle);
    chk('配置要求有 2 栏（最低+推荐）', r.reqCols === 2, `实际 ${r.reqCols} 栏 / ${r.reqRows} 行`);
    chk('配置要求有真实内容', r.reqRows >= 4, '首行 ' + String(r.reqCpu).slice(0, 30));
    chk('「手机模拟器配置」区块常显', !!r.bhTitle, r.bhTitle + (r.bhEmptyText ? ' ｜ 空态：' + r.bhEmptyText : ''));

    await shot(page, '#drawerBody .d-hero', path.join(OUT, 'v1013-hero-' + c.id + '.png')).catch(() => {});
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(OUT, 'v1013-detail-' + c.id + '.png') });
    await page.evaluate(() => { if (typeof closeDetail === 'function') closeDetail(); });
    await wait(700);
  }

  /* 命中手游库的条目：应从「手机模拟器配置」里铺出逐条参数 */
  console.log('\n=== 详情抽屉：手游库命中条目（应出现逐条游玩参数）===');
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await wait(2200);
  const pes = await page.evaluate(async () => {
    const r = await fetch('/api/mobilehub/list?sort=configs&limit=5&matched=1').then((x) => x.json());
    const hit = (r.items || []).find((x) => x.libId);
    if (!hit) return { err: '手游库里没有能对上端游库的样本' };
    await openDetailById(hit.libId, hit.libTitle || hit.name);
    await new Promise((res) => setTimeout(res, 9000));
    const b = document.getElementById('drawerBody');
    return {
      title: hit.libTitle || hit.name,
      bhTitle: (b.querySelector('#bhSlot h4') || {}).textContent || '',
      params: b.querySelectorAll('#bhSlot .d-param').length,
      chips: [...b.querySelectorAll('#bhSlot .d-param .kv')].slice(0, 8).map((x) => x.textContent.replace(/\s+/g, ' ').trim()),
      hasEmpty: !!b.querySelector('#bhSlot .d-req-empty'),
    };
  });
  if (pes.err) chk('手游库样本', false, pes.err);
  else {
    console.log('  样本：' + pes.title);
    console.log('  区块：' + pes.bhTitle.replace(/\s+/g, ' ').trim());
    console.log('  参数芯片：' + pes.chips.join(' ｜ '));
    chk('铺出逐条游玩参数卡', pes.params >= 1, `${pes.params} 张`);
    chk('参数含驱动/DXVK 等具体值', pes.chips.length >= 3);
  }
  await page.screenshot({ path: path.join(OUT, 'v1013-detail-bhparams.png') });

  /* ================= ④ 手机专区页签顺序 + 配置面板 ================= */
  console.log('\n=== 手机专区页签顺序 ===');
  await page.goto(BASE + '/emulator.html', { waitUntil: 'networkidle2', timeout: 60000 });
  await wait(2800);
  const tabs = await page.evaluate(() => [...document.querySelectorAll('#emuTabs .emu-tab')]
    .map((b) => ({ et: b.dataset.et, label: b.querySelector('span').textContent.trim() })));
  console.log('  ' + tabs.map((t) => t.label).join(' → '));
  chk('「模拟器指南」在最后一个', tabs[tabs.length - 1].et === 'eg', '末位=' + (tabs[tabs.length - 1] || {}).label);
  chk('「机型兼容」在指南之前', tabs[tabs.length - 2] && tabs[tabs.length - 2].et === 'dm');
  chk('共 5 个页签', tabs.length === 5, String(tabs.length));

  console.log('\n=== 社区配置面板（逐条参数）===');
  const panel = await page.evaluate(async () => {
    const r = await fetch('/api/mobilehub/list?sort=configs&limit=1&matched=1').then((x) => x.json());
    const it = (r.items || [])[0];
    if (!it || typeof openBhPanel !== 'function') return { err: '没有可用样本或函数缺失' };
    await openBhPanel((it.bhKeys || []).join(','), it.name || it.libTitle || '');
    await new Promise((res) => setTimeout(res, 9000));
    const b = document.getElementById('drawerBody');
    return {
      name: it.name, keys: (it.bhKeys || []).join(','),
      stats: [...b.querySelectorAll('.cf-stats .st')].map((x) => x.textContent.replace(/\s+/g, ' ').trim()).join(' / '),
      params: b.querySelectorAll('.cf-param').length,
      chips: [...b.querySelectorAll('.cf-param .kv')].slice(0, 10).map((x) => x.textContent.replace(/\s+/g, ' ').trim()),
      rows: b.querySelectorAll('.cf-table tbody tr').length,
    };
  });
  if (panel.err) chk('社区配置面板', false, panel.err);
  else {
    console.log('  样本：' + panel.name + '（键 ' + panel.keys + '）');
    console.log('  统计：' + panel.stats + '｜清单 ' + panel.rows + ' 行');
    console.log('  参数：' + panel.chips.join(' ｜ '));
    chk('面板内有逐条参数卡', panel.params >= 1, `${panel.params} 张`);
    chk('参数含具体值', panel.chips.length >= 3);
  }
  await page.screenshot({ path: path.join(OUT, 'v1013-bhpanel.png') });

  /* ================= ⑤ 模拟器指南：七节内容都要有字 =================
   * 背景：v10.13 之前「包装器 / 优化 / 避坑 / 帧率」四张表的字段名与渲染层不一致
   * （数据用 {t,d}/{c,e,why}/{g,f,s}，渲染读 name/desc），页面上只剩空加粗标签。
   * 这里逐条校验「每个 li 都有非空文本」。 */
  console.log('\n=== 模拟器指南（#eg）七节内容 ===');
  await page.goto(BASE + '/emulator.html', { waitUntil: 'networkidle2', timeout: 60000 });
  await wait(3000);
  /* 分区是懒加载：必须点一次页签才会拉 /api/emuguide */
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#emuTabs .emu-tab')].find((b) => b.dataset.et === 'eg');
    if (btn) btn.click();
  });
  await wait(2500);
  const eg = await page.evaluate(() => {
    const ids = ['egStack', 'egChips', 'egWrap', 'egTune', 'egAvoid', 'egVer', 'egBench'];
    const out = {};
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) { out[id] = { missing: true }; continue; }
      const items = [...el.children].map((x) => x.textContent.replace(/\s+/g, ' ').trim());
      out[id] = { n: items.length, empty: items.filter((t) => t.length < 6).length, sample: items[0] || '' };
    }
    return out;
  });
  for (const [id, v] of Object.entries(eg)) {
    if (v.missing) { chk(`${id} 存在`, false); continue; }
    chk(`${id} 有内容（${v.n} 条，空 ${v.empty} 条）`, v.n > 0 && v.empty === 0, String(v.sample).slice(0, 46));
  }
  await page.evaluate(() => document.querySelector('#egVer')?.scrollIntoView({ block: 'center' }));
  await wait(500);
  await page.screenshot({ path: path.join(OUT, 'v1013-emuguide.png'), fullPage: false });

  /* 窄屏：首图高度 + 配置要求并栏 */
  console.log('\n=== 窄屏 375 ===');
  await page.setViewport({ width: 375, height: 812, isMobile: true });
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await wait(2500);
  await page.evaluate(async () => { await openDetailById('xd-15924', ''); await new Promise((r) => setTimeout(r, 5000)); });
  const m = await page.evaluate(() => {
    const b = document.getElementById('drawerBody');
    const hero = b.querySelector('.d-hero');
    return {
      heroH: hero ? Math.round(hero.getBoundingClientRect().height) : 0,
      reqCols: getComputedStyle(b.querySelector('#reqSlot .d-req')).gridTemplateColumns.split(' ').length,
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  chk('窄屏首图 190px', m.heroH === 190, `实际 ${m.heroH}px`);
  chk('窄屏配置要求并成一栏', m.reqCols === 1, `${m.reqCols} 栏`);
  chk('窄屏无横向溢出', m.docOverflow <= 1, m.docOverflow + 'px');
  await page.screenshot({ path: path.join(OUT, 'v1013-detail-mobile.png') });

  await browser.close();
  console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
  console.log('截图目录：_preview/v1013-*.png');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('实拍失败:', e.message); process.exit(1); });

/** 先滚到元素再按包围盒截图 */
async function shot(page, sel, out) {
  const clip = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return null;
    return { x: Math.max(0, r.left), y: Math.max(0, r.top), width: r.width, height: r.height };
  }, sel);
  if (!clip) return;
  await page.screenshot({ path: out, clip });
}
