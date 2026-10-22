/* v10.104 磁力链接 + env 空壳兜底 —— 常驻防线
 *
 * 两个根因（都是「源站明明有，我们这边显示 0」）：
 *   ① `shared.extractLinks` 只认 `https?://` ⇒ 纯磁力帖整条变成「无链接帖」。
 *      渔力全开（tid=2117239899）本体 35 帖里有 4 帖只有 magnet，旧逻辑下
 *      `withLinks` 是 31/35，用户看到的就是「本体很多下载源但没获取到」。
 *   ② `getEnv` 把源站的 **SPA 骨架空壳页**（HTTP 200 / 1188B / `APP_INITIAL_STATE={}`）
 *      当成「源站改版」直接抛错，一次失败就让整个本体专区显示 0 条。
 *
 * ★ 本套纯本地：C 组用 mock fetch 打桩，不打真源站（与 test-v1026 同一原则）。
 * ★ 反证（改坏必须变红，逐条已实跑）：
 *   · extractLinks 正则去掉 `magnet:\?`        → A1/A2 变红
 *   · magnet 走 `dropInternal` 的 host 判定    → A5 变红（磁力没有 host，会被 continue 掉）
 *   · 去重键改回整串 URL                        → A3 变红
 *   · 尾巴清洗沿用 http 那条（连 `.` 一起剥）   → A4 变红
 *   · classifyPage 不认 APP_INITIAL_STATE       → B1 变红
 *   · loadEnv 去掉 ENV_FALLBACK                 → C1 变红
 *   · ENV_MAX_TRIES 调大                        → C4 变红
 *   · dlRow 把磁力也写成 <a href>               → D1 变红
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { extractLinks } = require('../shared');
const { classifyPage, getEnv, EnvError, ENV_MAX_TRIES } = require('../fetchers/jidiSigned');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (typeof name !== 'string') throw new TypeError('ok(名称, 条件) 参数顺序写反了：' + name);
  if (cond) { pass++; console.log('  PASS  ' + name + (detail ? '  — ' + detail : '')); }
  else { fail++; console.log('  × FAIL  ' + name + (detail ? '  — ' + detail : '')); }
};
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const MAG1 = 'magnet:?xt=urn:btih:13c35e31f2c8022cbc036f717c805c9c509b5ec2&dn=How.to.Fish.rar';
const MAG2 = 'magnet:?xt=urn:btih:c3d6508ed3d2073fa0523f9aa4a123d081ce2cfc&dn=How.to.Fish';

/* ============================================================
 *  A. extractLinks 认得磁力
 * ============================================================ */
console.log('\nA. extractLinks：磁力链接');
{
  const r1 = extractLinks(MAG1 + ' ❗️使用说明：a.下载到非中文文件夹');
  ok('A1 纯磁力串被抽出，kind=磁力链接',
    r1.length === 1 && r1[0].kind === '磁力链接' && r1[0].url === MAG1, JSON.stringify(r1));

  const r2 = extractLinks('链接：https://pan.xunlei.com/s/VP1abc?pwd=vxmr 磁力：' + MAG2);
  ok('A2 同一帖里网盘 + 磁力都能抽到（顺序与原文一致）',
    r2.length === 2 && r2[0].kind === '迅雷网盘' && r2[1].kind === '磁力链接',
    r2.map((x) => x.kind).join(','));

  const r3 = extractLinks(MAG2 + ' ' + MAG2.replace('&dn=How.to.Fish', '&dn=Other&tr=udp%3A%2F%2Ftr'));
  ok('A3 同一种子换了 tracker / dn ⇒ 仍算同一条（按 btih 去重）',
    r3.length === 1, '条数 ' + r3.length);

  const r4 = extractLinks('种子：' + MAG1 + '。更多请看源站');
  ok('A4 中文句号被剥掉，但文件名里的 .rar 保留',
    r4.length === 1 && r4[0].url.endsWith('How.to.Fish.rar'), r4[0] && r4[0].url.slice(-20));

  /* ★ 磁力没有 host：若沿用 http 那条 `new URL(u).hostname` 判定，会 catch 后直接 continue */
  const r5 = extractLinks(MAG1, { dropInternal: true });
  ok('A5 ★反 磁力不受「站内链接过滤」影响（它没有 host，判 host 会把它吞掉）',
    r5.length === 1 && r5[0].kind === '磁力链接');

  const r6 = extractLinks('https://52leiqu.com/problemTutorial ' + MAG1);
  ok('A6 广告站链接仍被过滤，磁力保留',
    r6.length === 1 && /^magnet:/.test(r6[0].url), JSON.stringify(r6.map((x) => x.kind)));

  const r7 = extractLinks('https://pan.baidu.com/s/1AbC?pwd=9x2k 从 https://jidiyouxi.com/post/detail/1 看');
  ok('A7 ★反 普通链接行为不变（网盘识别 + 站内链接过滤都照旧）',
    r7.length === 1 && r7[0].kind === '百度网盘' && r7[0].url.indexOf('pwd=9x2k') > 0,
    JSON.stringify(r7));
}

/* ============================================================
 *  B. 空壳页分类
 * ============================================================ */
console.log('\nB. classifyPage：把「SSR 降级」与「真改版」分开');
{
  const SHELL = '<!DOCTYPE html><html lang="en-US"><head><title>Title for h5</title></head><body>'
    + '<div id="app"></div><script>window.APP_INITIAL_STATE={}</script>'
    + '<script src="//static2.52jidi.com/game-community-web-outland_test/app.a682720d99.js"></script></body></html>';
  const GOOD = '<html><body><script id="appState">window.__s={"env":{"host":"jidiyouxi.com"}}</script></body></html>';

  ok('B1 SPA 骨架（1188B / APP_INITIAL_STATE={}）判成 shell',
    classifyPage(SHELL).kind === 'shell', classifyPage(SHELL).len + 'B');
  ok('B2 带 appState 的正常页判成 ok', classifyPage(GOOD).kind === 'ok');
  ok('B3 有 HTML 但没有 appState 也没有骨架标记 ⇒ no-appstate（这才是结构真的变了）',
    classifyPage('<html><body>hello</body></html>').kind === 'no-appstate');
  ok('B4 空响应判成 empty，不误判成 shell', classifyPage('').kind === 'empty');
}

/* ============================================================
 *  C. getEnv 的兜底链路（mock fetch，不打真源站）
 * ============================================================ */
const SHELL_HTML = '<!DOCTYPE html><html><body><div id="app"></div>'
  + '<script>window.APP_INITIAL_STATE={}</script></body></html>';
const GOOD_HTML = '<html><body><script id="appState">'
  + 'window.__s={"env":{"host":"jidiyouxi.com","h_did":"did-x","h_m":"1"}}</script></body></html>';
const BARE_HTML = '<html><body>service unavailable</body></html>';

const realFetch = global.fetch;
/** map: { '/topic/list': html, ... } —— 未命中的一律返回裸 HTML */
function mockFetch(map) {
  const calls = [];
  global.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    const hit = Object.keys(map).find((k) => u.indexOf(k) >= 0);
    const html = hit ? map[hit] : BARE_HTML;
    return { ok: true, status: 200, text: async () => html, json: async () => JSON.parse(html) };
  };
  return calls;
}

(async () => {
  console.log('\nC. getEnv：空壳重试 + 换页面兜底 + 次数上限');
  try {
    /* C1 主路径空壳 → 换 /modify/list 救回来 */
    let calls = mockFetch({ '/modify/list': GOOD_HTML, '/topic/list': SHELL_HTML });
    const env1 = await getEnv('/topic/list', { force: true });
    ok('C1 主路径返回空壳 ⇒ 自动换页面拿到 env',
      !!env1 && env1.host === 'jidiyouxi.com' && calls.some((u) => u.indexOf('/modify/list') >= 0),
      '请求 ' + calls.length + ' 次');

    /* C2 全部空壳 ⇒ EnvError，kind=shell，且**不是** fatal（值得稍后重试） */
    calls = mockFetch({ '/topic/list': SHELL_HTML, '/modify/list': SHELL_HTML });
    let e2 = null;
    try { await getEnv('/topic/list', { force: true }); } catch (e) { e2 = e; }
    ok('C2 全是空壳 ⇒ 抛 EnvError(kind=shell)，且 fatal=false（属可重试）',
      !!e2 && e2 instanceof EnvError && e2.kind === 'shell' && e2.fatal === false,
      e2 && (e2.kind + ' fatal=' + e2.fatal));
    ok('C2b 错误文案说清「SSR 偶发降级，不是改版」，并列出试过哪几次',
      !!e2 && /SSR 偶发降级/.test(e2.message) && /已试 3 次/.test(e2.message),
      e2 && e2.message.slice(0, 90));

    /* C3 全部「没有 appState」⇒ fatal（重试只会多打请求） */
    calls = mockFetch({ '/topic/list': BARE_HTML, '/modify/list': BARE_HTML });
    let e3 = null;
    try { await getEnv('/topic/list', { force: true }); } catch (e) { e3 = e; }
    ok('C3 页面连 appState 都没有 ⇒ fatal=true（让上层立刻放弃，别把偶发放大成限流）',
      !!e3 && e3.fatal === true, e3 && ('kind=' + e3.kind + ' fatal=' + e3.fatal));

    /* C4 请求次数上限 */
    calls = mockFetch({ '/topic/list': SHELL_HTML, '/modify/list': SHELL_HTML });
    try { await getEnv('/topic/list', { force: true }); } catch (e) { /* 预期 */ }
    ok('C4 ★反 单次 getEnv 的页面请求数不超过 ENV_MAX_TRIES（' + ENV_MAX_TRIES + '）',
      calls.length <= ENV_MAX_TRIES, '实际 ' + calls.length + ' 次');

    /* C5 首路径就成功 ⇒ 不打第二个页面 */
    calls = mockFetch({ '/topic/list': GOOD_HTML, '/modify/list': GOOD_HTML });
    const env5 = await getEnv('/topic/list', { force: true });
    ok('C5 ★反 首路径就拿到 env ⇒ 只请求 1 次，不做多余的兜底',
      calls.length === 1 && !!env5 && env5.host === 'jidiyouxi.com', '请求 ' + calls.length + ' 次');

    /* C6 单飞：并发 3 次只发 1 轮请求 */
    calls = mockFetch({ '/topic/list': GOOD_HTML, '/modify/list': GOOD_HTML });
    await Promise.all([
      getEnv('/topic/list', { force: true }),
      getEnv('/topic/list', { force: true }),
      getEnv('/topic/list', { force: true }),
    ]);
    ok('C6 ★反 同路径并发只发一轮请求（三专区并行时不叠着打源站）',
      calls.length <= 1, '请求 ' + calls.length + ' 次');

    /* ============================================================
     *  D. 前端渲染：磁力按钮不是普通链接
     * ============================================================ */
    console.log('\nD. 前端：磁力按钮与筛选');
    const IDX = read('public/index.html');

    ok('D1 磁力渲染成 button[data-km-magnet]（不是 <a href>）',
      /'<button type="button" class="lk bd-magnet" data-km-magnet="/.test(IDX));
    ok('D2 ★反 网盘链接仍是 <a href>，没被一起改成 button',
      /'<a class="lk bd-' \+ b\.cls \+ '" href="/.test(IDX));
    ok('D3 DL_BRAND 把磁力排在最前（否则「磁力下载」可能先被判成迅雷）',
      /const DL_BRAND = \[\s*\/\*[\s\S]{0,120}?\*\/\s*\[\/磁力\|magnet\/i, 'magnet', '磁'\]/.test(IDX));
    ok('D4 盘口中文名有 magnet → 磁力',
      /magnet: '磁力'/.test(IDX));
    ok('D5 有独立的磁力点击处理器（带兜底复制）',
      /closest\('\[data-km-magnet\]'\)/.test(IDX) && /const ok = await copyText\(magnet\)/.test(IDX));
    ok('D6 剪贴板只留一份实现（copyText），dlCopy 复用',
      (IDX.match(/function copyText\(/g) || []).length === 1
      && /function dlCopy\(el\) \{[\s\S]{0,220}copyText\(txt\)/.test(IDX));
    ok('D7 分区标题写出「含 N 条磁力」（否则磁力帖排在 12 行外，用户以为没有）',
      /' 帖'\s*\+\s*\(cur\.items\.some\(\(x\) => \/\^magnet:\/i\.test/.test(IDX));

    /* ============================================================
     *  E. 服务端链路：磁力的 kind 会被原样带下去
     * ============================================================ */
    console.log('\nE. 服务端：磁力条目的字段透传');
    const DL = read('fetchers/download.js');
    ok('E1 flatFrom 把 links[].kind 写进 server、links[].url 写进 real（磁力才有 server=磁力链接）',
      /server: l\.kind/.test(DL) && /real: l\.url/.test(DL));
  } catch (e) {
    fail++;
    console.log('  × FAIL  套件异常中断：' + (e && e.stack || e));
  } finally {
    global.fetch = realFetch;
  }

  console.log('\n============================');
  console.log('  v10.104 磁力 + env 兜底：通过 ' + pass + ' / ' + (pass + fail) + '，失败 ' + fail);
  console.log('============================');
  /* ★ 必须是三元 —— run-all 的 exitTiedToFailures() 只认 `process.exit(fail ? …)` 这种形态，
     写成 `if (fail) process.exit(1)` 会被判「退出码不随失败变」（反证就跑不出来了）。 */
  process.exit(fail ? 1 : 0);
})();
