/* ★ v10.68 浏览器回归（第二层：真实浏览器 + CDP）：首页首屏几何。
 *
 * 起因：用户说「首页还需优化」，参考 designeer.xyz 后拍板四项 —— 但**改前连一个数字都没有**：
 *   截图里第一屏（1440×1000）**一条游戏都没露出来**。探针实测才拿到根因：
 *     顶栏 61 + hero **570** + 区块头 27 + 分类行 + 筛选面板 167 ⇒ 列表容器 top = **985 / 1000**。
 *   移动 390×844 更夸张：hero **1289** ⇒ 列表 top **1877**（要滚 2.2 屏才见第一条）。
 *
 * 本套件守的就是「首屏那一截」——**它是像素事实，不是审美意见**，所以必须能测、且必须被守：
 *   A. 桌面 hero ≤ 340px（改前 570）· 移动 hero ≤ 420px（改前 1289）
 *   B. 榜首卡 ≤ 145px（改前 174）· hero 榜单收进**一行**（改前 3 列 × 3 行）
 *   C. 行高：桌面 ≤ 86px（改前 112）· 移动 ≤ 76px（改前 105）
 *   D. ★★ 首屏内**完整可见的列表条数**：桌面 ≥ 2（改前 **0**）· 移动 ≥ 1（改前 **0**）
 *   E. ★★ 移动端 `.cat-row` 高 ≤ 60px —— 守 v10.68 修掉的那个**真缺陷**：
 *      `.cat-row{flex-wrap:nowrap}` 挡不住内层 `.statline{flex-wrap:wrap}`（flex item 默认
 *      `flex-shrink:1` ⇒ 被压窄 ⇒ **它自己内部换行**），实测把 `.cat-row` 从 34px 撑到 **181px**。
 *      与 v10.30 的 `.rel-it` 同一类坑，所以两边都得有锚。
 *   F. 秩序语言：`.sec-no` 编号（01/02）真的在 · `.sec-sub` 桌面显示、移动隐藏
 *
 * 反证锚点（打坏必变红）：
 *   · `.rk-grid` 从 `repeat(5,…)` 改回 `repeat(3,…)` ⇒ B 的「同排」红
 *   · `.rk-champ .th` 高度 97 → 128           ⇒ A / B 红
 *   · `.row-card .th` 宽度 96 → 158           ⇒ C / D 红
 *   · 删掉 `.cat-row .statline{flex:none;…}`  ⇒ E 红
 *   · `.rk-grid .rk-card{flex:0 0 74%}` 删掉  ⇒ 移动端横滑断言红
 *
 * ⚠️ 阈值怎么定：**取拍板目标 + 少量余量**，不是「照抄当前实测值」。
 *   照抄实测值 ⇒ 任何人做一次正常微调这里就红，防线变成噪音；取目标值 ⇒ 只有真的退回
 *   「占满一屏」才红。当前实测余量：桌面 hero 275 / 目标 300 / 闸 340。
 *
 * 跑法：node tools/test-home-fold.js     （需服务在 8123；约 25 s）
 */
const path = require('path');
const { connectBrowser, newPage, sleep } = require('./browser');

const BASE = process.env.BASE || 'http://127.0.0.1:8123';

/* 两档视口 = 用户拍板时看的那两屏。别只测桌面：移动端 hero 是桌面的 4.7 倍（1289 vs 570），
   只测桌面会得出「问题不大」的错误结论。
   ★ v10.69 收紧：筛选面板改成**默认折叠**后首屏又前进一截（桌面 3→5 条 / 移动 1→3 条，
   首卡 top 718→601 / 776→630）⇒ 阈值随之上调（foldMin 2→4 / 1→2，firstTopMax 900→800 / 800→750）。
   ★ 为什么必须跟着调：不调的话「折叠被撤掉」在**本套件里看不出来** ——
   它会退回到 3 / 1 条，而 2 / 1 的老阈值照样绿。收紧的余量仍是 1 条（实测 5 / 3）。
   ★★ v10.70 **第二次收紧**（本轮改的是 hero 视觉语言 + 列表行密度，见下方「为什么每轮都要收紧」）：
   实测（node tools/_probe-v1070.js，1440×900 / 390×844）
        hero 197 / 273  榜首卡 60 / 55   行高 58 / 60   首卡 top 523 / 591   可见 6 / 4 条
   改前（v10.69 末）是 hero 275 / 1289 时代留下的老口径，阈值当时定在 340 / 420 ——
   ★ 这意味着 **「hero 退回 275px 深蓝大块」在本套件里是绿的**（275 ≤ 340），
     而那正是用户在 v10.70 明确否掉的形态。所以阈值必须跟着实测往下压：
     桌面 heroMax 340→**240**（275 > 240 ⇒ 真回退立刻红）、rowMax 86→**64**（74 > 64 ⇒ 拦得住）、
     champMax 145→**80**（123 > 80 ⇒ 拦得住）。
   ⚠️ 余量的取法仍是「拍板目标 + 余量」，不是照抄实测：桌面 hero 实测 197 / 闸 240（余量 43），
     移动 273 / 闸 320（余量 47）；行高实测 58 / 闸 64（余量 6，够吃掉 1px 边框与字体替换的漂移）。 */
const VIEWPORTS = [
  { key: '桌面 1440×1000', w: 1440, h: 1000, heroMax: 240, champMax: 80, rowMax: 64, foldMin: 5, firstTopMax: 600 },
  /* ★★ v10.70 新增第三档「平板 820×900」—— 守的是**断点区间**而不是第三个尺寸：
     本页的响应式分档是 `≤760`（紧凑）/ `761~1060`（单列但走桌面语言）/ `>1060`（两栏）。
     v10.70 修掉的那条横向溢出**只存在于中间那档**：`≤760` 有 `#colMain{min-width:0}` 兜着，
     `>1060` 的 `.grid2` 写的是 `minmax(0,1fr)`（min=0），
     只有 `761~1060` 写成了 `1fr`（min=auto=min-content）⇒ 被内容撑宽。
     ⇒ 再加一个 1440 或 390 的视口**永远测不到它**；必须钉住这个**区间**里的一个点。
       （同类教训见 v10.68 的 `.live-tag`：761~845 那段也是「两头都不管」。） */
  /* 平板档的阈值**按本档实测单独定**（不许照搬桌面档 —— 820 的 hero 比 1440 高 37px：
     内容在窄一点的宽度里换行。实测 hero **234** / 首卡 top **603** / 行高 58 / 可见 **5** 条。
     ⇒ 阈值：heroMax 260（余量 26；仍 < 275 ⇒ 拦得住「退回深蓝大块」）、
        firstTopMax 620（余量 17；仍拦得住 v10.68 时代的 718）、foldMin 4（余量 1）。
     ⚠️ 第一版我按桌面档照抄了 heroMax 240 / firstTopMax 600 / foldMin 5，
        结果 hero 余量只剩 6px、首卡 top 直接报红（603 > 600）、foldMin 余量 0 ——
        典型的「阈值写成我以为的数」。**每加一档都要先量再定**。 */
  { key: '平板 820×900', w: 820, h: 900, heroMax: 260, champMax: 80, rowMax: 64, foldMin: 4, firstTopMax: 620 },
  { key: '移动 390×844', w: 390, h: 844, heroMax: 320, champMax: 70, rowMax: 66, foldMin: 3, firstTopMax: 660 },
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
  const cards = [...document.querySelectorAll('#libList > .row-card')];
  const rows = cards.map((e) => R(e));
  const seps = [...document.querySelectorAll('#libList > .date-sep')];
  const rankCards = [...document.querySelectorAll('#rankList .rk-grid .rk-card')];
  const grid = document.querySelector('#rankList .rk-grid');
  const stat = document.querySelector('.cat-row .statline');
  const catRow = document.querySelector('.cat-row');
  const cs = (el) => (el ? getComputedStyle(el) : null);
  return {
    vh: innerHeight,
    stage: R(document.getElementById('rankStage')),
    champ: R(document.querySelector('#rankList .rk-champ')),
    cardTops: rankCards.map((c) => Math.round(c.getBoundingClientRect().top)),
    cardN: rankCards.length,
    gridDisp: grid ? cs(grid).display : null,
    gridOverflowX: grid ? cs(grid).overflowX : null,
    cardFlexBasis: rankCards[0] ? cs(rankCards[0]).flexBasis : null,
    rows,
    rowN: rows.length,
    sepN: seps.length,
    firstTop: rows[0] ? rows[0].top : null,
    rowH: rows[0] ? rows[0].h : null,
    foldRows: rows.filter((r) => r.bottom <= innerHeight).length,
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
      chk('A  ② 榜首卡高 ≤ ' + v.champMax + 'px', r.champ && r.champ.h <= v.champMax,
        '实测 ' + (r.champ ? r.champ.h : '—') + 'px');

      /* B hero 榜单收进一行 —— 判据用「所有卡 offsetTop 极差」，不用列数：
         grid-template-columns 是写法，实测落点才是效果（改行高/字号也可能把它挤下去）。 */
      chk('B  ① hero 榜单卡数在 1–5 之间（截断生效，不再堆 3 行）', r.cardN >= 1 && r.cardN <= 5,
        'n=' + r.cardN + ' tops=' + r.cardTops.join(','));
      const spread = r.cardTops.length ? Math.max(...r.cardTops) - Math.min(...r.cardTops) : 999;
      chk('B  ② ★★ hero 榜单卡**同排**（offsetTop 极差 ≤ 2px）', r.cardN > 0 && spread <= 2,
        '极差 ' + spread + 'px');

      /* C 行密度 */
      chk('C  ① 列表行高 ≤ ' + v.rowMax + 'px', r.rowH != null && r.rowH <= v.rowMax, '实测 ' + r.rowH + 'px');
      /* C ② 取样合理性（不是设计规格）：行高 ≥ 40px。若这里报 ~20px，说明取样又取到了
         `.date-sep` 分隔行 —— 那种情况下 C①/D①/D② 会**同时全绿但全错**，
         所以必须有这条独立的、能把「取错样本」单独照出来的断言。 */
      chk('C  ② 取样合理性：行高 ≥ 40px（≈20px 就是取到 .date-sep 了）', r.rowH != null && r.rowH >= 40,
        '实测 ' + r.rowH + 'px');

      /* D 首屏 —— 本套件存在的理由 */
      chk('D  ① 列表首条 top ≤ ' + v.firstTopMax + 'px（进第一屏）', r.firstTop != null && r.firstTop <= v.firstTopMax,
        '实测 ' + r.firstTop + 'px / 视口 ' + r.vh);
      chk('D  ② ★★ 首屏内**完整可见**的列表条数 ≥ ' + v.foldMin + '（改前恒为 0）', r.foldRows >= v.foldMin,
        '实测 ' + r.foldRows + ' 条');

      /* E 移动端分类行 —— 守 v10.68 修掉的真缺陷（`.statline` 内部换行把行撑高） */
      if (v.w <= 760) {
        chk('E  ① ★★ 移动端 .cat-row 高 ≤ 60px（改前被 .statline 换行撑到 181px）',
          r.catRowH != null && r.catRowH <= 60, '实测 ' + r.catRowH + 'px');
        chk('E  ② 移动端 .cat-row .statline 保持**单行**（高 ≤ 24px）', r.statH != null && r.statH <= 24,
          '实测 ' + r.statH + 'px');
        /* 负向：移动端 hero 榜单必须是**横滑**，不是换行堆叠 —— 否则 5 张卡又变成 3 行高 */
        chk('E  ③ 移动端 hero 榜单是横滑行（display:flex + overflow-x:auto）',
          r.gridDisp === 'flex' && r.gridOverflowX === 'auto', 'display=' + r.gridDisp + ' overflowX=' + r.gridOverflowX);
        chk('E  ④ 移动端 hero 榜单卡宽度收窄（flex-basis 不是 100%）',
          r.cardFlexBasis != null && r.cardFlexBasis !== 'auto' && r.cardFlexBasis !== '100%',
          'flex-basis=' + r.cardFlexBasis);
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
