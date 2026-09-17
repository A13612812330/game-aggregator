/* tools/preview-v1015.js — v10.15 浏览器实拍 + 断言
 *
 * 验证五项改动在**真实浏览器 + 真实数据**下的效果：
 *   ① 跨源按钮：查到另一源详情页才显示，查不到**不显示**（不再退到站内搜索页）
 *   ② 手游专区详情页：手机配置块里能看到「本站实测记录」的实际内容
 *   ③ 搜索弹窗：状态条 / 底部按键条 / 四库速览 三块新版式落地
 *   ④ 手机配置展示：机型清单按性能分升序 + 门槛机型可辨识 + 参数卡重点分层
 *   ⑤ 评分去重：详情页「玩家评分」全文只出现一次
 *
 * 运行：node tools/preview-v1015.js     （需服务在 8123 运行）
 * 产出：_preview/v1015-*.png
 *
 * ★ 浏览器获取方式（本机环境约定）：
 *   Edge 在本会话被沙箱拦（进程直接消失、连 --version 都没输出），Chrome 可用。
 *   所以这里**优先连已存在的 CDP 端口**，没有再自己拉起 Chrome —— 这样脚本
 *   既能复用现成实例，也不依赖 puppeteer 自己的启动器（它的 spawn 会被拦）。
 */
const fs = require('fs');
const path = require('path');
const { connectBrowser, sleep } = require('./browser');

const BASE = process.env.BASE || 'http://127.0.0.1:8123/';
const OUT = path.join(__dirname, '..', '_preview');

let pass = 0, fail = 0;
function chk(name, ok, extra) {
  (ok ? pass++ : fail++);
  console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`);
}

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  /* 浏览器获取统一走 tools/browser.js —— Edge 在本会话被沙箱拦，那里会自动改用
     「外部拉起 Chrome + 连 CDP 端口」这条可行路径。 */
  const H = await connectBrowser();
  const b = H.browser;

  /* ================= 主站 ================= */
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await p.waitForSelector('#drawer', { timeout: 20000 });
  await sleep(900);

  // 样本：两源都有收录 / 只有一端收录（离线核过）
  const CROSS_POS = { id: 'xd-5828', name: '生化危机4（两源都有）', want: '/topic/detail/' };
  const CROSS_NEG = { id: 'jidi-976417160', name: '极限竞速：地平线6（单源）' };
  const MOBILE_FULL = { id: 'xd-233', name: '看门狗（社区配置 + 实测记录都有）' };

  async function openAndSettle(id) {
    await p.evaluate((x) => window.openDetailById(x), id);
    await p.waitForFunction(() => {
      const s = document.getElementById('crossSrc');
      return s && !/正在检查另一源收录/.test(s.textContent || '');
    }, { timeout: 30000 }).catch(() => {});
    await sleep(3200);
  }

  console.log('\n=== ① 跨源按钮：有详情页才显示 ===');
  await openAndSettle(CROSS_POS.id);
  let s = await p.evaluate(() => {
    const g = document.getElementById('crossGo');
    const box = document.querySelector('.d-actions');
    const own = document.querySelector('.d-actions > a.go:not([hidden])');
    return {
      hidden: g.hasAttribute('hidden'),
      href: g.getAttribute('href') || '',
      text: (g.textContent || '').trim(),
      cols: getComputedStyle(box).gridTemplateColumns,
      visCount: [...document.querySelectorAll('.d-actions > a.go')].filter((a) => !a.hasAttribute('hidden')).length,
      ownHref: own ? own.getAttribute('href') : '',
    };
  });
  chk(`[${CROSS_POS.name}] 跨源按钮显示`, s.hidden === false, s.text);
  chk(`[${CROSS_POS.name}] 落点是另一源**详情页**（不是首页/搜索页）`,
    /\/topic\/detail\/\d+/.test(s.href), s.href);
  chk(`[${CROSS_POS.name}] 两个按钮都在 → 仍为两列`, s.visCount === 2 && s.cols.split(' ').length === 2, s.cols);
  chk(`[${CROSS_POS.name}] 第一个按钮是本源详情页`, /xdgame\.com\/game\/\d+\.html/.test(s.ownHref), s.ownHref);
  await p.screenshot({ path: path.join(OUT, 'v1015-cross-pos.png'), clip: { x: 900, y: 0, width: 540, height: 1100 } });

  await openAndSettle(CROSS_NEG.id);
  s = await p.evaluate(() => {
    const g = document.getElementById('crossGo');
    const box = document.querySelector('.d-actions');
    const vis = [...document.querySelectorAll('.d-actions > a.go')].filter((a) => !a.hasAttribute('hidden'));
    return {
      hidden: g.hasAttribute('hidden'),
      href: g.getAttribute('href') || '(无)',
      visCount: vis.length,
      cols: getComputedStyle(box).gridTemplateColumns,
      crossSrcText: (document.getElementById('crossSrc').textContent || '').trim(),
    };
  });
  chk(`[${CROSS_NEG.name}] 另一源无详情页 → 跨源按钮**不显示**`, s.hidden === true);
  chk(`[${CROSS_NEG.name}] 按钮上没有残留的搜索页 href`, !/search/.test(s.href), s.href);
  chk(`[${CROSS_NEG.name}] 只剩一个按钮 → 自动铺满一行`, s.visCount === 1 && s.cols.split(' ').length === 1, s.cols);
  chk(`[${CROSS_NEG.name}] 「另一源也有收录」区块为空`, s.crossSrcText === '', JSON.stringify(s.crossSrcText));

  console.log('\n=== ④ 手机配置展示：机型清单排序 + 门槛 ===');
  await openAndSettle(MOBILE_FULL.id);
  const dev = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('#bhDevSlot .d-devlist .dv')];
    const real = rows.filter((r) => !r.classList.contains('more'));
    const scores = real.map((r) => { const e = r.querySelector('em'); return e ? Number(e.textContent) : null; });
    return {
      n: real.length,
      scores,
      gates: rows.filter((r) => r.classList.contains('gate')).length,
      gateScore: (document.querySelector('#bhDevSlot .dv.gate em') || {}).textContent || '',
      gateLine: (document.querySelector('#bhGate .bh-gate') || {}).innerText || '',
      cols: getComputedStyle(document.querySelector('#bhDevSlot .d-devlist')).gridTemplateColumns,
      widths: real.slice(0, 3).map((r) => Math.round(r.getBoundingClientRect().width)),
      overflow: real.some((r) => r.scrollWidth > r.clientWidth + 2),
      moreRow: (document.querySelector('#bhDevSlot .dv.more') || {}).textContent || '',
    };
  });
  const known = dev.scores.filter((x) => x !== null);
  const asc = known.every((v, i) => i === 0 || known[i - 1] <= v);
  chk('机型清单有内容', dev.n > 0, `${dev.n} 条`);
  chk('机型清单按性能分**升序**（弱的在前）', asc, known.join(' ≤ '));
  chk('恰好一台标为门槛机型', dev.gates === 1, dev.gateScore);
  chk('门槛机型就是分数最低的那台', Number(dev.gateScore) === Math.min(...known), `${dev.gateScore} vs min ${Math.min(...known)}`);
  chk('门槛小结行有说明文字', /这台实测跑通了/.test(dev.gateLine), dev.gateLine.replace(/\s+/g, ' ').slice(0, 70));
  chk('机型清单为两列网格', dev.cols.split(' ').length === 2, dev.cols);
  chk('机型行没有横向溢出', dev.overflow === false);
  chk('机型行真的占了版面（宽 > 100px）', dev.widths.every((w) => w > 100), dev.widths.join('/'));

  console.log('\n=== ② 手游专区详情页：本站实测记录可见 ===');
  const rec = await p.evaluate(() => {
    const slot = document.getElementById('bhRecSlot');
    const rows = [...document.querySelectorAll('#bhRecSlot .pc-rec .r')];
    return {
      sub: (document.querySelector('#bhRecSlot .bh-sub') || {}).innerText || '',
      rows: rows.length,
      first: rows.length ? rows[0].innerText.replace(/\n+/g, ' | ') : '',
      hasPill: !!document.querySelector('#bhRecSlot .pc-rec .pill.ok, #bhRecSlot .pc-rec .pill.no'),
      kvCount: document.querySelectorAll('#bhRecSlot .pc-rec .kv-i').length,
      tag: [...document.querySelectorAll('#bhSlot .d-tg-row .d-tg')].map((x) => x.textContent.trim()),
    };
  });
  chk('「本站实测 N 条」标签存在（前提）', rec.tag.some((t) => /本站实测/.test(t)), rec.tag.join(' / '));
  chk('实测记录区渲染出条目', rec.rows > 0, `${rec.rows} 条`);
  chk('每条带「可玩 / 不可玩」标记', rec.hasPill === true);
  chk('每条带可抄的参数（兼容层/驱动/DXVK…）', rec.kvCount >= 3, `${rec.kvCount} 个参数项`);
  chk('小节标题写明条数', /本站实测记录/.test(rec.sub) && /\d+\s*条/.test(rec.sub), rec.sub.replace(/\s+/g, ' '));
  console.log('    首条:', rec.first.slice(0, 140));
  await p.screenshot({ path: path.join(OUT, 'v1015-mobile-full.png'), clip: { x: 900, y: 0, width: 540, height: 1100 } });

  console.log('\n=== ⑤ 评分去重 ===');
  const sc = await p.evaluate(() => {
    const t = document.getElementById('drawerBody').innerText || '';
    return {
      hits: (t.match(/玩家评分/g) || []).length,
      kvScoreRows: [...document.querySelectorAll('.kv .it')].filter((x) => /评分/.test(x.innerText)).length,
      scoreLine: (document.querySelector('.score-line') || {}).innerText || '',
      hasBig: !!document.querySelector('.score-big'),
      metaHtml: (document.querySelector('.score-meta') || {}).innerHTML || '',
    };
  });
  chk('「玩家评分」全页只出现一次', sc.hits === 1, `${sc.hits} 次`);
  chk('信息表里不再有「玩家评分」行', sc.kvScoreRows === 0, `${sc.kvScoreRows} 行`);
  chk('大号分数仍在（视觉锚点没被删）', sc.hasBig && /\d/.test(sc.scoreLine), sc.scoreLine.replace(/\s+/g, ' '));

  console.log('\n=== ③ 搜索弹窗新版式 ===');
  await p.evaluate(() => { document.getElementById('drawer').classList.remove('show'); document.getElementById('mask').classList.remove('show'); unlockBody(); });
  await sleep(400);
  await p.evaluate(() => openSearch());
  await sleep(1600);
  const sm = await p.evaluate(() => {
    const m = document.getElementById('smodal');
    const r = m.getBoundingClientRect();
    const hint = document.querySelector('.sm-hint');
    const foot = document.querySelector('.sm-foot');
    const tiles = [...document.querySelectorAll('.sm-stat .st')];
    return {
      w: Math.round(r.width), h: Math.round(r.height),
      hintKbd: hint.querySelectorAll('kbd').length,
      hintText: hint.innerText.replace(/\s+/g, ' ').trim(),
      foot: foot ? foot.innerText.replace(/\s+/g, ' ').trim() : '(无)',
      footKbd: foot ? foot.querySelectorAll('kbd').length : 0,
      footGroups: foot ? foot.querySelectorAll('span:not(.rt)').length : 0,
      tiles: tiles.map((t) => ({ n: t.querySelector('b').textContent.trim(), lb: t.querySelector('span').textContent.trim() })),
      emptyBlocks: document.querySelectorAll('.sm-body .sm-empty').length,
      chips: document.querySelectorAll('.sm-quick button').length,
      tip: !!document.querySelector('.sm-tip'),
      bodyH: Math.round(document.getElementById('smBody').getBoundingClientRect().height),
      scrollOver: document.getElementById('smodal').scrollHeight > document.getElementById('smodal').clientHeight + 2,
      statW: tiles.length ? Math.round(tiles[0].getBoundingClientRect().width) : 0,
    };
  });
  chk('顶部状态条不再塞键盘按键', sm.hintKbd === 0, sm.hintText);
  chk('状态条讲清「四个库一次搜完」', /四.*库|端游/.test(sm.hintText), sm.hintText);
  chk('底部按键条存在且三组提示（↑↓ / Enter / Esc）', sm.footGroups === 3 && sm.footKbd === 4,
    `组=${sm.footGroups} kbd=${sm.footKbd}`);
  chk('底部按键条写明「看完详情自动回到这里」', /自动回到这里/.test(sm.foot));
  chk('四库速览 4 块', sm.tiles.length === 4, sm.tiles.map((t) => `${t.lb}${t.n}`).join(' '));
  chk('速览数字都是真实非零值', sm.tiles.every((t) => Number(t.n.replace(/,/g, '')) > 100), sm.tiles.map((t) => t.n).join('/'));
  chk('初始态不再用「放大镜占位」空态', sm.emptyBlocks === 0);
  chk('热门搜索 chips 仍在', sm.chips >= 8, `${sm.chips} 个`);
  chk('有口径说明条', sm.tip === true);
  chk('速览卡片真的占了版面（宽 > 100px）', sm.statW > 100, `${sm.statW}px`);
  chk('弹窗内容不溢出（无内层滚动条）', sm.scrollOver === false, `h=${sm.h} body=${sm.bodyH}`);
  await p.screenshot({ path: path.join(OUT, 'v1015-search-home.png') });

  await p.evaluate(() => { const i = document.getElementById('searchInput'); i.focus(); });
  await p.keyboard.type('看门狗', { delay: 55 });
  await sleep(2200);
  const sm2 = await p.evaluate(() => ({
    secs: [...document.querySelectorAll('#smBody .sm-sec')].map((x) => x.innerText.replace(/\s+/g, ' ').trim()),
    rows: document.querySelectorAll('#smBody .sm-row').length,
    footStill: !!document.querySelector('.sm-foot'),
  }));
  chk('输入后仍保留底部按键条', sm2.footStill === true);
  chk('输入后出结果分组', sm2.secs.length > 0, sm2.secs.slice(0, 3).join(' | '));
  await p.screenshot({ path: path.join(OUT, 'v1015-search-typing.png') });

  /* ================= 手游专区（派生页）同步 ================= */
  console.log('\n=== 派生页 emulator.html 同步 ===');
  const p2 = await b.newPage();
  await p2.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 });
  const errs2 = [];
  p2.on('pageerror', (e) => errs2.push(e.message));
  await p2.goto(BASE + 'emulator.html', { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(2500);
  const emu = await p2.evaluate(async () => {
    const btn = document.querySelector('#emuGrid .cov-btn[data-lib]');
    if (!btn) return { noCard: true };
    const lib = btn.dataset.lib;
    btn.click();
    await new Promise((r) => setTimeout(r, 4000));
    const rows = [...document.querySelectorAll('#bhRecSlot .pc-rec .r')];
    return {
      lib,
      hasRecSlot: !!document.getElementById('bhRecSlot'),
      recRows: rows.length,
      devRows: document.querySelectorAll('#bhDevSlot .d-devlist .dv').length,
      gate: !!document.querySelector('#bhGate .bh-gate'),
      crossHidden: document.getElementById('crossGo').hasAttribute('hidden'),
      smFoot: !!document.querySelector('.sm-foot'),
      drawerText: (document.getElementById('drawerBody').innerText || '').slice(0, 120),
    };
  });
  chk('派生页有实测记录槽位', emu.hasRecSlot === true);
  chk('派生页详情页能看到实测记录内容', emu.recRows > 0, `${emu.recRows} 条（lib=${emu.lib}）`);
  chk('派生页机型清单 + 门槛行已同步', emu.devRows > 0 && emu.gate === true, `${emu.devRows} 条`);
  chk('派生页搜索弹窗新版式已同步', emu.smFoot === true);
  await p2.screenshot({ path: path.join(OUT, 'v1015-emulator-detail.png') });

  console.log('\n页面错误:', errs.length || errs2.length ? [...errs, ...errs2].slice(0, 4) : '(无)');
  chk('两个页面都没有 JS 报错', errs.length === 0 && errs2.length === 0);

  console.log(`\n结果：${pass} / ${pass + fail} 通过，${fail} 失败`);
  for (const pg of await b.pages()) { try { await pg.close(); } catch (e) {} }
  await H.close();          // spawned 时顺手收掉自己拉起的浏览器
  process.exit(fail ? 1 : 0);
})();
