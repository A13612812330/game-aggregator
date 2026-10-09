/* ============================================================================
 * tools/resource-sections.js — 「端游资源」独立专页（/resources.html）三页签驱动
 *
 * 为什么有这一页（v10.44）：
 *   用户口径：「手游的样式更新下，也需要划分模块 MOD，存档，修改器，
 *             手机专区保留手机中心+机型兼容+模拟器指南」。
 *   ⇒ MOD / 存档 / 修改器 三者本质是**端游资源**，挂在「手机专区」下语义不成立
 *     （用户为此迷路过一次：找存档得先去手机专区）。本页把它们平级抽出来。
 *
 * 分区与数据源（一个分区一套数据，互不替代）：
 *   · MOD     #mods      → data/mods.json   的 kind='mod'      （机地社区帖，带网盘直链）
 *   · 存档    #resSaves  → data/saves.json                      （Ludusavi 存档位置库）
 *   · 修改器  #resTrainers → data/trainers.json                 （GCM 公开清单元数据）
 *
 * ⚠️ 本文件是**被整段注入到页面主脚本块里**的（同 emulator-sections.js），
 *    所以不能出现 require / module.exports；只能依赖主源共享脚本的
 *    esc / api / toast / openDetailById 这些既有全局。
 *    （写注释时也别出现 script 标签字面量 —— 语法闸按它数块数，会被算成两块。）
 * ⚠️ 三个分区虽在本页，但「修改器」与「MOD」的**阅读语义没变**：它们是搬家，不是重写。
 *    ★ v10.45 例外一处：**存档卡片改版**（卡面不再铺路径，改为按钮直达合并弹窗的
 *    「存档」模块）—— 这是用户明确要求，不是搬家过程中顺手改的。
 * ========================================================================== */

/* 每页条数（原 emulator-sections.js 的 EMU_PAGE_SIZE —— 搬家后改本页口径） */
const RES_PAGE_SIZE = 24;

/* 盘口 → 徽标类名 / 展示名（与详情页下载弹窗的 .lk 配色共用一份语义） */
const RES_PAN_CLS = {
  '迅雷网盘': 'xunlei', '百度网盘': 'baidu', '夸克网盘': 'quark', '阿里云盘': 'ali',
  '天翼云盘': '189', '移动云盘': '139', '123网盘': '123', '蓝奏云': 'lanzou',
  'UC网盘': 'uc', 'Steam': 'steam', 'PikPak': 'pikpak',
};
const resPanCls = (k) => RES_PAN_CLS[k] || 'other';
const resPanName = (k) => String(k || '外部页面').replace(/网盘$/, '');

/* ============================================================================
 * ① MOD 分区（#mods）
 *  数据：data/mods.json 里 kind='mod' 的机地社区帖（带网盘直链）
 * ========================================================================== */
const mdState = { q: '', sort: 'new', matched: true, offset: 0, total: 0, items: [], inited: false, loading: false };

function mdCard(it) {
  const title = it.title || '?';
  const game = it.game || '';
  const cov = it.cover
    ? '<div class="cov"><img src="' + esc(it.cover) + '" alt="" loading="lazy" referrerpolicy="no-referrer">'
      + (it.libId ? '<button class="cov-btn" data-lib="' + esc(it.libId) + '" data-title="' + esc(it.libTitle || game || title) + '" type="button">查看游戏详情</button>' : '')
      + '</div>'
    : '<div class="cov noimg"><span>' + esc(String(game || title).slice(0, 2).toUpperCase()) + '</span></div>';

  /* 盘口按钮：只取真正的取件口（「其他链接」是源站内链，不足以当下载口） */
  const lks = (it.links || []).filter((l) => l && l.url && l.kind && l.kind !== '其他链接');
  const lkHtml = lks.slice(0, 3)
    .map((l) => '<a class="lk bd-' + resPanCls(l.kind) + '" href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer">' + esc(resPanName(l.kind)) + '</a>')
    .join('');
  const lkMore = lks.length > 3 ? '<span class="lk-more">+' + (lks.length - 3) + '</span>' : '';

  const src = it.url || ('https://52jidi.com/post/detail/' + it.id);
  const altHtml = (game && game !== title) ? '<div class="alt" title="' + esc(game) + '">' + esc(String(game).slice(0, 46)) + '</div>' : '';

  return '<article class="emu-card md' + (it.cover ? ' has-cov' : '') + '" data-name="' + esc(title) + '" data-lib="' + esc(it.libId || '') + '" data-libt="' + esc(it.libTitle || '') + '">'
    + cov
    + '<div class="bd">'
    + '<h4 title="' + esc(title) + '">' + esc(title) + '</h4>'
    + altHtml
    + '<div class="meta">'
    + '<span class="tg md">MOD</span>'
    + (lks.length ? '<span class="pill">' + lks.length + ' 个网盘</span>' : '<span class="tg dim">无直链</span>')
    + (it.pv ? '<span class="pill">' + Number(it.pv).toLocaleString() + ' 浏览</span>' : '')
    + (it.libId ? '<span class="tg">已关联端游库</span>' : '')
    + '</div>'
    + (lkHtml ? '<div class="md-lk">' + lkHtml + lkMore + '</div>' : '')
    + '<div class="md-go"><a href="' + esc(src) + '" target="_blank" rel="noopener noreferrer">打开源站帖 ↗</a></div>'
    + '</div>'
    + '</article>';
}

function bindMdCards() {
  const g = document.getElementById('mdGrid'); if (!g || g.dataset.bound) return;
  g.dataset.bound = '1';
  g.addEventListener('click', (e) => {
    /* 盘口按钮 / 源站帖 是外链，别被卡片点击吞掉 */
    if (e.target.closest('.lk') || e.target.closest('.md-go a')) return;
    const btn = e.target.closest('.cov-btn');
    const card = e.target.closest('.emu-card'); if (!card) return;
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

async function loadMd(more) {
  if (mdState.loading) return;
  mdState.loading = true;
  const grid = document.getElementById('mdGrid');
  if (!more) { mdState.offset = 0; if (grid) grid.innerHTML = '<div class="emu-loading">正在拉取 MOD 清单…</div>'; }
  try {
    const qs = new URLSearchParams({
      q: mdState.q, kind: 'mod', sort: mdState.sort,
      limit: RES_PAGE_SIZE, offset: mdState.offset,
    });
    if (!mdState.matched) qs.set('all', '1');
    const j = await fetch(api('/api/mods/list?' + qs)).then((r) => r.json());
    mdState.total = j.total || 0;
    const items = j.items || [];
    mdState.items = more ? mdState.items.concat(items) : items;
    mdState.offset = mdState.items.length;
    if (grid) grid.innerHTML = mdState.items.length ? mdState.items.map(mdCard).join('') : '<div class="emu-empty">没有匹配的 MOD，换个关键词试试</div>';
    const cnt = document.getElementById('mdCount'); if (cnt) cnt.textContent = '共 ' + mdState.total.toLocaleString() + ' 条';
    const mo = document.getElementById('mdMore');
    if (mo) mo.style.display = mdState.items.length < mdState.total ? '' : 'none';
  } catch (e) {
    if (grid) grid.innerHTML = '<div class="emu-empty">拉取失败，请稍后重试</div>';
  } finally { mdState.loading = false; }
}

async function initMd() {
  if (mdState.inited) return; mdState.inited = true;
  bindMdCards();
  try {
    const s = await fetch(api('/api/mods/stats')).then((r) => r.json());
    const box = document.getElementById('mdStats');
    if (box) {
      box.innerHTML = [
        ['MOD 总数', (s.byKind && s.byKind.mod) || s.total], ['已关联端游', s.matched],
        ['网盘地址', s.linkTotal], ['覆盖游戏', s.games],
      ].map(([k, v]) => '<div class="st"><b>' + (v == null ? '—' : (typeof v === 'number' ? v.toLocaleString() : esc(v))) + '</b><span>' + k + '</span></div>').join('');
    }
    const built = document.getElementById('mdBuilt');
    if (built && s.builtAt) built.textContent = '（清单更新于 ' + new Date(s.builtAt).toLocaleString('zh-CN', { hour12: false }) + '）';
  } catch (e) {}
  const si = document.getElementById('mdSearch');
  if (si && !si.dataset.bound) {
    si.dataset.bound = '1';
    let t;
    si.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { mdState.q = si.value.trim(); loadMd(false); }, 260); });
  }
  const sorts = document.getElementById('mdSorts');
  if (sorts && !sorts.dataset.bound) {
    sorts.dataset.bound = '1';
    sorts.addEventListener('click', (e) => {
      const b = e.target.closest('.emu-sort'); if (!b) return;
      sorts.querySelectorAll('.emu-sort').forEach((x) => x.classList.toggle('on', x === b));
      mdState.sort = b.dataset.s; loadMd(false);
    });
  }
  const mo = document.getElementById('mdMore');
  if (mo && !mo.dataset.bound) { mo.dataset.bound = '1'; mo.addEventListener('click', () => loadMd(true)); }
  const tg = document.getElementById('mdToggleLib');
  if (tg) {
    const paint = () => { tg.classList.toggle('on', mdState.matched); };
    paint();
    if (!tg.dataset.bound) {
      tg.dataset.bound = '1';
      tg.addEventListener('click', () => { mdState.matched = !mdState.matched; paint(); loadMd(false); });
    }
  }
  await loadMd(false);
}

/* ============================================================================
 * ② 存档分区（#resSaves）—— 自 emulator-sections.js 搬家，路径展示于 v10.45 改版
 *
 * ★ v10.45：**卡面不再铺路径**。用户口径：
 *   「存档位置显示有点多以及杂（先优化存档页面中的卡片，不在卡片中显示位置）」，
 *   并拍板「卡面留按钮，点开合并弹窗的『存档』模块」。
 *   旧版把最多 3 条路径 + 2 条注册表（`.paths` / `.cp`）直接铺在卡面上，
 *   卡又高又花、一屏扫不完；路径本身在**详情页「云存档位置」块**与
 *   **合并下载弹窗的「存档」模块**（`dlUniPaintSave`，逐条带复制）里都有，
 *   这里再铺一份属于「同一份数据三套渲染」。
 * ★ 搬到本页后默认口径保持不变：本页是端游资源语境 ⇒ 默认给全量（phone=false）。
 * ========================================================================== */
const svState = { q: '', sort: 'paths', phone: false, cloud: false, offset: 0, total: 0, items: [], inited: false, loading: false };

function svCard(it) {
  const title = it.title || it.name || '?';
  const paths = it.paths || [];
  const regs = it.regs || [];
  const cloud = it.cloud || [];

  const cov = it.libCover
    ? '<div class="cov"><img src="' + esc(it.libCover) + '" alt="" loading="lazy" referrerpolicy="no-referrer">'
      + (it.libId ? '<button class="cov-btn" data-lib="' + esc(it.libId) + '" data-title="' + esc(title) + '" type="button">查看游戏详情</button>' : '')
      + '</div>'
    : '<div class="cov noimg"><span>' + esc(String(title).slice(0, 2).toUpperCase()) + '</span></div>';

  const altHtml = (it.name && it.name !== title) ? '<div class="alt" title="' + esc(it.name) + '">' + esc(String(it.name).slice(0, 46)) + '</div>' : '';

  const cloudTags = cloud.length
    ? cloud.map((c) => '<span class="tg cloud">☁ ' + esc(String(c).toUpperCase()) + '</span>').join('')
    : '<span class="tg dim">不支持云同步</span>';

  /* 唯一动作：打开合并下载弹窗并直接落在「存档」模块（`data-sv-open` 由 bindSvCards 分流）。
     ⚠️ 条数写进按钮文案 —— 卡面上没有路径了，用户需要一个「值不值得点」的量。
     注册表项也算一条记录（`dlUniPaintSave` 里两类都逐条列出），所以合计。 */
  const total = paths.length + regs.length;
  const open = '<button class="sv-open" type="button" data-sv-open'
    + ' data-title="' + esc(title) + '" data-lib="' + esc(it.libId || '') + '">'
    + (total ? '查看 ' + total + ' 条存档位置' : '查看存档位置') + '</button>';

  return '<article class="emu-card sv' + (it.libCover ? ' has-cov' : '') + '" data-name="' + esc(title) + '" data-lib="' + esc(it.libId || '') + '">'
    + cov
    + '<div class="bd">'
    + '<h4 title="' + esc(title) + '">' + esc(title) + '</h4>'
    + altHtml
    + '<div class="meta">'
    + (it.phone ? '<span class="tg phone">手机能玩</span>' : '')
    + '<span class="pill">' + paths.length + ' 条存档</span>'
    + (regs.length ? '<span class="pill">' + regs.length + ' 项注册表</span>' : '')
    + '</div>'
    + '<div class="tgs">' + cloudTags + '</div>'
    + open
    + '</div>'
    + '</article>';
}

function bindSvCards() {
  const g = document.getElementById('svGrid'); if (!g || g.dataset.bound) return;
  g.dataset.bound = '1';
  /* 点击分流：点 .sv-open 开弹窗「存档」模块；点正文其余位置有 libId 就进游戏详情。 */
  g.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sv-open]');
    if (btn) {
      e.stopPropagation();
      /* 跨页共享：openUniDownload 在主脚本里（派生页同样带上），这里只负责把参数递过去。
         ⚠️ 兜底也要有 —— 万一某天主脚本那块被裁掉，按钮不能变成「点了没反应」。 */
      if (typeof openUniDownload === 'function') {
        openUniDownload({
          title: btn.dataset.title || '', id: btn.dataset.lib || '', tab: 'save',
        });
      } else if (typeof toast === 'function') {
        toast('暂时打不开存档弹窗，请刷新页面重试');
      }
      return;
    }
    const card = e.target.closest('.emu-card'); if (!card) return;
    const cbtn = e.target.closest('.cov-btn');
    const lib = (cbtn && cbtn.dataset.lib) || card.dataset.lib;
    if (lib && typeof openDetailById === 'function') {
      openDetailById(lib, (cbtn && cbtn.dataset.title) || card.dataset.name);
      return;
    }
    if (typeof toast === 'function') toast('这条没对上端游库，没有详情页；可以点「查看存档位置」看路径');
  });
}

async function loadSv(more) {
  if (svState.loading) return;
  svState.loading = true;
  const grid = document.getElementById('svGrid');
  if (!more) { svState.offset = 0; if (grid) grid.innerHTML = '<div class="emu-loading">正在拉取存档位置库…</div>'; }
  try {
    const qs = new URLSearchParams({
      q: svState.q, sort: svState.sort, limit: RES_PAGE_SIZE, offset: svState.offset,
    });
    /* ★ 开关语义：phone 关掉 = 放开到全量（stats=all）。本页默认关（看全部端游） */
    if (svState.phone) qs.set('phone', '1'); else qs.set('stats', 'all');
    if (svState.cloud) qs.set('cloud', '1');
    const j = await fetch(api('/api/saves/list?' + qs)).then((r) => r.json());
    svState.total = j.total || 0;
    const items = j.items || [];
    svState.items = more ? svState.items.concat(items) : items;
    svState.offset = svState.items.length;
    if (grid) grid.innerHTML = svState.items.length ? svState.items.map(svCard).join('') : '<div class="emu-empty">没有匹配的游戏，换个关键词试试</div>';
    const cnt = document.getElementById('svCount'); if (cnt) cnt.textContent = '共 ' + svState.total.toLocaleString() + ' 款';
    const mo = document.getElementById('svMore');
    if (mo) mo.style.display = svState.items.length < svState.total ? '' : 'none';
  } catch (e) {
    if (grid) grid.innerHTML = '<div class="emu-empty">拉取失败，请稍后重试</div>';
  } finally { svState.loading = false; }
}

async function initSv() {
  if (svState.inited) return; svState.inited = true;
  bindSvCards();
  try {
    const s = await fetch(api('/api/saves/stats')).then((r) => r.json());
    const box = document.getElementById('svStats');
    if (box) {
      box.innerHTML = [
        ['收录游戏', s.total], ['存档位置', s.pathCount], ['支持云同步', s.withCloud], ['手机能玩', s.phonePlayable],
      ].map(([k, v]) => '<div class="st"><b>' + (v == null ? '—' : (typeof v === 'number' ? v.toLocaleString() : esc(v))) + '</b><span>' + k + '</span></div>').join('');
    }
    const built = document.getElementById('svBuilt');
    if (built && s.builtAt) built.textContent = '（清单更新于 ' + new Date(s.builtAt).toLocaleString('zh-CN', { hour12: false }) + '，源：' + s.source + '）';
  } catch (e) {}
  const si = document.getElementById('svSearch');
  if (si && !si.dataset.bound) {
    si.dataset.bound = '1';
    let t;
    si.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { svState.q = si.value.trim(); loadSv(false); }, 260); });
  }
  const sorts = document.getElementById('svSorts');
  if (sorts && !sorts.dataset.bound) {
    sorts.dataset.bound = '1';
    sorts.addEventListener('click', (e) => {
      const b = e.target.closest('.emu-sort'); if (!b) return;
      sorts.querySelectorAll('.emu-sort').forEach((x) => x.classList.toggle('on', x === b));
      svState.sort = b.dataset.s; loadSv(false);
    });
  }
  const mo = document.getElementById('svMore');
  if (mo && !mo.dataset.bound) { mo.dataset.bound = '1'; mo.addEventListener('click', () => loadSv(true)); }
  const ph = document.getElementById('svPhone');
  if (ph) {
    const paint = () => { ph.classList.toggle('on', svState.phone); };
    paint();
    if (!ph.dataset.bound) {
      ph.dataset.bound = '1';
      ph.addEventListener('click', () => { svState.phone = !svState.phone; paint(); loadSv(false); });
    }
  }
  const cl = document.getElementById('svCloud');
  if (cl) {
    const paint = () => { cl.classList.toggle('on', svState.cloud); };
    paint();
    if (!cl.dataset.bound) {
      cl.dataset.bound = '1';
      cl.addEventListener('click', () => { svState.cloud = !svState.cloud; paint(); loadSv(false); });
    }
  }
  await loadSv(false);
}

/* ============================================================================
 * ③ 修改器分区（#resTrainers）—— 自 emulator-sections.js 搬家，正文逐字未改
 *
 * ★ 关于「放置位置」：修改器是**独立 exe，不需要放进游戏目录**。
 *   直接运行即可，它会自己挂上游戏进程。
 * ★ 本页**刻意不做下载按钮**：GCM 官方下载走一次性 S3 签名 URL（依赖客户端密钥），
 *   无法离线复现也不该绕过。所以改为「信息展示 + 获取方式引导」。
 * ========================================================================== */
const trState = { q: '', source: '', sort: 'lib', matched: true, offset: 0, total: 0, items: [], inited: false, loading: false };

/** 5 个来源的展示名与官方获取入口（链接均已实测 200） */
const TR_SRC = {
  fling: { label: '风灵月影', go: 'https://flingtrainer.com/', goLabel: '风灵月影官网' },
  cheat_table: { label: 'CE 修改表', go: 'https://gamezonelabs.com/products/gcm/trainers', goLabel: 'GCM 修改器库' },
  community: { label: '社区贡献', go: 'https://gamezonelabs.com/products/gcm/trainers', goLabel: 'GCM 修改器库' },
  xiaoxing: { label: '小幸修改器', go: 'https://gamezonelabs.com/products/gcm/trainers', goLabel: 'GCM 修改器库' },
  gcm: { label: 'GCM 精选', go: 'https://github.com/dyang886/Game-Cheats-Manager/releases', goLabel: 'GCM 下载页' },
};

function trCard(it) {
  const zh = it.zh || '';
  const en = it.name || '';
  const title = zh || en || '?';
  const meta = TR_SRC[it.source] || { label: it.source || '未知来源', go: '', goLabel: '' };

  const cov = it.libCover
    ? '<div class="cov"><img src="' + esc(it.libCover) + '" alt="" loading="lazy" referrerpolicy="no-referrer">'
      + (it.libId ? '<button class="cov-btn" data-lib="' + esc(it.libId) + '" data-title="' + esc(it.libTitle || title) + '" type="button">查看游戏详情</button>' : '')
      + '</div>'
    : '<div class="cov noimg"><span>' + esc(String(title).slice(0, 2).toUpperCase()) + '</span></div>';

  /* 中文名优先做标题，英文名降级成别名行；两者相同时不重复渲染 */
  const altHtml = (zh && en && zh !== en) ? '<div class="alt" title="' + esc(en) + '">' + esc(String(en).slice(0, 46)) + '</div>' : '';

  const go = meta.go
    ? '<div class="tr-go"><a href="' + esc(meta.go) + '" target="_blank" rel="noopener noreferrer">获取方式 ↗ ' + esc(meta.goLabel) + '</a></div>'
    : '';

  return '<article class="emu-card' + (it.libCover ? ' has-cov' : '') + '" data-name="' + esc(title) + '" data-lib="' + esc(it.libId || '') + '" data-libt="' + esc(it.libTitle || '') + '">'
    + cov
    + '<div class="bd">'
    + '<h4 title="' + esc(title) + '">' + esc(title) + '</h4>'
    + altHtml
    + '<div class="meta">'
    + '<span class="tg src ' + esc(it.source) + '">' + esc(meta.label) + '</span>'
    + (it.version ? '<span class="pill ver">v ' + esc(it.version) + '</span>' : '')
    + (it.libId ? '<span class="tg">已关联端游库</span>' : '')
    + '</div>'
    + go
    + '<div class="tr-note">💡 <b>放置位置</b>：独立 exe，<b>不用放进游戏目录</b>，双击运行即可（会自动挂上游戏进程）。</div>'
    + '</div>'
    + '</article>';
}

function bindTrCards() {
  const g = document.getElementById('trGrid'); if (!g || g.dataset.bound) return;
  g.dataset.bound = '1';
  g.addEventListener('click', (e) => {
    const btn = e.target.closest('.cov-btn');
    const card = e.target.closest('.emu-card'); if (!card) return;
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

async function loadTr(more) {
  if (trState.loading) return;
  trState.loading = true;
  const grid = document.getElementById('trGrid');
  if (!more) { trState.offset = 0; if (grid) grid.innerHTML = '<div class="emu-loading">正在拉取修改器清单…</div>'; }
  try {
    const qs = new URLSearchParams({
      q: trState.q, source: trState.source, sort: trState.sort,
      limit: RES_PAGE_SIZE, offset: trState.offset,
    });
    if (!trState.matched) qs.set('stats', 'all');
    const j = await fetch(api('/api/trainers/list?' + qs)).then((r) => r.json());
    trState.total = j.total || 0;
    const items = j.items || [];
    trState.items = more ? trState.items.concat(items) : items;
    trState.offset = trState.items.length;
    if (grid) grid.innerHTML = trState.items.length ? trState.items.map(trCard).join('') : '<div class="emu-empty">没有匹配的修改器，换个关键词试试</div>';
    const cnt = document.getElementById('trCount'); if (cnt) cnt.textContent = '共 ' + trState.total.toLocaleString() + ' 条';
    const mo = document.getElementById('trMore');
    if (mo) mo.style.display = trState.items.length < trState.total ? '' : 'none';
  } catch (e) {
    if (grid) grid.innerHTML = '<div class="emu-empty">拉取失败，请稍后重试</div>';
  } finally { trState.loading = false; }
}

async function initTr() {
  if (trState.inited) return; trState.inited = true;
  bindTrCards();
  try {
    const s = await fetch(api('/api/trainers/stats')).then((r) => r.json());
    const box = document.getElementById('trStats');
    if (box) {
      box.innerHTML = [
        ['修改器总数', s.total], ['已关联端游', s.matched], ['来源数', (s.sources || []).length], ['匹配率', s.matchedRate + '%'],
      ].map(([k, v]) => '<div class="st"><b>' + (v == null ? '—' : (typeof v === 'number' ? v.toLocaleString() : esc(v))) + '</b><span>' + k + '</span></div>').join('');
    }
    const built = document.getElementById('trBuilt');
    if (built && s.builtAt) built.textContent = '（清单更新于 ' + new Date(s.builtAt).toLocaleString('zh-CN', { hour12: false }) + '）';
    const sel = document.getElementById('trSource');
    if (sel && s.sources) {
      sel.innerHTML = '<option value="">全部来源</option>' + s.sources
        .map((x) => '<option value="' + esc(x.key) + '">' + esc(x.label) + '（' + Number(x.count).toLocaleString() + '）</option>').join('');
    }
  } catch (e) {}
  const si = document.getElementById('trSearch');
  if (si && !si.dataset.bound) {
    si.dataset.bound = '1';
    let t;
    si.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { trState.q = si.value.trim(); loadTr(false); }, 260); });
  }
  const sel = document.getElementById('trSource');
  if (sel && !sel.dataset.bound) {
    sel.dataset.bound = '1';
    sel.addEventListener('change', () => { trState.source = sel.value; loadTr(false); });
  }
  const sorts = document.getElementById('trSorts');
  if (sorts && !sorts.dataset.bound) {
    sorts.dataset.bound = '1';
    sorts.addEventListener('click', (e) => {
      const b = e.target.closest('.emu-sort'); if (!b) return;
      sorts.querySelectorAll('.emu-sort').forEach((x) => x.classList.toggle('on', x === b));
      trState.sort = b.dataset.s; loadTr(false);
    });
  }
  const mo = document.getElementById('trMore');
  if (mo && !mo.dataset.bound) { mo.dataset.bound = '1'; mo.addEventListener('click', () => loadTr(true)); }
  const tg = document.getElementById('trToggleLib');
  if (tg) {
    const paint = () => { tg.classList.toggle('on', trState.matched); };
    paint();
    if (!tg.dataset.bound) {
      tg.dataset.bound = '1';
      tg.addEventListener('click', () => { trState.matched = !trState.matched; paint(); loadTr(false); });
    }
  }
  await loadTr(false);
}
