/* 实拍 + 交互验证：下载弹窗的「归帖 / 排序 / 盘口筛选 / 折叠 / 条目可辨识度」（v10.27）
 *
 * 用户口径：「还需要优化下下载的弹窗」。
 *
 * ★ 这一版最要紧的一条断言是「**标题真的看得见、且一行一帖**」。
 *   改前两个病，症状完全不同、都不要脸地是绿的：
 *     ① 标题被 CSS 截掉 —— 6 条在屏幕上全显示成「【亲测可玩】…」，
 *        而 `textContent` 仍是完整一串 ⇒「文本里有版本号吗」这类断言**全程绿**。
 *        真正的判据是**布局**：scrollWidth/Height 有溢出 ⇒ 用户看不全。
 *     ② 一行一个网盘地址 —— 12 行其实只来自 4 个帖子，同一标题（只差一个盘口徽标）
 *        重复 5 遍 ⇒「有没有标题」也是绿的。判据是**行数 == 去重后的源帖数**。
 *
 * ★ 交互项（排序 / 筛选 / 折叠 / 锚点）全部**驱动真实点击**再断言，
 *   不直接调内部函数 —— 走委托的那段线才是最容易被 innerHTML 重建冲掉的地方。
 */
const path = require('path');
const { connectBrowser, newPage } = require('./browser');

const OUT = path.join(__dirname, '..', '_test-out');
require('fs').mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const ok = (c, n, d) => { if (c) { pass++; console.log('  PASS  ' + n + (d ? '  — ' + d : '')); } else { fail++; console.log('  × FAIL  ' + n + (d ? '  — ' + d : '')); } };

const TID = 'https://jidiyouxi.com/topic/detail/171085167';   // 剑星：本体 22 帖 / mod 190 帖 / 修改器 4 帖

(async () => {
  const h = await connectBrowser();
  const p = await newPage(h.browser, { width: 1440, height: 1150 });
  try {
    await p.goto('http://localhost:8123/', { waitUntil: 'networkidle2', timeout: 60000 });

    await p.evaluate((u) => {
      window.__dl = new Promise((res) => {
        const t = setTimeout(() => res('timeout'), 60000);
        const w = setInterval(() => {
          if (document.querySelector('#dlBody .dl-bar') && document.querySelector('.dl-sec .dl-it')) {
            clearInterval(w); clearTimeout(t); res('ok');
          }
        }, 300);
      });
      openDownload({ title: '剑星', url: u });
    }, TID);
    const st = await p.evaluate(() => window.__dl);
    ok(st === 'ok', '弹窗渲染出工具条与行', String(st));

    const snap = () => p.evaluate(() => {
      const secs = [...document.querySelectorAll('.dl-sec')];
      const body = document.querySelector('#dlBody');
      const bb = body.getBoundingClientRect();
      return {
        w: Math.round(document.querySelector('.dlpop-box').getBoundingClientRect().width),
        barRows: document.querySelectorAll('.dl-bar .rw').length,
        anchors: [...document.querySelectorAll('.dl-bar [data-dl-go]')].map((x) => x.dataset.dlGo),
        tabs: [...document.querySelectorAll('.dl-bar [data-dl-sort]')].map((x) => x.dataset.dlSort),
        chips: [...document.querySelectorAll('.dl-bar [data-dl-filt]')].map((x) => x.dataset.dlFilt),
        onTab: (document.querySelector('.dl-bar .dl-tab.on') || { dataset: {} }).dataset.dlSort,
        onChip: (document.querySelector('.dl-bar .dl-chip.on') || { dataset: {} }).dataset.dlFilt,
        secs: secs.map((s) => ({
          key: s.dataset.sec,
          open: !s.classList.contains('off'),
          rows: s.querySelectorAll('.l .dl-it').length,
          h: Math.round(s.getBoundingClientRect().height),
        })),
        /* ★ 只看**当前展开**的区块里的行 —— 所有条目断言都打在它上面 */
        rows: [...document.querySelectorAll('.dl-sec:not(.off) .l .dl-it')].map((r) => {
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
        offDomRows: [...document.querySelectorAll('.dl-sec.off')].reduce((n, s) => n + s.querySelectorAll('.dl-it').length, 0),
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });

    /* ---------- ① 布局与工具条 ---------- */
    let r = await snap();
    ok(r.w >= 700, '★ 弹窗已加宽（≥700px，改前 580）', r.w + 'px');
    ok(r.overflow <= 1, '★ 无横向溢出', String(r.overflow));
    ok(r.barRows === 2, '工具条两行（锚点+排序 / 盘口）', String(r.barRows));
    ok(r.anchors.join(',') === 'body,mod,modifier', '★ 三个专区锚点齐（本体 / mod / 修改器）', r.anchors.join(','));
    ok(r.tabs.join(',') === 'hot,new', '★ 有「最热 / 最近发布」两个排序', r.tabs.join(','));
    ok(r.onTab === 'hot', '默认排序 = 最热（与源站话题页默认一致）', String(r.onTab));
    ok(r.chips.length >= 2 && r.chips[0] === '', '★ 盘口筛选 chip 存在且第一项是「全部」', r.chips.join(' | '));
    ok(r.onChip === '', '默认不筛选', String(r.onChip));

    /* ---------- ② 默认视图：本体优先 ---------- */
    const byKey = Object.fromEntries(r.secs.map((s) => [s.key, s]));
    ok(byKey.body && byKey.body.open === true, '★ 默认展开「本体」（用户选的本体优先）', JSON.stringify(byKey.body));
    ok(byKey.mod && byKey.mod.open === false && byKey.modifier.open === false,
      '★ mod / 修改器默认折叠', 'mod=' + byKey.mod.open + ' modifier=' + byKey.modifier.open);
    ok(byKey.body.h > 150, '★ 展开的区块真占版面', byKey.body.h + 'px');
    ok(byKey.mod.h > 0 && byKey.mod.h < 60, '折叠的区块只剩标题行（不是 0 高、也不是整块）', byKey.mod.h + 'px');
    ok(r.offDomRows === 0, '★★ 折叠区块里**没有任何行节点**（不渲染而非 display:none 藏起来）', String(r.offDomRows));

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
    await new Promise((s) => setTimeout(s, 250));
    let r2 = await snap();
    const newOrder = r2.rows.map((x) => x.t);
    ok(r2.onTab === 'new', '★ 点「最近发布」后按钮态切过去', String(r2.onTab));
    ok(newOrder.join('|') !== hotOrder.join('|'),
      '★★ 排序真的换了顺序（改前只有 hot 一套数据，切 new 只是同批重排 = 假开关）',
      '前 2 条 → ' + newOrder.slice(0, 2).map((t) => t.slice(0, 20)).join(' ; '));
    await p.evaluate(() => document.querySelector('.dl-bar [data-dl-sort="hot"]').click());
    await new Promise((s) => setTimeout(s, 250));

    /* ---------- ⑤ 盘口筛选 ---------- */
    const chips = await p.evaluate(() => [...document.querySelectorAll('.dl-bar [data-dl-filt]')]
      .map((x) => ({ k: x.dataset.dlFilt, n: Number((x.textContent.match(/(\d+)\s*$/) || [])[1] || 0), label: x.textContent })));
    const pick = chips.find((c) => c.k === 'quark') || chips[1];
    await p.evaluate((k) => document.querySelector('.dl-bar [data-dl-filt="' + k + '"]').click(), pick.k);
    await new Promise((s) => setTimeout(s, 250));
    let r3 = await snap();
    ok(r3.onChip === pick.k, '★ 点盘口 chip 后筛选生效', String(r3.onChip));
    ok(r3.rows.length > 0, '筛选后仍有条目', r3.rows.length + ' 行');
    ok(r3.rows.every((x) => x.lks.length === 1 && x.lks[0] === (pick.label.replace(/\d+$/, '').trim())),
      '★★ 选「' + pick.k + '」后每行只留该盘口按钮（不是把别的盘口也列出来）',
      [...new Set(r3.rows.map((x) => x.lks.join('/')))].join(' ; '));
    ok(pick.n === 0 || r3.rows.length <= Math.min(pick.n, 12) + 1,
      '筛选后的行数不超过 chip 上的帖数', r3.rows.length + ' 行 / chip 写 ' + pick.n);
    await p.screenshot({ path: path.join(OUT, 'v1027-dlpop-filter.png'), fullPage: true });
    await p.evaluate(() => document.querySelector('.dl-bar [data-dl-filt=""]').click());
    await new Promise((s) => setTimeout(s, 250));

    /* ---------- ⑥ 展开全部 / 折叠 ---------- */
    const before = (await snap()).rows.length;
    await p.evaluate(() => document.querySelector('.dl-sec [data-dl-all]').click());
    await new Promise((s) => setTimeout(s, 250));
    let r4 = await snap();
    ok(r4.rows.length > before && r4.rows.length > 12,
      '★ 点「展开全部」后行数真的涨上去了（数据本就在手上，不再发请求）', before + ' → ' + r4.rows.length);
    await p.evaluate(() => document.querySelector('.dl-sec [data-dl-all]').click());
    await new Promise((s) => setTimeout(s, 250));
    ok((await snap()).rows.length === 12, '再点一次收起，回到 12 行', String((await snap()).rows.length));

    ok((await snap()).secs.find((s) => s.key === 'mod').rows === 0, 'mod 折叠时 0 行', '');
    await p.evaluate(() => document.querySelector('.dl-sec[data-sec="mod"] .dl-tg').click());
    await new Promise((s) => setTimeout(s, 250));
    let r5 = await snap();
    ok(r5.secs.find((s) => s.key === 'mod').open === true && r5.secs.find((s) => s.key === 'mod').rows === 12,
      '★ 点 mod 的「展开」后该区块铺出 12 行', JSON.stringify(r5.secs.find((s) => s.key === 'mod')));

    /* ---------- ⑦ 锚点跳转（折叠的专区被锚点点到要展开并滚到位） ---------- */
    await p.evaluate(() => document.querySelector('.dl-bar [data-dl-go="modifier"]').click());
    await new Promise((s) => setTimeout(s, 350));
    const jump = await p.evaluate(() => {
      const b = document.querySelector('#dlBody');
      const s = document.querySelector('.dl-sec[data-sec="modifier"]');
      const br = b.getBoundingClientRect(), sr = s.getBoundingClientRect();
      const row = s.querySelector('.l .dl-it');
      const rr = row ? row.getBoundingClientRect() : null;
      return {
        open: !s.classList.contains('off'),
        rows: s.querySelectorAll('.l .dl-it').length,
        top: Math.round(sr.top - br.top),
        bottom: Math.round(sr.bottom - br.top),
        bodyH: Math.round(br.height),
        rowTop: rr ? Math.round(rr.top - br.top) : null,
        rowIn: rr ? (rr.top >= br.top - 2 && rr.bottom <= br.bottom + 2) : false,
      };
    });
    ok(jump.open && jump.rows > 0, '★ 锚点把折叠的「修改器」展开并列出条目', JSON.stringify(jump));
    /* ★ 判据不能写成「top 必须 ≈ 56」：修改器是**最后一个**专区，它下面没有内容了，
       滚到底时就停在那儿（top=331），这不是 bug。真正的用户诉求是
       「点了锚点，这个专区完整落在视野里、没被 sticky 工具条挡住」。 */
    ok(jump.top >= -4 && (jump.top <= 100 || jump.bottom <= jump.bodyH + 4),
      '★ 锚点后该专区完整落在视野里（滚不动时停在底部也算到位，只要没被工具条挡住）',
      'top=' + jump.top + ' bottom=' + jump.bottom + ' 视口高=' + jump.bodyH);
    ok(jump.rowIn, '★ 锚点后该专区的第一条就看得见', 'rowTop=' + jump.rowTop);

    const el = await p.$('#dlPop');
    if (el) await el.screenshot({ path: path.join(OUT, 'v1027-dlpop.png') });
    console.log('  截图：_test-out/v1027-dlpop{,-default,-filter}.png');
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
