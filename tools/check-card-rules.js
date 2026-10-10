#!/usr/bin/env node
/* tools/check-card-rules.js —— 卡片族 CSS「全量枚举」前置闸
 *
 * ★ 为什么必须有（2026-09-18 v10.30 实测踩到）：
 *   本轮统一卡片格式时，**同一文件并行编辑互相覆盖**，吞掉了 4 处改动；
 *   而剩下的 2 处断点（`.skeleton .sk-th` 112px / `.row-card .th` 96px）
 *   是「规则写了但没人核过」的漏网。当时是靠人肉逐条 `grep` 才发现的。
 *   ⇒ 断言套件只能守住**它已经知道的选择器**；一旦有人新加一条断点，
 *     套件仍然是绿的，但样式已经漂了。本闸反过来做：**先枚举实际规则体，再判合规**，
 *     所以它能发现「测试还不知道的那条断点」。
 *
 * 与 SUITES 的分工：本脚本不产断言条数、只产异常清单 ⇒ 归 PREFLIGHT（前置闸）。
 *
 * 两类判据：
 *   A. 「图片槽定高」   —— 卡片族里承载图片的槽位，必须靠 aspect-ratio 推高。
 *                        写死 `height:NNpx` ⇒ 比例随卡片宽度漂移（实测同族卡片
 *                        比例出现 1.571 与 1.879 两个值，观感就是「图片大小不统一」）。
 *   B. 「容器圆角硬编码」—— 卡片容器圆角必须来自 `--cd-r` / `--cd-th-r`。
 *                        ⚠️ 内部小徽标/按钮的圆角**本就该与卡片不同**，所以不是「一律禁止」，
 *                        而是维护一份**显式例外表**：表里没登记的硬编码圆角 = 疑似新增卡片容器 ⇒ 报错。
 *                        ★ 例外表还要**自检陈旧**：表里列了但代码里已不存在的选择器 = 垃圾 ⇒ 报错
 *                        （否则表会越积越长，最后没人敢动，「显式」就退化成「静默跳过」）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILES = [
  ['index.html', 'public/index.html'],
  ['emulator.html', 'public/emulator.html'],
  /* ★ v10.44：第 4 张派生页（端游资源）用的是**同一族卡片**（.emu-card /
   *   .cov / .noimg / .pill …），不纳入扫描就等于这类卡片有 1/4 没上闸。 */
  ['resources.html', 'public/resources.html'],
];

/* 卡片族选择器（判定「这条规则属不属于卡片」） */
const KEY = /\.(rel-it|x-it|row-card|sm-row|rk-card|rk-skel|sk-th|emu-card|skeleton)\b/;
/* 其中「承载图片的槽位」 */
const IMGSLOT = /\.(th|cov|sk-th)\b|^\.sm-row img|\.noimg|\.ph2/;

/* A 段例外：图片槽允许定高（必须写出理由 + 期望值，闸门会把期望值钉住）
 * ⚠️ 例外**按选择器登记，不按页面**：emulator.html 是 index.html 的派生页、共用同一份 CSS，
 *    按页面登记会强迫同一件事写两遍 —— 而「一个语义只留一种写法」是本项目铁律。
 *    陈旧自检只认**主源 index.html**（派生页是生成的，它没有 = 主源没了）。 */
const IMG_EXCEPT = [
  {
    sel: '.emu-card .cov', h: 92,
    why: '它是**顶部横幅封面**（卡片通栏、上边贴边），不是缩略图槽位。' +
         '套 16:9 会从 92px 涨到约 158px，把卡片从「一行三张」挤成两行 —— 观感退化，不是统一。' +
         '★ 这个例外必须「显式」：写在表里，评审能看见；写进正则排除，就成了静默跳过。',
  },
  {
    sel: '.emu-card.grp .cov', h: 78,
    why: '★ v10.47 组卡的顶部横幅。与上面那条**同源例外**（都是通栏封面、不是缩略图槽位），' +
         '但值不同：组卡的**主体信息在卡内列表**，封面只做识别用。' +
         '沿用 92px 会把每张卡再顶高 14px，一屏看不到两组。' +
         '⚠️ 别把这条合并进上面那条 —— 例外表是「一个有理由的具体值」，' +
         '合并就等于把「78 与 92 哪个对」这个问题藏起来。',
  },
];

/* B 段例外：允许硬编码圆角的选择器（卡片**内部**的小徽标 / 按钮 / 圆点，本就该与卡片不同） */
const RAD_EXCEPT = new Set([
  '.emu-card .tg',            // 角标
  '.emu-card .lib .dot2',     // 圆点
  '.emu-card.has-cov .cov::after', // 封面上沿渐隐遮罩
  '.emu-card .cov-btn',       // 封面上的按钮
  '.emu-card .cfg-btn',       // ★ 闸门新增：配置入口小按钮（比卡片小一号）
  /* ★ v10.45：删掉两条陈旧例外（`.emu-card .paths .p i` / `.paths .p .cp`）——
     存档卡不再铺路径。
   * ★ v10.47：再删两条 —— `.emu-card .tr-go a`（旧修改器卡的「查看详情 →」浮出按钮）
   *   与 `.emu-card .sv-open`（旧存档卡的整宽按钮）。三个分区统一改「按游戏聚合卡」后，
   *   这两条在主源里都已无命中 ⇒ 闸门的**陈旧自检自己报出来**（实测：
   *   「例外表（圆角）已陈旧：… 在主源里没有命中 ⇒ 删掉这条」）。
   *   **例外随被例外的规则一起消失**，不留着当历史记录 ——
   *   留着的代价是下一个人以为旧卡面形态还在。 */
  /* ★ v10.44 闸门新增：MOD 卡上的**盘口取件按钮**（迅雷/百度/夸克…）。
   *   它是「卡片内部的小按钮」，与 .cov-btn / .cfg-btn 同类：比卡片小一号才是对的，
   *   走 --cd-r 会跟卡片同圆角、看起来像卡片里嵌了张小卡片。
   *   ⚠️ 这条选择器只出现在派生页 resources.html 的专属 CSS 里（主源没有）——
   *     例外表仍按选择器登记、不按页面，陈旧自检遍历全部受扫描页面。 */
  /* ★ v10.47 闸门**删除**了这条：`.emu-card.md .md-lk .lk`。
   *   MOD 区改成「按游戏聚合卡」后，盘口按钮改由 `.emu-card.grp .gl-lk a` 渲染
   *   （组卡样式在主源 index.html 里，三个分区共用），本选择器已无命中。
   *   这正是这张例外表该有的行为：**例外随被例外的规则一起消失**。 */
  /* ★ v10.47 闸门新增：组卡（.emu-card.grp）里的两类**卡内小元素**。
   *   与 .cov-btn / .cfg-btn 同类 —— 比卡片小一号才是对的；
   *   走 --cd-r 会跟卡片同圆角，看起来像卡片里嵌了张小卡片。
   *   · .gl-lk a  卡内条目行尾的**通道按钮**（直链 / 夸克 / 迅雷…）
   *   · .grp-more 「查看全部 N 条」整宽按钮（v10.48 前叫「展开全部」，行为已改开弹窗）
   *   ⚠️ 这两条只在**主源 index.html** 里（组卡 CSS 与卡片族同处一份），
   *      不像 .md-lk 那条只在派生页 —— 但例外表按选择器登记、不按页面，写法一致。 */
  '.emu-card.grp .gl-lk a',
  '.emu-card.grp .grp-more',
  /* ★ v10.50 闸门新增：组卡里的**原贴入口**两件小元素（与 .gl-lk a 同类）。
   *   · .gl-i.has-post  带正文的条目行 —— 圆角 7px 只服务于 hover 底色，
   *     它既不是卡片也不是缩略图；走 --cd-r 会让 hover 时那一行看起来像张独立的小卡。
   *   · .gl-lk button.po 行内「原贴」按钮 —— 与同排的通道按钮（.gl-lk a）**必须同圆角**，
   *     否则一排按钮里混两个圆角值，视觉上直接能看出来。 */
  '.emu-card.grp .gl-i.has-post',
  '.emu-card.grp .gl-lk button.po',
  /* ★ v10.48 闸门新增：`.grp-pop .emu-card.grp` —— 「查看全部」弹窗里的**全量列表容器**。
   *   它挂 `emu-card grp` 两个类是为了**复用卡内行样式**（.gl-i / .gl-lk a.bd-* 那 20 多条），
   *   但它的语义是**列表**不是卡 ⇒ 必须用一条重置把卡片语义抵消掉：
   *   `padding:0 / background:none / border:0 / border-radius:0`。
   *   圆角这里就是该是 0（列表没有外框），不能走 --cd-r —— 走后会画出四个圆角
   *   而容器本身没有边框和底色，看起来像被裁了一角。 */
  '.grp-pop .emu-card.grp',
  '.row-card .go',            // 行卡尾部箭头钮
  '.sm-row .go2',             // ★ 闸门新增：小行卡尾部箭头钮
  '.rel-row .rel-it .why',    // ★ 闸门新增：「为什么推荐」角标
  '.skeleton .sk-l1',         // 骨架条（假文字，比卡片小一号）
]);

/* ---------- CSS 规则抽取 ---------- */
/* ⚠️ 必须**先剥注释**：否则「块注释 + 紧跟的选择器」会被一并当成选择器，
   于是输出里冒出一堆「注释行 → 5px」的噪声，真结论被淹没。
   ★ 顺带一条同族坑：**块注释里不许出现闭合序列**（斜杠星 … 星斜杠）——
     写了就提前闭合，整个脚本连语法都过不了。本文件就是这么挂过一次的。
     与「模板字符串里不许出现反引号」是同一类错误：**分隔符本身不能出现在内容里**。 */
function rulesOf(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(clean))) {
    const sel = m[1].trim().replace(/\s+/g, ' ');
    if (sel.startsWith('@')) continue; // 媒体查询外壳本身没有 body
    out.push({ sel, body: m[2].trim() });
  }
  return out;
}

let problems = [];
let stat = { slots: 0, radVar: 0, radExcepted: 0, exceptUsed: new Set() };

for (const [tag, rel] of FILES) {
  const fp = path.join(ROOT, rel);
  if (!fs.existsSync(fp)) { problems.push(`${rel} 不存在（派生页要先跑 build-*.js）`); continue; }
  const html = fs.readFileSync(fp, 'utf8');
  const a = html.indexOf('<style'), b = html.indexOf('</style>');
  if (a < 0 || b < 0) { problems.push(`${rel} 找不到 <style>`); continue; }
  const rules = rulesOf(html.slice(a, b));

  for (const r of rules) {
    if (!KEY.test(r.sel)) continue;

    /* --- A. 图片槽定高 --- */
    if (IMGSLOT.test(r.sel)) {
      stat.slots++;
      const hm = r.body.match(/(?:^|;)\s*height:\s*(\d+(?:\.\d+)?)px/);
      const hasAR = /aspect-ratio:\s*var\(--th-ar\)/.test(r.body);
      if (hm && !hasAR) {
        const ex = IMG_EXCEPT.find((e) => e.sel === r.sel);
        if (!ex) {
          problems.push(`[${tag}] 图片槽定高且无 aspect-ratio：${r.sel}  height:${hm[1]}px\n` +
            `        ⇒ 改成 height:auto;aspect-ratio:var(--th-ar)（否则比例随卡片宽度漂移）`);
        } else {
          stat.exceptUsed.add(ex.sel);
          if (Number(hm[1]) !== ex.h) {
            problems.push(`[${tag}] 例外值漂了：${r.sel} 实测 height:${hm[1]}px，例外表登记的是 ${ex.h}px\n` +
              `        ⇒ 例外是「有理由的具体值」，不是「豁免这个选择器」；值变了要么改回，要么更新理由`);
          }
        }
      }
    }

    /* --- B. 容器圆角硬编码 --- */
    const rm = r.body.match(/(?:^|;)\s*border-radius:\s*([^;]+)/);
    if (rm) {
      const v = rm[1].trim();
      if (/var\(--cd-/.test(v)) stat.radVar++;
      else if (RAD_EXCEPT.has(r.sel)) { stat.radExcepted++; stat.exceptUsed.add('RAD|' + r.sel); }
      else {
        problems.push(`[${tag}] 卡片族容器圆角未走变量：${r.sel} → ${v}\n` +
          `        ⇒ 用 var(--cd-r)（卡片）或 var(--cd-th-r)（缩略图）；` +
          `确实该不同的（内部徽标/按钮）请登记进 RAD_EXCEPT 并写理由`);
      }
    }
  }
}

/* --- 例外表陈旧自检 ---
 * ⚠️ 只以**主源 index.html** 为准：派生页是生成的，它里面没有 ⇒ 主源也已经没了。
 *    若拿派生页也当判据，会出现「主源删了、派生页还没重建 ⇒ 这条不报陈旧」的假绿。 */
const MAIN = 'index.html';
for (const e of IMG_EXCEPT) {
  if (!stat.exceptUsed.has(e.sel)) problems.push(`例外表（图片槽）已陈旧：主源里找不到 ${e.sel} ⇒ 删掉这条`);
}
for (const sel of RAD_EXCEPT) {
  if (!stat.exceptUsed.has('RAD|' + sel)) problems.push(`例外表（圆角）已陈旧：${sel} 在主源里没有命中 ⇒ 删掉这条`);
}

console.log('卡片族规则枚举核对');
console.log(`  扫描 ${FILES.length} 页 · 图片槽 ${stat.slots} 条 · 圆角走变量 ${stat.radVar} 条 · 圆角显式例外 ${stat.radExcepted} 条`);
console.log(`  主源：${MAIN}（派生页共用同一份 CSS，例外按选择器登记、不按页面）`);
if (problems.length) {
  console.log(`\n✗ 发现 ${problems.length} 处不合规：`);
  problems.forEach((p) => console.log('  · ' + p));
  console.log('\n⇒ 卡片格式统一是「全站」承诺，漏一条断点就前功尽弃。');
  process.exit(1);
}
console.log('  ✅ 无定高图片槽、无未登记硬编码圆角、无陈旧例外');
process.exit(0);
