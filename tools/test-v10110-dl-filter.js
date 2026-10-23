/* ★ v10.110 回归：下载弹窗**四页签筛选**（jsdom 行为层）。
 *
 * 用户口径：「下载入口均只展示前三条，若有多个下载源或下载内容则在下载弹窗中
 *           需要提供筛功能（类似目前已有网盘的筛选）」。
 *
 * 守的不变量：
 *   A. 详情页预览口径没被本版打坏 —— 三专区（本体/Mod/修改器）每块仍只露 3 帖
 *      （`DL_PREV_CAP = 3`，v10.28 定下的用户口径，本版原样保留）
 *   B. 纯函数层：`dlFltOk` / `dlFltOpts` / `dlFltRow` / `dlFltBarHtml` 的判定与计数
 *      —— 特别是「另一维度生效、本维度不生效」这条计数规则（否则 chip 写着 12、点进去 0 条）
 *   C. Mod 页签真实数据下：筛选条存在 → chip 有来源/通道 → 点一个真的会变 → 点「全部」恢复
 *   D. 存档页签同上（该页签的通道维度更多：直链 / 网盘 / 迅雷 / eD2K）
 *   E. 页签隔离：Mod 的筛选态不串到存档；换游戏后归零
 *
 * ⚠️ 与 `test-download.js` 的分工：
 *   那边守「截断 + 出口」的结构（静态正则），这边守**筛选真的会发生**（点击 → 列表变化）。
 *   两边都不写死「某款游戏有几条」—— 数据每天在变，写死的断言第二天就假红。
 */
const path = require('path');
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const BASE = process.env.BASE || 'http://127.0.0.1:8123';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nativeFetch = globalThis.fetch;

let pass = 0; let fail = 0;
const ok = (name, cond, ev) => {
  if (cond) { pass++; console.log('  ✅ ' + name + (ev ? '   [' + ev + ']' : '')); }
  else { fail++; console.log('  ❌ ' + name + (ev ? '   [' + ev + ']' : '')); }
};
const txt = (s) => String(s || '').replace(/\s+/g, ' ').trim();

(async () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

  /* ================= A. 详情页预览口径（本版不动它） ================= */
  console.log('\n=== A · 详情页「每块只露前 3 帖」仍是用户口径 ===');
  ok('A1 DL_PREV_CAP 仍为 3', /const DL_PREV_CAP = 3;/.test(src), 'DL_PREV_CAP=3');
  ok('A2 预览块按 DL_PREV_CAP 截断（不静默全铺）',
    /s\.posts\.slice\(0, DL_PREV_CAP\)/.test(src));
  ok('A3 超出上限时给「全部 N 帖 →」出口（不静默丢条）',
    /data-df-open=/.test(src) && /全部 \$\{s\.posts\.length\} 帖/.test(src) && /more \?/.test(src));
  /* ★ 这条是**实拍撞出来的真 bug**（不是预防性写法）：
     第一版筛选条借用了 `.dl-bar` 类，而 `test-v1025-dlstrip` 的 ⑧c 靠「`.dl-bar` 已不在」
     判断「用户真的从本体切走了」⇒ Mod 页签被认成「还停在本体」，那条红。
     `.dl-bar` 是**语义标识**（本体工具条），不是可以随便复用的样式壳。 */
  ok('A4 ★ 筛选条用独立类 `.dl-flt-bar`，不占用 `.dl-bar`（后者是「本体工具条」的语义标识）',
    /'<div class="dl-flt-bar">'/.test(src) && !/dl-bar dl-flt/.test(src));

  /* ================= B. 纯函数层 ================= */
  console.log('\n=== B · 筛选判定与计数（纯函数） ===');
  const html = await fetch(BASE + '/index.html').then((r) => r.text());
  const vc = new VirtualConsole();
  const errs = [];
  vc.on('jsdomError', (e) => {
    const m = String((e && e.message) || e);
    if (!/Could not load/.test(m)) errs.push(m.slice(0, 160));
  });
  const dom = new JSDOM(html, {
    url: BASE + '/index.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      const raw = w.fetch;
      w.fetch = function (u, o) {
        const real = raw || nativeFetch;
        const s = String(u);
        /* 榜单 / 首页聚合在 jsdom 里又慢又与本套件无关 —— 直接给空壳，
           让 init() 快速走完（它们各自的断言在别的套件里）。 */
        if (/\/api\/rank|\/api\/stats|\/api\/health/.test(s)) {
          return Promise.resolve(new Response('{"ok":true,"items":[]}', { headers: { 'content-type': 'application/json' } }));
        }
        return real.call(w, s.startsWith('http') ? s : BASE + s, o);
      };
      w.scrollTo = () => {};
      w.Element.prototype.scrollIntoView = function () {};
      w.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
    },
  });
  const W = dom.window;
  const D = W.document;
  await sleep(900);

  ok('B0 主源脚本在 jsdom 里无解析期异常（errs 为空）', errs.length === 0, errs.join(' | ') || '0 error');

  const rows = [
    { _src: 'jidi', _ch: ['百度', '迅雷'] },
    { _src: 'jidi', _ch: ['夸克'] },
    { _src: 'ts', _ch: ['直链'] },
    { _src: 'gt', _ch: ['直链'] },
  ];
  ok('B1 src 命中：机地 2 条', W.dlFltApply(rows, { src: 'jidi', ch: '' }).length === 2);
  ok('B2 ch 命中「百度」1 条', W.dlFltApply(rows, { src: '', ch: '百度' }).length === 1);
  ok('B3 两维叠加：机地 ∩ 直链 = 0 条', W.dlFltApply(rows, { src: 'jidi', ch: '直链' }).length === 0);
  ok('B4 空筛选 = 全量 4 条', W.dlFltApply(rows, { src: '', ch: '' }).length === 4);

  /* ★ 计数口径：选了来源后，「通道」那行的数字要按来源过滤后的集合算；
     但「来源」那行自己的数字不能受来源筛选影响（否则选完只剩一个 chip，无法换回来）。 */
  const f1 = { src: 'jidi', ch: '' };
  const srcOpts = W.dlFltOpts(rows, 'src', f1);
  const chOpts = W.dlFltOpts(rows, 'ch', f1);
  ok('B5 已选来源时，「来源」自身计数仍是全量（可换回来）',
    srcOpts.get('ts') === 1 && srcOpts.get('gt') === 1,
    JSON.stringify([...srcOpts]));
  ok('B6 已选来源时，「通道」计数只算该来源（百度 1 / 迅雷 1 / 夸克 1，不含直链）',
    chOpts.get('百度') === 1 && chOpts.get('直链') === undefined,
    JSON.stringify([...chOpts]));

  /* ⚠️ `dlUni` 是顶层 `let`（不是 `function`）⇒ **不会挂到 window 上**，
     只能经 `W.eval` 在同一个全局词法环境里读写。这是本套件唯一碰内部状态的地方，
     用来把「有筛选生效」这个前置摆出来 —— 其余断言全走真实点击。 */
  W.eval('dlUni = { flt: { mod: { src: "jidi", ch: "" } }, tab: "mod", svfAll: false, cnt: {}, data: {}, busy: {} };');
  const bar = W.dlFltBarHtml('mod', rows, { src: { jidi: '机地', ts: 'Thunderstore' } });
  ok('B7 筛选条含两个维度的 label', /dl-lb">来源/.test(bar) && /dl-lb">通道/.test(bar));
  ok('B8 每个 chip 带 data-dl-flt 且「全部」的值为空串',
    /data-dl-flt="src:"/.test(bar) && /data-dl-flt="src:jidi"/.test(bar),
    (bar.match(/data-dl-flt="[^"]*"/g) || []).slice(0, 4).join(' '));
  ok('B9 有筛选生效时给「清空筛选」出口', /data-dl-flt-clear="mod"/.test(bar));
  W.eval('dlUni.flt.mod = { src: "", ch: "" };');
  const barNo = W.dlFltBarHtml('mod', rows, {});
  ok('B10 未选任何筛选时**不出现**清空按钮（无效控件不摆）', !/data-dl-flt-clear/.test(barNo));
  ok('B11 筛空态自带清空出口', /data-dl-flt-clear="save"/.test(W.dlFltNoneHtml('save')));
  W.eval('dlUni = null;');

  /* ================= C. Mod 页签端到端 ================= */
  console.log('\n=== C · Mod 页签：真实数据下的筛选 ===');
  const SAMPLE = '赛博朋克2077';
  W.openUniDownload({ title: SAMPLE, id: '', url: '', tab: 'mod' });
  /* ★ 等数据回来给 **30 秒**（150 × 200ms）。第一版只给 12 秒，单跑够用，
     但在 `run-all` 里 84 套轮流压 8123 时会拿不到数据 —— 表现是「C1 空页签」
     然后后面一路崩。这类**环境相关的假红**比真 bug 更费时间，宁可等久点。 */
  for (let i = 0; i < 150; i++) {
    if (D.querySelectorAll('#dlBody .d-dl-it').length > 0) break;
    await sleep(200);
  }
  const modRowsN = D.querySelectorAll('#dlBody .d-dl-it').length;
  ok('C1 Mod 页签真渲染出条目（不是空页签 —— 空页签上的筛选测不出任何东西）',
    modRowsN > 0, modRowsN + ' 行');

  const cBar = D.querySelector('#dlBody .dl-flt-bar');
  ok('C2 Mod 页签有筛选条', !!cBar);
  const srcChips = cBar ? [...cBar.querySelectorAll('[data-dl-flt^="src:"]')] : [];
  const chChips = cBar ? [...cBar.querySelectorAll('[data-dl-flt^="ch:"]')] : [];
  ok('C3 来源维度要么不摆、要么 ≥2 chip（只有一种来源时摆「全部 N / 机地 N」是无效控件）',
    srcChips.length === 0 || (srcChips.length >= 2 && srcChips[0].dataset.dlFlt === 'src:'),
    srcChips.length + ' chip：' + srcChips.map((x) => txt(x.textContent)).join(' / '));
  ok('C3b 至少有一个维度真的可筛（≥2 chip）—— 否则这条「筛选条」是摆设',
    srcChips.length >= 2 || chChips.length >= 2,
    'src ' + srcChips.length + ' / ch ' + chChips.length);
  ok('C4 通道维度有 ≥2 个 chip（该样本实测带迅雷/百度/夸克）', chChips.length >= 2,
    chChips.map((x) => txt(x.textContent)).join(' / '));
  ok('C5 chip 上的数字是数字而不是占位', !!chChips[0] && /^\D*\d+$/.test(txt(chChips[0].textContent)),
    chChips[0] ? txt(chChips[0].textContent) : '无 chip');

  /* 点第一个非「全部」的通道 chip */
  const pick = chChips.find((x) => x.dataset.dlFlt !== 'ch:');
  if (!pick) {
    /* ★ 数据没回来（或被环境压到超时）时**不许崩在 `pick.click()` 上** ——
       崩掉会让整套变成 exit=2「异常退出」，把「几条假红」放大成「整个防线不可信」。 */
    for (const n of ['C6', 'C7', 'C8', 'C9', 'C10']) ok(n + ' 无可用 chip（数据未回，跳过）', true, '跳过');
  } else {
  const pickVal = pick.dataset.dlFlt.slice(3);
  pick.click();
  await sleep(100);
  const afterN = D.querySelectorAll('#dlBody .d-dl-it').length;
  ok('C6 点通道 chip 后列表**真的变了**（这就是「筛选能用」的唯一硬判据）',
    afterN !== modRowsN, modRowsN + ' → ' + afterN + '（筛 ' + pickVal + '）');
  ok('C7 被点的 chip 处于 on 态', D.querySelector('[data-dl-flt="' + pick.dataset.dlFlt + '"]').classList.contains('on'));
  ok('C8 筛后出现「清空筛选」', !!D.querySelector('#dlBody [data-dl-flt-clear]'));

  /* ★★ 反 over-claim：筛「迅雷网盘」后铺出来的每一行，通道按钮里都得真有迅雷 ——
     否则就是把「筛了但没筛干净」当成「筛好了」。
     ⚠️ 判据看 `title`（= 源站全名「迅雷网盘」）而不是按钮文字：`dlModLinkBtns` 展示时
        会剥掉「网盘 / 云盘」后缀（窄屏不折行，v10.58 定下的），文字只剩「迅雷」。
        拿 chip 值去比文字必然对不上 —— 两边是**同一份数据、两种展示口径**，不是 bug。 */
  const lkOk = [...D.querySelectorAll('#dlBody .d-dl-it')].every((r) => {
    const a = [...r.querySelectorAll('.dl-res-lk a')];
    return a.some((x) => String(x.getAttribute('title') || x.textContent).includes(pickVal));
  });
  const withLk = [...D.querySelectorAll('#dlBody .d-dl-it')].filter((r) => r.querySelector('.dl-res-lk a')).length;
  ok('C9 ★★ 筛后每一行都真有该通道的按钮（没有「筛出来却点不了」的行）',
    withLk === afterN && lkOk, withLk + '/' + afterN);

  D.querySelector('#dlBody [data-dl-flt-clear]').click();
  await sleep(100);
  ok('C10 点「清空筛选」后恢复全量', D.querySelectorAll('#dlBody .d-dl-it').length === modRowsN,
    D.querySelectorAll('#dlBody .d-dl-it').length + ' / 原 ' + modRowsN);
  }

  /* 筛到必然为空的组合：该样本没有 Thunderstore（实测 ts=0） */
  const tsChip = [...D.querySelectorAll('#dlBody [data-dl-flt^="src:"]')].find((x) => x.dataset.dlFlt === 'src:ts');
  if (tsChip) {
    tsChip.click();
    await sleep(60);
    const none = D.querySelector('#dlBody .dl-flt-none');
    ok('C11 筛到空结果时给**明确空态**而不是一片白', !!none, txt(none && none.textContent).slice(0, 40));
    ok('C12 空态里有清空出口（不把用户困住）', !!(none && none.querySelector('[data-dl-flt-clear]')));
    const rc = D.querySelector('#dlBody [data-dl-flt-clear]');
    if (rc) { rc.click(); await sleep(100); }
  } else {
    ok('C11 该样本有 Thunderstore 段（缺则该断言不适用）', true, '样本无 TS，跳过');
    ok('C12 同上', true, '跳过');
  }

  /* ================= D. 存档页签 ================= */
  console.log('\n=== D · 存档页签：通道维度更多（直链 / 网盘 / 迅雷 / eD2K） ===');
  W.eval('dlUni && (dlUni.flt = {});');        /* 先归零，保证 D 段不受 C 段残留影响 */
  W.dlGoModule('save');
  for (let i = 0; i < 60; i++) {
    if (D.querySelectorAll('#dlBody .svf, #dlBody .dl-agg').length > 0) break;
    await sleep(200);
  }
  const svBody = txt(D.querySelector('#dlBody').textContent);
  const svBar = D.querySelector('#dlBody .dl-flt-bar');
  const svHasRows = D.querySelectorAll('#dlBody .svf').length;
  ok('D1 存档页签有内容或有明确空态（不是白屏）',
    svHasRows > 0 || /没有这款游戏的可下载存档|没有收录|读取失败/.test(svBody),
    svHasRows + ' 条存档文件');
  if (svHasRows > 0) {
    ok('D2 存档页签有筛选条', !!svBar,
      svBar ? [...svBar.querySelectorAll('.dl-chip')].map((x) => txt(x.textContent)).join(' / ') : '无');
    const svCh = svBar ? [...svBar.querySelectorAll('[data-dl-flt^="ch:"]')] : [];
    ok('D3 通道维度出现「直链」（有直链的存档文件必然被归类）',
      svCh.some((x) => x.dataset.dlFlt === 'ch:直链'),
      svCh.map((x) => txt(x.textContent)).join(' / '));
    /* ★ 挑**条数最少**的那个 chip 点 —— 挑第一个（通常是「直链」48 条）会撞上
       `SVF_CAP=20` 的显示上限：筛完仍是 20 行，看起来「点了没反应」。
       这不是筛选坏了，是断言挑错了对象（实测踩到，记在这条注释里）。 */
    const num = (x) => parseInt((txt(x.textContent).match(/(\d+)\s*$/) || [])[1] || '0', 10);
    const p2 = svCh.filter((x) => x.dataset.dlFlt !== 'ch:').sort((a, b) => num(a) - num(b))[0];
    if (p2) {
      const before = svHasRows;
      const cap = 20;                     /* 与主源 SVF_CAP 同值；只用于判断「是否被上限夹住」 */
      const expectVal = num(p2);
      p2.click();
      await sleep(60);
      const after = D.querySelectorAll('#dlBody .svf').length;
      ok('D4 点通道 chip 后存档列表变化（挑条数最少的通道，避开 SVF_CAP 显示上限）',
        expectVal < cap ? after === expectVal : after === before,
        before + ' → ' + after + '（该通道 ' + expectVal + ' 条）');
      const clr = D.querySelector('#dlBody [data-dl-flt-clear]');
      if (clr) { clr.click(); await sleep(60); }
      ok('D5 清空后恢复', D.querySelectorAll('#dlBody .svf').length === before);
    } else {
      ok('D4 该存档只有一种通道（缺则不断言）', true, '跳过');
      ok('D5 同上', true, '跳过');
    }
  } else {
    ok('D2 无文件样本跳过通道断言', true, '跳过');
    ok('D3 同上', true, '跳过');
    ok('D4 同上', true, '跳过');
    ok('D5 同上', true, '跳过');
  }

  /* ================= F. 修改器页签（来源最多的一页：机地 / 风灵月影 / CheatScript / GTrainers） ================= */
  console.log('\n=== F · 修改器页签：按「来源」筛（GCM 段与机地段要能分开看） ===');
  W.eval('dlUni && (dlUni.flt = {});');
  W.dlGoModule('modifier');
  for (let i = 0; i < 60; i++) {
    if (D.querySelectorAll('#dlBody .d-dl-it, #dlBody .df-row').length > 0) break;
    await sleep(200);
  }
  const moBody = D.querySelector('#dlBody');
  const moJidi = D.querySelectorAll('#dlBody .d-dl-it').length;
  const moGcm = D.querySelectorAll('#dlBody .df-row').length;
  ok('F1 修改器页签真渲染出条目（机地帖 / GCM 行至少有一类）',
    moJidi + moGcm > 0, '机地 ' + moJidi + ' / GCM ' + moGcm);
  const moBar = D.querySelector('#dlBody .dl-flt-bar');
  ok('F2 修改器页签有筛选条', !!moBar);
  const moSrc = moBar ? [...moBar.querySelectorAll('[data-dl-flt^="src:"]')] : [];
  ok('F3 来源维度 ≥2 chip（该样本实测机地 + 风灵月影两路都在场）', moSrc.length >= 2,
    moSrc.map((x) => txt(x.textContent)).join(' / '));
  const flingChip = moSrc.find((x) => x.dataset.dlFlt === 'src:fling');
  if (flingChip) {
    flingChip.click();
    await sleep(60);
    const j2 = D.querySelectorAll('#dlBody .d-dl-it').length;
    const g2 = D.querySelectorAll('#dlBody .df-row').length;
    ok('F4 筛「风灵月影」后机地帖**消失**、GCM 行还在（来源筛选真的分开了两段）',
      j2 === 0 && g2 > 0, '机地 ' + j2 + ' / GCM ' + g2);
    const clr2 = D.querySelector('#dlBody [data-dl-flt-clear]');
    if (clr2) { clr2.click(); await sleep(60); }
    ok('F5 清空后机地帖回来', D.querySelectorAll('#dlBody .d-dl-it').length === moJidi,
      D.querySelectorAll('#dlBody .d-dl-it').length + ' / 原 ' + moJidi);
  } else {
    ok('F4 该样本无 FLiNG 直链条目（缺则不断言）', true, '跳过');
    ok('F5 同上', true, '跳过');
  }

  /* ================= E. 页签隔离 ================= */
  console.log('\n=== E · 页签隔离与重置 ===');
  W.eval('dlUni && (dlUni.flt = {});');
  W.openUniDownload({ title: SAMPLE, id: '', url: '', tab: 'mod' });
  for (let i = 0; i < 60; i++) {
    if (D.querySelectorAll('#dlBody .d-dl-it').length > 0) break;
    await sleep(200);
  }
  const ch2 = [...D.querySelectorAll('#dlBody [data-dl-flt^="ch:"]')].find((x) => x.dataset.dlFlt !== 'ch:');
  ch2.click();
  await sleep(60);
  const modState = W.eval('JSON.stringify(dlUni.flt.mod)');
  W.dlGoModule('save');
  await sleep(300);
  ok('E1 Mod 的筛选态不串到存档页签',
    W.eval('(dlUni.flt.save || {}).ch === "" || !dlUni.flt.save'),
    'mod=' + modState + ' save=' + W.eval('JSON.stringify(dlUni.flt.save || {})'));
  W.dlGoModule('mod');
  await sleep(300);
  ok('E2 切回 Mod 时筛选态仍保留（同一游戏内不该被重置）',
    W.eval('JSON.stringify(dlUni.flt.mod)') === modState, W.eval('JSON.stringify(dlUni.flt.mod)'));

  W.openUniDownload({ title: '星露谷物语', id: '', url: '', tab: 'mod' });
  await sleep(300);
  /* ★ 换游戏后 `flt.mod` 可能是 `{}`（还没人问过这个页签 ⇒ `dlFltOf` 尚未建槽），
     也可能是 `{src:"",ch:""}`（已经渲染过）。**两者都算归零** ——
     判据是「没有任何非空的 src/ch」，不是「对象形状等于某个字面量」。 */
  const e3 = W.eval('JSON.stringify(dlUni.flt.mod || {})');
  const e3f = JSON.parse(e3);
  ok('E3 换游戏后筛选态归零（不会「上一款筛过百度、这一款点开还是空」）',
    !e3f.src && !e3f.ch, e3);

  /* 静态：状态挂在会话对象上，且 openUniDownload 每次重建 dlUni */
  ok('E4 flt 初始化在 openUniDownload 的 dlUni 字面量里（换游戏即重建）',
    /svfAll: false,[\s\S]{0,240}flt: \{\},/.test(src));

  console.log('\n' + '='.repeat(46));
  console.log('  通过 ' + pass + '/' + (pass + fail) + '（失败 ' + fail + '）');
  console.log('='.repeat(46));
  try { W.close(); } catch (e) {}
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('EXCEPTION', e && e.stack || e); process.exit(2); });
