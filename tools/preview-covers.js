/* tools/preview-covers.js — 热榜/列表「游戏图片」实拍 + 断言
 *
 * 用户原话：「前端可见的游戏图片需要你进行获取图片」——
 * 截图里全站热榜第 2 / 5 / 8 名的卡片是**空的色块**，没有封面。
 *
 * 静态断言只能证明「数据里有 cover 字段」，证不了「图片在浏览器里真的加载出来了」。
 * 所以这里用真浏览器，判据是 ★ `img.naturalWidth > 0`
 *   —— 元素存在 ≠ 图片加载成功：404 / 防盗链 / 空 src 的 <img> 一样占版面、
 *      一样有 getBoundingClientRect、一样能点到，但 naturalWidth 恒为 0。
 *
 * 覆盖两条不同的图片代码路径：
 *   ① 周榜 / 月榜 —— 源站给的是 cdn.queniuqe.com 的 community_assets 绝对 URL
 *   ② 全站榜     —— 源站给的是 /uploads/allimg/...-L.png **站内相对路径**
 *      （相对路径没补全的话这里就会整片裂开，而 ① 却完全正常）
 *
 * 运行：node tools/preview-covers.js   （需服务已在 8123 运行）
 * 产出：_preview/v1023-C-热榜封面.png
 * 退出码：0 = 全绿
 */
const fs = require('fs');
const path = require('path');
const { connectBrowser, newPage } = require('./browser');

const BASE = process.env.EMU_BASE || 'http://127.0.0.1:8123';
const OUT = path.join(__dirname, '..', '_preview');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function chk(name, ok, extra) {
  (ok ? pass++ : fail++);
  console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`);
}

/**
 * 读取榜单卡片里所有缩略图的**真实加载状态**。
 * ★ 先 scrollIntoView 再 decode()：`loading="lazy"` 的图不在视口内就不会开始加载，
 *   不等它就会把「还没加载」误判成「加载失败」。
 */
const IMG_STATE = async () => {
  const cards = Array.from(document.querySelectorAll('#rankList .rk-card'));
  const champ = document.querySelector('#rankList .rk-champ');
  const all = cards.concat(champ ? [champ] : []);
  const rows = [];
  for (const c of all) {
    c.scrollIntoView({ block: 'center' });
    const th = c.querySelector('.th');
    const img = th ? th.querySelector('img') : null;
    const ph = th ? th.querySelector('.ph') : null;
    if (img) {
      try { await img.decode(); } catch (e) { /* 解码失败就保持原样，交给 naturalWidth 判定 */ }
    }
    const r = th ? th.getBoundingClientRect() : { width: 0, height: 0 };
    rows.push({
      rank: (c.querySelector('.no, .no1') || {}).textContent || '?',
      title: (c.querySelector('.t') || {}).textContent || c.getAttribute('title') || '',
      kind: c.classList.contains('rk-champ') ? 'champ' : 'card',
      hasImg: !!img,
      hasPh: !!ph,
      nw: img ? img.naturalWidth : 0,
      nh: img ? img.naturalHeight : 0,
      src: img ? (img.currentSrc || img.src || '') : '',
      thW: Math.round(r.width),
      thH: Math.round(r.height),
    });
  }
  return rows;
};

(async () => {
  const h = await connectBrowser();
  const page = await newPage(h.browser, { width: 1280, height: 900 });
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [页面 JS 报错]', e.message); });
  try {
    console.log('=== ⓪ 首页热榜（默认周榜）===');
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    /* 等热榜渲染出来（它是异步拉的） */
    await page.waitForSelector('#rankList .rk-card', { timeout: 45000 });
    await wait(1200);

    let rows = await page.evaluate(IMG_STATE);
    console.log('  卡片数 ' + rows.length);
    rows.forEach((r) => {
      const flag = r.hasImg && r.nw > 0 ? '✅' : (r.hasPh ? '占位' : '❌');
      console.log(`   ${flag} ${String(r.rank).padStart(3)} ${String(r.title).slice(0, 26).padEnd(28)} ${r.nw}x${r.nh}  ${String(r.src).slice(0, 62)}`);
    });

    /* ★ 先钉「真的有卡片」—— 否则 0 条时下面每条都是空真的假绿 */
    chk('热榜渲染出卡片（0 条时下面全是假绿）', rows.length > 0, rows.length + ' 张');
    const withImgEl = rows.filter((r) => r.hasImg);
    chk('★ 每张卡片都拿到了 <img> 元素（不是退化成首字占位）', withImgEl.length === rows.length,
      withImgEl.length + '/' + rows.length);
    const loaded = rows.filter((r) => r.nw > 0);
    chk('★ 图片**真的加载成功**（naturalWidth > 0）', loaded.length === rows.length,
      loaded.length + '/' + rows.length);
    const phCount = rows.filter((r) => r.hasPh).length;
    chk('没有卡片落在「首字占位」分支', phCount === 0, phCount + ' 张');
    const broken = rows.filter((r) => r.hasImg && r.nw === 0);
    if (broken.length) broken.forEach((b) => console.log('     裂图：' + b.title + ' → ' + b.src.slice(0, 100)));
    chk('缩略图槽位有实际尺寸（图真的占版面）', rows.every((r) => r.thW > 0 && r.thH > 0),
      rows.map((r) => r.thW + 'x' + r.thH).slice(0, 3).join(' '));
    /* ★ 源站图兜底真的生效了吗 —— 周榜里「DLSS 5 Swapper」这类工具条目本地库没收录，
       它的图只能来自源站那一行（image.weiban.qq.com）。这条能红说明兜底断了。 */
    const fromSrc = rows.filter((r) => /community_assets|\/uploads\/|weiban\.qq\.com/.test(r.src));
    chk('★ 至少一条走「源站图兜底」（库外条目也需要有图）', fromSrc.length > 0,
      fromSrc.length + ' 条，例：' + String((fromSrc[0] || {}).src || '').slice(0, 58));

    /* 冠军卡单独看：它用的是另一套模板（champHtml），图更大 */
    const champ = rows.filter((r) => r.kind === 'champ');
    chk('冠军卡存在且大图已加载', champ.length === 1 && champ[0].nw > 0,
      champ.length ? champ[0].nw + 'x' + champ[0].nh : '无冠军卡');

    console.log('\n=== ① 切到「全站榜」—— 源站给的是站内相对路径 ===');
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('#rankPills .stage-pill')).find((x) => x.dataset.p === 'year');
      if (b) b.click();
    });
    await wait(3500);
    const rows2 = await page.evaluate(IMG_STATE);
    rows2.forEach((r) => {
      const flag = r.hasImg && r.nw > 0 ? '✅' : (r.hasPh ? '占位' : '❌');
      console.log(`   ${flag} ${String(r.rank).padStart(3)} ${String(r.title).slice(0, 26).padEnd(28)} ${r.nw}x${r.nh}  ${String(r.src).slice(0, 62)}`);
    });
    chk('全站榜渲染出卡片', rows2.length > 0, rows2.length + ' 张');
    const loaded2 = rows2.filter((r) => r.nw > 0);
    chk('★ 全站榜图片真的加载成功（站内相对路径必须已被补全为绝对 URL）',
      rows2.length > 0 && loaded2.length === rows2.length, loaded2.length + '/' + rows2.length);
    const rel = rows2.filter((r) => r.src && !/^https?:/i.test(r.src));
    chk('★ 没有残留相对路径的 src（残留 = 图全裂）', rel.length === 0, rel.length + ' 条');
    /* ⚠️ 这里**刻意不**断言「必须出现 /uploads/ 形态的 src」：
       封面优先序是「库内 cover > 源站行图」，而全站榜都是热门老游戏、库里全都有 cover，
       所以实际永远走不到源站那条相对路径。硬要它出现就是**为凑断言而写假断言**。
       `coverOf` 对相对路径的补全由 tools/test-covers.js 的 ① 组离线覆盖。 */
    chk('全站榜的图都来自库内 cover（说明优先序生效）',
      rows2.every((r) => /store_item_assets\/steam\/apps\/|\/uploads\//.test(r.src)),
      rows2.filter((r) => /store_item_assets/.test(r.src)).length + '/' + rows2.length + ' 走库内');

    await page.screenshot({ path: path.join(OUT, 'v1023-C-热榜封面.png') });
    console.log('\n  截图 → _preview/v1023-C-热榜封面.png');
  } catch (e) {
    fail++;
    console.log('  ❌ 实拍异常：' + String((e && e.message) || e).slice(0, 300));
  } finally {
    await page.close().catch(() => {});
    await h.close().catch(() => {});
  }

  console.log('\n============================');
  console.log(`  通过 ${pass}/${pass + fail}（失败 ${fail}）`);
  console.log('============================');
  process.exit(fail ? 1 : 0);
})();
