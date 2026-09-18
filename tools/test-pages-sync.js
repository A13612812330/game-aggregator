/* 派生页与主源的同步防线（v10.20 新增）
 *
 * 本项目的结构是「单源派生」：
 *   public/index.html   主源：CSS / 顶栏 / 遮罩 / 通用脚本的唯一编辑入口
 *   public/emulator.html ← tools/build-emulator-page.js 生成
 *   public/unpack.html   ← tools/build-unpack-page.js   生成
 *
 * ★ 为什么必须有这个测试：
 *   「改了主源却忘了重建派生页」在本项目是**最容易发生、也最难发现**的错误 ——
 *   派生页不会报错，只是样式慢慢漂移、顶栏少一个入口、新脚本没生效，
 *   而首页看起来完全正常。历史上已因此出过「派生页顶栏首页是死锚点」等问题。
 *   这里用「主源 CSS/脚本的尾部特征是否出现在派生页里」来判定是否落后。
 *
 * 纯静态、无网络、无需服务。
 */
const fs = require('fs');
const path = require('path');
const A = require('./page-assets');

const ROOT = path.join(__dirname, '..');
const flat = (s) => String(s).replace(/\s+/g, '');
/* CSS 是**原样复制**进派生页的（只在末尾追加专属样式），所以尾部指纹可靠：
   取尾部 120 个非空白字符，主源一变、没重建的派生页就对不上。 */
const tail = (s, n) => flat(s).slice(-n);
const CSS_TAIL = tail(A.CSS, 120);

/* 脚本不能用「尾部指纹」判同步：派生页的脚本是**有意被改写过的**
 * （摘掉 refreshRank/bindRankUI/renderSide 等首页专属初始化，替换手机专区跳转块），
 * 尾部正好落在被替换的区域里 —— 用指纹会 100% 误报。
 * 改为比对**函数清单**：主源里声明的每个函数，派生页都必须有；
 * 主源新增了函数而派生页没有，就是「忘了重建」。
 * SCRIPT_FOR_SCAN 已剔除「会被派生页整块替换」的跳转块，以及首页专属的几个渲染函数。 */
const FN_NAMES = [...new Set([...A.SCRIPT_FOR_SCAN.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]))]
  .filter((n) => ['refreshRank', 'bindRankUI', 'renderSide', 'renderCats', 'renderList'].indexOf(n) < 0);

let pass = 0, fail = 0;
const ok = (cond, name, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name + (detail ? '  — ' + detail : '')); }
  else { fail++; console.log('  × FAIL  ' + name + (detail ? '  — ' + detail : '')); }
};

const PAGES = [
  {
    file: 'public/emulator.html', name: '手机专区',
    own: ['id="emuTabs"', 'function switchEmuTab', 'function initEmu'],
  },
  {
    file: 'public/unpack.html', name: '解包匹配',
    own: ['id="upInput"', 'initUp()', 'window.initUp', 'id="upMatch"'],
  },
];

console.log('=== 派生页同步（改了主源就必须重建，否则样式/脚本会悄悄漂移）===');

for (const p of PAGES) {
  const fp = path.join(ROOT, p.file);
  if (!fs.existsSync(fp)) { ok(false, p.name + ' 存在', fp); continue; }
  const txt = fs.readFileSync(fp, 'utf8');
  const f = flat(txt);
  console.log('\n-- ' + p.name + '（' + p.file + '）--');

  /* ① 与主源同步：CSS 尾部指纹 + 脚本函数清单 */
  ok(f.includes(CSS_TAIL), '★ CSS 与主源同步（未落后）',
    f.includes(CSS_TAIL) ? '' : '主源 CSS 尾部已变 → 请重跑对应的 build-*.js');
  const missFn = FN_NAMES.filter((n) => !new RegExp('function\\s+' + n + '\\s*\\(').test(txt));
  ok(missFn.length === 0, '★ 通用脚本与主源同步（函数无缺失）',
    missFn.length ? '缺函数：' + missFn.join(', ') + ' → 请重跑对应的 build-*.js' : FN_NAMES.length + ' 个函数齐备');

  /* ② 顶栏三入口必须在（导航是共享资产，最容易漏） */
  ok(/id="navHome"/.test(txt) && /id="navEmu"/.test(txt) && /id="navUnpack"/.test(txt),
    '顶栏含三个入口（首页 / 手机专区 / 解包匹配）');
  ok(!/id="navHome"[^>]*href="#/.test(txt), '★ 顶栏「首页」是真链接而非死锚点（历史坑）');

  /* ③ 通用脚本的 DOM 依赖：搜索弹层缺了会整段脚本中断 */
  ok(/id="searchInput"/.test(txt), '含搜索弹层 #searchInput（通用脚本依赖）');
  ok(/id="mask"/.test(txt), '含遮罩 #mask');
  ok(/class="tabbar"/.test(txt), '含底部 Tab');

  /* ④ 残留检测：EMU_PAGE_HREF 只在主源声明，漏到派生页就是 ReferenceError */
  ok(!/EMU_PAGE_HREF/.test(txt), '★ 没有 EMU_PAGE_HREF 残留');

  /* ⑤ 派生页自己的关键节点 */
  for (const need of p.own) {
    ok(txt.indexOf(need) >= 0, '含自身节点：' + need);
  }
  /* 样式块完整（历史上出现过「CSS 落到 style 标签外，页面顶部糊一屏源码」） */
  ok(txt.indexOf('<style>') >= 0 && txt.indexOf('</style>') >= 0, '样式块完整');
}

console.log('\n============================');
/* ★ 末行必须是「通过 n/m」紧凑格式：tools/run-all.js 取最后一个 `n / m` 当成绩 */
console.log('  通过 ' + pass + '/' + (pass + fail) + '（失败 ' + fail + '）');
console.log('============================');
process.exit(fail ? 1 : 0);
