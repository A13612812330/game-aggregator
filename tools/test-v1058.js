#!/usr/bin/env node
/* tools/test-v1058.js —— v10.58 防线：① FR（FearlessRevolution）遗弃 ② 首页「库范围」三视图
 *
 * ★ 为什么需要这两组断言：
 *
 *   ① **FR 遗弃**是不可逆的信息损失，而且它有**一个反向拉力** —— 项目里到处是
 *      「三源合并（GCM + GTrainers + FR）」的历史注释（v10.47 当时的真实口径）。
 *      下一个人读到那些注释，很可能就把这个源重新接回来。所以本组做的是**负向守护**：
 *      钉住「代码里不许再出现 FR 的接线」，同时钉住「SOP 文档在位」——
 *      因为遗弃的前提是「先落 SOP 再删」，SOP 丢了就等于「删了个没人知道怎么重建的东西」。
 *
 *   ② **三视图**（手游 / 端游 / 合并）最容易的静默退化是「三个按钮里有两个效果一样」。
 *      这不是假设：本轮 v10.58 一开始就发现按旧口径做出来的「合并」会**恰好等于端游视图**
 *      （手游侧 1,685 款已挂 libId 的**全部**已在端游库里，实测 0 例外）。
 *      所以断言要钉住**三个视图确实取三份不同的数据**，而不只是「按钮画出来了」。
 *
 * 分组：
 *   A FR 文件实体已摘除            E 三视图·服务端（scope 分支 + 归并）
 *   B FR 接线已从代码里摘除        F 手机专区 `?q=` 落地链路
 *   C 「先落 SOP 再删」的证据      G 元断言：反证靶子在位
 *   D 三视图·前端（含"不许三视图相同"的判据）
 *
 * 跑法：node tools/test-v1058.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const readPub = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');
const has = (p) => fs.existsSync(path.join(ROOT, p));

/** 剥掉注释，只留「用户可见 / 可执行」的部分（同 v10.57 套件的实现）。
 *  ⚠️ 行注释要排除 URL：`https://` 里的 `//` 前一个字符是 `:` ⇒ 用 `(^|[^:])` 前置断言。
 *  ⚠️ 写法必须与 v10.57 逐字一致（`(^|[^:])\/\/[^\n]*`）—— 我第一版写成
 *     `[^\n]*?\/\/[^\n]*`，那个会把 `const x = 1; // 注释` 的**整行**吃掉
 *     （`[^\n]*?` 懒匹配到 `//` 之前），于是「代码里有没有这行」的断言全部假红。 */
function stripComments(s) {
  return String(s)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

let pass = 0, fail = 0;
const t = (ok, name, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`); };
const sec = (s) => console.log('\n── ' + s + ' ──');

/* ============================ A FR 文件实体 ============================ */
sec('A FR 文件实体已摘除（删掉的东西不许悄悄回来）');

t(!has('tools/fetch-fr.js'), 'tools/fetch-fr.js 已删除');
t(!has('fetchers/frCheat.js'), 'fetchers/frCheat.js 已删除');
t(!has('data/fr.js'), 'data/fr.js 已删除');
t(!has('data/fr.json'), 'data/fr.json 未产出（阶段② 从未跑，摘除前实测贡献 0 条）');
t(!has('data/_fr-list-raw.json'), 'data/_fr-list-raw.json 缓存已删除（备份在 _bak/，被 gitignore）');

/* ============================ B FR 接线 ================================ */
sec('B FR 接线已从代码里摘除');

const SRV = read('server.js');
const RG = read('data/res-groups.js');
const SRV_CODE = stripComments(SRV);
const RG_CODE = stripComments(RG);

t(!/require\('\.\/data\/fr'\)/.test(SRV_CODE), 'server.js 不再 require data/fr');
t(!/\/api\/fr\//.test(SRV_CODE), 'server.js 不再有 /api/fr/* 路由（stats / match 两条）');
t(!/require\('\.\/fr'\)/.test(RG_CODE), "res-groups.js 不再 require('./fr')");
t(!/function fromFr/.test(RG_CODE), 'res-groups.js 的 fromFr() 已摘除');
t(!/fr:\s*'FearlessRevolution'/.test(RG_CODE), 'SRC_LABEL / SRC_KEY 里不再有 fr 键');
t(!/'fr\.json'/.test(RG_CODE), 'filesSig 的清单里不再有 fr.json（否则缓存键永远算不中）');
t(/function fromGcm/.test(RG_CODE) && /fromMods\(\), fromYx\(\), fromGt\(\), fromGcm\(\)/.test(RG_CODE),
  '聚合入口现在是四路（mod / yx / gt / gcm）—— 少一路不报错，所以必须钉住');

/* 四页用户可见文案：剥注释后不许再有来源名 */
sec('B2 四页用户可见文案（剥注释后）');
for (const p of ['index', 'emulator', 'resources', 'unpack']) {
  const n = (stripComments(readPub(p + '.html')).match(/FearlessRevolution/g) || []).length;
  t(n === 0, `public/${p}.html 剥注释后零「FearlessRevolution」`, n ? `${n} 处残留` : '');
}
const RESGEN = read('tools/build-resource-page.js');
t(/合了两个来源/.test(RESGEN), '资源页主源改成「合了两个来源」（GTrainers + GCM）');
t(!/合了三个来源/.test(RESGEN), '「合了三个来源」已消失（文案与实现同源）');
t(/来源：GTrainers · GCM 清单/.test(readPub('index.html')), '详情页修改器 hint 的来源列表已去掉 FR');
const RS = read('tools/resource-sections.js');
t(!/fr: 'FearlessRevolution'/.test(RS), 'GRP_SRC_FALLBACK 兜底表已去掉 fr');

/* ============================ C SOP 证据链 ============================= */
sec('C 「先落 SOP 再删」的证据');

const SOP = 'docs/sop/FR-fearlessrevolution-抓取SOP.md';
t(has(SOP), 'SOP 文档在位（遗弃的前提是"先落 SOP 再删"）');
if (has(SOP)) {
  const sop = read(SOP);
  /* 这几段是「将来照做就能重做」的真正载体 —— 缺一段，SOP 就只是一篇悼文 */
  t(/Cloudflare/i.test(sop) && /有头 Chrome/.test(sop), 'SOP 记了访问约束（CF 四条路只有有头浏览器那条通）');
  t(/--gap 400|gap 400/.test(sop), 'SOP 记了实测参数（并发 1 + gap 400ms）');
  t(/528\.2s|8\.8 min/.test(sop), 'SOP 记了阶段① 实测耗时（528.2s / 433 页 / 失败 0）');
  t(/3\.5\s*h|3\.5 h|一次跑完/.test(sop), 'SOP 记了阶段② 的硬约束（≈3.5h 且必须一次跑完）');
  t(/复活手册/.test(sop), 'SOP 带「复活手册」章节（不是只有"为什么不用了"）');
  t(/从未产出|贡献 0|0 条/.test(sop), 'SOP 写明「摘除对数字零影响」的依据');
  /* ⚠️ 引用完整性：SOP 引用的版本档必须真实存在 */
  const refs = [...sop.matchAll(/\]\(\.\.\/versions\/(v10\.\d+)\.md\)/g)].map((m) => m[1]);
  t(refs.length >= 2, 'SOP 引用了版本档（引入源 / 定案遗弃）', refs.join(', '));
  t(refs.every((v) => has(`docs/versions/${v}.md`)), '★ SOP 里每个版本档引用都真实存在（防幻觉引用）', refs.join(', '));
}

/* ============================ D 三视图·前端 ============================ */
sec('D 首页「库范围」三视图 · 前端');

const IDX = readPub('index.html');
const IDX_CODE = stripComments(IDX);

t(/const SCOPES = \[/.test(IDX_CODE), 'SCOPES 常量在位');
/* ⚠️ 必须**只取 SCOPES 那一块**再匹配：容量区间表 SIZES 的第一项也叫 `k: 'all'`
   （`{ k: 'all', nm: '不限' }`，v10.1 就有的老代码）。全文件扫描会扫出
   `all,pc,mob,all` 而假红 —— 这是本轮第二次踩到「判据的作用域没框住」。 */
const SCOPES_BLK = (IDX_CODE.match(/const SCOPES = \[[\s\S]*?\];/) || [''])[0];
t(SCOPES_BLK.length > 100, 'SCOPES 块能被切出来（切不出来下面的断言全是空的）', `${SCOPES_BLK.length} 字`);
const scopeKeys = [...SCOPES_BLK.matchAll(/\{\s*k:\s*'(pc|mob|all)'/g)].map((m) => m[1]);
t(scopeKeys.join(',') === 'pc,mob,all', '三个视图键齐且顺序为 pc → mob → all', scopeKeys.join(','));
t(/let curScope = 'pc'/.test(IDX_CODE), "缺省视图是 'pc'（端游库 —— 与改动前行为一致，不是新默认）");
t(/<span class="filter-lb">库<\/span>/.test(IDX), '筛选条第 4 行「库」的行首标签在位');
t(/id="scopePills"/.test(IDX), 'scopePills 分段控件在位');
t(/q \+= '&scope=' \+ curScope/.test(IDX_CODE), 'filterQuery 把 scope 带进请求（缺了它切按钮不发请求）');
t(/\$\('#scopePills'\)/.test(IDX_CODE), 'scopePills 绑定了点击');
t(/curScope = b\.dataset\.sc; offset = 0; renderCats\(\); renderList\(true\);/.test(IDX_CODE),
  '★ 切库时连带 renderCats()（手游视图要整块换掉分类行，见下条）');

/* 手游视图的分类行：不许留一个「点了没反应」的按钮 */
t(/if \(curScope === 'mob'\)[\s\S]{0,400}手游中心不做分类/.test(IDX_CODE),
  '★ 手游视图下分类行换成说明文字（手游条目没有分类字段，留着按钮就是骗人）');

/* 手游独有的卡 */
t(/data-mol="\$\{it\.mol \? '1' : ''\}"/.test(IDX), 'rowCard 输出 data-mol 标记');
t(/data-mq="\$\{it\.mol \? esc\(it\.title\) : ''\}"/.test(IDX), 'rowCard 输出 data-mq（跳手机专区时带游戏名）');
t(/is-mol/.test(IDX), 'is-mol 类名在位（视觉上区分「仅手机端」）');
t(/📱 仅手机端/.test(IDX), '「仅手机端」徽标在位');
/* ⚠️ 别断言字面量 `emulator.html?q=` —— 代码是**拼接**的：
   `location.href = 'emulator.html' + (mq ? '?q=' + encodeURIComponent(mq) : '')`，
   两段之间隔着 `' + (mq ? '`，字面量永远匹配不上（本轮第三次假红，全是判据写法问题）。 */
t(/c\.dataset\.mol === '1'[\s\S]{0,200}location\.href = 'emulator\.html'/.test(IDX_CODE)
  && /location\.href = 'emulator\.html'[\s\S]{0,120}'\?q=' \+ encodeURIComponent\(mq\)/.test(IDX_CODE),
  '点手游独有卡 ⇒ 去手机专区并**带上 q**（不带上就等于把人送到列表头）');
/* 反向：打不开的路径也要钉住 —— 手游独有卡没有端游详情，不许落到 openDetail */
t(/if \(c\.dataset\.mol === '1'\) \{[\s\S]{0,400}return;[\s\S]{0,60}\}/.test(IDX_CODE),
  '手游独有卡**不再走** openDetail（否则开出空抽屉）');

/* ★ 关键判据：三个视图必须取三份**不同**的数据，不许有两个按钮效果一样 */
sec('D2 ★ 三视图不许「两个按钮一个效果」');
const SRV_CODE2 = stripComments(read('server.js'));
t(/scope === 'mob'[\s\S]{0,600}mobPool\.slice\(offset, offset \+ limit\)/.test(SRV_CODE2),
  'mob 分支取的是手游池');
t(/const pcAll = gamesDb\.browse\([\s\S]{0,400}const mol = gAll \? mobPool\.filter\(\(x\) => x\.mol\) : \[\]/.test(SRV_CODE2),
  '★ all 分支 = 端游全量 ∪ **手游独有**（`filter(x => x.mol)`）——「只并独有」是三个视图互不相同的前提');
t(/total: pcAll\.length \+ mol\.length/.test(SRV_CODE2),
  'all 的 total 由两段相加（不是端游总数 —— 那正是"合并=端游"的退化形态）');
t(/mergePick\(pcAll, mol, keyOf, offset, limit\)/.test(SRV_CODE2),
  'all 走归并取页 mergePick（不拼接全量）');

/* ============================ E 三视图·服务端口径 ====================== */
sec('E 三视图 · 服务端的口径注释（防下轮"顺手合并"）');

t(/为什么 `all` 只并「手游独有」/.test(SRV) || /为什么 `all` 只并「手游独有」/.test(SRV.replace(/\*/g, '`')),
  '服务端写明了「all 只并手游独有」的理由');
t(/1,685 款[\s\S]{0,120}0 例外/.test(SRV) || /1,685\/1,685/.test(SRV),
  '写明了实测依据（1,685 全部已在端游库里）');
t(/mobilehub\.all\(\)/.test(SRV_CODE2), '手游池走 mobilehub.all()（不是 list()—— list 是手机专区的排序口径）');
t(/function all\(\) \{ return itemsView\(ensure\(\)\); \}/.test(stripComments(read('data/mobilehub.js'))),
  'mobilehub 导出的 all() 走 itemsView（GPU 清洗后的视图，与手机专区同源）');

/* ============================ F 手机专区 ?q= 落地 ====================== */
sec('F 手机专区 ?q=<游戏名> 落地链路');

const EMU = stripComments(readPub('emulator.html'));
t(/new URLSearchParams\(location\.search\)\.get\('q'\)/.test(EMU), '手机专区读 URL 的 q 参数');
t(/emuState\.matched = false/.test(EMU),
  '★ 同时关掉「仅看匹配端游」—— 手游独有恰恰是**没匹配上的**那批，只填 q 不关它必然 0 条');
t(/if \(si0\) si0\.value = uq/.test(EMU), '把关键词回填进搜索框（否则用户不知道发生了什么）');

/* ============================ G 元断言 ================================ */
sec('G 元断言：反证靶子在位');

t(has('tools/_counterproof-v1058-scope.js'), '三视图反证脚本存在');
t(has('tools/_counterproof-v1058-fr.js'), 'FR 遗弃反证脚本存在');
/* 元断言：本套件自身必须在 run-all 的 SUITES 里登记 —— 漏登记 = 有条数没防线 */
const RUNALL = read('tools/run-all.js');
t(/'test-v1058\.js'/.test(RUNALL), '★ 本套件已登记进 run-all 的 SUITES（不登记就等于没跑）');

console.log('\n' + '='.repeat(58));
console.log(`v10.58 防线：${pass} / ${pass + fail} 通过` + (fail ? `，${fail} 失败` : ''));
if (fail) process.exitCode = 1;
