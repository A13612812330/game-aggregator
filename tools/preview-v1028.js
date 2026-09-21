/* tools/preview-v1028.js — v10.28「详情页重排 / 置顶 / 固定底栏 / 三专区预览」浏览器实拍 + 断言
 *
 * 验证六件事在**真实浏览器 + 真实数据**下的效果（静态防线管不到的部分）：
 *   ① 版式顺序（实拍 DOM 子元素顺序，不是源码字符串顺序）
 *   ② 封面+标题吸顶：滚动后收窄、且仍贴顶
 *   ③ 图片灯箱**真的在最上层** —— 用 elementFromPoint 判定，不是查 z-index 数字
 *   ④ 操作按钮组固定在详情页底部（贴底 + 真占版面）
 *   ⑤ 手机配置：默认 5 台机型；点机型后硬件面板只有「品牌 / 型号 / 硬件配置」
 *   ⑥ 三专区各露前 3 帖 → 点「全部」弹窗每页 10 帖 → 翻页真的翻得动
 *
 * 运行：node tools/preview-v1028.js        （需服务已在 8123 运行）
 * 产出：_preview/v1028-*.png
 *
 * ★ 为什么③必须用 elementFromPoint：灯箱一直「存在」、也有 z-index 声明，
 *   坏的只是**层叠**。存在性/属性断言对它完全无感 —— 本项目 v10.22 栽过同款
 *   （下载弹窗 z-index 低于抽屉，元素全在、就是被盖住）。
 *
 * ★ 为什么⑤⑥要在**真实数据**上跑：静态断言只能证明「代码里写了 5」，
 *   证明不了「渲染出来是 5」—— 服务端多给一条/少给一条都不在静态层可见。
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { connectBrowser, sleep } = require('./browser');

const BASE = process.env.BASE || 'http://127.0.0.1:8123/';
const OUT = path.join(__dirname, '..', '_preview');

let pass = 0, fail = 0;
function chk(name, ok, extra) {
  if (ok) { pass++; console.log('  ✅ ' + name + (extra ? '  — ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  — ' + extra : '')); }
}

/** node 侧的 API 探测（样本挑选放这边，避免把 4 次 302 解析塞进浏览器里等） */
function apiGet(p) {
  return new Promise((resolve) => {
    const req = http.get(BASE.replace(/\/$/, '') + p, { timeout: 60000 }, (res) => {
      let b = ''; res.setEncoding('utf8');
      res.on('data', (c) => { b += c; });
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  /* ---------- 0. 挑一个「有 2 个以上专区」的样本（否则测不到三专区与翻页）---------- */
  console.log('\n=== ⓪ 挑样本（需至少 2 个专区，否则三专区/翻页测不到）===');
  /* ★ 候选取「机地源」优先：只有机地话题页有**专区**概念（body/mod/modifier）；
     XD 是 `kind:'downbtn'`，`sections` 恒为空 ⇒ 拿它测永远测不到三专区与翻页。
     （首版没筛 source，前 10 个候选全是 XD，白跑一轮才发现。） */
  const cand = ['jidi-2117239899'];
  const brow = await apiGet('/api/library/browse?limit=80');
  for (const it of (brow && brow.items) || []) {
    if (it && it.id && it.source === 'jidi' && !cand.includes(it.id)) cand.push(it.id);
  }
  for (const id of ['jidi-2150789868', 'jidi-976417160', 'xd-5828']) {
    if (!cand.includes(id)) cand.push(id);
  }
  let sample = null;
  for (const id of cand.slice(0, 12)) {
    const r = await apiGet('/api/library/item?id=' + encodeURIComponent(id));
    const it = r && r.item;
    if (!it || !it.url) continue;
    const d = await apiGet('/api/download?url=' + encodeURIComponent(it.url));
    const secs = ((d && d.sections) || []).filter((s) => s && s.count);
    const posts = ((d && d.items) || []).filter((x) => x && x.real).length;
    if (secs.length >= 2 && posts >= 4) {
      sample = { id, title: it.title || '', url: it.url, secs: secs.map((s) => s.key + ':' + s.count).join(','), posts };
      break;
    }
  }
  chk('找到一个「≥2 专区且有资源帖」的样本', !!sample, sample ? (sample.title + ' · ' + sample.secs + ' · ' + sample.posts + ' 地址') : '未找到');
  if (!sample) {
    console.log('\n（没有合适样本，后续实拍跳过）');
    process.exit(1);
  }

  const h = await connectBrowser();
  const b = h.browser;
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1200);

  /* 打开详情页（走统一的 openDetailById，与用户点卡片是同一条链路） */
  await p.evaluate((s) => window.openDetailById(s.id, s.title), sample);
  /* 懒加载区块：req → mobilehub/match → device/specs → download（含逐个 302 解析），给足时间 */
  await sleep(11000);

  /* ---------- ① 版式顺序（实拍 DOM）---------- */
  console.log('\n=== ① 详情页版式顺序（实拍 DOM 子元素）===');
  const lay = await p.evaluate(() => {
    const db = document.getElementById('drawerBody');
    const bodyEl = document.querySelector('#drawerBody .d-body');
    const dock = document.querySelector('#drawerBody .d-dock');
    if (!db || !bodyEl) return null;
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
    const at = (k) => kids.indexOf(k);
    return {
      kids,
      heroFirst: db.firstElementChild === document.getElementById('dHero'),
      dockParentId: dock ? (dock.parentElement.id || dock.parentElement.className) : '(无 d-dock)',
      dockInsideBody: dock ? bodyEl.contains(dock) : null,
      galBeforeReq: at('.gal') > -1 && at('#reqSlot') > -1 && at('.gal') < at('#reqSlot'),
      kvBeforeReq: at('.kv') > -1 && at('#reqSlot') > -1 && at('.kv') < at('#reqSlot'),
      dlAfterRel: at('#dlSlot') > -1 && at('#relSlot') > -1 && at('#dlSlot') > at('#relSlot'),
      crossAfterDl: at('#crossSrc') > -1 && at('#dlSlot') > -1 && at('#crossSrc') > at('#dlSlot'),
      bhBeforePair: at('#bhSlot') > -1 && at('#trSvSlot') > -1 && at('#bhSlot') < at('#trSvSlot'),
    };
  });
  chk('能读到详情页版式结构', !!lay);
  if (lay) {
    console.log('     #drawerBody > .d-body 子元素顺序：' + lay.kids.join(' → '));
    chk('封面+标题（#dHero）是抽屉第一个元素', lay.heroFirst === true);
    chk('★ 游戏预览在「配置要求」之前（改造前排在第 7 位）', lay.galBeforeReq === true);
    chk('★ 评分+参数表在「配置要求」之前', lay.kvBeforeReq === true);
    chk('★ 手机模拟器配置在「修改器+云存档」之前', lay.bhBeforePair === true);
    chk('★ 下载三专区在「同分类更多」之后', lay.dlAfterRel === true);
    chk('★ 「其他」在三专区之后', lay.crossAfterDl === true);
    chk('★★ 操作按钮组在 .d-body **之外**（在 .d-body 内会被 padding 垫起一条白缝）',
      lay.dockInsideBody === false, 'dock 的父节点=' + lay.dockParentId);
  }
  await p.screenshot({ path: path.join(OUT, 'v1028-layout-top.png') });

  /* ---------- ② 吸顶 ---------- */
  console.log('\n=== ② 封面+标题吸顶 ===');
  const hero0 = await p.evaluate(() => {
    const el = document.getElementById('dHero');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { pos: getComputedStyle(el).position, top: r.top, h: r.height, mini: el.classList.contains('mini') };
  });
  chk('hero 存在且 position=sticky', !!hero0 && hero0.pos === 'sticky', hero0 ? hero0.pos : '');
  chk('初始是展开态（未收窄）', !!hero0 && hero0.mini === false && hero0.h > 120,
    hero0 ? `高 ${Math.round(hero0.h)}px` : '');

  await p.evaluate(() => { document.getElementById('drawer').scrollTop = 600; });
  await sleep(800);
  const hero1 = await p.evaluate(() => {
    const el = document.getElementById('dHero');
    const r = el.getBoundingClientRect();
    return { top: r.top, h: r.height, mini: el.classList.contains('mini') };
  });
  chk('★ 滚动后收窄（挂上 .mini）', hero1.mini === true, `高 ${Math.round(hero0.h)} → ${Math.round(hero1.h)}px`);
  chk('★ 收窄后确实变矮（不是只加了个类名）', hero1.h < hero0.h * 0.7,
    `${Math.round(hero0.h)} → ${Math.round(hero1.h)}px`);
  chk('★★ 滚动后仍**贴顶**（sticky 生效，不是被滚走）', Math.abs(hero1.top) < 4, `top=${hero1.top.toFixed(1)}`);
  await p.screenshot({ path: path.join(OUT, 'v1028-hero-mini.png') });

  /* ---------- ③ 灯箱置顶（elementFromPoint 判定）---------- */
  console.log('\n=== ③ 图片灯箱层级（elementFromPoint）===');
  await p.evaluate(() => {
    const g = document.querySelector('#drawerBody .gal [data-gal]') || document.querySelector('#drawerBody .gal');
    const img = g && g.querySelector('.gal-sld img');
    if (img) img.click();
  });
  await sleep(900);
  const lb = await p.evaluate(() => {
    const el = document.querySelector('.gal-lb');
    if (!el || getComputedStyle(el).display === 'none') return { shown: false };
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    return {
      shown: true,
      styleZ: getComputedStyle(el).zIndex,
      inLb: !!(top && top.closest && top.closest('.gal-lb')),
      topDesc: top ? (top.className || top.tagName) : '(null)',
      w: r.width, h: r.height,
    };
  });
  chk('灯箱已打开且可见', lb.shown === true);
  if (lb.shown) {
    chk('★ 灯箱铺满视口（宽高 > 500）', lb.w > 500 && lb.h > 500, `${Math.round(lb.w)}×${Math.round(lb.h)}`);
    chk('★★ 视口正中点到的**就是灯箱**（说明它真在最上层；只查 z-index 数字证明不了这一点）',
      lb.inLb === true, '正中命中：' + lb.topDesc);
  }
  await p.screenshot({ path: path.join(OUT, 'v1028-lightbox.png') });
  /* ★ 关灯箱：点右上角 ✕ —— 这同时是**回归判据**。
     v10.28 之前点 ✕ 关不掉（document 级 click 处理里漏了 .gal-lb-x 分支，
     落进最后一个 return 什么都不做），用户只能按 Esc —— 而「✕ 存在 / 可见 / 可点」
     三项断言当时**全部为真**，典型的假绿。 */
  await p.evaluate(() => { const x = document.querySelector('.gal-lb-x'); if (x) x.click(); });
  await sleep(600);
  const lbClosed = await p.evaluate(() => {
    const el = document.querySelector('.gal-lb');
    return { gone: !el || !el.parentNode };
  });
  chk('★ 点右上角 ✕ 能关掉灯箱（v10.28 修：此前点 ✕ 无反应，只能按 Esc）',
    lbClosed.gone === true, lbClosed.gone ? '已移除' : '灯箱仍在（后续截图会被它遮住）');

  /* ---------- ④ 固定底栏 ---------- */
  console.log('\n=== ④ 操作按钮组固定在底部 ===');
  const dock = await p.evaluate(() => {
    const el = document.querySelector('#drawerBody .d-dock');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const strip = el.querySelector('#dlStrip');
    return {
      pos: getComputedStyle(el).position,
      bottom: r.bottom, innerH: window.innerHeight, h: r.height, w: r.width,
      hasStrip: !!strip,
      stripBtns: strip ? strip.querySelectorAll('.ds').length : 0,
      // 底栏是否覆盖在正文之上（视觉上「固定住」而不是被内容挤走）
      cover: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) !== null,
    };
  });
  chk('底栏存在且 position=sticky', !!dock && dock.pos === 'sticky', dock ? dock.pos : '');
  if (dock) {
    chk('★ 底栏贴底（bottom ≈ 视口高度）', Math.abs(dock.bottom - dock.innerH) < 6,
      `bottom=${Math.round(dock.bottom)} innerH=${dock.innerH}`);
    chk('★ 底栏真占版面', dock.h > 60 && dock.w > 500, `${Math.round(dock.w)}×${Math.round(dock.h)}`);
    chk('★ 三个下载按钮确实在底栏里（不是只剩个空壳）', dock.hasStrip && dock.stripBtns >= 1,
      `.ds ×${dock.stripBtns}`);
  }
  await p.screenshot({ path: path.join(OUT, 'v1028-dock.png') });

  /* ---------- ⑤ 手机配置：5 台机型 + 硬件面板两组 ---------- */
  console.log('\n=== ⑤ 手机模拟器配置 ===');
  const mob = await p.evaluate(() => {
    const list = document.querySelector('#bhDevSlot .d-devlist');
    const devs = list ? list.querySelectorAll('.dv') : [];
    const more = document.querySelector('#bhMoreSlot .d-more-btn');
    const r = more ? more.getBoundingClientRect() : null;
    return {
      n: devs.length,
      listW: list ? list.getBoundingClientRect().width : 0,
      more: more ? more.textContent.trim() : '',
      moreW: r ? r.width : 0, moreH: r ? r.height : 0,
      overflowX: list ? list.scrollWidth > list.clientWidth + 2 : false,
    };
  });
  chk('机型清单渲染出来了', mob.n > 0, mob.n + ' 台');
  chk('★ 默认只露 ≤5 台（用户口径「默认展示5个」）', mob.n > 0 && mob.n <= 5, mob.n + ' 台');
  chk('机型行真占版面（宽 > 150px）', mob.listW > 150, Math.round(mob.listW) + 'px');
  chk('★ 「更多」入口存在且真占版面', !!mob.more && mob.moreW > 80 && mob.moreH > 16,
    mob.more + ` (${Math.round(mob.moreW)}×${Math.round(mob.moreH)})`);

  /* 点机型 → 硬件面板。
     ★ kalvo **只按营销名收录**，样本游戏的首台机型不一定命中；未命中时面板会如实显示
       「没查到这台机型的参数」（那是正确行为，但测不到「只留两组」）。所以逐台试到成品为止。
       首版只点第一台，撞上未命中就红了三条 —— 是**样本选择问题，不是实现问题**。 */
  let hw = null, tried = 0;
  for (let i = 0; i < 5; i++) {
    await p.evaluate((idx) => {
      const ds = [...document.querySelectorAll('#bhDevSlot .d-devlist .dv')];
      if (ds[idx]) ds[idx].click();
    }, i);
    await sleep(4800);
    tried = i + 1;
    hw = await p.evaluate(() => {
      const box = document.querySelector('#bhHwSlot .d-hw');
      if (!box) return null;
      const groups = [...box.querySelectorAll('.grp > h4')].map((x) => x.textContent.trim());
      const head = (box.querySelector('.hw-hd') || {}).innerText || '';
      const rows = [...box.querySelectorAll('.kvs2 > div')].map((x) => x.innerText.replace(/\s+/g, ' ').trim());
      const r = box.getBoundingClientRect();
      return { hit: groups.length > 0, groups, head: head.replace(/\s+/g, ' '), rows, w: r.width, h: r.height };
    });
    if (hw && hw.hit) break;
  }
  chk('点机型后硬件面板渲染出来了（成品面板或「未收录」如实态）', !!hw, `试了 ${tried} 台`);
  chk('★ 至少一台机型的 kalvo 参数命中（未命中就测不到下面的精简判据）', !!(hw && hw.hit),
    hw ? hw.head.slice(0, 70) : '');
  if (hw && hw.hit) {
    console.log('     面板头：' + hw.head.slice(0, 90));
    console.log('     分组：' + (hw.groups.join(' / ') || '(无)'));
    console.log('     参数行：' + hw.rows.slice(0, 3).join(' | ').slice(0, 120));
    chk('★ 面板只有「硬件配置」一组（v10.28 精简：品牌/型号/硬件配置）',
      hw.groups.length === 1 && /硬件配置/.test(hw.groups[0]), hw.groups.join('/'));
    /* ★ 这条**只**钉「头部给出了机型名」。
       首版写成「头部给出型号 + 品牌」是 over-claim：kalvo 有些机型的「基本信息」组里
       压根没有「品牌」字段（实测 Huawei nova Y60 就是），那时不渲染品牌 tag 是**如实行为**，
       判红等于把数据差异当成 bug。品牌 tag 的渲染逻辑由静态套件钉
       （test-v1028-detail.js ⑥ 段 /品牌 \$\{esc\(brand\)\}/）。 */
    chk('★ 头部给出机型名（kalvo 有品牌字段时另带品牌 tag）',
      hw.head.trim().length > 4, hw.head.slice(0, 60));
    if (!/品牌/.test(hw.head)) {
      console.log('     （这台机型的 kalvo「基本信息」里没有品牌字段 ⇒ 未渲染品牌 tag，是如实行为）');
    }
    chk('参数行有内容且真占版面', hw.rows.length >= 5 && hw.w > 200 && hw.h > 80,
      `${hw.rows.length} 行 · ${Math.round(hw.w)}×${Math.round(hw.h)}`);
  }
  await p.screenshot({ path: path.join(OUT, 'v1028-mobile.png') });

  /* ---------- ⑥ 三专区预览 + 弹窗分页 ---------- */
  console.log('\n=== ⑥ 三专区预览与弹窗分页 ===');
  const dl = await p.evaluate(() => {
    const blocks = [...document.querySelectorAll('#dlSlot .dl-prev')];
    return blocks.map((b) => ({
      sec: b.getAttribute('data-sec'),
      rows: b.querySelectorAll('.dl-it').length,
      btn: (b.querySelector('.dl-all') || {}).textContent || '',
      btnW: b.querySelector('.dl-all') ? b.querySelector('.dl-all').getBoundingClientRect().width : 0,
      w: b.getBoundingClientRect().width,
    }));
  });
  chk('三专区各成一块', dl.length >= 2, dl.map((x) => x.sec + '(' + x.rows + ')').join(' / '));
  chk('★ 每块只露 ≤3 帖', dl.length > 0 && dl.every((x) => x.rows <= 3), dl.map((x) => x.rows).join('/'));
  chk('★ 每块真占版面（宽 > 200px）', dl.length > 0 && dl.every((x) => x.w > 200), dl.map((x) => Math.round(x.w)).join('/'));
  const withBtn = dl.filter((x) => /全部 \d+ 帖/.test(x.btn));
  chk('★ 帖数 >3 的专区给了「全部 N 帖 →」入口', withBtn.length > 0,
    withBtn.map((x) => x.sec + ':' + x.btn.trim()).join(' / ') || '(无)');

  /* 点「全部」→ 弹窗分页 */
  const clicked = await p.evaluate(() => {
    const b = document.querySelector('#dlSlot .dl-all');
    if (!b) return false;
    b.click(); return true;
  });
  chk('能点到「全部」按钮', clicked === true);
  if (clicked) {
    await sleep(1200);
    const pop = await p.evaluate(() => {
      const body = document.getElementById('dlBody');
      const pop = document.getElementById('dlPop');
      const r = pop ? pop.getBoundingClientRect() : null;
      return {
        visible: !!pop && !pop.hidden,
        w: r ? r.width : 0, h: r ? r.height : 0,
        rows: body ? body.querySelectorAll('.dl-it').length : 0,
        tabs: body ? body.querySelectorAll('.df-tab').length : 0,
        pgN: (body && body.querySelector('.df-pg-n') || {}).textContent || '',
        hasPager: !!(body && body.querySelector('.df-pager')),
        first: body && body.querySelector('.dl-it') ? body.querySelector('.dl-it').innerText.slice(0, 40).replace(/\s+/g, ' ') : '',
      };
    });
    chk('弹窗打开且真占版面', pop.visible && pop.w > 400 && pop.h > 200, `${Math.round(pop.w)}×${Math.round(pop.h)}`);
    chk('★ 每页 ≤10 帖（用户口径「弹窗显示十个」）', pop.rows > 0 && pop.rows <= 10, pop.rows + ' 帖');
    chk('★ 有页码指示与翻页条', /1 \/ \d+/.test(pop.pgN) && pop.hasPager, pop.pgN + (pop.hasPager ? ' + pager' : ' 无 pager'));
    chk('多专区时给切换标签', pop.tabs >= 2, pop.tabs + ' 个标签');
    await p.screenshot({ path: path.join(OUT, 'v1028-dlpop.png') });

    /* 翻页 */
    const paged = await p.evaluate(async () => {
      const btn = [...document.querySelectorAll('#dlBody .df-pg')].find((x) => /下一页/.test(x.textContent));
      if (!btn || btn.disabled) return { ok: false, why: btn ? '末页(disabled)' : '找不到下一页' };
      const before = (document.querySelector('#dlBody .dl-it') || {}).innerText || '';
      btn.click();
      await new Promise((r) => setTimeout(r, 600));
      const body = document.getElementById('dlBody');
      return {
        ok: true,
        pg: (body.querySelector('.df-pg-n') || {}).textContent || '',
        changed: ((body.querySelector('.dl-it') || {}).innerText || '') !== before,
        scrollTop: body.scrollTop,
      };
    });
    chk('★ 翻页真的翻得动（内容变了）', paged.ok === true && paged.changed === true,
      paged.ok ? paged.pg + ' · scrollTop=' + paged.scrollTop : paged.why);
    await p.screenshot({ path: path.join(OUT, 'v1028-dlpop-p2.png') });

    /* 切专区 → 页码必须归 1 */
    /* ★ 页码判据取自 `.df-note` 的「第 N / M 页」，**不能**读 `.df-pg-n` ——
       切到的专区可能只有 2 帖（不足一页），那时压根不渲染分页条，
       读分页条会得到空串 ⇒ 假红（首版就是这样红的）。
       同时钉「该专区真的有内容」，防切过去是空页却因为读不到页码被判成通过。 */
    const sw = await p.evaluate(async () => {
      const tabs = [...document.querySelectorAll('#dlBody .df-tab')];
      const other = tabs.find((x) => !x.classList.contains('on'));
      if (!other) return { ok: false, why: '只有一个专区' };
      other.click();
      await new Promise((r) => setTimeout(r, 700));
      const body = document.getElementById('dlBody');
      const note = (body.querySelector('.df-note') || {}).textContent || '';
      const m = /第 (\d+) \/ (\d+) 页/.exec(note);
      return {
        ok: true,
        pg: m ? m[1] : '', pages: m ? m[2] : '',
        rows: body.querySelectorAll('.dl-it').length,
        on: (body.querySelector('.df-tab.on') || {}).textContent || '',
      };
    });
    chk('★ 切专区后页码归 1 且该专区有内容（不归会落在空页上，看起来像「这个专区没资源」）',
      sw.ok === true && sw.pg === '1' && sw.rows > 0,
      sw.ok ? `${sw.on.trim()} → 第 ${sw.pg}/${sw.pages} 页 · ${sw.rows} 帖` : sw.why);
  }

  /* ---------- ⑦ 无 JS 报错 ---------- */
  console.log('\n=== ⑦ 运行期错误 ===');
  chk('页面无 JS 报错', errs.length === 0, errs.slice(0, 3).join(' | ') || '(无)');

  console.log(`\n${'='.repeat(60)}`);
  console.log(`实拍结果：${pass} / ${pass + fail} 通过${fail ? `，${fail} 失败` : ''}`);
  console.log(`样本：${sample.title}（${sample.id}）`);
  console.log(`截图目录：${OUT}`);
  console.log('='.repeat(60));
  for (const pg of await b.pages()) { try { await pg.close(); } catch (e) {} }
  await h.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('实拍脚本异常：', e); process.exit(1); });
