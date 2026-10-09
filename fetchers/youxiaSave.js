/**
 * fetchers/youxiaSave.js — 游侠补丁网「存档」区抓取（列表 / 详情 / 文件解析）
 *
 * ─────────────────────────────────────────────────────────────
 * 数据源：https://patch.ali213.net/showclass/class5_<page>.html（存档列表，19 条/页）
 *
 * 为什么要抓这个源：本项目此前**只有存档「位置」**（data/saves.json 来自 Ludusavi
 * manifest，纯路径），没有任何「存档文件」。网易 UU 市集虽然条目多（6,735 条），
 * 但实测其详情接口**全文无任何文件字段**，下载是「登录后转存到 UU 客户端」的闭环
 * ⇒ 给不了文件。游侠这边是**真·直链**（实测 Content-Type: application/x-rar-compressed、
 * Content-Length 与页面标注大小吻合、支持 Range）。
 *
 * ─────────────────────────────────────────────────────────────
 * ★ 四跳链路（每一跳都实测过，别少跳）
 *
 *   ① 列表  patch.ali213.net/showclass/class5_<page>.html
 *            → 19 条/页；每条形如
 *              <div class="c-list"><a class="pic" href="/showpatch/<id>.html"><img src=…></a>
 *                <a class="title" href="/showpatch/<id>.html">《游戏名》存档标题</a>
 *                <div class="info"><span>大小：313.28K</span><span>更新时间：2026-10-09</span></div></div>
 *            ★ **列表页没有「所属游戏」字段**，但标题里带 `《游戏名》` —— 两阶段抓取
 *              （先列表 → 按名匹配 → 只抓匹配上的详情）就靠它。
 *
 *   ② 详情  patch.ali213.net/showpatch/<id>.html
 *            → 权威「所属游戏」、文件大小、介绍、**安装步骤（内含存档目标路径）**、截图，
 *              以及最关键的一行： var downUrl = "/search?key=<token>";
 *
 *   ③ 中转  https://so.ventacorius.com:4433<downUrl>
 *            → 一个小页面，里面指向 https://patch.ventacorius.com:4433/down/<id>.html
 *
 *   ④ 落地  https://patch.ventacorius.com:4433/down/<id>.html
 *            → 直链 https://patch1.ventacorius.com/<年>/ali213-<英文名>-<id>.rar
 *              + 迅雷网盘 / 夸克网盘 / ed2k:// / thunder://
 *
 * ★ 注意 ③④ 是**第三方跳转站**（soft778 / soft988 那套），带广告位、也可能改版或风控。
 *   所以解析失败**不许静默丢条**：一律回 `{ ok:false }` 并保留游侠详情页地址作出口
 *   （前端据此渲染「去源站下载」），否则会变成「看起来没有，其实是我们没解析出来」。
 *
 * ★ 本机实测：**三跳都能用 node `fetch` 直调（200）**，不需要 curl、不需要无头浏览器。
 *   （对比：nanoreview / kalvo 用 fetch 一律 403，那两个源才必须 curl。）
 */
'use strict';

const BASE = 'https://patch.ali213.net';
/** 详情页里「点击查找」给出的中转站前缀（写死是因为它跟着 downUrl 的相对路径走） */
const HOP3 = 'https://so.ventacorius.com:4433';
/** 存档区的 classid = 5（见列表页搜索表单 <input name="classid" value="5">） */
const CLASS_ID = 5;
/** 每页 19 条（实测） */
const PER_PAGE = 19;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const listUrl = (page) => `${BASE}/showclass/class${CLASS_ID}_${page}.html`;
const detailUrl = (id) => `${BASE}/showpatch/${id}.html`;

/* ────────────────────────── HTTP ────────────────────────── */

/**
 * 取一页 HTML。**不显式设 Accept-Encoding**：让服务端按「不压缩」返回，
 * 省掉自己在 node 里解 gzip 的分支。失败抛错，由调用方决定要不要重试。
 */
async function getText(url, { referer = BASE + '/', timeout = 20000 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, Referer: referer, Accept: 'text/html,*/*' },
      signal: ac.signal,
      redirect: 'follow',
    });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

/* ────────────────────────── 小工具 ────────────────────────── */

const abs = (u) => (!u ? '' : (u.startsWith('//') ? 'https:' + u : (u.startsWith('/') ? BASE + u : u)));
const unesc = (s) => String(s || '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”').replace(/&hellip;/g, '…')
  .trim();

/** 从标题里抽《游戏名》——列表页唯一的游戏名线索 */
function gameFromTitle(title) {
  const m = String(title || '').match(/《([^》]{1,60})》/);
  return m ? m[1].trim() : '';
}

/** `<div class="c-list">` 切成一块块（每块一条存档） */
function splitListBlocks(html) {
  const parts = html.split(/<div class="c-list"/).slice(1);
  return parts.map((p) => p.slice(0, p.indexOf('<div class="c-list"') === -1 ? undefined : p.indexOf('<div class="c-list"')));
}

/* ────────────────────────── ① 列表 ────────────────────────── */

/**
 * @returns {Array<{id,title,game,cover,size,date,url}>}
 */
function parseList(html) {
  const out = [];
  const seen = new Set();
  for (const blk of splitListBlocks(html)) {
    /* 用 class="title" 锚点定位：它一定在 pic 之后、info 之前 */
    const tm = blk.match(/class="title"[^>]*href="\/showpatch\/(\d+)\.html"[^>]*>([^<]+)</)
      || blk.match(/href="\/showpatch\/(\d+)\.html"[^>]*class="title"[^>]*>([^<]+)</);
    if (!tm) continue;
    const id = tm[1];
    if (seen.has(id)) continue;
    seen.add(id);
    const title = unesc(tm[2]);
    const cm = blk.match(/<img[^>]+src="([^"]+)"/);
    /* ★ 大小可能是「313.28K」也可能是「1.4M」「575.5K」——**不一定带 B**，别写成 [KMG]B */
    const sm = blk.match(/大小：\s*([0-9.]+\s*[KMG]?B?)/i);
    const dm = blk.match(/更新时间：\s*(\d{4}-\d{2}-\d{2})/);
    out.push({
      id,
      title,
      game: gameFromTitle(title),
      cover: abs(cm ? cm[1] : ''),
      size: sm ? sm[1].replace(/\s+/g, '') : '',
      date: dm ? dm[1] : '',
      url: detailUrl(id),
    });
  }
  return out;
}

/** 列表页里出现的最大页码（用来判「抓到第几页为止」） */
function maxPageIn(html) {
  const nums = [...html.matchAll(new RegExp(`class${CLASS_ID}_(\\d+)\\.html`, 'g'))].map((m) => +m[1]);
  return nums.length ? Math.max(...nums) : 1;
}

/* ────────────────────────── ② 详情 ────────────────────────── */

/**
 * @returns {{id,title,game,gid,gameUrl,tags,size,desc,steps,shots,downUrl,sourceUrl}}
 */
function parseDetail(html, id) {
  const pick = (re) => { const m = html.match(re); return m ? unesc(m[1]) : ''; };

  const title = pick(/<title>([^<]+)<\/title>/).replace(/最新版下载_游侠网\s*$/, '').trim();

  /* 所属游戏：权威名字（比列表页标题里的《》可靠） */
  const gm = html.match(/所属游戏：[\s\S]{0,80}?<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/);
  const game = gm ? unesc(gm[2]) : '';
  const gameUrl = gm ? abs(gm[1]) : '';
  const gid = (gameUrl.match(/\/z\/(\d+)/) || [])[1] || '';

  const tags = [...html.matchAll(/所属标签：[\s\S]{0,60}?<a[^>]*>([^<]+)<\/a>/g)].map((m) => unesc(m[1]));

  /* ★ 大小可能是「231.77K」「1.4M」——**不一定带 B** */
  const size = pick(/文件大小：\s*([0-9.]+\s*[KMG]?B?)/i).replace(/\s+/g, '');

  /* 介绍正文（补丁介绍 → 下一个 h2 之前） */
  let desc = '';
  const di = html.indexOf('补丁介绍');
  if (di > -1) {
    const chunk = html.slice(di, di + 6000);
    const end = chunk.indexOf('</div>', chunk.indexOf('<div class="pluginContent'));
    const body = end > -1 ? chunk.slice(0, end) : chunk;
    desc = unesc(body.replace(/<[^>]+>/g, ' ').replace(/补丁介绍/, '')).replace(/\s+/g, ' ').slice(0, 1200);
  }

  /* 安装步骤：往往含**存档目标路径**，前端可展示。
     ★ 一步一步是**多个 <p>**，必须一路取到下一个 <h3> 为止 —— 早先只取到第一个 </p>，
       结果把「解压文件」「将文件内容移动到以下路径：…」整段丢掉了（那才是用户最需要的）。 */
  const steps = [];
  const h3s = [...html.matchAll(/<h3>[\s\S]{0,60}?<strong>([^<]{1,24})<\/strong>[\s\S]{0,60}?<\/h3>/g)];
  for (let i = 0; i < h3s.length; i++) {
    const head = unesc(h3s[i][1]);
    const from = h3s[i].index + h3s[i][0].length;
    const to = i + 1 < h3s.length ? h3s[i + 1].index : Math.min(html.length, from + 4000);
    let text = unesc(html.slice(from, to).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    /* 末段会把「下载地址 / 我要报错 / 点击查找」这些 UI 文案一起吃进来 ⇒ 在标记处截断 */
    text = text.split(/下载地址|我要报错|普通下载|点击查找/)[0].trim();
    if (text) steps.push({ head, text: text.slice(0, 800) });
  }

  const shots = [...new Set([...html.matchAll(/https:\/\/img1?\.ali213\.net\/patchpic\/[^"'\s>]+\.(?:png|jpe?g|gif)/gi)].map((m) => m[0]))];

  const downUrl = pick(/var\s+downUrl\s*=\s*"([^"]+)"/);

  return { id, title, game, gid, gameUrl, tags, size, desc, steps, shots, downUrl, sourceUrl: detailUrl(id) };
}

/* ────────────────────────── ③④ 文件解析 ────────────────────────── */

/** 从中转页里取第 ④ 跳地址
 *  ★ 两个正则的捕获组序号不同：绝对地址那条**没有捕获组**（在 m[0]），
 *    相对路径那条有（在 m[1]）。写成一个 m[1] 会直接崩（踩过）。 */
function hop4FromRelay(html) {
  const abs4 = html.match(/https:\/\/patch\.ventacorius\.com:4433\/down\/\d+\.html/);
  if (abs4) return abs4[0];
  const rel = html.match(/(?:href|src)="(\/down\/\d+\.html)"/);
  return rel ? 'https://patch.ventacorius.com:4433' + rel[1] : '';
}

/**
 * 解析落地页 —— 拿到「文件」本身的各种通道。
 * ★ 直链可能带空格（实测 `ali213-SILENT HILLTownfall-316389.rar`），
 *   所以**必须编码后再存**，否则前端 <a href> 会断在空格处。
 */
function parseLanding(html) {
  /* ★★ 直链里**可能有空格**（实测 `ali213-SILENT HILLTownfall-316389.rar`）。
   *    用 [^"'\s<]+ 会在空格处截断 ⇒ 整条抓不到。href 是带引号的，
   *    所以正确写法是「一路吃到引号/尖括号为止」：[^"'<>]+
   *    （第一版就是栽在这，落地页明明有直链却解析出空串。） */
  const direct0 = (html.match(/https:\/\/patch1\.ventacorius\.com\/[^"'<>]+?\.(?:rar|zip|7z|tar|gz)/i) || [])[0] || '';
  const fileName = (direct0.split('/').pop() || '').trim();
  const size = (html.match(/([0-9.]+\s*[KMG]B)\s*<\/?/i) || [])[1] || (html.match(/大小：\s*([0-9.]+\s*[KMG]?B?)/) || [])[1] || '';

  const netdisk = [];
  for (const m of html.matchAll(/https:\/\/pan\.(xunlei|quark|baidu|aliyundrive)\.com\/[^"'\s<]+/gi)) {
    const u = m[0].replace(/&amp;/g, '&');
    if (!netdisk.some((x) => x.url === u)) netdisk.push({ kind: m[1], url: u });
  }
  const ed2k = (html.match(/ed2k:\/\/\|file\|[^|]+\|\d+\|[0-9a-f]+\|\//i) || [])[0] || '';
  const thunder = (html.match(/thunder:\/\/[A-Za-z0-9+/=]+/) || [])[0] || '';

  return {
    fileName,
    size: String(size).replace(/\s+/g, ''),
    /* 存编码后的 URL，但保留原始串供展示 */
    direct: direct0 ? encodeURI(direct0) : '',
    directRaw: direct0,
    netdisk,
    ed2k,
    thunder,
    ok: !!(direct0 || netdisk.length || ed2k || thunder),
  };
}

/**
 * 走完 ③④ 两跳，解析出文件通道。
 * 任何一跳失败都返回 `{ ok:false, why }`（**不抛**），由调用方保留游侠详情页作出口。
 */
async function resolveFiles(detail, { timeout = 20000 } = {}) {
  const out = { ok: false, why: '', hop3: '', hop4: '' };
  if (!detail || !detail.downUrl) { out.why = '详情页无 downUrl'; return out; }
  out.hop3 = HOP3 + detail.downUrl;
  try {
    const relay = await getText(out.hop3, { referer: detail.sourceUrl, timeout });
    const h4 = hop4FromRelay(relay);
    if (!h4) { out.why = '中转页未给出落地地址'; return out; }
    out.hop4 = h4;
    const land = await getText(h4, { referer: out.hop3, timeout });
    const f = parseLanding(land);
    Object.assign(out, f);
    if (!f.ok) out.why = '落地页无可识别通道';
    return out;
  } catch (e) {
    out.why = out.why || String((e && e.message) || e);
    return out;
  }
}

/* ────────────────────────── 跨源名称匹配 ────────────────────────── */

/* ★ 归一化一律从**唯一真源** name-normalize 取，不从 mod-match 转发 ——
 *   mod-match 曾经自带一份不等价的字符类（v10.46 已收口），
 *   这里显式解构同时也让 `test-shared-destructure.js` 的「用了但没解构」检查保持绿。 */
const { keyUsable } = require('../data/mod-match');
const { normKey, numMismatchByTitle, genNums } = require('../data/name-normalize');

/** 前缀**收缩**候选：取标题首个空格前那一段，从长到短逐字收缩，**下限 3 字**
 *  ★ 下限必须 ≥3：2 字收缩是误配重灾区（见 matchYxEntry 注释）。
 *  ★ 起始位置是 `len-1`：整段本身由调用方先精确试过，这里不重复。 */
function shrinkCandidates(title) {
  const first = String(title || '').trim().split(/\s+/)[0] || '';
  const out = [];
  for (let k = Math.min(14, first.length) - 1; k >= 3; k--) out.push(first.slice(0, k));
  return out;
}

/**
 * ★ v10.46 新增：游侠前缀通道专用的**代际护栏查询口径** —— 只认「紧贴命中键的那一位数字」。
 *
 * 为什么不能拿整条标题去问护栏（旧写法，实测过一次）：
 *   存档标题里的数字绝大多数是**版本号 / 等级 / 序号**，不是代际：
 *     「泰拉瑞亚 地图存档v1.2」            ← v1.2 是版本
 *     「厕所穿越记 v1.47升级档+免DVD补丁RAiN版」 ← v1.47 是版本
 *     「龙珠：超宇宙 80级全技能初始存档」       ← 80级 是角色等级
 *     「特殊行动：一线生机 2号升级档…」         ← 2号 是补丁序号
 *     「愤怒的小鸟季节版V2.4全关卡三星全金蛋存档」 ← V2.4 是版本
 *   拿整条标题问护栏 ⇒ 全库 3,581 条列表里**多拒 91 条**（实测口径对照：1,952 vs 2,043），
 *   而多拒的这 91 条里**没有一条是真代际冲突**。
 *
 * 真代际数字在存档标题里的形态是**紧贴游戏名**的（实测都是从旧落盘结果里反推出来的）：
 *   「仙剑奇侠传6 全流程全节点通关存档」 → 命中键「仙剑奇侠传」紧跟 6（库只有 1 代条目）
 *   「三位一体2 v1.15升级档」          → 命中键「三位一体」紧跟 2（库只有 1 代）
 *   「进击的巨人2 全剧情通关存档」       → 命中键「进击的巨人」紧跟 2
 *   「永恒之柱2：死亡之火 …」           → 命中键「永恒之柱」紧跟 2
 *   「三维弹球FX3 …」                 → 命中键「三维弹球FX」紧跟 3
 * 而版本号的形态是「键 + 空格/字母 + 数字」，紧贴那一位不是数字 ⇒ 天然不参与代际判定。
 *
 * ⚠️ 只认 **1 位**（`\d(?![0-9])`）：两位数字在存档标题里基本是量词 ——
 *   「丧尸围城2：绝密档案50级弗兰克大叔S评价存档」的 `50` 是等级，
 *   取 1~2 位会把它当成「第 50 代」而误拒（实测 1~2 位比只取 1 位多拒 2 条）。
 *
 * ★ 本函数是**游侠存档标题专用的策略**，不替代、也不修改
 *   `name-normalize.numMismatchByTitle`（那是跨源匹配的共享护栏，另有调用方）；
 *   这里只用它导出的 `genNums` 做取数，保持「取数在唯一真源、策略在本调用点」。
 *
 * 实测（全库 3,581 条列表，对 v10.46 之前的落盘结果**逐条逐字段**比对）：
 *   整条标题口径 ⇒ 匹配 1,952 · 拒 114 ｜ 本口径 ⇒ 匹配 2,043 · 拒 23
 *   而这 23 条**逐条核对全部是真代际错配**（6 代/5 代/2 代存档挂到初代条目），
 *   新增误配 0 —— 护栏只拒不加，方向是零和的收窄。
 *
 * @returns {boolean} true = 判为代际冲突，应拒绝
 */
function genAdjReject(rawTitle, matchedRaw, lib) {
  if (!matchedRaw || !lib) return false;
  const raw = String(rawTitle || '');
  const i = raw.indexOf(String(matchedRaw));
  if (i < 0) return false;
  /* ★ 紧贴位**不跨空白**。实测过「跨空白再取一位数字」的版本，结论是必须否掉：
   *     空格后的数字在存档标题里压倒性是**补丁序号 / 数量 / 版本**，不是代际 ——
   *       「无主之地2 4职业初始修改档」   → 4 是职业数
   *       「迸发 6号升级档单独免DVD补丁CODEX版」 → 6 是补丁序号
   *       「火炬之光2  1号升级档+免DVD补丁RELOADED版」 → 1 是补丁序号
   *       「星界边境 8.0有三千伤害的弓的存档」 → 8.0 是版本
   *       「黑道圣徒4 8号升级档单独免DVD补丁RELOADED版」 → 8 是补丁序号
   *     跨空白版实测：匹配 2,043 → 2,012，**多拒的 31 条逐条核对全是真匹配**（无一例外）。
   *   ⇒ 只有「同一段里紧贴」才算代际。代价是放掉「仙剑奇侠传 6代存档」这种
   *     空格分隔的写法（见文件末「已知边界」），但那种写法在 3,581 条语料里**一条都没有**，
   *     而误拒是 31 条 —— 这笔账很明确。 */
  const m = raw.slice(i + String(matchedRaw).length).match(/^(\d)(?![0-9])/);
  if (!m) return false;
  return !genNums(lib.title).includes(m[1]);
}

/**
 * 游侠条目 → 端游库条目。
 *
 * 列表页**没有「所属游戏」字段**，只有标题，而标题有两种形态（实测 3,581 条里
 * 只有 45.4% 带书名号）：
 *   ① 带书名号：《黑道圣徒3》超完美存档        → 取《》里那段，最可靠
 *   ② 不带：黑道圣徒3 超完美存档 / 死亡细胞全物品解锁存档
 *      → 游戏名是**标题的前缀**，格式为「游戏名[ 空格]描述」
 *
 * ★★ 两条硬规则（都是**实测误配**换来的，别松）：
 *
 *   规则一：**书名号是权威游戏名，匹配不上就判未匹配**，绝不再拿标题做前缀猜测。
 *     反例（实测）：「《寂静岭：Townfall》已通关存档」——库里没有这款，
 *     于是前缀一路收缩到「寂静」，命中了完全无关的《寂静/In Silence》。
 *     同类：「《轮回之兽》」→《轮回/Samsara》、《热血无赖》→《热血/Hot Blood》。
 *
 *   规则二：前缀**收缩**长度必须 ≥3 字；只有「标题首段整段等于库名」才放行 2 字。
 *     放行 2 字的场景是真实存在的短名：`剑星 完美存档` → 首段「剑星」整段命中。
 *     而收缩到 2 字（「热血无赖…」→「热血」）一律拒绝 —— **宁可漏，也不误挂**。
 *
 * ★ 返回 `how` 是为了可审计/可反证：`bracket`（精确）与 `prefix`（推测）混在一起，
 *   就分不清「真匹配」和「猜的」，出问题也没法回溯。
 *
 * ★★ 规则三：**代际数字护栏**。前缀收缩还留着最后一个坑：`黑道圣徒3超完美存档` 若库里只有初代
 *   `黑道圣徒 / Saints Row`，收缩到 4 字就会命中它 —— 把 3 代存档挂到 1 代头上。
 *   护栏规则：查询侧带「代际数字」而命中条目通篇没有该数字 ⇒ 拒绝。
 *   （实测 `鬼泣5` → `鬼泣5/Devil May Cry 5` 两边都有 5，正常放行。）
 *
 *   ⚠️ v10.46 修正：护栏的**查询参数**不能用「整条标题」—— 见下面 `genAdjReject` 的实测账。
 *      存档标题里的数字绝大多数是版本号/等级/序号，用整条标题问护栏会大面积误拒。
 *      本文件（游侠前缀通道）改用「紧贴命中键的那一位数字」，共享护栏
 *      `name-normalize.numMismatchByTitle` 保持不动（它另有调用方）。
 *
 * ★ v10.46：归一化口径已**收口**。原先这里记着「用 mod-match 的 normKey，不是 name-normalize
 *   那份 —— 两份符号集不同，含 ™®© 的名字会分叉（既有状况，本次不动）」，那个分叉已消除：
 *   mod-match 不再自带字符类、也不再转发 `normKey`，全仓只有 `data/name-normalize.js` 一份。
 *   ⇒ 索引（buildLibIndex）与查询（本函数）现在用的是**同一个实现**，
 *     不存在「索引用 A、查询用 B」的 1.245% 静默漏配。
 *   （等价性实测：收口前后游侠存档命中数 1211 → 1211，差异 0。）
 *
 * @returns {{lib:object|null, how:'bracket'|'prefix'|'none', key:string, klen:number, genReject:boolean}}
 */
function matchYxEntry(item, byName) {
  const rej = { lib: null, how: 'none', key: '', klen: 0, genReject: false };
  if (item && item.game) {
    const k = normKey(item.game);
    const lib = keyUsable(k) ? byName.get(k) : null;
    if (!lib) return rej;
    if (numMismatchByTitle(item.game, lib)) return Object.assign({}, rej, { genReject: true });
    return { lib, how: 'bracket', key: item.game, klen: k.length, genReject: false };
  }
  const first = String((item && item.title) || '').trim().split(/\s+/)[0] || '';
  const firstKey = normKey(first);
  /* ① 首段整段命中（放行 2 字：剑星 / 鸣潮 这类短名）
   *    ★ v10.46：本分支**不做代际判定**，且这不是漏写 —— 是实测得到的边界。
   *      本分支的检索键 `first` 按定义就是「标题首个空白前那一段」，所以它后面
   *      要么是空白、要么到底 ⇒ 紧贴位判定**恒不成立**（旧代码在这里调护栏，
   *      是真的从未生效过：把它摘掉后全语料重算结果一字不变）。
   *      那要不要「跨空白取数」把它救活？实测否掉了 —— 空格后的数字压倒性是补丁序号/
   *      数量/版本（1号升级档 / 4职业 / 8.0 / 8号），救活它会**多拒 31 条真匹配**。
   *      ⇒ 代际判定只留在分支②（那里数字与游戏名确实连在一起）。详见 genAdjReject 注释。 */
  if (keyUsable(firstKey) && byName.has(firstKey)) {
    const lib = byName.get(firstKey);
    return { lib, how: 'prefix', key: first, klen: firstKey.length, genReject: false };
  }
  /* ② 前缀收缩（≥3 字 + 代际护栏） */
  for (const c of shrinkCandidates(item && item.title)) {
    const k = normKey(c);
    if (!keyUsable(k) || k.length < 3) continue;
    if (!byName.has(k)) continue;
    const lib = byName.get(k);
    if (genAdjReject(item.title, c, lib)) return Object.assign({}, rej, { genReject: true });
    return { lib, how: 'prefix', key: c, klen: k.length, genReject: false };
  }
  return rej;
}

/* ────────────────────────── 已知边界（实测记录，不藏着） ──────────────────────────
 *
 * ① 空格分隔的代际数字判不出来。
 *    `仙剑奇侠传 6代存档` 这种写法，紧贴位是空白 ⇒ 不触发护栏 ⇒ 会被挂到初代条目上。
 *    **实测：3,581 条列表语料里这种写法 0 条**（而跨空白取数会误拒 31 条真匹配，
 *    见 genAdjReject 注释）。故本轮**刻意**不修；若将来语料里出现，再回来评估。
 *
 * ② 阿拉伯数字 ↔ 中文数字、以及副标题差异，都还没有桥接 —— 这才是那 23 条被护栏拒掉的
 *    存档里**约 11 条**「本该能匹配上」的真正原因（不是护栏太严，是名称写法没对上）：
 *      「仙剑奇侠传6 全流程全节点通关存档」 → 库里是 `仙剑奇侠传六/Sword and Fairy 6`
 *      「三位一体2 v1.15升级档」          → 库里是 `三位一体2：完整故事/Trine 2: Complete Story`
 *      「永恒之柱2：死亡之火 …」           → 库里是 `永恒之柱2：死火/Pillars of Eternity II: Deadfire`
 *      「进击的巨人2：最终之战 …」         → 库里是 `进击的巨人2：最终一战/Attack on Titan 2`
 *    这四类（中文数字 / 副标题别名 / 繁简与译名差异）属于**跨源名称匹配**的另一个课题，
 *    与本文件的档案标题前缀匹配不是一件事，留给后续版本；本轮护栏的方向是
 *    「宁可漏，也不误挂」（与规则二一致），拒掉错匹配是本轮的正确结果。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

module.exports = {
  BASE, HOP3, CLASS_ID, PER_PAGE, UA,
  listUrl, detailUrl,
  getText, abs, unesc, gameFromTitle,
  parseList, maxPageIn, parseDetail, hop4FromRelay, parseLanding, resolveFiles,
  shrinkCandidates, genAdjReject, matchYxEntry,
};
