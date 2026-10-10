/**
 * data/fr.js — FearlessRevolution（fearlessrevolution.com）CE 表 / Trainer 索引读取
 *
 * 数据来自 tools/fetch-fr.js 产出的 data/fr.json（惰性加载，按 mtime 失效）。
 *
 * ── 为什么新增这一路（v10.47）──────────────────────────────────────────────
 * 用户口径：「我看了下未有下载链接原因是未获取到真实下载链，这两个是他们原链可以直接获取，
 *   根据游戏名称进行匹配」。FR 的附件是**真实文件链**且免登录可下：
 *   `GET /download/file.php?id=77737` → 206 + `content-disposition: attachment;
 *   filename*=UTF-8''Xenonauts2.CT`，内容是 Cheat Engine 表（.CT）原文件。
 *   ⇒ 这正是现有的 data/trainers.js（GCM 元数据，**刻意不给下载链**）缺的那一块。
 *
 * ── 与 GTrainers 的关键差异（决定了抓取方式，也决定了本文件的字段）────────
 *   整站在 Cloudflare 后面 ⇒ 只能靠有头浏览器会话抓（见 tools/fetch-fr.js 文件头）。
 *   内容形态也不同：GT 是「一条 = 一个文件」，FR 是「一条 = 一个**主题帖**，
 *   帖里挂 N 个附件（`.CT` / 压缩包，带版本号与下载数）」。
 *   ⇒ 所以这里每条带 `files[]`，前端优先列 `files`，没有 files 的（解析为空）
 *     回落到主题帖链接 —— **不静默丢条**。
 *
 * ── FR 没有存档板块（实测首页板块列表）⇒ 本模块只出 cat='trainers' ─────────
 */
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'fr.json');
let cache = null;
let mtime = 0;

function ensure() {
  try {
    const st = fs.statSync(FILE);
    if (cache && st.mtimeMs === mtime) return cache;
    cache = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    mtime = st.mtimeMs;
    return cache;
  } catch (e) {
    return { builtAt: 0, stats: { missing: true, why: String((e && e.message) || e) }, items: [] };
  }
}

/** 板块 → 展示名。f=4 Tables（CE 表）/ f=5 Trainers。**没有存档板**。 */
const FORUM_LABEL = { table: 'CE 表', trainer: 'Trainer' };
const SRC_LABEL = { fr: 'FearlessRevolution' };

function stats() {
  const d = ensure();
  const s = Object.assign({ total: (d.items || []).length }, d.stats || {});
  if (s.allFailed) s.note = '上次抓取全部失败，当前是旧值';
  return s;
}

/** 每款端游库游戏有多少个主题帖 / 多少个附件 */
function index() {
  const d = ensure();
  const byLib = {};
  for (const it of d.items || []) {
    if (!it.libId) continue;
    const o = byLib[it.libId] || (byLib[it.libId] = { topics: 0, files: 0, total: 0, game: '' });
    o.topics++;
    o.files += (it.attachments || []).length;
    o.total++;
    if (!o.game && it.game) o.game = it.game;
  }
  return { builtAt: d.builtAt || 0, stats: stats(), byLib };
}

/** 附件数降序 + 下载数高的在前：卡内前 3 条要放「最值得点」的 */
function byLib(libId) {
  const d = ensure();
  const id = String(libId || '');
  if (!id) return [];
  return (d.items || [])
    .filter((x) => String(x.libId) === id)
    .sort((a, b) => (b.attachments || []).length - (a.attachments || []).length
      || String(b.title || '').localeCompare(String(a.title || '')));
}

function lookup(title) {
  const d = ensure();
  const k = normKey(title);
  if (!k) return [];
  const exact = [], loose = [];
  for (const x of d.items || []) {
    const kg = normKey(x.game), kt = normKey(x.title);
    if (kg === k || kt === k) exact.push(x);
    else if (k.length >= 3 && (kg.includes(k) || kt.includes(k))) loose.push(x);
  }
  return exact.length ? exact : loose;
}

function normKey(s) {
  return String(s || '').toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[：:·・,，.。!！?？'"“”‘’()（）\[\]【】《》<>~～\-–—_+*&/／|｜\\]/g, '');
}

/** 统一投影。★ `url` 取**第一个附件**的直链（卡内主按钮），全量附件留在 `files[]`。
 *  ⚠️ FR 的附件链是 `download/file.php?id=<n>`（已去掉会话 sid），点开即下载。 */
function slim(x) {
  const files = (x.attachments || []).map((a) => ({
    id: a.id, name: a.name, version: a.version, size: a.size, downloads: a.downloads || 0, url: a.url,
  }));
  return {
    src: 'fr',
    cat: 'trainers',
    id: x.t,
    title: x.title,
    game: x.game,
    size: files.length ? files[0].size : '',
    date: '',
    downloads: files.reduce((n, f) => n + (f.downloads || 0), 0),
    url: files.length ? files[0].url : '',
    files,
    forum: x.forum || '',
    forumLabel: FORUM_LABEL[x.forum] || '',
    page: x.sourceUrl || '',
    libId: x.libId || '',
    libTitle: x.libTitle || '',
    how: x.matchHow || '',
  };
}

function matchSlim({ t = '', id = '' } = {}) {
  let list = id ? byLib(id) : [];
  if (!list.length && t) list = lookup(t);
  return { count: list.length, items: list.map(slim) };
}

module.exports = { ensure, stats, index, byLib, lookup, slim, matchSlim, normKey, FORUM_LABEL, SRC_LABEL };
