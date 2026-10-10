#!/usr/bin/env node
/* tools/run-all.js —— 一键跑完**静态防线**（第一层）
 *
 * 项目三层防线：
 *   ① 静态防线（本脚本）：纯 node / jsdom，秒级，改动后**必跑**
 *   ② 浏览器实拍：`tools/preview-v*.js`、`tools/test-emulator-page.js`、`tools/test-search-ui.js`
 *      —— 含 puppeteer，需服务在 8123 运行；**要加大超时**（120s 默认会 SIGTERM，
 *      看起来像失败其实是超时），且**分批跑**（多套件连同一个 CDP 会抛 detached Frame）
 *   ③ 线上验收：`tools/verify-online.js`（比对线上与本地的 md5，HTTP 200 区分不出新旧）
 *
 * 用法：
 *   node tools/run-all.js            # 跑全部静态套件，输出汇总
 *   node tools/run-all.js --quiet    # 只输出每套的通过数 + 末行汇总
 *
 * 退出码：0 = 全绿；1 = 有失败或套件异常退出。
 *
 * ★ 为什么要有这个脚本（2026-09-19 新增）：
 *   静态套件已有 23 套，手敲 `node tools/test-*.js` 容易漏跑（漏跑的那套往往就是
 *   被改坏的那套）。这里把清单固化，避免"以为跑全了"。
 *   ⚠️ 新增静态套件时**必须**加进下面的 SUITES，否则它会永远不被防线覆盖。
 *
 * ★★ v10.51 补上「否则」的牙齿：上面那句原来是**纯注释**，没人验证。
 *   实测后果见下面四张表前的注释 —— `test-v1025-dlstrip.js` 的一条断言红了 9 个版本
 *   没人知道。现在 `checkCoverage()` 会断言 tools/ 下每个 `test-*.js` 都已登记，
 *   没登记直接报错退出。新增套件时"要不要纳入防线"**必须**显式决定。
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const QUIET = process.argv.includes('--quiet');
/* ★ v10.51：默认只跑静态层（秒级）。加 `--browser` 才把第二层「浏览器实拍」一起跑
 * （需 8123 在跑；每套 9~35s）。两层的清单都在下面、且都受覆盖性守卫约束。 */
const WITH_BROWSER = process.argv.includes('--browser');
/* ★ v10.51：只跑覆盖性守卫就退出。存在的理由是**反证要快而聚焦** ——
 *   验证「没登记的套件会被抓出来」不需要把 41 套断言全跑一遍。 */
const GUARD_ONLY = process.argv.includes('--guard-only');

/* 套件清单 —— 新增一个就往这里加一个。
 * 判据不是「有没有用浏览器」，而是「要不要人盯着」（下面这些都无需交互、秒级出结果）。
 * ⚠️ 其中 test-emulator-page.js 用 jsdom 从 http://127.0.0.1:8123 加载真实页面，
 *    所以跑全量静态防线时**服务要在跑**（否则它会整体失败，看起来像代码坏了）。
 * ⚠️ 末行汇总格式：各套件必须以「通过 n/m」结尾，本脚本取**最后一个** `n / m` 当成绩。 */
const SUITES = [
  'test-alias-guard.js',
  'test-emulator-page.js',
  /* ★ v10.44 新增：端游资源独立页（/resources.html）的 jsdom 行为回归。
   * 起因：MOD / 存档 / 修改器 从「手机专区」平级抽出成第 4 张派生页，
   *       test-emulator-page.js 里那批 tr/sv 用例随之作废 —— 若不同步补一份，
   *       这三类资源就会**看起来有防线、实际零覆盖**（用例删了但没人发现）。
   * 同 test-emulator-page.js，它也要 8123 在跑。 */
  'test-resource-page.js',
  'test-saves-match.js',
  /* ★ v10.46 新增：「游侠存档 × 端游库」**名称匹配**层（前缀通道 + 代际护栏口径）。
   * 起因：这条链路此前零覆盖（test-saves-match.js 测的是 Ludusavi 路径匹配，另一条路），
   *       而 v10.46 真的出过一次静默事故 —— 护栏误用整条标题当查询参数，
   *       匹配数 2,043 → 1,952，页面照常渲染、没有任何东西变红。
   * 纯离线、秒级，不依赖 8123。 */
  'test-youxia-match.js',
  'test-date-norm.js',
  'test-mods.js',
  'test-related-dl.js',
  'test-device-translate.js',
  'test-emulator-structure.js',
  'test-filter-layout.js',
  'test-v1014.js',
  'test-v1015.js',
  'test-v1016.js',
  'test-v1017.js',
  'test-v1018.js',
  'test-spec.js',
  'test-download.js',
  'test-twin.js',
  'test-covers.js',
  'test-card-parity.js',
  'test-pages-sync.js',
  'test-shared-destructure.js',
  'test-report.js',
  'test-match-release.js',
  'test-audit-apps.js',
  'test-launcher.js',
  'test-v1026-jidiposts.js',
  'test-v1027-dlpop.js',
  'test-v1028-detail.js',
  'test-v1029-detail.js',
  'test-v1030-cards.js',
  'test-v1031.js',
  'test-v1032.js',
  'test-v1033.js',
  'test-v1034.js',
  'test-v1035.js',
  'test-v1036.js',
  'test-daily-sync.js',
  /* ★ v10.39 新增：文档结构闸。
   * 起因：v10.36 提交把**整份 WORKFLOW.md** 插进了一行长行的中间（752 行里 336 行是副本），
   * 这个状态在仓库里活了 3 个版本没人发现 —— 因为**没有任何套件看 `.md`**。
   * 本套件守：① 一级标题恰好 1 个 ② 任意偏移下不存在大段重复 ③ 标题路径唯一。
   * ★ 它是**唯一一个不读代码、只读文档**的套件（`root/*.md`，自动发现、不写死清单）。 */
  'test-doc-structure.js',
  /* ★ v10.41 新增：bhparams 防污染。
   * 起因：线上沙箱抓不到 raw.githubusercontent.com ⇒ `/api/bh/params` 抓到 0 条后
   * 仍把 `{total:24, items:[]}` 写回 `data/bhparams.json` 并刷新 ts ⇒ 好数据被覆盖、
   * 7 天 TTL 重新计时 ⇒ 机型清单被打回上游 6 格摘要且一周不重试。
   * 本套件守「本轮全部抓取失败时磁盘缓存逐字节不变」（模块在临时沙箱里跑，不碰真实缓存）。 */
  'test-bhparams-nopoison.js',
  /* ★ v10.54 新增：搜索的**模糊匹配 + 相关度权重**。
   * 起因：匹配逻辑在四个库各写一份（gamesDb / mobilehub / trainers / saves），
   * 其中 gamesDb 那份是**唯一没做归一化**的 ⇒ 实测「巫师3 狂猎」「艾尔登 法环」
   * 端游库 0 命中、而另外三库有命中 —— 同一个查询，四个库给出互相矛盾的答案。
   * 本版把「匹配 + 打分」收敛到 `data/search-rank.js` 一处，这条套件守那个收敛：
   * ① 四库都引入真源、且都删掉自写匹配 ② 带空格/乱序查询四库都有命中
   * ③ 相关度分级严格有序 ④ 代际护栏「搜 4 不出 5」⑤ 组内按相关度排序
   * ⑥ 前端不再自算 fit、分模块视觉层四页同步。纯离线、秒级，不依赖 8123。 */
  'test-v1054-fuzzy.js',
];

/* ============================================================================
 * ★★ v10.51 新增：未纳入静态防线的套件必须**登记**在下面三张表之一
 * ----------------------------------------------------------------------------
 * 起因（实测，不是推测）：v10.45 写的 `test-v1025-dlstrip.js` 里那条
 *   「⑩b 存档模块给的是『放哪』而不是『下什么』」自 v10.46 起**一直是红的**
 *   （v10.46 按用户口径把这一屏反过来 ⇒ `.dl-sv-row` 恒为 0），
 *   而这个套件既不在 SUITES、也不在上面的「刻意不登记」注释里
 *   ⇒ **没有任何东西在看着它**，红了 9 个版本没人发现。
 *
 * 更狠的一层（也是本轮顺手测出来的）：把浏览器实拍层 7 套跑一遍 ——
 *   rail 15/17、more 9/11、search-ui 40/44 全红。
 *   用 `git show HEAD:public/index.html` 换回未改动的主源复跑，**条数逐套一致**
 *   ⇒ 证明这些红**不是**某一轮改出来的，而是长期没人跑。
 *
 * ⇒ 所以「不登记」这件事本身必须是**被机器断言的**，不能只写注释：
 *   tools/ 下每个 `test-*.js` 必须**恰好**出现在 SUITES / BROWSER / COUNTERPROOF / SHIM
 *   之一，否则本脚本直接报错。新增套件时「要不要纳入防线」这个决定**必须显式做出**。
 *
 * 每类都自带**可观测判据**（checkCoverage() 里逐个验），防止文件被塞进错类别：
 *   · BROWSER      → 源码必须 `require('./browser')`（真浏览器专用连接层）
 *   · COUNTERPROOF → 文件名必须含 `counterproof`
 *   · SHIM         → 源码必须 `require('./test-…')`（复用另一个套件的壳）
 * ========================================================================== */

/* 第二层「浏览器实拍」：走 tools/browser.js（CDP 连真实 Edge），不在默认防线里。
 * ★ 它们**可以**无人值守跑（v10.51 实测 9~35s/套，退出码随断言走），
 *   单独分层的唯一原因是**慢一个数量级**（静态层 41 套合计秒级）且必须 8123 在跑。
 *   跑法：`node tools/run-all.js --browser`（一次跑完），或按需单跑。 */
const BROWSER = [
  'test-v1025-dlstrip.js',   /* 详情页下载弹窗四模块（本体/Mod/修改器/存档）交互链 */
  'test-v1025-gallery.js',   /* 画廊渲染 + 翻页 */
  'test-v1025-merge.js',     /* 双源合并去重（截图不重复 + 补来字段标来源） */
  'test-v1025-more.js',      /* 「更多」按钮 + 全部内容弹窗（数字两处一致/不串台） */
  'test-v1025-rail.js',      /* 详情页竖向定位条（落点递增 + 高亮自一致） */
  'test-v1025-search.js',    /* 搜索弹窗「同款聚拢 + 评分分级」+ ★ v10.52 资源计数 chip */
  /* ★ v10.53 新增：首页内容库卡的「资源维度」+ 第五个筛选开关「🧩 有 MOD」。
   * 起因：卡片上原本只有「📱 可玩」「🎮 实测」两枚手机端徽标，而筛选行里已经有
   *       🛠 有修改器 / 💾 有存档 两个开关 —— 筛出来的卡片上没有任何对应标记。
   *       本版让筛选与卡面**同源**（都走 res-groups），这条套件就守那个承诺：
   *       「筛出来的每一张卡，都有对应 chip」+ 卡面数字与接口逐档对齐。 */
  'test-v1053-home-res.js',
  'test-search-ui.js',       /* 搜索弹窗 + 详情抽屉（分组排序 / 行密度 / 三档视口） */
];
/* 反证脚本：**故意打坏**被守护的行为，断言必须变红 ⇒ 它们「失败才是通过」，
 * 永远不能进 SUITES（会把汇总搅成红）。跑法：单跑，看它自己报的「变红条数」。 */
const COUNTERPROOF = [
  'test-v1025-launcher-counterproof.js',
  'test-v1025-search-counterproof.js',
];
/* 兼容壳：内部 require 另一个套件，登记它只会把同一批断言算两遍（不是漏登记）。 */
const SHIM = [
  'test-emuhub.js',
];
/* 另：check-inline-syntax.js 不是「断言套件」而是**前置闸**（见下面的 PREFLIGHT）：
 *     只吐文件数、不吐断言数，混进 SUITES 会把条数汇总口径搅浑。它不在 test-* 命名下，
 *     所以不参与上面的覆盖性断言。 */

/**
 * 覆盖性守卫：tools/ 下每个 `test-*.js` 必须**恰好**登记在四张表之一。
 * 返回错误清单（空 = 通过）。见上面那段「起因」。
 */
function checkCoverage() {
  const errs = [];
  const dir = path.join(ROOT, 'tools');
  const all = fs.readdirSync(dir).filter((f) => /^test-.*\.js$/.test(f)).sort();
  const tables = { SUITES, BROWSER, COUNTERPROOF, SHIM };
  const where = new Map();
  for (const [name, list] of Object.entries(tables)) {
    for (const f of list) {
      if (where.has(f)) { errs.push(`${f} 同时登记在 ${where.get(f)} 与 ${name}`); continue; }
      where.set(f, name);
      if (!all.includes(f)) { errs.push(`${name} 里的 ${f} 在 tools/ 下不存在 —— 清单陈旧，删掉它`); continue; }
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      if (name === 'BROWSER' && !/require\(\s*['"]\.\/browser['"]\s*\)/.test(src)) {
        errs.push(`BROWSER 里的 ${f} 没有 require('./browser') —— 它不像浏览器套件，是不是放错表了？`);
      }
      if (name === 'COUNTERPROOF' && !/counterproof/.test(f)) {
        errs.push(`COUNTERPROOF 里的 ${f} 文件名不含 counterproof —— 命名不一致，下次会看漏`);
      }
      if (name === 'SHIM' && !/require\(\s*['"]\.\/test-/.test(src)) {
        errs.push(`SHIM 里的 ${f} 没有 require('./test-…') —— 它不是壳，是不是放错表了？`);
      }
    }
  }
  for (const f of all) {
    if (!where.has(f)) errs.push(`${f} 未登记 —— 它永远不会被任何防线跑到（请决定放进 SUITES 还是 BROWSER）`);
  }
  return { errs, all: all.length, counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])) };
}

/* 前置闸 —— 在跑任何断言**之前**执行。
 * ★ 为什么必须有：`public/*.html` 的内联脚本是 3400~4700 行的单块 JS，
 *   一旦语法坏了（注释里出现提前闭合序列、模板串里塞了反引号），
 *   后面所有套件都会以「找不到标记 / 断言失败」的形式集体翻红 —— 看着像几十处功能坏了，
 *   实际只有一处手误。先过语法闸，报错才能**精确到行列**。
 * 判据：退出码非零 ⇒ 直接计入 crashed，最终 process.exit(1)。
 *
 * ② check-card-rules.js —— 卡片族 CSS「全量枚举」闸（2026-09-18 v10.30 新增）。
 *   ★ 与断言套件的分工：套件只能守住**它已知的选择器**；有人新加一条断点（如
 *     `.skeleton .sk-th{width:112px;height:66px}`），套件照样绿，样式却已漂。
 *   本闸反过来——先枚举 2 页实际规则体，再判「图片槽有没有定高」「卡片容器圆角有没有走变量」，
 *   所以它能抓到「测试还不知道的那条断点」。本轮实测就是靠它揪出 3 个未知选择器
 *   （.sm-row .go2 / .emu-card .cfg-btn / .rel-row .rel-it .why）。
 *   ⚠️ 它维护两张**显式例外表**（.emu-card .cov 顶部横幅 92px 等），并**自检陈旧**：
 *     表里登记、代码里已不存在的选择器也会报错，避免「例外表」退化成「静默跳过」。 */
const PREFLIGHT = [
  /* ★ v10.46：**故意不传 args**。
   *   原来传了 `['public/index.html','public/emulator.html','public/unpack.html']` ——
   *   三个页面的硬编码清单，在 v10.44 新增第 4 张派生页 `public/resources.html` 之后
   *   **没人同步**，于是这条闸在包里只查 3 页、**静默漏掉 resources 页**
   *   （工具自己的默认清单反而是 4 页，还专门写了 v10.44 的注释）。
   *   ⇒ 不传参数、用工具自带的清单，新增页面只需改一处。
   *   教训同铁律 34「新增派生页 ⇒ 三处清单同时加」，这里是第四处。 */
  { name: 'check-inline-syntax.js', args: [] },
  { name: 'check-card-rules.js', args: [] },
  /* ★ v10.46 新增：子进程 stdin 沙箱守卫。
   *   起因：沙箱里 node 起子进程时 stdin 若是 pipe（**node 默认值**）⇒ EBUSY。
   *   后果是**防线自己说谎**：反证把"起不来"当"没变红"，报成"护栏是假绿"。
   *   静态检查、秒级；本环境实测一次揪出 29 处（含 24 个反证脚本、日报、server.js）。 */
  { name: 'check-stdio-guard.js', args: [] },
];

let pass = 0, fail = 0;
const crashed = [];
const missing = [];
const noExit = [];
/* 收尾格式不合约定（成绩只能从明细里猜）的套件 —— 2026-10-09 新增，见下面的取成绩段落 */
const warnFmt = [];

/**
 * 套件是否**把退出码挂在失败数上**。
 *
 * ★★ 为什么必须先查这个（v10.22 实测踩到）：本脚本靠**解析输出**里的 `n / m` 统计成绩，
 *   所以即使某套件永远 exit 0，全量汇总**仍然是对的** —— 但这是「险过」：
 *     · 单独跑 `node tools/test-xxx.js`（`WORKFLOW.md` 步骤 8 就是这么写的）时，
 *       `echo $?` 得到 0 ⇒ **红的被当成绿的**；
 *     · 标准反证判据（打坏护栏 → 退出码非零）**对它完全失效**，
 *       等于这道护栏**验不了**，和没有差不多。
 *   实测当时有 2 套中招：`test-report.js` 与 `test-alias-guard.js`（都已补）。
 *
 * 只认两种写法的「挂在失败数上」：
 *   · `process.exit(fail ? 1 : 0)` / `process.exit(fail.length ? 1 : 0)`
 *   · `if (fail) process.exitCode = 1`
 * ★ 故意**不认** catch 里的 `process.exit(1)` —— 那只覆盖「脚本崩了」，
 *   不覆盖「断言失败了」，正是本函数要区分的东西。
 */
function exitTiedToFailures(src) {
  const NAMES = /^(fail|fails|failures|failed|bad|errs|nFail)$/;
  const m1 = [...src.matchAll(/process\.exit\s*\(\s*([A-Za-z_$][\w$]*)(?:\.length)?\s*\?/g)];
  if (m1.some((m) => NAMES.test(m[1]))) return true;
  if (/process\.exitCode\s*=\s*1/.test(src) && /\bif\s*\(\s*(fail|fails|failures|failed|bad|errs|nFail)\b/.test(src)) return true;
  return false;
}

/* ---------- 覆盖性守卫（★ v10.51）----------
 * 放在**最前面**：它是「防线自身完不完整」的检查，比任何断言都先决 ——
 * 一个没登记的套件跑都不会跑，断言写得再对也没用。
 * 不通过就进 crashed，让汇总变红 + exit 1。 */
{
  const cov = checkCoverage();
  const c = cov.counts;
  if (!QUIET) {
    console.log(`\n[覆盖性守卫] tools/test-*.js 共 ${cov.all} 个 ｜ 已登记：`
      + `SUITES ${c.SUITES} · BROWSER ${c.BROWSER} · COUNTERPROOF ${c.COUNTERPROOF} · SHIM ${c.SHIM}`);
  }
  if (cov.errs.length) {
    console.log('\n❌ 覆盖性守卫未通过：');
    cov.errs.forEach((e) => console.log('   · ' + e));
    crashed.push('覆盖性守卫（有套件未登记）');
  } else if (!QUIET) {
    console.log('  ✅ 每个 test-*.js 都已登记 —— 不存在「红了没人知道」的孤儿套件');
  }
  /* `--guard-only`：拿到结论即退出（反证用；也让本守卫能单独当 CI 门禁用） */
  if (GUARD_ONLY) {
    console.log(cov.errs.length ? '\n❌ 覆盖性守卫：不通过' : '\n✅ 覆盖性守卫：通过');
    process.exit(cov.errs.length ? 1 : 0);
  }
}

/* ---------- 前置闸 ---------- */
let preOk = 0;
for (const pf of PREFLIGHT) {
  const file = path.join(ROOT, 'tools', pf.name);
  if (!fs.existsSync(file)) { missing.push(pf.name); continue; }
  let out = '', code = 0;
  try {
    out = execFileSync(process.execPath, [file, ...(pf.args || [])], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000,
    });
  } catch (e) {
    code = e.status == null ? -1 : e.status;
    out = String(e.stdout || '') + String(e.stderr || '');
  }
  if (code !== 0) crashed.push(`${pf.name} (前置闸 exit ${code})`);
  else preOk++;
  if (!QUIET) {
    console.log(`\n${'='.repeat(68)}\n  [前置闸] ${pf.name}  exit=${code}\n${'='.repeat(68)}`);
    console.log(out.trim());
  } else {
    console.log(`  ${code === 0 ? '✅' : '❌'} [前置闸] ${pf.name}  exit=${code}`);
  }
}

/* 本轮实跑清单：静态层恒跑；`--browser` 时把第二层接在后面（同一套记账/汇总）。
 * ⚠️ 浏览器层超时给大一些（实测最慢 35s，留 5 倍余量 —— CDP 首次连接偶发慢）。 */
const TO_RUN = WITH_BROWSER ? [...SUITES, ...BROWSER] : SUITES;
for (const s of TO_RUN) {
  const isBrowser = BROWSER.includes(s);
  const file = path.join(ROOT, 'tools', s);
  if (!fs.existsSync(file)) { missing.push(s); continue; }

  if (!exitTiedToFailures(fs.readFileSync(file, 'utf8'))) noExit.push(s);

  let out = '', code = 0;
  try {
    out = execFileSync(process.execPath, [file], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      timeout: isBrowser ? 300000 : 180000,
    });
  } catch (e) {
    code = e.status == null ? -1 : e.status;
    out = String(e.stdout || '') + String(e.stderr || '');
  }

  /* 取该套件的成绩。
   *
   * ★★ 2026-10-09 收口（原实现：无脑取「最后一个 `n / m`」）：
   *   实测 `test-related-dl.js` 被记成 **8/8**，而它自己打印的是 **42** —— 少算 34 条。
   *   根因：它的收尾写成 `✅  42 通过 / 0 失败`，**数字中间夹着「通过」**，
   *   `\d+\s*\/\s*\d+` 匹配不上；于是 regex 取到了上面 PASS 明细里的
   *   「多标签游戏…共享至少一个标签 —— **8/8**」⇒ 整套成绩被一个**明细串**顶掉。
   *
   *   为什么这个 bug 比「某条断言写错」更危险：**它让防线自己报假数**。
   *   汇总少算 34 条不会让任何一条断言变红，只会让「通过 N 条」这个数字长期偏低，
   *   而所有人拿它当防线规模的唯一口径。v10.44 日志里那处「未能定位的 ±3」同源
   *   （明细里换了输出，取到的数字就跟着换）。
   *
   *   两条一起改：
   *     ① 优先认**收尾汇总行**（同行含「通过 / 失败 / pass / fail」且带 `n / m`）——
   *        从**整份输出**倒着找，不设「末 N 行」窗口：实测 `test-alias-guard.js` 的汇总
   *        `结果：7 / 7 通过` 后面还跟着一长串样例映射，窗口一卡就找不到它了；
   *     ② 认不出汇总行时，**把「该套件收尾格式不合约定」记进 warnings** ——
   *        不静默降级，否则这个坑下次换个套件还会原样复现。
   */
  const lines = out.split(/\r?\n/).filter((l) => l.trim());
  const SUMMARY = /(\d+)\s*\/\s*(\d+)/;
  let picked = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (SUMMARY.test(lines[i]) && /通过|失败|pass|fail/i.test(lines[i])) { picked = lines[i].match(SUMMARY); break; }
  }
  let p = null, t = null;
  if (picked) { p = Number(picked[1]); t = Number(picked[2]); }
  else {
    /* 退回老行为（兼容还没改成约定格式的套件），但**记一笔** */
    const mAll = out.match(/^.*(\d+)\s*\/\s*(\d+).*$/gm) || [];
    if (mAll.length) {
      const last = mAll[mAll.length - 1].match(SUMMARY);
      p = Number(last[1]); t = Number(last[2]);
      warnFmt.push(`${s}（收尾 12 行内没有「… 通过 …」形态的汇总行，成绩取自：${mAll[mAll.length - 1].trim().slice(0, 60)}）`);
    }
  }
  if (p != null) { pass += p; fail += (t - p); }
  if (code !== 0) crashed.push(`${s} (exit ${code})`);

  if (!QUIET) {
    console.log(`\n${'='.repeat(68)}\n  ${s}  exit=${code}  ${p != null ? p + '/' + t : 'n/a'}\n${'='.repeat(68)}`);
    console.log(out.trim());
  } else {
    console.log(`  ${p != null && p === t && code === 0 ? '✅' : '❌'} ${s}  ${p != null ? p + '/' + t : 'n/a'}  exit=${code}`);
  }
}

console.log(`\n${'#'.repeat(52)}`);
console.log(`静态防线：${SUITES.length} 套${WITH_BROWSER ? '' : '（本次已跑）'}`);
if (WITH_BROWSER) console.log(`浏览器实拍：${BROWSER.length} 套（--browser，本次已跑）`);
else console.log(`浏览器实拍：${BROWSER.length} 套（本次**未跑** —— 要跑加 --browser）`);
console.log(`前置闸：${preOk} / ${PREFLIGHT.length} 通过`);
console.log(`通过 ${pass} / 失败 ${fail}`);
if (missing.length) console.log(`⚠️ 清单里的文件不存在：${missing.join(', ')}`);
if (noExit.length) {
  console.log(`⚠️ 退出码不随失败变（单独跑时红绿不分，且反证验不了）：${noExit.join(', ')}`);
  console.log('   ⇒ 在该套件末尾补 `process.exit(fail ? 1 : 0)`');
}
console.log(`异常退出：${crashed.length ? crashed.join(', ') : '无'}`);
if (warnFmt.length) {
  console.log(`⚠️ 收尾格式不合约定（成绩是从明细里取的最后一行，可能不是真成绩）：`);
  warnFmt.forEach((w) => console.log(`   · ${w}`));
  console.log('   ⇒ 把该套件末尾改成「通过 n/m」或「n / m 通过」（同行含「通过」）');
}
console.log(`${'#'.repeat(52)}`);

if (fail || crashed.length || missing.length || noExit.length || warnFmt.length) {
  console.log(`\n⚠️ ${WITH_BROWSER ? '两层防线' : '静态防线'}未全绿 —— 先修这里，别急着跑线上验收。`);
  process.exit(1);
}
console.log(WITH_BROWSER
  ? '\n✅ 两层防线全绿。接下来：线上验收。'
  : `\n✅ 静态防线全绿。接下来：浏览器实拍（node tools/run-all.js --browser）→ 线上验收。`);

