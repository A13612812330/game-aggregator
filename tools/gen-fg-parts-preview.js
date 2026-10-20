#!/usr/bin/env node
'use strict';
/* ═══ v10.88 下载源列表预览生成器 ═══
 * 做什么：取真实端点数据（8124 上的 /api/fitgirl/parts），生成一张静态预览页
 *         `_preview/fg-parts.html`，用来人工判断「优化后的下载源长什么样」。
 * 为什么单独生成：这是设计确认稿，不接主站（避免未定稿的形状污染主源与派生页）。
 * 输出原则：页面上**不渲染下载地址明文**，只给「条数 + 复制按钮」；
 *          地址留在内嵌 JSON 里供按钮使用（避免把几十条外链刷满屏幕）。
 */
const fs = require('fs');
const path = require('path');

const BASE = process.env.PARTS_BASE || 'http://127.0.0.1:8124';
const OUT_DIR = path.join(__dirname, '..', '_preview');
const OUT = path.join(OUT_DIR, 'fg-parts.html');

/* 取样：单变体 / 多变体 / 多可选附件 / 成人标记 —— 覆盖各种形状 */
const SAMPLES = [
  { slug: 'elden-ring-nightreign', title: 'ELDEN RING NIGHTREIGN', tag: '单变体 + 2 组可选' },
  { slug: 'ready-or-not', title: 'Ready or Not', tag: '多变体（UNCENSORED 72 卷 vs 原版 13 卷）' },
  { slug: 'forza-horizon-3', title: 'Forza Horizon 3', tag: '5 组可选附件（4K/多语种语音）' },
  { slug: 'call-of-duty-modern-warfare-4', title: 'Call of Duty: Modern Warfare 4', tag: '大包（90 卷）' },
  { slug: 'seed-of-the-dead-sweet-home', title: 'Seed of the Dead: Sweet Home', tag: '成人标记（adult 独立标）' },
  { slug: 'cooking-simulator', title: 'Cooking Simulator', tag: '小包（少分卷）' },
  /* container 形态：页面不直列分卷，只在 paste/filecrypt 里给清单（实测占 40%） */
  { slug: 'immortality', title: 'Immortality', tag: 'container 形态（只给清单页）' },
];

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function get(slug) {
  const r = await fetch(BASE + '/api/fitgirl/parts?slug=' + encodeURIComponent(slug), { signal: AbortSignal.timeout(45000) });
  return { st: r.status, body: await r.json().catch(() => ({})) };
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const cards = [];
  for (const s of SAMPLES) {
    const { st, body } = await get(s.slug);
    if (st !== 200 || !body.ok) {
      console.log('  ✗ ' + s.slug + ' 跳过（' + st + ' ' + (body.error || '') + '）');
      continue;
    }
    console.log('  ✓ ' + s.slug + ' · 主组 ' + body.stats.mainParts + ' 卷 · 原链 ' + body.stats.rawLinks + ' 条');
    cards.push({ meta: s, data: body });
  }

  const totals = cards.reduce((a, c) => {
    a.raw += c.data.stats.rawLinks;
    a.mag += c.data.magnet.count;
    a.main += c.data.stats.mainParts;
    a.opt += c.data.stats.optionalSets;
    a.cont += c.data.containers.length;
    return a;
  }, { raw: 0, mag: 0, main: 0, opt: 0, cont: 0 });

  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>FitGirl 下载源 · 优化后形态预览</title>
<style>
:root{--bg:#f5f6f8;--card:#fff;--line:#e3e6ec;--ink:#1a1d23;--dim:#6b7280;--acc:#2f6fed;--ok:#0f9d58;--warn:#b45309;--pink:#d6336c}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;padding:28px 20px 60px}
.wrap{max-width:1000px;margin:0 auto}
h1{font-size:20px;margin:0 0 6px}
.sub{color:var(--dim);font-size:13px;margin-bottom:18px}
.hero{background:linear-gradient(135deg,#eef3ff,#f7f9ff);border:1px solid #dbe4fb;border-radius:12px;padding:16px 18px;margin-bottom:20px}
.hero b{color:var(--acc)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-top:12px}
.kpi{background:#fff;border:1px solid var(--line);border-radius:9px;padding:9px 12px}
.kpi span{display:block;color:var(--dim);font-size:11.5px}
.kpi b{font-size:19px;font-variant-numeric:tabular-nums}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-bottom:14px}
.ch{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:4px}
.ch h2{font-size:15.5px;margin:0}
.tag{font-size:11px;color:var(--dim);background:#f1f3f7;border:1px solid var(--line);border-radius:20px;padding:1px 9px}
.adult{font-size:11px;color:#fff;background:var(--pink);border-radius:20px;padding:1px 8px;font-weight:600}
/* 三档 */
.tier{display:flex;align-items:center;gap:10px;padding:11px 0;border-top:1px dashed var(--line);flex-wrap:wrap}
.tier:first-of-type{border-top:0}
.ic{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;font-size:14px;background:#f1f3f7;flex:0 0 auto}
.t-main{flex:1 1 260px;min-width:0}
.t-name{font-weight:600}
.t-desc{color:var(--dim);font-size:12.5px}
.badge{font-size:11px;border-radius:6px;padding:1px 7px;margin-left:6px}
.b-ok{background:#e8f6ef;color:var(--ok);border:1px solid #c6e9d6}
.b-warn{background:#fdf3e3;color:var(--warn);border:1px solid #f2ddb8}
.btn{border:1px solid var(--line);background:#fff;border-radius:8px;padding:5px 11px;font-size:12.5px;cursor:pointer;color:var(--ink)}
.btn:hover{border-color:var(--acc);color:var(--acc)}
.btn.primary{background:var(--acc);border-color:var(--acc);color:#fff}
.btn.primary:hover{opacity:.9;color:#fff}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}
.seg button{border:0;background:#fff;padding:5px 10px;font-size:12px;cursor:pointer;color:var(--dim)}
.seg button+button{border-left:1px solid var(--line)}
.seg button.on{background:#eef3ff;color:var(--acc);font-weight:600}
details{margin-top:6px}
summary{cursor:pointer;color:var(--dim);font-size:12.5px}
.opt{font-size:12.5px;color:#374151;padding:3px 0 3px 8px;border-left:2px solid var(--line);margin-top:4px}
.cmp{margin-top:14px;background:#fafbfd;border:1px solid var(--line);border-radius:9px;padding:10px 12px;font-size:12.5px;color:#374151}
.cmp b{color:var(--ink)}
.foot{margin-top:26px;color:var(--dim);font-size:12px;line-height:1.8}
.toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%) translateY(20px);background:#1a1d23;color:#fff;padding:9px 16px;border-radius:9px;font-size:13px;opacity:0;transition:.22s;pointer-events:none}
.toast.on{opacity:1;transform:translateX(-50%) translateY(0)}
</style></head>
<body><div class="wrap">

<h1>FitGirl 下载源 · 优化后形态（真实数据预览）</h1>
<div class="sub">取样 ${cards.length} 个游戏 · 数据来自本地端点 /api/fitgirl/parts · 页面上不渲染下载地址明文，只用按钮复制</div>

<div class="hero">
  <div>核心变化：<b>把一个游戏几十条散链接，收敛成 3 个决策点</b> ——
  ① 要不要用 BT（一条含全部分卷）② 走哪个镜像 ③ 要不要附加可选包。</div>
  <div class="kpis">
    <div class="kpi"><span>原始散链接</span><b>${totals.raw}</b></div>
    <div class="kpi"><span>归并后决策点</span><b>${cards.length * 3}</b></div>
    <div class="kpi"><span>主 repack 分卷</span><b>${totals.main}</b></div>
    <div class="kpi"><span>可选附件组</span><b>${totals.opt}</b></div>
    <div class="kpi"><span>磁力（一条顶全部）</span><b>${totals.mag}</b></div>
    <div class="kpi"><span>容器</span><b>${totals.cont}</b></div>
  </div>
</div>

${cards.map((c, ci) => {
  const d = c.data;
  const mains = d.sets.filter((x) => x.kind === 'main');
  const variants = d.sets.filter((x) => x.kind === 'variant');
  const opts = d.sets.filter((x) => x.optional);
  const main = mains[0];
  const adult = d.sets.some((x) => /UNCENSORED|lust/i.test(x.prefix)) || /lust/i.test(c.meta.slug);
  const hosts = main ? main.hosts : [];
  return `<div class="card" data-i="${ci}">
  <div class="ch">
    <h2>${esc(c.meta.title)}</h2>
    <span class="tag">${esc(c.meta.tag)}</span>
    ${adult ? '<span class="adult">18+</span>' : ''}
  </div>

  <div class="tier">
    <div class="ic">🧲</div>
    <div class="t-main">
      <div class="t-name">BT 种子<span class="badge b-ok">一条含全部分卷</span></div>
      <div class="t-desc">${d.magnet.count} 条磁力 · 主 repack ${main ? main.parts : 0} 卷全部在内，无需逐卷下载</div>
    </div>
    <button class="btn primary" onclick="copyMagnet(${ci},event)">复制磁力</button>
  </div>

  ${main ? `<div class="tier">
    <div class="ic">📦</div>
    <div class="t-main">
      <div class="t-name">网盘分卷 · ${esc(main.label)}<span class="badge b-warn">需过验证页</span></div>
      <div class="t-desc">${main.parts} 卷 · 原始 ${main.count} 条已按镜像归并成 ${main.parts} 条</div>
    </div>
    <div class="seg" data-ci="${ci}">${hosts.map((h, i) => `<button class="${i === 0 ? 'on' : ''}" data-h="${esc(h)}">${esc(h.replace(/\\.(to|co|net)$/, ''))}</button>`).join('')}</div>
    <button class="btn" onclick="copyParts(${ci},event)">复制全部 ${main.parts} 条</button>
  </div>` : (d.mode === 'container' ? `<div class="tier">
    <div class="ic">📄</div>
    <div class="t-main">
      <div class="t-name">清单在容器页<span class="badge b-warn">该帖不直列分卷</span></div>
      <div class="t-desc">这类帖（老帖/部分成人帖）只给一份 paste 清单 · 实测占 40% · 用 BT 更省事</div>
    </div>
    <button class="btn" onclick="openFirst(${ci},'container',event)">打开清单页</button>
  </div>` : '')}

  ${variants.length ? variants.map((v) => `<div class="tier">
    <div class="ic">🔀</div>
    <div class="t-main">
      <div class="t-name">另一版本 · ${esc(v.label)}</div>
      <div class="t-desc">${v.parts} 卷 · 与主组内容不同，按需选</div>
    </div>
    <button class="btn" onclick="copyVariant(${ci},'${esc(v.prefix)}',event)">复制 ${v.parts} 条</button>
  </div>`).join('') : ''}

  ${d.containers.length ? `<div class="tier">
    <div class="ic">🗂️</div>
    <div class="t-main">
      <div class="t-name">容器（JDownloader 可批量导入）</div>
      <div class="t-desc">${d.containers.length} 个容器 · 一条链接含全部分卷</div>
    </div>
    <button class="btn" onclick="openFirst(${ci},'container',event)">打开容器页</button>
  </div>` : ''}

  ${opts.length ? `<details><summary>可选附件 ${opts.length} 组（原声 / 视频 / 语音包，按需）</summary>
    ${opts.map((o) => `<div class="opt">· ${esc(o.label)} — ${o.parts} 个文件</div>`).join('')}
  </details>` : ''}

  <div class="cmp">${d.mode === 'inline'
    ? `优化前：<b>${d.stats.rawLinks} 条</b>散链接（${main ? main.count : 0} 条主组 × 多镜像 + 可选包 + 容器）→ 优化后：<b>3 个决策点</b> · BT 1 条 / 网盘 ${main ? main.parts : 0} 条（三镜像任选）/ 附件 ${opts.length} 组`
    : `优化前：只有一条 paste 清单页，点开还要再挑 → 优化后：<b>2 个决策点</b> · BT 1 条 / 清单页 1 个（推荐优先用 BT）`}</div>
</div>`;
}).join('\n')}

<div class="foot">
说明：<br>
· 这些链接最终都会跳到 filehoster 的验证页 —— 这是对方防盗链设计，无法在服务端变成直链（实测 fuckingfast 返回 Cloudflare 挑战、datanodes 302 到落地页）。<br>
· 本站不做代下、不绕风控。这里能优化的是<b>减少手工点选</b>：把「几十次点开」压成「一次复制 / 一条磁力」。<br>
· 复制出来的是一组链接，粘到 IDM / 迅雷 / Motrix 的批量下载框即可排队。
</div>
</div>
<div class="toast" id="toast"></div>

<script>
const DATA = ${JSON.stringify(cards.map((c) => ({ slug: c.meta.slug, magnet: c.data.magnet.list, containers: c.data.containers.map((x) => x.url), sets: c.data.sets.map((s) => ({ kind: s.kind, prefix: s.prefix, label: s.label, parts: s.parts, best: s.best, byHost: s.byHost })) })))};
const hostSel = {};
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(window.__tt); window.__tt = setTimeout(() => t.classList.remove('on'), 1800);
}
function copyText(txt, label) {
  const done = () => toast(label + ' 已复制（' + txt.split('\\n').length + ' 行）');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(done).catch(() => fallback(txt, label));
  } else fallback(txt, label);
}
function fallback(txt, label) {
  const ta = document.createElement('textarea');
  ta.value = txt; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); toast(label + ' 已复制'); }
  catch (e) { window.prompt('自动复制失败，请手动复制：', txt); }
  ta.remove();
}
function copyMagnet(i, ev) {
  ev.stopPropagation();
  const m = DATA[i].magnet;
  if (!m || !m.length) return toast('该帖没有磁力');
  copyText(m[0], '磁力');
}
function curHost(i) { return hostSel[i] || (DATA[i].sets.find((s) => s.kind === 'main') || {}).best; }
function copyParts(i, ev) {
  ev.stopPropagation();
  const s = DATA[i].sets.find((x) => x.kind === 'main');
  if (!s) return toast('没有主组');
  const h = curHost(i);
  const arr = (s.byHost[h] || []).map((x) => x.url);
  copyText(arr.join('\\n'), h + ' 的 ' + arr.length + ' 条链接');
}
function copyVariant(i, prefix, ev) {
  ev.stopPropagation();
  const s = DATA[i].sets.find((x) => x.prefix === prefix);
  if (!s) return toast('未找到该版本');
  const h = s.best;
  const arr = (s.byHost[h] || []).map((x) => x.url);
  copyText(arr.join('\\n'), s.label + ' 的 ' + arr.length + ' 条');
}
function openFirst(i, what, ev) {
  ev.stopPropagation();
  const u = what === 'container' ? (DATA[i].containers || [])[0] : null;
  if (!u) return toast('没有容器链接');
  window.open(u, '_blank', 'noopener');
}
document.querySelectorAll('.seg').forEach((seg) => {
  const ci = +seg.dataset.ci;
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    seg.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    hostSel[ci] = b.dataset.h;
    toast('已切到 ' + b.dataset.h);
  });
});
</script>
</body></html>`;

  fs.writeFileSync(OUT, html);
  console.log('\n生成: ' + OUT + ' · ' + (html.length / 1024).toFixed(1) + 'KB · ' + cards.length + ' 个游戏');
  const t = cards.reduce((a, c) => { a.raw += c.data.stats.rawLinks; a.main += c.data.stats.mainParts; return a; }, { raw: 0, main: 0 });
  console.log('对照：原始 ' + t.raw + ' 条散链接 → 主组归并后每组 ' + t.main + ' 条（决策点 ×3 游戏数）');
})().catch((e) => { console.error('生成失败:', e.message); process.exitCode = 1; });
