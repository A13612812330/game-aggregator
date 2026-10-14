/* 首页首屏几何（第二层：真实浏览器 + CDP）
 *
 * 本套件的**唯一职责**：守住「首屏那一截」是像素事实 —— 它能测、且必须被守。
 *
 * 现状（v10.75 实测，1440×1000 / 820×900 / 390×844）：
 *   hero **1175 / 878 / 748** · 轮播 **559 / 359 / 132**（均由 `aspect-ratio` 算出）
 *   卡片 **6 张 3 列 2 行 / 6 张 3 列 2 行 / 6 张 2 列 3 行**（卡高 253 / 187 / 141）
 *   列表首条 top **1501 / 1248 / 1066** · 首屏内可见游戏条目 **4 / 4 / 7**
 *   ★ 轮播与卡片的封面比例实测都与原图一致（`carAR == carImgAR == 2.14`，不裁不压）
 *
 * ⚠️ 跑法：`node tools/test-home-fold.js`（默认 8123 常驻）。
 *   改动期间请用 **8124 临时实例**：`BASE=http://127.0.0.1:8124 node tools/test-home-fold.js`。
 *   常驻服务的 `server.js` 是**启动时加载**的（`public/*.html` 才是按请求读盘）⇒
 *   常驻未重启时榜单接口仍是旧逻辑，几何会整体偏移（本轮实测差 267px）。
 *
 * ── 四版演进（每次改口径都留在这里，免得下轮有人拿旧目标来「修正」实现）──
 * v10.68：改前首屏 **一条游戏都露不出来** —— 探针实测：顶栏 61 + hero 570 + 区块头 27
 *         + 分类行 + 筛选面板 167 ⇒ 列表容器 top = **985 / 1000**；
 *         移动端更夸张：hero 1289 ⇒ 列表 top 1877（要滚 2.2 屏）。⇒ 本轮目标是「压 hero」，
 *         并顺手定下「骨架高 = 真卡高」「取样别取到 .date-sep」这些基础设施。
 * v10.70：hero 从深蓝渐变通栏改白底分区（参考 XDGAME 天梯排名）；榜单 #1-6 由 3 列 3 行改 5 列 1 行；
 *         并新增**平板 820×900** 这一档 —— 它守的是**断点区间**（761~1060 那个「两头都不管」的夹缝），
 *         只测 1440 与 390 永远测不到那里。
 * v10.74：**前 5 名改轮播图 + #6-13 走 4 列 × 2 行卡片**（用户拍板，共 13 个游戏）。
 *   ⇒ hero 由 ~200px 回到 ~424px：v10.68/v10.70 的「压首屏」成果被**有意**让回一部分，
 *     换来轮播的视觉分量。**这不是回归**，是拍板过的取舍（用户明确选了「200px 中等档」）。
 *   ⇒ 口径改为「首屏内完整可见的**游戏条目**数」= 轮播当前张 + 卡片 + 列表行。
 *
 * ★★ v10.75（本次）：用户原话「**轮播图适配图片的高度**」「卡片优化，一行显示 3 个、
 *   **放大适配游戏大图而不是压缩游戏图片**，显示内容**游戏名 + 游戏标签 + 游戏大小**即可」。
 *   ⇒ 三处结构性变化，本套件的口径与阈值**随之重定**（不是放宽）：
 *       ① 轮播高从固定 200px 改为 **`aspect-ratio:var(--cover-ar)`（= 封面原图 460:215）**
 *          ⇒ 桌面 559px / 平板 359px / 移动 132px —— 高度变成**视口宽的函数**，
 *            所以在 A② 里「守 px 数」已经守不住意图了：**改成守比例**（容器比例 == 原图比例）。
 *            这条是用户诉求的直接量化：「适配图片的高度」在数值上就是 `carAR == carImgAR`。
 *       ② 卡片 8 张 4 列 → **6 张 3 列**（轮播 5 + 卡片 6 = 展示 11 个，原 13 个）；
 *          卡片由横条改**上图下文竖卡**、封面**占满卡宽**（桌面 ~389px 宽 ≈ 原 72px 的 5 倍）。
 *       ③ hero 由 ~424 涨到 ~1175（轮播 559 的直接后果）⇒ **这是拍板取舍，不是回归**：
 *          与 v10.74 的取舍方向相同、幅度更大 —— 用户要的正是「大图」。
 *          「压首屏」成果进一步让回，**首屏游戏条目由 13 降到 4**（轮播 1 + 卡片 3），
 *          foldMin 随之由 9 → 3。红线（v10.68 的「一条都露不出来」）依旧守得住。
 *
 * 负向守卫（打坏必变红，对应实现见 test-v1074 反证套件）：
 *   · `.rk-grid` 从 `repeat(3,…)` 改回 `repeat(4,…)`              ⇒ B③「桌面 3 列」红
 *   · `.rk-car` 去掉 `aspect-ratio` 改回写死高度                    ⇒ A② 红（比例不等）
 *   · `.zh` 卡片信息行里多塞一个字段（如评分）                      ⇒ B⑥ 红
 *   · 移动端 `.rk-grid` 改回 flex 横滑                              ⇒ E③ 红
 *   · `.rk-car .slide.cur` 改回 `.on`                               ⇒ B④ 红（`.on` 被 rankMark 占用）
 *   · 删掉 `.cat-row .statline{flex:none;…}`                        ⇒ E①② 红
 *
 * ⚠️ 阈值怎么定：**取拍板目标 + 余量**，不是「照抄当前实测值」。
 *   照抄 ⇒ 任何人做一次正常微调这里就红，防线变噪音；取目标+余量 ⇒ 只有真退回
 *   「占满一屏」才红。余量的现实来源是字体替换与**数据换行**（榜单标题每档长短都不同）。
 *   v10.75 的拍板目标是「轮播按原图比例自适应（桌面约 560px）」：实测 hero 1175 ⇒ 闸 1250，
 *   hero 再涨 75px（≈ 轮播再放大 8%）就红。
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
  /* ★★ v10.75 阈值重定（**先实测再定**，实测值见下方「四版演进」的 v10.75 段）：
     hero 1175 → 闸 1250；轮播 559 → 闸 620（★ 见 A② 的说明：这条已**降级为上界**，
     本质判据换成了「容器比例 == 原图比例」）；卡片 6 张 / 3 列 / 2 行；卡高 253 → 闸 290；
     首屏游戏条目 4 → 闸 3；列表首条 1501 → 闸 1650。
     ★ 余量取 ~6–10%：漂移来源是字体替换与**数据换行**（榜单标题每档长短都不同）。 */
  { key: '桌面 1440×1000', w: 1440, h: 1000, heroMax: 1250, carMax: 620, cardHMax: 290, cardN: 6, colN: 3, rowN: 2, rowMax: 64, foldMin: 3, firstTopMax: 1650 },
  /* ★★ 平板 820×900 这一档守的是**断点区间**（`≤760` 紧凑 / `761~1060` 单列桌面语言 / `>1060` 两栏），
     不是第三个尺寸 —— 只测 1440 与 390 会永远漏掉中间档（v10.70 的横向溢出、
     v10.74 又冒出来的顶栏溢出都只存在于这一档）。
     ★ v10.75 注意：本档走的是**桌面语言**（3 列），与桌面同族但尺寸小一档。 */
  { key: '平板 820×900', w: 820, h: 900, heroMax: 950, carMax: 400, cardHMax: 215, cardN: 6, colN: 3, rowN: 2, rowMax: 64, foldMin: 3, firstTopMax: 1400 },
  /* 移动档：轮播 132px（由 `aspect-ratio` 算出，不再写死）、卡片走 2 列 ⇒ 6 张 = 3 行。
     ★ v10.75：卡片数由 8 降到 6，行数因此由 4 变 3。
     ★ `firstTopMax` 1200 > 视口 844 —— 这一条在移动端**已不是「必须进首屏」**，
       而是「hero 不许再涨」（实测 1066/1097，余量 ~130）。首屏的内容保证由 foldMin 那条负。
       为什么不删：删了就没人拦「有人把移动 hero 又加高 200px」。 */
  { key: '移动 390×844', w: 390, h: 844, heroMax: 830, carMax: 190, cardHMax: 165, cardN: 6, colN: 2, rowN: 3, rowMax: 66, foldMin: 5, firstTopMax: 1200 },
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
  /* ★★ v10.75 新增：轮播的**宽高比**（容器 vs 当前张的原图）。
     这是用户诉求「适配图片的高度 / 不要压缩图片」的**可测形式** ——
     高度是 px（随视口宽变），比例才是意图。两者相等 ⇒ 既不裁也不留白。 */
  const carImg = curSlide ? curSlide.querySelector('img') : null;
  const carR = car ? car.getBoundingClientRect() : null;
  return {
    vh: innerHeight,
    stage: R(document.getElementById('rankStage')),
    car: R(car),
    carAR: carR && carR.height ? +(carR.width / carR.height).toFixed(3) : null,
    carImgAR: carImg && carImg.naturalWidth ? +(carImg.naturalWidth / carImg.naturalHeight).toFixed(3) : null,
    carImgNat: carImg ? carImg.naturalWidth + 'x' + carImg.naturalHeight : null,
    /* 卡片封面同理：容器框比例 vs 图的原图比例 */
    cardBoxAR: (() => {
      const th = document.querySelector('#rankList .rk-grid .rk-card .th');
      if (!th) return null;
      const q = th.getBoundingClientRect();
      return q.height ? +(q.width / q.height).toFixed(3) : null;
    })(),
    cardImgAR: (() => {
      const i = document.querySelector('#rankList .rk-grid .rk-card .th img');
      return i && i.naturalWidth ? +(i.naturalWidth / i.naturalHeight).toFixed(3) : null;
    })(),
    /* 卡片文案：v10.75 只留「游戏名 + 分类标签 + 容量」三样，多一个就是没删干净 */
    cardTxt: (() => {
      const c = document.querySelector('#rankList .rk-grid .rk-card');
      if (!c) return null;
      return {
        name: (c.querySelector('.bd .t') || {}).textContent || '',
        kids: [...c.querySelectorAll('.bd .s > *')].map((e) => e.className).sort(),
      };
    })(),
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
      /* 等轮播封面**真的加载完** —— `naturalWidth` 为 0 时比例判据拿不到数，
         会把 A② 变成假红（图还没到，不是布局坏了）。这是「喂错样本 ⇒ 假红」的同一族。 */
      await p.evaluate(() => Promise.all(
        [...document.querySelectorAll('#rankList img')].slice(0, 8)
          .map((i) => (i.complete ? 1 : new Promise((res) => { i.onload = i.onerror = res; })))));
      await sleep(300);
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
      /* ★★ v10.75：A② 由「轮播高 ≤ 200px 档」**换成「容器比例 == 原图比例」**。
         为什么换（不是放宽）：v10.75 的轮播高是 `aspect-ratio:var(--cover-ar)` 算出来的，
         它是**视口宽的函数**（桌面 559 / 平板 359 / 移动 132）—— 继续守一个 px 数，
         会在三档里两档恒红，而且守的不是用户要的东西。
         用户原话是「**轮播图适配图片的高度**」，它在数值上的等价形式就是
         `容器宽高比 == 图片原始宽高比`（差 0 ⇒ 既不裁也不留白）。
         ★ 下面的 carMax 保留为**上界**（防有人把 aspect-ratio 删掉、写死一个超大高度），
           但它不再是这条的主判据。 */
      chk('A  ② ★★ 轮播容器比例 == 封面原图比例（「适配图片高度」的可测形式：不裁不压）',
        r.carAR != null && r.carImgAR != null && Math.abs(r.carAR - r.carImgAR) <= 0.05,
        '容器 ' + r.carAR + ' vs 原图 ' + r.carImgAR + '（' + r.carImgNat + '，轮播高 '
          + (r.car ? r.car.h : '—') + 'px ≤ 上界 ' + v.carMax + 'px）');
      chk('A  ②b 轮播高 ≤ ' + v.carMax + 'px（上界：防有人删掉 aspect-ratio 写死一个大高度）',
        r.car && r.car.h <= v.carMax, '实测 ' + (r.car ? r.car.h : '—') + 'px');

      /* B 榜单结构（v10.75）= #1-5 轮播 + #6-11 卡片（桌面/平板 3 列 × 2 行，移动 2 列 × 3 行） */
      chk('B  ① 轮播 5 张 · 卡片 ' + v.cardN + ' 张（共 ' + (5 + v.cardN) + ' 个 = 用户拍板口径）',
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
      /* ★★ v10.75 新增 B⑥：用户原话「显示内容**游戏名 + 游戏标签 + 游戏大小**即可」——
         「即可」是**上界**：多显示一样（评分 / 热度 / 源徽标）就算没照做。
         判据取**信息行的直接子元素类名**（`.s > *`），不数文字 ——
         文字会被「标题里本来就有数字」这类情况骗到（如「红色警戒2」）。
         ★ 必须有 `length >= 1` 前置：`every` 在空数组上恒真，否则「整行删空」也算通过。 */
      chk('B  ⑥ ★★ 卡片信息行只有「分类标签 + 容量」两枚（+ 游戏名 = 用户拍板的三样，「即可」是上界）',
        r.cardTxt && r.cardTxt.kids.length >= 1 && r.cardTxt.kids.length <= 2
          && r.cardTxt.kids.every((c) => c === 'tag' || c === 'sz'),
        '名称「' + (r.cardTxt ? r.cardTxt.name : '—') + '」子元素类=' + JSON.stringify(r.cardTxt ? r.cardTxt.kids : null));
      /* ★★ v10.75 新增 B⑦：用户原话「**放大适配游戏大图而不是压缩游戏图片**」——
         「不压缩」在数值上就是「封面框比例 == 原图比例」。
         ⚠️ 这条**必须靠实拍**：离线只能验 URL 形状（见 rank-merge.coverScore），
            而「源站那 128×128 的小方图到底有没有被换掉」只有浏览器量 `naturalWidth` 才知道。 */
      chk('B  ⑦ ★★ 卡片封面框比例 == 原图比例（「放大不压缩图片」的可测形式）',
        r.cardBoxAR != null && r.cardImgAR != null && Math.abs(r.cardBoxAR - r.cardImgAR) <= 0.05,
        '框 ' + r.cardBoxAR + ' vs 原图 ' + r.cardImgAR);

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
        chk('E  ④ ★ 移动端轮播高 ≤ ' + v.carMax + 'px（上界；实际值由 `aspect-ratio` 算出）',
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
