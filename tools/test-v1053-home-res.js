/* ★ v10.53 浏览器回归（第二层：真实浏览器 + CDP）：
 *   首页内容库卡的「资源维度」+ 筛选行第五个开关「🧩 有 MOD」。
 *
 * 守护的不变量（改前的实测缺口见 v10.53 文档第一节）：
 *   A. 筛选行有**五个**开关，且宽屏（1440）仍在**同一行**（加开关最易翻车的地方）
 *   B. `🧩 有 MOD / 🛠 有修改器 / 💾 有存档` 三个筛选的命中数与接口 `total` **逐档一致**
 *   C. ★★ **每一个筛出来的卡片，卡面上都有对应 chip** —— 这是本版的核心承诺：
 *      「筛选」与「卡面」同源（都走 data/res-groups.js）⇒ 不可能出现
 *      「筛出来看不见为什么」（旧 sv 口径 5,119 款如此）
 *   D. 卡面 chip 的**数字**与接口 `res` 逐档对齐（不写死条数，随库变化仍然对）
 *   E. 点 chip → 抽屉 + 下载弹窗**同时**打开且落在对应页签、页签里**真有条目**
 *   F. ★★ 点 chip **不重复触发**整卡的 `openDetail`（chip 在 `.row-card` 内部，
 *      不 `stopPropagation` 就会抽屉 + 弹窗同时开两次、后开的把先开的顶掉）
 *   G. 无横向溢出
 *
 * 反证锚点（打坏必变红）：
 *   · `bindRowCards` 里去掉 `e.stopPropagation()` ⇒ F 红（openDetail 被调 2 次）
 *   · `rowCard` 里去掉 `${resChips(it)}`      ⇒ C / D / E 全红
 *   · `/api/library/browse` 换回 `withBh`     ⇒ D / E 红（卡上没数字、点不动）
 *   · `libOpts` 里 `tr/sv` 换回 `xref.*`      ⇒ C 红（筛出来的卡很多没有对应 chip）
 */
const path = require('path');
const fs = require('fs');
const { connectBrowser, newPage, sleep } = require('./browser');
/* ★ Phase E 需要「GT-only 样本」——直接在 node 侧读聚合层挑，
 *   不写死游戏名：数据一刷新，写死的那款可能就不再是 GT-only 了。 */
const rg = require('../data/res-groups.js');

const BASE = process.env.BASE || 'http://127.0.0.1:8123';
const OUT = path.join(__dirname, '..', '_preview');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

/** 挑「某分区下**只有 GTrainers**」的样本（按库内 id 能对应上的那些）。
 *  为什么要这种样本：改前弹窗只取机地/GCM 与游侠文件 ⇒ 这些游戏 chip 点进去是**空页签**
 *  （实测 🛠 1,300/3,691 = 35.2% · 💾 842/1,377 = 61.1%）。 */
function pickGtOnly(cat, n) {
  rg.build();
  const out = [];
  for (const id of rg.libIdsFor(cat)) {
    const arr = rg.byLib(cat, id, 100000);
    if (arr.length && arr.every((x) => x.src === 'gt')) {
      out.push({ id, n: arr.length, game: arr[0].game || arr[0].title || '' });
      if (out.length >= n) break;
    }
  }
  return out;
}

let pass = 0; let fail = 0;
/* ★ 签名固定 (name, ok, extra) —— 别把条件写进第 1 个位置（PITFALLS 15：非空字符串恒为真）。 */
function chk(name, ok, extra) {
  if (ok) { pass++; console.log('  \u2705 ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.log('  \u274c ' + name + (extra ? '   ' + extra : '')); }
}
const j = (o) => JSON.stringify(o);

/* 三个资源筛选：开关 id → 卡面 chip 的类名后缀（口径必须与主源一致，改一处要改两处对不上就红） */
const FILTERS = [
  { id: 'modToggle', api: 'mod=1', chip: 'mod', label: '🧩 有 MOD', nm: 'MOD' },
  { id: 'trToggle', api: 'tr=1', chip: 'modifier', label: '🛠 有修改器', nm: '修改器' },
  { id: 'svToggle', api: 'sv=1', chip: 'save', label: '💾 有存档', nm: '存档' },
];

(async () => {
  const h = await connectBrowser();
  const p = await newPage(h.browser, { width: 1440, height: 1000 });
  p.on('pageerror', (e) => console.log('  \u26a0\ufe0f pageerror: ' + e.message));

  /* ★ F 段要用「openDetail 被调了几次」当判据。
   *   `openDetail` 是主源顶层的 `function` 声明（**不是** `let`）⇒ 会挂到 window，
   *   这里包一层计数。⚠️ 注意 `openDetailById` 内部**也会**调 openDetail
   *   （chip 走的是 openDetailById ⇒ 正常路径本来就有 1 次），
   *   所以判据是「恰好 1 次」而不是「0 次」—— 2 次才说明整卡那层也被触发了。 */
  const waitList = async () => {
    await p.waitForSelector('#colMain .filter-bar .size-pill', { timeout: 30000 });
    await p.waitForSelector('#colMain .row-card', { timeout: 30000 });
    await sleep(1200);
  };

  await p.goto(BASE + '/index.html', { waitUntil: 'networkidle2', timeout: 60000 });
  await waitList();
  const patchOk = await p.evaluate(() => {
    if (typeof window.openDetail !== 'function') return false;
    window.__odCount = 0;
    const orig = window.openDetail;
    window.openDetail = function (...a) { window.__odCount++; return orig.apply(this, a); };
    return true;
  });

  /* ---------------- Phase A：筛选行五个开关 + 排版 ---------------- */
  const a = await p.evaluate(() => {
    const toggles = [...document.querySelectorAll('#colMain .filter-row .bh-toggle')];
    const rects = toggles.map((t) => t.getBoundingClientRect());
    const top = (s) => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().top) : null; };
    return {
      count: toggles.length,
      ids: toggles.map((t) => t.id),
      texts: toggles.map((t) => t.textContent.replace(/\s+/g, ' ').trim()),
      sameLine: rects.length ? Math.max(...rects.map((r) => r.top)) - Math.min(...rects.map((r) => r.top)) <= 2 : false,
      ownRow: (() => {
        const t = document.querySelector('#modToggle'), s = document.querySelector('#sizePills');
        if (!t || !s) return false;
        return t.getBoundingClientRect().top >= s.getBoundingClientRect().bottom - 2;
      })(),
      modIsLast: toggles.length ? toggles[toggles.length - 1].id !== 'modToggle' : false,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      cardCount: document.querySelectorAll('#colMain .row-card').length,
      chipsOnCards: document.querySelectorAll('#colMain .row-card .res-chip').length,
    };
  });
  await p.screenshot({ path: path.join(OUT, 'check-home-res-chips.png') });

  console.log('\n=== Phase A · 首页筛选行（1440 宽）===');
  console.log('  开关: ' + j(a.texts));
  console.log('  卡片 ' + a.cardCount + ' 张 · 卡面 chip ' + a.chipsOnCards + ' 枚');

  chk('A ★★ v10.53 筛选行有五个开关', a.count === 5, 'count=' + a.count);
  chk('A ★★ v10.53 第五个开关是 `#modToggle`（🧩 有 MOD）',
    a.ids.indexOf('modToggle') >= 0 && a.texts.some((t) => t.indexOf('🧩 有 MOD') >= 0), j(a.ids));
  chk('A ★★ v10.53 五个开关在 1440 宽下**同一行**（加开关最易翻车处）', a.sameLine === true, j(a.texts));
  chk('A 五个开关独占「筛选」行（不与容量控件抢行）', a.ownRow === true);
  chk('A ★ v10.53 开关顺序为「手机两枚 → 资源三枚」（MOD 不在最前/最后被塞成异常位）',
    a.modIsLast === true, j(a.ids));
  chk('G 首页无横向溢出', a.overflowX <= 0, 'overflowX=' + a.overflowX);
  chk('A ★ 默认视图就有卡片带 chip（否则后面几段会被「本来就空」蒙混过关）',
    a.chipsOnCards > 0, 'chips=' + a.chipsOnCards);
  /* 后面 Phase D 的「openDetail 恰好 1 次」全靠这个补丁 ⇒ 补丁没挂上时必须当场报警，
     否则计数恒为 undefined，`NaN - NaN` 的比较会静默变成「看起来差不多」。 */
  chk('A ★★ 埋点就位：`window.openDetail` 已包上计数器（没挂上时 Phase D 的判据全是空的）',
    patchOk === true);

  /* ---------------- Phase B：三个资源筛选 × 命中数 × 卡面 chip ---------------- */
  for (const f of FILTERS) {
    /* 先清掉其它两个开关，保证是「单条件」命中数，才能和接口逐档比 */
    await p.evaluate((ids) => {
      ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el && el.classList.contains('on')) el.click();
      });
    }, FILTERS.map((x) => x.id));
    await sleep(1500);
    await p.evaluate((id) => document.getElementById(id).click(), f.id);
    await sleep(1800);

    const apiTotal = await p.evaluate(async (q) => {
      const r = await fetch('/api/library/browse?' + q + '&limit=1&offset=0');
      const jj = await r.json();
      return jj.total;
    }, f.api);

    const s = await p.evaluate((cls) => {
      const cards = [...document.querySelectorAll('#colMain .row-card')];
      const cnt = (document.getElementById('filterCount') || {}).textContent || '';
      return {
        cards: cards.length,
        withChip: cards.filter((c) => c.querySelector('.res-chip.' + cls)).length,
        chipTexts: cards.map((c) => {
          const el = c.querySelector('.res-chip.' + cls);
          return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
        }).filter(Boolean).slice(0, 3),
        cntTxt: cnt,
        cntNum: (() => {
          const m = cnt.match(/命中\s*([\d,]+)\s*款/);
          return m ? Number(m[1].replace(/,/g, '')) : null;
        })(),
        on: document.getElementById('modToggle') && ['modToggle', 'trToggle', 'svToggle']
          .filter((id) => document.getElementById(id).classList.contains('on')).length,
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
      };
    }, f.chip);

    console.log('\n=== Phase B · 点「' + f.label + '」 ===');
    console.log('  接口 total=' + apiTotal + ' · 卡面命中=' + s.cntNum + ' · 卡片 ' + s.cards + ' 张 / 带 chip ' + s.withChip + ' 张');
    console.log('  chip 样例: ' + j(s.chipTexts));

    chk('B ★★ v10.53「' + f.label + '」卡面命中数与接口 total 一致',
      s.cntNum === apiTotal && apiTotal > 0, '卡面=' + s.cntNum + ' 接口=' + apiTotal);
    chk('B ★★ v10.53「' + f.label + '」筛出来的**每一张**卡片都有对应 chip（筛选⇄卡面同源）',
      s.cards > 0 && s.withChip === s.cards, s.withChip + '/' + s.cards);
    chk('B ★ v10.53「' + f.label + '」同时只有一个资源开关在活跃态（互不叠加）', s.on === 1, 'on=' + s.on);
    chk('B chip 文案带单位「' + f.nm + '」', s.chipTexts.length > 0 && s.chipTexts.every((t) => t.indexOf(f.nm) >= 0),
      j(s.chipTexts));
    chk('G 「' + f.label + '」筛选后仍无横向溢出', s.overflowX <= 0, 'overflowX=' + s.overflowX);

    /* 复位，给下一档一个干净起点 */
    await p.evaluate((id) => document.getElementById(id).click(), f.id);
    await sleep(1200);
  }

  /* ---------------- Phase C：卡面 chip 数字 vs `/api/res/game` 的 counts 逐档对齐 ----------------
   * ★ 为什么要先点一下「🧩 有 MOD」：**默认视图 40 张卡里只有 3 张带资源**
   *   （实测）—— 样本太小，`checked>=5` 这条会假红，而且「全对」也只是碰巧。
   *   进筛选态后 40 张卡全部带 chip，样本才够。
   * ★ 为什么比 `/api/res/game` 而不是 `/api/library/browse` 的 `res`：
   *   前者是**弹窗自己用的那个接口**，比后者更接近「用户点下去会看到什么」——
   *   卡面 chip ⇄ 弹窗内容同源，才是本版真正要守的东西（`countsFor` 与 `byLib`
   *   都出自同一个 `byKeyCat.get(c+'|L:'+id)`，所以两处**必须**逐档相等）。
   * ★ 为什么不写死数字：264 / 1,377 / 3,691 是今天的快照，写死等于把套件绑在 mods.json 上。 */
  await p.evaluate(() => {
    const el = document.getElementById('modToggle');
    if (el && !el.classList.contains('on')) el.click();
  });
  await sleep(1800);
  const c1 = await p.evaluate(async () => {
    const ORD = [['mod', 'mod', '🧩', 'MOD'], ['trainers', 'modifier', '🛠', '修改器'], ['saves', 'save', '💾', '存档']];
    const cards = [...document.querySelectorAll('#colMain .row-card')]
      .filter((c) => c.querySelector('.res-chip'))
      .slice(0, 8);
    const bad = [];
    let checked = 0;
    for (const c of cards) {
      const chips = [...c.querySelectorAll('.res-chip')].map((x) => ({
        tab: x.dataset.resTab, txt: x.textContent.replace(/\s+/g, ' ').trim(), rid: x.dataset.resId,
      }));
      const rid = chips.length ? chips[0].rid : '';
      if (!rid) { bad.push({ rid, why: 'chip 缺 data-res-id' }); continue; }
      let counts = null;
      try {
        const jj = await (await fetch('/api/res/game?id=' + encodeURIComponent(rid) + '&limit=1')).json();
        counts = jj && jj.counts;
      } catch (e) { /* 落到下面报 */ }
      if (!counts) { bad.push({ rid, why: '/api/res/game 没有 counts' }); continue; }
      checked++;
      /* 期望串带 emoji 前缀（`.res-chip` 的文案就是 `🧩 3 MOD`）——
         本轮第一版没算上 emoji，导致「明明全对」却报不一致（断言自身写错了）。 */
      const want = ORD.filter(([k]) => Number(counts[k]) > 0)
        .map(([k, tab, ic, nm]) => tab + ':' + ic + ' ' + Number(counts[k]) + ' ' + nm);
      const got = chips.map((x) => x.tab + ':' + x.txt);
      if (JSON.stringify(want) !== JSON.stringify(got)) bad.push({ rid, want, got });
    }
    return { cards: cards.length, checked, bad: bad.slice(0, 3) };
  });
  console.log('\n=== Phase C · 卡面 chip 数字 vs /api/res/game counts（在「🧩 有 MOD」筛选态）===');
  console.log('  逐张核过 ' + c1.checked + ' 张卡片（带 chip 的卡共 ' + c1.cards + ' 张）');
  if (c1.bad.length) console.log('  不一致样例: ' + j(c1.bad));

  chk('C ★★ v10.53 取样够：至少逐张核过 5 张带资源的卡（样本太小不算测过）', c1.checked >= 5, 'checked=' + c1.checked);
  chk('C ★★ v10.53 每张卡的 chip 档位与数字**都与 /api/res/game 的 counts 逐档对齐**（空 = 全对）',
    c1.bad.length === 0, c1.bad.length ? j(c1.bad) : '全部对齐');

  /* ---------------- Phase D：点 chip → 抽屉 + 弹窗 + 页签 + 不重复触发行点击 ---------------- */
  const target = await p.evaluate(() => {
    /* 此时页面停在「🧩 有 MOD」筛选态 ⇒ 每张卡的第一枚 chip 必然是 `mod`（`RES_CHIPS` 顺序就是
       mod → modifier → save），点进去是机地社区帖 —— 判据「页签里有条目」稳定成立。 */
    const chip = document.querySelector('#colMain .row-card .res-chip.mod')
      || document.querySelector('#colMain .row-card .res-chip');
    if (!chip) return null;
    const card = chip.closest('.row-card');
    let fb = null;
    try { fb = JSON.parse(decodeURIComponent(card.dataset.fb)); } catch (e) { /* 忽略 */ }
    return {
      tab: chip.dataset.resTab, id: chip.dataset.resId,
      cardId: fb && fb.id, txt: chip.textContent.replace(/\s+/g, ' ').trim(),
    };
  });
  /* chip 的 `data-res-id` 必须能真的查到库里 —— 这是「拿归属 id 而不是显示 id」的**结果**判据：
     显示条目 id 在孪生场景下查不到资源，`/api/mods/match` 只能靠名称模糊兜底撞回来。 */
  const ridOk = target && target.id
    ? await p.evaluate(async (id) => {
      const r = await fetch('/api/library/item?id=' + encodeURIComponent(id));
      const jj = await r.json();
      return !!(jj && jj.ok && jj.item);
    }, target.id)
    : false;
  const before = await p.evaluate(() => window.__odCount);
  await p.evaluate(() => {
    const c = document.querySelector('#colMain .row-card .res-chip.mod')
      || document.querySelector('#colMain .row-card .res-chip');
    if (c) c.click();
  });
  await sleep(3600);
  const d = await p.evaluate(() => {
    const dr = document.getElementById('drawer');
    const pop = document.getElementById('dlPop');
    /* ⚠️ `dlUni` 是主源顶层的 `let`（全局词法绑定，**不挂 window**）——
     *   写 `window.dlUni` 恒 undefined ⇒ tab 读成 null ⇒ 假红（铁律 51）。裸写 + try 兜 TDZ。 */
    let tab = null;
    try { tab = dlUni ? dlUni.tab : null; } catch (e) { tab = null; }
    return {
      drawerShown: !!dr && dr.classList.contains('show'),
      popShown: !!pop && !pop.hidden,
      tab,
      rows: document.querySelectorAll('#dlBody .d-dl-it').length,
      odCount: window.__odCount,
    };
  });
  await p.screenshot({ path: path.join(OUT, 'check-home-res-goto.png') });
  console.log('\n=== Phase D · 点首页卡上的 chip ===');
  console.log('  chip=' + j(target) + ' · click 前后 openDetail 调用 ' + before + ' → ' + d.odCount);

  chk('D ★ v10.53 正向锚点：首页卡上真找到了一枚 chip（找不到时下面的断言会平白变绿）', !!target, j(target));
  chk('D ★ v10.53 chip 带 `data-res-id`（归属条目 id，不是显示条目 id）',
    !!target && !!target.id, j(target));
  chk('D ★★ v10.53 点 chip 打开详情抽屉', d.drawerShown === true, j(d));
  chk('D ★★ v10.53 点 chip **同时**打开下载弹窗（只开抽屉 = 没落到页签）', d.popShown === true, j(d));
  chk('D ★★ v10.53 弹窗落在 chip 指定的页签', d.tab === target.tab, 'tab=' + d.tab + ' 期望=' + (target && target.tab));
  chk('D ★★ v10.53 该页签**真渲染出条目**（页签对了但列表空 = resId 没传对）', d.rows > 0, 'rows=' + d.rows);
  /* ★★ F：这条就是 `stopPropagation` 的判据。正常路径 = openDetailById 内部那 1 次；
     整卡那层若也被触发 ⇒ 2 次（抽屉被后一次重绘顶掉，弹窗可能跟着消失）。 */
  chk('D ★★ v10.53 点 chip **只触发一次** openDetail（2 次 = 整卡点击也被触发，stopPropagation 失效）',
    d.odCount - before === 1, '差值=' + (d.odCount - before));
  chk('D ★★ v10.53 chip 的 `data-res-id` 能在本地库查到（归属 id 是真的库内 id）',
    ridOk === true, 'resId=' + (target && target.id) + ' 卡片id=' + (target && target.cardId));

  /* ---------------- Phase E：下载弹窗的 **GTrainers 腿**（本版的核心修复） ----------------
   * 改前：修改器页签 = 机地帖 + GCM；存档页签 = 游侠文件 ⇒ **GT-only 的游戏点进去是空页签**
   *       （实测 🛠 1,300/3,691 = 35.2% · 💾 842/1,377 = 61.1%）。
   * 这里直接拿 GT-only 样本开弹窗（不经首页卡，避免样本挑不出来的脆弱依赖），
   * 断言「页签里真有条目 + 角标是 GT + 通道是真直链 + 内容段排在出口之前」。
   * ★ 反证锚点：把 `dlUniLoad` 里的 `dlUniFetchGt` 那一路去掉 ⇒ 本节全红。 */
  const SAMPLES = [
    { cat: 'saves', tab: 'save', nm: '存档', list: pickGtOnly('saves', 1) },
    { cat: 'trainers', tab: 'modifier', nm: '修改器', list: pickGtOnly('trainers', 1) },
  ];
  for (const sp of SAMPLES) {
    const s0 = sp.list[0];
    console.log('\n=== Phase E · 弹窗「' + sp.nm + '」页签 GT 腿（样本 ' + (s0 ? s0.id + ' ' + s0.game : '无') + '）===');
    if (!s0) {
      chk('E ' + sp.nm + '：挑得到 GT-only 样本（挑不到时下面的断言会平白变绿）', false, '聚合层没有 GT-only 组');
      continue;
    }
    const e = await p.evaluate(async (arg) => {
      window.openUniDownload({ id: arg.id, title: arg.game, tab: arg.tab });
      await new Promise((r) => setTimeout(r, 3200));
      const body = document.getElementById('dlBody');
      const agg = body.querySelector('.dl-agg');
      const rows = agg ? [...agg.querySelectorAll('.d-dl-it')] : [];
      const kids = [...body.children];
      let tab = null; let cnt = null;
      try { tab = dlUni ? dlUni.tab : null; } catch (err) { tab = null; }   // 铁律 51：`dlUni` 是 let，不挂 window
      try { cnt = dlUni ? dlUni.cnt[arg.tab] : null; } catch (err) { cnt = null; }
      let counts = null;
      try {
        const jj = await (await fetch('/api/res/game?id=' + encodeURIComponent(arg.id) + '&limit=1')).json();
        counts = jj && jj.counts;
      } catch (err) { /* 落到断言里报 */ }
      return {
        tab, cnt, counts,
        agg: !!agg, rows: rows.length,
        tag: rows.length ? (rows[0].querySelector('.k') || {}).textContent : null,
        lks: rows.length ? rows[0].querySelectorAll('.dl-res-lk a').length : 0,
        aggIdx: kids.findIndex((x) => x.classList.contains('dl-agg')),
        outIdx: kids.findIndex((x) => x.classList.contains('d-dl-links')),
        head: (() => { const b = body.querySelector('.dl-sv-head .t b'); return b ? Number(b.textContent.trim()) : null; })(),
        note: agg ? ((agg.querySelector('.dl-note') || {}).textContent || '') : '',
      };
    }, { id: s0.id, title: s0.game, tab: sp.tab });
    const wantN = Math.min(60, (e.counts && e.counts[sp.cat]) || 0);
    console.log('  接口 counts[' + sp.cat + ']=' + ((e.counts && e.counts[sp.cat]) || 0)
      + ' · .dl-agg 行 ' + e.rows + ' · 角标 ' + j(e.tag) + ' · 首行通道 ' + e.lks
      + ' · cnt=' + e.cnt + ' · head=' + e.head);

    chk('E ★ v10.53 落到「' + sp.nm + '」页签', e.tab === sp.tab, 'tab=' + e.tab);
    chk('E ★★ v10.53 「' + sp.nm + '」页签**真渲染出 GT 段**（改前这里 rows=0 —— 空页签）',
      e.agg === true && e.rows === wantN && e.rows > 0, 'rows=' + e.rows + ' 期望=' + wantN);
    chk('E ★ v10.53 GT 行角标写「GT」（与机地帖 / GCM 的角标视觉可分）',
      String(e.tag || '').trim() === 'GT', 'tag=' + j(e.tag));
    chk('E ★★ v10.53 GT 行给的是**真下载通道**（≥1 个 `.dl-res-lk a`，不是只有「源站」出口）',
      e.lks >= 1, 'lks=' + e.lks);
    chk('E ★ v10.53 GT 段的说明里点名来源（含「GTrainers」）', /GTrainers/.test(e.note));
    chk('E ★★ v10.53 GT 段排在「出口链接」**之前**（内容在出口前，别把出口读成「到此为止」）',
      e.aggIdx >= 0 && e.outIdx >= 0 && e.aggIdx < e.outIdx, 'agg@' + e.aggIdx + ' out@' + e.outIdx);
    if (sp.tab === 'modifier') {
      chk('E ★★ v10.53 修改器角标含 GT（= 机地 + GCM + GT 之和，不再只数前两路）',
        e.cnt > 0 && e.cnt >= wantN, 'cnt=' + e.cnt + ' GT=' + wantN);
    } else {
      chk('E ★★ v10.53 存档页头数字 = 接口 counts.saves（GT-only 样本上游侠文件为 0）',
        e.head === wantN, 'head=' + e.head + ' 期望=' + wantN);
      chk('E ★★ v10.53 存档角标与卡面 `💾 N 存档` 同数（同源，不 over-claim 位置条数）',
        e.cnt === wantN, 'cnt=' + e.cnt + ' 期望=' + wantN);
    }
    /* 关掉弹窗，避免影响下一轮取样 */
    await p.evaluate(() => { const pp = document.getElementById('dlPop'); if (pp) { pp.hidden = true; pp.classList.remove('on'); } });
    await sleep(400);
  }

  /* ⚠️ 收尾汇总行的格式是**约定**：同行必须含「通过」且带 `n / m`（中间不许夹字）。
     写成 `48 通过 / 0 失败` 时 run-all 的 `\d+\s*\/\s*\d+` 匹配不上 ⇒ 成绩退化成
     从明细里猜（实测被 `40/40` 那条顶掉）。 */
  console.log('\n\u2500\u2500 首页资源维度：' + pass + ' / ' + (pass + fail) + ' 通过 \u2500\u2500');
  await h.browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
