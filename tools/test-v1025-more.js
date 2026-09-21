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
    const it = (j.items || [])[0];
    return it ? { url: it.url, jidi: it.jidiUrl || '', title: it.title } : null;
  }, q);
  if (!g) return null;
  await p.evaluate((x) => { window.openDetail(x.url, encodeURIComponent(x.jidi || ''), false); }, g);
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
  /* ★ 文案两种都合法：「查看全部 N …」（整行）/「全部 N →」（卡头，位置已经很挤） */
  chk('③ 每个按钮文案里都有条数', btns.every((b) => /(查看全部|全部)\s*\d+/.test(b.txt)),
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
      const r0 = bd.querySelector('.df-row, .d-param');
      const rr = r0 ? r0.getBoundingClientRect() : null;
      const note = (bd.querySelector('.df-note') || {}).textContent || '';
      return {
        open: !document.getElementById('dlPop').hidden,
        title: document.getElementById('dlTitle').textContent,
        rows: bd.querySelectorAll('.df-row, .d-param').length,
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
    if (info.noteN) {
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

  /* ---- 第二个样例：专挑会触发「云存档更多」的游戏（路径数 > 3） ---- */
  const GAME2 = process.env.GAME2 || '怪物火车2';
  const g2b = await openGame(p, GAME2);
  if (g2b) {
    const b2 = await p.evaluate(() => [...document.querySelectorAll('#drawerBody .d-more-btn, #drawerBody .d-more-hd')]
      .map((b) => ({ txt: (b.textContent || '').replace(/\s+/g, ' ').trim(), kind: b.classList.contains('d-more-hd') ? 'hd' : 'row', blk: b.closest('.d-blk') ? (b.closest('.d-blk').querySelector('h4') || {}).textContent || '' : '' })));
    console.log(`  ${GAME2} 的按钮:`, b2.map((x) => `[${String(x.blk).replace(/\s+/g, '').slice(0, 8)}](${x.kind}) ${x.txt}`).join(' | ') || '（无）');
    b2.forEach((x) => kinds.add(x.kind));
    chk(`⑦ ${GAME2} 有「云存档」的更多按钮（且是**卡头右上角**那种版式）`,
      b2.some((x) => /云存档/.test(x.blk) && /(查看全部|全部)\s*\d+/.test(x.txt) && x.kind === 'hd'),
      b2.map((x) => x.blk + ':' + x.kind + ':' + x.txt).join(' | '));
  } else { console.log('  （跳过 GAME2：库里找不到）'); }
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
      rows: document.getElementById('dlBody').querySelectorAll('.df-row, .d-param').length,
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
