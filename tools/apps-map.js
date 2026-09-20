/*
 * tools/apps-map.js —— 应用清单（appId ↔ 域名 ↔ sandbox ↔ 版本）· 只读 · 无网络写入
 *
 * 为什么需要它（补 tools/audit-apps.js 的盲区）：
 *   audit-apps.js 只扫「本地登记过的 app」（applications.yaml ∪ .wbapp_*.genie），
 *   而实测发现本地登记**漏了 3 个**早期 app（claim 过预留域名但从未 publish）,
 *   并且它把 appId 与域名**分成两张表、不给你对应关系** ⇒ 无法回答「删哪个」。
 *
 * 数据源优先级（本文件实测得出的结论）：
 *   ① logs/sites/sites-deploy-*.log —— **发布插件自己的日志**，含
 *      `resolve.domainClaim | appId=… reservedDomain=…`（app 创建）
 *      `cloudApi.publish.start | applicationId=… sandboxId=…`（发布）
 *      ⇒ appId ↔ 域名的**唯一权威来源**，比本地登记文件可靠。
 *   ② <工作区>/.workbuddy/applications.yaml + .wbapp_*.genie —— 只有 appId，**没有域名**。
 *   ③ cloudstudio-deploy-history/*.json —— 只有 2026-09-20 之后的记录带 appId 字段
 *      （早期发布撞上 `local deploy record was NOT saved: EBUSY` ⇒ 没落盘）。
 *
 * 用法：node tools/apps-map.js [--no-net]
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const WS = path.join(ROOT, '..');
const HOME = process.env.USERPROFILE || process.env.HOME || '';
const LOGDIR = path.join(HOME, '.workbuddy', 'logs', 'sites');
const NO_NET = process.argv.includes('--no-net');

/* ============ ① 解析发布日志 ============ */
function parseLog() {
  const events = [];
  let files = [];
  try { files = fs.readdirSync(LOGDIR).filter((x) => /\.log$/.test(x)).sort(); } catch (e) { return { events, files }; }
  for (const f of files) {
    let txt = '';
    try { txt = fs.readFileSync(path.join(LOGDIR, f), 'utf8'); } catch (e) { continue; }
    txt.split(/\r?\n/).forEach((l, n) => {
      const at = (l.match(/^\[([\d-]+T[\d:.]+Z)\]/) || [])[1] || '';
      const dep = (l.match(/deploy=([0-9a-f]{8})\]/) || [])[1] || '';
      let m;
      if ((m = l.match(/resolve\.domainClaim \| appId="(wbapp_\w+)" reservedDomain="([^"]+)"/)))
        events.push({ kind: 'create', appId: m[1], domain: m[2], at, deploy: dep, src: f + ':' + n });
      if ((m = l.match(/cloudApi\.publish\.start \| applicationId="(wbapp_\w+)" sandboxId="([^"]+)"/)))
        events.push({ kind: 'publish', appId: m[1], sandbox: m[2], at, deploy: dep, src: f + ':' + n });
      if ((m = l.match(/deploy SUCCESS sandbox=(\w+) conv=(\d+) port=(\d+) language=(\w+) shareLink=(\S+)/)))
        events.push({ kind: 'success', sandbox: m[1], conv: m[2], port: +m[3], lang: m[4], shareLink: m[5], at, deploy: dep, src: f + ':' + n });
      if ((m = l.match(/detail\.hit \| appId="(wbapp_\w+)" name="([^"]*)" domain="([^"]+)"/)))
        events.push({ kind: 'detail', appId: m[1], name: m[2], domain: m[3], at, deploy: dep, src: f + ':' + n });
      if (/local deploy record was NOT saved/.test(l))
        events.push({ kind: 'warn-norecord', at, deploy: dep, src: f + ':' + n, msg: l.slice(0, 160) });
      /* ★ sandbox 直链要**全量**抓：`deploy SUCCESS` 只记最终 sandbox，
         而复用过的旧 sandbox（如 36aa37e9…）仍可能有直链在对外可访问（实测 200）。 */
      for (const mm of l.matchAll(/sandbox[= "](\w{32})/g))
        events.push({ kind: 'sandbox-seen', sandbox: mm[1], at, deploy: dep, src: f + ':' + n });
    });
  }
  return { events, files };
}

/* ============ ② appId → 域名 ============ */
function buildMap(events) {
  const m = new Map();
  for (const e of events) {
    if (!e.appId) continue;
    if (!m.has(e.appId)) m.set(e.appId, { domain: '', name: '', created: '', publishes: [], sandbox: '' });
    const a = m.get(e.appId);
    if (e.domain && (e.kind === 'detail' || !a.domain)) a.domain = e.domain;
    if (e.name) a.name = e.name;
    if (e.kind === 'create' && !a.created) a.created = e.at;
    if (e.kind === 'publish') { a.publishes.push(e.at); a.sandbox = e.sandbox; }
  }
  return m;
}

/* ============ ③ 本地登记 ============ */
function readRegistered() {
  const ids = new Set();
  try {
    const y = fs.readFileSync(path.join(WS, '.workbuddy', 'applications.yaml'), 'utf8');
    for (const x of y.matchAll(/locator:\s*(\S+)/g)) ids.add(x[1]);
  } catch (e) { /* ignore */ }
  try {
    for (const f of fs.readdirSync(WS)) {
      const mm = f.match(/^\.(wbapp_[\w-]+)\.genie$/);
      if (mm) ids.add(mm[1]);
    }
  } catch (e) { /* ignore */ }
  return ids;
}

/* ============ ④ 版本特征（从新到旧；每个都必须**本地为真**，否则区分不了新旧）============
 * ★ 加特征前先过下面的「本地自检」：本地都不为真的串，在线上也一律为假，
 *   只会把每个目标都判成「早于它」= 假红（本项目踩过两次：PITFALLS 54/59）。
 *   `dlgDl` 就因此被自检拦下过 —— 它只在某些会话产物里，首页没有。 */
const FEATURES = [
  { v: 'v10.24', tag: 'covErr', re: /window\.covErr = covErr/ },
  { v: 'v10.20', tag: 'unpack入口', re: /unpack\.html/ },
  { v: 'v10.19', tag: 'eg-nav', re: /eg-nav/ },
  { v: 'v10.18', tag: 'devlist-lg', re: /d-devlist-lg/ },
];

(async () => {
  const { events, files } = parseLog();
  const appDom = buildMap(events);
  const registered = readRegistered();

  const local = fs.readFileSync(path.join(ROOT, 'public', 'index.html'));
  const md5 = (b) => crypto.createHash('md5').update(b).digest('hex').slice(0, 10);
  const localMd5 = md5(local);
  const localTxt = local.toString('utf8');

  console.log('# 应用清单（appId ↔ 域名 ↔ sandbox ↔ 版本）\n');
  console.log('日志源：`' + LOGDIR.replace(HOME, '~') + '`（' + files.length + ' 个文件）');
  console.log('本地 public/index.html md5=`' + localMd5 + '`\n');

  /* 特征自检：本地都不为真的特征区分不了版本，只会在线上全假（PITFALLS 54/59） */
  const dead = FEATURES.filter((f) => !f.re.test(localTxt));
  if (dead.length) {
    console.log('⚠️ **特征串自检失败**：以下标记在本地首页就不存在，无法用来判版本（应从 FEATURES 移除）：');
    dead.forEach((f) => console.log('  - ' + f.v + ' / ' + f.tag));
    console.log('');
  }
  const LIVE_FEATURES = FEATURES.filter((f) => f.re.test(localTxt));

  console.log('## ① appId → 域名\n');
  console.log('| appId | 预留域名 | 创建(UTC) | 已发布 | sandbox | 本地登记 |');
  console.log('|---|---|---|---|---|---|');
  for (const [id, a] of [...appDom].sort((x, y) => String(x[1].created).localeCompare(String(y[1].created)))) {
    console.log('| `' + id + '` | ' + (a.domain || '—') + ' | ' + (a.created || '—').slice(0, 19) + ' | ' +
      (a.publishes.length ? a.publishes.length + ' 次' : '**从未**') + ' | `' +
      (a.sandbox || '—').slice(0, 12) + '` | ' + (registered.has(id) ? '✅' : '❌ 未登记') + ' |');
  }

  if (NO_NET) return;

  /* ============ ⑤ 域名实测 ============ */
  const get = async (d) => {
    const r = await fetch('https://' + d + '/index.html', { cache: 'no-store', redirect: 'follow' });
    const b = Buffer.concat(await (async () => { const a = []; for await (const c of r.body) a.push(c); return a; })());
    return { status: r.status, buf: b, s: b.toString('utf8') };
  };

  console.log('\n## ② 域名实测\n');
  console.log('| 域名 | HTTP | index.md5 | 特征命中 | 判定 |');
  console.log('|---|---|---|---|---|');
  const rows = [];
  for (const d of [...new Set([...appDom.values()].map((a) => a.domain).filter(Boolean))].sort()) {
    let r;
    try { r = await get(d); } catch (e) { console.log('| ' + d + ' | ERR | — | — | 请求失败 |'); continue; }
    const m = md5(r.buf);
    const hit = LIVE_FEATURES.filter((f) => f.re.test(r.s)).map((f) => f.tag);
    /* 版本区间 = 「最新的命中特征」⇒ 该版或更新 */
    const newest = hit.length ? LIVE_FEATURES.find((f) => f.re.test(r.s)).v : '早于 ' + (LIVE_FEATURES[LIVE_FEATURES.length - 1] || {}).v;
    const isLive = m === localMd5;
    const dead404 = r.status >= 400;
    const verdict = isLive ? '**LIVE**（= 本地）'
      : dead404 ? '⚠️ 空壳（从未发布）'
        : '弃用 · ' + (hit.length ? '≥' + newest : '早于 ' + (LIVE_FEATURES[LIVE_FEATURES.length - 1] || {}).v);
    console.log('| ' + d + ' | ' + r.status + ' | `' + m + '` | ' + (hit.join(' · ') || '无') + ' | ' + verdict + ' |');
    rows.push({ d, m, verdict, isLive });
  }

  /* ============ ⑥ sandbox 直链（不是 app，删不掉）============ */
  console.log('\n## ③ sandbox 直链（**不是 app**，无法在「应用」里删，会随 sandbox 过期）\n');
  console.log('| sandbox | HTTP | index.md5 | 说明 |');
  console.log('|---|---|---|---|');
  const sbs = [...new Set(events.filter((e) => e.sandbox).map((e) => e.sandbox))];
  for (const s of sbs) {
    let st = '—'; let m = '—'; let note = '';
    try {
      const r = await get(s + '.app.workbuddy.host');
      st = String(r.status); m = md5(r.buf);
      note = st === '200' ? (m === localMd5 ? '= 本地（也是 LIVE 那个 sandbox）' : '旧快照，仍可访问')
        : '已过期 / 未绑定';
    } catch (e) { st = 'ERR'; note = e.message.slice(0, 40); }
    console.log('| `' + s + '` | ' + st + ' | `' + m + '` | ' + note + ' |');
  }

  console.log('\n## ④ 日志 WARN：为什么本地登记不全');
  const warns = events.filter((e) => e.kind === 'warn-norecord');
  if (!warns.length) console.log('（无）');
  for (const w of warns) console.log('- ' + w.src + ' | ' + w.at.slice(0, 19) + ' | ' + w.msg.slice(0, 120));
  console.log('  ⇒ `EBUSY` 时发布记录**没落盘** ⇒ `cloudstudio-deploy-history` 少了早期几条，');
  console.log('    这也是「本地登记看不到全部 app」的原因之一。');

  console.log('\n## ⑤ 清理须知');
  console.log('- **只删「弃用」那几行**；`LIVE` 与 sandbox 直链不要动。');
  console.log('- ★ **别用 sites 的 `unpublish`**：它取「同一本地目录的最新一次发布」，');
  console.log('  而所有 app 的 localDir 都是同一个 `game-aggregator` ⇒ **会把 LIVE 一起下掉**。');
  console.log('- 手工入口：「设置—数据管理—应用」。');
})();
