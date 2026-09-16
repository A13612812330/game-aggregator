# CODEX-DONE v10.14 —— 跨源按钮落到「该游戏」+ 详情页机型/芯片补全 + GPU 脏值清洗

> **用户原话**：
> 「现在还有啥需要优化的，其次详情页有点小问题（机地是跳转到首页，而不是详情页）
>   还有其他小问题也出现了，如我需要详情页中知道对应的机型和配置等 并没有补全」
>
> 澄清后确认**四项全做**：① 机地/XD 跳转改指向该游戏 ② 详情页机型+芯片配置转译
> ③ 手机配置假阴性 + GPU 脏值清洗 ④ 跨源互链放宽 + 来源徽标。
>
> **一句话结论**：四项全部落地并通过实拍验收。用户报的「跳首页」根因是**按钮写死了站点根**；
> 「配置没补全」根因是**跨中英匹配断了**（机地中文名对不上 mobilehub 的英文名）——
> 都不是「少写个功能」，是数据链路接错。收尾实拍时又逮到两个真问题（见 §五）。

---

## 一、四项需求对照表

| # | 需求 | 根因 | 做法 | 结果 |
|---|---|---|---|---|
| ① | 跨源按钮跳到**首页** | href 写死站点根 `jidiyouxi.com/` / `xdgame.com/` | 初始给**站内搜索**兜底，`linkCounterpart()` 查到同名后改写为该游戏详情页 | 幻世录 → `xdgame.com/game/15924.html`；生化危机4 → `jidiyouxi.com/topic/detail/3281308` |
| ② | 详情页看不到**机型 + 配置** | 详情页从没调用已有的机型转译能力 | 机型清单（带 SoC）+ 参数卡芯片规格行（SoC/品牌/CPU核簇/性能分） | 生化危机4：**10 款机型 · 63 套配置**；渔力全开：**14 款机型 · 8 种 GPU** |
| ③ | 手机配置**假阴性** + GPU 脏值 | ①中文名 ↔ 英文名对不上 ②mobilehub 的 GPU 列混着驱动版本串 | `id`/`alts` 跨源桥接 + 读取层 `cleanGpuOne` | 假阴性消除；产物 4,073 条 GPU **0 残留脏值** |
| ④ | 跨源互链**放宽** + 徽标 | 检索词用整名，两源命名差异导致几乎永不命中 | 检索词三轮降级（整名 → 剥版本词 → 剥标点）+ 命中优先取归一相等 | 见 §四；徽标 `.src-badge` 复核**本已存在**（首轮是探针选错选择器） |

---

## 二、① 跨源按钮：从「写死站点根」到「落到该游戏」

### 改前 / 改后

```js
/* 改前 —— 不管点的是哪款游戏，永远甩到对方站点首页 */
<a class="go ..." href="${s.cls === 'jidi' ? 'https://www.xdgame.com/' : 'https://jidiyouxi.com/'}">
```

```js
/* 改后 —— 初始是「站内搜索」（至少能直接看到同名条目），查到同款再换成详情页 */
<a class="go ..." id="crossGo" href="${s.cls === 'jidi' ? XD_SEARCH(zh) : JIDI_SEARCH(zh)}">
```

`linkCounterpart()` 拿到结果后：

| 分支 | 落点 | 按钮文案 |
|---|---|---|
| 查到同款 | 该游戏在另一源的**详情页** | `前往XDGAME详情 ↗` |
| 查不到 | 另一源的**站内搜索页**（带中文名） | `机地找同名 ↗` |

### 两个源的 URL 形状（实测）

| 源 | 详情页 | 搜索页 |
|---|---|---|
| 机地 | `jidiyouxi.com/topic/detail/3281308` | `jidiyouxi.com/search?keyword=<名>` |
| XDGAME | `xdgame.com/game/15924.html` | `xdgamer.com/search/<名>.html` |

> ⚠️ `xdgame.com/search/...` 会 404 —— 搜索必须走 `xdgamer.com`（带 r）子域。已固化进
> `XD_SEARCH()` 并在回归里锁死。

---

## 三、②③ 机型 + 芯片：转译链路补上「最后一跳」

系统里本来就有 `data/device-match.js`（1046 条机型索引），但**详情页从没调用过** ——
这就是用户说的「对应的机型和配置没有补全」。

### 三个渲染点

| 位置 | 内容 | 代码 |
|---|---|---|
| 机型清单 `.d-devlist` | 跑过这款的每台机型 + 芯片名 | `loadBhBlock()` → `GET /api/device/specs` |
| 参数卡规格行 `.d-param .spec` | SoC / 品牌 / CPU 核簇 / 性能分 | `bhParamCard()` |
| 派生页同名区块 `.cf-param .spec` | 同上（与抽屉同源，`tools/emulator-sections.js`） | `cfParamCard()` |

### N+1 规避

一款游戏最多 24 台机型，逐台调 `/api/device/match` 就是 24 次往返。
新增 **`GET /api/device/specs?models=a|b|c`** 批量端点（单台失败返回 `null`，不阻断、不编造）；
`/api/bh/params` 同时在服务端一次注入每条的 `spec`。

### 三星代号写法差异（v10.14 新增归一）

| | 写法 |
|---|---|
| 机型库 | `sm s918b`（小写 + 空格） |
| 社区配置 | `samsung SM-S918U1`（品牌前缀 + 大写 + 连字符） |

包含匹配被连字符卡死 → 本库 200 条 SM 机型**一台都译不出来**。修法两步：

1. 归一成 `sm s918u1` 精确查；
2. 退到**基号前缀** `sm s918` 找同代机型，**带 `approx: true`**。

`approx` 是刻意的诚实标记：`s918u1`（S23 Ultra 美版）与 `s918b`（S23）同为骁龙 8 Gen 2，
芯片答案一致；但我们只展示芯片、不宣称型号等同，前端在芯片名前加 **`≈`**。
A06 更典型 —— 4G 版是 Helio G91、5G 版是天玑 6300，**芯片其实不同**，所以必须标近似。

实测：`samsung SM-S928U1`（S24 Ultra 美版，库里无该精确键）→ `≈Snapdragon 8 Gen 3`（approx=true）；
`Samsung SM-A065F`（库内有精确键）→ `Helio G91`（approx=false）。

---

## 四、④ 跨源互链放宽：检索词三轮 + 防误配闸门

| 轮次 | 检索词 | 例子 |
|---|---|---|
| 1 | 整名 | `生化危机4：重制版` |
| 2 | 剥版本词 | `生化危机4：` ← **就是这个尾随冒号害的**（见 §五①） |
| 3 | 再剥标点（v10.14 新增） | `生化危机4` ✅ 检索得到机地的「生化危机4重置版」 |

最终是否算同款仍由 `sameGame()` 把关：

- 两边**都有中文段**却不相等 → **不退到英文段**（否则「古墓丽影：崛起」与「古墓丽影：暗影」
  会因共享英文前缀 `Tomb Raider` 互认）；
- 包含匹配要求两边长度都 ≥3（防短名吸走一堆）。

`resolveCounterpart()` 结果按抽屉条目缓存（`cpCache`），被 `linkCounterpart()` 与
`loadBhBlock()` 共用 —— **只查一次**。

---

## 五、★ 收尾实拍才暴露的两个真问题（首轮预判之外）

### ① 跨源检索词留下尾随冒号

`生化危机4：重制版` 剥掉版本词后是 `生化危机4：`（带全角冒号），
检索 `/api/library?q=生化危机4：` → **0 条**（机地那条叫「生化危机4重置版」，没有冒号）。

后果：**两源明明都有这款，按钮却仍然退到站内搜索**。这正是用户报「跳首页/不跳详情」的
残余形态 —— 幻世录（无冒号）能跳，生化危机4（有冒号）跳不了。

修法：第 3 轮检索词剥掉全部标点；命中里**优先取「归一后完全相等」的那条**
（`want = normGameTitle(zh)`），避免同系列多条时结果随返回顺序漂移。

实测对照：

| 游戏 | 修前 | 修后 |
|---|---|---|
| 幻世录 重制版 | `xdgame.com/game/15924.html` ✅ | 同左 |
| 生化危机4：重制版 | ❌ 退到 `jidiyouxi.com/search?keyword=生化危机4：重制版` | ✅ `jidiyouxi.com/topic/detail/3281308` |

### ② 参数卡的 GPU 没走清洗（两条数据链路不一致）

`bhparams.json` 是**另一条链路**（不走 mobilehub 的读取层），里面存着 `Adreno (TM) 740`。
不在这里清洗，同一个 GPU 会出现两种写法：

| 位置 | 改前 | 改后 |
|---|---|---|
| 机型清单 | `Adreno 740` | `Adreno 740` |
| 参数卡 | `Adreno (TM) 740` | `Adreno 740` ✅ |

修法：`/api/bh/params` 也过 `mobilehub.cleanGpuOne` —— 让 GPU 命名只有**一个事实来源**。

### ③ 一处误报澄清（不做修改）

首轮实拍报「抽屉里还有 `turnip_v25.0.0_R1`」。探针定位后发现它落在 **`驱动` 字段**
（`驱动: turnip_v25.0.0_R1`），是**正常内容**；GPU 槽位当时就已干净
（`Adreno 740 / Adreno 750 / Adreno 619`）。

不是 bug，是**我第一版断言拿整个抽屉文本做脏值正则** —— 已把断言收窄到 GPU 槽位节点。
同一个误报模式在 v10.13 也出现过（`.bdg` 选择器选错），教训一致：
**断言要打在承载该语义的那个节点上，不要打在整页文本上。**

---

## 六、验收

### 静态回归（第 12 道防线）

`tools/test-v1014.js` —— **62 / 62 通过**（本轮新增 5 项：剥标点常量、命中优先取归一相等、
剥标点行为 3 例、`/api/bh/params` 的 GPU 同源）

### 浏览器实拍（新增）

`tools/preview-v1014.js` —— **24 / 24 通过**，截图 5 张（`_preview/v1014-*.png`）

| 组 | 断言 | 实测值 |
|---|---|---|
| 跨源落点 | 不是站点首页 / 指向该游戏详情页 / 文案 / 互链卡片 | 幻世录 ✅、生化危机4 ✅、极限竞速：地平线 6 退站内搜索 ✅ |
| 手机配置 | 机型数 / 带芯片 / 规格行数 / GPU 槽位无脏值 | 生化危机4 10 款机型、渔力全开 14 款机型、GPU 全干净 |
| 空态 | 确实无社区配置时给「暂无记录」而非空白 | 幻世录 ✅ |
| 近似标记 | approx 数据通路 | `SM-S928U1` approx=true、`SM-A065F` approx=false |
| GPU 同源 | 参数卡 GPU 无 `(TM)` 后缀 | `Adreno 740 / 750 / 619` ✅ |

### 全量回归

**12 套件 798 / 798 全绿**

| 套件 | 结果 |
|---|---|
| test-alias-guard | 7 / 7 |
| test-date-norm | 47 / 47 |
| test-device-translate | 43 / 43 |
| test-emuhub | 118 / 118 |
| test-emulator-page | 118 / 118 |
| test-emulator-structure | 128 / 128 |
| test-filter-layout | 77 / 77 |
| test-mods | 77 / 77 |
| test-related-dl | 33 / 33 |
| test-saves-match | 44 / 44 |
| test-search-ui | 44 / 44 |
| **test-v1014** | **62 / 62** |

---

## 七、改动文件清单

| 文件 | 改动 |
|---|---|
| `public/index.html` | 跨源按钮 `#crossGo` + `JIDI_SEARCH/XD_SEARCH`；`resolveCounterpart` 三轮检索 + 归一优先；`sameGame` 闸门；`loadBhBlock` 机型清单；`bhParamCard` 规格行；`.d-devlist/.spec` CSS |
| `public/emulator.html` | 由 `tools/build-emulator-page.js` 重建（共享资产同步，275,949 B） |
| `server.js` | 新增 `GET /api/device/specs`；`/api/bh/params` 注入 `spec` + **GPU 过 cleanGpuOne**；`/api/mobilehub/match` 支持 `id`/`alts` |
| `data/mobilehub.js` | 读取层 `cleanGpuOne/cleanGpus/itemsView/titleVariants`；`lookup` 支持 `libId`/`alts` + `byLib` 索引 |
| `data/device-match.js` | `findDevice` 三星代号归一 + 基号兜底 + `approx` 标记 |
| `tools/build-mobilehub.js` | 两处 GPU 写入共用 `cleanGpuOne`（否则重建产物又脏） |
| `tools/emulator-sections.js` | `cfParamCard` 同步芯片规格行 |
| `tools/build-emulator-page.js` | 新增 `.cf-param .spec` CSS |
| `tools/test-v1014.js` | **新增**：第 12 道防线，62 项断言 |
| `tools/preview-v1014.js` | **新增**：浏览器实拍，24 项断言 |

---

## 八、遗留 / 下一步

1. **`tools/_*` 探针**：`_diag-detail.js`、`_probe-bhparams.js`、`_probe-dataaudit.js`、
   `_probe-steam.js`、`_sample-cfg.json` 是 v10.13 及更早留下的临时探针，本轮只清了自己新建的 2 个，
   旧 5 个**未动**（等确认）。
2. **`samsung SM-S926U` → `sm s926b` 返回 `Exynos 8895 / Mali-G71`**：S926 是 S24+，
   与 Exynos 8895（S8 时代）明显不符，疑似机型库里那条配对本身有误。当前有 `≈` 近似标记兜底，
   但**建议核一次 `device-gpu` 配对表**（本轮未动，超出四项范围）。
3. 6 个平台爬虫（好游快爆、九游、游民星空、机核、游侠网、Steam）仍是 TapTap 之外待逐个优化的队列。
