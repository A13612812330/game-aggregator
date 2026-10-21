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
 * ★★ v10.49 改的是**样式**（用户口径「卡片中的内容每条显示一行即可多余字显示省略号即可」）：
 *   条目标题 `.gl-i .t` 由「折 2 行」改「单行省略」，弹窗里那条「放开折行」的覆盖删掉，
 *   卡内与弹窗共用同一条规则。
 *   ⚠️ 样式断言的写法有坑（本轮踩到）：jsdom 不做布局，只能读 CSS **规则体**文本 ——
 *      所以① 断言要取 `{…}` **内部**，不能查「整页含某字符串」（注释里写一个反例就假绿了）；
 *      ② 必须配 DOM 断言钉住 `title`：单行省略若把 `title` 也删了，那是**删除**而不是折叠。
 *   ⚠️ 反向断言钉住 `line-clamp`：它和 `nowrap` 并存时 clamp 会赢 ⇒ 单行省略**静默失效**。
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

/* 四区共用的卡形取样器 —— 「按游戏聚合」的核心判据只有这一套，别在四个区各写一遍
 *
 * ★★ v10.97 口径又变了一次（用户：「端游在页面显示参考手游，只需要游戏名称 +
 *    游戏原名 + 大小热度等重要信息」）：
 *    卡面**不再铺条目行**（`.gl` / `.gl-i`），只留 封面 · 名称 · 原名 · 数字胶囊 · 卡底按钮。
 *    ⇒ 取样器里 `gl` 从「应该等于 n」翻成「应该等于 0」，
 *      新增 `name` / `pill` / `hot` / `more` 四条正向判据。
 *    ⚠️ `gl` 这一项**必须留着**（别删）：它现在是反向断言，专门拦「有人把卡内行铺回来」。
 *       只删不加的话，卡形退回旧形态照样全绿。
 */
function shapeOf(qa, sel) {
  const cards = qa(sel + ' .emu-card');
  return {
    n: cards.length,
    grp: cards.filter((c) => c.classList.contains('grp')).length,
    cov: cards.filter((c) => c.querySelector('.cov')).length,
    meta: cards.filter((c) => c.querySelector('.meta .tg')).length,
    /* 卡面名称 == data-name（展示名只有一份，渲染时不会又拼回 `/` 分隔原串） */
    name: cards.filter((c) => {
      const h = c.querySelector('h4');
      return !!h && (h.textContent || '') === (c.dataset.name || '');
    }).length,
    /* 条数胶囊（每张卡必有）+ 热度胶囊（有热度才有） */
    pill: cards.filter((c) => c.querySelector('.meta .pill')).length,
    hot: cards.filter((c) => c.querySelector('.meta .pill.hot')).length,
    /* 卡底唯一动作（本体区叫 .bd-get / .grp-more 两种，见 bdCard 三态） */
    more: cards.filter((c) => c.querySelector('.grp-more, .bd-get')).length,
    /* ↓ 反向判据：卡面不该再有条目行（v10.97 删的就是它） */
    gl: cards.filter((c) => c.querySelector('.gl .gl-i')).length,
    deadEl: cards.filter((c) => c.querySelector('.md-lk,.md-go,.sv-open,.tr-go,.tr-note,.paths,.cp')).length,
    noCat: cards.filter((c) => !c.dataset.cat).length,
  };
}
const shapeStr = (s) => `卡 ${s.n} ｜ grp ${s.grp} ｜ cov ${s.cov} ｜ meta ${s.meta}`
  + ` ｜ 名对 ${s.name} ｜ 条数胶囊 ${s.pill} ｜ 热度胶囊 ${s.hot} ｜ 卡底动作 ${s.more}`
  + ` ｜ 卡内行 ${s.gl}（应为 0）｜ 残留旧元素 ${s.deadEl} ｜ 无 data-cat ${s.noCat}`;

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

  /* ★★ v10.96：页签从 3 个变 4 个（新增「本体」并作为默认分区）。
     —— 用户口径：「端游资源我需要一个本体的页面（目前已有 Mod/修改器/存档）」
     —— 本体放**第一位**并作默认：它是「拿到游戏」的第一步，藏在最后一个等于没做。 */
  ok('切换条 #resTabs 有 4 个平级页签', qa('#resTabs .res-tab').length === 4, `实际 ${qa('#resTabs .res-tab').length}`);
  ok('四页签 data-et 依次为 bd/md/sv/tr',
    qa('#resTabs .res-tab').map((b) => b.dataset.et).join(',') === 'bd,md,sv,tr',
    qa('#resTabs .res-tab').map((b) => b.dataset.et).join(','));
  ok('第 1 个页签是「本体」', /本体/.test((qa('#resTabs .res-tab')[0] || {}).textContent || ''),
    (qa('#resTabs .res-tab')[0] || {}).textContent || '(缺失)');
  ok('第 2 个页签是「MOD」', /MOD/.test((qa('#resTabs .res-tab')[1] || {}).textContent || ''),
    (qa('#resTabs .res-tab')[1] || {}).textContent || '(缺失)');
  ok('第 3 个页签是「存档」', /存档/.test((qa('#resTabs .res-tab')[2] || {}).textContent || ''),
    (qa('#resTabs .res-tab')[2] || {}).textContent || '(缺失)');
  ok('第 4 个页签是「修改器」', /修改器/.test((qa('#resTabs .res-tab')[3] || {}).textContent || ''),
    (qa('#resTabs .res-tab')[3] || {}).textContent || '(缺失)');
  ok('默认只显示「本体」（其余三个带 et-hide）',
    !q('#resBody').classList.contains('et-hide')
    && q('#mods').classList.contains('et-hide')
    && q('#resSaves').classList.contains('et-hide')
    && q('#resTrainers').classList.contains('et-hide'));
  /* ⚠️ 数字胶囊只要求 MOD/存档/修改器三个**回填**：本体那个来自另一个接口
     （/api/jiditopics/stats），jsdom 里拿不到就留「—」是**正确**的降级，不该算红。
     ⚠️ 先轮询等一会（最多 6s）：fillTabNums 是 boot 后的异步请求，固定 sleep 在机器忙时
        会取样到「—」，把它误判成「从来没回填」（本轮实测红过一次，非回归）。 */
  {
    const pending = () => qa('#resTabs .res-tab').slice(1)
      .some((t) => /^[—\-]$/.test(((t.querySelector('b') || {}).textContent || '').trim()));
    for (let i = 0; i < 40 && pending(); i++) await sleep(150);
    ok('MOD / 存档 / 修改器三个页签数字胶囊都已回填（非占位 —）',
      !pending(),
      qa('#resTabs .res-tab b').map((b) => b.textContent.trim()).join(' / '));
  }

  /* ============================================================
   * 一·B、v10.97 本体分区（默认页签）卡形 —— 与另三区同一张脸
   * ============================================================
   * 用户口径：「端游在页面显示参考手游，只需要游戏名称 + 游戏原名 + 大小热度等重要信息」。
   * ⚠️ 本体卡**没有** `data-cat`（它不走 `grpCard`，是 `bdCard` 另一套渲染器）——
   *    所以不能直接拿 `shapeOf().noCat` 判它，改用 `data-tid` 是它自己的主键。
   */
  {
    for (let i = 0; i < 80 && qa('#bdGrid .emu-card').length === 0; i++) await sleep(150);
    const bd = shapeOf(qa, '#bdGrid');
    ok('★ v10.97 本体网格已渲染组卡（默认页签，进页面就加载）', bd.n > 0, `实际 ${bd.n} 张`);
    ok('★ v10.97 本体卡都是聚合卡 .emu-card.grp（与 MOD/存档/修改器同一张脸）',
      bd.n > 0 && bd.grp === bd.n, `${bd.grp} / ${bd.n}`);
    ok('★ v10.97 本体卡都有封面槽 / 分类徽标 / 条数胶囊',
      bd.n > 0 && bd.cov === bd.n && bd.meta === bd.n && bd.pill === bd.n, shapeStr(bd));
    ok('★★ v10.97 本体卡面**没有**条目行（用户口径：只留名称/原名/大小热度）',
      bd.n > 0 && bd.gl === 0, `卡内行 ${bd.gl} 张`);
    ok('★ v10.97 正向锚点：本体卡底都有一个动作（未抓过「查本体下载」/ 抓过「查看 N 个资源帖」）',
      bd.n > 0 && bd.more === bd.n, `卡底动作 ${bd.more} / ${bd.n}`);
    ok('★ v10.97 本体卡带 data-tid（抓取/弹窗都靠它认话题）',
      bd.n > 0 && qa('#bdGrid .emu-card').every((c) => !!c.dataset.tid));
    /* 热度胶囊：本体区的热度直接来自话题浏览量（dpv），覆盖率近 100% ⇒ 必须真的渲染出来。
       这一条是上一条反向断言的正向锚点 —— 卡面要是整块没渲染，`gl === 0` 会平白变绿。 */
    ok('★ v10.97 正向锚点：本体卡真的渲染出热度胶囊 🔥（卡不是空壳）',
      bd.hot > 0, `带热度胶囊 ${bd.hot} / ${bd.n} 张`);
    /* ★★ v10.97：用户要的三样「重要信息」都要在卡面上 —— 原名 / 体积 / 热度。
       判据与接口对齐（不是断「≥80%」这种阈值）：接口有几款带该字段，卡面就该渲染几个。 */
    {
      let j = null;
      try { j = await fetch(BASE + '/api/jiditopics/list?sort=hot&limit=24&offset=0').then((r) => r.json()); } catch (e) {}
      const items = (j && j.items) || [];
      const nEn = items.filter((x) => x.titleEn).length;
      const nSize = items.filter((x) => x.size).length;
      ok('★★ v10.97 本体卡原名（.alt）数量 == 接口里有 titleEn 的条数（「游戏原名」上卡面）',
        nEn > 0 ? qa('#bdGrid .bd-card > .bd > .alt').length === nEn : true,
        `卡面 ${qa('#bdGrid .bd-card > .bd > .alt').length} ｜ 接口 ${nEn}`);
      ok('★★ v10.97 本体卡体积胶囊数量 == 接口里有 size 的条数（「大小」上卡面）',
        nSize > 0 ? qa('#bdGrid .bd-card .meta .pill[title="游戏体积"]').length === nSize : true,
        `卡面 ${qa('#bdGrid .bd-card .meta .pill[title="游戏体积"]').length} ｜ 接口 ${nSize}`);
    }
  }

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
  /* ★ v10.96：默认分区改成「本体」⇒ 断言 MOD 前先显式切过去。
     断言的**对象**没变（MOD 分区的形态），变的只是进入路径。 */
  W.switchResTab('md');
  for (let i = 0; i < 60 && qa('#mdGrid .emu-card').length === 0; i++) await sleep(150);

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
  /* ★★ v10.97 卡面改形（用户口径「只需要游戏名称+游戏原名+大小热度等重要信息」）：
     卡内**不再铺前 3 条条目行**，全部条目收进卡底按钮打开的弹窗。
     ⚠️ 这一组是**反向**断言（旧形态归零），下面紧跟三条正向锚点（名称/胶囊/卡底按钮）——
        没有正向锚点的话，「整张卡没渲染」会让反向断言全部平白变绿。 */
  ok('★★ v10.97 反向：MOD 卡面不再铺条目行 .gl .gl-i（旧「卡内前 3 条」形态已废）',
    md.n > 0 && md.gl === 0, `还铺了行的卡 ${md.gl} 张`);
  ok('★ v10.97 正向锚点：卡面名称 == data-name（显示的是展示名，不是 `/` 拼接原串）',
    md.n > 0 && md.name === md.n, `${md.name} / ${md.n}`);
  ok('★ v10.97 正向锚点：每张卡都有条数胶囊（.meta .pill「N 条」）',
    md.n > 0 && md.pill === md.n, `${md.pill} / ${md.n}`);
  ok('★★ v10.97 每张卡底都有唯一动作按钮（.grp-more「查看 N 条下载 ▸」）',
    md.n > 0 && md.more === md.n, `${md.more} / ${md.n}`);
  /* 热度是真的算出来了，不是渲染个空壳 —— 用户明确要求「大小热度」上卡面。
     ⚠️ 只断「有 .pill.hot」不对：数值可能全是 0 还画个 🔥 0。所以同时断数值 > 0。 */
  {
    const hotPills = qa('#mdGrid .emu-card .meta .pill.hot');
    const hotNums = hotPills.map((p) => Number(String(p.textContent).replace(/[^\d]/g, '')) || 0);
    ok('★★ v10.97 MOD 卡真的渲染出「热度」胶囊，且数值 > 0（不是 🔥 0 空壳）',
      hotPills.length > 0 && hotNums.filter((v) => v > 0).length === hotPills.length,
      `${hotPills.length} 个 ｜ 首个 ${hotPills[0] ? hotPills[0].textContent.trim() : '(无)'}`);
    ok('★ v10.97 热度胶囊带 title，写明**这个数从哪来**（话题浏览量 / 下载量合计差两个数量级）',
      hotPills.length > 0 && hotPills.every((p) => /热度：/.test(p.getAttribute('title') || '')),
      (hotPills[0] || {}).getAttribute ? hotPills[0].getAttribute('title') : '(无)');
  }
  ok('★★ 反向：MOD 卡面已无旧「一卡一条」元素（.md-lk / .md-go 归零）',
    md.deadEl === 0, `残留 ${md.deadEl} 张`);
  ok('★★ 反向：三个恒真/废口径的旧开关已删（#mdToggleLib / #svPhone / #trToggleLib）',
    ['mdToggleLib', 'svPhone', 'trToggleLib'].every((i) => !q('#' + i)));
  ok('★ 正向锚点：三个分区各有新的「来源」下拉（#mdSrc / #svSrc / #trSrc）',
    ['mdSrc', 'svSrc', 'trSrc'].every((i) => !!q('#' + i)));
  /* ★★ v10.97 排序默认值：用户口径「端游四个模块都需默认按照热度排序」。
     排序条由 JS 从 GRP_META.sorts 生成，第 1 项必须就是「最热门」，且初始高亮在它上面。
     ⚠️ 断言同时钉「项数 4」与「首项文本」：只钉项数的话，把 hot 挪到末位照样绿。 */
  ok('★★ v10.97 MOD 排序项由 GRP_META 生成（4 项，首项「最热门」且默认高亮）',
    qa('#mdSorts .emu-sort').length === 4
    && /最热门/.test((qa('#mdSorts .emu-sort')[0] || {}).textContent || '')
    && qa('#mdSorts .emu-sort')[0].classList.contains('on'),
    `实际 ${qa('#mdSorts .emu-sort').length} 项 ｜ 首项 ${(qa('#mdSorts .emu-sort')[0] || {}).textContent}`
    + ` ｜ on=${(q('#mdSorts .emu-sort.on') || {}).textContent || '(无)'}`);
  ok('MOD 计数文案是「共 N 款游戏」（卡是游戏粒度，写「条」会和卡内条数打架）',
    /共 [\d,]+ 款游戏/.test(q('#mdCount').textContent || ''), q('#mdCount').textContent || '');
  ok('MOD 统计条已回填 4 格', qa('#mdStats .st').length === 4, `实际 ${qa('#mdStats .st').length}`);
  /* 封面按钮：压在封面上的「查看游戏详情」，与整卡点击**同一个动作**（都进详情）。
   * ★ v10.98：两条路合并成一条（`openResDetail(card)`），所以这里验的是「按钮还在、
   *   且它确实走得通」—— 不再需要区分「点按钮进详情 / 点正文进弹窗」。
   *   ⚠️ 详情是**异步**的（先 /api/library/item 再 /api/detail/merged），
   *     固定 sleep(1500) 在机器忙时会取样到「还没开」，必须轮询等待（本轮实测红过一次）。 */
  {
    const withLib = qa('#mdGrid .emu-card').find((c) => c.dataset.lib);
    if (withLib) {
      const btn = withLib.querySelector('.cov-btn');
      ok('带 libId 的组卡有「查看游戏详情」按钮（.cov-btn，压在封面上）', !!btn);
      if (btn) {
        click(btn);
        for (let i = 0; i < 80 && !q('#drawer').classList.contains('show'); i++) await sleep(200);
        ok('点组卡封面按钮 → 打开游戏详情抽屉',
          q('#drawer').classList.contains('show'), q('#drawer').className);
        W.closeDetail(); await sleep(300);
      }
    } else {
      ok('组卡封面按钮（本轮无命中样本，跳过）', true, '无 data-lib 卡片');
    }
  }
  /* ★★ v10.98 整卡点击 = 打开**游戏详情**（v10.97 那版让给了弹窗，方向错了）
     用户口径：「端游模块的卡片点击是弹详情页，然后有个按钮 —— 点击查看对应模块的弹窗
     （同下载按钮，不过默认页面自动选择到默认模块）」。
     ⇒ 判据三层，缺一层就会假绿：
        ① 详情抽屉真的开了；
        ② 反向：这一刻**没有**顺手把下载弹窗也开了（一次点击只做一个动作）；
        ③ 详情底栏多出「查看 <模块> 资源」，data-dl-tab 是**弹窗页签键**（mod），
           点它才开弹窗、且默认页签落在 mod。
     ⚠️ 为什么要断 ③ 的 data-dl-tab 而不是只看按钮在不在：分区名与页签键不同
        （saves/trainers ↔ save/modifier），传错时 openUniDownload 会**静默**落回 body，
        按钮看起来一样、点开永远是「本体」。 */
  {
    const card = qa('#mdGrid .emu-card').find((c) => c.dataset.lib);
    if (card) {
      const errN = e1.length;
      click(card.querySelector('h4'));
      for (let i = 0; i < 80 && !q('#drawer').classList.contains('show'); i++) await sleep(200);
      ok('★★ v10.98 点整卡正文 → 打开游戏详情抽屉',
        q('#drawer').classList.contains('show'), q('#drawer').className);
      ok('★★ v10.98 反向：点整卡**不**同时开下载弹窗（一次点击只做一个动作）',
        !q('#dlPop') || q('#dlPop').hidden,
        q('#dlPop') ? `hidden=${q('#dlPop').hidden}` : '(无 #dlPop)');
      const rb = q('#dlStrip .ds-res');
      ok('★★ v10.98 详情底栏出现「查看 MOD 资源」按钮', !!rb,
        rb ? rb.textContent.trim().replace(/\s+/g, ' ') : (q('#dlStrip') || {}).textContent);
      ok('★ 该按钮 data-dl-tab = mod（页签键，不是分区名 md）',
        !!rb && rb.dataset.dlTab === 'mod', rb ? 'tab=' + rb.dataset.dlTab : '');
      ok('★ 该按钮的 id 取卡上的 libId（模块条目归属记录）',
        !!rb && rb.dataset.dlId === card.dataset.lib,
        rb ? rb.dataset.dlId + ' vs ' + card.dataset.lib : '');
      if (rb) {
        click(rb);
        for (let i = 0; i < 80 && (!q('#dlPop') || q('#dlPop').hidden); i++) await sleep(200);
        const on = q('#dlModTabs .dlm.on');
        ok('★★ 点它 → 打开下载弹窗且默认页签自动落在 MOD（不用再手点一次）',
          !!q('#dlPop') && !q('#dlPop').hidden && !!on && on.dataset.dlm === 'mod',
          on ? 'on=' + on.dataset.dlm : '(无页签)');
        ok('点模块按钮打开弹窗不抛异常', e1.length === errN, e1.slice(errN).join(' | '));
        if (typeof W.closeDownload === 'function') W.closeDownload();
        await sleep(260);
      }
      W.closeDetail(); await sleep(300);
      /* ⚠️ 不能在关详情后直接判 `.ds-res` 消失：closeDetail 只是去掉 .show，
         抽屉 DOM 还是上一次那份，判它必然红（本轮实测踩到）。
         真正的行为是「下次打开会重画」—— 所以用**普通入口**再开一次来验语境已清。 */
      await W.openDetailById(card.dataset.lib, card.dataset.name);
      for (let i = 0; i < 80 && !q('#drawer').classList.contains('show'); i++) await sleep(200);
      ok('★ 关详情后模块语境被清掉（普通入口再开，底栏没有「查看 <模块> 资源」）',
        !q('#dlStrip .ds-res'), ((q('#dlStrip') || {}).textContent || '').trim().slice(0, 40));
      W.closeDetail(); await sleep(300);
    } else {
      ok('整卡点击（本轮无带 libId 的卡，跳过）', true, '无 data-lib');
    }
  }
  /* ★★ v10.48 + v10.97：卡底「查看 N 条下载」= 打开**弹窗**列全量 + 弹窗内搜索。
     ⚠️ 这组断言 v10.97 起承担了**双份**职责 —— 卡面改成「不给条目」之后，
        原先挂在卡内行上的判据（真外链 / 盘口配色 / 每行 title）全部迁移到这里。
        别以为是「顺手搬家」：条目现在**只**活在弹窗里，弹窗里不验就等于没验。 */
  {
    const more = qa('#mdGrid .emu-card .grp-more')[0];
    if (more) {
      const card = more.closest('.emu-card');
      /* v10.97：卡内本就没有行，before 恒为 0 —— 这个 0 就是「卡面干净」的基线 */
      const before = card.querySelectorAll('.gl .gl-i').length;
      const errN = e1.length;
      click(more);
      await sleep(2200);
      const pop = q('#dlPop');
      ok('★★ 点卡底「查看 N 条下载」→ 打开弹窗（不再原地铺开）', !!pop && !pop.hidden);
      const after = card.querySelectorAll('.gl .gl-i').length;
      ok('★★ 反向：卡内行数仍是 0（原地铺开已废弃，卡片不再被撑长）',
        before === 0 && after === 0, `${before} → ${after} 行`);
      const box = q('#grpAllList');
      const rowsArr = box ? [...box.querySelectorAll('.gl-i')] : [];
      const rows = rowsArr.length;
      ok('★ 正向锚点：弹窗内铺出全量条目（上一条「卡内 0 行」不能因弹窗也空而变绿）',
        rows > 0, `${rows} 行`);
      ok('★ 弹窗内每行都有可点出口（有链给链 / 没链给「源站」兜底）',
        rows > 0 && rowsArr.every((r) => r.querySelector('.gl-lk a')));
      /* ↓ 从卡面迁过来的三条：真外链 / 盘口配色 / 每行 title */
      const links = rowsArr.flatMap((r) => [...r.querySelectorAll('.gl-lk a')]);
      const ext = links.filter((a) => /^https?:/.test(a.getAttribute('href') || ''));
      ok('★ 弹窗内通道是真外链（href 非 # 、target=_blank）',
        ext.length > 0 && ext.every((a) => a.getAttribute('target') === '_blank'),
        `${ext.length} / ${links.length} 条是 http(s) ｜ 例 ${(ext[0] || {}).getAttribute ? String(ext[0].getAttribute('href')).slice(0, 50) : '(无)'}`);
      ok('★ 通道按钮挂了盘口配色类 bd-*（与详情页下载弹窗同源语义）',
        ext.filter((a) => /(^|\s)bd-/.test(a.className)).length > 0,
        `${ext.filter((a) => /(^|\s)bd-/.test(a.className)).length} / ${ext.length}`);
      {
        const withT = rowsArr.filter((r) => {
          const t = r.querySelector('.t');
          return !!t && !!t.getAttribute('title');
        });
        ok('★★ 每行标题都带 title（单行省略后悬停仍能读全文 —— 折叠，不是删除）',
          rows > 0 && withT.length === rows, `${withT.length} / ${rows} 行`);
      }
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
      ok('★ 关弹窗后卡内仍然是 0 行（不会把全量留在卡里）',
        card.querySelectorAll('.gl .gl-i').length === 0,
        `${card.querySelectorAll('.gl .gl-i').length} 行`);
    } else {
      ok('查看全部（本轮无 .grp-more 样本，跳过）', true, '无 .grp-more');
    }
  }
  /* ★★ v10.49：条目标题**单行省略**（用户口径「卡片中的内容每条显示一行即可多余字显示省略号即可」）。
     ⚠️ v10.97 起这条规则**只服务弹窗**（`.emu-card.grp#grpAllList` 里的行）——
        卡面已经不再铺行了。所以这里既要断「规则还在」（弹窗靠它排版），
        也要断「没被顺手删掉」（删了弹窗内就是一坨没排版的文字）。
     ⚠️ 这是**样式**断言 —— jsdom 不做布局（拿不到真实 text-overflow 效果），只能读 CSS 规则文本。
        行级 DOM 判据（每行带 title）已迁到上面弹窗块里，此处只管规则体。
     ⚠️ 反向断言不可省：`-webkit-line-clamp` 若被写回来，浏览器里 nowrap 与 clamp 同时存在时
        clamp 会赢（它自带 overflow:hidden 的换行语义），单行省略会**静默失效**。 */
  {
    const H = await fetch(BASE + PAGE).then((r) => r.text());
    const m = /\.emu-card\.grp \.gl-i \.t\{([^}]*)\}/.exec(H);
    const rule = m ? m[1] : '';
    ok('★ 条目标题规则取到（正向锚点：选择器打错时下面几条会平白变绿）',
      rule.length > 0, rule.slice(0, 90));
    ok('★★ 条目标题单行省略（white-space:nowrap + text-overflow:ellipsis）',
      /white-space:nowrap/.test(rule) && /text-overflow:ellipsis/.test(rule), rule);
    ok('★★ 反向：该规则里不再有 line-clamp（折 2 行会让单行省略静默失效）',
      !/line-clamp/.test(rule), (rule.match(/[^;]*line-clamp[^;]*/) || ['(无)'])[0]);
    ok('★ `min-width:0` 还在 —— 没有它 flex 子项不收缩，省略号根本不出现（只把兄弟挤走）',
      /min-width:0/.test(rule));
    ok('★★ 弹窗里不再有单独覆盖 `.grp-pop .gl-i .t`（与卡内同一条规则，一处真源）',
      !/\.grp-pop \.gl-i \.t\{/.test(H),
      (H.match(/\.grp-pop \.gl-i \.t\{[^}]*\}/) || ['(无)'])[0]);
    /* ★ v10.97 新增：卡面删行之后，`.emu-card.grp .gl` / `.gl-i` 这组样式**必须保留** ——
       它现在只服务弹窗（`.grp-pop .emu-card.grp` + glRow）。删掉弹窗就散架。
       ⚠️ 用 `{` 前带空格的写法区分 `.emu-card.grp .gl{` 与 `.gl-i{`，两者都要在。 */
    ok('★★ v10.97：卡面删行后，弹窗用的 `.emu-card.grp .gl` / `.gl-i` 样式仍然在（删了弹窗会散架）',
      /\.emu-card\.grp \.gl\{/.test(H) && /\.emu-card\.grp \.gl-i\{/.test(H),
      `.gl{ ${/\.emu-card\.grp \.gl\{/.test(H)} ｜ .gl-i{ ${/\.emu-card\.grp \.gl-i\{/.test(H)}`);
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
      /* ★★ v10.97b：搜索时「名称命中」必须排在「只有条目撞词」之前。
         实测事故：默认排序改热度后，搜「赛博朋克」第一张是**剑星**（热度 348,068），
         只因剑星组里有一条「武士运动服 赛博朋克2077」—— 用户搜的是游戏名，这属于跑偏。
         ⚠️ 反向判据也要：结果里必须**仍有**名称不含关键词的组（条目撞词那条路没被砍掉，
            否则「名称优先」是靠「只留名称命中」作弊实现的）。
         两条都要有 ⇒ 单断第一条会被「过滤到只剩 1 个」满足。 */
      const names = qa('#mdGrid .emu-card').map((c) => c.dataset.name || '');
      ok('★★ v10.97b 搜索第一名是**名称命中**的组（不再被热度更高的「条目撞词」组顶掉）',
        names.length > 0 && /赛博朋克/.test(names[0]), `第一名 ${names[0] || '(缺失)'}`);
      ok('★★ v10.97b 反向：条目撞词的组**仍在结果里**（名称优先 ≠ 把 ② 那条路砍掉）',
        names.filter((n) => !/赛博朋克/.test(n)).length > 0,
        `${names.length} 张里 ${names.filter((n) => !/赛博朋克/.test(n)).length} 张非名称命中`);
      si.value = '';
      si.dispatchEvent(new W.Event('input', { bubbles: true }));
      await sleep(1500);
    }
  }

  /* ============================================================
   * 二·B、v10.50 卡面游戏名 —— 「中文名 + 下方灰字英文名」（用户拍板）
   * ============================================================
   * 用户原话：「应该是游戏名称导致 —— XD 的游戏名称有点小问题，它会用 / 进行分隔
   *           中英文游戏名称以及标签等」。
   * 库名是 `中文名/英文名/标签` 直接拼串，实测 19,430 款里 **16,248 款含 `/`（83.6%）**，
   * 铺到卡面就是标题折 2~3 行、卡片参差被撑高 —— 这正是用户看到的现象。
   */
  {
    const h4s = qa('#mdGrid .emu-card > .bd > h4');
    ok('★ v10.50 正向锚点：MOD 组卡卡面标题取到', h4s.length > 0, `${h4s.length} 个`);
    const badSlash = h4s.filter((h) => h.textContent.includes('/'));
    ok('★★ v10.50：卡面文本一律不出现 `/`（库名原串只留在 hover 提示里，信息一点没丢）',
      h4s.length > 0 && badSlash.length === 0,
      badSlash.slice(0, 2).map((h) => h.textContent).join(' | ') || '无');
    /* ⚠️ 反向断言必须配正向锚点：样本里若一张「原名含 /」的卡都没有，上一条会平白变绿。 */
    const cutNames = h4s.filter((h) => (h.getAttribute('title') || '').includes('/'));
    ok('★ v10.50 正向锚点：确实存在「原名含 `/` 而卡面已切成展示名」的卡',
      cutNames.length > 0,
      `切过名的卡 ${cutNames.length} 张 ｜ 例：${cutNames[0] ? cutNames[0].getAttribute('title') : '(无)'}`);
    ok('★ v10.50：卡面文本 == 卡片 data-name（展示名只有一份，渲染时不会又拼回原串）',
      qa('#mdGrid .emu-card').every((c) => {
        const h = c.querySelector('h4');
        return !!h && h.textContent === (c.dataset.name || '');
      }));
    /* 灰字副标题 = 英文名（不是第二个中文别名）
     * ★★ v10.97 用户口径明确要求「游戏名称 + **游戏原名**」上卡面 ⇒ 覆盖率不再能只断「存在」。
     *   但也不能一刀切 `=== 卡数`：源站库名本身是 `中文名/英文名[/标签]` 拼串，
     *   有的游戏原串就没有英文（钢铁雄心IV / 荒野大镖客2 实测如此），
     *   不渲染那一行是**如实**，编一个英文名才是错的。
     *   ⇒ 判据改成「与接口返回的 nameEn 对齐」：接口有几款有原名，卡面就应渲染几个 .alt。
     *     这样既守住覆盖率，又不会因为数据本身缺英文而假红。 */
    const alts = qa('#mdGrid .emu-card > .bd > .alt');
    let apiWithEn = -1;
    try {
      const j = await fetch(BASE + '/api/res/groups?cat=mod&sort=hot&limit=24&offset=0').then((r) => r.json());
      apiWithEn = (j.items || []).filter((x) => x.nameEn).length;
    } catch (e) { /* 接口异常时退化为「至少有一个」 */ }
    ok('★★ v10.97：卡面原名（.alt）数量 == 接口里有原名的组数（用户要的「游戏原名」真的铺出来了）',
      alts.length > 0 && (apiWithEn < 0 || alts.length === apiWithEn),
      `${alts.length} 个 .alt ｜ 接口 ${apiWithEn} 款有原名`);
    const cjk = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
    const badAlt = alts.filter((a) => cjk.test(a.textContent));
    ok('★★ v10.50：英文名副标题里**不含 CJK**（灰字那行必须是英文名，不能是第二个中文别名）',
      alts.length > 0 && badAlt.length === 0,
      badAlt.slice(0, 2).map((a) => a.textContent).join(' | ') || '无');
    ok('★ v10.50：副标题带 title（超 46 字被截断后仍可悬停读全 —— 折叠，不是删除）',
      alts.length > 0 && alts.every((a) => !!a.getAttribute('title')));
  }

  /* ============================================================
   * 二·C、v10.50 原贴内容弹窗 —— 标题 + 正文 + 截图，且**按原贴布局**
   * ============================================================
   * 用户原话：「有部分帖子我想获取对应的内容（可以点击弹窗展示标题 + 原贴内容 + 图片等），
   *           且还需要按照原贴的布局放置（大部分都有介绍和使用方式）」。
   * ★ 前提是数据**早就在本地**（mods.json.content 8,942/8,943 = 100%）——
   *   只是列表投影按设计只留了摘要字段 ⇒ 改的是投影与界面，不是采集。
   */
  {
    /* ★★ v10.97：条目行只在弹窗里 —— 先开「查看 N 条下载」，再从 `#grpAllList` 取样。
       ⚠️ 别改回 `#mdGrid .gl-i`：卡面已无行，那样取到 0 个，整段会退化成「跳过」，
          看上去全绿实际什么都没验（本轮最容易踩的假绿）。 */
    const mdMore0 = qa('#mdGrid .emu-card .grp-more')[0];
    if (mdMore0) { click(mdMore0); await sleep(2200); }
    const btns = qa('#grpAllList .gl-i [data-post-open]');
    const rowsHas = qa('#grpAllList .gl-i.has-post');
    ok('★ v10.50 正向锚点：MOD 弹窗内出现「原贴」入口（机地帖 content 覆盖 100%）',
      btns.length > 0, `${btns.length} 个 ｜ 弹窗是否开着 ${!!(q('#dlPop') && !q('#dlPop').hidden)}`);
    ok('★ v10.50：入口按钮与「整行可点」一一对应（按钮数 == .has-post 行数）',
      btns.length > 0 && btns.length === rowsHas.length, `${btns.length} vs ${rowsHas.length}`);
    ok('★ v10.50：入口按钮带 data-src / data-id（缺一个就打不开对应那条）',
      btns.length > 0 && btns.every((b) => b.dataset.src && b.dataset.id));
    /* ★ v10.51：原贴按钮升成**通用类** `.po-btn` —— 下载弹窗的 Mod / 修改器 / 存档行
       也要用同一套视觉，原先写死在 `.emu-card.grp .gl-lk button.po` 里换作用域就得抄第二份。
       ⚠️ 这类「改名」最容易留下半成品（按钮出来了、样式没跟），所以样式要**同时**验：
       通用规则体在读入的 resources.html 里必须真的有，且类名确实换了。 */
    ok('★★ v10.51：原贴入口用的是通用类 `.po-btn`（不再写死在卡内作用域里）',
      /* ⚠️ 反向判据用 `classList.contains('po')` 精确判**整串类名**，
         不能写 `/\bpo\b/` —— `-` 是非单词字符，`\bpo\b` 在 `po-btn` 里**也命中**（实测踩到）。 */
      btns.length > 0 && btns.every((b) => b.classList.contains('po-btn') && !b.classList.contains('po')),
      btns.length ? btns[0].className : '无样本');
    /* 规则体从**服务端实发的那份 resources.html** 里取 —— jsdom 的 `W.document` 拿不到
       `<style>` 文本的可靠来源，直接 fetch 一次最直白（与线上加载的是同一个文件）。 */
    const pagesrc = await fetch(BASE + '/resources.html').then((r) => r.text());
    const poRule = (pagesrc.match(/\.po-btn\{([^}]*)\}/) || [])[1] || '';
    ok('★★ v10.51：通用类 `.po-btn` 的样式规则体在页面里（只改类名不搬样式 ⇒ 按钮裸奔）',
      !!poRule && /border-radius:6px/.test(poRule) && /padding:3px 7px/.test(poRule),
      poRule ? '规则体已取到' : '未命中 .po-btn{');

    /* 接口一致性：入口对应的那条**真的**有正文（入口不是摆设） */
    const b0 = btns[0] || null;
    if (b0) {
      const j = await fetch(BASE + '/api/res/post?src=' + encodeURIComponent(b0.dataset.src)
        + '&id=' + encodeURIComponent(b0.dataset.id)).then((r) => r.json());
      ok('★ v10.50：入口对应的接口回 has:true + 正文非空（入口不是摆设）',
        !!j && j.ok === true && j.has === true && String(j.content || '').trim().length > 0,
        `ok=${j && j.ok} ｜ has=${j && j.has} ｜ content ${String((j || {}).content || '').length} 字`);
    } else ok('原贴入口 ↔ 接口一致性（本轮无入口样本，跳过）', true, '无 [data-post-open]');

    /* 纯链接源：200 + has:false（正常态，不是错误）；缺参数：400（不是 200 + 空正文） */
    const jgt = await fetch(BASE + '/api/res/post?src=gt&id=1').then((r) => r.json());
    ok('★★ v10.50：纯链接源（GT）回 200 + has:false + 来源名 —— 正常态，不是错误',
      !!jgt && jgt.ok === true && jgt.has === false && !!jgt.source,
      JSON.stringify({ ok: jgt && jgt.ok, has: jgt && jgt.has, source: jgt && jgt.source }));
    const r400 = await fetch(BASE + '/api/res/post?src=mod');
    ok('★ v10.50：缺 id 回 400（不是 200 + 空正文 —— 那会画出一个空白弹窗）',
      r400.status === 400, `HTTP ${r400.status}`);

    /* 点入口 → 弹窗打开 → 画出正文 */
    const errN = e1.length;
    if (b0) {
      click(b0);
      await sleep(1600);
      const pop = q('#postPop');
      ok('★★ v10.50：点「原贴」→ 弹窗真的打开（.on）',
        !!pop && pop.classList.contains('on') && !pop.hidden, pop ? pop.className : '(缺失)');
      const body = q('#postBody');
      const poBody = body && body.querySelector('.po-body');
      ok('★★ v10.50：弹窗里画出正文容器 .po-body', !!poBody);
      ok('★ v10.50：正文非空（用户要的就是「能看到原贴内容」）',
        !!poBody && (poBody.textContent || '').trim().length > 20,
        `${poBody ? (poBody.textContent || '').trim().length : 0} 字`);
      ok('★ v10.50：标题回填到 #postTitle',
        !!q('#postTitle') && (q('#postTitle').textContent || '').trim().length > 0,
        (q('#postTitle') || {}).textContent || '(空)');
      ok('★ v10.50：正文里的裸链接已成可点 <a>（这条若无链接则跳过）',
        !poBody || !/https?:\/\//.test(poBody.textContent || '') || !!poBody.querySelector('a'),
        poBody && poBody.querySelector('a')
          ? poBody.querySelector('a').getAttribute('href').slice(0, 60) : '(这条正文无链接)');
      ok('打开原贴弹窗不抛异常', e1.length === errN, e1.slice(errN).join(' | '));

      /* 「按原贴布局」的落地：正文容器 pre-wrap。
         ⚠️ jsdom 不做布局，样式只能读 CSS **规则体**（整页含某字符串会被注释里的反例假绿）。 */
      const H2 = await fetch(BASE + PAGE).then((r) => r.text());
      const mr = /\.postpop-b \.po-body\{([^}]*)\}/.exec(H2);
      const rb = mr ? mr[1] : '';
      ok('★★ v10.50：正文容器 white-space:pre-wrap（换行/全角缩进原样保留）+ overflow-wrap 兜超长网盘串',
        /white-space:pre-wrap/.test(rb) && /overflow-wrap:anywhere/.test(rb),
        rb.replace(/\s+/g, ' ').slice(-76));
      ok('★★ v10.50 反向：不能是 pre-line / normal（pre-line 会把源站缩进的空格吃掉）',
        /white-space:pre-wrap/.test(rb) && !/white-space:(?!pre-wrap)[a-z-]/.test(rb));
      /* ⚠️ linkify 的顺序坑：**先切链接再 esc**。反过来会把 `&` 变成 `&amp;` 后，
         连尾巴上的分号一起被「剥掉结尾标点」的规则吃掉。 */
      const lk = W.postLinkify('看这个 https://pan.xunlei.com/s/abc 提取码 1234');
      ok('★ v10.50：postLinkify 把裸链接变可点、且不吞掉后面的中文',
        /<a href="https:\/\/pan\.xunlei\.com\/s\/abc"[^>]*>/.test(lk) && /提取码 1234/.test(lk),
        lk.slice(0, 80));
      const lk2 = W.postLinkify('a&b https://x.com/y?q=1&z=2 end');
      ok('★ v10.50：postLinkify 不把链接里 `&` 转义后的分号当成「尾巴标点」剥掉',
        /href="https:\/\/x\.com\/y\?q=1&amp;z=2"/.test(lk2), lk2.slice(0, 90));

      /* 关闭：用**返回值**判「这次真关了」——hidden 要等 180ms 过渡走完才置位，不能用它判 */
      ok('★ v10.50：closePostPop() 返回 true = 这次真关了', W.closePostPop() === true);
      ok('★ v10.50：再调一次返回 false（幂等 —— Esc 连按不会误关下一层）', W.closePostPop() === false);
      await sleep(280);
      ok('★ v10.50：关闭后弹窗隐藏且正文已清空（不留上一条的内容）',
        q('#postPop').hidden === true && (q('#postBody').innerHTML || '').trim() === '');
    }

    /* 第二个入口：点**整行**也要能开（`.has-post` + document 委托，两个入口一套行为） */
    const row = rowsHas[0] || null;
    if (row) {
      const errN2 = e1.length;
      click(row.querySelector('.t') || row);
      await sleep(1600);
      ok('★★ v10.50：点「整行」同样打开原贴弹窗（不是只有那个小按钮能点）',
        q('#postPop').classList.contains('on'), q('#postPop').className);
      ok('点整行打开不抛异常', e1.length === errN2, e1.slice(errN2).join(' | '));
      /* ★★ 反向：下载通道是外链，必须让开 —— 否则点「迅雷」会同时弹原贴（一次点击两个动作） */
      const link = row.querySelector('.gl-lk a');
      if (link) {
        W.closePostPop();
        await sleep(280);
        /* jsdom 点 <a> 会走 navigation（未实现 ⇒ 抛 jsdomError）。这里只 preventDefault 拦住导航，
           **不 stopPropagation** —— 让 document 委托照样跑到，那才是被测行为。 */
        link.addEventListener('click', (ev) => ev.preventDefault());
        click(link);
        await sleep(900);
        ok('★★ v10.50 反向：点下载通道**不**打开原贴弹窗（外链让开，一次点击只做一个动作）',
          !q('#postPop').classList.contains('on'), q('#postPop').className);
        ok('点下载通道不抛异常', e1.length === errN2, e1.slice(errN2).join(' | '));
      } else {
        ok('点下载通道不打开原贴（该行无下载链，跳过）', true, '无 .gl-lk a');
      }
      if (W.closePostPop()) await sleep(280);
    } else {
      ok('整行点击打开原贴（本轮无 .has-post 行，跳过）', true, '无 .gl-i.has-post');
    }
    /* ★ v10.97：收尾把「全部条目」弹窗关掉 —— 下一段（存档）要去点页签，
       #dlPop 若还开着，jsdom 里虽不挡点击，但留着会污染后续断言（弹出层叠着）。 */
    if (typeof W.closeDownload === 'function') W.closeDownload();
    await sleep(260);
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
    ok('存档卡都有封面槽 / 分类徽标 / 条数胶囊（三处同形）',
      sv.n > 0 && sv.cov === sv.n && sv.meta === sv.n && sv.pill === sv.n, shapeStr(sv));
    ok('★★ v10.97 存档卡面也没有条目行（与 MOD 同一张脸）', sv.n > 0 && sv.gl === 0,
      `还铺了行的卡 ${sv.gl} 张`);
    ok('★★ v10.97 存档每张卡底都有「查看 N 条下载」按钮', sv.n > 0 && sv.more === sv.n,
      `${sv.more} / ${sv.n}`);
    ok('★★ v10.97 存档排序首项是「最热门」（用户口径：四个模块默认按热度排序）',
      qa('#svSorts .emu-sort').length === 4
      && /最热门/.test((qa('#svSorts .emu-sort')[0] || {}).textContent || '')
      && qa('#svSorts .emu-sort')[0].classList.contains('on'),
      `${qa('#svSorts .emu-sort').length} 项 ｜ 首项 ${(qa('#svSorts .emu-sort')[0] || {}).textContent}`);
    ok('★★ 反向：存档卡面已无旧「位置卡」元素（.paths / .cp / .sv-open 归零）',
      sv.deadEl === 0, `残留 ${sv.deadEl} 张`);
    /* ★★ 本轮核心口径：这一页只列「真有存档」的游戏 ⇒ **每行**都应有真实下载通道。
       实测 /api/res/stats?cat=saves 的 withLink = items（100%）。所以这条不该有例外；
       若哪天出现「只有源站兜底」的行，说明混进了没有文件的条目 —— 正是用户要去掉的形态。
       ⚠️ v10.97 起行只在弹窗里，必须开一张卡取样（`#svGrid .gl .gl-i` 现在恒为 0，
          直接查会「0 行」把正反两条一起判红 —— 或更糟：改成 `>=` 就假绿）。 */
    const svMore = qa('#svGrid .emu-card .grp-more')[0];
    if (svMore) { click(svMore); await sleep(2200); }
    const rows = qa('#grpAllList .gl-i');
    const withCh = rows.filter((r) => r.querySelector('.gl-lk a:not(.bd-other)')).length;
    ok('★★ 存档弹窗内每行都带**真实下载通道**（不是「去源站」兜底）——「只展示真有存档的」',
      rows.length > 0 && withCh === rows.length,
      `${withCh} / ${rows.length} 行有真通道`);
    ok('存档计数文案是「共 N 款游戏」', /共 [\d,]+ 款游戏/.test(q('#svCount').textContent || ''),
      q('#svCount').textContent || '');
    ok('存档统计条已回填 4 格', qa('#svStats .st').length === 4, `实际 ${qa('#svStats .st').length}`);
    ok('存档来源下拉已填充（「全部来源」+ 至少 1 个源）', qa('#svSrc option').length >= 2,
      qa('#svSrc option').map((o) => o.textContent).join(' ｜ '));
    /* ★ v10.50：存档原贴（游侠帖）—— desc / steps / shots 三个字段的取数入口。
       实证口径：desc 100% · 有截图 1,172 条（57.4%）。v10.97 同样改从弹窗取样。 */
    const svBtn = q('#grpAllList .gl-i [data-post-open]');
    ok('★ v10.50 正向锚点：存档弹窗内出现「原贴」入口（游侠帖 desc 覆盖 100%）',
      !!svBtn, `${rows.length} 行里 ${qa('#grpAllList [data-post-open]').length} 个入口`);
    if (svBtn) {
      const j = await fetch(BASE + '/api/res/post?src=' + encodeURIComponent(svBtn.dataset.src)
        + '&id=' + encodeURIComponent(svBtn.dataset.id)).then((r) => r.json());
      const anyBody = !!j && (String(j.content || '').trim().length > 0
        || (j.steps || []).length > 0 || (j.shots || []).length > 0);
      ok('★★ v10.50：存档原贴接口回 has:true，且 desc / steps / shots 至少一项有内容',
        !!j && j.ok === true && j.has === true && anyBody,
        `content ${String((j || {}).content || '').length} 字 ｜ steps ${((j || {}).steps || []).length} ｜ shots ${((j || {}).shots || []).length}`);
    }
    if (typeof W.closeDownload === 'function') W.closeDownload();
    await sleep(260);
  }
  /* 点封面按钮 → 进详情（组卡的统一分流；v10.97 起只有这个入口进详情） */
  {
    const svCard = qa('#svGrid .emu-card').find((c) => c.dataset.lib && c.querySelector('.cov-btn'));
    if (svCard) {
      click(svCard.querySelector('.cov-btn'));
      await sleep(1500);
      ok('点存档组卡封面按钮 → 打开游戏详情抽屉', q('#drawer').classList.contains('show'), q('#drawer').className);
      W.closeDetail(); await sleep(300);
    } else {
      ok('存档组卡封面按钮（本轮无命中样本，跳过）', true, '无 data-lib + .cov-btn 卡片');
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
    ok('修改器卡都有封面槽 / 分类徽标 / 条数胶囊（三处同形）',
      tr.n > 0 && tr.cov === tr.n && tr.meta === tr.n && tr.pill === tr.n, shapeStr(tr));
    ok('★★ v10.97 修改器卡面也没有条目行（四区同一张脸）', tr.n > 0 && tr.gl === 0,
      `还铺了行的卡 ${tr.gl} 张`);
    ok('★★ v10.97 修改器每张卡底都有「查看 N 条下载」按钮', tr.n > 0 && tr.more === tr.n,
      `${tr.more} / ${tr.n}`);
    ok('★★ v10.97 修改器排序首项是「最热门」（用户口径：四个模块默认按热度排序）',
      qa('#trSorts .emu-sort').length === 4
      && /最热门/.test((qa('#trSorts .emu-sort')[0] || {}).textContent || '')
      && qa('#trSorts .emu-sort')[0].classList.contains('on'),
      `${qa('#trSorts .emu-sort').length} 项 ｜ 首项 ${(qa('#trSorts .emu-sort')[0] || {}).textContent}`);
    ok('★★ 反向：修改器卡面已无旧「导流卡」元素（.tr-go / .tr-note 归零）',
      tr.deadEl === 0, `残留 ${tr.deadEl} 张`);
    ok('修改器卡带来源徽标 .tg.src（卡内可能混源，要能看出条目来自哪）',
      qa('#trGrid .emu-card .tg.src').length > 0, `实际 ${qa('#trGrid .emu-card .tg.src').length} 个`);
    /* ★★ v10.48：修改器「第三方来源」跳转链（用户口径：
       「修改器中的第三方修改器来源我也需要你提供跳转链接」）。
       根因回顾：上游 official_url 一直有（93.7%），是抓取器把它丢了，
       且 res-groups 原先的 page 指向 libUrl（**端游库**的 xdgame 链接）。
       ★ v10.97：卡面不再铺行 ⇒ 这条**本来就必须**走弹窗（原先的注释里已经写了
         「光看卡面会因为样本缺失而恒真」，现在卡面连样本都没有了）。
       ⚠️ 同一次弹窗里顺带验「每行都有可点出口」与「没有原贴入口」——
          卡面删行后，`#trGrid [data-post-open] === 0` 是一条**恒真空断言**
          （卡里根本没有行可挂入口），必须搬进弹窗才有判别力。 */
    {
      const trMore = qa('#trGrid .emu-card .grp-more')[0];
      if (trMore) {
        const errN = e1.length;
        click(trMore);
        await sleep(2200);
        const box = q('#grpAllList');
        const trRows = box ? [...box.querySelectorAll('.gl-i')] : [];
        ok('★ 正向锚点：修改器弹窗内确实渲染了条目行（防下两条因整区空白而假绿）',
          trRows.length > 0, `${trRows.length} 行`);
        ok('★ 修改器弹窗内每行都有可点出口（有链给链，GCM 走来源站兜底）',
          trRows.length > 0 && trRows.every((r) => r.querySelector('.gl-lk a')),
          `${trRows.filter((r) => r.querySelector('.gl-lk a')).length} / ${trRows.length} 行`);
        /* ★★ v10.50 反向：修改器两源（GTrainers / GCM；v10.58 起 FR 已摘除）都是**纯链接源**，
           没有原贴正文 ⇒ 不给「点开是空的」入口（宁可少一个按钮，也不给一个空弹窗）。
           ⚠️ 若哪天修改器源开始带正文，这条会红：那时应改成
              「入口数 == 接口 has:true 的条数」，而不是把断言删掉。 */
        ok('★★ v10.50 反向：修改器弹窗内**没有**原贴入口（纯链接源无正文）',
          box && box.querySelectorAll('[data-post-open]').length === 0
          && box.querySelectorAll('.gl-i.has-post').length === 0,
          `入口 ${box ? box.querySelectorAll('[data-post-open]').length : '?'}`
          + ` ｜ 整行 ${box ? box.querySelectorAll('.gl-i.has-post').length : '?'}`);
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
        ok('修改器「查看全部」（无 .grp-more 样本，跳过）', true, '无 .grp-more');
      }
    }
    ok('修改器计数文案是「共 N 款游戏」', /共 [\d,]+ 款游戏/.test(q('#trCount').textContent || ''),
      q('#trCount').textContent || '');
    ok('修改器统计条已回填 4 格', qa('#trStats .st').length === 4, `实际 ${qa('#trStats .st').length}`);
    ok('修改器来源下拉已填充（「全部来源」+ 至少 1 个源）', qa('#trSrc option').length >= 2,
      qa('#trSrc option').map((o) => o.textContent).join(' ｜ '));
    /* 排序项点一下：证明排序真的接后端（顺序变化不稳，这里只钉「不抛异常 + on 转移」）
       ★ v10.97：项数 3 → 4（新增「最热门」在最前）。
       ⚠️ 断言文案**不写死具体档位名** —— 三个分区的 sorts 末项并不相同
          （修改器是 最近更新，MOD/存档是 按游戏名），写死会在换分区时变成假红/假绿。
          这里只用按钮自己的文本回显。 */
    const sorts = qa('#trSorts .emu-sort');
    const lastSort = sorts[sorts.length - 1];
    if (sorts.length >= 4 && lastSort) {
      const errN = e1.length;
      click(lastSort);
      await sleep(1800);
      ok('点排序项（末项）→ 不抛异常且高亮转移（证明排序真的打后端）',
        e1.length === errN && lastSort.classList.contains('on'),
        `${lastSort.textContent} on=${lastSort.classList.contains('on')}`);
    } else {
      ok('修改器排序项（不足 4 项，跳过）', true, `实际 ${sorts.length} 项`);
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
  /* ★ v10.96：默认分区已改成「本体」⇒ 断言改成「落回**默认分区**」而不是写死 MOD。
     写死具体分区会让下一个改默认值的人又改一遍测试 —— 这里守的是「不空白」这件事。 */
  ok('陌生深链 #emu → 安全落回默认分区（不空白）', !d5d.querySelector('#resBody').classList.contains('et-hide'));
  ok('陌生深链 #emu → 高亮停在默认分区（不会有野页签被点亮）',
    (d5d.querySelector('#resTabs .res-tab.on') || {}).dataset?.et === 'bd');
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
