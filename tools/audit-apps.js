#!/usr/bin/env node
/**
 * tools/audit-apps.js —— 应用登记与线上链接「对账」
 *
 * 存在原因（2026-09-18，v10.21 发布后）：
 *   本项目每次「旧 sandbox 过期 → 只能新建 app」都会**多一条同名 app 记录 + 多一个域名**，
 *   而平台**没有删除 app 的接口**（sites 工具只有 deploy / unpublish），只能手工去
 *   「设置—数据管理—应用」里清。于是记录越堆越多，且**旧域名全都返回 200**（内容停在旧版），
 *   极易被误当成正式入口 —— 本项目已因「状态码 200 区分不出新旧」踩过多次。
 *   ⇒ 把「有哪些 app / 每个域名实际是哪一版」做成一条命令，别再靠记忆。
 *
 * 用法：
 *   node tools/audit-apps.js            # 全量：登记 + 联网实测
 *   node tools/audit-apps.js --no-net   # 只列登记，不联网
 *
 * 退出码：0 = LIVE 与本地逐字节一致；1 = LIVE 落后/不可达（收尾时不该出现）
 *
 * ★ 版本推断为什么不能只看 HTML：
 *   v10.21 是**纯数据层**改动（只换了 data/mobilehub.json），`index.html` 的 md5 **完全不变**。
 *   所以必须同时探接口：`/api/mobilehub/stats` 的 total 才能把 v10.20 与 v10.21 分开。
 *
 * ★ 门禁必须「先过本地自检」（2026-09-20 加，见 ③-b 段）：
 *   门禁**过期**时不会报错，只会把**每一个域名**都判成旧版 —— 是假红，且正好污染发布后验收。
 *   实测：门禁写死 `total === 3181`，而当天数据已涨到 3,195 ⇒ LIVE 只差一个 v10.24
 *   却被报成「停在 v10.21 之前」。判据：**一条只能在本地为真的断言，才有资格拿来判线上。**
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const WORKSPACE = path.join(ROOT, '..');
const NO_NET = process.argv.includes('--no-net');

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex').slice(0, 10);

/* ============ ① 应用登记 ============ */
function readApps() {
  const apps = [];

  /* applications.yaml —— 只有 name/locator 两行，用正则读（不引 yaml 依赖） */
  const yml = path.join(WORKSPACE, '.workbuddy', 'applications.yaml');
  try {
    const s = fs.readFileSync(yml, 'utf8');
    for (const m of s.matchAll(/-\s*name:\s*(.+?)\r?\n\s*locator:\s*([\w-]+)/g)) {
      apps.push({ id: m[2], name: m[1].trim(), genie: false, createdAt: null, localDir: '' });
    }
  } catch { /* 没有就空着 */ }

  /* .wbapp_*.genie —— 每个 app 一个标记文件，带 appId / 名称 / localDir */
  let genies = [];
  try { genies = fs.readdirSync(WORKSPACE).filter((f) => /^\.wbapp_[\w-]+\.genie$/.test(f)); } catch { /* ignore */ }
  for (const f of genies) {
    const p = path.join(WORKSPACE, f);
    let txt = ''; let st = null;
    try { txt = fs.readFileSync(p, 'utf8'); st = fs.statSync(p); } catch { continue; }
    const g = (k) => (txt.match(new RegExp('^' + k + ':\\s*(.+)$', 'm')) || [])[1] || '';
    const id = g('appId') || f.replace(/^\./, '').replace(/\.genie$/, '');
    const hit = apps.find((a) => a.id === id);
    const rec = {
      id, name: g('name') || '(未命名)', localDir: g('localDir'),
      genie: true,
      /* 用 genie 的创建时间当「该 app 何时被建立」的证据（applications.yaml 不带时间） */
      createdAt: st ? st.birthtime.toISOString().slice(0, 19).replace('T', ' ') : null,
    };
    if (hit) Object.assign(hit, rec);
    else apps.push(rec);
  }
  return apps.map((a) => ({ ...a, localDir: a.localDir || '' }));
}

/* ============ ② 链接登记（与 report.js 同源口径） ============ */
function readLinks() {
  const s = fs.readFileSync(path.join(ROOT, 'tools', 'report.js'), 'utf8');
  const live = (s.match(/LIVE:\s*'([^']+)'/) || [])[1] || '';
  const dep = [...s.matchAll(/\{\s*url:\s*'([^']+)',\s*why:\s*'([^']+)'/g)]
    .map((m) => ({ url: m[1], why: m[2] }));
  return { live, dep };
}

/* ============ ③ 版本推断（特征 + 接口，两条腿） ============ */
/* 顺序：新 → 旧。**收集全部缺口**，取最旧的那个当「线上停在哪一版之前」——
   只看第一个缺口会把「停在 v10.18」误报成「尚未发布 v10.21」（都对，但后者没用）。 */
const GATES = [
  /* ★ 数字一律用「≥ 当时水平」，**绝不写等号**：
     数据只会涨 —— 写死 `=== 3181` 意味着它**必然**在某天变成永假，
     而永假的门禁表现为「任何域名都缺这一版」= 假红（2026-09-20 实测踩到，详见自检段）。 */
  { since: 'v10.24', name: '卡片版式统一（占位块 + 图片 404 兜底 covErr）', html: /window\.covErr\s*=\s*covErr/ },
  { since: 'v10.21', name: '手游中心数据 ≥ 3181 条（v10.21 尾缀剥离）', api: '/api/mobilehub/stats', test: (r) => r.body && r.body.total >= 3181 },
  { since: 'v10.20', name: '解包匹配接口 /api/spec/dict', api: '/api/spec/dict', test: (r) => r.status === 200 },
  { since: 'v10.19', name: '指南模块导航 eg-nav', html: /eg-nav/ },
  { since: 'v10.18', name: '机型补全接口 /api/device/fill-stats', api: '/api/device/fill-stats', test: (r) => r.status === 200 },
  { since: 'v10.17', name: '设备译名接口 /api/device/market', api: '/api/device/market', test: (r) => r.status === 200 },
];

/* ============ ③-b 门禁自检（本地先跑一遍） ============ */
/* ★ 为什么必须有这一段（2026-09-20 实测踩到）：
   门禁写的是 `total === 3181`，而当天数据已涨到 **3,195** ⇒ 这条门禁**在本地也为假**。
   后果不是「报错」，而是**任何一个域名都被判成「旧版（缺 v10.21）」** ——
   实测当天 LIVE 只差一个 v10.24，却被报成「停在 v10.21 之前」，正好把发布后验收污染反了。
   同一天还有第二个例子：`/3181/` 这个 HTML 特征串在**本地 index.html 里也搜不到**。

   **根本判据**：一条只能在本地为真的断言，才有资格拿来判线上。
   本地不满足的门禁**不参与版本判定**（否则它只会制造假红），单独列成「⚠️ 标记失效」提示去修探针。

   ⚠️ 本地服务没起时**不能**据此判定门禁失效（那样会把版本判定能力整个静默关掉）——
   此时保守按「未失效」处理，并打印告警。 */
const LOCAL_BASE = 'http://127.0.0.1:8123';
let _selfCheck = null;

async function localGet(p) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 8000);
  try {
    const r = await fetch(LOCAL_BASE + p, { signal: c.signal });
    const txt = await r.text();
    let body = null;
    try { body = JSON.parse(txt); } catch { /* 非 JSON 就留 null */ }
    return { status: r.status, text: txt, body };
  } finally { clearTimeout(t); }
}

/* 统一吃 {status,text,body} 三件套 —— 与远端探针同一口径（分流过一次，判据恒假） */
async function gateHas(g, text, get) {
  if (g.html) return g.html.test(text);
  return g.test(await get(g.api));
}

async function selfCheck(localTxt) {
  if (_selfCheck) return _selfCheck;
  let reachable = false;
  try { reachable = (await localGet('/api/health')).status === 200; } catch { reachable = false; }

  const alive = new Map();
  for (const g of GATES) {
    let has = false;
    if (g.html) has = g.html.test(localTxt);
    else if (reachable) { try { has = await gateHas(g, localTxt, localGet); } catch { has = false; } }
    else has = true;                       // 本地服务没起 ⇒ 无法自检，保守按「未失效」
    alive.set(g, has);
  }
  _selfCheck = { reachable, alive };
  return _selfCheck;
}

/* 本地不满足的门禁，跨域名汇总后在末尾单列（不参与版本判定） */
const STALE = new Map();

async function probe(url, localMd5, localTxt) {
  const base = url.replace(/\/$/, '');
  const out = { url, http: null, md5: null, same: false, ver: '?', detail: '', err: null };

  const get = async (p) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 20000);
    try {
      const r = await fetch(base + p, { headers: { 'Cache-Control': 'no-cache' }, signal: c.signal });
      const txt = await r.text();
      let body = null;
      try { body = JSON.parse(txt); } catch { /* 非 JSON 就留 null */ }
      return { status: r.status, text: txt, body };
    } finally { clearTimeout(t); }
  };

  try {
    const r = await get('/index.html?cb=' + Date.now());
    out.http = r.status;
    out.md5 = md5(r.text);
    out.same = out.md5 === localMd5;

    /* ★ 统一传「响应对象」给 test，不要按 JSON/text 分流 ——
       分流过一次：status===200 时把 body 传进去，`(r) => r.status === 200` 就永远为假，
       结果把 LIVE 判成了「缺 v10.20」。 */
    /* ★ 远端缺的门禁必须分两类：**真缺口** vs **本地也缺（探针过期）**。
       只有前者才有资格判版本；后者拿去做判据只会制造假红。 */
    const self = await selfCheck(localTxt);
    const missing = [];
    for (const g of GATES) {
      const remoteHas = await gateHas(g, r.text, get);
      if (remoteHas) continue;
      if (self.alive.get(g)) missing.push(g);
      else STALE.set(g, (STALE.get(g) || 0) + 1);   // 本地也不满足 ⇒ 标记失效，不计入
    }
    const oldest = missing[missing.length - 1];   // GATES 由新到旧 ⇒ 末位 = 最旧的缺口

    if (!missing.length) { out.ver = out.same ? '与本地同版（含数据层）' : '特征全中但字节不同（需人工核对）'; }
    else if (out.same) { out.ver = 'HTML 与本地一致，但**数据层落后**（停在 ' + oldest.since + ' 之前）'; out.detail = '缺：' + oldest.name; }
    else { out.ver = '旧版（停在 ' + oldest.since + ' 之前）'; out.detail = '缺：' + oldest.name; }
  } catch (e) {
    out.err = String(e.message).slice(0, 70);
  }
  return out;
}

/* ============ 主流程 ============ */
(async () => {
  const apps = readApps();
  const { live, dep } = readLinks();
  const localTxt = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const localMd5 = md5(localTxt);

  console.log('# 应用 / 链接 对账（tools/audit-apps.js）\n');
  console.log('本地 public/index.html  md5=`' + localMd5 + '`');
  console.log('正式入口 LIVE          `' + live + '`\n');

  console.log('## ① 应用登记（applications.yaml ∪ .wbapp_*.genie）\n');
  console.log('| # | appId | 名称 | 建立时间 | 本地目录 |');
  console.log('|---|---|---|---|---|');
  apps.forEach((a, i) => {
    console.log('| ' + (i + 1) + ' | `' + a.id + '` | ' + a.name + ' | ' + (a.createdAt || '—') + ' | ' +
      (a.localDir ? '`…\\' + path.basename(a.localDir) + '`' : '—') + ' |');
  });
  console.log('\n共 **' + apps.length + '** 条登记。⚠️ 平台无删除接口，清理要手工去「设置—数据管理—应用」。\n');

  console.log('## ② 链接实测\n');
  if (NO_NET) {
    console.log('（--no-net，跳过联网探测）\n');
  } else {
    console.log('| 域名 | HTTP | index.md5 | 与本地 | 判定 | 依据 |');
    console.log('|---|---|---|---|---|---|');
    const all = [live, ...dep.map((d) => d.url)];
    const extra = 'https://36aa37e911e6447eb86eb187240daff2.app.workbuddy.host/';
    if (!all.includes(extra)) all.push(extra);
    let liveOk = false;
    for (const u of all) {
      const r = await probe(u, localMd5, localTxt);
      const host = u.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const tag = u === live ? '**LIVE**' : (dep.find((d) => d.url === u) ? '弃用' : '未登记');
      if (u === live && r.same) liveOk = true;
      console.log('| ' + host + ' | ' + (r.http ?? '—') + ' | `' + (r.md5 || '—') + '` | ' +
        (r.same ? '✅ 逐字节一致' : r.http ? '≠' : '—') + ' | ' + tag + ' · ' + r.ver + ' | ' +
        (r.err || r.detail || '—') + ' |');
    }
    console.log('');
    /* ★ 把「探针过期」说出来 —— 不说的话，下一个人会拿着失效门禁去报「线上缺 X」 */
    if (STALE.size) {
      console.log('⚠️ **标记失效**（本地自检同样不通过 ⇒ 这些门禁**不参与**上面的版本判定）：');
      for (const [g, n] of STALE) console.log('- `' + g.since + '` · ' + g.name + '（' + n + ' 个域名都缺，**本地也一样缺**）');
      console.log('  ⇒ 它们区分不了新旧版本，别再拿它们报「线上缺 X」。修法见本文件 ③-b 段。\n');
    }
    if (!_selfCheck || !_selfCheck.reachable) {
      console.log('⚠️ 本地服务（' + LOCAL_BASE + '）未就绪 ⇒ 接口型门禁**跳过了自检**，上面的判定可能混入假红。');
      console.log('   ⇒ 先起服务（`node server.js`）再重跑本脚本。\n');
    }
    console.log(liveOk ? '✅ LIVE 与本地逐字节一致。' : '❌ LIVE 不是本地这一版 —— 别急着说「已发布」。');
  }

  console.log('\n## ③ 清理须知\n');
  console.log('- **别用 sites 的 `unpublish` 去清旧链接**：它取的是「同一本地目录的最新一次发布」,');
  console.log('  而所有 app 的 localDir 全是同一个 `game-aggregator` ⇒ **会把 LIVE 一起下掉**。');
  console.log('- 旧 app 只能在「设置—数据管理—应用」里手工删；删前先确认它绑的不是 LIVE 那个域名。');
  console.log('- 判断「删哪个」用上表：`未登记` / `弃用` 且版本旧的那些才可清。');

  if (!NO_NET) {
    const r = await probe(live, localMd5, localTxt);
    process.exit(r.same ? 0 : 1);
  }
})();
