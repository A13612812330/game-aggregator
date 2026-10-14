#!/usr/bin/env node
/* 解压报告渲染器（v10.71）—— 纯函数：报告对象 → 单文件 HTML 字符串
 *
 * 为什么要跟采集分开：
 *   本项目 `.ref/` 那套的纪律是「测/渲染分离」—— 渲染是纯函数才好断言（喂已知结构 ⇒
 *   断言输出片段），采集才需要碰磁盘和 7z。混在一起的话，测一次就要跑一次真实解压，
 *   防线会慢到没人愿意跑。
 *
 * ★ 样式为什么是「读主源」而不是「抄一份色值」：
 *   本项目已经有过一次「实测值 / 采纳值」混写成一条口径的教训。硬编码一份 token
 *   必然与 public/index.html 漂移。所以这里在渲染时**从主源抽 :root 块**，
 *   主源改色，报告自动跟着变。
 *
 * ★ 本文件产出的页面**没有反引号问题**：整页用数组 join 拼，不用模板字符串包 CSS。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const INDEX = path.join(__dirname, '..', 'public', 'index.html');

/* ============================ 工具 ============================ */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtSize(n) {
  if (n == null || isNaN(n)) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}

/** 取路径尾部 n 段（"↳ Downloads\GameHub" 这种短标识用） */
function tailPath(p, n) {
  const seg = String(p || '').split(/[\\/]/).filter(Boolean);
  const t = seg.slice(-(n || 2)).join('\\');
  return seg.length > (n || 2) ? '…\\' + t : t;
}

/** 从主源抽 :root 那段变量声明（配平花括号，不靠正则猜结尾） */
function siteTokens() {
  const FALLBACK = ':root{--c-primary:#2E6BFF;--c-primary-deep:#1B4FD8;--c-primary-soft:#EAF1FF;' +
    '--c-bg:#F3F5F9;--c-surface:#FFFFFF;--c-border:#E6E9F0;--c-border2:#C9D2E3;' +
    '--c-t1:#151A24;--c-t2:#5A6474;--c-t3:#9AA3B5}';
  let src;
  try { src = fs.readFileSync(INDEX, 'utf8'); } catch (e) { return FALLBACK; }
  const i = src.indexOf(':root{');
  if (i < 0) return FALLBACK;
  let depth = 0;
  for (let j = i + ':root'.length; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) return src.slice(i, j + 1); }
  }
  return FALLBACK;
}

/* 事件类型 → 中文。★ 与页面 tools/extract-sections.js 的 evLine 保持同一口径。
 *   踩过的坑：兜底给「原文」的话，漏映射的事件会把内部英文 token 直接漏到用户眼前
 *   （实测事件流第一行显示裸的 queued）。 */
const EV_TX = {
  'layer-start': '开始解压',
  'layer-done': '解压完成',
  'need-password': '需要密码',
  'layer-fail': '解压失败',
  skip: '跳过',
};

const FMT_TX = { zip: 'ZIP', rar: 'RAR', '7z': '7Z', gzip: 'GZ', bzip2: 'BZ2', xz: 'XZ', cab: 'CAB', tar: 'TAR' };

const SKIP_TX = {
  'max-depth': '超过深度上限，未继续往下解',
  'volume-part': '分卷的非首卷，跳过（只解首卷）',
  'not-archive': '按文件头判断不是压缩包',
  'already-exists': '目标文件已存在，跳过',
};

/* ============================ 主渲染 ============================ */

/**
 * @param {object} rep 采集层汇总出来的报告（见 tools/extract-cli.js 的 buildReport）
 * @returns {string} 完整 HTML
 */
function render(rep) {
  /* ★ 入参归一（防御）：渲染器是「报告必出」这条契约的最后一环 ——
   *   这里抛异常 = 用户拿不到任何结果（而失败路径恰恰最需要报告）。
   *   实测踩到：调用方给的分组少一个 `failures` 数组，整个 render 直接 TypeError。
   *   渲染层不该假设采集层每个字段都齐，缺了就按空处理。 */
  rep = rep || {};
  rep.groups = (rep.groups || []).map((g) => Object.assign(
    { name: '', kind: 'file', layers: [], skipped: [], failures: [], needsPassword: [], archives: 0 }, g));
  rep.needPassword = rep.needPassword || [];
  rep.failures = rep.failures || [];
  rep.stats = rep.stats || {};
  const s = rep.stats;
  const L = [];

  L.push('<!DOCTYPE html>');
  L.push('<html lang="zh-CN">');
  L.push('<head>');
  L.push('<meta charset="UTF-8">');
  L.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  L.push('<title>解压报告 · ' + esc(rep.title || 'GameHub 解压助手') + '</title>');
  L.push('<style>');
  L.push(siteTokens());
  L.push(PAGE_CSS);
  L.push('</style>');
  L.push('</head>');
  L.push('<body>');

  /* ---------- 头 ---------- */
  L.push('<header class="hd">');
  L.push('<div class="hd-l"><span class="hd-ic">🗜️</span><div>');
  L.push('<h1>解压报告</h1>');
  L.push('<div class="hd-sub">' + esc(rep.at) + ' ｜ 主机 ' + esc(rep.host) + '</div>');
  L.push('</div></div>');
  L.push('<div class="hd-r">');
  L.push('<span class="pill ' + (s.failed ? 'bad' : (s.needPw ? 'warn' : 'ok')) + '">' +
    (s.failed ? '有失败' : (s.needPw ? '有待解密' : '全部完成')) + '</span>');
  L.push('</div>');
  L.push('</header>');

  /* ---------- 环境 / 落点 ---------- */
  L.push('<div class="env">');
  L.push('<span class="dot"></span>');
  L.push('<b>解压器</b><code class="mono">' + esc(rep.exe) + '</code>');
  if (rep.version) L.push('<span class="ver">' + esc(String(rep.version).slice(0, 60)) + '</span>');
  L.push('<b class="lb2">落点</b><span class="mono2">' + esc(rep.destLabel) + '</span>');
  L.push('</div>');

  /* ---------- 统计条 ---------- */
  L.push('<div class="stats">');
  L.push(stat(s.archives, '处理压缩包'));
  L.push(stat(s.layers, '总层数 / 上限 ' + esc(rep.maxDepth)));
  L.push(stat(s.deepest, '最深嵌套', 'hi'));
  L.push(stat(s.extracted, '解出内容', 'hi'));
  L.push(stat(s.nothingNew, '未产出新文件', 'mb'));
  L.push(stat(s.needPw, '待解密', s.needPw ? 'mb' : ''));
  L.push(stat(s.failed, '失败', s.failed ? 'no' : ''));
  L.push(stat(s.files, '最终文件', 'hi'));
  L.push('</div>');

  /* ---------- ① 待解密：最重要的一块，放最上面 ---------- */
  if (rep.needPassword.length) {
    L.push('<section class="card warn">');
    L.push('<div class="ch"><b>🔒 ' + rep.needPassword.length + ' 个包需要密码</b>' +
      '<span class="n">填上密码后按下面命令重跑即可</span></div>');
    L.push('<div class="hint">这些包在「读清单」阶段就认出来了 —— 头加密的包（RAR 的 -hp）读不出清单，' +
      '文案像密码问题，所以归到「待解密」而不是「文件损坏」。<b>它们没有被当成坏包丢掉。</b></div>');
    L.push('<div class="list">');
    for (const it of rep.needPassword) {
      L.push('<div class="it warn-it">');
      L.push('<span class="dp">L' + esc(it.depth) + '</span>');
      L.push('<span class="fmt">' + esc(FMT_TX[it.format] || it.format || '?') + '</span>');
      L.push('<span class="nm" title="' + esc(it.file) + '">' + esc(it.name) + '</span>');
      /* ★ 左侧加「↳」：原来这里直接放来源目录名，实测会被读成文件名的一部分
       *   （"locked.zip _test-..." 看着像一个怪名字）。加符号 + 缩短成尾部两段就无歧义了。 */
      L.push('<span class="sz" title="' + esc(it.group) + '">↳ ' + esc(tailPath(it.group, 2)) + '</span>');
      L.push('</div>');
    }
    L.push('</div>');
    L.push('<div class="cmd-h">重跑命令（把 <b>你的密码</b> 换掉，直接粘进 Git Bash / PowerShell 均可）：</div>');
    const cmd = rep.rerunCommand;
    L.push('<div class="cmd"><code id="cmdTx">' + esc(cmd) + '</code>' +
      '<button class="cp" data-cp="cmdTx">复制</button></div>');
    L.push('<div class="hint">命令会<b>只处理这些包</b>，已解出来的文件用 7z 的 -aos 跳过，不会重解一遍，也不会覆盖你已有的东西。</div>');
    L.push('</section>');
  }

  /* ---------- ② 失败 ---------- */
  if (rep.failures.length) {
    L.push('<section class="card bad">');
    L.push('<div class="ch"><b>✕ ' + rep.failures.length + ' 个包失败</b><span class="n">退出码与原文照录</span></div>');
    L.push('<div class="list">');
    for (const it of rep.failures) {
      L.push('<div class="it bad-it">');
      L.push('<span class="dp">L' + esc(it.depth) + '</span>');
      L.push('<span class="fmt">' + esc(FMT_TX[it.format] || it.format || '?') + '</span>');
      L.push('<span class="nm" title="' + esc(it.file) + '">' + esc(it.name) + '</span>');
      L.push('<span class="er" title="' + esc(it.err) + '">' + esc(it.reason || '') + (it.err ? ' · ' + esc(it.err) : '') + '</span>');
      L.push('</div>');
    }
    L.push('</div>');
    L.push('<div class="hint">★ 退出码 2 是<b>三义</b>的（加密错密码 / 坏包 / 根本不是压缩包），所以这里不拿退出码下结论，' +
      '而是把 7z 的原文一并列出。分卷的非首卷会报「系统找不到指定的文件」，那也是退出码 2 —— ' +
      '本工具已经按命名族认出分卷、只喂首卷，不会把中间卷报成损坏。</div>');
    L.push('</section>');
  }

  /* ---------- ③ 逐来源明细 ---------- */
  L.push('<section class="card">');
  L.push('<div class="ch"><b>逐层明细</b><span class="n">' + rep.groups.length + ' 个来源</span></div>');
  for (const g of rep.groups) {
    /* ★ 默认展开：用户打开报告就是来看「到底解了什么」的。
     *   只在有失败/待解密时才展开是个想当然的设计 —— 成功路径反而看不到明细，
     *   而那恰恰是最需要确认（是不是真递归到底了）的路径。 */
    L.push('<details class="grp" open>');
    L.push('<summary><span class="gname">' + esc(g.name) + '</span>' +
      '<span class="gmeta">' + esc(g.kind === 'dir' ? '文件夹' : '文件') + ' · ' +
      g.layers.length + ' 层' + (g.failures.length ? ' · ' + g.failures.length + ' 失败' : '') +
      (g.needsPassword.length ? ' · ' + g.needsPassword.length + ' 待解密' : '') + '</span></summary>');
    if (!g.layers.length) {
      L.push('<div class="empty">这个来源里没有按文件头识别出的压缩包。<br>' +
        '<span>识别看的是前 512 字节的魔数，不看扩展名 —— 实测遇到过扩展名叫 .zips 其实是 ZIP 的包。</span></div>');
    } else {
      L.push('<div class="layers">');
      for (const ly of g.layers) {
        const cls = ly.ok ? (ly.nothingNew ? 'skip' : 'ok') : 'bad';
        const fmt = FMT_TX[ly.format] || ly.format || '?';
        let right;
        if (ly.ok) right = ly.nothingNew ? '已存在，跳过（本次无新文件）' : '产出 ' + ly.produced + ' 个';
        else if (ly.needPassword) right = '需要密码';
        else right = '失败' + (ly.err ? ' · ' + ly.err : '');
        L.push('<div class="layer ' + cls + '">');
        L.push('<span class="dp">L' + esc(ly.depth) + '</span>');
        L.push('<span class="fmt">' + esc(fmt) + '</span>');
        L.push('<span class="nm" title="' + esc(ly.file || ly.name) + '">' + esc(ly.name) + '</span>');
        if (ly.rolledBack) L.push('<span class="rb">已回滚 ' + esc(ly.rolledBack) + ' 个残留</span>');
        L.push('<span class="rs">' + esc(right) + '</span>');
        L.push('</div>');
      }
      L.push('</div>');
    }
    if (g.skipped.length) {
      L.push('<details class="fold"><summary>跳过清单（' + g.skipped.length + ' 条）</summary><div class="list">');
      for (const sk of g.skipped) {
        L.push('<div class="it skip-it"><span class="dp">L' + esc(sk.depth) + '</span>' +
          '<span class="nm" title="' + esc(sk.file) + '">' + esc(path.basename(sk.file || '')) + '</span>' +
          '<span class="rs">' + esc(SKIP_TX[sk.reason] || sk.reason) + '</span></div>');
      }
      L.push('</div></details>');
    }
    L.push('</details>');
  }
  L.push('</section>');

  /* ---------- ④ 判定口径（口径随报告走，避免「这数字怎么来的」说不清）---------- */
  L.push('<section class="card">');
  L.push('<div class="ch"><b>这份报告是怎么判的</b><span class="n">全部现测，非估计</span></div>');
  L.push('<div class="dims">');
  L.push(dim('按文件头识别', '看前 512 字节的魔数（ZIP 504b0304 / RAR 52617221 / 7Z 377abcaf），不看扩展名。'));
  L.push(dim('递归到没有为止', '解完一层就在**本次产出**里再扫。深度上限默认 5 层，被截断的层会如实列进跳过清单。'));
  L.push(dim('密码用 7z t 预检', '对 zip，错误密码照样能列出文件名（文件名是明文），所以不能用「能不能列目录」判密码。改用完整性测试：对密码退出码 0、错密码 2，且不受「文件已存在」影响。'));
  L.push(dim('失败会回滚', '实测错密码解压会留下 0 字节残file。失败时按快照差集删掉本次新产生的文件，避免污染目录、也避免它下次被当成「已存在」跳过。'));
  L.push(dim('只解分卷首卷', '实测 .7z.002 单独解会报「系统找不到指定的文件」（退出码 2，与坏包同码）。所以先按命名族认出分卷组，只喂首卷。'));
  L.push(dim('已存在就跳过', '用 7z 的 -aos：不覆盖你已有的文件。报告里会把这种层标成「已存在，跳过」，不假装解出了东西。'));
  L.push('</div>');
  L.push('</section>');

  L.push('<footer class="ft">GameHub · 解压助手 ｜ 报告文件：' + esc(rep.reportPath || '') + '</footer>');
  L.push(COPY_JS);
  L.push('</body>');
  L.push('</html>');
  L.push('');
  return L.join('\n');
}

function stat(n, lb, cls) {
  return '<div class="s ' + (cls || '') + '"><b>' + esc(n == null ? 0 : n) + '</b><span>' + esc(lb) + '</span></div>';
}
function dim(b, t) {
  return '<div class="dim"><b>' + esc(b) + '</b><span>' + esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>') + '</span></div>';
}

/* ============================ 静态资源 ============================ */

const PAGE_CSS = `
  *{box-sizing:border-box}
  body{margin:0;padding:22px 18px 40px;background:var(--c-bg,#F3F5F9);
    font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;color:var(--c-t1,#151A24)}
  .hd{display:flex;align-items:center;gap:14px;max-width:1080px;margin:0 auto 14px}
  .hd-l{display:flex;align-items:center;gap:11px;min-width:0}
  .hd-ic{font-size:26px;line-height:1}
  .hd h1{margin:0;font-size:19px;font-weight:800;letter-spacing:.2px}
  .hd-sub{font-size:12px;color:var(--c-t3,#9AA3B5);margin-top:2px}
  .hd-r{margin-left:auto}
  .pill{font-size:12px;font-weight:750;border-radius:999px;padding:5px 12px;border:1px solid}
  .pill.ok{background:#F4FDF7;border-color:#BBF7D0;color:#15803D}
  .pill.warn{background:#FFF8E6;border-color:#F0DFAE;color:#8A6100}
  .pill.bad{background:#FEF6F6;border-color:#F5C2C2;color:#B91C1C}

  .env{display:flex;align-items:center;gap:9px;flex-wrap:wrap;max-width:1080px;margin:0 auto 12px;
    background:var(--c-surface,#fff);border:1px solid var(--c-border,#E6E9F0);border-radius:10px;
    padding:9px 13px;font-size:12px;color:var(--c-t2,#5A6474)}
  .env .dot{width:8px;height:8px;border-radius:50%;background:#16A34A;flex:none}
  .env b{color:var(--c-t1,#151A24)}
  .env .lb2{margin-left:8px}
  .env code.mono{font:11.5px/1.4 ui-monospace,Consolas,monospace;background:#F1F3F8;border-radius:5px;padding:2px 7px;
    max-width:44%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .env .ver{font-size:11px;color:var(--c-t3,#9AA3B5);max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .env .mono2{font:11.5px/1.4 ui-monospace,Consolas,monospace;color:var(--c-t2,#5A6474);word-break:break-all}

  .stats{display:flex;gap:22px;flex-wrap:wrap;max-width:1080px;margin:0 auto 12px;
    background:var(--c-surface,#fff);border:1px solid var(--c-border,#E6E9F0);border-radius:12px;
    padding:14px 18px;box-shadow:0 1px 2px rgba(18,26,51,.04)}
  .s{display:flex;flex-direction:column;gap:1px}
  .s b{font:800 20px/1.15 ui-monospace,Consolas,monospace;color:var(--c-t2,#5A6474)}
  .s span{font-size:11.5px;color:var(--c-t3,#9AA3B5)}
  .s.hi b{color:#15803D} .s.mb b{color:#B45309} .s.no b{color:#DC2626}

  .card{max-width:1080px;margin:0 auto 12px;background:var(--c-surface,#fff);
    border:1px solid var(--c-border,#E6E9F0);border-radius:12px;padding:15px 18px;box-shadow:0 1px 2px rgba(18,26,51,.04)}
  .card.warn{background:#FFFDF5;border-color:#F0DFAE}
  .card.bad{background:#FEF9F9;border-color:#F5C2C2}
  .ch{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:11px}
  .ch b{font-size:14px;font-weight:800}
  .ch .n{font:700 11px/1 ui-monospace,Consolas,monospace;color:var(--c-t3,#9AA3B5);
    background:#F1F3F8;border:1px solid var(--c-border,#E6E9F0);border-radius:5px;padding:3px 7px}
  .hint{font-size:11.5px;line-height:1.75;color:var(--c-t3,#9AA3B5);margin-top:9px}
  .hint b{color:var(--c-t2,#5A6474)}

  .list,.layers{display:flex;flex-direction:column;gap:2px}
  .it,.layer{display:flex;align-items:center;gap:9px;padding:7px 10px;border-radius:7px;
    font-size:12.5px;min-width:0;border-left:3px solid var(--c-border,#E6E9F0)}
  .layer.ok{background:#F6FDF9;border-left-color:#16A34A}
  .layer.skip{background:#FBFCFE;border-left-color:#C7CFDD}
  .layer.bad,.it.bad-it{background:#FEF9F9;border-left-color:#DC2626}
  .it.warn-it{background:#FFFBEE;border-left-color:#F0B429}
  .it.skip-it{background:#FBFCFE;border-left-color:#C7CFDD}
  .dp{flex:none;font:700 10.5px/1 ui-monospace,Consolas,monospace;color:var(--c-t3,#9AA3B5);
    background:#fff;border:1px solid var(--c-border,#E6E9F0);border-radius:4px;padding:3px 5px}
  .fmt{flex:none;font:750 9.5px/1 ui-monospace,Consolas,monospace;color:#6D28D9;background:#F5F3FF;border-radius:4px;padding:3px 5px}
  .nm{flex:1;min-width:0;color:var(--c-t1,#151A24);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .sz{flex:none;font-size:11.5px;color:var(--c-t3,#9AA3B5)}
  .rs{flex:none;font-size:11.5px;color:var(--c-t2,#5A6474)}
  .rb{flex:none;font-size:10.5px;color:#92400E;background:#FEF3C7;border-radius:4px;padding:2px 6px}
  .er{flex:none;font-size:11px;color:#B91C1C;max-width:46%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

  .cmd-h{font-size:12px;color:var(--c-t2,#5A6474);margin:12px 0 6px;font-weight:650}
  .cmd{display:flex;align-items:stretch;gap:8px}
  .cmd code{flex:1;min-width:0;font:12px/1.65 ui-monospace,Consolas,monospace;background:#1B2130;color:#E6EAF2;
    border-radius:9px;padding:10px 12px;overflow-x:auto;white-space:pre-wrap;word-break:break-all}
  .cp{flex:none;padding:0 15px;border-radius:9px;border:1px solid var(--c-border2,#C9D2E3);background:#fff;
    font:700 12.5px/1 inherit;color:var(--c-t2,#5A6474);cursor:pointer}
  .cp:hover{border-color:var(--c-primary,#2E6BFF);color:var(--c-primary,#2E6BFF)}
  .cp.done{background:#F4FDF7;border-color:#BBF7D0;color:#15803D}

  .grp{border:1px solid var(--c-border,#E6E9F0);border-radius:9px;background:#FCFDFF;margin-bottom:8px;overflow:hidden}
  .grp>summary{cursor:pointer;padding:9px 12px;list-style:none;display:flex;align-items:center;gap:10px;font-size:12.5px}
  .grp>summary::-webkit-details-marker{display:none}
  .grp>summary::before{content:'▸';color:var(--c-t3,#9AA3B5);flex:none}
  .grp[open]>summary::before{content:'▾'}
  .gname{flex:1;min-width:0;color:var(--c-t1,#151A24);font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .gmeta{flex:none;font-size:11px;color:var(--c-t3,#9AA3B5)}
  .grp>.layers,.grp>.empty{padding:4px 10px 10px}
  .fold{margin:4px 10px 10px;border-top:1px solid var(--c-border,#E6E9F0);padding-top:8px}
  .fold>summary{cursor:pointer;font-size:11.5px;color:var(--c-t3,#9AA3B5);list-style:none}
  .fold>summary::-webkit-details-marker{display:none}
  .fold>summary::before{content:'▸ '}
  .fold[open]>summary::before{content:'▾ '}
  .fold .list{margin-top:6px}
  .empty{padding:14px 4px;text-align:center;color:var(--c-t3,#9AA3B5);font-size:12px;line-height:1.8}
  .empty span{font-size:11.5px}

  .dims{display:grid;grid-template-columns:repeat(auto-fill,minmax(248px,1fr));gap:9px}
  .dim{border:1px solid var(--c-border,#E6E9F0);border-radius:9px;padding:9px 11px;background:#FCFDFF}
  .dim b{display:block;font-size:12.5px;color:var(--c-t1,#151A24);margin-bottom:3px}
  .dim span{font-size:11.5px;color:var(--c-t2,#5A6474);line-height:1.65}
  .dim span b{display:inline;font-size:inherit;color:var(--c-t1,#151A24);margin:0}

  .ft{max-width:1080px;margin:18px auto 0;font-size:11px;color:var(--c-t3,#9AA3B5);word-break:break-all;text-align:center}

  @media(max-width:760px){
    body{padding:14px 11px 30px}
    .stats{gap:14px;padding:12px 13px}
    .s b{font-size:17px}
    .card{padding:12px 13px}
    .env code.mono{max-width:100%}
    .dims{grid-template-columns:1fr}
    .er{max-width:100%;white-space:normal}
    .cmd{flex-direction:column}
    .cp{padding:9px 15px}
  }`;

/* 复制按钮：file:// 下 navigator.clipboard 常被拒，必须带 execCommand 兜底。
 * 写成独立常量，方便构建期用 assertScriptSyntax 单独编译它。 */
const COPY_JS = [
  '<script>',
  '(function(){',
  '  var bs = document.querySelectorAll(".cp");',
  '  function fallback(tx){',
  '    var ta = document.createElement("textarea");',
  '    ta.value = tx; ta.setAttribute("readonly","");',
  '    ta.style.position = "fixed"; ta.style.left = "-9999px";',
  '    document.body.appendChild(ta); ta.select();',
  '    var ok = false;',
  '    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }',
  '    document.body.removeChild(ta);',
  '    return ok;',
  '  }',
  '  for (var i = 0; i < bs.length; i++) {',
  '    bs[i].addEventListener("click", function(){',
  '      var src = document.getElementById(this.getAttribute("data-cp"));',
  '      if (!src) return;',
  '      var tx = src.textContent, b = this;',
  '      function done() { b.textContent = "已复制"; b.className = "cp done";',
  '        setTimeout(function(){ b.textContent = "复制"; b.className = "cp"; }, 1600); }',
  '      if (navigator.clipboard && navigator.clipboard.writeText) {',
  '        navigator.clipboard.writeText(tx).then(done, function(){ if (fallback(tx)) done(); });',
  '      } else if (fallback(tx)) { done(); }',
  '    });',
  '  }',
  '})();',
  '</script>',
].join('\n');

module.exports = { render, esc, fmtSize, siteTokens, SKIP_TX, FMT_TX, EV_TX, COPY_JS, PAGE_CSS };
