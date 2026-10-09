/* tools/test-related-dl.js — 「同分类更多（多因子打分）」+「详情页下载入口」回归 —— 第 10 道防线
 *
 * 这一版修的是两个**用户直接看到的问题**，而且都是「看起来能用、其实全错」的那种：
 *
 *   ① 同分类更多里的游戏不适配 —— 根因不是算法调参，而是**数据前提错了**：
 *      games.json 里每款只有 1 个类型标签，而「动作冒险」独占 36.8%；
 *      标签里还混着 `免费专区/联机整合/模拟器整合` 这类**运营标签**（不是游戏类型）。
 *      旧实现 `browse(g=genres[0]) + 随机洗牌` = 抽卡。
 *   ② 详情页没有任何下载入口 —— 机地社区那 8,943 条带网盘直链的 MOD/修改器帖
 *      （v10.9 抓的）从没接进详情页；而「修改器」区块走的是 GCM 元数据（无下载地址）。
 *
 * 所以本脚本分两组把不变量钉死：
 *   A. data/related.js 的打分语义（运营标签不参与、系列优先、自身排除、性能、字段完整）
 *   B. public/index.html 的两个新函数（jsdom + 桩 fetch）：
 *      `loadDlBlock` 必须**同时传 id 与 t**（只传一个会漏），必须给跳转而不是自己转存；
 *      `loadRelated` 必须渲染推荐理由徽标；`#dlSlot` 必须排在 `#relSlot` 之后（用户口径「在后面」）。
 *
 * 运行：node tools/test-related-dl.js
 * 依赖：无需服务端（jsdom 直接读本地 public/index.html，fetch 全量打桩）
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const related = require('../data/related');
const gamesDb = require('../data/gamesDb');

let pass = 0, fail = 0;
const bad = [];
function t(ok, label, detail) {
  if (ok) pass++; else { fail++; bad.push(label); }
  console.log(`${ok ? '  PASS' : '× FAIL'}  ${label}${detail ? '  —— ' + detail : ''}`);
}

gamesDb.load();
const ALL = gamesDb.all();

/* ============================================================
 * A. data/related.js —— 打分语义
 * ============================================================ */
console.log('\n=== A. 多因子打分（data/related.js）===');

/* A1. 数据前提：把「标签极度集中」钉住。
      哪天源站补了标签，会先在这里亮灯，提醒重新评估权重。
   ★ v10.22 重新校准（**不是放宽，是数据真的变了**）：
     机地全量话题入库（66 → 17,220 条，库 15,385 → 18,928）后，
     机地侧的 `genres` 是**多标签**的（XD 侧几乎只有一个），于是实测：
       · 单标签占比    90%+ → **83.9%**（1 个 15,878 / 2 个 2,862 / 3 个 84 / 4+ 71）
       · 「动作冒险」占比 36.8% → **29.8%**（5,634 / 18,928）
     结论**没变**：单一分类仍是绝对主流，且「动作冒险」依旧是个超大桶 ——
     所以「按 `genres[0]` 取候选池 + 随机洗牌」仍然是错的（旧算法失效的原因还成立）。
     阈值按新实测下调到 0.80 / 0.25，并且**顺手加一条**：多标签游戏必须走「标签交集」
     而不是只看 `genres[0]`（见下面 A1-b）。 */
{
  const byGenre = new Map();
  const lenHist = new Map();
  for (const g of ALL) {
    const gs = g.genres || [];
    lenHist.set(gs.length, (lenHist.get(gs.length) || 0) + 1);
    for (const x of gs) byGenre.set(x, (byGenre.get(x) || 0) + 1);
  }
  const one = lenHist.get(1) || 0;
  const top = [...byGenre.entries()].sort((a, b) => b[1] - a[1])[0];
  t(one / ALL.length >= 0.8, '前提：八成以上游戏只有一个类型标签（多标签不足以救 genres[0] 过滤）',
    `${one}/${ALL.length} = ${(one / ALL.length * 100).toFixed(1)}%`);
  t(top[0] === '动作冒险' && top[1] / ALL.length > 0.25, '前提：「动作冒险」仍是超大桶（旧算法 genres[0] 过滤必然扎堆）',
    `${top[0]} ${top[1]} 条 = ${(top[1] / ALL.length * 100).toFixed(1)}%`);
}

/* A1-b. ★ v10.22 新增：多标签游戏（2,862+ 条）必须按**标签交集**取候选池。
        只取 genres[0] 的话，一款「动作 + 角色扮演」的游戏只会召回动作类，
        另一半个标签白丢 —— 而它在数据里占 16%，已经不是可以忽略的噪声。 */
{
  const multi = ALL.filter((g) => (g.genres || []).filter((x) => !related.OP_TAGS.has(x)).length >= 2 && g.url);
  t(multi.length > 1000, '库里有两千条量级的多标签游戏（v10.22 机地入库带来的）', String(multi.length));
  const cur = multi[0];
  const r = related.related({ id: cur.id, t: cur.title, limit: 8 });
  const share = r.items.filter((x) => (x.genres || []).some((gg) => (cur.genres || []).includes(gg)));
  t(r.items.length > 0 && share.length === r.items.length,
    '多标签游戏的推荐结果**每一条**都与其共享至少一个标签（交集逻辑，不是只看 genres[0]）',
    `${share.length}/${r.items.length}｜当前 ${cur.genres.join('+')}`);
}

/* A2. 运营标签必须被识别出来，且不参与推荐 */
{
  const op = ['免费专区', '联机整合', '模拟器整合'];
  t(op.every((x) => related.OP_TAGS.has(x)), '运营标签在 OP_TAGS 里（免费专区/联机整合/模拟器整合）');
  t(!related.OP_TAGS.has('动作冒险') && !related.OP_TAGS.has('角色扮演'), '真实类型标签不在 OP_TAGS 里');
  const r = related.related({ g: '联机整合', t: '', limit: 6 });
  t(r.genre === null, '当前游戏只有运营标签时，不把它当作分类展示', `genre=${JSON.stringify(r.genre)}`);
}

/* A3. 系列名提取 */
{
  const cases = [
    ['生化危机4 重制版', '生化危机'],
    ['刺客信条：奥德赛', '刺客信条'],
    ['怪物猎人：世界', '怪物猎人'],
    ['Cyberpunk 2077', 'cyberpunk'],
    ['只狼：影逝二度/Sekiro: Shadows Die Twice', '只狼'],
  ];
  let ok = 0;
  for (const [inp, want] of cases) {
    const got = related.seriesKey(inp);
    if (got === want) ok++; else console.log(`      · seriesKey(${inp}) = ${got}（期望 ${want}）`);
  }
  t(ok === cases.length, '系列名提取（剥副标题/版本词/多语言串）', `${ok}/${cases.length}`);
  t(related.seriesKey('') === '' && related.seriesKey('/') === '', '空标题不产生系列键');
}

/* A4. 同系列优先：拿库里真实存在的系列验证 */
{
  let cur = null, sib = null;
  const count = new Map();
  for (const g of ALL) { const k = related.seriesKey(g.title); if (k) count.set(k, (count.get(k) || 0) + 1); }
  for (const g of ALL) {
    const k = related.seriesKey(g.title);
    if (k && count.get(k) >= 3 && /[\u4e00-\u9fff]/.test(k) && k.length >= 3) { cur = g; break; }
  }
  if (cur) {
    const k = related.seriesKey(cur.title);
    const r = related.related({ id: cur.id, t: cur.title, limit: 8 });
    sib = r.items.filter((x) => related.seriesKey(x.title) === k);
    t(sib.length >= 1, `同系列条目被排进前 8（系列=${k}）`, `命中 ${sib.length} 条：${sib.slice(0, 2).map((x) => x.title.slice(0, 18)).join(' / ') || '无'}`);
  } else {
    t(false, '同系列优先：库里找不到 ≥3 款的系列样本');
  }
}

/* A5. 自身/同名必须排除；每条结果都得能跳 */
{
  let checked = 0, leaked = 0, noUrl = 0, dupName = 0;
  for (const g of ALL.slice(0, 400)) {
    if (!g.id || !g.title) continue;
    const r = related.related({ id: g.id, t: g.title, limit: 6 });
    checked++;
    const curSeg = related.mainSeg(g.title).toLowerCase();
    for (const it of r.items) {
      if (it.id === g.id) leaked++;
      if (!it.url) noUrl++;
      if (related.mainSeg(it.title).toLowerCase() === curSeg) dupName++;
    }
    if (checked >= 60) break;
  }
  t(leaked === 0, '结果里不含当前游戏本身', `抽查 ${checked} 款，泄漏 ${leaked}`);
  t(noUrl === 0, '每条结果都带 url（可直跳）', `缺 url ${noUrl}`);
  t(dupName === 0, '结果里不含同名（含另一源同款）', `同名 ${dupName}`);
}

/* A6. 评分接近度：cur 有评分时，结果不应跑出评分区间太远 */
{
  const cur = ALL.find((g) => g.score >= 9 && (g.genres || []).length && g.id);
  const r = related.related({ id: cur.id, t: cur.title, limit: 8 });
  const near = r.items.filter((x) => typeof x.score === 'number' && x.score > 0 && Math.abs(x.score - cur.score) <= 3).length;
  t(near >= Math.ceil(r.items.length / 2), '评分接近度生效（过半结果评分差 ≤3）',
    `cur=${cur.score}，近分 ${near}/${r.items.length}`);
}

/* A7. 容量接近度：结果容量不应与 cur 差两个数量级 */
{
  const cur = ALL.find((g) => /^\d+(\.\d+)?GB$/.test(g.size || '') && parseFloat(g.size) > 20 && g.id);
  const r = related.related({ id: cur.id, t: cur.title, limit: 8 });
  const gb = gamesDb.sizeGb(cur.size);
  const close = r.items.filter((x) => { const v = gamesDb.sizeGb(x.size); return v && (v / gb < 10 && gb / v < 10); }).length;
  t(close >= Math.ceil(r.items.length / 2), '容量接近度生效（过半结果与 cur 同数量级）',
    `cur=${cur.size}，同量级 ${close}/${r.items.length}`);
}

/* A8. 性能：单次调用必须毫秒级（守 O(n²) 回归 —— 曾用 all.indexOf 写过一版） */
{
  const cur = ALL[0];
  const t0 = Date.now();
  for (let i = 0; i < 5; i++) related.related({ id: cur.id, t: cur.title, limit: 6 });
  const ms = Date.now() - t0;
  t(ms < 1500, '单次打分 < 300ms（15k 全库 × 5 次合计 <1.5s）', `5 次合计 ${ms}ms`);
}

/* A9. 返回结构 */
{
  const r = related.related({ t: '赛博朋克2077', limit: 6 });
  t(r && r.ok === true && Array.isArray(r.items), '返回 {ok, items}');
  t(typeof r.pool === 'number' && r.pool > 0, '返回候选池大小 pool', `pool=${r.pool}`);
  const it = r.items[0] || {};
  t(['id', 'title', 'url', 'genres'].every((k) => k in it), '条目字段完整（id/title/url/genres）', Object.keys(it).slice(0, 8).join(','));
}

/* ============================================================
 * B. public/index.html —— 两个新函数（jsdom + 桩 fetch）
 * ============================================================ */
console.log('\n=== B. 详情抽屉两个新块（jsdom + 桩 fetch）===');

const MODS_PAYLOAD = {
  ok: true, t: '赛博朋克2077', id: 'xd-191', count: 9,
  items: [
    { id: '1', kind: 'mod', title: '1.01 Mod整合包', url: 'https://jidiyouxi.com/post/detail/1', ut: 1789437445, links: [{ url: 'https://pan.quark.cn/s/abc', kind: '夸克网盘' }, { url: 'https://pan.baidu.com/s/1x', kind: '百度网盘' }] },
    { id: '2', kind: 'modifier', title: '内置修改器 v2.1', url: 'https://jidiyouxi.com/post/detail/2', ut: 1789000000, links: [{ url: 'https://pan.xunlei.com/s/x', kind: '迅雷网盘' }] },
  ],
};
/* ★ v10.28：详情页下载区改走 /api/download —— 按源站话题专区切分（本体 / Mod / 修改器），
   而 /api/mods/match 只有 Mod / 修改器两类、**没有本体**。桩数据同步换成它的形状：
     `items[].section` = 每条地址的归属（用来分组）
     `sections[].count` = 源站该专区的**帖子数**（权威口径，写在标头上）
   ⚠️ 这两个口径不能混用（「22 帖 / 60 个地址」看起来会自相矛盾）。
   MODS_PAYLOAD 保留：openModList 那条兜底链路（XD 源无专区概念时）仍会用到。 */
const DOWNLOAD_PAYLOAD = {
  ok: true, source: 'jidi',
  sections: [
    { key: 'body', name: '本体', count: 12, returned: 20 },
    { key: 'mod', name: 'Mod', count: 190, returned: 154, merged: true },
    { key: 'modifier', name: '修改器', count: 4, returned: 10 },
  ],
  items: [
    { real: 'https://pan.baidu.com/s/body1', server: 'baidu', postId: 3, postTitle: '本体免安装版', postUrl: 'https://jidiyouxi.com/post/detail/3', ct: 1789500000, section: 'body' },
    /* Mod 专区**故意给 4 帖**（> DL_PREV_CAP=3）—— 只有超过 3 帖才会出现「全部 N 帖 →」，
       桩数据给 1 帖的话那条断言永远测不到真东西。 */
    { real: 'https://pan.quark.cn/s/abc', server: 'quark', postId: 1, postTitle: '1.01 Mod整合包', postUrl: 'https://jidiyouxi.com/post/detail/1', ct: 1789437445, section: 'mod' },
    { real: 'https://pan.baidu.com/s/1x', server: 'baidu', postId: 1, postTitle: '1.01 Mod整合包', postUrl: 'https://jidiyouxi.com/post/detail/1', ct: 1789437445, section: 'mod' },
    { real: 'https://pan.baidu.com/s/m2', server: 'baidu', postId: 4, postTitle: '2.00 Mod包', postUrl: 'https://jidiyouxi.com/post/detail/4', ct: 1789400000, section: 'mod' },
    { real: 'https://pan.xunlei.com/s/m3', server: 'xunlei', postId: 5, postTitle: '3.00 Mod包', postUrl: 'https://jidiyouxi.com/post/detail/5', ct: 1789300000, section: 'mod' },
    { real: 'https://pan.quark.cn/s/m4', server: 'quark', postId: 6, postTitle: '4.00 Mod包', postUrl: 'https://jidiyouxi.com/post/detail/6', ct: 1789200000, section: 'mod' },
    { real: 'https://pan.xunlei.com/s/x', server: 'xunlei', postId: 2, postTitle: '内置修改器 v2.1', postUrl: 'https://jidiyouxi.com/post/detail/2', ut: 1789000000, section: 'modifier' },
  ],
};
const RELATED_PAYLOAD = {
  ok: true, genre: '动作冒险', series: '赛博朋克', pool: 5627,
  items: [
    { id: 'xd-9', title: '赛博朋克2077 往日之影/CP2077 Phantom Liberty', url: 'https://www.xdgame.com/game/9.html', cover: '', score: 9.4, size: '70GB', genres: ['动作冒险'], dateLabel: '2026-08-01', why: ['同系列'] },
    { id: 'xd-10', title: '巫师3：狂猎/The Witcher 3', url: 'https://www.xdgame.com/game/10.html', cover: '', score: 9.6, size: '50GB', genres: ['动作冒险'], dateLabel: '2026-07-01', why: [] },
  ],
};

function makeDom() {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const calls = [];
  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1:8123/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: new (require('jsdom').VirtualConsole)(),
    beforeParse(w) {
      w.fetch = function (u) {
        const url = String(u);
        calls.push(url);
        let body = { ok: true, items: [] };
        if (url.includes('/api/download')) body = DOWNLOAD_PAYLOAD;   // ★ v10.28：下载区的新数据源
        else if (url.includes('/api/mods/match')) body = MODS_PAYLOAD;
        else if (url.includes('/api/library/related')) body = RELATED_PAYLOAD;
        else if (url.includes('/api/library/browse')) body = { ok: true, items: [], total: 0 };
        else if (url.includes('/api/health')) body = { ok: true };
        return Promise.resolve({ ok: true, json: () => Promise.resolve(body), text: () => Promise.resolve('') });
      };
      w.scrollTo = () => {};
      w.Element.prototype.scrollIntoView = function () {};
      w.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
      w.AbortSignal = w.AbortSignal || { timeout: () => undefined };
    },
  });
  return { dom, calls };
}

(async () => {
  const { dom, calls } = makeDom();
  const w = dom.window;
  await new Promise((r) => setTimeout(r, 300));
  const doc = w.document;

  /* B1. 静态顺序：dlSlot 必须在 relSlot 之后（用户口径「在后面」） */
  const src = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const iRel = src.indexOf('<div id="relSlot"></div>');
  const iDl = src.indexOf('<div id="dlSlot"></div>');
  const iNo = src.indexOf('class="no-dl"');
  t(iRel > -1 && iDl > -1 && iRel < iDl && iDl < iNo,
    '#dlSlot 落在 #relSlot 之后、底部声明之前', `rel=${iRel} dl=${iDl} no-dl=${iNo}`);
  t(typeof w.loadDlBlock === 'function' && typeof w.loadRelated === 'function',
    '两个新函数都已定义在页面全局', `loadDlBlock=${typeof w.loadDlBlock} loadRelated=${typeof w.loadRelated}`);

  /* 造一个最小抽屉 */
  doc.body.insertAdjacentHTML('beforeend',
    '<div id="drawerBody"><div id="relSlot"></div><div id="dlSlot"></div></div>');

  const d = { title: '赛博朋克2077/Cyberpunk 2077', url: 'https://www.xdgame.com/game/191.html', source: 'xdgamer', genres: ['动作冒险'] };
  const fb = { id: 'xd-191', title: d.title, genres: ['动作冒险'] };

  /* B2. 下载区（★ v10.28 改造：数据源与版式都换了）
     · 数据源 /api/mods/match → /api/download（后者才有「本体」这一类）
     · 版式「4 条平铺 + 一个查看全部」→「三专区各露前 3 帖 + 每块一个全部按钮」 */
  await w.loadDlBlock(d, fb, d.title);
  const dl = doc.querySelector('#dlSlot').innerHTML;
  const dlCall = calls.filter((u) => u.includes('/api/download')).pop() || '';
  t(/\/api\/download\?url=/.test(dlCall) && /game%2F191|game\/191/.test(dlCall),
    '★ 下载区按**当前详情页 url**取数（id+t 联合匹配那个端点没有「本体」这一类）',
    dlCall.replace(/^.*\/api/, '/api').slice(0, 70));
  t(/本体免安装版/.test(dl) && /1\.01 Mod整合包/.test(dl) && /内置修改器 v2\.1/.test(dl),
    '★ 三个专区的帖子标题都渲染出来了（含 mods/match 拿不到的「本体」）');
  t(/data-sec="body"/.test(dl) && /data-sec="mod"/.test(dl) && /data-sec="modifier"/.test(dl),
    '★ 三专区各成一块（data-sec 标识），不是混在一张表里');
  t(/夸克|百度|迅雷/.test(dl), '展示网盘类型（让用户知道点进去是什么网盘）');
  t((dl.match(/target="_blank"/g) || []).length >= 2, '每条都是新窗口跳转（打开帖子）', `target=_blank ×${(dl.match(/target="_blank"/g) || []).length}`);
  t(/源帖 ↗/.test(dl) && /jidiyouxi\.com\/post\/detail\/1/.test(dl), '跳转指向源站帖子详情页，而非本站转存');
  t(/云存档位置/.test(dl) && /#sv/.test(dl), '同屏给出「云存档位置」入口（用户提到的云存档那一档）');
  t(/个资源帖/.test(dl) && /个网盘地址/.test(dl),
    '★ 写明「N 个资源帖 · M 个网盘地址」两个口径（帖数与地址数是两回事，混用会读起来自相矛盾）',
    (dl.match(/共 <b>\d+<\/b> 个资源帖/) || [''])[0]);
  t(/全部 4 帖 →/.test(dl),
    '★ 超过 3 帖的专区给「全部 N 帖 →」入口（Mod 桩数据 4 帖）');
  t((dl.match(/全部 \d+ 帖 →/g) || []).length === 1,
    '★ 不足 3 帖的专区**不给**「全部」按钮（本体 1 帖、修改器 1 帖都不该有）',
    `按钮数 ${(dl.match(/全部 \d+ 帖 →/g) || []).length}`);
  /* 行渲染器是 dlRow()，产出 `.dl-it`；预览与弹窗**共用同一个函数**（两处各写一套必然漂移）。
     桩数据：本体 1 帖 + Mod 4 帖 + 修改器 1 帖；Mod 按 cap 截到 3 ⇒ 1 + 3 + 1 = 5 行。 */
  const rowCnt = (dl.match(/class="dl-it"/g) || []).length;
  t(rowCnt === 5, '★ 每块预览按 DL_PREV_CAP=3 截断（1 + 3 + 1 = 5 行；全量是 6 帖）', `${rowCnt} 行`);

  /* B3. 推荐位：理由徽标 + 跳转 */
  await w.loadRelated(d, fb);
  const rel = doc.querySelector('#relSlot').innerHTML;
  const relCall = calls.filter((u) => u.includes('/api/library/related')).pop() || '';
  t(/library\/related\?/.test(relCall) && /[?&]id=xd-191/.test(relCall) && /[?&]t=/.test(relCall),
    '推荐位走新端点且带 id + t（后端据此取当前游戏）', relCall.replace(/^.*\/api/, '/api'));
  t(/同系列/.test(rel) && /class="why"/.test(rel), '渲染推荐理由徽标（同系列）');
  t(/巫师3：狂猎/.test(rel) && /赛博朋克2077 往日之影/.test(rel), '渲染推荐条目（中文主名）');
  t(/openDetail\(/.test(rel), '每条都走 openDetail 直达详情');
  t(!/library\/browse/.test(relCall), '不再退回旧的 browse+洗牌 端点');

  /* B4. 接口空 → 判别「不留上一款的残影」 + 空态必须**说实话**
   *
   * ★ v10.45 改写（原判据：`#dlSlot.innerHTML === ''`）。
   *   起因：用户反馈「Skyrim 有 Mod/存档，详情页却看不到下载功能」。根因之一就是
   *   旧 `loadDlBlock` 在整组取不到时 `slot.innerHTML = ''` **一走了之** ——
   *   整块下载区凭空消失，用户读成「这款游戏没有下载」，而它的 Mod / 存档其实都在。
   *   ⇒ 现在改成渲染一句说明。所以「清空」这个**形式**作废，但它的**本意**
   *     （不许留下上一款的内容）一个字都不能丢，只是换成更准的判据：
   *       ① `#relSlot` 仍然清空（这条链路没动，判据逐字保留）；
   *       ② `#dlSlot` 里**不许**出现上一款的任何内容（分区块 / 帖子行 / 旧帖标题 / 源站帖链接）；
   *       ③ `#dlSlot` 必须给出**说明**（`.d-hint2`）而不是沉默清空 ——
   *          否则「空态」与「功能被删」在界面上无法区分（v10.13 在手机配置上踩过同款坑）；
   *       ④ 徽标不许 over-claim：本次桩数据没有 `needAuth` ⇒ 不许写「需登录源站」。
   *          （「要登录」与「源站这次没给」是两件事，混成一句会让用户登录后仍然没有，以为是站点坏了。） */
  const prevDl = doc.querySelector('#dlSlot').innerHTML;
  w.fetch = function (u) {
    const url = String(u);
    if (url.includes('/api/download')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, items: [], sections: [] }) });
    if (url.includes('/api/library/related')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, items: [] }) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
  };
  await w.loadDlBlock(d, fb, d.title);
  await w.loadRelated(d, fb);
  const nowDl = doc.querySelector('#dlSlot').innerHTML;

  t(/data-sec="body"/.test(prevDl) && /class="dl-it"/.test(prevDl),
    '  [前提] 上一轮 #dlSlot 里确实有内容（否则「不留残影」这条断言恒真）');
  t(doc.querySelector('#relSlot').innerHTML === '',
    '推荐位接口无数据时清空（不留上一个游戏的残影）');
  t(!/data-sec=/.test(nowDl) && !/class="dl-it"/.test(nowDl)
    && !/本体免安装版/.test(nowDl) && !/jidiyouxi\.com\/post\/detail\/1/.test(nowDl),
    '★ 下载区接口无数据时不留上一款的残影（分区块 / 帖子行 / 旧帖标题 / 源站帖链接都不许在）',
    nowDl.slice(0, 80));
  t(/d-hint2/.test(nowDl) && /Mod \/ 修改器 \/ 存档/.test(nowDl),
    '★ 空态必须给出说明并指出真正的出口（沉默清空会被读成「这块功能没了」）');
  t(/无可用地址/.test(nowDl) && !/需登录源站/.test(nowDl),
    '★★ 徽标跟着真实原因走：没有 needAuth 就不许写「需登录源站」（over-claim 会让用户白登录一次）',
    (nowDl.match(/class="cnt">[^<]*</) || [''])[0]);

  /* ★ 2026-10-09 收尾格式修正（**这不是排版洁癖，是汇总口径**）：
     原写法 `✅  42 通过 / 0 失败` —— 数字中间夹着「通过」，`\d+\s*\/\s*\d+` 匹配不上，
     而 `run-all.js` 当时是「取输出里最后一个 `n / m`」⇒ 它取到了上面 PASS 明细里的
     「多标签游戏…共享至少一个标签 —— **8/8**」，**整套被记成 8 条（少算 34）**。
     汇总少算不会让任何一条断言变红，只会让「通过 N 条」这个数字长期偏低 —— 静默的那种错。
     现在统一成与 test-mods / test-emulator-structure 同款：`n / m 通过`。 */
  console.log(`\n${fail ? '❌' : '✅'}  ${pass} / ${pass + fail} 通过`);
  if (bad.length) console.log('失败项：\n  · ' + bad.join('\n  · '));
  dom.window.close();
  process.exit(fail ? 1 : 0);
})();
