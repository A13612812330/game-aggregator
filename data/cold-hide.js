/**
 * 冷门隐藏（v10.84，2026-10-19 用户拍板）
 *
 * ★ 口径（AskUserQuestion 实测拍板）：`hot=0` 且 **非近 90 天新游**（publishTs 距今 ≥90d 或缺失）
 *   —— 近 90 天上架的新游有「热启动期」，热度还没积累，不许一刀切藏掉（现测 1,270 条）。
 *
 * ★ 行为边界（用户确认）：
 *   - 库内保留、详情页可达、搜索可搜到（search/detail 不做任何过滤）
 *   - 只在**列表层**隐藏：/api/library/browse 的 scope=pc 与 scope=all（池前过滤，分页前）
 *   - /api/hots、/api/category、/api/feed 是**源站实时镜像**（机地/XD 官网版面），
 *     冷门游戏本来就不在官网版面上，语义上不需要也不应该在这里过滤
 *   - /roster 看板是数据全景（管理视角），保持全量
 *
 * ★ 手工豁免：`data/hide-overrides.json`（旁路文件，不参与 git 也不被 daily-sync 覆盖——
 *   该文件不存在时静默跳过）：
 *     { "show": ["xd-8149"], "hide": ["xd-1234"] }
 *   show 强制显示（哪怕命中冷门口径），hide 强制隐藏（哪怕有热度）——两边都赢过规则。
 *
 * ★ 为什么是「现算」而不是落一份 cold-list.json：games.json 每日同步都在变
 *   （新游上架 ⇒ publishTs 进 90 天窗口；热度更新 ⇒ 脱离 hot=0），
 *   落文件必然漂移；现算 O(n) 毫秒级，永远与库一致（铁律：数字现测不抄记忆）。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const RECENT_MS = 90 * 864e5; // 90 天热启动期

/* 手工豁免清单（可选文件）—— v10.85 起支持运行时写入（/api/admin/hide-overrides，仅本机） */
const OVERRIDE_PATH = path.join(__dirname, 'hide-overrides.json');
function loadOverrides() {
  try {
    const raw = JSON.parse(fs.readFileSync(OVERRIDE_PATH, 'utf8'));
    return {
      show: Array.isArray(raw.show) ? raw.show : [],
      hide: Array.isArray(raw.hide) ? raw.hide : [],
    };
  } catch (e) { return { show: [], hide: [] }; } /* 文件不存在 = 无豁免，正常态 */
}
let overrides = loadOverrides();
const showSet = new Set(overrides.show);
const hideSet = new Set(overrides.hide);

/** 当前豁免快照（供 /api/admin/hide-overrides GET 与测试） */
function overridesSnapshot() {
  return { show: [...showSet].sort(), hide: [...hideSet].sort() };
}

/** 写豁免并持久化：show/hide 互斥（设置一边时从另一边移除），clear 两边都删 */
function setOverride(id, op) {
  if (op === 'show') { showSet.add(id); hideSet.delete(id); }
  else if (op === 'hide') { hideSet.add(id); showSet.delete(id); }
  else if (op === 'clear') { showSet.delete(id); hideSet.delete(id); }
  else throw new Error('op 必须是 show/hide/clear');
  fs.writeFileSync(OVERRIDE_PATH, JSON.stringify(overridesSnapshot(), null, 1) + '\n');
  return overridesSnapshot();
}

/** 重读豁免文件（server 长驻进程在文件被外部改动后调；本进程内 setOverride 不需要） */
function reload() {
  const o = loadOverrides();
  showSet.clear(); hideSet.clear();
  o.show.forEach((x) => showSet.add(x));
  o.hide.forEach((x) => hideSet.add(x));
}

/** 命中冷门口径（纯规则，不含豁免） */
function isCold(g) {
  if (typeof g.hot === 'number' && g.hot > 0) return false;
  if (g.publishTs && Date.now() - g.publishTs < RECENT_MS) return false; // 热启动期
  return true;
}

/** 最终是否隐藏：show 豁免 > hide 强制 > 冷门口径 */
function isHidden(g) {
  if (showSet.has(g.id)) return false;
  if (hideSet.has(g.id)) return true;
  return isCold(g);
}

/** 统计（传 gamesDb.all()），供 /api/cold/stats 与测试自证 */
function stats(all) {
  let cold = 0, hidden = 0, recentHot0 = 0;
  for (const g of all) {
    if (g.publishTs && Date.now() - g.publishTs < RECENT_MS && !(typeof g.hot === 'number' && g.hot > 0)) recentHot0++;
    if (isCold(g)) cold++;
    if (isHidden(g)) hidden++;
  }
  return {
    rule: 'hot=0 且非近90天新游',
    recentMs: RECENT_MS,
    total: all.length,
    cold,
    hidden,
    visible: all.length - hidden,
    recentHot0,               // 热启动期保护数（hot=0 但 90 天内上架）
    overrideShow: showSet.size,
    overrideHide: hideSet.size,
  };
}

/** 按 id 查最终隐藏态（不在库里返回 null——mh:* 条目无本库记录） */
function hiddenById(id, allGames) {
  const g = allGames.find((x) => x.id === id);
  return g ? isHidden(g) : null;
}

module.exports = { isCold, isHidden, stats, RECENT_MS, overridesSnapshot, setOverride, reload, hiddenById };
