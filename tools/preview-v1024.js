/* tools/preview-v1024.js — v10.24 浏览器实拍：三处卡片是否「同款」
 *
 * 用户口径：「机型兼容 + 解包专区 **筛选后的游戏** 要同端游/手游专区的前端展示一样
 *           （图片 + 游戏名的卡片样式）」。
 *
 * 所以判据不是「类名在不在」，而是**量出来的**：
 *   ① 机型兼容 24 张首屏卡里有多少张真加载出图（`naturalWidth > 0`，PITFALLS 45）
 *   ② 三处的卡片**正文骨架**是否同构（`.cov` / `.bd>h4` / `.meta` / `.tgs`）
 *   ③ 三处的卡片**高度**是否在同一量级（v10.22 解包卡 352px vs 手机专区 232px，一眼就不同款）
 *   ④ 档位徽标**真的上了色**（v10.24 前的真 bug：`pill ok`/`pill mid` 这些类名在共享 CSS 里
 *      根本不存在 ⇒ 流畅/可玩/勉强全是灰底，和旁边的普通 pill 长得一样）
 *
 * 用法：先起服务（8123），再 `node tools/preview-v1024.js`
 * 产出：`_preview/1024-{1emu,2dm,3unpack}.png`
 */
const fs = require('fs');
const path = require('path');
const { connectBrowser, newPage, sleep } = require('./browser');

const BASE = process.env.BASE || 'http://127.0.0.1:8123';
const OUT = path.join(__dirname, '..', '_preview');
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const ok = (cond, name, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name + (detail ? '  — ' + detail : '')); }
  else { fail++; console.log('  × FAIL  ' + name + (detail ? '  — ' + detail : '')); }
};

/** 页面内：量一个网格的卡片骨架 + 图片加载 + 高度 */
/* ★ 端到端验「图 404 时的兜底」：把某张卡的 img.src 换成不存在的地址，
   等 onerror 跑完，再量封面位是否**仍然占着 92px**。
   这段兜底（`covErr`）光靠静态断言是守不住的 —— 必须真让浏览器报一次 error。
   ⚠️ 本段也是反引号模板，注释里不能出现反引号。 */
const BROKEN = `(async () => {
  const grid = document.getElementById('dmGrid');
  if (!grid) return { err: 'no dmGrid' };
  const card = [...grid.querySelectorAll('.emu-card')].find((c) => c.querySelector('.cov img'));
  if (!card) return { err: 'no card with img' };
  const box = card.querySelector('.cov');
  const before = Math.round(box.getBoundingClientRect().height);
  box.querySelector('img').src = '/__definitely_missing_cover__.png';
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (box.querySelector('span')) break;
  }
  return {
    before,
    after: Math.round(box.getBoundingClientRect().height),
    ph: box.classList.contains('ph'),
    abbr: (box.querySelector('span') || {}).textContent || '',
    cardH: Math.round(card.getBoundingClientRect().height),
  };
})()`;

/** 页面内：量一个网格的卡片骨架 + 图片加载 + 高度 */
const MEASURE = `(async (id, limit) => {
  const grid = document.getElementById(id);
  if (!grid) return { err: 'no grid ' + id };
  const cards = [...grid.querySelectorAll('.emu-card')].slice(0, limit || 24);
  /* 先驱动懒加载：滚到卡上再 decode（元素存在 ≠ 图片加载成功） */
  for (const c of cards) {
    const img = c.querySelector('.cov img');
    if (img && !img.complete) { c.scrollIntoView({ block: 'center' }); try { await img.decode(); } catch (e) {} }
  }
  await new Promise((r) => setTimeout(r, 1500));
  const hs = cards.map((c) => Math.round(c.getBoundingClientRect().height)).filter((h) => h > 0);
  const imgs = cards.map((c) => c.querySelector('.cov img')).filter(Boolean);
  const vpill = cards.map((c) => c.querySelector('.meta .pill')).filter(Boolean);
  const first = vpill[0];
  const cs = first ? getComputedStyle(first) : null;
  /* ★ 逐卡登记 top / 高 / 是不是占位块：
     网格用了 align-items:stretch，**同一行**的卡必然等高，行与行之间会因标题折行而差 20px。
     所以「全屏等高」是**错误的预期**（手机专区基线自己就是 216~232）。
     真正要守的是：① 同一行内高度一致；② 用占位块的那几张**不比同行的低**
     （低了就说明封面位没撑住 = 顶部塌了一块）。
     ⚠️ 本段在反引号模板里，注释中不能出现反引号（会提前闭合模板，见 PITFALLS 第 48 条）。 */
  const perCard = cards.map((c) => ({
    name: (c.querySelector('h4') || {}).textContent || '',
    top: Math.round(c.getBoundingClientRect().top + window.scrollY),
    h: Math.round(c.getBoundingClientRect().height),
    ph: !!c.querySelector('.cov.ph'),
  }));
  return {
    id, total: grid.querySelectorAll('.emu-card').length, sampled: cards.length,
    heights: hs, minH: hs.length ? Math.min(...hs) : 0, maxH: hs.length ? Math.max(...hs) : 0,
    avgH: hs.length ? Math.round(hs.reduce((a, b) => a + b, 0) / hs.length) : 0,
    hasCover: cards.filter((c) => c.classList.contains('has-cov')).length,
    phCount: cards.filter((c) => c.querySelector('.cov.ph')).length,
    imgs: imgs.length,
    loaded: imgs.filter((i) => i.naturalWidth > 0).length,
    perCard,
    skel: {
      cov: cards.filter((c) => c.querySelector('.cov')).length,
      bd: cards.filter((c) => c.querySelector('.bd')).length,
      h4: cards.filter((c) => c.querySelector('.bd > h4')).length,
      meta: cards.filter((c) => c.querySelector('.bd > .meta')).length,
      tgs: cards.filter((c) => c.querySelector('.bd > .tgs')).length,
    },
    verdictPill: cs ? { text: first.textContent.trim(), color: cs.color, bg: cs.backgroundColor } : null,
    sample: cards[0] ? cards[0].outerHTML.replace(/\\s+/g, ' ').slice(0, 420) : '',
  };
})('ID', LIMIT)`;

async function shot(page, name) {
  const p = path.join(OUT, name);
  await page.screenshot({ path: p });
  return p;
}

async function run(browser, cfg) {
  const page = await newPage(browser, { width: 1440, height: 1150 });
  const out = { note: cfg.note };
  try {
    await page.goto(BASE + cfg.url, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(cfg.wait || 2500);
    if (cfg.prep) await cfg.prep(page);
    out.data = await page.evaluate(MEASURE.replace('ID', cfg.grid).replace('LIMIT', String(cfg.limit || 24)));
    out.shot = await shot(page, cfg.name);
    if (cfg.extra) out.extra = await page.evaluate(cfg.extra);   /* 截图之后再搞破坏 */
  } catch (e) { out.error = e.message.slice(0, 200); }
  await page.close();
  return out;
}

(async () => {
  const h = await connectBrowser();
  const R = {};

  /* ① 手机专区 = 基线 */
  R.emu = await run(h.browser, {
    note: '① 手游专区（基线）', url: '/emulator.html#emu', grid: 'emuGrid', name: '1024-1emu.png',
  });

  /* ② 机型兼容：填机型 → 查询 */
  R.dm = await run(h.browser, {
    note: '② 机型兼容（本次改动）', url: '/emulator.html#dm', grid: 'dmGrid', name: '1024-2dm.png',
    prep: async (p) => {
      await p.evaluate(() => {
        const i = document.getElementById('dmInput');
        i.value = 'Xiaomi 2412DPC0AG';
        i.dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('dmGo').click();
      });
      for (let i = 0; i < 30; i++) {
        await sleep(700);
        if (await p.evaluate(() => document.querySelectorAll('#dmGrid .emu-card').length > 0)) break;
      }
      await sleep(1200);
      await p.evaluate(() => document.getElementById('dmResultSec').scrollIntoView({ block: 'start' }));
      await sleep(500);
    },
    extra: BROKEN,
  });

  /* ③ 解包专区：载入示例 → 开始匹配 */
  R.up = await run(h.browser, {
    note: '③ 解包专区（本次改动）', url: '/unpack.html', grid: 'upList', name: '1024-3unpack.png',
    prep: async (p) => {
      await p.evaluate(() => document.getElementById('upSample').click());
      await sleep(400);
      await p.evaluate(() => document.getElementById('upRun').click());
      for (let i = 0; i < 40; i++) {
        await sleep(700);
        if (await p.evaluate(() => document.querySelectorAll('#upList .emu-card').length > 0)) break;
      }
      await sleep(1200);
      await p.evaluate(() => document.getElementById('upList').scrollIntoView({ block: 'start' }));
      await sleep(500);
    },
  });

  await h.close();

  for (const k of ['emu', 'dm', 'up']) {
    const r = R[k];
    console.log('\n===== ' + r.note + (r.error ? '（错误：' + r.error + '）' : '') + ' =====');
    if (!r.data || r.data.err) { console.log('  × 量不到：' + (r.data ? r.data.err : '无数据')); fail++; continue; }
    const d = r.data;
    console.log('  卡片 ' + d.total + ' 张（取样 ' + d.sampled + '）｜高 ' + d.minH + '~' + d.maxH + '（均 ' + d.avgH + '）'
      + '｜has-cov ' + d.hasCover + '｜图 ' + d.loaded + '/' + d.imgs + ' 张真加载');
    console.log('  骨架 cov/bd/h4/meta/tgs = ' + [d.skel.cov, d.skel.bd, d.skel.h4, d.skel.meta, d.skel.tgs].join('/') + '（取样数 ' + d.sampled + '）');
    console.log('  档位 pill：' + JSON.stringify(d.verdictPill));
    console.log('  截图 ' + r.shot);
  }

  console.log('\n===== 断言 =====');
  const emu = R.emu.data, dm = R.dm.data, up = R.up.data;

  ok(!!emu && emu.total > 0, '手机专区有卡片（基线可用）', emu && emu.total + ' 张');
  ok(!!emu && emu.loaded === emu.sampled, '★ 基线：取样卡片**全部**真加载出图', emu && emu.loaded + '/' + emu.sampled);

  /* —— 机型兼容 —— */
  ok(!!dm && dm.total > 0, '机型兼容查询有结果', dm && dm.total + ' 张');
  ok(dm && dm.loaded >= 18, '★ 机型兼容首屏至少 18 张真加载出图（改前是 0）', dm && dm.loaded + '/' + dm.sampled);
  ok(dm && dm.skel.bd === dm.sampled && dm.skel.h4 === dm.sampled && dm.skel.meta === dm.sampled && dm.skel.tgs === dm.sampled,
    '★ 机型兼容每张卡都有 .bd > h4 + .meta + .tgs（与手机专区同构）',
    dm && [dm.skel.bd, dm.skel.h4, dm.skel.meta, dm.skel.tgs].join('/') + ' / ' + dm.sampled);
  ok(dm && Math.abs(dm.maxH - emu.maxH) <= 40,
    '★ 机型兼容卡高与手机专区同量级（差 ≤40px；差的那 20 来 px 是机型卡没有「别名行」）',
    dm && dm.maxH + ' vs ' + emu.maxH);
  ok(dm && (dm.maxH - dm.minH) <= (emu.maxH - emu.minH) + 30,
    '★ 机型兼容卡高的**屏内跨度**不超基线（行间差只该来自标题折行）',
    dm && (dm.maxH - dm.minH) + 'px vs 基线 ' + (emu.maxH - emu.minH) + 'px');
  /* 同一行内必须等高（`align-items:stretch` 保证），且占位块那几张不能比同行矮
     —— 矮了就说明封面位没撑住，顶部塌了一块（这正是用户抱怨的「很空」） */
  const rowCheck = (d) => {
    if (!d || !d.perCard) return { rows: 0, maxSpread: -1, phShort: -1, ph: 0 };
    const byRow = new Map();
    for (const c of d.perCard) {
      const k = c.top;
      if (!byRow.has(k)) byRow.set(k, []);
      byRow.get(k).push(c);
    }
    let maxSpread = 0, phShort = 0, ph = 0;
    for (const arr of byRow.values()) {
      const hh = arr.map((x) => x.h);
      maxSpread = Math.max(maxSpread, Math.max(...hh) - Math.min(...hh));
      const mx = Math.max(...hh);
      for (const x of arr) if (x.ph) { ph++; if (x.h < mx - 4) phShort++; }
    }
    return { rows: byRow.size, maxSpread, phShort, ph };
  };
  const rc = rowCheck(dm);
  ok(rc.rows > 0 && rc.maxSpread <= 4,
    '★ 机型兼容**同一行**内的卡片等高（行内差 ≤4px）',
    '行数 ' + rc.rows + '｜行内最大差 ' + rc.maxSpread + 'px');
  ok(rc.phShort === 0,
    '★ 用占位块（无封面）的那几张**不比同行矮**（矮了 = 封面位没撑住，顶部塌一块）',
    '占位块 ' + rc.ph + ' 张，矮的 ' + rc.phShort + ' 张');
  ok(dm && dm.skel.cov === dm.sampled,
    '★ 每张卡都有封面位（有图用图、无图用 .cov.ph 同尺寸占位块，**不是**收起留白）',
    dm && dm.skel.cov + '/' + dm.sampled + '（占位 ' + dm.phCount + ' 张）');
  ok(dm && dm.verdictPill && dm.verdictPill.bg !== 'rgb(241, 243, 248)',
    '★ 档位徽标**真的上了色**（灰底 rgb(241,243,248) = 类名不存在、静默无样式）',
    dm && JSON.stringify(dm.verdictPill));

  /* —— 解包专区 —— */
  ok(!!up && up.total > 0, '解包匹配有结果', up && up.total + ' 张');
  ok(up && up.skel.bd === up.sampled && up.skel.h4 === up.sampled,
    '★ 解包卡片每张都有 .bd > h4（不再是 .top/.nm）', up && up.skel.bd + '/' + up.sampled);
  ok(up && up.loaded >= Math.round(up.sampled * 0.6),
    '解包首屏大部分图真加载（机地图是懒加载，未滚到的本来就不加载）', up && up.loaded + '/' + up.sampled);
  /* ★ 解包卡天生比手机专区高：它多出「四维判定 / 最低要求 / 下载按钮」三块解包专区独有的信息。
     所以判据不能写「高度接近」—— 那要么过松（写成 `emu.maxH - up.maxH <= 60` 时，
     因为结果是负数，**恒真**，v10.24 第一版就是这么假绿的），要么逼着把功能删掉。
     真正该守的是：① 不再比 v10.22 的 352px 更差；② 多出来的高度确实来自那三块，而不是版式走了回头路。 */
  ok(up && up.maxH <= 352, '★ 解包卡高不再比 v10.22 的 352px 更差', up && up.maxH + ' vs 352');
  ok(up && up.skel.tgs === up.sampled, '★ 解包卡有 .tgs 标签行（手机专区同款）', up && up.skel.tgs + '/' + up.sampled);
  ok(up && up.maxH - emu.maxH <= 120,
    '解包多出来的高度在「三块专属信息」的量级内（≤120px）', up && (up.maxH - emu.maxH) + 'px');

  /* —— 封面图挂掉时的兜底（端到端）—— */
  const bk = R.dm.extra;
  console.log('\n  封面 404 兜底实测：' + JSON.stringify(bk));
  ok(!!bk && !bk.err, '兜底实测跑起来了', bk && (bk.err || 'ok'));
  ok(bk && bk.ph === true && bk.abbr,
    '★ 图 404 时 `.cov` 变成占位块（class 加 ph + 显示缩写），不是 `classList.add(\'noimg\')` 收起',
    bk && 'ph=' + bk.ph + ' 缩写「' + bk.abbr + '」');
  ok(bk && bk.after >= 88 && Math.abs(bk.after - bk.before) <= 2,
    '★ 兜底后封面位**仍然是 92px**（塌了 = 同排其它卡有图、这张少一截 = 用户说的「很空」）',
    bk && bk.before + 'px → ' + bk.after + 'px');

  console.log('\n============================');
  console.log('  实拍通过 ' + pass + '/' + (pass + fail) + '（失败 ' + fail + '）');
  console.log('============================');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('实拍失败：', e.message); process.exit(1); });
