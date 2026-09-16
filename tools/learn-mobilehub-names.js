#!/usr/bin/env node
/**
 * tools/learn-mobilehub-names.js — 为「手游中心统一索引」里未匹配端游库的游戏联网补名
 *
 * ★ 与 learn-cn-names.js 的分工：
 *   · learn-cn-names.js       针对**实测库**（中文名），给 phonecfg.js 用；
 *   · 本脚本                  针对**合并后的手游索引**（含社区库的大量英文名），给 mobilehub 用。
 *   社区库是英文名（`Pro Evolution Soccer 2013`、`Tomb Raider`），端游库是中文+英文混合标题，
 *   两边隔着「官方中文名」这道桥 —— 这正是需要联网查的原因。
 *
 * 数据源：Steam 官方商店 API（storesearch 反查 appid → appdetails 取官方中/英名）。
 * 防误配沿用 learn-cn-names 的四层护栏（相似度 / 白名单 / 否决表 / 跨文种），
 * 另外新增：**年份一致性校验**（`PES 2013` 不能配到 `实况足球2019`）。
 *
 * 输出 data/mobilehub-names.json：
 *   { "__meta": {...}, "aliases": { "<归一化源名>": ["<归一化别名>", ...] } }
 *
 * 用法：
 *   node tools/learn-mobilehub-names.js            # 只处理未命中的（推荐）
 *   node tools/learn-mobilehub-names.js --limit=200
 *   node tools/learn-mobilehub-names.js --dry
 */
const fs = require('fs');
const path = require('path');

const D = path.join(__dirname, '..', 'data');
const OUT = path.join(D, 'mobilehub-names.json');
/** ★ 断点文件：每批把「已处理的源名」记下来，中断后重跑自动跳过（见 SAVE_EVERY） */
const PROG = path.join(D, 'mobilehub-names.progress.json');
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GameHub/1.0' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** ★ 单请求超时（ms）。没有它时，ECONNRESET / 卡住的连接会把整轮拖到小时级 —— 
 *  这就是上一轮「跑了 30 分钟还没落盘」的直接原因之一。 */
const REQ_TIMEOUT = 8000;
/** ★ 每处理 N 款就增量落盘 + 记断点。脚本原本是「跑完才写」，中途中断颗粒无收。 */
const SAVE_EVERY = 25;

function norm(t) {
  let s = String(t == null ? '' : t).toLowerCase();
  s = s.replace(/[\s\u3000]+/g, '');
  s = s.replace(/[·・:：,，.。!！?？"'“”‘’()（）\[\]【】<>《》|｜/\\~～\-—_+*&#@$%^&;；＊]/g, '');
  return s;
}

/** 去掉「风格后缀/发布组标记」等噪音，便于 Steam 检索 */
function cleanQuery(title) {
  return String(title || '')
    .replace(/[-–—]\s*虚拟机版\s*$/i, '')
    .replace(/\bHYPERVISOR\b/gi, '')
    .replace(/\bvoices\d+\b/gi, '')
    .replace(/\bklite\b/gi, '')
    .replace(/\s*支持网络联机\s*$/, '')
    .replace(/\s*(正式版|支持者版|整合版|免安装版)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 非游戏名噪音：这些是安装包残渣/工具名，不该去联网查 */
const NOISE = new Set([
  'unins000', '+', 'setup', 'install', 'readme', 'update', 'patch', 'crack',
  'config', 'launcher', 'start', 'play', 'game', 'main', 'data', 'bin',
  'runtime', 'dxsetup', 'vcredist', 'dotnet',
].map(norm));

/** ★ 纯数字/年份名：`2016`、`2019`、`2021` —— 这类必然误配（Steam 会返回任意同年游戏） */
function isNumericName(s) {
  const t = String(s || '').trim();
  return /^[\d\s\-–—_./]+$/.test(t);
}

/** ★ 长度闸门：太短的名字在 Steam 搜索里信噪比极低
 *  —— `Blur`→`Ricochet Blur`、`MOUSE`→`YoloMouse - Cursor Changer`、`DP`→`DP Animation Maker`、
 *  `SPEED2`→`Top Speed 2: Racing Legends`。这类全是社区库里被截断的残渣名，
 *  宁可判「未匹配」也不查：错配会挂错封面，比不匹配更糟。
 *  阈值依据：实测这批误配集中在 ≤6 个字母数字的纯英文名。 */
function tooShort(s) {
  const t = String(s || '').trim();
  const letters = t.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '');
  /* 中文 ≥2 字可以（`白昼`、`少女领域`），英文要 ≥7 字符 */
  if (/[\u4e00-\u9fa5]/.test(t)) return letters.length < 2;
  return letters.length < 7;
}

function similarity(a, b) {
  const A = norm(a), B = norm(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  if (A.includes(B) || B.includes(A)) return 0.82;
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

const MIN_SIM = 0.72;

/** ★ 「结果比源名多出一堆词」时降级：`Blur` → `Ricochet Blur` 相似度靠共享 "blur" 撑到 0.82，
 *  但语义上源名只是结果的一个词。要求：若命中的是**子串关系**，源名必须占结果的 ≥55% 长度，
 *  否则视为弱命中（宁可不要）。 */
function weakSubstring(src, found) {
  const A = norm(src), B = norm(found);
  if (!A || !B) return false;
  if (A === B) return false;
  if (B.includes(A)) return A.length / B.length < 0.55;
  if (A.includes(B)) return B.length / A.length < 0.55;
  return false;
}

/** 纯 CJK 源名 → 纯 ASCII 结果，判为跨文种误配 */
function scriptMismatch(src, found) {
  const hasCJK = (s) => /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(String(s || ''));
  const isASCII = (s) => /^[\x00-\x7f]+$/.test(String(s || '').trim());
  const s = String(src || '').trim();
  if (!s || !hasCJK(s)) return false;
  if (/[\x00-\x7f]/.test(s)) return false;
  return isASCII(found);
}

/** ★ 年份一致性：源名与结果都带 4 位年份且不一致 → 拒绝（PES 2013 ≠ 实况足球2019） */
function yearConflict(a, b) {
  const ya = String(a || '').match(/\b(19[89]\d|20[0-4]\d)\b/g) || [];
  const yb = String(b || '').match(/\b(19[89]\d|20[0-4]\d)\b/g) || [];
  if (!ya.length || !yb.length) return false;
  return !ya.some((y) => yb.includes(y));
}

async function steamSearch(term, lang) {
  const u = 'https://store.steampowered.com/api/storesearch/?term='
    + encodeURIComponent(term) + '&l=' + (lang || 'schinese') + '&cc=CN';
  const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(REQ_TIMEOUT) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return (await r.json()).items || [];
}
async function appName(appid, lang) {
  const u = 'https://store.steampowered.com/api/appdetails?appids=' + appid + (lang ? '&l=' + lang : '');
  const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(REQ_TIMEOUT) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = (await r.json())[appid]?.data;
  return d ? { cn: d.name || '', en: d.name_original || '' } : null;
}

/** ★ 跨语言桥：用 `l=english` 再查一次，拿到**官方英文名**（存在 d.name 里）
 *
 *  踩坑记录（v9.2）：源名是英文（社区库几乎全是英文名），而 `l=schinese` 返回的
 *  `name` 是中文、`name_original` 是 `undefined`（实测 Steam 该字段并不稳定返回）。
 *  于是「英文源名 ↔ 中文结果」用什么比相似度都必然低分：
 *    · `Black Myth Wukong`   vs `黑神话：悟空`            → 0.00
 *    · `The Seven Deadly Sins Origin` vs `七大罪：Origin` → 0.32
 *  这两款**确实是同款游戏**，属于护栏误杀。
 *
 *  修法：拿 appid 去 `l=english` 端点取官方英文名（如 `Black Myth: Wukong`），
 *  源名与它才是**同语言可比对象**，相似度立刻回到 1.0 量级。
 *  ⚠️ 顺带发现：`storesearch` 在本网络下对**纯英文关键词**会 ECONNRESET（中文关键词正常），
 *  所以英文源名要先用「中文名/英文名」两条路分别试，任一条成功即可。 */
async function officialEnglish(appid) {
  try {
    const d = await appName(appid, 'english');
    return (d && d.cn) || '';   /* l=english 时 d.name 就是官方英文名 */
  } catch (e) { return ''; }
}

(async () => {
  const args = process.argv.slice(2);
  const DRY = args.includes('--dry');
  const FRESH = args.includes('--fresh');     // ★ 忽略断点，从头跑
  const LIMIT = Number((args.find((a) => a.startsWith('--limit=')) || '').split('=')[1] || 0);

  const hub = JSON.parse(fs.readFileSync(path.join(D, 'mobilehub.json'), 'utf8'));
  /* ★ 只查「未匹配端游库」的；已匹配的不需要再查 */
  let targets = hub.items.filter((x) => !x.libId).map((x) => x.name);
  let skipped = { noise: 0, numeric: 0, short: 0 };
  targets = [...new Set(targets)].filter((t) => {
    if (!t) return false;
    if (NOISE.has(norm(t))) { skipped.noise++; return false; }
    if (isNumericName(t)) { skipped.numeric++; return false; }
    if (tooShort(t)) { skipped.short++; return false; }
    return true;
  });

  /* ★ 断点续跑：读上一轮已落盘的产物 + 进度，跳过已处理过的源名。
   *  这样「分多次跑」与「一次跑完」结果等价，中断不再颗粒无收。 */
  let prev = { aliases: {}, done: [] };
  if (!FRESH && fs.existsSync(OUT)) {
    try { prev.aliases = JSON.parse(fs.readFileSync(OUT, 'utf8')).aliases || {}; } catch (e) {}
  }
  if (!FRESH && fs.existsSync(PROG)) {
    try { prev.done = JSON.parse(fs.readFileSync(PROG, 'utf8')).done || []; } catch (e) {}
  }
  const doneSet = new Set(prev.done);
  const beforeShort = targets.length;
  targets = targets.filter((t) => !doneSet.has(t));

  if (LIMIT) targets = targets.slice(0, LIMIT);
  console.log(`待学习：${targets.length} 款（未匹配端游库的）`
    + (doneSet.size ? `　｜　断点跳过已处理 ${beforeShort - targets.length} 款` : ''));
  console.log(`  预过滤跳过：噪音 ${skipped.noise} ｜ 纯数字/年份 ${skipped.numeric} ｜ 过短 ${skipped.short}`);

  const aliases = Object.assign({}, prev.aliases);
  const done = prev.done.slice();
  let ok = 0, rejected = 0, err = 0;
  const rejLog = [];

  /** ★ 增量落盘：产物 + 断点一起写，保证任何时刻中断都不丢已得成果 */
  const flush = () => {
    const out = {
      __meta: {
        builtAt: Date.now(), total: Object.keys(aliases).length,
        learnedFrom: done.length, accepted: ok, rejected, errors: err, partial: true,
      },
      aliases,
    };
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf8');
    fs.writeFileSync(PROG, JSON.stringify({ done }, null, 0), 'utf8');
  };

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const q = cleanQuery(t);
    const hasEn = /[a-zA-Z]{3,}/.test(q);
    const term = hasEn ? (q.match(/[a-zA-Z][a-zA-Z0-9 :'’\-!.]{2,}/) || [q])[0].trim() : q;

    let pick = null;
    try {
      const items = await steamSearch(term);
      if (items.length) {
        const tl = term.toLowerCase();
        pick = items.find((x) => String(x.name || '').toLowerCase() === tl)
          || items.find((x) => String(x.name || '').toLowerCase().includes(tl))
          || items[0];
      }
    } catch (e) { err++; await sleep(400); continue; }

    if (pick) {
      let cn = '', en = '';
      try {
        const a1 = await appName(pick.id, 'schinese');
        cn = a1?.cn || pick.name || '';
        en = a1?.en || '';
        /* ★ 拿官方英文名（跨语言桥）—— 这是本版修好「英文源名↔中文结果」的关键一步 */
        await sleep(650);
        const oe = await officialEnglish(pick.id);
        if (oe) en = oe;
      } catch (e) { err++; }

      /* ★ 相似度：源名是英文时，与**官方英文名**比才是同语言可比对象。
       *  同时保留与中文名的比对（中文源名走这条），取最大值 —— 但用 `langBridge`
       *  标记「本次是通过同语言比中的」，供日志区分。 */
      const s1 = similarity(t, cn), s2 = similarity(t, en), s3 = similarity(q, en);
      const best = Math.max(s1, s2, s3);
      const cross = scriptMismatch(q, cn) && scriptMismatch(q, en);
      const ybad = yearConflict(q, cn) || yearConflict(q, en);
      /* ★ 弱子串降级要在「同语言那一侧」判：英文源名配英文官方名不该被判弱 */
      const weak = weakSubstring(q, en || cn) && weakSubstring(q, cn);

      if (best >= MIN_SIM && !cross && !ybad && !weak) {
        const keys = new Set([norm(t), norm(q), norm(cn), norm(en)].filter(Boolean));
        const src = norm(t);
        aliases[src] = [...keys].filter((k) => k !== src);
        ok++;
        if (ok <= 25) console.log(`  ✓ ${t}  →  ${cn}${en && en !== cn ? ' / ' + en : ''}`);
      } else {
        rejected++;
        if (rejLog.length < 20) {
          rejLog.push(`${t}  ✗  ${cn || en || pick.name}${en && en !== cn ? ' / ' + en : ''}  (分 ${best.toFixed(2)}${cross ? ' 跨文种' : ''}${ybad ? ' 年份冲突' : ''}${weak ? ' 弱子串' : ''})`);
        }
      }
    }

    /* Steam 限流：≈3 req/s。每款要打 3 个接口，故 700ms 更稳 */
    done.push(t);
    await sleep(700);
    if ((i + 1) % 25 === 0) {
      if (!DRY) flush();     /* ★ 增量落盘：中断也不丢 */
      console.log(`  …进度 ${i + 1}/${targets.length}  采纳 ${ok} / 拒绝 ${rejected} / 错误 ${err}  `
        + `（累计已存 ${Object.keys(aliases).length} 条）`);
    }
  }

  const out = {
    __meta: {
      builtAt: Date.now(), total: Object.keys(aliases).length,
      learnedFrom: done.length, accepted: ok, rejected, errors: err, partial: false,
    },
    aliases,
  };
  if (!DRY) {
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf8');
    fs.writeFileSync(PROG, JSON.stringify({ done }, null, 0), 'utf8');
  }

  console.log('\n=== 联网补名结果 ===');
  console.log(`查询 ${targets.length} ｜ 采纳 ${ok} ｜ 拒绝 ${rejected} ｜ 错误 ${err}`);
  console.log(`别名表累计 ${Object.keys(aliases).length} 条（含上轮断点继承）`);
  if (rejLog.length) { console.log('\n部分拒绝样本（说明护栏在起作用）：'); rejLog.forEach((l) => console.log('  ' + l)); }
  console.log(DRY ? '\n（--dry 模式，未写盘）' : `\n✅ 已写出 ${path.relative(path.join(__dirname, '..'), OUT)}`);
})();
