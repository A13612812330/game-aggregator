/**
 * data/res-groups.js — 端游资源「按游戏聚合」索引（v10.47）
 *
 * ── 为什么需要这一层（用户口径）────────────────────────────────────────────
 * 「MOD 按游戏做卡片而不是按 MOD」+「存档只展示真有存档的而不是存档位置的」+
 * 「（修改器）同样按游戏聚合」。
 * 原来三个分区各是「一卡一条」，条数从几千涨到两万多之后，列表已经没有可读性：
 * 实测 MOD 7,825 条只对应 362 款游戏，最大一组 717 条（赛博朋克2077）——
 * 用户「按游戏做卡片」的判断被数据证实。本模块把 5 路来源**按游戏**收成一组一组。
 *
 * ── 四路来源（互不替代，各自答不同问题）──────────────────────────────────
 *   src=mod  机地社区帖 MOD          有网盘直链            → cat 'mod'
 *   src=yx   游侠补丁网存档文件      直链 + 网盘 + eD2K    → cat 'saves'
 *   src=gt   GTrainers 存档/修改器   **真实文件直链**      → cat 'saves' | 'trainers'
 *   src=gcm  GCM 元数据目录          **无下载链**（刻意）  → cat 'trainers'
 *
 * ★ v10.58：**五路已降为四路** —— `src=fr`（FearlessRevolution，原第 5 路、cat 'trainers'）**已摘除**。
 *   理由：整站在 CF managed challenge 后（只能有头浏览器 + 页面上下文 fetch）+ 阶段② 须一次跑完 ≈3.5h，
 *   而 **`data/fr.json` 从未产出 ⇒ 它一直贡献 0 条** ⇒ 摘掉零用户可见损失。
 *   完整 SOP（含参数标定、会话纪律、复活手册）：docs/sop/FR-fearlessrevolution-抓取SOP.md
 *   ⚠️ 历史注释里仍可能见到「三源合并（GCM + GTrainers + FR）」的旧口径 —— 那是当时记录，**不要据此再加回来**。
 *
 * ── 统一条目形状（前端只认这一种，不必知道来源差异）──────────────────────
 *   { src, cat, id, title, game, libId, libTitle, size, date, downloads,
 *     links: [{label, url, cls}],   ← 下载通道（0 ～ N 个）；空则只能点 page
 *     page,                          ← 源站页（兜底出口，永远有）
 *     note,                          ← 版本 / 口径附注
 *     ts }                           ← 排序用时间戳（各源口径不一，仅作组内排序）
 *
 * ── 分组键 ────────────────────────────────────────────────────────────────
 * 优先用 `libId`（端游库 id，唯一）。少数条目没有 libId（机地未关联的 MOD）⇒
 * 回落到**归一化游戏名**做键。两种键前缀不同（`L:` / `N:`）以免同名撞车。
 * ⚠️ 回调「按游戏名匹配」是抓取阶段做的（fetchers/*.js + data/mod-match.js），
 *    本模块只做**聚合**，不重新做匹配 —— 匹配口径必须只有一处（铁律 17）。
 */
'use strict';

const mods = require('./mods');
const savesYx = require('./savesYx');
const gt = require('./gtrainers');
/* ★ v10.58：`require('./fr')` 已摘除（见文件头四路来源说明 + docs/sop/FR-fearlessrevolution-抓取SOP.md） */
const gcm = require('./trainers');
const gamesDb = require('./gamesDb');
/* ★ v10.97：热度来源。端游资源页四个分区（本体/MOD/存档/修改器）统一按「热度」排序，
   而本聚合层原先**没有任何热度字段** —— 分组只有条数、条目只有下载量。
   热度的唯一口径取「机地话题浏览量 dpv」（`data/jidi-topics.json`，17,220 条全量库）：
   它是整站唯一一份**跨四个分区都能对上的游戏级热度**，本体分区本来就在用它排序。
   ⚠️ 只需要 libId → gamesDb.jidiId → tid 的一次查表；不做名称模糊匹配
      （跨源按名对齐在本项目是明令禁止的，见 PITFALLS 里的同名误配记录）。 */
const jidiTopics = require('./jiditopics');
const { normKey, cleanModTitle } = require('./name-normalize');
const { displayName, enName } = require('./game-name');
const { cleanPostText } = require('../shared');

/* 与资源页既有配色语义共用一份表（tools/resource-sections.js 的 RES_PAN_CLS 同源） */
const PAN_CLS = {
  '迅雷网盘': 'xunlei', '百度网盘': 'baidu', '夸克网盘': 'quark', '阿里云盘': 'ali',
  '天翼云盘': '189', '移动云盘': '139', '123网盘': '123', '蓝奏云': 'lanzou',
  'UC网盘': 'uc', 'Steam': 'steam', 'PikPak': 'pikpak',
  xunlei: 'xunlei', baidu: 'baidu', quark: 'quark', ali: 'ali', '189': '189',
  '139': '139', '123': '123', lanzou: 'lanzou', uc: 'uc', pikpak: 'pikpak',
};
const panCls = (k) => PAN_CLS[k] || 'other';

/* 来源展示名（前端徽标用；一处定义，避免前端再抄一份）
   ★ v10.58：`fr: 'FearlessRevolution'` 已摘除（连同 SRC_KEY.fr），见文件头说明。 */
const SRC_LABEL = { mod: '机地 MOD', yx: '游侠存档', gt: 'GTrainers', gcm: 'GCM 清单' };
/** 来源徽标配色类后缀（配合前端 .tg.src.<key>） */
const SRC_KEY = { mod: 'mod', yx: 'yx', gt: 'gt', gcm: 'gcm' };

const MOUNT = { mod: '#mods', saves: '#resSaves', trainers: '#resTrainers' };

/* ─────────────────────────── 归一化：五路 → 统一形状 ─────────────────────────── */

function fromMods() {
  const out = [];
  for (const x of mods.ensure().items || []) {
    if (x.kind !== 'mod') continue;
    const links = (x.links || [])
      .filter((l) => l && l.url && l.kind && l.kind !== '其他链接')
      .map((l) => ({ label: String(l.kind).replace(/网盘$/, ''), url: l.url, cls: panCls(l.kind) }));
    out.push({
      src: 'mod', cat: 'mod', id: String(x.id),
      title: x.title || '', game: x.game || '',
      /* ★ v10.58：显示用短名。**只机地帖需要**（标题是玩家写给搜索引擎看的），
         游侠/GT/GCM 三路的标题本来就是规范名，没有这一层 —— 规则本体见
         data/name-normalize.js#cleanModTitle（与 /api/mods/match 同一份，不各写一套）。 */
      dtitle: cleanModTitle(x.title, x.game) || undefined,
      libId: x.libId || '', libTitle: x.libTitle || '', cover: x.cover || '',
      size: '', date: '', downloads: x.pv || 0, links,
      page: x.url || ('https://52jidi.com/post/detail/' + x.id),
      note: x.author ? ('作者 ' + x.author) : '',
      ts: (x.ut || x.ct || 0) * 1000,
      /* ★ v10.50：这一条**有没有原贴正文可看** —— 前端据此决定是否给「原贴」入口。
       *   机地帖正文覆盖率实测 8,942/8,943 = 100%（抓取层已截断至 6000 字）。
       *   只在有时给 1（JSON 会丢掉 undefined）⇒ 不给每条都多背一个 false。 */
      hasPost: String(x.content || '').trim() ? 1 : undefined,
    });
  }
  return out;
}

function fromYx() {
  const out = [];
  for (const x of savesYx.ensure().items || []) {
    const f = x.files || {};
    const links = [];
    /* ★ 真直链排第一：它是唯一「点了就开始下」的通道（其余是网盘/电驴，需要客户端） */
    if (f.direct) links.push({ label: '直链', url: f.direct, cls: 'direct' });
    for (const nd of f.netdisk || []) {
      if (nd && nd.url) links.push({ label: String(nd.kind || '网盘'), url: nd.url, cls: panCls(nd.kind) });
    }
    if (f.thunder) links.push({ label: '迅雷', url: f.thunder, cls: 'xunlei' });
    if (f.ed2k) links.push({ label: 'eD2K', url: f.ed2k, cls: 'ed2k' });
    out.push({
      src: 'yx', cat: 'saves', id: String(x.id),
      title: x.title || '', game: x.game || '',
      libId: x.libId || '', libTitle: x.libTitle || '', cover: x.libCover || x.cover || '',
      size: x.sizeFile || x.size || '', date: x.date || '',
      downloads: 0, links,
      page: x.sourceUrl || '',
      /* 没有解析出文件时**不静默丢条**：留一条附注，前端显示「去源站下载」 */
      note: links.length ? (f.fileName || '') : ('未解析到直链' + (x.fileFailWhy ? '：' + x.fileFailWhy : '')),
      ts: x.date ? Date.parse(x.date) || 0 : 0,
      /* ★ v10.50：游侠补丁页的「简介 / 安装步骤 / 游戏截图」也能开原贴弹窗。
       *   实测 desc 2,043/2,043 = 100%，shots 1,172 条有图（57.4%）。
       * ★ v10.51：判据收进 `savesYx.hasPost()` —— 下载弹窗的存档行要问同一个问题，
       *   写两遍迟早漂（铁律 17）。 */
      hasPost: savesYx.hasPost(x),
    });
  }
  return out;
}

function fromGt() {
  const out = [];
  for (const x of gt.ensure().items || []) {
    const links = [];
    if (x.direct) links.push({ label: '直链', url: x.direct, cls: 'direct' });
    out.push({
      src: 'gt', cat: x.cat === 'trainers' ? 'trainers' : 'saves', id: String(x.id),
      title: x.title || '', game: x.game || '',
      libId: x.libId || '', libTitle: x.libTitle || '', cover: '',
      size: x.size || '', date: x.date || '',
      downloads: x.downloads || 0, links,
      page: x.sourceUrl || '',
      note: links.length ? '' : '直链未解析出，走源站',
      ts: 0,
    });
  }
  return out;
}

/* ★ v10.58：`fromFr()` 已摘除（FR 遗弃）。
   原实现：遍历 fr.ensure().items，把每个主题帖的 attachments 摊成 links（cls 'file'），
   一条 = 一个主题帖、note 标板块（CE 表 / Trainer）与附件数。
   ⇒ 将来要重做，照 docs/sop/FR-fearlessrevolution-抓取SOP.md 的「复活手册」恢复，别凭记忆重写。 */

function fromGcm() {
  const out = [];
  for (const x of gcm.ensure().items || []) {
    /* ★★ v10.48：补上「第三方修改器来源」的跳转链。
     *   用户口径：「修改器中的第三方修改器来源我也需要你提供跳转链接」。
     *   根因不在前端 —— 上游 `official_url` 一直有（实测 3,597/3,875 = 92.8%），
     *   本地缓存也有，是 tools/fetch-trainers.js 只挑了 11 个字段、把它丢了；
     *   而这里原先的 `page: x.libUrl` 指向**端游库的 xdgame 链接**（游戏详情），
     *   所以点过去根本不是修改器的来源站。
     *   ⚠️ 来源链 ≠ 下载链：显式打 `ch:'src'`，stats 才能把两者分开统计
     *      （否则「可下载占比」会被这 3,451 条充到 96%）。 */
    const links = [];
    if (x.officialUrl) {
      links.push({ label: x.siteLabel || '来源', url: x.officialUrl, cls: x.siteCls || 'src', ch: 'src' });
    }
    /* 行标题：优先**工具自己的名字**（「物品编辑器」「数据查询修改工具」）——
     * 一卡一游戏之后，卡内再重复游戏名等于每行都一样，22 条修改器分不出区别。
     * 其次是署名（同游戏的多个作者版本靠它区分），最后才回落游戏名。 */
    const tool = x.toolName ? (x.toolName + (x.version ? ' v' + x.version : '')) : '';
    const title = [tool, x.author].filter(Boolean).join(' · ') || (x.zh || x.name || '');
    out.push({
      src: 'gcm', cat: 'trainers', id: String(x.k || x.name || ''),
      title, game: x.zh || x.name || '',
      libId: x.libId || '', libTitle: x.libTitle || '', cover: x.libCover || '',
      size: '', date: '', downloads: 0,
      links,
      /* 没有 official_url 的那 6.3% **不给假链接**：统一指 GCM 库页，
       * 用户点过去至少能看到「这是什么、去哪找」。（GCM 官方下载走一次性
       * S3 签名 URL，依赖客户端密钥，不该也不能离线复现 —— 见 fetch 注释。） */
      page: x.officialUrl || 'https://gamezonelabs.com/products/gcm/trainers',
      note: x.version ? ('v ' + x.version) : '',
      /* 无下载链的 GCM 条目排在**同游戏内有下载链的条目之后**（note 排序靠 ts/downloads） */
      ts: 0,
    });
  }
  return out;
}

/* ─────────────────────────── 建索引（按文件 mtime 失效） ─────────────────────────── */

let cache = null;
let sig = '';

function filesSig() {
  const fs = require('fs');
  const path = require('path');
  const d = __dirname;
  return ['mods.json', 'saves-youxia.json', 'gtrainers.json', 'trainers.json', 'games.json']
    .map((f) => {
      try { return f + ':' + fs.statSync(path.join(d, f)).mtimeMs; } catch (e) { return f + ':x'; }
    }).join('|');
}

/** 名称键长度护栏：中文 ≥ 2 字 / 拉丁 ≥ 4 字符。
 *  为什么按字族分开：`length >= 3` 一刀切会把 `剑星` / `鸣潮` 这类 2 字中文名整类误杀
 *  （本项目在 cross-source-name-matching 里记过这条），而 `AC` / `FF` 这种 2 字符拉丁
 *  又确实是撞名高发区 —— 两个方向必须用两个阈值。 */
function nameKeyOk(k) {
  const s = String(k || '');
  const cjk = (s.match(/[\u3400-\u9fff]/g) || []).length;
  return cjk >= 2 || s.length >= 4;
}

function build() {
  const s = filesSig();
  if (cache && s === sig) return cache;

  const all = [].concat(fromMods(), fromYx(), fromGt(), fromGcm());

  /* 端游库 id → 展示名 / 封面（条目自带 libCover 优先，其次这里兜底） */
  let lib = new Map();
  try {
    gamesDb.load();
    lib = new Map((gamesDb.all() || []).map((g) => [g.id, g]));
  } catch (e) { /* 库没起来也不致命：只是没有封面兜底 */ }

  /* ★ v10.97：tid → 机地话题（热度 dpv / 体积）。话题库没落盘时**静默降级**为
     「只用组内条目下载量」——热度排序仍然可用，只是退化成「MOD 下载热度」口径。 */
  const topicByTid = new Map();
  /* 名称 → tid（**只收唯一键**）。为什么要这一层：端游库里 13,448 条有 jidiId，
     但实测热门组（剑星 / 泰拉瑞亚 / 消逝的光芒）的 XD 记录**没有 appid ⇒ 从来没被合并过**
     （sync-jidi-library 靠 appid 对齐，XD 分类页那条没有 appid）⇒ 直接按 id 查不到热度。
     兜底用**严格同名**：normKey 完全相等、且该名字在话题库里唯一（撞名记 'AMB' 丢弃）。
     ⚠️ 三条护栏缺一不可 —— 本项目被「按名匹配」坑过（ZTE Blade A73 → Samsung Galaxy A73）：
        ① 只做**完全相等**，不做包含/相似度；② 名字必须**唯一**；③ 键太短不认（见 nameKeyOk）。 */
  const topicByName = new Map();
  try {
    const d = jidiTopics.load();
    for (const t of (d.items || [])) {
      if (!t || t.tid == null) continue;
      const tid = String(t.tid);
      topicByTid.set(tid, t);
      for (const n of [t.title, t.titleEn]) {
        const k = normKey(n);
        if (!k || !nameKeyOk(k)) continue;
        const old = topicByName.get(k);
        if (old === undefined) topicByName.set(k, tid);
        else if (old !== tid) topicByName.set(k, 'AMB');
      }
    }
  } catch (e) { /* 同上：降级不报错 */ }

  const groups = new Map();      /* key → group */
  const byCat = { mod: [], saves: [], trainers: [] };
  /* ★ 预计算 (key, cat) → 条目数组。
   *   不这么做的话 groupItems() 每次都要全表 filter，而排序（sort=new）会对**每个组**
   *   调一次 ⇒ 362 组 × 7,825 条 = 280 万次比较，每个请求都跑一遍。
   *   Map 查表是 O(1)，这里多花几十 KB 换掉一个隐藏的 O(组 × 条)。 */
  const byKeyCat = new Map();    /* 'cat|key' → [items] */

  for (const it of all) {
    const g = lib.get(it.libId);
    if (g && !it.cover) it.cover = g.cover || '';
    const key = it.libId ? 'L:' + it.libId : (normKey(it.game || it.title) ? 'N:' + normKey(it.game || it.title) : '');
    if (!key) continue;   /* 连游戏名都没有的条目无法归组，跳过（进不来就不会静默消失：有 byCat 计数兜底） */
    let gr = groups.get(key);
    if (!gr) {
      /* ★ v10.50：库名的 `中文名/英文名/标签` 拆成**展示名 + 英文名**。
       *   原串（`game`）**照旧保留** —— 它是搜索/匹配/审计的原始口径，
       *   只是不再直接铺到卡面上（实测库内 16,248/19,430 款含 `/`，会把标题撑成 2~3 行）。
       *   拆分规则是唯一真源 `data/game-name.js`，本处不重复实现（铁律 17）。 */
      const rawName = (g && g.title) || it.game || it.libTitle || it.title || '?';
      gr = {
        key,
        libId: it.libId || '',
        game: rawName,
        name: displayName(rawName),
        nameEn: enName(rawName),
        libTitle: it.libTitle || (g && g.title) || '',
        cover: it.cover || '',
        n: 0, bySrc: {}, cats: {},
        /* ★ v10.97 卡面三项「重要信息」：体积 / 热度 /（count = 条数，下面累加）。
         *   · size    取端游库字段（19,250 / 19,732 有值），缺了再用机地话题的体积兜底
         *   · hotTopic 机地话题浏览量 dpv（游戏级热度）
         *   · hotDl    组内条目下载量之和（话题库覆盖不到时的**同分区**热度兜底）
         *   ⚠️ 三个字段一次算好挂在组上，别在排序比较函数里现算（那是 O(组×条)）。 */
        size: (g && g.size) || '',
        hotTopic: 0,
        hotDl: 0,
      };
      const jid = (g && g.jidiId) ? String(g.jidiId).replace(/^jidi-/, '') : '';
      let tp = jid ? topicByTid.get(jid) : null;
      /* ① 端游库自带 hot（sync-jidi-library 合并时写进来的 dpv）—— 最可信，先用它 */
      let hotTopic = Number(g && g.hot) || 0;
      if (!hotTopic && tp) hotTopic = Number(tp.dpv) || 0;
      /* ② 库记录没对上话题 ⇒ 严格同名兜一次（唯一 + 长度护栏，见上面 topicByName 的注释） */
      if (!hotTopic) {
        const nk = normKey(gr.name);
        const byName = (nk && nameKeyOk(nk)) ? topicByName.get(nk) : null;
        if (byName && byName !== 'AMB') {
          tp = topicByTid.get(byName) || null;
          if (tp) hotTopic = Number(tp.dpv) || 0;
        }
      }
      if (tp) {
        gr.hotTopic = hotTopic;
        if (!gr.size && tp.size) gr.size = String(tp.size);
      } else {
        gr.hotTopic = hotTopic;
      }
      groups.set(key, gr);
    }
    gr.n++;
    gr.hotDl += Number(it.downloads) || 0;
    gr.bySrc[it.src] = (gr.bySrc[it.src] || 0) + 1;
    gr.cats[it.cat] = (gr.cats[it.cat] || 0) + 1;
    if (!gr.cover && it.cover) gr.cover = it.cover;
    it._g = key; it._i = gr.n;
    if (byCat[it.cat]) byCat[it.cat].push(it);
    const kc = it.cat + '|' + key;
    const bucket = byKeyCat.get(kc);
    if (bucket) bucket.push(it); else byKeyCat.set(kc, [it]);
  }

  /* 组内排序：有下载通道的在前 → 下载数高的在前 → 新的在前 */
  const cmp = (a, b) => (!!(b.links && b.links.length) - !!(a.links && a.links.length))
    || (b.downloads || 0) - (a.downloads || 0)
    || (b.ts || 0) - (a.ts || 0);
  for (const arr of Object.values(byCat)) arr.sort(cmp);

  const gByCat = { mod: [], saves: [], trainers: [] };
  for (const gr of groups.values()) {
    for (const c of Object.keys(gByCat)) {
      if (gr.cats[c]) gByCat[c].push({ key: gr.key, cat: c, n: gr.cats[c] });
    }
  }

  /* ★ v10.53：三个分区各自的「有资源的端游库 id」集合 —— 首页/搜索**筛选用**的 O(1) 命中表。
   *   为什么要它：原来的「🛠 有修改器 / 💾 有云存档」两个筛选走 `data/xref.js`
   *   （GCM 清单 2,391 款 / Ludusavi 存档**位置** 6,274 款），而卡面上挂的资源 chip
   *   走的是本聚合层（GTrainers / 游侠存档**文件**）—— 两边口径不同 ⇒
   *   筛出来的卡片上可能一个对应 chip 都没有，反过来有 chip 的又筛不到。
   *   这里把「本层认为这款有资源」的 id 摊平成集合，让筛选与卡面**同源**。
   *   ⚠️ 只收 `L:`（用 libId 归组）的键：少数没关联到端游库的来源（`N:` 按游戏名归组）
   *     拿不到端游库 id，本来就无法与某一款库内游戏对应 —— 筛选是「按库内 id 交集」，
   *     把它们塞进集合反而会造出一批永远命不中的死 id。 */
  const libIds = { mod: new Set(), saves: new Set(), trainers: new Set() };
  for (const c of Object.keys(gByCat)) {
    for (const x of gByCat[c]) if (x.key.startsWith('L:')) libIds[c].add(x.key.slice(2));
  }

  cache = { sig: s, all, groups, byCat, gByCat, lib, byKeyCat, libIds };
  sig = s;
  return cache;
}

/* ─────────────────────────── 对外查询 ─────────────────────────── */

/** 某分区里「每组前 3 条」—— 组卡的卡内明文 */
const PREVIEW = 3;

/** 某组在某分区下的全部条目（O(1) 查预计算表） */
function groupItems(cat, key) {
  build();
  return (cache.byKeyCat.get(cat + '|' + key)) || [];
}

/**
 * 分页取「游戏组」。
 *   cat    'mod' | 'saves' | 'trainers'
 *   q      关键词（匹配组名 / 库名 / 组内任意条目标题）
 *   src    只看「含有该来源条目」的组（gt / yx / gcm / mod）★ v10.58 起 fr 已摘除
 *   sort   'hot'(默认,热度) | 'count'(条目多) | 'game'(按名) | 'new'(组内最新)
 *          ★ v10.97 默认由 count 改为 **hot**（用户口径：「端游四个模块都需默认按照热度排序」）。
 *          热度口径 = 机地话题浏览量 dpv；话题库没覆盖到的组回落「组内条目下载量之和」。
 *          两者都取不到 ⇒ 0，排到后面（**不编造热度**）。
 *   limit / offset
 */
function groups(cat, opts = {}) {
  const b = build();
  const list = b.gByCat[cat] || [];
  const q = String(opts.q || '').trim();
  const src = String(opts.src || '').trim();
  /* 只认这四个值，其余（拼错 / 老前端传 count）一律回落到默认的 hot */
  const sort = ['hot', 'count', 'game', 'new'].indexOf(String(opts.sort || '')) >= 0
    ? String(opts.sort) : 'hot';
  let pool = list;

  /* ★ src 筛在**组**粒度：一个组可能混源（存档 = 游侠 + GTrainers），
   *   筛「GTrainers」时该组仍在，但卡内条目不按源过滤 —— 因为卡内只铺前 3 条，
   *   过滤会让「N 条」这个数与实际能铺出来的条数对不上，反而更难懂。
   *   想看纯源列表请去该源自己的接口（/api/gt/*）。 */
  if (src) {
    const hit = new Set();
    for (const it of b.byCat[cat]) if (it.src === src) hit.add(it._g);
    pool = pool.filter((g) => hit.has(g.key));
  }

  /* ★ v10.97b：搜索时**名称命中**的组要排在「只有条目撞词」的组前面。
   *   为什么必须这样：`②` 那条是「组内条目标题命中也算」（用户搜「整合包」要搜得到），
   *   但默认排序改成热度之后，跨界 MOD 会把不相关的游戏顶上来 —— 实测搜「赛博朋克」，
   *   剑星（话题热度 348,068）压过赛博朋克2077（238,529），只因剑星组里有一条
   *   「武士运动服 赛博朋克2077」。用户搜的是**游戏名**，先给名字对的。
   *   ⚠️ 只在 `q` 非空时生效：无关键词时 `nameHit` 为 null，排序结果与纯热度完全一致。 */
  let nameHit = null;
  if (q) {
    const ql = q.toLowerCase();
    const qk = normKey(q);
    const hitKeys = new Set();
    nameHit = new Set();
    /* ① 组名直接命中 */
    for (const g of pool) {
      const gr = b.groups.get(g.key);
      if (!gr) continue;
      const names = [gr.name, gr.nameEn, gr.game, gr.libTitle].filter(Boolean);
      if (names.some((n) => String(n).toLowerCase().includes(ql) || (qk && normKey(n).includes(qk)))) {
        hitKeys.add(g.key);
        nameHit.add(g.key);
      }
    }
    /* ② 组内条目标题命中（用户搜「整合包」也该搜得到）——只算命中，不算「名称命中」 */
    for (const it of b.byCat[cat]) {
      if (hitKeys.has(it._g)) continue;
      const t = it.title || '';
      if (t.toLowerCase().includes(ql) || (qk && normKey(t).includes(qk))) hitKeys.add(it._g);
    }
    pool = pool.filter((g) => hitKeys.has(g.key));
  }

  const arr = pool.slice();
  const grp = (k) => b.groups.get(k);
  /* ★ v10.50：按「游戏名」排序改用**展示名**（中文名）。
   *   用原串会先比到一个 CJK/Latin 混排的怪序列（`abc…` 落在中文前后不定）；
   *   展示名基本是中文名，localeCompare 'zh' 才真的按拼音排。 */
  const sortName = (k) => String(grp(k).name || grp(k).game || '');
  /* 组的热度 —— 一次取值统一口径：话题浏览量优先，缺了用组内下载量。
   * ★ v10.97：两种量纲**不能直接比大小**（dpv 常见 10 万级、下载量合计常见千级），
   *   所以排序用 `[有话题热度, 热度值]` 两级键：知道热度的排前面，没收录话题的
   *   按本模块下载量排在其后 —— 否则「下载量大的冷门游戏」会压过「热度已知的热门游戏」。 */
  const hotPair = (k) => {
    const g = grp(k);
    if (!g) return [0, 0];
    if (g.hotTopic > 0) return [2, g.hotTopic];
    if (g.hotDl > 0) return [1, g.hotDl];
    return [0, 0];
  };
  /* ★ v10.97b：搜索时「名称命中」优先。`rel` 作为**主键**插在每种排序最前面，
   *   其余排序键在各自档位内照旧 —— 用户点了「按游戏名」也应当先看到名对的组。 */
  const rel = (k) => (nameHit && nameHit.has(k) ? 1 : 0);
  if (sort === 'game') {
    arr.sort((x, y) => (rel(y.key) - rel(x.key))
      || sortName(x.key).localeCompare(sortName(y.key), 'zh'));
  } else if (sort === 'new') {
    /* 组内最新时间戳 —— 用预计算表，别在比较函数里全表扫 */
    const newestOf = new Map();
    for (const g of arr) {
      const list = b.byKeyCat.get(cat + '|' + g.key) || [];
      let m = 0;
      for (const it of list) if ((it.ts || 0) > m) m = it.ts || 0;
      newestOf.set(g.key, m);
    }
    arr.sort((x, y) => (rel(y.key) - rel(x.key))
      || (newestOf.get(y.key) || 0) - (newestOf.get(x.key) || 0)
      || y.n - x.n);
  } else if (sort === 'count') {
    arr.sort((x, y) => (rel(y.key) - rel(x.key)) || y.n - x.n
      || sortName(x.key).localeCompare(sortName(y.key), 'zh'));
  } else {
    /* ★ v10.97 默认档：热度降序 → 条数降序 → 名称。
       第二档用条数而不是名称：热度打平时「资源多的」确实更值得排在前面。 */
    arr.sort((x, y) => {
      const a = hotPair(x.key); const b2 = hotPair(y.key);
      return (rel(y.key) - rel(x.key)) || (b2[0] - a[0]) || (b2[1] - a[1]) || (y.n - x.n)
        || sortName(x.key).localeCompare(sortName(y.key), 'zh');
    });
  }

  const limit = Math.min(parseInt(opts.limit, 10) || 24, 200);
  const offset = parseInt(opts.offset, 10) || 0;
  const slice = arr.slice(offset, offset + limit);

  return {
    ok: true, cat, total: arr.length, itemTotal: (b.byCat[cat] || []).length,
    offset, limit, sort, q, src,
    items: slice.map((g) => {
      const gr = grp(g.key);
      const all = groupItems(cat, g.key);
      /* ★★ bySrc 必须按**本分区**统计，绝不能直接用 gr.bySrc。
       *   gr.bySrc 是「这款游戏跨三个分区的来源分布」——MOD 区的赛博朋克2077 因此会
       *   挂上「游侠存档 / GCM 清单」两个徽标，而卡内一条都没有（卡内只铺 cat=mod 的条目），
       *   用户看到徽标会以为点开就有存档。而且 stats() 的 bySrc 是**按分区**算的
       *   （它就是来源下拉的选项与计数来源），两处口径不一致 ⇒ 下拉里选不到卡面显示的那个来源。
       *   实测证据（改前）：/api/res/groups?cat=mod 的赛博朋克2077 回
       *   bySrc={mod:717, yx:48, gcm:3}，而该组在 cat=mod 下的真实条目全是 src=mod。
       *   cats 字段保留跨分区口径（「这款游戏还有什么资源」），语义不同，别混用。 */
      const bySrc = {};
      for (const x of all) bySrc[x.src] = (bySrc[x.src] || 0) + 1;
      const hotTopic = gr.hotTopic || 0;
      const hotDl = gr.hotDl || 0;
      return {
        key: g.key, game: gr.game, name: gr.name, nameEn: gr.nameEn,
        libId: gr.libId, libTitle: gr.libTitle, cover: gr.cover,
        count: g.n, bySrc, cats: gr.cats,
        /* ★ v10.97 卡面「重要信息」三项 —— 前端只读，不再自己算：
         *   size    游戏体积（库字段，缺了用话题体积）
         *   hot     热度数值；hotSrc 说明这个数的**来源**（topic=话题浏览量 / dl=条目下载量 / ''=无）
         *   ★ 为什么要 hotSrc：两种量纲差两个数量级（dpv 30 万 vs 下载量几千），
         *     不标注来源的话，「为什么这个游戏热度 348,068、旁边那个只有 2,300」没法解释。 */
        size: gr.size || '',
        hot: hotTopic > 0 ? hotTopic : hotDl,
        hotSrc: hotTopic > 0 ? 'topic' : (hotDl > 0 ? 'dl' : ''),
        items: all.slice(0, PREVIEW),
        more: Math.max(0, all.length - PREVIEW),
      };
    }),
  };
}

/** 展开一组：返回该组在某个分区下的全部条目（有上限，避免 717 条一次性砸下去） */
function items(cat, key, limit = 200) {
  const b = build();
  const all = groupItems(cat, key);
  /* ★ v10.48：上限 500 → **1000**。
   *   为什么必须提：弹窗改成「一次取全量 + 弹窗内本地搜索」，
   *   搜的是**已加载的数组**，取不全就等于搜不全（用户看到「搜不到」会以为库里没有）。
   *   实测各分区最大单组：mod 717（赛博朋克2077）· saves 653（我的夏季汽车）· trainers 30
   *   ⇒ 1000 能覆盖全部组，不会再有静默截断。
   *   ⚠️ 仍是硬上限：真出现 >1000 的组时返回 `truncated:true`，前端**必须显示出来**，
   *      不能静默只给前 1000 条。 */
  const lim = Math.min(parseInt(limit, 10) || 200, 1000);
  return {
    ok: true, cat, key, total: all.length,
    truncated: all.length > lim,
    items: all.slice(0, lim),
  };
}

function stats(cat) {
  const b = build();
  const g = b.gByCat[cat] || [];
  const it = b.byCat[cat] || [];
  /* ★★ v10.48：「来源跳转链」与「下载链」是两种东西，必须分开统计。
   *   给 GCM 补上来源链之后，若沿用「links 非空即算有下载链」，
   *   trainers 的 `linkPct`（卡面写着「可下载占比」）会从 58.9% 跳到 96.4% ——
   *   那不是数据变好了，是**口径被混掉了**：那 3,451 条点进去是来源站介绍页，
   *   不是文件。所以来源链显式打 `ch:'src'`，并把两个覆盖率分别暴露。 */
  const isDl = (x) => (x.links || []).some((l) => l.ch !== 'src');
  const isSrc = (x) => (x.links || []).some((l) => l.ch === 'src');
  const withLink = it.filter(isDl).length;
  const withSrc = it.filter(isSrc).length;
  const bySrc = {};
  for (const x of it) bySrc[x.src] = (bySrc[x.src] || 0) + 1;
  return {
    ok: true, cat, groups: g.length, items: it.length, withLink,
    linkPct: it.length ? +(withLink / it.length * 100).toFixed(1) : 0,
    withSrc,
    srcPct: it.length ? +(withSrc / it.length * 100).toFixed(1) : 0,
    bySrc,
    srcLabel: SRC_LABEL,
  };
}

/** 详情页用：某款游戏在某个分区下的全部条目（瘦身投影，不带 _g/_i 这些内部字段） */
function slimItem(x) {
  return {
    src: x.src, cat: x.cat, id: x.id, title: x.title, game: x.game,
    size: x.size, date: x.date, downloads: x.downloads,
    links: x.links, page: x.page, note: x.note,
    /* 有没有原贴正文（详情页据此决定是否给「原贴」入口）—— v10.50 */
    hasPost: x.hasPost || 0,
    /* 来源展示名一并给出：前端不必自带一份映射表（铁律 17：口径只留一处） */
    srcLabel: SRC_LABEL[x.src] || x.src,
  };
}

/* ============================================================================
 * 原贴正文（v10.50 新增）
 *
 * 用户口径：「有部分帖子的我想你能够获取对应的内容（可以点击弹窗展示标题 + 原贴内容
 *           + 图片等）且还需要按照原贴的布局放置（大部分都有介绍和使用方式）」。
 *
 * ★ 这些正文**本来就在本地文件里**，不是新抓的：
 *     · 机地 MOD/修改器帖（src=mod）→ mods.json 的 `content`（实测 8,942/8,943 = 100%）
 *     · 游侠存档（src=yx）        → saves-youxia.json 的 `desc` / `steps` / `shots`
 *                                   （desc 100% · shots 57.4%）
 *   只是 `fromMods()` / `fromYx()` 在**归一成列表形状**时按设计只留了摘要字段
 *   （列表一条都没必要背 1KB 正文 —— 717 条一组就是 700KB）。
 *   ⇒ 列表侧只给 `hasPost` 一个布尔标记，正文走**按需单取**，一次一条。
 *
 * ★ 这是「界面缺字段 ≠ 数据源没有」的第二次现场（第一次是 v10.48 的 `official_url`）：
 *   两回都不是采集丢了数据，是**中间层投影**把字段筛掉了。改的是投影，不是采集。
 *
 * 返回形状（前端只认这一种）：
 *   { ok, src, id, has, source, title, game, name, author, ct, ut, pv, date,
 *     url, content, steps:[{head,text}], shots:[url] }
 *   has=false 表示该来源本来就没有正文（GT / GCM 是纯链接源）—— 不是错误。
 * ========================================================================== */
function post(src, id) {
  const s = String(src || '').trim();
  const k = String(id || '').trim();
  const srcLabel = SRC_LABEL[s] || s;
  if (!s || !k) return { ok: false, error: '缺少 src / id' };

  if (s === 'mod') {
    const x = (mods.ensure().items || []).find((v) => String(v.id) === k);
    if (!x) return { ok: false, error: '没找到这条帖子' };
    const libRaw = x.libTitle || x.game || '';
    return {
      ok: true, src: 'mod', id: k, has: true, source: srcLabel,
      title: x.title || '', game: libRaw, name: displayName(libRaw),
      author: x.author || '', ct: x.ct || 0, ut: x.ut || 0, pv: x.pv || 0,
      url: x.url || ('https://jidiyouxi.com/post/detail/' + k),
      /* ★ v10.50：这里是**真正把正文交出去**的地方 —— 必须再过一道广告行清洗。
         三重保险：① 抽取层（jidiModify.shape）入库前已清 ② 存量已用
         `tools/_clean-post-junk.js` 洗过 ③ 这一层兜住「库里还有漏网」的情况。
         ⚠️ 列表侧的 `hasPost` **故意不跟着清洗**：它只是「这条有没有正文」的粗判，
            反复对 8,942 条正文跑正则只为判空并不划算；清洗只在这一层做（铁律 17：实现只一处）。 */
      content: cleanPostText(x.content),
      steps: [], shots: [],
      /* 机地帖没有独立图集字段（正文是纯文本），配图就是该游戏话题的封面 —— 由前端用 group 封面兜底 */
      cover: x.cover || '',
    };
  }

  if (s === 'yx') {
    const x = (savesYx.ensure().items || []).find((v) => String(v.id) === k);
    if (!x) return { ok: false, error: '没找到这条帖子' };
    return {
      ok: true, src: 'yx', id: k, has: true, source: srcLabel,
      title: x.title || '', game: x.game || x.libTitle || '',
      name: displayName(x.libTitle || x.game || x.title || ''),
      author: '', ct: 0, ut: 0, pv: 0, date: x.date || '',
      url: x.sourceUrl || '',
      content: cleanPostText(x.desc),
      steps: (x.steps || []).map((t) => ({ head: t.head || '', text: t.text || '' })),
      shots: (x.shots || []).slice(0, 24),
      cover: x.libCover || x.cover || '',
    };
  }

  /* GT / GCM：只有链接与元数据，没有正文 —— 明确回 has:false，前端不显示入口 */
  return {
    ok: true, src: s, id: k, has: false, source: srcLabel,
    title: '', game: '', name: '', author: '', ct: 0, ut: 0, pv: 0, date: '',
    url: '', content: '', steps: [], shots: [], cover: '',
  };
}

function byLib(cat, libId, limit = 60) {
  build();
  const id = String(libId || '');
  if (!id) return [];
  const arr = cache.byKeyCat.get(cat + '|L:' + id) || [];
  return arr.slice(0, limit).map(slimItem);
}

/** 组的总览（详情页挂「本游戏有 N 条 MOD / 存档 / 修改器」） */
function countsFor(libId) {
  build();
  const id = String(libId || '');
  const out = { mod: 0, saves: 0, trainers: 0 };
  if (!id) return out;
  for (const c of Object.keys(out)) out[c] = (cache.byKeyCat.get(c + '|L:' + id) || []).length;
  return out;
}

/** ★ v10.53：某分区「有资源的端游库 id 集合」—— 供 `/api/library/*` 的筛选做 O(1) 交集。
 *
 *  与 `countsFor(id)` 的关系：`countsFor` 答「**这一款**有多少条」（详情页 / 卡面 chip 用），
 *  本函数答「**哪些款**至少有一条」（筛选用）。两者同出一张 `byKeyCat` 表，不会互相漂移。
 *
 *  ⚠️ 调用方拿到的是**共享的 Set**，只读不写 —— 别 `add` 进去（会污染缓存）。
 *  @param {'mod'|'saves'|'trainers'} cat
 *  @returns {Set<string>} */
const EMPTY_SET = new Set();   /* 未知分区返回空集，而不是 undefined（调用方一律 `.has()`） */
function libIdsFor(cat) {
  build();
  return (cache.libIds && cache.libIds[cat]) || EMPTY_SET;
}

module.exports = {
  build, groups, items, stats, byLib, countsFor, libIdsFor, slimItem, post,
  SRC_LABEL, SRC_KEY, MOUNT, PREVIEW,
};
