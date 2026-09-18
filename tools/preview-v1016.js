/* tools/preview-v1016.js —— v10.16 实拍：机型显示「品牌+型号」+ 点击看硬件参数
 *
 * 用户口径：「前端显示品牌+型号 如 Xiaomi 25053PC47G Snapdragon 8s Gen 4
 *            → 显示 xiaomi Poco F7，点击可以查看对应手机的硬件配置参数」。
 *
 * 方案：走 tools/browser.js（本机沙箱拦 Edge / puppeteer.launch，只能连 CDP 9222）。
 * 样本：看门狗 xd-233 —— 它的机型清单里就有 Xiaomi 25053PC47G（用户举的那台）。
 *
 * 检查项：
 *   ① 机型主行是「品牌 + 型号」而不是内部代号，代号降级到副行
 *   ② 门槛小结用的也是译出的型号名
 *   ③ 点击 → 就地展开硬件参数面板，章节 / 键值对**条数 > 0**（不是空壳）
 *   ④ 摘要里出现芯片组 / GPU（证明真的解析到了，不是只有壳）
 *   ⑤ 再点一次收起；点另一台会切换（不是越开越多）
 *   ⑥ 无横向溢出；派生页 emulator.html 同步
 */
const path = require('path');
const { launchBrowser, newPage, sleep } = require('./browser');

const BASE = process.env.BASE || 'http://127.0.0.1:8123/';
const OUT = path.join(__dirname, '..', '_preview');

let pass = 0, fail = 0;
const ok = (c, label, extra) => { if (c) { pass++; console.log('  PASS', label, extra === undefined ? '' : '— ' + extra); } else { fail++; console.log('  FAIL', label, extra === undefined ? '' : '— ' + extra); } };
const R = (v) => Math.round(v);

async function main() {
  const b = await launchBrowser();
  const p = await newPage(b, { width: 1440, height: 1100 });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await p.waitForSelector('#drawer', { timeout: 20000 });
  await sleep(900);

  console.log('\n=== ① 机型清单显示「品牌 + 型号」 ===');
  const devId = 'xd-233';   // 看门狗：机型清单含 Xiaomi 25053PC47G
  await p.evaluate((x) => window.openDetailById(x), devId);
  await p.waitForFunction(() => document.querySelectorAll('#bhDevSlot .dv[data-hw]').length > 0, { timeout: 45000 }).catch(() => {});
  await sleep(2500);

  const list = await p.evaluate(() => {
    const box = document.querySelector('#bhDevSlot .d-devlist');
    if (!box) return null;
    const items = [...box.querySelectorAll('.dv[data-hw]')].map((b) => ({
      name: (b.querySelector('.hd b') || {}).textContent || '',
      code: (b.querySelector('.sub s') || {}).textContent || '',
      chip: (b.querySelector('.sub i') || {}).textContent || '',
      hw: b.getAttribute('data-hw'),
      gate: b.classList.contains('gate'),
      w: Math.round(b.getBoundingClientRect().width),
      h: Math.round(b.getBoundingClientRect().height),
      docOverflow: box.scrollWidth > box.clientWidth + 1,
    }));
    const gateTxt = (document.querySelector('.bh-gate') || {}).innerText || '';
    return { items, gateTxt: gateTxt.replace(/\s+/g, ' ').trim(), boxW: Math.round(box.getBoundingClientRect().width) };
  });

  ok(!!list, '机型清单渲染出来了');
  ok(list && list.items.length > 0, '清单条数 > 0', list ? list.items.length + ' 台' : '-');
  if (list && list.items.length) {
    const withBrand = list.items.filter((x) => /^(Xiaomi|Samsung|Motorola|nubia|OPPO|vivo|Honor|Huawei|OnePlus|realme|Google|Sony|ASUS|Nokia|Nothing|ZTE|Lenovo|Meizu|TECNO|INFINIX)/i.test(x.name));
    ok(withBrand.length >= list.items.length * 0.5, '多数机型主行是「品牌 + 型号」', withBrand.length + '/' + list.items.length);
    const poco = list.items.find((x) => /25053PC47G/.test(x.code));
    ok(!!poco, '找到用户举的那台（代号 25053PC47G）', poco ? '主行=' + poco.name + ' 副行=' + poco.code : '未找到');
    ok(!!poco && /POCO F7/i.test(poco.name), '它显示成 Xiaomi POCO F7', poco ? poco.name : '-');
    ok(!!poco && poco.code === '25053PC47G', '代号降级到副行且剥掉了重复品牌前缀', poco ? poco.code : '-');
    const noCodeAsName = list.items.filter((x) => /^\d{4,}[A-Z0-9]+$/i.test(x.name)).length;
    ok(noCodeAsName === 0, '主行不再是纯内部代号', noCodeAsName + ' 台仍是代号');
    ok(!list.boxW || !list.items.some((x) => x.docOverflow), '机型清单无横向溢出');
    ok(list.items.every((x) => x.w > 60 && x.h > 20), '每台都真的占了版面', list.items.map((x) => x.w + '×' + x.h).slice(0, 3).join(' '));
    const g = list.items.find((x) => x.gate);
    ok(!!g, '门槛机型有标记');
    ok(!/^\s*(Xiaomi|SM)\s*\d{4,}/.test(list.gateTxt.replace(/^门槛\s*/, '')), '门槛小结没有拿内部代号当名字', list.gateTxt.slice(0, 90));
  }

  console.log('\n=== ② 点击 → 就地展开硬件参数 ===');
  const first = list && list.items.find((x) => /POCO F7/i.test(x.name));
  if (first) {
    await p.evaluate(() => {
      const b = [...document.querySelectorAll('#bhDevSlot .dv[data-hw]')].find((x) => /POCO F7/i.test(x.innerText));
      b.click();
    });
    await p.waitForFunction(() => {
      const s = document.getElementById('bhHwSlot');
      return s && s.querySelector('.d-hw') && !/正在从 kalvo 读取/.test(s.innerText);
    }, { timeout: 45000 }).catch(() => {});
    await sleep(1200);

    const hw = await p.evaluate(() => {
      const s = document.getElementById('bhHwSlot');
      const box = s && s.querySelector('.d-hw');
      if (!box) return null;
      return {
        title: ((box.querySelector('.hw-hd b') || {}).textContent || '').trim(),
        groups: box.querySelectorAll('.grp').length,
        rows: box.querySelectorAll('.kvs2 div').length,
        digest: [...box.querySelectorAll('.dg span')].map((x) => x.innerText.replace(/\s+/g, ' ').trim()),
        body: box.innerText.replace(/\s+/g, ' ').trim().slice(0, 220),
        w: Math.round(box.getBoundingClientRect().width),
        h: Math.round(box.getBoundingClientRect().height),
        overflow: box.scrollWidth > box.clientWidth + 1,
        btnOn: document.querySelectorAll('#bhDevSlot .dv.on').length,
        moreBtn: document.querySelectorAll('#bhHwSlot .hw-more').length,
      };
    });
    ok(!!hw, '硬件参数面板出现了');
    ok(hw && hw.groups > 0, '面板有章节（不是空壳）', hw ? hw.groups + ' 个章节' : '-');
    ok(hw && hw.rows > 10, '面板键值对条数 > 10', hw ? hw.rows + ' 行' : '-');
    ok(hw && hw.digest.some((d) => /芯片组/.test(d)), '摘要含「芯片组」', hw ? hw.digest.slice(0, 2).join(' | ') : '-');
    ok(hw && hw.digest.some((d) => /Snapdragon 8s Gen 4/.test(d)), '芯片组值是 Snapdragon 8s Gen 4', hw ? hw.digest[0] : '-');
    ok(hw && hw.digest.some((d) => /GPU|图形处理器/.test(d)), '摘要含 GPU');
    ok(hw && !hw.overflow, '参数面板无横向溢出', hw ? hw.w + '×' + hw.h : '-');
    ok(hw && hw.btnOn === 1, '同时只有一台处于展开态', hw ? hw.btnOn : '-');
    ok(hw && hw.h > 150, '面板真的占了版面', hw ? hw.h + 'px 高' : '-');
    ok(hw && hw.moreBtn >= 1, '长参数收进「展开全部」（默认只开核心几节）', hw ? '默认 ' + hw.groups + ' 节 / 还有按钮' : '-');
    ok(hw && hw.h < 1100, '默认高度受控（不是一屏滚不完）', hw ? hw.h + 'px' : '-');
    await p.screenshot({ path: path.join(OUT, 'v1016-hw-panel.png') });

    // 展开全部 → 可见章节变多（⚠️ 隐藏的节仍在 DOM 里，必须数**可见**的）
    const expanded = await p.evaluate(async () => {
      const btn = document.querySelector('#bhHwSlot .hw-more');
      if (!btn) return { skip: true };
      const vis = () => [...document.querySelectorAll('#bhHwSlot .grp')]
        .filter((g) => g.getBoundingClientRect().height > 0).length;
      const g0 = vis();
      btn.click();
      await new Promise((r) => setTimeout(r, 400));
      const g1 = vis();
      const box = document.querySelector('#bhHwSlot .hw-rest');
      const revealed = box && !box.hasAttribute('hidden');
      btn.click();
      await new Promise((r) => setTimeout(r, 400));
      const g2 = vis();
      return { g0, g1, g2, revealed };
    });
    if (!expanded.skip) {
      ok(expanded.g1 > expanded.g0, '点「展开全部」后可见章节变多', expanded.g0 + ' → ' + expanded.g1);
      ok(expanded.revealed, '被收起的章节真的显示出来了');
      ok(expanded.g2 === expanded.g0, '再点一次收回去', expanded.g1 + ' → ' + expanded.g2);
    }
  } else {
    ok(false, '没找到 POCO F7 那台，跳过点击测试');
  }

  console.log('\n=== ③ 再点收起 / 点另一台切换 ===');
  const before = await p.evaluate(() => document.getElementById('bhHwSlot').innerText.length);
  await p.evaluate(() => {
    const b = [...document.querySelectorAll('#bhDevSlot .dv[data-hw]')].find((x) => /POCO F7/i.test(x.innerText));
    b.click();
  });
  await sleep(700);
  const after = await p.evaluate(() => ({
    len: document.getElementById('bhHwSlot').innerText.length,
    on: document.querySelectorAll('#bhDevSlot .dv.on').length,
  }));
  ok(before > 100 && after.len < 100, '再点同一台会收起', before + ' → ' + after.len);
  ok(after.on === 0, '收起后没有残留的选中态', 'on=' + after.on);

  const swap = await p.evaluate(async () => {
    const bs = [...document.querySelectorAll('#bhDevSlot .dv[data-hw]')];
    if (bs.length < 2) return { skip: true };
    bs[0].click();
    await new Promise((r) => setTimeout(r, 900));
    bs[1].click();
    await new Promise((r) => setTimeout(r, 6000));
    return {
      on: document.querySelectorAll('#bhDevSlot .dv.on').length,
      panels: document.querySelectorAll('#bhHwSlot .d-hw').length,
      title: (document.querySelector('#bhHwSlot .hw-hd b') || {}).textContent || '',
    };
  });
  if (!swap.skip) {
    ok(swap.on === 1, '切换后仍只有一台展开', 'on=' + swap.on);
    ok(swap.panels === 1, '面板始终只有一个（不堆叠）', 'panels=' + swap.panels);
  }

  console.log('\n=== ④ 整页与派生页 ===');
  const pageOk = await p.evaluate(() => ({
    hOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    devRows: document.querySelectorAll('#bhDevSlot .dv[data-hw]').length,
  }));
  ok(!pageOk.hOverflow, '整页无横向溢出');
  ok(pageOk.devRows > 0, '机型清单仍在（切来切去没被清掉）', pageOk.devRows + ' 台');
  ok(errs.length === 0, '无 JS 报错', errs.slice(0, 2).join(' / ') || '(无)');

  // 派生页：**要先打开一款游戏**才会有 #bhHwSlot（它在抽屉模板里，不是常驻节点）
  const p2 = await newPage(b, { width: 1440, height: 1100 });
  const errs2 = [];
  p2.on('pageerror', (e) => errs2.push(e.message));
  await p2.goto(BASE + 'emulator.html', { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1200);
  await p2.evaluate((x) => window.openDetailById(x), devId);
  await p2.waitForFunction(() => document.querySelectorAll('#bhDevSlot .dv[data-hw]').length > 0, { timeout: 45000 }).catch(() => {});
  await sleep(2200);
  const emu = await p2.evaluate(() => ({
    hasHwSlot: !!document.getElementById('bhHwSlot'),
    hasHwSlotInTpl: true,
    hasDevList: document.querySelectorAll('#bhDevSlot .dv[data-hw]').length,
    hasFn: typeof window.toggleDevHardware === 'function',
    hasMoreFn: typeof window.hwToggleRest === 'function',
    firstName: (document.querySelector('#bhDevSlot .dv[data-hw] .hd b') || {}).textContent || '',
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));
  ok(emu.hasHwSlot, '[派生页] 打开游戏后有硬件参数插槽 #bhHwSlot');
  ok(emu.hasFn, '[派生页] 同步了 toggleDevHardware');
  ok(emu.hasMoreFn, '[派生页] 同步了 hwToggleRest');
  ok(emu.hasDevList > 0, '[派生页] 机型清单渲染出来了', emu.hasDevList + ' 台');
  ok(/[A-Za-z]{3,}/.test(emu.firstName) && !/^\d{4,}[A-Z0-9]+$/i.test(emu.firstName),
    '[派生页] 首台显示的是品牌+型号', emu.firstName);
  ok(!emu.overflow, '[派生页] 无横向溢出');
  ok(errs2.length === 0, '[派生页] 无 JS 报错', errs2.slice(0, 2).join(' / ') || '(无)');
  await p2.screenshot({ path: path.join(OUT, 'v1016-emulator.png') });

  console.log('\n=== ⑤ 手游专区「机型兼容」下拉也显示译名 ===');
  /* 这一段属于**懒加载分区**：不点「机型兼容」页签，`initDm()` 不跑、`#dmBrand` 里就没有 option
     （第一版漏了这步，报的是「#dmBrand 没有可选项」——不是功能坏，是测试没把分区激活）。
     所以先切页签，再等品牌下拉填充完。 */
  await p2.evaluate(() => {
    const t = document.querySelector('.emu-tab[data-et="dm"]');
    if (t) t.click();
  });
  await p2.waitForFunction(() => {
    const s = document.getElementById('dmBrand');
    return s && s.options.length > 3;
  }, { timeout: 20000 }).catch(() => {});
  await sleep(600);
  // 驱动真实 UI：选中一个品牌 → 触发 change → 读建议列表
  const sug = await p2.evaluate(async () => {
    const sel = document.getElementById('dmBrand');
    if (!sel) return { skip: true, why: '没找到 #dmBrand' };
    const opt = [...sel.options].find((o) => o.value && /小米|Redmi/i.test(o.value)) || [...sel.options].find((o) => o.value);
    if (!opt) return { skip: true, why: `#dmBrand 没有可选项（共 ${sel.options.length} 项）` };
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 2500));
    const items = [...document.querySelectorAll('.dm-sug-i')].map((b) => ({
      label: (b.querySelector('b') || {}).textContent || '',
      sub: (b.querySelector('span') || {}).textContent || '',
      m: b.getAttribute('data-m') || '',
    }));
    return { brand: opt.value, items: items.slice(0, 8), n: items.length };
  });
  if (sug.skip) {
    ok(false, '[派生页] 机型下拉可驱动', sug.why);
  } else {
    ok(sug.n > 0, '[派生页] 机型下拉列出了机型', sug.n + ' 条（品牌 ' + sug.brand + '）');
    const resolved = sug.items.filter((x) => /^(Xiaomi|Samsung|Motorola|nubia|OPPO|vivo|Honor|Huawei|OnePlus|realme|Google|Sony|ASUS|Nokia|Nothing|ZTE|Lenovo|Meizu|TECNO|INFINIX)/i.test(x.label));
    ok(resolved.length > 0, '[派生页] 下拉里显示的是「品牌 + 型号」', sug.items.map((x) => x.label).slice(0, 3).join(' | '));
    ok(sug.items.every((x) => x.m && x.m.length > 0), '[派生页] data-m 仍是原始机型名（查询键没被换成译名）', sug.items[0] ? sug.items[0].m : '-');
    ok(sug.items.some((x) => x.label !== x.m), '[派生页] 译名与原代号不同（真的译了，不是照抄）');
  }

  /* ⑤b 「输入即查」那条建议列表与品牌下拉是**两个独立的渲染分支**，必须分别验——
     v10.16 首版只改了品牌分支，输入即查漏改，铺出来还是内部代号。 */
  const typed = await p2.evaluate(async () => {
    const inp = document.getElementById('dmInput');
    if (!inp) return { skip: true, why: '没找到 #dmInput' };
    inp.value = '2412DPC0AG';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 2600));
    const items = [...document.querySelectorAll('.dm-sug-i')].map((b) => ({
      label: (b.querySelector('b') || {}).textContent || '',
      sub: (b.querySelector('span') || {}).textContent || '',
      m: b.getAttribute('data-m') || '',
    }));
    return { items: items.slice(0, 5), n: items.length };
  });
  if (typed.skip) {
    ok(false, '[派生页] 输入即查建议可驱动', typed.why);
  } else {
    ok(typed.n > 0, '[派生页] 输入代号能出建议', typed.n + ' 条');
    const raw = typed.items.filter((x) => /^[A-Za-z]*\s*\d{4,}[A-Z0-9]*$/i.test(x.label.trim())).length;
    ok(raw === 0, '[派生页] 输入即查的建议主行也是译名（不是内部代号）', typed.items.map((x) => x.label).slice(0, 3).join(' | '));
    ok(typed.items.some((x) => x.label !== x.m), '[派生页] 输入即查真的译了');
  }

  for (const pg of await b.pages()) { try { await pg.close(); } catch (e) {} }
  await b.close();

  console.log('\n' + '='.repeat(58));
  console.log(`实拍结果：${pass} / ${pass + fail} 通过` + (fail ? `，${fail} 失败` : ''));
  console.log('截图目录：' + OUT);
  if (fail) process.exitCode = 1;
}

main().catch((e) => { console.error('运行失败：', e.message); process.exit(1); });
