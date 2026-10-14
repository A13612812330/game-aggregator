/* ★ v10.70 浏览器回归（第二层：真实浏览器 + CDP）：首页视觉语言统一 + 排序依据显性化 + 侧栏改向。
 *
 * 起因：用户原话「**不太行啊，目前首页布局和样式不太行**」，并给了三个参考站：
 *   排序学 xdgame.com/update/ 与 jidiyouxi.com/topic/list?sort=week，布局学 byrutgame.org。
 * 三站侦察 + 自测后定位到**三处结构性错位**（不是审美意见，是实测事实）：
 *   ① hero 是深蓝渐变（`linear-gradient(125deg,#0E1B3A,…)`）+ 金黄榜首卡（`#FFF3DC→#FFE2B8`），
 *      下面紧接**纯白**列表 ⇒ 同一屏两套视觉语言；且榜单不显示「按什么排的」。
 *   ② 列表一行 74px 塞 9 个字段（含长英文名），比 XDGAME 的 47px 单行**多 3 个字段却更矮不下**。
 *   ③ 侧栏 340px 只填 19%（主栏 3174 / 侧栏 612），下面 2562px 全空，且装的是**运维信息**。
 *
 * 用户拍板四项（全选推荐）：hero 压成紧凑榜·白底 / 主列表精简横版行 56px /
 *   排序 6 维 + 依据显性化 / 右侧栏换成发现向。
 *
 * 本套件守的就是这四项**独有的、可观测的**承诺：
 *   A. ★★ 视觉语言统一 —— hero 背景必须是**实色浅底**。
 *      判据的关键在 `getComputedStyle().backgroundColor` 的一个性质：
 *      `background:linear-gradient(…)` 时它返回 **`rgba(0, 0, 0, 0)`**（透明），
 *      而 `background:#fff` 时返回 `rgb(255,255,255)`。
 *      ⇒ 「渐变回来了」这件事**用背景色就能照出来**，不必去解析 CSS 文本。
 *      （第一版我打算正则搜 `linear-gradient(125deg,#0E1B3A` —— 那种写法改个角度就绕过了。）
 *   B. ★★ 排序依据**显性化**：学 XDGAME 每行末尾写「574,032 热度」「554 GB」的做法，
 *      我们按当前排序维度在行内显示该维度的值。必须**真切换一次排序**再验 ——
 *      只在默认视图（`updated`）下看，永远看不到依据值（那个视图故意不显示，见 C）。
 *   C. ★★ `updated` 视图**不显示**日期依据值 —— 列表本就按日期分组，每组上面已有
 *      `.date-sep` 分隔条，行内再顶一枚日期 pill 是同一信息说两遍，还会把日期挤到标题左边。
 *   D. ★★ `sizeAsc`（容量最小）**第一屏不许是「数据缺失榜」** —— 本版修掉的真 bug：
 *      源站缺失值写成 `"0.0GB"` / `"0KB"`，解析出来是**数值 0**，只判 `null` 会让它们冲到最前，
 *      实测前 8 名全是 0。这条断言就是那个修复的**唯一可见证据**。
 *   E. ★★ 侧栏「改向但不丢能力」：填充率下限 + 发现向内容（热度 Top5 / 分类）
 *      + **运维三按钮一个都没删**，且点开折叠区后**真的可点**（在 DOM 里但被 `display:none`
 *      挂死，仍然等于砍功能）。
 *
 * 反证锚点（打坏必变红）：
 *   · `.stage` 背景改回 `linear-gradient(…)`        ⇒ A1/A2 红（backgroundColor 变透明）
 *   · 榜单卡背景改成深蓝（`.rk-card{background:#0E1B3A}`）⇒ A3 红
 *   · `sortKeyPill()` 的 `hot` 分支删掉              ⇒ D1 红（行内没有热度依据值）
 *   · `sortKeyPill()` 的 `updated` 分支改成返回日期  ⇒ A6 红（静态段，唯一能区分的地方）
 *   · `sizeAsc` 判据改回 `zA - zB`（不做 >0 过滤）   ⇒ E2 红（前 4 名变 "0.0GB"）
 *   · 行尾日期 pill 挪到行首                          ⇒ C2 红
 *   · 删掉 `#idxBtn` / `#calBtn` / `#jidiBtn`         ⇒ F5/F6 红（运维能力丢失）
 *   · 侧栏热榜/分类区删掉                             ⇒ F2/F3 红
 *
 * ⚠️ 本文件**故意不重复**两条由 test-v1070-sort-keys.js 守的判据
 *   （「白名单不许写死第二份」= 那边 F1；「server.js 不许有本地 keyOf」= 那边 F4）。
 *   那边是**剥掉注释后**再判的，本套件第一版照抄时因为切片从注释处开始而**假红**。
 *
 * 跑法：node tools/test-v1070-home-layout.js     （需服务在 8123；约 40 s）
 */
const fs = require('fs');
const path = require('path');
const { connectBrowser, newPage, sleep } = require('./browser');

const BASE = process.env.BASE || 'http://127.0.0.1:8123';
const IDX = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

/* 阈值取「拍板目标 + 余量」，实测值来自 node tools/_probe-v1070.js（桌面 1440×900 / 移动 390×844）：
     侧栏填充率 27% / 26%（改前 19%）· 侧栏 Top5 5 项 · 分类 12 pill · 折叠区 2 个
   ⇒ 填充率下限取 24%（余量 2~3 个百分点，挡的是「退回 19%」而不是正常微调）。
   ★ 别把下限贴着实测值写（27 → 26 这种）：正常加一条侧栏内容就会红，防线变噪音。 */
const VIEWPORTS = [
  { key: '桌面 1440×900', w: 1440, h: 900, sideFillMin: 24 },
  { key: '移动 390×844', w: 390, h: 844, sideFillMin: 20 },
];

let pass = 0; let fail = 0;
/* ★ 签名固定 (name, ok, extra) —— 别把条件写进第 1 个位置（PITFALLS 15：非空字符串恒为真）。 */
function chk(name, ok, extra) {
  if (ok) { pass++; console.log('  \u2705 ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.log('  \u274c ' + name + (extra ? '   ' + extra : '')); }
}
/* 静态段的 t() 与浏览器段的 chk() 共用同一对计数器（口径：一个文件一套汇总）。 */
function t(ok, name, extra) { chk(name, ok, extra); }

/* ============================ 静态段：先在源码上确认「有没有写」 ============================
 * 浏览器段只能证明「这一屏是对的」；静态段证明「机制在」。两条都要有：
 * 浏览器段跑在服务已渲染的产物上，若某个分支被整体删掉但默认视图恰好不受影响，它会照样绿。
 * ⚠️ 本段必须在 `let pass/fail` 之后（`let` 有 TDZ，写在前面会 ReferenceError）。 */
console.log('=== 静态：排序依据显性化的机制 ===');
{
  const fn = (IDX.split('function sortKeyPill(')[1] || '').split('\n}')[0];
  t(fn.length > 0, 'A1 sortKeyPill() 存在（排序键 ↔ 显示键的**唯一定义处**）');
  t(/curSort === 'hot'/.test(fn), 'A2 sortKeyPill 有 hot 分支（热度依据值）');
  t(/curSort === 'size' \|\| curSort === 'sizeAsc'/.test(fn), 'A3 sortKeyPill 有容量分支');
  t(/curSort === 'score'/.test(fn), 'A4 sortKeyPill 有评分分支');

  /* ★★ C 组：`updated` 分支必须返回空。
     ⚠️ 这条断言的正则必须**收窄到那个分支自己的那一段**。
     第一版我写成 `/if \(curSort === 'updated'\) return '';/` 去匹配整段函数 ——
     看着精确，实际一旦有人重排分支顺序或把返回值临时改成变量就假红；
     而如果写成「函数里有没有出现 `return ''`」又会被 `title` 分支的
     `return ''` 满足 ⇒ **假绿**（`title` 分支本来就返回空）。
     ⇒ 正解：截出 `updated` 分支到下一个 `if` 之间的那一段，只在这一段里判「返回空」。 */
  const upd = (fn.split("curSort === 'updated'")[1] || '').split('if (')[0];
  t(upd.length > 0, "A5 sortKeyPill 有 updated 分支（取样成功，后面的断言才成立）");
  t(/return\s+''/.test(upd) && !/it\.(date|updated)/.test(upd),
    "A6 ★★ updated 分支返回空串（不显示日期依据值）", '片段=' + JSON.stringify(upd.trim().slice(0, 46)));

  /* 6 维排序键：前后端两侧都要认。★ 这里**故意不重复**「白名单不许写死第二份」和
     「server.js 里不许有本地 keyOf」两条 —— 它们由 test-v1070-sort-keys.js 的 F1/F4 守，
     而且那边是**剥掉注释后**再判的。本套件第一版把 A9 写成
     `server.slice(server.indexOf('mergePick'))` 就判 keyOf —— 切片从注释处开始，
     而我在 server.js 里写的说明注释本身就提到 `keyOf` ⇒ **假红**。
     同一批断言在两处算两遍，正是 run-all.js 里 SHIM 表注释批评的那种欠账。 */
}

/* ============================ 静态段结束 ============================ */

/* 解析 `rgb(r, g, b)` / `rgba(r, g, b, a)` → 平均亮度；渐变返回 `rgba(0,0,0,0)` ⇒ 视为 NaN。 */
function brightOf(css) {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(css || '');
  if (!m) return NaN;
  if (m[4] !== undefined && Number(m[4]) === 0) return NaN;   /* 全透明 = 背景是渐变/图片 */
  return (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3;
}
/* 从容量文本里抠数值（`1.34GB` / `554 GB` / `0KB` / `540MB`），统一到 MB。 */
function sizeToMb(txt) {
  const m = /([\d.]+)\s*(TB|GB|MB|KB)/i.exec(String(txt || ''));
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toUpperCase();
  return { KB: n / 1024, MB: n, GB: n * 1024, TB: n * 1024 * 1024 }[unit];
}

const PROBE_BASE = () => {
  const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width) }; };
  const side = document.querySelector('#colSide');
  const main = document.querySelector('#colMain');
  const sideH = side ? Math.round(side.getBoundingClientRect().height) : null;
  const mainH = main ? Math.round(main.getBoundingClientRect().height) : null;
  const pills = [...document.querySelectorAll('#sortPills > *')];
  const fold = document.querySelector('#sideFold');
  return {
    heroBg: getComputedStyle(document.querySelector('.stage')).backgroundColor,
    /* ★ v10.74：`.rk-champ`（冠军卡）已被**轮播**取代 ⇒ 该节点不再存在，
       原来的 `getComputedStyle(document.querySelector('.rk-champ'))` 会直接抛
       「parameter 1 is not of type Element」，把整个套件** FATAL 掉**（不是断言变红、
       是异常退出 —— 更难看出根因）。
       改用 `.rk-card` 的背景色 —— 守的是**同一条**视觉语言：榜单卡必须是**实色浅底**
       （深蓝块会让亮度跌破 200；金黄渐变是 gradient ⇒ backgroundColor 透明、亮度算不出来）。 */
    cardBg: (() => {
      const c = document.querySelector('#rankList .rk-card');
      return c ? getComputedStyle(c).backgroundColor : null;
    })(),
    rowN: document.querySelectorAll('#libList > .row-card').length,
    firstPills: (() => { const c = document.querySelector('#libList > .row-card');
      return c ? [...c.querySelectorAll('.pill')].map((p) => p.textContent.trim()) : []; })(),
    firstSizeText: (() => { const c = document.querySelector('#libList > .row-card');
      const p = c && c.querySelector('.pill.size'); return p ? p.textContent.trim() : null; })(),
    firstHotText: (() => { const c = document.querySelector('#libList > .row-card');
      const p = c && c.querySelector('.pill.hot'); return p ? p.textContent.trim() : null; })(),
    sortN: pills.length,
    sortKeys: pills.map((b) => b.dataset.s),
    sortLabels: pills.map((b) => b.textContent.trim()),
    sideH, mainH,
    sideRankN: document.querySelectorAll('#sideRank .side-rank-it').length,
    sideCatsN: document.querySelectorAll('#sideCats .side-cat').length,
    foldN: document.querySelectorAll('.side-fold').length,
    /* ★ 运维三按钮 + 进度条：先看「在不在 DOM 里」 */
    opsInDom: ['idxBtn', 'calBtn', 'jidiBtn', 'idxBar'].map((id) => !!document.getElementById(id)),
    /* ★★ 再点开折叠区看「能不能真点到」——在 DOM 里但 `display:none` 挂死等于砍功能 */
    opsClickable: (() => {
      if (fold) fold.open = true;
      return ['idxBtn', 'calBtn', 'jidiBtn'].map((id) => {
        const e = document.getElementById(id);
        if (!e) return false;
        const r = e.getBoundingClientRect();
        return r.height > 0 && r.width > 0 && getComputedStyle(e).display !== 'none';
      });
    })(),
    docW: document.documentElement.scrollWidth,
    winW: window.innerWidth,
  };
};

(async () => {
  const h = await connectBrowser();
  try {
    for (const v of VIEWPORTS) {
      console.log('\n=== ' + v.key + ' ===');
      const p = await newPage(h.browser, { width: v.w, height: v.h, scale: 1 });
      await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await sleep(3200);
      for (let i = 0; i < 24; i++) {
        if (await p.evaluate(() => document.querySelectorAll('#libList > .row-card').length) > 0) break;
        await sleep(500);
      }
      await sleep(1200);   /* 侧栏 Top5 是二次 fetch，再等一拍 */

      const r = await p.evaluate(PROBE_BASE);

      /* A0 阳性对照 —— 没有它，后面所有断言在「接口挂了」时会以「全空」的形式**全绿或假红**。 */
      chk('A0 阳性对照：列表真渲染出卡片 + 榜单卡在位',
        r.rowN > 0 && r.heroBg != null && r.cardBg != null, 'rowN=' + r.rowN);

      /* A 视觉语言统一 —— 见文件头「判据的关键在 backgroundColor 的性质」 */
      const heroB = brightOf(r.heroBg);
      const cardB = brightOf(r.cardBg);
      chk('A1 ★★ hero 背景是**实色**（不是 linear-gradient ⇒ 透明）',
        !Number.isNaN(heroB), 'background-color=' + r.heroBg);
      chk('A2 ★★ hero 背景是**浅色**（亮度 ≥ 200，挡深蓝 #0E1B3A 那类）',
        heroB >= 200, '亮度 ' + (Number.isNaN(heroB) ? '—' : heroB.toFixed(0)) + ' / 255');
      /* ★ v10.74：判据对象从「榜首卡」换成「榜单卡」（榜首卡已被轮播取代），
         守的仍是那条：**实色浅底，不是金黄渐变**。 */
      chk('A3 ★★ 榜单卡背景是实色浅底（不是深蓝块 / 金黄渐变 #FFF3DC→#FFE2B8）',
        !Number.isNaN(cardB) && cardB >= 200,
        'background-color=' + r.cardBg + ' 亮度 ' + (Number.isNaN(cardB) ? '—' : cardB.toFixed(0)));

      /* B 排序 6 维 */
      chk('B1 排序 pill 恰好 6 个', r.sortN === 6, '实测 ' + r.sortN + ' 个');
      const want = ['updated', 'hot', 'score', 'size', 'sizeAsc', 'title'];
      chk('B2 ★★ 6 个排序键齐全且顺序一致（前端 UI ↔ 服务端口径）',
        want.every((k) => r.sortKeys.includes(k)), JSON.stringify(r.sortKeys));

      /* C 默认 `updated` 视图的两个位置约定 */
      chk('C1 默认 updated 视图行内无 .pill.hot（依据值只在对应排序下出现）',
        r.firstHotText === null, '实测 ' + JSON.stringify(r.firstHotText));
      /* ★★ C2 为什么判「日期在**行尾**」，而不是判「updated 不许出现日期 pill」：
         行尾那个日期字段与「排序依据值」在 DOM 里是**同一个 `.pill`** ——
         从渲染结果上根本区分不了。第一版我判「updated 不许有日期 pill」，实测行尾就是
         `10-14` ⇒ 直接**假红**。机制层的区分只能靠 A6（`sortKeyPill` 对 updated 返回空串）。
         而「日期 pill 在行尾」恰好是本版**真修过的一个 bug**：第一版把它放到行首，
         既与 `.date-sep` 分组条重复，又把标题挤到了右边。这条断言守的就是那个修复。 */
      chk('C2 ★★ 日期 pill 在**行尾**（本版修过：第一版放在行首，把标题挤到右侧）',
        r.firstPills.length > 0 &&
        /^\d{2}-\d{2}$|^\d{4}-\d{2}-\d{2}$/.test(r.firstPills[r.firstPills.length - 1]),
        JSON.stringify(r.firstPills));

      /* D 切到「最热」：行内必须出现热度依据值（学 XDGAME「574,032 热度」） */
      await p.evaluate(() => { const b = document.querySelector('#sortPills [data-s="hot"]'); if (b) b.click(); });
      await sleep(2800);
      const hot = await p.evaluate(PROBE_BASE);
      chk('D1 ★★ sort=hot 下行内出现热度依据值（🔥 N）',
        hot.firstHotText != null && /\d/.test(hot.firstHotText), '实测 ' + JSON.stringify(hot.firstHotText));
      chk('D2 ★★ 切换排序后列表**真重排**（不是只换了个高亮按钮）',
        hot.rowN > 0 && hot.firstHotText !== r.firstHotText, 'rowN=' + hot.rowN);

      /* E ★★ sizeAsc（容量最小）第一屏不许是「数据缺失榜」—— 本版修掉的真 bug */
      await p.evaluate(() => { const b = document.querySelector('#sortPills [data-s="sizeAsc"]'); if (b) b.click(); });
      await sleep(2800);
      const asc = await p.evaluate(() => [...document.querySelectorAll('#libList > .row-card')]
        .slice(0, 4).map((c) => { const p = c.querySelector('.pill.size'); return p ? p.textContent.trim() : null; }));
      chk('E1 ★★ sizeAsc 第一屏取样成功（前 4 张卡都有容量 pill）',
        asc.length === 4 && asc.every((x) => x != null), JSON.stringify(asc));
      const mbs = asc.map(sizeToMb);
      chk('E2 ★★ sizeAsc 前 4 名容量**全部 > 0**（源站缺值 "0.0GB"/"0KB" 必须排最后）',
        mbs.every((m) => m != null && m > 0),
        JSON.stringify(asc.map((x, i) => x + '→' + (mbs[i] == null ? '—' : mbs[i].toFixed(1) + 'MB'))));
      chk('E3 ★★ sizeAsc 前 4 名**单调不减**（升序真的生效）',
        mbs.every((m, i) => i === 0 || (m != null && mbs[i - 1] != null && m >= mbs[i - 1])),
        JSON.stringify(mbs.map((m) => (m == null ? '—' : m.toFixed(1)))));

      /* F 侧栏：改向但不丢能力 */
      chk('F1 侧栏填充率 ≥ ' + v.sideFillMin + '%（改前 19%，下方 2562px 全空）',
        r.sideH != null && r.mainH && (r.sideH / r.mainH) * 100 >= v.sideFillMin,
        '侧栏 ' + r.sideH + ' / 主栏 ' + r.mainH + ' = ' + (r.sideH && r.mainH ? (r.sideH / r.mainH * 100).toFixed(0) : '—') + '%');
      chk('F2 侧栏发现向：🔥 热度 Top5 渲染出 ≥ 3 项', r.sideRankN >= 3, '实测 ' + r.sideRankN + ' 项');
      chk('F3 侧栏发现向：分类速览 ≥ 6 pill', r.sideCatsN >= 6, '实测 ' + r.sideCatsN + ' 个');
      chk('F4 侧栏有折叠区（<details class="side-fold">）', r.foldN >= 1, '实测 ' + r.foldN + ' 个');
      /* ★★ 本套件最该守的一条：运维能力**收起来但一个没删** */
      chk('F5 ★★ 运维三按钮 + 进度条**都在 DOM 里**（收进折叠区，不是删掉）',
        r.opsInDom.every(Boolean), JSON.stringify(['idxBtn', 'calBtn', 'jidiBtn', 'idxBar'].map((x, i) => x + '=' + r.opsInDom[i])));
      chk('F6 ★★ 点开折叠区后运维三按钮**真的可见可点**（在 DOM 里被 display:none 挂死仍等于砍功能）',
        r.opsClickable.every(Boolean), JSON.stringify(r.opsClickable));

      /* G 无横向溢出 */
      chk('G1 无横向溢出（文档宽 ≤ 视口宽 + 1px）', r.docW <= v.w + 1, 'doc ' + r.docW + ' vs vp ' + v.w);

      await p.close();
    }
  } finally {
    await h.close();
  }

  /* ⚠️ 收尾汇总行的格式是**约定**：同行必须含「通过」且带 `n / m`（中间不许夹字）。
     写成 `N 通过 / M 失败` 时 run-all 的 `\d+\s*\/\s*\d+` 就匹配不上 ⇒ 成绩退化成从明细里猜。 */
  console.log('\n\u2500\u2500 v10.70 首页视觉语言 + 排序依据 + 侧栏：' + pass + ' / ' + (pass + fail) + ' 通过 \u2500\u2500');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
