# SOP · FearlessRevolution（FR）抓取 —— 已遗弃，附复活手册

> **定位**：这不是版本日志，是**流程操作手册**。它记录一条**已被摘除的外部源**的完整抓取方式、
> 实测参数、数据形状与消费链路 —— 目的是「将来若有人要重做，照这份做即可，不用重新踩一遍 CF」。
>
> **状态**：❌ **已遗弃并摘除**（2026-10-12 v10.58 执行；用户 2026-10-10 拍板）
> **为什么还留着**：摘除是**不可逆的信息损失** —— CF 的四条路怎么试、参数怎么定标、阶段② 为什么
> 必须一次跑完，这些全是**实测换来的**。不落档，下一个人会原样重踩。

---

## 一、一句话结论

> FR 的附件是**真免登录直链**（质量比 GTrainers 还好一点），但**整站在 Cloudflare managed challenge 后面**，
> 只能有头浏览器 + 页面上下文 fetch，且 CF **按速率**限流 ⇒ 全量要 **8.8 min（阶段①）+ ≈3.5 h（阶段②）**
> 且阶段② **必须一次跑完**（中断则前功尽弃）。
> 而 GTrainers 已覆盖同类需求且**纯 HTTP 直连**（9,346 条 / 真直链 98.8%）⇒ **收益不抵成本，遗弃。**

---

## 二、站点与技术形态

| 项 | 值 |
|---|---|
| 站点 | `fearlessrevolution.com`（phpBB3 论坛） |
| 内容 | Cheat Engine `.CT` 表 / Trainer **附件文件**（不是网盘、不需要注册） |
| 板块 | `f=4` Tables（CE 表，**16,794 主题 / 336 页**）· `f=5` Trainers |
| 板块列表 | `GET /viewforum.php?f=<f>&start=<N>`，**每页 50 帖** |
| 主题页 | `GET /viewtopic.php?f=<f>&t=<id>` |
| 附件直链 | `GET /download/file.php?id=<n>` → **206** + `content-disposition: attachment; filename*=UTF-8''Xenonauts2.CT` |
| ★ 站内搜索 | **不可用** —— phpBB 只提示 `SEARCH USING GOOGLE FOR BEST RESULTS` ⇒ 按游戏名取数**只能遍历板块 + 标题匹配** |
| ★ 存档板块 | **不存在**（实测首页板块列表里没有存档板）⇒ 本模块**只出 `cat='trainers'`** |

---

## 三、★ 访问约束：CF 挑战四条路，只有第 ④ 条通

这是本 SOP 最重要的一节。四条路**逐条实测过**（2026-10-10）：

| # | 做法 | 结果 |
|---|---|---|
| ① | 纯 HTTP（含 `/robots.txt`、`/sitemap.xml`） | ❌ **403** + `Cf-Mitigated: challenge` |
| ② | headless Chrome | ❌ 24s 仍停在「请稍候…」（CF 对 headless 特征敏感） |
| ③ | 过挑战后把 `cf_clearance` 搬到 node `fetch` | ❌ **仍 403** —— CF 还看 **TLS/JA3 指纹**，光有 cookie 不够 |
| ④ | ★ **有头 Chrome + 页面上下文内 `fetch()`** | ✅ **通** |

**④ 的具体做法（别改）**：

- `connectBrowser({ headless:false, profile })` —— **有头**，profile 固定 `.cache/chrome-fr`
  （`cf_clearance` 存在 profile 里 ⇒ **第二次起过挑战只要 ~0.8s**）。
- 过挑战后**不再用 `page.goto`** —— 导航会**重新触发挑战**。全部走**页面内 `fetch()`**：
  同源 XHR 自动带已通过的 `cf_clearance` 与完整浏览器指纹，实测连续多页 200 且 CF 不再出现。
- ⚠️ 必须用**专用端口**：`connectBrowser` 见到端口上已有实例会**复用**，复用到没有 FR challenge 通过态的实例就白搭。

**★ 传输优化（否则会拖死）**：`page.evaluate` 的返回值要**跨进程序列化**，整页 150 KB × 300 页 = 死。
⇒ 页面内先用 `DOMParser` 只取需要的那几个元素，**只回传片段**；
解析统一交给 `fetchers/frCheat.js`（**避免解析逻辑散落两处**）。

---

## 四、抓取架构：两阶段（阶段② 依赖阶段① 的缓存）

```
阶段①  板块列表（f=4 全量 336 页 + f=5）
        └─→ 缓存 data/_fr-list-raw.json
粗筛    主题标题 → 游戏名候选（frCheat.gameCandidates）→ 端游库名称索引（data/mod-match）
        └─→ 命中集合（10,448 条）
阶段②  只对命中者抓主题页 → 解析附件（文件名 / 版本 / 大小 / 下载数 / 免登录下载链）
        └─→ 产出 data/fr.json
```

★ **阶段① 的缓存（`data/_fr-list-raw.json`）是关键资产**：阶段① 本身就 8.8 min，
`--offline` 可直接复用缓存跳过它。**缓存没了就得再付一次 8.8 min。**

### 命令行

```bash
node tools/fetch-fr.js                    # 全量（阶段① + 阶段②）
node tools/fetch-fr.js --list-only        # 只跑阶段①并缓存
node tools/fetch-fr.js --offline          # 用缓存列表（跳过阶段①）
node tools/fetch-fr.js --max-pages 3      # 每板块只抓 3 页（调试）
node tools/fetch-fr.js --max 50           # 阶段② 最多 50 帖（调试）
node tools/fetch-fr.js --conc 1           # 并发（默认 1，★ 别调高：CF 按速率 429）
node tools/fetch-fr.js --gap 400          # 每请求后的间隔 ms（默认 400）
node tools/fetch-fr.js --backoff 3000     # 429 退避基数 ms（3s→6s→12s + 抖动）
node tools/fetch-fr.js --eval-timeout 45000  # 单次 evaluate 硬超时 ms
node tools/fetch-fr.js --ctx-dead 6       # 连续 N 次恢复失败即熔断
node tools/fetch-fr.js --dry              # 不落盘
```

### ★ 参数怎么定标的（这些数字是实测换来的，不许凭感觉改）

| 参数 | 默认 | 标定依据（真实对照） |
|---|---|---|
| `--conc` | **1** | 并发 3 + gap 150ms → **336 页挂 276 页**；并发 2 + gap 260ms → **挂 3 页**（失败原因清一色 `CF 挑战（429）`） |
| `--gap` | **400ms** | 串行 + 400ms ⇒ **全量 433 页 / 528.2s / 失败页 0 / CF 命中 0**（实跑，非估算） |
| `--backoff` | **3000ms** | 退避**不能太短**：429 带冷却期，1.2s / 2.4s 量级恢复不了（实测那 3 页三次全失败）⇒ 乘性 3s→6s→12s + 0~800ms 抖动 |
| `--eval-timeout` | 45000ms | 单次 evaluate 硬超时 |
| `--ctx-dead` | 6 | 连续 6 次恢复失败即熔断（anti-静默挂死） |
| `PER_PAGE` | 50 | 板块列表每页帖数（站方固定） |

★ CF 是**按速率**限流（429），**不是按总量** —— 所以「压低并发 + 拉大间隔」比「减少总量」有效。

---

## 五、★ 会话纪律（2026-10-10 实测，别踩）

1. ★★ **不要在一轮里反复起停脚本**。
   三次连续短跑（各 `--max 60`）之后，**第四次「过挑战」直接失败** ——
   `title` 停在「请稍候…」**80s 到顶**。
   CF 是按**会话 / 速率**收紧的，**重开会话会重新触发挑战**，profile 里的 `cf_clearance` 不再够用。
   ⇒ **一次跑够**（阶段① 全量实测 528.2s / 433 页 / 失败页 0）。
2. **挑战失败是响亮失败**（抛 `Cloudflare 挑战未通过`），**不会静默给空数据** —— 这点是好的，可以放心。
3. **阶段② 更慢**（1.4k~10k 个主题页）⇒ 阶段① 缓存**必须留着**，`--offline` 直接复用。

---

## 六、实测成果（2026-10-10 11:30，阶段① 完成）

| 指标 | 值 |
|---|---|
| 页数 | **433 页** |
| 帖数 | **21,621 帖** |
| 失败页 | **0** |
| `cfHits` | **0** |
| 耗时 | **528.2s（8.8 min）** |
| 粗筛命中 | **10,448 条（48.3%）** |
| 粗筛覆盖 | **5,142 款** |
| 缓存 | `data/_fr-list-raw.json`（**3.4 MB**，被 `.gitignore` ⇒ **只在本地**） |

⚠️ **阶段② 从未跑过** ⇒ `data/fr.json` **从未产出**。这也是「摘除对现有数字零影响」的直接原因（见 §八）。

**若跑阶段② 的预估**：10,448 个主题页 × 串行 400ms gap ⇒ **≈3.5 h**，且**必须一次跑完**。

---

## 七、产出数据结构（`data/fr.json` 的形状，供将来复活时对齐）

```jsonc
{
  "builtAt": 1791599549736,
  "stats": {
    "source": "FearlessRevolution（fearlessrevolution.com）Cheat Engine 表 / Trainer",
    "listTotal": 21621,        // 阶段① 帖总数
    "preMatched": 10448,       // 粗筛命中
    "preMatchedPct": 48.3,
    "topicTotal": 0,           // 阶段② 有附件的主题数
    "attTotal": 0,             // 附件总数
    "noAttach": 0, "crashed": 0, "cfHits": 0,
    "libCovered": 0,           // 覆盖端游库款数
    "byForum": { "table": 0, "trainer": 0 },
    "allFailed": false
  },
  "items": [
    {
      "t": "12345",            // 主题 id
      "title": "…",            // 帖标题
      "game": "…",             // 从标题抽出的游戏名
      "forum": "table",        // table | trainer
      "sourceUrl": "https://fearlessrevolution.com/viewtopic.php?f=4&t=12345",
      "libId": "xd-1234",      // 挂到端游库的 id
      "libTitle": "…",
      "matchHow": "…",         // 匹配依据
      "attachments": [
        { "id": "77737", "name": "Xenonauts2.CT", "version": "", "size": "12 KB",
          "downloads": 123, "url": "https://fearlessrevolution.com/download/file.php?id=77737" }
      ]
    }
  ]
}
```

**语义要点（与原实现一致，复活时别改）**：
- **一条 = 一个主题帖**（GTrainers 是「一条 = 一个文件」，两者形态不同）⇒ 每条带 `files[] / attachments[]`。
- 前端**优先列 `files`**；解析为空（没有附件的帖）**回落到主题帖链接**——**不静默丢条**。

---

## 八、消费链路（摘除前是谁在读它）

```
data/fr.json
   ↓ 惰性加载（按 mtime 失效）
data/fr.js ── stats() / index() / byLib() / lookup() / slim() / matchSlim()
   ├─→ data/res-groups.js  fromFr()  ⇒ { src:'fr', cat:'trainers', … }  ← 修改器分组的第 3 个来源
   └─→ server.js
         GET /api/fr/stats             — 统计
         GET /api/fr/match?t=&id=      — 某款游戏的 FR CE 表 / Trainer
   ↓
四页前端：修改器分组的来源标签「FearlessRevolution」
```

★ **摘除对数字零影响的硬证据**：`data/fr.json` 从未产出 ⇒ `data/fr.js` 的 `ensure()` 读不到文件，
返回 `stats: { total: 0, missing: true, why: "ENOENT…" }` ⇒ `fromFr()` 实际贡献 **0 条**，
`res-groups.libIdsFor('trainers')` 的 **3,692** 款里 **FR 贡献 0**。
（2026-10-12 摘除前实测确认，不是推断。）

---

## 九、遗弃决策（用户 2026-10-10 拍板，2026-10-12 执行）

三条理由，逐条都是实测：

1. **CF 按速率限流** ⇒ 抓取窗口苛刻（见 §三、§五），生产环境无法稳定纳入每日同步。
2. **阶段② 须一次跑完 ≈3.5 h**，中途断则前功尽弃（缓存只在阶段①，阶段② 无断点）。
3. **四页引用 0 条**（见 §八）⇒ 摘掉**零用户可见损失**。
4. 且 **GTrainers 已覆盖同类需求**且**纯 HTTP 直连**（9,346 条详情 / 真直链 **98.8%** / 覆盖端游库 3,083 款）。

> ⇒ 结论：**不值得继续投入**。摘除，但保留本 SOP。

---

## 十、本次摘除清单（2026-10-12 v10.58 执行）

### A. 文件实体（删除）

| 文件 | 大小 | 说明 |
|---|---|---|
| `tools/fetch-fr.js` | 31 KB | 抓取主脚本（两阶段） |
| `fetchers/frCheat.js` | 9.8 KB | 解析模块（phpBB 主题页 → 附件） |
| `data/fr.js` | 5.2 KB | 读取层（惰性加载 + 投影） |
| `data/_fr-list-raw.json` | 3.4 MB | 阶段① 缓存（**被 gitignore，只在本地**） |
| `data/fr.json` | — | **从未产出**（阶段② 未跑） |

### B. 代码引用（摘除）

| 位置 | 内容 |
|---|---|
| `server.js` | `require('./data/fr')` + `GET /api/fr/stats` + `GET /api/fr/match` |
| `data/res-groups.js` | `require('./fr')` · `SRC_LABEL.fr` · `SRC_KEY.fr` · `fromFr()` · `FILE` 清单里的 `fr.json` · `all` 拼接 |

### C. 前端文案（改，不是删）

| 位置 | 原文案 | 改后 |
|---|---|---|
| 详情页修改器 `d-hint2` | `来源：GTrainers · FearlessRevolution · GCM 清单。` | `来源：GTrainers · GCM 清单。` |
| 资源页修改器 `emu-intro tr` | 「合了三个来源：GTrainers…、FearlessRevolution 的 CE 修改表 / Trainer（这两家都给真实下载链），以及 GCM 的公开清单」 | 「合了两个来源：GTrainers 修改器区（给真实下载链）、GCM 的公开清单」 |

### D. 注释（历史记录 —— 按 v10.57 口径**标注而非回改**）

`tools/browser.js` · `data/gtrainers.js` · `data/mod-match.js` · `tools/build-resource-page.js` ·
`tools/resource-sections.js` · `tools/test-emulator-structure.js` · `tools/test-resource-page.js`
—— 这些注释里的「FR / 三源合并」是**当时口径的原始记录**，改了失真；
做法是**就地加一行「v10.58 起 FR 已摘除」**指向本 SOP，防下轮捡回。

### E. 探针 / 登记（清理）

`tools/_probe-doc-numbers.js` 的 `['fr','/api/fr/stats']` ·
`tools/_verify-online-v1054.js` 的 `DISC` 列表 · 本文档（新建）

---

## 十一、★ 复活手册（若将来要重做，照这个顺序）

> 前提：确认**成本已可接受**（例：CF 放宽了、或有了稳定的绕行方案、或 GTrainers 死了）。

1. **取回代码**：从 git 历史恢复这 4 个文件
   ```bash
   git log --oneline --all -- tools/fetch-fr.js          # 找到删除前的提交
   git show <sha>^:tools/fetch-fr.js > tools/fetch-fr.js
   git show <sha>^:fetchers/frCheat.js > fetchers/frCheat.js
   git show <sha>^:data/fr.js > data/fr.js
   ```
2. **重建阶段① 缓存**（8.8 min，一次跑完，中途别停）：
   ```bash
   node tools/fetch-fr.js --list-only
   ```
   产出 `data/_fr-list-raw.json`（预期 ≈21,621 帖 / 433 页 / 失败页 0）。
3. **跑阶段②**（≈3.5 h，★ **一次跑完**，别中断、别并发跑别的浏览器任务）：
   ```bash
   node tools/fetch-fr.js --offline
   ```
   产出 `data/fr.json`。
4. **恢复接线**：
   - `server.js` 加回 2 个路由 + `require`
   - `data/res-groups.js` 加回 `SRC_LABEL.fr` / `SRC_KEY.fr` / `fromFr()` / `FILE` 里的 `fr.json` / `all` 拼接
   - 前端两处文案改回「三源」
5. **重建派生页 + 跑防线**（铁律 1）：
   ```bash
   node tools/build-emulator-page.js && node tools/build-resource-page.js && node tools/build-unpack-page.js
   node tools/test-pages-sync.js && node tools/run-all.js
   ```
6. **决定是否纳入每日同步**：★ 若纳入，必须评估 `daily-sync` 的**总时长预算**（阶段① 8.8 min 只是起点），
   且要给它**独立超时**（同第 9 步 steam-req 的做法）。

⚠️ **别做的事**：
- 别用 headless 试（见 §三，24s 卡死）
- 别把 `cf_clearance` 搬出来给 node fetch 用（TLS/JA3 指纹，仍 403）
- 别在一轮里反复起停脚本（见 §五.1，第四次过挑战必失败）
- 别调高 `--conc`（见 §四 标定表）

---

## 十二、相关引用

- 引入本源的版本：[v10.47](../versions/v10.47.md)（GTrainers / FR 两个真链源）
- 定案遗弃的版本：[v10.52](../versions/v10.52.md)（★ 并定案 FR 遗弃）
- 执行摘除的版本：[v10.58](../versions/v10.58.md)
- 抓取脚本原文件头：`tools/fetch-fr.js`（已删，见 §十一.1 恢复）
- 解析模块原文件头：`fetchers/frCheat.js`（已删，见 §十一.1 恢复）
