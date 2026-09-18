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
const LINKS = {
  LIVE: 'https://gamehub-agg-v2.app.workbuddy.host/',
  DEPRECATED: [
    { url: 'https://gamehub-agg-join.app.workbuddy.host/', why: '停在 v10.17，域名无法重绑到新发布环境' },
    { url: 'https://36aa37e911e6447eb86eb187240daff2.app.workbuddy.host/', why: 'v10.10 那批的沙箱，碰巧含 v10.18，但非正式入口' },
  ],
};
const GITHUB = {
  repo: 'https://github.com/A13612812330/game-aggregator',
  owner: 'A13612812330',
  name: 'game-aggregator',
  branch: 'main',
  visibility: 'PRIVATE',
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
async function probeLink(url, localMd5, localLen) {
  const base = url.replace(/\/$/, '');
  const out = { url, http: null, md5: null, same: false, ver: '?', err: null };
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
    out.ver = out.same ? '与本地同版' : (/.chip\.ol/.test(txt) ? '新于本地？' : '旧版');
  } catch (e) {
    out.err = e.message.slice(0, 70);
  }
  return out;
}

/* ============ ④ GitHub ============ */
/**
 * 路径 2：走 api.github.com 读远端分支头。
 *
 * 为什么需要它（2026-09-18 实测）：本机网络对 **github.com（20.205.243.166）完全阻断**
 *   （连测 6 次全超时），于是 `git ls-remote` / `git push` 一律报
 *   `CONNECT tunnel failed, response 502`。
 *   而 **api.github.com（20.205.243.168）通畅**（TLS 正常，只是未授权时 403）。
 *   ⇒ 此时改用 REST API 读 ref，结果与 ls-remote 等价（同一个 sha）。
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
  return {
    remote,
    remoteShort: remote ? remote.slice(0, 7) : null,
    head: localHead,
    synced: !!remote && remote.slice(0, 12) === localHead.slice(0, 12),
    via,
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
  const index = read('CODEX-INDEX.md');
  /* 最新版本号：从 CODEX-INDEX 顶部块取 */
  const mv = (index.match(/v(10\.\d+)\s*增量/) || [])[1] || '?';
  const doneFiles = fs.readdirSync(ROOT).filter((f) => /^CODEX-DONE-v10\.\d+\.md$/.test(f)).sort((a, b) => {
    const n = (s) => Number((s.match(/v10\.(\d+)/) || [])[1] || 0);
    return n(a) - n(b);
  });
  return {
    readmeHas: readme.includes('v' + mv),
    /* README 顶层是 `## ★ vX`；INDEX 的版本块是引用样式 `> ## ★ vX` —— 两处都要容错 */
    readmeSection: (readme.match(/^>?\s*##\s*★\s*v(10\.\d+)[^\n]*/m) || [])[0] || '',
    indexHas: new RegExp('v' + mv.replace('.', '\\.') + '\\s*增量').test(index),
    indexHead: (index.match(/^>?\s*##\s*★\s*v[\d.]+[^\n]*/m) || [])[0] || '',
    latest: mv,
    doneCount: doneFiles.length,
    doneLatest: doneFiles.slice(-3),
    coverage: ['10.10','10.11','10.12','10.13','10.14','10.15','10.16','10.17','10.18','10.19','10.20']
      .map((v) => ({ v, readme: readme.includes('v' + v), index: index.includes('v' + v) })),
  };
}

/* ============ 主流程 ============ */
(async () => {
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
    const live = await probeLink(LINKS.LIVE, localMd5, idxLocal.length);
    p('| 项 | 实测 |');
    p('|---|---|');
    p('| HTTP | ' + (live.http || live.err) + ' |');
    p('| index.html md5 | ' + (live.md5 || '—') + '（本地 ' + localMd5 + '） |');
    p('| 判定 | ' + (live.same ? '✅ 与本地逐字节一致 = 已是最新' : '⚠️ ' + live.ver) + ' |');
    for (const d of LINKS.DEPRECATED) {
      const x = await probeLink(d.url, localMd5, idxLocal.length);
      p('| 弃用：' + d.url.replace('https://', '').replace(/\/$/, '') + ' | ' + (x.err ? x.err : 'HTTP ' + x.http + ' · ' + (x.same ? '⚠️ 内容竟与最新一致，但仍不用' : '旧版（符合预期）')) + ' |');
    }
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
    p('| 仓库 | ' + GITHUB.repo + '（' + GITHUB.visibility + '，分支 ' + GITHUB.branch + '） |');
    p('| 本地 HEAD | `' + head.slice(0, 7) + '` |');
    p('| 远端 ' + GITHUB.branch + ' | ' + (gh.remoteShort ? '`' + gh.remoteShort + '`' : '❌ 探测失败：' + gh.err) + ' |');
    p('| 探测路径 | ' + (gh.via === 'api' ? '🔄 REST API（github.com 不可达，见下方说明）' : gh.via === 'ls-remote' ? '`git ls-remote`' : '❌ 两条路径均失败') + ' |');
    p('| 结论 | ' + (gh.synced ? '✅ 已同步（远端 = 本地）' : gh.remote ? '⚠️ 未推送（本地领先）' : gh.bothFailed ? '❌ 无法确认（两条探测路径均失败）' : '❌ 无法确认') + ' |');
    if (gh.via === 'api') p('| 备注 | 本机 github.com 被阻断（`CONNECT tunnel failed, response 502`），' +
      '但 api.github.com 可用 ⇒ 结论仍为**实测**，非推测。 |');
  }

  /* ⑤ */
  const cl = changelog();
  p('');
  p('## ⑤ GitHub 更新日志');
  p('');
  p('| 位置 | 状态 |');
  p('|---|---|');
  p('| `README.md` | ' + (cl.readmeHas ? '✅ 已含 v' + cl.latest : '❌ 缺 v' + cl.latest) + ' · ' + cl.readmeSection.slice(0, 70) + ' |');
  p('| `CODEX-INDEX.md` | ' + (cl.indexHas ? '✅ 已含 v' + cl.latest : '❌ 缺 v' + cl.latest) + ' · ' + cl.indexHead.slice(0, 70) + ' |');
  p('| `CODEX-DONE-v*.md` | ' + cl.doneCount + ' 份，最近：' + cl.doneLatest.join(' / ') + ' |');
  p('| 逐版覆盖 | ' + cl.coverage.map((c) => 'v' + c.v + (c.readme && c.index ? '✔' : '✘')).join(' ') + ' |');

  const text = L.join('\n');
  if (MD_ONLY) console.log(text);
  else { console.log('\n' + text + '\n'); }
})();
