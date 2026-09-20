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

  console.log('\n\u2500\u2500 ① 搜索弹窗：' + pass + ' 通过 / ' + fail + ' 失败 \u2500\u2500');
  await h.browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
