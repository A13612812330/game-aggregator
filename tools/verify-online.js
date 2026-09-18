/* tools/verify-online.js — 「线上到底是不是新版」的真机验收
 *
 * 为什么需要它：这个失败模式已经复发三次 ——
 *   v10.15 改完没发、v10.16 改完没发、v10.17 改完还没发，
 *   用户每次都是**先看到旧界面才来问**，而我在本地一切正常。
 *   `curl | grep 特征串` 只能证明「代码里有没有」，证不了「打开页面对不对」，
 *   所以要真的开一次浏览器、点一次详情页、量一次面板高度。
 *
 * 用法：
 *   node tools/verify-online.js                    # 用下面默认链接
 *   node tools/verify-online.js <url>              # 指定链接
 *   BASE=<url> node tools/verify-online.js
 *
 * 产出：_preview/live-devs.png、_preview/live-hw.png
 * 退出码：0 全通过；1 有失败（可直接串进 CI/收尾脚本）
 */
const fs = require('fs');
const path = require('path');
const { connectBrowser, sleep } = require('./browser');

const BASE = (process.argv[2] || process.env.BASE || 'https://gamehub-agg-join.app.workbuddy.host/').replace(/\/?$/, '/');
const OUT = path.join(__dirname, '..', '_preview');
/* 抽样游戏：用户截图那款（机型最多、踩过全部三个 bug：6 台上限 / 残缺代号 / 误导文案） */
const GAME = { id: 'xd-2044', name: '终极漫画英雄vs卡普空3' };
/* 这一版必须出现在页面上的特征串（漏一个就说明线上是旧包） */
const MUST = ['bhHwSlot', 'toggleDevHardware', 'data-hw', 'hasDetailUrl', 'd-hw .kvs2'];

let pass = 0, fail = 0;
function chk(ok, name, extra) {
  (ok ? pass++ : fail++);
  console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`);
}

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  console.log(`线上验收目标：${BASE}\n`);

  /* ---- ① 接口侧：确认线上是 v10.17 的数据与逻辑 ---- */
  const api = async (u) => {
    const r = await fetch(BASE.replace(/\/$/, '') + u);
    let j = null; try { j = await r.json(); } catch (e) {}
    return { s: r.status, j };
  };
  const mkt = await api('/api/device/market-stats');
  chk(mkt.s === 200 && mkt.j && mkt.j.ok, '[接口] 机型库已上线', mkt.j ? mkt.j.codes + ' 个内部编号' : 'status ' + mkt.s);
  const mh = await api('/api/mobilehub/match?t=' + encodeURIComponent(GAME.name));
  const devs = (mh.j && mh.j.hit && mh.j.hit.devices) || [];
  chk(devs.length >= 9, '[接口] 机型清单已合并到 ≥ 9 台（不是上游摘要的 6 台上限）', devs.length + ' 台');
  const hw = await api('/api/device/hardware?m=' + encodeURIComponent('Xiaomi POCO F7'));
  const nRows = hw.j && hw.j.groups ? hw.j.groups.reduce((n, g) => n + (g.items || []).length, 0) : 0;
  chk(hw.s === 200 && hw.j && hw.j.ok && nRows > 30, '[接口] kalvo 硬件参数从沙箱可达', nRows + ' 行 / ' + ((hw.j && hw.j.groups || []).length) + ' 组');

  /* ---- ② 页面侧：真机打开、真点详情页 ---- */
  const H = await connectBrowser();
  const b = H.browser;
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE, { waitUntil: 'networkidle2', timeout: 90000 });
  await p.waitForSelector('#drawer', { timeout: 30000 });
  await sleep(1200);

  const html = await p.content();
  const missing = MUST.filter((k) => !html.includes(k));
  chk(missing.length === 0, '[页面] 线上首页含本版全部特征串', missing.length ? '缺：' + missing.join(', ') : MUST.length + ' 项齐');

  console.log(`\n=== 线上详情页「${GAME.name}」实拍 ===`);
  await p.evaluate((x) => window.openDetailById(x), GAME.id);
  await p.waitForFunction(() => document.querySelectorAll('#bhDevSlot .dv[data-hw]').length > 0, { timeout: 60000 }).catch(() => {});
  await sleep(4000);

  const r = await p.evaluate(() => {
    const btns = [...document.querySelectorAll('#bhDevSlot .dv[data-hw]')];
    return {
      n: btns.length,
      rows: btns.map((x) => ({
        main: (x.querySelector('.hd b') || {}).textContent || '',
        code: (x.querySelector('.sub s') || {}).textContent || '',
        hw: x.getAttribute('data-hw') || '',
        w: Math.round(x.getBoundingClientRect().width),
      })),
      moreTxt: (document.querySelector('#bhDevSlot .dv.more') || {}).textContent || '',
      blkTxt: ((document.querySelector('#bhDevSlot') || {}).innerText || '').replace(/\s+/g, ' '),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  chk(r.n >= 9, '[线上] 详情页机型清单 ≥ 9 台', r.n + ' 台');
  const honor = r.rows.find((x) => /MTN/i.test(x.main + x.code + x.hw));
  chk(honor && honor.main === 'Honor Magic8 Lite', '[线上] 残缺代号已换成「品牌+型号」', honor ? honor.main : '(未找到 MTN 那台)');
  const mi = r.rows.find((x) => /25053PC47G/i.test(x.hw + x.code));
  chk(mi && mi.main === 'Xiaomi POCO F7', '[线上] 用户举的那台显示 Xiaomi POCO F7', mi ? mi.main : '(未找到)');
  chk(!/上游共汇总/.test(r.blkTxt), '[线上] 不再出现「上游共汇总 N 款机型」误导文案');
  chk(r.rows.every((x) => x.w > 100), '[线上] 每台真占版面（宽 > 100px）', r.rows.slice(0, 3).map((x) => x.w).join('/'));
  chk(!r.overflow, '[线上] 无横向溢出');
  chk(errs.length === 0, '[线上] 无 JS 报错', errs.slice(0, 2).join(' / ') || '(无)');
  await p.screenshot({ path: path.join(OUT, 'live-devs.png') });

  /* ---- ③ 点开一台，看硬件参数面板是否真展开 ---- */
  const opened = await p.evaluate(async () => {
    const btn = [...document.querySelectorAll('#bhDevSlot .dv[data-hw]')].find((x) => {
      const hay = (x.getAttribute('data-hw') || '') + ' ' + ((x.querySelector('.sub s') || {}).textContent || '');
      return /25053PC47G/.test(hay);
    });
    if (!btn) return { skip: true, why: '详情页里找不到 25053PC47G 那一台' };
    btn.click();
    await new Promise((r) => setTimeout(r, 5000));
    const panel = document.querySelector('.d-hw');
    return {
      skip: false, has: !!panel,
      h: panel ? Math.round(panel.getBoundingClientRect().height) : 0,
      w: panel ? Math.round(panel.getBoundingClientRect().width) : 0,
      txt: panel ? panel.innerText.replace(/\s+/g, ' ').slice(0, 240) : '',
    };
  });
  if (opened.skip) chk(false, '[线上] 能点到那台机型', opened.why);
  else {
    chk(opened.has && opened.h > 200, '[线上] ★ 点一下真能展开硬件参数面板', opened.h + 'px 高 / ' + opened.w + 'px 宽');
    chk(/Snapdragon 8s Gen 4|Adreno 825/.test(opened.txt), '[线上] 面板里是 Snapdragon 8s Gen 4 / Adreno 825', opened.txt.slice(0, 100));
  }
  await p.screenshot({ path: path.join(OUT, 'live-hw.png') });

  for (const pg of await b.pages()) { try { await pg.close(); } catch (x) {} }
  await b.close();

  console.log('\n' + '='.repeat(58));
  console.log(`线上验收：${pass} / ${pass + fail} 通过` + (fail ? `，${fail} 失败` : ''));
  console.log('截图：_preview/live-devs.png、_preview/live-hw.png');
  if (fail) process.exitCode = 1;
})().catch((e) => { console.error('运行失败：', e.message); process.exit(1); });
