/* 「卡片版式同构 + 封面取图链路」的常驻防线（v10.24 新增）
 *
 * 守两件**都静默出错**的事：
 *
 * ① 机型兼容的卡片**一张图都没有**
 *    服务端 `matchGames()` 从前没把 `libCover` 挂上去，前端 `dmCard` 读 `g.libCover`
 *    恒为 `undefined` ⇒ `.cov.noimg` 把封面区整个收起 ⇒ 卡片只剩文字。
 *    ⇒ 24 张卡、0 张图，而**没有任何一处报错**：字段缺失不会抛异常，
 *      `.cov` 元素照样存在（CSS 把它 `display:none`），`getBoundingClientRect` 也正常。
 *    唯一能抓住它的判据：断言「返回的每条都有 `libCover` 这个键」+「至少有 N 条非空」。
 *
 * ② 解包专区只借了 `.emu-card` **类名**，正文另起一套
 *    v10.22 的注释写着「沿用手机专区版式」，实际正文是 `.top/.nm/.cnt + .up-mc-row + …`
 *    六个自定义区块 ⇒ 卡片 352px（手机专区 232px），用户一眼看出不是同一套东西。
 *    ⇒ 断言必须锚定**正文骨架**（`.bd > h4 + .alt + .meta > .pill + .tgs > .tg`），
 *      而不能只断言类名存在 —— 那是假绿（PITFALLS 15/37/46）。
 *
 * 纯本地、无网络、无副作用（不请求任何接口；只读数据文件与页面源码）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const bhcover = require('../data/bhcover');
const bannerhub = require('../data/bannerhub');
const deviceMatch = require('../data/device-match');

let pass = 0, fail = 0;
const ok = (cond, name, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name + (detail ? '  — ' + detail : '')); }
  else { fail++; console.log('  × FAIL  ' + name + (detail ? '  — ' + detail : '')); }
};
const eq = (got, want, name) => ok(got === want, name, '得到 ' + JSON.stringify(got) + '，期望 ' + JSON.stringify(want));

/* 已知「仓库键在端游库里、且库条目有封面」的样本（实测挑的，别改成随手编的键） */
const KNOWN = 'Grand_Theft_Auto_V_Legacy';
/* ★ 两个**分支独有**的键（2026-09-20 在 Xiaomi 2412DPC0AG 的 1,000 款里实测挑出）：
   只断言「有封面总数够 500」是不够的 —— 两条链路会互相顶替，
   掐掉任意一条，总数仍可能过线。所以给每条链路各配一个**只有它能解**的键。 */
const ONLY_BANNERHUB = 'EA_SPORTS__FIFA_23'; // 只有 ① bannerhub.libMatch 能解
const ONLY_MOBILEHUB = 'Tomb_Raider';        // 只有 ② mobilehub.bhKeys 能解

(async () => {
  /* ============================================================
   *  ① data/bhcover.js —— 键 → 库内条目（单一真源的取图入口）
   * ============================================================ */
  console.log('=== ① data/bhcover.js：仓库键 → 端游库条目 ===');
  ok(typeof bannerhub.libMatch === 'function',
    '★ bannerhub 已导出 libMatch（没导出就得再写一份键匹配 = 漂移）');

  const hit = bhcover.of(KNOWN);
  ok(!!hit, KNOWN + ' 能翻到库内条目', hit ? hit.libId : 'null');
  ok(!!(hit && hit.libId), '库内条目带 libId', hit && hit.libId);
  ok(!!(hit && /^https?:\/\//i.test(hit.libCover)),
    '★ 封面是**绝对 http(s) URL**（相对路径会打到本站 → 404 → 卡片只剩色块）',
    hit && String(hit.libCover).slice(0, 70));

  eq(bhcover.of(''), null, '空键返回 null（不编造）');
  eq(bhcover.of(null), null, 'null 键返回 null（不编造）');
  eq(bhcover.of('____这个键一定不存在____'), null, '★ 未收录的键返回 null，**不安一个错的封面**');

  /* 传对象也认（调用方拿到的常是 bannerhub 的 game 对象） */
  const byObj = bhcover.of({ k: KNOWN });
  ok(!!(byObj && byObj.libCover), '★ 传对象也认（读 .k），与传字符串结果一致');

  /* ★ 两条取图链路**各自**都要真的在起作用（否则「总数够」= 假绿，见上面注释） */
  const a = bhcover.of(ONLY_BANNERHUB);
  const b = bhcover.of(ONLY_MOBILEHUB);
  ok(!!(a && a.libCover),
    '★ ① 链路（bannerhub 精确键）单独能解 ' + ONLY_BANNERHUB + ' —— 掐掉这条分支即变红',
    a && String(a.libCover).slice(0, 60));
  ok(!!(b && b.libCover),
    '★ ② 链路（mobilehub.bhKeys 反查）单独能解 ' + ONLY_MOBILEHUB + ' —— 掐掉这条分支即变红',
    b && String(b.libCover).slice(0, 60));

  /* attachAll：字段必须**写全**（缺字段会让「接口到底给没给」看不出来） */
  const batch = [{ k: KNOWN }, { k: '____不存在____' }, {}];
  const n = bhcover.attachAll(batch);
  eq(n, 1, 'attachAll 只给能取到封面的那条计数');
  ok(batch[0].libCover && batch[0].libId, '第一条挂上了 libCover / libId');
  ok('libCover' in batch[1] && batch[1].libCover === '' && batch[1].libId === null,
    '★ 取不到的那条字段**仍然存在**，值为空串/null（不是 undefined ⇒ 前端不用写 `g.lib &&`）');
  /* 没有 k 的条目**整条跳过**（它根本不是社区库游戏）；写半套字段比不写更坏 —— 下一个人会以为有值 */
  ok(!('libCover' in batch[2]), '★ 没有 k 的条目整条跳过，不写半套字段（半套比没有更坏）');

  /* ============================================================
   *  ② device-match.matchGames —— 结果真的挂上了
   * ============================================================ */
  console.log('\n=== ② /api/device/match 的返回体（用户看到的那批卡） ===');
  const r = deviceMatch.matchGames('Xiaomi 2412DPC0AG', { limit: 1000 });
  ok(r.ok, '机型能查到（基准样本 Xiaomi 2412DPC0AG）');
  const games = r.games || [];
  ok(games.length > 0, '返回了可跑游戏', games.length + ' 条');

  const missingKey = games.filter((g) => !('libCover' in g)).length;
  eq(missingKey, 0, '★ 每条都带 libCover 键（缺键 ⇒ 前端恒 undefined ⇒ 封面区被 CSS 收起，且不报错）');

  const withCov = games.filter((g) => g.libCover).length;
  ok(withCov > 0, '★ 至少有一批能取到封面（只断言「字段存在」会被「全空」骗过）',
    withCov + '/' + games.length + '（' + (withCov / games.length * 100).toFixed(1) + '%）');
  ok(withCov >= 500,
    '★ 封面覆盖不低于基线 500 条（2026-09-20 实测 526；掉下去说明取图链路退化了）' +
    ' —— 阈值不能定在 400：实测只留 ① 是 417、只留 ② 是 523，400 拦不住任何一条分支退化',
    withCov + ' 条');
  const top24 = games.slice(0, 24).filter((g) => g.libCover).length;
  ok(top24 >= 18, '★ 首屏 24 张里至少 18 张有图（用户第一眼看到的必须是图片卡）',
    top24 + '/24');

  ok(games.every((g) => typeof g.libCover === 'string'),
    '★ libCover 一律是字符串（null/undefined 混入会让前端模板拼出 "null"）');
  ok(games.filter((g) => g.libCover).every((g) => /^https?:\/\//i.test(g.libCover)),
    '★ 所有封面都是绝对 URL');

  /* 未收录的必须留空，不许编造 */
  const tools = games.filter((g) => /^(7-Zip|AVAMain|ACOrigins|4gb_patch)$/i.test(g.name));
  ok(tools.every((g) => g.libCover === ''),
    '★ 工具/启动器类（本来就没有封面）留空，不编造',
    tools.map((g) => g.name + '=' + (g.libCover ? '有图' : '空')).join(' '));

  /* ============================================================
   *  ③ 前端接线：dmCard 读的就是 g.libCover
   * ============================================================ */
  console.log('\n=== ③ 机型兼容卡片接线 ===');
  const emuSrc = read('tools/emulator-sections.js');
  const emuPage = read('public/emulator.html');
  const upSrc = read('tools/unpack-sections.js');

  /* ★ 抠函数体必须**按行找结尾**，不能用 `[\s\S]{0,2000}?\n\}` 那种窗口：
     卡片模板字符串上千字符，窗口一小就抠不到 ⇒ 下面的断言全成了空跑（假绿）。
     本项目在「断言助手自己写错导致整轮假通过」上栽过（PITFALLS 15），所以这里
     额外断言「三块都真抠出来了、且长度合理」。 */
  const sliceFn = (src, startRe, endRe) => {
    const lines = src.split(/\r?\n/);
    const s = lines.findIndex((l) => startRe.test(l));
    if (s < 0) return '';
    for (let i = s + 1; i < lines.length; i++) if (endRe.test(lines[i])) return lines.slice(s, i + 1).join('\n');
    return '';
  };
  const emuCardFn = sliceFn(emuSrc, /^function emuCard\(/, /^\}$/);
  const dmCardFn = sliceFn(emuSrc, /^function dmCard\(/, /^\}$/);
  const upCardFn = sliceFn(upSrc, /^  function card\(it\) \{/, /^  \}$/);

  ok(emuCardFn.length > 800 && dmCardFn.length > 400 && upCardFn.length > 800,
    '★ 三个卡片函数都真的抠出来了（抠不到 ⇒ 下面全是空跑 = 假绿）',
    '手机专区 ' + emuCardFn.length + ' / 机型兼容 ' + dmCardFn.length + ' / 解包 ' + upCardFn.length + ' 字符');

  /* ★ 以下断言一律**收窄到 dmCard 函数体**内。
     v10.24 第一版这里写的是 `/class="cov noimg"/.test(emuSrc)` —— 全文件搜，
     结果命中的是**手机专区** emuCard 那一行，标签却写着「机型兼容」。
     锚点太宽 = 假绿（PITFALLS 15/37/46）：机型兼容的兜底整个删掉它照样绿。 */
  ok(/function dmCard\(/.test(emuSrc), 'dmCard 在 emulator-sections.js 里（派生页由它生成）');
  ok(/g\.libCover/.test(dmCardFn), '★ dmCard 读 g.libCover');
  ok(/<div class="cov"><img/.test(dmCardFn), '有图时渲染 .cov > img');
  ok(/class="cov ph"/.test(dmCardFn),
    '★ 无图时走 `.cov.ph` 同尺寸占位块 —— **不能**用 `.cov.noimg`（它 height:0 ⇒ 封面位塌掉）');
  ok(!/cov noimg/.test(dmCardFn), '★ dmCard 里没有 `.cov.noimg`（收起封面位 = 同一行其它卡有图、这张少一截）');
  ok(/onerror="covErr\(this,/.test(dmCardFn),
    '★ 封面图**加载失败**也换占位块（`covErr`），不是 `visibility:hidden` 留一块灰、更不是收起');
  ok(/onerror="covErr\(this,/.test(upCardFn) && !/cov noimg/.test(upCardFn),
    '★ 解包卡图挂掉同样是「换占位块」——v10.24 前它走 `classList.add(\'noimg\')`，404 即顶部塌一块');
  ok(/function dmCard\(/.test(emuPage) && /g\.libCover/.test(emuPage) && /covErr/.test(emuPage),
    '★ 派生页 emulator.html 已重建（改主源不重建不报错，只悄悄漂移）');

  /* ============================================================
   *  ④ 卡片正文骨架同构（这才是「同版式」的真判据）
   * ============================================================ */
  console.log('\n=== ④ 三处卡片正文骨架 ===');
  const SKELETON = [
    ['正文容器 .bd', /class="bd"/],
    ['游戏名 <h4>', /<h4 title=/],
    ['徽标行 .meta + .pill', /class="meta"/],
    ['标签行 .tgs + .tg', /class="tgs"/],
    ['封面 .cov', /class="cov"/],
  ];
  for (const [label, re] of SKELETON) {
    ok(re.test(emuCardFn), '手机专区（基线）有「' + label + '」');
    ok(re.test(dmCardFn), '★ 机型兼容有「' + label + '」—— 与基线同构');
    ok(re.test(upCardFn), '★ 解包专区有「' + label + '」—— 与基线同构');
  }

  /* 反向：旧版式的正文不能再出现（锚定到模板串，注释里出现不算） */
  ok(!/'<div class="top">'/.test(upSrc) && !/'<div class="nm">'/.test(upSrc),
    '★ 解包卡片不再产出 .top / .nm 正文（v10.22 那套）');
  ok(!/'<div class="cnt">'/.test(upSrc), '★ 解包卡片不再产出 .cnt（热度改走 .pill）');

  /* ============================================================
   *  ⑤ 派生页里的死 CSS 必须清掉
   * ============================================================ */
  console.log('\n=== ⑤ 派生页死样式 ===');
  const upPage = read('public/unpack.html');
  for (const cls of ['up-badge{', 'up-mc-src{', 'up-mc-row{', 'up-tg-score{']) {
    ok(!new RegExp('\\.' + cls).test(upPage),
      '★ 解包页没有残留的 .' + cls.replace('{', '') + ' 规则（留着会让下一个人以为卡片还是旧版式）');
  }
  ok(/\.up-mc-btns\{/.test(upPage), '解包页保留 .up-mc-btns（下载/源站按钮行，解包专区特有）');
  ok(/\.up-ch\{/.test(upPage), '解包页保留 .up-ch（四维判定 chip，解包专区特有）');

  /* 档位徽标改用手机专区那套 .pill.fps.*，不再自建配色 */
  const idx = read('public/index.html');
  const vBlock = (upSrc.match(/const VERDICT = \{[\s\S]{0,600}?\};/) || [''])[0];
  ok(/pill: 'fps smooth'/.test(vBlock) && /pill: 'fps ok'/.test(vBlock) && /pill: 'fps low'/.test(vBlock) && /pill: 'fps bad'/.test(vBlock),
    '★ 解包四个档位都映射到手机专区的 .pill.fps.*（同一语义不留两套配色）');

  /* ★ 真正的判据不是「CSS 里有 smooth」，而是**源码引用到的每一个档位类都存在**。
     v10.24 前的真 bug 正是「引用了不存在的类」：DM_TIER 写 `cls:'ok'|'mid'|'low'`
     ⇒ 拼出 `class="pill ok"`/`pill mid`/`pill low`，而共享 CSS 里只有 `.pill.fps.*`
     ⇒ 三个档位全是灰底 rgb(241,243,248)，与旁边的普通 pill 长得一模一样，**且不报错**。
     所以从**引用侧**取类名、到**定义侧**逐个核对（只查定义侧会漏掉拼错）。 */
  const dmTier = (emuSrc.match(/const DM_TIER = \{[\s\S]{0,500}?\};/) || [''])[0];
  ok(/cls:\s*'fps\s+smooth'/.test(dmTier) && /cls:\s*'fps\s+ok'/.test(dmTier) && /cls:\s*'fps\s+low'/.test(dmTier),
    '★ DM_TIER 的三个 cls 都是**完整**类名 fps X（写成 ok/mid/low 会静默无样式）',
    dmTier.replace(/\s+/g, ' ').slice(0, 130));
  const usedFps = new Set();
  for (const m of (emuSrc + upSrc).matchAll(/['"]fps\s+(smooth|ok|low|bad)['"]/g)) usedFps.add(m[1]);
  ok(usedFps.size >= 4, '★ 引用侧取到 smooth/ok/low/bad 四个档位类', [...usedFps].join(','));
  for (const c of usedFps) {
    ok(new RegExp('\\.pill\\.fps\\.' + c + '\\{').test(idx),
      '★ 引用到的 .pill.fps.' + c + ' 在共享 CSS 里真有定义（复用不存在的类 = 静默无样式）');
  }

  /* ============================================================
   *  ⑥ 封面位与占位块（「图片卡」的地基）
   * ============================================================ */
  console.log('\n=== ⑥ 封面位 / 占位块 / 加载失败兜底 ===');
  ok(/\.emu-card \.cov\{[^}]*height:92px/.test(idx),
    '★ .cov 有固定高 92px —— 占位块靠它撑住；高度没了，整张卡就「顶部塌一块」');
  ok(/\.emu-card \.cov\.ph\{/.test(idx), '★ 共享 CSS 有 .emu-card .cov.ph（同尺寸占位块）');
  ok(/\.emu-card \.cov\.ph span\{/.test(idx), '★ 占位块里的缩写有样式');
  ok(!/\.cov\.ph[^}]*display:\s*none/.test(idx),
    '★ .cov.ph **不能被 display:none**（那等于收起封面位，又回到「顶部塌一块」）');
  ok(/\.emu-card \.cov\.noimg\{[^}]*height:0/.test(idx),
    '★ .cov.noimg 保持「收起」语义（手机专区按 libOnly 过滤，本来就没无图卡；两套语义分开，别混用）');
  ok(/const covAbbr = \(name\)/.test(idx) && /const covErr = \(img, abbr\)/.test(idx) && /window\.covErr = covErr/.test(idx),
    '★ 共享脚本暴露 covAbbr + window.covErr（内联 onerror 只调得到全局名的函数）');
  ok(/covAbbr/.test(emuPage) && read('public/unpack.html').includes('covErr'),
    '★ 派生页也拿到了这两个函数（主源加了、派生页没重建 ⇒ 页面上 onerror 直接 ReferenceError）');

  console.log('\n============================');
  console.log('  通过 ' + pass + '/' + (pass + fail) + '（失败 ' + fail + '）');
  console.log('============================');
  process.exit(fail ? 1 : 0);
})();
