/* ================= 📦 解包配置匹配 · 页面逻辑（独立页专属） =================
 *
 * 这个页面回答一个问题：**「我手上这份配置，能跑哪些游戏？」**
 * 输入是用户从游戏包 / 兼容层工具里导出的一份 JSON（字段名事先未知），
 * 输出是可适配游戏清单，且每个判定都摊开理由。
 *
 * 分工：
 *   识别（字段名 → 语义）在 data/spec-dict.js
 *   判定（配置 → 能不能跑）在 data/spec-match.js
 *   本文件只管「拿数据、画出来、响应交互」。
 *
 * ★ 样本字段变了**不要改这里** —— 去扩 data/spec-dict.js 的词典。
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const st = { data: null, idx: 0, q: '', sort: 'hot', only: '', raw: '', busy: false };

  /* 示例：刻意写成「设备配置 + 最低要求」混在一起，
     用来演示两层语义被正确分开（内存 16 GB 是设备，8 GB 是要求）。 */
  const SAMPLE = JSON.stringify({
    device: 'OnePlus 13 (SM8750)',
    os: 'Android 15',
    arch: 'arm64-v8a',
    memory: '16 GB',
    storage_free: '256 GB',
    compatibility: { wine: '9.0', box64: '0.3.4', dxvk: '2.4', turnip: '24.1' },
    minRequirements: { ram: '8 GB', storage: '40 GB', dx: '11' },
  }, null, 2);

  /* `c`  = 旧的 `.up-badge.*` 类名（统计条图例还在用，保留）
   * `pill` = 手机专区同款 `.pill.fps.*`（绿/蓝/黄/红 = 实测帧率那套配色），卡片正文改用它。
   *   ★ 不要为「解包档位」另起第五种配色 —— 同一语义两套视觉必然漂移。 */
  const VERDICT = {
    smooth: { t: '流畅', c: 'sm', pill: 'fps smooth' },
    ok: { t: '可跑', c: 'ok', pill: 'fps ok' },
    maybe: { t: '待确认', c: 'mb', pill: 'fps low' },
    unknown: { t: '信息不足', c: 'un', pill: '' },
    no: { t: '不可跑', c: 'no', pill: 'fps bad' },
  };
  const DIM_NAME = { arch: '架构', dx: '图形接口', ram: '内存', storage: '存储' };
  const DIM_STATE = { ok: '通过', fail: '不满足', unknown: '未判定', skip: '' };
  const GROUP_ICON = { gpu: '🎮', cpu: '🧠', ram: '📐', vram: '🧩', storage: '💽', os: '🪟', api: '🔌', layer: '🧪', driver: '⚙️', arch: '🏗', res: '🖼', ver: '🏷', other: '•' };

  function msg(text, kind) {
    const el = $('upMsg');
    if (!el) return;
    if (!text) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.className = 'up-msg' + (kind ? ' ' + kind : '');
    el.textContent = text;
  }

  /* ---------- 请求 ---------- */
  async function run() {
    const raw = ($('upInput').value || '').trim();
    if (!raw) { msg('先把 JSON 贴进来（或点「选择文件」/「载入示例」）', 'warn'); return; }
    if (st.busy) return;
    st.busy = true;
    $('upRun').disabled = true;
    msg('正在解析并匹配…');
    try {
      const r = await fetch(api('/api/spec/analyze'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: raw, idx: st.idx, q: st.q, sort: st.sort, only: st.only, limit: 80 }),
      });
      const j = await r.json();
      if (!j.ok) { msg(j.error || '解析失败', 'err'); $('upResult').hidden = true; return; }
      st.raw = raw;
      st.data = j;
      if (st.idx >= j.records.length) st.idx = 0;
      msg('');
      render(j);
    } catch (e) {
      msg('请求失败：' + (e && e.message), 'err');
    } finally {
      st.busy = false;
      $('upRun').disabled = false;
    }
  }

  /* ---------- 渲染 ---------- */
  function render(j) {
    $('upResult').hidden = false;
    renderHead(j);
    renderRecs(j);
    renderProfile(j.current.profile);
    renderGroups(j.current.entries);
    renderUnknown(j.current.unknown, j.current.truncated);
    renderMatch(j.match);
    window.__UP_DONE__ = true;   // 实拍脚本的就绪信号
  }

  function renderHead(j) {
    const s = j.stats || {};
    const cov = s.coverage == null ? 0 : s.coverage;
    $('upCoverage').innerHTML =
      '<span class="up-cov-n">' + cov + '%</span>' +
      '<span class="up-cov-t">字段识别率 <b>' + (s.hit || 0) + '/' + (s.nodes || 0) + '</b></span>';
    $('upShape').textContent = j.shape === 'array' ? '顶层是数组（' + (j.records ? j.records.length : 0) + ' 条记录）'
      : j.shape === 'object' ? '顶层是对象（单条记录）' : '顶层是标量';
  }

  function renderRecs(j) {
    const box = $('upRecs');
    if (!j.records || j.records.length <= 1) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = '<div class="up-recs-t">检测到 ' + j.records.length + ' 条记录 —— 当前对第 <b>' + (j.idx + 1) + '</b> 条做匹配</div>' +
      '<div class="up-recs-l">' + j.records.slice(0, 60).map((r) =>
        '<button type="button" class="up-rec' + (r.idx === j.idx ? ' on' : '') + '" data-i="' + r.idx + '">' +
        '<b>' + esc(r.name) + '</b><span>' + r.entries + ' 项' + (r.ram ? ' · ' + r.ram + 'GB' : '') + '</span></button>'
      ).join('') + '</div>';
  }

  /** 配置画像：把「这份配置到底是什么」摊开 —— 这是用户最需要确认的一屏 */
  function renderProfile(p) {
    const cells = [];
    const cell = (label, val, note, tone) =>
      cells.push('<div class="up-cell' + (tone ? ' ' + tone : '') + '">' +
        '<span class="lb">' + label + '</span>' +
        '<b>' + (val == null || val === '' ? '<i class="none">未识别</i>' : esc(val)) + '</b>' +
        (note ? '<span class="nt">' + esc(note) + '</span>' : '') + '</div>');

    if (p.gpu) {
      const sc = p.gpu.score;
      const tone = sc && sc.fam !== 'other' ? 'hi' : 'lo';
      cell('显卡 / GPU', p.gpu.raw,
        sc && sc.fam !== 'other' ? '档位 ' + sc.score + '（' + sc.fam + '）' : '未能定档（非移动 GPU 型号）', tone);
    } else cell('显卡 / GPU', null);

    cell('处理器', p.cpu && p.cpu.raw, p.cpu && p.cpu.tier === 'min' ? '取自最低要求' : '');
    /* 自身配置时不重复显示原值（值本身就是它数值化后的样子）；
       只有「取自最低要求」才需要提示，否则用户会误以为是设备能力。 */
    cell('内存', p.ram ? p.ram.gb + ' GB' : null, p.ram && p.ram.src === 'req' ? '取自最低要求' : '');
    cell('存储', p.storage ? p.storage.gb + ' GB' : null, p.storage && p.storage.src === 'req' ? '取自最低要求' : '');
    cell('系统', p.os && p.os.raw);
    cell('指令集架构', p.arch && p.arch.raw);
    cell('分辨率', p.res && p.res.raw);
    cell('驱动', p.driver && p.driver.raw);

    const layers = Object.keys(p.layer || {});
    cell('兼容层', layers.length ? layers.join(' · ') : null,
      layers.length ? layers.map((k) => k + (p.layer[k].raw ? ' ' + p.layer[k].raw : '')).join('，') : '没识别到 DXVK / Box64 / Wine 之类');

    /* 图形接口：JSON 里常只写「要求 DX 几」（那是要求不是能力），
       此时按兼容层推一份能力出来并注明来源 —— 否则这里只剩一个「未识别」，
       而判定其实是有依据的（DXVK→11 / VKD3D→12）。 */
    const apis = (p.api || []).map((a) => a.kind === 'dx' ? 'DX' + a.v : a.kind);
    let apiVal = apis.length ? apis.join(' · ') : (p.apiRaw && p.apiRaw.length ? p.apiRaw.join(' · ') : null);
    let apiNote = '';
    if (!apis.length) {
      const caps = [];
      if (p.layer && p.layer.vkd3d) caps.push(12);
      if (p.layer && (p.layer.dxvk || p.layer.wined3d)) caps.push(11);
      if (caps.length) { apiVal = 'DX ≤ ' + Math.max.apply(null, caps); apiNote = '据兼容层推断'; }
    }
    cell('图形接口', apiVal, apiNote);

    if (p.req && (p.req.ram || p.req.storage || p.req.dx)) {
      const bits = [];
      if (p.req.ram) bits.push(p.req.ram + ' GB 内存');
      if (p.req.storage) bits.push(p.req.storage + ' GB 空间');
      if (p.req.dx) bits.push('DX ' + p.req.dx);
      cell('这份 JSON 的「最低要求」', bits.join(' / '), '只作参考，不参与「自身能力」判定', 'req');
    }

    const srcNote = p.src === 'req' ? '⚠️ 这份 JSON 只有「最低要求」，没有独立的环境配置 —— 匹配结果可信度有限'
      : p.src === 'mixed' ? '⚠️ 部分字段取自「最低要求」：' + (p.borrowed || []).join('、')
      : '';
    $('upProfile').innerHTML =
      '<div class="up-prof-h"><b>' + esc(p.name || '未命名记录') + '</b>' +
        '<span>' + cells.length + ' 项已识别</span></div>' +
      (srcNote ? '<div class="up-note warn">' + esc(srcNote) + '</div>' : '') +
      '<div class="up-cells">' + cells.join('') + '</div>';
  }

  function renderGroups(entries) {
    const by = {};
    for (const e of entries) (by[e.group] = by[e.group] || []).push(e);
    const order = ['gpu', 'cpu', 'ram', 'vram', 'storage', 'os', 'arch', 'api', 'layer', 'driver', 'res', 'ver', 'other'];
    const keys = Object.keys(by).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    if (!keys.length) { $('upGroups').innerHTML = '<div class="up-empty">没有识别到任何配置字段</div>'; return; }
    $('upGroups').innerHTML = keys.map((g) =>
      '<div class="up-grp"><div class="hd"><span>' + (GROUP_ICON[g] || '•') + '</span><b>' + groupLabel(g) + '</b><i>' + by[g].length + '</i></div>' +
      '<div class="bd">' + by[g].map((e) =>
        '<div class="it"><code>' + esc(e.key || e.path) + '</code>' +
        '<span class="vv">' + esc(typeof e.value === 'object' ? JSON.stringify(e.value) : e.value) + '</span>' +
        (e.tier === 'min' ? '<em class="tg min">最低</em>' : e.tier === 'rec' ? '<em class="tg rec">推荐</em>' : '') +
        (e.from === 'value' ? '<em class="tg low" title="键名不认识，是按值的形态猜的">推断</em>' : '') +
        '</div>').join('') + '</div></div>'
    ).join('');
  }

  function groupLabel(g) {
    return ({
      gpu: '显卡 / GPU', cpu: '处理器', ram: '内存', vram: '显存', storage: '存储空间', os: '操作系统',
      api: '图形接口', layer: '兼容层', driver: '驱动', arch: '指令集架构', res: '分辨率', ver: '版本', other: '其他',
    })[g] || g;
  }

  function renderUnknown(unknown, trunc) {
    const box = $('upUnknown');
    if (!unknown || !unknown.length) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = '<details class="up-unk"><summary>未识别的字段 <b>' + unknown.length + '</b> 项' +
      (trunc && trunc.unknown ? '（已截断）' : '') + ' —— 这些不影响已有判定</summary>' +
      '<div class="up-unk-l">' + unknown.map((u) =>
        '<div class="it"><code>' + esc(u.path) + '</code><span>' + esc(String(u.value).slice(0, 120)) + '</span></div>'
      ).join('') + '</div></details>';
  }

  function renderMatch(m) {
    const box = $('upMatch');
    if (!m || !m.ok) { box.innerHTML = '<div class="up-empty">匹配失败：' + esc((m && m.error) || '未知错误') + '</div>'; return; }
    const s = m.stats;
    const dist = Object.keys(s.distLabel).map((k) =>
      '<span class="up-d"><i class="dot ' + (Object.values(VERDICT).find((v) => v.t === k) || {}).c + '"></i>' + k + ' <b>' + s.distLabel[k] + '</b></span>').join('');
    box.innerHTML =
      '<div class="up-mstats">' +
        '<div class="up-ms"><b>' + s.playable + '</b><span>可跑 / 共 ' + s.total + ' 款</span></div>' +
        '<div class="up-ms"><b>' + s.scanned + '</b><span>有配置要求的游戏</span></div>' +
        '<div class="up-ms"><b>' + (s.hot || 0) + '</b><span>其中带热度数据</span></div>' +
        '<div class="up-dist">' + dist + '</div>' +
      '</div>' +
      '<div class="up-mbar">' +
        '<input class="up-search" id="upq" type="search" placeholder="在可跑清单里搜游戏名…" value="' + esc(st.q) + '" autocomplete="off">' +
        '<div class="up-sorts" id="upSorts">' +
          btn('hot', '🔥 热门优先', st.sort) + btn('scale', '规模优先', st.sort) +
          btn('margin', '余量优先', st.sort) + btn('name', '名称', st.sort) +
        '</div>' +
        '<button type="button" class="up-only' + (st.only === 'playable' ? ' on' : '') + '" id="upOnly">只看可跑</button>' +
      '</div>' +
      '<div class="emu-grid up-list" id="upList">' + (m.items.length ? m.items.map(card).join('') : '<div class="up-empty">没有匹配到游戏（试试放宽搜索词）</div>') + '</div>' +
      '<div class="up-foot">判定依据：' + esc(s.source) + ' · 只用「架构 / 图形接口 / 内存 / 存储」四项，<b>不含显卡跑分</b>' +
      '（配置要求里的显卡是 PC 卡自由文本，和本机 GPU 不是同一量纲，比出来是假精度）<br>' +
      '热度 = 机地话题浏览量（dpv）· 封面 / 评分 / 容量均为源站真实字段，<b>未做任何推断</b></div>';
  }

  function btn(key, label, cur) {
    return '<button type="button" class="up-sort' + (cur === key ? ' on' : '') + '" data-s="' + key + '">' + label + '</button>';
  }

  /** 热度：机地浏览量。过万折成「12.3万」，避免长数字把卡片撑破 */
  function fmtHot(n) {
    const v = Number(n) || 0;
    if (!v) return null;
    if (v >= 10000) return (Math.round(v / 1000) / 10) + ' 万';
    if (v >= 1000) return (Math.round(v / 100) / 10) + 'k';
    return String(v);
  }

  /**
   * 结果卡片 —— **沿用手机专区的 .emu-card 版式**（用户口径：
   * 「解包匹配的游戏能够跟手机专区的前端展示效果一样」）。
   * ★ 直接复用主源已有的 .emu-card / .emu-grid 类，不另起一套样式：
   *   另写一套必然与手机专区漂移（本项目在「同一语义只留一份」上踩过多次）。
   * ★ 数据全部来自 spec-req.json（机地 17,220 话题 ∪ Steam 官方，按 Steam appid 精确合并）：
   *   封面 / 分类 / 容量 / 评分 / 热度都是源站字段，不是推断出来的。
   */
  /**
   * 结果卡片 —— **沿用手机专区的 .emu-card 版式**（用户口径，v10.22 首次提出、v10.24 对齐到位：
   * 「解包匹配的游戏能够跟手机专区的前端展示效果一样」）。
   *
   * ★ 结构必须与手机专区**逐块同构**，否则就是「同一语义两套渲染」：
   *     .cov  → 封面 92px（有图才有，无图 `.cov.noimg` 收起）
   *     .bd > h4（游戏名） + .alt（别名） + .meta > .pill（档位/热度/评分）+ .tgs > .tg（分类/容量/来源）
   *   v10.22 只借了 `.emu-card` **类名**，正文却另起了 `.top/.nm/.cnt + .up-mc-row + …`
   *   六个自定义区块 ⇒ 卡片 352px 高（手机专区 232px），一眼就不是同一套东西。
   *
   * 保留下来的是解包专区的**独有信息**（删了就等于砍功能）：
   *     `.up-chips` 四维判定 · `.up-min` 最低要求 · `.up-why` 不通过原因 · `.up-mc-btns` 下载/详情
   *   它们的量级都压到与机型兼容那张卡的 `.dm-need` 一行同级（11px 轻量补充行）。
   *
   * 档位配色**复用已有的 `.pill.fps.*`**（绿/蓝/黄/红 = 手机专区实测帧率那套），
   * 不另起 `.up-badge` 第五种配色语言。
   */
  function card(it) {
    const v = VERDICT[it.verdict] || VERDICT.unknown;
    const chips = it.dims.filter((d) => d.state !== 'skip' && DIM_STATE[d.state]).map((d) =>
      '<span class="up-ch ' + d.state + '" title="' + esc(d.note) + '">' + DIM_NAME[d.dim] + ' ' + DIM_STATE[d.state] + '</span>').join('');
    const uj = (it.unjudged || []).length
      ? '<span class="up-ch uj" title="配置里没有这项，无法判定">未判定：' + it.unjudged.map((d) => DIM_NAME[d] || d).join('、') + '</span>' : '';
    const min = [];
    if (it.min.ram) min.push('内存 ' + it.min.ram);
    if (it.min.storage) min.push('空间 ' + it.min.storage);
    if (it.min.dx) min.push('DX ' + it.min.dx);
    if (it.min.gpu) min.push(it.min.gpu);

    /* ★ 要求来源如实标注：机地 / Steam 官方 / 两者都有。用户口径「不要推断」——
       这三个标签就是「这条要求是从哪读到的」，不是猜的。 */
    const fromMap = { jidi: '机地', steam: 'Steam 官方', 'jidi+steam': '机地 · Steam' };
    const from = fromMap[it.reqFrom] || null;

    /* 正文徽标行：档位（复用手机专区的 .pill.fps 配色）+ 热度 + 评分 */
    const hot = fmtHot(it.hot);
    const pills = '<span class="pill ' + v.pill + '">' + v.t + '</span>'
      + (hot ? '<span class="pill hot">' + esc(hot) + ' 热度</span>' : '')
      + (it.score ? '<span class="pill">★ ' + esc(String(it.score)) + '</span>' : '');

    /* 标签行：分类 / 容量 / 要求来源 —— 与手机专区的 `.tgs > .tg` 同一套 */
    const tags = [];
    (it.genres || []).slice(0, 3).forEach((g) => tags.push('<span class="tg">' + esc(g) + '</span>'));
    if (it.size) tags.push('<span class="tg">' + esc(it.size) + '</span>');
    if (from) tags.push('<span class="tg src">要求来自 ' + esc(from) + '</span>');

    const dl = it.libUrl
      ? '<button class="cov-btn" type="button" data-dl-open data-dl-title="' + esc(it.name) +
        '" data-dl-url="' + esc(it.libUrl) + '">⬇ 网盘下载</button>'
      : (it.jidiTid
        ? '<button class="cov-btn" type="button" data-dl-open data-dl-title="' + esc(it.name) +
          '" data-dl-url="' + esc('https://jidiyouxi.com/topic/detail/' + it.jidiTid) + '">⬇ 网盘下载</button>'
        : '');

    return '<article class="emu-card' + (it.cover ? ' has-cov' : '') + ' up-mc" data-verdict="' + it.verdict + '" data-name="' + esc(it.name) + '">' +
      (it.cover
        ? '<div class="cov"><img src="' + esc(it.cover) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="covErr(this,\'' + esc(covAbbr(it.name)) + '\')"></div>'
        : '<div class="cov ph"><span>' + esc(covAbbr(it.name)) + '</span></div>') +
      /* ★ v10.24：正文换成手机专区同款骨架 `.bd > h4 + .alt + .meta + .tgs` */
      '<div class="bd">' +
        '<h4 title="' + esc(it.name) + '">' + esc(it.name) + '</h4>' +
        (it.nameEn && it.nameEn !== it.name
          ? '<div class="alt" title="' + esc(it.nameEn) + '">' + esc(it.nameEn) + '</div>' : '') +
        '<div class="meta">' + pills + '</div>' +
        '<div class="tgs">' + tags.join('') + '</div>' +
        '<div class="up-chips">' + chips + uj + '</div>' +
        '<div class="up-min">最低：' + esc(min.join(' · ') || '未标注') + '</div>' +
        (it.dims.some((d) => d.state === 'fail')
          ? '<div class="up-why">' + esc(it.dims.filter((d) => d.state === 'fail').map((d) => d.note).join('；')) + '</div>' : '') +
        '<div class="up-mc-btns">' + dl +
          (it.libUrl ? '<a class="up-mc-go" href="' + esc(it.libUrl) + '" target="_blank" rel="noopener">源站详情 ↗</a>' : '') +
        '</div>' +
      '</div>' +
      '</article>';
  }

  /* ---------- 判定依据（凭什么这么判） ---------- */
  async function initDict() {
    try {
      const d = await fetch(api('/api/spec/dict')).then((r) => r.json());
      if (!d.ok) return;
      /* ★ 对照库口径必须如实写：v10.22 起不再是「Steam 官方 653 款」，
         而是「机地话题 ∪ Steam 官方，按 Steam appid 精确合并」得到的 1.6 万款。
         这里直接读服务端回传的 stats，**不在前端写死数字**（写死了必然过期）。 */
      const s = d.stats || {};
      const by = s.bySource || {};
      const srcLine = (s.jidiCandidates || s.steamCandidates)
        ? '对照库：机地 <b>' + (s.jidiCandidates || 0).toLocaleString() + '</b> 条话题 + Steam 官方 <b>' +
          (s.steamCandidates || 0).toLocaleString() + '</b> 条，按 <b>Steam appid 精确合并</b>为 <b>' +
          d.built.toLocaleString() + '</b> 款（不再做名称模糊匹配）。<br>' +
          '要求来源分布：机地 <b>' + (by.jidi || 0).toLocaleString() + '</b> · Steam 官方 <b>' +
          (by.steam || 0).toLocaleString() + '</b> · 两源都有 <b>' + (by['jidi+steam'] || 0).toLocaleString() +
          '</b> 款 —— 卡片上的「要求来自」标签就是读的这里，不是猜的。'
        : '对照库：<b>' + d.built.toLocaleString() + '</b> 款。';
      $('upDict').innerHTML =
        '<div class="up-dict">' +
        '<div class="up-dict-h">凭什么这么判</div>' +
        '<div class="up-dims">' + d.dims.map((x) =>
          '<div class="up-dim"><b>' + esc(x.label) + '</b><span>' + esc(x.why) + '</span></div>').join('') + '</div>' +
        '<div class="up-dict-n">兼容层 → 图形接口能力：' + d.layers.map((l) => esc(l.note)).join('；') + '。<br>' +
        '能在 ARM 上执行 x86 指令的转译层：' + d.translators.map(esc).join(' / ') + '。<br>' +
        srcLine + '</div>' +
        '</div>';
    } catch (e) { /* 判定依据是锦上添花，拿不到不影响主流程 */ }
  }

  /* ---------- 交互绑定 ---------- */
  let qt = 0;
  function bind() {
    $('upRun').addEventListener('click', run);
    $('upSample').addEventListener('click', () => { $('upInput').value = SAMPLE; st.idx = 0; run(); });
    $('upClear').addEventListener('click', () => {
      $('upInput').value = ''; $('upResult').hidden = true; st.data = null; st.idx = 0; msg('');
    });
    $('upPick').addEventListener('click', () => $('upFile').click());
    $('upFile').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const fr = new FileReader();
      fr.onload = () => { $('upInput').value = String(fr.result || ''); st.idx = 0; run(); };
      fr.onerror = () => msg('读取文件失败', 'err');
      fr.readAsText(f);
    });

    /* 拖拽整份文件到文本框 */
    const ta = $('upInput');
    ['dragenter', 'dragover'].forEach((t) => ta.addEventListener(t, (e) => { e.preventDefault(); ta.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((t) => ta.addEventListener(t, (e) => { e.preventDefault(); ta.classList.remove('drag'); }));
    ta.addEventListener('drop', (e) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) { const fr = new FileReader(); fr.onload = () => { ta.value = String(fr.result || ''); st.idx = 0; run(); }; fr.readAsText(f); return; }
      const txt = e.dataTransfer && e.dataTransfer.getData('text');
      if (txt) { ta.value = txt; st.idx = 0; run(); }
    });

    /* 结果区事件委托（内容是动态重绘的） */
    const res = $('upResult');
    res.addEventListener('click', (e) => {
      const rec = e.target.closest('.up-rec');
      if (rec) { st.idx = Number(rec.dataset.i) || 0; run(); return; }
      const s = e.target.closest('.up-sort');
      if (s) { st.sort = s.dataset.s; run(); return; }
      if (e.target.closest('#upOnly')) { st.only = st.only === 'playable' ? '' : 'playable'; run(); }
    });
    res.addEventListener('input', (e) => {
      if (e.target.id !== 'upq') return;
      clearTimeout(qt);
      const v = e.target.value;
      qt = setTimeout(() => { st.q = v; run(); }, 320);
    });
  }

  let inited = false;
  window.initUp = function () {
    if (inited) return;
    inited = true;
    bind();
    initDict();
  };
})();
