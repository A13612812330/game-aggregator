#!/usr/bin/env node
/**
 * test-v1089-fg-parts-ui.js — FitGirl 下载源 UI 的渲染判据（v10.92 改判）
 *
 * 【v10.92 契约变更】行内「▸ 分卷清单」→「⬇ 直链下载」弹窗。
 *   用户口径：「将 FitGirl 的源整理成只显示直链下载 + 磁力链下载按钮」。
 *   原实现把 `.fgp` 块插在列表行下方（48 卷会把弹窗顶到几千像素，且滚动位置乱跳）；
 *   现在改为独立弹窗（#fgDl，z-index 120），正文由 `fgDlBodyHtml(j)` 生成。
 *   ⇒ 断言对象从 `fgPartsHtml` 换成 `fgDlSetHtml` + `fgDlBodyHtml` + `fgDlFootHtml`，
 *     **验的东西没变**：给定回包 → 生成什么 HTML，三类形态不能混、外部字段必须转义、
 *     退化输入不许抛、warnings 不许吞。
 *
 * ★ 为什么还坚持「抽纯函数 + new Function 执行」而不是读源码正则：
 *   源码里有没有 `esc(` 这七个字符，和「用户输入真的被转义了」是两件事。
 *   上一轮就踩过「判据写了引号位置 → 永远为假」的假绿（见 v10.90 踩坑表）。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

let pass = 0, fail = 0; const fails = [];
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  — ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  × FAIL  ' + name + (extra ? '  — ' + extra : '')); }
}

/** 从 index.html 里按括号配对抽出顶层 `function NAME(` 的完整源码 */
function grabFn(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) return null;
  let i = src.indexOf('{', at), depth = 0;
  for (let p = i; p < src.length; p++) {
    if (src[p] === '{') depth++;
    else if (src[p] === '}') { depth--; if (depth === 0) return src.slice(at, p + 1); }
  }
  return null;
}

const fEsc = grabFn(HTML, 'esc') || (() => {
  /* esc 在主源里是箭头常量（`const esc = (s) => …`），不是 function 声明 ⇒ 单行抓取 */
  const m = HTML.match(/const esc = \(s\) => [^\n]+/);
  return m ? m[0] : null;
})();
const FNS = ['fgDlCurHost', 'fgDlUrls', 'fgDlSetHtml', 'fgDlBodyHtml', 'fgDlFootHtml'].map((n) => grabFn(HTML, n));

ok(!!fEsc, 'S1 抽到 esc()');
ok(!!FNS[2], 'S2 抽到 fgDlSetHtml()（单组渲染）');
ok(!!FNS[3] && !!FNS[4], 'S3 抽到 fgDlBodyHtml() / fgDlFootHtml()（纯函数，不碰 DOM）');

let lib = {};
try {
  /* FGD 是模块级状态（当前镜像 / 展开态），测试里注入一个可控副本 */
  const decl = 'var FGD = { data: null, host: {}, open: {} };';
  /* eslint-disable no-new-func */
  lib = new Function(
    fEsc + '\n' + decl + '\n' + FNS.join('\n')
    + '\nreturn { esc, FGD, fgDlSetHtml, fgDlBodyHtml, fgDlFootHtml };'
  )();
} catch (e) {
  ok(false, 'S4 五个函数可独立执行', String(e.message).slice(0, 90));
}
const { fgDlBodyHtml, fgDlFootHtml } = lib;

/* ---------- fixture：一主包两站 + 一个变体 + 一个可选 ----------
 * ★ byHost 必须填：新版「复制全部 N 条」用的是**该镜像下的实际条数**，
 *   不是 set.parts 的声明值 —— 两者在真实回包里应当相等，fixture 也要如实。
 *   （这条是 v10.92 自己踩的：旧 fixture 的变体 byHost 为空，照抄过来会显示「复制全部 0 条」。） */
function parts(host, n, name) {
  return Array.from({ length: n }, (_, i) => ({
    url: 'https://' + host + '/id' + i + '/' + name + '.part' + String(i + 1).padStart(2, '0') + '.rar',
    name: name + '.part' + String(i + 1).padStart(2, '0') + '.rar',
    part: i + 1,
  }));
}
const INLINE = {
  ok: true, mode: 'inline', cached: false,
  stats: { mainParts: 3, setsTotal: 3 },
  warnings: [],
  containers: [],
  sets: [
    {
      prefix: 'Ready_or_Not_--_', label: 'Ready or Not', kind: 'main', parts: 3, count: 6,
      hosts: ['datanodes.to', 'fuckingfast.co'],
      byHost: { 'datanodes.to': parts('datanodes.to', 3, 'p'), 'fuckingfast.co': parts('fuckingfast.co', 3, 'p') },
    },
    {
      prefix: 'Ready_or_Not_U', label: 'Ready or Not <b>UNCENSORED</b>', kind: 'variant', parts: 13, count: 13,
      hosts: ['datanodes.to'], byHost: { 'datanodes.to': parts('datanodes.to', 13, 'u') },
    },
    {
      prefix: 'fg-optional-bonus', label: '可选附件 · bonus soundtrack', kind: 'optional', parts: 1, count: 1,
      hosts: ['filekeeper.net'], byHost: { 'filekeeper.net': parts('filekeeper.net', 1, 'ost') },
    },
  ],
};

console.log('\n-- A. inline 形态 --');
lib.FGD.data = INLINE; lib.FGD.host = {}; lib.FGD.open = {};
const h = fgDlBodyHtml(INLINE);
ok(/class="fgdl-set"/.test(h), 'A1 生成 .fgdl-set 分组');
ok((h.match(/class="fgdl-set"/g) || []).length === 3, 'A2 三组各一块',
  String((h.match(/class="fgdl-set"/g) || []).length));
ok(/主包/.test(h) && /变体/.test(h) && /可选/.test(h), 'A3 三类标签齐全');
ok(/复制全部 3 条/.test(h), 'A4 主包按该镜像实际条数给按钮（3 条）');
ok(/复制全部 13 条/.test(h), 'A5 变体按自己卷数给按钮（不串组）');
ok(/data-h="datanodes\.to"/.test(h) && /data-h="fuckingfast\.co"/.test(h), 'A6 镜像按钮带真实域名');
ok(/class="fgdl-mir"/.test(h), 'A7 多站组出镜像切换条');
ok(/data-fgcopy="0"/.test(h) && /data-fgcopy="2"/.test(h), 'A8 每组复制入口带组序号（复制时定位用）');
ok(/data-fglist="0"/.test(h), 'A9 分卷列表可展开（48 卷默认不铺满弹窗）');
/* ★ A10 的正确口径：**每组只渲染当前镜像那一份**（3 + 13 + 1 = 17），
 *   不是三站合计（那会是 3×2 + 13 + 1 = 20），也不要误以为「未展开 = 没渲染」——
 *   `hidden` 只是不显示，DOM 仍在（展开时不必重渲染）。 */
ok((h.match(/class="fgdl-p"/g) || []).length === 17,
  'A10 条目 = 三组当前镜像之和（3+13+1=17），不是三站合计',
  String((h.match(/class="fgdl-p"/g) || []).length));
ok(!/https:\/\/fuckingfast\.co\/id/.test(h), 'A10b 非当前镜像的链接不渲染（不把三站铺成三倍）');
ok(!/<b>UNCENSORED<\/b>/.test(h) && /&lt;b&gt;UNCENSORED/.test(h),
  'A11 组名里的 <b> 被转义（组名来自 FitGirl 页面，是外部输入）');

console.log('\n-- B. 页脚摘要 --');
const f = fgDlFootHtml(INLINE);
ok(/3 组 · 主包 3 卷（单站口径）/.test(f), 'B1 用 stats.mainParts，不是三站合计', f.slice(0, 60));
ok(/现抓/.test(f), 'B2 未命中缓存时写「现抓」（不谎称缓存）');
ok(/现抓/.test(fgDlFootHtml({ sets: [], stats: {}, cached: false })), 'B3 空回包也不抛');

console.log('\n-- C. container 形态 --');
lib.FGD.data = null; lib.FGD.host = {};
const c = fgDlBodyHtml({
  ok: true, mode: 'container', cached: true, sets: [], stats: {}, warnings: [],
  containers: [{ host: 'filecrypt.cc', url: 'https://filecrypt.cc/Container/ABC.html' }],
});
ok(/镜像清单页/.test(c), 'C1 写明这是清单页形态（不谎称有分卷）');
ok(/filecrypt\.cc/.test(c) && /Container\/ABC\.html/.test(c), 'C2 给出清单页外链');
ok(!/class="fgdl-set"/.test(c), 'C3 不渲染任何分卷组（没有就是没有）');

console.log('\n-- D. 退化输入不许抛 --');
let threw = null;
try { fgDlBodyHtml({ ok: true, mode: 'inline' }); } catch (e) { threw = e; }
ok(!threw, 'D1 sets/stats/warnings 全缺也不抛', threw ? threw.message : '');
let threw2 = null;
try { fgDlBodyHtml({ ok: true, mode: 'inline', sets: [], stats: {}, warnings: ['镜像卷数不一致'] }); } catch (e) { threw2 = e; }
ok(!threw2, 'D2 空 sets 不抛');
ok(/镜像卷数不一致/.test(fgDlBodyHtml({ ok: true, mode: 'inline', sets: [], stats: {}, warnings: ['镜像卷数不一致'] })),
  'D3 空 sets 时 warnings 也要显示（有警告 ≠ 什么都没有）');
let threw3 = null;
try { fgDlBodyHtml(null); } catch (e) { threw3 = e; }
ok(!threw3, 'D4 null 回包不抛（取数失败时页面不能白屏）');

console.log('\n-- E. 页面接线 --');
ok(/data-fg-dl="' \+ esc\(it\.slug\)/.test(HTML), 'E1 FitGirl 行有「直链下载」入口（slug 经 esc）');
ok(/class="fgbtn dl"[^>]*>⬇ 直链下载/.test(HTML), 'E2 两个按钮之一：⬇ 直链下载');
ok(/class="fgbtn mg" data-fg-magnet="' \+ esc\(it\.slug\)[^>]*>⧉ 磁力链/.test(HTML), 'E3 两个按钮之二：⧉ 磁力链');
ok(!/data-fg-parts/.test(HTML), 'E4 行内「分卷清单」旧入口已移除（不留两条并行路径）');
ok(/const FG_PARTS = Object\.create\(null\)/.test(HTML), 'E5 回包有前端缓存（换镜像不重复请求）');
ok(/fetch\(api\('\/api\/fitgirl\/parts\?slug='/.test(HTML), 'E6 走带 base 的 api() 拼地址（file:// 也能用）');
ok(/closest\('\[data-fg-dl\]'\)/.test(HTML), 'E7 打开弹窗走事件委托（重绘不重复绑）');
ok(/mode === 'container'/.test(HTML), 'E8 前端也判 container（后端三态直接落到 UI）');
ok(/这篇取不到分卷清单/.test(HTML), 'E9 失败时给可操作提示（不是一句「加载失败」）');
ok(/navigator\.clipboard\.writeText\(txt\)/.test(HTML) && /window\.prompt\('自动复制不可用/.test(HTML),
  'E10 复制有降级通道（非安全上下文可用）');
ok(/#fgDl\{z-index:120\}/.test(HTML), 'E11 弹窗 z-index 压在「下载与资源」(110) 之上');
ok(/if \(fgdl && !fgdl\.hidden\) \{ e\.stopPropagation\(\); fgDlClose\(\); return; \}/.test(HTML),
  'E12 ESC 先关最上层（不会一次关两层）');
ok(/FGD\.slug !== slug\) return/.test(HTML), 'E13 连点两篇时丢弃旧结果（不把 A 的清单画到 B 的标题下）');

console.log('\n-- F. 派生页继承（改主源就必须同步四张）--');
for (const p of ['emulator', 'unpack', 'resources', 'extract']) {
  let s = '';
  try { s = fs.readFileSync(path.join(ROOT, 'public', p + '.html'), 'utf8'); } catch (e) { s = ''; }
  ok(/id="fgDl"/.test(s) && /data-fg-dl/.test(s) && /fgDlOpen/.test(s),
    'F ' + p + '.html 带上同一个直链弹窗');
}

console.log('\n====');
console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) console.log('失败项：\n  - ' + fails.join('\n  - '));
process.exit(fail ? 1 : 0);
