# CODEX-DONE v10.24 —— 「卡片版式统一」：机型兼容 + 解包专区改成同款图片卡

> 用户原话：
> 「可以，你先优化，我希望**机型兼容+解包专区 筛选后的游戏能够同端游或者手游专区的前端展示一样
> （图片+游戏名的卡片样式）**」

**一句话结论**：三处专区的卡片现在是**同一套正文骨架**（`.cov` + `.bd > h4 + .alt + .meta > .pill + .tgs > .tg`）。
机型兼容从「**24 张卡 0 张图**」变成 **21/24 张真加载**（`naturalWidth > 0`）；
解包专区从 352px 的文字卡降到 338px（多出的 106px 全是它专属的三块信息）。
顺手修掉两个**静默 bug**：档位徽标全灰底（类名拼错）、封面 404 时封面位塌掉。

---

## 一、根因：两种「不是同一套东西」

用户看到的是「不像」，但两处的原因完全不同，**都不能靠换 CSS 类名解决**：

### ① 机型兼容：不是版式问题，是**上游根本没给图**

`dmCard` 一直在读 `g.libCover`，写法没问题。问题是 `/api/device/match` 的返回体里
**从来没有 `libCover` 这个字段** ⇒ 拿到 `undefined` ⇒ 走无图分支。

★ 这个 bug 最阴的地方：**它不报错**。

| 看起来正常的地方 | 为什么骗过了眼睛 |
|---|---|
| `.cov` 元素照样存在 | 是 CSS `display:none` 把它藏了，DOM 里查得到 |
| `getBoundingClientRect()` 正常返回 | 卡片尺寸没异常，只是矮了 92px |
| 控制台零报错 | 字段缺失不抛异常，模板拼出空串 |
| 静态防线全绿 | 当时没有任何断言在看「字段在不在」 |

实测修前：机型兼容 24 张卡 **0 张图**，卡高 113px（基线 232px）。

### ② 解包专区：v10.22 只借了 `.emu-card` **类名**

`build-unpack-page.js` 的注释写着「沿用手机专区版式」，实际正文是：

```
.top / .nm / .cnt  +  .up-mc-row  +  .up-chips  +  .up-min  +  .up-mc-btns
```

**六块自建结构**，卡高 **352px** vs 基线 232px —— 类名一样、长相完全两回事。
这就是「同版式」这个说法最容易骗人的地方：**判据必须是骨架同构，不是类名在不在**。

---

## 二、修法

### 2.1 新增 `data/bhcover.js` —— 仓库键 → 端游库条目（单一真源）

取图不能新写一套名称匹配（本项目在跨源名称匹配上栽过多次，见 PITFALLS 10/11）。
库里已经有**两个持久化产物**，直接复用它俩：

| 优先级 | 来源 | 是什么 |
|---|---|---|
| ① | `bannerhub.libMatch({k})` | 仓库键 ↔ 端游库标题键的**精确**对（`/api/bh/list` 一直在用） |
| ② | `mobilehub.json` 条目的 `bhKeys` 反查 | **构建期** merge 算出来的键集（覆盖中文名匹配） |

`libMatch` 原本存在但是**私有的**，本轮补上 `module.exports`（不导出就得再写一份 = 必然漂移）。

```js
function of(key) {
  const k = key && typeof key === 'object' ? key.k : key;
  if (!k) return null;
  try {
    const hit = bannerhub.libMatch({ k });        // ① 精确键优先
    if (hit) return { libId: hit.id || null, libTitle: hit.title || '',
                      libUrl: hit.url || '', libCover: hit.cover || '' };
  } catch (e) {}
  if (!mhMap) buildMh();                          // ② 合并索引反查
  const it = mhMap.get(k);
  if (it && (it.libId || it.libCover)) return { … };
  return null;                                    // 取不到 → null，**不编造**
}
```

**两条链路的实测贡献**（样本机型 Xiaomi 2412DPC0AG，可跑 1,000 款）：

| 口径 | 有封面 |
|---|---|
| 只有 ① | 417 |
| 只有 ② | 523 |
| **① ∪ ②（实际）** | **526** |
| 首屏 24 张 | **21 / 24** |

★ 这两个数字**顺手改掉了一条假绿**：原来的阈值是 `withCov >= 400`，
而两条分支**单独都过线**（417 / 523）⇒ 掐掉任何一条都不变红。
现改为「阈值提到 500」+「给每条分支配一个**只有它能解**的样本键」
（① 独有 `EA_SPORTS__FIFA_23`、② 独有 `Tomb_Raider`），两条分支从此各自可被反证。

### 2.2 `data/device-match.js` —— 只给**返回的那一页**挂封面

```js
total: out.length,
games: (() => {
  const page = out.slice(0, limit);
  try { bhcover.attachAll(page); } catch (e) {}
  return page;
})(),
```

只挂当前页（`limit`），不是给 1,000 条全挂 —— 查询延迟不变。

### 2.3 `tools/emulator-sections.js` —— `dmCard` 换同款骨架

- 无封面时走 **`.cov.ph`**（同尺寸占位块，显示游戏名缩写），**不用** `.cov.noimg`；
- 「最低参考 GPU」折进 `.tgs > .tg`（与手机专区标签行同款），不再单起一行。

★ **为什么不能像手机专区那样「只留有图的」**：手机专区有 **100%** 封面率是因为它按
`libOnly` 过滤（只留库内有条目的）。机型兼容**不能过滤** —— 会把真正能跑、只是库里没收录的
游戏藏掉（实测占 **48%**）。所以只能「有图用图、无图给同尺寸占位块」。

### 2.4 `tools/unpack-sections.js` —— 正文换成 `.bd` 骨架

保留它专属的三块（`.up-chips` 四维判定 / `.up-min` 最低要求 / `.up-mc-btns` 下载按钮），
其余（名字 / 别名 / 热度 / 评分 / 分类）全部套进 `.bd > h4 + .alt + .meta > .pill + .tgs > .tg`。
顺带删掉 9 条死 CSS（`.up-mc-row` / `.up-mc-src` / `.up-badge.*` / `.up-tg-score` / `.up-mc .cnt|.nm`）。

### 2.5 顺手修掉的两个静默 bug

| bug | 现象 | 真因 |
|---|---|---|
| **档位徽标全灰底** | 流畅/可玩/勉强 长得和旁边普通 pill 一样 | `DM_TIER` 写 `cls: 'ok'\|'mid'\|'low'` ⇒ 拼出 `class="pill ok"`，而共享 CSS 里**只有** `.pill.fps.smooth\|ok\|low\|bad` |
| **封面 404 时封面位塌掉** | 同一行其它卡有图、就它少一截 | `onerror` 走 `.cov.noimg{height:0;display:none}` |

后者统一成**换同尺寸占位块**：新增共用函数 `covErr(img, abbr)`
（给 `.cov` 加 `.ph`、塞进缩写 span），并 `window.covErr = covErr` ——
内联 `onerror` 只在全局环境里找名字，不挂 window 就是 `ReferenceError`，**而且会被浏览器静默吞掉**。

---

## 三、效果（全部实测）

| 专区 | 卡片数 | 卡高 | 图真加载 | 封面位 | 档位徽标实测色 |
|---|---|---|---|---|---|
| 手游专区（基线） | 24 | 216~232 | **24 / 24** | 24/24 | — |
| **机型兼容**（改前 → 改后） | 24 | 113 → **185~207** | **0 → 21 / 24** | 24/24（占位 3） | `rgb(220,252,231)` 绿底 ✓ |
| **解包专区**（改前 → 改后） | 80 | 352 → **312~338** | 24 / 24 | 24/24 | `rgb(220,252,231)` 绿底 ✓ |

三处的正文骨架计数全部是 `cov/bd/h4/meta/tgs = 24/24/24/24/24`（取样 24）。

★ **「全屏等高」不是判据**：网格是 `align-items:stretch`，**同一行**必然等高，
但行与行之间会因标题折行差 20px（基线自己就是 216~232）。
实测机型兼容是「第 1 行 4 张全 207、第 2 行全 185」，**行内差 0px**。
所以断言写成三条：屏内跨度 ≤ 基线+30 ／ 行内差 ≤ 4px ／ **用占位块的几张不矮于同行最高卡**。

---

## 四、验证

```
node tools/run-all.js                → 23 套 / 1514 条 / 0 失败
node tools/preview-v1024.js          → 20 / 20（浏览器实拍，含 404 兜底端到端）
node tools/_counterproof-v1024.js    → 12 / 12「打坏即变红」
```

实拍里新增的**端到端**一条（这一段静态断言守不住）：
把某张卡的 `img.src` 换成不存在的地址，等 `onerror` 跑完再量 ——
实测 `before=92px → after=92px`、`classList` 有 `ph`、缩写显示 `GT`。

### 本轮反证抓出的两条**假绿**（值得单记）

1. **断言锚点太宽**：`ok(/class="cov noimg"/.test(emuSrc), '★ 无图时走 .cov.noimg')`
   —— 标签写的是**机型兼容**，命中的却是同文件里**手机专区** `emuCard` 的那一行。
   把机型兼容的兜底整个删掉，它照样绿。
   ⇒ 改成先按行抠出 `dmCard` 函数体，**只在函数体字符串上断言**；
   并额外断言「真抠出来了、长度 > 400」（抠成空串 = 下面全空跑）。
2. **减法型断言恒真**：`ok(emu.maxH - up.maxH <= 60)` —— 解包 338 > 基线 232，
   表达式恒为负 ⇒ **永远通过**，等于没判。改成两个明确方向的断言。

### 一处**假红**（是我的预期写错了）

`Math.abs(dm.maxH - emu.maxH) <= 24` 判红（207 vs 232）。
逐张打印后确认：差的 25px 是「手机专区卡多一行别名 `.alt`」，不是退化。
⇒ 放宽到 40 并在断言名里写明原因 —— **修预期时必须同时回答「那条行为现在由谁守着」**。

---

## 五、改动的文件

| 文件 | 改了什么 |
|---|---|
| `data/bhcover.js` | **新增** —— 仓库键 → 端游库条目/封面，双链路 + 不编造 |
| `data/bannerhub.js` | 导出 `libMatch` |
| `data/device-match.js` | 返回前给当前页挂 `libCover/libId/libTitle/libUrl` |
| `tools/emulator-sections.js` | `dmCard` 换同款骨架 + `.cov.ph` + `covErr`；`DM_TIER.cls` 改完整类名 |
| `tools/unpack-sections.js` | `card()` 正文改 `.bd` 骨架；`VERDICT` 加 `pill`；onerror 改 `covErr` |
| `tools/build-unpack-page.js` | 删 9 条死 CSS |
| `public/index.html` | 新增 `.cov.ph` CSS + `covAbbr` + `covErr`；删 `.dm-need` |
| `public/emulator.html` / `public/unpack.html` | **派生页重建** |
| `tools/test-card-parity.js` | **新增** 69 条（已登记进 `run-all.js` 的 `SUITES`） |
| `tools/preview-v1024.js` | **新增** 20 条浏览器实拍 |
| `tools/_counterproof-v1024.js` | **新增** 12 处反证（一次性工具，同 v10.22/v10.23 惯例保留） |
| `tools/test-download.js` | 解包断言收紧为**锚定模板串**（原来裸搜类名，注释里出现同一串就恒真） |
| `tools/run-all.js` | `SUITES` 加 `test-card-parity.js`；注释 22 → 23 套 |
| `tools/audit-apps.js` | **发布轮修**：计数门禁改 `>=` + **本地自检**（`STALE` / 标记失效）+ 新增 v10.24 门禁 |
| `tools/test-audit-apps.js` | **发布轮修**：新增 D-2 段（门禁自检铁律）→ **28 → 41 条** |
| `tools/verify-online.js` | **发布轮修**：`MUST` 12 → 16 项（补 v10.19 / v10.24）+ `LOCAL_MISSING` 自检 |
| `tools/_counterproof-audit.js` | **新增** 4 处反证（一次性工具，按惯例保留作记录） |
| `README.md` / `CODEX-INDEX.md` / `WORKFLOW.md` / `CODEX-HANDOFF.md` / `PITFALLS.md` | 文档同步 |

---

## 六、发布（2026-09-20，用户授权后）

用户原话：「**是**」（回答我上一轮的问句「v10.24 是否发布到线上？」）。

**目标选择**：工作区有 **4 个**同名 app 登记，发布工具要求用户选定 —— 用户选「**覆盖当前 LIVE**」
（`wbapp_047aLTlMY7YdDmtVpp3BYa`）。

| 项 | 结果 |
|---|---|
| 链接 | **`https://gamehub-agg-v4.app.workbuddy.host/`**（**未变**） |
| sandbox | `445143a7b3004d749eab6be0fe8836e5`（**复用成功**） |
| 三页 md5 | index `c0eaccde19` · emulator `e4855f873b` · unpack `73e7d3b5bc` —— **全部逐字节一致** |
| 对账 | `audit-apps.js`：LIVE「**与本地同版（含数据层）**」 |
| 线上验收 | `verify-online.js` **25/25**（MUST **16 项齐**） |
| 线上站实拍 | `BASE=<线上> node tools/preview-v1024.js` **20/20**（机型兼容 **21/24 真出图**、行内差 0px、占位块不矮、404 兜底 92→92px） |

★ **推翻一条旧结论**：v10.23 那次记的是「覆盖三个旧 app **全部被硬拒**（预留域名绑的是旧发布环境）
⇒ 新版本只能新建 app」。本轮**同样的覆盖动作被接受了**，链接与 sandbox 都没变。
⇒ 那条结论改成「**环境相关的偶发拒绝**」：**先试覆盖，被拒再新建**（不要再默认新建）。

---

## 七、发布验收时顺手修掉「验收工具自己报反」的三处

这三处都在**判定链路**上：它们错了结论会**正好反着来**，而且**全都不报错**。

### 7.1 `tools/audit-apps.js` —— 门禁过期 ⇒ 把 LIVE 判成旧版（★ 差点误报发布结果）

门禁写死 `r.body.total === 3181`，而当天 `mobilehub` 已涨到 **3,195** ⇒ 该门禁**在本地也为假**。
它不报错，只会把**每个域名**都判成「旧版（停在 v10.21 之前）」——
实测 LIVE 明明只差一个 v10.24，却差点被写成「线上还停在 v10.21 之前」。

修法三条：

1. **计数型门禁一律 `>=`** —— `=== 3181` 的真实含义是「**在某一天之前**为真」⇒ 必然变永假；
2. **加本地自检**：门禁先拿本地跑一遍，**本地也不满足的记进 `STALE`、不参与版本判定**，
   单列「⚠️ 标记失效」提示修探针。判据一句话：**一条只能在本地为真的判据，没资格判线上。**
   ⚠️ 本地服务没起时**不**据此判定失效（那会把版本判定能力静默关掉），保守按未失效 + 告警；
3. 新增 **v10.24 门禁**（`window.covErr = covErr`），发布后能自动确认新版真的上线。

防线 `tools/test-audit-apps.js` **28 → 41 条**（新增 D-2 段 8 条）。
反证 `tools/_counterproof-audit.js` **4/4「打坏即变红」**，源码逐字节还原（md5 校验）。

### 7.2 `tools/verify-online.js` —— `MUST` 名不副实（断言名 over-claim）

`MUST` 清单只到 **v10.18**，断言名却写「线上首页含**本版全部**特征串」——
它绿的时候让人以为 v10.19~v10.24 都验过了，**实际一个都没验**。
⇒ 补 v10.19 / v10.24 共 4 项（**12 → 16 项**）、名字改成「**v10.14~v10.24**」，
并给 `MUST` 加**本地存在性自检**（本地都没有的串区分不了新旧，只会假红 —— 同 7.1）。
线上验收 **24/24 → 25/25**。

### 7.3 反证脚本自己踩坑：打坏后的代码**语法不合法**，那种「红」不算数

`_counterproof-audit.js` 第一版把 `if (self.alive.get(g)) missing.push(g);` 换成裸语句
`missing.push(g);`，**留下一个悬空 `else`** ⇒ 子进程直接 `SyntaxError` 就「红了」。
那不是护栏在守行为，等于没验证（而且子进程 stderr **漏进了父进程输出**，
是看到一条莫名其妙的 SyntaxError 才发现的）。
⇒ 反证脚本在跑断言前先 `node --check` 被打坏的文件，**语法不合法就判这条反证无效**。

---

## 八、下一步

1. ~~发布 v10.24~~ ✅ **已完成（2026-09-20）**，链接未变、三页逐字节一致；
2. **解包匹配的字段校准**（阻塞在用户）：需要一份**真实解包 JSON 样本**，
   到手后**只改 `data/spec-dict.js`**，界面与 `/api/spec/*` 都不动；
3. **旧 app 清理**（用户手工）：现有 4 个应用，★ **绝不用 sites 的 `unpublish`**（会误伤 LIVE）；
   删前先跑 `audit-apps.js`，用对账表看哪个域名还能用、停在哪一版。
