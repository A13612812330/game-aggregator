/**
 * tools/test-v1071-extractor.js — 第一层（静态/离线）：验收 data/extractor.js 是否真的能干活
 *
 * ★ v10.71 正式登记进 run-all.js 的 SUITES（原先叫 tools/_verify-extractor.js，是手工探针，
 *   不在任何防线里 —— 它当时抓到 sniff 全线失效那个静默 bug，却没人会定期跑它）。
 *   脱离不了真实 7z，但**不需要服务**，离线可跑，约 7 s。
 *
 * 用真实直链 + 人工构造样本跑四类场景，每个场景都断言「产出对不对」，
 * 不是「函数没抛异常」。★ 每类都有**阳性对照**（必须先证明样本本身是好的）。
 *
 * 跑法：node tools/test-v1071-extractor.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const EX = require('../data/extractor');

const SEVENZ = EX.resolve7z();
/* ★★ 工作目录**带 pid**（每次跑唯一）⇒ 拿到干净起点，且**全程不做递归删除**。
   原因（2026-10-14 实测挖出）：WorkBuddy 宿主的安全删除守卫按「**本 turn 累计删除文件数 > 50**」
   拦截 `rmSync`，抛 `[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]`；
   阈值来自 `CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD`（默认 50）、作用域 `scope:turn`。
   三个 v1071 套件连跑时累计 69 ⇒ **整套防线里它 exit 1，而单独跑却全绿** ——
   表现是「**防线自己报假红**」，比真红更费时间（会去查根本没坏的代码）。
   代价：`_test-out/` 会留目录（已 gitignore），由人工偶尔清。详见 PITFALLS 铁律 107。 */
/* ★★★ v10.112 追加一层：目录名**不能只有 pid**，必须带随机后缀。
   本轮（v10.112）实测到的假红：全量跑 86 个 node 进程快速起落，Windows 会**复用 PID**；
   一旦新进程拿到「某次用过的 PID」，`v1071-verify-<pid>` 就正好是**上一轮跑剩的目录**。
   而解压走 `-aos`（跳过已存在文件）⇒ produced=0 ⇒ `reachedDepth=1`
   ⇒ D3「递归层数 = 2」与 D7「产出里有内层存档目录」双双假红，而**单跑必绿**
   （单跑撞上旧 PID 的概率低得多）。实测残留已累积 **110 个目录 / 约 1.1GB**。
   加随机后缀后，PID 怎么复用都撞不上。
   ⚠️ 仍然**不做递归清理** —— 清理会撞安全删除守卫的「本 turn 累计 > 50」阈值（见上），
     那样换来的又是 exit 1。代价是残留继续累积，已记进 README 的维护项，定期人工清。 */
const ROOT = path.join(__dirname, '..', '_test-out',
  'v1071-verify-' + process.pid + '-' + crypto.randomBytes(3).toString('hex'));

let pass = 0, fail = 0;
function chk(name, ok, extra) {
  if (ok) { pass++; console.log('  ✅ ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '   ' + extra : '')); }
}
function hr(t) { console.log('\n' + '─'.repeat(74) + '\n' + t + '\n' + '─'.repeat(74)); }
/* 造样本用的 7z 调用（与 extractor 同款：必须关 stdin + 超时） */
function sh(args) {
  return new Promise((res) => {
    const cp = spawn(SEVENZ, [...args, '-sccUTF-8'], {
      /* ★ 见 e2e 套件同一处的注释：铁律 38，stdin 显式 ignore；此后 `cp.stdin` 为 null。 */
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let so = '', se = '', done = false;
    const fin = (r) => { if (!done) { done = true; clearTimeout(to); res(r); } };
    const to = setTimeout(() => { try { cp.kill('SIGKILL'); } catch (e) { /* 已退 */ } fin({ code: -2, stdout: so, stderr: se }); }, 40000);
    cp.stdout.on('data', (d) => { so += d; });
    cp.stderr.on('data', (d) => { se += d; });
    cp.on('close', (c) => fin({ code: c == null ? -1 : c, stdout: so, stderr: se }));
  });
}
const ls = (d) => (fs.existsSync(d) ? fs.readdirSync(d) : []);

(async () => {
  /* ★★ 不做递归删除：目录按 pid 唯一，本身已是干净起点（原因见文件头「安全删除守卫」）。 */
  fs.mkdirSync(ROOT, { recursive: true });

  /* ══════════════ 0 环境自检 ══════════════ */
  hr('0 环境自检（7z 定位与版本）');
  const env = await EX.envCheck();
  chk('E1 找到 7z.exe', !!env.exe, env.exe || '');
  chk('E2 7z 可执行且版本可读', env.ready, env.version || env.hint || '');

  /* ══════════════ 1 嗅探与分卷 ══════════════ */
  hr('1 魔数嗅探 / 分卷识别（纯函数，不依赖 7z）');
  const s1 = path.join(ROOT, 'sniff'); fs.mkdirSync(s1, { recursive: true });
  fs.writeFileSync(path.join(s1, 'a.zip'), Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(50)]));
  fs.writeFileSync(path.join(s1, 'b.rar'), Buffer.concat([Buffer.from('Rar!\x1a\x07\x00', 'binary'), Buffer.alloc(50)]));
  fs.writeFileSync(path.join(s1, 'c.7z'), Buffer.concat([Buffer.from('7z\xbc\xaf\x27\x1c', 'binary'), Buffer.alloc(50)]));
  fs.writeFileSync(path.join(s1, 'd.txt'), 'plain text');
  /* ★ 假扩展名：真实直链里出现过 .zips 实为 ZIP */
  fs.copyFileSync(path.join(s1, 'a.zip'), path.join(s1, 'e.zips'));
  chk('S1 zip 魔数识别', EX.sniff(path.join(s1, 'a.zip')) === 'zip');
  chk('S2 rar 魔数识别', EX.sniff(path.join(s1, 'b.rar')) === 'rar');
  chk('S3 7z 魔数识别', EX.sniff(path.join(s1, 'c.7z')) === '7z');
  chk('S4 纯文本不误判为压缩包', EX.sniff(path.join(s1, 'd.txt')) === null);
  chk('S5 ★★ 假扩展名 .zips 仍按内容认出 zip', EX.sniff(path.join(s1, 'e.zips')) === 'zip');

  chk('V1 .7z.001 是首卷', (EX.volumeOf('x.7z.001') || {}).first === true);
  chk('V2 .7z.002 不是首卷', (EX.volumeOf('x.7z.002') || {}).first === false);
  chk('V3 .part1.rar 是首卷', (EX.volumeOf('x.part1.rar') || {}).first === true);
  chk('V4 .part2.rar 不是首卷', (EX.volumeOf('x.part2.rar') || {}).first === false);
  chk('V5 普通包不算分卷', EX.volumeOf('normal.zip') === null);

  /* ══════════════ 2 真实直链端到端（用户的实际场景）══════════════ */
  hr('2 真实直链：下载 → 递归解压（游侠存档，实测含两层嵌套）');
  const yx = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'saves-youxia.json'), 'utf8'));
  const sample = (yx.items || []).find((x) => x.files && x.files.direct && /\.rar$/i.test(x.files.direct));
  const d2 = path.join(ROOT, 'real'); fs.mkdirSync(d2, { recursive: true });
  const dl = await EX.downloadTo(sample.files.direct, d2);
  chk('D1 直链下载成功', dl.ok, dl.ok ? (dl.size + ' B  ' + path.basename(dl.file)) : dl.error);
  if (dl.ok) {
    chk('D2 下载产物魔数是 rar', EX.sniff(dl.file) === 'rar', EX.sniff(dl.file) || 'null');
    const rep = await EX.extractArchive(dl.file, { onEvent: () => {} });
    console.log('    报告: layers=' + rep.layers.length + ' needsPassword=' + rep.needsPassword.length +
      ' failures=' + rep.failures.length + ' reachedDepth=' + rep.reachedDepth);
    rep.layers.forEach((L) => console.log('      L' + L.depth + ' ' + L.name.slice(0, 46) + ' ok=' + L.ok + ' 产出 ' + L.produced));
    chk('D3 ★ 递归层数 = 2（外层 rar → 内层 rar）', rep.reachedDepth === 2, 'reachedDepth=' + rep.reachedDepth);
    chk('D4 每层都解成功', rep.layers.every((L) => L.ok), rep.layers.map((L) => L.ok).join(','));
    chk('D5 无需密码', rep.needsPassword.length === 0);
    chk('D6 无失败', rep.failures.length === 0, JSON.stringify(rep.failures.slice(0, 2)));
    chk('D7 ★ 最终产出里有内层存档目录（说明真的解到底了）',
      rep.final.some((f) => /Dynasty Warriors|Save/i.test(f)),
      rep.final.slice(0, 4).map((f) => path.basename(f)).join(' / '));
    chk('D8 ★ 原压缩包仍在（用户拍板「保留不动」）', fs.existsSync(dl.file));
    chk('D9 落盘位置=压缩包同级（原地解压）', rep.destDir === path.dirname(dl.file));
  }

  /* ══════════════ 3 人工构造：三层套娃 ══════════════ */
  hr('3 三层套娃：zip(zip(zip(txt)))');
  const d3 = path.join(ROOT, 'nest'); fs.mkdirSync(d3, { recursive: true });
  fs.writeFileSync(path.join(d3, 'leaf.txt'), 'LEAF_v1071\n');
  await sh(['a', '-tzip', path.join(d3, 'l1.zip'), path.join(d3, 'leaf.txt')]);
  await sh(['a', '-tzip', path.join(d3, 'l2.zip'), path.join(d3, 'l1.zip')]);
  await sh(['a', '-tzip', path.join(d3, 'l3.zip'), path.join(d3, 'l2.zip')]);
  fs.rmSync(path.join(d3, 'l1.zip'), { force: true });
  fs.rmSync(path.join(d3, 'l2.zip'), { force: true });
  fs.rmSync(path.join(d3, 'leaf.txt'), { force: true });
  const r3 = await EX.extractArchive(path.join(d3, 'l3.zip'), {});
  console.log('    layers=' + r3.layers.length + ' reachedDepth=' + r3.reachedDepth);
  r3.layers.forEach((L) => console.log('      L' + L.depth + ' ' + L.name + ' ok=' + L.ok + ' 产出 ' + L.produced));
  chk('N1 ★ 三层全部解出（这是「再次解压」的核心承诺）', r3.reachedDepth === 3, 'reachedDepth=' + r3.reachedDepth);
  chk('N2 三层都成功', r3.layers.length === 3 && r3.layers.every((L) => L.ok));
  chk('N3 ★ 最终能看到叶子文件 leaf.txt', r3.final.some((f) => /leaf\.txt$/.test(f)),
    r3.final.map((f) => path.basename(f)).join(' / ') || '(空)');

  /* ══════════════ 4 深度上限（防死循环）══════════════ */
  hr('4 深度上限：maxDepth=2 时必须停在 2 层并如实标记');
  const d4 = path.join(ROOT, 'cap'); fs.mkdirSync(d4, { recursive: true });
  fs.writeFileSync(path.join(d4, 'x.txt'), 'X\n');
  await sh(['a', '-tzip', path.join(d4, 'k1.zip'), path.join(d4, 'x.txt')]);
  await sh(['a', '-tzip', path.join(d4, 'k2.zip'), path.join(d4, 'k1.zip')]);
  await sh(['a', '-tzip', path.join(d4, 'k3.zip'), path.join(d4, 'k2.zip')]);
  fs.rmSync(path.join(d4, 'k1.zip'), { force: true });
  fs.rmSync(path.join(d4, 'k2.zip'), { force: true });
  fs.rmSync(path.join(d4, 'x.txt'), { force: true });
  const r4 = await EX.extractArchive(path.join(d4, 'k3.zip'), { maxDepth: 2 });
  chk('C1 ★ 停在 2 层（没无限套娃）', r4.reachedDepth === 2, 'reachedDepth=' + r4.reachedDepth);
  chk('C2 被截断的层如实记进 skipped', r4.skipped.some((s) => s.reason === 'max-depth'),
    JSON.stringify(r4.skipped.map((s) => s.reason)));

  /* ══════════════ 5 加密包：不给密码 → 列出；给密码 → 解出 ══════════════ */
  hr('5 加密包（用户拍板：列出 + 逐个填密码后继续）');
  const d5 = path.join(ROOT, 'enc'); fs.mkdirSync(d5, { recursive: true });
  fs.writeFileSync(path.join(d5, 'topsecret.txt'), 'SECRET_v1071\n');
  await sh(['a', '-tzip', '-pMASTER2026', '-mem=AES256', path.join(d5, 'locked.zip'), path.join(d5, 'topsecret.txt')]);
  fs.rmSync(path.join(d5, 'topsecret.txt'), { force: true });
  chk('P0 阳性对照：加密样本确实被造出来了', fs.existsSync(path.join(d5, 'locked.zip')) &&
    fs.statSync(path.join(d5, 'locked.zip')).size > 0);
  const r5a = await EX.extractArchive(path.join(d5, 'locked.zip'), {});
  chk('P1 ★ 无密码时**不是**报「失败」，而是进 needsPassword 列表',
    r5a.needsPassword.length === 1 && r5a.failures.length === 0,
    'needs=' + r5a.needsPassword.length + ' fail=' + r5a.failures.length);
  chk('P2 needsPassword 里带得出文件名（界面要显示给用户）',
    (r5a.needsPassword[0] || {}).name === 'locked.zip', JSON.stringify((r5a.needsPassword[0] || {}).name));
  const r5b = await EX.extractArchive(path.join(d5, 'locked.zip'), { passwords: ['WRONG', 'MASTER2026'] });
  chk('P3 ★ 给对密码后解出内容', r5b.layers.some((L) => L.ok) &&
    r5b.final.some((f) => /topsecret\.txt$/.test(f)),
    'layers=' + r5b.layers.length + ' ok=' + r5b.layers.filter((L) => L.ok).length);
  const r5c = await EX.extractArchive(path.join(d5, 'locked.zip'), { passwords: ['BAD1', 'BAD2'] });
  chk('P4 密码全错 → 仍归入 needsPassword（不误报成坏包）',
    r5c.needsPassword.length === 1 && r5c.failures.length === 0,
    'needs=' + r5c.needsPassword.length + ' fail=' + r5c.failures.length);

  /* ══════════════ 5b 回归守护：本轮实测挖出来的两个真 bug ══════════════ */
  hr('5b 回归守护（两个真 bug —— 都是实测定性出来的，必须一直被守住）');
  const lockSrc = path.join(d5, 'locked.zip');

  /* R1：错密码**不能留下残留文件**。
   *     实测依据：错密码解压后目录里留下一个 **0 字节的 topsecret.txt**
   *     （正确解出的是 14 B）。不回滚有两层危害：污染用户目录 + 下次被 `-aos`
   *     当成"已存在"跳过，坏文件永久留在那里且不再报错。 */
  const dR1 = path.join(ROOT, 'enc-rollback'); fs.mkdirSync(dR1, { recursive: true });
  const lockR1 = path.join(dR1, 'locked.zip');
  fs.copyFileSync(lockSrc, lockR1);
  const rp = await EX.unpackOne(lockR1, dR1, { password: 'WRONG_PW_X' });
  const leftovers = fs.readdirSync(dR1).filter((n) => n !== 'locked.zip');
  chk('R1 ★★ 错密码后不留残留文件（实测 7z 会留 0 字节成品）',
    !rp.ok && leftovers.length === 0,
    '残留=' + JSON.stringify(leftovers) + ' rolledBack=' + rp.rolledBack);

  /* R2：**文件已存在 + 错密码，不许判成功**。
   *     根因：`-aos`（跳过已存在）会让 7z 把活儿全跳过 ⇒ 退出码 0 ⇒ 假成功。
   *     修法是解压前用 `7z t` 卡密码闸门。这条断言就是守那个闸门。 */
  const dR2 = path.join(ROOT, 'enc-exists'); fs.mkdirSync(dR2, { recursive: true });
  const lockR2 = path.join(dR2, 'locked.zip');
  fs.copyFileSync(lockSrc, lockR2);
  const good0 = await EX.unpackOne(lockR2, dR2, { password: 'MASTER2026' });
  chk('R2a 阳性对照：对密码先解一次，目标文件确实存在',
    good0.ok && fs.existsSync(path.join(dR2, 'topsecret.txt')),
    'ok=' + good0.ok);
  const bad2 = await EX.extractArchive(lockR2, { passwords: ['WRONG_PW_X'] });
  chk('R2b ★★ 文件已存在时用错密码，仍判「需要密码」（不能因 -aos 跳过而假成功）',
    bad2.needsPassword.length === 1 && bad2.layers.every((L) => !L.ok),
    'needs=' + bad2.needsPassword.length + ' ok层=' + bad2.layers.filter((L) => L.ok).length);
  /* ★ 说明：密码闸门在 `extractArchive`，**不在** `unpackOne` ——
     因为单层解压工具不该替调用方决定"要不要密码"。已实测这个分工是对的：
     直接用 unpackOne + 错密码 + 文件已存在 ⇒ 它确实会返回 ok=true（`-aos` 跳过了），
     所以**任何直接调 unpackOne 的地方都必须先用 testPassword 卡闸门**。 */
  chk('R2e ★ 单层 unpackOne 在「文件已存在」时确实会返回 nothingNew（如实暴露"没产出"）',
    (await EX.unpackOne(lockR2, dR2, { password: 'MASTER2026' })).nothingNew === true,
    '（这是设计：闸门由 extractArchive 负责）');
  const tpOk = await EX.testPassword(lockR2, 'MASTER2026');
  const tpBad = await EX.testPassword(lockR2, 'WRONG_PW_X');
  chk('R2c ★ `7z t` 不受「文件已存在」影响（对密码 rc=0 / 错密码 rc≠0）',
    tpOk.ok === true && tpBad.ok === false, '对=' + tpOk.code + ' 错=' + tpBad.code);
  chk('R2d 无密码包不会被任意 -p 误伤（阳性对照，防密码闸门误杀普通包）',
    (await EX.testPassword(path.join(d3, 'l3.zip'), 'whatever_pw')).ok === true);

  /* ══════════════ 6 坏包 / 非压缩包 ══════════════ */
  hr('6 坏包与「根本不是压缩包」的区分');
  const d6 = path.join(ROOT, 'bad'); fs.mkdirSync(d6, { recursive: true });
  fs.writeFileSync(path.join(d6, 'broken.zip'), Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(400, 0x42)]));
  const r6 = await EX.extractArchive(path.join(d6, 'broken.zip'), {});
  chk('B1 ★ 坏包归入 failures（**不是** needsPassword —— 退出码 2 三义必须分开）',
    r6.failures.length === 1 && r6.needsPassword.length === 0,
    'fail=' + r6.failures.length + ' needs=' + r6.needsPassword.length);
  chk('B2 失败原因带出 7z 的话（不吞错误）', !!(r6.failures[0] || {}).err,
    JSON.stringify((r6.failures[0] || {}).err || '').slice(0, 70));

  /* ══════════════ 7 分卷 ══════════════ */
  hr('7 分卷：只解首卷，中间卷不报「坏包」');
  const d7 = path.join(ROOT, 'vol'); fs.mkdirSync(d7, { recursive: true });
  fs.writeFileSync(path.join(d7, 'rand.bin'), crypto.randomBytes(20 * 1024));
  await sh(['a', '-t7z', '-mx0', '-v6k', path.join(d7, 'vol.7z'), path.join(d7, 'rand.bin')]);
  fs.rmSync(path.join(d7, 'rand.bin'), { force: true });
  const vols = ls(d7).filter((x) => x.startsWith('vol.7z.'));
  chk('V0 阳性对照：真的造出了多卷', vols.length >= 3, JSON.stringify(vols));
  const sc = EX.scanDir(d7);
  chk('V1 ★ scanDir 只收首卷（不把中间卷当独立包）',
    sc.length === 1 && sc[0].file.endsWith('.001'),
    sc.map((x) => path.basename(x.file)).join(',') || '(空)');
  const r7 = await EX.extractArchive(path.join(d7, 'vol.7z.001'), {});
  chk('V2 首卷解压成功且内容完整', r7.layers.some((L) => L.ok) &&
    r7.final.some((f) => /rand\.bin$/.test(f) && fs.statSync(f).size === 20 * 1024),
    'final=' + r7.final.map((f) => path.basename(f)).join(','));
  chk('V3 中间卷被 skip 而不是报失败', r7.failures.length === 0,
    'fail=' + r7.failures.length);

  /* ══════════════ 8 scanDir ══════════════ */
  hr('8 scanDir：混合目录里只挑出真压缩包');
  const d8 = path.join(ROOT, 'scan'); fs.mkdirSync(d8, { recursive: true });
  fs.copyFileSync(path.join(d3, 'l3.zip'), path.join(d8, 'one.zip'));
  fs.copyFileSync(path.join(s1, 'b.rar'), path.join(d8, 'two.rar'));
  fs.writeFileSync(path.join(d8, 'readme.txt'), 'nope');
  fs.writeFileSync(path.join(d8, 'setup.exe'), Buffer.from('MZ\x90\x00'));
  const sc8 = EX.scanDir(d8);
  chk('SC1 找出 2 个真压缩包（zip + rar）', sc8.length === 2, sc8.map((x) => path.basename(x.file)).join(','));
  chk('SC2 排除 .txt', !sc8.some((x) => x.file.endsWith('.txt')));
  chk('SC3 ★ 排除 .exe（PE 魔数不在压缩包表里）', !sc8.some((x) => x.file.endsWith('.exe')),
    EX.sniff(path.join(d8, 'setup.exe')) === null ? '(sniff 正确返回 null)' : '(!! sniff 误判)');

  /* ══════════════ 9 文件名净化 ══════════════ */
  hr('9 直链文件名推导与净化');
  chk('F1 从 URL 取文件名', EX.fileNameFromUrl('https://a.com/x/y/Save%20File.rar') === 'Save File.rar',
    EX.fileNameFromUrl('https://a.com/x/y/Save%20File.rar'));
  chk('F2 ★ 去掉路径分隔符（防写到目录外）',
    !/[\\/]/.test(EX.fileNameFromUrl('https://a.com/a%2Fb%2Fc.rar')),
    EX.fileNameFromUrl('https://a.com/a%2Fb%2Fc.rar'));
  chk('F3 Windows 保留名加前缀', /^_?con/i.test(EX.fileNameFromUrl('https://a.com/con')), EX.fileNameFromUrl('https://a.com/con'));
  chk('F4 URL 无文件名时给兜底名', EX.fileNameFromUrl('https://a.com/', 'fallback.bin').length > 0,
    EX.fileNameFromUrl('https://a.com/', 'fallback.bin'));

  /* ══════════════ 汇总 ══════════════ */
  hr('验收汇总');
  /* ★ 收尾格式是约定（见 run-all 取成绩段）：同行含「通过」+ `n / m`，m 必须是**总数**。 */
  console.log('  通过 ' + pass + ' / ' + (pass + fail) + '（失败 ' + fail + '）');
  process.exit(fail ? 1 : 0);
})();
