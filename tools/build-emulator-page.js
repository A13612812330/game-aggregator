#!/usr/bin/env node
/* 维护 public/emulator.html —— 手机专区独立页
 *
 * 背景：
 *   最早「社区配置 / 实测配置 / 模拟器指南」是首页内的三个子页签（只切 display），
 *   三个分区仍内联在首页，首页被拉得很长。后来改成独立页 /emulator.html，
 *   首页只留一张引导卡。
 *
 * 两个文件的分工（重要）：
 *   public/index.html    ← 主源。所有 CSS / 顶栏 / 抽屉 / 通用脚本的唯一编辑入口。
 *   public/emulator.html ← 派生页。含三个手机分区 + 从 index.html 复制的共享资产。
 *
 * 本脚本负责把 index.html 里的**共享资产**（整段 CSS、顶栏、遮罩+抽屉+tabbar、全量脚本）
 * 同步进 emulator.html，但**保留 emulator.html 自己的三个分区与页面骨架**。
 * 这样改样式只需改 index.html，再跑一次本脚本，两侧不会漂移。
 *
 * 幂等：可重复运行。
 */
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');
const INDEX = path.join(PUB, 'index.html');
const EMU = path.join(PUB, 'emulator.html');

const idx = fs.readFileSync(INDEX, 'utf8');
const emu = fs.readFileSync(EMU, 'utf8');

const linesOf = (t) => t.split('\n');
const idxLines = linesOf(idx);
const emuLines = linesOf(emu);

/** 取 text 中匹配 re 的首行行号（1-based） */
function findLine(lines, re, from = 1) {
  for (let i = from - 1; i < lines.length; i++) if (re.test(lines[i])) return i + 1;
  return -1;
}
const cut = (lines, a, b) => lines.slice(a - 1, b).join('\n');

/* ---------- 从 index.html 抽共享资产 ---------- */
const cssA = findLine(idxLines, /^<style>/);
const cssB = findLine(idxLines, /^<\/style>/);
/* ★ 只截到 </style> 的**前一行**，把闭标签留给组装阶段。
 *   坑（v9.1 修复）：早先 CSS 常量含 `</style>`，而组装数组又在它之后追加
 *   「独立页专属 CSS」——那段 CSS 就落在 `</style>` 与 `</head>` 之间，
 *   浏览器把纯文本当正文渲染，页面顶部糊了一屏 CSS 源码、样式却全没生效。
 *   现在：CSS(不含闭标签) + 专属 CSS + `</style>` 一起出，保证都在 style 内。 */
const CSS = cut(idxLines, cssA, cssB - 1);

const topA = findLine(idxLines, /<header class="topbar"/);
const topB = findLine(idxLines, /<\/header>/, topA);
const TOPBAR = cut(idxLines, topA, topB);

/* 派生页的顶栏导航：语义与首页不同。
 *   首页那份：<a href="#rankStage" class="on" id="navHome">🏠 首页</a>
 *     —— 首页的「首页」＝回顶部（同页锚点），所以标 on 且被脚本拦成 scrollTo。
 *   专区这份：href 必须是**真跳转回聚合首页**，且高亮应落在「📱 手机专区」上。
 *   ★ 不重写：href="#rankStage" 在专区页是死锚点、脚本又 preventDefault 掉跳转，
 *     顶栏「首页」就成了点不动的摆设 —— 这正是页内又加「← 返回聚合首页」按钮的原因。
 *     一个出口只该出现一次，所以这里把顶栏修好、按钮删掉（见 BACKBAR）。 */
const TOPBAR_EMU = TOPBAR
  .replace('<a href="#rankStage" class="on" id="navHome">🏠 首页</a>',
    '<a href="/" id="navHome">🏠 首页</a>')
  .replace('<a href="/emulator.html" id="navEmu">📱 手机专区</a>',
    '<a href="/emulator.html" class="on" id="navEmu">📱 手机专区</a>');
if (!/href="\/" id="navHome"/.test(TOPBAR_EMU) || !/class="on" id="navEmu"/.test(TOPBAR_EMU)) {
  throw new Error(
    '[build-emulator-page] 顶栏导航重写未命中：public/index.html 的 <nav class="main-nav"> 里\n' +
    '  「🏠 首页 / 📱 手机专区」两个 <a> 的写法变了。\n' +
    '  请同步本文件里的 TOPBAR_EMU，否则派生页顶栏「首页」会退化成点不动的死锚点。'
  );
}

const maskA = findLine(idxLines, /<div class="mask" id="mask">/);
const tabB = findLine(idxLines, /<\/nav>/, findLine(idxLines, /<nav class="tabbar"/));
const OVERLAY = cut(idxLines, maskA, tabB);

/* 派生页自己的底部 Tab（≤760px 显示）。
 *   主源那份是**首页语义**：热榜 / 最新 / 搜索 / 手机专区 / 关于。
 *   搬到专区页后：「最新」「关于」指向首页才有的节点（点了几何无反应，是死链），
 *   而顶栏 .main-nav 在 ≤760px 是 display:none —— 于是**窄屏进来就再也回不去首页**。
 *   换成三项：
 *     🏠 首页      → href="/" 真链接；故意**不写 data-tab**，脚本就不会 preventDefault 它
 *     📱 手机专区  → 当前所在（高亮），点击切回「手游中心」页签
 *     🔍 搜索      → 打开搜索弹窗（复用主脚本的 search 分支） */
const TABBAR_EMU = `<nav class="tabbar" id="tabbar" aria-label="移动端导航">
  <a href="/" aria-label="首页"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.6 12 3.4l9 7.2"/><path d="M5.6 9.4V19a1.6 1.6 0 0 0 1.6 1.6h3.3V15h3v5.6h3.3A1.6 1.6 0 0 0 18.4 19V9.4"/></svg>首页</a>
  <a href="#" data-tab="emu" id="tabEmu" class="on" aria-label="手机专区"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18.5h2"/></svg>手机专区</a>
  <a href="#" data-tab="search" aria-label="搜索"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>搜索</a>
</nav>`;
const OVERLAY_EMU = OVERLAY.replace(/<nav class="tabbar"[\s\S]*?<\/nav>/, TABBAR_EMU);
if (OVERLAY_EMU === OVERLAY) {
  throw new Error('[build-emulator-page] 底部 Tab 重写未命中：public/index.html 里 <nav class="tabbar"> 的写法变了。');
}

/* 搜索弹层：它在 index.html 里位于 </footer> 之后、#mask 之前，
 * 不属于任何 <main>，所以上面切分收不到 —— 但通用脚本会绑定 #searchInput/#smask/#smClear，
 * 缺了它独立页会抛 "addEventListener of null" 并中断整段脚本（子页签全废）。
 * 这里单独抽出来，插到 OVERLAY 之前。 */
const smaskA = findLine(idxLines, /<!-- =+ 🔍 搜索弹窗/);
const smaskB = findLine(idxLines, /<div class="mask" id="mask">/, smaskA) - 1;
const SEARCH = smaskA > 0 ? cut(idxLines, smaskA, smaskB) : '';

/* 榜单工具条（#rankPills / #rankRefresh）：在热榜 <main> 内，独立页没有热榜，
 * 但脚本顶层就绑了它们 → 同样必须补齐，否则脚本中断。用一个隐藏容器装进去。 */
const rankPA = findLine(idxLines, /<div class="stage-pills" id="rankPills">/);
const rankPB = findLine(idxLines, /<\/div>/, findLine(idxLines, /id="rankRefresh"/, rankPA));
const RANKBAR = rankPA > 0
  ? `<!-- 独立页无热榜分区：这里只为满足通用脚本的 DOM 依赖，整块隐藏 -->\n<div class="emu-deadnodes" hidden aria-hidden="true">\n${cut(idxLines, rankPA, rankPB)}\n</div>`
  : '';

/* 索引维护按钮（#idxBtn / #calBtn / #jidiBtn）同理：属于「关于」区，独立页没有 */
const idxBtnA = findLine(idxLines, /id="idxBtn"/);
const idxBtnB = findLine(idxLines, /id="jidiBtn"/, idxBtnA);
const IDXBTNS = idxBtnA > 0
  ? `<div class="emu-deadnodes" hidden aria-hidden="true">\n${cut(idxLines, idxBtnA - 1, findLine(idxLines, /<\/div>/, idxBtnB))}\n</div>`
  : '';

/* 三个分区的驱动脚本（initEmu/initEg/initDm 等）随主页面的手机 JS 一起被删过，
 * 必须补回，否则 TAB_JS 里的懒加载调用全是空转、三个分区永远空着。
 * ★ 顺序：SECTIONS_JS 声明 emuState/egState/dmState，TAB_JS 末尾 bootTab()
 *   立即执行并调 initEmu() 读 emuState → 必须 SECTIONS 在前（否则 TDZ）。
 *   因为 JS_BODY 在后面才声明，这里用一个函数惰性求值。
 *   ⚠️ 哨兵见下方 SEC_SENTINEL（勿再用 initPc，v9.3 已删除该函数 → 坑 11）。
 */
/* ★ 幂等哨兵：判断 SECTIONS_JS 是否已在 JS 里。
 *   ⚠️ 坑 11（v9.3 踩到）：原先用 `function initPc` 作哨兵，本版把实测配置分区
 *      （含 initPc）合并掉之后，哨兵永久为假 → 每跑一次生成器就**重复注入一整份
 *      SECTIONS_JS**，派生页出现 `Identifier 'EMU_PAGE_SIZE' has already been declared`
 *      直接整页 JS 崩掉。哨兵必须锚在**长期存在**的符号上。
 *      这里用 initEmu —— 只要手游中心分区还在，它就在。 */
const SEC_SENTINEL = /function initEmu\s*\(/;

const secBlock = () => (SEC_SENTINEL.test(JS) ? '' : '\n' + SECTIONS_JS + '\n');

const jsA = findLine(idxLines, /^<script>/);
const jsB = findLine(idxLines, /^<\/script>/, jsA);
/* 只取 <script> 与 </script> **之间** 的内容：
 *   上面 cut(lines, a, b) 是「含两端行」的，直接用会把 </script> 也带进来，
 *   于是后面追加的 TAB_JS / SECTIONS_JS 全落到了标签外面（成了页面上的裸文本）。
 *   这里改成左右各收一行，保证追加的内容始终在脚本内部。
 */
const JS_BODY = cut(idxLines, jsA + 1, jsB - 1);

/* 三个分区的驱动脚本（独立页专属，从 tools/emulator-sections.js 读入） */
const SECTIONS_JS_PATH = path.join(__dirname, 'emulator-sections.js');
const SECTIONS_JS = fs.readFileSync(SECTIONS_JS_PATH, 'utf8');

const TabSection = 'sections';
const TAB_JS = `/* ================= 📱 手机专区 · 子页签（独立页） =================
   v9.1 改版：**只有一条切换条**，4 个平级页签 —— 不再有"二级切换条"。
     手游中心(#emulator) / 模拟器指南(#emuguide) / 机型兼容(#devmatch)

   为什么去掉二级：v9.0 的「3 主页签 + 1 二级条」在非"兼容·指南"页签上
   仍常驻显示那条二级条，点它却什么也看不到（目标分区还是 et-hide）——
   看起来能点其实没反应。现在四个页面平级，点哪个切哪个，所见即所得。

   ★ v9.3：原「手游可玩(#emulator)」与「实测配置(#phonecfg)」**合并为「手游中心」**，
          实测库视角并入合并索引（见 SECTIONS 注释）。页签由 4 个减为 3 个，
          #pc 路由保留为**兼容别名**（旧链接 #pc 会落到 #emu，不会白屏）。

   ★ v10：新增 **修改器(#trainers)** 与 **云存档(#saves)** —— 共 **5 个平级页签**。

   URL hash 同步：/emulator.html#emu / #tr / #sv / #eg / #dm（#pc 归一为 #emu）
*/
const ET_MAP = { emu: '#emulator', tr: '#trainers', sv: '#saves', eg: '#emuguide', dm: '#devmatch' };
let etCur = 'emu';

/* ★ v10.2 修的孤儿调用：主脚本（两页共用）里底部 Tab 的 emu/pc/eg 分支会调 goEmuPage()，
   但那个函数定义在「独立页跳转块」里，派生页把整块换掉了 —— 于是这里只剩调用点，
   每点一次底部「手机专区」就抛一次 ReferenceError（页面勉强还能用，控制台一直报）。
   本页已经在专区里，正确语义是**切页签**而不是再跳一次。 */
function goEmuPage(t) { switchEmuTab(t === 'pc' ? 'emu' : t); }

/** 各分区懒加载入口（在 initXxx 声明之后调用，避免 TDZ） */
function etInit(t) {
  if (t === 'emu') return initEmu();
  if (t === 'tr') return initTr();
  if (t === 'sv') return initSv();
  if (t === 'eg') return initEg();
  if (t === 'dm') return initDm();
}

function switchEmuTab(t, opts) {
  if (!ET_MAP[t]) return;
  etCur = t;
  /* 四个分区平级：只留目标那个可见 */
  for (const [k, sel] of Object.entries(ET_MAP)) {
    const el = document.querySelector(sel);
    if (el) el.classList.toggle('et-hide', k !== t);
  }
  document.querySelectorAll('#emuTabs .emu-tab').forEach((b) => b.classList.toggle('on', b.dataset.et === t));
  /* 懒加载：首次切到才拉数据（各 init 内部有 inited 标记，重复切不会重复请求） */
  try { etInit(t); } catch (e) {}
  if (opts && opts.scroll !== false) window.scrollTo({ top: 0, behavior: 'smooth' });
}
/* 顶栏「手机专区」入口：本页已在专区，改为切「手游中心」 */
(function bindNavEmu() {
  const el = document.getElementById('navEmu'); if (!el) return;
  el.setAttribute('href', '#emu');
  el.addEventListener('click', (e) => { e.preventDefault(); switchEmuTab('emu'); });
})();
/** 子页签数字回填（手游中心合并游戏数 / 修改器条数 / 云存档手机可玩数 / 机型库条目数） */
async function fillTabNums() {
  const set = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.textContent = Number(v).toLocaleString(); };
  try { const s = await fetch(api('/api/mobilehub/stats')).then((r) => r.json()); if (s && s.total != null) set('tabNumEmu', s.total); } catch (e) {}
  try {
    const s = await fetch(api('/api/tools/stats')).then((r) => r.json());
    if (s && s.trainers) set('tabNumTr', s.trainers.total);
    /* 云存档页签数字用「手机能玩」口径，与页面默认筛选一致，避免「显示 5,741 结果只列出 1,117」 */
    if (s && s.saves) set('tabNumSv', s.saves.phonePlayable);
  } catch (e) {}
  try { const s = await fetch(api('/api/device/stats')).then((r) => r.json()); if (s && s.devices != null) set('tabNumDm', s.devices); } catch (e) {}
}
/* 底部 Tab 同款处理（底部「手机专区」直接落 手游中心） */
const tb = document.getElementById('tabbar');
if (tb) tb.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-tab]'); if (!a) return;
  const t = a.dataset.tab;
  if (t === 'emu') { e.preventDefault(); switchEmuTab('emu'); }
  else if (ET_MAP[t]) { e.preventDefault(); switchEmuTab(t); }
});
/* 切换条点击 */
document.getElementById('emuTabs').addEventListener('click', (e) => {
  const b = e.target.closest('.emu-tab'); if (!b) return;
  switchEmuTab(b.dataset.et);
});
/* 首屏：按 hash 决定进哪个页签，默认手游中心
 * ★ v9.3：#pc 是旧链接的兼容别名，归一为 #emu（老书签不会白屏） */
(function bootTab() {
  let t = location.hash.slice(1);
  if (t === 'pc') t = 'emu';
  switchEmuTab(ET_MAP[t] ? t : 'emu', { scroll: false });
  fillTabNums();
})();
`;

let JS = JS_BODY;

/* ---------- 脚本适配：独立页没有热榜/最新/分类/右栏，且要自管子页签 ----------
 * 首页那份 JS 里这些初始化会去操作不存在的节点（→ addEventListener of null），
 * 必须逐条摘掉；再把首页的「专区跳转块」换成独立页自己的 TAB_JS。
 * 注意：TAB_JS 是 const，已在文件前部声明（勿移到此处，否则 TDZ 报错）。
 */
JS = JS
  .replace(/^\s*refreshRank\([^)]*\);.*$/m, '  /* refreshRank：独立页无热榜分区，跳过 */')
  .replace(/^\s*bindRankUI\(\);.*$/m, '  /* bindRankUI：独立页无榜单 UI，跳过 */')
  .replace(/^\s*renderSide\(\);.*$/m, '  /* renderSide：独立页无右栏，跳过 */')
  .replace(/^\s*renderCats\(\);.*$/m, '  /* renderCats：独立页无分类行，跳过 */')
  .replace(/^\s*renderList\([^)]*\);.*$/m, '  /* renderList：独立页无最新收录列表，跳过 */')
  // ① 先把整段「专区跳转块」换成 SECTIONS_JS + TAB_JS。
  //    ★ 2026-09-10 三段式改版后，跳转块不再以 `(async () => {` 结尾（那是引导卡写法），
  //      改为以显式标记行 `/* [派生页锚点] ... */` 收尾 —— 用标记行匹配最稳，
  //      不会误吞后面的抽屉代码。旧写法（以 })(); 收尾）保留为兜底。
  .replace(/\/\* ================= 📱 手机模拟器专区（独立页跳转）[\s\S]*?\/\* \[派生页锚点\][^\n]*\n/m,
    () => secBlock() + TAB_JS)
  .replace(/\/\* ================= 📱 手机模拟器专区（独立页跳转）[\s\S]*?\n\}\)\(\);/m,
    () => secBlock() + TAB_JS)
  // ② 再摘掉引导卡数字回填（独立页没有引导卡，只保留 TAB_JS 里的 fillTabNums）
  .replace(/\/\* 引导卡上的两个数字[\s\S]*?\n\}\)\(\);/m, '/* 引导卡数字回填：独立页无引导卡，改由 fillTabNums 处理 */');

/* 若上面的跳转块替换没命中（首页写法变了），至少把 TAB_JS 追加进去，保证子页签可用 */
if (!/function switchEmuTab/.test(JS)) {
  JS += '\n/* [build-emulator-page] 兜底追加：首页跳转块未匹配到，直接补上独立页子页签脚本 */\n' + TAB_JS;
}
/* ★ 自检：跳转块若没被替换掉，EMU_PAGE_HREF（只在 index.html 声明）会残留，
 *   派生页里就变成未定义变量 → 顶部 Tab 绑定整段抛错、专区全空。
 *   这里直接报错中断，避免又出一版「看着还行其实全废」的页面。 */
if (/EMU_PAGE_HREF/.test(JS)) {
  throw new Error(
    '[build-emulator-page] 首页「手机模拟器专区（独立页跳转）」块未能匹配替换，\n' +
    '  EMU_PAGE_HREF 残留到派生页会导致 ReferenceError。\n' +
    '  请检查 public/index.html 中该注释块与 [派生页锚点] 标记行是否被改动。'
  );
}
/* 兜底：万一上面的替换真的没命中、SECTIONS_JS 也没进去，这里补上（放最后，避免 TDZ 由它引起） */
if (!SEC_SENTINEL.test(JS)) JS = secBlock() + JS;

/* ---------- 从 emulator.html 保留自己的三个分区 ----------
 *
 * ★ 幂等性关键：head 不能直接从 emulator.html 里「截到 </style> 为止」——
 *   因为派生页自己就含有一整段（上一轮注入的）CSS，再截一次就会把旧 CSS
 *   连同新一轮的 CSS 一起留下，每跑一次多一份，文件持续膨胀。
 *   正确做法：head 的骨架从**主源 index.html** 取（稳定、不含注入物），
 *   只把派生页自己的 <title> / <meta> 覆盖上去。
 */
const eTitle = findLine(emuLines, /<title>/);
const eDesc = findLine(emuLines, /<meta name="description"/);
const idxTitleA = findLine(idxLines, /^<head>/);
const idxTitleB = findLine(idxLines, /^<style>/);
const HEAD_LINES = cut(idxLines, idxTitleA, idxTitleB - 1).split('\n');
/* 用派生页自己的 title / description 替换主源的（若派生页有） */
if (eTitle > 0) {
  const t = emuLines[eTitle - 1];
  const i = HEAD_LINES.findIndex((l) => /<title>/.test(l));
  if (i >= 0) HEAD_LINES[i] = t;
}
if (eDesc > 0 && idxLines[eDesc - 1]) {
  const d = emuLines[eDesc - 1];
  const i = HEAD_LINES.findIndex((l) => /<meta name="description"/.test(l));
  if (i >= 0) HEAD_LINES[i] = d;
}

const eBackA = findLine(emuLines, /<div class="wrap page-back">/);

/* ================= 独立页三大分区（骨架常量） =================
 *
 * ★★ 血的教训（v9.1）★★
 * 这三个分区原先是从**派生页自己**（emulator.html）里「截出来再放回去」的。
 * 一旦某次生成把它们弄丢了（例如 eSecA 找不到时 cut 返回空串），
 * 下一次读取的就是「已经丢了的版本」——**错误会被幂等地固化，永远回不来**。
 * 本项目没有 git 兜底，实测确实丢过一次，只能靠手工重建。
 *
 * 所以现在改成：**主源 index.html 里也不放、派生页里也不读，直接在生成器里硬编码**，
 * 每次生成都从这份常量重建。这样它和 DEVMATCH_HTML 一样是幂等的、也不会再丢。
 *
 * 约束：所有 id 必须与 tools/emulator-sections.js 里 getElementById 的取值一一对应，
 *       否则某个 init 会拿不到节点（静默失败或 blank）。
 *       —— 已由文件末尾的「出站自检 3」强制校验。 */
const SECTIONS = `
<!-- ===== 子页签 ①：📱 手游中心（社区配置库 + 机型实测库 **合并成一张表**） =====
     ★ v9.3：原本这里有两个平级页签（「手游可玩」= 社区库、「实测配置」= 实测库），
       同一款游戏两边各出现一次，用户要在两个页签来回切，也看不出
       「这款到底有几套配置可抄 + 实测跑多少帧」。现在合并成一张卡片列表：
         · 同款游戏只占一条（按端游库 id 或归一化名归并）
         · 配置数累加（社区 N 套 + 实测 M 条）
         · 卡片上同时标「N 套配置」与「实测 XX 帧」
         · **默认只显示能对上端游库的**（有封面、点得进详情）
     实测库的独立视角（按机型/帧率筛）保留在「机型兼容」页签里。 -->
<main class="wrap" id="emulator" data-et="emu">
  <div class="sec-h"><span class="bar emu"></span><h2>手游中心</h2><span class="en">MOBILE HUB · 社区 + 实测</span><span class="more" id="emuCount"></span></div>
  <div class="emu-intro">
    <span class="ic">📱</span>
    <div class="tx">
      <b>手机跑 PC 游戏</b>——这张表把两路数据<b>合并去重</b>了：
      <b>社区配置库</b>（玩家在安卓机上跑通某款 PC 游戏后导出的模拟器配置，DXVK / Box64 / 驱动版本）+
      <b>机型实测库</b>（本项目自建，带<b>实测帧率</b>与踩坑备注）。
      同款游戏只占一条，<b>配置数累加</b>——配置越多说明越多人跑通、越省心。
      <span style="opacity:.75">默认只显示<b>能对上端游库的游戏</b>（有封面、点得进详情），可切到全量。</span>
      <span id="emuBuilt" style="opacity:.75"></span>
    </div>
  </div>
  <div class="emu-stats" id="emuStats"></div>
  <div class="emu-bar">
    <div class="emu-bar-row">
      <input class="emu-search" id="emuSearch" type="text" placeholder="搜索：GTA V / 只狼 / 艾尔登法环…（社区库英文名也认）" autocomplete="off">
      <select class="emu-sel" id="emuGpu"><option value="">全部 GPU / 机型</option></select>
      <select class="emu-sel" id="emuTier">
        <option value="">全部帧率</option>
        <option value="流畅">流畅 ≥55 帧</option>
        <option value="可玩">可玩 28-55 帧</option>
        <option value="勉强">勉强 15-28 帧</option>
        <option value="卡顿">卡顿 &lt;15 帧</option>
      </select>
    </div>
    <div class="emu-bar-row">
      <span class="emu-bar-lb">排序</span>
      <div class="emu-sorts" id="emuSorts">
        <button class="emu-sort on" data-s="both" type="button" title="既有社区配置、又有实测记录的游戏优先（最能体现「合并」价值）">双料优先</button>
        <button class="emu-sort" data-s="configs" type="button">配置最多</button>
        <button class="emu-sort" data-s="fps" type="button">帧率优先</button>
        <button class="emu-sort" data-s="recent" type="button">最近上传</button>
        <button class="emu-sort" data-s="name" type="button">名称</button>
      </div>
    </div>
    <!-- ★ v10.5：筛选独占一行（原先与搜索/排序挤同一行，开关一变宽就顶掉后面的开关）。
         开关文案恒定、只用 ○/✓ 表示状态，切换不产生回流。 -->
    <div class="emu-bar-row">
      <span class="emu-bar-lb">筛选</span>
      <button class="emu-refresh em-tg" id="emuToggleLib" type="button" title="只显示能对上端游库（有封面与详情页）的游戏">仅看匹配端游</button>
      <button class="emu-refresh both em-tg" id="emuToggleBoth" type="button" title="只看既有社区配置、又有本站实测记录的游戏（全量 3161 条里仅 88 条，最能体现两库合并价值）">只看双料</button>
      <button class="emu-refresh tr em-tg" id="emuToggleTr" type="button" title="只看「修改器」库里收录到的游戏（按端游库 id 关联）">🛠 有修改器</button>
      <button class="emu-refresh sv em-tg" id="emuToggleSv" type="button" title="只看「云存档」库里查到存档位置/云同步的游戏（按端游库 id 关联）">💾 有云存档</button>
      <span class="emu-bar-sp"></span>
      <button class="emu-refresh" id="emuRefresh" type="button" title="从 BannerHub 仓库拉取最新配置快照（约 12-60 秒）">↻ 刷新配置库</button>
    </div>
  </div>
  <div class="emu-grid" id="emuGrid"></div>
  <button class="load-more" id="emuMore" style="display:none">加载更多</button>
</main>

<!-- ===== 子页签 ②：📖 模拟器指南（静态知识库） ===== -->
<main class="wrap et-hide" id="emuguide" data-et="eg">
  <div class="sec-h"><span class="bar eg"></span><h2>模拟器指南</h2><span class="en">EMULATOR GUIDE</span><span class="more" id="egSrc"></span></div>
  <div class="emu-intro eg">
    <span class="ic">📖</span>
    <div class="tx">
      <b>先看这里，再动手装</b>——手游中心告诉你「这款游戏跑多少帧」，这里回答它前后三个问题：
      <b>该装哪个驱动 / 构建</b>（装错根本开不起来）、<b>开起来了但卡 / 黑屏该调什么</b>，
      以及<b>这一堆容器、驱动、包装器各该用哪一版</b>（见第 ⑥ 节）。
      <span style="opacity:.75">内容整理自社区实测与公开文档（<b>2026-09 口径</b>），属<b>经验参考</b>而非官方保证；驱动生态变化很快，请以发布页为准。</span>
    </div>
  </div>

  <div class="eg-sec">
    <h3>① 手机跑 PC 游戏，靠的是这五层</h3>
    <p class="eg-lead">ARM 手机芯片既看不懂 x86 指令、系统也不是 Windows。所以游戏 exe 要穿过五层翻译才能变成屏幕像素——<b>任何一层缺失或版本不匹配，都会是黑屏而不是「卡」</b>。</p>
    <div class="eg-stack" id="egStack"></div>
  </div>

  <div class="eg-sec">
    <h3>② 你的芯片该装哪个驱动</h3>
    <p class="eg-lead">这是唯一「换一个文件就能从幻灯片变 60 帧」的变量，也是新手最容易踩的坑。按 Adreno 世代选，不要跨代用。</p>
    <div class="eg-chips" id="egChips"></div>
  </div>

  <div class="eg-sec">
    <h3>③ DirectX 包装器对照表</h3>
    <p class="eg-lead">游戏用哪代 DirectX，就装哪个包装器。装错的表现是「启动即闪退」或「进游戏纯黑」。</p>
    <ul class="eg-list" id="egWrap"></ul>
  </div>

  <div class="eg-sec">
    <h3>④ 优化清单（按投产比排序）</h3>
    <p class="eg-lead">这些是从「能开起来」到「能玩」的关键调优项，建议按顺序做。</p>
    <ul class="eg-list" id="egTune"></ul>
  </div>

  <div class="eg-sec">
    <h3>⑤ 避坑清单（结构上就不可能跑）</h3>
    <p class="eg-lead">下面这些不是配置问题，<b>再怎么调都跑不起来</b>，别浪费时间。</p>
    <ul class="eg-list eg-avoid" id="egAvoid"></ul>
  </div>

  <div class="eg-sec">
    <h3>⑥ 版本门槛（2026-09 口径）</h3>
    <p class="eg-lead">「该装哪个版本」是新手最容易一句话答错的问题。这一节把当前该用的版本号固定下来，省得去翻一堆 release 页。</p>
    <ul class="eg-list" id="egVer"></ul>
  </div>

  <div class="eg-sec">
    <h3>⑦ 社区实测帧率参考</h3>
    <p class="eg-lead">来自社区公开数据，仅供参考；同一机型因散热与 ROM 差异可能出入较大。</p>
    <ul class="eg-list" id="egBench"></ul>
  </div>
</main>`;


/* 页签切换条：这是独立页自己的骨架，脚本重建（保持与脚本约定的 id）
   ★ v10.2：**不再有「← 返回聚合首页」按钮**。回首页由顶栏「🏠 首页」（≥761px）
     与底部 Tab「🏠 首页」（≤760px）承担，页内再放一个就是第三个同义出口。
   v9.1：**一条切换条、四个平级页签**。二级条已删除（见 TAB_JS 顶部注释）。
   v9.3：**「手游可玩」与「实测配置」合并**为「手游中心」一个页签（见 SECTIONS 顶部注释），
         实测库的独立视角改由「机型兼容」页签承担。页签由 4 个减为 3 个。
   v10 ：新增 **修改器(#trainers)** 与 **云存档(#saves)** 两个平级页签，共 **5 个**。
         排序：内容（手游中心）→ 资源（修改器 / 云存档）→ 工具（指南 / 机型兼容）——
         用户说「在手机专区增加两个页面」，放中间让「找资源」这条主线连贯。
   v10.13：用户口径「模拟器指南放在最后一个」→ 页签顺序改为
         **手游中心 → 修改器 → 云存档 → 机型兼容 → 模拟器指南**。
         理由：指南是**读一次就够**的资料页，不是日常入口；
         机型兼容是「查我的设备能跑什么」的高频动作，应排在它前面。
         （分区 DOM 顺序不动 —— 页签切换只切 display，与 DOM 前后无关。） */
const BACKBAR = `<div class="wrap page-back">
  <div class="emu-tabs" id="emuTabs">
    <button class="emu-tab on" data-et="emu" type="button"><b id="tabNumEmu">—</b><span>手游中心</span></button>
    <button class="emu-tab" data-et="tr" type="button"><b id="tabNumTr">—</b><span>修改器</span></button>
    <button class="emu-tab" data-et="sv" type="button"><b id="tabNumSv">—</b><span>云存档</span></button>
    <button class="emu-tab" data-et="dm" type="button"><b id="tabNumDm">—</b><span>机型兼容</span></button>
    <button class="emu-tab" data-et="eg" type="button"><b>指南</b><span>模拟器指南</span></button>
  </div>
</div>`;

/* 独立页专属脚本：子页签切换 + 数字回填 + 顶栏入口改切页签
   （首页那份已随三分区一起移除，这里按独立页需要重建） */

/* 机型兼容查询分区（#devmatch）：独立页专属骨架，脚本重建。
   为什么不从派生页保留：它是派生页自己新增的分区，派生页每次重建都会被覆盖，
   放在这里才能保证幂等（连跑三次字节一致）。 */
const DEVMATCH_HTML = `
<main class="wrap et-hide" id="devmatch" data-et="dm">
  <div class="sec-h"><span class="bar dm"></span><h2>机型兼容查询</h2><span class="en">DEVICE COMPATIBILITY</span><span class="more" id="dmCount"></span></div>
  <div class="emu-intro dm">
    <span class="ic">📲</span>
    <div class="tx">
      <b>选你的机型，看能跑哪些 PC 游戏</b>——先选品牌再挑型号，或直接输入手机型号搜索。
      系统按<b>芯片 GPU 性能档</b>推断：某游戏被更低配置的机型跑通过，你的机型就<b>同样能跑</b>（配置越高越流畅）。
      <span style="opacity:.75">数据来自 BannerHub 社区配置库（14,000+ 份实测）、Arm SoC 规格库与 Turnip 驱动构建源；结论为<b>推断参考</b>，实际表现受散热与 ROM 影响。</span>
    </div>
  </div>

  <div class="eg-sec">
    <h3>① 选择你的机型</h3>
    <p class="eg-lead">不知道具体型号？先选品牌看列表，或输入「小米 15」「S24」「K80」这类关键词试试。</p>
    <div class="dm-pick">
      <select class="dm-sel" id="dmBrand"><option value="">选择品牌…</option></select>
      <div class="dm-inp-wrap">
        <input class="dm-inp" id="dmInput" type="text" placeholder="输入机型，如 Xiaomi 2412DPC0AG / SM S928B / ayn Odin3…" autocomplete="off">
        <div class="dm-sug" id="dmSug"></div>
      </div>
      <button class="dm-btn" id="dmGo" type="button">查询能跑的游戏</button>
    </div>
    <div class="dm-info" id="dmInfo"></div>
  </div>

  <div class="eg-sec">
    <h3>② 配套驱动：Turnip 最新构建</h3>
    <p class="eg-lead">高通 Adreno 机型跑 PC 游戏，<b>换对驱动往往比换机型提升更明显</b>。以下为自动化构建的最新版本，按你的 GPU 世代选对应变体。</p>
    <div id="dmTurnip"><div class="dm-turnip"><p class="dm-empty">加载中…</p></div></div>
  </div>

  <div class="eg-sec" id="dmResultSec" style="display:none">
    <h3>③ 可跑游戏清单</h3>
    <p class="eg-lead">「流畅」= 你的 GPU 明显强于该游戏已验证的最低配置；「可玩」= 刚好达到；「勉强」= 略低，需降画质。</p>
    <div class="dm-flt">
      <button class="dm-f on" data-dmv="" type="button">全部</button>
      <button class="dm-f" data-dmv="smooth" type="button">流畅</button>
      <button class="dm-f" data-dmv="ok" type="button">可玩</button>
      <button class="dm-f" data-dmv="maybe" type="button">勉强</button>
      <input class="dm-inp" id="dmSearch" type="text" placeholder="在结果里搜索…" style="max-width:200px;margin-left:auto" autocomplete="off">
    </div>
    <div class="emu-grid" id="dmGrid"></div>
    <button class="dm-more" id="dmMore" type="button" style="display:none">加载更多</button>
  </div>
</main>`;

/* 修改器分区（#trainers）：独立页专属骨架，脚本重建（同 DEVMATCH_HTML 的理由——幂等）。
 *
 * 数据源：Game Cheats Manager 公开清单 https://gamezonelabs.com/api/data/gcm
 *   → tools/fetch-trainers.js 采集 → data/trainers.json → /api/trainers/*
 *
 * ★ 本页**刻意不做下载按钮**：GCM 官方下载走一次性 S3 签名 URL（依赖客户端密钥），
 *   无法离线复现也不该绕过。所以改为「信息展示 + 获取方式引导」，
 *   把用户导向官方渠道（GCM 修改器库页面 / GCM 应用下载）。
 */
const TRAINERS_HTML = `
<main class="wrap et-hide" id="trainers" data-et="tr">
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

/* 云存档分区（#saves）：独立页专属骨架，脚本重建（同 DEVMATCH_HTML 的理由——幂等）。
 *
 * 数据源：Ludusavi manifest（MIT）→ tools/build-saves.js 流式过滤 → data/saves.json → /api/saves/*
 *
 * ★ 这个页面的核心内容就是**存档路径本身**（用户要的「放置位置」），
 *   所以卡片直接把路径铺出来，用等宽字体、允许换行、不截断——
 *   截断了用户就没法照着去找文件了。
 */
const SAVES_HTML = `
<main class="wrap et-hide" id="saves" data-et="sv">
  <div class="sec-h"><span class="bar sv"></span><h2>云存档</h2><span class="en">CLOUD SAVE</span><span class="more" id="svCount"></span></div>
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
      <button class="emu-refresh sv on em-tg" id="svPhone" type="button" title="只显示手游中心里能玩的游戏">仅看手机能玩</button>
      <button class="emu-refresh sv em-tg" id="svCloud" type="button" title="只显示支持云同步的游戏">仅看云同步</button>
    </div>
  </div>
  <div class="emu-grid sv" id="svGrid"></div>
  <button class="load-more" id="svMore" style="display:none">加载更多</button>
</main>`;

/* ---------- 组装 ---------- */
const out = [
  ...HEAD_LINES,
  CSS,
  `  /* ===== 独立页专属：一条 5 页签切换条 =====
   *  v10.2：这一行原本左边还有个「← 返回聚合首页」按钮（.page-back a / .crumb 是它的样式）。
   *         按钮已删 —— 回首页统一走顶栏与底部 Tab，样式随之清掉，不留死 CSS。 */
  .page-back{display:flex;align-items:center;gap:12px;padding:14px 0 0;flex-wrap:wrap}

  /* v9.1：一条分栏式切换条（segmented control），页签平级。
     数字不再「压」在文字上方撑高卡片 —— 改为数字内嵌在标题右侧的小胶囊里，
     整条高度一致、视觉更平、点击目标更大。
     v10 页签由 3 个增到 5 个：窄屏放不下「数字胶囊 + 文字」，故 ≤760px 起收起数字胶囊
     （各分区标题右侧仍显示「共 N 款」），保证 5 个页签一眼看全、不用横向滚。 */
  #emuTabs{display:flex;gap:4px;padding:4px;background:#EEF1F7;border:1px solid var(--c-border);
    border-radius:13px;max-width:100%;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}
  #emuTabs::-webkit-scrollbar{display:none}
  #emuTabs .emu-tab{display:inline-flex;align-items:center;gap:7px;flex:none;min-width:0;
    padding:8px 14px;border:none;border-radius:10px;background:transparent;cursor:pointer;
    font:650 12.5px/1 var(--font);color:var(--c-t2);white-space:nowrap;transition:.15s;
    -webkit-tap-highlight-color:transparent}
  #emuTabs .emu-tab:hover{background:rgba(255,255,255,.7);color:var(--c-t1)}
  #emuTabs .emu-tab b{font:800 11.5px/1 var(--font-num);color:#6D28D9;background:rgba(124,58,237,.10);
    padding:3px 7px;border-radius:6px;min-width:22px;text-align:center}
  #emuTabs .emu-tab span{color:inherit}
  #emuTabs .emu-tab.on{background:linear-gradient(135deg,#7C3AED,#4F46E5);color:#fff;
    box-shadow:0 3px 10px rgba(124,58,237,.30)}
  #emuTabs .emu-tab.on b{background:rgba(255,255,255,.22);color:#fff}

  @media(max-width:760px){
    .page-back{gap:9px}
    #emuTabs{margin-left:0;width:100%}
    #emuTabs .emu-tab{flex:1;padding:8px 5px;gap:5px;font-size:11.5px;justify-content:center}
    /* ★ v10：5 个页签放不下数字胶囊，窄屏收起（分区标题有「共 N 款」兜底） */
    #emuTabs .emu-tab b{display:none}
  }
  @media(max-width:430px){
    /* 超窄屏：字号再收一档，5 个文字页签仍要一眼看全 */
    #emuTabs .emu-tab{font-size:10.5px;padding:8px 3px}
    .emu-grid.sv{grid-template-columns:1fr}
  }

  /* v9.1：二级切换条已删除（改为一条 4 页签）。
     原 .eg-subbar / .eg-sub 规则一并移除，避免留死 CSS。 */

  /* ===== 独立页专属：两个配置面板（抽屉内）+ 卡片占位 ===== */  .emu-loading,.emu-empty{padding:26px 4px;color:var(--c-t3);font-size:13.5px;text-align:center}
  .emu-deadnodes{display:none!important}
  .cf-head{padding:4px 2px 10px;border-bottom:1px solid var(--c-border)}
  .cf-head h3{margin:8px 0 2px;font-size:17px;font-weight:800;color:var(--c-t1);line-height:1.35}
  .cf-sub{font-size:12.5px;color:var(--c-t3)}
  .cf-body{padding:12px 2px 24px}
  .cf-loading,.cf-empty{padding:24px 0;color:var(--c-t3);font-size:13.5px;text-align:center}
  .cf-stats{display:flex;gap:8px;margin:10px 0 12px}
  .cf-stats .st{flex:1;min-width:0;background:#fff;border:1px solid var(--c-border);border-radius:12px;padding:10px 12px;text-align:center}
  .cf-stats .st b{display:block;font-size:19px;font-weight:800;color:var(--c-primary);line-height:1.2}
  .cf-stats .st span{font-size:11.5px;color:var(--c-t3)}
  .cf-note{background:#fff8e6;border:1px solid #f0dfae;border-radius:11px;padding:10px 12px;
    font-size:12.5px;line-height:1.65;color:var(--c-t2);margin-bottom:12px}
  .cf-scroll{max-height:52vh;overflow:auto;border:1px solid var(--c-border);border-radius:12px;background:#fff}
  .cf-table{width:100%;border-collapse:collapse;font-size:12.5px}
  .cf-table th{position:sticky;top:0;background:#f7f9fc;text-align:left;padding:9px 10px;font-weight:700;
    color:var(--c-t2);border-bottom:1px solid var(--c-border);white-space:nowrap}
  .cf-table td{padding:8px 10px;border-bottom:1px solid #eef1f6;color:var(--c-t2);vertical-align:middle}
  .cf-table tr:last-child td{border-bottom:0}
  .cf-dl{color:var(--c-primary);font-weight:650;text-decoration:none;white-space:nowrap}
  .cf-dl:hover{text-decoration:underline}
  /* ===== ★ v10.13 逐条游玩参数（配置面板内）=====
     原先面板只有 [机型|GPU|日期|下载JSON] 一张表，参数全在 JSON 里 ——
     现在把解析出来的真实参数铺成卡片。 */
  .cf-sec-t{display:flex;align-items:center;gap:8px;margin:14px 0 8px;font-size:12.5px;font-weight:800;color:var(--c-t2)}
  .cf-sec-t .n{margin-left:auto;font-size:11px;font-weight:650;color:var(--c-t3);font-family:var(--font-num)}
  .cf-params{display:flex;flex-direction:column;gap:9px}
  .cf-param{border:1px solid var(--c-border);border-radius:12px;background:#fff;overflow:hidden}
  .cf-param .hd{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:9px 11px;background:#f5f7fb}
  .cf-param .hd b{font-size:12.5px;color:var(--c-t1)}
  .cf-param .hd .gp{font-size:10.5px;font-weight:750;color:#0F766E;background:#CCFBF1;border-radius:5px;padding:1.5px 6px}
  .cf-param .hd .dt{margin-left:auto;font-size:10.5px;color:var(--c-t3);font-family:var(--font-num)}
  .cf-param .hd .dl{font-size:10.5px;font-weight:700;color:var(--c-primary);text-decoration:none}
  .cf-param .kvs{display:flex;flex-wrap:wrap;gap:6px;padding:9px 11px}
  /* ★ v10.14：机型 → 芯片规格行（与详情抽屉同款视觉） */
  .cf-param .spec{display:flex;flex-wrap:wrap;gap:6px;padding:0 11px 9px}
  .cf-param .spec .sp{font-size:10.5px;color:var(--c-t2);background:#eef4ff;border:1px solid #dce7fb;border-radius:6px;padding:2px 7px}
  .cf-param .spec .sp b{color:#1d4ed8;font-weight:800}
  .cf-param .spec .sp.soc b{color:#0f766e}
  .cf-param .spec .sp.cpu{font-family:var(--font-num);color:var(--c-t3);background:#f6f7fb;border-color:#e8ebf3}
  /* ★ v10.15：与详情抽屉同款分层 —— 驱动 / DXVK 带底色，其余中性灰；
     分辨率 / 内存这类「跟机型强相关」的也提亮一档，扫一眼就能定位重点。 */
  .cf-param .kvs .kv{font-size:10.5px;color:var(--c-t3);background:#f6f7fb;border:1px solid #e8ebf3;
    border-radius:6px;padding:2px 7px;font-family:var(--font-num)}
  .cf-param .kvs .kv b{color:#334155;font-weight:750;margin-right:1px}
  .cf-param .kvs .kv.hot{background:#f5f3ff;border-color:#e9e4fb}
  .cf-param .kvs .kv.hot b{color:#6D28D9}
  .cf-param .kvs .kv.ok{background:#ecfdf5;border-color:#d1fae5}
  .cf-param .kvs .kv.ok b{color:#0F766E}
  .cf-rec{padding:12px 13px;border-bottom:1px solid #eef1f6}
  .cf-rec:last-child{border-bottom:0}
  .cf-rec-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}
  .cf-rec-h b{font-size:13.5px;color:var(--c-t1)}
  .cf-kv{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px 10px}
  .cf-kv>div{display:flex;flex-direction:column;gap:2px;min-width:0}
  .cf-kv i{font-style:normal;font-size:11px;color:var(--c-t3)}
  .cf-kv code{font-size:11.5px;color:var(--c-t1);background:#f4f6fb;border-radius:6px;padding:2px 6px;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .cf-note-inline{margin-top:9px;background:#f4f8ff;border-left:3px solid var(--c-primary);border-radius:0 8px 8px 0;
    padding:8px 11px;font-size:12.5px;line-height:1.6;color:var(--c-t2)}
  .cf-lib{display:flex;gap:12px;align-items:center;background:#fff;border:1px solid var(--c-border);
    border-radius:12px;padding:10px;margin-bottom:12px}
  .cf-lib img{width:104px;height:48px;object-fit:cover;border-radius:8px;background:#eef1f6;flex:none}
  .cf-lib-tx{min-width:0;display:flex;flex-direction:column;gap:7px}
  .cf-lib-tx b{font-size:13px;color:var(--c-t1);line-height:1.4}
  .cf-btn{align-self:flex-start;display:inline-flex;align-items:center;gap:6px;background:var(--c-primary);color:#fff;
    border:0;border-radius:9px;padding:7px 13px;font-size:12.5px;font-weight:700;cursor:pointer;text-decoration:none;transition:.15s}
  .cf-btn:hover{filter:brightness(1.08)}
  .cf-foot{margin-top:12px;text-align:center}
</style>
</head>
<body data-page="emulator">
`,
  TOPBAR_EMU,
  '',
  BACKBAR,
  '',
  SECTIONS,
  DEVMATCH_HTML,
  TRAINERS_HTML,
  SAVES_HTML,
  '',
  SEARCH,
  '',
  RANKBAR,
  IDXBTNS,
  '',
  OVERLAY_EMU,
  '',
  '<script>',
  JS,
  '</script>',
  '</body>',
  '</html>',
].join('\n');

/* ---------- 出站自检 3：分区 JS 要的 id 必须都在页面里 ----------
 * 坑（v9.1）：三个分区曾经从派生页自身截取，丢了以后被幂等固化，
 * 结果是「页面在、JS 也在，但 getElementById 全返回 null」——
 * 切页签能看到切换条，内容却永远空白。这里把 emulator-sections.js 里
 * 所有 getElementById('xxx') 的 id 抠出来，逐个到产物里核对。 */
{
  const secPath = path.join(__dirname, 'emulator-sections.js');
  const secSrc = fs.readFileSync(secPath, 'utf8');
  const need = [...new Set([...secSrc.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]))];
  /* 其中一部分由其它常量（TOPBAR / DEVMATCH_HTML / SEARCH / OVERLAY）提供，已在 out 里 */
  const missing = need.filter((id) => !out.includes(`id="${id}"`));
  if (missing.length) {
    throw new Error(
      '[build-emulator-page] 以下 id 被 emulator-sections.js 引用，但产物里不存在：\n' +
      '  ' + missing.join(', ') + '\n' +
      '  这些分区的 init 会拿不到节点，表现为「切过去一片空白」。'
    );
  }
}

/* ---------- 出站自检 2：每个可切换分区都必须有 data-et ----------
 * 坑（v9.1）：隐藏规则是 `main[data-et].et-hide`（属性选择器）。
 * 若某个 <main> 漏了 data-et，切走它时 class 加上了但规则不生效 ——
 * 它仍然占着版面、把目标分区顶到屏幕外，表现就是「点了没反应」。 */
{
  const mains = [...out.matchAll(/<main\b[^>]*>/g)].map((m) => m[0]);
  for (const tag of mains) {
    const id = (tag.match(/id="([^"]+)"/) || [])[1];
    if (!/data-et="/.test(tag)) {
      throw new Error(
        `[build-emulator-page] <main id="${id}"> 缺少 data-et 属性。\n` +
        '  main[data-et].et-hide 依赖它，缺了会导致切换时该分区隐藏不掉。'
      );
    }
  }
}

/* ---------- 出站自检：CSS 必须整段在 <style> 内 ----------
 * 坑（v9.1）：CSS 常量含 `</style>` 而专属 CSS 在其后追加时，
 * 那段 CSS 会掉到 `</style>` 外面被当正文渲染 —— 页面看着「糊了一屏 CSS」。
 * 静态测试查不出来（它只看标签数量），必须在这里硬拦。 */
{
  const s0 = out.indexOf('<style>');
  const s1 = out.indexOf('</style>');
  if (s0 < 0 || s1 < 0) throw new Error('[build-emulator-page] <style> 标签缺失');
  const cssInside = out.slice(s0, s1);
  const leaked = out.slice(s1 + 8, out.indexOf('</head>'));
  if (/\{[\s\S]*\}/.test(leaked) && /[.#@][\w-]/.test(leaked)) {
    throw new Error(
      '[build-emulator-page] 检测到 CSS 泄漏到 </style> 之外（会被当正文显示）。\n' +
      '  请确认组装数组里「专属 CSS」位于 `</style>` 之前。'
    );
  }
}

fs.writeFileSync(EMU, out, 'utf8');
console.log(`✅ 已同步共享资产到 public/emulator.html`);
console.log(`   CSS ${CSS.length}B ｜ 顶栏 ${TOPBAR.length}B ｜ 抽屉+tabbar ${OVERLAY.length}B ｜ 脚本 ${JS.length}B`);
console.log(`   保留独立页自己的三分区 ${SECTIONS.length}B ＋ 机型兼容 ${DEVMATCH_HTML.length}B ＋ 修改器 ${TRAINERS_HTML.length}B ＋ 云存档 ${SAVES_HTML.length}B 与页签切换条`);

