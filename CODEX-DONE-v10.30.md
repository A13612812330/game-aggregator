# v10.30 —— 详情页「置顶不再闪」+ 全站卡片格式与图片尺寸统一

> 用户两条口径（原文）：
> ①「详情页往下拉的时候，置顶切换会一直闪（大小切换问题）」
> ②「我认为需要固定下统一的卡片格式以及图片大小，比如同类游戏以及链接标题等
> （多的字省略号即可，或者固定预留两行）」
>
> 用户二选一决策：① → **改成固定小标题条**；② → **固定预留两行**
>
> 基线 v10.29 · **✅ 已发布（2026-09-21）** —— LIVE `gamehub-agg-v4`，链接未变

---

## 一、① 置顶一直闪 —— 诊断（先量化，再动刀）

「一直闪」是主观描述，先把它变成一个**可复现的数字**。写了 `tools/_probe-v1030a.js`：
用 `MutationObserver` 监听 `.d-hero` 的 class，在旧阈值 90px 附近**来回滚 14 次**，数翻转次数。

| 量 | 实测（v10.29） |
|---|---|
| 旧阈值 90px 附近来回滚 14 次 → 翻转次数 | **21 次** |
| 越阈值时 `.d-hero` 高度 | `250px → 62px` |
| 越阈值时正文顶边额外位移 | **+188px** |

### ★ 真正的根因不是「阈值太小」，是**滚动锚定自激**

把高度写成边界值只是表象。实测：设 `dr.scrollTop = 200`，静置 700ms 后它**自己变成了 71**。
链条是：

```
.d-hero 从 250px 收到 62px
  ⇒ 文档矮了 188px
    ⇒ 浏览器为保住视觉位置，自动改写 scrollTop（-129）
      ⇒ 又越过阈值 ⇒ 再翻转 ⇒ 又改 scrollTop …
```

**不需要用户任何操作，它自己就会振。** 这解释了「一直闪」而不是「滚到某处闪一下」。
⇒ 只调阈值/加滞后带**修不掉这一层**，必须让**高度不再变化**。

### 中间帧采样：为什么观感是「抽一下」而不是「缩放」

在越阈值后 `+40ms` 采样：`.d-hero` 高度还是 `247.8px`（高度过渡才走了 2px），
而 `img filter` / `h2 font-size` / 标题位置 / `::after` 渐变**已经全部到位**。
⇒ 高度在慢慢过渡、里面内容瞬间切换 ⇒ 用户看到的是「抽一下」。

---

## 二、① 改法（用户选定：固定小标题条）

| | v10.29 | v10.30 |
|---|---|---|
| `.d-hero` | `position:sticky` + `transition:height` + `.d-hero.mini{height:62px}` | **`position:relative`，恒 `height:250px`，无 height 过渡** |
| 小标题条 | 无（就是大图自己收窄） | **新增 `.d-mini`**：`sticky;top:0` + **恒 62px** + `transform:translateY(-102%)` 滑入 |
| 开关判据 | `dr.scrollTop > 90`（单阈值） | **双阈值滞后**（`MINI_GAP=50`）+ **rAF 合帧** + 只在跨越时碰 DOM |
| 阈值来源 | 写死 90 | `Math.max(60, hero.offsetHeight - 62 + 12)` —— **跟着大图实际高度算** |

```css
.d-hero{position:relative;z-index:8;background:#101A38;height:250px;overflow:hidden}
.d-mini{position:sticky;top:0;z-index:7;display:flex;align-items:center;gap:9px;
  height:62px;margin-bottom:-62px;          /* ★ 负 margin：不占流 */
  opacity:0;visibility:hidden;transform:translateY(-102%);pointer-events:none}
.d-mini.on{opacity:1;visibility:visible;transform:translateY(0);pointer-events:auto}
```

```js
const MINI_GAP = 50;   // 双阈值之间的滞后带（专治触控板在临界点的手抖）
let miniPend = 0;
function dHeroSpy() {
  if (miniPend) return;
  miniPend = requestAnimationFrame(() => {
    miniPend = 0;
    const dr = $('#drawer'), h = $('#dMini'), hero = $('#dHero');
    if (!dr || !h || !hero) return;
    const y = dr.scrollTop;
    const on  = Math.max(60, hero.offsetHeight - 62 + 12);   // ← 跟实际高度走
    const off = Math.max(24, on - MINI_GAP);                 // ← 滞后带
    const cur = h.classList.contains('on');                  // ← DOM class 是唯一事实来源
    let next = cur;
    if (!cur && y > on) next = true;
    else if (cur && y < off) next = false;
    if (next === cur) return;                                // ← 没跨越 ⇒ 一个字节的 DOM 都不碰
    h.classList.toggle('on', next);
  });
}
```

**三个设计取舍（都写进了代码注释）**：

1. **`margin-bottom:-62px` 必须有** —— 不加，正文整体下移 62px（小条「占流」了）。
2. **状态读 DOM class、不另存模块变量** —— 抽屉是复用节点，`#dMini` 每次整块重建；
   读 class 才能天然复位。存变量会留下「上一款滚到一半、下一款打开还在收窄态」的错位。
3. **关闭键必须再给一份** —— 大图滚走时原关闭键跟着走了，没有它用户**关不掉抽屉**。
   已在 `test-v1030-cards.js` 里断言「关闭键在**小条模板内部**」（不是只调了一次给大图用）。

### 改造后实测（`preview-v1030.js`，真实浏览器 + 真实数据）

| 判据 | v10.29 | v10.30 |
|---|---|---|
| 旧阈值 90px 附近来回滚 14 次的翻转次数 | 21 | **0** |
| 新阈值 200px 附近来回滚 10 次的翻转次数 | — | **1**（只由静止态首次越过；滞后带内不再反复） |
| 越阈值时 `.d-hero` 高度变化 | −188px | **0px**（250 → 250） |
| 越阈值时正文额外位移 | +188px | **0px** |
| 高度恒定采样（0/120/210/320/600/1200） | 250→62 | **全部 250** |
| 滚动锚定：设 320 静置 1.4s 后的漂移 | 被改写 | **0** |
| 深滚（300/900/1500/1855）小条位置 | — | **全部 top=0，恒 62px** |

---

## 三、② 卡片格式与图片尺寸统一

### 统一的「一处定义」

新增 6 个 `:root` 变量（`test-v1030-cards.js` 断言每个**被引用 ≥3 处** —— 只定义不用 = 规范没生效）：

```css
--cd-r:12px;      /* 卡片圆角 */
--cd-th-r:9px;    /* 缩略图圆角 */
--cd-lh:1.4;      /* 卡片标题行高 */
--cd-t2:2.8em;    /* 标题「固定预留两行」的高度 = 2 × --cd-lh */
--th-ar:16 / 9;   /* 缩略图统一比例 */
--cd-s:106px;     /* 同类游戏小卡固定宽度 */
```

### 三个**真问题**（都是「删了没人发现」那种）

**1. `flex item` 的 `min-width:auto` 会被长标题撑开 —— 同一族量到两个宽度**

`.rel-it` 原来只写 `flex:0 0 106px`，内部标题带 `white-space:nowrap` 的长标题会把它撑开。
**实测同族 6 张卡量到 `106` 与 `123.2` 两个宽度** —— 这就是用户说的「卡片大小不统一」。
⇒ 修法：`flex-basis` + `min-width` + `max-width` **三重锁定**。

**2. 缩略图「定高不定比例」**

`width:100%;height:56px` 的宽高比会随卡片宽度漂移，**实测比例落在 1.571 ~ 1.879**。
⇒ 修法：`height:auto;aspect-ratio:var(--th-ar)` —— 高度由宽度推出，比例恒定。

**3. 只 `clamp` 不 `min-height` ⇒ 卡片不等高**

`-webkit-line-clamp:2` 只能「封顶」，不能让短标题占满两行 —— 短标题的卡片会矮一截。
⇒ 修法：`min-height:var(--cd-t2)`（= 2 × 行高）。**这才是「固定预留两行」的实现要害。**

### 改动后的实测对照（`preview-v1030.js`）

| 量 | 改造前 | 改造后 |
|---|---|---|
| 同类游戏卡宽度（6 张） | `106` 与 `123.2` 混用 | **唯一值 `[106]`** |
| 缩略图尺寸/比例 | 比例 1.571 ~ 1.879 | **88 × 49.5 · 唯一值 `1.778`** |
| 同类游戏卡**卡片高度** | 不等高 | **唯一值 `[121.7]`** |
| 卡片 / 缩略图圆角 | 11px / 9px 混杂硬编码 | **12px / 9px（全走变量）** |
| 标题行数 | 长标题被 nowrap 切一行 | **唯一值 `2`（clamp 2 + min-height 32.2 = 2 × 16.1）** |
| 跨源链接卡 | 646 × 37，标题单行截断 | **646 × 55，标题 `rows:2` + min-height 35** |

### 覆盖范围（不止用户点名的两族）

同类游戏卡 · 跨源链接卡 · 搜索结果卡 · 排行卡 · 搜索行 · 模拟器/修改器卡 ·
**骨架屏（3 处断点 + 容器圆角）**。骨架屏必须跟真卡片同比例、同圆角：
不同步会在「加载完成」的那一瞬**高度跳一截 / 圆角跳一档**。

**刻意保留的例外**（写进 `check-card-rules.js` 的显式例外表，含理由）：
`.emu-card .cov` 是**顶部横幅封面**（卡片通栏、上边贴边），不是缩略图槽位 ——
套 16:9 会从 92px 涨到约 158px，把卡片从「一行三张」挤成两行，那是退化不是统一。

---

## 四、验证（全部实测，不是形容词）

### 第一层 · 静态防线

```
前置闸：2 / 2 通过（check-inline-syntax.js + check-card-rules.js）
静态防线：30 套
通过 2046 / 失败 0
异常退出：无
```

新增 `tools/test-v1030-cards.js` **86 条**，已登记 `run-all.js` 的 `SUITES`（29 → **30 套**）。
同步改判据：`test-v1028-detail.js`（② 段整组换掉旧机制判据 · 128/128）、
`test-emulator-structure.js`（行缩略图比例）· `preview-v1028.js`（② 段改「高度全程不变」）。

### 第二层 · 浏览器实拍

| 套件 | 结果 |
|---|---|
| `preview-v1030.js`（新增） | **28 / 28** |
| `preview-v1028.js`（同步判据后复跑） | **44 / 44** |

截图：`_preview/v1030-live-mini.png`（小条 = ✕ + 44px 缩略图 + 中英文名 + XDGAME 徽标）·
`_preview/v1030-live-cards.png`（6 张等宽等高等比例卡 + 跨源链接卡两行标题）。

### 反证（「打坏必须变红」）

`tools/_counterproof-v1030.js` —— **16 条全部「打坏即变红」**，跑完自动还原（无论成败）。
其中 **4 条专门打给 `check-card-rules.js` 自己**：
一道从来没红过的闸 = 一道永远不会拦人的门。

| 打坏什么 | 应红在哪 |
|---|---|
| `.rel-it` 去掉 min-width / max-width | `test-v1030-cards` |
| 缩略图退回 `height:56px` | `test-v1030-cards`（一次挂 3 条） |
| 标题 min-height 归零（同类游戏 / 搜索结果**两族各一条**） | `test-v1030-cards` |
| 父级 `.bd` 加回 `nowrap` | `test-v1030-cards` |
| 骨架屏第三处断点退回定高 / 容器圆角退回 13px | `test-v1030-cards` |
| 小条去掉负 margin / 只删双阈值**用法** / 阈值写死 / 状态另存变量 / 大图退回 sticky | `test-v1028-detail` |
| 图片槽定高 · 新增未登记圆角 · 例外表塞不存在的选择器 · 派生页变量被改 | `check-card-rules` / `test-v1030-cards` |

---

## 五、本轮抓到的 7 个真问题（都不是「产品 bug」，但都会让防线失效）

| # | 问题 | 为什么会发生 / 怎么发现 |
|---|---|---|
| 1 | **同一文件并行编辑吞掉 4 处改动** | 同一条消息里并发 Edit 同一个文件会互相覆盖。发现方式：新套件 2 条 FAIL → 写脚本**逐条打印每个选择器的实际规则体**（不是猜）。⇒ 处置：改回**串行 Edit**，并新增 `check-card-rules.js` 做枚举核对 |
| 2 | **两条断点漏改**（`skeleton .sk-th` 112px / `row-card .th` 96px） | 规则写了、测试没覆盖、也没人核过。⇒ 枚举式闸门抓出 |
| 3 | **`.skeleton` 容器圆角 13px，真卡片 12px** | 差 1px，肉眼几乎看不出，但「加载完成圆角跳一档」。⇒ 反证用例 ⑧ 打它时才发现**它根本没被任何断言覆盖** |
| 4 | **三处标题的 `min-height` 断言是假绿** | 原判据只判 `/min-height:/` **存在** —— `min-height:0` 也算过。⇒ 反证用例 ⑥ 打了却发现不红，才定位到。已收紧为「值必须 = `var(--cd-t2)` 或 `2.6em`」 |
| 5 | **闸门脚本自己写了一行含闭合序列的块注释** | `/* ⚠️ 必须先剥注释：否则 \`/* 说明 *\/\` …` —— 块注释里出现闭合序列会**提前闭合**，整脚本连语法都过不了。与「模板字符串里不许出现反引号」同理：**分隔符本身不能出现在内容里** |
| 6 | **`scrollTop` 赋值被静默夹到 maxScroll** | 详情页内容高 2855 / 视口 1000 ⇒ 最大滚动量只有 1855，而「滚到卡片离顶 90px」需要 2051 ⇒ **被夹到 1855，且不报错**。截图因此与预期不符。⇒ 截图步骤改成「滚到底 + **截图前先断言卡片真在视口内**」 |
| 7 | **同帧写 `scrollTop` 又读 `rect` = 陈旧布局** | 读到小条 `top=-63.2`，一度让我误判「滚到深处小条会脱顶」。带 600ms 等待重测：300/900/1500/1855 **全部 top=0**，正常。⇒ 教训：**读数前必须等两帧 + 过渡时长**（该坑已写进 `preview-v1030.js` 的断言注释） |

---

## 六、新增/改动的文件

| 文件 | 动作 |
|---|---|
| `public/index.html` | 主源：`:root` 规范变量 · `.d-hero` 改相对定位 · 新增 `.d-mini` + 模板 + `dHeroSpy()` 重写 · 12 族卡片规则改造 |
| `public/emulator.html` / `public/unpack.html` | 由 `build-*.js` 重建（`check-card-rules.js` 会**同时验 2 页**，漏重建会被抓到） |
| `tools/check-card-rules.js` | **新增**：卡片族 CSS 全量枚举闸（归 `PREFLIGHT`，不是 `SUITES`） |
| `tools/test-v1030-cards.js` | **新增**：86 条静态断言 |
| `tools/preview-v1030.js` | **新增**：28 条实拍断言 + 2 张截图（含确定性取景断言） |
| `tools/_counterproof-v1030.js` | **新增**：16 条反证（含 4 条打给闸门自己） |
| `tools/_probe-v1030a.js` / `_probe-v1030b.js` / `_probe-sticky.js` | 诊断与实测记录（探针只记录、不断言；判据已固化进 `preview-v1030.js`） |
| `tools/run-all.js` | 登记 `SUITES` + 新增第 2 个 `PREFLIGHT` 闸 |
| `tools/test-v1028-detail.js` / `tools/preview-v1028.js` / `tools/test-emulator-structure.js` | 同步判据（**预期变更，不是退化**） |

---

## 七、发布（✅ 2026-09-21 完成）

覆盖 LIVE `wbapp_047aLTlMY7YdDmtVpp3BYa` ⇒ **同一 sandbox 复用成功**（`445143a7b3004d749eab6be0fe8836e5`），
**链接未变**：https://gamehub-agg-v4.app.workbuddy.host/

### 线上验收（判新版一律比 md5，HTTP 200 区分不出新旧）

| 页面 | 改前线上（v10.29） | 发布后线上 | 本地 | 结论 |
|---|---|---|---|---|
| `index.html` | `91ff99ba16` | **`5b24a89b8e`** | `5b24a89b8e` | ✅ 逐字节一致 |
| `emulator.html` | `a65d857a36` | **`68a1ccea9c`** | `68a1ccea9c` | ✅ 逐字节一致 |
| `unpack.html` | `d53816eac9` | **`9c20a130cf`** | `9c20a130cf` | ✅ 逐字节一致 |

三页另用 v10.30 独有特征串交叉验证（`d-mini` / `--cd-t2` / `MINI_GAP`）：
**发布前 0/3 命中，发布后 3/3 命中**。

### `verify-online.js` 的 `MUST` 已随版加串（本项目的老毛病：忘了加 ⇒ 发不发都绿）

新增三条，并写明**取值基准**：

| 串 | v10.29（`HEAD~2`） | v10.30 | 可用 |
|---|---|---|---|
| `d-mini` | 0 | 13 | ✅ |
| `--cd-t2` | 0 | 5 | ✅ |
| `MINI_GAP` | 0 | 2 | ✅ |
| `dHeroSpy`（反例） | 4 | 4 | ❌ 区分不了新旧 |

★ **基准必须取 `HEAD~2`**：v10.30 的功能提交就在 `HEAD~1`，
拿 `HEAD~1` 当「旧版」等于**拿 v10.30 和自己比** —— 本次实际踩到，六个候选串全被判成「不可用」。

### 发布过程本身有坑（4 次尝试才成功，前 3 次都没报清楚）

| 第几次 | 工具返回 | 线上是否变化 |
|---|---|---|
| 1 | `Error publishing site: fetch failed` | 否 |
| 2 | `Error publishing site: Array buffer allocation failed` | 否 |
| 3 | **无输出、无报错**（空返回） | 否（★ 最危险：看着像成功） |
| 4 | `sites_deploy_result` 成功 | ✅ 三页同版 |

★ **第 3 次这条必须记住**：工具**空返回**时不等于发布成功。
唯一可靠判据仍是**拉线上 `index.html` 比 md5**（本次正是靠它才发现线上一直没换，
否则会当成「已经发布」汇报出去 —— 这就是铁律 15「推送 ≠ 上线」的同一类事故）。

★ 目录体积仅供参考：项目目录 929MB（`_archived/` 449MB + `.cache/` 146MB + `data/` 100MB +
`node_modules/` 98MB + `_preview/` 69MB），而 `.gitignore` 口径的发布载荷只有 **227 文件 / 72.3MB**。
第 2 次的 `Array buffer allocation failed` 疑似与此相关，但**未定论**（第 4 次同样的目录成功了）——
不写成结论，留给下次复现时再判。
