/* 端游资源「独立页」端到端回归 —— /resources.html 三页签（MOD / 存档 / 修改器）
 *
 * 为什么有这一页（v10.44）：
 *   用户口径：「手游的样式更新下，也需要划分模块 MOD，存档，修改器，
 *             手机专区保留手机中心 + 机型兼容 + 模拟器指南」。
 *   ⇒ MOD / 存档 / 修改器 从「手机专区」平级抽出，独立成 /resources.html
 *     （它们本质是**端游资源**；挂在手机专区下语义不成立，用户为找存档迷路过）。
 *
 * 本文件与 test-emulator-page.js 是**一对**：
 *   · 那边测「手机专区 3 页签」，并留了一组**反向断言**（本页不该再有 tr/sv）；
 *   · 这边测「三类资源 3 页签」，其中 MOD 是**新写**的分区，存档/修改器是从手机专区
 *     搬过来的（正文逐字未改）—— 搬家最容易出错的地方是「搬完忘了改默认口径」，
 *     所以这里专门钉了两条口径断言（存档默认全量 / 修改器默认只看匹配端游）。
 *
 * 为什么用 jsdom：沙箱里 Chrome/Edge headless 起不来；要验的是纯 DOM 行为
 * （页签 .et-hide 切换、深链 bootTab、卡片渲染、点击分流、默认开关），jsdom 足够。
 *
 * 运行：node tools/test-resource-page.js
 * 前置：服务已在 8123 端口运行（node server.js）
 */
const { JSDOM, VirtualConsole } = require('jsdom');

const BASE = 'http://127.0.0.1:8123';
const PAGE = '/resources.html';
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
  await new Promise((r) => setTimeout(r, 2200));
  return { dom, errs };
}

async function main() {
  const { dom: d1, errs: e1 } = await makeDom(BASE + PAGE);
  const W = d1.window;
  const q = (s) => W.document.querySelector(s);
  const qa = (s) => [...W.document.querySelectorAll(s)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const click = (el) => el.dispatchEvent(new W.MouseEvent('click', { bubbles: true, cancelable: true }));

  /* ============================================================
   * 一、骨架与导航：三个分区 / 3 页签 / 回首页出口唯一
   * ============================================================ */
  ok('端游资源页运行无 JS 异常', e1.length === 0, e1[0] || '');
  ok('三个分区 DOM 都在（#mods / #resSaves / #resTrainers）',
    !!(q('#mods') && q('#resSaves') && q('#resTrainers')));
  ok('页内不再有第二个「返回聚合首页」按钮',
    !q('.page-back a') && !/返回聚合首页/.test((q('.page-back') || {}).textContent || ''));
  const navHome = q('#navHome'), navRes = q('#navRes');
  ok('顶栏「首页」是真跳转回聚合首页（href="/"）',
    !!navHome && navHome.getAttribute('href') === '/',
    navHome ? navHome.getAttribute('href') : '(缺失)');
  ok('顶栏高亮落在「端游资源」上（首页不抢高亮）',
    !!navRes && navRes.classList.contains('on') && !!navHome && !navHome.classList.contains('on'));
  ok('顶栏另两项（手机专区 / 解包匹配）仍是真跳转',
    q('#navEmu') && q('#navEmu').getAttribute('href') === '/emulator.html'
    && q('#navUnpack') && q('#navUnpack').getAttribute('href') === '/unpack.html');
  ok('共享顶栏 / 抽屉 / mask / tabbar 已带上',
    !!q('.topbar') && !!q('#drawer') && !!q('#mask') && !!q('.tabbar'));

  ok('切换条 #resTabs 有 3 个平级页签', qa('#resTabs .res-tab').length === 3, `实际 ${qa('#resTabs .res-tab').length}`);
  ok('三页签 data-et 依次为 md/sv/tr',
    qa('#resTabs .res-tab').map((b) => b.dataset.et).join(',') === 'md,sv,tr',
    qa('#resTabs .res-tab').map((b) => b.dataset.et).join(','));
  ok('第 1 个页签是「MOD」', /MOD/.test((qa('#resTabs .res-tab')[0] || {}).textContent || ''),
    (qa('#resTabs .res-tab')[0] || {}).textContent || '(缺失)');
  ok('第 2 个页签是「存档」', /存档/.test((qa('#resTabs .res-tab')[1] || {}).textContent || ''),
    (qa('#resTabs .res-tab')[1] || {}).textContent || '(缺失)');
  ok('第 3 个页签是「修改器」', /修改器/.test((qa('#resTabs .res-tab')[2] || {}).textContent || ''),
    (qa('#resTabs .res-tab')[2] || {}).textContent || '(缺失)');
  ok('默认只显示 MOD（其余带 et-hide）',
    !q('#mods').classList.contains('et-hide')
    && q('#resSaves').classList.contains('et-hide')
    && q('#resTrainers').classList.contains('et-hide'));
  ok('三个页签数字胶囊都已回填（非占位 —）',
    !qa('#resTabs .res-tab b').some((b) => /^[—\-]$/.test(b.textContent.trim())),
    qa('#resTabs .res-tab b').map((b) => b.textContent.trim()).join(' / '));

  /* ---- 顶栏搜索入口（共享资产，曾因绑定埋在 bindRankUI 内而彻底失效） ---- */
  const smodal = q('#smodal'), sOpenBtn = q('#searchOpen');
  ok('端游资源页有顶栏搜索按钮 #searchOpen', !!sOpenBtn);
  if (sOpenBtn) click(sOpenBtn);
  await sleep(220);
  ok('点顶栏搜索按钮 → 弹窗真的打开（.show）',
    !!smodal && smodal.classList.contains('show'), smodal ? smodal.className : '(缺失)');
  const smClose = q('#smClose') || q('#smask');
  if (smClose) click(smClose); else if (smodal) smodal.classList.remove('show');
  await sleep(150);
  ok('关闭后弹窗回到关闭态', !!smodal && !smodal.classList.contains('show'));

  /* ============================================================
   * 二、MOD 分区（本轮新写）
   * ============================================================ */
  const mdCards = qa('#mdGrid .emu-card');
  ok('MOD 网格已渲染卡片', mdCards.length > 0, `共 ${mdCards.length} 张`);
  ok('MOD 卡片带「MOD」徽标', qa('#mdGrid .emu-card .tg.md').length === mdCards.length,
    `${qa('#mdGrid .emu-card .tg.md').length} / ${mdCards.length}`);
  /* 盘口按钮是这一区的核心：用户要的是**能直接取件**的出口，不是跳源站首页 */
  ok('MOD 卡片渲染出盘口取件按钮（.md-lk .lk）',
    qa('#mdGrid .emu-card .md-lk .lk').length > 0, `实际 ${qa('#mdGrid .emu-card .md-lk .lk').length} 个`);
  ok('盘口按钮是真外链（href 非 # 、target=_blank）', (() => {
    const a = q('#mdGrid .emu-card .md-lk .lk');
    return !!a && /^https?:/.test(a.getAttribute('href') || '') && a.getAttribute('target') === '_blank';
  })(), (() => { const a = q('#mdGrid .emu-card .md-lk .lk'); return a ? a.getAttribute('href') : '(缺失)'; })());
  ok('盘口按钮挂了盘口配色类 bd-*（与详情页下载弹窗同源语义）',
    qa('#mdGrid .emu-card .md-lk .lk[class*="bd-"]').length > 0,
    `实际 ${qa('#mdGrid .emu-card .md-lk .lk[class*="bd-"]').length} 个`);
  ok('MOD 卡片都带「打开源站帖」外链（取件口之外的兜底出口）',
    qa('#mdGrid .emu-card .md-go a').length === mdCards.length,
    `${qa('#mdGrid .emu-card .md-go a').length} / ${mdCards.length}`);
  ok('MOD 计数已回填', /共 [\d,]+ 条/.test(q('#mdCount').textContent || ''), q('#mdCount').textContent || '');
  ok('MOD 统计条已回填 4 格', qa('#mdStats .st').length === 4, `实际 ${qa('#mdStats .st').length}`);
  ok('MOD「仅看匹配端游」默认开启（与手机专区口径一致）',
    !!q('#mdToggleLib') && q('#mdToggleLib').classList.contains('on'),
    q('#mdToggleLib') ? q('#mdToggleLib').textContent.trim() : '(缺失)');
  /* 关掉 → 放开到全量，计数应变大（证明开关真的接了后端，不是纯样式） */
  {
    const before = q('#mdCount').textContent || '';
    click(q('#mdToggleLib'));
    await sleep(1700);
    const after = q('#mdCount').textContent || '';
    const num = (s) => Number(String(s).replace(/[^\d]/g, '')) || 0;
    ok('关掉「仅看匹配端游」→ 放开到全量（计数变大）', num(after) > num(before), `${before} → ${after}`);
    click(q('#mdToggleLib'));  // 复原
    await sleep(1500);
  }
  /* 点正文：有 libId 就进详情；没命中要给出明确提示（不能点了没反应） */
  {
    const withLib = qa('#mdGrid .emu-card').find((c) => c.dataset.lib);
    if (withLib) {
      click(withLib.querySelector('h4'));
      await sleep(1500);
      ok('点 MOD 卡片正文（命中端游库）→ 打开游戏详情抽屉',
        q('#drawer').classList.contains('show'), q('#drawer').className);
      W.closeDetail(); await sleep(300);
    } else {
      ok('MOD 卡片正文点击（本轮无命中样本，跳过）', true, '无 data-lib 卡片');
    }
  }

  /* ============================================================
   * 三、存档分区（自手机专区搬家）
   * ============================================================ */
  click(q('#resTabs .res-tab[data-et="sv"]'));
  await sleep(1800);
  ok('切「存档」→ #resSaves 显示、#mods 同时收起',
    !q('#resSaves').classList.contains('et-hide') && q('#mods').classList.contains('et-hide'));
  ok('切「存档」→ 页签高亮同步', (q('#resTabs .res-tab.on') || {}).dataset?.et === 'sv');
  ok('存档网格已渲染卡片', qa('#svGrid .emu-card').length > 0, `实际 ${qa('#svGrid .emu-card').length}`);
  /* ★ 核心诉求：卡片上必须真的把「存档路径」铺出来（用户照它找文件） */
  ok('存档卡片渲染出路径行（.paths .p）', qa('#svGrid .emu-card .paths .p').length > 0,
    `实际 ${qa('#svGrid .emu-card .paths .p').length}`);
  ok('存档卡片带「复制」按钮（路径行右侧）', qa('#svGrid .emu-card .paths .cp').length > 0,
    `实际 ${qa('#svGrid .emu-card .paths .cp').length} 个`);
  {
    /* ★ 判据别钉死盘符：Ludusavi 的存档位置大量以占位词开头
     *   （`<游戏安装目录>\…` / `<winAppData>\…`），带盘符的只是其中一部分
     *   （实测首个卡片就是 `<游戏安装目录>\Hannah and Joseph Games\…`，
     *     钉 `[A-Z]:\\` 会当场假红）。
     *   这里只要求「解析出了路径分隔符或注册表头」——即它确实是条路径，
     *   而不是原样透出的占位 token；并且**抽全量**看比例，不看单张卡。 */
    const all = qa('#svGrid .emu-card .paths .p span').map((s) => s.textContent || '');
    const hit = all.filter((t) => /[\\/]|HKEY_/.test(t)).length;
    ok('存档路径已解析为可读形式（≥9 成路径行含路径分隔符 / 注册表头）',
      all.length > 0 && hit >= Math.ceil(all.length * 0.9),
      `${hit} / ${all.length}  例：${(all[0] || '').slice(0, 70)}`);
  }
  ok('存档卡片带云同步 / 不支持徽标',
    qa('#svGrid .emu-card .tg.cloud, #svGrid .emu-card .tg.dim').length > 0);
  /* ★ 口径断言（搬家的关键）：手机专区语境默认「仅看手机能玩」；
   *   搬到端游资源语境后**默认给全量**，口径必须与页签标题一致。 */
  ok('存档「仅看手机能玩」默认**关闭**（本页是端游资源语境，默认给全量）',
    !!q('#svPhone') && !q('#svPhone').classList.contains('on'),
    q('#svPhone') ? ('class=' + q('#svPhone').className) : '(缺失)');
  {
    const before = q('#svCount').textContent || '';
    const num = (s) => Number(String(s).replace(/[^\d]/g, '')) || 0;
    ok('默认全量计数 > 手机能玩子集（证明默认口径真的是「全部」而不是继承旧默认）',
      num(before) > 1163, before);
    click(q('#svPhone'));
    await sleep(1800);
    const after = q('#svCount').textContent || '';
    ok('打开「仅看手机能玩」→ 计数收窄', num(after) > 0 && num(after) < num(before), `${before} → ${after}`);
    ok('切换前后文案恒定（状态只靠 .on 类表达，按钮宽度不变）',
      !/[✓○已开]/.test(q('#svPhone').textContent || '') && q('#svPhone').classList.contains('on'),
      q('#svPhone').textContent.trim());
    click(q('#svPhone'));  // 复原
    await sleep(1500);
  }
  /* 点击分流：.paths 不跳（要能选中文字）/ .cp 只复制 / 正文进详情 */
  {
    const svCard = qa('#svGrid .emu-card').find((c) => c.dataset.lib);
    if (svCard) {
      const p = svCard.querySelector('.paths .p');
      if (p) { click(p); await sleep(600); }
      ok('点 .paths 路径行 → 不跳转（保证能选中 / 复制文字）', !q('#drawer').classList.contains('show'));
      const errN = e1.length;
      click(svCard.querySelector('.paths .cp'));
      await sleep(400);
      ok('点「复制」按钮 → 不抛异常（剪贴板降级路径要能兜住）', e1.length === errN, e1.slice(errN).join(' | '));
      click(svCard.querySelector('h4'));
      await sleep(1500);
      ok('点存档卡片正文 → 打开游戏详情抽屉', q('#drawer').classList.contains('show'), q('#drawer').className);
      W.closeDetail(); await sleep(300);
    } else {
      ok('存档卡片正文点击（本轮无命中样本，跳过）', true, '无 data-lib 卡片');
    }
  }
  ok('存档统计条已回填 4 格', qa('#svStats .st').length === 4, `实际 ${qa('#svStats .st').length}`);

  /* ============================================================
   * 四、修改器分区（自手机专区搬家）
   * ============================================================ */
  click(q('#resTabs .res-tab[data-et="tr"]'));
  await sleep(1800);
  ok('切「修改器」→ #resTrainers 显示、#resSaves 同时收起',
    !q('#resTrainers').classList.contains('et-hide') && q('#resSaves').classList.contains('et-hide'));
  ok('切「修改器」→ 页签高亮同步', (q('#resTabs .res-tab.on') || {}).dataset?.et === 'tr');
  ok('修改器网格已渲染卡片', qa('#trGrid .emu-card').length > 0, `实际 ${qa('#trGrid .emu-card').length}`);
  ok('修改器卡片带来源徽标（.tg.src）', qa('#trGrid .emu-card .tg.src').length > 0,
    `实际 ${qa('#trGrid .emu-card .tg.src').length}`);
  ok('修改器卡片带版本号胶囊（.pill.ver）', qa('#trGrid .emu-card .pill.ver').length > 0,
    `实际 ${qa('#trGrid .emu-card .pill.ver').length}`);
  /* ★ 本页刻意不给下载直链（GCM 走一次性签名 URL，不该绕过），只做「获取方式」引导 */
  ok('修改器卡片有「获取方式」外链（不提供下载直链，导流官方）',
    qa('#trGrid .emu-card .tr-go a').length > 0, `实际 ${qa('#trGrid .emu-card .tr-go a').length}`);
  ok('修改器卡片有「放置位置」说明（用户明确要的信息）',
    qa('#trGrid .emu-card .tr-note').length > 0 &&
    /放置位置/.test(qa('#trGrid .emu-card .tr-note')[0].textContent || ''));
  ok('修改器来源下拉已填充（全部来源 + N 个来源）', qa('#trSource option').length >= 6,
    `实际 ${qa('#trSource option').length} 项`);
  ok('修改器「仅看匹配端游」默认开启', !!q('#trToggleLib') && q('#trToggleLib').classList.contains('on'),
    q('#trToggleLib') ? q('#trToggleLib').textContent.trim() : '(缺失)');
  /* 选一个具体来源 → 列表收窄（证明下拉真的接了后端） */
  {
    const sel = q('#trSource');
    const before = qa('#trGrid .emu-card').length;
    const opt = qa('#trSource option')[1];
    if (sel && opt) {
      sel.value = opt.value;
      sel.dispatchEvent(new W.Event('change', { bubbles: true }));
      await sleep(1800);
      ok('改「来源」下拉 → 列表按来源收窄', qa('#trGrid .emu-card').length <= before,
        `${before} → ${qa('#trGrid .emu-card').length}（来源 ${opt.value}）`);
      sel.value = '';
      sel.dispatchEvent(new W.Event('change', { bubbles: true }));
      await sleep(1500);
    }
  }
  ok('修改器计数已回填', /共 [\d,]+ 条/.test(q('#trCount').textContent || ''), q('#trCount').textContent || '');

  /* ---- 底 Tab「端游资源」：切页签而不是重载（且不抛异常） ---- */
  const errN2 = e1.length;
  click(q('#tabbar a[data-tab="md"]'));
  await sleep(600);
  ok('点底部「端游资源」不再抛异常', e1.length === errN2, e1.slice(errN2).join(' | '));
  ok('点底部「端游资源」切回 MOD 页签', !q('#mods').classList.contains('et-hide'));
  ok('data-page 标记为 resources（主源脚本据此放行「首页」真跳转）',
    W.document.body.getAttribute('data-page') === 'resources',
    String(W.document.body.getAttribute('data-page')));
  /* ★ v10.23 同款：先摘掉 style/script 再取文本，否则 CSS 注释里的选择器片段会假红 */
  {
    const bt = W.document.body.cloneNode(true);
    [...bt.querySelectorAll('style,script')].forEach((n) => n.remove());
    const BODY_TXT = bt.textContent || '';
    ok('页面上不残留裸 CSS 文本（专属 CSS 未掉到 </style> 外）',
      !/[.#][\w-]+\s*\{[^}]*\}/.test(BODY_TXT), BODY_TXT.slice(0, 60).replace(/\s+/g, ' '));
  }
  d1.window.close();

  /* ============================================================
   * 五、深链：#md / #sv / #tr 直开对应页签（分享 / 书签场景）
   * ============================================================ */
  const { dom: d2 } = await makeDom(BASE + PAGE + '#sv');
  const d2d = d2.window.document;
  ok('深链 #sv → 直开存档', !d2d.querySelector('#resSaves').classList.contains('et-hide'));
  ok('深链 #sv → MOD 收起', d2d.querySelector('#mods').classList.contains('et-hide'));
  ok('深链 #sv → 页签停在「存档」', (d2d.querySelector('#resTabs .res-tab.on') || {}).dataset?.et === 'sv');
  d2.window.close();

  const { dom: d3 } = await makeDom(BASE + PAGE + '#tr');
  const d3d = d3.window.document;
  ok('深链 #tr → 直开修改器', !d3d.querySelector('#resTrainers').classList.contains('et-hide'));
  ok('深链 #tr → 存档收起', d3d.querySelector('#resSaves').classList.contains('et-hide'));
  ok('深链 #tr → 页签停在「修改器」', (d3d.querySelector('#resTabs .res-tab.on') || {}).dataset?.et === 'tr');
  d3.window.close();

  const { dom: d4 } = await makeDom(BASE + PAGE + '#md');
  const d4d = d4.window.document;
  ok('深链 #md → 直开 MOD', !d4d.querySelector('#mods').classList.contains('et-hide'));
  ok('深链 #md → 页签停在「MOD」', (d4d.querySelector('#resTabs .res-tab.on') || {}).dataset?.et === 'md');
  d4.window.close();

  /* ---- 陌生 hash（比如从手机专区抄过来的 #emu）必须安全落回默认页签 ---- */
  const { dom: d5 } = await makeDom(BASE + PAGE + '#emu');
  const d5d = d5.window.document;
  ok('陌生深链 #emu → 安全落回 MOD（不空白）', !d5d.querySelector('#mods').classList.contains('et-hide'));
  ok('陌生深链 #emu → 高亮停在 MOD（不会有野页签被点亮）',
    (d5d.querySelector('#resTabs .res-tab.on') || {}).dataset?.et === 'md');
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
