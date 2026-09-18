# CODEX-DONE-v10.21 —— #33「联网补名」只做尾缀剥离这一刀 + 发布 v3 链接

> 用户原话：「**怎么样做 #33**，其次推送到分享链接 V10.20 版本」
> 日期：2026-09-18 · 上一版：v10.20（解包配置匹配新页面）

---

## 0. 一句话结论

**#33 的原始假设是错的。**「联网补名能把端游匹配率从 47.9% 提到 60%+」——
实测下来，**整条匹配链能贡献的上限只有 +1.0pp**（47.9% → 48.9%）。
要到 60% 必须**扩端游库**，那是另一个量级的工程。
本版只拿走**零误配的那一小刀**：发布尾缀剥离层，**净 +10 匹配（+0.5pp）/ 0 真退化**。

---

## 1. 为什么「补名」救不了 —— 把 1665 条未匹配逐条分类

没有抽样估算，用探针脚本把 **1,665 条未匹配全部逐条分类**（不是抽 3% 外推）：

| 类别 | 条数 | 真实性质 | 「补名」能救吗 |
|---|---|---|---|
| **A 类** | **777** | 端游库里**根本没有**这款游戏（新作 / 独立小品 / 手游移植） | ❌ 只能**扩库** |
| **B 类** | **473** | **假阳性** —— 朴素子串匹配的产物 | ❌ 是匹配器的错，不是缺名字 |
| **C 类** | **31** | 真·可修：名字带着发布组 / EXE 残留尾缀 | ✅ **本版做的就是这一类** |
| 其余 | ~384 | 已匹配但归并粒度不同 / 别名表缺条目 | 部分 |

**B 类举例（这是最值得警惕的一类）**：

| 社区库条目 | 朴素子串匹配命中 | 为什么会命中 |
|---|---|---|
| `Pro Evolution Soccer 2013` | 「万物皆可蟹：动物进化」 | 两边都含 token `Evolution` |
| `The Witcher Game` | 巫师3 | 剥掉 `Game` 后词干只剩 `The Witcher`（**跨代际**） |
| `Tropico Reloaded` | 海岛大亨 6 | `Reloaded` 被当成发布标记剥掉（**其实是 1+2 合集**） |

⇒ 结论：「补名」不是解法；**先把匹配器的误配通道收紧**才有意义。

**可修上限的实测值**：严格可修 **31 条** + 3 处精确补丁可再救 **33 条** ≈ **+1.0pp**。
这直接否掉了「做完 #33 就到 60%」的排期假设。

---

## 2. 本版实现的唯一一刀：发布尾缀剥离层

**改的文件**：`tools/build-mobilehub.js`（数据侧；产物 `data/mobilehub.json` 重建）

社区库的游戏名常带发布组 / EXE 残留尾缀，对不上端游库的干净标题：

| 社区库原名 | 剥离后 | 端游库标题 |
|---|---|---|
| `Stellar Blade Demo` | `Stellar Blade` | 剑星 / Stellar Blade |
| `eFootball PES 2021 SEASON UPDATE` | `eFootball PES 2021` | 实况足球2021 / eFootball PES 2021 |
| `Football Manager 26 Demo` | `Football Manager 26` | 足球经理26 |
| `Shift At Midnight Demo` | `Shift At Midnight` | 午夜轮班 / Shift At Midnight |
| `怪物火车2 支持者版` | `怪物火车2` | 怪物火车2 / Monster Train 2 |

**`RELEASE_SUFFIX` 覆盖**：`demo` / `showcase` / `season update` / `multiplayer` / `application` /
`game` / 中文版别（`虚拟机版` `支持网络联机` `正式版` `支持者版` `整合版` `免安装版`）/
`voices<N>` / `klite` / `HYPERVISOR` / 发布组名（`repack fitgirl dodi codex plaza skidrow empress
rune tenoke elamigos razor1911 3dm`）。

---

## 3. ★ 尾缀剥离是危险操作 —— 两道护栏 + 一个作用域限制

### 3.1 为什么危险

剥掉尾缀后**查询串变短**，词干通道会**跨代际乱配**。实测抓到的 4 个错配：

| 剥离前 | 剥离后 | 错配到 | 性质 |
|---|---|---|---|
| `The Witcher Game` | `The Witcher` | 巫师 3 | 跨代际 |
| `AssassinsCreedIIGame` | `AssassinsCreedII` | 刺客信条 3 | 罗马数字 II ≠ III |
| `Tropico Reloaded` | `Tropico` | 海岛大亨 6 | 1+2 合集 ≠ 6 |
| `MaxPayne` | — | 马克思佩恩 3 | 跨代际 |

### 3.2 两道护栏

| 护栏 | 位置 | 判据 |
|---|---|---|
| `numConflictStrict` | 严格匹配前 | 查询**无数字**而库里**有数字** ⇒ 不许配（不许「代际不明就猜」） |
| `sequelTail` | 严格模式的前缀包含通道 | 先 `while` 循环剥掉 `EDITION_WORDS`（`remastered` 等），若**剩余串整体**是续作序号（`i ii iii iv v vi`）⇒ 不许配 |

★ `sequelTail` 里「先剥版本词」这一步是**必须**的：早期实现直接用 `(?![a-z])` 判 `iremastered`，
结果 `i` 被当成非续作序号 → `Assassin s Creed II` 仍然错配到刺客信条 **3**。

★ **`Reloaded` 故意不剥**：`Tropico Reloaded` 是 1+2 **合集**（≠ 海岛大亨 6），
而 `Just Cause 4 Reloaded` 的 `Reloaded` 只是发布标记（= JC4）—— **两者无法区分，索性不剥**。
（这一条钉进了测试，防止后人「顺手补上」。）

### 3.3 ★ 作用域限制：护栏只放 `strict` 模式（4 退 1 进）

把 `sequelTail` 也加到**既有通道**后：修好 **1** 条错配，却**打坏 4 条正确挂载**——

| 被误杀的挂载 | 为什么它是对的 |
|---|---|
| `Trails in the Sky` → 空之轨迹 the 2nd | 系列名 → 库里唯一那代 |
| `SkullGirls` → 2nd Encore | 同上 |
| `Rise of the Tomb Raider` → 20 Year Celebration | 同上 |
| `Command & Conquer Red Alert` → 红色警戒 2 | 同上 |

这些是**故意设计的「系列名 → 库里唯一存在的那一代」**挂载，不是错配。
⇒ **护栏作用域收回到 `strict` 模式**，既有通道维持原样。

---

## 4. 效果（真实数据对照）

`tools/diff-mobilehub.js` 对 `data/mobilehub.json` 与最近一次备份逐条比对：

| 指标 | 改动前 | 改动后 | 差 |
|---|---|---|---|
| 合并条目 | 3195 | 3181 | −14（同款归并） |
| **匹配端游库** | 1530 | **1540** | **+10** |
| 未匹配 | 1665 | 1641 | −24 |
| 配置总数 | 15394 | **15394** | **0（未丢）** |
| **匹配率** | **47.9%** | **48.4%** | **+0.5pp** |

**新增匹配 11 条**（其中 1 条原条目在归并中被并入，故净 +10）：

```
eFootball PES 2021 SEASON UPDATE → 实况足球2021
States of Power Demo            → 强权列国
怪物火车2 支持者版                → 怪物火车2
G-Rebels Demo                   → 反叛之鹰
Decktamer Demo                  → 驯牌师
Drive Beyond Horizons Demo      → 驾驶地平线
Football Manager 26 Demo        → 足球经理26
Iron Meat Demo                  → 钢铁之躯
Log Riders Demo                 → 圆木骑士
Pixel Empires Demo              → 像素帝国
Shift At Midnight Demo          → 午夜轮班
```

**★ 真退化 0 · 换匹配目标 0**（差分脚本判定：退化为 0 才 exit 0）。

---

## 5. 防线

| 防线 | 结果 |
|---|---|
| **静态防线** `node tools/run-all.js` | **18 套 1163 / 0**（新增 `test-match-release.js` 已进 `SUITES`） |
| 新增 `tools/test-match-release.js` | **42 / 42** |
| 新增 `tools/diff-mobilehub.js` | 差分 exit 0 |

**`test-match-release.js` 四段结构**：A 产物侧（尾缀剥离生效）· B 产物侧（剥离路径的把关，
`Tropico Reloaded` / `The Witcher Game` 必须**不匹配**）· C 源码侧（护栏存在性 + **作用域**）·
D 注释里留下踩坑记录。

### ★ 反证（本版最值得记的一条）

套件里有一条断言原本只检查**常量名 `EDITION_WORDS` 是否存在** —— 这是**假断言**：
把 `sequelTail` 的循环整段删掉，常量还在，断言照样绿。

用**反证**（故意打坏护栏 → 断言必须变红）把它抓了出来。
⚠️ 反证脚本自己也踩了坑：第一版用全局替换改到了 `stem()` 里**长得一样的循环**，
不是 `sequelTail` 的 —— 改成**按函数体精确切片**后才验证正确。
最终断言要求 `while` + `endsWith` + `EDITION_WORDS` **三者同时出现**。

> 教训：**断言要测「行为」，不要测「名字」**；写完断言必须做一次反证。

---

## 6. 发布

用户要求「推送到分享链接」。**旧链接无法更新**：

```
❌ 应用预留域名 gamehub-agg-v2.app.workbuddy.host 未绑定到本次发布环境，
   为避免返回仍指向旧内容的链接，本次发布已停止。
```

按项目既有先例（v10.17 / v10.18 各踩过一次，已记在 `MEMORY.md`）：
旧 sandbox 过期 ⇒ **只能新建 app，链接会变**。这个拒绝是**对的** ——
它挡住「发布成功但链接还指着旧内容」的**假成功**。

| 项 | 值 |
|---|---|
| **新链接** | **`https://gamehub-agg-v3.app.workbuddy.host/`** |
| sandbox | `0a588ae0f9804365957be18fce404dad` |
| appId | `wbapp_WNoF5maytwivZ60TUa6CPA` |
| 形态 | HTTP 服务（`npm install` + `node server.js`，`PORT=8123`） |
| 旧链接 `gamehub-agg-v2` | 降级进 `DEPRECATED`（返回 200 但停在 v10.19 之前） |

**同步改动**（链接变了必须一起改，否则下次又有人照旧链接验收）：
`tools/report.js` 的 `LINKS` · `tools/test-report.js` 的链接断言（v2 → v3 + v2 进弃用清单断言）·
`README.md` · `WORKFLOW.md` · `HANDOFF.md` · `CODEX-HANDOFF.md` · `CODEX-INDEX.md` 顶部块 ·
`.workbuddy/memory/MEMORY.md`。

---

## 7. 遗留（如实列）

| # | 遗留 | 说明 |
|---|---|---|
| 1 | **匹配率 60% 必须靠扩端游库** | A 类 777 条库里根本没这款游戏。匹配链已接近榨干（+1pp）。这是 **P0，未开工** |
| 2 | **B 类 473 条假阳性** | 说明**朴素子串匹配仍在用**。这是下一版值得单独攻的点（比补名收益大得多） |
| 3 | 解包 JSON 样本仍未到 | v10.20 的 `data/spec-dict.js` 字段映射待校准 |
| 4 | ~384 条「已匹配但归并粒度不同 / 别名缺失」 | 需要人工抽样定规则，不适合自动批处理 |
| 5 | `applications.yaml` 有 3 条同名 app 记录 | 每次域名绑不上都要新建，列表在堆积；需要时可在「设置—数据管理—应用」里清理旧的 |
