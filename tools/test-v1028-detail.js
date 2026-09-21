/* 详情页「版式重排 + 手机配置合一 + 三专区预览/分页」防线的常驻版本 —— v10.28 新增
 *
 * 覆盖四块（对应用户四条口径）：
 *   ① 版式顺序：封面+标题(吸顶) → 评分+参数表 → 介绍/版本 → **游戏预览** → 配置要求
 *      → 手机模拟器配置 → 修改器+云存档 → 同分类更多 → 本体/Mod/修改器 → 其他；
 *      操作按钮组固定抽屉底部
 *      （★ v10.29：游戏预览从「封面之后」挪到**介绍块之后**，本套件的 ORDER 数组已同步）
 *   ② 手机配置「只需要手机模拟器配置，不要多个显示」：四块收成一块，默认 5 台机型，
 *      其余 + 实测 + 逐条参数进「更多」弹窗
 *   ③ 图片灯箱要**置顶**（原 z-index 90 被抽屉 100 原样盖住 ⇒ 点开大图什么都没发生）
 *   ④ 底部三专区（本体/修改器/Mod）每块只露 3 帖，点「全部」进弹窗，**每页 10 帖**翻页
 *
 * ★ 为什么必须做②里的「入口在 if 外面」那条：`#bhMoreSlot` 的填充一度被嵌进
 *   `if (devs.length && ds)` 里 —— 库里存在「机型清单为空、但有实测记录/逐条配置」的游戏，
 *   那样入口会被一起吞掉，而**所有「元素存在」断言照样绿**（最危险的那类假绿）。
 *
 * ★ 为什么③要用层级比较而不是「有没有 .gal-lb 规则」：灯箱一直在（元素也在），
 *   坏的只是**层叠**。存在性断言对这条 bug 完全无感 —— 本项目 v10.22 栽过同款
 *   （下载弹窗 z-index 低于抽屉）。判据一律取 `.drawer` / `.dlpop` 做参照物。
 *
 * ★ ④的分组逻辑用**取源码求值**跑真函数（不碰 DOM），不靠「源码里有没有某串字符」——
 *   后者在注释里出现同一串文字就恒真。
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
const eq = (got, want, name) => ok(got === want, name, '得到 ' + JSON.stringify(got) + '，期望 ' + JSON.stringify(want));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const IDX = read('public/index.html');
const EMU = read('public/emulator.html');
const UNP = read('public/unpack.html');

/* ============================================================
 *  ① 详情页版式顺序（用户给的九条版式）
 * ============================================================ */
console.log('=== ① 详情页版式顺序 ===');
{
  /* 取出 paintDetail 里 body.innerHTML 的那一整段模板。
     终点用「反引号 + 分号」——模板里不会出现这两个字符连写（模板内部没有嵌套模板）。
     ⚠️ 「body.innerHTML = 反引号」在全页**有多处**（搜索弹窗骨架也用同一句），
        所以必须从 paintDetail 之后开始找。直接 indexOf 会取到搜索骨架，
        结果是 14 个标记全部「找不到」⇒ 一片假红（本套件首次运行就栽在这里）。 */
  const pdA = IDX.indexOf('function paintDetail(');
  const a = IDX.indexOf('body.innerHTML = `', pdA);
  const b = IDX.indexOf('`;', a);
  ok(a > 0 && b > a, '能取到 paintDetail 的 body.innerHTML 模板段', a + '..' + b);
  const TPL = IDX.slice(a, b);

  /* 顺序判据：按用户版式列出的九块，各自取**唯一标记**，索引必须严格递增。
     ★ v10.29：`${shotsHtml}` 从「封面之后」挪到**介绍块之后**（用户口径「游戏预览放在游戏介绍下」），
       本数组的顺序随之调整 —— 这个数组就是「版式真源」，改版式必须同步改它，
       否则改完静态断言红了会被误判成「改坏了」。 */
  const ORDER = [
    ['封面+标题(吸顶)', '<div class="d-hero" id="dHero">'],
    ['正文容器', '<div class="d-body">'],
    ['玩家评分', 'class="score-line"'],
    ['参数表', '<div class="kv">'],
    ['游戏介绍', '${descHtml}'],
    ['版本介绍', '${versionHtml}'],
    ['游戏预览', '${shotsHtml}'],
    ['配置要求', 'id="reqSlot"'],
    ['手机模拟器配置', 'id="bhSlot"'],
    ['修改器+云存档', 'id="trSvSlot"'],
    ['同分类更多', 'id="relSlot"'],
    ['本体/Mod/修改器', 'id="dlSlot"'],
    ['其他(跨源)', 'id="crossSrc"'],
    ['操作按钮组(固定底栏)', '<div class="d-dock">'],
  ];
  let prev = -1, firstBad = null;
  for (const [nm, mark] of ORDER) {
    const i = TPL.indexOf(mark);
    if (i < 0) { firstBad = nm + '（标记找不到：' + mark + '）'; break; }
    if (i < prev) { firstBad = nm + '（位置比上一块还靠前）'; break; }
    prev = i;
  }
  ok(firstBad === null, '★ 十四块标记在模板里**按用户版式顺序**出现', firstBad || '全部递增');
  /* 逐块单独钉一条，出错时直接看得出是哪一块错位（合并成一条的话只报「顺序不对」） */
  for (const [nm, mark] of ORDER) {
    ok(TPL.indexOf(mark) >= 0, '  版式含【' + nm + '】');
  }
  /* ★ 反证要点（v10.29 更新）：把 `${shotsHtml}` 挪回**封面之后**（v10.28 的位置）本组立刻变红。
     下面这条是「位置本身」的判据：预览必须在**介绍块之后**、配置要求之前
     —— 用户口径「游戏预览放在游戏介绍下」。
     ⚠️ 位置判据**必须自带「两边都存在」的前置**：`indexOf` 找不到时返回 -1，
        -1 比任何下标都小 ⇒ 写成裸比较时「标记被删掉」反而让它变绿。
        v10.29 的反证第一次跑就抓到这一点（把 version 标记整行替换掉，判据照样 PASS）。 */
  const atp = (m) => TPL.indexOf(m);
  const afterP = (x, y) => atp(x) >= 0 && atp(y) >= 0 && atp(x) > atp(y);
  ok(afterP('${shotsHtml}', '${versionHtml}') &&
    atp('${shotsHtml}') >= 0 && atp('${shotsHtml}') < atp('id="reqSlot"'),
    '★ 游戏预览在「游戏介绍 / 版本介绍」**之后**、配置要求之前');
  ok(afterP('id="dlSlot"', 'id="relSlot"'),
    '★ 下载三专区在「同分类更多」**之后**（用户口径：本体/修改器/Mod 放在最下面）');
  ok(afterP('id="crossSrc"', 'id="dlSlot"'),
    '「其他」块确实在三专区之后');
}

/* ============================================================
 *  ② 顶图 + 常驻小标题条
 *  ★ v10.30 整组换掉旧判据：v10.28/10.29 是「250px sticky 大图滚过 90px
 *    收窄成 62px（`.d-hero.mini`）」，实测会「一直闪」，已换成
 *    「大图随滚动滚走 + 恒高 62px 的 `.d-mini` 滑入」。
 *    ⚠️ 这不是「实现坏了」而是「设计改了」。同步时要**同时守住新机制的要害**，
 *       别只把旧断言删掉凑绿 —— 下面这几条都是「删了就没人发现」的点：
 *       ① 大图定高且不 sticky（布局不再影响 scrollTop）；
 *       ② 小条恒 62px、靠 transform 进出、负 margin 不占流；
 *       ③ 状态以 DOM class 为唯一事实来源 + 双阈值 + rAF 合帧。
 * ============================================================ */
console.log('\n=== ② 顶图 + 常驻小标题条 ===');
{
  ok(/\.d-hero\{[^}]*position:relative/.test(IDX), '★ .d-hero 不再 sticky（大图随滚动滚走）');
  ok(/\.d-hero\{[^}]*height:250px/.test(IDX), '.d-hero 定高 250px（高度恒定是「不闪」的结构前提）');
  ok(/\.d-hero\{[^}]*z-index:\s*\d+/.test(IDX), '★ 顶图要显式给 z-index（不给会被下面的卡片盖住）');
  const zHero = Number((/\.d-hero\{[^}]*z-index:\s*(\d+)/.exec(IDX) || [])[1]);
  const zDock = Number((/\.d-dock\{[^}]*z-index:\s*(\d+)/.exec(IDX) || [])[1]);
  ok(zHero > 0 && zDock > zHero, '★ 固定底栏层级高于顶图（否则底栏会被压住）',
    'hero=' + zHero + ' dock=' + zDock);

  ok(/function dHeroSpy\(\)/.test(IDX), '新增 dHeroSpy()');
  ok(/\.d-mini\{[^}]*position:sticky/.test(IDX), '★ 新增 .d-mini 常驻小标题条（sticky 吸顶）');
  ok(/\.d-mini\{[^}]*height:62px/.test(IDX), '★ 小条恒高 62px（不随滚动变化）');
  ok(/\.d-mini\{[^}]*margin-bottom:-62px/.test(IDX),
    '★★ 小条用负 margin **不占文档流**（不加这一条正文会整体下移 62px）');
  ok(/\.d-mini\.on\{/.test(IDX), '★ 有 .d-mini.on 激活态');
  ok(/\.d-mini\{[^}]*transform:translateY\(-102%\)/.test(IDX), '★ 未激活时靠 transform 收在上方（不靠改高度）');
  ok(/\.d-mini\{[^}]*pointer-events:none/.test(IDX), '未激活时不吃点击');
  /* ★ 开关必须用一次 classList.toggle —— 写成 if/else 两行会在快速滚动时抖动。
     判据取「函数体里 toggle('on' 只出现一次」，锚定到 dHeroSpy 体内。 */
  const spyBody = (/function dHeroSpy\(\) \{[\s\S]*?\n\}/.exec(IDX) || [''])[0];
  ok(spyBody.length > 0, '能取到 dHeroSpy 的函数体');
  ok((spyBody.match(/classList\.toggle\('on'/g) || []).length === 1,
    '★ 开关只用一次 classList.toggle（写成 if/else 两行会抖）');
  ok(/dr\.scrollTop/.test(spyBody), 'dHeroSpy 按抽屉滚动量判开关');
  ok(/h\.classList\.contains\('on'\)/.test(spyBody),
    '★★ 状态以 DOM class 为唯一事实来源（另存模块变量 ⇒ 换游戏后没法天然复位）');
  ok(/requestAnimationFrame/.test(spyBody), '★ rAF 合帧（滚动事件再密，一帧只结算一次）');
  ok(/MINI_GAP/.test(spyBody), '★ 双阈值滞后（单阈值在临界点反复翻转 —— 那正是「一直闪」）');
  ok(/hero\.offsetHeight/.test(spyBody),
    '★ 阈值跟大图**实际**高度算（窄屏大图 190px，写死阈值会留空档）');
  ok(/railSpy\(\);\s*dHeroSpy\(\);/.test(IDX),
    '★ dHeroSpy 接进了滚动回调（只定义不接线 = 滚动时永远不动，而存在性断言照样绿）');
  ok(/railSync\(\);[\s\S]{0,160}?dHeroSpy\(\);/.test(IDX),
    '★ paintDetail 结束时也调一次（定初态：换游戏后不该残留上一次的激活态）');
}

/* ============================================================
 *  ③ 图片灯箱置顶
 * ============================================================ */
console.log('\n=== ③ 图片灯箱层级 ===');
{
  const zOf = (sel) => {
    const re = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{[^}]*z-index\\s*:\\s*(\\d+)');
    const m = re.exec(IDX);
    return m ? Number(m[1]) : null;
  };
  const zLb = zOf('.gal-lb'), zDrawer = zOf('.drawer'), zPop = zOf('.dlpop');
  ok(zLb != null && zDrawer != null && zPop != null,
    '能取到灯箱 / 抽屉 / 下载弹窗三者的 z-index', 'lb=' + zLb + ' drawer=' + zDrawer + ' pop=' + zPop);
  ok(zLb > zDrawer,
    '★★ 灯箱层级必须**高于详情抽屉**（原 90 < 100 ⇒ 从详情页点开大图被原样盖住，'
    + '而「灯箱存在 / 有图 / 可点」全部成立 —— 最危险的那类假绿）',
    zLb + ' > ' + zDrawer);
  ok(zLb > zPop, '灯箱也高于下载弹窗', zLb + ' > ' + zPop);
  ok(/\.gal-lb\{[^}]*position:fixed/.test(IDX), '灯箱仍是 fixed（挂在 body 上，不受抽屉 transform 影响）');
  /* ★ v10.28 真 bug 回归：✕ 按钮有样式、有元素，但 document 级 click 处理里**没有它的分支** ——
     点一下落进最后一个 return 什么都不做，用户只能按 Esc。
     「✕ 存在 / 可见 / 可点」三项当时全部为真 ⇒ 只能靠「有没有那个分支」来守。
     实拍侧由 tools/preview-v1028.js 钉「点 ✕ → 灯箱消失」。 */
  ok(/e\.target\.closest\('\.gal-lb-x'\)/.test(IDX),
    '★ 点右上角 ✕ 有对应的关闭分支（只有按钮样式而没有点击处理 = 点不动）');
}

/* ============================================================
 *  ④ 操作按钮组：固定在详情页底部
 * ============================================================ */
console.log('\n=== ④ 固定底栏 .d-dock ===');
{
  ok(/\.d-dock\{[^}]*position:sticky/.test(IDX), '★ .d-dock 是 sticky 贴底');
  ok(/\.d-dock\{[^}]*bottom:0/.test(IDX), '.d-dock bottom:0');
  ok(/env\(safe-area-inset-bottom/.test(IDX), '★ 补了刘海屏安全区（不加的话全面屏底部会被手势条压住）');
  ok(/\.d-dock \.dl-strip\{margin-top:0\}/.test(IDX),
    '★ 底栏内不再各留一份上边距（两处都留会有条白缝）');

  /* ★ .d-dock 必须在 .d-body **之外**。
     判据用 HTML 标签配平（<div 与 </div> 计数）：到 .d-dock 之前必须配平。
     反证：把它挪进 .d-body 内 ⇒ 配平数变成 opens>closes ⇒ 立刻变红。
     （模板里内联的 div 串都成对出现，所以计数可靠。） */
  const pdA2 = IDX.indexOf('function paintDetail(');
  const tplA = IDX.indexOf('body.innerHTML = `', pdA2);   // 同 ① 段：必须从 paintDetail 之后找
  const TPL = IDX.slice(tplA, IDX.indexOf('`;', tplA));
  const dockAt = TPL.indexOf('<div class="d-dock">');
  ok(dockAt > 0, '能取到 .d-dock 在模板里的位置');
  const beforeDock = TPL.slice(0, dockAt);
  const opens = (beforeDock.match(/<div\b/g) || []).length;
  const closes = (beforeDock.match(/<\/div>/g) || []).length;
  ok(opens === closes,
    '★ 操作按钮组在 .d-body **之外**（.d-body 有 padding-bottom，放里面 sticky 会被垫起一条白缝）',
    '<div=' + opens + ' </div>=' + closes);
  ok(/<div class="d-dock">[\s\S]{0,600}?id="dlStrip"/.test(TPL),
    '★ 三个下载按钮（#dlStrip）确实躺在固定底栏里（只加 CSS 不搬节点 = 底栏是空的）');
}

/* ============================================================
 *  ⑤ 手机配置：四块收成一块
 * ============================================================ */
console.log('\n=== ⑤ 手机模拟器配置合一 ===');
{
  ok(/<div id="bhDevSlot"><\/div>/.test(IDX) && /<div id="bhHwSlot"><\/div>/.test(IDX)
    && /<div id="bhMoreSlot"><\/div>/.test(IDX),
    '★ 三槽齐备：机型 / 硬件面板 / 「更多」入口');
  ok(!/id="bhRecSlot"/.test(IDX) && !/id="bhParamSlot"/.test(IDX),
    '★★ 旧的 #bhRecSlot / #bhParamSlot 已清（留着就是「以为还有另一条渲染路」的死槽位）');
  ok(/const DL_DEV_SHOW = 5;/.test(IDX), '★ 默认展示 5 台机型（用户口径「默认展示5个」）');
  ok(/allDevs\.slice\(0, DL_DEV_SHOW\)/.test(IDX), '截断用的是 DL_DEV_SHOW');

  /* ★ 真 bug 回归：「更多」入口必须在 if (devs.length && ds) **块外面**。
     库里存在「机型清单为空、但有实测/逐条配置」的游戏，嵌进去就连入口一起吞掉。
     判据：从那个 if 起到 moreSlot 之前，必须已经出现过「4 空格缩进的 }」
     （块内缩进一律 ≥6 空格，所以 4 空格的 } 只可能是这个 if 自己的闭合）。 */
  const iIdf = IDX.indexOf('if (devs.length && ds) {');
  const iMore = IDX.indexOf("const moreSlot = $('#bhMoreSlot');");
  ok(iIdf > 0 && iMore > iIdf && /^ {4}\}/m.test(IDX.slice(iIdf, iMore)),
    '★★ 「更多」入口在 if (devs.length && ds) 块**外面**'
    + '（无机型但有实测的游戏也要能点开；嵌进 if 里所有存在性断言照样绿）',
    'if@' + iIdf + ' more@' + iMore);
  ok(/type: 'dv', title: '手机模拟器配置 · 全部'/.test(IDX),
    '「更多」弹窗复用统一的 dFullPut 载荷机制');
  ok(/return \{ items: out, recs, params \};/.test(IDX),
    '★ 弹窗里同时给三份数据：全部机型 + 本站实测 + 逐条参数（用户选择「收进弹窗」而非删掉）');
  ok(/i \+= 40/.test(IDX), '★ 机型规格分块发（一次性塞 URL 查询串会 414 URI Too Long）');
}

/* ============================================================
 *  ⑥ 硬件面板只留「品牌 / 型号 / 硬件配置」
 * ============================================================ */
console.log('\n=== ⑥ 硬件面板精简 ===');
{
  ok(/const HW_INFO_G = '基本信息', HW_HW_G = '硬件配置';/.test(IDX),
    '★ 面板按「基本信息 / 硬件配置」两组筛（一条声明两个常量，正则要跟着写全）');
  ok(/品牌 \$\{esc\(brand\)\}/.test(IDX), '头部显示品牌');
  ok(!/HW_KEEP/.test(IDX), '★ 旧的 HW_KEEP 白名单已清');
  ok(!/function hwToggleRest/.test(IDX) && !/\.hw-more\s*\{/.test(IDX),
    '★ 旧的「展开其余字段」按钮与函数已清（面板现在只留两组，不再需要折叠）');
  ok(!/\.hw-rest\{/.test(IDX), '旧的 .hw-rest 样式已清');
}

/* ============================================================
 *  ⑦ 三专区预览 + 弹窗分页
 * ============================================================ */
console.log('\n=== ⑦ 三专区预览与分页 ===');
{
  ok(/const DL_PREV_CAP = 3;/.test(IDX), '★ 每块只露前 3 帖（用户口径「每个均只展示前三个」）');
  ok(/const DF_PAGE = 10;/.test(IDX), '★ 弹窗每页 10 帖（用户口径「弹窗显示十个」）');
  ok(/s\.posts\.slice\(0, DL_PREV_CAP\)/.test(IDX), '预览真的按 DL_PREV_CAP 截断');
  ok(/DL_PREV_CAP\)\);/.test(IDX) || /s\.posts\.length > DL_PREV_CAP/.test(IDX),
    '★ 不足 3 帖时不给「全部」按钮（点开跟外面一样的按钮不如没有）');
  ok(/function dlPrevBlock\(s\)/.test(IDX) && /dlSecs\.map\(dlPrevBlock\)/.test(IDX),
    '三块预览由 dlPrevBlock 统一渲染（两处各写一套必然漂移）');
  ok(/data-df-open="\$\{esc\(s\.key\)\}"/.test(IDX), '★ 每块的「全部」带 data-df-open（否则点了没反应）');

  ok(/function openDlSecPop\(/.test(IDX), '新增 openDlSecPop()：同步开专区弹窗（复用 dlSecs，不再发请求）');
  ok(/dlsec\(p, page, secKey\)/.test(IDX), '★ D_FULL_RENDER 新增 dlsec 渲染器');
  ok(/function paintFull\(\)/.test(IDX) && /let dFullCur = null;/.test(IDX),
    '★ 翻页要有「当前页状态」（dFullCur）+ 单出口重渲染（paintFull）');
  ok(/data-df-page="/.test(IDX) && /class="df-pg"/.test(IDX), '上/下页按钮带 data-df-page');
  ok(/data-df-sec="/.test(IDX) && /class="df-tab/.test(IDX), '多专区时给切换标签');
  ok(/pg <= 1 \? ' disabled'/.test(IDX) && /pg >= pages \? ' disabled'/.test(IDX),
    '★ 首/末页的翻页按钮要 disabled（否则能翻到空页）');
  ok(/const dfs = e\.target\.closest\('\[data-df-sec\]'\)/.test(IDX)
    && /dFullCur\.page = 1;/.test(IDX),
    '★ 切专区时**页码归 1**（不归就会落在空页上，看起来像「这个专区没资源」）');

  /* CSS 齐备：只改 JS 不加样式，块会渲染成一行裸文字，而所有存在性断言照样绿 */
  for (const cls of ['.dl-prev', '.dl-prev .h', '.dl-prev .l', '.dl-prev .none', '.dl-all',
    '.df-list', '.df-tabs', '.df-tab', '.df-pager', '.df-pg', '.df-pg-n', '.df-sect']) {
    ok(new RegExp(cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{').test(IDX)
      || new RegExp(cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{').test(IDX)
      || new RegExp(cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s,{]').test(IDX),
      '  样式齐备 ' + cls);
  }
}

/* ============================================================
 *  ⑧ 死代码清零（被替换掉的东西必须清干净）
 * ============================================================ */
console.log('\n=== ⑧ 被替换掉的旧实现已清 ===');
{
  /* ⚠️ 判据只认**代码与样式规则**，不认注释。
     本版刻意在注释里留了「XXX 已清、去向是 YYY」的说明 —— 那是**该留的**记录，
     拿「全文不出现这个名字」当判据会把这些正常注释判成失败（首轮就是这样假红的）。 */
  const DEAD = [
    ['D_DL_KIND 定义', /const D_DL_KIND/],
    ['D_DF_KIND 定义', /const D_DF_KIND/],
    ['D_FULL_RENDER.md 渲染器', /^  md\(p\)/m],
    ['D_FULL_RENDER.bp 渲染器', /^  bp\(p\)/m],
    ['.hw-more 样式规则', /\.hw-more\s*\{/],
    ['.dg 摘要芯片行规则', /\.d-hw \.dg\s*\{/],
    ['hwToggleRest 函数', /function hwToggleRest/],
  ];
  for (const [nm, re] of DEAD) ok(!re.test(IDX), '  已清 ' + nm);
  ok(/D_FULL_RENDER = \{/.test(IDX), 'D_FULL_RENDER 仍存在（不是整块被删）');
}

/* ============================================================
 *  ⑨ 底部按钮与三专区**同源**
 * ============================================================ */
console.log('\n=== ⑨ 底部按钮与专区同源 ===');
{
  ok(/if \(dlSecs\.some\(\(s\) => s\.key === kind\)\) \{ openDlSecPop\(kind\); return; \}/.test(IDX),
    '★ 底部「修改器 / Mod」优先开**同一份** dlSecs 的专区弹窗（按钮条数与点开内容同源）');
  ok(/setDlCounts\(cnt\)/.test(IDX) && /setDlCounts\(j && j\.counts\)/.test(IDX) === false,
    '★ 条数改由 /api/download 现算后回填（不再走 /api/mods/match 的 counts，避免两套统计）');
  ok(/openModList\(\{/.test(IDX),
    '★ mods/match 那条链路仍保留作兜底（XD 源没有专区概念，dlSecs 只有一块 key=all）');
  ok(/dlPre = \{ url: u, data: j \};/.test(IDX),
    '★ /api/download 结果缓存进 dlPre（点「下载本体」秒开，不必把 302 解析再跑一遍）');
  ok(/if \(dlPre && dlPre\.url === j\.u/.test(IDX),
    '★ 复用缓存前**必须比对 url**（不然换一款游戏后会串台，而且看起来完全正常）');
}

/* ============================================================
 *  ⑩ 三专区分组逻辑（取源码求值，跑真函数）
 * ============================================================ */
console.log('\n=== ⑩ dlSecsOf：按源站专区切分（真函数）===');
{
  const pickDef = (name) => {
    const n = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pats = [
      'function ' + n + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}',   // 普通函数（内部块都缩进，行首 } 即函数结束）
    ];
    for (const p of pats) {
      const m = new RegExp(p).exec(IDX);
      if (m) return m[0];
    }
    throw new Error('取不到 ' + name);
  };
  let F = null;
  try {
    F = new Function([
      pickDef('dlGroupByPost'), pickDef('dlSecsOf'),
      'return { dlGroupByPost, dlSecsOf };',
    ].join('\n'))();
    ok(true, '能从主源取出并求值这两个纯函数（分组逻辑不碰 DOM，可直接单测）');
  } catch (e) {
    ok(false, '取源码求值失败', e.message);
  }

  if (F) {
    /* 构造一份与真实 /api/download 同形的数据：
       sections 顺序**故意打乱**（真实返回是 body/mod/modifier，这里给 mod 在前），
       用来证明「固定序」是前端自己排的，不靠服务端顺序。 */
    const J = {
      source: 'jidi',
      sections: [
        { key: 'mod', name: 'Mod', count: 190, returned: 154, merged: true },
        { key: 'body', name: '本体', count: 22, returned: 60 },
        { key: 'modifier', name: '修改器', count: 4, returned: 10 },
      ],
      items: [
        { real: 'https://pan.baidu.com/s/1aaa', server: 'baidu', postId: 101, postTitle: '本体帖A', section: 'body' },
        { real: 'https://pan.xunlei.com/s/2bbb', server: 'xunlei', postId: 101, postTitle: '本体帖A', section: 'body' },
        { real: 'https://pan.quark.cn/s/3ccc', server: 'quark', postId: 102, postTitle: '本体帖B', section: 'body' },
        { real: 'https://pan.baidu.com/s/4ddd', server: 'baidu', postId: 201, postTitle: 'Mod帖', section: 'mod' },
        { real: 'https://pan.baidu.com/s/5eee', server: 'baidu', postId: 301, postTitle: '修改器帖', section: 'modifier' },
        { real: '', server: 'baidu', postId: 999, section: 'body' },   // 无地址 → 必须被过滤
      ],
    };
    const S = F.dlSecsOf(J);
    eq(S.length, 3, '★ 三个专区都出来了');
    eq(S.map((x) => x.key).join(','), 'body,mod,modifier',
      '★ 固定序「本体 → Mod → 修改器」（输入里 sections 是 mod 在前，输出必须自己排回来）');
    eq(S[0].posts.length, 2, '本体 2 帖（同帖的两条地址归成一帖）');
    eq(S[0].links, 3, '本体 3 个地址（links 与 posts 是两个口径，不能混用）');
    eq(S[0].count, 22, '★ 帖数用 sections[].count（源站权威口径），不是取回条数');
    eq(S[1].merged, true, 'merged 透传（用来标「含最近发布」）');
    eq(S[2].posts.length, 1, '修改器 1 帖');
    /* ★ 判据必须打在**地址**上，不能打在「帖 key 有没有 u: 前缀」上：
       去掉 real 过滤后，那条脏数据仍会凭 postId 归进某帖（key 变成 999，不是 'u:'），
       「有没有 u: 开头的键」照样为 false ⇒ **恒真**。
       本套件首版正是这么写的，反证第 ⑧ 条没变红才发现 —— 判据选错等于没写。 */
    eq(S.flatMap((x) => x.posts).flatMap((p) => p.links).filter((l) => !l.real).length, 0,
      '★ 没有 real 的条目被过滤（否则用户会点到一个空地址）');

    /* XD 源：没有 sections 概念，必须退成一块，而不是整块消失 */
    const S2 = F.dlSecsOf({
      source: 'xd',
      items: [
        { real: 'https://pan.baidu.com/s/9zzz', server: 'baidu', kind: 'downbtn' },
        { real: 'https://pan.xunlei.com/s/8yyy', server: 'xunlei', kind: 'downbtn' },
      ],
    });
    eq(S2.length, 1, '★ XD 源没有 sections → 退成一块（不能让新增的分区逻辑把原本能显示的链接变成空白）');
    eq(S2[0].key, 'all', 'XD 那一块 key=all');
    eq(S2[0].posts.length, 2, 'XD 两个盘口各一行（没有帖子概念，不硬归）');

    /* 空 / 畸形输入不许抛 */
    eq(F.dlSecsOf({ items: [] }).length, 0, '全空 → 0 块（调用方会把整块收起）');
    eq(F.dlSecsOf(null).length, 0, 'null 输入不抛异常');
    eq(F.dlSecsOf(undefined).length, 0, 'undefined 输入不抛异常');

    /* sections 里没声明的专区，items 里出现了也不凭空造块 */
    eq(F.dlSecsOf({
      sections: [{ key: 'body', name: '本体', count: 5 }],
      items: [{ real: 'https://pan.baidu.com/s/x', server: 'baidu', section: 'mod' }],
    }).length, 0, 'sections 未声明的专区不会凭空造块');
  }
}

/* ============================================================
 *  ⑪ 派生页同步（改主源不重建派生页**不报错**，只悄悄漂移）
 * ============================================================ */
console.log('\n=== ⑪ 派生页同步 ===');
{
  for (const [pg, t] of [['public/emulator.html', EMU], ['public/unpack.html', UNP]]) {
    ok(/<div class="d-dock">/.test(t) && /\.d-dock\{/.test(t), '  ' + pg + ' 已同步固定底栏');
    /* ★ v10.30：特征串从「dHeroSpy + .d-hero.mini」换成「dHeroSpy + .d-mini 小标题条」——
       派生页不同步时**不报错**，只会悄悄停在旧交互上，所以这条必须跟着换、不能删。 */
    ok(/function dHeroSpy\(\)/.test(t) && /\.d-mini\{[^}]*position:sticky/.test(t),
      '  ' + pg + ' 已同步小标题条');
    ok(/id="bhMoreSlot"/.test(t) && !/id="bhRecSlot"/.test(t), '  ' + pg + ' 已同步手机配置合一');
    ok(/data-df-page="/.test(t) && /\.df-pager\{/.test(t), '  ' + pg + ' 已同步专区分页');
    ok(/\.gal-lb\{[^}]*z-index:\s*(1[4-9]\d|[2-9]\d\d)/.test(t), '  ' + pg + ' 已同步灯箱层级');
  }
}

console.log('\n============================');
console.log('  通过 ' + pass + '/' + (pass + fail) + '（失败 ' + fail + '）');
console.log('============================');
process.exit(fail ? 1 : 0);
