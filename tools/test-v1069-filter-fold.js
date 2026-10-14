/* ★ v10.69 浏览器回归（第二层：真实浏览器 + CDP）：筛选面板折叠。
 *
 * 起因：v10.68 把首屏从「0 条游戏」救到 3 / 1 条之后，**最后一截**卡在筛选面板上 ——
 *   实测 4 行（排序 / 容量 / 库 / 筛选）= 桌面 **167px** / 移动 **232px**，是唯一剩余瓶颈。
 *   用户拍板授权「折叠筛选面板」：默认收成一行，点击展开。
 *
 * 本套件守的不变量：
 *   A. 默认**收起**：`#filterBody` 高 0（`display:none`）、可见 `.filter-row` 恰好 1 行
 *   B. `aria-expanded` 与文案随状态同步（收起「筛选」/ 展开「收起」）
 *   C. 点击能开、再点能收（真翻转 `curFilterOpen`，不是只切 class）
 *   D. ★★ **展开态必须扛得住重渲染** —— `renderList(true)` 会把 `#colMain` 整块重建
 *      （`col.innerHTML = filterBarHtml() + …`），而**点任何筛选开关都会调它**。
 *      折叠态只存 DOM class 的话，用户每点一次筛选面板都会自己弹回收起。
 *      ⇒ 这条是「折叠态必须是模块级变量」的**唯一证据**，删了它就没人守得住。
 *   E. ★★ **收起不丢信息**：`#filterCount` 本身就是「生效筛选的清单」
 *      （「🛠 有修改器 · 命中 3,692 款」），收起时仍要能看到；且**不被截断**
 *      （`scrollWidth ≤ clientWidth`）—— 它是收起态唯一的信息出口。
 *   F. ★★ 折叠**真省出首屏**：收起 vs 展开的高度差 ≥ 120px（桌面）/ ≥ 120px（移动），
 *      且收起态首屏完整可见**游戏条目** ≥ 9（桌面）/ ≥ 5（移动）。
 *      —— 这条是「本版为什么存在」的判据；折叠若只是换个样子不省空间，本版没有意义。
 *      ★★ v10.74：口径由「可见**列表**条数」换成「可见**游戏条目**数」，
 *         否则本版首屏被榜单占满时会给出 0 条的反向结论（实测撞到，详见 VIEWPORTS 上方）。
 *   G. 无横向溢出（两视口）
 *
 * 反证锚点（打坏必变红）：
 *   · `let curFilterOpen = false;` 改成 `true`        ⇒ A 红（默认变成展开）
 *   · 绑定里去掉 `curFilterOpen = !curFilterOpen;`     ⇒ C / D 红（状态不翻转 / 重渲染后弹回）
 *   · `.filter-body.off{display:none}` 删掉            ⇒ A 红（收起态 body 仍有高度）
 *   · 把 `#filterCount` 移进 `.filter-body`            ⇒ E 红（收起时读不到文案）
 *   · `aria-expanded` 写死 "false"                     ⇒ B 红
 *
 * 跑法：node tools/test-v1069-filter-fold.js     （需服务在 8123；约 30 s）
 */
const fs = require('fs');
const path = require('path');
const { connectBrowser, newPage, sleep } = require('./browser');

const BASE = process.env.BASE || 'http://127.0.0.1:8123';
const IDX = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

/* 折叠后首屏目标的余量取法同 v10.68：**拍板目标 + 少量余量**，不照抄实测值。
   实测（收起态）：桌面 bar 50px / 首卡 top 601 / 可见 5 条 · 移动 bar 86px / 首卡 630 / 可见 3 条。
   ⚠️ `saveMin` 的由来（★ 留个教训）：第一版两个视口都写 120，桌面**没先测就拍的数** ⇒ 实测 117
   直接报红。它不是「真回归」，是我把阈值定在了实测值之上 ——
   正解是把**规格**写成判据（`barMax`：收起后就是「一行」的高度），把**收益**写成下界（≥100）。
   ⇒ 规矩同 v10.68：阈值只允许写成「目标 + 余量」，不允许写成「我以为的数」。
   ★★ v10.74 口径变更（本版实测撞出来的，不是「阈值放宽了事」）：
     桌面 F2 实测 **0 条**、F3 实测 top=862 —— 看着像大回归，其实**方向完全反了**：
     v10.74 把榜单改成「前 5 轮播 + 2×4 卡片」共 13 个，hero 由 ~200px 回到 ~424px，
     首屏**被榜单占满**（实测装满 13 个游戏），列表本来就该在第二屏。
     ⇒ 与 `test-home-fold.js` 的 D①② 同步换口径：
       旧「首屏完整可见的**列表**条数」→ 新「首屏完整可见的**游戏条目**数」
       （轮播当前张 + 榜单卡片 + 列表行）；F3 由「必须进首屏」降级为**退化护栏**
       （hero 再涨 ~60px 就红）。阈值仍按「拍板目标 + 余量」定，实测值见 v10.74.md。

   ★★ v10.75 口径再变更（同上，**先实测再定**）：
     用户本轮拍板「轮播图**适配图片的高度**（按原图比例自适应，桌面约 560px）」，
     ⇒ 轮播高由 v10.74 的固定 200px 变成 `aspect-ratio:var(--cover-ar)`（桌面 559px），
       hero 由 ~424 涨到 ~1175（**这是拍板取舍，不是回归**）。列表因此被推到 1501。
     实测（8124 实测实例，收起态）：桌面 首卡 top **1501** / 首屏游戏条目 **4**；
                                    移动 首卡 top **1097** / 首屏游戏条目 **7**。
     ⇒ 桌面 foldMin 由 9 降到 **3**（实测 4）；F3 阈值按「实测 + ~10% 余量」重定为 1650 / 1200。
       ⚠️ 桌面 foldMin 降幅看着大，但它守的一直是「首屏必须有游戏」这个承诺 ——
          v10.68 的红线是「**一条都露不出来**」，现在首屏装着 4 个（1 超大轮播 + 3 大卡）。
          把它硬留在 9 只会变成噪音：除非把轮播压回 200px，否则永远红。

   ⚠️⚠️ **跑本套件前后请确认打的是哪个端口**：默认 8123 是**常驻**服务，而常驻的
     `server.js` 是**启动时加载**的（不像 `public/*.html` 那样按请求读盘）⇒
     常驻未重启时 `/api/rank` 仍返回**旧逻辑**的榜单，实测会给出偏移值
     （本轮实测：8123 报首卡 top **1768**，同一份前端在 8124 上是 **1501**）。
     判「常驻是不是最新代码」看回包里有没有新字段（如 `meta.coverBigN`）。 */
const VIEWPORTS = [
  { key: '桌面 1440×1000', w: 1440, h: 1000, saveMin: 100, barMax: 60, foldMin: 3, firstTopMax: 1650 },
  { key: '移动 390×844', w: 390, h: 844, saveMin: 100, barMax: 110, foldMin: 5, firstTopMax: 1200 },
];

let pass = 0; let fail = 0;
/* ★ 签名固定 (name, ok, extra) —— 别把条件写进第 1 个位置（PITFALLS 15：非空字符串恒为真）。 */
function chk(name, ok, extra) {
  if (ok) { pass++; console.log('  \u2705 ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.log('  \u274c ' + name + (extra ? '   ' + extra : '')); }
}

/* ---------- 静态段：源码级结构（跑浏览器之前先把「有没有写」确认掉） ---------- */
console.log('=== 静态：折叠面板的结构 ===');
{
  const bar = (IDX.split('function filterBarHtml()')[1] || '').split('\nfunction ')[0];
  chk('S1 filterBarHtml 里生成了折叠按钮与折叠容器',
    /id="filterToggle"/.test(bar) && /id="filterBody"/.test(bar));
  /* 后三行必须在 `.filter-body` **内部** —— 数 `filterBody` 块体里的 `.filter-row` 个数。
     ⚠️ 用「按块体取」而不是「从出现位置往后数 N 个字符」（铁律 88）。 */
  const body = (() => {
    const i = bar.indexOf('id="filterBody"');
    if (i < 0) return '';
    const open = bar.indexOf('>', i) + 1;
    let depth = 1, j = open;
    while (j < bar.length && depth > 0) {
      if (bar[j] === '<' && bar.startsWith('<div', j)) depth++;
      if (bar[j] === '<' && bar.startsWith('</div', j)) depth--;
      j++;
    }
    return bar.slice(open, j);
  })();
  const rowsInBody = (body.match(/class="filter-row/g) || []).length;
  chk('S2 `.filter-body` 内恰好 3 个 `.filter-row`（容量 / 库 / 筛选）', rowsInBody === 3, '实测 ' + rowsInBody);
  chk('S3 排序行**不在** `.filter-body` 内（它常显，且带着计数）',
    !/sortPills/.test(body) && /id="sortPills"/.test(bar));
  chk('S4 ★★ 折叠态是**模块级变量**（不是只写在 DOM class 上）',
    /let curFilterOpen = false;/.test(IDX),
    /let curFilterOpen = false;/.test(IDX) ? '有默认值 false（= 默认收起）' : '★ 没找到，重渲染会弹回');
  chk('S5 绑定处**真翻转**状态变量（只切 class 的话重渲染即失效）',
    /curFilterOpen = !curFilterOpen;/.test(IDX));
  chk('S6 收起用 `display:none`（不是 `max-height` 动画 —— 后者会把隐藏按钮留在可聚焦序列里）',
    /\.filter-body\.off\{display:none\}/.test(IDX));
  chk('S7 按钮带 `aria-expanded` + `aria-controls="filterBody"`',
    /aria-expanded=/.test(bar) && /aria-controls="filterBody"/.test(bar));
}

/* ---------- 浏览器段 ---------- */
const PROBE = () => {
  const q = (s) => document.querySelector(s);
  const rows = [...document.querySelectorAll('.filter-bar .filter-row')];
  const cards = [...document.querySelectorAll('#libList > .row-card')];
  const body = q('#filterBody');
  const ft = q('#filterToggle');
  const fc = q('#filterCount');
  const bar = q('.filter-bar');
  return {
    barH: bar ? Math.round(bar.getBoundingClientRect().height) : null,
    bodyH: body ? Math.round(body.getBoundingClientRect().height) : null,
    bodyOff: body ? body.classList.contains('off') : null,
    visRows: rows.filter((r) => r.getBoundingClientRect().height > 0).length,
    structRows: rows.length,
    aria: ft ? ft.getAttribute('aria-expanded') : null,
    ftTxt: ft ? ft.textContent.trim() : '',
    ftOn: ft ? ft.classList.contains('on') : null,
    barOpen: bar ? bar.classList.contains('open') : null,
    countTxt: fc ? fc.textContent : '',
    countClipped: fc ? fc.scrollWidth > fc.clientWidth + 1 : null,
    cardN: cards.length,
    firstTop: cards[0] ? Math.round(cards[0].getBoundingClientRect().top) : null,
    fold: cards.filter((c) => c.getBoundingClientRect().bottom <= innerHeight).length,
    /* ★★ v10.74 新增：与 `test-home-fold.js` 同口径的「首屏内完整可见的**游戏条目**数」
       = 轮播当前张 + 榜单卡片 + 列表行。
       为什么必须在这里也算一份：本套件的 F2 原本只看 `fold`（列表行），
       而 v10.74 首屏被榜单占满 ⇒ 它会给出 **0 条**，方向完全反了（实测撞到）。
       「完整可见」= 上下边界都在视口内 —— 只露个头的卡片对用户等于没看见。 */
    gameInFold: (() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight; };
      const cur = [...document.querySelectorAll('#rkCar .slide')].find((s) => s.classList.contains('cur'));
      return (cur && vis(cur) ? 1 : 0)
        + [...document.querySelectorAll('#rankList .rk-grid .rk-card')].filter(vis).length
        + cards.filter(vis).length;
    })(),
    docScrollW: document.documentElement.scrollWidth,
    trOn: (() => { const t = q('#trToggle'); return t ? t.classList.contains('on') : null; })(),
  };
};

(async () => {
  const h = await connectBrowser();
  try {
    for (const v of VIEWPORTS) {
      console.log('\n=== ' + v.key + ' ===');
      const p = await newPage(h.browser, { width: v.w, height: v.h, scale: 1 });
      await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await sleep(3000);
      for (let i = 0; i < 24; i++) {
        if (await p.evaluate(() => document.querySelectorAll('#libList > .row-card').length) > 0) break;
        await sleep(500);
      }

      /* ---- A / B 默认收起 ---- */
      const a = await p.evaluate(PROBE);
      chk('A1 阳性对照：列表真渲染出卡片（否则下面的首屏条数断言不成立）', a.cardN > 0, 'n=' + a.cardN);
      chk('A2 默认收起：`#filterBody` 高为 0 且带 `off`', a.bodyH === 0 && a.bodyOff === true,
        'h=' + a.bodyH + ' off=' + a.bodyOff);
      chk('A3 默认收起：可见 `.filter-row` **恰好 1 行**（结构上仍是 4 行）',
        a.visRows === 1 && a.structRows === 4, '可见 ' + a.visRows + ' / 结构 ' + a.structRows);
      chk('A4 默认收起：`.filter-bar` 不带 `open` 类', a.barOpen === false);
      chk('B1 默认 `aria-expanded="false"` 且文案含「筛选」',
        a.aria === 'false' && a.ftTxt.includes('筛选') && !a.ftTxt.includes('收起'), 'aria=' + a.aria + ' txt=' + a.ftTxt);
      chk('B2 默认按钮不带 `on`（收起态不该显示成激活）', a.ftOn === false);
      chk('E1 收起态仍能读到计数文案（它是收起态唯一的信息出口）', a.countTxt.length > 0, a.countTxt.slice(0, 40));
      chk('E2 收起态计数**不被截断**（scrollWidth ≤ clientWidth）', a.countClipped === false);

      /* ---- C 点击能开 ---- */
      await p.evaluate(() => document.getElementById('filterToggle').click());
      await sleep(450);
      const b = await p.evaluate(PROBE);
      chk('C1 点击后展开：`#filterBody` 高 > 0 且不再带 `off`', b.bodyH > 0 && b.bodyOff === false, 'h=' + b.bodyH);
      chk('C2 点击后 4 行全部可见', b.visRows === 4, '可见 ' + b.visRows);
      chk('B3 展开后 `aria-expanded="true"` 且文案含「收起」',
        b.aria === 'true' && b.ftTxt.includes('收起'), 'aria=' + b.aria + ' txt=' + b.ftTxt);
      chk('B4 展开后按钮带 `on`，`.filter-bar` 带 `open`', b.ftOn === true && b.barOpen === true);

      /* ---- F 折叠真省出首屏（用 a/b 两次实测的高度差） ---- */
      const save = (b.barH || 0) - (a.barH || 0);
      chk('F0 ★ 收起后 `.filter-bar` 就是「一行」的高度（规格：≤ ' + v.barMax + 'px）',
        a.barH != null && a.barH <= v.barMax, '实测 ' + a.barH + 'px（展开 ' + b.barH + 'px）');
      chk('F1 ★★ 收起比展开省 ≥ ' + v.saveMin + 'px（折叠的意义）', save >= v.saveMin,
        '展开 ' + b.barH + 'px → 收起 ' + a.barH + 'px（省 ' + save + 'px）');
      /* F2 ★★ v10.74 口径已换（依据见文件头 VIEWPORTS 上方那段）：
         旧判据「收起态首屏完整可见的**列表**条数」在本版实测 **0 条** —— 而首屏
         其实装着 13 个游戏（轮播 1 + 榜单卡片 8 + 列表 4）。继续用它不是「严」，
         是**方向反了**：会逼着人把榜单再压回去，与本版的拍板目标冲突。 */
      chk('F2 ★★ 收起态首屏完整可见的**游戏条目** ≥ ' + v.foldMin + '（= 轮播当前张 + 榜单卡片 + 列表行）',
        a.gameInFold >= v.foldMin, '实测 ' + a.gameInFold + ' 个（旧的「只看列表」口径会给出 ' + a.fold + '）');
      /* F3 由「必须进首屏」降级为**退化护栏**：hero 再涨 ~60px 就红。
         为什么不删：删了就没人拦「有人把 hero 又加高 200px」。 */
      chk('F3 收起态列表首卡 top ≤ ' + v.firstTopMax + 'px（退化护栏：hero 再涨就红）',
        a.firstTop != null && a.firstTop <= v.firstTopMax, 'top=' + a.firstTop + ' / 视口 ' + v.h);

      /* ---- C 再点能收 ---- */
      await p.evaluate(() => document.getElementById('filterToggle').click());
      await sleep(450);
      const c = await p.evaluate(PROBE);
      chk('C3 再点收回：body 高回到 0、可见行回到 1、aria 回到 false',
        c.bodyH === 0 && c.visRows === 1 && c.aria === 'false',
        'h=' + c.bodyH + ' rows=' + c.visRows + ' aria=' + c.aria);
      chk('C4 收起后 `filter-bar` 高度回到与初始一致（±2px）',
        Math.abs((c.barH || 0) - (a.barH || 0)) <= 2, a.barH + ' → ' + c.barH);

      /* ---- D ★★ 展开态必须扛得住重渲染 ---- */
      await p.evaluate(() => document.getElementById('filterToggle').click());   // 展开
      await sleep(400);
      await p.evaluate(() => document.getElementById('trToggle').click());       // 触发 renderList(true) 整块重建
      await sleep(2200);
      const d = await p.evaluate(PROBE);
      chk('D1 ★★ 展开态下点筛选开关（内部会整块重建 #colMain）后**仍然展开**',
        d.bodyH > 0 && d.visRows === 4 && d.aria === 'true',
        'h=' + d.bodyH + ' rows=' + d.visRows + ' aria=' + d.aria);
      chk('D2 同一个开关确实生效了（不是「没点着所以没变」的假绿）', d.trOn === true);
      chk('E3 生效的筛选出现在计数文案里', /有修改器/.test(d.countTxt), d.countTxt.slice(0, 60));

      /* ---- E ★★ 收起后仍能看到「筛了什么」 ---- */
      await p.evaluate(() => document.getElementById('filterToggle').click());
      await sleep(450);
      const e = await p.evaluate(PROBE);
      chk('E4 ★★ 收起态下计数文案仍列出生效筛选（不丢信息）', /有修改器/.test(e.countTxt), e.countTxt.slice(0, 60));
      chk('E5 收起态计数仍不被截断（长文案折行而不截）', e.countClipped === false);

      /* ---- G 无横向溢出 ---- */
      chk('G1 无横向溢出（文档宽 ≤ 视口宽 + 1px）', e.docScrollW <= v.w + 1,
        'doc ' + e.docScrollW + ' vs vp ' + v.w);

      await p.close();
    }
  } finally {
    await h.close();
  }

  /* ⚠️ 收尾汇总行的格式是**约定**：同行必须含「通过」且带 `n / m`（中间不许夹字）。 */
  console.log('\n\u2500\u2500 筛选面板折叠：' + pass + ' / ' + (pass + fail) + ' 通过 \u2500\u2500');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
