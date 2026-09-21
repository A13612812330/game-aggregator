/* tools/preview-v1014.js — v10.14 浏览器实拍 + 断言
 *
 * 验证四项改动在**真实浏览器 + 真实数据**下的效果：
 *   ① 跨源按钮落点：不再是站点首页 —— 同名收录 → 该游戏详情页；查不到 → 站内搜索页
 *   ② 手机配置「假阴性」修复：机地源的游戏也能铺出机型清单（旧版「暂无记录」）
 *   ③ GPU 脏值清洗：GPU 槽位不再出现 turnip_v* / 驱动 build / 设备码
 *   ④ 机型 → 芯片规格：机型清单里带 SoC + GPU；参数卡有芯片规格行
 *
 * 运行：node tools/preview-v1014.js      （需服务已在 8123 运行）
 * 产出：_preview/v1014-*.png
 */
const fs = require('fs');
const path = require('path');

const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const BASE = process.env.BASE || 'http://127.0.0.1:8123/';
const OUT = path.join(__dirname, '..', '_preview');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { connectBrowser } = require('./browser');

function loadPuppeteer() {
  try { return require(path.join(__dirname, '..', 'node_modules', 'puppeteer-core')); }
  catch (e) { try { return require('puppeteer-core'); } catch (e2) { return null; } }
}

let pass = 0, fail = 0;
function chk(name, ok, extra) {
  (ok ? pass++ : fail++);
  console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`);
}

/* 正向例：两源都有收录（同名 / 只差版本词 —— 生化危机4 是「重置版 ↔ ：重制版」）
 *   机地详情页形如 /topic/detail/<数字id>，XD 详情页形如 /game/<数字id>.html */
const CROSS_POS = [
  { id: 'jidi-2150789868', name: '幻世录 重制版', want: '/game/15924.html' },
  { id: 'xd-5828', name: '生化危机4：重制版', want: '/topic/detail/3281308' },
];
/* 负向例：另一源**没有**收录（已按页面同一套检索词离线核过）→ 必须退到站内搜索页 */
const CROSS_NEG = [
  { id: 'jidi-976417160', name: '极限竞速：地平线 6' },
];
/* 手机配置正例：一份来自 XD 入口、一份来自**机地入口**（后者就是当初显示「暂无记录」的假阴性） */
const MOBILE_POS = [
  { id: 'xd-5828', name: '生化危机4（XD 入口）', minDev: 3 },
  { id: 'jidi-2117239899', name: '渔力全开（机地入口）', minDev: 3 },
];
/* 手机配置空态例：社区库确实没这款 → 应给出「暂无记录」的说明而不是空白 */
const MOBILE_EMPTY = [{ id: 'jidi-2150789868', name: '幻世录 重制版' }];

const ROOTS = ['https://jidiyouxi.com/', 'https://jidiyouxi.com', 'https://www.xdgame.com/', 'https://www.xdgame.com'];
const DIRTY_RX = /turnip|vkpipe|8Elite-\d|ANGLE |兼容模式|GPU驱动|^\d{4}[A-Z0-9]{4,}$/i;

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  /* ★ v10.15：浏览器获取统一交给 tools/browser.js —— Edge 在本机沙箱会话里启动即被拦
     （连 --version 都没输出、退出码还是 0），那里会自动改用
     「外部拉起 Chrome + 连 CDP 端口」这条实测可行的路径。 */
  const H = await connectBrowser();
  const b = H.browser;
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await p.waitForSelector('#drawer', { timeout: 20000 });
  await sleep(800);

  async function openAndSettle(id) {
    await p.evaluate((x) => window.openDetailById(x), id);
    await p.waitForFunction(() => {
      const g = document.getElementById('crossGo');
      const s = document.getElementById('crossSrc');
      if (!g || !s) return false;
      return !/正在检查另一源收录/.test(s.textContent || '');
    }, { timeout: 30000 }).catch(() => {});
    await sleep(2800); // 手机配置区块的二次请求（match + device/specs + params）
  }

  /* 只取「GPU 槽位」这类真正承载 GPU 名的节点，避免把「驱动: turnip_v25」误判成脏值 */
  const snap = () => p.evaluate(() => {
    const g = document.getElementById('crossGo');
    const s = document.getElementById('crossSrc');
    const cntEl = document.querySelector('#bhSlot .d-blk h4 .cnt');
    const slot = document.getElementById('bhDevSlot') || {};
    /* ★ v10.28：`#bhParamSlot` 槽位已并入 `#bhMoreSlot` 的「查看全部」弹窗 ——
       参数卡（`.d-param`）统一在弹窗里渲染，所以这里的全局选择器就是唯一出处。
       （弹窗节点也在 document 里，不必再加 `#dlBody` 前缀。）
       ⚠️ 弹窗**没打开**时这里会是空数组 ⇒ `dirty.length === 0` 恒真 = **假绿**。
          所以取快照前必须先驱动那个入口 —— 见下面的 openMoreSettle()。 */
    const gpuSlots = [...document.querySelectorAll('.d-param .ph .gpu')].map((x) => x.textContent.trim());
    const chipTexts = [...document.querySelectorAll('#bhDevSlot .d-devlist .dv')].map((x) => x.innerText.trim());
    return {
      href: g ? g.getAttribute('href') : '',
      crossHidden: g ? g.hasAttribute('hidden') : null,
      text: g ? (g.textContent || '').trim() : '',
      srcHtml: s ? (s.textContent || '').trim() : '',
      cnt: cntEl ? (cntEl.textContent || '').trim() : '',
      devListHTML: (slot.innerHTML || ''),
      devChips: chipTexts,
      gpuSlots,
      specRows: document.querySelectorAll('.d-param .spec').length,
      bodyText: (document.querySelector('#bhSlot') || {}).innerText || '',
    };
  });

  /** ★ v10.28：参数卡（芯片规格行 / GPU 槽位）已收进 #bhMoreSlot 的「查看全部」弹窗，
   *  详情页默认不再铺开。取这两项数据前必须先点开那个入口 ——
   *  否则 specRows 恒为 0（**假红**）、gpuSlots 恒为空数组（**假绿**：空数组 every() 永远为真）。 */
  async function openMoreSettle(id) {
    await openAndSettle(id);
    await p.evaluate(() => {
      const b = document.querySelector('#bhMoreSlot .d-more-btn');
      if (b) b.click();
    });
    /* 弹窗 load() 要拉 /api/device/specs（分块）+ /api/pc/records + /api/bh/params，给足时间 */
    await sleep(3000);
  }
  async function closeMore() {
    await p.evaluate(() => { try { window.closeDownload(); } catch (e) {} });
    await sleep(500);
  }

  console.log('\n=== ① 跨源按钮落点（不再是站点首页）===');
  for (const c of CROSS_POS) {
    await openAndSettle(c.id);
    const s = await snap();
    chk(`[${c.name}] #crossGo 不是站点首页`, !ROOTS.includes(s.href), s.href);
    chk(`[${c.name}] #crossGo 指向该游戏详情页`, s.href.includes(c.want), s.href);
    chk(`[${c.name}] 按钮文案改为「前往…详情 ↗」`, /前往.+详情/.test(s.text), s.text);
    chk(`[${c.name}] 抽屉内有「另一源也有收录」卡片`, /另一源也有收录/.test(s.srcHtml), '');
    await p.screenshot({ path: path.join(OUT, `v1014-cross-${c.id}.png`) });
  }
  for (const c of CROSS_NEG) {
    await openAndSettle(c.id);
    const s = await snap();
    chk(`[${c.name}] 无同名收录时不是站点首页`, !ROOTS.includes(s.href), s.href || '(无 href)');
    /* ★ v10.15 需求变更：查不到另一源详情页时不再退站内搜索，改为**按钮不显示**。
       这条断言同步改成新口径（旧口径「退到站内搜索页」已作废）。 */
    chk(`[${c.name}] 跨源按钮不显示（无详情页可跳）`, s.crossHidden === true);
    chk(`[${c.name}] 无收录时不渲染「另一源也有收录」`, !/另一源也有收录/.test(s.srcHtml), '');
    await p.screenshot({ path: path.join(OUT, `v1014-cross-${c.id}.png`) });
  }

  console.log('\n=== ② / ③ / ④ 手机配置区块（机型 · 芯片 · 脏值）===');
  for (const c of MOBILE_POS) {
    await openMoreSettle(c.id);        // ★ v10.28：参数卡在弹窗里，必须先驱动那个入口
    const s = await snap();
    const devCnt = Number((s.cnt.match(/(\d+)\s*款机型/) || [])[1] || 0);
    chk(`[${c.name}] 铺出机型清单（不是「暂无记录」）`, devCnt >= c.minDev, `${devCnt} 款机型 · 「${s.cnt}」`);
    chk(`[${c.name}] 机型清单带芯片名（SoC）`,
      /骁龙|天玑|Exynos|Helio|Unisoc|紫光|Snapdragon|Dimensity/i.test(s.devListHTML),
      s.devChips.slice(0, 3).join(' | '));
    chk(`[${c.name}] 参数卡有芯片规格行`, s.specRows > 0, `${s.specRows} 行`);
    /* ★ 先钉「取到了样本」再钉「样本干净」—— 空数组会让下一条的 every/filter 恒真，
       这是本项目最典型的一种假绿（PITFALLS 九）。 */
    chk(`[${c.name}] GPU 槽位取到了样本（空数组会让下一条恒真）`, s.gpuSlots.length > 0, `${s.gpuSlots.length} 个`);
    const dirty = s.gpuSlots.filter((g) => g && DIRTY_RX.test(g));
    chk(`[${c.name}] GPU 槽位无脏值`, dirty.length === 0, dirty.length ? dirty.join(' / ') : s.gpuSlots.join(' / '));
    await p.screenshot({ path: path.join(OUT, `v1014-mobile-${c.id}.png`) });
    await closeMore();                 // 关掉弹窗，避免影响后续循环的快照
  }
  for (const c of MOBILE_EMPTY) {
    await openAndSettle(c.id);
    const s = await snap();
    chk(`[${c.name}] 确实无社区配置 → 显示「暂无记录」而非空白`,
      /暂无记录/.test(s.bodyText) && /还没有这款游戏/.test(s.bodyText), '');
  }

  console.log('\n=== ④b 近似命中标记（≈ 数据通路）===');
  {
    const j = await p.evaluate(async () => {
      const r = await fetch('/api/device/specs?models=' + encodeURIComponent('samsung SM-S928U1,Samsung SM-A065F'));
      return r.json();
    });
    const a = (j.specs || {})['samsung SM-S928U1'] || {};
    const b2 = (j.specs || {})['Samsung SM-A065F'] || {};
    chk('近似命中返回 approx:true（前端加 ≈）', a.approx === true, `${a.soc || '-'} approx=${a.approx}`);
    chk('精确命中 approx:false（前端不加 ≈）', b2.approx === false, `${b2.soc || '-'} approx=${b2.approx}`);
  }

  console.log('\n=== ④c 参数卡 GPU 与机型清单同源（同一套清洗规则）===');
  {
    const j = await p.evaluate(async () => {
      const r = await fetch('/api/bh/params?k=' + encodeURIComponent('Resident_Evil_4') + '&limit=3');
      return r.json();
    });
    const gs = ((j.items || []).map((x) => x.gpu).filter(Boolean));
    chk('参数卡 GPU 已过 cleanGpuOne（无 (TM) 等后缀）',
      gs.every((g) => !/\(TM\)|\(R\)/i.test(g) && !DIRTY_RX.test(g)), gs.join(' / ') || '(无 GPU 值)');
  }

  chk('页面无 JS 报错', errs.length === 0, errs.slice(0, 2).join(' | '));

  await H.close();          // spawned 时顺手收掉自己拉起的浏览器
  console.log(`\n${'='.repeat(60)}\n实拍结果：${pass} / ${pass + fail} 通过${fail ? `，${fail} 失败` : ''}\n截图目录：${OUT}\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('实拍脚本异常：', e); process.exit(1); });
