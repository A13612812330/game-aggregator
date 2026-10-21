/* ============================================================================
 * tools/resource-sections.js — 「端游资源」独立专页（/resources.html）三页签驱动
 *
 * 为什么有这一页（v10.44）：
 *   用户口径：「手游的样式更新下，也需要划分模块 MOD，存档，修改器，
 *             手机专区保留手机中心+机型兼容+模拟器指南」。
 *   ⇒ MOD / 存档 / 修改器 三者本质是**端游资源**，挂在「手机专区」下语义不成立
 *     （用户为此迷路过一次：找存档得先去手机专区）。本页把它们平级抽出来。
 *
 * ★★ v10.47 三个分区**统一改形**（本轮最大的一次改动）：
 *   用户口径：「MOD 按游戏做卡片而不是按 MOD，其次优化下卡片的大小」
 *            「存档只展示真有存档的而不是存档位置的，且优化下卡片显示效果」
 *            「（修改器）同样按游戏聚合」
 *            「卡内列前 3 条 + 展开全部」。
 *   ⇒ 三个分区共用**同一种卡形**：一卡一款游戏，卡内铺前 3 条可下载条目，
 *     超出部分由卡内「**查看全部 N 条**」打开弹窗列出全量（v10.48 改；此前是原地铺开）。
 *     渲染器只有一份（`grpCard`），
 *     差异全部收在 `GRP_META` 这张表里（标题 / 排序项 / 统计口径）。
 *   ⚠️ 这不是「搬家」而是**改形**：旧的「一卡一条」渲染器（mdCard / svCard / trCard）
 *     已整组删除，同时删掉了配套的 `.md-lk` / `.sv-open` / `.tr-go` 等卡面样式 ——
 *     本项目对死样式的一贯处理是**删**（留着会让人以为旧形态还在）。
 *
 * 数据来源（一个分区一套数据，互不替代）：
 *   · MOD     #mods      → data/res-groups.js cat=mod      机地社区帖（网盘直链）
 *   · 存档    #resSaves  → cat=saves                       游侠存档文件 + GTrainers 存档
 *   · 修改器  #resTrainers → cat=trainers                  GCM 清单 + GTrainers ★ v10.58 起 FR 已摘除
 *
 * ⚠️ 本文件是**被整段注入到页面主脚本块里**的（同 emulator-sections.js），
 *    所以不能出现 require / module.exports；只能依赖主源共享脚本的
 *    esc / api / toast / openDetailById 这些既有全局。
 *    （写注释时也别出现 script 标签字面量 —— 语法闸按它数块数，会被算成两块。）
 * ⚠️ 注释里**故意不复述断言用的字符串原文**：那些断言是在派生页源码里做 indexOf 式
 *    字符串搜索的，注释里出现同一串会让断言**恒真**（本项目在 PITFALLS 里记过这个坑）。
 * ========================================================================== */

/* 每页几组（原 EMU_PAGE_SIZE 是「几条」，v10.47 起是「几款游戏」） */
const RES_PAGE_SIZE = 24;

/* 三个分区的展示口径。★ 一处定义：标题、卡类、统计口径、排序项、来源徽标顺序
 *   全部在这张表里，渲染器只读不改 —— 免得三份代码各自漂。
 * ⚠️⚠️ 键名不许重复！这里踩过一次**静默覆盖**：原先容器 id 与排序项都叫 `sorts`，
 *   对象字面量里后者覆盖前者 ⇒ `document.getElementById(meta.sorts)` 收到的是数组、
 *   恒返回 null ⇒ 三个分区的排序项**从来没渲染出来过**，且不报错。
 *   ⇒ 容器 id 改叫 `sortsBox`，排序项保持 `sorts`。
 *   （本项目铁律 17：同一份口径只留一处；这里是「同一个键不要两种东西」。） */
const GRP_META = {
  mod: {
    grid: 'mdGrid', count: 'mdCount', stats: 'mdStats', built: 'mdBuilt',
    more: 'mdMore', search: 'mdSearch', sortsBox: 'mdSorts', srcBox: 'mdSrc',
    kindCls: 'k-mod', label: 'MOD',
    /* 卡面统计口径：条目数 / 覆盖游戏 / 带下载通道的条目数 / 通道覆盖率 */
    statLabel: ['覆盖游戏', 'MOD 条数', '带下载通道', '通道覆盖率'],
    sorts: [['count', '条目最多'], ['new', '最近更新'], ['game', '按游戏名']],
  },
  saves: {
    grid: 'svGrid', count: 'svCount', stats: 'svStats', built: 'svBuilt',
    more: 'svMore', search: 'svSearch', sortsBox: 'svSorts', srcBox: 'svSrc',
    kindCls: 'k-saves', label: '存档',
    statLabel: ['覆盖游戏', '可下载存档', '带下载通道', '通道覆盖率'],
    sorts: [['count', '存档最多'], ['new', '最近更新'], ['game', '按游戏名']],
  },
  trainers: {
    grid: 'trGrid', count: 'trCount', stats: 'trStats', built: 'trBuilt',
    more: 'trMore', search: 'trSearch', sortsBox: 'trSorts', srcBox: 'trSrc',
    kindCls: 'k-trainers', label: '修改器',
    statLabel: ['覆盖游戏', '修改器条数', '可下载条数', '可下载占比'],
    sorts: [['count', '条目最多'], ['game', '按游戏名'], ['new', '最近更新']],
  },
};

/* 三个分区的运行时状态（结构与语义完全同形，只是分开存） */
const grpState = {
  mod: { q: '', sort: 'count', src: '', offset: 0, total: 0, items: [], inited: false, loading: false },
  saves: { q: '', sort: 'count', src: '', offset: 0, total: 0, items: [], inited: false, loading: false },
  trainers: { q: '', sort: 'count', src: '', offset: 0, total: 0, items: [], inited: false, loading: false },
};

/* 来源展示名。★ 与 data/res-groups.js 的 SRC_LABEL 是同一份口径，
 *   但这里是浏览器端、拿不到那个模块 —— 所以**由服务端随 stats 一起下发**
 *   （见 initGrp 里的 s.srcLabel），本常量只作接口失败时的兜底。 */
const GRP_SRC_FALLBACK = { mod: '机地 MOD', yx: '游侠存档', gt: 'GTrainers', gcm: 'GCM 清单' };
let grpSrcLabel = Object.assign({}, GRP_SRC_FALLBACK);

const grpSrcName = (k) => grpSrcLabel[k] || GRP_SRC_FALLBACK[k] || k;

/* ============================================================================
 * 卡片渲染（三个分区共用）
 * ========================================================================== */

/** 卡内一行条目：序号 + 标题 + 通道按钮（最多 2 个，超出显示 +N）
 *
 * ★ v10.50：条目带原贴正文时（`it.hasPost`）多给两个入口 ——
 *   ① 行内「原贴」小按钮（显式、好发现，与下载通道同一排）
 *   ② **整行可点**（`.has-post` + `cursor:pointer` + hover 底色）
 *   两个入口都走同一个全局委托（见 `bindPostDelegation`），行为只有一份。
 *   ⚠️ 没有 `hasPost` 的行**一点都不变** —— 不加 class、不加按钮、光标的默认样子保留，
 *      免得用户点了一条什么都没发生。 */
function glRow(cat, it, n) {
  const links = it.links || [];
  const two = links.slice(0, 2)
    .map((l) => '<a class="bd-' + esc(l.cls || 'other') + '" href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer"'
      + ' title="' + esc(l.label + (l.size ? ' · ' + l.size : '')) + '">' + esc(String(l.label).slice(0, 12)) + '</a>')
    .join('');
  const more = links.length > 2 ? '<span class="more">+' + (links.length - 2) + '</span>' : '';
  /* ★ 没有任何下载通道时**不静默留空**：给一个「源站」出口，并说明为什么没有按钮。
   *   这条是铁律「存在 ≠ 可见」的正向落点：卡内每一行都必须有一个可点的去处。 */
  const fallback = (!links.length && it.page)
    ? '<a class="bd-other" href="' + esc(it.page) + '" target="_blank" rel="noopener noreferrer" title="'
      + esc(it.note || '这条没有解析到下载链，去源站看') + '">源站</a>'
    : '';
  const canPost = !!it.hasPost;
  /* ★ v10.51：类名从 `po` 换成通用 `.po-btn` —— 下载弹窗的 Mod/修改器/存档行也要用同一套样式，
     原先那条 `.emu-card.grp .gl-lk button.po` 是卡内作用域写死的，换作用域就得抄第二份。
     收成一条通用规则后，视觉规格只有一个来源（铁律 17）；`data-post-open` 三件套不变。 */
  const postBtn = canPost
    ? '<button class="po-btn" type="button" data-post-open data-src="' + esc(it.src || '')
      + '" data-id="' + esc(it.id || '') + '" title="查看原贴内容（标题 / 正文 / 截图）">原贴</button>'
    : '';
  const lkHtml = '<span class="gl-lk">' + postBtn + two + more + fallback + '</span>';
  const sizeTxt = it.size ? '<span class="sz">' + esc(String(it.size).slice(0, 12)) + '</span>' : '';
  /* ★ v10.58：显示用 `dtitle`（机地帖的清洗短名），悬浮仍给**原始标题** ——
     原始标题是用户去源站搜同一条帖的凭据（数据里也没动，见 data/name-normalize.js#cleanModTitle）。 */
  const full = it.title || it.game || '?';
  const title = it.dtitle || full;
  const mute = links.length ? '' : ' mute';
  return '<div class="gl-i' + (canPost ? ' has-post' : '') + '" data-src="' + esc(it.src || '') + '"'
    + (canPost ? ' data-id="' + esc(it.id || '') + '" data-post-row="1"' : '')
    + '>'
    + '<span class="n">' + n + '</span>'
    + '<span class="t' + mute + '" title="' + esc(full) + '">' + esc(title) + '</span>'
    + sizeTxt
    + lkHtml
    + '</div>';
}

/** 一张游戏组卡 */
function grpCard(cat, g) {
  const meta = GRP_META[cat];
  /* ★ v10.50：卡面标题用**展示名**（`name`），不再是库名原串。
   *   原串是 `中文名/英文名/标签`，实测 16,248/19,430 款含 `/` ⇒ 标题折 2~3 行、卡片被撑高。
   *   `game`（原串）**留着**：它是搜索/匹配/审计的口径，挂进 hover 提示，信息一点没丢。 */
  const game = g.name || g.game || '?';
  const gameFull = g.game || game;
  const libTitle = g.libTitle || '';
  /* 灰字副标题 = 英文名（用户拍板：中文名 + 下方灰字英文名）。
   * 没有英文名（纯英文游戏名 / 单段名）就**不占那一行**，卡片更矮。 */
  const sub = g.nameEn
    ? '<div class="alt" title="' + esc(g.nameEn) + '">' + esc(String(g.nameEn).slice(0, 46))
      + (String(g.nameEn).length > 46 ? '…' : '') + '</div>'
    : '';

  /* 封面：有就用真图（组卡封面取自端游库/条目），没有就沿用既有 .cov.ph 占位块
     （同尺寸、只放缩写 —— 不这么写网格被拉齐后卡顶会空出一块）。 */
  const covBtn = g.libId
    ? '<button class="cov-btn" data-lib="' + esc(g.libId) + '" data-title="' + esc(libTitle || gameFull) + '" type="button">查看游戏详情</button>'
    : '';
  const cov = g.cover
    ? '<div class="cov"><img src="' + esc(g.cover) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' + covBtn + '</div>'
    : '<div class="cov ph"><span>' + esc(String(game).slice(0, 2).toUpperCase()) + '</span></div>';

  /* 来源徽标：这张卡里的条目分别来自哪些源（卡内可能混源，例如存档 = 游侠 + GTrainers） */
  const srcTags = Object.keys(g.bySrc || {})
    .sort((a, b) => (g.bySrc[b] || 0) - (g.bySrc[a] || 0))
    .map((k) => '<span class="tg src ' + esc(k) + '">' + esc(grpSrcName(k)) + '</span>')
    .join('');

  const rows = (g.items || []).map((it, i) => glRow(cat, it, i + 1)).join('');
  /* ★ v10.48：文案从「展开全部 N 条 ▾」改成「查看全部 N 条 ▸」——
     行为已经不是「在卡内展开」了，箭头也跟着从「向下」改成「向右（进弹窗）」。
     文案与行为不一致是上一轮踩过的坑（用户明确说「不要展开」）。 */
  const moreBtn = g.more
    ? '<button class="grp-more" type="button" data-grp-more data-cat="' + cat + '" data-key="' + esc(g.key) + '" data-title="'
      + esc(game) + '">查看全部 ' + Number(g.count).toLocaleString() + ' 条 ▸</button>'
    : '';

  return '<article class="emu-card grp' + (g.cover ? ' has-cov' : '') + '" data-cat="' + cat + '" data-key="' + esc(g.key) + '"'
    + ' data-lib="' + esc(g.libId || '') + '" data-libt="' + esc(libTitle || gameFull) + '" data-name="' + esc(game) + '">'
    + cov
    + '<div class="bd">'
    /* hover 提示给**完整库名**，卡面只显示展示名 */
    + '<h4 title="' + esc(gameFull) + '">' + esc(game) + '</h4>'
    + sub
    + '<div class="meta">'
    + '<span class="tg ' + meta.kindCls + '">' + esc(meta.label) + '</span>'
    + '<span class="pill">' + Number(g.count).toLocaleString() + ' 条</span>'
    + (srcTags || '')
    + '</div>'
    + '<div class="gl">' + rows + '</div>'
    + moreBtn
    + '</div>'
    + '</article>';
}

/* ============================================================================
 * 「查看全部 N 条」→ 弹窗列全量 + 弹窗内搜索
 *
 * ★★ v10.48 改行为（本轮第二大改动）：
 *   用户口径：「优化，不要展开（在弹窗中 mod 模块显示，可在下载弹窗中搜索）」。
 *   原实现（`grpExpand`）是**原地铺开**，上限 300 条。两个问题：
 *     a) 单组最多 **717** 条（赛博朋克2077），原地铺会把卡撑到几千像素，
 *        而卡片是网格里的一员 ⇒ 整行都被拉长；铺完还**没法检索**，只能靠 Ctrl+F；
 *     b) 铺开是破坏性的（`gl.innerHTML` 整块换掉）—— 铺完关不掉、回不到「前 3 条」的形态。
 *   ⇒ 改为打开 `#dlPop` 弹窗（**复用**，三页共享资产，理由同 openFullPop 上方那段），
 *     弹窗里列出**该组全部条目**，顶部一个搜索框做**本地过滤**。
 *
 * ⚠️ 搜索是本地过滤「已经取回来的数组」，所以必须一次取全 ——
 *    服务端 `items()` 的上限已从 500 提到 **1000**（实测最大组 717），
 *    覆盖全部组；万一仍 `truncated`，副标题会**写明只取到了前 N 条**（不静默截断）。
 * ========================================================================== */

/* 弹窗当前会话（cat + 全量数组 + 关键词）。关弹窗时被 closeDownload 之外的路径
 * 置空 —— 用 null 判空，避免「没有会话却还在过滤上一次的数组」。 */
let grpAllState = null;

/** 按当前关键词重绘列表（只重绘列表本身，不动搜索框 —— 否则输入会掉焦点） */
function grpAllHit() {
  const st = grpAllState;
  if (!st) return;
  const box = document.getElementById('grpAllList');
  if (!box) return;
  const kw = String(st.q || '').trim().toLowerCase();
  const hit = !kw ? st.items : st.items.filter((x) => (String(x.title || '') + ' ' + String(x.game || '')
    + ' ' + String(x.note || '') + ' ' + String(x.date || '') + ' ' + String(x.size || '')).toLowerCase().includes(kw));
  box.innerHTML = hit.length
    ? hit.map((it, i) => glRow(st.cat, it, i + 1)).join('')
    : '<div class="emu-empty" style="padding:16px 0">没有匹配的条目</div>';
  const n = document.getElementById('grpAllN');
  if (n) n.textContent = kw ? ('命中 ' + hit.length + ' / ' + st.items.length) : ('共 ' + st.items.length.toLocaleString() + ' 条');
}

/** 打开弹窗并渲染（数据已在手上时直接画，避免闪一次 loading） */
function grpAllPaint(cat, items, game, j) {
  const meta = GRP_META[cat];
  const bodyEl = document.getElementById('dlBody');
  const total = (j && j.total) || items.length;
  const cut = (j && j.truncated)
    ? '（接口上限，只取到前 ' + items.length + ' 条）'
    : '';
  const sub = document.getElementById('dlSub');
  if (sub) sub.textContent = '共 ' + total.toLocaleString() + ' 条' + cut + ' · 可在下方搜索';
  bodyEl.innerHTML = '<div class="grp-pop">'
    + '<div class="grp-pop-s">'
    + '<input id="grpAllQ" type="search" autocomplete="off" placeholder="在这 '
    + total.toLocaleString() + ' 条' + esc(meta.label) + '里搜（标题 / 日期 / 体积）">'
    + '<span class="n" id="grpAllN"></span></div>'
    + '<div class="emu-card grp" id="grpAllList"></div>'
    + '</div>';
  grpAllState = { cat, items, q: '' };
  grpAllHit();
  const q = document.getElementById('grpAllQ');
  if (q) {
    q.addEventListener('input', () => { if (grpAllState) grpAllState.q = q.value; grpAllHit(); });
    q.focus();
  }
  const foot = document.getElementById('dlFoot');
  if (foot) foot.innerHTML = '<b>' + esc(game || '') + '</b> · 点右上角 ✕ 或按 Esc 关闭';
}

/** 点「查看全部 N 条」的入口：拉全量 → 开弹窗 */
async function grpAllPop(btn) {
  if (btn.dataset.busy === '1') return;
  btn.dataset.busy = '1';
  const cat = btn.dataset.cat;
  const key = btn.dataset.key;
  const meta = GRP_META[cat];
  const game = btn.dataset.title || '';
  const pop = document.getElementById('dlPop');
  const bodyEl = document.getElementById('dlBody');
  if (!pop || !bodyEl) { btn.dataset.busy = ''; return; }

  /* 打开外壳前先把**合并弹窗的会话状态作废**（dlUni / dFullCur）——
     不清的话，关掉本弹窗后再点详情页的「⬇ 下载与资源」，会看到上一次的分区/排序；
     模块页签条同样要藏（本弹窗没有模块语境）。 */
  if (typeof closeSvLoc === 'function') closeSvLoc();
  dlUni = null;
  dFullCur = null;
  const mt = document.getElementById('dlModTabs');
  if (mt) { mt.hidden = true; mt.innerHTML = ''; }
  const tEl = document.getElementById('dlTitle');
  if (tEl) tEl.textContent = (game ? game + ' · ' : '') + '全部' + meta.label;
  const sEl = document.getElementById('dlSub');
  if (sEl) sEl.textContent = '读取中…';
  const fEl = document.getElementById('dlFoot');
  if (fEl) fEl.innerHTML = '';
  bodyEl.innerHTML = '<div class="dlpop-load"><i></i><span>正在读取全部条目…</span></div>';
  pop.hidden = false;
  requestAnimationFrame(() => pop.classList.add('on'));

  try {
    const j = await fetch(api('/api/res/items?cat=' + encodeURIComponent(cat)
      + '&key=' + encodeURIComponent(key) + '&limit=1000')).then((r) => r.json());
    const items = j.items || [];
    if (!items.length) throw new Error('该组没有条目');
    grpAllPaint(cat, items, game, j);
  } catch (e) {
    grpAllState = null;
    bodyEl.innerHTML = '<div class="dlpop-empty">读取失败：' + esc(e.message)
      + '<br><span style="font-size:11.5px">关闭后重试</span></div>';
    if (sEl) sEl.textContent = '';
  } finally {
    btn.dataset.busy = '';
    btn.disabled = false;
  }
}

/** 网格点击分流（三个分区同一套）：查看全部 / 原贴 / 卡内通道外链 / 封面按钮 / 整卡进详情
 *
 * ★ v10.50：「原贴」入口（行内按钮 + 整行可点）**故意不在这里处理**，只做一次
 *   `return` 放行 —— 真正处理它的是主源里那个 document 级委托（见 index.html 的
 *   `bindPostDelegation`）。理由：同一个入口还出现在「查看全部」弹窗与详情页资源行里，
 *   那两处的 innerHTML 都是整体重建的；三处各绑一次必然分叉。
 *   ⚠️ 这里**不能** `e.stopPropagation()` —— 那样会连 document 上的委托一起掐掉，
 *      变成「点了原贴什么也不发生」。 */
function bindGrpGrid(cat) {
  const meta = GRP_META[cat];
  const g = document.getElementById(meta.grid);
  if (!g || g.dataset.bound) return;
  g.dataset.bound = '1';
  g.addEventListener('click', (e) => {
    const more = e.target.closest('[data-grp-more]');
    if (more) { e.stopPropagation(); grpAllPop(more); return; }
    /* 原贴入口：放行给 document 级委托（`[data-post-open]` 在行内、`.has-post` 是整行） */
    if (e.target.closest('[data-post-open]') || e.target.closest('.gl-i.has-post')) return;
    /* 卡内的下载通道是外链，别被整卡的点击吞掉 */
    if (e.target.closest('.gl-lk a')) return;
    const btn = e.target.closest('.cov-btn');
    const card = e.target.closest('.emu-card');
    if (!card) return;
    if (btn && btn.dataset.lib && typeof openDetailById === 'function') {
      e.stopPropagation();
      openDetailById(btn.dataset.lib, btn.dataset.title || card.dataset.libt || card.dataset.name);
      return;
    }
    if (card.dataset.lib && typeof openDetailById === 'function') {
      openDetailById(card.dataset.lib, card.dataset.libt || card.dataset.name);
      return;
    }
    if (typeof toast === 'function') toast('这款未收录进本地端游库，暂无详情页');
  });
}

/* ============================================================================
 * 通用加载 / 初始化（三个分区共用一份实现，靠 GRP_META 区分）
 * ========================================================================== */

async function loadGrp(cat, more) {
  const meta = GRP_META[cat];
  const st = grpState[cat];
  if (st.loading) return;
  st.loading = true;
  const grid = document.getElementById(meta.grid);
  if (!more) {
    st.offset = 0;
    if (grid) grid.innerHTML = '<div class="emu-loading">正在拉取' + esc(meta.label) + '清单…</div>';
  }
  try {
    const qs = new URLSearchParams({
      cat, q: st.q, sort: st.sort, limit: RES_PAGE_SIZE, offset: st.offset,
    });
    if (st.src) qs.set('src', st.src);
    const j = await fetch(api('/api/res/groups?' + qs)).then((r) => r.json());
    if (!j || j.ok === false) throw new Error((j && j.error) || '接口返回异常');
    st.total = j.total || 0;
    const items = j.items || [];
    st.items = more ? st.items.concat(items) : items;
    st.offset = st.items.length;
    if (grid) {
      grid.innerHTML = st.items.length
        ? st.items.map((g) => grpCard(cat, g)).join('')
        : '<div class="emu-empty">没有匹配的游戏，换个关键词试试</div>';
    }
    const cnt = document.getElementById(meta.count);
    /* ★ 计数文案写「款游戏」而不是「条」：卡是游戏粒度，写「条」会和卡内条数打架 */
    if (cnt) cnt.textContent = '共 ' + st.total.toLocaleString() + ' 款游戏';
    const mo = document.getElementById(meta.more);
    if (mo) mo.style.display = st.items.length < st.total ? '' : 'none';
  } catch (e) {
    if (grid) grid.innerHTML = '<div class="emu-empty">拉取失败，请稍后重试</div>';
  } finally { st.loading = false; }
}

/** 统计条 + 构建时间 + 来源筛选下拉（三处同形，靠 GRP_META 取值） */
async function grpPaintMeta(cat, s) {
  const meta = GRP_META[cat];
  const box = document.getElementById(meta.stats);
  if (box && s) {
    const vals = [s.groups, s.items, s.withLink, (s.linkPct == null ? '—' : s.linkPct + '%')];
    box.innerHTML = meta.statLabel
      .map((k, i) => '<div class="st"><b>' + (vals[i] == null ? '—' : (typeof vals[i] === 'number' ? vals[i].toLocaleString() : esc(String(vals[i])))) + '</b><span>' + esc(k) + '</span></div>')
      .join('');
  }
  const built = document.getElementById(meta.built);
  if (built) {
    const t = s && s.builtAt ? new Date(s.builtAt).toLocaleString('zh-CN', { hour12: false }) : '';
    built.textContent = t ? '（清单更新于 ' + t + '）' : '';
  }
  const sel = document.getElementById(meta.srcBox);
  if (sel && s && s.bySrc) {
    const cur = grpState[cat].src;
    sel.innerHTML = '<option value="">全部来源</option>' + Object.keys(s.bySrc)
      .sort((a, b) => (s.bySrc[b] || 0) - (s.bySrc[a] || 0))
      .map((k) => '<option value="' + esc(k) + '">' + esc(grpSrcName(k)) + '（' + Number(s.bySrc[k]).toLocaleString() + '）</option>')
      .join('');
    sel.value = cur;
  }
}

/** 一个分区的完整初始化：绑定 + 拉统计 + 绑排序/搜索/来源/加载更多 + 首屏 */
async function initGrp(cat) {
  const meta = GRP_META[cat];
  const st = grpState[cat];
  if (st.inited) return;
  st.inited = true;
  bindGrpGrid(cat);

  try {
    const s = await fetch(api('/api/res/stats?cat=' + cat)).then((r) => r.json());
    if (s && s.srcLabel) grpSrcLabel = Object.assign(grpSrcLabel, s.srcLabel);
    await grpPaintMeta(cat, s);
    /* ★ 统计里的来源名要等接口回来才知道 ⇒ 回来后再重绘一次来源下拉（名字不再靠兜底表） */
  } catch (e) {}

  /* 排序项由 GRP_META 生成（三处同形，避免 HTML 与 JS 两处各写一份） */
  const sorts = document.getElementById(meta.sortsBox);
  if (sorts && !sorts.dataset.bound) {
    sorts.dataset.bound = '1';
    sorts.innerHTML = meta.sorts
      .map(([k, label], i) => '<button class="emu-sort' + (i === 0 ? ' on' : '') + '" data-s="' + esc(k) + '" type="button">' + esc(label) + '</button>')
      .join('');
    sorts.addEventListener('click', (e) => {
      const b = e.target.closest('.emu-sort'); if (!b) return;
      sorts.querySelectorAll('.emu-sort').forEach((x) => x.classList.toggle('on', x === b));
      st.sort = b.dataset.s;
      loadGrp(cat, false);
    });
  }

  const si = document.getElementById(meta.search);
  if (si && !si.dataset.bound) {
    si.dataset.bound = '1';
    let t;
    si.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => { st.q = si.value.trim(); loadGrp(cat, false); }, 260);
    });
  }

  const sel = document.getElementById(meta.srcBox);
  if (sel && !sel.dataset.bound) {
    sel.dataset.bound = '1';
    sel.addEventListener('change', () => { st.src = sel.value; loadGrp(cat, false); });
  }

  const mo = document.getElementById(meta.more);
  if (mo && !mo.dataset.bound) { mo.dataset.bound = '1'; mo.addEventListener('click', () => loadGrp(cat, true)); }

  await loadGrp(cat, false);
}

/* 三个分区各自的入口（页面骨架与派生页生成器按这些名字调用，别改名） */
function initMd() { return initGrp('mod'); }
function initSv() { return initGrp('saves'); }
function initTr() { return initGrp('trainers'); }

/* ============================================================================
 * ★★ v10.96：第四个分区「本体」（#resBody）
 *
 * 用户口径：「端游资源我需要一个本体的页面（目前已有 Mod/修改器/存档）」。
 *
 * 为什么这一区**形态与另三区不同**（这是本区所有设计选择的来源）：
 *   另三区（MOD / 存档 / 修改器）背后都有**离线建好的索引**（data/res-groups.js），
 *   所以能「一卡一款游戏 + 卡内直接铺条目 + 服务端分页」。
 *   而**本体链接没有索引可用**：机地的本体帖只能从话题资源接口实时取，
 *   17,220 款全量预抓要 6 小时以上、且必然把机地打成限流（v10.95 实测 405 的成因）。
 *   ⇒ 所以本区做成「**列表全量可见 + 卡内按需抓取**」：
 *     · 列表 = 机地话题库 17,220 款（`/api/jiditopics/list`，自带封面/体积/评分/热度）
 *     · 卡片上给一个「查本体下载」按钮，点它才发一次真实抓取
 *     · 抓到的结果按 tid 存 localStorage ⇒ 同一台设备复访**不用重抓**
 *       （服务端另有 30 分钟缓存；失败只缓存 60 秒，见 data/dl-cache-ttl.js）
 *
 * ⚠️ 为什么不自动抓首屏：
 *   24 张卡 = 24 次对机地的请求，页面一打开就触发限流；
 *   而且大部分游戏用户根本不关心。**按需**是这里唯一的正确选择。
 * ========================================================================== */

const BD_PAGE_SIZE = 24;
const BD_LS_KEY = 'gh.bd.links.v1';
/* localStorage 只留最近 400 款，超出按时间淘汰（单条最大 ~200 条链接，
   400 条约 1~2 MB，仍在 5 MB 配额内） */
const BD_LS_MAX = 400;

const bdState = {
  q: '', sort: 'hot', offset: 0, total: 0, items: [], inited: false, loading: false,
};

/** 已抓取的结果缓存：tid -> { ts, posts:[...], links:n } */
let bdLinks = (function () {
  try {
    const raw = localStorage.getItem(BD_LS_KEY);
    const o = raw ? JSON.parse(raw) : null;
    return (o && typeof o === 'object') ? o : {};
  } catch (e) { return {}; }
})();

function bdSaveLinks() {
  try {
    const keys = Object.keys(bdLinks);
    if (keys.length > BD_LS_MAX) {
      keys.sort((a, b) => (bdLinks[a].ts || 0) - (bdLinks[b].ts || 0));
      for (const k of keys.slice(0, keys.length - BD_LS_MAX)) delete bdLinks[k];
    }
    localStorage.setItem(BD_LS_KEY, JSON.stringify(bdLinks));
  } catch (e) { /* 配额满 / 隐私模式：当作没缓存，功能不受影响 */ }
}

/** 盘口名 → 卡面样式类（.bd-* 定义在主源 index.html，本页只引用） */
function bdCls(server) {
  const s = String(server || '');
  if (/夸克/.test(s)) return 'quark';
  if (/百度/.test(s)) return 'baidu';
  if (/迅雷/.test(s)) return 'xunlei';
  if (/阿里/.test(s)) return 'ali';
  if (/123/.test(s)) return '123';
  if (/蓝奏/.test(s)) return 'lanzou';
  if (/UC|uc/.test(s)) return 'uc';
  if (/139/.test(s)) return '139';
  if (/189|天翼/.test(s)) return '189';
  if (/PikPak|pikpak/i.test(s)) return 'pikpak';
  return 'other';
}

/** 按帖子聚合：一条 item = 一个网盘链接，同一帖常有 2~4 个盘口 */
function bdGroupByPost(items) {
  const map = new Map();
  for (const it of (items || [])) {
    const k = it.postId || it.postUrl || ('x' + Math.random());
    if (!map.has(k)) {
      map.set(k, {
        postId: it.postId || '', postTitle: it.postTitle || '', postUrl: it.postUrl || '',
        author: it.author || '', dpv: it.dpv || 0, note: it.note || '',
        links: [],
      });
    }
    if (it.real) map.get(k).links.push({ url: it.real, label: it.server || '网盘', cls: bdCls(it.server) });
  }
  return [...map.values()].filter((p) => p.links.length);
}

/** 一条帖子行（与另三区的 glRow 同形，但盘口按钮来自实时抓取） */
function bdPostRow(p, n) {
  const two = p.links.slice(0, 2)
    .map((l) => '<a class="bd-' + esc(l.cls) + '" href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer"'
      + ' title="' + esc(l.label) + '">' + esc(String(l.label).replace(/网盘$/, '').slice(0, 6)) + '</a>')
    .join('');
  const more = p.links.length > 2 ? '<span class="more">+' + (p.links.length - 2) + '</span>' : '';
  const post = p.postUrl
    ? '<a class="po-btn" href="' + esc(p.postUrl) + '" target="_blank" rel="noopener noreferrer" title="去机地看原贴（含安装说明）">原贴</a>'
    : '';
  const title = p.postTitle || '（无标题帖）';
  return '<div class="gl-i">'
    + '<span class="n">' + n + '</span>'
    + '<span class="t" title="' + esc(title) + '">' + esc(title.slice(0, 40)) + (title.length > 40 ? '…' : '') + '</span>'
    + '<span class="gl-lk">' + two + more + post + '</span>'
    + '</div>';
}

/** 一张本体卡。`cached` 有值就**直接铺结果**，不显示「查」按钮。 */
function bdCard(g) {
  const title = g.title || '?';
  const en = g.titleEn ? '<div class="alt" title="' + esc(g.titleEn) + '">' + esc(String(g.titleEn).slice(0, 46)) + '</div>' : '';
  const cov = g.cover
    ? '<div class="cov"><img src="' + esc(g.cover) + '" alt="" loading="lazy" referrerpolicy="no-referrer"></div>'
    : '<div class="cov ph"><span>' + esc(String(title).slice(0, 2).toUpperCase()) + '</span></div>';
  const hot = Number(g.dpv) > 0 ? '<span class="pill">🔥 ' + Number(g.dpv).toLocaleString() + '</span>' : '';
  const size = g.size ? '<span class="pill">' + esc(String(g.size).slice(0, 10)) + '</span>' : '';
  const score = Number(g.score) > 0 ? '<span class="pill">' + g.score + ' 分</span>' : '';
  const c = bdLinks[g.tid];
  const inner = c
    ? (c.posts && c.posts.length
      ? c.posts.slice(0, 3).map((p, i) => bdPostRow(p, i)).join('')
      : '<div class="bd-empty-s">这款的机地话题下<b>没有本体资源帖</b>（可能只在别处发布）</div>')
    : '<button class="bd-get" type="button" data-bd-tid="' + esc(String(g.tid)) + '"'
      + ' data-bd-url="' + esc(g.url || ('https://jidiyouxi.com/topic/detail/' + g.tid)) + '">🔍 查本体下载</button>';
  const total = c && c.posts ? c.posts.reduce((n, p) => n + p.links.length, 0) : 0;
  const moreBtn = (c && c.posts && c.posts.length > 3)
    ? '<button class="grp-more" type="button" data-bd-more="' + esc(String(g.tid)) + '">查看全部 '
      + c.posts.length + ' 个资源帖（' + total + ' 个盘口）▸</button>'
    : '';
  return '<article class="emu-card grp' + (g.cover ? ' has-cov' : '') + ' bd-card" data-tid="' + esc(String(g.tid)) + '">'
    + cov
    + '<div class="bd">'
    + '<h4 title="' + esc(title) + '">' + esc(title) + '</h4>'
    + en
    + '<div class="meta"><span class="tg k-body">本体</span>' + size + hot + score + '</div>'
    + '<div class="gl">' + inner + '</div>'
    + moreBtn
    + '</div></article>';
}

/** 抓一款游戏的本体链接并写进卡里（不动其它卡） */
async function bdFetchOne(card, tid, url, force) {
  const gl = card.querySelector('.gl');
  if (!gl) return;
  const old = gl.querySelector('[data-bd-tid]');
  if (old) { old.disabled = true; old.textContent = '正在抓取…'; }
  try {
    const j = await fetch(api('/api/download?url=' + encodeURIComponent(url) + (force ? '&refresh=1' : '')))
      .then((r) => r.json());
    if (!j || j.ok === false) throw new Error((j && j.error) || '抓取失败');
    const body = (j.items || []).filter((x) => x.section === 'body');
    const posts = bdGroupByPost(body);
    const rec = { ts: Date.now(), posts, links: posts.reduce((n, p) => n + p.links.length, 0) };
    bdLinks[tid] = rec;
    bdSaveLinks();
    /* 只重绘这一张卡（重绘整页会让滚动位置和已展开的卡全部复位） */
    const g = bdState.items.find((x) => String(x.tid) === String(tid)) || { tid };
    const wrap = document.createElement('div');
    wrap.innerHTML = bdCard(g);
    const fresh = wrap.firstElementChild;
    if (fresh) card.replaceWith(fresh);
    const secErr = (j.sections || []).find((s) => s.key === 'body' && s.error);
    if (secErr && typeof toast === 'function') toast('机地这次没取到：' + String(secErr.error).slice(0, 60));
  } catch (e) {
    if (old) { old.disabled = false; old.textContent = '🔍 重试：' + String(e.message || '').slice(0, 24); }
    else if (typeof toast === 'function') toast('抓取失败：' + String(e.message || '').slice(0, 60));
  }
}

/** 一卡全部资源帖 → 弹窗（复用主站 #dlPop 外壳，列表独立渲染） */
function bdAllPop(tid) {
  const c = bdLinks[tid];
  const g = bdState.items.find((x) => String(x.tid) === String(tid)) || {};
  const pop = document.getElementById('dlPop');
  const bodyEl = document.getElementById('dlBody');
  if (!c || !pop || !bodyEl) return;
  dlUni = null;
  dFullCur = null;
  const mt = document.getElementById('dlModTabs');
  if (mt) { mt.hidden = true; mt.innerHTML = ''; }
  const tEl = document.getElementById('dlTitle');
  if (tEl) tEl.textContent = (g.title || '') + ' · 全部本体资源帖';
  const total = c.posts.reduce((n, p) => n + p.links.length, 0);
  const sEl = document.getElementById('dlSub');
  if (sEl) sEl.textContent = c.posts.length + ' 个资源帖 · ' + total + ' 个网盘盘口 · 点盘口直接开';
  bodyEl.innerHTML = '<div class="grp-pop"><div class="emu-card grp">'
    + c.posts.map((p, i) => bdPostRow(p, i + 1)).join('')
    + '</div></div>';
  const fEl = document.getElementById('dlFoot');
  if (fEl) fEl.innerHTML = '<b>' + esc(g.title || '') + '</b> · 点右上角 ✕ 或按 Esc 关闭';
  pop.hidden = false;
  requestAnimationFrame(() => pop.classList.add('on'));
}

/** 拉一页列表 */
async function loadBd(more) {
  const st = bdState;
  if (st.loading) return;
  st.loading = true;
  const grid = document.getElementById('bdGrid');
  if (!more) {
    st.offset = 0;
    if (grid) grid.innerHTML = '<div class="emu-loading">正在读取机地话题库…</div>';
  }
  try {
    const qs = new URLSearchParams({
      q: st.q, sort: st.sort, limit: BD_PAGE_SIZE, offset: st.offset,
    });
    const j = await fetch(api('/api/jiditopics/list?' + qs)).then((r) => r.json());
    if (!j || j.ok === false) throw new Error((j && j.error) || '接口返回异常');
    st.total = j.total || 0;
    const items = j.items || [];
    st.items = more ? st.items.concat(items) : items;
    st.offset = st.items.length;
    if (grid) {
      grid.innerHTML = st.items.length
        ? st.items.map((g) => bdCard(g)).join('')
        : '<div class="emu-empty">没有匹配的游戏，换个关键词试试</div>';
    }
    const cnt = document.getElementById('bdCount');
    if (cnt) cnt.textContent = '共 ' + st.total.toLocaleString() + ' 款可查';
    const mo = document.getElementById('bdMore');
    if (mo) mo.style.display = st.items.length < st.total ? '' : 'none';
    const nCached = Object.keys(bdLinks).length;
    const stBox = document.getElementById('bdStats');
    if (stBox) {
      stBox.innerHTML = [
        ['可查游戏', st.total],
        ['本机已抓', nCached],
        ['命中盘口', Object.values(bdLinks).reduce((n, x) => n + (x.links || 0), 0)],
        ['数据来源', '机地话题'],
      ].map(([k, v]) => '<div class="st"><b>' + (typeof v === 'number' ? v.toLocaleString() : esc(String(v)))
        + '</b><span>' + esc(k) + '</span></div>').join('');
    }
  } catch (e) {
    if (grid) grid.innerHTML = '<div class="emu-empty">拉取失败，请稍后重试</div>';
  } finally { st.loading = false; }
}

/** 本体分区入口 */
async function initBd() {
  const st = bdState;
  if (st.inited) return;
  st.inited = true;

  const grid = document.getElementById('bdGrid');
  if (grid && !grid.dataset.bound) {
    grid.dataset.bound = '1';
    grid.addEventListener('click', (e) => {
      const get = e.target.closest('[data-bd-tid]');
      if (get) {
        e.preventDefault(); e.stopPropagation();
        const card = get.closest('.bd-card');
        if (card) bdFetchOne(card, get.dataset.bdTid, get.dataset.bdUrl, false);
        return;
      }
      const more = e.target.closest('[data-bd-more]');
      if (more) { e.preventDefault(); e.stopPropagation(); bdAllPop(more.dataset.bdMore); }
    });
  }

  const sorts = document.getElementById('bdSorts');
  if (sorts && !sorts.dataset.bound) {
    sorts.dataset.bound = '1';
    sorts.innerHTML = [['hot', '最热门'], ['update', '最近更新'], ['score', '评分最高']]
      .map(([k, label], i) => '<button class="emu-sort' + (i === 0 ? ' on' : '') + '" data-s="' + k + '" type="button">' + label + '</button>')
      .join('');
    sorts.addEventListener('click', (e) => {
      const b = e.target.closest('.emu-sort'); if (!b) return;
      sorts.querySelectorAll('.emu-sort').forEach((x) => x.classList.toggle('on', x === b));
      st.sort = b.dataset.s;
      loadBd(false);
    });
  }

  const si = document.getElementById('bdSearch');
  if (si && !si.dataset.bound) {
    si.dataset.bound = '1';
    let t;
    si.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => { st.q = si.value.trim(); loadBd(false); }, 260);
    });
  }

  const mo = document.getElementById('bdMore');
  if (mo && !mo.dataset.bound) { mo.dataset.bound = '1'; mo.addEventListener('click', () => loadBd(true)); }

  await loadBd(false);
}
