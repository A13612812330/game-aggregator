/** data/tsmods.js — Thunderstore MOD 直链读取层（v10.81 / P2 · 门 1）
 *
 * 数据：tools/fetch-thunderstore.js 产出 data/thunderstore.json（libId → packages[]）。
 * 消费：server.js `/api/ts/mods?id=<libId>&t=<名>` —— MOD 页签的直链来源。
 *
 * ★ 直链形态：`https://thunderstore.io/package/download/<ns>/<name>/<ver>/`
 *   （302 → ccdn.thunderstore.io/...zip，实测 200 application/zip、**无防盗链**）
 *   ⇒ 前端可直接 <a href>，**不需要**流代理（与 FLiNG 不同，FLiNG 有 Referer 校验）。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const RAW = JSON.parse(fs.readFileSync(path.join(__dirname, 'thunderstore.json'), 'utf8'));

/** libId → { community, title, packages[] } */
const BY_LIB = new Map((RAW.games || []).map((g) => [g.libId, g]));

function byLib(libId, limit) {
  const g = BY_LIB.get(String(libId || ''));
  if (!g) return [];
  const arr = (g.packages || []).slice();
  arr.sort((a, b) => b.downloads - a.downloads);
  return limit ? arr.slice(0, limit) : arr;
}

/** 弹窗行瘦形（与 /api/res/game 的 slimItem 形状对齐：links[{label,url,cls}] + page） */
function slim(libId, limit) {
  return byLib(libId, limit).map((p) => ({
    src: 'ts',
    cat: 'mod',
    id: p.ns + '/' + p.name,
    title: p.name,
    size: p.size,
    downloads: p.downloads,
    version: p.version,
    icon: p.icon,
    note: 'v' + p.version + ' · ' + (p.downloads || 0) + ' 次下载',
    srcLabel: 'Thunderstore · ' + (p.ns || ''),
    /* 直链：官方 download 口（302 → 自家 CDN zip，无防盗链） */
    links: [{ label: '直链 zip', url: p.url, cls: 'pri' }],
    /* 包详情页 */
    page: 'https://thunderstore.io/package/' + p.ns + '/' + p.name + '/',
  }));
}

function stats() {
  return Object.assign({ builtAt: RAW.builtAt, source: 'Thunderstore 包 CDN 直链（无防盗链）' }, RAW.stats);
}

module.exports = { byLib, slim, stats, RAW };
