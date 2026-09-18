/**
 * tools/build-spec-req.js — 合成「可适配游戏」需求索引 → data/spec-req.json（v10.22 新增）
 *
 * ─────────────────────────────────────────────────────────────
 * ★ 解决的问题
 *
 * 解包匹配原来只对着 `steam-req.json` 的 **653 款** Steam 游戏判定。
 * 于是「我这份配置能跑什么」的答案天花板就是这 653 款，
 * 而库里明明还有 15,319 条 XD + 17,220 条机地游戏 —— 它们**没有配置要求**，
 * 就被整批判成了「无法判定」。
 *
 * 实测发现机地话题自带**完整的配置要求**（`game_info.pc_requirement` +
 * `game_info.game_sys_reqs`），且覆盖率高：
 *     最低配置 17,048/17,220 (99.0%) · 内存 95% · 显卡 91% · 容量 93% · DX 约 50%
 * ★★ 关键：机地条目与 XD 条目的封面 URL 里都带 **Steam appid**
 *     （机地 97.2%、XD 97.4%），两库交集 **14,343 款** ——
 *     所以两个源可以用 **appid 精确对齐**，不必做任何模糊名称匹配
 *     （本项目已被名称匹配误配坑过多次：`ZTE Blade A73` 被认成 `Samsung Galaxy A73`）。
 *
 * ⇒ 本脚本把三方数据按 appid join：
 *     ① `steam-req.json`（653 款，Steam 官方原文）
 *     ② `jidi-topics.json`（17,220 款，机地原文，含 dx / 容量）
 *     ③ `games.json`（端游库，用来给出机地/XD 两侧的 id，供「下载」弹窗取数）
 *   输出**逐字段标注来源**的合并结果 —— 前端能如实说「这条要求来自 Steam 官方」
 *   还是「来自机地」，而不是笼统地标一个「推断」。
 *
 * ★ 字段优先级：**Steam 官方优先，机地补缺**。
 *   理由：两者其实同源（机地的配置要求就是抓 Steam 的），
 *   但 steam-req 是我们直接从 Steam 取的原文，而机地那侧经过了一次中文转写
 *   （`DirectX 版本: 12`），多一道转写就多一处可能出错的地方。
 *   所以「有官方原文就用原文，没有才吃机地」。
 *
 * 用法：node tools/build-spec-req.js
 */
const fs = require('fs');
const path = require('path');
const { toGB, dxOf } = require('../data/spec-dict');

const DATA = path.join(__dirname, '..', 'data');
const F_JIDI = path.join(DATA, 'jidi-topics.json');
const F_STEAM = path.join(DATA, 'steam-req.json');
const F_GAMES = path.join(DATA, 'games.json');
const OUT = path.join(DATA, 'spec-req.json');

const APPID_RE = /\/apps\/(\d+)\//;

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {
    console.log('  ⚠️ 读不到 ' + path.basename(p) + '：' + e.message + '（按空处理）');
    return fallback;
  }
}

/**
 * 把任一来源的要求对象归一成判定用的紧凑形。
 * ★ 两个来源的字段名不同（steam 用 `dx:"9.0c"`，机地用 `dxV:9`），
 *   所以归一化只做一次、且在**合并之前** —— 合并后就没法区分谁是谁了。
 */
function normReq(o) {
  if (!o || typeof o !== 'object') return null;
  const out = {};

  const ram = toGB(o.ram);
  if (ram) out.ramGb = ram.gb;

  /* 机地已把容量算成 storageGb（它的 storage 文本是 "需要 75 GB 可用空间" 这种） */
  const st = o.storageGb != null ? o.storageGb : (toGB(o.storage) || {}).gb;
  if (st != null && st > 0) out.storageGb = Math.round(st * 10) / 10;

  const dx = o.dxV != null ? o.dxV : dxOf(o.dx);
  if (dx != null) out.dx = dx;

  if (o.os) out.os = String(o.os).replace(/\s+/g, ' ').trim().slice(0, 120);
  if (o.cpu) out.cpuRaw = String(o.cpu).replace(/\s+/g, ' ').trim().slice(0, 200);
  if (o.gpu) out.gpuRaw = String(o.gpu).replace(/\s+/g, ' ').trim().slice(0, 200);

  return Object.keys(out).length ? out : null;
}

/** 逐字段合并两个来源，并记录每个字段**最终来自谁** */
function mergeReq(a, aName, b, bName) {
  if (!a && !b) return { req: null, src: null };
  const req = {};
  const src = {};
  const FIELDS = ['ramGb', 'storageGb', 'dx', 'os', 'cpuRaw', 'gpuRaw'];
  for (const f of FIELDS) {
    if (a && a[f] != null) { req[f] = a[f]; src[f] = aName; }
    else if (b && b[f] != null) { req[f] = b[f]; src[f] = bName; }
  }
  return Object.keys(req).length ? { req, src } : { req: null, src: null };
}

(function main() {
  console.log('[spec-req] 读取三方数据…');
  const jidi = readJson(F_JIDI, { items: [] });
  const steam = readJson(F_STEAM, { map: {} });
  const games = readJson(F_GAMES, {});

  const jidiItems = jidi.items || [];
  const steamMap = steam.map || {};
  const gameArr = Object.values(games || {});

  /* ---- ① XD / 库内条目按 appid 建索引（用于给每款游戏挂上两侧 id） ---- */
  const xdByAppid = new Map();
  for (const g of gameArr) {
    if (!g || !g.cover) continue;
    const m = String(g.cover).match(APPID_RE);
    if (!m) continue;
    const appid = Number(m[1]);
    /* 同 appid 多条时保留信息更全的那条 */
    const old = xdByAppid.get(appid);
    if (!old || (!old.libId && g.id)) xdByAppid.set(appid, { id: g.id, source: g.source, title: g.title, url: g.url, cover: g.cover, size: g.size, score: g.score, updatedTs: g.updatedTs, dateLabel: g.dateLabel });
  }

  /* ---- ② Steam 官方要求按 appid 建索引 ---- */
  const steamByAppid = new Map();
  for (const [appid, v] of Object.entries(steamMap)) {
    if (!v) continue;
    steamByAppid.set(Number(appid), v);
  }

  /* ---- ③ 以机地全量为主干（它最大），并入 Steam 与 XD ---- */
  const out = {};
  let fromJidiOnly = 0;
  let fromSteamOnly = 0;
  let both = 0;
  let skippedNoAppid = 0;

  const push = (appid, rec) => {
    const old = out[appid];
    if (!old) { out[appid] = rec; return; }
    /* 合并（用于同一 appid 在机地有多条话题的罕见情况）：取热度更高的那条为主，补空字段 */
    if ((rec.hot || 0) > (old.hot || 0)) {
      for (const k of Object.keys(old)) if (rec[k] == null) rec[k] = old[k];
      out[appid] = rec;
    } else {
      for (const k of Object.keys(rec)) if (old[k] == null) old[k] = rec[k];
    }
  };

  for (const it of jidiItems) {
    if (!it || !it.appid) { skippedNoAppid++; continue; }
    const appid = Number(it.appid);
    const st = steamByAppid.get(appid);
    const xd = xdByAppid.get(appid);

    const minJ = normReq(it.min);
    const recJ = normReq(it.rec);
    const minS = st && st.min ? normReq(st.min) : null;
    const recS = st && st.rec ? normReq(st.rec) : null;

    const min = mergeReq(minS, 'steam', minJ, 'jidi');
    const rec2 = mergeReq(recS, 'steam', recJ, 'jidi');

    if (minJ || recJ) fromJidiOnly++;
    if (st && (minJ || recJ)) both++;
    else if (st) fromSteamOnly++;

    push(appid, {
      appid,
      name: it.title || (st && st.name) || (xd && xd.title) || ('appid ' + appid),
      nameEn: it.titleEn || null,
      cover: it.cover || (xd && xd.cover) || null,
      genres: it.genres && it.genres.length ? it.genres : null,
      size: it.size || (xd && xd.size) || null,
      score: it.score != null ? it.score : ((st && st.score) || (xd && xd.score) || null),
      /** ★ 热度：机地浏览量。用于「可适配游戏优先推热门」 */
      hot: it.dpv || 0,
      releaseDate: it.releaseDate || (xd && xd.dateLabel) || null,
      /** 机地话题 id —— 下载弹窗取机地网点用 */
      jidiTid: it.tid || null,
      /** 本库 / XD 的 id —— 下载弹窗取 XD 盘口用 */
      libId: (xd && xd.id) || null,
      libUrl: (xd && xd.url) || null,
      min: min.req,
      minSrc: min.src,
      rec: rec2.req,
      recSrc: rec2.src,
      /** 要求最终来自哪些源（'steam' / 'jidi' / 'steam+jidi'），前端用来说清依据 */
      reqFrom: (() => {
        const s = new Set();
        for (const f of Object.keys(min.src || {})) s.add(min.src[f]);
        for (const f of Object.keys(rec2.src || {})) s.add(rec2.src[f]);
        return s.size ? [...s].sort().join('+') : null;
      })(),
    });
  }

  /* ---- ④ 库里「有 Steam 官方要求但机地没收录」的少数条目也要进来 ---- */
  let steamOnlyAdded = 0;
  for (const [appid, v] of steamByAppid) {
    if (out[appid]) continue;
    const minS = v.min ? normReq(v.min) : null;
    const recS = v.rec ? normReq(v.rec) : null;
    if (!minS && !recS) continue;
    const xd = xdByAppid.get(appid);
    const min = mergeReq(minS, 'steam', null, 'jidi');
    const rec2 = mergeReq(recS, 'steam', null, 'jidi');
    push(appid, {
      appid,
      name: v.name || (xd && xd.title) || ('appid ' + appid),
      nameEn: null,
      cover: (xd && xd.cover) || ('https://shared.cdn.queniuqe.com/store_item_assets/steam/apps/' + appid + '/header.jpg'),
      genres: null,
      size: (xd && xd.size) || null,
      score: (xd && xd.score) || null,
      hot: 0,
      releaseDate: (xd && xd.dateLabel) || null,
      jidiTid: null,
      libId: (xd && xd.id) || null,
      libUrl: (xd && xd.url) || null,
      min: min.req,
      minSrc: min.src,
      rec: rec2.req,
      recSrc: rec2.src,
      reqFrom: 'steam',
    });
    steamOnlyAdded++;
  }

  const rows = Object.values(out);
  /* 按 appid 升序落盘 —— 保证两次构建的产物**逐字节可比**（便于 diff 抓退化） */
  rows.sort((a, b) => a.appid - b.appid);

  const stats = {
    total: rows.length,
    withMin: rows.filter((r) => r.min).length,
    withRec: rows.filter((r) => r.rec).length,
    withDx: rows.filter((r) => (r.min && r.min.dx != null) || (r.rec && r.rec.dx != null)).length,
    withStorage: rows.filter((r) => (r.min && r.min.storageGb != null) || (r.rec && r.rec.storageGb != null)).length,
    withRam: rows.filter((r) => (r.min && r.min.ramGb != null) || (r.rec && r.rec.ramGb != null)).length,
    withGpu: rows.filter((r) => (r.min && r.min.gpuRaw) || (r.rec && r.rec.gpuRaw)).length,
    withCover: rows.filter((r) => r.cover).length,
    withJidiTid: rows.filter((r) => r.jidiTid).length,
    withLibId: rows.filter((r) => r.libId).length,
    /** 有热度值的款数 —— 「热门优先」排序的有效范围 */
    withHot: rows.filter((r) => r.hot > 0).length,
    bySource: rows.reduce((a, r) => { const k = r.reqFrom || 'none'; a[k] = (a[k] || 0) + 1; return a; }, {}),
    skippedNoAppid,
    steamOnlyAdded,
    jidiCandidates: jidiItems.length,
    steamCandidates: Object.keys(steamMap).length,
    xdCandidates: xdByAppid.size,
  };

  fs.writeFileSync(OUT, JSON.stringify({
    builtAt: new Date().toISOString(),
    sources: {
      jidi: 'jidiyouxi.com /api/topic/get_topics（含 game_info.pc_requirement + game_sys_reqs）',
      steam: 'store.steampowered.com/api/appdetails（官方配置要求原文）',
      games: 'data/games.json（端游库，提供两侧 id）',
    },
    joinKey: 'steam appid（机地封面 97.2% / XD 封面 97.4% 均内嵌）',
    stats,
    map: rows.reduce((a, r) => { a[r.appid] = r; return a; }, {}),
  }));

  const mb = (fs.statSync(OUT).size / 1048576).toFixed(1);
  console.log('');
  console.log('[spec-req] 完成 → data/spec-req.json (' + mb + 'MB)');
  console.log('  合并后游戏数 **' + stats.total + '** 款（此前 spec-match 只能用 ' + stats.steamCandidates + ' 款）');
  console.log('  有最低配置 ' + stats.withMin + ' · 推荐配置 ' + stats.withRec +
    ' · 内存 ' + stats.withRam + ' · 容量 ' + stats.withStorage + ' · 显卡 ' + stats.withGpu + ' · ★DX ' + stats.withDx);
  console.log('  有封面 ' + stats.withCover + ' · 有机地话题 id ' + stats.withJidiTid + ' · 有库内 id ' + stats.withLibId + ' · 有热度 ' + stats.withHot);
  console.log('  要求来源分布：' + JSON.stringify(stats.bySource));
  console.log('  （机地侧 ' + stats.jidiCandidates + ' 条、Steam 侧 ' + stats.steamCandidates + ' 条、XD 侧 ' + stats.xdCandidates + ' 条）');
  if (skippedNoAppid) console.log('  ⚠️ 机地 ' + skippedNoAppid + ' 条无 appid 未入索引（无法与其它源对齐）');
})();
