/**
 * data/gtrainers.js — GTrainers（gtrainers.com）「存档 + 修改器」索引读取
 *
 * 数据来自 tools/fetch-gtrainers.js 产出的 data/gtrainers.json（惰性加载，按 mtime 失效）。
 *
 * ── 为什么新增这一路（v10.47）──────────────────────────────────────────────
 * 用户口径：「我看了下未有下载链接原因是未获取到真实下载链，这两个是他们原链可以直接获取，
 *   根据游戏名称进行匹配」。GTrainers 每条资源都有**真实文件直链**（下载口 301 直达 .rar），
 *   免登录、免网盘、免客户端。原有两条线都答不了这个问题：
 *     · data/saves.js    = Ludusavi 存档**位置**库，没有文件（回答「放哪」）
 *     · data/trainers.js = GCM 元数据目录，**刻意不给下载链**（走一次性签名 URL）
 *   ⇒ GTrainers 是第一个「点开就能下」的存档 + 修改器来源。
 *
 * ── 与其它来源的关系（互不替代，资源页按游戏聚合时并列）────────────────────
 *   saves-youxia.json  游侠存档文件（真直链 + 网盘 + eD2K）
 *   gtrainers.json     本文件（真直链，**按游戏名对到端游库**）
 *   ★ v10.58：`fr.json`（FearlessRevolution CE 表）**已摘除** —— 它从未产出过、贡献 0 条，
 *     理由与复活手册见 docs/sop/FR-fearlessrevolution-抓取SOP.md。
 *
 * ── 落盘字段（来自抓取脚本，两阶段 + 铁律 26：全失败不落盘）──────────────
 *   cat        'saves' | 'trainers'
 *   game       **权威游戏名**（详情页 `Game:` 栏），不是运营标题
 *   title      列表页的条目标题（展示用，含 "SaveGame 100%" 这类运营后缀）
 *   direct     ★ 真实直链（下载口 301 的 Location），如 `…/saves2026/w/witcher3/gamesaves.rar`
 *   dlPath     下载口相对路径（direct 为空时的兜底出口）
 *   libId/libTitle/matchHow/matchKey  端游库关联与**可审计**的匹配口径
 *   hash/virustotal                   详情页 data-* 上的校验信息
 */
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'gtrainers.json');
let cache = null;
let mtime = 0;

/* ★ v10.56：源站**只给文本日期**（`date: "2014-Jan-11"`），没有时间戳 ⇒ 按 `ts` 排序时
 *   GT 条目恒为 0、**永远沉底**。实测影响面（2026-10-12）：
 *     GT 覆盖 3,083 款里 **2,301 款（74.6%）只有 GT 资源**（MOD 只得 781 款 / 游侠存档 535 款），
 *     这批在 `res-groups.js` 的 `sort='new'` 分支里（`(it.ts||0)`）全部落到最后。
 *   `date` 实测 **96.9% 可解析**（9,052 / 9,346）；不可解析的 294 条是**源站字段错位**
 *   （`date` 位置填的是 `"Cheats [159]"`）⇒ 那些**保持 0，不猜**。
 *   ★ 本模块**每次读都会补**（`ensure()` 里，惰性 + mtime 缓存）⇒ 落盘侧
 *     `tools/fetch-gtrainers.js` 补不补**完全等价**，因此没去动它。
 *     若将来要让磁盘产物**自带** `ts`，请复用它 `require('../data/gtrainers').tsOf`
 *     —— 不要在抓取脚本里另写一份解析（铁律 61：同一语义只允许一份实现）。 */
const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
function tsOf(dateStr) {
  const m = /^(\d{4})-([A-Za-z]{3})-(\d{1,2})$/.exec(String(dateStr == null ? '' : dateStr).trim());
  if (!m || MON[m[2]] == null) return 0;
  const t = Date.UTC(Number(m[1]), MON[m[2]], Number(m[3]));
  return Number.isFinite(t) ? t : 0;
}

function ensure() {
  try {
    const st = fs.statSync(FILE);
    if (cache && st.mtimeMs === mtime) return cache;
    cache = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    mtime = st.mtimeMs;
    /* 补 `ts`（**只在内存里补**，不改磁盘产物 —— 落盘由 fetcher 负责）。
       已有非 0 ts 的不动，避免覆盖更精确的来源。 */
    if (cache && Array.isArray(cache.items)) {
      for (const it of cache.items) if (!it.ts) it.ts = tsOf(it.date);
    }
    return cache;
  } catch (e) {
    /* ★ 不静默：把「文件缺失」这件事本身当作可读状态返回（`missing`），
     *   让上层能把它显示成「未接入」而不是「0 条」。 */
    return { builtAt: 0, stats: { missing: true, why: String((e && e.message) || e) }, items: [] };
  }
}

const CAT_LABEL = { saves: '存档', trainers: '修改器' };

function stats() {
  const d = ensure();
  const s = Object.assign({ total: (d.items || []).length }, d.stats || {});
  if (s.allFailed) s.note = '上次抓取全部失败，当前是旧值';
  return s;
}

/** 每款端游库游戏各有多少条 —— 只回计数，够卡片与筛选用 */
function index() {
  const d = ensure();
  const byLib = {};
  for (const it of d.items || []) {
    if (!it.libId) continue;
    const o = byLib[it.libId] || (byLib[it.libId] = { saves: 0, trainers: 0, total: 0, game: '', cover: '' });
    o[it.cat] = (o[it.cat] || 0) + 1;
    o.total++;
    if (!o.game && it.game) o.game = it.game;
  }
  return { builtAt: d.builtAt || 0, stats: stats(), byLib };
}

/** 某款游戏的全部条目（可按 cat 收窄）。排序：有直链优先 → 下载数高的在前 */
function byLib(libId, cat) {
  const d = ensure();
  const id = String(libId || '');
  if (!id) return [];
  return (d.items || [])
    .filter((x) => String(x.libId) === id && (!cat || x.cat === cat))
    .sort((a, b) => (b.direct ? 1 : 0) - (a.direct ? 1 : 0)
      || (b.downloads || 0) - (a.downloads || 0)
      || String(b.date || '').localeCompare(String(a.date || '')));
}

/** 按名反查（详情页只拿得到标题时兜底；与 savesYx.lookup 同思路：先精确再子串） */
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
  return (exact.length ? exact : loose).sort((a, b) => (b.direct ? 1 : 0) - (a.direct ? 1 : 0));
}

/** 与 data/gtrainers 无关的小工具：归一化键（与 mods.js / trainers.js 同口径，避免各写一份） */
function normKey(s) {
  return String(s || '').toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[：:·・,，.。!！?？'"“”‘’()（）\[\]【】《》<>~～\-–—_+*&/／|｜\\]/g, '');
}

/** 统一投影：资源页按游戏聚合时四路来源同形（字段名对齐 savesYx.slim / fr.slim） */
function slim(x) {
  return {
    src: 'gt',
    cat: x.cat,
    id: x.id,
    title: x.title,
    game: x.game,
    size: x.size,
    date: x.date,
    downloads: x.downloads || 0,
    url: x.direct || '',                 /* 真实直链；空则由上层用 page 兜底 */
    page: x.sourceUrl || '',
    libId: x.libId || '',
    libTitle: x.libTitle || '',
    how: x.matchHow || '',
  };
}

function matchSlim({ t = '', id = '', cat = '' } = {}) {
  let list = id ? byLib(id, cat) : [];
  if (!list.length && t) list = lookup(t).filter((x) => !cat || x.cat === cat);
  return { count: list.length, items: list.map(slim) };
}

module.exports = { ensure, stats, index, byLib, lookup, slim, matchSlim, normKey, CAT_LABEL, tsOf };
