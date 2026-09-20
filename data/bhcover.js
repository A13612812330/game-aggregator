/**
 * data/bhcover.js — 社区库「仓库键」→ 端游库条目 / 封面      ★ **单一真源**
 *
 * 为什么需要它：
 *   机型兼容（`/api/device/match`）列出的游戏来自 BannerHub 的**仓库键**
 *   （`Pro_Evolution_Soccer_2013`），而封面只存在于**端游库条目**上。
 *   卡片要显示「图片 + 游戏名」，就得把键翻成库内条目。
 *   从前 `matchGames()` 没做这一步 ⇒ 前端读 `g.libCover` 恒为 undefined
 *   ⇒ `.cov.noimg` 把封面区整个隐藏 ⇒ 24 张卡一张图都没有（用户反馈的原始现象）。
 *
 * 为什么复用两个**已有的**持久化产物，而不是新写一套名称匹配：
 *   本项目铁律「同一语义只留一份实现」（PITFALLS 10/11）。名称匹配再写第二份必然漂移，
 *   而且跨源名称匹配一旦放宽就会串台（`ZTE Blade A73` 认成 `Samsung Galaxy A73` 那类）。
 *   下面两个来源都是构建期已算好、线上已在跑的：
 *     ① `bannerhub.libMatch({k})` —— 仓库键 ↔ 端游库标题键的**精确**对（`/api/bh/list` 在用）
 *     ② `mobilehub.json` 条目的 `bhKeys` 反查 —— 构建期 merge 时算出的（覆盖中文名匹配）
 *
 * 优先级：**① 优先**（键精确，比中文名匹配更可信）。
 *   实测两源都能给出封面时共 1,081 键：libId 一致 1,062、冲突 19（1.8%，多为不同版本/复刻 edition）。
 *   冲突时取 ① —— 宁可偏严。
 *   两源都没有 → 返回 `null`，**不编造**；卡片按手游专区同款语义走 `.cov.noimg`（封面区隐藏）。
 *
 * 覆盖率（2026-09-20 实测，2,657 个仓库键）：
 *   · 只用 ①          1,093（41.1%）
 *   · ①∪②             1,372（51.6%）
 *   · 取「小米 2412DPC0AG 可跑的 1,000 款」：526（52.6%），**首屏 24 张里 21 张有图**
 *   剩下没有的，一半是工具/启动器（`7-Zip`/`4gb_patch`/`ACOrigins` 这类本来就没有封面），
 *   另一半是库里标题带版本后缀（`Tomb Raider` vs `古墓丽影9终极版/Tomb Raider Definitive Edition`）
 *   —— 那是匹配率问题，不是本模块该放宽规则去凑的。
 */
const bannerhub = require('./bannerhub');
const mobilehub = require('./mobilehub');

/** ② mobilehub 索引：仓库键 → 条目（惰性建，mobilehub.ensure() 有 mtime 缓存，不会重复读盘） */
let mhMap = null;
function buildMh() {
  mhMap = new Map();
  try {
    const d = mobilehub.ensure();
    for (const it of d.items || []) {
      for (const k of it.bhKeys || []) if (!mhMap.has(k)) mhMap.set(k, it);
    }
  } catch (e) { /* 无合并索引文件 → 只剩 ①，降级但不报错 */ }
  return mhMap;
}

/**
 * 仓库键 → 库内条目。
 * @param {string|object} key 仓库键，或 bannerhub 游戏对象（直接读 `.k`）
 * @returns {{libId,libTitle,libUrl,libCover}|null}
 */
function of(key) {
  const k = key && typeof key === 'object' ? key.k : key;
  if (!k) return null;

  /* ① 精确键（bannerhub 的 libMatch） */
  try {
    const hit = bannerhub.libMatch({ k });
    if (hit) {
      /* 库里带封面才算数：`/api/bh/list` 的 libCover 口径就是 `lib.cover || null` */
      return {
        libId: hit.id || null,
        libTitle: hit.title || '',
        libUrl: hit.url || '',
        libCover: hit.cover || '',
      };
    }
  } catch (e) { /* 库文件缺失 → 退到 ② */ }

  /* ② 合并索引反查（构建期算好的中文名匹配结果） */
  if (!mhMap) buildMh();
  const it = mhMap.get(k);
  if (it && (it.libId || it.libCover)) {
    return {
      libId: it.libId || null,
      libTitle: it.libTitle || '',
      libUrl: it.libUrl || '',
      libCover: it.libCover || '',
    };
  }
  return null;
}

/**
 * 给一批「带 k 的游戏对象」就地挂平铺字段（前端读的是扁平的 g.libCover，
 * 避免到处写 `g.lib && g.lib.cover`）。返回挂上封面的条数。
 */
function attachAll(games) {
  let n = 0;
  for (const g of games || []) {
    if (!g || !g.k) continue;
    const m = of(g.k);
    g.libId = m ? m.libId : null;
    g.libTitle = m ? m.libTitle : '';
    g.libUrl = m ? m.libUrl : '';
    g.libCover = m ? m.libCover : '';
    if (g.libCover) n++;
  }
  return n;
}

/** 自检/测试用：两源各自的命中数 + 并集 */
function stats() {
  if (!mhMap) buildMh();
  return { mhKeys: mhMap.size, hasMhIndex: mhMap.size > 0 };
}

module.exports = { of, attachAll, stats, buildMh };
