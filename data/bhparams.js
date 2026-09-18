/**
 * data/bhparams.js — BannerHub 社区配置的「逐条游玩参数」（v10.13 新增）
 *
 * ★ 为什么要有这一层：
 *   详情抽屉里原本只列出 [机型 | GPU | 上传日期 | 下载 JSON]。
 *   用户真正想抄的东西（**这一台机器上到底跑了什么**）全在那份 JSON 里 ——
 *   等于告诉你「答案在附件中」。用户反馈「游玩配置看不到了」，指的就是这个。
 *
 *   这一层把仓库里的配置 JSON 拉下来、解析成结构化参数，直接铺在页面/面板上：
 *     驱动（Turnip 版本）/ DXVK / VKD3D / 容器（Proton/Wine）/ 翻译层（Box64 / FEX 预设）
 *     / 分辨率 / 内存上限 / CPU 核心限制 / 音频驱动 / 振动 等
 *
 * ★ 数据通路：
 *   data/bannerhub-files.json（仓库文件清单，本地已有 14,467 条）
 *     → 取该游戏**最近 N 份**配置
 *     → 拉 raw.githubusercontent.com 上的配置 JSON（并发 4、单条 12s 超时）
 *     → 解析 → 写磁盘缓存 data/bhparams.json（TTL 7 天，避免每次开抽屉都打网络）
 *
 * ★ 为什么按「最近」取：社区配置是玩家各自导出的，同一游戏可能有 2773 份。
 *   逐份解析既慢也没意义，最新的几份最能代表当前驱动生态。
 */
const fs = require('fs');
const path = require('path');
const bannerhub = require('./bannerhub');

const CACHE = path.join(__dirname, 'bhparams.json');
const TTL = 7 * 864e5;      // 7 天
const CONC = 4;             // 并发抓取数
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

let cache = null;
let dirty = false;
let flushTimer = null;

function ensureCache() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch (e) { cache = {}; }
  return cache;
}
function flush(force) {
  if (!dirty) return;
  const write = () => {
    flushTimer = null;
    if (!dirty || !cache) return;
    dirty = false;
    try { fs.writeFileSync(CACHE, JSON.stringify(cache)); } catch (e) { /* 只读盘也允许 */ }
  };
  if (force) return write();
  if (flushTimer) return;
  flushTimer = setTimeout(write, 3000);
  if (flushTimer.unref) flushTimer.unref();
}
process.on('exit', () => flush(true));

/* ---------------- 解析单份配置 JSON ---------------- */

/** BannerHub 客户端是多语言导出的，同一个「默认值」会以葡/英/中三种写法出现。
 *  不归一化的话，用户会看到 `Driver do sistema`（葡语「系统驱动」）这种怪东西。 */
const LABEL_MAP = [
  [/^driver do sistema$/i, '系统自带驱动'],
  [/^(system|stock) driver$/i, '系统自带驱动'],
  [/^driver personalizado$/i, '自定义驱动'],
  [/^personalizado$|^custom$|^自定义$/i, '自定义'],
  [/^predefini[cç][aã]o de jogo$|^game presets?$/i, '游戏预设'],
  [/^predefini[cç][aã]o$|^default$|^preset$/i, '默认预设'],
  [/^compat[íi]vel$|^compatible$|^兼容$/i, '兼容模式'],
  [/^equilibrado$|^balanced$/i, '均衡模式'],
  [/^desempenho$|^performance$/i, '性能模式'],
  [/^nenhum$|^none$|^无$/i, ''],
];
function normLabel(s) {
  const t = String(s == null ? '' : s).trim();
  if (!t) return '';
  for (const [re, to] of LABEL_MAP) if (re.test(t)) return to;
  return t;
}

/** 组件对象 → 可读名（取 name，其次 displayName / fileName） */
function compName(v) {
  if (v == null) return '';
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return '';
    if (s[0] === '{' || s[0] === '[') { try { return compName(JSON.parse(s)); } catch (e) { return ''; } }
    return normLabel(s);
  }
  if (typeof v !== 'object') return '';
  const n = String(v.name || v.displayName || v.fileName || '').trim();
  if (!n || /^none$/i.test(n)) return '';
  if (/^\d+$/.test(n)) return '';             // id 不是名字
  return normLabel(n.replace(/\.tzst$|\.tar\.zst$/i, ''));
}

/** 翻译层配置（Box64 / FEX）→ { kind, preset, flags[] } */
function parseTranslator(key, raw) {
  const m = String(key).match(/TRANSLATOR_CONFIG_APPLYING_(BOX|FEX)/i);
  if (!m) return null;
  const kind = m[1].toUpperCase() === 'BOX' ? 'Box64' : 'FEX';
  let o = raw;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) { o = null; } }
  if (!o || typeof o !== 'object') return { kind, preset: '', flags: [] };
  const preset = normLabel(String(o.name || o.displayName || '').trim());
  const flags = [];
  /* 只挑「与默认不同」且对用户有意义的开关，避免噪音 */
  const FLAG_LABELS = [
    ['AlignedAtomics', '对齐原子操作'], ['BigBlock', '大块内存', 'num'],
    ['CallRet', '调用返回优化', 'num'], ['Box64AVX', 'AVX 模拟'],
    ['StrongMem', '强内存序'], ['MaxInst', '最大指令数', 'num'],
    ['Multiblock', '多块翻译'], ['HalfBarrierTSOEnabled', '半屏障 TSO'],
    ['MonoHacks', 'Mono 兼容'], ['MemcpySetTSOEnabled', 'memcpy TSO'],
    ['forceSVEWidth', 'SVE 宽度', 'num'], ['HideHypervisorBit', '隐藏虚拟机位'],
  ];
  for (const [key2, label, type] of FLAG_LABELS) {
    const v = o[key2];
    if (v === undefined || v === null) continue;
    if (type === 'num' && (!v || v === 0)) continue;
    if (v === false) continue;
    flags.push(v === true ? label : label + ' ' + v);
    if (flags.length >= 4) break;
  }
  return { kind, preset, flags };
}

/** 分辨率：`pc_s_resolution_w<tag>` / `pc_s_resolution_h<tag>` 成对 */
function parseResolution(settings, translatorKey) {
  const tag = (String(translatorKey || '').match(/(\d{3,}|local_[\w-]+)$/) || [])[1] || '';
  const pairs = [];
  for (const k of Object.keys(settings)) {
    const m = k.match(/^pc_s_resolution_w(.+)$/);
    if (!m) continue;
    const t = m[1];
    const w = parseInt(settings[k], 10);
    const h = parseInt(settings['pc_s_resolution_h' + t], 10);
    if (w > 0 && h > 0) pairs.push({ t, w, h });
  }
  if (!pairs.length) return '';
  const pick = (tag && pairs.find((p) => p.t === tag)) || pairs[pairs.length - 1];
  return pick.w + '×' + pick.h;
}

/** 一份社区配置 JSON → 紧凑参数对象；不是有效配置返回 null */
function parseConfig(j, meta) {
  if (!j || !j.settings || typeof j.settings !== 'object') return null;
  const s = j.settings;
  const g = j.meta || {};
  const keys = Object.keys(s);

  const driverKey = keys.find((k) => /^pc_ls_GPU_DRIVER_/.test(k));
  const trKey = keys.find((k) => /TRANSLATOR_CONFIG_APPLYING_(BOX|FEX)/i.test(k));
  const userTrKey = keys.find((k) => /USER_CUSTOM_TRANSLATOR_CONFIG_(BOX|FEX)/i.test(k));
  const tr = parseTranslator(trKey || '', trKey ? s[trKey] : null);

  const memMb = parseInt(s.pc_ls_max_memory, 10);
  const cores = parseInt(s.pc_ls_core_limit, 10);
  const audio = parseInt(s.pc_ls_AUDIO_DRIVER, 10);

  return {
    device: String(g.device || (meta && meta.phone) || '').trim(),
    gpu: String(g.soc || (meta && meta.gpu) || '').trim(),
    ver: String(g.bh_version || '').trim(),
    date: (meta && meta.date) || '',
    ts: (meta && meta.ts) || 0,
    driver: compName(driverKey ? s[driverKey] : ''),
    dxvk: compName(s.pc_ls_DXVK),
    vkd3d: compName(s.pc_ls_VK3k),
    container: compName(s.pc_ls_CONTAINER_LIST),
    translator: tr && tr.kind ? (tr.preset ? tr.kind + ' · ' + tr.preset : tr.kind) : '',
    translatorKind: tr ? tr.kind : '',
    translatorFlags: tr ? tr.flags : [],
    translatorCustom: !!(userTrKey && !trKey),
    fexBuild: compName(s.pc_set_constant_95) || compName(s.pc_set_constant_96) || compName(s.pc_set_constant_97) || '',
    resolution: parseResolution(s, trKey),
    maxMem: Number.isFinite(memMb) && memMb > 0 ? (memMb >= 1024 ? Math.round(memMb / 1024) + ' GB' : memMb + ' MB') : '',
    cores: Number.isFinite(cores) && cores > 0 ? cores + ' 核' : '',
    audio: Number.isFinite(audio) ? (audio === 0 ? 'Auto' : String(audio)) : '',
    vibration: s.pc_ls_open_vibration === true || s.pc_ls_open_vibration === 'true',
    boot: String(s.pc_ls_boot_option || '').trim().slice(0, 60),
    url: (meta && meta.url) || '',
    page: (meta && meta.page) || '',
  };
}

/* ---------------- 抓取 ---------------- */

async function fetchOne(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

/** 有界并发映射 */
async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let i = 0;
  const workers = new Array(Math.min(limit, list.length)).fill(0).map(async () => {
    while (i < list.length) {
      const idx = i++;
      try { out[idx] = await fn(list[idx], idx); } catch (e) { out[idx] = null; }
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * 某游戏的逐条游玩参数。
 *   keyOrKeys  BannerHub 仓库键（字符串，或候选键数组）
 *   limit      期望返回条数（默认 4，上限 12）
 *
 * ★ 为什么要接受「候选键数组」：社区仓库里同一款游戏存在多个别名目录
 *   （PES2013 / PES_2013 / Pes__2013 …），各自收录的份数差别很大 ——
 *   mobilehub 给的 bhKeys 里第一个可能只有 2 份，而别的键有 2773 份。
 *   所以在候选中挑**文件最多**的那个，而不是盲信第一个。
 *
 * 返回 { ok, key, picked, candidates, items:[…], total, cached, fetchedAt }
 */
async function params(keyOrKeys, limit = 4) {
  const cands = (Array.isArray(keyOrKeys) ? keyOrKeys : String(keyOrKeys || '').split(','))
    .map((x) => String(x || '').trim()).filter(Boolean).slice(0, 12);
  if (!cands.length) return { ok: false, error: '缺少参数 key' };
  const n = Math.max(1, Math.min(parseInt(limit, 10) || 4, 12));

  /* 选「文件最多」的键；同分保持候选顺序，保证可复现 */
  let key = cands[0], best = -1;
  const sizes = {};
  for (const c of cands) {
    const len = (bannerhub.configs(c) || []).length;
    sizes[c] = len;
    if (len > best) { best = len; key = c; }
  }

  const c = ensureCache();
  const hit = c[key];
  if (hit && Array.isArray(hit.items) && hit.items.length && (Date.now() - (hit.ts || 0)) < TTL) {
    return { ok: true, key, picked: key, candidates: sizes, items: hit.items.slice(0, n), total: hit.total || hit.items.length, cached: true, fetchedAt: hit.ts };
  }

  /* 取最近的若干份：多要一点，容忍个别文件 404 / 超时 */
  const list = bannerhub.configs(key).slice(0, Math.min(n * 3, 24));
  if (!list.length) {
    c[key] = { ts: Date.now(), total: 0, items: [] };
    dirty = true; flush();
    return { ok: true, key, picked: key, candidates: sizes, items: [], total: 0, cached: false };
  }
  const parsed = await mapLimit(list, CONC, async (meta) => {
    const j = await fetchOne(meta.url);
    return parseConfig(j, meta);
  });
  const items = parsed.filter(Boolean).slice(0, n);
  c[key] = { ts: Date.now(), total: list.length, items };
  dirty = true; flush();
  return { ok: true, key, picked: key, candidates: sizes, items, total: list.length, cached: false, fetchedAt: c[key].ts };
}

/**
 * 从**本地缓存**里取「该游戏逐条配置里出现过的机型」（同步、绝不打网络）
 *
 * ★ v10.17 新增，修「机型清单列不全」：
 *   详情页机型清单原先只读社区库聚合摘要 `bannerhub.json` 的 `dv`，
 *   而那个字段是**上游的 6 格摘要**（全库最大长度就是 6）→ 结构性最多 6 台。
 *   逐条配置（本缓存）里的 `device` 才是全量、且写法规范（`HONOR MTN-NX3`）。
 *   两边并起来，实测 6 台 → 11 台。
 *
 * ⚠️ 只读缓存不打网络：这个函数会被 `/api/mobilehub/match` 同步调用，
 *   拿不到（缓存未预热）就返回空数组，由调用方与摘要取并集 —— 不许在这里 await。
 *
 * @param {string|string[]} keyOrKeys 仓库键（数组或逗号分隔）
 * @returns {string[]} 出现过的机型原始串（未去重、未归一，交给 deviceset 处理）
 */
function cachedDevices(keyOrKeys) {
  const c = ensureCache();
  const cands = (Array.isArray(keyOrKeys) ? keyOrKeys : String(keyOrKeys || '').split(','))
    .map((x) => String(x || '').trim()).filter(Boolean);
  const out = [];
  for (const k of cands) {
    const hit = c[k];
    for (const it of (hit && hit.items) || []) {
      const d = it && it.device ? String(it.device).trim() : '';
      if (d) out.push(d);
    }
  }
  return out;
}

function stats() {
  const c = ensureCache();
  const keys = Object.keys(c);
  return { ok: true, keys: keys.length, items: keys.reduce((a, k) => a + ((c[k].items || []).length), 0) };
}

module.exports = { params, cachedDevices, parseConfig, parseTranslator, parseResolution, compName, stats, _cache: CACHE };
