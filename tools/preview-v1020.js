/* tools/preview-v1020.js — v10.20「解包配置匹配」页面实拍 + 断言
 *
 * 这个页面的价值全在「识别对不对」：字段名未知时靠词典猜，猜错就会输出
 * **看起来很确定**的错结论。所以断言必须打在值上，不能只断言「区块存在」。
 *
 * 三条本轮实测踩过的坑，这里都钉成断言：
 *   ① 分层的 16 GB 必须显示成 16 GB（不是 minRequirements 的 8 GB）
 *   ② 配置画像卡必须真占版面（宽高 > 0）
 *   ③ 匹配列表必须有条目（否则就是「区块在、0 条」的老坑）
 *
 * 运行：node tools/preview-v1020.js   （需服务已在 8123 运行）
 * 产出：_preview/v1020-*.png
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

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const h = await connectBrowser();
  const page = await newPage(h.browser, { width: 1440, height: 1100 });
  page.on('pageerror', (e) => { console.log('  [页面 JS 报错]', e.message); fail++; });

  await page.goto(BASE + '/unpack.html', { waitUntil: 'networkidle2', timeout: 60000 });
  await wait(1500);

  /* ============ A. 页面与导航 ============ */
  console.log('\n=== A. 页面与导航 ===');
  const nav = await page.evaluate(() => {
    const top = document.querySelector('.topbar .main-nav');
    const up = document.getElementById('navUnpack');
    const r = up && up.getBoundingClientRect();
    return {
      title: document.title,
      links: top ? [...top.querySelectorAll('a')].map((a) => ({ id: a.id, href: a.getAttribute('href') })) : [],
      onId: top && top.querySelector('a.on') ? top.querySelector('a.on').id : '',
      upW: r ? Math.round(r.width) : 0,
      upH: r ? Math.round(r.height) : 0,
    };
  });
  chk('页面标题正确', /解包/.test(nav.title), nav.title);
  chk('顶栏有三个入口（首页 / 手机专区 / 解包匹配）', nav.links.length >= 3, nav.links.map((l) => l.id).join(','));
  chk('★ 解包匹配入口指向 /unpack.html', nav.links.some((l) => l.id === 'navUnpack' && l.href === '/unpack.html'));
  chk('★ 当前页高亮在「解包匹配」上', nav.onId === 'navUnpack', 'on=' + nav.onId);
  chk('★ 该入口真占版面（宽高 > 0）', nav.upW > 0 && nav.upH > 0, nav.upW + '×' + nav.upH);

  /* ============ B. 输入区与判定依据 ============ */
  console.log('\n=== B. 输入区 / 判定依据 ===');
  const input = await page.evaluate(() => {
    const ta = document.getElementById('upInput');
    const r = ta.getBoundingClientRect();
    const btns = ['upRun', 'upPick', 'upSample', 'upClear'].map((id) => {
      const b = document.getElementById(id);
      const rr = b && b.getBoundingClientRect();
      return { id, w: rr ? Math.round(rr.width) : 0, h: rr ? Math.round(rr.height) : 0 };
    });
    const dims = document.querySelectorAll('#upDict .up-dim').length;
    return { taW: Math.round(r.width), taH: Math.round(r.height), btns, dims };
  });
  chk('★ JSON 输入框真占版面', input.taW > 300 && input.taH >= 120, input.taW + '×' + input.taH);
  chk('四个按钮都可点（宽高 > 0）', input.btns.every((b) => b.w > 40 && b.h > 20),
    input.btns.map((b) => b.id + ':' + b.w + '×' + b.h).join(' '));
  chk('★ 判定依据面板已拉到数据（四个维度）', input.dims === 4, 'dims=' + input.dims);

  /* ============ C. 载入示例 → 解析 ============ */
  console.log('\n=== C. 解析与配置画像 ===');
  await page.click('#upSample');
  await wait(2200);

  const res = await page.evaluate(() => {
    const box = document.getElementById('upResult');
    const cov = document.getElementById('upCoverage');
    const cells = [...document.querySelectorAll('#upProfile .up-cell')].map((c) => {
      const r = c.getBoundingClientRect();
      const nt = c.querySelector('.nt');
      return {
        lb: c.querySelector('.lb').textContent.trim(),
        val: c.querySelector('b').textContent.trim(),
        note: nt ? nt.textContent.trim() : '',
        w: Math.round(r.width), h: Math.round(r.height),
      };
    });
    const get = (k) => (cells.find((c) => c.lb.indexOf(k) >= 0) || {}).val || '';
    const note = (k) => (cells.find((c) => c.lb.indexOf(k) >= 0) || {}).note || '';
    const groups = [...document.querySelectorAll('#upGroups .up-grp')].map((g) => ({
      name: g.querySelector('b').textContent.trim(),
      items: g.querySelectorAll('.it').length,
    }));
    return {
      visible: !box.hidden,
      cov: cov ? cov.textContent.replace(/\s+/g, ' ') : '',
      cells, ram: get('内存'), ramNote: note('内存'), storage: get('存储'), layer: get('兼容层'), arch: get('指令集'),
      api: get('图形接口'), apiNote: note('图形接口'),
      groups,
      warn: (document.querySelector('#upProfile .up-note') || {}).textContent || '',
    };
  });
  chk('结果区已展开', res.visible);
  chk('★ 字段识别率 100%（示例字段全部认得）', /100%/.test(res.cov), res.cov);
  chk('★ 配置画像卡有内容', res.cells.length >= 6, res.cells.length + ' 张');
  chk('★ 画像卡真占版面（宽高 > 0）', res.cells.every((c) => c.w > 60 && c.h > 30),
    res.cells.map((c) => c.w + '×' + c.h).join(' '));
  chk('★★ 内存取「设备自身」16 GB，而非最低要求的 8 GB（分层生效）', /16/.test(res.ram) && !/^8/.test(res.ram), '内存=' + res.ram);
  chk('★★ 存储取 256 GB（同上，不被 40 GB 顶掉）', /256/.test(res.storage), '存储=' + res.storage);
  chk('兼容层识别到 dxvk / box64', /dxvk/.test(res.layer) && /box64/.test(res.layer), res.layer);
  chk('指令集架构识别为 arm64', /arm64/.test(res.arch), res.arch);
  chk('★ 图形接口按兼容层推断出 DX ≤ 11（示例只写了「要求 DX11」，那不是能力）',
    /DX\s*≤\s*11/.test(res.api) && /推断/.test(res.apiNote), res.api + ' / ' + res.apiNote);
  chk('内存卡不重复显示原值（自身配置时副标题应留空）', res.ramNote === '', '副标题="' + res.ramNote + '"');
  chk('★ 逐项明细有分组', res.groups.length >= 3, res.groups.map((g) => g.name + '(' + g.items + ')').join(' '));
  chk('★ 每个分组都有条目（不是空壳）', res.groups.every((g) => g.items > 0));

  await page.screenshot({ path: path.join(OUT, 'v1020-unpack-profile.png') });

  /* ============ D. 匹配结果 ============ */
  console.log('\n=== D. 可适配游戏清单 ===');
  const m = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#upMatch .up-card')];
    const stats = document.querySelector('#upMatch .up-ms b');
    const first = cards[0];
    return {
      n: cards.length,
      playable: stats ? stats.textContent.trim() : '',
      firstVerdict: first ? first.dataset.verdict : '',
      firstName: first ? first.querySelector('.up-card-h b').textContent.trim() : '',
      badges: cards.filter((c) => c.querySelector('.up-badge')).length,
      chips: first ? first.querySelectorAll('.up-ch').length : 0,
      h: cards.length ? Math.round(cards[0].getBoundingClientRect().height) : 0,
      foot: (document.querySelector('#upMatch .up-foot') || {}).textContent || '',
    };
  });
  chk('★ 匹配到游戏（条数 > 0）', m.n > 0, m.n + ' 条');
  chk('★ 卡片真占版面', m.h > 60, '首卡高 ' + m.h + 'px');
  chk('★ 可跑数量已统计', /^\d+$/.test(m.playable) && Number(m.playable) > 0, '可跑 ' + m.playable + ' 款');
  chk('★ 榜首是「流畅」档（规模优先排序）', m.firstVerdict === 'smooth', m.firstVerdict + ' · ' + m.firstName);
  chk('每张卡都有判定徽章', m.badges === m.n, m.badges + '/' + m.n);
  chk('★ 卡片带判定维度标签', m.chips >= 1, m.chips + ' 个');
  chk('★ 明示「不含显卡跑分」（不夸大结论）', /不含显卡跑分/.test(m.foot));

  await page.screenshot({ path: path.join(OUT, 'v1020-unpack-result.png') });

  /* ============ E. 交互 ============ */
  console.log('\n=== E. 交互 ===');
  await page.evaluate(() => {
    const s = document.querySelector('#upSorts .up-sort[data-s="name"]');
    if (s) s.click();
  });
  await wait(1800);
  const byName = await page.evaluate(() => {
    const c = document.querySelector('#upMatch .up-card');
    return { first: c ? c.querySelector('.up-card-h b').textContent.trim() : '', n: document.querySelectorAll('#upMatch .up-card').length };
  });
  chk('★ 切换「名称」排序后列表重排', byName.first !== m.firstName && byName.n > 0, m.firstName + ' → ' + byName.first);

  await page.evaluate(() => {
    const i = document.getElementById('upq');
    i.value = 'GTA';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await wait(1900);
  const searched = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#upMatch .up-card')];
    return { n: cards.length, names: cards.slice(0, 3).map((c) => c.querySelector('.up-card-h b').textContent.trim()) };
  });
  chk('★ 搜索「GTA」命中且被过滤', searched.n > 0 && searched.n < byName.n, searched.n + ' 条 · ' + searched.names.join(' / '));

  await page.evaluate(() => {
    const i = document.getElementById('upq');
    i.value = '';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await wait(1900);
  await page.evaluate(() => {
    const b = document.getElementById('upOnly');
    if (b) b.click();
  });
  await wait(1800);
  const only = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#upMatch .up-card')];
    return { n: cards.length, noCount: cards.filter((c) => c.dataset.verdict === 'no').length, on: document.getElementById('upOnly').classList.contains('on') };
  });
  chk('★「只看可跑」生效（不可跑被滤掉）', only.on && only.noCount === 0 && only.n > 0, '剩 ' + only.n + ' 条，不可跑 ' + only.noCount);

  /* ============ F. 错误处理 ============ */
  console.log('\n=== F. 错误处理 ===');
  await page.evaluate(() => {
    const i = document.getElementById('upOnly');
    if (i && i.classList.contains('on')) i.click();
  });
  await wait(1500);
  await page.evaluate(() => {
    const ta = document.getElementById('upInput');
    ta.value = '{ 这不是合法 JSON';
  });
  await page.click('#upRun');
  await wait(1600);
  const err = await page.evaluate(() => {
    const m = document.getElementById('upMsg');
    return { hidden: m.hidden, cls: m.className, text: m.textContent };
  });
  chk('★ 非法 JSON 给出可读错误', !err.hidden && /err/.test(err.cls) && /JSON/.test(err.text), err.text.slice(0, 60));

  /* ============ G. 布局 ============ */
  console.log('\n=== G. 布局 ===');
  const deskLayout = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    cellCols: getComputedStyle(document.querySelector('#upProfile .up-cells')).gridTemplateColumns.split(' ').length,
  }));
  chk('桌面无横向溢出', deskLayout.overflow <= 2, '溢出 ' + deskLayout.overflow + 'px');
  chk('画像卡是多列网格', deskLayout.cellCols >= 2, deskLayout.cellCols + ' 列');

  /* 窄屏 */
  const mp = await newPage(h.browser, { width: 390, height: 900 });
  await mp.goto(BASE + '/unpack.html', { waitUntil: 'networkidle2', timeout: 60000 });
  await wait(1500);
  await mp.click('#upSample');
  await wait(2200);
  const mob = await mp.evaluate(() => {
    const tb = document.getElementById('tabbar');
    const items = tb ? tb.querySelectorAll('a').length : 0;
    const on = tb && tb.querySelector('a.on') ? tb.querySelector('a.on').getAttribute('aria-label') : '';
    const cards = document.querySelectorAll('#upMatch .up-card').length;
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      items, on, cards,
      cols: getComputedStyle(document.querySelector('#upMatch .up-list')).gridTemplateColumns.split(' ').length,
    };
  });
  chk('窄屏无横向溢出', mob.overflow <= 2, '溢出 ' + mob.overflow + 'px');
  chk('★ 窄屏底部 Tab 存在', mob.items >= 3, mob.items + ' 项');
  chk('★ 底部 Tab 高亮在「解包」', mob.on === '解包', mob.on);
  chk('★ 窄屏仍能出结果', mob.cards > 0, mob.cards + ' 张卡');
  chk('窄屏卡片单列', mob.cols === 1, mob.cols + ' 列');
  await mp.screenshot({ path: path.join(OUT, 'v1020-unpack-mobile.png'), fullPage: false });

  console.log('\n============================');
  console.log('  通过 ' + pass + ' / 失败 ' + fail);
  console.log('  截图：_preview/v1020-unpack-*.png');
  console.log('============================');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('实拍脚本异常：', e); process.exit(1); });
