#!/usr/bin/env node
/**
 * test-v1093-downloads.js — 云下载引擎（磁力 → 服务端下载 → 保存到电脑）
 *
 * 【为什么这个套件分三段验，而不是只测接口】
 *   ① 纯函数段（guard / engine 的判据）：能穷举边界，不碰网络、不碰磁盘，跑 0.1 秒。
 *      「30 GB 到底含不含」「每日配额是滚动 24h 还是自然日」这类问题只有在这里测得干净。
 *   ② 源码护栏段（server.js）：云下载是**第一个让服务器替陌生访客花资源**的功能，
 *      它的护栏（adminGuard / 路径越界 / 只绑回环 / rpc secret）属于「删掉也能跑、
 *      但删掉就出事」的东西 —— 必须有一条断言钉住。
 *   ③ 前端段：文案与层级。文案错（还写「直链下载」）就是空承诺；
 *      z-index 错就是「按一次 ESC 关两层」——两者都不会抛异常。
 *
 * ★ 真下载链路由 `_preview/v1093-*.png` 的实拍与本次实测记录背书（见 docs/versions/v10.93.md）：
 *   preview 4.1s → batch(选 1 个文件) → 162s 下完 4,270,111 B → 保存 md5 一致 → Range 206。
 *   套件里**不跑真下载**：BT 网络受 seeder 影响，几分钟到几小时不等，放进防线会变成
 *   「今天红明天绿」的抖动源。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const ENGINE = fs.readFileSync(path.join(ROOT, 'data', 'download-engine.js'), 'utf8');
const guard = require('../data/download-guard');

let pass = 0, fail = 0; const fails = [];
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  — ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  × FAIL  ' + name + (extra ? '  — ' + extra : '')); }
}

function grabFn(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) return null;
  const i = src.indexOf('{', at);
  let depth = 0;
  for (let p = i; p < src.length; p++) {
    if (src[p] === '{') depth++;
    else if (src[p] === '}') { depth--; if (depth === 0) return src.slice(at, p + 1); }
  }
  return null;
}

/* ══════════════ A. download-guard 纯判据 ══════════════ */
console.log('── A 准入判据（download-guard）──');

const HEX = 'A153CBA0593023E624F2BDBFFC91A29DD793F565';
const B32 = 'UBOZUEAZGSZDGSLSPW3L4SFOFJWO53F5';

ok(guard.parseMagnet('magnet:?xt=urn:btih:' + HEX + '&dn=Doll').ok, 'A1 40 位 hex 磁力通过');
ok(guard.parseMagnet('magnet:?xt=urn:btih:' + B32).ok, 'A2 32 位 base32 磁力通过');
ok(!guard.parseMagnet('magnet:?dn=abc').ok, 'A3 没有 xt 的 magnet 被拒（不是「下载失败」而是「链接不对」）');
ok(!guard.parseMagnet('magnet:?xt=urn:btih:' + HEX.slice(0, 39)).ok, 'A4 39 位 hex 被拒');
ok(!guard.parseMagnet('https://example.com/a.torrent').ok, 'A5 非磁力被拒（本引擎只放行磁力）');
ok(!guard.parseMagnet('').ok, 'A6 空串被拒');
ok(guard.parseMagnet('magnet:?xt=urn:btih:' + HEX + '&dn=Hello%20World').name === 'Hello World',
  'A7 dn 正确解码（只用于展示，不拼路径）');
ok(guard.parseMagnet('magnet:?xt=urn:btih:' + HEX).btih === HEX, 'A8 btih 统一大写（对账用）');

ok(guard.MAX_TASK_BYTES === 30 * 1024 ** 3, 'A9 单任务上限 = 30 GB（用户拍板口径）');
ok(guard.checkSize(guard.MAX_TASK_BYTES).ok, 'A10 恰好 30 GB 允许（边界含）');
ok(!guard.checkSize(guard.MAX_TASK_BYTES + 1).ok, 'A11 超过 30 GB 拒绝');
ok(!guard.checkSize(0).ok, 'A12 体积未知（0）拒绝 —— 宁可让人来问，也不排一个不知道多大的任务');
ok(guard.checkSize(guard.MAX_TASK_BYTES + 1).code === 'too-large', 'A13 超限返回结构化 code');

ok(guard.MIN_FREE_BYTES === 40 * 1024 ** 3, 'A14 磁盘安全水位 = 40 GB');
ok(guard.checkDisk(guard.MIN_FREE_BYTES).ok, 'A15 水位边界允许');
ok(guard.checkDisk(guard.MIN_FREE_BYTES - 1).code === 'disk-low', 'A16 低于水位拒绝');

const NOW = 1700000000000;
const mk = (ip, state, ageH) => ({ ip, state, createdAt: NOW - ageH * 3600 * 1000 });
ok(guard.checkQuota('1.1.1.1', [], NOW).ok, 'A17 无任务时可开始');
ok(!guard.checkQuota('1.1.1.1', [mk('1.1.1.1', 'downloading', 1)], NOW).ok, 'A18 同时只允许 1 个进行中');
ok(guard.checkQuota('1.1.1.1', [mk('1.1.1.1', 'ready', 1)], NOW).ok, 'A19 ready 不占并发名额（等用户来取）');
ok(guard.checkQuota('1.1.1.1', [mk('2.2.2.2', 'downloading', 1)], NOW).ok, 'A20 别人 IP 的任务不算自己的');
ok(!guard.checkQuota('1.1.1.1', [mk('1.1.1.1', 'ready', 1), mk('1.1.1.1', 'ready', 2), mk('1.1.1.1', 'failed', 3)], NOW).ok,
  'A21 24h 内第 4 个被拒（每日 3 个）');
ok(guard.checkQuota('1.1.1.1', [mk('1.1.1.1', 'ready', 25), mk('1.1.1.1', 'ready', 26), mk('1.1.1.1', 'ready', 27)], NOW).ok,
  'A22 超过 24h 的不占额度（滚动窗口，不是自然日）');

const dirty = [
  { index: 1, path: '/workspace/data/downloads/dl_x/fg-01.bin', length: 100, selected: 'true' },
  { index: 2, path: '/workspace/data/downloads/dl_x/sub/fg-02.bin', length: 50, selected: 'false' },
  { index: 3, path: '', length: 0, selected: 'true' },
  { index: 4, path: 'C:\\tmp\\a.bin', length: 7, selected: true },
];
const clean = guard.sanitizeFiles(dirty);
ok(clean.length === 3, 'A23 sanitizeFiles 丢掉空 path 条目');
ok(!JSON.stringify(clean).includes('/workspace'), 'A24 对外清单不含服务器绝对路径（防目录泄露）');
ok(clean[0].name === 'fg-01.bin' && clean[1].name === 'fg-02.bin', 'A25 只留 basename');
ok(clean[2].selected === true, 'A26 selected 字符串 "true"/布尔 true 都归一为 boolean');

/* ══════════════ B. 引擎纯逻辑 ══════════════ */
console.log('── B 引擎纯逻辑 ──');

const normSel = grabFn(ENGINE, 'normalizeSelection');
ok(!!normSel, 'B1 抽到 normalizeSelection');
const files7 = [1, 2, 3, 4, 5, 6, 7].map((i) => ({ index: i }));
let L = null;
try {
  // eslint-disable-next-line no-new-func
  L = new Function('return (' + normSel + ')')();
} catch (e) { L = null; }
ok(!!L, 'B2 normalizeSelection 可独立执行');
if (L) {
  ok(L([6], files7) === '6', 'B3 只选 1 个 → "6"');
  ok(L([1, 3], files7) === '1,3', 'B4 选两个 → "1,3"');
  ok(L([3, 1], files7) === '1,3', 'B5 顺序与去重稳定');
  ok(L(null, files7) === '', 'B6 全选不传 select-file（交给 aria2 默认）');
  ok(L([1, 2, 3, 4, 5, 6, 7], files7) === '', 'B7 显式全选也归一成空');
  ok(L([0, -1, 'x'], files7) === '', 'B8 非法 index 全被过滤（不许把空选择传下去）');
}

ok(/bt-metadata-only/.test(ENGINE) && /bt-save-metadata/.test(ENGINE), 'B9 只取元数据（不取正文）');
ok(/--enable-dht=true/.test(ENGINE), 'B10 磁力必须开 DHT');
ok(/rpc-listen-all=false/.test(ENGINE), 'B11 RPC 不许监听全网（否则等于开放任意路径写文件）');
ok(/rpc-secret=/.test(ENGINE) && /randomBytes\(32\)/.test(ENGINE), 'B12 每次启动随机 secret');
ok(/freePort\(\)/.test(ENGINE) && /listen\(0, '127\.0\.0\.1'/.test(ENGINE), 'B13 随机端口且只绑回环');
ok(/delete env\[k\]/.test(ENGINE), 'B14 启动时清掉代理环境变量（BT 不走 HTTP 代理）');
ok(/apt-get/.test(ENGINE) && /installTried/.test(ENGINE), 'B15 无 aria2 时 apt 幂等安装（只试一次）');
ok(/reconcile/.test(ENGINE) && /infoHash/i.test(ENGINE), 'B16 重启用 infoHash 对账（gid 会变）');

/* ★ 进度口径：分子分母**必须同口径**（都取 aria2 的 torrent 级字段），否则线上出过两种荒谬读数：
   · 分子用 completedLength、分母用「所选文件之和」⇒「4,079,169 / 69」（勾了 1 个 69 B 的 .bat）；
   · 反过来 ⇒ 进度长期 0%（piece 没下完时文件的 completedLength 不动）。
   现在「传输量」当进度、「所选文件体积」用 selTotalBytes 单独展示，两个字段不许合并回去。 */
const ENGINE_CODE = ENGINE
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

ok(/Number\(st\.totalLength\)/.test(ENGINE_CODE) && /Number\(st\.completedLength\)/.test(ENGINE_CODE),
  'B17 进度分子分母都取 torrent 级字段（同口径）');
ok(!/selDone/.test(ENGINE_CODE), 'B18 不许把「选中文件的完成量」当分子（会长期 0%）');
ok(/selTotalBytes/.test(ENGINE_CODE) && /f\.selected === 'true'/.test(ENGINE_CODE),
  'B18b 仍保留「所选文件体积」单独字段（供 UI 展示）');
ok(/if\s*\(completedBytes\s*>\s*totalBytes\)\s*completedBytes\s*=\s*totalBytes/.test(ENGINE_CODE),
  'B19 完成字节夹紧，不许超过传输总量');
ok(/===\s*'complete'\)\s*completedBytes\s*=\s*totalBytes/.test(ENGINE_CODE), 'B20 complete 时强制 100%（块对齐余量不显示 98%）');

/* 服务端：建任务时 totalBytes 必须留 0 交给引擎回填，selBytes 记所选体积 —— 合并成一个字段就会复发上面的错。 */
ok(/selBytes:\s*pickedBytes,\s*totalBytes:\s*0/.test(SERVER), 'B21 建任务时 selBytes=所选体积、totalBytes 留 0 待回填');
ok(/fields\.selBytes/.test(SERVER) && /fields\.totalBytes\s*=\s*s\.totalBytes/.test(SERVER), 'B22 dlSync 两个体积分别回填');
/* ★ 存进任务对象不等于前端收得到：dlTaskView 是字段白名单，漏一个字段线上就是 undefined
   （v10.93.3 实测踩到：selBytes 明明写进了任务表，UI 却显示「所选 0B」）。 */
ok(/selBytes:\s*t\.selBytes/.test(SERVER), 'B23 dlTaskView 下发 selBytes（白名单漏字段 = 前端恒 undefined）');

/* ══════════════ C. server.js 护栏 ══════════════ */
console.log('── C 服务端护栏 ──');

['/api/downloads/previews', '/api/downloads/batches', '/api/downloads/tasks', '/api/downloads/quota'].forEach((p, i) => {
  ok(SERVER.includes(p), 'C' + (i + 1) + ' 路由存在 ' + p);
});
ok(/\/api\/downloads\/tasks\/:id\/actions/.test(SERVER), 'C5 任务控制路由存在');
ok(/\/api\/downloads\/tasks\/:id\/files\/:fid/.test(SERVER), 'C6 保存到电脑路由存在');
ok(/api\/downloads\/debug/.test(SERVER) && /if \(!adminGuard\(req, res\)\) return;[\s\S]{0,400}dlEngine\.ready/.test(SERVER),
  'C7 debug 端点受 adminGuard 保护');
ok(/startsWith\(path\.resolve\(base\) \+ path\.sep\)/.test(SERVER), 'C8 保存文件前做路径越界检查（种子文件名可构造）');
ok(/if \(t\.state !== 'ready'\)/.test(SERVER), 'C9 未就绪不许下载（不许把半截文件给用户）');
/* ★ v10.93.2 改判：任务 id 从 6 位随机提到 80 bit，成为访问凭据；
   IP 不再当唯一凭据（线上实测同一脚本两次请求出口 IP 不同）。 */
ok(/crypto\.randomBytes\(10\)\.toString\('hex'\)/.test(require('fs').readFileSync(path.join(ROOT,'data','download-tasks.js'),'utf8')),
  'C10 任务 id 用 80 bit 随机（id 即凭据，不可枚举）');
ok(/ids\.length \? ids\.includes\(t\.id\) : t\.ip === ip/.test(SERVER), 'C10b 列表支持 ?ids= 显式查询（绕开 IP 漂移）');
ok(!/torrentPath\s*:/.test(SERVER.slice(SERVER.indexOf('res.json({\n      ok: true, previewId'), SERVER.indexOf('res.json({\n      ok: true, previewId') + 700)),
  'C11 preview 响应不下发 torrentPath（前端传路径可读服务器任意文件）');
ok(/DLP\.get\(String\(\(req\.body && req\.body\.previewId\)/.test(SERVER), 'C12 入队只认服务端发的 previewId');
ok(/预览已过期/.test(SERVER), 'C13 预览过期有明确回话（不是「未知错误」）');
ok(/maxTaskBytes/.test(SERVER), 'C14 配额端点回传上限（前端先问，避免点完才被拒）');

/* ══════════════ D. 前端 ══════════════ */
console.log('── D 前端 ──');

ok(HTML.includes('id="fgCloud"'), 'D1 云下载弹窗 DOM 存在');
ok(/#fgCloud\{z-index:125\}/.test(HTML), 'D2 #fgCloud z-index=125（必须高于 #fgDl 的 120）');
ok(HTML.includes('☁ 云下载</button>'), 'D3 磁力按钮文案改为「☁ 云下载」');
ok(HTML.includes('⬇ 镜像分卷</button>'), 'D4 直链按钮文案改为「⬇ 镜像分卷」');
ok(!HTML.includes('⬇ 直链下载'), 'D5 旧文案「⬇ 直链下载」已清除（它是对用户的空承诺）');
ok(/data-fg-magnet="' \+ esc\(it\.slug\) \+ '"'\s*\+\s*' data-fg-title=/.test(HTML), 'D6 磁力按钮带 title（弹窗副标题用）');
ok(HTML.includes('Wrong captcha') && HTML.includes('Cloudflare'), 'D7 直链弹窗如实写明三站要过验证码');
ok(HTML.includes('不用装任何客户端'), 'D8 云下载弹窗写明「不用装任何客户端」');

const iCloud = HTML.indexOf("const fgc = $('#fgCloud')");
const iDl = HTML.indexOf("const fgdl = $('#fgDl')");
ok(iCloud > 0 && iDl > 0 && iCloud < iDl, 'D9 ESC 先关云下载(125)再关直链(120) —— 顺序反了会一次关两层');

const fgcBody = grabFn(HTML, 'fgcBodyHtml');
const fgcFmt = grabFn(HTML, 'fgcFmt');
const fgcFoot = grabFn(HTML, 'fgcFootHtml');
ok(!!fgcBody && !!fgcFmt && !!fgcFoot, 'D10 渲染拆成纯函数（fgcBodyHtml / fgcFmt / fgcFootHtml）');
ok(!/document\.|querySelector/.test(fgcBody || ''), 'D11 fgcBodyHtml 不碰 DOM（可静态验四类形态）');

let V = null;
try {
  const escSrc = (HTML.match(/const esc = \(s\) => [^\n]+/) || [''])[0];
  const labelSrc = (HTML.match(/const FGC_LABEL = \{[\s\S]*?\};/) || [''])[0];
  const apiSrc = "const api = (u) => u;";
  // eslint-disable-next-line no-new-func
  V = new Function(escSrc + '\n' + labelSrc + '\n' + apiSrc + '\n' + fgcFmt + '\n' + fgcBody + '\n' + fgcFoot +
    '\nreturn { body: fgcBodyHtml, foot: fgcFootHtml };')();
} catch (e) { V = null; }
ok(!!V, 'D12 纯函数可注入执行');
if (V) {
  const loading = V.body({ state: 'loading' });
  ok(/解析种子元数据/.test(loading) && /fgc-spin/.test(loading), 'D13 loading 文案 + 转圈');

  const tooBig = V.body({ state: 'too-large', err: '任务体积 86.1 GB，超过本站单任务上限 30.0 GB' });
  ok(/86\.1 GB/.test(tooBig) && /复制磁力/.test(tooBig), 'D14 超限要说清体积并给出替代方案');

  const errDead = V.body({ state: 'error', err: '解析种子超时' });
  ok(/死种/.test(errDead), 'D15 失败提示区分「死种」这一最常见原因');

  const pv = {
    totalBytes: 2899403151, btih: 'F4A9BCB8F01117A2FBF302236559A0E68E25F7DB',
    files: [
      { index: 1, name: 'fg-01.bin', length: 2685689856 },
      { index: 6, name: 'setup.exe', length: 4270111 },
    ],
  };
  const filesHtml = V.body({ state: 'files', preview: pv });
  ok(/data-fgcf="1"/.test(filesHtml) && /data-fgcf="6"/.test(filesHtml), 'D16 文件清单逐条带勾选框');
  ok(/checked/.test(filesHtml), 'D17 默认全选（用户口径：多个有效链接默认全选）');
  ok(/2\.70 GB/.test(filesHtml), 'D18 合计体积按 GB 格式化');
  ok(V.foot({ state: 'files', preview: pv, magnet: 'magnet:?xt=urn:btih:X' }).includes('开始服务器下载'),
    'D19 files 态有「开始服务器下载」');
  ok(V.foot({ state: 'files', preview: pv, magnet: 'magnet:?xt=urn:btih:X' }).includes('复制磁力'),
    'D20 「复制磁力」常驻（服务器不可用时用户仍有出路）');

  const DL = V.body({ state: 'downloading', task: { totalBytes: 100, completedBytes: 42, speed: 1048576, files: [] } });
  ok(/width:42\.0%/.test(DL), 'D21 进度条按 completed/total 计算');
  ok(/1\.0 MB\/s/.test(DL), 'D22 速度格式化');
  const RDY = V.foot({ state: 'ready', magnet: 'm', task: { id: 'dl_x', files: [{ index: 6, name: 'setup.exe' }] } });
  ok(/\/api\/downloads\/tasks\/dl_x\/files\/6/.test(RDY), 'D23 就绪后给出保存链接（带任务与文件 id）');
  ok(/download/.test(RDY), 'D24 保存按钮带 download 属性');
  const XSS = V.body({ state: 'error', err: 'A<b>C' });
  ok(XSS.includes('&lt;b&gt;') && !XSS.includes('<b>C'), 'D25 错误文案被转义（不许把后端文本当 HTML 插进去）');
  /* ★ 线上实测：只勾 1 个 103 KB 的 QuickSFV.EXE，80 秒仍在下载、aria2 报已完成 2.7 MB。
     根因是 BT 按 piece 下载（该块 MB 级，必须整块下完才能校验）。
     用户不知道这一点就会认为「小文件都这么慢，产品坏了」⇒ 下载态必须有这句。 */
  ok(/按块下载/.test(DL) && /整块/.test(DL), 'D26 下载态说明「BT 按块下载」，否则小文件慢会被当成故障');
  const OVER = V.body({ state: 'downloading', task: { totalBytes: 100, completedBytes: 999, speed: 0, files: [] } });
  ok(/width:100\.0%/.test(OVER) && !/width:999/.test(OVER), 'D27 完成数超过总量时夹紧到 100%（线上出现过 992KB/101KB）');
  /* 线上真实个案：勾 1 个 69 B 的 .bat，服务器实际要传 4,079,169 B（一个 piece）。
     进度按传输量算，但必须让用户看得到「我勾的只有 69 B」。 */
  const SEL = V.body({ state: 'downloading', task: { totalBytes: 4079169, completedBytes: 1000000, selBytes: 69, speed: 0, files: [] } });
  ok(/所选文件 69 B/.test(SEL), 'D28 传输量远大于所选文件时，单独标出「所选文件」体积');
}

/* ══════════════ E. 派生页继承 ══════════════ */
console.log('── E 派生页 ──');
for (const p of ['emulator.html', 'unpack.html', 'resources.html', 'extract.html']) {
  const h = fs.readFileSync(path.join(ROOT, 'public', p), 'utf8');
  ok(h.includes('id="fgCloud"') && /#fgCloud\{z-index:125\}/.test(h), 'E-' + p + ' 带上云下载弹窗与层级');
}

console.log('\n====');
console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) { console.log('失败项：'); fails.forEach((f) => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
