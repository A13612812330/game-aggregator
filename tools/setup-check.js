#!/usr/bin/env node
/**
 * setup-check.js —— 接手自检（`npm run doctor`）
 *
 * 为什么要有它：同事拿到仓库后最常见的四种「跑不起来」——
 *   ① Node 版本太低（cheerio 1.2 要 ≥20.18.1；跑测试还要 ≥22.22.2，因为 jsdom 30）
 *   ② 忘了 `npm install`（报 Cannot find module 'express'）
 *   ③ 8123 被占（上一个实例没退，日志里只有 EADDRINUSE 一行）
 *   ④ 没初始化后台账号（打开 /admin.html 一直停在登录页，不知道密码该从哪来）
 * 这四条都不会在 README 里写清楚，所以做成一条命令直接指出来。
 *
 * 原则：**只读**。不装依赖、不建目录、不改任何文件，跑多少遍都一样。
 *
 * 用法：
 *   node tools/setup-check.js            # 自检
 *   node tools/setup-check.js --handover # 自检 + 打印接手阅读顺序
 */
'use strict';
const fs = require('fs');
const path = require('path');
const net = require('net');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8123);

/* 两档要求：站点运行 vs 跑测试。刻意分开 —— 只浏览数据的人不需要 Node 22。 */
const NEED_RUN = [20, 18, 1];
const NEED_TEST = [22, 22, 2];

let bad = 0;
let warn = 0;
const line = (mark, name, detail) => {
  const m = mark === 'ok' ? '  ok  ' : mark === 'warn' ? ' warn ' : ' FAIL ';
  console.log('[' + m + '] ' + name.padEnd(26) + (detail || ''));
};
const ok = (n, d) => line('ok', n, d);
const wa = (n, d) => { warn++; line('warn', n, d); };
const no = (n, d) => { bad++; line('fail', n, d); };

const cur = process.versions.node.split('.').map(Number);
const cmp = (a, b) => {
  for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0); }
  return 0;
};
const v = (a) => a.join('.');

console.log('\n=== GH-Gamehub 接手自检 ===\n');

/* ---------- 1. Node 版本 ---------- */
if (cmp(cur, NEED_RUN) < 0) {
  no('Node 版本', 'v' + v(cur) + ' 太低，站点运行至少要 v' + v(NEED_RUN) + '（cheerio 1.2 要求）');
} else if (cmp(cur, NEED_TEST) < 0) {
  wa('Node 版本', 'v' + v(cur) + ' 能跑站点，但跑测试要 v' + v(NEED_TEST) + '+（jsdom 30 要求）');
} else {
  ok('Node 版本', 'v' + v(cur) + '  （运行与测试两档都满足）');
}

/* ---------- 2. 依赖 ---------- */
const dep = (name, optional) => {
  try { require.resolve(name, { paths: [ROOT] }); return true; } catch { return false; }
};
const runDeps = ['express', 'cheerio', 'js-yaml'];
const testDeps = ['jsdom', 'puppeteer-core'];
const missRun = runDeps.filter((d) => !dep(d));
const missTest = testDeps.filter((d) => !dep(d));

if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
  no('依赖安装', 'node_modules 不存在 —— 先跑 npm install');
} else if (missRun.length) {
  no('依赖安装', '缺运行依赖：' + missRun.join(' / ') + ' —— 跑 npm install');
} else {
  const pkg = (n) => { try { return require(n + '/package.json', { paths: [ROOT] }).version; } catch { return '?'; } };
  ok('依赖安装', runDeps.map((d) => d + '@' + pkg(d)).join('  '));
  if (missTest.length) wa('测试依赖', '缺 ' + missTest.join(' / ') + ' —— 只影响 npm test，不影响 npm start');
  else ok('测试依赖', testDeps.map((d) => d + '@' + pkg(d)).join('  '));
}

/* ---------- 3. 数据完整性 ----------
 * ★ 口径必须取自文件**自带的 stats**，不能自己数。
 *   原因：mods/saves/trainers 都是 `{ builtAt, stats, items }`，items 是**组**；
 *   而 README 写的是「组 / 条」两个数（如 MOD 360 组 / 7,825 条）。
 *   自己 `Object.keys(j).length` 数出来的是**字段数**（phonecfg 会得到 8），
 *   曾经就这样报过 1,025 与 README 的 1,030 对不上 —— 数字错了比不报更糟。
 *   这里优先读 stats 里的权威计数，读不到才退回 items 长度，并标注来源。 */
const readData = (f) => {
  try {
    const raw = fs.readFileSync(path.join(ROOT, 'data', f), 'utf8');
    const j = JSON.parse(raw);
    const st = j && j.stats;
    let detail;
    if (Array.isArray(j)) {
      detail = j.length.toLocaleString() + ' 条';
    } else if (st && typeof st.total === 'number') {
      detail = st.total.toLocaleString() + ' 条' +
        (f === 'mods.json' && st.byKind ? '（mod ' + st.byKind.mod + ' / 修改器 ' + st.byKind.modifier + '）' : '');
    } else if (st && typeof st.records === 'number') {
      detail = st.records.toLocaleString() + ' 条 / ' + (st.games || 0).toLocaleString() + ' 款游戏';
    } else if (Array.isArray(j.items)) {
      detail = j.items.length.toLocaleString() + ' 组（无 stats，按 items 计）';
    } else {
      detail = (Buffer.byteLength(raw) / 1024).toFixed(0) + ' KB（无 stats，仅验证可解析）';
    }
    return { ok: true, detail };
  } catch (e) {
    return { ok: false, detail: e.code === 'ENOENT' ? '文件不存在' : ('解析失败 ' + e.message.slice(0, 40)) };
  }
};
const dataFiles = ['games.json', 'mods.json', 'saves.json', 'trainers.json', 'phonecfg.json'];
const dataRows = dataFiles.map((f) => [f, readData(f)]);
const badData = dataRows.filter(([, r]) => !r.ok);
if (badData.length) {
  no('数据文件', badData.map(([f, r]) => 'data/' + f + ' ' + r.detail).join(' / '));
} else {
  ok('数据文件', dataRows.length + ' 个全部可解析');
  dataRows.forEach(([f, r]) => console.log('             · ' + f.replace('.json', '').padEnd(10) + r.detail));
}

/* ---------- 4. 页面齐全 ---------- */
const pages = ['index.html', 'resources.html', 'emulator.html', 'unpack.html', 'extract.html', 'admin.html'];
const missPage = pages.filter((p) => !fs.existsSync(path.join(ROOT, 'public', p)));
if (missPage.length) no('页面文件', '缺 public/' + missPage.join(' / public/'));
else ok('页面文件', pages.length + ' 张齐全（含 4 张派生页）');

/* ---------- 5. 端口占用 ---------- */
const probePort = (port) => new Promise((res) => {
  const s = net.createServer();
  s.once('error', (e) => res(e.code === 'EADDRINUSE' ? 'busy' : 'err:' + e.code));
  s.once('listening', () => s.close(() => res('free')));
  s.listen(port, '127.0.0.1');
});

/* ---------- 6. 后台账号 ---------- */
const accFile = path.join(ROOT, 'data', 'admin-account.json');
const hasAcc = fs.existsSync(accFile);

/* ---------- 7. 浏览器（可选，只给 --browser 套件用）---------- */
const browserHint = process.platform === 'win32'
  ? '由 GAMEHUB_BROWSER 指定，或自动找 Chrome/Edge 默认安装位置'
  : '非 Windows 需自行 GAMEHUB_BROWSER=/path/to/chrome';

(async () => {
  const p = await probePort(PORT);
  if (p === 'free') ok('端口 ' + PORT, '空闲，可以直接 npm start');
  else if (p === 'busy') wa('端口 ' + PORT, '已被占用 —— 用 PORT=8124 npm start 换一个，或先停掉旧实例');
  else wa('端口 ' + PORT, '无法探测（' + p + '），不影响启动');

  console.log('');
  if (hasAcc) ok('后台账号', 'data/admin-account.json 已存在');
  else wa('后台账号', '未初始化 —— 执行 npm run admin:init -- <用户名> <密码>');

  console.log('');
  ok('浏览器套件', browserHint);

  console.log('\n----------------------------------------');
  if (bad) {
    console.log('结论：' + bad + ' 项必须先修，' + warn + ' 项建议处理。见上方 FAIL 行。');
  } else if (warn) {
    console.log('结论：可以启动（0 项阻断，' + warn + ' 项建议处理）。');
  } else {
    console.log('结论：全部通过。执行 npm start 后打开 http://localhost:' + PORT + ' 。');
  }

  /* ★ 阅读顺序只在**有 HANDOVER.md 的仓库**里提示：
   *   开源交接库（GH-Gamehub）有这份文档，源仓库没有。
   *   同一个脚本两处共用 ⇒ 提示必须自适应，不能无条件喊「npm run handover」
   *   （源仓库既没有这个 npm 脚本、也没有那份文档，喊了就是误导）。 */
  const hasHandover = fs.existsSync(path.join(ROOT, 'HANDOVER.md'));
  if (process.argv.includes('--handover') && hasHandover) {
    console.log('\n接手阅读顺序');
    console.log('  1) HANDOVER.md   —— 架构分层（改哪里必须做什么）+ AI 技能清单 + 工具链索引');
    console.log('  2) README.md     —— 项目自述（注意 HANDOVER 第 9 节点名的过期数字）');
    console.log('  3) WORKFLOW.md   —— 开发流程与提交前必跑的防线');
    console.log('  4) PITFALLS.md   —— 229 条踩坑铁律，按序号查');
    console.log('  5) docs/versions/ —— 逐版变更（112 份，找具体功能从索引入手）');
    console.log('\n常用命令');
    console.log('  npm start            启动站点（默认 8123）');
    console.log('  npm test             静态防线 86 套，约 3~5 分钟');
    console.log('  npm run test:browser 追加浏览器实拍 14 套（一次只能跑一个）');
    console.log('  npm run test:sync    只验派生页与主源是否一致（58 条，约 2 秒）');
  } else if (hasHandover) {
    console.log('提示：node tools/setup-check.js --handover 可一并打印接手阅读顺序。');
  }
  console.log('');

  process.exitCode = bad ? 1 : 0;
})();
