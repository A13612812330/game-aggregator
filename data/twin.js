/**
 * data/twin.js — 跨源「孪生条目」解析（v10.23 新增）
 *
 * ─────────────────────────────────────────────────────────────
 * ★ 这个模块为什么必须存在（v10.22 遗留的真 bug）
 *
 * 用户口径：「机地找同名 ↗ 我的要求是直接链接到游戏详情页，现在连按钮都点击不了」。
 *
 * 查下来是**两个 bug 叠加**：
 *
 *   ① **取数错路**：详情页的「另一源也有收录 / 跨源跳转」原先走
 *      `GET /api/library?q=<中文名>` 再在前端 `sameGame()` 过滤 —— 也就是
 *      **纯名称模糊匹配**。可 v10.22 之后机地全量话题（17,220 条）里
 *      13,448 条已经**合并进 XD 条目**（机地侧信息挂在 `jidiUrl` / `jidiId` 上），
 *      库里独立的 `source:'jidi'` 条目只剩 3,609 条。
 *      实测：15,352 条 XD 记录里，按名字检索只有 **535 条（3.5%）** 命中 ——
 *      其余 13,282 条**库里明明带着 `jidiUrl`，却没被用上**。
 *   ② **CSS 覆盖 hidden**：按钮 `<a id="crossGo" hidden>` 而 `.go{display:flex}`，
 *      作者样式表的 `display` 压过 UA 的 `[hidden]{display:none}` ⇒
 *      按钮**该藏没藏**，变成一个 `href` 为空的死按钮 —— 用户「点击不了」的观感来源。
 *
 * 本模块负责 ①。修法是把跨源对齐从「按名字猜」换成**按精确键取**：
 *
 *   · XD → 机地：条目自带 `jidiUrl`（`/topic/detail/<tid>`），而 `<tid>` 就是
 *     `data/jidi-topics.json` 里那条话题的 `tid`（v10.23 逐一对照确认）
 *     ⇒ 一次 Map 查询拿到机地**详情页 URL + 真实标题/封面/评分/容量/类型**。
 *   · 机地 → XD：用 `jidiId` 反查（XD 条目里存着它对应的机地 id）。
 *   · 两者都无 → 才退回名称匹配，且**必须过 `sameGame()` 的防误配闸门**。
 *
 * ★ 为什么名称匹配要搬到这里（而不是留在前端）
 *   同一个语义（「两个标题是不是同一款」）只能有一份实现（项目铁律 10）。
 *   原先它长在 `public/index.html` 里，而现在两侧都要用（后端取数 + 前端列表），
 *   所以收到后端；前端改为只调 `/api/library/twin`，不再自己判。
 *
 * ★ 刻意不做的事
 *   · 不因为「名字像」就把两条不相干的记录认成同款 —— 宁可返回 null（按钮不显示），
 *     也不给用户一个跳过去找不到的按钮。`sameGame()` 的闸门原样保留，见下方注释。
 *   · 不编造字段：机地话题库里没有的（如 `size`）就留空，由前端如实显示。
 */
const gamesDb = require('./gamesDb');
const jiditopics = require('./jiditopics');
const { decorKey } = require('./name-normalize');
const { ts2label } = require('../shared');

/* ── 标题归一化 ─────────────────────────────────────────────── */

/** 拆分 `中文名/English Name` → { zh, en }（与前端同名函数逐字一致） */
function splitName(title) {
  const s = String(title || '').trim();
  const i = s.indexOf('/');
  if (i > 0) return { zh: s.slice(0, i).trim(), en: s.slice(i + 1).trim() };
  return { zh: s, en: '' };
}

/** ★ v10.60：**展示归并键** —— 「同一款游戏被拆成多行」时归并成一行用的键。
 *
 *  语义 = 标题**中文段**（`splitName().zh`，与 `sameGame` 同一口径）的窄类归一化
 *  （只剥商标号 / 书名号 / 中点，见 `name-normalize.js` 的 `GROUP_DECOR`）。
 *
 *  ★ 为什么键由**服务端**下发（`/api/library` 等接口的 `nkey` 字段）：
 *    归一化只允许有一份实现。前端此前**自写了一份** `smKeyOf()`（只去空白、不剥符号），
 *    正是它把库内「古惑狼™ 4：时机已到」与 XDGAME「古惑狼4：时机已到」拆成了两行
 *    —— 用户 2026-10-12 报的现场。与 `tools/test-twin.js` 那条
 *    「★ 前端不再自带 sameGame（同一语义只留后端一份）」同一条规矩。
 *
 *  ⚠️ 本键**只用于展示归并**，不可拿去当匹配判据：它没有第二道闸门，
 *     `：`/`！` 这类实义分隔符被刻意保留（详见 `GROUP_DECOR` 的实测账）。
 *
 *  ★ v10.61：入参放宽为**字符串或条目对象**（取 `title`）。为什么不改成只吃对象 ——
 *    `tools/test-v1060.js` 有一整段（B1~B5）按**字符串**钉死本函数的行为，是窄类
 *    假并账的唯一守卫；放宽入参两者都照顾到，不必动那些断言。
 *  ⚠️ 但它只是**单条**的名称键。要下发前端的归并键请用 `groupKeys()`（见下）。
 */
function groupKey(input) {
  const g = (typeof input === 'string' || input == null) ? { title: input } : input;
  return decorKey(splitName(g && g.title).zh);
}

/* ────────────────────────────────────────────────────────────────────────────
 * ★ v10.61 新增：**两级归并键**（`groupKeys`）—— 用户 2026-10-12 报的第二例
 *
 * 【现场】搜「三国无双」出两行：机地 `真・三国无双 起源` 与 XD `真三国无双：起源`，
 *   用户问「为什么会有区分开，这是同个游戏」。硬证据是 **Steam AppID 都是 2384580**。
 *
 * 【为什么 v10.60 的名称键兜不住】两道兜底各漏一半：
 *   ① 数据层：XD 条目匹配到机地后会把机地信息挂在自己身上（`jidiId`，已 13,448 条），
 *      机地那条便不再独立存在 —— 但这组**没匹配上**，机地那条成了独立条目；
 *   ② 展示层：名称键 `decorKey` 只剥商标号/书名号/中点，**刻意保留 `：`**
 *      （加宽会假并，v10.60 有实测账）⇒ `真三国无双起源` ≠ `真三国无双：起源` ⇒ 不并。
 *   实测全库：同 AppID 的跨源双条 **154 组**，其中 103 组名称键相等（会并）、
 *   **51 组不等**（显示两行）。用户报的这组是 51 之一（且 `matchScore` 满分 100）。
 *
 * 【改法：AppID 当第二级判据】AppID 是 Steam 对「一款游戏」的唯一编号 ——
 *   同一 AppID 必是同款本体（DLC 各有自己的 AppID）⇒ 这条判据**结构上零假并**，
 *   正是名称键做不到的那一半。
 *
 * ★★ 为什么必须**批量**、不能像 `groupKey` 那样单条算
 *   「两边 AppID 相同」是一个**关系**，单条算不出来。实测踩到的反例就在用户自己报过的
 *   那一组上：`古惑狼™ 4：时机已到`（机地，自带 `appid`）与 `古惑狼4：时机已到`
 *   （XD，cover 是 `www.xdgame.com/uploads/…jpg`，**提不到 AppID**）——
 *   若键改成「AppID 优先」单条算，两条会分别得到 `app:1378990` 与 `古惑狼4：时机已到`，
 *   **刚修好的那组反而被拆回去**。批量 + 并查集才既能并上「两边都有 AppID」的，
 *   又不误伤「只有一边有」的（后者仍靠名称键，行为与 v10.60 完全一致）。
 *   ⇒ 并查集只做 union、从不 split：**不可能把原本能并的拆开**，只可能多并。
 *
 * ★★ 三道闸门（缺一条都会把两款不同游戏并成一行，而界面上完全看不出来）
 *   ① **AppID 必须相等**（不是「有一个 AppID 就行」）；
 *   ② **排除独立发行**：zh 段含 `虚拟机版`/`HYPERVISOR` 的不参与 AppID 合并
 *      —— 它要跑 hypervisor，是与本体**并列的另一份发行**，实测 135 条；
 *   ③ **名称闸门**：`matchScore ≥ 30` **或**双方 zh/en 四段归一化后有任何一对相等（≥3 字）。
 *      为什么非要有 ③：AppID 取自 `appid` 字段与 cover URL，**来源本身会脏**。
 *      实测（全库扫描，去掉 ③ 时新增 189 组合并）抓到 6 组假并 ——
 *      `-怀旧地下城-/UNDERGROUNDED` 被并进 `赛菲莉娅/Sephiria`、
 *      `巨城警察/Mega City Police` 并进 `超级城市力量/Mega City Force`、
 *      `杂货店模拟器` 并进 `超市模拟器`、`遨游中国2（CTS6 整合）` 并进 `欧洲卡车模拟2` ……
 *      逐组查是 **cover 挂了别的游戏的图** ⇒ 提取出错误 AppID。加上 ③ 后这 6 组全部挡住，
 *      而真同款的译名差异（`Obenseuer` ↔ `奥本瑟尔/Obenseuer`、`SpaceSlog` ↔ `太空漫游/SpaceSlog`）
 *      由 ③ 的「四段交叉相等」救回。
 *
 * ★ 实测效果（全库 19,465 条，2026-10-12 逐组人工核对）：分组数 18,368 → **18,282**，
 *   新增合并 **86 组**（跨源 32 / 同源 54），**32 组跨源逐组核验全为真同款、0 假并**；
 *   6 组假并嫌疑在加 ③ 后全部各自独立；用户报的 `2384580` 与已修好的古惑狼**都不回归**。
 * ──────────────────────────────────────────────────────────────────────────── */

/** Steam AppID：机地条目自带 `appid` 字段；XD 条目从 cover 的 `/steam/apps/<id>/` 提。
 *  ⚠️ cover 可能挂错图（见上面实测），所以本函数**只用来取候选**，成对判定必须再过 `mergeGate`。 */
const STEAM_COVER = /\/steam\/apps\/(\d+)\//;

function appIdOf(g) {
  if (!g) return '';
  const a = g.appid != null ? String(g.appid).trim() : '';
  if (a) return a;
  const m = STEAM_COVER.exec(String(g.cover || ''));
  return m ? m[1] : '';
}

/** 独立发行（不参与 AppID 合并）：`虚拟机版` / `HYPERVISOR`。
 *  ★ 只测 **zh 段** —— 机地把 `voices38` 一类写在英文段（`红色沙漠/Crimson Desert voices38`），
 *    那是同一份发行的标记，不该因此拒绝合并；而「虚拟机版」在 zh 段里（135 条里 127 条如此，
 *    另 8 条是 `…-虚拟机版/NEW MONOPOLY HYPERVISOR` 这种两段都有）。 */
const ALT_EDITION = /虚拟机版|hypervisor/i;

function isAltEdition(title) {
  return ALT_EDITION.test(splitName(title).zh);
}

/** 名称闸门：AppID 相等**之外**的第二道保险（防 cover 挂错造成的假并）。
 *  ① `matchScore ≥ 30`：沿用跨源配对的既有判据（中文段相等/包含，或英文段完全相等）
 *  ② 四段交叉相等：机地常把英文名整串当 zh 段（`Obenseuer`），而 XD 分中英两段
 *     （`奥本瑟尔/Obenseuer`）⇒ ① 的 `matchScore` 算不出来，靠这一条救回。
 *  ⚠️ 长度护栏 ≥3：挡住 `AB`/`X` 这类短串互撞（与 `sameGame` 的护栏同口径）。 */
function mergeGate(a, b) {
  const A = String(a || '');
  const B = String(b || '');
  if (!A || !B) return false;
  if (matchScore(A, B) >= TWIN_MIN_SCORE) return true;
  const sa = splitName(A);
  const sb = splitName(B);
  const A4 = [normTitle(sa.zh), normTitle(sa.en)];
  const B4 = [normTitle(sb.zh), normTitle(sb.en)];
  for (const x of A4) for (const y of B4) { if (x && y && x.length >= 3 && x === y) return true; }
  return false;
}

/** ★ 批量归并键（服务端下发前端的 `nkey` 由它算）。
 *
 *  @param {Array} items 同一批要展示的条目（搜索结果的一桶，≤30 条）
 *  @returns {Array<string>} 与 `items` **等长同序**的键；组内所有条目键相同。
 *
 *  代表键 = 组内**首个**能给出名称键的那条的键 —— 用名称键而非 `app:<id>` 当代表，
 *  是为了让前端主行/调试时的键保持「人能看懂」；前端只比较相等性，不解析内容。
 */
function groupKeys(items) {
  const arr = Array.isArray(items) ? items : [];
  const n = arr.length;
  const nameKeys = arr.map((x) => groupKey(x));
  if (n < 2) return nameKeys;
  const parent = arr.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };
  const byName = new Map();
  const byApp = new Map();
  arr.forEach((x, i) => {
    const k = nameKeys[i];
    if (k) { if (byName.has(k)) union(i, byName.get(k)); else byName.set(k, i); }
    const a = appIdOf(x);
    if (a && !isAltEdition(x && x.title)) {
      if (!byApp.has(a)) byApp.set(a, []);
      byApp.get(a).push(i);
    }
  });
  for (const idxs of byApp.values()) {
    for (let p = 0; p < idxs.length; p++) {
      for (let q = p + 1; q < idxs.length; q++) {
        const ia = idxs[p];
        const ib = idxs[q];
        if (mergeGate(arr[ia] && arr[ia].title, arr[ib] && arr[ib].title)) union(ia, ib);
      }
    }
  }
  const rep = new Map();
  arr.forEach((x, i) => { const r = find(i); if (!rep.has(r) && nameKeys[i]) rep.set(r, nameKeys[i]); });
  /* 代表键取不到（整组标题都空）时退回自己的名称键 —— 宁可少并，也不给**空键**
     （空键会让前端把所有条目并成一行，比不并更糟）。 */
  return nameKeys.map((k, i) => rep.get(find(i)) || k || '');
}

/** 反过来拼：{ zh, en } → `中文名/English Name`（前端 splitName 的逆） */
function joinTitle(zh, en) {
  const a = String(zh || '').trim();
  const b = String(en || '').trim().replace(/™|®/g, '').trim();
  if (!a) return b;
  if (!b || a.toLowerCase() === b.toLowerCase()) return a;
  return `${a}/${b}`;
}

/**
 * 标题归一化：版本词收敛 + 去标点空白。
 *
 * 两源命名习惯不同（机地「生化危机4**重置版**」vs XD「生化危机4**：**重制版」），
 * 直接比原文匹配率极低，所以先把版本词都收敛成「重制版」再反复剥掉，
 * 最后去掉全部标点空白。
 */
function normTitle(s) {
  let x = String(s || '').toLowerCase();
  x = x.replace(/重置版|重製版|重制版|重置/gi, '重制版');
  const junk = /高清版|终极版|决定版|完全版|豪华版|年度版|中文版|重制版|remastered|definitive|ultimate|deluxe|complete|remake|(^|[^a-z])hd([^a-z]|$)/gi;
  let prev;
  do { prev = x; x = x.replace(junk, '$1$2'); } while (x !== prev);   // 反复剥（「终极高清版」要剥两次）
  return x.replace(/[\s\u3000·・:：\-–—_/／|｜,，.。!！?？'"“”‘’()（）\[\]【】《》<>~～+*&]+/g, '');
}

/**
 * 两源标题是否同一款（★ 带防误配闸门，逐字沿用前端实现）
 *
 * 闸门：两边**都有**中文段却不相等时，**不退到英文段** ——
 * 否则「古墓丽影：崛起」和「古墓丽影：暗影」会因共享英文前缀 Temple Raider 而互认。
 */
function sameGame(a, b) {
  const A = splitName(a);
  const B = splitName(b);
  const zhA = normTitle(A.zh);
  const zhB = normTitle(B.zh);
  if (zhA && zhB) {
    if (zhA === zhB) return true;
    /* 包含匹配（「生化危机4重制版」⊃「生化危机4」）—— 两边都要够长，否则短名会吸走一堆 */
    if (zhA.length >= 3 && zhB.length >= 3 && (zhA.includes(zhB) || zhB.includes(zhA))) return true;
    return false;
  }
  const enA = normTitle(A.en);
  const enB = normTitle(B.en);
  return !!(enA && enB && enA === enB);
}

/**
 * 同款判定打分（★ v10.23：为什么不能「取第一条命中的」）
 *
 * `sameGame()` 是「能不能算同款」的**闸门**；但候选往往不止一条，
 * 而包含匹配会把同系列的版本差异放进来。实测真错配：
 *
 *   机地「侠盗猎车手5/Grand Theft Auto V Enhanced」
 *   XD 库里同时有「侠盗猎车手5 增强版 / GTA5增强版 / Grand Theft Auto V Enhanced」
 *              和「侠盗猎车手5 传承版 / GTA5传承版 / Grand Theft Auto V Legacy」
 *
 * 三条的中文段都构成包含（「侠盗猎车手5」⊂「…传承版」），
 * 取首条就会配到「传承版」（另一个 Steam 条目）—— 用户点过去是另一款游戏。
 * ⇒ 改成对全部候选打分取最高：
 *     中文段完全相等 +100 / 中文段包含 +30 / 英文段完全相等 +80 / 英文段包含 +20
 *   上面那例的「增强版」因英文段也包含而胜出（30+20 > 30）。
 *   ★ 英文段的 `™` 与弯引号不被 normTitle 清洗，所以「红色警戒2」靠英文段
 *     相等是配不上的 —— 它由中文段包含（30 分）兜住，与改前一致。
 *
 * ⚠️ 写这段注释时踩到：行内的 `**加粗**` 紧跟斜杠会拼出 `*` `/` 把注释块**提前闭合**，
 *   后面的中文被当成代码，报 `Unexpected identifier`。中文注释里别让加粗直接贴斜杠。
 */
function matchScore(aTitle, bTitle) {
  const A = splitName(aTitle);
  const B = splitName(bTitle);
  return scoreOf(normTitle(A.zh), normTitle(A.en), normTitle(B.zh), normTitle(B.en));
}

/** 打分核心（接收**已归一化**的四段，供扫描时复用预存值，避免重复清洗） */
function scoreOf(az, ae, bz, be) {
  let zhScore = 0;
  let enScore = 0;
  if (az && bz) {
    if (az === bz) zhScore = 100;
    else if (az.length >= 3 && bz.length >= 3 && (az.includes(bz) || bz.includes(az))) zhScore = 30;
  }
  if (ae && be) {
    if (ae === be) enScore = 80;
    else if (ae.length >= 4 && be.length >= 4 && (ae.includes(be) || be.includes(ae))) enScore = 20;
  }
  /* ★ 英文段「一票否决」：两边都有英文段却互不匹配时，只认中文段**完全相等**。
     没有这一条时，中文段包含关系会把同系列的版本差异放进来 ——
     实测 XD「侠盗猎车手5传承版（…Legacy）」会被配到机地「…V Enhanced」，
     而 Legacy 与 Enhanced 在 Steam 上是**两个 appid / 两条独立记录**。
     加上后：中文段完全相等（100）照常放行；中文段只是包含的一律不给分。 */
  if (ae && be && enScore === 0 && zhScore !== 100) return 0;
  return zhScore + enScore;
}

/** 算作同款的最低分：至少中文段相等/包含（30），或英文段完全相等（80） */
const TWIN_MIN_SCORE = 30;

/* ── 精确键索引 ─────────────────────────────────────────────── */

/** 从 `https://jidiyouxi.com/topic/detail/338824746` 抠出 `338824746` */
function tidOf(url) {
  const m = /\/topic\/detail\/(\d+)/i.exec(String(url || ''));
  return m ? m[1] : '';
}

const JIDI_URL_OF = (tid) => `https://jidiyouxi.com/topic/detail/${tid}`;

/** `jidiId` → XD 条目（懒构建，按库内条目总数失效：增量 upsert 会改变总数） */
let _byJidiId = null;
let _byJidiIdKey = '';

function jidiIdIndex() {
  const all = gamesDb.all();
  const key = String(all.length);
  if (_byJidiId && _byJidiIdKey === key) return _byJidiId;
  const m = new Map();
  for (const g of all) {
    if (g && g.source !== 'jidi' && g.jidiId) m.set(g.jidiId, g);
  }
  _byJidiId = m;
  _byJidiIdKey = key;
  return m;
}

/** 名称索引：归一化中文名 → 条目（精确键 Map + 预算好归一值的 list 供扫描兜底）
 *
 *  ★ 为什么既要 Map 又要 list
 *    Map 只能命中「归一化后完全相等」。而两源命名差异经常是**包含关系**：
 *      机地「红色警戒2」  ↔ XD「命令与征服：红色警戒 2 及尤里的复仇」
 *      机地「侠盗猎车手5」↔ XD「侠盗猎车手5增强版」
 *    这类必须靠 `sameGame()` 的包含匹配（两边 ≥3 字）才认得出来，
 *    所以精确键落空时还要能扫一遍。归一值预先算好存进 list，
 *    扫描时只做字符串比较，不必每次重新 splitName + 正则清洗。 */
let _byName = null;
let _byNameKey = '';

function nameIndex() {
  const all = gamesDb.all();
  const key = String(all.length);
  if (_byName && _byNameKey === key) return _byName;
  const build = (onlyJidi) => {
    const list = [];
    const map = new Map();
    for (const g of all) {
      if (!g || !g.title) continue;
      if (onlyJidi !== (g.source === 'jidi')) continue;
      const n = splitName(g.title);
      const zhN = normTitle(n.zh);
      const enN = normTitle(n.en);
      const rec = { g, zhN, enN };
      list.push(rec);
      if (zhN && !map.has(zhN)) map.set(zhN, rec);
      /* 英文段也建键：机地「WheelMates (双轮成行)」对 XD「双轮成行」时，
         靠英文段相等/包含比中文段更可靠。 */
      if (enN && !map.has(enN)) map.set(enN, rec);
    }
    return { list, map };
  };
  _byName = { jidi: build(true), xd: build(false) };
  _byNameKey = key;
  return _byName;
}

/* ── 主入口 ─────────────────────────────────────────────────── */

/** 从机地话题条目（jidi-topics.json 的一条）造 twin */
function fromTopic(topic, fallbackTitle, via) {
  const tid = String(topic && topic.tid != null ? topic.tid : '').trim();
  if (!tid) return null;
  const url = topic.url || JIDI_URL_OF(tid);
  if (!/\/topic\/detail\/\d+/i.test(url)) return null;   // 形态校验：必须是详情页
  return {
    source: 'jidi',
    id: 'jidi-' + tid,
    url,
    title: joinTitle(topic.title, topic.titleEn) || String(fallbackTitle || ''),
    titleZh: topic.title || '',
    titleEn: topic.titleEn || '',
    cover: topic.cover || '',
    score: typeof topic.score === 'number' ? topic.score : null,
    size: topic.size || '',
    genres: Array.isArray(topic.genres) ? topic.genres.slice(0, 4) : [],
    dateLabel: topic.updatedAt ? (ts2label(topic.updatedAt) || '') : '',
    hot: Number(topic.dpv) || 0,
    via,
  };
}

/** 从库内条目造 twin */
function fromLibItem(it, via) {
  if (!it || !it.url) return null;
  if (!/\/(topic\/detail|game)\/\d+/i.test(String(it.url))) return null;   // 形态校验
  const n = splitName(it.title);
  return {
    source: it.source === 'jidi' ? 'jidi' : 'xdgamer',
    id: it.id || '',
    url: it.url,
    title: it.title || '',
    titleZh: n.zh,
    titleEn: n.en,
    cover: it.cover || '',
    score: typeof it.score === 'number' ? it.score : null,
    size: it.size || '',
    genres: Array.isArray(it.genres) ? it.genres.slice(0, 4) : [],
    dateLabel: it.dateLabel || '',
    hot: Number(it.hot) || 0,
    via,
  };
}

/**
 * 解析「这款游戏在另一源的详情页」。
 *
 * @param {object} o
 * @param {string} [o.id]     当前条目在本地库的 id（如 `xd-8149` / `jidi-3278693`）
 * @param {string} [o.title]  当前标题（库内 id 取不到时的兜底线索）
 * @param {string} [o.src]    当前源（'jidi' | 'xdgamer'），同上
 * @returns {object|null}     twin（**只保证带可跳的详情页**）/ null（另一源确实没有 → 前端不显示按钮）
 */
function twinOf({ id = '', title = '', src = '' } = {}) {
  const it = id ? gamesDb.byIdGet(String(id).trim()) : null;
  const curSrc = (it && it.source) || (src === 'jidi' ? 'jidi' : (src ? 'xdgamer' : ''));
  const curTitle = (it && it.title) || String(title || '');

  /* ① 精确键：当前是 XD 且合并过机地同款 → 直接给机地详情页
   *    ★ 这是覆盖率的主路径（13,448 条），也是「机地详情页其实早就抓到了」的证据。 */
  if (it && it.source !== 'jidi' && it.jidiUrl) {
    const tid = tidOf(it.jidiUrl);
    if (tid) {
      const topic = jiditopics.byTid(tid);
      const t = topic
        ? fromTopic(topic, curTitle, 'jidiUrl+tid')
        : fromLibItem({ source: 'jidi', id: 'jidi-' + tid, url: it.jidiUrl, title: curTitle }, 'jidiUrl');
      if (t) return t;
    }
  }

  /* ② 精确键：当前是机地 → 用 jidiId 反查 XD 条目 */
  if (curSrc === 'jidi' && it && it.id) {
    const x = jidiIdIndex().get(it.id);
    if (x) {
      const t = fromLibItem(x, 'jidiId');
      if (t) return t;
    }
  }

  /* ③ 名称兜底（带防误配闸门）—— 只在精确键缺失时走
   *
   *   检索词三轮降级（与 v10.14 前端实现同口径）：整名 → 剥版本词 → 剥标点。
   *   最终是否算同款仍由 `sameGame()` 把关 —— 放宽的只是**检索范围**。
   *   ★ v10.23 修：原先只查「归一化后完全相等」，会漏掉全部包含关系
   *     （红色警戒2 / 侠盗猎车手5 / WheelMates 都是这样漏的）；
   *     现在精确键落空后扫一遍候选池，并优先返回「归一后完全相等」的那条
   *     —— 不取 `find()` 首条，否则结果会随库内顺序漂移。 */
  const n0 = splitName(curTitle);
  const zh = n0.zh;
  const en = n0.en;
  if (zh.length < 2 && en.length < 2) return null;
  const wantZh = normTitle(zh);
  const wantEn = normTitle(en);
  const idx = nameIndex();
  const bag = curSrc === 'jidi' ? idx.xd : idx.jidi;

  const direct = (wantZh && bag.map.get(wantZh)) || (wantEn && bag.map.get(wantEn)) || null;
  if (direct && /\/(topic\/detail|game)\/\d+/i.test(String(direct.g.url || ''))) {
    return fromLibItem(direct.g, 'name');
  }

  let best = null;
  let bestScore = 0;
  for (const rec of bag.list) {
    const sc = scoreOf(wantZh, wantEn, rec.zhN, rec.enN);
    if (sc > bestScore) { bestScore = sc; best = rec.g; }
  }
  return (best && bestScore >= TWIN_MIN_SCORE) ? fromLibItem(best, 'name') : null;
}

module.exports = { twinOf, sameGame, matchScore, normTitle, splitName, joinTitle, tidOf, TWIN_MIN_SCORE, groupKey, groupKeys, appIdOf, isAltEdition, mergeGate };
