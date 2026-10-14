# GameHub 游讯聚合（机地 × XDGAME）

基于 **jidiyouxi.com（机地）** 与 **xdgame.com / xdgamer.com（XDGAME）** 两个源站构建的单机游戏**信息聚合站**。

> 定位：**只提供「详情页 + 更新内容」，不提供任何下载资源。**
> 架构：**单页聚合主站** —— 首页即**全站热榜**；搜索收进**弹窗**，详情走抽屉。

## v10 新增：手机专区加两个页签 —— 「修改器」+「云存档」

> **起因（用户原话）**：
> 「我准备在手机专区增加两个页面，修改器 & 云存档
>  `https://github.com/dyang886/Game-Cheats-Manager/releases`
>  我需要的是获取到修改器 + 云存档**详情页**以及**对应的放置位置**。」

**结论先行**：两个页签都做出来了，页签数 **3 → 5**（手游中心 / 修改器 / 云存档 / 模拟器指南 / 机型兼容）。
「放置位置」按**文件落地位置**实现 —— 云存档直接给**存档路径**，修改器明确说明「独立 exe，不用放进游戏目录」。

### 两个数据源（一个能拿、一个拿不到，都查清了）

| 模块 | 目标源 | 结果 | 替代方案 |
|---|---|---|---|
| **修改器** | Game Cheats Manager | ✅ **公开接口** `gamezonelabs.com/api/data/gcm`（免密钥，808KB） | 直接用 |
| **云存档** | Game-Save-Manager | ❌ 存档库挂在**一次性 S3 签名 URL** 后（依赖仓库外 `secret_config` 的 `SIGNED_URL_DOWNLOAD_ENDPOINT` + `CLIENT_API_KEY`），无法离线复现 | 换 **Ludusavi manifest**（MIT 开源、更新更勤） |

**修改器接口是怎么找到的**（省得下次重找）：
`gamezonelabs.com` 是 Next.js 站点，页面只显示 "Loading trainer data…"。
→ 抓 `/products/gcm/trainers` 的 HTML 拿到 `/_next/static/chunks/*.js`
→ 逐个 chunk grep `"/api/` → 命中 **`/api/data/gcm`**。

### 数据规模

| | 数量 | 说明 |
|---|---|---|
| 修改器 | **3,589 条**（原始 3,742，同名去重后） | 5 个来源：CE 修改表 1,846 / 风灵月影 1,152 / 社区贡献 665 / 小幸 59 / GCM 精选 20 |
| ↳ 命中端游库 | **2,644（73.7%）** | 中文名命中 2,185 ｜ 英文名命中 2,617 |
| 云存档 | **5,741 款** | 清单共 53,122 款，按本地库过滤 |
| ↳ 存档路径 | **13,097 条** | 另含注册表档项 920 条 |
| ↳ 手机能玩 | **1,117 款** | 即落在手游中心内 —— 页签数字与默认筛选都用这个口径 |
| ↳ 支持云同步 | 4,691 款 | Steam / GOG / Epic / Origin… |

### ★ 本轮最大的一个坑：端游库标题是「中文/英文/别名」斜杠拼接串

`data/games.json` 的 `title` 形如 `艾尔登法环/ELDEN RING`、`赛博朋克2077/Cyberpunk 2077`。
**整串归一化会把斜杠吞掉**，变成 `艾尔登法环eldenring` 这种拼接怪物，永远匹配不上：

| 匹配方式 | 修改器命中率 |
|---|---|
| 整串归一化（**错**） | 73 / 3,742 = **2.0%** |
| 按 `/` 切段入索引（**对**） | **2,761 / 3,742 = 73.8%** |

> 已有代码里的 `gamesDb.search()` 就是用 `split(/[/\s_：:·-]+/)` 切词打分的 ——
> **新写的匹配器必须沿用同一口径**，否则会得到「2% 匹配率」这种假结论并去改错方向。

### 顺带发现：端游库 cover 里带 Steam appid

```
https://shared.cdn.queniuqe.com/store_item_assets/steam/apps/1245620/header.jpg
                                                          ↑ appid，可抽出当跨语言桥
```
13,902 款能抽出 appid，与云存档清单的 `steam.id` 同口径，后续做互校/补名都能用。

### 命令

```bash
node tools/fetch-trainers.js              # 抓修改器清单（--offline 用缓存重跑匹配）
node tools/build-saves.js                 # 建云存档索引（--download 先拉 17MB 清单）
```

缓存（可重跑、可删）：
`data/_gcm-raw.json`（789KB）、`.cache/ludusavi-manifest.yaml`（17MB）。

### 新增接口

| 接口 | 说明 |
|---|---|
| `GET /api/tools/stats` | 两个新模块的一句话概览（页签数字回填用） |
| `GET /api/trainers/stats` | 修改器概览：总数 / 匹配率 / **5 个来源分布** |
| `GET /api/trainers/list?q=&source=&sort=lib\|zh\|name\|source&stats=all&limit=&offset=` | 修改器列表（默认只出能对上端游库的） |
| `GET /api/trainers/match?t=&id=` | 某款游戏的修改器（**一款多源**，如艾尔登法环 4 条：社区/风灵/小幸/CE 表） |
| `GET /api/saves/stats` | 云存档概览：收录 / 手机能玩 / 路径数 / 云同步数 |
| `GET /api/saves/list?q=&phone=1&cloud=1&sort=paths\|name\|cloud&stats=all` | 存档位置列表（默认只看手机能玩） |
| `GET /api/saves/match?t=&id=` | 某款游戏的存档位置（精确优先，**不中退回子串检索**） |

`/api/search/all` 由 2 分组扩成 **4 分组**：`pc` / `mobile` / **`trainer`** / **`save`**。

### 已知边界（诚实交代）

1. **不提供修改器文件下载**。官方走一次性签名 URL，我们既无法离线复现也不应绕过；
   卡片给的是「**获取方式**」外链（风灵月影官网 / GCM 修改器库 / GCM 下载页，均已实测 200）。
2. **云存档路径是 Windows 口径**（`C:\Users\<用户名>\AppData\...`），
   模拟器里即虚拟 C 盘下的同一路径；注册表项在模拟器环境中未必可写。
3. 云存档索引只保留**本地库有交集**的 5,741 款（53,122 款里），
   目的是与站内详情页打通；要全量改 `build-saves.js` 的过滤条件即可。

### 验收

```
结构体检 45 / 45 通过   （+8：5 页签顺序、两个分区骨架、路径展示区、放置位置说明）
行为回归 96 / 96 通过   （+29：分区互切、卡片渲染、路径解析、开关联动、#tr/#sv 深链）
生成器连跑三次 md5 一致  （真幂等，未触发坑 11）
```

---

## v9.3 修订：手游中心「合并成一张列表」+ 联网补名匹配端游 + 全站统一搜索

> **起因（用户本轮原话）**：
> 「交互效果应该是这里吧」（认可顶栏分栏式切换）；
> 「我在**手游专区点击搜索无效果了**」；
> 「我需要的整体效果是，先将**手游已有的配置 + 实测汇总**，然后将已收录的游戏**对应电脑的进行匹配**（需要你**联网搜索游戏中文名称**然后再匹配）」；
> 「手游**默认显示跟端游匹配的游戏**」；
> 「帮我将**整体的功能进行优化整理**」。

### 一、功能整并：4 分区 / 4 页签 → **3 分区 / 3 页签**

| 旧（v9.1） | 新（v9.3） | 说明 |
| --- | --- | --- |
| ① 手游可玩（社区库 2,597） | **① 手游中心（合并，3,161）** | 社区库 + 实测库合并去重，同款一份卡片 |
| ② 实测配置（1,025） | ↳ 已并入 ① | 独立分区删除，字段变成卡片上的 pill |
| ③ 模拟器指南 | **② 模拟器指南** | 位置前移 |
| ④ 机型兼容 | **③ 机型兼容** | — |

切换条（`#egBackbar`）由 4 个页签减为 3 个：`手游中心 / 模拟器指南 / 机型兼容`。
`ET_MAP = { emu: '#emulator', eg: '#emuguide', dm: '#devmatch' }`，旧 `#pc` 深链在 `bootTab()` 里
自动改写成 `emu`，老书签不会 404（落到空分区）。

### 二、合并索引是怎么建的（`tools/build-mobilehub.js` → `data/mobilehub.json`）

**合并键**：优先用「端游库命中的 id」，没命中就用「归一化名」，两条路归到同一个桶。

**去重与累加**：同款命中同一个桶时 ——
- `configs`（社区配置套数）**累加**；
- `records`（实测记录条数）**累加**；
- `gpus` 取并集；`sources` 记录 `['bh','pc']` 来源组合；
- `bhKeys` 记住社区库那侧的原始仓库键（供前端 `/api/bh/configs?k=` 拉详细配置）；
- `libId/libTitle/libCover/libUrl` 取端游库命中的那一份（封面、详情入口都靠它）；
- `alt` 别名去重 + 按长度排序截断到 **4 条**。

**当前规模（v9.3 基线）**：

| 指标 | 数值 |
| --- | --- |
| 合并总数 | **3,161** |
| 匹配上端游库 | **1,522（48.1%）** |
| 未匹配 | 1,653 |
| 社区配置总套数 | 14,994 |
| 实测记录总条数 | 1,037 |
| 三种来源分布 | onlyBh 2,144 / onlyPc 935 / **both 87** |

### 三、联网补名（`tools/learn-mobilehub-names.js` → `data/mobilehub-names.json`）

只对**未命中端游库**的手游联网补名，产出的别名表被 `build-mobilehub.js` 当第二张别名表读取
（与手写的 `data/cn-names.json` **合并**，不是覆盖）。

**五通道匹配策略**：① 完整段精确 → ② 别名表 → ③ 英文词组交叉 → ④ 词干（去版本/年份）→ ⑤ 前缀包含。

**Steam 官方 API 两步走**：
1. `storesearch?term=` 反查 `appid`；
2. `appdetails?appids=&l=schinese` 取**中文名**，`l=english` 取**官方英文名**。

> **★ 跨语言桥（v9.2 修好的关键坑）**：`l=schinese` 下 `name_original` **恒为 `undefined`**，
> 拿不到官方英文名。源名是英文时，跟中文 `name` 比相似度必然偏低：
> - `Black Myth Wukong` vs `黑神话：悟空` → **0.00**
> - `The Seven Deadly Sins Origin` vs `七大罪：Origin` → **0.32**
>
> 修法：额外用 `l=english` 查一次，取 `d.name` 作为**同语言可比对象**的官方英文名。修好后这两款
> 真同款被正确抢救。
>
> ⚠️ 顺带发现：`storesearch` 在本网络下对**纯英文关键词**会 `ECONNRESET`，**中文关键词正常**。

**防误配护栏**：`MIN_SIM=0.72`、`NOISE` 噪声词集、`isNumericName`、`tooShort`（英文 ≥7 字符）、
`weakSubstring`（同语言侧弱子串 ≥55% 才算）、`scriptMismatch`（中英脚本不混判）、`yearConflict`。
每款 `await sleep(700)` 限流，三个接口都要调速。

**★ 运行前必读：这脚本天然要跑很久，别以为它卡死了。**

| 乘数 | 数值 | 说明 |
|---|---|---|
| 目标量 | **1,653 款** | 未匹配端游库的全部（预过滤后） |
| 每款请求数 | **3 个接口** | `storesearch` → `appdetails?l=schinese` → `appdetails?l=english` |
| 限流 | `sleep(700)` / 款 | 纯等待下限 ≈ **19 分钟** |
| **失败重试放大** | 单款可达 3–10 秒 | `storesearch` 对**纯英文关键词**会 `ECONNRESET`，超时 + 重试把总时长推到 **1 小时+** |

因此在脚本里加了三道工程护栏：

| 护栏 | 作用 |
|---|---|
| `REQ_TIMEOUT = 8000` | 单请求 8 秒超时（`AbortSignal.timeout`）—— 没有它，卡住的连接会把整轮拖到小时级 |
| `SAVE_EVERY = 25` **增量落盘** | 每 25 款就把产物 + 断点写盘。**原版是「跑完才写」，中途 kill 就颗粒无收** |
| `mobilehub-names.progress.json` **断点** | 记「已处理的源名」，重跑自动跳过。**分多次跑与一次跑完结果等价** |

```bash
node tools/learn-mobilehub-names.js                 # 全量（可随时 Ctrl+C，成果已落盘）
node tools/learn-mobilehub-names.js --limit=200     # 只跑 200 款（调试）
node tools/learn-mobilehub-names.js --dry           # 只看结果不写盘
node tools/learn-mobilehub-names.js --fresh         # 忽略断点，从头跑
```

> **别在前台等它**：放后台跑，跑完再 `node tools/build-mobilehub.js` 让新别名表生效。
> 中断后直接重跑同一条命令即可续上，不必加参数。

**验证**：`--limit=40 --dry` 采纳 12 / 拒绝 1（`Wolverine` × `Steel Wolverines` 被弱子串正确拒绝），
两款真同款抢救成功。

### 四、★ 数字一致性护栏（修 `Resident Evil` 系列误配）

**现象**：`Resident Evil 0` 被匹配到 `生化危机3：重制版`。

**根因**：词干通道 ④ 会剥掉尾部数字，`residentevil0` 与 `residentevil3remake` 剥完词干**都是
`residentevil`**；而 `libByStem` 当初是 `Map<stem, item>`，**只保留首次插入的那一个**。

**第一次修错了**：护栏拿 `stem`（已无数字）当比较对象，
`numConflict('residentevil0', 'residentevil') === false` —— 护栏形同虚设。

**正确修法**：`libByStem` 改**多候选** `Map<stem, [{k, it}]>`（`k` 保留候选的原始归一化 key），
命中词干时用 `pickStem(stemKey, queryKey)` 拿候选**自身的 key** 比数字：

```js
function tailNums(k) { return String(k || '').match(/\d{1,4}/g) || []; }
function numConflict(queryKey, libKey) {
  const a = tailNums(queryKey), b = tailNums(libKey);
  if (!a.length || !b.length) return false;
  return !a.some((x) => b.includes(x));
}
function pickStem(stemKey, queryKey) {
  const cands = libByStem.get(stemKey);
  if (!cands || !cands.length) return null;
  for (const c of cands) { if (!numConflict(queryKey, c.k)) return c.it; }
  return null;                       // 选不出来就判未匹配 —— 宁缺勿错
}
```

**验证**：`Resident Evil 0/2/3/5` 全部正确，RE0 判**未匹配**而非错配到 RE3。

### 五、★ 双料优先排序（修「首屏看不到帧率卡」）

**现象**：默认按 `configs` 排序时，首屏 24 张卡里**帧率卡 0 张**。

**根因**：帧率数据（641 条）与高配置数游戏**几乎不重叠** —— 有帧率的条目按配置数排名
**中位数是第 845 位**。

**修法**：默认排序改 `sort=both`「双料优先」，权重分层：

```js
const score = (x) => {
  const cfg = x.configs || 0, rec = x.records || 0, fps = x.bestLabel ? 1 : 0;
  let s = 0;
  if (cfg > 0 && (rec > 0 || fps)) s += 1e7;   // 双料：既有社区配置又有帧率/实测
  else if (fps) s += 5e6;                       // 只带帧率
  else if (rec > 0) s += 3e6;                   // 只有实测记录
  return s + cfg;                               // 同级内再按配置数排
};
```

**验证**：首屏帧率卡 **0 → 23**（12 条抽样的预览里 **12/12** 带帧率）。

### 六、★ 全站统一搜索（修「手游专区点击搜索无效果」）

**根因**：手游专区里顶栏搜索按钮走的是旧的社区库单库搜索，手游汇总后没有接上新索引，
点了搜不到东西 —— 表现为「没效果」。

**修法**：新增统一搜索端点 `GET /api/search/all?q=&limit=`，**一次搜两个库、结果分组返回**：

```json
{ "ok": true, "q": "...", "aliasNote": "",
  "pc":     { "count": 0, "items": [] },
  "mobile": { "count": 0, "items": [] } }
```

前端 `doSearch()` 改走 `/api/search/all`；`paintSearchResult(q, j)` 改成**双分组渲染** ——
**📱 手游中心在前、🖥️ 端游库在后**。两边都空、且 `ghAutoLive==='1'` 时才触发实时兜底抓取。
`bindSmRows()` 新增 `data-mlib` 行点击 → 存快照 → `openDetailById` 直达详情。

### 七、★ 坑 11：生成器幂等哨兵锚错符号 → 整页崩

**现象**：派生页报 `Identifier 'EMU_PAGE_SIZE' has already been declared`，**整页 JS 崩**。

**根因**：`build-emulator-page.js` 的幂等哨兵原本锚在 `function initPc` 上；
v9.3 把「实测配置库」分区整个删掉、`initPc` 也随之删除 →
**哨兵永久为假**，每跑一次生成器就**重复注入整份 SECTIONS_JS**。

**修法**：哨兵改锚在长期存在的符号上 —— `const SEC_SENTINEL = /function initEmu\s*\(/;`
（并把这个常量提到 `secBlock()` 上方，避免 TDZ）。

> **教训固化**：幂等哨兵**必须锚在长期存在的符号**上，绝不能锚在「可能被本次重构删掉」的函数名上。

**验证**：连跑三次生成器，派生页 md5 完全一致（`c4e443a4f50068e0d2e7c831cf37a4bf`）。

### 八、三层防线全绿

| 测试 | 结果 |
| --- | --- |
| 生成器出站自检 | 通过（不改就 throw 硬中断） |
| `tools/test-emulator-structure.js` 静态结构体检 | **37 / 37** |
| `tools/test-emulator-page.js` jsdom 行为测试 | **67 / 67** |

新增断言覆盖：3 页签顺序 `emu/eg/dm`、3 分区 DOM、无 `#phonecfg`、无 `#pcToggleOk`、
有 `#emuTier`、幂等（`initEmu` / `EMU_PAGE_SIZE` 各只出现一次）、「手游中心」默认「仅看匹配端游」、
合并卡渲染、`data-lib` 全覆盖、帧率 pill、来源徽标、`#pc` 深链兼容。

## v9.1 修订：一条切换条 + 顶栏收敛到 2 个入口

> **起因**：v9.0 上线后用户实测反馈两点 ——
> ① 手机专区「**并没有交互**」；② 「最新收录**不应该并入首页吗**」。

**问题 1 的根因（两层，第二层才是致命的）**：

- **表层**：v9.0 是「3 个主页签 + 1 条**二级**切换条」，
  而二级条 `#egSubbar` **从未被隐藏** —— 站在「手游可玩」页签上它也在，
  点它却什么也看不到（目标分区 `#emuguide`/`#devmatch` 仍是 `et-hide`）。
  **看起来能点、其实没反应**。
- **深层（真凶）**：切页签时给 `#emulator` 加了 `et-hide`，但那一版 `#emulator` 写的是
  `<main class="wrap" id="emulator">`，**没有 `data-et`**。而隐藏规则是
  `main[data-et].et-hide{display:none}` —— **属性选择器匹配不上**，class 加了等于没加，
  `#emulator` 仍然占着 1483px 的版面，把真正要显示的分区顶到 **1647px 之外**。
  用户点完页签、页面却纹丝不动，看到的就是「没有交互」。

**修法 —— 砍掉二级条 + 补齐 data-et，改成一条 4 个平级页签**：

```
← 返回聚合首页   [ 2,597 手游可玩 ] [ 1,025 实测配置 ] [ 指南 模拟器指南 ] [ 1,030 机型兼容 ]
```

| 改动 | v9.0 | v9.1 |
|---|---|---|
| 切换条数量 | **2 条**（主页签 + 二级条） | **1 条** |
| 页签数 | 3 主 + 2 二级 | **4 个平级** |
| `#egSubbar` | 常驻显示（点了没反应） | **彻底删除** |
| `#emulator` 的 `data-et` | **缺失** → 切走时隐藏不掉、把目标分区顶到屏外 | **补 `data-et="emu"`** |
| 页签样式 | 数字「压」在文字上方（卡片高、4 个会挤） | 数字内嵌小胶囊（整条等高） |
| `#dm` 深链 | 要先展开二级 | **直连第 4 个页签** |

> ⚠️ **本轮同时修掉的一个隐蔽产物事故**：那三个分区原先由生成器
> 「从派生页自己身上截取」，一旦某次生成把它们弄丢，下一次读到的就是
> **已经丢了的版本** —— 错误被**幂等地固化**，越跑越回不来（本项目无 git 兜底）。
> 现已改为**在生成器里硬编码重建**（`SECTIONS` 常量），与 `DEVMATCH_HTML` 同样幂等。

### 生成器新增的 3 道出站自检（防止上面这类事故复发）

| # | 检查 | 拦住什么 |
|---|---|---|
| 1 | 每个 `<main>` 必须带 `data-et` | 缺了则 `main[data-et].et-hide` 匹配不上，切走时隐藏不掉 |
| 2 | CSS 必须整段在 `<style>` 内 | CSS 掉到 `</style>` 外会被当正文渲染，页面顶部糊一屏源码 |
| 3 | `emulator-sections.js` 引用的每个 id 都要在产物里 | 分区 DOM 丢失 → `getElementById` 全 null → 切过去一片空白 |

**问题 2 的修法 —— 顶栏从 3 个入口收到 2 个**：

```
🏠 首页   |   📱 手机专区
```

热榜 + 最新收录本就是首页的两个分区，合并成一个「🏠 首页」入口（点击回顶部，
往下滚就是最新收录），不再各占一个顶栏位。

**窄屏适配**（4 个页签也能塞进一行）：

| 断点 | 行为 |
|---|---|
| >760px | 切换条靠右对齐，4 个页签自然宽度 |
| ≤760px | 切换条占满整行，4 个页签**等分**（`flex:1`） |
| ≤430px | **隐藏数字胶囊**，只留 4 个文字页签，保证一眼看全不溢出 |

**测试**：行为回归 **61/61**、结构体检 **34/34**
（新增「切走后前一分区必须真的隐藏」「页面不残留裸 CSS 文本」「4 个分区都带 data-et」等断言）。

## v9 新增：独立页信息架构（首页 / 手机专区）

> **v9 相对 v8 的核心变化**：把顶栏从**6 个入口**砍到**2 个**，手机专区收成一个入口、页内再分层。
> 起因是一张窄屏截图：顶栏 6 个入口两套页面混排，溢出到 header 外（左侧文本被裁、右侧搜索框被推出）。
>
> **v9.1 修订**：专区页内的分层从「3 主页签 + 1 条二级条」压成**一条 4 个平级页签**，
> 顶栏从 3 个入口进一步收到 **2 个**（详见上一节）。

**信息架构**

| 段 | 落点 | 内容 |
|---|---|---|
| ① 首页（端游） | `/` | 热榜 + 最新收录 + 分类，**内容与 v8 完全一致** |
| ② 手机专区 | `/emulator.html#emu` | 页内 4 个平级页签：**手游可玩 / 实测配置 / 模拟器指南 / 机型兼容** |

**顶栏收敛（6 → 2）**

```html
<nav class="main-nav">
  <a href="#rankStage" class="on" id="navHome">🏠 首页</a>
  <a href="/emulator.html" id="navEmu">📱 手机专区</a>
</nav>
```

原「手机可玩 / 实测配置 / 模拟器指南 / 机型兼容」四个入口 → 收进独立页的 4 个平级页签。

**独立页返回条（一条切换条，4 个平级页签）**

```
← 返回聚合首页   [ 2,597 手游可玩 ] [ 1,025 实测配置 ] [ 指南 模拟器指南 ] [ 1,030 机型兼容 ]
```

第 1/2/4 个页签的数字分别来自 `/api/bh/stats`、`/api/pc/stats`、`/api/device/stats`；
第 3 个页签用文字标签「指南」占位（该分区无独立计数），**不再挂孤零零的「·」**。

**默认筛选（降噪）**

| 分区 | 开关 | 默认 | 效果 |
|---|---|---|---|
| 手游可玩 | `#emuToggleLib`「✓ 仅看有实测」 | **开** | `libOnly=1` → 962 款（对齐本地库）vs 全量 2,597 |
| 实测配置 | `#pcToggleOk`「✓ 仅看可玩」 | **开** | `ok=1` → 536 款已验证可玩 |

**hash 深链**

| hash | 落点 |
|---|---|
| `#emu` | 手游可玩（第 1 个页签） |
| `#pc` | 实测配置（第 2 个页签） |
| `#eg` | 模拟器指南（第 3 个页签） |
| `#dm` | 机型兼容（第 4 个页签，直达） |

**本次踩的两个坑（已固化为自检）**

1. **派生页缺主源依赖**：首页跳转块被重写后，生成器的替换正则失配，
   `const EMU_PAGE_HREF`（只在 `index.html` 声明）**残留进派生页** →
   顶部 Tab 绑定整段 `ReferenceError`，专区全空。
   现已加**硬中断自检**：生成器检测到 `EMU_PAGE_HREF` 残留直接 throw，不产出坏页面。
2. **bootTab 默认分支漏调 `initEmu()`**：无 hash 进页时只把 `#emulator` 的 `et-hide` 摘掉，
   数据从未加载、开关初始态没同步 —— 页面看着在、内容一片空。现已补上调用。

**测试**

```bash
node tools/test-emulator-page.js        # 行为回归 61 项（jsdom：点击/切换/深链/渲染）
node tools/test-emulator-structure.js   # 结构体检 34 项（死 CSS/废弃 id/重复注入/漏 init）
```

## v8 新增：机型兼容查询（选机型 → 能跑哪些 PC 游戏）

> **v8 相对 v7 的核心变化**：手机专区从**三**分区扩到**四**分区，新增 **📲 机型兼容查询**。
> （v9 起该分区不再是独立主 tab，而是专区页的第 4 个平级页签，深链 `/emulator.html#dm` 不变。）

**要解决的问题**：v7 的两个库都只记「**谁跑过了**」，不记「**需要什么配置**」——
玩家看到 2,597 款游戏，却没有入口回答「**我这台手机能跑哪些**」。

**做法**：建 GPU 性能层级表，用「**向下兼容**」推断——
若某游戏被 A 档 GPU 跑通过，则**性能 ≥ A 的机型同样能跑**（配置越高越流畅）。

| 层级 | 文件 | 作用 |
|---|---|---|
| 数据抓取 | `tools/fetch-sources.js` | 拉 soc-db / device-board / turnip 三源落盘 |
| 性能层级 | `data/gpu-tier.js` | 93 个 GPU 型号 → 统一性能分（跨家族同量纲） |
| 匹配引擎 | `data/device-match.js` | 机型 → GPU → 可跑游戏清单 |
| 前端分区 | `tools/emulator-sections.js` 第 ④ 块 | 品牌下拉 + 型号搜索 + 结果网格 + 驱动看板 |
| 定时刷新 | `tools/refresh-sources.sh` | 手动/定时刷新三源（turnip 建议每周） |

**性能量纲**（`gpu-tier.js`，跨家族统一到 280–850）：

```
PowerVR(280) < Adreno 610/612/618/619 < Mali-G52(304)/G57(334)/G68(382)
  < Adreno 640/650/660 < Mali-G76(420)/G77(492)/G610(540)
  < Adreno 710/720 < Mali-G615(620)/G715(650)/G720(684) < Immortalis(780)
  < Adreno 730/740/750 < Adreno 810/825/829/830/840
```

**接入的 9 个外部源**（用户提供）：

| 源 | 用途 | 抓取方式 |
|---|---|---|
| `vitkuz573/soc-db` | 芯片规格库（**1444 款 / 44 厂商**） | `api.github.com` contents API → `data/soc-db.json` |
| `xTheEc0/Android-Device-Hardware-Specs-Database` | 主板代号 → SoC（200 条） | 同上 → `data/device-board.json` |
| `The412Banner/Banners-Turnip` | Turnip 驱动构建看板（Mesa/Vulkan 版本 + 3 变体 + 15 release） | Releases API + README 解析 → `data/turnip.json` |
| `The412Banner/bannerhub-game-configs` | 社区配置库（**已接入**，2597 游戏 / 14005 配置） | `tools/refresh-bannerhub.js` |
| `The412Banner/BannerHub` | 功能参照（HUD / 组件管理 / 按游戏配置） | 仅参考 |
| `brunodev85/winlator` + `winlator.dev` | 模拟器本体与四构建变体（Standard/Mali/Frost/GlibC） | 仅参考 |
| `specdeviceinfo.com` | 84,079 台真机指纹（付费，仅免费样本参照） | 不接入 |
| `rishij4.github.io/mobile-processor-hub` | 芯片规格静态站（数据内嵌 HTML） | 不接入 |

> ⚠️ **抓取注意**：本机 `github.com` 主站被拦，脚本一律走 `api.github.com` / `codeload.github.com` / `raw.githubusercontent.com`。

## 页面形态（v9.1：首页 / 手机专区 两段式）

> **v9 相对 v8 的核心变化 —— 顶栏从 6 个入口砍到 2 个**：
>
> v8 的顶栏把「热榜 / 最新收录」（端游）与「手机可玩 / 实测配置 / 模拟器指南 / 机型兼容」（手游）两套页面混在一起，
> 窄屏直接**溢出到 header 外**（左侧文本被裁、右侧搜索框被推出）。v9 重新划分为**两段**：
>
> | 段 | 入口 | 内容 |
> |---|---|---|
> | ① 首页（端游） | 顶栏「🏠 首页」 | 热榜 + 最新收录 + 分类，**内容与 v8 完全一致** |
> | ② 手机专区 | 顶栏「📱 手机专区」 | 页内 4 个平级页签：`#emu` 手游可玩 / `#pc` 实测配置 / `#eg` 模拟器指南 / `#dm` 机型兼容 |
>
> 具体改动：
> 1. **顶栏 6 → 2**：只留 `🏠 首页 / 📱 手机专区`；热榜与最新收录本就是首页的两个分区，合并成一个「首页」入口（点击回顶部）。
> 2. **首页移除引导卡 `#emuHub`**：首页内容保持不变，仅删掉那块「手机玩 PC」的跳转卡（及死 CSS）。
> 3. **独立页返回条 = 一条切换条、4 个平级页签**：`手游可玩 / 实测配置 / 模拟器指南 / 机型兼容`，点哪个切哪个，**无二级切换条**。
> 4. **默认降噪**：手游可玩默认开「✓ 仅看有实测」（962 vs 全量 2,597）；实测配置默认开「✓ 仅看可玩」（536）。
> 5. **页签数字回填**：`/api/bh/stats`→2,597、`/api/pc/stats`→1,025、`/api/device/stats`→1,030；「模拟器指南」用文字标签「指南」占位。
> 6. **窄屏防溢出**：`#emuTabs` 加 `overflow-x:auto` + `≤760px` 四等分 + `≤430px` 隐藏数字胶囊，根治截图里的顶栏溢出问题。
>
> **单源双页架构**：`public/index.html` 是主源（CSS / 顶栏 / 抽屉 / 通用脚本的唯一编辑入口），
> `public/emulator.html` 由 `tools/build-emulator-page.js` **派生** —— 复制共享资产，保留自己的四个分区。
> 改样式只需改 index.html 再跑一次生成器，两侧不会漂移（幂等：连跑三次字节一致）。
> 注意：`.emu-tabs / .emu-tab` 整组规则**已从主源移出**，改由生成器注入独立页专属 CSS，避免两处互相覆盖。

- **`public/index.html`** — 首页（`/` 直达，**端游内容不变**）：
  - **① 首页主体 = 🔥 全站热榜舞台**（深色舞台区，双热度合并榜）：标题 + **周榜 / 月榜 / 全站榜 / 社区榜** 四档切换 + 数据源说明与「更新 HH:MM」+ 手动刷新按钮。榜单版式 = **#1 冠军大卡**（大封面 + 中英文名 + NO.1 徽标 + 来源徽标 + 类型/容量/日期 + 大号评分）+ **#2-10 三列大卡网格**（排名 + 封面 + 中文名 + 源徽标 + 类型/容量 + ★）。点击任意卡片秒开详情抽屉；打开详情时榜内条目**同步高亮**。榜单服务端缓存 30 分钟，前端 `rankCache` 切档秒显。
  - **② 次级分区 = 最新收录**：分类标签行（13 类）+ **筛选条** + 行式内容卡列表（封面 + 中英文名 + 评分 + 类型 + 容量 + 更新日期），默认视图按 **日期分组**（今天更新 / 昨天更新 / 日期）展示，支持「加载更多」分页。筛选条 = **排序**（最新 / 评分 / 容量）+ **📏 容量区间**（全部 / 5GB 以下 / 5-15 / 15-30 / 30-60 / 60GB 以上）+ **📱 社区有配置**开关（只看有 BannerHub 社区模拟器配置的游戏）+ **🎮 有实测记录**开关（只看本站实测库里有记录的游戏），四者可任意叠加，右侧实时显示命中数。卡片上相应显示 `📱 可玩 N` / `🎮 实测 N` 徽标。右侧栏为**内容库状态**（增量更新 / 校准续跑 / 同步机地话题 + 空闲摘要）与**关于本站**。
  - **③ 手机专区（📱 手游可玩 / 🎮 实测配置 / 📖 模拟器指南 / 📲 机型兼容）—— 已独立成页 `/emulator.html`**。
    首页**不再放引导卡**（v9 移除），入口只留顶栏「📱 手机专区」与底部 Tab「手机专区」，点击直达独立页。
    下面四段描述的是各分区的内容与交互（**均位于 `/emulator.html`**）：
  - **③ 📱 手机可玩分区**（`#emu`，BannerHub 社区模拟器配置库）：数据来自开源仓库 [The412Banner/bannerhub-game-configs](https://github.com/The412Banner/bannerhub-game-configs)——玩家在安卓机上**实测跑通**某款 PC 游戏后，把模拟器配置（DXVK / Box64 / 驱动版本等）导出上传。分区含概览（可玩游戏 / 社区配置 / 机型 / GPU 数）+ **游戏名搜索** + **GPU 机型筛选** + 排序（配置最多 / 最近上传 / 名称）+ **「✓ 仅看有实测」开关（默认开）** + 卡片网格（配置数 + 支持机型数 + GPU 标签）。**按配置数排序 = 按「跑通人数」排序**，配置越多越省心。点卡片打开**配置面板**：逐条列出「机型 / GPU / 日期 / 下载 JSON 直链」，并可跳转 BannerHub 官网或 GitHub 目录。右上角 **「↻ 刷新配置库」** 按钮可现场拉取仓库最新快照（约 12-60 秒，服务端热加载无需重启）。命中本地库的卡片会显示封面与「查看游戏详情」按钮。
  - **④ 🎮 实测配置库分区**（`#pc`，本项目自建·**与第三分区的核心区别是带帧率和踩坑记录**）：数据来自《基础测试数据.xlsx》人工整理——每一条都是「某款 PC 游戏 **在某机型** 上用**某一整套模拟器配置**跑出来的结果」，字段含 **芯片/机型、是否可玩、兼容层版本（proton/wine）、运行模式、驱动、DXVK、vkd3d、运行库（Box64/Fex）、实测帧率、踩坑备注、主程序 exe 名**。分区含 5 项概览（实测记录 / 游戏数 / 标记可玩 / 芯片种类 / 踩坑备注）+ **游戏搜索** + **机型筛选**（骁龙 8 Gen 1 / 8 Gen 3 / 8 Elite / 870）+ **帧率档位筛选**（流畅 ≥55帧 / 可玩 28-55 / 勉强 15-28 / 卡顿 <15）+ 排序（帧率优先 / 配置最全 / 名称）+ **「✓ 仅看可玩」开关（默认开）**。卡片显示实测条数、中文芯片名、帧率档位标签、**最佳实测帧率**与首条踩坑备注。点卡片打开**实测配置面板**：逐条列出每个机型的完整配置串（兼容层 / 模式 / 驱动 / DXVK / vkd3d / 运行库 / 主程序）+ 帧率 + 备注，并可从面板一键跳转到第三分区看该游戏的社区配置。
  - **⑤ 🎮 模拟器指南分区**（知识库·**回答实测库之前与之后的问题**）：实测库解决「这款游戏跑多少帧」，本分区回答 **「我该装哪个驱动 / 构建」**（装错根本开不起来）与 **「开起来了但卡/黑屏该调什么」**。数据由 `data/emuguide.js` 提供，**完全静态、无外部依赖**，六个子块：
    - **① 五层技术栈**：GPU 驱动（Turnip/Mesa）→ 图形桥（DXVK/VKD3D）→ CPU 翻译（Box64/Box86）→ API 兼容层（Wine/Proton）→ 游戏 exe。强调「任何一层缺失或版本不匹配，结果是黑屏而不是卡」。
    - **② 芯片 → 推荐驱动/构建**（**本分区最有价值的一块**）：按 Adreno 世代给方案 —— **A6xx（865/870）→ K11MCH1 R5 / Mr Purple T19**（Turnip 已接近完美，瓶颈是算力；870 原厂驱动只有 Vulkan 1.1，必须换 Turnip 才有 1.3）；**A7xx（8 Gen 1/2/3）→ Mr Purple T25/T26**（GMEM 问题已在 Mesa v24-v26 解决，稳定性优先）；**A8xx（8 Elite）→ StevenMXZ Gen8 V36 / whitebelyash**（架构大改，老驱动直接崩，必须追最新 Gen8 专用构建）；**Mali/Xclipse（天玑/Exynos）→ Vortek / VirGL / Gladio**（无 Turnip 等价物，只能用官方 Winlator 11.2+ 的实验驱动）。
    - **③ DirectX 包装器对照表**：DX8 → D8VK/WineD3D；DX9/10/11 → DXVK；DX12 → VKD3D-Proton；老 2D → CNC DDraw/WineD3D。
    - **④ 优化清单（6 条·按投产比排序）**：降分辨率到 720p 优先 → 驱动与 DXVK 必须配套 → CPU 亲和性绑性能核但**留一个核** → Box64 先 Performance 不稳再退 Compatibility → 每游戏独立容器 → **exe 路径禁止中文**。
    - **⑤ 避坑清单**：带内核级反作弊的网游（英雄联盟/CS2/绝地求生/永劫无间/守望先锋）、纯 DX12 新作（赛博朋克 2077/荒野大镖客 2/星空）、强 DRM 加密单机、原生 ARM/UWP 程序 —— 均**结构上不可能跑**，不是配置问题。
    - **⑥ 实测帧率参考表**：社区公开数据（新维加斯 55-60 / 天际 40-50 / GTA5 25-35 / PES2018 锁 60 等）。
    - **联动**：实测配置面板内会自动出现 **「💡 驱动建议」** 条，把该记录所用芯片对应的推荐驱动直接展示出来，并可一键跳到本分区。
    - ⚠️ 内容整理自社区实测与公开文档（2026-09），UI 上明示为**经验参考、非官方保证**——驱动生态变化快，以发布页为准。
  - **⑥ 🔍 搜索弹窗**（顶栏搜索框 / `Ctrl+K` / `/` 唤起，Esc 关闭）：命令面板式，**输入即联想**（本地库毫秒秒搜，↑/↓ 选择 + 鼠标悬停高亮），回车 = **只搜本地合并库**（XD 全量 + 机地，毫秒级、无重复、离线可用），自动别名词典展开（法环→艾尔登法环），结果行点击 → 关弹窗直接开详情抽屉，**关闭详情后自动回到搜索态**（关键词 / 结果列表 / 滚动位置 / 刚看过那条的高亮全部还原，关闭键同时变为「← 返回搜索」；在抽屉内按 ←/→ 可在搜索结果之间连续切换）。**本地 0 命中**时才提示，可手动点「↗ 仍要实时搜源站」按需实时查 XDGAME / 机地（结果不进库、不进页面），也可勾选「以后本地搜不到时自动查源站」偏好（localStorage 记忆，免点击）。**搜索结果全部在弹窗内呈现，不再占用首页版面。**
  - **详情抽屉**：点击任意条目实时抓源站详情（封面、评分、大小、类型、介绍、版本、配置、预览）；**打开时先用本地库记录秒开基础信息（封面/评分/容量/类型），源站详情异步补全**（缺字段自动用库内值兜底）；支持 **←/→ 键盘切换同列表条目**、Esc 关闭（移动端可**抽屉内左右横滑**切换）；若**另一源也有同名收录**（机地话题 ↔ XD 版本）抽屉内自动出现互链按钮一键互跳；若**有 BannerHub 社区配置**则出现「📱 手机模拟器可玩」区块，若**有实测记录**则可从实测面板互跳；底部自动带**同分类更多**（取 genres[0] 高分条目洗牌 6 条，点击即换）。
  - **移动端**（≤760px）：底部固定 **Tab 导航**（热榜 / 最新 / 搜索 / **手机专区** / 关于，共 5 项，v9 从 7 项收敛）；热榜舞台单列化（冠军卡竖排、#2-10 单列），搜索弹窗贴顶全宽（88vh 内滚动），筛选条与分类行横向滑动，手机可玩与实测配置卡片单列，**独立页返回条的 4 个平级页签等分且可横向滑动**（≤430px 再隐藏数字胶囊），指南的分栏网格单列化，详情抽屉全屏。
- 旧多页（home 机地 iframe 同步页 / search 跨站搜索页 / library 库页）已**并入单页主站**，原 URL（`/home.html` `/search.html` `/library.html`）**301 跳转至 `/`**；文件保留在 `_archived/v1/` 可随时还原。

## 数据与源站

- **数据来源**：
  - XDGAME「最近更新」列表分页 `https://www.xdgame.com/list/1/list_{n}.html`（约 35 条/页，约 430 页 ≈ 1.5 万款）→ 本地索引
  - 机地 jidiyouxi.com → 首页新游更新 / 周月年热榜 / 话题同步入本地库（双源合并）/ 详情（社区话题制,无公开分页列表,可入库上限即「首页+热榜」话题集合）
  - **重要：`xdgame.com` 与 `xdgamer.com` 是两套内容独立的平行站（同 ID ≠ 同游戏）**。库数据全部属于 `xdgame.com` 域，条目 URL 与详情解析均走该域，切勿混拼（v1 曾因此发生 14,919 条详情错位，已修复）。
- **本地库**：`data/games.json`（约 5.5MB，**15,164 款** = XDGAME 15,118 + 机地 46，条目同构含封面/类型/容量/评分/更新日期；每日 09:30 自动增量同步）；`data/gamesDb.js` 内存 `Map` + JSON 单文件持久化（增量 `upsert`、防抖落盘）；`fetchers/indexer.js` 分页抓取解析（`data-sd/data-pd` 时间戳、封面 `data-original`、评分星、容量正则）；机地条目由 `fetchers/jidi.js libraryCandidates()` 生成（首页 SSR + 周/月/年热榜去重，`jidi-` 前缀独立 id）。
- **别名词典**：`fetchers/aliases.json`（法环→艾尔登法环…），搜索前自动展开。
- **📱 手机模拟器配置源（BannerHub）**：`data/bannerhub/` 存仓库快照（`raw/games.json` 游戏表 + `raw/devices.json` 机型表 + `raw/recent.json` 最近上传 + `filelist.txt` 配置清单），由 `tools/build-bannerhub.js` 聚合为 `data/bannerhub.json`（索引，446KB）与 `data/bannerhub-files.json`（逐条配置，1.7MB，**服务端按需懒加载，不进前端首包**）。`data/bannerhub.js` 提供归一化匹配（去除非字母数字后比对，兼容 `Grand_Theft_Auto_V_Legacy` ↔ `侠盗猎车手5/Grand Theft Auto V`）。
  - 当前规模：**2,597 款游戏 / 14,003 份配置 / 1,479 款机型 / 89 种 GPU**；与本地库匹配 **844 款**（覆盖 994 条库记录）。
  - 刷新数据：**三种方式**——① 页面上点「↻ 刷新配置库」按钮；② 接口 `POST /api/bh/refresh`（配合 `GET /api/bh/refresh/state` 轮询，实测 12～57s 完成）；③ 命令行 `bash tools/refresh-bannerhub.sh` 或 `node tools/refresh-bannerhub.js --json`。三者都走 codeload 下载，**不用 git clone**——本机 github.com 主站被拦，codeload/api 可通。刷新完成后服务端**热加载索引，无需重启**。
  - ⚠️ 匹配率约 45% 属正常：BannerHub 偏**老游戏/小体积游戏**（这些才跑得动手机），XDGAME 库偏**近两年新游**，两个集合天然只有部分重叠（如 `Age of Empires II HD` 与库内 `Age of Empires II: Definitive Edition` 是不同版本，正确判为不匹配）。
- **🎮 实测配置源（本项目自建）**：源文件 `E:\新建文件夹\基础测试数据.xlsx`（人工整理的 1037 行实测记录，Sheet1 共 18 列，只读不修改），由 `tools/build-phonecfg.py`（Python + openpyxl）解析为 `data/phonecfg.json`（索引，803KB）。`data/phonecfg.js` 提供归一化匹配、列表查询、逐条记录反查与芯片代号映射。
  - 当前规模：**1,037 条实测记录 / 1,025 款游戏 / 543 条标记可玩 / 474 条标记不可玩 / 989 条含完整配置 / 124 条踩坑备注 / 578 条含主程序名**。
  - 机型分布：**骁龙 8 Gen 1（716 条）/ 骁龙 870（207）/ 骁龙 8 Elite（88）/ 骁龙 8 Gen 3（14）**（原表 A 列是芯片代号 `8gen1`/`870`/`8e`/`8gen3`，构建脚本映射为可读名）。
  - 帧率分档：**流畅 456 / 可玩 307 / 勉强 135 / 卡顿 80 / 不可用 1**（「流畅」= ≥55 帧，「可玩」= 28-55，「勉强」= 15-28，「卡顿」= <15；原表 J 列是自由文本如「60帧」「30-60帧」「10-20帧」「帧数不显示，很流畅」）。
  - 重建数据：`python tools/build-phonecfg.py`（改完源表后运行；**phonecfg 是只读索引，服务端需重启才会重新加载**）。
  - ⚠️ 两个手机分区分工不同：**第三分区（BannerHub）看覆盖面**——2597 款游戏、14003 份社区配置、1479 款真实手机机型；**第四分区（实测库）看可用性**——1037 条记录，但多两样关键信息：**实测帧率**（值不值得装）和**踩坑备注**（哪里会翻车，如「控制器打开 Dinput 关闭 Xinput」「长时间黑屏加载」「A 列机型卡关机」）。
  - ⚠️ 源表已知数据质量问题（**如实保留，不做臆测修正**）：A 列存在少量脏值（网址、数字 `0`、`处理器`、`gta`），构建脚本只识别已知芯片代号，其余归为「未标机型」；少数条目「最佳帧率」偏高（如 130-144）系原表写法所致。
- **📖 模拟器指南知识源（本项目自建·纯静态）**：`data/emuguide.js` —— 无外部文件、无构建步骤、无网络依赖，全部内容以常量形式内联，服务启动即生效。
  - 内容构成：`STACK`（五层技术栈 5 项）/ `CHIPS`（芯片世代→驱动 4 组）/ `WRAPPERS`（DX 包装器对照 4 行）/ `TUNING`（优化要点 6 条）/ `AVOID`（避坑清单 4 类）/ `BENCH`（帧率参考 6 条）。
  - **来源**：2026-09 联网调研整理（Winlator/GameHub/GameNative 生态、Turnip Mesa 驱动、Box64/DXVK 文档、社区实测帖）。属**第三方社区经验**，非本项目实测，故每条统一以 `src` 字段标注来源并在 UI 上明示「非官方保证」。
  - **与实测库的关系**：实测库给**结果**（某配置跑了多少帧），指南给**前置决策**（该装什么驱动）与**失败归因**（卡/黑屏该怎么调）。二者通过 `CHIPS[].keys`（如 `8gen3` / `870` / `8e`）与实测库的芯片代号打通，实测面板内自动显示对应驱动建议。
  - 维护：直接改 `data/emuguide.js` 的常量数组即可，**改完需重启服务**（与其他 data 模块一致）。
  - ⚠️ 时效性提示：Turnip 驱动与 Winlator 构建迭代很快（如 A8xx 支持在 2026 上半年才通过 v26.1.0 / A8XX v20+ 落地），本指南反映的是 2026-09 时点的社区共识，过期后需重新核对发布页。

## 如何使用

### 方式 1：在线实时版（推荐）
1. `cd game-aggregator && npm install`（首次）；
2. `npm start` 或双击 **`启动聚合站.cmd`**（前台可见日志）/ **`启动聚合站-静默.vbs`**（无黑窗）
   → 自动占 8123 端口，并在浏览器打开；已在跑时**只开浏览器**，不会起第二个实例；
3. 打开 **http://localhost:8123** —— 即单页聚合主站。
4. 支持 URL 直达：`/?q=剑星`（搜本地库）、`/?c=角色扮演`（分类直达）、`/?sort=score`（评分排序）。
5. 首页侧栏「内容库状态」卡提供内容库维护三按钮（均带进度条，可离开页面后台执行）：
   - **↻ 增量更新**：抓 XD「最近更新」列表头部页并入本地库（秒级～30s）；
   - **校准续跑**：校准 XD 库至最新页；中途中断会写入 `data/index-state.json` 断点，下次从断点续跑；
   - **⇅ 同步机地话题**：把机地首页新游 + 周/月/年热榜去重后的话题并入本地库（双源打通，约 60-70 款）。
   卡片下方常显空闲摘要（XD 校准页码 / 断点位置 / 机地最近同步）。
6. **每日自动同步（可选自动化）**：已配置 WorkBuddy 定时任务「GameHub 内容库每日自动同步」——每天 09:30 自动执行 **① XD 增量 → ② BannerHub 社区配置库刷新 → ③ 实测配置库重建（`build-phonecfg.py`）→ ④ 机地话题同步**，最后汇报三套库的规模（服务离线会自动拉起），无需手动点按钮。注意：**模拟器指南（`emuguide.js`）不参与自动化**——它是静态知识库，内容变化来自社区生态而非本站数据源，需人工按需更新（见「数据与源站」末尾的时效性提示）。

### 方式 2：离线快照 HTML（无 Node 也能看）
- 服务在跑时访问 **http://localhost:8123/snapshot.html**（现场抓最新数据注入 `index.html` 后返回完整单文件），右键另存即可双击离线使用。
- 离线双击时页面自动降级：有内嵌快照则展示快照数据，详情抽屉提示前往源站。

## 目录结构

```
game-aggregator/
├── server.js            # Express 服务 + 缓存 + 路由（含 /snapshot.html 快照生成）
├── 启动聚合站.cmd        # 主入口：双击启动（前台，日志可见；幂等：已在跑就只开浏览器）
├── 启动聚合站-静默.vbs   # 日常用：无黑窗启动后自动开浏览器
├── stop-gamehub.cmd     # 停止：按端口 8123 杀 PID（ASCII 名 —— .cmd 提示文字里会引用它）
├── 打开线上版.url        # 直接用浏览器打开线上分享链接
├── fetchers/
│   ├── jidi.js          # 机地：热榜 / 收录匹配 / 详情
│   ├── jidiHeadless.js  # 机地深度搜索（puppeteer-core 驱动本机 Edge，可选加载）
│   ├── xdgamer.js       # XDGAME：今日更新 / 详情(detail(id,host)) / 站内搜索 / 分类页
│   ├── xdrank.js        # XD 官网官方热度榜（首页 .hot-soft 三档 SSR：本周/当月/全站 → /api/rank）
│   ├── indexer.js       # XDGAME 全量列表索引器（分页抓取 → gamesDb）
│   └── aliases.json     # 搜索别名词典（法环→艾尔登法环…）
├── data/
│   ├── gamesDb.js       # 本地游戏库：内存 Map + JSON 持久化 / upsert / search / browse（含容量区间过滤）
│   ├── games.json       # 已索引数据（XDGAME 全量 + 机地话题，双源同构条目）
│   ├── index-state.json # ★ 索引断点/校准/机地同步状态（服务重启不丢，可续跑）
│   ├── bannerhub.js     # ★ BannerHub 配置索引：归一化匹配 / 列表 / 逐条配置（懒加载）
│   ├── bannerhub.json   # ★ 聚合索引（2597 款游戏的配置数/机型/GPU，446KB）
│   ├── bannerhub-files.json # ★ 逐条配置明细（14003 条，仅服务端按需读）
│   ├── bannerhub/       # ★ 仓库快照：raw/{games,devices,recent}.json + filelist.txt
│   ├── phonecfg.js      # ★ 实测配置库索引：匹配 / 列表（机型·帧率筛选）/ 逐条记录反查
│   │                    #   v7 起还负责读取 cn-names.json 别名表（带 aliasSane 二次防误配）
│   ├── phonecfg.json    # ★ 实测索引（1037 条记录 / 1025 款游戏，803KB）
│   ├── mobilehub.js     # ★ v9.3：手游中心统一索引读取与查询（list/stats/lookup/ensure/normKey）
│   │                    #   默认排序 'both'「双料优先」、默认只返回匹配端游库的
│   ├── mobilehub.json   # ★ v9.3：社区库+实测库合并去重索引（3,161 款，配置数累加、bhKeys 记仓库键）
│   ├── mobilehub-names.json # ★ v9.3：未命中项联网补名的别名表（Steam 官方 API，与 cn-names 合并读）
│   ├── cn-names.json    # ★ v7：联网学到的中英游戏名别名表（143 条，Steam 官方 API 来源）
│   ├── emuguide.js      # ★ 模拟器指南知识源（五层栈/芯片驱动/包装器/优化/避坑/帧率，纯静态常量）
│   ├── soc-db.json      # ★ v8：芯片规格库（1444 款 / 44 厂商，vitkuz573/soc-db）
│   ├── device-board.json# ★ v8：主板代号 → SoC / CPU（200 条，xTheEc0）
│   ├── turnip.json      # ★ v8：Turnip 驱动构建看板（Mesa/Vulkan 版本 + 3 变体 + 15 release）
│   ├── gpu-tier.js      # ★ v8：GPU 性能层级表（93 型号 → 统一性能分，跨家族同量纲）
│   └── device-match.js  # ★ v8：机型兼容匹配引擎（机型→GPU→可跑游戏，向下兼容）
├── tools/
│   ├── build-emulator-page.js # ★ v7：由 index.html 派生 public/emulator.html（单源双页，幂等）
│   ├── emulator-sections.js   # ★ v7：独立页四个分区的驱动脚本（init/load/渲染/配置面板）
│   ├── fetch-sources.js       # ★ v8：抓取 soc-db / device-board / turnip 三源落盘
│   ├── refresh-sources.sh     # ★ v8：刷新外部数据源（含重启提示；turnip 建议每周）
│   ├── learn-cn-names.js      # ★ v7：联网查 Steam 官方中英名 → cn-names.json（含三重防误配）
│   ├── clean-excel.py         # ★ v7：清洗《基础测试数据.xlsx》→ 拼音排序 + 黄/橙底标注
│   ├── stat-match.js          # ★ v7：统计实测库→本地库匹配率与别名命中抽样
│   ├── test-alias-guard.js    # ★ v7：别名护栏黑盒验证（该拦的拦住、该放的放行）
│   ├── build-bannerhub.js   # ★ 由仓库快照生成 bannerhub.json / bannerhub-files.json
│   ├── refresh-bannerhub.js # ★ 纯 Node 版刷新（服务端 spawn 调用，支持 --json）
│   ├── refresh-bannerhub.sh # ★ 重新拉取仓库并重建索引（codeload，非 git clone）
│   ├── build-phonecfg.py    # ★ 由《基础测试数据.xlsx》生成 phonecfg.json（Python + openpyxl）
│   ├── build-mobilehub.js     # ★ v9.3：合并社区库+实测库 → mobilehub.json（含数字一致性护栏）
│   ├── learn-mobilehub-names.js # ★ v9.3：未命中项联网补名（Steam 官方 API + 跨语言桥 l=english）
│   ├── test-emulator-page.js # ★ v9：两页行为回归（67 项断言，含 3 页签互切、合并卡、默认开关）
│   ├── test-emulator-structure.js # ★ v9：静态结构体检（37 项：死 CSS/废弃 id/重复注入/漏 initEmu）
│   └── test-emuhub.js       # 已废弃，转调 test-emulator-page.js（保留兼容旧命令）
├── shared.js            # 抓取工具（UA / 超时 / 图片补全）
├── public/
│   ├── index.html       # ★ 单页聚合主站（`/` 直达）—— **主源**，改它必须重建两个派生页
│   ├── emulator.html    # ★ 手机专区独立页（`/emulator.html`）—— 派生自 index.html，勿手改
│   └── unpack.html      # ★ v10.20 解包配置匹配（`/unpack.html`）—— 同样派生
├── _archived/           # 废弃版本 / 清理归档（gitignore；**可随时还原，勿直接删**）
│   ├── v1/              # v1 旧版多页备份（home/search/library/快照）
│   ├── index-v2/v3-20260910.html
│   ├── launcher-v1-20260904.bat
│   └── cache-purge-20260920/   # 09-20 缓存清理归档（还原方法见其内 README.md）
├── DESIGN.md            # 页面设计规范
```

### 输出 / 缓存目录（都不进 Git —— 可按需重建，不是项目数据）

| 目录 | 体积 | 作用 | 谁产出 |
|---|---|---|---|
| **`.cache/`** | 120 MB | 抓取 + 浏览器缓存 | `browser.js` / `fetch-soc-*.js` / `build-saves.js` |
| **`_preview/`** | 54 MB / 122 文件 | 浏览器实拍截图（改动验收的「效果图」） | 26 个 `preview-v*.js` / `test-v1025-*.js` |
| **`_bak/`** | 17 MB | 改动前的**时间戳备份**（回滚点） | `fix-bad-score.js` / `migrate-dates.js` |
| **`_archived/`** | 449 MB | 废弃版本 + 清理归档（回退路径） | 手工归档 |
| **`_test-out/`** | ~0 MB | 测试隔离落盘（不污染真实缓存） | `test-v1018.js` |
| `_online/` | — | 线上页面抓取比对 | 按需生成（当前不存在） |

> **⚠️ `.cache/` 清理红线** —— 里面有 4 类**源码写死依赖**的离线重跑缓存，
> 删掉不会报错，只会让 `--offline` 悄悄退化成联网重抓：
> `.cache/chrome-preview/`（`tools/browser.js:61` 的 `--user-data-dir`）·
> `.cache/soc-cpu/`（`tools/fetch-soc-cpu.js:38` 的 `PAGES`）·
> `.cache/nanoreview-soclist-1~4.html`（`fetch-soc-cpu.js:49` + `fetch-soc-map.js:38`）·
> `.cache/ludusavi-manifest.yaml`（`tools/build-saves.js:43`）。
>
> ★ `fetch-soc-map.js` 的缓存文件名是**拼出来的**（`'nanoreview-soclist-' + p + '.html'`），
> 所以「搜完整文件名」会**漏判** ⇒ **清理前必须读源码，不能靠字符串搜索**。

## API

| 接口 | 说明 |
|---|---|
| `GET /api/health` | 存活检查 |
| `GET /api/feed?refresh=1` | 聚合两源最新条目（缓存 180s） |
| `GET /api/detail?url=…&refresh=1` | 源站详情页实时解析（缓存 600s；域名白名单含 xdgame/xdgamer/jidiyouxi） |
| `GET /api/search?q=…&mode=headless` | 跨站搜索（机地收录匹配 / XDGAME 站内实时；mode=headless 为机地深度搜索） |
| `GET /api/hots` | 机地周/月/年热榜（缓存 600s） |
| `GET /api/rank?p=week` | **🔥 双热度合并榜（首页主体）**：p=week/month/year → XD 官方热度（SSR 解析映射本地库记录）；p=community → 机地社区周榜（缓存 1800s） |
| `GET /api/category?c=dzmx` | XDGAME 分类列表（缓存 300s，13 类 slug） |
| `GET /api/library/stats` | 本地库总量 / 按源统计 / 是否正在索引 |
| `GET /api/library?q=…&limit=40&sizeMin=&sizeMax=&bh=1` | 本地库即时搜索（毫秒级，自动别名词典展开；支持容量区间与「仅手机可玩」过滤） |
| `GET /api/library/browse?g=动作冒险&limit=50&offset=0&sort=score&sizeMin=30&sizeMax=60&bh=1` | **分类浏览本地库**（genres 过滤 + 排序 updated/score/size + 分页 + **容量区间(GB)** + **仅手机可玩**，首页主干数据；响应条目带 `bh` 字段） |
| `GET /api/library/recent?limit=18` | 最近收录（更新时间倒序） |
| `GET /api/bh/stats` | **📱 BannerHub 概览**：游戏数 / 配置数 / 机型数 / GPU 数 / 匹配统计 / Top 榜 |
| `GET /api/bh/list?q=&sort=configs\|recent\|name&gpu=&libOnly=1&limit=&offset=` | **📱 社区配置列表**（搜索 + GPU 筛选 + 排序 + 分页）。v6 起每条平铺 `libId/libTitle/libUrl/libCover`（命中本地库即有封面与详情入口）。**v9 新增 `libOnly=1`**：只返回能对上本地库的游戏（全量 2,597 → 962），供「手游可玩」默认降噪 |
| `GET /api/bh/match?t=<游戏名>` | 按库内标题反查 BannerHub 配置（归一化匹配，供卡片徽标与详情区块） |
| `GET /api/bh/configs?k=<仓库键>` | 某游戏的**逐条配置**（机型 / GPU / 日期 / 下载直链 / 官网链接） |
| `POST /api/bh/refresh` | **📱 刷新配置库**：spawn `tools/refresh-bannerhub.js` 拉取 codeload 快照 → 重建索引 → 热加载（无需重启服务）。已有任务在跑时返回 `running:true` |
| `GET /api/bh/refresh/state` | 刷新任务状态（供前端/自动化轮询）：`running` / `lastOk` / `error` / `result{games,configs,phones,gpus,matchedLibGames,ms}`。注意 `ok` 恒为 true（=状态查询成功），任务成败看 `lastOk` |
| `GET /api/pc/stats` | **🎮 实测配置库概览**：记录数 / 游戏数 / 可玩数 / 机型分布 / 帧率分档 / GPU 与兼容层分布 / `chipMap` 芯片代号映射 |
| `GET /api/pc/list?q=&chip=&tier=&ok=1&sort=fps\|cfg\|name&limit=&offset=` | **🎮 实测可玩游戏列表**（搜索 + 机型筛选 + 帧率档位筛选 + 仅看可玩 + 排序 + 分页）。v6 起同样平铺 `libId/libTitle/libUrl/libCover` |
| `GET /api/pc/match?t=<游戏名>&t2=<备用名>` | 按库内标题反查实测记录聚合（供卡片徽标；支持双候选名） |
| `GET /api/pc/records?k=<游戏名>` | 某游戏的**全部实测记录**（逐条：机型 / 可玩标记 / 兼容层 / 模式 / 驱动 / DXVK / vkd3d / 运行库 / 帧率 / 备注 / 主程序）。v6 起额外带回 `lib{id,title,url,cover}` |
| `GET /api/mobilehub/stats` | **📱★ 手游中心概览（v9.3 新增）**：`{builtAt,total,matched,unmatched,matchedRate,configs,records,playable,onlyBh,onlyPc,both,gpus,chips}`。当前 3,161 款 / 匹配 1,522（48.1%）/ 配置 14,998 / 实测 1,037 |
| `GET /api/mobilehub/list?q=&sort=both\|configs\|records\|fps\|name&gpu=&tier=&stats=all&limit=&offset=` | **📱★ 手游中心合并列表（v9.3 新增）**：社区库 + 实测库**合并去重**后的统一卡片流。默认 `sort=both`「双料优先」、**默认只返回匹配上端游库的**（传 `stats=all` 看全量）。每条含 `name/alt/configs/records/bestLabel/tier/gpus/sources/bhKeys/libId/libTitle/libCover` |
| `GET /api/mobilehub/match?t=<游戏名>` | **★ 手游中心反查单款（v9.3 新增）**：按名/别名在合并索引里查一条，带回匹配到的端游库信息 |
| `GET /api/search/all?q=&limit=` | **★ 全站统一搜索（v9.3 新增）**：一次搜「端游库 + 手游中心」，**结果分组返回** `{ok,q,aliasNote,pc:{count,items},mobile:{count,items}}`。手游专区顶栏搜索按钮走这里 |
| `GET /api/emuguide` | **📖 模拟器指南全文**（五层技术栈 / 芯片驱动对应 / DX 包装器对照 / 优化清单 / 避坑清单 / 帧率参考 + `src` 来源标注）。体量小，一次返回 |
| `GET /api/emuguide/chip?c=<芯片代号>` | **某芯片代号 → 推荐驱动/构建**（如 `8gen3` → Mr Purple T25/T26）。供实测配置面板联动显示。未知代号返回 `hit:false` 而非报错 |
| `GET /api/device/stats` | **机型库规模**（v9 新增）：`{brands: 17, devices: 1030}`。供独立页第 4 个页签「机型兼容」回填真实数字 |
| `GET /api/device/brands` | **📲 机型兼容查询**：品牌列表（含各品牌机型数）。18 个品牌分组 |
| `GET /api/device/models?brand=&q=&limit=` | 机型列表（按品牌筛选 / 关键词搜索）。1030 条机型，每条带 `gpu` 与 `score`（GPU 性能档） |
| `GET /api/device/match?model=&limit=` | **核心接口**：某机型 → 可跑游戏清单。按「GPU 性能档向下兼容」推断，每条带 `verdict`（smooth 流畅 / ok 可玩 / maybe 勉强）与 `minGpu`（该游戏已验证的最低配置）。返回 `summary{smooth,ok,maybe}` |
| `GET /api/device/chip?q=<芯片名>` | 芯片规格（来自 soc-db，1444 款 / 44 厂商）：GPU / 制程 / 频率 / 内存 / DSP / 架构 + `perf`（该芯片 GPU 性能档） |
| `GET /api/device/turnip` | **Turnip 驱动最新构建看板**：Mesa 版本 / Vulkan 版本 / commit / 构建日期 + 三个变体（标准 A6xx-A7xx / A710-720 实验 / A8xx 实验）+ 最近 15 个 release |
| `GET /api/library/go?q=…` | 取库中最匹配一条（title/url/cover，支持别名，供快捷跳转） |
| `GET /api/library/item?id=xd-3887` | **按 id 取本地库单条**（v6 新增，供手机两库卡片点封面/「查看游戏详情」直达详情链路：前端拿 id → 这里换 url → 走 `/api/detail`） |
| `GET /api/library/index/state` | 索引状态（XD 断点页码 / 校准时间 / 机地同步统计） |
| `POST /api/library/index/incr?pages=10` | **增量更新**：抓最近 N 页入本地库（记录 lastIncrAt） |
| `POST /api/library/index/calibrate` | **校准/断点续跑**：探测最新页数 → 有断点则续跑；未校准先尾页抽查（全覆盖即免跑）否则补齐至最新 |
| `POST /api/library/index/jidi` | **机地双源合并**：首页新游 + 周/月/年热榜去重话题入本地库（jidi- 前缀独立条目） |
| `POST /api/library/index?start=1&end=30` | 手动指定页码范围（调试用，不动断点） |
| `GET /api/library/progress` | 任务进度（run=XD / runJ=机地 / state=断点） |
| `GET /snapshot.html` | 现场抓取 → 返回内嵌快照的完整 HTML（可另存） |

## 手机两库 ↔ 本地库匹配（v7）

社区库与实测库的条目会按标题与 `games.json`（XD 15,118 + 机地 46）匹配，命中即回填**封面**与**「查看游戏详情」**入口。

| 数据源 | 条目数 | 命中本地库 | 命中率 |
|---|---|---|---|
| 📱 社区配置（`bannerhub.js`） | 2,597 | 2,516 | **96.9%** |
| 🎮 实测配置（`phonecfg.js`） | 1,025 | **630** | **61.5%**（v6 之前仅 **6.8%**，v6 为 58.1%） |

### 四层匹配策略（`phonecfg.libMatch`）

1. **保留 CJK 的多段精确钥匙** —— 按 `/ ／ | ｜` 拆段，每段用 `phonecfg.normKey`（保留中文）归一。本地库标题是多段式（`星界战士/星座上升/Astral Ascent`），必须逐段建钥匙才能被中文名命中。
2. **🆕 联网学到的别名表** `aliasByKey` —— 读 `data/cn-names.json`，把「源名 → Steam 官方中英别名」并入匹配钥匙。例：实测库写 `Ever 17`，本地库是 `时空轮回/Ever 17 - The Out of Infinity`，学到的 `ever17` 别名直接命中。**再过一道 `aliasSane()` 护栏**（见下）。
3. **英文段交叉索引** `libByEn` —— 本地库每段里的英文词组单独建索引，**只收 ≥6 字符**，避开 `The` / `Game` / `Plus` 这类低区分度短词的滥配；查询侧也只抽 **≥4 字符** 的英文片段。
4. **放弃** —— 宁可返回 `null` 也不滥配（挂错封面比不挂更糟）。

### 🆕 v7：联网学中文名（`tools/learn-cn-names.js`）

未命中本地库的 **429 款**实测库游戏 → 查 **Steam 官方商店 API**：

| 接口 | 作用 |
|---|---|
| `storesearch/?term=<名>&l=schinese&cc=CN` | 英文名/中文名 反查 appid |
| `appdetails?appids=<id>&l=schinese` | 取**官方简体中文名** |
| `appdetails?appids=<id>` | 取**官方英文名** |

限流约 3 req/s（脚本内 `sleep(320ms)`）。**采纳 143 / 无结果 286 / 拒收 19 / 错误 5**。

#### 三重防误配（血泪教训）

首版直接采纳搜索结果第一条，结果：

```
天            → 死前30天
FLOWERS 夏篇  → Wylde Flowers          ← 共享 "flowers"，Dice 0.64 越过阈值
Making*Lovers → Kerbal Space Program: Making History Expansion
9-nine-*      → 四部全指向同一款
```

修复分三层：

1. **相似度阈值** `MIN_SIM = 0.62` —— 子串关系给 0.82，否则用 **Dice 系数**（双字符组）；低于阈值直接**拒收**（宁可空着）。
2. **人工白名单 `KNOWN_SAME`** —— 字符串规则补不全的（`FIFA18` → `国际足球大联盟18`、`史丹利的寓言终极豪华版` → `史丹利的寓言：超豪华版`、`最终幻想lll` → FF3）在此人工登记。
3. **人工否决表 `VETO` + 跨文种护栏 `scriptMismatch`** —— `FLOWERS 夏篇` 这类「字面像、游戏不同」的必须按名字否决（共享一个英文词就能骗过 Dice）；纯 CJK 源名配到纯 ASCII 结果也一律拦下。

#### 运行时第二道护栏 `aliasSane()`（`phonecfg.js`）

即便 JSON 里有漏网别名，`libMatch` 也会再验一次 —— 要求**一方完整包含另一方**，或**源名的 k-gram 覆盖率 ≥0.5**，且源名里最长的 ASCII 特征词必须是对应**独立词的词首**（`flowers` 在 `wyldeflowers` 里只是后半截 → 判否）。黑盒验证 `tools/test-alias-guard.js` **7/7 通过**。

### 为什么不能复用 `bannerhub.titleKeys`

那套是为「数据源是英文名」设计的：

```js
function normKey(s) { return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
// titleKeys 末尾还会 filter(k => k.length >= 4)
```

`[^a-z0-9]` 会把中文**整段清成空串**，再被 `length >= 4` 过滤掉 → `titleKeys('星界战士')` 返回 **`[]`**。而实测库的数据恰恰是**中文名**，用那套钥匙必然只有 6.8% 命中率。因此 `phonecfg.js` 内另写了一套保留 CJK 的 `libKeys()`，**不修改 `bannerhub.js`**（它的 96.9% 已经很稳，不动为妙）。

### 反作弊抽查（零误配）

以下极易误配的名字全部返回 `null`：

```
9-nine-天色天歌天籁音   120日元   +   天   KARAKARA
CROSS†CHANNEL   少女领域   G线上的魔王   D.S. -Dal Segno-   FIFA18
FLOWERS 夏篇   Cookie Cutter Overkill Edition   月姬   寒蝉鸣泣之时
```

实测库剩余未命中项（如 `FIFA18` / `G线上的魔王`）经 `gamesDb.search` 抽查确认 count 0 → **本地库确实没收录**，是真实数据缺口而非匹配 bug。原因：实测库偏**视觉小说 / 日系小众**（这些才跑得动手机），XD 库偏 **3A 新游**。

### 前端两条点击链路（互不干扰）

| 点击位置 | 行为 |
|---|---|
| 卡片封面 / 「查看游戏详情」按钮 | `openDetailById(id)` → `/api/library/item` 取 url → 统一**游戏详情抽屉**（关掉即回列表，不回搜索态） |
| 卡片其余区域 | 社区库 → **社区配置面板**（`openBhPanel`，机型/GPU/日期/下载直链表）；实测库 → **实测配置面板**（`openPcPanel`，逐条机型/兼容层/驱动/帧率/备注） |

## 回归测试

```bash
node server.js &                                    # 先起服务（改过 data/*.js 只读索引需重启）
node tools/test-emulator-page.js                    # 行为回归 67 项（jsdom）
node tools/test-emulator-structure.js               # 结构体检 37 项（静态）
node tools/test-emuhub.js                           # 兼容层，内部转调 test-emulator-page
node tools/test-alias-guard.js                      # 别名护栏 7 项黑盒验证
node tools/stat-match.js                            # 匹配率与别名命中抽样
```

**两套测试互补**（v9 起）：

| 脚本 | 断言数 | 测什么 | 覆盖不到什么 |
|---|---|---|---|
| `test-emulator-page.js` | **67/67** | 点得动：3 页签互切、深链、合并卡渲染、`data-lib` 覆盖、帧率 pill、来源徽标、点击分流、默认开关态 | 骨架脏数据 |
| `test-emulator-structure.js` | **37/37** | 不该在的别在：死 CSS、废弃 id（`#phonecfg`/`#pcToggleOk`）、重复注入（`initEmu`/`EMU_PAGE_SIZE` 各一次）、3 分区 DOM、`#pc` 深链兼容 | 行为正确性 |

`test-emulator-page.js` 覆盖：

- **首页**：只剩 1 个 `<main>`、无 `#phonecfg`/`#emuguide` 残留、**已移除引导卡 `#emuHub`**、**顶栏恰好 2 个入口**（`🏠 首页 / 📱 手机专区`）、「手机专区」指向 `/emulator.html` 不带 hash、旧入口（`navRank`/`navLatest`/`navPc`/`navEg`/`navDm`）已清、底部 Tab 只剩 `tabEmu`、无 `switchEmuTab`/`loadPc`/`initEg` 残留。
- **独立页（v9.3）**：三分区 DOM 齐全且**都带 `data-et`**、返回条、**一条切换条 3 个平级页签**（`emu/eg/dm`）、**二级切换条 `#egSubbar` 已彻底移除**、**手游中心默认「仅看匹配端游」**、合并卡渲染（`configs`/`records`/`bestLabel` pill + 来源徽标）、`data-lib` 全卡覆盖、帧率 pill、指南 5 层渲染、机型匹配渲染、**深链 `#eg`/`#dm` 直连对应页签且 tab 同步激活、旧 `#pc` 深链自动改写成 `emu`**。
- **切换有效性**（v9.1 新增·直击「没有交互」）：切到「机型兼容」后 `#emulator` 必须被加上 `et-hide` **且带 `data-et`**（否则隐藏规则不生效）、**全场只剩 `#devmatch` 可见**、有且只有一个页签处于 `on`、**页面不残留裸 CSS 文本**。

> **jsdom 测试桩的两个坑**：① `beforeParse` 阶段 `w.fetch` 尚未定义，需 `const raw = w.fetch; w.fetch = (u,o) => (raw||nativeFetch).call(w, 绝对化(u), o)`；② 解构出 fetch 再调用会丢 `this`，报 `f is not a function`。
>
> **单源双页生成器的七个坑**（`build-emulator-page.js`，都踩过并已修）：
> ① 非贪婪 `[\s\S]*?\n\}\)\(\);` 会提前吃到**上一个**块的结束括号 —— 「引导卡数字」那段以 `(async () => {` 开头，若先处理它就会把「专区跳转块」整个吞掉，导致下一步再也匹配不到；**v9 起改用显式标记行 `/* [派生页锚点] */` 收尾，并加 `EMU_PAGE_HREF` 残留自检**；
> ② 派生脚本必须插在 `<script>` 与 `</script>` **之间**（`cut(a, b)` 是含两端行的，直接用会把 `</script>` 带进来，追加内容全落到标签外面成了裸文本）；
> ③ `const pcState` 声明在 `SECTIONS_JS` 里、而 `TAB_JS` 末尾的 `bootTab()` 立即执行并调用 `initPc()` 读 `pcState` —— 拼接顺序必须 **SECTIONS → TAB**，否则 TDZ 报 `Cannot access 'pcState' before initialization`；
> ④ **head 不能从派生页自己截**。若按「截到 `</style>` 为止」取 head，派生页已含上一轮注入的整段 CSS，就会把旧 CSS 一起留下 —— 每跑一次文件涨一份（实测涨到 877KB / 9 个 `<style>`）。正确做法：**head 骨架从主源 `index.html` 取**（稳定、不含注入物），只把派生页自己的 `<title>`/`<meta>` 覆盖上去。修完文件从 877KB 回到 **151KB**，连跑三次字节数完全一致（真幂等）。
> ⑤ **★ 幂等哨兵必须锚在长期存在的符号上（坑 11，v9.3）**。哨兵原本锚 `function initPc`，v9.3 删掉该函数后哨兵**恒为假** → 每跑一次生成器就**重复注入整份 SECTIONS_JS**，派生页报 `Identifier 'EMU_PAGE_SIZE' has already been declared` **整页崩**。改用 `const SEC_SENTINEL = /function initEmu\s*\(/;`（提到 `secBlock()` 上方避免 TDZ）。**教训：绝不把哨兵锚在「可能被本次重构删掉」的函数名上。**
> ⑥ **`fillTabNums` 旧实现残留导致语法错误**。早先一次 Edit 只替换了函数体的一部分，旧的 `async function fillTabNums() {` 与旧 `bh/stats` 分支留在文件里 → `Unexpected token ')'`。改函数体时务必**整函数替换**，改完立刻跑结构体检。
> ⑦ **改分区骨架必须同时改三处**：`tools/emulator-sections.js` 的分区内容、`build-emulator-page.js` 的 `SECTIONS` 骨架表与 `ET_MAP`/页签条、`index.html` 的对应 CSS。漏掉任一处就是「点了没反应」或「裸 CSS 文本」。

## Excel 清洗（v7 新增）

```bash
python tools/clean-excel.py       # 读 E:/新建文件夹/基础测试数据.xlsx
```

输出 **`E:/新建文件夹/基础测试数据-清洗版.xlsx`**（两个 sheet：`清洗后数据` + `清洗报告`；只读源文件、不改动）。

| 环节 | 处理 |
|---|---|
| 幽灵行 | 无游戏名且无兼容层/驱动/帧率的行删除（**-14 行**） |
| 机型代号归一 | `8egn1` / `gta` → `8gen1`；`8gen1、870` 这类多机型展开（**4 处**） |
| 可玩列回填 | 依 M 列状态补齐 C 列（**24 处**） |
| 排序 | **中文拼音序 + 英文分离**（`pypinyin`；`120日元` → `9-nine-*` → `FLOWERS 夏篇` → `G线上的魔王`…） |
| 标注 | 🟡 **黄底** = 数据本身无法识别；🟠 **橙底** = 数据正常但本地库未收录；⚪ 白底 = 干净 |

**结果**：源 1061 行 → 保留 **1047 行**；🟡 24 ｜ 🟠 435 ｜ ⚪ 588。表头 14 列，冻结 `C2`，带自动筛选。

> 判定口径（与用户确认过）：**「未知」只看数据本身是否可用**（无游戏名 / 名称无法识别 / 机型代号未知 / 多机型混填 / 机型是非代号数字），**不把「本地库未收录」算作未知** —— 后者另标橙底「待补」，以免 44% 的行都变黄、失去信号价值。

## 注意

- 抓取依赖源站页面结构；源站改版导致空数据时状态区会提示，另一源不受影响。
- 机地真实站内搜索走其签名 API（websign），仅能通过「无头浏览器」间接获取，属低频重资源能力。
- BannerHub 配置数据版权归其社区作者所有，本站仅聚合展示与跳转；**配置 JSON 下载直链指向 `raw.githubusercontent.com`，国内网络访问可能需要代理**。
- 源站为外站内容，本站仅聚合展示与跳转，版权归源站所有。

---

## 更新日志

> **版本记录分两层写，同一内容不写两遍**（v10.42 文档收敛，2026-09-28）：
>
> | 想看什么 | 去哪看 |
> |---|---|
> | **最近改了什么**（6 版摘要，30 秒读完） | 就是本节，往下翻 |
> | **某一版的完整说明**（改了什么 / 真实对照数据 / 踩过的坑 / 验证结果） | [`docs/versions/v10.N.md`](docs/versions/) |
> | **全部版本一览**（一行一版） | [`docs/versions/README.md`](docs/versions/README.md) |
>
> ⚠️ 更早 42 版（v10.1 → v10.51）的**摘要已从 README 收敛**：
> 它们和 `docs/versions/v10.N.md` 是同一批内容的两次书写，并存只会各自漂移。
> 需要旧摘要原本可走 `git show <sha>:README.md`，或本地归档 `_archived/README-v10.41-版本块全量.md`。

### ★ v10.76 增量（2026-10-14）—— 轮播限宽（桌面 559→**379px**）+ 点榜单**不再整页位移** + 卡片 9 个（3×3）

> **完整说明见 [v10.76](docs/versions/v10.76.md)**。

> 用户原话（附截图一张）：「**轮播图太大了，优化下 / 固定下榜单位置，目前点击年度榜会有页变化 /
> 轮播图下需要的是 9 个卡片，且可以稍微优化下大小以及展示内容（游戏名称，类型，大小）**」。
> 四个诉求口径已足够明确 ⇒ **本轮未用 `AskUserQuestion`**；生效的既定口径沿用 v10.75
> （档位 `recent/hot/month/year` · 权重 XD 50% + 机地 50% · 大小取本地库 `size` · 机地缺「最近更新」档）。<br>
> **① ★★★ 「点击年度榜会有页变化」不是一个样式 bug，是「高度成了自变量」。**
> 探针（`_probe-v1076-layout.js`，1440×1000 逐档点击）实测：`.stage-meta` 原文案宽 `recent` **158px**
> 能挤进标题行 ⇒ `.stage-h` **46px**、「最新收录」top **1258**；`hot/month/year` 文案 **485 / 592 / 585px**
> 挤不下 ⇒ 换第二行 ⇒ `.stage-h` **85px**、top **1297** ⇒ **整页下移 39px**。
> 根因：`flex:none` **既没定宽也没定高** ⇒ 宽度跟着文案走 ⇒ 长文案换行 ⇒ 撑高 ⇒ 推下所有东西。
> **修法三道缺一不可**：`flex:0 0 100%`（定**位置**）+ `height:24px`（定**行数**）+
> `#rankMeta{nowrap + ellipsis}`（定**行长**）；★ 只截**显示**不截**信息** ⇒ 状态行全文挂 `title`（D20c）。<br>
> **修后实测**：`.stage-h` 四档 **84 / 84 / 84 / 84** · 「最新收录」top **1367 ×4** · 轮播 top/h **168 / 379 ×4** ·
> `docH` **4110 ×4** · 切档 `scrollY` **全 0** · 四档头部实拍 **1196 × 84.39**。<br>
> **② ★★ 「轮播图太大」= 桌面 1196×559，而第一直觉「限高」直接踩中 v10.75 铁律 123**：
> `aspect-ratio` 与确定 `height` 并存时宽度会被 `height × ratio` **反算** ⇒ 限高 = **连宽度一起被压窄**。
> ⇒ **只有限宽一条路**：新增 `--car-max-w:810px` + `.rk-car{width:min(100%,var(--car-max-w));margin:0 auto 12px}`
> ⇒ 桌面 **810×379**（左右各留白 **193**，居中）、移动 390 视口**自动退化成撑满 350×164** ——
> **不需要写任何媒体查询**。★ 反过来判据也必须**分档**：第一版 P14 写「一律比内容区窄 40px」⇒
> 390 视口**必然假红**，那是**把拍板目标当成了全局等式**。<br>
> **③ 卡片 9 个**：`RANK_SHOW_N` 11 → **14**（轮播 5 + 卡片 3×3）、桌面 **3×3**、移动 **2×5**、
> `gap` 14 → **12px**、`.bd` 内边距收一档；信息行**仍是名称 + 类型 + 大小**（用户拍板三样，未动）。
> ★ 改完**必须重启** 8124（`data/**` 是启动时加载，探针先仍报 5/6，重启后才 5/9 —— 铁律 127）；
> ★ 骨架卡片数改走 `RK_CARD_N` 常量（原来是字面值）。<br>
> **④ ★★ 「一个值服务两个断点」是真缺陷，且是防线抓出来的。** `.rk-skel-card .sk-tx` 原是 JS 里的
> **内联字面值 66px**，而真卡 `.bd` 在移动端有自己的内边距 / 字号覆盖 ⇒ 实测
> **桌面 65.61px（对上）/ 移动 61px（差 5px）** ⇒ 移动端「骨架 → 真卡」跳一下。
> 修成 **CSS 类 + 两处断点（66 / 61）**；★★ 判据必须**跨层**（读主源文本里的字面值 vs 浏览器实测的 `.bd`，
> 差 ≤ 2px，按断点取第 1 / 第 2 个值）—— 只看源码**没有真卡**，只看渲染**没有骨架**。<br>
> **⑤ ★★ 三处「一侧源站挂了会拖住整个接口」的连锁修复**：**(a)** 降级结果被 **30 分钟 TTL 钉死**
> （连打三次 `refresh=1` 才恢复 `jidiN=12`）⇒ `cached()` 支持**函数 TTL**，降级 **120s** / 正常 **1800s**
> （★ 判据**必须**带 `RANK_JIDI_KEY[p]` —— `recent` 档本来就不抓机地、`jidiOk` **天然 false**）；
> **(b)** `getHtml` 是 `timeout 20s ×(1+1 重试)` ⇒ 最坏 **40s**，实测「点人气榜后 2.6s 状态行还停在上一档」
> ⇒ 机地侧加 `withTimeout(jidi.hotRanks(), 6000, '机地热榜')`；★★ `withTimeout` **必须给内层 promise
> 挂拒绝处理**（`p.then(ok, err)`）—— 否则 `allSettled` 拿到的是外层 race、内层 rejection 无人处理
> ⇒ **Node 22 崩进程**（D17 第一版只判 `p.then(` 的**形状** ⇒ 反证把两参换单参**照样匹配** = 假绿，
> 改判拒绝处理那一路才拦得住）；**(c)** 机地挂了而文案仍写「加权合并」= **声称一件没发生的事**
> ⇒ 前端记 `rankSrcOk[]` + 追加「**· ⚠️ 机地源暂不可用，本档已降级为 XD 单源**」（反证 ⑱ 删掉播报 ⇒ D21 红）。<br>
> **⑥ ★★ 机地上游被阿里云 WAF 拦住（本轮实测，与本次改动无关）**：`jidiyouxi.com` 的
> `/`、`/topic/`、`/topic/detail/*` 纯 HTTP **10 / 10** 返回 **23,670 字节** JS 挑战页（`aliyun_waf`，
> **无 `appState`**）；同一 URL 走真浏览器（CDP）**6.1s** 拿到 **1,393,311 字节**真实页且 `#appState` 存在
> ⇒ 机地**需要浏览器关口**。连带：`hotRanks()` 抛错 ⇒ `jidiOk=false / jidiN=0 / dualN=0` ⇒
> 「双源加权合并」**静默退化成单源**；`/api/detail/merged?url=<机地话题页>` 返回 **502**
> （`机地详情页未内嵌数据`）⇒ 机地游戏详情页**整页打不开**。
> ★ 本轮把它从「静默」变成「**可见**」（降级播报 + 6s 硬超时 + 降级短缓存），但**没有引入任何兜底**。<br>
> **⑦ ★★ 踩的坑 12 条**（含我自己埋的）：**B4 假红**（断言写成 `jidiKey ? jidi.hotRanks()`，
> 绑的是**紧邻形状**，被 `withTimeout` 包裹即不匹配 ⇒ 拆成语义两半并**分别**反证 ⑲⑳）·
> **P11 假红**（判据依赖「页面必须有『机地 #』」，而机地宕机时融合**本就**退化成仅 XD ⇒ 改**数据驱动**）·
> **P14 假红** · **D17 假绿** · 四张 `head-*.png` **尺寸对、内容全被吸顶顶栏盖住**
> （`elementHandle.screenshot()` 只把元素滚到「最近可视边缘」⇒ 改 `scrollTo(0,0)` +
> `page.screenshot({clip})`）· **A9b 假红**（下界 400 是 v10.75 定的，在新目标 379 下必然红 ⇒ 收到 320）·
> `test-home-fold` / `test-v1069-filter-fold` 阈值按「**拍板目标 + 余量**」重定（1350/1130/1140 · 1700/1490）·
> `/tmp` 在沙箱里落不了盘（node 侧看不到 MSYS 的 `/tmp` ⇒ 改用工作区内 `.ref/`）。<br>
> **⑧ 验证（全部实测）**：全量**两层**防线 **4714 通过 / 失败 2**，异常退出
> **`test-v1025-gallery.js` · `test-v1025-merge.js` · `test-v1025-search.js`**，
> 前置闸 **3 / 3**（**58 静态套 + 14 浏览器套**）；
> ★★ **失败 2 条 + 异常退出 3 套全部同源于机地 WAF** —— 取证是**直接调接口**：
> `GET /api/library?q=艾尔登` → `{"url":"https://jidiyouxi.com/topic/detail/3279789","source":"jidi"}`，
> `GET /api/detail/merged?url=<上>` → **502** ⇒ **四套联网套件（gallery / search / dlstrip / merge）
> 症状各不相同、病因同一个**（新增铁律 138）；**已逐套单跑复现、未改判据掩盖**。
> ★★ **同一份代码跑两次全量，异常退出的名单不一样**（第一次 `dlstrip + merge`，**4702 / 2**；
> 第二次 `gallery + merge + search`，**4714 / 2**），而**代码相关套件两次全绿、一次没变**
> —— **波动只落在「共用同一个上游」的那一组上，这本身就是结论**。
> `test-v1074-rank-carousel` **65/65** + 反证 **20/20**（新增 ⑲⑳）· `test-v1075-rank-source` **53/53**
> + 反证 **17/17** · 浏览器 `test-v1075-rank-cards` **40/40**（P1–P17 × 2 视口 + Q0–Q5 切档几何）·
> `test-v1074-carousel-live` **38/38** · `test-home-fold` **63/63** · `test-v1069-filter-fold` **55/55** ·
> `test-pages-sync` **54/54**（md5：`index 29d451f9…` / `emulator c9edeef5…` / `unpack 41fbac7d…` /
> `resources 53839c2d…` / `extract a0d935bd…`）· 文档闸 `test-doc-structure` **268/268**
> （版本号连续 **76 份**，索引 **76/76**，README 版本块 **6** 个）。<br>
> **⑨ 补铁律 130–138**（高度不许由文案长度决定 · `aspect-ratio` 下限宽不限高 ·
> 骨架高必须分断点且判据必须跨层 · **降级结果不许按正常 TTL 缓存** ·
> 一侧源站必须有硬超时且**被 race 的内层必须挂拒绝处理** · 降级必须**如实播报** ·
> 元素截图要 `scrollTo(0,0)` + `clip` · **判形状 ≠ 判语义**，且一条断言含两个子条件时**反证要分别打** ·
> ★★ **一批套件共用同一个上游样例 ⇒ 那是单点，会一起红；定性必须回到接口本身**）。<br>
> **⑩ ⚠️ 未做 / 未验证**：✅ **已提交 `87c0e65` · 已推送**（远端 HEAD == 本地）·
> ⬜ **未发布**（线上仍 **v10.73**；★ **发布授权不跨轮延续，需用户再确认**）；
> ★★ **机地 WAF 关口未拍板**（① 浏览器兜底 ② 换数据源 ③ 接受降级）·
> ★★ **本轮新发现但未修**：机地游戏详情页直接 **502**，而不是「退回 XD 孪生 / 库内条目」；
> `fetchers/xdrank.js` 去留未定（沿 v10.75）；一次性探针 `_probe-v1076-*.js` 与 v10.75 遗留 4 个未清理；
> 两个启动器（`.cmd` / `.ps1`）**仍然一次都没实跑过**（沙箱拦 `cmd.exe`，沿 v10.71 遗留）；
> 常驻 8123 仍是「新页面 + 旧接口」混合态（要一致**必须重启**）；前序遗留一律未动（门 1 MOD 补源 ·
> 门 2 byrutgame 合规 · `基础测试数据.xlsx` 缺失导致 phonecfg 停摆 · `--c-t3` 对比度 ·
> 幽灵子页 `/overview.html` · 名单页默认视图 · 四分组是否按游戏合并）。

### ★ v10.75 增量（2026-10-14）—— 榜单换源（XD `/update/` × 机地双源加权 RRF）+ 轮播/大图卡按「封面原图比例」显示（不裁不压）

> **完整说明见 [v10.75](docs/versions/v10.75.md)**。

> 用户原话：「**不行，再优化我要轮播图适配图片的高度 轮播图下的卡片优化，一行显示3个
> 放大适配游戏大图而不是压缩游戏图片，且显示内容游戏名+游戏标签+游戏大小即可，
> 且我认为需要优化榜单源**」。`AskUserQuestion` 两批 7 项，用户回答：
> ① 卡片 = **2 行 × 3 列 = 6 个**（轮播 5 + 卡片 6 = **11**）② 轮播 = **按原图比例自适应（约 560px）**
> ③ 档位 = **最近更新 / 人气 / 月度 / 年度** ④ 大小口径 = **本地库 `games.json` 的 `size`**
> ⑤ 「阅读」是笔误 ⇒ **月度排名** ⑥ 权重 = **XD 50% + 机地 50%**
> ⑦ 机地没有「最近更新」这种榜 ⇒ **该档仅 XD；其余三档双源合并**。<br>
> **① ★★ 换源把上一版的地基整个推翻。** v10.74 的补位设计（虚线框 + 「📚 库内」措辞）
> 建立在「XD 官网每档只有 10 条」上；新源 `/update/` 实测 **每档 100 条、SSR 直出、无 AJAX，
> 共 8 个 panel**（`recent/hot/month/quarter/year/good/rank/size`）⇒ 补位**降级为纯兜底**
> （没删，机地抓挂时仍要兜），`RANK_SHOW_N` 13 → **11**（轮播 5 + 3 列 × 2 行 = 6）。
> ★★ 新源带来一个「**同名字段、不同语义**」的坑：8 个 panel 里都有一个 `<time>`，含义各不相同 ——
> `recent` = **日期**（`2026-10-14`）、`hot/month/quarter/year` = 热度（`381,875 热度`）、
> `good` = 赞、`rank` = 分、`size` = 容量（`554 GB`）⇒ `readValue(txt)` 按**单位后缀**分流，
> 判据 **C4 是负向断言**：日期**不许**被认成 hot/like/score/size。<br>
> **② ★★★ 双源规模悬殊（100 vs 12）⇒ 朴素 RRF 会让小源塌陷**（本版技术含量最高的一节）。
> 第一版 `w/(K+rank)` 让机地 **7 / 11** 挤进前 11（机地「12 名」是**垫底**，XD「12 名」是**前 12%**）
> ⇒ 修法 = **名次相对位置对齐** `scaleRank(rank,n) = 1 + ((rank-1)/(n-1))*(N_REF-1)`（N_REF = 100），
> 复跑降到 **5 / 11**。★★★ **反证 ① 照出更细的问题：「结果形态」不能替代「算法语义」** ——
> 首次打坏点选的是 **A15（tie-break「XD 名次优先」）**，而真实链路里 tie-break 会**独立地**
> 改变这个形态数字（去掉对齐后机地**仍只有 5/11**）⇒ 反证**不成立**；真正该打的是
> **A2（榜尾对齐语义）**，改后立刻红（新增铁律 128）。
> ★ 双源识别桥 = 本地库 `jidiId` / `jidiUrl` 配对（覆盖 **68.9%**）+ 兜底中文名 `zhKey`；
> **本轮抓到 `zhKey` 一个真 bug：没剥书名号** ⇒ 库内 `全面战争：幕府将军2` 与来源
> `《全面战争：幕府将军2》完全版` 失配、白丢一张 460×215 大图（修：`replace(/[《》]/g,'')`，
> ★ **须在去括号之前**）。<br>
> **③ ★★ 「压缩图片」的真实根因不是 CSS 属性写法，而是「三种源图原始比例各不相同、
> 而展示位只有一个比例」。** 实测 Steam `store_item_assets/steam/apps/<id>/header.jpg` =
> **460 × 215（2.14）** · XD `uploads/allimg/*-L.jpg` = **128 × 128** ·
> 机地 `img2.52jidi.com/topic/cover/…/sz/src` = **140 × 140**（★「大图变体」**实测排除**：
> `/src` · `/big/src` · `/lg/src` · `/xl/src` · `/ori/src` **全部 404**）⇒ 方图塞进 16:9 展示位被
> `object-fit:cover` **上下裁掉近一半**；放进 4 列 244×152 的方框又被**放大 3 倍**（分辨率根本不够）。
> **实测原本 11 条里 4 条封面不达标**：2 条方图 + 2 条 Steam 图 **404**
> （`apps/5024270/header.jpg`、`apps/3998800/header.jpg`）。修法三层：
> **(a)** `coverScore(u)` 给封面打分（`steam/apps/<id>/header` = 4 · 同 app 其他 = 3 ·
> `community_assets/images/apps/` = 2 · 其他 = 1 · 空 = 0）；
> **(b)** 融合时**候选池按分排序取最高**（替代 v10.74 的固定优先级 `rec.cover || xd.cover || jidi.cover`）
> \+ **同名提优**（外层 `coverScore <= 1` 才触发、内层**严格更优** `>` 才替换，避免等分互换抖动）；
> **(c)** 前端**两级 `onerror`**（`this.src = this.dataset.alt` → 再失败则隐藏）。
> ⇒ **hot 档 11 / 11 全部 460×215、浏览器实测全部 load 成功**（`recent` 10/11、`month` 9/11
> 受限于**库内确实只有方图**，如实通过 `meta.coverBigN` / `coverSubN` 暴露短板，不粉饰）。<br>
> **④ ★★ 「放大大图」的第二个坑，只有守源码才拦得住。** `aspect-ratio` 与确定的 `height` 并存时，
> `width:auto` 由 `height × ratio` **反算**、而不是撑满父容器 —— 实测 390 视口三组：
> 只写 `aspect-ratio` → **350 × 164**（撑满）｜`aspect-ratio` + `height:132px` → **282 × 132**
> （宽被反算 ⇒ **v10.74 移动端轮播其实一直没撑满**）｜`height:200px` → **428 × 200**
> （**横向溢出**父容器 350）。★★ 更阴的是「390 视口下两组比例**恰好都 = 2.14**」⇒
> **「比例是否一致」类判据照不出来**，只有 D17b（移动端不许写死轮播高度）拦得住
> ⇒ 删掉 `@media(max-width:420px)` 里 v10.74 遗留的 `.rk-car{height:132px}`（新增铁律 123）。<br>
> **⑤ 卡片改造**：4 列 `gap:10px` → **3 列 `gap:14px`**（移动端 2 列，删掉 `≤420` 的定高遗留）、
> 结构改**上图下文**（`.rk-card` 转 `column`）、图区比例改 `--cover-ar`（= 460/215，与封面原比例一致）、
> **圆角上移到 `.rk-card`**（`--cd-r` + `overflow:hidden`，图通栏顶到卡片边，参考站就是这么做的）、
> 信息行**只留「游戏名 + 游戏标签 + 游戏大小」**（删评分 `.sc`、`.bdg`、热度与可玩副行）、
> 新增图区左上角**名次角标** `.th .no`（r1/r2/r3 三档配色）与右上角**双源徽标** `.th .du`（仅双源同榜显示）、
> 轮播副行由热度数字改为**两源名次**（`XD #n / 机地 #n`）+「双源上榜」；
> 骨架屏 `.rk-skel-card` 与 `rankSkeleton()` 改**同结构**（图区 `--cover-ar` + 文字区 64px，
> 不同步会让「加载完成那一瞬卡片高度跳一截」）。<br>
> **⑥ 服务端接线**：`RANK_META` 四档（label / src / tip）+ `RANK_JIDI_KEY`
> （`recent = null` ⇒ 该档**不抓机地**、自然退化成「仅 XD」、**不另写一条渲染路径**）+
> `RANK_ALIAS` 旧参数兼容（非法值落 `recent` 而不是 400，不打破已发出的直达链接）；
> 两源 **`Promise.allSettled` 并行**（不是串行 `await`，也不许 `all` 一挂全挂）；
> 两源都为空时**抛错**（不让前端拿到空榜当「正常」）。
> **实测四档**（★ 接口参数是 `?p=`、**不是** `?period=` —— 我第一版探针就写错，两端口都**静默落回默认档**）：
> `recent` list 11 / xdN 100 / jidiN 0 / coverBigN 10 · `hot` list 11 / xdN **99** / jidiN 12 /
> dualN 3 / dropped **1** / coverBigN **11** / coverSubN 2 · `month` list 11 / coverBigN 9 ·
> `year` list 11 / coverBigN 11（`hot` 那 1 条 dropped = 源站混进来的
> 「**XDGAME游戏运行库检测工具**」，被收进**单一真源**的 `TOOL_RE` 在融合入口过滤掉）。<br>
> **⑦ ★★ 踩的坑 18 条，其中好几条是我自己埋的**：`byZh is not defined` 导致**四档接口全 502**
> （`buildIndex` 解构漏了 `byZh`）· `coverBigN` **口径错位**（`coverBig 94/11`：分子用候选池、
> 分母用展示条数）· **A7 参数化后退化成假绿**（`every` 在**单元素数组上恒真**，新增铁律 124）·
> **D17b 假红**（判源码**被自己的注释咬中** —— 本套件 C 段早记过这条，我写新断言时**又踩一次**，
> 新增铁律 126）· 编辑留下**重复的 B2 断言行**（旧的那条恒红）· B2 取段正则**过早截断**
> （靠无缩进的 `});` 当锚，实测只取到 2535 字符 ⇒ 改用「**下一个顶层 `\napp.` 前**」）·
> D13 判据**过宽**（`!/热度/` 咬到了 title 提示里的「（本地库热度补位）」⇒ **锚点别用子串**）·
> 反证套件基线正则**缺 `m` 标志**（`^…$` 只匹配整段输出 ⇒ 永远不中 ⇒ 误判「基线不是全绿」，
> 统一改成 `通过 n / m（失败 f）` 并用 `(?:^|\n)…(?:\n|$)` 取）·
> **反证 ①④⑧ 不充分**（④ 测试数据两源同名 ⇒ 被「中文名兜底桥」救活 ⇒ 把机地侧标题改成
> 「赛博朋克2077：终极版」堵掉兜底；⑧ 必须**两道护栏一起放宽**才造得出危害）·
> `check-card-rules` 误报（`.rk-card .th .no` 因名字含 `.th ` 被 **IMGSLOT 子串匹配**当成图片槽
> ⇒ 加 `IMGSLOT_DESC` 排除后代 + 三个新徽标登记 `RAD_EXCEPT`）· `test-covers` 1 条
> （`server.js` 不再调 `xdrank.mergeRankRows`，职责搬进 `rrfFuse` ⇒ 判据改成「**本地库被真的传进
> 唯一映射入口**」：`rankMerge.rrfFuse(xdRows, jidiRows, dbAll)`）· `test-v1030-cards` 2 条
> （`.rk-card .th` 从 16:9 规范**独立出去**、圆角上移到卡片层 ⇒ 移出共享循环、单开一节：
> 正向守 `--cover-ar` + **反向断言不许回到 16:9** + **反向断言 `.th` 不许自带圆角**（双层会露白缝））·
> ★★ **我的临时还原路径失效**（`cp … /tmp/x 2>/dev/null \|\| cp … .bak` —— 前者成功 ⇒ **没建 `.bak`**
> ⇒ 还原命令找不到文件，`rank-merge.js` 停在打坏态 **46/48**；从 `/tmp` 还原并复验 48/48
> ⇒ **「还原」这一步本身也要有判据**）· ★★ **常驻端口纪律**：`server.js` 是**启动时加载**
> （只有 `public/*.html` 按请求读盘）⇒ 未重启的 8123 跑的是**旧逻辑**且几何整体偏移
> （实测同名接口 top **1768 vs 1501**），**判据 = 回包里有没有新字段**（`meta.coverBigN`）、
> 而不是有没有 200（新增铁律 127）。<br>
> **⑧ 验证（全部实测）**：全量**两层**防线 **4722 通过 / 失败 0**、异常退出「**无**」、
> 前置闸 **3 / 3**（**58 静态套 + 14 浏览器套**）；其中静态层 **4226 / 0**（v10.74 为 55 套 / 4045）；
> 新增 `test-v1075-rank-source` **48 / 48**（A 名次对齐/RRF/桥接/工具过滤/zhKey · B 封面质量 ·
> C `readValue`/`upgradeCover`/PANELS · D 服务端接线）+ 反证 **13 / 13** +
> 浏览器 `test-v1075-rank-cards` **26 / 26**（P1 阳性对照 · P2 图全加载成功 · P3 原图比例 == 展示框比例 ·
> P4 原图 ≈460×215 · P5 列数 · P6 行数 · P7 信息行只有 tag+sz · P8 角标连续 · P9 卡宽 ≥150px ·
> P10 轮播图文一致 · P11 两源名次无热度 · P12 双源徽标 · P13 无横向溢出）；
> 改造 `test-v1074-rank-carousel` **61 / 61**（反证 **14 / 14**）·
> `test-v1074-carousel-live`（浏览器**真交互**）**38 / 38** · `test-home-fold` **63 / 63** ·
> `test-v1069-filter-fold` **55 / 55** · `test-v1030-cards` **90 → 95 / 95** · `test-covers` **49 / 49** ·
> `check-card-rules` ✅；五页同源 `test-pages-sync` **54 / 54**
> （md5：`index 028a60a7…` / `emulator 17aae28b…` / `unpack 854c8d0f…` / `resources f1d5b868…` /
> `extract 072ac55f…`）；文档闸 `test-doc-structure` **265 / 265**（版本号连续至 **v10.75**，**75 份**）·
> `test-report` **126 / 126**（记忆 **2985** 字 ≤ 3000）。
> ★★ **批次第一次跑出「失败 0」但带 1 套异常退出**（`test-v1074-carousel-live.js` exit 2）——
> 按铁律 122 单跑复现，确认**不是抖动而是真漏改**（见 ⑦ 坑 19：改 `data-p` 枚举值却漏了
> **只在浏览器层跑的**那一套，旧选择器让 puppeteer 直接抛错）；修完重跑 ⇒ 异常退出「无」。
> ⇒ **「失败 0」≠「全绿」**：异常退出的那一套根本没跑完，断言一条都没进统计。<br>
> **⑨ 新增铁律 123–129**：**123** ★★ `aspect-ratio` + 确定 `height` 并存时宽度被**反算**（不撑满），
> 且父容器比例恰好相同时「比例一致」类判据**照不出来** ⇒ 只能**守源码** ·
> **124** ★★ `every` 在**单元素/空数组上恒真** ⇒ 「每条都满足」的断言必须先钉**样本量下限** ·
> **125** ★★ **反证不充分有两种病因**（① 锚点选歪 —— 被测语义对这次破坏免疫；② 锚点太宽 —— 子串吃掉别的实现），
> 症状一样、修法完全不同 ·
> **126** ★★ **判源码字符串必须先剥注释**（同一坑在同一套件里踩了第二次），同族：**锚点判断别用子串** ·
> **127** ★★ **常驻端口跑的是「启动时的代码」** ⇒ 改完 `server.js`/`data/**` **必须重启**；
> 判据是「**回包里有没有新字段**」而不是「有没有 200」 ·
> **128** ★★ **「结果形态」不能替代「算法语义」**（tie-break 会独立改变形态数字，
> 所以断言要落在语义上，形态数字只当辅助观测）·
> **129** ★★★ **改主源的选择器/枚举值必须 `grep` 全部 `tools/test-*.js`** ——
> 这类漏改**静态层覆盖为零**，且症状是**异常退出**而非断言红 ⇒ 收尾必须同时看「异常退出：无」。<br>
> **⑩ ⚠️ 未做 / 未验证**：**未提交 / 未推送 / 未发布**（线上仍 **v10.73**；★ **发布授权不跨轮延续**）；
> `fetchers/xdrank.js` **去留未定**（`rawHot` / `mergeRankRows` 已无 server 引用，
> `coverOf` 仍被 `xdupdate` 用，未擅自删除，等拍板）；
> 4 个一次性探针 `tools/_probe-v1075-*.js` **未进 SUITES、也未清理**（结论已固化进正式套件与本文件，留给用户拍板）；
> `recent` / `month` 两档 `coverBigN` 仍是 10/11 与 9/11 —— 因为**库内确实只有方图**（不是代码问题），
> 要真的补上得**给本地库补大图**（未做）；两个启动器（`.cmd` / `.ps1`）**仍然一次都没实跑过**
> （沙箱拦 `cmd.exe`，沿 v10.71 遗留）；前序遗留一律未动（门 1 MOD 补源 · 门 2 byrutgame 合规 ·
> `基础测试数据.xlsx` 缺失 · `--c-t3` 对比度 · 幽灵子页 · 名单页默认视图 · 四分组是否按游戏合并）。

### ★ v10.74 增量（2026-10-14）—— 首页榜单：前 5 名改轮播图 + #6-13 走 4 列 × 2 行卡片（共 13 个），尾部由本地库热度补位

> **完整说明见 [v10.74](docs/versions/v10.74.md)**。

> 用户原话：「**首页的榜单优化下前五做成轮播图，后面的五个一行一共两行，一共显示13个游戏
> （轮播图5个+8个卡片 两行）卡片我需要放大一点**」。
> ★★ **原话内部自相矛盾**：「后面的五个一行一共两行」= **15** 个，而括号里写的是
> 「**13 个（轮播图5个+8个卡片）**」。**不猜，当面问** —— `AskUserQuestion` 两批 4 项，用户回答：
> ① 布局 = **13 个（轮播 5 + 2 行 × 4）** ② 轮播 = **自动播放 + 可手动切**
> ③ 源站不够时 = **用本地库热度补满 13 个**（明确**没有**选「有多少显多少」）
> ④ 尺寸 = **中等（约 200px 高）**。⇒ 「13」是**拍板值**，不是从原话推出来的。<br>
> **① ★★ 本版的地基是一个实测出来的数据源硬约束。**
> XD 官网 `.hot-soft .plate-list` 三档 **`li` 总数实测都是 10**（cheerio 直接数：周/月/全站 10/10/10，
> 全站榜剔掉「XDGAME游戏运行库检测工具」⇒ **只剩 9**）；机地 `hotRanks()` 上限也是 **12**
> ⇒ **凑不满 13 个**。★ 并**实测排除**了「源站还有更多可拿」这条路：`/rank/` · `/top/` · `/hot/` ·
> `/paihang/` · `/rank.html` · `/hot.html` **全部 404**（XD 官网没有独立排行榜页）
> ⇒ 补位是**唯一**的路，不是偷懒。<br>
> **② ★★ 补位必须「可区分」——这是本版真正的设计难点。** 实测榜单条目本身**几乎没有热度值**
> （周 **0/10** · 月 **1/10** · 全站 **3/9**：源站榜行不带热度，库里对应条目也大多没有 `hot`），
> 而补位池最高 `hot` 高达 **348,068**（剑星）。⇒ 补位条目若**照常**显示「🔥 34.8 万 热度」，
> 它会**比第 1–10 名还显眼**，用户看到的观感是「**榜单从第 11 名起才变真**」。
> 两道可区分标记：① `.rk-card.libsrc`（虚线边框 + 浅底）② 措辞换「📚 库内 x」而不是「🔥 x 热度」
> —— **卡片与轮播两处都要换**。★ 池子质量实测：`hot > 0` 的 **9,869 条全部有封面**（9869 / 9869）
> ⇒ 要求 `cover` **不牺牲条数**，仍然要求 —— 首页展示位出现首字色块卡的代价更大。<br>
> **③ 实现四段。** 新建 `data/rank-fill.js`（**纯函数**，放 `data/` 便于离线回归）。
> ★★ **去重必须同时按 `url` 与 `title`**：只按 `url` 会被「**同款不同 url**」
> （同一款在机地是 topic 页、在 XD 是游戏页）漏过去 ⇒ 首页**同一款占两个位**。
> `server.js` 的 `/api/rank` 接上 `fillRank` 并如实下发 `meta{srcN,filled,showN,carN}`
> —— 前端靠它说明「含几条库内补位」；机地档写死的 `slice(0, 12)` 改成常量 `RANK_SHOW_N`
> （原来「12」与「首页展示数」是**两个各自写死的数**，改一个忘一个就静默少一条）。
> ★★ **顺序**：先 `map` 出源站条目、**再整体补位**（先 slice 再补会补在错的位置）。
> `fetchers/xdrank.js` 拿掉那个写死的 `slice(0, 10)` —— ★ 实测源站每档**就 10 行**
> ⇒ 那个 `10` **从来没生效过**，却会**悄悄砍掉源站未来多出来的条目**；
> 截断职责上移到展示层（`slice(0, target)`），**fetcher 忠实返回源站给的全部**，
> `max` 保留成**可选**护栏。`public/index.html` + 四张派生页：删 `.rk-champ` 全段 ⇒
> 新增 `.rk-car`（200px / `.slide.cur` / `.shade` / `.arw` / `.dots`）；
> `.rk-grid` 5 列 → **4 列**（「卡片放大」的主要来源就是列数变少）；
> 卡片放大 `.th` **42 → 72px** · `.t` **12 → 13.5px** · padding `5px 9px → 9px 12px`；
> 移动端横滑单行 → **2 列网格** + 轮播降到 132px；JS 删 `champHtml`，
> 新增 `rkSlideHtml` / `rkCarouselHtml` / `rkCarMount` / `rkCarStop` / `rkCarGo` / `rkCarPlay` + `RK_CAR_MS = 5000`。<br>
> **④ ★★ 三条必须写进注释的设计约束。**
> **(a)** `.on` 在本项目是 `rankMark()` 给「当前打开的详情」加的**通用激活类**，
> 而 slide **也带 `data-url`** ⇒ 若轮播可见性也用 `.on`，**打开任意详情会把所有 slide 一起点亮**
> （它们都靠这个类控制 `opacity`）⇒ 一律用 **`.cur`**（CSS 与 JS 两处）。
> **(b)** ★★ **定时器纪律：任何重渲之前先 `rkCarStop()`** —— 切档会整体重渲 `#rankList`，
> 旧 `interval` 若不停，会继续操作**已被替换掉**的 DOM，用户感知是「**手动点一次却跳了两格**」。
> 落点覆盖**所有**会换掉内容的出口（`paintRank` 开头 / `refreshRank` 开头 / 骨架与错误块分支），
> 判据用**位置断言**（`rkCarStop()` 必须在 `el.innerHTML` **之前**）而不是裸子串。
> **(c)** 轮播 DOM **必须由 JS 现创建** —— `page-assets.scriptForSubpage()` 会把主源脚本**整段抽走**，
> 而 `#rankStage` 只在首页存在 ⇒ 静态写在 HTML 里的容器在派生页会变**孤儿**（同 v10.73 浮层那条）。<br>
> **⑤ ★★ 首屏口径必须跟着改，否则会得出方向完全相反的结论**（本版实测撞到**两次**）。
> `test-home-fold.js` 的「首屏内完整可见的**列表**条数」与 `test-v1069-filter-fold.js` 的 `F2`
> 在本版实测 **0 条**、`F3` 首卡 top = **862 > 844** —— 而首屏其实**装着 13 个游戏**
> （轮播 1 + 榜单卡片 8 + 列表 4）。**这不是回归**：v10.74 把榜单从「榜首卡 + 5 列单行」改成
> 「轮播 5 + 2×4 卡片」共 13 个，hero 由 ~200px 回到 ~424px，**首屏被榜单占满**，列表本该在第二屏。
> 继续用旧口径守，会逼着人把榜单再压回去 —— 与本版拍板目标直接冲突。
> ⇒ 新口径 =「首屏内完整可见的**游戏条目**数」（= 轮播当前张 + 榜单卡片 + 列表行），
> 它比旧口径**更严**；`F3` 降级为**退化护栏**。★ 阈值仍按「**拍板目标 + 余量**」定，
> **不照抄实测值**（否则任何一次正常微调都红，防线变噪音）。<br>
> **⑥ ★ 顺手修两处既有缺陷（同屏所以一起修）。**
> (a) `≤880` 档**顶栏横向溢出 11px**（文档宽 831 vs 视口 820）—— 一次性探针列出「越过视口右边界」的
> 元素，元凶是 `button#searchOpen.top-search`（`min-width:228px` + `flex:none`）；
> ★ **责任归属用 `git worktree` 起 HEAD 版服务在 8125 实测**（**不碰常驻 8123**）：
> 旧版**同样 831 / 同一元素** ⇒ **既有问题**，与本轮无关（以前没人发现，因为浏览器层长期是「未跑」状态）。
> 修法沿用 ≤760 档既有语言（`min-width:0` + 隐藏 `.kbd`），实测 doc **831 → 812** ✅。
> (b) `📱 可玩 N` 的内联色 `#FFD9C2` 是给 v10.68 之前的**深蓝 hero 底**写的，而榜单卡早已改白底
> ⇒ 白底上**几乎看不见**（实测对比度 ≈ **1.2 : 1**）⇒ 改用与「热度」胶囊同源的 `#C2410C`。<br>
> **⑦ ★★★ 反证照出 1 条假绿（本版最有价值的一节）。**
> `tools/test-v1074-rank-carousel-counterproof.js` 13 个打坏点、每个都要求**精确到断言**变红，
> 首轮 **12 / 13** —— 唯一没变的正好是**设计上最该守住的那条**：
> 打坏点 ④「补位条目照常显示 🔥 x 热度」后，套件仍报 **57 / 57 全绿**。
> 根因：`D13` 的判据写成「那个三元表达式在**整份文件**里出现过」，而**轮播 `rkSlideHtml` 里也有一份**
> （写成 `… + hot + ' 热度'`，**前缀完全相同**）⇒ 把**卡片侧**打坏后，判据仍被轮播那一份满足。
> 修法 = **收窄到目标段**（从 `rankCard` / `rkSlideHtml` **各自的函数体**里取段，**两侧都必须有**），
> 再补 `D13a` **阳性对照**（两段都取到、且**不是同一段**）防「收窄」本身失效 ⇒ 复跑 **13 / 13**
> + 还原后复跑 **58 / 58**（`✅ 还原干净`）。
> ★ 同族：**作用域太宽既会假绿（本条）也会假红**（别的函数把判据撑成命中）。
> 另两条纪律坑：★★ **多行锚点必须容忍 CRLF** —— `public/*.html` 是全 CRLF（实测 7951 个 CRLF / 7951 个 LF），
> 反证用 `\n` 写多行锚点时**一条都不会命中**（本轮被「靶子存在性预检」拦住了一次 ⑩）；
> ★★ **反证不许在浏览器层全量跑的时候跑** —— 它会改 `public/index.html`，
> 而 8123 常驻服务是**按请求现读磁盘**的 ⇒ 浏览器套件会加载到被故意打坏的页面。
> 这比铁律 113（不许与其他反证并发）**更宽**：反证是「改仓库的**排他**操作」。<br>
> **⑧ 验证（全部实测）。** 几何三档：**桌面 1440×1000** hero 424 / 轮播 **200** / 卡片 61×292 **×8** /
> 列表首条 top 750 / 首屏可见**游戏条目 13**；**平板 820×900** 461 / 200 / 61×185 ×8 / 830 / **10**；
> **移动 390×844** 544 / **132** / 54×171 ×8 / 862 / **9**（对照：改动前桌面 `heroMax 240`、
> 榜首卡 `champMax 80`、首屏可见列表 `foldMin 5`）。`/api/rank` 四档**现测**：
> week / month / year 均 **13 条**（srcN **10 / 10 / 9**、filled **3 / 3 / 4**、dropped 0 / 0 / 1），
> 补位条目为真实数据（剑星 348,068 · 赛博朋克2077 238,529 · 生化危机9 212,877 ·
> 极限竞速：地平线 6 184,111）；community **13 条**（srcN **12** / filled 1）
> ⇒ 上游已从上一轮的 `HTTP 544` 恢复，顺带验证了「12 上限改常量」那处。
> 新套件 `test-v1074-rank-carousel` **58 / 58** · `test-v1074-carousel-live`（浏览器**真交互**）**36 / 36** ·
> 反证 **13 / 13**；连带改造 `test-home-fold` **54 / 54** · `test-v1069-filter-fold` **55 / 55** ·
> `test-v1070-home-layout` **46 / 46** · `test-date-norm` **49 / 49** ·
> `test-v1030-cards` **90 / 90** · `test-covers` **49 / 49**；
> 覆盖性守卫 **77 个 `test-*.js`**（SUITES 57 · BROWSER 13 · COUNTERPROOF 6 · SHIM 1）；五页 md5 全部变动
> （`index d2714f83…` / `emulator 951d589f…` / `unpack 73a59aed…` / `resources 72ec6336…` / `extract a0a544ca…`）。
> ★★ **批次里的 3 套「异常退出」逐一查清**：只有 `test-v1069-filter-fold` 是**真**的（本版口径连带，已修）；
> `test-v1025-rail` 与 `test-v1025-gallery` 在**单跑**与**旧版 8125** 上均 **21 / 21**
> ⇒ **批次 / 上游抖动，不是回归**。
> ★ 判「两个定时器并存」的手法：**不数 `setInterval` 个数**（它们藏在主源内联脚本的模块级 `let` 里，
> 外部拿不到），而是**量相邻两次切张的间隔** —— 单定时器恒 ≈5000ms，两个推手同时推会被挤成 ≈2500ms；
> 判据取「全部间隔 ≥ 4000ms」，实测 **4998ms** 与切档后 **5000ms**。★ 计时前**必须把鼠标移出轮播**
> （悬停会 `rkCarStop`，把间隔拉长 ⇒ 判据**假绿**）；★★ 观察器还要过滤「同一次任务内先摘后加」的中间态
> （`forEach(toggle)` 会留下一瞬 **0 张**带 `cur` ⇒ 「每个变异都恰好 1 张」会**假红**；
> 且 `findIndex` 在中间态返回 -1，照单全收会把**一次切换记成两个时刻**、间隔 ~0ms ⇒ 判据**永远红**）。<br>
> **⑨ 新增铁律 119–122**：**119** ★★ 同一段文案在两处实现 ⇒ 判据**必须分段断言**（作用域太宽既假绿也假红）·
> **120** ★★ 判「有几个推手」不要数定时器个数，**去量周期**（前提：先把干扰源移开）·
> **121** ★★ MutationObserver 会报出「同一次任务内的中间态」，那不是用户看得到的状态 ·
> **122** ★★ 浏览器层批次里的红**必须单跑复现再定性**（先单跑 → 再回退 HEAD → 最后才敢说「回归」）。<br>
> **⑩ ⚠️ 未做 / 未验证**：**未提交 / 未推送 / 未发布**（线上仍 **v10.73**；★ **发布授权不跨轮延续**）；
> 一次性探针 `tools/_probe-v1074-geom.js` **未进 SUITES、也未清理**（留给用户拍板）；
> 两个启动器（`.cmd` / `.ps1`）**仍然一次都没实跑过**（沙箱拦 `cmd.exe`，沿 v10.71 遗留）；
> 前序遗留一律未动（门 1 MOD 补源 · 门 2 byrutgame 合规 · `基础测试数据.xlsx` 缺失 · `--c-t3` 对比度 ·
> 幽灵子页 · 名单页默认视图 · 四分组是否按游戏合并）。

### ★ v10.73 增量（2026-10-14）—— 一个按钮走完「下载 + 自动解压」：产物落进 `游戏名_类别_原链名` 文件夹，解压助手留档到磁盘

> **完整说明见 [v10.73](docs/versions/v10.73.md)**。

> 用户原话：「**可以，但是我需要优化下，不要解压按钮（默认到下载中），其次解压助手保留日志以及路径，
> 还有如果是解压了则生成一个文件夹（游戏名+本体/mod/存档/修改器+原链名）**」；
> 前置动作（用户先提的）：「**先核查功能，然后再给我看看如果下载的流程图**」——
> 已先交付 5 层功能核查 + 2 张流程图，用户看过才给的上面三条。
> 两批共 6 项询问，用户**全部选「推荐」**：① 不是压缩包 → **照存原文件** ② 内层包 → **同文件夹内就地展开**
> ③ 落点 → **`Downloads\GameHub` 下** ④ 命名 → **`游戏名_类别_原链名`**（原链名**去扩展名**）
> ⑤ 原浏览器原生下载出口 → **不保留**（本机只有服务端这一条） ⑥ 5 步计划 → **照此执行**。<br>
> **① ★ 本版真正难的不是「加功能」，是语义反转。** v10.72 的 `expectArchive`（不是压缩包就中止、
> 一个字节都不落盘）是配着**并列的第二个按钮**（「🗜️ 解压」）设计的 —— 点错了没关系。
> 本版只剩一个按钮、它就是「下载」本身 ⇒ 再丢弃就等于「**点了没结果**」，比 v10.72 更糟。
> 改成：是压缩包就解 / **不是就照存**（新终态 `saved`，进度 100%）/ **只有 HTML 网页仍然丢弃**
> —— 存一个 146B 的错误页进用户目录是**纯垃圾**，不是「他想要的文件」，这条留成唯一例外并由 E5 守着。<br>
> **`saved` 与 `error` 必须分开**：报成 error 会让浮层飘红，用户以为没下到、转头去点网盘 —— 白折腾一趟。<br>
> **② ★★ 新引入的攻击面（v10.72 压根没有这个口子）。** 文件夹名掺了**外部数据**
> （前两段来自源站标题、第三段来自 URL，全在别人手里），一个叫 `..\..\..\Windows` 的游戏名
> 就能让解压写到落点**之外**。两道闸：`sanitizeSeg`（去控制字符 / `\/:*?"<>|`→`_` / 抹 `\.{2,}` /
> 去首尾点空格 / 限长 / **对象段当空**，否则会拼出 `[object Object]`）+ `taskDir` **二次边界校验**。
> ★★ 边界判据**必须带 `path.sep`** —— 写成 `startsWith(root)` 的话兄弟目录 `…\GameHub-evil`
> 会被 `…\GameHub` 前缀骗过（分离比较的经典写错法），防线 `T5` 盯这条。
> **14 个恶意样本零逃逸**（上跳 / 正反斜杠混用 / 盘符绝对路径 / UNC / 空字节 / 通配非法字符 /
> 保留设备名 / 尾部点空格 / `../` 重复 60 次 / 纯点点），且 `rejected === 0`。<br>
> **③ 历史留档（用户要的「保留日志以及路径」）。** 落 `Downloads\GameHub\_下载历史.json`
> —— `EX_TASKS` 是**内存态**（只留 24 个、重启即丢），而用户恰恰是**重启之后**才想起来找「解到哪了」。
> 文件名 `_` 前缀 + `.json` 双保险（`scanDir` 只认魔数，JSON 不会被当压缩包收进去）。
> ★ **按 `id` 覆盖不追加**：任务可能跑两趟（填密码续跑），追加会让同一次在历史里出现两条、
> 前一条永远停在「待密码」看着像失败。★★ `exHistoryPush(t)` 放 `exRun` 的 **`finally`**
> —— 保证**没有一条出口能绕过它**（散在分支上加迟早漏掉新加的那条）。
> `GET /api/extract/history` **倒序**返回（这个列表是给人「找刚才那次」用的，不是给机器读的）。<br>
> **④ 页面改动。** `exdBtn(url,name)` → **`exdAttr(url,game,cat)`**：返回**属性串**而不是整个按钮，
> 于是属性挂在**已有**的 `<a class="pri">⬇ 直接下载</a>` **本体**上、**不新造按钮**（视觉一行没动）；
> 非本机返回空串 ⇒ 线上仍是浏览器原生下载。★ **文件夹第 1 段用 `x.game`（纯游戏名，
> 实测「赛博朋克2077」），不用 `svfTitle(x)`** —— 后者是**存档条目名**，会拼出
> `…报仇存档_存档_ALI213-…`（类别重复 + 带运营后缀），**这是实拍照出来的**（属性值一眼不对），不是推理。
> 解压助手页加 `#exGame`/`#exCat`（+类别 datalist）、`#exHist` 历史区，每条都带「复制路径」「打开文件夹」。<br>
> **⑤ ★★ 抓出两条真 bug（都是实测/反证照出来的，读代码看不出来）。**
> **(a)** `downloadTo` 一进门就 `mkdirSync` ⇒ **网页地址也留下空目录**
> （真目录里那个 `测试网盘页_存档_VP0_…`），「一个字节都不落盘」的承诺被打脸 ⇒ 改成**落盘前一行**才建，
> 防线 `T6` 用**位置断言**（不是裸子串 —— 裸子串拦不住「挪回开头但代码还在」）。
> **(b)** ★★★ **Windows 保留设备名逃逸被下游的「收口」抹掉**：`sanitizeSeg('con') === '_con'` ✓
> 但 `taskFolderName` 紧接着的 `replace(/^_+|_+$/g,'')` **把前缀又抹掉了** ⇒
> `taskFolderName({game:'con'}) === 'con'`，**目录名还是保留设备名，Windows 上建不出来**
> —— 实测 6 个设备名（`con`/`aux`/`nul`/`com1`/`lpt9`/`prn`）**全部中招**。
> ⇒ 逃逸挪到 `taskFolderName` 里对**最终目录名**做一次（这也更符合语义：Windows 看的是**整个目录名**，
> 中间段叫 `con` 完全没问题，`G_con_x` 是合法目录）。<br>
> **⑥ ★★★ 反证照出 4 条假绿 + 1 个真 bug（本版最有价值的一节）。**
> `test-v1073-download-counterproof.js` 12 个打坏点、每个都要求**精确到断言名**变红，首轮 **8/12**；
> 那 4 条**不是反证写错**，是**断言写歪**：**②** `E1` 只判「没爬出去」，而清洗被放宽后越界样本
> 被 **`taskDir` 兜底拒绝** ⇒ 被算成「安全」（这条要证明的是「**清洗层自己**扛得住」）⇒ 加 `rejected === 0`；
> **⑨** `V10` 用裸子串 `dir: t.dir || t.params.dir`，而**历史记录里也有一份**（`|| ''` 那一支）
> ⇒ 删掉 snapshot 那行仍能匹配 ⇒ 收窄到行锚 + 唯一后缀 `|| null,`；
> **⑩** `N3` 三个样本的段**本来就被 `.filter(Boolean)` 挡掉**，收口删掉也全绿 ⇒ 补 `N3b`/`N3c`；
> **⑪** `N4` 拿的是 `con_本体_aux`（**整名不是保留名**，逃逸有没有被抹掉都一样）⇒
> 补 `N4b` 判**单段**，**这一步直接指向 ⑤(b) 那个真 bug**。
> 二轮 **12/12 全绿 + 还原后复跑 54/54**。
> ★ 另一侧的连带：`test-v1072-download-counterproof.js` 的 **①②⑤⑥⑦ 五个锚点**随语义升级失效
> （`exdBtn`→`exdAttr`、`.exd-go`→`.exd-path`、bail 文案改了、`expectArchive` 删除），
> **被它自己的「靶子存在性预检」直接拦住**（这个预检就是专为「反证静默失效」设的）—— 改完 **10/10**。<br>
> **⑦ 验证（全部实测）**：全量静态防线 **56 套 · 通过 4104 / 失败 0 · 异常退出「无」· 前置闸 3/3**
> （v10.72 为 55 套 / 4045）· `test-v1072-download` **51/51**（原 47 条 → 51：7 条按新语义**改写**，
> 其中 `V7` 拆 4 条、`P11` 拆 2 条，**不是调松**）· 新 `test-v1073-download` **54/54** ·
> 反证 `v1073` **12/12** / `v1072` **10/10** · 端到端探针 **28/28** ·
> 浏览器实拍 **11/11**（`.exd-go = 0`；`a[data-ex-url]` **32** 个全可见；game/cat 正确）·
> 浏览器**真点击** **10/10**（浮层拉起 → 文件夹真建出来 → 历史记上 → **无 JS 报错**）·
> 连带复绿 `test-emulator-structure` **286/286**、`test-v1071-extract-e2e` **35/35**
> （GT 段两处调用点跟着新签名改 + D5 改成判**任务子目录**）。
> 真实落点实测：`C:\Users\komo\Downloads\GameHub\赛博朋克2077_存档_ALI213-2077-243487\`（8 个文件）
> 与 `_下载历史.json`（**14 条**，`done`/`not-archive`/`saved` **三种终态都在**）。<br>
> **⑧ 新增铁律 114–117**：**114** ★★★「靠下游兜底拒绝」会让**这一层**的断言假绿
> （凡「A 层 + B 层双保险」的代码，守 A 层的断言必须把「B 层替 A 层兜住了」算作失败）·
> **115** ★★ 负向守卫的判据不能是裸子串 —— **两个方向都会错**（注释里留着旧参数名 ⇒ 假红；
> 同名变量在别处也有一份 ⇒ 假绿）· **116** ★★★ 逃逸/兜底这类「加前缀」动作要放在**最终产物**上做，
> 守卫必须判**单段**那一档 · **117** ★★ 打真实目录的探针，样本名必须**一次性唯一**
> （否则「没有产生 X」的断言会被陈旧产物永久判红：复跑时那个 mtime `14:14` 的空目录就是这么变红的）。<br>
> **⑨ ⚠️ 未做 / 未验证**：**未提交 / 未推送 / 未发布**（线上仍 **v10.68**；★ **发布授权不跨轮延续**）；
> 浏览器实拍层 **12 套本轮未跑**（只用三支一次性探针做了定点实拍/真点击）；
> `tools/` 下 7 个一次性探针去留**待拍板**；本次实测在真实目录留下的 3 处产物**未删**（待人工决定）。

### ★ v10.72 增量（2026-10-14）—— 下载按钮 → 自动解压：服务端收满 512 字节先判种类，不是压缩包立刻止损（一个字节都不落盘）

> **完整说明见 [v10.72](docs/versions/v10.72.md)**。
>
> 起因（用户原话）：「**如果我想直接通过下载按钮的话怎么样自动解压**」；
> 补充（这句才是真需求）：「**我的意思是自动判断链接是否是压缩包，以及压缩包解压后是否还有压缩包，并再次解压**」。
> 三项询问：① 按钮形态——用户**没选选项**而是给了上面那句 ⇒ 核心是**服务端自动判定**；
> ② 覆盖范围 = **所有「有真地址」的按钮**；③ 落点目录 = **沿用 `Downloads\GameHub`**。
> ★ 我据 ① 定的方案：**新增并列按钮**（原「⬇ 直接下载」一个字不动，旁边另挂「🗜️ 解压」）——
> 改老按钮 = 零收益的高回归风险。
>
> **① ★★★ 先立事实：这个方案被实测推翻了一半（本版最重要的一节）**。
> 起当前代码的实例（**8125，不碰常驻 8123**）逐条只取前 512 字节探：
> **机地 10 款 → 1,089 条 `real`，域名分布 `pan.xunlei` 512 / `pan.quark` 239 / `pan.baidu` 233 /
> `nexusmods` 40 / `github` 19 / 其余站点页**；抽测 **30 条 ⇒ 压缩包 0 · HTML 30 · 其它 0 · 打不通 0**；
> **XD 10 款 77 条 `real` 全为 `null`、`needAuth` 全为 true**（按钮本就在页面上点不动）
> ⇒ ★★ **本体 / Mod 那条路走不通**：服务端拿到的是**网盘分享页**，**没有任何一条文件直链**，
> 按钮挂上去只会得到一屏 `not-archive`。
> **真直链只在两个模块**（抽 5 条实测）：存档 `data/saves-youxia.json` 的 `files[].direct` **1,987 条 → 5/5 是压缩包**（rar 4 + zip 1）；
> 修改器 `data/gtrainers.json` 的 `direct` **9,235 条**（`stats.withDirect` 源站自算 **9,235** / `directPct` **98.8**，301 跟随重定向后是包）**→ 5/5 是 ZIP**；
> `data/mods.json` 与 `data/phonecfg.json` 的 `direct` 均为 **0**。
> ★ 顺带纠一处**我上一轮记岔的**：GT 的字段名是 **`direct`**，不是 `links[0].url`。
> ★ **存档直链健康度**（前 30 条 HEAD）：**200 = 28 / 非 200 = 2**（死链率 **6.7%**），两条都是 `404` 且返回
> **HTML 错误页（约 146 B）** —— 这正是本版「**按内容判种类、不按状态码判**」的实证依据。
>
> **② ★★ 判定口径：`sniffBuffer(head)` 是唯一真源**。v10.71 已有 `sniff(file)`，本版要在**网络流**上做同一件事
> ⇒ ★★ **不写第二份魔数表**（两份必然漂移，且会以「落盘时认得出来、边下边判认不出来」这种**不报错**的方式出现）：
> 抽成**按字节流的纯函数**，`sniff(file)` 退化成它的「读前 512 字节」外壳；网络流侧再加一层
> **只做分类不做判定**的 `headKind(head)` → `archive`（带 `fmt`）/ `html`（`^\s*<(!doctype|html)`）/ `other`。
> `sniffBuffer` 内部**自己截断**（`head.toString('hex')` 会按原长度再生成一份字符串）。
>
> **③ 实现（三段）**。`data/extractor.js`：`downloadTo` 新增 `expectArchive`，**边收边判**——
> 头部累积到 512 字节即定种类，`html` ⇒ 止损，`other` 且 `expectArchive` ⇒ 止损，命中后**一个字节都不落盘**
> （`chunks` 只活在内存里）；落盘返回里加 `sniffed`（**用同一把尺子再判一次落盘结果**，顺带证明两条路一致）。
> ★★ 循环内**只 `break`、循环外统一返回**（见坑 ②）。`server.js`：任务对象加 `sniffed / notArchive / contentType` 三项并由 `exSnapshot` 带出；
> `/api/extract/download` 接上状态机（失败时 `state = not-archive | error`）；新增 **`POST /api/extract/open`**
> （插在兜底 404 **之前**）让用户直接打开解压目录 —— 两道护栏（路径必须落在 `DEFAULT_DEST` 内）+ `spawn` **180 ms error 窗口** + `stdio` 三项显式写全。
> `public/index.html`（主源）：样式块（`.exd-go` 两处尺寸覆盖 · `#exDock` z-index 150 · 移动断点）+
> JS 块（`exdLocal()` 仅本机判定 · `exdBtn/exdDock/exdStart/exdPoll` 等）+ 两处挂载（`if (f.direct)` 的存档行、`dlResRowsHtml` 的 `links[0].url`）。
> ★★ **`.exd-pw[hidden]{display:none}` 必须显式写** —— `.exd-pw` 自己给了 `display:flex`，**作者样式会顶掉 `hidden` 属性**。
> ★★ **浮层 DOM 由 JS 现建、事件委托挂 `document`** —— `page-assets.scriptForSubpage()` 把主源脚本**整段抽走**给派生页，
> 顶层若绑「主源有、派生页没有」的节点就 `addEventListener of null` ⇒ **整段脚本中断**（v10.71 坑 (b) 同族）。
>
> **④ ★★ 踩的坑（四条，两条是我自己埋的）**。**① `got <= 400`（v10.71 既有 bug，顺手修掉）**：
> 那道 HTML 早判写成 `if (got <= 400) {…}` —— 只要**首个 chunk 就大于 400 字节**，判定被**整个跳过**，
> HTML 中间页会**一路下完才暴露**；根因是**判据的作用域写窄了**（「累积到 400 再判」写成了「单次 `got` 不超 400 才判」），
> 修法是**跨 chunk 累积 `headBuf` 到 512 再判**；★ 当时**既有断言全绿**，因为**没有一条断言在喂「首 chunk > 400 字节」的响应**
> ⇒ 本版专门起了 **`/html-big`** 端点钉住它。
> **② ★★★ `abort` 在循环内调用会吞掉结论**：第一版在 `for await (r.body)` **循环内部** `ctl.abort()` 再 `return`
> ⇒ abort 让**正在被迭代的流**抛 `AbortError`、**异常比 `return` 先到外层 `catch`** ⇒ e2e 实测得到
> `state=error / error=This operation was aborted`，**`notArchive` 标记整个丢失**、前端只能显示「下载失败」；
> ⇒ 修法：**循环内只 `break`**，语义标签的**唯一出口是函数返回**。
> **③ 提前止损的判据只能来自服务器**：客户端主动 abort ⇒ 服务端 `res.writableFinished = false`，
> 防线用 `/html-slow` + `slowState.closedEarly` 断言（**实测 `closedEarly=true` / 服务器是否吐完 = false**）。
> **④ ★★ 顺手照出一个防线假绿 + 一个机制缺口**：`test-v1071-extract-counterproof.js` 本轮实测是
> **`❌ 反证失败 1 项`**，而上一轮全量报的是「**3995 / 0**」—— 根因是**取汇总正则没跟着产物格式改**
> （v10.71 把收尾统一成「通过 n/m（失败 f）」、**斜杠后是总数**，旧正则恒不匹配 ⇒ 「还原后**必须全绿**」那步判据**整个失效**）；
> ★★ 而 **`tools/run-all.js` 的 `COUNTERPROOF` 表只「校验」、从不「执行」** ⇒ **反证失败在全量防线里看不见**，
> 这条假红就这么活了整整一版 ⇒ 本版在 run-all 注释里**如实记下这个现状**并补进 PITFALLS。
> 另三条小坑：★ e2e「挑 `content-length` 最小」**必然选中 404 错误页**（146 B 全批最小）⇒ 改成先验 200 + 类型 + 1KB~8MB 并加**阳性对照**；
> ★ 探针里 `let games = p;` 引用未定义变量；★ **改了代码必须重启实例**（Node 不热重载，否则 e2e 在旧代码上跑出假红/假绿）。
>
> **⑤ 防线（新增 47 + 反证 10/10）**：新建 `tools/test-v1072-download.js` **47/47** ——
> **S1–S9 / H1–H3** 嗅探层（各魔数家族 · 纯文本不误判**配阳性对照** · 空/短流 · `headKind` 三分类）·
> **M0–M2** 单一真源（`sniff` 必须走 `sniffBuffer`）· **E1–E8c** 下载层（**自起本地 HTTP 服务器**：
> `/html-big` 打坑 ① · `/html-slow`+`closedEarly` 打坑 ③ · `/bin` 回归保护「不要求压缩包时**不能误拒**」·
> `/nope` 404 **不许冒充** `not-archive`）· **P1–P14** 页面结构 · **V1–V8** 服务端结构；
> ★ 三条判据**可能被注释骗**（铁律 104）⇒ 加固（`P2` 改「`createElement('div')` 后 160 字符内跟 `d.id='exDock'`」·
> `P3/P4` 加 `^\s*` 行首锚 · `V5` 加 `return res.status(400)` 前缀）。
> 新建 `tools/test-v1072-download-counterproof.js` **10/10**（十个打坏点各代表一族：**单源派生漏重建** ·
> 浮层 DOM 写回主源 · `[hidden]` 兜底被删 · **「仅本机」判断被放宽**（线上点了会解在云端容器里）·
> 按钮脱离「有真直链」前提 · **提前止损退化成「下完再说」** · `expectArchive` 失效 · 魔数判据 `startsWith`→`===` ·
> **`sniff` 不再走 `sniffBuffer`** · `open` 的目录护栏被注释掉）；纪律 = **靶子预检** + **精确断言名匹配** + `finally` 还原 + **还原后复跑全绿**
> （收尾实测 `通过 47 / 47（失败 0）` + `✅ 还原干净`）。派生页同步闸 `tools/test-pages-sync.js` **54/54**；
> 前序 v1071 反证修判据后 **87/87（失败 0）**。
> **全量静态防线：55 套 · 4045 / 0 失败**、异常退出「**无**」、前置闸 **3/3**（v10.71 为 54 套 / 3995）·
> 文档结构闸 **256/256**（含本版新增两条：版本索引行数 vs 日志文件数 **72/72**、README 版本摘要块 ≤6 实测 **6**）·
> 浏览器实拍 **12 套本轮未跑**（11 套含既有陈旧红），本版改动集中在**服务端判定 + 浮层结构**，已由 P/V 两段与 e2e 覆盖。
>
> **⑥ 端到端实测：16/16**（探针 `tools/_e2e-v1072-download.js`，自起 8125）。
> **A 真直链**：`…/ali213-Intermission Hard Mode-314633.rar` → `state=done · sniffed=rar ·
> contentType=application/x-rar-compressed · bytes 294,230 · layers 2 · files 2`，事件链
> `queued → downloading → downloaded(format=rar) → layer(d1,rar) → layer-ok(d1,produced 1) → layer(d2,zip) → layer-ok(d2,produced 1)`
> —— ★ **`layer(d2)` 的输入就是 `layer-ok(d1)` 的产出**，这就是用户说的「解压后还有压缩包、再次解压」在**真实直链上**跑通。
> **B 网盘页**：`state=not-archive · contentType=text/html · bytes 0` ⇒ **目录零变化**。
> **C** `open` 两道护栏均 **400**。**[0.5] 阳性对照**：存档直链 30 条 HEAD 200=28 / 非200=2。
> **[0] 判版**：`POST /api/extract/open {dir:"C:\\"}` → **400**「出于安全考虑，不允许对该目录操作」
> —— ★ 旧代码会是 **404**，**「400 ≠ 404」就是新代码生效的证据**（只比「有没有 200」在这里没用）。
>
> **⑦ ⬜ 未做 / 未验证（如实列出）**：★★ **按钮只挂上两类地址**（存档 1,987 / 修改器 9,235），
> **本体与 Mod 的 1,089 条全是网盘页** ⇒ 那条路走不通 —— 这是**被实测推翻的一半方案，不是漏做**；
> ★ **`explorer.exe` 退出码不可靠**（常转交给已有实例后立刻退出，`rc=1` 但窗口确实开了）⇒ `open` 只能听 **180 ms 内的 spawn error**，
> 前端**必须同时给「复制路径」**；⬜ 三个一次性探针未进 `SUITES`（`_probe-real-url` · `_probe-direct-url` · `_e2e-v1072-download`，
> 结论已固化进正式套件与文档）—— 是否清理**留给用户拍板，未擅自清理**；
> ⬜ **未提交 / 未推送 / 未发布**（★ **发布授权不跨轮延续**）；⬜ 前序遗留一律未动。

### ★ v10.71 增量（2026-10-14）—— 压缩包套压缩包：自动递归解压 + 加密包「填密码重跑」（站内页 + 桌面拖放双通道）

> **完整说明见 [v10.71](docs/versions/v10.71.md)**。
>
> 起因（用户原话）：「**目前下载直链的压缩包会有一个问题，压缩包中含有压缩包，有没有办法直接自动解压并且检测到如果还是有压缩包则直接再次解压或增加提醒+再次解压功能**」。
> 七项口径**两轮全选推荐项**：① 功能落点**两者都要**（站内页 + 桌面拖放）② 压缩包来源 = **站点直链直接下+解**
> ③ 加密包**列出 + 逐个填密码** ④ **原地解压** ⑤ 下载默认目录 `Downloads\GameHub` ⑥ 原包**保留不动**
> ⑦ 网盘走原方式 + **可手动丢入**。
>
> **① 先立事实（不是假想需求，全部现测）**：`/api/download` 返回的是**网盘地址**（服务端拿不到，要客户端+登录）；
> 而 `data/saves-youxia.json` 的 `files.direct` 是**真直链 1,987 条**（rar **1443** / zip **499** / 7z **45**），
> 抽测 **4/4 可下且全是压缩包**；`data/gtrainers.json` 的 `direct` 是 301 中间页，跟随重定向后
> 也是压缩包（**9,235** 条 / **98.8%**）。★ **真实场景当场复现**（不是构造样本）：
> `L0 直链下载 2,583,569 B → L1 解开 a.rar → L2 在本次产出里再扫出 “…Save 99%.rar” → L3 解开 → 固定点到达`
> —— 用户说的「压缩包里有压缩包」**就在这条链上**。★ 直链抓取**不需代理 / 不需 Referer**，支持 Range（实测 206）。
>
> **② ★★ 判定口径（本版核心资产，7z 的退出码单独用必然误判）**：
> · **退出码 2 是「三义」的**：加密错密码 = 2 · 坏 zip = 2 · 根本不是压缩包 = 2；加密不给 `-p` 更特殊 = **255**。
> · 可靠判据是 `7z l -slt` 的 **`Encrypted = +`**（加密 zip rc=0 且有该字段；坏 zip rc=2 无该字段）。
> · ★★ **密码对错必须用 `7z t`（完整性测试），不能用 `7z l`**：对 zip **文件名是明文**，
>   给错误密码 `7z l -pBAD` 照样 **rc=0** 且照样有 `Encrypted = +` ⇒ **根本区分不了**。
>   `7z t` 实测：对密码 rc=0 / 错密码 **rc=2** + `ERROR: Wrong password : inner.txt` / 不给 `-p` **255** /
>   无密码包给任意 `-p` rc=0（**不误伤**）。
> · ★★ **`-aos` 造成「假成功」**：实测同一已解过的目录，错密码再解 ⇒ 7z 把活儿**全跳过** ⇒ **rc=0** ⇒ 我们判成功。
>   而 `7z t` **不受「文件已存在」影响** ⇒ **密码闸门必须在解压之前**。
> · ★★ **失败必须回滚**：实测错密码解压会留下 **0 字节的 `inner.txt`**（正确解出 27 B）⇒
>   ① 污染用户目录 ② 下次它已「存在」被 `-aos` 跳过 ⇒ **坏文件永久留下且不再报错**。
> · **按魔数识别**不看扩展名（实测直链里出现过 `.zips` 实为 ZIP）；**分卷只解首卷**
>   （`.7z.002` 单独解报「系统找不到指定的文件」，**与坏包同码** ⇒ 不特判会把中间卷报成损坏）。
>
> **③ 实现（解析逻辑只有一份）**：`data/extractor.js` 是唯一真源，`server.js`（站内页 7 条 API）
> 与 `tools/extract-cli.js`（桌面 CLI）都 `require` 它，**都不重写 7z 调用**。
> 站内页 `/extract.html` 是**第 5 张派生页**（顶栏与底部 Tab 随之由 4 增至 5）；
> 含**熔断**（连续 3 个 `error/unreadable` 就停）· **目录护栏**（拒盘符根 / Windows / Program Files / 用户目录根 / UNC）·
> 并发 2 · 「再次解压」手动出口。桌面工具 `解压助手-拖放.cmd` / `-静默.vbs`：拖包即递归解压 + **自动弹 HTML 报告**；
> 退出码 **0**/全好 · **3**/有失败 · **4**/有待解密 · **1**/没给目标；报告里给「**只带加密包**」的重跑命令
> （路径加双引号 —— 实测包名常含空格与中文）。★ **报告必出**（采集抛异常也照渲染照落盘：失败路径恰恰最需要报告）；
> 渲染与采集**分离**（渲染是纯函数才好断言，否则测一次要跑一次真解压）。
>
> **④ ★★ 踩过的坑（六条）**：**a** ★★★ **`sniff()` 全线静默失效** —— 初版写 `sig.length <= 6`
> （本意「短签名要额外校验」），但 `sig` 是 **hex 字符串、长度是字节数的 2 倍** ⇒ `504b0304`(8) /
> `526172211a0700`(14) / `377abcaf271c`(12) **全被排除**，所有压缩包返回 null，整套逻辑静默退化成
> 「不是压缩包，跳过」；★ 最阴的是「纯文本不该误判」那条断言当时**是绿的**（什么都认不出来）⇒ **断言必须配阳性对照**。
> **b** ★★★ **页面脚本一行非法 token，整页交互全废**：`{ …, 7z: '7Z', … }` 数字开头的 key **非法**，
> 整段脚本 SyntaxError，浏览器只丢一句 `Invalid or unexpected token` ⇒ 环境条停在初值、按钮全废；
> ★★ 而构建器当时那堆自检**全绿**（节点在、样式在、入口数对）—— 因为判据是 **`indexOf(s) >= 0` = 文本存在性**，
> 不是可执行性 ⇒ **修法是给 `page-assets.js` 加 `assertScriptSyntax()`**（把产物内联脚本抽出来 `vm.Script`
> **编译**一次，失败 = **构建失败、页面根本没机会写出去**，接到四张派生页全部构建器、位置在 `writeFileSync` **之前**；
> 同时守「语法错 / `<script>` 标签不配对 / 压根没有脚本块」三件事）。
> **c** ★★ **用大段新路由替换掉了 404 兜底**（之后所有未知路径挂起不响应）⇒ 补回 + 断言升级为「仍在」且「在解压路由段之后」。
> **d** ★★ **我加的注释把结构防线照红了**：注释里写了「放在 `<style>` 之前」，而 `test-emulator-structure.js`
> 是**数出现次数**的 ⇒ 五页全报「`<style>` 不唯一」⇒ **改我的注释、不动那条有效断言**（反过来做就是拿合法输入迁就我的注释）。
> **e** ★ `unpackOne` 的 args 里 `file` 出现了两次（**rc 仍 0 但产出为空**）。
> **f** ★ 挂死：`execFile` 的 stdin 挂成 pipe 又没人关，7z **一直等密码输入** ⇒ `spawn` + `stdio:['ignore','pipe','pipe']`
> + kill 超时 + `-sccUTF-8`；★ `check-stdio-guard.js` 前置闸**当场揪出 5 处**（4 处新提升的套件 + 1 处 CLI）全部改掉。
>
> **⑤ 防线（三层证据）**：`test-v1071-extractor.js` **50**（判定口径）· `test-v1071-extract-e2e.js` **34**
> （端到端，★ **自起 8899 实例、不碰常驻 8123**）· `test-v1071-extract.js` **87**（接缝：五入口两侧 / 7 条路由 /
> 语法闸门 / 启动器结构 / CLI 契约 / 报告渲染器）· `test-v1071-extract-page.js` **24**（浏览器实拍）·
> 反证 `test-v1071-extract-counterproof.js` **9/9**。
> **静态防线实测**：静态 **54 套** + 前置闸 **3/3** ⇒ ✅ **3995 / 0 失败**、异常退出「无」。
> ★★ 同一份代码**第一次跑是 `3826 / 2 失败` + 1 条格式警告**，修完才 3995 —— 那两红一警告**全都不是功能缺陷**：
> 一条是**宿主安全删除守卫**（单轮累计删 >50 文件就拦 `rmSync`，症状是「全量某套 exit 1、单独跑全绿」= **假红**，
> 会让人去查根本没坏的代码）· 一条是**版本索引少一行** · 警告是我把收尾汇总行写成 `通过 N / 失败 M`
> （斜杠后是**失败数**）导致**成绩被静默少算 84 条**（87 被记成 3/4）。三条都补了铁律（107 / 108）。
> 浏览器层 12 套本轮**未跑全量**（其中 11 套含既有陈旧红）；本版新增的那 1 套已单独实拍 24/24。
> ★★ **前两个原先叫 `_verify-extractor.js` / `_api-test-extract.js`，是手工探针、不在任何防线里** ——
> 其中 `_verify-extractor.js` **当年真的抓到过**坑 a 那个静默 bug，却不会被任何人定时跑到
> ⇒ **「抓到过 bug 的探针」最该常驻**，本轮把它们提升进 `SUITES`。
> ★★ **反证第一次跑是 7/9，两条都是「我自己的断言写歪了」**：**①** A10「脚本里有 `initEx();`」是条弱断言 ——
> 打坏时把它包进块注释 `/* initEx(); */`，**子串照样命中** ⇒ 仍绿 ⇒ 改**位置断言**「页面脚本的**最后一句**必须是它」；
> **②** C6/C7 同样只做子串搜索 ⇒ 加 `realCallLine()`（**只认真的一行代码**，整行 trim 后不以注释符开头）
> —— 与本项目既有教训同源（**「改名要判剥注释后零残留」**）。★ 第三个问题：case ⑧ 打坏时套件在 `render(SAMPLE)`
> 就**崩了**（无汇总行），F16 根本没机会报红 ⇒ 根因是我给 F 段喂的样本**自己也缺那几个数组**，
> 把「有数据时渲染对不对」和「缺字段会不会崩」混成了一件事 ⇒ 样本补齐、缺字段交给 F16/F17 专门守。
>
> **⑥ 顺手修掉的既有问题**：**全站五个页面此前都没有 favicon**（浏览器自动请求 `/favicon.ico` 必得 404，
> **每个用户控制台都挂一条红字**）⇒ 主源 head 加**内联 SVG data URI**（不新增文件、不产生额外请求），
> 五页随 head 骨架继承；`test-emulator-structure.js` / `test-emulator-page.js` 的「顶栏恰好 4 个入口」
> 同步为 **5**（★ 顺手修掉一条**标签本来就写错**的：原文写「顶栏第三条是解包匹配」，实际是第四条）；
> 浏览器探针原来只报「console: Failed to load resource: 404」**不带 URL** ⇒ 补 `response`/`requestfailed` 监听带上状态码与 url。
>
> **⑦ ⬜ 未做 / 未验证（如实列出）**：★★ **两个启动器（`.cmd` / `.vbs`）我一次都没实跑过** ——
> 本沙箱 **`cmd.exe` 被安全策略拦死**（Bash 与 PowerShell 两条路都拦）⇒ 现状是**静态结构断言通过、未实跑**；
> D 段专门把「`%*` 而不是 `%1`」「`chcp 65001`」「不写死 node 版本目录」「0/3/4 退出码各自的提示」
> 「两个启动器指向同一个 CLI」逐个钉住 —— 那份断言就是「它至少结构上是对的」的凭据。
> 另：网盘仍走原方式（需手动丢入）· 加密包**不做字典爆破**（只列出+填密码）· 分卷只解首卷（缺卷如实报错）·
> 桌面工具**没有交互式密码框**（按报告里那条命令重跑）· ⬜ **未提交/未推送/未发布**（★ 发布授权不跨轮延续）。


### ★ v10.70 块的摘要按「只留最近 6 版」规范移出（v10.76 加新版、去掉 v10.70）

> 完整说明仍在 [`docs/versions/v10.70.md`](docs/versions/v10.70.md)。
> 四条要点留个索引：**① 首页视觉语言统一 + 密度**（hero 275→**197px**：去掉深蓝渐变与网格纹理改白底 ·
> 榜首卡 123→**60px**（金黄渐变改浅底 + 左侧 3px 橙红竖条 + `NO.1` 水印）· 列表行高 74→**58px**
> （缩略图 96→78px、**删掉行内长英文名** —— 它是行高主要推手也是 9 字段里最不值钱的一个）·
> 侧栏填充率 **19%→27%** 运维向→发现向，但**运维功能一个都没删**，全部搬进 `<details>` 折叠区）。
> **② 排序 3→6 维且「依据显性化」**（`updated/hot/score/size/sizeAsc/title`；学 XDGAME「行尾写依据值」，
> `sortKeyPill()` 是**排序键 ↔ 显示键的唯一定义处** —— 分两处会出现「按 A 排、显示 B」且**不报错**）。
> ★★ 本版技术核心 = **排序口径只此一份**：`/api/library/browse` 的 `scope=pc` 走 `gamesDb.browse()`、
> `scope=mob|all` 走**内存排序**，那里历史上**另写过一份 `keyOf`**，两份漂移时同一 `sort` 在两个 scope
> 排出不同顺序且**不报错、测试也照绿** ⇒ 抽出 `gamesDb.cmp(sort)` 三处共用；
> ★ **它返回的是比较函数、不是取值函数**（`sizeAsc`/`title` 需要「小于」方向），
> ★ **白名单也不能写死两处**（改 `gamesDb.SORT_KEYS.includes(...)`，否则前端发 `hot`、服务端**静默回落** `updated`）。
> **③ 两个真 bug**：`sizeAsc` 把 `"0.0GB"` / `"0KB"` 解析出的**数值 0** 当成「最小容量」冲到最前 ⇒
> 榜单第一页成了「**数据缺失榜**」（实测前 8 名全是 0），判据必须 `v != null && v > 0`
> （修后有效段 **19,051 条单调不减**、无效段起点恰好 `index=19051`、**越界 0 处**）；
> 761–1060px **横向溢出**（`.grid2` 单列档写成 `1fr` 而非 `minmax(0,1fr)` —— 展开是 `minmax(auto,1fr)`、
> `min` 取 auto = min-content 被内容撑宽；`≤760` 有 `#colMain{min-width:0}`、`>1060` 本身就对
> ⇒ **只有这一段「两头都不管」**）。★★ 取证时**两个假设都被数据推翻**（把排序 pill 6→3 无效 /
> 临时加 `min-width:0` 才把 809 压到 **768**），**版本 A/B**（HEAD 版挂到 `/_head-probe.html` 实测，docW **932**、
> 越界 **312 个**）证明这是 `bfcef54` 起的**历史遗留**，v10.70 已把 932 压到 831、修法一个词 ⇒ 820px docW **812**。
> **④ 防线与反证**：新建 `test-v1070-sort-keys` **41/41** + `test-v1070-home-layout` **46/46**（浏览器）
> + `test-home-fold` 收紧阈值 **42/42**；★★ `sizeAsc` 判据必须**全量扫描**（只取前 300 条时
> 「无效排最后」**根本没有样本** = vacuous truth，报绿也不代表机制在）；
> ★ 视觉语言判据用 **CSS 性质**而非正则搜文本（`linear-gradient` 时 `backgroundColor` 返回
> `rgba(0,0,0,0)`，只有 `background:#fff` 才是 `rgb(255,255,255)` ⇒ 「渐变回来了」用背景色就能照出来）；
> ★★ 反证 `_counterproof-v1070.js` **19/19**，修掉脚本自己两处问题：**「期望红哪一条」不许想当然**
> （坏法 A 第一版写 `expect:'D1'`，实测 **D1 不红**、真正暴露的是 **D7** ⇒ **写了才知道**）·
> **靶子不许引发级联崩溃**（坏法 E 第一版改 `id` 让首页脚本拿到 null ⇒ 整套 **FATAL**，
> 那证明的不是「F5 有效」而是「脚本对按钮缺失不健壮」⇒ 改成「隐藏按钮」精确命中 **F6**）；
> ★★ 侧栏那条被 **F5/F6 双层**守着（F5 判「在 DOM 里」、F6 点开折叠区判「**真的可见可点**」——
> **光在 DOM 里但被 `display:none` 挂死，仍然等于砍功能**）。
---

### ★ v10.69 块的摘要按「只留最近 6 版」规范移出（v10.75 加新版、去掉 v10.69）

> 完整说明仍在 [`docs/versions/v10.69.md`](docs/versions/v10.69.md)。
> 三条要点留个索引：**① 首页筛选面板折叠**（面板 167→50px、首屏可见 3→5 条；移动端 236→86px、1→3 条）；
> **② 折叠状态必须存在「不会被整块重建」的容器上**（`curFilterOpen` 提到模块级 + 收起用 `display:none`
> 而不是 `max-height:0` —— 后者会把隐藏控件留在**可聚焦序列**里）；
> **③ 反证脚本自己也有「我以为的数」**（v10.68 的 11/11 是运气不是设计：它命中的那条在移动端已被换成横滑行，
> 恰好凑成 1 条 ⇒ 夹具要把 `hits`（patch 串出现次数）与 `redHits`（期望红几条）拆成两个字段）。

### ★ v10.68 块的摘要按「只留最近 6 版」规范移出（v10.74 加新版、去掉 v10.68）

> 完整说明仍在 [`docs/versions/v10.68.md`](docs/versions/v10.68.md)。
> 三条要点留个索引：**① 首页首屏压缩**（参考 designeer.xyz）—— 改前 1440×1000 的第一屏
> **一条游戏都没露出来**（顶栏 61 + hero **570** + 区块头 27 + 分类行 + 筛选面板 167 ⇒ 列表 top **985 / 1000**）；
> 移动 390×844 更夸张（hero **1289** ⇒ 列表 top **1877**，要滚 2.2 屏）。本轮定下四项拍板 + 三条基础设施：
> 「骨架高 = 真卡高」「取样别取到 `.date-sep`」「首屏条数是**像素事实**，必须能测」。
> **②** ★★ 修掉一个**真缺陷**：`.cat-row{flex-wrap:nowrap}` 挡不住内层 `.statline{flex-wrap:wrap}`
> （flex item 默认 `flex-shrink:1` ⇒ 被压窄 ⇒ **它自己内部换行**），实测把 `.cat-row` 从 34px 撑到 **181px**。
> **③** 建立 `test-home-fold.js`（首屏几何）与「**阈值取拍板目标 + 余量、不照抄实测值**」的规矩
> —— 这条规矩在 v10.74 又被用到（新口径 `foldMin` 的余量就是这么来的）。

### ★ v10.67 块的摘要按「只留最近 6 版」规范移出（v10.73 加新版、去掉 v10.67）

> 完整说明仍在 [`docs/versions/v10.67.md`](docs/versions/v10.67.md)。
> 三条要点留个索引：**① ★★ 真 bug（影响所有用户路径）**——详情页的「修改器 / 存档」两块
> **此前永远是空白**；**②** 详情页定位条上那个 **12px 空壳入口**（v10.51 缺陷 A，点进去什么都没有、
> 且与「同分类」只差 12px ⇒ 高亮点到邻项）+ **761–845px 整页横向滚动条**；
> **③** 三条陈旧断言重写 —— 并立下「**0-A 与 0-B 必须成对做**」的规矩：
> 不先重写陈旧断言，修完后套件里仍混着假红，下次真出问题看不出来。

### ★ v10.66 块的摘要按「只留最近 6 版」规范移出（v10.72 加新版、去掉 v10.66）

> 完整说明仍在 [`docs/versions/v10.66.md`](docs/versions/v10.66.md)。
> 三条要点留个索引：**① 用户原话**——「①给我一个可分享的链接 ②优化弹窗显示效果，每个最多显示 5 条，
> 最好增加一个跳转到该项目详情页以及弹窗的功能」；**② 交付**——线上新增**稳定短链 `/roster/`**
> （两份产物 `docs/reports/gamehub-roster-<日期>.html` 与 `public/roster/index.html` **逐字节相同**，由 I12 守着）·
> 弹窗 `SEC_MAX = 5` 且**超额必须给出「本类共收录 N 条」+ 去处**（静默截断是禁项）·
> 站点新增 `?open=<id>`（无 `dl` 走 `openDetailById`，有 `dl` 走 `gotoResTab`，**顺序契约**已写进断言）；
> **③ ★ 口径提醒**——API 基址必须是**同源自适应**（写死 `127.0.0.1:8123` 放到 https 站点就是混合内容
> ⇒ 本体查询**静默失败**，页面不报错、只是“查不到”）。

### ★ v10.65 块的摘要按「只留最近 6 版」规范移出（v10.71 加新版、去掉 v10.65）

> 完整说明仍在 [`docs/versions/v10.65.md`](docs/versions/v10.65.md)。

### ★ v10.64 块的摘要按「只留最近 6 版」规范移出（v10.70 加新版、去掉 v10.64）

> 完整说明仍在 [`docs/versions/v10.64.md`](docs/versions/v10.64.md)
> （索引见 [`docs/versions/README.md`](docs/versions/README.md)）。
> 三条要点留个索引：**① 用户原话**——「补充到 50 个，且我需要你备注游戏本体大小」；
> **② 交付**——候选池 62 款 ⇒ **四条件**（本体实测 ∩ Mod ∩ 修改器 ∩ 存档可下）合格 **50 款**；
> **③ ★ 口径提醒**——「本体大小」取的是 `games.json` 的 `size`（**源站声明值，不是实测值**），
> 文档里必须写清「谁的值」；另附**上一版没撞上、这版才暴露**的对照（v10.63 扫 30 款即合格 20）。

### ★ v10.63 块的摘要按「只留最近 6 版」规范移出（v10.69 加新版、去掉 v10.63）

> 需要旧摘要原本可走 `git show <sha>:README.md`，完整说明见 [v10.63](docs/versions/v10.63.md)。

### ★ v10.62 块的摘要按「只留最近 6 版」规范移出（v10.68 加新版、去掉 v10.62）

> 完整说明仍在 [`docs/versions/v10.62.md`](docs/versions/v10.62.md)
> （索引见 [`docs/versions/README.md`](docs/versions/README.md)）。
> 三条要点留个索引：**① 用户现场**——「**每个游戏仅需要提供一个即可**」+「**我要的 mod/修改器/存档也没提供给我**」，
> 两条指向**同一个界面**（搜索弹窗联想面板）。**② 同款聚拢后「其余条目降级为 chip」的尾巴被去掉**：
> `smRows()` 不再拼 `smAltHtml(g)`，`smAltHtml()` / `smVariant()`（它唯一的调用方）**一起删除**
> （不留「看起来在维护、实际永不执行」的死代码），三族 CSS 与响应式同步移除。
> ★ **归并键 `nkey` 与 `smGroup()` 一个字没动** —— 只改「组内其余条目要不要露脸」。
> **③ ★★ 顺手修掉一个真 bug：`withRes` 原地污染 `gamesDb`** ——
> `bannerhub.attach` / `phonecfg.attach` 都有 `if (!h) return g;`（两库都命不中时**直传原引用**），
> 而原 `withRes` 是 `const o = withBh(g); … o.res = …` ⇒ 当 `o === g` 时就是**原地写内存库记录**，
> 只要此前有人请求过 `/api/search/all`，那批条目就被**永久污染**（带着当时那一刻的计数、库里更新了也不变 = 脏读）。
> 这也解释了「联想带不带 `res` 是**随机的**」这一现象，以及为什么**修污染与改 `withRes` 必须同时上线**。

### ★ v10.61 块的摘要按「只留最近 6 版」规范移出（v10.67 加新版、去掉 v10.61）

> 完整说明仍在 [``docs/versions/v10.61.md``](docs/versions/v10.61.md)
> （索引见 [``docs/versions/README.md``](docs/versions/README.md)）。
> 三条要点留个索引：**① 用户现场**——搜「三国无双」时「真・三国无双 起源」（机地）与
> 「真三国无双：起源」（XDGAME）**各占一行**，硬证据是两条 Steam AppID 都是 ``2384580``。
> **② 根因是双源聚合站的两道兜底各漏一半**：数据层（XD 条目匹配后挂 ``jidiId``，已 13,448 条）
> 那条 **没有** ``jidiId``；展示层按归并键并成一行，而名称键（窄类 ``decorKey``，**刻意保留 ``：``**）
> ⇒ ``真三国无双起源`` ≠ ``真三国无双：起源``。本版**不改数据层**，给展示层补**第三条判据（AppID）**。
> **③ ★★ 必须「整批算」不能逐条算** —— AppID 是**两条目之间的关系**，单条算不出来；
> 反例就在前一晚修好的古惑狼那组（机地那条自带 ``appid: 1378990``、XD 那条 cover 提不到 AppID）
> ⇒ 逐条算会把它**拆回去**。改法：新建 ``groupKeys``（批量并查集），
> ``withNKey``（单条）→ ``withNKeys``（整批），6 处调用点全改；
> ★ **并查集只 union 不 split** ⇒ 「零回归」是**结构保证**，不是靠测出来的。
> 三道闸门（AppID 必须**相等** · 排除独立发行 ``虚拟机版``/``HYPERVISOR`` · 名称闸门）缺一条
> 都会把两款不同游戏并成一行，而界面上**完全看不出来**；去掉名称闸门时全库新增 189 组合并、
> 逐组查到 **6 组假并**（cover 挂了别的游戏的图 ⇒ 提取出错误 AppID）。

### ★ v10.60 块的摘要按「只留最近 6 版」规范移出（v10.66 加新版、去掉 v10.60）

> 完整说明仍在 [``docs/versions/v10.60.md``](docs/versions/v10.60.md)
> （索引见 [``docs/versions/README.md``](docs/versions/README.md)）。
> 三条要点留个索引：**① 用户现场与根因**——「古惑狼™ 4：时机已到」（机地）与
> 「古惑狼4：时机已到」（XDGAME）各占一行；根因**不是“没做归一化”，是归一化被写了第四份**——
> ``data/name-normalize.js`` 早在 v10.36 就把 ``™®©`` 收进了 ``SYMBOLS``，而前端 ``smKeyOf()`` 自写了一份
> （**只去空白、一个符号都不剥**）。**② 真源新增第二族字符类**：``GROUP_DECOR``（窄类 / 给**展示归并**用、
> **没有第二道闸**）与 ``SYMBOLS``（宽类 / 给**匹配**用，后面有包含护栏 + 数字闸）**两族不能用混**。
> 全库 19,465 条逐组核验：宽类新并 **20 组、其中 2 组假并**（只差一个 ``：``/``！``），窄类只新并 **3 组、0 假并**
> ⇒ 只剥商标号 / 书名号包裹 / 中点，``： : ！ ! — - ～ ~`` **一律保留**（它们是实义分隔符，也正是假并的来源）。
> **③ 改法与验证**：``withNKey()`` 挂 **3 条链路共 6 个落点**（联想 / 搜索端游桶 / 实时源站两分支），
> ★ **空键「不挂」而不是挂空串**（空键会让**所有**条目并成一行，比不并更糟）；联想 ``.sm-row`` 行数 **3 → 2**、
> 全库双料组 332 → **335**；``test-v1060.js`` **50/50** · 反证 ``_counterproof-v1060-nkey.js`` **14/14** · 7 份 md5 逐字节核对。
> ★ 坑：``test-emulator-structure`` 同一处断言被“钉调用形状”**反复打红**（后续 v10.61 再中一次）⇒ 改成只判**引用了哪个标识符**。

### ★ v10.59 块的摘要按「只留最近 6 版」规范移出（v10.65 加新版、去掉 v10.59）

> 完整说明仍在 [``docs/versions/v10.59.md``](docs/versions/v10.59.md)
> （索引见 [``docs/versions/README.md``](docs/versions/README.md)）。
> 三条要点留个索引：**① 用户原话「如果是没有 XD 官方盘口标题则（游戏名称-盘）」** ——
> 承接 v10.58：那次把 XD 条目统一成「XDGAME 官方盘口」，但一款游戏 9~10 行全叫同一句，
> 只是把一句**错话**换成了一句**没用**的话。★ 根因：XD 条目按数据结构**永远**取不到标题
> （``fetchers/download.js:129`` 每条只有 ``{server, serverUrl, name, real, pwd, kind}``，
> ``name`` 就是 ``server``，没有 ``postTitle``）⇒ 不是「有标题就用、没有才兜底」两分支，
> 而是 **XD 支路必然走兜底**，兜底必须带「这一行是哪个盘口」才有区分度。
> **② 真实对照**：改前 10 行**全是** ``XDGAME 官方盘口``、标题去重 **1**；改后 10 行**互不相同**
> （``-百度网盘`` / ``-天翼云盘`` / ``-迅雷网盘`` / ``-夸克网盘`` / … / ``-磁力下载`` / ``-正版购买``），
> **标题去重 10 = 行数**；机地本体 26 帖标题**一字节不变**。**数据侧零改动**（纯显示层）。
> **③ 逐级降级**：游戏名+盘口 ⇒ 游戏名-盘口 ⇒ 盘口 ⇒ 游戏名 ⇒ **都没有则保留旧文案**（不许变空白）；
> 顺手删掉两处自己先写出来的**不可达代码**；同轮**给断言纠错**（第一版的前提错了、不是代码错）。
> **验证**：``test-v1027-dlpop.js`` 94 → **103** · 反证 ``_counterproof-v1059-xdrowtitle.js`` **11/11** ·
> 静态防线 45 套 / **3,530 / 0 失败** · 实拍走**新实例 8199**（不碰常驻 8123）。
> ★★ 坑：**探针 ``BASE`` 写死 8123 = 常驻旧进程** ⇒ 假红**也会假绿** ·
> **守卫里不许写死「当前版本号」**（``_verify-payload.js`` 那句「v10.59 残留 0 处」推进一版立刻变假红 ⇒ 改动态判据）。

### ★ v10.58 块的摘要按「只留最近 6 版」规范移出（v10.64 加新版、去掉 v10.58）

> 完整说明仍在 [``docs/versions/v10.58.md``](docs/versions/v10.58.md)
> （索引见 [``docs/versions/README.md``](docs/versions/README.md)）。
> 五条要点留个索引：**① 一轮四件事**（用户原话「先发布，且我需要你按照顺序，然后将 FR 遗弃，
> 并且合并首页以及筛选」）—— 发布积压三版（线上此前停在 v10.46 载荷）· FR 遗弃
> **严格「先落 SOP 再摘」**（SOP 约 300 行 / 12 节 + 复活手册；「零影响」是**实测**：
> `data/fr.json` 从未产出 ⇒ `stats()` 返 0 ⇒ 贡献 0 条）· 首页三视图 · 游戏名单重做。
> **② ★★ 先查出口径矛盾再动手**：上一轮建议的「合并视图只放已挂 `libId` 的 1,685 款」，
> 做出来会**恰好等于端游视图** —— 只读探针现测 **1,685 / 1,685 逐条都在端游库内、例外 0** ⇒
> 请用户拍板，选「**手游全部并入**」⇒ 合并 = **21,110**。
> **③ 三视图现测**：端游库 **19,465**（缺省值不变，不是新默认）· 手游中心 **3,330** ·
> 合并 **21,110**；实现走 `mergePick` **「归并取页，不拼接全量」**（否则每请求要拼 21,110 条）。
> **④ ★★ `?q=` 落地链路的必踩坑**：手机专区**默认开着「仅看匹配端游」**，而「手游独有」
> **恰恰就是没匹配上的那 1,645 款** ⇒ 只填 `q` 不关这个开关**必然 0 条**
> （同请求现测：带 `stats=all` → **10 条**，不带 → **0 条**）。
> **⑤ ★★ `gamesDb.all()` 不 `load()` 会静默返回 0 条** —— 第一版探针忘 `load()`，
> 输出「已挂 libId 且端游库确有 **0** / 例外 **1,685**」，与真结论**完全相反**而**不报错**，
> 差一步就把正确设计改掉 ⇒ **任何「全 0 / 全例外」的结论先证明探针读得到真值**。

### ★ v10.57 块的摘要按「只留最近 6 版」规范移出（v10.63 加新版、去掉 v10.57）

> 完整说明仍在 [``docs/versions/v10.57.md``](docs/versions/v10.57.md)
> （索引见 [``docs/versions/README.md``](docs/versions/README.md)）。
> 三条要点留个索引：**① 用户可见文案「云存档」→「存档」共 13 处**（主源 11 ＋ 派生页/脚本 2），
> 三张派生页重建跟上；★ **手机专区那个开关与它自己的卡面 chip 各叫各的**（v10.53 改了卡面
> 「💾 有存档」却漏改筛选开关）本轮统一。**② 两套「有存档」口径并存、不合并** ——
> 首页筛选走聚合层（判据「**能不能下到**」，1,377 款）vs 手机专区走 ``xref → saves``（Ludusavi 存档**位置**，6,628 款），
> 只在 ``data/xref.js`` 头部把两者并列写清、标注「不是同一个口径」。
> **③「手游独有 1,645 条」查证：用户的方向对、原因不对** —— **73.3% 是端游库真没有**
> （其中一类是 **exe 名 / 启动器名**：``PlayGTAV`` · ``AC3SP`` · ``iw3sp`` —— **正是用户说的「名称对不上」**，需别名表才能反查；
> 另一类是内容缺口，如 ``PES 2013`` / ``F1 2013`` 库里没有这一代）；
> 未挂条贡献 ``configs`` **41.8%**（不是长尾噪音），**但进首页就是空卡**
> （无详情页/本体/MOD/修改器/存档）⇒ 建议只放已挂 ``libId`` 的 **1,685 款**，**待拍板**。
> ★ 连带复绿 5 个套件；★ **用户可见文案实测有 6 处副本**（主源 ＋ 3 派生页 ＋ 测试期望串 ＋
> ``preview-*`` 按项名取 DOM 的映射表）⇒ 新增**铁律 74/75**（改文案 = 改多副本；
> ★★★ **测试自己的正则也会假红**）。
> 交付物：[``core-games-2026-10-12.*``](docs/reports/core-games-2026-10-12.html)
> （表① Mod∩修改器∩存档(可下)∩存档位置∩端游库有条目 = **153 款**；表② 再加手机实测记录 = **9 款**）。
### ★ v10.56 块的摘要按「只留最近 6 版」规范移出（v10.62 加新版、去掉 v10.56）

> 完整说明仍在 [`docs/versions/v10.56.md`](docs/versions/v10.56.md)
> （索引见 [`docs/versions/README.md`](docs/versions/README.md)）。
> 六条要点留个索引：**① 修 6 条「永远不会再绿」的死断言**（`tools/verify-online.js` 长期 25/31）——
> 2 条**陈旧特征串**删掉/换现行文案 ＋ 4 条**写死的 `>= 9`** 收口成常量 **`UPSTREAM_SUMMARY_MAX = 6`**，
> 判据改「**严格多于上游摘要**」（★ **6 才是语义上的界**，`9` 只是当年某次实测的偶然值，
> 数据一变就永远红）；顺带补两条**更有区分力**的判据（`/api/device/specs` 改判「**逐台**带回 chip 且
> **台数 == 机型清单台数**」、弹窗改判「行数 == 入口声明数」）⇒ **25 / 31 → 31 / 31**。
> ★ 死断言的镜像坏法是**恒真断言** —— 「改完变绿」不算完成，必须逐条证明它真的参与判定。
> **② 推荐配置覆盖率 66.4% 查证 ⇒ 不是我方缺陷**：现测有 rec **11,423**、差集「有 min 无 rec」
> **5,772**；固定种子抽 30 条逐条打 Steam 官方 ⇒ **我方漏取 0 条**（源站侧 11 条只有 minimum、
> 19 条 rec 原文**全是同一句占位**），**阳性对照 8 / 8** ⇒ 66.4% 已是源站上限。
> **③ 中文数字桥接 ⇒ 决定不做**（收益实测 **0** vs 代价实测 **570**）：
> 记忆里「约 11 条**被代际护栏误拒**」经查是**二次转述走样** —— v10.46 原文是
> 「**不是护栏太严，是名字写法没对上**」（即**匹配通道**问题）；按「中文字→阿拉伯」全库试算会
> 造出 **570 条假冲突**（`在一起`→`在1起` · `十字军`→`10字军` · `三维`→`3维`）
> ⇒ 在 `test-v1056.js` D 组留**负向守护**，防它被重新捡起。
> **④ 新建 `tools/check-sources.js` 外部源主动巡检**（10 个源 · 三层判据 `down`/`degraded`/`stale`）：
> 起因是「**机地搜索连续 6 日不可用无人发现**」—— 原有 10 个 daily-sync 步骤只验「**我们自己的**
> 接口通不通」，**完全不验上游还认不认我们**。★ **不能只判 HTTP 200**（`degraded` = 200 但内容
> 特征不符，才是改版静默失效的典型形态）⇒ 实跑 **10 / 10 正常**。
> **⑤ 杂项债**：GT 条目**根本没有 `ts` 字段** ⇒ 按 `ts` 排序**永远沉底**（实测影响 **2,301 款**）
> ⇒ `data/gtrainers.js` 加 `tsOf()` **读时补** · `基础测试数据.xlsx` **确认不存在** ·
> 旧 app **4 个**待用户手工清（★ 禁 `unpublish`）。
> **⑥ 验证**：静态防线 **43 套**（+`test-v1056.js` **41 / 41**）· 反证两条各 **6 / 6** ·
> `test-daily-sync` **130 / 130** · 文档闸 **208 / 208**。
> ★ 坑 5 条与新增**铁律 69–73** 全文见版本档；其中最有普适性的一条：
> **任何「全 0」结论先证明探针读得到真值**（当时漏一层 `.data` 包裹 ⇒ **30 / 30 假「不可判定」**，
> 差一步就写下与事实相反的结论）。
> ⚠️ 本版不发布（发布授权不延续）—— 改动集中在**工具与查证**，线上产物未变。

### ★ v10.55 块的摘要按「只留最近 6 版」规范移出（v10.61 加新版、去掉 v10.55）

> 完整说明仍在 [`docs/versions/v10.55.md`](docs/versions/v10.55.md)
> （索引见 [`docs/versions/README.md`](docs/versions/README.md)）。
> 五条要点留个索引：**① 修「端游资源整批无关联」** —— 用户报障「手机专区的巫师3，
> 但是端游那边无关联」；根因是匹配键长期**只有精确命中一条路**（`byName.get(k)`），
> 而 MOD 源的 `game` 是**泛称**、端游库 title 是**具体版本名**（条目 `巫师3：狂猎` → 键
> `巫师3狂猎`，库里是 `巫师3狂猎次世代版` ⇒ **子串关系但不是同一个键，整批漏**）。
> 实测该款 **94 条 MOD 100% `libId` 为空**；而 `data/mods.js` 默认 `matchedOnly = true`
> ⇒ **端游资源页搜「巫师3」得到 0 条**。全库 **8,943** 条里未匹配 **1,867（20.9%）**，
> 大头 `Grand Theft Auto V 传承版` **536** · `荒野大镖客2` 148 · `街头霸王6` 137 ·
> `黑神话:悟空` 127 · **`巫师3：狂猎` 94**。
> **② 改成「双向子串 + 五道护栏」** —— ★ **只做正向包含会漏掉最大的一头**：GTA V 首轮
> 「候选：无」，真相是**反向**（条目键 `grandtheftautov传承版` ⊃ 库键 `grandtheftautov`，
> 库键更**短**）；★ **长度比例不能当主判据**：0.6 把 `巫师3：狂猎` 挂到 `巫师3狂猎重制版`，
> 而正确的 `…次世代版` 比例 **0.556** 被挡在门外。五道护栏（各有「只有它能挡」的样本，铁律 63）：
> **G1** 短键（回退层 CJK≥3/ASCII≥4）· **G2** 数字一致（挡 `HELLDIVERS 2`→`Hell Dive`）·
> **G3** 比例 ≥0.5 · **G4** 变体降级（`虚拟机版/HYPERVISOR/Demo…` **不自动挂**）·
> **G5** 多候选取 **id 序号最小**者并标 `substring-ambiguous`（全库只有 **3 个** game 名走仲裁，全部正确）。
> **③ ★★★ 基线必须是「旧代码 + 当前库」** —— 磁盘旧产物 7,076（79.1%）是**错的基线**；
> 正确基线 **7,769（86.9%）→ 新 8,594（96.1%）**，**本次真实增量 = 825** ——
> 原始的「7,076→8,594 = 1,518」里 **693 条是数据陈旧**，**不许当结论写**。
> **④ ★★ 最险的一次**：`fetch-mods.js --offline`（注释写着「改匹配逻辑时用」）**会把缓存陈旧
> 夹带进发布** —— `linkTotal` 13,373 → **12,813（少 560）**、**421 条** `links` 不一致，
> 而条目数与 title 完全一致 ⇒ **不报错、不红、纯静默**。修法：新增
> `tools/repatch-mods-match.js` **只重算匹配字段** + 写盘前**深比较自证**「白名单之外逐字节未变」
> ⇒ 实测 `links` 不一致 **0**、`linkTotal` 保持 13,373。
> **⑤ 验证**：未匹配 **1,867 → 349**；端到端（`PORT=8125` 并行实例，不碰 8123）
> `/api/mods/list?q=巫师3` **0 → 94**、`/api/mods/match?id=xd-120` **count 94**（反方向也通）；
> `test-mods` **77 → 102** + 反证 `_counterproof-v1055.js` **10/10**
> （★ F 分支首跑 **8/10** —— 断言没判空，删掉回退后是**崩溃**而不是报红，改成 `!!r.it &&` 才 10/10）；
> 静态防线 **42 套 / 3,337 / 0 失败** + 前置闸 3/3。
> ⚠️ 前端未改 ⇒ 三张派生页无需重建（铁律 1 本轮不适用）；改 `data/mods.json` ⇒ **必须重启服务**；
> ⚠️ **发布未执行**（授权不延续，需重新确认），当时线上仍是 v10.54。

### ★ v10.54 块的摘要按「只留最近 6 版」规范移出（v10.60 加新版、去掉 v10.54）

> 完整说明仍在 [`docs/versions/v10.54.md`](docs/versions/v10.54.md)
> （索引见 [`docs/versions/README.md`](docs/versions/README.md)）。
> 三条要点留个索引：**① 搜索改「模糊匹配 + 相关度优先」** —— 缺口是**先量化过**的：
> 带空格的查询 6 条里 **3 条端游库 0 命中**，而**同一个查询**在手游 / 修改器 / 存档三库都有命中
> ⇒ 问题不在「用户怎么敲」，在端游库那份**唯一没做归一化**的实现（只 `toLowerCase().includes()`）。
> **② 匹配收敛到唯一真源** `data/search-rank.js`（原先散在 **5 处**：`gamesDb` / `mobilehub` /
> `trainers` / `saves` 各一份 + 前端 `fit()` 一份）—— 分级
> `EXACT < PREFIX < CONTAINS < TOKEN_ALL < TOKEN_SOME < NONE`，`tokensOf` **按字符类别切**
> 且长度 ≥ 4 的 CJK 段再切**不重叠 2-gram**（救乱序：`狂猎 巫师`）。
> **③ 结果分模块拉开间隔**：每组包一层 `.sm-grp`，组间留白 + 分隔线。
> ⚠️ 本版补的铁律 **61–64**（同源实现唯一化 / 归一化「做一半」更隐蔽 / **两道闸别归错功** /
> 分词按 CJK）—— 第 63 条正是 **v10.60**「归并键为什么不能复用宽类字符类」的依据之一。
> ⚠️ 发布：v10.46 → v10.54 九版一并上线（当时已获明确授权）。


### ★ v10.53 块的摘要按「只留最近 6 版」规范移出（v10.59 加新版、去掉 v10.53）

> 完整说明仍在 [`docs/versions/v10.53.md`](docs/versions/v10.53.md)
> （索引见 [`docs/versions/README.md`](docs/versions/README.md)）。
> 四条要点留个索引：**① 首页卡面补上「资源维度」** —— 缺口实测：首页默认视图 40 张卡只有 **3 张**
> 带资源 chip，而旧 `💾` 口径筛出的 **5,119** 款卡面 chip = **0**（筛出来**看不见为什么**）；
> 卡上挂 `🛠` 的 GTrainers 款 **1,300** 用旧 `tr` 口径（2,391）**筛不到**。
> **② 筛选与卡面同源**（不是口号）：`.sm-row .sm-res-b` → 通用类 `.res-chip`，
> 搜索行与首页卡**共用一处实现**（落点抽成 `gotoResTab`）；筛选行 4 → **5** 个开关，
> 新增 `🧩 有 MOD`（洋红 `#A21CAF`）⇒ 「筛出来的每一款卡上都有 chip」成了**可断言**的性质，
> 写成浏览器实拍 Phase B 的 `withChip === cards`，三档逐验。
> **③ 下载弹窗补 GTrainers 腿** —— `.d-dl-it .dl-res-lk` 这套样式就是本版建的，
> v10.58 的 MOD 直链按钮直接复用了它，v10.59 的「游戏名-盘口」行也走同一个 `.dl-it` 外壳。
> **④ 同轮**：`data/res-groups.js` 新增 `libIdsFor(cat)` / `libOpts` 三档全走它 /
> `/api/library/browse` 改挂 `withRes`。
> ⚠️ 本版也是「**`BASE` 写死 8123 = 常驻旧进程 ⇒ 假红 11 条**」那次教训的出处 ——
> v10.59 的探针 `BASE` 问题与它**同族**（详见 [v10.59](docs/versions/v10.59.md) 第六节）。
### ★ v10.52 块的摘要按「只留最近 6 版」规范移出（v10.58 加新版、去掉 v10.52）

> 完整说明仍在 [`docs/versions/v10.52.md`](docs/versions/v10.52.md)
> （索引见 [`docs/versions/README.md`](docs/versions/README.md)）。
> 三条要点留个索引：**① 数据早就有了，缺的是接线**（同族第 4 次「界面缺字段 ≠ 数据源没有」）——
> `data/res-groups.js` 早在 v10.47 就导出了 `countsFor(libId)`，**搜索链路一次没调** ⇒
> `/api/search/all` 端游桶 `withBh` → **`withRes`**。**② ★ 计数归属的 id ≠ 显示条目的 id** ——
> 端游库同一款常有 jidi / xd 两条（双料 **13,448**），而资源只挂其中一条，实测
> `xd-191 → {mod:717, saves:104, trainers:22}` 而 `jidi-3277800 → {0,0,0}`，搜索结果**主行恰好是机地那条**
> ⇒ 新增 `resFor()` 孪生兜底 + 额外下发 **`resId`**（前端 `rid = it.resId || it.id`）。
> **③ 顺带定案 FR 遗弃**（依据：CF 限流 + 阶段② ≈3.5h 须一次跑完 + 四页引用数 **0**），
> 并写明「**先落 SOP 再动手**」—— 该执行排在 **v10.58**，SOP 见
> [`docs/sop/FR-fearlessrevolution-抓取SOP.md`](docs/sop/FR-fearlessrevolution-抓取SOP.md)。

### ★ v10.51 块的摘要按「只留最近 6 版」规范移出（v10.57 加新版、去掉 v10.51）

> 完整说明仍在 [`docs/versions/v10.51.md`](docs/versions/v10.51.md)
> （索引见 [`docs/versions/README.md`](docs/versions/README.md)）。
> 两条要点留个索引：**① Mod / 修改器页签改成「整行可点开原贴」**（复用 `#postPop`；
> 行内「源站 ↗」出口的 `closest('a[href]')` 判断必须排在 `postOpen(...)` **之前**，
> 否则两个弹窗叠一起）。**② 更重的一条不在产品线上 —— 防线自己有条「没人看」的缝**：
> `run-all.js` 那句「新增套件必须登记进 `SUITES`」原先**只是注释、无人验证**，
> 实测 `test-v1025-dlstrip.js` 一条断言**自 v10.46 起红了 9 个版本没人发现** ⇒
> 新增 `checkCoverage()` 强制「每个 `test-*.js` 必须恰好登记在四张表之一」，否则直接报错退出。

### ★ v10.50 块的摘要按「只留最近 6 版」规范移出（v10.56 加新版、去掉 v10.50）

### ★ v10.49 块的摘要按「只留最近 6 版」规范移出（v10.55 加新版、去掉 v10.49）

> 完整说明仍在 [`docs/versions/v10.49.md`](docs/versions/v10.49.md)
> （索引见 [`docs/versions/README.md`](docs/versions/README.md)）。
> 三条要点留个索引：**① 三区卡片条目标题改「单行 + 省略号」**（`white-space:nowrap` +
> `overflow:hidden` + `text-overflow:ellipsis`），卡内与弹窗**共用同一条规则**；完整标题不丢，
> 每行 `.t` 带 `title` 悬停见全文。**② `min-width:0` 必须留着** —— flex item 默认
> `min-width:auto` 会拒绝收缩，那时省略号**不出现**、只把兄弟挤走（静默失效）。
> **③ 铁律 48**：CSS 覆盖会**静默失效**，断言必须读**规则体**、不能读整页字符串。
> 另：`line-clamp` 与 `nowrap` 并存时 **clamp 赢** ⇒ 单行省略静默失效。

### ★ v10.48 块的摘要按「只留最近 6 版」规范移出（v10.54 加新版、去掉 v10.48）

> 完整说明仍在 [`docs/versions/v10.48.md`](docs/versions/v10.48.md)
> （索引见 [`docs/versions/README.md`](docs/versions/README.md)）。
> 两条要点留个索引：**① 「查看全部」不再原地铺开，改弹窗 + 弹窗内搜索** ——
> 旧实现会把卡撑到几千像素、铺完就没法检索、还回不到「前 3 条」的形态；改后单次展示
> `300 → 全量 717`，`items()` 上限 `500 → 1000`（不提到 1000 会静默搜不全），
> 实测搜「v2」→ 5 行 /「zzzzq」→ 0 行。
> **② 修改器补上第三方来源跳转链** —— ★ **这不是新增数据源，是补回被丢掉的字段**：
> 上游 `gamezonelabs.com/api/data/gcm` 的单条记录**本来就有** `official_url`（覆盖 **92.8%**），
> 本地缓存里也一直存着，是 `fetch-trainers.js` 写产物时只挑了 11 个字段把它丢了
> ⇒ 入组 **3,451 / 3,683 = 93.7%**。★ 并把**来源链与下载链分开统计**（来源链打 `ch:'src'`）——
> 混在一起会让「可下载占比」从 58.9% **虚高到 96.4%**。
> 这一版的价值还在于它是「**界面缺字段 ≠ 数据源没有**」这条铁律（**铁律 45**）的第一次现场。

### ★ v10.47 块的摘要按「只留最近 6 版」规范移出（v10.53 加新版、去掉 v10.47）

> 完整说明仍在 [`docs/versions/v10.47.md`](docs/versions/v10.47.md)（索引见 [`docs/versions/README.md`](docs/versions/README.md)）。
> 三条要点留个索引：**① 三个资源分区统一改「按游戏聚合卡」** —— 一卡一款游戏、卡内前 3 条 +
> 「展开全部 N 条」原地铺（MOD 7,825 条只对应 **362 款**、最大一组 **717** 条，全铺会撑爆 DOM）；
> 存档分区**不再出位置卡**、只出「真有可下载存档」的游戏；详情页两块高度 **5 行 → 3 行**。
> **② 新增 GTrainers / FearlessRevolution 两个真链源** —— GT 9,346 条详情 / 崩 0 /
> **真实直链 98.8%** / 覆盖端游库 3,083 款 / 耗时 38.3 min；saves 535 → **1,377** 组、
> trainers 3,181 → **4,481** 组；`data/res-groups.js` 建索引 **523ms**（缓存命中 2ms）。
> **③ 修 4 个静默坑** —— `GRP_META` 键名重复**静默覆盖** ⇒ 三个分区的排序项**从来没渲染过**；
> 反向断言**只查派生页不查主源** ⇒ 往主源加回死样式断言照样 PASS；FR `detached Frame` 废掉 36 分钟；
> 裸 CSS 判据被 GT 标题里的合法署名 `{FLiNG}` 撞红。**+ 铁律 1–40 迁入 `PITFALLS.md`**
> （记忆文件 3,505 → **1,945 字**；★ 编号是稳定接口，全仓 14 处按编号引用，只能往后追加）。

> **v10.46 块的摘要按「只留最近 6 版」规范移出**（本轮加 v10.52、去掉 v10.46）：
> 完整说明仍在 [`docs/versions/v10.46.md`](docs/versions/v10.46.md)。
> 那一版的两条要点留个索引：**① 存档给「文件」不给「位置」**（新建游侠补丁网存档区源，
> 列表 3,581 → 匹配 **2,043（57.1%）** / 文件 2,043 / **解析失败 0**）；
> **② 修掉一处让防线自己说谎的环境坑** —— 沙箱里 node 起子进程时 `stdin` 为 pipe（node 默认值）
> ⇒ `EBUSY` 吞掉子进程 ⇒ 反证把「起不来」读成「一条都没红」⇒ **报成"护栏是假绿"**
> （修复前 0/11、修复后 12/12）。已加前置闸 `check-stdio-guard.js` 守卫，
> 一次揪出 29 处（含上线代码 `server.js` / `daily-sync.js`）；**即铁律 38**。

> **v10.45 块的摘要按同一规范移出**：
> 完整说明仍在 [`docs/versions/v10.45.md`](docs/versions/v10.45.md)。
> ★ 那一版「如实未做」里留的那条护栏 —— 「帖子 `content` 里仍有 17 处 `52leiqu.com/problemTutorial`，
> 谁哪天开始渲染 `content`，断言立刻变红」—— **在 v10.50 被触发了**，处理过程见本节 v10.50 块 ⑤。


<sub>更早 50 版（v10.1 → v10.51）的摘要已收敛，完整说明见 `docs/versions/`。</sub>