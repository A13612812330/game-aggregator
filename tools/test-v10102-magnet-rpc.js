/* v10.102 Komo-Magnet 页面端对接 —— 本地 RPC 直连 / 端口回退 / 进度浮层
 *
 * 【守什么】v10.101 靠「唤起 + 2.2 秒失焦猜」，用户切窗口就会误判。
 *   v10.102 改成先探本地 aria2 RPC：探到 = 装了，探不到 = 没装，不需要猜。
 *   这份套件守住四件事：
 *     ① 探测是**并发**的（串行 6×350ms 会让没装的人比旧方案等更久）；
 *     ② 端口按 6800→6805 回退，命中哪个记哪个；
 *     ③ 入队参数带 token 与原始 magnet，且**连点只入队一次**；
 *     ④ 探不到时必须落回云下载（返回 false），不能把用户卡死。
 *   进度浮层只验渲染（百分比/体积），不验 aria2 真实下载 —— 那是工具端的事。
 *
 * 运行：node tools/test-v10102-magnet-rpc.js
 * 前置：服务已在 8123/8124 运行
 */
const { JSDOM, VirtualConsole } = require('jsdom');

const BASE = process.env.BASE || 'http://127.0.0.1:8124';
const results = [];
const ok = (n, c, extra) => { results.push([c, n, extra || '']); return c; };

const MOCK = { mode: 'ok', calls: [], added: [] };
const MAGNET = 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=test';

function reply(id, result) {
  return Promise.resolve({ json: () => Promise.resolve({ jsonrpc: '2.0', id, result }) });
}

/* 普通 REST 回包（不带 jsonrpc 信封）—— 磁力接口用它，别和 RPC 混。 */
function plain(data) {
  return Promise.resolve({ json: () => Promise.resolve(data) });
}

/* 把 127.0.0.1 的 RPC 与磁力接口都拦下来，测试不依赖真实 aria2 与真实库数据。 */
function kmMock(url, opt) {
  const m = /127\.0\.0\.1:(\d+)/.exec(url);
  const port = m ? Number(m[1]) : 0;
  let body = {};
  try { body = JSON.parse((opt && opt.body) || '{}'); } catch (e) {}
  const method = body.method || '';
  MOCK.calls.push(port + ':' + method);

  if (MOCK.mode === 'none') return Promise.reject(new Error('ECONNREFUSED'));
  if (method === 'aria2.getVersion') {
    if (MOCK.mode === 'only6802' && port !== 6802) return Promise.reject(new Error('closed'));
    return reply(body.id, { version: '1.37.0', enabledFeatures: ['BitTorrent'] });
  }
  if (method === 'aria2.addUri') {
    MOCK.added.push(body.params);
    return reply(body.id, 'gid-' + MOCK.added.length);
  }
  if (method === 'aria2.tellStatus') {
    return reply(body.id, {
      status: 'active', totalLength: '1000', completedLength: '250',
      downloadSpeed: '512000', errorMessage: '',
    });
  }
  return reply(body.id, null);
}

async function makeDom(desktop) {
  const url = BASE + '/';
  const html = await fetch(url).then((r) => r.text());
  const errs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    const msg = String(e.message || e);
    if (/Could not load|Not implemented|navigation/i.test(msg)) return;
    errs.push(msg);
  });
  const dom = new JSDOM(html, {
    url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      const raw = w.fetch;
      w.fetch = function (u, o) {
        const s = String(u);
        if (/^https?:\/\/127\.0\.0\.1:/.test(s)) return kmMock(s, o);
        if (s.indexOf('/api/fitgirl/magnet') >= 0) {
          return plain({ ok: true, magnets: [MAGNET] });
        }
        const real = raw || nativeFetch;
        return real.call(w, s.startsWith('http') ? s : BASE + s, o);
      };
      w.scrollTo = () => {};
      w.Element.prototype.scrollIntoView = function () {};
      w.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
      if (desktop) w.matchMedia = (q) => ({ matches: true, media: q, addListener() {}, removeListener() {} });
    },
  });
  await new Promise((r) => setTimeout(r, 1600));
  return { dom, errs };
}

const nativeFetch = globalThis.fetch;

async function main() {
  const { dom, errs } = await makeDom(true);
  const w = dom.window;
  const html = await fetch(BASE + '/').then((r) => r.text());

  ok('页面运行无 JS 异常', errs.length === 0, errs[0] || '');

  /* ---------- 一、常量与入口 ---------- */
  ok('★ KM_SECRET 与工具端约定一致', w.eval('KM_SECRET') === 'komomagnet-local', w.eval('KM_SECRET'));
  ok('★ 端口表 6800 起、共 6 个',
    JSON.stringify(w.eval('KM_PORTS')) === '[6800,6801,6802,6803,6804,6805]',
    JSON.stringify(w.eval('KM_PORTS')));
  ok('★ kmProbe / kmAdd / kmRpc / kmTrack 均已定义',
    ['kmProbe', 'kmAdd', 'kmRpc', 'kmTrack'].every((n) => w.eval('typeof ' + n) === 'function'));
  ok('★★ 探测是并发的（串行会让没装的人比旧方案更慢）',
    /Promise\.all\(KM_PORTS\.map/.test(w.eval('kmProbe.toString()')));
  ok('★ 探测失败结果有 TTL，连点不重复付 350ms',
    w.eval('KM_MISS_TTL') === 30000 && /kmMissAt/.test(w.eval('kmProbe.toString()')));
  ok('★★ 入队失败会强制重探一次（工具重启换端口不至于判死）',
    /kmProbe\(true\)/.test(w.eval('kmAdd.toString()')));

  /* ---------- 二、RPC 通：直接入队，参数正确 ---------- */
  MOCK.mode = 'ok';
  MOCK.calls.length = 0;
  MOCK.added.length = 0;
  {
    const r = await w.eval(`kcTryHandoff('some-slug', '测试游戏')`);
    ok('★★ RPC 通 → 入队成功、返回 true（不弹云下载）', r === true, String(r));
    ok('★★ addUri 只发了一次（两条路不能同时走）', MOCK.added.length === 1, 'count=' + MOCK.added.length);
    const p = MOCK.added[0] || [];
    ok('★★ 参数带 token', p[0] === 'token:komomagnet-local', String(p[0]));
    ok('★★ 参数带原始 magnet（没被截断/编码坏）', p[1] && p[1][0] === MAGNET, String(p[1] && p[1][0]).slice(0, 40));
    ok('★ 命中默认端口 6800', MOCK.calls.some((c) => c === '6800:aria2.addUri'),
      MOCK.calls.filter((c) => /addUri/.test(c)).join(','));
    ok('★ 入队后建了进度浮层（用户能看见在下）', !!w.document.getElementById('kmDock'));
    ok('★ 浮层标题取的是卡片标题，不是 slug', /测试游戏/.test(
      (w.document.querySelector('#kmDock .km-dock-t') || {}).textContent || ''));
  }

  /* ---------- 三、端口回退 ---------- */
  {
    const { dom: d2 } = await makeDom(true);
    MOCK.mode = 'only6802';
    MOCK.added.length = 0;
    MOCK.calls.length = 0;
    const r = await d2.window.eval(`kcTryHandoff('some-slug', 't')`);
    ok('★★ 6800 不通时回退到 6802 仍能入队', r === true && MOCK.added.length === 1,
      `r=${r} added=${MOCK.added.length}`);
    ok('★ 回退时确实探过 6800 与 6801', MOCK.calls.some((c) => c.startsWith('6800:'))
      && MOCK.calls.some((c) => c.startsWith('6801:')));
    d2.window.close();
  }

  /* ---------- 四、连点只入队一次 ---------- */
  {
    const { dom: d3 } = await makeDom(true);
    MOCK.mode = 'ok';
    MOCK.added.length = 0;
    const t = Date.now();
    const r = await d3.window.eval(`(async () => {
      const a = kcTryHandoff('some-slug', '连点');
      const b = kcTryHandoff('some-slug', '连点');
      return [await a, await b];
    })()`);
    ok('★★ 连点两次只 addUri 一次（kmBusy 生效）', MOCK.added.length === 1, 'count=' + MOCK.added.length);
    ok('★ 第二次直接返回 true（不重复弹窗、不让用户等）', r[1] === true, String(r[1]));
    ok('★ 连点总耗时没翻倍', Date.now() - t < 2500, `${Date.now() - t} ms`);
    d3.window.close();
  }

  /* ---------- 五、探不到：必须落回云下载 ---------- */
  {
    const { dom: d4 } = await makeDom(true);
    MOCK.mode = 'none';
    MOCK.added.length = 0;
    const r = await d4.window.eval(`kcTryHandoff('some-slug', '没装')`);
    ok('★★ 工具没装 → 返回 false，调用方继续开云下载（不把用户卡死）', r === false, String(r));
    ok('★★ 没装时不入队', MOCK.added.length === 0, 'count=' + MOCK.added.length);
    ok('★ 没装时探测覆盖了全部 6 个端口',
      new Set(MOCK.calls.filter((c) => /getVersion/.test(c)).map((c) => c.split(':')[0])).size === 6,
      [...new Set(MOCK.calls.map((c) => c.split(':')[0]))].join(','));
    d4.window.close();
  }

  /* ---------- 六、非桌面端：一个 RPC 请求都不发 ---------- */
  {
    const { dom: d5 } = await makeDom(false);
    MOCK.mode = 'ok';
    MOCK.calls.length = 0;
    const r = await d5.window.eval(`kcTryHandoff('some-slug', '手机')`);
    ok('★★ 手机端直接 return false', r === false, String(r));
    ok('★★ 手机端不发任何本地 RPC 请求（省电、不白等）',
      MOCK.calls.filter((c) => /aria2\./.test(c)).length === 0, MOCK.calls.join(','));
    d5.window.close();
  }

  /* ---------- 七、进度浮层渲染 ---------- */
  {
    const { dom: d6 } = await makeDom(true);
    const w6 = d6.window;
    MOCK.mode = 'ok';
    w6.eval(`kmTrack(6800, 'gid-1', '进度测试')`);
    await new Promise((r) => setTimeout(r, 1100));
    const dock = w6.document.getElementById('kmDock');
    ok('★ 浮层出现并带 show 类', !!dock && dock.classList.contains('show'), dock ? dock.className : 'null');
    ok('★★ 百分比按 completedLength/totalLength 算对（250/1000 = 25.0%）',
      (dock.querySelector('.km-dock-p') || {}).textContent === '25.0%',
      (dock.querySelector('.km-dock-p') || {}).textContent || '');
    ok('★ 副行同时显示已下/总量与速度',
      /KB/.test((dock.querySelector('.km-dock-s') || {}).textContent || ''),
      (dock.querySelector('.km-dock-s') || {}).textContent || '');
    ok('★★ 浮层层级低于 toast（145 < 150），不盖住提示条',
      /\.km-dock\{[^}]*z-index:145/.test(html));
    d6.window.close();
  }

  /* ---------- 八、降级顺序（源码级） ---------- */
  ok('★★ 源码顺序：kmAdd 在 kcLaunch 之前（先试直连，再试协议）',
    html.indexOf('const added = await kmAdd(magnet);') < html.indexOf('const fired = kcLaunch(magnet);'));
  ok('★★ 源码锚点：直连成功即 return，不继续唤起协议',
    /if \(added\) \{[\s\S]{0,180}return true;/.test(html));
  ok('★ 反向：RPC 路径里没有出现失焦等待常量 KM_WAIT',
    !/KM_WAIT/.test(html));

  dom.window.close();

  const pass = results.filter((r) => r[0]).length;
  const fail = results.length - pass;
  for (const [c, n, e] of results) if (!c) console.log(`❌ ${n}${e ? '  ← ' + e : ''}`);
  console.log(`\nv10.102 Komo-Magnet 页面端：通过 ${pass} / ${results.length}，失败 ${fail}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
