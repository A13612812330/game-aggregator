#!/usr/bin/env node
/* 维护 public/resources.html —— 「端游资源」独立页（MOD / 存档 / 修改器）
 *
 * 为什么有这一页（v10.44）：
 *   用户口径：「手游的样式更新下，也需要划分模块 MOD，存档，修改器，
 *             手机专区保留手机中心+机型兼容+模拟器指南」。
 *   ⇒ 三类资源本质是**端游资源**，挂在「手机专区」下语义不成立（用户曾为找存档迷路）。
 *     本页把它们平级抽出来，手机专区回归「手游中心 / 机型兼容 / 模拟器指南」三块。
 *
 * 两个文件的分工（与 build-emulator-page.js 同款机制）：
 *   public/index.html      ← 主源。所有 CSS / 顶栏 / 抽屉 / 通用脚本的唯一编辑入口。
 *   public/resources.html  ← 派生页。含三个资源分区 + 从 index.html 复制的共享资产。
 *
 * 本脚本把 index.html 的**共享资产**（整段 CSS、顶栏、遮罩+抽屉+tabbar、全量脚本）
 * 同步进 resources.html，但**保留本页自己的三个分区与页面骨架**。
 * 改样式只需改 index.html，再跑一次本脚本，两侧不会漂移。
 *
 * ★ 本页与 emulator.html 是**两个不同的派生页**，各自独立生成、互不覆盖。
 *
 * 幂等：可重复运行。
 */
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');
const INDEX = path.join(PUB, 'index.html');
const RES = path.join(PUB, 'resources.html');

const idx = fs.readFileSync(INDEX, 'utf8');
const idxLines = idx.split('\n');

/** 取 text 中匹配 re 的首行行号（1-based） */
function findLine(lines, re, from = 1) {
  for (let i = from - 1; i < lines.length; i++) if (re.test(lines[i])) return i + 1;
  return -1;
}
const cut = (lines, a, b) => lines.slice(a - 1, b).join('\n');

/* ---------- 从 index.html 抽共享资产 ---------- */
const cssA = findLine(idxLines, /^<style>/);
const cssB = findLine(idxLines, /^<\/style>/);
/* ★ 只截到 </style> 的前一行，把闭标签留给组装阶段（与 emulator 生成器同因，
 *   否则追加的「专属 CSS」会落到 </style> 与 </head> 之间被当正文渲染）。 */
const CSS = cut(idxLines, cssA, cssB - 1);

const topA = findLine(idxLines, /<header class="topbar"/);
const topB = findLine(idxLines, /<\/header>/, topA);
const TOPBAR = cut(idxLines, topA, topB);

/* 顶栏导航（派生页语义）：首页回 `/` 真跳转、「端游资源」高亮。
 *   ★ 与 emulator 生成器同因：主源那份「首页」是 href="#rankStage" 死锚点，
 *     脚本又 preventDefault —— 不重写就是点不动的摆设。 */
const TOPBAR_RES = TOPBAR
  .replace('<a href="#rankStage" class="on" id="navHome">🏠 首页</a>',
    '<a href="/" id="navHome">🏠 首页</a>')
  .replace('<a href="/resources.html" id="navRes">🎮 端游资源</a>',
    '<a href="/resources.html" class="on" id="navRes">🎮 端游资源</a>');
if (!/href="\/" id="navHome"/.test(TOPBAR_RES) || !/class="on" id="navRes"/.test(TOPBAR_RES)) {
  throw new Error(
    '[build-resource-page] 顶栏导航重写未命中：public/index.html 的 <nav class="main-nav"> 里\n' +
    '  「🏠 首页 / 🎮 端游资源」两个 <a> 的写法变了。\n' +
    '  请同步本文件里的 TOPBAR_RES，否则派生页顶栏入口会退化成点不动的死锚点。'
  );
}

const maskA = findLine(idxLines, /<div class="mask" id="mask">/);
const tabB = findLine(idxLines, /<\/nav>/, findLine(idxLines, /<nav class="tabbar"/));
const OVERLAY = cut(idxLines, maskA, tabB);

/* 本页自己的底部 Tab（≤760px 显示）。
 *   主源那份是首页语义（热榜/最新/搜索/手机专区/端游资源/关于）——
 *   「最新」「关于」在独立页指向不存在的节点，点了几何无反应。
 *   换成三项：🏠 首页（真链接，不写 data-tab 就不会被拦）/ 🎮 端游资源（当前，高亮）/ 🔍 搜索。 */
const TABBAR_RES = `<nav class="tabbar" id="tabbar" aria-label="移动端导航">
  <a href="/" aria-label="首页"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.6 12 3.4l9 7.2"/><path d="M5.6 9.4V19a1.6 1.6 0 0 0 1.6 1.6h3.3V15h3v5.6h3.3A1.6 1.6 0 0 0 18.4 19V9.4"/></svg>首页</a>
  <a href="#" data-tab="md" id="tabRes" class="on" aria-label="端游资源"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h18v12H3z"/><path d="M3 8l2-4h14l2 4"/><path d="M12 4v16"/></svg>端游资源</a>
  <a href="#" data-tab="search" aria-label="搜索"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>搜索</a>
</nav>`;
const OVERLAY_RES = OVERLAY.replace(/<nav class="tabbar"[\s\S]*?<\/nav>/, TABBAR_RES);
if (OVERLAY_RES === OVERLAY) {
  throw new Error('[build-resource-page] 底部 Tab 重写未命中：public/index.html 里 <nav class="tabbar"> 的写法变了。');
}

/* 搜索弹层：位于 </footer> 之后、#mask 之前，不属于任何 <main> —— 单独抽出来。
 *   缺了它会抛 "addEventListener of null" 并中断整段脚本（页签全废）。 */
const smaskA = findLine(idxLines, /<!-- =+ 🔍 搜索弹窗/);
const smaskB = findLine(idxLines, /<div class="mask" id="mask">/, smaskA) - 1;
const SEARCH = smaskA > 0 ? cut(idxLines, smaskA, smaskB) : '';

/* 榜单工具条 / 索引按钮：脚本顶层绑定了它们 → 用隐藏容器补齐 DOM 依赖 */
const rankPA = findLine(idxLines, /<div class="stage-pills" id="rankPills">/);
const rankPB = findLine(idxLines, /<\/div>/, findLine(idxLines, /id="rankRefresh"/, rankPA));
const RANKBAR = rankPA > 0
  ? `<!-- 独立页无热榜分区：这里只为满足通用脚本的 DOM 依赖，整块隐藏 -->\n<div class="emu-deadnodes" hidden aria-hidden="true">\n${cut(idxLines, rankPA, rankPB)}\n</div>`
  : '';

const idxBtnA = findLine(idxLines, /id="idxBtn"/);
const idxBtnB = findLine(idxLines, /id="jidiBtn"/, idxBtnA);
const IDXBTNS = idxBtnA > 0
  ? `<div class="emu-deadnodes" hidden aria-hidden="true">\n${cut(idxLines, idxBtnA - 1, findLine(idxLines, /<\/div>/, idxBtnB))}\n</div>`
  : '';

/* 三个分区的驱动脚本（从 tools/resource-sections.js 读入） */
const SECTIONS_JS = fs.readFileSync(path.join(__dirname, 'resource-sections.js'), 'utf8');

/* ★ 幂等哨兵：锚在长期存在的符号上（initMd）。
 *   与 emulator 生成器同坑：哨兵若挂在会被删掉的函数上，每跑一次就重复注入一整份。 */
const SEC_SENTINEL = /function initMd\s*\(/;
const secBlock = () => (SEC_SENTINEL.test(JS) ? '' : '\n' + SECTIONS_JS + '\n');

const jsA = findLine(idxLines, /^<script>/);
const jsB = findLine(idxLines, /^<\/script>/, jsA);
/* 只取 <script> 与 </script> 之间，避免追加内容落到标签外成裸文本 */
const JS_BODY = cut(idxLines, jsA + 1, jsB - 1);

/* head 骨架从**主源**取（稳定、不含注入物），再覆盖本页自己的 title / description */
const idxHeadA = findLine(idxLines, /^<head>/);
const idxHeadB = findLine(idxLines, /^<style>/);
const HEAD_LINES = cut(idxLines, idxHeadA, idxHeadB - 1).split('\n');
{
  const TITLE = '端游资源 · MOD / 存档 / 修改器 — GameHub';
  const DESC = 'PC 游戏 MOD、存档位置、修改器一站式查询。MOD 带网盘直链，存档给出文件路径与云同步支持，修改器标注来源与获取方式。';
  const ti = HEAD_LINES.findIndex((l) => /<title>/.test(l));
  if (ti >= 0) HEAD_LINES[ti] = `<title>${TITLE}</title>`;
  const di = HEAD_LINES.findIndex((l) => /<meta name="description"/.test(l));
  if (di >= 0) HEAD_LINES[di] = `<meta name="description" content="${DESC}">`;
}

/* ================= 本页三个分区（骨架常量，幂等重建）=================
 * ★★ 血教训：分区 HTML 绝不从派生页自身读取（丢了就幂等固化、永远回不来）——
 *    一律在生成器里硬编码，每次从这份常量重建。
 * 约束：所有 id 必须与 resource-sections.js 里 getElementById 的取值一一对应，
 *       否则某个 init 拿不到节点 → 切过去一片空白。已由文件末尾「出站自检」强制校验。 */

/* ① MOD（#mods）：机地社区 MOD 专区帖，带网盘直链 */
const MODS_HTML = `
<main class="wrap" id="mods" data-et="md">
  <div class="sec-h"><span class="bar md"></span><h2>MOD</h2><span class="en">MODS</span><span class="more" id="mdCount"></span></div>
  <div class="emu-intro md">
    <span class="ic">🧩</span>
    <div class="tx">
      <b>PC 游戏 MOD，一处查全</b>——数据来自<b>机地社区 MOD 专区</b>，每条都带<b>网盘直链</b>，
      点「打开源站帖」或盘口按钮即可取件；能对上端游库的<b>直接点进游戏详情</b>。
      <span style="opacity:.75">本站只做聚合与指路，<b>不转存、不提供文件</b>。装 MOD 前请先备份存档。</span>
      <span id="mdBuilt" style="opacity:.75"></span>
    </div>
  </div>
  <div class="emu-stats" id="mdStats"></div>
  <div class="emu-bar">
    <div class="emu-bar-row">
      <input class="emu-search" id="mdSearch" type="text" placeholder="搜索：赛博朋克2077 / 艾尔登法环 / 剑星…" autocomplete="off">
    </div>
    <div class="emu-bar-row">
      <span class="emu-bar-lb">排序</span>
      <div class="emu-sorts" id="mdSorts">
        <button class="emu-sort on" data-s="new" type="button">最新发布</button>
        <button class="emu-sort" data-s="hot" type="button">最热</button>
        <button class="emu-sort" data-s="game" type="button">按游戏</button>
      </div>
      <span class="emu-bar-sp"></span>
      <button class="emu-refresh md on em-tg" id="mdToggleLib" type="button" title="只显示能对上端游库的游戏">仅看匹配端游</button>
    </div>
  </div>
  <div class="emu-grid md" id="mdGrid"></div>
  <button class="load-more" id="mdMore" style="display:none">加载更多</button>
</main>`;

/* ② 存档（#resSaves）：Ludusavi 存档位置库（正文与 emulator 版逐字一致，仅默认口径放宽） */
const SAVES_HTML = `
<main class="wrap et-hide" id="resSaves" data-et="sv">
  <div class="sec-h"><span class="bar sv"></span><h2>存档</h2><span class="en">SAVE DATA</span><span class="more" id="svCount"></span></div>
  <div class="emu-intro sv">
    <span class="ic">💾</span>
    <div class="tx">
      <b>存档到底放在哪？</b>——这张表给出每款游戏的<b>存档文件位置</b>与<b>注册表存档项</b>，
      照着路径就能备份、迁移、跨设备接档；同时标出<b>是否支持云同步</b>（Steam / GOG / Epic / Origin…）。
      数据来自开源存档清单 <b>Ludusavi</b>（MIT 许可，社区长期维护）。
      <span style="opacity:.75">路径里的 <code>&lt;用户名&gt;</code> 换成你自己的系统用户名即可；模拟器里则是虚拟 C 盘下的同一路径。</span>
      <span id="svBuilt" style="opacity:.75"></span>
    </div>
  </div>
  <div class="emu-stats" id="svStats"></div>
  <div class="emu-bar">
    <div class="emu-bar-row">
      <input class="emu-search" id="svSearch" type="text" placeholder="搜索：艾尔登法环 / ELDEN RING / 博德之门3…" autocomplete="off">
    </div>
    <div class="emu-bar-row">
      <span class="emu-bar-lb">排序</span>
      <div class="emu-sorts" id="svSorts">
        <button class="emu-sort on" data-s="paths" type="button" title="存档项多的游戏优先">存档最多</button>
        <button class="emu-sort" data-s="cloud" type="button">云同步优先</button>
        <button class="emu-sort" data-s="name" type="button">名称</button>
      </div>
      <span class="emu-bar-sp"></span>
      <button class="emu-refresh sv em-tg" id="svPhone" type="button" title="只显示手游中心里能玩的游戏">仅看手机能玩</button>
      <button class="emu-refresh sv em-tg" id="svCloud" type="button" title="只显示支持云同步的游戏">仅看云同步</button>
    </div>
  </div>
  <div class="emu-grid sv" id="svGrid"></div>
  <button class="load-more" id="svMore" style="display:none">加载更多</button>
</main>`;

/* ③ 修改器（#resTrainers）：GCM 公开清单元数据（正文与 emulator 版逐字一致） */
const TRAINERS_HTML = `
<main class="wrap et-hide" id="resTrainers" data-et="tr">
  <div class="sec-h"><span class="bar tr"></span><h2>修改器</h2><span class="en">TRAINERS</span><span class="more" id="trCount"></span></div>
  <div class="emu-intro tr">
    <span class="ic">🛠</span>
    <div class="tx">
      <b>单机游戏修改器，一处查全</b>——数据来自 <b>Game Cheats Manager</b> 的公开清单，
      汇总 <b>5 个来源</b>：<b>风灵月影</b>（业界标准、数量最多）、<b>CE 修改表</b>、<b>社区贡献</b>、<b>小幸修改器</b>、<b>GCM 精选</b>。
      每条都标了<b>来源与版本</b>，并<b>自动关联端游库</b>——能对上库的可以直接点进游戏详情。
      <span style="opacity:.75">本站<b>不托管修改器文件</b>：官方下载走的是一次性签名链接，无法离线复现，请用卡片上的「获取方式」到官方渠道取。</span>
      <span id="trBuilt" style="opacity:.75"></span>
    </div>
  </div>
  <div class="emu-stats" id="trStats"></div>
  <div class="emu-bar">
    <div class="emu-bar-row">
      <input class="emu-search" id="trSearch" type="text" placeholder="搜索：艾尔登法环 / ELDEN RING / 只狼…" autocomplete="off">
      <select class="emu-sel" id="trSource"><option value="">全部来源</option></select>
    </div>
    <div class="emu-bar-row">
      <span class="emu-bar-lb">排序</span>
      <div class="emu-sorts" id="trSorts">
        <button class="emu-sort on" data-s="lib" type="button" title="能对上端游库（有封面、点得进详情）的优先">匹配优先</button>
        <button class="emu-sort" data-s="zh" type="button">中文名</button>
        <button class="emu-sort" data-s="name" type="button">英文名</button>
        <button class="emu-sort" data-s="source" type="button">按来源</button>
      </div>
      <span class="emu-bar-sp"></span>
      <button class="emu-refresh tr on em-tg" id="trToggleLib" type="button" title="只显示能对上端游库的游戏">仅看匹配端游</button>
    </div>
  </div>
  <div class="emu-grid tr" id="trGrid"></div>
  <button class="load-more" id="trMore" style="display:none">加载更多</button>
</main>`;

/* 页签切换条：本页骨架，脚本重建（id 与 resource-sections.js 约定一致）
 *   顺序：MOD → 存档 → 修改器（用户口径的列举顺序）。 */
const BACKBAR = `<div class="wrap page-back">
  <div class="emu-tabs" id="resTabs">
    <button class="res-tab on" data-et="md" type="button"><b id="tabNumMd">—</b><span>MOD</span></button>
    <button class="res-tab" data-et="sv" type="button"><b id="tabNumSv">—</b><span>存档</span></button>
    <button class="res-tab" data-et="tr" type="button"><b id="tabNumTr">—</b><span>修改器</span></button>
  </div>
</div>`;

/* 独立页专属脚本：子页签切换 + 数字回填 */
const TAB_JS = `/* ================= 🎮 端游资源 · 子页签（独立页） =================
   v10.44：MOD(#mods) / 存档(#resSaves) / 修改器(#resTrainers) 三个平级页签。
   URL hash 同步：/resources.html#md / #sv / #tr（非法值归一为 #md）
*/
const ET_MAP = { md: '#mods', sv: '#resSaves', tr: '#resTrainers' };
let etCur = 'md';

/* 主脚本底部 Tab 的 emu 分支会调 goEmuPage()，那个定义在「独立页跳转块」里、
   本页已把整块替换掉 —— 补一个，万一被调到就是回手机专区（而不是 ReferenceError）。 */
function goEmuPage() { location.href = '/emulator.html'; }

/** 各分区懒加载入口（在 initXxx 声明之后调用，避免 TDZ） */
function etInit(t) {
  if (t === 'md') return initMd();
  if (t === 'sv') return initSv();
  if (t === 'tr') return initTr();
}

function switchResTab(t, opts) {
  if (!ET_MAP[t]) return;
  etCur = t;
  for (const [k, sel] of Object.entries(ET_MAP)) {
    const el = document.querySelector(sel);
    if (el) el.classList.toggle('et-hide', k !== t);
  }
  document.querySelectorAll('#resTabs .res-tab').forEach((b) => b.classList.toggle('on', b.dataset.et === t));
  try { etInit(t); } catch (e) {}
  if (opts && opts.scroll !== false) window.scrollTo({ top: 0, behavior: 'smooth' });
}
/* 顶栏「端游资源」入口：本页已在资源页，改为切「MOD」 */
(function bindNavRes() {
  const el = document.getElementById('navRes'); if (!el) return;
  el.setAttribute('href', '#md');
  el.addEventListener('click', (e) => { e.preventDefault(); switchResTab('md'); });
})();
/** 子页签数字回填（MOD 条数 / 存档收录数 / 修改器条数） */
async function fillTabNums() {
  const set = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.textContent = Number(v).toLocaleString(); };
  try { const s = await fetch(api('/api/mods/stats')).then((r) => r.json()); if (s && s.byKind) set('tabNumMd', s.byKind.mod || s.total); } catch (e) {}
  try { const s = await fetch(api('/api/saves/stats')).then((r) => r.json()); if (s && s.total != null) set('tabNumSv', s.total); } catch (e) {}
  try { const s = await fetch(api('/api/trainers/stats')).then((r) => r.json()); if (s && s.total != null) set('tabNumTr', s.total); } catch (e) {}
}
/* 底部 Tab */
const tb = document.getElementById('tabbar');
if (tb) tb.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-tab]'); if (!a) return;
  const t = a.dataset.tab;
  if (Object.prototype.hasOwnProperty.call(ET_MAP, t)) { e.preventDefault(); switchResTab(t); }
});
/* 切换条点击 */
document.getElementById('resTabs').addEventListener('click', (e) => {
  const b = e.target.closest('.res-tab'); if (!b) return;
  switchResTab(b.dataset.et);
});
/* 首屏：按 hash 决定进哪个页签，默认 MOD */
(function bootTab() {
  const t = location.hash.slice(1);
  switchResTab(ET_MAP[t] ? t : 'md', { scroll: false });
  fillTabNums();
})();
`;

let JS = JS_BODY;

/* ---------- 脚本适配：独立页没有热榜/最新/分类/右栏，且要自管子页签 ---------- */
JS = JS
  .replace(/^\s*refreshRank\([^)]*\);.*$/m, '  /* refreshRank：独立页无热榜分区，跳过 */')
  .replace(/^\s*bindRankUI\(\);.*$/m, '  /* bindRankUI：独立页无榜单 UI，跳过 */')
  .replace(/^\s*renderSide\(\);.*$/m, '  /* renderSide：独立页无右栏，跳过 */')
  .replace(/^\s*renderCats\(\);.*$/m, '  /* renderCats：独立页无分类行，跳过 */')
  .replace(/^\s*renderList\([^)]*\);.*$/m, '  /* renderList：独立页无最新收录列表，跳过 */')
  /* ① 把整段「手机模拟器专区（独立页跳转）」换成 SECTIONS_JS + TAB_JS（标记行匹配最稳） */
  .replace(/\/\* ================= 📱 手机模拟器专区（独立页跳转）[\s\S]*?\/\* \[派生页锚点\][^\n]*\n/m,
    () => secBlock() + TAB_JS)
  .replace(/\/\* ================= 📱 手机模拟器专区（独立页跳转）[\s\S]*?\n\}\)\(\);/m,
    () => secBlock() + TAB_JS)
  /* ② 摘掉引导卡数字回填（独立页没有引导卡） */
  .replace(/\/\* 引导卡上的两个数字[\s\S]*?\n\}\)\(\);/m, '/* 引导卡数字回填：独立页无引导卡，改由 fillTabNums 处理 */');

if (!/function switchResTab/.test(JS)) {
  JS += '\n/* [build-resource-page] 兜底追加：首页跳转块未匹配到，直接补上子页签脚本 */\n' + TAB_JS;
}
if (/EMU_PAGE_HREF/.test(JS)) {
  throw new Error(
    '[build-resource-page] 首页「手机模拟器专区（独立页跳转）」块未能匹配替换，\n' +
    '  EMU_PAGE_HREF 残留到派生页会导致 ReferenceError。\n' +
    '  请检查 public/index.html 中该注释块与 [派生页锚点] 标记行是否被改动。'
  );
}
if (!SEC_SENTINEL.test(JS)) JS = secBlock() + JS;

/* ---------- 组装 ---------- */
const out = [
  ...HEAD_LINES,
  CSS,
  `  /* ===== 独立页专属：一条 3 页签切换条（.res-tabs / .res-tab） =====
   *  ★ 为什么另起 .res-* 而不是复用 #emuTabs/.emu-tab：那是手机专区页的骨架选择器，
   *    本页是**另一张页面**，复用会让「改手机专区页签样式」意外改到这里。
   *    视觉语言保持一致（灰轨 + 白块 + 渐变选中），类名独立、互不牵连。 */
  .page-back{display:flex;align-items:center;gap:12px;padding:14px 0 0;flex-wrap:wrap}
  #resTabs{display:flex;gap:4px;padding:4px;background:#EEF1F7;border:1px solid var(--c-border);
    border-radius:13px;max-width:100%;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}
  #resTabs::-webkit-scrollbar{display:none}
  #resTabs .res-tab{display:inline-flex;align-items:center;gap:7px;flex:none;min-width:0;
    padding:8px 16px;border:none;border-radius:10px;background:transparent;cursor:pointer;
    font:650 12.5px/1 var(--font);color:var(--c-t2);white-space:nowrap;transition:.15s;
    -webkit-tap-highlight-color:transparent}
  #resTabs .res-tab:hover{background:rgba(255,255,255,.7);color:var(--c-t1)}
  #resTabs .res-tab b{font:800 11.5px/1 var(--font-num);color:#6D28D9;background:rgba(124,58,237,.10);
    padding:3px 7px;border-radius:6px;min-width:22px;text-align:center}
  #resTabs .res-tab span{color:inherit}
  #resTabs .res-tab.on{background:linear-gradient(135deg,#7C3AED,#4F46E5);color:#fff;
    box-shadow:0 3px 10px rgba(124,58,237,.30)}
  #resTabs .res-tab.on b{background:rgba(255,255,255,.22);color:#fff}
  @media(max-width:760px){
    .page-back{gap:9px}
    #resTabs{margin-left:0;width:100%}
    #resTabs .res-tab{flex:1;padding:8px 6px;gap:5px;font-size:12px;justify-content:center}
    /* 窄屏收起页签数字胶囊（分区标题有「共 N 款」兜底），与手机专区页同款紧凑规则 */
    #resTabs .res-tab b{display:none}
  }
  @media(max-width:430px){
    /* 超窄屏：字号再收一档；存档路径长，网格收敛为单列（两列会挤断） */
    #resTabs .res-tab{font-size:10.5px;padding:8px 3px}
    .emu-grid.sv{grid-template-columns:1fr}
  }

  /* ===== MOD 分区专属（卡片上的盘口按钮行）=====
     盘口配色与详情页下载弹窗的 .lk 同源语义（迅雷蓝 / 百度蓝 / 夸克紫…），
     一处定义，两处读起来一致。 */
  .emu-card.md .md-lk{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}
  .emu-card.md .md-lk .lk{font-size:10.5px;font-weight:750;color:#fff;background:#8892A6;
    border-radius:6px;padding:4px 8px;text-decoration:none;white-space:nowrap;transition:.14s}
  .emu-card.md .md-lk .lk:hover{filter:brightness(1.12)}
  .emu-card.md .md-lk .lk.bd-baidu{background:#2B6DE5}
  .emu-card.md .md-lk .lk.bd-xunlei{background:#2A6FD6}
  .emu-card.md .md-lk .lk.bd-quark{background:#5A6BF5}
  .emu-card.md .md-lk .lk.bd-189{background:#1A73E8}
  .emu-card.md .md-lk .lk.bd-139{background:#0FA968}
  .emu-card.md .md-lk .lk.bd-ali{background:#5B6BF0}
  .emu-card.md .md-lk .lk.bd-123{background:#3C7DF5}
  .emu-card.md .md-lk .lk.bd-lanzou{background:#4C8BF5}
  .emu-card.md .md-lk .lk.bd-steam{background:#1B2838}
  .emu-card.md .md-lk .lk.bd-uc{background:#3C7DF5}
  .emu-card.md .md-lk .lk.bd-pikpak{background:#3D5AFE}
  .emu-card.md .md-lk .lk.bd-other{background:#9AA3B5}
  .emu-card.md .md-lk .lk-more{font-size:10.5px;font-weight:700;color:var(--c-t3);padding:4px 4px}
  .emu-card.md .md-go{margin-top:7px}
  .emu-card.md .md-go a{font-size:11px;font-weight:700;color:var(--c-primary);text-decoration:none}
  .emu-card.md .md-go a:hover{text-decoration:underline}
  /* MOD 分区的分区主色（青蓝），与存档天蓝 / 修改器青绿区分开 */
  .bar.md{background:linear-gradient(90deg,#2E6BFF,#4F8CFF)}
  .emu-intro.md{background:linear-gradient(135deg,#EEF4FF,#F7FAFF);border-color:#D8E4FF}
  .emu-refresh.md.on{background:rgba(46,107,255,.1);border-color:rgba(46,107,255,.34);color:var(--c-primary)}
  .emu-card.md .tg.md{background:rgba(46,107,255,.1);color:var(--c-primary)}
</style>
</head>
<body data-page="resources">
`,
  TOPBAR_RES,
  '',
  BACKBAR,
  '',
  MODS_HTML,
  SAVES_HTML,
  TRAINERS_HTML,
  '',
  SEARCH,
  '',
  RANKBAR,
  IDXBTNS,
  '',
  OVERLAY_RES,
  '',
  '<script>',
  JS,
  '</script>',
  '</body>',
  '</html>',
].join('\n');

/* ---------- 出站自检 1：分区 JS 要的 id 必须都在页面里 ---------- */
{
  const secSrc = fs.readFileSync(path.join(__dirname, 'resource-sections.js'), 'utf8');
  const need = [...new Set([...secSrc.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]))];
  const missing = need.filter((id) => !out.includes(`id="${id}"`));
  if (missing.length) {
    throw new Error(
      '[build-resource-page] 以下 id 被 resource-sections.js 引用，但产物里不存在：\n' +
      '  ' + missing.join(', ') + '\n' +
      '  这些分区的 init 会拿不到节点，表现为「切过去一片空白」。'
    );
  }
}

/* ---------- 出站自检 2：每个可切换分区都必须有 data-et ---------- */
{
  const mains = [...out.matchAll(/<main\b[^>]*>/g)].map((m) => m[0]);
  for (const tag of mains) {
    const id = (tag.match(/id="([^"]+)"/) || [])[1];
    if (!/data-et="/.test(tag)) {
      throw new Error(
        `[build-resource-page] <main id="${id}"> 缺少 data-et 属性。\n` +
        '  main[data-et].et-hide 依赖它，缺了会导致切换时该分区隐藏不掉。'
      );
    }
  }
}

/* ---------- 出站自检 3：CSS 必须整段在 <style> 内 ---------- */
{
  const s0 = out.indexOf('<style>');
  const s1 = out.indexOf('</style>');
  if (s0 < 0 || s1 < 0) throw new Error('[build-resource-page] <style> 标签缺失');
  const leaked = out.slice(s1 + 8, out.indexOf('</head>'));
  if (/\{[\s\S]*\}/.test(leaked) && /[.#@][\w-]/.test(leaked)) {
    throw new Error(
      '[build-resource-page] 检测到 CSS 泄漏到 </style> 之外（会被当正文显示）。\n' +
      '  请确认组装数组里「专属 CSS」位于 `</style>` 之前。'
    );
  }
}

fs.writeFileSync(RES, out, 'utf8');
console.log(`✅ 已生成 public/resources.html`);
console.log(`   CSS ${CSS.length}B ｜ 顶栏 ${TOPBAR.length}B ｜ 抽屉+tabbar ${OVERLAY.length}B ｜ 脚本 ${JS.length}B`);
console.log(`   三分区 MOD ${MODS_HTML.length}B ＋ 存档 ${SAVES_HTML.length}B ＋ 修改器 ${TRAINERS_HTML.length}B 与 3 页签切换条`);
