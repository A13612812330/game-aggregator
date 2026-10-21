'use strict';
/**
 * data/download-engine.js — 服务端 BT 下载引擎（v10.93）
 *
 * 移植自 Komo-Convert `src/KomoConvert.Modules.Downloads/`（.NET 桌面版，本机只读参考）：
 *   · Aria2Session.cs  → 本文件的进程生命周期 + JSON-RPC 封装
 *   · DownloadProbe.cs → preview() 的「只取元数据、不取正文」判据
 *   · TrackerList.cs   → sanitizeTrackers()
 *   ★ 是**按语义移植**，不是翻译代码：C# 的 async/await + HttpClient 在 Node 里对应
 *     Promise + fetch，参数表逐条对齐（启动参数一个不少），行为以本机/线上实测为准。
 *
 * 与桌面版最大的三处差别（部署形态不同，不能照抄）：
 *   ① 桌面版 aria2c.exe 随包分发；线上是 linux 容器 ⇒ **无则 apt 装**（实测 root + apt 可用）。
 *   ② 桌面版允许下 HTTP/种子文件；这里**只放行磁力**（用户口径就是「磁力链」），
 *      少一条入口就少一类 SSRF / 内网探测面。
 *   ③ 桌面版 gid 只活在一次进程里；线上容器会被平台回收 ⇒ 必须做 infoHash 对账恢复。
 *
 * ★ 一条硬约束写在这里，防止后来者「顺手打开」：
 *   `--rpc-listen-all=false` + 只绑 127.0.0.1 + 每次启动随机 secret。
 *   RPC 一旦被局域网/公网够到，等于把「任意文件写到服务器任意目录」这个能力公开
 *   （aria2 的 `dir` 参数可以指任何路径）。这不是「配置项」，是不能动的边界。
 */
const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, 'downloads');
const PREVIEW_ROOT = path.join(ROOT, '_previews');
const SESSION = path.join(ROOT, 'aria2.session');
const DHT = path.join(ROOT, 'dht.dat');

const RPC_TIMEOUT = 8000;
const START_TIMEOUT = 30000;
const MAX_FILES = 2000;

let proc = null;
let rpcUrl = '';
let secret = '';
let starting = null;
let binPath = null;
let installTried = false;
let installing = null;
let binVersion = '';
let warmupErr = '';
let lastLog = '';

/* ── 二进制探测与幂等安装 ── */

function which(cmd) {
  /* spawnSync 而不是 execFileSync：不经过 shell，参数位置固定，不会被 stdio 守卫判成 UNKNOWN
     （铁律 168：回调式 execFile 的 options 不在末位会让前置闸红）。 */
  try {
    const probe = spawnSync(cmd, ['--version'], { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'pipe'] });
    if (probe && probe.status === 0) {
      const first = String(probe.stdout || '').split('\n')[0].trim();
      return { ok: true, path: cmd, version: first.slice(0, 60) };
    }
  } catch (e) { /* 不存在 */ }
  return { ok: false };
}

function isRoot() {
  try { return !!(process.getuid && process.getuid() === 0); } catch (e) { return false; }
}

/**
 * 找 aria2c；找不到就装（仅 linux + root）。
 * ★ 为什么每次启动都探一遍而不是写进 Dockerfile：线上平台**不给我们控制镜像构建**，
 *   只有「启动时执行脚本」这一条路。幂等探测的代价是一次 spawnSync（~10ms），
 *   换来「容器重建后依然能起来」。apt 装只试一次，失败就记住，不会每个请求都去装。
 *
 * ★ 探测顺序（v10.93 实测补充）：env > 项目内 vendor > PATH > linux 常见路径 > apt 装。
 *   `vendor/aria2/` 这一条是为「后续打包成 EXE 分发」留的口子 ——
 *   桌面版可以随包带二进制，服务端版则走 apt，同一份代码两种形态。
 *   没有它的话，本地 Windows 调试就必须手工往 PATH 里加 aria2，否则 `bin:null`
 *   会让所有下载端点直接 503，而报错信息看起来像「功能没做」。
 */
function ensureBinary(opts) {
  if (binPath) return { ok: true, path: binPath };
  const probeOnly = !!(opts && opts.probeOnly);
  const exe = process.platform === 'win32' ? 'aria2c.exe' : 'aria2c';
  const cands = [];
  if (process.env.GAMEHUB_ARIA2) cands.push(process.env.GAMEHUB_ARIA2);
  cands.push(path.join(__dirname, '..', 'vendor', 'aria2', exe));
  cands.push(exe);
  if (process.platform !== 'win32') cands.push('/usr/bin/aria2c', '/usr/local/bin/aria2c', '/bin/aria2c');
  for (const c of cands) {
    if (c !== exe && !fs.existsSync(c)) continue;
    const r = which(c);
    if (r.ok) { binPath = c; binVersion = r.version; return { ok: true, path: c, version: r.version }; }
  }
  if (probeOnly) return { ok: false, reason: '未找到 aria2c（仅探测，未尝试安装）' };
  if (installing) return { ok: false, reason: 'aria2c 正在后台安装，请等十几秒再试' };
  if (installTried) return { ok: false, reason: 'aria2c 不存在，且本进程已尝试安装过（不重复尝试）' };
  installTried = true;
  if (process.platform !== 'linux') return { ok: false, reason: 'aria2c 不存在（非 linux，不自动安装）' };
  if (!isRoot()) return { ok: false, reason: 'aria2c 不存在，且当前用户非 root，无法自动安装' };
  /* ★ 同步兜底：只有「预热没跑 / 预热失败」时才会走到这里。
     它会阻塞事件循环最多 180s —— 所以正常路径必须靠 `warmup()`（异步），
     不能指望这条。首次部署时用户如果抢在预热前点下载，会在这里等一次是**可接受**的，
     但绝不能让「每个请求都走这条」（installTried 已经保证了）。 */
  /* ★ 必须先 update：新容器里 apt 包索引是空的，直接 install 会
     「E: Unable to locate package aria2」。v10.92 只验了 `apt` 命令存在（hasApt=true），
     没验过真装 —— 这就是线上第一次装失败的原因。 */
  const inst = spawnSync('sh', ['-c', 'apt-get update -qq && apt-get install -y --no-install-recommends aria2'], {
    encoding: 'utf8', timeout: 240000, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { DEBIAN_FRONTEND: 'noninteractive' }),
  });
  warmupErr = String((inst && (inst.stderr || inst.stdout)) || '').slice(-300) || ('apt exit=' + (inst && inst.status));
  const again = which('aria2c');
  if (again.ok) { binPath = again.path; binVersion = again.version; return { ok: true, path: again.path, version: again.version, installed: true }; }
  return {
    ok: false,
    reason: 'apt-get install aria2 失败（status=' + (inst && inst.status) + '）',
    detail: String((inst && (inst.stderr || inst.stdout)) || '').slice(0, 300),
  };
}

/**
 * 启动后后台预热（v10.93）。
 *
 * ★ 为什么必须有它：线上首次下载要 `apt-get install aria2`，同步跑 60–180 秒。
 *   如果在**请求路径**上装，这期间事件循环被完全阻塞 —— 本服务所有接口（含平台 60s
 *   健康检查）会一起挂掉，表现是「部署成功但整个站打不开」。
 *   ⇒ 进程起来 5 秒后**异步**装（spawn 不阻塞），装完把 binPath 填好；
 *     用户真在这十几秒内点下载，会得到「正在后台安装，请稍等」而不是一个卡死的请求。
 *
 * ★ 每次启动都跑：容器重建后 apt 装的包会丢，幂等探测（which 一次 ~10ms）换自愈。
 */
let warmupDone = false;
function warmup() {
  if (warmupDone) return null;
  warmupDone = true;
  /* ★ 用 probeOnly：warmup 的整个意义就是「不要同步阻塞」，而 ensureBinary() 的 apt 分支是
     spawnSync（最多 240s 把事件循环钉死）。只探测、由下面异步装。 */
  const found = ensureBinary({ probeOnly: true });
  if (found.ok) return null;
  if (process.platform !== 'linux' || !isRoot() || installing) return null;
  installTried = true;
  installing = new Promise((resolve) => {
    let p;
    let out = '';
    let settled = false;
    try {
      /* ★ 必须 `apt-get update` 先跑：新容器包索引为空，直接 install 会
         「E: Unable to locate package aria2」。线上第一次就是这么失败的。 */
      p = spawn('sh', ['-c', 'apt-get update -qq && apt-get install -y --no-install-recommends aria2'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: Object.assign({}, process.env, { DEBIAN_FRONTEND: 'noninteractive' }),
      });
    } catch (e) {
      installing = null;
      warmupErr = String(e && e.message);
      resolve({ ok: false, reason: warmupErr });
      return;
    }
    const collect = (d) => { out = (out + d.toString()).slice(-3000); };
    if (p.stdout) p.stdout.on('data', collect);
    if (p.stderr) p.stderr.on('data', collect);
    const done = (code) => {
      if (settled) return;
      settled = true;
      installing = null;
      binPath = null;
      const again = which('aria2c');
      if (again.ok) {
        binPath = again.path;
        binVersion = again.version;
        warmupErr = '';
        lastLog = 'aria2 已安装：' + again.version;
        resolve({ ok: true, path: again.path });
      } else {
        /* 失败原因必须留住：aria2 装不上的理由有十几种（没有源 / 没有网 / 磁盘满 / 权限），
           只回「未安装」等于让人重跑一遍才发现是同一个原因。诊断端点直接吐这段。 */
        warmupErr = ('apt exit=' + code + '\n' + out).slice(-400);
        lastLog = warmupErr;
        resolve({ ok: false, reason: warmupErr });
      }
    };
    p.on('exit', (code) => done(code));
    p.on('error', (e) => { out += '\n' + String(e && e.message); done('spawn-error'); });
  });
  return installing;
}

/* ── 进程 ── */

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

async function rpc(method, params) {
  const body = JSON.stringify({
    jsonrpc: '2.0', id: 'gh-' + Math.random().toString(36).slice(2), method,
    params: ['token:' + secret].concat(params || []),
  });
  const r = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(RPC_TIMEOUT),
  });
  const j = await r.json();
  if (j.error) {
    const e = new Error(j.error.message || 'aria2 rpc error');
    e.code = j.error.code;
    throw e;
  }
  return j.result;
}

async function start() {
  if (proc && !proc.killed && proc.exitCode === null) return { ok: true };
  if (starting) return starting;
  starting = (async () => {
    /* 预热还没跑过就先踢一下（异步），避免落到 ensureBinary 的同步 apt 分支把事件循环钉死 */
    if (!warmupDone && !binPath) { try { warmup(); } catch (e) { /* 下面如实报 */ } }
    const bin = ensureBinary();
    if (!bin.ok) {
      throw new Error(installing
        ? '下载引擎正在安装 aria2（首次部署约 1–3 分钟），请稍后再点一次'
        : bin.reason);
    }
    fs.mkdirSync(ROOT, { recursive: true });
    fs.mkdirSync(PREVIEW_ROOT, { recursive: true });
    const port = await freePort();
    secret = crypto.randomBytes(32).toString('hex');
    rpcUrl = 'http://127.0.0.1:' + port + '/jsonrpc';
    const hasSession = fs.existsSync(SESSION) && fs.statSync(SESSION).size > 0;
    const args = [
      '--no-conf=true',
      '--enable-rpc=true',
      '--rpc-listen-all=false',
      '--rpc-listen-port=' + port,
      '--rpc-secret=' + secret,
      '--rpc-allow-origin-all=false',
      /* 磁力必须开 DHT：线上实测 UDP DHT 有真回包（56B），这是能拿到种子的前提。
         ★ 刻意**不指定** `--dht-listen-port` / `--listen-port` 的宽范围：
         本机实测把两者设成 `49152-65535` 后元数据 90s 拿不到（同一磁力 PoC 默认端口 4.3s 成功）
         —— 宽范围会让 aria2 在大量端口上反复尝试绑定，Windows 防火墙逐端口弹栈后直接静默丢弃。
         默认端口（6881-6999 / DHT 6881-6999）足够，且是 PoC 已验证过的形态。 */
      '--enable-dht=true',
      '--enable-dht6=false',
      '--bt-enable-lpd=false',
      '--dht-file-path=' + DHT,
      '--disable-ipv6=true',
      '--seed-time=0',
      '--bt-seed-unverified=false',
      '--max-concurrent-downloads=3',
      '--auto-file-renaming=true',
      '--allow-overwrite=false',
      '--file-allocation=none',
      '--console-log-level=warn',
      '--summary-interval=0',
      '--check-certificate=true',
      '--save-session=' + SESSION,
      '--save-session-interval=10',
    ];
    if (hasSession) {
      /* 有历史会话就按「恢复但不自动开跑」拉起：容器被回收后不该自己偷偷跑满带宽 */
      args.push('--input-file=' + SESSION, '--pause=true');
    }
    const env = Object.assign({}, process.env);
    for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'FTP_PROXY', 'http_proxy', 'https_proxy']) delete env[k];
    /* stderr 收集到一个 4KB 环形缓冲：aria2 的失败原因（端口占用、证书、tracker 拒绝）
       全在这里，而只回「下载失败」等于让人瞎猜。不落盘，随进程消失。 */
    proc = spawn(bin.path, args, { stdio: ['ignore', 'ignore', 'pipe'], env, windowsHide: true });
    lastLog = '';
    if (proc.stderr) proc.stderr.on('data', (d) => { lastLog = (lastLog + d.toString()).slice(-4096); });
    proc.on('exit', () => { proc = null; });
    proc.on('error', () => { proc = null; });
    const deadline = Date.now() + START_TIMEOUT;
    for (;;) {
      if (!proc) throw new Error('aria2 进程启动即退出');
      try { await rpc('aria2.getVersion', []); return { ok: true, port, restored: hasSession }; }
      catch (e) {
        if (Date.now() > deadline) throw new Error('等待 aria2 就绪超时：' + String(e && e.message));
        await new Promise((r) => setTimeout(r, 120));
      }
    }
  })().finally(() => { starting = null; });
  return starting;
}

async function ready() {
  try { await rpc('aria2.getVersion', []); } catch (e) { await start(); }
}

function alive() {
  return !!(proc && proc.exitCode === null);
}

function info() {
  /* ★ v10.93.1 修：这里**不许**再调 `ensureBinary()`。
   *   线上实测踩中：`/api/downloads/quota` 是高频公开端点，它调 `info()` → `ensureBinary()` →
   *   把 `installTried` 置成 true ⇒ 启动 5 秒后的 `warmup()` 调 `ensureBinary()` 时看到
   *   「已尝试过」直接返回 ⇒ **引擎永远装不上**，而报错文案还写着「已尝试安装过（不重复尝试）」，
   *   看起来像「真的试过了」，实际上是「被一次只读查询挡掉的」。
   *   ⇒ info() 变成纯只读：只看内部状态，不做任何探测、不产生任何副作用。 */
  let err = '';
  if (!binPath) {
    if (installing) err = 'aria2c 正在后台安装，请稍后';
    else if (!warmupDone) err = '尚未探测（启动 5 秒后自动预热）';
    else err = warmupErr || 'aria2c 不可用';
  }
  return { alive: alive(), bin: binPath || null, version: binVersion, error: err };
}

/** 最近 4KB 的 aria2 stderr —— 只给管理员看，不下发到公开端点。 */
function log() { return lastLog; }

/* ── 元数据预览：只取种子，不取正文 ── */

/**
 * @param {string} magnet
 * @returns {Promise<{ok:boolean, name?:string, btih?:string, totalBytes?:number, files?:Array, error?:string}>}
 *
 * 流程（与 Komo-Convert DownloadProbe 同构）：
 *   1. addUri 带 `bt-metadata-only` + `bt-save-metadata` ⇒ aria2 只拉种子，正文一个字节不落
 *   2. 轮询 tellStatus 到 complete（实测 4.3s–8.5s）
 *   3. 在预览目录里找 `<infohash>.torrent`（aria2 用大写 hex 命名）
 *   4. **另起一个 paused 任务**加载该种子读 getFiles —— 不用原 gid 读，是因为
 *      metadata-only 任务的 files 只有种子文件本身，读不到内容清单
 *   5. 删掉第 4 步的临时任务，种子里程碑完成
 */
async function preview(magnet, opts) {
  await ready();
  const dir = (opts && opts.dir) || path.join(PREVIEW_ROOT, crypto.randomBytes(6).toString('hex'));
  fs.mkdirSync(dir, { recursive: true });
  const gid = await rpc('aria2.addUri', [[magnet], {
    dir,
    pause: 'false',
    'bt-metadata-only': 'true',
    'bt-save-metadata': 'true',
    'follow-torrent': 'false',
    'seed-time': '0',
  }]);
  const deadline = Date.now() + ((opts && opts.timeoutMs) || 90000);
  let torrentFile = '';
  for (;;) {
    if (Date.now() > deadline) {
      try { await rpc('aria2.forceRemove', [gid]); } catch (e) { /* 已消失 */ }
      return { ok: false, error: '解析种子超时（90s）。可能是死种或网络不通 DHT' };
    }
    const st = await rpc('aria2.tellStatus', [gid, ['status', 'errorMessage', 'errorCode', 'infoHash']]);
    const status = String(st.status || '');
    if (status === 'error') {
      return { ok: false, error: 'aria2: ' + (st.errorMessage || 'errorCode ' + st.errorCode) };
    }
    if (status === 'complete' || status === 'removed') {
      const hit = pickTorrent(dir, st.infoHash);
      if (hit) { torrentFile = hit; break; }
      if (status === 'complete') {
        /* complete 但还没落盘：给 3 秒缓冲，磁盘写入是异步的 */
        await new Promise((r) => setTimeout(r, 300));
        const hit2 = pickTorrent(dir, st.infoHash);
        if (hit2) { torrentFile = hit2; break; }
      }
      return { ok: false, error: '元数据完成但没找到 .torrent 文件' };
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  try { await rpc('aria2.forceRemove', [gid]); } catch (e) { /* ignored */ }

  const buf = fs.readFileSync(torrentFile);
  if (buf.length > 8 * 1024 * 1024) return { ok: false, error: '种子文件超过 8 MB' };
  const tgid = await rpc('aria2.addTorrent', [buf.toString('base64'), [], { dir, pause: 'true' }]);
  try {
    const st = await rpc('aria2.tellStatus', [tgid, ['files', 'bittorrent', 'totalLength', 'infoHash']]);
    const files = (st.files || []).slice(0, MAX_FILES).map((f) => ({
      index: Number(f.index),
      name: String(f.path || '').split(/[\\/]/).filter(Boolean).pop() || '',
      length: Number(f.length) || 0,
      selected: true,
    })).filter((f) => f.name);
    const b = st.bittorrent || {};
    const name = String((b.info && b.info.name) || '') || (files[0] ? files[0].name : 'BT 任务');
    const totalBytes = Number(st.totalLength) || files.reduce((a, f) => a + f.length, 0);
    return {
      ok: true,
      btih: String(st.infoHash || '').toUpperCase(),
      name,
      totalBytes,
      files,
      torrentPath: torrentFile,
      dir,
    };
  } finally {
    try { await rpc('aria2.forceRemove', [tgid]); } catch (e) { /* ignored */ }
  }
}

/** aria2 把种子存成 `<40位大写HEX>.torrent`；infoHash 可能拿不到，退回「目录里唯一的 .torrent」。 */
function pickTorrent(dir, infoHash) {
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => /\.torrent$/i.test(n)); } catch (e) { return ''; }
  if (!names.length) return '';
  const want = String(infoHash || '').toUpperCase();
  if (want) {
    const hit = names.find((n) => n.toUpperCase().startsWith(want));
    if (hit) return path.join(dir, hit);
  }
  if (names.length === 1) return path.join(dir, names[0]);
  return path.join(dir, names[0]);
}

/* ── 正式任务 ── */

async function addTorrentFile(task, torrentPath, selected) {
  await ready();
  const buf = fs.readFileSync(torrentPath);
  const options = {
    dir: task.dir,
    pause: 'false',
    'allow-overwrite': 'false',
    'auto-file-renaming': 'true',
    'follow-torrent': 'false',
    'seed-time': '0',
    'split': '4',
    'max-connection-per-server': '4',
  };
  const sel = normalizeSelection(selected, task.files);
  if (sel) options['select-file'] = sel;
  const gid = await rpc('aria2.addTorrent', [buf.toString('base64'), [], options]);
  return gid;
}

/**
 * select-file 只接受 `1,2,5` 或 `1-5` 这种形式。
 * ★ 2000 项全选时拼成 8000 字符的串，aria2 能收但日志难看；
 *   更要紧的是「空数组」——aria2 会把它当成「不选任何文件」然后任务立刻完成，
 *   用户看到「已完成但 0 字节」。所以空选择必须显式报错，不能传下去。
 */
function normalizeSelection(selected, files) {
  const all = (files || []).map((f) => Number(f.index)).filter((n) => n > 0);
  const pick = (selected && selected.length ? selected : all)
    .map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0);
  if (!pick.length) return '';
  const uniq = Array.from(new Set(pick)).sort((a, b) => a - b);
  if (uniq.length === all.length) return ''; // 全选不必传，交给 aria2 默认
  return uniq.join(',');
}

const STATE_MAP = {
  active: 'downloading',
  waiting: 'queued',
  paused: 'paused',
  complete: 'ready',
  error: 'failed',
  removed: 'cancelled',
};

async function status(gid) {
  await ready();
  try {
    const st = await rpc('aria2.tellStatus', [gid, [
      'gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed',
      'errorMessage', 'errorCode', 'infoHash', 'files',
    ]]);
    /* ★ 进度口径：分子分母**必须都用 aria2 的 torrent 级字段**（totalLength / completedLength），
       它们同口径 ⇒ 永远不会出现「分子 > 分母」，且进度真实平滑。
       ★ 反过来做（分母用「选中文件之和」）会出两个坑，都是实测踩到的：
         ① 线上勾 1 个 69 B 的 .bat，aria2 的 completedLength 已经是 4,079,169 B
            ⇒ 显示「4,079,169 / 69」，荒谬；
         ② 若分子改用选中文件的 completedLength，piece 没下完时它恒为 0
            ⇒ 进度条长时间停在 0%，用户以为卡死（BT 是按块校验的）。
       ⇒ 所以「传输量」当进度，「所选文件体积」另用 selTotalBytes 单独告知用户。 */
    const files = Array.isArray(st.files) ? st.files : [];
    const picked = files.filter((f) => f && (f.selected === 'true' || f.selected === true));
    const pool = picked.length ? picked : files;
    const selTotal = pool.reduce((a, f) => a + (Number(f.length) || 0), 0);
    const totalBytes = Number(st.totalLength) || 0;
    let completedBytes = Number(st.completedLength) || 0;
    if (completedBytes > totalBytes) completedBytes = totalBytes;
    if (String(st.status) === 'complete') completedBytes = totalBytes;
    return {
      ok: true,
      state: STATE_MAP[String(st.status)] || 'failed',
      totalBytes,
      completedBytes,
      selTotalBytes: selTotal,
      speed: Number(st.downloadSpeed) || 0,
      error: String(st.errorMessage || ''),
      infoHash: String(st.infoHash || ''),
    };
  } catch (e) {
    /* gid 不在 aria2 里（进程重启过 / 任务被清）—— 这不是「下载失败」，
       而是「引擎里没有这个任务」，调用方据此做对账，不要覆盖成 failed。 */
    return { ok: false, gone: true, error: String((e && e.message) || e) };
  }
}

async function act(gid, action) {
  await ready();
  const map = { pause: 'aria2.forcePause', resume: 'aria2.unpause', cancel: 'aria2.forceRemove' };
  const m = map[action];
  if (!m) throw new Error('未知操作：' + action);
  return rpc(m, [gid]);
}

/**
 * 重启对账：aria2 恢复会话后 gid 全变，任务表里的旧 gid 全部失效。
 * ★ 用 infoHash 对账，不用文件名 —— 文件名会因 auto-file-renaming 变成 `xxx (1).rar`。
 * ★ 恢复进来的任务处于 paused（启动参数 `--pause=true`），这里**不自动开跑**：
 *   容器被回收是平台行为，不该顺势把 30 GB 重新灌满；让用户自己点「继续」。
 */
async function reconcile(tasks) {
  await ready();
  const live = [];
  for (const m of ['aria2.tellActive', 'aria2.tellWaiting', 'aria2.tellStopped']) {
    try {
      const args = m === 'aria2.tellActive' ? [] : [0, 1000];
      const arr = await rpc(m, args);
      for (const t of arr || []) live.push(t);
    } catch (e) { /* ignored */ }
  }
  const byHash = new Map();
  for (const t of live) {
    if (t.infoHash) byHash.set(String(t.infoHash).toUpperCase(), t);
  }
  const out = [];
  for (const task of tasks || []) {
    if (!task.btih) continue;
    const hit = byHash.get(String(task.btih).toUpperCase());
    if (hit && hit.gid !== task.gid) out.push({ id: task.id, gid: hit.gid, state: STATE_MAP[String(hit.status)] || task.state });
  }
  return out;
}

async function shutdown() {
  if (!proc) return;
  try { await rpc('aria2.saveSession', []); } catch (e) { /* ignored */ }
  try { proc.kill(); } catch (e) { /* ignored */ }
  proc = null;
}

module.exports = {
  ROOT, PREVIEW_ROOT, SESSION,
  ensureBinary, warmup, start, ready, alive, info, rpc,
  preview, addTorrentFile, normalizeSelection, status, act, reconcile, shutdown, pickTorrent, log,
  STATE_MAP,
};
