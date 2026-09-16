/* tools/preview-v1011.js — v10.11 三项修复的浏览器实拍验收
 *
 *  ① 详情页「下载入口」（机地社区 MOD / 修改器帖，带网盘直链的那一套）
 *  ② 「同分类更多」改多因子打分后的实际推荐（带「同系列」理由徽标）
 *  ③ 机型「转译」：输入市场名（小米15）也能解析出 SoC / GPU / CPU
 *
 * 运行：node tools/preview-v1011.js      （需服务已在 8123 运行）
 * 产出：_preview/v1011-*.png
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://127.0.0.1:8123';
const OUT = path.join(__dirname, '..', '_preview');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    args: ['--no-sandbox', '--window-size=1440,1100'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1100 });
  page.on('pageerror', (e) => console.log('  [页面 JS 报错]', e.message));

  /* ---- 首页：打开赛博朋克2077 的详情抽屉（社区 MOD 最多的一款） ---- */
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await wait(2500);
  await page.evaluate(() => { if (typeof openDetailById === 'function') openDetailById('xd-191'); });
  await wait(6000);   // 等详情抓取 + 三个区块懒加载

  const probe = await page.evaluate(() => {
    const dl = document.querySelector('#dlSlot');
    const rel = document.querySelector('#relSlot');
    return {
      drawerOpen: !!document.querySelector('#drawer.show'),
      dlLen: dl ? dl.innerHTML.length : -1,
      dlItems: dl ? dl.querySelectorAll('.d-dl-it').length : -1,
      dlFirst: dl && dl.querySelector('.d-dl-it .t') ? dl.querySelector('.d-dl-it .t').textContent : '',
      dlTitle: dl && dl.querySelector('h4') ? dl.querySelector('h4').textContent.replace(/\s+/g, ' ').trim() : '',
      relLen: rel ? rel.innerHTML.length : -1,
      relItems: rel ? rel.querySelectorAll('.rel-it').length : -1,
      relWhy: rel ? rel.querySelectorAll('.rel-it .why').length : -1,
      relHead: rel && rel.querySelector('h4') ? rel.querySelector('h4').textContent.replace(/\s+/g, ' ').trim() : '',
      relNames: rel ? [...rel.querySelectorAll('.rel-it .t')].map((x) => x.textContent).slice(0, 4) : [],
    };
  });
  console.log('=== 详情抽屉 ===');
  console.log('  抽屉已打开      :', probe.drawerOpen ? '✅' : '❌');
  console.log('  下载入口区块    :', probe.dlLen > 0 ? `✅ ${probe.dlItems} 条 / ${probe.dlTitle}` : '❌ 未渲染');
  console.log('  第一条帖子      :', probe.dlFirst);
  console.log('  同分类更多      :', probe.relLen > 0 ? `✅ ${probe.relItems} 条 / ${probe.relHead}` : '❌ 未渲染');
  console.log('  「同系列」徽标  :', probe.relWhy > 0 ? `✅ ${probe.relWhy} 个` : '— 本品无同系列');
  console.log('  推荐条目        :', probe.relNames.join(' ｜ '));

  /* 截图 1：下载入口（滚到抽屉底部） */
  await page.evaluate(() => {
    const el = document.querySelector('#dlSlot');
    if (el) el.scrollIntoView({ block: 'center' });
  });
  await wait(500);
  await page.screenshot({ path: path.join(OUT, 'v1011-detail-download.png'), clip: await clipOf(page, '#dlSlot') });
  /* 截图 2：同分类更多（理由徽标） */
  await page.evaluate(() => {
    const el = document.querySelector('#relSlot');
    if (el) el.scrollIntoView({ block: 'center' });
  });
  await wait(400);
  await page.screenshot({ path: path.join(OUT, 'v1011-detail-related.png'), clip: await clipOf(page, '#relSlot') });

  /* ---- 手机专区 #dm：机型转译（市场名 → SoC/GPU/CPU） ---- */
  await page.goto(BASE + '/emulator.html#dm', { waitUntil: 'networkidle2', timeout: 60000 });
  await wait(2500);
  const dmOut = [];
  for (const model of ['小米15', 'TECNO LJ9 MT6897', 'Redmi Turbo 4', 'SM S938B']) {
    const r = await page.evaluate(async (m) => {
      if (typeof dmQuery !== 'function') return { err: 'dmQuery 未定义' };
      await dmQuery(m);
      await new Promise((r) => setTimeout(r, 1200));
      const info = document.querySelector('#dmInfo');
      const txt = info ? info.innerText.replace(/\s+/g, ' ').trim() : '';
      return { txt, shown: info ? info.style.display !== 'none' : false };
    }, model);
    dmOut.push([model, r.txt || r.err || '(空)']);
  }
  console.log('\n=== 机型转译（手机专区 · 机型兼容） ===');
  for (const [m, txt] of dmOut) console.log(`  ${m.padEnd(20)} → ${txt.slice(0, 110)}`);
  await page.screenshot({ path: path.join(OUT, 'v1011-device-translate.png'), clip: await clipOf(page, '#dmInfo') });

  await browser.close();
  console.log('\n产出：_preview/v1011-detail-download.png, v1011-detail-related.png, v1011-device-translate.png');

  /** 取元素在页面坐标系里的裁剪框（滚出视口时用整页截图会太糊，这里用视口裁剪） */
  async function clipOf(p, sel) {
    return p.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return { x: 0, y: 0, width: 900, height: 300 };
      const r = el.getBoundingClientRect();
      const pad = 12;
      return {
        x: Math.max(0, Math.round(r.left - pad)),
        y: Math.max(0, Math.round(r.top - pad)),
        width: Math.min(1440, Math.round(r.width + pad * 2)),
        height: Math.min(1100, Math.round(r.height + pad * 2)),
      };
    }, sel);
  }
})().catch((e) => { console.error('❌ 预览失败：', e.message); process.exit(1); });
