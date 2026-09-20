/* tools/verify-online.js — 「线上到底是不是新版」的真机验收
 *
 * 为什么需要它：这个失败模式已经复发三次 ——
 *   v10.15 改完没发、v10.16 改完没发、v10.17 改完还没发，
 *   用户每次都是**先看到旧界面才来问**，而我在本地一切正常。
 *   `curl | grep 特征串` 只能证明「代码里有没有」，证不了「打开页面对不对」，
 *   所以要真的开一次浏览器、点一次详情页、量一次面板高度。
 *
 * ★ 默认链接必须**指向当前最新那一次发布**。2026-09-18 踩过一次：
 *   默认值还停在上一次的域名（`gamehub-agg-join`），而那次发布实际落到了新 app，
 *   脚本于是「老老实实验收了旧包」并全绿 —— 验收目标本身是错的，比不验更危险。
 *   所以换链接时**必须同步改这里**，并且下面会先断言线上确有本版特征串。
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

/* ⚠️ 默认目标**从 tools/report.js 的 LINKS.LIVE 现抠**，不在这儿另写一份 ——
   另写就会漂（本项目踩过：默认值曾停在 gamehub-agg-join，而那时 LIVE 早换成别的了）。
   2026-09-20（v10.23）：LIVE 从 `36aa37e9…`（未登记、发布工具无法更新）切到 `gamehub-agg-v4`。 */
const REPORT_SRC = fs.readFileSync(path.join(__dirname, 'report.js'), 'utf8');
const LIVE_FROM_REPORT = (REPORT_SRC.match(/LIVE:\s*'(https:\/\/[^']+)'/) || [])[1];
if (!LIVE_FROM_REPORT) {
  console.error('✗ 无法从 tools/report.js 抠出 LINKS.LIVE —— report.js 的结构变了？');
  process.exit(1);
}
const BASE = (process.argv[2] || process.env.BASE || LIVE_FROM_REPORT).replace(/\/?$/, '/');
const OUT = path.join(__dirname, '..', '_preview');
/* 抽样游戏：用户截图那款（机型最多、踩过全部三个 bug：6 台上限 / 残缺代号 / 误导文案）
 * 其中 `HONOR MTN-NX3` 本地查不到芯片、要靠 kalvo 联网补 → 正好验 ③ */
const GAME = { id: 'xd-2044', name: '终极漫画英雄vs卡普空3' };
/* 这一版必须出现在页面上的特征串（漏一个就说明线上是旧包） */
const MUST = [
  'bhHwSlot', 'toggleDevHardware', 'data-hw', 'hasDetailUrl', 'd-hw .kvs2',
  /* ---- v10.18：三要素徽标 + 门槛并入行内 + 未收录联网补全 ---- */
  'chipHtml', 'chipShort', 'chipTag', '.chip.ol', '联网查询中', 'gtag', 'd-devlist-lg',
];

let pass = 0, fail = 0;
function chk(ok, name, extra) {
  (ok ? pass++ : fail++);
  console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`);
}

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  console.log(`线上验收目标：${BASE}\n`);

  /* ---- ① 接口侧：确认线上带的是 v10.18 的数据与逻辑 ---- */
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
  /* ---- v10.18 新接口：缺芯片的机型**交给线上实时补**（沙箱能出网是这条的前置） ---- */
  const fs2 = await api('/api/device/fill-stats');
  chk(fs2.s === 200 && fs2.j && fs2.j.ok, '[接口] ★ v10.18 联网补全接口已上线', fs2.j ? `缓存 ${fs2.j.total} 条 / 已补 ${fs2.j.withChip} / 联网 ${fs2.j.fromOnline}` : 'status ' + fs2.s);
  const sp = await api('/api/device/specs?models=' + encodeURIComponent(devs.join('|')));
  const spMap = (sp.j && sp.j.specs) || {};
  const spKeys = Object.keys(spMap);
  const needFill = spKeys.filter((k) => spMap[k].needFill);
  chk(sp.s === 200 && spKeys.length >= 9 && spKeys.every((k) => 'chip' in spMap[k]),
    '[接口] /api/device/specs 逐台带回 chip 字段', spKeys.length + ' 台');
  chk(needFill.length >= 1, '[接口] 本款确有本地查不到的机型（③ 的入口）', needFill.join(' / ') || '(无 → 这游戏验不到③)');

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
  /* ★ v10.18：清单渲染后前端会**自己发起联网补全**，等它跑完再断言 ——
     否则量到的是中间态「联网查询中…」，会把「没补完」当成通过。 */
  const waited = await p.waitForFunction(
    () => document.querySelectorAll('#bhDevSlot .dv .chip.wait').length === 0,
    { timeout: 90000 },
  ).then(() => true).catch(() => false);
  await sleep(800);

  const r = await p.evaluate(() => {
    const btns = [...document.querySelectorAll('#bhDevSlot .dv[data-hw]')];
    return {
      n: btns.length,
      rows: btns.map((x) => {
        const chip = x.querySelector('.sub .chip');
        const b = x.querySelector('.hd b');
        const cb = chip ? chip.getBoundingClientRect() : null;
        return {
          main: (b || {}).textContent || '',
          code: (x.querySelector('.sub s') || {}).textContent || '',
          hw: x.getAttribute('data-hw') || '',
          w: Math.round(x.getBoundingClientRect().width),
          chipTxt: chip ? chip.textContent.trim() : '',
          chipCls: chip ? chip.className : '',
          chipW: cb ? Math.round(cb.width) : 0,
          chipH: cb ? Math.round(cb.height) : 0,
          chipTitle: chip ? chip.getAttribute('title') || '' : '',
          hasNetTag: !!(chip && chip.querySelector('u')),
          bW: b ? Math.round(b.getBoundingClientRect().width) : 0,
          bScroll: b ? b.scrollWidth : 0,
          bClient: b ? b.clientWidth : 0,
        };
      }),
      gateN: document.querySelectorAll('#bhDevSlot .dv.gate .gtag').length,
      /* ⚠️ 图例挂在 **h4 的 `.cnt`** 里（`#bhSlot > .d-blk > h4 > .cnt > .d-devlist-lg`），
         而 `#bhDevSlot` 是 h4 的**兄弟**容器 —— 用 `#bhDevSlot .d-devlist-lg` 查会误判为「图例没渲染」。 */
      legend: (() => {
        const lg = document.querySelector('#bhSlot .d-devlist-lg');
        if (!lg) return null;
        const par = lg.parentElement;
        return { txt: lg.textContent.trim(), inH4: !!(par && par.closest('h4')) };
      })(),
      waits: document.querySelectorAll('#bhDevSlot .dv .chip.wait').length,
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

  /* ---- ②b ★ v10.18 三要素：① 每台都有芯片徽标 ② 「全整显示」不截断 ③ 未收录真的联网补上了 ---- */
  console.log('\n=== v10.18 三要素实拍 ===');
  const noChip = r.rows.filter((x) => !x.chipTxt);
  chk(noChip.length === 0, '[线上] ① 每台机型都带芯片徽标（品牌+型号+芯片三要素齐）',
    noChip.length ? '缺：' + noChip.map((x) => x.main).join(' / ') : r.rows.length + ' 台齐');
  chk(r.waits === 0, '[线上] 联网补全已全部收尾（没有卡在「联网查询中」）', `等待 ${waited ? '已完成' : '超时'}`);
  chk(r.rows.every((x) => x.chipW > 0 && x.chipH > 0), '[线上] 徽标真占版面（宽高 > 0）',
    r.rows.slice(0, 3).map((x) => x.chipW + '×' + x.chipH).join(' / '));
  const trunc = r.rows.filter((x) => x.bScroll > x.bClient + 1);
  chk(trunc.length === 0, '[线上] ② 品牌+型号「全整显示」无截断（scrollWidth ≤ clientWidth）',
    trunc.length ? '被截：' + trunc.map((x) => x.main).join(' / ') : r.rows.length + ' 台');
  const mt = r.rows.find((x) => /MTN/i.test(x.main + x.code + x.hw));
  chk(mt && !/^未收录/.test(mt.chipTxt), '[线上] ③ ★ 本地查不到的那台已被联网补全（不再是「未收录」）',
    mt ? `${mt.chipTxt}  [${mt.chipCls}]` : '(未找到)');
  chk(mt && /(^|\s)ol(\s|$)/.test(mt.chipCls) && mt.hasNetTag,
    '[线上] ③ 该徽标是**靛蓝联网款** + 带「网」角标（来源可追溯）', mt ? mt.chipCls : '(未找到)');
  chk(r.gateN >= 1 && !!r.legend && r.legend.inH4,
    '[线上] 门槛已并入行内橙色徽标 + 表头图例（旧小结行已删）',
    `gtag ${r.gateN} 个 / 图例 ${r.legend ? `「${r.legend.txt}」${r.legend.inH4 ? '在表头 h4' : '★ 位置不对'}` : '无'}`);
  chk(!/未收录芯片/.test(r.blkTxt), '[线上] 旧文案「未收录芯片」已消失（改为「暂无芯片规格」）');

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
