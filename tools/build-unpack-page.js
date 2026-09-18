#!/usr/bin/env node
/* 维护 public/unpack.html —— 「📦 解包配置匹配」独立页（v10.20 新增）
 *
 * 为什么要有这个页面：
 *   用户手上会有一份从游戏包 / 兼容层工具导出的 JSON（字段名未知，内容类似
 *   「兼容层最低配置」），需要回答「这套配置能跑哪些游戏」。
 *   识别与判定都在 data/spec-dict.js / data/spec-match.js，本页只负责呈现。
 *
 * 结构：与 public/emulator.html 同源 —— CSS / 顶栏 / 遮罩 / 搜索弹层 / 通用脚本
 *       全部从主源 public/index.html 抽取（tools/page-assets.js），
 *       所以**改样式仍只需改主源**，再跑一次本脚本即可，两侧不会漂移。
 *
 * 幂等：可重复运行。页面骨架硬编码在本文件里（不读自己的产物），
 *       避免「某一版丢了内容 → 下次读到丢了的版本 → 错误被永久固化」。
 */
const fs = require('fs');
const path = require('path');
const A = require('./page-assets');

const OUT = path.join(A.PUB, 'unpack.html');
const PAGE_JS = fs.readFileSync(path.join(__dirname, 'unpack-sections.js'), 'utf8');

/* ================= 页面骨架 ================= */
const SECTIONS = `
<main class="wrap" id="unpack">
  <div class="sec-h"><span class="bar up"></span><h2>解包配置匹配</h2><span class="en">UNPACK MATCH</span></div>

  <div class="up-intro">
    <span class="ic">📦</span>
    <div class="tx">
      <b>手里这份配置，能跑哪些游戏？</b>
      把从游戏包 / 兼容层工具里导出的 JSON 贴进来，这里会<b>自动认出</b>内存、架构、
      兼容层（DXVK / Box64 / Wine）等关键项，再对撞 <b>Steam 官方配置要求</b>，给出可适配清单 ——
      每个判定都摊开理由。
      <span class="dim">字段名不认识也能认：键名看不出来时会按<b>值的形态</b>推断，并标注「推断」。</span>
    </div>
  </div>

  <section class="up-in">
    <div class="up-blk-h"><b>① 贴上 JSON</b><span id="upShape"></span></div>
    <textarea id="upInput" class="up-ta" spellcheck="false" autocomplete="off"
      placeholder='把 JSON 贴到这里，或直接把文件拖进来…&#10;&#10;例：&#10;{&#10;  &quot;arch&quot;: &quot;arm64-v8a&quot;,&#10;  &quot;memory&quot;: &quot;16 GB&quot;,&#10;  &quot;compatibility&quot;: { &quot;dxvk&quot;: &quot;2.4&quot;, &quot;box64&quot;: &quot;0.3.4&quot; }&#10;}'></textarea>
    <input type="file" id="upFile" accept=".json,.txt,application/json" hidden>
    <div class="up-btns">
      <button type="button" class="up-b primary" id="upRun">开始匹配</button>
      <button type="button" class="up-b" id="upPick">选择文件</button>
      <button type="button" class="up-b" id="upSample">载入示例</button>
      <button type="button" class="up-b ghost" id="upClear">清空</button>
      <span class="up-sp"></span>
      <span class="up-cov blank" id="upCoverage"></span>
    </div>
    <div class="up-msg" id="upMsg" hidden></div>
  </section>

  <section id="upResult" hidden>
    <div id="upRecs" hidden></div>

    <div class="up-blk">
      <div class="up-blk-h"><b>② 这份配置被识别成</b><span>「自身配置」与「最低要求」分开统计，不会互相顶替</span></div>
      <div id="upProfile"></div>
    </div>

    <div class="up-blk">
      <div class="up-blk-h"><b>③ 逐项识别明细</b><span>「推断」= 键名不认识、按值的形态判断</span></div>
      <div id="upGroups" class="up-grps"></div>
      <div id="upUnknown"></div>
    </div>

    <div class="up-blk">
      <div class="up-blk-h"><b>④ 可适配游戏</b><span>默认「规模优先」：先看能跑的<b>最吃配置</b>的游戏</span></div>
      <div id="upMatch" class="up-match"><div class="up-empty">匹配中…</div></div>
    </div>
  </section>

  <section class="up-blk dict"><div id="upDict"></div></section>
</main>`;

/* ================= 页面专属样式 =================
   配色沿用主源的设计变量（--c-primary 等），不引入新色板。 */
const CSS_EXTRA = `
  /* ===== 📦 解包配置匹配（独立页专属） ===== */
  .bar.up{background:linear-gradient(180deg,#7C3AED,#4F46E5)}
  .up-intro{display:flex;gap:12px;align-items:flex-start;background:var(--c-surface);border:1px solid var(--c-border);
    border-radius:var(--r-lg);padding:14px 16px;margin:0 0 16px;box-shadow:var(--shadow)}
  .up-intro .ic{font-size:22px;line-height:1;flex:none}
  .up-intro .tx{font-size:13px;line-height:1.75;color:var(--c-t2)}
  .up-intro .tx b{color:var(--c-t1)}
  .up-intro .dim{display:block;margin-top:4px;opacity:.8}

  .up-blk{background:var(--c-surface);border:1px solid var(--c-border);border-radius:var(--r-lg);
    padding:14px 16px 16px;margin:0 0 16px;box-shadow:var(--shadow)}
  .up-blk.dict{background:transparent;border:none;box-shadow:none;padding:0}
  .up-blk-h{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:11px}
  .up-blk-h b{font-size:14.5px;font-weight:800;color:var(--c-t1)}
  .up-blk-h span{margin-left:auto;font-size:11.5px;color:var(--c-t3)}

  /* 输入区 */
  .up-ta{width:100%;min-height:172px;max-height:44vh;resize:vertical;padding:11px 13px;
    border:1px solid var(--c-border2);border-radius:var(--r-md);background:#FBFCFE;
    font:12.5px/1.65 var(--font-num);color:var(--c-t1);outline:none;transition:.15s}
  .up-ta:focus{border-color:var(--c-primary);background:#fff;box-shadow:0 0 0 3px rgba(46,107,255,.10)}
  .up-ta.drag{border-color:var(--c-primary);background:var(--c-primary-soft);border-style:dashed}
  .up-btns{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px}
  .up-b{padding:8px 15px;border-radius:9px;border:1px solid var(--c-border2);background:#fff;
    font:650 12.5px/1 var(--font);color:var(--c-t2);transition:.15s}
  .up-b:hover{border-color:var(--c-primary);color:var(--c-primary);background:var(--c-primary-soft)}
  .up-b.primary{background:linear-gradient(135deg,#7C3AED,#4F46E5);border-color:transparent;color:#fff;
    box-shadow:0 3px 10px rgba(79,70,229,.28)}
  .up-b.primary:hover{filter:brightness(1.06);color:#fff}
  .up-b.primary:disabled{opacity:.55;cursor:default;filter:none}
  .up-b.ghost{color:var(--c-t3);border-color:var(--c-border)}
  .up-sp{flex:1}
  .up-cov{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--c-t3)}
  .up-cov.blank{display:none}
  .up-cov-n{font:800 15px/1 var(--font-num);color:var(--c-ok)}
  .up-cov-t b{color:var(--c-t2)}
  .up-msg{margin-top:10px;padding:9px 12px;border-radius:9px;font-size:12.5px;line-height:1.6;
    background:var(--c-primary-soft);color:var(--c-t2)}
  .up-msg.warn{background:#FFF8E6;color:#8A6100}
  .up-msg.err{background:#FDECEC;color:#A31616}

  /* 多记录选择器 */
  #upRecs{margin-bottom:16px}
  .up-recs-t{font-size:12.5px;color:var(--c-t2);margin-bottom:8px}
  .up-recs-t b{color:var(--c-t1)}
  .up-recs-l{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px}
  .up-rec{flex:none;display:flex;flex-direction:column;gap:2px;align-items:flex-start;padding:8px 12px;
    border:1px solid var(--c-border);border-radius:10px;background:#fff;max-width:230px;transition:.15s}
  .up-rec b{font-size:12.5px;color:var(--c-t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
  .up-rec span{font-size:11px;color:var(--c-t3)}
  .up-rec.on{border-color:#7C3AED;background:#F5F3FF;box-shadow:0 0 0 2px rgba(124,58,237,.14)}

  /* 配置画像 */
  .up-prof-h{display:flex;align-items:baseline;gap:10px;margin-bottom:10px}
  .up-prof-h b{font-size:13.5px;color:var(--c-t1)}
  .up-prof-h span{margin-left:auto;font-size:11.5px;color:var(--c-t3)}
  .up-note.warn{background:#FFF8E6;border:1px solid #F0DFAE;border-radius:9px;padding:8px 11px;
    font-size:12px;line-height:1.6;color:#7A5600;margin-bottom:10px}
  .up-cells{display:grid;grid-template-columns:repeat(auto-fill,minmax(178px,1fr));gap:9px}
  .up-cell{border:1px solid var(--c-border);border-radius:var(--r-md);padding:9px 11px;background:#FCFDFF;
    display:flex;flex-direction:column;gap:2px;min-width:0}
  .up-cell .lb{font-size:11px;color:var(--c-t3)}
  .up-cell b{font-size:13.5px;color:var(--c-t1);font-weight:750;line-height:1.4;word-break:break-word}
  .up-cell .nt{font-size:10.5px;color:var(--c-t3);line-height:1.5;word-break:break-word}
  .up-cell .none{font-style:normal;font-weight:500;color:var(--c-t3);font-size:12px}
  .up-cell.hi{border-color:#BBF7D0;background:#F4FDF7}
  .up-cell.hi b{color:#15803D}
  .up-cell.lo{border-color:#E8D9F7;background:#FBF8FF}
  .up-cell.req{border-color:#F0DFAE;background:#FFFDF5}
  .up-cell.req b{font-size:12.5px}

  /* 逐项明细 */
  .up-grps{display:grid;grid-template-columns:repeat(auto-fill,minmax(258px,1fr));gap:10px}
  .up-grp{border:1px solid var(--c-border);border-radius:var(--r-md);overflow:hidden;background:#fff}
  .up-grp .hd{display:flex;align-items:center;gap:7px;padding:8px 11px;background:#F5F7FB;border-bottom:1px solid var(--c-border)}
  .up-grp .hd b{font-size:12.5px;color:var(--c-t1)}
  .up-grp .hd i{margin-left:auto;font-style:normal;font:700 11px/1 var(--font-num);color:var(--c-t3);
    background:#fff;border:1px solid var(--c-border);border-radius:5px;padding:2px 6px}
  .up-grp .bd{padding:4px 0}
  .up-grp .it,.up-unk .it{display:flex;align-items:baseline;gap:8px;padding:5px 11px;font-size:12px;min-width:0}
  .up-grp .it code,.up-unk .it code{font:11.5px/1.5 var(--font-num);color:#6D28D9;background:#F5F3FF;
    padding:1px 5px;border-radius:4px;flex:none;max-width:44%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .up-grp .it .vv,.up-unk .it span{color:var(--c-t2);word-break:break-word;min-width:0}
  .up-grp .tg{font-style:normal;font-size:10px;font-weight:700;border-radius:4px;padding:1.5px 5px;flex:none}
  .up-grp .tg.min{background:#FEF3C7;color:#92400E}
  .up-grp .tg.rec{background:#DBEAFE;color:#1E40AF}
  .up-grp .tg.low{background:#F3F4F6;color:#6B7280}
  .up-unk{margin-top:11px;border:1px solid var(--c-border);border-radius:var(--r-md);background:#FCFDFF}
  .up-unk summary{cursor:pointer;padding:9px 12px;font-size:12.5px;color:var(--c-t2);list-style:none}
  .up-unk summary::-webkit-details-marker{display:none}
  .up-unk summary::before{content:'▸ ';color:var(--c-t3)}
  .up-unk[open] summary::before{content:'▾ '}
  .up-unk summary b{color:var(--c-t1)}
  .up-unk-l{padding:2px 0 8px;border-top:1px solid var(--c-border);max-height:260px;overflow:auto}

  /* 匹配结果 */
  .up-mstats{display:flex;align-items:center;gap:20px;flex-wrap:wrap;padding:2px 0 12px}
  .up-ms{display:flex;flex-direction:column;gap:1px}
  .up-ms b{font:800 20px/1.15 var(--font-num);color:var(--c-primary)}
  .up-ms span{font-size:11.5px;color:var(--c-t3)}
  .up-dist{display:flex;gap:12px;flex-wrap:wrap;margin-left:auto}
  .up-d{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--c-t3)}
  .up-d b{color:var(--c-t1);font-family:var(--font-num)}
  .up-d .dot{width:8px;height:8px;border-radius:50%;background:var(--c-t3)}
  .up-d .dot.sm{background:#16A34A}.up-d .dot.ok{background:#2E6BFF}
  .up-d .dot.mb{background:#D97706}.up-d .dot.un{background:#9AA3B5}.up-d .dot.no{background:#DC2626}
  .up-mbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 0;border-top:1px solid var(--c-border)}
  .up-search{flex:1;min-width:190px;padding:8px 12px;border:1px solid var(--c-border2);border-radius:9px;
    font:13px/1 var(--font);color:var(--c-t1);outline:none;background:#fff}
  .up-search:focus{border-color:var(--c-primary);box-shadow:0 0 0 3px rgba(46,107,255,.10)}
  .up-sorts{display:flex;gap:4px;background:#EEF1F7;border:1px solid var(--c-border);border-radius:10px;padding:3px}
  .up-sort{padding:6px 11px;border-radius:7px;font:650 12px/1 var(--font);color:var(--c-t2);transition:.15s}
  .up-sort:hover{background:rgba(255,255,255,.7);color:var(--c-t1)}
  .up-sort.on{background:#fff;color:#4F46E5;box-shadow:0 1px 3px rgba(18,26,51,.12)}
  .up-only{padding:7px 12px;border-radius:9px;border:1px solid var(--c-border2);background:#fff;
    font:650 12px/1 var(--font);color:var(--c-t2)}
  .up-only.on{background:var(--c-primary-soft);border-color:var(--c-primary);color:var(--c-primary)}
  .up-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(292px,1fr));gap:10px;padding:2px 0 4px}
  .up-card{border:1px solid var(--c-border);border-left:3px solid var(--c-t3);border-radius:var(--r-md);
    padding:10px 12px;background:#fff;display:flex;flex-direction:column;gap:6px;min-width:0}
  .up-card.sm{border-left-color:#16A34A}.up-card.ok{border-left-color:#2E6BFF}
  .up-card.mb{border-left-color:#D97706}.up-card.un{border-left-color:#9AA3B5}
  .up-card.no{border-left-color:#DC2626;opacity:.72}
  .up-card-h{display:flex;align-items:center;gap:8px;min-width:0}
  .up-card-h b{font-size:13px;color:var(--c-t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .up-mg{margin-left:auto;font:600 10.5px/1 var(--font-num);color:var(--c-t3);flex:none}
  .up-badge{flex:none;font-size:10.5px;font-weight:750;border-radius:5px;padding:2.5px 7px}
  .up-badge.sm{background:#DCFCE7;color:#15803D}
  .up-badge.ok{background:#DBEAFE;color:#1D4ED8}
  .up-badge.mb{background:#FEF3C7;color:#92400E}
  .up-badge.un{background:#F1F3F7;color:#5A6474}
  .up-badge.no{background:#FEE2E2;color:#B91C1C}
  .up-chips{display:flex;gap:5px;flex-wrap:wrap}
  .up-ch{font-size:10.5px;font-weight:650;border-radius:5px;padding:2px 6px;background:#F1F3F7;color:var(--c-t2)}
  .up-ch.ok{background:#EDF7F0;color:#15803D}
  .up-ch.fail{background:#FDECEC;color:#B91C1C}
  .up-ch.unknown,.up-ch.uj{background:#FFF8E6;color:#8A6100}
  .up-min{font-size:11px;color:var(--c-t3);line-height:1.55;word-break:break-word}
  .up-why{font-size:11px;color:#B91C1C;line-height:1.55;background:#FEF6F6;border-radius:6px;padding:5px 8px}
  .up-foot{padding-top:11px;margin-top:4px;border-top:1px solid var(--c-border);font-size:11px;color:var(--c-t3);line-height:1.7}
  .up-empty{padding:24px 4px;text-align:center;color:var(--c-t3);font-size:13px}

  /* 判定依据 */
  .up-dict{background:var(--c-surface);border:1px solid var(--c-border);border-radius:var(--r-lg);
    padding:14px 16px;box-shadow:var(--shadow)}
  .up-dict-h{font-size:13.5px;font-weight:800;color:var(--c-t1);margin-bottom:10px}
  .up-dims{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:9px}
  .up-dim{border:1px solid var(--c-border);border-radius:var(--r-md);padding:9px 11px;background:#FCFDFF}
  .up-dim b{display:block;font-size:12.5px;color:var(--c-t1);margin-bottom:3px}
  .up-dim span{font-size:11.5px;color:var(--c-t2);line-height:1.6}
  .up-dict-n{margin-top:10px;font-size:11.5px;color:var(--c-t3);line-height:1.75}
  .up-dict-n b{color:var(--c-t2)}
  .page-deadnodes{display:none!important}

  @media(max-width:760px){
    .up-cells{grid-template-columns:repeat(auto-fill,minmax(148px,1fr))}
    .up-grps{grid-template-columns:1fr}
    .up-list{grid-template-columns:1fr}
    .up-dist{margin-left:0;width:100%}
    .up-intro{padding:12px 13px}
  }
  @media(max-width:430px){
    .up-btns .up-b{padding:8px 11px;font-size:12px}
    .up-mbar .up-search{min-width:100%}
  }`;

/* ================= 组装 ================= */
const head = A.buildHead(
  '解包配置匹配 · GameHub 聚合',
  '把游戏解包 / 兼容层工具导出的 JSON 贴进来，自动识别配置并对撞 Steam 官方配置要求，给出可适配游戏清单。'
);
const topbar = A.buildTopbar('unpack');
const overlay = A.buildTabbar('unpack');
const dead = A.deadNodes();
const script = A.assertClean(A.scriptForSubpage(), 'unpack.html');

const out = [
  head,
  A.CSS,
  CSS_EXTRA,
  '</style>',
  '</head>',
  '<body>',
  '',
  '<!-- ===== 顶栏（从主源 public/index.html 抽取，勿直接改这里） ===== -->',
  topbar,
  '',
  SECTIONS,
  '',
  A.SEARCH ? '<!-- ===== 搜索弹层（通用脚本依赖，缺了会中断整段脚本） ===== -->\n' + A.SEARCH + '\n' : '',
  '<!-- ===== 遮罩 + 详情抽屉 + 底部 Tab ===== -->',
  overlay,
  '',
  dead,
  '',
  '<script>',
  script,
  '',
  PAGE_JS,
  '',
  '/* 首屏：绑定交互并拉取「判定依据」。放在最后 —— 上面的脚本已声明 api() 等依赖。 */',
  'initUp();',
  '</script>',
  '</body>',
  '</html>',
  '',
].join('\n');

/* ---------- 出站自检：宁可构建失败，也不要产出一版「看着还行其实全废」的页面 ---------- */
const need = ['id="upInput"', 'id="upRun"', 'id="upProfile"', 'id="upGroups"', 'id="upUnknown"', 'id="upMatch"', 'id="upDict"', 'id="upFile"', 'initUp()'];
const miss = need.filter((s) => out.indexOf(s) < 0);
if (miss.length) throw new Error('[build-unpack-page] 产物缺少关键节点：' + miss.join(', '));
if (!/id="navUnpack"/.test(out)) throw new Error('[build-unpack-page] 顶栏缺少 #navUnpack 入口 —— 请确认主源 <nav class="main-nav"> 里已加该链接。');
if (/EMU_PAGE_HREF/.test(out)) throw new Error('[build-unpack-page] 产物残留 EMU_PAGE_HREF，会导致 ReferenceError。');
if (out.indexOf('<style>') < 0 || out.indexOf('</style>') < 0) throw new Error('[build-unpack-page] 样式块不完整。');

fs.writeFileSync(OUT, out, 'utf8');
console.log('[build-unpack-page] 已生成 public/unpack.html（' + (out.length / 1024).toFixed(1) + ' KB）');
