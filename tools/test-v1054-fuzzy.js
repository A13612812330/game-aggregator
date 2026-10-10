/* ★ v10.54 模糊搜索 + 相关度权重 + 分模块视觉（纯离线，秒级，不依赖 8123）
 *
 * 守护的不变量：
 *   A. 四个库共用**同一套**匹配与打分（`data/search-rank.js`）—— 不允许再各写一份
 *   B. 「带空格 / 乱序」查询在四个库都不再 0 命中
 *      改前实测（tools/_probe-fuzzy-base.js）：带空格查询 6 条里 **3 条端游 0 命中**，
 *      而手游 / 修改器 / 存档三个库都有命中 —— 同一个查询四个库给出互相矛盾的答案。
 *   C. 相关度分级严格有序：EXACT < PREFIX < CONTAINS < TOKEN_ALL < TOKEN_SOME < NONE
 *   D. 代际护栏：查询带数字而名字通篇不含 ⇒ 不命中（搜「生化危机4」不得出「生化危机9」）
 *   E. 组内按相关度排序（越准越靠前）；`topScore` 如实反映命中集的最优相关度
 *   F. 前端不再自算 fit（改为消费服务端下发的 `fit`），分模块视觉层 `.sm-grp` 四页同步
 *
 * 反证锚点（打坏必变红）：
 *   · 去掉 `tokensOf` 里的 2-gram 切分 → B 的「狂猎 巫师」/「狂猎巫师」变红
 *   · 去掉 `rankOne` 里的代际护栏      → D 的「生化危机4 不得出 9」变红
 *   · 把 `MIN_COVER` 调回 0.6          → D 的「赛博朋克商店模拟器」变红
 *   · 把某个库的 `sortByRank` 换回旧口径 → B 的分库命中变红
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const r = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0; let fail = 0;
const chk = (name, ok, extra) => {
  if (ok) { pass++; console.log('  \u2705 ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.log('  \u274c ' + name + (extra ? '   ' + extra : '')); }
};
const j = (o) => JSON.stringify(o);

const SR = require(path.join(ROOT, 'data', 'search-rank.js'));
const gamesDb = require(path.join(ROOT, 'data', 'gamesDb.js'));
const mobilehub = require(path.join(ROOT, 'data', 'mobilehub.js'));
const trainers = require(path.join(ROOT, 'data', 'trainers.js'));
const saves = require(path.join(ROOT, 'data', 'saves.js'));
gamesDb.load();

const countAll = (q) => ({
  pc: gamesDb.search(q, 1).count,
  mo: mobilehub.list({ q, stats: 'all', limit: 1 }).total,
  tr: trainers.list({ q, stats: 'all', limit: 1 }).total,
  sv: saves.list({ q, stats: 'all', limit: 1 }).total,
});

/* ================= A · 单一真源 ================= */
console.log('=== A · 四个库共用同一套匹配与打分 ===');
chk('A `data/search-rank.js` 导出 rank / sortByRank / fitOf / tokensOf / NONE',
  ['rank', 'sortByRank', 'fitOf', 'tokensOf', 'NONE'].every((k) => k in SR),
  Object.keys(SR).length + ' 个导出');

const LIB_SRC = {
  gamesDb: r('data/gamesDb.js'),
  mobilehub: r('data/mobilehub.js'),
  trainers: r('data/trainers.js'),
  saves: r('data/saves.js'),
};
for (const [k, s] of Object.entries(LIB_SRC)) {
  chk('A `data/' + k + '.js` 引入 search-rank', /require\(\s*['"]\.\/search-rank['"]\s*\)/.test(s));
}
/* 负向断言：三库不得再自写「小写化 + includes」匹配（那正是本次漂移的来源） */
for (const k of ['mobilehub', 'trainers', 'saves']) {
  chk('A `data/' + k + '.js` 已移除自写的 toLowerCase().includes 匹配',
    !/String\(n\)\.toLowerCase\(\)\.includes\(ql\)/.test(LIB_SRC[k]));
}
chk('A `gamesDb.search` 走统一 rank（不再自写 score 档位）',
  /const s = rank\(k, \[g\.title\]/.test(LIB_SRC.gamesDb) && !/const score = \(t\) =>/.test(LIB_SRC.gamesDb));
chk('A `server.js` 用 searchRank.fitOf 下发组贴合度',
  (r('server.js').match(/searchRank\.fitOf\(/g) || []).length === 4,
  (r('server.js').match(/searchRank\.fitOf\(/g) || []).length + ' 处（应为 4）');

/* ================= B · 模糊命中 ================= */
console.log('=== B · 模糊匹配：带空格 / 乱序都要命中 ===');
/* 样本全部实测「四个库都 >0」才收进来（含 0 的样本不放进断言，否则是在测数据而非测代码） */
const COMBOS = ['巫师3 狂猎', '狂猎 巫师', '艾尔登 法环', '生化危机 4', '赛博朋克 2077', '荒野大镖客 2', '刺客信条 起源', '只狼', '蔚蓝Celeste'];
for (const q of COMBOS) {
  const c = countAll(q);
  const zero = Object.entries(c).filter(([, v]) => !v).map(([k]) => k);
  chk('B 「' + q + '」四个库都有命中', zero.length === 0, j(c));
}
/* ★ 防恒真：同时算**旧口径**（v10.53 及以前 gamesDb 的 toLowerCase+includes）——
   旧口径对「巫师3 狂猎」端游 0 命中、新口径 >0。两侧都断言，退化回去必红。 */
const legacy = (q) => gamesDb.all().filter((g) => String(g.title || '').toLowerCase().includes(String(q).toLowerCase())).length;
chk('B ★ 对照：旧口径对「巫师3 狂猎」端游 0 命中、新口径 >0',
  legacy('巫师3 狂猎') === 0 && gamesDb.search('巫师3 狂猎', 1).count > 0,
  '旧=' + legacy('巫师3 狂猎') + ' 新=' + gamesDb.search('巫师3 狂猎', 1).count);
chk('B ★ 对照：旧口径对「蔚蓝Celeste」端游 0 命中、新口径 >0（库里有《蔚蓝/Celeste》）',
  legacy('蔚蓝Celeste') === 0 && gamesDb.search('蔚蓝Celeste', 1).count > 0,
  '旧=' + legacy('蔚蓝Celeste') + ' 新=' + gamesDb.search('蔚蓝Celeste', 1).count);

/* ================= C · 相关度分级 ================= */
console.log('=== C · 相关度分级严格有序 ===');
const w3 = '巫师3：狂猎';
chk('C 完全相等 → EXACT(0)', SR.rank('巫师3：狂猎', [w3]) === SR.EXACT, String(SR.rank('巫师3：狂猎', [w3])));
chk('C 前缀命中 → PREFIX(1)', SR.rank('巫师3', [w3]) === SR.PREFIX, String(SR.rank('巫师3', [w3])));
chk('C 连续子串 → CONTAINS(2)', SR.rank('狂猎', [w3]) === SR.CONTAINS, String(SR.rank('狂猎', [w3])));
chk('C 乱序分词全命中 → TOKEN_ALL(3)', SR.rank('狂猎 巫师', [w3]) === SR.TOKEN_ALL, String(SR.rank('狂猎 巫师', [w3])));
chk('C 无分隔符乱序（2-gram）同样命中', SR.rank('狂猎巫师', [w3]) === SR.TOKEN_ALL, String(SR.rank('狂猎巫师', [w3])));
chk('C 部分命中（同义「重制/重置」）落在 TOKEN_SOME 档',
  SR.rank('生化危机4 重制', ['生化危机4重置版']) >= SR.TOKEN_SOME && SR.rank('生化危机4 重制', ['生化危机4重置版']) < SR.NONE,
  String(SR.rank('生化危机4 重制', ['生化危机4重置版'])));
chk('C ★ 分级严格单调：EXACT < PREFIX < CONTAINS < TOKEN_ALL < TOKEN_SOME',
  SR.EXACT < SR.PREFIX && SR.PREFIX < SR.CONTAINS && SR.CONTAINS < SR.TOKEN_ALL && SR.TOKEN_ALL < SR.TOKEN_SOME);
chk('C 不沾边 → NONE', SR.rank('塞尔达传说', [w3]) === SR.NONE);
chk('C tokensOf 按字符类别分段', j(SR.tokensOf('巫师3狂猎')) === j(['巫师', '3', '狂猎']), j(SR.tokensOf('巫师3狂猎')));
chk('C fitOf 分级正确（越大越贴合，null → 0）',
  SR.fitOf(null) === 0 && SR.fitOf(SR.EXACT) === 3 && SR.fitOf(SR.PREFIX) === 2 && SR.fitOf(SR.CONTAINS) === 1 && SR.fitOf(SR.TOKEN_SOME) === 1,
  [SR.fitOf(null), SR.fitOf(0), SR.fitOf(1), SR.fitOf(2), SR.fitOf(4.33)].join('/'));

/* ================= D · 代际护栏 + 噪音闸 ================= */
console.log('=== D · 代际护栏与噪音闸 ===');
/* ⚠️ 关于「下面这几条到底在测什么」——反证实测（`tools/_counterproof-v1054.js` 的 B 分支）发现：
 *   **去掉代际护栏后，前两条仍然绿**。查明原因：`生化危机9：安魂曲` 的 token 覆盖率只有
 *   0.667 < MIN_COVER(0.7)，**噪音闸就挡住了**，护栏只是第二道。
 *   所以它们的正确名字是「双闸下的行为」（门槛 + 护栏），不能记在护栏头上。
 *   真正**只有护栏能挡**的场景（覆盖率 ≥ 0.7 但代际数字不同）见紧跟其后的两条。 */
chk('D ★ 搜「生化危机4」不得命中「生化危机9：安魂曲」（门槛 + 护栏双闸）',
  SR.rank('生化危机4', ['生化危机9：安魂曲']) === SR.NONE);
chk('D ★ 搜「生化危机4」不得命中「生化危机5：黄金版」（门槛 + 护栏双闸）',
  SR.rank('生化危机4', ['生化危机5：黄金版/Resident Evil 5：Gold Edition']) === SR.NONE);
/* ★★ 这两条才真正钉住**代际护栏本身**：query 的 token 覆盖率 = 0.75 ≥ 门槛（噪音闸会放行），
 *    名字里 `生化 / 危机 / 重制` 三段全中、只差代际数字 ⇒ 只有 `genNums` 护栏能拒绝。
 *    反证 B 分支（去掉护栏）打的就是这两条 —— 这是「断言名 = 守护对象」的校验。 */
chk('D ★★ 代际护栏（coverage=0.75 ≥ 门槛，只有护栏能挡）：「生化危机4 重制」不得命中「生化危机9：重制版」',
  SR.rank('生化危机4 重制', ['生化危机9：重制版']) === SR.NONE,
  'rank=' + SR.rank('生化危机4 重制', ['生化危机9：重制版']));
chk('D ★★ 代际护栏：同上，换个写法仍拒绝（全角/半角冒号无关）',
  SR.rank('生化危机4 重制', ['生化危机9 重制版']) === SR.NONE);
chk('D 代际护栏不误杀正确项（「生化危机4重置版」仍命中）',
  SR.rank('生化危机4', ['生化危机4重置版']) === SR.PREFIX);
chk('D ★ 反向不拒：搜「Tomb Raider」仍命中「古墓丽影9终极版」（v10.36 定论）',
  SR.rank('Tomb Raider', ['古墓丽影9终极版/Tomb Raider Definitive Edition']) < SR.NONE,
  String(SR.rank('Tomb Raider', ['古墓丽影9终极版/Tomb Raider Definitive Edition'])));
chk('D 代际护栏不吃 4 位年份（「古墓丽影9」不受 2014 之类影响）',
  SR.rank('古墓丽影9', ['古墓丽影9终极版/Tomb Raider Definitive Edition']) === SR.PREFIX);
chk('D ★ 噪音闸（MIN_COVER=0.7）：搜「赛博朋克 2077」不得命中「赛博朋克商店模拟器」',
  SR.rank('赛博朋克 2077', ['赛博朋克商店模拟器/Cyberpunk Store Simulator']) === SR.NONE);
chk('D ★ 噪音闸：搜「黑神话 悟空」不得命中「黑神话时空」',
  SR.rank('黑神话 悟空', ['黑神话时空/Realm of oblivionsoul like']) === SR.NONE);
chk('D 噪音闸没把「同义召回」一起挡掉（生化危机4 重制 → 4重置版）',
  SR.rank('生化危机4 重制', ['生化危机4重置版']) < SR.NONE);

/* ================= E · 组内排序与 topScore ================= */
console.log('=== E · 组内按相关度排序 ===');
const e1 = gamesDb.search('艾尔登 法环', 6);
chk('E 搜「艾尔登 法环」端游首条是「艾尔登法环」（完全相等排第一）',
  (e1.items[0] || {}).title === '艾尔登法环', (e1.items[0] || {}).title);
chk('E 该查询 topScore = EXACT(0)（组间据此提权）', e1.topScore === SR.EXACT, String(e1.topScore));
const e2 = gamesDb.search('巫师3 狂猎', 6);
chk('E 搜「巫师3 狂猎」端游 3 条都在（改前 0 条）', e2.count === 3, 'count=' + e2.count);
chk('E topScore = PREFIX(1)', e2.topScore === SR.PREFIX, String(e2.topScore));
/* 组内必须按相关度升序（同分保持业务序，因此是「不降」而非「严格递增」） */
const seq = e1.items.map((x) => SR.rank('艾尔登 法环', [x.title]));
chk('E 端游结果按相关度不降排序', seq.every((v, i) => i === 0 || seq[i - 1] <= v), j(seq));
const e3 = mobilehub.list({ q: '巫师3 狂猎', stats: 'all', limit: 10 });
chk('E 手游库有查询词时 topScore 非空（供组间排序）', e3.topScore !== null && e3.topScore < SR.NONE, String(e3.topScore));
const e4 = gamesDb.search('这个游戏一定不存在xyz', 3);
chk('E 无命中时 topScore = null（不是 0，否则组间会误判为「最贴合」）', e4.topScore === null && e4.count === 0, String(e4.topScore));
const e5 = trainers.list({ q: '巫师3', stats: 'all', limit: 5 });
chk('E 修改器库首条相关度 ≤ 末条（排序生效）',
  e5.items.length < 2 || SR.rank('巫师3', [e5.items[0].name, e5.items[0].zh, e5.items[0].libTitle])
    <= SR.rank('巫师3', [e5.items[e5.items.length - 1].name, e5.items[e5.items.length - 1].zh, e5.items[e5.items.length - 1].libTitle]));

/* ================= F · 前端消费 + 分模块视觉 ================= */
console.log('=== F · 前端消费服务端 fit + 分模块视觉 ===');
const IDX = r('public/index.html');
chk('F 前端组间排序改用服务端 `fit`（`b.fit - a.fit`）', /groups\.sort\(\(a, b\) => b\.fit - a\.fit/.test(IDX));
chk('F 前端不再自算 fit（已删除 `const fit = (...nameLists) =>`）', !/const fit = \(\.\.\.nameLists\) =>/.test(IDX));
chk('F 端游库「本体提权」保留（fit >= 2 时 +1）', /pcFit \+ \(pcFit >= 2 \? 1 : 0\)/.test(IDX));
chk('F 分模块视觉层 `.sm-grp` CSS 到位', /\.sm-grp \{|\.sm-grp\{/.test(IDX));
chk('F 组间有分隔线（`.sm-grp + .sm-grp` 的 border-top）', /\.sm-grp \+ \.sm-grp\{[^}]*border-top/.test(IDX));
chk('F 组标题条带底色（`.sm-grp > .sm-sec` 的 background）', /\.sm-grp > \.sm-sec\{[^}]*background/.test(IDX));
chk('F 渲染时每组包 `.sm-grp`', /class="sm-grp\$\{k === 0 \? ' first' : ''\}"/.test(IDX));
chk('F 别名提示只在首组出现（原来四组各拼一遍）', /\$\{k === 0 \? aliasHtml : ''\}/.test(IDX));
for (const p of ['public/emulator.html', 'public/resources.html', 'public/unpack.html']) {
  chk('F ' + p + ' 同步含 `.sm-grp` 视觉层', /\.sm-grp\{/.test(r(p)));
}

console.log('\n── v10.54 模糊搜索：' + pass + ' / ' + (pass + fail) + ' 通过 ──');
process.exit(fail ? 1 : 0);
