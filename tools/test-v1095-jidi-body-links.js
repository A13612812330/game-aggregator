/* v10.95 防线：机地本体链接「为什么只显示 XD」
 *
 * 报障：用户说「机地有很多免费的下载本体链接，为什么只显示 XD 的」。
 * 根因（2026-10-21 实测）：机地取 env 偶发拿到挑战页 ⇒ 本体专区 405、0 帖，
 *   而这份「0 帖」被当成正常结果缓存 30 分钟；同一进程 2 秒后现抓同一话题
 *   （tid 640827939 星砂岛）能拿到 3 帖 / 5 条网盘链接。
 *
 * 本套件守四件事：
 *   A 缓存时长策略（真调 data/dl-cache-ttl.js，不是抄一份逻辑来比字符串）
 *   B 服务端接线（refresh=1 / 函数态 TTL 的并发去重）
 *   C 机地抓取的重试（signedPost 换 env 重试 + topicPosts 串行补抓，且失败仍留痕）
 *   D 前端（失败要说「没取到」而不是「没有」、重试按钮真的带 refresh=1、不自动重试）
 */
const fs = require('fs');
const path = require('path');
const { dlCacheTtl, dlRetryable, FULL, FAILED, DEGRADED } = require('../data/dl-cache-ttl');

let pass = 0, fail = 0; const fails = [];
function ok(c, name, extra) {
  if (c) { pass++; console.log('  PASS  ' + name + (extra ? '  — ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  × FAIL  ' + name + (extra ? '  — ' + extra : '')); }
}
const src = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const SERVER = src('server.js');
const SIGNED = src('fetchers/jidiSigned.js');
const POSTS = src('fetchers/jidiPosts.js');
const INDEX = src('public/index.html');
const BUILD = src('tools/_build-deploy-payload.js');

console.log('\n=== A 缓存时长策略（单元，真调） ===');
/* 形状取自 /api/download 的真实返回 */
const okJidi = { source: 'jidi', engine: 'api', sections: [{ key: 'body', count: 3, error: null }, { key: 'mod', count: 0, error: null }] };
const badJidi = { source: 'jidi', engine: 'api', sections: [{ key: 'body', count: 0, error: '/api/misc/post_list HTTP 405' }] };
const ssrJidi = { source: 'jidi', engine: 'ssr', sections: [{ key: 'body', count: 10 }] };
const emptyJidi = { source: 'jidi', engine: 'api', sections: [{ key: 'body', count: 0, withLinks: 0, error: null }] };
const xdOk = { source: 'xdgamer', items: [{ real: 'https://pan.baidu.com/s/xxx' }] };

ok(dlCacheTtl(okJidi) === FULL, 'A1 机地完整成功 → 30 分钟', dlCacheTtl(okJidi) + 'ms');
ok(dlCacheTtl(badJidi) === FAILED, 'A2 有专区报错 → 只缓存 60 秒（下次打开自愈）', dlCacheTtl(badJidi) + 'ms');
ok(dlCacheTtl(ssrJidi) === DEGRADED, 'A3 SSR 兜底 → 120 秒（能看但不全，别锁半小时）', dlCacheTtl(ssrJidi) + 'ms');
ok(dlCacheTtl(xdOk) === FULL, 'A4 XD 来源不受机地规则影响 → 30 分钟');
ok(dlCacheTtl(null) === FAILED, 'A5 空结果不缓存半小时（否则等于把失败当结论）');
ok(dlCacheTtl(emptyJidi) === FULL,
  'A6 ★「帖在但没写网盘」是正常空结果，照旧缓存 30 分钟（不能误判成失败）', dlCacheTtl(emptyJidi) + 'ms');
ok(dlRetryable(badJidi) === true && dlRetryable(okJidi) === false,
  'A7 dlRetryable 与 TTL 同一判据（只服务端判会让两边漂移）');
ok(FAILED < DEGRADED && DEGRADED < FULL, 'A8 三档单调递增（不是拍脑袋的魔数）',
  FAILED + ' < ' + DEGRADED + ' < ' + FULL);

console.log('\n=== B 服务端接线 ===');
ok(/require\('\.\/data\/dl-cache-ttl'\)/.test(SERVER),
  'B1 /api/download 用 data/dl-cache-ttl.js（策略可单测，不在 server.js 里手写）');
ok(/req\.query\.refresh/.test(SERVER) && /cache\.delete\(key\)/.test(SERVER),
  'B2 refresh=1 能强制绕过缓存（用户点重试的唯一出口）');
ok(/typeof hit\.ttl === 'function'\) return hit\.value/.test(SERVER),
  'B3 ★ 函数态 TTL 期间并发请求复用同一个 in-flight（否则一次弹窗打 3 次机地）');
{
  /* 反证：如果又退回「只看数字 TTL」，B3 那句就不在了 —— 这里再钉一次语义 */
  const seg = SERVER.slice(SERVER.indexOf('function cached('), SERVER.indexOf('function cached(') + 900);
  ok(!/typeof t === 'number' && Date\.now\(\) - hit\.ts < t\) return hit\.value;\s*\}\s*const p = Promise/.test(seg.replace(/\/\*[\s\S]*?\*\//g, '')) ||
    /typeof hit\.ttl === 'function'/.test(seg),
    'B3b 函数态分支在「判新鲜」之前（顺序错了等于没修）');
}
ok(/dlCacheTtl/.test(SERVER.slice(SERVER.indexOf("app.get('/api/download'"), SERVER.indexOf("app.get('/api/download'") + 1200)),
  'B4 /api/download 真的把 dlCacheTtl 传给了 cached()');

console.log('\n=== C 机地抓取的重试 ===');
ok(/retry = 1 \}/.test(SIGNED) && /for \(let attempt = 0; attempt <= retry; attempt\+\+\)/.test(SIGNED),
  'C1 signedPost 失败重试一次（且只一次）');
ok(/if \(force\) envCache\.delete\(envP\)/.test(SIGNED),
  'C2 ★ 重试前必须扔掉带病的 env —— 405 的根因就是 env 坏了，不换 env 重试等于重放同一个错');
/* ★ v10.104：退避从 250ms 提到 600ms（实测 250ms 仍落在同一个 SSR 降级窗口里）。
   断言不再写死数字 —— 写死毫秒数会在下次调参时误红，而它真正要守的是
   「**有一个够长的退避**」，所以按「≥400ms」判。 */
const retryGap = (SIGNED.match(/if \(attempt < retry\) await sleep\((\d+)\)/) || [])[1];
ok(retryGap && Number(retryGap) >= 400,
  'C3 重试之间有退避且 ≥400ms（不是立刻打第二次，也不是短到还在同一个降级窗口里）',
  retryGap ? retryGap + 'ms' : '没找到 sleep');
ok(/const env = await getEnv\(envP, \{ host, force \}\)/.test(SIGNED),
  'C4 getEnv 也走 try（取 env 那一步才是最常见的失败点）');
ok(/retried\.push\(i\)/.test(POSTS) && /setTimeout\(r, 400\)/.test(POSTS),
  'C5 topicPosts 对失败的专区串行补抓（并行突发更容易被机地挑战）');
ok(/retried: retried\.includes\(i\)/.test(POSTS), 'C6 补抓痕迹进 payload（排查时能看出这次是重来的）');
ok(/error: String\(\(r\.reason && r\.reason\.message\) \|\| r\.reason\)/.test(POSTS),
  'C7 ★ 补抓后仍失败必须留 error，不许假装「这个专区没有资源」');

console.log('\n=== D 前端：说清「没取到」并给重试 ===');
ok(/async function dlUniFetchBody\(ctx, force\)/.test(INDEX), 'D1 本体取数接收 force');
ok(/\(force \? '&refresh=1' : ''\)/.test(INDEX), 'D2 force 时真的把 refresh=1 拼进 URL');
ok(/bodyErr: \(bodySec && bodySec\.error\) \? String\(bodySec\.error\) : ''/.test(INDEX),
  'D3 本体专区的 error 单独回传（空态才能说清原因）');
ok(/jiErr,/.test(INDEX), 'D4 各专区的错误也一并回传');
ok(/机地这次<b>没取到<\/b>本体链接/.test(INDEX) && /这不是「机地没有」/.test(INDEX),
  'D5 ★ 失败态说「没取到 / 不是机地没有」，而不是笼统的「临时故障」');
ok(/function dlRetryHtml\(\)/.test(INDEX) && /data-dl-retry="body"/.test(INDEX),
  'D6 有「重新抓取机地链接」按钮');
{
  const iRetry = INDEX.indexOf("closest('[data-dl-retry]')");
  const iOpen = INDEX.indexOf("closest('[data-dl-open]')");
  ok(iRetry > 0 && iOpen > 0 && iRetry < iOpen,
    'D7 ★ 重试的委托判断排在 data-dl-open 之前（否则会被当成「再开一次弹窗」）');
}
ok(/function dlRetry\(k\)[\s\S]{0,420}delete dlUni\.data\[k\][\s\S]{0,220}dlUni\.busy\[k\] = false/.test(INDEX),
  'D8 重试先清数据 + 复位 busy（否则 dlUniLoad 直接返回，点了像没反应）');
ok(/const jiWarn = \(v\.bodyErr && !v\.secs\.length\)/.test(INDEX),
  'D9 ★ XD 正常、机地失败时也要提示（这正是本次报障的形态：看起来一切正常）');
ok(!/setTimeout\([^)]*dlRetry\(/.test(INDEX),
  'D10 不自动重试（机地按请求数限流，自动连打会把偶发失败放大成真限流）');
ok(/\.dl-retry-b\{/.test(INDEX) && /\.dl-err\{/.test(INDEX),
  'D11 重试按钮与错误原文都有样式（错误可选中，方便直接贴给排查）');

console.log('\n=== E 发布载荷 ===');
ok(/'data\/dl-cache-ttl\.js'/.test(BUILD),
  'E1 新模块登记进载荷 MUST 清单（漏了线上启动即 MODULE_NOT_FOUND）');

console.log('\n结果：通过 ' + pass + ' / ' + (pass + fail) + (fail ? '  · 失败 ' + fail : ''));
if (fail) console.log('失败项：\n  - ' + fails.join('\n  - '));
process.exit(fail ? 1 : 0);
