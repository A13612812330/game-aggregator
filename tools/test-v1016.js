/* tools/test-v1016.js —— 第 14 道防线：机型「内部代号 → 品牌+型号」+ kalvo 硬件参数
 *
 * 这块的失效方式都很隐蔽，所以必须钉死：
 *   · **映射表少抓了几个文件是静默的** —— 只是可译率低一截，页面照常渲染（首轮就挂了 10/44 个文件）
 *   · **kalvo 搜索少一个请求头就 401/403**，而错误信息只有一句 `unauthorized` / `forbidden`，
 *     不看状态码根本不知道是缺头还是签名错（其实**不需要签名**，`search.js` 的混淆是障眼法）
 *   · **解析器把 `<br>` 分隔的多值粘成一词**（`Cortex-A756x` 其实是 `Cortex-A75` + `6x`），
 *     数据看着有、内容已经坏了
 *   · **前端字段名不一致 = 空渲染**（v10.13 的老坑），所以这里断言的是「条数 > 0」而不是「区块在」
 *
 * 全部离线可跑：网络部分只断言**代码形状**（URL / 请求头 / 缓存策略），不发真请求。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const P = (f) => path.join(ROOT, f);
const read = (f) => { try { return fs.readFileSync(P(f), 'utf8'); } catch (e) { return ''; } };
const json = (f) => { try { return JSON.parse(read(f)); } catch (e) { return null; } };

let pass = 0, fail = 0;
const ok = (c, label, extra) => {
  if (c) { pass++; console.log('  PASS', label, extra === undefined ? '' : '— ' + extra); }
  else { fail++; console.log('  FAIL', label, extra === undefined ? '' : '— ' + extra); }
};
const sec = (t) => console.log('\n=== ' + t + ' ===');

/* ================== ① 映射表构建器（纯函数） ================== */
sec('① MobileModels 解析器');
const fm = require('./fetch-device-market');

ok(typeof fm.parseMd === 'function' && typeof fm.codeKey === 'function', '导出 parseMd / codeKey');
ok(fm.codeKey('SM-S928B') === 'SMS928B', 'codeKey 去连字符', fm.codeKey('SM-S928B'));
ok(fm.codeKey('sm s928b') === 'SMS928B', 'codeKey 去空格并大写', fm.codeKey('sm s928b'));
ok(fm.codeKey('25053PC47G') === '25053PC47G', 'codeKey 保留字母数字', fm.codeKey('25053PC47G'));
ok(fm.marketKey('POCO F7') === 'pocof7', 'marketKey 去空白', fm.marketKey('POCO F7'));

// 三种段落头写法都要吃：小米系(带[平台码]) / Google系(无平台码) / 无 codename
const mdSample = [
  '# 测试',
  '',
  '**[`O10U`] POCO F7 (`onyx`):**',
  '',
  '`25053PC47G`: POCO F7 国际版',
  '',
  '`25053PC47I`: POCO F7 印度版',
  '',
  '**Pixel (`sailfish`):**',
  '',
  '`G-2PW4100`: Pixel (North America)',
  '',
  '**魅族 M8:**',
  '',
  '`M8`: 魅族 M8',
  '',
  '**Xperia E4 (`Jasmine`):**',
  '',
  '`E2104` `E2105`: Xperia E4',
].join('\n');
const rows = fm.parseMd(mdSample, 'test.md', 'Xiaomi');
const byc = {};
rows.forEach((r) => { byc[fm.codeKey(r.code)] = r; });
ok(rows.length === 6, '解析出 6 条型号行', rows.length + ' 条');
ok(!!byc['25053PC47G'], '[带平台码] POCO F7 的码解析到');
ok(byc['25053PC47G'] && byc['25053PC47G'].cur.market === 'POCO F7', '[带平台码] 市场名正确', byc['25053PC47G'] && byc['25053PC47G'].cur.market);
ok(byc['25053PC47G'] && byc['25053PC47G'].cur.codename === 'onyx', '[带平台码] 抠出 codename', byc['25053PC47G'] && byc['25053PC47G'].cur.codename);
ok(byc['G2PW4100'] && byc['G2PW4100'].cur.market === 'Pixel', '[无平台码] Pixel 解析到', byc['G2PW4100'] && byc['G2PW4100'].cur.market);
ok(byc['M8'] && byc['M8'].cur.market === '魅族 M8', '[无 codename] 魅族 M8 解析到');
ok(!!byc['E2104'] && !!byc['E2105'], '[一行多码] 两个码都注册', 'E2104/E2105');
ok(byc['E2104'] && byc['E2104'].cur.market === 'Xperia E4', '[一行多码] 共用同一市场名');
ok(fm.parseMd('', 'x.md', 'X').length === 0, '空文件不产出垃圾行');
ok(fm.brandOf('xiaomi_cn.md') === 'Xiaomi', 'brandOf: xiaomi_cn → Xiaomi');
ok(fm.brandOf('samsung_global_en.md') === 'Samsung', 'brandOf: samsung_global_en → Samsung');
ok(fm.BRAND_OF.length >= 20, '品牌映射覆盖 >= 20 个前缀', fm.BRAND_OF.length + ' 条');
ok(fm.SKIP_FILES.has('xiaomi-wear.md') && fm.SKIP_FILES.has('mitv_cn.md'), '穿戴/电视类被排除（防短码被抢）');

/* 变体词 */
ok(fm.variantOf('POCO F7 国际版', 'POCO F7').includes('国际版'), 'variantOf 抠出「国际版」', fm.variantOf('POCO F7 国际版', 'POCO F7'));
ok(fm.variantOf('小米 15 国行版', '小米 15').includes('国行'), 'variantOf 抠出「国行」');

/* ★ 抓取必须带重试：raw.githubusercontent 会偶发连接重置，静默少文件 */
const fmSrc = read('tools/fetch-device-market.js');
ok(/for \(let i = 0; i < RETRY/.test(fmSrc) && /RETRY = \d/.test(fmSrc), '★ 下载带重试（防静默少文件）');
ok(/size > 200/.test(fmSrc), '★ 空/超小文件被当成失败重试');
ok(/failed\.push/.test(fmSrc) && /process\.exitCode/.test(fmSrc), '★ 有文件失败时显式报错 + 非零退出码');

/* ================== ② 映射产物 ================== */
sec('② data/device-market.json 产物');
const db = json('data/device-market.json');
ok(!!db, '产物存在且是合法 JSON');
ok(db && db.byCode && Object.keys(db.byCode).length > 5000, 'byCode 条数 > 5000', db ? Object.keys(db.byCode).length : '-');
ok(db && db.byMarket && Object.keys(db.byMarket).length > 2000, 'byMarket 条数 > 2000', db ? Object.keys(db.byMarket).length : '-');
ok(db && db.stats && db.stats.files >= 40, '★ 抓到 >= 40 个品牌文件（少文件是静默失效）', db && JSON.stringify(db.stats));
ok(db && db.stats && db.stats.brands >= 20, '品牌数 >= 20', db && db.stats.brands);
ok(db && db.source && /MobileModels/.test(db.source), '记录了数据源与许可', db && db.source);

// 用户举的例子必须命中
const ex = db && db.byCode['25053PC47G'];
ok(!!ex, '★ 用户举例的 25053PC47G 在表里');
ok(ex && /POCO F7/i.test(ex.market), '25053PC47G → POCO F7', ex && ex.market);
ok(ex && ex.codename === 'onyx', '带了 codename', ex && ex.codename);
// 高频机型
ok(db && db.byCode['2412DPC0AG'] && /POCO X7 Pro/i.test(db.byCode['2412DPC0AG'].market), '2412DPC0AG → POCO X7 Pro');
ok(db && db.byCode['SMS928B'] && /Galaxy S24 Ultra/i.test(db.byCode['SMS928B'].market), 'SMS928B → Galaxy S24 Ultra');

/* ================== ③ 解析模块 ================== */
sec('③ data/devicemarket.js 解析');
const dmk = require('../data/devicemarket');
const r1 = dmk.resolve('Xiaomi 25053PC47G');
ok(r1.resolved === true, 'Xiaomi 25053PC47G 判为「译出代号」');
ok(r1.display === 'Xiaomi POCO F7', '★ display = Xiaomi POCO F7', r1.display);
ok(r1.via === 'strip-brand', '记录了解析路径 strip-brand', r1.via);
ok(dmk.resolve('SM S928B').display === 'Samsung Galaxy S24 Ultra', 'SM S928B → Samsung Galaxy S24 Ultra（空格写法）', dmk.resolve('SM S928B').display);
ok(dmk.resolve('SM-S928B').resolved === true, 'SM-S928B 连字符写法也命中');
ok(dmk.resolve('motorola moto g45 5G').resolved === false, '本来就是营销名 → resolved=false（不冒充译出）');
ok(dmk.cleanMarketing('motorola motorola edge 70 fusion plus').display === 'Motorola edge 70 fusion plus',
  '重复品牌词去重', dmk.cleanMarketing('motorola motorola edge 70 fusion plus').display);
ok(dmk.cleanMarketing('TECNO MOBILE LIMITED TECNO KG6k').display === 'TECNO KG6k',
  '厂商全称（MOBILE LIMITED）被剥掉', dmk.cleanMarketing('TECNO MOBILE LIMITED TECNO KG6k').display);
ok(dmk.resolve('').resolved === false && dmk.resolve('').via === 'empty', '空串不炸');
ok(typeof dmk.resolveMany === 'function', '导出 resolveMany（批量，躲 N+1）');
const mm = dmk.resolveMany(['Xiaomi 25053PC47G', 'SM S928B']);
ok(Object.keys(mm).length === 2, 'resolveMany 返回 2 条', Object.keys(mm).join(','));
/* 市场名带「/ 并列」时取第一段（否则 chip 里塞一长串） */
ok(/红魔 11S Pro$/.test(dmk.resolve('nubia NX809J').display), '市场名并列时取第一段', dmk.resolve('nubia NX809J').display);

/* ================== ④ kalvo 硬件参数模块 ================== */
sec('④ data/devicespec.js（kalvo）');
const dsp = require('../data/devicespec');
const dspSrc = read('data/devicespec.js');

/* ★ 三个请求头缺一不可 —— 这是花时间试出来的，回归必须锁住 */
ok(/'klv-lang': 'en'/.test(dspSrc), '★ 请求头带 klv-lang（缺它 401）');
ok(/'X-Requested-With': 'XMLHttpRequest'/.test(dspSrc), '★ 请求头带 X-Requested-With（缺它 401）');
ok(/Referer: HOST/.test(dspSrc) || /'Referer':/.test(dspSrc), '★ 请求头带 Referer');
ok(/ajax\/search\/\?q=/.test(dspSrc), '★ 搜索走 /ajax/search/（**带尾斜杠**，不带会 401）', '');
ok(!/websign|sign=|_sign|md5|hmac/i.test(dspSrc), '不走签名（实测不需要，别被混淆的 search.js 带偏）');
ok(/curl/.test(dspSrc) && /execFileSync/.test(dspSrc), '本机走 curl 抓取（node fetch 对本机部分站点会被拦）');

/* 缓存策略 */
ok(/TTL = 30 \* 24/.test(dspSrc), '命中缓存 30 天');
ok(/TTL_MISS = 3 \* 24/.test(dspSrc), '★ 未命中也要缓存（3 天）—— 否则每次都空跑');
ok(/device-specs\.json/.test(dspSrc), '缓存落盘 data/device-specs.json');
ok(typeof dsp.hardware === 'function' && typeof dsp.parseSpecs === 'function', '导出 hardware / parseSpecs');
ok(typeof dsp.pickBest === 'function' && typeof dsp.relaxQuery === 'function', '导出 pickBest / relaxQuery');

/* 解析：用内联最小样本（保证离线也能跑） */
const HTML_FIX = `<html><head><title>Xiaomi Poco F7 - 全面参数、价格与评测 | Kalvo</title></head><body>
<div class="specs"><div class="cont"><h3>基本信息</h3><table><tbody>
<tr><td>品牌</td><td>Xiaomi</td></tr><tr><td>型号</td><td>Poco F7</td></tr></tbody></table></div>
<div class="cont"><h3>硬件配置</h3><table><tbody>
<tr><td>芯片组</td><td>Qualcomm Snapdragon 8s Gen 4</td></tr>
<tr><td>图形处理器 (GPU)</td><td>Qualcomm Adreno 825</td></tr>
<tr><td>微架构</td><td>1x 3.21 GHz – Cortex-X4<br>3x 3.01 GHz – Cortex-A720</td></tr>
<tr><td>运行内存 (RAM)</td><td>12GB</td></tr></tbody></table></div>
<div class="cont"><h3>电池</h3><table><tbody><tr><td>电池容量</td><td>6500 mAh</td></tr></tbody></table></div>
</div></body></html>`;
const ps = dsp.parseSpecs(HTML_FIX);
ok(!!ps, 'parseSpecs 返回结果');
ok(ps && /Poco F7/.test(ps.title), '标题抠出来了', ps && ps.title);
ok(ps && ps.groups.length === 3, '章节数 = 3', ps && ps.groups.length);
ok(ps && ps.groups[1].items.length === 4, '硬件配置 4 项', ps && ps.groups[1].items.length);
const flat = {};
(ps ? ps.groups : []).forEach((g) => g.items.forEach((i) => { flat[i.k] = i.v; }));
ok(flat['芯片组'] === 'Qualcomm Snapdragon 8s Gen 4', '芯片组值正确');
ok(/Adreno 825/.test(flat['图形处理器 (GPU)'] || ''), 'GPU 值正确');
/* ★ <br> 必须变成分隔符，不能粘成一词 */
ok(flat['微架构'] === '1x 3.21 GHz – Cortex-X4 / 3x 3.01 GHz – Cortex-A720',
  '★ <br> 分隔的多值没被粘成一词', flat['微架构']);
ok(!/Cortex-X43x/.test(flat['微架构'] || ''), '★ 没有出现 X43x 这种粘连');

/* 摘要 */
const dg = dsp.digestGroups(ps ? ps.groups : []);
ok(dg.length >= 3, '摘要至少 3 条', dg.length + ' 条');
ok(dg.some((d) => d.key === 'soc' && /Snapdragon 8s Gen 4/.test(d.value)), '摘要含 SoC');
ok(dg.some((d) => d.key === 'gpu' && /Adreno 825/.test(d.value)), '摘要含 GPU');
ok(dg.some((d) => d.key === 'ram' && /12GB/.test(d.value)), '摘要含 RAM');
ok(dg.some((d) => d.key === 'battery' && /6500/.test(d.value)), '摘要含电池');

/* 选最优命中：必须优先取完全相等，别让 F7 Pro 抢走 F7 */
const res = [
  { name: 'Xiaomi Poco F7 Pro', slug: 'a.html' },
  { name: 'Xiaomi Poco F7', slug: 'b.html' },
  { name: 'Xiaomi Poco F7 Ultra', slug: 'c.html' },
];
ok(dsp.pickBest(res, 'POCO F7').slug === 'b.html', '★ 优先取完全相等的那条（不被 F7 Pro 抢走）', dsp.pickBest(res, 'POCO F7').slug);
ok(dsp.pickBest(res, 'POCO F7 Ultra').slug === 'c.html', '完全相等优先于前缀', dsp.pickBest(res, 'POCO F7 Ultra').slug);
/* ★ 结果名带品牌前缀、查询词不带 —— 归一后谁都不等于谁，全靠「取最短」兜住。
   顺序反过来也必须挑到同一个，否则就是又退化成「谁先返回谁赢」。 */
const resRev = res.slice().reverse();
ok(dsp.pickBest(resRev, 'POCO F7').slug === 'b.html',
  '★ 结果顺序颠倒也挑同一台（不靠返回顺序）', dsp.pickBest(resRev, 'POCO F7').slug);
ok(dsp.pickBest([{ name: 'Xiaomi Poco F7', slug: 'x.html' }], 'POCO F7').slug === 'x.html', '只有品牌前缀一条时也能命中');
ok(dsp.pickBest(res, 'x') !== null && dsp.pickBest(res, 'x').slug === 'a.html', '完全不匹配时退回第一条（不返 null）');
ok(dsp.pickBest([], 'x') === null, '空结果返 null');
ok(dsp.pickBest(res, '') !== null, '空查询词不炸');
/* 查询降级：尾部规格词会让 kalvo 搜不到 */
ok(dsp.relaxQuery('moto g45 5G') === 'moto g45', '★ relaxQuery 去掉尾随 5G', dsp.relaxQuery('moto g45 5G'));
ok(dsp.relaxQuery('POCO F7') === 'POCO F7', 'relaxQuery 不乱改正常查询词');

/* 缓存统计 */
const st = dsp.stats();
ok(typeof st.total === 'number' && typeof st.ok === 'number', 'stats() 返回 total / ok', JSON.stringify(st));

/* ================== ⑤ 服务端接线 ================== */
sec('⑤ server.js 端点');
const srv = read('server.js');
ok(/require\('\.\/data\/devicemarket'\)/.test(srv), '引入 devicemarket');
ok(/require\('\.\/data\/devicespec'\)/.test(srv), '引入 devicespec');
ok(/app\.get\('\/api\/device\/specs'/.test(srv), '/api/device/specs 存在');
ok(/app\.get\('\/api\/device\/hardware'/.test(srv), '★ /api/device/hardware 存在');
ok(/app\.get\('\/api\/device\/market'/.test(srv), '/api/device/market 存在');
ok(/devicemarket\.resolve\(m\)/.test(srv), 'specs 端点里调了 resolve（顺带返回 mkt，躲 N+1）');
ok(/devicespec\.hardware\(m, \{ force \}\)/.test(srv), 'hardware 端点调 devicespec.hardware');
/* specs 端点必须返回 mkt 字段，否则前端拿不到品牌型号 */
ok(/mkt\s*=\s*\{/.test(srv) && /spec \? \{ \.\.\.spec, mkt \}/.test(srv), '★ specs 响应里带 mkt 字段');
ok(/Math\.random\(\)/.test(dspSrc) === false, 'devicespec 里没有不确定性（可回归）');

/* 另外两处也会把内部代号暴露给用户的地方，同样要译名 */
ok(/device\/models[\s\S]{0,900}devicemarket\.resolve\(m\.model\)/.test(srv), '★ /api/device/models 给每条补 disp');
ok(/device\/match[\s\S]{0,900}devicemarket\.resolve\(model\)/.test(srv), '★ /api/device/match 给 device 补 disp');
const secs = read('tools/emulator-sections.js');
ok(/esc\(m\.disp \|\| m\.model\)/.test(secs), '★ 手游专区机型下拉显示 disp，回填仍用 model');
ok(/data-m="\$\{esc\(m\.model\)\}"/.test(secs), '★ data-m 仍是原始 model（查询键不能换成译名）');
ok(/esc\(dv\.disp \|\| dv\.model\)/.test(secs), '★ 机型卡抬头优先显示译名');
ok(/dm-code/.test(secs), '内部代号以 .dm-code 小字保留（样式在下面 ⑥ 里单独断言）');

/* ================== ⑥ 前端 ================== */
sec('⑥ public/index.html 前端');
const html = read('public/index.html');
const emu = read('public/emulator.html');

ok(/id="bhHwSlot"/.test(html), '抽屉模板里有 #bhHwSlot');
ok(/async function toggleDevHardware/.test(html), '有 toggleDevHardware');
ok(/function hwPanelHtml/.test(html), '有 hwPanelHtml');
ok(/function hwToggleRest/.test(html), '有 hwToggleRest');
ok(/const HW_KEEP = \['基本信息', '硬件配置', '屏幕', '电池'\]/.test(html), '★ 默认只展开核心 4 节（全开会 1800+px）');
ok(/data-hw="\$\{esc\(x\.hwq\)\}"/.test(html), '★ 按钮带 data-hw（kalvo 只认营销名，不能传原始代号）');
ok(/x\.hwq = \(mk && \(mk\.market \|\| mk\.display\)\) \|\| m/.test(html) || /hwq: \(mk && \(mk\.market \|\| mk\.display\)\) \|\| m/.test(html), 'hwq 取译出的型号名，译不出才退回原名');
ok(/name: disp \|\| m/.test(html), '★ 主行优先显示译出的「品牌+型号」');
ok(/codeShort/.test(html), '副行代号剥掉重复品牌前缀');
ok(/ds\.onclick = /.test(html), '★ 用 onclick 赋值而不是 addEventListener（抽屉每次重渲染，避免监听器累积）');
ok(/_hwOpen = '';/.test(html), '换游戏时重置展开状态');
ok(/if \(_hwOpen !== raw\) return;/.test(html), '★ 竞态保护：切走后丢弃迟到的响应');
ok(/slot\.innerHTML = ''/.test(html) || /slot\.innerHTML = \`<div class="d-hw">/.test(html), '收起/未收录时不留空壳');
ok(/hwq/.test(html) && !/data-hw="\$\{esc\(x\.m\)\}"/.test(html), '没有错用原始代号当查询键');

/* CSS */
ok(/\.d-hw\{/.test(html) && /\.d-hw \.kvs2\{/.test(html), '硬件面板样式存在');
ok(/\.d-devlist \.dv \.sub s\{/.test(html), '副行代号样式存在');
ok(/\.d-hw \.kvs2\{grid-template-columns:1fr\}/.test(html), '★ 窄屏下参数表单列（两列会挤到换行）');
ok(/\.d-hw \.hw-more\{/.test(html), '「展开全部」按钮样式存在');
ok(/\.dm-code\{/.test(html), '机型卡的内部代号小字样式存在');

/* 派生页同步 */
ok(emu.length > 100000, '派生页已重建', (emu.length / 1024).toFixed(0) + 'KB');
ok(/id="bhHwSlot"/.test(emu), '[派生页] 同步了 #bhHwSlot');
ok(/function toggleDevHardware/.test(emu), '[派生页] 同步了 toggleDevHardware');
ok(/function hwToggleRest/.test(emu), '[派生页] 同步了 hwToggleRest');
ok(/\.d-hw \.kvs2\{/.test(emu), '[派生页] 同步了参数面板样式');

/* ★ 机型建议列表有**两个独立渲染分支**（品牌下拉 + 输入即查），首版只改了前者，
   后者铺出来还是内部代号 —— 同一个下拉两副面孔。两条都钉住，避免再漏一边。 */
const dmDispHits = (emu.match(/m\.disp \|\| m\.model/g) || []).length;
ok(dmDispHits >= 2, '★ 派生页两处机型建议列表都走译名（品牌下拉 + 输入即查）', dmDispHits + ' 处');
ok(/const title = m\.disp \|\| m\.model;/.test(emu), '[派生页] 输入即查分支带译名变量');
ok(/disp !== m\.model \? m\.model/.test(emu), '★ 译名生效时把原始代号降级到副行（否则用户照抄代号去搜）');
ok(!/<b>\$\{esc\(m\.model\)\}<\/b>/.test(emu), '机型建议列表里没有「裸代号当主行」残留');

/* ================== ⑦ 覆盖率（真实数据，防止悄悄退坡） ================== */
sec('⑦ 对真实机型库的覆盖率');
const mh = json('data/mobilehub.json');
const devSet = new Set();
(mh && mh.items ? mh.items : []).forEach((it) => (it.devices || []).forEach((d) => { if (typeof d === 'string') devSet.add(d); }));
ok(devSet.size > 500, '机型库样本量 > 500', devSet.size + ' 台');
let resolved = 0;
for (const n of devSet) if (dmk.resolve(n).resolved) resolved++;
const rate = devSet.size ? resolved / devSet.size : 0;
ok(rate > 0.6, '★ 代号可译率 > 60%（低于就是映射表退了）', (rate * 100).toFixed(1) + '%  (' + resolved + '/' + devSet.size + ')');
let brandShown = 0;
for (const n of devSet) { const d = dmk.resolve(n).display; if (d && d !== n) brandShown++; }
ok(brandShown / devSet.size > 0.7, '★ 显示名被改善的比例 > 70%', (brandShown / devSet.size * 100).toFixed(1) + '%');

/* ================== 汇总 ================== */
console.log('\n' + '='.repeat(62));
console.log(`v10.16 防线：${pass} / ${pass + fail} 通过` + (fail ? `，${fail} 失败` : ''));
if (fail) process.exitCode = 1;
