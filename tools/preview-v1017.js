/* tools/preview-v1017.js — v10.17 浏览器实拍：机型清单「不再只显示 6 台」+ 译名规范
 *
 * 复现用户截图的那款游戏（终极漫画英雄vs卡普空3，条目 xd-2044）：
 *   改前：机型清单 6 台（上游摘要上限）、主行是残缺代号（`MTN NX3`）、
 *         底部一行「…上游汇总了 6 款机型，共 25 套配置」读起来像「还有更多没显示」。
 *   改后：9 台（摘要 + 逐条配置合并）、`HONOR MTN-NX3` → `Honor Magic8 Lite`、
 *         误导文案在没被截断时**不出现**。
 *
 * 运行：node tools/preview-v1017.js     （需服务在 8123 运行）
 * 产出：_preview/v1017-*.png
 */
const fs = require('fs');
const path = require('path');
const { connectBrowser, sleep } = require('./browser');

const BASE = process.env.BASE || 'http://127.0.0.1:8123/';
const OUT = path.join(__dirname, '..', '_preview');
const GAME = { id: 'xd-2044', name: '终极漫画英雄vs卡普空3（用户截图那款）' };

let pass = 0, fail = 0;
/* ⚠️ 参数顺序必须是 (条件, 名称) —— v10.17 第一版写成 (name, ok) 而调用时按 (条件, 名称) 传，
   结果 `ok` 收到了非空字符串恒为真，**20 条断言全部假通过**。
   这种「假绿」比失败更危险，所以签名与调用方式在这里写死对齐（与 preview-v1016 的 ok() 一致）。 */
function chk(ok, name, extra) {
  (ok ? pass++ : fail++);
  console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`);
  if (!ok && typeof name !== 'string') console.log('     ⚠️ 断言名称缺失 —— 多半是参数顺序又写反了');
}

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const H = await connectBrowser();
  const b = H.browser;

  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await p.waitForSelector('#drawer', { timeout: 20000 });
  await sleep(900);

  console.log(`\n=== 「${GAME.name}」详情页机型清单 ===`);
  await p.evaluate((x) => window.openDetailById(x), GAME.id);
  await p.waitForFunction(() => document.querySelectorAll('#bhDevSlot .dv[data-hw]').length > 0, { timeout: 45000 }).catch(() => {});
  await sleep(3500);

  const r = await p.evaluate(() => {
    const btns = [...document.querySelectorAll('#bhDevSlot .dv[data-hw]')];
    const blk = document.querySelector('#bhDevSlot .d-blk') || document.getElementById('bhDevSlot');
    const cnt = document.querySelector('#bhDevSlot') ? (document.querySelector('.d-blk .cnt') || {}).textContent || '' : '';
    return {
      n: btns.length,
      rows: btns.map((x) => ({
        main: (x.querySelector('.hd b') || {}).textContent || '',
        code: (x.querySelector('.sub s') || {}).textContent || '',
        chip: (x.querySelector('.sub i') || {}).textContent || '',
        hw: x.getAttribute('data-hw') || '',
        w: Math.round(x.getBoundingClientRect().width),
      })),
      moreTxt: (document.querySelector('#bhDevSlot .dv.more') || {}).textContent || '',
      blkTxt: (blk ? blk.innerText : '').replace(/\s+/g, ' ').slice(0, 400),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      header: cnt,
    };
  });

  chk(r.n >= 9, '机型清单 ≥ 9 台（不再卡在上游摘要的 6 台）', r.n + ' 台');
  chk(r.n === 9, '正好 9 台（样本固定值）', r.n + ' 台');
  chk(!/^MTN NX3$/i.test(r.rows[0].main) && !/^BRP NX3$/i.test(r.rows[0].main), '主行不是残缺代号', r.rows.slice(0, 3).map((x) => x.main).join(' | '));
  const honor = r.rows.find((x) => /MTN/i.test(x.main + x.code + x.hw));
  chk(!!honor, 'HONOR MTN-NX3 在清单里');
  chk(honor && honor.main === 'Honor Magic8 Lite', '★ HONOR MTN-NX3 主行显示 Honor Magic8 Lite', honor ? honor.main : '-');
  chk(honor && !/HONOR HONOR/i.test(honor.main), '★ 品牌词不重复（不是 Honor HONOR Magic8 Lite）', honor ? honor.main : '-');
  const xiaomi = r.rows.find((x) => /25053PC47G/i.test(x.hw + x.code));
  chk(xiaomi && xiaomi.main === 'Xiaomi POCO F7', '★ 用户举的那台仍是 Xiaomi POCO F7', xiaomi ? xiaomi.main + '（副行 ' + xiaomi.code + '）' : '-');
  chk(!r.rows.some((x) => /\(`?[a-z][a-z0-9_\- ]{2,}\)/.test(x.main)), '没有主行泄漏内部代号（括号 codename）', r.rows.map((x) => x.main).filter((m) => /\(/.test(m)).join(' | ') || '无');
  chk(!/上游共汇总/.test(r.blkTxt), '★ 不再出现「上游共汇总 N 款机型」误导文案');
  chk(r.moreTxt === '' || /还有 \d+ 台机型未展开/.test(r.moreTxt), 'more 行要么不出现、要么说「还有 N 台未展开」', r.moreTxt || '(未出现)');
  chk(r.rows.every((x) => x.w > 100), '每台真的占版面（宽 > 100px）', r.rows.slice(0, 3).map((x) => x.w).join('/'));
  chk(!r.overflow, '无横向溢出');
  chk(errs.length === 0, '无 JS 报错', errs.slice(0, 2).join(' / ') || '(无)');
  chk(/9 款机型/.test(r.header) || /9 款机型/.test(r.blkTxt), '抬头计数跟着变成 9 款机型', r.header || '(空)');
  await p.screenshot({ path: path.join(OUT, 'v1017-devs.png') });

  /* ---- 点开一台看硬件参数面板仍能展开（v10.16 功能没被这次改动弄坏） ---- */
  const opened = await p.evaluate(async () => {
    /* ⚠️ `data-hw` 存的是**译名**（`Xiaomi POCO F7`），内部代号在副行 `.sub s` 里。
       第一版写成 `data-hw || .sub s` —— data-hw 有值就短路了，永远匹配不到代号（测试的锅）。 */
    const btn = [...document.querySelectorAll('#bhDevSlot .dv[data-hw]')].find((x) => {
      const hay = (x.getAttribute('data-hw') || '') + ' ' + ((x.querySelector('.sub s') || {}).textContent || '');
      return /25053PC47G/.test(hay);
    });
    if (!btn) return { skip: true, why: '在清单里找不到 25053PC47G 那一台' };
    btn.click();
    await new Promise((r) => setTimeout(r, 4500));
    const panel = document.querySelector('.d-hw');
    return { skip: false, has: !!panel, h: panel ? Math.round(panel.getBoundingClientRect().height) : 0, txt: panel ? panel.innerText.replace(/\s+/g, ' ').slice(0, 200) : '' };
  });
  if (opened.skip) chk(false, '能点到那台机型', opened.why);
  else {
    chk(opened.has, '★ 点一下仍能展开硬件参数面板', opened.h + 'px');
    chk(/Snapdragon 8s Gen 4|Adreno 825/.test(opened.txt), '面板里有 Snapdragon 8s Gen 4 / Adreno 825', opened.txt.slice(0, 90));
  }
  await p.screenshot({ path: path.join(OUT, 'v1017-hw.png') });

  /* ---- 派生页同步 ---- */
  console.log('\n=== 派生页 emulator.html 同步 ===');
  const p2 = await b.newPage();
  await p2.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 });
  const errs2 = [];
  p2.on('pageerror', (e) => errs2.push(e.message));
  await p2.goto(BASE + 'emulator.html', { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1200);
  await p2.evaluate((x) => window.openDetailById(x), GAME.id);
  await p2.waitForFunction(() => document.querySelectorAll('#bhDevSlot .dv[data-hw]').length > 0, { timeout: 45000 }).catch(() => {});
  await sleep(3200);
  const e = await p2.evaluate(() => {
    const btns = [...document.querySelectorAll('#bhDevSlot .dv[data-hw]')];
    return {
      n: btns.length,
      first: (btns[0] ? (btns[0].querySelector('.hd b') || {}).textContent : '') || '',
      hasMain: btns.some((x) => /Honor Magic8 Lite/.test((x.querySelector('.hd b') || {}).textContent || '')),
      more: (document.querySelector('#bhDevSlot .dv.more') || {}).textContent || '',
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  chk(e.n >= 9, '[派生页] 机型清单也是 ≥ 9 台', e.n + ' 台');
  chk(e.hasMain, '[派生页] Honor Magic8 Lite 主行在位', e.first);
  chk(!/上游共汇总/.test(e.more), '[派生页] 无误导文案', e.more || '(未出现)');
  chk(!e.overflow, '[派生页] 无横向溢出');
  chk(errs2.length === 0, '[派生页] 无 JS 报错', errs2.slice(0, 2).join(' / ') || '(无)');
  await p2.screenshot({ path: path.join(OUT, 'v1017-emulator.png') });

  for (const pg of await b.pages()) { try { await pg.close(); } catch (x) {} }
  await b.close();

  console.log('\n' + '='.repeat(58));
  console.log(`实拍结果：${pass} / ${pass + fail} 通过` + (fail ? `，${fail} 失败` : ''));
  console.log('截图目录：' + OUT);
  if (fail) process.exitCode = 1;
})().catch((e) => { console.error('运行失败：', e.message); process.exit(1); });
