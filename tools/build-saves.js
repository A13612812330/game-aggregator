/**
 * tools/build-saves.js — 构建「云存档」索引（存档位置库）
 *
 * 数据源：Ludusavi manifest —— https://github.com/mtkennerly/ludusavi-manifest
 *   文件：data/manifest.yaml（约 17MB / 33 万行，MIT 许可，社区长期维护）
 *   选用理由：Game-Save-Manager 自身的存档库挂在**签名 S3 + 客户端密钥**后面
 *   （见 Game-Save-Manager 的 SIGNED_URL_DOWNLOAD_ENDPOINT / CLIENT_API_KEY），
 *   无法离线获取；Ludusavi 的 manifest 是公开、开源、更新更勤的等价数据。
 *
 * 单条游戏形态（YAML）：
 *   "ELDEN RING":
 *     files:
 *       "<winLocalAppData>/EldenRing":
 *         tags: [save]
 *     registry:
 *       HKEY_CURRENT_USER/SOFTWARE/FromSoftware/ELDEN RING:
 *         tags: [save]
 *     cloud:
 *       steam: true
 *     steam:
 *       id: 1245620
 *
 * ★ 核心工程点：**流式过滤，绝不整份 parse**。
 *   17MB YAML 直接 yaml.load 会吃爆内存。做法是：
 *     逐行读 → 识别「列 0 且以 : 结尾」的行为顶层游戏名 → 只把**命中本地库**的块缓存下来
 *     → 最后对这几千个小块逐块 yaml.load（块很小，毫秒级）
 *
 * ★ 匹配沿用 fetch-trainers.js 的结论：端游库 title 是「中文/英文/别名」斜杠拼接串，
 *   必须**按 / 切段**入索引。
 *
 * 用法：
 *   node tools/build-saves.js              # 用 .cache/ludusavi-manifest.yaml
 *   node tools/build-saves.js --download   # 先联网拉取再构建
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '..');
const D = path.join(ROOT, 'data');
const CACHE_DIR = path.join(ROOT, '.cache');
const CACHE = path.join(CACHE_DIR, 'ludusavi-manifest.yaml');
const OUT = path.join(D, 'saves.json');
const URL = 'https://raw.githubusercontent.com/mtkennerly/ludusavi-manifest/master/data/manifest.yaml';

/** Ludusavi 占位符 → 人类可读路径。
 *  shown 用 Windows 口径（本项目面向「手机跑 PC 游戏」，模拟器里是虚拟 C 盘）。 */
const PLACEHOLDER = {
  '<base>': { shown: '<游戏安装目录>', note: '游戏安装目录' },
  '<home>': { shown: 'C:\\Users\\<用户名>', note: '用户主目录' },
  '<root>': { shown: '<系统盘>:\\', note: '系统盘根目录' },
  '<osUserName>': { shown: '<用户名>', note: '当前系统用户名' },
  '<storeUserId>': { shown: '<平台账号ID>', note: '平台账号 ID（Steam/Epic 等）' },
  '<winAppData>': { shown: 'C:\\Users\\<用户名>\\AppData\\Roaming', note: 'AppData\\Roaming' },
  '<winLocalAppData>': { shown: 'C:\\Users\\<用户名>\\AppData\\Local', note: 'AppData\\Local' },
  '<winLocalAppDataLow>': { shown: 'C:\\Users\\<用户名>\\AppData\\LocalLow', note: 'AppData\\LocalLow' },
  '<winDocuments>': { shown: 'C:\\Users\\<用户名>\\Documents', note: '文档' },
  '<winSavedGames>': { shown: 'C:\\Users\\<用户名>\\Saved Games', note: 'Saved Games' },
  '<winPublic>': { shown: 'C:\\Users\\Public', note: '公共目录' },
  '<winProgramData>': { shown: 'C:\\ProgramData', note: 'ProgramData' },
  '<winDir>': { shown: 'C:\\Windows', note: '系统目录' },
  '<xdgData>': { shown: '~/.local/share', note: 'XDG 数据目录' },
  '<xdgConfig>': { shown: '~/.config', note: 'XDG 配置目录' },
  '<xdgCache>': { shown: '~/.cache', note: 'XDG 缓存目录' },
};

/** 把带占位符的原始路径转成可读形式，并抽出用到的占位符说明 */
function humanize(p) {
  let shown = String(p);
  const notes = [];
  for (const [k, v] of Object.entries(PLACEHOLDER)) {
    if (shown.includes(k)) {
      shown = shown.split(k).join(v.shown);
      if (!notes.some((n) => n.k === k)) notes.push({ k, note: v.note });
    }
  }
  return { shown: shown.replace(/\//g, '\\'), notes };
}

function normKey(s) {
  return String(s || '').toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[：:·・,，.。!！?？'"“”‘’()（）\[\]【】《》<>~～\-–—_+*&/／|｜\\]/g, '');
}

function unquote(s) {
  let t = String(s).trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1);
    if (t.includes('\\')) t = t.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return t;
}

/* ---------- ★ v10.6 分层匹配（防误配） ----------
 * 原实现只有「精确钥匙」一层，于是清单英文短名与库内全名对不上就永不命中：
 *   query `Resident Evil 2` → residentevil2
 *   库内段 `Resident Evil 2:Remake` → residentevil2remake      ← 精确不等 → libId 落空
 * 结果：前端云存档卡片点了**没有任何反应**（实测 378 条无 libId，其中 122 条标题其实就在库内）。
 * 现按 cross-source-name-matching 规范补成两层：
 *   ① 精确钥匙（原逻辑，最可靠）
 *   ② 安全包含（**词边界**）+ 数字护栏 + **唯一候选**（宁缺勿错）
 * 系列名基座（剥掉副标题后的公共前缀）只允许精确命中，绝不参与模糊。 */
const SERIES_KEYS = new Set();

function tailNums(k) { return String(k || '').match(/\d{1,4}/g) || []; }

/** 数字一致性护栏：两侧都有数字却完全不重叠 → 判冲突（residentevil0 ✗ residentevil3remake） */
function numConflict(qKey, libKey) {
  const a = tailNums(qKey), b = tailNums(libKey);
  if (!a.length || !b.length) return false;
  return !a.some((x) => b.includes(x));
}

/* ⚠️ 这里曾经有一个 `safeContains(long, short)` 做「按词切分 + 完整词包含」，
 *    在**去空白键**的前提下它不成立（`starcraftremastered` 整个是一个 token，
 *    `starcraft` 不算完整词），导致纯字母查询全部失效。已删除 ——
 *    包含性与跨词子串的防护统一由 `extraIsDecoration` 承担。 */

/** 允许出现在「库名比查询名多出来的部分」里的**修饰词**。
 *  只收 editions / 复刻 / 副标题类后缀；不在表内的词一律否决。
 *
 *  ⚠️ 键是**去空白**的，所以修饰词必须按「可拼接」写（`nextstop` = next+stop），
 *     这也是为什么用正则重复而不是分词数组 —— 分词会把 `20thanniversary` 切成
 *     `20` + `thanniversary`，`th` 序数后缀粘进了下一个词。
 *  ⚠️ 纯数字**故意不列**：`2` / `3` / `#9` 都是作品号，列进来就等于关掉护栏。
 *  ⚠️ 单人字母也**故意不列**：`Vesper` vs `Vespera` 只多一个 `a`，
 *     把 `a` 当修饰词会让它混进来（实测复核时抓到的）。
 *  ⚠️ `vr` **故意不列**：VR 版是**独立作品**、存档目录也不同，
 *     `Bulletstorm` / `World War Z` / `The 7th Guest` / `Townsmen` / `Sniper Elite`
 *     都会被它错配到各自的 VR 版（实测复核 247 条时抓到的最主要一类误配）。 */
const DECOR_ATOM = '(?:remaster|remastered|remakes?|hd|definitive|editions?|complete|ultimate|deluxe|enhanced|goty|gold|anniversary|celebration|collection|classic|hypervisor|voices\\d*|next|stop|island|adventure|curiosity|dye|hard|year|and|the|of|支持网络联机|虚拟机版|重制版|重置版|决定版|终极版|豪华版|完全版|年度版|纪念版|周年纪念版|周年|版|\\d{1,2}(?:st|nd|rd|th)|\\d{1,4}year)';
const DECOR_RE = new RegExp('^(?:' + DECOR_ATOM + ')*$', 'i');

/** ★★ 防「作品号误配」的核心护栏 —— 库名相对查询名多出来的部分是否**全是修饰词**。
 *
 *  只有安全包含是不够的：`Baldur's Gate` ⊂ `baldursgate3` 通过了词边界判定，
 *  但多出来的 `3` 是**作品号**，两款根本不是同一作。实测未加此护栏时误配触目惊心：
 *    Baldur's Gate → 博德之门3 ／ Anthem → ANTHEM#9 ／ BioShock → 生化奇兵2 ／
 *    Assassin's Creed II → 刺客信条3重制版 ／ Age of Wonders → 奇迹时代4
 *  规则：把查询名从库名里**连续剥离**，剩下的部分必须能由修饰词拼成，
 *  且**不允许出现裸数字**（`20th` 序数、`20year` 周年除外）。宁缺勿错。 */
function extraIsDecoration(libKey, queryKey) {
  const lib = String(libKey || ''), q = String(queryKey || '');
  if (!lib || !q) return false;
  const i = lib.indexOf(q);
  if (i < 0) return false;                  // 必须是连续子串；顺序漂移说明对不齐，保守拒
  const extra = lib.slice(0, i) + lib.slice(i + q.length);
  return extra === '' || DECOR_RE.test(extra);   // ← 裸数字（作品号）在这里被拦下
}

/** 模糊锚点：取 key 的**前 3 个字符**分桶，避免 1.5 万条全表扫描。
 *  ⚠️ 踩过的坑：最初写的是 `k.match(/[a-z]+/)`，对**纯字母键**它会匹配整串，
 *     于是锚点 = 完整 key，分桶退化成「一键一桶」——
 *     只有像 `residentevil2`（`[a-z]+` 会在数字处停下）这种带数字的查询才碰得上，
 *     `anotherworld` / `drive rally` 这类**纯字母查询永远命中不了**。
 *     前 3 字符是稳定的：查询名（去掉修饰后缀后）通常就是库名的前缀。 */
function anchorOf(k) {
  const s = String(k || '');
  return s.length <= 3 ? s : s.slice(0, 3);
}

async function download() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  console.log(`拉取 ${URL} …`);
  const r = await fetch(URL, { signal: AbortSignal.timeout(280000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 1000000) throw new Error(`下载异常，仅 ${buf.length}B`);
  fs.writeFileSync(CACHE, buf);
  console.log(`  已缓存 ${(buf.length / 1048576).toFixed(1)}MB → .cache/ludusavi-manifest.yaml`);
}

/** 建**两张独立**索引：端游库（/ 切段）与手游中心（含别名）。
 *
 *  分开建的原因：两者语义不同 ——
 *    · 端游库命中 → 有真实 libId，可跳端游详情页
 *    · 手游中心命中 → 标记「手机能玩」，这才是手机专区语境下的默认筛选口径
 *  混在一张表里会让 libId 字段一会儿是端游 id、一会儿是手游键，前端没法用。 */
function buildIndex() {
  SERIES_KEYS.clear();                       // ★ 每次重建都清空，避免跨次残留
  const pcByName = new Map();
  const mobByName = new Map();
  const pcAnchor = new Map();
  const mobAnchor = new Map();
  const put = (map, anchorMap, k, rec) => {
    if (!k || k.length < 3) return false;
    const isNew = !map.has(k);
    if (isNew) map.set(k, rec);
    const a = anchorOf(k);
    let arr = anchorMap.get(a);
    if (!arr) anchorMap.set(a, arr = []);
    if (!arr.some((c) => c[0] === k)) arr.push([k, rec]);
    return isNew;
  };

  const gamesDb = require('../data/gamesDb');
  gamesDb.load();
  const all = gamesDb.all();
  for (const it of all) {
    const rec = { kind: 'pc', id: it.id, title: it.title, cover: it.cover || '', url: it.url || '' };
    for (const seg of String(it.title || '').split('/')) {
      const k = normKey(seg);
      put(pcByName, pcAnchor, k, rec);
      /* 系列名基座：只登记为「禁止模糊」名单，**不入精确索引**
       * （入库会让 `Resident Evil` 这类基座被首个插入者独占 → 张冠李戴）。
       * 只在中文副标题上剥，英文标题里的『:』是正式名的一部分
       * （`Resident Evil 2:Remake` 剥成 `Resident Evil 2` 反而会误伤）。 */
      const s = String(seg);
      if (/[\u4e00-\u9fff]/.test(s)) {
        const base = normKey(s.split(/[：:（(\[【]/)[0]);
        if (base && base !== k && base.length >= 2) SERIES_KEYS.add(base);
      }
    }
    for (const a of it.aliases || []) put(pcByName, pcAnchor, normKey(a), rec);
  }

  const mobilehub = require('../data/mobilehub');
  const hub = mobilehub.ensure();
  let hubKeys = 0;
  for (const it of hub.items || []) {
    const rec = {
      kind: 'mobile', k: it.k || it.name, name: it.name,
      title: it.libTitle || it.name,
      cover: it.libCover || it.cover || '',
      configs: it.configs || 0, records: it.records || 0,
    };
    const names = [it.name, ...(it.alt || []), it.libTitle].filter(Boolean);
    for (const n of names) if (put(mobByName, mobAnchor, normKey(n), rec)) hubKeys++;
  }

  return { pcByName, mobByName, pcAnchor, mobAnchor, pcCount: all.length, mobKeys: hubKeys, pcSeries: SERIES_KEYS.size };
}

/** 两层匹配：① 精确钥匙 → ② 连续子串 + 修饰词护栏（allowFuzzy=false 时只走精确层）。 */
function matchRec(byKey, anchorMap, key, allowFuzzy) {
  if (!key || key.length < 3) return null;
  const exact = byKey.get(key);
  if (exact) return exact;
  /* 模糊层准入：短 key 不参与（`天`/`火` 这类单字会滥配）；系列名基座不参与 */
  if (!allowFuzzy || key.length < 6 || SERIES_KEYS.has(key)) return null;
  const cands = anchorMap.get(anchorOf(key));
  if (!cands) return null;
  let found = null, foundKey = '';
  for (const [lk, rec] of cands) {
    if (lk.length <= key.length) continue;          // 只在「库名更长」的方向上包含
    if (SERIES_KEYS.has(lk)) continue;
    if (numConflict(key, lk)) continue;
    /* extraIsDecoration 同时承担两件事：
     *   ① 查询名必须是库名的**连续子串**（不是子串直接 false）；
     *   ② 多出来的部分必须能由修饰词拼成 —— 这一条替代了不可用的「词边界」，
     *      并拦下作品号（Baldur's Gate ✗ → 3）与跨词子串（elin ✗ Timeline）。 */
    if (!extraIsDecoration(lk, key)) continue;
    /* 走到这里，候选已被证明是「查询名 + 纯版本修饰」——
     * 即同一款游戏的不同打包（`voices38` / `HYPERVISOR` 复刻包 / 终极版）。
     * 本站对这款游戏只有一个详情页，取「修饰最少」的那个最接近裸标题。 */
    if (!found || lk.length < foundKey.length) { found = rec; foundKey = lk; }
  }
  return found;
}

/** ★ 流式扫描：只收集命中本地库的块 */
async function collectMatched(index) {
  const rl = readline.createInterface({
    input: fs.createReadStream(CACHE, 'utf8'),
    crlfDelay: Infinity,
  });
  const hits = new Map();   // 归一化名 -> {name, lines, pc, mob}
  let curName = null, curKey = null, curLines = null;
  let topTotal = 0, matched = 0, scanned = 0;

  const flush = () => {
    if (curName && curKey) {
      /* ★ 这里必须走 matchRec（含模糊层）——原先用 `byKey.has()` 精确判断，
       *   会把「只能模糊命中」的游戏在**扫描阶段就丢掉**，后面再补匹配也没用。 */
      const pc = matchRec(index.pcByName, index.pcAnchor, curKey, true);
      const mob = matchRec(index.mobByName, index.mobAnchor, curKey, false);
      if (pc || mob) {
        hits.set(curName, { name: curName, lines: curLines, pc, mob });
        matched++;
      }
    }
    curName = null; curKey = null; curLines = null;
  };

  for await (const line of rl) {
    scanned++;
    /* 顶层游戏名：列 0 起头，且以 `:` 或 `: {}` 结尾（`---` / `...` 除外） */
    if (/^\S/.test(line) && !/^(---|\.\.\.)/.test(line) && /:\s*(\{\})?\s*$/.test(line)) {
      flush();
      topTotal++;
      curName = unquote(line.replace(/:\s*(\{\})?\s*$/, ''));
      curKey = normKey(curName);
      curLines = [];
    } else if (curName !== null) {
      curLines.push(line);
    }
  }
  flush();

  return { hits, topTotal, matched, scanned };
}

function extract(name, body) {
  let obj;
  try {
    obj = yaml.load(JSON.stringify(name) + ':\n' + body.join('\n'));
  } catch (e) { return null; }
  const rec = obj && obj[name];
  if (!rec || typeof rec !== 'object') return null;

  const paths = [];
  for (const [raw, meta] of Object.entries(rec.files || {})) {
    const h = humanize(raw);
    paths.push({ raw, shown: h.shown, notes: h.notes, tags: (meta && meta.tags) || [] });
  }
  const regs = [];
  for (const [raw, meta] of Object.entries(rec.registry || {})) {
    regs.push({ raw: raw.replace(/\//g, '\\'), tags: (meta && meta.tags) || [] });
  }
  const cloud = [];
  for (const [k, v] of Object.entries(rec.cloud || {})) {
    if (v === true) cloud.push(k);
    else if (v && typeof v === 'object' && v.true !== undefined) cloud.push(k);
  }
  const steamId = rec.steam && rec.steam.id ? String(rec.steam.id) : '';

  if (!paths.length && !regs.length) return null;   // 没存档位置的不收
  return { paths, regs, cloud, steamId, installDir: Object.keys(rec.installDir || {})[0] || '' };
}

/* ★ 作为脚本运行时才执行构建；被 require 时只导出匹配器供回归测试使用
 *   （tools/test-saves-match.js 依赖这些纯函数做黑盒校验）。 */
if (require.main === module) (async () => {
  if (process.argv.includes('--download') || !fs.existsSync(CACHE)) await download();
  console.log(`清单：${(fs.statSync(CACHE).size / 1048576).toFixed(1)}MB`);

  const idx = buildIndex();
  console.log(`本地库索引：端游库 ${idx.pcCount} 款 / 手游中心 ${idx.mobKeys} 键`);

  const { hits, topTotal, matched, scanned } = await collectMatched(idx);
  console.log(`流式扫描 ${scanned} 行 ｜ 顶层游戏 ${topTotal} ｜ 命中本地库 ${matched}`);

  const items = [];
  let withPaths = 0, withReg = 0, withCloud = 0, withSteam = 0, phoneN = 0, pcN = 0, pcRescued = 0;
  const fuzzySamples = [];
  for (const { name, lines, pc: pcHit, mob: mobHit } of hits.values()) {
    const ext = extract(name, lines);
    if (!ext) continue;
    const k = normKey(name);
    /* ★ 复用流式扫描阶段已算好的匹配结果；缺失时用同一套 matchRec 补算，
     *   绝不要退化回 `byKey.get()` —— 那会丢掉模糊层刚救回来的条目。 */
    const mob = mobHit || matchRec(idx.mobByName, idx.mobAnchor, k, false);
    const pc = pcHit || matchRec(idx.pcByName, idx.pcAnchor, k, true);
    if (!mob && !pc) continue;

    if (ext.paths.length) withPaths++;
    if (ext.regs.length) withReg++;
    if (ext.cloud.length) withCloud++;
    if (ext.steamId) withSteam++;
    if (mob) phoneN++;
    if (pc) pcN++;
    if (pc && !idx.pcByName.has(k)) {               // ★ 精确层没命中、由模糊层救回
      pcRescued++;
      if (fuzzySamples.length < 300) fuzzySamples.push({ 清单名: name, 库内条数: pc.title, libId: pc.id });
    }

    items.push({
      k,
      name,                                   // 清单原始（英文）名
      title: (mob && mob.title) || (pc && pc.title) || name,   // 展示标题：优先中文
      phone: !!mob,                           // ★ 是否「手机能玩」（在手游中心内）
      mobK: mob ? mob.k : '',
      mobName: mob ? mob.name : '',
      libId: pc ? pc.id : '',                 // ★ 端游库 id（可跳端游详情）
      libCover: (mob && mob.cover) || (pc && pc.cover) || '',
      steamId: ext.steamId,
      cloud: ext.cloud,
      installDir: ext.installDir,
      paths: ext.paths,
      regs: ext.regs,
    });
  }

  items.sort((a, b) => (b.phone ? 1 : 0) - (a.phone ? 1 : 0)
    || (b.paths.length + b.regs.length) - (a.paths.length + a.regs.length)
    || a.name.localeCompare(b.name));

  const stats = {
    builtAt: Date.now(),
    total: items.length,
    manifestGames: topTotal,
    withPaths, withReg, withCloud, withSteam,
    phonePlayable: phoneN,
    inPcLib: pcN,
    pcRescued: pcRescued,      // ★ v10.6：精确层未命中、由模糊层救回的端游库关联数
    pathCount: items.reduce((n, x) => n + x.paths.length, 0),
    regCount: items.reduce((n, x) => n + x.regs.length, 0),
    source: 'Ludusavi manifest (MIT)',
  };

  const DRY = process.argv.includes('--dry');
  if (!DRY) fs.writeFileSync(OUT, JSON.stringify({ builtAt: stats.builtAt, stats, items }), 'utf8');

  console.log('\n=== 云存档构建结果 ===');
  console.log(`收录 ${stats.total} 款（清单共 ${topTotal} 款）`);
  console.log(`  存档路径 ${stats.pathCount} 条 ｜ 注册表项 ${stats.regCount} 条`);
  console.log(`  有文件路径 ${withPaths} ｜ 有注册表 ${withReg} ｜ 支持云存档 ${withCloud} ｜ 带 SteamID ${withSteam}`);
  console.log(`  ★ 手机能玩（在手游中心内）${phoneN} ｜ 在端游库内 ${pcN}（其中兜底救回 ${pcRescued}）`);
  console.log(`  禁止模糊的系列名基座 ${idx.pcSeries} 个`);
  if (DRY) {
    console.log('\n--- 兜底救回抽样（人工复核用）---');
    for (const s of fuzzySamples) console.log(`  ${s.清单名}  →  [${s.libId}] ${s.库内条数}`);
    console.log(`\n（干跑模式：未写入 data/saves.json）`);
  } else {
    console.log(`\n✅ 已写出 data/saves.json（${(fs.statSync(OUT).size / 1048576).toFixed(2)}MB）`);
  }
})();

module.exports = {
  normKey, anchorOf, tailNums, numConflict,
  extraIsDecoration, buildIndex, matchRec, SERIES_KEYS, DECOR_RE, DECOR_ATOM,
};
