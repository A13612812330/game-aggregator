# CODEX-DONE v10.18 —— 机型清单「三要素齐全」+ 未收录自动联网补全 + 防误配加固

> **用户原话**：
> 「手机模拟器配置的展示样式不太行
>   ①我要求是全整显示（品牌+型号+芯片）
>   ②点击可以查看到详细的参数
>   ③如果未收录则自动联网搜索进行补全」
>
> **一句话结论**：三条全部落地。机型清单现在每台都是「品牌 + 型号（**允许折行、不截断**）+ 芯片徽标」，
> 徽标按**来源**分色（青绿=本地 / 靛蓝=联网 / 灰虚线=真没收录）；点击仍就地展开完整硬件参数（v10.16 功能未动）；
> 缺芯片的机型**自动联网补全**。全库 1,048 台机型的芯片覆盖率从 **98.9% → 99.8%**，
> 剩下的 2 台**如实标「未收录」，不编造**。

---

## 一、三个口径确认（AskUserQuestion，用户已选）

| 决策点 | 选项 | 用户选择 |
|---|---|---|
| 机型排布 | 保持双列 / 改单列 | **保持双列 + 芯片做徽标** |
| 门槛行 | 保留独立小结行 / 合并成徽标 | **合并成行内橙色徽标** |
| 联网触发 | 手动点 / 自动 | **自动补全** |

---

## 二、三级降级：能本地解决的绝不上网

```
① 本地配对索引  device-match.findDevice   → chipSrc='pair'
② 串内芯片号    机型串里就写着芯片号       → chipSrc='token'
③ 联网 kalvo    前两级都空才打网络         → chipSrc='kalvo'
   三级全落空 → 留空，前端如实显示「未收录」（不编造）
```

### 全库实测覆盖率（社区库 `mobilehub.json` 的 `devices` 去重 = **1,048 台**）

| 级 | 来源 | 台数 | 占比 | 备注 |
|---|---|---|---|---|
| ① | 本地配对索引 | **1,030** | 98.3% | `device-match` 的逐条配对 |
| ② | 串内芯片号 | **6** | 0.6% | `Odin2 QCS8550` / `T10Plus T606` / `A266M s5e8825` / `W09 Maleoon 920C` |
| ③ | 联网 kalvo | **10** | 1.0% | 实测补到 10 / 12（见下） |
| — | 仍缺 | **2** | 0.2% | `Pocket FIT unknown` / `SM X706B` —— 本地无译名、kalvo 也查不到 |

**① + ② + ③ = 1,046 / 1,048 = 99.8%**（改前 ① + 仍然空白 = 98.9%）

### 第 ③ 级的真实战绩（12 台候选，实测 10 台补到）

| 机型代号 | 本地译名 | 联网补到 | 查询词 |
|---|---|---|---|
| `SM S711B` | Galaxy S23 FE | Samsung Exynos 2200 (国际版本) / Qualcomm Snapdragon 8 Gen 1 (美国) | Galaxy S23 FE |
| `SM A566E` / `SM A566B` | Galaxy A56 | Samsung Exynos 1580 | Galaxy A56 |
| `SM A556E` | Galaxy A55 | Samsung Exynos 1480 | Galaxy A55 |
| `SM S731B` | Galaxy S25 FE | Samsung Exynos 2400 | Galaxy S25 FE |
| `SM S721B` | Galaxy S24 FE | Samsung Exynos 2400e | Galaxy S24 FE |
| `SM S921B` | Galaxy S24 | Qualcomm Snapdragon 8 Gen 3（多地区）/ Samsung Exynos 2400 | Galaxy S24 |
| `SM F766B` | Galaxy Z Flip7 | Samsung Exynos 2500 | Galaxy Z Flip7 |
| `SM S908B` | Galaxy S22 Ultra | Samsung Exynos 2200 / Snapdragon 8 Gen 1 | Galaxy S22 Ultra |
| `SM X620` | Galaxy Tab S10 FE+ | Samsung Exynos 1580 | Galaxy Tab S10 FE+ |
| `Pocket FIT unknown` | — | **未收录** | 无译名可查 |
| `SM X706B` | — | **未收录** | 无译名可查 |

> 12 台整批联网耗时 **23.9s**（`concurrency=3`）。结果落盘 `data/device-fill.json`，
> 命中缓存 30 天、未命中 3 天（未命中更该重试）。

---

## 三、★ 本轮真踩到的坑（都是「看起来对、实际错」）

### 3.1 防误配：`plausible()` 原来只做**子串**匹配 —— 跨品牌串台

原实现只有一条判据：「查询词末位 token 是结果的**子串**」。

| 查询词 | 错误匹配到的结果 | 后果 |
|---|---|---|
| `ZTE Blade A73` | `Samsung Galaxy A73` | `a73` 恰好是子串 → 判为同台 |
| `motorola moto g20` | `Motorola Moto G **(2022)**` | `g20` 是 `g2022` 的前三个字符 → 判为同台 |

**改成三道闸，任何一道不过就否决**：

```
① 品牌冲突一票否决 —— 两边都认得出品牌且无交集 → 一定是别的牌子
     ZTE{zte}  vs  Samsung{samsung}  →  ∅  →  否决
     Xiaomi POCO{xiaomi,poco} vs POCO{poco} → {poco} → 放行（子品牌交集，不误杀）
② 长词（≥4 字符、非品牌）**必须全部出现**
     品牌词不算 —— 否则 `Moto G (2022)` 又会因为标题里有 `Motorola` 而冒充 `moto g20`
③ 末位 token（型号号）：≥4 字符可子串；**≤3 字符必须整词相等**
     所以 `g20` 命中 `Moto G20` ✓，命中 `Moto G (2022)` ✗
```

并**删掉了原来的兜底**「某个长词命中就算同一台」—— 那条等于「型号号错了也认」，
实测会让 `Wiko Power U30` 认成 `Power U20`。宁可退回「未收录」，也不安一个错的芯片。

### 3.2 缓存键不能用归一化（v10.18 前段已修，此处留档）

`devicespec.mkey()` 会把标点全剥掉 → `moto g(20)`（搜不到）与 `moto g20`（搜得到）
**撞成同一个键** `motog20` ⇒ 一条失败记录毒掉能查的那条。改用 `ckey()`（保留标点）。
**这正是「修复看起来没生效」的真正原因** —— 代码改了，但缓存里躺着旧结论。

### 3.3 `MALLOON920C` 是个**拼写错误**，不是数据缺失

测试断言 `chipByToken('MALLOON920C')` 一直返回 `null`，一度以为是索引只按 `gpu` 建键的问题。
核对全部数据源后：真实写法**统一是 `Maleoon`** —— `MALLOON` 在
`bannerhub-files.json` / `soc-db.json` / `device-board.json` / `gpu-soc.json` 里出现 **0 次**，
`MALEOON` 出现 16 + 1 次（`bannerhub-files.json` 16 处、`soc-db.json` 1 处）
→ 归一键应为 **`MALEOON920C`**。
`MALLOON920C` 在任何数据源里都不存在，**查不到是正确行为**，错的是测试字面量
（`chip-tokens.json` 的 `_note` 里也抄错了）。**两处都已改正**。

### 3.4 多地区值末尾带悬空 ` / `，直接进 `title` 像没写完

kalvo 对分地区发售的机型返回的 soc 是一长串：
`Samsung Exynos 2200 (国际版本) / Qualcomm Snapdragon 8 Gen 1 (美国) /` ← 尾巴那个 `/`
新增 `tidyVal()` 在**出口**统一清洗（缓存命中与新鲜结果走同一条路），首尾分隔符与多余空白都清掉。

### 3.5 `未收录芯片` 残留文案（语义还歧义）

两处：① v10.14 的 CSS 注释；② 详情页真实 UI —— `<span class="sp none">该机型代号**未收录芯片**规格</span>`。
第 ② 处读起来像「芯片没收录」，实际是「芯片**规格**没收录」。改成「**该机型代号暂无芯片规格**」。

### 3.6 ★ 缓存落盘写成「只写前 N 次」= 静默丢数据（本轮自查发现）

`put()` 里为了「同一 tick 合并写」写成了：

```js
function put(raw, rec) { ...; if (_writes < 3) flush(); }   // ← 只写前 3 条
```

`_writes` 是**进程内累计**的，所以一个进程里**只有前 3 次 put 会落盘**，其余全留在内存。
实测：批量联网 12 台 → 磁盘上只留下 **3 条**（`withChip` 内存态 15、磁盘 7），
**重启后 8 台白跑一遍网络**——而且全程零报错。

修法：改成 `devicespec.js` **已经用了的同一套 `_dirty` + 写穿模式**（一个语义只留一种写法）。
条目量级几百条、文件几十 KB，写穿代价可忽略。
并给 `FILE` 加 `DEVICEFILL_CACHE` 环境变量出口，让回归测试能用**隔离缓存**真验一条不落。
修后实测：隔离缓存写 5 条 → 磁盘 **5 条**；正式缓存 16 条 → 磁盘 **16 条**。

---

## 四、前端显示（三要素 + 分色徽标）

### 改前 / 改后（同一款游戏：终极漫画英雄vs卡普空3 / `xd-2044`，机型清单 9 台）

| | 改前 | 改后 |
|---|---|---|
| 主行 | 「品牌+型号」被 `nowrap + ellipsis` 截断 | **允许折行、不截断**（`word-break:break-word`，去掉 `white-space:nowrap`/`text-overflow:ellipsis`） |
| 芯片位 | 次行小字，**3 台**写「未收录芯片」 | **9 台全有芯片徽标**，0 台「未收录」 |
| 芯片来源 | 不可见 | 青绿=本地 / **靛蓝=联网（3 台）** / 灰虚线=未收录，徽标带「网」「串」角标 + `title` 完整值 |
| 门槛 | 顶部独立小结行（与首行是同一台，看着像重复） | **行内橙色「门槛」徽标** + 表头补一格图例 |
| 长芯片名 | 溢出 | `chipShort` 在第一个 `(` `（` ` / ` `/` 处截断，完整值挂 `title` |

实测（`preview-v1018` 浏览器实拍）：

```
9 台全部拿到芯片（改前 3 台是「未收录芯片」）     未收录 0 台
至少 3 台是联网补全得来（靛蓝徽标 + 网 标记）      联网补全 3 台
不会卡在「联网查询中…」                          卡住 0 台
Honor Magic8 Lite → 网 Qualcomm Snapdragon 6 Gen 4
moto g(20)        → 网 Unisoc T700   ← 不是误配成 Moto G (2022)
```

### ★ 联网补全**不重渲染清单**

补全只对那一个 `.chip` 元素做 `outerHTML` 原地替换。若整份清单重渲染，
用户已点开的硬件参数面板会**当场收掉**（v10.16 的展开态是 DOM 状态，不持久）。
实拍断言：点开面板 → 待联网补全完成 → 面板**仍在**。

### ★ 中间态不是空白

未收录的机型先渲染成 `.chip.wait`「联网查询中…」（带 `hwPulse` 动画），补完再换成终态，
补不到换「未收录」—— 用户不会看到一段莫名的空白。

---

## 五、数据层与接口

| 文件 / 接口 | 变更 |
|---|---|
| **`data/devicefill.js`**（新增 ~290 行） | 三级降级的全部逻辑：`fillLocal` / `fillOnline` / `fill` / `batch` / `localBatch`、`chipByToken` / `chipFromString`、`normalizeCode`、`relaxQueries` / `plausible` / `brandSet` / `tidyVal` |
| `data/chip-tokens.json`（新增） | 只放**两张厂商官方 part number**（`QCS8550`→Snapdragon 8 Gen 2、`S5E8825`→Exynos 1380）。`T606` / `Maleoon 920C` **刻意不写** —— 现有数据里就有，避免双份维护 |
| `data/devicespec.js` | 新增 `ckey()`（保留标点的缓存键），`hardware()` 改用它；`mkey` 保留给宽松比对 |
| `server.js` | `/api/device/specs` 返回体新增 `chip` / `chipSrc` / `needFill`；新增 **`/api/device/fill`**（`models` 批量、`online` 默认 1、`force`、`limit 60`、`concurrency 3`）与 `/api/device/fill-stats` |
| `public/index.html` | `.d-devlist .dv` 改 `flex-column`；`.hd b` 去截断；新增 `.sub .chip` / `.chip.ol` / `.chip.none` / `.chip.wait` / `.gtag` / `.d-devlist-lg`；删除 `.bh-gate` 与 `#bhGate`；新增芯片徽标渲染 + 自动联网补全块 |
| `public/emulator.html` | 由 `tools/build-emulator-page.js` 重建（改主源必须重建派生页） |

### 关键：`kalvo` 只认营销名，不认内部代号

`MTN-NX3` 在 kalvo 搜出 **0 条**，所以第 ③ 级**必须传 A/B 级译出来的型号名**
（`Honor Magic8 Lite`），绝不能把原始代号丢过去。`fillLocal` 返回的 `market` 字段就是干这个的。

抓取仍走全项目共识：**`execFileSync('curl')`**（node `fetch`/`https` 对 kalvo 一律 403，TLS/JA3 指纹）。
认证需三个头同时带：`klv-lang: en` + `X-Requested-With: XMLHttpRequest` + `Referer: https://zh.kalvo.com/`
（缺 `klv-lang`→401，只有 XHR 没有 `klv-lang`→403）。**无需签名**。

---

## 六、回归

| 套件 | 结果 |
|---|---|
| 静态 12 套（alias-guard / date-norm / device-translate / emuhub / emulator-structure / mods / related-dl / saves-match / v1014 / v1016 / v1017 / **v1018**） | **831 条全绿**（v1018 = **92/92**） |
| `preview-v1018`（实拍，6 段） | **35 / 35** |
| `verify-online`（**线上**真机） | **24 / 24** |
| `test-v1015` | 62 / 62 |
| `test-search-ui` | 44 / 44 |
| `test-emulator-page` | 118 / 118 |
| `test-filter-layout` | 77 / 77 |
| **合计** | **1,191 条通过，0 失败** |

### 本轮新增的断言（都是「曾经错过一次」的地方）

- 防误配三道闸：`ZTE Blade A73`↔`Samsung Galaxy A73`、`Moto G20`↔`Moto G (2022)`、
  `Wiko Power U30`↔`Power U20`、`Redmi Note 13`↔`Xiaomi 13` 全判**不同台**；
  `Xiaomi POCO F7`↔`POCO F7`（子品牌交集）、`荣耀 Magic8 Lite`↔`Honor Magic8 Lite`（品牌表外，不误杀）判**同台**。
- `relaxQueries('motorola moto g(20)')` 的任何候选词都**不是** `moto g`（泛查询词回归锚点）。
- 不编造：完全未知机型返回 `chip === ''`；kalvo 查不到→接口 `ok:false`。
- 缓存键：`devicespec` 用 `ckey` 而非 `mkey`。
- 值清洗：多地区值末尾悬空 ` / ` 被清掉。
- 实拍：徽标只显示主名、完整值在 `title`、次行/页面**无横向溢出**、徽标**真占版面**（133×19）。
- **缓存写穿**：隔离缓存写 5 条 → 磁盘必须 5 条（防「只写前 N 条」的静默丢数据复发）。

### ⚠️ 同步修正的**预期变更**（不是退化）

`test-v1015` 有两条断言在 v10.18 必然失败，因为用户确认「门槛合并成徽标」：
`门槛小结行 .bh-gate 存在` / `门槛行文案讲清「更强的也能跑」`。
已改为断言**新行为**（`.gtag` 行内徽标存在 + `.bh-gate` 与 `#bhGate` **已删除** + 图例文案）。
**「预期变更」与「真退化」要分开判，前者同步改断言。**

---

## 七、已知边界（如实列出）

1. **2 台机型仍无芯片**：`Pocket FIT unknown`、`SM X706B`（本地译不出型号名 → kalvo 无从查起）。
   界面按设计显示灰色虚线徽标「未收录」，不编造。
2. **多地区机型只显示主名**：`SM S921B` 的完整值有 4 个地区版本，徽标只显示
   `Qualcomm Snapdragon 8 Gen 3`（第一个），完整值在 `title` 与展开面板里。
3. **联动数据现状**：`MobileModels` 库覆盖 8,261 个内部编号，但社区库里仍有 12 台拿不到译名
   （多为 `SM xxx` 三星代号 + 1 台 `Pocket FIT unknown`），这是上游收录问题，不是解析逻辑问题。

---

## 八、发布与线上验收（2026-09-18）

### 新链接

```
https://gamehub-agg-v2.app.workbuddy.host/
```

（sandbox `96805ba99b8b40ff840552084dc11217`，HTTP 服务形态，`npm install` + `node server.js`）

### 为什么又换链接：上次给的链接**根本没更新**

| 域名 | 实测 | 判定 |
|---|---|---|
| `gamehub-agg-join…`（**上次给你的**） | `/api/device/fill-stats` → **404**；`index.html` 里 `.chip.ol` / `联网查询中` / `gtag` **全无** | **停在 v10.17** |
| `36aa37e9…`（v10.10 那条旧链接） | `/api/device/fill-stats` → 200；`index.html` **md5 与本地逐字节一致** | 意外是 v10.18，但**未绑定本次发布环境** |
| `gamehub-agg-v2…`（**本次新建**） | 同上接口 200、`index.html` md5 与本地一致 | ✅ 正式入口 |

本次发布工具直接**拒绝**复用旧 app：`应用预留域名 gamehub-agg-join.app.workbuddy.host
未绑定到本次发布环境，为避免返回仍指向旧内容的链接，本次发布已停止` —— 这个拒绝是**对的**，
它挡住的正是「发布成功但链接还指着旧内容」这个假成功。按项目已有先例（v10.17 也是「域名无法重新绑定
只能新建 app」）新建了 `gamehub-agg-v2`，**链接变了**。

★ **判断「线上到底是哪一版」要比 md5，不能只看 HTTP 200**：
上面第二个域名 200 且内容正确，第三个域名 200 但内容是旧的 —— 只看状态码会得出完全相反的结论。

### ★ 顺手修掉验收脚本自己的 bug（两个，都会导致「假绿/假红」）

1. **默认链接没跟着发布走**（→ 假绿）。`tools/verify-online.js` 的 `BASE` 默认值还停在
   `gamehub-agg-join` —— 那个域名是 **v10.17**。也就是说它「老老实实验收了旧包」并全绿。
   **验收目标本身错了，比不验更危险。** 已改默认值，并在脚本头写明「换链接必须同步改这里」。
2. **断言选择器过范围**（→ 假红）。我把图例断言写成 `#bhDevSlot .d-devlist-lg`，但图例实际挂在
   `#bhSlot > .d-blk > h4 > .cnt` 里 —— **`#bhDevSlot` 是 h4 的兄弟容器，不是祖先**，所以查不到。
   已改为 `#bhSlot .d-devlist-lg`，并额外断言 `closest('h4')`（钉住「它属于表头」这个语义，
   而不只是「页面上存在」）。`preview-v1018` 同步加了一条同样的断言。

### 线上验收 24 / 24（`node tools/verify-online.js`）

| 组 | 关键断言 |
|---|---|
| 接口 6 条 | 机型库 8,261 个内部编号 · 清单 ≥9 台 · kalvo 从沙箱可达（81 行/12 组）· **v10.18 新接口已上线**（缓存 16 条 / 已补 14 / 联网 14）· `specs` 逐台带 `chip` · 本款确有本地查不到的机型 |
| 页面 7 条 | 12 个特征串齐 · 9 台机型 · `MTN NX3` → **`Honor Magic8 Lite`** · **无 JS 报错** · 无横向溢出 |
| 三要素 8 条 | ① 9 台全部带芯片徽标（宽高 57×19 / 85×19…，真占版面）② **全整显示无截断**（`scrollWidth ≤ clientWidth`，9 台全过）③ **`MTN NX3` 那台线上被补成 `Qualcomm Snapdragon 6 Gen 4`，徽标是靛蓝 `.chip.ol` + 「网」角标** · 联网补全全部收尾（无残留「联网查询中」）· 门槛行内徽标 + 表头图例 |
| 交互 3 条 | ★ 点一台真能展开硬件面板（**844px 高 / 650px 宽**，含 `Snapdragon 8s Gen 4` + `Adreno 825`） |

实拍：`_preview/live-devs.png`（清单 + 徽标）、`_preview/live-hw.png`（硬件面板）。
**线上 9 台机型 0 台「未收录」** —— 改前是 3 台。
