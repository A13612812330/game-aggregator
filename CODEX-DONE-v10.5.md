# CODEX-DONE v10.5 —— 点击语义 / 详情解析 / 筛选条三处系统性修复

> 2026-09-14 · 用户反馈四条：
> ①「有些并不是到游戏详情页的，如 171 的、机地的」
> ②「云存档点击未跳转」
> ③「点击筛选『仅看匹配端游』的时候，『筛选双料』会自动换行」
> ④「我还想增加修改器 / 云存档的筛选」

四条里 ①③ 是真 bug（且 ① 的根因比表面严重得多），② 是上一版**故意不做**的设计被用户否掉，
④ 是新需求。下面按「根因 → 修法 → 验证」逐条写清楚，便于 Codex 接手。

---

## 一、XDGAME 详情解析全线失效（本轮最大发现）

### 现象与排查路径

用户说「有些卡片点了不是游戏详情页」。先按「链接错」排查，结果**链接全对**：

- `data/games.json` 15268 条，URL 形态 100% 合法（0 条例外，`xdgame.com/game/N.html` 或 `jidiyouxi.com/topic/detail/N`）
- `/api/library/item?id=…` 全部命中（含 `xd-171` / `jidi-*`），无悬空 id
- 机地 58 条详情**逐条实测**，58/58 正常（有标题 / 类型 / 评分 / 发行日期）

真正的问题在 **XDGAME 详情解析**：`/api/detail?url=…/game/112.html` 返回

```json
{"title":"","genres":[],"size":null,"score":null,"releaseDate":null,"publisher":null}
```

**title 是全站 1.4 万条共用的空值**。卡片看着正常（列表页解析没坏，封面/类型/容量来自
`fetchers/indexer.js` 解析的 list 页），但**一点进抽屉，除了一段简介，详情区基本是空的** ——
用户看到的就是「这不是游戏详情页」。

### 根因 1：`||` 短路 + 未 trim（经典坑，但极隐蔽）

```js
// 修复前（fetchers/xdgamer.js）
const h1Clone = $('.article-tit h1').first().clone();
h1Clone.find('span, small, .tit-badge').remove();   // 去掉「版本更新」徽章
const title = (h1Clone.text() || $('h1').first().text() || $('title').text().split(' - ')[0])
  .replace(/\s+/g, ' ').trim();
```

站点改版后标题挪进了 `<span class="article-title-text">`，而这一行**恰好**把它当「徽章」删掉了。
删完剩下的是**空白文本节点** —— `"\n    \n   "`。它是个**真值字符串**，于是：

`h1Clone.text()` → `"\n  \n"`（truthy）→ **短路**，后面两个兜底（`$('h1')`、`$('title')`）**永远不会执行**
→ `.trim()` → `""`。

> 教训：`a || b` 里的 `a` 若可能是「全是空白的字符串」，兜底链就是假的。
> 本项目的正确写法是 `pickText(...cands)`：**先 trim、再判空**，逐级兜底。

### 根因 2：面包屑 href 改版

```js
const crumb = $('.article-tit').first().prev();      // 旧结构：面包屑是 .article-tit 的前一个兄弟
if (crumb.length) crumb.find('a').each(...)          // 且只认 href 含 /sort/ 的链接
```

新版：面包屑是 `<nav class="article-crumbs">`（仍与 `.article-tit` 同级，但结构变了），
且分类链接由 `/sort/xxx/` 改成 `/list/1/`（大类）与 `/game/1/`（细类）→ **两头都不成立**，类型恒空。

### 根因 3（顺带）：新版多了三个可用字段与一整套标签

| 字段 | 新版位置 |
|---|---|
| 游戏厂商 | `.article-meta-item.game-publisher` |
| 发行日期 | `.article-meta-item.game-release-date` |
| 更新时间 | `.article-meta-item.game-site-updated` |
| 游戏标签 | `.article-tags a`（Steam 标签，10+ 个，比面包屑细得多） |
| 容量 | **不再有独立字段**，藏在版本介绍文本里：`…|容量120GB|官方简体中文|…` |
| 评分 | `.steam-review-final-score [data-steam-score]`（0.0 = 源站暂无评价） |

### 修法

`fetchers/xdgamer.js#detail` 重写取值段：

```js
const pickText = (...cands) => {                    // 先 trim 再判空，杜绝空白短路
  for (const c of cands) {
    const t = String(c == null ? '' : c).replace(/\s+/g, ' ').trim();
    if (t) return t;
  }
  return '';
};
const title = pickText($('.article-tit .article-title-text').first().text(),
                       h1Clone.text(), $('h1').first().text(), $('title').text().split(' - ')[0]);
```

- 类型：改查 `nav.article-crumbs a`，**倒序取「最细一级且不是站点大类」**（跳过 主页/电脑游戏/主机游戏/安卓游戏/`/list/N/`）
- 标签：`.article-tags a` 去 `#` 前缀，最多 10 个；面包屑取不到时用前两个标签兜底类型
- 容量：`版本介绍` 文本正则 `容量\s*([\d.]+\s*(?:TB|GB|MB))`，版本文本优先、全页兜底
- 评分 / 好评率：`0.0` 与 `0%` 一律视为**暂无评价 → null**，不写 0（否则会污染「评分最高」排序）

`public/index.html#paintDetail` 同步把新字段铺进抽屉 KV：
游戏厂商 / 发行日期 / **游戏标签** / 「玩家评分（Steam 好评率 N%）」。

### 实测对比（`/api/detail?url=…/game/112.html`）

| 字段 | 修复前 | 修复后 |
|---|---|---|
| title | `""` | `侠盗猎车手5传承版/GTA5传承版/Grand Theft Auto V Legacy` |
| genres | `[]` | `["动作冒险"]` |
| size | `null` | `120GB` |
| publisher | 无此字段 | `Rockstar North` |
| releaseDate | `null` | `2015-04-13` |
| tags | 无此字段 | 7 个（3A大作 / 冒险 / 动作 / 射击 / 开放世界…） |

---

## 二、点击语义统一：**有端游库命中就进游戏详情**

### 根因

`tools/emulator-sections.js#bindEmuCards` 的分流顺序是「**社区仓库键（bhk）优先于端游库命中（libId）**」：

```js
const bhk = card.dataset.bhk;
if (bhk && openBhPanel) { openBhPanel(...); return; }      // ← 先判 bhk
if (card.dataset.lib && openDetailById) { openDetailById(...); }
```

于是「**既命中端游库、又有社区配置**」的卡片，点正文进的是社区配置面板 —— 用户的原话是
「有些并不是到游戏详情页的」。这类卡在全量里占比不小（双料 89 条 + 大量只有 bhKeys 又有 libId 的）。

### 修法

顺序反转 + 把社区配置降级成**卡上独立按钮**（`📋 社区配置`，紫罗兰描边，视觉轻于主入口）：

```js
g.addEventListener('click', (e) => {
  const card = e.target.closest('.emu-card'); if (!card) return;
  const cfg = e.target.closest('.cfg-btn');                     // ① 明确的次级入口
  if (cfg) { e.stopPropagation(); openBhPanel(...); return; }
  const lib = (btn && btn.dataset.lib) || card.dataset.lib;
  if (lib) { openDetailById(lib, ...); return; }                // ② 有库命中 → 详情（优先）
  if (card.dataset.bhk) { openBhPanel(...); return; }           // ③ 只有 bhk 才整卡开面板
  toast('这款未收录进本地端游库，暂无详情页');
});
```

---

## 三、云存档卡片点正文没反应（用户反馈②）

### 根因：这不是 bug，是上一版的**设计决策**被否

```js
// 修复前
/* 点正文不跳转：这里的路径文字是要给用户「抄」的，误触跳走会很烦 */
g.addEventListener('click', (e) => { /* 只处理 .cov-btn */ });
```

为了防止「抄路径时误触跳走」，整卡点击被吞掉，只留封面上一颗按钮 —— 用户的实际感受是「点了没反应」。

### 修法：把「抄路径」和「看详情」拆到不同区域，两者都保住

| 点击位置 | 行为 |
|---|---|
| `.cp`（复制按钮） | 只复制这一条路径（`copyText`：Clipboard API + `execCommand` 兜底） |
| `.paths` 路径区 | 允许选中文字，**不跳转** |
| 卡片其它地方 | 有 libId → 进游戏详情；没有 → 明确提示「没对上端游库，路径可直接点复制」 |

每条路径行右侧新增「复制」按钮（`public/index.html` 加 `.emu-card .paths .p .cp` 样式）。

---

## 四、筛选条：从「改文案」到「定宽伪元素」（用户反馈③）

### 根因链（两层，第二层是浏览器量出来的）

```js
// 修复前
libTog.textContent = emuState.matched ? '✓ 仅看匹配端游（已开）' : '✓ 仅看匹配端游';
```

1. **明显层**：激活时文案加「（已开）」→ 按钮宽 **+28px** → 把后面那颗「只看双料」挤到下一行。
2. **隐蔽层**：改成「✓/○ 前缀」后，`tools/test-filter-layout.js` 真跑浏览器量出
   **两个字形宽度差 1.6px**（106.5 → 108.1）——
   **只是把跳动从 28px 缩小到 1.6px，换行风险并没根除。**

### 修法

① 筛选独占一行（`emu-bar` 拆成 3 行 `.emu-bar-row`：搜索 / 排序 / 筛选）；
② 状态标记交给**定宽伪元素**，JS 只切 `.on` 类，**完全不碰 `textContent`**：

```css
.emu-refresh.em-tg::before{content:'○';display:inline-block;width:1.1em;text-align:center;font-weight:800}
.emu-refresh.em-tg.on::before{content:'✓'}
```

```js
const paint = () => el.classList.toggle('on', !!emuState[key]);   // 不再有 textContent =
```

顺带补一条漏掉的样式：`.emu-refresh.on`（默认色系，如「仅看匹配端游」默认就是开的）
此前**只有 tr/sv/both 三个变体写了 `.on`**，导致默认开关开着也只有 ✓、没有实心底。

---

## 五、新增筛选：🛠 有修改器 / 💾 有云存档（用户反馈④）

「修改器」与「云存档」两个索引库**每条都挂了端游库 id（libId）**，天生可以当横切维度用。

### 新增 `data/xref.js`（交叉索引）

- `trainerIds()` → 有修改器收录的 libId 集合（**2,237**）
- `saveIds()` → 有云存档记录的 libId 集合（**5,354**）
- `both`（两边都有）→ **1,589**
- 缓存按源数据指纹失效（`builtAt + items.length`），tools 重新生成索引后**不用重启服务**

### 后端

| 端点 | 新增 | 语义 |
|---|---|---|
| `/api/library/browse`、`/api/library`（搜索） | `&tr=1` / `&sv=1` | 走 `libOpts` 的 `filter` 谓词，与 `bh`/`pc`/容量区间 **AND** |
| `/api/mobilehub/list` | `&tr=1` / `&sv=1` | 与 `stats=matched`、`only=both` 也是 **AND** |
| `/api/xref/stats` | 新端点 | 返回两个集合规模（供校验） |

`/api/mobilehub/list` 额外给每条**回填 `hasTr` / `hasSv`**（返回副本，不污染索引缓存），
卡面渲染成 `🛠 有修改器` / `💾 有存档` 角标 —— 否则用户点了筛选，却说不出这些卡为什么被留下。

### 前端

- **首页聚合库**：筛选条拆成「排序 / 容量 / 筛选」三行，第三行放 4 个开关
  （📱 社区有配置 / 🎮 有实测记录 / 🛠 有修改器 / 💾 有云存档），配色沿用两个分区主色
- **手机专区**：筛选行的 4 个开关（含新加的两个），与「只看双料」`localStorage` 记忆同机制

### 实测（HTTP 直测）

| 口径 | 结果 |
|---|---|
| 首页无筛选 | 15,268 |
| 首页 `tr=1` | 2,237 |
| 首页 `sv=1` | 5,354 |
| 首页 `tr=1&sv=1` | 1,589 |
| 首页 `tr=1&bh=1`（与既有开关叠加） | 454 |
| 手游中心 `tr=1` | 659 |
| 手游中心 `sv=1` | 1,085 |
| 手游中心 `only=both&tr=1` | 50 |

---

## 六、验收基线（全部真跑，非静态断言）

| 套件 | 结果 |
|---|---|
| `tools/test-emulator-structure.js`（结构体检，含 v10.5 增量 22 条） | **104 / 104** |
| `tools/test-emulator-page.js`（jsdom 行为，含新交互 10 条） | **118 / 118** |
| `tools/test-filter-layout.js`（浏览器布局，含专区不换行回归） | **77 / 77** |
| `tools/test-alias-guard.js` | **7 / 7** |

本轮新增的**回归防线**（防同类问题再来）：

- `test-filter-layout.js`：5 种宽度 × 「切换前后按钮宽度逐像素不变（≤0.5px）」
  + 「切换前后换行位置不变」+ 「状态标记由 CSS `::before` 提供」
- `test-emulator-page.js`：「既命中库又有社区配置」的卡片点正文**必须进详情**
  + 云存档卡片点正文**必须开抽屉**、点路径区**必须不跳转**
- `test-emulator-structure.js`：7 个开关**必须都挂 `em-tg` 类**（防止有人改回「改文案」那套）

真实浏览器验收（`tools/preview-v105.js`，截图在 `_preview/v105-*.png`）：

```
手游中心筛选行：仅看匹配端游[ON] | 只看双料 | 🛠 有修改器 | 💾 有云存档 | ↻ 刷新配置库
有修改器筛选后：共 659 款
手游卡片点正文 → drawer=true / 标题=看门狗          ← 修复①③
云存档卡片点正文 → drawer=true / 标题=怪物火车2      ← 修复②
首页「有云存档」：命中 5,354 款                      ← 新增④
XD 详情 kv：游戏厂商 Milestone S.r.l. || 发行日期 2026-09-10 || 游戏大小 17.2GB
           || 游戏类型 体育竞速 || 游戏标签 4 人本地 / 分屏 / 单人 / … || 玩家评分 7.2 / 10
```

---

## 七、给 Codex 的后续建议

1. **`pickText` 这类「trim 后判空」的兜底应抽成公共工具**（`shared.js`），
   目前 `fetchers/*.js` 里至少有 4 处 `a || b || c` 形式的取值链，
   XD 这条踩过的坑（空白 truthy 短路）在其它源同样可能踩。
2. **给生成器加「选择器存在性体检」**：`fetchers/*.js` 里每个 `$('...')` 选择器，
   定期对真实页面做一次命中计数，某个选择器连续 0 命中就报警 ——
   本次 XD 改版如果能提前一天发现，就不会让 1.4 万条详情空着。
3. **`tools/emulator-sections.js` 已 1000+ 行**，其中「筛选/排序/开关」的装配逻辑高度同构
   （手游中心 / 修改器 / 云存档各一套），建议抽 `createFilterBar()` 工厂 —— 本轮
   `bindToggle` 已经先收敛了手游中心那 4 个。
4. **`data/games.json.bak-2026-09-14-08-25-34`（5.8MB）可清理**，v10.4 封面修复已验收。
