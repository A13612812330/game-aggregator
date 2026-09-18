# CODEX-DONE v10.22 —— 「解包结果同版式 + 真实下载链接 + 热门优先 + 机地全量」

> 用户原话（一次性四条 + 一个追问）：
> ①「**解包匹配的游戏能够跟手机专区的前端展示效果一样**」
> ②「**其次不要推断，最好是进行联网获取对应的数据或者读取已有数据情况**」
> ③「**其次可适配游戏优先推热门游戏**」
> ④「新增一个功能：将游戏详情页的跳转链接变成获取到对应游戏的下载链接（弹窗展示，
>    大部分 XD 都是有多个下载链接，最好是获取到完整的标题）」
> ⑤「**有个很重要的问题，为什么机地的数据那么少**，可以通过 `topic/list` 进行获取 …
>    **自动翻页获取到每一个数据的详情页以及详情页中的下载链接**」

**一句话结论**：四条 UI/功能需求全部落地并**浏览器实拍验证**；
而第 ⑤ 条追问挖出了一个**结构性缺陷** —— 机地侧不是「少」，是**取数路径取错了**（66 → **17,220**）。

---

## 一、为什么机地的数据那么少？（第 ⑤ 条）

### 根因：老实现抓的是「人工精选」，不是全站

| 路径 | 取数方式 | 条数 |
|---|---|---|
| 旧实现 | 首页 SSR 的「新游区」+ 周/月/年热榜 | **66** |
| 全量 | 签名接口 `/api/topic/get_topics` | **17,220** |

用户给的 `https://jidiyouxi.com/topic/list`（`ant-pagination` 862 页 × 20 条 ≈ 17,240）
指向的正是后者。两个源份量本来完全不成比例（XD 侧 15,319 条），
**问题不在源站，在本站只拿了源站摆在首页的那几块。**

### 怎么抓（`fetchers/jidiSigned.js` + `fetchers/jidiTopics.js`）

`get_topics` 走机地的 `websign` 签名：

```
POST /api/topic/get_topics?websign=<sign>
content-type: text/plain
body = 展开的完整 env + { offset, limit, next_cb, cur_page:'all_topic', sort, genre }
sign = "v2-" + md5(String(h_m||0) + md5(JSON.stringify(body) + "YhD6TCs9VpAl"))
```

- `env` 藏在详情页 `<script id="appState">` 里，**整份展开**（不是只挑业务字段）。
- ★ `limit` 实测**可以给到 1000** ⇒ **18 次请求**抓完全站，**32 秒 / 10.3 MB**。
- ★★ `total` 字段**恒为 0**（陷阱字段）——不能靠它判断结束，
  必须按 `offset` 递增 + **空页**判定收尾。

### 落盘与合并

| 产物 | 内容 |
|---|---|
| `data/jidi-topics.json` | **17,220** 条话题（`{items:[…]}`） |
| `data/jiditopics.js` | 读取层：`stats()` 逐字段覆盖率 / `list({q,sort,dl,hotMin})` / `top(n)` |
| `data/games.json` | 端游库 15,385 → **18,928**（并进机地侧） |

字段覆盖（实测，`/api/jiditopics/stats`）：

```
total 17220 ｜ 封面 17220(100%) ｜ appid 16738(97.2%) ｜ 最低配置 17048(99.0%)
推荐配置 11189 ｜ DX 8518 ｜ 内存 16419 ｜ GPU 15626 ｜ 存储 16033
有可下载资源帖 364 ｜ 带热度(dpv) 9988
```

★ **与 XD 的对齐不走名称模糊匹配，走 Steam appid** ——
机地的 `game_info.header_image`（Steam CDN 图，97.2%）与 XD 的封面 URL（97.4%）
**都内嵌 appid**，于是 `13,448` 条 XD 记录找到同 appid 的机地孪生（`jidiId` / `jidiUrl` / `hot`）。
★ 前端卡片上要显示的封面是机地自己的 `img2.52jidi.com/topic/cover/…`，
**appid 只从 Steam CDN 那条字段抠**（`fetchers/jidiTopics.js` 的 `appidOf()`）—— 两者别混用。

---

## 二、「不要推断」—— 换成 16,575 款真实要求库（第 ② 条）

### 改前 / 改后

| | 改前 | 改后 |
|---|---|---|
| 数据源 | 仅 Steam 官方配置要求 | 机地 + Steam **按 appid 精确合并** |
| 覆盖游戏 | 653 | **16,575** |
| DX 覆盖 | 345 | **8,312** |
| 来源标注 | 无（页面写死「Steam 官方配置要求 N 款」） | 逐条 `reqFrom`，卡片显示「**要求来自 机地**」 |

产物 `data/spec-req.json`：

```json
{ "joinKey": "steam appid（机地封面 97.2% / XD 封面 97.4% 均内嵌）",
  "stats": { "total":16575, "withMin":16519, "withRec":10842, "withDx":8312,
             "withStorage":15439, "withRam":15847, "withGpu":15196,
             "bySource":{"none":52,"jidi":15873,"steam":629,"jidi+steam":21},
             "jidiCandidates":17220, "steamCandidates":653, "xdCandidates":14070 } }
```

★ **`bySource` 必须逐项报出来**：`none 52` 就是「两个源都没给要求」的，
它们**照实显示为「-」，不编造**。这是用户「不要推断」的正面口径。

### 顺手修正的一个数据驱动 bug：`流畅` 判定过宽

存储数据从 0 铺到 1.5 万条后，一个**存储余量**就把 8,385 / 16,519 款刷成「流畅」。

```js
// ❌ 旧：存储余量大也算跑得顺
verdict = (ramM >= 2 || stM >= 3) ? 'smooth' : 'ok'
// ✅ 新：只有内存余量算「跑得顺」，存储余量是**门槛**不是余量
verdict = ramM >= 2 ? 'smooth' : 'ok'
```

★ 这条**只有数据铺开之后才会暴露** —— 数据稀疏时 `stM` 恒为空，规则从未真正生效过。

---

## 三、「可适配游戏优先推热门」（第 ③ 条）

- `data/spec-match.js` 的 `analyze()` 默认排序由 `'scale'` 改为 **`'hot'`**（机地浏览量 `dpv`）。
- `data/jiditopics.js` 的 `list()` 默认排序同为 `hot`。
- 结果页排序按钮：**🔥 热门优先**（默认） / 规模优先 / 余量优先 / 名称。

实测榜首：钢铁雄心IV 16.6 万、剑星 348,068（浏览器实拍读到的卡片数值）。

---

## 四、解包匹配结果页 = 手机专区版式（第 ① 条）

不另写一套卡片，**直接复用** `.emu-grid` + `.emu-card`：

```
.emu-grid.up-list          ← 容器复用手机专区网格
  .emu-card.has-cov.up-mc  ← 卡片复用手机专区版式
    .cov > img             ← 封面（实拍断言 naturalWidth > 0）
    .top > .nm             ← 名称
    .cnt > b               ← 热度（万/k 格式化）
    .up-mc-row             ← 判定徽标 + 「要求来自 机地/Steam 官方/机地 · Steam」
    .tags                  ← 类型 + 容量 + ★ 评分
    .up-chips / .up-min / .up-why
    .up-mc-btns            ← [⬇ 网盘下载] [源站详情 ↗]
```

实拍：卡片圆角 **13px**（与手机专区一致）、桌面 **4 列**、窄屏 **1 列铺满（卡宽 304）**、
封面 **12/12 张已解码**。

★ 判定依据面板的文案也改了口径：不再写死「Steam 官方配置要求 N 款」，
改为读 `d.stats`，说明「appid 精确合并 + 逐字段来源 + 无推断值」。

---

## 五、下载链接弹窗（第 ④ 条）

### 交互

详情页底部新增 **`⬇ 网盘下载`** 主按钮（独占一行 —— 它和「前往源站详情」不是同一类动作：
一个拿资源、一个看信息）。点击弹出 `.dlpop`，**同时取 XD 与机地两源**。

### 两源各自的取法

| 源 | 取法 | 实测 |
|---|---|---|
| **XD** | 详情页 `.article-down a.downbtn` 的 `data-url` → 请求 `download.php` 拿 **302 Location** | 6 个盘口 **6/6** 全解出 |
| **机地** | 详情页 SSR `topic.ssrData.postsMap.list`，网盘直链写在**帖子正文**里 | 5 条（含作者/热度） |

**完整标题**取源站返回的（`妈妈，我真的在学外语/Mom, I'm Really Learning English`），
不拿库里的短名盖掉；版本串单独一行（`Build.25183906|容量1.6GB|官方简体中文|支持键盘.鼠标`）。

### 三个必须记住的坑

1. **`Location` 头乱码**：非 ASCII 是 UTF-8 字节被按 latin1 解码
   （`（访问码：2o8s）` → `ï¼è®¿é®ç ï¼2o8sï¼`）。
   触发判据必须覆盖 **C1 控制区** `[\u0080-\u00ff]`（实测 `\u0088` 落在 C1，
   只判 `[\u00c0-\u00ff]` 会漏）；重解码若产出 `\uFFFD` 就退回原值。
2. **`z-index` 必须高于详情抽屉**：抽屉 100 / 遮罩 90 → 弹窗定 **110**。
   低于抽屉时从抽屉里点开会**被整个盖住**，而「元素存在 / 占版面 / 可点」全部成立 ——
   最危险的那类假绿。**断言用 `document.elementFromPoint`**（能不能真看到），不只看存在性。
3. **源站权限门**：XD 对部分游戏返回 **`HTTP 200` + `<title>你没有权限下载：<游戏名>！</title>`**
   （既无 302 也无跳转脚本）。实测 `钢铁雄心4`（id=3967）**10 个盘口全部如此**。

### 权限门为什么必须单独处理

| 现象 | 真因 | 该给用户的出口 |
|---|---|---|
| 一列沉默的「不可用」 | 源站策略（要登录） | **去源站登录后获取** |
| 一列沉默的「不可用」 | 网络抖动 / 源站改版 | **稍后重试** |

两者出口相反，**不能都渲染成「0 条链接」**。做法：

- 后端 `needAuthOf(items)` 三个条件**缺一不可**：
  `有条目` ∧ `全都没有 real` ∧ `至少一条报 needAuth`
  （全超时时不得报 needAuth —— 否则把「稍后重试」误导成「去登录」）。
- 前端 `dlBlocked()` 渲染 `.dl-blocked` 说明块（**琥珀 warn 档**，跟真出错的红色区分）+ `.dl-go` 出口。
  顶部说明也换成「这款游戏暂时**没有可直接打开的网盘地址**，下面是原因与出口」。

实拍（B2 段）：

```
XDGAME 官方盘口  0 / 10 条可用
源站对这款游戏要求登录 / 权限才能取到网盘地址（返回「你没有权限下载」）。
这不是本站抓取失败 —— 去源站页面登录后即可获取。      [前往源站页面 ↗]
```

### 三页共享

弹窗 DOM 放在 `page-assets.js` 抽取的 **OVERLAY** 区间（`<div class="mask">` → `</nav>` 之间），
所以 `index.html` / `emulator.html` / `unpack.html` **三页自动都有**。
★ 改主源必须重建派生页，否则那边没有弹窗**而且不报错**。

---

## 六、改动清单

| 文件 | 改动 |
|---|---|
| `fetchers/jidiSigned.js` | **新增** —— 机地 websign 签名 + 分页抓取 |
| `fetchers/jidiTopics.js` | **新增** —— 话题详情页解析（`postsOf` / `NETDISK`） |
| `fetchers/download.js` | **新增** —— XD/机地双源下载链接解析；`normHost` / `fixMojibake` / `needAuthOf` |
| `data/jiditopics.js` | **新增** —— `data/jidi-topics.json` 读取层 |
| `data/spec-match.js` | **新增** —— 解包 JSON → 可适配游戏（四维判定 + 热门优先 + 来源标注） |
| `data/spec-req.json` | **新增** —— 16,575 款真实要求库（`tools/build-spec-req.js` 生成） |
| `data/gamesDb.js` | **新增** —— 端游库读取层 |
| `tools/build-jidi-topics.js` | **新增** —— 抓机地全量话题 |
| `tools/build-spec-req.js` | **新增** —— 按 appid 合并机地/Steam 要求 |
| `tools/sync-jidi-library.js` | **新增** —— 机地侧并入库 |
| `tools/unpack-sections.js` | 结果页改手机专区版式 + 热门优先 + 来源标注 |
| `tools/build-unpack-page.js` | `.up-mc*` 样式；intro 文案改「真实要求库 / 无推断值」 |
| `tools/page-assets.js` | OVERLAY 区间承载共享下载弹窗 |
| `public/index.html` | 下载弹窗（CSS + DOM + JS）；详情页 `⬇ 网盘下载` 主按钮 |
| `server.js` | `/api/download`（含 `needAuth`）、`/api/jiditopics/*`、`/api/spec/*` |
| `tools/test-download.js` | **新增** —— 96 条（本版 80 → 96） |
| `tools/preview-v1022.js` | **新增** —— 浏览器实拍 44 条 |
| `tools/_counterproof-v1022.js` | **新增（临时）** —— 8 处护栏反证 |

---

## 七、验证

### 静态防线

```
$ node tools/run-all.js
静态防线：20 套
通过 1319 / 失败 0
```

### 浏览器实拍（`node tools/preview-v1022.js`）

```
通过 44 / 失败 0
截图：_preview/v1022-unpack-cards.png · v1022-dlpop-unpack.png
      v1022-dlpop-needauth.png · v1022-dlpop-drawer.png · v1022-dlpop-mobile.png
```

关键条目：

| 断言 | 实测 |
|---|---|
| 封面图**真的加载出来**（naturalWidth > 0） | 12/12 张已解码 |
| 卡片圆角与手机专区一致 | 13px |
| 弹窗中心 `elementFromPoint` 落在弹窗内 | 命中 `DIV.l` ｜ z=110 > drawer=100 |
| XD 组解析出多个盘口 | **6 / 6 条可用** |
| 机地组 | **5 / 5 条可用** |
| 权限受限样本给出原因 + 出口 | `0 / 10 条可用` + `.dl-blocked` + `前往源站页面 ↗` |
| 窄屏链接列表单列 | 1 列（11 行） |

### 反证（`node tools/_counterproof-v1022.js`）—— 8/8 打坏即变红

| # | 打坏什么 | 变红的断言 |
|---|---|---|
| 1 | `normHost` 不剥 `.com` | ★ hostname `xdgame.com` 归一成 xdgame |
| 2 | `parseXdDown` 不再产出 version | ★ 版本串按「`<h4>版本介绍</h4><p>…</p>`」定位 |
| 3 | `.dlpop` z-index → 90 | ★★ 弹窗层级必须高于详情抽屉 |
| 4 | 解包页默认排序回 `'scale'` | ★ 解包页默认排序是 hot |
| 5 | `流畅` 规则回 `ramM>=2 \|\| stM>=3` | ★ 4GB 内存打 4GB 要求 → 「可跑」 |
| 6 | `needAuthOf` 恒 false | ★ 全部盘口都报权限 → needAuth 成立 |
| 7 | `needAuthOf` 判定过宽 | ★ 只要有一条解得出来，就不能弹「要登录」 |
| 8 | 删掉 `.dl-blocked` 样式 | ★ .dl-blocked 有样式 |

★ **第 3 / 8 条是「假绿」重灾区**：层级被压住、样式被删掉时，
所有「元素存在」类断言**照样全绿**，只有 `elementFromPoint` 与样式声明检查能发现。

---

## 八、本版修掉的两个「静默错源」

### 1. `parseDetailUrl()` 与 `XD_HOSTS` 的键不同口径 → 静默 404

`parseDetailUrl()` 返回 **hostname**（`xdgame.com`），而 `XD_HOSTS` 的键是 **短名**（`xdgame`）
⇒ `XD_HOSTS['xdgame.com']` 为 `undefined` ⇒ 落到兜底 `XD_HOSTS.xdgamer`
⇒ **拿 xdgame 的链接去 xdgamer 站上找**（两套内容独立的平行站）⇒ `HTTP 404`。
报错只有一句 `XD 详情页 HTTP 404`，完全看不出是「键没归一」。

修法 `normHost()`，★ 注意**先砍路径再砍 `.com`**：
顺序反了的话 `www.xdgame.com/game/1.html` 不满足 `/\.com$/`（结尾是 `.html`），整个串留着 → 又静默兜底。

### 2. 「先剥后缀再剥路径」的通用教训

凡是链式清洗，每一步都要问一句：**中间态还能不能匹配上后续规则**。

---

## 八·补、顺手查出的一类**假绿**：两个套件的退出码恒为 0

做反证时发现：`tools/test-report.js` 与 `tools/test-alias-guard.js`
**只打印 `结果：n / m 通过`，却没有 `process.exit(fail ? 1 : 0)`** —— 无论断言挂多少条，**永远 exit 0**。

后果是双重的，第二重才致命：

| 影响 | 表现 |
|---|---|
| ① 单独跑时红绿不分 | `node tools/test-report.js; echo $?` → `0` ⇒ **红的被当成绿的**。<br>而 `WORKFLOW.md` 步骤 8 就是让人**单独跑它**的 |
| ② ★★ **反证对它完全失效** | 反证判据是「退出码非零」⇒ 打坏了也验不出来，**等于这道护栏验不了** |

**为什么一直没被发现**：`run-all.js` 靠**解析输出**里的 `n / m` 汇总，
所以**全量跑仍然是对的** —— 缺陷只在「单独跑」和「做反证」两条路上爆。

**修法（三件一起做）**：

1. 两个套件末尾补 `process.exit(fail ? 1 : 0)`；
2. `run-all.js` 加**前置检查** `exitTiedToFailures()`，逐个扫套件源码，
   把不达标的名字**点名报出**并计入失败（现在 20/20 全达标）；
3. `test-report.js` 加 5 条断言钉住「那道前置检查还在、且 run-all 自己也挂退出码」。

★ 只认「挂在失败数上」的写法：`process.exit(fail ? 1 : 0)` / `if (fail) process.exitCode = 1`。
**`catch` 里的 `process.exit(1)` 不算** —— 那只覆盖「脚本崩了」，不覆盖「断言失败了」。

★ 反证脚本自身也踩了一次：想删掉那个前置检查函数，写成 `replace('exitTiedToFailures','noSuchFn')`
—— 该标识符在文件里出现 **2 次**，**`String.replace` 只替第一处** ⇒ 调用处没改 ⇒
报「打坏了还是绿」。**差一点去"修"一个本来正确的护栏。**
⇒ 需要改全部出现时必须用 `/g`，且**替换后先验命中数，不符就报错退出**。

---

## 九、遗留

- **v10.22 待办**（见 `WORKFLOW.md` roadmap）：解包匹配**字段校准** ——
  等用户给解包 JSON 样本，**只改 `data/spec-dict.js`**，界面与接口不动。
  `DICT_VERSION` 仍为 `'v10.20'`（那是**词典自己的版本**，不是站点版本号，不跟发版 +1）。
- 机地侧 `downloadable` 只有 **364** 条（有可下载资源帖的话题）。
  数量少是因为多数话题是**讨论帖**而非**资源帖** —— 这是源站内容结构，不是抓取缺失。

---

## 十、发布（v10.22）—— v3 无法覆盖，LIVE 切到平台域名

### 结果：**没有覆盖成功**，但**确实有一个链接正在跑 v10.22**

用户确认发布后，`workbuddy_sites_deploy` 直接**硬拒绝**：

```
❌ 应用预留域名 gamehub-agg-v3.app.workbuddy.host 未绑定到本次发布环境，
   为避免返回仍指向旧内容的链接，本次发布已停止。
```

与 **v10.17 / v10.18 / v10.21 三次同因**（旧 sandbox 过期 ⇒ 只能新建 app，链接会变）。
前三次的做法都是「新建 app」；本轮用户在两个选项里明确选择了
**「先用已能访问的旧链接」、不新建**。

于是把 `tools/report.js` 的 `LINKS.LIVE` 从 `gamehub-agg-v3` 切到
**`https://36aa37e911e6447eb86eb187240daff2.app.workbuddy.host/`**。

### 为什么选它：**判据不是 HTTP 200**

四个域名**全部返回 200**，只看状态码会把三个「尸体」都判成 LIVE：

| 域名 | HTTP | index.md5 | 与本地 v10.22 | `/api/jiditopics/stats` | `/api/download` |
|---|---|---|---|---|---|
| **36aa37e9…** | 200 | `66fa1bf2fb` | **✅ 逐字节一致** | ✅ **17,220 条** | ✅ 6 条 |
| gamehub-agg-v3 | 200 | `cb2c07b3b4` | ❌ | ❌ 404 | ❌ 404 |
| gamehub-agg-v2 | 200 | `73a715a1a4` | ❌ | ❌ 404 | ❌ 404 |
| gamehub-agg-join | 200 | `55dcb8f7ff` | ❌ | ❌ 404 | ❌ 404 |

★ 不只比首页：`/` · `/unpack.html` · `/emulator.html` **三个页面全部与本地逐字节一致**；
数据文件 `builtAt` 也对得上（`2026-09-18T09:04:23.923Z`）——
比首页 md5 更能证明「连数据层一起换新了」。

### ★ 一个必做的验证：「它会不会跟着本地变？」

**不验这个，就不知道这个链接能用到什么时候**（是本项目的核心风险：域名 200 但内容停更）。
做法是**安全探针**：

1. 本地写一个随机 token 到 `public/__synctest.txt`；
2. 远端取 `/__synctest.txt`（等 0s / 8s / 20s 各一次）；
3. **无论结果都在 `finally` 里删掉本地文件**。

结果：**远端三次全是 404**（且 404 body 是 node 自己的 `{"ok":false,"error":"Not Found"}`，
说明服务器活着、只是没有这个文件）。

⇒ **它不跟随本地改动：是一份快照，不是自动同步环境。**
**下次发布仍必须走发布流程** —— 这条必须写进登记，
否则下版又会有人以为「改完本地就自动上线」（本项目踩过这个坑）。

### 登记（1 处真源 + 6 处文档）

`LINKS.LIVE` 是**唯一真源**，其余全部跟着它走：

| 文件 | 改了什么 |
|---|---|
| `tools/report.js` | `LINKS.LIVE` 换域名；v3 降级进 `DEPRECATED`；上面 5 条判据写进注释 |
| `tools/test-report.js` | 断言改成**从 `LINKS` 现算**、不再写死域名；新增「LIVE 不许是任何弃用域名」「记着它是快照」等 |
| `tools/audit-apps.js` | 写死的别名改成语义化的 `LEGACY_ALIASES`（靠 `includes` 自动去重） |
| `tools/verify-online.js` | 默认目标从停更的 v2 换成当前 LIVE |
| `README.md` · `WORKFLOW.md` · `HANDOFF.md` · `CODEX-HANDOFF.md` · `CODEX-INDEX.md` | 链接表 + 弃用清单 + 「不跟随」警告 |

★ **不写第二份域名枚举**：`test-report.js` 判「LIVE 是不是弃用域名」时，
**从 `DEPRECATED` 清单现抠**（`matchAll`），并紧跟一条「抠到了几条」的断言 ——
否则抠不到时 `depAny` 恒为 `false`，那条断言就**恒真 = 假绿**。

### 下一步

⚠️ `36aa37e9…` **未登记**在 `.workbuddy/applications.yaml`。
**v10.23 发布时优先选「新建 app」**，拿一个已登记、后续更新会跟随的正式链接。

### 顺手修掉的两个**断言侧**问题（都不是功能 bug，但会骗人）

| 现象 | 根因 | 修法 |
|---|---|---|
| 「仍登记 join」**假红** | `SRC.slice(indexOf('DEPRECATED'), +1400)` —— `DEPRECATED` 这个词**在 report.js 顶部注释里也有**，`indexOf` 命中注释，1400 字只够到第 2 条 | 改用**结构地标** `const LINKS = {` → `const GITHUB`，并加一条「切片拿到内容（>200B）」的断言 |
| 「改文档链接断言」那条 Edit **报成功但没落盘** | 同文件批量编辑时的竞态 | 跑测试时从**报出的断言名缺后缀**发现 ⇒ 改完**立刻回读验证**；已写进 `PITFALLS.md` 第 40 条 |

★ 两条都指向同一句：**改完必须验「有没有真的改到」**，不能只看工具返回的「成功」。
（这条与第 34 条 `replace(str,str)` 只替第一处是同一类病。）
