/* tools/test-v1074-carousel-live.js — 第二层（真实浏览器 + CDP）：首页榜单轮播的**真交互**
 *
 * 与 `test-v1074-rank-carousel.js`（静态层，只读源码 + 跑纯函数）的分工：
 *   · 静态层守「代码长什么样」：常量、位置先后、五页同步。
 *   · **本套件守「用户真按下去会怎样」** —— 静态层全绿也可能点了没反应
 *     （监听器没挂上 / 类名写错 / 定时器把索引推乱）。
 *
 * 为什么必须单独立一套（而不是塞进 `test-home-fold.js`）：
 *   test-home-fold 只**量几何**（轮播多高、几列、首屏几个），它不点、不等、不改档。
 *   本版新引入的三类风险全都只在「交互之后」才显形：
 *     ① ★★ **定时器纪律**：切档会整体重渲 `#rankList`，旧 interval 若不停，
 *        会继续推**已被替换掉**的 DOM ⇒ 索引以 **2 倍速**前进（用户感知是「点一下跳两格」）。
 *        几何套件看不出来（`.cur` 任何时候都恰好 1 张，只是切得又快又乱）。
 *     ② **手动切**：箭头落在 `.slide` 之上（z-index 4 > 3），`stopPropagation` 一漏
 *        ⇒ 点箭头会**连带打开详情抽屉**（点「下一页」结果跳走了）。
 *     ③ **往回绕**：`-1` 的取模若写成 `i % n`，索引会变 `-1` ⇒ 所有 slide 全灭（黑屏）。
 *
 * ★★ 判「两种定时器并存」的手法（C2 / D2）：不数 `setInterval` 的个数（数不到 ——
 *   它藏在主源内联脚本的模块级 `let` 里，外部拿不到），而是**量相邻两次切张的时间间隔**。
 *   单个定时器 ⇒ 间隔恒 ≈ 5000ms；两个定时器同时推 ⇒ 间隔被挤成 ≈ 2500ms。
 *   判据取「全部间隔 ≥ 4000ms」：不依赖具体实现值，只依赖「没有第二个推手」这个事实。
 *
 * ★ 采样点的选择（这也是本套件唯一的慢源，两处各 11.5s）：
 *   必须把鼠标**移出轮播**再计时 —— 轮播有 `mouseenter → rkCarStop`（悬停暂停）。
 *   鼠标停在轮播上时两次间隔会拉到 5s+（暂停那段不计），判据会**假绿**。
 *
 * 跑法：node tools/test-v1074-carousel-live.js   （需 8123 在跑；约 40 s）
 */
const { connectBrowser, newPage, sleep } = require('./browser');

const BASE = process.env.BASE || 'http://127.0.0.1:8123';
/* 自动播放间隔是 5000ms（主源 `RK_CAR_MS`）。
   采样窗取 11.5s ⇒ 单定时器应切 2 次（两个间隔）；两个定时器同时推会切 4 次、
   其中两个间隔只有 ~2500ms ⇒ 被 C2/D2 的 4000ms 下限照出来。 */
const WATCH_MS = 11500;
const GAP_MIN = 4000;

let pass = 0; let fail = 0;
function chk(name, ok, extra) {
  if (ok) { pass++; console.log('  \u2705 ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.log('  \u274c ' + name + (extra ? '   ' + extra : '')); }
}
function hr(t) { console.log('\n' + '\u2500'.repeat(74) + '\n' + t + '\n' + '\u2500'.repeat(74)); }

/* 一次把轮播与卡片区的**全部可判状态**取回来（少几次往返，也保证同一时刻取样） */
const READ = () => {
  const car = document.getElementById('rkCar');
  const q = (s) => [...document.querySelectorAll(s)];
  if (!car) return { car: false };
  const slides = q('#rkCar .slide');
  const dots = q('#rkCar .dot');
  const cards = q('#rankList .rk-grid .rk-card');
  const libCards = q('#rankList .rk-grid .rk-card.libsrc');
  const idxOf = (arr, cls) => arr.findIndex((e) => e.classList.contains(cls));
  const t0 = cards.length ? Math.round(cards[0].getBoundingClientRect().top) : 0;
  return {
    car: true,
    n: slides.length,
    cur: idxOf(slides, 'cur'),
    curN: slides.filter((s) => s.classList.contains('cur')).length,
    /* `.on` 在本项目是 `rankMark()` 的通用激活类。slide 若被它点亮，
       打开任意详情会**所有张一起亮**（v10.74 的设计约束，见主源 CSS 注释）。 */
    slideOnN: slides.filter((s) => s.classList.contains('on')).length,
    dotN: dots.length,
    dotOn: idxOf(dots, 'on'),
    dotOnN: dots.filter((d) => d.classList.contains('on')).length,
    arwN: q('#rkCar .arw').length,
    arwDisp: q('#rkCar .arw').map((a) => getComputedStyle(a).display),
    carH: Math.round(car.getBoundingClientRect().height),
    cardN: cards.length,
    cardColN: cards.filter((c) => Math.round(c.getBoundingClientRect().top) === t0).length,
    libN: libCards.length,
    firstLib: cards.length ? cards[0].classList.contains('libsrc') : null,
    /* 补位卡的措辞必须是「📚 库内 x」而不是「🔥 x 热度」——
       实测补位池 hot 高达 348,068，而真榜条目 week 档只有 0/10 ⇒
       照常显示热度会让补位条目比第 1 名还显眼，看着像「真榜从第 11 名才开始」。 */
    libTxt: libCards.length ? libCards[0].textContent : '',
    srcCardTxt: cards.length && !cards[0].classList.contains('libsrc') ? cards[0].textContent : '',
    metaTxt: (document.getElementById('rankMeta') || { textContent: '' }).textContent,
    drawerOn: !!(document.getElementById('drawer') || {}).classList
      && document.getElementById('drawer').classList.contains('show'),
    drawerTxt: (document.getElementById('drawerBody') || { textContent: '' }).textContent.slice(0, 400),
  };
};

/* 装一个观察器：把「`.cur` 真正换人」的**时刻**逐个记下来。
   为什么不轮询：`rkCarGo` 会连改多个 class，轮询可能跨过切换瞬间；
   MutationObserver 记的是事件发生的那一刻，间隔才准。

  ★★ 但 MutationObserver 会把**同一次任务内的中间态**也报出来，这里有两处必须过滤，
     否则本套件会自己造出两条假红（第一版就是这么写的，已实测修掉）：
     ① `rkCarGo` 是 `slides.forEach(toggle)` —— 先摘掉旧张的 `cur`、再给新张加上，
        中间有一瞬间 **0 张** 带 `cur`。那一刻浏览器**根本没绘制**（同一个同步任务里），
        用户永远看不到黑帧 ⇒ 不能拿「每个变异都要 1 张」当判据。
     ② 同一原因，`findIndex` 在中间态返回 **-1** —— 若照单全收，**一次切换会被记成两个时刻**
        （间隔 ~0ms），C2/D2 的「间隔 ≥ 4000ms」就永远红。
     ⇒ 只在「恰好 1 张 `cur`」的稳定态里判定换人；同时把 `curN` 记全，
        用来守「**任何时刻都不许 ≥2 张同时亮**」这条真判据。 */
const INSTALL_WATCH = () => {
  const car = document.getElementById('rkCar');
  window.__carT = [];
  window.__carCurN = [];
  window.__carIdx = [...car.querySelectorAll('.slide')].findIndex((s) => s.classList.contains('cur'));
  const grab = () => {
    const slides = [...car.querySelectorAll('.slide')];
    const n = slides.filter((s) => s.classList.contains('cur')).length;
    window.__carCurN.push(n);
    if (n !== 1) return; /* ← 任务内中间态，见上方 ① */
    const cur = slides.findIndex((s) => s.classList.contains('cur'));
    if (cur !== window.__carIdx) { window.__carT.push(Math.round(performance.now())); window.__carIdx = cur; }
  };
  const obs = new MutationObserver(grab);
  obs.observe(car, { subtree: true, attributes: true, attributeFilter: ['class'] });
  window.__carObs = obs;
  return true;
};

(async () => {
  const h = await connectBrowser();
  try {
    /* ============================================================
       A–F. 桌面 1440×1000
       ============================================================ */
    const p = await newPage(h.browser, { width: 1440, height: 1000, scale: 1 });
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    /* 等榜单真渲染 —— 不等就会把「接口还没回来」误判成「轮播坏了」。
       这也是 A0 这条阳性对照存在的理由。 */
    let ok0 = false;
    for (let i = 0; i < 40; i++) {
      if (await p.evaluate(() => document.querySelectorAll('#rkCar .slide').length)) { ok0 = true; break; }
      await sleep(500);
    }
    await sleep(800);
    const r0 = await p.evaluate(READ);

    hr('A. 结构（桌面 1440×1000）—— 轮播 5 张 + 卡片 8 张 = 13 个游戏');
    chk('A0 阳性对照：轮播真渲染出 .slide（否则下面全是「没数据」的假红）', ok0 && r0.car && r0.n > 0,
      'n=' + (r0.car ? r0.n : '—'));
    chk('A1 ★★ 轮播恰好 5 张（用户原话：前五做成轮播图）', r0.n === 5, '实测 ' + r0.n + ' 张');
    chk('A2 ★★ 同一时刻恰好 1 张 `.cur`（visible）', r0.curN === 1, '实测 ' + r0.curN + ' 张 cur=' + r0.cur);
    /* A3：`.on` 语义分离 —— slide 一个都不许带 `.on`（那是 rankMark 的地盘） */
    chk('A3 ★★ slide 上没有任何 `.on`（负向：`.on` 被 rankMark 占用，混用会把全部张点亮）',
      r0.slideOnN === 0, '实测 ' + r0.slideOnN);
    chk('A4 ★ 指示点 5 个、恰好 1 个 `.on`', r0.dotN === 5 && r0.dotOnN === 1,
      '点 ' + r0.dotN + ' 个 / on ' + r0.dotOnN);
    /* A5：视觉与状态**一致** —— 高亮的那颗点必须就是当前那张（错了用户会以为点歪了） */
    chk('A5 ★★ 高亮指示点的索引 === 当前 slide 索引（视觉与状态一致）', r0.dotOn === r0.cur,
      'dot.on=' + r0.dotOn + ' cur=' + r0.cur);
    chk('A6 ★ 左右箭头都在', r0.arwN === 2, '实测 ' + r0.arwN);
    chk('A7 ★★ 卡片恰好 8 张（13 - 轮播 5）', r0.cardN === 8, '实测 ' + r0.cardN);
    chk('A8 ★★ 卡片是 4 列 × 2 行（首行 4 张）', r0.cardColN === 4, '首行 ' + r0.cardColN + ' 张');
    chk('A9 ★ 轮播高度是拍板的 200px 档（195~215）', r0.carH >= 195 && r0.carH <= 215, '实测 ' + r0.carH + 'px');

    /* ---- B. 手动切（真鼠标事件，走 page.click 的坐标命中） ----
       ★ 为什么每条都「点前读一次、点后读一次」而不是跟 r0.cur 比：
         自动播放每 5s 会自己推一格，把绝对索引当基准 ⇒ 这一组会**间歇性变红**
         （跑得慢的时候正好撞上一次自动切张）。只断言**位移**就与自动播放无关。 */
    hr('B. 手动切：箭头 / 指示点 / 往回绕 / 不误开详情');
    const b0 = await p.evaluate(READ);
    await p.click('#rkCar .arw.next');
    await sleep(700);
    const r1 = await p.evaluate(READ);
    chk('B1 ★★ 点「下一张」⇒ 前进 1 格', r1.cur === (b0.cur + 1) % 5, 'cur ' + b0.cur + ' → ' + r1.cur);
    const b2in = await p.evaluate(READ);
    await p.click('#rkCar .arw.prev');
    await sleep(700);
    const r2 = await p.evaluate(READ);
    chk('B2 ★ 点「上一张」⇒ 后退 1 格', r2.cur === (b2in.cur + 4) % 5, 'cur ' + b2in.cur + ' → ' + r2.cur);
    /* B3：从第 1 张往回绕 —— 取模写错（`i % n` 而非 `((i%n)+n)%n`）时索引变 -1，
       表现是**五张全灭**（`.cur` 计数 0）。先点 `data-i="0"` 把索引钉到 0，再往回。 */
    await p.click('#rkCar .dot[data-i="0"]');
    await sleep(600);
    const b3in = await p.evaluate(READ);
    await p.click('#rkCar .arw.prev');
    await sleep(700);
    const r3 = await p.evaluate(READ);
    chk('B3 ★★ 从第 1 张往回绕 ⇒ 落到第 5 张（负索引取模：不许出现 .cur=0 张的黑屏）',
      b3in.cur === 0 && r3.cur === 4 && r3.curN === 1,
      '起点 ' + b3in.cur + ' → cur=' + r3.cur + ' curN=' + r3.curN);
    await p.click('#rkCar .dot[data-i="2"]');
    await sleep(700);
    const r4 = await p.evaluate(READ);
    chk('B4 ★ 点第 3 颗指示点 ⇒ 直接跳到第 3 张', r4.cur === 2, 'cur=' + r4.cur);
    /* B5：箭头 / 指示点都落在 `.slide` 之上（z-index 4 > 3）⇒ 少了 stopPropagation
       就会「切页 ＋ 顺手打开详情」。判据是「点前关着、点后**仍然**关着」——
       ★ 故意不先 `remove('show')` 归零：那样会把「前面几步已经漏开过抽屉」一起抹掉。 */
    const b5pre = await p.evaluate(() => !document.getElementById('drawer').classList.contains('show'));
    await p.click('#rkCar .arw.next');
    await sleep(900);
    const r5 = await p.evaluate(READ);
    chk('B5 ★★ 点箭头**不会**连带打开详情抽屉（stopPropagation 生效）',
      b5pre === true && r5.drawerOn === false, '点前关=' + b5pre + ' 点后 show=' + r5.drawerOn);

    /* ---- C. 自动播放 + 定时器间隔（★ 鼠标必须先移出轮播） ---- */
    hr('C. 自动播放：真的在走，且**只有一个推手**（间隔恒 ~5s）');
    await p.mouse.move(3, 3); /* 移出轮播 —— 悬停会 rkCarStop，停在上面计时会假绿 */
    await sleep(400);
    await p.evaluate(INSTALL_WATCH);
    await sleep(WATCH_MS);
    const w1 = await p.evaluate(() => ({ t: window.__carT, curN: window.__carCurN }));
    const gaps1 = w1.t.slice(1).map((v, i) => v - w1.t[i]);
    chk('C1 ★★ 自动播放真的在走（11.5s 窗口内至少切了 1 次）', w1.t.length >= 1,
      '切换 ' + w1.t.length + ' 次');
    /* C2 = 本套件对「旧定时器没停」的主判据。间隔被挤到 ~2500ms ⇒ 红。 */
    chk('C2 ★★ 相邻两次切换间隔全部 ≥ ' + GAP_MIN + 'ms（负向：两个定时器并存会挤成 ~2.5s）',
      gaps1.length > 0 && gaps1.every((g) => g >= GAP_MIN),
      '间隔 ' + JSON.stringify(gaps1) + '（单定时器应 ≈5000）');
    /* C3 的判据是「**任何时刻都不许 ≥2 张同时亮**」，不是「每个采样都恰好 1 张」——
       后者会被 `rkCarGo` 内部「先摘后加」中间态的 0 张判定为红，而那一帧浏览器
       根本没绘制（同一个同步任务内）。判据要守的是**真缺陷**：`.cur` 与 `.on` 混用时
       全部张一起亮。稳定态的「恰好 1 张」由 A2 / D1 在不动的时候单独守。 */
    chk('C3 ★★ 切换过程中从不出现 ≥2 张同时亮（`.cur`/`.on` 混用的典型症状）',
      w1.curN.length > 0 && w1.curN.every((n) => n <= 1),
      '采样 ' + w1.curN.length + ' 次 / 最大 ' + Math.max.apply(null, w1.curN));
    const c4 = await p.evaluate(READ);
    chk('C4 ★ 采样结束后仍是稳定态：恰好 1 张 `.cur`', c4.curN === 1 && c4.cur >= 0, 'cur=' + c4.cur);

    /* ---- D. 切档后的定时器纪律（本版最容易踩的坑） ---- */
    hr('D. 切档（周 → 月）：重渲之后轮播**重建且只有一个推手**');
    await p.click('.stage-pill[data-p="month"]');
    await sleep(2500);
    const d1 = await p.evaluate(READ);
    chk('D1 ★★ 切档后轮播重建：仍是 5 张 + 恰好 1 张 `.cur` + 卡片 8 张',
      d1.car && d1.n === 5 && d1.curN === 1 && d1.cardN === 8,
      'slide ' + d1.n + ' cur ' + d1.curN + ' 卡 ' + d1.cardN);
    /* ★★ D2：切档后**重新装观察器**再计时 —— 旧容器已销毁，旧观察器跟着失效。
       如果 `rkCarStop()` 没在重渲前调用，旧 interval 会继续推**新容器**，
       表现为间隔被挤成 ~2500ms（用户感知「点一下跳两格」）。 */
    await p.mouse.move(3, 3);
    await sleep(400);
    await p.evaluate(INSTALL_WATCH);
    await sleep(WATCH_MS);
    const w2 = await p.evaluate(() => ({ t: window.__carT, curN: window.__carCurN }));
    const gaps2 = w2.t.slice(1).map((v, i) => v - w2.t[i]);
    chk('D2 ★★ 切档后间隔仍全部 ≥ ' + GAP_MIN + 'ms（负向：旧 interval 未停 ⇒ 2 倍速）',
      w2.t.length >= 1 && gaps2.every((g) => g >= GAP_MIN),
      '切换 ' + w2.t.length + ' 次 / 间隔 ' + JSON.stringify(gaps2));
    chk('D3 ★ 切档后自动播放**没有**被永久停掉（重渲要重新起播）', w2.t.length >= 1,
      '切换 ' + w2.t.length + ' 次');

    /* ---- E. 补位条目的真渲染（与接口 meta 对齐） ---- */
    hr('E. 补位（源站每档只给 10 行，而首页要 13 个 ⇒ 尾部由本地库热度补）');
    const api = await p.evaluate(async () => {
      const r = await fetch('/api/rank?p=week');
      const j = await r.json();
      return { fill: (j.meta || {}).filled, srcN: (j.meta || {}).srcN, showN: (j.meta || {}).showN, n: (j.list || []).length };
    });
    chk('E0 阳性对照：接口真有补位（filled > 0）—— 否则 E1/E2 是无样本的空断言',
      api.fill > 0, 'meta filled=' + api.fill + ' srcN=' + api.srcN + ' showN=' + api.showN + ' list=' + api.n);
    /* 回到周榜再验一次（D 段把页面切到了月榜；这时接口值仍以周榜为准，故先切回） */
    await p.click('.stage-pill[data-p="week"]');
    await sleep(2500);
    const e = await p.evaluate(READ);
    chk('E1 ★★ 页面上的 `.libsrc` 卡片数 === 接口 meta.showN - srcN（补位不是照目录写的静态数）',
      e.libN === (api.showN - api.srcN), '页面 ' + e.libN + ' vs 接口 ' + (api.showN - api.srcN));
    chk('E2 ★★ 补位卡的措辞是「📚 库内」（不是「🔥 x 热度」）',
      e.libTxt.indexOf('\u5e93\u5185') !== -1 && e.libTxt.indexOf('\ud83d\udd25') === -1,
      JSON.stringify(e.libTxt.slice(0, 60)));
    chk('E3 ★★ 第 1 张卡不是补位卡（负向：真榜名次不许被补位条目顶掉）', e.firstLib === false);
    chk('E4 ★ meta 文案如实说明补位条数（不许让用户以为第 11-13 名也是官方名次）',
      e.metaTxt.indexOf('\u5e93\u5185\u70ed\u5ea6\u8865\u4f4d') !== -1, JSON.stringify(e.metaTxt.slice(0, 90)));

    /* ---- F. 点卡片进详情（13 个卡片的点击链必须真通） ---- */
    hr('F. 点卡片 ⇒ 打开详情抽屉');
    const firstName = await p.evaluate(() => {
      const c = document.querySelector('#rankList .rk-grid .rk-card');
      c.scrollIntoView({ block: 'center' });
      return ((c.querySelector('.t') || c).textContent || '').trim().slice(0, 12);
    });
    await sleep(500);
    await p.click('#rankList .rk-grid .rk-card');
    await sleep(1800);
    const f = await p.evaluate(READ);
    chk('F1 ★★ 点卡片打开了详情抽屉（._ 只挂监听是不够的，要真开）', f.drawerOn === true,
      'drawer.show=' + f.drawerOn);
    chk('F2 ★★ 抽屉里出现的就是刚点的那款（不是错位 / 空壳）',
      f.drawerTxt.length > 0 && (firstName.length < 3 || f.drawerTxt.indexOf(firstName.slice(0, 2)) !== -1),
      JSON.stringify(firstName) + ' → 抽屉前 40 字 ' + JSON.stringify(f.drawerTxt.slice(0, 40)));
    await p.close();

    /* ============================================================
       G. 移动端 390×844 —— 箭头藏起来，指示点必须仍能切
       ============================================================ */
    hr('G. 移动端 390×844：箭头隐藏，但**指示点仍可切**（触摸端唯一入口）');
    const pm = await newPage(h.browser, { width: 390, height: 844, scale: 1 });
    await pm.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    for (let i = 0; i < 40; i++) {
      if (await pm.evaluate(() => document.querySelectorAll('#rkCar .slide').length)) break;
      await sleep(500);
    }
    await sleep(800);
    const m0 = await pm.evaluate(READ);
    chk('G0 阳性对照：移动端轮播也渲染了', m0.car === true && m0.n === 5, 'n=' + (m0.car ? m0.n : '—'));
    /* 箭头在 ≤760 档 `display:none`（36px 的圆钮在 390 宽下会压住标题） */
    chk('G1 ★★ 移动端箭头是 `display:none`（负向：36px 圆钮会压住标题）',
      m0.arwDisp.length === 2 && m0.arwDisp.every((d) => d === 'none'), JSON.stringify(m0.arwDisp));
    chk('G2 ★ 移动端轮播降高（132px 档，实测 ≤145）', m0.carH <= 145, '实测 ' + m0.carH + 'px');
    await pm.click('#rkCar .dot[data-i="3"]');
    await sleep(800);
    const m1 = await pm.evaluate(READ);
    chk('G3 ★★ 移动端点第 4 颗指示点仍能切张（箭头藏了，点是指示点唯一入口）',
      m1.cur === 3 && m1.curN === 1, 'cur=' + m1.cur + ' curN=' + m1.curN);
    /* 移动端卡片 2 列 ⇒ 8 张 = 4 行 */
    chk('G4 ★★ 移动端卡片 2 列（8 张 = 4 行）', m0.cardColN === 2, '首行 ' + m0.cardColN + ' 张');
    await pm.close();

    /* ============================================================
       H. 派生页不许出现孤儿轮播
       ============================================================ */
    hr('H. 派生页无孤儿轮播（#rankStage 只在首页 ⇒ 那里不该有 .rk-car）');
    const pd = await newPage(h.browser, { width: 1440, height: 1000, scale: 1 });
    await pd.goto(BASE + '/resources.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(2500);
    const hh = await pd.evaluate(() => ({
      car: document.querySelectorAll('.rk-car').length,
      rk: document.querySelectorAll('#rkCar').length,
      stage: document.querySelectorAll('#rankStage').length,
    }));
    chk('H1 ★★ 派生页没有 `.rk-car` / `#rkCar`（轮播节点由 JS 现创建，静态 DOM 到这里会变孤儿）',
      hh.car === 0 && hh.rk === 0, 'car=' + hh.car + ' rkCar=' + hh.rk);
    chk('H2 ★ 派生页也没有 `#rankStage`（阳性对照的反面：首页有、派生页没有）', hh.stage === 0);
    await pd.close();
  } finally {
    await h.close();
  }

  /* ⚠️ 收尾汇总行的格式是**约定**：同行必须含「通过」且带 `n / m`（中间不许夹字）。 */
  console.log('\n\u2500\u2500 首页榜单轮播（真交互）：' + pass + ' / ' + (pass + fail) + ' 通过 \u2500\u2500');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
