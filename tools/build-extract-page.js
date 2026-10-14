#!/usr/bin/env node
/* 维护 public/extract.html —— 「🗜️ 解压助手」独立页（v10.71 新增）
 *
 * 为什么要有这个页面：
 *   「下载直链的压缩包，压缩包中含有压缩包」是这两条通道的常态（已实测复现：
 *     游侠存档直链 .rar 里就是一个 .rar，再解才是存档目录）。
 *   本页把它做成「一次提交，递归解到底」，并在遇到加密包时列出来让用户填密码续跑。
 *
 * 结构：与 public/unpack.html 同源 —— CSS / 顶栏 / 遮罩 / 搜索弹层 / 通用脚本
 *       全部从主源 public/index.html 抽取（tools/page-assets.js），
 *       所以**改样式仍只需改主源**，再跑一次本脚本即可，两侧不会漂移。
 *
 * 幂等：可重复运行。页面骨架硬编码在本文件里（不读自己的产物），
 *       避免「某一版丢了内容 → 下次读到丢了的版本 → 错误被永久固化」。
 *
 * ⚠️ 本文件的 CSS/HTML 都在**模板字符串**里，注释与文案里**不能出现反引号**
 *    （会把模板提前闭合，产出一张废页）。需要行内代码样式时用 <code> 标签。
 */
const fs = require('fs');
const path = require('path');
const A = require('./page-assets');

const OUT = path.join(A.PUB, 'extract.html');
const PAGE_JS = fs.readFileSync(path.join(__dirname, 'extract-sections.js'), 'utf8');

/* ================= 页面骨架 ================= */
const SECTIONS = `
<main class="wrap" id="extract">
  <div class="sec-h"><span class="bar up"></span><h2>解压助手</h2><span class="en">EXTRACT</span></div>

  <div class="ex-intro">
    <span class="ic">🗜️</span>
    <div class="tx">
      <b>压缩包套压缩包，一次解到底</b>
      <p>贴一条下载直链，服务端会下载后<b>逐层递归解压</b>：解一层 → 在产出里再找压缩包 → 还有就接着解，
         直到没有为止（默认最多 5 层，防无限套娃）。遇到加密包会列出来让你填密码续跑；
         原压缩包一律<b>保留不动</b>，重复解压是安全的。</p>
    </div>
  </div>

  <!-- 解压器状态（7z 是否就绪） -->
  <div class="ex-env" id="exEnv"><span class="dot"></span><b>正在检测解压器…</b></div>

  <!-- 输入 -->
  <div class="ex-card">
    <div class="ex-card-h"><b>从哪解</b></div>
    <div class="ex-tabs">
      <button class="ex-tab on" data-m="url">🔗 下载直链</button>
      <button class="ex-tab" data-m="dir">📁 文件夹</button>
    </div>

    <div class="ex-pane" id="exPaneUrl">
      <div class="ex-row">
        <input id="exUrl" class="ex-in" placeholder="粘贴下载直链（.rar / .zip / .7z）" autocomplete="off">
        <button class="ex-b primary" id="exGoUrl">下载并递归解压</button>
      </div>
      <input id="exDirUrl" class="ex-in sm" placeholder="保存到（留空 = 默认目录）" autocomplete="off">
      <div class="ex-hint">
        <b>只有「真直链」能这样下</b> —— 服务端直接取文件。夸克 / 百度 / 迅雷这类网盘要客户端和登录，
        服务端拿不到，请切到右边「文件夹」把下好的包丢进去处理。
      </div>
    </div>

    <div class="ex-pane" id="exPaneDir" hidden>
      <div class="ex-row">
        <input id="exDir" class="ex-in" placeholder="文件夹绝对路径" autocomplete="off">
        <button class="ex-b" id="exScanBtn">扫描</button>
        <button class="ex-b primary" id="exRunBtn">递归解压全部</button>
      </div>
      <div class="ex-hint">
        先「扫描」看看认出了哪些包，再「递归解压全部」。识别按<b>文件头</b>判断，
        不依赖扩展名 —— 实测遇到过扩展名叫 <code>.zips</code> 其实是 ZIP 的包。
        分卷包只解首卷，不会把中间卷当成坏包。
      </div>
    </div>

    <div class="ex-msg" id="exMsg" hidden></div>
  </div>

  <div id="exScanRes"></div>
  <div id="exTask"></div>
  <div id="exReport"></div>

  <!-- 判定口径 -->
  <div class="ex-card">
    <div class="ex-card-h"><b>这套解压是怎么判的</b><span class="n">全部现测，非估计</span></div>
    <div class="ex-dims">
      <div class="ex-dim"><b>按文件头识别</b><span>看前 512 字节的魔数（ZIP 504b0304 / RAR 52617221 / 7Z 377abcaf），
        不看扩展名。实测直链里出现过 .zips 实为 ZIP 的包。</span></div>
      <div class="ex-dim"><b>递归到没有为止</b><span>解完一层就在产出里再扫。深度上限默认 5 层，
        防 A.zip 里还是 A.zip 的死循环；被截断的层会如实列进报告。</span></div>
      <div class="ex-dim"><b>密码用 7z t 预检</b><span>对 zip，错误密码照样能列出文件名，
        所以不能用「能不能列目录」判密码。改用完整性测试：对密码退出码 0、错密码 2，
        且不受「文件已存在」影响。</span></div>
      <div class="ex-dim"><b>失败会回滚</b><span>实测错密码解压会留下 0 字节残file。
        失败时按快照差集把本次新产生的文件删掉，避免污染目录、也避免它下次被当成「已存在」跳过。</span></div>
      <div class="ex-dim"><b>只解分卷首卷</b><span>实测 .7z.002 单独解会报「系统找不到指定的文件」（退出码 2，
        与坏包同码）。所以先按命名族认出分卷组，只喂首卷。</span></div>
      <div class="ex-dim"><b>已存在就跳过</b><span>用 7z 的 -aos：不覆盖你已有的文件。
        报告里会把这种层标成「已存在，跳过」，不会假装解出了东西。</span></div>
    </div>
  </div>
</main>`;

/* ================= 本页专属样式 =================
 * ★ 全部沿用主源既有 token（--c-* / --r-* / --font*），不新造视觉语言。
 * ★ 本段会追加在主源 CSS 之后、</style> 之前（见组装段）。 */
const CSS_EXTRA = `
  /* ---------- 说明条 ---------- */
  .ex-intro{display:flex;gap:12px;align-items:flex-start;background:var(--c-surface);border:1px solid var(--c-border);
    border-radius:var(--r-lg);padding:14px 16px;box-shadow:var(--shadow);margin-bottom:12px}
  .ex-intro .ic{font-size:22px;line-height:1.2;flex:none}
  .ex-intro .tx{min-width:0}
  .ex-intro .tx b{display:block;font-size:13.5px;color:var(--c-t1);margin-bottom:4px}
  .ex-intro .tx p{margin:0;font-size:12.5px;line-height:1.75;color:var(--c-t2)}
  .ex-intro .tx p b{display:inline;font-size:inherit;color:var(--c-t1);margin:0}

  /* ---------- 解压器状态条 ---------- */
  .ex-env{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:9px 13px;border-radius:var(--r-md);
    background:#F5F7FB;border:1px solid var(--c-border);font-size:12px;color:var(--c-t2);margin-bottom:12px}
  .ex-env .dot{width:8px;height:8px;border-radius:50%;background:var(--c-t3);flex:none}
  .ex-env.ok{background:#F4FDF7;border-color:#BBF7D0;color:#15803D}
  .ex-env.ok .dot{background:#16A34A}
  .ex-env.bad{background:#FEF6F6;border-color:#F5C2C2;color:#B91C1C}
  .ex-env.bad .dot{background:#DC2626}
  .ex-env b{color:inherit;font-weight:750}
  .ex-env .mono{font:11.5px/1.4 var(--font-num);background:rgba(0,0,0,.05);border-radius:5px;padding:1px 6px;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:46%}
  .ex-env .ver{font-size:11px;opacity:.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:42%}

  /* ---------- 卡片 ---------- */
  .ex-card{background:var(--c-surface);border:1px solid var(--c-border);border-radius:var(--r-lg);
    padding:14px 16px;box-shadow:var(--shadow);margin-bottom:12px}
  .ex-card-h{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:11px}
  .ex-card-h b{font-size:13.5px;font-weight:800;color:var(--c-t1)}
  .ex-card-h .n{font:700 11px/1 var(--font-num);color:var(--c-t3);background:#F1F3F8;border:1px solid var(--c-border);
    border-radius:5px;padding:3px 7px}
  .ex-card-h .p{margin-left:auto;font:11.5px/1.4 var(--font-num);color:var(--c-t3);background:#F7F9FC;
    border:1px solid var(--c-border);border-radius:5px;padding:3px 8px;max-width:56%;overflow:hidden;
    text-overflow:ellipsis;white-space:nowrap}
  .ex-card-h .ph{font-size:11.5px;color:var(--c-t3)}
  .ex-card-h .by{font:650 11.5px/1 var(--font-num);color:var(--c-primary)}

  /* ---------- 输入 ---------- */
  .ex-tabs{display:flex;gap:4px;background:#EEF1F7;border:1px solid var(--c-border);border-radius:10px;
    padding:3px;margin-bottom:11px;width:fit-content;max-width:100%}
  .ex-tab{padding:7px 14px;border-radius:7px;font:650 12.5px/1 var(--font);color:var(--c-t2);transition:.15s}
  .ex-tab:hover{color:var(--c-t1)}
  .ex-tab.on{background:#fff;color:var(--c-primary);box-shadow:0 1px 3px rgba(18,26,51,.12)}
  .ex-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .ex-in{flex:1;min-width:220px;padding:10px 13px;border:1px solid var(--c-border2);border-radius:10px;
    font:13px/1 var(--font);color:var(--c-t1);outline:none;background:#fff}
  .ex-in.sm{margin-top:8px;font-size:12.5px;padding:8px 12px}
  .ex-in:focus{border-color:var(--c-primary);box-shadow:0 0 0 3px rgba(46,107,255,.10)}
  .ex-b{padding:10px 16px;border-radius:10px;border:1px solid var(--c-border2);background:#fff;
    font:700 12.5px/1 var(--font);color:var(--c-t2);transition:.15s;flex:none;cursor:pointer}
  .ex-b:hover{border-color:var(--c-primary);color:var(--c-primary)}
  .ex-b.primary{background:var(--c-primary);border-color:var(--c-primary);color:#fff}
  .ex-b.primary:hover{filter:brightness(1.06);color:#fff}
  .ex-b:disabled{opacity:.55;cursor:default}
  .ex-hint{margin-top:9px;font-size:11.5px;line-height:1.7;color:var(--c-t3)}
  .ex-hint b{color:var(--c-t2)}
  .ex-hint code{font:11px/1.5 var(--font-num);background:#F1F3F8;border-radius:4px;padding:1px 5px;color:#6D28D9}
  .ex-msg{margin-top:10px;padding:9px 12px;border-radius:9px;font-size:12.5px;line-height:1.6;
    background:var(--c-primary-soft);color:var(--c-t2)}
  .ex-msg.warn{background:#FFF8E6;color:#8A6100}
  .ex-msg.err{background:#FDECEC;color:#A31616}

  /* ---------- 扫描结果 ---------- */
  .ex-scan-l{display:flex;flex-direction:column;gap:2px;max-height:300px;overflow:auto}
  .ex-scan-it{display:flex;align-items:center;gap:9px;padding:6px 8px;border-radius:7px;font-size:12.5px;min-width:0}
  .ex-scan-it:hover{background:#F7F9FC}
  .ex-scan-it .fmt{flex:none;font:750 10px/1 var(--font-num);color:#fff;background:#7C3AED;border-radius:4px;padding:3px 6px}
  .ex-scan-it .nm{flex:1;min-width:0;color:var(--c-t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .ex-scan-it .sz{flex:none;font:11.5px/1 var(--font-num);color:var(--c-t3)}
  .ex-scan-it .tag{flex:none;font-size:10px;font-weight:700;border-radius:4px;padding:2px 6px}
  .ex-scan-it .tag.vol{background:#FEF3C7;color:#92400E}

  /* ---------- 任务进度 ---------- */
  .ex-bar{height:6px;border-radius:999px;background:#EEF1F7;overflow:hidden;margin:4px 0 11px}
  .ex-bar i{display:block;height:100%;background:var(--c-primary);border-radius:999px;transition:width .25s}
  .ex-bar i.run{background:linear-gradient(90deg,var(--c-primary),#7C3AED,#2E6BFF);background-size:200% 100%;
    animation:exRun 1.6s linear infinite}
  @keyframes exRun{0%{background-position:0 0}100%{background-position:200% 0}}
  .ex-ev{display:flex;flex-direction:column;gap:1px;max-height:260px;overflow:auto;
    background:#FBFCFE;border:1px solid var(--c-border);border-radius:var(--r-md);padding:7px 9px}
  .ex-ev-it{display:flex;gap:7px;align-items:baseline;font-size:12px;line-height:1.6;padding:2px 0;min-width:0}
  .ex-ev-it i{flex:none;width:14px;text-align:center;font-style:normal;color:var(--c-t3)}
  .ex-ev-it span{min-width:0;color:var(--c-t2);word-break:break-word}
  .ex-ev-it.layer-ok span,.ex-ev-it.downloaded span,.ex-ev-it.password-ok span{color:#15803D}
  .ex-ev-it.layer-fail span,.ex-ev-it.error span{color:#B91C1C}
  .ex-ev-it.need-password span{color:#8A6100}
  .ex-ev-it.circuit-break span{color:#92400E;font-weight:700}

  /* ---------- 报告 ---------- */
  .ex-stats{display:flex;gap:20px;flex-wrap:wrap;padding:2px 0 13px}
  .ex-s{display:flex;flex-direction:column;gap:1px}
  .ex-s b{font:800 19px/1.15 var(--font-num);color:var(--c-t2)}
  .ex-s span{font-size:11.5px;color:var(--c-t3)}
  .ex-s.hi b{color:#15803D}
  .ex-s.mb b{color:#B45309}
  .ex-s.no b{color:#DC2626}
  .ex-sub{font-size:12px;font-weight:750;color:var(--c-t2);margin:9px 0 6px;padding-top:9px;
    border-top:1px solid var(--c-border)}
  .ex-layers,.ex-fails,.ex-skip-l{display:flex;flex-direction:column;gap:2px}
  .ex-layer,.ex-fail,.ex-skip{display:flex;align-items:center;gap:9px;padding:6px 9px;border-radius:7px;
    font-size:12.5px;min-width:0;border-left:3px solid var(--c-border)}
  .ex-layer.ok{background:#F6FDF9;border-left-color:#16A34A}
  .ex-layer.skip{background:#FBFCFE;border-left-color:#C7CFDD}
  .ex-layer.bad,.ex-fail{background:#FEF9F9;border-left-color:#DC2626}
  .ex-layer .d,.ex-fail .d{flex:none;font:700 10.5px/1 var(--font-num);color:var(--c-t3);background:#fff;
    border:1px solid var(--c-border);border-radius:4px;padding:3px 5px}
  .ex-layer .nm,.ex-fail .nm{flex:1;min-width:0;color:var(--c-t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .ex-layer .fmt{flex:none;font:700 9.5px/1 var(--font-num);color:#6D28D9;background:#F5F3FF;border-radius:4px;padding:3px 5px}
  .ex-layer .rs{flex:none;font-size:11.5px;color:var(--c-t2)}
  .ex-layer .er,.ex-fail .er,.ex-skip .rs{flex:none;font-size:11px;color:#B91C1C;max-width:44%;overflow:hidden;
    text-overflow:ellipsis;white-space:nowrap}
  .ex-skip .nm{flex:1;min-width:0;font-size:12px;color:var(--c-t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

  /* ---------- 密码表单 ---------- */
  .ex-pw{display:flex;flex-direction:column;gap:7px;background:#FFFDF5;border:1px solid #F0DFAE;
    border-radius:var(--r-md);padding:11px 12px}
  .ex-pw-it{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
  .ex-pw-it .nm{flex:1;min-width:150px;font-size:12.5px;color:var(--c-t1);overflow:hidden;
    text-overflow:ellipsis;white-space:nowrap}
  .ex-pw-it .dp{flex:none;font:700 10.5px/1 var(--font-num);color:#92400E;background:#FEF3C7;border-radius:4px;padding:3px 6px}
  .ex-pw-it input{flex:0 1 260px;min-width:170px;padding:8px 11px;border:1px solid var(--c-border2);
    border-radius:8px;font:12.5px/1 var(--font);color:var(--c-t1);outline:none;background:#fff}
  .ex-pw-it input:focus{border-color:var(--c-primary);box-shadow:0 0 0 3px rgba(46,107,255,.10)}
  .ex-pw-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:3px}
  .ex-pw-bar .hint{font-size:11px;color:var(--c-t3);line-height:1.6}

  /* ---------- 折叠 / 空态 / 底栏 ---------- */
  .ex-fold{margin-top:9px;border:1px solid var(--c-border);border-radius:var(--r-md);background:#FCFDFF}
  .ex-fold summary{cursor:pointer;padding:9px 12px;font-size:12.5px;color:var(--c-t2);list-style:none}
  .ex-fold summary::-webkit-details-marker{display:none}
  .ex-fold summary::before{content:'▸ ';color:var(--c-t3)}
  .ex-fold[open] summary::before{content:'▾ '}
  .ex-fold .ex-skip-l{padding:2px 9px 9px;border-top:1px solid var(--c-border);max-height:280px;overflow:auto}
  .ex-empty{padding:20px 4px;text-align:center;color:var(--c-t3);font-size:12.5px;line-height:1.8}
  .ex-empty span{font-size:11.5px}
  .ex-bar2{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:11px;padding-top:11px;
    border-top:1px solid var(--c-border)}
  .ex-bar2 .hint{font-size:11px;color:var(--c-t3);line-height:1.6}

  /* ---------- 判定口径卡 ---------- */
  .ex-dims{display:grid;grid-template-columns:repeat(auto-fill,minmax(248px,1fr));gap:9px}
  .ex-dim{border:1px solid var(--c-border);border-radius:var(--r-md);padding:9px 11px;background:#FCFDFF}
  .ex-dim b{display:block;font-size:12.5px;color:var(--c-t1);margin-bottom:3px}
  .ex-dim span{font-size:11.5px;color:var(--c-t2);line-height:1.65}

  .page-deadnodes{display:none!important}

  @media(max-width:760px){
    .ex-intro{padding:12px 13px;gap:9px}
    .ex-intro .ic{font-size:19px}
    .ex-card{padding:12px 13px}
    .ex-card-h .p{max-width:100%;margin-left:0;order:9;width:100%}
    .ex-in{min-width:100%}
    .ex-row .ex-b{flex:1;justify-content:center;text-align:center}
    .ex-dims{grid-template-columns:1fr}
    .ex-stats{gap:14px}
    .ex-s b{font-size:17px}
    .ex-pw-it input{flex:1 1 100%;min-width:100%}
  }
  @media(max-width:430px){
    .ex-layer .er,.ex-fail .er{max-width:100%;order:9;width:100%;white-space:normal}
  }`;

/* ================= 组装 ================= */
const head = A.buildHead(
  '解压助手 · GameHub 聚合',
  '贴一条下载直链或指定文件夹，自动逐层递归解压（压缩包套压缩包一次解到底），加密包可填密码续跑。'
);
const topbar = A.buildTopbar('extract');
const overlay = A.buildTabbar('extract');
const dead = A.deadNodes();
const script = A.assertClean(A.scriptForSubpage(), 'extract.html');

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
  '/* 首屏：先拉解压器状态（7z 就绪与否决定用户能不能用）。 */',
  'initEx();',
  '</script>',
  '</body>',
  '</html>',
  '',
].join('\n');

/* ---------- 出站自检：宁可构建失败，也不要产出一版「看着还行其实全废」的页面 ---------- */
const need = ['id="exEnv"', 'id="exUrl"', 'id="exGoUrl"', 'id="exDir"', 'id="exScanBtn"',
  'id="exRunBtn"', 'id="exScanRes"', 'id="exTask"', 'id="exReport"', 'id="exMsg"', 'initEx()'];
const miss = need.filter((s) => out.indexOf(s) < 0);
if (miss.length) throw new Error('[build-extract-page] 产物缺少关键节点：' + miss.join(', '));
if (!/id="navEx"/.test(out)) throw new Error('[build-extract-page] 顶栏缺少 #navEx 入口 —— 请确认主源 <nav class="main-nav"> 里已加该链接。');
if (!/data-m="url"/.test(out) || !/data-m="dir"/.test(out)) throw new Error('[build-extract-page] 缺少两个输入 tab。');
if (/EMU_PAGE_HREF/.test(out)) throw new Error('[build-extract-page] 产物残留 EMU_PAGE_HREF，会导致 ReferenceError。');
if (out.indexOf('<style>') < 0 || out.indexOf('</style>') < 0) throw new Error('[build-extract-page] 样式块不完整。');
/* ★ 为什么检查的是「本页 CSS_EXTRA 的首尾特征」而不是「全产物有没有反引号」：
 *   ① 主源 CSS 的注释里本来就有反引号（既有内容，无害），全量扫描必然误报 —— 已踩到一次；
 *   ② 模板若真被反引号提前闭合，本脚本会直接 SyntaxError，根本跑不到这里。
 *   所以真正需要守的是「我追加的那段样式有没有被截断」。 */
if (CSS_EXTRA.indexOf('.ex-intro{') < 0 || CSS_EXTRA.indexOf('@media(max-width:430px)') < 0) {
  throw new Error('[build-extract-page] CSS_EXTRA 不完整（首/尾特征缺失）—— 请检查样式模板是否被提前闭合。');
}
if (out.indexOf('.ex-env.ok') < 0 || out.indexOf('.ex-pw-it input') < 0) {
  throw new Error('[build-extract-page] 产物里没找到本页专属样式 —— CSS_EXTRA 没被拼进去。');
}

/* ★★ 语法闸门：上面那批自检只验「文本在不在」，验不出「脚本能不能跑」。
 *   实测踩到：{ 7z: '7Z' } 这种键让整段脚本 SyntaxError，结构自检全绿、
 *   浏览器只丢一句 Invalid or unexpected token，整页交互全废。
 *   放在落盘前 —— 编译不过就根本不产出，避免废页被服务读走。 */
A.assertScriptSyntax(out, 'extract.html');

fs.writeFileSync(OUT, out, 'utf8');
console.log('[build-extract-page] 已生成 public/extract.html（' + (out.length / 1024).toFixed(1) + ' KB）');
