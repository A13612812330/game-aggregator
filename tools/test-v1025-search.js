/* ★ v10.25 浏览器回归（第二层：真实浏览器 + CDP，手动分批跑）：① 搜索弹窗「同款聚拢 + 评分分级」。
 *
 * ★★ v10.62 修订：同款聚拢**仍然做**，但主行下方那排「↳ 另 N 个条目」chip **已按用户要求删除**
 *   （用户 2026-10-12 原话「每个游戏仅需要提供一个即可」）。A / B / D 三条随之换口径：
 *     旧：`行数 + chip 数 == 接口条数`（靠 chip 兜住「数据一条没丢」）
 *     新：**行数 == 接口回包里不同归并键（nkey）的个数**（款数守恒，期望值直接问接口要）
 *   —— 换完**更硬**了：期望值不再是我手写的 `3`，库怎么变都不会失真。
 *
 * 守护的不变量：
 *   A. 同一款游戏在结果里**只占一行**；面板里 `.sm-alt` / `.sm-alt-b` **一个都不许有**
 *   B. 款数守恒：行数 == 接口回包里不同 `nkey` 的个数（归并只改展示，不删数据）
 *   C. 「艾尔登法环」与「艾尔登法环 黑夜君临」**不能并**（那是两款游戏）—— 子串匹配的反例
 *   D. 主行点得动（进详情抽屉）；行上资源 chip 的数字与接口**逐档对齐**
 *   E. 无横向溢出
 *
 * 反证锚点（打坏必变红）：
 *   · 把 `smRows` 的 `smGroup(arr).map(...)` 换回 `arr.map(smRow)` → A / B / C 全红（款数不再守恒）
 *   · 把 `smAltHtml` 加回来渲染 → A 红（`.sm-alt` 不再是 0）
 */
const path = require('path');
const fs = require('fs');
const { connectBrowser, newPage, sleep } = require('./browser');

const BASE = process.env.BASE || 'http://127.0.0.1:8123';
const OUT = path.join(__dirname, '..', '_preview');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

let pass = 0; let fail = 0;
/* ★ 签名固定 (name, ok, extra) —— 别把条件写进第 1 个位置，
 *   否则 ok 收到非空字符串会恒为真、整轮假绿（PITFALLS 15）。 */
function chk(name, ok, extra) {
  if (ok) { pass++; console.log('  \u2705 ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.log('  \u274c ' + name + (extra ? '   ' + extra : '')); }
}
const j = (o) => JSON.stringify(o);

(async () => {
  const h = await connectBrowser();
  const p = await newPage(h.browser, { width: 1440, height: 1000 });
  p.on('pageerror', (e) => console.log('  \u26a0\ufe0f pageerror: ' + e.message));

  await p.goto(BASE + '/index.html', { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1600);
  await p.evaluate(() => document.getElementById('searchOpen').click());
  await sleep(500);
  await p.evaluate(() => {
    const i = document.getElementById('searchInput');
    i.value = '艾尔登';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(2600);

  /* ---------------- Phase A：联想态（SUGGEST） ---------------- */
  const a = await p.evaluate(async () => {
    /* ★★ v10.62：期望**款数**不再写死 —— 直接问接口「回包里不同 `nkey` 有几个」。
       limit 必须与联想面板一致（`showSug` 拉的是 `/api/library?q=…&limit=8`）。 */
    const lr = await fetch('/api/library?q=' + encodeURIComponent('艾尔登') + '&limit=8').then((r) => r.json());
    const lItems = lr.items || [];
    const expectRows = new Set(lItems.map((x) => x.nkey).filter(Boolean)).size;
    const b = document.getElementById('smBody');
    const rows = [...b.querySelectorAll('.sm-row')];
    const alts = [...b.querySelectorAll('.sm-alt')];
    const chips = [...b.querySelectorAll('.sm-alt-b')];
    const rect = (e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
    return {
      rowTitles: rows.map((r) => (r.querySelector('.t') || {}).textContent.trim()),
      rowCount: rows.length,
      expectRows,
      apiTotal: lItems.length,
      altCount: alts.length,
      chipCount: chips.length,
      chipTexts: chips.map((c) => c.textContent.replace(/\s+/g, ' ').trim()),
      altRect: alts[0] ? rect(alts[0]) : null,
      rowRect: rows[0] ? rect(rows[0]) : null,
      secCnt: (b.querySelector('.sm-sec .cnt') || {}).textContent || '',
      scoreCls: rows.map((r) => { const s = r.querySelector('.pill.score'); return s ? s.className : ''; }),
      overflowX: b.scrollWidth - b.clientWidth,
      modalRect: rect(document.getElementById('smodal')),
    };
  });
  await p.screenshot({ path: path.join(OUT, 'check-search-suggest.png') });

  console.log('\n=== Phase A · 联想态（搜「艾尔登」）===');
  console.log('  实测行: ' + j(a.rowTitles));
  console.log('  实测 chip: ' + j(a.chipTexts));
  console.log('  计数: ' + j(a.secCnt) + '  弹窗: ' + j(a.modalRect));

  chk('A 同一款只占一行（行数 == 接口款数，期望值不写死）',
    a.rowCount === a.expectRows, 'rowCount=' + a.rowCount + ' expect=' + a.expectRows);
  /* ★ v10.62：守恒口径从「行数 + chip 数 == 条数」换成「行数 == 款数」。
   *   旧口径靠 chip 兜住「数据没丢」，chip 一删就恒不成立；新口径直接与接口对齐，更硬。 */
  chk('B 款数守恒 + 确有聚拢（条数 > 款数）',
    a.rowCount === a.expectRows && a.rowCount < a.apiTotal,
    a.apiTotal + ' 条 → ' + a.rowCount + ' 款');
  chk('A ★★ v10.62 同款聚拢后**只出一行**：`.sm-alt` / `.sm-alt-b` 必须都为 0',
    a.altCount === 0 && a.chipCount === 0 && a.altRect === null,
    'alt=' + a.altCount + ' chip=' + a.chipCount + ' rect=' + j(a.altRect));
  chk('C 「艾尔登法环」在主行里只出现 1 次',
    a.rowTitles.filter((t) => t === '艾尔登法环').length === 1,
    j(a.rowTitles.filter((t) => /艾尔登法环/.test(t))));
  chk('C 「黑夜君临」独立成行（没被并进法环）',
    a.rowTitles.some((t) => t.indexOf('黑夜君临') >= 0), j(a.rowTitles));
  chk('C 「艾尔登炮火」独立成行（子串匹配的反例）',
    a.rowTitles.some((t) => t === '艾尔登炮火'), j(a.rowTitles));
  chk('D 主行真占版面（宽>200 且 高>0）',
    !!a.rowRect && a.rowRect.w > 200 && a.rowRect.h > 0, j(a.rowRect));
  chk('A ★ v10.62 chip 文案已彻底不渲染（这两个变体名只曾出现在 chip 上）',
    a.chipTexts.length === 0, j(a.chipTexts));
  chk('计数显示款数 + 合并说明（用接口值自洽推导）',
    a.secCnt.indexOf(a.expectRows + ' 款') >= 0 && a.secCnt.indexOf('合并 ' + a.apiTotal + ' 条') >= 0,
    j(a.secCnt));
  chk('评分分级生效（★9.3 拿到 s-hi）',
    a.scoreCls.some((c) => c.indexOf('s-hi') >= 0), j(a.scoreCls));
  chk('低分退到 s-lo（★5 那条）',
    a.scoreCls.some((c) => c.indexOf('s-lo') >= 0), j(a.scoreCls));
  chk('E 弹窗正文无横向溢出', a.overflowX <= 0, 'overflowX=' + a.overflowX);

  /* ---------------- Phase B：主行点得动（v10.62 起面板里只剩主行可点） ----------------
   * 原先这里点的是「另 N 个条目」chip，chip 删了 ⇒ 改点主行。
   * ⚠️ 别把这条也删掉：`.sm-row` 的点击绑定与 `.res-chip` 的 `stopPropagation`
   *    是**互相牵制**的（v10.52 起），只测 chip 会漏掉「主行点不动」这种坏法。 */
  const firstRow = await p.evaluate(() => {
    const r = document.querySelector('#smBody .sm-row');
    return r ? ((r.querySelector('.t') || {}).textContent || '').trim() : '';
  });
  await p.evaluate(() => { const r = document.querySelector('#smBody .sm-row'); if (r) r.click(); });
  await sleep(3000);
  const bst = await p.evaluate(() => ({
    drawerShown: document.getElementById('drawer').classList.contains('show'),
    title: ((document.querySelector('#drawerBody h2') || {}).textContent || '').trim(),
  }));
  console.log('\n=== Phase B · 点第一行「' + firstRow + '」===');
  console.log('  抽屉: ' + j(bst));
  chk('D 主行点击打开详情抽屉', bst.drawerShown === true, j(bst));
  chk('D 抽屉标题就是这一行的标题',
    !!firstRow && bst.title.indexOf(firstRow.slice(0, 4)) >= 0,
    'row=' + j(firstRow) + ' drawer=' + j(bst.title));

  /* ---------------- Phase C：回车走 /api/search/all 那条路 ---------------- */
  await p.evaluate(() => {
    document.getElementById('searchOpen').click();
    const i = document.getElementById('searchInput');
    i.value = '艾尔登';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(400);
  await p.evaluate(() => {
    const i = document.getElementById('searchInput');
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await sleep(3000);
  const cst = await p.evaluate(async () => {
    /* ★ v10.62：端游库组的期望款数也**问接口要**（`doSearch` 拉的是 `&limit=12`）。 */
    const ar = await fetch('/api/search/all?q=' + encodeURIComponent('艾尔登') + '&limit=12').then((r) => r.json());
    const pcItems = ((ar.pc || {}).items) || [];
    const pcExpect = new Set(pcItems.map((x) => x.nkey).filter(Boolean)).size;
    const b = document.getElementById('smBody');
    const secs = [...b.querySelectorAll('.sm-sec')];
    /* ★ 必须**按分组**收集 —— 全文 querySelectorAll('.sm-row') 会把手游/修改器/云存档的行
     *   也捞进来，那些组本来就不该聚合（「同一款有 4 个修改器来源」是信息不是重复）。 */
    const grab = (kw) => {
      const h = secs.find((s) => s.textContent.indexOf(kw) >= 0);
      const rows = []; const chips = [];
      let n = h ? h.nextElementSibling : null;
      while (n && !n.classList.contains('sm-sec')) {
        if (n.classList.contains('sm-row')) rows.push((n.querySelector('.t') || {}).textContent.trim());
        if (n.classList.contains('sm-alt')) chips.push(...n.querySelectorAll('.sm-alt-b'));
        n = n.nextElementSibling;
      }
      return { rows, chips: chips.length };
    };
    return {
      secs: secs.map((s) => s.textContent.replace(/\s+/g, ' ').trim()),
      pc: Object.assign(grab('端游库'), { expectRows: pcExpect, apiRows: pcItems.length }),
      tr: grab('修改器'),
      overflowX: b.scrollWidth - b.clientWidth,
    };
  });
  await p.screenshot({ path: path.join(OUT, 'check-search-all.png') });
  console.log('\n=== Phase C · 回车全站搜（四库分组）===');
  console.log('  分组: ' + j(cst.secs));
  console.log('  端游库组: ' + j(cst.pc.rows) + '  chip=' + cst.pc.chips);
  console.log('  修改器组: ' + j(cst.tr.rows) + '  chip=' + cst.tr.chips);
  chk('C 端游库组「艾尔登法环」只占 1 行',
    cst.pc.rows.filter((t) => t === '艾尔登法环').length === 1, j(cst.pc.rows));
  chk('B ★ v10.62 端游库组一款一行（行数 == 接口款数，chip 恒 0）',
    cst.pc.rows.length === cst.pc.expectRows && cst.pc.chips === 0,
    'rows=' + cst.pc.rows.length + ' expect=' + cst.pc.expectRows
    + ' api=' + cst.pc.apiRows + ' chips=' + cst.pc.chips);
  chk('C 端游库组「黑夜君临」/「炮火」各自成行',
    cst.pc.rows.some((t) => t.indexOf('黑夜君临') >= 0) && cst.pc.rows.some((t) => t === '艾尔登炮火'),
    j(cst.pc.rows));
  /* ★ 反向护栏：修改器组**不能**聚合 —— 同一款游戏的 4 个修改器来源
   *   （社区贡献/风灵月影/小幸/CE 表）是用户要找的信息，并掉就等于把「有几个修改器」藏了。 */
  chk('C 修改器组**不**聚合（同款仍多行，每行一个来源）',
    cst.tr.rows.filter((t) => t.indexOf('艾尔登法环') >= 0).length >= 3 && cst.tr.chips === 0,
    '法环行数=' + cst.tr.rows.filter((t) => t.indexOf('艾尔登法环') >= 0).length + ' chips=' + cst.tr.chips);
  chk('C 四库分组仍在（4 个头）', cst.secs.length === 4, 'secs=' + cst.secs.length);
  chk('E 全站搜无横向溢出', cst.overflowX <= 0, 'overflowX=' + cst.overflowX);

  /* ---------------- Phase D：资源计数 chip（★ v10.52） ----------------
   * 守护：
   *   ① 搜「赛博朋克2077」时，端游行上出现「717 MOD / 104 存档 / 22 修改器」这类 chip
   *      —— 数字**与接口逐档对齐**（不写死条数，随库变化仍然对）
   *   ② 点 chip → 关搜索 + 开抽屉 + **同时**开下载弹窗，且落在对应页签
   *      （只开抽屉 = 没落到页签，这条会红）
   *   ③ 页签对了还必须**真渲染出条目** —— 「页签切换成功但列表空」是另一种坏法
   *
   * 反证锚点（打坏必变红）：
   *   · 把 `withRes` 换回 `withBh` ⇒ ① 全红（页面一个 chip 都没有）
   *   · 把 `openResTab` 里的 `openUniDownload(...)` 删掉 ⇒ ② 红（只开抽屉）
   *   · 把 `data-res-id` 换回 `it.id`（显示条目而非归属条目）⇒ ③ 红（mod 列表查空） */
  const resApi = await p.evaluate(async () => {
    const r = await fetch('/api/search/all?q=' + encodeURIComponent('赛博朋克2077') + '&limit=5');
    const j = await r.json();
    const it = (j.pc.items || []).find((x) => x.res) || {};
    return { id: it.id || '', resId: it.resId || '', res: it.res || null };
  });
  await p.evaluate(() => {
    const i = document.getElementById('searchInput');
    i.value = '赛博朋克2077';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(2600);
  const d1 = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('#smBody .sm-row')];
    const withChips = rows.filter((r) => r.querySelector('.res-chip'));
    const chips = withChips.length ? [...withChips[0].querySelectorAll('.res-chip')] : [];
    const rr = chips[0] ? chips[0].getBoundingClientRect() : null;
    return {
      rows: rows.length,
      rowsWithChips: withChips.length,
      texts: chips.map((c) => c.textContent.replace(/\s+/g, ' ').trim()),
      tabs: chips.map((c) => c.dataset.resTab),
      ids: chips.map((c) => c.dataset.resId),
      rect: rr ? { w: Math.round(rr.width), h: Math.round(rr.height) } : null,
      overflowX: document.getElementById('smBody').scrollWidth - document.getElementById('smBody').clientWidth,
    };
  });
  await p.screenshot({ path: path.join(OUT, 'check-search-res-chips.png') });
  console.log('\n=== Phase D · 资源计数 chip（搜「赛博朋克2077」）===');
  console.log('  接口: res=' + j(resApi.res) + '  resId=' + resApi.resId);
  console.log('  rows=' + d1.rows + '  带 chip 行=' + d1.rowsWithChips + '  chip=' + j(d1.texts) + '  tabs=' + j(d1.tabs));

  chk('D ★ v10.52 正向锚点：接口真有 res 计数（拿不到时下面的对齐断言会平白变绿）',
    !!resApi.res && Number(resApi.res.mod) > 0, j(resApi.res));
  chk('D ★★ v10.52 搜索行上出现了资源 chip', d1.rowsWithChips > 0 && d1.texts.length > 0,
    'rows=' + d1.rows + ' 带chip=' + d1.rowsWithChips);
  chk('D ★★ v10.52 chip 数字与接口**逐档对齐**（不写死条数，随库变化仍然对）',
    d1.texts.some((t) => t.indexOf(String(resApi.res.mod) + ' MOD') >= 0)
    && d1.texts.some((t) => t.indexOf(String(resApi.res.saves) + ' 存档') >= 0)
    && d1.texts.some((t) => t.indexOf(String(resApi.res.trainers) + ' 修改器') >= 0),
    '接口=' + j(resApi.res) + ' 页面=' + j(d1.texts));
  chk('D ★ v10.52 chip 到的页签只在 `mod` / `modifier` / `save` 三档内（没有第四个）',
    d1.tabs.length > 0 && d1.tabs.every((t) => ['mod', 'modifier', 'save'].indexOf(t) >= 0), j(d1.tabs));
  chk('D ★★ v10.52 chip 带的是**归属条目** id（`resId`，不是显示条目 id）—— 否则弹窗按 id 查空',
    d1.ids.length > 0 && d1.ids.every((x) => x === resApi.resId) && resApi.resId !== resApi.id,
    'chip.id=' + j(d1.ids) + ' 归属=' + resApi.resId + ' 显示=' + resApi.id);
  chk('D chip 真占版面（宽>50 且 高>0）', !!d1.rect && d1.rect.w > 50 && d1.rect.h > 0, j(d1.rect));
  chk('E 资源 chip 不引起横向溢出', d1.overflowX <= 0, 'overflowX=' + d1.overflowX);

  /* 点「N MOD」chip → 关搜索 + 开抽屉 + 开下载弹窗 + 落在 mod 页签 + 真拉到列表 */
  await p.evaluate(() => {
    const c = document.querySelector('#smBody .res-chip.mod');
    if (c) c.click();
  });
  await sleep(3200);
  const d2 = await p.evaluate(() => {
    const dr = document.getElementById('drawer');
    const pop = document.getElementById('dlPop');
    /* ⚠️ `dlUni` 是主源顶层的 `let`（**全局词法绑定，不挂 window**）——
     *   写 `window.dlUni` 恒 undefined ⇒ tab 读成 null ⇒ 断言假红（铁律 51）。
     *   裸写可达，但要包 try/catch 兜 TDZ。 */
    let tab = null;
    try { tab = dlUni ? dlUni.tab : null; } catch (e) { tab = null; }
    return {
      drawerShown: !!dr && dr.classList.contains('show'),
      popShown: !!pop && !pop.hidden,
      tab,
      modRows: document.querySelectorAll('#dlBody .d-dl-it').length,
      searchClosed: !document.getElementById('smodal').classList.contains('show'),
    };
  });
  await p.screenshot({ path: path.join(OUT, 'check-search-res-goto.png') });
  console.log('\n=== Phase D2 · 点「N MOD」chip ===');
  console.log('  ' + j(d2));

  chk('D ★ v10.52 点 chip 先关掉搜索弹窗（不关会叠三层）', d2.searchClosed === true, j(d2));
  chk('D ★ v10.52 点 chip 打开详情抽屉', d2.drawerShown === true, j(d2));
  chk('D ★★ v10.52 点 chip **同时**打开下载弹窗（只开抽屉 = 没落到页签 ⇒ 这条红）',
    d2.popShown === true, j(d2));
  chk('D ★★ v10.52 弹窗落在 `mod` 页签（不是默认的 body）', d2.tab === 'mod', 'tab=' + d2.tab);
  chk('D ★★ v10.52 mod 页签**真渲染出条目**（页签对了但列表空 = resId 没传对）',
    d2.modRows > 0, 'modRows=' + d2.modRows);

  console.log('\n\u2500\u2500 ① 搜索弹窗：' + pass + ' 通过 / ' + fail + ' 失败 \u2500\u2500');
  await h.browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
