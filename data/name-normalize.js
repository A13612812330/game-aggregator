/**
 * name-normalize.js — 跨源「游戏名 → 归一化钥匙」的唯一真源（A 族：保留 CJK、剥全部符号）
 *
 * ★ v10.60 起本文件持有**两族**字符类，别用混：
 *     · `SYMBOLS`（A 族 / 宽）：给**匹配**用，剥光标点后有第二道闸门兜假阳性。
 *     · `GROUP_DECOR`（B 族 / 窄）：给**展示归并**用（`decorKey`），无第二道闸 ⇒ 只剥商标号类。
 *   详因与实测账见 `GROUP_DECOR` 上方的注释。
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

/* ────────────────────────────────────────────────────────────────────────────
 * ★ v10.60 新增：**第二族字符类** —— 展示归并用（`GROUP_DECOR`），比 `SYMBOLS` **窄得多**
 *
 * 【为什么不能直接复用 SYMBOLS】（用户 2026-10-12 报的现场）
 *   搜索联想里「古惑狼™ 4：时机已到」与「古惑狼4：时机已到」被当成**两款游戏**，
 *   各占一行 —— 它们是同一款（机地一条、XDGAME 一条），只差一个商标号 `™`。
 *   根因是前端 `smKeyOf()` **自写了一份归一化**（只 `replace(/\s+/g,'')`，不剥任何符号），
 *   而 `SYMBOLS` 早在 v10.36 就含 `™®©` —— 那份自写实现把真源漏掉了。
 *
 *   但**直接把 SYMBOLS 搬来做归并键是错的**：SYMBOLS 是给**匹配**用的，剥光标点之后
 *   还有第二道闸门兜住假阳性（`sameGame` 的包含匹配护栏 + `numMismatchByTitle` 的代际
 *   数字闸）—— 而「同款归并展示」**没有第二道闸**：键相等就直接并成一行，并错了
 *   就是把两款不同游戏合成一行，界面上完全看不出来（PITFALLS 铁律 17 的同型）。
 *
 *   ★ 实测（全库 19,465 条，2026-10-12 逐组人工核验）：
 *     用 `SYMBOLS` 会新并 **20 组**，其中 **2 组是假并** ——
 *       · `空中骑士：永不屈服/Aerial_Knight's We Never Yield`（续作）与
 *         `空中骑士永不屈服/Aerial_Knight's Never Yield`（前作）—— 只差一个 `：`
 *       · `他们来了/It Reaches` 与 `他们来了！/They Are Coming!` —— 只差一个 `！`
 *     用本窄类只新并 **3 组**，**逐组核验全为真同款、0 假并**：
 *       · `NBA 2K27` ↔ `《NBA 2K27》`
 *       · `瓦格鲁斯 - 万壑之地` ↔ `《瓦格鲁斯 - 万壑之地》`
 *       · `古惑狼4：时机已到` ↔ `古惑狼™ 4：时机已到`   ← 用户报的那一组
 *
 *  ⇒ 只剥「在**任何语境下都不改变游戏名语义**」的三类：
 *      ① **商标号** `™ ® ©`（用户原话「部分标签或者符号」，指的正是这一类）
 *      ② **书名号 / 引号包裹** `《》〈〉「」『』【】`（机地话题标题的**外层装饰**：
 *         `《NBA 2K27》` 与 `NBA 2K27` 是同一款）
 *      ③ **中点分隔** `· ・ •`（`真・三国无双` 与 `真三国无双` 同款）
 *    而 `： : ！ ! — - ～ ~` 等**一律保留** —— 它们在游戏名里是**实义分隔符**，
 *    且实测正是假并的来源。
 *
 *  ★ 两族的关系：`SYMBOLS ⊃ GROUP_DECOR`（窄类是宽类的子集，本文件末尾有断言式注释）。
 *    新增符号时**必须先想清楚它属于哪一族**：拿不准就**只加进 SYMBOLS**（匹配那道有闸门兜着，
 *    归并这道没有）。★ `tools/test-v1060.js` 会断言「有闸门的那族是**超集**」以防后人加反。
 * ──────────────────────────────────────────────────────────────────────────── */
const GROUP_DECOR = /[™®©《》〈〉「」『』【】·・•]/g;

/** 展示归并键（窄类）：小写 → 去空白 → 只剥 `GROUP_DECOR`。
 *  ⚠️ 只用于「同款归并成一行」这种**没有第二道闸门**的场合。 */
function decorKey(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(GROUP_DECOR, '');
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

/* ────────────────────────────────────────────────────────────────────────────
 * ★ v10.58 新增：**模组标题的显示层清洗**（cleanModTitle）
 *
 * 【为什么需要】
 *   `tools/fetch-mods.js` 落盘的 `title` 是**源站帖标题原样**（零清洗，第 103 行
 *   `title: s.title`），而机地帖标题是玩家写给搜索引擎看的。实测脏点（全库 8,943 条）：
 *     含年份（2024-2026）746 条 · 【】/[] 分类前缀 1,600 条 · 整合包/合集 174 条 ·
 *     含「最新」24 条 · 含「附…教程/安装」6 条。
 *   最糟的一条：「潜水员戴夫2026最新全DLC 附修改器安装mod新手教程」
 *     = 游戏名重复（卡片行首已有游戏名）+ 年份 + DLC + 「附教程」四层尾巴。
 *
 * 【为什么只洗显示层、不改数据】
 *   原始标题是对得上源站的**凭据**（用户拿它去机地能搜到同一条帖）。
 *   ⇒ 数据里的 `title` 一个字不动；只在返回层派生 `dtitle` 供界面显示，
 *     原始标题继续挂在悬浮提示（`title=""`）与原贴弹窗里。
 *   ⚠️ 这是一条**新加的输出通道**，不是「两份标题」—— `title` 仍是唯一事实，
 *      `dtitle` 是它的派生视图（同 `displayName`/`enName` 与 `title` 的关系）。
 *
 * 【为什么是「保守档」】
 *   只砍**确定性高**的四类，绝不碰任何可能是模组本名的字：
 *     ① 开头的【…】/[…] 分类前缀（`【前置文件】BepInEx` → `BepInEx`）
 *     ② 重复的游戏名（标题以 game 任一段开头时剥掉 —— game 可能是 `辐射4/Fallout 4` 拼接串）
 *     ③ 尾部营销话术（最新 / 整合包 / 解压即玩 / 免安装 / 附…教程）
 *     ④ 洗完之后残留的多余空白与首尾分隔符
 *   ★ 洗空了就**回退原值** —— 宁可显示脏标题，也不显示空白
 *     （`s.replace(非文字,'').length < 2` 即判空 ⇒ 覆盖 `【前置文件】` 这种整条都是前缀的极端情况）。
 *   ★★ v10.58 修：**只有「长度护栏」不够，还要「信息量护栏」** ——
 *     实测踩到的现场：`潜水员戴夫2026最新全DLC 附修改器安装mod新手教程`（29 字）
 *     被洗成 **`mod`**（3 字）。它不是空串，长度护栏放行，但用户看到「mod」完全不知道是什么，
 *     **比原样的脏标题更糟**。⇒ 加「剩余长度 < 原文 35%」即回退。
 *     同为干净结果的对照：`1.01 Mod整合包` → `1.01 Mod`（8/11 = 73%，保留版本+类型，合理）。
 *   ★ 只削开头的**孤立括号**（去括号留内容）：`潜水员戴夫(风灵月影) 2026-06-19版本` 剥掉游戏名后
 *     剩 `(风灵月影) 2026-06-19版本` —— 那对括号原本是修饰游戏名的，游戏名没了它就失去依托。
 *     ⇒ 变成 `风灵月影 2026-06-19版本`。**只在真的剥过游戏名时才做**（否则会动到
 *     `(新) 某某Mod` 这类本来就以括号开头的正常标题）。
 *   ★ 不动「修改器 / (风灵月影) / v1.0」这类**版本与作者信息** —— 那是选哪个包的依据。
 * ──────────────────────────────────────────────────────────────────────────── */
const MT_PREFIX = /^[【\[（(][^】\]）)]{1,14}[】\]）)]\s*/;
const MT_NOISE = /(?:20\d{2}\s*年?)?最新(?:全)?(?:版|DLC|整合|完整版)?|解压即玩|一键安装|免安装版?|附[^，。；;]{0,16}?(?:教程|说明|安装)|安装(?:教程|方法|说明)|新手教程|整合包|合集包?/g;

function cleanModTitle(title, game) {
  const raw = String(title == null ? '' : title).trim();
  if (!raw) return '';
  let s = raw.replace(MT_PREFIX, '').replace(MT_NOISE, ' ');
  /* 游戏名去重：game 可能是 `/` 拼接串，**长段优先**（`Fallout 4` 比 `辐射4` 更可能出现在英文标题里） */
  const segs = String(game == null ? '' : game).split('/')
    .map((x) => x.trim()).filter((x) => x.length >= 2)
    .sort((a, b) => b.length - a.length);
  let stripped = false;
  for (const g of segs) {
    if (s.startsWith(g)) { s = s.slice(g.length); stripped = true; break; }
  }
  if (stripped) s = s.replace(/^[\s:：\-–—_·]+/, '').replace(/^[（(]\s*([^）)]{1,20}?)\s*[）)](?=\s|$)/, '$1 ');
  s = s.replace(/[\s\u3000]{2,}/g, ' ')
    .replace(/^[\s:：\-–—_·|｜/／]+/, '')
    .replace(/[\s:：\-–—_·|｜/／]+$/, '')
    .trim();
  if (s.replace(/[\s\-–—_·|｜/／]+/g, '').length < 2) return raw;   // 洗空
  if (s.length < raw.length * 0.35) return raw;                    // 洗到没信息量
  return s;
}

module.exports = { normKey, SYMBOLS, tailNums, titleNums, genNums, numMismatchByTitle, cleanModTitle, GROUP_DECOR, decorKey };
