# GameHub 线上云下载 —— 环境实测与实施计划（v10.92 前置）

> 状态：**计划稿，未改任何产品代码**。
> 依据：`docs/GAME-AGGREGATOR-AGENT-PROMPT.md` + `docs/ONLINE-DOWNLOAD-INTEGRATION.md`（来源仓库
> `A13612812330/Komo-Convert`，分支 `feature/native-modules`）。
> 本文所有数字为 **2026-10-20 实测**，未测项明确标注「待探针」，不做推断性表述。

---

## 一、结论先说

| 问题 | 答案 |
|---|---|
| 用户要的「磁力链下载」能否做成**网页内一键云下载** | **机制可行**：磁力元数据识别在本机实测 4.3s / 8.5s 完成，文件清单可直接产出 |
| 用户要的「直链下载」能否由服务器代下 | **不能**。FitGirl 的三个镜像站实测全是落地页 / Cloudflare 挑战，**没有文件直链** |
| 线上托管能否跑长驻下载引擎 | **部分已证**（长驻进程 ✅、可写盘 ✅、大文件 ✅、8MB 上传 ✅）；**平台架构 / BT 出站 / 跨重启持久 待探针** |
| 桌面源码能不能当线上服务 | **不能**。Komo-Convert 是 WPF 单用户桌面程序，服务端能力（多用户隔离、配额、公网鉴权、持久任务库）它没有 |

---

## 二、线上环境实测（黑盒，未部署任何东西）

线上地址 `https://gamehub-agg-v4.app.workbuddy.host`，网关 `CloudStudio Gateway`。

| # | 检查项 | 结果 | 证据 |
|---|---|---|---|
| 1 | 长驻 Node 进程 | ✅ 支持 | 线上 Express 常驻响应，非函数式托管 |
| 2 | 可写磁盘 | ✅ 支持 | `GET /api/fitgirl/parts?slug=airborne-empire` 首次现抓、二次返回 `cached:true` |
| 3 | 大文件下行 | ✅ 10.49 MB / 1014 ms（≈10.3 MB/s），md5 与本地一致 | `/roster/index.html`(10,997,541B) |
| 4 | Range / 断点 | ✅ `206` + `Content-Range: bytes 0-262143/10997541`，首 256 KB md5 MATCH | 同上 |
| 5 | 出站 HTTPS | ✅ 通 | parts 现抓 FitGirl 页面成功 |
| 6 | 请求体上限 | ✅ 8 MB 通过；❌ 20 MB → **413** | 对 `POST /api/admin/login` 发 0.5/2/8/20 MB 实测 |
| 7 | 磁盘容量 / 剩余 | ❓ 待探针 | — |
| 8 | 容器平台与 CPU 架构 | ❓ 待探针（决定 aria2 拿 x64 还是 arm64） | — |
| 9 | 是否已装 aria2 / 能否自带 | ❓ 待探针 | — |
| 10 | BT 出站（TCP tracker / UDP DHT） | ❓ 待探针 | — |
| 11 | 写盘是否**跨容器重建**存活 | ❓ 待探针（两次部署对比） | — |

> 探针已写好：`_probe-runtime/server.js`（只读，单端点，5s 全部超时兜底，本地已跑通）。
> 部署后返回：platform/arch/node、磁盘 total+free、`aria2c` 是否在、DNS/HTTPS/TCP-tracker/UDP-DHT
> 四路出站结果、以及「上次写入时间戳 vs 本次 pid」用于判定跨进程持久。

---

## 三、三条硬约束（都是实测出来的，改设计不改它们）

### 1. 「直链」在 FitGirl 体系里**不存在**

| 镜像站 | 实测响应 | 判定 |
|---|---|---|
| `datanodes.to/<id>/<file>.rar` | `302 → https://datanodes.to/download` | 落地页 |
| `filekeeper.net/<id>/<file>.rar` | `302 → https://filekeeper.net/download` | 落地页 |
| `fuckingfast.co/<id>#<file>.rar` | `403` + `<title>Just a moment...</title>` | Cloudflare 挑战 |

⇒ 服务器要「代下」就必须过 CF 挑战 / 落地页 JS，**不做**（技术上是绕过访问控制，也不稳定）。
⇒ 按钮语义只能是「**在用户浏览器里打开镜像页**」，让用户自己走站点流程。
⇒ 这也意味着「直链下载」按钮**永远不需要下载引擎**，它是纯跳转 + 可选的「复制全部链接」。

### 2. 磁力里的文件和网页分卷是**两套东西**

用真种子实测（本机 aria2 1.37.0，只取元数据）：

| repack | 网页分卷（镜像站） | 磁力内文件 |
|---|---|---|
| Astrobuilder | 2 卷 rar | **7 项 / 2.70 GB**：`fg-01.bin` 2561 MB、`fg-02.bin` 200 MB、`fitgirl-bins.md5`、`QuickSFV.EXE`、`QuickSFV.ini`、`setup.exe` 4.1 MB、`Verify BIN files...bat` |
| Arma 3 | 48 卷 rar | **19 项 / 86.10 GB**：`fg-01.bin` **71,427 MB** + `fg-02..08.bin` + setup.exe 等 |

⇒ 磁力的「文件选择」粒度是 `fg-0N.bin`（安装数据块），**不是**「选第 12 卷」。
⇒ 两条路径不能共用一个目录树；选择器必须按来源分模型。

### 3. 体量决定成本结构

Arma 3 单任务 **86.10 GB**。服务器代下再转发 = 双份出口流量 + 86 GB 磁盘常驻。
⇒ 必须有：单任务体积上限、每用户并发上限、TTL 淘汰、磁盘水位保护。
⇒ 对超大包，**如实提示「建议用磁力客户端」** 比硬撑更负责任。

---

## 四、引擎选型（等探针定，二选一，不做第三方案）

| 方案 | 前提 | 优点 | 代价 |
|---|---|---|---|
| **A. aria2 RPC**（首选） | 探针确认 Linux 架构 + 可执行权限 | 成熟、限速/暂停/多文件选择/Range 全有、CPU 占用低 | 要带二进制（GPLv2，须附 COPYING + 来源）；架构必须匹配 |
| **B. 纯 JS（webtorrent）** | npm 可装、无 native 编译障碍 | 跨架构、无二进制分发问题、与 Node 同生命周期 | 性能与稳定性弱于 aria2；需自己补暂停/限速语义 |

RPC 只绑 `127.0.0.1` + 随机端口 + 随机 secret，**绝不监听 0.0.0.0**（照 `Aria2Session.cs` 的边界）。

---

## 五、五步实施计划

| # | 步骤 | 交付 | 影响文件 |
|---|---|---|---|
| **0** | **线上运行时探针**（只读，用完下线） | 补齐二节 #7–#11 五项事实 | `_probe-runtime/`（独立目录，不入产品） |
| **1** | **FitGirl 源 UI 重排**：每行只留「⬇ 直链下载」「⧉ 磁力链」两个按钮；直链 = 选镜像 + 分卷清单（逐条打开 / 复制全部）；磁力 = 复制（引擎就绪后加「云下载」） | 用户第一条要求落地，**不依赖引擎**，可先上线 | `public/index.html`（主源）→ 重建 `emulator/unpack/resources/extract.html`（四页各有 5 处 fg 锚点，必须走生成器） |
| **2** | **任务服务层骨架**（先立合同，不接引擎）：`previews / batches / tasks / actions / files` 五组端点 + 任务存储 + 归属校验 + 配额 + 幂等 | 空引擎也能跑通「提交→排队→拒绝非法输入」 | `server.js`、`data/download-tasks.js`（新，原子写 JSON）、`lib/download-guard.js`（新：SSRF/路径/白名单） |
| **3** | **引擎接入**：磁力 `bt-metadata-only` 识别（不取正文）→ 文件清单 → 勾选 → 批量入队 → 暂停/继续/取消 → `ready` 后 Range 直链「保存到电脑」 | 网页内完成整条链路 | `lib/download-engine.js`（新）、`lib/download-worker.js`（新）、`server.js` |
| **4** | **防线与验收**：自制 HTTP + 合成多文件种子 + 本机做种夹具；「识别不取正文」用请求计数证；正文 SHA-256；批量幂等；重启恢复；跨用户越权拒绝；非法地址/路径拒绝 | 可复核的报告 | `tools/test-v1092-downloads.js`（新，登记 run-all）、`docs/versions/v10.92.md` |

**接口合同**（照 `ONLINE-DOWNLOAD-INTEGRATION.md`，不自行发挥）：

```
POST /api/downloads/previews           提交 磁力/直链/种子 → 异步识别任务
GET  /api/downloads/previews/:id       识别进度 + 文件树；不下载正文
POST /api/downloads/batches            一次提交所选链接与文件索引 → 每项任务或错误
GET  /api/downloads/tasks              只返回当前用户的任务
POST /api/downloads/tasks/:id/actions  幂等 pause / resume / cancel
GET  /api/downloads/tasks/:id/files/:fileId   鉴权文件流，支持 Range
```

状态机：识别 `queued → resolving → ready/failed/cancelled/expired`；传输 `queued → downloading → paused/ready/failed/cancelled`。
**`ready` 只表示「服务器文件就绪」**，网页按钮文案分三段：`识别中` → `开始云下载` → `保存到电脑`。

执行端字段 `executor: 'cloud' | 'local'` 从第一天就写进任务模型（未来 EXE 切换用），本轮只实现 `cloud`。

---

## 六、必须同时做的边界（不是可选项）

- 下载 API 走**账号会话**（v10.91 已有），任务按 `ownerId` 隔离；越权一律 403。
- 磁力 info-hash 去重 + `POST /batches` 幂等键 ⇒ 连点不产生重复任务。
- 配额：活动识别数上限、每用户并发任务上限、单任务体积上限、总缓存水位（超限拒绝新任务而不是拖垮服务）。
- SSRF：直链只允许 `http/https`、拒绝内网/回环/链路本地/云元数据段；重定向逐跳校验；Tracker 协议白名单且拒绝带凭据 URL。
- 路径：只接受 `previews` 返回的不透明 `fileId`，任何客户端传入的服务器路径都不接受。
- 缓存 TTL 清理 + 清理记录；**删除任何文件前不猜**，只删自己创建且已过期的任务目录。
- 不自动执行下载文件；`setup.exe` 之类只做文件传输，不做任何运行/解压。

---

## 七、验收口径（区分四层，不合并表述）

| 层 | 判定 |
|---|---|
| 代码已实现 | 静态断言套件通过（`test-v1092`） |
| 本地回归 | 自制夹具：识别不取正文（请求计数不变）/ 选定文件正文哈希 / 批量幂等 / 暂停恢复 / 重启恢复 / 越权拒绝 / 非法输入拒绝 |
| 服务器已部署 | 线上端点 200 + 无会话 403 + 一次真实磁力识别成功（**只识别不下载**） |
| 浏览器实传 | 点「保存到电脑」完整收完一个文件并校验 md5 |

**没做到第四层就不写「线上下载可用」。**

---

## 八、未决项（需要你拍板，不擅自定）

1. **探针怎么跑**：独立只读 app（用完下线）/ 主站加只读端点随版本发布 / 暂不探针。
2. **直链按钮语义**：打开镜像页 / 复制全部链接 / 干脆不做只留磁力。
3. **本轮范围**：只做 UI 重排（可今天上线）／UI + 引擎一起／先只留计划。

---

## 九、Git 与改动边界

- 当前 `git status` **为空**（v10.91 已在 `44fedd8` 提交并推送），本轮没有需要「保留」的未提交改动。
- 功能分支开工，**不直接推 main、不合并 main**；不提交凭据、任务缓存、用户文件。
- 下载数据目录（`data/downloads/`、`.cache/downloads/`）入 `.gitignore`。
