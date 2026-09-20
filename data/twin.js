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
const { ts2label } = require('../shared');

/* ── 标题归一化 ─────────────────────────────────────────────── */

/** 拆分 `中文名/English Name` → { zh, en }（与前端同名函数逐字一致） */
function splitName(title) {
  const s = String(title || '').trim();
  const i = s.indexOf('/');
  if (i > 0) return { zh: s.slice(0, i).trim(), en: s.slice(i + 1).trim() };
  return { zh: s, en: '' };
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

module.exports = { twinOf, sameGame, matchScore, normTitle, splitName, joinTitle, tidOf, TWIN_MIN_SCORE };
