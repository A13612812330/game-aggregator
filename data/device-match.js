/**
 * device-match.js — 机型 → 芯片 → 可跑游戏 匹配引擎
 *
 * 数据来源：
 *   data/soc-db.json        芯片规格（1444 款 / 44 厂商，来自 vitkuz573/soc-db）
 *   data/device-board.json  主板代号 → SoC（200 条，来自 xTheEc0/Android-Device-Hardware-Specs-Database）
 *   data/bannerhub.json     社区配置库（2597 游戏 / 14005 配置，机型 + GPU）
 *   data/phonecfg.json      本项目实测库（1037 条，芯片 + 帧率）
 *   data/turnip.json        Turnip 驱动构建信息
 *
 * 核心思路：
 *   1. 机型（如 "Xiaomi 2412DPC0AG" / "SM S928B"）→ 解析出 GPU 型号（社区库已有 gp 字段）
 *   2. 无 GPU 信息时 → 从 soc-db 按机型名/芯片名反查
 *   3. GPU → 性能分（gpu-tier.js）
 *   4. 游戏可跑性：该游戏被「性能分 ≤ 用户档」的 GPU 跑过 → 可跑（向下兼容）
 */
const fs = require('fs');
const path = require('path');
const tier = require('./gpu-tier');
const dg = require('./device-gpu');
/* ★ v10.24：仓库键 → 端游库条目（含封面）。复用既有匹配结果，不新写名称匹配。 */
const bhcover = require('./bhcover');

const D = (f) => path.join(__dirname, f);

let socDb = null;
let boardDb = null;
let bh = null;
let pc = null;
let turnip = null;

function load() {
  if (socDb) return;
  socDb = JSON.parse(fs.readFileSync(D('soc-db.json'), 'utf-8'));
  boardDb = JSON.parse(fs.readFileSync(D('device-board.json'), 'utf-8'));
  bh = JSON.parse(fs.readFileSync(D('bannerhub.json'), 'utf-8'));
  pc = JSON.parse(fs.readFileSync(D('phonecfg.json'), 'utf-8'));
  try {
    turnip = JSON.parse(fs.readFileSync(D('turnip.json'), 'utf-8'));
  } catch (e) {
    turnip = null;
  }
  buildModelIndex();
}

/* ─────────── 机型 → GPU 索引 ─────────── */

let deviceGpu = null;   // Map: 归一化机型名 → { label, gpu, score, configs }
let deviceList = null;  // 排序好的机型列表（供前端下拉）

/** 归一化机型名：去掉厂商前缀与空格，保留数字字母 */
function normDev(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** 从机型名推测品牌 */
const BRAND_HINT = [
  [/^(xiaomi|redmi|poco|mi\b)/i, '小米 / Redmi'],
  [/^sm\s|^samsung|^galaxy/i, '三星'],
  [/^(huawei|honor)/i, '华为 / 荣耀'],
  [/^(oppo|oneplus|realme|find)/i, 'OPPO / 一加'],
  [/^(vivo|iqoo)/i, 'vivo / iQOO'],
  [/^(motorola|moto)\b/i, '摩托罗拉'],
  [/^(nubia|redmagic|ztec)/i, '努比亚 / 红魔'],
  [/^(asus|rog|zenfone)/i, '华硕'],
  [/^(lenovo|legion|tb\d)/i, '联想'],
  [/^(infinix|tecno|itel)/i, '传音系'],
  [/^(ayaneo|ayn|retroid|anbernic|moorechip|gameforce|gpd|powkiddy)/i, '掌机'],
  [/^(google|pixel)/i, '谷歌'],
  [/^(sony|xperia)/i, '索尼'],
  [/^(nothing)/i, 'Nothing'],
  [/^(zte|axon)/i, '中兴'],
];

function guessBrand(model, gpu) {
  const m = String(model || '');
  for (const [re, name] of BRAND_HINT) if (re.test(m)) return name;
  if (/mali/i.test(gpu || '')) return '其他（Mali GPU）';
  if (/adreno/i.test(gpu || '')) return '其他（Adreno GPU）';
  return '其他';
}

function buildModelIndex() {
  deviceGpu = new Map();

  // 1) 社区库：机型 ↔ GPU 的直接对应（最可靠）
  for (const g of bh.games || []) {
    const dvs = g.dv || [];
    const gps = g.gp || [];
    for (const d of dvs) {
      const k = normDev(d);
      if (!k) continue;
      let rec = deviceGpu.get(k);
      if (!rec) {
        rec = { label: d, gpu: '', score: null, games: 0, brands: new Set() };
        deviceGpu.set(k, rec);
      }
      rec.games++;
      /* ★ v10.11 移除 `rec.gpu = gps[0]` —— 那只是「该游戏第一个 GPU」，不是「该机型的 GPU」。
         GPU 一律在下面用 device-gpu 的精确配对补。 */
    }
    for (const p of gps) {
      // 从 GPU 反向登记：让用户也能只凭 GPU 查询
      const k = 'gpu:' + tier.normGpu(p).toLowerCase();
      if (!deviceGpu.has(k)) {
        const s = tier.gpuScore(p);
        deviceGpu.set(k, { label: p, gpu: p, score: s ? s.score : null, games: 0, isGpuOnly: true });
      }
    }
  }

  // 2) 用实测库补充芯片维度
  for (const r of (pc.records || [])) {
    const k = 'chip:' + (r.chip || '');
    if (!deviceGpu.has(k)) {
      const c = tier.chipScore(r.chip);
      deviceGpu.set(k, {
        label: r.chipName || r.chip,
        gpu: r.gpu || '',
        score: c ? c.gpu : null,
        games: 0,
        isChip: true,
      });
    }
  }

  /* ★ 2.5) v10.11：用 device-gpu 的**精确配对**补 GPU / SoC / CPU。
     数据源是 bannerhub-files.json 的逐条形态 `[机型, GPU, 时间, 文件名]`
     —— 机型与 GPU 本来就成对，实测覆盖 95.6% 的机型；
     而聚合版 bannerhub.json 里只剩两个互不相干的数组，配对关系已丢失。 */
  let paired = 0;
  let chipOnly = 0;
  for (const [, rec] of deviceGpu) {
    if (rec.isGpuOnly || rec.isChip) continue;
    const s = dg.specOf(rec.label);
    if (!s || (!s.gpu && !s.soc)) continue;
    rec.gpu = s.gpu || '';
    rec.soc = s.soc || '';
    rec.socVendor = s.socVendor || '';
    rec.socFrom = s.socFrom || s.src || '';
    rec.cpu = s.cpu || '';
    rec.gpuVariants = s.gpuVariants || 0;
    if (s.gpu) paired++; else chipOnly++;
  }
  console.log(`[device-match] 精确配对补全 ${paired} 台机型（GPU/SoC/CPU）${chipOnly ? `，另有 ${chipOnly} 台只补到芯片号` : ''}`);

  // 3) 计算每台机型的性能分
  for (const [k, rec] of deviceGpu) {
    if (rec.score == null) {
      if (rec.gpu) {
        const s = tier.gpuScore(rec.gpu);
        rec.score = s ? s.score : null;
      }
    }
    rec.brand = guessBrand(rec.label, rec.gpu);
  }

  deviceList = [...deviceGpu.entries()]
    .filter(([k, r]) => !r.isGpuOnly)
    .map(([k, r]) => ({
      k,
      model: r.label,
      brand: r.brand,
      gpu: r.gpu,
      soc: r.soc || '',
      socVendor: r.socVendor || '',
      socFrom: r.socFrom || '',
      cpu: r.cpu || '',
      score: r.score,
      games: r.games,
      chip: r.isChip ? r.label : '',
    }))
    .sort((a, b) => b.games - a.games);

  console.log(`[device-match] 机型索引 ${deviceList.length} 条，GPU 条目 ${[...deviceGpu.values()].filter((r) => r.isGpuOnly).length} 条`);
}

/* ─────────── 查询接口 ─────────── */

/** 品牌列表（含机型数） */
function brands() {
  load();
  const m = new Map();
  for (const d of deviceList) {
    m.set(d.brand, (m.get(d.brand) || 0) + 1);
  }
  return [...m.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
}

/** 按品牌/关键词列出机型 */
function models({ brand, q, limit = 100 } = {}) {
  load();
  let out = deviceList;
  if (brand) out = out.filter((d) => d.brand === brand);
  if (q) {
    const k = normDev(q);
    out = out.filter((d) => normDev(d.model).includes(k));
  }
  return out.slice(0, limit);
}

/** 模糊找一台机型：精确 → 包含 → 车牌式匹配 */
function findDevice(name) {
  load();
  if (!name) return null;
  const k = normDev(name);
  if (deviceGpu.has(k)) return { k, ...deviceGpu.get(k) };

  // 包含匹配（优先长名）
  const cands = [...deviceGpu.entries()]
    .filter(([kk, r]) => !r.isGpuOnly && (kk.includes(k) || k.includes(kk)))
    .sort((a, b) => b[0].length - a[0].length);
  if (cands.length) return { k: cands[0][0], ...cands[0][1] };

  // 去掉品牌前缀再试
  const stripped = k.replace(/^(xiaomi|samsung|sm|redmi|poco|moto|motorola|nubia|oppo|vivo|oneplus|realme|honor|huawei|asus|lenovo)\s*/i, '');
  if (stripped && stripped !== k) {
    const c2 = [...deviceGpu.entries()]
      .filter(([kk, r]) => !r.isGpuOnly && kk.includes(stripped))
      .sort((a, b) => b[0].length - a[0].length);
    if (c2.length) return { k: c2[0][0], ...c2[0][1] };
  }

  /* ★ v10.14：三星代号的**写法差异** ——
   *   社区配置里是「samsung SM-S918U1」（品牌前缀 + 大写 + 连字符），
   *   机型库里是「sm s918b」（小写 + 空格）。上面的包含匹配对不上（连字符卡住），
   *   所以本库有 200 条 SM 机型，却几乎一台社区机型都译不出来。
   *   两步：① 归一成 `sm s918u1` 精确查；② 退到**基号前缀** `sm s918` 找同代机型。
   *   ⚠️ 第②步的"同代"是刻意的：s918u1（S23 Ultra 美版）与 s918b（S23）同为骁龙 8 Gen 2，
   *      芯片答案一致；我们只展示芯片，不宣称型号等同。 */
  const smNorm = k.replace(/^samsung\s+/i, '').replace(/^sm[-_]/i, 'sm ')
    .replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
  if (smNorm !== k) {
    if (deviceGpu.has(smNorm)) return { k: smNorm, ...deviceGpu.get(smNorm) };
    const base = (smNorm.match(/^sm\s+[a-z]?\d{3}/i) || [])[0];
    if (base) {
      const c3 = [...deviceGpu.entries()]
        .filter(([kk, r]) => !r.isGpuOnly && kk.startsWith(base))
        .sort((a, b) => a[0].length - b[0].length);
      /* ⚠️ 带 approx 标记：同代不同型（A06 4G 是 Helio G91、A06 5G 是天玑6300）芯片其实不同，
         所以这只是「近似参考」，前端会显示 ≈，不让用户当成精确答案。 */
      if (c3.length) return { k: c3[0][0], ...c3[0][1], approx: true };
    }
  }

  /* ★ 库外机型兜底：用户手输的型号未必在社区库里，但 device-gpu 能用
     「配对表 → soc-db 编号反查」把芯片解析出来（全程离线）。 */
  const s = dg.specOf(name);
  if (s && (s.gpu || s.soc)) {
    return {
      k: 'x:' + k,
      label: String(name).trim(),
      gpu: s.gpu || '',
      soc: s.soc || '',
      socVendor: s.socVendor || '',
      socFrom: s.socFrom || s.src || '',
      cpu: s.cpu || '',
      score: s.gpuScore,
      games: 0,
      gpuVariants: s.gpuVariants || 0,
      arch: s.arch || '',
      cores: s.cores || 0,
      external: true,
    };
  }
  return null;
}

/**
 * 核心：给一台机型，算出它能跑哪些游戏。
 * 规则（向下兼容）：游戏所需最低档 = 跑过该游戏的「最弱 GPU」；
 *   用户档 ≥ 所需档 → 可跑；用户档 ≥ 所需档+40 → 流畅。
 */
function matchGames(deviceName, { limit = 300 } = {}) {
  load();
  const dev = findDevice(deviceName);
  if (!dev) return { ok: false, error: 'notfound', device: deviceName };

  const myScore = dev.score;
  if (myScore == null) {
    return {
      ok: false,
      error: 'nogpu',
      device: dev.label,
      gpu: dev.gpu,
      info: {
        model: dev.label,
        brand: dev.brand || guessBrand(dev.label, dev.gpu),
        soc: dev.soc || '',
        socVendor: dev.socVendor || '',
        socFrom: dev.socFrom || '',
        cpu: dev.cpu || '',
        arch: dev.arch || '',
        cores: dev.cores || 0,
      },
    };
  }

  const out = [];
  for (const g of bh.games || []) {
    const gps = g.gp || [];
    if (!gps.length) continue;

    // 该游戏跑过的最弱 GPU 档位
    let minScore = null;
    let minGpu = '';
    for (const p of gps) {
      const s = tier.gpuScore(p);
      if (!s) continue;
      if (minScore == null || s.score < minScore) {
        minScore = s.score;
        minGpu = p;
      }
    }
    if (minScore == null) continue;

    const verdict = tier.playableAt(myScore, minScore);
    if (verdict === 'no') continue;

    out.push({
      k: g.k,
      name: g.p,
      configs: g.c,
      devices: (g.dv || []).length,
      minGpu,
      minScore,
      verdict,
      // 与用户 GPU 的实际差距
      delta: myScore - minScore,
      tier: verdict === 'smooth' ? '流畅' : verdict === 'ok' ? '可玩' : '勉强',
    });
  }

  out.sort((a, b) => (b.verdict === a.verdict ? b.configs - a.configs : (b.verdict === 'smooth' ? 1 : 0) - (a.verdict === 'smooth' ? 1 : 0)));

  return {
    ok: true,
    device: {
      model: dev.label,
      gpu: dev.gpu,
      score: myScore,
      brand: dev.brand,
      /* ★ v10.11：机型 → SoC/CPU 的「转译」结果（用户界面上要展示的就是这两行） */
      soc: dev.soc || '',
      socVendor: dev.socVendor || '',
      socFrom: dev.socFrom || '',
      cpu: dev.cpu || '',
      arch: dev.arch || '',
      cores: dev.cores || 0,
      gpuVariants: dev.gpuVariants || 1,
      external: !!dev.external,
    },
    total: out.length,
    /* ★ v10.24：给返回的这批挂上端游库条目（`libId/libTitle/libUrl/libCover`）。
       前端 `dmCard` 读的就是扁平的 `g.libCover`；从前这一层没做 ⇒ 恒为 undefined
       ⇒ `.cov.noimg` 隐藏封面区 ⇒ 24 张卡一张图都没有（用户反馈的原始现象）。
       只挂 `slice` 后的这一页（`out` 可能上千条，没必要全算）。
       取不到就留空 —— **不编造**，前端按手游专区同款走 `.cov.noimg`。 */
    games: (() => {
      const page = out.slice(0, limit);
      try { bhcover.attachAll(page); } catch (e) { /* 库文件缺失 → 卡片退回无图，不阻断查询 */ }
      return page;
    })(),
    summary: {
      smooth: out.filter((x) => x.verdict === 'smooth').length,
      ok: out.filter((x) => x.verdict === 'ok').length,
      maybe: out.filter((x) => x.verdict === 'maybe').length,
    },
  };
}

/** 芯片规格查询（给前端芯片库用） */
function chipSpec(q) {
  load();
  if (!q) return null;
  const k = normDev(q);
  const hits = (socDb.chips || []).filter((c) => {
    const hay = normDev(`${c.name} ${c.model} ${c.id}`);
    return hay.includes(k);
  });
  // 优先高通骁龙等移动芯片
  const mobile = hits.filter((c) => /adreno|mali|immortalis|xclipse/i.test(c.gpu || ''));
  const list = (mobile.length ? mobile : hits).slice(0, 12);
  return list.map((c) => ({
    ...c,
    perf: (() => {
      const s = tier.gpuScore(c.gpu);
      return s ? { score: s.score, fam: s.fam } : null;
    })(),
  }));
}

/** Turnip 驱动信息 */
function turnipInfo() {
  load();
  return turnip;
}

module.exports = {
  load,
  brands,
  models,
  findDevice,
  matchGames,
  chipSpec,
  turnipInfo,
  normDev,
};
