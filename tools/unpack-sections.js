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

  const st = { data: null, idx: 0, q: '', sort: 'scale', only: '', raw: '', busy: false };

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

  const VERDICT = {
    smooth: { t: '流畅', c: 'sm' },
    ok: { t: '可跑', c: 'ok' },
    maybe: { t: '待确认', c: 'mb' },
    unknown: { t: '信息不足', c: 'un' },
    no: { t: '不可跑', c: 'no' },
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
        '<div class="up-ms"><b>' + s.scanned + '</b><span>扫描游戏数</span></div>' +
        '<div class="up-dist">' + dist + '</div>' +
      '</div>' +
      '<div class="up-mbar">' +
        '<input class="up-search" id="upq" type="search" placeholder="在可跑清单里搜游戏名…" value="' + esc(st.q) + '" autocomplete="off">' +
        '<div class="up-sorts" id="upSorts">' +
          btn('scale', '规模优先', st.sort) + btn('margin', '余量优先', st.sort) + btn('name', '名称', st.sort) +
        '</div>' +
        '<button type="button" class="up-only' + (st.only === 'playable' ? ' on' : '') + '" id="upOnly">只看可跑</button>' +
      '</div>' +
      '<div class="up-list" id="upList">' + (m.items.length ? m.items.map(card).join('') : '<div class="up-empty">没有匹配到游戏（试试放宽搜索词）</div>') + '</div>' +
      '<div class="up-foot">判定依据：' + esc(s.source) + ' · 只看「架构 / 图形接口 / 内存 / 存储」四项，<b>不含显卡跑分</b></div>';
  }

  function btn(key, label, cur) {
    return '<button type="button" class="up-sort' + (cur === key ? ' on' : '') + '" data-s="' + key + '">' + label + '</button>';
  }

  function card(it) {
    const v = VERDICT[it.verdict] || VERDICT.unknown;
    const chips = it.dims.filter((d) => d.state !== 'skip' && DIM_STATE[d.state]).map((d) =>
      '<span class="up-ch ' + d.state + '" title="' + esc(d.note) + '">' + DIM_NAME[d.dim] + ' ' + DIM_STATE[d.state] + '</span>').join('');
    const uj = (it.unjudged || []).length
      ? '<span class="up-ch uj" title="配置里没有这项，无法判定">未判定：' + it.unjudged.map((d) => DIM_NAME[d] || d).join('、') + '</span>' : '';
    const min = [];
    if (it.min.ram) min.push('内存 ' + it.min.ram);
    if (it.min.storage) min.push(it.min.storage.replace(/^需要\s*/, '空间 '));
    if (it.min.dx) min.push('DX ' + it.min.dx);
    if (it.min.gpu) min.push(it.min.gpu);
    return '<article class="up-card ' + v.c + '" data-verdict="' + it.verdict + '" data-name="' + esc(it.name) + '">' +
      '<div class="up-card-h"><span class="up-badge ' + v.c + '">' + v.t + '</span><b>' + esc(it.name) + '</b>' +
        (it.margin != null ? '<span class="up-mg">余量 ' + it.margin + ' GB</span>' : '') + '</div>' +
      '<div class="up-chips">' + chips + uj + '</div>' +
      '<div class="up-min">最低配置：' + esc(min.join(' · ') || '未标注') + '</div>' +
      (it.dims.some((d) => d.state === 'fail') ? '<div class="up-why">' + esc(it.dims.filter((d) => d.state === 'fail').map((d) => d.note).join('；')) + '</div>' : '') +
      '</article>';
  }

  /* ---------- 判定依据（凭什么这么判） ---------- */
  async function initDict() {
    try {
      const d = await fetch(api('/api/spec/dict')).then((r) => r.json());
      if (!d.ok) return;
      $('upDict').innerHTML =
        '<div class="up-dict">' +
        '<div class="up-dict-h">凭什么这么判</div>' +
        '<div class="up-dims">' + d.dims.map((x) =>
          '<div class="up-dim"><b>' + esc(x.label) + '</b><span>' + esc(x.why) + '</span></div>').join('') + '</div>' +
        '<div class="up-dict-n">兼容层 → 图形接口能力：' + d.layers.map((l) => esc(l.note)).join('；') + '。<br>' +
        '能在 ARM 上执行 x86 指令的转译层：' + d.translators.map(esc).join(' / ') + '。<br>' +
        '对照库：Steam 官方配置要求 <b>' + d.built + '</b> 款。</div>' +
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
