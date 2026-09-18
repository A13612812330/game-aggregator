/**
 * page-assets.js — 从主源 public/index.html 抽取「共享资产」
 *
 * 背景：本站是「单源派生」结构 ——
 *   public/index.html   主源：所有 CSS / 顶栏 / 抽屉 / 通用脚本的唯一编辑入口
 *   public/emulator.html 派生页（tools/build-emulator-page.js 生成）
 *   public/unpack.html   派生页（tools/build-unpack-page.js 生成，v10.20 新增）
 *
 * ★ 为什么把抽取逻辑单独成模块：
 *   v10.20 加第三个页面时，如果再把 build-emulator-page.js 里那套 findLine/cut 抄一遍，
 *   以后主源结构一变就要改三处，必然漏。这里集中一份，新页面直接复用。
 *   （build-emulator-page.js 暂未迁移 —— 它在线上跑得好好的，不动它，避免回归风险。）
 *
 * 抽取出来的都是「主源里的连续片段」，派生页负责把其中的导航重写成自己的语义。
 */
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');
const INDEX = path.join(PUB, 'index.html');

const idx = fs.readFileSync(INDEX, 'utf8');
const lines = idx.split('\n');

/** 取 lines 中匹配 re 的首行行号（1-based），从 from 行开始 */
function findLine(re, from = 1) {
  for (let i = from - 1; i < lines.length; i++) if (re.test(lines[i])) return i + 1;
  return -1;
}
/** 含两端行切片 */
const cut = (a, b) => lines.slice(a - 1, b).join('\n');

function must(n, what, hint) {
  if (n > 0) return n;
  throw new Error('[page-assets] 找不到「' + what + '」。\n  主源 public/index.html 的结构变了，' +
    '请同步本文件的锚点。\n  ' + (hint || ''));
}

/* ---------- HEAD 骨架（<head> 到 <style> 之前） ---------- */
const HEAD = cut(1, must(findLine(/^<style>/), '<style>') - 1);

/* ---------- 整段 CSS（不含 </style>） ----------
 * ★ 只截到 </style> 的**前一行**，把闭标签留给组装阶段：
 *   派生页要在 CSS 之后追加自己的专属样式，若在这里就把 </style> 带出来，
 *   追加的样式会落到标签外面、被浏览器当正文渲染（页面顶部糊一屏 CSS 源码）。
 */
const CSS = cut(must(findLine(/^<style>/), '<style>'), must(findLine(/^<\/style>/), '</style>') - 1);

/* ---------- 顶栏 ---------- */
const topA = must(findLine(/<header class="topbar"/), '顶栏 <header class="topbar">');
const TOPBAR = cut(topA, must(findLine(/<\/header>/, topA), '顶栏 </header>'));
/* 三条导航的原文，供派生页重写时做自检 */
const NAV_SRC = {
  home: /<a href="[^"]*"[^>]*id="navHome"[^>]*>[\s\S]*?<\/a>/,
  emu: /<a href="[^"]*"[^>]*id="navEmu"[^>]*>[\s\S]*?<\/a>/,
  unpack: /<a href="[^"]*"[^>]*id="navUnpack"[^>]*>[\s\S]*?<\/a>/,
};

/* ---------- 遮罩 + 详情抽屉 + 底部 Tab ---------- */
const maskA = must(findLine(/<div class="mask" id="mask">/), '遮罩 #mask');
const tabA = findLine(/<nav class="tabbar"/);
const OVERLAY = cut(maskA, must(findLine(/<\/nav>/, tabA), '底部 Tab </nav>'));

/* ---------- 搜索弹层 ----------
 * 它在 index.html 里位于 </footer> 之后、#mask 之前，不属于任何 <main>，
 * 但通用脚本顶层就绑了 #searchInput / #smask / #smClear，
 * 缺了它派生页会抛 "addEventListener of null" 并中断整段脚本（页面交互全废）。 */
const smaskA = findLine(/<!-- =+ 🔍 搜索弹窗/);
const SEARCH = smaskA > 0 ? cut(smaskA, maskA - 1) : '';

/* ---------- 通用脚本顶层依赖、但派生页没有的节点 ----------
 * 同理：脚本顶层 addEventListener 会炸，必须补齐（整块隐藏，不占版面）。 */
function deadNodes() {
  const parts = [];
  const rankA = findLine(/<div class="stage-pills" id="rankPills">/);
  if (rankA > 0) {
    const rankB = findLine(/<\/div>/, findLine(/id="rankRefresh"/, rankA));
    parts.push(cut(rankA, rankB));
  }
  const idxA = findLine(/id="idxBtn"/);
  if (idxA > 0) {
    const idxB = findLine(/id="jidiBtn"/, idxA);
    parts.push(cut(idxA - 1, findLine(/<\/div>/, idxB)));
  }
  if (!parts.length) return '';
  return '<!-- 派生页无这些分区：仅为满足通用脚本的 DOM 依赖，整块隐藏 -->\n' +
    '<div class="page-deadnodes" hidden aria-hidden="true">\n' + parts.join('\n') + '\n</div>';
}

/* ---------- 主脚本 ---------- */
const jsA = must(findLine(/^<script>/), '<script>');
const jsB = must(findLine(/^<\/script>/, jsA), '</script>');
const SCRIPT_RAW = cut(jsA + 1, jsB - 1);   // 只取标签之间，否则追加内容会落到标签外

/** 主源里的「手机模拟器专区（独立页跳转）」整块 —— 派生页一定会替换它。
 *  同步检测时要把这块剔掉：里面的函数（goEmuPage / bindNavEmu / bindTabEmu…）
 *  在派生页里本来就不存在或被换掉，列入比对会 100% 误报。 */
const JUMP_BLOCK_RE = /\/\* =+ 📱 手机模拟器专区（独立页跳转）[\s\S]*?\/\* \[派生页锚点\][^\n]*\n/;
const SCRIPT_FOR_SCAN = SCRIPT_RAW.replace(JUMP_BLOCK_RE, '');

/**
 * 派生页脚本适配：摘掉首页专属的初始化调用。
 * 这些都是「去操作派生页不存在的节点」，留着会抛错并中断后续脚本。
 */
function scriptForSubpage() {
  return SCRIPT_RAW
    .replace(/^\s*refreshRank\([^)]*\);.*$/m, '  /* refreshRank：派生页无热榜分区，跳过 */')
    .replace(/^\s*bindRankUI\(\);.*$/m, '  /* bindRankUI：派生页无榜单 UI，跳过 */')
    .replace(/^\s*renderSide\(\);.*$/m, '  /* renderSide：派生页无右栏，跳过 */')
    .replace(/^\s*renderCats\(\);.*$/m, '  /* renderCats：派生页无分类行，跳过 */')
    .replace(/^\s*renderList\([^)]*\);.*$/m, '  /* renderList：派生页无最新收录列表，跳过 */')
    /* 首页的「手机模拟器专区（独立页跳转）」块：把手机专区引导卡 + 跳转逻辑换掉。
       以显式标记行收尾最稳（不会误吞后面的抽屉代码），旧写法作为兜底。 */
    .replace(/\/\* ================= 📱 手机模拟器专区（独立页跳转）[\s\S]*?\/\* \[派生页锚点\][^\n]*\n/m, '/* 手机专区跳转块：派生页不需要 */\n')
    .replace(/\/\* ================= 📱 手机模拟器专区（独立页跳转）[\s\S]*?\n\}\)\(\);/m, '/* 手机专区跳转块：派生页不需要 */')
    /* 引导卡数字回填（依赖首页的引导卡节点） */
    .replace(/\/\* 引导卡上的两个数字[\s\S]*?\n\}\)\(\);/, '/* 引导卡数字回填：派生页无引导卡 */');
}

/** 自检：替换若没命中，EMU_PAGE_HREF 会残留 → 派生页 ReferenceError */
function assertClean(js, what) {
  if (/EMU_PAGE_HREF/.test(js)) {
    throw new Error('[page-assets] ' + what + '：主源「手机模拟器专区（独立页跳转）」块未被替换，\n' +
      '  EMU_PAGE_HREF 残留会导致派生页 ReferenceError。请检查该注释块与 [派生页锚点] 标记行。');
  }
  return js;
}

/* ---------- 导航重写 ---------- */

/**
 * 生成派生页顶栏。
 * @param {'emu'|'unpack'} active 当前所在页（决定哪一条高亮）
 */
function buildTopbar(active) {
  let t = TOPBAR;
  /* 主源的「🏠 首页」是页内锚点 + on 状态（首页即回顶部）；派生页必须是真链接回聚合首页，
     否则派生页脚本会 preventDefault 掉它 —— 顶栏「首页」就成了点不动的摆设。 */
  t = t.replace(/<a href="[^"]*"[^>]*id="navHome"[^>]*>/, '<a href="/" id="navHome">');
  if (active === 'unpack') {
    t = t.replace(/<a href="[^"]*"[^>]*id="navUnpack"[^>]*>/, '<a href="/unpack.html" class="on" id="navUnpack">');
  }
  if (!/id="navHome"/.test(t) || !/id="navUnpack"/.test(t)) {
    throw new Error('[page-assets] 顶栏重写未命中：public/index.html 的 <nav class="main-nav"> 里\n' +
      '  「🏠 首页 / 📱 手机专区 / 📦 解包匹配」三条 <a> 的写法变了。');
  }
  return t;
}

/** 底部 Tab（≤760px 显示）。href 用真链接，不写 data-tab → 通用脚本不会 preventDefault 它们。 */
const TAB_ICON = {
  home: '<path d="M3 10.6 12 3.4l9 7.2"/><path d="M5.6 9.4V19a1.6 1.6 0 0 0 1.6 1.6h3.3V15h3v5.6h3.3A1.6 1.6 0 0 0 18.4 19V9.4"/>',
  emu: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18.5h2"/>',
  unpack: '<path d="M3 7.5 12 3l9 4.5-9 4.5-9-4.5Z"/><path d="M3 12.6 12 17.1l9-4.5"/><path d="M3 17.2 12 21.7l9-4.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
};
function buildTabbar(active) {
  const item = (key, href, label, on) =>
    '<a href="' + href + '"' + (on ? ' class="on"' : '') + ' aria-label="' + label + '">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    TAB_ICON[key] + '</svg>' + label + '</a>';
  const body = [
    item('home', '/', '首页', active === 'home'),
    item('emu', '/emulator.html', '手机专区', active === 'emu'),
    item('unpack', '/unpack.html', '解包', active === 'unpack'),
    /* 搜索用 data-tab：通用脚本要拦下它并打开搜索弹窗 */
    '<a href="#" data-tab="search" aria-label="搜索"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      TAB_ICON.search + '</svg>搜索</a>',
  ].join('\n  ');
  const out = OVERLAY.replace(/<nav class="tabbar"[\s\S]*?<\/nav>/,
    '<nav class="tabbar" id="tabbar" aria-label="移动端导航">\n  ' + body + '\n</nav>');
  if (out === OVERLAY) throw new Error('[page-assets] 底部 Tab 重写未命中：主源 <nav class="tabbar"> 写法变了。');
  return out;
}

/** 派生页 <head>：骨架取自主源，<title>/description 用派生页自己的 */
function buildHead(title, desc) {
  let h = HEAD;
  if (title) h = h.replace(/<title>[\s\S]*?<\/title>/, '<title>' + title + '</title>');
  if (desc) h = h.replace(/<meta name="description"[^>]*>/, '<meta name="description" content="' + desc + '">');
  return h;
}

module.exports = {
  PUB, INDEX,
  findLine, cut,
  HEAD, CSS, TOPBAR, OVERLAY, SEARCH,
  SCRIPT_RAW, SCRIPT_FOR_SCAN, deadNodes, scriptForSubpage, assertClean,
  buildTopbar, buildTabbar, buildHead,
  NAV_SRC,
};
