/**
 * data/extractor.js — 「解压助手」递归解压核心（v10.71 新增）
 *
 * ────────────────────────────────────────────────────────────────────────
 * 需求原话（2026-10-14）：
 *   「目前下载直链的压缩包会有一个问题，压缩包中含有压缩包，有没有办法直接自动解压
 *     并且检测到如果还是有压缩包则直接再次解压或增加提醒+再次解压功能」
 *
 * 这不是理论需求 —— 本模块写完前已实测复现：
 *   游侠存档直链 → .rar（2.58MB）
 *     └ 解出 ["ALI213.txt", "Save File-28-1-5-1774424915.rar", …]  ← 里面就是一个 rar
 *         └ 解出 ["Dynasty Warriors Origins Save 99%/"]           ← 到底了
 *   即「压缩包套压缩包」是这两条通道的**常态**，不是个例。
 *
 * ────────────────────────────────────────────────────────────────────────
 * ★★ 全部判据来自 `tools/_pilot-7z.js` + `tools/_pilot-7z2.js` 两轮实测，
 *    **没有一条是推理出来的**。下面每条都写明「实测怎么得到的」：
 *
 * ① 退出码**不足以**判断失败原因 —— 实测退出码 2 是**三义**的：
 *      加密包给错密码 = 2 · 坏 zip（魔数对内容坏）= 2 · 根本不是压缩包 = 2
 *    加密包**不给 -p 参数**时更特殊：7z 会去 stdin 要密码，
 *    我们给了 EOF ⇒ 退出码 **255**（不是 2）。三种情况必须分开处理。
 *    ⇒ 所以本模块**先预检、再解压**，不靠事后猜。
 *
 * ② 可靠判据是 `7z l -slt` 的 `Encrypted = +` —— 实测：
 *      加密 zip  → 退出码 0，且能读出 `Encrypted = +`
 *      坏 zip    → 退出码 2，**没有**该字段
 *      纯文本    → 退出码 2，没有该字段
 *    ⇒ 「退出码 0 但 Encrypted=+」= 确实是能识别的压缩包，只是要密码。
 *      这样连「是坏包还是加密包」都分得开，而退出码分不开。
 *
 * ③ 解析 `-slt` 清单必须**跳过第 1 条 Path**：实测清单结构是
 *      Path = <压缩包自己的绝对路径>   ← 这一条是归档本身
 *      Type = zip
 *      …
 *      ----------                      ← 分隔线
 *      Path = secret.txt               ← 从这里开始才是包内文件
 *    ⇒ 不跳过分隔线前的头，会把压缩包自己当成包内第一个文件。
 *
 * ④ 嵌套识别必须按**魔数**，不能按扩展名 —— 实测直链里出现过扩展名 `.zips`
 *    而实际是 ZIP（魔数 504b0304）的文件。按扩展名扫会整类漏掉。
 *
 * ⑤ 分卷包只能解**首卷**：实测 `-v6k` 生成 vol.7z.001~004，
 *    只给 .001 → 退出码 0、内容完整（20480 B）；
 *    给 .002   → 退出码 2 + 「系统找不到指定的文件」。
 *    ⚠️ 后者与「坏包」**同码同文案级别**，不特判就会把中间卷报成损坏包。
 *
 * ⑥ 子进程**必须关 stdin**（`cp.stdin.end()`）—— 第一次跑 pilot 时脚本被 SIGTERM
 *    杀掉、连版本号都没输出，根因就是 execFile 把 stdin 挂成 pipe 又不关，
 *    7z 一直等密码输入。这条同 PITFALLS 38（子进程 stdin='ignore'）。
 *
 * ⑦ `-sccUTF-8` 必须加：否则中文路径在 Windows 控制台输出里是乱码。
 *
 * ────────────────────────────────────────────────────────────────────────
 * 设计取舍（用户 2026-10-14 拍板）：
 *   · 输出位置 = **原地解压**（解到压缩包同级目录）
 *   · 原压缩包 = **保留不动**（不删不移，解错可重来）
 *   · 加密包   = **列出 + 逐个填密码后继续**（不是静默跳过，也不是自动爆破）
 *   · 网盘链接 = 服务端拿不到（要客户端/登录），走原方式；用户手动丢入文件夹后
 *                用本模块的 scanDir/extractArchive 处理 —— 所以本模块必须同时支持
 *                「解单个文件」和「扫一个目录」两种入口。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

/* ============================== 7z 定位 ============================== */

/* ★ 不写死单个路径：实测本机 7-Zip 装在 `D:\7-Zip`（不是默认的 Program Files），
 *   写死 `C:\Program Files\7-Zip` 会「装了解压器却说没装」。
 *   允许用环境变量覆盖（换机器/换版本时不用改代码）。 */
const SEVENZ_CANDIDATES = [
  process.env.GAMEHUB_7Z,
  'D:\\7-Zip\\7z.exe',
  'C:\\Program Files\\7-Zip\\7z.exe',
  'C:\\Program Files (x86)\\7-Zip\\7z.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Programs', '7-Zip', '7z.exe'),
].filter(Boolean);

let _sevenZ = null;
let _sevenZChecked = false;

/** 找到可用的 7z.exe；找不到返回 null（调用方据此给出「请安装 7-Zip」而不是崩掉） */
function resolve7z() {
  if (_sevenZChecked) return _sevenZ;
  _sevenZChecked = true;
  for (const p of SEVENZ_CANDIDATES) {
    try { if (fs.existsSync(p)) { _sevenZ = p; break; } } catch (e) { /* 权限/异常路径，跳过 */ }
  }
  return _sevenZ;
}

/** 仅测试用：重置缓存（换环境变量后重新探测） */
function _reset7zCache() { _sevenZ = null; _sevenZChecked = false; }

/* ============================== 默认目录 ============================== */

/** 用户拍板：`C:\Users\<name>\Downloads\GameHub\`（不弄脏 Downloads 根） */
const DEFAULT_DEST = path.join(os.homedir(), 'Downloads', 'GameHub');

/* ============================== 魔数嗅探 ============================== */

/* ★ 只看前 512 字节。tar 的标识在 offset 257（"ustar"），所以要读够。
 *   全部按实测魔数写（ZIP/RAR/7Z 三条都由 pilot 实测确认过）。
 *   ⚠️ 刻意**不放** iso(CD001 在 0x8001) 与 arj(60ea 仅 2 字节)：前者头 8 字节取不到，
 *      后者太短会撞普通文件 —— 宁可漏认少见格式，也不要误判把正常文件送进解压器。 */
const MAGIC_TABLE = [
  { fmt: 'zip', hex: ['504b0304', '504b0506', '504b0708'] },   /* 实测：扩展名 .zips 实为 ZIP 的那条也是它 */
  { fmt: 'rar', hex: ['526172211a0700', '526172211a0701'] },   /* 实测：Rar!\x1a\x07\x00（RAR4）/ \x01（RAR5） */
  { fmt: '7z', hex: ['377abcaf271c'] },                         /* 实测：7z 分卷首卷也是它 */
  { fmt: 'xz', hex: ['fd377a585a00'] },
  { fmt: 'cab', hex: ['4d534346'] },
  { fmt: 'gzip', hex: ['1f8b08'] },                             /* 含第 3 字节 08=deflate，避免 1f8b 撞普通文件 */
  { fmt: 'bzip2', hex: ['425a6831', '425a6832', '425a6833', '425a6834', '425a6835', '425a6836', '425a6837', '425a6838', '425a6839'] },
  /* tar：标识在 offset 257，不是头 4 字节，见下面的单独判断 */
];

/**
 * 嗅探文件真实格式。**按魔数，不看扩展名**（实测 .zips 实为 zip）。
 *
 * ⚠️ 这里踩过一个自己造的坑，留作教训：初版匹配条件写成 `sig.length <= 6`，
 *    本意是「短签名要额外校验」，但 `sig` 是 **hex 字符串**，长度是字节数的 **2 倍**
 *    —— 于是 `504b0304`(8) / `526172211a0700`(14) / `377abcaf271c`(12) 全被这个条件排除，
 *    sniff 对**所有**压缩包都返回 null，整套解压逻辑静默退化成「不是压缩包，跳过」。
 *    更阴的是「纯文本不该误判」那条断言当时**是绿的** —— 因为什么都认不出来。
 *    ⇒ 教训两条：① hex 长度 ≠ 字节长度，别混；② 断言必须配**阳性对照**，
 *      只测「不该认的没认」而不测「该认的认了」，bug 会以全绿的样子藏起来。
 */
/**
 * 按魔数判定**一段字节流**是不是压缩包 —— 文件版与网络流版的**单一真源**。
 *
 * ★ v10.72 抽出：这套匹配原来只写在 sniff(文件) 里，而「下载时先问一句这是不是
 *   压缩包」需要拿**还没落盘的头部字节**判（见 downloadTo 里边收边判的那段）。
 *   复制一份就是两张魔数表各自漂移 —— 本项目最贵的一类事故（铁律 1 同族）。
 *   所以判定只此一份，sniff() 退化成它的「读文件前 512 字节」外壳。
 *
 * @param {Buffer} head 建议 ≥ 512 字节（tar 的 "ustar" 在 offset 257）；< 4 字节判不出
 * @returns {string|null} 格式名（zip/rar/7z/xz/cab/gzip/bzip2/tar），认不出为 null
 */
function sniffBuffer(head) {
  if (!head || head.length < 4) return null;
  /* ★ 内部**自己截断**：`head.toString('hex')` 会按原长度再生成一份字符串，
   *   调用方稍不留神传进整个几百 MB 的包就是一次内存灾难。判据只需要前 512 字节
   *   （tar 的 "ustar" 在 offset 257），所以这里不信任入参长度。 */
  const h = head.length > 512 ? head.slice(0, 512) : head;
  const hex = h.toString('hex');
  for (const m of MAGIC_TABLE) {
    for (const sig of m.hex) {
      if (hex.startsWith(sig)) return m.fmt;
    }
  }
  /* tar：offset 257 的 "ustar" */
  if (h.length >= 262 && h.slice(257, 262).toString('binary') === 'ustar') return 'tar';
  return null;
}

function sniff(file) {
  let fd = null;
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return null;
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(512);
    const n = fs.readSync(fd, buf, 0, 512, 0);
    return sniffBuffer(buf.slice(0, n));
  } catch (e) {
    return null;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch (e) { /* 忽略 */ } }
  }
}

/** 头部字节的**种类**判定（比 sniffBuffer 多分两类：网页 / 其它二进制）。
 *  为什么不合并进 sniffBuffer：sniffBuffer 是纯魔数、给「文件是不是压缩包」用；
 *  这里是「这条链接给回来的到底是什么」用，两者判据不同（后者还要认 HTML 中间页）。 */
function headKind(head) {
  const fmt = sniffBuffer(head);
  if (fmt) return { kind: 'archive', fmt };
  const s = head.slice(0, 400).toString('utf8').toLowerCase();
  if (/^\s*<(!doctype|html)/.test(s)) return { kind: 'html' };
  return { kind: 'other' };
}

/* ============================== 分卷识别 ============================== */

/* ★ 实测（pilot 疑点③）：`-v6k` 造出 vol.7z.001/.002/.003/.004；
 *   只解首卷 → 退出码 0 内容完整；只解 .002 → 退出码 2「系统找不到指定的文件」。
 *   ⇒ 必须认出「这是一组」并**只解首卷**，否则会把中间卷当成坏包报错。 */
const VOLUME_RULES = [
  /* .7z.001 / .zip.001 / .tar.001 —— 数字后缀，001 是首卷 */
  { re: /^(.*)\.(7z|zip|tar|gz|rar)\.(\d{3})$/i, group: (m) => m[1] + '.' + m[2], part: (m) => parseInt(m[3], 10) },
  /* .part1.rar / .part01.rar —— partN 是首卷 */
  { re: /^(.*)\.part(\d+)\.rar$/i, group: (m) => m[1] + '.partN.rar', part: (m) => parseInt(m[2], 10) },
  /* .z01 / .z02 —— zip 的旧式分卷，首卷是 .zip 本身 */
  { re: /^(.*)\.z(\d{2})$/i, group: (m) => m[1] + '.zNN', part: (m) => parseInt(m[2], 10) + 1 },
  /* .r00 / .r01 —— rar 旧式分卷，首卷是 .rar 本身 */
  { re: /^(.*)\.r(\d{2})$/i, group: (m) => m[1] + '.rNN', part: (m) => parseInt(m[2], 10) + 1 },
];

/**
 * 判断文件名是不是分卷、以及是不是首卷。
 * @returns {{group:string, part:number, first:boolean}|null}
 */
function volumeOf(fileName) {
  const base = path.basename(fileName);
  for (const r of VOLUME_RULES) {
    const m = base.match(r.re);
    if (m) {
      const part = r.part(m);
      return { group: path.join(path.dirname(fileName), r.group(m)), part, first: part === 1 };
    }
  }
  /* `.001` 裸数字后缀（无外层扩展名，少见但要认） */
  const m2 = base.match(/^(.*)\.(\d{3})$/);
  if (m2) {
    const part = parseInt(m2[2], 10);
    return { group: path.join(path.dirname(fileName), m2[1]), part, first: part === 1 };
  }
  return null;
}

/* ============================== 7z 调用 ============================== */

/**
 * 执行 7z。**三件必做的事，缺一不可**（全部实测得来）：
 *   ① `cp.stdin.end()` —— 7z 解加密包会去 stdin 要密码；不关 stdin 会永久挂起
 *      （第一次跑 pilot 就是这样被 SIGTERM 杀掉的）。
 *   ② 自带 kill 超时 —— 万一还有别的交互点，也不能把调用方拖死。
 *   ③ `-sccUTF-8` —— 否则中文路径输出乱码。
 */
function run7z(args, opts) {
  opts = opts || {};
  const exe = resolve7z();
  if (!exe) return Promise.resolve({ code: -3, stdout: '', stderr: '未找到 7z.exe（请安装 7-Zip 或设置 GAMEHUB_7Z）', missing: true });
  return new Promise((resolve) => {
    let cp;
    try {
      cp = spawn(exe, [...args, '-sccUTF-8'], { cwd: opts.cwd, windowsHide: true });
    } catch (e) {
      return resolve({ code: -1, stdout: '', stderr: String(e && e.message) });
    }
    let so = '', se = '', done = false;
    const fin = (r) => { if (!done) { done = true; clearTimeout(to); resolve(r); } };
    const to = setTimeout(() => {
      try { cp.kill('SIGKILL'); } catch (e) { /* 可能已退出 */ }
      fin({ code: -2, timeout: true, stdout: so, stderr: se });
    }, opts.timeout || 10 * 60_000);
    cp.stdout.on('data', (d) => { so += d; });
    cp.stderr.on('data', (d) => { se += d; });
    cp.on('close', (c) => fin({ code: c == null ? -1 : c, stdout: so, stderr: se }));
    cp.on('error', (e) => fin({ code: -1, stdout: so, stderr: se + '\n' + e.message }));
    cp.stdin.end();   /* ★ 见函数注释 ① */
  });
}

/* ★ 窄口径错误文案。**刻意收窄** —— pilot 疑点① 实测：宽口径（含裸 `encrypted`）
 *   会在正常包上产生假阳性，必须只匹配真正的错误句。
 *   兜底：退出码 255（不给 -p 时的密码提示路径）。 */
const RE_WRONG_PASSWORD = /wrong password|cannot open encrypted|password is incorrect|is not correct|data error in encrypted|the password is incorrect/i;
const RE_VOLUME_MISSING = /cannot find|找不到|not found|系统找不到/i;

/* ============================== 清单预检 ============================== */

/**
 * `7z l -slt` 预检：解压**之前**就拿到「是不是压缩包 / 要不要密码 / 包内有哪些文件」。
 * 这是 pilot 实测出来的最优路径 —— 比"先解了再看错"可靠得多。
 *
 * @returns {{ok:boolean, code:number, encrypted:boolean, entries:Array, headEncrypted:boolean, err:string|null}}
 */
async function listEntries(file, opts) {
  opts = opts || {};
  const args = ['l', '-slt'];
  if (opts.password) args.push('-p' + opts.password);
  args.push(file);
  const r = await run7z(args, { timeout: opts.timeout || 60_000 });
  const raw = r.stdout + '\n' + r.stderr;
  /* ★ 归档自身的元信息区（分隔线之前）也需要看 —— 有些包只在归档级标 Encrypted */
  const parts = String(r.stdout).split(/^-{8,}\s*$/m);
  const headBlock = parts[0] || '';
  const bodyBlock = parts.length > 1 ? parts.slice(1).join('\n') : '';
  const headEncrypted = /^Encrypted = \+/m.test(headBlock);

  /* 条目解析：分隔线之后才开始，key = value 累积到下一个 Path */
  const entries = [];
  let cur = null;
  for (const line of bodyBlock.split('\n')) {
    const m = line.match(/^([A-Za-z][A-Za-z0-9 ]*) = ([\s\S]*)$/);
    if (!m) continue;
    const k = m[1].trim();
    if (k === 'Path') { if (cur) entries.push(cur); cur = { path: m[2] }; }
    else if (cur) cur[k] = m[2];
  }
  if (cur) entries.push(cur);

  const itemEncrypted = entries.some((e) => String(e.Encrypted || '').trim() === '+');
  return {
    ok: r.code === 0,
    code: r.code,
    encrypted: headEncrypted || itemEncrypted,
    headEncrypted,
    entries,
    err: r.code === 0 ? null : (r.stderr || r.stdout).split('\n').filter(Boolean).slice(-2).join(' | '),
    raw,
  };
}

/* ============================== 密码验证（★ 必须用 `7z t`）============================== */

/**
 * 用 `7z t`（完整性测试）验证一个密码能不能用。
 *
 * ★★ 为什么不能用 `listEntries` 的退出码来判断密码对错（实测踩到）：
 *    对 zip，**文件名是明文**，所以给错误密码 `7z l -slt -pBAD` 照样 rc=0 并列出条目、
 *    照样能看到 `Encrypted = +` ⇒ 它根本区分不了「密码对不对」。
 *    而 `7z t` 实测：对密码 rc=0 / 错密码 rc=2 且 stderr 有 `ERROR: Wrong password : inner.txt`。
 *
 * ★★ 更关键：`7z t` **不受「目标文件已存在」影响**。实测对照 —— 同一个已解过一遍的目录：
 *      `7z t`     对密码 rc=0 · 错密码 rc=2      ⇒ 仍能区分
 *      `unpackOne` 对密码 ok=true · 错密码也 ok=true ⇒ 分不开（`-aos` 把活儿全跳过了）
 *    这就是「假成功」的根因：错密码 + 文件已存在 ⇒ 7z 直接跳过 ⇒ 退出码 0。
 *
 * @returns {{ok:boolean, code:number, wrongPassword:boolean}}
 */
async function testPassword(file, password) {
  const args = ['t'];
  if (password) args.push('-p' + password);
  args.push('-bso0', '-bsp0');    /* 关掉 stdout 信息与进度条；错误仍走 stderr */
  args.push(file);
  const r = await run7z(args, { timeout: 5 * 60_000 });
  return { ok: r.code === 0, code: r.code, wrongPassword: RE_WRONG_PASSWORD.test(r.stdout + '\n' + r.stderr) };
}

/** 全树快照（含目录）—— 用于失败回滚时连空目录一起清掉 */
function snapshotTree(dir) {
  const files = new Set(), dirs = new Set();
  const walk = (d, depth) => {
    if (depth > 12 || files.size > 20000) return;
    let list;
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of list) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) { dirs.add(fp); walk(fp, depth + 1); } else files.add(fp);
    }
  };
  walk(dir, 0);
  return { files, dirs };
}

/* ============================== 目录快照 ============================== */

/* 用「解压前后目录差集」判断**真实产出了什么**。
 * 为什么不直接用 `-slt` 的条目路径推算产出？因为那依赖「7z 一定保留包内相对路径」
 * 这个假设；差集不依赖任何假设，是观测事实。 */
function snapshotDir(dir, limit) {
  const out = new Set();
  const cap = limit || 20000;
  const walk = (d, depth) => {
    if (depth > 12 || out.size >= cap) return;
    let list;
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of list) {
      if (out.size >= cap) return;
      const fp = path.join(d, e.name);
      if (e.isDirectory()) walk(fp, depth + 1);
      else out.add(fp);
    }
  };
  walk(dir, 0);
  return out;
}

/* ============================== 解压单个包 ============================== */

/**
 * 解压一个包到 destDir（原地 = 包所在目录）。
 *
 * ★★ 失败时**必须回滚**本次新产生的文件。实测依据：
 *    错密码解压后目录里留下了一个 **0 字节的 `inner.txt`**（正确解出的是 27 B）。
 *    不回滚的后果有两层：① 污染用户的存档目录；② 下一次再解时这个 0 字节文件
 *    已经"存在"，会被 `-aos` 跳过，于是坏文件**永久留在那里**且不再报错。
 *
 * @returns {{ok:boolean, code:number, needPassword:boolean, skipReason:string|null,
 *            err:string|null, produced:string[], rolledBack:number, wrongPassword:boolean}}
 */
async function unpackOne(file, destDir, opts) {
  opts = opts || {};
  const before = snapshotTree(destDir);

  /* ⚠️ `file` 已在数组第 2 位，**不要**再 push 一次 —— 传两个文件参数会让 7z 行为异常
   *    （实测症状：退出码仍是 0，但产出为空，判定与产出对不上）。 */
  const args = ['x', file, '-o' + destDir, '-y'];
  /* ★ `-aos` = 跳过已存在文件。默认**开启**（用户偏好里明确「破坏性操作要谨慎」）：
   *   不覆盖已有文件比覆盖了再后悔好。要覆盖时显式传 overwrite:true。
   *   ⚠️ 但正因为它是"跳过"，会让 7z 在「文件已存在」时返回 0 —— 所以**密码必须在
   *      解压前用 `7z t` 卡住**（见 testPassword），不能靠这里的退出码兜底。 */
  if (!opts.overwrite) args.push('-aos');
  if (opts.password) args.push('-p' + opts.password);
  args.push('-bso0', '-bsp0');

  const r = await run7z(args, { timeout: opts.timeout || 15 * 60_000 });
  const txt = r.stdout + '\n' + r.stderr;

  const after = snapshotTree(destDir);
  const produced = [...after.files].filter((f) => !before.files.has(f));
  const newDirs = [...after.dirs].filter((d) => !before.dirs.has(d));

  /* ---- 判定顺序（★ 顺序有讲究，见各条注释）---- */
  let verdict;
  if (r.code === 0) {
    verdict = { ok: true, code: 0, needPassword: false, skipReason: null, err: null, wrongPassword: false };
  } else if (RE_WRONG_PASSWORD.test(txt) || r.code === 255) {
    /* ① 先判「缺密码」。两种形态都实测过：
     *      -p 给了但错   → 退出码 2 + 窄口径文案（`ERROR: Wrong password : inner.txt`）
     *      -p 根本没给   → 退出码 **255**（7z 去 stdin 要密码，我们给了 EOF）
     *    ⚠️ 不能只判退出码 2：坏包也是 2，会把「损坏」误报成「要密码」。 */
    verdict = { ok: false, code: r.code, needPassword: true, skipReason: 'password', err: '需要解压密码', wrongPassword: true };
  } else if (RE_VOLUME_MISSING.test(txt) && opts.isVolume) {
    /* ② 分卷缺卷：实测退出码 2 + 「系统找不到指定的文件」。与坏包同码，
     *    必须用文案在坏包判定**之前**拦下来，否则报错误的失败原因。 */
    verdict = { ok: false, code: r.code, needPassword: false, skipReason: 'volume', err: '分卷不完整（缺少其它卷）', wrongPassword: false };
  } else {
    /* ③ 其余一律按失败，但把 7z 的最后几行真实错误带出去（不吞错误） */
    const tail = (r.stderr || r.stdout).split('\n').map((s) => s.trim()).filter(Boolean).slice(-2).join(' | ');
    verdict = {
      ok: false, code: r.code, needPassword: false,
      skipReason: r.code === -2 ? 'timeout' : (r.missing ? 'no7z' : 'error'),
      err: tail || ('退出码 ' + r.code), wrongPassword: false,
    };
  }

  if (!verdict.ok) {
    /* ★★ 回滚（理由见函数头注释）。删除顺序：先文件、后目录（由深到浅）。 */
    let rolled = 0;
    for (const f of produced) { try { fs.unlinkSync(f); rolled++; } catch (e) { /* 已不在，忽略 */ } }
    for (const d of newDirs.sort((a, b) => b.length - a.length)) { try { fs.rmdirSync(d); } catch (e) { /* 非空则留着 */ } }
    return { ...verdict, produced: [], rolledBack: rolled, nothingNew: true };
  }
  /* ⚠️ `nothingNew` 是个**重要信号**：退出码 0 但一个新文件都没产出，通常意味着
   *    `-aos` 把活儿全跳过了（目标文件已存在）。此时"成功"是对的（东西已经在那里），
   *    但调用方**不能**把它当成"这次真的解出了东西"。见 unpackOne 头部的假成功说明。 */
  return { ...verdict, produced, rolledBack: 0, nothingNew: produced.length === 0 };
}

/* ============================== 递归解压（主流程）============================== */

/**
 * 对一个压缩包做**固定点迭代**解压：解一层 → 在产出里再找压缩包 → 还有就再解 →
 * 直到扫不出压缩包（或触到深度上限）。
 *
 * @param {string} file 起始压缩包
 * @param {object} [opts]
 *   · destDir    解压目标目录，默认 = 起始包所在目录（用户拍板「原地解压」）
 *   · maxDepth   最大嵌套层数，默认 5（防 A.zip 里还是 A.zip 的死循环）
 *   · passwords  候选密码数组（用户逐个填的密码，按序尝试）
 *   · onEvent    ({type, ...}) 进度回调：layer-start / layer-done / need-password / done
 * @returns 报告对象
 */
async function extractArchive(file, opts) {
  opts = opts || {};
  const maxDepth = opts.maxDepth || 5;
  const destDir = opts.destDir || path.dirname(file);
  const passwords = (opts.passwords || []).filter(Boolean);
  const emit = (e) => { try { if (opts.onEvent) opts.onEvent(e); } catch (err) { /* 回调异常不许影响主流程 */ } };

  fs.mkdirSync(destDir, { recursive: true });

  const report = {
    ok: true, root: file, destDir,
    layers: [], needsPassword: [], failures: [], skipped: [],
    produced: [], maxDepth, reachedDepth: 0,
  };

  let queue = [{ file, depth: 1 }];
  const seen = new Set();                       /* 防同一文件重复处理 */
  const doneSet = new Set();                    /* 分卷：整组只解一次首卷 */

  while (queue.length) {
    const next = [];
    for (const item of queue) {
      const { file: cur, depth } = item;
      const key = path.resolve(cur);
      if (seen.has(key)) continue;
      seen.add(key);

      if (depth > maxDepth) {
        report.skipped.push({ file: cur, depth, reason: 'max-depth' });
        emit({ type: 'skip', file: cur, depth, reason: 'max-depth' });
        continue;
      }

      /* ---- 分卷：只解首卷，且整组只解一次（实测见 VOLUME_RULES 注释） ---- */
      const vol = volumeOf(cur);
      if (vol) {
        if (!vol.first) {
          report.skipped.push({ file: cur, depth, reason: 'volume-part' });
          emit({ type: 'skip', file: cur, depth, reason: 'volume-part' });
          continue;
        }
        if (doneSet.has(vol.group)) continue;
        doneSet.add(vol.group);
      }

      const fmt = sniff(cur);
      if (!fmt) { report.skipped.push({ file: cur, depth, reason: 'not-archive' }); continue; }

      emit({ type: 'layer-start', file: cur, depth, format: fmt });

      /* ---- ① 预检：先读清单 —— 判断「能不能认出来」与「要不要密码」---- */
      const probe = await listEntries(cur, {});
      if (!probe.ok) {
        /* 读不出清单有两种可能，必须分开（实测）：
         *   · 头加密的包（RAR `-hp`）→ rc≠0 且文案像密码问题 ⇒ 归 needsPassword，不是坏包
         *   · 坏包 / 根本不是压缩包 → 归 failures
         *   分不开的话，头加密包会被报成「文件损坏」，用户永远不知道该填密码。 */
        if (RE_WRONG_PASSWORD.test(probe.raw || '') || probe.code === 255) {
          report.needsPassword.push({ file: cur, depth, format: fmt, name: path.basename(cur), entries: 0 });
          report.ok = false;
          emit({ type: 'need-password', file: cur, depth, name: path.basename(cur), entries: 0 });
          continue;
        }
        const tail = probe.err || ('退出码 ' + probe.code);
        report.failures.push({ file: cur, depth, code: probe.code, reason: 'unreadable', err: tail });
        report.ok = false;
        emit({ type: 'layer-fail', file: cur, depth, code: probe.code, err: tail });
        continue;
      }

      /* ---- ② 密码闸门：★ 用 `7z t` 验证，不用 listEntries 的退出码 ----
       * 为什么（实测）：对 zip，文件名是明文，给**错误密码** `7z l` 照样 rc=0、
       * 照样能看到 `Encrypted = +` ⇒ 它区分不了密码对错。
       * 而 `7z t` 对密码 rc=0 / 错密码 rc=2，且不受「文件已存在」影响（对照见 testPassword）。 */
      let usedPassword = null;
      if (probe.encrypted) {
        let hit = null;
        for (const pw of passwords) {
          const t = await testPassword(cur, pw);
          if (t.ok) { hit = pw; break; }
        }
        if (hit === null) {
          /* 明确地「列出 + 等用户填密码」，不静默跳过、也不猜、也不爆破 */
          report.needsPassword.push({ file: cur, depth, format: fmt, name: path.basename(cur), entries: probe.entries.length });
          report.ok = false;
          emit({ type: 'need-password', file: cur, depth, name: path.basename(cur), entries: probe.entries.length });
          continue;
        }
        usedPassword = hit;
      }

      /* ---- ② 解压 ---- */
      const r = await unpackOne(cur, destDir, {
        password: usedPassword,
        isVolume: !!vol,
        overwrite: opts.overwrite,
        timeout: opts.timeoutPerFile,
      });

      const layer = {
        depth, file: cur, name: path.basename(cur), format: fmt,
        ok: r.ok, code: r.code, needPassword: r.needPassword,
        skipReason: r.skipReason, err: r.err,
        produced: r.produced.length,
        /* `nothingNew`：退出码 0 但没产出新文件（多半是 `-aos` 跳过了已存在的）。
         * 界面据此提示「本次未产出新文件（可能已解压过）」，而不是假装解了一堆。 */
        nothingNew: !!r.nothingNew,
        rolledBack: r.rolledBack || 0,
      };
      report.layers.push(layer);
      report.produced.push(...r.produced);
      report.reachedDepth = Math.max(report.reachedDepth, depth);

      if (r.ok) emit({ type: 'layer-done', file: cur, depth, produced: r.produced.length });
      else if (r.needPassword) {
        report.needsPassword.push({ file: cur, depth, format: fmt, name: path.basename(cur) });
        report.ok = false;
        emit({ type: 'need-password', file: cur, depth, name: path.basename(cur) });
        continue;
      } else {
        report.failures.push({ file: cur, depth, code: r.code, reason: r.skipReason, err: r.err });
        report.ok = false;
        emit({ type: 'layer-fail', file: cur, depth, code: r.code, err: r.err });
        continue;
      }

      /* ---- ③ 在**本次产出**里找下一个压缩包（★ 按魔数，不按扩展名）---- */
      for (const p of r.produced) {
        const f2 = sniff(p);
        if (!f2) continue;
        /* 产出里的非首卷也要走一遍（外层包可能只放出首卷+其它卷）*/
        const v2 = volumeOf(p);
        if (v2 && !v2.first) { report.skipped.push({ file: p, depth: depth + 1, reason: 'volume-part' }); continue; }
        next.push({ file: p, depth: depth + 1 });
      }
    }
    queue = next;
  }

  report.files = [...new Set(report.produced)].length;
  report.final = [...new Set(report.produced)];
  emit({ type: 'done', report });
  return report;
}

/* ============================== 扫目录 ============================== */

/**
 * 扫一个目录里的压缩包（★ 按魔数，不按扩展名）。
 * 用途：用户手动把网盘下好的包丢进目录后，一键处理。
 * @returns {{file:string, format:string, size:number, isVolume:boolean, isFirstVolume:boolean}[]}
 */
function scanDir(dir, opts) {
  opts = opts || {};
  const out = [];
  const cap = opts.limit || 2000;
  const seenGroups = new Set();
  const walk = (d, depth) => {
    if (depth > 6 || out.length >= cap) return;
    let list;
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of list) {
      if (out.length >= cap) return;
      const fp = path.join(d, e.name);
      if (e.isDirectory()) { walk(fp, depth + 1); continue; }
      const fmt = sniff(fp);
      if (!fmt) continue;
      const vol = volumeOf(fp);
      if (vol) {
        /* 分卷组只收首卷（整组解一次就够；中间卷收进来会报「找不到文件」） */
        if (!vol.first) continue;
        if (seenGroups.has(vol.group)) continue;
        seenGroups.add(vol.group);
      }
      /* 一次 stat 取全部（原来 stat 了两次，且 mtimeMs 是浮点 —— 取整更像时间戳） */
      let size = 0, mtime = 0;
      try { const st = fs.statSync(fp); size = st.size; mtime = Math.round(st.mtimeMs); } catch (e) { /* 忽略 */ }
      out.push({ file: fp, format: fmt, size, mtime, isVolume: !!vol, isFirstVolume: vol ? vol.first : true });
    }
  };
  walk(dir, 0);
  return out;
}

/* ============================== 下载 ============================== */

/** 从 URL 推导安全的落盘文件名（★ 实测 content-disposition 常为空，只能靠 URL） */
function fileNameFromUrl(url, fallback) {
  let base = '';
  try {
    const u = new URL(url);
    base = path.basename(decodeURIComponent(u.pathname));
  } catch (e) { base = ''; }
  base = String(base).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim();
  /* Windows 保留名 */
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(base)) base = '_' + base;
  if (!base || base === '.' || base === '..') base = fallback || ('download-' + Date.now() + '.bin');
  if (base.length > 160) {
    const ext = path.extname(base).slice(0, 12);
    base = base.slice(0, 150) + ext;
  }
  return base;
}

/* ==================== v10.73：一个任务一个文件夹 ==================== */

/**
 * 清洗**单个路径段**（给「按游戏名建子目录」用）。
 *
 * ★★ 为什么必须把 `\` 与 `/` 一起换成 `_`：本版新增「一个任务一个文件夹」，
 *    而 `游戏名` 与 `原链名` 都来自**外部数据**（源站标题 / URL）。
 *    不清洗的话，一个叫 `..\..\..\Windows` 的游戏名就能让解压写到落点目录**之外** ——
 *    这是本版**新引入**的攻击面：v10.72 只往一个固定目录里落文件，压根没有这个口子。
 */
function sanitizeSeg(s, maxLen) {
  /* 只收字符串与数字：对象会被 `String()` 变成 `[object Object]` 混进文件夹名
   * （实测过），既难看又毫无意义 —— 直接当空段省略掉。 */
  if (typeof s !== 'string' && typeof s !== 'number') return '';
  let v = String(s);
  v = v.replace(/[\u0000-\u001f\u007f]/g, '');            /* 控制字符直接删（含换行/制表） */
  v = v.replace(/[\\/:*?"<>|]/g, '_');                    /* 路径分隔符 + Windows 非法字符 */
  v = v.replace(/\.{2,}/g, '_');                          /* `..` 是上跳；`...` 也会被尾点规则吞 */
  v = v.replace(/^[\s.]+/, '').replace(/[\s.]+$/, '');    /* 首尾空白与点（尾点 Win 会静默去掉） */
  if (maxLen && v.length > maxLen) v = v.slice(0, maxLen).replace(/[\s.]+$/, '');
  if (!v || v === '.' || v === '..') return '';
  /* ★ 整段只剩 `_` 与 `.`（例如输入就是 `..`，被上面换成 `_`）⇒ 视为**没有内容**。
   *   不拦的话会生成一个名叫 `_____` 的文件夹：不报错、但完全没意义，
   *   而且用户看到只会困惑「这是哪个游戏」。 */
  if (/^[_.]+$/.test(v)) return '';
  /* ★★ Windows 保留设备名（`con` / `aux` / `com1` …）的逃逸**不在这里做**。
   *   根因（v10.73 反证实测照出）：这一段对每个**段**加前缀 `_`，而 `taskFolderName`
   *   最后的收口 `replace(/^_+|_+$/g,'')` 会把这个前缀**又抹掉** ——
   *   `{game:'con'}` 最终拿到的目录名就是 `con`，等于逃逸没生效。
   *   ⇒ 挪到 `taskFolderName` 里对**最终目录名**做一次。这也更符合语义：
   *     Windows 的保留名规则看的是**整个目录名**，中间段叫 `con` 完全没问题
   *     （`G_con_x` 是合法目录）。 */
  return v;
}

/**
 * 造「一个任务一个文件夹」的名字：`游戏名_类别_原链名`（★ 原链名**去扩展名**）。
 * 例：`赛博朋克2077_存档_ALI213-2077-243487`
 * 任一段清洗后为空就自动省略 —— 绝不留下 `__`、也不留开头/结尾的 `_`。
 *
 * ★ 参数名用 `cat`（资源类别：本体 / mod / 存档 / 修改器）而不是 `kind`：
 *   server 里 `kind` 已经是「任务类型」（download / run）的意思，
 *   两个 `kind` 撞在一起，读代码的人迟早会搞混。
 */
function taskFolderName(opt) {
  opt = opt || {};
  const origin = path.basename(String(opt.fileName || ''));
  const bare = origin.replace(/\.[^.]+$/, '');           /* 去扩展名，如 .rar */
  const segs = [
    sanitizeSeg(opt.game, 48),
    sanitizeSeg(opt.cat, 12),
    sanitizeSeg(bare, 48),
  ].filter(Boolean);
  let name = segs.join('_');
  /* ★ 收口：段内转义（如保留名 `aux`→`_aux`）会在拼接处撞出 `__`，段为空被省略时
   *   也会留下首尾 `_`。这里统一抹平 —— 文件夹名是**用户要天天看的**，
   *   `_con_本体__aux` 这种很扎眼。 */
  name = name.replace(/_{2,}/g, '_').replace(/^_+|_+$/g, '');
  /* ★★ Windows 保留设备名逃逸 —— 必须做在**收口之后**、针对**最终目录名**。
   *   v10.73 反证照出的真 bug：原来这条写在 `sanitizeSeg` 里（对每个段加 `_` 前缀），
   *   紧接着被上面的收口抹掉 ⇒ `{game:'con'}` 得到的目录名还是 `con`，逃逸形同虚设。
   *   实测确认过 `sanitizeSeg('con')` 返回 `'_con'`，而 `taskFolderName({game:'con'})`
   *   返回 `'con'`。 */
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(name)) name = '_' + name;
  if (name.length > 120) name = name.slice(0, 120).replace(/[\s._]+$/, '');
  return name || ('task-' + Date.now().toString(36));
}

/**
 * 由落点根目录 + 命名要素算出**绝对子目录**，并做**二次边界校验**。
 *
 * ★ 清洗是「防」，这一步是「证」——两道都要有。万一以后有人放宽了 sanitizeSeg
 *   （或喂进来的不是字符串、而是带奇怪 `toString` 的对象），这里仍然拦得住。
 * ★ 判据用 `startsWith(root + path.sep)`：**必须带分隔符**，否则
 *   `…\GameHub-evil` 会被 `…\GameHub` 前缀骗过（分离比较的经典写错法）。
 *
 * @returns {{ok:boolean, dir?:string, name?:string, error?:string}}
 */
function taskDir(rootDir, opt) {
  let root;
  try { root = path.resolve(String(rootDir || DEFAULT_DEST)); }
  catch (e) { return { ok: false, error: '落点根目录无法解析' }; }
  const name = taskFolderName(opt);
  let full;
  try { full = path.resolve(root, name); }
  catch (e) { return { ok: false, error: '目录名无法解析' }; }
  if (!full.startsWith(root + path.sep)) {
    return { ok: false, error: '目录名越出落点根目录，已拒绝：' + name };
  }
  return { ok: true, dir: full, name };
}

/**
 * 下载直链到本地目录（**流式**，带进度回调）。★ 只对「真直链」有效 ——
 * 实测网盘（夸克/百度/迅雷）服务端拿不到，需客户端，会在此处失败并如实报错。
 *
 * 为什么流式：直链常有几十 MB 到几百 MB，一次性 arrayBuffer 会让界面在下载期间
 * 完全看不到动静（像卡死），也无法在中途判断"是不是 HTML 中间页"。
 *
 * ★ v10.73：**不是压缩包也照存**（`archive:false`），只有 HTML 网页才丢弃。
 *   `opts.expectArchive` 已删除 —— 它的旧语义（不是压缩包就丢弃）与
 *   「一个按钮走完下载」的唯一通道冲突，见函数内注释。
 *
 * @returns {{ok:boolean, file?:string, size?:number, status?:number, contentType?:string,
 *            sniffed?:string|null, archive?:boolean, head?:string, notArchive?:boolean, error?:string}}
 */
async function downloadTo(url, destDir, opts) {
  opts = opts || {};
  /* ★★ v10.73：这里**不再**一进门就 `mkdirSync`。
   *   根因是 v10.73 实测照出来的：`taskDir` 先给每个任务算好一个子目录，
   *   而 `downloadTo` 开门第一件事就是建它 —— 结果**遇到网页地址（not-archive）
   *   也会留下一个空文件夹**，「一个字节都不落盘」的承诺被打脸（实测确认：
   *   `测试网盘页_存档_VP0_…` 这个空目录真的被建出来了）。
   *   ⇒ 改成**要用的时候才建**（落盘前一行）。反正没文件要写就没有目录存在的理由。
   *   ★ 注意 `extractArchive` 自己也会 `mkdirSync(destDir)` —— 走到那一步时
   *     外层包已经写进该目录了，所以它那一下是无害的幂等操作。 */
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), opts.timeout || 20 * 60_000);
  try {
    const r = await fetch(url, {
      redirect: 'follow',
      signal: ctl.signal,
      headers: { 'User-Agent': opts.ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' },
    });
    if (!r.ok && r.status !== 206) {
      return { ok: false, status: r.status, error: 'HTTP ' + r.status + '（网盘链接通常如此：服务端取不到真实文件）' };
    }
    const total = parseInt(r.headers.get('content-length') || '0', 10) || 0;
    const chunks = [];
    let got = 0;
    /* ★ v10.72：「自动判断这条链接是不是压缩包」就在这里 —— 边收边判头部。
     *   ⚠️ 顺手修掉一个既有 bug：原来写成 `if (got <= 400) { ...判 HTML... }` ——
     *      只要首个 chunk 就大于 400 字节（大文件几乎必然如此），**那次判定被整个跳过**，
     *      HTML 中间页会一路下完才暴露。改成「累积头部 + 每轮都判」。
     *
     *   ★★ v10.73 语义反转（用户拍板「不要解压按钮，默认到下载中」）：
     *      判据从「不是压缩包就**丢**」改成「不是压缩包就**照存**」。
     *      为什么必须反转：原来那个丢弃行为是配着**并列的第二个按钮**用的
     *      （点错了没关系，旁边还有一个「⬇ 直接下载」）。现在只剩一个按钮、
     *      它就是「下载」本身 —— 再丢弃就等于「点了没结果」，那是更糟的体验。
     *      ⇒ 现在**只有一种情况仍然丢弃**：返回的是 HTML 网页（登录页/网盘页/错误页）。
     *        存一个 146 字节的错误页 HTML 进用户目录纯属制造垃圾，没有任何价值。
     *      是不是压缩包，由返回值 `archive` / `sniffed` 如实告诉调用方，由它决定解不解。 */
    let headBuf = Buffer.alloc(0);
    let headV = null;
    const judge = (final) => {
      if (headV) return headV;
      if (headBuf.length >= 512 || final) headV = headKind(headBuf);
      return headV;
    };
    /* ★★ v10.72 实测踩到并修掉的坑 —— 在 `for await (r.body)` **循环内部**调
     *   `ctl.abort()` 再 return，abort 会让**正在被迭代的那个流**抛
     *   `AbortError: This operation was aborted`；这个异常比 return 先到外层 catch，
     *   于是结论被吞掉，只剩一句含糊的「This operation was aborted」。
     *
     *   实测症状（本版第一轮 e2e）：拿一条网盘页去打，本该回
     *   `state=not-archive / notArchive=true`，实际回的是
     *   `state=error / error=This operation was aborted` —— **两种完全不同的处置
     *   被折叠成了一个**（「换按钮」vs「重试」），前端根本没法给对提示。
     *
     *   ⇒ 改成：循环内只 `break`，循环外统一返回。`break` 会触发异步迭代器的
     *     return()，ReadableStream 顺势 cancel 掉剩余流 —— 一样是「立刻停止下载」，
     *     但不会制造异常。 */
    const bail = (msg, extra) => Object.assign({
      ok: false, status: r.status, error: msg,
      contentType: r.headers.get('content-type') || '',
    }, extra || {});
    let early = null;
    for await (const chunk of r.body) {
      chunks.push(chunk);
      got += chunk.length;
      if (headBuf.length < 512) headBuf = Buffer.concat([headBuf, chunk]).slice(0, 512);
      const v = judge(false);
      if (v && v.kind === 'html') {
        early = bail('返回的是 HTML 页面而不是文件（网盘页 / 需要登录的中间页 / 错误页）', { notArchive: true, head: 'html' });
        break;
      }
      if (opts.maxBytes && got > opts.maxBytes) {
        early = bail('超过大小上限 ' + opts.maxBytes + ' B');
        break;
      }
      if (opts.onProgress) { try { opts.onProgress({ got, total }); } catch (e) { /* 回调异常不影响下载 */ } }
    }
    if (early) return early;
    /* 流结束但头部还不足 512 字节（小文件）—— 补判一次，别让「小 HTML 错误页」溜过去。
     * ★ v10.73：这里只剩 HTML 一条。原来「other + expectArchive ⇒ 丢弃」那条已删除
     *   （语义反转见上方注释）：小文件只要不是 HTML，就该**照存**。 */
    {
      const v = judge(true);
      if (v && v.kind === 'html') {
        return { ok: false, status: r.status, error: '返回的是 HTML 页面而不是文件（网盘页 / 需要登录的中间页 / 错误页）', notArchive: true, head: 'html' };
      }
    }
    const buf = Buffer.concat(chunks);
    const name = fileNameFromUrl(r.url || url, opts.name);
    const file = path.join(destDir, name);
    /* ★ 目录在被真正需要的那一刻才建（上面 downloadTo 开头已不再预建，原因见那里） */
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(file, buf);
    /* 落盘时**如实回带**识别结果：调用方要显示「下到的是 zip」而不是靠扩展名猜；
     * `archive` 决定后续解不解 —— 判据只在这里算一次，调用方不再自己判一遍。 */
    const hv = headKind(buf.slice(0, 512));
    return {
      ok: true, file, size: buf.length, status: r.status,
      contentType: r.headers.get('content-type') || '',
      finalUrl: r.url || url,
      sniffed: hv.fmt || null,
      archive: hv.kind === 'archive',
      head: hv.kind,
    };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally { clearTimeout(to); }
}

/* ============================== 自检 ============================== */

/** 环境自检：7z 在不在、版本对不对。给页面显示「解压器就绪」用。 */
async function envCheck() {
  const exe = resolve7z();
  if (!exe) return { ready: false, exe: null, version: null, hint: '未找到 7z.exe，请安装 7-Zip 或设置环境变量 GAMEHUB_7Z' };
  const r = await run7z(['i'], { timeout: 20_000 });
  const line = (r.stdout.split('\n').find((l) => /\d+\.\d+.*Copyright/i.test(l)) || '').trim();
  return { ready: r.code === 0, exe, version: line || null };
}

module.exports = {
  resolve7z, _reset7zCache, DEFAULT_DEST,
  sniff, sniffBuffer, headKind, volumeOf, VOLUME_RULES,
  listEntries, testPassword, unpackOne, extractArchive, scanDir,
  downloadTo, fileNameFromUrl, snapshotDir, snapshotTree, envCheck,
  sanitizeSeg, taskFolderName, taskDir,
  run7z,
  MAGIC_TABLE,
};
