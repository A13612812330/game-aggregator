# GameHub v10.1 —— 本轮我已完成 4 项（Codex 接手前先读这份）

> 完成时间：2026-09-14 ｜ 范围：**P0-3 · P0-2 · P1-1 · P1-6**
> 配套：`CODEX-HANDOFF.md`（项目全貌）· `CODEX-TASKS.md`（任务 prompt）· `CODEX-INDEX.md`（派发索引）
>
> **本文用途**：上面三份文档里对应这 4 条的条目**已经做完了**，请勿重做 ——
> TASKS 里那 4 个标题已标 `✅ [v10.1 已完成]`。要派活请从**剩余**的 P0-1 / P1-4 / P2-x / P3-x 里挑。
> 本文记录「实际怎么改的 + 验收数据 + 踩过的坑」，是本轮唯一的权威变更说明。

---

## 一、改动文件清单（7 个源码 + 1 条自动化）

| 文件 | 改动 |
|---|---|
| `server.js` | ① **端口真源统一**：L18 `const PORT = parseInt(process.env.PORT, 10) \|\| 8123`；L966 `listen(PORT, 30)`。原来是「常量写 3456 / listen 写 8123」两处矛盾 ② `/api/mobilehub/list` 新增 `only` 参数透传 |
| `data/mobilehub.js` | `list()` 新增 `only:'both'` 双料筛选（与 `stats` 是 **AND** 关系），返回值加 `bothOnly` |
| `tools/build-emulator-page.js` | `SECTIONS` 的 #emu 工具栏新增「✓ 只看双料」按钮骨架 |
| `tools/emulator-sections.js` | `emuState.both` + `localStorage('ghEmuBoth')` 记忆 + 查询串 `only=both` + 按钮绑定 |
| `public/index.html` | ① CSS `.emu-refresh.both` ② 详情抽屉三区块 CSS（`.d-blk` / `.d-tg` / `.d-tr-it` / `.d-sv` / `.d-hint2`）③ `paintDetail` 加 `#trBlock` / `#svBlock` 槽位与调用 ④ 新增 `loadBhBlock`（**修 bug**）/ `loadTrBlock` / `loadSvBlock` |
| `public/emulator.html` | **由生成器派生，勿手改** —— 跑 `node tools/build-emulator-page.js` 重新生成 |
| `tools/test-emulator-structure.js` | 新增 8 条断言（**45 → 53**） |
| 自动化「GameHub 内容库每日自动同步」 | 7 步 → **10 步**，纳入 `build-mobilehub` / `fetch-trainers` / `build-saves` |

---

## 二、★ 顺手修掉一个真实 bug（不在原任务清单里）

**`loadBhBlock` 孤儿调用**：v9.3 把手机专区拆成独立页时，这个函数的**定义被删掉了，但调用点还在**。

后果：`paintDetail` 执行到那一行会抛 `ReferenceError`，**它后面的代码永不执行**——

```js
linkCounterpart(d);        // 在这行之前 → 能执行
loadBhBlock(d, title);     // ← 这一行抛 ReferenceError
loadTrBlock / loadSvBlock  // （本轮新加，放在其后）
loadRelated(d);            // ← 永不执行 →「同分类更多」区块从来没显示过
```

也就是说，改动前首页详情抽屉里的 **「另一源也有收录」和「同分类更多」两个区块一直是坏的**（只是不报错、静默失败，不容易发现）。

**修法**：补回 `loadBhBlock` 的真实实现 —— 走 `/api/mobilehub/match?t=`，在抽屉里显示「📱 手机模拟器配置」徽标块（社区配置数 / 本站实测数 / 最佳帧率 / 档位）。

已加断言防回归：`详情抽屉 loadBhBlock 既有定义又有调用（防「孤儿调用」回归）`。

---

## 三、验收数据（可自行复核）

| 项目 | 命令 | 结果 |
|---|---|---|
| 结构体检 | `node tools/test-emulator-structure.js` | **53 / 53**（原 45，新增 8） |
| 行为回归 | `node tools/test-emulator-page.js` | **96 / 96** |
| 别名护栏 | `node tools/test-alias-guard.js` | **7 / 7** |
| 生成器幂等 | `node tools/build-emulator-page.js` ×3 → `md5sum` | 三连一致 |

**新 md5 基线**（改动前 `emulator.html` 是 `09916f1f…`；本轮改了源码，变了属正常）

```
public/emulator.html  5815e9d605e5f4d6f338d961e10bf2f2
public/index.html     2de36176ccdda6b269ec771da0638284
```

**双料筛选实测**（`GET /api/mobilehub/list`）

| 参数 | total | 说明 |
|---|---|---|
| 默认（仅匹配端游库） | 1522 | 基线未受影响 |
| `only=both` | **85** | 双料 且 匹配端游库（最实用口径） |
| `only=both&stats=all` | **88** | 双料全量 |
| `stats=all` | 3161 | 基线未受影响 |

**详情抽屉三区块实测**（jsdom 真调接口）

- 🛠 修改器《艾尔登法环》→ 4 个来源（社区贡献 / 风灵月影 / 小幸 / CE 修改表），含版本号
- 💾 云存档《只狼》→ `C:\Users\<用户名>\AppData\Roaming\Sekiro\<平台账号ID>\S0000.sl2` + ☁ STEAM + 手机能玩 + 安装目录
- 📱 手机配置 → 命中才显示；无收录的区块**保持空**（不占版面）

---

## 四、给 Codex 的注意点（含两个我踩过的坑）

1. **端口已固定 8123** —— `grep 3456` 在源码中**零命中**（只剩 `server.js` 注释里一句历史说明）。启动命令就是 `node server.js`。

2. **⚠️ 编辑约定（本机实测坑）**：**同一文件的多处修改，不要在同一次里并发提交** —— 会互相覆盖（读-改-写竞态）。
   > 实测：我一次并发改 `server.js` 两处（端口常量 + listen），结果只有后一处生效，前半处被静默回滚，导致服务短暂跑到了旧端口 3456。**请分次改，或用脚本做一次性原子替换。**

3. **三个 v10 索引是 mtime 惰性加载**：重新生成 `data/mobilehub.json` / `trainers.json` / `saves.json` 后**无需重启服务**，`data/*.js` 会按文件 mtime 自动重载。
   只有 `data/phonecfg.json` 是**启动时加载**，要重启才生效。

4. **⚠️ 别用全局字符串替换去改 `if (!items.length) return;`** —— `moveSug()` 里也有个一模一样的判断，但**那里没有 `slot` 变量**，替换后必抛错。我踩过，已回滚。

5. **剩余未做**：P0-1（扩端游库）· P1-4（补封面）· P2-1（同步滞后文档）· P2-2（拆大文件）· P2-5（引入 git）· P3-1（补测试，其中 **v10 分区部分已随本轮完成**）· P3-4（清理临时文件）。

6. **临时文件**：`_preview-cards.html` / `_preview-cards.js`（轮 19 遗留）**未动**；本轮产生的两个临时脚本已删除。

---

## 五、可直接复制的验收口令

```bash
cd "E:\新建文件夹\WorkBuddy\2026-09-03-16-11-58\game-aggregator"
curl -s http://127.0.0.1:8123/api/health
node tools/test-emulator-structure.js    # 期望 53 / 53
node tools/test-emulator-page.js         # 期望 96 / 96
node tools/test-alias-guard.js           # 期望 7 / 7
node tools/build-emulator-page.js && for i in 1 2 3; do md5sum public/emulator.html; done  # 三连必须一致
curl -s "http://127.0.0.1:8123/api/mobilehub/list?only=both&limit=1" | head -c 120        # 期望 total=85
```
