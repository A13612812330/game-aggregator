/**
 * ★ v10.86：FitGirl Repack 匹配库（data/fitgirl.json 的读取层）
 *
 * 数据由 tools/gen-fitgirl.js 生成（目录快照 × 本体库匹配），勿手改。
 * 结构：byGame[游戏库 id] = [{ source, slug, url, title, date, adult }]，新帖在前。
 * 消费方：
 *   - GET /api/fitgirl/repacks   详情页「FitGirl Repack」外链档（ext:true 新标签直开）
 *   - GET /api/fitgirl/magnet    按需现抓单篇提 magnet（slug 白名单 = 本表，防 SSRF）
 */
'use strict';
const RAW = require('./fitgirl.json');

function byGame(id) {
  return RAW.byGame[String(id || '')] || [];
}

/** slug 白名单索引（加载时建一次 —— magnet 端点每次命中都要查，不能逐次扫全表） */
const slugSet = new Set();
for (const arr of Object.values(RAW.byGame)) for (const x of arr) slugSet.add(x.slug);

/** slug 是否在本表里（magnet 端点的白名单判据 —— 不在表里的 slug 一律 400） */
function has(slug) {
  return slugSet.has(String(slug || ''));
}

/** 详情页展示用的瘦身条目（表内字段已瘦，这里只做截断兜底） */
function slim(id, limit) {
  const cap = Math.min(8, Math.max(1, parseInt(limit, 10) || 8));
  return byGame(id).slice(0, cap);
}

function stats() {
  return {
    catalogSize: RAW.catalogSize,
    gamesTotal: RAW.gamesTotal,
    matchedGames: RAW.matchedGames,
    entryTotal: RAW.entryTotal,
    adultGames: RAW.adultGames,
    builtAt: RAW.builtAt,
  };
}

module.exports = { RAW, byGame, has, slim, stats };
