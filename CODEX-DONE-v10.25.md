# CODEX-DONE v10.25 —— 详情页/搜索弹窗六项优化（搜索聚拢 · 画廊 · 定位条 · 更多 · 双源合并 · 下载三按钮）

> 用户原话：「① 搜索弹窗的样式 ② 游戏截图应该是 <画廊式> ③ 详情页弹窗能有个定位条（竖着的）
> ④ 数量较大时增加「更多」按钮看专区全部内容 ⑤ 双源有则合并去重显示
> ⑥ 下载按钮优化（①下载本体 ②下载修改器 ③下载Mod）」
> ③ 用户要求「先给我看看详情页布局、我来给位置权重」→ 已拍板：**右侧固定 / 收录 8 项 / Steam 图+源站兜底 / 三按钮并排**。

## 一、六项一览（全部实测）

| # | 项 | 改法要点 | 实测效果 |
|---|---|---|---|
| ① | 搜索弹窗 | **同款聚拢**（按 `splitName().zh` 完全相等归并）+ 评分分三档配色 | 搜「艾尔登」**6 行 → 3 行**，冗余 3 条降级为 chip；弹窗高 598 → **444px** |
| ② | 游戏截图 | `.shots` 三列小图网格 → `.gal` **画廊**（viewport/track/slide/prev-next/counter/thumbs + 灯箱） | 21/21 断言；修好「翻页白屏」（懒加载坑） |
| ③ | 详情页定位条 | `.d-rail` **竖排固定在抽屉右侧**（`.drawer` 的**兄弟节点**，不能放里面） | 8 项，落点 309→1504→1846→2083→2577→2782→3072 |
| ④ | 「更多」按钮 | 5 处截断区块给 `.d-more-btn`，点开复用 `#dlPop` 全量弹窗 | 13 份配置 / 98 条资源帖；按钮数字 == 弹窗数字 |
| ⑤ | 双源合并 | 新增 `/api/detail/merged`：截图去重相加 + 补齐另一源独有的字段 | 机地 3,609 款原本**整块没有**「版本介绍」；配置要求补第二栏 |
| ⑥ | 下载按钮 | 一个「网盘下载」→ **三个并排**（下载本体 / 修改器 / Mod） | 赛博朋克2077：Mod **717** / 修改器 **2** |

---

## 二、① 搜索弹窗：同款聚拢（本轮最核心的一处）

### 根因不是「数据重复」

搜「艾尔登」返回 6 条，其中「艾尔登法环」占 3 行。看着像 bug，实际是**源站把同一款游戏拆成多个页面**：

| 标题 | 源 | 性质 |
|---|---|---|
| 艾尔登法环/ELDEN RING | 机地 | 主条目 |
| 艾尔登法环/ELDEN RING/**支持网络联机** | XD | 同款 · 后缀变体 |
| 艾尔登法环/ELDEN RING | XD | 同款 · 干净版 |

### 归并键直接用现成的 `splitName()`

`splitName(title)` 以**第一个 `/`** 切分，`zh` 段天然就是归一键：

- `艾尔登法环/ELDEN RING` 与 `艾尔登法环/ELDEN RING/支持网络联机` → **同键** ✓
- `艾尔登法环 黑夜君临/ELDEN RING NIGHTREIGN` → **不同键** ✓（那是另一款游戏）

★ **刻意不用子串匹配** —— 子串会把上面两者并成一条（跨源名称匹配的老坑）。

### 归并不删数据

新增 `smGroup` / `smVariant` / `smAltHtml` / `smRows`（都在 `smSkeleton` 之后）：
主行 = 该键首次出现的条目；其余落成**主行下方的 chip**（`XDGAME 支持网络联机 ★9.2 ↗`），
每张 chip 带 `data-url` + `data-fb`，**复用 `openDetailFromSearch` 同一条路**进详情。

- 归并只影响**展示**：条目总数守恒（`行数 + chip 数 == 接口条数`）
- 分组头计数从「6 款」改成「**3 款 · 合并 6 条**」（不显示款数会让用户以为丢数据）
- `sugItems()` 只认 `.sm-row`，所以**键盘 ↑↓ 仍只走主行**，不会被 chip 干扰

### 修器组**不能**聚合（反向护栏）

修改器组搜「艾尔登法环」有 4 行、黑夜君临 3 行 —— 但那是**同一款游戏的 4 个修改器来源**
（社区贡献 / 风灵月影 / 小幸 / CE 表），是用户要找的信息，并掉等于把「有几个修改器」藏了。
★ 测试里专门钉了一条反向断言守这个行为。

### 评分分三档

原先 `★9.3` 与 `★5` 共用同一个琥珀底，一列扫过去分不出哪款值得点。改成
≥9 绿（`s-hi`）/ ≥7.5 蓝（`s-mid`）/ 其余灰（`s-lo`）。

---

## 三、② 游戏截图 → 画廊

`.shots{grid-template-columns:repeat(3,1fr)}` 整段删除（不留死 CSS），换成 `.gal-*`：
`.gal-vp`（16:9 viewport）/ `.gal-trk` / `.gal-sld` / `.gal-nav` / `.gal-num` / `.gal-thumbs` / `.gal-th`，
外加 `.gal-lb` 灯箱。

### ★ 两个必须记住的坑

1. **`loading="lazy"` 在 `translateX` 位移的轨道里不触发** —— 实测 9 张只加载 2 张 ⇒ 翻页白屏。
   修法：`galGo` 里把「当前 + 下一张」显式 `eager`。
   **不能全 eager**：12 张 × 573KB = 6.9MB。
2. **Steam CDN 尺寸后缀可换**：同一 `ss_<hash>` 换后缀即可 —— `600x338`=200/67KB、
   `1920x1080`=200/573KB、裸 `.jpg`=200/2MB。
   ⚠️ **探测可用性绝不能用 HEAD**（该 CDN 对 HEAD 一律 404 = 假信号），只有 GET 准。

双源共用 `fetchers/shots.js`（唯一尺寸规则）：`list()` 吃**上游原始形态**，
`merge()` 吃**已归一的 `[{t,f}]`** —— ★ 两者不能互相喂（`list([{t,f}])` 实测返回 0 条）。

---

## 四、③ 详情页定位条

### ★ 必须是 `.drawer` 的**兄弟节点**

`.drawer` 隐藏时用 `transform:translateX(103%)`，而 **transform ≠ none 的元素会成为
`position:fixed` 后代的包含块** ⇒ 定位条放在 `.drawer` 里面会跟着一起滑走。

### 滚到底要强制高亮最后一项

最后几项挤在最后一屏里，`scrollTop` 顶到 `scrollHeight - clientHeight` 就停，永远到不了判据线。
⇒ `railSpy()` 加「滚到底 → 强制高亮最后一项」兜底。

实测落点：`309 < 1504 < 1846 < 2083 < 2577 < 2782 < 3072(=3072 被夹住)`。

`D_RAIL` 8 项：配置要求 / 手机配置 / 游戏预览 / 修改器 / 云存档 / 游戏介绍 / 同分类 / 下载。
`railTarget` 逐个候选选择器找**真可见**元素（`offsetW/H > 0`）；
「游戏介绍」用**按文字过滤**（`.block` 也用于版本介绍）。

---

## 五、④ 「更多」按钮

五处截断改按钮：`loadTrBlock`（修改器）/ `loadSvBlock`（云存档）/ `loadDlBlock`（下载帖）/
`loadBhBlock` 的 `bhParamSlot`（逐条参数）与 `bhDevSlot`（机型清单，按 40 台分块发请求绕 414）。

- 载荷存在 `dFullStore`（token → payload），`paintDetail` 开头**清空** → 防跨游戏串台
- 点击委托里**最先**判 `[data-full]`
- `bhDevRow(m, s)`：机型 → `{m,name,code,hwq,chip,chipSrc,score,approx}` 的**唯一映射**
  （详情页清单与弹窗共用，防漂移）

★ **两个专区的「更多」当前不会触发**（实测：修改器单款最多 4 个来源 < 上限 8；机型最多 22 台 < 上限 24）。
**不降上限** —— 降了会缩短默认展示，属用户没要求的退化。这是**阈值保护，不是死代码**，要激活只需下调上限。

---

## 六、⑤ 双源合并（本轮挖出一个「注释承诺了但代码做不到」的真缺口）

### 合并本身

`/api/detail/merged`：截图 `shotsLib.merge` 去重相加；`version` / `desc` 只在**本侧为空**时补，
并标来源（`版本介绍〔来自XDGAME〕`）。

- **游戏介绍不拼接**（两边是同一段文案）
- **配置要求不做字段级合并**（结构对不上，改在前端补第二栏）

### ★★ 真根因：机地封面 **0%** 带 Steam appid

实测全库 18,961 条：

| 源 | 条数 | cover 带 Steam appid |
|---|---|---|
| xdgamer | 15,352 | 14,956（**97.4%**）|
| jidi | 3,609 | **0（0.0%）** |

`/api/pcreq` 靠 cover 解析 appid 才问得到 Steam 配置。机地封面是 `img2.52jidi.com` 形态
⇒ 解析不出 appid ⇒ 走「机地同名兜底」⇒ `rec: null`
⇒ **「配置要求补第二栏」对机地来源的 3,609 款游戏整个失效**（代码里只有一行注释承诺，实际一次都没生效）。

**修法**（`server.js` 的 `/api/pcreq`）：借**孪生条目**的封面问 Steam（XD 侧 97.4% 带 appid）。
两道护栏缺一不可 —— 配置要求是具体数值，**安错比不显示更糟**：
1. `twinOf` 自带的 `sameGame` 闸门 + 分数阈值；
2. 再加一道「**中文段完全相等**」复核，挡住「艾尔登法环」↔「艾尔登法环 黑夜君临」这类同系列不同作品。

**效果（实测）**：
- 艾尔登法环 `appid=1245620`、配置要求 `h=331px`、`cnt="源站 + Steam 官方"`（原来 `appid=''`、空 rec、10.6s）
- 机地等距抽样 24 款：**5 款**借孪生拿到 appid（20.8%），其中 **2 款**补上推荐配置（8.3%）
- ★ **零误配**：5 款的 appid 全部与 Steam 官方名吻合（例：`钢铁之躯`→`Iron Meat`、
  `维勒姆`→`Vellum`、`黎明行者之血`→`The Blood of Dawnwalker 黎明行者之血`）
- 同系列不串：黑夜君临 `appid=2622380` ≠ 法环 `1245620` ✓

---

## 七、⑥ 下载按钮三并排

`.go.dl`（整行一个按钮）→ `.dl-strip`（`display:flex` + `.ds` 三等分）：

| 按钮 | 类 | 数据源 |
|---|---|---|
| ⬇ 下载本体 | `.ds-main`（绿）| `/api/download`（跟随 302 逐个解析，XD 约 3-8s，**故意不预取**）|
| 🛠 修改器 | `.ds-mf`（紫）| `/api/mods/match` 的 **`counts.modifier`** |
| 🧩 Mod | `.ds-mo`（蓝）| `/api/mods/match` 的 **`counts.mod`** |

★ `counts` 是**分类数**（原 `count` 是混合值：艾尔登法环 = 98）。
★ 后两个**默认 `hidden`**，`setDlCounts()` 按 counts 显隐 —— **宁可少一个按钮，
也不给一个点开是空列表的按钮**。

---

## 八、连带修掉的测试（都是「预期变更」，不是真退化）

| 套件 | 原断言 | 改成 |
|---|---|---|
| `test-emulator-structure` | `.shots` 三列 / 移动端两列 | `.gal-vp` 16:9 单幅吃满 + 移动端控件收窄 + 定位条隐藏 |
| `test-v1017` | 「还有 N 台机型未展开」文案 | `hiddenDev > 0 ? dFullBtn(...)` —— 意图不变：**只在真被截断时出现** |
| `test-download` | `class="go dl"[^>]*data-dl-open` | `.ds ds-main` + `id="dlBtn"`；**新增 6 条**守三按钮/默认隐藏/counts 回填 |
| `test-search-ui` | `.shots` 列数（纯 CSS 规则） | 画廊「每张 slide 与 viewport 等宽」（留 4px 边框容差）|

---

## 九、验证（三层，全部实测）

**① 静态防线**：`node tools/run-all.js` → **23 套 · 1528 通过 / 0 失败**，异常退出无
（改前 1517/5 → 修连带断言 + 新增 11 条）。

**② 反证**：`node tools/test-v1025-search-counterproof.js` —— 把 `smRows()` 的
`smGroup(arr).map(...)` 打回 `arr.map(smRow)`，**11 条断言变红、零假绿**。
★ 反证当场抓到一条**真·假绿**：守恒断言「行数 + chip 数 == 6」在平铺时是 `6 + 0 = 6`，
**照样绿** ⇒ 已加固成「守恒 **且** chip > 0」。

**③ 浏览器实拍**（第二层，需 CDP，手动分批跑）：

| 套件 | 条数 |
|---|---|
| `test-search-ui.js` | 44 / 44 |
| `test-v1025-search.js`（①）| 21 / 21 |
| `test-v1025-gallery.js`（②）| 21 / 21 |
| `test-v1025-dlstrip.js`（⑥）| 12 / 12 |
| `test-v1025-rail.js`（③）| 16 / 16 |
| `test-v1025-more.js`（④）| 14 / 14 |
| `test-v1025-merge.js`（⑤）| 13 / 13 |

合计 **141 条**浏览器断言。

★ 本轮把 6 个临时探针（`_check-*.js`）**转正**成 `test-v1025-*.js`（`_` 前缀不进仓库，
转正后才成为长期防线），并删掉纯侦察用的 `_recon-detail.js`。

---

## 十、文件清单

**新增**
- `fetchers/shots.js` —— 双源共用截图库（`list` / `merge` / `thumbOf` / `fullOf` / `idOf`）
- `tools/test-v1025-{search,gallery,rail,more,merge,dlstrip}.js` + `test-v1025-search-counterproof.js`
- 本文

**修改**
- `public/index.html`（主源，唯一编辑点）→ 同步重建 `public/emulator.html` + `public/unpack.html`
- `server.js`（`/api/mods/match` 加 `counts`/`limit`、新增 `/api/detail/merged`、`/api/pcreq` 孪生封面兜底）
- `fetchers/jidi.js`、`fetchers/xdgamer.js`（截图结构化解析）
- `tools/test-{emulator-structure,v1017,download,search-ui}.js`（连带断言）

---

## 十一、本轮新增的坑（→ 已进 `PITFALLS.md`）

1. **`transform` 的副作用**：transform ≠ none 的元素是 `position:fixed` 后代的**包含块**
   ⇒ 固定定位的兄弟 UI 不能放进被 transform 的容器里。
2. **`loading="lazy"` 在 `translateX` 轨道里不触发** ⇒ 翻页白屏；修法是**只 eager 当前+下一张**。
3. **Steam CDN 对 HEAD 一律 404** —— 探测可用性只有 GET 准（HEAD = 假信号）。
4. **`list()` 与 `merge()` 不能互相喂**（一个吃原始形态、一个吃已归一形态）。
5. **「注释承诺了但代码做不到」**：`/api/pcreq` 的补栏逻辑写了注释却没数据支撑
   ⇒ 判断一个特性有没有生效，要**去数实际生效的条数**，不能看注释。
6. **守恒类断言必须连「构成」一起判**：`行数 + chip 数 == 6` 在「6 行 + 0 chip」时**照样绿**
   ⇒ 反证才抓得到（纯看数字的断言天生假绿）。
7. **测试传参必须走真实路径**：探针把 `fb` 传成 URL 字符串 ⇒ `JSON.parse` 静默抛异常 ⇒
   `fb={}` ⇒ 被守护的链路**根本没被走到**，而断言还绿着。
