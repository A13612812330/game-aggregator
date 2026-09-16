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

const R = [];
const t = (n, c, e) => R.push([c, n, e || '']);
const count = (s, re) => (s.match(re) || []).length;

/* ================= 首页 ================= */
const navBlock = (idx.match(/<nav class="main-nav">[\s\S]*?<\/nav>/) || [''])[0];
t('首页顶栏恰好 2 个入口（首页 / 手机专区）', count(navBlock, /<a /g) === 2, `实际 ${count(navBlock, /<a /g)}`);
t('首页顶栏含「首页」#navHome 与「手机专区」#navEmu',
  /id="navHome"/.test(navBlock) && /navEmu/.test(navBlock) && /emulator\.html/.test(navBlock));
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
 * ★ v10.13：用户要求「模拟器指南放在最后一个」→ eg 从第 4 位挪到末位 */
t('独立页恰好 5 个平级页签', count(emu, /class="emu-tab[ ">]/g) === 5, `实际 ${count(emu, /class="emu-tab[ ">]/g)}`);
t('独立页页签顺序为 emu/tr/sv/dm/eg',
  (emu.match(/data-et="(emu|tr|sv|eg|dm)"/g) || []).slice(0, 5).join(',') ===
    'data-et="emu",data-et="tr",data-et="sv",data-et="dm",data-et="eg"',
  (emu.match(/data-et="(emu|tr|sv|eg|dm)"/g) || []).slice(0, 5).join(','));
t('第 1 个页签是「手游中心」', /data-et="emu"[\s\S]{0,90}手游中心/.test(emu));
t('第 2 个页签是「修改器」且带数字 id', /data-et="tr"[\s\S]{0,60}id="tabNumTr"[\s\S]{0,40}修改器/.test(emu));
t('第 3 个页签是「云存档」且带数字 id', /data-et="sv"[\s\S]{0,60}id="tabNumSv"[\s\S]{0,40}云存档/.test(emu));
t('第 4 个页签是「机型兼容」且带数字 id', /data-et="dm"[\s\S]{0,60}id="tabNumDm"/.test(emu));
t('第 5 个页签是「模拟器指南」', /data-et="eg"[\s\S]{0,90}模拟器指南/.test(emu));
/* ★ v9.1 核心：二级切换条必须彻底删干净（它是「点了没反应」的根源） */
t('二级切换条 #egSubbar 已彻底移除', !/id="egSubbar"/.test(emu));
t('已无 .eg-subbar / .eg-sub 设计残留（注释不计）',
  !/^\s*\.eg-sub[-{]/m.test(emu) && !/<button class="eg-sub/.test(emu));
t('独立页无 tabNumEg 残留（已改 tabNumDm）', !/id="tabNumEg"/.test(emu));
t('独立页无 EMU_PAGE_HREF 残留（否则 Tab 绑定 ReferenceError）', !/EMU_PAGE_HREF/.test(emu));
t('独立页 5 个分区 DOM 齐全',
  ['id="emulator"', 'id="trainers"', 'id="saves"', 'id="emuguide"', 'id="devmatch"'].every((s) => emu.includes(s)));
t('独立页已无 #phonecfg（实测配置已并入手游中心）', !/id="phonecfg"/.test(emu));
/* ★ v9.1 双坑回归：静态测试原本查不出这两个，但它们在真浏览器里都会让「切换失灵」 */
t('5 个可切换分区全部带 data-et（缺了 main[data-et].et-hide 匹配不上）',
  [...emu.matchAll(/<main\b[^>]*>/g)].length === 5 &&
  [...emu.matchAll(/<main\b[^>]*>/g)].every((m) => /data-et="/.test(m[0])));
t('ET_MAP 覆盖全部 5 个分区（漏一个就有页签点了没反应）',
  /ET_MAP = \{ emu: '#emulator', tr: '#trainers', sv: '#saves', eg: '#emuguide', dm: '#devmatch' \}/.test(emu));
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
/* ★ v10：页签由 3 增到 5，窄屏放不下「数字胶囊 + 文字」，
 *   收起断点从 430px 前移到 760px（分区标题仍有「共 N 款」兜底）。 */
t('窄屏（≤760px）隐藏数字胶囊以容纳 5 个页签',
  /max-width:760px[\s\S]{0,300}#emuTabs \.emu-tab b\{display:none\}/.test(emu));
t('独立页有「修改器」分区骨架（搜索/来源/排序/开关/网格）',
  ['id="trSearch"', 'id="trSource"', 'id="trSorts"', 'id="trToggleLib"', 'id="trGrid"', 'id="trMore"'].every((s) => emu.includes(s)));
t('独立页有「云存档」分区骨架（搜索/排序/两个开关/网格）',
  ['id="svSearch"', 'id="svSorts"', 'id="svPhone"', 'id="svCloud"', 'id="svGrid"', 'id="svMore"'].every((s) => emu.includes(s)));
/* ★ 云存档的卡片把路径铺在卡面上，路径区必须真的存在（否则信息全丢） */
t('云存档卡片有路径展示区 .paths 与云同步徽标 .tg.cloud', /\.emu-card \.paths\{/.test(emu) && /\.emu-card \.tg\.cloud\{/.test(emu));
t('云存档网格在窄屏收敛为单列（路径长，两列会挤断）',
  /max-width:430px[\s\S]{0,200}\.emu-grid\.sv\{grid-template-columns:1fr\}/.test(emu));
t('修改器卡片带「放置位置」说明（用户本轮明确要的信息）',
  /tr-note[\s\S]{0,120}放置位置/.test(emu));

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
  /(?:async\s+)?function loadBhBlock/.test(idx) && /loadBhBlock\(d, title\)/.test(idx));
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
t('主源脚本对独立页放行顶栏「首页」的默认跳转（IS_EMU_PAGE 守卫）',
  /IS_EMU_PAGE/.test(idx) && /if \(IS_EMU_PAGE\) return;/.test(idx));
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

/* ① XD 详情：改版后标题在 .article-title-text，且旧代码的「|| 短路 + 未 trim」会让 title 恒为空 */
t('XD 详情按新版结构取标题（.article-title-text + trim 后再判空）',
  /article-title-text/.test(xdFetch) && /const pickText = \(\.\.\.cands\)/.test(xdFetch));
t('XD 详情取到厂商 / 发行日期（.article-meta-item）',
  /game-publisher/.test(xdFetch) && /game-release-date/.test(xdFetch));
t('XD 详情从版本介绍文本里提容量（容量xxGB）', /容量\\s\*\(\[\\d\.\]\+/.test(xdFetch));
t('XD 详情返回标签 tags（新版 .article-tags）', /\.article-tags a/.test(xdFetch) && /tags,/.test(xdFetch));

/* ② 云存档卡片：路径区不跳转 + 每行可复制 + 正文可进详情 */
t('云存档路径行带「复制」按钮', /class="cp"/.test(sec) && /function copyText/.test(sec));
t('云存档卡片正文可点进详情（不再整卡吞掉点击）',
  /if \(e\.target\.closest\('\.paths'\)\) return;/.test(sec));
t('云存档卡片给出「没对上端游库」的明确提示', /存档路径可直接点「复制」/.test(sec));

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

/* ④ 筛选条分行 + 状态不进文案（定宽伪元素） */
const barRowCount = count(emu, /class="emu-bar-row"/g);
t('三条筛选条共拆成 7 行 .emu-bar-row（手游 3 / 修改器 2 / 云存档 2）', barRowCount === 7, `实际 ${barRowCount} 行`);
t('手游中心筛选独占一行（行首有「筛选」标签 + 4 个开关）',
  /<div class="emu-bar-row">\s*<span class="emu-bar-lb">筛选<\/span>[\s\S]{0,900}id="emuToggleSv"/.test(emu));
t('四个筛选开关都在（匹配端游 / 双料 / 有修改器 / 有云存档）',
  ['emuToggleLib', 'emuToggleBoth', 'emuToggleTr', 'emuToggleSv'].every((i) => emu.includes(`id="${i}"`)));
t('开关状态标记走定宽伪元素 .em-tg::before（不进文案，盒宽恒定）',
  /\.emu-refresh\.em-tg::before\{content:'○'/.test(idx) && /\.emu-refresh\.em-tg\.on::before\{content:'✓'\}/.test(idx));
t('开关 JS 不再改 textContent（只切 .on 类）',
  !/\.textContent = \(.*\? '✓ ' : '○ '\)/.test(sec) && /const paint = \(\) => el\.classList\.toggle\('on'/.test(sec));
{
  /* 7 个开关按钮（手游 4 + 修改器 1 + 云存档 2）都必须挂 em-tg，
   * 否则它的状态就会没有标记，或又退回「改文案」的老路 */
  const tgIds = ['emuToggleLib', 'emuToggleBoth', 'emuToggleTr', 'emuToggleSv', 'trToggleLib', 'svPhone', 'svCloud'];
  const missing = tgIds.filter((i) => {
    const m = emu.match(new RegExp('class="([^"]*)" id="' + i + '"'));
    return !(m && /\bem-tg\b/.test(m[1]));
  });
  t('7 个开关按钮都挂了 em-tg 类', missing.length === 0, missing.join(', ') || '全部命中');
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
t('抽屉加宽配套：桌面 KV 三列 / 游戏预览三列',
  /\.kv\{display:grid;grid-template-columns:repeat\(3,1fr\)/.test(idx)
  && /\.shots\{display:grid;grid-template-columns:repeat\(3,1fr\)/.test(idx));
t('移动端（≤760px）KV 仍单列、预览回退两列',
  /\.drawer\{width:100vw\}\s*\n\s*\.kv\{grid-template-columns:1fr\}\s*\n\s*\.shots\{grid-template-columns:repeat\(2,1fr\)\}/.test(idx));

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
t('行缩略图 86×50 → 76×44（.ph2 同步）',
  /\.sm-row img\{width:76px;height:44px/.test(idx) && /\.sm-row \.ph2\{width:76px;height:44px/.test(idx));

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

/* ================= 汇总 ================= */
const fail = R.filter((r) => !r[0]);
console.log('\n' + '='.repeat(66));
for (const [c, n, e] of R) console.log(`${c ? '  PASS' : '× FAIL'}  ${n}${e ? '   [' + e + ']' : ''}`);
console.log('='.repeat(66));
console.log(`结构体检：${R.length - fail.length} / ${R.length} 通过`);
process.exit(fail.length ? 1 : 0);
