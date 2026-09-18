# CODEX-DONE v10.16 —— 手机机型「内部代号 → 品牌+型号」翻译 + 点击展开 kalvo 硬件参数

> **用户原话**：
> 「手机模拟器配置，https://khwang9883.github.io/MobileModels/ ，https://zh.kalvo.com/#upcoming
>   根据该链接进行匹配学习，然后前端显示品牌+型号 如：
>   `Xiaomi 25053PC47G` + `Snapdragon 8s Gen 4` → 显示 **xiaomi Poco F7**，
>   点击可以查看对应手机的硬件配置参数」
>
> **一句话结论**：全部落地。**用户举的那台已经在实拍里验证过**——
> 机型清单主行 `Xiaomi POCO F7`（副行 `25053PC47G`），点一下就地展开 kalvo 的 12 节硬件参数
> （芯片组 Snapdragon 8s Gen 4 / GPU Adreno 825 / 12GB / 6.83″ 120Hz / Android 15…）。

---

## 一、两个数据源怎么分工（本轮最核心的设计决策）

两个站点**能力完全不同**，硬用一个会把覆盖率做死：

| 源 | 能回答的问题 | 不能回答的 | 用法 |
|---|---|---|---|
| **MobileModels**（`khwang9883.github.io/MobileModels`，MIT） | 「`25053PC47G` 是哪台手机」→ **品牌 + 型号** | 没有任何硬件参数 | `brands/*.md` 全量抓下来做成**离线映射表** |
| **kalvo**（`zh.kalvo.com`） | 「POCO F7 的硬件参数」→ **完整规格表** | **只认营销名，喂内部代号查不到** | 实时查 → 落盘缓存 |

★ 这条「kalvo 不认内部代号」是**实测出来的**，也是整个链路能成立的前提：
所以前端必须把**译出来的型号名**（`data-hw`）传给 kalvo，**绝不能传原始代号**。
（`test-v1016` 里专门钉了一条断言：`没有错用原始代号当查询键`。）

---

## 二、效果对照（真实数据）

| 场景 | 改前 | 改后 |
|---|---|---|
| 用户举的例子 | `Xiaomi 25053PC47G` | **Xiaomi POCO F7**（副行小字留 `25053PC47G`） |
| 三星 | `SM-S928B` | **Samsung Galaxy S24 Ultra** |
| 机型清单主行 | 内部代号 | **品牌 + 型号**（代号降级到副行） |
| 想看硬件 | 得自己拿型号去别的站搜 | **点一下就地展开** kalvo 全量参数 |

**覆盖率（对机型库 1,044 台实测）**：

| 指标 | 数值 |
|---|---|
| 代号可译率（内部代号 → 品牌+型号） | **67.4%**（704 / 1,044） |
| 显示名被改善的比例（含本来就是营销名的） | **86.0%** |

---

## 三、MobileModels → `data/device-market.json`

**产物**：40 个品牌文件 / 11,500 行 / **8,261 个内部代号** / 3,938 个市场名 / 24 个品牌 / 3,239 条冲突（同代号多版本，按「文件内后出现的为准 + 记录 cur/prev」）

**解析器** `tools/fetch-device-market.js`：

- `parseMd()` 认两种行：`**[`O10U`] POCO F7 (`onyx`):**` 表头 + `` `25053PC47G`: POCO F7 国际版 `` 代号行
- `codeKey()` 归一（`SM-S928B` → `SMS928B`）、`brandOf()` 从文件名取品牌（`xiaomi_cn.md` → `Xiaomi`）
- `SKIP_FILES` 排除手表 / 电视等非手机品类

**⚠️ 本轮踩的坑（已修，写进断言）**：首跑 44 个文件里 **10 个下载失败**
（`curl: (35)/(56) Recv failure`，raw.githubusercontent 连接被重置）。
当时的写法是 `catch` 里静默 `continue` —— **结果就是映射表悄悄少掉 1/4，而脚本报成功**。
修法三件套：① `RETRY=5` 重试（`sleepSync`，Atomics.wait）② 拒收 < 200 字节的响应
③ **只要有文件失败就 `process.exitCode = 2` 并显式打出文件名**。重跑 → 40/40 全绿。

---

## 四、kalvo → `data/devicespec.js`

**认证（花了真时间，结论反直觉）**：`GET /ajax/search/?q=<名>` 需要**三个请求头同时带**：

| 带了什么 | 结果 |
|---|---|
| 只有 `X-Requested-With: XMLHttpRequest` | **403** |
| 只有普通过头（浏览器 UA） | **401** |
| `klv-lang: en` + `X-Requested-With` + `Referer: https://zh.kalvo.com/` | **200 JSON** ✅ |

- **必须带尾斜杠**：`/ajax/search`（无斜杠）→ 401，`/ajax/search/` → 200
- **不需要签名**。站点 `search.js` 里那套字符串数组 + base64 的混淆是**红鲱鱼**，
  先用 curl 三个头直连就通 —— 「先试纯 HTTP 直调，再考虑无头浏览器」这条经验再次生效
- 设备页解析：`div.specs > div.cont > h3 + table > tr > td`（td 是 key/value 成对），
  **解析前先把 `<br>` 换成 ` / `**——否则 `Cortex-A75` 与 `6x` 会粘成 `Cortex-A756x`（已修）
- 缓存 `data/device-specs.json`：**命中 30 天 / 未命中 3 天**，`force=1` 可绕过

**列表匹配 `pickBest()`**（修过一次）：
把 kalvo 返回结果里的品牌前缀剥掉，再按 **exact > prefix > contains（取最短）** 选。
第一版没剥前缀、也没取最短，导致查 `POCO F7` 时 **`POCO F7 Pro` 可能赢过 `POCO F7`**。

---

## 五、前端：从「显示代号」到「显示手机」

### 机型清单（`public/index.html`）

```html
<!-- 改前：一整行就是内部代号，用户认不出是哪台手机 -->
<div class="dv"><b>Xiaomi 2412DPC0AG</b>…

<!-- 改后：主行品牌+型号，代号降级成副行小字，整行是按钮 -->
<button class="dv" data-m="Xiaomi 2412DPC0AG" data-hw="Xiaomi POCO X7 Pro">
  <div class="hd"><b>Xiaomi POCO X7 Pro</b><em>684</em><u class="chev"></u></div>
  <div class="sub"><s>2412DPC0AG</s><i>Mali-G720 MC7</i></div>
</button>
```

- `data-m` 仍是**原始机型名**（查询键不能换，换了后端查不到）
- `data-hw` 是**译出来的型号名**，专门喂 kalvo
- 副行代号**剥掉重复的品牌前缀**（`Xiaomi 2412DPC0AG` → `2412DPC0AG`），少一次视觉噪音

### 点击展开硬件参数（`#bhHwSlot`）

`toggleDevHardware(btn)` → `GET /api/device/hardware?m=<data-hw>` → 就地展开：

- **默认只开 4 节**（基本信息 / 硬件配置 / 屏幕 / 电池），其余收进 `.hw-rest`，
  底部一个「展开全部（还有 N 节）」；**全开会到 1800px+**，一屏滚不完（实测默认 844px）
- 摘要行先给三个最关键的：**芯片组 / GPU / CPU 核心数**
- **互斥**：同时只有一台展开（`_hwOpen`），点另一台自动切
- **竞态保护**：`if (_hwOpen !== raw) return;` —— 切走之后迟到的响应直接丢弃
- 换游戏时 `_hwOpen = ''` 重置

### 派生页（`public/emulator.html`）

`tools/build-emulator-page.js` 重建同步；「机型兼容」分区的**两处**机型建议列表
（品牌下拉 + 输入即查）都改成 `disp || m.model`。

> **⚠️ 本轮真实漏改**：首版只改了「品牌下拉」那一路，**「输入即查」漏了**，
> 于是同一个下拉出现两副面孔——选品牌铺出来是 `Xiaomi POCO X7 Pro`，
> 手输 `2412DPC0AG` 铺出来还是代号。实拍新增断言时抓到（报的是「#dmBrand 没有可选项」，
> 查下去才发现是**两个独立渲染分支**）。现在断言里钉了 4 条，其中一条是
> 「没有『裸代号当主行』残留」，两边一起改才过。

---

## 六、服务端（`server.js`）

| 端点 | 作用 |
|---|---|
| `GET /api/device/market?code=` | 单个内部代号 → 品牌+型号（含 codename / variant） |
| `GET /api/device/market-stats` | 映射表规模（40 文件 / 8,261 代号 / 3,239 冲突） |
| `GET /api/device/hardware?m=&force=` | kalvo 硬件参数（**`m` 传译名**）；`force=1` 绕过缓存 |
| `GET /api/device/hardware-stats` | 缓存命中情况 |
| `GET /api/device/specs`（增强） | 顺带返回 `mkt`（**复用同一次批量取数**，避免 N+1） |
| `GET /api/device/models`、`/api/device/match`（增强） | 每条设备挂 `disp`（译名）；**`model` 原样保留**作为查询键 |

---

## 七、回归

| 套件 | 结果 |
|---|---|
| `tools/test-v1016.js`（**新增**，第 14 道防线） | **126 / 126** |
| `tools/preview-v1016.js`（**新增**，浏览器实拍） | **46 / 46** |
| `tools/preview-v1015.js` | 42 / 42（无退化） |
| 其余 12 套静态防线 | 全绿 |
| `tools/test-v1015.js` | 1 处断言按新结构更新（`.dv em` → `.dv .hd em`，**预期变更**） |

**实拍关键断言**（都能复现）：
`找得到用户举的那台 25053PC47G → 主行 Xiaomi POCO F7` ·
`面板 12 节 / 81 行键值 / 含 Snapdragon 8s Gen 4` · `点「展开全部」4 → 12 节，再点 12 → 4` ·
`同时只有一台展开` · `无横向溢出` · `两处建议列表都走译名`

---

## 八、文件改动清单

| 文件 | 改动 |
|---|---|
| `tools/fetch-device-market.js` | **新增** —— MobileModels 抓取 + 解析（重试 / 体积校验 / 失败退出码 2） |
| `data/device-market.json` | **新增** 1.36MB —— 8,261 个内部代号 → 品牌+型号 |
| `data/devicemarket.js` | **新增** —— `resolve()` / `cleanMarketing()` / `shortMarket()` / `resolveMany()` |
| `data/devicespec.js` | **新增** —— kalvo 查询 + 解析 + TTL 缓存 + `pickBest()` |
| `data/device-specs.json` | **新增** —— 硬件参数缓存 |
| `server.js` | 4 个新端点 + `/api/device/specs` 内联 `mkt` + `models`/`match` 挂 `disp` |
| `public/index.html` | 机型清单改按钮化（主行译名 / 副行代号 / 展开面板）+ `.d-hw` 系列样式 |
| `public/emulator.html` | 重建同步（295KB） |
| `tools/emulator-sections.js` | 「输入即查」分支补 `disp`（**本轮漏改点**） |
| `tools/preview-v1016.js` | **新增** —— 46 断言实拍（含「两处列表」与「分区懒加载要先切页签」） |
| `tools/test-v1016.js` | **新增** —— 126 断言，7 节 |
| `tools/test-v1015.js` | 1 条断言随结构变更同步 |
| `.gitignore` | 排除 `data/_mm-raw/`、`data/_kalvo-raw/`（原始响应不入库） |
| `tools/_probe-kalvo*.js` | 临时探针，用完**已删** |

---

## 九、遗留 / 未做

1. **可译率 67.4%，不是 100%** —— 剩下 32.6% 主要是：机型库里有相当比例**本来就是营销名**
   （`motorola moto g54 5G`），这些 `resolved=false` 但**显示是对的**（所以「显示被改善」有 86%）。
   真正的硬缺口是少数小众代工厂代号，MobileModels 未收录，**没有编造**。
2. **kalvo 是运行时实时抓**（未命中时），首次点击会比缓存命中慢；离线环境只会命中缓存。
3. **线上站点未重新发布** —— 静态改动不会自动同步，需重跑发布（复用同一 sandbox，链接不变）。
4. **GitHub 未提交** —— 本轮改动尚未 `git commit` / `git push`。
