# CODEX-DONE v10.23 —— 「跨源跳转直达详情页」（机地找同名按钮的两层真 bug）

> 用户原话（两句）：
> ①「前面被 github 的双重验证挡了好像，**现在看看有什么需要优化的**」
> ②「**机地找同名 ↗ 我的要求是直接链接到游戏详情页，现在连按钮都点击不了**，
>    是不是机地的详情页未获取到」

**一句话结论**：**机地的详情页一条没少**（13,448 条早就抓到了），
问题是**取数走了错路**（按名字猜，命中率 3.5%）**叠加**一个 **CSS 把 `hidden` 压掉**
（按钮可见但 `href` 为空 ⇒ 点了没反应）。
两处都修好之后，跨源按钮覆盖率 **3.5% → 90.1%**。

---

## 一、根因：两个 bug 叠加在同一个按钮上

用户的描述「连按钮都点击不了」有两种读法（不显示 / 显示了但点不动），**实测两种都成立**，
因为恰好是两个独立的 bug 撞在一起：

### bug ① 取数：按名字猜，命中率 3.5%

详情页的「另一源也有收录 / 跨源跳转」原先走的是：

```
GET /api/library?q=<中文名>    →    前端 sameGame() 过滤
```

也就是**纯名称模糊匹配**。v10.22 之前这还能用（机地条目都是独立条目）；
但 v10.22 把 **13,448 条机地话题合并进了 XD 条目**（机地信息挂在 `jidiUrl` / `jidiId` 上），
库里独立的 `source:'jidi'` 条目只剩 **3,609** 条。

实测（修前）：

| 方向 | 总数 | 按名检索命中 | 命中率 |
|---|---|---|---|
| XD → 机地 | 15,352 | **535** | **3.5%** |
| 机地 → XD | 3,609 | 733 | 20.3% |

★★ **落空的 14,817 条里，有 13,282 条库里明明带着 `jidiUrl`** ——
也就是「机地的详情页未获取到」这个猜测**不成立**：详情页一直都在，只是没人去用它。

### bug ② 显示：`hidden` 被 CSS 的 `display` 压过去

```html
<a class="go jidi" id="crossGo" hidden …>机地找同名 ↗</a>
```

```css
.go{display:flex; …}      /* ← 这条把 [hidden] 的 display:none 压过去了 */
```

浏览器给 `[hidden]` 的默认样式写在 **UA 样式表**里，**任何作者样式表里的 `display` 都赢它**。
⇒ 按钮**声明了 hidden 却始终可见**，而 `href` 因为 bug ① 从没被赋值
⇒ **一个点了没反应的死按钮** —— 正是用户看到的东西。

★ 项目其实**踩过一次**：`.dlpop[hidden]{display:none!important}` 就是当时的补丁，
但只给那一个元素打了，同一个语义散在两处 —— 于是 `#crossGo` 又栽进去。

---

## 二、修法

### 2.1 新增 `data/twin.js` —— 跨源孪生解析（精确键优先）

| 路径 | 依据 | 覆盖率贡献 |
|---|---|---|
| `jidiUrl` + `tid` | XD 条目自带的机地话题 id | **13,448** |
| `jidiId` | 机地条目反查 XD（精确键） | 0（本轮数据无此情形，接口保留） |
| `name` | 名称兜底，**必须过防误配闸门** | 387 |

★ 关键发现：XD 条目里 `jidiUrl` 的 `<id>` **就是 `data/jidi-topics.json` 的 `tid`**
（逐一对照：`detail/338824746` → 「玩偶冒名者」、`detail/2134035682` → 「让它去死」…）。
⇒ 一次 Map 查询就能拿到机地**详情页 URL + 真实标题 + 封面 + 评分 + 容量 + 类型**，
零网络请求、零模糊匹配。

为此给机地话题库加了 `byTid(tid)`（带 mtime 失效的索引）。

### 2.2 名称兜底：从「精确键查找」升级为「打分择优」

原来的兜底只查「归一化后完全相等」，会漏掉全部**包含关系**：

- 机地「红色警戒2」 ↔ XD「命令与征服：红色警戒 2 及尤里的复仇」
- 机地「侠盗猎车手5」 ↔ XD「侠盗猎车手5增强版」

改成扫一遍候选池 + 打分取最高：

```
中文段完全相等 +100 ｜ 中文段包含 +30
英文段完全相等 +80 ｜ 英文段包含 +20
★ 英文段「一票否决」：两边都有英文段却互不匹配时，只认中文段完全相等
门槛 TWIN_MIN_SCORE = 30
```

**为什么需要一票否决**（改的过程中实测抓到的真错配）：

| 机地 | XD | 结果 |
|---|---|---|
| `侠盗猎车手5/Grand Theft Auto V Enhanced` | `侠盗猎车手5**增强版**/…/Grand Theft Auto V Enhanced` | ✅ 配到增强版（30+20） |
| `侠盗猎车手5传承版/…/Grand Theft Auto V **Legacy**` | 同上 | ❌ **改前会配到增强版**（中文段包含就放行） |

Legacy 与 Enhanced 在 Steam 上是**两个 appid / 两条独立记录**，配错就等于把用户送到另一款游戏。
加上英文段一票否决后，传承版 → **不显示按钮**（宁可没有，也不给错的）。

### 2.3 新增 `GET /api/library/twin?id=&t=&src=`

返回 `{ ok, twin|null, via }`，`via` 如实标注命中路径
（`jidiUrl+tid` / `jidiId` / `name`）—— 排查时一眼能看出这条是精确键还是名称猜的。

### 2.4 前端：只负责显示，不再自己判同款

```js
resolveCounterpart(d, fb)   // ← 多带一个 fb：fb.id 是库内条目 id（精确孪生键）
  → fetch('/api/library/twin?id=' + fb.id + '&t=' + d.title + '&src=' + d.source)
```

同时**删掉前端的 `hasDetailUrl` / `normGameTitle` / `sameGame` 三个函数** ——
同一语义（两个标题是不是同一款）只留后端一份实现（项目铁律 10）。

两处连带修正：

- **CSS**：`[hidden]{display:none!important}` 提到全局（`<style>` 开头），
  并把 `.dlpop[hidden]` 那条特例收口过去 —— 同一个语义不再散在两处。
- **变量撞名**：`linkCounterpart` 内原有一个 `const fb`，与新加的参数 `fb` **同名**，
  `const` 重复声明会直接 **SyntaxError**（整段脚本不执行，连基础渲染都没了）。
  改名为 `cpFb`，并补了一条断言钉住它。
- **跨源那处的 `jidiUrl` 取值口径**：目标是机地 → 就是 `hit.url`；
  目标是 XD → 机地详情页是**当前这一页**（`d.url`）。原先写死 `hit.jidiUrl` 只会取到空串。

---

## 三、效果（全部实测）

| 指标 | 修前 | 修后 |
|---|---|---|
| XD → 机地 覆盖率 | **3.5%**（535 / 15,352） | **90.1%**（13,835 / 15,352） |
| 其中走精确键 | — | **97.2%**（13,448）—— 不靠名字猜 |
| 机地 → XD 覆盖率 | 20.3% | 20.4%（737）—— 落空的确实 XD 没收录 |
| 带 `jidiUrl` 的条目 | 13,282 条**被浪费** | **13,448 / 13,448 全部解析成功** |
| 可见按钮的空 `href` 数 | 不确定（按钮一直可见） | **0** |
| 单次解析耗时 | — | 0.6 ms（精确键）/ 4.4 ms（名称兜底） |

抽样 20 条名称兜底命中的**人工逐条核验**：全部同款，无误配。

---

## 四、验证

| 层 | 套件 | 结果 |
|---|---|---|
| 静态防线 | `tools/run-all.js` | **21 套 / 1388 条 / 0 失败** |
| 新增静态套件 | `tools/test-twin.js` | **69 / 69** |
| 浏览器实拍 | `tools/preview-v1023.js` | **17 / 17** |
| 反证 | `tools/_counterproof-v1023.js` | **4 / 4「打坏即变红」** |

实拍钉的是**用户能感知的行为**（不是元素存在性）：

- 有收录：`display=flex`、333×46、`hidden` 已移除、
  `elementFromPoint(按钮中心)` 命中 `A#crossGo.go`（**真能点到**）、
  `href` 是机地详情页且**与接口结论逐字一致**、文案是「前往机地详情 ↗」
- 没收录：`display:none`、0×0、无 `href` ——
  **改前这里是 `display:flex` + 空 `href`，就是那个「点了没反应」的死按钮**
- 整轮**无页面 JS 报错**（撞名 / SyntaxError 都会在这里现形）

反证四处：① 去掉 `jidiUrl` 精确键分支 ② 去掉英文段一票否决
③ 删掉全局 `[hidden]` 规则 ④ `linkCounterpart` 不回传 `fb` —— 全部「打坏即变红」。

### 本轮反证**抓出的假绿**（值得单记）

反证第一次跑时 ③ 是绿的 —— 断言 `/\[hidden\]\{display:none!important\}/.test(idx)`
被 **CSS 注释里引用的同一串文字**命中了（我在注释里写了「`[hidden]{display:none!important}` 已在
CSS 开头全局声明」）。⇒ 改为**行首锚定** `/^ {2}\[hidden\]\{display:none!important\}\s*$/m`。

同一轮还遇到反向的：给 CSS 加的说明性注释里引用了 `` `.go{display:flex}` `` 这个片段，
让 test-emulator-page 的「**不残留裸 CSS 文本**」断言**假红**。
⇒ 那条断言改为**先摘掉 `<style>`/`<script>` 再取文本** ——
它真正要盯的是「掉到 `</style>` 外面的 CSS」（那才是泄漏），style 内部的 CSS 本来就该在那儿。

---

## 五、改动的文件

| 文件 | 改动 |
|---|---|
| `data/twin.js` | **新增**：跨源孪生解析（精确键优先 + 打分择优 + 防误配闸门） |
| `data/jiditopics.js` | 新增 `byTid(tid)`（带 mtime 失效的索引） |
| `server.js` | 新增 `GET /api/library/twin` |
| `public/index.html` | 跨源解析改走接口；删 `hasDetailUrl`/`normGameTitle`/`sameGame`；修 `const fb` 撞名；全局 `[hidden]` 规则 |
| `public/emulator.html`、`public/unpack.html` | 由主源重建（派生页不重建就会漏） |
| `tools/test-twin.js` | **新增**静态套件（69 条） |
| `tools/preview-v1023.js` | **新增**浏览器实拍（17 条） |
| `tools/_counterproof-v1023.js` | **新增**反证（4 处） |
| `tools/run-all.js` | SUITES 登记 `test-twin.js`（20 套 → **21 套**） |
| `tools/test-v1014.js`、`test-v1015.js`、`test-download.js`、`test-emulator-page.js`、`test-emulator-structure.js`、`test-match-release.js` | 断言同步到新结构（**预期变更，不是退化**） |
| `fetchers/xdrank.js` | **第二轮**：新增 `coverOf()`（懒加载占位剔除 + 相对路径补全）、`mergeRankRows()`；`rawHot()` 每行带 `img` |
| `server.js` | **第二轮**：`/api/rank` 改用 `xdrank.mergeRankRows()`（去掉内联 `byUrl` 的 `cover:null`） |
| `data/games.json` | **第二轮**：补齐 7 条空封面并回填 `appid`，全库封面 99.96% → **100%** |
| `tools/fill-covers.js` | **第二轮新增**：幂等补封面工具（详情页 → appid → Steam 官方 `header_image` → 镜像映射） |
| `tools/test-covers.js` | **第二轮新增**静态套件（49 条） |
| `tools/preview-covers.js` | **第二轮新增**浏览器实拍（11 条，判据 `naturalWidth > 0`） |
| `PITFALLS.md` | 新增 3 条（`hidden` 被 display 压掉 / 注释里 `**加粗**/` 提前闭合 / 断言被注释命中） |

### 关于 GitHub 双重验证（用户第一句）

实测 `git ls-remote origin` 的 `refs/heads/main` == 本地 `HEAD` == **`1e30503`**
⇒ 上一轮的推送**已经成功**，没有被双重验证挡住。本轮的提交见收尾汇报。

---

## 六、第二轮（同日追加）—— 前端可见的游戏图片全部补齐

> 用户原话：「其次 @截图 前端可见的游戏图片需要你进行获取图片」。
> 截图红框圈着全站热榜第 2 / 5 / 8 名三张**空白色块**。

### 6.1 根因：源站本来就给了图，是我们的抓取把它丢掉了

用户第一反应是「是不是要把图片下载下来」—— 实测**不是**：
`shared.cdn.queniuqe.com` 的图全部 `HTTP 206` + `image/jpeg`，浏览器能正常加载。
真正的原因是**两条都不报错**的取数问题：

| # | 位置 | 问题 | 实测证据 |
|---|---|---|---|
| ① | `fetchers/xdrank.js` | 解析 `.hot-soft .plate-list` 每行时只取 `a[href]` / `a[title]`，把同一行 `<img class="lazy" src="/images/defaultpic.gif" data-original="真图">` **整个丢掉** | 源站三档 29 行**每行都有 `data-original`** |
| ② | `server.js` 的 `/api/rank` | 只用 `byUrl.get(it.url)` 精确匹配本地库；落空即写死 `cover: null` | 线上周榜 10 条里 **2 条**无图（本地 1 条） |

② 的落空有两种、都很常见：库里根本没收录（「DLSS 5 Swapper」这类工具条目）、
库里有但 url 串差一点（`http/https`、`www`、尾斜杠任一不同）。

### 6.2 修法（只改后端，前端一行没动）

前端本来就有「有图渲染 `<img onerror=…>` / 无图渲染首字 `.ph`」两个分支，
且缩略图槽位是 `width:74px;height:44px;object-fit:cover` —— 所以**数据给对就行**。

1. **`coverOf(src, dataOriginal)`**（新增纯函数）
   `data-original` 优先；没有它才退到 `src`，且**必须剔除懒加载占位图**
   （`/images/defaultpic.gif`、`lazy.gif|png|svg`、`/images/blank`）。
   相对路径补全为绝对 URL，`data:` 一律不认。→ 实测三档 **29/29 行**都抠出了图。
2. **`mergeRankRows(rows, all)`**（新增纯函数，抽出来便于离线回归）
   ```
   ① byUrl.get(it.url)                     ← 老路
   ② byId.get('xd-' + it.gid)              ← ★ 本地库 id 就是 xd-<gid>，比 url 串稳
   ③ 都没有 → 用源站行图 it.img
   封面优先序：库内 cover（Steam 标准 460×215） > 源站行图 > null
   ```
   ★ **不编造**：两边都没有图时 `cover` 保持 `null`，前端自然走首字占位分支。
3. **`tools/fill-covers.js`**（新增工具）：补齐全库 7 条空封面。
   路线 = 抓 XD 详情页 → 从页内图反推 Steam appid → 调 Steam 官方
   `appdetails?appids=<id>&filters=basic` 拿 `header_image` → 域名映射到库内统一镜像。
   ★ 关键：**官方给的是带 hash 的完整路径**，自己硬拼 `apps/<id>/header.jpg` 会 404 ——
   「欺世欢悦 4001800」实测就是这种（硬拼 404，官方路径 200 且 460×215）。
   ★ 只在 `HTTP 2xx + image/*` 验证通过后才写回，并顺带回填 `appid`
   （等于用「这个 appid 真能取到图」当它正确性的证明）。工具**幂等**（只填空、不覆写、无变化不写盘）。
   实测 **7/7 成功**，Steam 返回名与条目标题**逐条对得上**，零误配。

### 6.3 效果（全部实测）

| 指标 | 修前 | 修后 |
|---|---|---|
| 四榜（周/月/全站/社区）41 条无封面 | 本地 1 条 · **线上 2 条** | **0 条** |
| 全库 18,961 条封面覆盖 | 99.96%（7 条空） | **100.00%** |
| 浏览器实拍「图真的加载了」（`naturalWidth > 0`） | — | **19 / 19 张**（含冠军卡大图） |

### 6.4 防线

- 新增 `tools/test-covers.js` **49 条**：`coverOf` 七种输入 / `cleanPlate` 不许丢 `img` /
  `mergeRankRows` 五条分支 / 全库覆盖率 / 三页接线与两个渲染分支
- 新增 `tools/preview-covers.js` **11/11**：判据是 ★`img.naturalWidth > 0`
  （**元素存在 ≠ 图加载成功**：404 / 防盗链 / 空 `src` 的 `<img>` 一样占版面、
   一样有 `getBoundingClientRect`、一样能点到，但 `naturalWidth` 恒为 0）
- 反证扩到 **9 处**（本轮新增 5 处：gid 兜底 / 源站图兜底 / 占位图剔除 / `rawHot` 带 `img` / server 接线）
- `tools/run-all.js` SUITES 登记 → 静态 **22 套 / 1439 条 / 0 失败**

### 6.5 ★ 本轮抓到的一条**假红**（值得单记）

实拍脚本里我先写了「全站榜的图必须走 `/uploads/` 相对路径，以证明相对路径补全真的生效」——
**它红了**。但红的不是代码，是**我的假设**：封面优先序是「库内 cover > 源站行图」，
而全站榜都是热门老游戏、库里全都有 cover，所以**永远走不到源站那条相对路径**。
硬要它出现就是**为凑断言而写假断言** —— 而且那种断言会反过来逼着后来人
把「库内优先」这个正确设计改坏。
⇒ 改成断言「图都来自库内 cover（说明优先序生效）」，
相对路径补全由 `test-covers.js` 的 ① 组**离线覆盖**。

**一般化**：断言红了先分两类 ——
「代码坏了」还是「我把预期写错了」。**后者改断言，但必须同时想清楚
「那条行为现在由谁守着」**，别把覆盖点一起删掉。

---

## 七、下一步（阻塞在用户）

v10.24 仍是**解包匹配的字段校准**，需要一份解包 JSON 样本，且**只改 `data/spec-dict.js`**
（界面与 `/api/spec/*` 都不动）。
