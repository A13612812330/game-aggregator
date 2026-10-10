#!/usr/bin/env node
/**
 * 标准状态汇报（用户 2026-09-18 要求，每次收尾固定输出五项）：
 *   ① 做了什么  ② 分享链接（线上）  ③ 项目文件夹  ④ 是否更新到 GitHub  ⑤ GitHub 是否有更新日志
 *
 * 设计原则：**全部字段都实测**，不接受「我记得」。线上链接一律用 md5 与本地比对判定版本，
 * 因为 HTTP 200 区分不出新旧（v10.17 那次三个域名全 200，两个旧一个新）。
 *
 * 用法：
 *   node tools/report.js              # 完整（含联网探测）
 *   node tools/report.js --no-net     # 跳过联网（离线/快速自查）
 *   node tools/report.js --md         # 只输出 markdown 块（便于整段粘贴）
 *
 * ⚠️ 每次发布后必须更新下面 LINKS（新链接进 LIVE，旧链接降级到 DEPRECATED）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const NO_NET = argv.includes('--no-net');
const MD_ONLY = argv.includes('--md');

/* ============ 链接登记（发布后改这里） ============ */
/* ★ 2026-09-18（v10.22）：LIVE 从 v3 切到 36aa37e9，原因与判据都留在这里 ——
   ① v3 无法覆盖：发布工具**硬拒绝**，原文「应用预留域名 gamehub-agg-v3.app.workbuddy.host
      未绑定到本次发布环境，为避免返回仍指向旧内容的链接，本次发布已停止」。
      这与 v10.17 / v10.18 / v10.21 三次同因（旧 sandbox 过期 ⇒ 只能新建 app，链接会变）。
   ② 走不了「新建 app」：用户本轮明确选择**先用已能访问的旧链接**，不新建。
   ③ 于是把 LIVE 切到 36aa37e9 —— 它是实测**当前确实在跑 v10.22** 的那个域名：
      三页（/ · /unpack.html · /emulator.html）与本地**逐字节一致**，
      且 v10.22 独有的 /api/jiditopics/stats（17,220 条）与 /api/download 都通。
      ✗ 判据不是 HTTP 200 —— v2 / join / v3 三个域名**全部返回 200 却都是旧版**。
   ④ ★ 已用「放临时文件看远端是否跟随」的探针验过：**它不跟随本地改动**（远端 404）。
      所以它是**一份快照**，不是自动同步环境 —— 下次发布仍必须走发布流程，
      别以为「改完本地就自动上线」（这正是本项目踩过的那个坑）。
   ⑤ ⚠️ 它不在 `.workbuddy/applications.yaml` 的正式登记里。**v10.23 若要发布，
      优先选「新建 app」拿一个已登记的新链接**，别再指望这个域名能跟着更新。 */
const LINKS = {
  LIVE: 'https://gamehub-agg-v4.app.workbuddy.host/',
  DEPRECATED: [
    { url: 'https://36aa37e911e6447eb86eb187240daff2.app.workbuddy.host/', why: '停在 v10.22（★ 未登记在 applications.yaml ⇒ 发布工具按 appId 找应用，根本无法更新它；2026-09-20 发 v10.23 时改为新建 app）' },
    { url: 'https://gamehub-agg-v3.app.workbuddy.host/', why: '停在 v10.21（发布环境已失效：工具拒绝覆盖，报「预留域名未绑定到本次发布环境」）' },
    { url: 'https://gamehub-agg-v2.app.workbuddy.host/', why: '停在 v10.18（实测无 eg-nav；域名无法重绑到新发布环境）' },
    { url: 'https://gamehub-agg-join.app.workbuddy.host/', why: '停在 v10.17（实测 /api/device/fill-stats 404）' },
  ],
};
const GITHUB = {
  repo: 'https://github.com/A13612812330/game-aggregator',
  owner: 'A13612812330',
  name: 'game-aggregator',
  branch: 'main',
  /* ★ v10.50：可见性**只作静态兜底**，正常路径一律现测（见 visibilityViaApi）。
     原先这里是写死的 `'PRIVATE'` —— 2026-10-10 实测 REST 返回
     `visibility=public / private=false`，常量早已过期，而汇报里那行
     「仓库（PRIVATE）」看上去完全正常 ⇒ **静默报假**。
     与用户「全部字段实测、不接受『我记得』」的口径直接冲突，因此改为现测。 */
  visibilityFallback: 'PUBLIC',
};
const GH_CONFIG_DIR = path.join(ROOT, '..', '.ghconfig');

/* ============ 小工具 ============ */
/* 取前 10 位即可区分；与文档/记忆里已记录的口径保持一致 */
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex').slice(0, 10);
const sh = (cmd, env) => {
  try {
    return { ok: true, out: execSync(cmd, { encoding: 'utf8', cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: env || process.env }).trim() };
  } catch (e) {
    return { ok: false, out: String((e.stdout || '') + (e.stderr || '')).trim() };
  }
};
const sleep = (ms) => { const t = Date.now(); while (Date.now() - t < ms) { /* busy wait，避免 async 传染 */ } };

/* ============ ① 做了什么 ============ */
function commits() {
  /* ⚠️ 必须给 --pretty 整体加引号：否则 `%h|%ad|%s` 里的竖线会被 shell 当成管道，
     git log 直接失败（返「读取失败」而不是报错，很容易漏看）。 */
  const r = sh('git log -4 --date=format:%m-%d --pretty="format:%h|%ad|%s"');
  if (!r.ok || !r.out) return { ok: false, rows: [] };
  return {
    ok: true,
    rows: r.out.split(/\r?\n/).filter(Boolean).map((l) => {
      const [h, d, s] = l.split('|');
      return { h, d, s };
    }),
  };
}
function dirty() {
  const r = sh('git status --porcelain');
  if (!r.ok) return null;
  const n = r.out ? r.out.split(/\r?\n/).filter(Boolean).length : 0;
  return n;
}

/* ============ ② 分享链接（线上）============ */
/**
 * 版本指纹：线上与本地 md5 不同时，**不能只说「不同版本」**——
 * 必须说清是「线上旧（还没发布）」还是「线上新（本地落后）」，否则汇报等于没结论。
 *
 * ⚠️ 旧实现在这里写的是 `/.chip\.ol/.test(txt) ? '新于本地？' : '旧版'` —— 实测会**报反**：
 *    v10.20 本地新增顶栏入口后线上仍是 v10.19，而两边都有 `.chip.ol`，
 *    于是判成「新于本地？」，把「还没发布」说成了「线上更新」。
 *    ⇒ 改为**特征指纹逐条比对**：本地有、线上没有 ⇒ 线上旧；反之 ⇒ 线上新。
 *    新增版本时往 FEATURES 顶部加一条即可（`since` 只用于文案，不参与判定）。
 */
const FEATURES = [
  { re: /id="navUnpack"/, name: '顶栏「📦 解包匹配」入口', since: 'v10.20' },
  { re: /eg-nav/, name: '指南模块导航', since: 'v10.19' },
  { re: /id="navEmu"/, name: '顶栏「手机专区」入口', since: 'v10.18' },
];

function versionLabel(remoteTxt, localTxt, same) {
  if (same) return { ver: '与本地同版', detail: '' };
  const missing = FEATURES.filter((f) => f.re.test(localTxt) && !f.re.test(remoteTxt));
  if (missing.length) {
    const f = missing[missing.length - 1];   // 取最早缺的那个 = 线上实际停在哪一版
    return { ver: '旧于本地（线上尚未发布 ' + f.since + '）', detail: '缺：' + f.name };
  }
  const extra = FEATURES.filter((f) => !f.re.test(localTxt) && f.re.test(remoteTxt));
  if (extra.length) return { ver: '新于本地（本地落后于线上）', detail: '线上多出：' + extra[0].name };
  return { ver: '同代但内容有差异（需人工核对）', detail: '特征指纹全中，但字节不同' };
}

/* ===== ②-b 服务端 + data 层的口径指纹（v10.38 补）=====
 * ★★ 为什么必须有这一节 ★★
 *   上面那套 FEATURES 只读 `public/index.html`，即**只证明前端同版**。
 *   而 v10.33~v10.38 六轮的改动**全在 `data/**` 与 `tools/**`**，index.html 一个字节没动。
 *   2026-09-23 实测（就是加这一节的原因）：
 *     LIVE 的 index.html md5 = 本地 md5（9ae5854778）⇒ 旧判据判「✅ 已是最新」
 *     而 LIVE 的 `/api/spec/dict` 返回 `archRule: undefined`，本地有
 *     ⇒ 线上实际仍停在 v10.35 之前。**旧判据在本轮是假绿**，而它长得跟真绿一模一样。
 *   ⇒ 判「线上是不是最新」必须**前端 + 服务端两条判据都过**，缺一条就降级为 ⚠️。
 *
 * 用法：新增服务端口径时往 SERVER_FEATURES 顶部加一条（`srcRe` 对着本地源码，
 *       `apiTest` 对着线上接口返回的 JSON）。两边都不对 ⇒ 报「判据失效」，绝不静默放行。
 */
const SERVER_FEATURES = [
  {
    key: 'archRule',
    api: '/api/spec/dict',
    name: '服务端口径指纹 dictInfo().archRule',
    since: 'v10.35',
    srcRe: /archRule/,                                  // 本地源码里应当有
    apiTest: (j) => !!(j && j.archRule && typeof j.archRule === 'object'),  // 线上接口应当返回它
  },
];

/* ★ 必须先剥注释再匹配 srcRe：`archRule` 在 spec-match.js 的注释里也出现过（第 173 行那类
   「这两个 state 是唯一来源…」的说明），直接 grep 原文会被注释撑成假绿 —— 与 v10.38
   在 test-daily-sync.js 里踩到的 `ok(/bySource/)` 是同一个坑。 */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const SPEC_SRC = (() => {
  try { return stripComments(fs.readFileSync(path.join(ROOT, 'data/spec-match.js'), 'utf8')); } catch (e) { return ''; }
})();

/**
 * 判定线上服务端与本地是否同版。纯函数（输入 = 探针结果 + 本地源码），可单测。
 * @returns {{ver:string, missing:Array, ok:boolean}}
 */
function serverVersionLabel(probe, localSrc) {
  /* ① 先查判据自身是否还有效：本地源码里找不到指纹 ⇒ 判据失效，别拿它下结论 */
  const lost = SERVER_FEATURES.filter((f) => !f.srcRe.test(localSrc || ''));
  if (lost.length) {
    return { ver: '本地源码里找不到 `' + lost[0].key + '` ⇒ 判据失效（先去修 report.js）', missing: [], ok: false };
  }
  /* ② 接口没拿到 ⇒ 同样不下结论 */
  if (!probe || !probe.ok) {
    return { ver: '服务端口径取不到（' + ((probe && (probe.err || 'HTTP ' + probe.http)) || '未探测') + '）', missing: [], ok: false };
  }
  /* ③ 本地有、线上没有 ⇒ 线上服务端旧 */
  const missing = SERVER_FEATURES.filter((f) => !probe.has[f.key]);
  if (missing.length) {
    return { ver: '服务端旧于本地（线上尚未发布 ' + missing[missing.length - 1].since + '）', missing, ok: false };
  }
  return { ver: '与本地一致', missing: [], ok: true };
}

/** 服务端指纹那一行的正文（抽成纯函数 ⇒ 可行为级测：给了 ✗ 就不许渲染成 ✓） */
function serverFpRow(probe) {
  return SERVER_FEATURES.map((f) => f.key + ((probe && probe.has && probe.has[f.key]) ? ' ✓' : ' ✗（本地有）')).join(' · ');
}

/** 拉线上服务端指纹接口；只读，不写任何东西 */
async function probeServer(base) {
  const out = { ok: false, http: null, has: {}, err: null, json: null, api: SERVER_FEATURES[0].api };
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 20000);
    const r = await fetch(base + out.api + '?cb=' + Date.now(), {
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      signal: c.signal,
    });
    const txt = await r.text();
    clearTimeout(t);
    out.http = r.status;
    let j = null;
    try { j = JSON.parse(txt); } catch (e) { j = null; }
    out.json = j;
    out.ok = r.ok && !!j;
    for (const f of SERVER_FEATURES) out.has[f.key] = !!f.apiTest(j);
  } catch (e) {
    out.err = e.message.slice(0, 70);
  }
  return out;
}

async function probeLink(url, localMd5, localTxt) {
  const base = url.replace(/\/$/, '');
  const out = { url, http: null, md5: null, same: false, ver: '?', detail: '', err: null };
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 20000);
    const r = await fetch(base + '/index.html?cb=' + Date.now(), {
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      signal: c.signal,
    });
    const txt = await r.text();
    clearTimeout(t);
    out.http = r.status;
    out.len = txt.length;
    out.md5 = md5(txt);
    out.same = out.md5 === localMd5;
    const vl = versionLabel(txt, localTxt, out.same);
    out.ver = vl.ver;
    out.detail = vl.detail;
  } catch (e) {
    out.err = e.message.slice(0, 70);
  }
  return out;
}

/* ============ ②-b 运行期缓存对照（★ 只提示，不参与判定）============ */
/**
 * 为什么要这一节：现有两条判据（前端 `index.html` md5 + 服务端 `dictInfo().archRule`）
 *   **只看得出「代码是哪一版」，看不出「线上这份数据还活着吗」**。
 *   v10.41 那个 bug 就是这么漏过去的：线上沙箱抓不到 raw.githubusercontent.com，
 *   `data/bhparams.js` 抓到 0 条却仍写盘 ⇒ `/api/bh/params` 的好缓存被打空、7 天 TTL 重计时，
 *   详情页机型清单只剩上游摘要的 6 台 —— 而**前端 md5 与服务端指纹全程正常**，
 *   两台机器「看起来同版」，实际用户看到的东西不一样。
 *   ⇒ 补一条**运行期取样对照**：拿同一个 key / 同一款游戏，本地与线上各打一次，比条数。
 *
 * ★ 它**只提示、不判定**：这两项是运行期抓取/缓存的产物，会随沙箱出网能力波动，
 *   把它接进判定会让汇报本身变成新的漂移源。所以只在两处不一致时给一行 ⚠️ 供人看。
 */
const RUNTIME_PROBES = [
  {
    key: 'bhparams.items',
    path: '/api/bh/params?k=ULTIMATE_MARVEL_VS__CAPCOM_3&limit=12',
    pick: (j) => (j.items || []).length,
    name: '`/api/bh/params` 该 key 的机型配置条数',
  },
  {
    key: 'mobilehub.devices',
    path: '/api/mobilehub/match?t=' + encodeURIComponent('终极漫画英雄vs卡普空3'),
    pick: (j) => ((j.hit && j.hit.devices) || []).length,
    name: '`/api/mobilehub/match` 该游戏的机型台数',
  },
];

/** 取一个运行期指标；失败不抛，只记 err（对照节不该让整份汇报挂掉） */
async function probeRuntime(base, p) {
  const out = { ok: false, http: null, v: null, err: null };
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 20000);
    const r = await fetch(base + p.path + '&cb=' + Date.now(), {
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      signal: c.signal,
    });
    const txt = await r.text();
    clearTimeout(t);
    out.http = r.status;
    let j = null;
    try { j = JSON.parse(txt); } catch (e) { j = null; }
    if (r.ok && j) { out.ok = true; out.v = p.pick(j); } else out.err = 'HTTP ' + r.status;
  } catch (e) { out.err = e.message.slice(0, 60); }
  return out;
}

/**
 * 对照文案（纯函数 ⇒ 可行为级测）。三种输入各返回不同结论，
 * 且**取不到任一侧时不下结论** —— 不允许把「没采到」说成「一致」。
 */
function runtimeCacheRow(local, live) {
  if (!local || !local.ok) return '取不到本地值（' + ((local && local.err) || '未探测') + '）⇒ 不比较';
  if (!live || !live.ok) return '取不到线上值（' + ((live && live.err) || '未探测') + '）⇒ 不比较';
  if (local.v === live.v) return '一致（' + local.v + '）';
  if (live.v < local.v) return '⚠️ 线上 ' + live.v + ' < 本地 ' + local.v + ' ⇒ 疑似线上运行期抓取/缓存退化（不参与判定）';
  return '⚠️ 线上 ' + live.v + ' > 本地 ' + local.v + ' ⇒ 线上比本地多（本地可能需重跑抓取；不参与判定）';
}

/* ============ ④ GitHub ============ */
/**
 * 路径 2：走 api.github.com 读远端分支头。
 *
 * 为什么需要它：`git ls-remote` 在本机**常年失败**，于是改走 REST 读 ref，
 *   结果与 ls-remote 等价（同一个 sha）。
 *
 * ★ 2026-09-25 实测**更正了原先的归因**（原文写「本机网络对 github.com 完全阻断」——不准确）：
 *   · `git ls-remote` 报 `CONNECT tunnel failed, response 502` 的**真实原因**是：
 *     沙箱设了 `HTTP_PROXY/HTTPS_PROXY=http://127.0.0.1:62879`，**git 会遵守它**，
 *     而该代理对 github.com 这一跳返回 502；
 *   · 而 **Node 的 `https` 默认不读这些环境变量** ⇒ 直连 github.com 实测 **HTTP 200**
 *     （api.github.com 未授权时 403，带 Bearer 则 200）。
 *   ⇒ 所以「ls-remote 失败」**不能**反推「网络不通」，更不能反推「缺凭据」——
 *     它只说明**那条代理不通**。判远端同步一律以 REST/sha 比对为准。
 */
async function remoteViaApi(env) {
  const tk = sh('gh auth token', env);
  if (!tk.ok || !tk.out) return { ok: false, err: '取 token 失败：' + tk.out.slice(0, 60) };
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 20000);
  try {
    const r = await fetch(`https://api.github.com/repos/${GITHUB.owner}/${GITHUB.name}/git/ref/heads/${GITHUB.branch}`, {
      headers: { Authorization: 'Bearer ' + tk.out, Accept: 'application/vnd.github+json', 'User-Agent': 'gamehub-report' },
      signal: c.signal,
    });
    clearTimeout(t);
    const j = await r.json();
    if (r.status !== 200) return { ok: false, err: `api ${r.status} ${j.message || ''}`.slice(0, 70) };
    return { ok: true, sha: j.object.sha };
  } catch (e) {
    clearTimeout(t);
    return { ok: false, err: e.message.slice(0, 70) };
  }
}

/**
 * 路径 3：走 api.github.com 读**仓库可见性**（public / private / internal）。
 *
 * 为什么需要它：可见性曾是**手写常量**（`'PRIVATE'`），而仓库实际已转 public。
 *   汇报里那行「仓库 …（PRIVATE，分支 main）」看不出任何异常，属于**静默报假**，
 *   比报错更危险 ⇒ 改成现测，只有 REST 不可用时才退回常量，并在输出里显式标「静态兜底」。
 * 与 remoteViaApi 同一套取 token + 直连方式（Node 的 fetch 不读 HTTPS_PROXY）。
 */
async function visibilityViaApi(env) {
  const tk = sh('gh auth token', env);
  if (!tk.ok || !tk.out) return { ok: false, err: '取 token 失败' };
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 20000);
  try {
    const r = await fetch(`https://api.github.com/repos/${GITHUB.owner}/${GITHUB.name}`, {
      headers: { Authorization: 'Bearer ' + tk.out, Accept: 'application/vnd.github+json', 'User-Agent': 'gamehub-report' },
      signal: c.signal,
    });
    clearTimeout(t);
    const j = await r.json();
    if (r.status !== 200) return { ok: false, err: `api ${r.status}` };
    /* `visibility` 字段（public/private/internal）是权威值；
       `private` 布尔兜一道，两者不一致时以 visibility 为准。 */
    const v = (j.visibility || (j.private ? 'private' : 'public')).toUpperCase();
    return { ok: true, visibility: v };
  } catch (e) {
    clearTimeout(t);
    return { ok: false, err: e.message.slice(0, 60) };
  }
}

async function github(localHead) {
  const env = Object.assign({}, process.env, { GH_CONFIG_DIR });
  /* ⚠️ 实测坑（2026-09-18）：
     ① 绝不能设 `GIT_TERMINAL_PROMPT=0` —— 本机 git 走代理，设了它取不到代理凭据，
        报 `CONNECT tunnel failed`，5 次全败；不设则默认参数稳定成功。
     ② 偶发 `OpenSSL SSL_read: unexpected eof` 是网络抖动，重试即可，
        不能据此判定「没推上去」。
     ③ 若 github.com 整段不可达（见 remoteViaApi 注释），自动退到 REST API，
        并在结论里标明走的哪条路径 —— 不能因为「探测方式变了」就假装没查到。 */
  let remote = null, err = null, via = null;
  for (let i = 1; i <= 4; i++) {
    const r = sh('git ls-remote origin -h refs/heads/' + GITHUB.branch, env);
    if (r.ok && /^[0-9a-f]{7,}/.test(r.out)) { remote = r.out.split(/\s+/)[0]; via = 'ls-remote'; break; }
    err = r.out.split(/\r?\n/).filter(Boolean)[0].slice(0, 80);
    sleep(i * 700);
  }
  let apiErr = null;
  if (!remote) {
    const a = await remoteViaApi(env);
    if (a.ok) { remote = a.sha; via = 'api'; } else apiErr = a.err;
  }
  /* 可见性：现测优先，失败才退回常量（并让 ④ 标明「静态兜底」） */
  const vis = await visibilityViaApi(env).catch((e) => ({ ok: false, err: String(e.message).slice(0, 60) }));
  return {
    remote,
    remoteShort: remote ? remote.slice(0, 7) : null,
    head: localHead,
    synced: !!remote && remote.slice(0, 12) === localHead.slice(0, 12),
    via,
    visibility: vis.ok ? vis.visibility : GITHUB.visibilityFallback,
    visLive: !!vis.ok,
    visErr: vis.ok ? null : vis.err,
    err: remote ? null : (err || apiErr),
    /* 两条路径都失败时才叫「网络问题」；只要有一条通，就必须给出确定结论 */
    bothFailed: !remote,
    apiErr,
  };
}

/* ============ ⑤ 更新日志 ============ */
function changelog() {
  const read = (f) => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { return ''; } };
  const readme = read('README.md');
  /* ★ v10.40：版本日志已从根目录迁到 docs/versions/（去掉 CODEX-DONE- 前缀）。
     这里**必须跟着改**，否则本函数会静默少统计到 0 份（目录还在、只是找错了地方）。 */
  const LOG_DIR = 'docs/versions';
  /* ★ v10.42：索引真源换成 docs/versions/README.md ——
     `CODEX-INDEX.md` 已移除（它的 42 个版本块与 README 的 34 个是同一批摘要的两次书写）。
     若这里还去读 CODEX-INDEX.md，读不到的会是空串，`mv` 退化成 '?'、`indexHas` 恒 false ——
     **不报错，只是汇报里那两行悄悄变成「缺 v?」**。 */
  const INDEX_FILE = LOG_DIR + '/README.md';
  const index = read(INDEX_FILE);
  const doneFiles = fs.readdirSync(path.join(ROOT, LOG_DIR)).filter((f) => /^v10\.\d+\.md$/.test(f)).sort((a, b) => {
    const n = (s) => Number((s.match(/v10\.(\d+)/) || [])[1] || 0);
    return n(a) - n(b);
  });
  /* 最新版本号 = 版本日志里的最大号（每版都必须留一份 ⇒ 它才是最可靠的版本真源） */
  const nums = doneFiles.map((f) => Number((f.match(/v10\.(\d+)/) || [])[1] || 0)).sort((a, b) => b - a);
  const mv = nums[0] ? '10.' + nums[0] : '?';
  /* 索引表里该版有没有行（形如 `| [v10.42](v10.42.md) |`） */
  const idxHasRow = (v) => new RegExp('\\[v' + String(v).replace('.', '\\.') + '\\]\\(v' + String(v).replace('.', '\\.') + '\\.md\\)').test(index);
  return {
    readmeHas: readme.includes('v' + mv),
    /* README 里最新那块的标题：v10.42 起收敛为「最近 5 版」，块降为 `###` ⇒ 两档都要容错 */
    readmeSection: (readme.match(/^#{2,3}\s*★?\s*v(10\.\d+)[^\n]*/m) || [])[0] || '',
    indexHas: idxHasRow(mv),
    indexHead: (index.match(/^\|\s*\[v[\d.]+\]\(v[\d.]+\.md\)[^\n]*/m) || [])[0] || '',
    latest: mv,
    indexFile: INDEX_FILE,
    doneCount: doneFiles.length,
    doneLatest: doneFiles.slice(-3),
    /* ★ 覆盖清单**不再手写**：曾写死 `['10.10'…'10.20']`，v10.21 时就漏更新了
       （汇报里少一行，看不出来）。现在自动从 10.10 连续到「版本日志最大版」。
       v10.42 起两列改为「有日志文件 / 在索引表里有行」——比原先的「README 里提没提」更有意义
       （收敛后 README 本就不再逐版列，用 README 当判据会整列变 ✘ 变成噪声）。 */
    coverage: (() => {
      const top = Math.max(10, ...nums);
      const out = [];
      for (let v = 10; v <= top; v++) out.push('10.' + v);
      return out.map((v) => ({ v, log: doneFiles.includes('v' + v + '.md'), idx: idxHasRow(v) }));
    })(),
  };
}

/* ============ 主流程 ============ */
/* ★ v10.38 补：改成命名函数 + `require.main` 守卫 + `module.exports` ——
   否则判据（serverVersionLabel 这类纯函数）只能靠「正文里出现过某字符串」来守，
   正是 v10.38 刚踩过的坑：断言只查符号出现过，被别处同名字符串撑成假绿。
   注意：**require 本文件不许有副作用**（否则套件一 require 就真跑一遍联网汇报）。 */
async function main() {
  const L = [];
  const p = (s) => L.push(s);

  const idxLocal = (() => { try { return fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8'); } catch (e) { return ''; } })();
  const localMd5 = md5(idxLocal);

  /* ① */
  const cm = commits();
  const dirtyN = dirty();
  p('# 状态汇报 · GameHub 游戏聚合站');
  p('');
  p('## ① 做了什么');
  p('');
  if (cm.ok) cm.rows.forEach((r) => p('- `' + r.h + '` ' + r.d + ' ' + r.s));
  else p('- (git log 读取失败)');
  p('- 工作区：' + (dirtyN === null ? '未知' : dirtyN === 0 ? '干净（无未提交改动）' : dirtyN + ' 项未提交'));

  /* ③ */
  p('');
  p('## ③ 项目文件夹');
  p('');
  p('- `' + ROOT.replace(/\//g, '\\') + '`');
  /* 用字节数，不用 String.length（UTF-16 码元会低估中文页面的体积） */
  p('- public/index.html ' + (Buffer.byteLength(idxLocal, 'utf8') / 1024).toFixed(1) + 'KB · md5 ' + localMd5);

  /* ② */
  p('');
  p('## ② 分享链接（线上）');
  p('');
  p('**' + LINKS.LIVE + '**');
  p('');
  if (NO_NET) {
    p('（--no-net，跳过联网探测）');
  } else {
    const live = await probeLink(LINKS.LIVE, localMd5, idxLocal);
    /* ★ v10.38 补：前端同版 ≠ 已是最新。必须再验服务端/data 层的口径指纹。 */
    const srv = await probeServer(LINKS.LIVE.replace(/\/$/, ''));
    const sv = serverVersionLabel(srv, SPEC_SRC);
    let verdict;
    if (live.err) verdict = '⚠️ 前端探测失败：' + live.err;
    else if (!live.same) verdict = '⚠️ ' + live.ver + (live.detail ? ' · ' + live.detail : '');
    else if (sv.ok) verdict = '✅ 前端 md5 与服务端口径指纹均与本地一致 = 已是最新';
    else verdict = '⚠️ 前端同版，但 ' + sv.ver + ' ⇒ **不能判为已是最新**';
    p('| 项 | 实测 |');
    p('|---|---|');
    p('| HTTP | ' + (live.http || live.err) + ' |');
    p('| index.html md5 | ' + (live.md5 || '—') + '（本地 ' + localMd5 + '） |');
    p('| 服务端 ' + srv.api + ' | ' +
      (srv.err ? srv.err : 'HTTP ' + srv.http + ' · ' + serverFpRow(srv)) + ' |');
    p('| 判定 | ' + verdict + ' |');
    for (const d of LINKS.DEPRECATED) {
      const x = await probeLink(d.url, localMd5, idxLocal);
      p('| 弃用：' + d.url.replace('https://', '').replace(/\/$/, '') + ' | ' + (x.err ? x.err : 'HTTP ' + x.http + ' · ' + (x.same ? '⚠️ 内容竟与最新一致，但仍不用' : '旧版（符合预期）')) + ' |');
    }
  }

  /* ②-b */
  p('');
  p('### ②-b 运行期缓存对照（★ 只提示，不参与判定）');
  p('');
  if (NO_NET) p('（--no-net，跳过）');
  else {
    const LOCAL_BASE = 'http://127.0.0.1:8123';
    const LIVE_BASE = LINKS.LIVE.replace(/\/$/, '');
    p('| 指标 | 本地 8123 | 线上 | 对照 |');
    p('|---|---|---|---|');
    for (const rp of RUNTIME_PROBES) {
      const [lo, lv] = await Promise.all([probeRuntime(LOCAL_BASE, rp), probeRuntime(LIVE_BASE, rp)]);
      p('| ' + rp.name + ' | ' + (lo.ok ? lo.v : '取不到') + ' | ' + (lv.ok ? lv.v : '取不到') +
        ' | ' + runtimeCacheRow(lo, lv) + ' |');
    }
    p('');
    p('> **为什么只提示**：这两项是**线上运行期抓取/缓存的产物**，会随沙箱出网能力波动。');
    p('> v10.41 的「机型恒 6 台」正是这样漏过「前端 md5 + `dictInfo().archRule`」两条判据的 ——');
    p('> 前端与服务端指纹**全程正常**，但用户看到的数据不一样。');
    p('> **一致 ≠ 数据全对；不一致也不必然是发布问题** ⇒ 只列出来给人看，不接进判定。');
  }

  /* ④ */
  const head = sh('git rev-parse HEAD').out || '';
  const gh = NO_NET ? null : await github(head);
  p('');
  p('## ④ 是否更新到 GitHub');
  p('');
  if (NO_NET) p('（--no-net，跳过）');
  else {
    p('| 项 | 值 |');
    p('|---|---|');
    p('| 仓库 | ' + GITHUB.repo + '（' + gh.visibility +
      (gh.visLive ? '，**现测**' : '，⚠️ 静态兜底（REST 不可用：' + (gh.visErr || '?') + '）') +
      '，分支 ' + GITHUB.branch + '） |');
    p('| 本地 HEAD | `' + head.slice(0, 7) + '` |');
    p('| 远端 ' + GITHUB.branch + ' | ' + (gh.remoteShort ? '`' + gh.remoteShort + '`' : '❌ 探测失败：' + gh.err) + ' |');
    p('| 探测路径 | ' + (gh.via === 'api' ? '🔄 REST API（ls-remote 失败，改走 api.github.com）' : gh.via === 'ls-remote' ? '`git ls-remote`' : '❌ 两条路径均失败') + ' |');
    p('| 结论 | ' + (gh.synced ? '✅ 已同步（远端 = 本地）' : gh.remote ? '⚠️ 未推送（本地领先）' : gh.bothFailed ? '❌ 无法确认（两条探测路径均失败）' : '❌ 无法确认') + ' |');
    if (gh.via === 'api') p('| 备注 | `git ls-remote` 失败（`CONNECT tunnel failed, response 502`：' +
      '沙箱 `HTTPS_PROXY=127.0.0.1:62879` 对 github.com 不通；**直连 github.com 实测 HTTP 200**）' +
      '⇒ 改走 api.github.com，结论仍为**实测**，非推测。 |');
  }

  /* ⑤ */
  const cl = changelog();
  p('');
  p('## ⑤ GitHub 更新日志');
  p('');
  p('| 位置 | 状态 |');
  p('|---|---|');
  p('| `README.md` | ' + (cl.readmeHas ? '✅ 已含 v' + cl.latest : '❌ 缺 v' + cl.latest) + ' · ' + cl.readmeSection.slice(0, 70) + ' |');
  p('| `' + cl.indexFile + '`（唯一版本索引） | ' + (cl.indexHas ? '✅ 索引表含 v' + cl.latest : '❌ 索引表缺 v' + cl.latest) + ' · ' + cl.indexHead.slice(0, 70) + ' |');
  p('| `docs/versions/v*.md` | ' + cl.doneCount + ' 份，最近：' + cl.doneLatest.join(' / ') + ' |');
  p('| 逐版覆盖 | ' + cl.coverage.map((c) => 'v' + c.v + (c.log && c.idx ? '✔' : '✘')).join(' ') + ' |');

  const text = L.join('\n');
  if (MD_ONLY) console.log(text);
  else { console.log('\n' + text + '\n'); }
}

if (require.main === module) main();

module.exports = { FEATURES, SERVER_FEATURES, RUNTIME_PROBES, md5, stripComments, versionLabel, serverVersionLabel, serverFpRow, runtimeCacheRow, probeServer, main };
