/**
 * ★ v10.90：游戏资料覆盖层（管理后台「页面管理 / 游戏库」两页共用的唯一写入口）
 *
 * 为什么需要它（不是「再来一个备注文件」）：
 *   爬虫抓回来的标题 / 封面 / 热度 / 平台链接 / 简介 / 厂商 / 发售日，经常有错、缺、或
 *   干脆没抓到。管理页要「弹窗编辑爬取的内容」，就必须有地方落这些人工值 ——
 *   但又**不能回写 `data/games-*.json`**：
 *     ① 那些文件每天被 daily-sync 覆盖，人工值必然丢；
 *     ② 覆盖层与原始抓取值分开存，才能回答「这个字段是人改的还是抓来的」
 *        （`_prof` 标记就是给管理页用的），也才能一键清空回到爬虫值。
 *
 * 与既有两个文件的分工（同一语义只留一份实现，别互相抄）：
 *   · `game-notes.json`      = 备注（纯标注，不影响任何逻辑）
 *   · `hide-overrides.json`  = 可见性（**行为**，影响列表）
 *   · `game-profile.json`    = 展示字段（标题/封面/热度/简介/厂商…，影响展示与详情）
 *   ⇒ 三个文件按「语义」分工，不按「页面」分工：页面管理页与游戏库页写的是同一份文件，
 *     只是各自暴露其中一部分字段（页面管理管爬虫字段，游戏库管资料字段）。
 *
 * ★ 铁律（本轮定）：**覆盖层只改「展示」，不改「匹配」**。
 *   匹配（跨源关联、资源归属）一律用爬虫原始标题，否则人工改个标题就会把
 *   已经匹配好的 MOD / 修改器 / 存档全打断 —— 这类事故没有任何报错，只会静默变少。
 *   所以 `apply()` 只在**输出**处调用（列表行 / 详情回包 / 管理详情），
 *   `gamesDb` 内部索引与 `resFor()` 全程看原始值。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'game-profile.json');

/* 字段白名单 —— 只收「人工能确认、且只影响展示」的字段。
 * 刻意**不收** id / source / publishTs：那些是库结构，改了会让一切引用失准。 */
const FIELDS = ['title', 'cover', 'hot', 'url', 'intro', 'genres', 'developer', 'publisher', 'releaseDate', 'aliases'];
const NUM_FIELDS = new Set(['hot']);
const ARR_FIELDS = new Set(['genres', 'aliases']);
const MAX = { title: 200, cover: 600, url: 600, intro: 4000, developer: 120, publisher: 120, releaseDate: 20 };

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    cache = (j && typeof j === 'object' && !Array.isArray(j)) ? j : {};
  } catch (e) { cache = {}; }
  return cache;
}

/** 单条覆盖（原始存储形状：{ title, hot, ..., updatedAt }），没有就返回 null */
function get(id) {
  const v = load()[String(id || '')];
  return v && typeof v === 'object' ? v : null;
}

/** 规范化：空值 ⇒ undefined（表示「删掉这条覆盖」）；数字字段转 number；数组字段按逗号切 */
function norm(field, raw) {
  if (raw == null) return undefined;
  if (ARR_FIELDS.has(field)) {
    let arr = raw;
    if (typeof arr === 'string') arr = arr.split(/[,，、|]/);
    if (!Array.isArray(arr)) return undefined;
    const out = arr.map((s) => String(s).trim()).filter(Boolean).slice(0, 30);
    return out.length ? out : undefined;
  }
  if (NUM_FIELDS.has(field)) {
    if (String(raw).trim() === '') return undefined;
    const n = Number(raw);
    return isFinite(n) && n >= 0 ? Math.round(n) : undefined;
  }
  const s = String(raw).trim().slice(0, MAX[field] || 200);
  return s || undefined;
}

/**
 * 写一条覆盖。patch 里出现的字段才会被改；值为空 ⇒ 删掉该字段（回到爬虫值）。
 * 一条都不剩时把整条记录删掉（文件不膨胀）。
 */
function set(id, patch) {
  const j = load();
  const k = String(id || '').trim();
  if (!k) throw new Error('缺少游戏 id');
  const cur = Object.assign({}, j[k] || {});
  let touched = 0;
  for (const f of FIELDS) {
    if (!(f in (patch || {}))) continue;
    const v = norm(f, patch[f]);
    if (v === undefined) { if (f in cur) { delete cur[f]; touched++; } }
    else if (JSON.stringify(cur[f]) !== JSON.stringify(v)) { cur[f] = v; touched++; }
  }
  if (!touched) return { id: k, profile: j[k] || null, touched: 0 };
  if (Object.keys(cur).filter((x) => x !== 'updatedAt').length === 0) delete j[k];
  else { cur.updatedAt = new Date().toISOString(); j[k] = cur; }
  persist(j);
  return { id: k, profile: j[k] || null, touched };
}

/** 原子写：先写 .tmp 再 rename —— 半截文件会让**整个文件**读失败，退回「无覆盖」远比丢了更难查 */
function persist(j) {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(j, null, 1) + '\n');
  fs.renameSync(tmp, FILE);
}

/** 把覆盖叠到一条库记录上。没有覆盖就**原样返回同一个对象**（不制造副本，列表 50 行省一次 GC） */
function apply(game) {
  if (!game || !game.id) return game;
  const p = get(game.id);
  if (!p) return game;
  const o = Object.assign({}, game);
  const used = [];
  for (const f of FIELDS) {
    if (!(f in p)) continue;
    o[f] = p[f];
    used.push(f);
  }
  /* 管理侧要能看出「哪些字段是人改的」；公开页不看这个字段 */
  o._prof = used;
  return o;
}

/** 资料完整度（游戏库列表用）：按「资料字段里有几个非空」算，不参与任何业务判定 */
function completeness(game) {
  if (!game) return 0;
  let n = 0;
  if (game.cover) n++;
  if (game.intro) n++;
  if ((game.genres || []).length) n++;
  if (game.developer) n++;
  if (game.publisher) n++;
  if (game.releaseDate) n++;
  if ((game.aliases || []).length) n++;
  return n; // 0..7
}

function stats() {
  const j = load();
  const fields = {};
  for (const f of FIELDS) fields[f] = 0;
  let games = 0;
  for (const k of Object.keys(j)) {
    games++;
    for (const f of FIELDS) if (f in j[k]) fields[f]++;
  }
  return { games, fields, file: path.basename(FILE) };
}

/** 测试用：清空内存缓存（改过文件后重读） */
function _reset() { cache = null; }

module.exports = { get, set, apply, completeness, stats, snapshot: load, FIELDS, FILE, _reset };
