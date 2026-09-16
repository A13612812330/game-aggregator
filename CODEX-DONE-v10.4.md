# CODEX-DONE v10.4 —— 手游专区搜索失效 + 封面未回落端游库

> 2026-09-14 · 用户反馈：「手游专区的时候，搜索用不了」「手游的图片为什么没有根据端游（也就是首页）获取到」
>
> **这是两份独立故障，根因互不相关**：一个是**构建期摘除把绑定带走了**，一个是**数据层相对路径**。

---

## 一、故障 1：手机专区顶栏「搜索」点了完全没反应

### 复现与定位

| 页面 | 点 `#searchOpen` 后 `#smodal` 状态 |
|---|---|
| 首页 `/` | `class="smodal show"`，`opacity:1`，焦点落到 `#searchInput` ✅ |
| 手机专区 `/emulator.html` | `class="smodal"`，`opacity:0`，**焦点不动** ❌ |

**绑定明明存在**（生成后的 `emulator.html` 里 `$('#searchOpen').addEventListener(...)` 那行在），
所以这不是「代码没生成」，而是「**这行没被执行**」。

### 根因

```js
// public/index.html —— 修复前
function bindRankUI() {
  $('#searchOpen').addEventListener('click', () => openSearch());   // ← 顶栏搜索入口
  $('#rankPills').addEventListener('click', ...);                   // ← 榜单周期切换
  $('#rankRefresh').addEventListener('click', ...);                 // ← 榜单刷新
}
```

生成器 `tools/build-emulator-page.js` 里有一行**整行注释**：

```js
.replace(/^\s*bindRankUI\(\);.*$/m, '  /* bindRankUI：独立页无榜单 UI，跳过 */')
```

注释的理由是成立的 —— `bindRankUI()` 里还绑着 `#rankPills` / `#rankRefresh`，
而这两个节点**在专区页不存在**，真调一次会在 `addEventListener of null` 上炸。

**但顶栏搜索入口也被一起关掉了。** 因为它在同一个函数体内，
而「手机专区」页的搜索入口**只有这一个**（`#searchOpen`）。

> **这是一个模式，不是一个孤例** —— 与 v10.1 的 `loadBhBlock`、v10.2 的 `goEmuPage` 同源：
> **生成器按「函数 / 整块」粒度摘除主页面的初始化代码，而那个块里可能藏着两页都需要的公共能力。**
> 区别只在炸法：
> - 前两例是**孤儿调用**（调用点留下、定义被删 → 抛 ReferenceError，控制台一直报错）
> - 本 例 是**哑绑定**（需要的能力藏在被注释掉调用点的函数里 → 静默失效，控制台**一声不响**）
>
> 后者更难发现：没有报错、没有红字，就是点了没反应。

### 修法

把这行**提出函数之外**，作为「两页共用」的独立绑定（该处不在任何被摘除的块里）：

```js
/* ★ v10.4 顶栏搜索入口 —— 两页共用，必须留在 bindRankUI 之外。 */
$('#searchOpen').addEventListener('click', () => openSearch());

/* 顶栏搜索触发 + 榜单周期切换/刷新（仅首页） */
function bindRankUI() {
  $('#rankPills').addEventListener('click', ...);
  $('#rankRefresh').addEventListener('click', ...);
}
```

**同时**从 `bindRankUI()` 内删掉原行 —— 否则首页会被绑两次。

> 判据口诀：**一个「两页都要用」的绑定，绝不能塞进任何「只在单页被调用」的函数里。**
> 判断方法：`grep '函数名();'` 看它的调用点是否在生成器的摘除清单里。

---

## 二、故障 2：手游卡片封面不跟随端游库

### 事实核对（先别急着改）

手游卡片的封面**本来就是**取自端游库匹配结果（`libCover`，由 `tools/build-mobilehub.js` 写入）：

```
3180 条 → 有 libId 1525 条 → 其中 libCover 非空 1522 条（99.8%）
```

所以「没有取到」并不准确。真正的问题是：**端游库里有 223 条封面是 XDGAME 站内相对路径**：

```
xd-367  FIFA19            /uploads/allimg/210419/1-210419223I10-L.png   ← 相对路径
xd-14778 疯狂出租车3       /uploads/allimg/260629/1-2606291FK10-L.png
```

铺到 `<img src="/uploads/...">` 上会打到**本站** `http://127.0.0.1:8123/uploads/...` → **404** → 只剩占位色块。

**关键点：首页（端游库）自己也是挂的** —— 不是「手游没跟随端游」，而是**两边都坏，只是手游专区的首屏第一张卡恰好就是 FIFA19**，所以一眼看到全是色块。

另有个别脏数据：`xd-13080 欺世欢悦` 的 `cover` 字段里存的是分类串（`独立,黑暗,悬疑,恐怖,…`）。

### 验证

浏览器实测（Edge，`referrerPolicy:'no-referrer'`）：

| URL | 结果 |
|---|---|
| `https://www.xdgame.com/uploads/allimg/210419/1-210419223I10-L.png` | ✅ `naturalWidth = 128` |
| `https://www.xdgame.com/uploads/allimg/260629/1-2606291FK10-L.png` | ✅ `32×32` |
| `https://www.xdgame.com/uploads/240112/1-2401121Q325437.jpg` | ✅ `460×215` |
| `/uploads/allimg/210419/1-210419223I10-L.png`（原样） | ❌ `error` |

→ **补 `https://www.xdgame.com` 前缀即可用**，源站没有防盗链。

### 修法：单一真源 `data/cover-url.js`

新增模块，导出 `normalizeCover()` / `normalizeList()`：

```js
''                    → ''                       （前端走占位）
http(s)://…           → 原样
//cdn…                → 补 https:
/uploads/….png|jpg|…  → 补 https://www.xdgame.com
其他（分类串等脏数据） → ''                       （宁可不显示，也不挂注定 404 的图）
```

三处使用（**改这里，三条链路同时受益**）：

| 使用方 | 时机 | 作用 |
|---|---|---|
| `data/gamesDb.js` `load()` | 运行时读盘 | 历史数据兜底 |
| `data/gamesDb.js` `upsert()` | **入口**归一化 | ★ 防每日增量索引又把相对路径带回来（源站给的就是相对）
| `tools/build-mobilehub.js` | 构建写 `libCover` | 手游卡片数据干净 |

另跑一次性脚本把 **`games.json` 现存 223 条**就地修正（216 条补域名 + 7 条脏数据清空），
**执行前已备份** → `data/games.json.bak-2026-09-14-08-25-34`（5.2MB）。
修正后重建 `mobilehub.json`（3180 条 / 1525 匹配 / **libCover 100% 绝对 URL**）。

> **为什么不只在 `load()` 修？** 因为增量索引走 `upsert()`，每次从源站重抓都会带回相对路径——
> 不拦入口，修好的数据会被下一轮覆盖回去。

---

## 三、验收

| 防线 | 结果 |
|---|---|
| 结构体检 | **82 / 82**（72 → **+10**） |
| jsdom 行为回归 | **108 / 108**（103 → **+5**） |
| 筛选条布局回归 | **34 / 34** |
| 别名护栏 | **7 / 7** |
| 生成器幂等 | md5 三连一致 **`79096a4d8c7f29bae4ca745f2b0b7935`** |
| 线上 = 磁盘 | 一致 |

**新基线**：`emulator.html = 79096a4d8c7f29bae4ca745f2b0b7935` · `index.html = cecc6fd7562cdb5c34d9824e663e794b`

**浏览器端到端实测**（Edge headless 1280×900）：

- 专区页点顶栏搜索 → 弹窗打开、焦点入框、库总数回填 `15,268` ✅
- 输入「艾尔登」+ Enter → **四分组齐全**：手游中心 1 / 修改器 7 / 云存档 2 / 端游库 6 ✅
- 点手游分组第一条 → 抽屉打开「艾尔登法环」，`#trBlock` / `#svBlock` 同时存在 ✅
- 底部 Tab「搜索」→ 弹窗打开 ✅
- 手游中心首屏 24 张卡：**24 张有 `<img>`、24 张加载成功**（修复前第 1 张 FIFA19 是 404）✅
- 首页搜索弹窗与榜单封面未回归 ✅
- 页面零 JS 异常 ✅

**新增断言**（结构 10 条 + 行为 5 条），含：

- 主源 / 派生页各有**唯一**一处 `#searchOpen` 绑定，且 `bindRankUI()` 函数体内**不含**它
- `normalizeCover()` 的四类规则（相对路径 / 完整 URL / 协议相对 / 脏数据）
- `games.json` 与 `mobilehub.json` 中**不存在非绝对 URL 的封面**
- jsdom 里点 `#searchOpen` → `#smodal` 真的拿到 `.show`，且焦点在 `#searchInput`

**断言有效性反证**（关键，证明不是空断言）：

| 反证操作 | 结果 |
|---|---|
| 把 `#searchOpen` 绑定塞回 `bindRankUI()` | 结构测试红 **2 条**（两条 searchOpen 断言）+ 行为测试红 **2 条**（「弹窗打开」「焦点」） |
| 把 `games.json` 一条封面退回相对路径 | 结构测试红（非绝对 URL 断言） |
| 还原后 | 结构 82/82、行为 108/108 全绿 |

---

## 四、给后续接手者（含 Codex）的提醒

1. **`bindRankUI()` / `renderSide()` / `renderCats()` / `renderList()` / `refreshRank()` 这 5 个调用点会被生成器注释掉。**
   它们函数体内目前只有单页专有逻辑，但**以后往里加东西要格外小心** ——
   加进去的绑定在派生页会**静默失效**（不报错，只是点了没反应）。
   **凡是两页都要用的绑定，一律放在 `bindRankUI()` 定义之外。**

2. **已经出现三次同类事故了**（`loadBhBlock` / `goEmuPage` 孤儿调用、本次哑绑定）。
   建议给生成器加**出站自检**，双向都查：

   ```
   ① 主源所有「被调用」的函数，在产物里必须有定义      → 防孤儿调用
   ② 产物里所有「带 id 的 button/a」，JS 里必须提到过它 → 防哑绑定
   ```

   第 ② 条可以做得朴素：`grep -o 'id="[^"]*"' public/emulator.html` 出全部 id，
   再逐个查产物 JS 里是否出现 `'#该id'` 或 `getElementById('该id')`。
   当前未实现，属建议任务。

3. **封面归一化是「入口 + 出口」双做的，别只改一边。**
   只在 `load()` 归一化 → 下一轮 `/api/library/index/incr` 会把相对路径写回 `games.json`。

4. **`data/cover-url.js` 是封面 URL 的唯一真源。** 不要在别处再写一遍 `startsWith('/')` 的补域名逻辑。

5. **`games.json` 的备份 `data/games.json.bak-*` 是本次修复前的快照**，确认线上无异常后可删。

---

## 五、本轮改动文件清单

| 文件 | 改动 |
|---|---|
| `data/cover-url.js` | **新增**（1906B，封面 URL 归一化单一真源） |
| `data/gamesDb.js` | `require` + `load()` 调 `normalizeList` + `upsert()` 入口调 `normalizeCover` |
| `tools/build-mobilehub.js` | `require` + `libCover` 写入时归一化（`x.lib.cover` → `normalizeCover(x.lib.cover)`） |
| `public/index.html` | `#searchOpen` 绑定移出 `bindRankUI()`（改 1 处，删 1 行） |
| `public/emulator.html` | 生成产物（重新生成） |
| `tools/test-emulator-structure.js` | +10 条断言（+变量改名避冲突 `mh` → `mhJson`） |
| `tools/test-emulator-page.js` | +5 条断言（搜索入口可用性） |
| `data/games.json` | 223 条封面就地修正（已备份） |
| `data/mobilehub.json` | 重建（3180 条，libCover 100% 绝对 URL） |

**未改动**：`server.js`、任何 HTTP 接口、`saves.json` / `trainers.json`、`DESIGN.md`（本轮无视觉变更）。
