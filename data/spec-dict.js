/**
 * spec-dict.js — 「解包 / 导出 JSON」的配置识别词典（v10.20 新增）
 *
 * 场景：用户会把一份从游戏包 / 兼容层工具里导出的 JSON 喂进来，
 *   内容类似「兼容层最低配置」。**字段名事先未知**，所以这里不写死名字，
 *   改用**双向识别**：
 *     ① 键名通道：key 归一（小写、去 _ - 空格 . [ ]）后与关键词表比对 → 高置信
 *     ② 值通道  ：对字符串值做形态匹配（"Adreno 740" / "8 GB" / "DXVK 2.4"…）
 *                即使键名是 d[3].x 这种，也能从值里认出这是什么 → 低置信
 *
 * ★ 样本到手后**只扩这个文件**（KEY_RULES / VAL_RULES / LAYER_KWS），
 *   接口与前端一律不动 —— 这就是「先把页面立起来」的意义。
 *
 * 纯函数、无网络、无副作用，可直接单测（tools/test-spec.js）。
 */
const { gpuScore } = require('./gpu-tier');

/* ── 语义分组（前端直接拿去渲染分组卡） ── */
const GROUPS = {
  gpu: { label: '显卡 / GPU', icon: '🎮' },
  cpu: { label: '处理器 / CPU', icon: '🧠' },
  ram: { label: '内存 / RAM', icon: '📐' },
  vram: { label: '显存 / VRAM', icon: '🧩' },
  storage: { label: '存储空间', icon: '💽' },
  os: { label: '操作系统', icon: '🪟' },
  api: { label: '图形接口', icon: '🔌' },
  layer: { label: '兼容层', icon: '🧪' },
  driver: { label: '驱动', icon: '⚙️' },
  arch: { label: '指令集架构', icon: '🏗' },
  res: { label: '分辨率', icon: '🖼' },
  ver: { label: '版本', icon: '🏷' },
  other: { label: '其他', icon: '•' },
};

/* ── 键名关键词（小写、已去掉分隔符后的写法） ──
   ⚠️ 顺序即优先级：先匹配到的先用。宽词（如 mem）必须排在窄词之后，
      否则 "vram" 会被 "ram" 先截走。 */
const KEY_RULES = [
  { group: 'vram', label: '显存', kws: ['vram', 'videomemory', 'gpuram', '显存', 'graphicsmemory', 'gpumem'] },
  { group: 'gpu', label: '显卡', kws: ['gpu', 'graphicscard', 'videocard', 'videoadapter', 'renderer', 'graphics', '显卡', '图形卡', '显示适配器', 'gpuname', 'adapter'] },
  { group: 'cpu', label: '处理器', kws: ['cpu', 'processor', 'cputype', 'cpuname', '处理器', '中央处理器'] },
  { group: 'ram', label: '内存', kws: ['ram', 'memory', 'systemmemory', 'memtotal', '内存', '运行内存', 'mainmemory'] },
  { group: 'storage', label: '存储', kws: ['storage', 'disk', 'diskspace', 'hdd', 'ssd', 'freespace', '存储', '硬盘', '磁盘', '可用空间', '空间'] },
  { group: 'os', label: '系统', kws: ['os', 'osversion', 'operatingsystem', 'platform', 'systemversion', '系统', '操作系统'] },
  { group: 'api', label: '接口', kws: ['dx', 'directx', 'd3d', 'graphicsapi', 'apiversion', '接口', 'vulkan', 'opengl', 'metal'] },
  { group: 'driver', label: '驱动', kws: ['driver', 'driverversion', 'gpudriver', '驱动', 'glversion'] },
  { group: 'arch', label: '架构', kws: ['arch', 'architecture', 'abi', 'cpuabi', '指令集', '架构'] },
  { group: 'res', label: '分辨率', kws: ['resolution', 'screen', 'displaymode', 'width', 'height', '分辨率'] },
  { group: 'ver', label: '版本', kws: ['version', 'ver', 'build', 'revision', '版本'] },
];

/** 兼容层 / 转译层名（键名通道命中即归 layer，并作为 profile.layer 的键） */
const LAYER_KWS = [
  'dxvk', 'vkd3d', 'vkd3dproton', 'd3d12', 'box64', 'box86', 'fex', 'fexcore', 'wine',
  'proton', 'wined3d', 'turnip', 'zink', 'virgl', 'gamescope', 'mangohud', 'vkbasalt',
  'winetricks', 'winemono', 'dotnet', 'mono', 'gamenative', 'winalator', 'bc250',
];

/* ── 值形态匹配（仅在键名通道无命中时使用，全部按「低置信」标注） ──
   ★ 命中时**只取捕获到的片段**，不是整串值。实测踩到：值 "OnePlus 13 (SM8750)"
     若整串当 GPU 名交给 gpuScore()，会落进 fam:'other' → 固定 400 分（假精度）。
     只取 "SM8750" 才能被 gpu-tier 认出来（裸 SM 编号 → socScoreFromSm）。 */
const VAL_RULES = [
  {
    group: 'gpu', conf: 'low', label: '像显卡型号',
    re: /\b(adreno\s?\d{3}|mali[\s-]?g?\s?\d{2,3}(?:\s?mc\s?\d+)?|immortalis[\s-]?g?\d{0,3}|powervr\s?[\w-]+|xclipse\s?\d{3}|geforce\s?[\w-]{0,10}\s?\d{3,4}|radeon\s?[\w-]{0,10}\s?\d{3,4}|rtx\s?\d{3,4}|gtx\s?\d{3,4}|iris\s?xe|arc\s?a\d{3})\b/i,
  },
  {
    /* 手机 / 平板解包很常见：值里夹着芯片代号（"OnePlus 13 (SM8750)"） */
    group: 'gpu', conf: 'low', label: '像芯片代号',
    re: /\b((?:sm|msm|sdm|mt|kirin|dimensity|tensor|exynos)\s?\d{3,4})\b/i,
  },
  {
    group: 'arch', conf: 'low', label: '像指令集架构',
    re: /^(x86_64|amd64|x64|arm64-?v?8?|aarch64|armv7l?|i[3-6]86)$/i,
  },
  {
    group: 'os', conf: 'low', label: '像操作系统',
    re: /^(windows\s?\d*|win\s?\d+|windows\s?xp|android\s?\d*|linux|macos|darwin)/i,
  },
  {
    group: 'res', conf: 'low', label: '像分辨率',
    re: /^\d{3,4}\s?[x×]\s?\d{3,4}$/,
  },
];

const MAX_DEPTH = 8;
const MAX_NODES = 4000;
const MAX_VALUE_LEN = 400;

/* ---------- 工具 ---------- */

/** key 归一：小写 + 去掉分隔符（`Gpu_Name` → `gpuname`） */
function normKey(k) {
  return String(k == null ? '' : k).toLowerCase().replace(/[\s_\-.[\]()]+/g, '');
}

/** 把 "需要 13 GB 可用空间" / "8GB RAM" / "2048 MB" 解析成 GB */
function toGB(s) {
  const m = String(s == null ? '' : s).match(/(\d+(?:\.\d+)?)\s*(TB|GB|MB|G|M)\b/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!isFinite(n)) return null;
  const u = m[2].toUpperCase();
  const gb = u === 'TB' ? n * 1024 : (u === 'GB' || u === 'G') ? n : n / 1024;
  return { gb: Math.round(gb * 100) / 100, raw: String(s).trim() };
}

/** 解析 DirectX 版本（"9.0c"→9, "DirectX 11"→11, "12"→12）；认不出返 null */
function dxOf(s) {
  const t = String(s == null ? '' : s);
  const m = t.match(/(?:directx|dx|d3d)\s*:?\s*(\d+(?:\.\d+)?)/i) || t.match(/^\s*(\d+(?:\.\d+)?)\s*[a-z]?\s*$/i);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return isFinite(v) ? v : null;
}

/** 是否属于「最低配置」档（而不是推荐配置） */
function tierOf(...names) {
  const s = names.map(normKey).join('|');
  if (/rec|recommend|推荐|建议|high|ultra/.test(s)) return 'rec';
  if (/min|minimum|minimumreq|req|require|最低|需求/.test(s)) return 'min';
  return '';
}

/* ---------- 递归展开 ---------- */

function leaves(node, path, parentKey, out, depth) {
  if (out.length >= MAX_NODES || depth > MAX_DEPTH || node == null) return out;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length && out.length < MAX_NODES; i++) {
      leaves(node[i], path + '[' + i + ']', parentKey, out, depth + 1);
    }
    return out;
  }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (out.length >= MAX_NODES) break;
      const p = path ? path + '.' + k : k;
      leaves(v, p, parentKey ? parentKey + '.' + k : k, out, depth + 1);
    }
    return out;
  }
  /* 叶子：同时记下「直接键名」与「祖先键名路径」——
     很多 JSON 是 { min: { ram: "8 GB" } }，光看叶子 ram 会丢档位信息 */
  out.push({ path, key: path.split('.').pop().replace(/\[\d+\]$/, ''), anc: parentKey, value: node });
  return out;
}

/* ---------- 分类 ---------- */

function classify(leaf) {
  const k = normKey(leaf.key);
  const kAnc = normKey(leaf.anc);
  const joined = kAnc || k;

  /* ① 兼容层：键名里出现层名（dxvk / box64 / wine…）→ 归 layer，键名留作版本槽 */
  for (const w of LAYER_KWS) {
    if (joined.includes(w)) return { group: 'layer', conf: 'high', from: 'key', label: '兼容层', layer: w };
  }
  /* ② 普通键名 */
  for (const r of KEY_RULES) {
    for (const w of r.kws) {
      if (k === w || joined.endsWith(w) || k.includes(w)) {
        return { group: r.group, conf: 'high', from: 'key', label: r.label };
      }
    }
  }
  /* ③ 值形态（低置信）：命中片段单独回传，供 buildRecord 只取片段 */
  const s = String(leaf.value == null ? '' : leaf.value).trim();
  if (s && s.length <= MAX_VALUE_LEN) {
    for (const r of VAL_RULES) {
      const m = r.re.exec(s);
      if (m) return { group: r.group, conf: r.conf, from: 'value', label: r.label, hit: String(m[1] || m[0] || '').trim() };
    }
  }
  return null;
}

/* ---------- 提取 ---------- */

/**
 * 从任意 JSON 文本 / 对象里提取「配置画像」。
 * @param {string|object} input
 * @returns {{ok:boolean,error?:string,shape:string,records:Array,stats:object}}
 */
function extract(input) {
  let data = input;
  if (typeof input === 'string') {
    const t = input.trim();
    if (!t) return { ok: false, error: '内容为空', shape: 'none', records: [], stats: {} };
    try {
      data = JSON.parse(t);
    } catch (e) {
      return { ok: false, error: 'JSON 解析失败：' + e.message, shape: 'invalid', records: [], stats: {} };
    }
  }
  if (data == null) return { ok: false, error: '没有可解析的内容', shape: 'none', records: [], stats: {} };

  /* 顶层是数组 → 视作「多条记录」；对象 → 视作单条。两者走同一套识别。 */
  const shape = Array.isArray(data) ? 'array' : (typeof data === 'object' ? 'object' : 'scalar');
  const rawRecords = Array.isArray(data) ? data.slice(0, 200) : [data];

  const records = rawRecords.map((r, i) => buildRecord(r, i));
  const hit = records.reduce((a, r) => a + r.entries.length, 0);
  const miss = records.reduce((a, r) => a + r.unknown.length, 0);
  const byGroup = {};
  for (const r of records) for (const e of r.entries) byGroup[e.group] = (byGroup[e.group] || 0) + 1;

  return {
    ok: true,
    shape,
    records,
    /* 单条时给一个便捷入口，前端不必展开 records[0] */
    profile: records[0] ? records[0].profile : null,
    entries: records[0] ? records[0].entries : [],
    unknown: records[0] ? records[0].unknown : [],
    stats: {
      nodes: hit + miss, hit, miss,
      coverage: hit + miss ? Math.round((hit / (hit + miss)) * 1000) / 10 : 0,
      byGroup,
      multi: Array.isArray(data) && data.length > 200 ? { total: data.length, used: 200 } : null,
    },
  };
}

function buildRecord(node, i) {
  const ls = leaves(node, '', '', [], 0);
  const entries = [];
  const unknown = [];
  for (const l of ls) {
    const c = classify(l);
    if (c) {
      /* 值通道**只取命中片段**（"OnePlus 13 (SM8750)" → "SM8750"），
         否则整串塞进 gpuScore() 会得到 fam:'other' 的假分数。键名通道用整值。 */
      const v = (c.from === 'value' && c.hit) ? c.hit : l.value;
      entries.push({
        path: l.path, key: l.key, value: v, rawValue: l.value,
        group: c.group, conf: c.conf, from: c.from, label: c.label,
        tier: tierOf(l.key, l.anc),
        layer: c.layer || '',
      });
    } else {
      unknown.push({ path: l.path, key: l.key, value: l.value });
    }
  }
  return { idx: i, profile: buildProfile(node, entries), entries, unknown };
}

/** 把识别到的条目聚合成一份「可直接比较」的画像
 *
 * ★★ 关键设计：**「自身配置」与「最低要求」必须分层**（实测踩到）★★
 *   一份 JSON 里常常同时写着「这台设备有什么」和「这游戏最低要什么」，
 *   例如 `{memory:"16 GB", minRequirements:{ram:"8 GB"}}`。
 *   分层前，minRequirements.ram 会把设备的 16 GB 顶掉 —— 结果拿「游戏的要求」
 *   当「设备的能力」去比，越比越离谱。
 *   更危险的是 dx：`minRequirements.dx = 12` 曾被当成「我支持 DX12」写进能力表，
 *   于是任何 DX12 游戏都判「可跑」——**要求 ≠ 能力**，这是假阳性的源头。
 *
 *   所以：`p.*` 只装自身配置；缺失时才退回要求档并标 `src:'req'`，
 *   `p.req.*` 单独收「最低要求」，两者永不混用。
 */
function buildProfile(node, entries) {
  const byConf = (a, b) => (a.conf === 'high' ? 0 : 1) - (b.conf === 'high' ? 0 : 1);
  const selfOf = (g) => entries.filter((e) => e.group === g && e.tier !== 'min').sort(byConf)[0] || null;
  const reqOf = (g) => entries.filter((e) => e.group === g && e.tier === 'min').sort(byConf)[0] || null;
  /** 取「自身配置优先、要求兜底」的条目，并记下来源 */
  const take = (g) => {
    const s = selfOf(g);
    if (s) return { e: s, src: 'self' };
    const r = reqOf(g);
    return r ? { e: r, src: 'req' } : null;
  };

  const p = {
    name: nameOf(node),
    gpu: null, cpu: null, ram: null, vram: null, storage: null,
    os: null, arch: null, res: null, driver: null,
    api: [], apiRaw: [], layer: {},
    req: { ram: null, storage: null, dx: null },
    tier: '', src: 'self',
  };

  const g = take('gpu');
  if (g) {
    const raw = String(g.e.value).trim();
    p.gpu = { raw, score: gpuScore(raw), src: g.src, conf: g.e.conf, tier: g.e.tier };
  }

  const c = take('cpu');
  if (c) p.cpu = { raw: String(c.e.value).trim(), src: c.src, tier: c.e.tier };

  for (const [grp, field] of [['ram', 'ram'], ['vram', 'vram'], ['storage', 'storage']]) {
    const t = take(grp);
    if (!t) continue;
    const v = toGB(t.e.value);
    if (v) p[field] = { gb: v.gb, raw: String(t.e.value).trim(), src: t.src, tier: t.e.tier, conf: t.e.conf };
  }

  const o = take('os'); if (o) p.os = { raw: String(o.e.value).trim() };
  const a = take('arch'); if (a) p.arch = { raw: String(a.e.value).trim() };
  const r = take('res'); if (r) p.res = { raw: String(r.e.value).trim() };
  const d = take('driver'); if (d) p.driver = { raw: String(d.e.value).trim(), src: d.src };

  /* 图形接口：**只收自身配置**。要求档的 dx 另存 p.req.dx —— 两者语义相反，
     混在一起就会把「游戏要 DX12」读成「我支持 DX12」。 */
  for (const e of entries.filter((x) => x.group === 'api')) {
    const raw = String(e.value == null ? '' : e.value).trim();
    const v = dxOf(raw);
    if (e.tier === 'min') { if (v != null && p.req.dx == null) p.req.dx = v; continue; }
    if (p.apiRaw.includes(raw)) continue;
    p.apiRaw.push(raw);
    if (v != null) p.api.push({ kind: 'dx', v, raw });
    else if (/vulkan/i.test(raw)) p.api.push({ kind: 'vulkan', v: null, raw });
    else if (/opengl/i.test(raw)) p.api.push({ kind: 'opengl', v: null, raw });
  }

  /* 最低要求里的内存 / 存储（供「这份 JSON 声明了哪些要求」展示） */
  const rr = reqOf('ram');
  if (rr) { const v = toGB(rr.value); if (v) p.req.ram = v.gb; }
  const rs = reqOf('storage');
  if (rs) { const v = toGB(rs.value); if (v) p.req.storage = v.gb; }

  /* 兼容层：同名取有值的那个（版本号通常在值里） */
  for (const e of entries.filter((x) => x.group === 'layer')) {
    const k = e.layer;
    const raw = String(e.value == null ? '' : e.value).trim();
    const prev = p.layer[k];
    if (!prev || (!prev.raw && raw)) p.layer[k] = { raw, tier: e.tier };
  }

  /* 顶层档位：这份 JSON 整体在讲「最低配置」还是「推荐配置」 */
  const mins = entries.filter((e) => e.tier === 'min').length;
  const recs = entries.filter((e) => e.tier === 'rec').length;
  p.tier = mins && mins >= recs ? 'min' : (recs ? 'rec' : '');

  /* 哪些字段是「要求」兜底来的（前端会标注「取自最低要求」以免误读） */
  const borrowed = ['gpu', 'cpu', 'ram', 'vram', 'storage', 'driver'].filter((f) => p[f] && p[f].src === 'req');
  p.src = borrowed.length ? (borrowed.length >= 4 ? 'req' : 'mixed') : 'self';
  p.borrowed = borrowed;

  return p;
}

/** 尽力给这条记录起个名字（游戏名 / 设备名 / 配置名） */
function nameOf(node) {
  if (!node || typeof node !== 'object') return '';
  const KEYS = ['name', 'title', 'game', 'gamename', 'model', 'device', 'devicename', 'label', 'id', 'appname'];
  for (const k of KEYS) {
    for (const [kk, vv] of Object.entries(node)) {
      if (normKey(kk) === k && vv && typeof vv === 'string' && vv.length < 80) return vv.trim();
    }
  }
  return '';
}

module.exports = {
  extract, buildProfile, classify, toGB, dxOf, tierOf, normKey,
  GROUPS, KEY_RULES, VAL_RULES, LAYER_KWS,
  DICT_VERSION: 'v10.20',
};
