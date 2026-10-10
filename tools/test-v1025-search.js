/* ★ v10.25 浏览器回归（第二层：真实浏览器 + CDP，手动分批跑）：① 搜索弹窗「同款聚拢 + 评分分级」。
 *
 * 守护的不变量：
 *   A. 同一款游戏在结果里**只占一行**（主行），其余条目降级为 chip —— 不丢可点性
 *   B. 条目**总数守恒**：行数 + chip 数 == 接口返回条数（归并只改展示，不删数据）
 *   C. 「艾尔登法环」与「艾尔登法环 黑夜君临」**不能并**（那是两款游戏）—— 子串匹配的反例
 *   D. chip 真占版面（宽高 > 0）且点得动（进详情抽屉）
 *   E. 无横向溢出
 *
 * 反证锚点（打坏必变红）：
 *   把 index.html 里 `smRows(list, limit)` 的 `smGroup(arr).map(...)` 换回 `arr.map(smRow)`
 *   → A / B / C / D 全红。
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
  const a = await p.evaluate(() => {
    const b = document.getElementById('smBody');
    const rows = [...b.querySelectorAll('.sm-row')];
    const alts = [...b.querySelectorAll('.sm-alt')];
    const chips = [...b.querySelectorAll('.sm-alt-b')];
    const rect = (e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
    return {
      rowTitles: rows.map((r) => (r.querySelector('.t') || {}).textContent.trim()),
      rowCount: rows.length,
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

  chk('A 同一款只占一行：行数 3（原 6 条）', a.rowCount === 3, 'rowCount=' + a.rowCount);
  /* ★ 守恒断言必须**连 chip>0 一起判** —— 只比「行数+chip数 == 6」的话，
   *   打坏成平铺时是「6 行 + 0 chip」，总数照样等于 6，断言**假绿**（反证实测到了）。
   *   守恒测「不丢数据」，chip>0 测「确实聚拢了」，两件事要一起断言。 */
  chk('B 条目守恒 + 确有聚拢', a.rowCount + a.chipCount === 6 && a.chipCount > 0,
    a.rowCount + '+' + a.chipCount);
  chk('B 有 2 组挂了「另 N 个条目」', a.altCount === 2, 'altCount=' + a.altCount);
  chk('C 「艾尔登法环」在主行里只出现 1 次',
    a.rowTitles.filter((t) => t === '艾尔登法环').length === 1,
    j(a.rowTitles.filter((t) => /艾尔登法环/.test(t))));
  chk('C 「黑夜君临」独立成行（没被并进法环）',
    a.rowTitles.some((t) => t.indexOf('黑夜君临') >= 0), j(a.rowTitles));
  chk('C 「艾尔登炮火」独立成行（子串匹配的反例）',
    a.rowTitles.some((t) => t === '艾尔登炮火'), j(a.rowTitles));
  chk('D chip 真占版面（宽>100 且 高>0）',
    !!a.altRect && a.altRect.w > 100 && a.altRect.h > 0, j(a.altRect));
  chk('D chip 文案区分出变体（有「支持网络联机」也有「原版」）',
    a.chipTexts.some((t) => t.indexOf('支持网络联机') >= 0) && a.chipTexts.some((t) => t.indexOf('原版') >= 0),
    j(a.chipTexts));
  chk('计数显示款数 + 合并说明（3 款 · 合并 6 条）',
    a.secCnt.indexOf('3 款') >= 0 && a.secCnt.indexOf('合并 6 条') >= 0, j(a.secCnt));
  chk('评分分级生效（★9.3 拿到 s-hi）',
    a.scoreCls.some((c) => c.indexOf('s-hi') >= 0), j(a.scoreCls));
  chk('低分退到 s-lo（★5 那条）',
    a.scoreCls.some((c) => c.indexOf('s-lo') >= 0), j(a.scoreCls));
  chk('E 弹窗正文无横向溢出', a.overflowX <= 0, 'overflowX=' + a.overflowX);

  /* ---------------- Phase B：chip 点得动 ---------------- */
  const firstChip = await p.evaluate(() => {
    const c = document.querySelector('#smBody .sm-alt-b');
    return c ? c.textContent.replace(/\s+/g, ' ').trim() : '';
  });
  await p.evaluate(() => { const c = document.querySelector('#smBody .sm-alt-b'); if (c) c.click(); });
  await sleep(3000);
  const bst = await p.evaluate(() => ({
    drawerShown: document.getElementById('drawer').classList.contains('show'),
    title: ((document.querySelector('#drawerBody h2') || {}).textContent || '').trim(),
    badge: ((document.querySelector('#drawerBody .src-badge') || {}).textContent || '').trim(),
  }));
  console.log('\n=== Phase B · 点第一个 chip「' + firstChip + '」===');
  console.log('  抽屉: ' + j(bst));
  chk('D chip 点击打开详情抽屉', bst.drawerShown === true, j(bst));
  chk('D 抽屉标题是同一款游戏（艾尔登法环）',
    bst.title.indexOf('艾尔登法环') >= 0, j(bst.title));
  chk('D 抽屉走的是 chip 指向的那个源（XDGAME）',
    bst.badge.indexOf('XDGAME') >= 0, j(bst.badge));

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
  const cst = await p.evaluate(() => {
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
      pc: grab('端游库'),
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
  chk('B 条目守恒 + 确有聚拢',
    cst.pc.rows.length + cst.pc.chips === 6 && cst.pc.chips > 0,
    cst.pc.rows.length + '+' + cst.pc.chips);
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
