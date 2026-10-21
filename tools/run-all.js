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

/* ★ 2026-10-20：取分函数 `pickScore` 的自检。
 *   理由：这个「分数被明细行顶掉」的坑**已经复发两次**（v10.44 一次、v10.90 一次，
 *   第二次的表现是「合计失败数 -985」）。改它就等于改所有防线的成绩口径，
 *   所以给它一组**真实收尾样本**，改完当场能验，不必等 3 分钟全量跑。
 *   用法：`node tools/run-all.js --selftest-parse` */
if (process.argv.includes('--selftest-parse')) {
  const CASES = [
    /* 第 2 次真凶：明细行里的 6334 / 5335 被当成成绩 */
    ['PASS  存档角标与列表同口径（6334 / 5335）\n====\n结果：73 通过 / 0 失败', 73, 73],
    /* 第 1 次真凶：`42 通过 / 0 失败` 认不出，取到明细 8/8 */
    ['PASS  多标签游戏共享至少一个标签 8/8\n✅  42 通过 / 0 失败', 42, 42],
    ['前置闸：3 / 3 通过\n====\n通过 310/310（失败 0）', 310, 310],
    ['结果：125 / 126 通过', 125, 126],
    /* 汇总行不在末尾（test-alias-guard 的真实形态） */
    ['结果：7 / 7 通过\n样例映射 → 3 / 4\n又一行 9 / 10', 7, 7],
    ['passed 17 / 17', 17, 17],
    /* 有真失败时总数必须 = 通过 + 失败 */
    ['结果: 80 通过 / 3 失败', 80, 83],
    /* 什么都不像 ⇒ 认得出来「认不出」 */
    ['hello world\nno numbers here', null, null],
  ];
  let bad = 0;
  for (const [out, ep, et] of CASES) {
    const r = pickScore(out);
    const ok = r.p === ep && r.t === et;
    if (!ok) bad++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${JSON.stringify(out.split('\n').pop())} ⇒ ${r.p}/${r.t}` +
      (ok ? '' : `  （期望 ${ep}/${et}）`));
  }
  console.log(`\n取分自检：${CASES.length - bad} / ${CASES.length} 通过`);
  process.exit(bad ? 1 : 0);
}

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
  /* ★ v10.97 新增：后台「查看」弹窗的渲染层（rmv* 家族）。
   * 起因：弹窗从「<pre> 一堵墙」改成「小节 / 步骤 / 段落」三段式，
   *       里面有三个**不报错的错**（URL 二次转义、`String(对象)` → [object Object]、
   *       短行误判成小节标题）。这些全是纯函数，jsdom 直调最稳，不进浏览器探针。
   * 同 test-resource-page.js，它也要 8123 在跑（只用来取 admin.html 源码）。 */
  'test-admin-modal.js',
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
  /* ★ v10.56：GT 时间戳 + 源巡检判据 + 线上验收断言（**全离线** —— 联网探测不进静态防线） */
  'test-v1056.js',
  /* ★ v10.57：术语统一「云存档」→「存档」的负向守护（**剥离注释**后断言用户可见文案零残留）。
     附带的 `test-shared-destructure.js` 修了一处正则盲区：`require('…x.js')` 读不出解构 ⇒ 假红。 */
  'test-v1057.js',
  /* ★ v10.58：① FR（FearlessRevolution）遗弃的**负向守护**（文件实体 + 接线 + 四页文案 +
     「先落 SOP 再删」的证据链）② 首页「库范围」三视图（pc / mob / all）。
     ★ 这一套的重点是**钉住"三视图不许两个按钮一个效果"** —— 本轮实测发现按旧口径
       做出来的「合并」会**恰好等于端游视图**（手游侧挂 libId 的 1,685 款全部已在端游库里，
       0 例外），所以断言必须比"按钮画出来了"更强。
     配套反证：`_counterproof-v1058-fr.js`（13 条）/ `_counterproof-v1058-scope.js`（12 条）。 */
  'test-v1058.js',
  /* ★ v10.60：「同款归并键只有一份实现」—— 用户报的现场是搜索联想里
     「古惑狼™ 4：时机已到」（机地）与「古惑狼4：时机已到」（XDGAME）各占一行。
     根因是前端 `smKeyOf()` **自写了第四份归一化**（只去空白、不剥符号），
     而真源 v10.36 就把 `™®©` 收进了 `SYMBOLS`。
     ★★ 本套件最要紧的是 A4/B4：归并键用**窄类** `GROUP_DECOR`，
        **不能**复用匹配用的宽类 —— 实测宽类会新并 20 组、其中 2 组是**假并**
        （续作被并进前作）⇒ 钉「保留实义分隔符」+「宽类是窄类的超集」。
     配套反证：`_counterproof-v1060-nkey.js`（11 条坏法 + 基线 + 复绿）。 */
  'test-v1060.js',

  /* ── v10.61：**两级归并键**（名称键 ∪ AppID+闸门）
     【修的是什么】用户 2026-10-12 截图（v10.60 修完古惑狼的**当晚**）：搜「三国无双」出两行，
       机地 `真・三国无双 起源` 与 XD `真三国无双：起源` —— 硬证据是两条 **Steam AppID 都是 2384580**。
       全库：同 AppID 跨源双条 154 组，名称键只兜住 103 组 ⇒ 本版新增合并 86 组（跨源 32 / 同源 54）。
     ★ 最要紧的两条是 B2 与 D1/D2：
       · B2 = **不许回归** —— 「一边有 AppID、一边没有」的那组（古惑狼）必须仍并上；
         键若改成单条算的「AppID 优先」它会**被拆回去**，所以必须批量 + 并查集。
       · D1/D2 = **零回归 + 零假并** 的结构性断言（并查集只 union 不 split ⇒ D1 必然成立；
         D2 保证没有第三条 union 路径把不相干条目拉进来）。
     ★ 写法上刻意**不依赖会变的数据**：B/C 段用构造样本；D 段结构性；D5/D6 只用下界。
     配套反证：`_counterproof-v1061-appid.js`。 */
  'test-v1061.js',
  /* ── v10.62：**一款一行** + 联想面板带回资源
     【修的是什么】用户 2026-10-12 17:2x 的两条诉求（紧接 v10.61 交付之后）：
       ① 「每个游戏仅需要提供一个即可」—— v10.61 已并成一行，但下面还挂着
          「↳ 另 1 个条目 [XDGAME 原版 ★9.1 ↗]」；本次把那排 chip 彻底删掉（含 CSS 与绑定）。
       ② 「我要的 mod/修改器/存档也没提供给我」—— 联想面板（`/api/library`）此前只走 `withBh`，
          **一个资源计数都不挂**，而同一个 `smRow()` 在搜索结果面板里是有 chip 的。
     ★ 顺手修掉一个真 bug：`withBh(g)` 在两库都没命中时 `return g`（**原引用**），
       原 `withRes` 直接 `o.res = …` ⇒ **原地写 gamesDb 内存里的记录**。
       后果是「联想带不带 `res` 取决于此前有没有人请求过 `/api/search/all`」这种**顺序依赖**，
       且污染不可逆、会漏进 browse / recent / 首页卡片。⇒ 改为落在副本上。
     ★ 写法上仍是**不依赖会变的数据**：全部是「对源码 / 派生页的结构断言」，
       不查 `games.json`、不写死条数。D 段顺带守住「派生页已重建」（铁律 1）。
     配套反证：`_counterproof-v1062.js`；实拍探针：`_probe-v1062-live.js`。 */
  'test-v1062.js',
  /* ★ 2026-10-13 新增：roster「完整体检表」（`gen-roster.js` → `docs/reports/gamehub-roster-*.html`）。
   *   用户口径：完整手游/端游名单 + 是否有本体/修改器/MOD/存档 + 点开弹窗看链接 + 按更新时间/热度排序。
   *   v10.65 追加两条：**表头吸附**（字段名滚动时可见）+ **筛选多选**（平台并集 / 资源 AND-OR 显式可选）。
   *   守五类**静默事故**（详见套件内注释）：
   *     B 行数恒等式（端游 + 手游独有 = 总数；漏并/重并都会变红）
   *     C/D 投影列与 meta 一致（少给一列 ⇒ 页面整列空着而不报错）
   *     E 内联 JSON 可解析（未转义的 `</script>` 会把数据截断）
   *     F 页面钩子（排序/筛选/弹窗的 DOM 契约被改名 ⇒ 页面静默失灵）
   *     H 表头吸附 + 多选（★ H1 守「祖先不能是滚动容器」—— `.card` 用 overflow:hidden
   *       会让 thead 的 sticky 永不触发，实测 th.top 58 → -1180）
   *     G 生成脚本自身两个坑：`_` 前缀（永不入库）+ 模板串里写裸反引号（语法错误）
   *   ★★ F6 是本轮实测踩出来的：机地与 XDGAME 的 `/api/download` items
   *     **字段不同名、且 `real` 同名不同义**（机地=URL 字符串，XD = 布尔）——
   *     只认 `url` 会「明明有数据却显示没有通道」。 */
  'test-roster.js',
  /* ★ 2026-10-13 新增（v10.66）：主站 URL 直达 `?open=` 与 roster 弹窗入口的**跨文件契约**。
   *   用户口径：「优化弹窗显示效果，可以每个最多显示5条，最好增加一个跳转到该项目详情页
   *   以及弹窗的功能」—— roster 弹窗里那两个按钮要真能跳到**那一款**，就需要站点侧支持
   *   `?open=<本地库 id>`（详情抽屉）与 `?open=<id>&dl=<页签>`（资源弹窗）。
   *   守五类**静默事故**（详见套件内注释 A~F）：
   *     A 主站没这个分支 ⇒ 按钮点开只是首页，用户以为站点坏了
   *     B 只改了主源、派生页没重建 ⇒ 从 /emulator.html 等页跳过去掉参数（单源派生的老坑）
   *     C gotoResTab 里「先 openDetailById 再 openUniDownload」顺序颠倒 ⇒ 弹窗拿到**上一款**的 id
   *     D roster 拼的 `&dl=modifier` 与站点页签键漂移 ⇒ 静默兜底到 body（用户以为 Mod 页签没了）
   *     E boot 段绕过 gotoResTab 直调弹窗 ⇒ 少详情上下文
   *   ★ F 段是**元断言**：删掉 op 那一行后 A1 必须失配，证明判的是目标处而非别处巧合。
   *   行为验收（浏览器实拍，需 8123）见 `tools/_probe-v1066-open.js`。 */
  'test-v1066.js',
  /* ★ v10.70 新增：**排序口径的唯一来源**（6 维）+ `sizeAsc` 的「无效容量排最后」语义。
   * 起因：排行榜要学 xdgame.com/update/ 的排序体系，排序从 **3 维扩到 6 维**
   *   （updated / hot / score / size / sizeAsc / title）。扩维度不难，出事的是**口径分裂**：
   *     · server.js 历史上另写了一份本地 `keyOf` —— `scope=pc` 走 `browse()`，
   *       而 `scope=mob|all` 走**内存排序**（`mobPool.sort` + `mergePick`）。
   *       两份漂移时同一个 `sort` 在两个 scope 排出不同顺序，且**不报错、测试也照绿**。
   *     · 白名单也写死两处（`['score','size']`），漏改一处 = 前端发了 hot、服务端静默回落。
   * ★★ 本套件刻意做**真实库行为断言**（require data/gamesDb.js 后直接排序校验单调性），
   *   而不是文本匹配 —— 因为「口径一致」是**行为承诺**，不是「代码里有没有这行字」。
   * ★★ `sizeAsc` 必须**全量扫描**：全库 19,531 条里有效 19,051 / 无效 480。
   *   只取前 300 条时「无效排最后」根本**没有样本**（vacuous truth），
   *   报绿也不代表机制在 —— 这是本套件第一版的真实缺陷，已改成全量。 */
  'test-v1070-sort-keys.js',
  /* ★★ v10.71 新增（三条）：「解压助手」—— 压缩包套压缩包自动递归 + 加密包可续跑。
   * 起因：用户原话「**目前下载直链的压缩包会有一个问题，压缩包中含有压缩包，有没有办法
   *   直接自动解压并且检测到如果还是有压缩包则直接再次解压或增加提醒+再次解压功能**」。
   *   实测确认这不是个例：data/saves-youxia.json 的 files.direct 有 1,987 条真直链
   *   （rar 1443 / zip 499 / 7z 45），4/4 抽测全是压缩包；游侠那条 .rar 里就是一个 .rar。
   *
   * ★ 三条分工（不是重复覆盖，是三层不同的证据）：
   *   ① test-v1071-extractor.js      —— 判定口径层：7z 退出码语义 / 分卷 / 密码闸门 /
   *                                     失败回滚 / 魔数识别。★ 它原先叫 `_verify-extractor.js`，
   *                                     是个**手工探针**：当时它抓到了 sniff 全线静默失效
   *                                     （hex 长度当字节长度用），却不会被任何人定时跑到。
   *                                     本版把它提升进防线 —— 「抓到过 bug 的探针」最该常驻。
   *   ② test-v1071-extract-e2e.js    —— 端到端层：★ 自己起临时实例（8899），不碰常驻 8123
   *                                     （本项目铁律：常驻 8123 会落后于代码，拿它测会得出错误结论）。
   *                                     真实直链下载 → 两层递归 → 落盘校验 + 目录护栏 + 404 兜底。
   *   ③ test-v1071-extract.js        —— 接缝层：主源↔派生页五入口、7 条路由、
   *                                     ★★ 语法闸门的存在性与**反证**、启动器结构、CLI 契约、
   *                                     报告渲染器（纯函数）。纯离线、约 1 s。
   * ★ 为什么③里专门守「启动器结构」：本沙箱 **cmd.exe 跑不了**（Bash 与 PowerShell
   *   两条路都被安全策略拦），所以 `解压助手-拖放.cmd` 我**没有实跑过**。
   *   那些断言就是「它至少结构上是对的」的凭据 —— 文档里也必须这么写，不许说成已验。 */
  'test-v1071-extractor.js',
  'test-v1071-extract-e2e.js',
  'test-v1071-extract.js',
  /* ★ v10.72 新增：把 v10.71 那条解压链路接进**下载按钮**（点按钮就自动解压）。
   *   守三块：① sniffBuffer 是魔数判定的单一真源（sniff 与网络流两条路必须同判据）
   *          ② downloadTo 的**头部早期判定** —— 不是压缩包就止损且**一个字节都不落盘**，
   *             其中 E8b 用「服务器是否观察到客户端提前断开」证明是止损而非「下完再说」
   *          ③ 接缝：真直链才挂按钮 / 非本机不渲染 / 浮层由 JS 现创建 / open 有护栏
   *   ★ 下载层一律打**本地 HTTP 服务器**造的响应，不碰源站 ——
   *     源站可用性会变（实测存档直链 30 条里已有 2 条 404），把防线绑在别人家
   *     的可用性上，红了分不清「我们坏了」还是「人家抽风」。纯离线、约 1 s。 */
  'test-v1072-download.js',
  /* ★ v10.73 新增：三个新东西 ——
   *   ① 文件夹命名 `游戏名_类别_原链名`（`taskFolderName`，去扩展名、段为空省略、限长）；
   *   ② ★★ **新引入的攻击面**：这个名字掺了**外部数据**（源站标题 + URL），
   *      不清洗就能用 `..\..\Windows` 爬出落点目录 ⇒ 14 个恶意样本必须**全部被接受**
   *      且都在根内（`rejected === 0` —— 靠 taskDir 兜底拒绝**不算过**，
   *      这条判据是反证 ② 照出来的：首版只判「没爬出去」，于是清洗被放宽也照样绿）；
   *   ③ 解压助手**历史留档**：落盘 `Downloads\GameHub\_下载历史.json`、按 id 覆盖、
   *      `exHistoryPush` 放在 `exRun` 的 `finally`（保证没有出口能绕过）。
   *   ★ 纯函数 + 静态结构，不起进程、不碰源站，毫秒级。 */
  'test-v1073-download.js',
  /* ★ v10.74 新增：首页榜单改「前 5 轮播 + #6-13 走 4 列 × 2 行卡片」（用户拍板，共 13 个）。
   * 三件事必须一起守，缺一条就会静默退化：
   *   ① **源站给不满 13 个**：XD 官网每档 `.plate-list` 实测只有 10 个 `<li>`
   *      （全站榜剔掉「运行库检测工具」后只剩 9 个），机地热榜上限也是 12
   *      ⇒ 尾部必须由**本地库热度**补位，且补位条目要**可区分**
   *      （虚线边框 + 副行「📚 库内 x」——因为补位池 hot 高达 34.8 万，
   *        而真榜条目 week 档只有 0/10，照常显示热度会比第 1 名还显眼）。
   *   ② `cleanPlate` 里那个写死的 `slice(0, 10)` 要拿掉（它从来没生效过，
   *      却是与「首页展示数」**各自写死的第二个数**，改一个忘一个就静默砍数据）。
   *   ③ 轮播的**定时器纪律**：切档会整体重渲 `#rankList`，任何重渲之前必须先
   *      `rkCarStop()`，否则旧 interval 继续推已销毁的 DOM（用户感知「点一下跳两格」）。
   * ★ 本套件是**静态层**：只读文件 + 跑纯函数（A 段用造假数据，不打源站），
   *   真实交互由 `test-v1074-carousel-live.js`（BROWSER 层）守。 */
  'test-v1074-rank-carousel.js',
  /* ★★ v10.75 新增：榜单**换源**（XD 官网 `/update/` 八档，每档实测 100 条 SSR）
   *   + **双源加权融合**（用户拍板：最近更新 = 仅 XD；其余三档 = XD 50% + 机地 50%）
   *   + **封面优选**（本轮实拍撞出来的真问题）。
   *   ① 两源规模悬殊（XD 100 / 机地 12）⇒ 必须做**名次相对位置对齐**，
   *      否则机地 12 条会整片压过 XD 前 45 名（名义 50/50、实际被主导）。
   *   ② 12`×`12`/140`×`140 的方图放进 2.14:1 展示位 = 用户说的「压缩游戏图片」
   *      ⇒ 加 `coverScore` 分级 + 同名提优，并如实回带 `coverBigN / coverSubN`。
   *   ③ 实测 11 条里 4 条封面不达标（2 条方图 + 2 条 Steam header 404）⇒ 修后 hot 档 11/11 达标。
   * ★ 本套件是**纯离线层**（造假数据 + 假文本，不打源站、不碰端口）；
   *   真渲染与真图片由 `test-v1075-rank-cards.js`（BROWSER 层）守。 */
  'test-v1075-rank-source.js',
  /* ★ v10.81 新增：直链改造防线（静态离线）——
   *   ① res/game ?t= 修复（gamesDb.search() 返回对象，老 [0] 写法恒空）
   *   ② FLiNG 修改器直链：产物形状 / 流代理 + SSRF 白名单 / trainers match 挂 dl
   *   ③ Thunderstore MOD 直链：产物形状 / /api/ts/mods / 禁用 v1 全量端点（门 1 铁律）
   *   ④ 前端接线：第四路 ts / 角标计数 / TS 段位置 / GCM 分治文案 / 空态守卫 */
  'test-v1081-dl.js',
  /* ★ v10.83 新增：MOD 直链扩量防线（静态离线）——
   *   ① TS 扩量：thunderstore.json 包数 ≥ 旧基线 2,870（--per 24→50 重抓不许缩水）
   *   ② Modrinth **不接线**（防回归）：实测 0 产出（纯 MC 生态），server/前端不许留 MX 痕迹
   *   ③ 前端四路不动：TS 段渲染 / 角标计数 / 空态守卫保持 v10.81 形态 */
  'test-v1083-mods.js',
  /* ★ v10.84 冷门隐藏：口径自证（独立重算=模块 stats）/ 池前挂接 / 只有列表层开 / 豁免通道 */
  'test-cold-hide.js',
  /* ★ v10.86 FitGirl 接入：落库夹逼 / adult 独立重算 / SSRF 白名单 / 外链+复制磁力接线 */
  'test-v1086-fitgirl.js',
  /* ★ v10.87 管理后台：鉴权双轨 / 令牌真源 / 操作日志 / 聚合端点七路 / admin=1 回填 */
  'test-v1087-admin.js',
  /* ★ v10.88 FitGirl 下载源解析（三形态内联 fixture）+ 真后台骨架 + 备注端��契约 */
  'test-v1088-admin.js',
  'test-v1089-admin-domains.js',
  /* ★ v10.90：后台重排（页面管理 / 游戏库资料 / 四模块 / 资源覆盖分类 / 令牌体验）。
   *   需要 8124 实例在跑（C 段走 HTTP 实测）；没有实例时 C 段会红，这是正确的红。 */
  'test-v1090-admin-console.js',
  'test-v1089-fg-parts-ui.js',
  /* ★ v10.91：管理员账号（用户名 + 密码）替代「人记令牌」。
   *   D 段自起子进程（env 测试凭据，不碰真实账号文件），所以**不需要** 8124 在跑。 */
  'test-v1091-admin-login.js',
  /* ★ v10.93：云下载引擎（磁力 → 服务端下载 → 保存到电脑）。
   *   纯判据 + 源码护栏 + 前端渲染，**不跑真下载**（BT 受 seeder 影响，进防线会变成
   *   「今天红明天绿」的抖动源）；真链路由 v10.93.md 的实测记录背书。 */
  'test-v1093-downloads.js',
  /* ★ v10.94：四项体验修复 —— 同款折叠 / 模块查看弹窗 / 名单去重 + 自动抓取 / 云下载 zip。
   *   A 段穷举「会不会把两款不同游戏并掉」（合并错了只表现为少一款游戏，不报错）；
   *   B 段在字节层验 ZIP 结构（签名 / UTF-8 flag / ZIP64），靠「能下下来」测不出来。 */
  'test-v1094-ux-fixes.js',
  /* ★ v10.95：机地本体链接「为什么只显示 XD」。
   *   A 段真调 data/dl-cache-ttl.js（不是抄一份逻辑比字符串）——尤其 A6 那条
   *   「帖在但没写网盘」的正常空结果必须照旧缓存 30 分钟，否则修失败会变成每次重打源站；
   *   C/D 段守「失败要留痕、要说『没取到』、重试要带 refresh=1、且不许自动重试」。
   * ★★ 注意（v10.96 实测）：上一版这里只写了注释、**漏了数组项**，
   *   于是这套 32 条断言从 v10.95 起一条都没被跑到 —— 覆盖性守卫当场报
   *   「test-v1095-jidi-body-links.js 未登记」。写注释 ≠ 登记。 */
  'test-v1095-jidi-body-links.js',
  /* ★★ v10.96 新增：全模块抽样后修的四类问题（用户口径「抽查全模块」）。
   *   A 段 XD 分类页**双布局**（新 pcgame/host/mobile 用 a.tit，旧 dzmx/gj 仍用 a.soft-title）
   *        —— 第一版把选择器整体换成新的，结果细分分类全变 0 条；本段用反向断言钉住「两套都得在」。
   *   B 段 XD 搜索限流要**抛错**，不能返回空数组（否则「被限流」和「真没这款」长得一样）；
   *   C 段 /api/search 的缓存 TTL 必须按结果决定（失败 45 秒 / 成功 5 分钟）；
   *   D 段端游资源第四个分区「本体」（骨架 id、默认页签、按需抓取、盘口映射、本机缓存上限）；
   *   E 段 /favicon.ico 回 204（这条 404 会污染控制台、掩盖真正的 JS 报错）。 */
  'test-v1096-audit-fixes.js',
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
  /* ★ v10.68 新增：首页**首屏几何**（hero 高度 / 行密度 / 首屏可见条数 / 移动端分类行不换行）。
   * 起因：改前第一屏（1440×1000）**一条游戏都没露出来**（列表 top=985），移动端要滚 2.2 屏。
   * 这是**像素事实**，所以按拍板目标值 + 余量立闸，而不是靠截图「看着还行」。 */
  'test-home-fold.js',
  /* ★ v10.69 新增：筛选面板**折叠**（默认收起 1 行 / 点击展开 4 行）。
   * 起因：v10.68 之后首屏「最后一截」的唯一瓶颈就是这个面板（桌面 167px / 移动 232px）。
   * ★★ 它守的重头是「折叠态必须是模块级变量」—— `renderList(true)` 会整块重建 `#colMain`，
   *    而**点任何筛选开关都会调它**，只写 DOM class 的话面板每点一次就自己弹回。 */
  'test-v1069-filter-fold.js',
  /* ★ v10.70 新增：首页**视觉语言统一**（hero 白底化 / 榜首卡去金黄渐变）
   *   + **排序依据显性化**（学 XDGAME 每行写「574,032 热度」「554 GB」）
   *   + **侧栏改向但不丢能力**。
   * 起因：用户原话「**不太行啊，目前首页布局和样式不太行**」并给了三个参考站
   *   （排序学 xdgame.com/update/ 与 jidiyouxi.com/topic/list?sort=week，布局学 byrutgame.org）。
   *   侦察后定位三处结构性错位：① hero 深蓝渐变 + 金黄榜首卡 紧接纯白列表 = 一屏两套视觉语言；
   *   ② 列表一行 74px 塞 9 字段；③ 侧栏只填 19%、下方 2562px 全空且装的是运维信息。
   * ★★ 本套件最该守的一条是 **F5/F6「运维能力收起来但一个没删」** ——
   *   增量更新 / 校准续跑 / 同步机地 是真实可用功能，收进 `<details>` 可以，
   *   删掉就是砍功能；而且**光在 DOM 里不够**（被 `display:none` 挂死仍然等于砍功能），
   *   所以还要点开折叠区验「真的可见可点」。
   * ★ 视觉语言的判据用 `getComputedStyle().backgroundColor` 的一个性质：
   *   `background:linear-gradient(…)` 时它返回 **`rgba(0, 0, 0, 0)`**（透明），
   *   `background:#fff` 时才是 `rgb(255,255,255)` ⇒ 「渐变回来了」**用背景色就能照出来**，
   *   不必去正则搜 CSS 文本（那种写法改个角度就绕过了）。 */
  'test-v1070-home-layout.js',
  /* ★ v10.74 新增：首页榜单轮播的**真交互**（真鼠标点箭头/指示点、真等自动播放）。
   * 与 `test-home-fold.js` 的分工：那个只**量几何**（轮播多高、几列），不点不等。
   * 本版新引入的三类风险只在「交互之后」才显形：
   *   ① ★★ 切档重渲后旧 interval 未停 ⇒ 间隔被挤成 ~2.5s（用户感知「点一下跳两格」）；
   *   ② 箭头落在 `.slide` 之上（z-index 4 > 3）⇒ 少了 `stopPropagation`
   *      点「下一页」会**连带打开详情抽屉**；
   *   ③ 往回绕的取模写成 `i % n` ⇒ 索引 -1 ⇒ 五张全灭（黑屏）。
   * ★ 判「两个定时器并存」不数 interval 个数（数不到），而是**量相邻两次切张的间隔**：
   *   全部 ≥ 4000ms 即证明只有一个推手。两处各 11.5s 是它唯一的慢源。
   *   计时前必须把鼠标移出轮播（有 `mouseenter → rkCarStop` 悬停暂停），
   *   否则间隔被拉长 ⇒ 判据**假绿**。 */
  'test-v1074-carousel-live.js',
  'test-search-ui.js',       /* 搜索弹窗 + 详情抽屉（分组排序 / 行密度 / 三档视口） */
  /* ★ v10.71 新增：解压助手页（/extract.html）实拍 + 真交互。
   *   守的是「用户真能把这事干成」：1440/390 两档下测 扫描 → 递归解压 → 报告渲染，
   *   并断言**三层全部解开**（页面上看得到 L1/L2/L3）、事件流有逐层进展、
   *   叶子文件真落盘（端到端，不是只看界面）。需要 8123 在跑。 */
  'test-v1071-extract-page.js',
  /* ★★ v10.75 新增：榜单卡片的**真实渲染**验收（这是离线层做不到的部分）。
   *   守三件只有浏览器才知道的事：
   *   ① 封面图**真的加载成功**（`naturalWidth > 0`）—— 本轮实测修前有 2 条 Steam header 404；
   *   ② 每张图的**原始宽高比 == 展示框宽高比**（不裁不压 = 用户要的「放大适配游戏大图」）；
   *   ③ 卡片信息行**只有**「分类标签 + 容量」（+ 游戏名 = 拍板三样，「即可」是上界）。
   *   另含「轮播当前张图文一致」——它防的是**取样陷阱**：轮播切换有 0.45s 过渡，
   *   截图/取样撞上过渡期会得到「NO.1 的标题 + NO.2 的底图」这种看着像 bug 的假象。
   *   需要服务在跑（建议 8124 临时实例，见 test-home-fold 头部端口说明）。 */
  'test-v1075-rank-cards.js',
];
/* 反证脚本：**故意打坏**被守护的行为，断言必须变红 ⇒ 它们「失败才是通过」，
 * 永远不能进 SUITES（会把汇总搅成红）。跑法：单跑，看它自己报的「变红条数」。 */
const COUNTERPROOF = [
  'test-v1025-launcher-counterproof.js',
  'test-v1025-search-counterproof.js',
  /* ★ v10.71 新增：解压助手 9 个打坏点（单源派生漏重建 / 404 兜底被顶掉 /
   *   语法闸门被掏空 / 构建器漏接闸门 / .cmd 用 %1 / --pw 解析丢失 /
   *   报告不提示加密包 / 渲染层假设字段齐 / favicon 丢失），
   *   每个坏点各自对应的断言必须变红。跑法：单跑。
   *   ★ 它本身**不进 SUITES** —— 期望是「红」，混进汇总会把条数搅乱（本表存在的理由）。 */
  'test-v1071-extract-counterproof.js',
  /* ★ v10.72 新增：下载并解压的 10 个打坏点
   *   （派生页漏重建 / 浮层写进主源 HTML / [hidden] 兜底被删 / 仅本机判断被放宽 /
   *     按钮脱离真直链前提 / ★★ 提前止损退化成「下完再说」 / expectArchive 失效 /
   *     魔数判据写歪 / ★ sniff 不走单一真源 / open 目录护栏被注释）。
   *   ⚠️ 与 v1071 那条一样，**它本身不进 SUITES**（期望是「红」）。
   *   ⚠️⚠️ 已知现状（本版实测确认，如实记）：run-all **只校验 COUNTERPROOF 表里的
   *     文件都被登记，从不执行它们** —— 所以「反证失败」在全量防线里是**看不见**的。
   *     本版就因此差点漏掉一个真失败（v1071 反证的取汇总正则没跟着 v10.71 的新收尾
   *     格式改，导致「还原后必须全绿」那步的判据整个失效）。反证必须**单跑**。 */
  'test-v1072-download-counterproof.js',
  /* ★ v10.73 新增：12 个打坏点 —— 清洗整体放宽 / 漏抹 `..` / 边界判据丢分隔符 /
   *   ★★ downloadTo 退回「一进门就建目录」（「网页地址也留空目录」那个 bug 的原形）/
   *   留档挪出 finally / 覆盖退化成追加 / 历史不倒序 / snapshot 丢 dir /
   *   收口被删 / ★★ 保留设备名逃逸被删（`{game:con}` 的目录名就是 `con`）/
   *   仅本机判断被放宽 / 派生页漏重建。
   *   ★★ 这一版**真的照出了 4 条假绿 + 1 个真 bug**（见 docs/versions/v10.73.md 第 ⑥ 节）：
   *      ② 的 E1 没要求 `rejected === 0`（清洗放宽 ⇒ taskDir 兜底拒绝 ⇒ 判成通过）；
   *      ⑨ 的 V10 用了裸子串 `dir: t.dir || t.params.dir` —— 历史记录里也有一份，
   *        删掉 exSnapshot 那行仍能匹配（假绿），改成精确到 `|| null,` 那一支；
   *      ⑩ 的 N3 三个样本被 `.filter(Boolean)` 挡掉了、收口删掉也全绿 ⇒ 补 N3b/N3c；
   *      ⑪ ★★ `sanitizeSeg('con')` 返回 `_con`，但 `taskFolderName` 的收口把前缀 `_`
   *        又抹掉 ⇒ `{game:'con'}` 得到的目录名就是 `con`（Windows 建不出来，真 bug，
   *        已修 + 补 N4b 守卫）。**没有反证，这四条会一直以绿色存在。**
   *   ⚠️ 与前面几条一样，**它本身不进 SUITES**（期望是「红」）。
   *   ⚠️⚠️ **绝不许与别的反证套件并发跑**（铁律 113）：它们改的正是被断言的源文件，
   *      两个实例同时跑会撞出 `EPERM errno -4048`，症状看着像「权限/锁/代码 bug」。 */
  'test-v1073-download-counterproof.js',
  /* ★ v10.74 新增：首页榜单轮播 + 补位的 13 个打坏点 ——
   *   补位函数瘫痪 / ★★去重只按 url（同款不同 url 占两个位）/ 补位不带 `filled` 标记 /
   *   ★★补位条目照常显示「🔥 34.8 万热度」（比第 1 名还显眼）/ 工具条目不过滤 /
   *   不要求封面 / 不按 hot 降序 / ★服务端漏接补位（import 了没调）/
   *   ★★`cleanPlate` 的写死 10 加回来 /
   *   ★★重渲前不调 `rkCarStop()`（旧定时器推已销毁的 DOM ⇒ 用户感知「点一下跳两格」）/
   *   ★★轮播可见性类从 `.cur` 改回 `.on`（与 `rankMark` 撞车 ⇒ 打开任意详情全部张一起亮）/
   *   卡片列数退回 5 列 / 派生页漏重建。
   *   ★★ 其中「重渲前不 stop」与「可见性类改回 `.on`」两条**只有真交互/真语义才照得出**：
   *      静态套件只看类名与位置，看不出「点一下跳两格」。所以这两条在
   *      `test-v1074-carousel-live.js`（BROWSER 层）里各有一条对应断言，单跑可复核。
   *   ⚠️ 与前面几条一样，**它本身不进 SUITES**（期望是「红」）。
   *   ⚠️⚠️ **绝不许与别的反证套件并发跑**（铁律 113）：它们改的正是被断言的源文件。
   *   ⚠️⚠️ **本轮新增的更宽一条：也不许在浏览器层全量跑的时候跑** —— 本反证会改
   *      `public/index.html`，而 8123 常驻服务是**按请求现读磁盘**的 ⇒ 浏览器套件会
   *      加载到被故意打坏的页面，那一轮全量会凭空多出一堆红（本轮实测撞到过）。
   *      反证是「改仓库的排他操作」：先确认没有别的实测在跑，再动。
   *   ⚠️⚠️ 已知现状（沿用 v10.72 的如实记录）：run-all **只校验 COUNTERPROOF 表里的
   *      文件都被登记，从不执行它们** ⇒ 反证必须**单跑**，别指望全量防线替你跑。 */
  'test-v1074-rank-carousel-counterproof.js',
  /* ★★ v10.75 新增：榜单换源 + 双源融合 + 封面优选的 13 个打坏点。
   *   ★ 本轮反证照出**三处「反证不充分」**，其中两处是**打坏点选歪**（不是断言写歪）：
   *     ①（去掉名次对齐）→ need 该守 A2「榜尾对齐语义」，而不是 A15「前 11 里机地 ≤6」——
   *        排序的 tie-break「XD 名次优先」会把名次交错开，A15 对这条打坏**免疫**；
   *     ⑧（同名提优）→ 必须**两道护栏一起放宽**才能造出危害，单独放宽任一条都会被另一条接住。
   *     ⇒ 「反证不充分」有两种病因：断言写歪（假绿）或打坏点选歪（没打到）。
   *       不查清就改断言，会把有效的守卫改松。
   *   ⚠️ 与前面几条一样，**它本身不进 SUITES**（期望是「红」）。 */
  'test-v1075-rank-source-counterproof.js',
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
/* ★ 2026-10-20：汇总行「两个数字写反」的单独一栏。
   实测全量跑出过 `通过 10719 / 失败 -985` —— **失败数是负数**。
   负数意味着某个套件的 `p`（通过）和 `t`（总数）被交换了，
   而 `fail += (t - p)` 就把负值带进合计。
   危害不是"数字难看"，而是**「失败」这一栏彻底失去信息量**：
   真有 1 条失败时，-985 只会变成 -984，没人看得出变化。
   ⇒ 夹住（总数不可能小于通过数）+ 点名，不静默修正。 */
const warnOrder = [];

/* ══════════════════════════════════════════════════════════════════════════
 * 从一份套件输出里取「通过数 / 总数」
 *
 * ★★ 这个函数被改过两次，两次都是**同一个失败模式**：分数被一行明细顶掉。
 *   第 1 次（2026-10-09）：`test-related-dl.js` 收尾写成 `✅  42 通过 / 0 失败`，
 *     数字中间夹着「通过」，`\d+\s*\/\s*\d+` 匹配不上 ⇒ 取到了明细里的 `8/8`，
 *     整套少算 34 条。当时补了「从整份输出倒着找汇总行」，**没补「这种写法要认得」**。
 *   第 2 次（2026-10-20）：合计打出 **「失败 -985」**（负数）才暴露 ——
 *     真凶是 `test-v1089-admin-domains.js` 的一行明细：
 *       `PASS  存档角标与列表同口径（6334 / 5335 …）`
 *     它以 `PASS` 开头（命中 `/pass/i`）、又带 `6334 / 5335`（命中 `\d+/\d+`），
 *     而真正的收尾 `结果：73 通过 / 0 失败` 反而认不出 ⇒ 分数被那行明细顶掉，
 *     `t < p` 于是让**合计失败数变成负数**。
 *   ⇒ 现在：① 明细行（PASS/FAIL/× 开头）不参与取分；
 *            ② 认 `n 通过 / m 失败`（总数 = n+m）、`通过 n/m`、`n/m 通过`、`passed n/m`；
 *            ③ 仍认不出才退回老行为并记 warnings；
 *            ④ `t < p` 一律夹住（总数不可能小于通过数）。
 *   `--selftest-parse` 用真实样本跑一遍这个函数（见下），免得第三次复发。
 * ═════════════════════════════════════════════════════════════════════════ */
/* 函数声明（不是 const 箭头）—— `--selftest-parse` 在文件顶部就调用 pickScore，
   写成 const 会撞 TDZ（实测 `Cannot access 'isDetailLine' before initialization`）。 */
function isDetailLine(l) { return /^\s*(?:PASS|FAIL)\b|^\s*[×✗]\s/.test(l); }
function pickScore(out) {
  const lines = String(out || '').split(/\r?\n/).filter((l) => l.trim());
  const SUMMARY = /(\d+)\s*\/\s*(\d+)/;
  for (let i = lines.length - 1; i >= 0; i--) {
    const L = lines[i];
    if (isDetailLine(L)) continue;
    /* `73 通过 / 0 失败` —— 两个数字是「通过数 / 失败数」，不是「通过 / 总数」 */
    const a = L.match(/(\d+)\s*(?:条)?\s*通过\s*\/\s*(\d+)\s*(?:条)?\s*失败/);
    if (a) return { p: Number(a[1]), t: Number(a[1]) + Number(a[2]), from: 'summary' };
    /* `通过 80/80` · `通过：80 / 80` · `80/80 通过` · `passed 17 / 17` */
    const b = L.match(/通过\s*[:：]?\s*(\d+)\s*\/\s*(\d+)/)
      || L.match(/(\d+)\s*\/\s*(\d+)\s*(?:项)?\s*通过/)
      || L.match(/\b(?:passed|pass)\s*[:：]?\s*(\d+)\s*\/\s*(\d+)/i)
      || L.match(/(\d+)\s*\/\s*(\d+)\s*(?:passed|pass)\b/i);
    if (b) return { p: Number(b[1]), t: Number(b[2]), from: 'summary' };
    /* 极少数套件收尾只写 `结果：126 / 126`（不含「通过」二字）—— 记下继续往上找更明确的 */
    if (/(?:结果|合计|总计|summary)/i.test(L) && SUMMARY.test(L)) {
      const c = L.match(SUMMARY);
      return { p: Number(c[1]), t: Number(c[2]), from: 'summary' };
    }
  }
  /* 退回老行为（兼容还没改成约定格式的套件），但**记一笔** */
  const mAll = String(out || '').match(/^.*(\d+)\s*\/\s*(\d+).*$/gm) || [];
  if (mAll.length) {
    const last = mAll[mAll.length - 1].match(SUMMARY);
    return { p: Number(last[1]), t: Number(last[2]), from: 'fallback', sample: mAll[mAll.length - 1].trim().slice(0, 60) };
  }
  return { p: null, t: null, from: 'none' };
}

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
  const sc = pickScore(out);
  let p = sc.p, t = sc.t;
  if (sc.from === 'fallback') {
    /* 退回老行为（兼容还没改成约定格式的套件），但**记一笔** */
    warnFmt.push(`${s}（收尾没有「… 通过 …」形态的汇总行，成绩取自：${sc.sample}）`);
  }
  if (p != null) {
    if (t < p) {
      warnOrder.push(`${s}（通过 ${p} / 总数 ${t} —— 两个数字疑似在收尾行里写反）`);
      t = p;
    }
    pass += p; fail += (t - p);
  }
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
if (warnOrder.length) {
  console.log(`⚠️ 收尾汇总行的两个数字顺序可疑（已按「总数=通过数」夹住，不会污染合计）：`);
  warnOrder.forEach((w) => console.log(`   · ${w}`));
  console.log('   ⇒ 收尾只写「通过 n/m」；别写「A 通过 / B 失败」这种中间夹字的形态');
}
console.log(`${'#'.repeat(52)}`);

if (fail || crashed.length || missing.length || noExit.length || warnFmt.length || warnOrder.length) {
  console.log(`\n⚠️ ${WITH_BROWSER ? '两层防线' : '静态防线'}未全绿 —— 先修这里，别急着跑线上验收。`);
  process.exit(1);
}
console.log(WITH_BROWSER
  ? '\n✅ 两层防线全绿。接下来：线上验收。'
  : `\n✅ 静态防线全绿。接下来：浏览器实拍（node tools/run-all.js --browser）→ 线上验收。`);

