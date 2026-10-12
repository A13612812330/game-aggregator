#!/usr/bin/env node
/* tools/check-sources.js —— 外部源**主动巡检**（v10.56）
 *
 * 为什么要有它：本项目 9 个外部源**改版会静默失效** —— 抓取器不抛异常、不报错、
 *   只把空结果落盘，外部看与「在跑」完全一样。已经吃过一次：
 *   **机地搜索连续 6 日不可用，无人发现**，是用户先察觉的。
 *   daily-sync 的 10 步只验「我们自己的接口通不通」，**不验上游还认不认我们**。
 *
 * ★ 三层判据（关键：不能只看 HTTP 200 —— 本项目铁律「200 判不出新旧」同样适用于上游）：
 *   · `down`      网络失败 / 4xx / 5xx  ⇒ 源挂了
 *   · `degraded`  **HTTP 200 但内容特征不符** ⇒ ★ 改版了（最典型、也最难发现）
 *   · `stale`     GitHub 类源**最后提交过久** ⇒ 上游停更（数据会日渐陈旧）
 *   · `ok`        拿到预期内容
 *
 * 用法：
 *   node tools/check-sources.js            # 人读输出
 *   node tools/check-sources.js --json     # 机器读（daily-sync 消费）
 *   node tools/check-sources.js --only=steam-store,youxia-save
 * 退出码：0 全部 ok；1 有 down/degraded/stale（可直接串进收尾脚本）
 *
 * ⚠️ 只读：不发任何写请求、不改任何 data 产物。
 * ⚠️ GitHub API 匿名限流 60/h —— 本脚本只用 3 次，够。
 */
'use strict';
const https = require('https');

const ARG = process.argv.slice(2);
const AS_JSON = ARG.includes('--json');
const onlyArg = (ARG.find((a) => a.startsWith('--only=')) || '').slice(7);
const ONLY = onlyArg ? new Set(onlyArg.split(',').map((s) => s.trim())) : null;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GameHub-source-check/1.0';
const TIMEOUT = 25000;

/** 取文本（跟随重定向由 https 自动处理不到，这里手动跟 3 跳） */
function getText(url, tries = 2, hop = 3) {
  return new Promise((resolve) => {
    const one = (n, h) => {
      const req = https.get(url, { timeout: TIMEOUT, headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && h > 0) {
          res.resume();
          const next = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, url).href;
          return getText(next, n, h - 1).then(resolve);
        }
        let s = '';
        res.on('data', (d) => (s += d));
        res.on('end', () => resolve({ code: res.statusCode, body: s, len: s.length }));
      });
      req.on('error', (e) => (n > 1 ? one(n - 1, h) : resolve({ err: e.code || e.message })));
      req.on('timeout', () => { req.destroy(); n > 1 ? one(n - 1, h) : resolve({ err: 'timeout' }); });
    };
    one(tries, hop);
  });
}

/* ---------- 源清单 ----------
 * `expect(body, len)` 返回 null 表示通过，返回字符串表示**不通过的原因**。
 * ★ 判据一律取「**内容特征**」而非长度阈值单用 —— 单看长度会在改版后仍旧通过。 */
const SOURCES = [
  {
    id: 'jidi-web', name: '机地官网', url: 'https://jidiyouxi.com/',
    expect: (b) => (/jidiyouxi|52jidi|modify/i.test(b) ? null : 'HTML 里找不到站点标识（可能被改版/换域）'),
  },
  {
    id: 'jidi-modify', name: '机地 MOD 页', url: 'https://jidiyouxi.com/modify/list',
    expect: (b) => (b.length > 800 ? null : '页面过短（SPA 外壳变了？）'),
  },
  {
    id: 'xdgame', name: 'XDGAME 官网', url: 'https://www.xdgame.com/',
    expect: (b) => (/xdgame/i.test(b) ? null : 'HTML 里找不到 xdgame 标识'),
  },
  {
    id: 'youxia-save', name: '游侠存档列表', url: 'https://patch.ali213.net/showclass/class5_1.html',
    /* ★ 这条是「改版静默失效」的最佳判据：列表页若不再含 showpatch 链接，
       抓取器会照常返回 0 条而**不报错**。 */
    expect: (b) => ((b.match(/showpatch\/\d+/g) || []).length >= 5
      ? null : '列表页不再含 showpatch 条目链接（改版了）'),
  },
  {
    id: 'gtrainers', name: 'GTrainers', url: 'https://gtrainers.com/',
    expect: (b) => (b.length > 2000 ? null : '首页过短'),
  },
  {
    id: 'ludusavi', name: 'Ludusavi manifest', url: 'https://api.github.com/repos/mtkennerly/ludusavi-manifest/commits?per_page=1',
    /* 17MB 的 manifest 本体不适合巡检 ⇒ 改问 GitHub「最后一次提交」，
       既轻量又能顺带判「上游停更」。 */
    json: true,
    expect: (j) => {
      const c = Array.isArray(j) && j[0];
      if (!c || !c.commit || !c.commit.committer) return '拿不到最后一次提交';
      const days = (Date.now() - new Date(c.commit.committer.date).getTime()) / 86400000;
      return days > 60 ? `上游已 ${Math.round(days)} 天未更新` : null;
    },
    staleDays: 60,
    detailOf: (j) => {
      const c = Array.isArray(j) && j[0];
      if (!c || !c.commit || !c.commit.committer) return '';
      const d = Math.round((Date.now() - new Date(c.commit.committer.date).getTime()) / 86400000);
      return '最后提交 ' + String(c.commit.committer.date).slice(0, 10) + '（' + d + ' 天前）';
    },
  },
  {
    id: 'bannerhub-cfg', name: 'BannerHub 配置库', url: 'https://api.github.com/repos/The412Banner/bannerhub-game-configs/contents/configs',
    json: true,
    expect: (j) => (Array.isArray(j) && j.length > 0 ? null : '配置目录为空或已迁移'),
    detailOf: (j) => (Array.isArray(j) ? j.length + ' 个配置' : ''),
  },
  {
    id: 'mobilemodels', name: 'MobileModels 机型库', url: 'https://api.github.com/repos/khwang9883/MobileModels/contents/brands',
    json: true,
    expect: (j) => (Array.isArray(j) && j.length >= 20 ? null : 'brands 目录文件数骤降（结构性变更？）'),
    detailOf: (j) => (Array.isArray(j) ? j.length + ' 个品牌文件' : ''),
  },
  {
    id: 'kalvo', name: 'kalvo 硬件参数', url: 'https://zh.kalvo.com/',
    expect: (b) => (b.length > 1000 ? null : '页面过短'),
  },
  {
    id: 'steam-store', name: 'Steam store API', url: 'https://store.steampowered.com/api/appdetails?appids=550&l=schinese&filters=basic',
    json: true,
    /* ★ 这条同时是「限流哨兵」：Steam 429/空响应时抓取器会静默少数据。
       用固定 appid 550（Left 4 Dead 2，长期存在）做哨兵。 */
    expect: (j) => {
      const d = j && j['550'];
      if (!d) return '响应里没有 550（可能被限流或接口改版）';
      if (!d.success) return 'success=false';
      if (!d.data || !d.data.name) return 'data 缺 name';
      return null;
    },
    detailOf: (j) => (j && j['550'] && j['550'].data ? j['550'].data.name : ''),
  },
];

(async () => {
  const list = ONLY ? SOURCES.filter((s) => ONLY.has(s.id)) : SOURCES;
  const rows = [];
  for (const s of list) {
    const r = await getText(s.url);
    let state = 'ok', detail = '';
    if (r.err) { state = 'down'; detail = '网络失败：' + r.err; }
    else if (r.code !== 200) { state = 'down'; detail = 'HTTP ' + r.code; }
    else {
      let parsed = r.body;
      if (s.json) { try { parsed = JSON.parse(r.body); } catch (e) { state = 'degraded'; detail = '返回的不是 JSON'; } }
      if (state === 'ok') {
        const why = s.expect(parsed);
        if (why) { state = s.staleDays ? 'stale' : 'degraded'; detail = why; }
        else detail = (s.detailOf ? s.detailOf(parsed) : '') || (r.len + ' 字节');
      }
    }
    rows.push({ id: s.id, name: s.name, state, detail, url: s.url });
    if (!AS_JSON) {
      const mark = state === 'ok' ? '✅' : state === 'down' ? '❌' : state === 'degraded' ? '⚠️' : '🕒';
      console.log(`  ${mark} [${state}] ${s.name.padEnd(18)} ${detail}`);
    }
  }

  const bad = rows.filter((r) => r.state !== 'ok');
  if (AS_JSON) {
    console.log(JSON.stringify({ checkedAt: Date.now(), total: rows.length, bad: bad.length, rows }, null, 1));
  } else {
    console.log('\n' + '='.repeat(58));
    console.log(`源巡检：${rows.length - bad.length} / ${rows.length} 正常` +
      (bad.length ? `，${bad.length} 异常：` + bad.map((b) => b.id + '(' + b.state + ')').join(', ') : ''));
    if (bad.length) {
      console.log('\n★ 异常源的处置：');
      console.log('  · degraded ⇒ **十有八九是改版**：先开源站人工确认，再改对应 fetchers/*.js 的解析');
      console.log('  · down     ⇒ 先复测一次（可能是抖动/限流），持续 down 才动手');
      console.log('  · stale    ⇒ 上游停更，数据会日渐陈旧，评估是否换源或降级展示');
    }
  }
  if (bad.length) process.exitCode = 1;
})();
