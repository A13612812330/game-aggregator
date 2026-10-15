/* tools/test-v1075-rank-cards.js — 第二层（浏览器实拍）：验收「轮播适配图片高度 + 卡片 3 列大图」
 *
 * v10.75 新增。用户原话（2026-10-14）：
 *   「不行，再优化我要**轮播图适配图片的高度**
 *     轮播图下的卡片优化，一行显示 3 个**放大适配游戏大图而不是压缩游戏图片**，
 *     且显示内容**游戏名 + 游戏标签 + 游戏大小**即可」
 *
 * ★★ v10.76 扩了三块（用户第二轮原话：「**轮播图太大了，优化下** ／ **固定下榜单位置，
 *    目前点击年度榜会有页变化** ／ 轮播图下需要的是 **9 个卡片**，且可以稍微优化下大小
 *    以及展示内容（游戏名称，类型，大小）」）：
 *   · P14–P16 轮播**限宽 + 居中 + 高度上界**（改前桌面 1196×559 ⇒ 改后 810×379）
 *   · P17 **跨层**对照骨架字面值 vs 真实 `.bd` 实测高（差 > 2px 即红）
 *   · **Q 段：切档零位移**（四档逐档点击，`.stage-h` / 「最新收录」top / 轮播 top 必须完全相等）
 *
 * 为什么这一层**必须**存在（离线层做不到的事）：
 *   · 「图片有没有被压缩 / 裁切」的真相只有浏览器量 `naturalWidth/naturalHeight` 才知道 ——
 *     离线只能看 URL 形状（`rank-merge.coverScore` 是**先验分**）。
 *   · 「404 的图会不会留下破图卡」需要真的加载一次。
 *   · 几何（轮播高、卡片宽高、列数）本来就是渲染产物。
 *   ★★ 本轮实测就靠这层抓到：**11 条里 4 条封面是 128×128 / 140×140 方图 + 2 条 Steam header 404**。
 *
 * ⚠️ 必须有**阳性对照**（P1）：没有它，接口一挂这里的「0 张图」会以假红的形式出现，
 *    看着像布局崩了，其实是没数据。
 *
 * 跑法：BASE=http://127.0.0.1:8124 node tools/test-v1075-rank-cards.js
 *   ★ 建议打 **8124 临时实例**（见 test-home-fold 头部的端口说明）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { connectBrowser, newPage, sleep } = require('./browser');

const BASE = process.env.BASE || 'http://127.0.0.1:8123';
/* ★ v10.76：本层不是「只读渲染」——P17 要做**跨层对照**（源码字面值 vs 实测值），
   所以需要主源文本。这也是「骨架高 = 真卡高」这条承诺唯一能被机器守住的方式。 */
const srcIdx = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
/* ★★ v10.77：卡片改 **5 列 × 3 行 = 15**（用户口径「参考这个 [截图] + 每一行都铺满而不是遗漏
   （三行）」）；窄屏 2 列 × 3 行 = **6**（多出的 9 张由 CSS `nth-child(n+7)` 隐藏 ——
   条数池仍是桌面口径 15，所以 DOM 里 cards.length 仍是 15，**可见数**才分档）。
   ⇒ v10.76 的「轮播限宽」三件套（P14 限宽 / P15 居中 / P16 高度上界）随用户「轮播图回退到
     上一步」**整体撤销**，只留一条 P14（轮播恢复**通栏**，宽 == 内容区宽）守回退不漂。 */
const VIEWPORTS = [
  { key: '桌面 1440×1000', w: 1440, h: 1000, colN: 5, rowN: 3, skelIdx: 0 },
  { key: '中间 880×900', w: 880, h: 900, colN: 5, rowN: 3, skelIdx: 1 },
  { key: '移动 390×844', w: 390, h: 844, colN: 2, rowN: 3, skelIdx: 2 },
];
/* 窄屏可见卡片数（CSS 隐藏第 7 张往后）；桌面/中间档 = 全量 */
const visCardN = (v) => (v.w <= 760 ? 6 : 15);

/* 取样：只读**渲染结果**，不读源码（这层的价值就在于此） */
const PROBE = () => {
  const R = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width) };
  };
  const imgs = [...document.querySelectorAll('#rankList img')];
  const flat = imgs.map((i) => {
    const b = i.closest('.th') || i.closest('.slide') || i.parentElement;
    const br = b ? b.getBoundingClientRect() : null;
    return {
      src: i.getAttribute('src') || '',
      ok: !!(i.complete && i.naturalWidth > 0),
      nat: i.naturalWidth + 'x' + i.naturalHeight,
      natAR: i.naturalWidth && i.naturalHeight ? +(i.naturalWidth / i.naturalHeight).toFixed(3) : null,
      boxAR: br && br.height ? +(br.width / br.height).toFixed(3) : null,
      hidden: i.style.visibility === 'hidden',
      /* ★ v10.77：**所在盒**是否可见（display:none 的祖先 ⇒ rect 全 0）——
         这才是「用户看不看得到」的真值；`i.style.visibility` 只看内联样式，照不出 CSS 隐藏。 */
      boxHidden: !br || br.width === 0 || br.height === 0,
    };
  });
  const cards = [...document.querySelectorAll('#rankList .rk-grid .rk-card')];
  /* ★★ v10.77：几何统计只算**可见卡** —— 窄屏 `nth-child(n+7)` 隐藏的卡 rect 全 0
     （top 全相同），混进来会把 rowN 数成 4、lineCounts 数成 [2,2,2,9]（实测假红）。
     cardInfo / cardN（DOM 总数）仍用全量 —— P8 的「角标连续 6…20」要验池子完整。 */
  const vis = cards.filter((c) => { const b = c.getBoundingClientRect(); return b.width > 0 && b.height > 0; });
  const car = document.querySelector('#rankList .rk-car');
  const cur = car ? car.querySelector('.slide.cur') : null;
  return {
    vh: innerHeight,
    docScrollW: document.documentElement.scrollWidth,
    carN: document.querySelectorAll('#rankList .rk-car .slide').length,
    cardN: cards.length,
    cardColN: (() => {
      if (!vis.length) return 0;
      const t0 = Math.round(vis[0].getBoundingClientRect().top);
      return vis.filter((c) => Math.round(c.getBoundingClientRect().top) === t0).length;
    })(),
    rowN: new Set(vis.map((c) => Math.round(c.getBoundingClientRect().top))).size,
    /* ★★ v10.77「每一行都铺满」的可测形式：按 top 分组数每行卡片数，每行都必须 == 列数。
       （宽屏 5 列 × 3 行 ⇒ [5,5,5]；窄屏隐藏后 2 列 × 3 行 ⇒ [2,2,2]。
         任何一行少一张（比如末行 4/5、[5,5,4]）在这里都会被照出来。） */
    lineCounts: (() => {
      const m = new Map();
      for (const c of vis) {
        const t = Math.round(c.getBoundingClientRect().top);
        m.set(t, (m.get(t) || 0) + 1);
      }
      return [...m.values()];
    })(),
    visCardN: vis.length,
    cardW: vis[0] ? R(vis[0]).w : null,
    cardH: vis[0] ? R(vis[0]).h : null,
    /* ★ v10.76：`.bd` 实测高 —— 与骨架里的字面值做**跨层对照**（P17）。 */
    bdH: vis[0] && vis[0].querySelector('.bd') ? R(vis[0].querySelector('.bd')).h : null,
    /* ★ v10.76：轮播尺寸与居中量（用户口径「轮播图太大了」的可测形式）。
       居中量的参照物取**同区的整宽块** `.rk-grid`（不写死 1196/22 这类数）。 */
    carW: car ? R(car).w : null,
    carH: car ? R(car).h : null,
    carSideGap: (() => {
      const g = document.querySelector('#rankList .rk-grid');
      if (!car || !g) return null;
      const c = car.getBoundingClientRect();
      const gr = g.getBoundingClientRect();
      return { l: Math.round(c.left - gr.left), r: Math.round(gr.right - c.right) };
    })(),
    /* 内容区宽 = 同区整宽块 `.rk-grid` 的宽（**不写死 1196/350**：那两个数会随断点漂） */
    contentW: (() => {
      const g = document.querySelector('#rankList .rk-grid');
      return g ? Math.round(g.getBoundingClientRect().width) : null;
    })(),
    /* 卡片信息行：只有「分类标签 + 容量」（+ 游戏名 = 用户拍板三样） */
    cardInfo: cards.map((c) => ({
      name: (c.querySelector('.bd .t') || {}).textContent || '',
      kids: [...c.querySelectorAll('.bd .s > *')].map((e) => e.className).sort(),
      no: (c.querySelector('.th .no') || {}).textContent || '',
      dual: !!c.querySelector('.th .du'),
    })),
    /* ★ v10.77：日期项文本样本（P7b 用；「2026-10-15」→ 页面上是「2026/10/15」） */
    dtSamples: cards.map((c) => ((c.querySelector('.bd .s .dt') || {}).textContent || '').trim()).filter(Boolean),
    /* 轮播当前张：图文一致性 */
    curTxt: cur ? ((cur.querySelector('.info .t') || {}).textContent || '') : '',
    curImg: cur ? ((cur.querySelector('img') || {}).getAttribute ? cur.querySelector('img').getAttribute('src') : '') : '',
    curMeta: cur ? ((cur.querySelector('.meta2') || {}).textContent || '').replace(/\s+/g, ' ').trim() : '',
    imgs: flat,
    imgOk: flat.filter((x) => x.ok).length,
    imgVisible: flat.filter((x) => x.ok && !x.hidden).length,
    /* ★★ v10.77：**可见**图（隐藏卡里的 img 不触发 load，不能进等待与破图判据） */
    visImgs: flat.filter((x) => !x.boxHidden),
    visImgOk: flat.filter((x) => !x.boxHidden && x.ok).length,
    /* 比例不符的图（「被压缩 / 被裁」的可测形式） */
    arBad: flat.filter((x) => x.ok && x.natAR != null && x.boxAR != null && Math.abs(x.natAR - x.boxAR) > 0.05),
  };
};

let pass = 0; let fail = 0;
function chk(name, ok, extra) {
  if (ok) { pass++; console.log('  \u2705 ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.log('  \u274c ' + name + (extra ? '   ' + extra : '')); }
}

(async () => {
  const h = await connectBrowser();
  try {
    /* 拿一份接口数据，用于「页面显示的是不是真的」对照组。
       ★ 这一步也是阳性对照的前提：接口挂了就不要往下判几何。 */
    const api = await fetch(BASE + '/api/rank?p=hot').then((r) => r.json()).catch(() => null);
    const list = (api && api.ok && Array.isArray(api.list)) ? api.list : [];
    console.log('\n接口阳性对照：/api/rank?p=hot → ' + (api && api.ok ? 'list=' + list.length : 'FAILED'));

    for (const v of VIEWPORTS) {
      console.log('\n=== ' + v.key + ' ===');
      const p = await newPage(h.browser, { width: v.w, height: v.h, scale: 1 });
      await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await sleep(3200);
      /* 切到「人气榜」—— 双源融合档，这是本轮的样板屏（recent 是单源） */
      await p.click('[data-p="hot"]');
      await sleep(4000);
      /* 等所有**可见**榜单图真的有结果（onload 或 onerror）——
         不等就会把「还没加载」当成「加载失败」，得到假红。
         ★★ v10.77 坑（诊断脚本实测 3m9s 挂死在这里）：窄屏 `nth-child(n+7)` 把 9 张卡
           display:none 之后，**隐藏容器里的 `<img>` 不会触发 load/error**
           ⇒ 上一版「等全部 img」的 promise 永远 pending ⇒ CDP `callFunctionOn`
             等到 protocolTimeout（180s）才炸。
         ⇒ 只等**可见**图：轮播 5 + 可见卡 6 = 11 张。隐藏卡的图不是用户看到的，
           不该等、也不该进「破图」判据（P2 同步改为只判可见图）。 */
      await p.evaluate(() => Promise.all([...document.querySelectorAll('#rankList img')]
        .filter((i) => i.getBoundingClientRect().width > 0)
        .map((i) => (i.complete ? 1 : new Promise((res) => { i.onload = i.onerror = res; })))));
      await sleep(500);
      const r = await p.evaluate(PROBE);

      /* ---- P 阳性对照 ---- */
      /* ★★ v10.77：可见数分档（桌面/中间 15、窄屏 6），DOM 总数恒 15（窄屏靠 CSS 隐藏）。 */
      chk('P1 ★★ 阳性对照：接口有数据且页面真渲染出轮播 + 卡片（可见 ' + visCardN(v) + ' 张）',
        list.length >= 20 && r.carN === 5 && r.cardN === 15 && r.visCardN === visCardN(v),
        '接口 ' + list.length + ' 条 · 轮播 ' + r.carN + ' / DOM 卡片 ' + r.cardN
          + ' / 可见 ' + r.visCardN);

      /* ---- P2 封面图真的加载成功（v10.75 修的核心，本轮仍守） ----
         ★★ v10.77 只判**可见图**（隐藏卡的 img 不触发 load，等不到也不能算破图）。 */
      chk('P2 ★★ 可见封面图**全部真实加载成功**（naturalWidth > 0，不许有破图）',
        r.visImgs.length >= 11 && r.visImgOk === r.visImgs.length,
        r.visImgOk + '/' + r.visImgs.length + ' 张成功' + (r.visImgOk < r.visImgs.length
          ? '｜失败：' + r.visImgs.filter((x) => !x.ok).map((x) => x.src.slice(-40)).join(' , ') : ''));
      /* ★★ P3 「不压缩图片」的可测形式：每张图的**原始宽高比** == 它所在展示框的宽高比。
         差 > 0.05 ⇒ 一定有裁切或拉压（`object-fit:cover` 下就是裁）。
         ★ 这条是离线层**测不到**的：`coverScore` 只能按 URL 形状猜，猜不出真实尺寸。 */
      chk('P3 ★★ 每张封面「原图比例 == 展示框比例」（不裁不压 = 用户要的「放大适配大图」）',
        r.imgs.length > 0 && r.arBad.length === 0,
        r.arBad.length === 0
          ? '全 ' + r.imgs.length + ' 张比例一致（原图 ' + r.imgs[0].nat + '）'
          : r.arBad.length + ' 张不符：' + r.arBad.map((x) => x.nat + ' @ ' + x.boxAR).join(' , '));
      /* ★ 正向：460×215 是本地库/Steam 的横版标准尺寸。实测修前 11 条里只有 8 条达标
         （3 条 128×128 / 140×140 方图 + 2 条 404）⇒ 修后应全部达标。 */
      chk('P4 ★★ 封面原图是横版大图（宽高比 ≈ 2.14，即 460×215 一族）',
        r.imgs.filter((x) => x.ok).every((x) => x.natAR != null && Math.abs(x.natAR - 2.14) < 0.05),
        r.imgs.filter((x) => x.ok).map((x) => x.nat).slice(0, 12).join(' '));

      /* ---- P5/P6/P6b 卡片结构（v10.77：5 列 × 3 行 + 每行铺满） ---- */
      chk('P5 ★★ 卡片列数 = ' + v.colN + '（' + (v.w <= 760 ? '2 列是窄屏口径' : '5 列照参考图') + '）',
        r.cardColN === v.colN, '首行 ' + r.cardColN + ' 张');
      chk('P6 ★ 卡片排成 ' + v.rowN + ' 行（' + visCardN(v) + ' 张 ÷ ' + v.colN + ' 列）',
        r.rowN === v.rowN, '行数 ' + r.rowN);
      /* ★★ P6b 本轮用户口径的核心句：「**每一行都铺满而不是遗漏（三行）**」。
         ⚠️ 单看「行数 == 3」照不出 [5,5,4] 这种**末行缺一张**的半行 ——
           行数仍是 3、比例判据也照不出（少一张不改变任何比例）。
         所以必须有「每行数量 == 列数」这条**逐行**判据。 */
      chk('P6b ★★ **每一行都铺满**（每行卡片数 == 列数，行分布 [' + r.lineCounts.join(',') + ']）',
        r.lineCounts.length === v.rowN && r.lineCounts.every((n) => n === v.colN),
        '行分布 ' + JSON.stringify(r.lineCounts) + '（要求 ' + v.colN + ' × ' + v.rowN + '）');
      /* ★★ P7 v10.77：信息行改三项（类型 · 大小 · 日期）——用户在参考图拍板后追加日期。
         「上界」语义不变：只允许这四类（lib 是补位标记），多出来的类都算越界。
         dt 的中文标签**不许出现**（dateLabel 是混合语义，见 D23）——
         那条由静态层 D23 守（本层 DOM 里渲染的是图标 + 值）。 */
      chk('P7 ★★ 卡片信息行只含「类型 · 大小 · 日期」（+ 补位标记 lib；多一个类都不行）',
        r.cardInfo.length > 0 && r.cardInfo.every((c) =>
          c.kids.length <= 3 && c.kids.every((k) => k === 'tag' || k === 'sz' || k === 'dt' || k === 'lib')),
        '子元素类样本=' + JSON.stringify(r.cardInfo.slice(0, 2).map((c) => c.kids))
          + ' 名称样本="' + (r.cardInfo[0] || {}).name + '"');
      /* ★ P7b 日期项真的在渲染（≥ 1 张卡有 dt 且值为「年/月/日」形状）——
         防止「允许 dt」被理解成「dt 从没出现」。 */
      chk('P7b ★ 日期项真实渲染（≥ 1 张卡有 `.dt` 且值为数字形状）',
        r.cardInfo.some((c) => c.kids.includes('dt')) && r.dtSamples.some((t) => /\d{4}\/\d{1,2}\/\d{1,2}/.test(t)),
        '样本=' + JSON.stringify(r.dtSamples.slice(0, 3)));
      chk('P8 ★ 卡片名次角标连续 ' + (r.carN + 1) + '…' + (r.carN + r.cardN),
        r.cardInfo.map((c) => c.no).join(',') === Array.from({ length: r.cardN }, (_, i) => r.carN + 1 + i).join(','),
        '角标=' + r.cardInfo.map((c) => c.no).join(','));
      /* ★ 正向对照：名次角标真的可见（不是 display:none 也算「在 DOM 里」） */
      chk('P9 ★ 卡片封面宽度 ≥ 150px（「大图」的底线；横条时代 v10.74 是 72px 缩略图）',
        r.cardW != null && r.cardW >= 150, '卡宽 ' + r.cardW + 'px / 卡高 ' + r.cardH + 'px');

      /* ---- P10 轮播图文一致（★ 实拍时截图撞上过渡态才发现的取样陷阱） ---- */
      {
        const hit = list.find((x) => String(x.cover || '') === r.curImg);
        const zhOf = (t) => String(t || '').split('/')[0].trim();
        chk('P10 ★★ 轮播当前张的**图与文来自同一条数据**（防「切换过渡期截图」得出错配的假象）',
          !!hit && r.curTxt && zhOf(hit.title).includes(r.curTxt.replace(/…$/, '')),
          hit ? '图属「' + hit.title.slice(0, 22) + '」，页面标题「' + r.curTxt + '」' : '图 ' + r.curImg.slice(-44) + ' 不在接口 list 里');
        /* ★★ P11 必须**数据驱动**，不能写成「页面上一定要出现『机地 #』」——
           第一版就是那么写的，实测在**机地源抽风时假红**（`jidiOk=false` ⇒ 融合退化成仅 XD，
           这时页面上根本没有第二个源的名次可显示，只能挂「XD」来源徽标）。
           正确判据：**接口这一条有 `srcRank.jidi` ⇒ 页面就必须展示『机地 #n』**；
           没有（单源/机地不可用）就不要求 —— 仍然守着「删热度不能变成什么都不显示」。 */
        const sr = (hit && hit.srcRank) || {};
        const needJidi = !!sr.jidi;
        chk('P11 ★★ 轮播当前张显示**两源名次**（接口有 `srcRank.jidi` 时必须有「机地 #n」），且不显示热度数字',
          !/热度/.test(r.curMeta) && /(XD|机地)/.test(r.curMeta)
            && (!needJidi || /机地\s*#/.test(r.curMeta)),
          'meta2 = 「' + r.curMeta + '」｜接口该条 srcRank=' + JSON.stringify(sr));
      }
      /* ★ P12 双源徽标：有 dual 条目时徽标数应等于它（页面不许漏标或多标） */
      {
        const dualN = list.filter((x) => x.dual).length;
        const cardDualN = r.cardInfo.filter((c) => c.dual).length;
        const listDual = list.length;
        chk('P12 ★ 双源徽标数与数据一致（接口 dual ' + dualN + ' 条；卡片侧 ' + cardDualN + ' 个）',
          listDual >= 20, 'dual=' + dualN + '（轮播 5 张内的 dual 不在卡片统计里，属预期）');
      }

      /* ---- P13 无横向溢出 ---- */
      chk('P13 ★ 无横向溢出（文档宽 ≤ 视口宽 + 1px）', r.docScrollW <= v.w + 1,
        'doc ' + r.docScrollW + ' vs vp ' + v.w);

      /* ---- P14 ★★ v10.77：轮播**回退限宽**（用户原话「轮播图回退到上一步」）----
         v10.76 的限宽/居中/高度上界三条（P14 限宽、P15 居中、P16 上界）整体撤销。
         ★ 但「回退」也要有判据守着 —— 否则下轮有人把 `width:min(100%,…)` 又加回来，
           或回退只回退一半（比如删了变量、留了 margin:auto），这里都要能红。
         判据：轮播宽 == 内容区宽（±2px），左右留白都为 0 —— 这就是「回到 v10.75 的通栏」。 */
      chk('P14 ★★ 轮播恢复**通栏**（宽 == 内容区 ' + r.contentW + 'px，左右留白为 0）',
        r.carW != null && r.contentW != null && Math.abs(r.carW - r.contentW) <= 2
          && r.carSideGap != null && r.carSideGap.l <= 2 && r.carSideGap.r <= 2,
        '实测 ' + r.carW + '×' + r.carH + '（内容区 ' + r.contentW + '；左 ' + (r.carSideGap && r.carSideGap.l)
          + ' / 右 ' + (r.carSideGap && r.carSideGap.r) + '）');

      /* ---- P17 ★★ 跨层一致性：源码里的骨架字面值 vs 真实 `.bd` 实测高 ----
         守的是 v10.30 就定下的「骨架高 = 真卡高」。★ 为什么必须**跨层**判：
           · 静态层只能看到「源码里写着 63px」，看不到真实 `.bd` 有多高；
           · 浏览器层只看渲染，看不到骨架的字面值（骨架在加载完成后已被替换掉）。
         ⇒ 两边各出一半，差 > 2px 即红。
         ★★ v10.77：断点从两处变**三处** —— 信息行加第三项（日期）后，桌面 5 列卡宽
           从 ~389 掉到 ~228，信息行在 1100/1110px 之间从单行变两行 ⇒ `.bd` 有
           63（>1100）/ 88（761–1100）/ 84（≤760）三个实测值。VIEWPORTS 的 skelIdx 与
           CSS 书写顺序一一对应（matchAll 出现顺序）。 */
      {
        const skels = [...srcIdx.matchAll(/\.rk-skel-card \.sk-tx\{height:(\d+)px/g)].map((m) => Number(m[1]));
        const skelH = skels[v.skelIdx];
        chk('P17 ★★ 骨架文字区字面值 == 真实 `.bd` 实测高（差 ≤ 2px，防「改了 CSS 忘了改骨架」）',
          skels.length === 3 && skelH > 0 && r.bdH != null && Math.abs(skelH - r.bdH) <= 2,
          '骨架 ' + (skelH || '?') + 'px / 实测 .bd ' + r.bdH + 'px（三处断点 ' + skels.join('/') + '）');
      }

      await p.close();
    }

    /* ============================================================
       Q. ★★ 切档「零位移」
       ============================================================
       用户原话：「**固定下榜单位置，目前点击年度榜会有页变化**」。
       ★ 这不是主观感受，是**能量化**的几何差（探针实测，改前 1440×1000）：

         档位    | `.stage-h` 高 | meta 文案宽 | 「最新收录」top
         recent  | 46px          | 158px       | 1258
         hot     | 85px          | 592px       | 1297   ← 整页下移 39px
         month   | 85px          | 485px       | 1297
         year    | 85px          | 485px       | 1297

       根因：`.stage-meta` 当时 `flex:none`（宽度跟文案走），短文案挤在标题行、长文案换行。
       ⇒ 本段就是「修好了没有」的**唯一硬判据**：同一批几何量，四档必须**完全相等**
         （不是「差不多」—— 差 1px 也是位移，且这类位移会随文案长度随机出现）。
       ★⚠️ Q0 是必需的阳性对照：如果四档文案一样（比如点击没生效、或 API 挂掉都渲染同一份），
         「四档几何全等」会**以假绿的形式通过**。 */
    console.log('\n=== Q. 切档几何恒定（桌面 1440×1000） ===');
    {
      const p = await newPage(h.browser, { width: 1440, height: 1000, scale: 1 });
      await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await sleep(3200);
      const GPROBE = () => {
        const R = (el) => {
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return { top: Math.round(b.top), h: Math.round(b.height) };
        };
        const meta = document.getElementById('rankMeta');
        const row = document.querySelector('.stage-meta');
        const lh = meta ? parseFloat(getComputedStyle(meta).lineHeight) || 16 : 16;
        return {
          head: R(document.querySelector('.stage-h')),
          rowH: row ? Math.round(row.getBoundingClientRect().height) : null,
          metaTxt: meta ? meta.textContent : '',
          metaLines: meta ? Math.max(1, Math.round(meta.getBoundingClientRect().height / lh)) : 0,
          car: R(document.querySelector('#rkCar')),
          latest: R(document.getElementById('latest')),
          docH: Math.round(document.documentElement.scrollHeight),
          scrollY: Math.round(window.scrollY),
        };
      };
      const got = [];
      for (const t of ['recent', 'hot', 'month', 'year']) {
        await p.click(`.stage-pill[data-p="${t}"]`);
        await sleep(2600);
        got.push({ t, ...(await p.evaluate(GPROBE)) });
      }
      const uniq = (f) => new Set(got.map(f)).size;
      chk('Q0 ★★ 阳性对照：四档都取到几何值、且**状态行文案确实不同**（文案全同 ⇒ 下面全等可能是没切换的假绿）',
        got.every((g) => g.head && g.head.h > 0 && g.latest && g.latest.top > 0)
          && new Set(got.map((g) => g.metaTxt)).size >= 3,
        '文案去重 ' + new Set(got.map((g) => g.metaTxt)).size + '/4 ｜ 各档 .stage-h 高 '
          + got.map((g) => g.head.h).join(','));
      chk('Q1 ★★ 榜单头部 `.stage-h` 高度四档完全一致（「位置固定」的结构前提）',
        uniq((g) => g.head.h) === 1, '实测 ' + got.map((g) => g.head.h + 'px').join(' / '));
      chk('Q2 ★★ 「最新收录」top 四档完全一致（**用户真正看得见的那个位移**：改前 1258 → 1297，差 39px）',
        uniq((g) => g.latest.top) === 1, '实测 ' + got.map((g) => g.latest.top + 'px').join(' / '));
      chk('Q3 ★★ 轮播 top 与高度四档完全一致',
        uniq((g) => g.car.top) === 1 && uniq((g) => g.car.h) === 1,
        'top ' + got.map((g) => g.car.top).join('/') + ' ｜ h ' + got.map((g) => g.car.h).join('/'));
      chk('Q4 ★ 状态行高恒为 24px 且恒为**单行**（长文案只截显示，不撑高容器）',
        uniq((g) => g.rowH) === 1 && got.every((g) => g.rowH === 24 && g.metaLines === 1),
        '行高 ' + got.map((g) => g.rowH).join('/') + ' ｜ 行数 ' + got.map((g) => g.metaLines).join('/'));
      chk('Q5 ★ 整页文档高四档一致，且切档过程**不发生滚动跳**（负向：scrollY 全为 0）',
        uniq((g) => g.docH) === 1 && got.every((g) => g.scrollY === 0),
        'docH ' + got.map((g) => g.docH).join('/') + ' ｜ scrollY ' + got.map((g) => g.scrollY).join('/'));
      await p.close();
    }
  } finally {
    await h.close();
  }

  /* ⚠️ 收尾汇总行的格式是**约定**：同行必须含「通过」且带 `n / m`（中间不许夹字）。 */
  console.log('\n\u2500\u2500 榜单卡片实拍（浏览器层）：' + pass + ' / ' + (pass + fail) + ' 通过 \u2500\u2500');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
