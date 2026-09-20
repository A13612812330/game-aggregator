#!/usr/bin/env node
/**
 * tools/test-launcher.js — 守住「双击启动器三件套」（v10.25 新增）
 *
 * ★ 为什么要有它（2026-09-20 实测）：
 *   启动器是**用户日常唯一入口**，但此前**没有任何套件覆盖它** —— 于是下面这类故障
 *   可以一直躺着不报错：
 *     ① `.cmd` 与 `.vbs` 都把 managed node 回退路径**写死**成
 *        `…\node\versions\22.22.2-2\node.exe`，而真实目录早已是 `22.22.2-3`
 *        （managed 运行时带一个**构建后缀**，升级就变）⇒ 回退分支**永久失效**且不报错。
 *     ② 9-04 的旧 `启动聚合站.bat` 同时踩了两个坑：路径写 `C://Users//…//22.22.2//`
 *        （双斜杠 + 版本号漏后缀）+ **没有幂等启动** ⇒ 重复双击会起出 8124/8125 一串实例
 *        （`server.js` 的 `listen(port + 1, …)` 兜底会一路自增，实测最多 30 次）。
 *
 * ★ 本套件把「启动器为什么会坏」的每一环都钉死，重点在**可执行的判据**而不是字符串存在性：
 *   · 幂等启动：端口正则必须带**尾随空格**（否则 `:8123` 会命中 `:81230`），
 *     并用真实 netstat 样本**证明**松写法会多匹配一行（不是「看起来对」）。
 *   · node 探测：**禁止硬编码版本目录**；并把 `.cmd`（`dir /o-n` 倒序取首个）
 *     与 `.vbs`（字典序取最大）两套算法**在 JS 里各跑一遍**，断言选出的路径真实存在。
 *   · 编码安全：`.cmd` / `.vbs` / `stop-*.cmd` 的源码必须是纯 ASCII
 *     （VBScript 按 ANSI 解析源文件、`.cmd` 的中文 echo 会乱码）。
 *   · 单一出处：`打开线上版.url` 与 `.cmd` 的 `WEB=` 必须与 `report.js` 的 `LINKS.LIVE` 相等
 *     —— 换链接时漏改任一处就变红（本项目「同一语义只留一份」的既有铁律）。
 *
 * 离线可跑：只读文件 + 跑一次目录扫描，不联网、不需服务在跑。
 */

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const ok = (c, m, extra) => {
  if (c) { pass++; console.log('  \u2713 ' + m + (extra ? '  [' + extra + ']' : '')); }
  else { fail++; console.log('  \u2717 FAIL: ' + m + (extra ? '  [' + extra + ']' : '')); }
};

const read = (p) => { try { return fs.readFileSync(path.join(ROOT, p), 'utf8'); } catch (e) { return ''; } };
const CMD = read('启动聚合站.cmd');
const VBS = read('启动聚合站-静默.vbs');
const STOP = read('stop-gamehub.cmd');
const URLF = read('打开线上版.url');
const SRV = read('server.js');
const REP = read('tools/report.js');
const ASCII = /^[\x00-\x7F]*$/;

/* ==================== A. 幂等启动 ==================== */
console.log('=== A. 幂等启动（重复双击不能起出第二个实例）===');
ok(CMD.length > 500, '.cmd 存在且有实质内容', CMD.length + 'B');
ok(VBS.length > 500, '.vbs 存在且有实质内容', VBS.length + 'B');

ok(/netstat -ano \^\| findstr \/R \/C:":%PORT% \.\*LISTENING"/.test(CMD),
  '\u2605 .cmd 探测占用：端口正则**带尾随空格**（防命中 81230）');
ok(/if not defined RUNPID/.test(CMD),
  '\u2605 .cmd 取首个 PID 用 `if not defined`（避免块内 `!X!` 延迟展开的坑）');
ok(/start "" "%URL%"[\s\S]{0,200}exit \/b 0/.test(CMD),
  '\u2605 .cmd 已在跑 ⇒ 只开浏览器 + `exit /b 0`（不起第二个实例）');

ok(/Function PortBusy\(p\)/.test(VBS) && /If PortBusy\(PORT\) Then/.test(VBS),
  '\u2605 .vbs 有 PortBusy 检测且在启动前提前退出');
ok(/"LISTENING"/.test(VBS) && /":" & p & " "/.test(VBS),
  '\u2605 .vbs 的端口判据同样带尾随空格（`":" & p & " "`）');

/* 用真实 netstat 样本**证明**尾随空格是必要的 —— 不是「看起来对」 */
const NET_SAMPLE = [
  '  TCP    0.0.0.0:8123           0.0.0.0:0              LISTENING       25340',
  '  TCP    [::]:8123              [::]:0                 LISTENING       25340',
  '  TCP    0.0.0.0:81230          0.0.0.0:0              LISTENING       99999',
].join('\n');
const loose = NET_SAMPLE.split('\n').filter((l) => /:8123.*LISTENING/.test(l)).length;
const strict = NET_SAMPLE.split('\n').filter((l) => /:8123 .*LISTENING/.test(l)).length;
ok(strict === 2 && loose === 3,
  '\u2605 反证「尾随空格」的必要性：松写法会多命中 `:81230` 一行', 'strict=' + strict + ' loose=' + loose);

/* ==================== B. node 定位（双保险 + 不写死版本号） ==================== */
console.log('\n=== B. node 定位：PATH 优先，回退路径**不写死版本号** ===');
ok(/where node >nul 2>nul && set "NODE=node"/.test(CMD), '.cmd 先试 PATH（`where node`）');
ok(/node server.js/.test(VBS), '.vbs 有 PATH 兜底（`node server.js`）');

ok(!/versions[\\/]+22\.\d/.test(CMD), '\u2605 .cmd 里**没有**硬编码版本目录（`versions\\22.x`）');
ok(!/versions[\\/]+22\.\d/.test(VBS), '\u2605 .vbs 里**没有**硬编码版本目录（`versions\\22.x`）');
ok(!/C:\\Users\\komo/i.test(CMD) && !/C:\\Users\\komo/i.test(VBS),
  '\u2605 不写死盘符路径（改用 `%USERPROFILE%`，换机器/改用户名不坏');
ok(/%USERPROFILE%/.test(CMD) && /ExpandEnvironmentStrings\("%USERPROFILE%"\)/.test(VBS),
  '两个脚本都用 `%USERPROFILE%` 取用户目录');

ok(/dir \/b \/ad \/o-n "%VBASE%"/.test(CMD),
  '\u2605 .cmd 用 `dir /b /ad /o-n`（目录名倒序）扫描 managed 运行时');
ok(/SubFolders/.test(VBS) && /If f\.Name > best Then best = f\.Name/.test(VBS),
  '\u2605 .vbs 用「字典序取最大」扫描 managed 运行时');

/* 把两套算法**真的各跑一遍**，断言选出的路径当前存在 —— 这是能抓「版本漂移」的那条 */
const VBASE = path.join(process.env.USERPROFILE || process.env.HOME || '', '.workbuddy', 'binaries', 'node', 'versions');
const subs = (() => { try { return fs.readdirSync(VBASE, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch (e) { return []; } })();
const hasNode = (d) => fs.existsSync(path.join(VBASE, d, 'node.exe'));

const cmdPick = [...subs].sort().reverse().find(hasNode) || '';
ok(!!cmdPick, '\u2605 [.cmd 算法实跑] `dir /o-n` 倒序首个命中 = ' + (cmdPick || '(无)'),
  cmdPick ? path.join(VBASE, cmdPick, 'node.exe') : '目录不存在');
let vbsBest = '';
for (const d of subs) if (hasNode(d) && d > vbsBest) vbsBest = d;
ok(!!vbsBest, '\u2605 [.vbs 算法实跑] 字典序最大命中 = ' + (vbsBest || '(无)'));
ok(cmdPick === vbsBest, '\u2605 两套算法结论**一致**（不一致 ⇒ 两个入口可能用不同 node）',
  cmdPick + ' vs ' + vbsBest);
ok(!!fs.existsSync(path.join(VBASE, cmdPick, 'node.exe')),
  '\u2605 选出的 node.exe **当前真实存在**（版本漂移就会被这条抓住）');

/* 为什么必须有回退：server.js 有端口自增兜底 ⇒ 多实例会一路 8124/8125 */
ok(/listen\(port \+ 1, triesLeft - 1\)/.test(SRV),
  '\u2605 [前提] server.js 有端口自增兜底 ⇒ 无幂等启动会静默起出一串实例');
ok(/let\b.*NODE|set "NODE="/.test(CMD), '.cmd 用变量承载 node 路径（不散落多处）');

/* ==================== C. 编码与引号安全 ==================== */
console.log('\n=== C. 编码 / 引号安全（乱码与解析失败的高发区）===');
ok(ASCII.test(CMD), '\u2605 .cmd 源码纯 ASCII（中文只出现在文件名上，避免 echo 乱码）');
ok(ASCII.test(VBS), '\u2605 .vbs 源码纯 ASCII（VBScript 按 ANSI 解析源文件，UTF-8 中文会乱码）');
ok(ASCII.test(STOP), '\u2605 stop 脚本纯 ASCII');
ok(/shell\.CurrentDirectory\s*=\s*root/.test(VBS),
  '\u2605 .vbs 用 `CurrentDirectory` 设工作目录，**不拼** `cd /d`（中文路径 + 引号嵌套会翻车）');
ok(!/cd \/d[\s\S]{0,40}Chr\(34\)/.test(VBS), '\u2605 .vbs 里没有 `cd /d` + 引号拼接的写法');
ok(/Chr\(34\) & nodeExe & Chr\(34\)/.test(VBS), '.vbs 用 `Chr(34)` 给 node 路径加引号');
ok(/cd \/d "%~dp0"/.test(CMD) && /cd \/d "%~dp0"/.test(STOP),
  '.cmd / stop 用 `%~dp0` 定位自身目录（双击时工作目录未必是项目根）');

/* ==================== D. 停止脚本 ==================== */
console.log('\n=== D. 停止脚本（按端口杀 PID，且幂等）===');
ok(/tokens=5/.test(STOP) && /taskkill \/PID %%P \/F/.test(STOP),
  '\u2605 stop 用 `tokens=5` 取 PID 并 `taskkill /F`');
ok(/nothing is listening on port/.test(STOP), 'stop 幂等：没在跑时明确报「nothing is listening」');
ok(ASCII.test(path.basename('stop-gamehub.cmd')), 'stop 文件名是 ASCII（.cmd 提示文字里会引用它）');

/* ==================== E. 端口单一出处 ==================== */
console.log('\n=== E. 端口一致性（四个文件必须指向同一个 8123）===');
const pCmd = (CMD.match(/set "PORT=(\d+)"/) || [])[1] || '';
const pVbs = (VBS.match(/Const PORT = (\d+)/) || [])[1] || '';
const pStop = (STOP.match(/set "PORT=(\d+)"/) || [])[1] || '';
const pSrv = (SRV.match(/parseInt\(process\.env\.PORT, 10\) \|\| (\d+)/) || [])[1] || '';
ok(pCmd && pVbs && pStop && pSrv, '四个文件都抠到了端口号（抠不到 ⇒ 下面几条恒真 = 假绿）',
  [pCmd, pVbs, pStop, pSrv].join('/'));
ok(pCmd === pVbs && pVbs === pStop && pStop === pSrv,
  '\u2605 .cmd / .vbs / stop / server.js 的端口**完全一致**');

/* ==================== F. 线上链接单一出处 ==================== */
console.log('\n=== F. 线上链接：三处必须同源（换链接漏改一处即变红）===');
const LIVE = ((REP.match(/LIVE:\s*'(https:\/\/[^']+)'/) || [])[1] || '');
ok(!!LIVE, '\u2605 从 report.js 抠出 LIVE（抠不到 ⇒ 下面两条恒真 = 假绿）', LIVE);
ok(new RegExp('^\\[InternetShortcut\\]', 'm').test(URLF) && /^URL=/m.test(URLF),
  '打开线上版.url 是合法的 InternetShortcut 格式');
const urlfUrl = (URLF.match(/^URL=(.+)$/m) || [])[1] || '';
ok(urlfUrl.trim() === LIVE, '\u2605 「打开线上版.url」== report.js 的 LIVE', urlfUrl.trim());
const cmdWeb = (CMD.match(/set "WEB=([^"]+)"/) || [])[1] || '';
ok(cmdWeb.trim() === LIVE, '\u2605 .cmd 横幅里的 `WEB=` == report.js 的 LIVE', cmdWeb.trim());

/* ==================== G. 旧启动器已归档 ==================== */
console.log('\n=== G. 旧启动器归档（防误双击坏脚本）===');
ok(!fs.existsSync(path.join(ROOT, '启动聚合站.bat')),
  '\u2605 根目录不再有 9-04 的旧 .bat（双斜杠路径 + 无幂等启动）');
ok(fs.existsSync(path.join(ROOT, '_archived', 'launcher-v1-20260904.bat')),
  '旧 .bat 是**归档**而非删除（`_archived/launcher-v1-20260904.bat`）');
ok(/\[InternetShortcut\]/.test(URLF), '线上快捷方式文件已就位');

console.log('\n通过 ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
