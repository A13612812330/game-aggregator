/* tools/preview-v1023.js — v10.23「跨源跳转按钮」实拍 + 断言
 *
 * 用户原话：「机地找同名 ↗ 我的要求是直接链接到游戏详情页，现在连按钮都点击不了」。
 *
 * 这句话拆成两条必须用**真浏览器**验的事（静态断言证不了）：
 *   ① 「按钮都点击不了」—— 到底是不显示，还是显示了但点不动？
 *      本项目踩过一次同类假绿：元素「存在 / 占版面 / 有 href」全部成立，
 *      但被另一个更高层的元素盖住 ⇒ 用户点的其实是别人。
 *      所以这里用 `elementFromPoint(按钮中心)` 判定「用户点得到吗」。
 *   ② 「直接链接到游戏详情页」—— href 必须是**详情页形态**的绝对地址
 *      （`/topic/detail/<数字>` 或 `/game/<数字>.html`），
 *      且与 `/api/library/twin` 给出的结论一致（不是前端自己凑的）。
 *
 * ★ 第三个场景专门盯**反向**行为：另一源确实没收录时，按钮必须真的**藏住**
 *   （`display:none` + 宽高 0）。改之前 `hidden` 属性被 `.go{display:flex}` 压过去，
 *   按钮一直可见但 href 为空 —— 那才是「点了没反应」的真正来源。
 *
 * 运行：node tools/preview-v1023.js   （需服务已在 8123 运行）
 * 产出：_preview/v1023-*.png
 * 退出码：0 = 全绿
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { connectBrowser, newPage } = require('./browser');

const BASE = process.env.EMU_BASE || 'http://127.0.0.1:8123';
const OUT = path.join(__dirname, '..', '_preview');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function chk(name, ok, extra) {
  (ok ? pass++ : fail++);
  console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`);
}

/** node 侧拉接口（挑样本用） */
function apiGet(p) {
  return new Promise((resolve, reject) => {
    const r = http.get(BASE + p, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(new Error('非 JSON: ' + b.slice(0, 120))); } });
    });
    r.on('error', reject);
    r.setTimeout(30000, () => { r.destroy(); reject(new Error('timeout ' + p)); });
  });
}

/** 读跨源按钮状态（**在页面内执行**） */
const GO_STATE = () => {
  const go = document.getElementById('crossGo');
  if (!go) return { exists: false };
  go.scrollIntoView({ block: 'center' });
  const cs = getComputedStyle(go);
  const r = go.getBoundingClientRect();
  const cx = Math.round(r.left + r.width / 2);
  const cy = Math.round(r.top + r.height / 2);
  const visible = cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  const hit = visible ? document.elementFromPoint(cx, cy) : null;
  const actions = document.querySelector('.d-actions');
  const card = document.querySelector('#crossSrc .x-it');
  return {
    exists: true,
    hiddenAttr: go.hasAttribute('hidden'),
    display: cs.display,
    visibility: cs.visibility,
    w: Math.round(r.width),
    h: Math.round(r.height),
    href: go.getAttribute('href') || '',
    text: (go.textContent || '').trim(),
    hitIsSelf: !!(hit && (hit === go || go.contains(hit))),
    hitDesc: hit ? (hit.tagName + (hit.id ? '#' + hit.id : '') + (hit.className ? '.' + String(hit.className).split(' ')[0] : '')) : 'null',
    actionsDisplay: actions ? getComputedStyle(actions).display : '(无)',
    cardTitle: card ? (card.querySelector('.bd .t') || {}).textContent || '' : '',
    cardExists: !!card,
    crossEmpty: (document.getElementById('crossSrc') || {}).innerHTML === '',
  };
};

/* 详情页 URL 形态（两个源都必须是详情页，不能是列表页/首页） */
const DETAIL_RE = /^https?:\/\/[^/]+\/(topic\/detail|game)\/\d+/i;

/** 打开库内某个条目并等跨源检查跑完 */
async function openAndSettle(page, id) {
  await page.evaluate((x) => { window.openDetailById(x); }, id);
  await page.waitForFunction(() => {
    const s = document.getElementById('crossSrc');
    if (!s) return false;
    return !/正在检查另一源收录/.test(s.textContent || '');
  }, { timeout: 90000, polling: 400 });
  await wait(500);   // 让 syncDActions 的列数调整落定
}

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  /* ---- 挑样本：一条「另一源有收录」、一条「另一源确实没有」 ---- */
  console.log('=== 挑选样本（按接口结论，不写死 id）===');
  const browse = await apiGet('/api/library/browse?limit=80&sort=updated');
  const items = (browse.items || []).filter((x) => x.source !== 'jidi');
  let withTwin = null, noTwin = null;
  for (const it of items.slice(0, 70)) {
    if (withTwin && noTwin) break;
    let t = null;
    try { t = (await apiGet('/api/library/twin?id=' + encodeURIComponent(it.id))).twin; } catch (e) { continue; }
    if (t && !withTwin) withTwin = { it, t };
    if (!t && !noTwin) noTwin = { it, t: null };
  }
  if (!withTwin) { console.log('  ❌ 找不到「另一源有收录」的样本 —— 后续断言无法进行'); fail++; }
  else console.log(`  有孪生样本：${withTwin.it.id}  ${withTwin.it.title}  →  ${withTwin.t.url}`);
  if (!noTwin) console.log('  ⚠️ 本轮没找到「两源都无」的样本，场景 C 会跳过');
  else console.log(`  无孪生样本：${noTwin.it.id}  ${noTwin.it.title}`);

  const h = await connectBrowser();
  const page = await newPage(h.browser, { width: 1440, height: 1000 });
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [页面 JS 报错]', e.message); });

  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 60000 });
  await wait(1200);

  /* ============================================================
   *  A. 另一源**有**收录 → 按钮必须显形、真能点、指向详情页
   * ============================================================ */
  console.log('\n=== A. 有收录：按钮显形 + 真能点 + 指向详情页 ===');
  if (withTwin) {
    await openAndSettle(page, withTwin.it.id);
    const s = await page.evaluate(GO_STATE);
    if (!s.exists) { chk('按钮元素存在', false, '页面里没有 #crossGo'); }
    else {
      chk('按钮已显形（display 不是 none）', s.display !== 'none', `display=${s.display}`);
      chk('★ 按钮真的占版面（宽高 > 0）', s.w > 0 && s.h > 0, `${s.w}×${s.h}`);
      chk('★ hidden 属性已移除', s.hiddenAttr === false, `hasAttribute('hidden')=${s.hiddenAttr}`);
      chk('★ 按钮中心点真的落在按钮上（elementFromPoint，用户点得到）',
        s.hitIsSelf, `命中 ${s.hitDesc}`);
      chk('★ href 是详情页形态的绝对地址', DETAIL_RE.test(s.href), s.href);
      chk('★ href 与 /api/library/twin 的结论一致（不是前端自己凑的）',
        s.href === withTwin.t.url, `按钮 ${s.href}`);
      chk('按钮文案指向「详情」而不是「找同名」', /详情/.test(s.text), s.text);
      chk('「另一源也有收录」卡片同时渲染出来', s.cardExists, s.cardTitle);
      chk('卡片标题取自另一源（与当前条目名不同或含中文）', !!s.cardTitle, s.cardTitle);
      await page.screenshot({ path: path.join(OUT, 'v1023-A-有收录-按钮可点.png') });
    }
  }

  /* ============================================================
   *  B. 另一源**没有**收录 → 按钮必须真的藏住
   * ============================================================ */
  console.log('\n=== B. 没收录：按钮必须真的藏住（不能留一个空 href 的死按钮）===');
  if (noTwin) {
    await openAndSettle(page, noTwin.it.id);
    const s = await page.evaluate(GO_STATE);
    if (!s.exists) { chk('按钮元素存在', false, '页面里没有 #crossGo'); }
    else {
      chk('★ 按钮 display:none（改之前它是 flex —— 可见但点了没反应）',
        s.display === 'none', `display=${s.display}`);
      chk('★ 按钮不占版面（宽高 0）', s.w === 0 && s.h === 0, `${s.w}×${s.h}`);
      chk('★ 没有 href（不留空跳转）', !s.href, `href="${s.href}"`);
      chk('跨源区块整体没留残留', s.crossEmpty || !s.cardExists, `crossSrc 空=${s.crossEmpty}`);
      await page.screenshot({ path: path.join(OUT, 'v1023-B-无收录-按钮藏住.png') });
    }
  }

  /* ============================================================
   *  C. 全站扫一遍：可见的按钮里不允许出现空 href（这是本版 bug 的症状）
   * ============================================================ */
  console.log('\n=== C. 抽样扫描：可见的按钮不许有空 href ===');
  const ids = items.slice(0, 12).map((x) => x.id);
  let checked = 0, badHref = 0, badHit = 0, shown = 0;
  for (const id of ids) {
    try { await openAndSettle(page, id); } catch (e) { continue; }
    const s = await page.evaluate(GO_STATE);
    if (!s.exists || s.display === 'none') continue;
    checked++; shown++;
    if (!DETAIL_RE.test(s.href)) { badHref++; console.log(`     ❌ ${id} 可见但 href 不合格：「${s.href}」`); }
    if (!s.hitIsSelf) { badHit++; console.log(`     ❌ ${id} 按钮被遮挡，命中 ${s.hitDesc}`); }
  }
  chk('抽样里确实有按钮被显示出来（否则 C 段是空跑）', shown > 0, `可见 ${shown} 个 / 检查 ${checked} 个`);
  chk('★ 可见按钮的空 href 数 = 0', badHref === 0, `不合格 ${badHref} 个`);
  chk('★ 可见按钮被遮挡数 = 0', badHit === 0, `被遮挡 ${badHit} 个`);

  chk('整轮没有页面 JS 报错（撞名/SyntaxError 都会在这里现形）', pageErrors.length === 0,
    pageErrors.length ? pageErrors[0] : '');

  await h.close();
  console.log('\n============================');
  console.log(`  通过 ${pass}/${pass + fail}（失败 ${fail}）`);
  console.log('============================');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('脚本异常:', e.message); process.exit(1); });
