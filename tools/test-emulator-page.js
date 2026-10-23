/* 手机专区「独立页」端到端回归 —— 首页入口 + /emulator.html 三段式（手游中心 / 机型兼容 / 模拟器指南）
 *
 * ★ v10.44：MOD / 存档 / 修改器 已从本页平级抽出，独立成 /resources.html
 *   （用户口径：「手游的样式更新下，也需要划分模块 MOD，存档，修改器，
 *             手机专区保留手机中心 + 机型兼容 + 模拟器指南」）。
 *   ⇒ 本页回到 3 页签；原「修改器 / 云存档」两组用例整体迁往 tools/test-resource-page.js。
 *   本文件保留一组**反向断言**（本页不该再有 #trainers/#saves/tr/sv 页签），
 *   防的是「用例删了、功能又漂回来」这种反向退化。
 *
 * 为什么用 jsdom：沙箱里 Chrome/Edge headless 起不来，本次要验的恰好是纯 DOM 行为
 * （顶栏 href、回首页出口唯一、子页签 .et-hide 切换、二级切换条、深链 bootTab、
 *   封面渲染、点击分流、默认筛选开关），jsdom 足够且更快。
 *
 * 运行：node tools/test-emulator-page.js
 * 前置：服务已在 8123 端口运行（node server.js）
 */
const { JSDOM, VirtualConsole } = require('jsdom');

const BASE = 'http://127.0.0.1:8123';
const results = [];
const ok = (n, c, extra) => { results.push([c, n, extra || '']); return c; };

/* ---- 关键坑：beforeParse 阶段 w.fetch 尚未定义，且解构出 fetch 会丢 this ---- */
const nativeFetch = globalThis.fetch;

function nvc() {
  const vc = new VirtualConsole();
  const errs = [];
  vc.on('jsdomError', (e) => {
    const m = String(e.message || e);
    if (!/Could not load/.test(m)) { errs.push(m); console.error('[jsdom]', m); }
  });
  return { vc, errs };
}

/* ★ v10.111：等「页面自己说准备好了」，不要猜 1800ms。
   五张页面（index / emulator / resources / unpack / extract）的 init() 末尾都会
   `document.documentElement.setAttribute('data-ready','1')` —— 那才是可靠的完成信号。
   固定 1800ms 有两个方向的错，本版全量跑同时踩到了后一个：
     · 争抢时 init 还没跑完就开始断言 ⇒ 假红（数据类断言是空的）；
     · 更糟：断言段落跑完 `home.window.close()` 了，init 的 await 才回来 ⇒
       `document` 已随窗口销毁 ⇒ `TypeError: ... reading 'documentElement'`，整套 exit=1。
     日志里那句 `at init (http://127.0.0.1:8123/:5097:12)` 就是它 —— 不是页面坏了。
   ★ 与 v10.110 修「机型匹配结果已渲染」那条是同一个病（铁律 221），
     区别只是这次等的是**页面级就绪**，不是**一段数据**。 */
async function waitReady(dom, limit = 20000) {
  const t0 = Date.now();
  for (;;) {
    let el = null;
    try {
      el = dom.window && dom.window.document && dom.window.document.documentElement;
    } catch {
      el = null; /* 窗口已被 close()：按超时处理，而不是抛出去 */
    }
    if (el && el.getAttribute('data-ready') === '1') {
      /* ready 之后的收尾渲染（列表 / 榜单 / 卡片）再给一点余量，别把 ready 当「全都画完了」 */
      await new Promise((r) => setTimeout(r, 250));
      return Date.now() - t0;
    }
    if (Date.now() - t0 >= limit) return -1;
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function makeDom(url) {
  const html = await fetch(url).then((r) => r.text());
  const { vc, errs } = nvc();
  const dom = new JSDOM(html, {
    url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      const raw = w.fetch;
      w.fetch = function (u, o) {
        const real = raw || nativeFetch;
        return real.call(w, String(u).startsWith('http') ? String(u) : BASE + u, o);
      };
      w.scrollTo = () => {};
      w.Element.prototype.scrollIntoView = function () {};
      w.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
    },
  });
  const readyMs = await waitReady(dom);
  return { dom, errs, readyMs };
}

async function main() {
  /* ============================================================
   * 一、首页：手机专区必须变成「独立页入口」而不是内联分区
   * ============================================================ */
  const { dom: home, errs: homeErrs, readyMs: homeReady } = await makeDom(BASE + '/');
  const w = home.window;
  const $ = (s) => w.document.querySelector(s);
  const $$ = (s) => [...w.document.querySelectorAll(s)];

  /* ★ 先证明「它真的初始化完了」，再谈别的：-1 = 20s 内没 ready。
     这条红了不要顺着往下看别的红 —— 下面全是它的下游。 */
  ok('首页在 20s 内跑到 data-ready（不是靠猜固定等待）', homeReady >= 0,
    homeReady >= 0 ? 'ready ' + homeReady + 'ms' : '20s 超时，init 没跑完');
  ok('首页运行无 JS 异常', homeErrs.length === 0, homeErrs[0] || '');
  ok('首页只剩 1 个 <main>（手机三分区已迁出）', $$('main').length === 1, `实际 ${$$('main').length}`);
  ok('首页已无 #phonecfg / #emuguide 内联分区', !$('#phonecfg') && !$('#emuguide'));
  /* v9 三段式：首页不再放手机专区引导卡（按需求移除跳转块），入口只留顶栏 + 底部 Tab */
  ok('首页已移除引导卡 #emuHub', !$('#emuHub'));
  ok('首页已无任何 /emulator.html 的内联分区残留', !$('#emulator') && !$('#devmatch'));

  // v10.20：顶栏由 2 个入口增为 3 个（新增「📦 解包匹配」），导航是共享资产故两页同步
  // v10.44：再增第 4 个「🎮 端游资源」→ /resources.html（MOD / 存档 / 修改器 独立成页），
  //         手机专区随之收缩为 3 页签，故本文件的 tr/sv 用例整体迁往 test-resource-page.js
  // v10.71：再增第 5 个「🗜️ 解压助手」→ /extract.html（下载直链的递归解压 + 拖放工具）。
  const navLinks = $$('.main-nav a');
  ok('顶栏有 5 个入口（首页 / 手机专区 / 端游资源 / 解包匹配 / 解压助手）', navLinks.length === 5, `实际 ${navLinks.length}：${navLinks.map((a) => a.textContent.trim()).join(' / ')}`);
  ok('顶栏含第 4 条「端游资源」#navRes → /resources.html',
    !!$('#navRes') && $('#navRes').getAttribute('href') === '/resources.html',
    $('#navRes') ? $('#navRes').getAttribute('href') : '(缺失)');
  ok('顶栏顺序为 首页 → 手机专区 → 端游资源 → 解包匹配 → 解压助手',
    navLinks.map((a) => a.id).join(',') === 'navHome,navEmu,navRes,navUnpack,navEx',
    navLinks.map((a) => a.id).join(','));
  ok('顶栏含第 5 条「解压助手」#navEx → /extract.html',
    !!$('#navEx') && $('#navEx').getAttribute('href') === '/extract.html',
    $('#navEx') ? $('#navEx').getAttribute('href') : '(缺失)');
  ok('顶栏第四条是「解包匹配」#navUnpack → /unpack.html',
    !!$('#navUnpack') && $('#navUnpack').getAttribute('href') === '/unpack.html',
    $('#navUnpack') ? $('#navUnpack').getAttribute('href') : '(缺失)');
  ok('顶栏第一个是「首页」#navHome', !!$('#navHome'), ($('#navHome') || {}).textContent || '(缺失)');
  const navEmuEl = $('#navEmu');
  ok('顶栏「手机专区」→ /emulator.html（不带 hash，落默认页签）',
    !!navEmuEl && navEmuEl.getAttribute('href') === '/emulator.html',
    navEmuEl ? navEmuEl.getAttribute('href') : '(缺失)');
  ok('顶栏已无 navRank / navLatest / navPc / navEg / navDm 旧入口',
    !$('#navRank') && !$('#navLatest') && !$('#navPc') && !$('#navEg') && !$('#navDm'));

  /* 底部 Tab：手机相关只保留 1 个入口「手机专区」（页内再分子页签），直达独立页 */
  const tabEmuEl = $('#tabEmu');
  ok('底部 Tab 只剩 1 个手机入口 tabEmu → /emulator.html#emu',
    !!tabEmuEl && tabEmuEl.getAttribute('href') === '/emulator.html#emu',
    tabEmuEl ? tabEmuEl.getAttribute('href') : '(缺失)');
  ok('底部 Tab 已无 tabPc / tabEg / tabDm（收进独立页子页签）',
    !$('#tabPc') && !$('#tabEg') && !$('#tabDm'));
  /* ★ v10.44：底 Tab 新增「端游资源」入口。**故意不挂 data-tab** ——
   *   主脚本用 closest('a[data-tab]') 拦截，挂了就会被当页内切换而 preventDefault、
   *   跳不出去。这里锁的就是「它是真链接」。 */
  const tabResEl = $$('#tabbar a').find((a) => a.getAttribute('href') === '/resources.html');
  ok('底部 Tab 新增「端游资源」真链接 → /resources.html',
    !!tabResEl, tabResEl ? tabResEl.textContent.trim() : '(缺失)');
  ok('底部「端游资源」入口不带 data-tab（否则被主脚本拦成页内切换，跳不出去）',
    !!tabResEl && !tabResEl.hasAttribute('data-tab'),
    tabResEl ? ('data-tab=' + tabResEl.getAttribute('data-tab')) : '(缺失)');
  ok('首页底部 Tab 仍为 5 个 data-tab 项（端游资源不进 data-tab 计数）',
    $$('#tabbar a[data-tab]').length === 5, `实际 ${$$('#tabbar a[data-tab]').length}`);

  // 首页不应再残留手机专区的重函数
  const homeJs = $$('script').map((s) => s.textContent).join('\n');
  ok('首页已无 switchEmuTab / loadPc / initEg 残留',
    !/function\s+switchEmuTab/.test(homeJs) && !/function\s+loadPc/.test(homeJs) && !/function\s+initEg/.test(homeJs));
  ok('首页保留 goEmuPage 跳转函数', /function\s+goEmuPage/.test(homeJs));

  home.window.close();

  /* ============================================================
   * 二、独立页 /emulator.html：默认社区配置
   * ============================================================ */
  const { dom: d1, errs: e1 } = await makeDom(BASE + '/emulator.html');
  const W = d1.window;
  const q = (s) => W.document.querySelector(s);
  const qa = (s) => [...W.document.querySelectorAll(s)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const click = (el) => el.dispatchEvent(new W.MouseEvent('click', { bubbles: true, cancelable: true }));
  /* ★ v10.111：有界轮询小工具。全量跑时 CPU 争抢，写死的等待秒数会时灵时不灵 ——
     v10.110 在这文件里改过两处（机型匹配、社区配置），本版又撞上第三处（点卡片开抽屉）。
     统一用这个：**有出现就往下走，超时返回 -1 让断言照旧红**，耗时打进详情。 */
  const waitUntil = async (fn, ms = 30000) => {
    const t0 = Date.now();
    for (;;) {
      let hit = false;
      try { hit = !!fn(); } catch { hit = false; }
      if (hit) return Date.now() - t0;
      if (Date.now() - t0 >= ms) return -1;
      await sleep(120);
    }
  };

  ok('独立页运行无 JS 异常', e1.length === 0, e1[0] || '');
  /* v9.3：实测配置已并入手游中心，分区由 4 个减为 3 个 */
  ok('独立页三个分区 DOM 都在', !!(q('#emulator') && q('#emuguide') && q('#devmatch')));
  ok('独立页已无 #phonecfg（实测配置已并入手游中心）', !q('#phonecfg'));
  /* ★ v10.2：回首页的出口只保留**顶栏一个** —— 页内不再有第二个「← 返回聚合首页」按钮。
   * 前提是顶栏那份导航在独立页得真的能用：href="/" 真跳转 + 高亮落在「手机专区」。
   * （此前 href="#rankStage" 是死锚点、又被共用脚本 preventDefault 成「回顶部」，
   *   点了没反应，才被迫在页内另加一个按钮。） */
  ok('独立页页内不再有第二个「返回聚合首页」按钮',
    !q('.page-back a') && !/返回聚合首页/.test((q('.page-back') || {}).textContent || ''));
  const navHome = q('#navHome'), navEmu = q('#navEmu');
  ok('独立页顶栏「首页」是真跳转回聚合首页（href="/"）',
    !!navHome && navHome.getAttribute('href') === '/',
    navHome ? navHome.getAttribute('href') : '(缺失)');
  ok('独立页顶栏高亮落在「手机专区」上（首页不抢高亮）',
    !!navEmu && navEmu.classList.contains('on') && !!navHome && !navHome.classList.contains('on'));
  /* v9.3：**一条切换条**（「手游中心」合并了原「手游可玩」+「实测配置」）
   * v10 ：曾新增「修改器」「云存档」，共 5 个平级页签
   * v10.13：用户要求「模拟器指南放在最后一个」→ eg 从第 4 位挪到末位
   * ★ v10.44：tr/sv 搬去 /resources.html（用户：三类是端游资源），本页回到 **3 个平级页签**
   *           顺序 = 内容(emu) → 工具(dm) → 指南(eg) */
  ok('独立页切换条 #emuTabs 有 3 个平级页签', qa('#emuTabs .emu-tab').length === 3, `实际 ${qa('#emuTabs .emu-tab').length}`);
  const tabDefs = ['emu', 'dm', 'eg'];
  ok('三个页签 data-et 依次为 emu/dm/eg',
    qa('#emuTabs .emu-tab').map((b) => b.dataset.et).join(',') === tabDefs.join(','),
    qa('#emuTabs .emu-tab').map((b) => b.dataset.et).join(','));
  ok('第 1 个页签是「手游中心」', /手游中心/.test((qa('#emuTabs .emu-tab')[0] || {}).textContent || ''),
    (qa('#emuTabs .emu-tab')[0] || {}).textContent || '(缺失)');
  ok('第 2 个页签是「机型兼容」', /机型兼容/.test((qa('#emuTabs .emu-tab')[1] || {}).textContent || ''),
    (qa('#emuTabs .emu-tab')[1] || {}).textContent || '(缺失)');
  ok('第 3 个页签是「模拟器指南」', /模拟器指南/.test((qa('#emuTabs .emu-tab')[2] || {}).textContent || ''),
    (qa('#emuTabs .emu-tab')[2] || {}).textContent || '(缺失)');
  /* ★ v10.44：已搬家的两个页签必须彻底绝迹 —— 留着就是点不动的死页签
   *   （tr/sv 已不在本页 ET_MAP 里，switchEmuTab 会直接 return）。 */
  ok('切换条已无「修改器」页签（tr 已搬 /resources.html）',
    !q('#emuTabs .emu-tab[data-et="tr"]'));
  ok('切换条已无「云存档」页签（sv 已搬 /resources.html）',
    !q('#emuTabs .emu-tab[data-et="sv"]'));
  /* ★ v9.1 核心修复：二级切换条必须彻底删除 —— 它原先常驻显示，
     在非「兼容·指南」页签上点了没反应，就是用户说的「并没有交互」。 */
  ok('二级切换条 #egSubbar 已彻底移除', !q('#egSubbar'));
  ok('页面已无 .eg-sub 元素残留', qa('.eg-sub').length === 0, `实际 ${qa('.eg-sub').length}`);
  ok('默认只显示手游中心（其余带 et-hide）',
    !q('#emulator').classList.contains('et-hide') && q('#emuguide').classList.contains('et-hide') && q('#devmatch').classList.contains('et-hide'));
  ok('共享顶栏 / 抽屉 / tabbar 已带上',
    !!q('.topbar') && !!q('#drawer') && !!q('#mask') && !!q('.tabbar'));
  /* 派生页不应残留只在主源声明的常量（坑 3：派生页缺主源依赖 → 顶部绑定整段抛错） */
  const emuJs = qa('script').map((s) => s.textContent).join('\n');
  ok('派生页无 EMU_PAGE_HREF 残留（否则 Tab 绑定会 ReferenceError）', !/EMU_PAGE_HREF/.test(emuJs));

  /* ---- 默认筛选：手游中心「仅看匹配端游」开启（用户诉求：默认显示跟端游匹配的） ---- */
  ok('「手游中心」默认开启「仅看匹配端游」', !!q('#emuToggleLib') && q('#emuToggleLib').classList.contains('on'),
    q('#emuToggleLib') ? q('#emuToggleLib').textContent.trim() : '(缺失开关)');
  /* ★ v10.5：开关状态**不进文案**。旧版切到开启会把文案改成「…（已开）」（宽 +28px）
   *   把后面那颗开关挤到下一行 —— 用户反馈的「点『仅看匹配端游』，『只看双料』自动换行」。
   *   现在文案恒定，状态只靠 .on 类 + CSS 定宽伪元素（.em-tg::before）表达。
   *   jsdom 读不到 ::before 的 content（不做伪元素级联），所以这里只守「文案恒定 + .on 正确」，
   *   几何宽度由 tools/test-filter-layout.js 真跑浏览器量。 */
  ok('「仅看匹配端游」开启时文案恒定（不含 ✓/○/「（已开）」这类状态字）',
    (() => { const t = q('#emuToggleLib') ? q('#emuToggleLib').textContent : ''; return !/[✓○已开]/.test(t); })(),
    q('#emuToggleLib') ? q('#emuToggleLib').textContent.trim() : '(缺失)');
  /* 四个筛选开关都在（v10.5 新增「有修改器 / 有云存档」） */
  ok('手游中心筛选行有 4 个开关（匹配端游 / 双料 / 有修改器 / 有云存档）',
    ['emuToggleLib', 'emuToggleBoth', 'emuToggleTr', 'emuToggleSv'].every((id) => !!q('#' + id)),
    ['emuToggleLib', 'emuToggleBoth', 'emuToggleTr', 'emuToggleSv'].filter((id) => !!q('#' + id)).join(' / '));

  /* ---- ★ v10.4：顶栏搜索入口（曾因绑定埋在 bindRankUI 内而彻底失效） ---- */
  const smodal = q('#smodal'), sOpenBtn = q('#searchOpen');
  ok('独立页有顶栏搜索按钮 #searchOpen', !!sOpenBtn);
  ok('独立页搜索弹窗初始关闭（无 .show）', !!smodal && !smodal.classList.contains('show'));
  if (sOpenBtn) click(sOpenBtn);
  await sleep(200);
  ok('点顶栏搜索按钮 → 弹窗真的打开（.show）',
    !!smodal && smodal.classList.contains('show'),
    smodal ? smodal.className : '(缺失)');
  ok('弹窗打开后焦点落到 #searchInput',
    !!W.document.activeElement && W.document.activeElement.id === 'searchInput',
    W.document.activeElement ? W.document.activeElement.id : '(none)');
  /* 再点一次关回去，别影响后续断言 */
  const smClose = q('#smClose') || q('#smask');
  if (smClose) click(smClose); else if (smodal) smodal.classList.remove('show');
  await sleep(120);
  ok('关闭后弹窗回到关闭态', !!smodal && !smodal.classList.contains('show'));

  /* ---- 手游中心：合并列表渲染（社区库 + 实测库 一张表） ---- */
  const emuCards = qa('#emuGrid .emu-card');
  const emuCov = qa('#emuGrid .emu-card.has-cov');
  ok('手游中心卡片已渲染', emuCards.length > 0, `共 ${emuCards.length} 张`);
  ok('默认只显示匹配端游的（全部卡片都有 data-lib）',
    emuCards.length > 0 && emuCards.every((c) => !!c.dataset.lib),
    `带 data-lib 的 ${emuCards.filter((c) => c.dataset.lib).length} / ${emuCards.length}`);
  ok('合并卡片命中端游库 → has-cov + 封面', emuCov.length > 0 && !!emuCov[0].querySelector('.cov img'), `命中 ${emuCov.length} 张`);
  ok('合并卡片带「配置数」pill', emuCards.some((c) => /套配置/.test(c.textContent)), '');
  /* 帧率 pill 只在有实测的条目上出现（合并后配置数与实测帧率同卡展示） */
  ok('手游中心出现「实测帧率」pill（有实测的条目）',
    qa('#emuGrid .pill.fps').length > 0, `实际 ${qa('#emuGrid .pill.fps').length} 个`);
  ok('手游中心出现「来源徽标」', qa('#emuGrid .tg.src').length > 0, `实际 ${qa('#emuGrid .tg.src').length} 个`);

  if (emuCov.length) {
    click(emuCov[0].querySelector('.cov-btn'));
    /* ★ v10.112：sleep(1200) → 等抽屉真的开且内容到位（全量跑时同一批断言会一起红） */
    const drawerWait = await waitUntil(() =>
      q('#drawer').classList.contains('show') && (q('#drawerBody').textContent || '').trim().length > 10);
    ok('点「查看游戏详情」→ 打开详情抽屉', q('#drawer').classList.contains('show'),
      `等待 ${drawerWait < 0 ? '超时 30000ms' : drawerWait + 'ms'}`);
    ok('抽屉不空白', (q('#drawerBody').textContent || '').trim().length > 10);
    W.closeDetail(); await sleep(200);
  }
  /* ★ v10.5 点击语义统一：**有端游库命中就进游戏详情**
   *   旧逻辑让「社区仓库键(bhk)」优先于「端游库命中(libId)」，
   *   于是「既命中库、又有社区配置」的卡片点正文进的是社区配置面板，
   *   用户反馈为「点了不是游戏详情页」。 */
  const bothCard = qa('#emuGrid .emu-card').find((c) => c.dataset.lib && c.dataset.bhk);
  if (bothCard) {
    click(bothCard);
    /* ★ v10.111：原来写死 sleep(1300)。全量跑争抢时抽屉还没 show ⇒ 假红
       （实测这一条在 85 套串行里红了两次，单跑必绿）。改成等「抽屉真的开了」。 */
    const dWait = await waitUntil(() => q('#drawer') && q('#drawer').classList.contains('show'));
    ok('「既命中端游库又有社区配置」的卡片点正文 → 进游戏详情（不再被配置面板截走）',
      q('#drawer').classList.contains('show') && !q('#drawerBody .cf-table'),
      dWait < 0 ? '12s 抽屉未打开' : '抽屉 ' + dWait + 'ms');
    ok('这类卡片上另有一颗独立的「社区配置」按钮', !!bothCard.querySelector('.cfg-btn'));
    W.closeDetail(); await sleep(300);
    click(bothCard.querySelector('.cfg-btn'));
    /* ★ v10.111：同上，等面板真的渲染出来而不是猜 1100ms。 */
    const cfgWait = await waitUntil(() => q('#drawerBody .cf-table'));
    ok('点「📋 社区配置」按钮 → 才打开社区配置面板',
      q('#drawer').classList.contains('show') && !!q('#drawerBody .cf-table'),
      cfgWait < 0 ? '12s 未出现 .cf-table' : '面板 ' + cfgWait + 'ms');
    W.closeDetail(); await sleep(250);
  }

  /* ---- 关掉「仅看匹配端游」→ 应出现未匹配端游库的条目（列表变长） ---- */
  const nMatched = qa('#emuGrid .emu-card').length;
  click(q('#emuToggleLib'));
  await sleep(1500);
  ok('关掉「仅看匹配端游」后列表刷新', qa('#emuGrid .emu-card').length > 0);
  ok('关掉后文案不变（状态仍只靠 .on 类表达，按钮宽度恒定）',
    !/[✓○已开]/.test(q('#emuToggleLib').textContent) && !q('#emuToggleLib').classList.contains('on'),
    q('#emuToggleLib').textContent.trim());
  click(q('#emuToggleLib'));  // 复原
  await sleep(1200);

  /* ---- ★ v10.5 新增的两个横切筛选：有修改器 / 有云存档 ---- */
  {
    const n0 = qa('#emuGrid .emu-card').length;
    click(q('#emuToggleTr'));
    await sleep(1600);
    const nTr = qa('#emuGrid .emu-card').length;
    ok('点「🛠 有修改器」→ 开关进入活跃态且列表刷新',
      q('#emuToggleTr').classList.contains('on') && nTr > 0, `卡片 ${n0} → ${nTr}`);
    /* 留下的每张卡都该带 has-tr 角标（否则用户不知道它为什么被留下） */
    ok('「有修改器」筛出的卡片都带 🛠 角标',
      qa('#emuGrid .emu-card .tg.has-tr').length === qa('#emuGrid .emu-card').length,
      `${qa('#emuGrid .emu-card .tg.has-tr').length} / ${qa('#emuGrid .emu-card').length}`);
    /* 切开关不应改变按钮宽度 —— 这正是「换行」的根因 */
    const wTr = q('#emuToggleTr').getBoundingClientRect().width;
    click(q('#emuToggleTr')); await sleep(1200);
    const wTr2 = q('#emuToggleTr').getBoundingClientRect().width;
    ok('切换「有修改器」前后按钮宽度不变（不再顶掉同排其它开关）',
      Math.abs(wTr - wTr2) <= 1, `${wTr.toFixed(1)} → ${wTr2.toFixed(1)}`);
    click(q('#emuToggleSv'));
    /* ★ v10.112：sleep(1600) → 等卡片真的出现（全量跑时这条红成「卡片 0」） */
    const svWait = await waitUntil(() => qa('#emuGrid .emu-card').length > 0);
    ok('点「💾 有云存档」→ 开关进入活跃态且列表有结果',
      q('#emuToggleSv').classList.contains('on') && qa('#emuGrid .emu-card').length > 0,
      `卡片 ${qa('#emuGrid .emu-card').length}（等待 ${svWait < 0 ? '超时 30000ms' : svWait + 'ms'}）`);
    click(q('#emuToggleSv'));  // 复原
    await sleep(1200);
  }

  /* ================= ★ v10.44：修改器 / 云存档 已迁出本页 =================
   * 用户口径：「手游的样式更新下，也需要划分模块 MOD，存档，修改器，
   *           手机专区保留手机中心 + 机型兼容 + 模拟器指南」。
   * ⇒ 两个页签连同分区骨架、驱动脚本、卡片断言**整体搬到 /resources.html**，
   *   对应用例见 tools/test-resource-page.js（那里测得更细：MOD 也是新写的）。
   *
   * ⚠️ 本文件之所以要显式留这段话、并显式断言「不存在」，是因为**少给一条断言
   *    比多给一条危险得多**：页签被删了但用例忘记删，用例会静默失去覆盖；
   *    而用例留着、页签被删，就会像本轮一样拿 null 直接崩（第 289 行原状）。
   *    所以这里既删用例，也把「已迁走」写成断言，双向钉住。
   */
  ok('本页已无 #trainers / #saves 分区（已迁 /resources.html）',
    !q('#trainers') && !q('#saves'));
  ok('本页已无修改器 / 云存档 / MOD 的任何骨架 id（不留空壳节点）',
    /* ⚠️ v10.47：id 清单必须用**当前真实存在**的那些。原先钉的 #trSource / #svPhone
       已随资源页改版消失（改成 #trSrc；svPhone 整个删掉）⇒ 那两条恒真、等于没守。
       这里换成三区各自的网格 / 来源下拉 / 计数 —— 任一漏过来就是整块骨架搬错页。 */
    ['trGrid', 'svGrid', 'mdGrid', 'trSrc', 'svSrc', 'mdSrc', 'trCount', 'svCount', 'mdCount']
      .every((i) => !q('#' + i)));

  /* ---- 直接切「模拟器指南」（第 3 个平级页签，不再经二级） ---- */
  click(q('#emuTabs .emu-tab[data-et="eg"]'));
  /* ★ v10.112：原来固定 sleep(1200)。全量跑时 data-ready 从 128ms 涨到 3863ms，
     同一批「数据类」断言会一起红（指南 0 层 / 品牌下拉 1 项 / Turnip 0 变体）。
     改成等目标节点真的出现 —— 等到就往下走，30s 不出现才判红。 */
  const egWait = await waitUntil(() => qa('#egStack .eg-ly').length === 5);
  ok('切「模拟器指南」→ #emuguide 显示', !q('#emuguide').classList.contains('et-hide'));
  ok('切「模拟器指南」→ #devmatch 同时收起', q('#devmatch').classList.contains('et-hide'));
  ok('切「模拟器指南」→ tab 高亮同步', (q('#emuTabs .emu-tab.on') || {}).dataset?.et === 'eg');
  ok('指南技术栈 5 层已渲染', qa('#egStack .eg-ly').length === 5,
    `实际 ${qa('#egStack .eg-ly').length} 层（等待 ${egWait < 0 ? '超时 30000ms' : egWait + 'ms'}）`);
  ok('子页签数字已回填（非占位 —）', !qa('#emuTabs .emu-tab b').some((b) => b.textContent.trim() === '—'),
    qa('#emuTabs .emu-tab b').map((b) => b.textContent.trim()).join(' / '));
  /* v9.3：机型兼容 tab 回填已索引机型数（v10.44 起它是第 2 个页签） */
  const dmNum = q('#tabNumDm');
  ok('「机型兼容」tab 数字已回填为真实机型数', !!dmNum && /^[\d,]+$/.test(dmNum.textContent.trim()),
    dmNum ? dmNum.textContent.trim() : '(缺失)');

  /* ---- 直接切「机型兼容」（第 2 个平级页签，v10.44 起） ---- */
  click(q('#emuTabs .emu-tab[data-et="dm"]'));
  /* ★ v10.112：固定 sleep(1600) → 等品牌下拉真的被填（同 egWait 的理由） */
  const dmBrandWait = await waitUntil(() => qa('#dmBrand option').length > 3);
  ok('切「机型兼容」→ #devmatch 显示、#emuguide 隐藏',
    !q('#devmatch').classList.contains('et-hide') && q('#emuguide').classList.contains('et-hide'));
  ok('切「机型兼容」→ tab 高亮同步', (q('#emuTabs .emu-tab.on') || {}).dataset?.et === 'dm');
  ok('品牌下拉已填充', qa('#dmBrand option').length > 3,
    `实际 ${qa('#dmBrand option').length} 项（等待 ${dmBrandWait < 0 ? '超时 30000ms' : dmBrandWait + 'ms'}）`);
  ok('Turnip 驱动看板已渲染', qa('#dmTurnip .dm-var').length >= 2, `实际 ${qa('#dmTurnip .dm-var').length} 个变体`);

  /* 触发一次匹配查询。
   * ★ v10.110 修正（铁律 221）：这里原来是固定 `await sleep(2200)`。
   *   单跑 100/100，进 `run-all --browser` 就红 2 条（「结果已渲染 实际 0 张」）——
   *   接口实测 12ms（`/api/device/match?model=SM-S928B&limit=300` ×3），
   *   所以不是接口慢，是**固定等待 + 全量串行时的 CPU 争抢**让回调排到 2.2s 之后。
   *   ⇒ 改「有界轮询」：出现卡片就立即往下走，最多等 12s；超时仍判红。
   *     轮询不是把失败等成绿 —— 上界到了还是 0 张就照旧报红。
   * ★★ v10.112 把上界 12s → **30s**：全量跑 86 套时实测 `data-ready` 从 128ms 涨到
   *   **3863ms**（30 倍），后续 9 条数据类断言（卡片 0 / 指南 0 层 / 品牌下拉 1 项 /
   *   Turnip 0 变体 / 机型匹配 0 张）一起红。单跑 101/101 必绿 ⇒ 是**负载**不是功能。
   *   12s 的目标是「够快报错」，但在被压满的机器上它先于数据到达 —— 30s 才有区分度。
   *   ⚠️ 仍然不是「等到绿」：30s 到了还是 0 就照旧红，超时值会打进断言详情。 */
  const waitCards = async (ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (qa('#dmGrid .emu-card').length > 0) return Date.now() - t0;
      await sleep(120);
    }
    return -1;
  };
  const dmInp = q('#dmInput');
  let dmWait = -1;
  if (dmInp) {
    dmInp.value = 'SM S928B';
    click(q('#dmGo'));
    dmWait = await waitCards(30000);
  }
  const dmGrid = q('#dmGrid');
  ok('机型匹配结果已渲染', dmGrid && qa('#dmGrid .emu-card').length > 0,
    `实际 ${dmGrid ? qa('#dmGrid .emu-card').length : 0} 张（等待 ${dmWait < 0 ? '超时 30000' : dmWait}ms）`);
  ok('结果头显示 GPU 与性能档', !!q('#dmInfo') && /Adreno|Mali|PowerVR|Xclipse/i.test(q('#dmInfo').textContent),
    q('#dmInfo') ? q('#dmInfo').textContent.replace(/\s+/g, ' ').slice(0, 60) : '空');
  ok('档位筛选按钮已就绪', qa('.dm-f').length === 4, `实际 ${qa('.dm-f').length}`);

  // 档位筛选：点「流畅」后卡片数应减少或持平
  /* ★ 加 `beforeN > 0`：改前这条是 `0 → 0` 也算通过 —— 上面那条红着的时候它会跟着变绿，
     等于「列表根本没渲染」时这条断言在替失败背书。 */
  const beforeN = qa('#dmGrid .emu-card').length;
  const fSmooth = q('.dm-f[data-dmv="smooth"]');
  if (fSmooth) { click(fSmooth); await sleep(400); }
  ok('点「流畅」筛选后结果刷新', beforeN > 0 && qa('#dmGrid .emu-card').length <= beforeN,
    `${beforeN} → ${qa('#dmGrid .emu-card').length}`);

  d1.window.close();

  /* ============================================================
   * 三、深链：#emu / #eg / #dm 直开对应平级页签；#pc 为兼容别名 → #emu
   * ============================================================ */
  const { dom: d2 } = await makeDom(BASE + '/emulator.html#pc');
  const d2d = d2.window.document;
  ok('深链 #pc（旧链接兼容）→ 落到手游中心 #emulator', !d2d.querySelector('#emulator').classList.contains('et-hide'));
  ok('深链 #pc → tab 激活的是「手游中心」', (d2d.querySelector('#emuTabs .emu-tab.on') || {}).dataset?.et === 'emu');
  d2.window.close();

  const { dom: d3 } = await makeDom(BASE + '/emulator.html#eg');
  ok('深链 #eg → 直开模拟器指南', !d3.window.document.querySelector('#emuguide').classList.contains('et-hide'));
  ok('深链 #eg → tab 停在「模拟器指南」', (d3.window.document.querySelector('#emuTabs .emu-tab.on') || {}).dataset?.et === 'eg');
  d3.window.close();

  const { dom: d4 } = await makeDom(BASE + '/emulator.html#dm');
  const d4d = d4.window.document;
  ok('深链 #dm → 直开机型兼容', !d4d.querySelector('#devmatch').classList.contains('et-hide'));
  ok('深链 #dm → #emuguide 收起', d4d.querySelector('#emuguide').classList.contains('et-hide'));
  ok('深链 #dm → tab 停在「机型兼容」', (d4d.querySelector('#emuTabs .emu-tab.on') || {}).dataset?.et === 'dm');
  d4.window.close();

  /* ★ v10.44：#tr / #sv 深链随分区一起搬到 /resources.html（用例见 test-resource-page.js）。
   *   这里改成**反向断言**：本页再收到 #tr / #sv 必须安全落到默认页签（手游中心），
   *   而不是切到一个不存在的分区（那会是一片空白）。 */
  const { dom: d4x } = await makeDom(BASE + '/emulator.html#tr');
  const d4xd = d4x.window.document;
  ok('本页收到已迁走的深链 #tr → 安全落回手游中心（不空白）',
    !d4xd.querySelector('#emulator').classList.contains('et-hide'));
  ok('本页收到 #tr → 高亮停在手游中心（不会有野页签被点亮）',
    (d4xd.querySelector('#emuTabs .emu-tab.on') || {}).dataset?.et === 'emu');
  d4x.window.close();

  const { dom: d4y } = await makeDom(BASE + '/emulator.html#sv');
  const d4yd = d4y.window.document;
  ok('本页收到已迁走的深链 #sv → 安全落回手游中心（不空白）',
    !d4yd.querySelector('#emulator').classList.contains('et-hide'));
  d4y.window.close();

  /* ============================================================
   * 四、★ v9.1 双坑回归：切换后「前一个分区必须真的消失」
   *
   * 用户反馈「并没有交互」的两个真实根因都不在事件绑定上：
   *   坑 A —— #emulator 漏了 data-et，`main[data-et].et-hide` 属性选择器匹配不上，
   *           class 加上了却隐藏不掉，把目标分区顶到 1600px 外 → 看着像没反应。
   *   坑 B —— 专属 CSS 掉到 </style> 外面被当正文渲染，页面糊一屏 CSS。
   * 这两个静态扫描都查不出来，必须在这里断言。
   * ============================================================ */
  const { dom: d5, errs: e5 } = await makeDom(BASE + '/emulator.html');
  const d5W = d5.window;
  const d5d = d5W.document;
  const qaCtrl = (d, s) => [...d.querySelectorAll(s)];
  const click5 = (el) => el.dispatchEvent(new d5W.MouseEvent('click', { bubbles: true, cancelable: true }));
  ok('初始 3 个分区都带 data-et', qaCtrl(d5d, 'main[data-et]').length === 3,
    `实际 ${qaCtrl(d5d, 'main[data-et]').length}`);
  click5(d5d.querySelector('#emuTabs .emu-tab[data-et="dm"]'));
  await sleep(300);
  ok('切到机型兼容后：#emulator 被加上 et-hide', d5d.querySelector('#emulator').classList.contains('et-hide'));
  ok('切到机型兼容后：#emulator 能被 CSS 隐藏（有 data-et）',
    !!d5d.querySelector('#emulator').getAttribute('data-et'),
    '缺 data-et 则 main[data-et].et-hide 不生效，分区仍占版面');
  ok('切到机型兼容后：仅 #devmatch 可见',
    ['emulator', 'emuguide', 'devmatch']
      .filter((id) => !d5d.querySelector('#' + id).classList.contains('et-hide'))
      .join(',') === 'devmatch');
  ok('切换后只有一个页签处于 on', qaCtrl(d5d, '#emuTabs .emu-tab.on').length === 1);
  /* jsdom 不实现 innerText，用 textContent（含 <style> 文本，正合适：能验出 CSS 泄漏） */
  /* ★ v10.23：先把 <style>/<script> 摘掉再取文本。
     原先直接取 body.textContent 会把整段 CSS（含注释）算进来 ——
     本轮给 CSS 加了一条说明性注释，里面引用了 `.go{display:flex}` 这种片段，
     就让这条「不残留裸 CSS 文本」的断言当场假红（断言打了注释的又一例）。
     这条断言真正要盯的是**掉到 </style> 外面的** CSS（那才是泄漏），
     style 元素内部的 CSS 本来就应该待在那儿。 */
  const _bt = d5d.body.cloneNode(true);
  [..._bt.querySelectorAll('style,script')].forEach((n) => n.remove());
  const BODY_TXT = (_bt.textContent || '');
  ok('页面上不残留裸 CSS 文本（专属 CSS 未掉到 </style> 外）',
    !/[.#][\w-]+\s*\{[^}]*\}/.test(BODY_TXT), BODY_TXT.slice(0, 60).replace(/\s+/g, ' '));

  /* ============================================================
   * v10.2：窄屏的「回首页」出口 —— 顶栏 .main-nav 在 ≤760px 是 display:none，
   *       所以底部 Tab 必须自带一个回首页入口；同时清掉首页语义的死链（最新 / 关于）。
   * ============================================================ */
  ok('专区页 body 带 data-page="emulator"（主脚本靠它区分两页语义）',
    d5d.body.getAttribute('data-page') === 'emulator', String(d5d.body.getAttribute('data-page')));
  const tbHome = d5d.querySelector('#tabbar a[href="/"]');
  ok('底部 Tab 有回首页入口（窄屏顶栏隐藏时的唯一出口）',
    !!tbHome, tbHome ? tbHome.textContent.trim() : '(缺失)');
  ok('底部 Tab 已清掉首页语义的死链（最新 / 关于 在专区里指向不存在的节点）',
    !d5d.querySelector('#tabbar a[data-tab="latest"]') && !d5d.querySelector('#tabbar a[data-tab="about"]'));
  const errN = e5.length;
  click5(d5d.querySelector('#tabbar a[data-tab="emu"]'));
  await sleep(250);
  ok('点底部「手机专区」不再抛异常（原为 goEmuPage 孤儿调用）',
    e5.length === errN, e5.slice(errN).join(' | '));
  ok('点底部「手机专区」切回手游中心', !d5d.querySelector('#emulator').classList.contains('et-hide'));
  d5.window.close();

  /* ---- 汇总 ---- */
  const fail = results.filter((r) => !r[0]);
  console.log('\n' + '='.repeat(68));
  for (const [c, n, e] of results) console.log(`${c ? '  PASS' : '× FAIL'}  ${n}${e ? '   [' + e + ']' : ''}`);
  console.log('='.repeat(68));
  console.log(`结果：${results.length - fail.length} / ${results.length} 通过`);
  process.exit(fail.length ? 1 : 0);
}

main().catch((e) => { console.error('测试脚本异常：', e); process.exit(1); });
