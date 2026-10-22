# GameHub · 单机游戏信息聚合站

把 **jidiyouxi.com（机地）** 与 **xdgame.com（XDGAME）** 两个源站的游戏、MOD、存档、修改器、手机模拟器配置聚合到一处。

> **只做信息聚合，不托管任何游戏文件。** 内容与下载入口一律指向源站。

**线上**：https://gamehub-agg-v4.app.workbuddy.host/ · **本地**：`npm i && npm start` → http://localhost:8123

---

## 六个页面

| 页面 | 路径 | 做什么 |
|---|---|---|
| 首页 | `/` | 双热度合并热榜（周 / 月 / 全站 / 社区）+ 最新收录 + 全站搜索弹窗 + 详情抽屉 |
| 端游资源 | `/resources.html` | 本体 / MOD / 存档 / 修改器 四分区，按热度排序。**点卡片进详情；点卡底「⬇ 下载与资源」开完整下载弹窗，默认落在当前模块页签** |
| 手机专区 | `/emulator.html` | 手游可玩（社区配置）/ 实测配置（自建库，带帧率与踩坑）/ 模拟器指南 / 机型兼容查询 |
| 解包配置匹配 | `/unpack.html` | 按游戏匹配对应的解包 / 汉化配置 |
| 解压助手 | `/extract.html` | 本地压缩包递归解压（套娃包一次解到底，加密包可续跑） |
| 管理后台 | `/admin.html` | 内容库维护、资源条目查看、抓取任务进度 |

## 规模（2026-10-22 线上实测）

| 数据 | 量级 |
|---|---|
| 游戏库 | **19,732 款**（XDGAME 16,036 + 机地 3,696，双源命中 13,448） |
| MOD | 360 组 / **7,825 条**（直链率 99.9%） |
| 存档 | 1,377 组 / **5,879 条**（GTrainers + 游侠，直链率 99.7%） |
| 修改器 | 4,511 组 / **9,247 条**（GTrainers + GCM 清单） |
| 手游社区配置 | BannerHub 快照：2,597 款游戏 / 14,003 份配置 |
| 实测配置 | 《基础测试数据.xlsx》1,037 条（含帧率与踩坑备注） |
| 机型库 | 1,030 款机型 / 18 品牌；芯片规格 1,444 款 |

## 快速开始

```bash
npm install
npm start                 # 常驻 8123
```

Windows 也可双击 `启动聚合站.cmd`（前台看日志）或 `启动聚合站-静默.vbs`（无黑窗）。
URL 直达：`/?q=剑星`（搜索）· `/?c=角色扮演`（分类）· `/?open=<id>&dl=mod`（详情并打开指定模块弹窗）。

每日 09:30 定时任务：XD 增量 → BannerHub 刷新 → 实测库重建 → 机地话题同步。

## 数据源

| 源 | 用途 | 形态 |
|---|---|---|
| XDGAME `xdgame.com` | 游戏库主体（16,036 款） | 分页列表 + 详情 SSR 解析 |
| 机地 `jidiyouxi.com` | 话题 / 热榜 / MOD / 修改器帖 | SSR + 话题接口 |
| The412Banner/bannerhub | 手游社区模拟器配置 | codeload 快照，服务端热加载 |
| GTrainers / GCM / 游侠 | 存档与修改器 | 索引 + 直链代理 |
| Steam 官方 API | 中英名别名表 | 按需联网补名 |

⚠️ `xdgame.com` 与 `xdgamer.com` 是两套独立内容（同 ID ≠ 同游戏），库数据全部属于 `xdgame.com`。

## 目录结构

```
server.js                 Express 服务 + 路由 + 缓存
fetchers/                 源站抓取（jidi / xdgamer / xdrank / indexer）
data/                     业务数据与索引（games / mods / saves / trainers / bannerhub / phonecfg …）
public/index.html         ★ 主源（样式与通用脚本的唯一编辑入口）
public/{resources,emulator,unpack,extract}.html   派生页，改动后须重跑 tools/build-*.js
public/admin.html         管理后台（独立）
tools/build-*.js          派生页生成器
tools/test-*.js           静态与行为防线（96 套，登记在 tools/run-all.js）
docs/versions/            每版一份变更日志 + 索引
```

改 `public/index.html` **必须**重跑四张派生页；改 `server.js` 或 `data/**` **必须**重启服务。

## API（常用）

| 接口 | 说明 |
|---|---|
| `GET /api/rank?p=week` | 首页热榜（week / month / year） |
| `GET /api/library?q=&limit=` | 本地库即时搜索 |
| `GET /api/library/browse?g=&sort=&sizeMin=` | 分类浏览（含容量区间筛选） |
| `GET /api/detail?url=` | 源站详情实时解析 |
| `GET /api/search?q=` | 跨站搜索（机地收录匹配 / XDGAME 站内） |
| `GET /api/res/groups?cat=mod\|saves\|trainers` | 端游资源分组（默认 `sort=hot`） |
| `GET /api/res/items?cat=&key=` | 某组的条目明细 |
| `GET /api/mods/match?t=` | 按游戏名反查 MOD / 存档 / 修改器 |
| `GET /api/dl/fling?u=` | FLiNG 直链代理（Referer 防盗链 + SSRF 白名单） |
| `GET /api/mobilehub/list` | 手游中心合并列表 |
| `GET /api/device/match?model=` | 机型 → 可跑游戏 |
| `POST /api/library/index/incr` | 内容库增量更新 |

其余路由见 `server.js`（每个 `app.get/post` 上方都有一行用途注释）。

## 测试

```bash
node tools/run-all.js             # 静态防线（96 套）
node tools/run-all.js --browser   # 追加浏览器实拍（一次只跑一个）
node tools/report.js              # 收尾汇报：版本、md5、GitHub 同步状态
```

判「线上是不是最新」一律比 md5，不看 HTTP 200。
当前基线：**5,115 通过 / 4 已知失败**（游侠 stats 漂移 1 + 联网补型号 3）。

## 文档

| 文件 | 内容 |
|---|---|
| `docs/versions/` | 每版变更日志（唯一版本真源）+ 索引表 |
| `PITFALLS.md` | 192 条踩坑铁律（静默失效、断言假绿、口径陷阱） |
| `ROADMAP.md` | 功能规划与取舍 |
| `WORKFLOW.md` | 开发与发布流程、排他约定 |
| `docs/archive/` | 过期交接文档（HANDOFF / CODEX-* / DESIGN），仅作历史留存 |

## 当前版本

**v10.102**（2026-10-22）：磁力点击先探本机 Komo-Magnet 的 aria2 RPC（并发探 6 个回环端口），探到即入队并显示进度，探不到才走协议唤起、再落云下载——不再靠「2.2 秒失焦」猜装没装。工具端由独立项目提供。

**v10.100**（2026-10-22）：仓库与文档精简 —— README 从 1,568 行 / 143KB 收成这一页，版本史全部移入 `docs/versions/`，过期交接文档归档到 `docs/archive/`。产品代码无变更。

**v10.99**（2026-10-22）：端游资源卡底按钮改开完整下载弹窗（默认页签随所在分区），详情底栏恢复单按钮。
详见 [docs/versions/v10.99.md](docs/versions/v10.99.md)。
