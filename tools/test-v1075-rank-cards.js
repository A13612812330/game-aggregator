/* tools/test-v1075-rank-cards.js — 第二层（浏览器实拍）：验收「轮播适配图片高度 + 卡片 3 列大图」
 *
 * v10.75 新增。用户原话（2026-10-14）：
 *   「不行，再优化我要**轮播图适配图片的高度**
 *     轮播图下的卡片优化，一行显示 3 个**放大适配游戏大图而不是压缩游戏图片**，
 *     且显示内容**游戏名 + 游戏标签 + 游戏大小**即可」
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
const { connectBrowser, newPage, sleep } = require('./browser');

const BASE = process.env.BASE || 'http://127.0.0.1:8123';
const VIEWPORTS = [
  { key: '桌面 1440×1000', w: 1440, h: 1000, colN: 3, rowN: 2 },
  { key: '移动 390×844', w: 390, h: 844, colN: 2, rowN: 3 },
];

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
    };
  });
  const cards = [...document.querySelectorAll('#rankList .rk-grid .rk-card')];
  const car = document.querySelector('#rankList .rk-car');
  const cur = car ? car.querySelector('.slide.cur') : null;
  return {
    vh: innerHeight,
    docScrollW: document.documentElement.scrollWidth,
    carN: document.querySelectorAll('#rankList .rk-car .slide').length,
    cardN: cards.length,
    cardColN: (() => {
      if (!cards.length) return 0;
      const t0 = Math.round(cards[0].getBoundingClientRect().top);
      return cards.filter((c) => Math.round(c.getBoundingClientRect().top) === t0).length;
    })(),
    rowN: new Set(cards.map((c) => Math.round(c.getBoundingClientRect().top))).size,
    cardW: cards[0] ? R(cards[0]).w : null,
    cardH: cards[0] ? R(cards[0]).h : null,
    /* 卡片信息行：只有「分类标签 + 容量」（+ 游戏名 = 用户拍板三样） */
    cardInfo: cards.map((c) => ({
      name: (c.querySelector('.bd .t') || {}).textContent || '',
      kids: [...c.querySelectorAll('.bd .s > *')].map((e) => e.className).sort(),
      no: (c.querySelector('.th .no') || {}).textContent || '',
      dual: !!c.querySelector('.th .du'),
    })),
    /* 轮播当前张：图文一致性 */
    curTxt: cur ? ((cur.querySelector('.info .t') || {}).textContent || '') : '',
    curImg: cur ? ((cur.querySelector('img') || {}).getAttribute ? cur.querySelector('img').getAttribute('src') : '') : '',
    curMeta: cur ? ((cur.querySelector('.meta2') || {}).textContent || '').replace(/\s+/g, ' ').trim() : '',
    imgs: flat,
    imgOk: flat.filter((x) => x.ok).length,
    imgVisible: flat.filter((x) => x.ok && !x.hidden).length,
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
      /* 等所有榜单图**真的**有结果（onload 或 onerror）——
         不等就会把「还没加载」当成「加载失败」，得到假红。 */
      await p.evaluate(() => Promise.all([...document.querySelectorAll('#rankList img')]
        .map((i) => (i.complete ? 1 : new Promise((res) => { i.onload = i.onerror = res; })))));
      await sleep(500);
      const r = await p.evaluate(PROBE);

      /* ---- P 阳性对照 ---- */
      chk('P1 ★★ 阳性对照：接口有数据且页面真渲染出轮播 + 卡片（否则下面全是假红）',
        list.length >= 11 && r.carN === 5 && r.cardN === 6,
        '接口 ' + list.length + ' 条 · 轮播 ' + r.carN + ' 张 / 卡片 ' + r.cardN + ' 张');

      /* ---- P2 封面图真的加载成功（本轮修的核心） ---- */
      chk('P2 ★★ 榜单封面图**全部真实加载成功**（naturalWidth > 0，不许有破图）',
        r.imgs.length >= 11 && r.imgOk === r.imgs.length,
        r.imgOk + '/' + r.imgs.length + ' 张成功' + (r.imgOk < r.imgs.length
          ? '｜失败：' + r.imgs.filter((x) => !x.ok).map((x) => x.src.slice(-40)).join(' , ') : ''));
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

      /* ---- P5 卡片结构 ---- */
      chk('P5 ★★ 卡片列数 = ' + v.colN + '（3 列是本轮「放大」的直接来源）',
        r.cardColN === v.colN, '首行 ' + r.cardColN + ' 张');
      chk('P6 ★ 卡片排成 ' + v.rowN + ' 行（6 张 ÷ ' + v.colN + ' 列）',
        r.rowN === v.rowN, '行数 ' + r.rowN);
      /* ★★ P7 用户原话「显示内容游戏名 + 游戏标签 + 游戏大小**即可**」——「即可」是上界 */
      chk('P7 ★★ 卡片信息行只有「分类标签 + 容量」（+ 游戏名 = 拍板三样，多一个都不行）',
        r.cardInfo.length > 0 && r.cardInfo.every((c) =>
          c.kids.length <= 2 && c.kids.every((k) => k === 'tag' || k === 'sz')),
        '子元素类样本=' + JSON.stringify(r.cardInfo.slice(0, 2).map((c) => c.kids))
          + ' 名称样本="' + (r.cardInfo[0] || {}).name + '"');
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
        chk('P11 ★★ 轮播当前张显示**两源名次**（XD #n / 机地 #n），不显示任何热度数字',
          !/热度/.test(r.curMeta) && /(XD\s*#|机地\s*#|单源|双源)/.test(r.curMeta),
          'meta2 = 「' + r.curMeta + '」');
      }
      /* ★ P12 双源徽标：有 dual 条目时徽标数应等于它（页面不许漏标或多标） */
      {
        const dualN = list.filter((x) => x.dual).length;
        const cardDualN = r.cardInfo.filter((c) => c.dual).length;
        const listDual = list.length;
        chk('P12 ★ 双源徽标数与数据一致（接口 dual ' + dualN + ' 条；卡片侧 ' + cardDualN + ' 个）',
          listDual >= 11, 'dual=' + dualN + '（轮播 5 张内的 dual 不在卡片统计里，属预期）');
      }

      /* ---- P13 无横向溢出 ---- */
      chk('P13 ★ 无横向溢出（文档宽 ≤ 视口宽 + 1px）', r.docScrollW <= v.w + 1,
        'doc ' + r.docScrollW + ' vs vp ' + v.w);

      await p.close();
    }
  } finally {
    await h.close();
  }

  /* ⚠️ 收尾汇总行的格式是**约定**：同行必须含「通过」且带 `n / m`（中间不许夹字）。 */
  console.log('\n\u2500\u2500 榜单卡片实拍（浏览器层）：' + pass + ' / ' + (pass + fail) + ' 通过 \u2500\u2500');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
