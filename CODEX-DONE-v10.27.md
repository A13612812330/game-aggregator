# v10.27 —— 下载弹窗重构（一行一帖 · 排序/筛选/折叠 · 加宽版式）

> 日期：2026-09-20 ｜ 上一版：v10.26（机地「话题资源专区」抓取补全）
> 关联文件：`public/index.html` · `fetchers/jidiPosts.js` · `fetchers/download.js` ·
> `tools/test-v1027-dlpop.js`（新增）· `tools/preview-v1027.js`（新增）·
> `tools/_counterproof-v1027.js`（新增）· `tools/test-v1026-jidiposts.js`（改断言）·
> `tools/preview-v1026.js`（收缩职责）· `tools/_counterproof-v1026.js`（换用例）

## 用户原话

> 「haixuyao youhau xia xiazai d tangchuang」
> （= 还需要优化下下载的弹窗）

一句话、**没有说明改哪**。所以本轮先**实拍取证 + 量化缺口**，再用选项让用户圈定范围，
避免"我以为的优化"。

## 用户圈定的范围（AskUserQuestion 两问）

| # | 问题 | 用户选择 |
|---|---|---|
| ① | 要优化哪些（多选） | **四项全选**：条目可辨识度 / 每专区可展开全部 / 排序与盘口筛选 / 弹窗加宽与视觉细节 |
| ② | 默认视图 | **本体优先**（默认展开「本体」，mod / 修改器折叠，顶部给三个专区锚点） |

---

## 一、问题定位：先实拍，再动手

首轮实拍（`_test-out/v1026-dlpop.png` 之前那版）暴露的问题**不是**「数据不够」，
而是**同一份数据被摊平了**：

| 现象 | 实测 | 性质 |
|---|---|---|
| 首屏 12 行只来自 **4 个帖子** | 同一标题重复 5 遍，只有盘口徽标不同 | 一帖多盘口被拆成多行 ⇒ **分不清哪个是哪个** |
| 标题全部被截成「【亲测可玩】…」 | `.dl-it .tx b` 是 `white-space:nowrap` + `text-overflow:ellipsis` | **CSS 截断**，不是数据缺 |
| 长标题没有落脚处 | 弹窗固定 **580px**，列表还是 **232px 两列网格** | 版式上限，不是内容问题 |
| 「下载本体 / 修改器 / Mod」三个入口点进来**看到同一堆东西** | 三专区没有分别呈现 | 入口承诺了分区，界面没兑现 |
| 每专区只露 6 条 | `DL_SEC_CAP = 6`，多的只写「另有 N 个地址」且**不可展开** | 有数据但拿不到 |

> ★ 这一条最值得记：**用户说「需要优化」，第一反应不该是加功能，而是问「现有数据有没有被
> 正确的单位呈现出来」**。本轮零新增数据源，全部收益来自「换单位 + 换版式 + 加状态」。

---

## 二、后端：只做两件必须做的事

### 2.1 `ct`（发布时间）此前根本没透传

`fetchers/download.js` 的 `flatFrom()` 只透传了 `ut`，而**前端要按时间排**。

```
实测（改前）：items 里 ct 覆盖 0 / 210   ← 前端拿不到任何发布时间
实测（改后）：224 / 224
```

修法：`flatFrom` 补 `ct`。**不谈设计，先说数字** —— 覆盖率从 0 到 100% 是这一项的判据。

### 2.2 补抓 `sort=new` 只在「没取满」时才做

`fetchers/jidiPosts.js` 新增 **`fetchSectionSmart()`**，是「补抓 sort=new 并合并」的**唯一入口**：

```js
async function fetchSectionSmart({ tid, resourceType, sort = 'hot', max = 0, mergeNew = true }) {
  const base = await fetchSectionAll({ tid, resourceType, sort, max });
  const out = { list: base.list, count: base.count, pages: base.pages, merged: false, added: 0, newError: null };
  if (mergeNew === false) return out;
  if (!(base.count > base.list.length)) return out;      // 已取满 → 无需补抓
  try {
    const n = await fetchSection({ tid, resourceType, sort: 'new', limit: PAGE_LIMIT, offset: 0 });
    const seen = new Set(base.list.map((p) => String(p && p.id)));
    for (const p of n.list) {
      if (!p || p.id == null) continue;
      const k = String(p.id);
      if (seen.has(k)) continue;
      seen.add(k); base.list.push(p); out.added++;
    }
    out.merged = out.added > 0;
  } catch (e) { out.newError = String((e && e.message) || e); }
  return out;
}
```

**为什么要有那个 `count > list.length` 条件** —— 实测 hot / new 的交集表：

| 专区 | count | 取回 | hot/new 关系 | 补抓有意义吗 |
|---|---|---|---|---|
| 本体（剑星） | 22 | 22 | 完全相同 | ❌ 白跑一页 |
| mod（剑星） | 190 | 50 | **并集 63 / 交集 37** | ✅ 补到 110 |
| 修改器（剑星） | 4 | 4 | 完全相同 | ❌ 白跑一页 |

⇒ **只有「源站总数 > 已取回」的专区才补抓**。省掉 2/3 的无效请求。

**实测效果（2026-09-18，`/api/download?source=jidi&id=171085167`）**：

```
engine=api  items=224  ct=224/224
  body     count=22   merged=false  added=0
  mod      count=190  merged=true   added=60
  modifier count=4    merged=false  added=0
```

改前同一入口 **210 条** ⇒ **+14**；其中 mod 帖 **50 → 110**。
`merged` / `mergedAdded` / `newError` 三项**如实回传**，失败分支也补 `merged:false`，
**不静默降级**（沿用 v10.26 的 `engine: 'api' | 'ssr'` 口径）。

---

## 三、前端：一次版式重构 + 一份视图状态

### 3.1 核心决策：**一行一帖，盘口变按钮组**

源站话题页的结构本来就是「一个资源帖 = 一张卡片 + 若干盘口按钮」。
原来的渲染把**每个盘口地址当成一行**，于是同一帖重复 N 行。

```js
// 归帖键：有 postId 用 postId，退到 postUrl，再退到地址本身（XD 条目无帖子概念）
const k = it.postId || it.postUrl || ('u:' + it.real);
```

`dlGroupByPost(items)` → `dlRow(g)`：
缩略徽标 + **标题（2 行折行 + `title` 存全文）** + `.mt`（@作者 / 时间 / N 浏览 /
提取码带盘口名 / 源帖↗）+ `.acts`（**每盘口一个 `.lk` 按钮** + 一个「复制」）。

★ **提取码必须带盘口名**（`百度 ab12`）—— 同帖不同盘口的码可能不同，混着写会让人抄错码。

### 3.2 三个开关，一个渲染出口

```js
let dlView = null;   // { sort:'hot'|'new', filt:'all'|<cls>, open:{ body:true, mod:false, … } }
```

- `DL_SORTS = [['hot','最热'], ['new','最近发布']]`
- `dlFiltered(items, filt)` —— 按盘口类名筛（`.dl-chip` 上的计数来自 `dlBrandCounts`）
- 折叠 = **不渲染**（不是 `display:none`）：DOM 里真的少掉上百节点，
  且「看到几行 = 取到几行」，不靠隐藏制造"已看全"的错觉

**三个开关任一变化都走 `paintDownload()` 整块重渲染** —— 状态与渲染分离，
避免重蹈「同一份 UI 两个渲染分支，只改一处」的老坑（v10.26 的 `dlSection`/`dlJidiGroups`
就是被这个坑拖出来的，本轮**删除**）。

★ **事件委托必须挂 document 级** —— `#dlBody` 每次整块 `innerHTML` 重建，
直接绑在按钮上的监听会全掉。五个分支：
`data-dl-go`（锚点）/ `data-dl-sort` / `data-dl-filt` / `data-dl-sec`（折叠）/ `data-dl-all`（展开全部）。

### 3.3 跨实现对照取代「禁止第二实现」

v10.26 的结论是「**前端不许实现排序**」（怕两套规则漂移）。
v10.27 出现新事实：前端确实需要**即时**排序（等一次网络往返会明显卡）。

于是把禁令改成**对照护法**：同一输入喂前端 `dlSorted` 与后端 `sortPosts`，
**顺序不一致即红**。规则是「有标题的优先，再按主键降序」。

> 这是本轮方法论上的一条更新：**当"禁止重复实现"和"体验要求"冲突时，
> 不是硬守禁令，而是给重复实现加一条一致性判据。**

### 3.4 版式（CSS）

| 项 | 改前 | 改后 |
|---|---|---|
| `.dlpop-box` 宽 | 580px | **760px** |
| 列表 | `.dl-grp .l` 232px **两列网格** | `display:flex;flex-direction:column` **单列** |
| 标题 | `nowrap + ellipsis` 单行省略 | `-webkit-line-clamp:2` **2 行折行** |
| 行对齐 | `align-items:center` | `flex-start` |
| 工具条 | 无 | `.dl-bar` **sticky**（`top:-12px`）+ `.dl-an` 三专区锚点 + `.dl-tab` 排序 + `.dl-chip` 盘口筛选 |
| 展开 | 无 | `.dl-more`「展开全部 N 帖（还有 M 帖）」 |

新增类：`.mt` `.acts` `.lk` `.dl-tg` `.dl-more` `.dl-bar` `.dl-an` `.dl-tab` `.dl-chip`
`.dl-lb` `.dl-sp`；盘口配色改成 `.bd-X, .lk.bd-X` **一份两用**。

★ **删掉两条死 CSS**（`.dl-sec.off>.l` / `.dl-grp.off>.l{display:none}`）——
折叠时不渲染 `.l`，这两条永远不会命中。

★ 顺带清掉改造后变死代码的 `dlSection` / `dlJidiGroups` / `DL_SEC_CAP` / `dlHost`
（残留引用实测 **0 次**）。

### 3.5 锚点跳转要算差值，不能读 `offsetTop`

`.dl-sec` 的 `offsetParent` 是更外层的 `.dlpop-box`，`offsetTop` 不是相对滚动容器的值。
统一用 `getBoundingClientRect()` 差值算。

---

## 四、验证

### 静态防线

`node tools/run-all.js` → **26 套 / 1700 条 / 0 失败**
（新增 `tools/test-v1027-dlpop.js` **60 条**，**已登记进 `SUITES`**）。

60 条分四块：
1. 后端 `fetchSectionSmart` 语义（源码断言 + 合并去重 + 补抓条件）
2. **取源码求值**跑真函数 —— `dlGroupByPost` / `dlSorted` / `dlPosts` / `dlRow` 直接单测
3. **跨实现对照** —— 前端 `dlSorted` vs 后端 `sortPosts`，同输入必须同序
4. 接线 / 样式 / 死代码（含「写了 JS 没写 CSS」的存在性反转：**每类控件都要有一条
   「有样式 `.dl-xxx{`」的断言**，否则控件渲染成裸文字而存在性断言照样绿）

### 反证（`tools/_counterproof-v1027.js`，7 条全部「打坏即变红」）

| # | 打坏什么 | 结果 |
|---|---|---|
| ① | 归帖键退成「地址本身」 | 通过 52/60（失败 8） |
| ② | 前端排序去掉「有标题优先」（与后端规则漂移） | 57/60（失败 3） |
| ③ | 发布时间不透传（`ct` 恒为 null） | 59/60（失败 1） |
| ④ | 补抓条件打坏：取满了也去补一页 | 59/60（失败 1） |
| ⑤ | 盘口筛选打坏：`dlFiltered` 原样返回 | 59/60（失败 1） |
| ⑥ | 弹窗宽度改回 580 | 59/60（失败 1） |
| ⑦ | 标题样式退回 `nowrap` 单行省略 | 59/60（失败 1） |

全部 ✅ 变红，跑完**自动还原文件**。含 `ranOk()` 门禁：拿不到汇总行就报「测试没跑起来」，
不允许把「没跑到」当成「没坏」。

### 浏览器实拍（`tools/preview-v1027.js`，36 条）

驱动**真实点击**验证排序 / 筛选 / 折叠 / 锚点。核心断言：
**横向与纵向溢出 `=== 0`**、**12 行来自 12 个不同源帖**。

三张人工确认截图：`_test-out/v1027-dlpop.png`（全貌）、`v1027-dlpop-default.png`（默认本体优先）、
`v1027-dlpop-filter.png`（按盘口筛）、`v1027-dlpop-anchor.png`（锚点落位）。

### 连带的旧套件调整（都是「预期变更」，不是真退化）

- `tools/test-v1026-jidiposts.js` ⑥ 段重写：`dlJidiGroups`→`dlBlock`、
  `DL_SEC_CAP`→「sections 为权威口径」、徽标单位改判「帖 / 个地址」，
  并新增「★★ 前端排序必须有跨实现对照护着」；⑦ 段在线冒烟改判
  `mod.returned <= 20 + PAGE_LIMIT` / `body.merged === false` / `mod.merged === true && mergedAdded > 0`。
  现 **67/67**。
- `tools/preview-v1026.js` 收缩职责：只守结构（三块齐 / 名字顺序 / 徽标只挂一次 /
  默认只展开第一个 / 折叠区 0 行节点），条目级判据全搬 v1027。
- `tools/_counterproof-v1026.js` 第 ⑤ 条原文已消失 ⇒ 换成等价语义的新用例
  （「徽标单位从帖改回条」）。

---

## 五、本轮新增的坑（→ 已进 `PITFALLS.md`）

### 坑 1：CSS 截断型假绿

标题被 `nowrap + ellipsis` **从视觉上截断**，但 `textContent` 仍完整
⇒ 断言「文本里有版本号吗」**全程绿**。
**真正的判据是布局溢出**：`scrollWidth - clientWidth > 1`。
（同类：`display:none` 的节点 `textContent` 也在。）

### 坑 2：重复行型假绿

一行一个网盘地址、同一帖子重复 N 行时，断言「有没有标题」也**照样绿**。
**真正的判据是「行数 == 去重后的源帖数」**（本轮：12 行必须来自 12 个不同 `postId`）。

### 坑 3：单行 `const` 会让「抽源码求值」吞掉整个文件

用正则从 `index.html` 里抽函数源码喂 `new Function()` 时，
多行数组模式 `\[[\s\S]*?\n\];` 遇到**单行**的
`const DL_SORTS = [['hot','最热'],['new','最近发布']];`
会一路吃到文件下方**第一个** `\n];` —— 实测抽出 **33KB 垃圾**，
求值报 **`$ is not defined`**（错误完全不指向根因）。

**修法：单行模式必须排到多行模式之前。** 抽取器现在的顺序是
`function` → 单行 const → 多行对象 → 多行数组。
（附带：`esc` 是箭头函数不是 `function`，所以四种模式要**依次尝试**而不是二选一。）

---

## 六、边界与未做

- **发布未做**：线上仍是 **v10.25**。发布需**逐轮授权**，本轮未获授权。
- **XD 侧条目**没有「帖」的概念，退化成一行一条（与改造前一致，未虚构帖子结构）。
- `sort=new` 补抓**只补首页一页**（`PAGE_LIMIT`）；再深的分页没做
  —— mod 190 帖取回 110 已覆盖 57.9%，继续加深的边际收益需先看用户是否够用。
- 盘口筛选是**按盘口类型**（迅雷/百度/夸克/移动/其它），**没做**按专区与盘口的**交叉**筛选。
