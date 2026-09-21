/* tools/preview-v1029.js — v10.29「预览下移 + 灯箱翻页 + 分区 tab + 修改器/云存档同行」实拍
 *
 * 用户口径（原文）：
 *   ① 游戏预览放在游戏介绍下，且大图可以优化下（点击大图左右可以切换图片可以增加个
 *      透明度较高的图标），右侧悬浮定位条好像没更新
 *   ② 下载弹窗，就分开显示，而不是本体下面还有 Mod 或者修改器
 *   ③ 详情页中修改器和云存档同行固定最多 5 行，其他则为卡片右上角更多按钮查看全部
 *
 * ★ 本套只测**静态防线测不到**的部分：真浏览器里的位置关系 / 层叠 / 点击链路 / 行数。
 *   静态套件（test-v1029-detail.js）管的是「源码里写了什么」，这里管「用户看到什么」。
 *
 * ★ 为什么②的实拍在 `preview-v1026.js` / `preview-v1027.js` 里：
 *   那两个套件本来就在守下载弹窗（v10.26 建结构、v10.27 建条目与交互），
 *   ②只是把「折叠」换成「切签」，判据改了就该改在原地 —— 新开一份会让同一个弹窗
 *   被两套实拍同时守，改一次要改两处（本项目踩过这个坑）。
 *
 * ★ ⑥ 用**合成载荷**：实测全库每款游戏的修改器最多 **4** 条
 *   （`_probe-v1029g.js`：2,797 条已配对训练器按 libId 归并，最大值 = 4，出现在
 *   艾尔登法环 / 幻兽帕鲁），所以 `MAXTR = 5` 的上限与修改器的「更多」按钮
 *   **在真实数据下根本到不了**。到不了的代码路径 = 永远没人验证过的代码路径，
 *   这里用 8 条合成数据驱动 `loadTrBlock` 把它跑出来（渲染路径与真实数据完全同一条，
 *   只是数据来源换成桩），点按钮仍走真实的委托链路。
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { connectBrowser, sleep } = require('./browser');

const BASE = process.env.BASE || 'http://127.0.0.1:8123';
const OUT = path.join(__dirname, '..', '_preview');

let pass = 0, fail = 0;
function chk(name, ok, extra) {
  if (ok) { pass++; console.log('  ✅ ' + name + (extra ? '  — ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  — ' + extra : '')); }
}
function apiGet(p) {
  return new Promise((resolve) => {
    const req = http.get(BASE + p, { timeout: 60000 }, (res) => {
      let b = ''; res.setEncoding('utf8');
      res.on('data', (c) => { b += c; });
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

/* 样本：博德之门3（xd-419）
 *   修改器 3 条（>0 ⇒ 与云存档同行会真的渲染两块）+ 云存档 10 条（>5 ⇒ 触发 5 行上限与「更多」）
 *   —— 「两块都在」是④⑤的前置条件：只有一块时 `.d-pair` 会退成 `.solo` 单列，
 *      那时断言「同行两列」就是把「没数据」当成「实现错了」。 */
const SAMPLE = { id: 'xd-419', title: "博德之门3/Baldur's Gate 3" };
const SV_TOTAL_EXPECT = 10;

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  /* ---------- ⓪ 样本自检（数据前提，不是实现判据）---------- */
  console.log('\n=== ⓪ 样本自检 ===');
  const it = await apiGet('/api/library/item?id=' + SAMPLE.id);
  const tr = await apiGet('/api/trainers/match?t=' + encodeURIComponent(SAMPLE.title));
  const sv = await apiGet('/api/saves/match?t=' + encodeURIComponent(SAMPLE.title));
  const trN = ((tr && tr.items) || []).length;
  const svN = sv && sv.hit ? (sv.hit.paths || []).length + (sv.hit.regs || []).length : 0;
  chk('样本在库内', !!(it && it.item), it && it.item ? it.item.title : '');
  chk('★ 样本两块都有内容（否则「同行」测不到）', trN > 0 && svN > 0, `修改器 ${trN} 条 / 云存档 ${svN} 条`);
  chk('★ 样本的云存档 > 5 条（否则「5 行上限 + 更多按钮」测不到）', svN > 5, svN + ' 条');

  const h = await connectBrowser();
  const b = h.browser;
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1200);

  await p.evaluate((s) => window.openDetailById(s.id, s.title), SAMPLE);
  /* 懒加载：req → mobilehub → specs → tr/sv → download（含 302 逐个解析），给足时间 */
  const ready = await p.evaluate(() => new Promise((res) => {
    const t = setTimeout(() => res('timeout'), 40000);
    const w = setInterval(() => {
      if (document.querySelector('#trBlock .d-blk') && document.querySelector('#svBlock .d-blk')) {
        clearInterval(w); clearTimeout(t); res('ok');
      }
    }, 300);
  }));
  await sleep(2500);
  chk('★ 前置：修改器与云存档两块都渲染出来了', ready === 'ok', String(ready));

  /* ---------- ① 版式：游戏预览在介绍之后 ---------- */
  console.log('\n=== ① 版式顺序（实拍 DOM）===');
  const lay = await p.evaluate(() => {
    const bodyEl = document.querySelector('#drawerBody .d-body');
    if (!bodyEl) return null;
    const kids = [...bodyEl.children].map((x) => {
      if (x.id) return '#' + x.id;
      if (x.classList.contains('gal')) return '.gal';
      if (x.classList.contains('kv')) return '.kv';
      if (x.classList.contains('score-line')) return '.score-line';
      if (x.classList.contains('d-hint')) return '.d-hint';
      if (x.classList.contains('no-dl')) return '.no-dl';
      if (x.classList.contains('block')) return '.block';
      return '.' + String(x.className || '').split(' ')[0];
    });
    const g = document.querySelector('#drawerBody .gal');
    const gr = g ? g.getBoundingClientRect() : null;
    const slides = g ? g.querySelectorAll('.gal-sld img').length : 0;
    return {
      kids,
      /* ★ 下标必须在**浏览器里**算好再回传：`p.evaluate` 的返回值走结构化克隆，
         函数不被保留（首版返回了一个 `idx` 闭包，取回来直接 TypeError）。 */
      atGal: kids.indexOf('.gal'),
      atReq: kids.indexOf('#reqSlot'),
      atKv: kids.indexOf('.kv'),
      atPair: kids.indexOf('#trSvSlot'),
      lastBlock: kids.lastIndexOf('.block'),
      galN: slides,
      galBox: gr ? [Math.round(gr.width), Math.round(gr.height)] : [0, 0],
      galCount: (document.querySelector('#drawerBody .gal h4 .cnt') || {}).textContent || '',
    };
  });
  chk('能读到版式结构', !!lay);
  if (lay) {
    console.log('     #drawerBody > .d-body 子元素顺序：' + lay.kids.join(' → '));
    chk('★★ 游戏预览排在**最后一个介绍块之后**（用户口径「游戏预览放在游戏介绍下」）',
      lay.atGal > lay.lastBlock && lay.lastBlock >= 0,
      '.gal@' + lay.atGal + ' vs 末个 .block@' + lay.lastBlock);
    chk('★ 预览仍在「配置要求」之前（介绍→预览→配置 的信息递进没被打乱）',
      lay.atGal > -1 && lay.atReq > -1 && lay.atGal < lay.atReq,
      '.gal@' + lay.atGal + ' < #reqSlot@' + lay.atReq);
    chk('★ 预览在参数表 / 评分之后（不是抢在参数前面）',
      lay.atGal > lay.atKv, '.gal@' + lay.atGal + ' > .kv@' + lay.atKv);
    chk('预览块真占版面', lay.galBox[0] > 200 && lay.galBox[1] > 80, lay.galBox.join('×'));
    chk('★ 截图张数 ≥ 2（否则下面的左右切换测不到）', lay.galN >= 2, lay.galN + ' 张 · 徽标「' + lay.galCount.trim() + '」');
    /* 让截图拍到「介绍块 → 预览块」的衔接处 —— 这正是本轮改的位置关系 */
    await p.evaluate(() => {
      const el = document.querySelector('#drawerBody .gal');
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
    });
    await sleep(500);
    await p.screenshot({ path: path.join(OUT, 'v1029-layout.png') });
  }

  /* ---------- ② 灯箱：左右切换 + 半透明箭头 ---------- */
  console.log('\n=== ② 灯箱左右切换（半透明图标）===');
  await p.evaluate(() => { const im = document.querySelector('#drawerBody .gal .gal-sld img'); if (im) im.click(); });
  await sleep(900);
  const lb0 = await p.evaluate(() => {
    const el = document.querySelector('.gal-lb');
    if (!el) return { shown: false };
    const navs = [...el.querySelectorAll('.gal-lb-nav')];
    const img = el.querySelector('img');
    const prev = el.querySelector('.gal-lb-nav.prev');
    const cs = prev ? getComputedStyle(prev) : null;
    const r = prev ? prev.getBoundingClientRect() : null;
    /* ★ 箭头能不能真点到：用中心点做 elementFromPoint。
       只看「元素存在 + opacity 有值」证明不了它没被 <img> 盖住（同 v10.28 灯箱层叠那一课）。 */
    const hit = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
    return {
      shown: true,
      navN: navs.length,
      navHidden: navs.map((x) => x.hidden),
      navBox: navs.map((x) => { const q = x.getBoundingClientRect(); return [Math.round(q.width), Math.round(q.height)]; }),
      pos: cs ? cs.position : '',
      opacity: cs ? Number(cs.opacity) : -1,
      hitIsNav: !!(hit && hit.closest && hit.closest('.gal-lb-nav')),
      src: img ? img.src : '',
      n: (el.querySelector('.n') || {}).textContent || '',
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  chk('灯箱已打开', lb0.shown === true);
  if (lb0.shown) {
    chk('★ 左右各一个箭头（两个都在，且都不是 hidden）',
      lb0.navN === 2 && lb0.navHidden.every((x) => x === false), 'hidden=' + JSON.stringify(lb0.navHidden));
    chk('★ 箭头真占版面（宽高 > 0）', lb0.navBox.every(([w, hh]) => w > 20 && hh > 20), JSON.stringify(lb0.navBox));
    chk('★ 箭头是 absolute 定位（.gal-lb 是 flex column，不定位会被挤进纵向流）', lb0.pos === 'absolute', lb0.pos);
    chk('★★ 箭头**半透明**（静止态 opacity < 1）—— 用户口径「透明度较高的图标」', lb0.opacity < 1,
      'opacity=' + lb0.opacity);
    chk('★★ 箭头中心点到的**就是箭头**（没被大图盖住，真能点）', lb0.hitIsNav === true);
    chk('★ 计数显示当前张 / 总数', /^\d+ \/ \d+$/.test(lb0.n.trim()), lb0.n.trim());
    chk('★ 灯箱打开时无横向溢出', lb0.overflow <= 1, String(lb0.overflow));

    const n0 = lb0.n.trim(), src0 = lb0.src;
    /* 悬停 → 变实 */
    await p.hover('.gal-lb-nav.next');
    await sleep(500);
    const hov = await p.evaluate(() => {
      const nx = document.querySelector('.gal-lb-nav.next');
      return { next: nx ? Number(getComputedStyle(nx).opacity) : -1 };
    });
    chk('★ 悬停「下一张」后它变实（opacity 升到 1）', hov.next > lb0.opacity,
      `静止 ${lb0.opacity} → 悬停 ${hov.next}`);

    /* 点「下一张」 */
    await p.evaluate(() => document.querySelector('.gal-lb-nav.next').click());
    await sleep(500);
    const lb1 = await p.evaluate(() => {
      const el = document.querySelector('.gal-lb');
      return { n: (el.querySelector('.n') || {}).textContent || '', src: (el.querySelector('img') || {}).src || '' };
    });
    chk('★★ 点「下一张」真的换了图（不是只改了计数）', lb1.src && lb1.src !== src0,
      n0 + ' → ' + lb1.n.trim() + ' · src ' + (lb1.src === src0 ? '未变' : '已变'));

    /* 点「上一张」回到第 1 张 */
    await p.evaluate(() => document.querySelector('.gal-lb-nav.prev').click());
    await sleep(500);
    const lb2 = await p.evaluate(() => {
      const el = document.querySelector('.gal-lb');
      return { n: (el.querySelector('.n') || {}).textContent || '', src: (el.querySelector('img') || {}).src || '' };
    });
    chk('★ 点「上一张」回到第一张（图片也回到原图）', lb2.n.trim() === n0 && lb2.src === src0,
      lb2.n.trim() + ' · src ' + (lb2.src === src0 ? '一致' : '不一致'));

    /* ★ 取模边界：第 1 张再点「上一张」必须**环绕到最后一张**。
       不 `+len` 兜底时 JS 的 `-1 % N === -1` ⇒ 会取到 undefined，图直接空掉。 */
    await p.evaluate(() => document.querySelector('.gal-lb-nav.prev').click());
    await sleep(500);
    const lb3 = await p.evaluate(() => {
      const el = document.querySelector('.gal-lb');
      const im = el.querySelector('img');
      return { n: (el.querySelector('.n') || {}).textContent || '', hasSrc: !!(im && im.getAttribute('src')), src: im ? im.src : '' };
    });
    const total = Number((n0.split('/')[1] || '0').trim());
    chk('★★ 在第 1 张再点「上一张」**环绕到最后一张**，而不是掉进 —1',
      lb3.n.trim() === total + ' / ' + total && lb3.hasSrc === true,
      '改前 -1%N = -1 → 图片 src 变空；现在 ' + lb3.n.trim());

    /* 键盘：与箭头**同一个出口**（galLbStep）。
       ★ 期望值用**算术算**（(i)%n+1 / (i-2+n)%n+1），不写死「9 / 9」——
         写死的是「上一小节的落点」，落点一变就整片假红（首版就是这么红的）。 */
    const beforeK = await p.evaluate(() => ((document.querySelector('.gal-lb .n') || {}).textContent || '').trim());
    const iK = Number((beforeK.split('/')[0] || '0').trim());
    const nK = Number((beforeK.split('/')[1] || '0').trim());
    const expNext = (iK % nK) + 1;
    /* ★ 后退的期望值要**从 expNext 再退一步**算 —— 它不是 iK 的邻居（iK 已经过期了）。
       首版写成 `(iK-2+nK)%nK+1`，实测差一张（9 → 期望 8、实际 9）。 */
    const expBack = ((expNext - 2 + nK) % nK) + 1;
    const expIfPlus = ((expNext % nK) + 1);
    await p.keyboard.press('ArrowRight');
    await sleep(450);
    const k1 = await p.evaluate(() => ((document.querySelector('.gal-lb .n') || {}).textContent || '').trim());
    chk('★ 键盘 → 前进一张（在第 ' + iK + ' 张按下 ⇒ 第 ' + expNext + ' 张；末张时环绕回第 1 张）',
      k1 === expNext + ' / ' + nK, beforeK + ' → ' + k1);
    await p.keyboard.press('ArrowLeft');
    await sleep(450);
    const k2 = await p.evaluate(() => ((document.querySelector('.gal-lb .n') || {}).textContent || '').trim());
    /* ★ 这条才是「← 走的确实是 -1」的判据：若被当成 +1，结果会是第 expIfPlus 张 */
    chk('★ 键盘 ← 后退一张（说明 ArrowLeft 真的走 -1，而不是被当成 +1）',
      k2 === expBack + ' / ' + nK && expBack !== expIfPlus,
      k1 + ' → ' + k2 + '（若走 +1 会是 ' + expIfPlus + ' / ' + nK + '）');

    await p.screenshot({ path: path.join(OUT, 'v1029-lightbox.png') });
    await p.evaluate(() => document.querySelector('.gal-lb-x').click());
    await sleep(400);
    const gone = await p.evaluate(() => !document.querySelector('.gal-lb'));
    chk('★ 点 ✕ 能关掉灯箱', gone === true);
  }

  /* ---------- ③ 右侧定位条 ---------- */
  console.log('\n=== ③ 右侧悬浮定位条 ===');
  const rail = await p.evaluate(() => {
    const r = document.getElementById('dRail');
    if (!r) return null;
    const items = [...r.querySelectorAll('.dr-it')];
    return {
      hidden: r.hidden,
      n: items.length,
      names: items.map((x) => (x.querySelector('.dr-t') || {}).textContent || ''),
      boxes: items.map((x) => { const q = x.getBoundingClientRect(); return [Math.round(q.width), Math.round(q.height)]; }),
    };
  });
  chk('定位条存在且已显示', !!rail && rail.hidden === false);
  if (rail) {
    console.log('     条目：' + rail.names.join(' → '));
    chk('★ 条目数是当前正文的分区数（≥9：评分参数 / 介绍 / 预览 / 配置 / 手机 / 修改器 / 云存档 / 同分类 / 下载）',
      rail.n >= 9, rail.n + ' 项');
    chk('★★ 新增的「评分参数」在条上（用户口径「右侧悬浮定位条好像没更新」）',
      rail.names.indexOf('评分参数') > -1, rail.names.join('/'));
    chk('★★ 「游戏预览」也在条上', rail.names.indexOf('游戏预览') > -1, rail.names.join('/'));
    chk('★ 条上的顺序与正文一致：预览排在介绍之后、配置要求之前',
      rail.names.indexOf('游戏预览') > rail.names.indexOf('游戏介绍') &&
      rail.names.indexOf('游戏预览') < rail.names.indexOf('配置要求'),
      '游戏介绍@' + rail.names.indexOf('游戏介绍') + ' 预览@' + rail.names.indexOf('游戏预览')
      + ' 配置@' + rail.names.indexOf('配置要求'));
    /* ★★ 首尾两项的判据不是凑数，它抓住过一个真 bug：
       排序原先按「视口 rect.top」，而 `.d-dock` 里的 `#dlStrip` 是 sticky ——
       它的 rect 是「吸在视口底部」的位置，于是 XD 源（三专区无内容 → 兜底到 #dlStrip）
       的「下载」被排到第 3 位。改成 compareDocumentPosition 后才是真文档顺序。 */
    chk('★★ 条上第一项是「评分参数」、最后一项是「下载」（= 真文档顺序；曾因 sticky 排错）',
      rail.names[0] === '评分参数' && rail.names[rail.names.length - 1] === '下载',
      '首=' + rail.names[0] + ' 末=' + rail.names[rail.names.length - 1]);
    chk('★ 每一项真占版面', rail.boxes.every(([w, hh]) => w > 0 && hh > 0), JSON.stringify(rail.boxes.slice(0, 3)));
  }

  /* ---------- ④ 修改器 / 云存档**同行** ---------- */
  console.log('\n=== ④ 修改器 + 云存档 同行两列 ===');
  const pair = await p.evaluate(() => {
    const w = document.getElementById('trSvSlot');
    if (!w) return null;
    const blks = [...w.querySelectorAll('.d-blk')];
    const wr = w.getBoundingClientRect();
    return {
      display: getComputedStyle(w).display,
      cols: getComputedStyle(w).gridTemplateColumns,
      solo: w.classList.contains('solo'),
      n: blks.length,
      rects: blks.map((x) => { const q = x.getBoundingClientRect(); return { t: Math.round(q.top), l: Math.round(q.left), w: Math.round(q.width), h: Math.round(q.height) }; }),
      headText: blks.map((x) => (x.querySelector('h4') || {}).innerText || ''),
      w: Math.round(wr.width),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  chk('两块的容器存在', !!pair);
  if (pair) {
    chk('★ 容器是 grid 两列', pair.display === 'grid' && pair.cols.split(' ').length === 2, pair.display + ' / ' + pair.cols);
    chk('★★ 两块同属一行（都渲染出来了，未退成 .solo 单列）', pair.solo === false && pair.n >= 2,
      'solo=' + pair.solo + ' 块数=' + pair.n);
    chk('★★ 两块的顶边齐平（真的「同行」，不是上下堆）',
      pair.n >= 2 && Math.abs(pair.rects[0].t - pair.rects[1].t) <= 6,
      pair.rects.map((r) => 'top=' + r.t).join(' / '));
    chk('★★ 两块等宽两列（各占一半；写死 3+2 或让一边撑开会立刻看出来）',
      pair.n >= 2 && Math.abs(pair.rects[0].w - pair.rects[1].w) <= 6 &&
      pair.rects[0].l < pair.rects[1].l,
      pair.rects.map((r) => 'left=' + r.l + ' w=' + r.w).join(' / '));
    chk('★ 两块真占版面（宽 > 200 / 高 > 60）',
      pair.rects.every((r) => r.w > 200 && r.h > 60), JSON.stringify(pair.rects.map((r) => r.w + '×' + r.h)));
    chk('★ 无横向溢出', pair.overflow <= 1, String(pair.overflow));
    console.log('     卡头：' + pair.headText.map((x) => x.replace(/\s+/g, ' ').slice(0, 40)).join(' ｜ '));
    /* ★ 截图前先把它滚进视野 —— 详情页很长，不滚就只拍到页面顶部，
       等于没拍（本项目踩过「元素截图拍出纯白图」同源的一课：拍的必须是看得见的东西）。 */
    await p.evaluate(() => {
      const el = document.getElementById('trSvSlot');
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
    });
    await sleep(500);
    await p.screenshot({ path: path.join(OUT, 'v1029-pair.png') });
  }

  /* ---------- ⑤ 云存档：5 行上限 + 卡头右上角「更多」---------- */
  console.log('\n=== ⑤ 云存档 5 行上限 + 右上角「更多」===');
  const svBlk = await p.evaluate(() => {
    const blk = document.querySelector('#svBlock .d-blk');
    if (!blk) return null;
    const h4 = blk.querySelector('h4');
    const btn = blk.querySelector('.d-more-hd');
    const h4r = h4.getBoundingClientRect();
    const br = btn ? btn.getBoundingClientRect() : null;
    const cnt = (h4.querySelector('.cnt') || {}).textContent || '';
    /* ★ 必须把「行」按容器分组 —— 路径与注册表是两个 `.p`，行数看的是所有 `.p` */
    const rows = [...blk.querySelectorAll('.d-sv .p')];
    const sr = blk.querySelector('.d-sv') ? blk.querySelector('.d-sv').getBoundingClientRect() : null;
    return {
      h4: h4.innerText.replace(/\s+/g, ' '),
      cnt: cnt.trim(),
      rows: rows.length,
      rowHeights: rows.map((x) => Math.round(x.getBoundingClientRect().height)),
      inLineBtn: blk.querySelectorAll('.d-more-btn').length,
      hasHdBtn: !!btn,
      btnText: btn ? btn.textContent.replace(/\s+/g, ' ').trim() : '',
      btnInH4: !!(btn && btn.closest('h4') === h4),
      btnBox: br ? [Math.round(br.width), Math.round(br.height)] : null,
      /* 「右上角」的布局判据：按钮右缘贴近卡头右缘、且在卡头的垂直范围内 */
      btnRightGap: br ? Math.round(h4r.right - br.right) : -1,
      btnInHeadRows: br ? (br.top >= h4r.top - 2 && br.bottom <= h4r.bottom + 2) : false,
      listBox: sr ? [Math.round(sr.width), Math.round(sr.height)] : null,
    };
  });
  chk('云存档块渲染出来了', !!svBlk);
  if (svBlk) {
    console.log('     卡头：' + svBlk.h4 + '  · 行数 ' + svBlk.rows);
    chk('★★ 行数不超过 5（用户口径「固定最多 5 行」）', svBlk.rows > 0 && svBlk.rows <= 5,
      svBlk.rows + ' 行（总记录 ' + svBlk.cnt + '）');
    chk('★★ 「更多」按钮挂在**卡头 h4 里**（不是正文流里的整行按钮）',
      svBlk.hasHdBtn && svBlk.btnInH4 && svBlk.inLineBtn === 0,
      'h4 内按钮=' + svBlk.btnInH4 + ' 正文行按钮=' + svBlk.inLineBtn);
    chk('★★ 按钮在卡头的**右上角**（右缘贴近卡头右缘、且落在卡头垂直范围内）',
      svBlk.btnInHeadRows && svBlk.btnRightGap >= -2 && svBlk.btnRightGap <= 26,
      '右缘间距 ' + svBlk.btnRightGap + 'px · 在卡头内=' + svBlk.btnInHeadRows);
    chk('★ 按钮文案带上真实总数', /全部\s*\d+/.test(svBlk.btnText), svBlk.btnText);
    chk('★ 按钮真占版面', !!svBlk.btnBox && svBlk.btnBox[0] > 40 && svBlk.btnBox[1] > 14, JSON.stringify(svBlk.btnBox));

    /* 点按钮 → 弹窗里必须是**全部**记录 */
    await p.evaluate(() => document.querySelector('#svBlock .d-more-hd').click());
    await sleep(1500);
    const full = await p.evaluate(() => {
      const pop = document.getElementById('dlPop');
      const body = document.getElementById('dlBody');
      const pr = pop ? pop.getBoundingClientRect() : null;
      return {
        visible: !!pop && !pop.hidden,
        title: (document.getElementById('dlTitle') || {}).textContent || '',
        rows: body ? body.querySelectorAll('.df-row').length : 0,
        w: pr ? Math.round(pr.width) : 0,
        sections: body ? [...body.querySelectorAll('.df-sect')].map((x) => x.textContent.trim()) : [],
      };
    });
    chk('★ 点「更多」打开了弹窗且真占版面', full.visible && full.w > 400, full.title + ' · ' + full.w + 'px');
    chk('★★ 弹窗里给出**全部**记录（不是又截成 5 行）', full.rows === SV_TOTAL_EXPECT,
      full.rows + ' 行（期望 ' + SV_TOTAL_EXPECT + '）');
    await p.screenshot({ path: path.join(OUT, 'v1029-sv-full.png') });
    await p.evaluate(() => document.querySelector('#dlPop [data-dl="close"]').click());
    await sleep(600);
    const closed = await p.evaluate(() => { const e = document.getElementById('dlPop'); return !!e && e.hidden; });
    chk('★ 弹窗关得掉', closed === true);
  }

  /* ---------- ⑥ 修改器：5 行上限（合成载荷，真实数据到不了）---------- */
  console.log('\n=== ⑥ 修改器 5 行上限（合成载荷：全库真实最多只有 4 条）===');
  const synth = await p.evaluate(async () => {
    const items = [];
    for (let i = 1; i <= 8; i++) {
      items.push({ source: i % 2 ? 'fling' : 'cheat_table', zh: '合成修改器 ' + i, name: 'Synthetic Trainer ' + i, version: '2026.0' + i });
    }
    const orig = window.fetch;
    window.fetch = function (u, o) {
      if (String(u).indexOf('/api/trainers/match') > -1) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, items }), { headers: { 'Content-Type': 'application/json' } }));
      }
      return orig.apply(window, arguments);
    };
    try {
      await window.loadTrBlock({ title: '合成样本' }, '合成样本');
    } finally {
      window.fetch = orig;                      // ★ 无论成败都还原，否则后面的真实请求全被桩掉
    }
    const blk = document.querySelector('#trBlock .d-blk');
    if (!blk) return { ok: false };
    const h4 = blk.querySelector('h4');
    const btn = blk.querySelector('.d-more-hd');
    const h4r = h4.getBoundingClientRect();
    const br = btn ? btn.getBoundingClientRect() : null;
    return {
      ok: true,
      rows: blk.querySelectorAll('.d-tr-it').length,
      h4: h4.innerText.replace(/\s+/g, ' '),
      hasHdBtn: !!btn,
      inLineBtn: blk.querySelectorAll('.d-more-btn').length,
      btnText: btn ? btn.textContent.replace(/\s+/g, ' ').trim() : '',
      btnInH4: !!(btn && btn.closest('h4') === h4),
      btnRightGap: br ? Math.round(h4r.right - br.right) : -1,
      btnInHeadRows: br ? (br.top >= h4r.top - 2 && br.bottom <= h4r.bottom + 2) : false,
      restored: window.fetch === orig,
      pairStillPair: !document.getElementById('trSvSlot').classList.contains('solo'),
    };
  });
  chk('合成载荷驱动 loadTrBlock 成功（渲染路径与真实数据同一条）', synth.ok === true);
  if (synth.ok) {
    chk('★★ 修改器行数被截到 5（合成 8 条 ⇒ 用户口径「固定最多 5 行」）', synth.rows === 5,
      synth.rows + ' 行 / 合成 8 条');
    chk('★★ 截断时卡头右上角出现「更多」按钮（整行按钮不许出现）',
      synth.hasHdBtn && synth.btnInH4 && synth.inLineBtn === 0,
      'h4 内=' + synth.btnInH4 + ' 正文行=' + synth.inLineBtn);
    chk('★★ 按钮在卡头右上角', synth.btnInHeadRows && synth.btnRightGap >= -2 && synth.btnRightGap <= 26,
      '右缘间距 ' + synth.btnRightGap + 'px');
    chk('★ 文案带真实总数（8）', /全部\s*8/.test(synth.btnText), synth.btnText);
    chk('★ 桩已还原（不还原会把后续真实请求全打桩）', synth.restored === true);
    chk('★ 合成回填后两块仍是并排（syncPair 在 finally 里也走到了）', synth.pairStillPair === true);
    await p.evaluate(() => {
      const el = document.getElementById('trSvSlot');
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
    });
    await sleep(400);
    await p.screenshot({ path: path.join(OUT, 'v1029-tr-cap.png') });

    await p.evaluate(() => document.querySelector('#trBlock .d-more-hd').click());
    await sleep(1200);
    const trFull = await p.evaluate(() => {
      const body = document.getElementById('dlBody');
      return {
        visible: !document.getElementById('dlPop').hidden,
        rows: body ? body.querySelectorAll('.df-row').length : 0,
        note: (body ? (body.querySelector('.df-note') || {}).textContent || '' : '').replace(/\s+/g, ' ').slice(0, 60),
      };
    });
    chk('★★ 弹窗给出全部 8 条（不是又截成 5 条）', trFull.visible && trFull.rows === 8,
      trFull.rows + ' 行 · ' + trFull.note);
    await p.screenshot({ path: path.join(OUT, 'v1029-tr-full.png') });
    await p.evaluate(() => document.querySelector('#dlPop [data-dl="close"]').click());
    await sleep(400);
  }

  /* ---------- ⑦ 运行期错误 ---------- */
  console.log('\n=== ⑦ 运行期错误 ===');
  chk('页面无 JS 报错', errs.length === 0, errs.slice(0, 3).join(' | ') || '(无)');

  console.log('\n' + '='.repeat(60));
  console.log('实拍结果：' + pass + ' / ' + (pass + fail) + ' 通过' + (fail ? '，' + fail + ' 失败' : ''));
  console.log('样本：' + SAMPLE.title + '（' + SAMPLE.id + '）');
  console.log('截图目录：' + OUT);
  console.log('='.repeat(60));
  for (const pg of await b.pages()) { try { await pg.close(); } catch (e) {} }
  await h.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('实拍脚本异常：', e); process.exit(1); });
