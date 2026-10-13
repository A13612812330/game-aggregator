#!/usr/bin/env node
/* tools/gen-roster.js —— 「完整体检表」：手游名单 + 端游名单，一款一行
 *
 * 用户口径（2026-10-13）：
 *   「给我一个 HTML，我需要能够直观的看到完整的手游名单/端游名单，字段我需要
 *     是否有本体/修改器/mod/存档，以及我还需要一个按钮能够点击查看对应的链接（弹窗），
 *     然后能够以更新时间/热度进排序」
 *
 * ★ 数据来源**全部复用既有模块**，不自己写匹配（铁律：不手写已有能力覆盖的功能）：
 *     · 端游名单 + 热度(score/hot/size/时间) → data/games.json（19,497 条原始记录）
 *     · 手游名单 + 关联端游 id                → data/mobilehub.js#all()（3,339 条）
 *     · MOD / 存档 / 修改器 的**计数与链接**  → data/res-groups.js#countsFor / byLib
 *       （与详情页、资源页同一张 byKeyCat 表 —— 口径只有一处，不会互相漂移）
 *
 * ★★ 「本体」是一个**能力边界**，必须说清楚：
 *     本体直链没有本地全量数据 —— 它只能**逐款打源站实时解析**（/api/download）。
 *     19,497 款 × 每款一次网络请求 不现实，所以本页：
 *       · 有实测结果的（data/_core-dl-probe.json，v10.57 那一轮 168 款）→ 直接标三态
 *       · 其余 → 标「未测」，并在弹窗里给**实时查询按钮**（调 /api/download）
 *     服务端已开 `Access-Control-Allow-Origin: *`，file:// 打开也能直连。
 *
 * 用法：
 *   node tools/gen-roster.js [--stamp 2026-10-13] [--probe data/_core-dl-probe.json]
 * 产物：
 *   docs/reports/gamehub-roster-<stamp>.html
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const gi = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const STAMP = gi('--stamp', new Date().toISOString().slice(0, 10));
const PROBE_FILE = path.join(ROOT, gi('--probe', 'data/_core-dl-probe.json'));
const OUT = path.join(ROOT, 'docs', 'reports', `gamehub-roster-${STAMP}.html`);
/* 线上稳定短链落点（站点静态根 = public/） */
const WEB = path.join(ROOT, 'public', 'roster', 'index.html');
const SNAP = path.join(ROOT, 'docs', 'reports', `_roster-${STAMP}.json`);

const resGroups = require('../data/res-groups');
const mobilehub = require('../data/mobilehub');

/* ─────────────────────────── 读源 ─────────────────────────── */

const games = require('../data/games.json');
mobilehub.ensure();
const mobAll = mobilehub.all();

let probe = null;
try { probe = JSON.parse(fs.readFileSync(PROBE_FILE, 'utf8')); } catch (_) { probe = null; }
const probeRows = (probe && probe.rows) || {};

const BODY_ST = { ok: 1, auth: 2, nobody: 3 };   // 0 = 未测

/* 手游按 libId 建索引：同款既在端游库又在手游库时，端游那一行要带上「可手机玩」 */
const mobByLib = new Map();
for (const m of mobAll) if (m.libId) {
  if (!mobByLib.has(m.libId)) mobByLib.set(m.libId, []);
  mobByLib.get(m.libId).push(m);
}
const pcIds = new Set(games.map((g) => g.id));

/* ─────────────────────────── 组装行 ─────────────────────────── */

const SRC = { jidi: 0, xdgamer: 1, mh: 2 };      // 行内用数字存，省字节
const rows = [];
const links = {};                                 // libId → { m, sv, tr, body }
let nHasRes = 0, nBodyKnown = 0;

function packRes(libId) {
  const c = resGroups.countsFor(libId);
  return c;
}
function packLinks(libId, c) {
  /* 只给**至少有一条**的游戏装链接 —— 全量装会让页面多背几 MB 的空对象 */
  if (!c.mod && !c.saves && !c.trainers) return;
  const one = (cat) => resGroups.byLib(cat, libId, 200).map((x) => [
    x.title || '', x.srcLabel || x.src || '', x.date || '', x.size || '',
    x.page || '', (x.links || []).map((l) => [l.label || '', l.url || '', l.cls || 'other']),
    x.note || '', x.downloads || 0,
  ]);
  links[libId] = { m: one('mod'), sv: one('saves'), tr: one('trainers') };
}

/* 1) 端游全量（含「同款也在手游库」的标记） */
for (const g of games) {
  const id = g.id;
  const c = packRes(id);
  if (c.mod || c.saves || c.trainers) nHasRes++;
  packLinks(id, c);
  const pr = probeRows[id];
  const body = pr ? (BODY_ST[pr.st] || 0) : 0;
  if (body) nBodyKnown++;
  const inMob = mobByLib.has(id);
  rows.push([
    String(g.title || g.id).trim(),
    id,
    SRC[g.source] != null ? SRC[g.source] : 0,
    String(g.size || ''),
    Number(g.hot) || 0,
    Number(g.updatedTs || g.publishTs) || 0,
    body, c.mod, c.saves, c.trainers,
    inMob ? 1 : 0,
    String(g.cover || ''),
    String(g.url || ''),
  ]);
}

/* 2) 手游独有（未关联到端游库的那 1,652 款）—— 三类资源天然为 0，但名单要全 */
for (const m of mobAll) {
  if (m.libId && pcIds.has(m.libId)) continue;    // 已并入端游那一行
  const id = m.libId || ('mh:' + (m.name || ''));
  const c = m.libId ? packRes(m.libId) : { mod: 0, saves: 0, trainers: 0 };
  if (c.mod || c.saves || c.trainers) nHasRes++;
  if (m.libId) packLinks(m.libId, c);
  const pr = probeRows[m.libId];
  const body = pr ? (BODY_ST[pr.st] || 0) : 0;
  rows.push([
    String(m.name || '').trim(),
    id,
    SRC.mh,
    String(m.libSize || ''),
    Number(m.configs) || 0,                       // 手游独有行没有 score，用「实测配置数」当热度
    Number(m.recent || 0) * 1000,                 // recent 是**秒**，统一成毫秒
    body, c.mod, c.saves, c.trainers,
    1,
    String(m.libCover || ''),
    String(m.libUrl || ''),
  ]);
}

const meta = {
  nPc: games.length, nMob: mobAll.length, nMobMerged: mobByLib.size,
  nMobOnly: rows.filter((r) => r[2] === SRC.mh).length,
  nRes: nHasRes, nBody: nBodyKnown,
  probeTotal: Object.keys(probeRows).length,
  probeBuiltAt: (probe && probe.builtAt) || 0,
  cover: { mod: resGroups.libIdsFor('mod').size, saves: resGroups.libIdsFor('saves').size, trainers: resGroups.libIdsFor('trainers').size },
};
const DATA = { builtAt: Date.now(), stamp: STAMP, meta, rows, links };

/* ─────────────────────────── 自检（产物对不上就抛，不静默出页） ─────────────────────────── */

const nPc = games.length, nMob = mobAll.length;
if (rows.length !== nPc + (nMob - mobByLib.size)) {
  throw new Error(`行数对不上：${rows.length} ≠ ${nPc} + (${nMob} - ${mobByLib.size})`);
}
if (!rows.length) throw new Error('0 行，拒绝出页');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(SNAP, JSON.stringify(DATA));
const json = JSON.stringify(DATA).replace(/<\//g, '<\\/');

console.log(`[roster] 端游 ${nPc} · 手游 ${nMob}（其中 ${mobByLib.size} 款并入端游行）· 合计 ${rows.length} 行`);
console.log(`[roster] 有三类资源 ≥1 的 ${nHasRes} 款 · 本体有实测三态的 ${nBodyKnown} 款 · 链接组 ${Object.keys(links).length}`);
console.log(`[roster] 快照 ${path.relative(ROOT, SNAP)}  ${(JSON.stringify(DATA).length / 1048576).toFixed(2)} MB`);

/* ─────────────────────────── 渲染 ─────────────────────────── */

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GameHub 完整名单 · 手游 ${nMob} + 端游 ${nPc}</title>
<style>
  :root{
    --c-primary:#2E6BFF; --c-primary-deep:#1B4FD8; --c-primary-soft:#EAF1FF;
    --c-jidi:#E6415D; --c-xd:#0B7BFF;
    --c-bg:#F3F5F9; --c-surface:#FFFFFF; --c-border:#E6E9F0; --c-border2:#C9D2E3;
    --c-t1:#151A24; --c-t2:#5A6474; --c-t3:#8A93A6;
    --c-ok:#16A34A; --c-warn:#D97706; --c-danger:#DC2626;
    --shadow:0 1px 2px rgba(18,26,51,.06); --shadow-lg:0 14px 40px rgba(18,26,51,.14);
    --font:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",Roboto,sans-serif;
    --font-num:"DIN Alternate","Segoe UI",ui-monospace,SFMono-Regular,monospace;
    --topbar-h:58px;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--c-bg);color:var(--c-t1);font-family:var(--font);font-size:13px;line-height:1.5}
  a{color:var(--c-primary);text-decoration:none}
  .topbar{position:sticky;top:0;z-index:30;height:var(--topbar-h);background:rgba(255,255,255,.92);
    backdrop-filter:saturate(180%) blur(12px);border-bottom:1px solid var(--c-border);display:flex;align-items:center;gap:14px;padding:0 18px}
  .brand{display:flex;align-items:center;gap:9px;font-weight:800;font-size:15px;white-space:nowrap}
  .brand .dot{width:9px;height:9px;border-radius:3px;background:linear-gradient(135deg,#2E6BFF,#6366F1)}
  .brand small{font-weight:600;font-size:11px;color:var(--c-t3);font-family:var(--font-num)}
  .kpi{display:flex;gap:16px;margin-left:auto;flex-wrap:wrap}
  .kpi div{font-size:11px;color:var(--c-t3);text-align:right;line-height:1.25}
  .kpi b{display:block;font-size:15px;color:var(--c-t1);font-family:var(--font-num)}
  .wrap{max-width:1680px;margin:0 auto;padding:16px 18px 60px}
  .bar{background:var(--c-surface);border:1px solid var(--c-border);border-radius:12px;box-shadow:var(--shadow);
    padding:12px 14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
  .bar label{font-size:12px;color:var(--c-t2);font-weight:650}
  input[type=search],select{border:1px solid var(--c-border2);border-radius:8px;padding:7px 10px;font:inherit;
    background:#fff;color:var(--c-t1);outline:none}
  input[type=search]{width:240px}
  input[type=search]:focus,select:focus{border-color:var(--c-primary)}
  .seg{display:flex;border:1px solid var(--c-border2);border-radius:8px;overflow:hidden}
  .seg button{border:0;background:#fff;padding:7px 11px;font:inherit;font-weight:650;color:var(--c-t2);cursor:pointer;white-space:nowrap}
  .seg button+button{border-left:1px solid var(--c-border)}
  .seg button.on{background:var(--c-primary);color:#fff}
  .seg button.on::before{content:'✓';font-size:10px;margin-right:4px;opacity:.95}
  .seg button:hover:not(.on){background:var(--c-primary-soft)}
  /* 「可多选」提示：多选是 v2 新增的行为，页面上必须自证，否则下一轮有人当单选用 */
  .mhint{font-size:10.5px;color:var(--c-t3);font-weight:650;background:#F0F3F9;border:1px solid var(--c-border);
    border-radius:5px;padding:1px 5px;margin-left:-3px}
  select.sm{padding:5px 8px;font-size:12px;border-radius:7px}
  .note{background:#FFF9E8;border:1px solid #F3DFA8;border-radius:10px;padding:9px 13px;font-size:12px;
    color:#7A5A12;margin-bottom:12px;line-height:1.6}
  .note b{color:#5C4208}
  /* ★★ 必须是 overflow:clip，不能写 hidden。
     hidden 会让 .card 成为**不可滚动的溢出容器**，从而夺走 thead 的 sticky 吸附上下文：
     表头变成「相对卡片盒吸附」，而卡片自身不滚动 ⇒ 吸附永远不触发。
     实测：hidden 时滚到 1500px，th.top = -1180；改成 clip / visible 后 th.top = 58（= topbar 高）。
     clip 与 hidden 的裁切效果相同，但**不创建滚动容器** ⇒ 既不破坏 sticky，又保住圆角裁切。 */
  .card{background:var(--c-surface);border:1px solid var(--c-border);border-radius:12px;box-shadow:var(--shadow);overflow:clip}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  thead th{position:sticky;top:var(--topbar-h);z-index:10;background:#F8FAFD;border-bottom:1px solid var(--c-border);
    box-shadow:0 1px 0 var(--c-border), 0 6px 12px -8px rgba(18,26,51,.18);
    padding:9px 10px;text-align:left;font-size:11.5px;font-weight:750;color:var(--c-t2);white-space:nowrap;cursor:pointer;user-select:none}
  thead th.no{cursor:default}
  thead th .ar{color:var(--c-primary);font-size:10px;margin-left:3px}
  tbody td{padding:7px 10px;border-bottom:1px solid #F1F3F8;vertical-align:middle}
  tbody tr:hover{background:#FAFBFE}
  .nm{font-weight:650;max-width:330px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block}
  .nm .en{color:var(--c-t3);font-weight:500;font-size:11.5px}
  .mono{font-family:var(--font-num)}
  .dim{color:var(--c-t3)}
  .tag{display:inline-block;font-size:10px;font-weight:750;padding:2px 6px;border-radius:5px;line-height:1.4}
  .tag.jidi{background:#FDECEF;color:#B3273F}
  .tag.xd{background:#E7F1FF;color:#0B5ED7}
  .tag.mh{background:#EAF7EF;color:#12693C}
  .tag.mob{background:#F3ECFF;color:#5B21B6}
  .cnt{display:inline-block;min-width:26px;text-align:center;font-family:var(--font-num);font-weight:750;
    padding:2px 7px;border-radius:6px;font-size:11.5px}
  .cnt.y{background:#E8F6EC;color:#0F7A34}
  .cnt.n{background:#F4F5F8;color:#B6BCC9}
  .st{display:inline-block;font-size:11px;font-weight:750;padding:2px 7px;border-radius:6px}
  .st.ok{background:#E8F6EC;color:#0F7A34}
  .st.auth{background:#FFF3DC;color:#9A6100}
  .st.no{background:#F4F5F8;color:#98A0AE}
  .st.un{background:#FBFBFD;color:#C3C9D4;border:1px dashed #E2E6EE}
  .lk{display:flex;gap:6px;align-items:center}
  .btn{border:1px solid var(--c-border2);background:#fff;border-radius:7px;padding:4px 9px;font:inherit;font-size:11.5px;
    font-weight:700;color:var(--c-primary);cursor:pointer;white-space:nowrap}
  .btn:hover{background:var(--c-primary-soft);border-color:var(--c-primary)}
  .btn.solid{background:var(--c-primary);border-color:var(--c-primary);color:#fff}
  .btn.solid:hover{background:var(--c-primary-deep)}
  .btn:disabled{opacity:.55;cursor:default}
  .foot{display:flex;align-items:center;gap:12px;padding:11px 14px;border-top:1px solid var(--c-border);flex-wrap:wrap;
    background:#FCFDFF;font-size:12px;color:var(--c-t2)}
  .foot .sp{margin-left:auto;display:flex;gap:8px;align-items:center}
  .empty{padding:46px 16px;text-align:center;color:var(--c-t3)}
  #mask{position:fixed;inset:0;background:rgba(14,20,38,.5);backdrop-filter:blur(2px);z-index:100;display:none;
    align-items:center;justify-content:center;padding:22px}
  #mask.on{display:flex}
  #dlg{background:#fff;border-radius:14px;width:min(940px,100%);max-height:88vh;display:flex;flex-direction:column;
    box-shadow:var(--shadow-lg);overflow:hidden}
  #dlg .hd{padding:14px 18px;border-bottom:1px solid var(--c-border);display:flex;align-items:center;gap:12px;flex-wrap:wrap}
  #dlg .hd h3{margin:0;font-size:15.5px;font-weight:800;flex:1;min-width:200px}
  #dlg .bd{padding:14px 18px;overflow-y:auto}
  #dlg .ft{padding:11px 18px;border-top:1px solid var(--c-border);display:flex;gap:9px;align-items:center;background:#FCFDFF}
  .sec{margin-bottom:16px}
  .sec>h4{margin:0 0 8px;font-size:12.5px;font-weight:800;display:flex;align-items:center;gap:8px}
  .sec>h4 .bar{width:3px;height:13px;border-radius:2px;background:var(--c-primary);display:inline-block}
  .sec>h4 .n{font-family:var(--font-num);font-size:11px;color:var(--c-t3);font-weight:700}
  /* ★ v10.66：弹窗的动作条（跳站内详情页 / 直接开资源弹窗）。
     为什么单独一行常驻在正文之上：正文会随分类长短滚动，按钮放正文里会被滚走。 */
  .acts{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:11px 18px;border-bottom:1px solid var(--c-border);background:#F7F9FF}
  .acts .dim{font-size:11px}
  /* ★ v10.66：每类最多列 SEC_MAX 条；超出折成一行「还有 N 条」+ 去详情页看全部。
     弹窗定位是**摘要**（一眼看清这游戏有什么），全量在站内详情页的资源模块里。 */
  .more{margin-top:3px;font-size:11.5px;color:var(--c-t2);background:#F4F7FE;border:1px dashed #D6E2FF;
    border-radius:8px;padding:7px 10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .more b{font-family:var(--font-num);color:var(--c-primary)}
  .it{border:1px solid var(--c-border);border-radius:9px;padding:9px 11px;margin-bottom:7px;background:#FDFDFF}
  .it .t1{font-weight:650;font-size:12.5px;margin-bottom:5px;word-break:break-all}
  .it .meta{font-size:11px;color:var(--c-t3);margin-bottom:6px;font-family:var(--font-num)}
  .it .ls{display:flex;gap:6px;flex-wrap:wrap}
  .lnk{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;padding:3px 8px;border-radius:6px;
    background:#EEF3FF;color:#1B4FD8;border:1px solid #D6E2FF}
  .lnk.direct{background:#E8F6EC;color:#0F7A34;border-color:#C7E9D2}
  .lnk:hover{filter:brightness(.96)}
  .none{color:var(--c-t3);font-size:12px;padding:6px 0}
  .spin{display:inline-block;width:12px;height:12px;border:2px solid #D8DEEC;border-top-color:var(--c-primary);
    border-radius:50%;animation:sp .7s linear infinite;vertical-align:-2px}
  @keyframes sp{to{transform:rotate(360deg)}}
  @media(max-width:760px){
    .wrap{padding:10px 10px 50px}
    .nm{max-width:170px}
    input[type=search]{width:100%}
    .kpi{width:100%;justify-content:space-between;gap:8px}
    thead th,tbody td{padding:6px 7px}
    .hidesm{display:none}
  }
</style>
</head>
<body>
<header class="topbar">
  <div class="brand"><span class="dot"></span><span>GameHub 完整名单 <small>ROSTER</small></span></div>
  <div class="kpi">
    <div>总条目<b id="kTotal">-</b></div>
    <div>端游库<b id="kPc">-</b></div>
    <div>手游中心<b id="kMob">-</b></div>
    <div>有三类资源<b id="kRes">-</b></div>
    <div>本体已实测<b id="kBody">-</b></div>
    <div>当前筛选<b id="kView">-</b></div>
  </div>
</header>

<div class="wrap">
  <div class="note">
    <b>先看这里，两条口径</b><br>
    <b>① 「本体」这一列没有全量数据</b>：本体直链只能逐款打源站实时解析，19,497 款逐一抓不现实。
    本页 <b id="noteProbe">-</b> 款带 v10.57 那轮的实测结论（<span class="st ok">可下</span>
    <span class="st auth">需登录</span> <span class="st no">无</span>），其余一律标
    <span class="st un">未测</span> —— <b>点开弹窗可以按需实时查</b>
    （<b>在线打开</b>走本站同源接口；<b>双击本地文件</b>需本地 8123 在跑）。<br>
    <b>② MOD / 存档 / 修改器 三列是全量的</b>，与详情页、资源页同源（覆盖：<b id="noteCover">-</b>）。
    「存档」指<b>可下载的存档文件</b>，不含 Ludusavi 的存档位置记录（那是另一个口径，覆盖约 6,300 款）。<br>
    <b>名单是怎么算的</b>：<span id="noteMerged">-</span><br>
    <b>③ 筛选可以多选</b>：平台多选取<b>并集</b>（端游 ∪ 手游可玩）；资源多选的组合方式由右侧下拉框决定 ——
    <b>需同时具备</b>（逐项收窄，默认）或 <b>任一满足</b>（取并集）。两者结论差别很大，所以不设隐式默认。<br>
    <b>④ 点「查看」开的弹窗每类最多列 5 条</b>（弹窗是摘要），弹窗顶部有
    <b>打开游戏详情页</b> 与 <b>直接打开资源弹窗</b> 两个按钮，超额条目在那里看全部。
  </div>

  <div class="bar">
    <input type="search" id="q" placeholder="搜索游戏名 / 端游库 id">
    <label>平台 <span class="mhint">可多选</span></label>
    <div class="seg" id="segKind" role="group" aria-label="平台筛选（可多选）">
      <button data-v="all" class="on" aria-pressed="true">全部</button>
      <button data-v="pc" aria-pressed="false">端游</button>
      <button data-v="mob" aria-pressed="false">手游可玩</button>
    </div>
    <label>资源 <span class="mhint">可多选</span></label>
    <div class="seg" id="segRes" role="group" aria-label="资源筛选（可多选）">
      <button data-v="all" class="on" aria-pressed="true">不限</button>
      <button data-v="any" aria-pressed="false">有资源</button>
      <button data-v="mod" aria-pressed="false">有 MOD</button>
      <button data-v="saves" aria-pressed="false">有存档</button>
      <button data-v="trainers" aria-pressed="false">有修改器</button>
      <button data-v="body" aria-pressed="false">本体可下</button>
    </div>
    <select id="resMode" class="sm" title="勾选多个资源条件时的组合方式">
      <option value="all" selected>需同时具备</option>
      <option value="any">任一满足</option>
    </select>
    <label>每页</label>
    <select id="pageSz">
      <option>100</option><option selected>200</option><option>500</option><option>1000</option>
    </select>
    <button class="btn" id="reset">重置</button>
  </div>

  <div class="card">
    <table>
      <thead>
        <tr>
          <th class="no" style="width:56px">#</th>
          <th data-sort="name">游戏 <span class="ar"></span></th>
          <th data-sort="src" style="width:92px">来源 <span class="ar"></span></th>
          <th data-sort="size" style="width:92px">大小 <span class="ar"></span></th>
          <th data-sort="hot" style="width:96px">热度 <span class="ar"></span></th>
          <th data-sort="ts" style="width:112px">更新时间 <span class="ar"></span></th>
          <th data-sort="body" style="width:96px">本体 <span class="ar"></span></th>
          <th data-sort="trainers" style="width:88px">修改器 <span class="ar"></span></th>
          <th data-sort="mod" style="width:78px">MOD <span class="ar"></span></th>
          <th data-sort="saves" style="width:78px">存档 <span class="ar"></span></th>
          <th class="no" style="width:96px">链接</th>
        </tr>
      </thead>
      <tbody id="tb"></tbody>
    </table>
    <div class="foot">
      <span id="pgInfo">-</span>
      <div class="sp">
        <button class="btn" id="pFirst">« 首页</button>
        <button class="btn" id="pPrev">‹ 上一页</button>
        <span class="mono" id="pNow">1</span>
        <button class="btn" id="pNext">下一页 ›</button>
        <button class="btn" id="pLast">末页 »</button>
      </div>
    </div>
  </div>
</div>

<div id="mask"><div id="dlg">
  <div class="hd"><h3 id="dTitle">-</h3><button class="btn" id="dClose">关闭 ✕</button></div>
  <div class="acts" id="dActs" hidden></div>
  <div class="bd" id="dBody"></div>
  <div class="ft"><span class="dim" id="dHint"></span></div>
</div></div>

<script id="roster-data" type="application/json">${json}</script>
<script>
(function(){
  var D = JSON.parse(document.getElementById('roster-data').textContent);
  var R = D.rows, L = D.links;
  /* ★★ v10.66：API 基址改**同源自适应** —— 上一版写死 127.0.0.1:8123，
     上线到站点根之后浏览器会把「从 https 页面打 http://127.0.0.1」当混合内容/跨站拦截，
     本体实时查询会静默失败（页面不报错，只是按钮转圈然后说「连不上」）。
     file://（双击本地文件）才回落到本地服务；http(s) 一律同源。 */
  var API = (location.protocol === 'file:') ? 'http://127.0.0.1:8123' : '';
  /* 站内入口（详情页 / 资源弹窗）指向**线上站点**：这份 HTML 可能被离线双击打开，
     也可能被放在站点根，两者都要能一跳到位，所以不能用相对路径、必须用绝对地址。 */
  var SITE = 'https://gamehub-agg-v4.app.workbuddy.host';
  /* 每类最多列几条（超出折成「还有 N 条」+ 去详情页看全部） */
  var SEC_MAX = 5;
  /* ★ 行内 src 存的是**数字**（省字节）⇒ 映射表也必须用数字键。
     首版写成字符串键，结果来源列全显示问号 —— 实测才发现（页面不报错，只是错）。 */
  var SRC_NAME = { 0:'机地', 1:'XDGAME', 2:'手游中心' };
  var SRC_CLS  = { 0:'jidi', 1:'xd', 2:'mh' };
  var BODY_TXT = { 0:['un','未测'], 1:['ok','可下'], 2:['auth','需登录'], 3:['no','无'] };

  /* kind / res 是**数组**（多选）：空数组 = 不限制，与「全部 / 不限」按钮等价 */
  var F = { q:'', kind:[], res:[], resMode:'all', sort:'hot', dir:-1, page:1, size:200 };

  var $ = function(s){ return document.querySelector(s); };
  function fmtSize(s){
    if(!s) return '<span class="dim">—</span>';
    return '<span class="mono">' + s + '</span>';
  }
  function fmtTs(t){
    if(!t) return '<span class="dim">—</span>';
    var d = new Date(t);
    if(isNaN(d)) return '<span class="dim">—</span>';
    return '<span class="mono">' + d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0')
      + '-' + String(d.getDate()).padStart(2,'0') + '</span>';
  }
  function fmtHot(v){ return v ? '<span class="mono">' + v.toLocaleString('en-US') + '</span>' : '<span class="dim">—</span>'; }
  function cnt(n){ return '<span class="cnt ' + (n>0?'y':'n') + '">' + (n>0?n:'—') + '</span>'; }
  function szGb(s){
    if(!s) return -1;
    var m = String(s).match(/([\\d.]+)\\s*(TB|GB|MB)/i);
    if(!m) return -1;
    var v = parseFloat(m[1]);
    return m[2].toUpperCase()==='TB' ? v*1024 : (m[2].toUpperCase()==='MB' ? v/1024 : v);
  }

  /* ── 筛选 + 排序（整批算一次，再切片分页） ──
   * ★ 平台与资源都是**多选**（v2 起）：
   *   平台 = 并集（OR）—— 「端游」与「手游可玩」是两个不同维度，一条记录可同时属于两者，
   *          取并集才是「我要看端游 + 手游」的本意。
   *   资源 = 组合方式由 #resMode 显式决定（默认「需同时具备」= AND，收窄）。
   *          ★ 不给隐式默认：AND/OR 语义不同结论完全不同，必须让用户看得见自己选的是哪种。
   */
  var RES_T = {
    any:      function(r){ return !!(r[7] || r[8] || r[9] || r[6] === 1); },
    mod:      function(r){ return r[7] > 0; },
    saves:    function(r){ return r[8] > 0; },
    trainers: function(r){ return r[9] > 0; },
    body:     function(r){ return r[6] === 1; },
  };
  function kindOk(r){
    if(!F.kind.length) return true;
    for(var i=0;i<F.kind.length;i++){
      var k = F.kind[i];
      if(k==='pc'  && r[2]!==2) return true;
      if(k==='mob' && r[10]===1) return true;
    }
    return false;
  }
  function resOk(r){
    var t = F.res;
    if(!t.length) return true;
    for(var i=0;i<t.length;i++){
      var f = RES_T[t[i]];
      if(!f) continue;
      var v = !!f(r);
      if(F.resMode === 'any'){ if(v) return true; }
      else if(!v) return false;
    }
    return F.resMode !== 'any';
  }
  function view(){
    var q = F.q.trim().toLowerCase();
    var out = [];
    for(var i=0;i<R.length;i++){
      var r = R[i];
      if(!kindOk(r)) continue;
      if(!resOk(r)) continue;
      if(q && r[0].toLowerCase().indexOf(q)<0 && String(r[1]).toLowerCase().indexOf(q)<0) continue;
      out.push(r);
    }
    var s = F.sort, d = F.dir;
    out.sort(function(a,b){
      var x,y;
      if(s==='name'){ x=a[0]; y=b[0]; return d * x.localeCompare(y,'zh'); }
      if(s==='src'){ x=a[2]; y=b[2]; return d*(x-y) || b[4]-a[4]; }
      if(s==='size'){ x=szGb(a[3]); y=szGb(b[3]); return d*(x-y); }
      if(s==='hot'){ x=a[4]; y=b[4]; return d*(x-y); }
      if(s==='ts'){ x=a[5]; y=b[5]; return d*(x-y); }
      if(s==='body'){ x=a[6]; y=b[6]; return d*(x-y); }
      if(s==='mod'){ x=a[7]; y=b[7]; return d*(x-y); }
      if(s==='saves'){ x=a[8]; y=b[8]; return d*(x-y); }
      if(s==='trainers'){ x=a[9]; y=b[9]; return d*(x-y); }
      return 0;
    });
    return out;
  }

  var V = [];
  function render(){
    V = view();
    var tp = Math.max(1, Math.ceil(V.length / F.size));
    if(F.page > tp) F.page = tp;
    var a = (F.page-1)*F.size, b = Math.min(a + F.size, V.length);
    var h = '';
    for(var i=a;i<b;i++){
      var r = V[i];
      var bt = BODY_TXT[r[6]] || BODY_TXT[0];
      h += '<tr>'
        + '<td class="dim mono">' + (i+1) + '</td>'
        + '<td><span class="nm" title="' + esc(r[0]) + '">' + esc(r[0]) + '</span>'
          + '<span class="dim mono" style="font-size:10.5px">' + esc(String(r[1])) + '</span></td>'
        + '<td><span class="tag ' + (SRC_CLS[r[2]]||'mh') + '">' + (SRC_NAME[r[2]]||'?') + '</span>'
          + (r[10] ? ' <span class="tag mob">可手游</span>' : '') + '</td>'
        + '<td>' + fmtSize(r[3]) + '</td>'
        + '<td>' + fmtHot(r[4]) + '</td>'
        + '<td>' + fmtTs(r[5]) + '</td>'
        + '<td><span class="st ' + bt[0] + '">' + bt[1] + '</span></td>'
        + '<td>' + cnt(r[9]) + '</td>'
        + '<td>' + cnt(r[7]) + '</td>'
        + '<td>' + cnt(r[8]) + '</td>'
        + '<td><button class="btn" data-id="' + esc(String(r[1])) + '" data-i="' + i + '">查看</button></td>'
        + '</tr>';
    }
    $('#tb').innerHTML = h || '<tr><td colspan="11"><div class="empty">没有符合条件的条目</div></td></tr>';
    $('#pgInfo').textContent = V.length
      ? ('第 ' + (a+1) + '–' + b + ' 条 / 共 ' + V.length.toLocaleString('en-US') + ' 条（原始 ' + R.length.toLocaleString('en-US') + ' 条）')
      : '0 条';
    $('#pNow').textContent = F.page + ' / ' + tp;
    $('#kView').textContent = V.length.toLocaleString('en-US');
    document.querySelectorAll('#tb button[data-id]').forEach(function(x){
      x.addEventListener('click', function(){ openDlg(V[Number(x.dataset.i)]); });
    });
  }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){
    return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }

  /* ── 弹窗 ── */
  var CAT_NAME = { m:'MOD', sv:'存档', tr:'修改器' };
  /* 站内跳转地址：库里条目（xd-* / jidi-*）能直达详情抽屉与资源弹窗；
     手游中心独有行（mh:*）本地库没有对应记录，退化为「站内搜索」。
     「dl=<页签>」与主站 DL_UNI 的键一一对应（body / mod / modifier / save），
     所以「某类还有 N 条」能直接落到**那一类的页签**，不用用户再点一次。 */
  function isLibId(id){ return /^(xd|jidi)-/.test(String(id || '')); }
  function siteLinks(r){
    var id = String(r[1] || ''), title = String(r[0] || '');
    if(isLibId(id)){
      var base = SITE + '/?open=' + encodeURIComponent(id);
      return {
        detail: base,
        pop: base + '&dl=1',
        tab: function(k){ return base + '&dl=' + k; },
        direct: true,
      };
    }
    var q = SITE + '/?q=' + encodeURIComponent(title);
    return { detail: q, pop: q, tab: function(){ return q; }, direct: false };
  }
  function itemHtml(x){
    var title = x[0] || '(无标题)';
    var meta = [x[1], x[2], x[3], x[7] ? ('下载 ' + x[7]) : ''].filter(Boolean).join(' · ');
    var ls = (x[5]||[]).map(function(l){
      return '<a class="lnk ' + esc(l[2]) + '" href="' + esc(l[1]) + '" target="_blank" rel="noopener">'
        + esc(l[0] || '链接') + ' ↗</a>';
    }).join('');
    if(!ls) ls = '<span class="none">这条没有可下载直链' + (x[6] ? ('（' + esc(x[6]) + '）') : '') + '</span>';
    return '<div class="it"><div class="t1">' + esc(title) + '</div>'
      + (meta ? '<div class="meta">' + esc(meta) + '</div>' : '')
      + '<div class="ls">' + ls + '</div>'
      + (x[4] ? '<div style="margin-top:5px"><a class="lnk" href="' + esc(x[4]) + '" target="_blank" rel="noopener">原贴 ↗</a></div>' : '')
      + '</div>';
  }
  /* 每类最多列 SEC_MAX 条（v10.66 用户口径：「每个最多显示5条」）。
     ★ 超额时**必须给出「还有 N 条」与去处** —— 只截断不说明，用户会以为这就是全部
       （本项目里「静默截断」是一类事故模式，如熔断误判那例）。 */
  function secHtml(head, arr, moreHref){
    if(!arr || !arr.length) return '<div class="sec"><h4><span class="bar"></span>' + head
      + ' <span class="n">0 条</span></h4><div class="none">本游戏没有这一类资源</div></div>';
    var shown = arr.slice(0, SEC_MAX);
    var rest = arr.length - shown.length;
    var h = '<div class="sec"><h4><span class="bar"></span>' + head
      + ' <span class="n">' + arr.length + ' 条</span></h4>' + shown.map(itemHtml).join('');
    if(rest > 0){
      h += '<div class="more"><span>仅显示前 ' + SEC_MAX + ' 条 · 本类共收录 <b>' + arr.length + '</b> 条</span>'
        + (moreHref ? '<a class="lnk" href="' + esc(moreHref) + '" target="_blank" rel="noopener">还有 '
            + '<b>' + rest + '</b> 条，去详情页看全部 ↗</a>' : '<span class="dim">（更多见源站）</span>')
        + '</div>';
    }
    return h + '</div>';
  }
  var curRow = null;
  function openDlg(r){
    curRow = r;
    var g = L[r[1]] || null;
    var lk = siteLinks(r);
    $('#dTitle').textContent = r[0];
    /* 动作条：跳站内详情页 / 直接开站内资源弹窗（v10.66 用户口径：
       「增加一个跳转到该项目详情页以及弹窗的功能」） */
    var acts = $('#dActs');
    acts.hidden = false;
    acts.innerHTML = lk.direct
      ? '<a class="btn solid" href="' + esc(lk.detail) + '" target="_blank" rel="noopener">打开游戏详情页 ↗</a>'
        + '<a class="btn" href="' + esc(lk.pop) + '" target="_blank" rel="noopener">直接打开资源弹窗 ↗</a>'
        + '<span class="dim">在新标签打开线上站（本体 / MOD / 修改器 / 存档 四个模块页签）</span>'
      : '<a class="btn solid" href="' + esc(lk.detail) + '" target="_blank" rel="noopener">在站内搜索这款 ↗</a>'
        + '<span class="dim">手游中心独有条目，本地库没有同款记录 ⇒ 走站内搜索</span>';
    var bt = BODY_TXT[r[6]] || BODY_TXT[0];
    var h = '<div class="sec"><h4><span class="bar"></span>本体 '
      + '<span class="st ' + bt[0] + '">' + bt[1] + '</span>'
      + (r[3] ? ' <span class="n">' + esc(r[3]) + '</span>' : '') + '</h4>'
      + '<div id="bodyBox">' + (r[6]
          ? '<div class="none">来自 v10.57 的逐款实测结论（源站声明值）。</div>'
          : '<div class="none">本地没有这一款的实测结果。</div>') + '</div>'
      + '<div style="margin-top:7px"><button class="btn solid" id="qBody">实时查询本体（打源站，约 2–8 秒）</button>'
      + '<span class="dim" id="qBodyMsg" style="margin-left:9px"></span></div></div>';
    h += '<div class="sec"><h4><span class="bar"></span>端游库</h4>'
      + '<div class="none"><span class="mono">' + esc(String(r[1])) + '</span>'
      + (r[12] ? ' · <a href="' + esc(r[12]) + '" target="_blank" rel="noopener">源站详情页 ↗</a>' : '')
      + (r[11] ? ' · <a href="' + esc(r[11]) + '" target="_blank" rel="noopener">封面 ↗</a>' : '') + '</div></div>';
    h += secHtml('修改器', g && g.tr, lk.tab('modifier'));
    h += secHtml('MOD', g && g.m, lk.tab('mod'));
    h += secHtml('存档', g && g.sv, lk.tab('save'));
    $('#dBody').innerHTML = h;
    $('#dHint').textContent = '每类最多显示 ' + SEC_MAX + ' 条，更多在站内详情页 · 数据源：本地库（MOD / 存档 / 修改器 与详情页同源）';
    $('#mask').classList.add('on');
    var qb = $('#qBody');
    if(qb) qb.addEventListener('click', function(){ queryBody(r, qb); });
  }
  function closeDlg(){ $('#mask').classList.remove('on'); $('#dActs').hidden = true; }

  /* 本体实时查询：走 /api/download（服务端 30 分钟缓存）
   * ★★ 两个源的 items **结构不同、且 real 同名不同义** —— 这是本功能最大的坑：
   *    · 机地  ：items = 帖子流（mod + 修改器**混在一起**，没有分区标记）
   *             链接字段 = real（URL 字符串）；标题 = postTitle；分区只能看 sections
   *    · XDGAME：items = 下载按钮（kind=downbtn）
   *             链接字段 = serverUrl；real 是**布尔**（是否真实可下）；需登录时 count=0 但仍有入口
   *   ⇒ 对机地**绝不能**把 items 当本体列出来（会拿 MOD 冒充本体）；
   *     机地只按 sections 报各专区条数，本体链接给源站出口。 */
  function queryBody(r, btn){
    var id = String(r[1]);
    var src = r[2]===0 ? 'jidi' : (r[2]===1 ? 'xdgamer' : '');
    var msg = $('#qBodyMsg'), box = $('#bodyBox');
    if(!src){ msg.textContent = '手游中心条目没有本体通道'; return; }
    if(!/^(jidi|xd)-/.test(id)){ msg.textContent = '这条没有可查的源站 id'; return; }
    btn.disabled = true;
    msg.innerHTML = '<span class="spin"></span> 正在打源站…';
    var srcId = id.replace(/^(jidi|xd)-/, '');
    fetch(API + '/api/download?source=' + src + '&id=' + encodeURIComponent(srcId))
      .then(function(x){ return x.json(); })
      .then(function(j){
        btn.disabled = false;
        if(!j || !j.ok){
          msg.textContent = '查询失败：' + ((j && j.error) || '未知');
          box.innerHTML = '<div class="none">源站没给出可用的本体通道。</div>';
          return;
        }
        var secs = j.sections, out = '';
        if(secs && secs.length){
          /* ── 机地：只看 sections，items 不列（避免 MOD 冒充本体） ── */
          var body = null;
          secs.forEach(function(s){ if(s.key === 'body') body = s; });
          var bn = body ? (body.count || 0) : 0;
          msg.textContent = bn ? ('机地本体专区 ' + bn + ' 条') : '机地本体专区为空';
          out += '<div class="none">机地本体：' + (bn
            ? ('<b>' + bn + ' 条</b> —— 链接在源站话题页的资源区，需点进源站查看')
            : '<b>该话题的「本体」专区没有条目</b>') + '</div>';
          out += '<div class="none" style="margin-top:5px">源站分区：'
            + secs.map(function(s){ return esc(s.name || s.key) + ' ' + (s.count || 0); }).join(' · ') + '</div>';
          out += '<div style="margin-top:8px"><a class="lnk" href="'
            + esc(j.url || ('https://jidiyouxi.com/post/topic/' + srcId))
            + '" target="_blank" rel="noopener">去机地源站看本体 ↗</a></div>';
        } else {
          /* ── XDGAME：items 就是下载按钮 ── */
          var all = (j.items || []).filter(function(x){
            return x && (x.serverUrl || (typeof x.real === 'string' && x.real));
          });
          var okL = all.filter(function(x){ return !x.needAuth; });
          var auL = all.filter(function(x){ return x.needAuth; });
          msg.textContent = okL.length ? ('拿到 ' + okL.length + ' 条地址')
            : (auL.length ? ('源站要求登录（' + auL.length + ' 个入口）') : '源站没有给通道');
          var show = okL.concat(auL).slice(0, 10);
          if(!show.length){
            out = '<div class="none">这一款在 XDGAME 没有本体下载通道'
              + (j.needAuth ? '（需登录源站后查看）' : '') + '。</div>';
          } else {
            /* ★ 源站对同一款会给多个 uhash 入口（同一 reason）⇒ 登录态下它们文案完全一样。
               全铺出来是一屏同款卡片，所以：同一 error 文案只展示一条，其余折成计数。 */
            var seen = {}, uniq = [];
            show.forEach(function(x){ var k = (x.error || '') + '|' + (x.name || ''); if(seen[k]) return; seen[k] = 1; uniq.push(x); });
            out = uniq.map(function(x){
              var u = x.serverUrl || x.real;
              var ne = !!x.needAuth;
              var dup = all.filter(function(y){ return y.needAuth === ne
                && (y.serverUrl || y.real) && (y.error || '') === (x.error || '') && (y.name || '') === (x.name || ''); }).length;
              return '<div class="it"><div class="t1">'
                + esc(x.name || (ne ? '源站下载入口' : '下载通道'))
                + (ne ? ' <span class="st auth">需登录</span>' : ' <span class="st ok">可下</span>')
                + (dup > 1 ? ' <span class="dim mono">×' + dup + '</span>' : '') + '</div>'
                + (x.error ? '<div class="meta">' + esc(x.error) + '</div>' : '')
                + '<div class="ls"><a class="lnk ' + (ne ? '' : 'direct') + '" href="' + esc(u)
                + '" target="_blank" rel="noopener">' + (ne ? '去源站登录 ↗' : '打开 ↗') + '</a></div></div>';
            }).join('');
          }
        }
        box.innerHTML = out;
      })
      .catch(function(e){
        btn.disabled = false;
        msg.textContent = '接口没连上';
        box.innerHTML = '<div class="none">实时查本体需要本站接口：'
          + '<b>在线打开</b>时走同源接口（若失败说明线上服务异常）；'
          + '<b>双击本地文件</b>时需本地 8123 在跑。'
          + 'MOD / 存档 / 修改器 三列不受影响。</div>';
      });
  }

  /* ── 事件绑定 ──
   * 多选 chip 组：
   *   点具体项 = toggle（可同时选中多个）
   *   点「全部 / 不限」= 清空选择（= 不限制）
   *   ★ 最后一个具体项被取消时自动落回「全部 / 不限」——
   *     否则会出现「一个都没选」的空语义死区（用户以为筛掉了全部，实际是没筛）
   *   aria-pressed 与 .on 同步，既是无障碍语义、也是防线可测的钩子
   */
  function syncSeg(sel, key, allVal){
    document.querySelectorAll(sel + ' button').forEach(function(b){
      var on = F[key].length === 0 ? b.dataset.v === allVal : F[key].indexOf(b.dataset.v) >= 0;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  function segBind(sel, key, allVal){
    document.querySelector(sel).addEventListener('click', function(e){
      var b = e.target && e.target.closest ? e.target.closest('button[data-v]') : null;
      if(!b) return;
      var v = b.dataset.v;
      if(v === allVal){ F[key] = []; }
      else {
        var i = F[key].indexOf(v);
        if(i >= 0) F[key].splice(i, 1); else F[key].push(v);
      }
      syncSeg(sel, key, allVal);
      F.page = 1; render();
    });
  }
  segBind('#segKind','kind','all'); segBind('#segRes','res','all');
  syncSeg('#segKind','kind','all'); syncSeg('#segRes','res','all');
  $('#resMode').addEventListener('change', function(e){
    F.resMode = e.target.value === 'any' ? 'any' : 'all'; F.page = 1; render();
  });
  $('#q').addEventListener('input', function(e){ F.q = e.target.value; F.page = 1; render(); });
  $('#pageSz').addEventListener('change', function(e){ F.size = Number(e.target.value)||200; F.page = 1; render(); });
  $('#reset').addEventListener('click', function(){
    F.q=''; F.kind=[]; F.res=[]; F.resMode='all'; F.sort='hot'; F.dir=-1; F.page=1;
    $('#q').value=''; $('#resMode').value='all';
    syncSeg('#segKind','kind','all'); syncSeg('#segRes','res','all');
    markSort(); render();
  });
  $('#pFirst').addEventListener('click', function(){ F.page=1; render(); });
  $('#pPrev').addEventListener('click', function(){ if(F.page>1){F.page--; render();} });
  $('#pNext').addEventListener('click', function(){ F.page++; render(); });
  $('#pLast').addEventListener('click', function(){ F.page=1e9; render(); });
  $('#dClose').addEventListener('click', closeDlg);
  $('#mask').addEventListener('click', function(e){ if(e.target === $('#mask')) closeDlg(); });
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape') closeDlg(); });

  function markSort(){
    document.querySelectorAll('thead th[data-sort]').forEach(function(th){
      var a = th.querySelector('.ar');
      a.textContent = th.dataset.sort === F.sort ? (F.dir < 0 ? '▼' : '▲') : '';
    });
  }
  document.querySelectorAll('thead th[data-sort]').forEach(function(th){
    th.addEventListener('click', function(){
      var s = th.dataset.sort;
      if(F.sort === s) F.dir = -F.dir; else { F.sort = s; F.dir = (s==='name'||s==='src') ? 1 : -1; }
      markSort(); render();
    });
  });

  /* ── KPI（全部取生成期算好的 meta，页面不重复统计 —— 一处口径） ── */
  var M = D.meta || {};
  var nRes = (M.nRes != null) ? M.nRes : 0, nBody = (M.nBody != null) ? M.nBody : 0;
  $('#kTotal').textContent = R.length.toLocaleString('en-US');
  $('#kPc').textContent = (M.nPc || 0).toLocaleString('en-US');
  $('#kMob').textContent = (M.nMob || 0).toLocaleString('en-US');
  $('#kRes').textContent = nRes.toLocaleString('en-US');
  $('#kBody').textContent = nBody.toLocaleString('en-US');
  $('#noteProbe').textContent = nBody;
  if (M.nMobMerged) {
    $('#noteMerged').innerHTML = '手游中心共 <b>' + (M.nMob || 0).toLocaleString('en-US') + '</b> 款，其中 <b>'
      + M.nMobMerged.toLocaleString('en-US') + '</b> 款与端游库同款 —— 它们<b>并进端游那一行</b>（带「可手游」标签），'
      + '所以表内手游独有 <b>' + (M.nMobOnly || 0).toLocaleString('en-US') + '</b> 行；总行数 <b>'
      + R.length.toLocaleString('en-US') + '</b> = 端游库 ' + (M.nPc || 0).toLocaleString('en-US')
      + ' + 手游独有 ' + (M.nMobOnly || 0).toLocaleString('en-US') + '。';
  }
  if (M.cover) {
    $('#noteCover').textContent = 'MOD ' + M.cover.mod + ' 款 · 存档 ' + M.cover.saves
      + ' 款 · 修改器 ' + M.cover.trainers + ' 款';
  }

  markSort(); render();
  window.__ROSTER__ = { data:D, view:function(){ return V; }, filter:F };
})();
</script>
</body>
</html>`;

fs.writeFileSync(OUT, html);
/* ★ v10.66：同时产出一份到 public/roster/index.html —— 这是**线上稳定短链**的落点
   （`https://<站点>/roster/`，目录自动吃 index.html）。
   为什么要进 public：站点静态根就是 public（server.js 里 express.static('public')），
   放别处访问不到；覆盖式部署也不需要额外的路由。 */
fs.mkdirSync(path.dirname(WEB), { recursive: true });
fs.writeFileSync(WEB, html);
const MB = (Buffer.byteLength(html) / 1048576).toFixed(2);
console.log(`[roster] 产出 ${path.relative(ROOT, OUT)}  ${MB} MB`);
console.log(`[roster] 产出 ${path.relative(ROOT, WEB)}  ${MB} MB（线上短链 /roster/）`);
