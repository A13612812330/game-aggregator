#!/usr/bin/env node
/**
 * test-v1089-fg-parts-ui.js — v10.89 FitGirl 分卷清单「行内展开」的渲染判据
 *
 * 只验**纯函数** `fgPartsHtml(j)` 的输出（它是整段 UI 里唯一有分支逻辑的地方）：
 *   · inline 形态 → 主包 / 变体 / 可选 三类分组、每组的镜站按钮与「复制全部」入口；
 *   · container 形态 → 不假装有分卷，只给镜像清单页；
 *   · 标题里带 HTML 必须被 esc（分卷组名来自 FitGirl 页面，是**外部输入**）；
 *   · 缺字段（sets 为空 / stats 缺失 / warnings 为空）不许抛异常，页面不能白屏。
 *
 * ★ 为什么不启浏览器：沙箱里 headless 起不来（见 test-resource-page.js 注释），
 *   而这里要验的是「给定回包 → 生成什么 HTML」，`new Function` 抽函数执行最准也最快。
 *   ⚠️ 抽函数用**括号计数**而不是正则到行尾 —— 上一轮有个同类套件用 `.*?}` 把嵌套对象截断，
 *   函数被切成半截却仍然"跑通"，断言全绿但验的是残骸。
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
const fParts = grabFn(HTML, 'fgPartsHtml');
ok(!!fEsc, 'S1 抽到 esc()');
ok(!!fParts, 'S2 抽到 fgPartsHtml()');

let lib = {};
try {
  /* eslint-disable no-new-func */
  lib = new Function(fEsc + '\n' + fParts + '\nreturn { esc, fgPartsHtml };')();
} catch (e) {
  ok(false, 'S3 两个纯函数可独立执行', String(e.message).slice(0, 80));
}
const { fgPartsHtml } = lib;

/* ---------- 内联 fixture：一主包两站 + 一个变体 + 一个可选 ---------- */
const INLINE = {
  ok: true, mode: 'inline', cached: false,
  stats: { mainParts: 3, setsTotal: 3 },
  warnings: [],
  containers: [],
  sets: [
    {
      prefix: 'Ready_or_Not_--_', label: 'Ready or Not', kind: 'main', parts: 3, count: 9,
      hosts: ['datanodes.to', 'fuckingfast.co'],
      byHost: {
        'datanodes.to': [{ url: 'https://datanodes.to/a/p.part1.rar' }, { url: 'https://datanodes.to/b/p.part2.rar' }, { url: 'https://datanodes.to/c/p.part3.rar' }],
        'fuckingfast.co': [{ url: 'https://fuckingfast.co/a/p.part1.rar' }, { url: 'https://fuckingfast.co/b/p.part2.rar' }, { url: 'https://fuckingfast.co/c/p.part3.rar' }],
      },
    },
    { prefix: 'Ready_or_Not_U', label: 'Ready or Not <b>UNCENSORED</b>', kind: 'variant', parts: 13, count: 39, hosts: ['datanodes.to'], byHost: {} },
    { prefix: 'fg-optional-bonus', label: '可选附件 · bonus soundtrack', kind: 'optional', parts: 1, count: 3, hosts: ['filekeeper.net'], byHost: {} },
  ],
};

console.log('\n-- A. inline 形态 --');
const h = fgPartsHtml(INLINE);
ok(/class="fgp"/.test(h), 'A1 生成 .fgp 容器');
ok((h.match(/class="set"/g) || []).length === 3, 'A2 三组各一行',
  String((h.match(/class="set"/g) || []).length));
ok(/主包/.test(h) && /变体/.test(h) && /可选/.test(h), 'A3 三类标签齐全');
ok(/复制全部 3 条/.test(h), 'A4 主包按钮写「复制全部 3 条」（单站卷数，不是 9）');
ok(/复制全部 13 条/.test(h), 'A5 变体按自己卷数给按钮（不串组）');
ok((h.match(/data-h="datanodes\.to"/g) || []).length >= 2, 'A6 有镜站按钮，值为真实域名');
ok(/class="hst"/.test(h), 'A7 多站组出镜站切换条');
ok(/data-s="0"/.test(h) && /data-s="2"/.test(h), 'A8 每组带 data-s 序号（复制时定位用）');
ok(/data-cp="0"/.test(h), 'A9 复制入口带 data-cp');
ok(/3 组 · 主包 3 卷/.test(h), 'A10 头部摘要用 stats.mainParts（单站口径）');

console.log('\n-- B. 转义（分卷组名来自外部页面）--');
ok(!/<b>UNCENSORED<\/b>/.test(h), 'B1 组名里的 <b> 被转义（不注入）');
ok(/&lt;b&gt;UNCENSORED/.test(h), 'B2 转义结果可见（确认真的走了 esc）');

console.log('\n-- C. container 形态 --');
const c = fgPartsHtml({
  ok: true, mode: 'container', cached: true, sets: [], stats: {}, warnings: [],
  containers: [{ host: 'filecrypt.cc', url: 'https://filecrypt.cc/Container/ABC.html' }],
});
ok(/镜像清单页形态/.test(c), 'C1 头部写明是清单页形态（不谎称有分卷）');
ok(/filecrypt\.cc/.test(c) && /Container\/ABC\.html/.test(c), 'C2 给出清单页外链');
ok(!/class="set"/.test(c), 'C3 不渲染任何分卷组（没有就是没有）');

console.log('\n-- D. 退化输入不许抛 --');
let threw = null;
try { fgPartsHtml({ ok: true, mode: 'inline' }); } catch (e) { threw = e; }
ok(!threw, 'D1 sets/stats/warnings 全缺也不抛', threw ? threw.message : '');
let threw2 = null;
try { fgPartsHtml({ ok: true, mode: 'inline', sets: [], stats: {}, warnings: ['镜像卷数不一致'] }); } catch (e) { threw2 = e; }
ok(!threw2, 'D2 空 sets 不抛');
ok(/镜像卷数不一致/.test(fgPartsHtml({ ok: true, mode: 'inline', sets: [], stats: {}, warnings: ['镜像卷数不一致'] })),
  'D3 warnings 如实显示（不吞警告）');

console.log('\n-- E. 页面接线 --');
ok(/data-fg-parts="' \+ esc\(it\.slug\)/.test(HTML), 'E1 FitGirl 行里有「分卷清单」入口（slug 经 esc）');
ok(/const FG_PARTS = Object\.create\(null\)/.test(HTML), 'E2 回包有前端缓存（切站不重复请求）');
ok(/fetch\(api\('\/api\/fitgirl\/parts\?slug='/.test(HTML), 'E3 走带 base 的 api() 拼地址（file:// 也能用）');
ok(/closest\('\[data-fg-parts\]'\)/.test(HTML), 'E4 展开走事件委托（重绘不重复绑）');
ok(/mode === 'container'/.test(HTML), 'E5 前端也判 container（后端三态直接落到 UI）');
ok(/这篇没有可解析的分卷清单/.test(HTML), 'E6 失败时给出可操作提示（不是「加载失败」）');
ok(/navigator\.clipboard\.writeText\(txt\)/.test(HTML) && /window\.prompt\('自动复制不可用/.test(HTML),
  'E7 复制有降级通道（非安全上下文可用）');

console.log('\n====');
console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) console.log('失败项：\n  - ' + fails.join('\n  - '));
/* ★ 退出码必须与失败数绑定（run-all 的 exitTiedToFailures 只认这个形态）：
 *   否则单独跑时红绿不分，反证也验不了这个套件本身是否真的会红。 */
process.exit(fail ? 1 : 0);
