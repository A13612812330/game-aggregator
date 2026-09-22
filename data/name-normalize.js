/**
 * name-normalize.js — 跨源「游戏名 → 归一化钥匙」的唯一真源（A 族：保留 CJK、剥全部符号）
 *
 * ★ 为什么要有这个文件（v10.36 实测出来的）：
 *   同一套归一化在 `data/phonecfg.js` / `data/mobilehub.js` / `tools/build-mobilehub.js`
 *   里**各写了一份**，三份的字符类**并不一致**，而且**都漏了商标号 `™ ® ©`**。
 *
 *   实测后果（端游库 19,010 条标题里 **75 条含 ™/®**，抽两条最典型的）：
 *     · 库内  `…/Call of Duty®: Modern Warfare® 2 (2009)` → 钥匙 `callofduty®modernwarfare®22009`
 *     · 社区库导出 `Call of Duty Modern Warfare 2 2009`     → 钥匙 `callofdutymodernwarfare22009`
 *     两边**只差商标号** ⇒ 精确通道整个失效，该条被**错配**到《使命召唤16：现代战争》
 *     （`Call of Duty: Modern Warfare`）—— 而库里**本来就有正确的那一条**（`jidi-36879193`）。
 *     · 同理 `The Sims 1 - Legacy Collection` 被错配到 `The Sims™ 4 …`（库里其实有
 *       `模拟人生1：经典合集/The Sims Legacy Collection`）。
 *   ⇒ 「归一化」是同一件事，只允许有一份实现；本文件即那一份。
 *
 * ⚠️ 不要和 `data/bannerhub.js` 的 `normKey` 混为一谈：那是**另一族**
 *    （`[^a-z0-9]+`，连 CJK 一起剥），因为它匹配的是社区库的**仓库键**
 *    （形如 `EA_SPORTS__FIFA_23`），本就纯 ASCII。两族不可互相替换。
 *
 * ⚠️ 本文件只管「钥匙怎么算」。**匹配通道**（精确段 / 别名 / 英文词组 / 词干 / 前缀包含）
 *    仍各自留在 `tools/build-mobilehub.js` 与 `data/phonecfg.js` 里 —— 那两处的
 *    通道集与护栏并不相同（前者是合并表的主匹配器，后者是实测库的轻量匹配器），
 *    v11 再统一；本轮只统一「不可能也不应该有两份」的那一层。
 */

/** 参与归一化时**一律剥掉**的符号（含商标号 `™®©`、度数、全角标点）。
 *  本常量是唯一真源：`tools/test-v1036.js` 会断言三处调用方都不再自带字符类。 */
const SYMBOLS = /[™®©°′″·・:：,，.。!！?？'"“”‘’()（）\[\]【】<>《》|｜/\\~～\-–—_+*&#@$%^;；＊]/g;

/** 归一化：小写 → 去掉所有空白 → 剥掉全部符号。保留 CJK（中文名是有效钥匙）。 */
function normKey(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(SYMBOLS, '');
}

/** 键里的裸数字（含年份）：`residentevil0` → ['0']，`pes2013` → ['2013']，无则 [] */
function tailNums(key) {
  return String(key == null ? '' : key).match(/\d{1,4}/g) || [];
}

/** 条目标题**整条**里的裸数字（原样，不做代际过滤）。 */
function titleNums(title) {
  return String(title == null ? '' : title).match(/\d{1,4}/g) || [];
}

/** ★ 「代际数字」——判「是不是同一代作品」时该看的数字。取数规则有三条，缺一条都会误杀：
 *
 *  ① **必须用原始串取数，不能用归一化后的钥匙**。归一化会把空格吃光，
 *     `…Warfare 2 2009` 粘成 `…warfare22009`，`\d{1,4}` 于是切出 `['2200','9']` ——
 *     与库里的 `['2','2009']` 对不上，**正确匹配反被判冲突**。v10.36 反证实测踩到，
 *     一次误杀 4 条（CoD MW2 2009 未匹配、`F1 2014` 未匹配、`啪嗒砰 1+2 重制版` 未匹配、
 *     `Warhammer 40,000 …` 全部错位）。
 *  ② **3~4 位数字不算代际**。年份/大编号只是版本标记：`F1 2014`、`Dead Space 2008`、
 *     `Call of Duty Modern Warfare 3 2011`、`Warhammer 40,000` 都靠它，判冲突会全误杀。
 *  ③ **紧贴字母的数字不算代际**（`x64` / `ProjectZomboid32` / `TheWalkingDead2` / `dx11`）——
 *     那是 exe 的位数标记与 API 版本号，先整体摘掉再取数。
 *     `ProjectZomboid32`（32 位版）必须仍然命中 `僵尸毁灭工程/Project Zomboid`。
 */
function genNums(s) {
  const raw = String(s == null ? '' : s);
  const cleaned = raw.replace(/[a-z]+[-_]?\d+/gi, ' ');   // 摘掉 x64 / zomboid32 / dx11 这类
  return cleaned.match(/(?<![0-9])\d{1,2}(?![0-9])/g) || [];
}

/** ★ v10.36 新增护栏：**查询带「代际数字」、而命中条目通篇一个都不含** ⇒ 判为不同代际/不同版本，拒绝。
 *
 *  为什么只做**这一个方向**：反方向（库名有数字、查询没有）**不能**一律拒 ——
 *    `Tomb Raider` → `古墓丽影9终极版/Tomb Raider Definitive Edition`、
 *    `SkullGirls` → `Skullgirls 2nd Encore`、`Trails in the Sky` → `空之轨迹 the 2nd`
 *    都是「查询是系列总称」的**正确**匹配；`tools/build-mobilehub.js` 的 `sequelTail`
 *    注释里记着实测账：「4 退 1 进，明确不划算，故限定作用域」。
 *  而本方向只**拒绝**、从不新增匹配 ⇒ 不可能引入新的假阳性（零和的收窄）。
 *
 *  实测（v10.36，全库 19,010 条）拦下 3 条「已匹配但目标错」的假阳性：
 *    `The Sims 1 - Legacy Collection`     曾 → `The Sims™ 4 …`（仓库标题成了资料片，库里另有经典合集）
 *    `Call of Duty Modern Warfare 2 2009` 曾 → `使命召唤16：现代战争`
 *    `Assassin S creed 3`                 曾 → `刺客信条1/Assassin's Creed`
 *    另拦下 `Crysis 2 - Maximum Edition` → 孤岛危机重制版、`Saint s row 2` → 黑道圣徒重启版、
 *    `桥梁建造师3` → 桥梁建造师、`Little Nightmares 2` → 小小梦魇强化版 等同型错配。
 *
 *  ⚠️ 取的是**条目整条标题**的数字，不是命中那一段 key 的 ——
 *     段 key 常常是中文段（`使命召唤6：现代战争2（2009）/Call of Duty®: …`），
 *     数字全在英文段里，只看 key 会漏判。 */
function numMismatchByTitle(query, libItem) {
  if (!libItem) return false;
  const qn = genNums(query);
  if (!qn.length) return false;
  const tn = genNums(libItem.title);
  return !qn.some((x) => tn.includes(x));
}

module.exports = { normKey, SYMBOLS, tailNums, titleNums, genNums, numMismatchByTitle };
