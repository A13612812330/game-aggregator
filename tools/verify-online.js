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
/* 这一版必须出现在页面上的特征串（漏一个就说明线上是旧包）
 * ⚠️ 只写「**首页 index.html** 上能看到的串」——派生页（emulator / unpack）的串（如 dmCard）
 *    不在首页里，写进来必然失败。
 * ⚠️ 新增串**必须先在本地 `public/index.html` 里验证存在**（见下方 LOCAL_MISSING 自检）：
 *    本地都没有的串区分不了新旧版本，只会把任何线上包都判成旧包 —— 假红。
 *    （2026-09-20 立此规矩：`tools/audit-apps.js` 的门禁就是这样过期的，见该文件 ③-b 段。） */
const MUST = [
  'bhHwSlot', 'toggleDevHardware', 'data-hw', 'hasDetailUrl', 'd-hw .kvs2',
  /* ---- v10.18：三要素徽标 + 门槛并入行内 + 未收录联网补全 ---- */
  'chipHtml', 'chipShort', 'chipTag', '.chip.ol', '联网查询中', 'gtag', 'd-devlist-lg',
  /* ---- v10.19：模拟器指南模块导航 ---- */
  'eg-nav',
  /* ---- v10.24：机型兼容 / 解包统一卡片（占位块 + 图片 404 兜底） ---- */
  'covAbbr', '.emu-card .cov.ph{', 'window.covErr = covErr',
  /* ---- v10.29：详情页三处收口 ----
   * ⚠️ 这四条都实测「本地有 / 线上 v10.28 为 0 次」，才拿来做区分（2026-09-21 实测）：
   *      本地 3 / 3 / 6 / 3 次   vs   线上 0 / 0 / 0 / 0 次。
   * ★ 别把 `d-pair` 写进来：线上 v10.28 **也有 2 次**，区分不了新旧（写了等于白写）。
   * ★ 也别只写 `df-tab`：线上 v10.28 已有 8 次（v10.28 就上了 tab）。 */
  'galLbStep', 'compareDocumentPosition', 'd-more-hd', '评分参数',
  /* ---- v10.30：置顶改「恒高小条」+ 卡片统一变量 ----
   * ★ 这三条实测「v10.29 为 0 次 / v10.30 为 13 / 5 / 2 次」才拿来用 ——
   *   基准取 `git show HEAD~2:public/index.html`（= v10.29），
   *   ⚠️ 别取 `HEAD~1`：v10.30 的功能提交在 `HEAD~1`，拿它比等于**拿 v10.30 比自己**
   *   （2026-09-21 实际踩过，六个候选串全判成「不可用」）。
   * ★ 也别写 `dHeroSpy`：v10.29 与 v10.30 都是 4 次，区分不了新旧（写了等于白写）。 */
  'd-mini', '--cd-t2', 'MINI_GAP',
  /* ---- v10.31：详情页四条体验修正（顶图去动画 / 顶图同源 / 固定五个 / 同类卡统一）----
   * ★ 三条实测「v10.30 为 0 次 / v10.31 为 4 / 4 / 1 次」才拿来用。
   *   基准 = `git show HEAD~1:public/index.html`（当前 HEAD 是 v10.31 提交 ⇒ HEAD~1 就是 v10.30，
   *   导出后 md5 应为 `5b24a89b8e95a59c7e47a0aa0a1fad31`，可先核对再采信下面的数字）。
   * ★ **别写 `object-fit:contain`（v10.30 已有 1 次）也别写 `align-items:stretch`（v10.30 已有 3 次）** ——
   *   旧版本来就有的串区分不了新旧，写进去等于白写（本文件的判定是 `includes`，只看「有没有」）。
   * ★ 也别写 `d-row-h` 以外的短串如 `d-rows`：与 `--d-row-h` 同生同灭，重复计入无意义。 */
  '--d-row-h', 'REL_SHOW', 'Math.max(60, hero.offsetHeight)',
  /* ---- v10.32：定位条合并 + 跳转避让小条 + 底部文案三行 ----
   * ★ 实测「v10.31 为 0 次 / v10.32 为 1 次」才拿来用。
   *   基准 = `git show b9dc2c7:public/index.html`（= 线上那一版 v10.31），
   *   **导出后先核 md5 应为 `2cc4756045cce4459a6d1221662cde23`** 再采信计数
   *   （v10.30 那次误取 HEAD~1 = 自己，六个候选串全判「不可用」，已踩过）。
   * ★ `{ k: 'trsv'` 精确到键名带引号，避免命中派生页里别处的 `trsv` 字样。
   * ★ **别写 `修改器/云存档`**：v10.31 **已经有 1 次**（v10.29 就写进注释了）⇒ 区分不了新旧。
   * ★ **别写 `文件放到<b>游戏安装根目录</b>`**：v10.31 已有 1 次；要判 v10.32 的文案改动，
   *   得用**新文案独有的那半句**（下面两条分别对应修改器 / 云存档两块）。 */
  "{ k: 'trsv'", 'const cover = raw >= heroH', 'raw - cover - gap',
  '启动前先运行 Cheat Engine', '是占位符。<br>',
];

/* ★ MUST 自检：本地首页都没有的串不可能区分新旧版本，只会制造假红 */
const LOCAL_MISSING = (() => {
  try {
    const loc = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    return MUST.filter((k) => !loc.includes(k));
  } catch (e) { return []; }
})();

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

  /* ---- ★ v10.32 第 ③ 条：配置要求的「双语名称搜索」只在 `data/pcreq.js` 里，
     页面特征串**抓不到它**（首页 HTML 里没有这些函数名）⇒ 必须直接打接口验。
     样本 = 上一轮实测「中文段 0 结果、靠英文段救回」的那款。 */
  const pr = await api('/api/pcreq?t=' + encodeURIComponent('生化危机9：安魂曲/Resident_Evil_Requiem'));
  const prOK = pr.s === 200 && pr.j && pr.j.hit && String(pr.j.appid || '') === '3764200';
  chk(prOK, '[接口] ★ v10.32 ③ 双语名称搜索已上线（中文段搜不到时靠英文段救回）',
    pr.j ? ('hit=' + pr.j.hit + ' appid=' + pr.j.appid + ' name=' + (pr.j.name || '') +
      ' 最低配置=' + (pr.j.min ? '有' : '无') + ' 推荐配置=' + (pr.j.rec ? '有' : '无')) : 'status ' + pr.s);
  const pst = await api('/api/pcreq/stats');
  /* ★ `searchKeys` 是 v10.32 新增字段：把「按名称搜出来的缓存键（q:）」与 appid 键**分开计数**。
     没有它 ⇒ 「收录多少款」会把搜索负缓存也算进去而虚高。字段在 = pcreq.js 新版在。 */
  chk(pst.s === 200 && pst.j && pst.j.ok && 'searchKeys' in pst.j,
    '[接口] ★ v10.32 ③ 缓存统计已分列 `searchKeys`（name 命中的键不再混进「收录款数」）',
    pst.j ? ('cached ' + pst.j.cached + ' / withReq ' + pst.j.withReq + ' / miss ' + pst.j.miss +
      ' / searchKeys ' + pst.j.searchKeys) : 'status ' + pst.s);

  /* ---- ★ v10.39 补：派生页**逐字节**比对（此前派生页线上状态无人看管）----
     为什么必须补：
       · 首页那套 `MUST` 判的是「**某个串在不在**」，而 v10.33~v10.39 这一整类版本
         **前端 index.html 一字未改**（改动全在 `data/**` 与 `tools/**`）⇒ 对它结构性失明；
       · 派生页（emulator / unpack）此前**完全没有判据**（本文件上方注释即写明
         「只写首页能看到的串」），v10.39 恰好改了 `public/unpack.html` ⇒ 改了个看不见的地方。
     判据口径：不比特征串，直接比**线上与本地的字节**（md5）。
       · 零维护 —— 不用随版加串，也就不会像 `audit-apps.js` 的门禁那样过期；
       · 对派生页的**任何**改动都敏感，包括纯样式位移。
     ★ 判据语义 = 「线上派生页与本地逐字节相同」。**未发布时它会红，这是正确的红**
       （不是判据坏了）；v10.32 发布后三页 md5 曾全部相等，证明该口径可达。 */
  const md5hex = (s) => require('crypto').createHash('md5').update(s).digest('hex');
  for (const pg of ['emulator.html', 'unpack.html']) {
    let body = null, st = 0;
    try {
      const rr = await fetch(BASE + pg + '?cb=' + Date.now());
      st = rr.status;
      body = await rr.text();
    } catch (e) { /* 网络失败：下面按 status/空处理 */ }
    let loc = null;
    try { loc = fs.readFileSync(path.join(__dirname, '..', 'public', pg), 'utf8'); } catch (e) { /* 本地缺文件 */ }
    if (body == null || loc == null) {
      chk(false, `[页面] ${pg} 线上可拉到且本地存在`, body == null ? '拉取失败 status ' + st : '本地缺 public/' + pg);
      continue;
    }
    const om = md5hex(body), lm = md5hex(loc);
    chk(om === lm, `[页面] ${pg} 线上与本地**逐字节一致**`,
      om.slice(0, 10) + ' vs ' + lm.slice(0, 10) + (om === lm ? '' : '  ← 线上是旧版（该页未发布）'));
  }

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
  chk(missing.length === 0, '[页面] 线上首页含全部特征串（v10.14~v10.32）', missing.length ? '缺：' + missing.join(', ') : MUST.length + ' 项齐');
  chk(LOCAL_MISSING.length === 0,
    '★ MUST 每一项在**本地首页**里都存在（本地没有的串区分不了新旧，只会假红）',
    LOCAL_MISSING.length ? '本地缺：' + LOCAL_MISSING.join(', ') : MUST.length + ' 项');

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
      /* ★ v10.28：全量入口从「区块内联的 .dv.more 行」改成独立槽位 `#bhMoreSlot`
         —— 后者对「机型清单为空、但有本站实测 / 逐条参数」的游戏**也给入口**。 */
      moreTxt: (document.querySelector('#bhMoreSlot .d-more-btn') || {}).textContent || '',
      blkTxt: ((document.querySelector('#bhDevSlot') || {}).innerText || '').replace(/\s+/g, ' '),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  /* ★ v10.28 语义变更（**预期变更，不是退化**）：详情页手机配置**默认只渲染 5 台**
     （`DL_DEV_SHOW = 5`），全量搬进「查看全部 N 台机型」弹窗。
     ⇒ 旧断言「首屏 ≥ 9 台」已失效。但它守的**意图**必须保留：
       「展示的是并集全量，不是上游摘要那个 6 台上限」。
     改法：① 首屏 == 5 台 ② 入口文案标出的总数 ≥ 9 ③ **真点开弹窗**数里面的行 ≥ 9。
       ★ 只有 ③ 等价于旧断言的口径（用户确实看得到全量）；①② 只是「入口还活着」。
     ⚠️ 判据先过本地自检：同口径的本地版在 `tools/preview-v1028.js`（打 127.0.0.1:8123）。
        线上红了先跑本地那条 —— 本地也红就是代码坏了，不是线上旧版（假红）。 */
  chk(r.n === 5, '[线上] 首屏机型 = 5 台（v10.28 默认展示数）', r.n + ' 台');
  const moreTotal = Number((r.moreTxt.match(/查看全部\s*(\d+)\s*台/) || [])[1] || 0);
  chk(moreTotal >= 9, '[线上] ★ 存在「查看全部 N 台机型」入口且 N ≥ 9（不是上游摘要 6 台上限）',
    r.moreTxt.trim().replace(/\s+/g, ' ') || '(没有入口)');
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

  /* ---- ④ ★ v10.28：点开「查看全部」弹窗，数里面的机型行 ----
     这才是旧断言「机型清单 ≥ 9 台」的真口径：用户确实能一次看全，
     而不是「首屏少了几台 = 数据被截断」。 */
  await p.evaluate(() => {
    const mb = document.querySelector('#bhMoreSlot .d-more-btn');
    if (mb) mb.click();
  });
  const popOk = await p.waitForFunction(
    () => document.querySelectorAll('#dlBody .df-row').length > 0,
    { timeout: 90000 },
  ).then(() => true).catch(() => false);
  const popN = await p.evaluate(() => document.querySelectorAll('#dlBody .df-row').length);
  chk(popOk && popN >= 9, '[线上] ★ 弹窗里能一次看到全部 ≥ 9 台机型（旧「≥ 9 台」的真口径）', popN + ' 台');
  await p.screenshot({ path: path.join(OUT, 'live-fullpop.png') });

  for (const pg of await b.pages()) { try { await pg.close(); } catch (x) {} }
  await b.close();

  console.log('\n' + '='.repeat(58));
  console.log(`线上验收：${pass} / ${pass + fail} 通过` + (fail ? `，${fail} 失败` : ''));
  console.log('截图：_preview/live-devs.png、_preview/live-hw.png、_preview/live-fullpop.png');
  if (fail) process.exitCode = 1;
})().catch((e) => { console.error('运行失败：', e.message); process.exit(1); });
