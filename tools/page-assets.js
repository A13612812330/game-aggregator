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
/* 四条导航的原文，供派生页重写时做自检 */
const NAV_SRC = {
  home: /<a href="[^"]*"[^>]*id="navHome"[^>]*>[\s\S]*?<\/a>/,
  emu: /<a href="[^"]*"[^>]*id="navEmu"[^>]*>[\s\S]*?<\/a>/,
  unpack: /<a href="[^"]*"[^>]*id="navUnpack"[^>]*>[\s\S]*?<\/a>/,
  /* ★ v10.71 新增第 5 条「🗜️ 解压助手」。注意它与 navUnpack（解包匹配）是**两件事**：
   *   unpack = 分析解包工具导出的配置 JSON；extract = 把压缩包递归解开。
   *   命名刻意不叫 navExtract，用 navEx，与现有 navXxx 的短名风格一致。 */
  ex: /<a href="[^"]*"[^>]*id="navEx"[^>]*>[\s\S]*?<\/a>/,
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

/**
 * ★★ 语法闸门（v10.71 新增）：派生页的内联脚本必须**编译得过**才允许落盘。
 *
 * 为什么要有它 —— 实测踩到的坑：
 *   我在页面脚本里写了 `const FMT_TX = { …, 7z: '7Z', … }`。数字开头的 key 在对象
 *   字面量里是**非法 token**，整段脚本 SyntaxError，浏览器只丢一句
 *   `Invalid or unexpected token` 就什么都不执行了 —— 环境条永远停在初值、
 *   所有按钮全废。而构建器当时那一堆自检**全是绿的**：节点都在、样式都在、
 *   入口数也对，因为它们检查的是**文本存在性**，不是**可执行性**。
 *
 * 所以这里把产物里的每个裸 <script> 抽出来交给 vm 编译一次（只编译、不执行，
 * 不需要 DOM / window）。编译失败 = 构建失败，页面根本没机会被写出去。
 *
 * @param {string} html  已组装好的整页 HTML
 * @param {string} what  产物名（用于报错定位）
 * @returns {number} 检查过的脚本块数
 */
function assertScriptSyntax(html, what) {
  const vm = require('vm');
  const blocks = [];
  const re = /<script>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) blocks.push(m[1]);
  if (!blocks.length) {
    throw new Error('[page-assets] ' + what + '：产物里没找到内联 <script> 块，组装可能出错。');
  }
  /* 标签数不配对 ⇒ 某段脚本里藏着字面量 </script>，浏览器会提前截断脚本。
     （本类问题 vm 检查不出来，必须单独守。） */
  const open = (html.match(/<script\b/g) || []).length;
  const close = (html.match(/<\/script>/g) || []).length;
  if (open !== close) {
    throw new Error('[page-assets] ' + what + '：<script> 与 </script> 数量不配对（' + open + ' vs ' + close +
      '）—— 多半是脚本某处的字符串里含字面量 </script>。');
  }
  blocks.forEach((src, i) => {
    try {
      new vm.Script(src, { filename: what + '#script' + i });
    } catch (e) {
      throw new Error('[page-assets] ' + what + ' 第 ' + (i + 1) + ' 个 <script> 语法错误：' + e.message +
        '\n  ↳ 常见原因：① 对象键以数字开头未加引号（写 { \'7z\': \'7Z\' }，不能写 { 7z: \'7Z\' }）；' +
        '\n            ② 模板字符串被提前闭合；③ 少/多一个括号。');
    }
  });
  return blocks.length;
}

/* ---------- 导航重写 ---------- */

/**
 * 生成派生页顶栏。
 * @param {'emu'|'unpack'|'extract'} active 当前所在页（决定哪一条高亮）
 */
function buildTopbar(active) {
  let t = TOPBAR;
  /* 主源的「🏠 首页」是页内锚点 + on 状态（首页即回顶部）；派生页必须是真链接回聚合首页，
     否则派生页脚本会 preventDefault 掉它 —— 顶栏「首页」就成了点不动的摆设。 */
  t = t.replace(/<a href="[^"]*"[^>]*id="navHome"[^>]*>/, '<a href="/" id="navHome">');
  if (active === 'unpack') {
    t = t.replace(/<a href="[^"]*"[^>]*id="navUnpack"[^>]*>/, '<a href="/unpack.html" class="on" id="navUnpack">');
  }
  if (active === 'extract') {
    /* ★ v10.71：新页高亮。同样要先清掉主源里的 on（主源 on 在 navHome 上，已在上一步摘掉），
     *   否则会出现两个高亮项。 */
    t = t.replace(/<a href="[^"]*"[^>]*id="navEx"[^>]*>/, '<a href="/extract.html" class="on" id="navEx">');
  }
  if (!/id="navHome"/.test(t) || !/id="navUnpack"/.test(t) || !/id="navEx"/.test(t)) {
    throw new Error('[page-assets] 顶栏重写未命中：public/index.html 的 <nav class="main-nav"> 里\n' +
      '  「🏠 首页 / 📱 手机专区 / 🎮 端游资源 / 📦 解包匹配 / 🗜️ 解压助手」五条 <a> 的写法变了。');
  }
  return t;
}

/** 底部 Tab（≤760px 显示）。href 用真链接，不写 data-tab → 通用脚本不会 preventDefault 它们。
 *  ★ v10.71 由 4 项增至 5 项（插在「解包」与「搜索」之间）。
 *    5 项在 390px 上每项约 78px，文案是 2~4 个汉字 + 18px 图标，放得下（已实拍确认）。 */
const TAB_ICON = {
  home: '<path d="M3 10.6 12 3.4l9 7.2"/><path d="M5.6 9.4V19a1.6 1.6 0 0 0 1.6 1.6h3.3V15h3v5.6h3.3A1.6 1.6 0 0 0 18.4 19V9.4"/>',
  emu: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18.5h2"/>',
  unpack: '<path d="M3 7.5 12 3l9 4.5-9 4.5-9-4.5Z"/><path d="M3 12.6 12 17.1l9-4.5"/><path d="M3 17.2 12 21.7l9-4.5"/>',
  /* 箱子 + 向下箭头 = 「往里解压出来」，与 unpack 的层叠图标刻意区分 */
  extract: '<rect x="3" y="3" width="18" height="5" rx="1.5"/><path d="M5 8v11a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V8"/><path d="M12 11.5v5"/><path d="m9.5 14.5 2.5 2.5 2.5-2.5"/>',
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
    item('extract', '/extract.html', '解压', active === 'extract'),
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
  assertScriptSyntax,
  buildTopbar, buildTabbar, buildHead,
  NAV_SRC,
};
