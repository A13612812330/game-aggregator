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

### ★ v10.70 增量（2026-10-14）—— 首页视觉语言统一 + 排序 6 维依据显性化（hero 275→197px · 行高 74→58px · 侧栏填充率 19%→27%）

> **完整说明见 [v10.70](docs/versions/v10.70.md)**。
>
> 起因（用户原话）：「**不太行啊，目前首页布局和样式不太行 / 排行榜 <https://www.xdgame.com/update/> 参考这个的排序和 <https://jidiyouxi.com/topic/list?sort=week/> 这些 / 其次布局我想你参考 <https://byrutgame.org/>**」。
> 只说「不太行」未指位置 ⇒ **先侦察再拍板**（三站 + 自测，全部现测），四项口径**全选推荐项**：
> ① hero 压成紧凑榜·白底 ② 主列表精简横版行 56px ③ 排序 6 维 + 依据显性化 ④ 右侧栏换成发现向。
>
> **① 先立事实（三站现测）**：XDGAME `/update/` 浅底 `#EFF1F3`、**8 tab 排序且行尾直接写依据值**
> （「574,032 热度」「2,141 赞」「10 分」「554 GB」）、列表 **47px 单行**；机地 `sort=week` 浅底 `#F5F6F8`、
> 5 sort、依据值写「7.9W」、4 列卡 305×225；BYRUT 首页**深色** `#0E0E11`、1130px 容器、4 列**竖版**卡 182×311。
> ★ 我们改前（1440×900）：hero **275** + 分类 73 + 筛选 50 ⇒ 首卡 top 573、行高 **74**（一行 9 字段含长英文名）、首屏 **3 条**；
> `#colSide` **612** vs `#colMain` **3174** ⇒ **填充率 19%**（下方 2562px 全空，装的还是运维信息）。
> ★★ **硬约束**：封面是 Steam `header.jpg`（460×215，**横版 2.14:1**）、机地也是横版 2.28:1 —— **没有竖版海报**
> ⇒ byrut 的竖版卡**不可照搬**，只学它的**密度与两栏节奏**。
>
> **② hero 275→197px**：去掉深蓝渐变 `linear-gradient(125deg,#0E1B3A,…)` + `::before` 网格纹理 ⇒
> `background:var(--c-surface)`；**榜首卡 123→60px**（金黄渐变 `#FFF3DC→#FFE2B8` 改 `#F7F9FC`
> + 左侧 3px 橙红竖条 + 巨大 `NO.1` 水印 `opacity:.06`）。白底后连带改 `.rk-skel` 骨架（白色半透明在白底上不可见）、
> `.stage-pill`、`.stage-refresh`、`.stage-h h1{color}`。
> **③ 行高 74→58px**：缩略图 `96→78px` + **删掉行内长英文名 `<span class="en">`** ——
> 它是行高的主要推手、也是 9 字段里最不值钱的一个。**④ 排序 3→6 维**：`updated/hot/score/size/sizeAsc/title`。
>
> **⑤ ★★ 排序依据显性化**（学 XDGAME「行尾写依据值」）：`sortKeyPill(it, okScore)` 是
> **排序键 ↔ 显示键的唯一定义处**（分两处会出现「按 A 排、显示 B」且**不报错**）。
> 三条踩过的口径：**`updated` 视图返回空**（列表本就按日期分组、组头已有 `.date-sep`，
> 行内再顶一枚日期 pill 是同一信息说两遍，还会把日期挤到标题左边 —— 第一版就这么错的）·
> **座垫式防重**（`size` 视图下容量 pill 既是依据值又是常规字段 ⇒ 会出两枚一模一样的）·
> `fmtHot()` 统一热度口径（≥10000 → `34.8 万`）。★ 我**主动修正了拍板口径并向用户说明**：
> 「本周/本月/全站最热」**做不了** —— XD 官网首页热榜只解析 `gid/name/url/img/rank`、**不带热度数值**，
> 本地库只有单一 `hot` 字段（19,531 条中 9,869 条有值 = **50.6%**）。
>
> **⑥ 侧栏 612px（19%）→693px（27%）运维向→发现向**：`🔥 热度 Top 5` + `分类速览` 12 pill + `按容量逛`。
> ★★ **运维功能一个都没删**：增量更新/校准续跑/同步机地三按钮 + 进度条 + 状态行**全部搬进 `<details>` 折叠区**
> —— 那是真实可用功能，顺手删掉等于砍功能。
>
> **⑦ ★★ 本版技术核心：排序口径只此一份**。`server.js` 的 `/api/library/browse` 在 `scope=pc` 走
> `gamesDb.browse()`、而 `scope=mob|all` 走**内存排序**（`mobPool.sort`+`mergePick`）——
> 那里历史上**另写了一份 `keyOf`**，两份漂移时同一个 `sort` 在两个 scope 排出不同顺序且**不报错、测试也照绿**
> ⇒ 抽出 `gamesDb.cmp(sort)` 三处共用。★ **它返回的是比较函数、不是取值函数** ——
> `sizeAsc`/`title` 需要**「小于」方向**，降序取值函数表达不了。★ **白名单也不能写死两处**
> （原 `['score','size']`，漏改一处 = 前端发了 `hot`、服务端**静默回落** `updated`）⇒ 改 `gamesDb.SORT_KEYS.includes(...)`。
>
> **⑧ ★★ `sizeAsc` 修掉的真 bug：容量「无效」的条目必须排最后**。无效有两种且**实测都存在**：
> ① `sizeGb()` 返回 `null` ② 源站声明 `"0.0GB"` / `"0KB"` ⇒ 解析出来是**数值 0**。
> 只判 `null` 会让 ② 被当成「最小容量」**冲到最前** —— 榜单第一页变成「数据缺失榜」（实测前 8 名全是 0）。
> 判据 `v != null && v > 0`。**修后全量校验**：有效段 19,051 条**单调不减**、无效段起点恰好 `index=19051`、**越界 0 处**。
>
> **⑨ ★ 顺手修掉 761–1060px 的横向溢出**（跑防线时 `test-search-ui` 一条红）。根因是一处写法错误：
> `.grid2` 桌面档写 `minmax(0,1fr)`（min=0），而 `@media(max-width:1060px)` 的单列档写成了 **`1fr`**
> （展开 = `minmax(auto,1fr)`，`min` 取 **auto = min-content** ⇒ 被内容撑宽）；
> `≤760` 有 `#colMain{min-width:0}` 兜着、`>1060` 是 `minmax(0,1fr)` ⇒ **只有 761–1060 这段两头都不管**
> （与 v10.68 修的 `.live-tag` 溢出**同一类**）。★★ **取证时两次假设都被数据推翻**：
> A/B①「把排序 pill 从 6 减回 3」⇒ docW 仍 831 ⇒ **pill 数不是触发因素**（我的第一个假设错了）；
> A/B②「临时加 `#colMain{min-width:0}`」⇒ 809→**768**、越界元素 **0 个** ⇒ 机制确认；
> **版本 A/B**（把 HEAD 版临时挂到 `/_head-probe.html` 实测）⇒ HEAD docW **932** / `#colMain` **910** / 越界 **312 个**
> ⇒ ★ **这是历史遗留**（`1fr` 自 v10.14 初始提交 `bfcef54` 就在），且 **v10.70 已把溢出自 932 压到 831**。
> 修法一个词：`1fr` → `minmax(0,1fr)`；修后 820px docW **812**，`test-search-ui` 由红转绿 **47/47**。
>
> **⑩ 防线**：新建 `test-v1070-sort-keys.js` **41/41**（静态）+ `test-v1070-home-layout.js` **46/46**（浏览器）
> + `test-home-fold` 收紧阈值并加第三档视口 ⇒ **42/42**。
> ★★ `test-v1070-sort-keys` 刻意做**真实库行为断言**（直接排序校验单调性）而非文本匹配 ——
> 「口径一致」是**行为承诺**不是「代码里有没有这行字」；★★ `sizeAsc` 必须**全量扫描** ——
> 只取前 300 条时「无效排最后」**根本没有样本**（vacuous truth），报绿也不代表机制在。
> ★ 视觉语言判据用 CSS 性质而非正则搜文本：`linear-gradient` 时 `backgroundColor` 返回 **`rgba(0,0,0,0)`**（透明），
> 只有 `background:#fff` 才是 `rgb(255,255,255)` ⇒ 「渐变回来了」用背景色就能照出来。
> ★ **阈值全线收紧**：hero 340→**240/260/320** · 榜首卡 145/120→**80/80/70** · 行高 86/76→**64/64/66** ·
> 首屏 4/2→**5/4/3**（★ 不收紧则「退回 275px 深蓝大块」在本套件里是**绿的**，而那是用户明确否掉的形态）；
> ★ 平板档阈值**按本档实测单独定**（第一版照抄桌面档 ⇒ 首卡 top 直接报红 603>600）。
> **两层防线**：静态 **51 套** + 浏览器 **11 套** + 前置闸 **3/3** ⇒ ✅ **4186 / 0 失败**（v10.69 为 4086）。
>
> **⑪ ★★ 反证 `_counterproof-v1070.js` 19/19**（六坏法含一负向守护，跨**两个文件**）：
> A `sizeAsc` 去掉 `>0` 过滤 ⇒ **D7** 红 · B `browse()` 忽略 `sort` ⇒ **C9** 红 ·
> C hero 改回深蓝渐变 ⇒ **A1** ×2 · D 榜首卡改回金黄渐变 ⇒ **A3** ×2 · E 给运维按钮加 `display:none` ⇒ **F6** ×2 ·
> **F 负向守护**（小榜卡 padding 46→48px 仍在闸内）⇒ **两套件必须仍全绿**；
> 还原后两文件 md5 **逐字节一致**。★★ **修掉反证脚本自己的两处问题**：
> ① **「期望红哪一条」不许想当然** —— 坏法 A 第一版写 `expect:'D1'`，实测 **D1 不红**
> （patch 只替换 `okA`，`okB` 仍是正确判据、会把 B 侧无效值返回 -1 拦下），真正暴露的是 **D7**
> ⇒ **写了才知道**，写死 D1 会得出「反证失败」的错误结论；
> ② **靶子不许引发级联崩溃** —— 坏法 E 第一版写 `id="jidiBtn"`→`id="jidiBtnXX"`，结果整套件 **FATAL**
> （首页脚本 `$('#jidiBtn').addEventListener(...)` 拿到 null ⇒ **整页脚本挂掉**），
> 那证明的不是「F5 有效」而是「首页脚本对按钮缺失不健壮」（另一话题）⇒ 改「隐藏按钮」精确命中 **F6**。
> ★★ 侧栏那条被 **F5/F6 双层**守着：F5 判「在 DOM 里」、F6 点开折叠区判「**真的可见可点**」
> —— 因为**光在 DOM 里但被 `display:none` 挂死，仍然等于砍功能**。
>
> **⑫ 补铁律 93–100**（口径单一来源要落在**返回比较函数**上且白名单也算口径 · **「无效值」必须和「零值」分开判** ·
> 排序依据显示键必须与排序键同处定义 · **阈值「跟着改版收紧」是每轮必做项** · 每加一个取样档阈值必须先量再定 ·
> 反证要「打了才知道红在哪一条」且靶子不许引发级联崩溃 · **断点区间是「两头都不管」的重灾区** ·
> `1fr` ≠ `minmax(0,1fr)`）。
>
> **⑬ ⬜ 未做**：**未提交 / 未推送 / 未发布**（线上仍 **v10.68**（★ 实测：`_probe-live-fingerprint.js` 显示载荷四页 md5 == 线上四页 md5，`index 2834bdab90…` = v10.68 发布留档）；★ **发布授权不跨轮延续**）；
> MOD 剩 349 条未匹配（再提须**补数据源** Thunderstore/3DM，定为下一轮主线）；四类新 fetcher；
> byrutgame·ran-ran **仅作布局参考、未接任何数据**；`/overview.html` 仍是 10-09 的数字。

---

### ★ v10.69 增量（2026-10-13）—— 首页筛选面板折叠：面板 167→50px · 首屏可见 3→5 条（移动 236→86px · 1→3 条）

> **完整说明见 [v10.69](docs/versions/v10.69.md)**。

> 起因：v10.68 把首屏从「0 条游戏」救到 **3 / 1 条**之后，「最后一截」唯一剩下的瓶颈就是
> **筛选面板**（实测桌面 **167px** / 移动 **236px**）—— 压它必须动交互，故上一轮**未做**、挂起等授权。
> 本轮用户拍板（`AskUserQuestion`，三项全选「推荐」项）：
> ① v10.68 **发布上线**（已执行 ⇒ LIVE = v10.68）② 首屏「最后一截」→ **折叠筛选面板**（授权实施 = 本版）
> ③ hero 榜单排布 **保持 5×1**。<br>
> **① 先立事实（现测）**：v10.68 之后能压的只剩面板 —— hero 已到 275/312（拍板 300/420）、
> 行高已到 74/61（拍板 76），而面板仍是**四行**（排序 / 容量 / 库 / 筛选），
> 后三行**低频却常显**，占 **117px**（桌面）/ **150px**（移动）。
> 展开态（= v10.68 状态）现测首卡 top **718 / 779**、首屏 **3 / 1 条**。<br>
> **② 折叠结构**：排序行**常显**（它是高频操作，且**带着 `#filterCount`** —— 而计数文案本身就是
> 「生效筛选的清单」，收起态实测 `命中 19,497 款` ⇒ **收起不丢信息**），
> 后三行收进 `.filter-body`（默认 `.off`）。<br>
> **③ ★★ 本版技术核心：折叠态必须是模块级变量** —— `renderList(true)` 用
> `col.innerHTML = filterBarHtml() + …` **整块重建** `#colMain`，而**点任何筛选开关都会调它**
> （`.size-pills` / `#libToggle` / `#trToggle` 全走这条路）⇒ 折叠态只存 DOM class 的话，
> 用户**每点一次筛选面板就自己弹回收起**。所以 `let curFilterOpen = false;` +
> 点击**只切 class、不重渲染**（重渲染会丢滚动位置与懒加载状态，而折叠本身只是显隐）。<br>
> **④ 总账（★ 全部现测**，`tools/_probe-fold-ab.js` 同页同视口并排量）：

| 指标 | 展开态（= v10.68） | 收起态（v10.69） | 差 |
|---|---|---|---|
| **桌面 1440×1000** 面板高 | 167px | **50px** | **−117px** |
| **桌面** 首卡 top | 718px | **601px** | **−117px** |
| **桌面** 首屏完整可见 | 3 条 | **5 条** | **+2 条** |
| **移动 390×844** 面板高 | 236px | **86px** | **−150px** |
| **移动** 首卡 top | 779px | **630px** | **−149px** |
| **移动** 首屏完整可见 | 1 条 | **3 条** | **+2 条** |

> 桌面「省 117 / 上移 117」**逐像素吻合**；移动「省 150 / 上移 149」差 **1px** 是**取整**（记录不修）。
> ★ v10.68 留档的移动首卡是 **776**，本轮现测展开态 **779** —— 差 3px 属**动态内容抖动**，不是回归。<br>
> **⑤ ★ 顺手修真缺陷**：折叠按钮加进排序行后，移动端实测 **93px**（pills 32 + 计数 18 + 按钮 26），
> **比 v10.68 的 115px 只小 22px、还分成三行更乱**。根因是 760 断点里原有的
> `.filter-count{flex:1 1 100%}`（上一版为防截断写的**整行独占**）⇒ 改 `flex:0 1 auto` +
> `white-space:normal`（放不下时**整块**换行，**宁可折行也不截断**）⇒ 移动面板落到 86px。<br>
> **⑥ ★★ 新建 `tools/test-v1069-filter-fold.js` 55/55**：S1–S7 静态
> （`.filter-body` 内**按块体**数出**恰好 3 个** `.filter-row` —— 铁律 88；折叠态是模块级变量；
> 绑定处**真翻转**；收起用 `display:none`）· A 默认收起（body 高 0 / 可见行**恰好 1** / 结构仍 4）·
> B `aria-expanded` 与文案同步 · C 能开能收 · **D ★★ 展开态扛得住重渲染** ·
> E 收起**不丢信息**且不截断 · F `barMax` 规格（收起=一行高，桌面 ≤60 / 移动 ≤110）+ `saveMin ≥100` +
> `foldMin`（4 / 2）· G 无横向溢出。<br>
> **⑦ 收紧既有闸**（折叠把首屏推过线后，v10.68 的阈值变成「撤掉也看不出来」）：
> `test-home-fold` 桌面 `foldMin` 2→**4**、`firstTopMax` 900→**800**，移动 1→**2** / 800→**750**
> ⇒ 仍 **29/29**。★ 阈值只允许写成「**目标 + 余量**」，不允许写成「我以为的数」。<br>
> **⑧ 验证**：静态 **50 套 · 3761 条** + 浏览器 **10 套 · 325 条** + 前置闸 **3/3** ⇒ ✅ **4086 / 0 失败**
> （v10.68 为 4022；差分 `test-v1069-filter-fold` **+55**、`test-filter-layout` 79→85 **+6**）；
> 三张派生页重跑 build 后 **md5 不变**（build 幂等 ⇒ 本就已同步）+ `grep` 反向确认三页都含
> `id="filterToggle"` / `curFilterOpen`×14 / `filter-body.off{display:none}`；
> `roster/index.html` md5 与 v10.68 **相同**且**不共享**筛选条（`curFilterOpen` / `filterToggle` 各 **0** 处）
> ⇒ 未变是**正确状态**。<br>
> **⑨ ★★ 反证 `_counterproof-v1069.js` 11/11**：A `curFilterOpen` 默认 `true` ⇒ `A2` 红 **2** 次 ·
> **B** 删掉状态翻转 ⇒ `C1` 红 **2** 次 · ★★ **B+** 同一次坏法 `D1` 也红（**「状态必须模块级」的直接证据**）·
> **B++** `E4` 未红（作用域没串）· C 删 `.filter-body.off{display:none}` ⇒ `A2` 红 ·
> D `aria-expanded` 写死 ⇒ **`D1`** 红（★ 期望目标**与直觉不同**，`B3` **不红**）·
> **E 负向守护**（移动按钮 24→26 仍在闸内）⇒ **整套仍 55/55**；
> 还原后 md5 `b058f978…` **逐字节一致**。<br>
> **⑩ ★★ 反证脚本自己先出了错**：第一版 **6/11**，五条红**全在夹具身上** —— 它把「期望红几条」
> 写死成 `hit(r, c.expect) === 1`，而浏览器套件**每视口跑一遍**（2 视口 ⇒ 打坏必然红 **2** 条）。
> ★★ **v10.68 的 11/11 是运气不是设计**：它命中的 `B ② hero 榜单同排` 在移动端 `.rk-grid`
> 已被换成横滑 flex 行 ⇒ 移动端不红 ⇒ 恰好凑成 1 条。修法：`hits`（patch 串出现次数）与
> `redHits`（期望红几条）**拆成两个字段**。<br>
> **⑪ 补铁律 91–93**：91 ★★ **反证脚本自己也有「我以为的数」**（测试夹具没有防线；
> 味道是「被守护的行为明明对，却报红」；判据 = 先分清红的是套件还是夹具）·
> 92 ★★ **状态不能存在「会被整块重建」的容器上**（守护它的断言必须**跨过一次重建**）
> + 两条同源细节（**收起用 `display:none` 不用 `max-height:0`** —— 后者把隐藏控件留在
> **可聚焦序列**里、且 `getBoundingClientRect().height` 报 0 但元素**仍在布局中**；
> **展开态下模板属性会被点击处理器覆盖** ⇒ 写死 `aria-expanded` 在首屏与正确值**等价**，
> 只有重渲染后才暴露 ⇒ 坏法 D 的期望目标与直觉不同） · 93 ★★ 判「同一行」要比**垂直区间重叠**、不能比 `top` 相等（同一行里元素高度不同 ⇒ `top` 天然差 3~7px，探针差点让我把「同行」写成「三行」；既有 `togglesSameLine` 同族写法当前没错但**判据对输入敏感**）。<br>
> ⚠️ **未做**：**未提交 / 未推送 / 未发布**（线上仍 **v10.68**；★ **发布授权不跨轮延续**）·
> 折叠按钮**文案语义词**未经用户复核 · 门 1（MOD 补源 Thunderstore/3DM）/ 门 2 · `基础测试数据.xlsx` 去留 ·
> `--c-t3` 对比度 · 幽灵子页 `/overview.html` · 名单页默认视图 —— 均待拍板。

### ★ v10.68 增量（2026-10-13）—— 首页首屏压缩（参考 designeer.xyz）：hero 570→275px · 行高 112→74px · 首屏可见 0→3 条

> **完整说明见 [v10.68](docs/versions/v10.68.md)**。

> 用户原话：**「目前我认为首页还需要优化下 <https://www.designeer.xyz/>，这里有个网站，可以进行学习查看」**。
> 四项口径由用户拍板（全选「推荐」项）：① hero **压到 ~300px** · ② 行密度 **B · 76px** ·
> ③ 参考站「秩序语言」**全采纳** · ④ 移动端 hero **压到 ~420px**。<br>
> **① ★★ 先立事实（比「好不好看」硬）**：改前 **1440×1000** 顶栏 61 + hero **570** +
> 区块头 27 + 筛选面板 167 ⇒ 列表容器 top **985** ⇒ **首屏 0 条游戏**；
> 移动 **390×844** hero **1289** ⇒ 容器 top **1877**（滚 2.2 屏）。
> ⇒ 「还需要优化」的真实含义是**第一屏全是壳**，不是配色问题。<br>
> **② hero：570 → 275px（移动 1289 → 312）**。冠军卡 `padding 16/20 → 12/16`、
> 缩略图 `228×128 → 172×97`（**174 → 131px**）；榜单块 `3 列 × 3 行 → **5 列 × 1 行**`
> （grid `repeat(5,…)` + 小卡缩略图 46px + 标题单行 ⇒ **244 → 47px**）；
> `.stage .in` `28/32 → 16/18`；榜单截断 `slice(1)` → **`slice(1, 6)`**、
> 骨架同步 `121px` + `repeat(5)` + `47px`（骨架必须跟真卡同步，v10.30 立过的规矩）。<br>
> ★ **排布与拍板描述不同，如实标出**：拍板选项写的是「榜首大卡 + 右侧 **2×2** 小卡」，
> 实施选了 **5 列 × 1 行** —— 按同一份实测推算 2×2 为 2 行（≈104px），hero 会停在 ≈**332px**、
> 逼近闸门 340。⇒ **目标（≤300px）达成**，但若要求恢复 2×2 视觉需再拍板。<br>
> **③ 行密度：112 → 74px**。先定位「谁主导行高」：改前缩略图 158px（⇒ 89px 高）**大于**
> 标题两行预留（`--cd-t2` = 2.8em ≈ 41px）⇒ 缩略图主导。缩略图 `158 → 96px`（⇒ 54px 高）
> ⇒ 仍由缩略图主导但落到 **74px**；中文名 + 英文名**合并一行**；
> `.row-card h3` 从「固定预留两行」改**单行 + ellipsis** ——
> ★ 这是**有意偏离** v10.30「全站卡片标题统一预留两行」的规范，理由写进 `index.html` 注释；
> 「卡片等高」改由「缩略图定宽 96 ⇒ 16:9 推出恒高」保证；骨架与断点（760 → 84px / 420 → 76px）同步。<br>
> **④ 秩序语言全采纳**：`h1` 加 `sec-no 01`、区块头加 `02` + `.sec-sub` 说明副行 +
> `.date-sep` **虚线**分隔 + `.sec-h h2{font-size:15px;font-weight:600}`（对齐参考站**实测**的
> 15px / w500）+ `@media(min-width:1061px) .grid2::after` 中缝虚线。
> ★ 采纳的是**秩序语言**（编号 / 虚线 / 标题减重 / 说明副行），**不是它的配色**（配色沿用既有基线）。<br>
> **⑤ 移动端 hero：1289 → 312px（超标达成）**：冠军卡改横条 `104×59`、`.rk-grid` 改
> **横滑行**（`.rk-card{flex:0 0 74%}` + `overflow-x:auto`）、`.sec-sub` 隐藏、
> 420 断点再收一档（`92×52` / `h1{font-size:16px}`）。<br>
> **⑥ ★ 顺手修掉一个实测到的真缺陷（不在拍板四项内）**：移动端 `.cat-row` 被撑到 **181px**。
> `.cat-row{flex-wrap:nowrap}` **挡不住子级自己换行** —— 内层 `.statline{display:flex;flex-wrap:wrap}`
> 作为 flex item 默认 `flex-shrink:1`，被压窄后**在它内部换行** ⇒ 把行从 34px 顶到 181px。
> 与 v10.30 的 `.rel-it` 是**同一类坑**。修法两处：`.cat-row .statline{flex:none;flex-wrap:nowrap;white-space:nowrap}`
> + 移动端 `.sec-sub{display:none}` ⇒ 修后 **181 → 32px**。<br>
> **⑦ ★★ 新建防线 `tools/test-home-fold.js` 29 / 29** —— 起因：v10.68 是**纯几何改动**，
> 而「几何」此前**一个断言都没有**（`_probe-home-fold.js` 只**打印**数字、从不判红）⇒
> 下一轮任何人把 `.rk-grid` 改回 3 列、把行高顶回 112px，**防线全绿、首屏又空了**。
> 守 6 组：hero / 榜首卡高度 · 榜单**同排**（判 offsetTop 极差，**不判列数写法**）· 行密度 ·
> **首屏完整可见条数** · 移动端 `.cat-row` 不换行 + 横滑 · 秩序语言落点。
> ★ 阈值取「**拍板目标 + 少量余量**」（桌面 hero 闸 340 = 目标 300 + 余量），
> **不是照抄当前实测值** —— 照抄会让任何一次正常微调变红，防线退化成噪音。<br>
> **⑧ 验证**：静态防线 **50 套 · 3752 / 3752** · 前置闸 **3 / 3** · 浏览器实拍 **9 套**
> ⇒ **合计 4022 / 0 失败 · 异常退出 无**。既有断言三处同步（**都不是删断言，是按新口径重写 + 反向断言**）：
> `test-v1030-cards` 82/90 → **90 / 90**（7 条是**我有意变更的口径**：两行预留 → 单行、
> `--cd-t2` 引用数 3 → 2；补反向断言「不许回到两行 clamp / 不许再预留两行高度」）·
> `test-emulator-structure` 284/285 → **285 / 285**（1 条**假红**，见 ⑩）·
> `test-report` 125/126 → **126 / 126**（记忆文件字数闸）。另修 `check-card-rules.js`
> 前置闸报的 **3 处违规**：`.rk-card .th` 圆角被写成硬编码 `7px` ⇒ 改回 `var(--cd-th-r)`；
> 顺手把 `.rk-champ .th` 的 `10px` / 移动端 `8px` 也统一。<br>
> **⑨ 反证 `_counterproof-v1068.js` 11 / 11**：**A** `.rk-grid` 5 列 → 3 列
> ⇒ 只 `B②同排` 红（极差 **60px**）· **B** 删 `.cat-row .statline{flex:none;…}`
> ⇒ `E①` 红（`.cat-row` **181px**）/ `E②` 红（`.statline` **179px**）·
> ★★ **B+** 同一次坏法的**附加证据**：`D①` 红（首卡 top **925px**）/ `D②` 红（首屏 **0 条**）
> ⇒ **一次证明「缺陷真存在」「修它真有效」「它同时守护首屏」三件事** ·
> **B++** `C②`（取样合理性）**未红** ⇒ 作用域没串 · **C** `.row-card .th` 96 → 158px
> ⇒ 只「行卡缩略图固定 96px」红 · **D** `.row-card h3` nowrap → normal ⇒ 只「单行 + ellipsis」红 ·
> **E 负向守护** `.rk-champ .th` 高 97 → 112（**仍在闸内**）⇒ **全绿 29 / 29**
> ⇒ 证明闸守的是「目标 + 余量」而非钉死实测值。还原后 md5
> `2834bdab90311f71ea400fc6a6655904` **逐字节一致**，两套件复绿。<br>
> **⑩ 补铁律 88–90**：**88** ★★★ **断点内的断言要按「块体」取作用域，不能按「字符距离」取** ——
> `@media(max-width:760px)[\s\S]{0,4000}?\.d-rail{display:none}` 的意思是「从断点起**往后数 4000 字符**」，
> 我在该断点**内**补两条规则就把目标推出窗口 ⇒ **假红**（一条 v10.52 的老断言）。
> 正解 `mediaBlocks()`：从查询串起做**花括号配平**取完整块体、返回**数组**
> （同名断点在同一个文件里出现**两次**，只取第一段同样会取错）；
> ★ 定性前先**归因**：拿 `git show HEAD:public/index.html` 对**同一条正则**跑。
> **89** ★★ **对照预览必须按「真实可用宽度」渲染** —— 三档**并排**时每档只剩 **456px**，
> 而线上真实容器宽 **836px** ⇒ 预览里出现「标签换行」「名称被挤成『涂…』」，
> 差一步就去改一个**根本不存在**的问题（真实宽度下都正常）⇒ 改**纵向堆叠 + 每档显式定宽**。
> **90** ★★ **「取样取错了元素」会让一组断言全绿但全错 —— 必须有一条专门照「取错样本」的断言** ——
> `#libList` 的第一个子元素是**日期分隔行** `.date-sep`（实测 20px）、**不是** `.row-card`（74px）；
> 写成 `#libList > *` 后同一份数据里：行高报 **20px**（真 74）· 首件 top 报 **690px**（真 718）·
> 首屏可见报 **4 条**（真 3）—— **三个数全错，而上界断言全绿**（20 < 86 当然成立）。
> ⇒ 收窄选择器到 `.row-card` **+** 补一条**与设计规格无关**的「取样合理性」断言（行高 ≥ 40px），
> 它唯一的职责就是把「取到了分隔行」单独照出来。<br>
> **⑪ ✅ 已发布（2026-10-13）** —— 用户在拍板卡里明确选择「发布上线」⇒ sandbox
> `445143a7b3004d749eab6be0fe8836e5`、链接不变 <https://gamehub-agg-v4.app.workbuddy.host/>；
> **五页线上 md5 == 本地（逐字节）**（`index 2834bdab9031… 499,965 B` · `emulator 88d789089cdd…` ·
> `resources 9566ba4315bd…` · `unpack 02572d4f0df4…` · `roster/ 953e89117538…`）⇒ **LIVE = v10.68**。
> ★ **线上实拍**（把新套件直接指向 LIVE 跑，验的是**用户真正看到的那一屏**）：
> `BASE=https://gamehub-agg-v4.app.workbuddy.host node tools/test-home-fold.js` ⇒ **29 / 29**，
> 几何与本地**逐项相同**（hero 275/312 · 行高 74/61 · 首卡 top 718/776 · 首屏 3/1 条 · `.cat-row` 32px）。
> ★ 判版为什么不能只看 200：五页**全部 200**，而 v10.67 在线时也全部 200 ⇒ **状态码判不出「线上是不是这一版」**。
> 已 commit `bcefe72` 并推送 `A13612812330/game-aggregator` `main`（远端 HEAD 用 `gh api` **独立**核对 == 本地）。<br>
> **⑫ ⬜ 未做（如实列出）**：**首屏「最后一截」** —— 桌面 **3 条**（拍板时提到 ~6）·
> 移动 **1 条**（目标 3–4）；瓶颈已定位 = **筛选面板**（桌面 **167px** / 移动 **232px**，4 行）。
> ★ 用户已拍板授权**折叠筛选面板**，作为**下一版 v10.69** 实施（默认收成一行「筛选 ▾」，点击展开；
> 目标桌面 **3 → 6 条**）—— 这是**新交互**，需单独的断言与反证，不与本版混在一起发。
> ★ hero 榜单排布用户已确认**保持 5 列 × 1 行**（不改回 2×2）。
> 门 1（已定下一轮主线）· 门 2 · `基础测试数据.xlsx` 去留 · `--c-t3` 对比度 ·
> 幽灵子页 `/overview.html` · 名单页默认视图 —— **均待拍板**。

### ★ v10.67 增量（2026-10-13）—— 详情页「修改器 / 存档」恒空（★★ 真 bug）+ 定位条 12px 空壳入口 + 761–845px 横向溢出 + 三条陈旧断言重写

> **完整说明见 [v10.67](docs/versions/v10.67.md)**。

> 用户口径：**「可以，开始吧」** —— 批准上一轮的 P0 三项（**0-A** 修 5 条真界面差距 /
> **0-B** 重写 3 条陈旧断言 / **0-C** 本体全量预跑）。三项**本轮全部做完**：
> 0-A + 0-B 在代码与判据上收口，0-C 挂后台并行跑完（见 ⑩）。<br>
> ★ 上一轮定的规矩生效了：「**0-A 与 0-B 必须成对做** —— 不先重写陈旧断言，
> 0-A 修完后套件里仍混着假红，下次真出问题看不出来。」<br>
> **① ★★ 真 bug（影响所有用户路径）**：详情页的「修改器 / 存档」两块**此前永远是空白**。
> `loadTrBlock` / `loadSvBlock` 取的是 `d.id` = **源站裸 id**（XD 的 `110` / `3668`），
> 而资源分组是按**本地库 id**（`xd-110`）归组的 ⇒ `/api/res/game?id=110` **恒返回 0 条**
> ⇒ `if (!items.length) { slot.innerHTML = ''; return; }` ⇒ 两块永远不渲染。
> 旁边四个兄弟函数（`loadBhBlock` / `loadReqBlock` / `loadRelated` / `loadDlBlock`）**都收 `fb`**，
> 只有这两个漏了 —— v10.23 给兄弟函数补 `fb` 时没同步过来。
> 三组**互相独立**的证据：探针 hook `window.fetch` 打出真实请求是 `?id=110&t=群星%2FStellaris`
> （**丢了 `xd-` 前缀**）· 同一款换 `?id=xd-110` → trainers **30** / saves **1** 而 `?id=110` → **0/0/0** ·
> 服务端**只在 `id` 为空时**才按 `t`（标题）兜底搜库 ⇒ 裸 id 走的是
> 「查得到但什么都没有」的**静默分支**。修后实测：`#trBlock` `''` → **224px** ·
> `#svBlock` `''` → **224px** · 外层 `#trSvSlot` **12px → 224px** · 卡头「全部 N →」**0 → 1**
> （艾尔登法环 `xd-3668`：修改器 7 / 存档 63 / 按钮 3）。
> ★ 这类 bug 特别值得记：它**看起来和「这款游戏确实没有修改器」一模一样** ——
> 不报错、接口回 200、区块只是不渲染 ⇒ **200 ≠ ok** 的又一形态；而且它是被**探针点名**的，
> 不是靠读代码看出来的。<br>
> **② 定位条上「点进去一片空白」的入口（v10.51 缺陷 A，本轮才修）**：某款没有修改器/存档时，
> `#trBlock` / `#svBlock` 被 `innerHTML=''` 清空，但外层 `#trSvSlot`（`.d-pair`）是
> `paintDetail` 里**静态写死**的元素 ⇒ **仍留 12px**；而 `railTarget()` 的可见性判据是
> `offsetHeight > 0` ⇒ **12 > 0 通过** ⇒ 条上照样出现这一项。
> 改判据为 `offsetHeight >= RAIL_MIN_H`（**24**）。★ 24 这个数是**两款样本实测**定的：
> 空壳 **12px** ｜ `xd-106` 最矮真实分区 **88px** / `xd-10676` **79px** ⇒ 余量 2 倍以上；
> 取舍写在注释里：**宁可少一项入口，也不给一个点进去什么都没有的空壳**。<br>
> **③ 761–845px 整页横向滚动条**：宽度扫描 **760 ✅ ｜ 780 ❌ +65 ｜ 820 ❌ +25 ｜ 840 ❌ +5 ｜ 860 ✅**；
> `documentElement.scrollWidth` **恒为 845**（与视口无关）= 顶栏 `.wrap` 的**内容固有宽**
> （brand 126 + nav 358 + 搜索 228 + liveTag 55 + gap 14×4 + padding 22×2），
> 真凶祖先链 `span#liveTag < div.wrap < header.topbar`；而紧凑模式只有 `max-width:760px` 一套
> ⇒ **761–845 谁也不管**。补 `@media(max-width:880px)`：`.live-tag{display:none}` +
> `.main-nav a{padding:6px 8px}` —— 两条**都沿用 760px 那套既有语言，不新增设计**；
> 修后 780 / 800 / 820 / 840 **全部 ✅**。<br>
> **④ 行密度 3 条不是缺陷，是口径未同步**：v10.30 拍板「全站卡片标题统一预留两行」
> （`.sm-row .t{min-height:2.6em}`），代价是搜索结果行 **+18px**，
> `index.html:228-232` 注释原文「**这是『全站卡片标题统一预留两行』的必然结果，不是回归**」
> ⇒ 断言按**已拍板的取舍**改写（**≤90 / ≤105 / 首屏 ≥6**，= v10.7 基线 68/83/9 + 18），
> 而不是去改实现；三条仍是**上界**（将来把两行预留删掉、行高掉回 68px，`≤` 会放行 —— 那是改善）。<br>
> **⑤ 三条陈旧断言重写**：`test-v1025-rail` ⑤「收录 **≥9** 项」——9 是 **v10.29 的版式事实**，
> v10.32 把「修改器/存档」在条上**合并成一项**（9→8）、v10.57 又从「云存档」改名「存档」
> ⇒ 换成**行为式**（每项点完，落点处紧贴顶部的分区都 ≥24px）+ **⑤b**（项数 5–12 且不重复，
> 不钉死数字）；`test-v1025-more` ⑦/①b 钉在「**云存档**」这个词 + 钉死样本「怪物火车2」，
> 而修改器/存档是按**本地库 id** 归组的、`/api/library?q=` 的**首条可能是机地条目**（`jidi-*`）
> ⇒ 实测 `id=jidi-3668` → **0/0/0**；原调用 `openDetail(url, encodeURIComponent(jidi), false)`
> **第二参不是 JSON** ⇒ `JSON.parse` 失败 ⇒ `fb = {}`，与真实用户路径不一致
> ⇒ 改成**动态挑**（`/api/res/groups?cat=trainers|saves&sort=count` 找 `count > 3` 的 `libId`）
> \+ 走 **`openDetailById`** + 判据**只钉「卡头版式出现过」、不钉区块名**。
> ★ 顺带纠正 v10.53 的措辞：不是「样本已空 / 口径过时」，是**样本选样方式错**，数据一直都在。<br>
> **⑥ 补样本覆盖（本轮最关键的一步）**：那 12px 空壳**只在「没有修改器/存档」的款上存在**，
> 而两个套件原本用的都是**有资源**的样本（该块是 224px 真分区）⇒ **结构上就测不到**；
> 且「落点几何」这条判据在要守的场景上**会假绿**（条上挂着 12px 空壳项时，
> 点它滚到的位置紧跟着就是真分区 ⇒ 几何取到仍是 ≥24px 的分区 ⇒ 通过）
> ⇒ 三件一起补：**零资源样本**（`ZERO_GAMES` 动态挑，本轮 `xd-106` 荒野大镖客2）·
> **阳性对照 ⑤c″**（先断言该样本的 `#trSvSlot` **确实存在且确实 <24px**，
> 否则「条上没有它」可能只是这一款压根没渲染这个元素 ⇒ 断言**空转**）·
> **直读 `dRailItems`**（`railTarget()` 选中的节点本身，高度绕不开；与几何**互补保留**）。
> ⚠️ 这是 rail 套件**唯一**读页面内部变量的地方，理由写在文件头；读不到时**报红**，不静默跳过。<br>
> **⑦ 防线**：`test-search-ui` **47 / 47** · `test-v1025-more` 断言数 11 → **19 / 19** ·
> `test-v1025-rail` 17 → **21 / 21**。另修三处**断言自身**的假红：more ③「每个按钮文案里都有条数」
> **过宽** —— `#bhMoreSlot` 在 `hiddenDev === 0`（机型没被截断）时文案**合法无条数**
> （「查看实测记录与逐条配置」，`index.html:4449-4452`），它背后是「实测记录 / 逐条配置」，
> **根本没有『台数』可写** ⇒ 收窄为「文案非空 + 无未渲染占位 + 数字 ≥1」，并补 **③b**
> 「至少一个按钮带条数」防条数口径**整体消失**；more ④-Nb 的行选择器漏了第三类 **`.d-res-it`**
> （`tr2`/`sv2` 弹窗走 `dResFullHtml()` 渲染的是与卡内同款的行）⇒ 打开这两类弹窗时 rows 恒为 0；
> rail ⑨c「歧义项名字必须恰好是『云存档+修改器』」既钉**术语**又钉**版式**
> （v10.32 已合并成一项 ⇒ 该场景**已不可能出现**）⇒ 改**按成因**判
> 「歧义项必须各自等于它那一趟的**滚动上限**」；rail ⑩「互不相同的落点数 ≥ **n-1**」——
> 样本有 3 项被**滚到底夹住**（落点都等于 `scrollHeight - clientHeight`）⇒ 去重恒为 `n-2`，
> **而那是正确的物理上限** ⇒ 改成「去掉夹住的项之后落点必须**两两不同**」，
> 且上限**逐轮采样**（懒加载会让正文总高在点击期间变化，循环后测一次不够）。<br>
> **⑧ 反证 `_counterproof-v1067.js` 10 / 10**：**A** `RAIL_MIN_H` 24 → 0 ⇒ 只 `⑤c′` 红
> （证据原文 `修改器/存档=12px`，其余 7 项 88–467px）；★ **A+** 打坏后**有资源款那条仍绿**
> ⇒ 这就是「只测有资源款会漏判」的证据（也是这个缺陷从 v10.51 活到 v10.67 的原因）；
> **B** 两块取数 id 退回 `d.id`（两处都打，命中 2）⇒ ⑦ 红；**C** 删 `@media(max-width:880px){}`
> ⇒ 820px 溢出红；**D 负向守护** `min-height:2.6em` → `36.4px`（14px 字号的**等价**写法）
> ⇒ 行密度**仍绿**、整套 47/47 ⇒ 证明断言守的是**像素高度**这层语义、不是字面量写法。
> 还原后 `public/index.html` md5 `aba6173142b6bae2afbb9d6caefa0d46` → **逐字节一致**，三套件复绿。<br>
> **⑨ 补铁律 84–87**：84 ★★★ 「展示用的 id」与「取数用的 id」不是同一个东西（静默 0 条）·
> 85 ★★ 「有内容」不能用 `> 0` 判 + **只测「有数据」的样本会漏掉空壳场景**（要配反例样本 + 阳性对照）·
> 86 ★★ 媒体查询**断点之间会留「谁也不管」的缺口区间**（判据要扫一遍宽度）·
> 87 ★★ 断言里**不许钉「样本自身的名字」、不许写死「容差量」**（⑨c 钉名字、⑩ 写死 `n-1`，
> 两条都因为数据/版式一变就红，而它们守的东西**一条都没守**）。<br>
> **⑩ 0-C 已完成（本体全量预跑）**：后台跑 **33 分钟**、**4,152 / 4,152** 全测完
> （`{auth: 3761, ok: 358, nobody: 33}` · **err = 0** ⇒ 熔断未触发 · ≈ **2.1 款/秒**，远快于原先估的「约 2 小时」）；
> 名单页 `tools/gen-roster.js` 重建 ⇒ 「本体」列 **168 → 4,152**
> （原来只有 v10.57 那一轮的 168 款有实测值，其余标「未测」）。
> ★★ **逐行核对旧结果没变**：`data/_core-dl-probe.json` **是 .gitignore 的**，
> 而探针脚本是**增量合并**写入（`todo` 只挑未测过的 id）⇒ 旧行不会被重测；
> 但「不会被重测」这件事必须有**独立证据** ⇒ 先备份**重建前**快照再逐行比：
> 旧 168 条**逐行一致 168 / 168 · 变化 0 · 缺失 0**，三态分布
> 旧 `{ok:12, auth:153, nobody:3}` → 新 `{ok:358, auth:3761, nobody:33}`，
> **除本体列外的其余 12 列 0 处差异**（21,149 行 × 12 列逐格比）。
> ★ 第一次比对报了「253,788 处不一致」，**是我自己的比对脚本写错** —— 只按 `r[1]`（id）建键，
> 而同一 `xd-*` 在端游行与手游行**会撞**（3,339 手游里 1,687 款并入了端游行）⇒ 拿错行去比；
> 改成 `id + '#' + 来源` 建键后 0 处差异。（教训同铁律 4：判据先自检 ——
> 报了一整屏差异时，先怀疑比对本身。）<br>
> **⑪ ✅ 已发布**（2026-10-13 16:23）—— 五页线上 md5 与本地**逐字节一致**：
> `index.html` `aba6173142b6bae2afbb9d6caefa0d46` · `emulator.html` `5d0a6e97ba2250f8c3dceaa4328ef318` ·
> `resources.html` `d53ba00d0416a1599e956a9bc29296ff` · `unpack.html` `8783f9b46b1742d37e6bfbd06e4ef4a1` ·
> `roster/` `953e89117538bf27c75e9a47662dc52c`。<br>
> 上线**前**线上实测 = **v10.66**（`index.html` `f726590c8bb4b150c77db807f7692717` ·
> `roster/` `826e4241e68d6f637be448d6b41e30f8`，与 v10.66 文档记录逐字节一致）⇒
> **记忆里记的「线上 = v10.63」早已陈旧**，本轮实测纠正。<br>
> 线上内容自证：`roster` meta `nBody:4152`（旧值 `"nBody":168` 命中 **0**）·
> `index.html` 含修复串 `String((fb && fb.id) || (d && d.id) || '')` **2** 处 ·
> `RAIL_MIN_H` 3 处 · `max-width:880px` 1 处。<br>
> 线上**用户路径**阳性/阴性对照（`/api/res/game`）：
> `?id=xd-110&t=群星%2FStellaris` → `{"mod":0,"saves":1,"trainers":30}`（修后前端实际发的请求）·
> `?id=110&t=群星%2FStellaris` → **全 0**（修前会发的裸 id，证明旧路径确实恒空）。<br>
> ★ 另修掉载荷自检里一条**从来没绿过**的探针：`_build-deploy-payload.js` 原探
> `/api/games?limit=1` —— 该路由在 `server.js` 里**零存在**、本地 8123 同样 404；
> 已改为 `/api/health`（实测 200）**并纳入判定**，不再是只打印的装饰性断言。
> 门 1（MOD 补源收缩为 Thunderstore / 3DM）· 门 2（`byrutgame` · `ran-ran`）·
> `基础测试数据.xlsx` 去留 + 实测时点标注 · `--c-t3` 对比度 · 幽灵页 `/overview.html` ·
> 名单页默认视图，**均待拍板**（其中门 1 已定为下一轮主线）。

### ★ v10.66 增量（2026-10-13）—— 名单页上线（`/roster/` 稳定短链）+ 弹窗摘要 ≤5 条 + 站点 `?open=` 直达详情/资源弹窗

> **完整说明见 [v10.66](docs/versions/v10.66.md)**。

> 用户原话：**「①给我一个可分享的链接 ②优化弹窗显示效果，可以每个最多显示5条，最好增加一个跳转到该项目详情页以及弹窗的功能」**。<br>
> **① 发布**：同域名覆盖发布（未换域），新增线上路径 **`/roster/`** ——
> 产物同时写 `docs/reports/gamehub-roster-<日期>.html`（归档）与 **`public/roster/index.html`**（站点静态根就是 `public/`，
> 目录自动吃 `index.html`）；两份**逐字节相同**由防线 I12 守着（防“两份各自漂移”）。<br>
> **② 弹窗摘要**：`SEC_MAX = 5`，每类只渲染前 5 条；超额时必须给出
> **「仅显示前 5 条 · 本类共收录 N 条」+ 去处**（静默截断是本项目已出过事的模式）。<br>
> **③ 站内跳转**：弹窗新增常驻动作条 —— `打开游戏详情页 ↗`（`/?open=<id>`）与
> `直接打开资源弹窗 ↗`（`/?open=<id>&dl=1`）；每类的「还有 N 条」**直接落到那一类的页签**
> （`&dl=modifier|mod|save`），不用落地后自己再点一次。<br>
> ★ **为什么这不是纯前端能做的**：站点此前只支持 `?q=` / `?c=` / `?sort=`，**没有按 id 直达某一款**
> 的参数 ⇒ 同步给主站 boot 加了 `?open=`（无 `dl` 走 `openDetailById`，有 `dl` 走 `gotoResTab`）。
> ★★ **顺序契约**：`gotoResTab` 里必须「先 `await openDetailById` 再 `openUniDownload`」——
> 弹窗靠抽屉的会话上下文取 id，颠倒会出现「弹窗拿到**上一款**游戏的 id」（已写进 C2 断言）。<br>
> ★★ **API 基址改同源自适应**：上一版写死 `127.0.0.1:8123`，页面放到 https 站点里就是混合内容
> ⇒ 本体实时查询**静默失败**（页面不报错，只是“查不到”）。现为
> `location.protocol === 'file:' ? 'http://127.0.0.1:8123' : ''`：双击本地文件仍可用，线上走同源。<br>
> **实测**：弹窗（选资源最多的赛博朋克2077 / `xd-191`）修改器 **22→5**·MOD **200→5**·存档 **104→5**，
> 三类的「还有 N 条」各落 `&dl=modifier|mod|save` ✅；站点直达五态（`?open=` · `&dl=1` · `&dl=mod` ·
> `&dl=bogus` 兜底 body · 不存在的 id 不炸页面）**本地与线上各跑一遍全绿**；
> 线上五页 md5 逐字节一致（roster `826e4241e6…` 四处同字节），三个接口全 200，
> 线上实拍点「实时查询本体」回「源站要求登录（3 个入口）」= **同源 API 真的通**。<br>
> **防线**：`test-roster.js` 48 → **60**（新 I 段：I1 上限值是 5 · I2 只渲染前 SEC_MAX 条 ·
> **I3 存在超额说明分支** · I4/I5 动作条与两个入口 · I6 绝对站点常量 · **I7 API 同源自适应** ·
> I8 三类各落对应页签 · I11/I12 短链落点存在且与归档**同字节**）·
> 新建 `test-v1066.js` **17**（A 主站读 `?open=` 且引用 `openDetailById`/`gotoResTab`/`DL_UNI_KEYS` ·
> **B 四页都同步** · C `gotoResTab` 顺序契约 · **D roster 拼的 `dl=` 必须在站点页签键内**（跨文件契约）·
> E boot 段不许直接调 `openUniDownload` · F 元断言）· 反证 `_counterproof-roster.js` 9 → **13/13**（新增 G/H/I/J）·
> 新建 `_counterproof-v1066.js` **9/9**；静态防线 **50 套 / 3743 / 0 失败**。<br>
> ★★ **反证抳出两处自己的错**：① **I3 第一版钉的是文案词形**（`includes('去详情页看全部')`），
> 坏法 H 把文案换掉后 **竟然没红** ⇒ 说明它判的是措辞不是功能；收敛成「超额说明的**分支**是否存在」后正常。
> ② **负向守护有两种语义**（“该让另一条红” vs “谁都不该红”），首版混用 ⇒ **守护自己被判红**。
> 另两个坑：**探针按 id 搜索是子串匹配**（`xd-191` 先命中 `xd-1918`）⇒ 选错款、
> 「最多 5 条」根本没被触发却显示 ✅（**假绿**）；**产物有两份同字节副本** ⇒ 打坏必须两份一起打，
> 否则每条坏法都顺带把 I12 打红、真正要看的那条被噪音淹没。<br>
> ⬜ **未做**：`--c-t3` 对比度 · 幽灵页 `overview.html` · 名单页默认视图 · 本体是否后台预跑 4,152 款 ·
> 移动端可用性三项（点击目标 25~33px · 解包页 `left=-4px`）· 交付链路脚本入库 —— **均待拍板**。

### ★ v10.65 增量（2026-10-13）—— roster 页面 v2：表头吸附 + 筛选改多选

> **完整说明见 [v10.65](docs/versions/v10.65.md)**。

> 用户原话：**「字段未置顶，其次我想多选筛选」**（附截图，红框圈出滚动后消失的表头行）——
> 两条都是「**坏了也照样能用**」的需求，不看截图、不实测根本发现不了。<br>
> ★★ **① 表头吸附：根因不是「没写 `sticky`」，是 `sticky` 被祖先的 `overflow` 吃掉了** ——
> `.card` 上有一条 `overflow:hidden`（原意给卡片做圆角裁切），而 **`hidden` 会让它成为一个
> 「不可滚动的溢出容器」**，`position:sticky` 的吸附上下文正是「最近的滚动容器」⇒ 表头变成
> **相对卡片盒吸附**，而卡片自身从不滚动 ⇒ **吸附永远不触发**。
> **先量化再改**：滚到 1500px 实测 `th.top = **-1180**`（跑到视口上方 1180px，彻底脱顶）·
> 最近的 overflow 非 visible 祖先 = **`DIV.card{overflow:hidden}`** ·
> **阳性对照**（只注入 `.card{overflow:visible}`、其它一律不动）⇒ `th.top = 58` **恢复吸附**，根因坐实。
> 改法：`overflow:hidden` → **`overflow:clip`** —— 裁切效果相同，但 **`clip` 不创建滚动容器**，
> 既不破坏吸附又保住圆角裁切（`visible` 也能修好吸附，但会丢圆角 ⇒ 见下面的断言分层）。
> 另给表头补 `box-shadow` 分离线（否则滚动内容贴着表头，视觉上像粘连）。<br>
> **② 多选：改前实测确为单选，不是推测** —— 点「有 MOD」（筛选 325）再点「有存档」⇒ **MOD 被顶掉**，
> 只剩 1,377。改为独立 toggle（`.on` 与 `aria-pressed` 同步）：
> **平台取并集**（「端游」与「手游可玩」是两个不同维度，一条记录可同时属于两者）·
> **资源组合方式由下拉框显式决定**（`需同时具备` AND 默认 / `任一满足` OR，**不设隐式默认**——
> 两者结论差 10 倍：AND **181** vs OR **1521**）· **取消最后一个具体项自动落回「全部 / 不限」**
> （否则出现「一个都没选」的**空语义死区**：用户以为筛掉了全部，其实啥也没筛）·
> 「全部 / 不限」= 清空选择，点具体项自动取消它。页面新增 **3 处「可多选」自证文案**（chip 组标签 ×2 + 说明区第 ③ 条）。<br>
> ★ **为什么要「自证」**：多选是典型的「看不出错」需求 —— 仍写成单选也能点、也出结果，
> 只是永远只能选一个；本轮需求本身就是这个坑的产物 ⇒ 页面必须自己写清楚，否则下一轮还会被当单选用。<br>
> **实测 10/10**（页面行为，不读源码字符串）：桌面 1440 与移动 390 `th.top` 均 = **58**（= topbar 高）、
> 移动横向溢出 **0px** · 资源多选 `["mod","saves"]` · AND **181** ≤ 只 MOD **325** · OR **1521** ·
> 平台并集 端游 **19,497** → 端游+手游 **21,149**（= 全量）· 点「全部」清空 · 连点两次自动落回「不限」·
> 重置回默认 · **页面错误 0**。★★ **容斥交叉验证：`325 + 1377 − 181 = 1521`** ——
> 与 OR 模式实测的 1521 **完全吻合**，两条独立路径算出同一个数。<br>
> **防线**：`test-roster.js` 40 → **48**（新 H 段 7 条：H1 不能是滚动容器 / **H1b 用 clip 兼顾裁切** /
> H2 仍是 sticky / H3 用 `var(--topbar-h)` 单一真源 / H4 9 个 chip 的 `aria-pressed` /
> H5 `#resMode` 默认值 / H6 文案自证 / H7 资源按钮与判定分支一一对应）·
> 反证 `_counterproof-roster.js`（新建）**9/9** = 5 坏法（A `clip`→`hidden` 红 **H1** · B 去 `aria-pressed` 红 **H4** ·
> C 默认改「任一满足」红 **H5** · D 改硬编码 `58px` 红 **H3** · E `saves` 分支改名红 **H7**）
> + **1 个负向守护** + 基线 + 复绿 + md5 **逐字节**还原。静态防线 **49 套 / 3711 / 0 失败**。<br>
> ★★ **负向守护抓出了我自己的过度断言**：H1 第一版写的是「**必须含 `overflow:clip`**」，
> 于是 `overflow:visible`（**同样不吃 sticky、吸附完全正常**）也被判红 ⇒ 这是**过度断言**，
> 会让未来任何一次合理的实现替换都无故变红。改成「不能是滚动容器」后分层正确：
> **H1 = 能力（吸附不能失效，结构性）· H1b = 实现（用 `clip` 兼顾裁切，可替换但要显式）**；
> 反证脚本的 `hit()` 也同步改用 `❌\s*H1\b` **词边界精确匹配** ——
> 否则 `H1b` 的红会污染 `H1` 的绿，**负向守护直接失效**。<br>
> ★ **坑 3 条，全是「我自己造的假红」**：① **探针把 `overflow:clip` 当可疑祖先**（判据写成
> 「computed overflow ≠ visible」，而 `clip` 不是 `visible`）⇒ 明明吸附正常仍报异常，
> 改成只认 `auto|scroll|hidden`（**只有这三种创建滚动容器**）——
> ★ **探针自己的判据也必须精确**，否则会造出一类看起来像证据的假报告；
> ② **截图 `clip` 走的是文档坐标** ⇒ 滚到 1500px 后按 `clip:{y:0}` 截图，截到的是**页面顶部**而非滚动后的视口，
> 「表头看不见」这个**截图本身**差点被我当成缺陷（改成不带 `clip` 直截视口）；
> ③ **探针 ⑥⑧ 的动作序列与期望值没对齐**（测平台并集时没清掉资源筛选 · 只点掉一项就断言「落回不限」）⇒
> 连报两次假红。★ 规律：**红的是探针不是产品**时，先对齐语义再改结论。<br>
> ⬜ **未做**：站点代码 `server.js` / `public/*.html` **零改动** ⇒ 不需重启、不重建派生页、**未发布**（线上仍 v10.63）·
> 之前规划的 v10.66 移动端可用性（点击目标补 40px / 解包页 `left=-4px`）与 v10.67 交付链路入版本管理仍在队列 ·
> `--c-t3` 对比度 · 幽灵页 `overview.html` · 默认是否只看「有资源的 4,152」· 本体是否后台预跑 4,152 款 —— **均待拍板**。

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
