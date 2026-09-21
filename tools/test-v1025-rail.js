/* ★ v10.25 浏览器回归（第二层：真实浏览器 + CDP，手动分批跑）：③ 详情页竖向定位条。
 * 断言全部是**行为式**的：点第 i 项 → 抽屉滚到第 i 个分区 + 高亮落在 i 上 +
 * 每一档的 scrollTop 严格递增（顺序错/落点重复都会变红）。不读页面内部变量。
 *   node tools/test-v1025-rail.js
 *   GAME=艾尔登法环 node tools/test-v1025-rail.js
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

  const pick = await p.evaluate(async (q) => {
    const j = await fetch('/api/library?q=' + encodeURIComponent(q)).then((r) => r.json());
    const it = (j.items || [])[0];
    return it ? { url: it.url, jidi: it.jidiUrl || '', title: it.title } : null;
  }, GAME);
  console.log('样例:', JSON.stringify(pick));
  if (!pick) { console.log('❌ 库里找不到', GAME); await h.close(); process.exit(1); }

  await p.evaluate((g) => { window.openDetail(g.url, encodeURIComponent(g.jidi || ''), false); }, pick);
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

  chk('① 定位条可见（未 hidden，真占版面）', !geo.hidden && geo.disp !== 'none' && geo.box.w > 0 && geo.box.h > 0,
    JSON.stringify({ hidden: geo.hidden, disp: geo.disp, box: geo.box }));
  chk('② 固定在可视区**右侧**：右边距 < 60px（让开滚动条，不贴死边缘）',
    (geo.vw - geo.box.r) >= 4 && (geo.vw - geo.box.r) < 60,
    `右距 ${geo.vw - geo.box.r}px（rail.style.right=${geo.railRightStyle}）`);
  chk('③ 定位条整体在抽屉**内部**（不越出抽屉左沿）', geo.box.l >= geo.drawer.l,
    `rail.left=${geo.box.l} drawer.left=${geo.drawer.l}`);
  chk('④ 竖直居中（条中心 ≈ 视口中心 ± 6px）', Math.abs((geo.box.top + geo.box.h / 2) - 1000 / 2) <= 6,
    `条中心 ${geo.box.top + geo.box.h / 2} vs 500`);
  /* ★ v10.29：8 → 9 项（补「评分参数」，用户反馈「右侧悬浮定位条好像没更新」的根因）。
     写成 `>= 9` + 不重复，而不是 `=== 9`：分区数是**随数据变化**的
     （手机配置 / 修改器 / 云存档都可能没有内容），钉死等号会在别的样本上假红。 */
  chk('⑤ 收录 ≥9 项且不重复（v10.28 是 8 项，本轮补了「评分参数」）',
    geo.labels.length >= 9 && new Set(geo.labels).size === geo.labels.length,
    `${geo.labels.length} 项: ${geo.labels.join(' / ')}`);
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
    const on = await p.evaluate(() => {
      const items = [...document.querySelectorAll('#dRail .dr-it')];
      return items.findIndex((b) => b.classList.contains('on'));
    });
    trace.push({ i, st: Math.round(st), on, label: geo.labels[i] });
  }
  console.log('  落点轨迹:');
  trace.forEach((t) => console.log(`    #${t.i + 1} ${String(t.label).padEnd(6)} scrollTop=${String(t.st).padStart(5)}  高亮=${t.on + 1}`));

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
  chk('⑨c 落点歧义只可能出现在**同一行**的两块之间（当前样本 = 修改器 + 云存档）',
    ambiguous.length === 0 || ambiguous.map((i) => trace[i].label).sort().join('+') === '云存档+修改器',
    ambiguous.map((i) => trace[i].label).join('+') || '（无歧义项）');
  chk('⑨b 最后一项点击后高亮落在最后一项（滚到底兜底生效）',
    trace[lastIdx].on === lastIdx, `${lastIdx + 1}→${trace[lastIdx].on + 1}`);
  const landings = trace.map((t) => t.st);
  const uniq = new Set(landings).size;
  chk('⑩ 落点非递减 + 互不相同的落点数 ≥ n-1（顺序与正文一致，无整体错位）',
    landings.every((v, i) => i === 0 || v >= landings[i - 1]) && uniq >= n - 1 && landings[0] < landings[lastIdx],
    `落点 ${landings.join(' < ')} ｜ 去重 ${uniq}/${n}`);
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

  console.log('\n============================');
  console.log(`  通过 ${pass}/${pass + fail}（失败 ${fail}）`);
  console.log('============================');
  await h.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
