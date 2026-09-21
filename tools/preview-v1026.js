/* 实拍：机地三专区「本体 / mod / 修改器」在下载弹窗里的结构与分区（v10.26 建立）
 *
 * ★ v10.27 起这个套件只守**结构**：三块齐、名字与顺序、徽标只挂一次、条数单位是「帖」。
 *   条目级的判据（一行一帖、标题不被截断、排序/筛选/展开）全部搬到
 *   `preview-v1027.js` —— 两边都写一遍，改一次要改两处（本项目踩过这个坑）。
 *
 * ★★ v10.29 重写：**折叠 → tab**。用户口径「就分开显示，而不是本体下面还有 Mod 或者修改器」。
 *   改前用「三块纵向叠放 + 各自可折叠」：即使只有本体展开，mod / 修改器仍以自己的
 *   标题行留在页面上 ⇒ 观感就是「本体下面还压着两个东西」。
 *   所以本套的核心判据从「三块都在、只展开一块」反转成「**只渲染一块，其余零节点**」：
 *     · 命中兜底（不是只查 `.off` 类）—— `display:none` 藏起来仍会被辅助技术读到、仍占 DOM，
 *       判「分开显示」必须判**节点不存在**。
 *     · 顺带钉住「折叠开关 `.dl-tg` 也已消失」—— 它一旦回来，「叠放」就会跟着回来。
 */
const path = require('path');
const { connectBrowser, newPage, sleep } = require('./browser');

const OUT = path.join(__dirname, '..', '_test-out');
require('fs').mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const ok = (c, n, d) => { if (c) { pass++; console.log('  PASS  ' + n + (d ? '  — ' + d : '')); } else { fail++; console.log('  × FAIL  ' + n + (d ? '  — ' + d : '')); } };

/* 剑星：本体 29 帖 / mod 2 帖 / 修改器 2 帖（实测），三个分区都有内容 ⇒ 切签测得到 */
const TID = 'https://jidiyouxi.com/topic/detail/171085167';

(async () => {
  const h = await connectBrowser();
  const p = await newPage(h.browser, { width: 1440, height: 1100 });
  try {
    await p.goto('http://localhost:8123/', { waitUntil: 'networkidle2', timeout: 60000 });

    await p.evaluate((u) => {
      window.__dl = new Promise((res) => {
        const t = setTimeout(() => res('timeout'), 45000);
        const w = setInterval(() => {
          /* ★ v10.29 的等待条件换成「签 + 行」：`.dl-secs .dl-sec` 已经不存在了，
             继续等它会让整个套件卡到 45 秒超时，然后被读成「功能坏了」。 */
          if (document.querySelector('#dlBody .dl-bar .dl-an') && document.querySelector('#dlBody .dl-sec .dl-it')) {
            clearInterval(w); clearTimeout(t); res('ok');
          }
        }, 300);
      });
      openDownload({ title: '剑星', url: u });
    }, TID);
    const st = await p.evaluate(() => window.__dl);
    ok(st === 'ok', '下载弹窗渲染出分区签与条目', String(st));

    const snap = () => p.evaluate(() => {
      const secs = [...document.querySelectorAll('#dlBody .dl-sec')];
      const tabs = [...document.querySelectorAll('#dlBody .dl-bar .dl-an')];
      /* ★ 当前分区只算**一次**并存下来：判据里重复展开同一个表达式时，
         少写一个 `.dataset` 就会变成 `(...).dlGo` ⇒ 恒为 undefined ⇒
         `'body' !== undefined` 恒真 ⇒ 判据红着，而人以为「真的多了节点」。
         实测踩到：写成 `}).dlGo` 而不是 `}).dataset.dlGo`，报出的值是 1（看着很像真问题）。 */
      const cur = (tabs.find((x) => x.classList.contains('on')) || { dataset: {} }).dataset.dlGo || '';
      const rows = [...document.querySelectorAll('#dlBody .dl-sec .l .dl-it')];
      const b = document.getElementById('dlBody');
      const r = b ? b.getBoundingClientRect() : { width: 0, height: 0 };
      return {
        popVisible: !!document.querySelector('#dlPop:not([hidden])'),
        secCount: secs.length,
        secKeys: secs.map((s) => s.dataset.sec),
        secNames: secs.map((s) => (s.querySelector('.sh b') || {}).textContent || ''),
        counts: secs.map((s) => (s.querySelector('.sh .c') || {}).textContent || ''),
        box: secs.map((s) => { const q = s.getBoundingClientRect(); return [Math.round(q.width), Math.round(q.height)]; }),
        tabKeys: tabs.map((x) => x.dataset.dlGo),
        tabNames: tabs.map((x) => x.textContent.replace(/\d+\s*$/, '').trim()),
        onTab: cur,
        secNodesAll: [...document.querySelectorAll('#dlBody [data-sec]')]
          .filter((x) => x.classList.contains('dl-sec')).map((x) => x.dataset.sec),
        /* ★ 不是当前分区的节点数 —— 「分开显示」的硬判据，必须为 0 */
        otherSecNodes: [...document.querySelectorAll('#dlBody [data-sec]')].filter((x) => x.classList.contains('dl-sec') && x.dataset.sec !== cur).length,
        /* ★ 折叠开关必须彻底消失（它回来了 = 叠放回来了） */
        tgNodes: document.querySelectorAll('#dlBody .dl-tg, #dlBody .dl-secs').length,
        rows: rows.length,
        links: rows.filter((x) => [...x.querySelectorAll('a.lk')].some((a) => /^https:\/\/pan\./.test(a.href))).length,
        scrollTop: b ? b.scrollTop : -1,
        bodyW: Math.round(r.width), bodyH: Math.round(r.height),
        note: (document.querySelector('#dlBody .dl-note') || {}).textContent || '',
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });

    /* ---------- ① 默认视图：只渲染「本体」一块 ---------- */
    let r = await snap();
    ok(r.popVisible, '弹窗可见');
    ok(r.tabKeys.join(',') === 'body,mod,modifier', '★ 分区签齐、顺序稳定（本体 / mod / 修改器）', r.tabKeys.join(','));
    ok(r.tabNames.join(',') === '本体,mod,修改器', '★ 签上的专区名与源站 folder_list 一致', r.tabNames.join(' / '));
    ok(r.onTab === 'body', '★ 默认停在「本体」（用户选的本体优先）', String(r.onTab));
    ok(r.secCount === 1, '★★ 正文**只渲染一块**面板（改前三块纵向叠放，观感是「本体下面还压着 Mod/修改器」）',
      r.secCount + ' 块：' + r.secKeys.join(','));
    ok(r.secKeys[0] === 'body' && r.secNames[0] === '本体', '当前面板就是「本体」', r.secKeys[0] + ' / ' + r.secNames[0]);
    ok(r.otherSecNodes === 0, '★★ 非当前分区**一个节点都不在 DOM 里**（不是 display:none 藏起来）',
      '当前=' + r.onTab + ' 面板节点=' + JSON.stringify(r.secNodesAll));
    ok(r.tgNodes === 0, '★ 折叠开关 `.dl-tg` / 叠放容器 `.dl-secs` 已彻底消失（回来了 = 叠放回来了）',
      String(r.tgNodes));
    ok(r.rows > 0, '★★ 当前分区真的列出了条目（区块在、0 条 = 字段没接上）', r.rows + ' 行');
    ok(r.box.every(([w, hh]) => w > 0 && hh > 0), '★ 面板真占版面', JSON.stringify(r.box));
    ok(r.links > 0, '★ 有可直接点开的网盘地址', String(r.links));
    ok(r.overflow <= 1, '★ 无横向溢出', String(r.overflow));
    ok(/\d+\s*帖/.test(r.counts.join(' ')), '★ 专区徽标写「N 帖」而不是「N 条」（帖 ≠ 网盘地址，混用会自相矛盾）', r.counts.join(' | '));
    ok(/个可直接打开的网盘地址/.test(r.note) && /个资源帖/.test(r.note),
      '★ 顶部说明同时给出「地址数」与「帖数」两个口径', r.note.slice(0, 60));
    await p.screenshot({ path: path.join(OUT, 'v1026-dlpop-tab-body.png'), fullPage: true });

    /* ---------- ② 切签：内容真的换，且旧面板真的消失 ---------- */
    await p.evaluate(() => { const b = document.getElementById('dlBody'); if (b) b.scrollTop = 120; });
    await p.evaluate(() => {
      const t = [...document.querySelectorAll('#dlBody .dl-bar .dl-an')].find((x) => x.dataset.dlGo === 'mod');
      if (t) t.click();
    });
    await sleep(600);
    const r2 = await snap();
    ok(r2.onTab === 'mod', '★ 点「mod」签后按钮态切过去', String(r2.onTab));
    ok(r2.secKeys.length === 1 && r2.secKeys[0] === 'mod',
      '★★ 切签后正文只剩 mod 一块，本体那块**从 DOM 里消失**（这才叫「分开显示」）', r2.secKeys.join(','));
    ok(r2.rows > 0, '★ mod 分区确实有内容（切过去是空页 = 看起来像「这个专区没资源」）', r2.rows + ' 行');
    ok(r2.otherSecNodes === 0, '★ 切块后仍然只有一块面板',
      '当前=' + r2.onTab + ' 面板节点=' + JSON.stringify(r2.secNodesAll));
    ok(r2.scrollTop === 0, '★ 切块后滚动位置归零（停在上一块的滚动位置上会看到新分区的中段，像丢数据）',
      'scrollTop=' + r2.scrollTop);
    await p.screenshot({ path: path.join(OUT, 'v1026-dlpop-tab-mod.png'), fullPage: true });

    /* ---------- ③ 切回本体：来回切不许把内容弄丢 ---------- */
    await p.evaluate(() => {
      const t = [...document.querySelectorAll('#dlBody .dl-bar .dl-an')].find((x) => x.dataset.dlGo === 'body');
      if (t) t.click();
    });
    await sleep(600);
    const r3 = await snap();
    ok(r3.onTab === 'body' && r3.secKeys[0] === 'body' && r3.rows > 0,
      '★ 能切回本体且条目还在（来回切不丢数据）', r3.onTab + ' · ' + r3.rows + ' 行');

    console.log('  截图：_test-out/v1026-dlpop-tab-{body,mod}.png');
  } catch (e) {
    fail++;
    console.log('  × FAIL  实拍异常：' + e.message + '\n' + String(e.stack || '').split('\n').slice(0, 4).join('\n'));
  } finally {
    await h.close();
  }
  console.log('\n============================');
  console.log('  通过 ' + pass + '/' + (pass + fail) + '（失败 ' + fail + '）');
  console.log('============================');
  process.exit(fail ? 1 : 0);
})();
