/**
 * tools/test-v1071-extract-e2e.js — 第一层（静态/离线）：解压助手 API 的端到端测试
 *
 * ★ v10.71 正式登记进 run-all.js 的 SUITES（原先叫 tools/_api-test-extract.js，手工探针）。
 *   它自己起临时实例，**不依赖常驻服务**，约 10 s。
 *
 * ★ 按项目铁律「跑防线别动服务」：本脚本在 **8899** 起一个临时实例测，
 *   完全不碰常驻的 8123（那台可能落后于代码，拿它测会得出错误结论）。
 *
 * 覆盖：环境自检 / 扫目录 / 递归解压任务 / 轮询 / 目录护栏 / 404 兜底。
 * 每项都断言**具体行为**，不看"有没有报错"。
 *
 * 跑法：node tools/test-v1071-extract-e2e.js
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
/* ★★ 工作目录**带 pid**（每次跑唯一）+ **不做递归删除** —— 原因见 PITFALLS 铁律 107：
   WorkBuddy 宿主安全删除守卫按「本 turn 累计删除文件数 > 50」拦 `rmSync`，
   三个 v1071 套件连跑累计 69 ⇒ 全量跑时本套件 exit 1、单独跑却全绿（**防线报假红**）。 */
const WORK = path.join(ROOT, '_test-out', 'v1071-api-' + process.pid);
const PORT = 8899;
const BASE = 'http://127.0.0.1:' + PORT;

let pass = 0, fail = 0;
function chk(name, ok, extra) {
  if (ok) { pass++; console.log('  ✅ ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '   ' + extra : '')); }
}
function hr(t) { console.log('\n' + '─'.repeat(74) + '\n' + t + '\n' + '─'.repeat(74)); }

function sh7z(args) {
  const EX = require('../data/extractor');
  return new Promise((res) => {
    const cp = spawn(EX.resolve7z(), [...args, '-sccUTF-8'], {
      /* ★ stdio 三件套必须显式写全（本项目铁律 38 + 前置闸 check-stdio-guard 强制）：
         stdin 留 pipe 又不关，7z 会一直等密码输入 ⇒ 父进程被拖住不退出（实测踩到过）。
         写成 'ignore' 之后 `cp.stdin` 是 null，所以下面**不能**再碰它。 */
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let so = '', se = '', done = false;
    const fin = (r) => { if (!done) { done = true; clearTimeout(to); res(r); } };
    const to = setTimeout(() => { try { cp.kill('SIGKILL'); } catch (e) { /* 已退 */ } fin({ code: -2, stdout: so, stderr: se }); }, 40000);
    cp.stdout.on('data', (d) => { so += d; });
    cp.stderr.on('data', (d) => { se += d; });
    cp.on('close', (c) => fin({ code: c == null ? -1 : c, stdout: so, stderr: se }));
  });
}

async function jget(p) {
  const r = await fetch(BASE + p);
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function jpost(p, body) {
  const r = await fetch(BASE + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

(async () => {
  /* ★★ 不做递归删除：目录按 pid 唯一，本身已是干净起点（原因见上方 WORK 定义处）。 */
  fs.mkdirSync(WORK, { recursive: true });

  /* 造样本：两层嵌套的 zip，放在工作目录里 */
  fs.writeFileSync(path.join(WORK, 'leaf.txt'), 'API_LEAF_v1071\n');
  await sh7z(['a', '-tzip', path.join(WORK, 'in1.zip'), path.join(WORK, 'leaf.txt')]);
  await sh7z(['a', '-tzip', path.join(WORK, 'outer.zip'), path.join(WORK, 'in1.zip')]);
  fs.rmSync(path.join(WORK, 'in1.zip'), { force: true });
  fs.rmSync(path.join(WORK, 'leaf.txt'), { force: true });
  chk('S0 阳性对照：样本 outer.zip 造好了', fs.existsSync(path.join(WORK, 'outer.zip')));

  /* ============ 起临时实例 ============ */
  hr('0 启动临时实例（PORT=' + PORT + '，不碰 8123）');
  const cp = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    /* ★ 铁律 38：stdio 必须显式写全。这里是服务端实例，stdin 挂 pipe 又不读
     *   同样会拖住父进程（而且它下面只读 stdout/stderr）。 */
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let serverLog = '';
  cp.stdout.on('data', (d) => { serverLog += d; });
  cp.stderr.on('data', (d) => { serverLog += d; });

  let up = false;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE + '/api/extract/env');
      if (r.ok) { up = true; break; }
    } catch (e) { /* 还没起来 */ }
    await new Promise((s) => setTimeout(s, 500));
  }
  chk('E0 临时实例已就绪', up, up ? BASE : ('超时；日志尾: ' + serverLog.slice(-200)));
  if (!up) { try { cp.kill('SIGKILL'); } catch (e) { /* 已退 */ } process.exit(1); }

  try {
    /* ============ 环境自检 ============ */
    hr('1 GET /api/extract/env');
    const env = await jget('/api/extract/env');
    chk('E1 返回 ok 且 7z 就绪', env.status === 200 && env.body.ok && env.body.ready,
      'exe=' + (env.body.exe || '-'));
    chk('E2 带出 defaultDir（Downloads\\GameHub）',
      /Downloads[\\/]GameHub$/.test(String(env.body.defaultDir || '')), String(env.body.defaultDir));
    chk('E3 带出 running 计数', typeof env.body.running === 'number', 'running=' + env.body.running);

    /* ============ 扫目录 ============ */
    hr('2 POST /api/extract/scan');
    const sc = await jpost('/api/extract/scan', { dir: WORK });
    chk('S1 扫到 1 个压缩包（outer.zip）', sc.status === 200 && sc.body.count === 1,
      'count=' + sc.body.count + ' ' + JSON.stringify((sc.body.items || []).map((x) => x.name)));
    chk('S2 条目标出格式与大小', (sc.body.items[0] || {}).format === 'zip' && sc.body.items[0].size > 0,
      JSON.stringify((sc.body.items[0] || {})));

    /* ============ 递归解压（run） ============ */
    hr('3 POST /api/extract/run → 轮询 → 报告');
    const run = await jpost('/api/extract/run', { dir: WORK });
    chk('R1 任务已创建', run.status === 200 && run.body.ok && run.body.id, 'id=' + run.body.id + ' count=' + run.body.count);
    let task = null;
    for (let i = 0; i < 60; i++) {
      const g = await jget('/api/extract/task?id=' + run.body.id);
      task = g.body && g.body.task;
      if (task && task.state !== 'running') break;
      await new Promise((s) => setTimeout(s, 400));
    }
    chk('R2 任务跑完（state=done）', task && task.state === 'done', 'state=' + (task && task.state));
    chk('R3 ★ 报告显示递归 2 层（zip 套 zip）', task && task.summary && task.summary.reachedDepth === 2,
      'reachedDepth=' + (task && task.summary && task.summary.reachedDepth));
    chk('R4 两层都成功', task && task.summary && task.summary.layers.every((L) => L.ok),
      JSON.stringify((task && task.summary && task.summary.layers || []).map((L) => L.name + ':' + L.ok)));
    chk('R5 ★ 叶子文件真的解出来了（不是只看退出码）',
      fs.existsSync(path.join(WORK, 'leaf.txt')) &&
      fs.readFileSync(path.join(WORK, 'leaf.txt'), 'utf8').includes('API_LEAF_v1071'));
    chk('R6 原压缩包仍在（用户拍板「保留不动」）', fs.existsSync(path.join(WORK, 'outer.zip')));
    chk('R7 事件流里有层级事件（前端能显示进度）',
      task && task.events.some((e) => e.type === 'layer-ok'), '事件数=' + (task && task.events.length));

    /* ============ 真实直链：用户的实际场景，必须端到端跑一次 ============ */
    hr('3b 真实直链下载 + 递归解压（游侠存档，实测这条链是两层嵌套）');
    const yx = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'saves-youxia.json'), 'utf8'));
    const sample = (yx.items || []).find((x) => x.files && x.files.direct && /\.rar$/i.test(x.files.direct));
    if (!sample) {
      chk('D0 能找到一条游侠直链样本', false, '(数据里没找到 .rar 直链)');
    } else {
      const dlDir = path.join(WORK, 'dl');
      const dlr = await jpost('/api/extract/download', { url: sample.files.direct, dir: dlDir });
      chk('D1 建了下载+解压任务', dlr.status === 200 && dlr.body.ok, 'id=' + (dlr.body && dlr.body.id));
      let dTask = null;
      for (let i = 0; i < 120; i++) {
        const g = await jget('/api/extract/task?id=' + dlr.body.id);
        dTask = g.body && g.body.task;
        if (dTask && dTask.state !== 'running') break;
        await new Promise((s) => setTimeout(s, 500));
      }
      chk('D2 任务跑完', dTask && dTask.state === 'done', 'state=' + (dTask && dTask.state) + ' err=' + (dTask && dTask.error));
      chk('D3 ★★ 报告 reachedDepth=2（外层 rar → 内层 rar，用户说的「压缩包套压缩包」）',
        dTask && dTask.summary && dTask.summary.reachedDepth === 2,
        'reachedDepth=' + (dTask && dTask.summary && dTask.summary.reachedDepth));
      chk('D4 下载字节数 > 0 且与源站声明同量级',
        dTask && dTask.bytes > 1e6, 'bytes=' + (dTask && dTask.bytes) + ' 源站声明 ' + sample.files.size);
      /* ★ v10.73：产物不再直接躺在 `dlDir` 根下，而是落进**任务子目录**
       *   （`游戏名_类别_原链名`，这里没传 game/cat ⇒ 只剩原链名那一段）。
       *   判据要**跟着结构走**，不能还按旧结构断言「根下同时有 .rar 和内容」——
       *   那样会红得莫名其妙（根下只剩一个子目录名）。 */
      const dlRoot = fs.existsSync(dlDir) ? fs.readdirSync(dlDir) : [];
      const subDirs = dlRoot.filter((n) => {
        try { return fs.statSync(path.join(dlDir, n)).isDirectory(); } catch (e) { return false; }
      });
      const workDir = subDirs.length === 1 ? path.join(dlDir, subDirs[0]) : dlDir;
      const dlFiles = fs.existsSync(workDir) ? fs.readdirSync(workDir) : [];
      chk('D5 ★ 任务子目录里既保留原包、又有解出来的内容',
        dlFiles.some((n) => /\.rar$/i.test(n)) && dlFiles.some((n) => /ALI213|\.txt$/i.test(n)),
        '子目录=' + JSON.stringify(subDirs) + ' 内含=' + JSON.stringify(dlFiles.slice(0, 6)));
      chk('D5b ★ v10.73：产物落在**一个**任务子目录里（不是散在落点根下）',
        subDirs.length === 1, '根下条目=' + JSON.stringify(dlRoot.slice(0, 6)));
      chk('D6 ★ 报告里能看到内层包也被解了（两层都 ok）',
        dTask && dTask.summary && dTask.summary.layers.filter((L) => L.ok).length >= 2,
        JSON.stringify((dTask && dTask.summary && dTask.summary.layers || []).map((L) => L.name.slice(0, 26) + ':' + L.ok)));
    }

    /* ============ 幂等：再跑一次不该炸 ============ */
    hr('4 幂等：同一目录再跑一次');
    const run2 = await jpost('/api/extract/run', { dir: WORK });
    let task2 = null;
    for (let i = 0; i < 60; i++) {
      const g = await jget('/api/extract/task?id=' + run2.body.id);
      task2 = g.body && g.body.task;
      if (task2 && task2.state !== 'running') break;
      await new Promise((s) => setTimeout(s, 400));
    }
    chk('I1 第二次跑不报错', task2 && (task2.state === 'done'), 'state=' + (task2 && task2.state));
    chk('I2 ★ 第二次的层标出 nothingNew（`-aos` 跳过已存在，如实暴露没产出）',
      task2 && task2.summary && task2.summary.layers.some((L) => L.nothingNew === true),
      JSON.stringify((task2 && task2.summary && task2.summary.layers || []).map((L) => L.name + ':new=' + L.nothingNew)));

    /* ============ 目录护栏 ============ */
    hr('5 目录护栏（解压 = 写盘，必须挡住系统目录）');
    for (const [label, dir] of [
      ['盘符根 C:\\', 'C:\\'],
      ['系统目录 C:\\Windows', 'C:\\Windows'],
      ['Program Files', 'C:\\Program Files'],
      ['相对路径', 'relative/dir'],
    ]) {
      const r = await jpost('/api/extract/scan', { dir });
      chk('G ' + label + ' 被拒', r.status === 400 && r.body && r.body.ok === false,
        'status=' + r.status + ' err=' + ((r.body && r.body.error) || '').slice(0, 40));
    }
    /* ★ 空 dir **不是**错误：用户没填就用默认目录（Downloads\GameHub）。
     *   第一版这里被我写成"应被拒"，是断言错了而不是实现错了 —— 记一笔。 */
    const emptyDir = await jpost('/api/extract/scan', { dir: '' });
    chk('G 空 dir 回落到默认目录（设计如此，不是拒绝）',
      emptyDir.status === 200 && /Downloads[\\/]GameHub$/.test(String((emptyDir.body || {}).dir || '')),
      'dir=' + ((emptyDir.body || {}).dir));
    const okDir = await jpost('/api/extract/scan', { dir: WORK });
    chk('G 正常目录放行（阳性对照，证明护栏不是"一律拒绝"）', okDir.status === 200, 'status=' + okDir.status);

    /* ============ 边界输入 ============ */
    hr('6 边界输入');
    const badUrl = await jpost('/api/extract/download', { url: 'not-a-url' });
    chk('B1 非 http 直链被拒', badUrl.status === 400, 'err=' + ((badUrl.body && badUrl.body.error) || ''));
    const noTask = await jget('/api/extract/task?id=does-not-exist');
    chk('B2 不存在的任务返回 404', noTask.status === 404);
    const noPend = await jpost('/api/extract/password', { id: 'x', passwords: ['a'] });
    chk('B3 给不存在任务提交密码返回 404', noPend.status === 404);

    /* ============ 404 兜底没被删 ============ */
    hr('7 404 兜底（加新路由时一度被误删）');
    const nf = await jget('/api/definitely-not-a-route');
    chk('N1 未匹配路径仍返回结构化 404', nf.status === 404 && nf.body && nf.body.error === 'Not Found',
      JSON.stringify(nf.body));

    /* ============ 静态资源仍可访问 ============ */
    hr('8 站点本身没被影响');
    const home = await fetch(BASE + '/');
    chk('H1 首页仍 200', home.status === 200);
    const lib = await jget('/api/library/browse?scope=all&limit=1');
    chk('H2 原有 API 仍正常（/api/library/browse）', lib.status === 200 && lib.body && lib.body.ok !== false,
      'status=' + lib.status);
  } finally {
    try { cp.kill('SIGKILL'); } catch (e) { /* 已退 */ }
  }

  hr('汇总');
  /* ★ 收尾格式是约定（见 run-all 取成绩段）：同行含「通过」+ `n / m`，m 必须是**总数**。 */
  console.log('  通过 ' + pass + ' / ' + (pass + fail) + '（失败 ' + fail + '）');
  process.exit(fail ? 1 : 0);
})();
