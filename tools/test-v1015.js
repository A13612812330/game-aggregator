/* tools/test-v1015.js — 第 13 道防线：v10.15「展示优化」五项
 *
 *   ① 跨源按钮：另一源无详情页 → **不显示**（不再退站内搜索页）
 *   ② 手游专区详情页：手机配置块能看到「本站实测记录」的实际内容
 *   ③ 搜索弹窗：状态条 / 底部按键条 / 四库速览 三块新版式
 *   ④ 手机配置展示：机型清单按性能分升序 + 门槛机型 + 参数卡重点分层
 *   ⑤ 评分去重：详情页「玩家评分」只出现一次
 *
 * 运行：node tools/test-v1015.js     （不需要服务，纯静态 + 数据文件校验）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; fails.push(name); console.log(`  ❌ ${name}${extra ? '  ' + extra : ''}`); }
}

const IDX = read('public/index.html');
const EMU = read('public/emulator.html');
const BUILD = read('tools/build-emulator-page.js');
const SERVER = read('server.js');
const BROWSER = read('tools/browser.js');

/* ================= ① 跨源按钮：无详情页则不显示 ================= */
console.log('\n=== ① 跨源按钮：另一源无详情页 → 不显示 ===');
{
  ok('渲染时按钮就带 hidden（不闪一下搜索页）', /id="crossGo" hidden/.test(IDX));
  ok('linkCounterpart 查不到时把按钮设为 hidden',
    /if \(!hit \|\| !hit\.url\)[\s\S]{0,160}?go\.hidden = true;/.test(IDX));
  ok('查到详情页才 hidden = false 并改写 href',
    /go\.setAttribute\('href', hit\.url\);[\s\S]{0,120}?go\.hidden = false;/.test(IDX));
  /* ★ v10.23：形态校验搬到了后端 data/twin.js（"只留可跳的详情页"这条意图不变）。 */
  ok('[v10.23 迁移] 详情页形态校验在后端 twin.js',
    read('data/twin.js').includes('(topic\\/detail|game)'));
  ok('[v10.23 迁移] resolveCounterpart 改走 /api/library/twin（形态校验在后端）',
    /api\/library\/twin/.test(IDX));
  ok('已删除没人用的站内搜索 URL 构造器（定义与调用都没了）',
    !/function (JIDI_SEARCH|XD_SEARCH)/.test(IDX) && !/(JIDI_SEARCH|XD_SEARCH)\s*\(/.test(IDX)
    && !/function (JIDI_SEARCH|XD_SEARCH)/.test(EMU) && !/(JIDI_SEARCH|XD_SEARCH)\s*\(/.test(EMU));
  ok('新增 syncDActions() 同步按钮列数', /function syncDActions\(\)/.test(IDX));
  ok('paintDetail 结束时调用 syncDActions', /linkCounterpart\(d, fb\);[\s\S]{0,80}?syncDActions\(\);/.test(IDX));
  ok('只剩一个按钮时铺满整行（.d-actions.one）', /\.d-actions\.one\{grid-template-columns:1fr\}/.test(IDX));
  ok('本源无 url 时首个按钮也不渲染', /\$\{d\.url \? `<a class="go \$\{s\.cls\}"/.test(IDX));

  /* 真实数据校验：两个源的详情页 url 必须都能通过 hasDetailUrl 的正则 */
  const RE = /\/(topic\/detail|game)\/\d+/i;
  let bad = 0, total = 0;
  for (const f of ['data/games.json']) {
    const d = JSON.parse(read(f));
    for (const it of (Array.isArray(d) ? d : d.items) || []) { total++; if (!it.url || !RE.test(String(it.url))) bad++; }
  }
  ok('hasDetailUrl 的正则能覆盖库内全部条目 url', bad === 0, `不符 ${bad} / 共 ${total}`);
}

/* ================= ② 手游专区详情页：实测记录可见 ================= */
console.log('\n=== ② 详情页能看到「本站实测」的实际内容 ===');
{
  ok('手机配置块新增 #bhRecSlot 槽位', /<div id="bhRecSlot"><\/div>/.test(IDX));
  ok('loadBhBlock 在 records > 0 时读 /api/pc/records',
    /if \(rec && h\.records > 0\)[\s\S]{0,300}?\/api\/pc\/records\?k=/.test(IDX));
  ok('新增 bhRecRow() 渲染单条实测记录', /function bhRecRow\(x\)/.test(IDX));
  ok('实测卡复用 .pc-rec 版式（不另造一套）', /<div class="pc-rec">\$\{recs\.map\(bhRecRow\)\.join\(''\)\}<\/div>/.test(IDX));
  ok('补齐「可玩 / 不可玩」胶囊配色（.pc-rec 原本缺这两态）',
    /\.pc-rec \.r \.hd \.pill\.ok\{/.test(IDX) && /\.pc-rec \.r \.hd \.pill\.no\{/.test(IDX));
  ok('小节标题写明条数 + 全部实测入口', /本站实测记录<span class="n">\$\{recs\.length\} 条<\/span>/.test(IDX));
  ok('实测记录含可抄参数（兼容层/运行模式/驱动/DXVK）',
    ['兼容层', '运行模式', '驱动', 'DXVK'].every((k) => new RegExp(`add\\('${k}'`).test(IDX)));
  ok('派生页已同步该槽位', /id="bhRecSlot"/.test(EMU));
  ok('/api/pc/records 端点仍在（抽屉依赖它）', /app\.get\('\/api\/pc\/records'/.test(SERVER));
  /* 数据侧：实测库里确实有可渲染的记录（否则整块永远不显示） */
  const pcArr = (JSON.parse(read('data/phonecfg.json')).records || []);
  ok('实测库有记录（区块不是死代码）', pcArr.length > 0, `${pcArr.length} 条`);
  ok('实测记录带 chip / fpsTier / layer 字段',
    pcArr.slice(0, 50).every((x) => x && ('chipName' in x) && ('layer' in x) && ('fpsTier' in x)));
}

/* ================= ③ 搜索弹窗新版式 ================= */
console.log('\n=== ③ 搜索弹窗版式重构 ===');
{
  /* ⚠️ 断言要**圈定在状态条这一块里**：早先写成「sm-hint 之后 260 字内不许有 <kbd>」，
     结果跨过了 </div> 把下面的底部按键条也算进来，永远失败 —— 误报和目标不匹配。 */
  const hintBlock = (IDX.match(/<div class="sm-hint">[\s\S]*?<\/div>/) || [''])[0];
  ok('状态条不再夹键盘按键', hintBlock.length > 0 && !/<kbd>/.test(hintBlock),
    hintBlock.replace(/\s+/g, ' ').slice(0, 80));
  ok('状态条写明「四个库一次搜完」', /端游 · 手游 · 修改器 · 云存档 一次搜完/.test(IDX));
  ok('新增底部按键条 .sm-foot', /\.sm-foot\{display:flex/.test(IDX) && /<div class="sm-foot">/.test(IDX));
  ok('底部按键条含 ↑↓ / Enter / Esc 三组', /<kbd>↑<\/kbd><kbd>↓<\/kbd>选择/.test(IDX)
    && /<kbd>Enter<\/kbd>打开 \/ 搜索/.test(IDX) && /<kbd>Esc<\/kbd>关闭/.test(IDX));
  ok('“看完详情自动回到这里”移到脚注', /<span class="rt">看完详情自动回到这里<\/span>/.test(IDX));
  ok('新增四库速览容器 .sm-stat（4 块）', /\.sm-stat\{display:grid;grid-template-columns:repeat\(4/.test(IDX));
  ok('速览数字有四个库的口径标签', /lb: '端游库'/.test(IDX) && /lb: '手游中心'/.test(IDX)
    && /lb: '修改器'/.test(IDX) && /lb: '云存档'/.test(IDX));
  ok('paintSearchHome 不再用「放大镜占位」空态', !/sm-empty"><div class="big">🔍<\/div>输入关键词搜索本地合并库/.test(IDX));
  ok('loadSmStats 取四个库的统计端点',
    ['/api/library/stats', '/api/mobilehub/stats', '/api/trainers/stats', '/api/saves/stats']
      .every((u) => IDX.includes(`fetch(api('${u}'))`)));
  ok('统计取一次即缓存（smStatCache）', /let smStatCache = null;/.test(IDX));
  ok('取不到时整块不渲染（不显示四个 0）', /if \(!rows\) \{ el\.innerHTML = ''; return; \}/.test(IDX));
  ok('回填前确认槽位还在（用户可能已打字）', /const el = \$\('#smStat'\);\s*if \(!el\) return;/.test(IDX));
  ok('新增口径说明条 .sm-tip', /\.sm-tip\{display:flex/.test(IDX));
  ok('热门 chips 改白底描边 + hover 主色', /\.sm-quick button\{[^}]*background:#fff;border:1px solid var\(--c-border\)/.test(IDX));
  ok('窄屏下速览改两列 + 收起脚注', /\.sm-stat\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/.test(IDX)
    && /\.sm-foot \.rt\{display:none\}/.test(IDX));
  ok('派生页同步了底部按键条', /class="sm-foot"/.test(EMU));
}

/* ================= ④ 手机配置展示效果 ================= */
console.log('\n=== ④ 手机配置展示效果 ===');
{
  ok('机型清单改两列网格', /\.d-devlist\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/.test(IDX));
  /* ★ v10.16：性能分胶囊从 `.dv em`（.dv 的直接子元素）挪进了 `.dv .hd em` ——
     因为整行改成两段式（主行「品牌+型号」/ 副行「代号 + 芯片」），em 要跟主行对齐。
     这是**预期的结构变更**，不是退化：断言跟着新结构改。 */
  ok('每台机型带性能分胶囊 .dv .hd em', /\.d-devlist \.dv \.hd em\{/.test(IDX));
  ok('门槛机型有专属配色 .dv.gate', /\.d-devlist \.dv\.gate\{/.test(IDX));
  ok('汇总行铺满整行 .dv.more', /\.d-devlist \.dv\.more\{grid-column:1\/-1/.test(IDX));
  /* ★ v10.18：门槛**并入清单行内**（用户确认「门槛合并成徽标」）。旧版那条独立的小结行
     与清单首行是同一台，读起来像重复，已删除。这是**预期变更**，断言跟着改。 */
  ok('★ v10.18 门槛改为行内橙色徽标 .gtag，旧小结行已取消',
    /\.d-devlist \.dv \.gtag\{/.test(IDX) && !/\.bh-gate\{display:flex/.test(IDX) && !/<div id="bhGate"><\/div>/.test(IDX));
  ok('机型按性能分升序排序', /sort\(\(a, b\) => \(a\.score \|\| 1e9\) - \(b\.score \|\| 1e9\)\)/.test(IDX));
  ok('门槛 = 有分数的最弱一台', /const gate = sorted\.find\(\(x\) => x\.score > 0\)/.test(IDX));
  ok('★ 门槛含义由徽标 title + 表头图例讲清「更强的也能跑」',
    /比它强的机型基本也能跑/.test(IDX) && /class="d-devlist-lg"/.test(IDX) && /门槛机型/.test(IDX));
  ok('参数卡重点项（驱动/DXVK）带底色', /\.d-param \.pb \.kv\.hot\{background:#F5F3FF/.test(IDX));
  ok('参数卡翻译层带底色', /\.d-param \.pb \.kv\.ok\{background:#ECFDF5/.test(IDX));
  ok('派生页面板同步了重点项底色',
    /\.cf-param \.kvs \.kv\.hot\{background:#f5f3ff/.test(BUILD) && /\.cf-param \.kvs \.kv\.ok\{background:#ecfdf5/.test(BUILD));
  ok('派生页同步了两列机型清单', /\.d-devlist\{display:grid/.test(EMU));
  ok('窄屏下机型清单改单列', /\.d-devlist\{grid-template-columns:1fr\}/.test(IDX));
}

/* ================= ⑤ 评分去重 ================= */
console.log('\n=== ⑤ 评分只出现一次 ===');
{
  /* 只认「真正执行的那句」—— 代码注释里为了说明改了什么，保留了这句的原文，
     用裸 `kv.push(['玩家评分'` 去匹配会命中注释，属误报。 */
  ok('信息表里已删掉「玩家评分」行', !/if \(score\) kv\.push\(\['玩家评分'/.test(IDX));
  ok('大号分数区仍在（.score-line + .score-big）', /class="score-line"/.test(IDX) && /\.score-big\{/.test(IDX));
  ok('新增 .score-meta 说明列', /\.score-meta\{display:flex/.test(IDX));
  ok('paintDetail 模板里「玩家评分」恰好 1 次',
    (IDX.match(/玩家评分 · 满分 10/g) || []).length === 1);
  ok('派生页同样只剩一处评分', (EMU.match(/玩家评分 · 满分 10/g) || []).length === 1);
}

/* ================= 浏览器助手（本轮新增的公共件） ================= */
console.log('\n=== 实拍工具链 ===');
{
  ok('新增 tools/browser.js 公共浏览器助手', /connectBrowser/.test(BROWSER));
  ok('助手优先连 CDP 端口、必要时自己拉起', /cdpUp\(port\)/.test(BROWSER) && /remote-debugging-port=/.test(BROWSER));
  ok('助手注释里记下了「Edge 被沙箱拦」这个坑', /Edge 在.*沙箱|被拦/.test(BROWSER));
  ok('preview-v1015 走公共助手', /require\('\.\/browser'\)/.test(read('tools/preview-v1015.js')));
  ok('preview-v1014 同步改走公共助手', /require\('\.\/browser'\)/.test(read('tools/preview-v1014.js')));
  ok('preview-v1014 的「退到站内搜索」旧断言已按新需求改写',
    /跨源按钮不显示（无详情页可跳）/.test(read('tools/preview-v1014.js'))
    && !/退到站内搜索页（带搜索词）/.test(read('tools/preview-v1014.js')));
}

console.log(`\n${'='.repeat(60)}`);
console.log(`结果：${pass} / ${pass + fail} 通过${fail ? `，${fail} 失败` : ''}`);
if (fail) console.log('失败项：\n - ' + fails.join('\n - '));
process.exit(fail ? 1 : 0);
