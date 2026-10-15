/** data/tcsdl.js — TheCheatScript 修改器外链读取层（v10.81 / P1b）
 *
 * 数据：tools/fetch-tcs-dl.js 产出 data/tcs-dl.json（officialUrl → links[{host,url}]）。
 * 消费：server.js `/api/trainers/match` —— 给 origin=the_cheat_script 的条目挂 `dl`。
 *
 * ★★ 与 flingdl 的差别：thecheatscript **不自托管文件**（实测 12 页抽样：
 *    mega.nz 为主 / disk.yandex / mediafire）⇒ **做不了流代理**（MEGA 端到端加密、
 *    Yandex 走自家协议）。下发的是**外链本身**，消费形态 = 新标签直开
 *    （免提取码、免客户端），前端按 `ext` 标记渲染成「↗ 直开」，不冒充直下。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const RAW = JSON.parse(fs.readFileSync(path.join(__dirname, 'tcs-dl.json'), 'utf8'));

/** officialUrl → [{host, url}] */
const MAP = new Map(Object.entries(RAW.items || {}).map(([u, v]) => [u, v.links || []]));

/** host → 展示名 */
const HOST_NAME = {
  'mega.nz': 'MEGA', 'mega.co.nz': 'MEGA',
  'disk.yandex.com': 'Yandex 盘', 'disk.yandex.ru': 'Yandex 盘', 'yadi.sk': 'Yandex 盘',
  'mediafire.com': 'MediaFire', 'drive.google.com': 'Google Drive',
  'dropbox.com': 'Dropbox', 'dropboxusercontent.com': 'Dropbox',
  'pixeldrain.com': 'Pixeldrain', 'gofile.io': 'Gofile',
  'onedrive.live.com': 'OneDrive', '1fichier.com': '1fichier', 'anonfiles.com': 'Anonfiles',
};

/** 给一条 trainers 条目挂 dl（无外链返回 undefined）。
 *  形状与 flingdl.attach 同构：{kind, url, file, ext:true}；ext ⇒ 前端新标签直开。 */
function attach(item) {
  if (!item || (item.origin || '') !== 'the_cheat_script') return undefined;
  const ls = MAP.get(item.officialUrl || '');
  if (!ls || !ls.length) return undefined;
  return ls.map((l) => ({
    kind: HOST_NAME[l.host] || l.host,
    url: l.url,
    file: l.host === 'mega.nz' ? 'Cheat Engine Table (MEGA)' : '',
    ext: true,
  }));
}

function stats() {
  return Object.assign({ builtAt: RAW.builtAt, source: 'TheCheatScript 外链（MEGA / Yandex 等，新标签直开）' }, RAW.stats);
}

module.exports = { attach, stats, MAP, RAW };
