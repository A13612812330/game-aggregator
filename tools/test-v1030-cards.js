#!/usr/bin/env node
/* tools/test-v1030-cards.js — v10.30 卡片统一规范 + 顶图小标题条（静态防线）
 *
 * 守两件事：
 *   ★ 卡片统一规范：缩略图比例（16:9）／卡片圆角（--cd-r）／缩略图圆角（--cd-th-r）／
 *     标题固定预留两行 —— 这次改造的**每一条都是「删了没人发现」**那种：
 *       · `.rel-it` 只写 flex-basis 不写 min-width ⇒ 被长标题撑开（实测 106 vs 123.2）
 *       · 缩略图只定高不定比例 ⇒ 比例随卡片宽度漂移（实测 1.571~1.879）
 *       · 标题只 clamp 不 min-height ⇒ 短标题卡片矮一截，卡片不等高
 *       · 骨架屏不同步 ⇒ 加载完成的那一瞬卡片高度跳一截
 *   ★ 顶图小标题条：大图定高不 sticky / 小条恒 62px 且负 margin 不占流 / 双阈值 + rAF。
 *
 * 判据写法说明：断言名**逐条可见**（输出里看得见每条在测什么），
 * 并且大量使用**反向断言**（「不许再有 height:56px」「不许再用 nowrap」）——
 * 这类断言才能挡住「改回去了但测试照样绿」。
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

/* 取某条 CSS 规则的 body（`sel{...}` 里的 ...）。取不到返回空串 ⇒ 依赖它的断言会红，
   而不是「静默为真」（取不到还判真 = 假绿）。 */
const ruleOf = (src, sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(esc + '\\s*\\{([^}]*)\\}').exec(src);
  return m ? m[1] : '';
};

/* ============================================================
 *  ① 卡片统一规范：变量在一处定义
 * ============================================================ */
console.log('\n=== ① 卡片统一规范（:root 变量） ===');
{
  for (const [v, why] of [
    ['--cd-r', '卡片圆角'],
    ['--cd-th-r', '缩略图圆角'],
    ['--cd-lh', '标题行高'],
    ['--cd-t2', '标题两行高度'],
    ['--th-ar', '缩略图比例'],
    ['--cd-s', '同类游戏小卡宽度'],
  ]) {
    ok(new RegExp(v + '\\s*:').test(IDX), '定义了 ' + v + '（' + why + '）');
  }
  const root = /:root\{([\s\S]*?)\}/.exec(IDX);
  ok(!!root && /--th-ar\s*:\s*16\s*\/\s*9/.test(root[1]), '★ 缩略图比例定死 16/9');
  ok(!!root && /--cd-t2\s*:\s*2\.8em/.test(root[1]),
    '★ 标题两行高度 = 2 × --cd-lh(1.4)（写成别的值就不是「预留两行」了）');
  ok(!!root && /--cd-s\s*:\s*106px/.test(root[1]), '同类游戏小卡固定 106px');
  /* ★ 变量必须真的被 *用* 上：只定义不引用 = 规范写了但没生效 */
  const uses = (k) => (IDX.match(new RegExp('var\\(' + k + '\\)', 'g')) || []).length;
  for (const v of ['--cd-r', '--cd-th-r', '--th-ar', '--cd-t2']) {
    ok(uses(v) >= 3, '★ ' + v + ' 被引用 ≥3 处（只定义不用 = 规范没生效）', '实际 ' + uses(v) + ' 处');
  }
}

/* ============================================================
 *  ② 同类游戏卡（用户点名「同类游戏」）
 * ============================================================ */
console.log('\n=== ② 同类游戏卡 .rel-it ===');
{
  const it = ruleOf(IDX, '.rel-row .rel-it');
  ok(it.length > 0, '能取到 .rel-it 规则体');
  ok(/flex:0 0 var\(--cd-s\)/.test(it), 'flex-basis 走 --cd-s');
  ok(/min-width:var\(--cd-s\)/.test(it),
    '★★ min-width 也锁定（flex item 默认 min-width:auto 会被 nowrap 长标题撑开 —— 实测同族量到 106 与 123.2 两个宽度）');
  ok(/max-width:var\(--cd-s\)/.test(it), 'max-width 也锁定（三重锁，任一缺失都可能被撑开）');
  ok(/border-radius:var\(--cd-r\)/.test(it), '卡片圆角走 --cd-r');
  ok(/overflow:hidden/.test(it), '卡片裁掉溢出');

  const img = ruleOf(IDX, '.rel-row .rel-it img,.rel-row .rel-it .noimg');
  ok(/aspect-ratio:var\(--th-ar\)/.test(img),
    '★ 缩略图用 --th-ar 定比例（原 width:100%;height:56px 是「定高不定比例」，实测比例漂到 1.571~1.879）');
  ok(/border-radius:var\(--cd-th-r\)/.test(img), '缩略图圆角走 --cd-th-r');
  ok(!/height:56px/.test(img), '★★ 反向断言：不再有硬编码 height:56px');
  ok(/height:auto/.test(img), '★ 高度交给 aspect-ratio 推（留 height 会压过比例）');

  const t = ruleOf(IDX, '.rel-row .rel-it .t');
  ok(/-webkit-line-clamp:2/.test(t), '★ 标题 2 行封顶');
  ok(/min-height:var\(--cd-t2\)/.test(t),
    '★★ 标题固定**预留**两行（只 clamp 不 min-height ⇒ 短标题卡片矮一截，卡片不等高）');
  ok(!/white-space:nowrap/.test(t), '★★ 反向断言：标题不再用 nowrap 单行截断');
}

/* ============================================================
 *  ③ 跨源链接卡（用户点名「链接标题」）
 * ============================================================ */
console.log('\n=== ③ 跨源链接卡 .x-it ===');
{
  const it = ruleOf(IDX, '.x-src .x-it');
  ok(it.length > 0, '能取到 .x-it 规则体');
  ok(/border-radius:var\(--cd-r\)/.test(it), '卡片圆角走 --cd-r');

  const t = ruleOf(IDX, '.x-src .x-it .bd .t');
  ok(/-webkit-line-clamp:2/.test(t), '★ 链接标题 2 行封顶');
  ok(/min-height:var\(--cd-t2\)/.test(t), '★ 固定预留两行');
  ok(!/white-space:nowrap/.test(t), '★★ 反向断言：不再用 nowrap 截断（原来 646×37 的长标题被切掉）');

  const bd = ruleOf(IDX, '.x-src .x-it .bd');
  ok(!/white-space:nowrap/.test(bd),
    '★★ 父级 .bd 也不许 nowrap —— 父级 nowrap 会压住子元素的 -webkit-line-clamp（子元素 clamp 生效但父级不换行，等于没改）');
}

/* ============================================================
 *  ④ 其余卡片族：缩略图比例 + 圆角 + 标题两行，一个都不能漏
 * ============================================================ */
console.log('\n=== ④ 其余卡片族一致性 ===');
{
  for (const [sel, label] of [
    ['.row-card .th', '搜索结果缩略图'],
    ['.sm-row img', '搜索行缩略图'],
    ['.rk-card .th', '排行缩略图'],
  ]) {
    const b = ruleOf(IDX, sel);
    ok(b.length > 0, '能取到 ' + sel + ' 规则体');
    ok(/aspect-ratio:var\(--th-ar\)/.test(b), label + ' 用 --th-ar 定比例');
    ok(/border-radius:var\(--cd-th-r\)/.test(b), label + ' 圆角走 --cd-th-r');
    ok(!/height:\d+px/.test(b), '★★ ' + label + ' 反向断言：不许再有硬编码高度');
  }
  ok(/aspect-ratio:var\(--th-ar\)/.test(ruleOf(IDX, '.sm-row .ph2')),
    '★ 搜索行占位块 .ph2 与图片同步（只改 img 不改 ph2 ⇒ 有图/无图两行高度不同）');

  for (const [sel, label] of [
    ['.row-card h3', '搜索结果标题'],
    ['.sm-row .t', '搜索行标题'],
    ['.rk-card .bd .t', '排行标题'],
  ]) {
    const b = ruleOf(IDX, sel);
    ok(b.length > 0, '能取到 ' + sel + ' 规则体');
    ok(/-webkit-line-clamp:2/.test(b), label + ' 2 行封顶');
    /* ★ 判据必须**带值**，不能只判「有 min-height」：
       `min-height:0` 也满足 `/min-height:/`，等于这条断言什么也没守。
       （反证用例 ⑥ 起初就是这么写的，打坏后照样绿 —— 才发现是假绿。）
       本项目只认两种写法：--cd-t2（卡片族通用）与 2.6em（搜索行密度优先）。 */
    ok(/min-height:var\(--cd-t2\)|min-height:2\.6em/.test(b),
      label + ' 固定预留两行**且值合规**（min-height:0 不算预留）',
      (b.match(/min-height:[^;]*/) || ['(无 min-height)'])[0]);
    ok(!/white-space:nowrap/.test(b), '★★ ' + label + ' 反向断言：不许 nowrap');
  }

  /* 卡片圆角：凡是「卡片」都要走 --cd-r
     ★ 骨架屏容器也在内 —— 它是真卡片的**加载态替身**，圆角不同就会在加载完成的一瞬跳一档。
       （反证用例 ⑧ 就是打它，起初没被任何断言覆盖。） */
  for (const [sel, label] of [
    ['.rel-row .rel-it', '同类游戏卡'],
    ['.x-src .x-it', '跨源链接卡'],
    ['.row-card', '搜索结果卡'],
    ['.rk-card', '排行卡'],
    ['.sm-row', '搜索行'],
    ['.emu-card', '模拟器/修改器卡'],
    ['.skeleton', '骨架屏容器'],
  ]) {
    ok(/border-radius:var\(--cd-r\)/.test(ruleOf(IDX, sel)), label + ' 卡片圆角走 --cd-r');
  }

  /* 骨架屏必须跟真卡片同比例，否则加载完成的一瞬高度会跳 */
  const sk = (IDX.match(/\.skeleton \.sk-th\{width:\d+px;height:auto;aspect-ratio:var\(--th-ar\)/g) || []).length;
  ok(sk === 3, '★★ 三处断点的骨架屏缩略图都同步了（不同步 ⇒ 加载完成时卡片跳一截）', '实际 ' + sk + '/3');
}

/* ============================================================
 *  ⑤ 顶图小标题条（静态部分；实拍判据在 preview-v1030.js）
 * ============================================================ */
console.log('\n=== ⑤ 顶图小标题条 ===');
{
  const hero = ruleOf(IDX, '.d-hero');
  ok(/position:relative/.test(hero), '★ 大图不再 sticky（布局不再反过来影响 scrollTop）');
  ok(!/transition:height/.test(hero), '★★ 反向断言：大图不许再有 height 过渡（高度变化 = 自激振荡的来源）');
  ok(/height:250px/.test(hero), '大图定高 250px');

  const mini = ruleOf(IDX, '.d-mini');
  ok(mini.length > 0, '能取到 .d-mini 规则体');
  ok(/position:sticky/.test(mini) && /top:0/.test(mini), '小标题条 sticky 吸顶');
  ok(/height:62px/.test(mini), '小条恒高 62px');
  ok(/margin-bottom:-62px/.test(mini), '★★ 负 margin 不占文档流（不加 ⇒ 正文整体下移 62px）');
  ok(/transform:translateY\(-102%\)/.test(mini), '★ 未激活时靠 transform 收在上方（不靠改高度）');
  ok(/pointer-events:none/.test(mini), '未激活时不吃点击');
  ok(/-62px/.test(mini), '负 margin 与小条高度同值（改一个忘一个 ⇒ 正文错位）');

  const on = ruleOf(IDX, '.d-mini.on');
  ok(on.length > 0, '有 .d-mini.on 激活态规则');

  /* 关闭键必须**再给一份**：大图滚走后原关闭键跟着走了 */
  ok(/id="dMini"/.test(IDX) && /closeBtnHtml\(\)/.test(IDX),
    '★ 小条里带一份关闭键（大图滚走后原关闭键跟着走，没有它用户关不掉抽屉）');
  const miniTpl = (/<div class="d-mini" id="dMini">([\s\S]*?)<\/div>/.exec(IDX) || ['', ''])[1];
  ok(/closeBtnHtml\(\)/.test(miniTpl), '★ 关闭键确实在小条模板**内部**（不是只调了一次给大图用）');
}

/* ============================================================
 *  ⑥ 派生页同步（改主源不重建派生页**不报错**，只悄悄漂移）
 * ============================================================ */
console.log('\n=== ⑥ 派生页同步 ===');
{
  for (const [pg, t] of [['public/emulator.html', EMU], ['public/unpack.html', UNP]]) {
    ok(/--th-ar\s*:\s*16\s*\/\s*9/.test(t), '  ' + pg + ' 已同步规范变量');
    ok(/aspect-ratio:var\(--th-ar\)/.test(t), '  ' + pg + ' 已同步缩略图比例');
    ok(/min-height:var\(--cd-t2\)/.test(t), '  ' + pg + ' 已同步「预留两行」标题');
    ok(/\.d-mini\{[^}]*position:sticky/.test(t), '  ' + pg + ' 已同步小标题条');
  }
}

console.log('\n============================');
console.log('  通过 ' + pass + '/' + (pass + fail) + '（失败 ' + fail + '）');
console.log('============================');
process.exit(fail ? 1 : 0);
