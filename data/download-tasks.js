'use strict';
/**
 * data/download-tasks.js — 云下载任务表（v10.93）
 *
 * 存哪里、为什么：
 *   · 任务元数据 → `data/downloads/tasks.json`（单文件，量级几十条，整读整写足够）
 *   · 任务正文   → `data/downloads/<id>/`（aria2 的 dir）
 *   ★ 不放进 `.cache/`：`.cache/` 是**可丢弃的源码依赖缓存**（清掉会自动重抓）；
 *     下载到一半的文件清掉就是真丢数据，语义完全不同，混在一起早晚被「清缓存」脚本带走。
 *
 * ★ 原子写：先写 `.tmp` 再 rename。
 *   踩坑预期：线上容器随时可能被平台回收，进程在 writeFileSync 中途死掉
 *   会留下半截 JSON ⇒ 下次启动 `JSON.parse` 抛错 ⇒ 整个任务表读不出来。
 *   宁可丢最后一次进度，也不能让表整体报废 ⇒ 解析失败时**退回空表并把坏文件改名备份**，
 *   这样至少服务能起来，且现场还在盘上可查。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, 'downloads');
const FILE = path.join(ROOT, 'tasks.json');
const BACKUP = path.join(ROOT, 'tasks.broken.json');

let tasks = [];
let loaded = false;

function ensureDir(p) {
  try { fs.mkdirSync(p, { recursive: true }); } catch (e) { /* 已存在 */ }
}

function load() {
  if (loaded) return tasks;
  loaded = true;
  ensureDir(ROOT);
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const j = JSON.parse(raw);
    tasks = Array.isArray(j) ? j : Array.isArray(j && j.tasks) ? j.tasks : [];
  } catch (e) {
    if (e && e.code !== 'ENOENT') {
      /* 坏文件不删，改名留证 —— 下次有人问「任务怎么没了」时还查得到 */
      try { fs.renameSync(FILE, BACKUP); } catch (e2) { /* 改名失败就算了，不能因此起不来 */ }
    }
    tasks = [];
  }
  return tasks;
}

function save() {
  ensureDir(ROOT);
  const body = JSON.stringify({ ver: 1, at: new Date().toISOString(), tasks }, null, 0);
  const tmp = FILE + '.tmp';
  try {
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, FILE);
  } catch (e) {
    /* rename 在个别文件系统/杀毒占用下会失败 —— 退化成直写，保住数据优先 */
    try { fs.writeFileSync(FILE, body); } catch (e2) { /* 落盘失败不阻断请求 */ }
  }
}

/**
 * ★ v10.93.2：随机段从 6 位（Math.random，约 36^6≈2^31）提到 **20 位 hex（80 bit）**。
 *   原因：任务 id 现在同时是**访问凭据**。线上实测同一脚本两次请求的出口 IP 不同
 *   （NAT/多出口），按 IP 过滤会让用户「刚建的任务查不到」；改成 id 即凭据后，
 *   id 的不可枚举性就成了安全边界 —— 2^31 在一台机器上是可以穷举的，2^80 不行。
 */
function newId() {
  return 'dl_' + Date.now().toString(36) + '_' + crypto.randomBytes(10).toString('hex');
}

function dirOf(id) {
  return path.join(ROOT, String(id).replace(/[^a-zA-Z0-9_]/g, ''));
}

function list() {
  return load();
}

function get(id) {
  return load().find((t) => t.id === id) || null;
}

function create(obj) {
  load();
  const now = Date.now();
  const t = Object.assign({
    id: newId(),
    ip: '',
    magnet: '',
    btih: '',
    name: '',
    gid: '',
    files: [],
    selected: [],
    totalBytes: 0,
    completedBytes: 0,
    speed: 0,
    state: 'resolving',
    error: '',
    createdAt: now,
    updatedAt: now,
    expiresAt: 0,
  }, obj);
  tasks.push(t);
  save();
  return t;
}

/**
 * 只改字段不重排；返回新对象。状态变更由调用方决定，本层不解释语义。
 * ★ `persist:false` 是给进度刷新用的：进度每 500ms 变一次，整表落盘就是每秒两次全量写，
 *   而进度本身**丢了也不要紧**（下次 tellStatus 就重新拿到了）。只有状态位变更才值得写盘。
 */
function patch(id, fields, opts) {
  const t = get(id);
  if (!t) return null;
  Object.assign(t, fields, { updatedAt: Date.now() });
  if (!opts || opts.persist !== false) save();
  return t;
}

function remove(id) {
  const t = get(id);
  if (!t) return false;
  tasks = tasks.filter((x) => x.id !== id);
  save();
  /* 正文目录延后由 sweep 清（这里同步删大目录会阻塞事件循环几秒） */
  return true;
}

/**
 * 过期清理。
 * ★ 只清「终态」任务（ready / failed / cancelled）：进行中的任务哪怕超过 TTL 也不能碰，
 *   否则会出现「下载 3 小时的任务因为创建超过 24h 被删」这种荒唐事。
 * ★ 目录删除用同步递归 —— 单个任务目录最多 30 GB，删除本身很快（只是解链），
 *   但为了不阻塞请求，路由层在定时器里调，不在请求路径上调。
 */
function sweep(now) {
  const t0 = now || Date.now();
  const dead = [];
  tasks = tasks.filter((t) => {
    const done = t.state === 'ready' || t.state === 'failed' || t.state === 'cancelled' || t.state === 'expired';
    const exp = Number(t.expiresAt) || (Number(t.updatedAt) + 24 * 3600 * 1000);
    if (done && exp < t0) { dead.push(t); return false; }
    return true;
  });
  if (dead.length) save();
  return dead;
}

function rmDir(id) {
  const p = dirOf(id);
  try { fs.rmSync(p, { recursive: true, force: true }); return true; } catch (e) { return false; }
}

module.exports = { ROOT, FILE, dirOf, list, get, create, patch, remove, sweep, rmDir, save, load };
