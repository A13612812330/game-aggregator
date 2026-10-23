/**
 * tools/test-v1071-extract-page.js — 第二层（浏览器实拍）：验证「🗜️ 解压助手」页
 *
 * ★ v10.71 正式登记进 run-all.js 的 BROWSER（原先叫 tools/_probe-extract-page.js，手工探针）。
 *   需要服务在 8123；跑法：node tools/run-all.js --browser
 *
 * ★ 纪律（本项目既有）：
 *   ① 实拍必须对准**用户实际看到的那一屏**（1440 桌面 + 390 移动两档）；
 *   ② 不碰用户目录 —— 页面输入框虽然默认 Downloads\GameHub，但本探针改写成一个
 *      **项目内测试目录**再操作，避免验证过程往用户下载目录里写东西；
 *   ③ 断言要能回答「页面真的能用吗」，所以既查元素在不在，也真跑一次
 *      「扫描 → 递归解压 → 报告」的完整交互。
 *
 * 跑法：node tools/test-v1071-extract-page.js
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { connectBrowser, sleep } = require('./browser');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '_preview');
/* ★★ 工作目录**带 pid**（每次跑唯一）+ **不做递归删除** —— 原因见 PITFALLS 铁律 107：
   WorkBuddy 宿主安全删除守卫按「本 turn 累计删除文件数 > 50」拦 `rmSync`
   （实测全量跑时三个 v1071 套件累计 69 ⇒ 崩、单独跑却全绿 = **防线报假红**）。 */
/* ★★ v10.112：目录名在 pid 之后**再加一段随机后缀**（同族假红的预防，
   实测机制见 test-v1071-extractor.js 头部：PID 复用 ⇒ 命中上一轮目录 ⇒ 干净起点不成立）。 */
const WORK = path.join(ROOT, '_test-out',
  'v1071-page-' + process.pid + '-' + Math.random().toString(36).slice(2, 8));
const BASE = 'http://127.0.0.1:8123/extract.html';

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

let pass = 0, fail = 0;
const chk = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅ ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '   ' + extra : '')); }
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  /* ★★ 不做递归删除：目录按 pid 唯一，本身已是干净起点（原因见 WORK 定义处）。 */
  fs.mkdirSync(WORK, { recursive: true });

  /* 造三层嵌套样本，验证页面上真能看到「递归到第 3 层」 */
  fs.writeFileSync(path.join(WORK, 'leaf.txt'), 'PAGE_LEAF_v1071\n');
  await sh7z(['a', '-tzip', path.join(WORK, 'a1.zip'), path.join(WORK, 'leaf.txt')]);
  await sh7z(['a', '-tzip', path.join(WORK, 'a2.zip'), path.join(WORK, 'a1.zip')]);
  await sh7z(['a', '-tzip', path.join(WORK, 'a3.zip'), path.join(WORK, 'a2.zip')]);
  fs.rmSync(path.join(WORK, 'a1.zip'), { force: true });
  fs.rmSync(path.join(WORK, 'a2.zip'), { force: true });
  fs.rmSync(path.join(WORK, 'leaf.txt'), { force: true });
  chk('S0 阳性对照：样本 a3.zip（三层嵌套）造好了', fs.existsSync(path.join(WORK, 'a3.zip')));

  const h = await connectBrowser();
  const shots = [];

  try {
    for (const vp of [{ k: 'desktop', w: 1440, h: 1000 }, { k: 'mobile', w: 390, h: 844 }]) {
      const p = await h.browser.newPage();
      await p.setViewport({ width: vp.w, height: vp.h, deviceScaleFactor: 1 });
      const errs = [];
      p.on('pageerror', (e) => errs.push(String(e.message)));
      p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
      /* ★ 加上 URL：console 里的「Failed to load resource: 404」不带地址，
       *   只报文案等于没报 —— 排查时还得再跑一轮才能知道是哪个资源。 */
      p.on('response', (r) => { if (r.status() >= 400) errs.push('http ' + r.status() + ' ' + r.url()); });
      p.on('requestfailed', (r) => errs.push('reqfail ' + (r.failure() || {}).errorText + ' ' + r.url()));

      await p.goto(BASE, { waitUntil: 'domcontentloaded' });
      await sleep(1200);

      console.log('\n-- ' + vp.k + ' ' + vp.w + '×' + vp.h + ' --');

      /* ---------- 首屏结构 ---------- */
      const geo = await p.evaluate(() => {
        const g = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), t: Math.round(r.top) }; };
        return {
          env: g('#exEnv'), envText: (document.querySelector('#exEnv') || {}).textContent || '',
          card: g('.ex-card'), intro: g('.ex-intro'),
          urlInput: g('#exUrl'), goBtn: g('#exGoUrl'),
          tabs: document.querySelectorAll('.ex-tab').length,
          navCount: document.querySelectorAll('.main-nav a').length,
          navEx: !!document.querySelector('#navEx'),
          navExOn: /on/.test((document.querySelector('#navEx') || {}).className || ''),
          tabbarItems: document.querySelectorAll('.tabbar a').length,
          docW: document.documentElement.scrollWidth,
          viewportW: window.innerWidth,
          dims: document.querySelectorAll('.ex-dim').length,
        };
      });
      console.log('    环境条: ' + JSON.stringify(geo.envText.trim().slice(0, 60)));
      chk(vp.k + ' 环境条存在且显示 7z 状态', !!geo.env && /就绪|未就绪/.test(geo.envText), geo.envText.trim().slice(0, 46));
      chk(vp.k + ' 输入卡渲染', !!geo.urlInput && geo.urlInput.h > 24, 'input h=' + (geo.urlInput || {}).h);
      chk(vp.k + ' 两个输入 tab', geo.tabs === 2, 'tabs=' + geo.tabs);
      chk(vp.k + ' ★ 顶栏含 5 个入口且 #navEx 高亮（当前页）', geo.navCount === 5 && geo.navEx && geo.navExOn,
        'nav=' + geo.navCount + ' navEx=' + geo.navEx + ' on=' + geo.navExOn);
      chk(vp.k + ' 判定口径卡 6 条', geo.dims === 6, 'dims=' + geo.dims);
      chk(vp.k + ' ★ 无横向溢出', geo.docW <= geo.viewportW + 1, 'docW=' + geo.docW + ' vs ' + geo.viewportW);
      chk(vp.k + ' 无 JS 报错', errs.length === 0, errs.slice(0, 2).join(' | '));

      await p.screenshot({ path: path.join(OUT, 'extract-' + vp.k + '-top.png') });
      shots.push('extract-' + vp.k + '-top.png');

      /* ---------- 交互：切到文件夹 tab → 扫描 → 递归解压 ---------- */
      if (vp.k === 'desktop') {
        await p.evaluate(() => { document.querySelector('.ex-tab[data-m="dir"]').click(); });
        await sleep(300);
        const paneOk = await p.evaluate(() => !document.getElementById('exPaneDir').hidden && document.getElementById('exPaneUrl').hidden);
        chk('D1 切到「文件夹」tab 生效（面板互斥）', paneOk);

        /* ★ 改写输入框成项目内测试目录 —— 不碰用户 Downloads */
        await p.evaluate((dir) => { document.getElementById('exDir').value = dir; }, WORK);
        await p.evaluate(() => document.getElementById('exScanBtn').click());
        await sleep(1500);
        const scan = await p.evaluate(() => {
          const el = document.getElementById('exScanRes');
          return { html: el.innerHTML.length, items: el.querySelectorAll('.ex-scan-it').length, text: el.textContent.slice(0, 80) };
        });
        chk('D2 ★ 扫描出 1 个压缩包并渲染成列表', scan.items === 1, 'items=' + scan.items + ' | ' + scan.text.trim().slice(0, 50));
        await p.screenshot({ path: path.join(OUT, 'extract-desktop-scan.png') });
        shots.push('extract-desktop-scan.png');

        await p.evaluate(() => document.getElementById('exRunBtn').click());
        await sleep(1000);
        /* 等报告出现（最多 40s） */
        let report = null;
        for (let i = 0; i < 40; i++) {
          report = await p.evaluate(() => {
            const el = document.getElementById('exReport');
            const stats = Array.from(el.querySelectorAll('.ex-s')).map((s) => ({
              n: s.querySelector('b').textContent, lb: s.querySelector('span').textContent,
            }));
            return {
              has: el.innerHTML.length > 100,
              stats,
              layers: el.querySelectorAll('.ex-layer').length,
              okLayers: el.querySelectorAll('.ex-layer.ok').length,
              taskState: (document.querySelector('#exTask .badge') || {}).textContent || '',
              evCount: document.querySelectorAll('#exTask .ex-ev-it').length,
            };
          });
          if (report.has && report.layers) break;
          await sleep(1000);
        }
        console.log('    报告: layers=' + report.layers + ' ok=' + report.okLayers + ' 状态=' + report.taskState + ' 事件=' + report.evCount);
        console.log('    统计条: ' + JSON.stringify(report.stats));
        chk('D3 ★ 报告渲染出来（统计条 + 逐层明细）', report.has && report.layers >= 3, 'layers=' + report.layers);
        chk('D4 ★★ 三层全部解开（页面上看到递归到第 3 层）', report.okLayers >= 3, 'ok层=' + report.okLayers);
        chk('D5 任务状态显示已完成', /已完成/.test(report.taskState), report.taskState);
        chk('D6 事件流有逐层进展（用户能看到过程）', report.evCount >= 4, 'events=' + report.evCount);
        const leafOk = fs.existsSync(path.join(WORK, 'leaf.txt')) &&
          fs.readFileSync(path.join(WORK, 'leaf.txt'), 'utf8').includes('PAGE_LEAF_v1071');
        chk('D7 ★ 叶子文件真解出来了（端到端，不是只看界面）', leafOk);
        await p.screenshot({ path: path.join(OUT, 'extract-desktop-report.png'), fullPage: true });
        shots.push('extract-desktop-report.png');
      }

      if (vp.k === 'mobile') {
        const mb = await p.evaluate(() => {
          const nav = document.querySelector('.tabbar');
          const items = Array.from(nav.querySelectorAll('a'));
          return {
            n: items.length,
            overflow: nav.scrollWidth > nav.clientWidth + 1,
            labels: items.map((a) => (a.getAttribute('aria-label') || '').trim()),
            hasExtract: !!nav.querySelector('a[href="/extract.html"]'),
          };
        });
        chk('M1 ★ 底部 Tab 5 项且不溢出', mb.n === 5 && !mb.overflow, 'n=' + mb.n + ' overflow=' + mb.overflow + ' ' + JSON.stringify(mb.labels));
        chk('M2 底部 Tab 里有「解压」入口', mb.hasExtract);
      }

      await p.close();
    }
  } finally {
    await h.browser.close().catch(() => {});
  }

  console.log('\n  截图产物: ' + shots.join(', '));
  console.log('\n============================');
  /* ★ 收尾格式是约定（见 run-all 取成绩段）：同行含「通过」+ `n / m`，m 必须是**总数**。 */
  console.log('  通过 ' + pass + ' / ' + (pass + fail) + '（失败 ' + fail + '）');
  console.log('============================');
  process.exit(fail ? 1 : 0);
})();
