# GameHub 工作流程总纲

> 基线：**v10.21**（2026-09-18）· 服务 `localhost:8123`
> 用途：接手/排期/派活时的**唯一流程入口**。版本细节看 `CODEX-DONE-vX.Y.md`，
> 版本索引看 `CODEX-INDEX.md`，本文只讲「**做什么、按什么顺序做、哪里会炸**」。

---

## 〇、一页速览：四类工作在发生

| # | 工作类型 | 触发 | 频率 | 载体 |
|---|---|---|---|---|
| A | **代码迭代**（改页面/接口/数据层） | 用户提需求 | 每版一次 | 本机 → 派生页 → 防线 → 文档 → GitHub |
| B | **数据管道**（抓取/重建索引） | 每日 09:30 自动 | 每天 | WorkBuddy 自动化「GameHub 内容库每日自动同步」 |
| C | **发布**（覆盖线上） | 用户明确要求 | 攒够一版才发 | `gamehub-agg-v3.app.workbuddy.host` |
| D | **收尾汇报**（固定五项） | 每轮结束 | 每轮 | `node tools/report.js` |

★ **A 和 B 是两条独立的线**：自动化只跑接口和脚本，**不碰源码**；代码迭代**不碰抓取逻辑**。
两者唯一的交汇点是 `data/*.json` 产物 —— 所以改完代码要**重启服务**才能读到新数据。

---

## 一、日常迭代工作流（从改一行到上线，8 步）

### 步骤 1 · 判断改动落在哪一层（决定后面要做什么）

```
需求
 ├─ 改页面样式/交互 ──────► 【主源】public/index.html（或生成器的 SECTIONS 常量）
 ├─ 改手机专区专属区块 ───► 【主源】tools/build-emulator-page.js 的 SECTIONS
 │                          + tools/emulator-sections.js（页面脚本）
 ├─ 改解包匹配页 ────────► 【主源】tools/build-unpack-page.js 的 SECTIONS
 │                          + tools/unpack-sections.js
 ├─ 改接口/路由 ─────────► server.js
 ├─ 改数据结构/查询 ─────► data/*.js（读取层）
 └─ 改抓取/重建数据 ─────► tools/fetch-*.js（写入层）→ data/*.json
```

**共享资产（CSS / 顶栏 / 遮罩 / 搜索 / 通用脚本）只有一处真源** ——
由 `tools/page-assets.js` 从 `index.html` 抽出，三个页面同源吃同一份。
⇒ **改共享资产只改 `index.html`**，改完必须重建**所有**派生页。

### 步骤 2 · 改代码

铁律（**每条都踩过**）：

| 铁律 | 原因 |
|---|---|
| 派生页 `emulator.html` / `unpack.html` **绝不手改** | 下次重建就冲掉 |
| 改共享资产只改 `index.html` | 否则三页漂移 |
| 改 `data/*.js` 后必须重启服务 | node 模块缓存，不重启不生效 |
| 改 `server.js` 后必须重启服务 | 同上 |
| 改 `server.js` / `data/**` 前先备份目标文件 | 破坏性操作兜底 |

### 步骤 3 · 重建派生页（**漏了不会报错，只会悄悄漂移**）

```bash
node tools/build-emulator-page.js    # → public/emulator.html
node tools/build-unpack-page.js      # → public/unpack.html
node tools/test-pages-sync.js        # ★ 同步防线（25 条）
```

★ `test-pages-sync.js` 是**唯一**能发现「主源改了但派生页没重建」的手段
（CSS 尾部指纹 + 函数清单比对）。**这一步不能跳。**

### 步骤 4 · 重启服务

```bash
node tools/restart-server.js
# 或手动：kill 掉 8123 → node server.js
curl http://localhost:8123/api/health    # 期望 ok
```

⚠️ **不要用 `curl` 判断服务是否在跑**（本机 git-bash coreutils 残缺，`curl` 常不可用）。
用 node 发请求或 `netstat -ano | findstr :8123`。

### 步骤 5 · 跑三层防线

```bash
# 第一层：静态（17 套 / 1108 条 / 必须 0 失败）
node tools/run-all.js

# 第二层：浏览器实拍（puppeteer，★ 必须加大超时 + 分批跑）
node tools/preview-v1020.js

# 第三层：线上验收（仅发布后跑）
node tools/verify-online.js
```

**新增功能必须补一层防线**（写 `tools/test-xxx.js`），
**并且必须把新套件加进 `tools/run-all.js` 的 `SUITES`** —— 否则它永远不会被覆盖。

⚠️ 跑防线的三个已知坑：
| 坑 | 现象 | 处理 |
|---|---|---|
| 默认超时 | `execFileSync` 120s 默认会 SIGTERM，**看起来像失败其实是超时** | 加大超时（run-all 内已设 180s） |
| 多套件连同一 CDP | 抛 `detached Frame` —— 浏览器侧干扰 | 先单独重跑那一套 |
| 末行格式 | 套件必须以 `通过 n/m` 结尾（**数字紧邻**），否则 run-all 取错成绩 | 别在 n 与 m 之间插中文 |

### 步骤 6 · 写版本文档

```
CODEX-DONE-vX.Y.md   ← 逐版完整说明（改了什么 / 真实对照数据 / 踩坑表）
CODEX-INDEX.md       ← 版本索引（最新置顶，只加一段摘要）
README.md            ← GitHub 上的更新日志（对外，务必同步）
```

**文档的判据是「真实数据」，不是形容词**：
「卡片边框 0 → 1px」✅ · 「边框更好看了」❌。

### 步骤 7 · 提交推送

```bash
git add -A
git -c user.name="A13612812330" -c user.email="A13612812330@users.noreply.github.com" \
    commit -F -        # 提交信息用 heredoc，中文，写清「为什么」

export GH_CONFIG_DIR="E:/新建文件夹/WorkBuddy/2026-09-03-16-11-58/.ghconfig"
GH_TOKEN=$(gh auth token) node tools/_push-via-api.js
```

★ **为什么不用 `git push`**：本机 `github.com`（20.205.243.166）被**整台阻断**，
`git push` 一律 `CONNECT tunnel failed, response 502`；而 `api.github.com`（.168）通畅。
`_push-via-api.js` 走 REST API 的 Git Data 通道（blob → tree → commit → ref），
**并且必须用 `git cat-file blob HEAD:<path>` 取入库字节** —— 本仓库 `core.autocrlf=true`，
磁盘字节 ≠ 入库字节，直接读磁盘会**把错内容推上去**（API 全程 201、`git status` 还干净）。

推送后同步本地跟踪引用并核对：

```bash
node -e "const fs=require('fs'),p=require('path');require('child_process').execFileSync('git',['rev-parse','HEAD'])"
git rev-list --left-right --count main...origin/main   # 期望 0  0
```

### 步骤 8 · 收尾汇报（五项，用户要求）

```bash
node tools/report.js              # 联网实测线上 md5 + 远端 HEAD
node tools/report.js --no-net --md
node tools/audit-apps.js          # ★ 发布过就再跑一次：应用登记 × 域名实测**对账**
```

① 做了什么 ② 分享链接 ③ 项目文件夹 ④ 是否更新到 GitHub ⑤ GitHub 更新日志

⚠️ **只讲本项目** —— 盘点任务/进程/端口时，其他项目的自动化与监听**一律不列**。

⚠️ **发布过就要跑 `audit-apps.js`**：本项目每发一版就多一条同名 app + 一个域名，
而**旧域名全都返回 200**（内容停在旧版）。对账表能一眼看出「哪个域名还能用」。
★ 它还会警告一个**危险动作**：`unpublish` 取的是「同目录最新一次发布」，
而所有 app 的 localDir 是同一个 ⇒ **会把正式入口一起下掉**，清旧 app 只能手工删。

⚠️ **`000` = 服务挂了，不是代码坏了**：`run-all.js` 里 4 套（`test-emulator-page` /
`test-filter-layout` / `test-v1017` / `test-v1018`）要连 `127.0.0.1:8123`。
服务一停它们就红，报的却是「接口不可达」。⇒ **先 `curl` 一下，再怀疑代码**。

---

## 二、改动类型 → 必做步骤（决策表）

> ✓ = 必做 · — = 不需要

| 改动类型 | 重建派生页 | 重启服务 | 跑静态防线 | 跑实拍 | 改版本文档 | 推送 |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| 首页样式/交互（`index.html`） | ✓ **全部** | — | ✓ | ✓ | ✓ | ✓ |
| 手机专区区块（`SECTIONS` + `emulator-sections.js`） | ✓ emu | — | ✓ | ✓ | ✓ | ✓ |
| 解包匹配页（`build-unpack-page.js` + `unpack-sections.js`） | ✓ unpack | — | ✓ | ✓ | ✓ | ✓ |
| 接口/路由（`server.js`） | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| 数据读取层（`data/*.js`） | — | ✓ | ✓ | 视情况 | ✓ | ✓ |
| 识别词典（`data/spec-dict.js`） | — | ✓ | ✓（`test-spec`） | ✓ | ✓ | ✓ |
| 抓取/重建脚本（`tools/fetch-*` / `build-*`） | — | ✓ | ✓ | — | ✓ | ✓ |
| 纯文档（`*.md`） | — | — | ✓（`test-report`） | — | ✓ | ✓ |

---

## 三、数据管道工作流（每日自动）

**自动化任务**：「GameHub 内容库每日自动同步」（每天 **09:30**，ACTIVE）

10 步顺序（★ 顺序**不可换**，后一步依赖前一步产物）：

| 步 | 动作 | 产物 | 备注 |
|---|---|---|---|
| 1 | 健康检查 / 不可达则拉起服务 | — | 端口固定 8123 |
| 2 | `POST /api/library/index/incr?pages=10` | 端游库增量 | XDGAME |
| 3 | `POST /api/bh/refresh` + 轮询 state | BannerHub 社区配置库 | 12~60s，最多等 12min；**成败看 `lastOk` 不是 `ok`** |
| 4 | `python tools/build-phonecfg.py` | `data/phonecfg.json` | 读 `基础测试数据.xlsx`（**只读**） |
| 5 | `node tools/build-mobilehub.js` | `data/mobilehub.json` | ★ 必须在 3、4 之后 |
| 6 | `node tools/fetch-trainers.js` | `data/trainers.json` | GCM 公开接口 |
| 7 | `node tools/build-saves.js` | `data/saves.json` | 需 `.cache/ludusavi-manifest.yaml`（17MB） |
| 8 | `POST /api/library/index/jidi` | 机地话题 | 409 则轮询重试 |
| 9 | 轮询 `/api/library/progress` | — | 最多 10min |
| 10 | 汇总规模输出中文摘要 | — | 四项 stats |

**约束**：只调接口与指定脚本，**不改任何源码、不删任何东西**；
三个 v10 索引（mobilehub / trainers / saves）由 `data/*.js` 按 mtime 惰性加载，
**脚本跑完自动生效，无需重启**。

**手动触发单步**（排查用）：直接跑上表对应命令即可，**单步可重跑**（幂等）。

---

## 四、防线体系（三层，缺一层就有盲区）

| 层 | 工具 | 规模 | 特点 | 何时跑 |
|---|---|---|---|---|
| ① 静态 | `tools/run-all.js` | **17 套 / 1108 条** | 秒级、无需人盯 | 每次改完 |
| ② 行为 | `test-emulator-page.js`（jsdom，含在 17 套内） | 119 条 | 需服务在 8123 | 每次改完 |
| ③ 实拍 | `tools/preview-v*.js`（15 个） | 各 30~70 条 | puppeteer，**慢且脆** | 改页面时 |
| ④ 线上 | `tools/verify-online.js` | — | 对**线上**验收 | 仅发布后 |

**写断言的五条硬规矩**（全是历史教训）：

1. **断言必须测「用户看得见」** —— `getComputedStyle` / `offsetParent` / 宽高 > 0。
   曾出现：元素在、`position:sticky` 正确、断言全绿，**但被顶栏完全盖住用户看不见**。
2. **列表区块必须断言条数 > 0** —— 前后端字段名不一致时，区块在、**0 条**。
3. **脏值断言打在承载该语义的节点上**，别打整页文本（曾把合法的「驱动: turnip_…」误报）。
4. **「预期变更」与「真退化」分开判** —— 前者同步改断言，后者才修代码。
5. **断言要能反证** —— 故意改坏业务代码，断言必须 FAIL，否则这条断言是假的。

---

## 五、文档体系（四层，各司其职）

| 文档 | 作用 | 更新时机 |
|---|---|---|
| `CODEX-INDEX.md` | **版本索引**，最新置顶，含工程约定 | 每版 |
| `CODEX-DONE-vX.Y.md` | **逐版完整说明**（20 份） | 每版 |
| `README.md` | **对外更新日志**（GitHub 首页） | 每版 |
| `WORKFLOW.md` | 本文 —— 流程总纲 | 流程变化时 |
| `HANDOFF.md` / `CODEX-HANDOFF.md` / `DESIGN.md` | **已归档**（v10.10 / v10.1 / v10.3 快照） | 冻结，只做「加归档头」 |

⚠️ 三份归档文档**不许再自称「最新」**（`test-report.js` 有 11 条断言守着）。
★ `HANDOFF.md` 顶部的旧分享链接已标为**已弃用** —— 它照样返回 200，只是内容很旧。

---

## 六、当前规模基线（2026-09-18 实测）

| 库 | 规模 | 接口 |
|---|---|---|
| 端游库 | **15,385** = XDGAME 15,319 + 机地 66 | `/api/library/stats` |
| 手游中心（合并索引） | **3,181** · 匹配端游 **1,540（48.4%）** · 双料 90 | `/api/mobilehub/stats` |
| BannerHub 社区库 | 2,648 款 / 14,405 份配置 / 1,509 机型 / 91 GPU | `/api/bh/stats` |
| 机型实测库 | 1,037 条 / 1,025 款 / 可玩 543 / 标记不可玩 474 | `/api/pc/stats` |
| 修改器 | 3,614（匹配端游 2,667 = **73.8%**） | `/api/trainers/stats` |
| 云存档 | 5,931 款 / 13,600 条路径 / 手机能玩 1,123 | `/api/saves/stats` |
| 机型库 | 17 品牌 / 1,053 台 | `/api/device/stats` |
| Steam 官方配置 | **650** 款（解包匹配的对撞基准） | `/api/spec/dict` |

**接口总量约 60 条路由**，`server.js` 1,390 行。

---

## 七、版本迭代方向（Roadmap）

### 立即可做（阻塞在等用户输入）

| 项 | 内容 | 阻塞点 |
|---|---|---|
| **v10.22** | 解包匹配**字段校准** | 等用户给解包 JSON 样本。**只改 `data/spec-dict.js`**，界面与接口不动 |
| **下一版主线** | **#33-B：收朴素子串匹配的假阳性（473 条）** | 无需外部输入，可直接开工（**收益比补名大得多**，见下） |

### ✅ 已完成（2026-09-18）

| 项 | 结果 |
|---|---|
| **发布** | v10.21 已上线 **`https://gamehub-agg-v3.app.workbuddy.host/`**（旧 v2 域名绑不上新环境，按先例新建 app，链接已变） |
| **#33-C：尾缀剥离** | 匹配率 47.9% → **48.4%**（1,530 → **1,540**）· 真退化 0 · 配置未丢 |

### P0 · 数据层（决定所有上层功能的天花板）

| # | 项 | 现状 | 目标 | 为什么排第一 |
|---|---|---|---|---|
| **#33** | ~~联网补名提升端游命中率~~ | **★ 2026-09-18 实测已否掉这个假设** | ~~60%+~~ → 拆成 #33-B / P0-1 | ★ **原假设「补名 → 60%」经实测不成立**：整条匹配链天花板只有 **+1.0pp**。已拆成两件真正能提指标的事（下两行） |
| **#33-B** | 收朴素子串匹配的**假阳性** | 未匹配里有 **473 条**是假阳性（如 `Pro Evolution Soccer 2013` 命中「万物皆可蟹：动物进化」的 `Evolution`） | 先量化再收 | ★ **收益比补名大**：这是**匹配器的错**，不是缺名字；收掉它才能让「已匹配」这个数字可信 |
| **P0-1** | 扩端游库收录 | 机地仅 **66** 条 vs XDGAME 15,319 | 补齐机地全量话题 | ★ **这才是通向 60% 的唯一路**：未匹配里 **777 条**是端游库**根本没收录**的游戏，补名救不了。另：两库定位错位（手游库偏老游戏/小体积，端游库偏近两年 3A） |
| **P1-4** | 详情页封面补齐 | 部分卡片 `libCover` 为空 | 量化 + 补源 | 先做**成因分类**（a 没匹配上 / b 库里没封面 / c 渲染问题），**禁止为了「看起来有封面」硬挂** |

### P1 · 展示层

| 项 | 内容 | 备注 |
|---|---|---|
| 三页一致性收口 | `page-assets.js` 已铺路（CSS/顶栏/遮罩/搜索/脚本同源），继续把三页的**导航与空态**统一 | 改共享资产只改 `index.html` |
| 解包匹配结果页 | 样本到手后可加「按可跑档位分组」「导出清单」 | 依赖 v10.22 校准 |
| 机型清单体验 | v10.18 已补「品牌+型号+芯片」三要素 | 观察实际使用反馈 |

### P2 · 工程质量

| 项 | 内容 | 收益 |
|---|---|---|
| **P2-2** | 拆分 `emulator-sections.js`（**59KB** 单文件） | ★ 约束：**不能**加 `require`/`export` —— 它是被生成器**当字符串读进来内联**的，只能「按顺序拼接」。拆分后 `emulator.html` md5 必须**逐字节不变**（纯重构） |
| **P3-1** | 补修改器 / 云存档 / 手游中心专属断言 | 现状这两个分区覆盖较浅 |
| 数据层清洗统一 | 同一字段多条链路 → **清洗函数必须共用** | 曾出现同一 GPU 在两处写法不同（`bhparams.json` 不走 mobilehub 读取层） |

### 结构性方向（值得作为 v11 主轴）

> **「配置匹配」能力统一**
> 现在项目里有**三套相似但独立**的实现，都在做「文本 → 结构化配置 → 判定」：
>
> | 已有 | 输入 | 判定依据 |
> |---|---|---|
> | 机型兼容 | 机型名 / 内部编号 | GPU → SoC → CPU 核簇（层级表） |
> | 手游中心 | 社区配置 vs 实测库 | 跨源名称匹配 |
> | **解包匹配**（v10.20 新） | 解包 JSON | `arch` / `dx` / `ram` / `storage` |
>
> 三套共用的东西：**文本归一化**、**型号 → 芯片转译**、**跨源名称匹配**、**脏值清洗**。
> 已经沉淀成 skill（见下），但**代码层还没收敛**。统一后可少维护两套重复逻辑。

### 长期技术债（如实列，不美化）

| 债 | 现状 | 影响 |
|---|---|---|
| 外部源站依赖 | XDGAME / 机地 / kalvo / Steam / GCM / Ludusavi 共 6 个 | **源站改版会静默失效** —— 必须靠实拍断言发现 |
| 线上是**覆盖式发布** | 重新发布复用同一 sandbox，链接不变、内容被覆盖 | 旧链接照样 200 → 本项目**已三次**栽在「200 区分不出新旧」 |
| 前端零构建 | `index.html` 223KB 单文件 | 无类型检查、无模块化；靠防线而不是编译器兜底 |
| 抓取必须用 curl | nanoreview/kalvo 用 node `fetch` 一律 403（TLS/JA3 指纹） | 例外：Steam `store.steampowered.com` 用 node fetch 正常 |

---

## 八、铁律清单（贴墙版）

1. **改主源必须重建派生页** —— 不重建不报错，只悄悄漂移（`test-pages-sync.js` 守）。
2. **改 `server.js` / `data/**` 必须重启服务** —— node 模块缓存。
3. **改完全量跑防线**（`node tools/run-all.js`）—— 漏跑的那套往往就是被改坏的那套。
4. **新增套件必须加进 `run-all.js` 的 `SUITES`** —— 否则永不被覆盖。
5. **断言要测「用户看得见」** —— 存在且属性正确 ≠ 可见。
6. **列表区块必须断言条数 > 0** —— 否则「区块在、0 条」会全绿过关。
7. **要求 ≠ 能力** —— 一份数据里常同时有「我有什么」和「要什么」，两者**必须分仓**。
8. **不用假精度** —— 量纲不同的分数不能比（移动 GPU 跑分比 PC 卡文本 = 固定分）。
9. **口径要靠数字校准** —— 降级过多的维度会把整张清单淹没（曾 535/650 全是「待确认」）。
10. **推进用入库字节** —— `core.autocrlf=true`，读磁盘会推错内容。
11. **操作范围仅限本项目目录** —— 不碰其他项目；汇报也只讲本项目。
12. **破坏性操作前先备份** —— 批量写 `data/*.json` 前必先备份该文件。
13. **文档数字必须实测** —— 先 curl 再写，不照抄旧文档。

---

## 附：常用命令速查

```bash
NODE=C:/Users/komo/.workbuddy/binaries/node/versions/22.22.2-3/node.exe

# 重建派生页
$NODE tools/build-emulator-page.js && $NODE tools/build-unpack-page.js

# 重启服务 / 健康检查
$NODE tools/restart-server.js

# 全量静态防线（17 套 1108 条）
$NODE tools/run-all.js

# 浏览器实拍（按需换版本号）
$NODE tools/preview-v1020.js

# 线上验收（发布后）
$NODE tools/verify-online.js

# 五项状态汇报
$NODE tools/report.js

# 推送（github.com 被阻断，走 API）
export GH_CONFIG_DIR="E:/新建文件夹/WorkBuddy/2026-09-03-16-11-58/.ghconfig"
GH_TOKEN=$(gh auth token) $NODE tools/_push-via-api.js
```

★ 本机 **git-bash coreutils 残缺**（`ls` / `grep` / `dirname` 不可用）——
需要这些能力时用 **node 脚本**或 **PowerShell**，不要指望 shell 命令。
