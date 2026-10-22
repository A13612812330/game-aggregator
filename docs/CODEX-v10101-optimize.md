# Codex 任务：GameHub v10.101 收尾 + 磁力唤起实测优化

> 给 Codex 桌面版直接粘贴的 prompt。仓库：`E:\新建文件夹\WorkBuddy\2026-09-03-16-11-58\game-aggregator`
> 生成时间：2026-10-22 13:40（现测事实，不是回忆）

---

## 0. 你现在的处境（先读，别自己重新探索）

- 分支 `feat/v10.92-fitgirl-download-ui`，HEAD `b3b0eab`，**工作区有未提交改动**
- 未提交清单（现测 `git status --porcelain`）：
  `.gitignore` · `public/emulator.html` · `public/extract.html` · `public/index.html` ·
  `public/resources.html` · `public/unpack.html` · `tools/run-all.js` · `tools/test-v1093-downloads.js`
  · 未跟踪：`tools/test-v10101-handoff.js`
- 功能已实现并跑通：点 FitGirl 磁力 → 唤起本机 `komoconvert://` 协议 → 2.2s 失焦判定 → 未唤起则落回云下载弹窗
- 测试基线（不要试图改绿）：`test-v10101-handoff.js` **25/25**；全量 `run-all.js` **5,034 通过 / 6 失败**，
  6 条全是既有红（v1017 型号漂移 2 + v1018 联网 3 + 游侠 stats 1）
- 本版**文档还没写**：`docs/versions/v10.101.md` 不存在

**先跑这三条确认现状，输出贴给我，再动手**：
```bash
cd "E:/新建文件夹/WorkBuddy/2026-09-03-16-11-58/game-aggregator"
git log --oneline -3 && git status --porcelain
node tools/test-v10101-handoff.js
```

---

## 1. 任务 A：收尾（必做，顺序执行）

### A1 写 `docs/versions/v10.101.md`
结构对齐 `docs/versions/v10.99.md`：`## 用户原话` → `## 做了什么` → `## 为什么这么做` → `## 实测` → `## 遗留`。
必须写进去的三个事实：
1. 网页**没有 API** 能判断某协议是否已安装 ⇒ 只能「尝试唤起 + 失焦反推」，误判方向安全（磁力仍在）
2. 安装包放本站 `/dl/` 而不是 GitHub Release ⇒ **私有仓库 Release 资产对未登录访客 404**
3. 与 v10.93「不装本地工具」的前提**已作废**（用户改主意，v10.101 起主动引导装工具）

### A2 `docs/versions/README.md` 索引加一行 v10.101（保持表格列数一致）
⚠️ `test-doc-structure.js` 有一条硬断言：**索引行数 = 日志文件数**（现测 100 / 100）。
加了 `v10.101.md` 就必须同批加索引行，否则直接红。

### A3 `README.md` 的「当前版本」段更新为 v10.101，一句话描述即可（**不要**把版本史堆回 README）

### A4 `PITFALLS.md` 追加（现测最大号 **192**，从 **193** 开始；格式照抄 `193. ★★ **标题**（v10.101）：`）
- 网页无法探测协议安装状态，失焦启发式是唯一信号（Steam/Discord 同法），代价是误判与 2.2s 等待
- 私有仓库 Release 对访客 404 ⇒ 二进制走同域静态目录
- `Aria2Session` 用 `TcpListener(..., 0)` 随机端口 + 随机 secret ⇒ 网页不可能直连 RPC（别想着绕）
- 注入式测试（`new Function` 拼源码）漏注入新常量 ⇒ 整片红，先补上下文再怀疑断言

### A5 提交
- **一个新 commit**，不要 amend；message 前缀 `v10.101 `
- 推分支 `feat/v10.92-fitgirl-download-ui`，再快进 `main`
- 代理需现探：`git -c http.proxy=http://127.0.0.1:<现探端口> -c http.sslBackend=openssl push`
- 推完 `git show --name-only HEAD` 贴出来核清单（**提交内容 ≠ 你以为的内容**，是反复踩过的坑）

---

## 2. 任务 B：实测优化（每条都必须先验证、再改、再补断言）

### B1 点击到唤起之间是「真空期」
现状：`kcTryHandoff` 先 `await fetch('/api/fitgirl/magnet')` 拿磁力，期间界面无任何反馈；
冷缓存可能要几百 ms，用户会以为「点了没反应」再点第二次（重复请求 + 重复唤起）。
改：点击后**立即** toast「正在获取磁力…」；加 `kcBusy` 锁，执行中重复点击直接 return。
验收：新测试断言 ①点击后同步出现提示 ②连点两次 fetch 只发 1 次。

### B2 判成功之后没有回头路
现状：`toast('已交给 Komo Convert…')` 2.4s 就消失。若用户当时恰好手动切了窗口（误判成功），
磁力既没复制也不弹云下载，用户只能自己猜。
改：成功态给一条**可点的**「没反应？改用云下载」入口（停留 ≥20s 的轻条，不是 toast），
点击后走 `fgcOpen(slug, title)`。
验收：断言兜底入口存在 + 点击后 `fgcOpen` 被调用（打桩计数）+ 反向断言「失败路径不出现该入口」。

### B3 2.2s 是拍的值，冷启动会踩线
实测背景：.NET 单文件首次启动要解压，出窗口 1–3s。
改：首次唤起（`localStorage` 无 `kc_cold` 记录）用 **3200ms**，之后回落到 2200ms；
判成功后写 `kc_cold=1`。**不许**因此放宽移动端判断（`KC_DESKTOP` 逻辑保持不动）。
验收：断言两档时长取值正确 + 反向断言移动端仍直接 return false。

### B4 触屏笔记本会被当成桌面
现状：`KC_DESKTOP` 只看 `matchMedia('(hover: hover) and (pointer: fine)')`，触屏本子两种都满足。
改：加 UA 粗筛 `/Android|iPhone|iPad|iPod|Mobile/i` 直接 false。
验收：打桩 UA + 打桩 matchMedia 双组合共 3 条（真桌面 true / 手机 UA false / 触屏本=true 可接受并写注释）。

### B5 隐藏 iframe 触发外部协议在新版 Chrome/Edge 是否仍被拦 —— **先测，不许猜**
做法：写一个最小验证页（放 `_probe/` 下，不进 `public/`），在 Edge 与 Chrome 各手动点一次，记录：
① iframe 方式是否弹「打开 KomoConvert?」② 若被拦，改成临时 `<a href>` + `el.click()` 是否可行。
**把实测结论写进 `public/index.html` 的注释里（带浏览器版本号）**。
如果两种都被拦：不改代码，只在文档里记「需要用户手势 + 顶层导航，当前方案降级为复制磁力」，
并把降级路径实现成「先复制磁力到剪贴板 + toast 提示手动打开工具」（这条必须真的能用）。

---

## 3. 任务 C：硬约束（违反即返工）

1. **不许碰 `../_deploy-gamehub/`** —— 那是发布载荷，部署在 WorkBuddy 侧做，你只管源码仓
2. **不许把 97MB 的 zip 加进 git**（`public/dl/*.zip` 已 ignore）
3. 改了 `public/index.html` **必须重建四张派生页**：
   `node tools/build-emulator-page.js && node tools/build-unpack-page.js && node tools/build-resource-page.js && node tools/build-extract-page.js`
   并跑 `node tools/test-pages-sync.js`（派生页 `body` 必须带 `data-page` 标记，历史上有 5 个版本因此顶栏「首页」失效）
4. **既有 6 条红不许改绿**（改断言放宽 = 掩盖回归）；你的目标是「通过数只增不减，红数仍为 6 且是同一批」
5. 每条新行为配**正向 + 反向**两条断言（只写正向等于没写）
6. 注释里不要写会跟负向断言打架的实现细节（负向断言剥注释后再判）
7. **不碰仓库外的东西**：`Komo-Convert` 在 `E:\新建文件夹\Codex-GPT\tools\Komo-Convert`，若你认为必须改工具端，**停下来先问我**，不要自行修改
8. 日期、名单、数量**不写死**在断言里（要么现测，要么从源取）

---

## 4. 验收（跑完把原始输出贴给我，别只给结论）

```bash
cd "E:/新建文件夹/WorkBuddy/2026-09-03-16-11-58/game-aggregator"
node tools/test-v10101-handoff.js          # 期望 25 + 新增条数，全绿
node tools/test-pages-sync.js              # 全绿
node tools/test-resource-page.js           # 162 全绿
node tools/test-emulator-structure.js      # 289 全绿
node tools/run-all.js                      # 期望 X 通过 / 6 失败（失败项与基线一致）
git show --name-only HEAD
```

## 5. 交付格式

按这个顺序回我，**不要长篇**：

1. 改了什么（文件 + 一句）
2. 测试：通过数 / 失败数（失败项是否仍是那 6 条）
3. B5 的实测结论（哪个浏览器、哪个版本、拦没拦）
4. commit hash + 是否已推到远端（`git ls-remote` 比对，不要只说"推了"）
5. 你觉得没做完或做不动的，直接列出来
