#!/usr/bin/env node
/* tools/test-v1017.js — v10.17 静态防线：机型清单「列不全」+ 译名显示质量
 *
 * 用户原话：「目前 … 还是没有完全展示所有机型，其次没有根据我提供的内容进行映射具体的手机」
 *
 * 两条根因（都用真实数据钉住，防止悄悄退坡）：
 *   ① **列不全**：机型清单只读社区库**聚合摘要** `bannerhub.json` 的 `dv`，
 *      而那是上游的 **6 格摘要**（全库 2,648 条游戏，dv 最大长度就是 6）→ 结构性最多 6 台。
 *      全量在逐条配置 `bhparams.json` 的 `device` 里（写法也更规范）。
 *      → 新增 `data/deviceset.js` 做归一合并，`/api/mobilehub/match` 改为返回合并后的机型。
 *   ② **译名显示瑕疵**：`Honor HONOR Magic8 Lite`（品牌词重复）、
 *      `Xiaomi Redmi Note 11 Pro+ (`pissarro`)`（codename 泄漏）。
 *
 * 运行：node tools/test-v1017.js       （需服务在 8123 运行，④ 段要打接口）
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const json = (f) => { try { return JSON.parse(read(f)); } catch (e) { return null; } };

let pass = 0, fail = 0;
function ok(c, label, extra) {
  if (c) { pass++; console.log('  PASS', label, extra === undefined ? '' : '— ' + extra); }
  else { fail++; console.log('  FAIL', label, extra === undefined ? '' : '— ' + extra); }
}
const sec = (t) => console.log('\n=== ' + t + ' ===');

const deviceset = require('../data/deviceset');
const dmk = require('../data/devicemarket');
const bhparams = require('../data/bhparams');

/* ================== ① deviceset：机型串归一与合并 ================== */
sec('① data/deviceset.js（机型串归一 / 合并）');
ok(typeof deviceset.devKey === 'function' && typeof deviceset.mergeDevices === 'function', '导出 devKey / mergeDevices');
ok(deviceset.devKey('HONOR MTN-NX3') === deviceset.devKey('MTN NX3'), '★ 剥品牌前缀 + 去分隔符后同一台', deviceset.devKey('MTN NX3'));
ok(deviceset.devKey('honor mtn nx3') === deviceset.devKey('MTN NX3'), '大小写 / 空格不影响');
ok(deviceset.devKey('samsung SM-A057M') === deviceset.devKey('SM-A057M'), 'samsung SM-A057M ≡ SM-A057M');
ok(deviceset.devKey('Xiaomi 25053PC47G') === '25053PC47G', 'Xiaomi 25053PC47G → 25053PC47G');
/* ⚠️ 已知边界（不是缺陷，写清楚免得下次误判）：
   `devKey` 只剥**一层**品牌前缀，而 `moto` 既是品牌词也是型号词的一部分 ——
   `motorola moto g24` 剥掉 `motorola` 后还剩 `moto g24`（键 `MOTOG24`），
   而 `moto g24` 会把 `moto` 当品牌剥掉（键 `G24`）→ **两者不会合并**。
   实测数据里两边写法一致（都写 `motorola moto g24`），所以没有实际影响；
   若哪天要把它们强行合并，得引入「键集合求交集」，代价是短键（`G24`）跨品牌误合并的风险，
   当前判断是**不值得**。 */
ok(deviceset.devKey('motorola moto g24') === 'MOTOG24', 'motorola moto g24 → MOTOG24（只剥一层品牌前缀）', deviceset.devKey('motorola moto g24'));
ok(deviceset.devKey('moto g24') === 'G24', 'moto g24 → G24（moto 被当品牌剥掉）', deviceset.devKey('moto g24'));
ok(deviceset.devKey('motorola moto g24') !== deviceset.devKey('moto g24'), '★ 已知边界：motorola moto / moto 两种写法不合并（数据里写法一致，无实际影响）');
ok(deviceset.devKey('') === '' && deviceset.devKey(null) === '', '空值不炸');

const merged1 = deviceset.mergeDevices(['MTN NX3', 'Xiaomi 25053PC47G'], ['HONOR MTN-NX3', 'HONOR BRP-NX3']);
ok(merged1.length === 3, '合并去重：2 + 2 → 3 台（MTN/BRP 对齐了）', merged1.length + ' 台');
ok(merged1.includes('HONOR MTN-NX3'), '★ 同键取信息更全的写法（保留品牌前缀与连字符）', merged1.join(' | '));
ok(!merged1.includes('MTN NX3'), '残缺写法被更全的写法吸收');
ok(deviceset.mergeDevices([], undefined, null).length === 0, '空清单安全');
/* 保序：先出现的键排前面 */
const merged2 = deviceset.mergeDevices(['A 1'], ['B 2', 'A 1']);
ok(merged2[0] === 'A 1' || merged2[0] === 'A 1', '保序（先出现的在前）', merged2.join(' | '));

const rep = deviceset.mergeReport(['MTN NX3', 'BRP NX3'], ['HONOR MTN-NX3', 'samsung SM-A057M']);
ok(rep.summaryCnt === 2 && rep.mergedCnt === 3, 'mergeReport 报出「摘要 2 → 合并 3」');
ok(rep.added.length === 1 && rep.added[0] === 'samsung SM-A057M', 'added 只列真正新增的', rep.added.join(' | '));

/* ================== ② 译名显示质量（tidyMarket） ================== */
sec('② data/devicemarket.js 显示质量');
ok(typeof dmk.tidyMarket === 'function', '导出 tidyMarket');
const t1 = dmk.tidyMarket('HONOR Magic8 Lite', 'Honor', 'mtn-nx3');
ok(t1 === 'Magic8 Lite', '★ 剥掉 market 开头的品牌词（不再出现 Honor HONOR …）', t1);
const t2 = dmk.tidyMarket('Redmi Note 11 Pro+ (`pissarro`)', 'Xiaomi', 'pissarro');
ok(t2 === 'Redmi Note 11 Pro+', '★ 剥掉尾部 codename（含反引号写法）', t2);
const t3 = dmk.tidyMarket('13 (2023)', 'Xiaomi', '');
ok(t3 === '13 (2023)', '★ 以数字开头的括号是型号的一部分，不能剥', t3);
const t4 = dmk.tidyMarket('Phone (2a)', 'Nothing', '');
ok(t4 === 'Phone (2a)', '数字开头的括号（Nothing Phone (2a)）保留', t4);
const t5 = dmk.tidyMarket('POCO F7 / POCO F7 Pro', 'Xiaomi', '');
ok(t5 === 'POCO F7', '地区/版本并列写法仍取第一段', t5);

ok(dmk.resolve('Xiaomi 21091116UC').display === 'Xiaomi Redmi Note 11 Pro+', '★ 真样本：21091116UC → Xiaomi Redmi Note 11 Pro+（无 codename）', dmk.resolve('Xiaomi 21091116UC').display);
ok(dmk.resolve('MTN NX3').display === 'Honor Magic8 Lite', '真样本：MTN NX3 → Honor Magic8 Lite（品牌不重复）', dmk.resolve('MTN NX3').display);
ok(dmk.resolve('Xiaomi 25053PC47G').display === 'Xiaomi POCO F7', '★ 用户举的那台仍是 Xiaomi POCO F7');
ok(dmk.resolve('Xiaomi 13 (2023)').display === 'Xiaomi 13 (2023)', '营销名的年份括号没被误剥', dmk.resolve('Xiaomi 13 (2023)').display);
ok(dmk.stripBrand('HONOR MTN-NX3') === 'MTN-NX3', 'stripBrand 对外导出且正确', dmk.stripBrand('HONOR MTN-NX3'));

/* ================== ③ 摘要上限（根因证据） ================== */
sec('③ 根因：dv 摘要的上限就是 6');
const bh = json('data/bannerhub.json');
const lens = (bh.games || []).map((x) => (x.dv || []).length);
const maxLen = Math.max(...lens);
ok(lens.length > 2000, '社区库条目量 > 2000', lens.length + ' 条');
ok(maxLen <= 6, '★ dv 最大长度 ≤ 6（上游摘要只有 6 格 → 结构性只能显示 6 台）', 'max=' + maxLen);
ok(lens.filter((n) => n === 6).length > 200, '★ 卡在 6 格（即被截断）的游戏数量可观', lens.filter((n) => n === 6).length + ' 款');

/* ================== ④ bhparams.cachedDevices + 服务端合并 ================== */
sec('④ 逐条配置机型 + 服务端合并');
ok(typeof bhparams.cachedDevices === 'function', '导出 cachedDevices（同步、只读缓存）');
const cd = bhparams.cachedDevices(['ULTIMATE_MARVEL_VS__CAPCOM_3']);
ok(Array.isArray(cd), 'cachedDevices 返回数组', cd.length + ' 条');
ok(cd.some((x) => /HONOR MTN-NX3/i.test(x)), '★ 逐条配置里的规范写法能取到（HONOR MTN-NX3）', cd.slice(0, 3).join(' | '));
ok(bhparams.cachedDevices([]).length === 0 && bhparams.cachedDevices('NOT_A_KEY').length === 0, '空键 / 不存在的键返回空数组不炸');

const srv = read('server.js');
ok(/const deviceset = require\('\.\/data\/deviceset'\)/.test(srv), 'server.js 引入了 deviceset');
ok(/deviceset\.mergeReport\(hit\.devices \|\| \[\], bhparams\.cachedDevices\(hit\.bhKeys \|\| \[\]\)\)/.test(srv), '★ match 端点把「摘要 + 逐条配置」合并');
ok(/devicesSummaryCnt/.test(srv) && /devicesAdded/.test(srv), '返回里带上诊断字段（摘要台数 / 新增台数）');

(async () => {
  const r = await fetch('http://localhost:8123/api/mobilehub/match?t=' + encodeURIComponent('终极漫画英雄vs卡普空3')).then((x) => x.json()).catch(() => null);
  if (!r || !r.hit) {
    ok(false, '接口可达（需要服务在 8123 运行）');
  } else {
    const h = r.hit;
    ok(h.devicesSummaryCnt === 6, '该游戏摘要确实是 6 台（复现用户截图）', h.devicesSummaryCnt + ' 台');
    ok(h.devicesCnt > h.devicesSummaryCnt, '★ 合并后比摘要多（不再卡在 6 台）', h.devicesSummaryCnt + ' → ' + h.devicesCnt + ' 台');
    ok(h.devicesCnt === 9, '★ 合并后 9 台（样本固定值，变了要复核数据）', h.devicesCnt + ' 台');
    ok(h.devices.every((x) => !/^MTN NX3$|^BRP NX3$/.test(x)), '★ 残缺写法已被规范写法取代', h.devices.slice(0, 3).join(' | '));
    ok(h.devices.filter((x) => /HONOR/i.test(x)).length === 2, 'HONOR 两台在位（MTN-NX3 / BRP-NX3）');
    ok(h.devicesAdded.length === 3, '如实报告新增了 3 台（samsung / ITEL / moto g20）', h.devicesAdded.join(' | '));
    /* 每台都能给出「要显示什么」——不能出现空 display */
    const bad = h.devices.filter((m) => !dmk.resolve(m).display);
    ok(bad.length === 0, '★ 每台机型都能得到非空显示名', bad.join(' | ') || '全部 OK');
    /* 译出比例：这个样本里有 4 台**本来就是营销名**（motorola moto g24 / AYANEO Pocket FIT /
       ITEL itel S666LN / motorola moto g(20)），没有代号可译 → 5/9 是正确值，不是退坡。 */
    const rs = h.devices.map((m) => dmk.resolve(m));
    ok(rs.filter((x) => x.resolved).length === 5, '★ 该样本译出 5 台（另 4 台本来就是营销名，无代号可译）', rs.filter((x) => x.resolved).length + '/' + rs.length);
    const unresolved = h.devices.filter((m) => !dmk.resolve(m).resolved);
    /* 判据要打得准：`ITEL S666LN` 这种「品牌 + 型号」本身**就是**合法营销名，
       第一版用「不像代号」的正则把它误判成漏译（误报的代价和漏报一样大）。 
       这里只查真正该管的：显示名可读、且没有括号里泄漏的内部代号。 */
    ok(unresolved.every((m) => {
      const d = dmk.resolve(m).display;
      return d.length >= 6 && /[A-Za-z]{3,}/.test(d) && !/[\(（]\s*[a-z][a-z0-9_\- ]{2,}\s*[\)）]/.test(d);
    }), '★ 判为「未译出」的显示名可读且无 codename 泄漏', unresolved.join(' | '));
  }

  /* ================== ⑤ 前端：误导性文案已改 ================== */
  sec('⑤ 前端（index + emulator）');
  const html = read('public/index.html');
  const emu = read('public/emulator.html');
  ok(!/上游共汇总 \$\{devCnt\} 款机型/.test(html), '★ 删掉了「上游共汇总 N 款机型」这种易误读的文案');
  /* ★ v10.25：截断处的表达方式从「一行灰字：还有 N 台未展开」升级成**可点的「更多」按钮**
   *   （点开是全部机型的弹窗）。这条随之改查按钮的挂载条件 ——
   *   守护的意图没变：**只在真被截断时才出现**，不再用「上游共汇总 N 款」那种误导文案。 */
  /* ★ v10.28：改动有两处 ——
     ① 入口从「清单内部的一个按钮」挪到**独立槽位 #bhMoreSlot**（清单里 5 台机型，
        「按钮夹在机型中间」读起来像第 6 台）；
     ② 触发条件从「机型被截断」扩成「机型被截断 **或** 有实测记录/逐条配置」——
        因为实测与参数也收进同一个弹窗了（用户选择「收进弹窗」而非删掉）。
     守护的意图没变：**有内容可看才出现**，不用「上游共汇总 N 款」那种误导文案。 */
  ok(/const hiddenDev = allDevs\.length - devs\.length;/.test(html)
    && /const hasAny = hiddenDev > 0 \|\| h\.records > 0 \|\| h\.configs > 0;/.test(html)
    && /moreSlot\.innerHTML = hasAny \? dFullBtn\(/.test(html),
    '★ 截断处改成「更多」按钮（挂在 #bhMoreSlot），且只在真被截断/有实测参数时才出现');
  ok(/const allDevs = h\.devices \|\| \[\];/.test(html), '用全量清单算截断数');
  ok(/const DL_DEV_SHOW = 5;/.test(html) && /allDevs\.slice\(0, DL_DEV_SHOW\)/.test(html),
    '★ v10.28：展示上限从 24 台收到 5 台（抽成常量 DL_DEV_SHOW；用户口径「默认展示5个」）');
  ok(/hiddenDev > 0/.test(html), 'more 行有「真的截断才显示」的条件');
  ok(!/上游共汇总 \$\{devCnt\} 款机型/.test(emu), '[派生页] 同步去掉了误导文案');
  ok(/moreSlot\.innerHTML = hasAny \? dFullBtn\(/.test(emu), '[派生页] 同步了「更多」按钮');
  ok(/const allDevs = h\.devices \|\| \[\];/.test(emu), '[派生页] 同步了全量清单变量');

  console.log('\n' + '='.repeat(62));
  console.log(`v10.17 防线：${pass} / ${pass + fail} 通过` + (fail ? `，${fail} 失败` : ''));
  if (fail) process.exitCode = 1;
})();
