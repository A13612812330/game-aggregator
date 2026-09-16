# CODEX-DONE v10.13 —— 详情页「游玩配置」三块补回 + 首图定高 + 指南末位与联网更新

> **用户原话**：
> 「游玩配置等详情页也没有了，我需要你补进去，最好固定下游戏首图（详情页大图）的高度，现在是不固定的
>   手机专区 模拟器指南放在最后一个，且我需要你联网优化下内容」
>
> 澄清后确认「游玩配置」= **三项全做**：① PC 最低/推荐配置要求 ② 手机模拟器配置区块 ③ 逐条游玩参数。
>
> **一句话结论**：四项全部落地。其中「配置要求」不是靠猜数据 —— 库里 **97.2%** 的封面 URL 里
> 本来就带着 Steam appid，直接调 Steam 官方 `appdetails` 接口就能拿到**官方中文**配置；
> 顺带在「模拟器指南」里逮到一个**真 bug**：四张表因为字段名对不上，在浏览器里一直是空的。

---

## 一、四项需求对照表

| # | 需求 | 做法 | 结果 |
|---|---|---|---|
| ① | 详情页**游玩配置**丢失 | 补回三块：PC 配置要求 / 手机模拟器配置 / 逐条游玩参数 | 见下 §二 |
| ② | 固定**详情页首图高度** | `.d-hero` 从 `min-height:220px` 改 `height:250px` + `img{position:absolute;inset:0;object-fit:cover}` | 桌面恒定 **250px**、窄屏 **190px**，不再随原图宽高比伸缩 |
| ③ | 手机专区**模拟器指南放最后** | `tools/build-emulator-page.js` 的 `BACKBAR` 页签顺序改为 `手游中心 → 修改器 → 云存档 → 机型兼容 → 模拟器指南` | 指南由第 4 位挪到**末位**（第 5 位） |
| ④ | **联网优化**指南内容 | 重写 `data/emuguide.js`，按 2026-09 生态口径更新，并**新增第⑥节「版本门槛」** | 七节全部有内容（原来四节是空的，见 §四） |

---

## 二、① 游玩配置：三块分别是怎么补的

抽屉里的三个槽位各自独立取数、独立兜底、独立降级：

| 槽位 | 挂载点 | 数据来源 | 缺数据时的表现 |
|---|---|---|---|
| PC 配置要求 | `#reqSlot` | ① 源站自带 requirements → ② **Steam 官方接口** → ③ 机地同名话题兜底 | 显示「暂无」（不再整块消失） |
| 手机模拟器配置 | `#bhSlot` | BannerHub 社区配置（`data/bannerhub-files.json`） | **常显**：给说明 + 入口，不再静默消失 |
| 逐条游玩参数 | `#bhParamSlot` | `GET /api/bh/params`（解析逐条 JSON 的 `settings`） | 命中才铺卡 |

### ②「配置要求」为什么能覆盖 97%

关键发现：**封面 URL 里就有 Steam appid**。

```
https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/2050650/header.jpg
                                                              ^^^^^^^ ← appid
```

实测统计（`data/games.json`，15,302 条）：

| 项 | 数值 |
|---|---|
| 库内条目 | **15,302** |
| 封面里带 Steam appid | **14,876** |
| 覆盖率 | **97.2%** |
| 去重后 appid | 13,995 |

有了 appid 就能直接打 Steam 官方接口：

```
https://store.steampowered.com/api/appdetails?appids=<appid>&l=schinese&filters=basic,pc_requirements
```

返回的 `pc_requirements` 是**官方简体中文**，直接解析成 `{os,cpu,ram,gpu,dx,net,storage,note}` 七个字段。

**新增文件**

- `data/pcreq.js` —— 缓存 + 实时兜底。核心函数：
  - `appidOf(cover)`：从封面 URL 抠 appid
  - `parseReq(html)`：把 Steam 的 `pc_requirements` HTML 解析成七字段
  - `resolve({title, cover, appid})`：**三级兜底**，返回 `{ok,hit,src,appid,min,rec}`
  - `throttled()`：串行限流（`MIN_GAP=1100ms`），避免被 Steam 限流
  - `flush()`：合并写 `data/steam-req.json`，`process.exit` 时强制落盘
- `tools/build-steam-req.js` —— 离线预热，支持 `--limit/--all/--force/--gap/--only`，断点续跑、负缓存跳过
- `server.js` 新增 `GET /api/pcreq?t=&cover=&id=`（第 606 行）与 `GET /api/pcreq/stats`（第 603 行）

**预热实测**（`tools/build-steam-req.js --limit=1500 --gap=800`，用时 28.9 分钟）：

```
[steam-req] 完成。本次命中 1268 / 未收录 5 / 失败 227
[steam-req] 缓存总览: {"cached":1220,"withReq":1215,"miss":5}
```

| 项 | 数值 |
|---|---|
| 预热请求 | 1,500 |
| 落盘缓存 | **1,220** 条 |
| 其中有配置 | **1,215** 条（缓存内命中 **99.6%**） |
| Steam 未收录 | 5（demo / 工具类条目，并非失败） |

**接口实测**（生化危机4 · `xd-5828` · appid 2050650）：

```
ok true | hit true | src steam | appid 2050650
最低: Windows 10(必须为64bit) / AMD Ryzen 3 1200 或 Intel Core i5-7500 / 8 GB RAM
      / AMD RX 560 4GB 或 NVIDIA GTX 1050 Ti 4GB / DX12
推荐: Windows 10/11(必须为64bit) / AMD Ryzen 5 3600 或 Intel Core i7 8700 / 16 GB RAM
      / AMD RX 5700 或 NVIDIA GTX 1070 / DX12
```

### ③「逐条游玩参数」为什么藏在 JSON 里看不到

BannerHub 的逐条配置 JSON 里有个 `settings` 对象，装着**驱动 / DXVK / 容器 / 翻译层 / 分辨率 / 内存**等 ——
以前前端只给一个「下载 JSON」链接，**用户得下下来才知道里面写了什么**。

- 新增 `data/bhparams.js`：`parseConfig(j, meta)` 提取
  `driver(DXVK) / vkd3d / container / translator / resolution / maxMem / cores / audio` 等
- `server.js` 新增 `GET /api/bh/params?k=&limit=4`（第 448 行）、`GET /api/bh/configs?k=` 支持**逗号分隔候选键**
- 前端新增 `bhParamCard(p)`（第 2260 行）把每条配置渲染成一张参数卡

**接口实测**（GTA5）：

```
/api/bh/params?k=Grand_Theft_Auto_V_Legacy,Grand_Theft_Auto_V_Legacy22&limit=3
→ picked: Grand_Theft_Auto_V_Legacy
→ candidates: { Grand_Theft_Auto_V_Legacy: 200, Grand_Theft_Auto_V_Legacy22: 1 }
→ items[0]: 驱动 dxvk-1.10.3 / VKD3D vkd3d-2.12 / 容器 proton11.0-arm64x
            翻译层 FEX · 游戏预设 / FEX Fex-20260103 / 内存 2 GB / 振动 开
            最大指令数 5000 · 多块翻译 · Mono 兼容
```

---

## 三、② 首图定高：一个 CSS 陷阱

原来：

```css
.d-hero{min-height:220px}
```

`min-height` 只保证**下限**，实际高度由图片**原始宽高比**决定 —— 所以每款游戏的首图高矮不一，
同一款游戏加载前后还会跳一下。

改法（`public/index.html` 第 794 行）：

```css
.d-hero{position:relative;background:#101A38;height:250px;overflow:hidden}
.d-hero img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
```

配套窄屏（第 952 行）：

```css
@media(max-width:760px){ .d-hero{height:190px} .d-req{grid-template-columns:1fr} }
```

**实拍实测**：桌面容器 **250px**、图 720×250px（原图仅 128×128，`object-fit:cover` 铺满不留白）；
窄屏 **190px**。定高后**同一款游戏任何状态下高度都不变**，不再有加载跳动。

---

## 四、④ 联网优化指南 —— 顺带逮到一个真 bug

### ★ 真 bug：模拟器指南四张表一直是空的

`data/emuguide.js` 里四组数据的字段名**前后端对不上**：

| 数组 | 原字段名 | 前端读的字段 | 结果 |
|---|---|---|---|
| `WRAPPERS` | `{dx, pick, why}` | `name` / `desc` | ❌ 空 |
| `TUNING` | `{t, d}` | `name` / `desc` | ❌ 空 |
| `AVOID` | `{c, e, why}` | `name` / `desc` | ❌ 空 |
| `BENCH` | `{g, f, s}` | `name` / `desc` | ❌ 空 |

前端是 `p.name || p.n` / `p.desc || p.d` —— 四个数组**一组都对不上**，
于是「包装器 / 优化调参 / 避坑清单 / 帧率参考」**四张表在页面上全是空的**（不是没数据，是渲染不出）。
`STACK`（`{name,desc}`）和 `CHIPS` 侥幸对上，所以只有这两节看起来是正常的。

> 这类 bug 的特征和 v10.12 那个一样：**看代码看不出来**（数组里有几十条数据，看着"有内容"），
> **静态检查也过**（不是语法错），**只有打开页面数条数**才发现是 0 条。
> 修法：全部统一为 `{name, desc}`，并加断言「每节必须有内容」。

### 联网更新后的指南结构（七节）

| 节 | 锚点 | 内容 | 条数 |
|---|---|---|---|
| ① | `#egStack` | GPU 驱动栈（Turnip → DXVK/VKD3D → Box64/FEX → Wine/Proton → .exe） | 5 |
| ② | `#egChips` | 芯片适配（骁龙 845/855/865/870/888 世代推荐驱动） | 5 |
| ③ | `#egWrap` | 图形 API 包装器（DX8 / DX9-11 / DX12 / 老 2D 分别怎么选） | 4 |
| ④ | `#egTune` | 优化调参（9 条：分辨率优先、单变量原则、驱动配套、CPU 亲和性…） | 9 |
| ⑤ | `#egAvoid` | 避坑清单（内核级反作弊、纯 DX12、强 DRM、ARM 原生/UWP…） | 5 |
| ⑥ | `#egVer` | **★ 新增·版本门槛**（2026-09 口径） | 6 |
| ⑦ | `#egBench` | 帧率参考（PES 2013 / PES 2017 / GTA5 / 辐射NV / 上古卷轴5…） | 8 |

**第⑥节「版本门槛」的 2026-09 口径**：

- 容器/前端 · **Winlator 11.2.0**（官方稳定版，2026-08）。社区分支 Star / Frost / Ludashi / aMod / CMOD 各有坑
  —— **先跑通官方版再换分支**，否则同时多了两个变量。
- GPU 驱动 · **Mesa Turnip 26.3.0**，Vulkan **1.4.362**（来自 Banners-Turnip 每小时 upstream 自动构建）。
  按世代选变体：A6xx/A7xx 标准、A710/A720/A722 实验、A8xx 实验。

---

## 五、改动文件清单

| 文件 | 类型 | 说明 |
|---|---|---|
| `data/pcreq.js` | 🆕 新建 | PC 配置缓存 + Steam 三级兜底 + 限流 |
| `data/bhparams.js` | 🆕 新建 | 逐条游玩参数解析（含多语言 LABEL_MAP 归一化） |
| `tools/build-steam-req.js` | 🆕 新建 | 离线预热 `data/steam-req.json` |
| `tools/preview-v1013.js` | 🆕 新建 | 29 项浏览器实拍断言 |
| `data/emuguide.js` | ♻️ 重写 | 统一 `{name,desc}`（修真 bug）+ 新增第⑥节版本门槛 |
| `server.js` | ✏️ 修改 | `require` pcreq/bhparams；新增 `/api/pcreq`、`/api/bh/params`；`/api/bh/configs` 支持多候选键；`/api/mobilehub/match` 加 `bhKeys`/`sources` |
| `public/index.html` | ✏️ 修改 | `.d-hero` 定高 + 新增 `.d-req`/`.d-param` 样式；新增 `loadReqBlock()`/`bhParamCard()`；`#reqSlot` 取代内联 `reqHtml`；`loadBhBlock()` 改为常显 |
| `tools/emulator-sections.js` | ✏️ 修改 | `openBhPanel()` 接 `/api/bh/params` 渲染逐条参数卡；`initEg()` 渲染第⑥节 |
| `tools/build-emulator-page.js` | ✏️ 修改 | `BACKBAR` 页签顺序（指南末位）+ 新增 `.cf-param` 系列样式 + 指南第⑥节 |
| `data/mobilehub.js` | ✏️ 修改 | `lookup()` 改按标题分段匹配（`splitTitle`），修多段标题整串对不上 |
| `tools/test-emulator-page.js` | ✏️ 修改 | 页签顺序断言同步为 `emu/tr/sv/dm/eg` |
| `tools/test-emulator-structure.js` | ✏️ 修改 | 同上 + `#relSlot` 断言由 `${reqHtml}` 改为 `id="reqSlot"` |

---

## 六、验证

### 回归（10 套件 618 项）

| 套件 | 结果 |
|---|---|
| `test-emulator-page` | **118 / 118** |
| `test-emulator-structure` | **128 / 128** |
| `test-related-dl` | **33 / 33** |
| `test-mods` | **77 / 77** |
| `test-search-ui` | **44 / 44** |
| `test-saves-match` | **44 / 44** |
| `test-filter-layout` | **77 / 77** |
| `test-date-norm` | **47 / 47** |
| `test-device-translate` | **43 / 43** |
| `test-alias-guard` | **7 / 7** |
| **合计** | **618 / 618** |

> 首轮跑出 3+2 项 FAIL，**全部是 v10.13 的预期变更**（页签顺序 + `reqHtml`→`reqSlot`），
> 是断言固化了旧状态，**不是功能退化** —— 同步断言后全绿。

### 实拍断言（`tools/preview-v1013.js`，29 项）

```
=== 结果：29 通过 / 0 失败 ===
```

覆盖：首图定高 250px / 图片铺满 / 配置要求两栏 14 行有真实内容 / 手机配置常显 /
逐条参数卡 3 张 / 页签顺序（指南末位）/ 面板参数卡 6 张 / 指南七节均有内容 /
窄屏 190px + 一栏 + 无横向溢出。

### 实拍截图（`_preview/`）

`v1013-hero-xd-5828.png`、`v1013-hero-xd-15924.png`、`v1013-detail-xd-5828.png`、
`v1013-detail-xd-15924.png`、`v1013-detail-bhparams.png`、`v1013-detail-mobile.png`、
`v1013-bhpanel.png`、`v1013-emuguide.png`

---

## 七、踩过的坑（可复用）

1. **Steam `filters` 必须带上 `basic`** —— 只传 `filters=pc_requirements` 会返回 `data:[]`（HTTP 200 但空），
   必须 `filters=basic,pc_requirements`。
2. **配置要求有时是空的，因为封面不是 Steam 的** —— 例如生化危机4 的 `xd-5828`，详情页给的 cover 是
   xdgame 自有的 `/uploads/` 图（没有 appid）。所以 `/api/pcreq` 要**回本地库找候选封面**，多个候选里挑带 appid 的那个。
3. **同一游戏在社区仓库有多个别名目录，要挑文件最多的** —— `PES2013` 只有 2 份配置，
   而 `Pro_Evolution_Soccer_2013` 有 **2,773** 份。后端 `parseConfig`/`params` 接受**候选键数组**并自动择优。
4. **社区配置是多语言的** —— BannerHub 导出混着葡/英/中三种写法（`Driver do sistema` / `Personalizado`），
   需要 `LABEL_MAP` 归一化成中文。
5. **手游匹配不能整串比** —— GTA5 的库标题是「侠盗猎车手5传承版/GTA5传承版/Grand Theft Auto V Legacy」多段拼接，
   整串归一化后跟仓库键对不上。改为 `splitTitle` 分段匹配（键长 ≥3 才建索引，防短键误命中）。
6. **★ 需求改了顺序，固化顺序的测试断言要同步改** —— 本轮 5 项 FAIL 全是这个原因。
   这类 FAIL 要**先判断是「预期变更」还是「真退化」**，再决定改代码还是改断言。

---

## 八、遗留

- Steam 预热目前覆盖 **1,220 / 14,876**（约 8%）。冷门条目首次访问时会走实时抓取（有限流，约 1.1s/条），
  之后落盘。**要跑满全量**：`node tools/build-steam-req.js --all --gap=800`（按 28.9 分钟 / 1,500 条估算，
  全量约 **4.8 小时**），建议挂着后台跑。
- Steam 未收录的 5 条（demo/工具）与区域锁条目，显示「暂无」，**不编造**。
- 机地同名兜底要求**中文名完全一致**才认，避免张冠李戴。
- 社区逐条参数目前默认取 **limit=4**，面板取 6；如果需要更多可以在 UI 上加「展开全部」。

---

## 九、沉淀

- 本轮验证了「**Steam 官方接口 + 封面上挂的 appid**」这条链路可覆盖 97% 的 PC 配置要求，
  且拿到的是官方中文 —— 比自己去解析各站 HTML 稳得多，值得在别的聚合项目复用。
- 「`min-height` 定不住高度」与「字段名前后端不一致」都属于**静态检查过、只有实拍/数条数才暴露**的一类问题，
  和 v10.12 的「CSS 类规则 vs 内联样式」同一族 —— 结论：**每次 UI 改动都要有「数条数」的实拍断言**。
