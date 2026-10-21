#!/usr/bin/env node
/* v10.98 端游资源卡点击 = 详情页 + 详情底栏「查看 <模块> 资源」
 *
 * 用户口径：「端游模块的卡片点击是弹详情页，然后有个按钮 —— 点击查看对应模块的弹窗
 *           （同下载按钮，不过默认页面自动选择到默认模块）」。
 *
 * 四个分区逐个走一遍，验的是**行为链**（不验样式）：
 *   ① 点整卡 → #drawer.show（详情打开），且**没有**顺手开下载弹窗
 *   ② 详情底栏出现 .ds-res，文案写对模块，data-dl-tab = 弹窗页签键（不是分区名）
 *   ③ 点它 → #dlPop 打开，默认页签 = 该模块
 *   ④ 反向：普通入口（不带模块语境）进详情，底栏**没有** .ds-res
 *
 * 分区 → 页签键：mod→mod · saves→save · trainers→modifier · body→body
 *   （两套键名不一样：分区叫 saves/trainers，弹窗页签叫 save/modifier。
 *     传错不报错 —— openUniDownload 对非法 tab 静默落回 body。）
 */
const { JSDOM, VirtualConsole } = require('jsdom');

const BASE = process.env.BASE || 'http://127.0.0.1:8123';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nativeFetch = globalThis.fetch;

let pass = 0; let fail = 0;
const ok = (name, cond, ev) => {
  if (cond) { pass++; console.log('  ✅ ' + name + (ev ? '   [' + ev + ']' : '')); }
  else { fail++; console.log('  ❌ ' + name + (ev ? '   [' + ev + ']' : '')); }
};

(async () => {
  const html = await fetch(BASE + '/resources.html').then((r) => r.text());
  const vc = new VirtualConsole();
  const errs = [];
  vc.on('jsdomError', (e) => {
    const m = String((e && e.message) || e);
    if (!/Could not load/.test(m)) errs.push(m.slice(0, 160));
  });
  const dom = new JSDOM(html, {
    url: BASE + '/resources.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      /* ⚠️ beforeParse 阶段 w.fetch 还没定义 —— 直接 `const raw = w.fetch` 拿到 undefined，
         页面里每个 fetch 都会抛，表现为「整页空着」而 jsdom 不报错（本轮实测踩到）。 */
      const raw = w.fetch;
      w.fetch = function (u, o) {
        const real = raw || nativeFetch;
        return real.call(w, String(u).startsWith('http') ? String(u) : BASE + String(u), o);
      };
      w.scrollTo = () => {};
      w.Element.prototype.scrollIntoView = function () {};
      w.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
    },
  });
  const W = dom.window;
  const D = W.document;
  const q = (s) => D.querySelector(s);
  const qa = (s) => [...D.querySelectorAll(s)];
  await sleep(2800);

  const drawerOpen = () => q('#drawer').classList.contains('show');
  const closeAll = async () => {
    if (typeof W.closeDownload === 'function') W.closeDownload();
    await sleep(260);
    if (typeof W.closeDetail === 'function') W.closeDetail();
    await sleep(260);
  };

  /* 一轮完整链路：打开分区 → 点第一张有 libId 的卡 → 验详情/按钮/弹窗 → 关闭 */
  async function runSection({ tabFn, grid, cardCls, expectTab, expectWord, label }) {
    console.log('\n── ' + label + ' ──');
    W.switchResTab(tabFn);
    for (let i = 0; i < 100; i++) { if (qa(grid + ' ' + cardCls).length) break; await sleep(150); }
    const cards = qa(grid + ' ' + cardCls);
    ok(label + '：网格有卡', cards.length > 0, cards.length + ' 张');
    const card = cards.find((c) => c.dataset.lib);
    if (!card) { ok(label + '：有带 libId 的卡可测', false, '全部无 data-lib'); return; }
    ok(label + '：卡上带 data-lib（详情靠它打开）', !!card.dataset.lib,
      card.dataset.name + ' → ' + card.dataset.lib);

    card.querySelector('h4').click();
    for (let i = 0; i < 120; i++) {
      if (drawerOpen() && q('#dlStrip .ds-res')) break;
      await sleep(200);
    }
    ok(label + '：点整卡 → 打开详情抽屉', drawerOpen());
    ok(label + '：这一刻没有顺手开下载弹窗', !q('#dlPop') || q('#dlPop').hidden);
    const rb = q('#dlStrip .ds-res');
    const rbTxt = rb ? rb.textContent.replace(/\s+/g, '') : '';
    ok(label + '：底栏出现「查看' + expectWord + '资源」', !!rb && rbTxt.indexOf('查看' + expectWord + '资源') >= 0,
      rb ? rb.textContent.trim().replace(/\s+/g, ' ') : '(无)');
    ok(label + '：data-dl-tab = ' + expectTab, !!rb && rb.dataset.dlTab === expectTab,
      rb ? 'tab=' + rb.dataset.dlTab : '');
    ok(label + '：按钮 id 取的是卡上的 libId', !!rb && rb.dataset.dlId === card.dataset.lib,
      rb ? rb.dataset.dlId : '');
    if (rb) {
      rb.click();
      for (let i = 0; i < 60; i++) {
        const on = q('#dlModTabs .dlm.on');
        if (q('#dlPop') && !q('#dlPop').hidden && on) break;
        await sleep(200);
      }
      const onTab = q('#dlModTabs .dlm.on');
      ok(label + '：点按钮 → 弹窗打开且默认页签 = ' + expectTab,
        !!q('#dlPop') && !q('#dlPop').hidden && !!onTab && onTab.dataset.dlm === expectTab,
        onTab ? 'on=' + onTab.dataset.dlm : '(无)');
      await sleep(1200);
      ok(label + '：该页签有内容（不是空态）', ((q('#dlBody') || {}).textContent || '').trim().length > 20,
        ((q('#dlBody') || {}).textContent || '').trim().slice(0, 50));
    }
    await closeAll();
  }

  await runSection({
    tabFn: 'md', grid: '#mdGrid', cardCls: '.emu-card',
    expectTab: 'mod', expectWord: 'MOD', label: 'MOD 分区',
  });
  await runSection({
    tabFn: 'sv', grid: '#svGrid', cardCls: '.emu-card',
    expectTab: 'save', expectWord: '存档', label: '存档分区',
  });
  await runSection({
    tabFn: 'tr', grid: '#trGrid', cardCls: '.emu-card',
    expectTab: 'modifier', expectWord: '修改器', label: '修改器分区',
  });

  /* ── 本体分区：走的是**话题 URL**（不是库 id）── */
  console.log('\n── 本体分区 ──');
  W.switchResTab('bd');
  for (let i = 0; i < 120; i++) { if (qa('#bdGrid .bd-card').length) break; await sleep(150); }
  const bcards = qa('#bdGrid .bd-card');
  ok('本体分区：网格有卡', bcards.length > 0, bcards.length + ' 张');
  if (bcards.length) {
    const c0 = bcards[0];
    c0.querySelector('h4').click();
    for (let i = 0; i < 150; i++) {
      if (drawerOpen() && q('#dlStrip .ds-res')) break;
      await sleep(200);
    }
    ok('本体分区：点整卡 → 打开详情（话题没有库记录，靠 URL 打开）', drawerOpen());
    const rb = q('#dlStrip .ds-res');
    ok('本体分区：底栏出现「查看本体资源」', !!rb,
      rb ? rb.textContent.trim().replace(/\s+/g, '') : '(无)');
    ok('本体分区：data-dl-tab = body', !!rb && rb.dataset.dlTab === 'body',
      rb ? 'tab=' + rb.dataset.dlTab : '');
    if (rb) {
      rb.click();
      for (let i = 0; i < 60; i++) { if (q('#dlPop') && !q('#dlPop').hidden) break; await sleep(200); }
      const onTab = q('#dlModTabs .dlm.on');
      ok('本体分区：弹窗默认页签 = body', !!onTab && onTab.dataset.dlm === 'body',
        onTab ? 'on=' + onTab.dataset.dlm : '(无)');
    }
    await closeAll();
  }

  /* ── 反向：普通入口不带 .ds-res ── */
  console.log('\n── 普通入口（反向）──');
  W.switchResTab('md');
  for (let i = 0; i < 100; i++) { if (qa('#mdGrid .emu-card').length) break; await sleep(150); }
  const lib = qa('#mdGrid .emu-card').find((c) => c.dataset.lib);
  const shown = await W.openDetailById(lib.dataset.lib, lib.dataset.name);
  for (let i = 0; i < 120; i++) { if (drawerOpen() && q('#dlStrip .ds-all')) break; await sleep(200); }
  ok('普通入口打开详情', shown === true && drawerOpen());
  ok('反向：普通详情底栏**没有** .ds-res', !q('#dlStrip .ds-res'),
    (q('#dlStrip') || {}).textContent.trim().replace(/\s+/g, ' ').slice(0, 40));
  await closeAll();

  ok('全程无 JS 异常', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  W.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
