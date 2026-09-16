# CODEX-DONE v10.6 — 云存档「点不进详情页」根治：跨源名称匹配补两层 + 防误配护栏

> 日期：2026-09-14 ｜ 前置：v10.5（点击语义 / XD 详情解析 / 筛选条）
> 用户原始反馈（v10.5 已记录）：「有些并不是到游戏详情页的」「云存档点击未跳转」
> v10.5 修好了**有 libId 的卡片**的点击；本轮解决**根本没有 libId 的那一批** —— 那才是「点了没反应」的真正大头。

---

## 一、根因（一句话）

`tools/build-saves.js` 的「清单名 ↔ 端游库」匹配**只有精确钥匙一层**：

```
清单里的名字：  Resident Evil 2           → normKey → residentevil2
库内的全名：    Resident Evil 2:Remake    → normKey → residentevil2remake
                                        ↑ 精确不等 ⇒ libId = '' ⇒ 卡片没有详情页
```

`libId` 为空 → 前端云存档卡片点正文只会弹一句 toast，**不会打开任何详情抽屉**。

### 实测规模（修复前）

| 分区 | 卡片总数 | 有 libId（可进详情） | 无 libId（点了没反应） |
|---|---|---|---|
| 云存档 | 5,741 | 5,363 | **378** |
| 修改器 | 3,589 | 2,644 | 945（多为库内确无，属正常） |
| 手游中心 | 3,180 | 1,525 | 1,655（其中 1,277 有社区配置面板可兜底） |

那 378 条里，**122 条的标题其实就在库内精确存在**（如 `生化危机2：重制版/Resident Evil 2:Remake`）
—— 不是数据缺失，是匹配器漏了。

---

## 二、修法：两层匹配 + 三道防误配护栏

`tools/build-saves.js` 的 `matchRec()`：

```
① 精确钥匙            byKey.get(key)                       ← 原逻辑，最可靠
② 连续子串 + 护栏     库名更长 && 查询名是库名连续子串
                      && 数字不冲突 && 多出部分全是修饰词
```

护栏按 `cross-source-name-matching` 技能规范实现，**顺序不能调、缺一不可**：

| 护栏 | 作用 | 实例 |
|---|---|---|
| `numConflict` | 两侧都有数字却完全不重叠 → 冲突 | `residentevil0` ✗ `residentevil3remake` |
| `extraIsDecoration` | **多出来的部分必须能由修饰词拼成，不允许裸数字** | `baldursgate3` 的 `3`、`anthem9` 的 `9`、`bioshock2remastered` 的 `2` → 一律否决 |
| `SERIES_KEYS` | 中文副标题剥出的系列名基座**只允许精确命中，禁止模糊** | `合金装备`（否则串起整个系列） |

多候选时的取舍：**取「修饰最少」的那条**。能走到这一步的候选已被证明是
「查询名 + 纯版本修饰」，即同一款游戏的不同打包（`voices38` / `HYPERVISOR` / 终极版），
本站对该游戏只有一个详情页，取最接近裸标题的那个。
真正的歧义（`Crysis` → 2 / 3、`StarCraft` → 2 / Brood巢之战）在**裸数字**那一步就被拦掉了。

### 关键实现细节（三个踩过的坑，都写进注释了）

1. **锚点分桶**：`anchorOf()` 取 key 前 3 字符。
   ❌ 最初写 `k.match(/[a-z]+/)` —— 对**纯字母键**它会匹配整串，锚点 = 完整 key，
   分桶退化成「一键一桶」，于是**只有带数字的查询**（`residentevil2`，正则会在数字处停）才碰得上，
   `Another World` / `Drive Rally` 这类纯字母查询永远命中不了。
2. **词边界包含在「去空白键」上不成立**：`starcraftremastered` 整个是一个 token，
   `starcraft` 不算「完整词」→ 被误杀。真正能当分隔符的只有数字。
   → 删除 `safeContains()`，包含性与跨词子串防护**统一交给 `extraIsDecoration`**（更强：
   `timeline` 里的 `elin` 会留下 `demonstime` 这种拼不出修饰词的残渣）。
3. **修饰词白名单不能收 `vr`，也不能收单字母**（复核 247 条救回项时抓到的真实误配）：
   - `vr`：`Bulletstorm` → **子弹风暴VR**、`World War Z` → **僵尸世界大战VR**、
     `The 7th Guest` → **第七位访客VR**、`Townsmen` → **家园VR**、`Sniper Elite` → **狙击精英VR**
     —— VR 版是**独立作品、存档目录也不同**，不是同款版本。
   - 单字母 `a`：`Vesper` → **Vespera**（只多一个字母就混进来了）。

---

## 三、修完的数字（可复算）

| 指标 | 修复前 | 修复后 | 变化 |
|---|---|---|---|
| 云存档收录 | 5,741 | **5,923** | +182（此前匹配失败被整条丢弃的游戏现在能看到了） |
| 在端游库内（有 libId） | 5,363 | **5,609** | **+246** |
| 无 libId（点了没反应） | 378 | **314** | **−64（−17%）** |
| 其中经模糊层救回 | — | **237** | 逐条人工复核，零误配 |

### 浏览器端实测（`tools/preview-v106.js`）

```
云存档首屏 24 张卡 ｜ 有详情入口 21 ｜ 无详情入口 3
  无入口样例：生化危机：浣熊市行动 / Distance / Rocket League
抽点「怪物火车2/Monster Train 2」→ 抽屉 已打开 ｜ KV 游戏厂商/发行日期/更新时间/游戏大小/游戏类型/游戏标签
```

**首屏无入口：7/24 → 3/24。** 剩下 3 条均属合理：前者的清单名是裸 `Resident Evil`（库内多作歧义，
宁缺勿错），后两者**本地库确实没有收录**。

### 人工复核（`_preview/saves-rescue-review-final.txt`，237 条全量）

救回项全部正确，抽样：

```
Resident Evil 2          → [xd-89]    生化危机2：重制版/Resident Evil 2:Remake
Crysis 2                 → [xd-5007]  孤岛危机2：重制版/Crysis 2 Remastered
Silent Hill 2            → [xd-8922]  寂静岭2：重制版/SILENT HILL 2 Remake
StarCraft                → [xd-4525]  星际争霸：重制版/StarCraft: Remastered
Baldur's Gate            → [xd-415]   博德之门：加强版（**不是**博德之门3）
BioShock                 → [xd-301]   生化奇兵：重制版（**不是**第 2 代）
Rise of the Tomb Raider  → [xd-267]   古墓丽影10：崛起20周年版
Forza Horizon 4          → [xd-27]    极限竞速：地平线4终极版
```

---

## 四、新增：第五条防线 `tools/test-saves-match.js`（44 条）

**只测拦截会退化成「永不匹配」**，所以「该拦的」和「该放的」用例数量相当：

- 纯函数护栏 22 条：`extraIsDecoration` / `numConflict`，含本轮复核抓到的真实误配反例
  （`vespera` vs `vesper`、`bulletstormvr` vs `bulletstorm`）与当初踩坑的正例
  （`starcraftremastered` vs `starcraft`、`anotherworld20thanniversaryedition`）。
- 真实索引端到端 22 条：`buildIndex()` 建索引后走 `matchRec()`，断言**具体 libId**。

为让测试可用，`build-saves.js` 加了 `require.main === module` 守卫 + `module.exports`
（被 require 时只导出匹配器，不执行构建）。新增 `--dry` 干跑模式：
**不写文件、打印救回清单**，供人工复核 —— 本轮 237 条就是这么过了一遍。

---

## 五、基线（全绿）

| 套件 | 结果 |
|---|---|
| `tools/test-emulator-structure.js` | **104 / 104** |
| `tools/test-emulator-page.js` | **118 / 118** |
| `tools/test-emuhub.js` | **118 / 118** |
| `tools/test-filter-layout.js` | **77 / 77** |
| `tools/test-alias-guard.js` | **7 / 7** |
| `tools/test-saves-match.js`（新） | **44 / 44** |

页面未改动 —— `public/index.html` md5 `bb664b2885bb66d274203aafa464d9bf`、
`public/emulator.html` md5 `461e84307f0da1aa9e993a00a1bbf40f`，**与 v10.5 基线一致**。
本轮改动文件：`tools/build-saves.js`（md5 `75d142db1b09ed2424d348ec7bebeabf`）、
`data/saves.json`（md5 `24eb6030e2fa6a05b49b2cbe846bda11`）。
服务已用新数据重启（8123）。

---

## 六、回滚

`_bak/build-saves.js.bak-20260914-173504` 与 `_bak/saves.json.bak-20260914-173505`
是改动前的原文件，覆盖回去即可。

---

## 七、给 Codex 的建议（未实施，按优先级）

1. **同款补丁打到 `tools/fetch-trainers.js`**：它的匹配同样只有精确钥匙一层
   （`byName.get(normKey(en))`）。不过修改器表 945 条无 libId 里只有 3 条标题在库内，
   **收益远小于云存档那 378 条** —— 建议先做，但别期待大数字；优先复用本轮的 `matchRec`。
2. **把 `matchRec` 抽成 `tools/lib-name-match.js` 共用模块**：`build-saves.js` /
   `fetch-trainers.js` / `build-mobilehub.js` 三处各写了一套匹配（口径已经开始漂移）。
   本轮已把规范写进注释与测试，正是抽公共模块的最佳时机。
3. **steamId 桥梁（已量化，未做）**：`trainers.json` 同时有 `steamId` 与 `libId`（2,159 个唯一键），
   而云存档 378 条无 libId 中 330 条带 `steamId` —— 实测**只能救回 24 条**（且多数与名称匹配重叠），
   收益不足以抵偿「跨表强耦合 + 上游误配传染」，暂缓。
4. **UI 提示**：剩下 314 条（云存档）/ 945 条（修改器）永远进不了详情页，
   但卡片外观与可点卡片**完全一样**，用户点了才知道。
   建议给 `svCard` / `trCard` 加一个「未关联端游库」小角标，并把
   `moreLine`（现在写「另有 N 条存档位置未展示，**进游戏详情查看**」）在无 libId 时改掉
   —— 这句话在没有详情页时是**假的**。
5. **`data/games.json.bak-2026-09-14-08-25-34`**（5.8MB）可清理。

---

## 八、给 Codex 的可粘贴 prompt

```
项目：E:\新建文件夹\WorkBuddy\2026-09-03-16-11-58\game-aggregator
（先读 CODEX-DONE-v10.6.md 与 CODEX-INDEX.md 顶部增量块。基线：结构 104、行为 118、
 emuhub 118、布局 77、别名 7、saves-match 44，全绿。改完必须全跑一遍。）

任务：把「清单名 ↔ 端游库」的匹配器抽成公共模块，消除三处重复实现。

1. 新建 tools/lib-name-match.js，导出：
   normKey / anchorOf / tailNums / numConflict / extraIsDecoration / createLibrary
   —— 实现**原样搬** tools/build-saves.js 里这几个函数，**不要改判定规则**。
   createLibrary() 返回 { byKey, byAnchor, seriesKeys, put(k, rec), match(key, allowFuzzy) }，
   match() 内部即现在的 matchRec()（① 精确 → ② 连续子串 + 数字护栏 + 修饰词护栏，
   多候选取修饰最少者）。
2. tools/build-saves.js 改为 require 该模块，删除本地重复实现；
   保留 --dry 干跑、require.main 守卫、抽样打印，行为**必须与现在完全一致**。
3. tools/fetch-trainers.js 的匹配也切到该模块（现在只有精确钥匙一层），
   重建 data/trainers.json 后**打印前后「有 libId 条数」对比**，并抽样 30 条人工可复核的
   「修改器名 → 命中的库条目」清单（宁缺勿错，宁可少救回也别配错）。
4. tools/build-mobilehub.js 的匹配**本轮不要动**（它有自己更复杂的 stem/前缀逻辑，
   贸然统一会动到手游中心 1,525 条关联结果）。
5. 把 tools/test-saves-match.js 扩到覆盖新模块，并加一条「三处调用同一模块」的断言
   （例如 grep 源码不出现第二份 extraIsDecoration 实现）。
6. 验收：六套全部重跑，把结果贴出来；报告 「trainers 有 libId 条数 A → B」。
```
