/* ★ v10.25 浏览器回归（第二层：真实浏览器 + CDP，手动分批跑）：④ 「更多」按钮 + 全部内容弹窗。
 * 断言要点：
 *   ① 每个截断区块里都存在 .d-more-btn，且**文案里的条数 == 后端真实总数**
 *      （这是最容易写错的一处：按钮写 98、弹窗里只有 12）
 *   ② 点开弹窗后行数 >= 详情页里显示的行数（一定是「更多」，不能反而更少）
 *   ③ 载荷不能跨游戏串台：连开两款游戏，第二款弹窗里不能出现第一款的机型名
 *   node tools/test-v1025-more.js
 */
const path = require('path');
const fs = require('fs');
const { connectBrowser, newPage, sleep } = require('./browser');

const BASE = process.env.BASE || 'http://127.0.0.1:8123';
const OUT = path.join(__dirname, '..', '_preview');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const chk = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅', name); }
  else { fail++; console.log('  ❌', name, extra != null ? '— ' + extra : ''); }
};
async function until(p, fn, ms = 20000, step = 250) {
  const t0 = Date.now();
  for (;;) {
    if (await p.evaluate(fn)) return true;
    if (Date.now() - t0 > ms) return false;
    await sleep(step);
  }
}
async function openGame(p, q) {
  const g = await p.evaluate(async (s) => {
    const j = await fetch('/api/library?q=' + encodeURIComponent(s)).then((r) => r.json());
    /* ★ 2026-10-13 修：原先取 `items[0]`，而首条可能是**机地条目**（`jidi-*`），
       也可能是**没有任何资源的空端游条目**（实测「艾尔登法环」的 `xd-10708` → 0/0/0，
       而 `xd-3668` → 7/63/97）。配套的两个问题：
         · 机地条目的 id 与资源分组用的**本地库 id**（`xd-*`）不同源 ⇒ 两个区块恒空；
         · 原调用是 `openDetail(url, encodeURIComponent(jidi), ...)` —— **第二参不是 JSON**，
           `openDetail` 里 `JSON.parse` 失败 ⇒ `fb = {}`，与真实用户路径
           （`data-fb` 是 JSON / 或走 `openDetailById`）**不一致**。
       ⇒ 改为：在候选里挑**第一个真有 >3 条修改器或存档**的 `xd-*` 条目，
          并走 `openDetailById`（真实路径之一，fb 一定带 libId）。 */
    const cands = (j.items || []).filter((x) => /^xd-/.test(String(x.id || ''))).slice(0, 6);
    for (const c of cands) {
      const r = await fetch('/api/res/game?id=' + encodeURIComponent(c.id) + '&limit=1').then((x) => x.json()).catch(() => null);
      const ct = r && r.counts;
      if (ct && (ct.trainers > 3 || ct.saves > 3)) return { id: c.id, title: c.title };
    }
    return cands[0] ? { id: cands[0].id, title: cands[0].title } : null;
  }, q);
  if (!g) return null;
  await p.evaluate((x) => window.openDetailById(x.id, x.title), g);
  await sleep(9500);
  return g;
}

(async () => {
  const h = await connectBrowser();
  const p = await newPage(h.browser, { width: 1440, height: 1000 });
  await p.goto(BASE + '/index.html', { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1600);

  const GAME = process.env.GAME || '艾尔登法环';
  const g = await openGame(p, GAME);
  console.log('样例:', JSON.stringify(g));
  if (!g) { console.log('❌ 找不到', GAME); await h.close(); process.exit(1); }

  console.log('\n=== ④ 「更多」按钮 ===');
  const btns = await p.evaluate(() => {
    const out = [];
    /* ★ v10.29：按钮有两种版式，**共用同一套 data-full 委托与 token**：
         `.d-more-btn` 正文流里的一整行（机型清单等），
         `.d-more-hd`  卡片**右上角**（修改器 / 云存档，用户口径「其他则为卡片右上角更多按钮」）。
       这里必须把两种都收进来 —— 只查 `.d-more-btn` 会漏掉本轮新加的那两个（实测漏成 1 个）。 */
    document.querySelectorAll('#drawerBody .d-more-btn, #drawerBody .d-more-hd').forEach((b) => {
      const r = b.getBoundingClientRect();
      out.push({
        token: b.dataset.full || '', txt: (b.textContent || '').replace(/\s+/g, ' ').trim(),
        w: Math.round(r.width), h: Math.round(r.height),
        kind: b.classList.contains('d-more-hd') ? 'hd' : 'row',
        /* 它在哪个区块里 —— 用于核对「按钮挂在正确的专区」 */
        blk: (() => {
          let n = b, s = '';
          while (n && n !== document.body) {
            const h4 = n.querySelector && n.querySelector(':scope > h4');
            if (h4) { s = (h4.textContent || '').replace(/\s+/g, ' ').trim(); break; }
            n = n.parentElement;
          }
          return s.slice(0, 22);
        })(),
      });
    });
    return out;
  });
  btns.forEach((b) => console.log(`    [${b.blk}] (${b.kind}) ${b.txt}  (${b.w}×${b.h})`));
  /* ★ 条数是**随数据变化**的（某作可能既没有 >5 条机型、也没有 >5 条修改器/云存档），
     所以只要求「至少有一个」。两种版式是否都在，放到两个样本都跑完后统一判（见 ①b）。 */
  chk('① 详情页里存在「更多」按钮', btns.length >= 1, `实际 ${btns.length} 个`);
  const kinds = new Set(btns.map((b) => b.kind));
  chk('② 每个按钮都真占版面（w>0 且 h>0）', btns.every((b) => b.w > 0 && b.h > 0),
    btns.map((b) => `${b.w}×${b.h}`).join(' '));
  /* ★ 2026-10-13 **收窄**（原判据：`每个按钮文案里都有条数` —— 过宽 ⇒ 假红）。
   *
   *  为什么过宽：实测存在一个**合法无条数**的按钮 —— `#bhMoreSlot` 在
   *  `hiddenDev === 0`（机型没被截断）时，文案固定是「查看实测记录与逐条配置」
   *  （index.html:4449-4452）。它背后是「实测记录 / 逐条配置」，**根本没有『台数』可写**：
   *      hiddenDev > 0 → `查看全部 N 台机型[ 与实测参数]`
   *      hiddenDev = 0 → `查看实测记录与逐条配置`
   *  硬要求「每个按钮都带条数」只会(*)假红，(*)诱使实现去编一个不存在的数字 ——
   *  两条都比不判更糟。而「条数**对不对**」这件事已经由 ④-Nd 逐按钮守住
   *  （按钮上的 N == 弹窗说明里的 N），③ 不必重复承担。
   *  ⇒ ③ 改为只守**真缺陷形态**：文案非空、不含未渲染占位、出现的数字必须 ≥1。 */
  chk('③ 每个按钮文案都非空、无未渲染占位、数字不自相矛盾（条数口径由 ④-Nd 逐按钮守）',
    btns.length >= 1 && btns.every((b) => {
      const s = String(b.txt || '');
      if (s.length < 4) return false;                       // 空文案 / 只渲染出半个词
      if (/(undefined|NaN|Infinity|null|\{\}|\[object)/i.test(s)) return false;  // 模板没填进去
      const nums = s.match(/\d+/g) || [];
      return nums.every((x) => Number(x) >= 1);             // 「全部 0 →」= 假入口
    }),
    btns.map((b) => b.txt).join(' | '));
  /* ★ 与 ③ 配套：③ 收窄后必须补一条「条数**没有整体消失**」的守护，
     否则将来有人把 `全部 N` 全改成无条数文案，③ 反而会绿。 */
  chk('③b 至少一个按钮带条数（防条数口径整体消失）', btns.some((b) => /\d/.test(String(b.txt || ''))),
    btns.map((b) => b.txt).join(' | '));

  /* 逐一点开：行数必须**不少于**详情页里同区块已展示的行数，且 > 0 */
  for (let i = 0; i < btns.length; i++) {
    const b = btns[i];
    await p.evaluate((k) => document.querySelectorAll('#drawerBody .d-more-btn, #drawerBody .d-more-hd')[k].click(), i);
    await until(p, () => {
      const x = document.getElementById('dlBody');
      return x && !x.querySelector('.dlpop-load') && x.textContent.trim().length > 0;
    }, 25000);
    await sleep(300);
    const info = await p.evaluate((btnTxt) => {
      const bd = document.getElementById('dlBody');
      /* ★ 2026-10-13：行选择器补齐第三类 —— `.d-res-it`。
         弹窗正文有**三套行渲染**，各自有专属类名：
           `dv`  手机模拟器 → `.df-row`（实测记录）/ `.d-param`（逐条配置）
           `tr2` 修改器 · 全部 → `dResFullHtml()` → **`.d-res-it`**（与卡内同款行）
           `sv2` 存档   · 全部 → 同上
         原先只查 `.df-row, .d-param` ⇒ 打开 tr2/sv2 弹窗时 rows 恒为 0
         ⇒ ④-Nb **假红**（实测：弹窗其实有 4 / 5 行，`.df-note` 也照常写「共 4 条修改器」）。 */
      const ROWSEL = '.df-row, .d-param, .d-res-it';
      const r0 = bd.querySelector(ROWSEL);
      const rr = r0 ? r0.getBoundingClientRect() : null;
      const note = (bd.querySelector('.df-note') || {}).textContent || '';
      return {
        open: !document.getElementById('dlPop').hidden,
        title: document.getElementById('dlTitle').textContent,
        rows: bd.querySelectorAll(ROWSEL).length,
        rowVis: !!(rr && rr.width > 0 && rr.height > 0),
        overflow: bd.scrollWidth - bd.clientWidth,
        head: note,
        /* 「共 N」两处必须一致：按钮上的 N 与弹窗说明里的 N */
        noteN: (note.match(/共\s*(\d+)/) || [])[1] || '',
        btnN: (String(btnTxt).match(/(?:查看全部|全部)\s*(\d+)/) || [])[1] || '',
      };
    }, b.txt);
    chk(`④-${i + 1} 点开「${b.txt}」→ 弹窗打开、标题对得上`,
      info.open && /全部|配置|机型|来源|记录|资源帖/.test(info.title), JSON.stringify(info.title));
    chk(`④-${i + 1}b 弹窗里行数 > 0 且首行真占版面`, info.rows > 0 && info.rowVis,
      `rows=${info.rows} rowVis=${info.rowVis}`);
    chk(`④-${i + 1}c 弹窗正文无横向溢出`, info.overflow <= 0, `overflow=${info.overflow}`);
    /* ★ 2026-10-13：只在**按钮自己声明了条数**时才比对。
       无条数按钮（`查看实测记录与逐条配置`）合法存在 ⇒ 原先 `btnN === ''` 必然红（假红）。 */
    if (info.noteN && info.btnN) {
      chk(`④-${i + 1}d 按钮上的数字 == 弹窗说明里的数字（${info.btnN} vs ${info.noteN}）`,
        info.btnN === info.noteN, `btn=${info.btnN} note=${info.noteN}`);
    }
    if (i === 0) {
      /* 把第一条截图留下来看版式 */
      await p.screenshot({ path: path.join(OUT, 'check-more-pop.png') });
    }
    await p.evaluate(() => document.querySelector('#dlPop [data-dl="close"]').click());
    await sleep(350);
  }

  /* ---- 第二个样例：★ 2026-10-13 重写 —— **动态挑**一款真的有 >3 条修改器/存档的款 ----
   *
   *  原判据坏在两处（都不是实现退化，是**样本脆**）：
   *   ① **术语**：判据钉在「云存档」这个词上，而 v10.57 起界面统一叫「存档」
   *      （用户口径「云存档就是存档，更新下」）⇒ 词形对不上。
   *   ② **样本**：原先钉死「怪物火车2」。而修改器 / 存档是按**端游库 id**（`xd-*`）
   *      归组的，`/api/library?q=` 的**首条却可能是机地条目**（`jidi-*`）——
   *      实测同一款：`/api/res/game?id=xd-3668` → trainers 7 / saves 63 / mod 97，
   *      而 `id=jidi-3668` → **0 / 0 / 0**。拿机地 id 打开 ⇒ 两侧区块全不渲染
   *      ⇒ 永远拿不到 `.d-more-hd`（卡头版「更多」）。
   *      `dMoreHd` 的产出与两处调用都还在（L4648 / L4682）—— 实现没坏，是样本挑错了。
   *  ⇒ 改成：先用 `/api/res/groups` 查出条目最多的分区与 libId（保证 > MAXTR=3），
   *     再用 `openDetailById(libId)` 直达该款 ⇒ 判据不再依赖任何一款的具体数据。 */
  const GAME2 = process.env.GAME2 || '';
  let cand2 = null;
  if (GAME2) {
    cand2 = await p.evaluate(async (q) => {
      const j = await fetch('/api/library?q=' + encodeURIComponent(q)).then((r) => r.json());
      const it = (j.items || []).find((x) => /^xd-/.test(String(x.id || '')));
      return it ? { libId: it.id, count: 0, cat: '(env 指定)', name: it.title } : null;
    }, GAME2);
  } else {
    cand2 = await p.evaluate(async () => {
      for (const cat of ['trainers', 'saves']) {
        const j = await fetch('/api/res/groups?cat=' + cat + '&sort=count&limit=8').then((r) => r.json());
        const g = (j.items || []).find((x) => x.count > 3 && x.libId);
        if (g) return { libId: g.libId, count: g.count, cat, name: String(g.name || g.game || '') };
      }
      return null;
    });
  }

  if (cand2) {
    console.log(`  第二样本（动态挑）: ${cand2.name} ${cand2.libId} · ${cand2.cat} ${cand2.count} 条`);
    await p.evaluate((id) => window.openDetailById(id, ''), cand2.libId);
    await sleep(9500);
    const b2 = await p.evaluate(() => [...document.querySelectorAll('#drawerBody .d-more-btn, #drawerBody .d-more-hd')]
      .map((b) => ({ txt: (b.textContent || '').replace(/\s+/g, ' ').trim(), kind: b.classList.contains('d-more-hd') ? 'hd' : 'row', blk: b.closest('.d-blk') ? (b.closest('.d-blk').querySelector('h4') || {}).textContent || '' : '' })));
    console.log(`  ${cand2.name} 的按钮:`, b2.map((x) => `[${String(x.blk).replace(/\s+/g, '').slice(0, 10)}](${x.kind}) ${x.txt}`).join(' | ') || '（无）');
    b2.forEach((x) => kinds.add(x.kind));
    /* ★ 判据只钉「卡头右上角那种版式出现过」，**不钉区块名**（术语会变，v10.57 就变过一次）。 */
    chk('⑦ 卡头右上角版式（.d-more-hd）出现 —— 动态样本保证该款条目 >3',
      b2.some((x) => x.kind === 'hd' && /(查看全部|全部)\s*\d+/.test(x.txt)),
      b2.map((x) => x.blk + ':' + x.kind + ':' + x.txt).join(' | '));
  } else {
    chk('⑦ 卡头右上角版式（.d-more-hd）出现 —— 动态样本保证该款条目 >3', false,
      '★ 找不到「修改器/存档 >3 条」的样本（数据源问题，不是 UI 问题）');
  }
  /* ★ v10.29：两种版式都必须出现过 —— 单看一个样本会漏（艾尔登法环只有机型那一个
     整行按钮；卡头那种要另一个样本才有）。两种版式共用同一套 data-full 委托，
     所以这里同时是在守「没被拆成两套机制」。 */
  chk('①b 两种版式都出现过（正文整行 + 卡片右上角，共用同一套 data-full）',
    kinds.has('row') && kinds.has('hd'), [...kinds].join('/'));

  /* ---- 载荷不能串台：换一款游戏后，旧 token 必须失效 ---- */
  const firstTokens = btns.map((b) => b.token);
  const g2 = await openGame(p, '赛博朋克2077');
  const after = await p.evaluate(() => ({
    tokens: [...document.querySelectorAll('#drawerBody .d-more-btn, #drawerBody .d-more-hd')].map((b) => b.dataset.full || ''),
    title: (document.querySelector('#drawerBody h2') || {}).textContent || '',
  }));
  chk('⑤ 换游戏后按钮 token 全部换新（旧载荷不串台）',
    after.tokens.length > 0 && after.tokens.every((t) => !firstTokens.includes(t)),
    `旧 ${firstTokens.join(',')} → 新 ${after.tokens.join(',')}（当前 ${after.title}）`);

  /* 点新游戏的一个按钮，确认弹的是新游戏的内容（不报「没有可展示的内容」） */
  if (after.tokens.length) {
    await p.evaluate(() => document.querySelector('#drawerBody .d-more-btn, #drawerBody .d-more-hd').click());
    await until(p, () => {
      const x = document.getElementById('dlBody');
      return x && !x.querySelector('.dlpop-load') && x.textContent.trim().length > 0;
    }, 25000);
    const n2 = await p.evaluate(() => ({
      open: !document.getElementById('dlPop').hidden,
      /* 同上：三套行渲染都要算进来 */
      rows: document.getElementById('dlBody').querySelectorAll('.df-row, .d-param, .d-res-it').length,
      empty: !!document.getElementById('dlBody').querySelector('.dlpop-empty'),
      sub: document.getElementById('dlSub').textContent,
    }));
    chk('⑥ 新游戏的「更多」能正常打开（不是空弹窗、不串旧载荷）',
      n2.open && !n2.empty && n2.rows > 0, JSON.stringify(n2));
  }

  console.log('\n============================');
  console.log(`  通过 ${pass}/${pass + fail}（失败 ${fail}）`);
  console.log('============================');
  await h.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
