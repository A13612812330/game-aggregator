# Komo-Magnet 接口契约（v10.103 预留）

> 本文是 **GameHub 页面端 ↔ 本机工具 Komo-Magnet** 的唯一定义。
> 工具端另由独立项目实现；页面端已按本文全部接好，工具端只要满足契约就自动点亮。
> 改本文必须同步改三处：`server.js` 的 `MAGNET_CFG_DEF`、`public/admin.html` 的 `DL` 段、
> `public/index.html` 的 `KM_*` 常量。

---

## 1. 三层分工（不要越界）

| 层 | 职责 | 边界 |
|---|---|---|
| GameHub 页面 | 看游戏、搜资源、发起下载 | 不碰本地文件系统 |
| GameHub 服务端 | 抓取、入库、**存下载器配置** | **不代理下载、不接触磁力** |
| Komo-Magnet（本机） | **只做「磁力 → 下载任务」** | 不做浏览、不做转换、不做资料库 |

**为什么下载器必须在本机**：浏览器插件拿不到磁盘写权限、关标签页即断，几十 GB 的 repack 下不完；
纯插件（WebTorrent）也接不上没有 WebRTC 节点的种子。插件只能做唤起与探测，下载器必须在机器上。

**为什么服务端不代理 RPC**：线上跑在容器里，服务端的 `127.0.0.1` 是容器自己，不是用户那台机器。
代理一定「永远未接入」，而且等于给公网开一个打本机的跳板。**数据面一律由浏览器直连本机。**

---

## 2. 服务端端点（已实现）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/download/meta` | 契约元信息：工具名、端口表、协议、`setup`、默认配置 |
| GET | `/api/admin/download/config` | 当前配置 + 默认值 |
| POST | `/api/admin/download/config` | 白名单合并写入 `data/magnet-config.json` |

三条都走 `adminGuard`（回环 / 会话 / 令牌任一成立）。**没有** `/add` 之类能触达磁力的端点 ——
`test-v10103-admin-download.js` 有一条 404 反向断言守着。

### 2.1 `GET /api/admin/download/meta`

```json
{
  "ok": true,
  "tool": {
    "name": "Komo-Magnet",
    "vendor": "GameHub",
    "version": null,
    "setup": null,
    "setupNote": "工具端开发中（Komo-Magnet）。装好并常驻后，本页会自动从「未接入」变成「已连接」。"
  },
  "scheme": "komomagnet://add?uri=",
  "legacyScheme": "komoconvert://add?uri=",
  "ports": [6800, 6801, 6802, 6803, 6804, 6805],
  "rpc": { "path": "/jsonrpc", "secretHint": "token:<secret>", "timeoutMs": 4000 },
  "config": { "...": "同 2.2" },
  "at": 1750000000000
}
```

> **`setup` 交付后怎么点亮**：把 `version` 填上、`setup` 指向真实安装包路径
> （建议同域 `/dl/KomoMagnet-Setup.zip`，**不要**放私有仓库 Release —— 那对访客是 404）。
> 前端是**条件渲染**：`setup === null` 时只显示「开发中」，不会出现死链。

### 2.2 配置字段

| 字段 | 默认 | 范围 | 说明 |
|---|---|---|---|
| `port` | 6800 | 1024–65535 | 探活起始端口，占用时按表顺延 |
| `secret` | `komomagnet-local` | 只读 | 与工具端 `--rpc-secret` 一致 |
| `dir` | `""` | ≤260 字符 | 空 = 工具默认 `%USERPROFILE%\Downloads\KomoMagnet` |
| `maxConcurrent` | 5 | 1–16 | 对应 `max-concurrent-downloads` |
| `maxSpeed` | `""` | `数字+K/M/G` | 空 = 不限速 |
| `seedTime` | 0 | 0–1440（分钟） | 0 = 下完不做种 |
| `autoLaunch` | `true` | 布尔 | 探不到工具时是否允许协议唤起 |

`POST` 是**白名单合并**：只认这 6 个键（`secret` 不接受修改），没出现的键保持原值。
越界一律 `400`，错误信息写清范围。每次成功写入都追加一条 `data/admin-log.jsonl`。

---

## 3. 本机 RPC 契约（浏览器 → 工具）

- 地址：`http://127.0.0.1:<port>/jsonrpc`
- 协议：JSON-RPC 2.0，**直接沿用 aria2 的方法名与字段**（工具端就是 aria2 内核，不要再包一层自定义 API）
- 鉴权：`params[0] = "token:komomagnet-local"`

```json
{ "jsonrpc": "2.0", "id": "km", "method": "aria2.addUri",
  "params": ["token:komomagnet-local", ["magnet:?xt=urn:btih:..."]] }
```

| 用途 | 方法 | 参数（token 之后） | 返回 |
|---|---|---|---|
| 探活 | `aria2.getVersion` | — | `{ version, enabledFeatures }` |
| 加任务 | `aria2.addUri` | `[ [uri], {dir?} ]` | `gid`（字符串） |
| 单任务 | `aria2.tellStatus` | `[gid, [keys]]` | 状态对象 |
| 进行中 | `aria2.tellActive` | `[ [keys] ]` | 状态数组 |
| 等待/暂停 | `aria2.tellWaiting` | `[offset, num, [keys]]` | 状态数组 |
| 已完成 | `aria2.tellStopped` | `[offset, num, [keys]]` | 状态数组 |
| 总览 | `aria2.getGlobalStat` | — | `{ downloadSpeed, numActive, numWaiting, numStopped }` |
| 暂停/继续/删除 | `aria2.pause` / `unpause` / `remove` | `[gid]` | `gid` |
| 下发设置 | `aria2.changeGlobalOption` | `[{ opt: value }]` | `"OK"` |

用到的状态字段：`gid`、`status`、`totalLength`、`completedLength`、`downloadSpeed`、
`errorMessage`、`files[].path`、`bittorrent.info.name`。

`status` 取值：`active` / `waiting` / `paused` / `complete` / `error` / `removed`。

---

## 4. 降级链（页面必须按这个顺序）

```
① 浏览器直连 RPC（6800→6805 并发探，单次 350ms）
      命中 → aria2.addUri 入队 → 右下角浮层轮询进度
② 协议唤起 komomagnet://add?uri=<URL编码>
      唤起后 800ms 重探；命中即入队
③ 云下载弹窗（服务端代下）
      前两级都失败才出现；弹窗内说明「不装也能用」
```

- **① 的并发是硬要求**：串行 6×350ms = 2.1 秒，比旧的失焦方案还慢，等于负优化。
- **② 不能删**：装了工具但**没常驻**的用户只有这条路。
- **探测失败缓存 30 秒**，避免连续点磁力重复付 350ms。
- **移动端整个跳过**（`matchMedia('(hover: hover) and (pointer: fine)')`）：手机上永远没有这个 exe。

---

## 5. 前端接入位置

| 位置 | 内容 |
|---|---|
| `public/index.html` · `KM_NAME` / `KM_SETUP` | 工具名与安装包（`KM_SETUP=''` ⇒ 不渲染安装链接） |
| `public/index.html` · `kmProbe` / `kmRpc` / `kmAdd` / `kmTrack` | ① 级直连与进度浮层 |
| `public/index.html` · `kmBarSync()` | 下载弹窗里的状态条（已就绪 / 未检测到） |
| `public/admin.html` · `DL` + `dlRpc` / `dlProbe` / `dlRefresh` | 管理端：任务表 / 控制 / 探活 |
| `public/admin.html` · `dlSaveCfg` | 存服务端配置 + 下发 `changeGlobalOption` |
| `server.js` · `MAGNET_CFG_DEF` | 配置默认值与校验真源 |

> 四张派生页（emulator / unpack / resources / extract）由 `tools/build-*-page.js` 从主源生成，
> **不要单独改**；改完主源必须重建，`tools/test-pages-sync.js` 会拦住漏建。

---

## 6. 验收

```bash
# 服务端契约（需 8124 在跑）
node tools/test-v10103-admin-download.js        # 期望 55/55

# 页面端三级链
node tools/test-v10102-magnet-rpc.js            # 期望 31/31
node tools/test-v10101-handoff.js               # 期望 26/26

# 派生页同步（漏重建会红）
node tools/test-pages-sync.js                   # 期望 58/58
```

工具端自检（交付方执行）：

```bash
# 探活：应返回 version
curl -s -X POST http://127.0.0.1:6800/jsonrpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"1","method":"aria2.getVersion","params":["token:komomagnet-local"]}'
```

---

## 7. 唯一未闭环的风险

**Chrome / Edge 的 Private Network Access（PNA）**：HTTPS 页面请求 `http://127.0.0.1` 时，
Chromium 会跑一次私网访问检查。v10.102 实测**最终放行**（`200 / 6ms`），但事件流里伴随一条
`net::ERR_BLOCKED_BY_PRIVATE_NETWORK_ACCESS_CHECKS`。

⇒ 必须在**有头** Chrome 与 Edge 各实测一次并记录版本。若被拦，工具端加一个 40 行以内的
PowerShell `HttpListener` 反代补 `Access-Control-Allow-Private-Network: true`，
**不许**要求用户关掉浏览器安全策略。
