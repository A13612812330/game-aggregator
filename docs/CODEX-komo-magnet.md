# Codex 任务：新建 Komo-Magnet（GameHub 专用磁力下载工具）

> 生成于 2026-10-22 14:10。所有环境事实均为现测，不是推测。

---

## 0. 定位（先读，防止做成大杂烩）

GameHub 是三层结构，本任务只做第三层：

| 层 | 谁负责 | 做什么 |
|---|---|---|
| 前台 | GameHub 网页 | 看游戏、搜索、详情、资源列表 |
| 后台 | GameHub 服务端 | 抓取、入库、同步、周报 |
| **工具** | **Komo-Magnet（本任务）** | **只做一件事：把磁力链接变成下载任务** |

**明确不做**：不做浏览器、不做视频转换、不做 APK 解析、不做影视站、不做游戏资料管理、不做自己的游戏库 UI。
一旦有人想往里加功能，先问「这是 GameHub 后台该做的吗」。

## 1. 环境事实（现测，不要再探索）

- 仓库：新建于 `E:\新建文件夹\Codex-GPT\tools\Komo-Magnet`（当前不存在）
- 本机 **没有** `go` / `cargo` / `dotnet` 在 PATH 上 —— **不要选需要编译的工具链**
- aria2 1.37.0 已现成可用，路径：
  `E:\新建文件夹\Codex-GPT\tools\Komo-Convert\output\_pkg\KomoConvert-Setup-lite\installer\payload\aria2\aria2c.exe`
  （5,649,408 字节；同目录有 `COPYING`、`README.html`、`ChangeLog`，**一起复制**）
- aria2 RPC 实测可用（`aria2.getVersion` 返回 1.37.0，enabledFeatures 含 BitTorrent）
- 实测 `system.listMethods` 含：`aria2.addUri` / `aria2.tellStatus` / `aria2.pause` / `aria2.unpause` / `aria2.remove` / `aria2.getGlobalStat` / `aria2.changeGlobalOption`
- **跨域实测**：从 `https://gamehub-agg-v4.app.workbuddy.host/` 用 `fetch` 打 `http://127.0.0.1:16800/jsonrpc`
  → **HTTP 200，6ms 返回真实 RPC 响应**；同时观察到一次 `net::ERR_BLOCKED_BY_PRIVATE_NETWORK_ACCESS_CHECKS`
  ⇒ Chromium 跑了 PNA 检查但最终放行。**必须用有头 Edge 再复验一次并记录版本号**

## 2. 技术选型（已定，不要换）

**零编译**：`aria2c.exe` 直接当下载内核，三个 PowerShell 脚本当胶水。不写新 exe。

原因：本机无编译工具链；aria2 自带完整 JSON-RPC（含 BT/magnet）；自研壳只会把 5.4MB 变成 10MB+，
且没有一条需求是 aria2 做不到的。

**体积目标：zip ≤ 3 MB**（aria2 压缩后 2.39MB）。这是硬指标，超了就是打回去了大杂烩。

## 3. 产物结构

```
Komo-Magnet/
  bin/aria2c.exe              5.39 MB   （从 Komo-Convert 复制，勿改）
  bin/COPYING                            （GPLv2，必须随包）
  bin/README.html                        （aria2 原始说明，保留）
  scripts/install.ps1                    （per-user 安装 + 注册协议 + 可选自启）
  scripts/uninstall.ps1                  （清理协议/自启/配置，不删用户已下载文件）
  scripts/add-magnet.ps1                 （协议 handler：解析 → 确保 RPC 在跑 → addUri）
  config.example.json
  README.md
  build.ps1                              （打 zip 到 output/）
```

安装后落到 `%LOCALAPPDATA%\KomoMagnet\`，配置在 `config.json`，日志在 `logs/aria2.log`。

## 4. 运行参数（照抄，别自己发挥）

```text
aria2c.exe
  --enable-rpc
  --rpc-listen-all=false              # 只监听回环，局域网不可达
  --rpc-listen-port=6800              # 占用则 6801-6805 依次回退，实际端口写 port.txt
  --rpc-secret=komomagnet-local       # 固定值：网页要能直接用
  --rpc-allow-origin-all=true         # 实测返回 Access-Control-Allow-Origin: *
  --dir=%USERPROFILE%\Downloads\KomoMagnet
  --seed-time=0                       # 下完不做种，避免占带宽
  --bt-save-metadata=true
  --continue=true
  --no-conf
  --log=logs\aria2.log --log-level=warn
```

⚠️ `--rpc-listen-all` 必须是 **false**。`true` 等于把下载器暴露给整个局域网。

## 5. 协议

- 注册名：`HKCU\Software\Classes\komomagnet`
- 形式：`komomagnet://add?uri=<URL 编码的 magnet>`
- handler：`powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "<安装目录>\scripts\add-magnet.ps1" "%1"`
- 解析规则：取 query 里 `uri`（先 `[uri]::UnescapeDataString`），**必须是 `magnet:?` 开头**，否则退出码 2
- 单实例：RPC 已经在跑就不重复启动；用 `port.txt` + RPC ping 判断，不要用 Mutex（PowerShell 里没必要）
- 兼容：**同时注册 `komoconvert://` 指向同一个 handler**，让已装的旧链接不至于失效（旧工具仍可独立存在）

⚠️ 不要用 VBScript：Windows 11 24H2 起 VBScript 属于逐步移除的特性。

## 6. 与 GameHub 的接口契约（前端直接调 aria2 RPC，不经过自定义后端）

服务地址：`http://127.0.0.1:<port>/jsonrpc`（端口从 6800 起探测）

| 用途 | 方法 | params |
|---|---|---|
| 探活/版本协商 | `aria2.getVersion` | `["token:komomagnet-local"]` |
| 加磁力 | `aria2.addUri` | `["token:…", ["magnet:?xt=…"], {"dir":"<配置里的目录>","seed-time":"0"}]` |
| 单任务进度 | `aria2.tellStatus` | `["token:…", gid, ["status","totalLength","completedLength","downloadSpeed","errorMessage","files"]]` |
| 全部速度 | `aria2.getGlobalStat` | `["token:…"]` |
| 暂停/继续/删除 | `aria2.pause` / `unpause` / `remove` | `["token:…", gid]` |

前端降级链（写死在网页里，不依赖工具的返回值）：
1. `getVersion` 通 → 已安装，直接 `addUri`，进度用 `tellStatus` 轮询（1s）
2. 不通 → 唤起 `komomagnet://add?uri=…` → 800ms 后重试 `getVersion`，通即成功
3. 三次都不通 → 落回现有云下载弹窗，并给安装入口

**这条链替代现在 v10.101 的 2.2 秒失焦猜测**——不用等、不会误判。

## 7. PNA 处理（唯一的未定风险）

实测已放行，但预检响应缺 `Access-Control-Allow-Private-Network: true`。

要求：
1. 用**有头** Edge + Chrome 各点一次真实磁力按钮，记录浏览器版本与结果到 `README.md`
2. 若任一浏览器拦截：在 `scripts/` 加一个 40 行以内的 PowerShell `HttpListener` 反代（监听 6800，转发到 aria2 的内部端口 6801），
   反代响应补 `Access-Control-Allow-Private-Network: true`；**写清这是为兼容而存在的补丁**
3. 不许用「让用户关掉安全策略」这种解法

## 8. 安装 / 卸载

`install.ps1`（per-user，**不要求管理员**）：
1. 复制 `bin/` 到 `%LOCALAPPDATA%\KomoMagnet\`
2. 写 `config.json`（下载目录、端口、secret），已存在则不覆盖
3. 注册 `komomagnet://`（和 `komoconvert://`）
4. 开机自启：写 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`，值 `KomoMagnet`
   → `powershell.exe -WindowStyle Hidden -File "<安装目录>\scripts\start.ps1"`
   （安装时用参数 `-NoAutostart` 可跳过）
5. 立即启动一次，ping 通才算安装成功；失败要打印真实原因（端口占用/权限）
6. 写 `install.log`，便于「点了没反应」时排查

`uninstall.ps1`：删协议项、删自启项、停 aria2 进程、**保留** `Downloads\KomoMagnet` 里已下完的文件（要删得显式传 `-PurgeDownloads`）。

## 9. 合规（不可省）

- aria2 是 **GPLv2**：分发必须带 `COPYING`，README 写明版本、来源、源码获取地址
- 不要夹带 7zip/ffmpeg 等任何无关二进制
- 不做 BT 搜索、不做 DHT 索引、不做种子站爬取 —— 只接受用户给的 magnet

## 10. 验收（跑完把原始输出贴回来）

```powershell
# 1 体积
Get-Item output\KomoMagnet-*.zip | Select Length,Name

# 2 安装后探活（端口以 port.txt 为准）
curl.exe -s -X POST -d '{"jsonrpc":"2.0","id":"1","method":"aria2.getVersion","params":["token:komomagnet-local"]}' http://127.0.0.1:6800/jsonrpc

# 3 加一个假磁力再删掉（验证链路，不真下载）
#    btih 用 40 个 0，addUri 应返回 gid，随后 aria2.remove 成功
# 4 协议注册
reg query HKCU\Software\Classes\komomagnet /s

# 5 进程只有一个
Get-Process aria2c | Measure-Object
```

## 11. 硬约束

1. **不改 Komo-Convert**：只复制它的 `aria2c.exe` 和 `COPYING`，原项目一行不动
2. 不装任何编译工具链（Go/Rust/.NET），选了就是跑偏
3. 不写 `HKLM`，不需要管理员权限
4. 不把下载目录默认设成 C 盘根目录或桌面
5. 不把二进制塞进 git 大文件历史（`bin/*.exe` 进 `.gitignore`，打包时由 `build.ps1` 取）
6. 本轮**只做 Komo-Magnet**；GameHub 网页侧的对接改动由另一边单独发版（v10.102），不要顺手改 game-aggregator

## 12. 交付

按顺序回，不要长文：

1. 生成的文件清单 + 总 zip 体积
2. 端口、secret、默认下载目录的实际取值
3. 验收 5 条命令的原始输出
4. PNA 有头实测结论（浏览器 + 版本 + 结果）
5. 没做完或做不到的，直接列出来
