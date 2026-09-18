/**
 * tools/build-jidi-topics.js — 抓取机地**全量**游戏话题库 → data/jidi-topics.json
 *
 * 背景与接口细节见 fetchers/jidiTopics.js 头部说明。要点：
 *   · 接口 POST /api/topic/get_topics（带 websign，body 必须是整份 env 展开）
 *   · limit 实测可到 1000 ⇒ 全量（约 17,198 条）只需 **约 18 次请求**
 *   · `total` 字段恒为 0，**不可信**；边界靠 offset 递增探到空页为止
 *
 * 用法：
 *   node tools/build-jidi-topics.js                # 全量
 *   node tools/build-jidi-topics.js --max=2000     # 只抓 2000 条（调试）
 *   node tools/build-jidi-topics.js --limit=200    # 每页 200（更保守）
 *
 * ⚠️ 产物落盘 `data/jidi-topics.json`，**运行时全离线**（与项目其它数据源一致）。
 */
const fs = require('fs');
const path = require('path');
const jt = require('../fetchers/jidiTopics');

const OUT = path.join(__dirname, '..', 'data', 'jidi-topics.json');

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.split('=')[1] : def;
}

(async () => {
  const max = Number(arg('max', 0)) || 0;
  const limit = Math.min(Number(arg('limit', jt.PAGE_LIMIT)) || jt.PAGE_LIMIT, jt.PAGE_LIMIT);
  const sort = arg('sort', 'update');

  console.log(`[jidi-topics] 开始抓取 sort=${sort} limit=${limit}${max ? ' max=' + max : '（全量）'}`);
  const t0 = Date.now();

  let lastLog = 0;
  const r = await jt.crawlAll({
    sort,
    max,
    limit,
    onPage: ({ page, got, offset }) => {
      const now = Date.now();
      if (now - lastLog > 1500 || got < limit) {
        const secs = ((now - t0) / 1000).toFixed(0);
        console.log(`  第 ${String(page).padStart(3)} 页 · offset=${String(offset).padStart(6)} · 累计 ${got} 条 · ${secs}s`);
        lastLog = now;
      }
    },
  });

  /* 归一化。★ 归一化失败的条目**不静默丢弃** —— 计数并报出来，
     否则「抓了 17000 条、落盘 9000 条」这种缺口没人会发现。 */
  const items = [];
  let dropped = 0;
  const dropReasons = {};
  for (const raw of r.items) {
    const s = jt.shapeTopic(raw);
    if (!s) {
      dropped++;
      dropReasons['无标题'] = (dropReasons['无标题'] || 0) + 1;
      continue;
    }
    items.push(s);
  }

  /* 按 dpv 降序落盘 —— 下游「优先推热门」直接吃这个顺序，不必每次重排 */
  items.sort((a, b) => (b.dpv || 0) - (a.dpv || 0));

  const stats = {
    count: items.length,
    withCover: items.filter((x) => x.cover).length,
    withAppid: items.filter((x) => x.appid).length,
    withMin: items.filter((x) => x.min).length,
    withMinDx: items.filter((x) => x.min && x.min.dxV != null).length,
    withMinStorage: items.filter((x) => x.min && x.min.storageGb != null).length,
    withMinRam: items.filter((x) => x.min && x.min.ram).length,
    withMinGpu: items.filter((x) => x.min && x.min.gpu).length,
    withRec: items.filter((x) => x.rec).length,
    downloadable: items.filter((x) => x.modCnt > 0).length,
    dropped,
  };

  const payload = {
    builtAt: new Date().toISOString(),
    source: 'jidiyouxi.com /api/topic/get_topics',
    sort,
    pageSize: limit,
    pages: r.pages,
    count: items.length,
    stats,
    items,
  };

  fs.writeFileSync(OUT, JSON.stringify(payload));

  const sizeMb = (fs.statSync(OUT).size / 1048576).toFixed(1);
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log('');
  console.log(`[jidi-topics] 完成：${items.length} 条 · ${r.pages} 页 · ${secs}s · ${sizeMb}MB`);
  console.log(`  封面 ${stats.withCover} · Steam appid ${stats.withAppid} · 有最低配置 ${stats.withMin}`);
  console.log(`  其中 DX ${stats.withMinDx} · 容量 ${stats.withMinStorage} · 内存 ${stats.withMinRam} · 显卡 ${stats.withMinGpu}`);
  console.log(`  有推荐配置 ${stats.withRec} · 有可下载资源(mod_cnt>0) ${stats.downloadable}`);
  if (dropped) console.log(`  ⚠️ 丢弃（无标题）${dropped}`);
  console.log(`  → ${path.relative(path.join(__dirname, '..'), OUT)}`);
})().catch((e) => {
  console.error('[jidi-topics] 失败：' + (e && e.message));
  process.exit(1);
});
