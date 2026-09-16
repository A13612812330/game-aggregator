#!/usr/bin/env node
/* 联网学习：为实测库里的游戏补「中文名 / 英文名」别名，写入 data/cn-names.json
 *
 * 为什么要做：
 *   实测库 1025 款里有 429 款匹配不到本地库。其中一大类是「同一个游戏、不同写法」：
 *     实测库「史丹利的寓言终极豪华版」 vs 本地库「史丹利的寓言：超豪华版」   ← 多冒号、词序不同
 *     实测库「FIFA18」                  vs 本地库「国际足球大联盟22/FIFA 22」 ← 官方中文名完全不同
 *     实测库「东方天空竞技场：幻想空战姬」 vs 本地库「东方天空竞技场：幻想乡空战姬」 ← 差一个字
 *   这些靠字符串规则补不全，需要「游戏库知识」——Steam 官方 API 恰好提供：
 *     /api/appdetails?appids=<id>&l=schinese   → 官方简体中文名
 *     /api/appdetails?appids=<id>              → 官方英文名
 *   于是策略是：英文名 → Steam 搜 appid → 取官方中英双名 → 建立双向别名。
 *
 * 输出 data/cn-names.json 结构：
 *   {
 *     "__meta": { builtAt, total, source },
 *     "aliases": { "<归一后的源名>": ["<归一后的别名1>", "..."] }
 *   }
 * phonecfg.js 的 libMatch 会把它并进匹配钥匙集。
 *
 * 用法：
 *   node tools/learn-cn-names.js            # 只处理未命中的
 *   node tools/learn-cn-names.js --all      # 全量重跑（慢，Steam 限流）
 *   node tools/learn-cn-names.js --dry      # 只打印不写盘
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..');
const OUT = path.join(DIR, 'data', 'cn-names.json');
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GameHub/1.0' };

const phonecfg = require(path.join(DIR, 'data', 'phonecfg.js'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function norm(t) {
  let s = String(t == null ? '' : t).toLowerCase();
  s = s.replace(/[\s\u3000]+/g, '');
  s = s.replace(/[·・:：,，.。!！?？"'“”‘’()（）\[\]【】<>《》|｜/\\~～\-—_+*&#@$%^&;；＊]/g, '');
  return s;
}

/** 去掉本地库标题里的版本后缀噪音，便于 Steam 检索 */
function cleanQuery(title) {
  return String(title || '')
    .replace(/[-–—]\s*虚拟机版\s*$/i, '')
    .replace(/\bHYPERVISOR\b/gi, '')
    .replace(/\bvoices\d+\b/gi, '')
    .replace(/\s*支持网络联机\s*$/, '')
    .replace(/\s*正式版\s*$/, '')
    .replace(/\s*支持者版\s*$/, '')
    .trim();
}

/** 相似度：0~1。用于校验 Steam 返回的是不是同一款游戏（防误配） */
function similarity(a, b) {
  const A = norm(a), B = norm(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  // 子串关系给高分（"fifa18" ⊂ "国际足球大联盟22fifa22"? 否 → 靠下面兜）
  if (A.includes(B) || B.includes(A)) return 0.82;
  // Dice 系数（双字符组）
  const grams = (s) => {
    const out = new Map();
    for (let i = 0; i < s.length - 1; i++) out.set(s.slice(i, i + 2), (out.get(s.slice(i, i + 2)) || 0) + 1);
    return out;
  };
  const ga = grams(A), gb = grams(B);
  let inter = 0, ta = 0, tb = 0;
  for (const [, v] of ga) ta += v;
  for (const [, v] of gb) tb += v;
  for (const [k, v] of ga) if (gb.has(k)) inter += Math.min(v, gb.get(k));
  return (2 * inter) / (ta + tb || 1);
}

/* 人工白名单：官方中文名与实测库写法差异大、规则判定不了但确实同款的。
   这些是「游戏库知识」，只能人工维护；每条都可核对 Steam/官网。 */
const KNOWN_SAME = {
  // 实测库写法 : Steam 官方中文名（或库内中文名）
  'fifa18': ['国际足球大联盟18', 'fifa18'],
  'fifa19': ['国际足球大联盟19', 'fifa19'],
  'fifa20': ['国际足球大联盟20', 'fifa20'],
  'fifa21': ['国际足球大联盟21', 'fifa21'],
  'fifa22': ['国际足球大联盟22', 'fifa22'],
  '史丹利的寓言终极豪华版': ['史丹利的寓言超豪华版', 'thestanleyparableultradeluxe'],
  '东方天空竞技场幻想空战姬': ['东方天空竞技场幻想乡空战姬', 'touhouskyarenamatsuriclimax'],
  '女神异闻录4黄金版': ['女神异闻录4黄金版', 'persona4golden'],
  '最终幻想6像素复刻版': ['最终幻想6', 'finalfantasyvi'],
  '最终幻想ll': ['最终幻想2', 'finalfantasyii'],
  '最终幻想lll': ['最终幻想3', 'finalfantasyiii'],
};

/** 相似度可接受阈值：低于此值视为「不确定」，宁可不配 */
const MIN_SIM = 0.62;

/** 人工否决表：这些源名**一律不接受** Steam 返回值（命中返回 null）
 *
 * 为什么需要：几款日系视觉小说（FLOWERS 系列、9-nine- 系列等）的中文名里
 * 含英文单词，Steam 搜索会命中完全无关的欧美游戏，而相似度（Dice 系数）
 * 只看字面——`flowers夏篇` vs `Wylde Flowers` 因共享 "flowers" 得分 0.64，
 * 越过了阈值。这类「字面像、游戏不同」的必须人工按名字否决，
 * 否则会给用户挂上**错误封面**（比没有封面更糟）。
 */
const VETO = new Set([
  'flowers夏篇', 'flowers秋篇', 'flowers冬篇', 'flowers春篇',
  '9nine新章', '9nine天色天歌天籁音', '9nine春色春恋春熙风', '9nine雪色雪花雪之痕',
  '天', '少女领域',
].map(norm));

/** 只有这些「强信号」才允许低相似度通过 */
function isTrusted(name, query) {
  const k = norm(name);
  return Object.values(KNOWN_SAME).some((arr) => arr.some((x) => norm(x) === k));
}

/** 跨文字系统护栏：源名是**纯 CJK**、Steam 返回值却是**纯 ASCII**（无任何汉字/假名）
 *  时，绝大多数情况是误配 —— 除非落在人工白名单里。
 *  例：`少女领域`（日系 GAL）不该配到 Steam 上的英文同名游戏。 */
function scriptMismatch(src, found) {
  const hasCJK = (s) => /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(String(s || ''));
  const isASCII = (s) => /^[\x00-\x7f]+$/.test(String(s || '').trim());
  const s = String(src || '').trim();
  if (!s || hasCJK(s) === false) return false;          // 源名本身不是纯 CJK → 不适用
  if (/[\x00-\x7f]/.test(s)) return false;              // 源名混了英文 → 不适用
  return isASCII(found);
}

async function steamSearch(term) {
  const u = 'https://store.steampowered.com/api/storesearch/?term='
    + encodeURIComponent(term) + '&l=schinese&cc=CN';
  const r = await fetch(u, { headers: UA });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  return j.items || [];
}

async function steamApp(appid) {
  const u = 'https://store.steampowered.com/api/appdetails?appids=' + appid + '&l=schinese';
  const r = await fetch(u, { headers: UA });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  const d = j && j[appid] && j[appid].data;
  return d ? { cn: d.name || '', en: d.name_original || '' } : null;
}

async function alsoEnglishName(appid) {
  const u = 'https://store.steampowered.com/api/appdetails?appids=' + appid;
  const r = await fetch(u, { headers: UA });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  const d = j && j[appid] && j[appid].data;
  return d ? (d.name || '') : '';
}

(async () => {
  const args = process.argv.slice(2);
  const ALL = args.includes('--all');
  const DRY = args.includes('--dry');

  phonecfg.load();
  const games = phonecfg.ensure().games || [];

  // 目标：未命中本地库的（--all 时全部）
  const targets = [];
  for (const g of games) {
    const t = g.title || '';
    if (!t) continue;
    if (!ALL && phonecfg.libMatch(t)) continue;
    targets.push(t);
  }
  console.log(`待学习：${targets.length} 款（${ALL ? '全量' : '仅未命中'}）`);

  const aliases = {};
  let ok = 0, noHit = 0, err = 0, rejected = 0;
  const rejectedLog = [];

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const q = cleanQuery(t);
    // 查询词：英文名优先（Steam 搜索对英文更准），否则用原名
    const hasEn = /[a-zA-Z]{3,}/.test(q);
    const term = hasEn ? (q.match(/[a-zA-Z][a-zA-Z0-9 :'’\-!.]{2,}/) || [q])[0].trim() : q;

    let found = null;
    try {
      const items = await steamSearch(term);
      if (items.length) {
        const tl = term.toLowerCase();
        const pick = items.find((x) => String(x.name || '').toLowerCase() === tl)
          || items.find((x) => String(x.name || '').toLowerCase().includes(tl))
          || items[0];
        const cn = pick.name || '';
        const en = await alsoEnglishName(pick.id);
        found = { id: pick.id, cn, en };
      }
    } catch (e) { err++; }

    // ★ 防误配：三层拦截
    //   ① 人工否决表（VETO）——字面像但确认不同款的，直接不要
    //   ② 跨文字系统护栏（scriptMismatch）——纯中文名配到纯英文结果，判为误配
    //   ③ 相似度阈值（MIN_SIM）+ 人工白名单（isTrusted）
    let accept = false;
    if (found && (found.cn || found.en) && !VETO.has(norm(t)) && !VETO.has(norm(q))) {
      const s1 = similarity(t, found.cn);
      const s2 = similarity(t, found.en);
      const s3 = similarity(q, found.en);
      const best = Math.max(s1, s2, s3);
      const trusted = isTrusted(found.cn, q) || isTrusted(found.en, q);
      const crossScript = scriptMismatch(q, found.cn) && scriptMismatch(q, found.en);
      if (trusted || (best >= MIN_SIM && !crossScript)) {
        accept = true;
      } else {
        rejected++;
        if (rejectedLog.length < 25) {
          rejectedLog.push(`${t}  ✗  ${found.cn || found.en}  (相似度 ${best.toFixed(2)}${crossScript ? ' · 跨文种' : ''})`);
        }
      }
    } else if (found && (VETO.has(norm(t)) || VETO.has(norm(q)))) {
      rejected++;
      if (rejectedLog.length < 25) rejectedLog.push(`${t}  ✗  ${found.cn || found.en}  (人工否决)`);
    }

    if (accept) {
      const keys = new Set([norm(t), norm(q)]);
      if (found.cn) keys.add(norm(found.cn));
      if (found.en) keys.add(norm(found.en));
      // 人工白名单里的别名也并入
      for (const v of (KNOWN_SAME[norm(t)] || [])) keys.add(norm(v));
      keys.delete('');
      const arr = [...keys];
      const src = norm(t);
      aliases[src] = arr.filter((k) => k !== src);
      ok++;
      if (ok <= 20) console.log(`  ✓ ${t}  →  ${found.cn}${found.en && found.en !== found.cn ? ' / ' + found.en : ''}`);
    } else {
      noHit++;
    }

    if ((i + 1) % 25 === 0) {
      console.log(`  … ${i + 1}/${targets.length}  采纳 ${ok} ｜ 无结果 ${noHit} ｜ 拒收 ${rejected} ｜ 错误 ${err}`);
    }
    await sleep(320);   // Steam 限流：约 3 req/s
  }

  const payload = {
    __meta: {
      builtAt: Date.now(),
      total: Object.keys(aliases).length,
      source: 'steam-store-api',
      learnedFrom: targets.length,
      rejected,
    },
    aliases,
  };

  console.log(`\n结果：采纳 ${ok} ｜ 无结果 ${noHit} ｜ 拒收（疑似不同款） ${rejected} ｜ 错误 ${err}`);
  if (rejectedLog.length) {
    console.log('\n--- 被拒收样例（这些宁可空着也不配错）---');
    rejectedLog.forEach((l) => console.log('  ' + l));
  }
  if (DRY) {
    console.log('(--dry 模式，未写盘)');
    return;
  }
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 1), 'utf8');
  console.log(`✅ 已写入 ${OUT}（${Object.keys(aliases).length} 条别名）`);
})();
