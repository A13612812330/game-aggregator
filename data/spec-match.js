/**
 * spec-match.js — 「一份配置」对撞「游戏库要求」（v10.20 新增）
 *
 * 输入：spec-dict.extract() 产出的 profile（一份环境/设备配置）
 * 输出：可适配游戏清单，**每个判定都带可解释理由**（前端直接铺出来）。
 *
 * 为什么不用 GPU 分直接比：
 *   data/gpu-tier.js 的 gpuScore() 是**移动 GPU 量纲**（Adreno 280-840 / Mali 映射），
 *   而 Steam 配置要求里的显卡是 PC 卡自由文本（"NVidia 6600"、"GTX 1060"），
 *   落进去只会得到 fam:'other' → 固定 400 分，**比出来的是假精度**。
 *   所以这里只在「两边都是移动 GPU」时才比 GPU，否则 GPU 只作为展示信息。
 *
 * 真正稳的四个维度（都能从自由文本里可靠解析）：
 *   arch    指令集 —— ARM 设备跑 x86 游戏必须有转译层（box64/box86/fex），缺了**结构上就跑不起来**
 *   dx      图形接口 —— 兼容层能力决定 DX 上限（DXVK→11，VKD3D→12）
 *   ram     内存 —— "8 GB RAM" ↔ 本机内存
 *   storage 存储 —— "需要 30 GB 可用空间" ↔ 可用空间
 *
 * ★ 样本到手后若发现维度口径不对，改的只是本文件的 RULES 段。
 */
const fs = require('fs');
const path = require('path');
const { gpuScore } = require('./gpu-tier');
const { toGB, dxOf } = require('./spec-dict');

const REQ_FILE = path.join(__dirname, 'steam-req.json');

/* ── 兼容层 → 图形接口能力上限 ──
   DXVK 把 DX9/10/11 转成 Vulkan（不含 12）；VKD3D-Proton 才管 DX12。 */
const LAYER_DX = [
  { kw: ['vkd3d'], max: 12, note: 'VKD3D → 支持到 DX12' },
  { kw: ['dxvk'], max: 11, note: 'DXVK → 支持到 DX11' },
  { kw: ['wined3d'], max: 11, note: 'WineD3D → 支持到 DX11' },
];
/* ── 能在 ARM 上执行 x86 指令的转译层 ── */
const X86_TRANSLATORS = ['box64', 'box86', 'fex', 'fexcore', 'rosetta'];

let _cache = null;
let _mtime = 0;

/** 载入并**预解析**游戏要求库（带 mtime 失效，改文件不必重启） */
function index() {
  let st;
  try { st = fs.statSync(REQ_FILE); } catch (e) { return { map: {}, built: 0, error: 'steam-req.json 读取失败' }; }
  if (_cache && st.mtimeMs === _mtime) return _cache;

  let raw;
  try { raw = JSON.parse(fs.readFileSync(REQ_FILE, 'utf8')); } catch (e) {
    return { map: {}, built: 0, error: 'steam-req.json 解析失败：' + e.message };
  }
  const src = raw.map || {};
  const map = {};
  for (const [appid, v] of Object.entries(src)) {
    if (!v) continue;
    const min = parseSpec(v.min);
    const rec = parseSpec(v.rec);
    if (!min && !rec) continue;
    map[appid] = { appid, name: v.name || ('appid ' + appid), min, rec };
  }
  _mtime = st.mtimeMs;
  _cache = { map, built: Object.keys(map).length, at: raw.builtAt || null };
  return _cache;
}

/** 把一条 Steam 配置文本结构化：{ramGb, storageGb, dx, os, gpuRaw} */
function parseSpec(o) {
  if (!o || typeof o !== 'object') return null;
  const out = { raw: o };
  const ram = toGB(o.ram);
  if (ram) out.ramGb = ram.gb;
  const st = toGB(o.storage);
  if (st) out.storageGb = st.gb;
  const dx = dxOf(o.dx);
  if (dx != null) out.dx = dx;
  if (o.os) out.os = String(o.os).trim();
  if (o.gpu) { out.gpuRaw = String(o.gpu).trim(); out.gpuScore = gpuScore(o.gpu); }
  out.cpuRaw = o.cpu ? String(o.cpu).trim() : '';
  return out;
}

/* ---------- 单维度比较 ---------- */

/** 输入配置能支持的 DX 上限 */
function dxCap(profile) {
  const fromLayer = [];
  for (const k of Object.keys(profile.layer || {})) {
    for (const r of LAYER_DX) if (r.kw.some((w) => k.includes(w))) fromLayer.push({ max: r.max, note: r.note });
  }
  const apiDx = (profile.api || []).filter((a) => a.kind === 'dx' && a.v != null).map((a) => ({ max: a.v, note: '配置声明支持 DX' + a.v }));
  const all = fromLayer.concat(apiDx);
  if (!all.length) return null;
  return all.reduce((a, b) => (b.max > a.max ? b : a));
}

function cmpDx(profile, spec) {
  if (!spec || spec.dx == null) return { dim: 'dx', state: 'skip', note: '游戏未标注 DirectX 要求' };
  const cap = dxCap(profile);
  if (!cap) return { dim: 'dx', state: 'unknown', note: '配置里没有能推断 DirectX 能力的兼容层（如 DXVK / VKD3D）' };
  const ok = cap.max >= spec.dx;
  return {
    dim: 'dx', state: ok ? 'ok' : 'fail',
    req: 'DX ' + spec.dx, got: 'DX ≤ ' + cap.max,
    note: ok ? cap.note : '需要 DX ' + spec.dx + '，而 ' + cap.note.replace('→ 支持到 ', '上限只到 '),
  };
}

/* ── 只在 ARM 生态里存在的层（出现它们却没标架构 → 需要提示补全） ── */
const ARM_ONLY = ['turnip', 'adreno', 'adrenotools', 'gamemax'];

function cmpArch(profile, spec) {
  const a = profile.arch && String(profile.arch.raw || '').toLowerCase();
  if (!a) {
    /* ★ 架构没标时**默认跳过**，不降级。
       实测校准：最初记成 unknown，结果 650 款里 535 款被判「待确认」——
       而 PC 配置本来就不写指令集，等于让一个无关维度淹没整张清单。
       只有当出现「只在 ARM 上存在的东西」（如 Adreno 专用的 turnip 驱动）
       而架构又没标时，才提示需要补全 —— 那种情况确实可能结构上跑不起来。 */
    const armish = Object.keys(profile.layer || {}).find((k) => ARM_ONLY.some((w) => k.includes(w)));
    if (armish) {
      return { dim: 'arch', state: 'unknown', note: '出现 ' + armish + '（仅 ARM 生态），但没标指令集架构 —— 需补 arch 才能判断能否执行 x86 程序' };
    }
    return { dim: 'arch', state: 'skip', note: '配置未涉及指令集架构（按无关维度跳过）' };
  }
  const isArm = /arm|aarch64/.test(a);
  if (!isArm) {
    if (/x86|amd64|x64|i[3-6]86/.test(a)) return { dim: 'arch', state: 'ok', note: 'x86 架构可直接执行 Windows 程序' };
    return { dim: 'arch', state: 'unknown', note: '架构「' + a + '」无法判定' };
  }
  const tr = Object.keys(profile.layer || {}).find((k) => X86_TRANSLATORS.some((w) => k.includes(w)));
  if (tr) return { dim: 'arch', state: 'ok', note: 'ARM 架构，但有 ' + tr + ' 转译 x86 指令' };
  return { dim: 'arch', state: 'fail', note: 'ARM 架构且未发现 x86 转译层（box64 / box86 / FEX）——结构上无法执行 Windows 程序' };
}

/* ★ 评测口径（实测校准过一次）：
 *     req == null  → 'skip'    —— **游戏没标这项**，无从比较，一律不降级。
 *                                 早先记成 unknown，导致 46% 的游戏被稀释成「待确认」，
 *                                 清单看着很长其实没信息量。
 *     got == null  → 'unknown' —— 我方配置里没识别到这项，是真的缺信息。 */
function cmpNum(dim, got, req, unit) {
  if (req == null) return { dim, state: 'skip', note: '游戏未标注该项要求' };
  if (got == null) return { dim, state: 'unknown', note: '配置里未识别到该项' };
  const r = Math.round((got - req) * 100) / 100;
  return {
    dim, state: got >= req ? 'ok' : 'fail',
    req: req + unit, got: got + unit, margin: r,
    note: got >= req ? '余量 ' + r + unit : '差 ' + Math.abs(r) + unit,
  };
}

/* 决定「能不能跑」的关键维度。这两个没判定出来，结论只能是「待确认」；
   而 dx / storage 属于次要维度 —— 没判定出来不该推翻结论，只需如实标注「未判定」。 */
const KEY_DIMS = ['arch', 'ram'];

/** 综合四个维度 → 单款游戏的判定 */
function judge(profile, spec) {
  const dims = [
    cmpArch(profile, spec),
    cmpDx(profile, spec),
    cmpNum('ram', profile.ram && profile.ram.gb, spec.ramGb, ' GB'),
    cmpNum('storage', profile.storage && profile.storage.gb, spec.storageGb, ' GB'),
  ];
  const fails = dims.filter((d) => d.state === 'fail');
  const unknowns = dims.filter((d) => d.state === 'unknown');
  const oks = dims.filter((d) => d.state === 'ok');
  /* ★ 未判定项如实回传：前端会逐条挂「未判定：可用空间」的说明，
     而不是含糊地降级成「待确认」——后者会让整张清单看着很长却没结论。 */
  const unjudged = unknowns.map((d) => d.dim);
  const keyUnknown = unknowns.filter((d) => KEY_DIMS.indexOf(d.dim) >= 0).map((d) => d.dim);

  let verdict;
  if (fails.length) verdict = 'no';
  else if (!oks.length) verdict = 'unknown';        /* 连一个能站住的维度都没有 → 不下结论 */
  else if (keyUnknown.length) verdict = 'maybe';    /* 关键维度缺 → 确实只能待确认 */
  else {
    const ramM = profile.ram && profile.ram.gb && spec.ramGb ? profile.ram.gb / spec.ramGb : 0;
    const stM = profile.storage && profile.storage.gb && spec.storageGb ? profile.storage.gb / spec.storageGb : 0;
    verdict = ramM >= 2 || stM >= 3 ? 'smooth' : 'ok';
  }
  return { verdict, dims, unjudged, keyUnknown, reasons: dims.filter((d) => d.state !== 'skip') };
}

const ORDER = { smooth: 0, ok: 1, maybe: 2, unknown: 3, no: 4 };
const LABEL = { smooth: '流畅', ok: '可跑', maybe: '待确认', unknown: '信息不足', no: '不可跑' };

/** 英文名首字母缩写（"Grand Theft Auto V 传承版" → "gtav"）
 *  实测踩到：清单里搜「GTA」返回 0 条 —— 因为只做字面包含，
 *  而「Grand Theft Auto V」里根本没有 "GTA" 这三个字母。用户却是这么叫的。 */
function abbrOf(name) {
  return String(name || '').split(/[\s\-_:·]+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .map((w) => w[0])
    .join('').toLowerCase();
}

/**
 * 主入口
 * @param {object} profile spec-dict 产出的画像
 * @param {object} [opts] {limit, q, only}
 */
function analyze(profile, opts = {}) {
  const ix = index();
  if (ix.error) return { ok: false, error: ix.error, matches: [], stats: {} };

  const rows = [];
  for (const g of Object.values(ix.map)) {
    if (!g.min) continue;
    const j = judge(profile, g.min);
    rows.push({
      appid: g.appid, name: g.name, verdict: j.verdict,
      abbr: abbrOf(g.name),
      dims: j.dims,
      unjudged: j.unjudged,
      min: { ram: g.min.raw && g.min.raw.ram, storage: g.min.raw && g.min.raw.storage, dx: g.min.raw && g.min.raw.dx, gpu: g.min.gpuRaw, cpu: g.min.cpuRaw, os: g.min.os },
      rec: g.rec ? { ram: g.rec.raw && g.rec.raw.ram, gpu: g.rec.gpuRaw, dx: g.rec.raw && g.rec.raw.dx } : null,
      margin: (() => { const m = j.dims.filter((d) => d.margin != null).map((d) => d.margin); return m.length ? Math.min.apply(null, m) : null; })(),
      /* 「游戏规模」：内存为主、存储为辅。用来把吃配置的大作排到前面 ——
         只按余量排的话，榜上全是几百 MB 的小品，看不出「我这配置能跑什么大作」。 */
      scale: Math.round(((g.min.ramGb || 0) + (g.min.storageGb || 0) / 8) * 100) / 100,
    });
  }

  const q = String(opts.q || '').trim().toLowerCase();
  /* 搜索同时匹配「全名」与「首字母缩写」：用户会搜 GTA，而库里叫 Grand Theft Auto V */
  const filtered = q ? rows.filter((r) => r.name.toLowerCase().includes(q) || r.abbr.includes(q)) : rows;
  const mode = opts.sort === 'margin' || opts.sort === 'name' ? opts.sort : 'scale';
  filtered.sort((a, b) => {
    if (ORDER[a.verdict] !== ORDER[b.verdict]) return ORDER[a.verdict] - ORDER[b.verdict];
    if (mode === 'margin') return (b.margin || 0) - (a.margin || 0) || a.name.localeCompare(b.name);
    if (mode === 'name') return a.name.localeCompare(b.name);
    return (b.scale || 0) - (a.scale || 0) || a.name.localeCompare(b.name);
  });

  const total = filtered.length;
  const limit = Math.max(1, Math.min(Number(opts.limit) || 60, 500));
  const playable = filtered.filter((r) => r.verdict !== 'no' && r.verdict !== 'unknown');
  const items = (opts.only === 'playable' ? playable : filtered).slice(0, limit);

  const dist = {};
  for (const r of filtered) dist[r.verdict] = (dist[r.verdict] || 0) + 1;

  return {
    ok: true,
    items: items.map((r) => Object.assign({}, r, { label: LABEL[r.verdict] })),
    stats: {
      scanned: Object.keys(ix.map).length,
      total, shown: items.length,
      playable: filtered.filter((r) => r.verdict === 'smooth' || r.verdict === 'ok').length,
      dist, distLabel: Object.keys(dist).reduce((a, k) => (a[LABEL[k] || k] = dist[k], a), {}),
      source: 'Steam 官方配置要求（' + ix.built + ' 款）',
    },
  };
}

/** 词典自述：前端「识别规则」面板用 */
function dictInfo() {
  const ix = index();
  return {
    ok: true,
    dict: require('./spec-dict').DICT_VERSION,
    built: ix.built,
    error: ix.error || null,
    dims: [
      { dim: 'arch', label: '指令集架构', why: 'ARM 跑 x86 游戏必须有转译层，缺了结构上不可行' },
      { dim: 'dx', label: '图形接口', why: '兼容层决定 DX 上限：DXVK→11，VKD3D→12' },
      { dim: 'ram', label: '内存', why: '与游戏最低内存要求逐款比较' },
      { dim: 'storage', label: '存储', why: '与游戏所需可用空间比较' },
    ],
    layers: LAYER_DX.map((l) => ({ kw: l.kw[0], max: l.max, note: l.note })),
    translators: X86_TRANSLATORS,
  };
}

module.exports = { analyze, index, judge, cmpDx, cmpArch, dxCap, dictInfo, abbrOf, LABEL, ORDER, _file: REQ_FILE };
