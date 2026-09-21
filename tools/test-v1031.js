#!/usr/bin/env node
/* tools/test-v1031.js — v10.31 详情页四条体验修正（静态防线）
 *
 * 用户本轮口径（原文）：
 *   ①「详情页的顶部图不要动画了，现在还是会在一定的位置游戏名忽大忽小的闪」
 *   ②「我想要的置顶图是跟前端页面展示时一样的，而不是［那张糊图］，不知道哪里的图」
 *   ③「我需要修改器+云存档的固定显示五个的，而不是如果一边只有一个那个卡片大小就变小了」
 *   ④「同分类更多的卡片我需要统一大小，而不是为了完整显示图片而拉长（按比例缩放图片比较好吧），
 *      且最好是显示8个」
 *
 * 为什么四条都要静态守卫 —— 它们**每一条都是「改回去没人发现」**那种改动：
 *   ① 把小条改回位移+过渡（看着更"精致"）⇒ 症状原样复发，但没有任何断言会红；
 *   ② cover 的优先级是**两个同名字段的先后**，对调一个词就变回糊图；
 *   ③ `.d-pair` 一个 `align-items` 的词，加上 `.d-rows` 一行 min-height，删任一个都退化；
 *   ④ `slice(0, 8)` / `object-fit:cover` 都是单字面量，改回去丝毫不报错。
 *
 * ★ 判据写法（本项目铁律）：
 *   · 锚点**收窄到被守护的规则体 / 函数体**，不裸写整份源码
 *     （裸写 `/align-items:stretch/` 能命中别处的 flex 声明 ⇒ 改回 start 也照样绿 = 假绿）；
 *   · `ruleOf()` 返回的是**规则体、不含选择器**，所以反向断言不能写
 *     `!/\.d-mini\{[^}]*transform:/`（规则体里永远没有选择器，那种写法恒真）；
 *   · 每条新机制都配一条**反向断言**（「不许再出现…」）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const IDX = rd('public/index.html');
const EMU = rd('public/emulator.html');
const UNP = rd('public/unpack.html');

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  — ' + extra : '')); }
  else { fail++; console.log('  × FAIL  ' + name + (extra ? '  — ' + extra : '')); }
};

/* 取 CSS 规则体（`sel{...}` 里的 ...）。取不到返回空串 ⇒ 依赖它的断言会红，
   而不是「取不到还判真」的假绿。 */
const ruleOf = (src, sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(esc + '\\s*\\{([^}]*)\\}').exec(src);
  return m ? m[1] : '';
};
/* 取函数体（从 `function NAME(` 到下一个行首 `}`）。 */
const fnBody = (name, src) => {
  const s = src === undefined ? IDX : src;
  const m = new RegExp('function ' + name + '\\s*\\([\\s\\S]*?\\n\\}').exec(s);
  return m ? m[0] : '';
};
/* 取 :root 里的变量声明表。 */
const ROOTVARS = (/:root\{([\s\S]*?)\}/.exec(IDX) || ['', ''])[1];

/* ============================================================
 *  ① 顶部大图 / 小标题条：不再有动画，且阈值 = 大图整块离开
 * ============================================================ */
console.log('\n=== ① 顶图无动画 + 阈值 = 大图整块离开视口 ===');
{
  const mini = ruleOf(IDX, '.d-mini');
  ok(mini.length > 0, '能取到 .d-mini 规则体');
  /* ⚠️ 下面是**规则体**，不含选择器 —— 反向断言必须直接判规则体自身。 */
  ok(!/transform:/.test(mini), '★★ 反向断言：小条不再做位移（用户口径「不要动画了」）');
  ok(!/transition:/.test(mini), '★★ 反向断言：小条不留 transition（有过渡就有「闪」）');
  ok(!/@keyframes|animation:/.test(mini), '★★ 反向断言：小条也没有 keyframes 动画');
  ok(/visibility:hidden/.test(mini), '★ 未激活时靠 visibility 隐藏（不靠改高度、不靠移到屏外）');
  ok(/opacity:0/.test(mini), '未激活时同时透明（切 visibility 才看得见的是同一帧）');
  ok(/position:sticky/.test(mini) && /top:0/.test(mini), '★ 仍是 sticky 吸顶');

  const on = ruleOf(IDX, '.d-mini.on');
  ok(on.length > 0, '有 .d-mini.on 激活态规则');
  ok(/visibility:visible/.test(on), '★ 激活态把 visibility 打开');
  ok(!/transform:/.test(on) && !/transition:/.test(on), '★★ 激活态也不加位移/过渡（否则又变成"切完再动一下"）');

  /* 小条高度必须与负 margin 同值：不同值就在 250px 处额外顶出一块，正文整体位移。 */
  const hm = mini.match(/(?:^|;)\s*height:\s*(\d+)px/);
  const nm = mini.match(/margin-bottom:\s*-(\d+)px/);
  ok(!!hm && !!nm && hm[1] === nm[1],
    '★ 高度与负 margin 同值 ⇒ 不占文档流（不同值会在 250px 处再顶出一块）',
    hm && nm ? `height:${hm[1]} / margin-bottom:-${nm[1]}` : '取不到');

  /* ★ 阈值：本次「忽大忽小」的**第一条**根因。
     旧值 `hero.offsetHeight - 62 + 12` = 200 < 大图高 250 ⇒ 大图还没走完小条就显形，
     屏上同时有大标题和小标题两个游戏名（实测 41 点扫描里能扫到重叠）。 */
  const spy = fnBody('dHeroSpy');
  ok(spy.length > 0, '★ 能取到 dHeroSpy() 函数体（阈值逻辑的锚点）');
  ok(/const on = Math\.max\(60, hero\.offsetHeight\)/.test(spy),
    '★★ 激活阈值 = 大图高度（不是「大图高 − 小条高 + 12」那种早阈值）');
  ok(!/offsetHeight\s*-\s*62/.test(spy),
    '★★ 反向断言：不再出现「offsetHeight − 62」的早阈值算式（只声明不引用 = 没生效的反面）');
  ok(/y >= on/.test(spy),
    '★★ 上侧用 `>=`：阈值恰等于大图高，写 `>` 会把「大图刚离开」那一帧漏掉（实测晚 10px 才显形）');
  ok(!/y > on/.test(spy), '★★ 反向断言：不写 `y > on`');
  ok(/const off = Math\.max\(24, on - MINI_GAP\)/.test(spy), '★ 下侧滞后带 = on − MINI_GAP（防触控板在临界点手抖）');
  ok(/const MINI_GAP = 24;/.test(IDX), '★ MINI_GAP = 24（原 50 会让小条在"已脱离吸顶"的位置继续浮一段）');
  ok(/classList\.contains\('on'\)/.test(spy),
    '★ 状态存在 DOM class 上（#dMini 换游戏时整块重建 ⇒ 天然复位；存变量会残留）');
  ok(/next === cur/.test(spy) || /if \(next === cur\)/.test(spy), '★ 状态没变就不写 DOM（省一次 style 计算）');

  /* 大图与列表封面同源 → 见 ② */
}

/* ============================================================
 *  ② 置顶图 = 列表展示的那张（库内封面优先）
 * ============================================================ */
console.log('\n=== ② 置顶图与列表同源 ===');
{
  const paint = fnBody('paintDetail');
  ok(paint.length > 0, '★ 能取到 paintDetail() 函数体');
  ok(/const cover = fb\.cover \|\| d\.cover \|\| '';/.test(paint),
    '★★ 库内封面优先（用户在列表上看到的那张 = 他要的那张）');
  ok(!/const cover = d\.cover \|\| \(fb && fb\.cover\)/.test(paint),
    '★★ 反向断言：不再优先取 d.cover（XDGAME 详情图是 128×128 方图，铺进 720×250 顶图 = 糊成色块）');

  /* 小条的缩略图必须与顶图同一张 —— 否则滚过大图那一下缩略图和上一秒的大图不是一张图。 */
  const drag = (/<div class="d-mini" id="dMini">([\s\S]*?)<\/div>/.exec(paint) || ['', ''])[1];
  ok(drag.length > 0, '能取到 #dMini 的模板段');
  ok(/<img src="\$\{esc\(cover\)\}"/.test(drag),
    '★ 小条缩略图复用同一个 `cover` 变量（不是另取一份 ⇒ 不会"大图是 Steam header、小图是方图"）');
  ok(!/d\.cover/.test(drag), '★★ 反向断言：小条模板里不出现独立的 d.cover 取值');
}

/* ============================================================
 *  ③ 修改器 + 云存档：固定 5 行槽位、两卡永远等高
 * ============================================================ */
console.log('\n=== ③ 修改器 + 云存档「固定显示五个」 ===');
{
  /* 行槽位变量在 :root 一处定义 */
  for (const [v, why] of [
    ['--d-row-h', '单行槽位高（32.7px 行高 + 4px 间距 ≈ 36.7px）'],
    ['--d-rows', '两侧各固定预留的行数'],
  ]) {
    ok(new RegExp(v + '\\s*:').test(ROOTVARS), '定义了 ' + v + '（' + why + '）');
  }
  ok(/--d-rows\s*:\s*5/.test(ROOTVARS), '★★ --d-rows = 5（用户口径「固定显示五个」）');

  /* 变量必须真的被引用 —— 只定义不引用 = 规范没生效（v10.30 的 :root 断言就是在防这个）。 */
  ok(/\.d-rows\{min-height:calc\(var\(--d-row-h\) \* var\(--d-rows\)\)\}/.test(IDX),
    '★★ .d-rows 的 min-height **真的引用**这两个变量（只定义不引用 = 假接口）');
  const rows = ruleOf(IDX, '.d-rows');
  ok(rows.length > 0 && /min-height:calc\(/.test(rows), '能取到 .d-rows 且带 min-height');

  /* 两卡等高：只有 stretch + 固定预留同时成立，才既「一样大」又「都占五行」。 */
  const pair = ruleOf(IDX, '.d-pair');
  ok(/display:grid/.test(pair), '.d-pair 是 grid');
  ok(/grid-template-columns:1fr 1fr/.test(pair), '两列等宽 = 同行（v10.28 是 display:block，两块上下堆）');
  ok(/align-items:stretch/.test(pair),
    '★★ 两卡**等高**（用户口径「而不是如果一边只有一个那个卡片大小就变小了」）');
  ok(!/align-items:start/.test(pair),
    '★★ 反向断言：.d-pair 不再 align-items:start（v10.29 的"各自按内容收"已作废）');
  ok(/\.d-pair>div>\.d-blk\{margin-bottom:0;/.test(IDX), '卡片的 margin-bottom 在 grid 里去掉（否则两列底部不齐）');
  ok(/\.d-pair \.d-hint2\{margin-top:auto\}/.test(IDX),
    '★★ 预留出来的空档不能把提示顶在半空 ⇒ 提示沉到卡底（否则看着像两块内容）');
  ok(/@media\(max-width:760px\)\{\.d-pair\{grid-template-columns:1fr\}\}/.test(IDX),
    '窄屏回落单列（并排后每块只剩 ~150px，路径会被挤成三四个字一行）');

  /* 槽位类必须真的套在模板上：只定义 CSS 类、不写进 innerHTML = 样式永远不生效。 */
  const tr = (/async function loadTrBlock\([\s\S]*?\n\}/.exec(IDX) || [''])[0];
  const sv = (/async function loadSvBlock\([\s\S]*?\n\}/.exec(IDX) || [''])[0];
  ok(/<div class="d-rows">/.test(tr), '★★ 修改器模板真的套了 .d-rows（不是只写了 CSS 类）');
  ok(/<div class="d-rows d-sv">/.test(sv), '★★ 云存档模板真的套了 .d-rows（保留 d-sv 自己的行样式）');
  ok(/const MAXTR = 5;/.test(tr) && /items\.slice\(0, MAXTR\)/.test(tr),
    '★ 修改器上限 5 且真的用在 slice 上（只声明常量不引用 = 没生效）');
}

/* ============================================================
 *  ④ 同分类更多：卡片一样大 + 按比例缩放 + 8 个
 * ============================================================ */
console.log('\n=== ④ 同分类更多：统一大小 / contain / 8 个 ===');
{
  const img = ruleOf(IDX, '.rel-row .rel-it img,.rel-row .rel-it .noimg');
  ok(img.length > 0, '能取到同类游戏卡的图片槽规则体');
  ok(/aspect-ratio:var\(--th-ar\)/.test(img), '★ 槽位比例走 --th-ar（定高不定比例 ⇒ 比例随卡片宽漂移）');
  /* ★ contain 是唯一同时满足「卡片一样大」+「按比例缩放」的取值：
     本族封面两种原生比例混排（机地 140×140 方图 / Steam header 460×215≈2.14）。
     cover ⇒ 方图上下被裁（实测「黄金之心」标题整条没了）；fill ⇒ 方图被拉扁。 */
  ok(/object-fit:contain/.test(img), '★★ 图片 contain（按比例缩放，用户口径「按比例缩放图片比较好吧」）');
  ok(!/object-fit:cover/.test(img), '★★ 反向断言：同类游戏卡不再用 cover');
  ok(!/height:\d+px/.test(img), '★★ 反向断言：图片槽里没有硬编码 px 高度（那就会为了显示完整而拉长）');
  ok(/height:auto/.test(img), '★ 高度交给 aspect-ratio 推');

  /* 展示张数只认一个常量：裸字面量散在多处，改一处漏一处。 */
  ok(/const REL_SHOW = 8;/.test(IDX), '★★ 新增 REL_SHOW = 8（用户口径「最好是显示8个」）');
  const rel = fnBody('loadRelated');
  ok(rel.length > 0, '★ 能取到 loadRelated() 函数体');
  ok(/\.slice\(0, REL_SHOW\)/.test(rel), '★★ 展示条数真的引用 REL_SHOW（只声明不引用 = 没生效）');
  ok(!/\.slice\(0, 8\)/.test(rel), '★★ 反向断言：loadRelated 里不再有裸 `slice(0, 8)`');
  /* ★ 「取数 > 展示」必须**真的比出数值关系**，而不是只断言源码里写着 'limit=12'
     （那种断言名 over-claim：说测「12 > 8」，其实只测了一个字符串常量存在）。 */
  const limN = Number((/const qs = 'limit=(\d+)'/.exec(rel) || [])[1]);
  const showN = Number((/const REL_SHOW = (\d+);/.exec(IDX) || [])[1]);
  ok(limN > showN, '★ 取数 > 展示数（下面还要滤掉无 url 的、滤掉自身回环，取数不够会让实际张数掉到 5~7）',
    `limit=${limN} > REL_SHOW=${showN}`);
  ok(/\.filter\(it => it && it\.url && it\.url !== d\.url\)/.test(rel),
    '★ 两道过滤仍在（无详情页 url 的 / 与本条同 url 的自身回环）');
}

/* ============================================================
 *  ⑤ 派生页同步（改主源不重建 = 悄悄漂移）
 * ============================================================ */
console.log('\n=== ⑤ 派生页同步 ===');
{
  for (const [pg, t] of [['emulator.html', EMU], ['unpack.html', UNP]]) {
    ok(/--d-row-h\s*:/.test(t), '  ' + pg + ' 已同步行槽位变量');
    ok(/\.d-rows\{min-height:calc\(var\(--d-row-h\)/.test(t), '  ' + pg + ' 已同步 .d-rows 预留');
    ok(/align-items:stretch/.test(ruleOf(t, '.d-pair')), '  ' + pg + ' 已同步 .d-pair 等高');
    ok(!/transform:/.test(ruleOf(t, '.d-mini')), '  ' + pg + ' 小条也无位移');
    ok(/object-fit:contain/.test(ruleOf(t, '.rel-row .rel-it img,.rel-row .rel-it .noimg')),
      '  ' + pg + ' 已同步 contain');
    ok(/const REL_SHOW = 8;/.test(t), '  ' + pg + ' 已同步 REL_SHOW');
  }
}

console.log('\n============================');
console.log(`  通过 ${pass}/${pass + fail}（失败 ${fail}）`);
console.log('============================');
process.exit(fail ? 1 : 0);
