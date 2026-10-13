#!/usr/bin/env node
/**
 * tools/test-v1062.js —— v10.62 防线：**一款一行** + 联想面板带回资源
 *
 * 【本版修的是两条用户诉求】（用户 2026-10-12 17:2x，紧接 v10.61 交付之后）
 *   ① 「每个游戏仅需要提供一个即可」
 *      —— v10.61 已把同款并成一行，但那一行下面还挂着
 *         「↳ 另 1 个条目 [XDGAME 原版 ★9.1 ↗]」；用户要的是**一款只出一条**。
 *   ② 「我要的 mod/修改器/存档也没提供给我」
 *      —— 联想面板（`/api/library`）此前只走 `withBh`，**一个资源计数都不挂**，
 *         而同一个 `smRow()` 在搜索结果面板里是有 chip 的 ⇒ 同一行 UI，两个入口两个样。
 *
 * 【顺手修掉的一个真 bug：原地污染】
 *   `withBh(g)` 在 BH/PC 两库都没命中时会 `return g`（**原引用**），原 `withRes` 直接
 *   `o.res = …` ⇒ 原地写 gamesDb 内存里的记录。后果：同一进程里 `/api/library` 带不带
 *   `res` **取决于此前有没有人请求过 `/api/search/all`**（顺序依赖），且污染不可逆、
 *   会漏进 browse / recent / 首页卡片。⇒ `withRes` 改为落在副本上。
 *
 * 【本套件的写法原则】与 `test-v1061.js` 一致：**不依赖会变的数据**
 *   —— 全部断言都是「对源码/派生页的结构断言」，不查 `games.json`、不写死任何条数。
 *   （页面上真正的行为由 `tools/_probe-v1062-live.js` 与 `tools/test-v1025-search.js` 实拍守。）
 */

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const has = (p) => fs.existsSync(path.join(ROOT, p));

let pass = 0, fail = 0;
const t = (ok, name, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`); };
const sec = (s) => console.log('\n── ' + s + ' ──');

const SRVC = read('server.js');
const MAIN = read('public/index.html');

/* ==================== A 服务端：联想面板改走 withRes ==================== */
sec('A `/api/library` 挂资源（用户诉求②的落点）');

/* ⚠️ 必须**只看 `/api/library` 这一段**：`/api/search/all` 的端游桶里也有一模一样的
 *   `items: withNKeys(r.items.map(withRes))` 串（v10.52 就在那儿了）——
 *   拿全文件正则去判，打坏 `/api/library` 后仍会因为另一处而**假绿**（反证 A 实测栽过）。 */
const LIB_SECT = (SRVC.split("app.get('/api/library', ")[1] || '').split('app.get(')[0];

t(/items: withNKeys\(r\.items\.map\(withRes\)\)/.test(LIB_SECT),
  '★ A1 联想接口挂的是 `withRes`（不再是 `withBh`）—— 这一条就是「联想里没有 MOD/修改器/存档」的开关');
t(!/r\.items\.map\(withBh\)/.test(SRVC),
  'A1 **没有残留**的 `r.items.map(withBh)`（留着就等于有两个接口各挂一套，必然漂移）');
t(/get\('\/api\/library', \(req, res\)/.test(SRVC) && /v10\.62：联想面板改走 `withRes`/.test(SRVC),
  'A1 改动点写在 `/api/library` 路由里，且注释留下了「为什么改」');

/* ---- A2 withRes 的副本保护（修原地污染） ---- */
t(/const b = withBh\(g\);\s*\n\s*const o = \(b === g\) \? Object\.assign\(\{\}, g\) : b;/.test(SRVC),
  '★★ A2 `withRes` 挂字段前先确认落在**副本**上（`b === g` 时拷一份）—— 修「原地污染 gamesDb」');
t(/两个 `attach` 都有 `if \(!h\) return g;`/.test(SRVC),
  'A2 注释里记下了**成因**（两个 attach 的 `if (!h) return g` 会直传原引用）');

/* ---- A3 污染是「顺序依赖」的，注释必须留证据链 ---- */
t(/取决于此前有没有\s*\n?\s*\*?\s*人请求过 `\/api\/search\/all`/.test(SRVC),
  'A3 注释记下「顺序依赖」这个现象（否则下轮复现不出来又会怀疑自己改错了）');

/* ==================== B 前端：一款一行 ==================== */
sec('B 前端不再渲染「另 N 个条目」（用户诉求①）');

t(/function smRows\(list, limit\)[\s\S]{0,400}?smGroup\(arr\)\.map\(\(g\) => smRow\(g\.main\)\)/.test(MAIN),
  '★ B1 `smRows` 只渲染主行（`smRow(g.main)`，后面不再拼 `smAltHtml(g)`）');
t(!/[^`\w]smAltHtml\s*\(/.test(MAIN),
  '★ B1 `smAltHtml` **已无任何调用**（连函数定义一起删了，不留死代码）');
t(!/function smVariant\s*\(/.test(MAIN),
  'B1 `smVariant()` 一并删除（它唯一的调用方就是 `smAltHtml`）');
t(!/\$\$\(['"]#smBody \.sm-alt-b['"]\)/.test(MAIN),
  'B1 `.sm-alt-b` 的点击绑定已删（渲染都没了，再绑就是绑到空气上）');

/* ---- B2 CSS 也删干净（选择器，不是注释里的字样） ---- */
t(!/\n\s*\.sm-alt\{/.test(MAIN) && !/\n\s*\.sm-alt-b\{/.test(MAIN) && !/\n\s*\.sm-alt-h\{/.test(MAIN),
  '★ B2 三族 `.sm-alt*` 样式规则已从 CSS 删除（`padding-left:87px` 的响应式也一并删）');
/* ⚠️ 必须**锚行首**：注释里为了说清删了什么，原样引用了 `.sm-alt{padding-left:87px}` 这串字，
 *   不加锚点的正则会匹配到注释、把这条断言变成永远红（首跑实测就踩了）。 */
t(!/^[ \t]*\.sm-alt\{padding-left:87px\}/m.test(MAIN),
  'B2 响应式那条 `.sm-alt{padding-left:87px}` 也没了（锚行首，避免被注释里的引用骗到）');
t(/v10\.62 改了收尾形态/.test(MAIN),
  'B2 原地留了注释说明「它们存在过、为什么没了」（不是当它们从没出现过）');

/* ---- B3 归并本身一个字没动 ---- */
t(/function smKeyOf\(it\)/.test(MAIN) && /it\.nkey/.test(MAIN),
  '★ B3 `smKeyOf` 仍消费服务端下发的 `nkey`（归并键没被动过，**只改「组内其余条目要不要露脸」**）');
t(/const k = smKeyOf\(it\);/.test(MAIN),
  'B3 `smGroup` 仍按 `nkey` 归并（同一款还是只产生一个组）');

/* ==================== C 前端：组内资源互借 ==================== */
sec('C 主行没有资源计数时向同组借（诉求②的第二道保险）');

t(/const donor = g\.rest\.find\(\(x\) => x && x\.res\);/.test(MAIN),
  '★ C1 `smGroup` 里有「组内找一条带 `res` 的」这一步');
t(/g\.main = Object\.assign\(\{\}, g\.main, \{ res: donor\.res, resId: donor\.resId \|\| donor\.id \}\);/.test(MAIN),
  '★ C1 借来的计数挂在**副本**上（`Object.assign({}, g.main, …)`），不改原对象');
t(!/g\.main\.url\s*=/.test(MAIN) && !/g\.main\.title\s*=/.test(MAIN),
  '★ C1 **不改主行身份** —— url/title/封面仍是首条那条（借的只是展示用计数）');

/* ==================== D 三张派生页同步（铁律 1） ==================== */
sec('D 派生页已重建（改主源必须重建，否则静默漂移）');

for (const f of ['public/emulator.html', 'public/resources.html', 'public/unpack.html']) {
  const src = read(f);
  t(!/function smAltHtml/.test(src) && !/\n\s*\.sm-alt\{/.test(src),
    `D ${f} 已同步（无 \`smAltHtml\` 函数、无 \`.sm-alt{\` 规则）`);
}

/* ==================== E 既有防线同步（改需求就得改钉住旧口径的断言） ==================== */
sec('E 既有套件同步');

t(has('tools/test-v1025-search.js'), 'E1 `test-v1025-search.js` 仍在');
const V1025 = read('tools/test-v1025-search.js');
t(/v10\.62 修订/.test(V1025),
  'E1 该套件头部已标注 v10.62 口径变更（旧口径「行数 + chip 数 == 条数」已不成立）');
t(!/'B 有 2 组挂了/.test(V1025),
  '★ E1 旧的「有 2 组挂了『另 N 个条目』」断言已撤（它现在**必然**红，且红得没有信息量）');
t(/\.sm-alt'\)\]/.test(V1025) && /a\.altCount === 0/.test(V1025),
  '★ E1 换成**反向**断言：`.sm-alt` 必须为 0（把「不该有」钉住，比「有几个」更硬）');
t(/a\.rowCount === a\.expectRows/.test(V1025),
  '★ E1 款数守恒改成「行数 == 接口回包里不同 `nkey` 的个数」（期望值不写死）');

/* ---- E2 实拍探针存在 ---- */
t(has('tools/_probe-v1062-live.js'), 'E2 实拍探针 `_probe-v1062-live.js` 存在（页面行为不能只靠静态断言）');

/* ==================== F 元断言（防这两条断言自己被写松） ==================== */
sec('F 元断言');

t(/\.sm-alt\{/.test('  .sm-alt{color:red}'),
  '★ F1 元：B2 的正则**确实能**匹配到真 CSS 规则（否则「已删除」永远是绿的）');
t(!/\.sm-alt\{/.test('   *   `.sm-alt` / `.sm-alt-h` / `.sm-alt-b`'),
  '★ F1 元：B2 的正则**不会**被注释里的字样骗到（注释以 `*` 开头，不匹配 `^\\s*\\.sm-alt\\{`）');
t(!/^[ \t]*\.sm-alt\{padding-left:87px\}/m.test('   *   与响应式的 `.sm-alt{padding-left:87px}` 一并移除'),
  '★ F1 元：B2 的响应式断言**不会**被注释里的原样引用骗到（首跑就是栽在这上面）');
t(/items: withNKeys\(r\.items\.map\(withRes\)\)/.test("  items: withNKeys(r.items.map(withRes)) });"),
  'F1 元：A1 的字符串确实能匹配到那种写法');
t(!/r\.items\.map\(withBh\)/.test('  items: withNKeys(r.items.map(withRes)) });'),
  'F1 元：A1 的反向断言在同一样本上**不**假红');

console.log(`\n── v10.62：${pass} 通过 / ${fail} 失败 ──`);
process.exit(fail ? 1 : 0);
