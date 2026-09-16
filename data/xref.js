/**
 * data/xref.js — 端游库 ↔ 「修改器 / 云存档」的交叉索引
 *
 * 用途：给「本地库」和「手游中心」加两个横切筛选 ——
 *   🛠 有修改器 / 💾 有云存档
 * 两个索引库（trainers.json / saves.json）每条都挂了端游库 id（libId），
 * 这里把它们收盘成两个 Set，供 /api/library/* 与 /api/mobilehub/list 做 O(1) 交集，
 * 不必为了一个筛选把 1.5 万条库遍历两遍。
 *
 * 缓存策略与 trainers.js / saves.js 一致：按源数据指纹失效 ——
 * tools 重新生成索引后无需重启服务。
 */
const trainers = require('./trainers');
const saves = require('./saves');

let cache = { key: '', tr: null, sv: null };

function build() {
  const td = trainers.ensure() || {};
  const sd = saves.ensure() || {};
  const ti = td.items || [];
  const si = sd.items || [];
  const key = `${td.builtAt || 0}:${sd.builtAt || 0}:${ti.length}:${si.length}`;
  if (cache.tr && cache.sv && cache.key === key) return cache;
  const tr = new Set();
  for (const x of ti) if (x.libId) tr.add(x.libId);
  const sv = new Set();
  for (const x of si) if (x.libId) sv.add(x.libId);
  cache = { key, tr, sv };
  return cache;
}

/** 有修改器收录的端游库 id 集合 */
const trainerIds = () => build().tr;
/** 有云存档记录的端游库 id 集合 */
const saveIds = () => build().sv;

/** 某个 libId 是否两边都有（供卡片挂徽标用） */
function flags(libId) {
  if (!libId) return { hasTr: false, hasSv: false };
  const { tr, sv } = build();
  return { hasTr: tr.has(libId), hasSv: sv.has(libId) };
}

/** 规模概览（/api/xref/stats 用） */
function stats() {
  const { tr, sv } = build();
  let both = 0;
  for (const id of tr) if (sv.has(id)) both++;
  return { ok: true, trainers: tr.size, saves: sv.size, both };
}

module.exports = { trainerIds, saveIds, flags, stats };
