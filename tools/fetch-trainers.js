/**
 * tools/fetch-trainers.js — 采集「修改器」数据（Game Cheats Manager 公开清单）
 *
 * 数据源：https://gamezonelabs.com/api/data/gcm    （公开 GET，免密钥，约 808KB）
 *   返回 { trainers: [...], counts: {...} }
 *   单条字段：game_name(英文名) / zhName(官方中文名) / version / origin / source
 *   counts：{ all:3742, gcm:20, community:665, fling:1152, xiaoxing:59, cheat_table:1846 }
 *
 * ★ 发现路径（记下来省得下次重找）：
 *   gamezonelabs.com 是 Next.js 站点，页面只显示 "Loading trainer data..."。
 *   → 抓 https://gamezonelabs.com/products/gcm/trainers 的 HTML，拿到 /_next/static/chunks/*.js
 *   → 逐个 chunk grep `"/api/` → 命中 "/api/data/gcm"
 *
 * ★ 为什么不做「直链下载」：
 *   GCM 客户端的下载走 get_signed_download_url()，依赖仓库外的 secret_config
 *   （SIGNED_URL_DOWNLOAD_ENDPOINT + CLIENT_API_KEY），拿到的是一次性 S3 签名 URL。
 *   我们无法离线复现，也不该绕过。所以详情页只做「信息 + 获取引导」。
 *
 * ★ 为什么之前匹配率只有 2%（重要）：
 *   端游库 data/games.json 的 title 是**多语言斜杠拼接串**，形如
 *     「艾尔登法环/ELDEN RING」「赛博朋克2077/Cyberpunk 2077」
 *   若整串归一化，斜杠被吞掉会变成 `艾尔登法环eldenring` 这种拼接怪物，永远匹配不上。
 *   → 正确做法：**按 `/` 切段，每段单独入索引**（本脚本 libIndex 段即为此）。
 *     实测：整串 2.0%  →  分段 73.8%
 *
 * ★ 另一个顺带发现：端游库 cover 里带 Steam appid
 *     https://shared.cdn.queniuqe.com/store_item_assets/steam/apps/1245620/header.jpg
 *   抽出来就是 appid，可作为跨语言桥（也和 Ludusavi 的 steam.id 同口径）。
 *
 * 用法：
 *   node tools/fetch-trainers.js            # 联网抓取 + 匹配 + 落盘
 *   node tools/fetch-trainers.js --offline  # 用 data/_gcm-raw.json 缓存重跑（改匹配逻辑时用）
 */
const fs = require('fs');
const path = require('path');

const D = path.join(__dirname, '..', 'data');
const SRC = 'https://gamezonelabs.com/api/data/gcm';
const CACHE = path.join(D, '_gcm-raw.json');
const OUT = path.join(D, 'trainers.json');

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GameHub/1.0' };
const REQ_TIMEOUT = 20000;

/* 五个来源的展示元信息。
 * site 只填**确认可用**的：不确定的宁可指向 GCM 自己的库页面，也不要编一个站外链接。 */
const SOURCE_META = {
  gcm: { label: 'GCM 精选', desc: '官方亲自整理的冷门佳作修改器' },
  community: { label: '社区贡献', desc: '社区上传并经人工审核的修改器' },
  fling: { label: '风灵月影', desc: '业界标准，数量最多、最受信任' },
  xiaoxing: { label: '小幸修改器', desc: '专攻亚洲向作品，功能通常更丰富' },
  cheat_table: { label: 'CE 修改表', desc: 'Cheat Engine 修改表，覆盖面极广' },
};

/* ★★ v10.48：给「第三方来源」一条可点的跳转链 + 一个短标签。
 *
 * 背景（这是本轮用户报的问题的根因）：
 *   用户口径「修改器中的第三方修改器来源我也需要你提供跳转链接」。
 *   上游 `official_url` **本来就有**（实测 3,597 / 3,875 = 92.8%），
 *   本地缓存 `_gcm-raw.json` 里**也一直存着** —— 是这里写 `items` 时
 *   只挑了 11 个字段、把它丢了；而 res-groups 的 `page` 指向 `libUrl`
 *   （端游库的 xdgame 链接）⇒ 点过去是游戏详情，不是修改器来源站。
 *
 * ★ 为什么按**主机名**判定、而不是按 `source`：
 *   同一个 `source=community`（595 条）下面混着 mrantifun.net / nexusmods.com /
 *   bilibili.com / github.com / playground.ru … 十几个站，
 *   按 source 只能给一个笼统标签，点进去仍不知道去哪。
 *
 * ★ 标签为什么控制在 12 字符内：卡内 `.gl-lk a` 是 `.slice(0, 12)` 截断展示的
 *   （见 tools/resource-sections.js 的 glRow），写长了会被截成半截词。 */
const SITE_MATCH = [
  [/flingtrainer\.com$/i, '风灵月影', 'fling'],
  [/thecheatscript\.com$/i, 'CheatScript', 'cheat'],
  [/fearlessrevolution\.com$/i, 'FearlessRev', 'src'],
  [/xiaoxingjie\.com$/i, '小幸', 'src'],
  [/mrantifun\.net$/i, 'MrAntiFun', 'src'],
  [/nexusmods\.com$/i, 'Nexus', 'src'],
  [/3dmgame\.com$/i, '3DM', 'src'],
  [/bilibili\.com$/i, 'B站', 'src'],
  [/ali213\.net$/i, '游侠', 'src'],
  [/github\.com$/i, 'GitHub', 'src'],
  [/playground\.ru$/i, 'PG', 'src'],
  [/megagames\.com$/i, 'MegaGames', 'src'],
  [/pvzge\.com$/i, 'PVZGE', 'src'],
];

/** 由 official_url 推出「跳转标签 + 通道配色类 + 主机名」；非 http(s) 或空 ⇒ null */
function siteOf(u) {
  const s = String(u || '').trim();
  if (!/^https?:\/\//i.test(s)) return null;
  let host = '';
  try { host = new URL(s).host; } catch (e) { return null; }
  for (const [re, label, cls] of SITE_MATCH) {
    if (re.test(host)) return { label, cls, host };
  }
  /* 没登记的主机：不编标签，直接用主机名（去掉 www.），配色落到中性的 bd-src */
  return { label: host.replace(/^www\./, '').split('.')[0].slice(0, 12), cls: 'src', host };
}

/** 与 data/mobilehub.js 的 normKey 保持同一口径 */
function normKey(s) {
  return String(s || '').toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[：:·・,，.。!！?？'"“”‘’()（）\[\]【】《》<>~～\-–—_+*&/／|｜\\]/g, '');
}

/** 从 cover 反抽 Steam appid（端游库的 cover 是 steam 资源） */
function steamIdOf(cover) {
  const m = /\/steam\/apps\/(\d+)\//.exec(String(cover || ''));
  return m ? m[1] : '';
}

/** 建端游库索引：★ 按 `/` 切段，每段单独入索引（本文件头有详细说明） */
function buildLibIndex(all) {
  const byName = new Map();   // 归一化名 -> item
  const bySteam = new Map();  // steam appid -> item
  const addName = (k, it) => {
    if (!k || k.length < 3 || byName.has(k)) return;
    byName.set(k, it);
  };
  for (const it of all) {
    for (const seg of String(it.title || '').split('/')) addName(normKey(seg), it);
    // 别名数组（部分条目有）
    for (const a of it.aliases || []) addName(normKey(a), it);
    const sid = steamIdOf(it.cover);
    if (sid && !bySteam.has(sid)) bySteam.set(sid, it);
  }
  return { byName, bySteam };
}

async function fetchSource() {
  const ac = AbortSignal.timeout(REQ_TIMEOUT);
  const r = await fetch(SRC, { headers: UA, signal: ac });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return await r.json();
}

(async () => {
  const offline = process.argv.includes('--offline');

  let raw;
  if (offline) {
    if (!fs.existsSync(CACHE)) throw new Error(`--offline 需要 ${path.basename(CACHE)}，先跑一次联网模式`);
    raw = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
    console.log(`来源：本地缓存 ${path.basename(CACHE)}`);
  } else {
    console.log(`拉取 ${SRC} …`);
    raw = await fetchSource();
    fs.writeFileSync(CACHE, JSON.stringify(raw), 'utf8');
    console.log(`  已缓存 → ${path.basename(CACHE)}（${(fs.statSync(CACHE).size / 1024).toFixed(0)}KB）`);
  }

  const trainers = raw.trainers || [];
  console.log(`修改器条目：${trainers.length}`);
  console.log(`官方 counts：${JSON.stringify(raw.counts || {})}`);

  /* 端游库就位 */
  const gamesDb = require('../data/gamesDb');
  gamesDb.load();
  const all = gamesDb.all();
  const { byName, bySteam } = buildLibIndex(all);
  console.log(`端游库：${all.length} 款 → 索引键 ${byName.size} 个（按 / 分段）｜ steamId ${bySteam.size} 个`);

  const items = [];
  const bySource = {};
  let matched = 0, matchedByZh = 0, matchedByEn = 0;
  const seen = new Set();   // 同名去重（同款可能出现在多个源，保留各源各一条但避免完全重复）

  for (const t of trainers) {
    const en = String(t.game_name || '').trim();
    const zh = String(t.zhName || '').trim();
    if (!en && !zh) continue;

    const src = String(t.source || t.origin || 'unknown');
    bySource[src] = (bySource[src] || 0) + 1;

    const hitEn = en ? byName.get(normKey(en)) : null;
    const hitZh = zh ? byName.get(normKey(zh)) : null;
    const lib = hitZh || hitEn || null;
    if (lib) {
      matched++;
      if (hitZh) matchedByZh++;
      if (hitEn) matchedByEn++;
    }

    const key = src + '|' + normKey(en || zh);
    if (seen.has(key)) continue;
    seen.add(key);

    const sid = steamIdOf(lib && lib.cover);

    /* ★ v10.48：这三个字段原先被丢掉 —— 见 SITE_MATCH 上方那段背景。
     *   `officialUrl` 是**来源站上这条修改器的落地页**（不是端游库链接）；
     *   `author` 是原作者（386 个不同作者，MrAntiFun / Fullcodes / 桂Cinnamon …）；
     *   `toolName` 是工具自己的名字（「物品编辑器」「数据查询修改工具」），
     *   与 `name`（游戏名）是两回事 —— 之前只有游戏名，卡面看不出这是个什么工具。 */
    const officialUrl = String(t.official_url || '').trim();
    const site = siteOf(officialUrl);

    items.push({
      k: normKey(en || zh),
      name: en || zh,
      zh: zh || '',
      version: String(t.version || ''),
      source: src,
      origin: String(t.origin || ''),
      libId: lib ? lib.id : '',
      libTitle: lib ? lib.title : '',
      libCover: lib ? lib.cover : '',
      libUrl: lib ? lib.url : '',
      steamId: sid,
      officialUrl,
      siteLabel: site ? site.label : '',
      siteCls: site ? site.cls : '',
      author: String(t.author || '').trim(),
      toolName: String(t.custom_name_zh || t.custom_name_en || t.custom_name || '').trim(),
    });
  }

  /* ★ v10.48：来源跳转链的覆盖率要**进 stats** ——
   *   卡面上「第三方修改器没有跳转链接」这种退化必须能被一眼看出来，
   *   而不是等用户点开每一个才发现。见 ROADMAP 的「来源跳转覆盖」一栏。 */
  const withUrl = items.filter((x) => x.officialUrl).length;
  const withAuthor = items.filter((x) => x.author).length;
  const bySite = {};
  for (const x of items) if (x.siteLabel) bySite[x.siteLabel] = (bySite[x.siteLabel] || 0) + 1;

  const meta = SOURCE_META;
  const stats = {
    builtAt: Date.now(),
    total: items.length,
    rawTotal: trainers.length,
    matched,
    unmatched: items.length - matched,
    matchedRate: items.length ? +(matched / items.length * 100).toFixed(1) : 0,
    matchedByZh,
    matchedByEn,
    withUrl,
    urlPct: items.length ? +(withUrl / items.length * 100).toFixed(1) : 0,
    withAuthor,
    bySite,
    bySource,
    sources: Object.keys(bySource).map((k) => ({
      key: k,
      label: (meta[k] && meta[k].label) || k,
      desc: (meta[k] && meta[k].desc) || '',
      count: bySource[k],
    })).sort((a, b) => b.count - a.count),
  };

  fs.writeFileSync(OUT, JSON.stringify({ builtAt: stats.builtAt, stats, items }), 'utf8');

  console.log('\n=== 采集结果 ===');
  console.log(`条目 ${stats.total} ｜ 命中端游库 ${stats.matched}（${stats.matchedRate}%）`);
  console.log(`  其中：中文名命中 ${matchedByZh} ｜ 英文名命中 ${matchedByEn}`);
  console.log('分源：');
  stats.sources.forEach((s) => console.log(`  ${s.label.padEnd(8)} ${String(s.count).padStart(5)}`));
  /* ★ v10.48：来源跳转链覆盖率（本轮补回来的 official_url） */
  console.log(`来源跳转链 ${stats.withUrl} / ${stats.total}（${stats.urlPct}%）｜ 有署名 ${stats.withAuthor}`);
  console.log('来源站 top10：');
  Object.entries(stats.bySite).sort((a, b) => b[1] - a[1]).slice(0, 10)
    .forEach(([k, v]) => console.log(`  ${k.padEnd(14)} ${String(v).padStart(5)}`));
  console.log(`\n✅ 已写出 data/${path.basename(OUT)}（${(fs.statSync(OUT).size / 1024).toFixed(0)}KB）`);
})();
