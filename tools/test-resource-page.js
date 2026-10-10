/* 端游资源「独立页」端到端回归 —— /resources.html 三页签（MOD / 存档 / 修改器）
 *
 * 本文件与 test-emulator-page.js 是**一对**：
 *   · 那边测「手机专区 3 页签」，并留了一组**反向断言**（本页不该再有 tr/sv 那套旧开关）；
 *   · 这边测「三类资源 3 页签」。
 *
 * ★★ v10.47 整段重写（不是小修）——三个分区**统一改形**，旧断言全部失效：
 *   用户口径：「MOD 按游戏做卡片而不是按 MOD」「存档只展示真有存档的而不是存档位置的」
 *            「（修改器）同样按游戏聚合」「卡内列前 3 条 + 展开全部」。
 *   ⇒ 一卡一款游戏（`article.emu-card.grp`），卡内铺前 3 条可下载条目。
 *
 * ★★ v10.48 又改了两处**行为**（对应两组新断言）：
 *   ① 用户口径：「优化，不要展开（在弹窗中 mod 模块显示，可在下载弹窗中搜索）」
 *      ⇒ 「查看全部 N 条」不再原地铺开（旧的 `grpExpand`，上限 300），改为打开 `#dlPop`
 *        弹窗列全量（服务端 items 上限已 500 → 1000，覆盖实测最大组 717）+ 弹窗内搜索。
 *      ⚠️ 断言必须**同时**断「弹窗开了」与「卡内行数没变」——只断前者的话，
 *         有人把原地铺开加回来照样绿。
 *   ② 用户口径：「修改器中的第三方修改器来源我也需要你提供跳转链接」
 *      ⇒ GCM（第三方）条目补 `official_url` 跳转链（实测覆盖 93.7%）。
 *      ⚠️ 反向断言钉住「**不是**端游库链接」——旧实现的 page 指向 `libUrl`（xdgame），
 *         这正是用户报的问题；只断「有链接」是拦不住它的。
 *
 *   ⚠️ 已删的旧卡面元素（本文件全部改成**反向断言**守住，防止有人捡回来）：
 *      `.md-lk` / `.md-go`（MOD 一卡一条）· `.sv-open` / `.paths` / `.cp`（存档位置卡面）
 *      · `.tr-go` / `.tr-note`（修改器导流卡）· `#mdToggleLib` / `#svPhone` / `#trToggleLib`
 *      （恒真或口径已废的开关）。
 *   ⚠️ 反向断言**必须配正向锚点**：选择器写错 ⇒ 计数 0 ⇒ 平白变绿。
 *      所以每组反向断言旁边都有一条「新形态真的渲染出来了」的正向断言。
 *
 * 为什么用 jsdom：沙箱里 Chrome/Edge headless 起不来；要验的是纯 DOM 行为
 * （页签 .et-hide 切换、深链 bootTab、组卡渲染、卡内展开、点击分流），jsdom 足够。
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
  /* ★ 首屏现在是**两轮**请求（/api/res/stats?cat=… 之后再 /api/res/groups?…），
     比旧版（一轮 stats + 一轮 list）更晚，2200ms 会偶发取样到「正在拉取…」占位。 */
  await new Promise((r) => setTimeout(r, 2800));
  return { dom, errs };
}

/* 三区共用的卡形取样器 —— 「按游戏聚合」的核心判据只有这一套，别在三个区各写一遍 */
function shapeOf(qa, sel) {
  const cards = qa(sel + ' .emu-card');
  return {
    n: cards.length,
    grp: cards.filter((c) => c.classList.contains('grp')).length,
    cov: cards.filter((c) => c.querySelector('.cov')).length,
    meta: cards.filter((c) => c.querySelector('.meta .tg')).length,
    gl: cards.filter((c) => c.querySelector('.gl .gl-i')).length,
    over3: cards.filter((c) => c.querySelectorAll('.gl .gl-i').length > 3).length,
    deadEl: cards.filter((c) => c.querySelector('.md-lk,.md-go,.sv-open,.tr-go,.tr-note,.paths,.cp')).length,
    noCat: cards.filter((c) => !c.dataset.cat).length,
    noOut: cards.filter((c) => [...c.querySelectorAll('.gl .gl-i')].some((r) => !r.querySelector('.gl-lk a'))).length,
  };
}
const shapeStr = (s) => `卡 ${s.n} ｜ grp ${s.grp} ｜ cov ${s.cov} ｜ meta ${s.meta} ｜ gl ${s.gl}`
  + ` ｜ 超 3 条 ${s.over3} ｜ 残留旧元素 ${s.deadEl} ｜ 无 data-cat ${s.noCat} ｜ 行内无出口 ${s.noOut}`;

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
   * 二、MOD 分区 —— v10.47 新形态：一卡一款游戏
   * ============================================================ */
  const md = shapeOf(qa, '#mdGrid');
  ok('MOD 网格已渲染**游戏组卡**（>0 张）', md.n > 0, `实际 ${md.n} 张`);
  ok('★★ MOD 卡**全部**是聚合卡 .emu-card.grp（用户诉求：按游戏做卡片而不是按 MOD）',
    md.n > 0 && md.grp === md.n, `${md.grp} / ${md.n}`);
  ok('每张组卡都带封面槽 .cov（有图用图 / 无图占位，网格不会被拉齐掏空）',
    md.n > 0 && md.cov === md.n, `${md.cov} / ${md.n}`);
  ok('每张组卡都有分类徽标 .meta .tg 与条数胶囊 .pill', md.n > 0 && md.meta === md.n,
    `${md.meta} / ${md.n}`);
  ok('每张组卡都带 data-cat（点卡进详情要靠它认分区）', md.n > 0 && md.noCat === 0,
    `无 data-cat ${md.noCat} 张`);
  /* ★★ 用户口径「卡内列前 3 条 + 展开全部」：未展开时**卡内行数不得超过 3** */
  ok('★★ 卡内明文最多 3 条（未展开时）——「前 3 条」是用户明确口径',
    md.n > 0 && md.over3 === 0, `超 3 条的卡 ${md.over3} 张`);
  ok('★ 组卡真的铺出了卡内行 .gl .gl-i（正向锚点：上一条「≤3」不能因整卡空掉而变绿）',
    md.n > 0 && md.gl === md.n, `${md.gl} / ${md.n}`);
  /* ★ 铁律「存在 ≠ 可见」的正向落点：卡内每一行都必须有一个**可点的去处**
     （有通道给通道按钮，没通道给「源站」兜底出口）—— 不能出现一行什么都没有。 */
  ok('★ 卡内每一行都有可点出口（有链给链，没链给「源站」兜底）',
    md.n > 0 && md.noOut === 0, `行内无出口的卡 ${md.noOut} 张`);
  /* ★★ 反向断言组：旧「一卡一条」形态的痕迹必须清零。
     ⚠️ 单独一条反向断言会被「整卡没渲染」满足 ⇒ 上面已有 grp/cov/gl 三条正向锚点。 */
  ok('★★ 反向：MOD 卡面已无旧「一卡一条」元素（.md-lk / .md-go 归零）',
    md.deadEl === 0, `残留 ${md.deadEl} 张`);
  ok('★★ 反向：三个恒真/废口径的旧开关已删（#mdToggleLib / #svPhone / #trToggleLib）',
    ['mdToggleLib', 'svPhone', 'trToggleLib'].every((i) => !q('#' + i)));
  ok('★ 正向锚点：三个分区各有新的「来源」下拉（#mdSrc / #svSrc / #trSrc）',
    ['mdSrc', 'svSrc', 'trSrc'].every((i) => !!q('#' + i)));
  ok('★ 正向锚点：组卡有「展开全部 N 条」按钮（.grp-more）',
    qa('#mdGrid .emu-card .grp-more').length > 0,
    `实际 ${qa('#mdGrid .emu-card .grp-more').length} 个`);
  /* 盘口按钮是这一区的核心：用户要的是**能直接取件**的出口，不是跳源站首页 */
  {
    const a = q('#mdGrid .emu-card .gl-lk a');
    const links = qa('#mdGrid .emu-card .gl-lk a');
    ok('MOD 卡内通道是真外链（href 非 # 、target=_blank）',
      !!a && /^https?:/.test(a.getAttribute('href') || '') && a.getAttribute('target') === '_blank',
      a ? a.getAttribute('href') : '(缺失)');
    ok('通道按钮挂了盘口配色类 bd-*（与详情页下载弹窗同源语义）',
      links.filter((x) => /(^|\s)bd-/.test(x.className)).length > 0,
      `${links.filter((x) => /(^|\s)bd-/.test(x.className)).length} / ${links.length}`);
  }
  ok('MOD 计数文案是「共 N 款游戏」（卡是游戏粒度，写「条」会和卡内条数打架）',
    /共 [\d,]+ 款游戏/.test(q('#mdCount').textContent || ''), q('#mdCount').textContent || '');
  ok('MOD 统计条已回填 4 格', qa('#mdStats .st').length === 4, `实际 ${qa('#mdStats .st').length}`);
  ok('MOD 排序项由 JS 从 GRP_META 生成（3 个 .emu-sort，第一个默认 on）',
    qa('#mdSorts .emu-sort').length === 3 && qa('#mdSorts .emu-sort')[0].classList.contains('on'),
    `实际 ${qa('#mdSorts .emu-sort').length} 项 ｜ on=${(q('#mdSorts .emu-sort.on') || {}).textContent || '(无)'}`);
  /* 点封面按钮：有 libId 就进详情；没命中要给出明确提示（不能点了没反应） */
  {
    const withLib = qa('#mdGrid .emu-card').find((c) => c.dataset.lib);
    if (withLib) {
      const btn = withLib.querySelector('.cov-btn');
      ok('带 libId 的组卡有「查看游戏详情」按钮（.cov-btn，压在封面上）', !!btn);
      click(btn || withLib.querySelector('h4'));
      await sleep(1500);
      ok('点组卡封面按钮 → 打开游戏详情抽屉',
        q('#drawer').classList.contains('show'), q('#drawer').className);
      W.closeDetail(); await sleep(300);
    } else {
      ok('组卡正文点击（本轮无命中样本，跳过）', true, '无 data-lib 卡片');
    }
  }
  /* ★★ v10.48：「查看全部 N 条」= 打开**弹窗**列全量 + 弹窗内搜索。
     ⚠️ 这组断言守的是**行为变了**，不是「换个地方还能用」：
        旧实现是原地铺开（`grpExpand`，上限 300），用户口径「不要展开」。
        所以必须同时断「弹窗开了」**和**「卡内行数没变」——只断前者的话，
        有人把原地铺开加回来也照样绿。 */
  {
    const more = qa('#mdGrid .emu-card .grp-more')[0];
    if (more) {
      const card = more.closest('.emu-card');
      const before = card.querySelectorAll('.gl .gl-i').length;
      const errN = e1.length;
      click(more);
      await sleep(2200);
      const pop = q('#dlPop');
      ok('★★ 点「查看全部 N 条」→ 打开弹窗（不再原地铺开）', !!pop && !pop.hidden);
      const after = card.querySelectorAll('.gl .gl-i').length;
      ok('★★ 反向：卡内行数**没变**（原地铺开已废弃，卡片不再被撑长）',
        after === before, `${before} → ${after} 行`);
      const box = q('#grpAllList');
      const rows = box ? box.querySelectorAll('.gl-i').length : 0;
      ok('★ 弹窗内铺出全量条目（多于卡内明文 3 条）', rows > before, `${before} → ${rows} 行`);
      ok('★ 弹窗内每行都有可点出口（有链给链 / 没链给「源站」兜底）',
        rows > 0 && [...box.querySelectorAll('.gl-i')].every((r) => r.querySelector('.gl-lk a')));
      ok('★ 弹窗副标题写明总数（「共 N 条 · 可在下方搜索」）',
        /共\s*[\d,]+\s*条/.test((q('#dlSub') || {}).textContent || ''), (q('#dlSub') || {}).textContent || '');
      /* 搜索：本地过滤已取回的数组。正反两条都要 ——
         只断「搜不到」会被「过滤函数恒返 0」满足，只断「搜得到」会被「恒返全部」满足。 */
      const qi = q('#grpAllQ');
      ok('★ 弹窗内有搜索框 #grpAllQ', !!qi);
      if (qi) {
        const firstT = (box.querySelector('.gl-i .t') || {}).textContent || '';
        const cand = firstT.replace(/[^0-9A-Za-z\u4e00-\u9fa5]/g, '').slice(0, 2);
        const type = async (v) => {
          qi.value = v;
          qi.dispatchEvent(new W.Event('input', { bubbles: true }));
          await sleep(140);
          return box.querySelectorAll('.gl-i').length;
        };
        const hitOk = await type(cand);
        const hitNo = await type('zzzzq');
        ok('★★ 弹窗内搜索真的过滤（正：命中原有关键词 / 反：无关键词归零）',
          cand.length > 1 && hitOk > 0 && hitOk <= rows && hitNo === 0,
          `关键词「${cand}」→ ${hitOk} 行 ｜ 「zzzzq」→ ${hitNo} 行`);
        const back = await type('');
        ok('★ 清空关键词后恢复全量', back === rows, `${rows} → ${back} 行`);
      }
      ok('打开弹窗 / 搜索过程中不抛异常', e1.length === errN, e1.slice(errN).join(' | '));
      if (typeof W.closeDownload === 'function') W.closeDownload();
      await sleep(220);
      ok('★ 关弹窗后卡内行数仍是 3（不会把全量留在卡里）',
        card.querySelectorAll('.gl .gl-i').length === before,
        `${card.querySelectorAll('.gl .gl-i').length} 行`);
    } else {
      ok('查看全部（本轮无 overflow 组，跳过）', true, '无 .grp-more');
    }
  }
  /* ★ 搜索真的接了后端（来源下拉在本轮数据下多为单源，用搜索验接口更稳） */
  {
    const si = q('#mdSearch');
    const before = qa('#mdGrid .emu-card').length;
    ok('MOD 有搜索框 #mdSearch', !!si);
    if (si) {
      si.value = '赛博朋克';
      si.dispatchEvent(new W.Event('input', { bubbles: true }));
      await sleep(1800);
      const after = qa('#mdGrid .emu-card').length;
      ok('★ 搜索词 → 列表按关键词收窄（证明前端真的打 /api/res/groups?q=…）',
        after > 0 && after < before, `${before} → ${after} 张`);
      ok('搜索命中的第一张卡就是「赛博朋克2077」',
        /赛博朋克/.test((q('#mdGrid .emu-card') || {}).dataset?.name || ''),
        (q('#mdGrid .emu-card') || {}).dataset?.name || '(缺失)');
      si.value = '';
      si.dispatchEvent(new W.Event('input', { bubbles: true }));
      await sleep(1500);
    }
  }

  /* ============================================================
   * 三、存档分区 —— v10.47 口径：只出**真有存档文件**的游戏
   * ============================================================ */
  click(q('#resTabs .res-tab[data-et="sv"]'));
  await sleep(2000);
  ok('切「存档」→ #resSaves 显示、#mods 同时收起',
    !q('#resSaves').classList.contains('et-hide') && q('#mods').classList.contains('et-hide'));
  ok('切「存档」→ 页签高亮同步', (q('#resTabs .res-tab.on') || {}).dataset?.et === 'sv');
  {
    const sv = shapeOf(qa, '#svGrid');
    ok('存档网格已渲染组卡', sv.n > 0, `实际 ${sv.n} 张`);
    ok('★★ 存档卡全部是聚合卡 .emu-card.grp（与 MOD 同一种卡形）', sv.n > 0 && sv.grp === sv.n,
      `${sv.grp} / ${sv.n}`);
    ok('存档卡都有封面槽 / 分类徽标 / 卡内行（三处同形）',
      sv.n > 0 && sv.cov === sv.n && sv.meta === sv.n && sv.gl === sv.n, shapeStr(sv));
    ok('★★ 存档卡内明文最多 3 条（未展开时）', sv.n > 0 && sv.over3 === 0, `超 3 条的卡 ${sv.over3} 张`);
    ok('★★ 反向：存档卡面已无旧「位置卡」元素（.paths / .cp / .sv-open 归零）',
      sv.deadEl === 0, `残留 ${sv.deadEl} 张`);
    /* ★★ 本轮核心口径：这一页只列「真有存档」的游戏 ⇒ 卡内每一行都应有**下载通道**。
       实测 /api/res/stats?cat=saves 的 withLink = items（100%）。所以这条不该有例外；
       若哪天出现「只有源站兜底」的行，说明混进了没有文件的条目 —— 正是用户要去掉的形态。 */
    const rows = qa('#svGrid .emu-card .gl .gl-i');
    const withCh = rows.filter((r) => r.querySelector('.gl-lk a:not(.bd-other)')).length;
    ok('★★ 存档卡内每行都带**真实下载通道**（不是「去源站」兜底）——「只展示真有存档的」',
      rows.length > 0 && withCh === rows.length,
      `${withCh} / ${rows.length} 行有真通道`);
    ok('存档计数文案是「共 N 款游戏」', /共 [\d,]+ 款游戏/.test(q('#svCount').textContent || ''),
      q('#svCount').textContent || '');
    ok('存档统计条已回填 4 格', qa('#svStats .st').length === 4, `实际 ${qa('#svStats .st').length}`);
    ok('存档来源下拉已填充（「全部来源」+ 至少 1 个源）', qa('#svSrc option').length >= 2,
      qa('#svSrc option').map((o) => o.textContent).join(' ｜ '));
  }
  /* 点整卡 → 进详情（组卡的统一分流） */
  {
    const svCard = qa('#svGrid .emu-card').find((c) => c.dataset.lib);
    if (svCard) {
      click(svCard.querySelector('.cov-btn') || svCard.querySelector('h4'));
      await sleep(1500);
      ok('点存档组卡 → 打开游戏详情抽屉', q('#drawer').classList.contains('show'), q('#drawer').className);
      W.closeDetail(); await sleep(300);
    } else {
      ok('存档组卡点击（本轮无命中样本，跳过）', true, '无 data-lib 卡片');
    }
  }

  /* ============================================================
   * 四、修改器分区 —— v10.47：同样按游戏聚合（GCM + GTrainers + FR 三源）
   * ============================================================ */
  click(q('#resTabs .res-tab[data-et="tr"]'));
  await sleep(2000);
  ok('切「修改器」→ #resTrainers 显示、#resSaves 同时收起',
    !q('#resTrainers').classList.contains('et-hide') && q('#resSaves').classList.contains('et-hide'));
  ok('切「修改器」→ 页签高亮同步', (q('#resTabs .res-tab.on') || {}).dataset?.et === 'tr');
  {
    const tr = shapeOf(qa, '#trGrid');
    ok('修改器网格已渲染组卡', tr.n > 0, `实际 ${tr.n} 张`);
    ok('★★ 修改器卡全部是聚合卡 .emu-card.grp（三区统一卡形）', tr.n > 0 && tr.grp === tr.n,
      `${tr.grp} / ${tr.n}`);
    ok('修改器卡都有封面槽 / 分类徽标 / 卡内行（三处同形）',
      tr.n > 0 && tr.cov === tr.n && tr.meta === tr.n && tr.gl === tr.n, shapeStr(tr));
    ok('★★ 修改器卡内明文最多 3 条（未展开时）', tr.n > 0 && tr.over3 === 0, `超 3 条的卡 ${tr.over3} 张`);
    ok('★★ 反向：修改器卡面已无旧「导流卡」元素（.tr-go / .tr-note 归零）',
      tr.deadEl === 0, `残留 ${tr.deadEl} 张`);
    ok('修改器卡带来源徽标 .tg.src（卡内可能混源，要能看出条目来自哪）',
      qa('#trGrid .emu-card .tg.src').length > 0, `实际 ${qa('#trGrid .emu-card .tg.src').length} 个`);
    ok('修改器卡内每行都有可点出口（有链给链，GCM 走来源站兜底）',
      tr.n > 0 && tr.noOut === 0, `行内无出口的卡 ${tr.noOut} 张`);
    /* ★★ v10.48：修改器「第三方来源」跳转链（用户口径：
       「修改器中的第三方修改器来源我也需要你提供跳转链接」）。
       根因回顾：上游 official_url 一直有（93.7%），是抓取器把它丢了，
       且 res-groups 原先的 page 指向 libUrl（**端游库**的 xdgame 链接）。
       ⚠️ 必须通过「查看全部」弹窗取全量来验：卡内只铺 3 条，
          GCM 条目按 ts 排在 gt 之后，光看卡面会因为样本缺失而恒真。 */
    {
      const trMore = qa('#trGrid .emu-card .grp-more')[0];
      if (trMore) {
        const errN = e1.length;
        click(trMore);
        await sleep(2200);
        const box = q('#grpAllList');
        const sel = 'a[class*="bd-fling"],a[class*="bd-cheat"],a[class*="bd-src"]';
        const srcLinks = box ? [...box.querySelectorAll(sel)] : [];
        ok('★★ 修改器「查看全部」弹窗里出现第三方来源跳转按钮（bd-fling / bd-cheat / bd-src）',
          srcLinks.length > 0, `实际 ${srcLinks.length} 个`);
        const bad = srcLinks.filter((a) => /xdgame\.com|jidiyouxi\.com|gamezonelabs\.com\/products/.test(a.getAttribute('href') || ''));
        ok('★★ 反向：来源按钮**不是**端游库链接（旧 bug 就是 page 指向 libUrl=xdgame）',
          srcLinks.length > 0 && bad.length === 0, `误指 ${bad.length} 个`);
        ok('来源按钮 href 是真外链（http(s) + target=_blank）',
          srcLinks.length > 0 && srcLinks.every((a) => /^https?:/.test(a.getAttribute('href') || '')
            && a.getAttribute('target') === '_blank'),
          (srcLinks[0] || {}).getAttribute ? String(srcLinks[0].getAttribute('href')).slice(0, 60) : '(无)');
        ok('来源按钮带短标签（≤12 字符，卡面 slice(0,12) 不会被截成半截词）',
          srcLinks.length > 0 && srcLinks.every((a) => (a.textContent || '').trim().length <= 12),
          srcLinks.slice(0, 3).map((a) => (a.textContent || '').trim()).join(' / '));
        ok('打开来源弹窗不抛异常', e1.length === errN, e1.slice(errN).join(' | '));
        if (typeof W.closeDownload === 'function') W.closeDownload();
        await sleep(220);
      } else {
        ok('修改器「查看全部」（无 overflow 组，跳过）', true, '无 .grp-more');
      }
    }
    ok('修改器计数文案是「共 N 款游戏」', /共 [\d,]+ 款游戏/.test(q('#trCount').textContent || ''),
      q('#trCount').textContent || '');
    ok('修改器统计条已回填 4 格', qa('#trStats .st').length === 4, `实际 ${qa('#trStats .st').length}`);
    ok('修改器来源下拉已填充（「全部来源」+ 至少 1 个源）', qa('#trSrc option').length >= 2,
      qa('#trSrc option').map((o) => o.textContent).join(' ｜ '));
    /* 排序项点一下：证明排序真的接后端（顺序变化不稳，这里只钉「不抛异常 + on 转移」） */
    const sorts = qa('#trSorts .emu-sort');
    if (sorts.length >= 3) {
      const errN = e1.length;
      click(sorts[2]);
      await sleep(1800);
      ok('点排序项「按游戏名」→ 不抛异常且高亮转移（证明排序真的打后端）',
        e1.length === errN && sorts[2].classList.contains('on'), `${sorts[2].textContent} on=${sorts[2].classList.contains('on')}`);
    } else {
      ok('修改器排序项（不足 3 项，跳过）', true, `实际 ${sorts.length} 项`);
    }
  }

  /* ---- 底 Tab「端游资源」：切页签而不是重载（且不抛异常） ---- */
  const errN2 = e1.length;
  click(q('#tabbar a[data-tab="md"]'));
  await sleep(600);
  ok('点底部「端游资源」不再抛异常', e1.length === errN2, e1.slice(errN2).join(' | '));
  ok('点底部「端游资源」切回 MOD 页签', !q('#mods').classList.contains('et-hide'));
  ok('data-page 标记为 resources（主源脚本据此放行「首页」真跳转）',
    W.document.body.getAttribute('data-page') === 'resources',
    String(W.document.body.getAttribute('data-page')));
  /* ★ v10.23 同款：先摘掉 style/script 再取文本，否则 CSS 注释里的选择器片段会假红
     ★★ 判据必须要求「括号内有声明冒号」—— 原判据 [.#]\w+\s*\{[^}]*\} 太宽，
        被 GTrainers 的**数据标题**撞红了：那条修改器叫「… v1.0 {FLiNG}」（FLiNG 是修改器
        作者的署名约定），`.0 {FLiNG}` 长得正好像一条 CSS 规则。CSS 声明块里必有 属性:值，
        数据标题里没有 —— 用这个差异区分，而不是删断言。
     ★★ 证据串同时带**抓到的那一段**：本条变红过一次，没有片段就只能猜。 */
  {
    const bt = W.document.body.cloneNode(true);
    [...bt.querySelectorAll('style,script')].forEach((n) => n.remove());
    const BODY_TXT = bt.textContent || '';
    const hit = BODY_TXT.match(/[.#][\w-]+\s*\{[^}]*:[^}]*\}/);
    ok('页面上不残留裸 CSS 文本（专属 CSS 未掉到 </style> 外）',
      !hit, hit ? ('抓到：' + hit[0].slice(0, 90)) : BODY_TXT.slice(0, 40).replace(/\s+/g, ' '));
  }
  /* ---- 页签数字口径：必须等于 /api/res/stats?list=1 的 groups（游戏组数），不是 items ---- */
  {
    try {
      const s = await fetch(BASE + '/api/res/stats?list=1').then((r) => r.json());
      const c = (s && s.cats) || {};
      const num = (el) => Number(String((el || {}).textContent || '').replace(/[^\d]/g, '')) || 0;
      const pairs = [['tabNumMd', 'mod'], ['tabNumSv', 'saves'], ['tabNumTr', 'trainers']];
      const bad = pairs.filter(([id, k]) => !(c[k] && num(q('#' + id)) === c[k].groups));
      ok('★ 页签数字 == /api/res/stats 的 groups（游戏组数口径，三处一致）',
        bad.length === 0,
        pairs.map(([id, k]) => `${k}:页签${num(q('#' + id))}/接口${c[k] ? c[k].groups : '?'}`).join(' ｜ '));
    } catch (e) {
      ok('页签数字口径核对（接口异常）', false, String((e && e.message) || e));
    }
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
