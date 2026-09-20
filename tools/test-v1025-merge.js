/* ★ v10.25 浏览器回归（第二层：真实浏览器 + CDP，手动分批跑）：⑤ 双源合并去重。
 * 断言要点：
 *   ① 合并不是「把两份糊在一起」—— 截图必须**无重复**（同一 ss hash 只能出现一次）
 *   ② 补来的字段必须**标出来源**（版本介绍〔来自XDGAME〕/ 游戏介绍〔来自…〕）
 *   ③ 机地页面的「配置要求」要变成两栏（源站最低 + Steam 推荐），大标题标「源站 + Steam 官方」
 *   ④ 无孪生的游戏（黑神话那类）必须 merge.on=false、页面与合并前一致（不能硬凑）
 *   node tools/test-v1025-merge.js
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
    if (!it) return null;
    /* ★ 必须按**真实路径**打开：列表行/搜索结果点进详情时，第二参是 `rankFb(it)` 那个 JSON
     *   （带 cover / score / jidiUrl）。早先这里误传 `encodeURIComponent(jidiUrl)`，
     *   openDetail 里 JSON.parse 直接抛异常 → fb={} → fb.cover 为空 →
     *   /api/pcreq 拿不到带 Steam appid 的封面 → 「补推荐配置」这条链路**根本没被走到**，
     *   而断言却绿着（因为它只查「有没有第二栏」，一栏也没报错）。 */
    const fb = {
      id: it.id || '', title: it.title, cover: it.cover || '',
      score: (it.score != null && it.score > 0 && it.score <= 10) ? it.score : null,
      size: it.size || '', genres: (it.genres || []).slice(0, 4),
      dateLabel: it.dateLabel || '', jidiUrl: it.jidiUrl || '',
    };
    return { id: it.id, source: it.source, url: it.url, jidi: it.jidiUrl || '', title: it.title,
      fb: JSON.stringify(fb) };
  }, q);
  if (!g) return null;
  await p.evaluate((x) => { window.openDetail(x.url, encodeURIComponent(x.fb), false); }, g);
  await sleep(9500);
  return g;
}
/* 页面上「实际渲染出来的截图」——直接从 DOM 取，不比接口，这样才验得到渲染链路 */
const SHOT_INFO = `(() => {
  const gal = document.querySelector('#drawerBody .gal');
  if (!gal) return { has: false, n: 0, ids: [], note: '' };
  const ids = [...gal.querySelectorAll('.gal-sld img')].map((im) => {
    const m = String(im.getAttribute('src') || '').match(/ss_[0-9a-f]{16,}/i);
    return m ? m[0].toLowerCase() : String(im.getAttribute('src') || '');
  });
  return { has: true, n: ids.length, ids, note: (gal.querySelector('.src-mini') || {}).textContent || '' };
})()`;

(async () => {
  const h = await connectBrowser();
  const p = await newPage(h.browser, { width: 1440, height: 1000 });
  await p.goto(BASE + '/index.html', { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1600);

  /* ============ A. 机地来源：原本没有「版本介绍」，合并后应有且标源 ============ */
  console.log('\n=== ⑤-A 机地来源（艾尔登法环）===');
  const A = await openGame(p, '艾尔登法环');
  const aMerged = await p.evaluate(() => document.querySelector('#drawerBody .merge-tag') ? 1 : 0);
  const aInfo = await p.evaluate((shotSrc) => {
    const blocks = [...document.querySelectorAll('#drawerBody .block')].map((b) => ({
      h: (b.querySelector('h4') || {}).textContent || '',
      tag: (b.querySelector('h4 .src-mini') || {}).textContent || '',
      len: (b.querySelector('p') || {}).textContent ? b.querySelector('p').textContent.length : 0,
    }));
    return { blocks, shots: eval(shotSrc) };
  }, `${SHOT_INFO}`);
  aInfo.blocks.forEach((b) => console.log(`    [${String(b.h).replace(/\s+/g, ' ').slice(0, 30)}] tag="${b.tag}" len=${b.len}`));
  console.log('    截图:', aInfo.shots.n, '张', aInfo.shots.note ? `（${aInfo.shots.note}）` : '');
  const verBlk = aInfo.blocks.find((b) => /版本介绍/.test(b.h));
  chk('① 机地页面出现了「版本介绍」块（原来**完全没有**这一块）', !!verBlk && verBlk.len > 0,
    verBlk ? JSON.stringify(verBlk) : '没有版本介绍块');
  chk('② 版本介绍上标了来源（来自XDGAME）', !!(verBlk && /来自/.test(verBlk.tag)), verBlk ? verBlk.tag : '—');

  /* ============ B. 配置要求：机地页面应变成两栏 ============ */
  await until(p, () => document.querySelectorAll('#reqSlot .d-req .d-req-c, #reqSlot .d-req > *').length > 1, 15000);
  const req = await p.evaluate(() => {
    const s = document.getElementById('reqSlot');
    const cnt = (s.querySelector('.d-blk .cnt') || {}).textContent || '';
    const heads = [...s.querySelectorAll('.d-req h5, .d-req .h, .d-req > div > b, .d-req .k')].map((x) => (x.textContent || '').trim());
    const html = s.innerHTML;
    return {
      cnt, heads,
      hasMin: /最低配置/.test(html), hasRec: /推荐配置/.test(html),
      tag: (s.querySelector('.src-mini') || {}).textContent || '',
      h: Math.round(s.getBoundingClientRect().height),
    };
  });
  console.log('    配置要求:', JSON.stringify(req).slice(0, 220));
  chk('③ 机地页面的配置要求现在是**两栏**（最低配置 + 推荐配置）', req.hasMin && req.hasRec, JSON.stringify({ min: req.hasMin, rec: req.hasRec }));
  chk('④ 大标题变成「源站 + Steam 官方」且标出推荐配置来源',
    /源站\s*\+\s*Steam/.test(req.cnt) && /Steam/.test(req.tag), `cnt="${req.cnt}" tag="${req.tag}"`);

  /* ============ C. XD 来源：截图合并 + 去重 ============ */
  console.log('\n=== ⑤-C XD 来源（潜水员戴夫）===');
  const C = await openGame(p, '潜水员戴夫');
  const cRaw = await p.evaluate(async (urls) => {
    const [base, mg] = await Promise.all([
      fetch('/api/detail?url=' + encodeURIComponent(urls)).then((r) => r.json()),
      fetch('/api/detail/merged?url=' + encodeURIComponent(urls)).then((r) => r.json()),
    ]);
    const ids = (a) => (a || []).map((s) => {
      const m = String((s && s.f) || '').match(/ss_[0-9a-f]{16,}/i);
      return m ? m[0].toLowerCase() : String((s && s.f) || '');
    });
    const b = ids(base.detail && base.detail.shots), m = ids(mg.detail && mg.detail.shots);
    return {
      baseN: b.length, mergedN: m.length, added: mg.merge && mg.merge.shotsAdded,
      on: !!(mg.merge && mg.merge.on), twinSrc: mg.merge && mg.merge.twin && mg.merge.twin.source,
      rejected: (mg.merge && mg.merge.rejected) || null,
      idMismatch: (mg.merge && mg.merge.idMismatch) || null,
      dupBase: b.length - new Set(b).size, dupMerged: m.length - new Set(m).size,
      filled: (mg.merge && mg.merge.filled) || [],
    };
  }, C.url);
  console.log('    接口层:', JSON.stringify(cRaw));
  chk('⑤ 合并后截图张数 ≥ 原张数，且 shotsAdded 与实际增量一致',
    cRaw.mergedN >= cRaw.baseN && cRaw.added === cRaw.mergedN - cRaw.baseN,
    JSON.stringify(cRaw));
  chk('⑥ ★ 合并后的截图列表**零重复**（去重真的生效，不是把两份糊一起）',
    cRaw.dupMerged === 0, `重复 ${cRaw.dupMerged} 条`);
  chk('⑦ 合并来自**另一源**，且没有触发「id 假设不符」的降级',
    cRaw.on && cRaw.twinSrc && !cRaw.idMismatch,
    JSON.stringify({ on: cRaw.on, twinSrc: cRaw.twinSrc, idMismatch: cRaw.idMismatch }));

  const cDom = await p.evaluate((shotSrc) => eval(shotSrc), `${SHOT_INFO}`);
  chk('⑧ 页面上渲染出来的截图张数 == 接口返回（渲染链路没丢图）',
    cDom.n === cRaw.mergedN, `DOM ${cDom.n} vs 接口 ${cRaw.mergedN}`);
  chk('⑨ DOM 里的截图也零重复', cDom.n - new Set(cDom.ids).size === 0,
    `重复 ${cDom.n - new Set(cDom.ids).size}`);
  if (cRaw.added > 0) {
    chk('⑩ 合并进来的张数在页面上如实标注（含机地 N 张）', /含/.test(cDom.note), `note="${cDom.note}"`);
  } else {
    console.log('    （本次没有新增截图，跳过标注断言）');
  }

  await p.evaluate(() => { const g = document.querySelector('#drawerBody .gal'); if (g) g.scrollIntoView({ block: 'center' }); });
  await sleep(600);
  await p.screenshot({ path: path.join(OUT, 'check-merge.png') });

  /* ============ D. 无孪生：不能硬凑 ============ */
  console.log('\n=== ⑤-D 无孪生条目 ===');
  const dUrl = await p.evaluate(async () => {
    const j = await fetch('/api/library/browse?limit=60&sort=new').then((r) => r.json());
    for (const it of (j.items || [])) {
      const mg = await fetch('/api/detail/merged?url=' + encodeURIComponent(it.url)).then((r) => r.json()).catch(() => null);
      if (mg && mg.merge && mg.merge.on === false && mg.merge.twin === null) return { url: it.url, title: it.title };
    }
    return null;
  });
  if (dUrl) {
    const mg = await p.evaluate(async (u) => {
      const j = await fetch('/api/detail/merged?url=' + encodeURIComponent(u)).then((r) => r.json());
      const b = await fetch('/api/detail?url=' + encodeURIComponent(u)).then((r) => r.json());
      return { m: j.merge, sameShots: ((j.detail.shots || []).length === (b.detail.shots || []).length) };
    }, dUrl.url);
    console.log('    样例:', dUrl.title, JSON.stringify(mg));
    chk('⑪ 找不到孪生时 merge.on=false、twin=null（**不硬凑**）', mg.m.on === false && mg.m.twin === null, JSON.stringify(mg.m));
    chk('⑫ 无孪生时截图与合并前完全一致（没有被改动）', mg.sameShots === true, String(mg.sameShots));
  } else {
    console.log('    （前 60 条新品都有孪生，跳过）');
  }

  /* ============ E. 纯英文标题的机地话题不能被误杀 ============ */
  console.log('\n=== ⑤-E 纯英文标题（曾误杀的一类）===');
  const eHit = await p.evaluate(async () => {
    for (const q of ['恐龙警探', '诺菲尼亚', '模拟火车世界7']) {
      const j = await fetch('/api/library?q=' + encodeURIComponent(q)).then((r) => r.json());
      const it = (j.items || [])[0];
      if (!it) continue;
      const mg = await fetch('/api/detail/merged?url=' + encodeURIComponent(it.url)).then((r) => r.json());
      return { title: it.title, on: !!(mg.merge && mg.merge.on), twin: mg.merge && mg.merge.twin };
    }
    return null;
  });
  if (eHit) {
    console.log('    样例:', JSON.stringify(eHit));
    chk('⑬ 纯英文标题的孪生不被标题闸门误杀（合并成立）', eHit.on === true,
      JSON.stringify(eHit));
  } else { console.log('    （样例都不在库里，跳过）'); }

  console.log('\n============================');
  console.log(`  通过 ${pass}/${pass + fail}（失败 ${fail}）`);
  console.log('============================');
  await h.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
