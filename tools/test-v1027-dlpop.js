/* 下载弹窗的「归帖 / 排序 / 盘口筛选 / 折叠」防线的常驻版本 —— v10.27 新增
 *
 * 覆盖四块：
 *   ① 后端：`fetchSectionSmart` 的补抓语义（只在该专区没取满时才补一页 sort=new）
 *   ② 前端渲染层：一行一帖（dlGroupByPost）、排序、筛选 —— 用**取源码求值**在 node 里跑真函数
 *   ③ ★ 跨实现对照：前端 `dlSorted` 与后端 `jidiPosts.sortPosts` 必须给出**同一个顺序**
 *   ④ 接线与死代码：工具条控件 / 事件委托 / CSS 齐备；被替换掉的旧函数必须清干净
 *
 * ★ 为什么必须做第 ③ 条：v10.26 之前排序只在服务端一份，前端那份是**明令禁止**的
 *   （本项目反复踩「同一语义两处实现，改一处忘一处」）。这一版前端确实需要自己排序
 *   （用户能即时切「最热 / 最近发布」，等一次网络往返会很卡），于是**从禁止改成对照**：
 *   同一个输入喂给两份实现，顺序不一致本行即红。
 *
 * ★ 为什么用「取源码求值」而不是 jsdom：弹窗的渲染函数是纯字符串拼接，不碰 DOM。
 *   求值能直接调真函数，比断言「源码里有没有某个字符串」强得多
 *   （后者在注释里出现同一串文字就恒真，本项目栽过多次）。
 *
 * ★ 纯本地、无网络、无副作用。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const jp = require('../fetchers/jidiPosts');

let pass = 0, fail = 0;
const ok = (cond, name, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name + (detail ? '  — ' + detail : '')); }
  else { fail++; console.log('  × FAIL  ' + name + (detail ? '  — ' + detail : '')); }
};
const eq = (got, want, name) => ok(got === want, name, '得到 ' + JSON.stringify(got) + '，期望 ' + JSON.stringify(want));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const IDX = read('public/index.html');
const DL_SRC = read('fetchers/download.js');
const JP_SRC = read('fetchers/jidiPosts.js');

/* ============================================================
 *  ① 后端：补抓 sort=new 的语义
 * ============================================================ */
console.log('=== ① fetchSectionSmart：什么时候才多花一次请求 ===');
ok(typeof jp.fetchSectionSmart === 'function', '★ jidiPosts 暴露 fetchSectionSmart');
ok(/async function fetchSectionSmart/.test(JP_SRC), '源码里确有这个函数（不是只在 exports 里挂了个名字）');
ok(/if \(!\(base\.count > base\.list\.length\)\) return out;/.test(JP_SRC),
  '★★ 补抓条件是「源站总数 > 已取回」—— 取满了就不补（实测本体 22 帖、修改器 4 帖两类 hot/new 结果完全相同，补抓纯属浪费）');
ok(/mergeNew === false/.test(JP_SRC), 'mergeNew:false 可关掉补抓（测试与轻量调用用）');
ok(/out\.newError = String/.test(JP_SRC),
  '★ 补抓失败只记 newError、不影响主结果（否则「切到最近发布没变化」会被当成前端 bug 查半天）');
ok(/merged: !!v\.merged/.test(JP_SRC) && /mergedAdded: v\.added/.test(JP_SRC),
  'sections 里如实标 merged / mergedAdded，前端才能说明数据来源');
/* 合并是**按 id 去重**的，不能只 push */
ok(/const seen = new Set\(base\.list\.map/.test(JP_SRC) && /if \(seen\.has\(k\)\) continue;/.test(JP_SRC),
  '★ 合并按 id 去重（不去重会让同一帖出现两遍，条数也虚高）');

/* 参数语义：perSection 只约束**基础排序**那一路 */
ok(/max: perSection > 0 \? perSection : 0/.test(JP_SRC),
  'perSection 仍然约束基础排序那一路的取数（补抓那页另算，已在注释里写明）');

console.log('\n=== ①② feed/download 透传 ===');
ok(/ct: p\.ct \|\| null/.test(DL_SRC),
  '★★ flatFrom 透传 ct（发布时间）—— 此前只透传 ut，实测 items 里 ct 覆盖 0/210，前端根本没法按时间排');
ok(/merged: !!g\.merged/.test(DL_SRC), 'jidi() 把 sections 的 merged 透传给前端');
ok(/merged: false, mergedAdded: 0/.test(DL_SRC), '★ SSR 兜底那条也标 merged:false（别让前端以为有最近发布那批）');

/* ============================================================
 *  ② 前端渲染层：取源码求值，跑真函数
 * ============================================================ */
console.log('\n=== ② 前端渲染函数（取源码求值）===');
const pickDef = (name) => {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const n = esc(name);
  const pats = [
    /* ★ 顺序要紧：**单行 const 必须排在多行数组/对象之前**。
       `const DL_SORTS = [['hot',…],['new',…]];` 本身就是一行；若先试多行数组模式，
       它会一路吃到文件下方第一个 `\n];` —— 实测抽出 33KB 无关代码，
       求值时报 `$ is not defined`，而错误信息完全指不到这里。 */
    'function ' + n + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}',      // 普通函数
    'const ' + n + ' = [^\\n]*;',                              // 单行 const（esc / DL_CAP / DL_SORTS）
    'const ' + n + ' = \\{[\\s\\S]*?\\n\\};',                  // 多行对象
    'const ' + n + ' = \\[[\\s\\S]*?\\n\\];',                  // 多行数组
  ];
  for (const p of pats) {
    const m = new RegExp(p).exec(IDX);
    if (m) return m[0];
  }
  throw new Error('取不到 ' + name);
};
let F = null;
try {
  F = new Function([
    pickDef('DL_BRAND'), pickDef('DL_BRAND_NAME'), pickDef('DL_CAP'), pickDef('DL_SORTS'),
    pickDef('esc'), pickDef('dlBrand'), pickDef('dlWhen'), pickDef('dlNum'),
    pickDef('dlGroupByPost'), pickDef('dlSorted'), pickDef('dlFiltered'), pickDef('dlPosts'), pickDef('dlRow'),
    'return { DL_BRAND, DL_BRAND_NAME, DL_CAP, DL_SORTS, esc, dlBrand, dlWhen, dlNum, dlGroupByPost, dlSorted, dlFiltered, dlPosts, dlRow };',
  ].join('\n'))();
  ok(true, '能从主源取出并求值这些纯函数（渲染层不碰 DOM，可直接单测）');
} catch (e) {
  ok(false, '取源码求值失败', e.message);
}

if (!F) { console.log('\n（后续断言跳过）'); process.exit(1); }

/* ---- 一行一帖 ---- */
const ADDR = [
  { postId: 'p1', postTitle: '剑星 本体 v1.4.1', postUrl: 'https://jidiyouxi.com/post/detail/p1', author: '老狼', ct: 1782234168000, dpv: 51433, server: '夸克网盘', real: 'https://pan.quark.cn/s/a', pwd: null, section: 'body' },
  { postId: 'p1', postTitle: '剑星 本体 v1.4.1', postUrl: 'https://jidiyouxi.com/post/detail/p1', author: '老狼', ct: 1782234168000, dpv: 51433, server: '百度网盘', real: 'https://pan.baidu.com/s/1a', pwd: '访问码：ab12', section: 'body' },
  { postId: 'p1', postTitle: '剑星 本体 v1.4.1', postUrl: 'https://jidiyouxi.com/post/detail/p1', author: '老狼', ct: 1782234168000, dpv: 51433, server: '迅雷网盘', real: 'https://pan.xunlei.com/s/b', pwd: null, section: 'body' },
  { postId: 'p2', postTitle: '【mod】露娜比基尼', postUrl: 'https://jidiyouxi.com/post/detail/p2', author: '大神', ct: 1753687605000, dpv: 2023, server: '迅雷网盘', real: 'https://pan.xunlei.com/s/c', pwd: null, section: 'mod' },
  { postId: 'p2', postTitle: '【mod】露娜比基尼', postUrl: 'https://jidiyouxi.com/post/detail/p2', author: '大神', ct: 1753687605000, dpv: 2023, server: '百度网盘', real: 'https://pan.baidu.com/s/1c', pwd: null, section: 'mod' },
];

const groups = F.dlGroupByPost(ADDR);
eq(groups.length, 2, '★★ 5 个网盘地址归成 2 帖（改前是 5 行，同一标题重复 3 遍 —— 用户说的「分不清」）');
eq(groups[0].links.length, 3, '一帖的 3 个盘口并进同一行');
eq(groups[1].links.length, 2, '另一帖 2 个盘口');
ok(F.dlGroupByPost([...ADDR, ...ADDR]).length === 2, '同一地址重复出现也不会多出行（按 postId 归并）');

/* XD 那种没有帖子概念的条目：各自成行 */
const XDISH = [{ server: '百度网盘', real: 'https://pan.baidu.com/s/1x', postTitle: null }];
eq(F.dlGroupByPost(XDISH).length, 1, 'XD 条目（无 postId/postUrl）退化成一行一条，与改造前一致');

/* ---- 行渲染：标题完整 + 盘口按钮 + 复制 ---- */
const row = F.dlRow(groups[0]);
ok(/class="dl-it"/.test(row), '行容器 .dl-it');
ok(row.includes('剑星 本体 v1.4.1'), '标题原样进 DOM（不是被 JS 截断的短名）');
ok((row.match(/class="lk bd-/g) || []).length === 3, '★ 3 个盘口各出一个按钮（.lk）', String((row.match(/class="lk bd-/g) || []).length));
ok(/迅雷|百度|夸克/.test(row), '盘口按钮写的是中文名，不是内部类名');
ok(/data-dl-copy=/.test(row), '行内保留「复制」（复制首个盘口，title 里说明是哪个）');
ok(!/dl-mt|undefined|NaN/.test(row), '★ 渲染结果里没有 undefined / NaN（字段缺失时不许把字面量写进 DOM）');
const nullRow = F.dlRow(F.dlGroupByPost([{ postId: 'p9', postTitle: null, server: '百度网盘', real: 'https://pan.baidu.com/s/1z' }])[0]);
ok(/（无标题资源帖）/.test(nullRow) && !/null/.test(nullRow),
  '★ 无标题帖显示占位文案而不是字面量 null');

/* ---- 多盘口时提取码要分清是哪个盘口的 ---- */
const pwRow = F.dlRow(groups[0]);
ok(/提取码 百度 ab12/.test(pwRow),
  '★ 提取码带上盘口名（同帖不同盘口码可能不同，混着写会让人抄错码）', (pwRow.match(/提取码[^<]*/) || [''])[0]);

/* ============================================================
 *  ③ ★ 跨实现对照：前端 dlSorted ≡ 后端 jidiPosts.sortPosts
 * ============================================================ */
console.log('\n=== ③ 前端排序 vs 后端排序（同一输入必须同序）===');
const SAMPLE = [
  { key: 'a', title: null, dpv: 9999, ct: 9999, reviews: 9999 },
  { key: 'b', title: '有名字', dpv: 1, ct: 1, reviews: 1 },
  { key: 'c', title: '也有名字', dpv: 5, ct: 5, reviews: 5 },
  { key: 'd', title: '第三个', dpv: 5, ct: 900, reviews: 2 },
];
for (const s of ['hot', 'new']) {
  const fe = F.dlSorted(SAMPLE, s).map((x) => x.key).join(',');
  const be = jp.sortPosts(SAMPLE, s).map((x) => x.key).join(',');
  eq(fe, be, '★★ sort=' + s + ' 时前端 dlSorted 与后端 sortPosts 顺序一致（不一致本行即红）', fe + ' vs ' + be);
}
ok(F.dlSorted(SAMPLE, 'hot')[3].key === 'a',
  '★ 无标题帖在**前端**也沉底（即使它热度 9999）—— 前后端任一处丢了这条规则，对照那两行就会红');

/* 筛选 + 归帖 + 排序 的完整管线 */
const picked = F.dlPosts(ADDR, 'baidu', 'hot');
eq(picked.length, 2, '★ 按百度筛出 2 帖（筛的是帖，不是地址）');
ok(picked.every((g) => g.links.length === 1 && F.dlBrand(g.links[0].server).cls === 'baidu'),
  '★ 筛选后每帖只剩该盘口的链接（不是把其它盘口也挂在行里）');
eq(F.dlPosts(ADDR, '', 'hot').length, 2, '不筛时是全部帖');
eq(F.dlPosts(ADDR, 'baidu', 'hot')[0].key, 'p1', '筛后仍按热度降序（p1 的 dpv 远高于 p2）');

/* ---- 盘口中文名必须覆盖 dlBrand 能产出的所有 cls ---- */
const brandCls = new Set(F.DL_BRAND.map((x) => x[1]).concat(['other']));
const missing = [...brandCls].filter((c) => !F.DL_BRAND_NAME[c]);
eq(missing.join(','), '', '★ 每个盘口 cls 都有中文名（漏一个，筛选 chip 上就会显示英文类名）');
ok(F.DL_CAP > 0 && F.DL_SORTS.map((x) => x[0]).join(',') === 'hot,new',
  '默认展开上限与排序枚举就位', 'DL_CAP=' + F.DL_CAP + ' ' + F.DL_SORTS.map((x) => x[1]).join('/'));
ok(F.dlWhen(Date.now() - 3600e3).includes('小时前') && /月\d+日/.test(F.dlWhen(new Date('2025-01-02').getTime())),
  '★ 发布时间是「N 小时前 / 1月2日」这种可读串，不是时间戳', F.dlWhen(Date.now() - 3600e3) + ' / ' + F.dlWhen(new Date('2025-01-02').getTime()));

/* ============================================================
 *  ④ 接线、样式、死代码
 * ============================================================ */
console.log('\n=== ④ 接线与样式 ===');
/* 事件委托：四个开关都必须走 document 级委托（#dlBody 每次 innerHTML 重建） */
['data-dl-go', 'data-dl-sort', 'data-dl-filt', 'data-dl-sec', 'data-dl-all'].forEach((a) => {
  ok(IDX.includes("closest('[" + a + "]')"), '★ ' + a + ' 走了事件委托（直接绑在按钮上会被 innerHTML 重建冲掉）');
});
ok(/function paintDownload\(\)/.test(IDX) && /function dlView = null|let dlView = null/.test(IDX),
  '★ 渲染只有一个出口 paintDownload()，状态只有一份 dlView');
ok(/dlView = null;/.test(IDX) && /dlView = null/.test(IDX), '关窗 / 无数据时把状态清掉（否则上一款游戏的选择会串到下一款）');
ok(!/innerHTML[^\n]*dlJidiGroups/.test(IDX) && !/function dlSection\(/.test(IDX),
  '★ 旧的 dlSection / dlJidiGroups 已删（两套渲染分支 = 迟早只改一处）');
ok(!/const DL_SEC_CAP/.test(IDX) && !/function dlHost/.test(IDX),
  '★ 被替换掉的 DL_SEC_CAP / dlHost 已清（死代码会让下一个人以为还有另一条路）');

const CSS = [
  ['.dl-bar{', '顶部工具条'], ['.dl-an{', '专区锚点'], ['.dl-tab,.dl-chip{', '排序与筛选项'],
  ['.dl-tg{', '折叠开关'], ['.dl-more{', '展开全部'], ['.dl-sec.off>.sh{', '折叠态标题行收边距'],
  ['.dl-it .lk{', '盘口按钮'], ['.dl-it .acts{', '盘口按钮组'], ['.dl-it .mt{', '副信息行'],
  ['.dl-it .mt a{', '源帖链接'],
];
for (const [sel, name] of CSS) {
  ok(IDX.includes(sel), '★ ' + name + ' 有样式 ' + sel + '（只写 JS 不加 CSS，控件会渲染成裸文字而存在性断言照样绿）');
}
ok(/-webkit-line-clamp:2/.test(IDX) && /\.dl-it \.tx b\{[^}]*display:-webkit-box/.test(IDX),
  '★★ 标题是 2 行折行（改前 `.tx b` 是 nowrap+ellipsis，6 条标题全被截成「【亲测可玩】…」）');
ok(/width:min\(760px,100%\)/.test(IDX), '★ 弹窗加宽到 760px（改前 580px，长标题没地方落脚）');
ok(/\.dl-grp \.l\{display:flex;flex-direction:column/.test(IDX),
  '★ 列表改单列（改前是 232px 两列网格，标题更挤）');
ok(/\.dl-it \.bd-baidu,\.dl-it \.lk\.bd-baidu/.test(IDX),
  '盘口配色一份两用（缩略徽标与盘口按钮共用，避免两套色值漂移）');

for (const page of ['public/emulator.html', 'public/unpack.html']) {
  let t = '';
  try { t = read(page); } catch (e) { /* 缺文件时下面断言会红 */ }
  ok(/function paintDownload\(\)/.test(t) && /\.dl-bar\{/.test(t),
    '★ ' + page + ' 已重建并带上新弹窗（改主源不重建派生页，那边就没有且不报错）');
}

console.log('\n============================');
console.log('  通过 ' + pass + '/' + (pass + fail) + '（失败 ' + fail + '）');
console.log('============================');
process.exit(fail ? 1 : 0);
