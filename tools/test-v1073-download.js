/**
 * tools/test-v1073-download.js — 第一层（静态/离线）：验收「一个按钮走完下载 + 自动解压」这一版
 *
 * v10.73 新增。需求原话（2026-10-14）：
 *   「不要解压按钮（默认到下载中），其次解压助手保留日志以及路径，
 *     还有如果是解压了则生成一个文件夹（游戏名+本体/mod/存档/修改器+原链名）」
 *
 * 本套件覆盖**这一版新引入的三块**（v10.72 那套继续管「HTML 早停 / 单一真源」）：
 *   ① 命名与落点：`sanitizeSeg` / `taskFolderName` / `taskDir` —— 纯粹函数，不起进程
 *   ② ★★ 攻击面：文件夹名掺了**外部数据**（源站标题 + URL），不清洗就能爬出落点目录
 *   ③ 接缝层：服务端历史留档（落盘 / 按 id 覆盖 / finally 单一出口）+ 页面结构
 *
 * ★ 为什么这一版必须单开一个套件，而不是往 v1072 里塞：
 *   两版的**语义是相反的**（v10.72「不是压缩包就丢」→ v10.73「不是压缩包就照存」）。
 *   塞在一起会出现「同一个文件里两条互相矛盾的断言」——下一轮读的人不知道该信哪条。
 *   v1073 管新语义，v1072 里那几条已经**显式反转**并写明了原因。
 *
 * 跑法：node tools/test-v1073-download.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const EX = require('../data/extractor');

const PUB = path.join(__dirname, '..', 'public');
const SRV = path.join(__dirname, '..', 'server.js');
const EXJ = path.join(__dirname, '..', 'data', 'extractor.js');

let pass = 0, fail = 0;
function chk(name, ok, extra) {
  if (ok) { pass++; console.log('  ✅ ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '   ' + extra : '')); }
}
function hr(t) { console.log('\n' + '─'.repeat(74) + '\n' + t + '\n' + '─'.repeat(74)); }

/* 落点根用**不存在的**假路径：这一节全是纯函数，一个目录都不该被建出来
 * （T3 就是专门验这一点的）。 */
const ROOT = path.resolve(path.join('C:', 'Users', 'x', 'Downloads', 'GameHub'));

(async () => {
  /* ══════════════ 1 命名：游戏名_类别_原链名 ══════════════ */
  hr('1 taskFolderName — 一个任务一个文件夹');

  chk('N0 ★ 阳性对照：三要素齐 → 游戏名_类别_原链名（去扩展名）',
    EX.taskFolderName({ game: '赛博朋克2077', cat: '存档', fileName: 'ALI213-2077-243487.rar' })
      === '赛博朋克2077_存档_ALI213-2077-243487',
    EX.taskFolderName({ game: '赛博朋克2077', cat: '存档', fileName: 'ALI213-2077-243487.rar' }));

  chk('N1 去扩展名：只去**最后一截**（`a.b.7z` → `a.b`）',
    EX.taskFolderName({ game: 'G', cat: '本体', fileName: 'a.b.7z' }) === 'G_本体_a.b',
    EX.taskFolderName({ game: 'G', cat: '本体', fileName: 'a.b.7z' }));
  chk('N2 没有扩展名也不动它',
    EX.taskFolderName({ game: 'G', cat: 'mod', fileName: 'noext' }) === 'G_mod_noext');

  chk('N3 ★ 段为空就省略，绝不留下 `__` 或首尾 `_`',
    EX.taskFolderName({ game: '', cat: '存档', fileName: 'x.zip' }) === '存档_x' &&
    EX.taskFolderName({ game: 'G', cat: '', fileName: 'x.zip' }) === 'G_x' &&
    EX.taskFolderName({ game: '', cat: '', fileName: 'x.zip' }) === 'x',
    EX.taskFolderName({ game: '', cat: '存档', fileName: 'x.zip' }) + ' / ' +
    EX.taskFolderName({ game: 'G', cat: '', fileName: 'x.zip' }));
  /* ★★ N3b / N3c 是「收口」那行唯一的守卫 —— 反证 ⑩ 照出来的：
   *   段被 `.filter(Boolean)` 挡掉之后，N3 那三个样本**本来就已经干净**，
   *   收口删掉它们也照样全绿（假绿）。真正让收口干活的是「段自己带下划线」的两档。 */
  chk('N3b ★ 段内的 `__` 被抹成 `_`（拼出来的名字不能带双下划线）',
    EX.taskFolderName({ game: 'a__b', cat: '本体', fileName: 'x.zip' }) === 'a_b_本体_x',
    EX.taskFolderName({ game: 'a__b', cat: '本体', fileName: 'x.zip' }));
  chk('N3c ★ 段自带的**首尾** `_` 被抹掉（`_x_` → `x`）',
    EX.taskFolderName({ game: '_x_', cat: '', fileName: '' }) === 'x',
    JSON.stringify(EX.taskFolderName({ game: '_x_', cat: '', fileName: '' })));

  chk('N4 ★ 保留名在**拼接后的整名**上不构成保留名 → 不动它（`con_本体_aux`）',
    EX.taskFolderName({ game: 'con', cat: '本体', fileName: 'aux.7z' }) === 'con_本体_aux',
    EX.taskFolderName({ game: 'con', cat: '本体', fileName: 'aux.7z' }));
  /* ★★ N4b 是**反证照出来的真 bug**留下的守卫（v10.73）：
   *   原来保留名逃逸写在 `sanitizeSeg` 里对每个段加 `_` 前缀，紧接着被 `taskFolderName`
   *   的收口 `replace(/^_+|_+$/g,'')` **抹掉** ⇒ `{game:'con'}` 得到的目录名还是 `con`
   *   （实测：`sanitizeSeg('con')` = `_con`，`taskFolderName({game:'con'})` = `con`）。
   *   Windows 上叫 `con` 的目录根本建不出来 ⇒ 这条必须**判单段**，
   *   拿 `con_本体_aux` 去判是照不出来的（那个名字本来就不是保留名，改不改都过）。 */
  chk('N4b ★★ 整名就是保留设备名时必须转义（`{game:con}` → `_con`，不许还是 `con`）',
    ['con', 'prn', 'aux', 'nul', 'com1', 'lpt9'].every((r) =>
      EX.taskFolderName({ game: r }) === '_' + r),
    ['con', 'aux', 'com1'].map((r) => r + '→' + EX.taskFolderName({ game: r })).join(' '));
  chk('N4c 保留名出现在**中间段**时不用转义（Windows 只看整个目录名）',
    EX.taskFolderName({ game: 'G', cat: 'con', fileName: 'x.zip' }) === 'G_con_x');

  chk('N5 ★ 首尾点/空格被去掉（Windows 会**静默**丢掉尾点，名字就跟预期对不上了）',
    EX.taskFolderName({ game: '  星露谷.  ', cat: ' mod ', fileName: ' p.rar ' }) === '星露谷_mod_p',
    JSON.stringify(EX.taskFolderName({ game: '  星露谷.  ', cat: ' mod ', fileName: ' p.rar ' })));

  chk('N6 控制字符被删（换行/制表不能进文件夹名）',
    (() => {
      const n = EX.taskFolderName({ game: 'a\nb\tc', cat: '本体', fileName: 'x.zip' });
      return !/[\u0000-\u001f\u007f]/.test(n) && n === 'abc_本体_x';
    })(), JSON.stringify(EX.taskFolderName({ game: 'a\nb\tc', cat: '本体', fileName: 'x.zip' })));

  chk('N7 ★ 对象段被当空省略（否则会拼出 `[object Object]` 这种文件夹名）',
    EX.taskFolderName({ game: { a: 1 }, cat: '本体', fileName: 'x.zip' }) === '本体_x',
    EX.taskFolderName({ game: { a: 1 }, cat: '本体', fileName: 'x.zip' }));
  chk('N8 数字段保留（源站有时给数字 id）',
    EX.taskFolderName({ game: 12, cat: 3, fileName: 'x.zip' }) === '12_3_x');

  chk('N9 长度上限 120，且不会以点/空格收尾',
    (() => {
      const n = EX.taskFolderName({ game: 'G'.repeat(200), cat: '本体', fileName: 'x.zip' });
      return n.length <= 120 && !/[\s.]$/.test(n);
    })(), 'len=' + EX.taskFolderName({ game: 'G'.repeat(200), cat: '本体', fileName: 'x.zip' }).length);

  chk('N10 ★ 全空兜底 → 非空且带时间戳（不许返回空串去拼路径）',
    /^task-[0-9a-z]+$/.test(EX.taskFolderName({ game: '', cat: '', fileName: '' })),
    EX.taskFolderName({ game: '', cat: '', fileName: '' }));
  chk('N11 连参数都不给也不炸',
    typeof EX.taskFolderName() === 'string' && EX.taskFolderName().length > 0);

  /* ══════════════ 2 ★★ 攻击面：文件夹名来自外部数据 ══════════════ */
  hr('2 ★★ 从外部数据来的名字必须**爬不出**落点根目录');
  /* 这些样本不是编出来的：`game` 来自源站标题、`fileName` 来自 URL，
   * 两者都是**别人可控**的字符串。v10.73 之前根本不存在这个口子
   * （只往一个固定目录里落文件），是「一个任务一个文件夹」**引入**的。 */
  const EVIL = [
    { label: '经典上跳', game: '..\\..\\..\\Windows', cat: '本体', fileName: 'a.zip' },
    { label: '正斜杠上跳', game: '../../../../etc', cat: '本体', fileName: 'a.zip' },
    { label: '盘符绝对路径', game: 'C:\\Windows\\System32', cat: '本体', fileName: 'a.zip' },
    { label: 'UNC 路径', game: '\\\\server\\share', cat: '本体', fileName: 'a.zip' },
    { label: '斜杠混用', game: 'a/../../b\\..\\..\\c', cat: '本体', fileName: 'a.zip' },
    { label: '文件名上跳', game: 'G', cat: '本体', fileName: '..\\..\\evil.zip' },
    { label: '纯点点', game: '..', cat: '..', fileName: '...' },
    { label: '路径分隔符而已', game: '/', cat: '\\', fileName: '//' },
    { label: '空字节', game: 'a\u0000b', cat: '本体', fileName: 'x.zip' },
    { label: '通配/非法字符', game: 'a*b?c"d<e>f|g', cat: '本体', fileName: 'x.zip' },
    { label: '保留设备名', game: 'nul', cat: 'com1', fileName: 'lpt9.zip' },
    { label: '尾部点空格', game: 'evil... ', cat: '本体', fileName: 'x.zip ' },
    { label: '超长爬出', game: '../'.repeat(60) + 'Windows', cat: '本体', fileName: 'x.zip' },
    { label: '只由点与下划线组成', game: '._.', cat: '本体', fileName: '_.zip' },
  ];
  let escaped = 0, notInside = 0, rejected = 0;
  const report = [];
  for (const s of EVIL) {
    const r = EX.taskDir(ROOT, { game: s.game, cat: s.cat, fileName: s.fileName });
    if (!r.ok) { rejected++; report.push(s.label + ' → 被 taskDir 拒绝'); continue; }
    const inside = r.dir.startsWith(ROOT + path.sep);
    const flat = !/[\\/]/.test(r.name);            /* 名字里不许再有分隔符 */
    if (!inside) notInside++;
    if (r.name.indexOf('..') >= 0) escaped++;
    report.push(s.label + ' → ' + r.name);
  }
  /* ★★ E1 的判据必须**同时**要求 `rejected === 0`。
   *   首版只判 `notInside === 0`，于是「清洗层被放宽 ⇒ taskDir 兜底拒绝」这条路
   *   被算成了**通过**（反证 ② 实测照出的假绿）——
   *   而这条断言的意图恰恰是「清洗层自己扛得住，不靠下游兜底」。
   *   上面 14 个样本没有任何一个**应该**被拒绝：它们的正解都是「清洗成一个合法名字」。 */
  chk('E1 ★★ ' + EVIL.length + ' 个恶意样本：清洗后**全部被接受**且都在根内（靠 taskDir 兜底拒绝不算过）',
    notInside === 0 && rejected === 0,
    '越界 ' + notInside + ' · 被拒 ' + rejected + (rejected ? ' · ' + report.filter((x) => /拒绝/.test(x)).join(' | ') : ''));
  chk('E2 ★ 清洗后的段里不许残留 `..`（残留就是可上跳的路径段）', escaped === 0);
  chk('E3 ★ 名字里不许出现任何路径分隔符（`\\` 与 `/` 都必须被换成 `_`）',
    EVIL.every((s) => {
      const r = EX.taskDir(ROOT, { game: s.game, cat: s.cat, fileName: s.fileName });
      return !r.ok || !/[\\/]/.test(r.name);
    }));

  /* ══════════════ 3 taskDir：算得对、且**不建目录** ══════════════ */
  hr('3 taskDir — 二次边界校验 + 不产生副作用');
  {
    const r = EX.taskDir(ROOT, { game: 'G', cat: '本体', fileName: 'a.zip' });
    chk('T1 ★ 父目录**就是**落点根（不深一层也不浅一层）',
      r.ok === true && path.dirname(r.dir) === ROOT, r.dir);
    chk('T2 返回值一定在根之内', r.dir.startsWith(ROOT + path.sep));
    chk('T3 ★★ 纯函数：算名字**不会**建出目录来（建目录的时机是落盘前一行）',
      !fs.existsSync(r.dir), r.dir);
    chk('T4 ★ 相对根也能 resolve 成绝对路径（否则 startsWith 会假过）',
      (() => {
        const q = EX.taskDir('GameHub', { game: 'G', cat: '本体', fileName: 'a.zip' });
        return q.ok && path.isAbsolute(q.dir) && path.dirname(q.dir) === path.resolve('GameHub');
      })());
  }
  {
    const src = fs.readFileSync(EXJ, 'utf8');
    chk('T5 ★ 边界判据**必须带分隔符**（`root + path.sep`，否则 `…\\GameHub-evil` 会被前缀骗过）',
      /if\s*\(!full\.startsWith\(root \+ path\.sep\)\)/.test(src));
    chk('T6 ★★ 负向守卫：`downloadTo` 里 `mkdirSync` 必须在**落盘前**（不许一进门就建）',
      (() => {
        const i0 = src.indexOf('async function downloadTo');
        const iMk = src.indexOf('fs.mkdirSync(destDir', i0);
        const iBuf = src.indexOf('const buf = Buffer.concat(chunks);', i0);
        return i0 > 0 && iMk > 0 && iBuf > 0 && iMk > iBuf;
      })(),
      '根因：v10.73 首轮实测照出「网页地址也留下空目录」—— 就是开门先 mkdir 造成的');
  }

  /* ══════════════ 4 接缝层：服务端历史留档 ══════════════ */
  hr('4 服务端 — 历史留档 / 落点 / 语义');
  const sv = fs.readFileSync(SRV, 'utf8');

  chk('V1 历史上限有常量（长跑必须熔断，PITFALLS 43）', /const EX_HISTORY_MAX\s*=\s*\d+/.test(sv));
  chk('V2 ★ 历史文件落在**产物目录**里（用户在自己的下载目录就能翻到）',
    /function exHistoryFile\s*\(\)\s*\{\s*return path\.join\(extractor\.DEFAULT_DEST,\s*'_下载历史\.json'\)/.test(sv));
  chk('V3 ★★ `exHistoryPush` 在 `exRun` 的 **finally** 里 —— 保证没有一条出口能绕过它',
    /finally\s*\{[\s\S]{0,600}?exHistoryPush\(t\)/.test(sv));
  chk('V4 ★ 按 id **覆盖**而不是追加（填密码续跑会让同一次出现在历史里两条）',
    /const i = arr\.findIndex\(\(x\) => x && x\.id === t\.id\)/.test(sv) &&
    /if \(i >= 0\) arr\[i\] = rec; else arr\.push\(rec\)/.test(sv));
  chk('V5 ★ 写历史失败**不许**影响已完成的解压（try 裹住且不抛）',
    /function exHistoryPush\(t\)\s*\{[\s\S]{0,1400}?catch \(e\) \{ \/\* 写不了历史不许影响/.test(sv));
  chk('V6 历史上限生效（超出截掉最旧的）',
    /if \(arr\.length > EX_HISTORY_MAX\) arr\.splice\(0, arr\.length - EX_HISTORY_MAX\)/.test(sv));

  chk('V7 ★ 有 GET /api/extract/history', /app\.get\('\/api\/extract\/history'/.test(sv));
  chk('V8 ★ 历史**倒序**返回（给人「找刚才那次」用，不是给机器读）',
    /items:\s*all\.slice\(-n\)\.reverse\(\)/.test(sv));
  chk('V9 历史接口带 file / total / max（前端能显示「存在哪、共几条」）',
    /file:\s*exHistoryFile\(\)/.test(sv) && /total:\s*all\.length/.test(sv) && /max:\s*EX_HISTORY_MAX/.test(sv));

  /* ★★ V10 的判据必须**精确到 null 那一支**：`dir: t.dir || t.params.dir || ''`
   *   在 `exHistoryPush` 里也有一份（历史记录用空串兜底）。首版写成裸的
   *   `/dir:\s*t\.dir \|\| t\.params\.dir/` ⇒ 删掉 exSnapshot 那行之后仍能匹配到历史那行，
   *   断言**假绿**（v10.73 反证 ⑨ 实测照出）。 */
  chk('V10 ★★ exSnapshot 如实带出 dir / archive / game / cat',
    /^\s*dir:\s*t\.dir \|\| t\.params\.dir \|\| null,/m.test(sv) &&
    /^\s*archive:\s*t\.archive === null \? null : !!t\.archive,/m.test(sv) &&
    /^\s*game:\s*t\.params\.game/m.test(sv) && /^\s*cat:\s*t\.params\.cat/m.test(sv));
  chk('V11 ★ `/api/extract/run` 那条入口也填 `t.dir`（否则历史里这条的路径是空的）',
    /t\.dir = d\.dir;/.test(sv));
  chk('V12 ★ 下载入口用**服务端自己**推的原链名 + taskDir 算子目录',
    /extractor\.fileNameFromUrl\(url,\s*b\.name\)/.test(sv) && /extractor\.taskDir\(root\.dir,/.test(sv));
  chk('V13 ★ taskDir 失败要**拒绝**这次请求，不能带着空目录名往下跑',
    /const sub = extractor\.taskDir[\s\S]{0,200}?if \(!sub\.ok\) return res\.status\(400\)/.test(sv));
  /* ★ V14 是**负向**守卫，判据必须精确到「代码形态」而不能是裸子串：
   *   `expectArchive` 这个词**必须**留在注释里（说明它为什么被删）。
   *   裸子串 `!/expectArchive/` 会被那句注释判红 —— 本条首轮就是这么假红的。
   *   所以只拦两种「真的加回来了」的写法：传参 `expectArchive:` 与读取 `opts.expectArchive`。 */
  chk('V14 ★★ 负向守卫：`expectArchive` 不许被加回代码（注释里留着说明是对的）',
    !/expectArchive\s*:/.test(sv) && !/opts\.expectArchive/.test(sv) && !/b\.expectArchive/.test(sv),
    '加回来会静默恢复「不是压缩包就丢弃」');
  chk('V15 历史记录里带 state / layers / files / bytes（不只是路径）',
    /state:\s*t\.state/.test(sv) && /layers:\s*t\.report/.test(sv) && /files:\s*t\.report/.test(sv));

  /* ══════════════ 5 接缝层：页面 ══════════════ */
  hr('5 页面 — 五页同步 + 解压助手的历史区');
  const PAGES = ['index.html', 'extract.html', 'unpack.html', 'resources.html', 'emulator.html'];
  const src = {};
  for (const f of PAGES) {
    try { src[f] = fs.readFileSync(path.join(PUB, f), 'utf8'); } catch (e) { src[f] = ''; }
  }
  const readAll = (fn) => PAGES.every((f) => src[f] && fn(src[f]));
  const ex = src['extract.html'];
  const idx = src['index.html'];

  chk('P1 ★ 五页都还有 exdAttr（本版把它挂到已有 <a> 上）',
    readAll((s) => /function exdAttr\s*\(/.test(s)));
  chk('P2 ★ 五页都有 .exd-path（浮层里常驻显示产物路径）',
    readAll((s) => /^\s*\.exd-path\{/m.test(s)));
  chk('P3 ★★ 五页都**拆干净**了旧按钮（`exdBtn` / `.exd-go` 一个不剩）',
    readAll((s) => !/function exdBtn\s*\(/.test(s) && !/\.exd-go\b/.test(s)));
  chk('P4 ★ 五页都带 game / cat 两个值上服务端（否则文件夹名拼不出来）',
    readAll((s) => /data-ex-game/.test(s) && /data-ex-cat/.test(s) &&
      /getAttribute\('data-ex-game'\)/.test(s)));
  chk('P5 ★ saved 与 not-archive 是**两种**文案（不能都落到 error）',
    readAll((s) => /'saved'/.test(s) && /not-archive/.test(s)));
  chk('P6 五页都有「复制路径」这条路（打开文件夹失败时的唯一出路）',
    readAll((s) => /navigator\.clipboard/.test(s)));

  chk('P7 ★ 解压助手页有 exGame / exCat 输入框（手动丢包时也要能建文件夹）',
    /id="exGame"/.test(ex) && /id="exCat"/.test(ex) && /id="exCatList"/.test(ex));
  chk('P8 ★ 类别给了 datalist 预设（本体/Mod/存档/修改器），不用手打',
    /<datalist id="exCatList">[\s\S]{0,400}?本体[\s\S]{0,400}?修改器/.test(ex));
  chk('P9 ★ 解压助手页有历史容器 #exHist', /id="exHist"/.test(ex));
  chk('P10 ★ 初始化时调 loadHistory()（不是等用户点一下才加载）',
    /loadHistory\(\)/.test(ex) && /\/api\/extract\/history/.test(ex));
  chk('P11 ★ 历史里每条都有「复制路径」与「打开文件夹」两个动作',
    /data-hcopy/.test(ex) && /data-hopen/.test(ex));
  chk('P12 ★ 状态中文名映射表里含 saved（否则历史里显示生英文）',
    /const ST_TX = \{[\s\S]{0,200}?saved:/.test(ex));
  chk('P13 ★ 主源里没有 id="exDock" 标签（浮层必须由 JS 现创建）',
    !/<div[^>]*id="exDock"/.test(idx));
  chk('P14 ★ exdAttr 仍在「仅本机」闸内（线上点了会解在云端容器里）',
    /function exdAttr\s*\(url, game, cat\)\s*\{[\s\S]{0,200}?if \(!url \|\| !exdLocal\(\)\) return ''/.test(idx));

  hr('验收汇总');
  console.log('  通过 ' + pass + ' / ' + (pass + fail) + '（失败 ' + fail + '）');
  process.exit(fail ? 1 : 0);
})();
