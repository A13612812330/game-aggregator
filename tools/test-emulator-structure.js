/* 三段式导航「静态结构体检」 —— 补齐 jsdom 行为测试照不到的骨架问题
 *
 * jsdom 测的是「点得动、切得开」；本脚本测的是「不该在的东西别在」：
 *   死 CSS、废弃 id 引用、重复注入（幂等失败留下的脏数据）、遗漏的 init 调用。
 *
 * 运行：node tools/test-emulator-structure.js
 * 前置：已跑过 node tools/build-emulator-page.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const idx = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const emu = fs.readFileSync(path.join(root, 'public/emulator.html'), 'utf8');
/* ★ v10.44：MOD / 存档 / 修改器 三类端游资源从「手机专区」平级抽出，
 *   合成第 4 张派生页 public/resources.html。本文件里的断言随之分家：
 *   —— 手机专区只剩 3 个页签（手游中心 / 机型兼容 / 模拟器指南）
 *   —— 顶栏由 3 个入口增为 4 个
 *   —— 守卫由 IS_EMU_PAGE 放宽为 IS_SUB_PAGE
 *   —— tr/sv 的分区骨架与卡片断言整体搬到「端游资源页」小节 */
const res = fs.readFileSync(path.join(root, 'public/resources.html'), 'utf8');
/* ★ v10.50：原贴弹窗落在 OVERLAY 段（共享资产）⇒ 三张派生页都会带上。
 *   这里把第 4 张产物也读进来，四页一起验「共享资产真的同步了」。 */
const upk = fs.readFileSync(path.join(root, 'public/unpack.html'), 'utf8');
const rgSrc = fs.readFileSync(path.join(root, 'data/res-groups.js'), 'utf8');
/* ★ v10.51：下载弹窗的存档行要判「这条有没有原贴正文」，判据收在 savesYx.hasPost()。
 *   它是个**数据层单点**，光验页面看不见 ⇒ 直接把源码读进来验（与 rgSrc 同一套做法）。 */
const yxSrc = fs.readFileSync(path.join(root, 'data/savesYx.js'), 'utf8');

const R = [];
const t = (n, c, e) => R.push([c, n, e || '']);
const count = (s, re) => (s.match(re) || []).length;

/* ================= 首页 ================= */
const navBlock = (idx.match(/<nav class="main-nav">[\s\S]*?<\/nav>/) || [''])[0];
t('首页顶栏恰好 4 个入口（首页 / 手机专区 / 端游资源 / 解包匹配）', count(navBlock, /<a /g) === 4, `实际 ${count(navBlock, /<a /g)}`);
t('首页顶栏含「首页」#navHome、「手机专区」#navEmu、「端游资源」#navRes',
  /id="navHome"/.test(navBlock) && /navEmu/.test(navBlock) && /emulator\.html/.test(navBlock)
  && /<a href="\/resources\.html" id="navRes">🎮 端游资源<\/a>/.test(navBlock));
t('首页顶栏第 3 项是「端游资源」→ /resources.html（手机专区与解包匹配之间）',
  /navEmu[\s\S]{0,120}navRes[\s\S]{0,120}navUnpack/.test(navBlock));
t('首页顶栏已无 navRank / navLatest 旧分段入口', !/id="navRank"|id="navLatest"/.test(navBlock));
t('首页已移除引导卡 #emuHub', !/id="emuHub"/.test(idx));
t('首页无 .emu-hub CSS 死规则（注释行除外）', !/^\s*\.emu-hub[-{]/m.test(idx));
t('首页已把 .emu-tabs / .emu-tab 整组移出（改由独立页专属 CSS 提供）',
  !/^\s*\.emu-tab[-{]/m.test(idx) && !/^\s*\.emu-tabs\{/m.test(idx));
t('首页底部 Tab 恰好 5 项', count(idx, /data-tab="/g) === 5, `实际 ${count(idx, /data-tab="/g)}`);
t('首页已无 tabDm / tabPc / tabEg 元素', !/id="tabDm"|id="tabPc"|id="tabEg"/.test(idx));
t('首页保留 goEmuPage 跳转函数', /function goEmuPage/.test(idx));
t('首页无手机分区重函数（switchEmuTab/loadPc/initEg）',
  !/function switchEmuTab/.test(idx) && !/function loadPc/.test(idx) && !/function initEg/.test(idx));

/* ================= 独立页 ================= */
/* ★ v9.3：「手游可玩」+「实测配置」合并为「手游中心」，页签 4 → 3 个
 * ★ v10 ：新增「修改器」「云存档」两个平级页签，3 → 5 个
 *          顺序 = 内容(emu) → 资源(tr/sv) → 工具(dm) → 指南(eg)
 * ★ v10.13：用户要求「模拟器指南放在最后一个」→ eg 从第 4 位挪到末位
 * ★ v10.44：tr/sv 搬去 /resources.html，本页回到 **3 个页签**
 *          顺序 = 内容(emu) → 工具(dm) → 指南(eg) */
t('独立页恰好 3 个平级页签', count(emu, /class="emu-tab[ ">]/g) === 3, `实际 ${count(emu, /class="emu-tab[ ">]/g)}`);
t('独立页页签顺序为 emu/dm/eg',
  (emu.match(/data-et="(emu|eg|dm)"/g) || []).slice(0, 3).join(',') ===
    'data-et="emu",data-et="dm",data-et="eg"',
  (emu.match(/data-et="(emu|eg|dm)"/g) || []).slice(0, 3).join(','));
t('第 1 个页签是「手游中心」', /data-et="emu"[\s\S]{0,90}手游中心/.test(emu));
t('第 2 个页签是「机型兼容」且带数字 id', /data-et="dm"[\s\S]{0,60}id="tabNumDm"/.test(emu));
t('第 3 个页签是「模拟器指南」', /data-et="eg"[\s\S]{0,90}模拟器指南/.test(emu));
/* ★ v10.44：两个已搬家的页签必须**在本页彻底绝迹** —— 残留一个就会留下
 *   「点了没反应」的死页签（tr/sv 的 key 已不在本页 ET_MAP 里）。 */
t('独立页已彻底摘掉「修改器」页签（tr 已搬 /resources.html）',
  !/data-et="tr"/.test(emu) && !/tabNumTr/.test(emu));
t('独立页已彻底摘掉「云存档」页签（sv 已搬 /resources.html）',
  !/data-et="sv"/.test(emu) && !/tabNumSv/.test(emu));
/* ★ v9.1 核心：二级切换条必须彻底删干净（它是「点了没反应」的根源） */
t('二级切换条 #egSubbar 已彻底移除', !/id="egSubbar"/.test(emu));
t('已无 .eg-subbar / .eg-sub 设计残留（注释不计）',
  !/^\s*\.eg-sub[-{]/m.test(emu) && !/<button class="eg-sub/.test(emu));
t('独立页无 tabNumEg 残留（已改 tabNumDm）', !/id="tabNumEg"/.test(emu));
t('独立页无 EMU_PAGE_HREF 残留（否则 Tab 绑定 ReferenceError）', !/EMU_PAGE_HREF/.test(emu));
t('独立页 3 个分区 DOM 齐全',
  ['id="emulator"', 'id="emuguide"', 'id="devmatch"'].every((s) => emu.includes(s)));
t('独立页已把 #trainers / #saves 两个分区整块交出去（不留空壳）',
  !/id="trainers"/.test(emu) && !/id="saves"/.test(emu));
t('独立页已无 #phonecfg（实测配置已并入手游中心）', !/id="phonecfg"/.test(emu));
/* ★ v9.1 双坑回归：静态测试原本查不出这两个，但它们在真浏览器里都会让「切换失灵」 */
t('3 个可切换分区全部带 data-et（缺了 main[data-et].et-hide 匹配不上）',
  [...emu.matchAll(/<main\b[^>]*>/g)].length === 3 &&
  [...emu.matchAll(/<main\b[^>]*>/g)].every((m) => /data-et="/.test(m[0])));
t('ET_MAP 覆盖全部 3 个分区（漏一个就有页签点了没反应）',
  /ET_MAP = \{ emu: '#emulator', dm: '#devmatch', eg: '#emuguide' \}/.test(emu));
t('ET_MAP 不含已搬走的 tr / sv（残留 key 会切到不存在的分区）',
  !/ET_MAP = \{[^}]*\btr:/.test(emu) && !/ET_MAP = \{[^}]*\bsv:/.test(emu));
t('#emulator 已补 data-et="emu"（否则切走时隐藏不掉、把目标分区顶到屏外）',
  /<main class="wrap" id="emulator" data-et="emu">/.test(emu));
t('专属 CSS 整段在 <style> 内（掉到外面会被当正文渲染，页面糊一屏 CSS）',
  (() => {
    const s1 = emu.indexOf('</style>');
    const between = emu.slice(s1 + 8, emu.indexOf('</head>'));
    return s1 > 0 && !/[.#@][\w-]+\s*\{/.test(between);
  })());
t('</style> 后紧接 </head>（无 CSS 文本夹层）',
  /<\/style>\s*<\/head>/.test(emu));
t('独立页有「仅看匹配端游」开关 #emuToggleLib', /id="emuToggleLib"/.test(emu));
t('独立页已无「仅看可玩」开关 #pcToggleOk（实测库已并入）', !/id="pcToggleOk"/.test(emu));
t('独立页手游中心有帧率筛选下拉 #emuTier', /id="emuTier"/.test(emu));
t('bootTab 默认分支走 switchEmuTab（内含 init，不会空白首屏）',
  /switchEmuTab\(ET_MAP\[t\] \? t : 'emu', \{ scroll: false \}\)/.test(emu));
t('#emuTabs 为分栏式切换条（flex + 可横滑）',
  /#emuTabs\{[^}]*display:flex/.test(emu) && /#emuTabs\{[^}]*overflow-x:auto/.test(emu));
/* ★ v10：页签由 3 增到 5 时窄屏放不下「数字胶囊 + 文字」，收起断点从 430px 前移到 760px。
 * ★ v10.44：页签回到 3 个，但这条紧凑规则**沿用**（保持三页一致的窄屏按钮宽度），
 *   分区标题仍有「共 N 款」兜底，收起胶囊不丢信息。 */
t('窄屏（≤760px）收起页签数字胶囊（保持窄屏按钮等宽）',
  /max-width:760px[\s\S]{0,300}#emuTabs \.emu-tab b\{display:none\}/.test(emu));

/* ================= 幂等 / 无重复注入 ================= */
t('独立页 <style> 唯一', count(emu, /<style>/g) === 1, `实际 ${count(emu, /<style>/g)}`);
t('独立页 <script> 数正常（≤3）', count(emu, /<script/g) <= 3, `实际 ${count(emu, /<script/g)}`);
t('独立页 .main-nav 唯一', count(emu, /class="main-nav"/g) === 1, `实际 ${count(emu, /class="main-nav"/g)}`);
t('独立页 .page-back 唯一', count(emu, /class="wrap page-back"/g) === 1);
t('独立页未重复注入 TAB_JS（switchEmuTab 只定义一次）',
  count(emu, /function switchEmuTab/g) === 1, `实际 ${count(emu, /function switchEmuTab/g)}`);
/* ★ 坑 11：哨兵原为 initPc，v9.3 删除该函数后哨兵失效 → 每跑一次重复注入整份 SECTIONS */
t('独立页未重复注入 SECTIONS（initEmu / EMU_PAGE_SIZE 各只一次）',
  count(emu, /function initEmu/g) === 1 && count(emu, /const EMU_PAGE_SIZE/g) === 1,
  `initEmu ${count(emu, /function initEmu/g)} / EMU_PAGE_SIZE ${count(emu, /const EMU_PAGE_SIZE/g)}`);

/* ================= ★ v10.1 增量：只看双料 + 详情抽屉三区块 ================= */
const mh = fs.readFileSync(path.join(root, 'data/mobilehub.js'), 'utf8');
t('手游中心有「只看双料」开关骨架', emu.includes('id="emuToggleBoth"'));
t('双料开关有专属配色 .emu-refresh.both.on', /\.emu-refresh\.both\.on\{/.test(emu));
t('mobilehub 后端支持 only=both 双料筛选（sources 长度为 2）',
  /opts\.only === 'both'/.test(mh) && /sources \|\| \[\]\)\.length === 2/.test(mh));
/* ★ v9.3 拆独立页遗留 bug：loadBhBlock 只剩调用点、函数定义被删，
 *   paintDetail 执行到该行抛 ReferenceError → 其后的「另一源也有收录」「同分类更多」从未渲染。
 *   本断言专门防它回归：定义与调用必须同时存在。 */
t('详情抽屉 loadBhBlock 既有定义又有调用（防「孤儿调用」回归）',
  /(?:async\s+)?function loadBhBlock/.test(idx) && /loadBhBlock\(d, title(?:, fb)?\)/.test(idx));
t('详情抽屉有修改器 / 云存档两个槽位', idx.includes('id="trBlock"') && idx.includes('id="svBlock"'));
t('抽屉三区块函数均已定义（bh / tr / sv）',
  /function loadBhBlock/.test(idx) && /function loadTrBlock/.test(idx) && /function loadSvBlock/.test(idx));
t('抽屉区块在无命中时清空槽位（防残留上一个游戏的内容）',
  count(idx, /slot\.innerHTML = ''; return;/g) >= 5,
  `实际 ${count(idx, /slot\.innerHTML = ''; return;/g)}`);
t('抽屉区块样式 .d-blk / .d-sv / .d-tg 已定义',
  /\.d-blk\{/.test(idx) && /\.d-sv \.p\{/.test(idx) && /\.d-tg\.fling\{/.test(idx));

/* ================= ★ v10.2 增量：手机专区导航「单一出口」 =================
 * 用户反馈：顶栏已经有「🏠 首页 / 📱 手机专区」，页内却又多一个「← 返回聚合首页」。
 * 根因不是按钮多，而是**顶栏那份导航在派生页里是坏的** —— href="#rankStage" 是死锚点、
 * 又被共用脚本 preventDefault 成「回顶部」，点了没反应，于是被加了个按钮补救。
 * 所以这两件事必须同时锁：① 顶栏真的能用 ② 页内不再有第二个入口。缺一条就会退回去。
 */
t('派生页顶栏「首页」是真跳转 href="/"（不再是 #rankStage 死锚点）',
  /<a href="\/" id="navHome">🏠 首页<\/a>/.test(emu));
t('派生页顶栏高亮落在「手机专区」上（首页不抢高亮）',
  /<a href="\/emulator\.html" class="on" id="navEmu">📱 手机专区<\/a>/.test(emu));
t('派生页 <body> 带 data-page="emulator"（主源脚本据此区分两页语义）',
  /<body data-page="emulator">/.test(emu));
t('主源脚本对独立页放行顶栏「首页」的默认跳转（IS_SUB_PAGE 守卫）',
  /IS_SUB_PAGE/.test(idx) && /if \(IS_SUB_PAGE\) return;/.test(idx));
/* ★ v10.44：守卫原为 `body.dataset.page === 'emulator'`（只认手机专区）。
 *   端游资源页同样没有 #rankStage，若守卫不放宽，点「🏠 首页」会被 preventDefault 吞掉。
 *   判据改为「任何带 data-page 标记的都不是首页」。 */
t('守卫已由「等于 emulator」放宽为「任何带 data-page 标记的都不是首页」',
  /const IS_SUB_PAGE = \(document\.body\.getAttribute\('data-page'\) \|\| ''\) !== '';/.test(idx)
  && !/IS_EMU_PAGE/.test(idx));
t('三张派生页各带自己的 data-page 标记（守卫据此识别）',
  /<body data-page="emulator">/.test(emu) && /<body data-page="resources">/.test(res));
t('独立页页内已无「← 返回聚合首页」按钮', !emu.includes('<a href="/">← 返回聚合首页</a>'));
/* 窄屏（≤760px）下 .main-nav 是 display:none —— 底部 Tab 必须自带回首页入口 */
t('派生页底部 Tab 有回首页入口（href="/"）',
  /<nav class="tabbar"[\s\S]*?href="\/"[\s\S]*?<\/nav>/.test(emu));
t('派生页底部 Tab 已清掉首页语义死链（latest / about）',
  !/<nav class="tabbar"[\s\S]*?data-tab="latest"[\s\S]*?<\/nav>/.test(emu) &&
  !/<nav class="tabbar"[\s\S]*?data-tab="about"[\s\S]*?<\/nav>/.test(emu));
t('goEmuPage 在派生页既有定义又有调用（原为孤儿调用，点底部 Tab 必抛错）',
  /function goEmuPage\(t\)/.test(emu) && /goEmuPage\(t\)/.test(emu));

/* ================= ★ v10.3 增量：排序 / 容量 筛选条改版 =================
 * 原状：一行里混排「排序胶囊（白底描边 + 蓝色实心选中）+ 容量灰轨分段控件」，
 *       两组同为单选却用了两套选中语言；且 .sort-pills 带着 margin:2px 0 12px
 *       在 align-items:center 的父容器里，把排序组整体顶离了基线。
 * 现版：拆成两行「行首标签 + 分段控件」，两组共用一套规格，与顶栏 .main-nav 同语言。
 * ★ 同时修掉一个真 bug：.pc-badge 单类优先于 .bh-toggle.on，把「🎮 有实测记录」
 *   的活跃态盖成浅紫底紫字，与「📱 社区有配置」的实心红形成一套开关两种活跃态。
 */
t('筛选条拆成三行 .filter-row（排序 / 容量 / 筛选各一行，v10.5 开关独立成行）',
  count(idx, /class="filter-row"/g) === 3, `实际 ${count(idx, /class="filter-row"/g)}`);
t('三行各有行首标签 .filter-lb（排序 / 容量 / 筛选）',
  idx.includes('<span class="filter-lb">排序</span>') && idx.includes('<span class="filter-lb">容量</span>')
  && idx.includes('<span class="filter-lb">筛选</span>'));
t('排序组与容量组共用同一套分段控件规格',
  /.sort-pills,.size-pills\{/.test(idx) && /.sort-pill,.size-pill\{/.test(idx));
t('排序组已不再用「蓝色实心胶囊」那套选中语言',
  !/\.sort-pill\.on\{background:var\(--c-primary\)/.test(idx) && !/\.sort-pill\{[^}]*border-radius:99px/.test(idx));
t('排序组旧的下边距（把基线顶歪的 margin:2px 0 12px）已清除',
  !/\.sort-pills\{[^}]*margin:2px 0 12px/.test(idx));
t('两个开关未激活态一致（.pc-badge 不再无条件上紫底）',
  /\.bh-toggle\.pc-badge\{background:#fff/.test(idx));
t('两个开关活跃态各自有独立配色（📱 红橙 / 🎮 紫）',
  /\.bh-toggle\.on\{/.test(idx) && /\.bh-toggle\.pc-badge\.on\{/.test(idx));
t('容量首项文案为「不限」（行首已有「容量」定名）',
  /k: 'all', nm: '不限'/.test(idx));
/* ★ 窄屏横向溢出：分段控件是 nowrap 的，会把栅格子项 #colMain 的 min-content
 *   撑到 531px（实测），375 宽的屏上整页横向滚动。必须显式归零自动最小尺寸。 */
t('窄屏已解除 #colMain 的自动最小尺寸（防整页横向溢出）',
  /@media\(max-width:760px\)\{[\s\S]*?#colMain\{min-width:0\}/.test(idx));
t('窄屏分段控件横滑且留 260px 下限（开关自动换行而非压扁控件）',
  /\.sort-pills,\.size-pills\{flex:1 1 0;min-width:min\(100%,260px\)/.test(idx));
t('窄屏收起装饰性英文角标（NEW/SCORE/XS/S/M…）',
  /\.sort-pill \.lb,\.size-pill \.lb\{display:none\}/.test(idx));

/* ================= ★ v10.4 增量：手游专区搜索入口 + 封面 URL 归一化 =================
 * ① 搜索：\`#searchOpen\` 的绑定原本写在 bindRankUI() **内部**，而生成器会把派生页的
 *    \`bindRankUI();\` 调用注释掉（该函数还要绑 #rankPills / #rankRefresh，专区页没这两个节点）。
 *    → 派生页从未执行那次绑定，**手机专区的顶栏搜索按钮点了完全没反应**。
 *    修法：把这行提到函数之外，作为「两页共用」的独立绑定。
 *    锁两条：① 各页都有这行 ② bindRankUI 内部不许再有它（否则首页会绑两次）。
 * ② 封面：端游库 223 条 cover 是 XDGAME 站内相对路径（/uploads/…），铺到 <img> 会打本站 404，
 *    卡片只剩占位色块。统一由 data/cover-url.js 归一化（补域名 / 清脏数据）。
 */
const bindRankIdx = (/function bindRankUI\(\) \{[\s\S]*?\n\}/.exec(idx) || [''])[0];
const bindRankEmu = (/function bindRankUI\(\) \{[\s\S]*?\n\}/.exec(emu) || [''])[0];
const SEARCH_BIND = /\$\('#searchOpen'\)\.addEventListener\('click', \(\) => openSearch\(\)\);/;
t('主源 #searchOpen 绑定已移出 bindRankUI()（两页共用）',
  !!bindRankIdx && !/searchOpen/.test(bindRankIdx) && SEARCH_BIND.test(idx));
t('派生页同样有独立的 #searchOpen 绑定（且 bindRankUI 内不再有它）',
  !!bindRankEmu && !/searchOpen/.test(bindRankEmu) && SEARCH_BIND.test(emu));
t('两页各只有 1 处 #searchOpen 绑定（避免重复绑定）',
  count(idx, /\$\('#searchOpen'\)\.addEventListener/g) === 1 &&
  count(emu, /\$\('#searchOpen'\)\.addEventListener/g) === 1,
  `index=${count(idx, /\$\('#searchOpen'\)\.addEventListener/g)} emu=${count(emu, /\$\('#searchOpen'\)\.addEventListener/g)}`);
t('派生页未把 bindRankUI() 变成死调用（仍是被注释的跳过态）',
  /\/\* bindRankUI：独立页无榜单 UI，跳过 \*\//.test(emu));

const { normalizeCover } = require(path.join(root, 'data', 'cover-url'));
t('normalizeCover：XD 站内相对路径补成绝对 URL',
  normalizeCover('/uploads/a/1-2-L.png') === 'https://www.xdgame.com/uploads/a/1-2-L.png',
  normalizeCover('/uploads/a/1-2-L.png'));
t('normalizeCover：完整 URL 原样、协议相对补 https',
  normalizeCover('https://a.com/x.jpg') === 'https://a.com/x.jpg' &&
  normalizeCover('//img.a.com/x.png') === 'https://img.a.com/x.png');
t('normalizeCover：脏数据（分类串等非图片路径）置空，宁可不显示也不挂 404',
  normalizeCover('独立,黑暗,悬疑,恐怖') === '' && normalizeCover('') === '' && normalizeCover('dede:img}') === '');
const gamesRaw = JSON.parse(fs.readFileSync(path.join(root, 'data', 'games.json'), 'utf8'));
const badCover = gamesRaw.filter((g) => g.cover && !/^https?:\/\//i.test(g.cover));
t('games.json 已无「非绝对 URL」封面（历史 223 条已修）', badCover.length === 0,
  `剩 ${badCover.length} 条${badCover[0] ? '：' + badCover[0].id : ''}`);
const mhJson = JSON.parse(fs.readFileSync(path.join(root, 'data', 'mobilehub.json'), 'utf8'));
const badLibCover = (mhJson.items || []).filter((x) => x.libId && x.libCover && !/^https?:\/\//i.test(x.libCover));
t('mobilehub.json 的 libCover 全为绝对 URL（手游卡片不再出现空色块）', badLibCover.length === 0,
  `剩 ${badLibCover.length} 条`);
const rootedCov = (mhJson.items || []).filter((x) => x.libCover && /xdgame\.com\/uploads/.test(x.libCover)).length;
t('手游卡片已带上「由端游库补回」的封面（XD 站内图）', rootedCov > 0, `${rootedCov} 条`);

/* ================= ★ v10.5 增量：点击语义 / 筛选条分行 / 横切筛选 =================
 * 本轮四件事：① XD 详情解析改版适配 ② 云存档卡片可点进详情
 *            ③ 卡片点击语义统一（有库命中就进详情）④ 筛选不换行 + 新增两个筛选
 */
const xdFetch = fs.readFileSync(path.join(root, 'fetchers', 'xdgamer.js'), 'utf8');
const xrefSrc = fs.readFileSync(path.join(root, 'data', 'xref.js'), 'utf8');
const srv = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const sec = fs.readFileSync(path.join(root, 'tools', 'emulator-sections.js'), 'utf8');
/* ★ v10.44：存档 / 修改器的驱动脚本搬去端游资源页，相关断言改读这份 */
const rsec = fs.readFileSync(path.join(root, 'tools', 'resource-sections.js'), 'utf8');

/* ① XD 详情：改版后标题在 .article-title-text，且旧代码的「|| 短路 + 未 trim」会让 title 恒为空 */
t('XD 详情按新版结构取标题（.article-title-text + trim 后再判空）',
  /article-title-text/.test(xdFetch) && /const pickText = \(\.\.\.cands\)/.test(xdFetch));
t('XD 详情取到厂商 / 发行日期（.article-meta-item）',
  /game-publisher/.test(xdFetch) && /game-release-date/.test(xdFetch));
t('XD 详情从版本介绍文本里提容量（容量xxGB）', /容量\\s\*\(\[\\d\.\]\+/.test(xdFetch));
t('XD 详情返回标签 tags（新版 .article-tags）', /\.article-tags a/.test(xdFetch) && /tags,/.test(xdFetch));

/* ② 云存档卡片：v10.45 不再铺路径 → v10.47 起**整卡改形**
 *   ★ v10.44：这段实现已搬去 tools/resource-sections.js（存档页签在端游资源页）
 *   ★ v10.45：`.paths` / `.cp` / `copyText` 全部撤出卡面 ⇒ 按铁律「搬家 + 反向断言」处理
 *   ★ v10.47：卡面从「一卡一条 + .sv-open 整宽按钮」改成「一卡一款游戏 + 卡内条目 + 展开全部」
 *     ⇒ `.sv-open` / `data-sv-open` / `tab:'save'` 全废。
 *     ⚠️ 这四条旧正向断言**不是删掉了事，而是换成了新形态里守同一类行为的三条**
 *        （照铁律 35「断言搬家 = 搬家 + 反向断言」：只删 ⇒ 零覆盖）：
 *        · 卡面必须有可点动作（.grp-more 展开全部 / .cov-btn 进详情）
 *        · 卡内通道外链不能被整卡点击吞掉
 *        · 未命中端游库要给明确提示（不能点了没反应）
 *        废形态同时加进反向断言，防止哪天被捡回来。 */
t('★ 组卡卡面动作在（.grp-more 展开全部 + .cov-btn 进详情，正向锚点）',
  /class="grp-more"/.test(rsec) && /class="cov-btn"/.test(rsec) && /data-grp-more/.test(rsec));
t('★ 卡内下载通道是外链，不被整卡点击吞掉（closest(\'.gl-lk a\') 早退）',
  /closest\('\.gl-lk a'\)/.test(rsec));
t('★ 未命中端游库时给明确提示（toast），不能变成「点了没反应」',
  /typeof toast === 'function'/.test(rsec) && /未收录进本地端游库/.test(rsec));
t('★★ 反向断言：卡面实现里已无 .paths 铺路径（v10.45 核心诉求）',
  !/class="paths"/.test(rsec) && !/closest\('\.paths'\)/.test(rsec));
t('★★ 反向断言：copyText 已从派生页驱动里删除（复制搬进了弹窗的 #svLoc 位置弹窗）',
  !/function copyText/.test(rsec));
t('★★ 反向断言：v10.47 废掉的卡面动作不再回来（sv-open / data-sv-open / tab:\'save\'）',
  !/class="sv-open"/.test(rsec) && !/data-sv-open/.test(rsec) && !/tab:\s*'save'/.test(rsec));

/* ③ 点击语义统一：libId 优先于 bhk（旧版 bhk 优先导致点正文进配置面板） */
{
  const split = sec.indexOf('function bindEmuCards');
  const body = split >= 0 ? sec.slice(split, split + 2200) : '';
  const iCfg = body.indexOf("closest('.cfg-btn')");
  const iLib = body.indexOf('card.dataset.lib');
  t('手游卡片正文：端游库命中优先于社区配置键（cfg 按钮单独分流）',
    iCfg >= 0 && iLib > iCfg && /class="cfg-btn"/.test(sec));
  t('「📋 社区配置」按钮有专属样式 .emu-card .cfg-btn', /\.emu-card \.cfg-btn\{/.test(idx));
}

/* ④ 筛选条分行 + 状态不进文案（定宽伪元素）
 * ★ v10.44：拆分后 emulator 只剩手游中心一条筛选条（3 行），
 *   修改器 2 行 / 云存档 2 行随功能去了 resources.html —— 两边分别断言。 */
const barRowCount = count(emu, /class="emu-bar-row"/g);
t('手机专区只剩手游中心一条筛选条，共 3 行 .emu-bar-row', barRowCount === 3, `实际 ${barRowCount} 行`);
{
  const resRows = count(res, /class="emu-bar-row"/g);
  t('端游资源页三条筛选条共 6 行 .emu-bar-row（MOD 2 / 存档 2 / 修改器 2）', resRows === 6, `实际 ${resRows} 行`);
}
t('手游中心筛选独占一行（行首有「筛选」标签 + 4 个开关）',
  /<div class="emu-bar-row">\s*<span class="emu-bar-lb">筛选<\/span>[\s\S]{0,900}id="emuToggleSv"/.test(emu));
t('四个筛选开关都在（匹配端游 / 双料 / 有修改器 / 有云存档）',
  ['emuToggleLib', 'emuToggleBoth', 'emuToggleTr', 'emuToggleSv'].every((i) => emu.includes(`id="${i}"`)));
t('开关状态标记走定宽伪元素 .em-tg::before（不进文案，盒宽恒定）',
  /\.emu-refresh\.em-tg::before\{content:'○'/.test(idx) && /\.emu-refresh\.em-tg\.on::before\{content:'✓'\}/.test(idx));
t('开关 JS 不再改 textContent（只切 .on 类）',
  !/\.textContent = \(.*\? '✓ ' : '○ '\)/.test(sec) && /const paint = \(\) => el\.classList\.toggle\('on'/.test(sec));
{
  /* 各页开关按钮都必须挂 em-tg，否则它的状态就没有标记，或又退回「改文案」的老路。
   * ★ v10.44：按页面拆成两组 —— 手机专区 4 个（手游中心），端游资源页 4 个（MOD / 存档 / 修改器）。 */
  const chk = (html, tgIds, label) => {
    const missing = tgIds.filter((i) => {
      const m = html.match(new RegExp('class="([^"]*)" id="' + i + '"'));
      return !(m && /\bem-tg\b/.test(m[1]));
    });
    t(label, missing.length === 0, missing.join(', ') || '全部命中');
  };
  chk(emu, ['emuToggleLib', 'emuToggleBoth', 'emuToggleTr', 'emuToggleSv'],
    '手机专区 4 个筛选开关都挂了 em-tg 类');
  /* ★ v10.47：端游资源页的四个开关（mdToggleLib / trToggleLib / svPhone / svCloud）**整组删掉**。
   *   为什么要删而不是留：三个分区改成「按游戏聚合卡」后，组卡按定义就是「能对上端游库的游戏」
   *   （分组键优先用 libId）⇒ 「仅看匹配端游」成了一个恒真的开关；
   *   而「只看手机能玩 / 只看云同步」是 **Ludusavi 位置库**的属性，位置线已整体让位给
   *   「可下载的存档」与 #svLoc 弹窗，本页再也不出位置卡 ⇒ 这两个开关没有数据可筛。
   *   ⚠️ 只写反向断言会被「整页开关都丢了」满足 ⇒ 必须配正向锚点：
   *      三个分区各自的**来源下拉**（mdSrc / svSrc / trSrc）才是新的筛选入口。 */
  t('★★ 端游资源页不再有恒真/无数据的筛选开关（反向：四个旧开关已删）',
    ['mdToggleLib', 'trToggleLib', 'svPhone', 'svCloud'].every((i) => !res.includes(`id="${i}"`)),
    ['mdToggleLib', 'trToggleLib', 'svPhone', 'svCloud'].filter((i) => res.includes(`id="${i}"`)).join(', ') || '全部已删');
  t('★ 正向锚点：三个分区各有一个「来源」下拉（新筛选入口，防止上一条「整页丢了才为真」）',
    ['id="mdSrc"', 'id="svSrc"', 'id="trSrc"'].every((s) => res.includes(s)));
}

/* ⑤ 横切筛选：交叉索引 + 两端点 */
t('新增 data/xref.js（修改器 / 云存档 的 libId 交叉索引）',
  /trainerIds/.test(xrefSrc) && /saveIds/.test(xrefSrc) && /module\.exports/.test(xrefSrc));
t('服务端支持首页聚合库 tr=1 / sv=1 筛选', /req\.query\.tr/.test(srv) && /req\.query\.sv/.test(srv));
t('服务端手游中心支持 tr / sv 并回填 hasTr/hasSv 角标',
  /tr: req\.query\.tr, sv: req\.query\.sv/.test(srv) && /xref\.flags\(x\.libId\)/.test(srv));
t('手游中心卡片渲染 🛠/💾 角标', /tg has-tr/.test(sec) && /tg has-sv/.test(sec));
t('首页聚合库筛选条有两个新开关 #trToggle / #svToggle',
  idx.includes('id="trToggle"') && idx.includes('id="svToggle"'));
t('首页筛选串带上 tr/sv 参数', /q \+= '&tr=1'/.test(idx) && /q \+= '&sv=1'/.test(idx));
t('首页新开关有独立配色（.tr-badge 青绿 / .sv-badge 天蓝）',
  /\.bh-toggle\.tr-badge\.on\{/.test(idx) && /\.bh-toggle\.sv-badge\.on\{/.test(idx));

/* ================= ★ v10.7 增量：搜索弹窗分组排序 / 行密度 / 详情抽屉加宽 ================= */
const sec2 = fs.readFileSync(path.join(root, 'tools/emulator-sections.js'), 'utf8');

/* ① 详情抽屉宽度：基准 680 + 宽屏 50vw + 上限 1040，且外层再套 min(...,100vw) 防溢出 */
t('详情抽屉宽度改为 clamp(680px,50vw,1040px) 并套 min(...,100vw)',
  /\.drawer\{[^}]*width:min\(clamp\(680px,50vw,1040px\),100vw\)/.test(idx));
/* ★ v10.25：游戏预览从「三列网格」改成 16:9 画廊（viewport/track/slide/prev-next/counter/thumbs），
 *   所以这条不再查 .shots 的列数，改查画廊本体 —— 但**意图不变**：
 *   抽屉既然加宽了，预览区就得吃满宽度（16:9 单幅铺满）而不是继续挤成小格子。 */
t('抽屉加宽配套：桌面 KV 三列 / 游戏预览吃满宽度的 16:9 画廊',
  /\.kv\{display:grid;grid-template-columns:repeat\(3,1fr\)/.test(idx)
  && /\.gal-vp\{[^}]*aspect-ratio:16\/9/.test(idx));
/* ★ v10.25：移动端预览控件同样要收窄（缩略图 64→52、翻页钮 30→26），
 *   并新增「窄屏不显示定位条」—— 抽屉占满整屏时没有横向空间给它。 */
t('移动端（≤760px）KV 仍单列、画廊控件收窄、定位条隐藏',
  /\.drawer\{width:100vw\}[\s\S]{0,220}?\.kv\{grid-template-columns:1fr\}[\s\S]{0,160}?\.gal-th\{flex:0 0 52px\}[\s\S]{0,80}?\.gal-nav\{width:26px;height:26px\}/
    .test(idx)
  && /@media\(max-width:760px\)[\s\S]{0,4000}?\.d-rail\{display:none\}/.test(idx));

/* ② 「同分类更多」不再抢在游戏本体信息之前 —— DOM 源码里 relSlot 必须排在 shotsHtml 之后
 *  ⚠️ 不能按「第一个 <div class="d-body">」去切模板：页面里有两处 d-body，
 *     前一处在 paintDetail 之外的另一个渲染路径上（不含 relSlot），切出来会是空窗口。
 *     改成以 relSlot 自身为锚点向两侧取窗口，只关心「谁在它前面」。 */
const relAt = idx.indexOf('id="relSlot"');
const tpl = relAt >= 0 ? idx.slice(Math.max(0, relAt - 2000), relAt) : '';
t('详情模板里 #relSlot（同分类更多）排在 ${shotsHtml} 之后',
  tpl.includes('${shotsHtml}') && tpl.lastIndexOf('${shotsHtml}') < tpl.length,
  `relSlot@${relAt}，前文含 shotsHtml=${tpl.includes('${shotsHtml}')}`);
t('详情模板里 #relSlot 排在 ${descHtml} 之后（不再插在评分/KV 之前）',
  tpl.includes('${descHtml}'));
t('详情模板里 #relSlot 排在 ${versionHtml} / 配置要求占位 #reqSlot 之后',
  tpl.includes('${versionHtml}') && tpl.includes('id="reqSlot"'));
t('详情模板里 #relSlot 排在评分/KV 之后（前面先出现 score-big 与 class="kv"）',
  tpl.includes('class="score-big"') && tpl.includes('<div class="kv">'));
t('详情模板里不再出现「crossSrc 紧跟 relSlot」的旧顺序',
  !/<div id="crossSrc"><\/div>\s*\n\s*<div id="relSlot">/.test(idx));
t('#relSlot 仍只有一个（没有复制粘贴出第二份）', count(idx, /id="relSlot"/g) === 1, `实际 ${count(idx, /id="relSlot"/g)}`);

/* ③ 搜索弹窗：隐形占位改造 + 行密度 */
t('搜索弹窗 .sm-row 改为 position:relative（配合绝对定位的 .go2）',
  /\.sm-row\{[^}]*position:relative\}/.test(idx));
t('.sm-row .go2 已改为绝对定位浮出（不再是流内元素）',
  /\.sm-row \.go2\{position:absolute;right:10px;top:50%/.test(idx) && !/\.sm-row \.go2\{flex:none/.test(idx));
t('.go2 设了 pointer-events:none（不吞行的点击）', /\.sm-row \.go2\{[^}]*pointer-events:none/.test(idx));
t('行内文字收紧行距（.t/.en 1.3 ／ .m 1.35 ／ .pth 1.3）',
  /\.sm-row \.t\{[^}]*line-height:1\.3/.test(idx)
  && /\.sm-row \.en\{[^}]*line-height:1\.3/.test(idx)
  && /\.sm-row \.m\{[^}]*line-height:1\.35/.test(idx)
  && /\.sm-row \.pth\{[^}]*line-height:1\.3/.test(idx));
/* ★ v10.30：缩略图从「定高 44px」改「定宽 76px + 16:9 比例」（卡片统一规范）。
   判据同步 —— 仍要求**两个选择器都命中**：只改 img 不改 .ph2 会漏（占位块会高出一截）。 */
t('行缩略图 76px 宽 · 比例走 --th-ar（.ph2 同步）',
  /\.sm-row img\{width:76px;height:auto;aspect-ratio:var\(--th-ar\)/.test(idx)
  && /\.sm-row \.ph2\{width:76px;height:auto;aspect-ratio:var\(--th-ar\)/.test(idx));

/* ④ 分组按相关性排序（含端游库本体提权 + 别名词兜底） */
t('paintSearchResult 里有归一化 + 贴合度打分 + 稳定排序',
  /const rn = \(s\) =>/.test(idx) && /const fit = \(\.\.\.nameLists\)/.test(idx)
  && /groups\.sort\(\(a, b\) => b\.score - a\.score \|\| a\.i - b\.i\)/.test(idx));
t('端游库有「本体提权」：pcFit ≥ 2 时 +1 分',
  /const pcFit = fit\(pcHit\.map\(\(x\) => x\.title\)\)/.test(idx) && /pcFit \+ \(pcFit >= 2 \? 1 : 0\)/.test(idx));
t('打分用别名解析后的词（qEff），避免别名搜索四组全 0 分',
  /const qEff = \(j\.aliasNote && j\.aliasNote\.to\) \|\| q/.test(idx) && /const qn = rn\(qEff\)/.test(idx));
t('分组的「首组不加顶部间距」改为排序后按位次决定',
  /groups\.forEach\(\(g, k\) => \{[\s\S]{0,200}k === 0 \? '' : ' style="padding-top:12px"'/.test(idx));
t('旧的写死顺序（sec(...true) 四连）已移除', !/html \+= sec\('📱'/.test(idx) && !/const sec = \(icon, name, tag/.test(idx));

/* ================= ★ v10.44 增量：端游资源独立页 /resources.html =================
 * 用户需求①：「手游的样式更新下，也需要划分模块 MOD、存档、修改器」。
 * 归属决策（用户拍板）：三类资源新建「端游资源」独立专页，手机专区回归 3 块。
 *
 * 这张页与 emulator.html 共用同一套生成机制
 *   （主源抽共享资产 + 生成器里硬编码分区骨架 + 外部驱动脚本 + 幂等哨兵 + 出站自检），
 * 所以下面这组断言与上面那组是同构的。三条最容易**静默**出错的：
 *   ⚠️ 分区骨架绝不能从派生页自身回读 —— 生成时丢了会被幂等固化，永远回不来（v9.1 血教训）
 *   ⚠️ 幂等哨兵必须锚在长期存在的符号上 —— 曾挂在被删的 initPc 上，每跑一次重复注入（v9.3）
 *   ⚠️ 每个可切换 <main> 必须带 data-et —— 缺了 main[data-et].et-hide 匹配不上，切走也隐藏不掉
 */
const rsecAll = rsec;
t('端游资源页恰好 3 个平级页签', count(res, /class="res-tab[ ">]/g) === 3, `实际 ${count(res, /class="res-tab[ ">]/g)}`);
t('端游资源页页签顺序为 md/sv/tr（MOD → 存档 → 修改器）',
  (res.match(/class="res-tab[^"]*" data-et="(\w+)"/g) || []).map((s) => s.replace(/.*data-et="/, '').replace(/"$/, '')).join(',') === 'md,sv,tr',
  (res.match(/class="res-tab[^"]*" data-et="(\w+)"/g) || []).join(' | '));
t('三个页签文案依次是 MOD / 存档 / 修改器',
  /data-et="md"[\s\S]{0,120}MOD/.test(res)
  && /data-et="sv"[\s\S]{0,120}存档/.test(res)
  && /data-et="tr"[\s\S]{0,120}修改器/.test(res));
t('3 个可切换分区全部带 data-et（缺了 main[data-et].et-hide 匹配不上）',
  [...res.matchAll(/<main\b[^>]*>/g)].length === 3 &&
  [...res.matchAll(/<main\b[^>]*>/g)].every((m) => /data-et="/.test(m[0])));
t('ET_MAP 覆盖全部 3 个分区（漏一个就有页签点了没反应）',
  /ET_MAP = \{ md: '#mods', sv: '#resSaves', tr: '#resTrainers' \}/.test(res));
/* ★ 类名隔离：本页另起 .res-tab / #resTabs，**不复用** #emuTabs/.emu-tab。
 *   复用会让「改手机专区页签样式」意外改到这里（用户对样式的基线要求）。
 * ★ 判据按**类名 token** 判、不按字符串前缀 —— 第一版写的是
 *   「不含 `<button class="emu-tab`」，反证时发现只要把 emu-tab **追加到类列表尾部**
 *   （`class="res-tab on emu-tab"`）就绕过去了，而且还被「页签计数」那条抢了命中，
 *   等于这条判据根本没被证明有效。改成拆 token 后判「整个页面的按钮类名里都没有 emu-tab」。 */
const resBtnCls = [...res.matchAll(/<button class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/));
t('本页切换条是独立的 #resTabs / .res-tab（未复用手机专区的骨架选择器）',
  /<div class="emu-tabs" id="resTabs">/.test(res) && !/id="emuTabs"/.test(res)
  && !resBtnCls.includes('emu-tab')
  && resBtnCls.filter((c) => c === 'res-tab').length === 3,
  `按钮类名 token：${resBtnCls.join(' ')}`);
/* ★ 三个分区骨架必须在**生成器里硬编码**（不能从派生页回读）。
 *   这里直接查生成器源码 + 产物两侧，任一侧缺了都算失败。 */
const buildRes = fs.readFileSync(path.join(root, 'tools', 'build-resource-page.js'), 'utf8');
t('生成器里硬编码了三个分区骨架常量 MODS_HTML / SAVES_HTML / TRAINERS_HTML',
  /const MODS_HTML = /.test(buildRes) && /const SAVES_HTML = /.test(buildRes) && /const TRAINERS_HTML = /.test(buildRes));
/* ★ v10.47：三个分区的骨架 id 变了 —— 排序项改由 resource-sections.js 从 GRP_META
 *   生成（不再写死在 HTML 里，免得 HTML 一张表、JS 一张表各自漂），
 *   开关换成来源下拉。这份清单必须与「生成器里硬编码的常量」和
 *   「resource-sections.js 里 getElementById 的取值」两侧同时对齐。 */
t('端游资源页有「MOD」分区骨架（计数/搜索/来源/排序/网格/更多）',
  ['id="mdCount"', 'id="mdBuilt"', 'id="mdStats"', 'id="mdSearch"', 'id="mdSorts"', 'id="mdSrc"', 'id="mdGrid"', 'id="mdMore"']
    .every((s) => res.includes(s)));
t('端游资源页有「存档」分区骨架（计数/搜索/来源/排序/网格/更多）',
  ['id="svCount"', 'id="svBuilt"', 'id="svStats"', 'id="svSearch"', 'id="svSorts"', 'id="svSrc"', 'id="svGrid"', 'id="svMore"']
    .every((s) => res.includes(s)));
t('端游资源页有「修改器」分区骨架（计数/搜索/来源/排序/网格/更多）',
  ['id="trCount"', 'id="trBuilt"', 'id="trStats"', 'id="trSearch"', 'id="trSrc"', 'id="trSorts"', 'id="trGrid"', 'id="trMore"']
    .every((s) => res.includes(s)));
/* ★ v10.47：三个分区改「按游戏聚合卡」后，整组旧卡面样式（.emu-card .paths / .sv-open /
 *   .emu-card.md .md-lk / .emu-card .tr-note / .emu-card .tr-go）**已删除**。
 *   同 v10.45 的写法：先反向断言「真的删了」，再给正向锚点 ——
 *   否则「CSS 整块丢了」也会让反向断言为真。
 * ★★ 判据必须**同时查主源和派生页**：第一版只查了 `res`（派生页），
 *   反证时往**主源**加回 `.emu-card .sv-open{…}` —— 断言照样 PASS
 *   （因为没重建派生页，res 里当然还是没有）。可**主源才是唯一编辑入口**：
 *   下一个人只要改了主源又碰巧重建，旧样式就回来了，而这条「已删」断言
 *   在重建前一直是绿的 —— 白白给人「守住了」的错觉。
 *   ⇒ 主源与派生页各查一遍（幂等，代价可忽略）。 */
const DEAD_SEL = ['.emu-card .paths{', '.emu-card .sv-open{', '.emu-card.md .md-lk{',
  '.emu-card .tr-note{', '.emu-card .tr-go{'];
t('★★ 旧卡面样式整组已删（反向：主源 + 派生页的 paths / sv-open / md-lk / tr-note / tr-go 都无命中）',
  DEAD_SEL.every((s) => !idx.includes(s) && !res.includes(s)),
  DEAD_SEL.filter((s) => idx.includes(s) || res.includes(s)).join(', ') || '全部已删');
t('★ 正向锚点：组卡样式在（.emu-grid.grp / .emu-card.grp .gl / .emu-card.grp .grp-more）',
  /\.emu-grid\.grp\{/.test(res) && /\.emu-card\.grp \.gl\{/.test(res) && /\.emu-card\.grp \.grp-more\{/.test(res));
t('组卡封面比「一卡一条」矮（92 → 78px）：主体信息在卡内列表，封面只做识别',
  /\.emu-card\.grp \.cov\{height:78px/.test(res));
t('组卡通道按钮与卡内展开按钮都走卡片内小圆角（不走 --cd-r，否则像卡里嵌卡）',
  /\.emu-card\.grp \.gl-lk a\{[^}]*border-radius:6px/.test(res)
  && /\.emu-card\.grp \.grp-more\{[^}]*border-radius:8px/.test(res));
/* ★★ v10.48：修改器「第三方来源」跳转通道的三档配色。
   ★ 主源 :root 是唯一真源 —— 所以**主源和派生页都要查**（只查派生页的话，
     有人只改主源不重建，这里照样绿，而线上加载的正是派生页）。 */
t('★ v10.48：第三方来源通道配色三档都在（--ch-fling / -cheat / -src）',
  ['--ch-fling', '--ch-cheat', '--ch-src'].every((v) => idx.includes(v) && res.includes(v)));
t('★ v10.48：三个新通道类在主源与派生页都有规则（卡内 .gl-lk a 与详情页 .d-res-lk 两处）',
  ['bd-fling', 'bd-cheat', 'bd-src'].every((c) => idx.includes('.gl-lk a.' + c) && res.includes('.gl-lk a.' + c))
  && ['bd-fling', 'bd-cheat', 'bd-src'].every((c) => idx.includes('.d-res-lk.' + c) && res.includes('.d-res-lk.' + c)));
/* ★★ v10.48：「查看全部」改弹窗后新增的样式，以及被它取代的旧实现。 */
t('★ v10.48：弹窗内全量列表 + 搜索条样式在（.grp-pop-s 与卡片语义重置）',
  /\.grp-pop-s\{/.test(res) && /\.grp-pop \.emu-card\.grp\{[^}]*padding:0/.test(res));
t('★★ v10.48 反向：旧的「原地展开」实现（grpExpand）已从资源页脚本里消失',
  !/function grpExpand\s*\(/.test(res),
  /function grpExpand\s*\(/.test(res) ? '仍存在 ⇒ 行为没真正改' : '已删');
t('★ v10.48：卡内按钮文案改成「查看全部 N 条 ▸」（行为已不是原地展开，文案不能留在旧说法）',
  /查看全部 ' \+ Number/.test(res) && !/展开全部 ' \+ Number/.test(res));
/* ★★ v10.49：卡内条目标题改**单行省略**（用户口径「卡片中的内容每条显示一行即可多余字显示省略号即可」）。
   ★ 必须**主源 + 派生页都查**：主源是唯一真源，但线上加载的是派生页 ——
     只查派生页 ⇒ 有人只改主源不重建照样绿；只查主源 ⇒ 改完不重建也绿。
   ★ 反向断言不可省：`line-clamp` 若被写回来，浏览器里它与 `nowrap` 并存会让单行省略**静默失效**
     （clamp 自带换行语义且优先级压过 nowrap），绿着坏掉是最难发现的一种。 */
const GLT = /\.emu-card\.grp \.gl-i \.t\{([^}]*)\}/;
const gltIdx = (idx.match(GLT) || [])[1] || '';
const gltRes = (res.match(GLT) || [])[1] || '';
t('★ v10.49 正向锚点：条目标题规则 .emu-card.grp .gl-i .t 在主源与派生页都取到',
  gltIdx.length > 0 && gltRes.length > 0, gltIdx.slice(0, 70));
t('★★ v10.49：条目标题单行省略（nowrap + ellipsis），主源与派生页一致',
  [gltIdx, gltRes].every((r) => /white-space:nowrap/.test(r) && /text-overflow:ellipsis/.test(r)),
  gltRes.slice(0, 90));
t('★★ v10.49 反向：该规则里没有 line-clamp（写回来会让单行省略静默失效）',
  ![gltIdx, gltRes].some((r) => /line-clamp/.test(r)),
  (gltRes.match(/[^;]*line-clamp[^;]*/) || ['(无)'])[0]);
t('★ v10.49：`min-width:0` 保留（没有它 flex 子项不收缩 ⇒ 省略号根本不出现）',
  [gltIdx, gltRes].every((r) => /min-width:0/.test(r)));
t('★★ v10.49 反向：弹窗不再单独覆盖 .grp-pop .gl-i .t（与卡内同一条规则，一处真源）',
  !/\.grp-pop \.gl-i \.t\{/.test(idx) && !/\.grp-pop \.gl-i \.t\{/.test(res));

/* ================= ★ v10.50 增量：游戏名拆分（展示名/英文名）+ 原贴内容弹窗 =================
 * 用户两句原话：
 *   ① 「应该是游戏名称导致 —— XD 的游戏名称有点小问题，它会用 / 进行分隔中英文游戏名称以及标签等」
 *   ② 「有部分帖子我想获取对应的内容（可以点击弹窗展示标题 + 原贴内容 + 图片等），
 *        且还需要按照原贴的布局放置（大部分都有介绍和使用方式）」
 *
 * ① 的根因与量化：端游库 title 是 `中文名/英文名/标签` 直接拼串，实测 19,430 款里
 *    **16,248 款含 `/`（83.6%）** ⇒ 卡面标题折 2~3 行、卡片参差被撑高。
 *    修法：拆分规则收成唯一真源 `data/game-name.js`（铁律 17 —— 别在两处各写一份剥标签正则）。
 * ② 的前提是**数据早就在本地**：mods.json 的 content 覆盖 8,942/8,943 = 100%、
 *    saves-youxia.json 的 desc 100% —— 只是列表投影按设计只留了摘要字段。
 *    属于「界面缺字段 ≠ 数据源没有」的第二次现场（第一次是 v10.48 的 official_url）。
 *    ⇒ 改的是投影与界面，**不是采集**；正文按需单取（最大一组 717 条 × ~1KB ≈ 700KB，不能随列表下发）。
 */
const GN = require(path.join(root, 'data', 'game-name'));
{
  /* —— ① 拆分规则：标签**从库里推导**，不写死名单 —— */
  const gdRaw = JSON.parse(fs.readFileSync(path.join(root, 'data/games.json'), 'utf8'));
  const gdList = Array.isArray(gdRaw) ? gdRaw : (gdRaw.items || []);
  const derived = GN.deriveTags(gdList.map((g) => g.title)).slice().sort();
  t('★★ v10.50：标签段由全库**推导**（末位 ≥8 次 且 从未出现在首位）—— 实测恰好 3 个，不是写死名单',
    derived.join(',') === '支持VR,支持网络联机,附历代合集', derived.join(','));
  const withSlash = gdList.filter((g) => String(g.title || '').includes('/'));
  const badDisp = withSlash.filter((g) => {
    const d = GN.displayName(g.title);
    return !d || d.includes('/');
  });
  t('★★ v10.50：全库含 `/` 的款 —— 展示名全部非空且**不再含 `/`**（不留「剥一半」的中间态）',
    withSlash.length > 15000 && badDisp.length === 0,
    `${withSlash.length} 款含 / ｜ 异常 ${badDisp.length}`);
  const tagsNow = GN.tagSet();
  const stillTag = gdList.filter((g) => tagsNow.has(GN.displayName(g.title)));
  t('★★ v10.50：剥完仍等于标签的 = 0（「星露谷物语/…/支持网络联机」不能变成名字叫「支持网络联机」）',
    stillTag.length === 0, `剩 ${stillTag.length} 条${stillTag[0] ? '：' + stillTag[0].title : ''}`);
  t('★ v10.50：中英分离 / 多中文别名取末段英文 / 空格尾巴 voices38 摘除 —— 样例逐条正确',
    GN.displayName('星露谷物语/Stardew Valley/支持网络联机') === '星露谷物语'
    && GN.enName('星露谷物语/Stardew Valley/支持网络联机') === 'Stardew Valley'
    && GN.displayName('料理模拟器/烹饪模拟器/Cooking Simulator') === '料理模拟器'
    && GN.enName('料理模拟器/烹饪模拟器/Cooking Simulator') === 'Cooking Simulator'
    && GN.displayName('赛博朋克2077/Cyberpunk 2077') === '赛博朋克2077'
    && GN.enName('赛博朋克2077/Cyberpunk 2077') === 'Cyberpunk 2077'
    && GN.displayName('红色沙漠/Crimson Desert voices38') === '红色沙漠'
    && GN.enName('红色沙漠/Crimson Desert voices38') === 'Crimson Desert',
    [GN.displayName('星露谷物语/Stardew Valley/支持网络联机'),
      GN.enName('料理模拟器/烹饪模拟器/Cooking Simulator')].join(' ｜ '));
  t('★ v10.50：单段名（无 `/`）不产生英文副标题，且展示名原样（去首尾空白）',
    GN.displayName('  Hades  ') === 'Hades' && GN.enName('Hades') === '',
    `displayName=${JSON.stringify(GN.displayName('  Hades  '))} enName=${JSON.stringify(GN.enName('Hades'))}`);
  t('★ v10.50：拆分规则是唯一真源（res-groups 引 game-name 取值，不自己写剥标签正则）',
    /require\('\.\/game-name'\)/.test(rgSrc)
    && /name:\s*displayName\(/.test(rgSrc) && /nameEn:\s*enName\(/.test(rgSrc),
    /require\('\.\/game-name'\)/.test(rgSrc) ? '已引用' : '未引用');

  /* —— ② 卡面：展示名 + 灰字英文名（用户拍板的两行形态） —— */
  t('★ v10.50：组卡卡面标题用展示名（原串 `game` 只留在 hover 提示里，信息一点没丢）',
    /const game = g\.name \|\| g\.game/.test(rsec)
    && /<h4 title="' \+ esc\(gameFull\)/.test(rsec) && /class="alt"/.test(rsec));
  t('★ v10.50：灰字副标题 = 英文名，且超 46 字才截断（没有英文名就不占那一行，卡更矮）',
    /const sub = g\.nameEn/.test(rsec) && /slice\(0, 46\)/.test(rsec));

  /* —— ③ 原贴入口：按数据层的 hasPost 决定，纯链接源一点都不变 —— */
  /* ★ v10.51：游侠那半边从「内联判据」改成调 `savesYx.hasPost()` ——
     下载弹窗的存档行要问同一个问题，写两遍迟早漂（铁律 17）。
     断言的**意图不变**（hasPost 来自数据层、不是前端猜的），判据跟着新写法走。 */
  t('★★ v10.50：hasPost 来自数据层（mods.content / yx 的 desc|steps|shots），不是前端猜的',
    /hasPost: String\(x\.content/.test(rgSrc)
    && /hasPost: savesYx\.hasPost\(x\)/.test(rgSrc) && /function hasPost\(x\)/.test(yxSrc));
  t('★★ v10.50：条目按 `canPost = !!it.hasPost` 决定入口（无正文的行不加 class、不加按钮）',
    /const canPost = !!it\.hasPost/.test(rsec) && /data-post-open/.test(rsec)
    && /' has-post' : ''/.test(rsec));
  t('★ v10.50：卡内点击放行原贴入口（否则整卡分流会先把点击吃掉、弹窗永远打不开）',
    /closest\('\[data-post-open\]'\)/.test(rsec) && /closest\('\.gl-i\.has-post'\)/.test(rsec));
  t('★ v10.50：详情页资源行也有同一个入口（.d-res-po + data-post-open，共用一套委托）',
    /class="d-res-po"[\s\S]{0,160}data-post-open/.test(idx) && /\.d-res-it \.d-res-po\{/.test(idx));

  /* —— ④ 服务端：单条取正文（列表侧只带布尔，避免 ~700KB 膨胀） —— */
  t('★ v10.50：服务端新增 GET /api/res/post（一次一条取原贴正文）',
    /app\.get\('\/api\/res\/post'/.test(srv));
  t('★★ v10.50：接口无正文时回 **200 + has:false**（不是 4xx、也不是空弹窗）—— 纯链接源是正常态，不是错误',
    /has: false, source: srcLabel/.test(rgSrc));

  /* —— ⑤ 弹窗骨架 / 样式 / 行为：四页（主源 + 三张派生页）必须同步 ——
   * ⚠️ 这是 OVERLAY 段的共享资产：只改主源不重建 ⇒ 派生页静默漂移（铁律 1）。
   *    所以**四页一起验**，而不是只验 resources（线上加载的正是派生页）。 */
  const POP_PAGES = [['主源', idx], ['resources', res], ['emulator', emu], ['unpack', upk]];
  for (const [nm, h] of POP_PAGES) {
    t(`★ v10.50 [${nm}] 原贴弹窗骨架在（#postPop + 两处 data-post="close"）`,
      /id="postPop"/.test(h) && count(h, /data-post="close"/g) >= 2,
      `postPop ${count(h, /id="postPop"/g)} ｜ close ${count(h, /data-post="close"/g)}`);
  }
  for (const [nm, h] of POP_PAGES) {
    t(`★ v10.50 [${nm}] 原贴弹窗四件套（postOpen / postPaint / closePostPop / bindPostDelegation + 调用）`,
      /function postOpen\(/.test(h) && /function postPaint\(/.test(h)
      && /function closePostPop\(/.test(h) && /function bindPostDelegation\(/.test(h)
      && /^bindPostDelegation\(\);/m.test(h));
  }
  /* 「按原贴布局」的落地：pre-wrap 保留源站换行 / 全角缩进 / 空行。
     ⚠️ 样式断言取 `{…}` **内部**（整页含某字符串会被注释里的反例假绿）。 */
  const POBODY = /\.postpop-b \.po-body\{([^}]*)\}/;
  {
    const bad = POP_PAGES.filter(([, h]) => !POBODY.test(h));
    t('★★ v10.50 正向锚点：四页都取到 `.po-body` 规则（选择器打错时下面几条会平白变绿）',
      bad.length === 0, bad.map(([n]) => n).join(', ') || '全部命中');
    const missWrap = POP_PAGES.filter(([, h]) => !/white-space:pre-wrap/.test((h.match(POBODY) || [])[1] || ''));
    t('★★ v10.50：正文容器 `white-space:pre-wrap`（换行/缩进原样保留）+ overflow-wrap 兜超长网盘串',
      missWrap.length === 0
      && POP_PAGES.every(([, h]) => /overflow-wrap:anywhere/.test((h.match(POBODY) || [])[1] || '')),
      missWrap.map(([n]) => n).join(', ') || '四页齐全');
    t('★★ v10.50 反向：正文容器**不是** pre-line / normal（pre-line 会把源站缩进的空格吃掉）',
      POP_PAGES.every(([, h]) => {
        const body = (h.match(POBODY) || [])[1] || '';
        return /white-space:pre-wrap/.test(body) && !/white-space:(?!pre-wrap)[a-z-]/.test(body);
      }));
    t('★ v10.50：游侠的结构化字段（steps / shots）也走 pre-wrap 分区渲染',
      POP_PAGES.every(([, h]) => /\.postpop-b \.po-sec \.po-tx\{[^}]*white-space:pre-wrap/.test(h)));
    t('★ v10.50：截图缩略图 + 隐藏取图容器都在（复用主源既有灯箱，不另写一套）',
      POP_PAGES.every(([, h]) => /\.postpop-b \.po-shot img\{[^}]*aspect-ratio:16\/9/.test(h)
        && /\.postpop-b \.po-lb\{display:none\}/.test(h)));
  }

  /* ============ ★ v10.51 增量：下载弹窗的 Mod / 修改器 / 存档也能看原贴内容 ============
   * 用户口径：「Mod 和修改器也同样，变成下载链弹窗能看到获取贴内容」。
   * 数据其实**早就在手上**（`/api/mods/match` 每条都带 `content`，实测 mod 7,824/7,825、
   * modifier 1,118/1,118 = 100%），只是 `dlModRowsHtml` 把它渲染成了一条纯外链。
   * 这一组断言守三件事：
   *   ① 原贴按钮收成**通用类** `.po-btn`（原先卡在 `.emu-card.grp .gl-lk button.po` 里，
   *      换作用域就得抄第二份）；四页都得有这条规则体。
   *   ② Mod / 修改器行改成「整行可点 + 行内按钮」，且**原有「源站 ↗」出口一个不少**。
   *   ③ 整行可点的**必要配套**：委托里必须先判 `a[href]` 让开外链，再 `postOpen` ——
   *      顺序写反 → 点「源站」同时弹原贴；没写 → 同样同时弹。
   *      ⚠️ 光验「能弹出原贴」是**看不见这个 bug 的**（弹出也是个"功能"），必须验顺序。
   */
  const POBTN = /(?:^|\n)\s*\.po-btn\{([^}]*)\}/;
  {
    const bad = POP_PAGES.filter(([, h]) => !POBTN.test(h));
    t('★★ v10.51 正向锚点：四页都取到 `.po-btn` 规则体（选择器改名/打错时下面几条会平白变绿）',
      bad.length === 0, bad.map(([n]) => n).join(', ') || '全部命中');
    t('★★ v10.51：原贴按钮是**通用类**（不再写死在 `.emu-card.grp .gl-lk button.po` 里）',
      POP_PAGES.every(([, h]) => !/\.emu-card\.grp \.gl-lk button\.po\{/.test(h)
        && /\.po-btn\{/.test(h)));
    t('★ v10.51：通用类带 `flex:none`（两个 flex 容器里都不许被长标题挤扁）',
      POP_PAGES.every(([, h]) => /flex:none/.test((h.match(POBTN) || [])[1] || '')));

    /* ② Mod / 修改器行：整行 div + 行内按钮 + 保留外链出口 */
    const modOk = /'<div class="d-dl-it' \+ \(canPost \? ' has-post' : ''\) \+ '"/.test(idx)
      && /data-post-open data-src="mod"/.test(idx);
    t('★★ v10.51：Mod / 修改器行整行可点开原贴（`div.d-dl-it.has-post` + `data-src="mod"`）', modOk);
    t('★★ v10.51 反向：行**不再是**整行外链 `<a class="d-dl-it" href=…>`（回到旧写法这条就红）',
      !/return '<a class="d-dl-it" href=/.test(idx));
    t('★ v10.51：每行都保住「源站 ↗」出口（改了交互不能把原出口弄丢）',
      /class="go" href="' \+ esc\(it\.url \|\| D_JIDI_MODS\)/.test(idx) && /源站 ↗/.test(idx));
    t('★ v10.51：没有正文的条目**不给入口**（`canPost` 判据来自 `it.content`，不是一律给）',
      /const canPost = !!String\(it\.content \|\| ''\)\.trim\(\);/.test(idx));

    /* ③ 存档卡：同一套入口，src=yx */
    t('★★ v10.51：存档卡也有「原贴」入口（`data-src="yx"` + `x.hasPost` 判据）',
      /const poBtn = x\.hasPost/.test(idx) && /data-src="yx"/.test(idx));
    t('★ v10.51：存档卡的「原贴」与同排通道按钮**同尺寸同圆角**（一排里混两个规格肉眼可见）',
      /\.svf \.k button\.po-btn\{font-size:11px;border-radius:7px;padding:5px 9px\}/.test(idx));

    /* ③' 委托顺序：先让开外链，再 postOpen */
    const guard = idx.indexOf("if (t.closest('a[href]')) return;");
    const openCall = idx.indexOf('postOpen(po.dataset.src, po.dataset.id);');
    t('★★ v10.51：`bindPostDelegation` 里**先**让开 `a[href]`、**后**调 postOpen（顺序不能反）',
      guard > -1 && openCall > -1 && guard < openCall, `guard@${guard} open@${openCall}`);
    t('★ v10.51：整行可点后行内有 hover/cursor 反馈（`.d-dl-it.has-post{cursor:pointer}`）',
      POP_PAGES.every(([, h]) => /\.d-dl-it\.has-post\{cursor:pointer\}/.test(h)));

    /* ④ 数据层：判据只有一份 */
    t('★★ v10.51：`savesYx.hasPost()` 是**唯一真源**（slim 与 res-groups 都调它，不各写一遍）',
      /function hasPost\(x\) \{/.test(yxSrc) && /hasPost: hasPost\(x\),/.test(yxSrc)
      && /hasPost: savesYx\.hasPost\(x\),/.test(rgSrc)
      && !/hasPost: \(String\(x\.desc/.test(rgSrc));
    t('★★ v10.51：`slim()`（存档弹窗取的那条路）也带上了 `hasPost` —— 正文照旧不下发，只发这个布尔',
      /hasPost: hasPost\(x\),/.test(yxSrc) && /matchSlim/.test(yxSrc));
    t('★ v10.51：hasPost 判据三选一（desc / steps / shots），与 v10.50 的口径一致',
      /String\(x\.desc \|\| ''\)\.trim\(\) \|\| \(x\.steps \|\| \[\]\)\.length \|\| \(x\.shots \|\| \[\]\)\.length/.test(yxSrc));
  }
  /* 层级：原贴弹窗必须压在「查看全部」下载弹窗之上（那个弹窗里也能点开原贴）。
     ⚠️ 同一个选择器可能有多条规则（窄屏媒体查询里就有 `.dlpop{padding:10px}`）——
        `exec` 只取**首个匹配**会读到一条没有 z-index 的规则 ⇒ 读成 0 ⇒ 下面的比较
        退化成 `130 > 0` **恒真**。所以：① 取所有匹配里最大的 z-index；② 配一条正向锚点钉住
        「三个值都读到了具体数字」，不让它悄悄退化（v10.49 学到的：反向断言必须配正向锚点）。 */
  const zOf = (h, sel) => {
    const re = new RegExp(sel + '\\{([^}]*)\\}', 'g');
    let m, best = 0;
    while ((m = re.exec(h))) {
      const z = /z-index:(\d+)/.exec(m[1]);
      if (z) best = Math.max(best, Number(z[1]));
    }
    return best;
  };
  const zPop = zOf(idx, '\\.postpop'), zDl = zOf(idx, '\\.dlpop'), zSv = zOf(idx, '\\.svloc');
  t('★ v10.50 正向锚点：三个弹窗的 z-index 都读到了具体值（读不到时会退化成 0 > 0 恒真）',
    zPop > 0 && zDl > 0 && zSv > 0, `postpop ${zPop} ｜ dlpop ${zDl} ｜ svloc ${zSv}`);
  t('★★ v10.50：原贴弹窗 z-index 高于下载弹窗与位置弹窗——「查看全部」里点原贴不会被压在下面',
    zPop > zDl && zPop > zSv, `postpop ${zPop} ｜ dlpop ${zDl} ｜ svloc ${zSv}`);
  /* Esc 分层：z-index 最高的一层先关。
     ⚠️ 判据必须是 closePostPop() 的**返回值**（= postShown）而不是 pop.hidden ——
        hidden 要等 180ms 过渡走完才置位，用它会把「已关」读成「还开着」，连按两次 Esc 就关不掉底下那层。 */
  t('★★ v10.50：Esc 分层 —— 原贴弹窗排在搜索/详情之前（用返回值判「真关了」，不看 hidden）',
    (() => {
      const a = idx.indexOf("if (typeof closePostPop === 'function' && closePostPop()) return;");
      const b = idx.indexOf('if (smOpen) { closeSearch(); return; }');
      const c = idx.indexOf('closeDetail();', a);
      return a > 0 && b > a && c > a;
    })());
}

/* ============ ★ v10.52 增量：搜索结果行显示「这款有多少 MOD / 修改器 / 存档」 ============
 * 用户原话：「搜索功能以及搜索后的内容」。
 * 根因**不是没有数据**，而是搜索链路没收：`/api/search/all` 只查 4 个桶，
 * 而 v10.47 建的 `data/res-groups.js` 早就把 5 路来源（机地社区帖 MOD / 游侠存档 /
 * GTrainers / FearlessRevolution / GCM 元数据）按游戏聚好了。
 * 实测搜「赛博朋克2077」→ pc 2 / 手游 1 / 修改器 3 / 云存档 1，
 * 而这款实际有 **717 个 MOD** —— 结果里一个字都没出现。
 *
 * ⚠️ 本段大量用「读源码」而不是「读页面」：功能横跨 server.js（挂字段）、index.html
 *    （渲染 + 直达）、check-card-rules.js（圆角登记）三处，光验页面看不见前两处的口径。
 */
{
  const srvSrc = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const chkSrc = fs.readFileSync(path.join(root, 'tools/check-card-rules.js'), 'utf8');
  const P4 = [['主源', idx], ['emulator', emu], ['resources', res], ['unpack', upk]];
  const miss = (re) => P4.filter(([, h]) => !re.test(h)).map(([n]) => n).join(',') || '四页齐';

  /* ① 正向锚点：不配这两条，下面「chip 带 data-res-tab」之类可以在「压根没渲染」时平白变绿 */
  t('★★ v10.52 正向锚点：`smRow` 真的调用了 `resChips(it)`（不调用时下面几条会平白变绿）',
    /<div class="m">\$\{meta\.join\(''\)\}<\/div>\$\{resChips\(it\)\}/.test(idx));
  t('★★ v10.52 正向锚点：四页都取到 `.res-chip` 规则体（改坏规则体时下面几条会被绕过）',
    P4.every(([, h]) => /\.res-chip\{[^}]*border-radius:7px/.test(h)),
    miss(/\.res-chip\{[^}]*border-radius:7px/));

  /* ② 服务端：复用聚合层，不重做匹配 */
  t('★★ v10.52：`/api/search/all` 的端游桶改挂 `withRes`（不再是 withBh）',
    /pc = \{ count: r\.count, items: r\.items\.map\(withRes\) \};/.test(srvSrc));
  t('★★ v10.52：`withRes` 复用 `resGroups.countsFor`（聚合口径只有一处 —— 铁律 17）',
    /resGroups\.countsFor\(g\.id\)/.test(srvSrc));
  /* ⚠️ 判据说明：这条断言**一开始写的是旧写法**（`if (r.mod || r.saves || r.trainers) o.res = r;`），
     改实现时把「全 0 不挂」的判断移进了 `resFor()`（返回 null 表示「没有」）⇒ 判据失配。
     意图没变（还是「全 0 不许挂字段」），所以改判据、不改实现：三处一起钉住。 */
  t('★★ v10.52：计数全 0 时**不挂字段**（挂 {0,0,0} 只是白占回包体积，前端也分不出「空」与「无」）',
    /if \(r\.mod \|\| r\.saves \|\| r\.trainers\) return \{ counts: r, id: g\.id \};/.test(srvSrc)
    && /return \(r2\.mod \|\| r2\.saves \|\| r2\.trainers\) \? \{ counts: r2, id: alt \} : null;/.test(srvSrc)
    && /if \(h\) \{ o\.res = h\.counts; o\.resId = h\.id; \}/.test(srvSrc));
  /* ③ 孪生兜底：本轮实测踩到的坑 —— 同一款 jidi / xd 两条，资源只挂在一条上 */
  t('★★ v10.52：资源计数有**孪生兜底**（实测赛博朋克2077：xd-191 有 717，jidi-3277800 是 0）',
    /twin\.twinOf\(\{ id: g\.id, title: g\.title, src: g\.source \}\)/.test(srvSrc));
  t('★ v10.52：孪生兜底兜回自己时提前返回（`alt === g.id`），不给搜索加白跑',
    /if \(alt === g\.id\) return null;/.test(srvSrc));
  /* ★ 这一条是设计缺口本身：chip 拿「显示条目」的 id 去开弹窗会查空 ——
     计数归属的可能是**另一条**孪生条目（xd-191 vs jidi-3277800）。必须带出 resId。 */
  t('★★ v10.52：回包同时带 `resId`（计数**归属**的那条库内 id），chip 拿它去开弹窗',
    /o\.resId = h\.id;/.test(srvSrc) && /const rid = it\.resId \|\| it\.id \|\| '';/.test(idx)
    && /data-res-id="\$\{esc\(rid\)\}"/.test(idx));

  /* ④ 前端：三档映射 + 三个 data 属性 */
  t('★★ v10.52：三档 chip 是「数据键 → 下载页签」映射（mod→mod / trainers→modifier / saves→save）',
    /\['mod', 'mod', '🧩', 'MOD'\]/.test(idx) && /\['trainers', 'modifier', '🛠', '修改器'\]/.test(idx)
    && /\['saves', 'save', '💾', '存档'\]/.test(idx));
  t('★★ v10.52：chip 带 `data-res-tab` / `data-res-id` / `data-res-title` 三件套（缺一个就点不动或点错）',
    /class="res-chip \$\{tab\}" data-res-tab="\$\{tab\}"/.test(idx)
    && /data-res-id="\$\{esc\(rid\)\}"/.test(idx)
    && /data-res-title="\$\{esc\(it\.title \|\| ''\)\}"/.test(idx));
  t('★ v10.52：全 0 / 缺字段**不渲染** chip（返回空串，不留空 div）',
    /return bits\.length \?/.test(idx) && /<div class="res-chips">\$\{bits\.join\(''\)\}<\/div>/.test(idx));
  t('★ v10.52：`filter(([k]) => Number(r[k]) > 0)` —— 只列真有货的那几档，0 的不占位',
    /RES_CHIPS\.filter\(\(\[k\]\) => Number\(r\[k\]\) > 0\)/.test(idx));

  /* ⑤ 直达链路 + 委托顺序
   *   ★ v10.53：落点抽成 `gotoResTab`（搜索行与首页卡**共用一条路**）——
   *     所以「顺序」这条断言钉在 `gotoResTab` 里，`openResTab` 只负责存快照 + 关弹窗。 */
  t('★★ v10.52：`gotoResTab` 先 `await openDetailById` **再**开弹窗（顺序反了会被随后一次重绘抢层级）',
    (() => {
      const f = idx.indexOf('async function gotoResTab(');
      if (f < 0) return false;
      const a = idx.indexOf('await openDetailById(id, title);', f);
      const b = idx.indexOf("openUniDownload({ id: String(id), title: String(title || ''), tab });", f);
      return a > f && b > a;
    })());
  t('★★ v10.53：两处挂载点都走 `gotoResTab`（搜索行经 `openResTab`、首页卡直接调）—— 落点只有一处实现',
    /await gotoResTab\(id, title, tab\);/.test(idx)
    && /gotoResTab\(b\.dataset\.resId, b\.dataset\.resTitle, b\.dataset\.resTab\)/.test(idx));
  t('★★ v10.52：chip 的点击必须 `stopPropagation` —— chip 长在 `.sm-row` 里，不拦住会同时开抽屉 + 弹窗',
    (() => {
      const f = idx.indexOf("$$('#smBody .res-chip')");
      if (f < 0) return false;
      const seg = idx.slice(f, f + 400);
      return seg.includes('e.stopPropagation();') && seg.includes('openResTab(b.dataset.resId');
    })());
  t('★ v10.52：chip 悬挂点排在行点击**之前**（先判特例再判通用，读代码时顺序即语义）',
    idx.indexOf("$$('#smBody .res-chip')") <
    idx.indexOf("$$('#smBody .sm-row').forEach(r => r.addEventListener('click', () => openDetailFromSearch(r)));"));

  /* ⑥ 闸门登记：chip 的 7px 圆角属「卡片内部小按钮」，与 .sm-row .go2 同类 */
  t('★ v10.52：`.res-chip` 已登记进 check-card-rules 的 RAD_EXCEPT（不登记会被判成新增卡片容器）',
    /'\.res-chip',/.test(chkSrc));
  t('★ v10.53：`res-chip` 同时进了闸门的 KEY 正则（不进的话这条例外根本不进扫描 = 静默跳过）',
    /skeleton\|res-chip\)/.test(chkSrc));

  /* ⑦ 派生页同步（铁律 1：只改主源不重建 ⇒ 派生页静默漂移） */
  t('[派生页] 四页都同步了 `.res-chips` 容器与三档配色',
    P4.every(([, h]) => /\.res-chips\{/.test(h) && /\.res-chip\.mod\{/.test(h)
      && /\.res-chip\.modifier\{/.test(h) && /\.res-chip\.save\{/.test(h)),
    miss(/\.res-chip\.save\{/));
  t('[派生页] 四页都同步了 `resChips` 与 `gotoResTab`',
    P4.every(([, h]) => /function resChips\(it\)/.test(h) && /async function gotoResTab\(/.test(h)),
    miss(/async function gotoResTab\(/));
}

/* ============================================================================
 * ★ v10.53 增量：首页内容库卡也挂「资源维度」+ 筛选行补「🧩 有 MOD」
 * ----------------------------------------------------------------------------
 * 用户口径（本轮四条线里的第 ② 条）：「首页展示效果」。
 * 改前的实测缺口：首页卡片只有「📱 可玩」「🎮 实测」两枚手机端徽标，
 *   而**筛选行里已经有 🛠 有修改器 / 💾 有存档 两个开关** ——
 *   筛出来的卡片上没有任何对应标记（6,274 款「有云存档」里 5,119 款卡面空白），
 *   反过来卡上有 🛠 的 1,300 款（GTrainers）又筛不到。**筛选和卡面各说各话。**
 *
 * 本版两处动作：
 *   ① 组件通用化：`.sm-row .sm-res-b` → `.res-chip`（搜索行 + 首页卡共用一处实现）
 *   ② 口径同源：`mod/tr/sv` 三个筛选全走 `data/res-groups.js` 的聚合层，
 *      与卡面 chip 同一张表 ⇒ 「筛出来的每一款，卡上都有 chip」成了可断言的性质。
 *
 * ⚠️ 判据里 **不写死命中款数**（264 / 1,377 / 3,691）：那是数据驱动的数字，
 *   写死等于把套件绑在今天的 mods.json 上。条数对齐交给浏览器实拍套件
 *   `test-v1053-home-res.js`（它拿接口回包逐档比）。
 * ========================================================================== */
{
  const srvSrc = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const chkSrc = fs.readFileSync(path.join(root, 'tools/check-card-rules.js'), 'utf8');
  const P4 = [['主源', idx], ['emulator', emu], ['resources', res], ['unpack', upk]];
  const miss = (re) => P4.filter(([, h]) => !re.test(h)).map(([n]) => n).join(',') || '四页齐';

  /* ① 聚合层的「有资源 id 集合」—— 筛选与卡面同源的**唯一**依据 */
  t('★★ v10.53：res-groups 导出 `libIdsFor(cat)`（筛选用「哪些款有资源」的 O(1) 命中表）',
    /function libIdsFor\(cat\)/.test(rgSrc) && /libIdsFor, slimItem, post,/.test(rgSrc));
  t('★★ v10.53：集合在 `build()` 里从 `gByCat` 摊平（与卡面 chip 同出一张 `byKeyCat` 表 ⇒ 不会漂移）',
    /const libIds = \{ mod: new Set\(\), saves: new Set\(\), trainers: new Set\(\) \};/.test(rgSrc)
    && /for \(const x of gByCat\[c\]\) if \(x\.key\.startsWith\('L:'\)\) libIds\[c\]\.add\(x\.key\.slice\(2\)\);/.test(rgSrc));
  t('★ v10.53：未知分区返回空集而不是 undefined（调用方一律 `.has()`，undefined 会当场炸）',
    /return \(cache\.libIds && cache\.libIds\[cat\]\) \|\| EMPTY_SET;/.test(rgSrc));

  /* ② 服务端：三个筛选统一口径 */
  t('★★ v10.53：`/api/library/browse` 改挂 `withRes`（首页卡片从此带 res / resId）',
    /res\.json\(\{ ok: true, \.\.\.r, items: r\.items\.map\(withRes\) \}\);/.test(srvSrc));
  t('★★ v10.53：`mod` / `tr` / `sv` 三个筛选都走 `resGroups.libIdsFor`（与卡面同源）',
    /const modOnly = String\(req\.query\.mod \|\| ''\) === '1';/.test(srvSrc)
    && /if \(modOnly\) \{ const set = resGroups\.libIdsFor\('mod'\); filters\.push\(\(g\) => set\.has\(g\.id\)\); \}/.test(srvSrc)
    && /if \(trOnly\) \{ const set = resGroups\.libIdsFor\('trainers'\); filters\.push\(\(g\) => set\.has\(g\.id\)\); \}/.test(srvSrc)
    && /if \(svOnly\) \{ const set = resGroups\.libIdsFor\('saves'\); filters\.push\(\(g\) => set\.has\(g\.id\)\); \}/.test(srvSrc));
  /* ⚠️ 这条是「反向」断言：旧口径必须**真的消失**，而不是留着当第二份真源（铁律 17）。
     若哪天有人把 xref 版加回来，卡面与筛选会重新分叉，而页面照常渲染、没人会发现。
     ⚠️ 判据必须**先剥注释**再找 —— libOpts 上方那段注释里**故意写了** `xref.trainerIds()`
     说明「旧口径是什么」，不剥的话这条断言会因为注释而假红（本轮实测踩到，第一次写就红了）。 */
  t('★★ v10.53 反向：libOpts 函数体内**不再**用 `xref.trainerIds/saveIds`（旧口径留着=第二份真源）',
    (() => {
      const body = (srvSrc.split('function libOpts')[1] || '').split('function withBh')[0];
      const code = body.replace(/\/\*[\s\S]*?\*\//g, '');   // 剥块注释
      return !/xref\.trainerIds\(/.test(code) && !/xref\.saveIds\(/.test(code);
    })());
  t('★ v10.53：`xref` 仍被 `require` 且 `/api/xref/stats` 仍在（换的是库筛选口径，不是废掉这个模块）',
    /const xref = require\('\.\/data\/xref'\);/.test(srvSrc) && /app\.get\('\/api\/xref\/stats'/.test(srvSrc));

  /* ③ 前端：首页卡挂 chip + 第五个开关 */
  t('★★ v10.53 正向锚点：`rowCard` 真的渲染了 `resChips(it)`（不渲染时下面几条会平白变绿）',
    /<div class="meta">\$\{meta\.join\(''\)\}<\/div>\s*\n\s*\$\{resChips\(it\)\}/.test(idx));
  /* ⚠️ 判据要用**同一串里的相对位置**比（`seg.indexOf` 返回的是相对偏移，
     拿它跟绝对偏移 `f` 比永远为假 —— 本轮第一次写就这么红了一条）。 */
  t('★★ v10.53：订阅式绑定 —— 首页卡的 chip 挂在 `.row-card` 的 `openDetail` **之前**且 `stopPropagation`',
    (() => {
      const f = idx.indexOf('function bindRowCards(');
      if (f < 0) return false;
      const seg = idx.slice(f, f + 700);
      const iChip = seg.indexOf("$$('.res-chip', root || document)");
      const iRow = seg.indexOf("$$('.row-card', root || document)");
      return iChip > 0 && iRow > iChip
        && seg.includes('e.stopPropagation();') && seg.includes('gotoResTab(b.dataset.resId');
    })());
  t('★ v10.53：第五个开关 `#modToggle` 在筛选行里、且带 `.mod-badge` 配色类',
    /id="modToggle" type="button" title="只看机地社区 MOD 收录到的游戏/.test(idx)
    && /class="bh-toggle mod-badge \$\{curMod \? 'on' : ''\}"/.test(idx));
  t('★★ v10.53：`curMod` 四件套齐全（声明 / 查询串 / 计数文案 / 事件绑定）—— 缺一个开关就是死的',
    /let curMod = false;/.test(idx)
    && /if \(curMod\) q \+= '&mod=1';/.test(idx)
    && /if \(curMod\) bits\.push\('🧩 有 MOD'\);/.test(idx)
    && /const mt = \$\('#modToggle'\); if \(mt\) mt\.addEventListener\('click', \(\) => \{/.test(idx));
  /* ⚠️ 这枚 chip 的色相是有理由的：`🎮 有实测记录` 已经是紫，而两者经常同卡相邻出现 */
  t('★ v10.53：`.mod-badge` 用洋红而不是紫（与「🎮 有实测记录」的紫分开，两枚会同卡相邻）',
    /\.bh-toggle\.mod-badge\.on\{background:linear-gradient\(135deg,#A21CAF,#D946EF\)/.test(idx)
    && /\.res-chip\.mod\{color:#A21CAF;/.test(idx));
  /* ⚠️ 负向判据只认**按钮标签**（`>💾 有云存档<`），不认整份源码里有没有这五个字 ——
     主源另有一处注释写着「emulator.html 的『💾 有云存档』开关仍在用」，
     那是对**跨页口径分叉**的如实记录，不该被这条断言判死（本轮实测：第一次写就假红）。 */
  t('★ v10.53：`💾` 的文案与 tooltip 都改成「存档」（旧文案「有云存档」指的是位置库，口径已换）',
    /💾 有存档<\/button>/.test(idx) && /title="只看「能下到」存档文件的游戏：游侠存档 \+ GTrainers/.test(idx)
    && !/>💾 有云存档</.test(idx));
  t('★ v10.53：空态提示不再点名具体开关（4 个涨到 5 个，点名单只会越写越假）',
    /试试放宽容量区间，或关掉「筛选」行里的任一开关/.test(idx));

  /* ④ 派生页同步（铁律 1） */
  /* ⚠️ 「无旧名残留」只查**代码形态**（`.sm-res-b{` / `class="sm-res-b` / `function smResChips(`）——
     注释里**故意留着**旧名（说明「从哪改到哪」），把它一起判死等于逼注释失去信息量。 */
  t('[派生页] 四页都同步了 `.res-chips` / `.res-chip` 通用类（无 `.sm-res-b` 代码残留）',
    P4.every(([, h]) => /\.res-chips\{/.test(h) && /\.res-chip\{/.test(h)
      && !/\.sm-res-b\{/.test(h) && !/class="sm-res-b/.test(h)),
    miss(/\.res-chips\{/));
  t('[派生页] 四页都同步了 `#modToggle` 与 `.mod-badge`（派生页共用筛选条 HTML）',
    P4.every(([, h]) => /id="modToggle"/.test(h) && /\.bh-toggle\.mod-badge\{/.test(h)),
    miss(/id="modToggle"/));
  t('[派生页] 四页都同步了 `libIdsFor` 口径的筛选（`&mod=1` 查询串）',
    P4.every(([, h]) => /q \+= '&mod=1';/.test(h)),
    miss(/q \+= '&mod=1';/));
  t('★ v10.53 反向：主源已无 `smResChips` / `SM_RES` / `.sm-res-b{` 旧名**代码**残留',
    !/function smResChips\(|const SM_RES =|\.sm-res-b\{|class="sm-res-b/.test(idx)
    && P4.every(([, h]) => !/function smResChips\(|const SM_RES =|\.sm-res-b\{|class="sm-res-b/.test(h)));
  t('★ v10.53：闸门 KEY 正则显式收录 `res-chip`（不收录 ⇒ 这条例外根本不进扫描）',
    /const KEY = \/\\\.\(rel-it\|x-it\|row-card\|sm-row\|rk-card\|rk-skel\|sk-th\|emu-card\|skeleton\|res-chip\)\\b\/;/.test(chkSrc));
}

/* ============================================================================
 * ★ v10.53 增量（二）：下载弹窗补 **GTrainers 腿** —— 让「卡上有数」真的点得进去
 * ----------------------------------------------------------------------------
 * 这是「界面缺字段 ≠ 数据源没有」的第 5 次现场：
 *   v10.47 起 `data/res-groups.js` 已把 5 路来源按游戏聚合，**卡面 chip / 搜索行 /
 *   首页筛选 / 资源页 / 详情抽屉** 五处都认 GTrainers，**只有这个弹窗**还在按老口径
 *   各取各的（修改器 = 机地帖 + GCM；存档 = 游侠文件）⇒ chip 点进去是空页签。
 *   实测（按库内 id 能对应上的组）：🛠 有修改器 3,691 款里 **1,300 款（35.2%）只有 GT**；
 *   💾 有存档 1,377 款里 **842 款（61.1%）只有 GT**。
 *
 * ⚠️ 判据里同样**不写死条数**（1,300 / 842 是今天的快照）——
 *   这些数交给浏览器实拍套件 `test-v1053-home-res.js` 逐档比。
 * ⚠️ 排序类判据一律用**同一串内的相对位置**（`indexOf` 互比），
 *   不要拿相对偏移去比绝对偏移（本轮第一版就这么假红了一条）。
 * ========================================================================== */
{
  const srvSrc = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const P4 = [['主源', idx], ['emulator', emu], ['resources', res], ['unpack', upk]];
  const miss = (re) => P4.filter(([, h]) => !re.test(h)).map(([n]) => n).join(',') || '四页齐';

  /* ① 取数：两路都真的接了 GT */
  t('★★ v10.53：`dlUniFetchGt(ctx, cat)` 存在，且**只收 `src === \'gt\'`**（机地/GCM 各有专属渲染，混进来会渲染两遍）',
    /async function dlUniFetchGt\(ctx, cat\)/.test(idx)
    && /return items\.filter\(\(x\) => x && x\.src === 'gt'\);/.test(idx));
  t('★ v10.53：GT 取数走 `/api/res/game`（聚合层的唯一出口，不另开查询口径）',
    /const j = await fetch\(api\('\/api\/res\/game\?' \+ qs\)\)\.then\(\(r\) => r\.json\(\)\);/.test(idx));
  t('★ v10.53：GT 取数**失败返回空数组**而不是抛（GT 段是增量，取不到不该把整个页签变错误页）',
    /} catch \(e\) \{ return \[\]; \}/.test(idx));
  t('★★ v10.53：`dlUniFetchGt` **恰好两处调用**（修改器页签 + 存档页签）—— 少一处就是漏一条腿',
    count(idx, /dlUniFetchGt\(st\.ctx, /g) === 2,
    `实际 ${count(idx, /dlUniFetchGt\(st\.ctx, /g)} 处`);

  /* ② 角标：改成「之和」，与卡面 chip 同源 */
  t('★★ v10.53：修改器角标 = 机地 + GCM + GT 三者之和',
    /st\.cnt\[k\] = community\.count \+ gcm\.length \+ gtr\.length;/.test(idx));
  t('★★ v10.53：存档角标 = 游侠文件 + GT 文件（**不含**位置条数，位置在右上角弹窗里）',
    /st\.cnt\.save = files\.count \+ gts\.length;/.test(idx));
  t('★ v10.53：存档三路也是**并行**取（`Promise.all`，任一路慢/挂不拖着整页）',
    /const \[files, loc, gts\] = await Promise\.all\(\[/.test(idx));
  t('★ v10.53：页签角标数不再出现「位置 + 文件」加起来的老口径（`loc` 只喂位置弹窗）',
    !/st\.cnt\.save = files\.count \+ loc/.test(idx));

  /* ③ 渲染：GT 段共用一处实现（铁律 17） */
  t('★★ v10.53：GT 行渲染 `dlResRowsHtml` **只有一处实现**，且只被 `dlResSection` 调用（两个页签共用）',
    count(idx, /function dlResRowsHtml\(items\)/g) === 1
    && count(idx, /dlResRowsHtml\(items\)/g) === 2,
    `定义 ${count(idx, /function dlResRowsHtml\(items\)/g)} / 调用 ${count(idx, /dlResRowsHtml\(items\)/g)}`);
  t('★ v10.53：GT 行带独立来源角标 `.k.gt`（与机地 `mod`/`mf`、GCM 的 `.tagx` 视觉可分）',
    /<div class="d-dl-it"><span class="k gt">GT<\/span>/.test(idx));
  t('★ v10.53：`.d-dl-it .k.gt` 有专属配色（新增角标必须有样式，否则渲染成裸块）',
    /\.d-dl-it \.k\.gt\{/.test(idx));
  t('★ v10.53：GT 下载通道用 `.dl-res-lk`（`.bd` 第三行，**不塞行尾 `.go`** —— GT 一条常 2~4 通道，塞行尾窄屏会把标题挤没）',
    /<span class="dl-res-lk">/.test(idx) && /\.d-dl-it \.dl-res-lk a\{/.test(idx));
  t('★ v10.53：`.dl-agg` 段落容器有样式（与 `.dl-gcm` 合并选择器，两个第三方段落同款外观）',
    /\.dl-gcm,\.dl-agg\{/.test(idx));

  /* ④ 排序：内容段必须排在「出口链接」**之前**（出口是「去别处找」，内容是「已经找到了」） */
  t('★★ v10.53：修改器页签的 GT 段排在 `.d-dl-links`（模块出口）**之前**',
    (() => {
      const seg = idx.split('function dlUniPaintMod(')[1] || '';
      const iGt = seg.indexOf('out.push(dlResSection(gtr))');
      const iOut = seg.indexOf(`out.push('<div class="d-dl-links">' + dModLinks()`);
      return iGt > 0 && iOut > 0 && iGt < iOut;
    })());
  t('★★ v10.53：存档页签的 GT 段排在「游侠存档区 / 存档库」出口**之前**',
    (() => {
      const seg = idx.split('function dlUniPaintSave(')[1] || '';
      const iGt = seg.indexOf('out.push(dlResSection(gts))');
      const iOut = seg.indexOf('游侠存档区 ↗');
      return iGt > 0 && iOut > 0 && iGt < iOut;
    })());
  t('★ v10.53：修改器页签**只对 `modifier`** 挂 GT 段（`mod` 分区聚合层本来就只有机地一个来源，挂上去是空段）',
    /if \(kind === 'modifier' && gtr\.length\) out\.push\(dlResSection\(gtr\)\);/.test(idx));

  /* ⑤ 空态：这是本轮真正的那个 bug —— 老判据「游侠没文件就早退」会把 GT-only 的 842 款判成空白 */
  t('★★ v10.53：存档空态判据放宽成「两路都没有」，`!items.length` 分支**不再提前 return**',
    !/if \(!items\.length\) \{[\s\S]{0,260}body\.innerHTML = out\.join\(''\);\s*\n\s*return;/.test(
      idx.split('function dlUniPaintSave(')[1] || ''));
  t('★★ v10.53：机地空态在 `gtr.length` 时**不再**提示「到机地 MOD / 修改器区自己搜」（会和下面的 GT 段自相矛盾）',
    /\(gtr\.length \? '' : '<br><span style="font-size:11\.5px">可以点下面的按钮到机地 MOD \/ 修改器区自己搜<\/span>'\)/.test(idx));
  t('★ v10.53：游侠空态在 `gts.length` 时**不再**追「去存档库按名搜」（同上，GT 段就在下面）',
    /\(gts\.length \? '' : '<br><span style="font-size:11\.5px">存档区按游戏名匹配/.test(idx));
  t('★ v10.53：存档页头数字含 GT（`items.length + gts.length`）—— 与角标、与卡面 chip 三处同数',
    /💾 存档文件 <b>' \+ \(items\.length \+ gts\.length\) \+ '<\/b> 个/.test(idx));

  /* ⑥ 服务端出口仍在（前端接了但接口没了 = 静默空段） */
  t('★ v10.53：`/api/res/game` 仍在，且 `limit` 有上限（无上限时前端传 `limit=200` 会变成任意大查询）',
    /app\.get\('\/api\/res\/game'/.test(srvSrc)
    && /const limit = Math\.min\(200, Math\.max\(1, parseInt\(req\.query\.limit, 10\) \|\| 60\)\);/.test(srvSrc)
    && /out\.items\[c\] = resGroups\.byLib\(c, id, limit\);/.test(srvSrc));

  /* ⑦ 四页同步（铁律 1） */
  t('[派生页] 四页都同步了 `dlUniFetchGt` + GT 段渲染',
    P4.every(([, h]) => /async function dlUniFetchGt\(ctx, cat\)/.test(h)
      && /function dlResSection\(items\)/.test(h)), miss(/async function dlUniFetchGt\(ctx, cat\)/));
  t('[派生页] 四页的存档页签都接了 GT 段（`out.push(dlResSection(gts))`）与放宽后的空态',
    P4.every(([, h]) => /out\.push\(dlResSection\(gts\)\)/.test(h)
      && /\(gts\.length \? '' : '<br><span style="font-size:11\.5px">存档区按游戏名匹配/.test(h)),
    miss(/out\.push\(dlResSection\(gts\)\)/));
}
/* 专属 CSS 泄漏闸：追加的 CSS 必须整段待在 <style> 内 */
t('端游资源页 <style> 唯一', count(res, /<style>/g) === 1, `实际 ${count(res, /<style>/g)}`);
t('端游资源页 <script> 数正常（≤3）', count(res, /<script/g) <= 3, `实际 ${count(res, /<script/g)}`);
t('端游资源页专属 CSS 整段在 <style> 内（掉到外面会被当正文渲染）',
  (() => {
    const s1 = res.indexOf('</style>');
    const between = res.slice(s1 + 8, res.indexOf('</head>'));
    return s1 > 0 && !/[.#@][\w-]+\s*\{/.test(between);
  })());
t('端游资源页 </style> 后紧接 </head>（无 CSS 文本夹层）',
  /<\/style>\s*<\/head>/.test(res));
/* 幂等哨兵：三个 init 各只一次，且哨兵锚在长期存在的 initMd 上 */
t('生成器幂等哨兵锚在 initMd 上（v9.3 曾锚在已删函数上导致重复注入）',
  /SEC_SENTINEL = \/function initMd\\s\*\\\(\//.test(buildRes));
t('端游资源页未重复注入 SECTIONS（initMd / initSv / initTr 各只一次）',
  count(res, /function initMd/g) === 1 && count(res, /function initSv/g) === 1 && count(res, /function initTr/g) === 1,
  `initMd ${count(res, /function initMd/g)} / initSv ${count(res, /function initSv/g)} / initTr ${count(res, /function initTr/g)}`);
t('端游资源页 .main-nav 唯一 / .page-back 唯一',
  count(res, /class="main-nav"/g) === 1 && count(res, /class="wrap page-back"/g) === 1);
/* ★ 出站自检（生成器内置，这里再独立验一遍）：驱动脚本引用的 id 必须都在产物里，
 *   否则切到那个页签就是一片空白（不报错，最阴）。 */
{
  const ids = new Set();
  for (const m of rsecAll.matchAll(/getElementById\('([\w-]+)'\)/g)) ids.add(m[1]);
  for (const m of rsecAll.matchAll(/\$\('#([\w-]+)'\)/g)) ids.add(m[1]);
  const missing = [...ids].filter((id) => !res.includes(`id="${id}"`));
  t(`驱动脚本引用的 ${ids.size} 个 id 全部存在于产物中（缺一个就是一页空白）`,
    missing.length === 0, missing.join(', ') || '全部命中');
}
/* 顶栏 / 底部 Tab / 文档头 */
t('端游资源页顶栏「首页」是真跳转 href="/"', /<a href="\/" id="navHome">🏠 首页<\/a>/.test(res));
t('端游资源页顶栏高亮落在「端游资源」上（首页不抢高亮）',
  /<a href="\/resources\.html" class="on" id="navRes">🎮 端游资源<\/a>/.test(res));
t('端游资源页顶栏保留其余 3 个入口（首页 / 手机专区 / 解包匹配）',
  /id="navEmu"/.test(res) && /id="navUnpack"/.test(res));
t('端游资源页 <title> 与文档头已按本页改写',
  /<title>端游资源 · MOD \/ 存档 \/ 修改器 — GameHub<\/title>/.test(res));
t('端游资源页底部 Tab 有回首页入口（href="/"）',
  /<nav class="tabbar"[\s\S]*?href="\/"[\s\S]*?<\/nav>/.test(res));
t('端游资源页底部 Tab 高亮落在「端游资源」上（tabRes, data-tab="md"）',
  /<a href="#" data-tab="md" id="tabRes" class="on"/.test(res));
t('端游资源页底部 Tab 已清掉首页语义死链（latest / about）',
  !/<nav class="tabbar"[\s\S]*?data-tab="latest"[\s\S]*?<\/nav>/.test(res) &&
  !/<nav class="tabbar"[\s\S]*?data-tab="about"[\s\S]*?<\/nav>/.test(res));
/* 底 Tab 的「端游资源」在当前页应当切页签而不是重载到别处 */
t('bootTab 默认进 MOD 页签（缺省不是空白首屏）',
  /switchResTab\(ET_MAP\[t\] \? t : 'md', \{ scroll: false \}\)/.test(res));
t('goEmuPage 兜底指向 /emulator.html（派生页不再依赖主源的绝对地址常量）',
  /function goEmuPage\(\) \{ location\.href = '\/emulator\.html'; \}/.test(res));

/* ⑤ 派生页必须同步到同样的规则（单源双页的核心约束） */
t('[派生页] emulator.html 同步了抽屉 clamp 宽度',
  /width:min\(clamp\(680px,50vw,1040px\),100vw\)/.test(emu));
t('[派生页] emulator.html 同步了 .go2 绝对定位',
  /\.sm-row \.go2\{position:absolute;right:10px/.test(emu));
t('[派生页] emulator.html 同步了分组排序逻辑（pcFit 提权）',
  /pcFit \+ \(pcFit >= 2 \? 1 : 0\)/.test(emu));
t('[派生页] emulator.html 同步了 relSlot 新位置',
  (() => {
    const at = emu.indexOf('id="relSlot"');
    if (at < 0) return false;
    const win = emu.slice(Math.max(0, at - 2000), at);
    return win.includes('${shotsHtml}') && win.includes('${descHtml}');
  })());
t('[派生页] emulator.html 同步了行距收紧',
  /\.sm-row \.t\{[^}]*line-height:1\.3/.test(emu));
/* ★ v10.44：新建的第 4 张派生页同样受「单源」约束 —— 主源改一条，它就得跟着改。
 *   这里挑三条「改了主源最容易忘掉同步」的规则（抽屉宽度 / 搜索行 / 分组排序）。 */
t('[派生页] resources.html 同步了抽屉 clamp 宽度',
  /width:min\(clamp\(680px,50vw,1040px\),100vw\)/.test(res));
t('[派生页] resources.html 同步了 .go2 绝对定位',
  /\.sm-row \.go2\{position:absolute;right:10px/.test(res));
t('[派生页] resources.html 同步了分组排序逻辑（pcFit 提权）',
  /pcFit \+ \(pcFit >= 2 \? 1 : 0\)/.test(res));
t('[派生页] resources.html 同步了抽屉的抽屉内区块样式（.d-blk / .d-sv）',
  /\.d-blk\{/.test(res) && /\.d-sv \.p\{/.test(res));

/* ================= 汇总 ================= */
const fail = R.filter((r) => !r[0]);
console.log('\n' + '='.repeat(66));
for (const [c, n, e] of R) console.log(`${c ? '  PASS' : '× FAIL'}  ${n}${e ? '   [' + e + ']' : ''}`);
console.log('='.repeat(66));
console.log(`结构体检：${R.length - fail.length} / ${R.length} 通过`);
process.exit(fail.length ? 1 : 0);
