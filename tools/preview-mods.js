/**
 * tools/preview-mods.js — 生成「MOD / 修改器」抓取预览页（自包含单文件）
 *
 * 用途：把 tools/fetch-mods.js 抓到的真实数据渲染成**与手机专区同一套视觉**的页面，
 *       点卡片打开抽屉、抽屉里铺满正文（含网盘直链），用来核验：
 *         ① 抓取质量（封面/游戏名/作者/正文/链接 是否齐）
 *         ② 展示形态（卡片信息密度、抽屉正文排版）
 *       确认之后再把这一块正式并进站点。
 *
 * ★ 样式不是重写的：直接从 public/emulator.html 里抽出 <style> 整块内联进来，
 *   所以预览页的观感 = 线上观感，不会出现「预览好看、并进去变样」。
 *
 * ★ 数据是内嵌子集（全量 8,900 条 JSON 有 23MB，塞进 HTML 不现实）：
 *   取每类最新 PREVIEW_CAP 条 + 「条目最多的游戏」榜（榜是全量统计出来的，不受子集影响）。
 *
 * 用法：node tools/preview-mods.js [每类条数，默认 250]
 * 产出：_preview/mods-preview.html
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, '_preview');
const OUT = path.join(OUT_DIR, 'mods-preview.html');
const CAP = parseInt(process.argv[2], 10) || 400;

const mods = require('../data/mods');

/** 从 emulator.html 抽出整套样式，保证预览与线上同源 */
function siteStyle() {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'emulator.html'), 'utf8');
  const m = html.match(/<style>([\s\S]*?)<\/style>/);
  if (!m) throw new Error('未能从 emulator.html 抽出 <style>');
  return m[1];
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** JSON 内嵌到 <script> 里必须转义 `<`，否则正文里出现 `</script>` 会直接截断文档 */
const jsonForScript = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '');

function main() {
  const all = mods.ensure().items || [];
  const stats = mods.stats();
  const topGames = mods.topGames(24);

  const pick = (kind) => all.filter((x) => x.kind === kind)
    .sort((a, b) => (b.ut || b.ct || 0) - (a.ut || a.ct || 0))
    .slice(0, CAP);

  /* 只取「最新」会让样本很偏：条目最多的那几款（赛博朋克 719 条 / 老滚5 557 条…）
     大多是好几个月前发的，按时间取会被切干净 → 搜「赛博朋克」只出 2 条，看着像抓漏了。
     所以再**按游戏补一遍**：条目最多的前 TOP_GAMES 款各补 TOP_PER_GAME 条。 */
  const TOP_GAMES = 12, TOP_PER_GAME = 60;
  const extra = [];
  for (const g of topGames.slice(0, TOP_GAMES)) {
    extra.push(...all.filter((x) => x.game === g.game)
      .sort((a, b) => (b.ut || b.ct || 0) - (a.ut || a.ct || 0))
      .slice(0, TOP_PER_GAME));
  }

  const merged = new Map();
  for (const x of [...pick('mod'), ...pick('modifier'), ...extra]) merged.set(x.id, x);

  const data = [...merged.values()].map((x) => ({
    id: x.id, kind: x.kind, title: x.title, game: x.game, cover: x.cover,
    author: x.author, ct: x.ct, ut: x.ut, pv: x.pv, content: x.content,
    links: x.links, libId: x.libId, libTitle: x.libTitle, libUrl: x.libUrl, url: x.url,
  }));

  const byKind = stats.byKind || {};
  const pvStats = {
    total: stats.total, mod: byKind.mod || 0, modifier: byKind.modifier || 0,
    matchedRate: stats.matchedRate, linkTotal: stats.linkTotal, games: stats.games,
    withLinks: stats.withLinks, shown: data.length,
    builtAt: new Date(Date.now()).toISOString().slice(0, 16).replace('T', ' '),
    srcBuiltAt: stats.builtAt ? new Date(stats.builtAt).toLocaleString('zh-CN', { hour12: false }) : '—',
  };

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MOD / 修改器 · 抓取预览 — GameHub</title>
<style>
${siteStyle()}

/* ===== 预览页自身样式（只做这一页要用的：筛选条 / 网格 / 抽屉），上面那套是线上同源 ===== */
.pv-head{background:#fff;border-bottom:1px solid var(--c-border);padding:18px 0 14px}
.pv-head h1{font-size:19px;font-weight:800;letter-spacing:.2px}
.pv-head h1 em{font-style:normal;color:var(--c-primary)}
.pv-sub{font-size:12.5px;color:var(--c-t2);margin-top:5px}
.pv-kpis{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.pv-kpi{background:#F3F5F9;border:1px solid var(--c-border);border-radius:10px;padding:7px 12px;line-height:1.25}
.pv-kpi b{display:block;font:800 16px/1.1 var(--font-num);color:var(--c-primary)}
.pv-kpi span{font-size:10.5px;color:var(--c-t3);font-weight:650}
.pv-kpi.warn b{color:#C2410C}

.pv-bar{position:sticky;top:0;z-index:30;background:rgba(243,245,249,.94);backdrop-filter:blur(10px);border-bottom:1px solid var(--c-border);padding:10px 0}
.pv-bar .in{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.pv-pills{display:flex;gap:3px;background:#EAEEF5;padding:3px;border-radius:10px}
.pv-pill{font-size:12.5px;font-weight:700;color:var(--c-t2);padding:5px 13px;border-radius:8px;transition:.15s;white-space:nowrap}
.pv-pill.on{background:#fff;color:var(--c-primary);box-shadow:0 1px 4px rgba(18,26,51,.08)}
.pv-pill:hover{color:var(--c-primary)}
.pv-input{flex:1;min-width:180px;background:#fff;border:1px solid var(--c-border);border-radius:10px;padding:7px 12px;font:inherit;font-size:12.5px;outline:none}
.pv-input:focus{border-color:var(--c-primary);box-shadow:0 0 0 3px rgba(46,107,255,.1)}
.pv-toggle{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:var(--c-t2);background:#fff;border:1px solid var(--c-border);border-radius:10px;padding:7px 12px;transition:.15s}
.pv-toggle.on{color:#C2410C;background:#FFF3EA;border-color:#FCD9BC}
.pv-toggle:hover{border-color:var(--c-primary)}

.pv-section{font-size:13px;font-weight:750;color:var(--c-t2);margin:22px 0 10px;display:flex;align-items:center;gap:8px}
.pv-section .bar{width:4px;height:15px;border-radius:2px;background:var(--c-primary)}
.pv-section .n{font-size:11.5px;font-weight:650;color:var(--c-t3)}

.pv-top{display:flex;gap:8px;overflow-x:auto;padding-bottom:6px}
.pv-topg{flex:none;width:132px;background:#fff;border:1px solid var(--c-border);border-radius:11px;overflow:hidden;cursor:pointer;transition:.16s}
.pv-topg:hover{border-color:var(--c-primary);transform:translateY(-1px);box-shadow:0 8px 20px rgba(46,107,255,.1)}
.pv-topg .c{height:62px;background:#EEF1F7}
.pv-topg .c img{width:100%;height:100%;object-fit:cover}
.pv-topg .t{padding:7px 9px}
.pv-topg .nm{font-size:11.5px;font-weight:750;line-height:1.3;height:30px;overflow:hidden}
.pv-topg .ct{font-size:10.5px;font-weight:700;color:#C2410C;margin-top:3px}

.pv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:12px;margin-top:12px}
.pv-card{position:relative;display:flex;flex-direction:column;gap:7px;background:#fff;border:1px solid var(--c-border);border-radius:13px;padding:11px 12px;cursor:pointer;transition:.16s;overflow:hidden}
.pv-card:hover{border-color:#F5A97F;box-shadow:0 8px 22px rgba(194,65,12,.1);transform:translateY(-1px)}
.pv-card .cov{position:relative;height:88px;margin:-1px -2px 3px;border-radius:9px;overflow:hidden;background:#EEF1F7}
.pv-card .cov img{width:100%;height:100%;object-fit:cover}
.pv-card .nm{font-size:13px;font-weight:750;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:35px}
.pv-card .tags{display:flex;gap:5px;flex-wrap:wrap}
.pv-card .tg{font-size:10px;font-weight:650;color:var(--c-t3);background:#F3F5F9;border-radius:5px;padding:2px 7px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pv-card .tg.kmod{color:#1D4ED8;background:#EFF4FF}
.pv-card .tg.kmodifier{color:#0F766E;background:#ECFDF5}
.pv-card .tg.lk{color:#7C3AED;background:#F5F3FF}
.pv-card .ft{font-size:10.5px;font-weight:650;color:var(--c-t3);border-top:1px dashed var(--c-border);padding-top:7px;margin-top:1px;display:flex;justify-content:space-between;gap:6px}
.pv-card .ft b{color:var(--c-primary);font-weight:750}
.pv-card .ft.none b{color:var(--c-t3)}

.pv-more{text-align:center;margin:22px 0 60px}
.pv-more button{font-size:12.5px;font-weight:700;color:var(--c-primary);background:#fff;border:1px solid var(--c-border);border-radius:10px;padding:9px 22px}
.pv-more button:hover{border-color:var(--c-primary)}

/* ===== 抽屉：铺满正文 ===== */
.pv-mask{position:fixed;inset:0;background:rgba(12,18,38,.42);opacity:0;pointer-events:none;transition:.2s;z-index:80}
.pv-mask.on{opacity:1;pointer-events:auto}
.pv-drawer{position:fixed;top:0;right:0;bottom:0;width:min(clamp(560px,46vw,900px),100vw);background:#fff;box-shadow:-18px 0 50px rgba(12,18,38,.2);transform:translateX(102%);transition:transform .26s cubic-bezier(.4,0,.2,1);z-index:90;display:flex;flex-direction:column}
.pv-drawer.on{transform:none}
.pv-drawer .hd{display:flex;align-items:flex-start;gap:12px;padding:16px 20px;border-bottom:1px solid var(--c-border);flex:none}
.pv-drawer .hd h3{flex:1;font-size:15px;font-weight:800;line-height:1.4}
.pv-drawer .x{flex:none;width:30px;height:30px;border-radius:9px;background:#F3F5F9;color:var(--c-t2);font-size:16px;display:grid;place-items:center}
.pv-drawer .x:hover{background:#E6E9F0}
.pv-drawer .bd{flex:1;overflow:auto;padding:16px 20px 40px}
.pv-game{display:flex;gap:12px;align-items:center;background:#F7F9FC;border:1px solid var(--c-border);border-radius:12px;padding:11px;margin-bottom:14px}
.pv-game .c{width:112px;height:52px;border-radius:8px;overflow:hidden;background:#EEF1F7;flex:none}
.pv-game .c img{width:100%;height:100%;object-fit:cover}
.pv-game .t{flex:1;min-width:0}
.pv-game .t b{display:block;font-size:13.5px;font-weight:750;line-height:1.35}
.pv-game .t span{font-size:11px;color:var(--c-t3)}
.pv-blk{margin-bottom:16px}
.pv-blk h4{font-size:12.5px;font-weight:800;color:var(--c-t2);margin-bottom:9px;display:flex;align-items:center;gap:7px}
.pv-blk h4 .n{font-size:11px;font-weight:650;color:var(--c-t3)}
.pv-lk{display:flex;align-items:center;gap:9px;background:#F7F9FC;border:1px solid var(--c-border);border-radius:10px;padding:9px 11px;margin-bottom:7px}
.pv-lk .kd{flex:none;font-size:10.5px;font-weight:750;color:#7C3AED;background:#F5F3FF;border-radius:6px;padding:2px 8px}
.pv-lk a{flex:1;min-width:0;font-size:11.5px;color:var(--c-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;word-break:break-all}
.pv-lk a:hover{text-decoration:underline}
.pv-lk .cp{flex:none;font-size:11px;font-weight:700;color:var(--c-t2);background:#fff;border:1px solid var(--c-border);border-radius:7px;padding:3px 9px}
.pv-lk .cp:hover{border-color:var(--c-primary);color:var(--c-primary)}
.pv-body{white-space:pre-wrap;word-break:break-word;font-size:12.5px;line-height:1.75;color:var(--c-t1);background:#FBFCFE;border:1px solid var(--c-border);border-radius:12px;padding:14px;max-height:none}
.pv-body a{color:var(--c-primary)}
.pv-acts{display:flex;gap:9px;flex-wrap:wrap}
.pv-acts a,.pv-acts button{font-size:12.5px;font-weight:750;border-radius:10px;padding:9px 16px;border:1px solid var(--c-border);background:#fff;color:var(--c-t2)}
.pv-acts a.pri{background:var(--c-primary);border-color:transparent;color:#fff}
.pv-acts a:hover,.pv-acts button:hover{border-color:var(--c-primary);color:var(--c-primary)}
.pv-acts a.pri:hover{background:var(--c-primary-deep);color:#fff}
.pv-raw{font-size:11px;color:var(--c-t3);margin-top:12px;line-height:1.7}
.pv-empty{text-align:center;color:var(--c-t3);font-size:13px;padding:50px 0}
@media(max-width:700px){.pv-drawer{width:100vw}}
</style>
</head>
<body>

<header class="pv-head">
  <div class="wrap">
    <h1>MOD / 修改器 · <em>抓取预览</em></h1>
    <div class="pv-sub">
      数据源：<b>jidiyouxi.com/modify/list</b> 的「MOD」「修改器」两个页签 —— 轮询其 <code>post_list</code> 接口全量取回。
      本页为核验用预览：样式直接取自线上 <code>emulator.html</code>，卡片/抽屉观感即并入后的观感。
    </div>
    <div class="pv-kpis" id="kpis"></div>
  </div>
</header>

<div class="pv-bar">
  <div class="wrap in">
    <div class="pv-pills" id="kindPills">
      <button class="pv-pill on" data-kind="">全部 <span id="cntAll"></span></button>
      <button class="pv-pill" data-kind="mod">MOD <span id="cntMod"></span></button>
      <button class="pv-pill" data-kind="modifier">修改器 <span id="cntMdf"></span></button>
    </div>
    <div class="pv-pills" id="sortPills">
      <button class="pv-pill on" data-sort="new">最新更新</button>
      <button class="pv-pill" data-sort="hot">最多浏览</button>
    </div>
    <input class="pv-input" id="q" type="search" placeholder="搜标题 / 游戏名 / 作者…">
    <button class="pv-toggle on" id="tgLib">仅看命中端游库</button>
  </div>
</div>

<main class="wrap">
  <div class="pv-section"><span class="bar"></span>条目最多的游戏<span class="n">（全量统计 · 点击筛选）</span></div>
  <div class="pv-top" id="topGames"></div>

  <div class="pv-section"><span class="bar"></span>条目列表<span class="n" id="listMeta"></span></div>
  <div class="pv-grid" id="grid"></div>
  <div class="pv-more"><button id="moreBtn" class="hidden">加载更多</button></div>
</main>

<div class="pv-mask" id="mask"></div>
<aside class="pv-drawer" id="drawer">
  <div class="hd"><h3 id="dTitle"></h3><button class="x" id="dClose">×</button></div>
  <div class="bd" id="dBody"></div>
</aside>

<script>
const DATA = ${jsonForScript(data)};
const STATS = ${jsonForScript(pvStats)};
const TOP = ${jsonForScript(topGames)};

const $ = (s, r) => (r || document).querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDate = (s) => {
  if (!s) return '—';
  const d = new Date(s * 1000), p = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const same = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  return same ? p(d.getMonth() + 1) + '-' + p(d.getDate()) : d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
};

let state = { kind: '', sort: 'new', q: '', libOnly: true, game: '', limit: 60 };

/* ---- KPI ---- */
$('#kpis').innerHTML = [
  ['条目总数', STATS.total.toLocaleString(), ''],
  ['MOD', STATS.mod.toLocaleString(), ''],
  ['修改器', STATS.modifier.toLocaleString(), ''],
  ['命中端游库', STATS.matchedRate + '%', STATS.matchedRate >= 60 ? '' : 'warn'],
  ['含下载链接', STATS.withLinks.toLocaleString() + ' 条', ''],
  ['链接合计', STATS.linkTotal.toLocaleString(), ''],
  ['覆盖游戏', STATS.games.toLocaleString(), ''],
  ['本页内嵌', STATS.shown.toLocaleString() + ' 条', ''],
].map(([k, v, cls]) => '<div class="pv-kpi ' + cls + '"><b>' + v + '</b><span>' + k + '</span></div>').join('');

/* ---- 顶部游戏榜 ---- */
$('#topGames').innerHTML = TOP.map((g) =>
  '<div class="pv-topg" data-game="' + esc(g.game) + '">' +
    '<div class="c">' + (g.cover ? '<img loading="lazy" src="' + esc(g.cover) + '" alt="">' : '') + '</div>' +
    '<div class="t"><div class="nm">' + esc(g.game) + '</div><div class="ct">' + g.total + ' 条' + (g.libId ? '' : ' · 未关联') + '</div></div>' +
  '</div>').join('');

/* ---- 筛选 ---- */
function pool() {
  let a = DATA.slice();
  if (state.kind) a = a.filter((x) => x.kind === state.kind);
  if (state.libOnly) a = a.filter((x) => x.libId);
  if (state.game) a = a.filter((x) => x.game === state.game);
  const q = state.q.trim().toLowerCase();
  if (q) a = a.filter((x) => [x.title, x.game, x.author, x.libTitle].some((v) => String(v || '').toLowerCase().includes(q)));
  if (state.sort === 'hot') a.sort((x, y) => (y.pv || 0) - (x.pv || 0));
  else a.sort((x, y) => (y.ut || y.ct || 0) - (x.ut || x.ct || 0));
  return a;
}
function counts() {
  const f = (k) => DATA.filter((x) => (!k || x.kind === k) && (!state.libOnly || x.libId)).length;
  $('#cntAll').textContent = f('');
  $('#cntMod').textContent = f('mod');
  $('#cntMdf').textContent = f('modifier');
}

function cardHTML(x) {
  const lk = x.links || [];
  const kinds = [...new Set(lk.map((l) => l.kind))].slice(0, 2);
  return '<article class="pv-card" data-id="' + x.id + '">' +
    '<div class="cov">' + (x.cover ? '<img loading="lazy" src="' + esc(x.cover) + '" alt="">' : '') + '</div>' +
    '<div class="nm">' + esc(x.title) + '</div>' +
    '<div class="tags">' +
      '<span class="tg k' + x.kind + '">' + (x.kind === 'mod' ? 'MOD' : '修改器') + '</span>' +
      (lk.length ? '<span class="tg lk">' + lk.length + ' 个下载地址</span>' : '<span class="tg">无下载地址</span>') +
      kinds.map((k) => '<span class="tg">' + esc(k) + '</span>').join('') +
    '</div>' +
    '<div class="tags"><span class="tg">' + esc(x.game || '未标注游戏') + '</span></div>' +
    '<div class="ft' + (x.libId ? '' : ' none') + '"><span>' + fmtDate(x.ut || x.ct) + ' · ' + esc(x.author || '匿名') + '</span>' +
      '<b>' + (x.libId ? '已关联' : '未关联') + '</b></div>' +
  '</article>';
}

function render() {
  const a = pool();
  const shown = a.slice(0, state.limit);
  $('#grid').innerHTML = shown.length ? shown.map(cardHTML).join('') : '<div class="pv-empty">没有符合条件的条目</div>';
  $('#listMeta').textContent = '共 ' + a.length + ' 条' + (state.game ? ' · 游戏「' + state.game + '」' : '') +
    (a.length > shown.length ? '，已显示 ' + shown.length : '') +
    '　·　本页只内嵌了最新 ' + STATS.shown + ' 条，全量 ' + STATS.total + ' 条走 /api/mods/list';
  $('#moreBtn').classList.toggle('hidden', a.length <= state.limit);
  counts();
}

/* ---- 抽屉 ---- */
function openDrawer(id) {
  const x = DATA.find((v) => v.id === id);
  if (!x) return;
  $('#dTitle').textContent = x.title;
  const lk = x.links || [];
  const lkHTML = lk.length
    ? lk.map((l) => '<div class="pv-lk"><span class="kd">' + esc(l.kind) + '</span>' +
        '<a href="' + esc(l.url) + '" target="_blank" rel="noreferrer noopener" title="' + esc(l.url) + '">' + esc(l.url) + '</a>' +
        '<button class="cp" data-copy="' + esc(l.url) + '">复制</button></div>').join('')
    : '<div style="font-size:12.5px;color:var(--c-t3)">这条正文里没有可识别的下载地址（可能是提问/讨论帖）</div>';

  /* 正文里的 URL 变成可点链接，其余原样保留换行 */
  const bodyHTML = esc(x.content || '（正文为空）').replace(/(https?:\\/\\/[^\\s"'<>）)】\\]]+)/g,
    (u) => '<a href="' + u + '" target="_blank" rel="noreferrer noopener">' + u + '</a>');

  $('#dBody').innerHTML =
    '<div class="pv-game">' +
      '<div class="c">' + (x.cover ? '<img src="' + esc(x.cover) + '" alt="">' : '') + '</div>' +
      '<div class="t"><b>' + esc(x.game || '未标注游戏') + '</b>' +
        '<span>' + (x.kind === 'mod' ? 'MOD' : '修改器') + ' · 作者 ' + esc(x.author || '匿名') +
        ' · 更新 ' + fmtDate(x.ut || x.ct) + ' · 浏览 ' + (x.pv || 0) +
        (x.libTitle ? ' · 已关联端游库' : ' · <b style="color:#C2410C">未关联端游库</b>') + '</span></div>' +
    '</div>' +
    '<div class="pv-blk"><h4>下载地址<span class="n">' + lk.length + ' 个</span></h4>' + lkHTML + '</div>' +
    '<div class="pv-blk"><h4>正文（站点原样保留）<span class="n">' + String(x.content || '').length + ' 字</span></h4>' +
      '<div class="pv-body" id="dContent">' + bodyHTML + '</div></div>' +
    '<div class="pv-blk pv-acts">' +
      (x.libId ? '<a class="pri" href="' + esc(x.libUrl) + '" target="_blank" rel="noreferrer noopener">到端游库看这款游戏</a>' : '') +
      '<a href="' + esc(x.url) + '" target="_blank" rel="noreferrer noopener">到机地看原帖 ↗</a>' +
      '<button data-copy="' + esc(x.title) + '">复制标题</button>' +
    '</div>' +
    '<div class="pv-raw">条目 id ' + x.id + ' · 机地封面 ' + (x.cover || '—') + '</div>';

  /* 正文块自己滚，不撑破抽屉：内容超过 42vh 就限高 */
  const c = $('#dContent');
  if (c && c.scrollHeight > window.innerHeight * 0.42) { c.style.maxHeight = '42vh'; c.style.overflow = 'auto'; }

  $('#drawer').classList.add('on');
  $('#mask').classList.add('on');
}
function closeDrawer() { $('#drawer').classList.remove('on'); $('#mask').classList.remove('on'); }

/* ---- 事件 ---- */
$('#mask').addEventListener('click', closeDrawer);
$('#dClose').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

$('#grid').addEventListener('click', (e) => {
  const c = e.target.closest('.pv-card');
  if (c) openDrawer(c.dataset.id);
});
$('#topGames').addEventListener('click', (e) => {
  const g = e.target.closest('.pv-topg');
  if (!g) return;
  state.game = state.game === g.dataset.game ? '' : g.dataset.game;
  state.limit = 60;
  [...$('#topGames').children].forEach((el) => el.style.outline = el === g && state.game ? '2px solid #2E6BFF' : '');
  render();
});
$('#kindPills').addEventListener('click', (e) => {
  const b = e.target.closest('.pv-pill'); if (!b) return;
  state.kind = b.dataset.kind; state.limit = 60;
  [...$('#kindPills').children].forEach((el) => el.classList.toggle('on', el === b));
  render();
});
$('#sortPills').addEventListener('click', (e) => {
  const b = e.target.closest('.pv-pill'); if (!b) return;
  state.sort = b.dataset.sort;
  [...$('#sortPills').children].forEach((el) => el.classList.toggle('on', el === b));
  render();
});
$('#tgLib').addEventListener('click', () => {
  state.libOnly = !state.libOnly;
  $('#tgLib').classList.toggle('on', state.libOnly);
  state.limit = 60; render();
});
let t = null;
$('#q').addEventListener('input', (e) => {
  clearTimeout(t);
  t = setTimeout(() => { state.q = e.target.value; state.limit = 60; render(); }, 140);
});
$('#moreBtn').addEventListener('click', () => { state.limit += 60; render(); });

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-copy]'); if (!b) return;
  const v = b.dataset.copy;
  const done = () => { const o = b.textContent; b.textContent = '已复制'; setTimeout(() => { b.textContent = o; }, 1100); };
  if (navigator.clipboard && location.protocol !== 'file:') navigator.clipboard.writeText(v).then(done).catch(fallback);
  else fallback();
  function fallback() {
    const ta = document.createElement('textarea');
    ta.value = v; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (_) {}
    document.body.removeChild(ta);
  }
});

render();
</script>
</body>
</html>`;

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, html, 'utf8');
  console.log(`✅ ${path.relative(ROOT, OUT)}  ${(fs.statSync(OUT).size / 1048576).toFixed(2)}MB`);
  console.log(`   内嵌条目 ${data.length}（每类最新 ${CAP} + 前 ${TOP_GAMES} 款游戏各 ${TOP_PER_GAME} 条）｜ 全量 ${stats.total} 条 ｜ 游戏榜 ${topGames.length}`);
}

main();
