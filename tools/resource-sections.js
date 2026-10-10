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
 *     超出部分由卡内「展开全部 N 条」原地铺开。渲染器只有一份（`grpCard`），
 *     差异全部收在 `GRP_META` 这张表里（标题 / 排序项 / 统计口径）。
 *   ⚠️ 这不是「搬家」而是**改形**：旧的「一卡一条」渲染器（mdCard / svCard / trCard）
 *     已整组删除，同时删掉了配套的 `.md-lk` / `.sv-open` / `.tr-go` 等卡面样式 ——
 *     本项目对死样式的一贯处理是**删**（留着会让人以为旧形态还在）。
 *
 * 数据来源（一个分区一套数据，互不替代）：
 *   · MOD     #mods      → data/res-groups.js cat=mod      机地社区帖（网盘直链）
 *   · 存档    #resSaves  → cat=saves                       游侠存档文件 + GTrainers 存档
 *   · 修改器  #resTrainers → cat=trainers                  GCM 清单 + GTrainers + FearlessRevolution
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
const GRP_SRC_FALLBACK = { mod: '机地 MOD', yx: '游侠存档', gt: 'GTrainers', fr: 'FearlessRevolution', gcm: 'GCM 清单' };
let grpSrcLabel = Object.assign({}, GRP_SRC_FALLBACK);

const grpSrcName = (k) => grpSrcLabel[k] || GRP_SRC_FALLBACK[k] || k;

/* ============================================================================
 * 卡片渲染（三个分区共用）
 * ========================================================================== */

/** 卡内一行条目：序号 + 标题 + 通道按钮（最多 2 个，超出显示 +N） */
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
  const lkHtml = '<span class="gl-lk">' + two + more + fallback + '</span>';
  const sizeTxt = it.size ? '<span class="sz">' + esc(String(it.size).slice(0, 12)) + '</span>' : '';
  const title = it.title || it.game || '?';
  const mute = links.length ? '' : ' mute';
  return '<div class="gl-i" data-src="' + esc(it.src || '') + '">'
    + '<span class="n">' + n + '</span>'
    + '<span class="t' + mute + '" title="' + esc(title) + '">' + esc(title) + '</span>'
    + sizeTxt
    + lkHtml
    + '</div>';
}

/** 一张游戏组卡 */
function grpCard(cat, g) {
  const meta = GRP_META[cat];
  const game = g.game || '?';
  const libTitle = g.libTitle || '';
  const alt = (libTitle && libTitle !== game) ? '<div class="alt" title="' + esc(libTitle) + '">' + esc(String(libTitle).slice(0, 46)) + '</div>' : '';

  /* 封面：有就用真图（组卡封面取自端游库/条目），没有就沿用既有 .cov.ph 占位块
     （同尺寸、只放缩写 —— 不这么写网格被拉齐后卡顶会空出一块）。 */
  const covBtn = g.libId
    ? '<button class="cov-btn" data-lib="' + esc(g.libId) + '" data-title="' + esc(libTitle || game) + '" type="button">查看游戏详情</button>'
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
  const moreBtn = g.more
    ? '<button class="grp-more" type="button" data-grp-more data-cat="' + cat + '" data-key="' + esc(g.key) + '" data-title="'
      + esc(game) + '">展开全部 ' + Number(g.count).toLocaleString() + ' 条 ▾</button>'
    : '';

  return '<article class="emu-card grp' + (g.cover ? ' has-cov' : '') + '" data-cat="' + cat + '" data-key="' + esc(g.key) + '"'
    + ' data-lib="' + esc(g.libId || '') + '" data-libt="' + esc(libTitle || game) + '" data-name="' + esc(game) + '">'
    + cov
    + '<div class="bd">'
    + '<h4 title="' + esc(game) + '">' + esc(game) + '</h4>'
    + alt
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

/** 「展开全部」：把这个组剩余条目原地铺进卡内（不跳页、不换弹窗） */
async function grpExpand(btn) {
  if (btn.dataset.busy === '1') return;
  btn.dataset.busy = '1';
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = '正在展开…';
  const cat = btn.dataset.cat;
  const key = btn.dataset.key;
  try {
    /* limit 封顶 300：赛博朋克2077 单组 717 条，一次全铺会把 DOM 撑爆、且没人会滚到底。
       服务端会回 `truncated`，此时按钮**改成说明文案**而不是消失 —— 让用户知道上面还有。 */
    const j = await fetch(api('/api/res/items?cat=' + encodeURIComponent(cat) + '&key=' + encodeURIComponent(key) + '&limit=300'))
      .then((r) => r.json());
    const card = btn.closest('.emu-card');
    const gl = card && card.querySelector('.gl');
    const items = j.items || [];
    if (!gl || !items.length) throw new Error('空结果');
    gl.innerHTML = items.map((it, i) => glRow(cat, it, i + 1)).join('');
    if (j.truncated) {
      btn.removeAttribute('data-grp-more');
      btn.disabled = false;
      btn.dataset.busy = '';
      btn.textContent = '已铺前 ' + items.length + ' 条（共 ' + Number(j.total).toLocaleString() + ' 条，其余请进游戏详情）';
    } else {
      btn.remove();
    }
  } catch (e) {
    btn.disabled = false;
    btn.dataset.busy = '';
    btn.textContent = old;
    if (typeof toast === 'function') toast('展开失败，请稍后重试');
  }
}

/** 网格点击分流（三个分区同一套）：展开全部 / 卡内通道外链 / 封面按钮 / 整卡进详情 */
function bindGrpGrid(cat) {
  const meta = GRP_META[cat];
  const g = document.getElementById(meta.grid);
  if (!g || g.dataset.bound) return;
  g.dataset.bound = '1';
  g.addEventListener('click', (e) => {
    const more = e.target.closest('[data-grp-more]');
    if (more) { e.stopPropagation(); grpExpand(more); return; }
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
