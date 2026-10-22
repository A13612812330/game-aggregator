/* v10.103 磁力下载（Komo-Magnet）管理端 + 预留接口
 *
 * 【守什么】这一版不加任何下载能力，只把「管理端」和「接口契约」先立起来。
 *   最容易出的三种错，这份套件逐条盯：
 *     ① **服务端去代理 aria2** —— 线上跑在容器里，它的 127.0.0.1 不是用户的机器，
 *        代理一定连不上；更糟的是等于给公网开了一个「打本机端口」的跳板。
 *     ② **连不上时画假数据** —— 0 条任务和「工具没装」是两件事，混在一起用户永远查不清。
 *     ③ **给死链** —— 安装包还没发布就先渲染下载按钮，用户点一次骂一次。
 *
 * ⚠️ 断言签名统一为 ok(名称, 条件, 附加信息)。上一稿把条件和名称写反了，
 *    字符串当真值 ⇒ 54 条全绿而实际一条没验 —— 这正是「假绿」的经典形态（铁律 196）。
 *
 * 运行：node tools/test-v10103-admin-download.js
 * 前置：服务已在 8124 运行（本机回环免登录）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BASE = process.env.BASE || 'http://127.0.0.1:8124';
const results = [];
/* ★ 名称必须是字符串、条件必须是布尔 —— 顺序写反要立刻炸，不许静默假绿 */
function ok(name, cond, extra) {
  if (typeof name !== 'string') throw new TypeError('ok(名称, 条件): 第一个参数必须是字符串名称');
  results.push([!!cond, name, extra === undefined ? '' : String(extra)]);
  return !!cond;
}
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const SERVER = read('server.js');
const ADMIN = read('public/admin.html');
const INDEX = read('public/index.html');

function fin() {
  const bad = results.filter((r) => !r[0]);
  results.forEach((r) => {
    console.log((r[0] ? '  PASS  ' : '  ❌ FAIL  ') + r[1] + (r[2] ? '  → ' + r[2] : ''));
  });
  console.log('\n' + '='.repeat(68));
  console.log('结果：' + (results.length - bad.length) + ' / ' + results.length + ' 通过');
  if (bad.length) { console.log('失败项：'); bad.forEach((r) => console.log('  - ' + r[1])); process.exitCode = 1; }
}

(async function run() {
  /* ═════════ A. 服务端：只存配置 + 给元信息，绝不代理 RPC ═════════ */
  console.log('-- A. 服务端预留接口 --');
  const metaIdx = SERVER.indexOf("'/api/admin/download/meta'");
  const cfgIdx = SERVER.indexOf("'/api/admin/download/config'");
  ok('A1 /api/admin/download/meta 存在', metaIdx > 0);
  ok('A2 /api/admin/download/config 存在', cfgIdx > 0);

  const start = SERVER.indexOf('/* ── ★ v10.103');
  const BLOCK = start > 0 ? SERVER.slice(start, SERVER.indexOf('/* ── ★ v10.92', start) > 0
    ? SERVER.indexOf('/* ── ★ v10.92', start) : start + 9000) : '';
  const guards = (BLOCK.match(/adminGuard\(req, res\)/g) || []).length;
  ok('A3 三条路由都走 adminGuard（配置是行为开关，不能给公网）', guards >= 3, guards + ' 处');

  /* ★ 反向断言：**v10.103 这段**不许出现 aria2 方法名。
   *   ⚠️ 不能扫整个 server.js —— v10.93 的服务端云下载本来就调 aria2（那是另一条链路，
   *      下载落在容器里、由服务端代下）。这里守的是「磁力任务别再走服务端代理」。 */
  ok('A4 ★反 本段不含任何 aria2 方法名（磁力任务只能走浏览器直连）',
    !/aria2\.(addUri|tellStatus|tellActive|tellWaiting|tellStopped)/.test(BLOCK));

  ok('A5 端口表 6800–6805 只有一份（前端从 meta 取，不各自写死）',
    /const MAGNET_PORTS = \[6800, 6801, 6802, 6803, 6804, 6805\]/.test(SERVER));
  ok('A6 配置落在 data/magnet-config.json',
    /MAGNET_CFG_PATH = path\.join\(__dirname, 'data', 'magnet-config\.json'\)/.test(SERVER));
  ok('A7 POST 会真正落盘', /fs\.writeFileSync\(MAGNET_CFG_PATH/.test(SERVER));

  /* 白名单 + 范围校验：一个字段都不许直接 Object.assign 进去 */
  const KEYS = ['port', 'maxConcurrent', 'seedTime', 'maxSpeed', 'dir', 'autoLaunch'];
  const missKeys = KEYS.filter((k) => BLOCK.indexOf("hasOwnProperty.call(b, '" + k + "')") < 0);
  ok('A8 六个字段逐个 hasOwnProperty 判定（不整体覆盖，少传字段不会被清空）',
    missKeys.length === 0, missKeys.join(',') || '6/6');
  ok('A9 port 有范围校验', /if \(!\(p >= 1024 && p <= 65535\)\)/.test(BLOCK));
  ok('A10 maxConcurrent 有范围校验', /if \(!\(n >= 1 && n <= 16\)\)/.test(BLOCK));
  ok('A11 seedTime 有范围校验', /if \(!\(n >= 0 && n <= 1440\)\)/.test(BLOCK));
  ok('A12 maxSpeed 只收「数字+K/M/G」', /\\d\{1,6\}\[KMG\]/.test(BLOCK));
  ok('A13 改配置要留痕（与豁免同档）', /appendAdminLog\(\{/.test(BLOCK));

  ok('A14 ★ 工具未交付时 meta.setup = null（不预先指一个 404 路径）',
    /version: null/.test(BLOCK) && /setup: null/.test(BLOCK));
  ok('A15 meta 带 setupNote，空态有话说', /setupNote:/.test(BLOCK));

  /* ═════════ B. 管理端：导航 / 视图 / 空态 ═════════ */
  console.log('\n-- B. 管理端视图 --');
  ok('B1 侧栏有「磁力下载」入口', /<a data-v="dl">/.test(ADMIN));
  ok('B2 VIEWS 登记 dl（否则 go() 会回落仪表盘）', /dl: \['磁力下载'/.test(ADMIN));
  ok('B3 切到 dl 触发 dlEnter', /if \(v === 'dl'\) dlEnter\(\);/.test(ADMIN));
  /* ★ 正反双锚点：轮询必须能停。只断言「有 dlLeave」不够 —— 它可能是死代码。 */
  ok('B4 ★ 离开 dl 调用 dlLeave（否则后台每 2 秒空转）', /if \(v !== 'dl'\) dlLeave\(\);/.test(ADMIN));
  ok('B5 dlLeave 真的清掉定时器',
    /function dlLeave\(\) \{[\s\S]{0,120}clearInterval\(DL\.timer\)/.test(ADMIN));
  ok('B6 有独立 section #view-dl', /id="view-dl"/.test(ADMIN));
  ok('B7 任务表 + 空态节点都在', /id="dlRows"/.test(ADMIN) && /id="dlEmpty"/.test(ADMIN));
  ok('B8 设置面板字段齐全',
    /id="dcDir"/.test(ADMIN) && /id="dcPort"/.test(ADMIN) && /id="dcSpeed"/.test(ADMIN)
    && /id="dcConc"/.test(ADMIN) && /id="dcSeed"/.test(ADMIN) && /id="dcAuto"/.test(ADMIN));

  /* 空态不许画假数据 */
  ok('B9 ★ 未接入时明说「不显示假数据」', /这里不显示假数据/.test(ADMIN));
  ok('B10 ★ 未接入时禁用「加入下载」按钮', /\$\('dlAddBtn'\)\.disabled = !online;/.test(ADMIN));
  ok('B11 角标：连不上显示「—」而不是 0（0 会被读成「工具在跑但没任务」）',
    /\$\('nDl'\)\.textContent = online \? nf\(DL\.act\.length \+ DL\.wait\.length\) : '—'/.test(ADMIN));

  /* 契约：RPC 直连 + token + 方法名 */
  ok('B12 RPC 打 127.0.0.1（不是服务端代理）',
    /fetch\('http:\/\/127\.0\.0\.1:' \+ port \+ '\/jsonrpc'/.test(ADMIN));
  ok('B13 每次调用带 token 前缀', /'token:' \+ DL\.secret/.test(ADMIN));
  ok('B14 探活用 getVersion', /aria2\.getVersion/.test(ADMIN));
  ok('B15 加任务用 addUri', /aria2\.addUri/.test(ADMIN));
  ok('B16 三种操作映射到 aria2 原方法',
    /pause: 'aria2\.pause', unpause: 'aria2\.unpause', remove: 'aria2\.remove'/.test(ADMIN));
  ok('B17 保存设置会下发 changeGlobalOption', /aria2\.changeGlobalOption/.test(ADMIN));
  ok('B18 ★ 未连接时不下发，也不谎报「已生效」',
    /if \(!DL\.port\) \{ toast\('设置已保存（下载器未连接，连上后生效）'\); return; \}/.test(ADMIN));

  ok('B19 设置页有接口契约表', /磁力下载接口（v10\.103 预留）/.test(ADMIN));
  ok('B20 契约表列出服务端端点', /api\/admin\/download\/config/.test(ADMIN));

  /* ═════════ C. 首页：状态条，且不给死链 ═════════ */
  console.log('\n-- C. 首页下载弹窗 --');
  ok('C1 下载弹窗有本机下载器状态条', /id="kmBar"/.test(INDEX));
  ok('C2 打开弹窗就同步状态', /kmBarSync\(\);/.test(INDEX) && /function kmBarSync\(\)/.test(INDEX));
  ok('C3 已连接/未检测到两种视觉状态都在', /\.kmbar\.on\{/.test(INDEX) && /\.kmbar\.off\{/.test(INDEX));
  ok('C4 移动端直接隐藏（手机上永远没有这个 exe）',
    /if \(!KC_DESKTOP\) \{ el\.hidden = true; return; \}/.test(INDEX));
  /* ★ 死链防护：KM_SETUP 为空 ⇒ 渲染时不会有 <a href>，只有文字说明 */
  const mSetup = /const KM_SETUP = '([^']*)';/.exec(INDEX);
  ok('C5 KM_SETUP 常量存在', !!mSetup);
  ok('C6 ★ KM_SETUP 现在必须是空串（安装包未发布）', !!mSetup && mSetup[1] === '',
    mSetup ? JSON.stringify(mSetup[1]) : '缺常量');
  ok('C7 安装链接由 KM_SETUP 条件渲染（空 ⇒ 不渲染，避免死链）',
    /\(KM_SETUP \? '<a class="kb-act" href="' \+ KM_SETUP/.test(INDEX));
  /* ★ 换行容错：源码是跨行拼接的，写死一行里的空格数会在下一次排版调整后误红。
     ★ v10.104 改口径：原句「磁力仍可直接云下载，不装也能用」是**错的** ——
       云下载只服务 FitGirl 那条线，机地帖的磁力没有云下载兜底（点了只会复制）。
       断言跟着改成「点磁力会复制」，并要求**反向**不再出现「云下载」字样。 */
  ok('C8 未检测到时明确告知「点磁力会复制」，不再谎称磁力可云下载',
    /未检测到 <b>'[\s\S]{0,24}KM_NAME[\s\S]{0,40}点「磁力」会复制链接/.test(INDEX));
  /* ★ 负向断言必须**剥注释再判**（铁律：「注释会咬负向断言」）。
     源码里留着那句「以前写 XXX…」的说明性注释，裸扫会把注释当代码判红。 */
  const codeOnly = (s) => String(s).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  ok('C8b ★反 未检测到的提示里不许再出现「磁力仍可直接云下载」（注释不算）',
    !/磁力仍可直接云下载/.test(codeOnly(INDEX)));

  const pages = ['emulator.html', 'unpack.html', 'resources.html', 'extract.html'];
  const missBar = pages.filter((p) => read('public/' + p).indexOf('id="kmBar"') < 0);
  ok('C9 ★ 四张派生页都带 #kmBar（漏了就是没重建）', missBar.length === 0, missBar.join(',') || '4/4');

  /* ═════════ D. 活体：端点真的通 ═════════ */
  console.log('\n-- D. 活体端点（' + BASE + '）--');
  const getJson = async (p) => {
    const r = await fetch(BASE + p);
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  try {
    const m = await getJson('/api/admin/download/meta');
    ok('D1 meta 返回 200/ok', m.status === 200 && m.body && m.body.ok === true, 'HTTP ' + m.status);
    ok('D2 meta.tool.name = Komo-Magnet', !!(m.body && m.body.tool && m.body.tool.name === 'Komo-Magnet'),
      m.body && m.body.tool ? m.body.tool.name : '—');
    ok('D3 meta 带端口表', !!(m.body && Array.isArray(m.body.ports) && m.body.ports[0] === 6800));
    ok('D4 ★ meta.setup 仍是 null（未交付）', !!(m.body && m.body.tool && m.body.tool.setup === null));

    const c = await getJson('/api/admin/download/config');
    ok('D5 config 返回 200/ok', c.status === 200 && c.body && c.body.ok === true, 'HTTP ' + c.status);
    const cfg = (c.body && c.body.config) || {};
    ok('D6 默认 secret 与工具端一致', cfg.secret === 'komomagnet-local', cfg.secret || '—');
    ok('D7 默认值可读（端口 6800 / 并发 5 / 不做种）',
      cfg.port === 6800 && cfg.maxConcurrent === 5 && cfg.seedTime === 0,
      [cfg.port, cfg.maxConcurrent, cfg.seedTime].join(' / '));

    /* 反向：越界值必须被拒（400），不能静默存下去 */
    const bad = await fetch(BASE + '/api/admin/download/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxConcurrent: 999 }),
    });
    const bj = await bad.json().catch(() => null);
    ok('D8 ★ 越界 maxConcurrent=999 被拒（400）', bad.status === 400 && !!bj && bj.ok === false, 'HTTP ' + bad.status);
    ok('D9 拒绝理由说清范围', !!(bj && /1–16/.test(bj.error || '')), (bj && bj.error) || '—');

    /* 反向：服务端不该有「加磁力」端点（磁力只走浏览器 → 本机工具） */
    const noAdd = await fetch(BASE + '/api/admin/download/add', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uri: 'magnet:?xt=urn:btih:x' }),
    });
    ok('D10 ★ 不存在 /api/admin/download/add（磁力不入服务端）', noAdd.status === 404, 'HTTP ' + noAdd.status);

    /* 正向：合法写入后能读回（用默认值本身写，不污染配置） */
    const good = await fetch(BASE + '/api/admin/download/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxConcurrent: cfg.maxConcurrent, seedTime: cfg.seedTime }),
    });
    const gj = await good.json().catch(() => null);
    ok('D11 合法写入返回 ok 且配置不变', good.status === 200 && !!gj && gj.ok === true
      && gj.config.maxConcurrent === cfg.maxConcurrent, 'HTTP ' + good.status);
  } catch (e) {
    ok('D 段活体探测失败（服务没起？）', false, String(e && e.message));
  }

  fin();
})();
