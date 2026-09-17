#!/usr/bin/env node
/* ============================================================================
 * 搜索弹窗 + 详情抽屉 UI 回归（浏览器实测）—— v10.7 新增，第七道防线
 * ----------------------------------------------------------------------------
 * 为什么单独存在：
 *   ① 「分组按相关性排序」是**动态**逻辑 —— 静态体检只能看到源码里有排序语句，
 *      证明不了「搜游戏本名时端游库真的排到了第一」，更证明不了「端游库没命中时
 *      没有乱提权」。必须真搜一遍看渲染结果。
 *   ② 「行高收紧 / 隐形占位」全是布局量 —— jsdom 算不出行高与留白（同 test-filter-layout
 *      踩过的坑）。
 *   ③ 抽屉宽度是 clamp(680px,50vw,1040px)，三档视口要各量一次，不能只测一个分辨率。
 *
 * 用法：
 *   1) 先在项目根目录起服务：node server.js（端口 8123）
 *   2) node tools/test-search-ui.js
 * 依赖：edge（msedge.exe）+ puppeteer-core（devDependencies）
 * ========================================================================== */
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://127.0.0.1:8123/';
/* ★ v10.15：浏览器获取交给 tools/browser.js —— Edge 在本机沙箱会话里启动即被拦，
   那里会自动改用「外部拉起 Chrome + 连 CDP 端口」。 */
const { launchBrowser, findBrowser } = require('./browser');
const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/microsoft-edge',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];

const R = [];
const t = (cond, name, extra) => R.push([!!cond, name, extra]);

function loadPuppeteer() {
  try { return require(path.join(__dirname, '..', 'node_modules', 'puppeteer-core')); }
  catch (e) { try { return require('puppeteer-core'); } catch (e2) { return null; } }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 正例：端游库有「本名精确/近似命中」→ 必须排第一 */
const POS = ['剑星', '艾尔登法环', '只狼', 'GTA', '赛博朋克', '星露谷'];
/* 负例：端游库**零命中**（其余库有命中）→ 必须保持默认顺序，不允许提权 */
const NEG = ['以撒的结合 重生', '蔚蓝Celeste'];
const DEFAULT_ORDER = ['📱', '🛠', '💾', '🖥️'];

(async () => {
  const puppeteer = loadPuppeteer();
  if (!puppeteer) { console.error('缺少 puppeteer-core'); process.exit(1); }
  const EDGE = findBrowser();
  if (!EDGE) { console.error('未找到可用的 Chromium 内核浏览器'); process.exit(1); }

  const b = await launchBrowser();
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await p.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await p.waitForSelector('#smBody', { timeout: 20000 });
  await sleep(900);

  /* 在页面里跑一次搜索并返回分组图标序列 */
  const orderOf = (q) => p.evaluate(async (qq) => {
    document.getElementById('searchInput').value = qq;
    await window.doSearch();
    return [...document.querySelectorAll('#smBody .sm-sec')]
      .map((x) => (x.textContent.trim().match(/^\S+/) || [''])[0]);
  }, q);

  /* ——— ① 分组按相关性排序：正例 ——— */
  for (const q of POS) {
    const o = await orderOf(q);
    t(o[0] === '🖥️', `[排序] 搜「${q}」端游库排第一`, `实际 ${o.join(' → ')}`);
    t(o.length === 4, `[排序] 搜「${q}」四组齐全`, `实际 ${o.length} 组`);
    t(new Set(o).size === o.length, `[排序] 搜「${q}」无重复分组`, o.join(' → '));
  }

  /* ——— ② 分组按相关性排序：负例（端游库无本名命中，不得被提权） ——— */
  for (const q of NEG) {
    const o = await orderOf(q);
    t(o[0] === '📱', `[排序] 搜「${q}」端游库零命中 → 保持默认顺序（手游中心第一）`, `实际 ${o.join(' → ')}`);
    t(o.join('') === DEFAULT_ORDER.join(''), `[排序] 搜「${q}」完整顺序 = 默认`, `实际 ${o.join(' → ')}`);
  }

  /* ——— ③ 行密度 ——— */
  await orderOf('赛博朋克');
  await sleep(700);
  const dens = await p.evaluate(() => {
    const body = document.getElementById('smBody');
    const box = body.getBoundingClientRect();
    const rows = [...document.querySelectorAll('#smBody .sm-row')];
    const hs = rows.map((r) => Math.round(r.getBoundingClientRect().height));
    const byH = {};
    for (const h of hs) byH[h] = (byH[h] || 0) + 1;
    /* 「常见行高」＝出现次数最多的那档（云存档行多一行路径，天生高一些，不参与） */
    const common = +Object.entries(byH).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    let visible = 0;
    for (const r of rows) if (r.getBoundingClientRect().bottom <= box.bottom + 1) visible++;
    const el = document.querySelector('#smBody .sm-row .t');
    const en = document.querySelector('#smBody .sm-row .en');
    const pill = document.querySelector('#smBody .sm-row .m .pill');
    const lh = (e) => (e ? parseFloat(getComputedStyle(e).lineHeight) : -1);
    return { byH, common, maxH: Math.max(...hs), rows: rows.length, visible,
      tLH: lh(el), enLH: lh(en), pillH: pill ? Math.round(pill.getBoundingClientRect().height) : -1 };
  });
  t(dens.common <= 70, `[行密度] 常见行高 ≤ 70px`, `实际 ${dens.common}px（分布 ${JSON.stringify(dens.byH)}）`);
  t(dens.maxH <= 85, `[行密度] 最高行高 ≤ 85px（云存档行多一行路径）`, `实际 ${dens.maxH}px（改前 103px）`);
  t(dens.visible >= 8, `[行密度] 「赛博朋克」首屏完整可见 ≥ 8 行`, `实际 ${dens.visible} 行（改前 6 行）`);
  t(dens.tLH > 0 && dens.tLH <= 19, `[行密度] 标题行距 ≤ 19px（全局 1.6 时为 22.4px）`, `实际 ${dens.tLH}px`);
  t(dens.enLH > 0 && dens.enLH <= 15, `[行密度] 英文名行距 ≤ 15px（改前 17.6px）`, `实际 ${dens.enLH}px`);
  t(dens.pillH > 0 && dens.pillH <= 18, `[行密度] 标签胶囊高度 ≤ 18px（改前 19.6px）`, `实际 ${dens.pillH}px`);

  /* ——— ④ 隐形占位已消除 ——— */
  await orderOf('剑星');
  await sleep(700);
  const go2 = await p.evaluate(async () => {
    const r = document.querySelector('#smBody .sm-row');
    const w0 = r.getBoundingClientRect().width;
    const bd0 = r.querySelector('.bd').getBoundingClientRect().width;
    const g = r.querySelector('.go2');
    const badge = r.querySelector('.src-badge');
    const gs = getComputedStyle(g);
    const gap = Math.round(r.getBoundingClientRect().right - badge.getBoundingClientRect().right);
    const badgeW = Math.round(badge.getBoundingClientRect().width);
    r.classList.add('on');
    await new Promise((z) => setTimeout(z, 260));
    const gR = g.getBoundingClientRect(), bR = badge.getBoundingClientRect();
    const covers = gR.left <= bR.left + 1 && gR.right >= bR.right - 1;
    const res = {
      pos: gs.position, pe: gs.pointerEvents, gap, badgeW, covers,
      w0, w1: r.getBoundingClientRect().width,
      bd0, bd1: r.querySelector('.bd').getBoundingClientRect().width,
    };
    r.classList.remove('on');
    return res;
  });
  t(go2.pos === 'absolute', `[占位] 「查看详情」已改为绝对定位（不再占流内宽度）`, `position=${go2.pos}`);
  t(go2.pe === 'none', `[占位] 「查看详情」不吞点击（pointer-events:none）`, `pointer-events=${go2.pe}`);
  t(go2.gap <= 14, `[占位] 来源徽标贴右边缘（留白 ≤ 14px）`, `实际 ${go2.gap}px（徽标宽 ${go2.badgeW}px；改前约 79px）`);
  t(Math.abs(go2.w1 - go2.w0) < 0.6, `[占位] hover 前后行宽逐像素不变（无回流）`, `${go2.w0} → ${go2.w1}`);
  t(Math.abs(go2.bd1 - go2.bd0) < 0.6, `[占位] hover 前后文字区宽度不变`, `${go2.bd0.toFixed(1)} → ${go2.bd1.toFixed(1)}`);
  t(go2.covers, `[占位] 「查看详情」浮出时完整盖住来源徽标，不出现叠字`, `覆盖=${go2.covers}`);

  /* ——— ⑤ 详情抽屉宽度：三档视口 ——— */
  const drawerW = async (w) => {
    await p.setViewport({ width: w, height: 900, deviceScaleFactor: 1 });
    await sleep(320);
    return p.evaluate(() => Math.round(document.getElementById('drawer').getBoundingClientRect().width));
  };
  for (const [w, expect, why] of [[1100, 680, '50vw=550 < 下限 → 取下限'], [1440, 720, '50vw=720 落在区间内'], [1920, 960, '50vw=960 落在区间内'], [375, 375, '移动端 100vw']]) {
    const got = await drawerW(w);
    t(Math.abs(got - expect) <= 6, `[抽屉] ${w}px 视口下宽 ≈ ${expect}px`, `实际 ${got}px（${why}）`);
  }

  /* ——— ⑥ 抽屉栅格（注入式，不依赖源站网络） ——— */
  const gridAt = async (w) => {
    await p.setViewport({ width: w, height: 900, deviceScaleFactor: 1 });
    await sleep(320);
    return p.evaluate(() => {
      const body = document.getElementById('drawerBody');
      const host = document.createElement('div');
      host.innerHTML = '<div class="kv">' + '<div class="it"><div class="k">k</div><div class="v">v</div></div>'.repeat(5) + '</div>'
        + '<div class="shots">' + '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="">'.repeat(5) + '</div>';
      body.appendChild(host);
      const kv = host.querySelector('.kv'), sh = host.querySelector('.shots');
      const n = (el) => getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length;
      const res = { kv: n(kv), shots: n(sh), kvPx: Math.round(kv.querySelector('.it').getBoundingClientRect().width) };
      host.remove();
      return res;
    });
  };
  const g1440 = await gridAt(1440);
  t(g1440.kv === 3, `[抽屉] 桌面 KV 三列`, `实际 ${g1440.kv} 列，单列宽 ${g1440.kvPx}px`);
  t(g1440.kvPx >= 190, `[抽屉] 桌面 KV 单列宽 ≥ 190px（不被压窄）`, `实际 ${g1440.kvPx}px`);
  t(g1440.shots === 3, `[抽屉] 桌面游戏预览三列`, `实际 ${g1440.shots} 列`);
  const g375 = await gridAt(375);
  t(g375.kv === 1, `[抽屉] 移动端 KV 回退单列`, `实际 ${g375.kv} 列`);
  t(g375.shots === 2, `[抽屉] 移动端游戏预览回退两列`, `实际 ${g375.shots} 列`);

  /* ——— ⑦ 窄视口不横向溢出 ——— */
  await p.setViewport({ width: 820, height: 900, deviceScaleFactor: 1 });
  await sleep(320);
  const ov = await p.evaluate(() => ({ doc: document.documentElement.scrollWidth, vw: window.innerWidth }));
  t(ov.doc <= ov.vw + 1, `[抽屉] 820px 视口无横向溢出（抽屉 680 < 100vw）`, `${ov.doc} ≤ ${ov.vw}`);

  await b.close();

  const fail = R.filter((r) => !r[0]);
  console.log('\n' + '='.repeat(72));
  for (const [c, n, e] of R) console.log(`${c ? '  PASS' : '× FAIL'}  ${n}${e ? '\n           [' + e + ']' : ''}`);
  console.log('='.repeat(72));
  console.log(`搜索弹窗 + 详情抽屉 UI 回归：${R.length - fail.length} / ${R.length} 通过`);
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error('运行失败：', e.message); process.exit(1); });
