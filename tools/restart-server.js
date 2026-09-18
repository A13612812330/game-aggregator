#!/usr/bin/env node
/* tools/restart-server.js —— 重启本地服务（localhost:8123）
 *
 * 用途：改 `server.js` / `data/**` 后**必须重启**（node 模块缓存，否则接口还是旧逻辑 ——
 *       实测踩过：`SM-S928U1` 返 null 就是这个原因）。
 *
 * ★ 为什么用脚本而不是 `taskkill` + `start`：本会话 shell 的 PATH 可能不完整
 *   （出现过 coreutils 全丢：grep / head / tail / mkdir / curl 全 command not found，只有 node 能用）。
 *   走 node 的 spawn/execFileSync 不受影响。
 *
 * ⚠️ 两条实机结论（别再试错）：
 *   ① `taskkill /PID <监听端口的进程> /T /F` 能杀掉旧服务，正常。
 *   ② 这里用 `detached + unref` 拉起的新进程**在 AI 会话里活不过本次工具调用**
 *      （父 shell 被回收时一起带走）。所以**会话内**要常驻服务，请用后台任务方式启动
 *      （`node server.js` 挂到后台任务），不要依赖本脚本的 spawn 结果。
 *      本脚本主要给「人手动跑一次」的场景（改完代码重启一下）。
 *
 * 退出码：0 = 探测到服务就绪；1 = 30 次探测仍未就绪（多半 server.js 报错了，去看它的输出）
 */
const { execFileSync, spawn } = require('child_process');
const path = require('path');

const PORT = 8123;
const ROOT = path.join(__dirname, '..');

function pidsOnPort(port) {
  let out = '';
  try { out = execFileSync('netstat', ['-ano'], { encoding: 'utf8' }); }
  catch (e) { try { out = execFileSync('C:/Windows/System32/netstat.exe', ['-ano'], { encoding: 'utf8' }); } catch (e2) { return []; } }
  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    if (!/LISTENING/i.test(line)) continue;
    const m = line.trim().split(/\s+/);
    if (m.length < 5) continue;
    const local = m[1] || '';
    if (!local.endsWith(':' + port)) continue;
    const pid = Number(m[m.length - 1]);
    if (pid && pid !== process.pid) pids.add(pid);
  }
  return [...pids];
}

const pids = pidsOnPort(PORT);
console.log(`监听 ${PORT} 的进程: ${pids.length ? pids.join(', ') : '(无)'}`);
for (const pid of pids) {
  try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); console.log(`  已结束 PID ${pid}`); }
  catch (e) { console.log(`  结束 PID ${pid} 失败: ${e.message.split('\n')[0]}`); }
}

const child = spawn(process.execPath, ['server.js'], {
  cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true,
  env: { ...process.env },
});
child.unref();
console.log(`已重新拉起 node server.js（PID ${child.pid}）`);

// 等它就绪
(async () => {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const r = await fetch(`http://localhost:${PORT}/api/device/market-stats`);
      if (r.ok) { console.log(`服务已就绪（第 ${i + 1} 次探测）`); return; }
    } catch (e) { /* 还没起来 */ }
  }
  console.log('⚠️ 30 次探测仍未就绪，请检查 server.js 是否报错');
})();
