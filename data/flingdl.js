/** data/flingdl.js — FLiNG 修改器直链读取层（v10.81 / P1）
 *
 * 数据：tools/fetch-fling-dl.js 产出 data/fling-dl.json（officialUrl → links[]）。
 * 消费：server.js `/api/trainers/match` —— 给 origin=fling_* 的条目挂 `dl`（流代理 URL）。
 *
 * ★ 为什么消费 URL 不是源站直链：FLiNG 的 trainer-files 有 **Referer 防盗链**
 *   （实测无 Referer 403）—— 浏览器从本站点过去 Referer 是 gamehub ⇒ 必被拦。
 *   ⇒ 下发的 url 指向本站流代理 `/api/dl/fling?u=<path>`，由服务端带 Referer 取流回传。
 *   u 只允许 **路径**（/wp-content/uploads/… 或 archive 的完整 https URL 由 fetcher
 *   产出时就是完整 URL —— 两种都收，见 allow()）。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const RAW = JSON.parse(fs.readFileSync(path.join(__dirname, 'fling-dl.json'), 'utf8'));

/** officialUrl → [{zip, file, token}] */
const MAP = new Map(Object.entries(RAW.items || {}).map(([u, v]) => [u, v.links || []]));

/** 给一条 trainers 条目挂 dl（无直链返回 undefined，调用方按缺省处理）。
 *  返回形状与 mods.json 的 links 同构：{kind, url}，前端渲染零新增分支。 */
function attach(item) {
  if (!item || !/^fling_(main|archive)$/.test(item.origin || '')) return undefined;
  const ls = MAP.get(item.officialUrl || '');
  if (!ls || !ls.length) return undefined;
  return ls.map((l) => ({
    kind: 'FLiNG',
    url: '/api/dl/fling?u=' + encodeURIComponent(l.zip),
    file: l.file,
  }));
}

function stats() {
  return Object.assign({ builtAt: RAW.builtAt, source: 'FLiNG 官网自托管文件直链（经流代理）' }, RAW.stats);
}

module.exports = { attach, stats, MAP, RAW };
