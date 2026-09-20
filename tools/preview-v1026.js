/* 实拍：机地三专区在下载弹窗里的真实渲染（v10.26） */
const path = require('path');
const { connectBrowser, newPage } = require('./browser');

const OUT = path.join(__dirname, '..', '_test-out');
require('fs').mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const ok = (c, n, d) => { if (c) { pass++; console.log('  PASS  ' + n + (d ? '  — ' + d : '')); } else { fail++; console.log('  × FAIL  ' + n + (d ? '  — ' + d : '')); } };

(async () => {
  const h = await connectBrowser();
  const p = await newPage(h.browser, { width: 1440, height: 1100 });
  try {
    await p.goto('http://localhost:8123/', { waitUntil: 'networkidle2', timeout: 60000 });

    await p.evaluate(() => {
      window.__dl = new Promise((res) => {
        const t = setTimeout(() => res('timeout'), 45000);
        const w = setInterval(() => {
          const s = document.querySelector('.dl-secs .dl-sec');
          if (s) { clearInterval(w); clearTimeout(t); res('ok'); }
        }, 300);
      });
      openDownload({ title: '剑星', url: 'https://jidiyouxi.com/topic/detail/171085167' });
    });
    const st = await p.evaluate(() => window.__dl);
    ok(st === 'ok', '下载弹窗渲染出分区（.dl-secs .dl-sec 出现）', String(st));

    const r = await p.evaluate(() => {
      const secs = [...document.querySelectorAll('.dl-sec')];
      return {
        popVisible: !!document.querySelector('#dlPop:not([hidden])'),
        secCount: secs.length,
        names: secs.map((s) => (s.querySelector('.sh b') || {}).textContent || ''),
        counts: secs.map((s) => (s.querySelector('.sh .c') || {}).textContent || ''),
        rows: secs.map((s) => s.querySelectorAll('.l .dl-it').length),
        box: secs.map((s) => { const b = s.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; }),
        links: [...document.querySelectorAll('.dl-sec .dl-it a.act')].filter((a) => /^https:\/\/pan\./.test(a.href)).length,
        jidiBadges: document.querySelectorAll('.dl-grp > .h > .src.jidi').length,
        note: (document.querySelector('#dlBody .dl-note') || {}).textContent || '',
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        bodyText: (document.querySelector('#dlBody') || {}).textContent || '',
      };
    });

    ok(r.popVisible, '弹窗可见');
    ok(r.secCount === 3, '★ 恰好三个专区块（本体 / mod / 修改器）', String(r.secCount));
    ok(r.names.join(',') === '本体,mod,修改器', '★ 专区名与顺序正确', r.names.join(' / '));
    ok(r.rows.every((n) => n > 0), '★ 每个专区都真的列出了条目（区块在、0 条 = 字段没接上）', JSON.stringify(r.rows));
    ok(r.box.every(([w, hh]) => w > 0 && hh > 0), '★ 每个专区块真占版面', JSON.stringify(r.box));
    ok(r.links > 0, '★ 有可直接点开的网盘地址', String(r.links));
    ok(r.jidiBadges === 1, '「机地」源标签只出现一次（不是每专区各挂一个）', String(r.jidiBadges));
    ok(r.overflow <= 1, '★ 无横向溢出', String(r.overflow));
    ok(/\d+\s*帖/.test(r.counts.join(' ')), '★ 专区徽标写「N 帖」而不是「N 条」（帖 ≠ 网盘地址，混用会自相矛盾）', r.counts.join(' | '));

    const el = await p.$('#dlPop');
    if (el) await el.screenshot({ path: path.join(OUT, 'v1026-dlpop.png') });
    console.log('\n  弹窗内文（前 400 字）：\n    ' + r.bodyText.replace(/\s+/g, ' ').slice(0, 400));
    console.log('  截图：_test-out/v1026-dlpop.png');
  } catch (e) {
    fail++;
    console.log('  × FAIL  实拍异常：' + e.message);
  } finally {
    await h.close();
  }
  console.log('\n============================');
  console.log('  通过 ' + pass + '/' + (pass + fail) + '（失败 ' + fail + '）');
  console.log('============================');
  process.exit(fail ? 1 : 0);
})();
