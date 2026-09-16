# CODEX-DONE-v10.9 —— 机地「MOD / 修改器」社区帖全量接入

> 用户原话：
> 「补充MOD：`https://jidiyouxi.com/modify/list` 中 `<div class="text-4.5 …">MOD</div>` 里 自动轮询页面获取
>  补充修改器：`<div class="text-4.5 …">修改器</div>` 同上」
>
> 两个追问的回答：
> · 落位 → 「我认为这个可以并入到手游的那块」
> · 范围 → 「做成跟手游专区那一样弹窗里填充内容」（即：**全量**取回，正文也要，弹窗里铺满）

本轮完成的是**数据层全链路 + 可视化预览**；正式并进站点等用户看过预览后确认。

---

## 一、★ 最有价值的发现：机地的写接口第一次被拿下（签名机制完整还原）

机地的列表页是 **SSR 首屏 + 客户端翻页**。翻页打的是：

```
POST https://jidiyouxi.com/api/misc/post_list?websign=<sign>
Content-Type: text/plain
```

直接照业务参数发 POST，无论参数对不对、签名算不算，服务端**永远只回同一句话**：

```json
{"ret":-1,"errcode":-1,"msg":"请求参数错误"}
```

签名算错也回这句 —— 这是本次排查最费时间的点（没有任何可区分的错误信息）。

### 签名算法（还原自 `app.<hash>.js` 模块 67052）

```js
sign = websign = "v2-" + md5( String(body.h_m || 0) + md5( JSON.stringify(body) + "YhD6TCs9VpAl" ) )
```

`md5` 是站点自带的那份 npm md5（blueimp 风格），输出小写 hex —— 与 Node `crypto` 的 md5 **完全等价**，
所以服务端脚本可以零依赖复算。

### ★★ 真正的拦路虎不是签名，是 body 必须是「整份 env 展开」

```js
body = { ...env, ...auth, ...业务参数, h_ts: Date.now(), h_ch: 'other' }
```

`env` 就嵌在 `/modify/list` 页面 HTML 的 `<script id="appState">` 里，**含服务端每次下发的 `h_did` UUID**。

| 实测 body | 结果 |
|---|---|
| 只发业务参数 `{sort, limit, resource_type, next_cb}` | `请求参数错误` |
| 业务参数 + `h_did` | `请求参数错误` |
| 业务参数 + `h_did` + `h_m` + `h_ch` + `h_ts` | `请求参数错误` |
| **`{...env, ...业务参数, h_ts, h_ch}` 全量展开**（22 个键） | ✅ `ret:1`，正常返回 |

结论：**服务端是拿 env 里的字段做校验**（`h_did` / `host` / `app` 等），不是单纯核对我们自己算的签名。
所以流程必须是「**先抓一次列表页 SSR 取 env → 再开始翻页**」，env 在同一轮抓取里复用。

### 分页与配额（实测）

| 项 | 值 |
|---|---|
| 分页参数 | `next_cb` 原样回传，形如 `'{"offset":20}'`；也可直接用 `JSON.stringify({offset:N})` |
| `limit` 上限 | **100**（传 200 仍只回 100） |
| 页签 → `resource_type` | 手游 = 1 · **MOD = 2** · **修改器 = 3** |
| 源站总量 | 手游 53,310 · **MOD 7,825** · **修改器 1,118** |

---

## 二、抓取实现

### 新增 `fetchers/jidiModify.js`
`getEnv()`（取并缓存 env，TTL 10 分钟）· `websign()` · `postList()` · `poll(type)`（自动翻页到取完，
180ms 页间隔、按 id 去重、防死循环）· `shape()`（条目归一化）· `extractLinks()`（网盘直链抽取）。
全部纯函数都 `module.exports` 出来，供离线单测。

### 新增 `tools/fetch-mods.js`
轮询 → 归一化 → 匹配端游库 → 写 `data/mods.json`。支持 `--max / --only / --offline`。

实测（全量）：

```
MOD    ：源站 7825 条 → 实取 7825 条（59.9s，79 页）
修改器 ：源站 1118 条 → 实取 1118 条（8.1s，12 页）
端游库 ：15302 款 → 名称索引键 29229 个（按 / 分段）

条目 8943 ｜ 命中端游库 7076（79.1%）
   含下载链接 8936 条（99.9%）· 链接合计 13,390 条
```

原始缓存 `data/_mod-raw.json` **gzip 压缩后 17.9MB**（未压缩实测 87.8MB，差 6 倍）。

---

## 三、★ 匹配率 55% → 79.1%：两个隐蔽的键构造 bug

第一版跑出来匹配率只有 **55%**，逐条核对后定位到两个问题，**都在「匹配键」这一层**：

### ① 长度护栏照搬英文场景，把 2 字中文名整类误杀

`tools/fetch-trainers.js` 里写的是 `k.length >= 3` —— 那条规则在英文名场景是合理的（`ab` 这种噪声键），
但套到中文会直接丢掉所有 **2 字游戏名**。实测 `剑星` / `鸣潮` / `仁王` / `传送门` 全部 MISS，
而它们在端游库里明明各有 2~3 条。

**修**：按字符集区分 —— 含 CJK 放行 **2 字**，纯 ASCII 仍要求 **≥3**。

### ② 条目侧的游戏名**同样**是 `/` 拼接串

端游库 title 是 `艾尔登法环/ELDEN RING` 这种多语言拼接串 —— 这一点 fetch-trainers.js 已经踩过并注释了。
但**这次踩的是镜像的坑**：机地侧也会这么写。

```
生化危机9：安魂曲/Resident_Evil_Requiem        → normKey 吃掉 `/` → 生化危机9安魂曲residentevilrequiem
龙之剑:觉醒/DragonSword : Awakening            → normKey 吃掉 `/` → 龙之剑觉醒dragonswordawakening
```

拼成怪物后与库侧任何一段都对不上。**修**：条目侧也按 `/` 分段逐个试，命中即返回。

单独执行 ① 与 ② 的效果（离线实测）：

| | 匹配率 |
|---|---|
| 初版 | 55.0% |
| 仅修 ① / ② 之一 | ~66% |
| **两个都修** | **79.1%**（救回 2,160 条） |

**匹配逻辑抽到 `data/mod-match.js`**（`normKey` / `keyUsable` / `buildLibIndex` / `matchLib`），
单一真源、可离线单测，`tools/fetch-mods.js` 只 require 不重复实现。

---

## 四、数据形态

`data/mods.json`（23.1MB / 8,943 条）：

```js
{
  id, kind: 'mod' | 'modifier',
  title,                                    // 帖子标题
  game,                                     // ★ topic.topic —— 这条 MOD 属于哪款游戏
  cover,                                    // 端游库封面优先，否则用 topic.cover 拼机地封面
  author, ct, ut, pv, favors,               // 作者 / 发布 / 更新 / 浏览
  content,                                  // 正文（≤6000 字，含完整使用说明与按键表）
  links: [{ url, kind: '夸克网盘' | '百度网盘' | … }],   // ★ 用户真正要的东西
  libId, libTitle, libUrl,                  // 端游库匹配结果
  url,                                      // 机地原帖
}
```

**关键字段说明**：
- 条目**本身不带封面 URL**，只有 `topic.cover`（数值 id）→ 需拼 `https://img2.52jidi.com/topic/cover/id/{id}/sz/src`
- 链接域名分布：`pan.xunlei.com` 8238 · `pan.baidu.com` 1711 · `nexusmods.com` 1297 · `pan.quark.cn` 160 …
  （另有 github / gta5-mods / youtube / reshade 等非网盘链接，统一标为「其他链接」）
- 覆盖 **883 款游戏**；条目数 TOP：赛博朋克2077 **719** · 上古卷轴5 557 · GTA V 536 · 模拟人生4 394 · 星露谷物语 347

### ★ 与既有 `data/trainers.json` 的关系（互不替代，别混）

| | `trainers.json`（既有） | `mods.json`（本轮新增） |
|---|---|---|
| 来源 | Game Cheats Manager（英文站） | **机地社区帖** |
| 规模 | 3,589 条 / 5 源 | 8,943 条 / 2 类 |
| 下载地址 | ❌ 无（官方走一次性签名链接） | ✅ **13,390 条网盘直链** |
| 定位 | 「有没有 / 什么版本」 | 「**怎么拿到**」 |

---

## 五、新增查询层与 API

`data/mods.js`（仿 `data/trainers.js`：惰性加载 + mtime 失效）：
`list(q/kind/sort/all/limit/offset)` · `stats()` · `byLib(libId, kind)` · `byGame(game)` · `get(id)` · `topGames(n)`。

`server.js` 新增 5 条路由（默认只给命中端游库的，`all=1` 放开全量）：

| 路由 | 说明 |
|---|---|
| `GET /api/mods/stats` | 概览（总数 / 分类 / 匹配率 / 链接数） |
| `GET /api/mods/list` | 列表（`q` `kind` `sort=new\|hot\|game\|title` `all` `limit` `offset`） |
| `GET /api/mods/item` | 单条 |
| `GET /api/mods/top` | 条目数最多的游戏 |
| `GET /api/mods/match` | 某款游戏的 MOD/修改器（抽屉用，精确 → 子串兜底） |

已用服务重启 + curl 实测通过。

---

## 六、预览页（本轮交付物，等确认）

`_preview/mods-preview.html`（3.19MB，自包含单文件）

- **样式不是重写的**：直接抽 `public/emulator.html` 的 `<style>` 整块内联 → 预览观感 = 并进去之后的观感，
  杜绝「预览好看、并进去变样」。
- 内容：KPI 条 · 「条目最多的游戏」横滑榜（点击筛选）· 类型/排序/搜索/「仅看命中端游库」筛选条 ·
  卡片网格（复用 `.emu-card` 视觉语言）· **右侧抽屉铺满正文**（网盘链接逐条带「复制」按钮、正文内 URL 可点）。
- 内嵌样本 **1,374 条**（每类最新 400 + 前 12 款游戏各 60 条）—— 只取「最新」样本会偏
  （赛博朋克那 719 条多是几个月前发的，按时间切会被切干净，搜出来像抓漏了）。
  页面上已标注「本页只内嵌 N 条，全量走 `/api/mods/list`」。
- 无头浏览器验收：**JS 报错 0**；抽屉开启正常（标题/游戏/3 个链接/正文 407 字）；类型与搜索筛选均生效。

---

## 七、第 9 道测试防线 `tools/test-mods.js`（77 条）

这块出错的代价特别大，因为**错的都是静默的**（签名错、body 少字段都只回同一句「请求参数错误」；
匹配键错只是卡片变「未关联」，列表照样出）。分五组：

| 组 | 覆盖 |
|---|---|
| **A** websign | 与还原式逐字一致 · 确定性 · `v2-`+32hex 格式 · body 变化签名随之变化 · `h_m` 缺失按 0 · **sign 顺序敏感性** |
| **B** 匹配键 | 2 字中文放行 / 1 字中文拒绝 / 2 字 ASCII 拒绝 · 库侧与条目侧**双向** `/` 分段 · 不误配守卫 |
| **C** 链接提取 | 真实正文抽 3 条且类型正确 · `?pwd=` 完整保留 · 中文句号/括号截尾 · 去重 · 单条上限 12 · 裸域名不抓 |
| **D** shape | id 字符串化 · kind 映射 · 封面拼接 · `topic.cover` 缺失不产出 `id/null` · 正文截断（含提示本身 ≤6000） |
| **E** 真实数据 | 8,943 条字段完整性 · cover 一律 https · 命中必有 libUrl · 时间戳是秒级 · 分页不重叠 · sort 严格倒序 · `topGames` 降序且 `total = mod + modifier` |

**九道防线全绿**：结构 **128** · 行为 **118** · emuhub **118** · 布局 **77** · 别名 **7** · saves-match **44** ·
search-ui **44** · date-norm **47** · **mods 77** —— 合计 **660 条**。

---

## 八、新增 / 改动文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `fetchers/jidiModify.js` | 新增 | 机地 post_list 签名直调 + 翻页轮询 |
| `data/mod-match.js` | 新增 | 匹配键与索引（单一真源，可离线单测） |
| `tools/fetch-mods.js` | 新增 | 全量轮询 → 匹配 → 落盘（`--max/--only/--offline`） |
| `data/mods.js` | 新增 | 查询模块 |
| `tools/preview-mods.js` | 新增 | 预览页生成器（抽线上 `<style>` 保证同源） |
| `tools/test-mods.js` | 新增 | 第 9 道防线（77 条） |
| `data/mods.json` | 新增 | 8,943 条 · 23.1MB |
| `data/_mod-raw.json` | 新增 | 原始响应缓存（gzip 17.9MB，供 `--offline` 重跑匹配） |
| `_preview/mods-preview.html` | 新增 | 预览页 3.19MB |
| `_preview/mods-preview-top.png` / `-drawer.png` | 新增 | 验收截图 |
| `server.js` | 改动 | +1 require、+5 路由（整块新增，未触碰既有路由） |

**未改动**：`public/index.html`、`public/emulator.html`、`tools/emulator-sections.js` ——
**前端一行未动**，等用户确认落位后再并。因此九道防线里涉及前端指纹的用例全部原样通过。

---

## 九、待确认 / 下一步

1. **落位**：用户答「并入到手游的那块」。需要定的是具体形态 ——
   ① 在「手机专区」加第 6 个页签「MOD」（视觉与「手游中心」一致）；
   ② 或并入「手游中心」列表（同一张网格里混排 / 或按游戏归并后挂徽标）。
   预览页按 ① 的观感做的，可直接对着看。
2. **修改器页签的处置**：机地这 1,118 条（带下载）与既有 GCM 3,589 条（无下载）同名不同源，
   是并列展示还是合并成「来源」维度，需用户定。
3. **每日自动化**：是否把 `node tools/fetch-mods.js` 挂进既有的「GameHub 内容库每日自动同步」。
   （全量一轮约 **70 秒**、约 91 次请求。）
4. **未关联端游库的 1,867 条**：多数是手游向作品（明日方舟：终末地 / 鸣潮 / 绝区零…），
   端游库本就不收录，属正常；若要补，需先扩端游库。
5. `data/mods.json` 23.1MB，是项目内最大的单体数据文件（次大 `games.json` 5.8MB）。
   若在意体积，可把 `content` 上限从 6000 降到 2000（链接 99% 出现在正文前 300 字，不影响可下载性）。
