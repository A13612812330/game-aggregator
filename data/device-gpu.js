/**
 * device-gpu.js — 「机型 → GPU → SoC/CPU」精确映射
 *
 * ★ 为什么必须重做（v10.11 最重要的修正）：
 *   `device-match.js` 原先读的是**聚合版** `data/bannerhub.json` —— 那里的
 *   `dv`（机型）与 `gp`（GPU）是**两个互不相干的数组**，对应关系在聚合时就丢了。
 *   代码只好 `rec.gpu = gps[0]`，即 **把该游戏第一个 GPU 当成该机型的 GPU**。
 *   实测：2,631 款游戏里有 404 款 dv 与 gp 长度不同；**长度相同也不代表逐位对应** —— 纯瞎猜。
 *
 *   而 `data/bannerhub-files.json` 是**逐条配置**的原始形态：
 *     { "游戏名": [ [机型, GPU, 时间戳, 文件名], ... ] }
 *   机型与 GPU 在这里本来就是成对的。实测 14,467 条配置 → 1,429 个唯一机型，
 *   覆盖项目 1,039 个机型的 **95.6%**（抽查全对：SM F946B→Adreno 740 / SM S938B→Adreno 830 /
 *   Xiaomi 2304FPN6DG→Adreno 740 / Xiaomi 24115RA8EG→Adreno 810）。
 *
 * 链路：机型 →（配对数据）GPU →（gpu-soc 表）SoC →（device-board）CPU 描述
 */
const fs = require('fs');
const path = require('path');
const tier = require('./gpu-tier');
const gpuSoc = require('./gpu-soc');

const FILES = path.join(__dirname, 'bannerhub-files.json');
const BOARDS = path.join(__dirname, 'device-board.json');
const SOCDB = path.join(__dirname, 'soc-db.json');
const ALIAS = path.join(__dirname, 'device-alias.json');
const SOCCPU = path.join(__dirname, 'soc-cpu.json');

let idx = null;
let boards = null;
let socList = null;
let chipIdx = null;
let nameIdx = null;     // 归一化 SoC 名/型号 → 芯片条目（给「天玑9400」「Kirin 9010」这类别名兜底）
let gpuRevIdx = null;   // 归一化 GPU 型号 → [soc-db 芯片]，nanoreview 表没覆盖时的兜底
let aliasMap = null;    // 营销名 → 芯片编号（『小米15』→ sm8750）
let chipMarketMap = null; // 芯片编号 → 市场名（soc-db 里 id 不带市场名的补丁）
let socCpuMap = null;   // 归一化 SoC 名 → CPU 核簇描述（第四跳，nanoreview 抓的）
let mtime = 0;

/** 机型名归一化：小写、压空格（保留连字符与数字，它们是型号的一部分） */
function normDev(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();
}

/** 从任意字符串里抽出芯片编号（`TECNO LJ9 MT6897` → `mt6897`），取第一个 */
const CHIP_RE = /(?:^|[^a-z0-9])((?:sm|mt|msm|sdm)[-\s]?[0-9]{3,5}[a-z]{0,3})(?![a-z0-9])/gi;
function firstChip(s) {
  CHIP_RE.lastIndex = 0;
  const m = CHIP_RE.exec(String(s || ''));
  return m ? m[1].toLowerCase().replace(/[-\s]/g, '') : '';
}

/** soc-db 的 gpu 字段是长描述（`Adreno 830 1200 MHz (3686.4 GFLOPS in FP32)`），
 *  要剥成显卡型号（`Adreno 830`）才能和 gpu-tier / gpu-soc 的键对上。 */
function cleanGpu(s) {
  return String(s || '')
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s+\d[\d.]*\s*(?:mhz|ghz)/i)[0]
    .replace(/\s*@\s*.*$/, '')
    .replace(/\s+\d[\d.]*\s*gflops.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 这串东西到底像不像一个 GPU。
 *  ★ 社区配置库的 GPU 列混了不少脏值 —— `Q2 2022`（季度）、`turnip_v24.2.0_R22`（驱动名）、
 *    `MediaTek NPU 880` / `Spectra (200 MP Photo Capture…)`（非 GPU 单元）、
 *    `ANGLE Samsung Xclipse 540 on Vulkan 1 3 279`（渲染后端串）。
 *    不挡掉的话，这些机型会顶着一条假 GPU 显示「未知 SoC」，比直接说「未收录」更误导。 */
function isGpuLike(s) {
  const t = String(s || '').trim();
  if (!t || t.length > 48) return false;
  if (/^(q[1-4]\s*\d{4}|20\d\d年?)/i.test(t)) return false;          // Q2 2022 / 2023
  if (/vulkan|opengl|angle|turnip|driver|v?\d+\.\d+\.\d+_r\d+/i.test(t)) return false;
  if (/npu|\bdsp\b|spectra|modem|isp\b|camera|photo capture/i.test(t)) return false;
  return /adreno|mali|immortalis|powervr|power vr|xclipse|apple\s*gpu|radeon|geforce|\barc\b|videocore|sgx|g[0-9]{3}\b/i.test(t);
}

/** soc-db → 反向索引：归一化 GPU 型号 → 芯片列表（补 nanoreview 表的空） */
function buildGpuRev(list) {
  const map = new Map();
  for (const c of list || []) {
    if (!c) continue;
    const gpu = cleanGpu(c.gpu);
    if (!gpu || !isGpuLike(gpu)) continue;
    const k = gpuSoc.modelOf(gpu);          // 丢核心数，`mali g615 mc6` → `mali g615`
    if (!k) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push({
      model: c.model || c.name || '',
      vendor: c.vendor || '',
      gpu,
      arch: c.arch || '',
      cores: c.cores || 0,
      process: c.process_nm || null,
      year: c.year || null,
    });
  }
  return map;
}

/** 市场名优先（`Dimensity 8450 (MT6899Z_D/ZA)` → `Dimensity 8450`；
 *  `Helio G100 MT6789H MT6789I MT6789J` → `Helio G100`）；
 *  纯编号（`SM7325`）也认，但没有市场名时宁可显示编号 —— 编号是可核验的。 */
const MARKET_RE = /dimensity|snapdragon|helio|exynos|tensor|kirin|unisoc|tiger|kompanio|ryzen|celeron|pentium|atom|apple\s*[am]\d+/i;
function pickName(model) {
  const head = String(model || '').split('(')[0].trim();
  const cut = head.split(/\s+(?=(?:sm|mt|msm|sdm)[0-9]{3,5}[a-z]*$)/i)[0].trim();
  return cut || head;
}

/** 从 soc-db 的 id 里抠出市场名。
 *  ★ 为什么需要：一个 GPU 往往被一整个系列共用（`Mali-G720` → 8350/8400/8450/8500/9400e），
 *    `socOf(gpu)` 只能取 nanoreview 排第一的那个 → `MT6897` 会被标成「Dimensity 9400e」。
 *    而 soc-db 的 id 里其实写着真身：`dimensity_8350_mt6897_mt6897z_bza_mt8792zna`。
 *  规则：按 `_` 切开，丢掉厂商前缀，累积令牌直到撞上芯片编号（mt/sm/msm/sdm+数字）。 */
const ID_VENDOR = /^(samsung|qualcomm|mediatek|hisilicon|huawei|google|unisoc|apple|xiaomi|intel|amd|nvidia|broadcom|marvell|rockchip|allwinner|amlogic|spreadtrum|zhaoxin)$/i;
const ID_CODE = /^(?:sm|mt|msm|sdm|apq|msm)\d/i;
function marketFromId(id) {
  const toks = String(id || '').toLowerCase().split(/[_\-]+/).filter(Boolean);
  while (toks.length && ID_VENDOR.test(toks[0])) toks.shift();
  const out = [];
  for (const t of toks) {
    if (ID_CODE.test(t)) break;
    if (/^\d+$/.test(t) && out.length === 0) break;   // 一上来就是纯数字，不像市场名
    out.push(t);
    if (out.length >= 5) break;
  }
  if (out.length < 2) return '';
  const name = out.join(' ').replace(/\b([a-z])/g, (s) => s.toUpperCase());
  if (!/\d/.test(name)) return '';                   // 「Snapdragon」这种只有品牌没型号的，丢掉
  if (!MARKET_RE.test(name)) return '';
  return name;
}

/** soc-db 直接给一条 SoC（GPU 未知时用）：至少能告诉用户「这是什么芯」 */
function socFromChip(c) {
  const n = pickName(c.name);
  if (!n) return null;
  return {
    name: n,
    vendor: c.vendor || '',
    others: [],
    count: 0,
    exact: false,
    arch: c.arch || '',
    cores: c.cores || 0,
    process: c.process || null,
    from: 'chipdb',
  };
}

/** GPU → SoC 兜底（只查本地 soc-db，不联网）。
 *  命中多条时取「有市场名 + 有架构/核数」的那条，避免 `Q3 2023` 这类脏记录胜出。 */
function socRevOf(gpu) {
  if (!gpuRevIdx || !gpuRevIdx.size) return null;
  const k = gpuSoc.modelOf(gpu);
  if (!k) return null;
  let list = gpuRevIdx.get(k);
  if (!list) {
    /* 再退一步：前缀匹配（`adreno 642l` ⊃ `adreno 642`），但要求候选唯一，避免张冠李戴 */
    const pref = [...gpuRevIdx.entries()].filter(([kk]) => kk.startsWith(k) || k.startsWith(kk));
    if (pref.length === 1) list = pref[0][1];
  }
  if (!list || !list.length) return null;
  const score = (c) =>
    (MARKET_RE.test(c.model) ? 4 : 0) + (c.arch ? 2 : 0) + (c.cores ? 1 : 0) + (c.process ? 1 : 0);
  const best = [...list].sort((a, b) => score(b) - score(a))[0];
  return {
    name: pickName(best.model),
    vendor: best.vendor,
    others: list.filter((c) => c !== best).map((c) => pickName(c.model)),
    count: list.length,
    exact: false,
    arch: best.arch,
    cores: best.cores,
    process: best.process,
    year: best.year,
    from: 'socdb',
  };
}

/** 芯片编号的「基号」：`mt6789h` → `mt6789`。
 *  soc-db 里同一颗芯片常有多条记录，带后缀的那条才有正经 GPU —— 例如
 *  `MT6789`（GPU 字段是脏值 `Q2 2022`）与 `Helio G100 MT6789H/I/J`（Mali-G68）。
 *  所以既建精确键，也建基号键，查的时候先精确、再退基号。 */
function baseChip(n) {
  return String(n || '').replace(/^((?:sm|mt|msm|sdm)[0-9]{3,5})[a-z]{1,3}$/, '$1');
}

/** soc-db（1444 款芯片）→ 芯片编号索引。
 *  机型名里常直接写着芯片编号（`N49 SM8650` / `TECNO LJ9 MT6897`），
 *  这条路径**完全离线**，用来兜住「没有配对 GPU 记录」的机型。 */
function buildChipIndex(list) {
  const map = new Map();
  const put = (k, rec) => {
    const prev = map.get(k);
    if (!prev || rec._score > prev._score) map.set(k, rec);
  };
  for (const c of list || []) {
    if (!c) continue;
    const rawGpu = cleanGpu(c.gpu);
    const gpu = isGpuLike(rawGpu) ? rawGpu : '';       // 脏 GPU 宁可留空，也不能当型号显示
    const mk = (chip) => ({
      chip,
      id: c.id || '',
      model: c.model || '',
      name: c.model || c.name || chip,
      vendor: c.vendor || '',
      gpu,
      arch: c.arch || '',
      cores: c.cores || 0,
      clockMax: c.clock_max || null,
      process: c.process_nm || null,
      year: c.year || null,
      _score: (gpu ? 8 : 0) + (c.arch ? 2 : 0) + (c.cores ? 1 : 0) + (c.year ? 1 : 0),
    });
    const nums = new Set();
    for (const f of [c.id, c.name, c.model]) {
      const s = String(f || '');
      const re = new RegExp(CHIP_RE.source, 'gi');
      let m;
      while ((m = re.exec(s))) nums.add(m[1].toLowerCase().replace(/[-\s]/g, ''));
    }
    for (const n of nums) {
      put(n, mk(n));                       // 精确键（可能带后缀）
      const b = baseChip(n);
      if (b !== n) put(b, mk(b));          // 基号键
    }
  }
  return map;
}

/** 芯片名归一化（找「天玑9400 / Dimensity 9400」这类名字用） */
function normLabel(s) {
  return String(s || '').toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** soc-db → 名字索引：归一化型号/名 → 芯片条目（优先有 GPU 的）
 *  用途：别名表里写的如果不是 SM/MT 编号（如 `kirin 9010` / `exynos 2400`），
 *  还能按名字回到 soc-db 拿 GPU 与核簇信息。 */
function buildNameIndex(list) {
  const map = new Map();
  const put = (k, rec) => {
    if (!k) return;
    const prev = map.get(k);
    if (!prev || rec._score > prev._score) map.set(k, rec);
  };
  for (const c of list || []) {
    if (!c) continue;
    const rawGpu = cleanGpu(c.gpu);
    const gpu = isGpuLike(rawGpu) ? rawGpu : '';
    let first = '';
    for (const f of [c.id, c.name, c.model]) {
      const re = new RegExp(CHIP_RE.source, 'gi');
      const m = re.exec(String(f || ''));
      if (m) { first = m[1].toLowerCase().replace(/[-\s]/g, ''); break; }
    }
    const rec = {
      chip: baseChip(first),
      id: c.id || '',
      model: c.model || '',
      name: c.model || c.name || '',
      vendor: c.vendor || '',
      gpu,
      arch: c.arch || '',
      cores: c.cores || 0,
      process: c.process_nm || null,
      year: c.year || null,
      _score: (gpu ? 8 : 0) + (c.arch ? 2 : 0) + (c.cores ? 1 : 0) + (c.year ? 1 : 0),
    };
    put(normLabel(c.model), rec);
    put(normLabel(c.name), rec);
  }
  return map;
}

/** 机型名 → 芯片规格（无 GPU 配对记录时的兜底）。
 *  精确键查不到就退到基号键：`SM8750P` → `SM8750`（soc-db 里只登记了后者）。 */
function chipSpec(name) {
  load();
  if (!chipIdx || !chipIdx.size) return null;
  const key = firstChip(name);
  if (!key) return null;
  const hit = chipIdx.get(key);
  if (hit) return hit;
  const b = baseChip(key);
  return b !== key ? (chipIdx.get(b) || null) : null;
}

/** 营销名 → 芯片编号（『红米 K80 Pro』→ sm8750）。
 *  社区库只认编号式机型名，别名表补上用户真正会输入的那一半。 */
function aliasChip(name) {
  load();
  if (!aliasMap || !aliasMap.size || !name) return '';
  const base = String(name).toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const cands = [base];
  const noSpace = base.replace(/\s+/g, '');
  if (noSpace !== base) cands.push(noSpace);
  /* 中英品牌名互转 + 去掉「手机 / 5g / 版」等尾缀 */
  const twins = [];
  for (const c of cands.slice()) {
    twins.push(c.replace(/红米/g, 'redmi').replace(/荣耀/g, 'honor'));
    twins.push(c.replace(/redmi/g, '红米').replace(/honor/g, '荣耀'));
    twins.push(c.replace(/\s*(5g|4g|手机|国行|全网通|版)$/g, '').trim());
  }
  for (const c of cands.concat(twins)) {
    if (c && aliasMap.has(c)) return aliasMap.get(c);
  }
  return '';
}

/** 别名 → 规格。别名值两种写法：
 *  ① 芯片编号（`sm8750`）—— 走 soc-db 编号索引；
 *  ② nanoreview 的 SoC 名（`Snapdragon 8s Gen 3` / `Dimensity 8400`）——
 *     用于 soc-db 那几条 GPU 字段是脏值（`Spectra…` / `Hexagon` / `MediaTek NPU 880`）的芯片，
 *     直接取权威 GPU，避免拿错档位。 */
function aliasSpec(name) {
  load();
  const code = aliasChip(name);
  if (!code) return null;

  /* ① 芯片编号 */
  const byNum = chipSpec(code);
  if (byNum) return specFromChipObj(byNum, name, { src: 'alias', aliasChip: code });

  /* ② nanoreview SoC 名：拿 GPU → 档位分 / 厂商 / 正式名 */
  const nv = gpuSoc.socByName(code);
  if (nv) {
    const sc = tier.gpuScore(nv.gpu);
    const byName = nameIdx && nameIdx.get(normLabel(code));
    return {
      model: String(name).trim(),
      gpu: nv.gpu,
      gpuHits: 0, gpuTotal: 0, gpuVariants: 0,
      gpuScore: sc ? sc.score : null,
      soc: nv.name,
      socVendor: nv.vendor || '',
      socOthers: [], socCount: 1, socExact: true, socFrom: 'nanoreview',
      cpu: cpuOf(nv.name),
      arch: (byName && byName.arch) || '',
      cores: (byName && byName.cores) || 0,
      reports: 0,
      src: 'alias', aliasChip: code,
    };
  }

  /* ③ 只剩名字（`tensor g4` / `kirin 9020` 这类两表都没收录的） */
  const byName = nameIdx && nameIdx.get(normLabel(code));
  if (byName) return specFromChipObj(byName, name, { src: 'alias', aliasChip: code });

  const vendor = /^sm|snapdragon|qualcomm/i.test(code) ? 'Qualcomm'
    : /^mt|dimensity|helio/i.test(code) ? 'MediaTek'
      : /kirin|hisilicon/i.test(code) ? 'HiSilicon'
        : /tensor/i.test(code) ? 'Google'
          : /exynos/i.test(code) ? 'Samsung' : '';
  return {
    model: String(name).trim(),
    gpu: '',
    gpuHits: 0, gpuTotal: 0, gpuVariants: 0, gpuScore: null,
    soc: pickName(code),
    socVendor: vendor,
    socOthers: [], socCount: 0, socExact: false, socFrom: 'alias',
    cpu: cpuOf(pickName(code)),
    arch: '', cores: 0, reports: 0,
    src: 'alias', aliasChip: code,
  };
}

/** SoC 名归一化（用于与 device-board 的 soc 字段对齐）：只留型号主干 */
function normSoc(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\(mt\d+[a-z]*\)|\(sm\d+[a-z-]*\)/g, '')
    .replace(/\b(qualcomm|mediatek|samsung|hisilicon|unisoc|google|apple)\b/g, '')
    .replace(/\s*(plus|max|ultra)\b/g, ' $1')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function load() {
  const st = fs.statSync(FILES);
  if (idx && st.mtimeMs === mtime) return idx;

  const raw = JSON.parse(fs.readFileSync(FILES, 'utf8'));
  const byDev = new Map();
  let rows = 0;

  for (const game of Object.keys(raw)) {
    for (const r of raw[game] || []) {
      rows++;
      const dev = String((r && r[0]) || '').trim();
      const gpu = String((r && r[1]) || '').trim();
      if (!dev) continue;
      const k = normDev(dev);
      let rec = byDev.get(k);
      if (!rec) { rec = { label: dev, reports: 0, gpus: new Map(), noise: 0 }; byDev.set(k, rec); }
      rec.reports++;
      if (gpu && isGpuLike(gpu)) rec.gpus.set(gpu, (rec.gpus.get(gpu) || 0) + 1);
      else if (gpu) rec.noise++;   // 脏值单独计数，不参与「主 GPU」投票
    }
  }

  /* device-board：主板代号 → {soc, cpu}，用于补 CPU 描述；
     同时把它的 board 名也当作一种「机型名」登记（有些机型名就是主板代号） */
  boards = [];
  try {
    const bd = JSON.parse(fs.readFileSync(BOARDS, 'utf8'));
    boards = Object.values(bd.boards || {});
  } catch (e) {
    if (e && e.code !== 'ENOENT') console.error('[device-gpu] 主板库加载失败:', e.message);
  }

  /* soc-db：1444 款芯片规格。用途是**从机型名里的芯片编号反查** ——
     像 `N49 SM8650` / `TECNO LJ9 MT6897` 这种，名字里就写着芯片，不必联网。 */
  socList = [];
  try {
    const sd = JSON.parse(fs.readFileSync(SOCDB, 'utf8'));
    socList = sd.chips || [];
  } catch (e) {
    if (e && e.code !== 'ENOENT') console.error('[device-gpu] soc-db 加载失败:', e.message);
  }
  chipIdx = buildChipIndex(socList);
  nameIdx = buildNameIndex(socList);
  gpuRevIdx = buildGpuRev(socList);

  /* 营销名别名表（人工维护，见文件内 note）。
     顺带收下 `chipMarket`：芯片编号 → 市场名，补 soc-db 里 id 不带市场名的那几个
     （`snapdragon_sm7325`，对应 Snapdragon 778G）。 */
  aliasMap = new Map();
  chipMarketMap = new Map();
  try {
    const al = JSON.parse(fs.readFileSync(ALIAS, 'utf8'));
    for (const [k, v] of Object.entries(al.map || {})) {
      aliasMap.set(String(k).toLowerCase().replace(/\s+/g, ' ').trim(), v);
    }
    for (const [k, v] of Object.entries(al.chipMarket || {})) {
      if (k.startsWith('_')) continue;
      chipMarketMap.set(String(k).toLowerCase().replace(/[-\s]/g, ''), v);
    }
  } catch (e) {
    if (e && e.code !== 'ENOENT') console.error('[device-gpu] 别名表加载失败:', e.message);
  }

  /* SoC → CPU 核簇描述（tools/fetch-soc-cpu.js 从 nanoreview 抓的，第四跳兜底）。
     ★ 为什么必须有这一层：device-board.json **只有 200 条主板**，对库内 66 个 SoC
       只命中 1 个 → 实测 967 台机型「有 SoC 无 CPU」，CPU 覆盖率是 0%。 */
  socCpuMap = new Map();
  try {
    const sc = JSON.parse(fs.readFileSync(SOCCPU, 'utf8'));
    for (const [k, v] of Object.entries(sc.map || {})) {
      const key = normLabel(k);
      if (key) socCpuMap.set(key, v);
    }
  } catch (e) {
    if (e && e.code !== 'ENOENT') console.error('[device-gpu] soc-cpu 表加载失败:', e.message);
  }

  idx = { byDev, rows, builtFrom: path.basename(FILES) };
  mtime = st.mtimeMs;
  console.log(`[device-gpu] 配对索引 ${byDev.size} 个机型（来自 ${rows} 条配置）`);
  return idx;
}

/** 从 device-board / soc-cpu 补 CPU 描述，统一压成紧凑句式。
 *  ★ 优先级：soc-cpu.json（nanoreview，246 个 SoC，句式统一无脏值）
 *          → device-board.json（只有 200 条主板，且实测有脏值：
 *            Tensor G4 写成 `@ 31.GHz`、Kirin 659 写成不存在的 `Cortex-A54`）。
 *  用户要的是「机型对应的 cpu 等配置」，所以这一跳必须有，且不能给脏值。 */
function cpuOf(socName) {
  if (!socName) return null;
  const fromSoc = socCpuOf(socName);
  if (fromSoc) return fmtCpu(fromSoc);

  const k = normSoc(socName);
  if (!k || !boards || !boards.length) return null;
  let best = null;
  for (const b of boards) {
    if (!b || !b.soc || !b.cpu) continue;
    const bk = normSoc(b.soc);
    if (!bk) continue;
    if (bk === k) return fmtCpu(b.cpu);
    if (bk.includes(k) || k.includes(bk)) {
      if (!best || bk.length > normSoc(best.soc).length) best = b;
    }
  }
  return best ? fmtCpu(best.cpu) : null;
}

/** CPU 核簇句式归一化。
 *  nanoreview：`1 core Cortex-X925 at 3620 MHz, 3 cores Cortex-X4 at 3300 MHz, ...`
 *  device-board：`1x Cortex-X925 @ 3.6GHz 3x Cortex-X4 @ 3.3GHz ...`
 *  两者都压成：`1×Cortex-X925 @3.62GHz · 3×Cortex-X4 @3.3GHz · 4×Cortex-A720 @2.4GHz` */
const CPU_SPEC_RE = /(\d+)\s*(?:cores?|x|×)\s*([A-Za-z0-9][A-Za-z0-9 ().+\-]*?)\s*(?:@|at)\s*([\d.]+)\s*(MHz|GHz)/gi;
function fmtCpu(raw) {
  const t = String(raw || '').trim();
  if (!t || t === '-') return '';
  const parts = [];
  CPU_SPEC_RE.lastIndex = 0;
  let m;
  while ((m = CPU_SPEC_RE.exec(t))) {
    const n = m[1];
    const name = m[2].trim();
    let v = Number(m[3]);
    if (!isFinite(v) || v <= 0) continue;
    if (/^mhz$/i.test(m[4])) v = v / 1000;
    const ghz = String(Number(v.toFixed(2)));
    if (!name) continue;
    parts.push(`${n}×${name} @${ghz}GHz`);
  }
  return parts.length ? parts.join(' · ') : t;
}

/** soc-cpu.json 查表：精确 → 去厂商前缀 → 包含（取最长且长度接近的） */
function socCpuOf(socName) {
  if (!socCpuMap || !socCpuMap.size) return null;
  const VENDOR = /\b(qualcomm|mediatek|samsung|hisilicon|huawei|unisoc|google|apple|xiaomi|amd|intel)\b/g;

  const keys = [];
  const k0 = normLabel(socName);
  if (k0) keys.push(k0);
  const k1 = normLabel(String(socName).replace(VENDOR, ' '));
  if (k1 && k1 !== k0) keys.push(k1);

  for (const k of keys) {
    const hit = socCpuMap.get(k);
    if (hit && hit.cpu) return hit.cpu;
  }

  let best = null, bestKey = '';
  for (const [kk, v] of socCpuMap) {
    if (!v || !v.cpu) continue;
    for (const k of keys) {
      if (!k || k.length < 6) continue;
      const inc = kk.includes(k) || k.includes(kk);
      if (!inc) continue;
      /* 长度差距太大就不是同一颗（`snapdragon 8 elite` ⊄ `snapdragon 8 gen 2` 靠这条挡） */
      const ratio = Math.min(kk.length, k.length) / Math.max(kk.length, k.length);
      if (ratio < 0.62) continue;
      if (!best || kk.length > bestKey.length) { best = v; bestKey = kk; }
    }
  }
  return best ? best.cpu : null;
}

/** 主 GPU：该机型报告数最多的那个（实测 1,429 个机型里只有 23 个 GPU 不唯一） */
function primaryGpu(rec) {
  let best = '', n = -1;
  for (const [gpu, c] of rec.gpus) if (c > n) { n = c; best = gpu; }
  return { gpu: best, hits: n };
}

/** 一个 GPU 常被多款 SoC 共用（`Mali-G715` → 天玑9200 / Tensor G3 / G4），
 *  nanoreview 列表按性能序，取首个就会给 Pixel 标成「天玑9200 Plus」。
 *  这里按机型名里的线索纠正代表 SoC —— 名字里写着 Pixel 就用 Tensor，写着麒麟就用 Kirin。 */
function pickSoc(soc, label) {
  if (!soc || !soc.name) return soc;
  const L = String(label || '').toLowerCase();
  const hints = [];
  if (/pixel|google|tensor/.test(L)) hints.push(/tensor/i);
  if (/麒麟|kirin/.test(L)) hints.push(/kirin/i);
  if (/天玑|dimensity/.test(L)) hints.push(/dimensity/i);
  if (/骁龙|snapdragon/.test(L)) hints.push(/snapdragon/i);
  if (/exynos/.test(L)) hints.push(/exynos/i);
  if (/xring|玄戒/.test(L)) hints.push(/xring|玄戒/i);
  const cands = [soc.name].concat(soc.others || []);

  const swap = (hit) => {
    if (hit === soc.name) return soc;
    const meta = gpuSoc.socByName(hit);
    return Object.assign({}, soc, {
      name: hit,
      vendor: (meta && meta.vendor) || soc.vendor,
      others: cands.filter((c) => c !== hit),
      exact: false,
      switched: true,
    });
  };

  /* ① 别名表给的型号最具体（`Google Pixel 8` → `Tensor G3`，比「Tensor 家族里第一个」准） */
  const an = aliasChip(label);
  if (an) {
    const hit = cands.find((c) => gpuSoc.normName(c) === gpuSoc.normName(an));
    if (hit) return swap(hit);
  }
  /* ② 再看机型名里的品牌线索 */
  if (!hints.length) return soc;
  for (const re of hints) {
    const hit = cands.find((c) => re.test(c));
    if (hit) return swap(hit);
  }
  return soc;
}

/** 组装一条机型规格 */
function build(label, rec, extra) {
  const { gpu, hits } = primaryGpu(rec);
  /* SoC 两级：nanoreview 表（市场名权威）→ 本地 soc-db 反查（`Adreno 642L` → SM7325 这种表里没有的） */
  const soc = upgradeSoc(gpu ? pickSoc(gpuSoc.socOf(gpu) || socRevOf(gpu), label) : null);
  const sc = gpu ? tier.gpuScore(gpu) : null;
  return Object.assign({
    model: label,
    gpu,
    gpuHits: hits,
    gpuTotal: [...rec.gpus.values()].reduce((a, b) => a + b, 0),
    gpuVariants: rec.gpus.size,
    gpuScore: sc ? sc.score : null,
    soc: soc ? soc.name : '',
    socVendor: soc ? soc.vendor : '',
    socOthers: soc ? soc.others : [],
    socCount: soc ? soc.count : 0,
    socExact: soc ? !!soc.exact : false,
    socFrom: soc ? (soc.from || 'nanoreview') : '',
    cpu: soc ? cpuOf(soc.name) : null,
    arch: soc && soc.arch ? soc.arch : '',
    cores: soc && soc.cores ? soc.cores : 0,
    reports: rec.reports,
    noise: rec.noise || 0,
  }, extra || {});
}

/** soc-db 反查出来的名字往往是**裸芯片编号**（`SM7325`），既不像 SoC 名、也查不到 CPU。
 *  拿 chipMarket 表把它升格成市场名（`Snapdragon 778G`），顺带拿到 GPU 与档位。 */
function upgradeSoc(soc) {
  if (!soc || !soc.name) return soc;
  if (!chipMarketMap || !chipMarketMap.size) return soc;
  const code = String(soc.name).toLowerCase().replace(/[-\s]/g, '');
  if (!/^(?:sm|mt|msm|sdm)\d{3,5}[a-z]{0,3}$/.test(code)) return soc;
  const market = chipMarketMap.get(code);
  if (!market) return soc;
  const nv = gpuSoc.socByName(market);
  if (!nv) return soc;
  return {
    name: nv.name || market,
    vendor: nv.vendor || soc.vendor || '',
    others: soc.others || [],
    count: 0,
    exact: false,
    arch: soc.arch || '',
    cores: soc.cores || 0,
    process: soc.process || null,
    from: 'chipmarket',
    upgradedFrom: soc.name,
  };
}

/** 机型名里的芯片规格 → 统一规格对象（chipdb 路径） */
function specFromChipObj(c, label, extra) {
  /* ★ 先认 soc-db 的 id 里的市场名（`dimensity_8350_mt6897…`），
     它比「拿 GPU 去反查」精确 —— 同款 GPU 被一整个系列共用，反查只能取排名第一的那个。 */
  const market = marketFromId(c.id) || (chipMarketMap ? (chipMarketMap.get(c.chip) || '') : '');
  const byMarket = market ? gpuSoc.socByName(market) : null;
  const soc = byMarket || upgradeSoc(c.gpu ? pickSoc(gpuSoc.socOf(c.gpu) || socRevOf(c.gpu), label) : socFromChip(c));
  const sc = c.gpu ? tier.gpuScore(c.gpu) : null;
  return Object.assign({
    model: String(label).trim(),
    gpu: c.gpu,
    gpuHits: 0,
    gpuTotal: 0,
    gpuVariants: 0,
    gpuScore: sc ? sc.score : null,
    soc: soc ? soc.name : '',
    socVendor: soc ? soc.vendor : (c.vendor || ''),
    socOthers: soc ? soc.others : [],
    socCount: soc ? soc.count : 0,
    socExact: soc ? !!soc.exact : false,
    socFrom: soc ? (soc.from || 'nanoreview') : '',
    cpu: soc ? cpuOf(soc.name) : null,
    arch: (soc && soc.arch) || c.arch || '',
    cores: (soc && soc.cores) || c.cores || 0,
    reports: 0,
    src: 'chipdb',
    chip: c.chip || '',
    chipName: c.name,
    chipArch: c.arch,
    chipCores: c.cores,
    chipYear: c.year,
  }, extra || {});
}

/** 用「机型名里的芯片编号」组装一条规格（离线兜底路径，src='chipdb'） */
function buildFromChip(name) {
  const c = chipSpec(name);
  return c ? specFromChipObj(c, name) : null;
}

/** 查一台机型的规格：精确 → 包含（优先长名）→ 去品牌前缀 → 芯片编号兜底
 *  ★ 只有**带 GPU** 的配对结果才算数 —— 配对表里存在 gpu 为空的记录，
 *    直接返回会让「TECNO LJ9 MT6897」这种名字里明明写着芯片的机型反而查不到。 */
function specOf(name) {
  load();
  if (!name) return null;
  const k = normDev(name);
  let paired = null;

  if (idx.byDev.has(k)) paired = build(idx.byDev.get(k).label, idx.byDev.get(k));
  if (paired && paired.gpu) return paired;

  /* 别名优先于「模糊配对」：模糊配对容易把 `Google Pixel 9` 认成 `Google Pixel 9 Pro`，
     而别名表对营销名是精确命中的，可信度更高。 */
  const al = aliasSpec(name);
  if (al && (al.gpu || al.soc)) return al;

  if (!paired || !paired.gpu) {
    const hits = [...idx.byDev.entries()]
      .filter(([kk]) => kk.includes(k) || k.includes(kk))
      .sort((a, b) => b[0].length - a[0].length);
    if (hits.length) paired = build(hits[0][1].label, hits[0][1], { fuzzy: true });
  }

  if (!paired || !paired.gpu) {
    const stripped = k.replace(/^(xiaomi|samsung|sm|redmi|poco|moto|motorola|nubia|oppo|vivo|oneplus|realme|honor|huawei|asus|lenovo|tecno|infinix|itel|google|nothing|zte)\s*/i, '');
    if (stripped && stripped !== k) {
      const h2 = [...idx.byDev.entries()]
        .filter(([kk]) => kk.includes(stripped))
        .sort((a, b) => b[0].length - a[0].length);
      if (h2.length) {
        const cand = build(h2[0][1].label, h2[0][1], { fuzzy: true });
        if (cand.gpu) paired = cand;
      }
    }
  }

  if (paired && paired.gpu) return paired;

  /* 最后一跳：名字里带着 SM/MT 编号的，直接查 soc-db（零联网） */
  return buildFromChip(name) || paired || null;
}

function stats() {
  load();
  let withGpu = 0;
  let noise = 0;
  for (const [, rec] of idx.byDev) { if (rec.gpus.size) withGpu++; noise += rec.noise || 0; }
  return {
    devices: idx.byDev.size,
    withGpu,
    noisyReports: noise,
    rows: idx.rows,
    chips: chipIdx ? chipIdx.size : 0,
    gpuModels: gpuRevIdx ? gpuRevIdx.size : 0,
    builtFrom: idx.builtFrom,
  };
}

module.exports = { specOf, stats, normDev, normSoc, cpuOf, fmtCpu, chipSpec, socRevOf, aliasSpec, aliasChip, isGpuLike, firstChip, load };
