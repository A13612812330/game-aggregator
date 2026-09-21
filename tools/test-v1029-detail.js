/* tools/test-v1029-detail.js — v10.29「预览位置 / 灯箱翻页 / 定位条 / 下载弹窗分区 tab /
 *   修改器+云存档同行」的静态防线（常驻，已登记 run-all.js 的 SUITES）
 *
 * 对应用户本轮五条口径：
 *   ① 游戏预览放到游戏介绍下面；大图加左右切换图标（半透明）
 *   ①-b 右侧悬浮定位条「好像没更新」→ 补「评分参数」并把顺序交给 DOM
 *   ② 下载弹窗「就分开显示，而不是本体下面还有 Mod 或者修改器」→ 三专区改**真 tab**
 *   ③ 修改器和云存档同行、各最多 5 行，超出进「卡片右上角更多按钮」
 *
 * ★ 本套件最想守住的两条（都是「改对了反而更容易再被改回去」的）：
 *   ① 下载弹窗**一次只渲染一个分区** —— 判据不是「有没有签」，而是
 *      「paintDownload 体内不再出现遍历全部分区的写法」（见 ④-3）。签名存在但三块都画，
 *      用户在页面上看到的仍然是「本体下面压着 Mod」。
 *   ② 修改器 / 云存档的**行数上限**必须与卡头摘要同时成立 —— 只钉「常量等于 5」不够，
 *      真正生效的是 `slice(0, MAXTR)` 与 `MAXROWS - pTake` 这两个**用上**该常量的地方。
 *
 * ★ 反向断言（「某死代码不许回来」）一律**逐行匹配 CSS 规则行**，不用 `includes(选择器串)`：
 *   解释「已删除」的注释里就会出现那个串 —— 本轮实测踩到，一条改对了的改动被判成红。
 *
 * ★ 纯本地、无网络、无副作用。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (cond, name, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name + (detail ? '  — ' + detail : '')); }
  else { fail++; console.log('  × FAIL  ' + name + (detail ? '  — ' + detail : '')); }
};
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const IDX = read('public/index.html');

/** 取一个函数的完整源码（到下一个**顶格**的 `}` 行）。项目里函数一律这样收尾。 */
const fnBody = (name) =>
  ((new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}').exec(IDX)) || [''])[0];
/** 取 `const NAME = [...]` 这段声明（用于数 D_RAIL 的项数） */
const arrOf = (name) => ((new RegExp('const ' + name + ' = \\[[\\s\\S]*?\\n\\];').exec(IDX)) || [''])[0];
/** 「以某选择器开头的 CSS 规则行」—— 反向断言专用（不用 includes，见文件头注释） */
const cssRules = (re) => IDX.split(/\r?\n/).filter((l) => re.test(l));

/* ============================================================
 *  ① 版式：游戏预览在「游戏介绍 / 版本介绍」之后
 * ============================================================ */
console.log('=== ① 游戏预览下移到介绍块之后 ===');
{
  const pdA = IDX.indexOf('function paintDetail(');
  const a = IDX.indexOf('body.innerHTML = `', pdA);
  const b = IDX.indexOf('`;', a);
  ok(a > 0 && b > a, '能取到 paintDetail 的模板段', a + '..' + b);
  const TPL = IDX.slice(a, b);

  const marks = [
    ['参数表', '<div class="kv">'],
    ['游戏介绍', '${descHtml}'],
    ['版本介绍', '${versionHtml}'],
    ['游戏预览', '${shotsHtml}'],
    ['配置要求', 'id="reqSlot"'],
  ];
  for (const [nm, m] of marks) ok(TPL.indexOf(m) >= 0, '  模板里能定位到【' + nm + '】');
  /* ⚠️ 位置判据**必须自带「两边都存在」的前置**，不能写成裸 `indexOf(A) < indexOf(B)`：
     indexOf 找不到时返回 -1，而 -1 比任何下标都小 ⇒「A 被删掉了」反而让它变绿。
     本轮反证第一次跑就抓到这个（用例①把 version 标记整行替换掉，这条断言照样 PASS）。
     下面两个 helper 就是为此存在的：`after/before` 一律先判两边都找得到。 */
  const at = (m) => TPL.indexOf(m);
  const after = (x, y) => at(x) >= 0 && at(y) >= 0 && at(x) > at(y);
  const before = (x, y) => at(x) >= 0 && at(y) >= 0 && at(x) < at(y);

  ok(after('${shotsHtml}', '${versionHtml}'),
    '★ 游戏预览在**版本介绍之后**（用户口径「游戏预览放在游戏介绍下」）',
    '介绍=' + at('${versionHtml}') + ' 预览=' + at('${shotsHtml}'));
  ok(after('${shotsHtml}', '${descHtml}'), '★ 也在游戏介绍之后');
  ok(before('${shotsHtml}', 'id="reqSlot"'), '预览仍在配置要求之前（没有掉到最下面去）');
  ok(after('${shotsHtml}', '<div class="kv">'),
    '★ 预览不在参数表之前（v10.28 它被提到封面之后，本轮退回）');
}

/* ============================================================
 *  ② 灯箱左右切换 + 半透明图标
 * ============================================================ */
console.log('\n=== ② 灯箱左右切换（半透明图标）===');
{
  const step = fnBody('galLbStep');
  ok(step.length > 0, '新增 galLbStep()（翻页的唯一出口）');
  ok(/galLbImgs\.length/.test(step), '★ 取模前先 + 长度（JS 里 -1 % 7 === -1，不兜会翻到第 0 张）');
  ok(/galLbPaint\(\)/.test(step), '翻页后调 galLbPaint() 重画（只改下标不重画 = 点了没反应）');

  /* ⚠️ 灯箱的 innerHTML 是**多行字符串拼接**，不能用「取到换行为止」的行内正则 ——
     那只会拿到第一行（✕ 按钮），箭头全判「不在」。取整个 galLbOpen 函数体才稳。 */
  const lb = fnBody('galLbOpen');
  ok(lb.length > 0, '能取到 galLbOpen 的函数体');
  ok((lb.match(/data-lb-step=/g) || []).length === 2, '灯箱里左右两个切换按钮都在 DOM 串里',
    String((lb.match(/data-lb-step=/g) || []).length));
  ok(/data-lb-step="-1"/.test(lb) && /data-lb-step="1"/.test(lb), '两个按钮分别带 -1（上一张）与 1（下一张）');
  ok(/gal-lb-nav prev/.test(lb) && /gal-lb-nav next/.test(lb), '两个按钮的类名分 prev / next');

  ok(/\.gal-lb-nav\{/.test(IDX), '★ 有 .gal-lb-nav 样式规则');
  ok(/\.gal-lb-nav\{[^}]*position:absolute/.test(IDX),
    '★★ 必须是 absolute —— .gal-lb 是 flex column，不做定位会把箭头排成两行、把图挤扁');
  ok(/\.gal-lb-nav\{[^}]*opacity:\.55/.test(IDX),
    '★ 半透明（用户口径「透明度较高的图标」）', 'opacity:.55');
  ok(/\.gal-lb-nav:hover[^{]*\{[^}]*opacity:1/.test(IDX), 'hover / 聚焦时提到不透明（半透明不等于看不清）');
  ok(/\.gal-lb-nav\.prev\{left:/.test(IDX) && /\.gal-lb-nav\.next\{right:/.test(IDX),
    '左右分别贴左边 / 右边');
  ok(/clamp\(38px,5vw,54px\)/.test(IDX) || /width:clamp\(/.test(IDX),
    '尺寸用 clamp 自适应（手机与桌面不必各写一套断点）');

  ok(/closest\('\[data-lb-step\]'\)/.test(IDX), '★ 点箭头走了事件委托（灯箱是 body 级节点，不委托也不会掉，但这里跟点图共用一处判断）');
  /* ⚠️ 必须从 galLbOpen 之后切一刀再找 keydown —— 全页有**多个** keydown 监听
     （搜索弹窗也监听 ESC），直接 exec 会取到最早的那一个，判据会打在别的函数上。
     这正是「断言跑到别人身上」那类假绿/假红，取源码时必须圈定范围。 */
  const kbA = IDX.indexOf('function galLbOpen(');
  const kd = (/document\.addEventListener\('keydown', \(e\) => \{[\s\S]*?\n\}, true\);/.exec(IDX.slice(kbA)) || [''])[0];
  ok(kd.length > 0, '能取到灯箱的 keydown 处理');
  ok((kd.match(/galLbStep\(/g) || []).length === 2,
    '★★ 键盘左右与点击走**同一个** galLbStep（各写一遍取模，边界处理迟早分叉）',
    String((kd.match(/galLbStep\(/g) || []).length) + ' 处');
  ok(!/galLbI = \(galLbI/.test(kd), '★ keydown 里不再自己算下标（旧写法在这里留过一次分叉）');

  const op = (/function galLbOpen\([\s\S]*?\n\}/.exec(IDX) || [''])[0];
  ok(/b\.hidden = !multi|hidden = !multi/.test(op), '只有一张图时把箭头藏掉（不给点了不动的控件）');
  ok(/\.gal-lb img\{[^}]*cursor:pointer/.test(IDX),
    '大图光标改成 pointer（点图的行为是「翻到下一张」，不是关闭，zoom-out 是骗人的）');
}

/* ============================================================
 *  ③ 右侧定位条：补「评分参数」
 * ============================================================ */
console.log('\n=== ③ 右侧悬浮定位条 ===');
{
  const rail = arrOf('D_RAIL');
  ok(rail.length > 0, '能取到 D_RAIL 声明');
  const n = (rail.match(/\{ k: '/g) || []).length;
  ok(n >= 9, '★ 定位条分区数 ≥ 9（v10.28 是 8，本轮补了「评分参数」）', n + ' 项');
  ok(/nm: '评分参数'/.test(rail), '★★ D_RAIL 里有「评分参数」这一项（用户反馈「好像没更新」的根因）');
  ok(/sel: \['#drawerBody \.d-body > \.kv'\]/.test(rail),
    '★ 它锚定到正文里的参数表（用 `.d-body >` 限定，避免命中别处的 .kv）');
  ok(/nm: '游戏预览'/.test(rail), '「游戏预览」项仍在（下移后由 DOM 顺序自动排到介绍之后）');
  ok(/found\.sort\(/.test(fnBody('railSync')), '★ 顺序仍由 railSync 排（不靠 D_RAIL 的书写顺序）');
  /* ★ v10.29 修：排序键原来是 `getBoundingClientRect().top`（视口位置），
     这对 `position:sticky` 的元素是错的 —— `.d-dock` 里的 `#dlStrip` 的 rect
     反映的是「此刻吸在视口底部」的位置，于是「下载」被排到第 3 位（正文里倒数第 3）。
     实测样本：博德之门3（xd-419）。改成 `compareDocumentPosition` 后才是真文档顺序。 */
  const railSyncBody = fnBody('railSync');
  /* ⚠️ 判据只能打在**排序那一行**上。首版写成「railSync 函数体里不含 getBoundingClientRect().top」，
     结果是**恒假的红** —— 我在改动处写的注释里正好引用了这个串来解释旧实现。
     注释里出现某个模式 ≠ 代码里用了它（本项目的 .dl-secs 反向断言也栽过同一处）。 */
  const sortLine = railSyncBody.split(/\r?\n/).find((l) => /found\.sort\(/.test(l)) || '';
  ok(/compareDocumentPosition\(/.test(sortLine) && /DOCUMENT_POSITION_FOLLOWING/.test(sortLine),
    '★★ 排序键取**文档顺序**（sticky 元素的 rect 会让「下载」排错位）',
    sortLine.trim().slice(0, 90) || '(取不到 found.sort 那一行)');
  ok(sortLine.length > 0 && !/getBoundingClientRect/.test(sortLine),
    '★★ 反向断言：排序那一行里**不许**出现 getBoundingClientRect（视口坐标对 sticky 元素是错的，本行即红）');
}

/* ============================================================
 *  ④ 下载弹窗：三专区改真 tab（一次只画一块）
 * ============================================================ */
console.log('\n=== ④ 下载弹窗分区 tab ===');
{
  const tabList = fnBody('dlTabList');
  ok(tabList.length > 0, '★ 新增 dlTabList()（分区清单的唯一真源）');
  ok(/xdItems\.length/.test(tabList), 'XD 有内容才算一个分区（空的不摆）');
  ok(/for \(const s of v\.secs\)/.test(tabList), '机地三个专区逐个进清单');

  const refs = (IDX.match(/dlTabList\(/g) || []).length;
  ok(refs >= 3, '★ 工具条与正文**共用**同一份清单（定义 1 处 + 使用 ≥ 2 处）', refs + ' 处引用');

  const bar = fnBody('dlBarHtml');
  ok(/dlTabList\(v\)/.test(bar), '工具条从 dlTabList 取签');
  ok(/tabs\.length > 1/.test(bar), '★ 只有一个分区时不摆签（一个签既不切换信息也白占一行）');
  ok(/v\.tab === t\.key \? ' on'/.test(bar), '★ 选中态由 v.tab 决定（复用 .dl-an.on 的高亮样式）');
  ok(!/dlIsOpen/.test(bar), '工具条不再依赖已删的 dlIsOpen()');

  const pd = fnBody('paintDownload');
  ok(pd.length > 0, '能取到 paintDownload 函数体');
  ok(/const tabs = dlTabList\(v\)/.test(pd), '正文从同一份清单取数');
  ok(/const cur = tabs\.find/.test(pd), '只取**当前**分区');
  /* ★★ 本版最要紧的一条：体内不许再出现「遍历全部分区各画一块」的写法。 */
  ok(!/v\.secs\.map\(/.test(pd) && !/v\.xdItems\.map\(/.test(pd),
    '★★ paintDownload 体内不再遍历全部分区（遍历 = 又把本体和 Mod/修改器堆在一起）');
  ok((pd.match(/dlBlock\(/g) || []).length === 1, '只调一次 dlBlock（一个分区一块面板）');
  ok(/tabs\.some\(\(t\) => t\.key === v\.tab\)/.test(pd), '当前分区没了（换游戏/换筛选）时有兜底');
  ok(!/sel\.open/.test(pd) && !/\bst\.open\b/.test(pd), '★ 不再读写 open 状态（折叠语义已删）');

  const goTab = fnBody('dlGoTab');
  ok(goTab.length > 0, '★ 新增 dlGoTab()（切分区）');
  ok(/if \(dlView\.tab === key\) return;/.test(goTab), '点当前分区不做无谓重渲染');
  ok(/scrollTop = 0/.test(goTab),
    '★ 切分区后滚动位置归零（否则看到的是新分区的中段，会以为「这块只有这么几条」）');
  ok(/dlGoTab\(go\.dataset\.dlGo\)/.test(IDX), '★ 委托里 data-dl-go 走 dlGoTab（不是旧的展开折叠）');

  const od = (/async function openDownload\([\s\S]*?\n\}/.exec(IDX) || [''])[0];
  ok(/tab: firstTab/.test(od), '★ openDownload 初始化 dlView.tab');
  ok(/s\.key === 'body'\) \? 'body'/.test(od), '本体优先（源站三个 tab 里本体也是默认页）');
  ok(/xdItems\.length \? 'xd' : ''/.test(od), '机地一个专区都没有时回落到 XD 那一块');
  ok(!/open: (true|false)/.test(od), '★ sec[key] 只剩 all —— open 随折叠一起废掉');
}

/* ============================================================
 *  ⑤ 修改器 + 云存档：同行 / 各最多 5 行 / 右上角更多
 * ============================================================ */
console.log('\n=== ⑤ 修改器 + 云存档同行、各最多 5 行 ===');
{
  ok(/\.d-pair\{display:grid/.test(IDX), '★ .d-pair 改成 grid（v10.28 是 display:block，两块上下堆）');
  ok(/\.d-pair\{display:grid;grid-template-columns:1fr 1fr/.test(IDX), '★ 两列等宽 = 同行');
  ok(/\.d-pair\.solo\{grid-template-columns:1fr\}/.test(IDX), '只有一块有内容时收成单列（不留一整列空白）');
  ok(/@media\(max-width:760px\)\{\.d-pair\{grid-template-columns:1fr\}\}/.test(IDX),
    '窄屏回落单列（并排后每块只剩 ~150px，路径会被挤成三四个字一行）');
  ok(/\.d-pair>div>\.d-blk\{margin-bottom:0\}/.test(IDX), '卡片的 margin-bottom 在 grid 里去掉（否则两列底部不齐）');
  ok(/align-items:start/.test(IDX), '两块各自按内容高度收（拉齐会让行少的那块留一大片空白）');

  const sp = fnBody('syncPair');
  ok(sp.length > 0, '★ 新增 syncPair()（两块异步回填，谁先回来不一定）');
  ok(/children\.length/.test(sp), '★ 判据是「槽位里有没有真渲染出内容」（槽位节点本身永远存在）');
  ok(/classList\.toggle\('solo'/.test(sp), '用 classList.toggle 打 .solo（不用 if/else 两行）');
  ok((IDX.match(/finally \{ syncPair\(\); \}/g) || []).length === 2,
    '★ 两个加载函数都在 finally 里调（提前 return 的路径也要走到）',
    String((IDX.match(/finally \{ syncPair\(\); \}/g) || []).length) + ' 处');

  const tr = (/async function loadTrBlock\([\s\S]*?\n\}/.exec(IDX) || [''])[0];
  ok(/const MAXTR = 5;/.test(tr), '★ 修改器行数上限 = 5');
  ok(/items\.slice\(0, MAXTR\)/.test(tr), '★★ 上限真的用在 slice 上（只声明常量不引用 = 没生效）');
  ok(!/items\.slice\(0, 8\)/.test(tr), '旧的 8 行上限已清');
  ok(/items\.length > MAXTR/.test(tr), '超出才给「更多」（不足 5 行给个点开一样的按钮不如没有）');
  ok(/dMoreHd\(/.test(tr), '★ 更多按钮走 dMoreHd（卡片右上角版式）');
  ok(/\$\{more\}<\/h4>/.test(tr), '★ 按钮在 **h4 卡头里**，不是正文流末位的一整行');

  const sv = (/async function loadSvBlock\([\s\S]*?\n\}/.exec(IDX) || [''])[0];
  ok(/const MAXROWS = 5;/.test(sv), '★ 云存档行数上限 = 5');
  ok(/const pTake = Math\.min\(paths\.length, MAXROWS\);/.test(sv), '路径先吃额度');
  ok(/const rTake = Math\.min\(regs\.length, MAXROWS - pTake\);/.test(sv),
    '★★ 注册表吃**剩余**额度（写死 3+2 时「1 条路径 + 5 条注册表」会白空 2 行）');
  ok(!/MAXP = 3, MAXR = 2/.test(sv), '旧的 3+2 写死上限已清');
  ok(/\(paths\.length - pTake\) \+ \(regs\.length - rTake\)/.test(sv), 'hidden 也按实际额度算（否则按钮和内容对不上）');
  ok(/\$\{more\}<\/h4>/.test(sv), '★ 云存档的按钮同样在 h4 卡头里');

  const mh = fnBody('dMoreHd');
  ok(mh.length > 0, '★ 新增 dMoreHd()（卡片右上角更多按钮）');
  ok(/class="d-more-hd"/.test(mh), '产出 .d-more-hd');
  ok(/data-full=/.test(mh), '★★ 与 dFullBtn 共用 data-full 委托（弹窗侧一行都不用改）');
  ok(/function dFullBtn\(/.test(IDX), '整行版 dFullBtn 仍在（手机配置的「更多」还在用）');
  ok(/dFullBtn\(dFullPut/.test(IDX), '★ 整行版仍有调用方（误删会让手机配置的更多入口消失）');

  ok(/\.d-blk h4 \.d-more-hd\{/.test(IDX), '★ 有 .d-more-hd 样式规则');
  ok(/\.d-blk h4 \.cnt\+\.d-more-hd\{margin-left:6px\}/.test(IDX),
    '★ 紧跟 .cnt 时用固定间距（两个 auto 会平分剩余空隙，把条数徽标推到中间）');
  ok(/\.d-blk h4 \.d-more-hd\[?[^{]*\{[^}]*color:var\(--c-primary\)/.test(IDX), '按钮配色与既有主色一致');
}

/* ============================================================
 *  ⑥ dlTabList 真函数求值
 * ============================================================ */
console.log('\n=== ⑥ dlTabList：分区清单（取源码求值跑真函数）===');
{
  const src = fnBody('dlTabList');
  let F = null;
  try { F = new Function(src + '; return dlTabList;')(); } catch (e) { F = null; }
  ok(typeof F === 'function', '能从主源取出并求值 dlTabList（纯函数，不碰 DOM）');

  if (typeof F === 'function') {
    const secs = [
      { key: 'body', name: '本体', items: [1, 2], count: 22, returned: 22, merged: true },
      { key: 'mod', name: 'Mod', items: [3], count: 190, returned: 100, merged: false },
      { key: 'modifier', name: '修改器', items: [4, 5], count: 4, returned: 4, merged: false },
    ];
    const four = F({ xdItems: [{}], secs });
    ok(four.length === 4, 'XD + 三个专区 = 4 个分区', String(four.length));
    ok(four[0].key === 'xd', 'XD 排在第一个（源站顺序：先 XD 后机地）');
    ok(four.slice(1).map((t) => t.key).join(',') === 'body,mod,modifier',
      '机地三个专区按本体 → Mod → 修改器排', four.slice(1).map((t) => t.key).join(','));
    ok(four[1].count === 22 && four[1].ret === 22 && four[1].merged === true,
      '★ 源站口径（count / returned / merged）逐个透传 —— 面板要靠它写「源站共 N 帖，取回 M 帖」');
    ok(four[0].count === undefined, 'XD 那侧没有专区口径（字段留空，由调用方兜）');

    const onlyJidi = F({ xdItems: [], secs });
    ok(onlyJidi.length === 3 && onlyJidi[0].key === 'body', '只有机地时 = 3 个分区，本体打头');

    const onlyXd = F({ xdItems: [{}, {}], secs: [] });
    ok(onlyXd.length === 1 && onlyXd[0].key === 'xd', '只有 XD 时 = 1 个分区（不凭空造机地专区）');

    const none = F({ xdItems: [], secs: [] });
    ok(none.length === 0, '全空 → 0 个分区（调用方会把整块收起）');
  }
}

/* ============================================================
 *  ⑦ 被替换掉的旧实现已清（死代码会让下一个人以为还有另一条路）
 * ============================================================ */
console.log('\n=== ⑦ 旧实现已清 ===');
{
  const dead = [
    [/function dlIsOpen\(/, 'dlIsOpen()'],
    [/function dlOpenSec\(/, 'dlOpenSec()'],
    /* ⚠️ 不能写成 `IDX.includes('data-dl-sec')` —— 解释「已删除」的注释里就写着这个串，
       那样会当场误报（本轮实测踩到）。判据要打在**属性产出与委托**这两处用法上。 */
    [/data-dl-sec="/, 'data-dl-sec 的 HTML 属性'],
    [/closest\('\[data-dl-sec\]'\)/, 'data-dl-sec 的委托分支'],
    [/\bst\.open\b/, 'sec[key].open 状态'],
  ];
  for (const [re, nm] of dead) ok(!re.test(IDX), '  已清 ' + nm);
  const rules = cssRules(/^\s*\.(dl-tg|dl-secs|dl-sec\.off|dl-grp\.off)\s*[>{]/);
  ok(rules.length === 0, '★ 折叠态相关 CSS 规则（.dl-tg / .dl-secs / .dl-sec.off）已清',
    rules.length ? rules.slice(0, 3).join(' | ') : '0 条规则');
  ok(/<div class="dl-sec" data-sec="/.test(fnBody('dlBlock')),
    '★ dlBlock 的面板不再拼 off 类（面板只有「当前分区」一种状态）');
}

/* ============================================================
 *  ⑧ 派生页同步（改主源不重建 ⇒ 那边静默停在旧版）
 * ============================================================ */
console.log('\n=== ⑧ 派生页同步 ===');
for (const page of ['public/emulator.html', 'public/unpack.html']) {
  let t = '';
  try { t = read(page); } catch (e) { /* 缺文件时下面全红 */ }
  const nm = page.split('/')[1];
  ok(/function galLbStep\(/.test(t), '  ' + nm + ' 已同步灯箱翻页');
  ok(/\.gal-lb-nav\{/.test(t), '  ' + nm + ' 已同步箭头样式');
  ok(/function dlTabList\(/.test(t), '  ' + nm + ' 已同步分区 tab');
  ok(/function dlGoTab\(/.test(t), '  ' + nm + ' 已同步切分区');
  ok(/function dMoreHd\(/.test(t), '  ' + nm + ' 已同步卡片右上角更多');
  ok(/function syncPair\(/.test(t), '  ' + nm + ' 已同步同行布局');
}

console.log('\n============================');
console.log('  通过 ' + pass + '/' + (pass + fail) + '（失败 ' + fail + '）');
console.log('============================');
process.exit(fail ? 1 : 0);
