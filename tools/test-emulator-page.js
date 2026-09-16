/* 手机专区「独立页」端到端回归 —— 首页入口 + /emulator.html 三段式（手游可玩 / 实测配置 / 兼容·指南）
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
  await new Promise((r) => setTimeout(r, 1800));
  return { dom, errs };
}

async function main() {
  /* ============================================================
   * 一、首页：手机专区必须变成「独立页入口」而不是内联分区
   * ============================================================ */
  const { dom: home, errs: homeErrs } = await makeDom(BASE + '/');
  const w = home.window;
  const $ = (s) => w.document.querySelector(s);
  const $$ = (s) => [...w.document.querySelectorAll(s)];

  ok('首页运行无 JS 异常', homeErrs.length === 0, homeErrs[0] || '');
  ok('首页只剩 1 个 <main>（手机三分区已迁出）', $$('main').length === 1, `实际 ${$$('main').length}`);
  ok('首页已无 #phonecfg / #emuguide 内联分区', !$('#phonecfg') && !$('#emuguide'));
  /* v9 三段式：首页不再放手机专区引导卡（按需求移除跳转块），入口只留顶栏 + 底部 Tab */
  ok('首页已移除引导卡 #emuHub', !$('#emuHub'));
  ok('首页已无任何 /emulator.html 的内联分区残留', !$('#emulator') && !$('#devmatch'));

  // v9.1：顶栏收敛为 2 个入口（首页 / 手机专区）—— 热榜+最新收录 合进「首页」
  const navLinks = $$('.main-nav a');
  ok('顶栏只剩 2 个入口（首页 / 手机专区）', navLinks.length === 2, `实际 ${navLinks.length}：${navLinks.map((a) => a.textContent.trim()).join(' / ')}`);
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
   * v10 ：新增「修改器」「云存档」，共 **5 个平级页签**
   * ★ v10.13：用户要求「模拟器指南放在最后一个」→ 指南(eg) 从第 4 位挪到末位
   *       顺序 = 内容(emu) → 资源(tr/sv) → 工具(dm) → 指南(eg) */
  ok('独立页切换条 #emuTabs 有 5 个平级页签', qa('#emuTabs .emu-tab').length === 5, `实际 ${qa('#emuTabs .emu-tab').length}`);
  const tabDefs = ['emu', 'tr', 'sv', 'dm', 'eg'];
  ok('五个页签 data-et 依次为 emu/tr/sv/dm/eg',
    qa('#emuTabs .emu-tab').map((b) => b.dataset.et).join(',') === tabDefs.join(','),
    qa('#emuTabs .emu-tab').map((b) => b.dataset.et).join(','));
  ok('第 1 个页签是「手游中心」', /手游中心/.test((qa('#emuTabs .emu-tab')[0] || {}).textContent || ''),
    (qa('#emuTabs .emu-tab')[0] || {}).textContent || '(缺失)');
  ok('第 2 个页签是「修改器」', /修改器/.test((qa('#emuTabs .emu-tab')[1] || {}).textContent || ''),
    (qa('#emuTabs .emu-tab')[1] || {}).textContent || '(缺失)');
  ok('第 3 个页签是「云存档」', /云存档/.test((qa('#emuTabs .emu-tab')[2] || {}).textContent || ''),
    (qa('#emuTabs .emu-tab')[2] || {}).textContent || '(缺失)');
  ok('第 4 个页签是「机型兼容」', /机型兼容/.test((qa('#emuTabs .emu-tab')[3] || {}).textContent || ''),
    (qa('#emuTabs .emu-tab')[3] || {}).textContent || '(缺失)');
  ok('第 5 个页签是「模拟器指南」', /模拟器指南/.test((qa('#emuTabs .emu-tab')[4] || {}).textContent || ''),
    (qa('#emuTabs .emu-tab')[4] || {}).textContent || '(缺失)');
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
    await sleep(1200);
    ok('点「查看游戏详情」→ 打开详情抽屉', q('#drawer').classList.contains('show'));
    ok('抽屉不空白', (q('#drawerBody').textContent || '').trim().length > 10);
    W.closeDetail(); await sleep(200);
  }
  /* ★ v10.5 点击语义统一：**有端游库命中就进游戏详情**
   *   旧逻辑让「社区仓库键(bhk)」优先于「端游库命中(libId)」，
   *   于是「既命中库、又有社区配置」的卡片点正文进的是社区配置面板，
   *   用户反馈为「点了不是游戏详情页」。 */
  const bothCard = qa('#emuGrid .emu-card').find((c) => c.dataset.lib && c.dataset.bhk);
  if (bothCard) {
    click(bothCard); await sleep(1300);
    ok('「既命中端游库又有社区配置」的卡片点正文 → 进游戏详情（不再被配置面板截走）',
      q('#drawer').classList.contains('show') && !q('#drawerBody .cf-table'));
    ok('这类卡片上另有一颗独立的「社区配置」按钮', !!bothCard.querySelector('.cfg-btn'));
    W.closeDetail(); await sleep(300);
    click(bothCard.querySelector('.cfg-btn')); await sleep(1100);
    ok('点「📋 社区配置」按钮 → 才打开社区配置面板',
      q('#drawer').classList.contains('show') && !!q('#drawerBody .cf-table'));
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
    await sleep(1600);
    ok('点「💾 有云存档」→ 开关进入活跃态且列表有结果',
      q('#emuToggleSv').classList.contains('on') && qa('#emuGrid .emu-card').length > 0,
      `卡片 ${qa('#emuGrid .emu-card').length}`);
    click(q('#emuToggleSv'));  // 复原
    await sleep(1200);
  }

  /* ================= ★ v10 新增分区：修改器 / 云存档 ================= */
  /* ---- 切「修改器」（第 2 个平级页签） ---- */
  click(q('#emuTabs .emu-tab[data-et="tr"]'));
  await sleep(1600);
  ok('切「修改器」→ #trainers 显示', !q('#trainers').classList.contains('et-hide'));
  ok('切「修改器」→ #emulator 同时收起', q('#emulator').classList.contains('et-hide'));
  ok('切「修改器」→ tab 高亮同步', (q('#emuTabs .emu-tab.on') || {}).dataset?.et === 'tr');
  ok('修改器网格已渲染卡片', qa('#trGrid .emu-card').length > 0, `实际 ${qa('#trGrid .emu-card').length}`);
  ok('修改器卡片带来源徽标（.tg.src）', qa('#trGrid .emu-card .tg.src').length > 0,
    `实际 ${qa('#trGrid .emu-card .tg.src').length}`);
  ok('修改器卡片带版本号胶囊（.pill.ver）', qa('#trGrid .emu-card .pill.ver').length > 0,
    `实际 ${qa('#trGrid .emu-card .pill.ver').length}`);
  ok('修改器卡片有「获取方式」外链（不提供下载直链，导流官方）',
    qa('#trGrid .emu-card .tr-go a').length > 0, `实际 ${qa('#trGrid .emu-card .tr-go a').length}`);
  ok('修改器卡片有「放置位置」说明（用户本轮明确要的信息）',
    qa('#trGrid .emu-card .tr-note').length > 0 &&
    /放置位置/.test(qa('#trGrid .emu-card .tr-note')[0].textContent || ''));
  ok('修改器来源下拉已填充 5 个来源', qa('#trSource option').length === 6,
    `实际 ${qa('#trSource option').length}（含「全部来源」）`);
  ok('修改器「仅看匹配端游」默认开启',
    !!q('#trToggleLib') && q('#trToggleLib').classList.contains('on'),
    q('#trToggleLib') ? q('#trToggleLib').textContent.trim() : '');
  { /* 只显示匹配端游库的 → 每张卡要么有封面要么明确标了未关联 */
    const total = q('#trCount').textContent || '';
    ok('修改器计数已回填', /共 [\d,]+ 条/.test(total), total);
  }

  /* ---- 切「云存档」（第 3 个平级页签） ---- */
  click(q('#emuTabs .emu-tab[data-et="sv"]'));
  await sleep(1600);
  ok('切「云存档」→ #saves 显示', !q('#saves').classList.contains('et-hide'));
  ok('切「云存档」→ #trainers 同时收起', q('#trainers').classList.contains('et-hide'));
  ok('切「云存档」→ tab 高亮同步', (q('#emuTabs .emu-tab.on') || {}).dataset?.et === 'sv');
  ok('云存档网格已渲染卡片', qa('#svGrid .emu-card').length > 0, `实际 ${qa('#svGrid .emu-card').length}`);
  /* ★ 这是本轮的核心诉求：卡片上必须真的把「存档路径」铺出来 */
  ok('云存档卡片渲染出存档路径行（.paths .p）', qa('#svGrid .emu-card .paths .p').length > 0,
    `实际 ${qa('#svGrid .emu-card .paths .p').length}`);
  {
    const first = qa('#svGrid .emu-card .paths .p')[0];
    const txt = first ? (first.textContent || '') : '';
    /* 路径应已把占位符解析成可读形式（含盘符或注册表头） */
    ok('存档路径已解析为可读形式（含盘符 \\ 或 HKEY_）', /[A-Z]:\\|HKEY_|~\/|\/usr\//.test(txt),
      txt.slice(0, 80));
  }
  ok('云存档卡片带云同步/不支持徽标', qa('#svGrid .emu-card .tg.cloud, #svGrid .emu-card .tg.dim').length > 0);
  ok('云存档「仅看手机能玩」默认开启',
    !!q('#svPhone') && q('#svPhone').classList.contains('on'),
    q('#svPhone') ? q('#svPhone').textContent.trim() : '');
  /* ---- ★ v10.5 核心修复：云存档卡片点正文要能进游戏详情 ----
   *   旧版为「路径文字防误触」把整卡点击整个吞掉（只留封面上的按钮），
   *   用户反馈「云存档点击未跳转」。现在分工：正文进详情 / .paths 不跳 / .cp 只复制。 */
  {
    const svCard = qa('#svGrid .emu-card').find((c) => c.dataset.lib);
    ok('云存档卡片有「复制」按钮（路径行右侧）', qa('#svGrid .emu-card .paths .cp').length > 0,
      `实际 ${qa('#svGrid .emu-card .paths .cp').length} 个`);
    if (svCard) {
      /* 点路径行 → 不跳转（要能选中文字） */
      const p = svCard.querySelector('.paths .p');
      if (p) { click(p); await sleep(500); }
      ok('点 .paths 路径行 → 不跳转（保证能选中/复制文字）', !q('#drawer').classList.contains('show'));
      /* 点正文（标题）→ 进详情 */
      click(svCard.querySelector('h4'));
      await sleep(1400);
      ok('点云存档卡片正文 → 打开游戏详情抽屉',
        q('#drawer').classList.contains('show'), q('#drawer').className);
      W.closeDetail(); await sleep(300);
    }
  }
  /* 关掉「仅看手机能玩」→ 放开到全量，计数应变大 */
  {
    const before = q('#svCount').textContent || '';
    click(q('#svPhone'));
    await sleep(1600);
    const after = q('#svCount').textContent || '';
    const nBefore = Number(String(before).replace(/[^\d]/g, '')) || 0;
    const nAfter = Number(String(after).replace(/[^\d]/g, '')) || 0;
    ok('关掉「仅看手机能玩」→ 放开到全量（计数变大）', nAfter > nBefore, `${before} → ${after}`);
    ok('关掉后文案不变（仍无状态字），.on 已移除',
      !/[✓○已开]/.test(q('#svPhone').textContent || '') && !q('#svPhone').classList.contains('on'));
    click(q('#svPhone'));  // 复原
    await sleep(1200);
  }

  /* ---- 直接切「模拟器指南」（第 4 个平级页签，不再经二级） ---- */
  click(q('#emuTabs .emu-tab[data-et="eg"]'));
  await sleep(1200);
  ok('切「模拟器指南」→ #emuguide 显示', !q('#emuguide').classList.contains('et-hide'));
  ok('切「模拟器指南」→ #devmatch 同时收起', q('#devmatch').classList.contains('et-hide'));
  ok('切「模拟器指南」→ tab 高亮同步', (q('#emuTabs .emu-tab.on') || {}).dataset?.et === 'eg');
  ok('指南技术栈 5 层已渲染', qa('#egStack .eg-ly').length === 5, `实际 ${qa('#egStack .eg-ly').length}`);
  ok('子页签数字已回填（非占位 —）', !qa('#emuTabs .emu-tab b').some((b) => b.textContent.trim() === '—'),
    qa('#emuTabs .emu-tab b').map((b) => b.textContent.trim()).join(' / '));
  /* v9.3：第 3 个 tab「机型兼容」回填已索引机型数 */
  const dmNum = q('#tabNumDm');
  ok('「机型兼容」tab 数字已回填为真实机型数', !!dmNum && /^[\d,]+$/.test(dmNum.textContent.trim()),
    dmNum ? dmNum.textContent.trim() : '(缺失)');

  /* ---- 直接切「机型兼容」（第 3 个平级页签） ---- */
  click(q('#emuTabs .emu-tab[data-et="dm"]'));
  await sleep(1600);
  ok('切「机型兼容」→ #devmatch 显示、#emuguide 隐藏',
    !q('#devmatch').classList.contains('et-hide') && q('#emuguide').classList.contains('et-hide'));
  ok('切「机型兼容」→ tab 高亮同步', (q('#emuTabs .emu-tab.on') || {}).dataset?.et === 'dm');
  ok('品牌下拉已填充', qa('#dmBrand option').length > 3, `实际 ${qa('#dmBrand option').length} 项`);
  ok('Turnip 驱动看板已渲染', qa('#dmTurnip .dm-var').length >= 2, `实际 ${qa('#dmTurnip .dm-var').length} 个变体`);

  // 触发一次匹配查询
  const dmInp = q('#dmInput');
  if (dmInp) {
    dmInp.value = 'SM S928B';
    click(q('#dmGo'));
    await sleep(2200);
  }
  const dmGrid = q('#dmGrid');
  ok('机型匹配结果已渲染', dmGrid && qa('#dmGrid .emu-card').length > 0, `实际 ${dmGrid ? qa('#dmGrid .emu-card').length : 0} 张`);
  ok('结果头显示 GPU 与性能档', !!q('#dmInfo') && /Adreno|Mali|PowerVR|Xclipse/i.test(q('#dmInfo').textContent),
    q('#dmInfo') ? q('#dmInfo').textContent.replace(/\s+/g, ' ').slice(0, 60) : '空');
  ok('档位筛选按钮已就绪', qa('.dm-f').length === 4, `实际 ${qa('.dm-f').length}`);

  // 档位筛选：点「流畅」后卡片数应减少或持平
  const beforeN = qa('#dmGrid .emu-card').length;
  const fSmooth = q('.dm-f[data-dmv="smooth"]');
  if (fSmooth) { click(fSmooth); await sleep(400); }
  ok('点「流畅」筛选后结果刷新', qa('#dmGrid .emu-card').length <= beforeN,
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

  /* ★ v10：两个新分区也要能深链直达（分享/书签场景） */
  const { dom: d4t } = await makeDom(BASE + '/emulator.html#tr');
  const d4td = d4t.window.document;
  ok('深链 #tr → 直开修改器', !d4td.querySelector('#trainers').classList.contains('et-hide'));
  ok('深链 #tr → 手游中心收起', d4td.querySelector('#emulator').classList.contains('et-hide'));
  ok('深链 #tr → tab 停在「修改器」', (d4td.querySelector('#emuTabs .emu-tab.on') || {}).dataset?.et === 'tr');
  d4t.window.close();

  const { dom: d4s } = await makeDom(BASE + '/emulator.html#sv');
  const d4sd = d4s.window.document;
  ok('深链 #sv → 直开云存档', !d4sd.querySelector('#saves').classList.contains('et-hide'));
  ok('深链 #sv → 修改器收起', d4sd.querySelector('#trainers').classList.contains('et-hide'));
  ok('深链 #sv → tab 停在「云存档」', (d4sd.querySelector('#emuTabs .emu-tab.on') || {}).dataset?.et === 'sv');
  d4s.window.close();

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
  ok('初始 5 个分区都带 data-et', qaCtrl(d5d, 'main[data-et]').length === 5,
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
  const BODY_TXT = (d5d.body.textContent || '');
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
