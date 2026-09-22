/**
 * data/pcreq.js — PC 配置要求（最低 / 推荐）本地缓存 + 实时兜底
 *
 * ★ 为什么要有这一层（v10.13）：
 *   用户反馈「详情页的游玩配置没有了」。排查结果：XDGAME 详情页**本身已完全没有
 *   配置要求数据**（改版后只剩 游戏厂商 / 发行日期 / 更新时间 / 版本介绍），
 *   而前端 `d.requirements ? ...` 是「没有就整块不渲染」——
 *   于是 XD 来源的 15,302 款游戏，详情页里那块配置信息是**永久空白**的。
 *
 *   机地(jidiyouxi)的详情接口有 game_sys_reqs，但机地只收录了其中一部分话题。
 *   所以补一条覆盖率更高的通路：**Steam 官方商店接口**。
 *
 * ★ 为什么能对上 97% 的库：
 *   本库 15,302 款里 14,876 款（97.2%）的封面 URL 是 Steam CDN 形态
 *   `https://shared.cdn.queniuqe.com/store_item_assets/steam/apps/<appid>/...`，
 *   appid 直接可提取 → 调
 *   `https://store.steampowered.com/api/appdetails?appids=<appid>&l=schinese&filters=basic,pc_requirements`
 *   就能拿到**官方中文**的「最低配置 / 推荐配置」。
 *
 *   ⚠️ filters 的坑：只写 `filters=pc_requirements` 时 Steam 会返回 `data: []`
 *      （实测 200 但空），必须带上 `basic` —— 见 v10.13 的 probe 记录。
 *
 * ★ 三级兜底（调用方不需要知道细节，`resolve()` 一路走到底）：
 *   ① 本地缓存 data/steam-req.json（tools/build-steam-req.js 预热 + 运行时回写）
 *   ② 实时抓 Steam（串行限流，结果回写缓存；失败/未收录也写负缓存，避免反复打）
 *   ③ 同名机地话题（机地详情页的 game_sys_reqs）—— Steam 没有中文条目时的兜底
 *
 * 数据形态（每个 appid 一条）：
 *   { min:{os,cpu,ram,gpu,dx,net,storage,note}, rec:{...}, name, ts, miss? }
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'steam-req.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

let db = null;          // { builtAt, src, count, map }
let dirty = false;
let flushTimer = null;

function emptyDb() {
  return { builtAt: 0, src: 'steam-appdetails', count: 0, map: {} };
}
function ensure() {
  if (db) return db;
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    db = { builtAt: j.builtAt || 0, src: j.src || 'steam-appdetails', count: 0, map: j.map || {} };
    db.count = Object.keys(db.map).length;
  } catch (e) {
    db = emptyDb();
  }
  return db;
}

/** 落盘（合并写，避免每抓一条就同步写 2MB 文件） */
function flush(force) {
  if (!dirty) return;
  if (!force && flushTimer) return;
  const doWrite = () => {
    flushTimer = null;
    if (!dirty || !db) return;
    dirty = false;
    try {
      db.builtAt = db.builtAt || Date.now();
      db.count = Object.keys(db.map).length;
      fs.writeFileSync(FILE, JSON.stringify({ builtAt: db.builtAt, src: db.src, count: db.count, map: db.map }));
    } catch (e) { /* 写不进去（只读盘）也不影响内存可用 */ }
  };
  if (force) return doWrite();
  flushTimer = setTimeout(doWrite, 5000);
  if (flushTimer.unref) flushTimer.unref();
}
process.on('exit', () => flush(true));

/** 封面 URL → Steam appid（本库封面 97.2% 命中） */
function appidOf(cover) {
  const m = String(cover || '').match(/\/steam\/apps\/(\d+)\//);
  return m ? m[1] : '';
}

/* ---------------- Steam pc_requirements 解析 ---------------- */
const FIELD_MAP = [
  [/操作系统|^OS$|Operating System/i, 'os'],
  [/处理器|^Processor$/i, 'cpu'],
  [/内存|^Memory$/i, 'ram'],
  [/显卡|图形|^Graphics$/i, 'gpu'],
  [/DirectX/i, 'dx'],
  [/网络|^Network$/i, 'net'],
  [/存储|硬盘|^Storage|Hard Drive/i, 'storage'],
  [/附注|备注|^Additional Notes/i, 'note'],
];
const stripTags = (s) => String(s == null ? '' : s)
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ')
  .trim();

/** Steam 的配置 HTML → 结构化字段；取不到任何字段返回 null */
function parseReq(html) {
  if (!html) return null;
  const out = {};
  for (const m of String(html).matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
    const line = stripTags(m[1]);
    if (!line) continue;
    const sep = line.search(/[:：]/);
    if (sep < 0) continue;
    const label = line.slice(0, sep).trim();
    const val = line.slice(sep + 1).trim();
    if (!val) continue;
    for (const [re, key] of FIELD_MAP) {
      if (re.test(label)) { if (!out[key]) out[key] = val; break; }
    }
  }
  /* 有些条目把「最低配置:」写在 li 外面（<strong>最低配置:</strong><br><ul>…）
   * 这种情况下上面照样能取到；万一一个 li 都没有，退回按 <strong> 切分 */
  if (!Object.keys(out).length) {
    const flat = stripTags(html);
    for (const [re, key] of FIELD_MAP) {
      const m = flat.match(new RegExp('(?:' + re.source + ')\\s*[:：]\\s*([^:：]{2,120}?)(?=\\s*(?:操作系统|处理器|内存|显卡|DirectX|网络|存储|附注|$))', 'i'));
      if (m) out[key] = m[1].trim();
    }
  }
  return Object.keys(out).length ? out : null;
}

/* ---------------- 限流抓取队列 ----------------
 * Steam appdetails 有速率限制（经验值 ~200 次 / 5 分钟）。
 * 这里串行 + 最小间隔 1100ms ≈ 54 次/分钟，稳；单条超时 12s，失败即返回（不重试，
 * 交给负缓存，避免用户等待时卡住）。
 */
const MIN_GAP = 1100;
let lastAt = 0;
let chain = Promise.resolve();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function throttled(fn) {
  const p = chain.then(async () => {
    const gap = Date.now() - lastAt;
    if (gap < MIN_GAP) await wait(MIN_GAP - gap);
    lastAt = Date.now();
    return fn();
  });
  chain = p.catch(() => {});
  return p;
}

async function fetchSteam(appid) {
  const url = 'https://store.steampowered.com/api/appdetails?appids=' + appid + '&l=schinese&filters=basic,pc_requirements';
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  const node = j && j[appid];
  if (!node || !node.success || !node.data) return null;
  const pc = node.data.pc_requirements || {};
  const min = parseReq(pc.minimum);
  const rec = parseReq(pc.recommended);
  if (!min && !rec) return null;
  return { min, rec, name: stripTags(node.data.name || '').slice(0, 80) };
}

/* ---------------- ★ v10.32：按名称搜索（双语 + 名称校验） ----------------
 *
 * 用户口径：「配置要求有没有办法从其他地方补全**或者同时用中英文游戏名称进行搜索后补充**」。
 * 查清后，第 3 个来源（PCGamingWiki）实测被 Cloudflare 403 拦死、不可用；
 * 真正能补的是**这条搜索通路本身**——它当时有三个缺陷：
 *
 *   ① **只搜中文段**：`title.split('/')[0]` 把英文段整个丢掉。
 *      实测（tools/_probe-req-search.js，n=26）「中文有结果 14 / 英文有结果 8 /
 *      任一有结果 17」⇒ 双语能把 14 抬到 17。受益者是**中文名搜不出、英文名能搜出**的那批：
 *        「生化危机9：安魂曲」中文 0 结果 · 英文段 `Resident_Evil_Requiem` ⇒ 命中 Resident Evil Requiem
 *        「钢铁雄心IV」中文 0 结果 · 英文段 `Hearts of Iron IV` ⇒ 命中
 *        「侠盗猎车手5」中文 0 结果 · 英文段 `GTA5` ⇒ 命中（但缩写过不了校验，见下）
 *
 *   ② **不校验结果**：直接取 `items[0]`。实测这是**会安错数据**的：
 *        「心灵杀手2/Alan Wake 2」⇒ storesearch 首条返回
 *        `3274290:Beat Saber - Monstercat Mixtape 2`（毫不相干的 DLC）。
 *      配置要求是具体数值，**安错比不显示更糟**（本文件既有铁律）。
 *
 *   ③ **未命中不留痕**：搜不到就直接 return，下次打开详情页再搜一遍
 *      （2 次 storesearch × 1.1s 限流 ≈ 2.2s 白等）。台面上机地 3,622 条里
 *      99.6% 没有 appid ⇒ 这条通路是它们的主力，反复误伤。
 *
 * ★ 校验用「与**库内标题的任一段**归一化后完全相等」，而不是「与本次 query 比」：
 *   中文 query 命中的结果名可能是英文（实测「生化危机 4」⇒ `Resident Evil 4`），
 *   拿 query 比会整类误杀。完全相等这一条**够严、零误判**，代价是丢掉
 *   「库名『红色沙漠』vs 商店名『红色沙漠：增强版』」这类后缀差异 ——
 *   那些宁可不要：同系列不同作品的推荐配置本来就不同（见下 twinOf 的同类闸门）。
 */
/** 比对用归一化：去书名号/标点/空白，转小写。只用于「是不是同一个名字」。 */
function normName(s) {
  return String(s || '')
    .replace(/[《》〈〉【】「」『』（）()\[\]{}]/g, '')
    .replace(/[：:；;，,、。.·・\-—_~～!！?？'"“”‘’\s]/g, '')
    .toLowerCase();
}

/** 标题 → 搜索词候选（按原顺序：本库标题几乎都是「中文/English」⇒ 中文优先）。
 *  英文段额外产出一个「下划线转空格」的变体（`Resident_Evil_Requiem`）。 */
function titleParts(title) {
  const segs = String(title || '').split('/').map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const s of segs) {
    if (/[A-Za-z]{3,}/.test(s)) {
      const sp = s.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
      if (sp && sp !== s) out.push(sp);
    }
    out.push(s);
  }
  return [...new Set(out)].filter((s) => s.length >= 2);
}

/** 结果名与库内标题的某一段是同一个名字吗？返回判定等级（0 否 / 1 包含 / 2 完全相等）
 *
 *  ★ 为什么要分两级（这一步是**实拍推翻初版设计**得来的，别改回去）：
 *    初版只认「完全相等」，实测把 3 条**正确**结果全误杀了 ——
 *    Steam 的中文商店名经常不是库名的简单形式：
 *      · `The Blood of Dawnwalker 黎明行者之血`（英文+中文拼接，库里是分开两段）
 *      · `红色沙漠：增强版`（库名「红色沙漠」+ 版本后缀）
 *      · `《命令与征服：红色警戒 2 及尤里的复仇》`（系列名前缀 + 副标题后缀）
 *    这三条旧算法都取对了，是**校验太严**把人误伤，不是旧算法错。
 *
 *  ⚠️ 「包含」会放过「艾尔登法环 黑夜君临」这类同系列续作（推荐配置不同）。
 *     缓解手段在 pickBySearch：**候选内先扫「完全相等」，一条都没有才退到包含**，
 *     且包含还要排在「多段交叉」之后（交叉是更强、与名字形态无关的证据）。
 */
function nameMatchLevel(resultName, parts) {
  const r = normName(resultName);
  if (r.length < 2) return 0;
  let lvl = 0;
  for (const p of parts) {
    const q = normName(p);
    if (q.length < 2) continue;
    if (q === r) return 2;
    /* 包含：中文段要 ≥3 字、英文段要 ≥4 字符 —— 否则「NBA」「2077」这类短串会乱配 */
    const minLen = /[\u4e00-\u9fa5]/.test(q) ? 3 : 4;
    if (q.length >= minLen && r.includes(q)) lvl = 1;
  }
  return lvl;
}

/** 严格判定（完全相等）—— 保留单独一个函数名，探针与调用方读起来更明确。 */
function nameMatches(resultName, parts) {
  return nameMatchLevel(resultName, parts) === 2;
}

/** storesearch 前若干条候选（带名字 —— 校验要用，所以不能只回 id）。 */
async function searchCandidates(term) {
  const url = 'https://store.steampowered.com/api/storesearch/?term=' + encodeURIComponent(term) + '&l=schinese&cc=cn';
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) return [];
  const j = await r.json();
  return (j.items || [])
    .slice(0, 6)
    .map((x) => ({ id: String(x.id || ''), name: stripTags(x.name || '') }))
    .filter((x) => x.id);
}

/** 双语搜索 + 名称校验 ⇒ { appid, name, via, how } | null（null = 明确搜不到，可写负缓存）
 *
 *  三级判据，**从强到弱**依次兜（顺序不能换，每一级的证据强度不同）：
 *   ① `name`  —— 结果名与库内标题的某一段**完全相等**：最硬，命中即返回，不再多搜。
 *   ② `cross` —— 两段搜索的候选**有共同 appid**：与名字形态无关的独立证据。
 *       实测受益：库名「红色沙漠」vs 商店名「红色沙漠：增强版」（第 ① 级判不出，
 *       但中英两段都指向 3321460）。也挡得住「心灵杀手2 / Alan Wake 2 ⇒ Beat Saber」
 *       （两边候选无交集）。
 *   ③ `loose` —— 结果名**包含**库名段：最弱，兜「商店名带系列前缀/副标题」的情况。
 *       实测受益：「红色警戒2/红警2/红警3」只有首段搜得出结果（另两段 0 候选，
 *       交叉无从做起），而商店名是 `《命令与征服：红色警戒 2 及尤里的复仇》`。
 *       ⚠️ 它排在 cross 之后，也只在「一条完全相等都没有」时才轮到 —— 因为
 *         它会放过「艾尔登法环 黑夜君临」这类同系列续作。
 *
 *  ⚠️ 单语条目（无 `/`，实测 3,136 条 / 16.5%）只有一段，**永远走不到 ② ③**，
 *     只能靠 ① —— 所以绝不能用「双语交叉」替代名称判据。
 */
async function pickBySearch(title) {
  const parts = titleParts(title);
  if (!parts.length) return null;
  const perPart = [];
  let loose = null;
  for (const q of parts) {
    const cands = await throttled(() => searchCandidates(q));
    /* ① 遍历候选找「完全相等」，而不是只看首条：实测「艾尔登法环」的第 2、3 条是
       「艾尔登法环 黑夜君临」「艾尔登法环 黄金树幽影」（同系列不同作品），
       只看首条一旦顺序变化就会安错。 */
    const exact = cands.find((c) => nameMatchLevel(c.name, parts) === 2);
    if (exact) return { appid: exact.id, name: exact.name, via: q, how: 'name' };
    if (!loose) {
      const l = cands.find((c) => nameMatchLevel(c.name, parts) === 1);
      if (l) loose = { appid: l.id, name: l.name, via: q };
    }
    perPart.push({ q, cands });
  }
  /* ② 多段候选交集（强证据优先于字符串包含） */
  if (perPart.length >= 2) {
    for (const a of perPart[0].cands) {
      for (const b of perPart.slice(1)) {
        if (b.cands.some((c) => c.id === a.id)) {
          return { appid: a.id, name: a.name, via: perPart[0].q, how: 'cross' };
        }
      }
    }
  }
  /* ③ 字符串包含兜底 */
  if (loose) return Object.assign({ how: 'loose' }, loose);
  return null;
}

/** 同步读缓存（不触发网络） */
function peek(appid) {
  if (!appid) return null;
  const e = ensure().map[appid];
  if (!e) return null;
  if (e.miss) {
    /* 负缓存 7 天过期，过期后允许重试 */
    return (Date.now() - (e.ts || 0)) < 7 * 864e5 ? { miss: true } : null;
  }
  return e;
}

function save(appid, val) {
  const d = ensure();
  d.map[appid] = Object.assign({ ts: Date.now() }, val);
  d.count = Object.keys(d.map).length;
  dirty = true;
  flush(false);
}

/**
 * 解析某款游戏的 PC 配置要求。
 *   opts: { title, cover, appid }
 * 返回 { ok, hit, src:'steam'|null, appid, min, rec }
 */
async function resolve(opts = {}) {
  let appid = String(opts.appid || '').trim() || appidOf(opts.cover);
  if (appid) {
    const c = peek(appid);
    if (c && !c.miss) return { ok: true, hit: true, src: 'steam', appid, min: c.min || null, rec: c.rec || null, name: c.name || '' };
    if (!c) {
      try {
        const got = await throttled(() => fetchSteam(appid));
        if (got) {
          save(appid, got);
          return { ok: true, hit: true, src: 'steam', appid, min: got.min, rec: got.rec, name: got.name };
        }
        save(appid, { miss: true });
      } catch (e) {
        /* 网络异常**不写负缓存**（否则一次抖动会把这款游戏永久判成「无配置」），
         * 但要如实上抛 error，让预热脚本能区分「Steam 真没收录」与「这次抓取失败」。 */
        return { ok: true, hit: false, src: null, appid, min: null, rec: null, error: String(e.message || e) };
      }
    }
  }
  /* 无 appid（封面非 Steam CDN）：**中英文双语**名称搜索 + 名称校验，再走同一条路。
   * ★ v10.32：机地 3,622 条里 99.6% 没有 appid ⇒ 这条是它们的主力通路。
   *   `q:<归一化标题>` 作键写缓存（含负缓存）：否则「搜不到」的游戏每次打开详情页
   *   都要重搜 2.2s（双语各一次 storesearch，1.1s 限流）。 */
  if (!appid && opts.title) {
    const key = 'q:' + normName(opts.title).slice(0, 80);
    const c = peek(key);
    if (c && !c.miss) {
      return { ok: true, hit: true, src: 'steam', appid: c.appid || '', min: c.min || null, rec: c.rec || null, name: c.name || '' };
    }
    if (!c) {
      try {
        const picked = await pickBySearch(opts.title);
        if (picked) {
          const got = await throttled(() => fetchSteam(picked.appid));
          if (got) {
            save(picked.appid, got);
            save(key, Object.assign({ appid: picked.appid, via: picked.via }, got));
            return { ok: true, hit: true, src: 'steam', appid: picked.appid, min: got.min, rec: got.rec, name: got.name };
          }
        }
        /* 明确搜不到（或搜到但过不了名称校验）⇒ 写负缓存，7 天后再试。
           ⚠️ 只有走到这里才写：`searchCandidates` 抛错（网络抖动）时不该被判成「没收录」。 */
        save(key, { miss: true });
      } catch (e) { /* 网络异常不写负缓存 —— 与 appid 分支同一理由，见上面 catch 的注释 */ }
    }
  }
  return { ok: true, hit: false, src: null, appid: appid || '', min: null, rec: null };
}

function stats() {
  const d = ensure();
  let withReq = 0, miss = 0, searchKeys = 0;
  for (const k of Object.keys(d.map)) {
    /* ★ v10.32：`q:` 前缀是「按名称搜索」的结果键（含负缓存），
       与 appid 键不是一回事 —— 混在一起报会让「cached 有多少款游戏」虚高。 */
    if (k.startsWith('q:')) { searchKeys++; continue; }
    if (d.map[k].miss) miss++; else withReq++;
  }
  return { ok: true, builtAt: d.builtAt, src: d.src, cached: d.count, withReq, miss, searchKeys };
}

module.exports = {
  resolve, peek, appidOf, parseReq, stats, save, _file: FILE,
  /* ★ v10.32：导出这几个是为了让 A/B 探针（tools/_probe-req-ab.js）能
     在**不改产品代码**的前提下对比「旧单语无校验」与「新双语带校验」的命中差异。 */
  normName, titleParts, nameMatches, nameMatchLevel, searchCandidates, pickBySearch,
};
