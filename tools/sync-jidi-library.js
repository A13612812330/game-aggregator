/**
 * tools/sync-jidi-library.js — 把机地**全量话题**并入端游库 data/games.json（v10.22 新增）
 *
 * ─────────────────────────────────────────────────────────────
 * ★ 为什么需要它：库里两个源严重失衡
 *
 *   实测（v10.22 之前）：`/api/library/stats` → **xdgamer 15,319 / jidi 66**。
 *   机地一侧之所以只有 66 条，是因为 `fetchers/jidi.js` 的 `libraryCandidates()`
 *   只能拿「首页 SSR 新游 + 周/月/年热榜」—— 那是个**人工精选**集合，不是全量。
 *
 *   v10.22 找到机地全量话题接口（详见 fetchers/jidiTopics.js），全量 **17,220 条**。
 *   本脚本把它们按库内条目形状并入 games.json，并沿用既有的 `jidi-<tid>` id 约定
 *   —— 所以原来那 66 条是**被覆盖更新**，不是又插一份（不会出现「同一话题两条」）。
 *
 * ★ 幂等：可反复运行。每轮先备份 `games.json.bak-<时间戳>`，再原地重写。
 *
 * ★ 日期语义要与库内其它条目对齐：库里的 `dateLabel`/`updatedTs` 表示
 *   **源站更新日期**（`_sortTs` 就是按它排「最新更新」），
 *   **不是**游戏发行日。所以这里用 topic 的 `ut`（话题更新时间），
 *   绝不能用 `releaseDate` —— 否则 2011 年的老游戏会带着 2011 的标签
 *   插到「最新更新」里，整列日期跳序（v10.8 修过的同类问题）。
 *
 * 用法：
 *   node tools/sync-jidi-library.js            # 正式写入
 *   node tools/sync-jidi-library.js --dry      # 只报告，不落盘
 */
const fs = require('fs');
const path = require('path');
const { normDate } = require('../shared');

const DATA = path.join(__dirname, '..', 'data');
const F_TOPICS = path.join(DATA, 'jidi-topics.json');
const F_GAMES = path.join(DATA, 'games.json');
const DRY = process.argv.includes('--dry');

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function main() {
  if (!fs.existsSync(F_TOPICS)) {
    console.error('[sync-jidi] 缺少 data/jidi-topics.json —— 先跑 node tools/build-jidi-topics.js');
    process.exit(1);
  }
  const topics = JSON.parse(fs.readFileSync(F_TOPICS, 'utf8'));
  const items = topics.items || [];
  console.log('[sync-jidi] 机地话题 ' + items.length + ' 条（构建于 ' + topics.builtAt + '）');

  let games = [];
  try {
    const raw = JSON.parse(fs.readFileSync(F_GAMES, 'utf8'));
    games = Array.isArray(raw) ? raw : Object.values(raw);
  } catch (e) {
    console.error('[sync-jidi] 读不到 games.json：' + e.message);
    process.exit(1);
  }
  console.log('[sync-jidi] 现有库 ' + games.length + ' 条');

  const before = games.reduce((a, g) => { const k = g.source || '?'; a[k] = (a[k] || 0) + 1; return a; }, {});
  console.log('  其中 ' + JSON.stringify(before));

  const byId = new Map(games.map((g) => [g.id, g]));

  /* 库里已用 appid 建立索引 —— 机地话题若与某条 XD 条目同 appid，
     把机地 id 挂到那条上（`altId`），这样「下载」弹窗能一次给出两侧入口，
     同时也避免同一款游戏在库里出现两条看着重复的记录。 */
  const APPID_RE = /\/apps\/(\d+)\//;
  const byAppid = new Map();
  for (const g of games) {
    if (!g || !g.cover) continue;
    const m = String(g.cover).match(APPID_RE);
    if (m) byAppid.set(Number(m[1]), g);
  }

  let added = 0, updated = 0;
  let mergedIntoXd = 0;

  for (const it of items) {
    if (!it || !it.tid) continue;
    const id = 'jidi-' + it.tid;
    const title = it.titleEn && it.titleEn !== it.title ? it.title + '/' + it.titleEn : it.title;

    /* 日期：用话题更新时间（源站更新语义），退化到发行日 */
    let dateLabel = null;
    if (it.updatedAt) {
      const d = new Date(it.updatedAt);
      const p = (n) => String(n).padStart(2, '0');
      dateLabel = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }
    dateLabel = normDate(dateLabel) || normDate(it.releaseDate) || null;

    const entry = {
      id,
      source: 'jidi',
      title,
      cover: it.cover || null,
      genres: Array.isArray(it.genres) ? it.genres : [],
      size: it.size || null,
      score: it.score != null ? it.score : null,
      updatedTs: it.updatedAt || null,
      dateLabel,
      url: it.url,
      /* ★ v10.22 新增字段：热度（浏览量）。列表/搜索可用它做「热门优先」，
         也让前端不必再回查 jidi-topics。 */
      hot: it.dpv || 0,
      /** appid：与其它源对齐用的键（机地 97.2% 有） */
      appid: it.appid || null,
    };

    /* ① 已有同 id（老的 66 条精选）→ 更新，不新增 */
    const old = byId.get(id);
    if (old) {
      Object.assign(old, entry);
      updated++;
      continue;
    }

    /* ② 同 appid 已有一条 XD 记录 → 不新建重复条目，只把机地侧信息挂上去 */
    const twin = it.appid ? byAppid.get(Number(it.appid)) : null;
    if (twin) {
      twin.jidiId = id;
      if (!twin.jidiUrl) twin.jidiUrl = it.url;
      /* 热度取两者较高（两边各自的浏览量口径不同，只作排序用） */
      if ((entry.hot || 0) > (twin.hot || 0)) twin.hot = entry.hot;
      mergedIntoXd++;
      continue;
    }

    /* ③ 新增 */
    byId.set(id, entry);
    games.push(entry);
    added++;
  }

  const after = games.reduce((a, g) => { const k = g.source || '?'; a[k] = (a[k] || 0) + 1; return a; }, {});
  console.log('');
  console.log('[sync-jidi] 结果：新增 ' + added + ' · 覆盖更新 ' + updated + ' · 合并进同款 XD 条目 ' + mergedIntoXd);
  console.log('  库总量 ' + games.length + ' → 来源分布 ' + JSON.stringify(after));

  if (DRY) {
    console.log('  --dry：未落盘');
    return;
  }

  const bak = F_GAMES + '.bak-' + stamp();
  fs.copyFileSync(F_GAMES, bak);
  fs.writeFileSync(F_GAMES, JSON.stringify(games));
  const mb = (fs.statSync(F_GAMES).size / 1048576).toFixed(1);
  console.log('  备份 → ' + path.basename(bak));
  console.log('  写入 → data/games.json (' + mb + 'MB)');
  console.log('');
  console.log('  ⚠️ 改完 games.json 必须重启服务：node tools/restart-server.js');
}

main();
