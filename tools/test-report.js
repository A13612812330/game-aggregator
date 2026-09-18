/* 状态汇报脚本（tools/report.js）的常驻防线
 *
 * 为什么要给它写测试：本项目历史上「文档/记忆里的链接与真实发布不一致」已复发多次
 * （v10.15/16/17/18 各一次），report.js 是唯一会把「线上到底是哪一版」实测出来的入口。
 * 一旦它的链接登记写错、或五项里有哪项悄悄不输出，汇报就会重新变成「我记得」——
 * 那比不汇报更危险。所以这里把「结构」钉死，并用 --no-net 保证离线可跑。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'tools/report.js'), 'utf8');
/* 剥掉注释后再查源码：注释里**特意**写了一些坑的说明，不剥会误报（注释里提到 ≠ 代码里用了）。
   ⚠️ 必须在这里就定义 —— 下面多个小节都要用它，放到后面会 ReferenceError。 */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

let pass = 0, fail = 0;
const ok = (cond, name, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name + (detail ? '  — ' + detail : '')); }
  else { fail++; console.log('  × FAIL  ' + name + (detail ? '  — ' + detail : '')); }
};

console.log('=== ① 链接登记 ===');
const liveMatch = SRC.match(/LIVE:\s*'([^']+)'/);
const LIVE = liveMatch ? liveMatch[1] : '';
ok(!!LIVE, '声明了正式链接 LIVE', LIVE);
ok(/^https:\/\/[a-z0-9-]+\.app\.workbuddy\.host\/$/.test(LIVE), 'LIVE 是规范的 workbuddy.host 域名（带尾斜杠）', LIVE);
/* ★ 切片边界不能用 `'DEPRECATED'` 这个词来定位 —— 它在**文件顶部注释**里也出现过
   （「旧链接降级到 DEPRECATED」），于是 `indexOf` 命中的是**注释**而不是清单本身，
   1400 字只够到第 2 条 ⇒ join 被漏掉、那条「仍登记 join」的断言**假红**（v10.22 实测踩到）。
   改用真实结构地标：`const LINKS = {` → `const GITHUB`。 */
const LINKS_BLOCK = SRC.slice(SRC.indexOf('const LINKS = {'), SRC.indexOf('const GITHUB'));
ok(LINKS_BLOCK.length > 200, '★ LINKS 块切片拿到内容（地标变了会让下面几条断言恒真/恒假）', LINKS_BLOCK.length + 'B');
/* 从 report.js 的 DEPRECATED 清单里**直接抠出域名**，不在这里手写第二份枚举 ——
   手写清单漏一行不像报错、没人会发现（本项目踩过这个坑）。
   紧跟一条「抠到了几条」的断言：抠不到 ⇒ depAny 恒为 false ⇒ 后面「LIVE 不许是弃用域名」恒真 = 假绿。 */
const DEP_HOSTS = [...LINKS_BLOCK.slice(LINKS_BLOCK.indexOf('DEPRECATED'))
  .matchAll(/url:\s*'(https:\/\/[^']+)'/g)]
  .map((m) => m[1].replace(/^https:\/\//, '').replace(/\/$/, ''));
const depAny = (h) => DEP_HOSTS.includes(h);
ok(DEP_HOSTS.length >= 3, '★ 从 DEPRECATED 清单抠出域名（抠不到会让下一条断言恒真 = 假绿）', DEP_HOSTS.join(', '));
ok(!/gamehub-agg-join\./.test(LIVE), '★ 已弃用的 gamehub-agg-join 不再是 LIVE（它停在 v10.17）');
ok(!/gamehub-agg-v2\./.test(LIVE), '★ 已弃用的 gamehub-agg-v2 不再是 LIVE（它停在 v10.19 之前）');
ok(!/gamehub-agg-v3\./.test(LIVE), '★ 已弃用的 gamehub-agg-v3 不再是 LIVE（发布环境失效，停在 v10.21）');
/* ★ 2026-09-18（v10.22）换域名，判据**不能只看 HTTP 200** ——
   v2 / join / v3 三个域名**全部返回 200 却都是旧版**，只看状态码会把三个尸体都判成 LIVE。
   所以下面钉的是「主机名规范 + 换域名这件事必须留下原因 + 记着它是快照不是自动同步」。 */
const LIVE_HOST = LIVE.replace(/^https:\/\//, '').replace(/\/$/, '');
ok(/^[a-z0-9-]+\.app\.workbuddy\.host$/.test(LIVE_HOST), 'LIVE 主机名规范', LIVE_HOST);
ok(!depAny(LIVE_HOST), '★ LIVE 不许是任何一个已弃用域名（200 尸体也算）');
ok(/不跟随本地改动|快照/.test(SRC),
  '★ 记着「LIVE 不跟随本地改动 = 快照」这个实测事实（否则以为改完本地就自动上线）');
ok(/未绑定到本次发布环境/.test(SRC), '★ 记着 v3 被拒的原文（下版再遇到就一眼认出是同一个原因）');
const depSec = LINKS_BLOCK.slice(LINKS_BLOCK.indexOf('DEPRECATED'));
ok(/gamehub-agg-join/.test(depSec), '弃用清单里仍登记 gamehub-agg-join（避免下次又被捡回来）');
ok(/gamehub-agg-v2/.test(depSec), '★ 弃用清单里也登记 gamehub-agg-v2（域名绑不上新环境，只读尸体）');
ok(/gamehub-agg-v3/.test(depSec), '★ 弃用清单里登记 gamehub-agg-v3（发布环境失效，工具拒绝覆盖）');

console.log('\n=== ② 五项结构齐备 ===');
for (const [k, re] of [
  ['① 做了什么', /①\s*做了什么/],
  ['② 分享链接', /②\s*分享链接/],
  ['③ 项目文件夹', /③\s*项目文件夹/],
  ['④ 是否更新到 GitHub', /④\s*是否更新到 GitHub/],
  ['⑤ GitHub 更新日志', /⑤\s*GitHub 更新日志/],
]) ok(re.test(SRC), '输出含「' + k + '」段');

console.log('\n=== ③ 关键判据（防止退化成「只看 HTTP 200」）===');
ok(/createHash\('md5'\)/.test(SRC), '★ 用 md5 比对判定线上版本，不只看状态码');
ok(/与本地逐字节一致/.test(SRC), '判定文案明确写「与本地逐字节一致」');
ok(/ls-remote/.test(SRC), 'GitHub 用 ls-remote 比对远端分支');
ok(/synced/.test(SRC), '给出「远端 = 本地」的同步结论字段');
ok(/CODEX-INDEX\.md/.test(SRC) && /README\.md/.test(SRC), '更新日志同时检查 README 与 CODEX-INDEX');
ok(/CODEX-DONE-v10/.test(SRC), '更新日志统计 CODEX-DONE-v*.md 份数');
/* ★ 反例：这条清单曾**写死** `['10.10'…'10.20']`，v10.21 时漏更新 —— 汇报里少一行，
   而且看不出来（少一行不像报错）。所以断言不许它退回数组字面量。 */
ok(!/coverage:\s*\[\s*'/.test(CODE), '★ 逐版覆盖清单是**算**出来的，不是手写数组（写死过 → v10.21 漏一行）');
ok(/for \(let v = 10; v <= top; v\+\+\)/.test(CODE), '覆盖清单自动从 10.10 连续到最新版');

console.log('\n=== ③-b 线上版本判定不许「报反」（2026-09-18 新增）===');
/* 旧实现：md5 不同时用 `/.chip\.ol/` 猜，结果「线上还没发布 v10.20」被说成「新于本地？」。
   这类错误比不说更危险 —— 用户会以为线上已经是最新。 */
ok(/const FEATURES = \[/.test(CODE), '★ 用特征指纹判定线上版本，不用单一样式类猜');
ok(/id="navUnpack"/.test(CODE), '指纹含 v10.20 的顶栏入口 navUnpack');
ok(/function versionLabel/.test(CODE), '抽成 versionLabel 纯函数（可单测/可回归）');
ok(!/新于本地\？/.test(CODE), '★ 已删掉「新于本地？」这种猜法');
ok(/旧于本地（线上尚未发布 /.test(CODE), '★ 线上落后时明确写「尚未发布 vX」（而不是含糊的「不同版本」）');
/* ⚠️ 别写成 `/!re\.test\(/` —— 源码是 `f.re.test(...)`，`!` 后面跟的是 `f.`，会测不出来 */
ok(/test\(localTxt\)\s*&&\s*![\w.]*\.test\(remoteTxt\)/.test(CODE),
  '方向正确：本地有、线上没有 ⇒ 线上旧（别写反）');
ok(/同代但内容有差异/.test(CODE), '指纹全中但字节不同 → 如实说「需人工核对」，不硬下结论');
ok(/probeLink\(LINKS\.LIVE, localMd5, idxLocal\)/.test(CODE), 'probeLink 改传本地全部文本（判定要用指纹）');

console.log('\n=== ④ 已知坑：不能设 GIT_TERMINAL_PROMPT=0 ===');
/* CODE 已在文件顶部剥好注释（见那里的说明） */
ok(!/GIT_TERMINAL_PROMPT/.test(CODE), '★ 代码里没有 GIT_TERMINAL_PROMPT=0（会让代理取不到凭据 → CONNECT tunnel failed）');
ok(/'git log -4[^']*--pretty="format:/.test(CODE), 'git log 的 --pretty 整体加引号（否则 %h|%ad|%s 的竖线被 shell 当管道）');

console.log('\n=== ④-b GitHub 探测回退（2026-09-18 新增，本机 github.com 被阻断）===');
/* 背景：实测 github.com（20.205.243.166）连通 0/6，`git ls-remote`/`git push` 一律
   `CONNECT tunnel failed, response 502`；而 api.github.com（20.205.243.168）通畅。
   ⇒ report.js 必须能退到 REST API，否则④这一项会永远显示「无法确认」，
     用户就再也拿不到「到底推上去没有」的确定答案。 */
ok(/async function remoteViaApi/.test(CODE), '★ 新增 remoteViaApi（REST API 读远端 ref）');
ok(/api\.github\.com/.test(CODE), '★ 退路走 api.github.com（不是猜的域名）');
ok(/\/git\/ref\/heads\//.test(CODE), '调的是 Git ref 接口（与 ls-remote 同语义）');
ok(/gh auth token/.test(CODE), 'token 从 gh 取（不硬编码、不入库）');
/* ⚠️ 断言要取 `github()` 的**函数体**再比顺序：直接对全文 indexOf('remoteViaApi(env)')
   会先命中 `async function remoteViaApi(env) {` 这行**定义**，测出来必然「顺序反了」——
   是测试自己写错，不是代码错。 */
const ghBody = CODE.slice(CODE.indexOf('async function github('));
ok(ghBody.indexOf('git ls-remote') > -1 &&
   ghBody.indexOf('git ls-remote') < ghBody.indexOf('await remoteViaApi(env)'),
  '★ 先试 ls-remote，失败才退 API（顺序不能反）');
ok(/via\s*=\s*'ls-remote'/.test(CODE) && /via\s*=\s*'api'/.test(CODE), '记录实际走了哪条路径（可审计，不假装）');
ok(/gh\.via === 'api'/.test(CODE) && /REST API/.test(CODE), '★ 输出里标明探测路径，并说明 github.com 不可达');
ok(/bothFailed/.test(CODE) && /gh\.bothFailed/.test(CODE),
  '★ 两条路径都失败才判「无法确认」（不能一条失败就下结论），且该字段真被输出用到');
ok(/owner:\s*'A13612812330'/.test(CODE) && /name:\s*'game-aggregator'/.test(CODE),
  'REST API 用的 owner/name 与仓库一致');

console.log('\n=== ⑤ 离线实跑（--no-net） ===');
let out = '';
try {
  out = execFileSync(process.execPath, ['tools/report.js', '--no-net', '--md'], {
    encoding: 'utf8', cwd: ROOT, timeout: 90000, maxBuffer: 1 << 22,
  });
} catch (e) {
  out = String((e.stdout || '') + (e.stderr || ''));
}
ok(out.length > 200, '脚本能跑出内容（长度 > 200）', out.length + ' 字符');
ok(LIVE.indexOf('https://') === 0 && out.includes(LIVE.replace(/\/$/, '')), '输出里出现正式链接');
const realPath = ROOT.replace(/\//g, '\\');
ok(out.includes(realPath), '输出里出现项目文件夹真实路径');
ok(/--no-net/.test(out), '--no-net 模式下明确标注「跳过联网」（不会假装验过）');
ok(!/undefined|NaN|\[object Object\]/.test(out), '★ 输出无 undefined / NaN / [object Object]（模板拼接未出错）');
const heads = ['# 状态汇报', '## ① 做了什么', '## ② 分享链接', '## ③ 项目文件夹', '## ④ 是否更新到 GitHub', '## ⑤ GitHub 更新日志'];
ok(heads.every((h) => out.includes(h)), '实跑输出六行标题全在', heads.filter((h) => !out.includes(h)).join(',') || '全在');
ok(/git log 读取失败/.test(out) === false, '★ 实跑没触发「git log 读取失败」（引号坑已修）');

console.log('\n=== ⑤-b 滞后文档不许自称「最新」（2026-09-18 新增，收 #46）===');
/* 三份旧交接/设计文档曾长期停在 v10.10 / v10.1 / v10.3 却仍在顶部写「最新 —— 先看这段」，
   而 HANDOFF.md 里给的是**已弃用的分享链接**（200 但内容很旧）。
   错误文档比没有文档更危险 —— 照它干活会直接干错。 */
const doc = (f) => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { return ''; } };
/* 正则从 LIVE 现算，不在这里写死域名 —— 换域名时只需改 report.js 一处，这两份文档的断言自动跟上 */
const liveHostRe = new RegExp(LIVE_HOST.replace(/\./g, '\\.'));
for (const f of ['HANDOFF.md', 'CODEX-HANDOFF.md']) {
  const s = doc(f);
  ok(/已归档/.test(s), '★ ' + f + ' 顶部有「已归档」说明（不再冒充最新）');
  ok(!/最新\s*——\s*先看这段/.test(s), '★ ' + f + ' 已删掉「最新 —— 先看这段」的旧claim');
  ok(/CODEX-INDEX\.md/.test(s), f + ' 指向 CODEX-INDEX.md（当前状态以它为准）');
  ok(liveHostRe.test(s), f + ' 给出**当前**分享链接（' + LIVE_HOST + '）');
}
const handoff = doc('HANDOFF.md');
ok(/已弃用/.test(handoff) && /gamehub-agg-v3/.test(handoff),
  '★ HANDOFF.md 明确把旧链接标成「已弃用」（它 200 但内容很旧，是最容易骗人的那种）');
const design = doc('DESIGN.md');
ok(/第 4 节|筛选条/.test(design) && /已不是当前实现/.test(design),
  '★ DESIGN.md 明示第 4 节筛选条已不是当前实现（v10.5 拆三行 / v10.9 七行 .emu-bar-row）');
ok(/v10\.19/.test(design), 'DESIGN.md 记录了 v10.19 的指南卡片化');

console.log('\n=== ⑤-c 流程总纲 WORKFLOW.md（2026-09-18 新增）===');
/* 新加的流程文档同样是「会过期却看不出来」的高危物。
   尤其这批：把某一步漏掉，照它干活就会漏做 —— 漏做又不会报错（重建派生页/重启服务都是静默失败）。
   所以断言盯的是「不可跳过的步骤必须在文档里」，而不是文笔。 */
const wf = doc('WORKFLOW.md');
ok(wf.length > 3000, 'WORKFLOW.md 存在且有实质内容', (Buffer.byteLength(wf, 'utf8') / 1024).toFixed(1) + 'KB');
ok(/CODEX-INDEX\.md/.test(wf), '★ 指向 CODEX-INDEX.md（版本真源不是它，避免又养出一份「自称最新」）');
ok(/基线[^\n]*v\d+\.\d+/.test(wf), '声明了明确基线版本（便于一眼看出是否过期）');
for (const [kw, why] of [
  ['build-emulator-page.js', '重建手机专区派生页'],
  ['build-unpack-page.js', '重建解包匹配派生页'],
  ['test-pages-sync.js', '★ 派生页同步防线（唯一能发现「主源改了没重建」的手段）'],
  ['restart-server.js', '重启服务（改 server/data 后必须做，否则静默不生效）'],
  ['run-all.js', '全量静态防线'],
  ['report.js', '五项状态汇报'],
  ['audit-apps.js', '★ 发布后必跑：应用登记 × 域名实测对账（旧域名全是 200）'],
  ['_push-via-api.js', '推送（github.com 被阻断，只能走 API）'],
]) ok(wf.includes(kw), '流程里点名了 ' + kw + ' —— ' + why);
/* 2026-09-18 实测：本地服务停掉后 run-all 里 4 套变红，报的却是「接口不可达」——
   看着像代码坏了。这条「先 curl 再怀疑代码」的判断必须写进流程，否则每次都要重查一遍。 */
ok(/000/.test(wf) && /服务挂了/.test(wf), '★ 记着「000 = 服务挂了，不是代码坏了」');
ok(/core\.autocrlf|入库字节/.test(wf), '★ 记着 autocrlf 坑（读磁盘建 blob 会推错内容）');
ok(wf.includes('gamehub-agg-v3') ? /已弃用/.test(wf) : true, '若提到旧链接 v3 必须标「已弃用」');
ok(!/最新\s*——\s*先看这段/.test(wf), '不许出现「最新 —— 先看这段」这种会在下版崩塌的措辞');
ok(/PITFALLS\.md/.test(wf), '★ WORKFLOW 指向 PITFALLS.md（不然 13KB 的踩坑全集没人找得到）');

console.log('\n=== ⑤-d 踩坑全集 PITFALLS.md（2026-09-18 从 MEMORY.md 迁出）===');
/* 为什么给这份文档加护栏：它是**全项目信息密度最高**的一份（13KB，60+ 条判据），
   却是从「有 3000 字上限的记忆文件」里挤出来的 —— 一旦它静默消失或长残，
   丢掉的是本项目踩过的所有坑，而没有任何东西会报错。
   ★ 顺带守「记忆文件不许再胖回去」：迁出的意义就是让它保持瘦。 */
const pf = doc('PITFALLS.md');
ok(pf.length > 8000, 'PITFALLS.md 存在且有实质内容', (Buffer.byteLength(pf, 'utf8') / 1024).toFixed(1) + 'KB');
ok(/MEMORY\.md/.test(pf), '★ 写明了自己是从 MEMORY.md 迁出的（否则后人不知道两份文档的关系）');
ok(/新增踩坑请写到这里/.test(pf), '★ 写了「新增踩坑写这里」—— 否则又会往流程文档里堆');
ok(/elementFromPoint/.test(pf), '记着「存在 ≠ 可见」的判据（z-index 被压住时存在性断言全绿）');
ok(/你没有权限下载/.test(pf) && /needAuthOf/.test(pf),
  '★ 记着「源站权限门 ≠ 抓取失败」（两者该给的出口相反）');
ok(/total.{0,6}恒为 0|恒为 0/.test(pf), '★ 记着机地接口的 `total` 陷阱字段');
ok(/coreutils/.test(pf) && /command not found/.test(pf), '记着「coreutils 可能整批缺失，操作走 node」');
ok(/workbuddy_sites_deploy|unpublish/.test(pf) && /正式入口/.test(pf),
  '★ 记着「绝不用 unpublish 清旧 app —— 会把正式入口一起下掉」');
const mem = doc(path.join('..', '.workbuddy', 'memory', 'MEMORY.md'));
ok(mem.length > 200 && mem.length <= 3000,
  '★ 记忆文件保持在 3000 字以内（迁出的意义就是别再胖回去）', mem.length + ' 字');
ok(/PITFALLS\.md/.test(mem), '★ 记忆文件指向 PITFALLS.md（细节的唯一去处）');

console.log('\n=== ⑤-e run-all 的「退出码」前置检查（v10.22 补的一类假绿）===');
/* 实测过：`test-report.js` 与 `test-alias-guard.js` 原先只打印「n / m 通过」却**始终 exit 0**。
   run-all 靠解析输出兜住了，但「单独跑」和「反证」两条路都会把红的当绿的。
   ⇒ run-all 必须有一道前置检查，把这种套件直接点名。这里守的是**那道检查还在**。 */
const ra = doc(path.join('tools', 'run-all.js'));
ok(/exitTiedToFailures/.test(ra), '★ run-all 有「退出码是否挂钩失败数」的前置检查');
ok(/process\.exit\s*\(\s*fail\s*\?/.test(ra), 'run-all 自己也要把退出码挂在失败数上');
ok(/noExit/.test(ra) && /退出码不随失败变/.test(ra), '★ 命中时**点名报出**是哪些套件（不能只加个布尔）');
ok(/process\.exit\(fail \? 1 : 0\)/.test(doc(path.join('tools', 'test-report.js'))), '★ 本套件自己的退出码也挂在失败数上');
ok(/process\.exit\(fail \? 1 : 0\)/.test(doc(path.join('tools', 'test-alias-guard.js'))), '★ test-alias-guard 也已补齐');

console.log('\n=== ⑥ 本地真实数据自检 ===');
const idx = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
ok(idx.length > 100000, 'public/index.html 有内容可算 md5', (Buffer.byteLength(idx, 'utf8') / 1024).toFixed(1) + 'KB');
const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8', cwd: ROOT }).trim();
ok(typeof dirty === 'string', 'git status 可读（工作区自检）', dirty ? dirty.split(/\r?\n/).length + ' 项未提交' : '干净');

console.log('\n结果：' + pass + ' / ' + (pass + fail) + ' 通过');

/* ★★ v10.22 补：**退出码必须跟着失败数走**。
 *   本套件原先只打印「n / m 通过」却始终 exit 0 —— 后果是：
 *     ① 单独跑 `node tools/test-report.js`（`WORKFLOW.md` 步骤 8 就是这么写的）
 *        `echo $?` 得到 0 ⇒ **红的被当成绿的**；
 *     ② 标准反证手法（判据 = 退出码非零）**对它完全失效**，断言打坏了也验不出来。
 *   `run-all.js` 靠**解析输出**里的 `n / m` 兜住了，所以全量防线没被瞒过 ——
 *   但这属于「险过」，不该依赖。同类缺陷当时还有 `test-alias-guard.js`（已一并补）。 */
process.exit(fail ? 1 : 0);
