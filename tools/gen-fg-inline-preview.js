#!/usr/bin/env node
/**
 * gen-fg-inline-preview.js — 生成「FitGirl 分卷清单已接进主站详情页」的效果预览
 *
 * ★ 关键设计：预览里的分卷块**不是另写一套渲染**，而是从 `public/index.html` 抽出
 *   真实的 `fgPartsHtml` 与 `.fgp` 样式直接执行 —— 否则预览和线上会各走一套，
 *   「预览好看、上线不对」这类问题就是这么来的（本项目在派生页上手改已经吃过一次）。
 *
 * 用法：先起本地实例（PORT=8124 node server.js），然后
 *   node tools/gen-fg-inline-preview.js            # → _preview/fg-inline.html
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BASE = process.env.BASE || 'http://127.0.0.1:8124';
const OUT = path.join(ROOT, '_preview', 'fg-inline.html');

const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

/* ---- 抽真实实现（括号配对，不用贪婪正则） ---- */
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
const escSrc = (HTML.match(/const esc = \(s\) => [^\n]+/) || [])[0];
const partsSrc = grabFn(HTML, 'fgPartsHtml');
if (!escSrc || !partsSrc) { console.error('抽不到 esc / fgPartsHtml，主源结构变了？'); process.exit(1); }
const { fgPartsHtml, esc } = new Function(escSrc + '\n' + partsSrc + '\nreturn { fgPartsHtml, esc };')();

/* ---- 抽真实样式（.fgp 段）---- */
const cssStart = HTML.indexOf('  .fgp{');
const cssEnd = HTML.indexOf('.fgp .ctn a{', cssStart);
const FGP_CSS = cssStart > 0 ? HTML.slice(cssStart, HTML.indexOf('\n', cssEnd) + 1) : '';

/* ---- 取真实数据 ---- */
async function parts(slug) {
  const r = await fetch(BASE + '/api/fitgirl/parts?slug=' + encodeURIComponent(slug));
  const j = await r.json().catch(() => null);
  return j && j.ok ? j : null;
}

/** 找一个 container 形态的 slug（只试前 12 个，别把预览生成拖成抓站） */
async function findContainer(slugs) {
  for (const s of slugs.slice(0, 12)) {
    const j = await parts(s);
    if (j && j.mode === 'container') return { slug: s, data: j };
  }
  return null;
}

(async () => {
  const inlineA = await parts('cyberpunk-2077');
  const inlineB = await parts('ready-or-not');
  if (!inlineA) {
    console.error('拿不到 /api/fitgirl/parts —— 先起服务：PORT=8124 node server.js');
    process.exit(1);
  }

  /* container 样本：先试已知的那几篇（.cache 里落过 mode=container），再退回扫表。
   * ★ 不要用成人帖当样本（`seed-of-the-dead-sweet-home` 也是 container）——预览页要能公开给人看。 */
  const fg = require(path.join(ROOT, 'data', 'fitgirl.json'));
  const allSlugs = [];
  for (const arr of Object.values(fg.byGame || {})) for (const x of arr) if (x.slug) allSlugs.push(x.slug);
  const uniq = Array.from(new Set(allSlugs));
  let ctn = null;
  for (const s of ['immortality']) {
    const j = await parts(s);
    if (j && j.mode === 'container') { ctn = { slug: s, data: j }; break; }
  }
  if (!ctn) ctn = await findContainer(uniq.slice(200, 260));

  const card = (title, meta, slug, data) => `
  <section class="card">
    <div class="ct"><b>${esc(title)}</b><span class="cm">${esc(meta)}</span></div>
    <div class="fake-row">
      <span class="tagx">FitGirl</span>
      <span class="ft">${esc(title)}</span>
      <span class="fm">${esc(String((data || {}).fetchedAt ? new Date(data.fetchedAt).toISOString().slice(0, 10) : ''))}</span>
      <span class="lk">↗ 打开 Repack 页</span><span class="lk">⧉ 复制磁力</span><span class="lk on">▴ 收起清单</span>
    </div>
    ${data ? fgPartsHtml(data) : '<div class="fgp"><div class="h"><b>分卷清单</b></div><div class="ctn">这篇没有可解析的分卷清单（mode=none / 白名单外）</div></div>'}
    <div class="slug">slug：<code>${esc(slug)}</code> · mode=<b>${esc((data || {}).mode || 'none')}</b>
      ${data && data.sets ? '· ' + data.sets.length + ' 组' : ''}</div>
  </section>`;

  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>FitGirl 分卷清单 · 主站详情页接入效果</title>
<style>
:root{--c-border:#e3e6ec;--c-border2:#d8dde7;--c-primary:#2f6fed;--c-primary-soft:#eef3ff;
  --c-t1:#1a1d23;--c-t2:#4b5563;--c-t3:#8b93a1;--font-num:"SF Mono",Consolas,monospace}
*{box-sizing:border-box}
body{margin:0;background:#f5f6f8;color:var(--c-t1);padding:26px 20px 70px;
  font:14px/1.65 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
.wrap{max-width:960px;margin:0 auto}
h1{font-size:19px;margin:0 0 6px}
.sub{color:#6b7280;font-size:12.5px;margin-bottom:16px}
.hero{background:linear-gradient(135deg,#eef3ff,#f8faff);border:1px solid #dbe4fb;border-radius:12px;
  padding:14px 16px;margin-bottom:18px;font-size:12.5px;line-height:1.9}
.hero b{color:var(--c-primary)}
.card{background:#fff;border:1px solid var(--c-border);border-radius:12px;padding:15px 17px;margin-bottom:16px}
.ct{display:flex;align-items:baseline;gap:10px;margin-bottom:10px}
.ct b{font-size:13.5px}
.cm{color:#8b93a1;font-size:11.5px}
.fake-row{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:8px 0;
  border-top:1px dashed var(--c-border2);font-size:12.5px}
.fake-row .tagx{font-size:9.5px;font-weight:800;color:var(--c-primary);background:var(--c-primary-soft);
  border-radius:5px;padding:1px 6px}
.fake-row .ft{font-weight:650}
.fake-row .fm{color:var(--c-t3);font-size:11px;font-family:var(--font-num)}
.fake-row .lk{font-size:10.5px;font-weight:750;color:var(--c-primary);background:var(--c-primary-soft);
  border:1px solid #c9dcff;border-radius:6px;padding:2px 8px}
.fake-row .lk.on{background:var(--c-primary);color:#fff;border-color:var(--c-primary)}
.slug{margin-top:9px;font-size:11px;color:#8b93a1;font-family:var(--font-num)}
.slug code{background:#f1f5f9;border-radius:4px;padding:1px 5px;color:#334155}
.note{margin-top:20px;background:#fff;border:1px solid var(--c-border);border-radius:12px;padding:14px 17px;
  font-size:12.5px;line-height:1.95}
.note h3{margin:0 0 8px;font-size:13px}
.note code{background:#f1f5f9;border-radius:4px;padding:1px 5px;font-size:11.5px;color:#334155}
.note ul{margin:6px 0 0;padding-left:18px}
/* ── 以下是主源真实的 .fgp 样式（原样复制，保证预览=线上）── */
${FGP_CSS}
</style></head><body><div class="wrap">
<h1>FitGirl 分卷清单 · 已接进主站详情页（行内展开）</h1>
<div class="sub">本页的分卷块用的就是 <code>public/index.html</code> 里的真实 <code>fgPartsHtml()</code> 与真实 <code>.fgp</code> 样式，数据取本地实例现抓</div>
<div class="hero">
  <b>接入点</b>：详情页「本体」页签 → FitGirl Repack 段 → 每个 repack 行第三颗按钮 <b>▸ 分卷清单</b>（默认收起，点开才拉接口）。<br>
  <b>为什么不铺在首屏</b>：库里 5,813 个 repack、平均几十卷 ⇒ 全量是十几万条 URL；磁力才是主路径，分卷是「不用 BT / 只补几个分卷」时的备选。<br>
  <b>三站镜像</b>：datanodes / fuckingfast / filekeeper 是同一套分卷的三份镜像，所以只给一个镜站 + 切换按钮，复制一份就够。
</div>
${card('Cyberpunk 2077（主包 + 24 组可选）', '主包 103 卷/站 · 可选含 12 个语言包', 'cyberpunk-2077', inlineA)}
${card('Ready or Not（主包 + 变体 + 附件）', '主包 72 卷 · 变体 13 卷 · bonus OST', 'ready-or-not', inlineB)}
${ctn ? card('容器形态样本：' + ctn.slug, '页面不直列分卷，只给镜像清单页', ctn.slug, ctn.data)
  : '<section class="card"><div class="ct"><b>容器形态样本</b></div><div class="cm">这批 slug 里没抓到达 container 形态的样本（40% 的老帖是这种），可换 slug 重跑</div></section>'}
<div class="note">
  <h3>本轮改动落点</h3>
  <ul>
    <li><code>public/index.html</code>：FitGirl 行加 <code>data-fg-parts</code> 按钮 + <code>fgPartsHtml()</code> + 三处事件委托（展开 / 切镜站 / 复制全部）+ <code>.fgp</code> 样式</li>
    <li>主源改了 ⇒ <b>四张派生页全部重建</b>（emulator / resources / unpack / extract），<code>test-pages-sync</code> 58/58</li>
    <li>服务端沿用 v10.88 的 <code>GET /api/fitgirl/parts</code>（slug 白名单 + 24h 缓存 + 结构版本号 v）</li>
    <li>防线：<code>test-v1089-fg-parts-ui.js</code> 27/27（含转义、退化输入、container 分支）</li>
  </ul>
</div>
</div></body></html>`;

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, html);
  console.log('已生成 ' + OUT);
  console.log('  样本：cyberpunk-2077(' + (inlineA.sets || []).length + ' 组) / ready-or-not(' +
    ((inlineB || {}).sets || []).length + ' 组) / container=' + (ctn ? ctn.slug : '（未找到）'));
  console.log('  CSS ' + FGP_CSS.length + 'B · 页面 ' + (html.length / 1024).toFixed(0) + 'KB');
})();
