/**
 * data/savesYx.js — 游侠「存档**文件**」索引读取
 *
 * ★ 与 data/saves.js 的分工（别混）：
 *   data/saves.js    = 存档**位置**（Ludusavi manifest，6,625 款 / 15,064 条路径）
 *                      回答「存档放在哪」。**没有文件**。
 *   data/savesYx.js  = 存档**文件**（游侠补丁网存档区，真直链 + 网盘 + eD2K）
 *                      回答「去哪下」。由 tools/fetch-saves-youxia.js 产出。
 *
 * 为什么要新增这一个（而不是往 saves.json 里塞）：
 *   两个源的口径完全不同 —— 位置是「每款游戏多行路径」，文件是「每款游戏 N 个可下载包」，
 *   且文件侧只在**匹配上端游库**的条目上才有（见 fetch 脚本的两阶段策略）。
 *   混在一个文件里会让 saves.js 的 stats/分页口径全部失真。
 *
 * 每条含：
 *   id/title/game            游侠侧标题与权威游戏名
 *   cover/size/date          列表页字段（size 是**源站标注**的大小）
 *   files.direct             真直链（**已 encodeURI**，原始串在 directRaw）
 *          .fileName/.size   落地页给出的文件名/体积
 *          .netdisk[]        {kind:'xunlei'|'quark'|…, url}
 *          .ed2k / .thunder  备用通道
 *   files=null 时看 fileFailWhy：第 4 跳没解析出来（**不静默丢条**，前端给「去源站下载」出口）
 *   steps[]                  安装步骤（常含**存档目标路径**）
 *   libId/libTitle/libCover  端游库关联（用于详情跳转与按游戏取用）
 *   matchHow                 'bracket'（书名号精确）| 'prefix'（前缀推测）—— 可审计
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { normKey } = require('./name-normalize');

const FILE = path.join(__dirname, 'saves-youxia.json');
let cache = null;
let mtime = 0;

function ensure() {
  try {
    const st = fs.statSync(FILE);
    if (cache && st.mtimeMs === mtime) return cache;
    cache = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    mtime = st.mtimeMs;
    return cache;
  } catch (e) {
    return { items: [], stats: { missing: true, why: String((e && e.message) || e) } };
  }
}

function stats() {
  const d = ensure();
  return Object.assign({ total: (d.items || []).length }, d.stats || {});
}

/** 每款端游库游戏有几个存档文件 —— 只回计数，够卡片用，体积小 */
function index() {
  const d = ensure();
  const byLib = {};
  for (const it of d.items || []) {
    if (!it.libId) continue;
    byLib[it.libId] = (byLib[it.libId] || 0) + 1;
  }
  return { builtAt: d.builtAt || 0, stats: stats(), byLib };
}

/** 某款游戏（按端游库 id）的存档文件，按「有直链优先 + 时间新」排 */
function byLib(libId) {
  const d = ensure();
  const id = String(libId || '');
  if (!id) return [];
  return (d.items || [])
    .filter((x) => String(x.libId) === id)
    .sort((a, b) => (!!(b.files && b.files.direct) - !!(a.files && a.files.direct))
      || String(b.date || '').localeCompare(String(a.date || '')));
}

/** 按名模糊取（详情页只拿得到标题时用）：先精确键，再子串 */
function lookup(title) {
  const d = ensure();
  const k = normKey(title);
  if (!k) return [];
  const exact = [];
  const loose = [];
  for (const x of d.items || []) {
    const kk = normKey(x.game);
    const kt = normKey(x.title);
    if (kk === k || kt === k) exact.push(x);
    else if (k.length >= 3 && (kk.includes(k) || kt.includes(k))) loose.push(x);
  }
  const hit = exact.length ? exact : loose;
  return hit.sort((a, b) => (!!(b.files && b.files.direct) - !!(a.files && a.files.direct))
    || String(b.date || '').localeCompare(String(a.date || '')));
}

/** 详情抽屉用：先按端游库 id，再按名称。与 saves.js 的 match 同口径。
 *  ⚠️ 返回的是**完整条目**（含 desc / steps / shots 长文，单条 p50 ≈ 1.8KB）。
 *    给浏览器发的请走 `slim()` 投影 —— 见下面的说明。 */
function match({ t = '', id = '' } = {}) {
  let list = id ? byLib(id) : [];
  if (!list.length && t) list = lookup(t);
  return { count: list.length, items: list };
}

/** 这条存档有没有**原贴正文**（简介 / 安装步骤 / 截图）。
 *
 * ★ v10.51：抽成函数并**导出**，因为有两个调用方要问同一个问题：
 *     · 本文件的 `slim()`   → 详情页/下载弹窗据此决定给不给「原贴」入口
 *     · `res-groups.js` 的 `fromYx()` → 资源页卡内行同一件事
 *   同一个判据写两遍早晚会漂（铁律 17）。判据本身三选一：desc 有内容 / steps 非空 / shots 非空。
 *   ★ 只回 1 或 undefined（与 res-groups 里各来源的写法一致）：`undefined` 在 JSON 里
 *     直接消失，条目体积不变 —— 前端用 `!!it.hasPost` 判，不缺字段。
 *   ⚠️ 与 `res-groups.js slimItem()` 的 `hasPost` 是**同名字段、同义**，不是两份东西。 */
function hasPost(x) {
  return (String(x.desc || '').trim() || (x.steps || []).length || (x.shots || []).length) ? 1 : undefined;
}

/** 瘦身投影：只留前端渲染要用的字段。
 *  ★ 为什么必须有这一层：完整条目带 `desc`（常见 700~1500 字中文长文）、`steps[]`、`shots[]`，
 *    实测 p50 1,785B / p90 2,411B —— 一款热门游戏在存档区能有十几条，直传就是几十 KB 的
 *    **纯浪费**（前端一个字段都没用）。投影后单条约 600B。
 *  ★ 投影放在**数据层**而不是路由里：将来别的页面（详情页 / 资源页卡片）取同一批数据时，
 *    不会因为「忘了瘦身」把长文一起发出去；要长文的调用方显式用 `match()` / `byLib()`。
 *  ★ 保留 `files` 全量（这是本模块存在的理由，一个通道都不能少）。
 *  ★ v10.51 补 `hasPost`：正文**仍然不发**（投影的初衷不变），只补一个「有/没有」标记 ——
 *    有了它，下载弹窗的存档行才能像 Mod/修改器行那样给「原贴」入口（用户口径
 *    「Mod 和修改器也同样，变成下载链弹窗能看到获取贴内容」）。 */
function slim(x) {
  return {
    id: x.id,
    title: x.title,
    game: x.game,
    size: x.size,
    sizeFile: x.sizeFile,
    date: x.date,
    sourceUrl: x.sourceUrl,
    libId: x.libId,
    matchHow: x.matchHow,
    files: x.files || null,
    hasPost: hasPost(x),
  };
}

/** 给浏览器用的一体化入口：match + slim */
function matchSlim(opts) {
  const r = match(opts);
  return { count: r.count, items: r.items.map(slim) };
}

module.exports = { ensure, stats, index, byLib, lookup, match, slim, matchSlim, hasPost };
