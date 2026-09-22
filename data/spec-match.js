/**
 * spec-match.js — 「一份配置」对撞「游戏库要求」（v10.20 新增 · v10.22 换数据源）
 *
 * 输入：spec-dict.extract() 产出的 profile（一份环境/设备配置）
 * 输出：可适配游戏清单，**每个判定都带可解释理由**（前端直接铺出来）。
 *
 * ★ v10.22 换源说明（这一版最大的变化）：
 *   原来源是 `steam-req.json`，只有 **653 款** Steam 游戏 ——
 *   于是「我这份配置能跑什么」的天花板就是 653 款，
 *   库里另外 3 万条 XD / 机地游戏因为**没有配置要求**被整批判成「无法判定」。
 *   现改为读 `spec-req.json`（由 tools/build-spec-req.js 合成）：
 *   按 **Steam appid** 把「机地 17,220 条话题（自带 pc_requirement / game_sys_reqs）」
 *   与「Steam 官方 653 条」精确对齐合并，得到 **16,575 款**带真实要求的游戏。
 *   ⇒ 判定依据从「猜」变成「读已有数据」；覆盖 653 → 16,575（25×）。
 *   同时每条都带上 `cover` / `hot`（机地浏览量）/ `jidiTid` / `libId`，
 *   前端的封面展示、热门排序、下载弹窗都靠这几个字段。
 *
 * 为什么不用 GPU 分直接比：
 *   data/gpu-tier.js 的 gpuScore() 是**移动 GPU 量纲**（Adreno 280-840 / Mali 映射），
 *   而配置要求里的显卡是 PC 卡自由文本（"NVidia 6600"、"GTX 1060"），
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

const REQ_FILE = path.join(__dirname, 'spec-req.json');

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
  try { st = fs.statSync(REQ_FILE); } catch (e) {
    return { map: {}, built: 0, error: 'spec-req.json 读取失败（先跑 node tools/build-spec-req.js）' };
  }
  if (_cache && st.mtimeMs === _mtime) return _cache;

  let raw;
  try { raw = JSON.parse(fs.readFileSync(REQ_FILE, 'utf8')); } catch (e) {
    return { map: {}, built: 0, error: 'spec-req.json 解析失败：' + e.message };
  }
  const src = raw.map || {};
  const map = {};
  for (const [appid, v] of Object.entries(src)) {
    if (!v) continue;
    const min = parseSpec(v.min);
    const rec = parseSpec(v.rec);
    if (!min && !rec) continue;                 // 两条要求都没有 → 判不了，不进索引
    map[appid] = {
      appid,
      name: v.name || ('appid ' + appid),
      nameEn: v.nameEn || null,
      /* ★ v10.22 新增：封面 / 热度 / 两侧 id / 要求来源 */
      cover: v.cover || null,
      genres: Array.isArray(v.genres) ? v.genres : null,
      size: v.size || null,
      score: v.score != null ? v.score : null,
      hot: Number(v.hot) || 0,
      releaseDate: v.releaseDate || null,
      jidiTid: v.jidiTid || null,
      libId: v.libId || null,
      libUrl: v.libUrl || null,
      reqFrom: v.reqFrom || null,
      min, rec,
    };
  }
  _mtime = st.mtimeMs;
  _cache = {
    map,
    built: Object.keys(map).length,
    at: raw.builtAt || null,
    stats: raw.stats || null,
    joinKey: raw.joinKey || null,
  };
  return _cache;
}

/**
 * 把一条配置要求结构化：{ramGb, storageGb, dx, os, gpuRaw, cpuRaw}
 * ★ 要能吃**两种来源的形态**：
 *   · spec-req.json 里已是数值（`ramGb` / `storageGb` / `dx`）
 *   · 原始文本（`ram:"8 GB RAM"` / `dx:"9.0c"`）—— 留作兜底，便于直接喂 steam 原文调试
 */
function parseSpec(o) {
  if (!o || typeof o !== 'object') return null;
  const out = { raw: o };
  const ram = o.ramGb != null ? { gb: o.ramGb } : toGB(o.ram);
  if (ram) out.ramGb = ram.gb;
  const st = o.storageGb != null ? { gb: o.storageGb } : toGB(o.storage);
  if (st) out.storageGb = st.gb;
  const dx = typeof o.dx === 'number' ? o.dx : dxOf(o.dx);
  if (dx != null) out.dx = dx;
  const os = o.os;
  if (os) out.os = String(os).trim();
  const gpu = o.gpuRaw != null ? o.gpuRaw : o.gpu;
  if (gpu) { out.gpuRaw = String(gpu).trim(); out.gpuScore = gpuScore(out.gpuRaw); }
  const cpu = o.cpuRaw != null ? o.cpuRaw : o.cpu;
  out.cpuRaw = cpu ? String(cpu).trim() : '';
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

/* ── ★★ v10.35 口径决策（用户 2026-09-22 定）：ARM 缺「x86 转译层」不再判不可跑 ──
 *
 *  实测（`tools/_probe-spec.js` 画像 G，全库 16,519 款）：
 *      改前 v10.33：arch unknown(100%) ⇒ 待确认 14,552 / 信息不足 240 / 不可跑 1,727
 *      改后 v10.34：arch fail(100%)    ⇒ **不可跑 16,519（100%）**
 *      参考组画像 H（同一台设备，只是配置里多了 `box64`）⇒ 流畅 10,081 / 可跑 5,739 / 不可跑 699
 *  ⇒ 一个键（`box64` 有没有出现在**导出物**里）的有无，让整库结论从「94% 可跑以上」
 *    翻到「100% 不可跑」，其中 **14,792 款**从「待确认」被翻掉。
 *
 *  判据：**「导出物里没写 box64」与「设备没有 box64」在导出物里无法区分。**
 *  而判错的代价不对称：
 *    · 误判 fail    ⇒ 整库显示「不可跑」——用户直接看到不可能的结论（16,519 款）
 *    · 误判 unknown ⇒ 只显示「待确认」——用户自己看一眼就行
 *  且这与本文件既有口径一致：`req == null → skip`（**没标就一律不降级**，见 cmpNum）。
 *
 *  保留 fail 的唯一情形：配置**显式声明**转译层不可用
 *  （值 = off / disabled / false / none / 0 / 无 / 禁用 …）——那是有信息量的「明确不支持」。
 *  判据见 tools/test-v1035.js；反证见 tools/_counterproof-v1035.js。 */
const TR_OFF = /^(off|disabled|disable|false|no|none|null|nil|0|无|禁用|关闭|不支持|不可用)$/i;

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
  if (tr) {
    const raw = String((profile.layer[tr] || {}).raw || '').trim();
    if (TR_OFF.test(raw)) {
      /* 显式声明不可用 —— 这是有信息量的「明确不支持」，判 fail 站得住 */
      return { dim: 'arch', state: 'fail', note: 'ARM 架构，且配置**显式声明** ' + tr + ' 不可用（值「' + raw + '」）——没有 x86 转译，结构上跑不了 Windows 程序' };
    }
    return { dim: 'arch', state: 'ok', note: 'ARM 架构，但有 ' + tr + ' 转译 x86 指令' };
  }
  /* ★★ 口径见函数上方注释：**导出物没提转译层 ≠ 设备没有转译层** ⇒ 只判「待确认」。 */
  return { dim: 'arch', state: 'unknown', note: 'ARM 架构，配置未提及 x86 转译层（box64 / box86 / FEX）——缺信息，不能据此判不可跑' };
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
    /* ★★ v10.22 校准：「流畅」只由**内存余量**决定。
     *
     *  旧规则是 `ramM >= 2 || stM >= 3`（内存或存储任一宽裕就算流畅）。
     *  在只有 608 款游戏带容量数据时看不出问题；换成 spec-req（15,439 款带容量）后
     *  这个 `||` 立刻失控 —— 实测同一份「4GB 内存 / 16GB 空间」的配置：
     *      **8,385 款被判「流畅」**，因为「可用空间 ÷ 单款所需空间」几乎恒大于 3
     *      （16GB ÷ 1GB = 16），**一个存储余量就把整张榜刷成流畅**。
     *
     *  语义上也说不通：**硬盘空不空，不会让游戏跑得更顺**。
     *  机器的可用空间只决定「装不装得下」（是闸门），不决定「跑得顺不顺」（是余量）。
     *
     *  ⇒ 流畅 = 设备内存 ≥ 游戏最低内存的 2 倍。
     *     存储 / 图形接口只当通过·不通过的闸门，不再参与「流畅」判定。
     */
    const ramM = profile.ram && profile.ram.gb && spec.ramGb ? profile.ram.gb / spec.ramGb : 0;
    verdict = ramM >= 2 ? 'smooth' : 'ok';
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
 * @param {object} [opts] {limit, q, only, sort}
 */
function analyze(profile, opts = {}) {
  const ix = index();
  if (ix.error) return { ok: false, error: ix.error, items: [], stats: {} };

  const rows = [];
  for (const g of Object.values(ix.map)) {
    if (!g.min) continue;
    const j = judge(profile, g.min);
    rows.push({
      appid: g.appid, name: g.name, nameEn: g.nameEn, verdict: j.verdict,
      abbr: abbrOf(g.name),
      dims: j.dims,
      unjudged: j.unjudged,
      /* ★ 展示用：把数值拼成人读串，并保留数值给前端算「够不够」 */
      min: {
        ram: g.min.ramGb != null ? g.min.ramGb + ' GB' : null,
        storage: g.min.storageGb != null ? g.min.storageGb + ' GB' : null,
        dx: g.min.dx != null ? g.min.dx : null,
        gpu: g.min.gpuRaw || null,
        cpu: g.min.cpuRaw || null,
        os: g.min.os || null,
      },
      rec: g.rec ? { ram: g.rec.ramGb != null ? g.rec.ramGb + ' GB' : null, gpu: g.rec.gpuRaw || null, dx: g.rec.dx != null ? g.rec.dx : null } : null,
      /* ★ v10.22：手机专区同款展示所需的字段 */
      cover: g.cover,
      genres: g.genres,
      size: g.size,
      score: g.score,
      hot: g.hot,
      releaseDate: g.releaseDate,
      jidiTid: g.jidiTid,
      libId: g.libId,
      libUrl: g.libUrl,
      reqFrom: g.reqFrom,
      margin: (() => { const m = j.dims.filter((d) => d.margin != null).map((d) => d.margin); return m.length ? Math.min.apply(null, m) : null; })(),
      /* 「游戏规模」：内存为主、存储为辅。用来把吃配置的大作排到前面 */
      scale: Math.round(((g.min.ramGb || 0) + (g.min.storageGb || 0) / 8) * 100) / 100,
    });
  }

  const q = String(opts.q || '').trim().toLowerCase();
  /* 搜索同时匹配「全名」与「首字母缩写」：用户会搜 GTA，而库里叫 Grand Theft Auto V */
  const filtered = q
    ? rows.filter((r) => r.name.toLowerCase().includes(q) || (r.nameEn || '').toLowerCase().includes(q) || r.abbr.includes(q))
    : rows;
  const mode = ['hot', 'margin', 'name', 'scale'].indexOf(opts.sort) >= 0 ? opts.sort : 'hot';
  filtered.sort((a, b) => {
    if (ORDER[a.verdict] !== ORDER[b.verdict]) return ORDER[a.verdict] - ORDER[b.verdict];
    if (mode === 'margin') return (b.margin || 0) - (a.margin || 0) || a.name.localeCompare(b.name);
    if (mode === 'name') return a.name.localeCompare(b.name);
    if (mode === 'scale') return (b.scale || 0) - (a.scale || 0) || a.name.localeCompare(b.name);
    /* ★ 默认：热门优先（机地浏览量 dpv）。
       用户要的是「我这配置能跑什么**好玩/有名的**」，而不是一串没人听过的小品。
       热度并列时，再按规模排（大作优先），最后按名字保证稳定。 */
    return (b.hot || 0) - (a.hot || 0) || (b.scale || 0) - (a.scale || 0) || a.name.localeCompare(b.name);
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
      hot: filtered.filter((r) => (r.hot || 0) > 0).length,
      dist, distLabel: Object.keys(dist).reduce((a, k) => (a[LABEL[k] || k] = dist[k], a), {}),
      /* ★ 如实报出依据：不再是「Steam 官方 653 款」，而是两源合并后的真实口径 */
      source: (ix.stats && ix.stats.bySource)
        ? ('机地 ' + (ix.stats.jidiCandidates || 0) + ' 条 + Steam 官方 ' + (ix.stats.steamCandidates || 0) + ' 条，按 appid 合并为 ' + ix.built + ' 款')
        : ('游戏要求库 ' + ix.built + ' 款'),
      built: ix.built,
      builtAt: ix.at,
      joinKey: ix.joinKey,
      sort: mode,
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
    builtAt: ix.at,
    joinKey: ix.joinKey,
    stats: ix.stats,
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
