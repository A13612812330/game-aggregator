#!/usr/bin/env node
/* tools/preview-v1032.js — v10.32 详情页定位条两处修正「浏览器实拍 + 断言」
 *
 * 两条都必须实拍（静态断言证明不了）：
 *   ① 「修改器/云存档合并成一项」—— 静态只能证明 `D_RAIL` 里写了几项，
 *      证明不了**条上真的只画出一个圆点**（`railTarget()` 可能解析不到目标而整项不显示，
 *      那样「少了一项」的原因就完全是另一个）。项名必须从渲染后的 DOM 里读。
 *   ② 「定位时顶部被遮挡」本质是**层叠覆盖**：`.d-mini` 是
 *      `position:sticky;height:62px` 且 `margin-bottom:-62px`（不占布局），
 *      它盖在内容上但**不影响任何 rect** —— 只看 `getBoundingClientRect()`
 *      永远看不出「被盖住了」。必须用 `elementFromPoint` 问「这个点上到底是谁」
 *      （项目铁律：**存在 ≠ 可见**）。
 *
 * 运行：node tools/preview-v1032.js      （需服务在 8123；含 puppeteer，**要加大超时**）
 * 产出：_preview/v1032-<tag>.png + 控制台逐条断言
 *
 * ★ 第二层实拍不登记 run-all.js（需 CDP，且同 CDP 连跑会 detached Frame ⇒ 必须分批跑）。
 */
const fs = require('fs');
const path = require('path');
const { connectBrowser, sleep } = require('./browser');

const BASE = process.env.BASE || 'http://127.0.0.1:8123';
const OUT = path.join(__dirname, '..', '_preview');

const SAMPLES = [
  { id: 'xd-692', t: '史莱姆牧场/Slime Rancher', tag: '692' },
  { id: 'xd-38', t: '终结者莉莉：骑士的救赎/ENDER LILIES: Quietus of the Knights', tag: '38' },
].filter((s) => !process.env.SAMPLE_TAG || s.tag === process.env.SAMPLE_TAG);

/* 项名 → 正文里的目标选择器（不依赖脚本内部的 dRailItems —— 那是模块内 let，
   跨 evaluate 访问不保证可见；用项名映射更稳，也让断言写的是「用户看到的名字」）。
   ⚠️ 每项给**候选数组**而不是单选择器：`D_RAIL` 里「下载」就是 `['#dlSlot','#dlStrip']`，
      取第一个「有尺寸」的（与 railTarget 同逻辑）。只写 `#dlSlot` 的话，
      在它高度为 0 时会把断言目标指到一个空盒子上 —— 实测就是这里先报的红。 */
const MAP = {
  '评分参数': ['.kv'],
  '游戏介绍': ['.block'],
  '游戏预览': ['.gal'],
  '配置要求': ['#reqSlot'],
  '手机配置': ['#bhSlot'],
  '修改器/云存档': ['#trSvSlot'],
  '同分类': ['#relSlot'],
  '下载': ['#dlSlot', '#dlStrip'],
};

let pass = 0, fail = 0;
function chk(name, ok, extra) {
  if (ok) { pass++; console.log('  ✅ ' + name + (extra ? '  — ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  — ' + extra : '')); }
}
const R1 = (n) => Math.round(n * 10) / 10;

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
    console.log('\n=== 样本 ' + s.id + ' ' + s.t.split('/')[0] + ' ===');
    await p.evaluate((o) => window.openDetailById(o.id, o.t), s);
    /* 懒加载分区陆续回填 ⇒ 定位条会被 railSync 反复重建。等它稳定：
       项数连续两次相同再动手（否则点的是中途那一版，序号和目标节点已经错位）。 */
    let prev = -1, stable = 0;
    for (let i = 0; i < 20; i++) {
      await sleep(700);
      const n = await p.evaluate(() => document.querySelectorAll('#dRail .dr-it').length);
      if (n === prev && n > 0) { stable++; if (stable >= 2) break; } else stable = 0;
      prev = n;
    }

    /* ---------- ① 定位条项名 ---------- */
    const names = await p.evaluate(() =>
      [...document.querySelectorAll('#dRail .dr-it .dr-t')].map((x) => x.textContent.trim()));
    console.log('  条上项名(' + names.length + '): ' + names.join(' · '));
    chk('① 条上仍是**一项**「修改器/云存档」', names.includes('修改器/云存档'), '项名含『修改器/云存档』');
    chk('① 不再有单独的「修改器」项', !names.includes('修改器'), '精确匹配，不是子串');
    chk('① 不再有单独的「云存档」项', !names.includes('云存档'), '精确匹配，不是子串');
    chk('① 合并项的目标节点真的解析到了（不是整项消失）',
      await p.evaluate(() => {
        const el = document.querySelector('#trSvSlot');
        return !!(el && el.offsetWidth > 0 && el.offsetHeight > 0);
      }), '#trSvSlot 有尺寸');

    /* ---------- ② 逐项点击：跳转后目标是否被小条盖住 ---------- */
    console.log('  — 逐项跳转（每项点完测一次遮挡）—');
    const n = names.length;
    for (let i = 0; i < n; i++) {
      const nm = names[i];
      await p.evaluate((k) => document.querySelector('[data-rail="' + k + '"]').click(), i);
      /* smooth 滚动 + 双趟 land（第二趟在 460ms）都要走完；再等两帧让布局落地 */
      await sleep(1200);
      const r = await p.evaluate((o) => {
        const dr = document.getElementById('drawer');
        const mini = document.getElementById('dMini');
        /* 候选选择器里取第一个「有尺寸」的 —— 与 railTarget 同一套判据 */
        const el = o.sels.map((s) => document.querySelector(s))
          .find((e) => e && e.offsetWidth > 0 && e.offsetHeight > 0) || null;
        if (!el) return { err: '无可用的目标节点 ' + o.sels.join('/') };
        const drR = dr.getBoundingClientRect();
        const mR = mini.getBoundingClientRect();
        const eR = el.getBoundingClientRect();
        const miniOn = mini.classList.contains('on');
        /* 文档末尾的分区**物理上到不了视口顶部**：scrollTop 被
           `scrollHeight - clientHeight` 夹住（这是既有限制，v10.31 时也一样）。
           判据里要区分「被夹住」与「滚过头」，否则会把物理限制读成 bug。 */
        const maxTop = dr.scrollHeight - dr.clientHeight;
        const atBottom = dr.scrollTop >= maxTop - 4;
        /* ★ 关键判据：目标分区**靠上那一带**的落点上到底是谁。
           小条若盖住了它，这里返回的就是 #dMini（或它的子节点）——
           这跟 rect 数值无关，是「眼睛能看到什么」的直接测量。 */
        const x = Math.round(drR.left + drR.width / 2);
        const y = Math.round(eR.top + 8);
        const at = (y >= 0 && y < window.innerHeight) ? document.elementFromPoint(x, y) : null;
        return {
          miniOn,
          miniBottom: Math.round(mR.bottom),
          miniH: Math.round(mR.height),
          elTop: Math.round(eR.top),
          gap: Math.round(eR.top - mR.bottom),          // 目标顶 - 小条底（<0 = 被盖）
          atBottom,
          hitIsMini: !!(at && mini.contains(at)),
          hitInTarget: !!(at && el.contains(at)),
          hitTag: at ? (at.id ? '#' + at.id : at.className.toString().slice(0, 26)) : '(屏外)',
          scrollTop: Math.round(dr.scrollTop),
        };
      }, { sels: MAP[nm] || ['#reqSlot'] });
      if (r.err) { console.log('    · ' + nm + ' → 跳过（' + r.err + '）'); continue; }
      /* 遮挡判据 = 目标顶在小条底之下，且落点上不是小条。这两条**任何情况都必须过**。 */
      const notCovered = r.gap >= 0 && !r.hitIsMini;
      /* 「没滚过头」只在标签**够得着顶部**时才要求 —— 末尾分区被 scrollTop 夹住属物理限制 */
      const landed = r.atBottom || r.gap <= 100;
      console.log('    · ' + nm.padEnd(12) + ' gap=' + String(r.gap).padStart(4) +
        ' 小条=' + (r.miniOn ? r.miniH + 'px' : '未显形') +
        (r.atBottom ? ' [已到底]' : '') +
        ' 落点=' + r.hitTag + (notCovered ? '  ✅未遮挡' : '  ❌被小条挡住'));
      chk('② 「' + nm + '」跳转后未被小条遮挡（gap>=0 且落点不是小条）', notCovered,
        'gap=' + r.gap + ' 落点=' + r.hitTag);
      chk('② 「' + nm + '」落点确实落在该分区的节点上（elementFromPoint）',
        r.hitInTarget, '落点=' + r.hitTag);
      chk('② 「' + nm + '」落点合理（到顶或已滚到底）', landed,
        r.atBottom ? '已到底（物理夹住）' : 'gap=' + r.gap);
    }

    await p.screenshot({ path: path.join(OUT, 'v1032-' + s.tag + '.png') });
    console.log('  截图 → _preview/v1032-' + s.tag + '.png');
  }

  chk('全程无页面 JS 异常', errs.length === 0, errs.slice(0, 2).join(' / ') || '0 条');
  console.log('\n============================');
  console.log('  通过 ' + pass + '/' + (pass + fail) + '（失败 ' + fail + '）');
  console.log('============================');
  await h.browser.close();
  process.exit(fail ? 1 : 0);
})();
