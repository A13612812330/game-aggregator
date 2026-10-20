/**
 * ★ v10.88：FitGirl 详情页「下载源」解析器
 *
 * 输入：详情页 HTML 字符串（由 server 现抓 / 预览脚本离线抓）
 * 输出：结构化的下载源清单 —— 前端只负责画，不再解析 HTML
 *
 * 页面真实形态（v10.88 实测，样本 3 帖）：
 *   每个 filehoster 一个折叠块 `.su-spoiler.dlinks`，块内是纯净的分卷链接列表：
 *     datanodes.to   /<id>/<文件名>.part01.rar        （文件名在 path）
 *     fuckingfast.co /<id>#<文件名>.part01.rar        （文件名在 hash）
 *     filekeeper.net /<id>/<文件名>.part01.rar
 *   三站是**同一套文件的三份镜像**，簇结构逐一对应。
 *
 * ★★ 关键认知（推翻了上一轮的猜想）：一帖里链接多，不是「历史版本累积」，
 *   而是**多个产物组**：
 *     · 主 repack      前缀 = 游戏名，分卷 1..N 连续
 *     · 可选附件      前缀 = fg-optional-*（videos / 某语种语音 / bonus OST / 4K 视频）
 *                      多数是 1 个整文件，少数有分卷（fg-optional-videos 实测 4 卷）
 *     · 变体           同一游戏的无删减版（UNCENSORED）等，分卷数完全不同（实测 72 vs 13）
 *   所以「归并」要做的是：**跨 host 合并同一前缀 → 一组**，而不是把所有分卷压成一个数字。
 */
'use strict';

/* host 白名单：只认这三家实测存在的 filehoster。
 * ★ 白名单同时是 SSRF 护栏（前端传的 slug 已由 fitgirl.has 校验，这里再限链接域名，
 *   防止页面被注入外域链接后前端把它当下载源渲染出去）。 */
const HOSTS = ['datanodes.to', 'fuckingfast.co', 'filekeeper.net'];
/* 容器/清单页：这类页面本身不含文件，只装一份清单（filecrypt 由 JS 解密，paste 是加密粘贴）。
 * ★ 实测（20 帖新老各 10）域名全集就这三家，且 pastefg.hermietkreeft.site 是老帖/成人帖在用的
 *   新 paste 服务 —— 只认 paste.fitgirl-repacks.site 会让 40% 的帖被判「没有下载区」。 */
const CONTAINER_HOSTS = [
  'filecrypt.cc', 'filecrypt.co',
  'paste.fitgirl-repacks.site', 'pastefg.hermietkreeft.site',
  'multiup.io',
];

const PART_RE = /^(.*?)\.part(\d+)\.(rar|7z|zip)$/i;
const ARCHIVE_RE = /\.(rar|7z|zip|bin|iso)$/i;

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
}

/** 从链接里取「用户看到的文件名」：hash 优先（fuckingfast），否则 path 末段 */
function fileNameOf(url) {
  try {
    const u = new URL(url);
    const raw = (u.hash ? u.hash.slice(1) : '') || u.pathname.split('/').filter(Boolean).pop() || '';
    return decodeURIComponent(raw);
  } catch (e) { return ''; }
}

function unentity(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&#0?38;/g, '&').replace(/&#0?39;/g, "'");
}

/**
 * @param {string} html 详情页 HTML
 * @param {{maxPerSet?: number}} opt
 * @returns {{magnet:{count:number,list:string[]}, sets:Array, containers:Array, stats:object, warnings:string[]}}
 */
function parse(html, opt) {
  const o = opt || {};
  const maxPerSet = o.maxPerSet || 400;
  const warnings = [];

  /* ── magnet ── */
  const seenM = new Set();
  const magnets = [];
  for (const m of html.matchAll(/magnet:\?xt=urn:btih:[^"'\s<>]+/g)) {
    const mg = unentity(m[0]);
    if (!seenM.has(mg)) { seenM.add(mg); magnets.push(mg); }
    if (magnets.length >= 8) break;
  }

  /* ── 收集所有 host 链接（按 host + 分卷前缀聚簇）── */
  const clusters = new Map(); // key = host + '\u0000' + prefix
  const containers = [];
  const seenC = new Set();
  for (const m of html.matchAll(/href="(https?:\/\/[^"]+)"/g)) {
    const url = unentity(m[1]);
    const host = hostOf(url);
    if (!host) continue;
    if (CONTAINER_HOSTS.includes(host)) {
      if (!seenC.has(url)) { seenC.add(url); containers.push({ host, url, label: containerLabel(host) }); }
      continue;
    }
    if (!HOSTS.includes(host)) continue;
    const name = fileNameOf(url);
    const pm = name.match(PART_RE);
    const prefix = pm ? pm[1] : (name.replace(ARCHIVE_RE, '') || name);
    const partNo = pm ? parseInt(pm[2], 10) : 0;
    const key = host + '\u0000' + prefix;
    if (!clusters.has(key)) clusters.set(key, { host, prefix, items: [], seen: new Set() });
    const cl = clusters.get(key);
    /* 同一条链接在页面里可能出现在多个位置（实测 fg-optional-bonus-soundtrack 同 URL 两次），
     * 不去重会把「1 个文件」算成「2 个分卷」——按 url 去重。 */
    if (cl.seen.has(url)) continue;
    cl.seen.add(url);
    cl.items.push({ url, name, part: partNo });
  }

  /* ── 跨 host 合并同一前缀 → 一组 set ──
   *  为什么按前缀合并而不是按 host 分开展示：三站是镜像，用户只需要选一个站；
   *  把它们并成一组，前端一个「镜像」下拉即可，条数从 3N 变 N。 */
  const byPrefix = new Map(); // prefix → { prefix, parts:number, optional:boolean, byHost:{} }
  for (const c of clusters.values()) {
    if (!byPrefix.has(c.prefix)) {
      byPrefix.set(c.prefix, { prefix: c.prefix, parts: 0, optional: false, byHost: {}, count: 0 });
    }
    const g = byPrefix.get(c.prefix);
    const items = c.items.slice().sort((a, b) => (a.part || 0) - (b.part || 0)).slice(0, maxPerSet);
    g.byHost[c.host] = items;
    g.count += items.length;
    g.parts = Math.max(g.parts, items.length);
  }

  const sets = [...byPrefix.values()].map((g) => {
    const prefix = g.prefix;
    const optional = /^fg-optional/i.test(prefix) || /^fg-/i.test(prefix);
    const hosts = Object.keys(g.byHost).sort((a, b) => {
      // 主站顺序固定：datanodes → fuckingfast → filekeeper（实测稳定性最好在前）
      const rank = (h) => (HOSTS.indexOf(h) === -1 ? 99 : HOSTS.indexOf(h));
      return rank(a) - rank(b);
    });
    return {
      prefix,
      label: prettyLabel(prefix),
      optional,
      parts: g.parts,
      count: g.count,
      hosts,
      byHost: g.byHost,
      // 推荐镜像：分卷数最全的那一站（同前缀下应当相等，取第一个兜底）
      best: hosts[0] || null,
    };
  });

  /* 排序：主组在前（按分卷数降序，UNCENSORED 这种大包排前面），可选附件按名字排 */
  sets.sort((a, b) => {
    if (a.optional !== b.optional) return a.optional ? 1 : -1;
    if (b.parts !== a.parts) return b.parts - a.parts;
    return a.prefix.localeCompare(b.prefix);
  });
  /* 主组里若出现多个候选（如 UNCENSORED + 原版），把最大的标 main，其余标 variant */
  let mainAssigned = false;
  for (const s of sets) {
    if (s.optional) { s.kind = 'optional'; continue; }
    if (!mainAssigned) { s.kind = 'main'; mainAssigned = true; } else { s.kind = 'variant'; }
  }
  if (!mainAssigned) warnings.push('页面内未找到主 repack 组（可能该帖没有下载区）');

  /* ★ 三种形态（实测 20 帖：inline 12 / container 8 / none 0）：
   *   inline    页面直接列出分卷链接（新帖主流）→ 能归并、能一键复制
   *   container 页面只给 paste/filecrypt 清单页（老帖与部分成人帖）→ 只能给容器链接
   *   none      既无分卷也无容器（预告/汇总帖）→ 如实返回空
   *   把 mode 显式带出来，前端才知道「该显示复制按钮还是只显示打开容器」。 */
  const mode = sets.length ? 'inline' : (containers.length ? 'container' : 'none');

  const stats = {
    mode,
    hosts: [...new Set(sets.flatMap((s) => s.hosts))],
    hostKinds: new Set(sets.flatMap((s) => s.hosts)).size,
    setsTotal: sets.length,
    mainSets: sets.filter((s) => s.kind === 'main').length,
    variantSets: sets.filter((s) => s.kind === 'variant').length,
    optionalSets: sets.filter((s) => s.optional).length,
    /* 归并后「需要复制的条数」= 主组在该镜像上的分卷数（不含可选/变体） */
    mainParts: sets.filter((s) => s.kind === 'main').reduce((n, s) => n + s.parts, 0),
    rawLinks: sets.reduce((n, s) => n + s.count, 0),
    containers: containers.length,
    magnets: magnets.length,
  };
  /* 镜像完整性自检：主组在各 host 上的分卷数应一致，不一致就报警（不做静默归并） */
  for (const s of sets) {
    if (s.hosts.length < 2) continue;
    const lens = s.hosts.map((h) => s.byHost[h].length);
    if (Math.max(...lens) !== Math.min(...lens)) {
      warnings.push('镜像分卷数不一致：' + s.prefix + ' → ' + s.hosts.map((h, i) => h + ':' + lens[i]).join(' / '));
    }
  }

  return { mode, magnet: { count: magnets.length, list: magnets }, sets, containers, stats, warnings };
}

function containerLabel(host) {
  if (/^filecrypt/.test(host)) return 'FileCrypt 容器（JDownloader 可批量导入）';
  if (/^paste\.fitgirl/.test(host)) return 'FitGirl 粘贴板（加密清单）';
  if (/^multiup/.test(host)) return 'MultiUp 多站聚合';
  return host;
}

/** 前缀 → 人话标签（前端直接用，不用再判断） */
function prettyLabel(prefix) {
  let s = prefix.replace(/_--_fitgirl-repacks\.site_--_/g, '').replace(/_+/g, ' ').trim();
  if (/^fg-optional-/i.test(s)) return '可选附件 · ' + s.replace(/^fg-optional-/i, '').replace(/-/g, ' ');
  if (/^fg-/i.test(s)) return s.replace(/^fg-/i, '');
  return s;
}

module.exports = { parse, HOSTS, CONTAINER_HOSTS, fileNameOf, prettyLabel };
