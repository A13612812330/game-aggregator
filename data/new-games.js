'use strict';
/**
 * 新游检测（v10.109，2026-10-23 用户需求 ④）
 *
 * 用户原话：「我还想增加一个入口，就是新游检测（遇到新游戏则在这里，我来决定是入库）」。
 * 追问后拍板的口径：
 *   · 判定「新」= **源站出现了、库里没有的**（按 id 比对，不看上架日期字段）
 *   · 「入库」= **标为可见 + 拉详情资料**（不是新增一套数据表）
 *
 * 【为什么按 id 比对，而不是按 publishTs 筛】
 *   按日期会把「库里早就有、只是最近更新过」的条目一并列进来 —— 用户点进去发现是
 *   熟面孔，两次之后就不看这个页面了。id 差集是**客观事实**：这条源站有、库里没有。
 *
 * 【为什么不复用 daily-sync 的增量索引】
 *   增量索引的行为是「抓到就 upsert」—— 它会把新游**直接塞进库**，用户就没有
 *   「决定入库」这一步了。两者目的相反：
 *     · 索引 = 让库变全
 *     · 本模块 = 让库变**经用户确认后才全**
 *   所以本模块只做「比对 + 记账」，**扫描阶段绝不写 games.json**。
 *
 * 【入库时补什么】
 *   upsert 用的是源站**列表页**的字段（id/source/title/cover/genres/size/score/
 *   dateLabel/updatedTs/publishTs/url）。够让一款游戏在列表里正常展示，
 *   但没有简介与截图 —— 那是详情页才有的。
 *   ⇒ admit 会再尝试一次 `xdgamer.detail(url)` 补字段，**失败静默**：
 *     资料补不上不影响入库（「少两段字」比「点了没反应」好）。
 *
 * 【持久化】
 *   `data/new-games.json`（不入 .gitignore —— 这是**用户决策记录**，不是可再生中间产物；
 *   丢了就等于把「已忽略」的清单清空，下次扫描又把它们全列回来）。上限 MAX_CANDIDATES，
 *   超出时**先丢最旧的已处理记录**，pending 一条都不丢。
 */
const fs = require('fs');
const path = require('path');

let FILE = path.join(__dirname, 'new-games.json');

/** 测试钩子：把候选池文件指到别处（`_tmp/` 里），让测试**不碰真实候选池**。
 *
 *  ★ 为什么必须有这个口子：本模块的写操作（ignore/admit/restore）都会立刻落盘，
 *    而落盘目标是 `data/new-games.json` —— 那是**用户的决策记录**（谁被忽略了）。
 *    测试要验状态机就得写，写真实文件就等于「跑一次测试清空一次用户的忽略名单」。
 *  ⇒ 生产代码**不要调用**；只在 tools/test-v10109-*.js 里用。
 *  ⚠️ 改成 `let` 而不是 `const` 也是为这个 —— 但除本函数外没人能改它。 */
function _setFile(p) {
  FILE = String(p);
  store = { generatedAt: 0, lastScanAt: 0, lastScanPages: 0, candidates: [] };
  load();
}
const MAX_CANDIDATES = 1000;
const STATUSES = ['pending', 'admitted', 'ignored'];

/** 测试钩子：替换「库」。`scan` 读 `byIdGet`，`admit` 写 `upsert/persist`。
 *
 *  ★ 为什么 `_setFile` 不够：它只隔离了**候选池**，而 `admit` 的 ①③ 两步会
 *    `gamesDb.upsert()` + `gamesDb.persist()` —— 写的是**真实的 `data/games.json`**。
 *    v10.109 实测踩到：测试为了验「入库」，把真实游戏 `xd-8149`（玩偶冒名者，
 *    url 正常）整条**覆盖**成了测试夹具的标题 + 空 url。这个污染不是断言能发现的，
 *    是另一套无关的 `test-v1015`（「库内每条 url 都能通过详情页正则」）先变红才暴露。
 *  ⇒ 测试传一个内存假库进来；**生产代码不要调用**。 */
let DB = null;
function _setDb(d) { DB = d || null; }
function db() { return DB || require('./gamesDb'); }

let store = { generatedAt: 0, lastScanAt: 0, lastScanPages: 0, candidates: [] };
let scanning = false;

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (raw && Array.isArray(raw.candidates)) {
      store = {
        generatedAt: Number(raw.generatedAt) || 0,
        lastScanAt: Number(raw.lastScanAt) || 0,
        lastScanPages: Number(raw.lastScanPages) || 0,
        candidates: raw.candidates.filter((c) => c && c.id),
      };
    }
  } catch (e) {
    /* 文件不存在 / 损坏 ⇒ 空池。不抛：这个模块坏掉不该拖垮整站启动。 */
  }
  return store;
}

function save() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 1) + '\n');
  fs.renameSync(tmp, FILE);   /* 原子替换：写一半崩掉不会留下半份候选池 */
}

function stats() {
  const out = { total: store.candidates.length, pending: 0, admitted: 0, ignored: 0 };
  for (const c of store.candidates) {
    if (out[c.status] != null) out[c.status]++;
  }
  return {
    ...out,
    scanning,
    lastScanAt: store.lastScanAt,
    lastScanPages: store.lastScanPages,
  };
}

/** 候选列表（默认只给待处理的） */
function list(opts) {
  const o = opts || {};
  const st = STATUSES.includes(o.status) ? o.status : 'pending';
  const q = String(o.q || '').trim().toLowerCase();
  const limit = Math.min(Math.max(1, parseInt(o.limit, 10) || 40), 200);
  const offset = Math.max(0, parseInt(o.offset, 10) || 0);

  let arr = store.candidates.filter((c) => (st === 'all' ? true : c.status === st));
  if (q) arr = arr.filter((c) => String(c.title || '').toLowerCase().includes(q) || String(c.id).includes(q));
  /* 新的在前：firstSeen 降序；同批次内按 id 数字降序（XD id 递增 = 越新越大） */
  arr.sort((a, b) => {
    const d = (b.firstSeen || 0) - (a.firstSeen || 0);
    if (d) return d;
    return idNum(b.id) - idNum(a.id);
  });
  return { total: arr.length, offset, limit, status: st, items: arr.slice(offset, offset + limit) };
}

function idNum(id) {
  const m = /(\d+)/.exec(String(id || ''));
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * 扫描：抓源站最近 pages 页 → 与库内 id 比对 → 差集进候选池。
 * **不写 games.json**（这是本模块与增量索引的根本区别，见文件头）。
 *
 * @param {object} o { pages }
 * @returns {Promise<object>} 扫描结果
 */
async function scan(o) {
  if (scanning) throw new Error('扫描进行中，请稍候');
  const pages = Math.min(Math.max(1, parseInt((o && o.pages) || 3, 10) || 3), 20);
  const indexer = require('../fetchers/indexer');
  const gamesDb = db();

  scanning = true;
  const t0 = Date.now();
  const seen = new Map();       /* id → 源站条目（同一次扫描内跨页去重） */
  const errors = [];
  try {
    for (let p = 1; p <= pages; p++) {
      try {
        const items = await indexer.fetchXdPage(p);
        for (const g of items || []) {
          if (g && g.id && !seen.has(g.id)) seen.set(g.id, g);
        }
      } catch (e) {
        /* 单页失败不中断整轮 —— 抓 5 页有 1 页超时，另外 4 页的结果仍然有用 */
        errors.push('第 ' + p + ' 页：' + (e && e.message));
      }
      await new Promise((r) => setTimeout(r, 160));   /* 限速，与 indexXdRange 同节奏 */
    }

    const now = Date.now();
    const byId = new Map(store.candidates.map((c) => [c.id, c]));
    let added = 0, alreadyInLib = 0, known = 0;

    for (const g of seen.values()) {
      if (gamesDb.byIdGet(g.id)) { alreadyInLib++; continue; }
      const old = byId.get(g.id);
      if (old) {
        /* 已知候选：只刷新源站字段，**不动 status** ——
           已忽略/已入库的条目不能被下一轮扫描"复活"成待处理。 */
        known++;
        old.title = g.title || old.title;
        old.cover = g.cover || old.cover;
        old.score = g.score != null ? g.score : old.score;
        old.size = g.size || old.size;
        old.dateLabel = g.dateLabel || old.dateLabel;
        old.url = g.url || old.url;
        old.publishTs = g.publishTs || old.publishTs;
        old.updatedTs = g.updatedTs || old.updatedTs;
        continue;
      }
      store.candidates.push({
        id: g.id,
        source: g.source || 'xdgamer',
        title: g.title || '',
        cover: g.cover || '',
        genres: Array.isArray(g.genres) ? g.genres : [],
        size: g.size || '',
        score: g.score != null ? g.score : null,
        dateLabel: g.dateLabel || '',
        publishTs: g.publishTs || null,
        updatedTs: g.updatedTs || null,
        url: g.url || '',
        firstSeen: now,
        status: 'pending',
        admitAt: null,
        note: '',
      });
      added++;
    }

    /* 上限裁剪：只裁已处理的，pending 一条不动（见文件头） */
    if (store.candidates.length > MAX_CANDIDATES) {
      const pending = store.candidates.filter((c) => c.status === 'pending');
      const done = store.candidates
        .filter((c) => c.status !== 'pending')
        .sort((a, b) => (b.firstSeen || 0) - (a.firstSeen || 0))
        .slice(0, Math.max(0, MAX_CANDIDATES - pending.length));
      store.candidates = done.concat(pending);
    }

    store.lastScanAt = now;
    store.lastScanPages = pages;
    store.generatedAt = now;
    save();

    return {
      ok: true,
      pages,
      fetched: seen.size,          // 源站这次一共见到多少条（跨页去重后）
      alreadyInLib,                // 其中库里已有的
      known,                       // 已在候选池里的（刷新字段）
      added,                       // 新增候选
      errors,
      ms: Date.now() - t0,
      stats: stats(),
    };
  } finally {
    scanning = false;
  }
}

/**
 * 入库：写进 games.json + 强制可见 + 尝试补详情资料。
 *
 * 三步的顺序不能换：
 *   ① upsert 先落下（后面补资料失败也不影响"已入库"这个事实）
 *   ② setOverride('show') 让它**绕过错判**：新游本来自带 90 天热启动期，
 *      不会被藏；但用户手动入库的语义是「我要它出现」，不能指望热度规则以后也不藏它
 *   ③ 补详情（可选增强，失败静默）
 */
async function admit(ids) {
  const want = (Array.isArray(ids) ? ids : [ids]).map(String).filter(Boolean);
  if (!want.length) throw new Error('缺 id');
  const gamesDb = db();
  const coldHide = require('./cold-hide');

  const out = { admitted: [], skipped: [], failed: [], detailFilled: 0 };
  for (const id of want) {
    const c = store.candidates.find((x) => x.id === id);
    if (!c) { out.skipped.push({ id, why: '候选池里没有这条' }); continue; }

    /* ① 入库（已存在时 upsert 走 updated 分支，不会产生重复行） */
    try {
      gamesDb.upsert([{
        id: c.id, source: c.source, title: c.title, cover: c.cover,
        genres: c.genres, size: c.size, score: c.score,
        dateLabel: c.dateLabel, updatedTs: c.updatedTs, publishTs: c.publishTs, url: c.url,
      }]);
    } catch (e) {
      out.failed.push({ id, why: String((e && e.message) || e) });
      continue;
    }

    /* ② 强制可见 */
    try { coldHide.setOverride(c.id, 'show'); } catch (e) { /* 豁免写失败不影响入库本身 */ }

    /* ③ 补详情（列表页没有简介/截图；失败静默，只计数）
     * ★ v10.109 修正：`xdgamer.detail(id, host)` 收的是**数字 id + 可选域名**，
     *   不是列表页给的完整 url。第一版直接传 url ⇒ 被拼成
     *   `https://www.xdgamer.com/game/https://www.xdgame.com/game/16899.html.html` ⇒ 404，
     *   表现是「入库成功但 detailFilled 恒为 0」。
     *   ★ 域名必须按 url 判断：XD 列表页给的是 `xdgame.com`，而 detail 的默认域名是
     *     `xdgamer.com` —— 两个域名的详情页路径各自有效，串了就是 404（server.js 的
     *     `/api/detail` 也是这么判的，此处与它同一口径）。 */
    const numId = String(c.id).replace(/^xd-/, '');
    if (/^\d+$/.test(numId)) {
      try {
        const xdgamer = require('../fetchers/xdgamer');
        const host = /xdgame\.com/i.test(c.url || '') ? 'https://www.xdgame.com' : undefined;
        const d = await Promise.race([
          xdgamer.detail(numId, host),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
        ]);
        if (d && d.ok !== false) {
          const patch = {};
          if (d.title) patch.title = d.title;
          if (d.cover) patch.cover = d.cover;
          /* ★★ 只补**库内真实存在的字段**（实测全库 19,765 条字段集：
           *     id/source/title/cover/genres/size/score/dateLabel/updatedTs/url/
           *     publishTs/jidiId/jidiUrl/hot —— **没有 desc / shots**）。
           *   详情页虽然有简介和截图，但库不是它们的落点（详情走 /api/detail 实时解析），
           *   往库里塞一个全库只有 1 条才有的 `desc` 字段，会让「字段覆盖率」出现孤例，
           *   下游任何按字段投影的地方都要为它写例外。
           *
           *   ★ 真正有价值的修补是 **score**：XD 列表页没解析到评分时会填默认 5，
           *     而详情页给的是真值（实测 16898：列表 5 → 详情 8.2）。
           *     这就是「拉详情资料」在这个项目里的实际含义 —— 不是补简介，是补准数。 */
          if (d.score != null && d.score !== c.score) patch.score = d.score;
          if (d.size && d.size !== c.size) patch.size = d.size;
          if (Array.isArray(d.genres) && d.genres.length && d.genres.join() !== (c.genres || []).join()) patch.genres = d.genres;
          if (d.cover && d.cover !== c.cover) patch.cover = d.cover;
          if (Object.keys(patch).length) {
            gamesDb.upsert([{ id: c.id, ...patch }]);
            /* 候选侧也同步 —— 后台列表刷新时不该还显示旧分数（同一条数据两个版本最难查） */
            Object.assign(c, patch);
            out.detailFilled++;
          }
        }
      } catch (e) { /* 详情抓取失败：不影响入库结论 */ }
    }

    c.status = 'admitted';
    c.admitAt = Date.now();
    out.admitted.push(id);
  }

  /* ★ v10.109：upsert 内部是 persistSoon（800ms 防抖），但本接口要**返回后立刻能被读到** ——
   *   否则用户点完「入库」马上刷新列表，游戏还不存在（实测踩到：等 800ms 才出现）。
   *   ⇒ 显式落一次盘再返回。19,765 条 ≈ 8.5MB，同步写约几十毫秒，可以接受。 */
  if (out.admitted.length) {
    try { gamesDb.persist(); } catch (e) { /* 落盘失败不改变「内存里已入库」的事实 */ }
    try { coldHide.reload(); } catch (e) { /* 豁免文件重载失败不影响本次豁免已写入 */ }
    store.generatedAt = Date.now();
    save();
  }
  return { ...out, stats: stats() };
}

/** 忽略（记下来，之后扫描不再列为待处理） */
function ignore(ids, note) {
  const want = (Array.isArray(ids) ? ids : [ids]).map(String).filter(Boolean);
  if (!want.length) throw new Error('缺 id');
  const out = { ignored: [], skipped: [] };
  for (const id of want) {
    const c = store.candidates.find((x) => x.id === id);
    if (!c) { out.skipped.push(id); continue; }
    c.status = 'ignored';
    if (note != null) c.note = String(note).slice(0, 200);
    out.ignored.push(id);
  }
  if (out.ignored.length) { store.generatedAt = Date.now(); save(); }
  return { ...out, stats: stats() };
}

/** 恢复：把已忽略 / 已入库的条目退回待处理（用户改主意了）
 *
 *  ★ 为什么要有这一步：忽略是「我现在不想入库」，不是「永远不要」。
 *    没有恢复入口的话，误点一次就永久失去这条候选 —— 而扫描**不会**把它变回 pending
 *    （见 scan 里「不动 status」那条注释），用户只能去游戏库手动搜。
 *  ⚠️ 从 admitted 恢复只改候选状态，**不回滚已写进库的数据** ——
 *    「库里有」和「候选池里是待处理」可以同时成立，那正是「已入库但想再看看」的表达。 */
function restore(ids) {
  const want = (Array.isArray(ids) ? ids : [ids]).map(String).filter(Boolean);
  if (!want.length) throw new Error('缺 id');
  const out = { restored: [], skipped: [] };
  for (const id of want) {
    const c = store.candidates.find((x) => x.id === id);
    if (!c) { out.skipped.push(id); continue; }
    c.status = 'pending';
    c.admitAt = null;
    out.restored.push(id);
  }
  if (out.restored.length) { store.generatedAt = Date.now(); save(); }
  return { ...out, stats: stats() };
}

load();

module.exports = {
  load, save, stats, list, scan, admit, ignore, restore, STATUSES, MAX_CANDIDATES,
  _setFile,
  _setDb,
  get _file() { return FILE; },
};
