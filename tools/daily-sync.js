#!/usr/bin/env node
'use strict';
/**
 * tools/daily-sync.js — GameHub 内容库每日维护「一条命令」版
 *
 * ── 为什么要有这个脚本 ────────────────────────────────────────────────
 * 原先的每日自动化是「模型亲自跑 10 条命令、逐步读输出」：
 *   ① 每一步的原始 stdout（含大段 JSON）都要进模型上下文 ⇒ 单次开销大；
 *   ② prompt 里写死了一个**不存在**的 node 版本目录（…/22.22.2-2/），
 *      每天都要先试错、再自行纠正 ⇒ 白烧一轮；
 *   ③ 没有统一的失败语义，10 个步骤各写各的判断，容易漏判。
 * 现在把 10 步收进**一次进程**，只在最后回吐一份 ≤8KB 的结构化摘要。
 * 模型只需：跑这一条命令 → 读摘要 → 转述。原始输出永远不进上下文。
 *
 * ── 用法 ──────────────────────────────────────────────────────────────
 *   node tools/daily-sync.js                     # 正常执行全流程
 *   node tools/daily-sync.js --json              # 摘要以 JSON 输出（给程序读）
 *   node tools/daily-sync.js --dry               # 只体检 + 读产物，不做任何写操作
 *   node tools/daily-sync.js --skip=saves,trainers   # 跳过指定步骤（逗号分隔）
 *   node tools/daily-sync.js --timeout-bh=300000 # 覆盖某步超时
 *
 * ── 退出码 / 末行状态码 ───────────────────────────────────────────────
 *   0  全部成功（含「跳过」「阻塞」）
 *   2  有非关键步骤失败     末行 DAILY_PARTIAL
 *   3  关键步骤失败（服务不可用）  末行 DAILY_FAIL
 *   阻塞（xlsx 缺失等外部原因）单独用 NEED_XLSX 标记，不算失败
 *
 * ── 设计约束（沿用项目铁律） ──────────────────────────────────────────
 *   · 不改任何源码、不删任何东西（只跑既有脚本与 HTTP 接口）
 *   · node 路径**不写死**：用 process.execPath（谁启动我，就用谁跑子进程）
 *   · python 路径**不写死用户名**：按 os.homedir() 推导 + PATH 兜底
 *   · 每一步独立 try/catch，失败只记录不中断（除关键步骤）
 *   · 摘要读**产物 json 的 stats**，不解析 stdout 文本（稳得多）
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BASE = process.env.GAMEHUB_BASE || 'http://localhost:8123';
const DATA = path.join(ROOT, 'data');

// xlsx 源表（build-phonecfg.py 的输入，路径写死在该脚本里，这里只做存在性检查）
const XLSX = process.env.GAMEHUB_XLSX || 'E:\\新建文件夹\\基础测试数据.xlsx';

/* ============================ 纯函数（可测） ============================ */

/** 任务是否已结束：run / runJ 为 null，或 done 为真值（done 是时间戳）。 */
function isTaskDone(t) {
  if (!t) return true;
  return !!t.done;
}

/** 显示宽度：CJK 与全角算 2，其余算 1（用于对齐，不用于业务判断）。 */
function dispWidth(s) {
  let w = 0;
  for (const ch of String(s == null ? '' : s)) {
    w += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1;
  }
  return w;
}

/** 按显示宽度右侧补空格。 */
function padLabel(s, width) {
  const str = String(s == null ? '' : s);
  return str + ' '.repeat(Math.max(0, width - dispWidth(str)));
}

/** 数字增减的展示：无变化返回空串，避免摘要里塞一堆 (+0)。 */
function fmtDelta(before, after) {
  if (typeof before !== 'number' || typeof after !== 'number') return '';
  const d = after - before;
  if (!d) return '';
  return ' (' + (d > 0 ? '+' : '') + d + ')';
}

/**
 * 由步骤结果决定总体状态。
 * 返回 'DAILY_OK' | 'DAILY_PARTIAL' | 'DAILY_FAIL'
 */
function decideStatus(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.some((r) => r.critical && r.status === 'fail')) return 'DAILY_FAIL';
  if (list.some((r) => r.status === 'fail')) return 'DAILY_PARTIAL';
  return 'DAILY_OK';
}

/** 统计各状态条数，供摘要末行使用。 */
function tally(rows) {
  const out = { ok: 0, fail: 0, skip: 0, blocked: 0 };
  for (const r of Array.isArray(rows) ? rows : []) {
    if (out[r.status] != null) out[r.status] += 1;
  }
  return out;
}

/**
 * 决定某一步跑不跑（**唯一的拦截真源**）。
 * 抽成纯函数是为了能对 `--dry` 做**行为级**断言 —— 否则只能靠数源码里
 * 出现了几次 `if (ctx.dry)`，那种断言拦不住「内层又手写一份」。
 * 返回 { run, reason, kind }，kind 供日志做区分。
 */
function planStep(def, opts) {
  const o = opts || {};
  const skipSet = o.skip instanceof Set ? o.skip : new Set();
  if (def && skipSet.has(def.key)) return { run: false, kind: 'skip', reason: '按要求跳过' };
  if (o.dry && def && def.write) return { run: false, kind: 'dry', reason: '--dry（该步有写副作用，未执行）' };
  return { run: true, kind: 'run', reason: '' };
}

/**
 * 从 /api/library/stats 的返回里取分源条数。
 * ★ 分源条数在 **bySource** 下（bySource.xdgamer / bySource.jidi），顶层**没有**这两个键。
 *   第一版直接读 lib.xdgamer ⇒ 摘要静默显示成 "xdgamer ? + jidi ?"（不报错、不崩，就是数字变问号）。
 * 抽成纯函数是为了能用**真实形状**的输入做行为断言 —— 只查「源码里出现过 bySource」拦不住
 * 「读错层级」，因为别的函数里也有 bySource（反证实测：那种断言全绿）。
 */
function sourceCounts(lib) {
  const bs = (lib && lib.bySource) || {};
  return {
    xdgamer: bs.xdgamer != null ? bs.xdgamer : null,
    jidi: bs.jidi != null ? bs.jidi : null,
  };
}

/** 渲染摘要文本（≤8KB，实测约 1.5KB）。 */
function buildSummary(rows, meta) {
  const m = meta || {};
  const list = Array.isArray(rows) ? rows : [];
  const icon = { ok: '✅', fail: '❌', skip: '⏭', blocked: '⛔' };
  const lines = [];
  lines.push('=== GameHub 内容库每日维护摘要 ===');
  lines.push('时间 ' + (m.stamp || '') + ' ｜ 服务 ' + (m.health || '未知'));
  lines.push('------------------------------------');
  list.forEach((r, i) => {
    lines.push(String(i + 1) + '. ' + padLabel(r.label, 16) + (icon[r.status] || '?') + ' ' + (r.detail || ''));
  });
  lines.push('------------------------------------');
  if (m.libLine) lines.push(m.libLine);
  if (m.builtAtLine) lines.push(m.builtAtLine);
  lines.push('耗时 ' + (m.elapsed || '?'));
  lines.push('------------------------------------');
  const t = tally(list);
  lines.push(
    (m.status || 'DAILY_OK') + '  ' + t.ok + ' 成功 / ' + t.fail + ' 失败 / ' +
    t.blocked + ' 阻塞' + (t.skip ? ' / ' + t.skip + ' 跳过' : '')
  );
  for (const n of m.notes || []) lines.push('待办：' + n);
  return lines.join('\n');
}

/** 从产物 json 读 stats（产物一律带 stats，比解析 stdout 稳）。 */
function readProduct(name) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(DATA, name + '.json'), 'utf8'));
    const st = j.stats || null;
    const builtAt = j.builtAt || (st && st.builtAt) || null;
    return { stats: st, builtAt };
  } catch (e) {
    return null;
  }
}

/** 本地时间戳，形如 2026-09-23 10:45:12 (周三)。 */
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
    p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + ' (' + wd + ')';
}

/** 简短时间戳，形如 09-23 09:31。 */
function shortTime(ts) {
  if (!ts) return '未知';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

/** 耗时展示：3m12s / 45s / 800ms */
function fmtMs(ms) {
  if (ms < 1000) return ms + 'ms';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  return Math.floor(s / 60) + 'm' + (s % 60) + 's';
}

/** 找到可用的 python 解释器（不写死用户名）。 */
function findPython() {
  const cands = [
    process.env.GAMEHUB_PYTHON,
    path.join(os.homedir(), '.workbuddy', 'binaries', 'python', 'envs', 'default', 'Scripts', 'python.exe'),
    path.join(os.homedir(), '.workbuddy', 'binaries', 'python', 'envs', 'default', 'bin', 'python'),
    'python',
    'python3',
  ];
  for (const c of cands) {
    if (!c) continue;
    if (c === 'python' || c === 'python3') return c;   // 交给 PATH
    try { if (fs.existsSync(c)) return c; } catch (e) { /* 下一个 */ }
  }
  return null;
}

/* ============================ 运行时工具 ============================ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 发一个 JSON 请求；永不抛。 */
async function httpJson(method, p, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs || 10000);
  try {
    const res = await fetch(BASE + p, { method, signal: ctl.signal });
    const txt = await res.text();
    let j = null;
    try { j = JSON.parse(txt); } catch (e) { /* 非 JSON，保留原文片段 */ }
    return {
      ok: res.ok && !!j && j.ok !== false,
      status: res.status,
      json: j,
      snippet: String(txt || '').slice(0, 200),
    };
  } catch (e) {
    return { ok: false, status: 0, json: null, snippet: '', error: String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

/** 跑一个子进程；永不抛。返回 { ok, code, stdout, stderr, ms, killed }。 */
function runProc(cmd, args, opts) {
  const o = opts || {};
  const timeoutMs = o.timeoutMs || 120000;
  return new Promise((resolve) => {
    if (!cmd) return resolve({ ok: false, code: null, stdout: '', stderr: '未找到解释器', ms: 0, killed: false });
    const t0 = Date.now();
    let out = '', err = '', killed = false, settled = false;
    let p;
    try {
      p = spawn(cmd, args, { cwd: o.cwd || ROOT, windowsHide: true });
    } catch (e) {
      return resolve({ ok: false, code: null, stdout: '', stderr: String(e.message), ms: 0, killed: false });
    }
    const done = (code, extra) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(Object.assign({
        ok: code === 0, code, stdout: out, stderr: err, ms: Date.now() - t0, killed,
      }, extra || {}));
    };
    const timer = setTimeout(() => {
      killed = true;
      try { p.kill(); } catch (e) { /* 忽略 */ }
      setTimeout(() => done(null), 300);
    }, timeoutMs);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => done(null, { stderr: String(e.message) }));
    p.on('close', (code) => done(code));
  });
}

/** 轮询 /api/library/progress 直到指定任务结束；返回是否按时结束。 */
async function waitIdle(keys, maxMs) {
  const deadline = Date.now() + (maxMs || 600000);
  while (Date.now() < deadline) {
    const r = await httpJson('GET', '/api/library/progress', 8000);
    if (!r.ok || !r.json) return false;
    const all = (keys || ['run', 'runJ']).every((k) => isTaskDone(r.json[k]));
    if (all) return true;
    await sleep(5000);
  }
  return false;
}

/** 轮询 BannerHub 刷新状态，直到 running=false。 */
async function waitBh(maxMs) {
  const deadline = Date.now() + (maxMs || 720000);
  while (Date.now() < deadline) {
    const r = await httpJson('GET', '/api/bh/refresh/state', 8000);
    if (!r.ok || !r.json) return null;
    if (!r.json.running) return r.json;      // ★ 成败看 lastOk，不看 ok（ok 恒 true）
    await sleep(5000);
  }
  return null;
}

/* ============================ 步骤实现 ============================ */

/** 1) 服务体检（关键步骤）：不可达则尝试后台启动。 */
async function stepHealth(ctx) {
  const first = await httpJson('GET', '/api/health', 5000);
  if (first.ok) return { status: 'ok', detail: '已在运行' };
  if (ctx.dry) return { status: 'fail', detail: '不可达（--dry 不启动服务）', critical: true };
  let p;
  try {
    p = spawn(process.execPath, ['server.js'], {
      cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true,
    });
    p.unref();
  } catch (e) {
    return { status: 'fail', detail: '启动失败：' + String(e.message).slice(0, 80), critical: true };
  }
  await sleep(4000);
  const again = await httpJson('GET', '/api/health', 8000);
  if (again.ok) return { status: 'ok', detail: '原不可达，已自动启动' };
  return { status: 'fail', detail: '启动后仍不可达', critical: true };
}

/** 2) XD 增量索引。 */
async function stepXd(ctx) {
  const b = await httpJson('GET', '/api/library/stats', 10000);
  const before = b.json ? b.json.total : null;
  const r = await httpJson('POST', '/api/library/index/incr?pages=10', 25000);
  if (r.status === 409) return { status: 'skip', detail: '有任务在跑（409），本轮跳过' };
  if (!r.ok) return { status: 'fail', detail: '提交失败 ' + (r.error || ('HTTP ' + r.status)) };
  const finished = await waitIdle(['run'], ctx.t.xd);
  if (!finished) return { status: 'fail', detail: '提交成功但未在超时内结束' };
  const prog = await httpJson('GET', '/api/library/progress', 8000);
  const task = (prog.json && prog.json.run) || null;
  const a = await httpJson('GET', '/api/library/stats', 10000);
  const after = a.json ? a.json.total : null;
  const st = prog.json && prog.json.state && prog.json.state.xdgame;
  const parts = [];
  parts.push('库 ' + (before == null ? '?' : before) + ' → ' + (after == null ? '?' : after) + fmtDelta(before, after));
  if (st && st.lastIncrAt) parts.push('lastIncrAt ' + shortTime(st.lastIncrAt));
  if (task && task.error) return { status: 'fail', detail: parts.join(' · ') + ' · 任务报错：' + String(task.error).slice(0, 90) };
  return { status: 'ok', detail: parts.join(' · ') };
}

/** 3) BannerHub 社区配置库刷新 + 轮询。 */
async function stepBh(ctx) {
  const post = await httpJson('POST', '/api/bh/refresh', 15000);
  if (!post.ok && post.status !== 409) {
    return { status: 'fail', detail: '提交失败 ' + (post.error || ('HTTP ' + post.status)) };
  }
  const st = await waitBh(ctx.t.bh);
  if (!st) return { status: 'fail', detail: '刷新未在超时内结束' };
  if (!st.lastOk) return { status: 'fail', detail: '刷新失败：' + String(st.error || '未知').slice(0, 90) };
  const r = st.result || {};
  const ms = (r.ms != null) ? fmtMs(r.ms) : '?';
  return {
    status: 'ok',
    detail: ms + ' · games ' + r.games + ' / configs ' + r.configs + ' / phones ' + r.phones +
      ' / gpus ' + r.gpus + ' / 匹配 ' + r.matchedLibGames,
  };
}

/** 4) 实测配置库（xlsx → phonecfg.json）；xlsx 缺失属外部阻塞，不算失败。 */
async function stepPhonecfg(ctx) {
  if (!fs.existsSync(XLSX)) {
    const p = readProduct('phonecfg');
    const aged = p && p.builtAt ? shortTime(p.builtAt) : '未知';
    return {
      status: 'blocked',
      detail: 'NEED_XLSX：' + XLSX + ' 不存在（phonecfg 仍 ' + aged + ' 版）',
      blockedReason: 'NEED_XLSX',
    };
  }
  const py = findPython();
  if (!py) return { status: 'fail', detail: '未找到 python 解释器' };
  const r = await runProc(py, [path.join('tools', 'build-phonecfg.py')], { timeoutMs: ctx.t.script });
  if (!r.ok) {
    return { status: 'fail', detail: 'EXIT ' + r.code + '：' + String(r.stderr || r.stdout).trim().slice(0, 120) };
  }
  const p = readProduct('phonecfg');
  if (!p || !p.stats) return { status: 'fail', detail: '脚本成功但产物无法解析' };
  return {
    status: 'ok',
    detail: '记录 ' + p.stats.records + ' / 游戏 ' + p.stats.games + ' / 可玩 ' + p.stats.playableYes,
  };
}

/** 5) 手游中心合并索引（★ 必须在 3、4 之后跑，输入是它们的产物）。 */
async function stepMobilehub(ctx) {
  const r = await runProc(process.execPath, [path.join('tools', 'build-mobilehub.js')], { timeoutMs: ctx.t.script });
  if (!r.ok) {
    return { status: 'fail', detail: 'EXIT ' + r.code + '：' + String(r.stderr || r.stdout).trim().slice(0, 120) };
  }
  const p = readProduct('mobilehub');
  if (!p || !p.stats) return { status: 'fail', detail: '脚本成功但产物无法解析' };
  const s = p.stats;
  return {
    status: 'ok',
    detail: s.total + ' 条（社区独有 ' + s.onlyBh + ' / 实测独有 ' + s.onlyPc + ' / 双料 ' + s.both +
      '）· 匹配端游 ' + s.matched + ' (' + s.matchedRate + '%)',
  };
}

/** 6) 修改器数据（联网源，失败不中断）。 */
async function stepTrainers(ctx) {
  const r = await runProc(process.execPath, [path.join('tools', 'fetch-trainers.js')], { timeoutMs: ctx.t.net });
  const p = readProduct('trainers');
  if (!r.ok && (!p || !p.stats)) {
    return { status: 'fail', detail: 'EXIT ' + r.code + '（源站可能不可达）：' + String(r.stderr || '').trim().slice(0, 100) };
  }
  if (!p || !p.stats) return { status: 'fail', detail: '产物无法解析' };
  const s = p.stats;
  const by = s.bySource || {};
  const detail = s.total + ' 条（CE ' + (by.cheat_table || 0) + ' / 风灵 ' + (by.fling || 0) +
    ' / 社区 ' + (by.community || 0) + ' / 小幸 ' + (by.xiaoxing || 0) + ' / GCM ' + (by.gcm || 0) +
    '）· 命中 ' + s.matched + ' (' + s.matchedRate + '%)';
  return { status: r.ok ? 'ok' : 'fail', detail: detail + (r.ok ? '' : ' · 本轮脚本非零退出，以上为上次产物') };
}

/** 7) 云存档（缺 manifest 会自动下载）。 */
async function stepSaves(ctx) {
  const manifest = path.join(ROOT, '.cache', 'ludusavi-manifest.yaml');
  const r = await runProc(process.execPath, [path.join('tools', 'build-saves.js')], { timeoutMs: ctx.t.net });
  const p = readProduct('saves');
  if (!r.ok && (!p || !p.stats)) {
    return { status: 'fail', detail: 'EXIT ' + r.code + '：' + String(r.stderr || '').trim().slice(0, 100) };
  }
  if (!p || !p.stats) return { status: 'fail', detail: '产物无法解析' };
  const s = p.stats;
  const detail = s.total + ' 款 / ' + s.pathCount + ' 路径 / ' + s.regCount + ' 注册表 / ' +
    s.phonePlayable + ' 手机能玩 · 在端游库 ' + s.inPcLib;
  return {
    status: r.ok ? 'ok' : 'fail',
    detail: detail + (r.ok ? (fs.existsSync(manifest) ? '' : ' · manifest 已重建') : ' · 本轮脚本非零退出，以上为上次产物'),
  };
}

/** 8) 机地话题同步（与 XD 互斥，遇 409 等空闲后重试一次）。 */
async function stepJidi(ctx) {
  let r = await httpJson('POST', '/api/library/index/jidi', 20000);
  if (r.status === 409) {
    const freed = await waitIdle(['run', 'runJ'], 180000);
    if (freed) r = await httpJson('POST', '/api/library/index/jidi', 20000);
  }
  if (!r.ok) return { status: 'fail', detail: '提交失败 ' + (r.error || ('HTTP ' + r.status)) };
  const finished = await waitIdle(['runJ'], ctx.t.jidi);
  if (!finished) return { status: 'fail', detail: '提交成功但未在超时内结束' };
  const prog = await httpJson('GET', '/api/library/progress', 8000);
  const st = prog.json && prog.json.state && prog.json.state.jidi;
  if (st && st.error) return { status: 'fail', detail: '同步报错：' + String(st.error).slice(0, 100) };
  if (!st) return { status: 'ok', detail: '已提交（无状态回写）' };
  // ★ idxState.jidi.total 是**全库总量**（upsert 返回值），不是 jidi 源条数。
  //   直接展示它会得到「jidi 19051」这种误导数字；真正的分源条数只在 bySource 里。
  const lib = await httpJson('GET', '/api/library/stats', 8000);
  const jidiCount = sourceCounts(lib.json).jidi;
  return {
    status: 'ok',
    detail: 'got ' + st.synced + ' / added ' + st.added +
      (jidiCount != null ? ' · jidi 源 ' + jidiCount : '') +
      ' · ' + shortTime(st.lastSyncAt),
  };
}

/* ============================ 主流程 ============================ */

/**
 * ★ write:true 表示该步**有写副作用**（改库 / 改产物）。
 * `--dry` 的拦截**统一走这张表**，不在各步内层各写一份 if ——
 * 实测教训：内层手写 if 时漏了 3 步（XD / BannerHub / 机地），
 * `--dry` 嘴上说不写、实际把三个任务都真跑了。声明式单点拦截不给漏的机会。
 */
const STEP_DEFS = [
  { key: 'health', label: '服务体检', fn: stepHealth, critical: true },
  { key: 'xd', label: 'XD 增量', fn: stepXd, write: true },
  { key: 'bh', label: 'BannerHub 刷新', fn: stepBh, write: true },
  { key: 'phonecfg', label: '实测配置库', fn: stepPhonecfg, write: true },
  { key: 'mobilehub', label: '手游中心重建', fn: stepMobilehub, write: true },
  { key: 'trainers', label: '修改器', fn: stepTrainers, write: true },
  { key: 'saves', label: '云存档', fn: stepSaves, write: true },
  { key: 'jidi', label: '机地同步', fn: stepJidi, write: true },
];

function parseArgs(argv) {
  const skip = new Set();
  const t = { xd: 600000, bh: 720000, jidi: 300000, script: 180000, net: 420000 };
  for (const a of argv) {
    if (a.startsWith('--skip=')) {
      for (const k of a.slice(7).split(',')) if (k.trim()) skip.add(k.trim());
    }
    const m = /^--timeout-(\w+)=(\d+)$/.exec(a);
    if (m && t[m[1]] != null) t[m[1]] = parseInt(m[2], 10);
  }
  return {
    skip,
    t,
    dry: argv.includes('--dry'),
    asJson: argv.includes('--json'),
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const opts = parseArgs(argv);
  const ctx = { dry: opts.dry, t: opts.t };
  const t0 = Date.now();
  const rows = [];

  for (const def of STEP_DEFS) {
    const base = { key: def.key, label: def.label, critical: !!def.critical };
    const plan = planStep(def, opts);
    if (!plan.run) {
      rows.push(Object.assign(base, { status: 'skip', detail: plan.reason }));
      if (!opts.asJson) {
        process.stderr.write('[daily-sync] ' + def.label + ' 跳过' + (plan.kind === 'dry' ? '（--dry）' : '') + '\n');
      }
      continue;
    }
    if (!opts.asJson) process.stderr.write('[daily-sync] ' + def.label + ' …\n');
    let r;
    try {
      r = await def.fn(ctx);
    } catch (e) {
      r = { status: 'fail', detail: '未捕获异常：' + String((e && e.message) || e).slice(0, 120) };
    }
    rows.push(Object.assign(base, r || { status: 'fail', detail: '无返回' }));
    if (!opts.asJson) process.stderr.write('[daily-sync] ' + def.label + ' → ' + rows[rows.length - 1].status + '\n');
    if (base.critical && rows[rows.length - 1].status === 'fail') break;   // 服务不可用，后续无意义
  }

  // ---- 汇总（读接口与产物，不解析 stdout） ----
  const libRes = await httpJson('GET', '/api/library/stats', 10000);
  const lib = libRes.json || {};
  const mh = readProduct('mobilehub');
  const tr = readProduct('trainers');
  const sv = readProduct('saves');
  const pc = readProduct('phonecfg');

  const meta = {
    stamp: stamp(),
    health: (rows[0] && rows[0].status === 'ok') ? '✅ ' + rows[0].detail : '❌ 不可用',
    elapsed: fmtMs(Date.now() - t0),
    status: decideStatus(rows),
  };
  if (lib.total != null) {
    const sc = sourceCounts(lib);
    meta.libLine = '库总量 ' + lib.total + ' = xdgamer ' + (sc.xdgamer != null ? sc.xdgamer : '?') +
      ' + jidi ' + (sc.jidi != null ? sc.jidi : '?') +
      (lib.dual != null ? ' · 双料 ' + lib.dual : '');
  }
  const ba = [];
  if (mh && mh.builtAt) ba.push('mobilehub ' + shortTime(mh.builtAt));
  if (tr && tr.builtAt) ba.push('trainers ' + shortTime(tr.builtAt));
  if (sv && sv.builtAt) ba.push('saves ' + shortTime(sv.builtAt));
  if (pc && pc.builtAt) ba.push('phonecfg ' + shortTime(pc.builtAt));
  if (ba.length) meta.builtAtLine = '产物 builtAt：' + ba.join(' / ');

  const notes = [];
  // ★ 这一条**不依赖步骤是否真的跑过**：--dry 或 --skip=phonecfg 时也要能看见该阻塞，
  //   否则「体检模式」恰好漏掉最需要看见的那件事。
  if (!fs.existsSync(XLSX)) {
    const aged = (pc && pc.builtAt) ? shortTime(pc.builtAt) : '未知';
    notes.push('补回 ' + XLSX + '（该步已阻塞多日，其余步骤不受影响；phonecfg 仍 ' + aged + ' 版）');
  }
  const failed = rows.filter((r) => r.status === 'fail');
  if (failed.length) notes.push('失败步骤需人工看一眼：' + failed.map((r) => r.label).join('、'));
  if (rows.some((r) => r.key === 'phonecfg' && r.status === 'ok')) {
    notes.push('phonecfg 是启动时加载的只读索引 ⇒ 需重启服务才生效');
  }
  meta.notes = notes;

  let exitCode = 0;
  if (meta.status === 'DAILY_PARTIAL') exitCode = 2;
  if (meta.status === 'DAILY_FAIL') exitCode = 3;

  if (opts.asJson) {
    process.stdout.write(JSON.stringify({ status: meta.status, rows, meta, xlsxMissing: !fs.existsSync(XLSX) }, null, 2) + '\n');
  } else {
    process.stdout.write(buildSummary(rows, meta) + '\n');
  }
  process.exit(exitCode);
}

if (require.main === module) {
  main().catch((e) => {
    process.stdout.write('DAILY_FAIL\n未捕获异常：' + String((e && e.stack) || e).slice(0, 500) + '\n');
    process.exit(3);
  });
}

module.exports = {
  isTaskDone, dispWidth, padLabel, fmtDelta, decideStatus, tally, planStep, sourceCounts,
  buildSummary, readProduct, stamp, shortTime, fmtMs,
  STEP_DEFS, parseArgs,
};
