#!/usr/bin/env node
/* tools/test-v1070-sort-keys.js —— v10.70 防线（第一层：纯静态 + 真实库行为）
 *
 * 背景：用户要求排行榜「学 xdgame.com/update/ 的排序」，于是排序从 **3 维**扩到 **6 维**
 *   （updated / hot / score / size / sizeAsc / title）。扩维度这件事本身不难，
 *   真正会出事的是**口径分裂**，本轮修掉了两处：
 *
 *   ① ★★ `server.js` 历史上另写了一份本地 `keyOf` —— `scope=pc` 走 `gamesDb.browse()`，
 *      而 `scope=mob|all` 走**内存排序**（`mobPool.sort` + `mergePick`），那里是 `keyOf`。
 *      两份口径一旦漂移，同一个 `sort` 在两个 scope 下排出不同顺序，
 *      而且**不报错、测试也照绿**（没有一条断言在比两个 scope 的顺序）。
 *      ⇒ 正解：比较函数**从 gamesDb 出去**（`cmp(sort)`），三处共用。
 *
 *   ② ★★ 白名单也写死了两处（`server.js` 的 `['score','size'].includes(...)`）。
 *      加维度只改前端 ⇒ 「前端发了 hot、服务端静默回落 updated」，用户看到的是
 *      按钮高亮变了、列表没动。⇒ 正解：`gamesDb.SORT_KEYS.includes(...)`，单一来源。
 *
 *   ⚠️ 为什么 `cmp` 返回的是**比较函数**而不是取值函数（`keyOf`）：
 *      `sizeAsc` / `title` 需要「小于」方向，降序取值函数表达不了。
 *      同理 `mergePick` 的 `keyOf(A) >= keyOf(B)` 只能表达降序 ⇒ 改成 `cmp(A,B) <= 0`。
 *
 *   ③ ★★ `sizeAsc` 第一屏曾经是「数据缺失榜」：源站缺失值写成 `"0.0GB"` / `"0KB"`，
 *      解析出来是**数值 0**，只判 `null` 会让它们当成「最小容量」冲到最前（实测前 8 名全是 0）。
 *      这条修的是**用户能直接看到的错**，所以既要做单元断言，也要扫真实库。
 *
 * 分组：
 *   A 阳性对照（真实库真的加载了）      D `sizeAsc` 的无效值语义（单元 + 扫库）
 *   B `cmp` 的比较函数契约              E 前后端两份清单必须一致
 *   C 逐维度单调性（真实库全量扫描）    F server.js 侧：口径只有一份
 *
 * 反证锚点（打坏必变红）：
 *   · `sizeAsc` 分支的 `zA != null && zA > 0` 改回 `true`        ⇒ D 红（0 值冲到最前）
 *   · `cmp` 改成 `return (x) => …`（取值函数）                   ⇒ B 红
 *   · `browse()` 的 `.sort(cmp(sort))` 改回内联 `keyOf` 降序     ⇒ C 红（升序维度不单调）
 *   · `server.js` 白名单改回写死 `['score','size']`              ⇒ F 红
 *   · 前端 SORTS 少写一维                                        ⇒ E 红
 *
 * 跑法：node tools/test-v1070-sort-keys.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const IDX = read('public/index.html');
const SERVER = read('server.js');
const db = require(path.join(ROOT, 'data', 'gamesDb.js'));

let pass = 0, fail = 0;
const t = (ok, name, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`); };
const sec = (s) => console.log('\n── ' + s + ' ──');

/** 剥掉注释，只留「用户可见 / 可执行」的部分（同 v10.57 / v10.58 套件的实现）。
 *  ⚠️ 行注释要排除 URL：`https://` 里的 `//` 前一个字符是 `:` ⇒ 用 `(^|[^:])` 前置断言。
 *  ⚠️ 写法必须与既有套件逐字一致 —— 我第一版写成 `[^\n]*?\/\/[^\n]*`，
 *     那个会把 `const x = 1; // 注释` 的**整行**吃掉 ⇒ 「代码里有没有这行」的断言全部假红。 */
function stripComments(s) {
  return String(s)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/* ============================ A 阳性对照 ============================ */
sec('A 阳性对照（没有它，下面所有「扫真实库」的断言在库为空时会全绿）');

const n = db.load();
t(n > 0, 'A1 gamesDb.load() 真的读到了条目', 'n=' + n);
const GAMES = db.all();
t(GAMES.length > 0, 'A2 db.all() 非空（排序断言的样本来源）', 'n=' + GAMES.length);
/* 阳性对照之二：库里**确实同时存在**有效与无效容量。
   否则 D 组「无效排最后」可能因为样本里没有无效值而假绿。 */
const invalidN = GAMES.filter((g) => { const z = db.sizeGb(g.size); return z == null || z === 0; }).length;
const validN = GAMES.filter((g) => { const z = db.sizeGb(g.size); return z != null && z > 0; }).length;
t(invalidN > 0 && validN > 0, 'A3 ★★ 库里同时有「无效容量」与「有效容量」两种条目',
  '无效 ' + invalidN + ' / 有效 ' + validN);

/* ============================ B cmp 的比较函数契约 ============================ */
sec('B `cmp(sort)` 必须是**比较函数**（不是取值函数）');

t(typeof db.cmp === 'function', 'B1 gamesDb.cmp 已导出');
t(Array.isArray(db.SORT_KEYS), 'B2 gamesDb.SORT_KEYS 已导出');
t(db.SORT_KEYS.length === 6, 'B3 SORT_KEYS 恰好 6 维', JSON.stringify(db.SORT_KEYS));
t(['updated', 'hot', 'score', 'size', 'sizeAsc', 'title'].every((k) => db.SORT_KEYS.includes(k)),
  'B4 ★★ SORT_KEYS 六维齐全', JSON.stringify(db.SORT_KEYS));

const cAsc = db.cmp('sizeAsc');
t(typeof cAsc === 'function', 'B5 cmp() 的返回值本身是函数（比较函数，不是取值函数）');
/* ★★ 方向断言：比较函数必须能表达**升序**。
   取值函数（`keyOf`）时代这里是 `keyOf(a) - keyOf(b)` 用不上 ——
   所以只要 `cmp('sizeAsc')(小, 大) < 0` 成立，就证明「小于」方向真的可用。 */
const A = { title: 'a', size: '1GB', updatedTs: 1, hot: 1, score: 1 };
const B = { title: 'b', size: '10GB', updatedTs: 1, hot: 2, score: 2 };
t(cAsc(A, B) < 0 && cAsc(B, A) > 0, 'B6 ★★ cmp 能表达升序（小在前时返回负）',
  'cAsc(小,大)=' + cAsc(A, B) + '  cAsc(大,小)=' + cAsc(B, A));
/* 未知 sort 必须**回落**而不是抛错（前端一旦多发一个参数，不能 500）。 */
let fellBack = false;
try { db.cmp('__nope__')(A, B); fellBack = true; } catch (e) { fellBack = false; }
t(fellBack, 'B7 未知 sort 值不抛错（静默回落 updated）');

/* ============================ C 逐维度单调性（真实库全量扫描） ============================ */
sec('C 逐维度：真实库单调性（降序维度取前 300 条；升序维度走**全量**扫描）');

const SAMPLE = 300;
const pick = (sort) => db.browse(null, SAMPLE, 0, sort).items;

const cHot = pick('hot');
t(cHot.length === SAMPLE, 'C0 取样成功（sort=hot 拿到 ' + SAMPLE + ' 条）', 'n=' + cHot.length);

const hOf = (g) => (typeof g.hot === 'number' && g.hot > 0 ? g.hot : 0);
t(cHot.every((g, i) => i === 0 || hOf(cHot[i - 1]) >= hOf(g)), 'C1 sort=hot 热度**单调不增**',
  '前3: ' + cHot.slice(0, 3).map(hOf).join(' / '));

const sOf = (g) => ((g.score || 0) <= 10 ? (g.score || 0) : 0);
const cScore = pick('score');
t(cScore.every((g, i) => i === 0 || sOf(cScore[i - 1]) >= sOf(g)), 'C2 sort=score 评分**单调不增**',
  '前3: ' + cScore.slice(0, 3).map(sOf).join(' / '));

const zOf = (g) => db.sizeGb(g.size) || 0;
const cSize = pick('size');
t(cSize.every((g, i) => i === 0 || zOf(cSize[i - 1]) >= zOf(g)), 'C3 sort=size 容量**单调不增**',
  '前3: ' + cSize.slice(0, 3).map((g) => g.size).join(' / '));

/* ★★ C4/C5/C6 走**全量**扫描（不只是 browse 的前 300 条）。
   为什么必须全量：有效容量有 19,051 条、前 300 条全是有效的 ⇒
   只扫 300 条时「无效的排最后」这条断言**根本没有样本**，是空转（vacuous truth），
   报绿也不代表机制在。全量扫描才会真正走到「有效段 / 无效段」的交界处。
   （实测：无效 480 条全落在全量排序的尾部，交界处零乱序。） */
const ascAll = GAMES.slice().sort(db.cmp('sizeAsc'));
t(ascAll.length === GAMES.length, 'C4a 全量排序不丢条目', ascAll.length + ' / ' + GAMES.length);

let ascMono = true, ascCrossed = false, firstInvalidAt = -1, validAfterInvalid = 0;
let prevZ = null, seenInvalid = false;
ascAll.forEach((g, i) => {
  const z = db.sizeGb(g.size);
  const ok = z != null && z > 0;
  if (!ok) { seenInvalid = true; if (firstInvalidAt < 0) firstInvalidAt = i; return; }
  if (seenInvalid) { ascCrossed = true; validAfterInvalid++; }   /* 无效之后又冒出有效 ⇒ 排错了 */
  if (prevZ != null && z < prevZ) ascMono = false;               /* 升序被破坏 */
  prevZ = z;
});
t(ascMono, 'C4b sort=sizeAsc 有效容量**单调不减**（升序真的生效，全 ' + validN + ' 条有效值）',
  '最小 ' + ascAll[0].size + ' → 最大 ' + ascAll[firstInvalidAt > 0 ? firstInvalidAt - 1 : ascAll.length - 1].size);
t(!ascCrossed, 'C5 ★★ sort=sizeAsc 无效容量**全部排在有效之后**（不许中间又冒出有效值）',
  '无效段起点 index=' + firstInvalidAt + '（共 ' + invalidN + ' 条无效），越界 ' + validAfterInvalid + ' 处');
t(firstInvalidAt !== 0, 'C6 ★★ sort=sizeAsc 第 1 名是**有效容量**（不是数据缺失榜）',
  '第1名 ' + ascAll[0].size + ' = ' + (db.sizeGb(ascAll[0].size)).toFixed(3) + ' GB');
t(db.sizeGb(ascAll[0].size) > 0, 'C6b ★★ 第 1 名容量数值 > 0（改前这里是 "0.0GB" ⇒ 0）',
  '实测 ' + db.sizeGb(ascAll[0].size).toFixed(3) + ' GB');

const cTitle = pick('title');
const titleMono = cTitle.every((g, i) => i === 0 ||
  String(cTitle[i - 1].title || '').localeCompare(String(g.title || ''), 'zh') <= 0);
t(titleMono, 'C7 sort=title 名称按 zh 排序**单调不减**',
  '前3: ' + cTitle.slice(0, 3).map((g) => String(g.title || '').slice(0, 10)).join(' / '));

/* ★ 默认口径：不传 sort 必须等于显式传 updated（前端漏传参数时不能悄悄换一种顺序）。 */
const dflt = db.browse(null, 30, 0).items.map((g) => g.id).join(',');
const expl = db.browse(null, 30, 0, 'updated').items.map((g) => g.id).join(',');
t(dflt === expl, 'C8 ★★ 不传 sort 与传 updated 结果**逐条一致**（默认口径唯一）');
/* 反证用：默认视图的前 30 条不能和 hot 视图相同（否则说明 sort 被忽略了）。 */
const hotTop = pick('hot').slice(0, 30).map((g) => g.id).join(',');
t(dflt !== hotTop, 'C9 ★★ 不同 sort 排出的顺序**确实不同**（sort 参数真的被用上了）');

/* ============================ D sizeAsc 的无效值语义（单元级） ============================ */
sec('D ★★ `sizeAsc`：无效容量必须排最后（本版修掉的真 bug）');

const mk = (o) => Object.assign({ title: 'x', updatedTs: 100, hot: 0, score: 0 }, o);
/* 情形 ① 源站声明的 "0.0GB" / "0KB" —— 解析出来是数值 0 */
t(cAsc(mk({ size: '1MB' }), mk({ size: '0.0GB' })) < 0,
  'D1 ★★ "0.0GB"（解析为 0）排在 "1MB" **之后**', '返回 ' + cAsc(mk({ size: '1MB' }), mk({ size: '0.0GB' })));
t(cAsc(mk({ size: '1MB' }), mk({ size: '0KB' })) < 0,
  'D2 ★★ "0KB"（解析为 0）排在 "1MB" **之后**', '返回 ' + cAsc(mk({ size: '1MB' }), mk({ size: '0KB' })));
/* 情形 ② size 为空串 / 解析不出 ⇒ sizeGb 返回 null */
t(cAsc(mk({ size: '1MB' }), mk({ size: '' })) < 0,
  'D3 ★★ 空 size（sizeGb 返回 null）排在有效容量**之后**', '返回 ' + cAsc(mk({ size: '1MB' }), mk({ size: '' })));
t(cAsc(mk({ size: '1MB' }), mk({ size: undefined })) < 0,
  'D4 ★★ undefined size 排在有效容量**之后**', '返回 ' + cAsc(mk({ size: '1MB' }), mk({ size: undefined })));
/* 两个都无效时不许返回 NaN（会破坏排序的稳定性） */
const nn = cAsc(mk({ size: '' }), mk({ size: '0KB' }));
t(Number.isFinite(nn), 'D5 两条都无效时不返回 NaN（否则排序结果不稳定）', '返回 ' + nn);
/* 有效之间仍按升序 */
t(cAsc(mk({ size: '500MB' }), mk({ size: '2GB' })) < 0, 'D6 有效容量之间仍按升序');
/* ★ 判据用一个明确的样本证明「0 不会被当成最小」：这正是改前的错法（直接 null-0 或只判 null）。 */
t(cAsc(mk({ size: '0.0GB' }), mk({ size: '2GB' })) > 0,
  'D7 ★★ "0.0GB" 不会因「数值最小」而排到 "2GB" 前面');

/* ============================ E 前后端两份清单必须一致 ============================ */
sec('E ★★ 前端 UI 的 6 维 ↔ 服务端 SORT_KEYS 必须同一份');

const frontKeys = (() => {
  const blk = (IDX.split('const SORTS = [')[1] || '').split('];')[0];
  return [...blk.matchAll(/k:\s*'([^']+)'/g)].map((m) => m[1]);
})();
t(frontKeys.length > 0, 'E1 取样成功：解析出前端 SORTS 的键（否则下面的比对不成立）', JSON.stringify(frontKeys));
t(frontKeys.length === db.SORT_KEYS.length &&
  frontKeys.every((k, i) => k === db.SORT_KEYS[i]),
  'E2 ★★ 前端 SORTS 的键与 gamesDb.SORT_KEYS **逐个相同且同序**',
  '前端 ' + JSON.stringify(frontKeys) + ' vs 后端 ' + JSON.stringify(db.SORT_KEYS));
/* ★ 6 维必须有 6 个不同的中文名（复制粘贴时最容易忘改 nm） */
const frontNames = [...((IDX.split('const SORTS = [')[1] || '').split('];')[0]).matchAll(/nm:\s*'([^']+)'/g)].map((m) => m[1]);
t(new Set(frontNames).size === frontNames.length, 'E3 6 个排序名互不重复（改键时忘改中文名会被抓到）',
  JSON.stringify(frontNames));

/* ============================ F server.js 侧：口径只有一份 ============================ */
sec('F ★★ server.js：排序口径只此一份（不许第二份 keyOf / 第二份白名单）');

const sv = stripComments(SERVER);
t(/gamesDb\.SORT_KEYS\.includes/.test(sv), 'F1 白名单走 gamesDb.SORT_KEYS（不写死第二份清单）');
t(!/\['score'\s*,\s*'size'\]/.test(sv), 'F2 旧的写死白名单 [\'score\',\'size\'] 已移除');
/* ★★ 「同一处已欠账 4 次」的教训：不钉**调用形状**（`cmp(sort)` / `(a,b)=>cmp(...)`），
   只判「引用了哪个标识符」。调用形状每轮重排一次就得改断言，而引用关系才是真承诺。 */
const cmpRefs = (sv.match(/\bcmp\b/g) || []).length;
t(cmpRefs >= 3, 'F3 server.js 里 `cmp` 被引用 ≥ 3 处（browse 路径 + mobPool.sort + mergePick）',
  '实测 ' + cmpRefs + ' 处');
t(!/\bkeyOf\b/.test(sv), 'F4 ★★ server.js 里**没有**本地 keyOf（口径唯一）');
t(/function mergePick\([^)]*\bcmp\b/.test(sv), 'F5 mergePick 收比较函数（升序维度才可能正确）');
t(/cmp\(A\[i\],\s*B\[j\]\)\s*<=\s*0/.test(sv),
  'F6 ★★ mergePick 用 `<= 0` 判定（不是旧的 `keyOf(A) >= keyOf(B)` 降序写法）');

/* ============================ G 元断言：反证靶子在位 ============================ */
sec('G 元断言：反证脚本要打坏的靶子确实存在（否则反证会「什么都没打坏」地通过）');

const dbSrc = read('data/gamesDb.js');
t(/zA\s*!=\s*null\s*&&\s*zA\s*>\s*0/.test(dbSrc), 'G1 靶子①：sizeAsc 的 `zA != null && zA > 0` 判据在位');
t(/const SORTS = \[/.test(IDX), 'G2 靶子②：前端 SORTS 数组在位');
t(/gamesDb\.SORT_KEYS\.includes/.test(sv), 'G3 靶子③：server.js 的 SORT_KEYS 白名单在位');

console.log('\n── v10.70 排序口径（6 维 · 单一来源）：' + pass + ' / ' + (pass + fail) + ' 通过 ──');
process.exit(fail ? 1 : 0);
