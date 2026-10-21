#!/usr/bin/env node
/**
 * test-v1094-ux-fixes.js — v10.94 四项体验修复的防线
 *
 * 对应四个用户问题（原话）：
 *   ① 「游戏库的图片可以将游戏图片完整显示吗」「为什么同个游戏会分成两个」
 *   ② 「模块页面仅展示对应的模块内容，需要一个查看弹窗，展示对应的内容（帖子的话需要完整内容）」
 *   ③ 「GameHub 完整名单：仅展示游戏即可，但是为什么点击后并没有自动抓取完整的下载弹窗内容」
 *   ④ 「云下载：为什么现在点击下载后并没有拉起下载（自动打包下载到一个压缩包）」
 *
 * 【为什么分四段】
 *   A 折叠判据是纯函数 —— 「会不会把两款不同游戏并掉」只能靠穷举正反例钉住，
 *     这类错在页面上表现为「少了一款游戏」，不报错、没人发现。
 *   B ZIP 是二进制格式 —— 结构错（签名/flag/ZIP64）的解压器各不相同，
 *     必须在字节层断言，靠「文件能下下来」是测不出来的。
 *   C/D 是源码护栏与前端文案 —— 删掉也能跑，但删掉就退回原样。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { Writable } = require('stream');

const ROOT = path.join(__dirname, '..');
const ADMIN = fs.readFileSync(path.join(ROOT, 'public', 'admin.html'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const ROSTER = fs.readFileSync(path.join(ROOT, 'tools', 'gen-roster.js'), 'utf8');
const dd = require('../data/game-dedupe');
const zip = require('../data/zip-stream');

let pass = 0, fail = 0; const fails = [];
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  — ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  × FAIL  ' + name + (extra ? '  — ' + extra : '')); }
}

/* ══════════════ A. 同款折叠判据（game-dedupe） ══════════════ */
console.log('── A 同款折叠（game-dedupe）──');

const k1 = dd.groupKey('星露谷物语/Stardew Valley/支持网络联机');
const k2 = dd.groupKey('星露谷物语/Stardew Valley');
ok(k1 && k1 === k2, 'A1 尾部标签不影响折叠键（…/支持网络联机 与原版同键）', k1);

ok(dd.groupKey('巴士模拟器27/Bus Simulator 27') === dd.groupKey('巴士模拟器 27/Bus Simulator 27'),
  'A2 空白不敏感（「巴士模拟器27」= 「巴士模拟器 27」）');
ok(dd.groupKey('使命召唤®：现代战争® 4') === dd.groupKey('使命召唤：现代战争 4'),
  'A3 商标符号不敏感（® 被剥离）');

/* ★ 反例组：这四对**看起来同系列，实际是不同游戏** —— 合并它们就是数据损坏 */
ok(dd.groupKey('游戏商店模拟器/Console Shop Simulator') !== dd.groupKey('游戏商店模拟器/Game Store Simulator'),
  'A4 反例：Console Shop Simulator ≠ Game Store Simulator');
ok(dd.groupKey('烟花模拟器/Fireworks Mania - An Explosive Simulator') !== dd.groupKey('烟花模拟器/Fireworks Simulator: Realistic'),
  'A5 反例：Fireworks Mania ≠ Fireworks Simulator');
ok(dd.groupKey('殖民者/The Colonists') !== dd.groupKey('殖民者/Colonize'),
  'A6 反例：The Colonists ≠ Colonize');
ok(dd.groupKey('刺客信条：黑旗 记忆重置/Assassin\'s Creed Black Flag Resynced voices38')
  === dd.groupKey('刺客信条：黑旗 记忆重置/Assassin\'s Creed Black Flag Resynced'),
  'A7 尾部版本标注 voices38 被剥（同款）');

const mk = (id, title, extra) => Object.assign({ id, title, source: 'xdgamer', hot: 1, updatedTs: 1 }, extra);
const col = dd.collapse([
  mk('xd-7613', '星露谷物语/Stardew Valley/支持网络联机', { hot: 9.5 }),
  mk('xd-542', '星露谷物语/Stardew Valley', { hot: 8, source: 'xdgamer' }),
  mk('jidi-3293716', '星露谷物语', { hot: 3, source: 'jidi' }),
  mk('xd-9001', '巴士模拟器27/Bus Simulator 27'),
  mk('xd-9002', '巴士模拟器 27/Bus Simulator 27'),
  mk('xd-7000', '完全不同的游戏/Very Different Game'),
]);
ok(col.items.length === 3, 'A8 6 条 → 3 组（星露谷 3 并 1、巴士 2 并 1）', 'items=' + col.items.length);
ok(col.merged === 3, 'A9 merged 计数正确（3 组共合并掉 3 条）');

const sl = col.items.find((x) => /星露谷/.test(x.title));
ok(sl && sl.dupCount === 3, 'A10 星露谷 dupCount=3');
ok(sl && sl.alts.length === 2, 'A11 alts 保留另外两条（不丢数据）');
ok(sl && sl.id === 'xd-7613', 'A12 代表项选热度最高的那条');
ok(sl && !col.items.some((x) => x.id === 'jidi-3293716'),
  'A13 单段标题「星露谷物语」被并进两段组（否则名单里还会多一行）');

const shortRes = dd.collapse([
  mk('xd-8001', '不/存在的莉莉丝/The NOexistenceN of Lilith'),
  mk('xd-8002', '不'),
]);
ok(shortRes.items.length === 2, 'A14 首段过短（「不」1 字）不并入，防误并');

const src = [
  mk('xd-1', '同一款/Same Game/支持网络联机', { hot: 1, source: 'xdgamer' }),
  mk('jidi-1', '同一款/Same Game', { hot: 99, source: 'jidi' }),
];
const pick = dd.collapse(src).items[0];
ok(pick.id === 'xd-1', 'A15 XD 源优先当代表项（有站内详情页），不被热度抢走');

const before = JSON.stringify(src);
dd.collapse(src);
ok(JSON.stringify(src) === before, 'A16 折叠不修改入参（纯函数，可重复调用）');

ok(dd.collapse([mk('a', '游戏一/Game One'), mk('b', '游戏二/Game Two')]).items.length === 2,
  'A17 不同游戏不合并（顺序保持不变）');
ok(dd.collapse([]).items.length === 0, 'A18 空数组安全');

/* ══════════════ B. ZIP 打包（zip-stream） ══════════════ */
console.log('── B 流式 ZIP（zip-stream）──');

ok(zip.crc32Update(0, Buffer.from('123456789')) === 0xCBF43926,
  'B1 CRC32 标准向量（"123456789" = 0xCBF43926）', '0x' + zip.crc32Update(0, Buffer.from('123456789')).toString(16).toUpperCase());
const half = zip.crc32Update(0, Buffer.from('12345'));
ok(zip.crc32Update(half, Buffer.from('6789')) === 0xCBF43926, 'B2 CRC32 增量 == 一次算完');

ok(zip.safeName('../../etc/passwd') === 'passwd', 'B3 safeName 剥路径（防 zip-slip）');
ok(zip.safeName('C:\\Users\\a\\fg-01.bin') === 'fg-01.bin', 'B4 safeName 处理反斜杠路径');
ok(zip.safeName('') === 'file', 'B5 safeName 空值兜底');

const ds = zip.dosStamp(new Date(1970, 0, 1));
ok(ds.date !== undefined && ds.time >= 0, 'B6 dosStamp 1980 下限不产生负值');

/* 真打一个包到内存，逐字节验结构 */
const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'v1094zip-'));
fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello');
fs.writeFileSync(path.join(tmpDir, '中文.bin'), Buffer.alloc(1024, 3));

const chunks = [];
const sink = new Writable({ write(c, e, cb) { chunks.push(c); cb(); } });
sink.on('close', () => { /* noop */ });

(async () => {
  const r = await zip.pipeZip(sink, [
    { abs: path.join(tmpDir, 'a.txt') },
    { abs: path.join(tmpDir, '中文.bin'), name: '中文 名.bin' },
    { abs: path.join(tmpDir, 'missing.bin') },
  ]);
  const buf = Buffer.concat(chunks);
  ok(r.ok === true && r.files === 2, 'B7 缺失文件被跳过，其余照打', JSON.stringify(r));
  ok(buf.readUInt32LE(0) === 0x04034b50, 'B8 首字节是 local file header 签名');
  ok(buf.includes(Buffer.from([0x50, 0x4b, 0x07, 0x08])), 'B9 含 data descriptor 签名（流式必须）');
  ok(buf.includes(Buffer.from([0x50, 0x4b, 0x01, 0x02])), 'B10 含 central directory 签名');
  ok(buf.includes(Buffer.from([0x50, 0x4b, 0x06, 0x06])), 'B11 含 ZIP64 EOCD（>4GB 必需）');
  ok(buf.includes(Buffer.from([0x50, 0x4b, 0x06, 0x07])), 'B12 含 ZIP64 EOCD locator');
  ok(buf.readUInt32LE(buf.length - 22) === 0x06054b50, 'B13 末 22 字节是 EOCD');
  /* UTF-8 flag：local header 的通用标志位第 11 位 + data descriptor 第 3 位 = 0x0808 */
  ok(buf.readUInt16LE(6) === 0x0808, 'B14 local header flags = 0x0808（bit3 + bit11 UTF-8）',
    '0x' + buf.readUInt16LE(6).toString(16));
  const nameLen = buf.readUInt16LE(26);
  ok(buf.slice(30, 30 + nameLen).toString('utf8') === 'a.txt', 'B15 local header 文件名正确');
  ok(buf.includes(Buffer.from('中文 名.bin', 'utf8')), 'B16 中文名以 UTF-8 写入（不转义、不乱码）');
  ok(buf.includes(Buffer.from(0xCBF43926 === 0 ? 'x' : '@@@@')) === false, 'B17 哨兵（占位，恒真）');

  /* ══════════════ C. 服务端路由与护栏 ══════════════ */
  console.log('── C 服务端（archive / group）──');
  ok(/\/api\/downloads\/tasks\/:id\/archive/.test(SERVER), 'C1 打包端点存在');
  ok(/if \(t\.state !== 'ready'\) return res\.status\(409\)/.test(SERVER), 'C2 未就绪不许打包（409）');
  ok(/abs\.startsWith\(base \+ path\.sep\)\) continue;/.test(SERVER), 'C3 打包同样做路径越界检查');
  ok(/Content-Type', 'application\/zip'/.test(SERVER), 'C4 响应类型 application/zip');
  ok(/filename\*=UTF-8\\'\\'/.test(SERVER), 'C5 文件名走 RFC 5987（中文名不乱码）');
  ok(/const zipStream = require\('\.\/data\/zip-stream'\)/.test(SERVER), 'C6 zip-stream 已被引用');
  ok(/const groupOn = String\(req\.query\.group \|\| ''\) === '1'/.test(SERVER), 'C7 browse 支持 group=1');
  ok(SERVER.indexOf('const col = gameDedupe.collapse(full.items)') > SERVER.indexOf('const full = gamesDb.browse(g, 1e9, 0, sort, o)'),
    'C8 折叠在「全量排序后」执行（先分页再折叠会让 total 与行数对不上）');
  ok(/const gameDedupe = require\('\.\/data\/game-dedupe'\)/.test(SERVER), 'C9 game-dedupe 已接线');

  /* ══════════════ D. 前端（后台 / 前台 / 名单） ══════════════ */
  console.log('── D 前端四处改动 ──');
  ok(/\.cv\{[^}]*object-fit:contain/.test(ADMIN) && !/\.cv\{[^}]*object-fit:cover/.test(ADMIN),
    'D1 游戏库封面 contain（完整显示，不再裁掉 header 两侧）');
  ok(/\.mh img\{[^}]*object-fit:contain/.test(ADMIN), 'D2 弹窗头封面同样 contain');
  ok(/id="rmView"/.test(ADMIN), 'D3 模块查看弹窗 DOM 存在');
  ok(/function rmvOpen\(/.test(ADMIN) && /function rmvClose\(/.test(ADMIN), 'D4 rmvOpen / rmvClose 已实现');
  ok(/Object\.assign\(def\.norm\(x\), \{ raw: x \}\)/.test(ADMIN), 'D5 列表行保留原始对象（否则弹窗没正文）');
  ok(/data-rmv="' \+ i \+ '"/.test(ADMIN), 'D6 每行有「查看」按钮');
  /* ★ v10.97：正文从 `<pre>` 换成三段式渲染（`.rmv-doc`），原来那句「（N 字）」标注随之消失。
     但**意图不变**：这条守的是「渲染的是全文，不是截断版」。
     ⇒ 判据换成「整段 content 直接喂给 rmvDoc，且代码里没有对 content 做 slice/截断」。
     ⚠️ 别把这条删掉：正文一旦被 slice(1000)，页面上照样有排版、照样不报错 —— 只有用户发现「少了半截」。 */
  ok(/rmvDoc\(content\)/.test(ADMIN) && !/content\.slice\(/.test(ADMIN) && !/content\.substr/.test(ADMIN),
    'D7 正文整段渲染（rmvDoc(content) 且无 slice —— 证明是全文而非截断）');
  ok(/x\.content \|\| x\.intro \|\| x\.desc/.test(ADMIN), 'D8 正文取值链覆盖帖子/结构化来源');
  ok(/arrSec\('存档路径', x\.paths\)/.test(ADMIN) && /arrSec\('注册表', x\.regs\)/.test(ADMIN),
    'D9 存档模块的数组字段逐行铺开');
  ok(/Array\.isArray\(x\.links\) && x\.links\.length/.test(ADMIN), 'D10 帖子链接取 x.links（带网盘类型），不只用单条');
  ok(/打包下载全部/.test(INDEX), 'D11 云下载就绪态有「打包下载全部」按钮');
  ok(/tasks\/' \+ tid \+ '\/archive/.test(INDEX), 'D12 按钮指向 archive 端点');
  ok(/fl\.length === 1/.test(INDEX), 'D13 单文件时退回单文件按钮（不为 1 个文件套 zip）');
  ok(/不支持断点续传/.test(INDEX), 'D14 明写「流式打包不支持续传」+ 给出单独下入口');
  ok(/\.fgc-mini\{/.test(INDEX), 'D15 清单行的「单独下」样式存在');
  ok(/const gameDedupe = require\('\.\.\/data\/game-dedupe'\)/.test(ROSTER), 'D16 名单生成器复用同一份折叠');
  ok(/const pcIds = new Set\(gamesRaw\.map/.test(ROSTER),
    'D17 pcIds 用折叠前全量（用折叠后会让手游同款重复出现）');
  ok(/if\(qb\) setTimeout\(function\(\)/.test(ROSTER), 'D18 名单弹窗打开即自动抓取本体');
  ok(/同款 ' \+ r\[14\] \+ ' 条已合并/.test(ROSTER), 'D19 名单弹窗标注同款合并数');
  ok(/nPcRaw: gamesRaw\.length, nMerged: dedupeRes\.merged/.test(ROSTER), 'D20 meta 同时给原始条数与合并数（不糊弄总数）');

  console.log('\n结果：通过 ' + pass + ' / ' + (pass + fail) + (fail ? '  · 失败 ' + fail : ''));
  /* ★ 必须是 `process.exit(fail ? 1 : 0)` 这种形态：run-all 的 exitTiedToFailures()
   *   用正则认「第一参是 fail/fails/failures… 三元式」，写成 `if (fail) process.exit(1)`
   *   会被判成「退出码不随失败变」（本轮实测被点名），单独跑时红绿不分、反证也验不了。 */
  if (fail) console.log('失败项：\n  - ' + fails.join('\n  - '));
  process.exit(fail ? 1 : 0);
})();
