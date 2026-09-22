# v10.36 —— 2-A + 2-C 跨源名字匹配优化：唯一真源 + 代际护栏

> 承接 `ROADMAP.md` 阶段二 **2-A（收朴素子串假阳性）+ 2-C（手游中心匹配率）**，
> 用户 2026-09-21 决策「一起做」、随后「行，优化下」授权开工。
>
> 本轮改动面：**1 个新模块 + 4 个文件**（`data/name-normalize.js` 新建；
> `data/phonecfg.js`、`data/mobilehub.js`、`tools/build-mobilehub.js`、`tools/test-shared-destructure.js` 修改）。
> `server.js` 与 `public/*.html` **一律不动** ⇒ 前端字节未变（已 `git status public/` 实测为空）。
>
> ★ 本轮**先量再改**：改之前先建了「三桶分类」探针（`tools/_probe-match-audit.js`），
> 把「未匹配」拆成 **残渣名 / 库中确无 / 护栏拦截 / 匹配器漏**，否则「改完变好了」无法证明。

---

## 一、先说病在哪：一个匹配器，两份实现，零条代际护栏

`ROADMAP.md` 记的 2-A 症状是「未匹配里 473 条假阳性」。**开工前重测，这条数字已过期** ——
真实症状是**两个各自独立、互不相干的问题**：

| # | 症状 | 根因 | 表现 |
|---|---|---|---|
| 1 | 同一套归一化在 **3 个文件**里各写了一份 | 没有唯一真源；三份的字符类**互不一致**，**且都漏剥 `™ ® ©`** | `摇鼠灵™` / `STAR WARS™` / `eden＊` 这类名字永远配不上；`FINAL FANTASY VII` 与 `FINAL FANTASY VII Steam Edition` 走两条路 |
| 2 | 数字/代际完全不做校验 | 匹配器只看「像不像」，不看「是不是同一代」 | `Call of Duty Modern Warfare 2 2009` 挂到 **使命召唤16**（2019）、`Grand Theft Auto 5` 挂到**增强版**、`Street Fighter 6` 挂到**虚拟机版**、`Crysis 2` 挂到**孤岛危机：重制版** |

**注意 #1 的隐蔽性**：三份归一化都能跑、都不报错，只是结果微微不同 ——
这是典型的「漂移源」，不修的话**以后每加一个调用方就多一份分歧**。

---

## 二、量化先行：三桶分类（`tools/_probe-match-audit.js`）

探针把「未匹配」逐条分类（全量不抽样），**只有 C 类是可修的**：

| 类 | 含义 | 为什么不可修 / 可修 |
|---|---|---|
| **Z** | 残渣名（`unins000` / `Setup` / `Launcher` / `2016` / `DP`） | 安装包/exe 残留，**本就不可能匹配**。留在分母里会让「匹配率」永远上不去，却与匹配器好坏无关 |
| **A** | 库里确实没有（无任何候选相似度 ≥ 0.72） | 数据缺口，不是匹配器的错 |
| **B** | 护栏正确拦截（朴素子串会命中，但**该拦**） | 反例样本，改动时**必须保持被拦** |
| **Bc** | 高相似但有硬冲突（数字/年份/跨文种/弱子串） | 同 B |
| **C** | ★ **匹配器漏**（高相似且无冲突） | **唯一可修**，天花板 = C / 剔除残渣后的分母 |

★ 探针本身踩过一个坑、值得记下：**「高相似」桶一度被撑到 900+ 条、全是假的** ——
`similarity()` 里有「一方包含另一方 ⇒ 0.82」的捷径，而大表段（`N++`）会产生
**1 字符键 `n`**，它与任何含字母 n 的长名都会拿到 0.82。
修法：`ranked.filter((i) => KEYS[i].key.length >= 3)`，且门槛只筛「候选键」，不筛查询名。
修后 C 类从 112 → **149**（原先被这些假高相似挤掉了）。

---

## 三、四处改动

### ① `data/name-normalize.js`（**新建**）—— 归一化唯一真源

```js
const SYMBOLS = /[™®©°′″·・:：,，.。!！?？'"“”‘’()（）\[\]【】<>《》|｜/\\~～\-–—_+*&#@$%^;；＊]/g;
function normKey(s) { … toLowerCase → 去空白 → 去 SYMBOLS … }
```

三个原实现里**都漏了 `™ ® ©`**（本轮新加，并补了 `＊` 全角星）。
`data/phonecfg.js` / `data/mobilehub.js` / `tools/build-mobilehub.js` 改为解构引用，
删除各自的本地定义。

★ 断言用的是 **`pc.normKey === NN.normKey`（`===` 比函数同一性）**，
比「行为像」强 —— 行为断言在「两份实现刚好都对」时会**假绿**。

### ② `genNums`：取数必须在 `normKey` **之前**

这是本轮最反直觉的一处。初版从**归一化后的钥匙**取数字，结果：

| 查询 | 归一化后 | `\d{1,4}` 切出 | 后果 |
|---|---|---|---|
| `Call of Duty Modern Warfare 2 2009` | `…warfare22009` | `[2200, 9]` | 与库里 `…Modern Warfare 2 (2009)` 的 `[2, 2009]` **不相交** ⇒ **正确匹配反被判冲突** |

一次误杀 4 条正确匹配（CoD MW2 2009 / F1 2014 / 啪嗒砰 1+2 重制版 / Warhammer 40,000 全线）。
修法：**原始串取数**，并摘掉「贴字母数字」（`x64`/`zomboid32`/`dx11` 不是代际号）、只认 1~2 位。

实测（`test-v1036.js` 表驱动 13 例）：

| 输入 | genNums |
|---|---|
| `Call of Duty Modern Warfare 2 2009` | `['2']` |
| `F1 2014` / `Dead Space 2008` | `[]`（4 位年份不是代际号） |
| `Warhammer 40 000 …` | `['40']` |
| `啪嗒砰 1+2 重制版` | `['1','2']` |
| `ProjectZomboid32` / `TheWalkingDead2` | `[]`（贴字母） |
| `Universe Sandbox x64` | `[]` |
| `桥梁建造师3` | `['3']` |

### ③ 代际护栏 `numMismatchByTitle`：挂满**每一条**返回通道

判据：**查询有代际号、而命中的库条目整条标题里一个数字都不含** ⇒ 拒。

★ 只做**这一个方向**（零和收窄），反方向会打掉 4 条正确匹配：

| 查询 | 正确目标 | 若做反方向护栏 |
|---|---|---|
| `Tomb Raider` | 古墓丽影9**终极版** | 误杀（查询无数字、目标有 9） |
| `SkullGirls` | 2nd Encore | 误杀 |
| `Trails in the Sky` | the **2nd** | 误杀 |
| `Red Alert` | 红色警戒**2** | 误杀 |

★ 护栏必须挂在**每条**返回通道上，而不是「主通道」 ——
`build-mobilehub.js` 的 `libMatchCore` 有**五处**返回点、`phonecfg.js` 的 `libMatch` 有**三处**。
漏挂任何一处的失败形态是「**改完变差了一点点**」，**没有任何报错**。
套件里有一条「≥5 处（实际 7）」的源码断言专门守这个。

### ④ 尾缀剥离 + CJK 版本词（顺带把匹配面扩大）

`RELEASE_SUFFIX` 新增（**必须带分隔符**，否则会啃掉作品名）：

| 新增项 | 作用 |
|---|---|
| `\s+[-–—]?\s*(d3d\|dx)\s*1[0-2]\s*$` | `Blacklist DX11 game` |
| `(x64\|x86\|win64\|win32\|64bit\|32bit)` | `Universe Sandbox x64` |
| `(vulkan\|opengl)` / `(loader\|launcher\|bootstrapper)` / `(portable\|offline\|online)` | `Rebel Galaxy Launcher` |
| `(steam\|epic\|gog)\s+(edition\|version)` | `FINAL FANTASY VII Steam Edition` |

`EDITION_WORDS` 新增 14 个 CJK 版本词（`终极版`/`豪华版`/`决定版`/`重制版`/`复刻版`…）。
★ 保留反例断言：**表里不许有 `reloaded`** —— `Tropico Reloaded` 是作品名，剥了就配错。

★ **两处「看着该改、实测不该改」**，都保留原值：

| 候选改动 | 实测 | 结论 |
|---|---|---|
| 前缀包含阈值 `whole.length >= 8` → `10` | **丢 18 条正确匹配、只换回 1 条假阳性** | **保持 8** |
| `RELEASE_SUFFIX` 加 `\s*application\s*$` | `… — Application` 被剥成 `…—`，而 `application` 是 `stripRelease` 的**终止条件** ⇒ **死循环** | 不加 |

死循环的形状值得记：**修完产生触发条件，触发条件又生出新缺陷** ——
`DEMO 版` → 剥「版」→ 变 `DEMO` → 再剥 `demo` → 空。
所以**判空要放在循环之后**、用 `>= 3` 长度闸。

### ⑤ 守卫泛化：`tools/test-shared-destructure.js`

原守卫把 `shared.js` **写死**在代码里 ⇒ 新建共享模块（比如本轮的 `name-normalize.js`）
**立刻漏网**。改成**自动发现**：扫出所有「被 ≥2 个文件解构引用」的模块，逐模块比对
「用了但没解构」。实测发现 **10 个**共享模块（`tools/browser.js` ← 42 文件、
`shared.js` ← 17、`data/name-normalize.js` ← 4 …）。
另加反证副本目录 `_cf\d*` 的排除（点名写法必忘）。

---

## 四、实测对照（改前 = HEAD `b8712e1` 旧代码 + 当前数据）

### 4.1 手游中心（合并表）

| 判据 | 改前 | 改后 | 变化 |
|---|---|---|---|
| 总条目 | 3,203 | **3,211** | +8（尾缀/版本词改变归并，不是匹配器行为） |
| 已匹配 | 1,635 | **1,646** | **+11（净）** |
| 匹配率（含残渣） | 51.0% | **51.3%** | +0.3pp |
| ★ 剔除残渣后 | 55.6% | **55.9%** | +0.3pp（分母 1,305 → 1,301） |
| 可修上限 C | 151 | **145** | **−6** |
| 未匹配 · 库中确无 | 251 | 251 | 0 |
| 未匹配 · 护栏拦截 | 903 | **905** | +2 |
| 未匹配 · 残渣名 | 263 | 264 | +1 |
| 已匹配侧 · ok | 1,528 | **1,539** | **+11** |
| 已匹配侧 · 疑似 | 104 | 106 | +2 |
| ★ 已匹配侧 · **硬冲突** | **3** | **1** | **−2** |

### 4.2 实测库（端游库侧）

| 判据 | 改前 | 改后 | 变化 |
|---|---|---|---|
| 已匹配 | 651 / 1,025 | **653 / 1,025** | **+2** |
| 匹配率（含残渣） | 63.5% | **63.7%** | +0.2pp |
| 剔除残渣后 | 63.9% | **64.0%** | +0.1pp |
| 未匹配 | 374 | **372** | −2 |
| 可修上限 C | 37 | **36** | −1 |
| 护栏拦截 | 135 | 135 | 0 |

---

## 五、逐条 diff —— 「丢了什么」必须看见

只报「匹配数 +11」是**净数**，一加一减会互相遮蔽。
逐条 diff（`tools/_probe-v1036-diff.js`）：

### ① 未匹配 → 命中（**14 条**）

| 查询名 | 现挂 |
|---|---|
| `Call of Duty`…（见③）/ `EA SPORTS FIFA 23` | FIFA 23 / EA SPORTS™ FIFA 23 |
| `EA SPORTS FIFA 21` | EA SPORTS™ FIFA 21 |
| `FINAL FANTASY VII Steam Edition` | FINAL FANTASY VII |
| `Universe Sandbox x64` | 宇宙沙盘 / 宇宙沙盒 |
| `摇鼠灵™` | 摇鼠灵 / RATSHAKER |
| `eden＊` | eden* |
| `STAR WARS Empire at War - Gold Pack` | STAR WARS™ Empire at War - Gold Pack |
| `Need For Speed Most Wanted 2005` | 极品飞车：最高通缉 |
| `Grand Theft Auto SA Online` | 侠盗猎车手：圣安地列斯重制版 |
| `GrandTheftAuto Launcher` | 侠盗猎车手5增强版 |
| `Rebel Galaxy Launcher` / `Vanguard Launcher` / `Blacklist DX11 game` | 勇闯银河系 / 卡片战斗先导者2 / Blacklist Brigade |
| `机动战士 高达SEED 激斗命运 复刻版` | 机动战士高达SEED：激斗命运 |

### ② 命中 → 未匹配（**8 条**，收假阳性）

| 查询名 | 原先**错挂**到 |
|---|---|
| `Crysis 2 - Maximum Edition` | 孤岛危机：**重制版**（Crysis Remastered） |
| `Granny 3 2` | 奶奶**重制版** |
| `Little Nightmares 2` | 小小梦魇**强化版** |
| `The Sims 1 - Legacy Collection` | The Sims™ **4 自然奇境资料片** ← 最离谱的一条 |
| `Assassin S creed 3` | **刺客信条1** |
| `近月少女的礼仪（1）` | 近月少女的礼仪（括号里的 1 是真代际号） |
| `桥梁建造师3` | **桥梁建造师**（Poly Bridge） |
| `Saint s row 2` | 黑道圣徒：**重启版** |

★ 这 8 条的净效果是「**从错配变未匹配**」：不挂封面，好过挂错封面。
★ 其中 `The Sims 1 - Legacy Collection` 有一条**已知残留**：库里正确条目是
`模拟人生1：经典合集 / The Sims Legacy Collection`，键里**缺 `1`** ⇒ 对不上而落空。
**更正确，但不完美** —— 记入残留、未再处理（见第八节）。

### ③ 命中 → 改目标（**3 条**）

| 查询名 | 原（错） | 现（对） |
|---|---|---|
| `Call of Duty Modern Warfare 2 2009` | 使命召唤**16**：现代战争 | 使命召唤**6**：现代战争2（2009） |
| `Grand Theft Auto 5` | 侠盗猎车手5**增强版** | 侠盗猎车手5**传承版** |
| `Street Fighter 6` | 街头霸王6-**虚拟机版** | 街头霸王6（正式版） |

### ④ 只在基线 / 只在当前（**合并口径变化，不是匹配器行为**）

- 只在基线 **11** 条（`Grand Theft Auto V Legacy` / `Need for Speed - Most Wanted` / `Hytale Launcher` / …）
- 只在当前 **19** 条（`Need for Speed 9` / `Resident Evil 4 2005` / `FIFA 19` / …）

★ 这正是「**净 +11 ≠ (14−8)**」的原因（14−8 = 6，剩下 5 来自④）。
把④单独列出来，是为了不让它混进「匹配器改好了」的证据里。

---

## 六、接口实测（服务已重启，`/api/mobilehub/match`）

| 查询 | 返回 |
|---|---|
| `Call of Duty Modern Warfare 2 2009` | 使命召唤6：现代战争2（2009）`[jidi-36879193]` |
| `The Sims 1 - Legacy Collection` | （未匹配端游库）✔ 不再错挂资料片 |
| `Assassin S creed 3` | （未匹配端游库）✔ 不再错挂刺客信条1 |
| `Crysis 2 - Maximum Edition` | （未匹配端游库）✔ 不再错挂重制版 |
| `桥梁建造师3` | （未匹配端游库）✔ |
| `EA SPORTS FIFA 23` | FIFA 23 / EA SPORTS™ FIFA 23 `[jidi-36840697]` ✔ 新命中 |
| `Universe Sandbox x64` | 宇宙沙盘 / 宇宙沙盒 `[xd-1380]` ✔ 新命中 |
| `摇鼠灵™` | 摇鼠灵 / RATSHAKER `[xd-9325]` ✔ 新命中 |
| `Grand Theft Auto SA Online` | 侠盗猎车手：圣安地列斯重制版 `[xd-2777]` ✔ 新命中 |
| `Tomb Raider` | 古墓丽影9终极版 `[xd-265]` ✔ **反向护栏未误杀** |
| `Grand Theft Auto 5` | 侠盗猎车手5**传承版** `[xd-112]` ✔ 改目标 |
| `Street Fighter 6` | 街头霸王6 `[jidi-70420130]` ✔ 改目标 |

`/api/mobilehub/stats` 实测：`{total:3211, matched:1646, unmatched:1565, matchedRate:51.3}`。

---

## 七、验证链

| 环节 | 命令 | 结果 |
|---|---|---|
| 静态防线 | `node tools/run-all.js` | **36 套 / 2,415 条 / 0 失败**，前置闸 2/2，异常退出：无 |
| 本轮套件 | `node tools/test-v1036.js` | **65 / 65** |
| 反证 | `node tools/_counterproof-v1036.js` | **14 / 14 合规** |
| 共享守卫 | `node tools/test-shared-destructure.js` | 10 / 10 |
| 匹配质量 | `node tools/_probe-match-audit.js` | 见第四节 |
| 逐条 diff | `node tools/_probe-v1036-diff.js` | 见第五节 |
| 接口 | `curl /api/mobilehub/match` | 见第六节 |

### 反证 14 条变异（每条都必须能加载、且**恰好**打红目标断言）

| # | 变异 | 打红的断言 |
|---|---|---|
| ① ② | `normKey` 漏剥 `™` / 漏剥 `®` | 唯一真源段 |
| ③ | `phonecfg` 复活第二实现 | ★ 变异要**改成「把 require 换成同名本地实现」**才可加载 |
| ④ | 取数退回 `normKey`（归一化后） | `genNums` 表驱动 |
| ⑤ ⑥ | 4 位年份当代际 / 贴字母数字当代际 | 同上 |
| ⑦ ⑧ | 护栏恒 `false` / 护栏过度收紧（`tn=[]`） | 正/反向成对断言 |
| ⑨ | 通道只挂一处 | 「≥5 处（实际 7）」源码断言 |
| ⑩ | 前缀阈值 8 → 10 | 阈值保持断言 |
| ⑪ | 塞回 `reloaded` | 反例保持断言 |
| ⑫ ⑬ | 尾缀新项改名 / CJK 版本词改名 | 尾缀表覆盖断言 |
| ⑭ | `phonecfg` 护栏摘掉 | 「phonecfg 也挂了护栏」断言 |

★ ③ 与 ⑭ 的踩坑：往一个已有 `const { normKey } = require(...)` 的文件里**插** `function normKey`
⇒ 重复声明 ⇒ **SyntaxError ⇒ 套件整个崩掉** ⇒ 只能报 `UNVERIFIED`。
正确形态是把 `require` **换成**同名本地实现（能加载、能红）。
**「崩了」不等于「抓住了」** —— 崩掉的套件不产生任何断言证据。

---

## 八、残留与已知限制（如实列出）

| # | 残留 | 说明 |
|---|---|---|
| 1 | 手游中心 C 类 **145** 条仍在「匹配器漏」桶 | 天花板 +4.9pp；下轮入口 = `_probe-match-audit.js` 的 C 类清单 |
| 2 | 实测库 C 类 **36** 条 | 天花板 +3.5pp |
| 3 | 已匹配侧待复核 **107**（手游中心）/ **20**（实测库） | 「疑似」不是「错」，需人工看 |
| 4 | `Call of Duty Modern Warfare Remastered 2017` → 仍挂使命召唤16 | 它被归并进 `jidi-36879193` 分组，而 `refTitle` 取的是该 group 的**另一个社区名** ⇒ 判冲突；库里**没有** 2017 那条 ⇒ **无正确目标可落**。净效果 = 「错配但封面正确」，不再新增 |
| 5 | `The Sims 1 - Legacy Collection` 护栏拦对了但没落到正确条目 | 库里键缺 `1`（见第五节②） |
| 6 | `Assassins Creed II` 在 `smart` 栏位被护栏打掉 | `III` 因 `i{1,3}` 独占匹配整条 `II` 而失效；已知、未处理 |
| 7 | 879 条无 appid 的走双语名称搜索（`--mode=search`） | 未开工 |

---

## 九、文件清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `data/name-normalize.js` | **新建** | 归一化唯一真源（`normKey` / `genNums` / `numMismatchByTitle`） |
| `data/phonecfg.js` | 改 | 删本地 `normKey`，`libMatch` 3 处返回通道挂护栏 |
| `data/mobilehub.js` | 改 | 删本地 `normKey`，改为解构引用 |
| `tools/build-mobilehub.js` | 改 | 删本地 `normKey`；尾缀表 + CJK 版本词；`libMatchCore` 5 处通道挂护栏；阈值保持 8 |
| `tools/test-shared-destructure.js` | 改 | 共享模块**自动发现**（含 `_cf*` 排除） |
| `tools/test-v1036.js` | **新建** | 65 条 |
| `tools/_counterproof-v1036.js` | **新建** | 14 条变异（探针，不入库） |
| `tools/_probe-match-audit.js` | **新建** | 匹配质量体检（探针，不入库） |
| `tools/_probe-v1036-diff.js` | **新建** | 改前/改后逐条 diff（探针，不入库） |
| `tools/run-all.js` | 改 | `SUITES` 登记 `test-v1036.js`（35 套 → **36 套**） |
| `data/mobilehub.json` | 派生 | `build-mobilehub.js` 产物，随代码入库 |

**未改**：`server.js`、`public/*.html`、`data/spec-*.js`。
