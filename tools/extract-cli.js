#!/usr/bin/env node
/* 桌面拖放用的递归解压 CLI（v10.71）
 *
 * 用法（把文件/文件夹直接拖到「解压助手-拖放.cmd」上也可以）：
 *   node tools/extract-cli.js <路径...> [--dest=目录] [--depth=5] [--pw=密码] [--no-open] [--json]
 *
 * 设计口径（三条，都是硬约束）：
 *   ① **解析逻辑只有一份** —— 全部走 data/extractor.js。这个文件只负责
 *      「收参数 → 调它 → 汇总 → 出报告」。绝不在 CLI 里重写一遍 7z 调用，
 *      否则站内页与桌面工具会各自漂移（本项目踩过「同一处已第 4 次欠账」）。
 *   ② **报告必出** —— 无论成功失败都要落一份 HTML 结果，否则拖放工具
 *      「弹结果窗」这条需求在失败路径上就直接失效了（而失败恰恰最需要看报告）。
 *   ③ **原地解压是默认** —— 压缩包本来就在磁盘上，解到它旁边最符合直觉；
 *      要改落点用 --dest。网上下载的那条通道才用 Downloads\GameHub。
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const EX = require('../data/extractor');
const RPT = require('./extract-report');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, '_extract-out');
const PAGE = require('./page-assets');   /* 只借语法闸门 */

/* ============================ 参数 ============================ */

function parseArgs(argv) {
  const o = { paths: [], dest: null, depth: 5, passwords: [], open: true, json: false };
  for (const a of argv) {
    if (a.startsWith('--dest=')) o.dest = a.slice(7);
    else if (a.startsWith('--depth=')) o.depth = Math.max(1, parseInt(a.slice(8), 10) || 5);
    else if (a.startsWith('--pw=')) o.passwords.push(a.slice(5));
    else if (a === '--no-open') o.open = false;
    else if (a === '--json') o.json = true;
    else if (a.startsWith('--')) { /* 未知参数忽略，不报错 —— 拖放场景不该因为多一个参数就整个失败 */ }
    else o.paths.push(a);
  }
  /* 拖放多个文件时 Windows 会给带引号的路径；去引号 + 去尾部分隔符 */
  o.paths = o.paths
    .map((p) => p.replace(/^"(.*)"$/, '$1').replace(/[\\/]+$/, ''))
    .filter(Boolean);
  return o;
}

/* ============================ 采集 ============================ */

/**
 * @returns {Promise<object>} 汇总报告（可直接喂 RPT.render）
 */
async function buildReport(o) {
  const env = await EX.envCheck();
  const rep = {
    title: 'GameHub 解压助手',
    at: new Date().toLocaleString('zh-CN', { hour12: false }),
    host: os.hostname(),
    exe: env.exe || '(未找到 7z)',
    version: (env.version || '').trim(),
    maxDepth: o.depth,
    destLabel: '',
    reportPath: '',
    rerunCommand: '',
    groups: [],
    needPassword: [],
    failures: [],
    stats: { archives: 0, layers: 0, deepest: 0, extracted: 0, nothingNew: 0, needPw: 0, failed: 0, files: 0 },
  };
  if (!env.ready) {
    rep.groups.push({ name: '(解压器不可用)', kind: 'file', layers: [], skipped: [], failures: [], needsPassword: [] });
    rep.failures.push({ file: '', name: '解压器不可用', depth: 0, reason: 'no-7z', err: env.hint || '' });
    rep.stats.failed = 1;
    return rep;
  }

  const inPlace = !o.dest;
  rep.destLabel = inPlace ? '原地解压（每个包解到它自己所在的目录）' : path.resolve(o.dest);

  const allNeedsPw = [];

  for (const target of o.paths) {
    const abs = path.resolve(target);
    let st;
    try { st = fs.statSync(abs); }
    catch (e) {
      rep.groups.push({ name: target, kind: 'file', layers: [], skipped: [], failures: [], needsPassword: [] });
      rep.failures.push({ file: abs, name: path.basename(abs), depth: 0, reason: '不存在或无法访问', err: String(e.code || e.message) });
      rep.stats.failed++;
      continue;
    }

    if (st.isDirectory()) {
      /* 文件夹：先扫出压缩包，再逐个解。
       * ★ scanDir 按魔数识别，不看扩展名。 */
      const found = EX.scanDir(abs, {});
      const g = {
        name: target, kind: 'dir', dir: abs,
        layers: [], skipped: [], failures: [], needsPassword: [],
        /* 数「这个来源里认出了几个包」。★ 不能用「有层就记 1」——实测一个目录里
         * 放了 a3.zip + locked.zip 两个包，那样会显示成「处理压缩包 1」。 */
        archives: found.length,
      };
      if (!found.length) {
        rep.groups.push(g);
        continue;
      }
      for (const f of found) {
        if (f.isVolume && !f.isFirstVolume) {
          g.skipped.push({ file: f.file, depth: 1, reason: 'volume-part' });
          continue;
        }
        const r = await EX.extractArchive(f.file, {
          destDir: o.dest ? path.resolve(o.dest) : abs,
          maxDepth: o.depth,
          passwords: o.passwords,
        });
        absorb(g, r, abs, rep);
      }
      allNeedsPw.push(...g.needsPassword);
      rep.groups.push(g);
    } else {
      const fmt = EX.sniff(abs);
      const g = { name: target, kind: 'file', dir: path.dirname(abs), archives: 0, layers: [], skipped: [], failures: [], needsPassword: [] };
      if (!fmt) {
        /* 不是压缩包 —— 如实说明，不静默跳过（拖错文件的用户需要知道原因） */
        g.skipped.push({ file: abs, depth: 1, reason: 'not-archive' });
        rep.groups.push(g);
        continue;
      }
      g.archives = 1;
      const r = await EX.extractArchive(abs, {
        destDir: o.dest ? path.resolve(o.dest) : path.dirname(abs),
        maxDepth: o.depth,
        passwords: o.passwords,
      });
      absorb(g, r, path.dirname(abs), rep);
      allNeedsPw.push(...g.needsPassword);
      rep.groups.push(g);
    }
  }

  /* 统计收口（全部从 groups 现算，不靠循环里累加 —— 少一处漂移点） */
  const layers = rep.groups.flatMap((g) => g.layers);
  rep.stats.archives = rep.groups.reduce((n, g) => n + (g.archives || 0), 0);
  rep.stats.layers = layers.length;
  rep.stats.deepest = layers.reduce((n, l) => Math.max(n, l.depth || 0), 0);
  rep.stats.extracted = layers.filter((l) => l.ok && !l.nothingNew).length;
  rep.stats.nothingNew = layers.filter((l) => l.ok && l.nothingNew).length;
  rep.stats.needPw = allNeedsPw.length;
  rep.stats.failed = rep.failures.length;
  rep.stats.files = new Set(rep.groups.flatMap((g) => g.final || [])).size;

  /* 「再次解压」命令：只带需要密码的那些包，避免连带重跑全部。
   * ★ 路径用双引号包住 —— 实测直链里的包名常含空格和中文（"Dynasty Warriors Origins Save 99%.rar"）。 */
  const rerun = allNeedsPw.map((x) => '"' + x.file + '"').join(' ');
  rep.rerunCommand = rerun
    ? 'node "' + path.join(ROOT, 'tools', 'extract-cli.js') + '" ' + rerun + ' --pw=你的密码'
    : '';

  return rep;
}

/** 把一个 extractArchive 的 report 并进某个来源分组 */
function absorb(g, r, baseDir, rep) {
  for (const l of r.layers) g.layers.push(l);
  for (const s of r.skipped) g.skipped.push(s);
  for (const f of r.failures) {
    g.failures.push(f);
    rep.failures.push(Object.assign({ group: g.name }, f));
  }
  for (const p of r.needsPassword) {
    g.needsPassword.push(Object.assign({ group: g.name }, p));
    rep.needPassword.push(Object.assign({ group: g.name }, p));
  }
  g.final = (g.final || []).concat(r.final || []);
}

/* ============================ 输出 ============================ */

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function openFile(file) {
  const cmd = process.platform === 'win32' ? 'cmd.exe' : (process.platform === 'darwin' ? 'open' : 'xdg-open');
  const args = process.platform === 'win32' ? ['/c', 'start', '', file] : [file];
  /* ★ stdin 必须 ignore（本项目铁律 38）：子进程挂 pipe 又没人读，父进程会被拖住不退出。
   * ⚠️ 这里**不传回调**，让 options 成为最后一个实参 —— 前置闸 check-stdio-guard 是按
   *   「最后一个实参是不是对象字面量」判的，写成 `(… , opts, () => {})` 会被判 UNKNOWN，
   *   得去登记例外；不传回调反而是更干净的形式（返回值本来就是 ChildProcess）。 */
  try {
    const cp = execFile(cmd, args, { stdio: 'ignore', windowsHide: true });
    cp.on('error', () => { /* 打不开就算了，路径已经打印在控制台 */ });
    cp.unref();
  } catch (e) { /* 同上 */ }
}

function consoleSummary(rep) {
  const s = rep.stats;
  const line = (k, v) => console.log('  ' + k.padEnd(10, ' ') + v);
  console.log('');
  console.log('  ── 汇总 ──────────────────────────────');
  line('处理包数', s.archives + ' 个');
  line('总层数', s.layers + '（最深 L' + s.deepest + '，上限 ' + rep.maxDepth + '）');
  line('解出内容', s.extracted + ' 层');
  line('未产出新文件', s.nothingNew + ' 层（已存在，7z -aos 跳过）');
  line('待解密', s.needPw + ' 个');
  line('失败', s.failed + ' 个');
  line('最终文件', s.files + ' 个');
  if (rep.needPassword.length) {
    console.log('');
    console.log('  🔒 需要密码的包：');
    for (const p of rep.needPassword) console.log('     L' + p.depth + '  ' + p.file);
    console.log('');
    console.log('  填上密码后重跑：');
    console.log('     ' + rep.rerunCommand);
  }
  if (rep.failures.length) {
    console.log('');
    console.log('  ✕ 失败：');
    for (const f of rep.failures) console.log('     L' + f.depth + '  ' + (f.file || f.name) + '  → ' + (f.reason || '') + (f.err ? ' · ' + f.err : ''));
  }
  console.log('');
}

async function main() {
  const o = parseArgs(process.argv.slice(2));

  if (!o.paths.length) {
    console.log('');
    console.log('  解压助手 · 递归解压（压缩包套压缩包一次解到底）');
    console.log('');
    console.log('  用法：把压缩包或文件夹【拖到「解压助手-拖放.cmd」上】，或命令行：');
    console.log('    node tools/extract-cli.js <路径...> [--dest=目录] [--depth=5] [--pw=密码] [--no-open]');
    console.log('');
    console.log('  落点默认「原地解压」（解到包自己所在的目录）。');
    console.log('');
    process.exitCode = 1;
    return;
  }

  let rep;
  try {
    rep = await buildReport(o);
  } catch (e) {
    /* 采集层崩了也要出报告 —— 需求是「拖进去要弹结果窗」，失败路径同样要弹。 */
    rep = {
      title: 'GameHub 解压助手', at: new Date().toLocaleString('zh-CN', { hour12: false }),
      host: os.hostname(), exe: '(未知)', version: '', maxDepth: o.depth,
      destLabel: o.dest ? path.resolve(o.dest) : '原地解压', reportPath: '', rerunCommand: '',
      groups: [], needPassword: [],
      failures: [{ file: '', name: '处理过程抛出异常', depth: 0, reason: 'exception', err: String(e && e.stack || e) }],
      stats: { archives: 0, layers: 0, deepest: 0, extracted: 0, nothingNew: 0, needPw: 0, failed: 1, files: 0 },
    };
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, 'extract-report-' + stamp() + '.html');
  rep.reportPath = outFile;

  const html = RPT.render(rep);
  /* ★ 出站自检：报告是可交付物，脚本编译不过 == 版式/交互坏了。
   *   同一条闸门（assertScriptSyntax）就是本轮修 extract.html 时补的。 */
  PAGE.assertScriptSyntax(html, 'extract-report.html');
  fs.writeFileSync(outFile, html, 'utf8');

  if (o.json) {
    console.log(JSON.stringify({ ok: rep.stats.failed === 0, report: outFile, stats: rep.stats,
      needPassword: rep.needPassword, failures: rep.failures, rerunCommand: rep.rerunCommand }, null, 2));
  } else {
    consoleSummary(rep);
    console.log('  报告：' + outFile);
    console.log('');
  }

  if (o.open) openFile(outFile);
  /* 有待解密或失败 ⇒ 退出码 3，让外层 .vbs/.cmd 能据此弹提示 */
  process.exitCode = rep.stats.failed ? 3 : (rep.stats.needPw ? 4 : 0);
}

main();
