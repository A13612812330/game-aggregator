# 踩坑全集 · 环境怪癖 · 数据层地图

> **这份文件的定位**：`WORKFLOW.md` 是「按什么顺序做」，`CODEX-INDEX.md` 是「哪版做了什么」，
> 本文是「**哪些地方会静默出错、出了错怎么认出来**」。
>
> 从 `.workbuddy/memory/MEMORY.md` 迁出（2026-09-18，该文件有 3,000 字上限，装不下细节）。
> **新增踩坑请写到这里**，并在 `MEMORY.md` 里只留一行指针。
>
> 通用方法论已沉淀为 skills（见文末），本文只记**本项目特有**的东西。

---

## 〇、环境怪癖（不知道就会白查半天）

| 现象 | 真相 |
|---|---|
| `grep`/`head`/`curl`/`sleep` 报 `command not found` | 本会话 shell 的 **coreutils 可能整批缺失**，只有 `node`/`git` 可用 ⇒ 文件与网络操作**一律走 `node`** |
| 会话内启的服务活不过一次工具调用 | `restart-server.js` 的 `detached + unref` 子进程会被回收 ⇒ 常驻服务只能用**后台任务**方式起 |
| 沙箱**静默拦 Edge** | 走 `tools/browser.js`（外部拉起 Chrome + CDP **9222** 再 `puppeteer.connect`） |
| 多套件连同一 CDP 抛 `detached Frame` | 浏览器侧干扰，**先单独重跑**那一个套件 |
| 含 puppeteer 的套件「像失败其实是超时」 | 默认 120s 会 SIGTERM ⇒ 必须**加大超时**且**分批**跑 |
| 「工具不回显」 | 本环境常态 ⇒ 要取输出就**落盘 + 回读**；删文件**先落盘列命中清单** |
| PowerShell 吞 git stderr ⇒ `exit=128` | **假阴性**。判 push 成败**只看 `git ls-remote` 的 sha == `git rev-parse HEAD`**，永不看退出码 |
| `execSync` 里 `git log --pretty=format:%h|%ad|%s` 静默失败 | 竖线被 shell 当管道 ⇒ **整串加引号**：`--pretty="format:%h|%ad|%s"` |
| 探 GitHub 时设 `GIT_TERMINAL_PROMPT=0` → 6 次重试全败 | 本机 git 走代理取不到凭据 ⇒ 会被**误判成「没推上去」**。偶发 `SSL unexpected eof` 是抖动，重试即可 |
| `_*` 前缀既是临时文件**也是既有资产** | `_preview-cards.html/js` **已入库** ⇒ 靠前缀一刀切会误删用户文件。**`_preview-cards.*` 不许删** |

### 发布 / 链接（踩一次就够）

- **发布是覆盖式的**：重新发布复用同一 sandbox，链接不变、内容被覆盖 ⇒ 旧链接照样 200。
  **本项目已三次栽在「200 区分不出新旧」**（v10.15/16/17），所以判版本**必须比 md5**。
- ★★ **绝对别用 sites 的 `unpublish` 去清旧 app**：它取的是「**同一本地目录的最新一次发布**」，
  而本项目所有 app 的 `localDir` 全是 `game-aggregator` ⇒ **会把正式入口一起下掉**。
  清理旧 app 只能去「设置—数据管理—发布的应用」**手工删**。
- 重发布若报「预留域名未绑定」/「没有可更新的应用」⇒ 旧 sandbox 已过期 ⇒
  **只能 `createNewApp:true` 新建，链接会变**（这个拒绝是对的，挡的是「发布成功但链接还指旧内容」的假成功）。
  ✅ 2026-09-18 已实测：**直接新建一次就过，别再浪费调用试复用**。
- ⚠️ 同名 app 记录在**堆积**（平台无删除接口）。
- **发布后必跑 `tools/audit-apps.js`**（应用登记 × 域名实测对账，防线 `test-audit-apps.js` 28 条）；
  **线上验收跑 `tools/verify-online.js`**（真浏览器打开线上 → 点详情页 → 量面板高度）。
- ⚠️ **发布属于「每轮都要重新拿授权」的动作**，上一次的同意**不延续** —— 没明确要求就**先问不推**。

---

## 一、数据层地图

| 文件 | 作用 / 要点 |
|---|---|
| `bannerhub-files.json` | 机型→GPU **逐条配对**（唯一可信配对源） |
| `gpu-soc.json`(246) / `soc-cpu.json`(343) / `soc-db.json` | GPU→SoC→CPU 核簇；soc-db **只用 `id`（抠市场名）与 GPU**，`arch`/`year` **不可信** |
| `device-alias.json` / `device-board.json` / `device-match.js` / `device-gpu.js` | 别名表（人工维护）+ 主板兜底(200) + `findDevice`(98.3%，兜底 `approx:true`→`≈`) + 转译主模块 `specOf/cpuOf/fmtCpu/marketFromId/upgradeSoc` |
| `steam-req.json` | PC 配置缓存（键=appid），`build-steam-req.js` 预热 |
| `bhparams.json` | 逐条游玩参数（TTL 7d）⚠️ **另一条链路**，GPU 脏 → `/api/bh/params` 须过 `cleanGpuOne` |
| `mobilehub.json` / `phonecfg.json` | 社区配置库（读取层 `cleanGpuOne`）/ 本站实测 1037 条。★ v10.21：**3181 条 · 匹配端游 1540（48.4%）· 配置 15394**。改名必须跑 `tools/diff-mobilehub.js` 差分（真退化 0 才放行） |
| `emuguide.js` | 模拟器指南七节，⚠️ 字段**统一 `{name,desc}`** |
| `device-market.json` + `devicemarket.js` | MobileModels 机型库 8,261 codes；`resolve(raw)` 内部编号→品牌+型号，覆盖 67.4% |
| `device-specs.json` + `devicespec.js` | kalvo 硬件配置缓存（30d 命中/3d 未命中）。★ 写盘用 **`_dirty` + 写穿**模式 |
| `deviceset.js` | 机型串归一/合并：`devKey`（**复用 devicemarket 的 `BRAND_PREFIX`**）、`mergeDevices`（同键取写法更全的） |
| `devicefill.js` + `chip-tokens.json` + `device-fill.json` | 芯片**三级降级**：① `findDevice` ② 机型串抠芯片号 ③ 联网 kalvo。能本地解决**绝不上网**；三级全空**留空不编造**。全库 1,048 台覆盖 **99.8%** |
| `spec-dict.js` + `spec-match.js` | **解包 JSON → 可适配游戏**（`/unpack.html`）。识别**双通道**：键名（高置信）/ 值形态（低置信，UI 标「推断」）。判定**四维** `arch`/`dx`/`ram`/`storage`。★ 用户样本到手后**只改 `spec-dict.js`** |
| **`jidi-topics.json`**（v10.22） | 机地**全量话题 17,220 条**（`tools/build-jidi-topics.js`，18 页/32s/10.3MB）。带 `dpv`(**热度**)/`modCnt`/`appid`/`cover`/`min`/`rec` |
| **`spec-req.json`**（v10.22） | **16,575 款** PC 配置（机地 ∪ Steam 官方，**按 Steam appid 精确 join**，11.5MB）。逐字段来源记在 `src`/`reqFrom` |

★ `DICT_VERSION: 'v10.20'` 是**词典自己的版本**（建词典那一版），**不是站点版本号**，发版时不要跟着 +1。

---

## 二、机地签名接口（websign）—— v10.22 破译

```js
// fetchers/jidiSigned.js —— 签名的唯一出处，别在别处重写
sign = "v2-" + md5( String(h_m||0) + md5( JSON.stringify(body) + "YhD6TCs9VpAl" ) )
POST /api/<path>?websign=<sign>   body 必须是「完整 env 展开后的对象」，content-type: text/plain
```

- `env` 藏在任意页面 HTML 的 `<script id="appState">` 里（含 `h_did` 等），
  **必须整份展开进 body** —— body **不是**只有业务参数。
  签名算错与「完全不带参数」**返回同一个笼统错误**（用「故意算错签名」二分定位）
- 端点清单来自反混淆 `app.a5abd3570f.js`（446KB，模块 1484），99 个 `/api/…`
- ★ **`/api/topic/get_topics`**（POST，GET→405）：
  `{...env, offset, limit, next_cb, cur_page:'all_topic', sort, genre}`
  **`limit` 最大 1000** ⇒ 全量 17,220 条只需 **~18 请求**（**不是 862 页！**）
- ★★ **返回的 `total` 恒为 0（陷阱字段）** ⇒ 翻页**只能靠 offset 递增 + 空页停**，永不信任 `total`
- `sort`: `update`（默认）/ `hot`（首条 dpv=348,065《剑星》）
- ★ **详情页帖子在 `topic.ssrData.postsMap.list`**（或 `ssrData.postList`），**不在 `topic` 顶层**
  （顶层只有 `currentTopic` + 热门列表）
- ⚠️ **不要**去抓 `topic/list` 的 `ant-pagination` 逐页翻 —— 那是给人看的壳，接口一次能给 1000 条

---

## 三、Steam appid = 精确 join 键（零模糊匹配）

- 机地 `game_info.header_image`（Steam CDN 图）与 XD 封面（`/steam/apps/<appid>/…`）
  **都内嵌 Steam appid**（机地 97.2%、XD 97.4%）。抠取见 `fetchers/jidiTopics.js: appidOf()`
- **交集 14,343 款** ⇒ 跨源合并**零名称模糊匹配**
  （本项目曾被名称匹配坑过：`ZTE Blade A73` → `Samsung Galaxy A73`）
- 机地 `game_info.pc_requirement.min/.rec` + `game_sys_reqs[]`（人类可读行，**额外带 DX 与硬盘空间**）
- ★ 前端卡片显示的封面是机地自己的 `img2.52jidi.com/topic/cover/…`，
  **appid 只从 Steam CDN 那条字段抠** —— 两者别混用
- Steam 接口 `filters=` **必须带 `basic`**

---

## 四、下载链接功能（v10.22）

- **XD**：`div.article-down` → `a.downbtn` 的
  `data-url="/plus/download.php?open=2&id=…&uhash=…"`，**302** 且真链在 `Location`（无需 Referer）。
  实测 6 个盘口全可解析
- **机地**：详情页 SSR 帖子里抽网盘链接（`fetchers/jidiTopics.js: postsOf()`），
  网盘直链写在**帖子正文**里（社区制，没有独立下载按钮）
- ★★ **`needAuth`：源站权限门 ≠ 抓取失败。**
  XD 对部分游戏返回 **`HTTP 200` + `<title>你没有权限下载：<游戏名>！</title>`**
  （实测钢铁雄心4 id=3967 的 **10 个盘口全部如此**，既无 `Location` 也无跳转脚本）。
  两者该给的出口**相反**：权限 → 「去源站登录后获取」；超时/改版 → 「稍后重试」。
  `needAuthOf()` 三条件**缺一不可**：`有条目` ∧ `全都没有 real` ∧ `至少一条报 needAuth`。
  ★ 判据 `/你没有权限下载|无权限|没有权限|请先登录|登录后(?:才)?可/`
- ★ **`Location` 头 mojibake**：UTF-8 字节被按 latin1 解 → `（访问码：2o8s）` 变乱码。
  乱码含 **C1 控制符 U+0080–U+009F** ⇒ 护栏必须 `/[\u0080-\u00ff]/`（`/[\u00c0-\u00ff]/` **漏判**）；
  修完再拒 `\uFFFD`
- ★ **`version` 字段**：HTML 里**没有** `版本[：:]` 这种带冒号的写法 →
  必须匹配 `<h4>版本介绍</h4><p>…</p>`，兜底 `Build\.\d+[|中文]…` 整段
- ★★ **`normHost()`：`parseDetailUrl()` 返回 hostname（`xdgame.com`），而 `XD_HOSTS` 的键是短名（`xdgame`）**
  ⇒ `XD_HOSTS['xdgame.com']` 为 undefined ⇒ 静默兜底到 `xdgamer.com`
  （**两套内容独立的平行站**）⇒ 只报一句 `XD 详情页 HTTP 404`，完全看不出根因。
  ★ **先砍路径再砍 `.com`** —— 顺序反了 `…/game/1.html` 不满足 `/\.com$/`，整个串留着又静默兜底
- ★ `extractLinks` **统一放 `shared.js`**（`{max, dropInternal}` 选项）。
  `jidiModify` 传 `{max:12}` 保历史契约；`dropInternal` 默认 true（滤掉 `jidiyouxi.com/problemTutorial` 这类站内页）

---

## 五、详情页取数槽位

`#reqSlot` `GET /api/pcreq?t=&cover=&id=`（源站 → Steam 官方 → 机地同名话题）·
`#bhSlot` 手机模拟器配置 + `#bhParamSlot` 逐条参数 `GET /api/bh/params?k=&limit=`
（键支持**逗号分隔多候选**，挑文件最多的）· `#bhRecSlot` 本站实测 `GET /api/pc/records?k=` ·
**`#bhHwSlot` 手机硬件 `GET /api/device/hardware?m=<译名>`** ·
机型清单 `.d-devlist` `GET /api/device/specs?models=a|b|c`（**批量**规避 N+1，失败返 `null` 不编造；
v10.18 起每条带 `chip`/`chipSrc`/`needFill`）→ 缺芯片走
**`GET /api/device/fill?models=`**（异步联网，`concurrency=3`，落盘 `device-fill.json`）。
★ 补全**只 `outerHTML` 原地替换那一个 `.chip`**，不重渲染清单（否则用户已点开的硬件面板会当场收掉）。

★ 机型清单数据源 = `GET /api/mobilehub/match` 的 `devices`
（**v10.17 起是「摘要 ∪ 逐条配置」合并结果**）。

**v10.22 新增**：`GET /api/download?url=<详情页URL>`
（**优先用 `url` 而非 `source+id`**，因 `xdgame.com` 与 `xdgamer.com` 是**独立平行站**，
同数字 ID ≠ 同游戏）、`GET /api/jiditopics/stats|list`、`GET /api/spec/*`。

---

## 六、机型转译与跨源互链

```
机型名 ─①逐条配对→ GPU ─②gpu-soc→ SoC ─③soc-cpu→ CPU 核簇
兜底A：带 SM/MT 编号 → soc-db 编号索引（含基号键 SM8750P→SM8750）
兜底B：营销名别名表（小米15→sm8750）  纠偏：marketFromId() + upgradeSoc()
```

★ **GPU/SoC/CPU 三项覆盖率必须分开统计**（数据源不同，出现过 SoC 92.7% 但 CPU 0%）。

- `resolveCounterpart(d)` 按抽屉条目缓存（`cpCache`），被 `linkCounterpart()` 与 `loadBhBlock()` 共用
- 检索词三轮降级：整名 → 剥版本词 → **再剥标点**；命中后优先取「归一后完全相等」的那条
- **v10.15 起跨源按钮只在有「详情页」可跳时才显示**（`hasDetailUrl()` 匹配 `/(topic\/detail|game)\/\d+/`），
  在**候选阶段**就 `cand.filter(hasDetailUrl)`；**不再退到站内搜索页**
- URL：机地 `jidiyouxi.com/topic/detail/<id>`、`?keyword=`；
  XD `xdgame.com/game/<id>.html`、`xdgamer.com/search/<名>.html`（⚠️ `xdgame.com/search` **404**）
- 防误配 `sameGame()`：两边都有中文段却不相等 → **不退到英文段**；包含匹配要求两边长度 ≥3
- v10.16 双源分工：**MobileModels** 内部编号→品牌+型号（离线）；
  **kalvo** 型号名→硬件参数（**只认营销名、不认内部编号** ⇒ UI 必须传**译名** `data-hw`）
- kalvo 认证：`GET /ajax/search/?q=`（**必须带尾斜杠**）需**三头同时带** ——
  `klv-lang: en` + `X-Requested-With: XMLHttpRequest` + `Referer: https://zh.kalvo.com/`
  （缺 `klv-lang`→401；有 XHR 无 `klv-lang`→403）。**无需签名**（`search.js` 混淆是红鲱鱼）。
  解析前先把 `<br>` 换成 ` / `
- ★ 译名护栏：market 自带品牌词先剥；尾部括号里**小写开头**的短串是 codename 要剥，
  **数字开头**的（`(2023)`/`(2a)`）是型号一部分**不能剥**

---

## 七、高频踩坑（按主题归组）

### A. 数据口径

1. **「要求」不能当「能力」**：一份配置常同时写「设备有什么」与「游戏要什么」⇒
   自身与要求档**分仓**（`profile.*` vs `profile.req.*`），只有自身缺失才退回并**标注来源**。
   同类：值通道只取命中片段
2. **不同量纲的分数不能比**（移动 GPU `gpuScore()` vs PC 卡自由文本 → 假精度）
3. **「对方没标」≠「我不知道」**：该 `skip` 的别降级（待确认 535/650 → 0，分布才有信息量）
4. **上游「摘要」字段常有硬上限**：`bannerhub.json` 的 `dv`（机型）**最大 6 格**
   （2648 条里 255 款正好卡 6）⇒ 凡「摘要/概览」字段，先统计**长度分布**，有天花板就去并全量源
   （逐条配置里的 `device` 才是全量，写法也更规范：`MTN NX3` vs `HONOR MTN-NX3`）
5. **批量写盘别做「只写前 N 次」的节流**：`if (_writes < 3) flush()` 里 `_writes` 是**进程内累计**
   ⇒ 一个进程里只有前 3 次落盘（实测批量联网 12 台，磁盘只留 3 条，**8 台白跑且零报错**）。
   统一用 `devicespec.js` 的 **`_dirty` + 写穿**模式。凡是「计数 < N 才落盘」，先问
   「进程结束前剩下的去哪了」——**没有 exit flush 就是丢**。
   缓存文件留 `DEVICEFILL_CACHE` 之类**环境变量出口**，测试才能用隔离缓存真验落盘条数
6. **同一语义的清洗规则只能有一份**：机型归一键复用 `BRAND_PREFIX`；`extractLinks` 收归 `shared.js`；
   `websign` 收归 `jidiSigned.js`。另写一套就会出现「同一台手机两个名字」
7. **值进 UI 前要「出口清洗」**：kalvo 的多地区 soc 是长串且**末尾悬空 ` / `** ⇒ 会原样进徽标 `title`。
   清洗放在**出口**才覆盖缓存命中与新鲜结果两条路
8. **★ 用户说「数据这么少」时，先怀疑取数路径，别怀疑源站**（v10.22）：
   机地「只有 66 条」的真根因是**只抓了首页人工精选**，全量接口有 **17,220** 条。
   ⇒ 通用动作：凡「摘要/总量/概览」字段，先统计分布；**发现恒零或天花板就去并全量源**

### B. 匹配 / 检索

9. ★ **跨源只做「子串」= 一定串台**。三道闸：
   ① **品牌冲突一票否决**（品牌表**外**的词不参与否决，避免误杀；`moto`→`motorola` 归一；子品牌交集不误杀）
   ② **长词（≥4、非品牌）必须全部出现**
   ③ 末位型号号 ≥4 可子串、**≤3 必须整词相等**
   ★ 别留「某个长词命中就算同台」的兜底 —— 那等于「型号号错了也认」（`Power U30` 认成 `Power U20`）。
   **宁可退回「未收录」，也不安一个错的芯片**
10. **放宽匹配条件前先量「收益 vs 误配代价」并限制作用域**：给新路径加护栏时顺手加到**既有通道**
    ⇒ 修好 1 条却打坏 4 条（`Trails in the Sky`→空之轨迹 the 2nd 等）——它们**故意是「系列名→唯一那代」**。
    同族：`Reloaded` **故意不剥**（`Tropico Reloaded` 是 1+2 合集），这类规则要**写进注释 + 断言**
11. **放宽检索词要连带剥标点**，每一步单独验一个真实样本
12. **跨源名称匹配的最小长度护栏要按 CJK 区分**（`length>=3` 一刀切会整类误杀 2 字中文名，
    如 `剑星`/`鸣潮`/`仁王`）；**查询侧也可能是 `/` 拼接串**（只修库侧只修一半）

### C. 浏览器 / 渲染

13. **`min-height` 定不住高度**：定高用 `height` + `position:absolute;inset:0;object-fit:cover`
14. **类名必须与 CSS 对齐**（v10.13、v10.19 犯了两次）：数据渲染了页面却「乱/空」——JS 用了 CSS 里
    **不存在**的类名 ⇒ 断言**一律读 `getComputedStyle`**（fontSize/borderWidth/gridTemplateColumns），
    「只断言元素存在」100% 假绿。排查时把「JS 造的类」与「CSS 定义的类」两张清单对一遍
15. **CSS 变量未定义 = 整条声明静默失效**（`border:…var(--c-line)`）⇒ 查 `:root`；补时**不新增同义变量**
16. **粘性元素会被更靠前的 sticky 完全遮住**：`.eg-nav` 撞 `.topbar` ⇒ 用户完全看不见，
    而「存在/sticky/占版面>0」断言**全过**（最危险的假绿）⇒ 粘性元素额外断言
    「**上沿 ≥ 上层 sticky 下沿**」；`top` 用 CSS 变量算（`--topbar-h` 桌面 60px / `≤760px` 54px），别硬编码两处
17. ★★ **`z-index` 低于上层 = 被整个盖住，而所有「存在性」断言照样全绿**（v10.22 下载弹窗）：
    抽屉 100 / 遮罩 90 ⇒ 弹窗定 **110**。**必须用 `document.elementFromPoint(中心)` 验「真被看到」**，
    并与上层 z-index 做数值比较。
18. `scrollIntoView({behavior:'smooth'})` 在 headless 下**静默失效** ⇒ 自算位置用 `window.scrollTo`；
    实拍断言加**滚动轨迹采样**（只报 0→0 分不清「没滚」还是「滚了又回来」）。scroll spy 落点与判定线
    留 ≥16px 余量；懒加载分区要先驱动交互切出来再断言
19. `.dm-info` 的 `display:none` 在 CSS 里，JS `style.display=''` **无效**，必须显式 `'block'`
20. **同一份 UI 的「两个独立渲染分支」要一起改**（品牌下拉 / 输入即查各写一遍 innerHTML），
    **每个分支各钉一条断言**
21. ★ **只写 JS 不加 CSS = 说明块退化成裸文字**（v10.22 `.dl-blocked`）：元素在、文字对，
    但用户看上去就是「加载失败的空壳」⇒ 新组件必须**同时**断言样式声明存在

### D. 断言 / 测试

22. ★★ **假绿比红更危险**：断言助手签名与调用顺序不一致（`chk(name,ok)` 按 `(条件,名称)` 传）
    ⇒ `ok` 收到非空字符串**恒为真**。**判据：输出里必须逐条看得见断言名称**
23. ★★ **断言要测「行为」不要测「名字」**：只检查常量名 `EDITION_WORDS` 存在 ⇒ 删掉整个循环**照样绿**。
    ⇒ 写完必须做**反证**（故意打坏护栏 → 断言必须变红）。
    ⚠️ 反证脚本自己也会错（全局替换改到了 `stem()` 里长得一样的循环）⇒ 必须**按函数体精确切片**
24. **断言挂了先怀疑字面量**（`MALLOON920C` 是测试拼错，真实数据统一 `Maleoon`），再怀疑实现
25. **断言把选择器「前缀化过头」→ 假红**（图例在 `#bhSlot > .d-blk > h4 > .cnt` 里）。
    写断言前先**打印祖先链**确认真实位置；除「存在」外还要钉**语义位置**（如 `.closest('h4')`）
26. **脏值断言要打在承载该语义的节点**上，别打整页文本（曾把合法的「驱动: turnip_…」误报）
27. **手写的清单一定会漏且看不出来**：`report.js` 的「逐版覆盖」写死 `['10.10'…'10.20']`
    ⇒ 改成**从版本号算出来**，并加断言禁止退回数组字面量
28. ★★ **断言不能钉「随数据变化的东西」**（v10.22 实拍）：B 段钉「弹窗必须有链接」，
    但**榜首恰好是被锁的游戏** ⇒ 变红。修法是**分两层**：
    ① 不变量层（要么有外链、要么有可读原因）② 确定性层（固定样本验具体行为）。
    ⇒ 判据：**这条断言依赖的那份数据，明天会变吗？** 会变就拆层。
29. ★★ **列表区块必须先断言「条数 > 0」再断言布局**（v10.22 窄屏）：
    **0 行时 `gridTemplateColumns` 是 `none`，`split(' ')` 出 1 列 ⇒ 单列断言假绿**。

### E. 版本 / 发布

30. ★★ **判「线上是哪一版」必须比 `index.html` 的 md5**（或该版**新增特征**逐条比对），
    不能只看 HTTP 200 —— 多域名全 200 内容新旧不一，只看状态码**结论整个相反**。
    **「不同版本」不是结论，方向才是**（曾用单个特征串 `/.chip\.ol/` 猜 ⇒ 线上更旧却报「新于本地？」）
31. ★ 用**新增特征**而不是单个特征串判方向；纯数据层改动 md5 不变 ⇒ 必须同时探接口
32. **线上没发布 = 用户看到的全是旧界面**：判定用户截图现象先**拉线上与本地特征比对**，别急着改代码
33. ★★ **指标类需求必须先做「根因分类」再排期**（v10.21 #33）：「联网补名把匹配率 47.9%→60%」
    看着顺理成章，先把 1665 条未匹配**逐条分类**（不抽样）结论直接反转：A 类 777 = 库里根本没收录
    （补名救不了）· B 类 473 = **朴素子串匹配的假阳性**（匹配器的错）· C 类 31 = 真可修
    ⇒ **整链天花板只有 +1.0pp**。通用动作：「指标差」先拆成
    **数据没有 / 算法配错 / 展示不对**三类
34. ★ **阈值型断言会随数据规模漂移**：数据从 653 → 16,575 款后，
    `test-related-dl.js` 的 `>0.9`、`test-saves-match.js` 的期望配对**都会变**。
    ⇒ 每次大幅扩库后必须跑全量防线，并区分「**预期变更**」与「真退化」：
    先看新进榜的那条记录**是否正确**，正确就改断言（并写注释说明为什么），错误才是退化
35. ★ **规则在数据稀疏时可能「从未真正生效过」**：`流畅 = ramM>=2 || stM>=3` 里 `stM` 长期恒空，
    等于只有前半段在跑。数据铺开后一个存储余量就刷出 8,385/16,519 条「流畅」。
    ⇒ 凡用了「某字段 > 阈值」的判定，**先断言该字段的覆盖率**，别让规则悄悄空转
36. ★★ **每个套件的退出码必须挂钩失败数**（v10.22 查出 2/20 套中招）：
    只打印 `结果：n / m 通过` 而没有 `process.exit(fail ? 1 : 0)` ⇒
    ① 单独跑时红绿不分（`echo $?` 得到 0）；② ★ **反证判据失效**（打坏了也验不出来）。
    ⚠️ 只在「单独跑」和「做反证」时爆 —— 因为 `run-all.js` 靠**解析输出**汇总，全量跑仍是对的。
    只认 `process.exit(fail ? 1 : 0)` / `if (fail) process.exitCode = 1`；
    **`catch` 里的 `process.exit(1)` 不算**（那只覆盖脚本崩溃）。
    `run-all.js` 的 `exitTiedToFailures()` 前置检查会**点名报出**不达标者。
37. ★★ **反证里 `replace('x','y')` 只替第一处**：想删掉 `exitTiedToFailures`，
    它在文件里出现 2 次，只改了函数定义、调用处没改 ⇒ 报「打坏了还是绿」，
    **差一点去"修"一个本来正确的护栏**。⇒ 改全部出现必须用 `/g`，
    **且替换后先验命中数**，不符就报错退出（「静默跳过 = 没验证却看起来验证通过」）
38. ★★ **断言不能钉「随数据变化的东西」**（v10.22 实拍）：钉「弹窗必须有链接」但**榜首恰好被源站锁了**
    ⇒ 假红；钉「窄屏链接列表 1 列」但 **0 行时 `gridTemplateColumns` 是 `none` ⇒ split 出 1 列** ⇒ 假绿。
    ⇒ 分两层：**不变量层**（要么 A 要么可读的 B）+ **确定性层**（固定样本钉具体行为）；
    **列表区块一律先钉条数 > 0 再钉布局**。自检问句：*这条断言依赖的数据明天会变吗？*

---

## 附：已沉淀 skills（勿在本文件重复）

`ui-ab-visual-regression` · `jsdom-ui-behavior-test` · `device-model-to-chip-translation` ·
`cross-source-name-matching` · `single-source-dual-page` · `win-github-upload` ·
`multi-source-date-field` · `gpu-tier-cross-vendor` · `web-internal-api-reverse` ·
`counterproof-assertions` · `win-project-launcher` · `endgame-three-source-analysis`
