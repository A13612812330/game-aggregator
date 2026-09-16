# GameHub v10.2 —— 手机专区导航「单一出口」修正

> 完成时间：2026-09-14 ｜ 触发：用户反馈「交互不应该在上面吗，而不是增加多一个按钮返回到首页吧」
> 配套：`CODEX-DONE-v10.1.md`（上一轮四项优化）· `CODEX-HANDOFF.md`（项目全貌）· `CODEX-TASKS.md`（任务 prompt）
>
> **本文用途**：记录一次**交互缺陷修复**。它不是新功能，而是把「同一个出口在屏幕上出现两次」
> 这件事从根上解决 —— 顺手又修掉一个和 v10.1 的 `loadBhBlock` 同类的**孤儿调用**。

---

## 一、问题是什么

手机专区页 `/emulator.html` 的顶栏已经有「🏠 首页 / 📱 手机专区」，页内却又有一个
「← 返回聚合首页」按钮 —— 同一个出口出现两次，而且页内那个才是能用的。

**根因不在按钮多，而在顶栏那份导航在派生页里是坏的：**

| | `public/index.html`（主源） | `public/emulator.html`（派生页） |
|---|---|---|
| 顶栏「🏠 首页」`href` | `#rankStage` | 原样复制过来 → **该页根本没有 `#rankStage`，是死锚点** |
| 共用脚本的点击处理 | `preventDefault()` + `scrollTo(top)` → 「回顶部」是正确语义 | 同样被拦成「回顶部」→ **点了完全没反应** |
| `class="on"` 高亮 | 在首页合理 | 复制过来 → **高亮落在了「首页」而不是「手机专区」** |
| `📱 手机专区` | 指向 `/emulator.html` | 没有高亮，看不出当前在哪 |

当初大概就是因为顶栏点不动，才在页内补了个按钮。**这是「补丁掩盖根因」的典型**：
真正该修的是顶栏语义。

---

## 二、怎么修的（一个出口，两种屏宽各承担一次）

原则：**回首页这个动作，任何时刻在屏幕上只应该有一个入口。**

| 屏宽 | 出口 | 说明 |
|---|---|---|
| ≥ 761px | 顶栏「🏠 首页」 | 改成 `href="/"` 真链接；高亮改到「📱 手机专区」 |
| ≤ 760px | 底部 Tab「🏠 首页」 | 顶栏 `.main-nav` 在此断点是 `display:none`，所以底部必须自带 |
| 页内 | **（删除）** | 「← 返回聚合首页」按钮已移除，`.page-back` 现在只装 5 页签切换条 |

> ★ 关键判断：**不能只删按钮了事**。删掉页内按钮而顶栏仍是死的，就会把桌面用户也堵死。
> 所以「顶栏修好」和「按钮删掉」是同一件事的两面，必须一起做、也一起测。

### 两页语义不同，但只有一份脚本

主源 `public/index.html` 不可能为派生页再写一份导航脚本，所以引入**页面标记**：

```html
<!-- index.html -->        <body>
<!-- emulator.html -->     <body data-page="emulator">     ← 生成器 emit
```

```js
/* public/index.html 主脚本（两页共用） */
const IS_EMU_PAGE = document.body.getAttribute('data-page') === 'emulator';
$('#navHome').addEventListener('click', (e) => {
  if (IS_EMU_PAGE) return;              // 独立页：交回 href="/" 正常跳转
  e.preventDefault();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
```

### 派生页顶栏与底部 Tab，由生成器重写（不是手改产物）

`tools/build-emulator-page.js` 里新增两个常量，并在组装时替换掉从主源复制来的版本：

- `TOPBAR_EMU` —— 首页改成 `href="/"`、去掉 `on`；手机专区加上 `class="on"`
- `TABBAR_EMU` —— 底部 Tab 由「热榜 / 最新 / 搜索 / 手机专区 / 关于」换成
  **「🏠 首页 / 📱 手机专区 / 🔍 搜索」**：
  - 「最新」「关于」在专区页指向不存在的节点，是**死链**
  - 而顶栏在窄屏是隐藏的 → 原来**窄屏进来就再也回不去首页**
  - 「首页」故意**不写 `data-tab`**，脚本就不会 `preventDefault` 它，`href="/"` 直接生效

两处替换都带**自检**：匹配不到就抛错中断，避免「看着还行其实顶栏又变回死锚点」的静默回归。

---

## 三、★ 顺手又修掉一个孤儿调用（与 v10.1 的 `loadBhBlock` 同类）

```js
// public/emulator.html（修复前）
goEmuPage(t);            // L2042  调用点还在
// function goEmuPage …   ← 定义在 index.html 的「独立页跳转块」里，
//                          派生页把整块换掉了 → 函数不存在
```

**后果**：在专区页每点一次底部「手机专区」，就抛一次 `ReferenceError: goEmuPage is not defined`。
页面勉强还能用（另一个监听器仍会切页签），所以一直没人发现 —— **静默失败**。

**修法**：在派生页专属的 `TAB_JS` 里补一个**同页语义的替身**（本页已在专区，正确动作是切页签而不是再跳一次）：

```js
function goEmuPage(t) { switchEmuTab(t === 'pc' ? 'emu' : t); }
```

> ⚠️ **这是本项目的第二例**。规律已经很清楚：
> **派生页会连同「跳转块」一起删掉一批函数定义，但调用点散落在共用脚本各处。**
> 凡是共用脚本里调用的函数，如果它定义在被替换的区块内，在派生页就只剩调用点。
> `loadBhBlock` 和 `goEmuPage` 都是这么来的 —— 建议后续加一条生成期自检（见文末）。

---

## 四、改动文件清单

| 文件 | 改动 |
|---|---|
| `public/index.html` | ① `IS_EMU_PAGE` 页面标记守卫（顶栏「首页」在独立页放行默认跳转） |
| `tools/build-emulator-page.js` | ① 新增 `TOPBAR_EMU` 重写顶栏语义 + 自检 ② 新增 `TABBAR_EMU` 重写底部 Tab + 自检 ③ `BACKBAR` 删除「← 返回聚合首页」 ④ 清掉随按钮移除的死 CSS（`.page-back a` / `.crumb` / 窄屏覆盖） ⑤ `#emuTabs` 去掉 `margin-left:auto`（不再给按钮让位） ⑥ emit `<body data-page="emulator">` ⑦ `TAB_JS` 补 `goEmuPage` 替身 |
| `public/emulator.html` | **由生成器派生，勿手改** —— 跑 `node tools/build-emulator-page.js` 重新生成 |
| `tools/test-emulator-structure.js` | 新增 8 条断言（**53 → 61**） |
| `tools/test-emulator-page.js` | 替换 1 条旧断言（返回条存在 → 出口唯一）＋ 新增 7 条（**96 → 103**） |

**未改动**：`server.js`、`data/*`、`fetchers/*`、接口、数据。本轮**只碰前端导航**。

---

## 五、验收

| 防线 | 结果 |
|---|---|
| 结构体检 | **61 / 61**（53 → +8：顶栏语义、body 标记、主源守卫、页内无按钮、底部 Tab 回首页、死链清理、goEmuPage 定义+调用） |
| jsdom 行为回归 | **103 / 103**（96 → +7：页内无第二出口、顶栏 href 与高亮、body 标记、底部回首页入口、死链清理、点底部 Tab 不抛错、切回手游中心） |
| 别名护栏 | **7 / 7** |
| 生成器幂等 | md5 三连一致 `ed87c40e177120e687ed0bc5f4f83dad` |
| 新基线 | `index.html` = `9d9ce2ac02ff7212f87ce7a21c804b43` ｜ `emulator.html` = `ed87c40e177120e687ed0bc5f4f83dad` |

### 两处独立验证（都留了脚本思路，脚本本身已删）

**① 断言有效性反证** —— 证明「点底部 Tab 不抛异常」这条不是空断言：

```
【修复后（当前产物）】      点击后新增异常：0 条
【还原修复前（抽掉替身）】  点击后新增异常：1 条 → Uncaught [ReferenceError: goEmuPage is not defined]
✅ 反证通过：断言有效
```

**② 两页顶栏语义对照** —— 证明修复没把首页搞坏：

```
【首页 /】                href="#rankStage"  高亮=true
  点击后：preventDefault=true   scrollTo=1  发起导航=false     ← 仍是「回顶部」，未回归
【手机专区 /emulator.html】 href="/"          高亮=false
  点击后：preventDefault=false  scrollTo=0  发起导航=true      ← 真的跳回首页
```

---

## 六、给 Codex 的提醒

1. **产物 `public/emulator.html` 永远不要手改** —— 任何导航/样式改动都改 `public/index.html`
   或 `tools/build-emulator-page.js`，然后跑生成器。手改会被下一次生成覆盖。
2. **顶栏/底部 Tab 是「派生页语义重写」的样板**。以后再有「首页才有的东西搬到专区页」的需求，
   照 `TOPBAR_EMU` / `TABBAR_EMU` 的写法办（重写 + 自检），**不要在页内加第二个同义入口**。
3. **建议新增一条生成期自检（可作为独立任务）**：
   把主源 JS 里所有 `xxx(` 的函数调用抠出来，逐个到派生页产物里核对是否有定义，
   缺失就报错 —— 能一次性兜住 `loadBhBlock` / `goEmuPage` 这类孤儿调用。可挂到
   `tools/build-emulator-page.js` 现有的「出站自检」段后面。
4. **文档数字基线已变**：结构 **61/61**、行为 **103/103**、`emulator.html` md5 `ed87c40e…`。
   旧文档里写 53/96 或 `5815e9d6…` 的地方以本文为准。
