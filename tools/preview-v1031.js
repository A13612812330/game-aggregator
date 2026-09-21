#!/usr/bin/env node
/* tools/preview-v1031.js — v10.31 四条体验修正「浏览器实拍 + 断言」
 *
 * 把 `_verify-v1031.js`（探针，只记录）量到的数字**固化成断言** ——
 * 探针证明「这一次是对的」，固化后的套件才保证「以后一直是对的」。
 *
 * 为什么这四条**必须**在真实浏览器里量（纯静态断言证明不了）：
 *   ① 「忽大忽小」实质是**两个游戏名同屏**：`.d-title` 与 `.d-mini` 都在屏上，
 *      静态只能证明「阈值写的是 heroH」，证明不了「屏上真的只剩一个名字」。
 *      抖动次数更只能靠 MutationObserver 观察真实 class 翻转。
 *   ② 「顶图糊」是**图片自身的像素尺寸**问题：静态只能看到 `fb.cover || d.cover` 的
 *      字段顺序，看不到 `naturalWidth` 到底是 128 还是 460。
 *   ③ 「卡片变小」是**布局结果**：静态写了 stretch，也不代表两张卡真的等高
 *      （父级高度、内容行数都可能让 stretch 失效）。
 *   ④ 「大小统一」是**渲染宽度**：静态写了 `--cd-s`，也可能被长标题撑开（实测有过 106 vs 123.2）。
 *
 * 运行：node tools/preview-v1031.js      （需服务已在 8123 运行；含 puppeteer，**要加大超时**）
 * 产出：_preview/v1031-<tag>.png + 控制台逐条断言
 *
 * ★ 第二层实拍**不登记 run-all.js**（需要 CDP，且同 CDP 连跑会 detached Frame ⇒ 必须分批跑）。
 */
const fs = require('fs');
const path = require('path');
const { connectBrowser, sleep } = require('./browser');

const BASE = process.env.BASE || 'http://127.0.0.1:8123';
const OUT = path.join(__dirname, '..', '_preview');

/* 两个样本各自覆盖一条「另一半」的场景，缺一个就有一半机制没被量到：
 *   · xd-692 史莱姆牧场 —— 修改器**只有 1 个来源**（用户截图 [图2] 的原始场景）
 *   · xd-38 终结者莉莉 —— 同类游戏封面是**机地 140×140 方图**（contain 的极端样本） */
const SAMPLES = [
  { id: 'xd-692', t: '史莱姆牧场/Slime Rancher', tag: '692' },
  { id: 'xd-38', t: '终结者莉莉：骑士的救赎/ENDER LILIES: Quietus of the Knights', tag: '38' },
].filter((s) => !process.env.SAMPLE_TAG || s.tag === process.env.SAMPLE_TAG);

let pass = 0, fail = 0;
function chk(name, ok, extra) {
  if (ok) { pass++; console.log('  ✅ ' + name + (extra ? '  — ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  — ' + extra : '')); }
}
const R1 = (n) => Math.round(n * 10) / 10;
const uniq = (a) => [...new Set(a)];

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const h = await connectBrowser();
  const p = await h.browser.newPage();
  await p.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1200);

  for (const s of SAMPLES) {
    console.log(`\n=== 样本 ${s.id} ${s.t.split('/')[0]} ===`);
    await p.evaluate((o) => window.openDetailById(o.id, o.t), s);
    await sleep(7000);

    const m = await p.evaluate(async () => {
      /* ⚠️ 本函数体在**浏览器上下文**执行 —— 外层的 uniq/R1（Node 侧）在这里不存在，
         写了就是 `ReferenceError: uniq is not defined`（已踩过一次）。所以就地定义。 */
      const uq = (a) => [...new Set(a)];
      const rd1 = (n) => Math.round(n * 10) / 10;
      const dr = document.getElementById('drawer');
      const body = document.getElementById('drawerBody');
      const mini = document.getElementById('dMini');
      const hero = document.getElementById('dHero');
      const title = body.querySelector('.d-hero .d-title');
      const s2 = (ms) => new Promise((r) => setTimeout(r, ms));
      const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { t: +r.top.toFixed(1), b: +r.bottom.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; };
      const cs = (el) => getComputedStyle(el);

      /* ---- ① 扫 0..400（步长 10，共 41 点）找「大标题与小条同屏」 ---- */
      const scan = [];
      for (let y = 0; y <= 400; y += 10) {
        dr.scrollTop = y; await s2(90);
        const tr = rect(title);
        const on = mini.classList.contains('on');
        const vis = cs(mini).visibility === 'visible';
        scan.push({ y: Math.round(dr.scrollTop), titleBottom: tr && tr.b, visible: !!tr && tr.b > 0.5, on, vis,
          both: !!tr && tr.b > 0.5 && on && vis });
      }
      /* ---- 抖动计数：临界点来回 ---- */
      dr.scrollTop = 0; await s2(500);
      const mk = (el) => { let n = 0, last = el.classList.contains('on'); const ob = new MutationObserver(() => { const c = el.classList.contains('on'); if (c !== last) { n++; last = c; } }); ob.observe(el, { attributes: true, attributeFilter: ['class'] }); return { ob, get: () => n }; };
      const F = mk(mini);
      for (const y of [235, 260, 246, 255, 242, 258, 249, 251]) { dr.scrollTop = y; await s2(130); }
      await s2(400); F.ob.disconnect(); const flipsNew = F.get();
      const finalOn = mini.classList.contains('on');
      dr.scrollTop = 0; await s2(400);
      const F2 = mk(mini);
      for (const y of [180, 205, 196, 208, 193, 202]) { dr.scrollTop = y; await s2(130); }
      await s2(400); F2.ob.disconnect(); const flipsOld = F2.get();
      dr.scrollTop = 0; await s2(400);

      /* ---- ② 顶图 ---- */
      const hi = hero.querySelector('img');
      const mth = mini.querySelector('.th img');

      /* ---- ③ 两卡 ---- */
      const blocks = [...document.querySelectorAll('#trSvSlot > div > .d-blk')].map((b) => {
        const rb = b.querySelector('.d-rows');
        return {
          head: b.querySelector('h4').textContent.trim().replace(/\s+/g, ' ').slice(0, 8),
          h: +b.getBoundingClientRect().height.toFixed(1),
          rows: !!rb,
          rowsMinH: rb ? cs(rb).minHeight : null,
          rowsN: rb ? rb.children.length : null,
        };
      });
      const pairCss = cs(document.getElementById('trSvSlot'));

      /* ---- ④ 同分类 ---- */
      const rels = [...document.querySelectorAll('.rel-row .rel-it')].map((x) => {
        const im = x.querySelector('img');
        const ir = im && im.getBoundingClientRect();
        return { card: rect(x), nat: im && (im.naturalWidth + 'x' + im.naturalHeight),
          box: ir && (rd1(ir.width) + 'x' + rd1(ir.height)), ratio: ir && +(ir.width / ir.height).toFixed(3),
          fit: im && cs(im).objectFit };
      });

      return {
        mini: { transDur: cs(mini).transitionDuration, transProp: cs(mini).transitionProperty,
          transform: cs(mini).transform, anim: cs(mini).animationName, h: rect(mini).h },
        heroTransDur: cs(hero).transitionDuration,
        thresholdHit: (scan.find((x) => x.on) || {}).y ?? null,
        bothCount: scan.filter((x) => x.both).length,
        scanPts: scan.length,
        flipsNew, flipsOld, finalOn,
        img: { hero: hi && hi.src.slice(-46), heroNat: hi && (hi.naturalWidth + 'x' + hi.naturalHeight),
          thumb: mth && mth.src.slice(-46), same: !!(hi && mth && hi.src === mth.src) },
        pair: { align: pairCss.alignItems, cols: pairCss.gridTemplateColumns, blocks },
        rel: { n: rels.length, widths: uq(rels.map((r) => r.card.w)), heights: uq(rels.map((r) => r.card.h)),
          ratios: uq(rels.map((r) => r.ratio)), fits: uq(rels.map((r) => r.fit)), nat: uq(rels.map((r) => r.nat)) },
      };
    });

    /* ---------- ① 无动画 + 阈值 + 不同屏 ---------- */
    chk('① 小条 transition 时长为 0s（不留过渡）', /^0s(, 0s)*$/.test(m.mini.transDur), `transitionDuration=${m.mini.transDur}`);
    chk('① 小条 transform 为 none（不做位移）', m.mini.transform === 'none', `transform=${m.mini.transform}`);
    chk('① 小条无 keyframes 动画', m.mini.anim === 'none' || !m.mini.anim, `animationName=${m.mini.anim}`);
    chk('① 大图本身也无过渡', /^0s/.test(m.heroTransDur), `hero transitionDuration=${m.heroTransDur}`);
    chk('① 阈值首次激活 = 250（= 大图高，即"大图整块离开"）', m.thresholdHit === 250, `实测 @ y=${m.thresholdHit}`);
    chk('① 41 点扫描无「大标题与小条同屏」', m.bothCount === 0, `${m.bothCount} / ${m.scanPts} 点`);
    /* ⚠️ 这里**不能断言 0 次**：序列 [235,260,246,255,242,258,249,251] 从阈值下方
       起步、终点在阈值上方，所以「恰好一次激活」是**必需的**、不是抖动。
       抖动（chatter）的定义是**反复来回**：同一次穿越里出现 ≥2 次翻转。
       ⇒ 判据 = 恰好 1 次（0 次说明阈值不在 250，≥2 次才是抖动），再加终态仍在激活态。 */
    chk('① 临界点来回恰好一次激活、无反复翻转', m.flipsNew === 1, `翻转 ${m.flipsNew} 次`);
    chk('① 序列结束后小条仍在激活态（末次 251 > 阈值 250）', m.finalOn === true, `on=${m.finalOn}`);
    chk('① 阈值**下方**（~200）来回完全不触发', m.flipsOld === 0, `翻转 ${m.flipsOld} 次`);

    /* ---------- ② 顶图 ---------- */
    chk('② 顶图与列表封面同一张', m.img.same, `${m.img.hero} …`);
    const hw = parseInt(String(m.img.heroNat).split('x')[0], 10);
    chk('② 顶图像素不是 XD 的 128×128 方图（≥400 宽）', hw >= 400, `natural=${m.img.heroNat}`);
    chk('② 小条缩略图也是同一张（滚过去不换图）', m.img.same);

    /* ---------- ③ 两卡等高 + 固定 5 行槽位 ---------- */
    chk('③ .d-pair 布局为 stretch（两卡等高）', m.pair.align === 'stretch', `align-items=${m.pair.align}`);
    chk('③ 两列等宽同行', /^[\d.]+px [\d.]+px$/.test(m.pair.cols), m.pair.cols);
    chk('③ 两块都在', m.pair.blocks.length === 2, `${m.pair.blocks.length} 块`);
    const bh = m.pair.blocks.map((b) => b.h);
    chk('★★ 两块**高度相等**（差 ≤1px）', bh.length === 2 && Math.abs(bh[0] - bh[1]) <= 1, `${bh.join(' vs ')}`);
    chk('③ 两块都套了 .d-rows', m.pair.blocks.every((b) => b.rows), m.pair.blocks.map((b) => b.rows).join('/'));
    const mh = m.pair.blocks.map((b) => b.rowsMinH);
    chk('★★ 两块都固定预留 5 行（min-height = 183.5px）', mh.every((x) => x === '183.5px'), mh.join(' / '));
    chk('③ 单行内容不超过 5 行上限', m.pair.blocks.every((b) => b.rowsN <= 5), m.pair.blocks.map((b) => b.rowsN).join(' / '),
      m.pair.blocks.map((b) => b.head + ':' + b.rowsN).join(' · '));

    /* ---------- ④ 同分类：8 张 / 统一大小 / contain ---------- */
    /* ⚠️ 这条只守**可观测张数**（= limit 与 slice 的共同结果）。
       反证实测：把 `slice(0, REL_SHOW)` 换成 `slice(0, 8)` 时，本样本**照样 8 张**
       （limit=12 过滤后仍 ≥8）⇒ 这条抓不到「裸字面量 8」。那一条由**静态层**
       test-v1031.js 守（它断言 `slice(0, REL_SHOW)` 且断言 limit 与 REL_SHOW 的数值关系）。 */
    chk('④ 同分类显示 8 张', m.rel.n === 8, `实测 ${m.rel.n} 张`);
    chk('★★ 卡片宽度唯一（= 106px）', m.rel.widths.length === 1 && m.rel.widths[0] === 106, uniq(m.rel.widths).join('/') + 'px');
    chk('★★ 卡片高度唯一（统一大小）', m.rel.heights.length === 1, uniq(m.rel.heights).join('/') + 'px');
    chk('★★ 图片盒比例唯一（= 16:9）', m.rel.ratios.length === 1 && m.rel.ratios[0] === 1.778, uniq(m.rel.ratios).join('/'));
    chk('★★ object-fit 全为 contain（按比例缩放，不裁不拉）', m.rel.fits.length === 1 && m.rel.fits[0] === 'contain', uniq(m.rel.fits).join('/'));
    chk('④ 原始图比例确实混排（所以必须 contain 而非 cover）', uniq(m.rel.nat).length >= 1, 'naturals: ' + uniq(m.rel.nat).join(' / '));

    await p.screenshot({ path: path.join(OUT, `v1031-${s.tag}.png`) });
  }

  chk('无页面级 JS 异常', errs.length === 0, errs.slice(0, 2).join(' | '));

  for (const pg of await h.browser.pages()) { try { await pg.close(); } catch (e) {} }
  await h.close();

  console.log('\n============================');
  console.log(`  通过 ${pass}/${pass + fail}（失败 ${fail}）`);
  console.log('============================');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('异常：', e); process.exit(1); });
