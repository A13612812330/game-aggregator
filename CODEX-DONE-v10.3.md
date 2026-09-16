# CODEX-DONE v10.3 —— 排序 / 容量 筛选条显示效果优化

> 本轮由主代理（DesignMdArchitect / Diana）执行，**只改前端视觉与布局**：
> `server.js` / `data/*` / 任何 HTTP 接口 / 数据文件**一律未动**。
> 权威变更说明，优先级高于 v10.2 及更早文档里的相关描述。

---

## 1. 用户诉求

截图反馈「优化下这个筛选的显示效果」。原状（`#colMain` 顶部那一行）：

```
[NEW 最新更新] [SCORE 评分最高] [SIZE 容量最大]    ⟨ALL 全部容量⟩ ⟨XS 5GB以下⟩ ⟨S 5-15GB⟩ …
   ↑ 白底描边胶囊 + 蓝色实心选中                      ↑ 灰轨分段控件 + 白色凸起选中
```

## 2. 诊断：五个真问题（不是「不好看」，是「不一致 + 有两处是 bug」）

| # | 问题 | 性质 |
|---|---|---|
| **A** | **同一个语义（一组里单选一个）用了两套选中语言**：排序组是「白底描边胶囊 + 主色实心块」，容量组是「灰轨 + 白色凸起块」。并排放在一行里，视觉重量一重一轻 | 一致性 |
| **B** | **`.sort-pills` 带 `margin:2px 0 12px`**，而父容器 `.filter-bar` 是 `align-items:center` —— 这个垂直 margin 把**排序组整体顶离了基线**，与右侧容量轨道不在一条线上 | **真 bug** |
| **C** | **英文角标有两套规格**：排序组 `10px/500/margin-right:2px`，容量组 `9px/DIN/opacity:.55/margin-right:4px`。2px 间距让「NEW最新更新」挤成一串 | 一致性 + 可读性 |
| **D** | **「🎮 有实测记录」未激活态是浅紫底紫字**（`.pc-badge` 单类优先于 `.bh-toggle` 的基础样式），与「📱 社区有配置」的白底描边不一致；**激活态**又被 `.pc-badge` 盖掉了 `.bh-toggle.on` 的红橙渐变 → **一个开关两种激活态** | **真 bug** |
| **E** | **缺分组标签**：上方「分类」行有 `分类` 标签，下面两行却没有 `排序` / `容量` —— 用户只能靠「哦那个灰轨道是一组」自己猜 | 信息架构 |

**另外实测发现（窄屏）**：`<760px` 时把页面横向撑破了 —— `documentElement.scrollWidth = 553` 而视口只有 375。
根因：分段控件是 `nowrap` 的，它的 min-content 顺着 flex → **栅格子项 `#colMain` 的自动最小尺寸（`min-width:auto`）** 一路传染上去，把 `#colMain` 撑到 **531px**。

## 3. 改法：两行「标签 + 分段控件」，统一到项目自己的设计语言

关键决策 —— **不发明新样式，改用项目里已有的那套**。顶栏 `.main-nav` 本来就是「`#EEF1F7` 灰轨 + 白块选中 + 主色字」，容量组也是这个做法。所以把排序组也收编进来，三方统一：

```
排序   [最新更新✓] [评分最高] [容量最大]                    命中 15,268 款
容量   [不限✓] [5GB以下] [5-15GB] [15-30GB] [30-60GB] [60GB以上]   [📱 社区有配置][🎮 有实测记录]
```

### 3.1 结构（`filterBarHtml()`）

- 一行混排 → **两行 `.filter-row`**，行首各一个 `.filter-lb`（`排序` / `容量`）
- 结果计数 `.filter-count` 移到**第 1 行右侧**（`.fx-sp` 撑开）
- 两个「只看」开关移到**第 2 行**
- `SIZES[0].nm`：`全部容量` → **`不限`**（行首已有「容量」定名，省 2 字宽度）
- 空态文案同步：`取消「📱 手机可玩」` → `取消「📱 社区有配置」「🎮 有实测记录」`

### 3.2 容器（`.filter-bar`）

改为与 `.cat-panel` **同规格的白卡面板**（`--c-surface` + `1px solid --c-border` + `14px` 圆角 + `shadow` + `padding:11px 14px` + 纵向 `gap:9px`）
→ 「分类 / 排序 / 容量」三行读作**一个操作台**，而不是「一个面板 + 一行散装控件」。

### 3.3 两组共用一套分段控件规格

| 元素 | 改为 |
|---|---|
| `.sort-pills,.size-pills` | 合并为一条规则：`inline-flex;gap:3px`、bg `#F0F3F9`（原 `#F3F5F9`）、radius `11px`、padding `3px`、**去 border** |
| `.sort-pill,.size-pill` | 合并：`12px/650`、radius `8px`、padding `5px 12px`、无边框、hover 只转字色 |
| **选中态 `.on`** | `background:#fff` + `color:var(--c-primary)` + `0 1px 4px rgba(18,26,51,.13)` —— **不再用主色实心块** |
| `.lb` | 统一为 `DIN / 9.5px / 700 / letter-spacing:.5px`，与主文案用 **flex `gap:5px`** 分隔（弃用 `margin-right`） |

> 为什么选中态不用蓝底白字了：同一屏里已经有一个主色实心块（分类的「全部」），再来一个会互相抢注意力；而且「灰轨 + 白块」是项目自己已有的语言。

### 3.4 两个 bug 的修复

- **B**：`.sort-pills{margin:2px 0 12px}` 整个块删除 —— 垂直 margin 不属于 `align-items:center` 的 flex 子项。
- **D**：新增 `.bh-toggle.pc-badge{background:#fff;color:var(--c-t2)}`（未激活态与 📱 完全一致）；
  并给 `.bh-toggle.pc-badge.on` 独立活跃配色 `linear-gradient(135deg,#7C3AED,#4F46E5)`。
  **注意**：`.pc-badge` 单类还被卡片上的 `.bh-badge.pc-badge` 复用，所以只能加 `.bh-toggle` 前缀提高权重，**不能改 `.pc-badge` 本身**。

### 3.5 ★ 窄屏横向溢出的根因修复

```css
@media(max-width:760px){
  #colMain{min-width:0}                                    /* ← 根因：解除栅格子项的自动最小尺寸 */
  .sort-pills,.size-pills{flex:1 1 0;min-width:min(100%,260px);
                          overflow-x:auto;flex-wrap:nowrap} /* 撑满行宽 + 内部横滑 */
  .sort-pill .lb,.size-pill .lb{display:none}               /* 收起装饰性英文，中文档位优先露出 */
  .fx-sp{display:none}
  .bh-toggle{flex:none}
  .filter-count{flex:1 1 100%;margin-left:0;text-align:right}
}
```

三个细节都有实测依据：

- **`min-width:0` 必须加在 `#colMain` 上** —— 只加在分段控件或 `.filter-row` 上**无效**（实测：`flex:1 1 0` / `width:0` / 给行加 `min-width:0` 都仍停在 531px，只有解掉栅格子项的最小尺寸才收敛到 331px）。
- **`min-width:min(100%,260px)` 是用来触发换行的**：不给下限，两个开关会和分段控件挤在同一行，把容量控件压成 **60px** 宽（实测）；给了下限，空间不够时开关自动换行。
- **`flex:1 1 0`（basis 0）而不是 `flex:0 1 auto`**：后者 basis 取内容宽（375px），会让**行首标签被挤到上一行**成孤儿（实测 156px → 183px 高）。

### 3.6 窄屏实测结果

| 视口 | 文档 scrollWidth | 是否溢出 | 容量控件 | 开关 |
|---|---|---|---|---|
| 360 | 360 | 否 | 290px 可横滑 | 换行 |
| 375 | 375 | 否 | 273px 可横滑 | 换行 |
| 430 | 430 | 否 | 328px 可横滑 | 换行 |
| 560 / 760 | = 视口 | 否 | 355 / 446px 可横滑 | 同行 |
| 1024 / 1280 | = 视口 | 否 | 529px（完整） | 同行 |

修复前：360/375/430 的 scrollWidth 分别是 **460 / 460 / 482**。

---

## 4. 验收（全绿）

```
结构体检          72 / 72   （61 → +11，全是本轮新断言）
jsdom 行为回归   103 / 103
别名护栏           7 / 7
★ 筛选条布局回归  34 / 34   （新增 tools/test-filter-layout.js，浏览器实测）
生成器幂等        md5 三连一致
```

新基线：

| 文件 | md5 |
|---|---|
| `public/emulator.html` | `b22c7b04d4aa9c04716f08bb91350adc`（原 `ed87c40e…`） |
| `public/index.html` | `87431ae69f2a9b5d173057a2cb1eb547`（原 `9d9ce2ac…`） |

### ★ 新增第四条防线：`tools/test-filter-layout.js`

为什么必须新开一条：**jsdom 算不出布局**。本轮两个最严重的问题（B 基线偏移、E 横向溢出）都属于「三层测试全绿、线上却错位」，只能真跑浏览器量。

用法（先起服务）：

```bash
node server.js            # 端口 8123
node tools/test-filter-layout.js
```

它做的事：6 个视口（360/375/430/760/1024/1280）× 断言「无横向溢出 / 两行标签正确 / 两个开关都在」，窄屏追加「开关换行 / 控件可横滑 / 英文角标已收起」，最后跑一遍点击交互验证选中态迁移。
环境缺 Edge 或服务不可达时输出 `SKIP` 并退出 0，**不会卡住流水线**。

### 断言有效性反证（已做）

把 `#colMain{min-width:0}` 临时抽掉 → 布局回归立刻 **34 → 28**，红的正是：

```
× FAIL  [窄屏 360] 无横向溢出（scrollWidth 460 ≤ 360）
× FAIL  [窄屏 375] 无横向溢出（scrollWidth 460 ≤ 375）
× FAIL  [窄屏 430] 无横向溢出（scrollWidth 482 ≤ 430）
× FAIL  [窄屏 *] 空间不足时开关换行（不压扁分段控件）
```

→ 证明新断言不是空断言。随后已还原，`index.html` md5 与还原前一致。

---

## 5. 改动文件清单

| 文件 | 改动 |
|---|---|
| `public/index.html` | CSS：`.filter-bar` 面板化 + 新增 `.filter-row/.filter-lb/.fx-sp` + 两组分段控件规格合并 + 删旧 `.sort-pills` 块 + `.bh-toggle` 与 `.pc-badge` 修态 + ≤760 块重写。<br>JS：`filterBarHtml()` 两行结构；`SIZES[0].nm` → `不限`；空态文案 |
| `tools/build-emulator-page.js` | 无改动（派生页由共享资产自动同步） |
| `public/emulator.html` | 生成器产物，md5 `b22c7b04…` |
| `tools/test-emulator-structure.js` | +11 条 v10.3 断言（61 → 72） |
| `tools/test-filter-layout.js` | **新增**，浏览器布局回归（34 条） |
| `DESIGN.md` | +17 行：顶部数值权威说明 · §4 筛选条实装规范 · §7 Do/Don't 各 1 条 · §8 断点说明 |

---

## 6. 给 Codex 的 4 条提醒

1. **基线变了**：结构 **72/72**、`emulator.html` md5 **`b22c7b04…`**、`index.html` **`87431ae6…`**。
   凡是文档里写 `61/61` / `ed87c40e…` / `9d9ce2ac…` 的地方，以本文件为准。
2. **`tools/test-filter-layout.js` 需要服务 + Edge，默认不在三层防线里跑**。改筛选条/布局时**手动跑一次**；
   它用的 `puppeteer-core` 已在 `devDependencies`。
3. **不要「顺手统一」分类行的选中态**。分类是**会换行/横滑的 chip 云（13 项）**，排序/容量是**分段控件（3 / 6 项）**，
   控件类型不同、语言不同是刻意的。硬统一会把 13 个分类塞进轨道里，反而更糟。
4. **`.pc-badge` 不要单独改**。它同时服务卡片徽标（`.bh-badge.pc-badge`）和筛选开关（`.bh-toggle.pc-badge`）。
   要调开关只能加 `.bh-toggle` 前缀提权。

---

## 7. 已知遗留（不在本轮范围）

- **`<375px` 时行卡片（`#libList`）自身仍有 min-content 溢出**（实测 423px）—— 与本轮筛选条无关，是既有问题。
  同一类根因（栅格子项 `min-width:auto`），建议照本轮做法在 `#libList` 或 `.row-card` 上单独立项。
- 分类行（`.cat`）选中态仍是主色实心块，与筛选条的「灰轨 + 白块」不同语言 —— 见第 6 节第 3 条，**刻意的**。
- `_preview-cards.html` / `_preview-cards.js` 是轮 19 的临时预览，仍未清理。
