/* ================= 📱 手机专区三分区驱动（独立页专用） =================
 *
 * 为什么单独一份：
 *   这三个分区原先内联在 index.html，随「拆独立页」一起被移除。
 *   独立页需要它们自己的数据加载 / 渲染 / 筛选 / 懒加载逻辑。
 *
 * 分区与接口对应：
 *   #emulator  手游中心（社区库 + 实测库 **合并成一张表**）
 *              → /api/mobilehub/stats、/api/mobilehub/list、/api/mobilehub/match
 *   #emuguide  模拟器指南 → /api/emuguide、/api/emuguide/chip
 *   #devmatch  机型兼容 → /api/device/*
 *
 * 懒加载：每个分区首次被切到时才发请求（inited 标记），避免一次性打满接口。
 */

/* ---------------- 通用小工具（若主脚本已定义则复用） ---------------- */
if (typeof window.esc !== 'function') {
  window.esc = (s) => String(s == null ? '' : s)
    .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const EMU_PAGE_SIZE = 24;

/* ================= ① 手游中心（社区库 + 实测库 合并） =================
 *
 * ★ v9.3 改造（用户诉求：「先将手游已有的配置+实测汇总，再将已收录的游戏对应电脑的进行匹配，
 *   手游默认显示跟端游匹配的游戏」）：
 *   原本这里是「手游可玩」（社区库）一个页签，隔壁还有「实测配置」（实测库）一个页签。
 *   同一款游戏（GTA V）在两个页签各出现一次，用户要来回切，也看不出
 *   「这款到底有几套配置可抄 + 实测跑多少帧」。
 *
 *   现在统一走 /api/mobilehub/*，后端已把两个库按名字/端游库 id 归并：
 *     · 同款只占一条，配置数累加（社区 N 套 + 实测 M 条）
 *     · 卡片同时显示「N 套配置」「M 条实测」「实测 XX 帧」
 *     · **默认只显示能对上端游库的**（matched）—— 有封面、点得进详情
 *     · **默认「双料优先」排序**：帧率数据与社区配置数几乎不重叠（详见 mobilehub.js 注释），
 *       纯按配置数排首屏看不到任何帧率卡，所以默认把「两类信息都有」的顶上来
 */
const emuState = { q: '', gpu: '', tier: '', sort: 'both', matched: true, both: false, tr: false, sv: false, offset: 0, total: 0, items: [], inited: false, loading: false };

/** 帧率档 → 徽标配色类 */
const TIER_CLS = { '流畅': 'smooth', '可玩': 'ok', '勉强': 'low', '卡顿': 'bad' };

/** 合并卡片：封面（命中端游库则铺图）+ 配置数 + 实测帧率 + GPU/机型标签 */
function emuCard(it) {
  const title = it.name || it.libTitle || '?';
  const cov = it.libCover
    ? `<div class="cov"><img src="${esc(it.libCover)}" alt="" loading="lazy" referrerpolicy="no-referrer">
         ${it.libId ? `<button class="cov-btn" data-lib="${esc(it.libId)}" data-title="${esc(it.libTitle || title)}" type="button">查看游戏详情</button>` : ''}</div>`
    : `<div class="cov noimg"><span>${esc(String(title).slice(0, 2).toUpperCase())}</span></div>`;

  /* 数据来源徽标：一眼看出「这条是社区抄的配置 / 还是本站实测的」 */
  const srcs = it.sources || [];
  const srcTag = (srcs.indexOf('bh') >= 0 && srcs.indexOf('pc') >= 0)
    ? `<span class="tg src both">社区+实测</span>`
    : srcs.indexOf('pc') >= 0 ? `<span class="tg src pc">本站实测</span>`
      : `<span class="tg src bh">社区配置</span>`;

  const cfg = it.configs || 0;
  const rec = it.records || 0;
  const fps = it.bestLabel || (it.bestMid ? it.bestMid + ' 帧' : '');

  const gpus = (it.gpus || []).slice(0, 3).map((g) => `<span class="tg">${esc(g)}</span>`).join('');
  const more = (it.gpus || []).length > 3 ? `<span class="tg dim">+${it.gpus.length - 3}</span>` : '';

  /* ★ v10.5：把「有修改器 / 有云存档」这层交叉信息露在卡面上 ——
   *   否则用户点了筛选、却说不出这些卡为什么被留下。 */
  const xrefTag = (it.hasTr ? '<span class="tg has-tr" title="修改器库收录了这款">🛠 有修改器</span>' : '')
    + (it.hasSv ? '<span class="tg has-sv" title="云存档库有这款的存档位置">💾 有存档</span>' : '');

  /* 别名提示：社区库是英文名、实测库是中文名，让用户看到两面 */
  const alt = (it.alt || []).filter((a) => a && a !== title)[0] || '';
  const altHtml = alt ? `<div class="alt" title="${esc(alt)}">${esc(String(alt).slice(0, 40))}</div>` : '';

  /* ★ v10.5：社区配置入口从「整卡点击」降级为卡上一个次级按钮 ——
   *   原因：「有社区配置键(bhKeys) 且 命中端游库(libId)」的卡片，旧逻辑让 bhk 优先，
   *   于是点正文进的是社区配置面板，用户反馈「点了不是游戏详情页」。
   *   现在正文一律进详情（有 libId 时），配置面板走这个明确的按钮。 */
  /* ★ v10.13：把**全部**候选仓库键带上（逗号分隔），不再只给第一个。
   *   同一款游戏在社区仓库里常有多个别名目录，份数差很多（如 PES2013 只有 2 份，
   *   Pro_Evolution_Soccer_2013 有 2773 份）。后端会挑份数最多的那个。 */
  const bhKeyList = (it.bhKeys || []).join(',');
  const cfgBtn = (it.bhKeys || []).length
    ? `<button class="cfg-btn" data-bhk="${esc(bhKeyList)}" data-nm="${esc(title)}" type="button" title="看这台设备上逐条跑通的模拟器配置">📋 社区配置</button>`
    : '';

  return `<article class="emu-card${it.libCover ? ' has-cov' : ''}" data-name="${esc(title)}" data-lib="${esc(it.libId || '')}" data-libt="${esc(it.libTitle || '')}" data-bhk="${esc(bhKeyList)}">
    ${cov}
    <div class="bd">
      <h4 title="${esc(title)}">${esc(title)}</h4>
      ${altHtml}
      <div class="meta">
        ${cfg ? `<span class="pill hot">${cfg} 套配置</span>` : ''}
        ${rec ? `<span class="pill rec">${rec} 条实测</span>` : ''}
        ${fps ? `<span class="pill fps ${TIER_CLS[it.tier] || ''}">${esc(String(fps))}</span>` : ''}
      </div>
      <div class="tgs">${srcTag}${gpus}${more}${xrefTag}${cfgBtn}</div>
    </div>
  </article>`;
}

/** 卡片点击分流（v10.5 统一语义：**有端游库命中就进详情页**）
 *   · 点「📋 社区配置」按钮 → 社区配置面板
 *   · 点「查看游戏详情」按钮 / 卡片正文（有 libId）→ 游戏详情抽屉
 *   · 没对上端游库但社区库有键 → 社区配置面板（此时没有详情可去，整卡开面板）
 *   · 都没有 → 提示未收录
 */
function bindEmuCards() {
  const g = document.getElementById('emuGrid'); if (!g || g.dataset.bound) return;
  g.dataset.bound = '1';
  g.addEventListener('click', (e) => {
    const card = e.target.closest('.emu-card'); if (!card) return;
    const cfg = e.target.closest('.cfg-btn');
    if (cfg && cfg.dataset.bhk && typeof openBhPanel === 'function') {
      e.stopPropagation();
      openBhPanel(cfg.dataset.bhk, cfg.dataset.nm || card.dataset.name);
      return;
    }
    const btn = e.target.closest('.cov-btn');
    const lib = (btn && btn.dataset.lib) || card.dataset.lib;
    if (lib && typeof openDetailById === 'function') {
      openDetailById(lib, (btn && btn.dataset.title) || card.dataset.libt || card.dataset.name);
      return;
    }
    if (card.dataset.bhk && typeof openBhPanel === 'function') {
      openBhPanel(card.dataset.bhk, card.dataset.name);
      return;
    }
    if (typeof toast === 'function') toast('这款未收录进本地端游库，暂无详情页');
  });
}

async function loadEmu(more) {
  if (emuState.loading) return;
  emuState.loading = true;
  const grid = document.getElementById('emuGrid');
  if (!more) { emuState.offset = 0; if (grid) grid.innerHTML = '<div class="emu-loading">正在拉取手游中心数据…</div>'; }
  try {
    const qs = new URLSearchParams({
      q: emuState.q, gpu: emuState.gpu, tier: emuState.tier, sort: emuState.sort,
      limit: EMU_PAGE_SIZE, offset: emuState.offset,
    });
    /* ★ 默认只显示匹配端游库的；关掉开关时传 stats=all 看全量 */
    if (!emuState.matched) qs.set('stats', 'all');
    /* ★ v10.1「只看双料」：与 stats 是 AND 关系（两个都开 = 双料且对上端游库 = 85 条） */
    if (emuState.both) qs.set('only', 'both');
    /* ★ v10.5 横切筛选：有修改器 / 有云存档（同样与上面各条件 AND） */
    if (emuState.tr) qs.set('tr', '1');
    if (emuState.sv) qs.set('sv', '1');
    const j = await fetch(api('/api/mobilehub/list?' + qs)).then((r) => r.json());
    emuState.total = j.total || 0;
    const items = j.items || [];
    emuState.items = more ? emuState.items.concat(items) : items;
    emuState.offset = emuState.items.length;
    if (grid) grid.innerHTML = emuState.items.length ? emuState.items.map(emuCard).join('') : '<div class="emu-empty">没有匹配的游戏，换个关键词试试</div>';
    const cnt = document.getElementById('emuCount'); if (cnt) cnt.textContent = `共 ${emuState.total.toLocaleString()} 款`;
    const mo = document.getElementById('emuMore');
    if (mo) mo.style.display = emuState.items.length < emuState.total ? '' : 'none';
  } catch (e) {
    if (grid) grid.innerHTML = '<div class="emu-empty">拉取失败，请稍后重试</div>';
  } finally { emuState.loading = false; }
}

async function initEmu() {
  if (emuState.inited) return; emuState.inited = true;
  bindEmuCards();
  // 顶部概览数字（合并口径）
  try {
    const s = await fetch(api('/api/mobilehub/stats')).then((r) => r.json());
    const box = document.getElementById('emuStats');
    if (box) {
      box.innerHTML = [
        ['合并游戏', s.total], ['匹配端游', s.matched], ['配置总数', s.configs], ['实测记录', s.records],
      ].map(([k, v]) => `<div class="st"><b>${v == null ? '—' : (typeof v === 'number' ? v.toLocaleString() : esc(v))}</b><span>${k}</span></div>`).join('');
    }
    const built = document.getElementById('emuBuilt');
    if (built && s.builtAt) built.textContent = `（索引更新于 ${new Date(s.builtAt).toLocaleString('zh-CN', { hour12: false })}，匹配率 ${s.matchedRate}%）`;
    // GPU / 机型 下拉
    const sel = document.getElementById('emuGpu');
    if (sel && s.gpus) {
      sel.innerHTML = '<option value="">全部 GPU / 机型</option>' + s.gpus.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
    }
  } catch (e) {}
  // 工具条事件
  const si = document.getElementById('emuSearch');
  if (si && !si.dataset.bound) {
    si.dataset.bound = '1';
    let t;
    si.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { emuState.q = si.value.trim(); loadEmu(false); }, 260); });
  }
  const gpu = document.getElementById('emuGpu');
  if (gpu && !gpu.dataset.bound) { gpu.dataset.bound = '1'; gpu.addEventListener('change', () => { emuState.gpu = gpu.value; loadEmu(false); }); }
  const tier = document.getElementById('emuTier');
  if (tier && !tier.dataset.bound) { tier.dataset.bound = '1'; tier.addEventListener('change', () => { emuState.tier = tier.value; loadEmu(false); }); }
  const sorts = document.getElementById('emuSorts');
  if (sorts && !sorts.dataset.bound) {
    sorts.dataset.bound = '1';
    sorts.addEventListener('click', (e) => {
      const b = e.target.closest('.emu-sort'); if (!b) return;
      sorts.querySelectorAll('.emu-sort').forEach((x) => x.classList.toggle('on', x === b));
      emuState.sort = b.dataset.s; loadEmu(false);
    });
  }
  const mo = document.getElementById('emuMore');
  if (mo && !mo.dataset.bound) { mo.dataset.bound = '1'; mo.addEventListener('click', () => loadEmu(true)); }
  /* ---- 筛选开关统一装配（v10.5）----
   *   ★ 状态**完全不碰文案**：文字恒定，只在 .on 之间切换；
   *     左侧的「○ / ✓」由 CSS 定宽伪元素 .em-tg::before 提供。
   *     踩过两次坑：① 旧版把文案改成「…（已开）」→ 按钮宽 +28px → 后面的开关被挤换行；
   *     ② 把 ✓/○ 写进文案 → 两个字形宽度差 1.6px → 浏览器实测宽度仍在变。
   *     定宽伪元素是唯一能保证「盒宽逐像素不变」的写法。 */
  const bindToggle = (id, key, storeKey) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (storeKey) { try { emuState[key] = localStorage.getItem(storeKey) === '1'; } catch (e) {} }
    const paint = () => el.classList.toggle('on', !!emuState[key]);
    paint();
    if (el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('click', () => {
      emuState[key] = !emuState[key];
      if (storeKey) { try { localStorage.setItem(storeKey, emuState[key] ? '1' : '0'); } catch (e) {} }
      paint();
      loadEmu(false);
    });
  };
  /* 「仅看匹配端游」**默认开**（用户诉求：手游默认显示跟端游匹配的游戏） */
  bindToggle('emuToggleLib', 'matched');
  /* 「只看双料」：社区配置库(bh) 与 机型实测库(pc) 都有记录 —— 全量 3161 条里只有 88 条。
   *   正因为稀缺，它才最能体现「两库合并」的价值：既有玩家跑通的配置，又有本站实测帧率。 */
  bindToggle('emuToggleBoth', 'both', 'ghEmuBoth');
  /* ★ v10.5 新增：按「修改器 / 云存档」索引是否收录来筛（两条数据都挂端游库 id） */
  bindToggle('emuToggleTr', 'tr', 'ghEmuTr');
  bindToggle('emuToggleSv', 'sv', 'ghEmuSv');
  const rf = document.getElementById('emuRefresh');
  if (rf && !rf.dataset.bound) {
    rf.dataset.bound = '1';
    rf.addEventListener('click', async () => {
      if (typeof toast === 'function') toast('正在刷新社区配置库…');
      try { await fetch(api('/api/bh/refresh'), { method: 'POST' }); } catch (e) {}
      setTimeout(() => loadEmu(false), 1500);
    });
  }
  await loadEmu(false);
}


/* ================= ③ 模拟器指南 ================= */
const egState = { inited: false };

async function initEg() {
  if (egState.inited) return; egState.inited = true;
  try {
    const g = await fetch(api('/api/emuguide')).then((r) => r.json());
    const st = document.getElementById('egStack');
    if (st && g.stack) {
      st.innerHTML = g.stack.map((x) => `<div class="eg-ly">
        <div class="eg-n">${x.n}</div>
        <div class="eg-tx"><b>${esc(x.name)}</b><span class="eg-sub">${esc(x.sub || '')}</span><p>${esc(x.desc || '')}</p></div>
        ${x.key ? '<span class="eg-key">关键</span>' : ''}
      </div>`).join('');
    }
    const ch = document.getElementById('egChips');
    if (ch && g.chips) {
      ch.innerHTML = g.chips.map((c) => `<div class="eg-chip ${esc(c.tone || '')}">
        <div class="eg-ch-h"><b>${esc(c.soc || '')}</b><span class="eg-tier">${esc(c.tier || '')}</span></div>
        <div class="eg-ch-b">推荐驱动 <code>${esc(c.driver || '—')}</code></div>
        ${c.alt ? `<div class="eg-ch-b dim">备选 <code>${esc(c.alt)}</code></div>` : ''}
        ${c.build ? `<div class="eg-ch-b dim">构建 <code>${esc(c.build)}</code></div>` : ''}
        ${c.note ? `<p class="eg-ch-note">${esc(c.note)}</p>` : ''}
      </div>`).join('');
    }
    const w = document.getElementById('egWrap');
    if (w && g.wrappers) w.innerHTML = g.wrappers.map((x) => `<li><b>${esc(x.name || x.n || '')}</b>${esc(x.desc || x.d || '')}</li>`).join('');
    const tn = document.getElementById('egTune');
    if (tn && g.tuning) tn.innerHTML = g.tuning.map((x) => `<li><b>${esc(x.name || x.n || '')}</b>${esc(x.desc || x.d || '')}</li>`).join('');
    const av = document.getElementById('egAvoid');
    if (av && g.avoid) av.innerHTML = g.avoid.map((x) => `<li><b>${esc(x.name || x.n || '')}</b>${esc(x.desc || x.d || '')}</li>`).join('');
    const be = document.getElementById('egBench');
    if (be && g.bench) be.innerHTML = g.bench.map((x) => `<li><b>${esc(x.name || x.n || '')}</b>${esc(x.desc || x.d || '')}</li>`).join('');
    /* ★ v10.13 新增：版本门槛（哪些版本号是当前该用的） */
    const vr = document.getElementById('egVer');
    if (vr && g.versions) vr.innerHTML = g.versions.map((x) => `<li><b>${esc(x.name || '')}</b>${esc(x.desc || '')}</li>`).join('');
    const s = document.getElementById('egSrc');
    if (s) s.textContent = '经验参考 · 非官方';
  } catch (e) {}
}

/* ================= ④ 机型兼容查询 =================
 * 「选品牌 + 型号 → 能跑哪些 PC 游戏」。
 * 数据：/api/device/brands、/api/device/models、/api/device/match、/api/device/turnip
 * 判定：机型 → GPU → 性能档；游戏被「性能 ≤ 用户档」的 GPU 跑过即算可跑（向下兼容）。
 */
const dmState = {
  inited: false,
  brand: '',
  model: '',
  gpu: '',
  score: null,
  list: [],
  total: 0,
  summary: null,
  verdict: '',     // '' | smooth | ok | maybe
  q: '',
  offset: 0,
};

const DM_TIER = {
  smooth: { txt: '流畅', cls: 'ok' },
  ok: { txt: '可玩', cls: 'mid' },
  maybe: { txt: '勉强', cls: 'low' },
};

function dmFmtScore(s) {
  return s == null ? '—' : Math.round(s);
}

/** 机型卡片 */
function dmCard(g) {
  const t = DM_TIER[g.verdict] || { txt: '—', cls: '' };
  const cov = g.libCover
    ? `<div class="cov"><img src="${esc(g.libCover)}" alt="" loading="lazy" referrerpolicy="no-referrer"></div>`
    : `<div class="cov noimg"><span>${esc((g.name || '?').slice(0, 2).toUpperCase())}</span></div>`;
  return `<article class="emu-card${g.libCover ? ' has-cov' : ''}" data-k="${esc(g.k)}" data-p="${esc(g.name || '')}">
    ${cov}
    <div class="bd">
      <h4 title="${esc(g.name || '')}">${esc(g.name || g.k || '')}</h4>
      <div class="meta">
        <span class="pill ${t.cls}">${t.txt}</span>
        <span class="pill">${g.configs || 0} 套配置</span>
        ${g.devices ? `<span class="pill">${g.devices} 机型</span>` : ''}
      </div>
      <div class="dm-need">最低参考 <code>${esc(g.minGpu || '—')}</code></div>
    </div>
  </article>`;
}

/** 渲染结果网格（支持分页） */
function dmRender() {
  const box = document.getElementById('dmGrid');
  if (!box) return;
  let list = dmState.list;
  if (dmState.verdict) list = list.filter((g) => g.verdict === dmState.verdict);
  if (dmState.q) {
    const k = dmState.q.toLowerCase();
    list = list.filter((g) => String(g.name || '').toLowerCase().includes(k));
  }
  dmState.filtered = list;
  const page = list.slice(dmState.offset, dmState.offset + EMU_PAGE_SIZE);
  box.innerHTML = page.length
    ? page.map(dmCard).join('')
    : '<p class="dm-empty">没有符合条件的游戏。</p>';

  const cnt = document.getElementById('dmCount');
  if (cnt) cnt.textContent = `共 ${list.length} 款`;

  const more = document.getElementById('dmMore');
  if (more) more.style.display = list.length > dmState.offset + EMU_PAGE_SIZE ? '' : 'none';
}

/** 执行一次匹配查询 */
async function dmQuery(model) {
  if (!model) return;
  dmState.model = model;
  dmState.offset = 0;
  const grid = document.getElementById('dmGrid');
  if (grid) grid.innerHTML = '<p class="dm-empty">匹配中…</p>';
  try {
    const r = await fetch(api('/api/device/match?limit=1000&model=' + encodeURIComponent(model))).then((x) => x.json());
    if (!r.ok) {
      const msg = r.error === 'notfound' ? '未找到该机型，试试下拉列表里的写法。'
        : r.error === 'nogpu' ? '这台机型在库里还没记录到 GPU 信息。' : '查询失败。';
      if (grid) grid.innerHTML = `<p class="dm-empty">${msg}</p>`;
      return;
    }
    dmState.gpu = r.device.gpu;
    dmState.score = r.device.score;
    dmState.list = r.games || [];
    dmState.total = r.total;
    dmState.summary = r.summary;
    dmState.filtered = dmState.list;

    // 结果区从隐藏 → 显示
    /* ★ dmResultSec 的隐藏是**内联** style="display:none"，置空即可；
       dmInfo 的隐藏却写在 CSS 规则里（.dm-info 的默认 display 就是 none），
       置空只是删掉内联样式、CSS 照样赢 → 机型卡永远不显示。
       必须显式给一个非 none 的值。（截图体检才发现的）
       注：注释里不要写「选择器 + 花括号」的完整形式，否则会被
       test-emulator-page 的「裸 CSS 文本」断言误判为 CSS 泄漏。 */
    const sec = document.getElementById('dmResultSec');
    if (sec) sec.style.display = '';

    const info = document.getElementById('dmInfo');
    if (info) {
      info.style.display = 'block';   // 不能用 ''：.dm-info 的 CSS 默认就是 display:none
      /* ★ v10.11/v10.12 机型「转译」：把 `SM S938B` / `Xiaomi 24115RA8EG` 这类内部代号，
         翻成人看得懂的 GPU → SoC → CPU 三级。
           · GPU：来自 bannerhub-files.json 的**逐条配对**（机型与 GPU 本来就成对，覆盖 95.6%）
           · SoC：由 data/gpu-soc.json 的 GPU→SoC 表反查（覆盖 92.9% 记录）
           · CPU：data/soc-cpu.json（tools/fetch-soc-cpu.js 从 nanoreview 抓的核簇描述，
                  343 条 = 246 市场名 + 97 芯片编号别名），覆盖 92.4% 机型；
                  device-board.json 只作兜底（它只有 200 条主板，且实测有脏值）
         旧实现的 GPU 是 `gps[0]`（该游戏第一个 GPU），与本机型无关，配错很多。 */
      const dv = r.device || {};
      const socTxt = dv.soc ? (dv.socVendor ? dv.socVendor + ' ' + dv.soc : dv.soc) : '';
      info.innerHTML = `
        <div class="dm-info-h">
          <b>${esc(dv.model)}</b>
          <span class="dm-brand">${esc(dv.brand || '')}</span>
        </div>
        <div class="dm-info-r">
          ${socTxt
            ? `<span>芯片 <b>${esc(socTxt)}</b></span>`
            : '<span class="dm-nosoc">芯片 未收录</span>'}
          <span>GPU <code>${esc(dv.gpu || '未知')}</code></span>
          <span>性能档 <b>${dmFmtScore(dv.score)}</b></span>
        </div>
        ${dv.cpu ? `<div class="dm-info-cpu"><i>CPU</i><code>${esc(dv.cpu)}</code></div>` : ''}
        <div class="dm-sum">
          <span class="pill ok">流畅 ${r.summary.smooth}</span>
          <span class="pill mid">可玩 ${r.summary.ok}</span>
          <span class="pill low">勉强 ${r.summary.maybe}</span>
          <span class="pill dim">合计 ${r.total}</span>
        </div>`;
    }
    dmRender();
    dmLoadTurnip();
  } catch (e) {
    if (grid) grid.innerHTML = '<p class="dm-empty">网络错误，请稍后重试。</p>';
  }
}

/** 加载 Turnip 驱动看板（顺带展示，不阻塞主查询） */
async function dmLoadTurnip() {
  const box = document.getElementById('dmTurnip');
  if (!box || box.dataset.done) return;
  box.dataset.done = '1';
  try {
    const t = await fetch(api('/api/device/turnip')).then((r) => r.json());
    if (!t.ok) throw 0;
    const L = t.latest || {};
    box.innerHTML = `
      <div class="dm-tp-h"><b>Turnip 驱动最新构建</b><span class="dm-tp-a">${esc(L.buildDate || '')}</span></div>
      <div class="dm-tp-r">
        <span>Mesa <code>${esc(L.mesa || '—')}</code></span>
        <span>Vulkan <code>${esc(L.vulkan || '—')}</code></span>
      </div>
      <div class="dm-tp-v">
        ${(t.variants || []).map((v) => `<div class="dm-var">
          <b>${esc(v.name)}</b>
          <span class="dm-var-g">${esc(v.gpus)}</span>
          ${v.note ? `<span class="dm-var-n">${esc(v.note)}</span>` : ''}
        </div>`).join('')}
      </div>
      <a class="dm-tp-link" href="${esc(t.site || '#')}" target="_blank" rel="noopener">前往下载 ↓</a>`;
  } catch (e) {
    box.innerHTML = '';
  }
}

/** 初始化机型查询分区 */
async function initDm() {
  dmLoadTurnip();
  if (dmState.inited) return;
  dmState.inited = true;

  // 品牌下拉
  try {
    const b = await fetch(api('/api/device/brands')).then((r) => r.json());
    const sel = document.getElementById('dmBrand');
    if (sel && b.ok) {
      sel.innerHTML = '<option value="">选择品牌…</option>' +
        b.brands.map((x) => `<option value="${esc(x.name)}">${esc(x.name)}（${x.n}）</option>`).join('');
    }
  } catch (e) {}

  // 型号搜索建议（输入即查）
  const inp = document.getElementById('dmInput');
  const box = document.getElementById('dmSug');
  if (inp) {
    let timer = null;
    inp.addEventListener('input', () => {
      clearTimeout(timer);
      const q = inp.value.trim();
      if (q.length < 1) { if (box) box.style.display = 'none'; return; }
      timer = setTimeout(async () => {
        try {
          const r = await fetch(api('/api/device/models?limit=12&q=' + encodeURIComponent(q))).then((x) => x.json());
          if (!r.ok || !r.models.length) { if (box) box.style.display = 'none'; return; }
          box.innerHTML = r.models.map((m) =>
            `<button type="button" class="dm-sug-i" data-m="${esc(m.model)}">
              <b>${esc(m.model)}</b>
              <span>${esc(m.brand)}${m.gpu ? ' · ' + esc(m.gpu) : ''}</span>
            </button>`).join('');
          box.style.display = '';
          box.querySelectorAll('[data-m]').forEach((el) => {
            el.addEventListener('click', () => {
              inp.value = el.dataset.m;
              box.style.display = 'none';
              dmQuery(el.dataset.m);
            });
          });
        } catch (e) {}
      }, 180);
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { if (box) box.style.display = 'none'; dmQuery(inp.value.trim()); }
    });
    document.addEventListener('click', (e) => {
      if (box && !box.contains(e.target) && e.target !== inp) box.style.display = 'none';
    });
  }

  // 查询按钮
  const go = document.getElementById('dmGo');
  if (go) {
    go.addEventListener('click', () => {
      const v = inp ? inp.value.trim() : '';
      if (!v) { if (inp) inp.focus(); return; }
      if (box) box.style.display = 'none';
      dmQuery(v);
    });
  }

  // 品牌切换 → 列出该品牌机型
  const brand = document.getElementById('dmBrand');
  if (brand) {
    brand.addEventListener('change', async () => {
      const bv = brand.value;
      if (!bv) return;
      try {
        const r = await fetch(api('/api/device/models?limit=200&brand=' + encodeURIComponent(bv))).then((x) => x.json());
        if (!r.ok) return;
        if (box) {
          box.innerHTML = r.models.map((m) =>
            `<button type="button" class="dm-sug-i" data-m="${esc(m.model)}">
              <b>${esc(m.model)}</b>
              <span>${m.gpu ? esc(m.gpu) : ''}${m.games ? ' · ' + m.games + ' 款可玩' : ''}</span>
            </button>`).join('');
          box.style.display = '';
          box.querySelectorAll('[data-m]').forEach((el) => {
            el.addEventListener('click', () => {
              if (inp) inp.value = el.dataset.m;
              box.style.display = 'none';
              dmQuery(el.dataset.m);
            });
          });
        }
      } catch (e) {}
    });
  }

  // 档位筛选
  document.querySelectorAll('[data-dmv]').forEach((el) => {
    el.addEventListener('click', () => {
      document.querySelectorAll('[data-dmv]').forEach((x) => x.classList.remove('on'));
      el.classList.add('on');
      dmState.verdict = el.dataset.dmv;
      dmState.offset = 0;
      dmRender();
    });
  });

  // 结果内搜索
  const s = document.getElementById('dmSearch');
  if (s) {
    s.addEventListener('input', () => {
      dmState.q = s.value.trim();
      dmState.offset = 0;
      dmRender();
    });
  }

  // 加载更多
  const more = document.getElementById('dmMore');
  if (more) {
    more.addEventListener('click', () => {
      dmState.offset += EMU_PAGE_SIZE;
      const list = dmState.filtered || dmState.list;
      const page = list.slice(dmState.offset, dmState.offset + EMU_PAGE_SIZE);
      const g = document.getElementById('dmGrid');
      if (g) g.insertAdjacentHTML('beforeend', page.map(dmCard).join(''));
      if (list.length <= dmState.offset + EMU_PAGE_SIZE) more.style.display = 'none';
    });
  }
}

/* ================= ⑤ 两个配置面板（抽屉内） =================
 * 卡片本体点击 → 打开配置面板（而非游戏详情）。
 * 面板复用全局 #drawer / #drawerBody / lockBody / closeDetail，
 * 通过 drawerMode='bh' | 'pc' 让 closeDetail 知道「关掉即回页面」。
 */
function panelShell(title, sub, body) {
  return `<div class="cf-head">
      ${closeBtnHtml()}
      <h3>${esc(title)}</h3>
      <div class="cf-sub">${sub}</div>
    </div>
    <div class="cf-body">${body}</div>`;
}

/* ---- 社区配置面板（BannerHub）：机型 / GPU / 日期 / 配置直链 ----
 *  ★ v10.13：新增「逐条游玩参数」区（驱动 / DXVK / 容器 / 翻译层 / 分辨率…）。
 *    原先面板只有一张 [机型 | GPU | 日期 | 下载 JSON] 表 —— 用户要抄的**参数**全在
 *    那份 JSON 里，必须点下载才知道内容。现在服务端解析后直接铺出来，
 *    完整清单（最多 200 条文件名）仍保留在下面，供精确下载。
 */
async function openBhPanel(k, p) {
  if (!k) return;
  drawerMode = 'bh';
  $('#drawer').classList.add('show'); $('#mask').classList.add('show');
  lockBody();
  $('#drawerBody').innerHTML = panelShell(p || k, '正在读取社区配置…', '<div class="cf-loading">加载中…</div>');
  try {
    const [cj, pj] = await Promise.all([
      fetch(api('/api/bh/configs?k=' + encodeURIComponent(k))).then((r) => r.json()),
      fetch(api('/api/bh/params?k=' + encodeURIComponent(k) + '&limit=6')).then((r) => r.json()).catch(() => null),
    ]);
    const j = cj;
    if (!j.ok) throw new Error(j.error || '读取失败');
    const g = j.game || {};
    const items = j.items || [];
    const gpus = [...new Set(items.map((x) => x.gpu).filter(Boolean))];
    const phones = [...new Set(items.map((x) => x.phone).filter(Boolean))];
    const params = (pj && pj.items) || [];
    const rows = items.map((x) => `<tr>
        <td>${esc(x.phone || '—')}</td>
        <td><span class="tg">${esc(x.gpu || '—')}</span></td>
        <td>${esc(x.date || '—')}</td>
        <td><a class="cf-dl" href="${esc(x.url)}" target="_blank" rel="noopener">下载 JSON</a></td>
      </tr>`).join('');
    const paramHtml = params.length
      ? `<div class="cf-sec-t">逐条游玩参数<span class="n">最近 ${params.length} 份</span></div>
         <div class="cf-params">${params.map(cfParamCard).join('')}</div>`
      : `<div class="cf-note">这款暂无可解析的逐条参数（配置文件尚未收录或读取失败），可按下表下载原始 JSON 查看。</div>`;
    $('#drawerBody').innerHTML = panelShell(p || k, '', `
      <div class="cf-stats">
        <div class="st"><b>${items.length}</b><span>份配置</span></div>
        <div class="st"><b>${gpus.length}</b><span>种 GPU</span></div>
        <div class="st"><b>${phones.length}</b><span>款机型</span></div>
      </div>
      <div class="cf-note">数据来自 <b>BannerHub</b> 社区共享仓库（GitHub）。配置为玩家手动导出，
        跑通与否取决于机型与驱动版本；建议先看下面的逐条参数，挑与自己机型最接近的那份照搬。</div>
      ${paramHtml}
      <div class="cf-sec-t">全部配置清单<span class="n">${items.length} 条</span></div>
      <div class="cf-scroll"><table class="cf-table">
        <thead><tr><th>机型</th><th>GPU</th><th>上传日期</th><th>配置</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4">暂无逐条配置</td></tr>'}</tbody>
      </table></div>
      <div class="cf-foot"><a class="cf-btn" href="${esc(j.repo || '#')}" target="_blank" rel="noopener">在 GitHub 查看仓库 →</a></div>
    `);
  } catch (e) {
    $('#drawerBody').innerHTML = panelShell(p || k, '', '<div class="cf-empty">读取失败，请稍后重试</div>');
  }
}

/** 一条逐条参数 → 面板内的卡片（与详情抽屉里的芯片行同一份信息，版式更宽） */
function cfParamCard(p) {
  const chips = [];
  const add = (label, val, cls) => { if (val) chips.push(`<span class="kv ${cls || ''}"><b>${esc(label)}</b>${esc(String(val))}</span>`); };
  add('驱动', p.driver, 'hot');
  add('DXVK', p.dxvk, 'hot');
  add('VKD3D', p.vkd3d);
  add('容器', p.container);
  add('翻译层', p.translator, 'ok');
  add('分辨率', p.resolution);
  add('内存', p.maxMem);
  add('核心', p.cores);
  add('FEX', p.fexBuild);
  if (p.vibration) add('振动', '开');
  (p.translatorFlags || []).slice(0, 4).forEach((f) => add('', f));
  /* ★ v10.14：机型代号 → 芯片规格（与详情抽屉同源，都由 /api/bh/params 的 spec 提供） */
  const sp = p.spec;
  const specRow = (sp && (sp.soc || sp.gpu))
    ? `<div class="spec">
        ${sp.soc ? `<span class="sp soc"><b>${sp.approx ? '≈' : ''}${esc(sp.soc)}</b></span>` : ''}
        ${sp.brand ? `<span class="sp">${esc(sp.brand)}</span>` : ''}
        ${sp.cpu ? `<span class="sp cpu">${esc(sp.cpu)}</span>` : ''}
        ${sp.score ? `<span class="sp">性能分 <b>${esc(String(Math.round(sp.score)))}</b></span>` : ''}
      </div>`
    : '';
  return `<div class="cf-param">
    <div class="hd"><b>${esc(p.device || '未知机型')}</b><span class="gp">${esc(p.gpu || '')}</span>
      <span class="dt">${esc(p.date || '')}${p.ver ? ' · BH ' + esc(p.ver) : ''}</span>
      ${p.url ? `<a class="dl" href="${esc(p.url)}" target="_blank" rel="noopener">原始 JSON</a>` : ''}</div>
    ${specRow}
    <div class="kvs">${chips.join('') || '<span class="kv">该份配置未记录可解析参数</span>'}</div>
  </div>`;
}

/* ---- 实测配置面板（本项目自建）：逐条机型 / 兼容层 / 驱动 / 帧率 / 备注 ---- */
async function openPcPanel(title) {
  if (!title) return;
  drawerMode = 'pc';
  $('#drawer').classList.add('show'); $('#mask').classList.add('show');
  lockBody();
  $('#drawerBody').innerHTML = panelShell(title, '正在读取实测记录…', '<div class="cf-loading">加载中…</div>');
  try {
    const j = await fetch(api('/api/pc/records?k=' + encodeURIComponent(title))).then((r) => r.json());
    if (!j.ok) throw new Error(j.error || '读取失败');
    const cm = j.chipMap || {};
    const items = j.items || [];
    const lib = j.lib;
    const rows = items.map((x) => `<div class="cf-rec ${x.ok ? 'ok' : 'no'}">
        <div class="cf-rec-h">
          <span class="pill ${x.ok ? 'ok' : 't-bad'}">${x.ok ? '可玩' : '不可玩'}</span>
          <b>${esc(cm[x.chip] || x.chipName || x.chip || '—')}</b>
          <span class="pill t-mid">${esc(x.fpsTier || '—')} ${esc(x.fpsLabel || '')}</span>
        </div>
        <div class="cf-kv">
          <div><i>兼容层</i><code>${esc(x.layer || '—')}</code></div>
          <div><i>运行模式</i><code>${esc(x.mode || '—')}</code></div>
          <div><i>驱动 GPU</i><code>${esc(x.gpu || '—')}</code></div>
          <div><i>DXVK</i><code>${esc(x.dxvk || '—')}</code></div>
          ${x.vkd3d ? `<div><i>vkd3d</i><code>${esc(x.vkd3d)}</code></div>` : ''}
          <div><i>运行库</i><code>${esc(x.runtime || '—')}</code></div>
          ${x.exe ? `<div><i>主程序</i><code>${esc(x.exe)}</code></div>` : ''}
        </div>
        ${x.note ? `<div class="cf-note-inline">💡 ${esc(x.note)}</div>` : ''}
      </div>`).join('');
    $('#drawerBody').innerHTML = panelShell(title, '', `
      ${lib ? `<div class="cf-lib"><img src="${esc(lib.cover)}" alt="" referrerpolicy="no-referrer" loading="lazy">
        <div class="cf-lib-tx"><b>${esc(lib.title || '')}</b>
        <button class="cf-btn" onclick="closeDetail();openDetailById('${esc(lib.id)}','${esc(lib.title || '')}')" type="button">查看游戏详情</button></div></div>` : ''}
      <div class="cf-stats">
        <div class="st"><b>${items.length}</b><span>条实测</span></div>
        <div class="st"><b>${items.filter((x) => x.ok).length}</b><span>可玩</span></div>
        <div class="st"><b>${[...new Set(items.map((x) => x.chip))].length}</b><span>款机型</span></div>
      </div>
      <div class="cf-scroll">${rows || '<div class="cf-empty">暂无实测记录</div>'}</div>
    `);
  } catch (e) {
    $('#drawerBody').innerHTML = panelShell(title, '', '<div class="cf-empty">读取失败，请稍后重试</div>');
  }
}


/* ================= ⑤ 修改器（Game Cheats Manager 公开清单） =================
 *
 * 数据源：https://gamezonelabs.com/api/data/gcm （公开 GET，免密钥）
 *   → tools/fetch-trainers.js 采集 → data/trainers.json → /api/trainers/*
 *
 * ⚠️ 本节**刻意不做下载按钮**：GCM 官方下载走一次性 S3 签名 URL
 *    （download_base_thread.py 的 get_signed_download_url()，依赖仓库外的
 *     secret_config 提供 SIGNED_URL_DOWNLOAD_ENDPOINT + CLIENT_API_KEY），
 *    签名 URL 用完即废，我们既无法离线复现、也不应绕过。
 *    所以卡片给的是「**获取方式**」——把用户导向官方渠道。
 *
 * ★ 关于「放置位置」（用户本轮特别问的）：
 *    修改器与存档不同 —— 它是**独立 exe，不需要放进游戏目录**。
 *    直接运行即可，它会自己挂上游戏进程。页面把这条讲清楚，
 *    避免用户照搬「存档要放对目录」的思路去找位置。
 */
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
      limit: EMU_PAGE_SIZE, offset: trState.offset,
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
  const src = document.getElementById('trSource');
  if (src && !src.dataset.bound) { src.dataset.bound = '1'; src.addEventListener('change', () => { trState.source = src.value; loadTr(false); }); }
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
  const libTog = document.getElementById('trToggleLib');
  if (libTog) {
    const paint = () => {
      libTog.classList.toggle('on', trState.matched);
      libTog.classList.toggle('on', trState.matched);
    };
    paint();
    if (!libTog.dataset.bound) {
      libTog.dataset.bound = '1';
      libTog.addEventListener('click', () => { trState.matched = !trState.matched; paint(); loadTr(false); });
    }
  }
  await loadTr(false);
}


/* ================= ⑥ 云存档（存档位置库 · Ludusavi 开源清单） =================
 *
 * 数据源：https://github.com/mtkennerly/ludusavi-manifest（MIT）
 *   → tools/build-saves.js 流式过滤 → data/saves.json → /api/saves/*
 *
 * ★ 这一节的核心产出就是**存档路径本身**（用户要的「放置位置」）。
 *   所以卡片不做折叠 —— 直接把路径铺在卡面上，
 *   等宽字体、允许换行、**不截断**（截断了用户就没法照着找文件）。
 *
 * ★ 默认口径与页签数字一致：**仅看手机能玩**（在手游中心内），
 *   因为这是「手机专区」语境；关掉开关或传 stats=all 才看全量 5,741 款。
 */
const svState = { q: '', sort: 'paths', phone: true, cloud: false, offset: 0, total: 0, items: [], inited: false, loading: false };

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

  /* 中文标题优先；清单原名作别名行 */
  const altHtml = (it.name && it.name !== title) ? '<div class="alt" title="' + esc(it.name) + '">' + esc(String(it.name).slice(0, 46)) + '</div>' : '';

  /* 路径行：最多铺 3 条文件路径 + 2 条注册表项，其余折叠成「另有 N 条」
   *   ★ v10.5：每行右侧带「复制」按钮 —— 路径是本分区的主产物，复制是最高频动作，
   *     不能再要求用户「先全选再 Ctrl+C」。 */
  const MAXP = 3, MAXR = 2;
  const rows = [];
  for (const p of paths.slice(0, MAXP)) {
    const tag = (p.tags && p.tags.length) ? String(p.tags[0]) : '存档';
    const label = tag === 'save' ? '存档' : (tag === 'config' ? '配置' : tag);
    const full = p.shown || p.raw;
    rows.push('<div class="p"><i>' + esc(label) + '</i><span>' + esc(full) + '</span>'
      + '<button class="cp" type="button" data-cp="' + esc(full) + '" title="复制这条路径">复制</button></div>');
  }
  for (const r of regs.slice(0, MAXR)) {
    rows.push('<div class="p reg"><i>注册表</i><span>' + esc(r.raw) + '</span>'
      + '<button class="cp" type="button" data-cp="' + esc(r.raw) + '" title="复制这条注册表项">复制</button></div>');
  }
  const hidden = (paths.length - Math.min(paths.length, MAXP)) + (regs.length - Math.min(regs.length, MAXR));
  const moreLine = hidden > 0 ? '<div class="more">另有 ' + hidden + ' 条存档位置未展示，进游戏详情查看</div>' : '';

  const cloudTags = cloud.length
    ? cloud.map((c) => '<span class="tg cloud">☁ ' + esc(String(c).toUpperCase()) + '</span>').join('')
    : '<span class="tg dim">不支持云同步</span>';

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
    + '<div class="paths">' + (rows.join('') || '<div class="p"><span>暂无文件路径记录</span></div>') + moreLine + '</div>'
    + '</div>'
    + '</article>';
}

/** 复制文本：优先 Clipboard API，失败退回隐藏 textarea + execCommand
 *  （http 非 localhost / 老内核下 Clipboard API 不可用，别让「复制」按钮点了没反应） */
function copyText(txt) {
  const s = String(txt || '');
  if (!s) return;
  const fallback = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = s;
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch (e) { return false; }
  };
  const done = () => { if (typeof toast === 'function') toast('已复制：' + (s.length > 42 ? s.slice(0, 42) + '…' : s)); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(s).then(done).catch(() => { if (fallback()) done(); });
  } else if (fallback()) done();
}

function bindSvCards() {
  const g = document.getElementById('svGrid'); if (!g || g.dataset.bound) return;
  g.dataset.bound = '1';
  /* ★ v10.5 点击分流修正：
   *   上一版为了「路径文字防误触」把整卡点击整个吞掉（只留封面上的按钮可点），
   *   用户点卡片正文毫无反应 —— 反馈为「云存档点击未跳转」。
   *   现在按区域分工：
   *     · 点 .cp        → 只复制这条路径（不跳转）
   *     · 点 .paths 区  → 允许选中/复制，不跳转
   *     · 点卡上其它地方 → 有端游库命中就进游戏详情
   *   这样「抄路径」和「看详情」两个诉求都保住，不再互相牺牲。 */
  g.addEventListener('click', (e) => {
    const cp = e.target.closest('.cp');
    if (cp) { e.stopPropagation(); copyText(cp.dataset.cp || ''); return; }
    const card = e.target.closest('.emu-card'); if (!card) return;
    if (e.target.closest('.paths')) return;   // 路径区不触发跳转（要能选中文字）
    const btn = e.target.closest('.cov-btn');
    const lib = (btn && btn.dataset.lib) || card.dataset.lib;
    if (lib && typeof openDetailById === 'function') {
      openDetailById(lib, (btn && btn.dataset.title) || card.dataset.name);
      return;
    }
    if (typeof toast === 'function') toast('这条没对上端游库，没有详情页；存档路径可直接点「复制」');
  });
}

async function loadSv(more) {
  if (svState.loading) return;
  svState.loading = true;
  const grid = document.getElementById('svGrid');
  if (!more) { svState.offset = 0; if (grid) grid.innerHTML = '<div class="emu-loading">正在拉取存档位置库…</div>'; }
  try {
    const qs = new URLSearchParams({
      q: svState.q, sort: svState.sort, limit: EMU_PAGE_SIZE, offset: svState.offset,
    });
    /* ★ 开关语义：phone 关掉 = 放开到全量（stats=all） */
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
        ['手机能玩', s.phonePlayable], ['收录游戏', s.total], ['存档位置', s.pathCount], ['支持云同步', s.withCloud],
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
