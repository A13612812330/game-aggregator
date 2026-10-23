/* ★ v10.112 回归：列表筛选的三处真修（jsdom 行为层 + HTTP 实测）
 *
 * 用户口径：「检查是否有bug，其次优化后同步更新+上传github」。
 *
 * 守的不变量：
 *   A. **冷门剔除与三个附加筛选解耦**
 *      改前 `if (isAdminView && !o.excludeCold)` ⇒ hidden / asrc / note 只在 cold=0 时生效。
 *      以前没炸只是因为后台的 cold 开关是死控件（永远发 0）。本版修好开关之后，
 *      这三个筛选会当场全部失效且**不报错**（实测 total 全部退回 12,308 = 与不加筛选一样）。
 *      这条守的是「两个独立维度不许互相开关」。
 *   B. **hidden=1 与冷门剔除互斥时的让位**
 *      池前剔除冷门（删光 isHidden）+ 「只看最终隐藏」（只留 isHidden）= 必然 0 条。
 *      让位只许在 admin 视图内，否则「加个 hidden 参数就绕开冷门隐藏」。
 *   C. **后台「🌙 显示冷门」不再是死控件**
 *      改前两个分支都发 cold=0；toggleCold 也不 reload，toast 还谎称「仅切换高亮」。
 *   D. **前端列表内搜索框**（后端 v10.90 就支持 `q`，前端从没发过 = 死参数）
 *      实测「输入 → 列表变少 → 清空 → 恢复」，不只看 DOM 里有没有那个输入框。
 *
 * ⚠️ 不写死任何总数：库每天都在变（daily-sync）。只比「加了筛选之后 vs 之前」的**关系**。
 */
const path = require('path');
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const BASE = process.env.BASE || 'http://127.0.0.1:8123';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nativeFetch = globalThis.fetch;

let pass = 0; let fail = 0;
const ok = (name, cond, ev) => {
  if (cond) { pass++; console.log('  ✅ ' + name + (ev ? '   [' + ev + ']' : '')); }
  else { fail++; console.log('  ❌ ' + name + (ev ? '   [' + ev + ']' : '')); }
};
const num = (x) => (typeof x === 'number' ? x.toLocaleString() : String(x));

const getJson = async (p) => {
  try { return await fetch(BASE + p).then((r) => r.json()); } catch (e) { return { ok: false, error: String(e) }; }
};
const total = async (p) => { const j = await getJson(p); return j && j.ok ? j.total : null; };

(async () => {
  const srv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const adm = fs.readFileSync(path.join(ROOT, 'public', 'admin.html'), 'utf8');
  const idx = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  /* 数源码出现次数的断言一律剥注释（铁律 201：注释会咬计数） */
  const srvCode = srv.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  /* ================= A. 后端解耦 ================= */
  console.log('\n=== A · 冷门剔除 与 hidden/asrc/note 解耦 ===');
  ok('A1 ★ 管理侧条件块不再被 `!o.excludeCold` 掐断',
    /if \(isAdminView\) \{\n?\s*\/\* v10\.88/.test(srvCode) || /\n  if \(isAdminView\) \{/.test(srvCode),
    '来自 server.js');
  ok('A2 旧的 `isAdminView && !o.excludeCold` 已不存在（否则三筛选仍会被静默吞掉）',
    !/isAdminView && !o\.excludeCold/.test(srvCode));
  ok('A3 冷门剔除只有两个入口（cold 参数 / hidden=1 让位）',
    (srvCode.match(/o\.excludeCold\s*=/g) || []).length === 2);
  ok('A4 ★ hidden=1 的让位带 isAdminView 守卫（不许加个参数就绕开冷门隐藏）', (() => {
    const line = srvCode.split(/\r?\n/).find((l) => l.includes('o.excludeCold = false')) || '';
    return /isAdminView/.test(line);
  })());

  console.log('\n-- A · HTTP 实测：三个筛要在 cold=1 下依然生效 --');
  const base1 = await total('/api/library/browse?scope=pc&limit=1&admin=1&cold=1');
  const base0 = await total('/api/library/browse?scope=pc&limit=1&admin=1&cold=0');
  ok('A5 前提：cold=0 与 cold=1 的总数确实不同（否则后面几条无法证伪）',
    base0 != null && base1 != null && base0 !== base1, `${num(base0)} vs ${num(base1)}`);

  const jidi1 = await total('/api/library/browse?scope=pc&limit=1&admin=1&cold=1&asrc=jidi');
  const xd1 = await total('/api/library/browse?scope=pc&limit=1&admin=1&cold=1&asrc=xd');
  ok('A6 ★ 来源筛选在 cold=1 下生效（不再等于全量）',
    jidi1 != null && jidi1 !== base1, `jidi ${num(jidi1)} vs 全量 ${num(base1)}`);
  ok('A7 ★ 两个来源之和 = 剔除冷门后的总数（自洽，不是各筛各的）',
    jidi1 != null && xd1 != null && jidi1 + xd1 === base1, `${num(jidi1)} + ${num(xd1)} = ${num(jidi1 + xd1)}`);
  const hid1 = await total('/api/library/browse?scope=pc&limit=1&admin=1&cold=1&hidden=1');
  const hid0 = await total('/api/library/browse?scope=pc&limit=1&admin=1&cold=0&hidden=1');
  ok('A8 ★ hidden=1 让位生效：cold=1 与 cold=0 给出同一批「隐藏行」',
    hid1 != null && hid1 === hid0, `${num(hid1)} vs ${num(hid0)}`);
  const hidV = await total('/api/library/browse?scope=pc&limit=1&admin=1&cold=1&hidden=0');
  ok('A9 隐藏行 + 可见行 = 全量（口径互斥且完备）',
    hid1 != null && hidV != null && hid1 + hidV === base0, `${num(hid1)} + ${num(hidV)} = ${num(hid1 + hidV)}`);

  /* ================= B. 后台冷门开关 ================= */
  console.log('\n=== B · 后台「🌙 显示冷门」不再是死控件 ===');
  ok('B1 ★ qs() 按 showCold 真发两种值（改前两分支都是 cold=0）',
    /p\.set\('cold', showCold \? '0' : '1'\)/.test(adm));
  ok('B2 不再有两个分支写一样的死代码',
    !/if \(!showCold\) p\.set\('cold', '0'\); else p\.set\('cold', '0'\)/.test(adm));
  ok('B3 ★ toggleCold 会重取数据（改前连 reload 都没有，只切自己的 class）', (() => {
    const m = adm.match(/function toggleCold\(\)\s*\{([\s\S]*?)\n\}/);
    const body = m ? m[1] : '';
    return /offset = 0/.test(body) && /reload\(\)/.test(body);
  })());
  ok('B4 toggleCold 的 toast 不再谎称「仅切换高亮」（代码里没有高亮逻辑）', (() => {
    /* 剥注释再判：本版在 admin.html 里留了「改前谎称仅切换高亮」的解释性注释，
       不剥会把正当注释判成犯规（铁律 201）。 */
    const code = adm.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    return !/仅切换高亮/.test(code);
  })());

  /* ================= C. 前端列表内搜索（jsdom 实测） ================= */
  console.log('\n=== C · 前端列表内搜索（真输入 → 列表真变） ===');
  ok('C1 静态：输入行在 `.cat-panel` 内，且与分类行并列（不是另起一块面板）',
    /<div class="cat-panel">[\s\S]{0,400}id="libQ"/.test(idx));
  ok('C2 静态：请求串带上 `q`（后端 v10.90 就支持，前端此前从不发）',
    /\+\s*\(curQ \? '&q=' \+ encodeURIComponent\(curQ\) : ''\)/.test(idx));

  const html = await fetch(BASE + '/index.html').then((r) => r.text());
  const vc = new VirtualConsole();
  const errs = [];
  vc.on('jsdomError', (e) => {
    const m = String((e && e.message) || e);
    if (!/Could not load/.test(m)) errs.push(m.slice(0, 160));
  });
  const dom = new JSDOM(html, {
    url: BASE + '/index.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      const raw = w.fetch;
      w.fetch = function (u, o) {
        const real = raw || nativeFetch;
        const s = String(u);
        return real.call(w, s.startsWith('http') ? s : BASE + s, o);
      };
      w.scrollTo = () => {};
      w.Element.prototype.scrollIntoView = function () {};
      w.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
    },
  });
  const W = dom.window;
  const q = (s) => W.document.querySelector(s);
  const waitUntil = async (fn, ms = 20000) => {
    const t0 = Date.now();
    for (;;) {
      if (fn()) return Date.now() - t0;
      if (Date.now() - t0 >= ms) return -1;
      await sleep(120);
    }
  };
  /* data-ready 挂在 documentElement 上（不是 body）—— 五张页面 init() 末尾统一设的那处 */
  const readyMs = await waitUntil(() => W.document.documentElement.getAttribute('data-ready') === '1');
  ok('C3 首页 init 完成（data-ready 信号，不靠猜时间）', readyMs >= 0, `${readyMs}ms`);
  const inputReady = await waitUntil(() => !!q('#libQ') && q('#libList'));
  ok('C4 搜索输入框与列表都已就绪', inputReady >= 0, `${inputReady}ms`);
  ok('C5 首页运行无 JS 异常', errs.length === 0, errs[0] || '');

  const countText = () => {
    const c = q('#listCount');
    const m = c ? String(c.textContent).match(/[\d,]+/) : null;
    return m ? Number(m[0].replace(/,/g, '')) : -1;
  };
  const before = countText();
  ok('C6 初始列表有数（否则下面「变少」无法证伪）', before > 0, `共 ${num(before)} 款`);

  const qEl = q('#libQ');
  const fire = (v) => {
    qEl.value = v;
    qEl.dispatchEvent(new W.Event('input', { bubbles: true }));
  };
  /* 用一个几乎不可能空手而归、又必然大幅收窄的词：中文两字，最小长度护栏按 CJK 算（见
     cross-source-name-matching 的口径：2 字中文名不能一刀切判太短）。 */
  fire('赛博朋克');
  const afterMs = await waitUntil(() => countText() !== before && countText() >= 0, 20000);
  const after = countText();
  ok('C7 ★ 输入关键词后列表真的收窄（不是只画了个输入框）',
    afterMs >= 0 && after > 0 && after < before, `${num(before)} → ${num(after)}（${afterMs}ms）`);
  const title = q('#listTitle') ? String(q('#listTitle').textContent) : '';
  ok('C8 标题进入搜索态（用户一眼知道自己在看什么）', /搜索「赛博朋克」/.test(title), title);
  ok('C9 出现「清空」出口（不把用户困在搜索里）',
    q('#libQClear') && q('#libQClear').hidden === false);

  /* 清空 → 恢复 */
  q('#libQClear').dispatchEvent(new W.MouseEvent('click', { bubbles: true, cancelable: true }));
  const backMs = await waitUntil(() => countText() === before, 20000);
  ok('C10 ★ 清空后恢复原数量（搜索不是单向门）', backMs >= 0, `${num(after)} → ${num(before)}`);

  /* 搜不到 → 必须给搜索态空文案，而不是「当前筛选下暂无收录」 */
  fire('zzzz不存在的游戏zzzz');
  const noneMs = await waitUntil(() => {
    const e = q('#libList .empty');
    return e && /没有找到/.test(String(e.textContent));
  }, 20000);
  const emptyTxt = q('#libList .empty') ? String(q('#libList .empty').textContent).replace(/\s+/g, ' ') : '';
  ok('C11 ★ 搜不到时是搜索态文案（不拿「暂无收录」糊弄）', noneMs >= 0, emptyTxt.slice(0, 40));
  ok('C12 空态里点出用户搜的词（知道自己搜了什么）', /zzzz不存在的游戏zzzz/.test(emptyTxt));

  /* ---- D. 搜索与其它筛选叠加，不是互相覆盖 ---- */
  console.log('\n=== D · 搜索与分类/开关叠加 ===');
  /* ★ 这里踩过一次：`renderList` 是「先改标题、再 fetch、最后写计数」，
     所以「标题已变成搜索态」不代表数字已经是新值。上一版我拿标题当完成信号，
     结果读到的是上一条空搜索留下的 0（63 条的「侠」被记成 0）。
     改成「等计数真的离开旧值」——离开的那一刻才是新结果落地的时刻。 */
  const prevCount = countText();
  fire('侠');
  const qOnlyMs = await waitUntil(() => countText() !== prevCount && countText() > 0, 20000);
  const qOnly = countText();
  ok('D0 单独搜「侠」拿到非零结果（叠加实验的前提）', qOnlyMs >= 0 && qOnly > 0, `共 ${num(qOnly)} 款（${qOnlyMs}ms）`);
  const catBtn = [...W.document.querySelectorAll('#catRow .cat')].find((b) => b.dataset.c !== '全部');
  if (catBtn) {
    catBtn.dispatchEvent(new W.MouseEvent('click', { bubbles: true, cancelable: true }));
    await waitUntil(() => countText() !== qOnly, 20000);
  }
  const qPlusCat = countText();
  ok('D1 ★ 搜索 + 分类是叠加（点分类后数量再收窄或持平，且不是回到全量）',
    !!catBtn && qPlusCat >= 0 && qPlusCat <= qOnly && qPlusCat !== before,
    `仅搜索 ${num(qOnly)} → 加分类「${catBtn ? catBtn.dataset.c : '—'}」 ${num(qPlusCat)}`);
  ok('D2 叠加后搜索词仍在（分类切换没把 q 冲掉）',
    /搜索「侠」/.test(String((q('#listTitle') || {}).textContent || '')),
    String((q('#listTitle') || {}).textContent || ''));

  dom.window.close();

  console.log('\n' + '='.repeat(46));
  console.log(`  通过 ${pass}/${pass + fail}（失败 ${fail}）`);
  console.log('='.repeat(46));
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('套件异常：', e && e.stack || e);
  process.exit(2);
});
