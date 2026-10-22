#!/usr/bin/env node
/* v10.99 端游资源卡：整卡 = 详情页，卡底按钮 = **完整下载弹窗**（默认本模块页签）
 *
 * 用户在 v10.98 之后的两句纠正（原话）：
 *   ① 「点击卡片是弹出详情页，这个没问题，但是〔详情底栏那颗「查看本体资源」〕这个我不需要，
 *       还是原来的样式」
 *      ⇒ v10.98 加的 `.ds-res` 模块按钮 + `detailResTab` 整组撤掉，底栏回到只有一颗。
 *   ② 「卡片下的按钮，我要求是点击后弹出下载弹窗（完整的下载弹窗，但是默认页是根据点击页面
 *       进行默认设置，比如我在修改器点开的，我需要他默认显示修改器的下载页）」
 *      ⇒ 卡底按钮从「只列本模块条目的弹窗」改成 `openUniDownload` → 主站那套四页签 `#dlPop`。
 *
 * 四个分区逐个走一遍，验的是**行为链**（不验样式）：
 *   ① 点整卡 → #drawer.show，且**没有**顺手开下载弹窗（一次点击只做一个动作）
 *   ② 详情底栏只有一颗「⬇ 下载与资源」（反向：`.ds-res` 不许回来）
 *   ③ 点卡底按钮 → #dlPop 打开、四页签齐全、默认页签 = 该模块、该页签有内容
 *
 * 分区 → 页签键：mod→mod · saves→save · trainers→modifier · body→body
 *   （两套键名不一样：分区叫 saves/trainers，弹窗页签叫 save/modifier。
 *     传错**不报错** —— openUniDownload 对非法 tab 静默落回 body，
 *     表现成「从修改器卡点开停在本体」，这正是本套件最想拦的一类。
 *     `RES_UNI_TAB` 就是那张翻译表，断言钉的是**结果**（页签键落对），不是表本身。）
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
         页面里每个 fetch 都会抛，表现为「整页空着」而 jsdom 不报错（v10.98 实测踩到）。 */
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
  const popOpen = () => !!q('#dlPop') && !q('#dlPop').hidden;
  const closeAll = async () => {
    if (typeof W.closeDownload === 'function') W.closeDownload();
    await sleep(260);
    if (typeof W.closeDetail === 'function') W.closeDetail();
    await sleep(260);
  };
  const TABS = ['body', 'mod', 'modifier', 'save'];

  /* 一轮完整链路：切分区 → 点整卡（验详情 + 底栏）→ 点卡底按钮（验弹窗/页签/内容）→ 关闭 */
  async function runSection({ tabFn, grid, cardCls, expectTab, label }) {
    console.log('\n── ' + label + ' ──');
    W.switchResTab(tabFn);
    for (let i = 0; i < 100; i++) { if (qa(grid + ' ' + cardCls).length) break; await sleep(150); }
    const cards = qa(grid + ' ' + cardCls);
    ok(label + '：网格有卡', cards.length > 0, cards.length + ' 张');
    const card = cards.find((c) => c.dataset.lib) || cards[0];
    if (!card) { ok(label + '：有卡可测', false, '网格为空'); return; }

    /* ① 整卡 → 详情（等到**底栏画出来**再取样，不能只等 #drawer.show） */
    card.querySelector('h4').click();
    for (let i = 0; i < 120 && !(drawerOpen() && q('#dlStrip .ds-all')); i++) await sleep(200);
    ok(label + '：点整卡 → 打开详情抽屉', drawerOpen());
    ok(label + '：这一刻没有顺手开下载弹窗', !popOpen(), popOpen() ? '弹窗也开了' : '');
    const dsAll = qa('#dlStrip .ds');
    ok(label + '：底栏只有一颗下载入口（⬇ 下载与资源）',
      dsAll.length === 1 && /下载与资源/.test(dsAll[0].textContent || ''),
      `${dsAll.length} 颗 ｜ ${dsAll.map((x) => (x.textContent || '').trim()).join(' / ')}`);
    ok(label + '：反向 —— v10.98 的「查看 <模块> 资源」(.ds-res) 不许回来',
      !q('#dlStrip .ds-res'));

    /* ② 卡底按钮 → 完整下载弹窗（详情关掉再点，避免两层叠着取样） */
    if (drawerOpen()) { W.closeDetail(); await sleep(260); }
    const more = card.querySelector('.grp-more');
    ok(label + '：卡底有「⬇ 下载与资源」按钮', !!more,
      more ? (more.textContent || '').trim() : '(无 .grp-more)');
    if (more) {
      more.click();
      for (let i = 0; i < 80 && !(popOpen() && q('#dlModTabs .dlm.on')); i++) await sleep(200);
      ok(label + '：点卡底按钮 → 打开下载弹窗', popOpen());
      const tabKeys = qa('#dlModTabs .dlm').map((b) => b.dataset.dlm);
      ok(label + '：弹窗是**完整**的（四页签齐全）',
        TABS.every((k) => tabKeys.includes(k)), tabKeys.join(',') || '(无页签)');
      const onTab = q('#dlModTabs .dlm.on');
      ok(label + '：默认页签 = ' + expectTab + '（分区名 → 页签键翻译正确）',
        !!onTab && onTab.dataset.dlm === expectTab,
        onTab ? 'on=' + onTab.dataset.dlm : '(无)');
      /* 内容：等页签数据回来（mod/save/modifier 都是本地索引，毫秒级；全量跑时机器忙）
         ⚠️ 判据必须**排除加载占位**：`正在读取存档…` 也是 20+ 字的文本，
            只看长度会把「还没回来」当成「有内容」而假绿（本套件实测踩到）。 */
      for (let i = 0; i < 100; i++) {
        const t = ((q('#dlBody') || {}).textContent || '').trim();
        if (t.length > 20 && !/正在读取/.test(t)) break;
        await sleep(200);
      }
      const bodyTxt = ((q('#dlBody') || {}).textContent || '').trim();
      ok(label + '：该页签有内容（不是空态/加载中 —— 页签落对了但没数据等于没接上）',
        bodyTxt.length > 20 && !/正在读取/.test(bodyTxt), bodyTxt.slice(0, 50));
      await closeAll();
    }
  }

  await runSection({ tabFn: 'md', grid: '#mdGrid', cardCls: '.emu-card', expectTab: 'mod', label: 'MOD 分区' });
  await runSection({ tabFn: 'sv', grid: '#svGrid', cardCls: '.emu-card', expectTab: 'save', label: '存档分区' });
  await runSection({ tabFn: 'tr', grid: '#trGrid', cardCls: '.emu-card', expectTab: 'modifier', label: '修改器分区' });

  /* ── 本体分区：整卡走**话题 URL**（不是库 id），卡底按钮由 bdDownloadPop 负责 ──
     ⚠️ 本体卡初始状态是「🔍 查本体下载」（进页面 0 请求，见 D21/D22），
        所以这里直接调**按钮背后那个函数**，而不是为了造出 `.grp-more` 去打一次机地
        （源站限流时会红成「回归」，其实是环境问题）。 */
  console.log('\n── 本体分区 ──');
  W.switchResTab('bd');
  for (let i = 0; i < 120; i++) { if (qa('#bdGrid .bd-card').length) break; await sleep(150); }
  const bcards = qa('#bdGrid .bd-card');
  ok('本体分区：网格有卡', bcards.length > 0, bcards.length + ' 张');
  if (bcards.length) {
    const c0 = bcards[0];
    c0.querySelector('h4').click();
    for (let i = 0; i < 150 && !(drawerOpen() && q('#dlStrip .ds-all')); i++) await sleep(200);
    ok('本体分区：点整卡 → 打开详情（话题没有库记录，靠 URL 打开）', drawerOpen());
    ok('本体分区：底栏也只有一颗入口（反向：没有「查看本体资源」）',
      qa('#dlStrip .ds').length === 1 && !q('#dlStrip .ds-res'));
    await closeAll();
    ok('本体分区：卡底按钮 → 完整下载弹窗（默认 body）',
      typeof W.bdDownloadPop === 'function', typeof W.bdDownloadPop === 'function' ? '' : '函数未暴露');
    if (typeof W.bdDownloadPop === 'function') {
      W.bdDownloadPop(c0);
      for (let i = 0; i < 80 && !(popOpen() && q('#dlModTabs .dlm.on')); i++) await sleep(200);
      const onTab = q('#dlModTabs .dlm.on');
      ok('本体分区：弹窗默认页签 = body', !!onTab && onTab.dataset.dlm === 'body',
        onTab ? 'on=' + onTab.dataset.dlm : '(无)');
      const tabKeys = qa('#dlModTabs .dlm').map((b) => b.dataset.dlm);
      ok('本体分区：同样是完整四页签', TABS.every((k) => tabKeys.includes(k)), tabKeys.join(','));
      await closeAll();
    }
  }

  ok('全程无 JS 异常', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  W.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
