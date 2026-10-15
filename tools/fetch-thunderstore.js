/** tools/fetch-thunderstore.js — Thunderstore MOD 直链补源（v10.81 / P2 · 门 1）
 *
 * ── 为什么是这个源（实测 2026-10-15）────────────────────────
 * MOD 目前的唯一来源是机地社区帖（8,943 条，全是网盘口令）—— 机地**不托管文件**，
 * 反编译也变不出直链。Thunderstore 是 PC MOD 的官方社区平台，**文件自托管在自家 CDN**：
 *
 *   ① 社区清单   GET /api/experimental/community/            （100/页 · cursor 翻页）
 *                 → {identifier, name}  name 是英文名，拿来跟库内端游匹配
 *   ② 社区包列表 GET /api/cyberstorm/listing/<identifier>/?ordering=most-downloaded&page=N
 *                 （20/页）→ {namespace, name, download_count, size, icon_url, …}
 *                 ⚠️ listing **不含版本号** —— download_url 必须带版本
 *   ③ 包详情     GET /api/experimental/package/<ns>/<name>/
 *                 → latest.download_url = https://thunderstore.io/package/download/<ns>/<name>/<ver>/
 *                 （302 → ccdn.thunderstore.io/...zip，实测 200 application/zip、无防盗链）
 *   ★ 禁用 /c/<community>/api/v1/package/（全量重端点，之前拍板不用 —— 门 1 方案铁律）。
 *
 * ── 匹配口径（宁缺毋滥）─────────────────────────────────────
 *   社区 name 归一化后与库内端游（games.json 的 `英文/` 段）**精确相等**才建关联；
 *   另配一张手工别名表兜住已知错位。没有前缀/子串匹配 —— 社区名短，
 *   宽松匹配会出「raft → Raft: 九死一生?」之类的误亲。
 *
 * ── 输出 ────────────────────────────────────────────────────
 *   data/thunderstore.json
 *   { builtAt, stats, games: [{libId, community, title, packages: [
 *        {ns, name, version, downloads, size, icon, desc, url}]}], unmatched: [identifier…] }
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { getHtml } = require('../shared');   /* UA 在下面 fetch 里手写（JSON 接口不吃 getHtml 的 HTML 判空） */

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'thunderstore.json');
const GAMES = path.join(ROOT, 'data', 'games.json');

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i >= 0 ? (process.argv[i + 1] || true) : d;
};
const PAGES = parseInt(arg('pages', '2'), 10);    /* 每社区抓几页 listing（20/页） */
const PER = parseInt(arg('per', '24'), 10);       /* 每社区最多留几个包（取最热的前 PER） */
const DELAY = parseInt(arg('delay', '180'), 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36';

async function apiJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' @ ' + url);
  return r.json();
}

/* ---- 归一化与匹配 ---- */
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
/* 库内标题是「中文名/English Name」—— 取英文段做匹配面 */
function enParts(title) {
  return String(title || '').split(/[／/]/).map((x) => x.trim()).filter((x) => /[a-zA-Z]/.test(x));
}
/* 已知错位兜底：社区 identifier → 库内英文名（norm 后相等才算，所以这里也写 norm 形） */
const ALIAS = {
  'risk-of-rain2': 'riskofrain2',
  'lethal-company': 'lethalcompany',
  'the-forest': 'theforest',
  'subnautica': 'subnautica',
  'palworld': 'palworld',
  'valheim': 'valheim',
  'cyberpunk-2077': 'cyberpunk2077',
  'elden-ring': 'eldenring',
  'baldurs-gate3': 'baldursgate3',
  'hollow-knight-silksong': 'hollowknightsilksong',
  'deep-rock-galactic': 'deeprockgalactic',
  'satisfactory': 'satisfactory',
  'raft': 'raft',
  'cities-skylines-ii': 'citiesskylines2',
  'helldivers-2': 'helldivers2',
  'monster-hunter-wilds': 'monsterhunterwilds',
  'monster-hunter-rise': 'monsterhuntrise',
  'monster-hunter-world': 'monsterhunterworld',
  'resident-evil-4-hd': 'residentevil4',
  'resident-evil-village': 'residentevilvillage',
  'stardew-valley': 'stardewvalley',
  'terraria': 'terraria',
  'starbound': 'starbound',
  'telerik Blazor': '',
};

(async () => {
  /* ① 库名索引：norm(en) → libId（取首个命中） */
  const games = JSON.parse(fs.readFileSync(GAMES, 'utf8'));
  const lib = new Map();
  for (const g of games) {
    for (const p of enParts(g.title)) {
      const n = norm(p);
      if (n.length >= 4 && !lib.has(n)) lib.set(n, g);
    }
  }
  console.log('[ts] 库内英文索引:', lib.size, '个');

  /* ② 社区清单（cursor 翻页） */
  const coms = [];
  let cursor = '';
  for (let i = 0; i < 30; i++) {
    const j = await apiJson('https://thunderstore.io/api/experimental/community/' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''));
    coms.push(...j.results.map((c) => ({ id: c.identifier, name: c.name })));
    const nl = j.pagination && j.pagination.next_link;
    if (!nl) break;
    cursor = (nl.split('cursor=')[1] || '');
    await sleep(DELAY);
  }
  console.log('[ts] 社区总数:', coms.length);

  /* ③ 匹配（精确 + 别名） */
  const matched = [];
  const unmatched = [];
  for (const c of coms) {
    const key = ALIAS[c.id] || norm(c.name || c.id);
    const g = lib.get(key);
    if (g) matched.push({ c, g });
    else unmatched.push(c.id);
  }
  console.log('[ts] 匹配到库内端游:', matched.length, '个社区');
  matched.slice(0, 40).forEach(({ c, g }) => console.log('   ', c.id, '=>', g.id, (g.title || '').slice(0, 40)));

  /* ④ 每个匹配社区：listing Top 页 → 逐包详情取版本/直链 */
  const outGames = [];
  let nPkg = 0;
  for (let mi = 0; mi < matched.length; mi++) {
    const { c, g } = matched[mi];
    const pkgs = new Map();   /* key: ns/name */
    try {
      for (let p = 1; p <= PAGES; p++) {
        const j = await apiJson('https://thunderstore.io/api/cyberstorm/listing/' + c.id + '/?ordering=most-downloaded&page=' + p);
        for (const r of (j.results || [])) {
          if (r.is_deprecated || r.is_nsfw) continue;
          pkgs.set(r.namespace + '/' + r.name, r);
        }
        if (!j.next) break;
        await sleep(DELAY);
      }
      const top = [...pkgs.values()].sort((a, b) => b.download_count - a.download_count).slice(0, PER);
      const detailed = [];
      for (const r of top) {
        try {
          const d = await apiJson('https://thunderstore.io/api/experimental/package/' + r.namespace + '/' + r.name + '/');
          if (d.latest && d.latest.download_url && !d.is_deprecated) {
            detailed.push({
              ns: r.namespace, name: r.name, version: d.latest.version_number,
              downloads: r.download_count || 0, size: r.size || 0, icon: r.icon_url || '',
              desc: String(d.latest.description || r.description || '').slice(0, 200),
              url: d.latest.download_url,
            });
            nPkg++;
          }
        } catch (e) { /* 单包失败不拖垮社区 */ }
        await sleep(DELAY);
      }
      if (detailed.length) {
        outGames.push({ libId: g.id, community: c.id, title: g.title, packages: detailed });
      }
      console.log(`  [${mi + 1}/${matched.length}] ${c.id}: ${detailed.length} 包`);
    } catch (e) {
      console.log('  [ts] 社区失败', c.id, String(e.message || e).slice(0, 80));
    }
    /* 每社区落一次盘（中断可续：重跑时 --fresh 才清） */
    const out = {
      builtAt: Date.now(),
      stats: { communities: coms.length, matched: matched.length, games: outGames.length, packages: nPkg, unmatched: unmatched.length },
      games: outGames,
      unmatched,
    };
    fs.writeFileSync(OUT, JSON.stringify(out));
    await sleep(DELAY);
  }
  console.log('[ts] done →', OUT, 'games=', outGames.length, 'packages=', nPkg);
})();
