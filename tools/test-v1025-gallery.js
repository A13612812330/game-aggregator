/* ★ v10.25 浏览器回归（第二层：真实浏览器 + CDP，手动分批跑）：v10.25 画廊是否真的渲染 + 能翻页。 */
const path = require('path');
const fs = require('fs');
const { connectBrowser, newPage, sleep } = require('./browser');

const BASE = process.env.BASE || 'http://127.0.0.1:8123';
const OUT = path.join(__dirname, '..', '_preview');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const ok = (c, name, extra) => {
  if (c) { pass++; console.log('  ✅ ' + name + (extra ? '  ｜ ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  ｜ ' + extra : '')); }
};

(async () => {
  const h = await connectBrowser();
  const p = await newPage(h.browser, { width: 1440, height: 1000 });
  await p.goto(BASE + '/index.html', { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1500);

  const g = await p.evaluate(async () => {
    const r = await fetch('/api/library?q=' + encodeURIComponent('艾尔登'));
    const j = await r.json();
    const it = (j.items || [])[0];
    return it ? { url: it.url, title: it.title } : null;
  });
  console.log('样例:', JSON.stringify(g));
  await p.evaluate((u) => window.openDetail(u, '', false), g.url);
  await sleep(8000);

  const m = await p.evaluate(() => {
    const gal = document.querySelector('#drawerBody .gal');
    if (!gal) return { found: false };
    const vp = gal.querySelector('.gal-vp');
    const imgs = [...gal.querySelectorAll('.gal-sld img')];
    const thumbs = [...gal.querySelectorAll('.gal-th')];
    const loaded = imgs.filter((i) => i.naturalWidth > 0).length;
    const thLoaded = thumbs.filter((b) => { const i = b.querySelector('img'); return i && i.naturalWidth > 0; }).length;
    const r = vp ? vp.getBoundingClientRect() : null;
    return {
      found: true, n: gal.dataset.n, i: gal.dataset.i,
      slides: imgs.length, thumbs: thumbs.length,
      loaded, thLoaded,
      vp: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null,
      counter: (gal.querySelector('.gal-num') || {}).textContent,
      prevDisabled: gal.querySelector('.gal-nav.prev').disabled,
      nextDisabled: gal.querySelector('.gal-nav.next').disabled,
      firstThumbOn: thumbs[0] ? thumbs[0].classList.contains('is-on') : false,
      title: (gal.querySelector('h4') || {}).textContent,
    };
  });
  console.log('\n=== 画廊结构 ===');
  console.log(JSON.stringify(m, null, 1));

  ok(m.found, '详情页出现 .gal 画廊');
  if (m.found) {
    ok(+m.n >= 5, '截图张数 ≥ 5', m.n + ' 张');
    ok(m.slides === +m.n, 'slide 数等于 data-n', m.slides + '/' + m.n);
    ok(m.thumbs === +m.n, '缩略图数等于 data-n', m.thumbs + '/' + m.n);
    ok(m.loaded >= 1, '首屏大图真加载（naturalWidth>0）', m.loaded + '/' + m.slides);
    /* ★ 断言必须锚定「画廊当前张」而不是「随便有一张」：
     *   轨道是 translateX 位移的、slides[0] 永远加载成功 ——
     *   只断言 loaded>=1 的话，「翻页时白屏」这个真问题它根本看不见（假绿）。
     *   实测第一版就是 2/9 加载：靠 loading=lazy 在位移轨道里不触发，已改预载下一张。 */
    const navLoad = await p.evaluate(async () => {
      const gal = document.querySelector('#drawerBody .gal');
      gal.querySelector('.gal-nav.next').click();
      await new Promise((r) => setTimeout(r, 2500));
      const k = +gal.dataset.i || 0;
      const im = gal.querySelectorAll('.gal-sld img')[k];
      return { i: k, nat: im ? im.naturalWidth : 0, loading: im ? im.getAttribute('loading') : '' };
    });
    console.log('\n翻到第 2 张后的加载状态:', JSON.stringify(navLoad));
    ok(navLoad.nat > 0, '★ 翻页后当前张真加载（否则用户看到白屏）',
      'naturalWidth=' + navLoad.nat + ' loading=' + navLoad.loading);
    await p.evaluate(() => document.querySelector('#drawerBody .gal-nav.prev').click());
    await sleep(500);
    ok(m.thLoaded === m.thumbs, '缩略图全部真加载', m.thLoaded + '/' + m.thumbs);
    ok(!!m.vp && m.vp.h > 120 && m.vp.w > 300, '.gal-vp 占版面', m.vp ? m.vp.w + 'x' + m.vp.h : '-');
    ok(/^1 \/ \d+$/.test(m.counter || ''), '计数器初值 1 / N', m.counter);
    ok(m.prevDisabled === true, '首张时「上一张」禁用');
    ok(m.nextDisabled === false, '首张时「下一张」可用');
    ok(m.firstThumbOn, '首个缩略图为选中态');

    // 点「下一张」
    await p.evaluate(() => document.querySelector('#drawerBody .gal-nav.next').click());
    await sleep(700);
    const after = await p.evaluate(() => {
      const gal = document.querySelector('#drawerBody .gal');
      const th = gal.querySelectorAll('.gal-th');
      return {
        i: gal.dataset.i, counter: gal.querySelector('.gal-num').textContent,
        trk: gal.querySelector('.gal-trk').style.transform,
        onIdx: [...th].findIndex((b) => b.classList.contains('is-on')),
        prevDisabled: gal.querySelector('.gal-nav.prev').disabled,
      };
    });
    console.log('\n点「下一张」后:', JSON.stringify(after));
    ok(after.i === '1', 'data-i 前进到 1', after.i);
    ok(/^2 \/ \d+$/.test(after.counter), '计数器更新为 2 / N', after.counter);
    ok(/translateX\(-100%\)/.test(after.trk), '轨道位移 -100%', after.trk);
    ok(after.onIdx === 1, '第 2 个缩略图变选中', 'idx=' + after.onIdx);
    ok(after.prevDisabled === false, '非首张时「上一张」解禁');

    // 点缩略图跳到第 5 张
    await p.evaluate(() => document.querySelectorAll('#drawerBody .gal-th')[4].click());
    await sleep(600);
    const jump = await p.evaluate(() => {
      const gal = document.querySelector('#drawerBody .gal');
      return { i: gal.dataset.i, counter: gal.querySelector('.gal-num').textContent };
    });
    console.log('点第 5 个缩略图后:', JSON.stringify(jump));
    ok(jump.i === '4' && /^5 \//.test(jump.counter), '点缩略图直接跳转', jump.counter);

    // 点大图 → 灯箱
    await p.evaluate(() => document.querySelector('#drawerBody .gal-sld img').click());
    await sleep(600);
    const lb = await p.evaluate(() => {
      const el = document.querySelector('.gal-lb');
      if (!el) return { open: false };
      const im = el.querySelector('img');
      return { open: true, w: el.getBoundingClientRect().width, n: el.querySelector('.n').textContent, src: !!im.getAttribute('src') };
    });
    console.log('灯箱:', JSON.stringify(lb));
    ok(lb.open && lb.w > 1000, '点大图打开灯箱', lb.open ? lb.w + 'px 宽' : '-');
    ok(lb.open && /^5 \/ \d+$/.test(lb.n), '★ 灯箱从**当前张**开始（此刻停在第 5 张），不是跳回第 1 张', lb.n);
    await p.screenshot({ path: path.join(OUT, 'v1025-lb.png') });
    await p.keyboard.press('Escape');
    await sleep(400);
    const closed = await p.evaluate(() => !document.querySelector('.gal-lb'));
    ok(closed, 'Esc 关闭灯箱');

    await p.evaluate(() => { const g = document.querySelector('#drawerBody .gal'); g.scrollIntoView({ block: 'center' }); });
    await sleep(1200);
    await p.screenshot({ path: path.join(OUT, 'v1025-gal.png') });
  }

  console.log('\n============================');
  console.log((fail ? '❌' : '✅') + ' ' + pass + ' / ' + (pass + fail) + ' 通过');
  await h.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
