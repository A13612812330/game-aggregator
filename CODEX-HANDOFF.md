# ⚠️ 本文已归档（停在 v10.1）—— 别再照着它干活

> ## ★ 归档说明（2026-09-18 补，v10.22 时）
>
> 本文是 **v10.1 时点的交接总览**（正文标题写的是「对应版本：v10」），
> 此后走了 **v10.2 → v10.22 共 21 个版本**，文中**任务清单（P0-x/P1-x/P2-x/P3-x）、
> 端口约定、质量基线（结构 45 条断言）、`emulator.html` md5 基线**全部已经变化。
>
> 保留它只为**历史可追溯**（「当时为什么这么排期」）。**当前状态一律以下面两份为准**：
>
> | 你要找什么 | 看哪里 |
> |---|---|
> | 当前版本 / 各版做了什么 | **`CODEX-INDEX.md`**（索引，最新置顶）+ `CODEX-DONE-vX.Y.md`（逐版完整说明） |
> | 界面与功能的当前形态 | `README.md` |
> | **当前分享链接** | `https://36aa37e911e6447eb86eb187240daff2.app.workbuddy.host/`（v10.22 起；**已弃用**：`gamehub-agg-v3` 停 v10.21 / `-v2` 停 v10.18 / `-join` 停 v10.17） |
> | 质量基线（当前是 **17 套 1097 条**） | `node tools/run-all.js`（一键跑，实测输出） |
>
> ⚠️ 下面正文里那些「已完成 / 剩余任务」的勾选状态**不要直接采信** ——
> 例如它列的剩余任务，在 `CODEX-INDEX.md` 的 v10.19 条目里已逐条核实过（36 条只余 2 条）。

---

> ## ★ v10.1 增量（2026-09-14）—— 先看这段（⚠️ 本文整体已归档，见上）
> 本轮已由我完成 **P0-3 / P0-2 / P1-1 / P1-6** 四项，**变更说明见 `CODEX-DONE-v10.1.md`**。
> 因此本文以下内容**已过时，请以 DONE 文档为准**：
> - 「位置固定表」的端口：已统一为单一真源，源码中 `grep 3456` **零命中**
> - 第 8 节「已知的坑」里的**死端口常量**一项：**已修**
> - 质量基线：结构 **45 → 53**（+8 条断言）；`emulator.html` md5 基线变为 `5815e9d6…`
> - 第 P0-3 / P0-2 / P1-1 / P1-6 条：**已完成，勿重做**
>
> 剩余任务：**P0-1 · P1-4 · P2-1 · P2-2 · P2-5 · P3-1 · P3-4**

# GameHub 游讯聚合站 · Codex 交接总览

> **盘点时间**：2026-09-14 11:00 ｜ **对应版本**：v10（手机专区 5 页签）
> **项目根目录**：`E:\新建文件夹\WorkBuddy\2026-09-03-16-11-58\game-aggregator`
> **服务地址**：`http://127.0.0.1:8123/`
> **本文用途**：把项目全貌（位置 / 技术 / 文件职能 / 端口约定 / 优化建议）一次性交给 Codex 接手优化
> **配套文件**：`CODEX-TASKS.md`（可直接复制粘贴的任务 prompt 集）

---

## 0. 30 秒速览

| 项 | 值 |
|---|---|
| 服务端口 | **8123**（固定）—— `server.js:961` |
| 前端入口 | `public/index.html`（**唯一编辑入口**）→ 派生 `public/emulator.html` |
| 启动器 | `启动聚合站.bat`（项目根，双击即用） |
| 启动命令 | `node server.js` 或 `npm start` |
| 技术栈 | Node.js 22 + Express 4 + 零框架原生前端（无构建步骤） |
| 数据存储 | JSON 文件 + 内存 Map（**无数据库**） |
| 测试基线 | 结构 45/45 · 行为 96/96 · 别名护栏 7/7 |
| 版本控制 | **⚠️ 无 git**（改动前必须手动备份） |
| 自动化 | WorkBuddy 每日 09:30「GameHub 内容库每日自动同步」7 步 |

**一句话定位**：一个**只聚合情报、永不提供下载**的单机游戏聚合站；从 v7 起长出一条「**用安卓手机跑 PC 游戏**」的主线。

---

## 1. 项目说明与运用场景

### 1.1 定位

基于两个源站构建的单机游戏信息聚合站：

- **XDGAME** —— `xdgame.com`（列表/详情）与 `xdgamer.com`（官网热度榜）
- **机地** —— `jidiyouxi.com`（社区/榜单/新游）

> ⚠️ **`xdgame.com` 与 `xdgamer.com` 是两套内容独立的平行站，同 ID ≠ 同游戏**。
> 库数据全部属于 `xdgame.com` 域。v1 曾因混拼导致 14,919 条详情错位，已修复 —— **别踩回去**。

### 1.2 三条业务线

| 线 | 面向 | 内容 |
|---|---|---|
| **A. 端游情报线** | 找游戏 | 热榜（周/月/全站/社区四档）· 最新收录 · 分类浏览 · 详情抽屉 |
| **B. 手机专区线** | 手机跑 PC 游戏 | 手游中心 · **修改器** · **云存档** · 模拟器指南 · 机型兼容（**5 页签**） |
| **C. 数据工具线** | 决策依据 | 社区配置库 · 实测配置库 · 机型库 · 芯片规格库 · Turnip 驱动看板 |

### 1.3 典型运用场景

**场景一：我想在手机上玩《艾尔登法环》，需要什么？**

```
首页搜索「艾尔登法环」
  → 手游中心「#emu」页签：查出有没有人跑过、跑多少帧、什么机型
  → 模拟器指南「#eg」页签：查我这个芯片（如 8gen3）该装哪个 Turnip 驱动
  → 修改器「#tr」页签：查有没有修改器、去哪拿
  → 云存档「#sv」页签：查存档落在哪个目录（可跨设备搬档）
  → 机型兼容「#dm」页签：查我的手机型号能不能跑
```

**场景二：我只想看看最近有什么新游戏** → 首页热榜舞台 + 最新收录流。

**场景三：这个游戏手机能玩吗** → 首页卡片容量区间 + 「仅手机可玩」过滤。

### 1.4 硬约束（不可违反）

- ❌ **永不出现下载入口**（不展示下载按钮 / 磁链 / 网盘文案）
- ✅ 源站详情**一律外链新窗口**，不做 iframe 内嵌
- ✅ 每个条目**必须带来源角标**（机地红 `#E6415D` / XDGAME 蓝 `#0B7BFF`）
- ✅ 详情抽屉内始终展示「本站仅聚合信息，不提供任何下载」声明

---

## 2. ★ 位置固定表（用户明确要求）

### 2.1 运行三要素

| 类别 | 固定值 | 绝对路径 / 位置 |
|---|---|---|
| **服务器端口** | **`8123`** | 硬编码于 `server.js:961`：`listen(parseInt(process.env.PORT, 10) \|\| 8123, 30)` |
| **前端主源** | `index.html` | `game-aggregator\public\index.html`（136 KB / 2,000 行） |
| **前端派生页** | `emulator.html` | `game-aggregator\public\emulator.html`（203 KB / 3,262 行，**勿手改**） |
| **启动器** | `启动聚合站.bat` | `game-aggregator\启动聚合站.bat`（自动找 node → 起服务 → 开浏览器） |
| **服务端入口** | `server.js` | `game-aggregator\server.js`（961 行 / 44 KB） |
| **生成器** | `build-emulator-page.js` | `game-aggregator\tools\build-emulator-page.js` |
| **分区驱动** | `emulator-sections.js` | `game-aggregator\tools\emulator-sections.js`（937 行 / 44 KB） |

### 2.2 ★⚠️ 端口的两处写法不一致（需要修）

```js
// server.js:14   ← 死常量，从未被使用，会误导接手者
const PORT = process.env.PORT || 3456;

// server.js:961  ← 真正生效的一行
listen(parseInt(process.env.PORT, 10) || 8123, 30);
```

**现状**：`PORT` 常量声明后**全程未被引用**（`listen()` 用的是自己的内联表达式）。
**风险**：接手者读到第 14 行会以为端口是 3456，排查半天。
**建议**：删除第 14 行，或改为单一真源 `const PORT = parseInt(process.env.PORT, 10) || 8123;` 并在 961 行复用。

### 2.3 其他固定位置

| 类别 | 路径 |
|---|---|
| 数据目录 | `game-aggregator\data\`（16 个 JSON + 11 个 .js 索引模块） |
| 抓取器 | `game-aggregator\fetchers\`（6 个文件） |
| 工具脚本 | `game-aggregator\tools\`（19 个脚本） |
| 文档（项目内） | `game-aggregator\README.md` · `HANDOFF.md` · `DESIGN.md` |
| 交付说明归档 | `E:\新建文件夹\WorkBuddy\2026-09-03-16-11-58\.workbuddy\artifacts\` |
| 工作日志 | `game-aggregator\.workbuddy\memory\YYYY-MM-DD.md` |
| 外部源码缓存 | `game-aggregator\.cache\ludusavi-manifest.yaml`（17 MB，云存档源，勿删） |
| 归档 | `game-aggregator\_archived\`（v1 四页 + v2/v3 首页备份） |
| 第三方依赖 | `game-aggregator\node_modules\`（138 个包） |

---

## 3. 技术栈与运用场景

### 3.1 后端

| 项 | 内容 |
|---|---|
| 运行时 | Node.js **v22.22.2**（managed：`C:\Users\komo\.workbuddy\binaries\node\versions\22.22.2-2\node.exe`） |
| 模块制式 | CommonJS（`package.json` → `"type":"commonjs"`） |
| 框架 | **Express 4.22.2** |
| 依赖 | `cheerio` 1.2.0（HTML 解析）· `express` 4.22.2 · `js-yaml` 5.4.1（解析 Ludusavi 清单） |
| devDeps | `jsdom` 30.0.1（行为回归测试）· `puppeteer-core` 25.10.0（机地深度搜索，驱动本机 Edge CDP） |
| 数据库 | **无**。JSON 文件 + 内存 `Map`，`gamesDb.js` 负责防抖落盘与增量 `upsert` |
| 缓存 | 内存 TTL：feed 180s · detail 600s · hots 600s · rank 1800s · category 300s |
| 安全 | SSRF 域名白名单（`xdgame` / `xdgamer` / `jidiyouxi`） |
| 路由 | 约 **60 个**端点（见第 7 节） |

**运用场景**：作为纯数据服务层 —— 抓取/解析源站、维护本地库、把 JSON 数据以 REST 接口吐给前端。无模板引擎，不含任何 SSR 页面（除 `/snapshot.html` 快照生成）。

### 3.2 前端

| 项 | 内容 |
|---|---|
| 形态 | **零框架、零构建**：原生 HTML + 内联 CSS + 内联 JS（全在单文件内） |
| 架构 | **单源双页** —— `index.html` 是唯一编辑入口，`emulator.html` 由生成器派生 |
| 主题 | 浅色情报台 + 唯一深色 hero（深蓝紫渐变 + 网点纹理）；全部颜色走 CSS 变量 |
| 布局 | 容器 1180px；首页双栏（主列 + 340px 侧栏）；手机专区 5 页签切换条 |
| 交互 | 搜索弹窗（`Ctrl+K` / `/`）· 详情抽屉（480px 右滑）· 骨架屏 · toast · 深链 hash |
| 响应式 | 断点 1200 / 1024 / 768；≤760px 切换条收起数字胶囊以容纳 5 页签 |
| 设计规范 | 见 `DESIGN.md`（**注意：内容滞后，见第 9 节**） |

**运用场景**：单页应用体验 —— 首屏直出结构（不靠 JS 渲染首屏结构），JS 仅做交互增强。

### 3.3 ★ 单源双页架构（最重要的工程约束）

```
public/index.html  ──[node tools/build-emulator-page.js]──▶  public/emulator.html
     （主源 / 唯一编辑入口）                                      （派生页 / 勿手改）
```

- 生成器**幂等**：连跑三次 md5 必须一致
- 改任何**共享资产**（CSS / 顶栏 / 抽屉 / 通用脚本）→ **只改 `index.html`** → 重跑生成器
- 直接改 `emulator.html` → 下次重建**被覆盖**
- 幂等哨兵：`const SEC_SENTINEL = /function initEmu\s*\(/;`（锚在长期存在的符号上）

### 3.4 数据栈

| 数据 | 文件 | 规模（2026-09-14 实测） |
|---|---|---|
| 端游本地库 | `data/games.json`（5.8 MB） | **15,268 款**（XDGAME 15,210 + 机地 58） |
| 手游中心合并 | `data/mobilehub.json`（1.5 MB） | **3,161 款** / 匹配端游 1,522（48.1%） |
| 社区配置索引 | `data/bannerhub.json`（451 KB） | **2,624 款 / 14,230 配置** / 1,496 机型 / 91 GPU |
| 社区配置明细 | `data/bannerhub-files.json`（1.8 MB） | 懒加载，不进首包 |
| 实测配置 | `data/phonecfg.json`（823 KB） | **1,037 条 / 1,025 款** / 可玩 543 |
| **修改器** | `data/trainers.json`（1.3 MB） | **3,589 条** / 5 来源 / 命中端游库 73.7% |
| **云存档** | `data/saves.json`（5.2 MB） | **5,741 款 / 13,097 路径** / 手机能玩 1,117 |
| 机型库 | `data/soc-db.json` + `device-board.json` | 1,030 机型 / 17 品牌；芯片 1,444 / 44 厂商 |
| 别名表 | `data/cn-names.json` + `mobilehub-names.json` | 143 + 344 条 |

### 3.5 测试栈（三层防线）

| 层 | 文件 | 抓什么 | 当前 |
|---|---|---|---|
| 1 | 生成器内 `throw` | 常量残留 / 分区 DOM 丢失 / 漏 `data-et` / CSS 泄漏 / 重复注入 | — |
| 2 | `tools/test-emulator-structure.js` | 死 CSS / 废弃 id / 重复注入 / 漏 init（静态正则） | **45/45** |
| 3 | `tools/test-emulator-page.js` | 点得动：切换 / 深链 / 渲染 / 点击分流（jsdom） | **96/96** |
| 附 | `tools/test-alias-guard.js` | 别名护栏黑盒（该拦的拦住、该放的放行） | **7/7** |

---

## 4. ★ 文件功能字典

### 4.1 根目录

| 文件 | 体积 | 功能 |
|---|---|---|
| `server.js` | 44 KB | ★ Express 主服务：抓取调度 + 内存缓存 + SSRF 白名单 + **约 60 个路由** + `/snapshot.html` 快照生成 |
| `启动聚合站.bat` | 475 B | ★ Windows 一键启动（自动探测 node 路径 → 起服务 → 打开浏览器） |
| `shared.js` | 1.7 KB | 抓取公共工具：UA 常量 / `getHtml()`（超时+重试）/ `abs()` 补全 URL / 相对时间 `ts2label()` |
| `package.json` | 339 B | 依赖与脚本（`start` / `probe`） |
| `probe.js` / `probe2.js` | 4.9 / 4.6 KB | **开发用** DOM 结构探测器（分析源站页面结构，非运行时依赖） |
| `README.md` | 71 KB | ★ **完整技术文档**（v10 章节在顶部，含数据源调研 / 命令 / 接口 / 边界） |
| `HANDOFF.md` | 24 KB | ★ **交接文档**（架构 / 流水线 / API 一览 / 已知的坑 / 优化方向 / 接手 checklist） |
| `DESIGN.md` | 7.4 KB | 页面设计规范（配色 / 排版 / 组件 / 布局 / 响应式 / AI 提示指南）——**内容滞后** |
| `_preview-cards.html` / `.js` | 70 / 3.9 KB | 轮 19 的「合并卡」单页预览（**非运行依赖，可删**） |
| `_archived/` | — | v1 四页备份 + v2/v3 首页快照（可还原） |

### 4.2 `public/`（前端）

| 文件 | 体积 | 功能 |
|---|---|---|
| `index.html` | 137 KB | ★ **前端主源 / 唯一编辑入口**：聚合首页（热榜舞台 + 最新收录 + 搜索弹窗 + 详情抽屉） |
| `emulator.html` | 203 KB | ★ **派生页**：手机专区（5 页签）—— **由生成器产出，勿手改** |
| `*.bak-v92` | 121 / 171 KB | v9.2 时期备份 |

### 4.3 `data/`（数据 + 索引模块）

**索引模块（.js，服务启动时加载 → 改动后必须重启服务）**

| 文件 | 功能 |
|---|---|
| `gamesDb.js` | 端游本地库：内存 `Map` + JSON 持久化 / `upsert` / `search` / `browse` / `byIdGet` / `sizeGb` |
| `bannerhub.js` | 社区配置库归一化匹配（**96.9% 命中率，很稳，别乱动**） |
| `phonecfg.js` | 实测配置库索引 + `libKeys` 匹配（保留 CJK 的钥匙，与 bannerhub 分开写） |
| `mobilehub.js` | ★ 手游中心合并索引读取（`list` / `stats` / `lookup` / `ensure` / `normKey`） |
| `trainers.js` | ★ 修改器索引层（`list` / `stats` / `lookup` / `byLib`，默认只出 `libId` 非空） |
| `saves.js` | ★ 云存档索引层（`list` / `stats` / `lookup` / `byLib` / `byKey`，默认 phone 优先） |
| `emuguide.js` | 模拟器指南知识源（五层栈 / 芯片驱动 / 包装器 / 优化 / 避坑 / 帧率，**纯静态常量**） |
| `gpu-tier.js` | GPU 性能层级表（93 型号 → 统一性能分，跨厂商同量纲） |
| `device-match.js` | 机型兼容匹配引擎（机型 → GPU → 可跑游戏，向下兼容推断） |

**数据文件（.json）**

| 文件 | 体积 | 内容 |
|---|---|---|
| `games.json` | 5.8 MB | 端游全量库 15,268 款（双源同构条目） |
| `saves.json` | 5.2 MB | 云存档 5,741 款 / 13,097 路径 |
| `bannerhub-files.json` | 1.8 MB | 社区逐条配置明细 14,230 条（懒加载） |
| `mobilehub.json` | 1.5 MB | 手游中心合并索引 3,161 款 |
| `trainers.json` | 1.3 MB | 修改器 3,589 条 |
| `phonecfg.json` | 823 KB | 实测配置 1,037 条 |
| `_gcm-raw.json` | 808 KB | 修改器接口原始落盘（中间产物，可删） |
| `bannerhub.json` | 451 KB | 社区配置聚合索引 |
| `soc-db.json` | 419 KB | 芯片规格 1,444 款 / 44 厂商 |
| `index-state.json` | 194 B | ★ 索引断点/校准/机地同步状态（**重启不丢，可续跑**） |
| `bannerhub/` | 目录 | 仓库快照 `raw/{games,devices,recent}.json` + `filelist.txt` |
| `cn-names.json` | 9 KB | 中英别名表 143 条 |
| `mobilehub-names.json` | 15 KB | 联网补名别名表 344 条 |
| `mobilehub-names.progress.json` | 30 KB | 补名断点文件（可续跑） |
| `device-board.json` | 20 KB | 主板代号 → SoC/CPU 200 条 |
| `turnip.json` | 13 KB | Turnip 驱动构建看板 |

### 4.4 `tools/`（19 个脚本）

**构建 / 生成（改数据后跑）**

| 脚本 | 功能 |
|---|---|
| `build-emulator-page.js` | ★ **由 `index.html` 派生 `public/emulator.html`**（幂等，含 `SECTIONS` / `TRAINERS_HTML` / `SAVES_HTML` 骨架常量） |
| `emulator-sections.js` | ★ **不要把这份当构建脚本** —— 它被生成器**内联吃进派生页**。内含 5 个分区驱动：`initEmu`（手游中心）/ `initTr`（修改器）/ `initSv`（云存档）/ `initEg`（指南）/ `initDm`（机型兼容）+ 卡片渲染 `emuCard`/`trCard`/`svCard` + 配置面板 `openBhPanel`/`openPcPanel` |
| `build-mobilehub.js` | 合并社区库 + 实测库 → `mobilehub.json`（含数字一致性护栏 `numConflict`） |
| `build-bannerhub.js` | 由仓库快照生成 `bannerhub.json` / `bannerhub-files.json` |
| `build-phonecfg.py` | 由《基础测试数据.xlsx》生成 `phonecfg.json`（Python + openpyxl） |
| `build-saves.js` | ★ **流式**解析 Ludusavi 17 MB YAML → `saves.json`（`collectMatched()` 只缓存命中块 + 占位符人性化） |
| `fetch-trainers.js` | ★ 采集修改器公开接口 → `trainers.json`，按 `/` 切段匹配端游库（`buildLibIndex()` 是正确写法样板） |
| `fetch-sources.js` | 抓取 soc-db / device-board / turnip 三源落盘 |
| `clean-excel.py` | 清洗《基础测试数据.xlsx》→ 拼音排序 + 黄/橙底标注 |

**刷新（拉外部源）**

| 脚本 | 功能 |
|---|---|
| `refresh-bannerhub.js` | 纯 Node 版 BannerHub 刷新（服务端 `spawn` 调用，支持 `--json`） |
| `refresh-bannerhub.sh` | 重新拉仓库快照并重建索引（走 **codeload**，非 git clone —— 本机 github 主站被拦） |
| `refresh-sources.sh` | 刷新外部数据源（含重启提示；turnip 建议每周） |

**联网学习**

| 脚本 | 功能 |
|---|---|
| `learn-cn-names.js` | 联网查 Steam 官方中英名 → `cn-names.json`（含三重防误配） |
| `learn-mobilehub-names.js` | ★ 未命中项联网补名（Steam 官方 API + 跨语言桥 `l=english`；含 `REQ_TIMEOUT` / `SAVE_EVERY` / 断点续跑三道护栏） |

**测试 / 统计**

| 脚本 | 功能 |
|---|---|
| `test-emulator-structure.js` | ★ 静态结构体检（**45 项**） |
| `test-emulator-page.js` | ★ jsdom 行为回归（**96 项**，需服务已跑在 8123） |
| `test-alias-guard.js` | 别名护栏黑盒（7 项） |
| `stat-match.js` | 统计匹配率与别名命中抽样 |
| `test-emuhub.js` | 已废弃，转调 `test-emulator-page.js`（保留兼容旧命令） |

### 4.5 `fetchers/`（源站解析器）

| 文件 | 功能 |
|---|---|
| `jidi.js` | 机地：热榜 / 收录匹配 / 详情（`libraryCandidates()` 生成 `jidi-` 前缀条目） |
| `jidiHeadless.js` | 机地深度搜索（`puppeteer-core` 驱动本机 Edge CDP，**可选加载**） |
| `xdgamer.js` | XDGAME：今日更新 / `detail(id, host)` / 站内搜索 / 分类页 |
| `xdrank.js` | XD 官网官方热度榜（首页 `.hot-soft` 三档 SSR → `/api/rank`） |
| `indexer.js` | XDGAME 全量列表索引器（分页抓取 → `gamesDb`，支持断点续跑） |
| `aliases.json` | 搜索别名词典（`法环` → `艾尔登法环`…） |

---

## 5. 数据流水线

```
【端游库】
XDGAME 官网 list_{n}.html ──┐
                            ├─▶ games.json（15,268 款）
机地首页+热榜话题        ──┘

【手机专区】
BannerHub 仓库  ──▶ bannerhub.json + bannerhub-files.json（2,624 款 / 14,230 配置）
《基础测试数据.xlsx》 ──▶ phonecfg.json（1,037 条）
                                  │
                                  ▼
                    ★ build-mobilehub.js（合并去重）
                                  ▼
                    mobilehub.json（3,161 款）
                                  │
              learn-mobilehub-names.js（联网补名）
                                  ▼
                    mobilehub-names.json（344 条别名，回喂 build-mobilehub）

【v10 新增】
gamezonelabs.com/api/data/gcm ──▶ fetch-trainers.js ──▶ trainers.json（3,589 条）
ludusavi-manifest（.cache 17MB）──▶ build-saves.js ──▶ saves.json（5,741 款）

【机型线】
vitkuz573/soc-db + xTheEc0 ──▶ soc-db.json / device-board.json
Mesa Turnip releases       ──▶ turnip.json
        │
        ▼
gpu-tier.js（93 型号性能分）──▶ device-match.js（向下兼容推断）──▶ /api/device/match
```

### 自动化

**WorkBuddy 定时任务「GameHub 内容库每日自动同步」—— 每天 09:30，共 7 步：**

| 步 | 动作 | 命令 / 接口 |
|---|---|---|
| ① | XD 增量 | `POST /api/library/index/incr?pages=10` |
| ② | BannerHub 社区配置库刷新 | `POST /api/bh/refresh` + 轮询 `/api/bh/refresh/state` |
| ③ | 实测配置库重建 | `python tools/build-phonecfg.py` |
| ④ | 机地话题同步 | `POST /api/library/index/jidi` |
| ⑤-⑦ | 汇报三套库规模 | 服务离线自动拉起 |

> ⚠️ **未纳入自动化的三条（优化项）**：`build-mobilehub.js`、`fetch-trainers.js`、`build-saves.js`
> ⚠️ `emuguide.js`（模拟器指南）是静态知识库，**不参与自动化**，需人工按需更新

### 外部数据源刷新节奏

| 源 | 节奏 | 方式 |
|---|---|---|
| XDGAME 增量 | 每日 | 自动化 ① |
| BannerHub | 每日 | 自动化 ②（约 3 s，热加载无需重启） |
| 实测 Excel | 源表更新时 | 手动 `build-phonecfg.py` |
| soc-db / device-board | 不定期 | `node tools/fetch-sources.js` |
| Turnip 看板 | **每周** | `bash tools/refresh-sources.sh` |
| 修改器 / 云存档 | **当前未纳入** | 手动 `fetch-trainers.js` / `build-saves.js` |

---

## 6. API 清单（约 60 个端点）

### 6.1 聚合 / 端游库

| 端点 | 说明 |
|---|---|
| `GET /api/health` | 存活检查 |
| `GET /api/feed?refresh=1` | 聚合两源最新条目（缓存 180s） |
| `GET /api/detail?url=&refresh=1` | 源站详情实时解析（缓存 600s；域名白名单） |
| `GET /api/search?q=&mode=headless` | 跨站搜索（`mode=headless` 走机地深度搜索） |
| `GET /api/hots` | 机地周/月/年热榜（缓存 600s） |
| `GET /api/rank?p=week\|month\|year\|community` | ★ 双热度合并榜（首页主体） |
| `GET /api/category?c=dzmx` | XDGAME 分类列表（13 类） |
| `GET /api/library/stats` | 本地库总量 / 按源统计 |
| `GET /api/library?q=&sizeMin=&sizeMax=&bh=1` | 本地库搜索（别名展开 + 容量区间 + 仅手机可玩） |
| `GET /api/library/browse?g=&sort=&sizeMin=&sizeMax=&bh=1` | 分类浏览（首页主干） |
| `GET /api/library/recent?limit=18` | 最近收录 |
| `GET /api/library/go?q=` | 取最匹配一条 |
| `GET /api/library/item?id=xd-3887` | 按 id 取单条 |
| `GET /api/library/index/state` | 索引状态（断点/校准/机地同步） |
| `POST /api/library/index?start=&end=` | 手动页码范围（调试） |
| `POST /api/library/index/incr?pages=10` | 增量更新 |
| `POST /api/library/index/calibrate` | 校准 / 断点续跑 |
| `POST /api/library/index/jidi` | 机地双源合并 |
| `GET /api/library/progress` | 任务进度 |
| `GET /snapshot.html` | 现场抓取快照（可另存离线用） |

### 6.2 社区配置库（BannerHub）

| 端点 | 说明 |
|---|---|
| `GET /api/bh/stats` | 概览（2,624 款 / 14,230 配置 / 1,496 机型 / 91 GPU） |
| `GET /api/bh/list?q=&sort=&gpu=&libOnly=1` | 列表（`libOnly=1` 降噪到能对上本地库的） |
| `GET /api/bh/match?t=` | 按标题反查 |
| `GET /api/bh/configs?k=` | ★ 某游戏逐条配置（机型/GPU/日期/下载直链） |
| `POST /api/bh/refresh` | 刷新配置库（spawn，热加载无需重启） |
| `GET /api/bh/refresh/state` | 刷新任务状态（`ok` 恒 true，**成败看 `lastOk`**） |

### 6.3 实测配置库

| 端点 | 说明 |
|---|---|
| `GET /api/pc/stats` | 概览（1,037 条 / 1,025 款 / 可玩 543） |
| `GET /api/pc/list?q=&chip=&tier=&ok=1` | 列表（机型 + 帧率档筛选） |
| `GET /api/pc/match?t=&t2=` | 反查聚合（支持双候选名） |
| `GET /api/pc/records?k=` | ★ 某游戏全部实测记录（逐条帧率/备注/主程序） |

### 6.4 手游中心 / 统一搜索

| 端点 | 说明 |
|---|---|
| `GET /api/mobilehub/stats` | 概览（3,161 款 / 匹配 1,522 / 配置 14,998 / 实测 1,037） |
| `GET /api/mobilehub/list?q=&sort=both\|configs\|records\|fps\|name&gpu=&tier=&stats=all` | 合并列表（默认 `sort=both` + 只返匹配端游的） |
| `GET /api/mobilehub/match?t=` | 反查单款 |
| `GET /api/search/all?q=&limit=` | ★ **全站统一搜索，4 分组** `{pc, mobile, trainer, save}` |

### 6.5 ★ v10 新增（修改器 / 云存档）

| 端点 | 说明 |
|---|---|
| `GET /api/tools/stats` | 两个板块汇总 |
| `GET /api/trainers/stats` | 改的器概览（3,589 / 匹配 2,644 / 73.7% / 5 来源） |
| `GET /api/trainers/list?q=&source=&stats=all` | 列表 |
| `GET /api/trainers/match?t=` | 反查（**含子串检索兜底**） |
| `GET /api/saves/stats` | 云存档概览（5,741 / 13,097 路径 / 1,117 手机能玩） |
| `GET /api/saves/list?q=&stats=all&sort=` | 列表 |
| `GET /api/saves/match?t=` | 反查（**含子串检索兜底**） |

### 6.6 指南 / 机型兼容

| 端点 | 说明 |
|---|---|
| `GET /api/emuguide` | 指南全文（五层栈/芯片驱动/包装器/优化/避坑/帧率） |
| `GET /api/emuguide/chip?c=8gen3` | 芯片 → 推荐驱动（未知返回 `hit:false`） |
| `GET /api/device/stats` | 机型库规模（17 品牌 / 1,030 机型） |
| `GET /api/device/brands` | 品牌列表 |
| `GET /api/device/models?brand=&q=` | 机型列表（带 `gpu` + `score`） |
| `GET /api/device/match?model=` | ★ 机型 → 可跑游戏（带 `verdict` + `minGpu`） |
| `GET /api/device/chip?q=` | 芯片规格（1,444 款 / 44 厂商） |
| `GET /api/device/turnip` | Turnip 驱动构建看板 |

---

## 7. 质量基线（改动前必须确认是绿的）

```bash
cd "E:/新建文件夹/WorkBuddy/2026-09-03-16-11-58/game-aggregator"

curl -s http://127.0.0.1:8123/api/health        # 服务在跑？
node tools/test-emulator-structure.js           # 期望 45/45
node tools/test-emulator-page.js                # 期望 96/96
node tools/test-alias-guard.js                  # 期望 7/7

# 幂等基线（改动前先记下来）
md5sum public/emulator.html                     # 当前 09916f1fcb071ff59f5a83ef1a0d0420
node tools/build-emulator-page.js
md5sum public/emulator.html                     # 必须与上面一致
```

| 项 | 当前值（2026-09-14） |
|---|---|
| 结构体检 | **45 / 45** |
| 行为回归 | **96 / 96**（需服务在 8123） |
| 别名护栏 | **7 / 7** |
| `public/emulator.html` md5 | `09916f1fcb071ff59f5a83ef1a0d0420` |
| `public/index.html` md5 | `4cb87f3c46b8d9f2a77e7bf356259901` |
| 依赖数 | 138 包 |

---

## 8. ★ 已知的坑（改代码前必读）

### 8.1 生成器 11 个坑（`build-emulator-page.js`，**都已修，别踩回去**）

| # | 坑 | 后果 |
|---|---|---|
| 1 | `cut(lines,a,b)` **含两端行** | 追加内容落到 `<script>` 外成裸文本 |
| 2 | 非贪婪 `[\s\S]*?\n\}\)\(\);` **提前收尾** | 吞掉后面整块 |
| 3 | 拼接顺序必须 **SECTIONS → TAB** | TDZ 报 `Cannot access 'pcState'` |
| 4 | 派生页缺主源独有 DOM 依赖 | `addEventListener of null` 中断整段脚本 |
| 5 | head **从派生页自己截** → 假幂等 | 每跑一次涨一份 CSS（曾涨到 877 KB / 9 个 `<style>`） |
| 6 | 派生页**新增分区**必须进生成器常量 | 重跑后被覆盖消失 |
| 7 | 替换块**改写法**后正则静默失配 | 主源常量残留 → 整页 JS 崩 |
| 8 | 分区骨架**从派生页自身截取** | `findLine` 返回 `-1` → `cut` 静默返回空串 → **错误被幂等地固化成正常状态** |
| 9 | `main[data-et].et-hide{display:none}` 是**属性选择器** | 缺 `data-et` 则完全没生效；但 `classList.contains('et-hide')` 仍返 true → **只断言 class 的测试全绿，浏览器里啥都没发生** |
| 10 | 幂等哨兵锚在「会被删掉的函数名」上 | 重建后重复注入整份 SECTIONS_JS → `Identifier 'EMU_PAGE_SIZE' has already been declared` 整页崩 |
| 11 | 用 `npm install --save X` | 会**静默剪掉**「在 node_modules 但没写进 package.json」的包（本次 jsdom/puppeteer-core 被删，114→93 包） |

> **两条铁律**：
> ① 凡是生成器要重写的文件，**其中内容不能反过来当下一次生成的输入源**；
> ② 幂等哨兵**永远锚在「长期存在的符号」上**。

### 8.2 运行时坑

| 坑 | 说明 |
|---|---|
| **改 `data/*.js` 只读索引后必须重启服务** | 索引在启动时加载，不重启不生效 |
| `bannerhub.js` 的 96.9% 命中率很稳 | **不要动它**（CJK 匹配另写在 `phonecfg.js` 的 `libKeys`） |
| **端游库标题是「中文/英文/别名」斜杠拼接串** | `艾尔登法环/ELDEN RING` —— **必须按 `/` 切段入索引**，否则匹配率从 73.7% **假跌到 2%** |
| 云存档清单必须**流式**过滤 | 别改成 `yaml.load` 整份解析，17 MB / 33 万行会吃爆内存 |
| 修改器**不提供下载直链**（有意为之） | GCM 走一次性 S3 签名 URL，依赖仓库外 `secret_config`，无法离线复现 —— **别试图绕过** |
| `xdgame.com` ≠ `xdgamer.com` | 同 ID 不同游戏，混拼会详情错位 |
| **匹配率天花板约 48% 是数据问题不是 bug** | 手游库偏老游戏/小体积，端游库偏近两年 3A —— **方向是扩端游库，不是调算法** |
| 测试桩两个坑 | ① `beforeParse` 阶段 `w.fetch` 尚未定义；② 解构出 fetch 再调用会丢 `this` |
| Edge CDP 直连可用 | `--remote-debugging-port` + WebSocket 可通；puppeteer 默认路径不可用 |
| **无 git 兜底** | 任何破坏性操作前**先手动备份** |

---

## 9. 文档滞后清单（建议一并修）

当前三份文档存在与实际不一致的地方，容易误导接手者：

| 文档 | 滞后项 | 实际 |
|---|---|---|
| `README.md` | L617 `test-emulator-page.js` 注释写「**67 项断言**」 | **96 项** |
| `README.md` | L618 `test-emulator-structure.js` 注释写「**37 项**」 | **45 项** |
| `README.md` | L623 描述 emulator.html 为「**3 个平级页签**」 | **5 个** |
| `README.md` | L476 章节标题「v9.1：首页 / 手机专区 两段式」 | 已到 v10 |
| `README.md` | L656 `search/all` 写「双分组」 | **4 分组** |
| `README.md` | L604 描述 `emulator-sections.js` 为「**四个分区**」 | **5 个**（initEmu/initTr/initSv/initEg/initDm） |
| `HANDOFF.md` | 第三节写「**3 分区 / 3 页签**」 | **5 分区 / 5 页签** |
| `HANDOFF.md` | 第八节写结构 37/37、行为 67/67 | 45/45、96/96 |
| `HANDOFF.md` | 第八节 md5 写 `0b95a70b…` | `09916f1f…` |
| `HANDOFF.md` | 第十一节 checklist 期望值 37/67 | 45/96 |
| `HANDOFF.md` | 第二节目录树写 `server.js` 39 KB / 41 个路由、`index.html` 126 KB、`emulator.html` 171 KB | 44 KB / 约 60 路由 / 137 KB / 203 KB |
| `HANDOFF.md` | 第七节数据规模（15,164 / 3,161 / 1,522） | 已更新至 15,268（09-14） |
| `DESIGN.md` | 通篇停留在「4 分区」「首页/手机专区」时期 | 需同步到 5 页签 + v10 组件（`.tg.src.*` / `.pill.ver` / `.paths .p`） |
| `server.js` | L14 死端口常量 `3456` | 实际 **8123** |

---

## 10. ★ 后续优化建议

> 优先级：**P0 收益最大 → P3 打磨**。每条附「验收标准」，可直接对应 `CODEX-TASKS.md` 里的 prompt。

### P0 —— 数据层（收益最大）

| # | 任务 | 收益 | 验收标准 |
|---|---|---|---|
| **P0-1** | **扩端游库收录**（唯一能突破 48% 匹配率天花板的路径） | 匹配率 ↑ | `POST /api/library/index/calibrate` 跑满全量，`/api/library/stats` total 显著增长；`/api/mobilehub/stats` matchedRate 上升 |
| **P0-2** | **把三个数据脚本纳入每日 09:30 自动化**（`build-mobilehub.js` / `fetch-trainers.js` / `build-saves.js`） | 数据不再过期 | 现有 7 步流程后追加 3 步；连续两日自动化日志均无失败 |
| **P0-3** | **统一端口真源**（删 `server.js:14` 死常量） | 消除接手陷阱 | 全项目 `grep 3456` 零命中；服务仍在 8123 起 |

### P1 —— 前端体验

| # | 任务 | 收益 |
|---|---|---|
| **P1-1** | 手游中心加「**只看双料**」独立开关（目前只能在排序里体现） | 精准筛选 |
| **P1-2** | 手游中心「**按帧率档筛选**」做成多选（`#emuTier` 已有下拉） | 筛选粒度 |
| **P1-3** | 合并卡加「**设备指纹**」提示（如「此配置需 Turnip 驱动」），与指南联动 | 决策前置 |
| **P1-4** | **详情页补齐首图/封面**（部分条目 `libCover` 为空） | 视觉完整度 |
| **P1-5** | 手游中心卡片**点击分流优化**（有 `libId` → 详情；有 `bhKeys` → 社区配置面板） | 交互清晰 |
| **P1-6** | **修改器 / 云存档页与端游详情抽屉打通**（详情页内直接显示该游戏的修改器 + 存档路径） | 闭环体验 |

### P2 —— 架构与文档

| # | 任务 | 收益 |
|---|---|---|
| **P2-1** | **同步三份文档**（按第 9 节滞后清单逐项修） | 交接不再误导 |
| **P2-2** | **`emulator-sections.js` 拆分**（937 行 / 44 KB，5 个分区驱动挤在一个文件） | 可维护性 |
| **P2-3** | **`server.js` 拆分**（961 行 / 约 60 路由，建议按域拆 `routes/*.js`） | 可维护性 |
| **P2-4** | README 图表化（补信息架构图 + 数据流水线图） | 可读性 |
| **P2-5** | 引入 **git 版本控制**（当前无兜底，全靠手动备份） | 安全网 |

### P3 —— 质量

| # | 任务 | 收益 |
|---|---|---|
| **P3-1** | 补 **`mobilehub` 相关测试**（96 项断言里手游中心覆盖较浅） | 覆盖率 |
| **P3-2** | 补 **`build-mobilehub.js` 单测**（数字一致性护栏 `numConflict` 值得单独覆盖） | 数据正确性 |
| **P3-3** | 补 **修改器 / 云存档 测试**（v10 新增的两个页签目前无专属断言） | 覆盖率 |
| **P3-4** | 清理 `_preview-cards.html` / `_preview-cards.js` / `data/_gcm-raw.json`（非运行依赖） | 目录整洁 |

---

## 11. Codex 接手 checklist

```bash
# 1. 进目录
cd "E:/新建文件夹/WorkBuddy/2026-09-03-16-11-58/game-aggregator"

# 2. 确认服务在跑（没有则起）
curl -s http://127.0.0.1:8123/api/health || node server.js &

# 3. 跑测试确认基线是绿的
node tools/test-emulator-structure.js   # 期望 45/45
node tools/test-emulator-page.js        # 期望 96/96

# 4. 确认生成器幂等（改东西之前先确认基线）
md5sum public/emulator.html             # 期望 09916f1fcb071ff59f5a83ef1a0d0420
node tools/build-emulator-page.js
md5sum public/emulator.html             # 必须一致

# 5. 先做一次全量备份（无 git 兜底！）
cp -r public "public.bak-$(date +%Y%m%d-%H%M)"
cp server.js "server.js.bak-$(date +%Y%m%d-%H%M)"
```

### 改代码的四条铁律

1. **改共享资产** → 只改 `public/index.html` → 重跑 `node tools/build-emulator-page.js`
2. **改完** → 跑三层测试 + 确认生成器幂等
3. **改 `data/*.js`** → 重启服务
4. **任何破坏性操作前先备份**（本项目无 git）

---

## 12. 相关文档索引

| 文件 | 说明 |
|---|---|
| `game-aggregator/README.md` | 完整技术文档（v10 章节在顶部） |
| `game-aggregator/HANDOFF.md` | 交接文档（含 v10 增量段 + 已知的坑） |
| `game-aggregator/DESIGN.md` | 页面设计规范（**内容滞后**） |
| `game-aggregator/CODEX-TASKS.md` | ★ 可直接复制粘贴的 Codex 任务 prompt 集 |
| `.workbuddy/artifacts/2026-09-1x-GameHub-优化轮*.md` | 历轮交付说明（v1 → v10 全存档） |
| `game-aggregator/.workbuddy/memory/YYYY-MM-DD.md` | 每日工作日志（含轮 9-20 全部踩坑） |

**已沉淀的 skill**（可直接复用方法论）：

- `~/.workbuddy/skills/single-source-dual-page/` —— 单源双页架构 + 11 个坑
- `~/.workbuddy/skills/cross-source-name-matching/` —— 跨源名称匹配 + 联网补名 + 多库合并
- `~/.workbuddy/skills/gpu-tier-cross-vendor/` —— 跨厂商 GPU 性能层级表
