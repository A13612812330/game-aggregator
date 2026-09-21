/* tools/preview-v1022.js — v10.22「下载弹窗 + 解包页手机专区同款卡片」实拍 + 断言
 *
 * 这一版有两条用户口径必须用**真浏览器**验，静态断言证不了：
 *   ① 「解包匹配的游戏能够跟手机专区的前端展示效果一样」
 *      → 卡片必须有**真的加载出来的封面**（naturalWidth > 0，不是 img 标签存在就算），
 *        并且封面容器真占版面（宽高 > 0）。
 *   ② 「把详情页的跳转链接变成获取到对应游戏的下载链接（弹窗展示）」
 *      → 弹窗必须能**真的被看到**。
 *        本项目已经踩过一次同类假绿：粘性导航被另一个 sticky 完全盖住，
 *        而「元素存在 / position 对 / 占版面 > 0」全部通过。
 *        所以这里用 `elementFromPoint(弹窗中心)` 判定「用户点得到吗」——
 *        它必须落在 #dlPop 内部。z-index 比对只作辅助证据。
 *
 * 运行：node tools/preview-v1022.js   （需服务已在 8123 运行）
 * 产出：_preview/v1022-*.png
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

/** 读弹出的下载弹窗状态（含「点得到吗」的 elementFromPoint 判定）
 *  ⚠️ 这个函数体是**在页面里执行**的（必须交给 page.evaluate），
 *     在 node 侧直接调用会 ReferenceError: document is not defined。 */
const POP_STATE = () => {
  const pop = document.getElementById('dlPop');
  if (!pop || pop.hidden) return { open: false };
  const box = pop.querySelector('.dlpop-box');
  const r = box.getBoundingClientRect();
  const cx = Math.round(r.left + r.width / 2);
  const cy = Math.round(r.top + r.height / 2);
  const hit = document.elementFromPoint(cx, cy);
  const drawer = document.getElementById('drawer');
  const z = (el) => (el ? Number(getComputedStyle(el).zIndex) || 0 : 0);
  return {
    open: true,
    w: Math.round(r.width), h: Math.round(r.height),
    left: Math.round(r.left), top: Math.round(r.top),
    inViewport: r.left >= -1 && r.top >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1,
    hitInside: !!(hit && pop.contains(hit)),
    hitDesc: hit ? (hit.tagName + (hit.className ? '.' + String(hit.className).split(' ')[0] : '')) : 'null',
    popZ: z(pop),
    drawerZ: z(drawer),
    title: (document.getElementById('dlTitle') || {}).textContent || '',
    sub: (document.getElementById('dlSub') || {}).textContent || '',
    groups: [...document.querySelectorAll('#dlBody .dl-grp')].map((g) => ({
      head: g.querySelector('.h b').textContent.trim(),
      n: g.querySelector('.h .n').textContent.trim(),
      rows: g.querySelectorAll('.dl-it').length,
    })),
    /* ★ v10.29：弹窗里的「源分组」升级成了**分区签**。
       v10.27/10.28 是「XD 一组 + 机地一组」同屏并列（`.dl-grp`）；
       v10.29 按用户口径「分开显示，而不是本体下面还有 Mod 或者修改器」改成 tab ——
       XD 与机地三个专区都变成平级签，**一次只渲一块**（实测签文字「XDGAME 盘口 6」「本体 2」）。
       ⇒ 「双源都取到没有」从此要看签（`.dl-an`），只数 `.dl-grp` 会误判成「源丢了」。
       （`.dl-grp` 并未废弃：权限受限路径 `dlBlocked()` 仍用它，所以下面 groups 保留。） */
    tabs: [...document.querySelectorAll('#dlBody .dl-an')]
      .map((x) => (x.textContent || '').replace(/\s+/g, ' ').trim()),
    links: [...document.querySelectorAll('#dlBody .dl-it a.act')].map((a) => a.getAttribute('href')).filter(Boolean),
    /* ★ v10.22：源站要求登录/权限时，整组会渲染成 .dl-blocked 说明块 + 一个去源站的出口。
       这两项必须可观测 —— 否则「弹窗里一个链接都没有」看起来和「抓取坏了」一模一样。 */
    blocked: document.querySelectorAll('#dlBody .dl-blocked').length,
    blockedText: [...document.querySelectorAll('#dlBody .dl-blocked')].map((e) => e.textContent).join(' '),
    goHrefs: [...document.querySelectorAll('#dlBody a.dl-go')].map((a) => a.getAttribute('href')).filter(Boolean),
    note: (document.querySelector('#dlBody .dl-note') || {}).textContent || '',
    dead: document.querySelectorAll('#dlBody .dl-it .act[style]').length,
    pwds: [...document.querySelectorAll('#dlBody .dl-it .tx span')].map((s) => s.textContent).filter((t) => /提取码|访问码/.test(t)),
    foot: (document.getElementById('dlFoot') || {}).textContent || '',
  };
};

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const h = await connectBrowser();
  const page = await newPage(h.browser, { width: 1440, height: 1000 });
  page.on('pageerror', (e) => { console.log('  [页面 JS 报错]', e.message); fail++; });

  /* ============================================================
   *  A. 解包匹配页 —— 卡片与手机专区同版式
   * ============================================================ */
  console.log('\n=== A. 解包匹配页：卡片同版式 ===');
  await page.goto(BASE + '/unpack.html', { waitUntil: 'networkidle2', timeout: 60000 });
  await wait(1400);
  await page.click('#upSample');
  await wait(2600);

  const cards = await page.evaluate(async () => {
    const box = document.getElementById('upMatch');
    box.scrollIntoView({ block: 'start' });
    await new Promise((r) => setTimeout(r, 700));      // 等懒加载封面解码
    const imgs = [...document.querySelectorAll('#upMatch .emu-card.up-mc .cov img')];
    const list = document.querySelector('#upMatch .emu-grid.up-list');
    const first = document.querySelector('#upMatch .emu-card.up-mc');
    const cols = list ? getComputedStyle(list).gridTemplateColumns.split(' ').length : 0;
    /* ★ 图片真的加载出来了吗（img 存在 ≠ 图出来了；符号链接/404 都是 0） */
    await Promise.all(imgs.slice(0, 12).map((im) => (im.complete ? 1 : new Promise((r) => {
      im.addEventListener('load', r, { once: true }); im.addEventListener('error', r, { once: true });
    }))));
    const covBox = first ? first.querySelector('.cov') : null;
    const cr = covBox ? covBox.getBoundingClientRect() : null;
    const cardStyle = first ? getComputedStyle(first) : null;
    return {
      n: document.querySelectorAll('#upMatch .emu-card.up-mc').length,
      withCover: imgs.length,
      loaded: imgs.slice(0, 12).filter((im) => im.complete && im.naturalWidth > 0).length,
      checked: Math.min(imgs.length, 12),
      covW: cr ? Math.round(cr.width) : 0, covH: cr ? Math.round(cr.height) : 0,
      radius: cardStyle ? cardStyle.borderRadius : '',
      srcBadge: first ? (first.querySelector('.up-mc-src') || {}).textContent || '' : '',
      dlBtns: document.querySelectorAll('#upMatch .emu-card [data-dl-open]').length,
      srcLinks: document.querySelectorAll('#upMatch .emu-card .up-mc-go').length,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      cols,
    };
  });
  chk('★ 结果卡片就位（> 0 张）', cards.n > 0, cards.n + ' 张');
  chk('★ 卡片带封面容器且真占版面', cards.covW > 100 && cards.covH > 60, cards.covW + '×' + cards.covH);
  chk('★★ 封面图**真的加载出来**了（naturalWidth > 0，不是「img 标签在」）',
    cards.checked > 0 && cards.loaded >= cards.checked - 1, cards.loaded + '/' + cards.checked + ' 张已解码');
  chk('★ 卡片圆角与手机专区一致（13px）', cards.radius === '13px', cards.radius);
  chk('★ 卡片标注「要求来自」（不写「推断」）', /要求来自/.test(cards.srcBadge), cards.srcBadge);
  chk('★ 每张卡都有下载入口', cards.dlBtns === cards.n, cards.dlBtns + '/' + cards.n);
  chk('★ 有源站详情外链', cards.srcLinks > 0, cards.srcLinks + ' 个');
  chk('解包页桌面无横向溢出', cards.overflow <= 2, '溢出 ' + cards.overflow + 'px');
  chk('桌面卡片多列', cards.cols >= 2, cards.cols + ' 列');
  await page.screenshot({ path: path.join(OUT, 'v1022-unpack-cards.png') });

  /* ============================================================
   *  B. 从解包页卡片直接唤起下载弹窗
   * ============================================================ */
  console.log('\n=== B. 解包页 → 下载弹窗 ===');
  await page.evaluate(() => {
    const b = document.querySelector('#upMatch .emu-card [data-dl-open]');
    b.click();
  });
  await wait(1000);
  const opening = await page.evaluate(POP_STATE);
  chk('★ 点击卡片下载按钮后弹窗打开', opening.open === true, opening.open ? '' : '弹窗没开');
  await page.waitForFunction(() => {
    const b = document.getElementById('dlBody');
    return b && !b.querySelector('.dlpop-load');
  }, { timeout: 45000 }).catch(() => {});
  await wait(600);
  const pop1 = await page.evaluate(POP_STATE);
  chk('★ 弹窗内容已渲染（不是一直转圈）', pop1.open && pop1.groups.length >= 1,
    pop1.groups.map((g) => g.head + ' ' + g.n).join(' ｜ '));
  /* ★ 榜首是哪款游戏会随数据更新而变，所以这里不能钉死「必须有链接」——
     钉的是**不变量**：要么给出真实外链，要么给出可读的「为什么没有」。
     （实测当前榜首恰好是被锁的「钢铁雄心4」，硬钉「>=1 条链接」会变成一条假红。）
     「一定能给出真实外链」由 C 段用确定样本（xd-15990）验；
     「一定给出原因」由 B2 段用确定样本（id=3967）验。这里只守不变量。 */
  const usable = pop1.links.length >= 1;
  const explained = pop1.blocked >= 1 && pop1.goHrefs.length >= 1;
  chk('★ 弹窗自洽：要么给出真实外链，要么给出可读原因', usable || explained,
    'links=' + pop1.links.length + ' blocked=' + pop1.blocked + ' go=' + pop1.goHrefs.length);
  chk('★ 显示的链接都是 http(s)（没有中间页/相对路径）',
    pop1.links.every((u) => /^https?:\/\//.test(u)), pop1.links.slice(0, 2).join(' '));
  chk('★★ 弹窗中心 elementFromPoint 落在弹窗内部（真被看到，不是被别的层盖住）',
    pop1.hitInside, '命中 ' + pop1.hitDesc + ' ｜ z=' + pop1.popZ + ' drawer=' + pop1.drawerZ);
  chk('★ 弹窗完整落在视口内', pop1.inViewport, `l=${pop1.left} t=${pop1.top} ${pop1.w}×${pop1.h}`);
  chk('弹窗标题非空', !!pop1.title, pop1.title);
  chk('底部有来源与免责说明', /源站/.test(pop1.foot), pop1.foot.slice(0, 40) + '…');
  await page.screenshot({ path: path.join(OUT, 'v1022-dlpop-unpack.png') });

  /* ESC 关闭 */
  await page.keyboard.press('Escape');
  await wait(600);
  const closed = await page.evaluate(() => document.getElementById('dlPop').hidden);
  chk('★ ESC 可关闭弹窗（且不误关别的层）', closed === true, 'hidden=' + closed);

  /* ============================================================
   *  B2. 源站要求登录 / 权限的游戏 —— 必须给出「原因 + 出口」而不是一列沉默的空
   *
   *  ★ 为什么单独钉这一段：实测 XD 对部分游戏（`钢铁雄心4` id=3967）的 10 个盘口
   *    全部返回 `HTTP 200 + 你没有权限下载：钢铁雄心4！`（既无 302 也无跳转脚本）。
   *    如果界面只是「0 条链接」，用户无法区分「本站坏了」和「源站要登录」——
   *    前者会催人重试到天亮。所以这一段是**功能性**断言，不是文案断言：
   *    没有 .dl-blocked 或没有去源站的出口，就必须变红。
   *  ★ 用固定样本（不靠榜首是谁），保证它每次都能真的验到这条分支。
   * ============================================================ */
  console.log('\n=== B2. 权限受限样本（钢铁雄心4 / id=3967）===');
  const b2opened = await page.evaluate(() => {
    if (typeof window.openDownload !== 'function') return false;
    window.openDownload({
      title: '钢铁雄心4', sub: '',
      url: 'https://www.xdgame.com/game/3967.html',
      jidi: '',
    });
    return true;
  });
  chk('已对权限受限样本唤起弹窗', b2opened === true);
  await page.waitForFunction(() => {
    const b = document.getElementById('dlBody');
    return b && !b.querySelector('.dlpop-load');
  }, { timeout: 60000 }).catch(() => {});
  await wait(600);
  const popA = await page.evaluate(POP_STATE);
  const xdGrp = popA.groups.find((g) => /XDGAME/.test(g.head)) || null;
  chk('★ 权限受限时仍渲染 XDGAME 分组（不是整块消失）', !!xdGrp, xdGrp ? xdGrp.head : '无该分组');
  chk('★ 该分组如实标注 0 条可用', !!xdGrp && /^0 \/ \d+ 条可用$/.test(xdGrp.n), xdGrp ? xdGrp.n : '');
  chk('★ 给出了「源站要求登录 / 权限」的可读原因（.dl-blocked）',
    popA.blocked >= 1 && /登录\s*\/\s*权限|权限/.test(popA.blockedText), popA.blockedText.slice(0, 60));
  chk('★ 给出了去源站的出口（.dl-go → XD 详情页）',
    popA.goHrefs.length >= 1 && /xdgame\.com\/game\/3967\.html/.test(popA.goHrefs[0]),
    popA.goHrefs.join(' '));
  chk('★ 顶部说明不是「共 N 条可直接打开」而是说明拿不到原因',
    /没有可直接打开的网盘地址/.test(popA.note), popA.note.slice(0, 46));
  chk('★ 权限受限时没有任何假链接（links 必须为 0）', popA.links.length === 0, popA.links.length + ' 条');
  await page.screenshot({ path: path.join(OUT, 'v1022-dlpop-needauth.png') });
  await page.keyboard.press('Escape');
  await wait(500);

  /* ============================================================
   *  C. 详情抽屉 → 双源一次取全
   * ============================================================ */
  console.log('\n=== C. 详情抽屉「⬇ 网盘下载」（XD + 机地 双源）===');
  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 60000 });
  await wait(1800);

  /* 直接走页面的 openDetail：拿一条**既有 XD 详情页、又合并了机地话题**的条目
     （xd-15990 妈妈我真的在学外语：XD 侧 6 个盘口，机地侧有社区分享帖） */
  const opened = await page.evaluate(() => {
    const fb = encodeURIComponent(JSON.stringify({
      id: 'xd-15990',
      title: "妈妈，我真的在学外语/Mom, I'm Really Learning English",
      cover: '', score: null, size: '1.6GB', genres: ['模拟'],
      dateLabel: '2026-09-04',
      jidiUrl: 'https://jidiyouxi.com/topic/detail/2150803602',
    }));
    window.openDetail('https://www.xdgame.com/game/15990.html', fb, false);
    return true;
  });
  chk('已触发详情抽屉', opened === true);
  await page.waitForFunction(() => {
    const b = document.getElementById('dlBtn');
    return b && b.getBoundingClientRect().width > 0;
  }, { timeout: 45000 }).catch(() => {});
  await wait(800);

  const btn = await page.evaluate(() => {
    const b = document.getElementById('dlBtn');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    const drawer = document.getElementById('drawer');
    const dr = drawer.getBoundingClientRect();
    return {
      w: Math.round(r.width), h: Math.round(r.height),
      text: b.textContent.trim(),
      hasUrl: !!b.dataset.dlUrl, hasJidi: !!b.dataset.dlJidi,
      gridColumn: getComputedStyle(b).gridColumn,
      insideDrawer: drawer.contains(b),
      drawerOpenW: Math.round(dr.width),
    };
  });
  chk('★ 详情页有「⬇ 网盘下载」按钮', !!btn && /网盘下载/.test(btn.text), btn ? btn.text : '不存在');
  chk('★ 按钮真占版面且在抽屉内', !!btn && btn.w > 80 && btn.h > 30 && btn.insideDrawer,
    btn ? btn.w + '×' + btn.h + ' ｜ 抽屉宽 ' + btn.drawerOpenW : '');
  chk('★ 按钮独占一行（与「前往源站详情」不是同一类动作）', !!btn && btn.gridColumn.indexOf('1 / -1') >= 0 || (btn && btn.gridColumn === '1 / -1'),
    btn ? btn.gridColumn : '');
  chk('★ 按钮同时带 XD 与机地两个 URL（一次把两源链接都取回来）',
    !!btn && btn.hasUrl && btn.hasJidi, btn ? ('url=' + btn.hasUrl + ' jidi=' + btn.hasJidi) : '');

  await page.evaluate(() => document.getElementById('dlBtn').click());
  await wait(1200);
  await page.waitForFunction(() => {
    const b = document.getElementById('dlBody');
    return b && !b.querySelector('.dlpop-load');
  }, { timeout: 60000 }).catch(() => {});
  await wait(700);

  const pop2 = await page.evaluate(POP_STATE);
  chk('★★ 从抽屉里点开的弹窗压得住抽屉（层级 + 命中判定双证据）',
    pop2.hitInside && pop2.popZ > pop2.drawerZ,
    `命中 ${pop2.hitDesc} ｜ z=${pop2.popZ} > drawer=${pop2.drawerZ}`);
  /* ★★ 2026-09-21 预期变更同步（原为：`pop2.groups.length >= 2` + 找 `.dl-grp` 里的 XDGAME 组）
     判据 = 把三页回退到 HEAD 再跑本套件 → 39/5；当前版 37/7，多出的 2 条正在这里。
     根因：v10.29 把下载弹窗的多分区改成 **tab**（用户口径「分开显示，而不是本体下面
     还有 Mod 或者修改器」）⇒ 源分组层被分区签取代，XD 不再是同屏的一组而是**一个平级签**。
     换成的口径不比旧的弱：旧断言只要凑够两组就算过（哪怕 XD 那组是空的、或盘口数为 0），
     新断言还额外要求 XD 那一签**真的标出盘口数 ≥ 3**。
     反证锚点：把 `dlTabList()` 里 XD 那一项的 name 改掉（不再写「盘口」）→ 两条都会红。 */
  const xdTab = pop2.tabs.find((t) => /XDGAME/.test(t)) || '';
  const jidiTab = pop2.tabs.find((t) => /本体|Mod|修改器/.test(t)) || '';
  chk('★ 双源都在（XDGAME 与机地各自占一个分区签）',
    !!xdTab && !!jidiTab, pop2.tabs.join(' ｜ ') || '无分区签');
  const xdM = xdTab.match(/XDGAME\s*盘口\s*(\d+)/);
  chk('★★ XDGAME 那一签标出的盘口数 ≥ 3（用户口径「大部分 XD 都是有多个下载链接」）',
    !!xdM && Number(xdM[1]) >= 3, xdTab || '无 XD 签');
  chk('★ 完整标题来自源站（不是库里的短名）',
    /妈妈，我真的在学外语/.test(pop2.title), pop2.title);
  chk('★ 展示版本串（Build.…／容量／语言）', /Build\./.test(pop2.sub), pop2.sub.slice(0, 64));
  chk('提取码/访问码被解析出来展示', pop2.pwds.length >= 1, pop2.pwds.slice(0, 2).join(' ｜ '));
  chk('没有解析失败的条目混进来当结果', pop2.dead === 0, pop2.dead + ' 条不可用');
  await page.screenshot({ path: path.join(OUT, 'v1022-dlpop-drawer.png') });

  /* ============================================================
   *  D. 窄屏
   * ============================================================ */
  console.log('\n=== D. 窄屏（390px）===');
  const mp = await newPage(h.browser, { width: 390, height: 860 });
  await mp.goto(BASE + '/unpack.html', { waitUntil: 'networkidle2', timeout: 60000 });
  await wait(1400);
  await mp.click('#upSample');
  await wait(2600);
  const mob = await mp.evaluate(async () => {
    document.getElementById('upMatch').scrollIntoView({ block: 'start' });
    await new Promise((r) => setTimeout(r, 600));
    const list = document.querySelector('#upMatch .emu-grid.up-list');
    const card = document.querySelector('#upMatch .emu-card.up-mc');
    const cr = card ? card.getBoundingClientRect() : null;
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      cols: list ? getComputedStyle(list).gridTemplateColumns.split(' ').length : 0,
      cardW: cr ? Math.round(cr.width) : 0,
      n: document.querySelectorAll('#upMatch .emu-card.up-mc').length,
    };
  });
  chk('窄屏无横向溢出', mob.overflow <= 2, '溢出 ' + mob.overflow + 'px');
  chk('★ 窄屏卡片单列铺满', mob.cols === 1 && mob.cardW > 300, mob.cols + ' 列 · 卡宽 ' + mob.cardW);
  chk('窄屏仍有结果', mob.n > 0, mob.n + ' 张');

  /* ★ 用**已知有链接**的样本（xd-15990，XD 6 个盘口 + 机地多帖）。
     不能点榜首：榜首是哪款游戏随热度数据变，实测当前榜首正是被锁的「钢铁雄心4」，
     点它会渲染成权限说明块 → 没有 .dl-grp .l 可量 → 单列断言静默变成「测不到」而不是「不合格」。
     这段要量的就是**链接列表的窄屏单列**，样本必须真的产出行。 */
  await mp.evaluate(() => {
    window.openDownload({
      title: "妈妈，我真的在学外语/Mom, I'm Really Learning English",
      url: 'https://www.xdgame.com/game/15990.html',
      jidi: 'https://jidiyouxi.com/topic/detail/2150803602',
    });
  });
  await wait(1200);
  await mp.waitForFunction(() => {
    const b = document.getElementById('dlBody');
    return b && !b.querySelector('.dlpop-load');
  }, { timeout: 60000 }).catch(() => {});
  await wait(600);
  const mp2 = await mp.evaluate(() => {
    const pop = document.getElementById('dlPop');
    const box = pop.querySelector('.dlpop-box');
    const r = box.getBoundingClientRect();
    const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
    /* ★ v10.29：行容器从 `.dl-grp .l`（源分组）换成 `.dl-sec > .l`（当前分区）。
       两者都是「一行一帖」的容器，量列数的意图不变；但选择器不跟着换会量不到节点
       → 返回 0 列，看起来像「窄屏被压成 0 列」的假红（本轮实测正是这条变红）。
       `.dl-grp` 那条保留作兜底：权限受限路径 `dlBlocked()` 仍用它。 */
    const grp = document.querySelector('#dlBody .dl-sec > .l') || document.querySelector('#dlBody .dl-grp .l');
    return {
      hidden: pop.hidden,
      w: Math.round(r.width), h: Math.round(r.height),
      inViewport: r.left >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1,
      hitInside: !!(hit && pop.contains(hit)),
      /* ★ 先证明「真的产出了行」再谈列数 —— 否则 0 行时 gridTemplateColumns 是 none，
         split 出来是 1 列，断言会假绿（本项目在列表区块上踩过同类坑）。 */
      rows: document.querySelectorAll('#dlBody .dl-it').length,
      col: grp ? getComputedStyle(grp).gridTemplateColumns.split(' ').length : 0,
    };
  });
  chk('★ 窄屏弹窗弹出且完整在视口内', !mp2.hidden && mp2.inViewport, mp2.w + '×' + mp2.h);
  chk('★★ 窄屏弹窗也没被盖住（命中判定）', mp2.hitInside);
  chk('★ 窄屏弹窗真产出了链接行（否则下面的列数断言没有意义）', mp2.rows > 0, mp2.rows + ' 行');
  chk('窄屏链接列表单列', mp2.rows > 0 && mp2.col === 1, mp2.col + ' 列');
  await mp.screenshot({ path: path.join(OUT, 'v1022-dlpop-mobile.png') });

  console.log('\n============================');
  console.log('  通过 ' + pass + ' / 失败 ' + fail);
  console.log('  截图：_preview/v1022-*.png');
  console.log('============================');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('实拍脚本异常：', e); process.exit(1); });
