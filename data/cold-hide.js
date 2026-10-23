/**
 * 冷门隐藏（v10.84，2026-10-19 用户拍板）
 *
 * ★ 口径（AskUserQuestion 实测拍板）：`hot=0` 且 **非近 90 天新游**（publishTs 距今 ≥90d 或缺失）
 *   —— 近 90 天上架的新游有「热启动期」，热度还没积累，不许一刀切藏掉（现测 1,327 条）。
 *
 * ★★ v10.109 加第二道（用户口径：「无人问津的游戏自动隐藏」→ 追问后拍板
 *   「加一道：无热度且无任何下载入口才藏」）：
 *   命中前两条之后，再看**这款有没有可用资源**（MOD / 修改器 / 存档 任一）。
 *   有资源 ⇒ 说明社区还在给它做东西，不是「无人问津」⇒ **不藏**。
 *
 *   为什么是「注入」而不是在 isCold 里 `require('./res-groups')`：
 *     res-groups → gamesDb → cold-hide 已经是一条真实依赖链，反向再 require
 *     会形成**循环依赖**（Node 会给到半初始化的 exports，表现为「平时好、启动早期炸」）。
 *     ⇒ 判定函数由 server.js 在启动时 setResourceProvider 注入；
 *        未注入时 hasResource() 恒 false ⇒ **行为退回 v10.84 口径**，不会因为缺依赖而改语义。
 *
 *   实测（2026-10-23，现算）：判冷 8,568 → 7459，**救回 1,109 款**有资源但没热度的游戏。
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
let OVERRIDE_PATH = path.join(__dirname, 'hide-overrides.json');

/** 测试钩子：把豁免文件指到 `_tmp/`，让测试**不写用户真实的 hide-overrides.json**。
 *
 *  ★ 为什么需要：豁免文件是**用户的决策记录**（哪些游戏被强制显示/隐藏）。
 *    测试验 `setOverride` 的语义时必然要写 —— 写真实文件就等于「跑一次测试改一次用户的决定」。
 *    实测踩到：test-v10109 的 admit 用例把真实游戏 xd-8149 写进了 show 名单，
 *    而且因为「清理条件依赖 beforeShow」不幂等，**再跑一次就清不掉了**。
 *  ⇒ 生产代码不要调用。 */
function _setOverrideFile(p) {
  OVERRIDE_PATH = String(p);
  reload();
}
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

/* ── v10.109 资源探针（注入式，见文件头「为什么是注入」） ─────────────
 * 约定：provider 返回一个 **Set<string>**（有资源的端游库 id），
 *   不是数组 —— 判冷要对 19,764 条各问一次，Set.has 是 O(1)，
 *   数组 includes 在列表过滤时会变成 O(n²)（4,000 × 19,764 次比较）。
 * TTL 30 分钟：daily-sync 每天重建一次资源表，长驻进程不重启，
 *   不能只在 setResourceProvider 时算一次（会一直用昨天的表）。
 *   ⚠️ 重建代价实测 1.6s（resGroups.build 要把 MOD/修改器/存档三份源解析并关联），
 *      所以 TTL 不能太短 —— 30 分钟内每 30 分钟付一次 1.6s，可以接受。 */
const RES_TTL = 30 * 60 * 1000;
let resProvider = null;
let resCache = null;
let resCacheAt = 0;

/** 注入「有资源的 id 集合」提供者（server.js 启动时调一次） */
function setResourceProvider(fn) {
  resProvider = typeof fn === 'function' ? fn : null;
  resCache = null;
  resCacheAt = 0;
}

/** 这款游戏有没有可用资源（未注入 ⇒ 恒 false，退回 v10.84 口径） */
function hasResource(id) {
  if (!resProvider) return false;
  const now = Date.now();
  if (!resCache || now - resCacheAt > RES_TTL) {
    try {
      const s = resProvider();
      /* provider 写错返回数组时兜一层 —— 否则 `.has` 抛 TypeError 会让整个列表 500，
         而「冷门判定失败」不该拖垮列表（降级比报错好：多显示几条，不是打不开）。 */
      resCache = s instanceof Set ? s : new Set(Array.isArray(s) ? s : []);
    } catch (e) {
      resCache = new Set();
    }
    resCacheAt = now;
  }
  return resCache.has(String(id || ''));
}

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
  /* ★ v10.109：豁免重载通常伴随「刚在后台改完数据」⇒ 资源表也一起作废，
     否则改完要等 30 分钟 TTL 才看见效果（会被当成「改了没用」）。 */
  resCache = null;
  resCacheAt = 0;
}

/** 命中冷门口径（纯规则，不含豁免） */
function isCold(g) {
  if (typeof g.hot === 'number' && g.hot > 0) return false;
  if (g.publishTs && Date.now() - g.publishTs < RECENT_MS) return false; // 热启动期
  if (hasResource(g.id)) return false;   // ★ v10.109 有 MOD/修改器/存档 ⇒ 不是无人问津
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
  let cold = 0, hidden = 0, recentHot0 = 0, rescuedByRes = 0;
  for (const g of all) {
    const noHot = !(typeof g.hot === 'number' && g.hot > 0);
    const inGrace = !!(g.publishTs && Date.now() - g.publishTs < RECENT_MS);
    if (noHot && inGrace) recentHot0++;
    /* ★ v10.109：命中前两道、但被「有资源」救回来的数量 —— 单独统计，
       否则「隐藏数变少了」会被误读成规则失效（数字变小必须有原因可查）。 */
    if (noHot && !inGrace && hasResource(g.id)) rescuedByRes++;
    if (isCold(g)) cold++;
    if (isHidden(g)) hidden++;
  }
  return {
    rule: 'hot=0 且非近90天新游 且 无可用资源(MOD/修改器/存档)',
    recentMs: RECENT_MS,
    total: all.length,
    cold,
    hidden,
    visible: all.length - hidden,
    recentHot0,               // 热启动期保护数（hot=0 但 90 天内上架）
    rescuedByRes,             // ★ v10.109 无热度但**有资源**⇒ 不藏的数量
    resourceProbe: !!resProvider, // 探针是否已注入（false ⇒ 跑的是 v10.84 旧口径）
    overrideShow: showSet.size,
    overrideHide: hideSet.size,
  };
}

/** 按 id 查最终隐藏态（不在库里返回 null——mh:* 条目无本库记录） */
function hiddenById(id, allGames) {
  const g = allGames.find((x) => x.id === id);
  return g ? isHidden(g) : null;
}

module.exports = {
  isCold, isHidden, stats, RECENT_MS, overridesSnapshot, setOverride, reload, hiddenById,
  /* v10.109：资源探针（server.js 注入；测试可直接注入以固定判据） */
  setResourceProvider, hasResource, RES_TTL,
  /* v10.109 测试隔离（见 _setOverrideFile 注释） */
  _setOverrideFile,
};
