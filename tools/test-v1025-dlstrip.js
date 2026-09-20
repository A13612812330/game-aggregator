/* ★ v10.25 浏览器回归（第二层：真实浏览器 + CDP，手动分批跑）：⑥ 下载动作条三按钮。
 * 断言写在**页面内**（真实浏览器），每条都能被「打坏即变红」反证。
 *   node tools/test-v1025-dlstrip.js            # 默认 赛博朋克2077
 *   GAME=黑神话：悟空 node tools/test-v1025-dlstrip.js
 */
const path = require('path');
const fs = require('fs');
const { connectBrowser, newPage, sleep } = require('./browser');

const BASE = process.env.BASE || 'http://127.0.0.1:8123';
const GAME = process.env.GAME || '赛博朋克2077';
const OUT = path.join(__dirname, '..', '_preview');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const chk = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅', name); }
  else { fail++; console.log('  ❌', name, extra != null ? '— ' + extra : ''); }
};

/* 等待条件成立（避免固定 sleep 造成的假红/假绿） */
async function until(p, fn, ms = 15000, step = 250) {
  const t0 = Date.now();
  for (;;) {
    if (await p.evaluate(fn)) return true;
    if (Date.now() - t0 > ms) return false;
    await sleep(step);
  }
}

(async () => {
  const h = await connectBrowser();
  const p = await newPage(h.browser, { width: 1440, height: 1000 });

  await p.goto(BASE + '/index.html', { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1600);

  const pick = await p.evaluate(async (q) => {
    const j = await fetch('/api/library?q=' + encodeURIComponent(q)).then((r) => r.json());
    const it = (j.items || [])[0];
    return it ? { id: it.id, source: it.source, title: it.title, url: it.url, jidi: it.jidiUrl || '' } : null;
  }, GAME);
  console.log('样例:', JSON.stringify(pick));
  if (!pick) { console.log('❌ 库里找不到这款游戏'); await h.close(); process.exit(1); }

  await p.evaluate((g) => { window.openDetail(g.url, encodeURIComponent(g.jidi || ''), false); }, pick);
  await sleep(9000);   // 等懒加载区块（含 #dlSlot → setDlCounts 回填）

  console.log('\n=== ⑥ 下载动作条 ===');

  const st = await p.evaluate(() => {
    const strip = document.getElementById('dlStrip');
    if (!strip) return { err: 'no #dlStrip' };
    const b = (sel) => {
      const el = strip.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        vis: !el.hidden && cs.display !== 'none' && r.width > 0 && r.height > 0,
        w: Math.round(r.width), h: Math.round(r.height),
        top: Math.round(r.top),
        txt: (el.textContent || '').replace(/\s+/g, ' ').trim(),
        num: (el.querySelector('i') || {}).textContent || '',
        title: el.dataset.dlmodTitle || '', id: el.dataset.dlmodId || '',
        kind: el.dataset.dlmodOpen || '',
      };
    };
    const sr = strip.getBoundingClientRect();
    return {
      stripVis: !strip.hidden && sr.width > 0 && sr.height > 0,
      stripW: Math.round(sr.width), stripH: Math.round(sr.height),
      disp: getComputedStyle(strip).display,
      main: b('.ds-main'), mf: b('.ds-mf'), mo: b('.ds-mo'),
      /* 横向溢出：抽屉本身不该出现横向滚动条 */
      drawerOverflowX: (() => { const d = document.getElementById('drawer'); return d.scrollWidth - d.clientWidth; })(),
    };
  });
  if (st.err) { console.log('❌', st.err); await h.close(); process.exit(1); }

  chk('① .dl-strip 存在且真占版面（w>0 且 h>0）', st.stripVis, `w=${st.stripW} h=${st.stripH} display=${st.disp}`);
  chk('② 「下载本体」按钮可见且文案含「下载本体」', !!(st.main && st.main.vis && /下载本体/.test(st.main.txt)), st.main ? st.main.txt : '不存在');
  chk('③ 「修改器」按钮可见且数据属性 kind=modifier', !!(st.mf && st.mf.vis && st.mf.kind === 'modifier'), st.mf ? JSON.stringify({ vis: st.mf.vis, kind: st.mf.kind, txt: st.mf.txt }) : '不存在');
  chk('④ 「Mod」按钮可见且数据属性 kind=mod', !!(st.mo && st.mo.vis && st.mo.kind === 'mod'), st.mo ? JSON.stringify({ vis: st.mo.vis, kind: st.mo.kind, txt: st.mo.txt }) : '不存在');

  /* 按钮上的数字必须等于后端对**同一个检索串**算出的 counts —— 用按钮自己的
     data-dlmod-title / data-dlmod-id 复算，才能证明前端没有另算一套。 */
  const exp = await p.evaluate(async (t, id) => {
    const qs = [];
    if (id) qs.push('id=' + encodeURIComponent(id));
    if (t) qs.push('t=' + encodeURIComponent(t));
    const j = await fetch('/api/mods/match?' + qs.join('&')).then((r) => r.json());
    return { counts: j.counts || null, count: j.count };
  }, st.mo ? st.mo.title : '', st.mo ? st.mo.id : '');
  console.log('  后端 counts =', JSON.stringify(exp.counts));
  chk('⑤ 修改器按钮数字 == 后端 counts.modifier', !!(exp.counts && String(exp.counts.modifier) === String(st.mf && st.mf.num)), `${st.mf && st.mf.num} vs ${exp.counts && exp.counts.modifier}`);
  chk('⑥ Mod 按钮数字 == 后端 counts.mod', !!(exp.counts && String(exp.counts.mod) === String(st.mo && st.mo.num)), `${st.mo && st.mo.num} vs ${exp.counts && exp.counts.mod}`);
  chk('⑦ 三个按钮在同一行（offsetTop 相同）且不横向溢出',
    !!(st.main && st.mf && st.mo && st.main.top === st.mf.top && st.mf.top === st.mo.top && st.drawerOverflowX <= 0),
    `tops=${st.main && st.main.top}/${st.mf && st.mf.top}/${st.mo && st.mo.top} overflowX=${st.drawerOverflowX}`);

  /* ---- 点击「修改器」→ 弹窗铺列表 ---- */
  await p.evaluate(() => document.querySelector('#dlStrip .ds-mf').click());
  await until(p, () => {
    const b = document.getElementById('dlBody');
    return b && !b.querySelector('.dlpop-load') && b.textContent.trim().length > 0;
  }, 12000);
  const mfPop = await p.evaluate(() => {
    const pop = document.getElementById('dlPop');
    const b = document.getElementById('dlBody');
    const rows = b.querySelectorAll('.d-dl-it');
    const r0 = rows[0] ? rows[0].getBoundingClientRect() : null;
    return {
      open: !pop.hidden && pop.classList.contains('on'),
      title: document.getElementById('dlTitle').textContent,
      rows: rows.length,
      rowVis: !!(r0 && r0.width > 0 && r0.height > 0),
      first: rows[0] ? (rows[0].textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) : '',
      note: (b.querySelector('.dl-note') || {}).textContent || '',
      overflow: b.scrollWidth - b.clientWidth,
    };
  });
  chk('⑧ 点「修改器」→ 弹窗打开且标题含「修改器」', mfPop.open && /修改器/.test(mfPop.title), JSON.stringify({ open: mfPop.open, title: mfPop.title }));
  chk('⑨ 弹窗里真有帖子行（条数>0 且首行真占版面）', mfPop.rows > 0 && mfPop.rowVis, `rows=${mfPop.rows} rowVis=${mfPop.rowVis} first=${mfPop.first}`);
  chk('⑩ 弹窗正文无横向溢出', mfPop.overflow <= 0, `overflow=${mfPop.overflow}`);

  await p.evaluate(() => document.querySelector('#dlPop [data-dl="close"]').click());
  await sleep(400);

  /* ---- 点击「Mod」→ 弹窗铺列表 ---- */
  await p.evaluate(() => document.querySelector('#dlStrip .ds-mo').click());
  await until(p, () => {
    const b = document.getElementById('dlBody');
    return b && !b.querySelector('.dlpop-load') && b.textContent.trim().length > 0;
  }, 12000);
  const moPop = await p.evaluate(() => ({
    open: !document.getElementById('dlPop').hidden,
    title: document.getElementById('dlTitle').textContent,
    rows: document.getElementById('dlBody').querySelectorAll('.d-dl-it').length,
    first: (document.querySelector('#dlBody .d-dl-it') || {}).textContent || '',
  }));
  chk('⑪ 点「Mod」→ 弹窗打开、标题含「Mod」、行数>0', moPop.open && /Mod/.test(moPop.title) && moPop.rows > 0, JSON.stringify({ open: moPop.open, title: moPop.title, rows: moPop.rows }));

  await p.evaluate(() => document.querySelector('#dlPop [data-dl="close"]').click());
  await sleep(400);

  /* ---- 点击「下载本体」→ 原有弹窗链路不能被破坏 ---- */
  await p.evaluate(() => document.getElementById('dlBtn').click());
  await sleep(900);
  const dlOpen = await p.evaluate(() => ({
    open: !document.getElementById('dlPop').hidden,
    title: document.getElementById('dlTitle').textContent,
    body: document.getElementById('dlBody').textContent.slice(0, 40),
  }));
  chk('⑫ 点「下载本体」→ 弹窗打开（未破坏 v10.22 链路）', dlOpen.open, JSON.stringify(dlOpen));

  /* 等解析完成再截图（本体要跟随 302，XD 约 3-8 秒） */
  await until(p, () => {
    const b = document.getElementById('dlBody');
    return b && !b.querySelector('.dlpop-load');
  }, 25000);
  await p.screenshot({ path: path.join(OUT, 'check-dlstrip-popup.png') });

  await p.evaluate(() => document.querySelector('#dlPop [data-dl="close"]').click());
  await sleep(400);

  /* 底部动作区截图（含三个按钮） */
  await p.evaluate(() => {
    const s = document.getElementById('dlStrip');
    s.scrollIntoView({ block: 'center' });
  });
  await sleep(700);
  await p.screenshot({ path: path.join(OUT, 'check-dlstrip.png') });

  console.log('\n============================');
  console.log(`  通过 ${pass}/${pass + fail}（失败 ${fail}）`);
  console.log('============================');
  await h.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
