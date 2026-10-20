/**
 * ★ v10.88：游戏备注（管理后台唯一「可编辑内容」的落地文件）
 *
 * 为什么需要它：管理页原本只有「隐藏/显示」这个动作，没有可编辑的内容 ——
 *   「编辑弹窗」会变成只读详情页。备注是最轻、最不会破坏抓取数据的可编辑字段：
 *   不看库结构、不影响搜索与匹配，纯管理侧标注（例如「等更新」「封面错」「已人工核对」）。
 *
 * 存储：data/game-notes.json → { "<库id>": { note, updatedAt } }
 *   · 与 hide-overrides.json 的区别：豁免是**行为**（影响列表），备注是**标注**（不影响任何逻辑）
 *   · 入库（不 gitignore）：备注有长期价值，体积小（每条 <100 字）
 *   · 写操作必须经 adminGuard（回环或令牌），同铁律 154
 */
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'game-notes.json');
let cache = null;

function load() {
  if (cache) return cache;
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    cache = (j && typeof j === 'object') ? j : {};
  } catch (e) { cache = {}; }
  return cache;
}

function get(id) {
  const j = load();
  const v = j[String(id || '')];
  return v && v.note ? String(v.note) : '';
}

function set(id, note) {
  const j = load();
  const k = String(id || '');
  const n = String(note == null ? '' : note).trim().slice(0, 500);
  if (!n) delete j[k];
  else j[k] = { note: n, updatedAt: new Date().toISOString() };
  fs.writeFileSync(FILE, JSON.stringify(j, null, 1) + '\n');
  return { id: k, note: n };
}

function count() {
  return Object.keys(load()).length;
}

/** 批量回填（browse 列表一次 50 行，逐条 get 会反复走缓存查找，这里一次取快照） */
function snapshot() {
  return load();
}

module.exports = { get, set, count, snapshot, FILE };
