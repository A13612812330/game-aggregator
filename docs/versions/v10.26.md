# v10.26 —— 机地「话题资源专区」抓取补全（本体 / mod / 修改器）

> 日期：2026-09-20 ｜ 上一版：v10.25（详情页/搜索弹窗六项优化）
> 关联文件：`fetchers/jidiPosts.js`（新增）· `fetchers/jidiSigned.js` · `fetchers/download.js` ·
> `server.js` · `public/index.html` · `tools/test-v1026-jidiposts.js`（新增）·
> `tools/preview-v1026.js`（新增）· `tools/_counterproof-v1026.js`（新增）

## 用户原话

> 「发现个小问题，现在没有抓取到机地的下载链接我提供元素你补充爬取（有导航栏进行划分
> `<div …>本体 / mod / 修改器</div>`）… 然后列表中的其中一个元素是（…）下载的链接是（…）」

用户给的 HTML 揭示了机地话题页的真实结构：**顶部三个 tab（本体 / mod / 修改器）**，
下面每张卡片是一个资源帖（标题 + 迅雷 / 百度 / 夸克三个盘口按钮）。

---

## 一、问题定位：不是「没抓到」，是「只抓到了一小半」

先做**量化对照**，别急着改代码（实测 2026-09-20）：

| 游戏 | 老链路（解析详情页 SSR） | 新链路（话题资源接口） |
|---|---|---|
| 剑星 tid=171085167 | 10 帖 → **25 条链接**，全是本体 | **本体 22 帖 / mod 190 帖 / 修改器 4 帖 → 210 条链接** |
| 渔力全开 tid=2117239899 | 10 帖 → 27 条链接，全是本体 | 本体 29 / mod 2 / 修改器 2 |

根因有两条，都不是 bug 而是**结构性上限**：

1. **SSR 只嵌首屏 10 条**，而话题下实际有 336 条帖子（`count=336`）。
   `topic.ssrData.postList` 就是那 10 条。
2. **这 10 条不分专区**，且偏本体 —— `resource_type` 实测分布 `{1:15, 2:83, 3:1, 0:1}`
   混在一页里，而 SSR 恰好几乎只覆盖本体那部分。

> ★ 顺带修正一条**旧注释的误判**：`jidiTopics.postsOf()` 的注释写着
> 「机地没有独立的下载按钮，下载链接写在帖子正文里」。前半句是错的 ——
> 机地**有**结构化的资源专区，只是我们一直在读那个「碰运气」的入口。

---

## 二、接口还原：三个能误导人的坑

接口还是 `POST /api/misc/post_list?websign=<sign>`（与 `jidiModify.js` 同一个），
但**业务参数完全不同** —— 这里按话题取：

```
body = { ...env, tid, resource_type, c_types:[1,2], sort, offset, limit, next_cb, h_ts, h_ch }
返回   { list[], count, more, next_cb }
```

还原自前端 chunk `pages-topicDetail.<hash>.js`：

```js
getTopicPosts({ tid: parseInt(v), folder_id: parseInt(rn),
                c_types: tt.SUPPORT_POSTS_CTYPE, sort: En,
                t: r.t, next_cb: r.next_cb, limit: 12 })
```

### 坑 ① `folder_id` 是死参数

详情页 SSR 的 `folder_list` 给的是
`[{folder_id:7,name:'本体'},{6:'mod'},{8:'修改器'},{10:'讨论求助'}]`，
前端也确实把它塞进了请求 —— 但实测 **folder_id=6/7/8/10 四个值返回的首条 id、
`count`、`next_cb` 一模一样**。服务端根本不看它。

⇒ 专区过滤**只能靠 `resource_type`**。（本模块仍记着 folderId，但只作对标文档。）

### 坑 ② 参数名是 `tid`，不是 `topic_id`

实测 `topic_id=<tid>` → `{"ret":-1,"msg":"出现了一个小问题，请稍后再试"}`，
换成 `tid` → `ret:1` 正常。同一个接口两种叫法只活一个，
而且**报错信息完全看不出是参数名问题**。

### 坑 ③ `c_types` 不能省

`SUPPORT_POSTS_CTYPE = [POST_TYPE.Post, POST_TYPE.GameReviewPost] = [1,2]`
（还原自 `app.<hash>.js`）。不传时服务端走默认口径，会混进 `resource_type=0`
（`c_type=3` 的评论帖）—— 实测 `sort=new` 不传 c_types 时**首条标题是空字符串**，
直接铺到界面上就是「一行没有名字的资源」。

### 生效验证（最强的旁证）

`resource_type=2`（mod）实测 `count=190`，而话题自身的 `currentTopic.mod_cnt` **也是 190** ——
两个不同来源的数字逐位吻合，是「resource_type 就是专区过滤」最硬的证据。

---

## 三、实现

### 3.1 `fetchers/jidiSigned.js` —— 拆出 `envPath`

**详情页的 `appState.env` 结构与列表页不同**：实测 `/topic/detail/<tid>` 的 env 只有
`{h_m, h_ts, h_dt, h_did, token, h_app, enable_etag}` ——**没有 `host`**。
而 `getEnv()` 的健全性校验正是 `if (!env || !env.host) throw`，
于是「拿详情页当 env 来源」会直接抛

```
机地页面未内嵌 env（可能改版）: /topic/detail/171085167
```

把人往「源站改版了」的方向带 —— 实际只是取错了页面。

⇒ `signedPost({ api, referer, envPath, … })`：**取 env 的页面**与 **Referer 头**分开传。
`envPath` 缺省退回 `referer`，老调用点行为不变。

### 3.2 `fetchers/jidiPosts.js`（新增）

```
SECTIONS = [
  { key:'body',     name:'本体',   folderId:7, resourceType:1 },
  { key:'mod',      name:'mod',    folderId:6, resourceType:2 },
  { key:'modifier', name:'修改器', folderId:8, resourceType:3 },
]
```

- `fetchSection` / `fetchSectionAll` —— 单专区取数（含分页）
- `topicPosts({ tid, sort, perSection })` —— **三专区并行**（实测 624ms；串行 1.2s+），
  用 `allSettled`：单专区失败**带 `error` 返回**而不是假装「这个专区没有资源」
- `shapePost` / `tagsOf` / `coverOf` / `gameOf` / `sortPosts` —— 纯函数，可离线断言
- `countsOf(tid)` —— 只查条数不拉正文（轻量预判用）

**分区独立失败**是刻意设计：源站可能只锁某一个专区，不能因为一个失败就让三个都空。

### 3.3 归一化里的三个「静默空值」

| 字段 | 真实位置 | 写错的后果 |
|---|---|---|
| 标签 | **`game_info.resource_tag`** | 读顶层 `p.resource_tag` → 恒为 `[]`，「已测试 / 迅雷网盘免费高速」徽标从来没显示过，**零报错** |
| 封面 | `imgs` 是 **JSON 字符串** | 只判 `Array.isArray` → 恒为假 → `cover` 静默变 null，卡片退化成纯文字 |
| 游戏名 | `topic` 是 **JSON 字符串** | 不 parse → 得到一整串 JSON。parse 之后还能**省掉一次 834KB 的详情页请求** |

> `postsOf()` 里的 `p.resource_tag` 就是第一种 —— 本次一并修正在新模块里。

### 3.4 `fetchers/download.js` —— 接口优先 + SSR 兜底

```js
async function jidi(tid, { sort = 'hot', perSection = 50 } = {}) {
  try { … jp.topicPosts(…) → engine:'api', sections:[…] }
  catch (e) { … jt.postsOf(tid) → engine:'ssr', fallbackReason }
}
```

保留 SSR 是**刻意的**：接口依赖 websign + env（服务端校验 `h_did`），
SSR 只依赖页面结构 —— 两者坏法不同。且 `engine` 字段如实回传，
**不静默降级**（否则下次出问题会以为一直在用接口）。

`sections` 同时给 `count`（源站报的专区总数）与 `returned`（本次取回），
**两个数必须分开给** —— 只给一个会让界面数字对不上。

### 3.5 前端：按专区分块

`dlJidiGroups(jd)` 取代原来那个混排的 `dlSection(...)`：

- 每个专区一个小节：`<b>本体</b> <span class="c">22 帖</span> <a class="go">源站专区 ↗</a>`
- 每专区铺前 6 条（`DL_SEC_CAP`），其余说明「另有 N 个地址未展示」
- ★ **单位必须写清**：帖 ≠ 网盘地址（一帖常带 2~3 个盘口）。
  混用「条」会让「另有 134 条 / 源站共 190 条」读起来自相矛盾（前者是地址、后者是帖）
- ★ **兜底**：拿不到 `sections`（老服务 / SSR 路径）就退回原来那一整块 ——
  新增的分区逻辑**不能把本来能显示的链接变成空白**
- 三块共用一层 `.dl-grp`（自带「机地」源标签与总条数），不是三个 `.dl-grp` ——
  否则同一个来源徽标会重复三次

---

## 四、验证

### 静态防线

`node tools/run-all.js` → **25 套 / 1638 通过 / 0 失败**（新增 `test-v1026-jidiposts.js` 65 条）。

### 反证（`tools/_counterproof-v1026.js`，6 条全部「打坏即变红」）

| # | 打坏的东西 | 变红的断言 |
|---|---|---|
| ① | `tagsOf` 去掉 `gi.resource_tag` 那支 | ★ 标签取自 game_info…（得到 0，期望 2） |
| ② | `coverOf` 去掉 JSON 字符串分支 | ★ imgs 是 JSON 字符串也能取到封面（null） |
| ③ | `sortPosts` 去掉「有标题优先」 | ★ 无标题帖沉底（得到 a，期望 x） |
| ④ | `SECTIONS` 的 resourceType 改 4 | ★ 三个专区的 resource_type（得到 "4,2,3"） |
| ⑤ | `openDownload` 去掉 sections 兜底 | ★ 拿不到 sections 时退回原来的一整块 |
| ⑥ | 删掉 `.dl-secs` 样式 | ★ .dl-secs 有样式 |

> ★ 反证脚本自己也踩了一次坑：转正到 `tools/` 后 `TEST` 路径写成裸文件名，
> `execFileSync` 找不到文件、`runTest` 静默返回空串 ⇒ **六条「全部没变红」**，
> 看起来像断言全假、其实是脚本自己跑不起来。
> 已加 `ranOk()` 门禁：拿不到汇总行就明确报「测试没跑起来」。

### 浏览器实拍（`tools/preview-v1026.js`，10 条）

真实页面里唤起下载弹窗（剑星），实测：

```
★ 恰好三个专区块（本体 / mod / 修改器）        — 3
★ 每个专区都真的列出了条目                   — [6,6,6]
★ 每个专区块真占版面                         — [[542,260],[542,260],[542,260]]
★ 有可直接点开的网盘地址                     — 15
  「机地」源标签只出现一次                    — 1
★ 无横向溢出                                 — -8
★ 专区徽标写「N 帖」而不是「N 条」            — 22 帖 | 190 帖 | 4 帖
```

截图：`_test-out/v1026-dlpop.png`

### 在线冒烟（`JIDI_LIVE=1 node tools/test-v1026-jidiposts.js`，70/70）

真请求机地接口：本体 22 / mod 190 / 修改器 4，`perSection` 上限生效（实测 returned=20）。

---

## 五、边界与未做

- **每专区默认只取 50 帖**（一页 100）。赛博朋克2077 的 mod 有 715 帖，超出部分
  在界面上如实标「源站共 N 帖」并给源站出口，**不假装已全量**。
- **「讨论求助」专区（folder_id=10）不抓** —— 那是问答帖不是资源。
- 机地话题页的「最近发布 / 最热」排序已支持（`sort=new|hot|reply`），
  但详情页下载弹窗**当前固定 hot**（与 SSR 的 `selectedSort` 一致）。
- 未动 `/api/mods/match`（那是离线 mods 库，与本次的实时接口是两套数据，各有用途）。
