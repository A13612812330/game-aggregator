/* ★ v10.25 浏览器回归（第二层：真实浏览器 + CDP，手动分批跑）：③ 详情页竖向定位条。
 * 断言以**行为式**为主：点第 i 项 → 抽屉滚到第 i 个分区 + 高亮落在 i 上 +
 * 每一档的 scrollTop 严格递增（顺序错/落点重复都会变红）。
 *
 * ★★ v10.67 唯一的例外，以及为什么必须开这个口子：
 *   `⑤c` / `⑤c′` 两条**直读页面内部变量 `dRailItems`**（条项 → 正文节点的映射），
 *   其余断言仍不读内部变量。
 *   起因：原先只有「落点几何」这一条路（点一项 → 看落点处最靠上的 ≥24px 分区），
 *   而它在要守的场景上**会假绿** —— 「条上挂着一个 12px 空壳项」时，点它滚到的位置
 *   紧跟着就是真分区，几何取到的仍是真分区（≥24px）⇒ 通过。
 *   而 `dRailItems[i].el` 就是 `railTarget()` 选中的**节点本身**，高度直接判，绕不开。
 *   ⇒ 两种判据**互补**保留：几何判「端到端落点」，直读判「条上挂了什么」。
 *   ⚠️ 读不到 `dRailItems` 时**报红**（不静默跳过）—— 内部结构被改名必须有人知道。
 *   ⚠️ 还必须有**零资源样本**：12px 空壳只在「没有修改器/存档」的款上存在，
 *     第一样本（有资源）那一块是 224px 真分区，**结构上测不到**（见 ③b 段）。
 *
 *   node tools/test-v1025-rail.js
 *   GAME=艾尔登法环 node tools/test-v1025-rail.js
 *   ZERO_GAMES=荒野大镖客2,文明6 node tools/test-v1025-rail.js   # 覆盖零资源样本候选表
 */
const path = require('path');
const fs = require('fs');
const { connectBrowser, newPage, sleep } = require('./browser');

const BASE = process.env.BASE || 'http://127.0.0.1:8123';
const GAME = process.env.GAME || '艾尔登法环';
const OUT = path.join(__dirname, '..', '_preview');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const chk = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅', name); }
  else { fail++; console.log('  ❌', name, extra != null ? '— ' + extra : ''); }
};

/* 等平滑滚动停住：连续 3 次采样的 scrollTop 完全一致 */
async function settle(p, ms = 3000) {
  const t0 = Date.now();
  let last = null, same = 0;
  while (Date.now() - t0 < ms) {
    const v = await p.evaluate(() => document.getElementById('drawer').scrollTop);
    if (last !== null && Math.abs(v - last) < 0.5) same++; else same = 0;
    last = v;
    if (same >= 3) return v;
    await sleep(60);
  }
  return last;
}

(async () => {
  const h = await connectBrowser();
  const p = await newPage(h.browser, { width: 1440, height: 1000 });

  await p.goto(BASE + '/index.html', { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1600);

  /* ★ 2026-10-13：样本改用 `openDetailById` 挑**真有资源的端游库条目**。
     原先取 `items[0]` 且传非 JSON 的 fb ⇒ 打开的是机地条目 ⇒
     「修改器 / 存档」按本地库 id 取数为空（详见 `test-v1025-more.js` 里那段注释），
     定位条因此少项、正文内容也不全 —— 断言在**不完整的页面**上判，结论没有意义。 */
  const pick = await p.evaluate(async (q) => {
    const j = await fetch('/api/library?q=' + encodeURIComponent(q)).then((r) => r.json());
    const cands = (j.items || []).filter((x) => /^xd-/.test(String(x.id || ''))).slice(0, 6);
    for (const c of cands) {
      const r = await fetch('/api/res/game?id=' + encodeURIComponent(c.id) + '&limit=1').then((x) => x.json()).catch(() => null);
      const ct = r && r.counts;
      if (ct && (ct.trainers > 3 || ct.saves > 3)) return { id: c.id, title: c.title };
    }
    return cands[0] ? { id: cands[0].id, title: cands[0].title } : null;
  }, GAME);
  console.log('样例:', JSON.stringify(pick));
  if (!pick) { console.log('❌ 库里找不到带端游库条目的', GAME); await h.close(); process.exit(1); }

  await p.evaluate((g) => window.openDetailById(g.id, g.title), pick);
  await sleep(9000);   // 等懒加载分区全部落地（MutationObserver 会在这期间多次重扫）

  console.log('\n=== ③ 详情页竖向定位条 ===');

  const geo = await p.evaluate(() => {
    const rail = document.getElementById('dRail');
    const dr = document.getElementById('drawer');
    const body = document.getElementById('drawerBody');
    if (!rail) return { err: 'no #dRail' };
    const rr = rail.getBoundingClientRect();
    const drr = dr.getBoundingClientRect();
    const brr = body.getBoundingClientRect();
    const items = [...rail.querySelectorAll('.dr-it')];
    const t = rail.querySelector('.dr-t');
    return {
      hidden: rail.hidden,
      disp: getComputedStyle(rail).display,
      box: { l: Math.round(rr.left), r: Math.round(rr.right), w: Math.round(rr.width), h: Math.round(rr.height), top: Math.round(rr.top) },
      drawer: { l: Math.round(drr.left), r: Math.round(drr.right), w: Math.round(drr.width) },
      bodyRight: Math.round(brr.right),
      labels: items.map((b) => (b.querySelector('.dr-t') || {}).textContent || ''),
      nums: items.map((b) => (b.querySelector('.dr-n') || {}).textContent || ''),
      railRightStyle: rail.style.right,
      tagLabelW: t ? Math.round(t.getBoundingClientRect().width) : -1,
      vw: window.innerWidth,
    };
  });
  if (geo.err) { console.log('❌', geo.err); await h.close(); process.exit(1); }

  /* ★ 2026-10-13 新增：**直读**「条上每一项 → 它指向的正文节点」。
     为什么单靠下面 ⑤ 的落点几何不够 —— 几何判据在「空壳项在条上」时会**假绿**：
     点那个空壳项 → 滚到 shell.docTop → 几何取到的是 12px 之后那块真分区（≥24px）⇒ 通过。
     `dRailItems[i].el` 就是 `railTarget()` 选中的**节点本身**，高度可以直接判，绕不开。
     （`dRailItems` 是 index.html 顶层的 `let`，evaluate 在全局作用域求值 ⇒ 按标识符可读。
      读不到就**报红**，不是静默跳过 —— 内部结构改了必须有人知道。） */
  const railItems = await p.evaluate(() => {
    const arr = (typeof dRailItems !== 'undefined') ? dRailItems : null;
    if (!arr) return { err: 'no dRailItems' };
    return {
      n: arr.length,
      it: arr.map((x) => ({
        nm: x.nm, con: !!(x.el && x.el.isConnected),
        h: x.el ? Math.round(x.el.getBoundingClientRect().height) : -1,
        cls: String((x.el && (x.el.className || x.el.id)) || '').slice(0, 20),
      })),
    };
  });
  chk('⑤c 条上每一项指向的正文节点都真占版面（≥24px）—— 直读 dRailItems，与落点几何互补',
    !railItems.err && railItems.it.length >= 5 && railItems.it.every((x) => x.con && x.h >= 24),
    railItems.err ? '★ 读不到 dRailItems（页面内部结构变了？这条必须报红而不是跳过）'
      : railItems.it.map((x) => `${x.nm}=${x.h}px`).join(' '));

  chk('① 定位条可见（未 hidden，真占版面）', !geo.hidden && geo.disp !== 'none' && geo.box.w > 0 && geo.box.h > 0,
    JSON.stringify({ hidden: geo.hidden, disp: geo.disp, box: geo.box }));
  chk('② 固定在可视区**右侧**：右边距 < 60px（让开滚动条，不贴死边缘）',
    (geo.vw - geo.box.r) >= 4 && (geo.vw - geo.box.r) < 60,
    `右距 ${geo.vw - geo.box.r}px（rail.style.right=${geo.railRightStyle}）`);
  chk('③ 定位条整体在抽屉**内部**（不越出抽屉左沿）', geo.box.l >= geo.drawer.l,
    `rail.left=${geo.box.l} drawer.left=${geo.drawer.l}`);
  chk('④ 竖直居中（条中心 ≈ 视口中心 ± 6px）', Math.abs((geo.box.top + geo.box.h / 2) - 1000 / 2) <= 6,
    `条中心 ${geo.box.top + geo.box.h / 2} vs 500`);
  /* ★ 2026-10-13 重写（原判据：`labels.length >= 9`）。详见下方 ⑤ —— 那条现在由
     「逐项点击后的落点几何」来判（行为式），不在这里数数。 */
  chk('⑥ 序号从 1 连续到 N', geo.nums.join(',') === geo.labels.map((_, i) => i + 1).join(','), geo.nums.join(','));
  chk('⑦ 非悬停态标签是收起的（宽度 0，不长期遮正文）', geo.tagLabelW <= 1, `label w=${geo.tagLabelW}`);

  /* 悬停展开：用真实鼠标移动触发 :hover */
  await p.hover('.d-rail');
  await sleep(500);
  const hov = await p.evaluate(() => {
    const t = document.querySelector('#dRail .dr-t');
    const rr = document.getElementById('dRail').getBoundingClientRect();
    return { w: t ? Math.round(t.getBoundingClientRect().width) : -1, railW: Math.round(rr.width) };
  });
  chk('⑧ 悬停整条 → 标签展开（宽度 > 0 且整条随之变宽）', hov.w > 20 && hov.railW > geo.box.w,
    `label w=${hov.w} rail w=${hov.railW}（收起时 ${geo.box.w}）`);
  await p.mouse.move(700, 900);   // 移开
  await sleep(400);

  /* ---- 逐项点击：落点必须严格递增，且高亮自一致 ---- */
  const n = geo.labels.length;
  const trace = [];
  for (let i = 0; i < n; i++) {
    await p.evaluate((k) => document.querySelectorAll('#dRail .dr-it')[k].click(), i);
    /* ★ 点击落点是**两趟**的（见 index.html 里那段注释：顶图 sticky 收窄 188px，
       一趟算不准）。第二趟在 460ms 后发出，所以这里必须等过它再采样 ——
       否则会在两趟之间取值，判据时对时错（首版没等，落点序列来回抖）。 */
    await sleep(900);
    const st = await settle(p);
    /* ★ 2026-10-13：同一次采样里也记下**这一趟的滚动上限**。
       为什么要逐轮记、而不是循环后测一次：详情页分区是懒加载的，正文总高会在这 8 次
       点击期间变（实测「手机配置」回填后总高变大）⇒ 循环后测的 maxScroll 与早几轮的
       不是同一个数，拿它判「这一项是不是被夹住」会错。 */
    const mx = await p.evaluate(() => {
      const d = document.getElementById('drawer');
      return Math.round(d.scrollHeight - d.clientHeight);
    });
    const on = await p.evaluate(() => {
      const items = [...document.querySelectorAll('#dRail .dr-it')];
      return items.findIndex((b) => b.classList.contains('on'));
    });
    /* ★ 2026-10-13 追加：落点处**最靠上那块分区**的实测高度 —— ⑤ 的判据用它。
       为什么要「最靠上」：跳转算法就是把被点分区对齐到抽屉顶部附近，
       所以紧贴顶部的那块**应该就是被点的那一项**。空壳（12px）会顶替真分区占住这个位置，
       这正是要抓的。⚠️ 不能放宽成「视口内所有分区里取最大高度」—— 那样空壳后面
       12px 处就是真分区，会**假绿**（v10.51 的缺陷 A 就是这么漏过去的）。 */
    const topBlkH = await p.evaluate(() => {
      const dr = document.getElementById('drawer');
      const top = dr.getBoundingClientRect().top;
      let best = null;
      document.querySelectorAll('#drawerBody .d-blk, #drawerBody .d-pair, #drawerBody .block, #drawerBody .gal, #drawerBody .kv, #drawerBody #relSlot, #drawerBody #dlSlot').forEach((el) => {
        const r = el.getBoundingClientRect();
        /* ★ 必须**先过滤空壳**（<24px）再看谁最靠上 —— 首版没过滤，于是点「同分类」时
           取到的是正文里那个 12px 的 `.d-pair solo`（它在 `#relSlot` 之前、也落在窗口内），
           报出 `#6同分类=12px` 的**假红**。这与 `railTarget()` 的 RAIL_MIN_H 同一个判据。 */
        if (r.height < 24) return;
        if (r.top < top - 6 || r.top > top + 170) return;   // 只看「贴着抽屉顶部」的那几块
        if (!best || r.top < best.top) best = { top: r.top, h: Math.round(r.height), cls: el.className || el.id };
      });
      return best || { h: -1, cls: '(顶部无 ≥24px 分区)' };
    });
    trace.push({ i, st: Math.round(st), mx, on, label: geo.labels[i], blkH: topBlkH.h, blkCls: String(topBlkH.cls).slice(0, 24) });
  }
  console.log('  落点轨迹:');
  trace.forEach((t) => console.log(`    #${t.i + 1} ${String(t.label).padEnd(6)} scrollTop=${String(t.st).padStart(5)}  上限=${String(t.mx).padStart(5)}  高亮=${t.on + 1}  顶部块 h=${t.blkH} [${t.blkCls}]`));

  /* ★ 2026-10-13 重写（原判据：`geo.labels.length >= 9`）。
     那个 9 是 **v10.29 的版式事实**，之后两件事都变了 ——
       · v10.32 把「修改器 / 存档」在条上**合并成一项**（用户口径：
         「修改器和存档现在是一行了，所以只需要一个」）⇒ 9 → 8；
       · v10.57 术语从「云存档」统一成「存档」⇒ 连名字都变了。
     ⇒ 它从此每次都报「差 1 项」，而**真正该守的东西它一条都没守**：
        条上照样能出现「正文里根本不存在的分区」（v10.51 缺陷 A：`#trSvSlot` 空壳 h=12px
        也通过可见性判据 ⇒ 条上多一项「修改器/存档」，点进去一片空白）。
     ★ 换成能力层判据：**条上每一项点完，落点处最靠上的分区都必须真占版面（≥24px）**。
       空壳 12px 会被这条直接抓住，而它也正是 `railTarget()` 的 `RAIL_MIN_H` 在挡的东西 ——
       判在行为层，实现侧改了阈值也不会静默失效。 */
  chk('⑤ 条上每一项点完，落点处紧贴顶部的分区都真占版面（≥24px，不许空壳入口）',
    trace.length >= 5 && trace.every((t) => t.blkH >= 24),
    trace.map((t) => `#${t.i + 1}${t.label}=${t.blkH}px`).join(' '));
  chk('⑤b 项数落在合理区间且不重复（随数据浮动，不再钉死 9）',
    geo.labels.length >= 5 && geo.labels.length <= 12 && new Set(geo.labels).size === geo.labels.length,
    `${geo.labels.length} 项: ${geo.labels.join(' / ')}`);

  /* ★ 断言必须容忍「滚动被夹住」：定位条最后几项常常都挤在最后一屏里，
     点它们只能滚到 scrollHeight - clientHeight（实测艾尔登法环的
     同分类 + 下载 都落在 2840）—— 那时高亮统一归到最后一项是**正确**行为。
     ★★ v10.29 再加一类必须容忍的情况：**同一行的两块**。
     修改器与云存档现在并排在 `.d-pair` 里（用户口径「同行」），它们的
     `getBoundingClientRect().top` **完全相同** ⇒ 落点也完全相同 ⇒
     无论高亮哪一个，另一个的「点击项 == 高亮项」都不成立。
     这是版式决定的，不是顺序错位。所以：先把「落点与邻居相同」的项挑出来，
     只对**落点唯一**的项要求高亮严格等于被点项；并单独钉住「歧义项恰好是
     修改器 / 云存档这一对」——否则这条放松会变成万能挡箭牌。 */
  const lastIdx = n - 1;
  const landingCount = trace.reduce((m, t) => (m[t.st] = (m[t.st] || 0) + 1, m), {});
  const ambiguous = trace.filter((t) => landingCount[t.st] > 1).map((t) => t.i);
  const strict = trace.slice(0, n - 2).filter((t) => landingCount[t.st] === 1);
  console.log('  同落点（版式上并排 / 被底部夹住）的项：' +
    (ambiguous.length ? ambiguous.map((i) => '#' + (i + 1) + ' ' + trace[i].label).join(', ') : '（无）'));
  chk('⑨ 前 N-2 项中**落点唯一**的那些，点击后高亮严格落在被点项上（顺序不错位）',
    strict.length > 0 && strict.every((t) => t.on === t.i),
    trace.map((t) => `${t.i + 1}→${t.on + 1}${landingCount[t.st] > 1 ? '(同落点)' : ''}`).join(' '));
  /* ★ 2026-10-13 重写（原判据：歧义项的名字必须恰好是「云存档+修改器」）。
     那条判据**两头都陈旧**：
       · 术语：v10.57 起界面统一叫「存档」⇒ 字符串「云存档」在页面里已不存在；
       · 版式：v10.32 已把两块在条上**合并成一项**（D_RAIL 里只剩一条 `trsv`）
         ⇒ 「同一行的两块互相歧义」这个场景在条上**已不可能出现**，
            而原判据恰恰要求它出现 ⇒ 换成任何新样本都会红。
     ★ 真正会造成歧义的成因只有一个：**滚到底被浏览器夹住**（见 ⑩ 上方那段长注释）。
       最后几项都撞在 `scrollHeight - clientHeight` 上 ⇒ 落点必然相同。
     ⇒ 判据改为**按成因**判：每个歧义项的落点都必须等于它那一趟的滚动上限。
       （「正文里两块落点相同」这种真错位仍然会被抓住 —— 那种项的落点 < 上限。） */
  const clampIds = trace.filter((t) => t.st >= t.mx - 2).map((t) => t.i);
  chk('⑨c 落点歧义只可能来自「滚到底被夹住」的项（正文里两块落点相同 = 真错位，必须红）',
    ambiguous.length === 0 || ambiguous.every((i) => clampIds.includes(i)),
    ambiguous.length
      ? ambiguous.map((i) => `#${i + 1}${trace[i].label}=${trace[i].st}(上限${trace[i].mx})`).join(', ')
        + ` ｜ 被夹住 #${clampIds.map((i) => i + 1).join(',#') || '无'}`
      : '（无歧义项）');
  chk('⑨b 最后一项点击后高亮落在最后一项（滚到底兜底生效）',
    trace[lastIdx].on === lastIdx, `${lastIdx + 1}→${trace[lastIdx].on + 1}`);
  const landings = trace.map((t) => t.st);
  const uniq = new Set(landings).size;
  /* ★ 2026-10-13 修：容忍量不再写死 `n-1`，改用**实测的夹住项数**推导。
     原先写死 n-1 的后果：样本一旦有 3 项被夹住（实测艾尔登法环 `xd-10676`：
     修改器/存档 1639 · 同分类 1639 · 下载 1639，上限就是 1639），去重恒为 6 = n-2 ⇒
     每次都报「去重 6/8」的红 —— 而那**完全是正确行为**：夹住是浏览器滚动的物理上限，
     不是顺序错位。写死的数会把「物理上限」和「真错位」混成同一条红，久了就没人看。
     ★ 换成能力层判据：**去掉被夹住的项之后，落点必须两两不同**。
       夹住项本身仍由 ⑨b/⑨c 守（必须落在最后一项 / 成因合法）。 */
  const nonClamp = trace.filter((t) => !clampIds.includes(t.i));
  const uniqNC = new Set(nonClamp.map((t) => t.st)).size;
  chk('⑩ 落点非递减；去掉「滚到底被夹住」的项后落点两两不同（顺序与正文一致，无整体错位）',
    landings.every((v, i) => i === 0 || v >= landings[i - 1])
      && landings[0] < landings[lastIdx]
      && nonClamp.length >= 2 && uniqNC === nonClamp.length,
    `落点 ${landings.join(' < ')} ｜ 去重 ${uniq}/${n} ｜ 非夹住 ${nonClamp.length} 项去重 ${uniqNC}`
      + ` ｜ 夹住 #${clampIds.map((i) => i + 1).join(',#') || '无'}（上限 #${trace.map((t) => t.mx).join('/')}）`);
  chk('⑪ 第 1 项落在首屏之内（第一个有内容的分区不该在第二屏之后）',
    trace[0].st < 1000, `${trace[0].st}px`);

  /* ---- 滚动 spy：手动滚（不点）也要跟着变 ---- */
  await p.evaluate((v) => { document.getElementById('drawer').scrollTo({ top: v, behavior: 'auto' }); }, trace[3].st + 4);
  await sleep(600);
  const mid = await p.evaluate(() => {
    const items = [...document.querySelectorAll('#dRail .dr-it')];
    return items.findIndex((b) => b.classList.contains('on'));
  });
  chk('⑬ 手动滚到第 4 项落点 → 高亮跟着变成第 4 项（spy 不依赖点击）', mid === 3, `高亮 #${mid + 1}/${n}`);

  /* 滚到绝对底部 → 必须高亮最后一项（底部夹住兜底） */
  await p.evaluate(() => { const d = document.getElementById('drawer'); d.scrollTo({ top: d.scrollHeight, behavior: 'auto' }); });
  await sleep(600);
  const bot = await p.evaluate(() => {
    const items = [...document.querySelectorAll('#dRail .dr-it')];
    return items.findIndex((b) => b.classList.contains('on'));
  });
  chk('⑬b 滚到绝对底部 → 高亮最后一项', bot === lastIdx, `高亮 #${bot + 1}/${n}`);

  await p.screenshot({ path: path.join(OUT, 'check-rail.png') });

  /* ---- 窄屏不显示 ---- */
  await p.setViewport({ width: 375, height: 800 });
  await sleep(700);
  const mob = await p.evaluate(() => {
    const r = document.getElementById('dRail');
    const rr = r.getBoundingClientRect();
    return { disp: getComputedStyle(r).display, w: Math.round(rr.width) };
  });
  chk('⑭ ≤760px 窄屏不显示定位条', mob.disp === 'none' || mob.w === 0, JSON.stringify(mob));

  await p.setViewport({ width: 1440, height: 1000 });
  await sleep(600);

  /* ---- 关闭详情页 → 定位条收起 ---- */
  await p.evaluate(() => window.closeDetail());
  await sleep(700);
  const after = await p.evaluate(() => {
    const r = document.getElementById('dRail');
    return { hidden: r.hidden, disp: getComputedStyle(r).display };
  });
  chk('⑮ 关闭详情页后定位条一并收起', after.hidden || after.disp === 'none', JSON.stringify(after));

  /* ================= 第二样本：**零修改器 / 零存档**的款 =================
   * ★ 2026-10-13 新增。为什么必须有这个样本 —— 第一样本（有修改器/存档）**测不到**要守的东西：
   *   `#trSvSlot` 是 paintDetail 里**静态写死**的元素（index.html:3948
   *   `<div class="d-pair" id="trSvSlot">…`），**任何一款游戏它都在**。
   *   · 有资源时：`#trBlock`/`#svBlock` 回填 ⇒ `#trSvSlot` 是真分区（实测 224px）⇒ 合法入口；
   *   · 无资源时：两个子块被 `innerHTML=''` 清空，但外层 `.d-pair` **仍留 12px 空壳**
   *     ⇒ 只要可见性判据松散（`offsetHeight > 0`），条上就会多一个**点进去一片空白**的入口。
   *   ⇒ 这 12px 空壳只在「零资源款」上存在，所以**必须**单独跑一个零资源样本。
   *   ⚠️ 还要配一条**阳性对照**（⑤c″）：先证明这一款的 `#trSvSlot` 确实是空壳，
   *      否则「条上没有它」可能只是因为这一款压根没渲染这个元素 ⇒ 断言空转。
   *   （阳性对照是本项目的老规矩：出现「全 0 / 全否」先证明被测对象真的存在。） */
  const ZERO_CANDS = (process.env.ZERO_GAMES || '荒野大镖客2,文明6,泰拉瑞亚,星露谷物语,缺氧').split(',');
  const pick2 = await p.evaluate(async (names) => {
    for (const nm of names) {
      const j = await fetch('/api/library?q=' + encodeURIComponent(nm)).then((r) => r.json()).catch(() => null);
      if (!j) continue;
      for (const c of (j.items || []).filter((x) => /^xd-/.test(String(x.id || ''))).slice(0, 4)) {
        const r = await fetch('/api/res/game?id=' + encodeURIComponent(c.id) + '&limit=1').then((x) => x.json()).catch(() => null);
        const ct = r && r.counts;
        if (ct && ct.trainers === 0 && ct.saves === 0) return { id: c.id, title: c.title };
      }
    }
    return null;
  }, ZERO_CANDS);
  console.log('\n=== ③b 零修改器/零存档样本（空壳场景）===');
  if (!pick2) {
    chk('③b 找到一款「零修改器 / 零存档」的端游库条目', false, '★ 候选表全不满足（数据变了，补 ZERO_GAMES）');
  } else {
    console.log('  零资源样本: ' + pick2.id + ' ' + pick2.title);
    await p.evaluate((g) => window.openDetailById(g.id, g.title), pick2);
    await sleep(8000);
    const zero = await p.evaluate(() => {
      const shell = document.getElementById('trSvSlot');
      const arr = (typeof dRailItems !== 'undefined') ? dRailItems : null;
      return {
        shell: shell ? Math.round(shell.getBoundingClientRect().height) : -1,
        trH: (document.getElementById('trBlock') || {}).offsetHeight,
        n: arr ? arr.length : -1,
        items: arr ? arr.map((x) => ({ nm: x.nm, con: !!(x.el && x.el.isConnected),
          h: x.el ? Math.round(x.el.getBoundingClientRect().height) : -1 })) : [],
      };
    });
    /* 阳性对照：壳必须真的在、且真的是壳 —— 不然下面那条是空转 */
    chk('⑤c″ 阳性对照：该样本的 #trSvSlot 确实存在且是**空壳**（<24px）',
      zero.shell >= 0 && zero.shell < 24,
      `#trSvSlot h=${zero.shell}px，其中 #trBlock h=${zero.trH}px（壳在才有可判性）`);
    chk('⑤c′ 零资源款：条上每一项的目标节点都 ≥24px（不许出现点进去空白的空壳入口）',
      zero.n >= 3 && zero.items.every((x) => x.con && x.h >= 24),
      zero.n < 0 ? '★ 读不到 dRailItems' : `${zero.n} 项：` + zero.items.map((x) => `${x.nm}=${x.h}px`).join(' '));
  }

  console.log('\n============================');
  console.log(`  通过 ${pass}/${pass + fail}（失败 ${fail}）`);
  console.log('============================');
  await h.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
