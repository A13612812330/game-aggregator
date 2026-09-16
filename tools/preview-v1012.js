/* tools/preview-v1012.js — v10.12 机型转译「第四跳（CPU）」浏览器实拍
 *
 *  背景：v10.11 把「机型 → GPU → SoC」打通了，但「SoC → CPU 核簇」这一跳挂空 ——
 *        唯一的来源 device-board.json 只有 200 条主板，对库内 66 个 SoC 只命中 1 个，
 *        实测 967 台机型「有 SoC 无 CPU」，**CPU 覆盖率是 0%**。
 *        v10.12 换成 data/soc-cpu.json（nanoreview 抓的 343 条），覆盖率 → 92.4%。
 *
 *  这个脚本验证「界面上真的看得到 CPU 那一行」，并检查长串不撑破卡片。
 *
 *  运行：node tools/preview-v1012.js      （需服务已在 8123 运行）
 *  产出：_preview/v1012-device-cpu.png、v1012-device-cpu-mobile.png
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://127.0.0.1:8123';
const OUT = path.join(__dirname, '..', '_preview');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const MODELS = ['小米15', 'Redmi Turbo 4', 'TECNO LJ9 MT6897', 'Xiaomi 22101320G', 'SM S938B'];

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    args: ['--no-sandbox', '--window-size=1440,1100'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1100 });
  page.on('pageerror', (e) => console.log('  [页面 JS 报错]', e.message));

  await page.goto(BASE + '/emulator.html#dm', { waitUntil: 'networkidle2', timeout: 60000 });
  await wait(2800);

  console.log('=== 机型转译（第四跳：CPU）===');
  let shown = 0;
  for (const model of MODELS) {
    const r = await page.evaluate(async (m) => {
      if (typeof dmQuery !== 'function') return { err: 'dmQuery 未定义' };
      await dmQuery(m);
      await new Promise((res) => setTimeout(res, 900));
      const info = document.getElementById('dmInfo');
      if (!info || info.style.display === 'none') return { err: '机型卡未显示' };
      const cpuEl = info.querySelector('.dm-info-cpu');
      const code = cpuEl ? cpuEl.querySelector('code') : null;
      const rows = [...info.querySelectorAll('.dm-info-r span')].map((x) => x.textContent.replace(/\s+/g, ' ').trim());
      const box = info.getBoundingClientRect();
      /* 溢出检测：卡片自身不能横向溢出（长 CPU 串必须换行而不是撑破） */
      const overflow = info.scrollWidth - info.clientWidth;
      return {
        model: (info.querySelector('.dm-info-h b') || {}).textContent || '',
        rows,
        cpu: code ? code.textContent.trim() : '',
        cpuLines: code ? Math.round(code.getBoundingClientRect().height / 16) : 0,
        overflow,
        w: Math.round(box.width),
      };
    }, model);

    if (r.err) { console.log(`  ❌ ${model} : ${r.err}`); continue; }
    console.log(`  ${r.model}`);
    console.log(`      ${r.rows.join('   ｜   ')}`);
    console.log(`      CPU  ${r.cpu || '（无）'}`);
    console.log(`      横向溢出 ${r.overflow}px ${r.overflow <= 1 ? '✅' : '❌'} ｜ 卡片宽 ${r.w}px`);
    if (r.cpu) shown++;

    if (model === '小米15') {
      await shot(page, '#dmInfo', path.join(OUT, 'v1012-device-cpu.png'));
    }
  }
  console.log(`\n  CPU 行渲染 ${shown}/${MODELS.length} ✅`);

  /* 窄屏（375）：长串换行不能撑破 */
  await page.setViewport({ width: 375, height: 812, isMobile: true });
  await page.reload({ waitUntil: 'networkidle2' });
  await wait(2500);
  const mob = await page.evaluate(async () => {
    await dmQuery('Xiaomi 22101320G');
    await new Promise((r) => setTimeout(r, 900));
    const info = document.getElementById('dmInfo');
    const code = info && info.querySelector('.dm-info-cpu code');
    return {
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      infoOverflow: info ? info.scrollWidth - info.clientWidth : -1,
      cpu: code ? code.textContent.trim() : '',
    };
  });
  console.log(`\n=== 窄屏 375（最长的一条 CPU 串）===`);
  console.log(`  文档横向溢出 ${mob.docOverflow}px ${mob.docOverflow <= 1 ? '✅' : '❌'}`);
  console.log(`  机型卡横向溢出 ${mob.infoOverflow}px ${mob.infoOverflow <= 1 ? '✅' : '❌'}`);
  if (mob.cpu) {
    await wait(300);
    await shot(page, '#dmInfo', path.join(OUT, 'v1012-device-cpu-mobile.png'));
  }

  await browser.close();
  console.log('\n截图：_preview/v1012-device-cpu.png、v1012-device-cpu-mobile.png');
})().catch((e) => { console.error('实拍失败:', e.message); process.exit(1); });

/** 先滚到元素（底部对齐，保证整块可见），再按包围盒截图 */
async function shot(page, sel, out) {
  await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const target = window.scrollY + r.top + r.height - window.innerHeight + 40;
    window.scrollTo(0, Math.max(0, target));
  }, sel);
  await wait(400);
  const clip = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const pad = 8;
    const x = Math.max(0, r.left - pad);
    const y = Math.max(0, r.top - pad);
    return {
      x,
      y,
      width: Math.min(vw - x, r.width + pad * 2),
      height: Math.min(vh - y, r.height + pad * 2),
    };
  }, sel);
  if (!clip || clip.width < 4 || clip.height < 4) {
    await page.screenshot({ path: out, fullPage: false });
    return;
  }
  await page.screenshot({ path: out, clip });
}

/** 取元素的可视包围盒（供 clip 用），带边界保护 */
async function clipOf(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return { x: 0, y: 0, width: 800, height: 400 };
    const r = el.getBoundingClientRect();
    const pad = 8;
    return {
      x: Math.max(0, r.left - pad),
      y: Math.max(0, r.top - pad),
      width: Math.min(window.innerWidth - Math.max(0, r.left - pad), r.width + pad * 2),
      height: r.height + pad * 2,
    };
  }, sel);
}
