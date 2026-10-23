/* ★ v10.71 第一层（静态）：解压助手的「整条链路是否接好了」
 *
 * 起因：v10.71 给「下载直链的压缩包里面有压缩包」这件事做了两条落地通道 ——
 *   ① 站内页 /extract.html（贴直链下载后递归解压 / 指定文件夹批量递归解压）
 *   ② 桌面拖放工具（拖包即递归解压 + 弹 HTML 报告）
 *   两条通道共用同一份解析层 data/extractor.js。
 *
 * 本套件守的是**接缝**，不是算法（算法由 test-v1071-extractor.js 守、
 * 端到端由 test-v1071-extract-e2e.js 守、页面行为由 test-v1071-extract-page.js 守）：
 *
 *   A. 主源 → 派生页：顶栏 / 底部 Tab 是**五**个入口（「🗜️ 解压助手」是第 5 条），
 *      且 extract.html 两侧都在（只加主源不重建派生页 = 静默漂移，本项目高频坑 #1）
 *   B. server.js：7 条 /api/extract/* 路由都在；★ 404 兜底**没被新路由段顶掉**
 *      （写这段时真的顶掉过一次：用大段新路由直接替换了 app.use(404)）
 *   C. 语法闸门存在且**真的会红**（阳性对照 + 3 条反证）——
 *      本轮踩到的真事故：`{ 7z: '7Z' }` 让整页脚本 SyntaxError，
 *      而构建器当时一堆**结构**自检全绿，只能等浏览器探针才照出来
 *   D. 启动器（.cmd / .vbs）：★ **本沙箱跑不了 cmd.exe**（Bash 与 PowerShell 两条路
 *      都被安全策略拦：Invoking cmd.exe bypasses all command validation）。
 *      ⇒ 这两个文件我没实跑过，所以**必须**用静态断言把它们的关键分支钉住，
 *        并在文档里如实写明「静态校验通过、未实跑」。这份断言就是那个「如实」的凭据。
 *   E. CLI 契约：参数解析（--dest/--depth/--pw/--no-open/--json + 拖放路径去引号）、
 *      报告必出、退出码 0/3/4 的语义
 *   F. 报告渲染器是**纯函数**：喂已知结构 ⇒ 断言输出片段（不跑真解压）
 *   G. 杂项：_extract-out/ 已忽略（报告含用户本地路径）；favicon 已加（否则每页 404）
 *
 * 反证锚点（打坏必变红，见 test-v1071-extract-counterproof.js）：
 *   · 去掉 extract.html 的 initEx()                  ⇒ A 红
 *   · 删掉 server.js 的 404 兜底                     ⇒ B 红
 *   · page-assets 的 assertScriptSyntax 改成直接 return ⇒ C 红
 *   · .cmd 里把 %* 换成 %1                           ⇒ D 红（只能拖一个）
 *   · CLI 把 --pw 解析删掉                           ⇒ E 红
 *   · render() 的待解密区块删掉                       ⇒ F 红
 *
 * 跑法：node tools/test-v1071-extract.js    （纯离线，约 1 s，不需要服务）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const rd = (p) => fs.readFileSync(p, 'utf8');

let pass = 0, fail = 0;
function chk(name, ok, extra) {
  if (ok) { pass++; console.log('  ✅ ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '   ' + extra : '')); }
}
function hr(t) { console.log('\n' + '─'.repeat(74) + '\n' + t + '\n' + '─'.repeat(74)); }

const idx = rd(path.join(PUB, 'index.html'));
const extract = rd(path.join(PUB, 'extract.html'));
const server = rd(path.join(ROOT, 'server.js'));
const cli = rd(path.join(ROOT, 'tools', 'extract-cli.js'));
const rpt = rd(path.join(ROOT, 'tools', 'extract-report.js'));
const assets = rd(path.join(ROOT, 'tools', 'page-assets.js'));
const CMD = rd(path.join(ROOT, '解压助手-拖放.cmd'));
const VBS = rd(path.join(ROOT, '解压助手-拖放-静默.vbs'));

/* ===================== A. 主源 → 派生页 ===================== */
hr('A. 主源 / 派生页：五个入口两侧都在');

const navHrefs = (idx.match(/<a href="[^"]*"[^>]*id="nav(Home|Emu|Res|Unpack|Ex)"[^>]*>/g) || []);
chk('A1 主源顶栏有 5 条带 id 的导航', navHrefs.length === 5, 'n=' + navHrefs.length);
chk('A2 主源含 🗜️ 解压助手入口且指向 /extract.html',
  /id="navEx"[^>]*>\s*🗜️\s*解压助手|🗜️ 解压助手<\/a>/.test(idx) && /href="\/extract\.html"[^>]*id="navEx"/.test(idx));
/* ★ 主源的「首页」是页内锚点 + on 态；派生页必须换成真链接回聚合首页，
 *   否则派生页脚本会把 navHome 的点击 preventDefault 掉（点不动的摆设）。 */
chk('A3 主源 navHome 仍是页内锚点（派生页才需要改）', /id="navHome"/.test(idx) && !/href="\/"[^>]*id="navHome"/.test(idx));
chk('A4 派生页顶栏 5 入口且 navEx 高亮',
  (extract.match(/<a href="[^"]*"[^>]*id="nav(Home|Emu|Res|Unpack|Ex)"/g) || []).length === 5,
  'n=' + (extract.match(/<a href="[^"]*"[^>]*id="nav(Home|Emu|Res|Unpack|Ex)"/g) || []).length);
chk('A5 派生页 navHome 已改成真链接 /', /<a href="\/"[^>]*id="navHome"/.test(extract));
chk('A6 派生页恰好一个顶栏高亮项', (extract.match(/<a href="[^"]*"[^>]*class="on"[^>]*id="nav/g) || []).length === 1,
  'on=' + (extract.match(/<a href="[^"]*"[^>]*class="on"[^>]*id="nav/g) || []).length);
/* 底部 Tab：v10.71 由 4 项增至 5 项 —— 5 项在 390px 上约每项 78px，放得下（已实拍） */
const tabbar = (extract.match(/<nav class="tabbar"[\s\S]*?<\/nav>/) || [''])[0];
chk('A7 派生页底部 Tab 有 5 项', (tabbar.match(/<a /g) || []).length === 5, 'n=' + (tabbar.match(/<a /g) || []).length);
chk('A8 底部 Tab 含「解压」入口且指向 /extract.html', /href="\/extract\.html"[\s\S]{0,400}解压<\/a>/.test(tabbar));
chk('A9 page-assets 的 TAB_ICON 有 extract 图标', /extract:\s*'<rect/.test(assets));
/* ★★ A10 为什么要断言**位置**而不是「有没有这个子串」——
 *   反证时打坏成「把 initEx(); 包进块注释」，子串照样命中 ⇒ 断言仍是绿的（假绿）。
 *   本项目已有的同类教训：「改名要判剥注释后零残留」「断言/正则的作用域会假红也会假绿」。
 *   这里改成「页面脚本的**最后一句**必须就是 initEx();」——
 *   被删掉、被挪走、被注释掉，三种坏法都会红。 */
const lastScript = (() => {
  const all = [...extract.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  return all.length ? all[all.length - 1][1] : '';
})();
const lastStmt = lastScript.split('\n').map((x) => x.trim()).filter(Boolean).pop() || '';
chk('A10 ★ 页面脚本末句就是 initEx();（首屏真的会跑，不是只写在注释里）',
  lastStmt === 'initEx();', '末句=' + JSON.stringify(lastStmt.slice(0, 60)));
chk('A11 extract.html 暴露 window.initEx（供通用脚本调用）', /window\.initEx\s*=/.test(extract));

/* ===================== B. server.js 路由与兜底 ===================== */
hr('B. server.js：7 条解压路由 + 404 兜底仍在');

for (const r of ['/api/extract/env', '/api/extract/scan', '/api/extract/download',
  '/api/extract/run', '/api/extract/task', '/api/extract/password']) {
  chk('B · ' + r + ' 已注册', server.indexOf("'" + r + "'") >= 0);
}
chk('B7 解压模块已 require', /require\(['"]\.\/data\/extractor['"]\)/.test(server));
/* ★★ 这条是踩出来的：写新路由段时我用一大段 app.post(...) 直接替换掉了旧的
 *   app.use((_req,res)=>res.status(404)...)，之后所有未知路径都挂起不响应。
 *   断言「文件里还有 404 兜底」不够 —— 要断言它在**路由段之后**仍然存在且是 app.use。 */
chk('B8 404 兜底仍在（app.use + 404 + Not Found）',
  /app\.use\(\(_req,\s*res\)\s*=>\s*res\.status\(404\)\.json\(\{\s*ok:\s*false,\s*error:\s*'Not Found'/.test(server));
chk('B9 404 兜底位于解压路由段之后', (() => {
  const i404 = server.search(/app\.use\(\(_req,\s*res\)\s*=>\s*res\.status\(404\)/);
  const iEx = server.indexOf("'/api/extract/run'");
  return i404 > 0 && iEx > 0 && i404 > iEx;
})());
chk('B10 并发上限与任务保留条数都设了闸',
  /EX_MAX_CONCURRENT\s*=\s*\d+/.test(server) && /EX_KEEP\s*=\s*\d+/.test(server));
chk('B11 run 接口有熔断（连续失败就停，不全量跑挂）', /circuit-break|circuitBreak/.test(server));
/* ★ 目录护栏：解压=写盘，绝不能解到盘符根 / Windows / Program Files / 用户目录根 */
chk('B12 目录护栏拦截危险落点', /EX_BLOCKED_DIR/.test(server) && /exSafeDir/.test(server));

/* ===================== C. 语法闸门 ===================== */
hr('C. 语法闸门：存在、且真的会红');

const A = require('./page-assets');
chk('C1 page-assets 导出 assertScriptSyntax', typeof A.assertScriptSyntax === 'function');

/* 阳性对照：正常脚本必须过（否则闸门自己就是坏的，「永远红」和「永远绿」一样没用） */
let posOk = true;
try { A.assertScriptSyntax('<html><script>var a={z:1};</script></html>', 'pos.html'); }
catch (e) { posOk = false; }
chk('C2 ★ 阳性对照：正常脚本能过（闸门不是恒红）', posOk);

let red1 = false;
try { A.assertScriptSyntax('<html><script>var a={7z:1};</script></html>', 'bad1.html'); }
catch (e) { red1 = /Invalid or unexpected token|语法错误/.test(e.message); }
chk('C3 ★ 反证 1：`{ 7z: 1 }` 这种未加引号的数字键会变红', red1);

let red2 = false;
try { A.assertScriptSyntax('<html><script>var s="<\/scr' + 'ipt>";</script></html>', 'bad2.html'); }
catch (e) { red2 = /不配对/.test(e.message); }
chk('C4 ★ 反证 2：脚本里含字面量 </script>（标签不配对）会变红', red2);

let red3 = false;
try { A.assertScriptSyntax('<html>没有脚本</html>', 'bad3.html'); }
catch (e) { red3 = /没找到内联/.test(e.message); }
chk('C5 ★ 反证 3：产物里没有 <script> 块会变红', red3);

/* ★★ 「调用形状」类断言必须**剥注释**再判（本项目已有教训：改名要判「剥注释后零残留」）。
 *   反证时把调用注释掉、token 还留在源码里 ⇒ 纯子串搜索照样命中 ⇒ 假绿。
 *   这里只认「真的一行代码」：整行 trim 后不以注释符开头，且含目标调用。 */
function realCallLine(src, needle) {
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) continue;
    if (t.indexOf(needle) >= 0) return i;
  }
  return -1;
}

/* 四个页面构建器都接上了闸门 —— 只给新页加、旧页不管，等于留了四个同样的洞 */
for (const b of ['build-extract-page.js', 'build-unpack-page.js', 'build-emulator-page.js', 'build-resource-page.js']) {
  chk('C6 ' + b + ' 落盘前调了语法闸门（真调用，不是注释里的字样）',
    realCallLine(rd(path.join(ROOT, 'tools', b)), 'assertScriptSyntax(out,') >= 0);
}
chk('C7 闸门检查发生在 writeFileSync 之前（否则废页已经写出去）', (() => {
  const src = rd(path.join(ROOT, 'tools', 'build-extract-page.js'));
  const gate = realCallLine(src, 'assertScriptSyntax(out,');
  /* ★ v10.111：判据从 `fs.writeFileSync(OUT, out` 放宽到 `fs.writeFileSync(OUT,`。
     原写法把「写出的是什么表达式」也绑死了 —— 本版为了归一换行改成
     `writeFileSync(OUT, String(out).replace(/\r\n?/g, '\n'), 'utf8')`，字面量对不上就假红。
     这条要守的是「**顺序**：闸门先、落盘后」，不是「落盘那行怎么拼」。
     顺序语义没有被放宽：gate 与 write 两次定位到的是**行号**，比较关系原样保留。 */
  const write = realCallLine(src, 'fs.writeFileSync(OUT,');
  return gate >= 0 && write >= 0 && gate < write;
})());
/* 闸门必须能查出**真实产物**的语法错：把 extract.html 抽出来编译一次 */
chk('C8 真实产物 extract.html 的内联脚本能编译', (() => {
  try { A.assertScriptSyntax(extract, 'extract.html'); return true; } catch (e) { return false; }
})());

/* ===================== D. 启动器（未实跑，靠静态钉） ===================== */
hr('D. 启动器：结构断言（★ 本环境 cmd.exe 被拦，未实跑）');

chk('D1 .cmd 存在且非空', CMD.length > 400, CMD.length + ' B');
chk('D2 .vbs 存在且非空', VBS.length > 400, VBS.length + ' B');
/* ★ 为什么断言 %*：拖放多个文件时 cmd 会传多参，只有 %* 能全带上。
 *   写成 %1 的话用户拖 3 个包只处理 1 个，而且**不报错**（静默少干活）。 */
chk('D3 .cmd 用 %* 传全部拖放参数（不是 %1）', /"tools\\extract-cli\.js"\s+%\*/.test(CMD));
chk('D4 .cmd 不自己拼参数串（避开延迟展开对 ! & 的破坏）', !/set\s+"ARGS=/i.test(CMD));
chk('D5 .cmd 切了 UTF-8 码页（否则中文路径在控制台是乱码）', /chcp\s+65001/.test(CMD));
chk('D6 .cmd 会定位 node 且**不写死版本号**（managed 目录名带构建后缀）',
  /VBASE=.*binaries\\node\\versions/.test(CMD) && !/22\.22\.\d/.test(CMD));
chk('D7 .cmd 没有拖东西时给用法而不是静默退出', /if "%~1"==""[\s\S]{0,600}用法/.test(CMD));
chk('D8 .cmd 对 0/3/4 三个退出码都有对应提示',
  /"%RC%"=="0"/.test(CMD) && /"%RC%"=="3"/.test(CMD) && /"%RC%"=="4"/.test(CMD));
chk('D9 .vbs 隐藏窗口跑（0）且等待返回码（True）才能据码弹框', /shell\.Run\(cmd,\s*0,\s*True\)/.test(VBS));
chk('D10 .vbs 有「没拿到拖放参数 → 让用户粘路径」的兜底（.vbs 常收不到拖放参数）',
  /WScript\.Arguments\.Count\s*>\s*0/.test(VBS) && /InputBox/.test(VBS));
chk('D11 .vbs 对 3/4 两个退出码弹不同的提示', /Case 3[\s\S]{0,200}Case 4/.test(VBS));
chk('D12 两个启动器都指向同一个 CLI（解析逻辑只有一份）',
  /extract-cli\.js/.test(CMD) && /extract-cli\.js/.test(VBS));
/* 启动器不许自己调 7z —— 那就是第二份解析逻辑，必然与 extractor.js 漂移 */
chk('D13 启动器里没有直接调 7z（解析逻辑唯一）', !/7z\.exe/i.test(CMD) && !/7z\.exe/i.test(VBS));

/* ===================== E. CLI 契约 ===================== */
hr('E. CLI：参数解析 / 报告必出 / 退出码语义');

chk('E1 接受 --dest=', /--dest=/.test(cli));
chk('E2 接受 --depth= 且有下界（0/负数不许通过）', /--depth=/.test(cli) && /Math\.max\(1,/.test(cli));
chk('E3 接受可重复的 --pw=', /--pw=/.test(cli) && /passwords\.push/.test(cli));
chk('E4 有 --no-open（无人值守时不要弹窗）', /--no-open/.test(cli));
chk('E5 有 --json（给自动化消费）', /--json/.test(cli));
/* ★ 拖放路径：Explorer 传进来的可能带引号、可能有尾部分隔符 */
chk('E6 拖放路径会去引号与尾部分隔符', /replace\(\/\^"\(\.\*\)"\$\/,\s*'\$1'\)/.test(cli) && /\[\\\\\/\]\+\$/.test(cli));
chk('E7 解析层只有一份：CLI require 了 data/extractor', /require\(['"]\.\.\/data\/extractor['"]\)/.test(cli));
chk('E8 ★ CLI 里没有自己 spawn 7z（不重写解析逻辑）', !/resolve7z|['"]x['"]\s*,/.test(cli));
/* ★ 报告必出：失败路径也要弹结果窗，否则「拖进去弹报告」这个需求在失败时就失效了 */
chk('E9 采集抛异常时仍然渲染报告（try/catch 兜住并落盘）',
  /catch\s*\(e\)\s*\{[\s\S]{0,600}rep\s*=\s*\{[\s\S]{0,900}writeFileSync/.test(cli));
chk('E10 报告落盘前过语法闸门', /assertScriptSyntax\(html,/.test(cli));
chk('E11 退出码：有失败 → 3，有待解密 → 4，全好 → 0',
  /stats\.failed\s*\?\s*3\s*:\s*\(rep\.stats\.needPw\s*\?\s*4\s*:\s*0\)/.test(cli));
chk('E12 子进程调起浏览器时关了 stdio（本项目铁律 38）', /stdio:\s*'ignore'/.test(cli));
/* ★ 「处理包数」不能用「有层就记 1」：实测一个目录放两个包会被算成 1 */
chk('E13 处理包数按「认出了几个包」统计，不是「有几个来源」',
  /g\.archives\s*\|\|\s*0/.test(cli) && /archives:\s*found\.length/.test(cli));
chk('E14 重跑命令用双引号包路径（实测包名常含空格与中文）',
  /map\(\(x\)\s*=>\s*'"'\s*\+\s*x\.file\s*\+\s*'"'\)/.test(cli));

/* ===================== F. 报告渲染器（纯函数） ===================== */
hr('F. 报告渲染器：喂已知结构 ⇒ 断言片段');

const R = require('./extract-report');
chk('F1 导出 render 且是纯函数（不传 fs 也能跑）', typeof R.render === 'function');
chk('F2 siteTokens() 真的从主源抽到了 token（不是回退常量）', (() => {
  const t = R.siteTokens();
  return t.indexOf(':root{') === 0 && /--c-primary\s*:/.test(t) && /--c-t1\s*:/.test(t);
})());
/* ★ 这里的样本是**已知正确结构**，不是「随便喂点什么看它不炸」——
 *   上次 sniff 全线失效时，「纯文本不该误判」那条断言是绿的，因为什么都认不出来。 */
const SAMPLE = {
  title: 'GameHub 解压助手', at: '2026/10/14 11:09:26', host: 'TEST-PC',
  exe: 'D:\\7-Zip\\7z.exe', version: '7-Zip 24.08 (x64)', maxDepth: 5,
  destLabel: '原地解压', reportPath: 'X:/rep.html',
  rerunCommand: 'node "cli.js" "a b.rar" --pw=你的密码',
  needPassword: [{ file: 'C:\\x\\locked.zip', name: 'locked.zip', depth: 1, format: 'zip', group: 'C:\\x' }],
  failures: [{ file: 'C:\\x\\bad.rar', name: 'bad.rar', depth: 2, format: 'rar', reason: 'unreadable', err: 'ERROR: xxx', group: 'C:\\x' }],
  groups: [{
    name: 'C:\\x', kind: 'dir', archives: 2,
    layers: [
      { depth: 1, file: 'C:\\x\\a3.zip', name: 'a3.zip', format: 'zip', ok: true, produced: 2, nothingNew: false },
      { depth: 2, file: 'C:\\x\\第二层.zip', name: '第二层.zip', format: 'zip', ok: true, produced: 2, nothingNew: false },
      { depth: 3, file: 'C:\\x\\第三层 包.zip', name: '第三层 包.zip', format: 'zip', ok: true, produced: 2, nothingNew: true },
    ],
    skipped: [{ file: 'C:\\x\\fake.rar', depth: 1, reason: 'not-archive' }],
    /* ★ 这里**故意把三个数组都写全**（采集层实际就是这么给的），
     *   让 F3–F15 只验「有数据时渲染对不对」；
     *   「缺字段会不会崩」交给 F16/F17 专门守 —— 两件事混在一条断言里，
     *   一旦兜底被拆掉，整份套件会在 F3 就崩，F16 根本没机会报红（反证 case ⑧ 实测踩到）。 */
    failures: [], needsPassword: [],
  }],
  stats: { archives: 2, layers: 3, deepest: 3, extracted: 2, nothingNew: 1, needPw: 1, failed: 1, files: 6 },
};
const H = R.render(SAMPLE);
chk('F3 是完整 HTML 文档', /^<!DOCTYPE html>/.test(H) && /<\/html>\s*$/.test(H));
chk('F4 待解密区块出现且带重跑命令与复制按钮',
  /个包需要密码/.test(H) && /重跑命令/.test(H) && /class="cp"/.test(H) && H.indexOf('a b.rar') > 0);
chk('F5 待解密不会被当成「文件损坏」',
  /它们没有被当成坏包丢掉/.test(H) && /头加密/.test(H));
chk('F6 失败区块列出退出码原文', /个包失败/.test(H) && H.indexOf('ERROR: xxx') > 0);
chk('F7 ★ 逐层明细默认展开（成功路径也要能看到过程）', /<details class="grp" open>/.test(H));
chk('F8 三层都渲染出来（递归真到底）',
  H.indexOf('a3.zip') > 0 && H.indexOf('第二层.zip') > 0 && H.indexOf('第三层 包.zip') > 0);
chk('F9 「已存在，跳过」如实显示，不假装解出了东西', /已存在，跳过/.test(H));
chk('F10 跳过清单解释了「按文件头不是压缩包」', /按文件头判断不是压缩包/.test(H));
chk('F11 判定口径 6 条随报告走', (H.match(/class="dim"/g) || []).length === 6,
  'n=' + (H.match(/class="dim"/g) || []).length);
chk('F12 统计 8 格且数值来自入参', (H.match(/class="s[ "]/g) || []).length === 8 && /<b>3<\/b>/.test(H));
/* ★ 逃逸必须真生效：文件名里带 <script> 不许穿透成可执行标签 */
const XSS = R.render(Object.assign({}, SAMPLE, {
  groups: [{ name: '<img src=x onerror=alert(1)>', kind: 'file', archives: 1,
    layers: [{ depth: 1, file: 'a.rar', name: '<script>alert(2)<\/script>', format: 'rar', ok: true, produced: 1 }],
    skipped: [], failures: [], needsPassword: [] }],
}));
chk('F13 ★ 文件名里的 HTML 被逃逸（注入不进报告）', (() => {
  const head = XSS.slice(0, XSS.indexOf('<script>'));
  /* 原始标签不许出现在文档体里；转义后的实体必须在 */
  return head.indexOf('<img src=x') < 0 && head.indexOf('&lt;img src=x') > 0
    && head.indexOf('<script>alert(2)') < 0;
})());
/* ★ 防御性归一：分组缺字段时不许把整份报告带崩（实测就是这块抛的 TypeError） */
chk('F16 分组缺 failures/needsPassword 时不崩（渲染层不假设采集层字段齐）', (() => {
  try { R.render({ groups: [{ name: 'x', kind: 'file', layers: [] }], stats: {} }); return true; }
  catch (e) { return false; }
})());
chk('F17 空报告也能渲染出完整页面（极端入参兜底）', (() => {
  try { const h = R.render({}); return /<\/html>/.test(h) && /解压报告/.test(h); }
  catch (e) { return false; }
})());
chk('F14 无横向溢出所需的兜底样式在位（word-break / min-width:0）',
  /word-break:break-all/.test(R.PAGE_CSS) && /min-width:0/.test(R.PAGE_CSS));
chk('F15 报告里的脚本本身能编译', (() => {
  try { A.assertScriptSyntax(H, 'sample.html'); return true; } catch (e) { return false; }
})());

/* ===================== G. 杂项接缝 ===================== */
hr('G. 杂项：忽略规则 / favicon / 覆盖登记');

const gi = rd(path.join(ROOT, '.gitignore'));
chk('G1 _extract-out/ 已忽略（报告含用户本地绝对路径）', /^_extract-out\/$/m.test(gi));
chk('G2 新增的 test-v1071-* 都登记进了 run-all 的四张表之一', (() => {
  const runAll = rd(path.join(ROOT, 'tools', 'run-all.js'));
  const mine = fs.readdirSync(path.join(ROOT, 'tools')).filter((f) => /^test-v1071-.*\.js$/.test(f));
  return mine.length >= 3 && mine.every((f) => runAll.indexOf(f) >= 0);
})());
/* ★ favicon：实测加之前全站五个页面都**没有**它，浏览器自动请求 /favicon.ico 必得 404，
 *   每个用户控制台都挂一条红字（是探针把它照出来的）。 */
for (const p of ['index', 'extract', 'unpack', 'emulator', 'resources']) {
  chk('G · public/' + p + '.html 有 rel="icon"', /rel="icon"/.test(rd(path.join(PUB, p + '.html'))));
}
chk('G8 favicon 是内联 data URI（不新增文件、不产生额外请求）',
  /rel="icon" href="data:image\/svg\+xml,/.test(idx));
chk('G9 解压页的「再次解压」手动出口仍在（用户可对上一次目标重跑）',
  /rerun\b/.test(extract) && /对上一次的目标重新解压/.test(extract));

/* ===================== 汇总 ===================== */
hr('汇总');
/* ★ 收尾汇总行的格式是**约定**（`tools/run-all.js` 取成绩用）：
   同行必须含「通过」且带 `n / m`，其中 **m 是总数**、中间不许夹别的字。
   原先写成 `通过 N / 失败 M`（M 是**失败数**）⇒ `\d+\s*\/\s*\d+` 匹配不上，
   成绩会静默退化成「从明细里猜最后一条 n/m」（实测被记成 3/4，少算 84 条）。 */
console.log('  通过 ' + pass + ' / ' + (pass + fail) + '（失败 ' + fail + '）');
if (fail) {
  console.log('  提示：失败项若集中在同一接线处，多半是「改了一侧没重建/没同步另一侧」。');
}
process.exit(fail ? 1 : 0);
