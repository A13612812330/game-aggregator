/* tools/preview-v1018.js — v10.18 浏览器实拍：机型清单「品牌 + 型号 + 芯片」三要素齐全 + 自动联网补全
 *
 * 复现用户截图那款游戏（终极漫画英雄vs卡普空3，xd-2044）：
 *   改前：芯片挤在次行小字里，9 台有 **3 台**写「未收录芯片」；顶部还有一条与首行重复的「门槛 …」摘要。
 *   改后：① 三要素都在，芯片做成徽标（本地=青绿 / 联网=靛蓝 / 真没有=灰虚线）
 *        ② 门槛并入行内橙色徽标，顶部摘要行取消
 *        ③ 3 台缺芯片的**自动联网补全**（Honor Magic8 Lite / Magic7 Lite / moto g(20)）
 *
 * 运行：node tools/preview-v1018.js       （需服务在 8123 运行）
 * 产出：_preview/v1018-devs.png、v1018-fill.png
 */
const fs = require('fs');
const path = require('path');
const { connectBrowser, sleep } = require('./browser');

const BASE = process.env.BASE || 'http://127.0.0.1:8123/';
const OUT = path.join(__dirname, '..', '_preview');
const GAME = { id: 'xd-2044', name: '终极漫画英雄vs卡普空3' };

let pass = 0, fail = 0;
/* ⚠️ 参数顺序必须是 (条件, 名称) —— v10.17 曾写成 (name, ok) 导致 20 条断言全部假通过。
   假绿比红更危险，所以这里保持与 preview-v1016/v1017 一致的签名。 */
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

  console.log(`\n=== ① 三要素齐全（品牌 + 型号 + 芯片）===
`);
  await p.evaluate((x) => window.openDetailById(x), GAME.id);
  await p.waitForFunction(() => document.querySelectorAll('#bhDevSlot .dv[data-hw]').length > 0, { timeout: 45000 }).catch(() => {});
  /* ⚠️ 「联网查询中…」是**中间态**，抓它本身就是竞态：结果已缓存时一次 fetch 就补完了，
     写 sleep 再采样必然随机失败（第一版就是这么挂的）。所以只断言两件可稳定观测的事：
     ① 补完之后**没有卡在「查询中」的**；② 补完之后每台要么有芯片、要么明确写「未收录」。
     中间态文案由 test-v1018 在源码层断言（那是确定的）。 */
  await p.waitForFunction(() => document.querySelectorAll('#bhDevSlot .chip.wait').length === 0, { timeout: 60000 }).catch(() => {});
  await sleep(600);

  const r = await p.evaluate(() => {
    const btns = [...document.querySelectorAll('#bhDevSlot .dv[data-hw]')];
    return {
      n: btns.length,
      rows: btns.map((x) => ({
        main: (x.querySelector('.hd b') || {}).textContent || '',
        chip: (x.querySelector('.sub .chip') || {}).textContent || '',
        chipCls: (x.querySelector('.sub .chip') || {}).className || '',
        chipTitle: (x.querySelector('.sub .chip') || {}).getAttribute('title') || '',
        code: (x.querySelector('.sub s') || {}).textContent || '',
        gate: !!x.querySelector('.gtag'),
        w: Math.round(x.getBoundingClientRect().width),
        h: Math.round(x.getBoundingClientRect().height),
      })),
      gateRows: document.querySelectorAll('#bhDevSlot .dv.gate').length,
      legend: (document.querySelector('.d-devlist-lg') || {}).textContent || '',
      oldGate: !!document.querySelector('#bhGate'),
      blkTxt: ((document.querySelector('#bhDevSlot') || {}).innerText || '').replace(/\s+/g, ' '),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });

  chk(r.n >= 9, '机型清单 ≥ 9 台', r.n + ' 台');
  chk(r.rows.every((x) => x.main), '每台都有「品牌 + 型号」主行');
  chk(r.rows.every((x) => x.chip), '★ 每台都有芯片徽标（没有空白位）',
    r.rows.map((x) => x.chip).join(' | ').slice(0, 150));
  const noneN = r.rows.filter((x) => /未收录/.test(x.chip)).length;
  chk(noneN === 0, '★ 9 台全部拿到芯片（改前有 3 台是「未收录芯片」）', `未收录 ${noneN} 台`);
  const olN = r.rows.filter((x) => /\bol\b/.test(x.chipCls)).length;
  chk(olN >= 3, '★ 至少 3 台是**联网补全**得来（靛蓝徽标 + 网 标记）', `联网补全 ${olN} 台`);
  const stuck = r.rows.filter((x) => /\bwait\b/.test(x.chipCls)).length;
  chk(stuck === 0, '★ 不会卡在「联网查询中…」（补完是芯片，查不到是「未收录」）', `卡住 ${stuck} 台`);
  chk(r.rows.every((x) => !/\bwait\b/.test(x.chipCls)), '每台的芯片位都是终态');
  const mi = r.rows.find((x) => /POCO F7/i.test(x.main));
  chk(mi && /Snapdragon 8s Gen 4/.test(mi.chip), 'POCO F7 芯片 = Snapdragon 8s Gen 4', mi ? mi.chip : '-');
  const mt = r.rows.find((x) => /Magic8 Lite/i.test(x.main));
  chk(mt && /Snapdragon 6 Gen 4/.test(mt.chip), '★ Honor Magic8 Lite 联网补到 Snapdragon 6 Gen 4', mt ? mt.chip : '-（没这台）');
  const mg = r.rows.find((x) => /moto g20|g\(20\)/i.test(x.main));
  chk(mg && /Unisoc T700/.test(mg.chip), '★ moto g(20) 匹配到 **Moto G20**（不是误配成 Moto G 2022）', mg ? mg.chip : '-（没这台）');
  chk(r.rows.some((x) => x.chipTitle.length > 0), '芯片徽标带 title（完整名，被收敛的长名可查看）', r.rows[0] ? r.rows[0].chipTitle.slice(0, 40) : '-');
  chk(r.rows.every((x) => x.w > 100 && x.h > 20), '每台真占版面', r.rows.slice(0, 3).map((x) => x.w + '×' + x.h).join(' '));
  chk(!/Dimensity 8350 \(/i.test(r.blkTxt), '长芯片名（带别名括号）在徽标里已收敛', '');
  chk(!r.overflow, '无横向溢出');

  console.log('\n=== ② 门槛并入行内（顶部重复摘要已取消）===');
  chk(r.gateRows === 1, '清单里正好一台带「门槛」徽标', r.gateRows + ' 台');
  chk(!!r.legend, '表头有「门槛机型」图例说明含义', r.legend);
  chk(!r.oldGate, '★ 顶部那条独立的「门槛 …」摘要行已移除（不再与首行重复）', '');
  chk(!/这台实测跑通了/.test(r.blkTxt), '旧摘要行的长句文案不再出现在清单里', '');
  await p.screenshot({ path: path.join(OUT, 'v1018-devs.png') });

  console.log('\n=== ③ 点开看详细参数（v10.16 功能未受本轮改动影响）===');
  const opened = await p.evaluate(async () => {
    const btn = [...document.querySelectorAll('#bhDevSlot .dv[data-hw]')].find((x) => {
      const hay = (x.getAttribute('data-hw') || '') + ' ' + ((x.querySelector('.sub s') || {}).textContent || '');
      return /25053PC47G/.test(hay);
    });
    if (!btn) return { skip: true, why: '找不到 25053PC47G 那一台' };
    btn.click();
    await new Promise((r) => setTimeout(r, 4500));
    const panel = document.querySelector('.d-hw');
    return {
      skip: false, has: !!panel,
      h: panel ? Math.round(panel.getBoundingClientRect().height) : 0,
      txt: panel ? panel.innerText.replace(/\s+/g, ' ').slice(0, 220) : '',
    };
  });
  if (opened.skip) chk(false, '能点到那台机型', opened.why);
  else {
    chk(opened.has && opened.h > 200, '★ 点一下仍能展开硬件参数面板', opened.h + 'px');
    chk(/Snapdragon 8s Gen 4|Adreno 825/.test(opened.txt), '面板里是 Snapdragon 8s Gen 4 / Adreno 825', opened.txt.slice(0, 90));
  }
  /* 联网补全不能把已展开的面板弄没（原地替换徽标，不重渲染清单） */
  const stillOpen = await p.evaluate(() => !!document.querySelector('.d-hw'));
  chk(stillOpen, '★ 联网补全用的是「原地替换徽标」，不会收掉用户已展开的面板');
  await p.screenshot({ path: path.join(OUT, 'v1018-fill.png') });

  chk(errs.length === 0, '无 JS 报错', errs.slice(0, 2).join(' / ') || '(无)');

  console.log('\n=== ④ 派生页 emulator.html 同步 ===');
  const p2 = await b.newPage();
  await p2.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 });
  const errs2 = [];
  p2.on('pageerror', (e) => errs2.push(e.message));
  await p2.goto(BASE + 'emulator.html', { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1200);
  await p2.evaluate((x) => window.openDetailById(x), GAME.id);
  await p2.waitForFunction(() => document.querySelectorAll('#bhDevSlot .dv[data-hw]').length > 0, { timeout: 45000 }).catch(() => {});
  await p2.waitForFunction(() => document.querySelectorAll('#bhDevSlot .chip.wait').length === 0, { timeout: 60000 }).catch(() => {});
  await sleep(800);
  const e = await p2.evaluate(() => {
    const btns = [...document.querySelectorAll('#bhDevSlot .dv[data-hw]')];
    return {
      n: btns.length,
      chips: btns.map((x) => (x.querySelector('.sub .chip') || {}).textContent || ''),
      gate: document.querySelectorAll('#bhDevSlot .dv.gate').length,
      legend: (document.querySelector('.d-devlist-lg') || {}).textContent || '',
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  chk(e.n >= 9, '[派生页] 机型清单 ≥ 9 台', e.n + ' 台');
  chk(e.chips.every((c) => c), '[派生页] 每台都有芯片徽标', e.chips.join(' | ').slice(0, 120));
  chk(e.gate === 1 && !!e.legend, '[派生页] 门槛徽标 + 图例都在', `gate=${e.gate} legend=${e.legend}`);
  chk(!e.overflow, '[派生页] 无横向溢出');
  chk(errs2.length === 0, '[派生页] 无 JS 报错', errs2.slice(0, 2).join(' / ') || '(无)');
  await p2.screenshot({ path: path.join(OUT, 'v1018-emulator.png') });

  console.log('\n=== ⑤ 联网补全的「多地区版本」值在徽标里收敛 ===');
  /* kalvo 对分地区发售的机型返回的 soc 是一长串，例如 `SM S711B`（Galaxy S23 FE）拿到
     `Samsung Exynos 2200 (国际版本) / Qualcomm Snapdragon 8 Gen 1 (美国)`。
     徽标显示主名、完整值挂 title —— 这条**必须实测**：静态断言查得到代码，
     但查不出真实渲染宽度会不会把次行顶破。取材 `Left 4 Dead 2`（xd-3570，含 SM S711B）。 */
  await p2.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(700);
  await p2.evaluate((x) => window.openDetailById(x), 'xd-3570');
  await p2.waitForFunction(() => document.querySelectorAll('#bhDevSlot .dv[data-hw]').length > 0, { timeout: 45000 }).catch(() => {});
  await p2.waitForFunction(() => document.querySelectorAll('#bhDevSlot .chip.wait').length === 0, { timeout: 90000 }).catch(() => {});
  await sleep(800);
  const mr = await p2.evaluate(() => {
    const rows = [...document.querySelectorAll('#bhDevSlot .dv[data-hw]')];
    const one = rows.find((x) => ((x.querySelector('.sub s') || {}).textContent || '').trim() === 'SM S711B');
    const chip = one && one.querySelector('.sub .chip');
    const sub = one && one.querySelector('.sub');
    return {
      found: !!one,
      chip: chip ? chip.textContent.trim() : '',
      title: chip ? chip.getAttribute('title') : '',
      cls: chip ? chip.className : '',
      w: chip ? Math.round(chip.getBoundingClientRect().width) : 0,
      subOver: sub ? sub.scrollWidth - sub.clientWidth : -1,
    };
  });
  chk(mr.found, '清单里有联网补全的 `SM S711B`（多地区值机型）');
  chk(/Exynos 2200/.test(mr.chip), '★ 徽标只显示**主名**', mr.chip);
  chk(!/国际版本|Snapdragon/.test(mr.chip), '★ 多地区后缀不进徽标（不换行、不溢出）');
  chk(/国际版本/.test(mr.title) && /Snapdragon/.test(mr.title), '★ 完整值仍挂在 title（信息不丢）', mr.title.slice(0, 46));
  chk(!/[/、,，]\s*$/.test(mr.title), '★ title 末尾没有悬空「 / 」（值已清洗）', JSON.stringify(mr.title.slice(-12)));
  chk(/chip ol/.test(mr.cls) && mr.w > 0, '联网补全的靛蓝徽标真占版面', `${mr.cls} ${mr.w}px`);
  chk(mr.subOver <= 0, '次行无横向溢出', mr.subOver + 'px');
  await p2.screenshot({ path: path.join(OUT, 'v1018-spot-devs.png') });

  for (const pg of await b.pages()) { try { await pg.close(); } catch (x) {} }
  await b.close();

  console.log('\n' + '='.repeat(58));
  console.log(`实拍结果：${pass} / ${pass + fail} 通过` + (fail ? `，${fail} 失败` : ''));
  console.log('截图目录：' + OUT);
  if (fail) process.exitCode = 1;
})().catch((e) => { console.error('运行失败：', e.message); process.exit(1); });
