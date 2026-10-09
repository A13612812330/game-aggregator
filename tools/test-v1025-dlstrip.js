/* ★ v10.45 浏览器回归（第二层：真实浏览器 + CDP，手动分批跑）：
 *   详情页底部**单入口**「⬇ 下载与资源」+ 合并弹窗四模块（本体 / Mod / 修改器 / 存档）。
 *   断言写在**页面内**（真实浏览器），每条都能被「打坏即变红」反证。
 *
 *   node tools/test-v1025-dlstrip.js            # 默认 赛博朋克2077
 *   GAME=黑神话：悟空 node tools/test-v1025-dlstrip.js
 *
 * ★ 本套件只测「详情页底部入口 → 合并弹窗 → 切模块」这条**交互链路**。
 *   四模块各自的取数与渲染判据在别处，别在这里重复：
 *     · test-download.js（静态）：函数存在性、四模块顺序、派生页同步、广告链清洗
 *     · test-resource-page.js（jsdom）：存档卡片按钮 → 弹窗「存档」模块
 *
 * ★ 为什么这条链路值得单独用真浏览器测（而不是 jsdom）：本套件要证的是
 *   「**可见性**」——`.dl-strip` 真的占版面、页签真的没被内容滚走、切模块真的换了画布。
 *   jsdom 里 `getBoundingClientRect()` 恒为 0（没有排版引擎），这些判据一条都测不了。
 *   本项目铁律：「存在 ≠ 可见」。
 */
const path = require('path');
const fs = require('fs');
const { connectBrowser, newPage, sleep } = require('./browser');

const BASE = process.env.BASE || 'http://127.0.0.1:8123';
const GAME = process.env.GAME || '赛博朋克2077';
const OUT = path.join(__dirname, '..', '_preview');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const chk = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✅', name); }
  else { fail++; console.log('  ❌', name, extra != null ? '— ' + extra : ''); }
};

/* 等待条件成立（避免固定 sleep 造成的假红/假绿）
 * ⚠️ 需要传参时必须走 `p.evaluate(fn, arg)` 这条路：`fn.bind(null, x)` 在 puppeteer 里
 *    过不了序列化（evaluate 是把函数**源码**送进页面执行的），实测会直接抛错。 */
async function until(p, fn, ms = 15000, step = 250, arg) {
  const t0 = Date.now();
  for (;;) {
    if (await p.evaluate(fn, arg)) return true;
    if (Date.now() - t0 > ms) return false;
    await sleep(step);
  }
}

const DL_UNI_NM = ['本体', 'Mod', '修改器', '存档'];

(async () => {
  const h = await connectBrowser();
  const p = await newPage(h.browser, { width: 1440, height: 1000 });

  await p.goto(BASE + '/index.html', { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1600);

  const pick = await p.evaluate(async (q) => {
    const j = await fetch('/api/library?q=' + encodeURIComponent(q)).then((r) => r.json());
    const it = (j.items || [])[0];
    return it ? { id: it.id, source: it.source, title: it.title, url: it.url, jidi: it.jidiUrl || '' } : null;
  }, GAME);
  console.log('样例:', JSON.stringify(pick));
  if (!pick) { console.log('❌ 库里找不到这款游戏'); await h.close(); process.exit(1); }

  await p.evaluate((g) => { window.openDetail(g.url, encodeURIComponent(g.jidi || ''), false); }, pick);
  await sleep(9000);   // 等懒加载区块（含 #dlSlot → loadDlBlock 回填）

  /* ============================================================
   * ⑥ 底部单入口
   * ============================================================ */
  console.log('\n=== ⑥ 详情页底部入口（单按钮） ===');

  const st = await p.evaluate(() => {
    const strip = document.getElementById('dlStrip');
    if (!strip) return { err: 'no #dlStrip' };
    const sr = strip.getBoundingClientRect();
    const btns = [...strip.querySelectorAll('button')];
    const b = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        vis: !el.hidden && cs.display !== 'none' && r.width > 0 && r.height > 0,
        w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top),
        txt: (el.textContent || '').replace(/\s+/g, ' ').trim(),
        cls: el.className, kind: el.dataset.dlOpen == null ? '' : el.dataset.dlOpen,
      };
    };
    return {
      stripVis: !strip.hidden && sr.width > 0 && sr.height > 0,
      stripW: Math.round(sr.width), stripH: Math.round(sr.height),
      stripHidden: !!strip.hidden,
      nBtn: btns.length,
      btn: b(btns[0]),
      /* 入口**不许**被「本体取不到数」牵着走：这两个属性是旧实现用来收起的开关 */
      inlineDisplay: strip.getAttribute('style') || '',
      drawerOverflowX: (() => { const d = document.getElementById('drawer'); return d.scrollWidth - d.clientWidth; })(),
      tabsInBody: !!document.querySelector('#dlBody #dlModTabs'),
    };
  });
  if (st.err) { console.log('❌', st.err); await h.close(); process.exit(1); }

  chk('① .dl-strip 存在且真占版面（w>0 且 h>0）', st.stripVis, `w=${st.stripW} h=${st.stripH}`);
  chk('★★ 底部入口不带 hidden（根因断言：旧实现把它与 dlSecs 绑死 ⇒ 源站要登录时入口整块消失）',
    !st.stripHidden, `hidden=${st.stripHidden} style="${st.inlineDisplay}"`);
  chk('★ 底部只剩**一个**按钮（用户拍板：不要三个按钮）', st.nBtn === 1, `实际 ${st.nBtn} 个按钮`);
  chk('② 这个按钮是 .ds-all 且文案含「下载与资源」',
    !!(st.btn && st.btn.vis && /ds-all/.test(st.btn.cls) && /下载与资源/.test(st.btn.txt)),
    st.btn ? JSON.stringify({ cls: st.btn.cls, txt: st.btn.txt, vis: st.btn.vis }) : '不存在');
  chk('③ 旧的三个按钮样式类已撤干净（ds-main / ds-mf / ds-mo）',
    !!(st.btn && !/ds-main|ds-mf|ds-mo/.test(st.btn.cls)), st.btn ? st.btn.cls : '');
  chk('★ 底部入口与抽屉都不横向溢出', st.drawerOverflowX <= 0, `overflowX=${st.drawerOverflowX}`);
  chk('★ 模块页签条**不在** #dlBody 里（放滚动区里会随内容滚走）', !st.tabsInBody);

  /* ============================================================
   * ⑦ 点入口 → 合并弹窗四模块
   * ============================================================ */
  console.log('\n=== ⑦ 合并弹窗：页签条 + 切模块 ===');

  const snap = () => p.evaluate(() => {
    const pop = document.getElementById('dlPop');
    const tabs = document.getElementById('dlModTabs');
    const body = document.getElementById('dlBody');
    const tr = tabs ? tabs.getBoundingClientRect() : null;
    const br = body ? body.getBoundingClientRect() : null;
    const on = tabs && tabs.querySelector('.dlm.on');
    return {
      open: !!(pop && !pop.hidden && pop.classList.contains('on')),
      tabsHidden: !tabs || tabs.hidden,
      tabsVis: !!(tr && tr.width > 0 && tr.height > 0),
      tabsTop: tr ? Math.round(tr.top) : -1,
      bodyTop: br ? Math.round(br.top) : -1,
      title: (document.getElementById('dlTitle') || {}).textContent || '',
      sub: (document.getElementById('dlSub') || {}).textContent || '',
      names: tabs ? [...tabs.querySelectorAll('.dlm')].map((x) => (x.textContent || '').replace(/\s+/g, ' ').trim()) : [],
      dom: tabs ? [...tabs.querySelectorAll('.dlm')].map((x) => x.dataset.dlm) : [],
      /* 页签上的数字（`·` = 还没回来，数字 = 结论）。顺序同 dom。 */
      cnts: tabs ? [...tabs.querySelectorAll('.dlm i')].map((x) => (x.textContent || '').trim()) : [],
      onKey: on ? on.dataset.dlm : '',
      onTxt: on ? (on.textContent || '').replace(/\s+/g, ' ').trim() : '',
      /* 判别器：本体模块走 paintDownload（有 .dl-bar 工具条）；Mod / 存档模块带 .d-dl-links 页脚 */
      hasBar: !!body.querySelector('.dl-bar'),
      hasLinksFoot: !!body.querySelector('.d-dl-links'),
      svRows: body.querySelectorAll('.dl-sv-row').length,
      modRows: body.querySelectorAll('.d-dl-it').length,
      empty: !!body.querySelector('.dlpop-empty'),
      txt: (body.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90),
      overflow: body.scrollWidth - body.clientWidth,
    };
  });

  await p.evaluate(() => document.getElementById('dlBtn').click());
  await until(p, () => {
    const pop = document.getElementById('dlPop');
    return !!(pop && !pop.hidden && pop.classList.contains('on'));
  }, 8000);
  const s0 = await snap();

  chk('④ 点底部入口 → 弹窗打开', s0.open, JSON.stringify({ open: s0.open, title: s0.title }));
  chk('⑤ 页签条可见（4 个模块：本体 / Mod / 修改器 / 存档）',
    !s0.tabsHidden && s0.tabsVis && s0.names.length === 4,
    JSON.stringify({ hidden: s0.tabsHidden, vis: s0.tabsVis, names: s0.names }));
  chk('⑤b 四个模块的**顺序**是 本体 → Mod → 修改器 → 存档（顺序即用户读到的层级）',
    s0.dom.join(',') === 'body,mod,modifier,save', s0.dom.join(','));
  chk('⑤c ★ 页签条在正文**之上**（top 更小；放进滚动区就会随内容滚走）',
    s0.tabsTop >= 0 && s0.bodyTop >= 0 && s0.tabsTop < s0.bodyTop,
    `tabsTop=${s0.tabsTop} bodyTop=${s0.bodyTop}`);
  chk('⑥ 默认落在「本体」模块', s0.onKey === 'body' && /本体/.test(s0.onTxt),
    JSON.stringify({ onKey: s0.onKey, onTxt: s0.onTxt }));
  chk('⑥b 页签上的条数不是一律 0（未回来给「·」= 还不知道，回来才给数字）',
    s0.names.every((t) => /[·\d]/.test(t)), JSON.stringify(s0.names));
  chk('⑦ 弹窗正文无横向溢出', s0.overflow <= 0, `overflow=${s0.overflow}`);
  chk('⑦b 标题是游戏名（不是写死的「下载资源」）',
    s0.title.length > 0 && s0.title !== '下载资源', s0.title);

  /* ---- 切到 Mod：落点必须跟着点击走，且画布真的换了 ---- */
  const switchTo = async (k, ms = 12000) => {
    await p.evaluate((key) => {
      const b = document.querySelector('#dlModTabs .dlm[data-dlm="' + key + '"]');
      if (b) b.click();
    }, k);
    /* 等这个模块**渲染完**：出内容行 / 空态 / 出错三者之一，而不是只看 loading 没了 */
    await until(p, (key) => {
      const body = document.getElementById('dlBody');
      if (!body) return false;
      if (body.querySelector('.emu-loading')) return false;
      return !!(body.querySelector('.d-dl-it') || body.querySelector('.dl-sv-row')
        || body.querySelector('.dlpop-empty') || body.querySelector('.dl-note'));
    }, ms, 250, k);
    return snap();
  };

  const sMod = await switchTo('mod');
  chk('⑧ 点「Mod」→ 高亮真的移到 Mod 签上', sMod.onKey === 'mod',
    JSON.stringify({ onKey: sMod.onKey, onTxt: sMod.onTxt }));
  chk('⑧b ★ 画布真的换了模块：Mod 模块自己的页脚在（.d-dl-links）',
    sMod.hasLinksFoot, JSON.stringify({ hasLinksFoot: sMod.hasLinksFoot, txt: sMod.txt }));
  chk('⑧c ★ 本体模块的工具条（.dl-bar）已不在 —— 证明不是「同一个画布换了高亮」',
    !sMod.hasBar, `hasBar=${sMod.hasBar} txt=${sMod.txt}`);
  chk('⑧d Mod 模块给出的是帖子行或明确的空态说明（不许是空白）',
    sMod.modRows > 0 || sMod.empty, `rows=${sMod.modRows} empty=${sMod.empty} txt=${sMod.txt}`);

  const sMf = await switchTo('modifier');
  chk('⑨ 点「修改器」→ 高亮移到修改器签', sMf.onKey === 'modifier', sMf.onTxt);
  chk('⑨b 修改器模块给出「风险提示」或帖子行（模块说明是用户决策要用的信息）',
    /修改器|训练器|风险|社区共|没有收录/.test(sMf.txt) || sMf.modRows > 0,
    `txt=${sMf.txt}`);

  const sSv = await switchTo('save');
  chk('⑩ 点「存档」→ 高亮移到存档签', sSv.onKey === 'save', sSv.onTxt);
  chk('⑩b ★ 存档模块给的是「放哪」而不是「下什么」（路径行或明确的「清单里没记录」）',
    sSv.svRows > 0 || sSv.empty, `svRows=${sSv.svRows} empty=${sSv.empty} txt=${sSv.txt}`);
  chk('⑩c 若有路径行，则每条都配「复制」键（复制是这里唯一的动作）',
    sSv.svRows === 0 || (await p.evaluate(() =>
      document.querySelectorAll('#dlBody .dl-sv-row').length
      === document.querySelectorAll('#dlBody .dl-sv-row .dl-cp').length)),
    `rows=${sSv.svRows}`);

  await p.screenshot({ path: path.join(OUT, 'check-dluni-save.png') });

  /* 切回本体再看一眼（证明来回切不丢状态、也不重复炸） */
  const sBack = await switchTo('body', 25000);
  chk('⑪ 切回「本体」→ 高亮回到本体，且本体画布回来了',
    sBack.onKey === 'body' && (sBack.hasBar || sBack.empty || /没有|暂时|失败/.test(sBack.txt)),
    JSON.stringify({ onKey: sBack.onKey, hasBar: sBack.hasBar, txt: sBack.txt }));
  await p.screenshot({ path: path.join(OUT, 'check-dluni-body.png') });

  /* ============================================================
   * ⑧ 模块**内容**必须真的有（用户原始反馈就是内容问题）
   *
   * 用户原话：「比如 The Elder Scrolls V: Skyrim Special Edition，他有 Mod/存档等，
   *           但是在手机专区中点击查看游戏详情页并没有下载存档/修改器/Mod 等功能」。
   *   ⇒ 只证「入口可见」和「画布切换正确」都**不够**：旧实现入口就是被藏起来的，
   *     而藏起来的原因恰恰是「本体取不到数」。现在要证的是**内容真的在那里**。
   *
   * 判据不钉死具体数字（数据随每日同步变，钉死 = 每跑一次就得改一次），而是
   * **与后端对同一个检索串算出的数比** —— 这同时干掉了「前端另算一套统计」的可能。
   * ⚠️ 检索串必须逐字复刻 dlUniFetchMods 的拼法（id 优先，再 t，再 kind/limit），
   *    否则比的是两个不同的查询，会做成一条永远绿或永远红的假判据。
   * ============================================================ */
  console.log('\n=== ⑧ 模块内容与后端口径同源 ===');
  const exp = await p.evaluate(async () => {
    const b = document.getElementById('dlBtn');
    const q = async (kind) => {
      const qs = [];
      if (b.dataset.dlId) qs.push('id=' + encodeURIComponent(b.dataset.dlId));
      if (b.dataset.dlTitle) qs.push('t=' + encodeURIComponent(b.dataset.dlTitle));
      qs.push('kind=' + kind, 'limit=60');
      const j = await fetch('/api/mods/match?' + qs.join('&')).then((r) => r.json());
      return (j && j.count) || 0;
    };
    /* 修改器页签 = 社区帖 + GCM 第三方元数据（`dlUniFetchGcm`）—— 两个**不同来源**相加。
       ⚠️ 这里必须复刻 `t.length < 2` 那个短路，否则短标题下会算出一个前端根本不会发的请求。 */
    const t = b.dataset.dlTitle || '';
    let gcm = 0;
    if (t.trim().length >= 2) {
      try {
        const g = await fetch('/api/trainers/match?t=' + encodeURIComponent(t)).then((r) => r.json());
        gcm = ((g && g.items) || []).length;
      } catch (e) { gcm = 0; }
    }
    return { mod: await q('mod'), modifier: await q('modifier'), gcm };
  });
  console.log('  后端对同一检索串: mod=' + exp.mod
    + ' modifier(社区)=' + exp.modifier + ' + GCM=' + exp.gcm);

  chk('★★ Mod 页签条数 == 后端对**同一检索串**算出的数（不许前端另算一套）',
    sMod.cnts[1] === String(exp.mod), `页签「${sMod.cnts[1]}」 vs 后端 ${exp.mod}`);
  chk('★★ 后端有 Mod 时，Mod 模块**必须真的铺出行**（这条就是用户原始反馈的判据）',
    exp.mod === 0 ? sMod.modRows === 0 : sMod.modRows > 0,
    `后端 ${exp.mod} 条 / 页面 ${sMod.modRows} 行`);
  chk('★★ 修改器页签条数 == 社区帖 + GCM（两个来源相加，不是只取社区那一份）',
    sMf.cnts[2] === String(exp.modifier + exp.gcm),
    `页签「${sMf.cnts[2]}」 vs ${exp.modifier}+${exp.gcm}=${exp.modifier + exp.gcm}`);
  chk('★★ 后端有修改器时，修改器模块**必须真的铺出行**',
    (exp.modifier + exp.gcm) === 0 ? sMf.modRows === 0 : sMf.modRows > 0,
    `后端 ${exp.modifier + exp.gcm} 条 / 页面 ${sMf.modRows} 行`);

  /* ---- 关掉再开：状态不许残留（换游戏串台就是这么来的） ---- */
  await p.evaluate(() => document.querySelector('#dlPop [data-dl="close"]').click());
  await sleep(500);
  const closed = await p.evaluate(() => {
    const pop = document.getElementById('dlPop');
    const tabs = document.getElementById('dlModTabs');
    return { hidden: !!pop.hidden, tabsHidden: !!(tabs && tabs.hidden) };
  });
  chk('⑫ 关弹窗 → 弹窗收起，且页签条也一起收（不残留一条孤零零的页签）',
    closed.hidden && closed.tabsHidden, JSON.stringify(closed));

  await p.evaluate(() => document.getElementById('dlBtn').click());
  await until(p, () => {
    const pop = document.getElementById('dlPop');
    return !!(pop && !pop.hidden && pop.classList.contains('on'));
  }, 8000);
  const sRe = await snap();
  chk('⑬ 再点开 → 仍能打开、仍默认落在「本体」（状态没有跨会话残留）',
    sRe.open && sRe.onKey === 'body' && !sRe.tabsHidden,
    JSON.stringify({ open: sRe.open, onKey: sRe.onKey, tabsHidden: sRe.tabsHidden }));

  await p.evaluate(() => document.querySelector('#dlPop [data-dl="close"]').click());
  await sleep(400);

  /* ---- 详情页内联的「下载资源」块仍在（这条链路没被合并牵连） ---- */
  const slot = await p.evaluate(() => {
    const s = document.getElementById('dlSlot');
    if (!s) return { err: 'no #dlSlot' };
    const r = s.getBoundingClientRect();
    return { txt: (s.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60), h: Math.round(r.height) };
  });
  chk('⑭ ★ 详情页内联「下载资源」块仍在（合并弹窗不该把这条链路删掉）',
    !slot.err && slot.h > 0 && slot.txt.length > 0, JSON.stringify(slot));

  /* 底部动作区截图 */
  await p.evaluate(() => {
    const s = document.getElementById('dlStrip');
    s.scrollIntoView({ block: 'center' });
  });
  await sleep(700);
  await p.screenshot({ path: path.join(OUT, 'check-dlstrip.png') });

  console.log('\n============================');
  console.log(`  通过 ${pass}/${pass + fail}（失败 ${fail}）`);
  console.log('============================');
  await h.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
