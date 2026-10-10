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
