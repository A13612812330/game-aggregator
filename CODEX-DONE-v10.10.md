# CODEX-DONE-v10.10 —— 启动器三件套 + 线上共享链接

> 用户原话：「给我启动器+共享链接」

本轮无业务逻辑改动，交付**两样运维基建**：本地双击即用的启动器，以及一个可对外分享的线上地址。

---

## 一、共享链接（线上）

```
https://36aa37e911e6447eb86eb187240daff2.app.workbuddy.host
```

| 项 | 值 |
|---|---|
| 形态 | HTTP 服务（`http-service`，非静态站） |
| sandboxId | `36aa37e911e6447eb86eb187240daff2` |
| 发布目录 | `E:\新建文件夹\WorkBuddy\2026-09-03-16-11-58\game-aggregator` |
| 端口 | 8123（沙箱注入 `PORT`，`server.js` 读 `process.env.PORT`） |
| 安装命令 | `npm install` |
| 启动命令 | `node server.js` |
| 上传方式 | 源码压缩上传（自动排除 `node_modules`），沙箱内装依赖后启动 |

**线上实测**（发布后立即复验，全部通过）：

| 路径 | 结果 |
|---|---|
| `/` | HTTP 200 · 163,609 B · 0.81s · `<title>GameHub 聚合 · 机地 × XDGAME 单机游戏库</title>` |
| `/api/health` | HTTP 200 · 62 B |
| `/api/mods/stats` | HTTP 200 · 184 B · `total:8943 / matched:7076 / matchedRate:79.1 / byKind:{mod:7825,modifier:1118} / withLinks:8936 / linkTotal:13390 / games:883` |

★ 最后一项很关键：**v10.9 新加的 MOD / 修改器数据层在线上同样可用**（8,943 条完整返回），
说明 `data/mods.json`（24MB）随源码一并上传且沙箱内可正常惰性加载。

> 重新发布同一目录会**复用同一 sandbox**，链接不变、线上内容被覆盖。

---

## 二、启动器三件套

放在项目根目录，双击即用。

| 文件 | 用途 | 行为 |
|---|---|---|
| `启动聚合站.cmd` | **主入口**（前台，看得到日志） | 已运行 → 只开浏览器；未运行 → 打印地址栏（本地 + 局域网）→ 开浏览器 → 前台跑 `server.js` |
| `启动聚合站-静默.vbs` | 日常用（**无黑窗**） | 已运行 → 只开浏览器；未运行 → 隐藏窗口起服务 → 等 2.6s → 开浏览器 |
| `stop-gamehub.cmd` | 停止服务 | 按端口 8123 查 PID → `taskkill`；没运行则提示 |

### 关键设计

**① 端口占用检测（幂等启动）**——避免重复双击起出 8124/8125 一串实例：

```bat
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":8123 .*LISTENING"') do if not defined RUNPID set "RUNPID=%%P"
```

**② Node 定位（双保险）**——项目在 `E:\新建文件夹\…` 这种中文深路径下，且用户环境有 managed 运行时：

```
PATH 里的 node  →  回退 C:\Users\komo\.workbuddy\binaries\node\versions\22.22.2-2\node.exe
```

**③ VBS 不用 `cd /d` 拼命令行**——改用 `shell.CurrentDirectory = root` 再直接 `Run`：

```vbs
shell.CurrentDirectory = root
shell.Run Chr(34) & nodeExe & Chr(34) & " server.js", 0, False
```

绕开「中文路径 + 多层引号 + `&&` 嵌套」的经典翻车点（`cmd /c cd /d "中文路径" && "node" …` 在部分代码页下会挂）。

**④ 主入口顺带打印局域网地址**——手机 / 另一台电脑可直接连：

```bat
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /C:"IPv4"') do if not defined LANIP set "LANIP=%%a"
```

### 实测记录

| 检查项 | 结果 |
|---|---|
| `findstr /R /C:":8123 .*LISTENING"` | ✅ 命中 2 行（IPv4 + IPv6），取第 5 列 = PID `13660` |
| 同规则对 8124 | ✅ 不命中（无误报） |
| managed node 存在性 | ✅ `22.22.2-2\node.exe`（87MB）存在 |
| `启动聚合站.cmd` 全量执行 | ⚠️ 未在 CI 内实测（会真开浏览器窗口打扰当前会话）；检测片段已逐条验证 |

---

## 三、遗留

1. **旧文件 `启动聚合站.bat` 未删**（2026-09-04 建）。它的 node 回退路径写错了 ——
   `C://Users//komo//.workbuddy//binaries//node//versions//22.22.2//node.exe`（**双斜杠 + 版本号少了 `-2`**），
   回退分支必然失效。功能已被 `启动聚合站.cmd` 完全覆盖，建议删除或移入 `_archived/`。
2. **VBS 未实机验证**（本机安全策略拦截 `cscript`/`wscript`，无法在会话内执行）。
   逻辑为标准写法，首次双击请留意是否正常拉起。
3. `data/_mod-raw.json`（18MB）是 `fetch-mods.js --offline` 的缓存，**运行时不需要**，
   但会被一并上传。若在意发布体积，可移出目录或降级为 gz。
