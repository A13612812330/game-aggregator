/**
 * gpu-soc.js — 「GPU → SoC / CPU」映射查询
 *
 * 为什么需要这张表：
 *   机型库只给到 **GPU 名**（`Adreno 830` / `Mali-G615 MC6`），
 *   而用户要看的是「这台机器是什么 CPU」。这中间差一跳，必须显式建表。
 *   ★ 不要指望 soc-db 反查 —— 实测只有 43% 命中且歧义严重：
 *     `Adreno 619` → SM6350I / **MSM7225AB**（后者是 2008 年的老芯片，明显错），
 *     而高频的 `Mali-G57 MC2`/`G52 MC2`/`G720 MC7`/`G615 MC6` 全部反查不到。
 *
 * 数据来源：`data/gpu-soc.json`，由 `tools/fetch-soc-map.js` 从
 *   https://nanoreview.net/en/soc-list/rating （page 1..2，246 条 SoC / 212 条带 GPU）抓取生成。
 *   实测覆盖 bannerhub 记录数的 **82.5%（精确命中）/ 92.9%（含型号退化）**。
 *
 * ★ MP ≡ MC：nanoreview 写 `Mali-G925 MP12`，社区库写 `Mali-G720 MC7` —— 都指核心数。
 *   不归一化的话 **Mali 系会一条都匹配不上**（而 Mali 占高频记录的 46.8%）。
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'gpu-soc.json');
let cache = null;
let mtime = 0;

/** GPU 名归一化：MP↔MC 等价、去 (TM)/(8 CUs) 注记、压平空白标点 */
function normGpuKey(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/\((?:tm|r)\)|™|®/g, '')
    .replace(/\bmp\s*(\d+)/g, 'mc$1')
    .replace(/\bmc\s*(\d+)/g, 'mc$1')
    .replace(/\(\s*\d+\s*cus?\s*\)/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** 只保留型号、丢掉核心数（`mali g615 mc6` → `mali g615`），用于退化匹配 */
function modelOf(s) {
  return normGpuKey(s).replace(/\s*mc\d+$/, '').trim();
}

function load() {
  try {
    const st = fs.statSync(FILE);
    if (cache && st.mtimeMs === mtime) return cache;
    cache = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    mtime = st.mtimeMs;
    return cache;
  } catch (e) {
    /* 非 ENOENT 也要出声：静默吞错会让「映射表空了」表现成「所有机型都没 CPU」，
       极难排查（v10.8 在 gamesDb 上踩过一次）。 */
    if (e && e.code !== 'ENOENT') console.error('[gpu-soc] 映射表加载失败:', e.message);
    cache = cache || { builtAt: 0, byGpu: {}, byModel: {}, list: [] };
    return cache;
  }
}

/** GPU → 该 GPU 对应的所有 SoC（按收录顺序）。
 *  一个 GPU 被多款 SoC 用是常态（如 `Mali-G615 MC6` → 天玑 8300/8350），
 *  所以返回数组，由调用方决定怎么展示。 */
function socsOf(gpu) {
  const d = load();
  const k = normGpuKey(gpu);
  if (!k) return [];
  const hit = (d.byGpu || {})[k];
  if (hit && hit.length) return hit;
  // 退化：同型号（丢核心数）
  const m = modelOf(gpu);
  const byModel = (d.byModel || {})[m];
  return byModel && byModel.length ? byModel : [];
}

/** GPU → 单个「代表 SoC」。取首个（列表按性能序，同 GPU 内性能相近，取谁都等价），
 *  同时给出候选总数，便于前端展示「等 N 款同档 SoC」。 */
function socOf(gpu) {
  const list = socsOf(gpu);
  if (!list.length) return null;
  const first = list[0];
  return {
    name: first.name,
    vendor: first.vendor,
    others: list.slice(1).map((x) => x.name),
    count: list.length,
    exact: !!(load().byGpu || {})[normGpuKey(gpu)],
  };
}

/** SoC 名归一化（查「天玑9400 / Dimensity 9400」这类名字用） */
function normName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

let nameIdx = null;
let nameIdxMtime = 0;

/** SoC 名 → 该 SoC 的记录（含 gpu / vendor）。给「按 SoC 名写死的别名表」解析用。 */
function socByName(name) {
  const d = load();
  const k = normName(name);
  if (!k) return null;
  if (!nameIdx || nameIdxMtime !== mtime) {
    nameIdx = new Map();
    for (const it of d.list || []) {
      const nk = normName(it.name);
      if (!nk || !it.gpu) continue;
      const prev = nameIdx.get(nk);
      /* 重名取「更完整」的一条（有 url 优先，其次 GPU 描述更长） */
      if (!prev || String(it.gpu).length > String(prev.gpu).length) nameIdx.set(nk, it);
    }
    /* byGpu 里的名字也补进来（list 偶有重名折叠） */
    for (const arr of Object.values(d.byGpu || {})) {
      for (const it of arr) {
        const nk = normName(it.name);
        if (nk && it.gpu && !nameIdx.has(nk)) nameIdx.set(nk, it);
      }
    }
    nameIdxMtime = mtime;
  }
  return nameIdx.get(k) || null;
}

function stats() {
  const d = load();
  return {
    builtAt: d.builtAt || 0,
    source: d.source || '',
    socs: (d.list || []).length,
    gpuKeys: Object.keys(d.byGpu || {}).length,
    gpuModels: Object.keys(d.byModel || {}).length,
  };
}

module.exports = { normGpuKey, modelOf, socsOf, socOf, socByName, normName, stats, load };
