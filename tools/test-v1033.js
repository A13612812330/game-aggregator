#!/usr/bin/env node
/* tools/test-v1033.js — v10.33「配置要求预热可跑全量」的静态防线
 *
 * 背景：主线 P0 是「把配置要求预热满」（实测可预热 18,131 条，已预热仅 ~700）。
 * 但上一版脚本**根本跑不了全量**，本轮修四件事，每件都是「改回去不报错、只是废掉」：
 *
 *   ① **只走封面一路 appid** —— 漏掉 3,124 条（顶层 `appid` 字段）。
 *      那批恰恰是**机地独有**的游戏（剑星 / 渔力全开 / 极限竞速：地平线 6），
 *      封面是 img2.52jidi.com、解析不出 appid ⇒ 旧脚本整批跳过。
 *      退回旧写法不报错，只是「最缺数据的那些永远没数据」。
 *
 *   ② **写盘非原子** —— `writeFileSync` 直接覆盖整份文件。5 小时长跑被打断到一半
 *      ⇒ 留下半截 JSON ⇒ 下次 `ensure()` 的 parse 抛错、被 catch 吞掉 ⇒
 *      **整份缓存静默归零**（表面完全看不出）。这是本轮风险最高的一处。
 *
 *   ③ **双重限流** —— `pcreq.throttled()` 内部已串行 + MIN_GAP 1100ms，
 *      旧脚本外层又固定 `wait(1100)` ⇒ 每条 2.2s、全量 **11 小时**（不是 5.5）。
 *      实测证据：`--limit=500` 跑 2m46s 连 100 条都没到（1.1s/条本该到 150 条）。
 *      同一个坑的第二种形态：退避写 `gap = Math.min(gap * 2, 12000)`，
 *      而 gap 初始 0 ⇒ `0*2` 恒为 0 ⇒ **看起来在退避，实际一点没等**。
 *
 *   ④ **前端读不到那 3,124 条** —— `/api/pcreq` 只从 `cover` 解析 appid。
 *      实测：预热已把剑星的 min+rec 完整抓回（appid 3489700），
 *      但线上查「剑星/Stellar_Blade」返回的是名称搜索命中的另一个条目
 *      （`appid=` 空 · `rec=无`）——**缓存里有、前端读不到**，而且质量更差。
 *
 * ★ 判据写法（本项目铁律）：
 *   · 锚点收窄到被守护的函数体 / 代码片段，不裸写整份源码；
 *   · 每条新机制都配一条**反向断言**（「不许再出现…」），且锚点判**形态**不判旧原话
 *     （v10.32 的教训：写死旧字样，换个写法就绕过）；
 *   · 能跑真行为的就跑真行为 —— 缓存层的四条断言在**隔离副本**里真跑一遍
 *     （`_test-out/v1033-cache/`，pcreq.js 用 `__dirname` 定位数据文件 ⇒ 副本自动隔离），
 *     只判文本「代码里写了 rename」是防不住「rename 写了但没生效」的。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const PCREQ = rd('data/pcreq.js');
const BUILD = rd('tools/build-steam-req.js');
const SERVER = rd('server.js');

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  — ' + extra : '')); }
  else { fail++; console.log('  × FAIL  ' + name + (extra ? '  — ' + extra : '')); }
};
const seg = (src, from, len) => {
  const i = src.indexOf(from);
  return i < 0 ? '' : src.slice(i, i + (len || 1600));
};
/* ★ 反向断言（「不许再出现旧写法」）扫描前**必须先剥掉注释**。
 *   本轮实测踩到：③e / ④f 两条反向断言扫全文 ⇒ 命中的根本不是代码，而是
 *   **本文件自己的注释** —— 文件头为了解释「旧实现错在哪」写了
 *   `原实现 appid: pcreq.appidOf(it.cover)` 与 `退避写 Math.min(gap * 2, 12000)`，
 *   于是「禁止旧写法」被自己的说明文字判红。
 *   把注释当代码判 = 逼着以后不敢在注释里解释历史，注释会越写越不敢说真话。
 *   ⚠️ 只剥注释、不剥字符串：字符串里出现旧写法就是真的写回去了（比如日志文案）。 */
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');
const PCREQ_C = stripComments(PCREQ);
const BUILD_C = stripComments(BUILD);
const SERVER_C = stripComments(SERVER);

console.log('\n=== ① 缓存层：原子写（防「写到一半被打断 ⇒ 整份缓存静默归零」） ===');
{
  const F = seg(PCREQ, 'const doWrite = () => {', 1500);
  ok(F.length > 200, '取到 flush 的 doWrite 函数体', F.length + ' 字节');
  ok(/const tmp = FILE \+ '\.tmp';/.test(F), '①a 先写 .tmp 临时文件，不再直接覆盖正本');
  ok(/fs\.renameSync\(tmp, FILE\)/.test(F), '①b 用同盘 rename 落位（读者只看到旧的或新的完整文件）');
  /* ★ 反向断言判「形态」：主路径**不许**再出现「直接 writeFileSync 覆盖 FILE」。
     回退分支里的直写允许存在（rename 在 Windows 可能 EBUSY），所以锚点收窄到
     「把 stringify 的结果直接写进 FILE」这个形态。 */
  ok(!/fs\.writeFileSync\(FILE, JSON\.stringify/.test(PCREQ_C),
    '①c ★反向：主路径不再有「直接覆盖正本」的写法（已剥注释后判）');
  const FB = seg(PCREQ, '} catch (e) {\n        try { fs.writeFileSync(FILE, json); }', 200);
  ok(FB.length > 20, '①d rename 失败时**有回退直写**（不让「换名失败」把数据卡死）');
}

console.log('\n=== ② 缓存层：批模式 + mergeDisk（真实行为，隔离副本里跑） ===');
{
  const DIR = path.join(ROOT, '_test-out', 'v1033-cache');
  fs.mkdirSync(DIR, { recursive: true });
  for (const f of fs.readdirSync(DIR)) { try { fs.unlinkSync(path.join(DIR, f)); } catch (e) { /* 目录里的都是本套件自己的残留 */ } }
  fs.copyFileSync(path.join(ROOT, 'data', 'pcreq.js'), path.join(DIR, 'pcreq.js'));
  const FILE = path.join(DIR, 'steam-req.json');
  const seed = (map) => fs.writeFileSync(FILE, JSON.stringify({ builtAt: 1, src: 'test', count: Object.keys(map).length, map }));
  const diskKeys = () => Object.keys(JSON.parse(fs.readFileSync(FILE, 'utf8')).map).sort();
  seed({ 111: { ts: 1, min: { cpu: 'a' } }, 222: { ts: 1, miss: true } });

  const pc = require(path.join(DIR, 'pcreq.js'));   // __dirname 指向副本 ⇒ 数据文件也被隔离
  ok(!!pc.peek('111'), '②a 隔离副本可用（peek 读到了种子数据）');
  ok(pc._file === FILE, '②b 副本的数据文件确实指向隔离目录', path.basename(DIR) + '/' + path.basename(pc._file));

  /* —— 批模式：关掉自动落盘后，save() 不应立刻写盘 —— */
  pc.setAutoFlush(false);
  pc.save('333', { min: { cpu: 'x' } });
  ok(diskKeys().join(',') === '111,222', '②c ★ setAutoFlush(false) 后 save() **不落盘**（批模式生效）',
    '磁盘仍是 ' + diskKeys().join(','));
  ok(pc.flushNow() === true, '②d flushNow() 返回「确实写了」');
  ok(diskKeys().join(',') === '111,222,333', '②e flushNow() 把内存增量落盘', diskKeys().join(','));
  ok(!fs.existsSync(FILE + '.tmp'), '②f ★ 原子写不留 .tmp 残留');

  /* —— mergeDisk：磁盘上「内存里没有」的键要能合并进来（防覆盖服务端新抓的） —— */
  seed({ 111: { ts: 1, min: { cpu: 'a' } }, 222: { ts: 1, miss: true }, 333: { ts: 1, min: { cpu: 'x' } }, 444: { ts: 9, min: { cpu: 'SERVICE' } } });
  const added = pc.mergeDisk();
  ok(added >= 1, '②g mergeDisk() 报出合并条数', '+' + added);
  ok(!!pc.peek('444'), '②h ★ 服务端新写的 444 被合并进内存（不会被本进程覆盖掉）');
  /* ⚠️ 这里必须判**值**而不是「键还在」：覆盖式实现（去掉 `if (!d.map[k])`）
     同样会让 peek('333') 为真 ⇒ 只判存在就抓不到。
     种子文件里 333 的 ts=1，内存里 333 的 ts=Date.now() ⇒ 被盖掉则 ts 变回 1。 */
  const e333 = pc.peek('333');
  ok(!!e333 && e333.ts > 1, '②i ★ mergeDisk 只补空缺、**不覆盖**内存里已有的键（判值不判键）',
    e333 ? 'ts=' + e333.ts : '取不到');
  pc.save('555', { min: { cpu: 'y' } });
  pc.flushNow();
  ok(diskKeys().join(',') === '111,222,333,444,555', '②j 落盘后磁盘同时有「服务端的 444」与「本次的 555」', diskKeys().join(','));
}

console.log('\n=== ③ 预热脚本：两路 appid（旧版整批漏掉 3,124 条机地独有游戏） ===');
{
  const L = seg(BUILD, 'function loadLib()', 700);
  ok(/const fromCover = pcreq\.appidOf\(it\.cover\);/.test(L), '③a 仍从封面解析 appid');
  ok(/const fromField = String\(it\.appid \|\| ''\)\.trim\(\);/.test(L), '③b 也读库内**顶层 appid 字段**');
  ok(/appid: fromCover \|\| fromField/.test(L), '③c 两路合并（封面优先，保持既有行为不变）');
  ok(/appidSrc:/.test(L), '③d 记录了来源（cover / field / both，便于核对覆盖数）');
  /* ★ 反向断言：旧写法是 `appid: pcreq.appidOf(it.cover)` —— 只走封面。
     ⚠️ 必须用剥注释后的源码判（文件头注释里就写着这句旧写法）。 */
  ok(!/appid:\s*pcreq\.appidOf\(it\.cover\)/.test(BUILD_C),
    '③e ★反向：不再写成「只取封面解析结果」（已剥注释后判）');
  ok(/pcreq\.resolve\(\{ title: it\.title, cover: it\.cover, appid: it\.appid \}\)/.test(BUILD),
    '③f 抓取时把合并后的 appid 传给 resolve（含只有字段的那批）');
}

console.log('\n=== ④ 预热脚本：限流只由 throttled 负责，不双重限流 ===');
{
  ok(/const GAP = parseInt\(val\('gap', '0'\), 10\);/.test(BUILD), '④a --gap 默认 0（外层不再重复等 1100ms）');
  ok(!/val\('gap', '1100'\)/.test(BUILD_C), '④b ★反向：不再把 1100 写成外层默认间隔');
  ok(/THROTTLE_GAP = 1100/.test(BUILD), '④c 记下内部节流值，仅用于 ETA 估算');
  ok(/if \(gap > 0 && i < todo\.length - 1\) await wait\(gap\);/.test(BUILD),
    '④d 只有 --gap>0 时才额外等待（默认不空等）');
  /* ★ 退避必须从 THROTTLE_GAP 起翻倍：gap 默认 0，`0 * 2` 恒为 0 ⇒ 退避完全失效。
     ⚠️ 同样用剥注释后的源码判（文件头注释里解释了这句旧写法）。 */
  ok(/gap = Math\.min\(Math\.max\(gap, THROTTLE_GAP\) \* 2, 12000\);/.test(BUILD),
    '④e ★ 限流退避从 THROTTLE_GAP 起翻倍（不是从 0 起）');
  ok(!/Math\.min\(gap \* 2, 12000\)/.test(BUILD_C), '④f ★反向：不再有「从 0 起翻倍」的死写法（已剥注释后判）');
  ok(/429\|503\|too many\|rate/.test(BUILD), '④g 识别 429/503 这类限流信号才退避');
  ok(/cleanStreak >= 20/.test(BUILD) && /gap = GAP;/.test(BUILD),
    '④h 连续 20 条无异常后把额外等待降回 --gap 值');
  /* ★ 跨文件一致性：两处常量必须相等，改一处忘另一处就漂移 */
  const m1 = PCREQ.match(/const MIN_GAP = (\d+);/);
  const m2 = BUILD.match(/const THROTTLE_GAP = (\d+);/);
  ok(!!m1 && !!m2 && m1[1] === m2[1],
    '④i ★ 节流常量跨文件一致（pcreq.MIN_GAP == build.THROTTLE_GAP）',
    (m1 ? m1[1] : '抽不到') + ' / ' + (m2 ? m2[1] : '抽不到'));
}

console.log('\n=== ⑤ 预热脚本：批模式 / 进度 / --dry ===');
{
  ok(/pcreq\.setAutoFlush\(false\)/.test(BUILD), '⑤a 预热进程关自动落盘（防 26GB 写盘放大）');
  const iMerge = BUILD.indexOf('pcreq.mergeDisk()');
  const iFlush = BUILD.indexOf('pcreq.flushNow()');
  ok(iMerge > 0 && iFlush > 0 && iMerge < iFlush, '⑤b ★ 先 mergeDisk() 再 flushNow()（顺序反了就会覆盖服务端新数据）');
  ok(/_prewarm-progress\.json/.test(BUILD), '⑤c 写进度文件（5 小时长跑要能从外面看进度）');
  /* DRY 分支到 `return` 的实际距离 = 439 字节（含示例打印），范围给 800 才够 */
  ok(/if \(DRY\) \{[\s\S]{0,800}?return;/.test(BUILD), '⑤d --dry 在抓取循环**之前**返回');
  /* —— 真行为：跑一次 --dry，缓存文件不该被动过 —— */
  const CACHE = path.join(ROOT, 'data', 'steam-req.json');
  const before = fs.statSync(CACHE).mtimeMs;
  let out = '', threw = '';
  try {
    out = execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build-steam-req.js'), '--dry'],
      { encoding: 'utf8', cwd: ROOT, timeout: 90000 });
  } catch (e) { threw = String(e.message || e).slice(0, 120); }
  ok(!threw, '⑤e --dry 能跑通', threw);
  ok(/--dry：只报计划，不抓取/.test(out), '⑤f --dry 明确声明只报计划');
  ok(fs.statSync(CACHE).mtimeMs === before, '⑤g ★ --dry **真的没动缓存文件**（mtime 未变）');
  ok(/有 appid 合计\s+\d+/.test(out), '⑤h --dry 报出「两路合并后可预热总量」');
}

console.log('\n=== ⑥ 服务端：顶层 appid 字段参与（否则预热的缓存前端读不到） ===');
{
  const R = seg(SERVER, "app.get('/api/pcreq'", 3400);
  ok(R.length > 500, '取到 /api/pcreq 路由体', R.length + ' 字节');
  ok(/String\(\(selfRec && selfRec\.appid\) \|\| ''\)\.trim\(\)/.test(R),
    '⑥a 库里顶层 appid 字段作为候选');
  const iCover = R.indexOf('coverCands.map((c) => pcreq.appidOf(c))');
  const iField = R.indexOf('selfRec && selfRec.appid');
  ok(iCover > 0 && iField > iCover, '⑥b ★ 封面解析**优先**，解析不出才用字段（既有行为不变）');
  ok(/await pcreq\.resolve\(\{ title: t, cover, appid \}\)/.test(R),
    '⑥c resolve 收到 appid（不再只靠 cover）');
  /* ★ 反向断言：旧写法一个字都不差就是 `resolve({ title: t, cover })`（已剥注释后判） */
  ok(!/await pcreq\.resolve\(\{ title: t, cover \}\)/.test(SERVER_C),
    '⑥d ★反向：不再有「只传 title + cover」的调用');
}

console.log('\n=== ⑦ 派生页：三页都带 id 调用（否则只有首页享受修复） ===');
{
  /* ⚠️ 这一段的判据被反证**连抓两轮**，别写回去：
   *   初版 `.test()` 只判「存在一处」⇒ 每页其实有 **2 个**调用点（「源站有最低配置、
   *     只补推荐配置」与「两栏都查」两条分支），去掉其中一个的 &id= 之后套件照样全绿。
   *   第二版改成「数所有 `(id ? '&id=' …)` ≥ 数所有 pcreq 调用」⇒ 仍然抓不到「只掉一处」：
   *     页面里还有**别的接口**用同样写法拼 id（实测 3 处 vs 调用 2 处），
   *     少一处仍是 2 ≥ 2。
   *   ⇒ 正解是把「qs 定义 + 紧接着的 pcreq 调用」作为**一个整体**匹配，
   *     逐个调用点检查它自己的 qs 里有没有 id。 */
  let n = 0;
  for (const f of ['index.html', 'emulator.html', 'unpack.html']) {
    const s = rd('public/' + f);
    const pairs = [...s.matchAll(/const qs = ([^\n]*?);\s*const j = await fetch\(api\('\/api\/pcreq' \+ qs\)\)/g)];
    const withId = pairs.filter((m) => /\(id \? '&id='/.test(m[1])).length;
    const hit = pairs.length > 0 && withId === pairs.length;
    ok(hit, '⑦ ' + f + ' 每个 pcreq 调用点都带 id', withId + '/' + pairs.length + ' 处');
    if (hit) n += 1;
  }
  ok(n === 3, '⑦ 三页一致（调用形态相同）', n + '/3');
}

console.log('\n=== ⑧ 缓存层：跨进程不互相覆盖 + 预热边跑边生效（本轮最危险的一处） ===');
{
  /* 这一段的起因（写文档时才发现，属**灾难级**）：
   *   预热脚本要跑 5.3 小时、每 500 条落一次盘；而服务端落盘是**全量覆盖**
   *   （`writeFileSync` 写自己内存里的整份 map，只有 700 多条）。
   *   ⇒ 只要有一个用户请求触发一次 5s debounce 写盘，预热成果**整批消失**，且不报错。
   *   光修预热侧不够（两边都全量写 ⇒ 后写的赢），必须**两边都 merge**。 */
  const W = seg(PCREQ, 'const doWrite = () => {', 1600);
  ok(/mergeDisk\(\);/.test(W), '⑧a ★ 服务端落盘前先 mergeDisk（否则会把预热刚写的整批抹掉）');
  const P = seg(PCREQ, '/** 同步读缓存（不触发网络） */', 1000);
  ok(/refreshFromDisk\(\)/.test(P), '⑧b ★ peek 未命中时先看一眼磁盘（跨进程可见性 → 预热边跑边生效）');
  ok(/now - lastMerge < MERGE_TTL/.test(PCREQ),
    '⑧c 读盘有 TTL 兜住成本（不能每次未命中都同步读 7MB + parse）');
  ok(/refreshFromDisk,/.test(seg(PCREQ, 'module.exports', 800)),
    '⑧d refreshFromDisk 已导出（行为测试要直接调它）');

  /* —— 真行为：另起一个隔离副本（② 段那个实例的状态已被改过，require 有缓存） —— */
  const DIR2 = path.join(ROOT, '_test-out', 'v1033-cache2');
  fs.mkdirSync(DIR2, { recursive: true });
  for (const f of fs.readdirSync(DIR2)) { try { fs.unlinkSync(path.join(DIR2, f)); } catch (e) { /* 本套件自己的残留 */ } }
  fs.copyFileSync(path.join(ROOT, 'data', 'pcreq.js'), path.join(DIR2, 'pcreq.js'));
  const F2 = path.join(DIR2, 'steam-req.json');
  const seed2 = (map) => fs.writeFileSync(F2, JSON.stringify({ builtAt: 1, src: 't', count: Object.keys(map).length, map }));
  /* ★★ 关键行为：本进程内存里**没有** 999，但「另一个进程」刚把它写到了磁盘上。
     `peek('999')` 首次调用就应命中 —— 因为 peek 未命中时内部会 refreshFromDisk()。
     这就是「预热边跑线上边生效」的全部意义：不必等 5 小时跑完，也不必重启。
     ⚠️ 写法有讲究（这一段的判据被反证连改三轮，别写回去）：
       · 不能用「先 seed 含 999 再 require 再 peek」—— `ensure()` 是**惰性**的，
         require 不读盘、首次 peek 才读盘 ⇒ 那样测到的其实是「ensure 首次读盘」，
         把 refreshFromDisk 整个删掉也照样绿（假绿）。
       · 必须先 `peek('111')` 把磁盘读进内存（此刻无 999），**之后**再写盘，
         这样「能读到 999」才唯一归因于 peek 内部的 refresh。
       · 也**不该**断言「peek('999') === null」——那是把正确行为（自动刷新）
         当成期望值写反了（本轮真的这么写错过一次）。
     ⚠️ 副作用：这一条同时能被「peek 不看磁盘」和「refreshFromDisk 空操作」
        两个变异打红，比拆成两条更省也更严。 */
  seed2({ 111: { ts: 1, min: { cpu: 'a' } } });
  const pc2 = require(path.join(DIR2, 'pcreq.js'));
  pc2.peek('111');
  seed2({ 111: { ts: 1, min: { cpu: 'a' } }, 999: { ts: 2, min: { cpu: 'WARM' } } });
  const got = pc2.peek('999');
  ok(!!(got && got.min && got.min.cpu === 'WARM'),
    '⑧e ★★ 另一个进程写的条目，**不重启**就能读到（peek 未命中时会看一眼磁盘）',
    got ? 'min.cpu=' + got.min.cpu : 'null');

  /* ★★ 反向：服务端落盘时不能把磁盘上「本进程内存里没有」的键抹掉 */
  seed2({
    111: { ts: 1, min: { cpu: 'a' } },
    999: { ts: 2, min: { cpu: 'WARM' } },
    777: { ts: 3, min: { cpu: 'OTHER' } },
  });
  pc2.save('888', { min: { cpu: 'me' } });
  pc2.flushNow();
  const disk2 = Object.keys(JSON.parse(fs.readFileSync(F2, 'utf8')).map).sort().join(',');
  ok(/777/.test(disk2) && /999/.test(disk2) && /888/.test(disk2),
    '⑧f ★★ 服务端落盘后，另一个进程写的条目**仍在**（不是全量覆盖）', disk2);
}

const total = pass + fail;
console.log('\n' + (fail ? '  × ' + fail + ' 条失败' : '  ✓ 全部通过') + '   ' + pass + ' / ' + total + '\n');
process.exit(fail ? 1 : 0);
