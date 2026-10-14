/* 首页首屏几何（第二层：真实浏览器 + CDP）
 *
 * 本套件的**唯一职责**：守住「首屏那一截」是像素事实 —— 它能测、且必须被守。
 *
 * 现状（v10.74 实测，1440×1000 / 820×900 / 390×844）：
 *   hero 424 / 461 / 544 · 轮播 200 / 200 / 132 · 卡片 61 / 61 / 54（各 8 张）
 *   列表首条 top 750 / 830 / 862 · 首屏内可见游戏条目 13 / 10 / 9
 *
 * ── 三版演进（每次改口径都留在这里，免得下轮有人拿旧目标来「修正」实现）──
 * v10.68：改前首屏 **一条游戏都露不出来** —— 探针实测：顶栏 61 + hero 570 + 区块头 27
 *         + 分类行 + 筛选面板 167 ⇒ 列表容器 top = **985 / 1000**；
 *         移动端更夸张：hero 1289 ⇒ 列表 top 1877（要滚 2.2 屏）。⇒ 本轮目标是「压 hero」，
 *         并顺手定下「骨架高 = 真卡高」「取样别取到 .date-sep」这些基础设施。
 * v10.70：hero 从深蓝渐变通栏改白底分区（参考 XDGAME 天梯排名）；榜单 #1-6 由 3 列 3 行改 5 列 1 行；
 *         并新增**平板 820×900** 这一档 —— 它守的是**断点区间**（761~1060 那个「两头都不管」的夹缝），
 *         只测 1440 与 390 永远测不到那里。
 *
 * ★★ v10.74（本次）：**前 5 名改轮播图 + #6-13 走 4 列 × 2 行卡片**（用户拍板，共 13 个游戏）。
 *   ⇒ hero 由 ~200px 回到 ~424px：v10.68/v10.70 的「压首屏」成果被**有意**让回一部分，
 *     换来轮播的视觉分量。**这不是回归**，是拍板过的取舍（用户明确选了「200px 中等档」
 *     而不是更小的方案）。
 *   ⇒ **本套件的核心口径随之改变**（这是本次改造的重点，不是「把阈值放宽了事」）：
 *       · 旧口径「首屏内完整可见的**列表**条数」不再合适 —— 首屏现在被**榜单**占满，
 *         列表本来就在第二屏。继续用它守，会在「首屏明明装着 13 个游戏」时报「0 条可见」，
 *         得出**方向完全相反**的结论。
 *       · 新口径 =「首屏内完整可见的**游戏条目**数」= 轮播当前张 + 卡片 + 列表行。
 *         它比旧口径**更严**：既守「首屏必须有内容」，也守「榜单不能只露半截」。
 *       · 「列表首条 top」保留为**退化护栏**（不再是「必须进首屏」）：hero 再涨 ~60px 就红。
 *
 * 负向守卫（打坏必变红，对应实现见 test-v1074 反证套件）：
 *   · `.rk-car` 高度 200 → 320                       ⇒ A①② / D① 红
 *   · `.rk-grid` 从 `repeat(4,…)` 改回 `repeat(5,…)`  ⇒ B③「桌面 4 列」红
 *   · 移动端 `.rk-grid` 改回 flex 横滑                 ⇒ E③ 红
 *   · `.rk-car .slide.cur` 改回 `.on`                  ⇒ B④ 红（`.on` 被 rankMark 占用）
 *   · 删掉 `.cat-row .statline{flex:none;…}`           ⇒ E①② 红
 *
 * ⚠️ 阈值怎么定：**取拍板目标 + 余量**，不是「照抄当前实测值」。
 *   照抄 ⇒ 任何人做一次正常微调这里就红，防线变噪音；取目标+余量 ⇒ 只有真退回
 *   「占满一屏」才红。余量的现实来源是字体替换与**数据换行**（榜单标题每档长短都不同）。
 *   v10.74 的拍板目标是「轮播 200px 档」：实测 hero 424 ⇒ 闸 470（余量 46），
 *   轮播一旦改成 280 档会到 ~504 ⇒ 立刻红。
 *
 * 跑法：node tools/test-home-fold.js     （需服务在 8123；约 25 s）
 */
const path = require('path');
const { connectBrowser, newPage, sleep } = require('./browser');

const BASE = process.env.BASE || 'http://127.0.0.1:8123';

/* 三档视口 = 拍板时真正看的那几屏。**别只测桌面与移动**：761~1060 那个夹缝里的问题
   （v10.70 的 `.grid2` 横向溢出、v10.74 又冒出来的顶栏溢出）两头都测不到。
   逐档的实测与阈值依据见文件头「现状」与「三版演进」。 */
const VIEWPORTS = [
  /* ★★ v10.74 阈值重定（**先实测再定**，实测值见文件头「现状」表）：
     hero 424 → 闸 470（余量 46）；轮播 200 → 闸 210；卡片高 61 → 闸 72。
     ★ 为什么余量取 ~10%：真实漂移来源是字体替换与**数据换行**（榜单标题长短每档都不同），
       不是布局本身。取目标+余量 ⇒ 正常数据波动不红，真退回「轮播 280 档 / 卡片堆 3 行」才红。 */
  { key: '桌面 1440×1000', w: 1440, h: 1000, heroMax: 470, carMax: 210, cardHMax: 72, cardN: 8, colN: 4, rowN: 2, rowMax: 64, foldMin: 9, firstTopMax: 800 },
  /* ★★ 平板 820×900 这一档守的是**断点区间**（`≤760` 紧凑 / `761~1060` 单列桌面语言 / `>1060` 两栏），
     不是第三个尺寸 —— 只测 1440 与 390 会永远漏掉中间档（v10.70 的横向溢出、
     v10.74 又冒出来的顶栏溢出都只存在于这一档）。 */
  { key: '平板 820×900', w: 820, h: 900, heroMax: 510, carMax: 210, cardHMax: 72, cardN: 8, colN: 4, rowN: 2, rowMax: 64, foldMin: 6, firstTopMax: 880 },
  /* 移动档：轮播降到 132px（≤420 断点），卡片走 2 列 ⇒ 8 张 = 4 行。
     ★ `firstTopMax` 920 > 视口 844 —— 这一条在移动端**已不是「必须进首屏」**，
       而是「hero 不许再涨」（实测 862，余量 58）。首屏的内容保证由 foldMin 那条负。
       为什么不删：删了就没人拦「有人把移动 hero 又加高 200px」。 */
  { key: '移动 390×844', w: 390, h: 844, heroMax: 600, carMax: 145, cardHMax: 66, cardN: 8, colN: 2, rowN: 4, rowMax: 66, foldMin: 5, firstTopMax: 920 },
];

const PROBE = () => {
  const R = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), w: Math.round(r.width) };
  };
  /* ★★ 只取 `.row-card` —— `#libList` 的第一个子元素是**日期分隔行** `.date-sep`（实测 20px）。
     写成 `#libList > *` 会把分隔行当成第一张卡：行高报 20px（真值 74px）、
     首条 top 报 690（真值 718）、可见条数多数一条（4 / 真值 3）。
     三个数全错、且**全绿** —— 这就是「喂错样本 ⇒ 假绿」，2026-10 首次踩到。 */
  const rows = [...document.querySelectorAll('#libList > .row-card')].map((e) => R(e));
  const seps = [...document.querySelectorAll('#libList > .date-sep')];
  const rankCards = [...document.querySelectorAll('#rankList .rk-grid .rk-card')];
  const grid = document.querySelector('#rankList .rk-grid');
  /* ★ v10.74：轮播 —— 张数 / 当前张 / `cur` 与 `on` 各自的计数（见下方 B④ 的用意）。 */
  const slides = [...document.querySelectorAll('#rankList .rk-car .slide')];
  const car = document.querySelector('#rankList .rk-car');
  const stat = document.querySelector('.cat-row .statline');
  const catRow = document.querySelector('.cat-row');
  const cs = (el) => (el ? getComputedStyle(el) : null);
  /* 「完整可见」= 上下边界都落在视口内。不用「露了个头」：只露 5px 的卡片对用户
     等于没看见 —— 用宽松判据会让 foldMin 这条**假绿**。 */
  const inFold = (el) => {
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight;
  };
  const curSlide = slides.find((s) => s.classList.contains('cur'));
  return {
    vh: innerHeight,
    stage: R(document.getElementById('rankStage')),
    car: R(car),
    carN: slides.length,
    /* ★★ 这两个计数是**语义分离**的守卫：`cur` = 轮播当前张（同一时刻只能有 1 张）；
       `on` = rankMark() 给「当前打开的详情」加的通用激活类。两者一旦混用，
       打开任意详情就会把**所有** slide 一起点亮（它们在 CSS 里都靠这个类控制可见性）。 */
    carCurN: slides.filter((s) => s.classList.contains('cur')).length,
    carOnN: slides.filter((s) => s.classList.contains('on')).length,
    carInFold: curSlide ? inFold(curSlide) : false,
    cardTops: rankCards.map((c) => Math.round(c.getBoundingClientRect().top)),
    cardN: rankCards.length,
    cardH: rankCards[0] ? Math.round(rankCards[0].getBoundingClientRect().height) : null,
    /* 列数用**首行卡数**判，而不是读 `grid-template-columns` —— 后者是写法，
       落点才是效果（改字号/封面尺寸也可能把卡挤到第二行）。 */
    cardColN: (() => {
      if (!rankCards.length) return 0;
      const t0 = Math.round(rankCards[0].getBoundingClientRect().top);
      return rankCards.filter((c) => Math.round(c.getBoundingClientRect().top) === t0).length;
    })(),
    cardInFold: rankCards.filter(inFold).length,
    gridDisp: grid ? cs(grid).display : null,
    gridOverflowX: grid ? cs(grid).overflowX : null,
    rows,
    rowN: rows.length,
    sepN: seps.length,
    firstTop: rows[0] ? rows[0].top : null,
    rowH: rows[0] ? rows[0].h : null,
    rowInFold: rows.filter((r) => r.bottom <= innerHeight).length,
    /* ★★ v10.74 新口径：首屏内完整可见的**游戏条目**数
       = 轮播当前张(0/1) + 卡片 + 列表行。
       旧的「只看列表行」在本版会给出 0，而首屏其实装着 13 个游戏 —— 方向完全反了的结论。 */
    gameInFold: (curSlide && inFold(curSlide) ? 1 : 0) + rankCards.filter(inFold).length + rows.filter((r) => r.bottom <= innerHeight).length,
    catRowH: catRow ? Math.round(catRow.getBoundingClientRect().height) : null,
    statH: stat ? Math.round(stat.getBoundingClientRect().height) : null,
    // 横向溢出：文档宽 vs 视口宽（1px 容差，别把亚像素舍入判成溢出）
    docScrollW: document.documentElement.scrollWidth,
    secNos: [...document.querySelectorAll('.sec-no')].map((e) => e.textContent.trim()),
    secSubH: (() => { const e = document.querySelector('.sec-sub'); return e ? Math.round(e.getBoundingClientRect().height) : null; })(),
  };
};

let pass = 0; let fail = 0;
/* ★ 签名固定 (name, ok, extra) —— 别把条件写进第 1 个位置（PITFALLS 15：非空字符串恒为真）。 */
function chk(name, ok, extra) {
  if (ok) { pass++; console.log('  \u2705 ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.log('  \u274c ' + name + (extra ? '   ' + extra : '')); }
}

(async () => {
  const h = await connectBrowser();
  try {
    for (const v of VIEWPORTS) {
      console.log('\n=== ' + v.key + ' ===');
      const p = await newPage(h.browser, { width: v.w, height: v.h, scale: 1 });
      await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await sleep(3000);
      /* 等首批列表渲染 —— 不等就会出现「0 条可见」的**假红**（数据还没到，
         不是布局问题）。这也是为什么必须先有 A1 这条阳性对照。 */
      for (let i = 0; i < 24; i++) {
        if (await p.evaluate(() => document.querySelectorAll('#libList > *').length) > 0) break;
        await sleep(500);
      }
      const r = await p.evaluate(PROBE);

      /* A1 阳性对照 —— 没有它，后面所有「条数」断言在「接口挂了」时会以
         「0 条可见」的形式**假红**，方向完全反了（是没数据，不是布局退化）。 */
      chk('A1 阳性对照：#libList 真渲染出 .row-card（否则下面的条数断言不成立）', r.rowN > 0, 'n=' + r.rowN);
      /* A2 阳性对照（第二重）：日期分隔行也在 —— 它是「秩序语言」的落点，
         且**是它让首条 `.row-card` 的 top 不等于列表容器 top**（取样时必须区分，
         混在一起会把行高量成 20px）。 */
      chk('A2 阳性对照：列表里有 .date-sep 日期分隔行（它先于第一张卡，取样要区分）', r.sepN >= 1, 'n=' + r.sepN);

      /* A 首屏高度 */
      chk('A  ① hero（#rankStage）高 ≤ ' + v.heroMax + 'px', r.stage && r.stage.h <= v.heroMax,
        '实测 ' + (r.stage ? r.stage.h : '—') + 'px' + (r.stage ? '（top ' + r.stage.top + '）' : ''));
      /* A② 由「榜首卡高」改成「轮播高」—— v10.74 冠军卡已被轮播取代（`.rk-champ` 不复存在）。
         轮播高度是本版的**拍板项**（用户选的是 200px 档），所以它必须自己有一条硬闸：
         否则有人把高度改成 280/360 时，A① 只在 hero 涨过闸才报警，反馈太迟。 */
      chk('A  ② 轮播高 ≤ ' + v.carMax + 'px（拍板档位，不是随手值）', r.car && r.car.h <= v.carMax,
        '实测 ' + (r.car ? r.car.h : '—') + 'px');

      /* B 榜单结构（v10.74）= #1-5 轮播 + #6-13 两行 × 四列（移动 2 列） */
      chk('B  ① 轮播 5 张 · 卡片 8 张（共 13 个 = 用户拍板口径）',
        r.carN === 5 && r.cardN === v.cardN,
        '轮播 ' + r.carN + ' 张 / 卡片 ' + r.cardN + ' 张（期望 5 / ' + v.cardN + '）');
      const rowSet = new Set(r.cardTops);
      /* 行数 = 8 张 ÷ 列数 ⇒ 桌面/平板 4 列 = 2 行，移动 2 列 = 4 行。
         ★ 不写死 2 —— 列数变了行数必然跟着变（第一版就是写死 2，移动端当场红）。 */
      chk('B  ② ★ 卡片排成 ' + v.rowN + ' 行（top 去重后恰为 ' + v.rowN + ' 个值）',
        r.cardTops.length > 0 && rowSet.size === v.rowN,
        '行数 ' + rowSet.size + ' tops=' + r.cardTops.join(','));
      /* 列数用**首行卡数**实测，不读 `grid-template-columns` —— 前者是效果，后者只是写法。 */
      chk('B  ③ ★ 卡片列数 = ' + v.colN, r.cardColN === v.colN,
        '首行 ' + r.cardColN + ' 张｜display=' + r.gridDisp);
      /* ★★ B④ 语义分离守卫：`cur` = 轮播当前张（同刻只能 1 张）/ `on` = 详情联动高亮。
         两者混用 ⇒ 打开任意详情会把**所有** slide 一起点亮（CSS 里靠同一个类控可见性）。
         理由与踩法见 index.html 里 `.rk-car .slide.cur` 那段注释。
         ★ 静止态下 slide 的 `on` 必须恒为 0（没人打开详情）。 */
      chk('B  ④ ★★ slide 用 `cur` 不用 `on`（`on` 被 rankMark 占用，混用会让多张同时可见）',
        r.carCurN === 1 && r.carOnN === 0, 'cur=' + r.carCurN + ' on=' + r.carOnN);
      chk('B  ⑤ 卡片高 ≤ ' + v.cardHMax + 'px（放大后仍在闸内）', r.cardH != null && r.cardH <= v.cardHMax,
        '实测 ' + r.cardH + 'px');

      /* C 行密度 */
      chk('C  ① 列表行高 ≤ ' + v.rowMax + 'px', r.rowH != null && r.rowH <= v.rowMax, '实测 ' + r.rowH + 'px');
      /* C ② 取样合理性（不是设计规格）：行高 ≥ 40px。若这里报 ~20px，说明取样又取到了
         `.date-sep` 分隔行 —— 那种情况下 C①/D①/D② 会**同时全绿但全错**，
         所以必须有这条独立的、能把「取错样本」单独照出来的断言。 */
      chk('C  ② 取样合理性：行高 ≥ 40px（≈20px 就是取到 .date-sep 了）', r.rowH != null && r.rowH >= 40,
        '实测 ' + r.rowH + 'px');

      /* D 首屏 —— 本套件存在的理由。★★ v10.74 口径已变（依据见文件头「三版演进」）：
         旧口径只看**列表**条数，会在本版给出「0 条可见」的**反向结论** ——
         而实测首屏装着 13 个游戏（轮播 1 + 卡片 8 + 列表 4）。 */
      chk('D  ① 列表首条 top ≤ ' + v.firstTopMax + 'px（退化护栏：hero 再涨就红）',
        r.firstTop != null && r.firstTop <= v.firstTopMax, '实测 ' + r.firstTop + 'px / 视口 ' + r.vh);
      chk('D  ② ★★ 首屏内完整可见的**游戏条目** ≥ ' + v.foldMin + '（= 轮播当前张 + 卡片 + 列表行）',
        r.gameInFold >= v.foldMin,
        '实测 ' + r.gameInFold + ' 个（轮播 ' + (r.carInFold ? 1 : 0) + ' + 卡片 ' + r.cardInFold + ' + 列表 ' + r.rowInFold + '）');
      /* D③ 阳性对照：轮播那一张**必须**在首屏内 —— 否则 D② 的 1 分是凭空加的。
         没有它，把轮播挪出首屏时 D② 仍可能靠卡片凑够闸值而不报红。 */
      chk('D  ③ 阳性对照：轮播当前张本身完整可见（否则 D② 的 +1 是虚的）', r.carInFold === true);

      /* E 移动端分类行 —— 守 v10.68 修掉的真缺陷（`.statline` 内部换行把行撑高） */
      if (v.w <= 760) {
        chk('E  ① ★★ 移动端 .cat-row 高 ≤ 60px（改前被 .statline 换行撑到 181px）',
          r.catRowH != null && r.catRowH <= 60, '实测 ' + r.catRowH + 'px');
        chk('E  ② 移动端 .cat-row .statline 保持**单行**（高 ≤ 24px）', r.statH != null && r.statH <= 24,
          '实测 ' + r.statH + 'px');
        /* ★★ v10.74 **方向反转**：移动端卡片区从「横向滚动单行」改成 **2 列网格**。
           为什么反转（不是把旧断言删掉）：横滑单行是为了把 5 张卡压进一行高度；
           本版要「放大卡片」且要一屏看到更多条 ⇒ 2 列网格一屏能看到 4 条，
           横滑只能露 74% 还要动手划。若有人改回横滑，这条必须红。 */
        chk('E  ③ ★★ 移动端卡片区是 **2 列网格**（不是横滑单行）',
          r.gridDisp === 'grid' && r.gridOverflowX === 'visible' && r.cardColN === 2,
          'display=' + r.gridDisp + ' overflowX=' + r.gridOverflowX + ' 首行=' + r.cardColN + ' 张');
        /* E④ 由「flex-basis 不是 100%」换成本版真实存在的约束：移动端轮播降高。
           横滑时代的那个判据随 E③ 一起作废（`flex-basis` 在 grid 里恒为 auto，测不出东西）。 */
        chk('E  ④ ★ 移动端轮播降高（≤ ' + v.carMax + 'px；桌面档是 200）',
          r.car && r.car.h <= v.carMax, '实测 ' + (r.car ? r.car.h : '—') + 'px');
      }

      /* F 秩序语言（拍板「全采纳」的那一条，必须真有落点 —— 存在 ≠ 可见） */
      if (v.w > 760) {
        chk('F  ① 区块编号 .sec-no 存在且含 01/02', r.secNos.includes('01') && r.secNos.includes('02'),
          JSON.stringify(r.secNos));
        chk('F  ② 桌面 .sec-sub 说明行**真占版面**（不许藏成 0 高）', r.secSubH != null && r.secSubH > 0,
          '实测 ' + r.secSubH + 'px');
      } else {
        chk('F  ③ 移动端 .sec-sub 隐藏（寸土寸金，首屏优先）', r.secSubH === 0, '实测 ' + r.secSubH + 'px');
      }

      /* G 无横向溢出 */
      chk('G  ① 无横向溢出（文档宽 ≤ 视口宽 + 1px）', r.docScrollW <= v.w + 1,
        'doc ' + r.docScrollW + ' vs vp ' + v.w);

      await p.close();
    }
  } finally {
    await h.close();
  }

  /* ⚠️ 收尾汇总行的格式是**约定**：同行必须含「通过」且带 `n / m`（中间不许夹字）。
     写成 `N 通过 / M 失败` 时 run-all 的 `\d+\s*\/\s*\d+` 就匹配不上 ⇒ 成绩退化成从明细里猜。 */
  console.log('\n\u2500\u2500 首页首屏几何：' + pass + ' / ' + (pass + fail) + ' 通过 \u2500\u2500');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
