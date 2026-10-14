/**
 * tools/test-v1072-download.js — 第一层（静态/离线）：验收「下载按钮 → 自动解压」这一版
 *
 * v10.72 新增。需求原话（2026-10-14）：
 *   「如果我想直接通过下载按钮的话怎么样自动解压」
 *
 * ★ v10.73 改造（2026-10-14 同日晚）：用户拍板「不要解压按钮，默认到下载中」，
 *   `expectArchive` 被删除、语义从「不是压缩包就**丢**」反转为「不是压缩包就**照存**」
 *   （只有 HTML 网页仍然丢弃）。本套件里 E4/E5 的**断言方向随之反转**、
 *   E5 换成一条新的回归保护 —— 详见各自注释。**这不是回退代码**，是版本升级。
 *
 * 覆盖三块：
 *   ① 嗅探层：`sniffBuffer` 单一真源（sniff 与网络流两条路必须**同一份判据**）
 *   ② 下载层：`downloadTo` 的**头部早期判定** —— HTML 中间页必须止损且一个字节都不落盘
 *   ③ 接缝层：页面/服务端结构（属性挂在真直链上、浮层由 JS 创建、护栏都在）
 *
 * ★ 为什么下载层用**本地 HTTP 服务器**造响应、而不是打真实源站：
 *   源站状态会变（本轮实测：存档直链 30 条里 2 条已经是 404）。把防线绑在别人
 *   家的可用性上，红了也分不清「我们坏了」还是「人家抽风」。
 *   真实源站的结论由一次性实测记录（见 docs/versions/v10.72.md 第 ① 节）。
 *
 * ★ 为什么要专门测「大 chunk」那一档（E3）：
 *   v10.71 的 HTML 早判写成 `if (got <= 400) { …判 HTML… }` —— 只要首个 chunk
 *   就大于 400 字节，**那次判定被整个跳过**。本地服务器一次 write 一大坨就能复现，
 *   而当时的防线全都是绿的（它们都在测小响应）。这类「判据的作用域写窄了」
 *   只能靠**专造那一档输入**才照得出来。
 *
 * 跑法：node tools/test-v1072-download.js
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const EX = require('../data/extractor');

const SEVENZ = EX.resolve7z();
/* ★ 工作目录按 pid 唯一化 ⇒ 天然干净起点，于是**全程不做递归删除**。
   原因见 PITFALLS 铁律 107（宿主安全删除守卫按「本 turn 累计删 >50 文件」拦 rmSync，
   三个套件连跑就撞线，症状是「全量跑某套 exit 1、单独跑全绿」= 防线自己报假红）。 */
const ROOT = path.join(__dirname, '..', '_test-out', 'v1072-dl-' + process.pid);
const PUB = path.join(__dirname, '..', 'public');
const SRV = path.join(__dirname, '..', 'server.js');

let pass = 0, fail = 0;
function chk(name, ok, extra) {
  if (ok) { pass++; console.log('  ✅ ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '   ' + extra : '')); }
}
function hr(t) { console.log('\n' + '─'.repeat(74) + '\n' + t + '\n' + '─'.repeat(74)); }
const ls = (d) => { try { return fs.readdirSync(d); } catch (e) { return []; } };

/* 造样本用（与 extractor 同款调用：关 stdin、给超时） */
function sh(args) {
  return new Promise((res) => {
    const cp = spawn(SEVENZ, [...args, '-sccUTF-8'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let so = '', se = '', done = false;
    const fin = (r) => { if (!done) { done = true; clearTimeout(to); res(r); } };
    const to = setTimeout(() => { try { cp.kill('SIGKILL'); } catch (e) { /* 已退 */ } fin({ code: -2, stdout: so, stderr: se }); }, 40000);
    cp.stdout.on('data', (d) => { so += d; });
    cp.stderr.on('data', (d) => { se += d; });
    cp.on('close', (c) => fin({ code: c == null ? -1 : c, stdout: so, stderr: se }));
  });
}

/** 本地可控 HTTP 服务：每条路由自己决定吐什么。端口由系统分配（0），不会撞车。 */
/* ★★ `slowState` 是 E8 的判据核心：只有**服务器自己**才知道「客户端是不是提前断开了」。
 *   前几条断言（E2/E3/E4）只能证明「结论对 + 没落盘」，但证明不了**是提前止损还是
 *   先把它下完再下结论** —— 而「不是压缩包就立刻停」正是本版的核心承诺。
 *   做法：这条路由先吐一大块（> 512 字节，足够触发判定），再**慢慢**吐剩下一大坨；
 *   如果客户端真的提前断了，`res.writableFinished` 会是 false。 */
const slowState = { closedEarly: false, finished: false };

const ROUTES = {
  /* 真 zip（E1 阳性对照） */
  '/zip': (res) => {
    const b = fs.readFileSync(path.join(ROOT, 'sample.zip'));
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': b.length });
    res.end(b);
  },
  /* 小 HTML（< 400 字节）：v10.71 原本就能判出来 */
  '/html-small': (res) => {
    const b = Buffer.from('<!DOCTYPE html><html><body>请先登录</body></html>', 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': b.length });
    res.end(b);
  },
  /* ★ 大 HTML：一次 write 出去、远大于 400 字节 —— 专打「got <= 400」那个旧判据 */
  '/html-big': (res) => {
    const b = Buffer.from('<!DOCTYPE html><html><body>' + '<p>百度网盘 请登录后查看</p>'.repeat(120) + '</body></html>', 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': b.length });
    res.end(b);
  },
  /* 纯二进制但不是压缩包（PNG 魔数开头） */
  '/bin': (res) => {
    const b = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(4096, 0x42)]);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': b.length });
    res.end(b);
  },
  /* ★★ E8：先吐 >512 字节（够判定了），再**慢慢**吐一大坨。客户端应当提前断开。 */
  '/html-slow': (res) => {
    slowState.closedEarly = false;
    slowState.finished = false;
    const head = Buffer.from('<!DOCTYPE html><html><body>' + '<p>百度网盘 请登录后查看</p>'.repeat(60), 'utf8');
    const tail = Buffer.from('<p>后面还有一大堆内容，正常情况不该被读完</p>'.repeat(3000), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.write(head);
    let sent = 0;
    const tick = setInterval(() => {
      if (res.writableEnded || res.destroyed) { clearInterval(tick); return; }
      res.write(tail.slice(sent, sent + 8192));
      sent += 8192;
      if (sent >= tail.length) { clearInterval(tick); res.end(); slowState.finished = true; }
    }, 15);
    res.on('close', () => { clearInterval(tick); slowState.closedEarly = !res.writableFinished; });
    setTimeout(() => { clearInterval(tick); try { res.end(); } catch (e) { /* 已结束 */ } }, 9000);
  },
};

function startServer() {
  return new Promise((res) => {
    const s = http.createServer((req, resp) => {
      const u = String(req.url || '').split('?')[0];
      const h = ROUTES[u];
      if (!h) { resp.writeHead(404, { 'Content-Type': 'text/html' }); resp.end('<html>404</html>'); return; }
      h(resp);
    });
    s.listen(0, '127.0.0.1', () => res({ s, base: 'http://127.0.0.1:' + s.address().port }));
  });
}

(async () => {
  fs.mkdirSync(ROOT, { recursive: true });

  /* ══════════════ 1 嗅探层：单一真源 ══════════════ */
  hr('1 sniffBuffer / headKind（纯函数，不依赖 7z 与网络）');
  chk('S1 ★ 阳性对照 zip', EX.sniffBuffer(Buffer.from('504b0304' + '00'.repeat(20), 'hex')) === 'zip',
    String(EX.sniffBuffer(Buffer.from('504b0304' + '00'.repeat(20), 'hex'))));
  chk('S2 ★ 阳性对照 rar', EX.sniffBuffer(Buffer.from('526172211a0700' + '00'.repeat(20), 'hex')) === 'rar');
  chk('S3 ★ 阳性对照 7z', EX.sniffBuffer(Buffer.from('377abcaf271c' + '00'.repeat(20), 'hex')) === '7z');
  chk('S4 阴性对照 纯文本 → null', EX.sniffBuffer(Buffer.from('hello world, this is plain text')) === null);
  chk('S5 阴性对照 HTML → null', EX.sniffBuffer(Buffer.from('<!DOCTYPE html><html>')) === null);
  chk('S6 边界 空 buffer → null', EX.sniffBuffer(Buffer.alloc(0)) === null);
  chk('S7 边界 不足 4 字节 → null', EX.sniffBuffer(Buffer.from([0x50, 0x4b])) === null);
  chk('S8 tar 认 offset 257 的 ustar', (() => {
    const b = Buffer.alloc(300, 0x20);
    b.write('ustar', 257, 'binary');
    return EX.sniffBuffer(b) === 'tar';
  })());
  chk('S9 ★★ 传超大 buffer 也不炸（内部自己截断到 512）', (() => {
    const big = Buffer.concat([Buffer.from('504b0304', 'hex'), Buffer.alloc(3 * 1024 * 1024, 0x41)]);
    return EX.sniffBuffer(big) === 'zip';
  })(), '3MB buffer');
  chk('H1 headKind：压缩包 → archive', (EX.headKind(Buffer.from('504b0304' + '00'.repeat(20), 'hex')) || {}).kind === 'archive');
  chk('H2 headKind：网页 → html', (EX.headKind(Buffer.from('<!DOCTYPE html><html><body>x')) || {}).kind === 'html');
  chk('H3 headKind：其它 → other', (EX.headKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])) || {}).kind === 'other');

  /* ══════════════ 2 单一真源：文件路 vs 字节流路 ══════════════ */
  hr('2 ★ sniff(文件) 与 sniffBuffer(字节流) 必须是同一份判据');
  if (SEVENZ) {
    fs.writeFileSync(path.join(ROOT, 'hello.txt'), 'hello GameHub');
    await sh(['a', '-tzip', path.join(ROOT, 'sample.zip'), path.join(ROOT, 'hello.txt')]);
  }
  const zipPath = path.join(ROOT, 'sample.zip');
  const hasZip = fs.existsSync(zipPath);
  chk('M0 阳性对照：真 zip 样本已造出', hasZip, hasZip ? fs.statSync(zipPath).size + ' B' : '7z 缺失或失败');
  if (hasZip) {
    const head = fs.readFileSync(zipPath).slice(0, 512);
    chk('M1 ★ 两条路结果一致（zip）', EX.sniff(zipPath) === 'zip' && EX.sniffBuffer(head) === 'zip',
      'sniff=' + EX.sniff(zipPath) + ' sniffBuffer=' + EX.sniffBuffer(head));
  }
  fs.writeFileSync(path.join(ROOT, 'plain.txt'), 'not an archive at all');
  chk('M2 两条路结果一致（纯文本 → null）',
    EX.sniff(path.join(ROOT, 'plain.txt')) === null && EX.sniffBuffer(fs.readFileSync(path.join(ROOT, 'plain.txt'))) === null);

  /* ══════════════ 3 下载层：头部早期判定 ══════════════ */
  hr('3 downloadTo 的头部早期判定（本地 HTTP 造可控响应）');
  const { s: srv, base } = await startServer();
  const D = path.join(ROOT, 'dl');
  fs.mkdirSync(D, { recursive: true });
  const snap = () => ls(D).sort().join('|');

  /* E1 真 zip：必须成功落盘，并如实回带 sniffed / archive */
  if (hasZip) {
    const b0 = snap();
    const r = await EX.downloadTo(base + '/zip', D, {});
    chk('E1 真 zip → ok + sniffed=zip + archive=true + 落盘',
      r.ok === true && r.sniffed === 'zip' && r.archive === true && ls(D).length > b0.split('|').filter(Boolean).length,
      'ok=' + r.ok + ' sniffed=' + r.sniffed + ' archive=' + r.archive);
  }

  /* E2 小 HTML：判 not-archive，且不落盘 */
  {
    const b0 = snap();
    const r = await EX.downloadTo(base + '/html-small', D, {});
    chk('E2 小 HTML → notArchive + 不落盘', r.ok === false && r.notArchive === true && snap() === b0,
      'error=' + r.error);
  }

  /* E3 ★★ 大 HTML（一次 write 远大于 400 字节）：专打旧判据 `got <= 400` */
  {
    const b0 = snap();
    const r = await EX.downloadTo(base + '/html-big', D, {});
    chk('E3 ★★ 大 HTML（>400B 单 chunk）仍被判出 + 不落盘', r.ok === false && r.notArchive === true && snap() === b0,
      'error=' + r.error);
  }

  /* E4 ★★ v10.73 语义反转：非压缩包二进制 **照存**
   *   旧行为（expectArchive）是「不是压缩包就丢弃且一个字节不落盘」—— 那是配着
   *   并列的第二个按钮用的；v10.73 只剩「⬇ 直接下载」一个按钮、它就是下载本身，
   *   再丢弃 = 「点了没结果」⇒ 改成照存，由返回值 `archive:false` 如实告诉调用方。
   *   ⚠️ 这条断言的**方向是反的**（相对 v10.72），是版本升级的正常结果，不是回退。 */
  {
    const b0 = snap();
    const r = await EX.downloadTo(base + '/bin', D, {});
    chk('E4 ★★ 非压缩包二进制 → **照存**（ok + archive=false + 真落盘）',
      r.ok === true && r.archive === false && r.head === 'other' &&
      ls(D).length > b0.split('|').filter(Boolean).length,
      'ok=' + r.ok + ' archive=' + r.archive + ' head=' + r.head + ' size=' + r.size);
  }

  /* E5 ★★ 回归保护（方向与 E4 相反，两条一起才封住口径）：
   *   「照存」放宽的**只有** other 那一类 —— HTML 必须仍然是唯一被丢弃的类别。
   *   ⚠️ 这条断言必须传一个**尚不存在**的目录：上一版用的 D 是预先建好的，
   *   结构上照不出下面这个 bug。v10.73 首轮实测就是靠「新目录」才照出来的 ——
   *   `downloadTo` 一进门 `mkdirSync(destDir)`，于是网页地址也会在磁盘上留下
   *   一个空文件夹（真目录里那个 `测试网盘页_存档_VP0_…` 空目录）。 */
  {
    const D2 = path.join(ROOT, 'dl-never-' + Date.now().toString(36));
    const r = await EX.downloadTo(base + '/html-small', D2, {});
    chk('E5 ★★ not-archive 时**连目标目录都不许被建出来**（放宽带只对 other 生效）',
      r.ok === false && r.notArchive === true && !fs.existsSync(D2),
      'ok=' + r.ok + ' notArchive=' + r.notArchive + ' 目录是否被建=' + fs.existsSync(D2));
  }

  /* E6 404 ⇒ 是「下载失败」，不能冒充「不是压缩包」 */
  {
    const b0 = snap();
    const r = await EX.downloadTo(base + '/nope', D, {});
    chk('E6 404 → ok=false 且**不带** notArchive（两种处置不能混）',
      r.ok === false && !r.notArchive && snap() === b0, 'error=' + r.error);
  }

  /* E8 ★★ 提前止损 —— 本版的核心承诺，而上面 E2~E5 都**证明不了**它
   *    （它们只看「结论对不对 + 有没有落盘」，把「先下完再下结论」也判成通过）。
   *    判据只能来自**服务器自己**：客户端提前断开 ⇒ res.writableFinished 为 false。 */
  {
    const b0 = snap();
    const r = await EX.downloadTo(base + '/html-slow', D, {});
    for (let i = 0; i < 12 && !slowState.closedEarly; i++) await new Promise((s) => setTimeout(s, 120));
    chk('E8a 慢速大响应同样判 notArchive', r.ok === false && r.notArchive === true, 'error=' + r.error);
    chk('E8b ★★ 服务端观察到我们**提前断开**（是止损，不是下完再说）',
      slowState.closedEarly === true,
      'closedEarly=' + slowState.closedEarly + ' 服务器是否吐完=' + slowState.finished);
    chk('E8c 慢速这一路也没落盘', snap() === b0);
  }

  /* E7 ★★ 核心承诺：早停场景一个字节都没进目录（只有 E1 的 zip 与 E4 的照存文件） */
  chk('E7 ★★ 早停场景合计零落盘（目录里只有 E1/E4 那两个文件）',
    ls(D).length === (hasZip ? 2 : 1), ls(D).join(', '));

  srv.close();

  /* ══════════════ 4 接缝层：页面结构 ══════════════ */
  hr('4 页面结构（五张页面必须一致地带上新代码）');
  const PAGES = ['index.html', 'extract.html', 'unpack.html', 'resources.html', 'emulator.html'];
  const src = {};
  for (const f of PAGES) {
    try { src[f] = fs.readFileSync(path.join(PUB, f), 'utf8'); } catch (e) { src[f] = ''; }
  }
  const readAll = (fn) => PAGES.every((f) => src[f] && fn(src[f]));
  chk('P1 ★ 五页都有 exdAttr 函数（v10.73：由 exdBtn 改成属性串生成器）',
    readAll((s) => /function exdAttr\s*\(/.test(s)));
  /* ★ 下面三条判据都刻意**带上文**（行首缩进 / 前置语句），不是裸子串搜索 ——
   *   裸子串会被注释骗：把代码注释掉，那串字还在，断言照样绿（PITFALLS 104）。 */
  chk('P2 五页都有浮层创建（createElement 之后紧跟着 d.id = \'exDock\'）',
    readAll((s) => /document\.createElement\('div'\)[\s\S]{0,160}?\.id\s*=\s*'exDock'/.test(s)));
  chk('P3 ★ 五页都有「产物路径」样式 .exd-path（v10.73 新增，替掉 .exd-go）',
    readAll((s) => /^\s*\.exd-path\{/m.test(s)));
  chk('P4 五页都保留了 .exd-pw[hidden]（否则 hidden 会被 display:flex 顶掉）',
    readAll((s) => /^\s*\.exd-pw\[hidden\]\{display:none\}/m.test(s)));
  /* ★ v10.73 挂载点变了：**不再新造按钮**，而是把 `data-ex-url` 挂在两处**已有 `<a>` 本体**上。
   *   判据把「href 用的是同一个直链」一起写进去 —— 防止有人把属性挂到一个 href 是别的东西
   *   的 `<a>` 上（那样点了会去错地方），也让「裸子串搜索被注释骗」这一条不成立。 */
  chk('P5 ★ 两处挂载点：属性挂在已有 <a> 上、且与 href 同源（存档 direct + GT 首链）',
    readAll((s) => /href="'\s*\+\s*esc\(f\.direct\)[\s\S]{0,80}?exdAttr\(f\.direct/.test(s) &&
      /href="'\s*\+\s*esc\(l\.url\)[\s\S]{0,140}?exdAttr\(l\.url/.test(s)));
  chk('P6 点击走 document 上的事件委托（派生页也安全）',
    readAll((s) => /document\.addEventListener\('click'/.test(s) && /data-ex-url/.test(s)));

  const idx = src['index.html'];
  chk('P7 ★★ 主源 HTML 里**没有** id="exDock" 标签（浮层必须由 JS 现创建）',
    !/<div[^>]*id="exDock"/.test(idx),
    '派生页脚本是从主源整段抽的，主源有/派生页没有的节点会 addEventListener of null 并中断整段脚本');
  chk('P8 ★ 脚本里没有对 #exDock 的顶层 querySelector（只能在 createElement 出来的 d 上查）',
    !/document\.querySelector\(\s*['"]#exDock/.test(idx));
  chk('P9 按钮只在**本机**渲染（非 localhost 返回空串）',
    /if\s*\(!url\s*\|\|\s*!exdLocal\(\)\)\s*return\s*''/.test(idx));
  chk('P10 exdLocal 白名单含 localhost / 127.0.0.1 / ::1',
    /exdLocal\s*\(\)\s*\{[\s\S]{0,220}?localhost/.test(idx) &&
    /exdLocal\s*\(\)\s*\{[\s\S]{0,220}?127\\\.0\\\.0\\\.1/.test(idx) &&
    /exdLocal\s*\(\)\s*\{[\s\S]{0,220}?::1/.test(idx));
  /* ★ v10.73：P11 由「解压按钮被条件渲染」改成**反向守卫** —— 那一版是「新增一个并列按钮」，
   *   这一版是「把它拆掉、让原按钮带上属性」。所以断言方向反过来：
   *   ① 旧按钮的痕迹（函数名 / 类名）一个都不许剩 —— 半拆会留下两套语义；
   *   ② 属性必须挂在**已经渲染出来的 `<a class="pri">`** 上，而不是新 push 一个元素。 */
  chk('P11 ★★ 「🗜️ 解压」按钮已彻底拆除（exdBtn / .exd-go 一个不剩）',
    !/function exdBtn\s*\(/.test(idx) && !/\.exd-go\b/.test(idx));
  chk('P11b ★ 属性挂在那**同一个** `<a class="pri">⬇ 直接下载</a>` 上（v10.73「一个按钮」）',
    /'<a class="pri" href="'\s*\+\s*esc\(f\.direct\)\s*\+\s*'"'\s*\+\s*[\s\S]{0,60}?exdAttr\(f\.direct/.test(idx));
  chk('P12 轮询有次数上限（PITFALLS 43：长跑必须熔断）',
    /exdTicks\s*>\s*\d+/.test(idx));
  chk('P13 完成态给了「复制路径」（打开文件夹失败时的出路）',
    /exdCopyPath|复制路径/.test(idx) && /navigator\.clipboard/.test(idx));
  chk('P14 待解密态给了密码输入 + 续跑接口',
    /id=\\?"exdPwIn/.test(idx) && /\/api\/extract\/password/.test(idx));

  /* ══════════════ 5 接缝层：服务端 ══════════════ */
  hr('5 服务端结构');
  const sv = fs.readFileSync(SRV, 'utf8');
  chk('V1 有 not-archive 状态（与 error 分开）', /'not-archive'/.test(sv));
  chk('V2 exSnapshot 如实带出 notArchive / sniffed / contentType',
    /notArchive:\s*!!t\.notArchive/.test(sv) && /sniffed:\s*t\.sniffed/.test(sv) && /contentType:\s*t\.contentType/.test(sv));
  chk('V3 download 任务把 notArchive 透给任务对象', /t\.notArchive\s*=\s*!!dl\.notArchive/.test(sv));
  chk('V4 有 /api/extract/open', /app\.post\('\/api\/extract\/open'/.test(sv));
  chk('V5 ★ open 的护栏：必须落在 DEFAULT_DEST 之内（判据带 return，防被注释骗）',
    /return res\.status\(400\)\.json\(\{ ok: false, error: '只允许打开解压目录内的路径/.test(sv) &&
    /startsWith\(root \+ path\.sep\)/.test(sv));
  chk('V6 open 的子进程 stdio 显式写全（铁律 38）',
    /spawn\('explorer\.exe',\s*\[d\.dir\],\s*\{\s*detached:\s*true,\s*stdio:\s*\['ignore',\s*'ignore',\s*'ignore'\]/.test(sv));
  /* ★ v10.73：V7 由「下载任务默认要求压缩包（expectArchive !== false）」改成
   *   「下载任务先算好子目录、并把 `archive` 如实落在任务对象上」。
   *   旧参数已从代码里删除 ⇒ 顺便加一条**负向守卫**：不许有人把它加回来
   *   （加回来会静默恢复「不是压缩包就丢」这条已被用户否决的行为）。 */
  chk('V7 ★★ 非压缩包走 saved（不是 error）—— 如实标记，不报红',
    /t\.state\s*=\s*'saved'/.test(sv) && /if\s*\(!dl\.archive\)\s*\{/.test(sv));
  chk('V7b ★ 任务带 `t.dir`（产物路径）且 `archive` 如实落值',
    /t\.dir\s*=\s*sub\.dir/.test(sv) && /t\.archive\s*=\s*!!dl\.archive/.test(sv));
  chk('V7c ★★ 负向守卫：`expectArchive` 不许被加回（已按用户拍板删除）',
    !/expectArchive\s*:/.test(sv) && !/opts\.expectArchive/.test(sv),
    '加回来会静默恢复「不是压缩包就丢弃」，而那个行为已被「不要解压按钮」的拍板取代');
  chk('V7d ★ 服务端自己从 URL 推原链名（不采信前端传的 name）',
    /extractor\.fileNameFromUrl\(url,\s*b\.name\)/.test(sv) && /taskDir\(root\.dir/.test(sv));
  chk('V8 ★ 启动器/探针之外的 tools 目录里没有遗留的 `7z` 裸键（v10.71 的整页 SyntaxError 教训）',
    !/\{\s*[^}]*[\s,{]7z\s*:/.test(idx));

  hr('验收汇总');
  /* ★ 收尾格式是约定（见 run-all 取成绩段）：同行含「通过」+ `n / m`，m 必须是**总数**。 */
  console.log('  通过 ' + pass + ' / ' + (pass + fail) + '（失败 ' + fail + '）');
  process.exit(fail ? 1 : 0);
})();
