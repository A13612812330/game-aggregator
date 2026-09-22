#!/usr/bin/env node
/* tools/build-steam-req.js — 预热「PC 配置要求」缓存（data/steam-req.json）
 *
 * 背景见 data/pcreq.js 顶部注释：XDGAME / 机地详情页本身没有配置要求，
 * 靠 Steam 官方商店接口（appdetails）拿官方中文的「最低 / 推荐配置」。
 *
 * 本脚本把这张表离线预热一遍（运行时也会按需实时抓 + 回写，
 * 预热只是让「打开详情页」不必再等网络 —— 现状只有 ~4% 预热过）。
 *
 * ★ v10.33 修的三件事（都是上一版实际做不到全量的原因）：
 *
 *  ① **只走封面这一路 appid**。原实现 `appid: pcreq.appidOf(it.cover)`，
 *     而实测（19,010 条端游库）：
 *       仅封面解析得出        14,997
 *       仅顶层 appid 字段得出  3,124   ← 原脚本**整批跳过**
 *       两路都有                  10（实测 10/10 一致）
 *       ── 可预热总量         18,131（原脚本只覆盖 15,007 = 82.8%）
 *     ⚠️ 被跳过那批恰恰是**机地独有**的游戏（封面是 52jidi 图床，不是 Steam CDN）：
 *        「剑星」「渔力全开」「极限竞速：地平线 6」「黎明行者之血」全在里面 ——
 *        它们本来就搜不到 Steam，配置要求只能靠这条通路。漏掉这批 = 漏掉最缺数据的那批。
 *
 *  ② **写盘放大**。flush 是「全量序列化 + 全量写盘」，18,131 条规模下单次 65ms
 *     （stringify 47 + 写 11）。1.1s/条 × 5 小时按 5s debounce 要写 ~3,800 次 ≈ 26 GB。
 *     ⇒ 改用**批模式**（pcreq.setAutoFlush(false) + 每 BATCH 条 flushNow）：~35 次 ≈ 241 MB。
 *
 *  ③ **进度不可见**。5 小时的长跑必须能从外面看进度 ⇒ 每批写 _prewarm-progress.json，
 *     含「已抓 / 命中 / 未收录 / 失败 / 速率 / 预计剩余」。断点续跑靠 pcreq.peek()。
 *
 * 用法：
 *   node tools/build-steam-req.js --dry          # 只报计划（覆盖多少、预计多久），不抓
 *   node tools/build-steam-req.js --limit=500    # 抓 500 条（≈9 分钟，用于验证）
 *   node tools/build-steam-req.js --all          # 全量 18,131 条（≈5.5 小时）
 *   node tools/build-steam-req.js --all --mode=search   # 只抓没 appid 的（走双语名称搜索，慢）
 *   node tools/build-steam-req.js --force        # 忽略已有缓存重抓
 *   node tools/build-steam-req.js --gap=500      # 在内部节流（1100ms）之上**额外**再等多少（默认 0）
 *   node tools/build-steam-req.js --batch=1000   # 每多少条落一次盘（默认 500）
 *   node tools/build-steam-req.js --only=xd-5828,jidi-171085167
 *
 * 特性：
 *   · **断点续跑**：已有缓存直接跳过（除非 --force），中断后重跑接着抓
 *   · **限流自适应**：连续拿到 HTTP 429/503 就翻倍拉大额外等待，恢复后回落
 *   · 负缓存：Steam 未收录的 appid 也写 {miss:true}，7 天后才允许重试
 *   · 网络异常**不写负缓存**（否则一次抖动会把这款游戏永久判成「无配置」）
 *
 * ★ v10.33 还修掉一个「看起来在限流、其实在空等」的缺陷：
 *   节流由 pcreq.throttled 内部负责（模块级串行 + MIN_GAP 1100ms），旧脚本外层又
 *   固定 wait(1100) ⇒ 每条 2.2s、全量 11 小时。现在外层默认 0，全量回到 ~5.5 小时。
 *   （同一个坑还有第二种形态：退避写 `gap = Math.min(gap * 2, 12000)`，
 *     而 gap 初始 0 ⇒ `0*2` 恒为 0，**退避完全失效**。已改成从 THROTTLE_GAP 起翻倍。）
 */
const fs = require('fs');
const path = require('path');
const pcreq = require('../data/pcreq');

const ARG = process.argv.slice(2);
const has = (k) => ARG.includes('--' + k);
const val = (k, d) => {
  const hit = ARG.find((x) => x.startsWith('--' + k + '='));
  return hit ? hit.split('=').slice(1).join('=') : d;
};

const ROOT = path.join(__dirname, '..');
const MODE = String(val('mode', 'appid')).toLowerCase();   // appid | search | all
const LIMIT = has('all') ? Infinity : parseInt(val('limit', '1500'), 10);
/* ★ v10.33：`--gap` 默认 **0**，不再叠加 1100ms。
 *   根因：`pcreq.throttled()` 内部已经是**模块级串行链 + MIN_GAP 1100ms**
 *   （data/pcreq.js `const MIN_GAP = 1100`），它自己就保证了「两次请求至少隔 1.1s」。
 *   旧版脚本外层又 `await wait(GAP)` 1100ms ⇒ **双重限流**，每条实际 2.2s：
 *   全量 18,131 条要跑 **11 小时**，而不是 5.5 小时 —— 白白多花一倍。
 *   ⚠️ `--gap` 保留，语义改为「在 throttled 之上**额外**再放缓多少」（网络差 / 被限流时用）。 */
const GAP = parseInt(val('gap', '0'), 10);
const THROTTLE_GAP = 1100;   // 与 data/pcreq.js 的 MIN_GAP 对齐，仅用于 ETA 估算
const BATCH = Math.max(1, parseInt(val('batch', '500'), 10));
/* ★ v10.33：进度刷新的粒度与落盘**解耦**。
 *   初版把 writeProgress / 日志挂在「每 BATCH 条落盘」那一个分支里 ⇒
 *   batch=500 时 **9 分钟才有一次进度更新**，5 小时的长跑等于看不见进度
 *   （实测：启动 5 分钟时 progress 文件还停在上一轮的值）。
 *   现在日志/进度每 50 条刷一次，落盘仍按 BATCH（写盘放大不变）。 */
const PROGRESS_EVERY = Math.max(10, Math.min(BATCH, 50));
const FORCE = has('force');
const DRY = has('dry');
const ONLY = String(val('only', '')).split(',').map((s) => s.trim()).filter(Boolean);
const PROGRESS = path.join(ROOT, '_prewarm-progress.json');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function loadLib() {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'games.json'), 'utf8'));
  const arr = Array.isArray(raw) ? raw : (raw.items || raw.games || []);
  return arr.map((it) => {
    const fromCover = pcreq.appidOf(it.cover);
    const fromField = String(it.appid || '').trim();
    return {
      id: it.id || '',
      title: it.title || '',
      cover: it.cover || '',
      updatedTs: it.updatedTs || it.publishTs || 0,
      score: it.score || 0,
      appid: fromCover || fromField,
      appidSrc: fromCover ? (fromField ? 'both' : 'cover') : (fromField ? 'field' : ''),
    };
  });
}

function writeProgress(o) {
  try { fs.writeFileSync(PROGRESS, JSON.stringify(o, null, 1)); } catch (e) { /* 进度写不进去不该中断抓取 */ }
}

(async () => {
  let lib = loadLib();
  if (ONLY.length) lib = lib.filter((x) => ONLY.includes(x.id));
  else lib.sort((a, b) => (b.updatedTs || 0) - (a.updatedTs || 0));   // 最近更新的先（详情页最常从热榜点开）

  /* ---- 两路 appid 的覆盖（★ v10.33：这才是「能不能全量」的关键数） ---- */
  const byCover = lib.filter((x) => x.appidSrc === 'cover' || x.appidSrc === 'both').length;
  const byField = lib.filter((x) => x.appidSrc === 'field' || x.appidSrc === 'both').length;
  const withAppid = lib.filter((x) => x.appid);
  const noAppid = lib.filter((x) => !x.appid);
  console.log(`[steam-req] 端游库 ${lib.length} 条`);
  console.log(`[steam-req]   封面解析出 appid  ${byCover}`);
  console.log(`[steam-req]   顶层字段有 appid  ${byField}`);
  console.log(`[steam-req]   ⇒ 有 appid 合计   ${withAppid.length}（${(withAppid.length / (lib.length || 1) * 100).toFixed(1)}%）`);
  console.log(`[steam-req]   两路都没有       ${noAppid.length}（只能走名称搜索）`);

  /* ---- 本次待抓：按 mode 选池 ---- */
  let pool, how;
  if (MODE === 'search') { pool = noAppid; how = '双语名称搜索'; }
  else if (MODE === 'all') { pool = lib; how = 'appid 直抓 + 名称搜索'; }
  else { pool = withAppid; how = 'appid 直抓'; }
  console.log(`[steam-req] 模式 ${MODE}（${how}），候选 ${pool.length} 条`);

  let todo = pool;
  if (!FORCE) {
    const before = todo.length;
    todo = todo.filter((x) => !pcreq.peek(x.appid || ('q:' + pcreq.normName(x.title).slice(0, 80))));
    console.log(`[steam-req] 已有缓存，跳过 ${before - todo.length} 条`);
  }
  todo = todo.slice(0, LIMIT === Infinity ? undefined : LIMIT);
  const perItem = THROTTLE_GAP + GAP;
  const etaMin = (todo.length * perItem / 60000);
  console.log(`[steam-req] ★ 本次待抓 ${todo.length} 条，节流 ${THROTTLE_GAP}ms` +
    (GAP ? ` + 额外 ${GAP}ms` : '') +
    ` ⇒ 下限 ${etaMin.toFixed(1)} 分钟（${(etaMin / 60).toFixed(1)} 小时）`);
  /* ★ v10.33：这里必须写「下限」，不能当成预计耗时 ——
     实测（全量跑到 800 条时）：速率 **38 条/分**，即 ~1.6s/条，比 1.1s 慢 45%。
     根因：`pcreq.throttled` 的 `lastAt` 打在**请求发起前**，
     所以真实周期 = MIN_GAP(1100ms) + **请求本身的网络往返**。
     ⇒ 启动时按 1.1s 估会低估，进度里的「剩余」才是按实测速率算的，以那个为准。 */
  if (todo.length > 50) {
    console.log(`[steam-req]    ⚠️ 实际约 1.6s/条（含网络往返）⇒ 全量约 ${(todo.length * 1.6 / 3600).toFixed(1)} 小时；` +
      '运行中以日志里的「速率 / 剩余」为准');
  }

  if (DRY) {
    console.log('\n[steam-req] --dry：只报计划，不抓取。');
    const st = pcreq.stats();
    console.log('[steam-req] 缓存现状:', JSON.stringify(st));
    if (todo.length) {
      console.log('[steam-req] 待抓前 5 条示例:');
      for (const x of todo.slice(0, 5)) {
        console.log('   ' + String(x.id).padEnd(22) + ' appid=' + String(x.appid).padEnd(9) +
          ' [' + x.appidSrc + '] ' + String(x.title).slice(0, 34));
      }
    }
    return;
  }

  /* ---- 批模式：关自动落盘，由本脚本按批 flush（见文件头 ②） ---- */
  pcreq.setAutoFlush(false);

  let ok = 0, miss = 0, err = 0, wrote = 0, merged = 0;
  let gap = GAP, throttled = 0, cleanStreak = 0;
  const t0 = Date.now();
  const flushBatch = () => {
    const m = pcreq.mergeDisk();          // 防覆盖服务端这几分钟新抓的条目
    merged += m;
    if (pcreq.flushNow()) wrote += 1;
  };

  for (let i = 0; i < todo.length; i++) {
    const it = todo[i];
    let limited = false;
    try {
      const r = await pcreq.resolve({ title: it.title, cover: it.cover, appid: it.appid });
      if (r.hit) ok += 1;
      else if (r.error) {
        err += 1;
        if (/429|503|too many|rate/i.test(r.error)) {
          limited = true; throttled += 1; cleanStreak = 0;
          /* ⚠️ 必须 `Math.max(gap, THROTTLE_GAP)` 起翻倍：gap 默认是 0，
             `0 * 2` 永远是 0 ⇒ 退避**完全失效**（看起来在退避，实际一点没等）。 */
          gap = Math.min(Math.max(gap, THROTTLE_GAP) * 2, 12000);
          console.log(`  ⚠️ 触发限流（${r.error}）⇒ 额外等待提到 ${gap}ms`);
        }
        /* 普通网络错误（超时 / 连接重置）**不动间隔** —— 那不是限流信号，
           拉大间隔只会让 5 小时的长跑更慢。失败条目不写负缓存，重跑会补。 */
      } else miss += 1;
    } catch (e) { err += 1; }

    if ((i + 1) % PROGRESS_EVERY === 0) {
      const mins = (Date.now() - t0) / 60000;
      const rate = (i + 1) / (mins || 0.001);
      const left = (todo.length - i - 1) / (rate || 1);
      writeProgress({
        ts: Date.now(), mode: MODE, total: todo.length, done: i + 1,
        ok, miss, err, throttled, gap, wrote,
        ratePerMin: Math.round(rate * 10) / 10,
        etaMin: Math.round(left), startedAt: t0,
      });
      console.log(`  ${i + 1}/${todo.length}  命中 ${ok}  未收录 ${miss}  失败 ${err}` +
        `  用时 ${mins.toFixed(1)} 分钟  速率 ${rate.toFixed(1)}/分  剩余约 ${left.toFixed(0)} 分钟` +
        (merged ? `  （合并服务端新增 ${merged}）` : ''));
    }
    if ((i + 1) % BATCH === 0) flushBatch();
    /* 限流恢复：连续 20 条没再撞限流，就把额外等待降回 --gap 值 */
    if (!limited) {
      cleanStreak += 1;
      if (cleanStreak >= 20 && gap > GAP) { gap = GAP; console.log('  ✅ 已恢复，额外等待回到 ' + gap + 'ms'); }
    }
    if (gap > 0 && i < todo.length - 1) await wait(gap);
  }
  flushBatch();

  const s = pcreq.stats();
  const mins = (Date.now() - t0) / 60000;
  console.log('\n[steam-req] 完成。本次命中 ' + ok + ' / 未收录 ' + miss + ' / 失败 ' + err +
    '　用时 ' + mins.toFixed(1) + ' 分钟');
  console.log('[steam-req] 落盘 ' + wrote + ' 次（批模式，每次全量约 ' + BATCH + ' 条增量）' +
    (merged ? ' · 合并服务端新增 ' + merged + ' 条' : ''));
  if (throttled) console.log('[steam-req] ⚠️ 期间触发限流 ' + throttled + ' 次（已自动退避）');
  console.log('[steam-req] 缓存总览:', JSON.stringify(s));
  console.log('[steam-req] 缓存文件: ' + pcreq._file);
  writeProgress({
    ts: Date.now(), mode: MODE, total: todo.length, done: todo.length,
    ok, miss, err, throttled, wrote, finished: true,
    elapsedMin: Math.round(mins * 10) / 10, startedAt: t0,
  });
})().catch((e) => { console.error('[steam-req] 失败:', e.message); process.exit(1); });
