/* tools/browser.js — 实拍套件共用的「拿一个浏览器」助手
 *
 * 为什么需要它（本机环境的三个硬约束，都踩过）：
 *   ① **Edge 在沙箱会话里启动即被拦**：连 `msedge.exe --version` 都无输出、退出码 0，
 *      puppeteer.launch 只会抛 `Failed to launch the browser process: Code: 0`，
 *      而且 stderr 是空的 —— 看起来像「浏览器坏了」，其实是进程被拦掉。
 *      Chrome 不受影响（同一台机器，`chrome.exe --headless=new` 正常出图）。
 *   ② **puppeteer.launch 自己 spawn 的进程也走不通**（换 Chrome 也一样）。
 *      可行路径是：用 shell 把 Chrome 带 `--remote-debugging-port` 拉起来，
 *      再用 `puppeteer.connect({browserURL})` 连上去 —— 绕开 launch 这条链。
 *   ③ **`/tmp` 和 `/dev/null` 在沙箱里不可靠**：`curl -o /dev/null` 会让
 *      `%{size_download}` 读成 0（曾把 275KB 的页面误判成空文件）。
 *      截图/下载一律写工作区内路径。
 *
 * 用法：
 *   const { connectBrowser } = require('./browser');
 *   const b = await connectBrowser();          // 自动复用 9222 上已开的实例
 *   ... 用完 await b.disconnect()（本模块 handle.close() 会顺手收掉自己拉的那个）
 *   await handle.close();
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const CANDIDATES = [
  'C:/Users/komo/AppData/Local/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const DEFAULT_PORT = 9222;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** CDP 调试端口是否已就绪 */
function cdpUp(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

/** 找一个真实存在的浏览器可执行文件（优先 Chrome，Edge 作兜底） */
function findBrowser() { return CANDIDATES.find((p) => fs.existsSync(p)) || null; }

/**
 * 连接（必要时先拉起）一个可调试的浏览器。
 * @returns {Promise<{browser:object, close:Function, spawned:boolean}>}
 */
async function connectBrowser(opt = {}) {
  const port = opt.port || DEFAULT_PORT;
  const root = opt.root || path.join(__dirname, '..');
  const puppeteer = require('puppeteer-core');
  let child = null;

  if (!(await cdpUp(port))) {
    const exe = findBrowser();
    if (!exe) throw new Error('未找到可用的 Chromium 内核浏览器（Chrome / Edge 均不在预期路径）');
    const profile = path.join(root, '.cache', 'chrome-preview');
    fs.mkdirSync(profile, { recursive: true });
    child = spawn(exe, [
      '--headless=new', '--no-sandbox', '--disable-gpu',
      `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
      `--window-size=${opt.window || '1440,1100'}`, 'about:blank',
    ], { detached: true, stdio: 'ignore' });
    child.unref();
    for (let i = 0; i < 24 && !(await cdpUp(port)); i++) await sleep(500);
    if (!(await cdpUp(port))) throw new Error(`浏览器 CDP 端口 ${port} 未就绪（${exe}）`);
  }

  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` });
  return {
    browser,
    spawned: !!child,
    close: async () => {
      try { await browser.disconnect(); } catch (e) { /* 已断开 */ }
      if (child) { try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) {} }
    },
  };
}

/** 建一个已设好视口的页面，并把 pageerror 收集到 errs 数组里 */
async function newPage(browser, { width = 1440, height = 1100, scale = 1 } = {}) {
  const p = await browser.newPage();
  await p.setViewport({ width, height, deviceScaleFactor: scale });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.errs = errs;
  return p;
}

/**
 * `puppeteer.launch()` 的等价替身（返回 browser 对象），给已有套件做**一行替换**用：
 *     - const b = await puppeteer.launch({ executablePath: exe, headless: true, args: [...] });
 *     + const b = await launchBrowser();
 * 之后的 `b.newPage()` / `b.close()` 用法完全不变（close 会连带收掉拉起的进程）。
 * 存在的意义：puppeteer 自己的 spawn 链在本机沙箱里走不通（见文件头 ①②）。
 */
async function launchBrowser() {
  const h = await connectBrowser();
  return h.browser;
}

module.exports = { connectBrowser, launchBrowser, newPage, findBrowser, cdpUp, sleep, DEFAULT_PORT };
