/** tools/fetch-modrinth.js — Modrinth MOD 补源探针（v10.83 实测 ⇒ **0 产出，撤下**）
 *
 * ── ★★ 最终结论（2026-10-16 实测，记录存档勿再踩）──────────
 * 无护栏首抓：58 游戏 / 241 包 —— 但人工核验全部是 **Minecraft 模组**
 * （query=raft 第一名是 MC 模组 Blazing Bamboo，只因描述含 "lava rafts"）。
 * 加双护栏（名字护栏 + MC loader 护栏）重抓：**252 游戏 × 全部 0 命中**。
 * ⇒ Modrinth 实测是**纯 MC 生态平台**，我们端游库（非 MC）没有一份合法 MOD，
 *    不接线（server / 前端均无 MX 痕迹，test-v1083 有防回归断言）。
 *    本文件保留作存档；若未来 Modrinth 扩到多游戏生态可重跑评估。
 *
 * ── 过程记录（实测 2026-10-16）──────────────────────────────
 * Modrinth 官方 API 免密钥、文件自托管在 cdn.modrinth.com（无防盗链、免登录直下）。
 * 但 **不支持按游戏过滤**（`games:<slug>` facet 0 命中，连 minecraft 也是 0）
 * ⇒ 只能按名称搜索（`query=`，命中 title/slug/描述 —— 描述命中就是误配源头）。
 *
 * ── 双护栏（本轮教训，重跑必须保留）─────────────────────────
 * ① 名字护栏：查询词必须出现在 slug 或 title 里（描述命中不算）；
 * ② loader 护栏：纯 MC loader（fabric/forge/quilt/neoforge…）的项目剔除
 *    （查询 minecraft 时例外）。version 响应带 loaders，在详情阶段判。
 *
 * ── 接口链 ──────────────────────────────────────────────────
 * ① 搜索 GET /v2/search?query=<community>&limit=20&index=downloads&facets=[["project_type:mod"]]
 * ② 版本 GET /v2/project/<id>/version → files[].url = cdn.modrinth.com 直链
 *
 * ── 输出 ────────────────────────────────────────────────────
 * data/modrinth.json { builtAt, stats, games: [{libId, community, title, packages[…]}] }
 * （★ v10.83 撤下后 data/modrinth.json 不入库不提交，跑本探针才会重新生成）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
/* 撤下后产物落到 tools/_probe-*（一次性探针区，不入 data/ 不提交） */
const OUT = path.join(__dirname, '_probe-modrinth-out.json');

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i >= 0 ? (process.argv[i + 1] || true) : d;
};
/* 游戏清单来源：默认 TS 备份（252 游戏完整清单）；--ts 可指向其他文件。
 * ★ 不直接读 data/thunderstore.json：TS 扩量重抓是增量落盘，跑到一半清单只有部分游戏。 */
const TS = path.resolve(ROOT, 'data', String(arg('ts', 'thunderstore.json.bak-20261016')));
const LIMIT = parseInt(arg('limit', '8'), 10);   /* 每游戏最多留几个项目（按下载量排） */
const DELAY = parseInt(arg('delay', '200'), 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* Modrinth 要求可识别的 UA（匿名限流按 UA/IP 计） */
const UA = 'GameHub-Aggregator/1.0 (local data sync; gamehub-agg-v4.app.workbuddy.host)';

async function apiJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' @ ' + url);
  return r.json();
}

/* ★★ 误匹配双护栏（实测踩到：query=raft 的搜索把 MC 模组 Blazing Bamboo 排第一，
 *    只因描述里有 "lava rafts" —— Modrinth 以 MC 为主，搜索是模糊的，宁缺毋滥）：
 *    ① 名字护栏：查询词必须出现在 slug 或 title 里（描述命中不算）；
 *    ② loader 护栏：纯 MC loader（fabric/forge/quilt/neoforge…）的项目剔除
 *       （查询 minecraft 时例外）。version 响应带 loaders，正好在详情阶段判。 */
const NORM = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const MC_LOADERS = new Set(['fabric', 'forge', 'quilt', 'neoforge', 'rift', 'liteloader', 'modloader',
  'bukkit', 'paper', 'spigot', 'purpur', 'folia', 'waterfall', 'bungeecord', 'velocity', 'sponge', 'datapack']);
function nameGuard(hit, q) {
  const qn = NORM(q);
  if (!qn) return false;
  return NORM(hit.slug).includes(qn) || NORM(hit.title).includes(qn);
}
function loaderGuard(version, q) {
  if (NORM(q) === 'minecraft') return true;
  const ls = (version && version.loaders) || [];
  return !(ls.length > 0 && ls.every((l) => MC_LOADERS.has(String(l).toLowerCase())));
}

(async () => {
  const ts = JSON.parse(fs.readFileSync(TS, 'utf8'));
  const gameList = ts.games || [];
  console.log('[mx] TS 已匹配游戏数:', gameList.length);

  const outGames = [];
  let nPkg = 0;
  for (let gi = 0; gi < gameList.length; gi++) {
    const g = gameList[gi];
    const q = g.community;               /* TS 社区 identifier = 英文游戏名 */
    const detailed = [];
    try {
      const s = await apiJson('https://api.modrinth.com/v2/search?limit=20&index=downloads&query=' +
        encodeURIComponent(q) + '&facets=' + encodeURIComponent(JSON.stringify([['project_type:mod']])));
      /* ★ 名字护栏：slug/title 不含查询词的直接丢（Blazing Bamboo 教训） */
      const hits = (s.hits || []).filter((h) => nameGuard(h, q)).slice(0, LIMIT);
      for (const h of hits) {
        try {
          const vers = await apiJson('https://api.modrinth.com/v2/project/' + h.project_id + '/version');
          const v = (vers || []).find((x) => (x.files || []).length);
          if (!v) continue;
          /* ★ loader 护栏：纯 MC loader 项目剔除（version.loaders 在这里判） */
          if (!loaderGuard(v, q)) continue;
          const f = (v.files || []).find((x) => x.primary) || v.files[0];
          if (!f || !f.url) continue;
          detailed.push({
            id: h.project_id, slug: h.slug, title: h.title,
            version: v.version_number, downloads: h.downloads || 0,
            size: f.size || 0, icon: h.icon_url || '',
            desc: String(h.description || '').slice(0, 200),
            url: f.url, date: v.date_published || '',
          });
          nPkg++;
        } catch (e) { /* 单项目失败不拖垮游戏 */ }
        await sleep(DELAY);
      }
    } catch (e) {
      console.log('  [mx] 搜索失败', q, String(e.message || e).slice(0, 80));
    }
    if (detailed.length) {
      detailed.sort((a, b) => b.downloads - a.downloads);
      outGames.push({ libId: g.libId, community: g.community, title: g.title, packages: detailed });
    }
    console.log(`  [${gi + 1}/${gameList.length}] ${q}: ${detailed.length} 项目`);
    /* 每游戏落盘（中断可续） */
    fs.writeFileSync(OUT, JSON.stringify({
      builtAt: Date.now(),
      stats: { games: outGames.length, packages: nPkg },
      games: outGames,
    }));
    await sleep(DELAY);
  }
  console.log('[mx] done →', OUT, 'games=', outGames.length, 'packages=', nPkg);
})();
