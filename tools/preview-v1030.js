/* tools/preview-v1030.js — v10.30「置顶不再闪 + 卡片格式统一」浏览器实拍 + 断言
 *
 * 把 _probe-v1030a.js（诊断）/ _probe-v1030b.js（改造后实测）里量到的数字**固化成断言**。
 * 探针只记录、不断言 —— 它证明「这一次是对的」，固化后的套件才保证「以后一直是对的」。
 *
 * 两层各管一半（缺一层就会出现「静态绿、线上错」）：
 *   ① 置顶不闪  —— 这条**必须**在真实浏览器里量：
 *      抖动来自**滚动锚定**（文档矮了 → 浏览器改写 scrollTop → 又越过阈值 → 再翻转），
 *      纯静态断言永远看不见「浏览器自己动了」这件事。
 *   ② 卡片统一  —— 这条**必须**在真实数据上量：
 *      静态断言只能证明「CSS 里写了 aspect-ratio」，证明不了「渲染出来宽度真的都是 106」。
 *      实测过同族卡片量到 106 与 123.2 两个宽度 —— 那正是因为 flex item 的 min-width:auto
 *      被长标题撑开，纯读 CSS 是完全看不出来的。
 *
 * 运行：node tools/preview-v1030.js      （需服务已在 8123 运行；含 puppeteer，**要加大超时**）
 * 产出：_preview/v1030-live-*.png
 *
 * ★ 判据来源：_probe-v1030b.js 实测（v10.29 同场景 21 次翻转 → v10.30 0 次）。
 */
const fs = require('fs');
const path = require('path');
const { connectBrowser, sleep } = require('./browser');

const BASE = process.env.BASE || 'http://127.0.0.1:8123';
const OUT = path.join(__dirname, '..', '_preview');
const SID = process.env.SID || 'xd-419';
const STTL = process.env.STTL || "博德之门3/Baldur's Gate 3";

let pass = 0, fail = 0;
function chk(name, ok, extra) {
  if (ok) { pass++; console.log('  ✅ ' + name + (extra ? '  — ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  — ' + extra : '')); }
}
const J = (o) => JSON.stringify(o);
const R1 = (n) => Math.round(n * 10) / 10;

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const h = await connectBrowser();
  const p = await h.browser.newPage();
  await p.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));

  console.log('\n=== ⓪ 打开详情页样本 ===');
  await p.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1200);
  await p.evaluate((s) => window.openDetailById(s.id, s.title), { id: SID, title: STTL });
  const ready = await p.evaluate(() => new Promise((res) => {
    const t = setTimeout(() => res('timeout'), 40000);
    const w = setInterval(() => {
      const b = document.getElementById('drawerBody');
      if (b && (b.querySelector('.rel-row .rel-it') || b.querySelector('.x-src .x-it'))) {
        clearInterval(w); clearTimeout(t); res('ok');
      }
    }, 400);
  }));
  await sleep(3500);
  chk('详情页样本加载完成（有同类游戏卡或跨源链接卡）', ready === 'ok', ready);

  /* =========================================================================
   * ① 置顶小标题条：不闪 / 不推动正文 / 不触发滚动锚定自激
   * ======================================================================= */
  const hero = await p.evaluate(async () => {
    const dr = document.getElementById('drawer');
    const heroEl = document.getElementById('dHero');
    const mini = document.getElementById('dMini');
    const body = document.getElementById('drawerBody');
    if (!dr || !mini || !heroEl) return { err: 'missing nodes' };
    const s2 = (ms) => new Promise((r) => setTimeout(r, ms));
    const snap = () => {
      const mr = mini.getBoundingClientRect();
      const hr = heroEl.getBoundingClientRect();
      const br = (body.querySelector('.d-body') || body).getBoundingClientRect();
      return {
        y: Math.round(dr.scrollTop),
        heroH: +hr.height.toFixed(1),
        miniOn: mini.classList.contains('on'),
        miniH: +mr.height.toFixed(1),
        miniTop: +mr.top.toFixed(1),
        miniOpacity: +Number(getComputedStyle(mini).opacity).toFixed(2),
        miniVis: getComputedStyle(mini).visibility,
        bodyTop: +br.top.toFixed(1),
      };
    };
    const flips = (el) => {
      let n = 0, last = el.classList.contains('on');
      const ob = new MutationObserver(() => {
        const c = el.classList.contains('on');
        if (c !== last) { n++; last = c; }
      });
      ob.observe(el, { attributes: true, attributeFilter: ['class'] });
      return { ob, get: () => n };
    };

    dr.scrollTop = 0; await s2(700);
    const atTop = snap();

    /* A. 旧阈值 90px 附近来回滚 —— 这正是用户看到「一直闪」的场景。
        v10.29 实测 21 次翻转；改完应为 0（小条与大图不再互相切换高度）。 */
    const A = flips(mini);
    const wanderOld = [70, 78, 84, 88, 92, 95, 89, 93, 87, 91, 90, 94, 86, 96];
    const trace = [];
    for (const y of wanderOld) {
      dr.scrollTop = y; await s2(120);
      trace.push({ set: y, y: Math.round(dr.scrollTop), on: mini.classList.contains('on') });
    }
    await s2(500);
    A.ob.disconnect();
    const flipsOld = A.get();

    /* B. 新阈值 200 附近来回滚 10 次：只应由「静止态首次越过」翻 1 次，
        此后在滞后带内来回都不再翻（双阈值 MINI_GAP=50 的作用）。 */
    dr.scrollTop = 0; await s2(700);
    const B = flips(mini);
    const wanderNew = [190, 205, 196, 208, 193, 202, 199, 206, 194, 201];
    for (const y of wanderNew) { dr.scrollTop = y; await s2(120); }
    await s2(500);
    B.ob.disconnect();
    const flipsNew = B.get();

    /* C. 越过阈值：hero 高度不该变、正文不该被额外推动 */
    dr.scrollTop = 0; await s2(700);
    const beforeCross = snap();
    dr.scrollTop = 320; await s2(700);
    const afterCross = snap();

    /* D. 高度恒定：多个滚动位置下 hero 高度 */
    const heights = [];
    for (const y of [0, 120, 210, 320, 600, 1200]) {
      dr.scrollTop = y; await s2(420);
      heights.push({
        y: Math.round(dr.scrollTop),
        heroH: +heroEl.getBoundingClientRect().height.toFixed(1),
        on: mini.classList.contains('on'),
      });
    }

    /* E. 滚动锚定自激：设 320 后静置，看浏览器会不会自己改写 scrollTop。
        旧实现从 250 → 62 会让文档矮 188px，浏览器为保住视觉位置改写 scrollTop
        ⇒ 又越过阈值 ⇒ 再翻转 —— **不需要用户操作也自己振**。 */
    dr.scrollTop = 320; await s2(200);
    const y0 = Math.round(dr.scrollTop);
    await s2(1400);
    const y1 = Math.round(dr.scrollTop);

    /* F. 小条里的关闭键：大图滚走时原关闭键跟着走了，没有它用户就关不掉抽屉 */
    const closeBtns = mini.querySelectorAll('.d-close').length;

    return {
      atTop, flipsOld, nOld: wanderOld.length, trace,
      flipsNew, nNew: wanderNew.length,
      beforeCross, afterCross, heights,
      anchor: { set: 320, y0, y1, drifted: y1 - y0 },
      closeBtns,
    };
  });

  console.log('\n=== ① 置顶小标题条（不闪 / 不推正文 / 不自激）===');
  if (hero.err) {
    chk('找到抽屉 / 大图 / 小条三个节点', false, hero.err);
  } else {
    chk('回顶态：小条未激活（on=false 且 opacity≈0）',
      hero.atTop.miniOn === false && hero.atTop.miniOpacity < 0.05,
      J({ on: hero.atTop.miniOn, opacity: hero.atTop.miniOpacity }));

    chk('★ 旧阈值 90px 附近来回滚 ' + hero.nOld + ' 次 ⇒ 翻转 0 次（v10.29 同场景 21 次）',
      hero.flipsOld === 0, '实测翻转 ' + hero.flipsOld + ' 次');

    chk('★ 新阈值 200px 附近来回滚 ' + hero.nNew + ' 次 ⇒ 只翻 1 次（首次越过；滞后带内不再反复）',
      hero.flipsNew === 1, '实测翻转 ' + hero.flipsNew + ' 次');

    const heroDrift = R1(hero.afterCross.heroH - hero.beforeCross.heroH);
    chk('★★ 越阈值时大图高度变化 0.0px（高度全程不变 ⇒ 文档高度不变）',
      Math.abs(heroDrift) < 0.5,
      '变化 ' + heroDrift + 'px（' + hero.beforeCross.heroH + ' → ' + hero.afterCross.heroH + '）');

    const bodyDrift = R1(hero.afterCross.bodyTop - (hero.beforeCross.bodyTop - 320));
    chk('★★ 越阈值时正文零额外位移（v10.29 为 +188px，正是抖动的直接来源）',
      Math.abs(bodyDrift) < 1,
      '额外位移 ' + bodyDrift + 'px（应为 0）');

    const hs = [...new Set(hero.heights.map((x) => x.heroH))];
    chk('大图高度在 6 个滚动位置（0/120/210/320/600/1200）全部恒定',
      hs.length === 1 && hs[0] === 250,
      '唯一值 ' + J(hs) + '（应为 [250]）');

    chk('★ 滚动锚定不自激：静置 1.4s 后 scrollTop 未被浏览器改写',
      hero.anchor.drifted === 0,
      '设 320 → 1.4s 后 ' + hero.anchor.y1 + '（漂移 ' + hero.anchor.drifted + '）');

    chk('小条激活后真贴顶且可见（top≈0、opacity=1、visibility=visible）',
      Math.abs(hero.afterCross.miniTop) < 1 && hero.afterCross.miniOpacity > 0.95 &&
      hero.afterCross.miniVis === 'visible',
      J({ top: hero.afterCross.miniTop, opacity: hero.afterCross.miniOpacity, vis: hero.afterCross.miniVis }));

    chk('小条高度恒 62px（激活态）', hero.afterCross.miniH === 62, hero.afterCross.miniH + 'px');

    chk('★ 小条自带关闭键 ≥1（大图滚走时原关闭键跟着走了，否则用户关不掉抽屉）',
      hero.closeBtns >= 1, hero.closeBtns + ' 个');

    chk('小条激活时大图已滚出视口（不重叠）',
      hero.afterCross.heroH === 250 && hero.afterCross.y >= 320,
      'scrollTop=' + hero.afterCross.y);
  }

  /* 截图：小条激活态（同样先断言「真拍到了」，再落盘） */
  const shotMini = await p.evaluate(() => {
    const dr = document.getElementById('drawer');
    dr.scrollTop = 420;
    return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => {
      const m = document.getElementById('dMini');
      res({
        scrollTop: Math.round(dr.scrollTop),
        on: m.classList.contains('on'),
        top: +m.getBoundingClientRect().top.toFixed(1),
        drTop: +dr.getBoundingClientRect().top.toFixed(1),
        h: +m.getBoundingClientRect().height.toFixed(1),
      });
    })));
  });
  chk('★ 截图前确认：小条已激活且贴在抽屉顶（否则截出来是「没有小条」的图）',
    shotMini.on === true && Math.abs(shotMini.top - shotMini.drTop) < 1 && shotMini.h === 62,
    J(shotMini));
  await sleep(700);
  await p.screenshot({ path: path.join(OUT, 'v1030-live-mini.png') });

  /* ---------------------------------------------------------------------
   * ①-b 深滚仍贴顶（「置顶」是对**整页**的承诺，不只是阈值附近那 300px）
   * ★ 为什么必须单独测：sticky 的约束是「不超出**包含块**」，而包含块 = 最近的块级祖先。
   *   将来只要有人给正文套一层 `overflow:hidden` 或 `transform` 的容器，
   *   sticky 会**静默失效**（元素照旧存在、样式照旧写着 sticky、断言照旧绿）。
   * ⚠️ 读数必须等**两帧 + 过渡（.26s）走完**：同一帧里写 scrollTop 再读 rect，
   *   拿到的是未重排的陈旧值 —— 本次实测就因此把「贴顶正常」误判成「脱顶 -63.2」。
   * ------------------------------------------------------------------- */
  const deep = await p.evaluate(async () => {
    const dr = document.getElementById('drawer');
    const mini = document.getElementById('dMini');
    const s2 = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = [];
    for (const y of [300, 900, 1500, 2200, dr.scrollHeight]) {
      dr.scrollTop = y;
      await s2(600);                     // ★ 600ms > 过渡 260ms，避免读到动画中间值
      out.push({
        set: y, got: Math.round(dr.scrollTop),
        top: +mini.getBoundingClientRect().top.toFixed(1),
        h: +mini.getBoundingClientRect().height.toFixed(1),
        on: mini.classList.contains('on'),
      });
    }
    return { out, max: dr.scrollHeight - dr.clientHeight };
  });
  const bad = deep.out.filter((x) => x.top < -0.5 || x.top > 0.5 || !x.on || x.h !== 62);
  chk('★★ 深滚（含滚到底）小条仍恒贴顶 62px（sticky 包含块没被人破坏）',
    bad.length === 0,
    bad.length ? '脱顶/异常：' + J(bad) : deep.out.map((x) => x.got + '→top ' + x.top).join(' · '));

  /* =========================================================================
   * ② 卡片族：宽度 / 比例 / 圆角 / 预留两行
   * ======================================================================= */
  const cards = await p.evaluate(() => {
    const lines = (el) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      const lh = parseFloat(cs.lineHeight) || 1;
      const r = el.getBoundingClientRect();
      return {
        h: +r.height.toFixed(1),
        lh: +lh.toFixed(1),
        rows: Math.round(el.scrollHeight / lh),
        clamp: cs.webkitLineClamp,
        ws: cs.whiteSpace,
        minH: +parseFloat(cs.minHeight).toFixed(1),
        overflow: cs.overflow,
        textOverflow: cs.textOverflow,
      };
    };
    const out = {};

    /* 同类游戏：**同一族每一张**都要量（只量第一张会漏掉「被长标题撑开的那张」）*/
    const rels = [...document.querySelectorAll('.rel-row .rel-it')];
    out.rel = {
      n: rels.length,
      widths: rels.map((x) => +x.getBoundingClientRect().width.toFixed(1)),
      radii: rels.map((x) => getComputedStyle(x).borderRadius),
      imgs: rels.map((x) => {
        const im = x.querySelector('img');
        if (!im) return null;
        const r = im.getBoundingClientRect();
        return {
          w: +r.width.toFixed(1), h: +r.height.toFixed(1),
          ratio: +(r.width / r.height).toFixed(3),
          radius: getComputedStyle(im).borderRadius,
        };
      }),
      titles: rels.map((x) => lines(x.querySelector('.t'))),
      heights: rels.map((x) => +x.getBoundingClientRect().height.toFixed(1)),
    };

    /* 跨源链接卡 */
    const xit = document.querySelector('.x-src .x-it');
    out.xit = xit ? {
      radius: getComputedStyle(xit).borderRadius,
      title: lines(xit.querySelector('.bd .t')),
      bdWs: getComputedStyle(xit.querySelector('.bd')).whiteSpace,
      txt: (xit.querySelector('.bd .t') || {}).textContent || '',
    } : { missing: true };
    return out;
  });

  console.log('\n=== ② 卡片族：统一格式与图片尺寸 ===');
  const rel = cards.rel;
  if (!rel.n) {
    chk('找到同类游戏卡', false, '0 张（样本没带同类推荐？换 SID 重跑）');
  } else {
    const wu = [...new Set(rel.widths)];
    chk('★★ 同类游戏卡宽度**逐张**一致（v10.30 前实测出现 106 与 123.2 两个宽度）',
      wu.length === 1 && wu[0] === 106,
      '唯一值 ' + J(wu) + '（应为 [106]；共 ' + rel.n + ' 张）');

    const ratios = rel.imgs.filter(Boolean).map((x) => x.ratio);
    const ru = [...new Set(ratios)];
    chk('★★ 缩略图比例**逐张**一致 = 16:9（1.778）',
      ru.length === 1 && Math.abs(ru[0] - 1.778) < 0.01,
      '唯一值 ' + J(ru) + '（应为 [1.778]）');

    const irad = [...new Set(rel.imgs.filter(Boolean).map((x) => x.radius))];
    chk('缩略图圆角统一 = var(--cd-th-r) = 9px', irad.length === 1 && irad[0] === '9px', J(irad));

    const crad = [...new Set(rel.radii)];
    chk('卡片圆角统一 = var(--cd-r) = 12px', crad.length === 1 && crad[0] === '12px', J(crad));

    const rows = [...new Set(rel.titles.map((t) => t && t.rows))];
    chk('★ 标题占位恒为 2 行（长标题 clamp 到 2、短标题也占满 2）',
      rows.length === 1 && rows[0] === 2, '唯一值 ' + J(rows));

    const minH = [...new Set(rel.titles.map((t) => t && t.minH))];
    chk('★ 标题 min-height = 2 × 行高（这是「固定预留两行」的实现要害，只 clamp 不 min-height 就会不等高）',
      minH.length === 1 && Math.abs(minH[0] - rel.titles[0].lh * 2) < 1.2,
      'min-height ' + J(minH) + ' · 行高 ' + rel.titles[0].lh);

    const ch2 = [...new Set(rel.titles.map((t) => t && t.clamp))];
    chk('标题 -webkit-line-clamp = 2（超出省略号）',
      ch2.length === 1 && String(ch2[0]) === '2', J(ch2));

    const hh = [...new Set(rel.heights)];
    chk('★ 同类游戏卡**卡片高度**一致（预留两行的最终目的：一排卡片等高）',
      hh.length === 1, '唯一值 ' + J(hh));
  }

  if (cards.xit.missing) {
    chk('找到跨源链接卡', false, '0 张（样本没带跨源链接？换 SID 重跑）');
  } else {
    const x = cards.xit;
    chk('跨源链接卡标题占两行 + clamp 2',
      x.title && x.title.rows === 2 && String(x.title.clamp) === '2',
      J({ rows: x.title && x.title.rows, clamp: x.title && x.title.clamp, h: x.title && x.title.h }));
    chk('★ 跨源链接卡父级 `.bd` 不带 nowrap（父级 nowrap 会压住子级 clamp，等于没改）',
      x.bdWs !== 'nowrap', '白空格 = ' + x.bdWs);
    chk('跨源链接卡 min-height = 两行高', x.title && x.title.minH > 20,
      'min-height ' + (x.title && x.title.minH) + 'px');
    chk('跨源链接卡圆角 = var(--cd-r) = 12px', x.radius === '12px', x.radius);
  }

  /* 截图：同类游戏 + 跨源链接
     ⚠️ 取景必须**确定性**：`.rel-row` 在内容偏移 ~2350 处，而抽屉内容高 ~2855、视口 1000
        ⇒ 最大滚动量只有 ~1855，滚到底它也只能到抽屉内 ~497px 处，**永远到不了「贴顶 90px」**。
        早先按「拉到离顶 90px」算，`scrollTop` 被静默夹到 maxScroll，截出来的图与预期不符
        （而 `scrollTop` 赋值被夹不会报错 —— 正是本项目「静默失真」那一类）。
        现在改成：滚到底 + **截图前断言卡片真在视口内**（条数 >0 且顶部在视口内）。 */
  const shot = await p.evaluate(() => {
    const dr = document.getElementById('drawer');
    dr.scrollTop = dr.scrollHeight;                       // 滚到底（浏览器会夹到 maxScroll，这是我们要的）
    return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => {
      const drTop = dr.getBoundingClientRect().top;
      const items = [...document.querySelectorAll('#drawerBody .rel-row .rel-it')];
      res({
        scrollTop: Math.round(dr.scrollTop),
        maxScroll: dr.scrollHeight - dr.clientHeight,
        n: items.length,
        tops: items.map((x) => +x.getBoundingClientRect().top.toFixed(0)),
        h: dr.clientHeight,
        miniOn: document.getElementById('dMini').classList.contains('on'),
      });
    })));
  });
  chk('★ 截图前确认：同类游戏卡真在视口内（否则截图是「看着挺好但没拍到」）',
    shot.n > 0 && shot.tops.every((t) => t > 0 && t < shot.h),
    `n=${shot.n} · scrollTop=${shot.scrollTop}/${shot.maxScroll} · tops=${J(shot.tops)} · 视口高 ${shot.h}`);
  await sleep(700);
  await p.screenshot({ path: path.join(OUT, 'v1030-live-cards.png') });

  /* ---------- ③ 运行期错误 ---------- */
  console.log('\n=== ③ 运行期错误 ===');
  chk('页面无 JS 报错', errs.length === 0, errs.slice(0, 3).join(' | ') || '(无)');

  console.log(`\n${'='.repeat(60)}`);
  console.log(`实拍结果：${pass} / ${pass + fail} 通过${fail ? `，${fail} 失败` : ''}`);
  console.log(`样本：${SID}`);
  console.log(`截图：_preview/v1030-live-mini.png · _preview/v1030-live-cards.png`);
  console.log('='.repeat(60));
  for (const pg of await h.browser.pages()) { try { await pg.close(); } catch (e) {} }
  await h.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('实拍脚本异常：', e); process.exit(1); });
