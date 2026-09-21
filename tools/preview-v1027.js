/* 实拍 + 交互验证：下载弹窗的「归帖 / 排序 / 盘口筛选 / 展开 / 切分区」（v10.27，v10.29 改写）
 *
 * 用户口径（v10.27）：「还需要优化下下载的弹窗」。
 *
 * ★ 这一版最要紧的一条断言是「**标题真的看得见、且一行一帖**」。
 *   改前两个病，症状完全不同、都不要脸地是绿的：
 *     ① 标题被 CSS 截掉 —— 6 条在屏幕上全显示成「【亲测可玩】…」，
 *        而 `textContent` 仍是完整一串 ⇒「文本里有版本号吗」这类断言**全程绿**。
 *        真正的判据是**布局**：scrollWidth/Height 有溢出 ⇒ 用户看不全。
 *     ② 一行一个网盘地址 —— 12 行其实只来自 4 个帖子，同一标题（只差一个盘口徽标）
 *        重复 5 遍 ⇒「有没有标题」也是绿的。判据是**行数 == 去重后的源帖数**。
 *
 * ★ 交互项（排序 / 筛选 / 展开 / 切分区）全部**驱动真实点击**再断言，
 *   不直接调内部函数 —— 走委托的那段线才是最容易被 innerHTML 重建冲掉的地方。
 *
 * ★★ v10.29 改写两段（这两段守的 UI 已经换掉了，旧断言会变成**假红**）：
 *   · 原「⑥ 展开全部 / 折叠」里的「点某块折叠区的 `.dl-tg` 展开它」——
 *     折叠语义已废（用户要求「分开显示」），改成**点分区签**切块。
 *   · 原「⑦ 锚点跳转（折叠的专区被锚点点到要展开并滚到位）」——
 *     同一条链路现在叫「切签」，另外它多了一件必做的事：**滚动位置归零**。
 *     ⚠️ 判「归零」之前必须先**证明真的滚动过**（scrollTop > 0），
 *        否则「切完是 0」在压根没滚动的情况下也成立 —— 典型的恒真断言。
 *   · 顺带把 `onTab` 改名成 `sortOn`：v10.29 起「tab」这个词专指分区签，
 *     排序按钮再叫 onTab 会让两次「tab」判据互相读错对象。
 */
const path = require('path');
const { connectBrowser, newPage, sleep } = require('./browser');

const OUT = path.join(__dirname, '..', '_test-out');
require('fs').mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const ok = (c, n, d) => { if (c) { pass++; console.log('  PASS  ' + n + (d ? '  — ' + d : '')); } else { fail++; console.log('  × FAIL  ' + n + (d ? '  — ' + d : '')); } };

const TID = 'https://jidiyouxi.com/topic/detail/171085167';   // 剑星：本体 29 帖 / mod 2 帖 / 修改器 2 帖

(async () => {
  const h = await connectBrowser();
  const p = await newPage(h.browser, { width: 1440, height: 1150 });
  try {
    await p.goto('http://localhost:8123/', { waitUntil: 'networkidle2', timeout: 60000 });

    await p.evaluate((u) => {
      window.__dl = new Promise((res) => {
        const t = setTimeout(() => res('timeout'), 60000);
        const w = setInterval(() => {
          if (document.querySelector('#dlBody .dl-bar') && document.querySelector('#dlBody .dl-sec .dl-it')) {
            clearInterval(w); clearTimeout(t); res('ok');
          }
        }, 300);
      });
      openDownload({ title: '剑星', url: u });
    }, TID);
    const st = await p.evaluate(() => window.__dl);
    ok(st === 'ok', '弹窗渲染出工具条与行', String(st));

    const snap = () => p.evaluate(() => {
      const secs = [...document.querySelectorAll('#dlBody .dl-sec')];
      const tabs = [...document.querySelectorAll('#dlBody .dl-bar .dl-an')];
      const cur = (tabs.find((x) => x.classList.contains('on')) || { dataset: {} }).dataset.dlGo || '';
      const body = document.getElementById('dlBody');
      const bb = body.getBoundingClientRect();
      return {
        w: Math.round(document.querySelector('.dlpop-box').getBoundingClientRect().width),
        barRows: document.querySelectorAll('.dl-bar .rw').length,
        anchors: [...document.querySelectorAll('.dl-bar [data-dl-go]')].map((x) => x.dataset.dlGo),
        sortTabs: [...document.querySelectorAll('.dl-bar [data-dl-sort]')].map((x) => x.dataset.dlSort),
        chips: [...document.querySelectorAll('.dl-bar [data-dl-filt]')].map((x) => x.dataset.dlFilt),
        sortOn: (document.querySelector('.dl-bar .dl-tab.on') || { dataset: {} }).dataset.dlSort,
        filtOn: (document.querySelector('.dl-bar .dl-chip.on') || { dataset: {} }).dataset.dlFilt,
        secTab: cur,
        secKeys: secs.map((s) => s.dataset.sec),
        /* ★ v10.29：非当前分区**必须零节点**（不是 .off 藏起来）——「分开显示」的硬判据 */
        otherSecNodes: [...document.querySelectorAll('#dlBody [data-sec]')]
          .filter((x) => x.classList.contains('dl-sec') && x.dataset.sec !== cur).length,
        secH: secs.map((s) => Math.round(s.getBoundingClientRect().height)),
        scrollTop: body.scrollTop,
        bodyH: Math.round(bb.height),
        /* ★ 只看**当前分区**里的行 —— 所有条目断言都打在它上面 */
        rows: [...document.querySelectorAll('#dlBody .dl-sec .l .dl-it')].map((r) => {
          const b = r.querySelector('.tx b');
          const cs = getComputedStyle(b);
          const src = r.querySelector('.mt a');
          return {
            t: b.textContent,
            /* 溢出量 >1px 就说明用户看不全这行文字 */
            ox: b.scrollWidth - b.clientWidth,
            oy: b.scrollHeight - b.clientHeight,
            clamp: String(cs.webkitLineClamp || cs.getPropertyValue('-webkit-line-clamp')),
            ws: cs.whiteSpace,
            meta: [...r.querySelectorAll('.mt i')].map((x) => x.textContent),
            lks: [...r.querySelectorAll('.acts a.lk')].map((x) => x.textContent),
            copy: r.querySelectorAll('.acts [data-dl-copy]').length,
            /* 源帖链接（/post/detail/<id>）—— 判「一行一帖」的钥匙 */
            purl: src ? src.href.replace(/\D+$/, '') : null,
          };
        }),
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });

    /* ---------- ① 布局与工具条 ---------- */
    let r = await snap();
    ok(r.w >= 700, '★ 弹窗已加宽（≥700px，改前 580）', r.w + 'px');
    ok(r.overflow <= 1, '★ 无横向溢出', String(r.overflow));
    ok(r.barRows === 2, '工具条两行（分区签+排序 / 盘口）', String(r.barRows));
    ok(r.anchors.join(',') === 'body,mod,modifier', '★ 三个分区签齐（本体 / mod / 修改器）', r.anchors.join(','));
    ok(r.sortTabs.join(',') === 'hot,new', '★ 有「最热 / 最近发布」两个排序', r.sortTabs.join(','));
    ok(r.sortOn === 'hot', '默认排序 = 最热（与源站话题页默认一致）', String(r.sortOn));
    ok(r.chips.length >= 2 && r.chips[0] === '', '★ 盘口筛选 chip 存在且第一项是「全部」', r.chips.join(' | '));
    ok(r.filtOn === '', '默认不筛选', String(r.filtOn));

    /* ---------- ② 默认视图：本体优先，且只有一块 ---------- */
    ok(r.secTab === 'body', '★ 默认停在「本体」（用户选的本体优先）', String(r.secTab));
    ok(r.secKeys.length === 1 && r.secKeys[0] === 'body',
      '★★ 正文只渲染一块（v10.29 改前：三块叠放，本体下面还压着 mod / 修改器）', r.secKeys.join(','));
    ok(r.otherSecNodes === 0, '★★ 非当前分区**零节点**（display:none 藏起来也会被读到，不算「分开」）',
      String(r.otherSecNodes));
    ok(r.secH[0] > 150, '★ 当前分区真占版面', r.secH[0] + 'px');

    /* ---------- ③ 条目：一行一帖 + 标题完整可见 ---------- */
    ok(r.rows.length === 12, '展开态默认铺 12 行（DL_CAP）', String(r.rows.length));
    const truncated = r.rows.filter((x) => x.ox > 1 || x.oy > 1);
    ok(truncated.length === 0,
      '★★ 前 12 行的标题**全部完整可见**（scrollWidth/Height 无溢出）—— 改前每条都被截成「【亲测可玩】…」',
      truncated.length ? truncated.slice(0, 2).map((x) => x.t.slice(0, 24) + ' [溢出 ' + x.ox + '/' + x.oy + ']').join(' ; ') : '0 条溢出');
    ok(r.rows[0].clamp === '2' && r.rows[0].ws === 'normal',
      '★ 标题容器是 2 行折行（-webkit-line-clamp:2）而不是 nowrap 单行省略',
      'clamp=' + r.rows[0].clamp + ' white-space=' + r.rows[0].ws);
    const urls = r.rows.map((x) => x.purl).filter(Boolean);
    ok(urls.length === r.rows.length && new Set(urls).size === r.rows.length,
      '★★ 12 行来自 **12 个不同的源帖**（一行一帖）—— 改前 12 行只来自 4 帖，同一标题重复 5 遍',
      '唯一源帖 ' + new Set(urls).size + ' / ' + urls.length);
    const longT = r.rows.filter((x) => x.t.length >= 20).length;
    ok(longT >= r.rows.length - 1, '每行标题都超过 20 字（不是被砍到只剩前缀）', longT + '/' + r.rows.length);
    const richMeta = r.rows.filter((x) => x.meta.length >= 3).length;
    ok(richMeta === r.rows.length, '★ 每行副信息 ≥3 格（作者 / 时间 / 浏览…）', richMeta + '/' + r.rows.length);
    ok(r.rows.every((x) => /(\d+ (分钟|小时|天)前)|月\d+日/.test(x.meta.join(' '))),
      '★ 副信息带可读的发布时间（不是时间戳）', r.rows[0].meta.join(' | '));
    ok(r.rows.every((x) => x.lks.length >= 1 && x.copy === 1),
      '★ 每行右侧挂着该帖的盘口按钮 + 一个复制（源站话题页就是这结构）',
      '首行盘口 ' + r.rows[0].lks.join('/') + '，复制 ' + r.rows[0].copy);
    const multi = r.rows.filter((x) => x.lks.length > 1).length;
    ok(multi > 0, '★ 有帖子带多个盘口（归帖真的把同帖的盘口并到一行了）', multi + ' 行是「一帖多盘口」');

    const hotOrder = r.rows.map((x) => x.t);
    await p.screenshot({ path: path.join(OUT, 'v1027-dlpop-default.png'), fullPage: true });

    /* ---------- ④ 排序：最热 → 最近发布（真实点击） ---------- */
    await p.evaluate(() => document.querySelector('.dl-bar [data-dl-sort="new"]').click());
    await sleep(250);
    let r2 = await snap();
    const newOrder = r2.rows.map((x) => x.t);
    ok(r2.sortOn === 'new', '★ 点「最近发布」后按钮态切过去', String(r2.sortOn));
    ok(newOrder.join('|') !== hotOrder.join('|'),
      '★★ 排序真的换了顺序（改前只有 hot 一套数据，切 new 只是同批重排 = 假开关）',
      '前 2 条 → ' + newOrder.slice(0, 2).map((t) => t.slice(0, 20)).join(' ; '));
    await p.evaluate(() => document.querySelector('.dl-bar [data-dl-sort="hot"]').click());
    await sleep(250);

    /* ---------- ⑤ 盘口筛选 ---------- */
    const chips = await p.evaluate(() => [...document.querySelectorAll('.dl-bar [data-dl-filt]')]
      .map((x) => ({ k: x.dataset.dlFilt, n: Number((x.textContent.match(/(\d+)\s*$/) || [])[1] || 0), label: x.textContent })));
    const pick = chips.find((c) => c.k === 'quark') || chips[1];
    await p.evaluate((k) => document.querySelector('.dl-bar [data-dl-filt="' + k + '"]').click(), pick.k);
    await sleep(250);
    let r3 = await snap();
    ok(r3.filtOn === pick.k, '★ 点盘口 chip 后筛选生效', String(r3.filtOn));
    ok(r3.rows.length > 0, '筛选后仍有条目', r3.rows.length + ' 行');
    ok(r3.rows.every((x) => x.lks.length === 1 && x.lks[0] === (pick.label.replace(/\d+$/, '').trim())),
      '★★ 选「' + pick.k + '」后每行只留该盘口按钮（不是把别的盘口也列出来）',
      [...new Set(r3.rows.map((x) => x.lks.join('/')))].join(' ; '));
    ok(pick.n === 0 || r3.rows.length <= Math.min(pick.n, 12) + 1,
      '筛选后的行数不超过 chip 上的帖数', r3.rows.length + ' 行 / chip 写 ' + pick.n);
    await p.screenshot({ path: path.join(OUT, 'v1027-dlpop-filter.png'), fullPage: true });
    await p.evaluate(() => document.querySelector('.dl-bar [data-dl-filt=""]').click());
    await sleep(250);

    /* ---------- ⑥ 展开全部 / 收起 ---------- */
    const before = (await snap()).rows.length;
    await p.evaluate(() => document.querySelector('#dlBody .dl-sec [data-dl-all]').click());
    await sleep(250);
    let r4 = await snap();
    ok(r4.rows.length > before && r4.rows.length > 12,
      '★ 点「展开全部」后行数真的涨上去了（数据本就在手上，不再发请求）', before + ' → ' + r4.rows.length);
    await p.evaluate(() => document.querySelector('#dlBody .dl-sec [data-dl-all]').click());
    await sleep(250);
    ok((await snap()).rows.length === 12, '再点一次收起，回到 12 行', String((await snap()).rows.length));

    /* ---------- ⑦ 切分区（★ v10.29 取代旧的「折叠 / 锚点跳转」） ---------- */
    /* ★ 第一步必须先「展开全部 + 真的滚下去」：不滚过就断言「切块后 scrollTop 归零」，
       在压根没滚动的情况下也成立 —— 恒真断言，永远发现不了「忘了归零」。
       展开到 29 行后内容高度足够，滚到 150 才真的滚得动。 */
    await p.evaluate(() => document.querySelector('#dlBody .dl-sec [data-dl-all]').click());
    await sleep(250);
    const scrolled = await p.evaluate(() => {
      const b = document.getElementById('dlBody');
      b.scrollTop = 150;
      return { top: b.scrollTop, h: b.scrollHeight, ch: b.clientHeight };
    });
    ok(scrolled.top > 0,
      '★ 前置判据：切分区之前真的滚动过（否则「切完归零」是恒真的）',
      'scrollTop=' + scrolled.top + ' 内容 ' + scrolled.h + ' / 视口 ' + scrolled.ch);

    await p.evaluate(() => {
      const t = [...document.querySelectorAll('#dlBody .dl-bar .dl-an')].find((x) => x.dataset.dlGo === 'mod');
      if (t) t.click();
    });
    await sleep(700);
    const r5 = await snap();
    ok(r5.secTab === 'mod', '★ 点「mod」签后按钮态切过去', String(r5.secTab));
    ok(r5.secKeys.length === 1 && r5.secKeys[0] === 'mod',
      '★★ 切块后正文只有 mod 一块（旧实现是「折叠起来但仍以标题行占位」）', r5.secKeys.join(','));
    ok(r5.rows.length > 0 && r5.rows.length <= 12, '★ mod 分区铺出了条目（不多于 DL_CAP）', r5.rows.length + ' 行');
    ok(r5.otherSecNodes === 0, '★ 切块后仍只有一块面板', String(r5.otherSecNodes));
    ok(r5.scrollTop === 0,
      '★★ 切块后滚动位置归零（停在上一块的滚动位置上，用户看到的是新分区中段，会误以为「这块只有这么几条」）',
      '切前 ' + scrolled.top + ' → 切后 ' + r5.scrollTop);
    ok(r5.rows.every((x) => x.ox <= 1 && x.oy <= 1), '★ 新分区的行同样不截断',
      String(r5.rows.filter((x) => x.ox > 1 || x.oy > 1).length) + ' 行溢出');

    /* 再切到「修改器」—— 它是最末一个分区，顺便钉「切过去是一条真链路」 */
    await p.evaluate(() => {
      const t = [...document.querySelectorAll('#dlBody .dl-bar .dl-an')].find((x) => x.dataset.dlGo === 'modifier');
      if (t) t.click();
    });
    await sleep(700);
    const jump = await p.evaluate(() => {
      const b = document.getElementById('dlBody');
      const s = document.querySelector('#dlBody .dl-sec');
      const br = b.getBoundingClientRect(), sr = s.getBoundingClientRect();
      const row = s.querySelector('.l .dl-it');
      const rr = row ? row.getBoundingClientRect() : null;
      return {
        key: s.dataset.sec,
        tab: (document.querySelector('#dlBody .dl-bar .dl-an.on') || { dataset: {} }).dataset.dlGo,
        rows: s.querySelectorAll('.l .dl-it').length,
        top: Math.round(sr.top - br.top),
        bottom: Math.round(sr.bottom - br.top),
        bodyH: Math.round(br.height),
        rowTop: rr ? Math.round(rr.top - br.top) : null,
        rowIn: rr ? (rr.top >= br.top - 2 && rr.bottom <= br.bottom + 2) : false,
        scrollTop: b.scrollTop,
      };
    });
    ok(jump.key === 'modifier' && jump.tab === 'modifier' && jump.rows > 0,
      '★ 切到「修改器」后该分区列出条目', JSON.stringify({ key: jump.key, tab: jump.tab, rows: jump.rows }));
    /* ★ 判据不能写成「top 必须 ≈ 0」：修改器是**最后一个**分区，视口装得下就直接贴顶，
       装不下时它的底部会落到视口外（用户仍能滚）。真正的用户诉求是
       「切过去后**这个分区的头部**就在视野里、没被 sticky 工具条挡住」。 */
    ok(jump.top >= -4 && jump.top <= 120,
      '★ 切块后该分区的头部就在视野里（没被 sticky 工具条挡在视口外）',
      'top=' + jump.top + ' bottom=' + jump.bottom + ' 视口高=' + jump.bodyH);
    ok(jump.rowIn, '★ 该分区的第一条就看得见', 'rowTop=' + jump.rowTop);
    await p.screenshot({ path: path.join(OUT, 'v1027-dlpop-tab-switch.png'), fullPage: true });

    console.log('  截图：_test-out/v1027-dlpop{,-default,-filter,-tab-switch}.png');
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
