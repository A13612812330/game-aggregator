# ⚠️ 本文已归档（停在 v10.10）—— 别再照着它干活

> ## ★ 归档说明（2026-09-18 补，v10.22 时）
>
> 本文最后更新于 **v10.10**，此后又走了 **v10.11 → v10.22 共 12 个版本**。
> 它现在只作为**历史快照**保留（记录当时怎么想的），**不再是「最新交接」**。
>
> | 你要找什么 | 看哪里 |
> |---|---|
> | 当前版本 / 各版做了什么 | **`CODEX-INDEX.md`**（索引，最新置顶）+ `CODEX-DONE-vX.Y.md`（逐版完整说明） |
> | 界面与功能的当前形态 | `README.md` |
> | **当前分享链接** | `https://gamehub-agg-v4.app.workbuddy.host/`（v10.23 起，**v10.24 发布后链接未变**） |
> | 每次收尾的五项状态 | `node tools/report.js`（**实测**，不靠记忆） |
>
> ⚠️ **下面 v10.10 那段里的分享链接是 `36aa37e9…` —— 它已经再次降回弃用。**
> 这条域名的 why 变过**四次**，每次都是实测推翻旧说法：
> ①「碰巧含 v10.18」→ ②「未登记的别名域名」→ ③ v10.22 被选为 LIVE（v3 发布环境失效、工具硬拒覆盖）
> → ④ **v10.23 又降回弃用**。④ 的缘由：它**未登记**在 `.workbuddy/applications.yaml`，
> 而发布工具是**按 appId 找应用**的 ⇒ 根本够不着它（实测确认）。
>
> **2026-09-20（v10.23）发布结论**：
> · 新链接 **`https://gamehub-agg-v4.app.workbuddy.host/`**
>   （appId `wbapp_047aLTlMY7YdDmtVpp3BYa` · sandbox `445143a7b3004d749eab6be0fe8836e5`）
> · 三页与本地 **原始 md5 逐字节一致**；线上四榜 41 条**无封面 0 条**
> · ★ **覆盖三个旧 app 全部被硬拒**（实测：预留域名绑的是**旧发布环境**）
>   ⇒ 新版本只能**新建 app**。这是「预留新建位」这条经验的来历。
> ⚠️ **比 md5 时响应体必须用 `Buffer.concat(chunks)` 拼接** ——
>   用字符串 `b += chunk` 累加会在**跨 chunk 的中文字符**上损坏 UTF-8，
>   得出「线上与本地不一致」的**假结论**（2026-09-20 实测踩到，差一点误判 v10.23 没上线）。
> **已弃用**：`36aa37e9…`（停 v10.22，未登记）/ `gamehub-agg-v3`（v10.21）/
> `-v2`（v10.18）/ `-join`（v10.17）。
> ⚠️ 判定版本一律比 `index.html` 的 md5 —— 这**五个**域名**全部返回 200**，状态码区分不出新旧。
>
> ⚠️ 同理，本文里的**任务清单、端口约定、启动器写法、遗留项**都可能已被后续版本改掉，
> 引用前先到 `CODEX-INDEX.md` 确认。

---

> ## ★ v10.10 增量（2026-09-15）—— 启动器三件套 + 线上共享链接（⚠️ 链接已弃用，见上）
> **启动器三件套 + 线上共享链接**，完整说明见 **`CODEX-DONE-v10.10.md`**。
> 用户原话：「给我启动器+共享链接」。
> · **共享链接**：`https://36aa37e911e6447eb86eb187240daff2.app.workbuddy.host`
>   （HTTP 服务发布，sandbox `36aa37e911e6447eb86eb187240daff2`；线上实测 `/` → 200/163KB、
>   `/api/health` → 200、`/api/mods/stats` → 200 返回 8,943 条 ⇒ **v10.9 的 MOD 数据层线上同样可用**）
> · **启动器**：`启动聚合站.cmd`（前台看日志）／`启动聚合站-静默.vbs`（无黑窗）／`stop-gamehub.cmd`（按端口杀 PID）。
>   核心是**幂等启动**：`netstat + findstr` 查 8123，已监听则只开浏览器，不重复起实例（避免 8124/8125 一串）。
>   Node 双保险：PATH → 回退 managed `22.22.2-2\node.exe`。主入口顺带打印**局域网地址**供手机访问。
> · 遗留：旧 `启动聚合站.bat` 的 node 回退路径写错（`C://Users//…//22.22.2//`，版本号少 `-2`），建议删除。
> ## ★ v10.9 增量（2026-09-15）—— 机地「MOD / 修改器」社区帖全量接入（数据层 + 预览）
> **机地「MOD / 修改器」社区帖全量接入（数据层 + 预览）**，完整说明见 **`CODEX-DONE-v10.9.md`**。
> 用户原话：「补充MOD：`jidiyouxi.com/modify/list` 中 `MOD` 页签里 **自动轮询页面获取**；补充修改器：`修改器` 页签 同上」。
> 追问两答：落位 →「并入到手游的那块」；范围 →「做成跟手游专区那一样**弹窗里填充内容**」。
> 1. **首次拿下机地的写接口**。翻页打 `POST /api/misc/post_list?websign=<sign>`（`text/plain`）。
>    签名：`"v2-" + md5(String(h_m||0) + md5(JSON.stringify(body) + "YhD6TCs9VpAl"))`（站点 md5 与 Node crypto 等价）。
> 2. ★★ **拦路虎不是签名，是 body 必须整份 env 展开**：`{...env, ...业务参数, h_ts, h_ch}`。
>    只发业务参数（哪怕再加 `h_did`/`h_m`/`h_ch`/`h_ts`）一律只回 `{"ret":-1,"msg":"请求参数错误"}` ——
>    **签名算错也回这一句**，所以极难定位。env 来自列表页 SSR 的 `<script id="appState">`（含服务端下发的 `h_did` UUID）。
>    ⇒ 必须「**先抓一次 SSR 取 env → 再翻页**」。`limit` 上限实测 **100**；`resource_type` 2=MOD / 3=修改器。
> 3. **结果**：MOD **7,825** + 修改器 **1,118** = **8,943 条**；命中端游库 **79.1%**；
>    **含下载链接 8,936 条（99.9%）/ 链接 13,390 条**；覆盖 **883 款游戏**。全量一轮约 **70s / 91 请求**。
> 4. ★ **匹配率 55% → 79.1%**（救回 2,160 条），两个隐蔽 bug：㈠ `length>=3` 护栏**整类误杀 2 字中文名**
>    （`剑星`/`鸣潮`/`仁王`）→ 含 CJK 放行 2 字；㈡ **条目侧游戏名也是 `/` 拼接串** → 条目侧也分段试。
>    逻辑抽到 **`data/mod-match.js`**（单一真源）。
> 5. **与既有 `trainers.json` 互不替代**：trainers = GCM 英文站元数据（**无下载地址**，答「有没有」）；
>    mods = 机地社区帖（**带网盘直链**，答「**怎么拿到**」）。
> 6. 新增 5 条路由 `/api/mods/{stats,list,item,top,match}`。**前端一行未动** —— 等用户看过预览确认落位后再并。
> 7. 新增 **第 9 道防线 `tools/test-mods.js`（77 条）**。九道防线全绿：
>    **结构 128 · 行为 118 · emuhub 118 · 布局 77 · 别名 7 · saves-match 44 · search-ui 44 · date-norm 47 · mods 77（共 660）**。
> 8. 交付物 `_preview/mods-preview.html`（3.19MB 自包含；样式直抽线上 `emulator.html`，观感即并入后的观感）。
> **待定**：①「MOD」加第 6 个页签 vs 并入「手游中心」列表；② 机地 1,118 条修改器与 GCM 3,589 条如何并列；
> ③ 是否挂进每日自动化。

> ## ★ v10.8 增量（2026-09-15）—— 更新时间排序 / 全站榜缺号 / 日期数据根治
> 完整说明见 **`CODEX-DONE-v10.8.md`**。用户原话：「优化，其次首页的最近更新好像有点小问题（时间排序的问题）首页的全站榜少了2」。
> 1. **全站榜少了2** —— 源站「全站最热」**第 1 名是 `XDGAME游戏运行库检测工具`**（非游戏），
>    过滤后**沿用源站序号**（2..10），前端冠军卡又吃掉 `list[0]` → 普通卡从 **3** 开始、缺 1 和 2。
>    改：抽出 `cleanPlate()`，**过滤后重排为连续 1..N**，原序号存 `srcRank` 便于追溯；
>    剔除数经 `meta.dropped` 显示「已滤除 1 条工具条目」。（源站该档只给 10 行，物理上限 9 条）
> 2. **最近更新时间跳序** —— 四个根因叠加：
>    ① 排序键用了 `updatedTs`（**本站抓取时间**）而非源站更新日期；
>    ② 两源格式不同（XD ISO `2026-09-14` / 机地斜杠 `2026/9/9`）；
>    ③ **入库正则贪婪吃位** —— 源站真值 `2026/9/8` 被存成 `2026/9/89`（已抓源站原文核对 6 例）；
>    ④ 斜杠/畸形日期令 `new Date()` 失败 → 兜底 `updatedTs` 变 **NaN** → 排序退化为 0。
>    改：`shared.normDate/dateTs` 统一归一化（含还原被吞的「日」）→ 抓取层去贪婪 →
>    `gamesDb` load/upsert 双入口兜底 → **排序改「源站更新日期优先 + 收录时间打平」**。
>    排序键用 non-enumerable 的 `_sortTs`，`JSON.stringify` 不会写进 games.json。
> 3. **存量迁移**（`tools/migrate-dates.js`，支持 `--dry`/`--fetch`）：15,302 条中 60 条改动
>    （还原 3 / 补零 57 / 补 ts 43）；**6 条无日期条目联网全部补齐**（与真实发售日吻合）。
>    迁移后：非 ISO 日期 **0** · 无日期 **0** · 非法 ts **0**。
> 4. **顺带体检**：修掉 `xd-3160` 的 `score=54` 越界；澄清两处探针误报
>    （机地封面无扩展名但实测是有效 JPEG、`updatedTs` 晚于日期 6 年是"老游戏新收录"）。
> 5. **新增第 8 道防线 `tools/test-date-norm.js`（47 条）** —— 11 条"该还原的" + 10 条"该拒绝的"
>    （只测还原会退化成"什么都接受"，只测拒绝会退化成"什么都拒绝"）。
> 6. 两个坑已写进注释：`catch` 静默吞错让"库变空"零报错（已修）；并行编辑同文件会互相覆盖（流程问题）。

> ## ★ v10.7 增量（2026-09-14）—— 搜索弹窗优化 + 详情抽屉加宽
> **搜索弹窗优化 + 详情抽屉加宽**，完整说明见 **`CODEX-DONE-v10.7.md`**。
> 用户原话：「优化下搜索弹窗，以及可以拓宽点详情页吗」。用户选定：抽屉 **680px 基准 / 宽屏 50vw**；
> 搜索弹窗**只做**「收紧行高 + 去掉隐形占位」「分组按相关性排序」两项（**未选**空分组隐藏、弹窗加宽）。
> 1. **抽屉宽度** `520px` → `min(clamp(680px,50vw,1040px),100vw)`（1440 视口 = 720px／50%；≤760px 仍 100vw）。
>    配套 `.kv` 2→3 列、`.shots` 2→3 列（移动端回退 1/2 列）；正文 scrollHeight 2465 → 2327。
> 2. **分组按相关性排序** —— 原顺序写死 `手游→修改器→云存档→端游库`，搜游戏本名时本体被压在第 4 组。
>    ★ **第一版只按贴合度打分直接失败**：四库收录同一批游戏，实测「艾尔登法环」四组全 3 分、
>    「只狼/GTA/赛博朋克」四组全 2 分 → 全平局又退回原顺序。
>    定稿加**端游库本体提权**（`贴合度 ≥2 时 +1`），并改用别名目标名打分（`qEff`）。
>    结果：6 个词端游库全部升到**第 1 组**；端游库零命中的词（以撒的结合 重生 / 蔚蓝Celeste）**保持默认顺序**。
> 3. **行密度**：根因不是缩略图，是 `body{line-height:1.6}`（14px 标题行撑 22.4px）→
>    行距收紧 1.3/1.35 + 缩略图 86×50→76×44 + 内边距 9→7。常见行高 **84 → 68px**，首屏可见 **6 → 9 行**。
> 4. **隐形占位**：`.go2` 原为流内元素、`opacity:0` 却实占 ~85px，把来源徽标从右边缘推开 →
>    改绝对定位浮出（底色同行 hover 底色，淡入时盖住徽标；`pointer-events:none`）。
>    **徽标留白 79 → 11px**，hover 前后行宽差 **0.00px**（不诱发回流）。
> 5. 「同分类更多」(`#relSlot`) 由第 2 位挪到**最后**。⚠️ 此项用户未明确点选，可一句话退回。
> 6. **新增第七道防线 `tools/test-search-ui.js`（44 条）**；`test-emulator-structure` 104 → **128**（含派生页一致性）。
> **基线：结构 128/128、行为 118/118、emuhub 118/118、布局 77/77、别名 7/7、saves-match 44/44、search-ui 44/44。**
> 页面指纹：`index.html` `32d8b432…` / `emulator.html` `821db2b4…`。
> ※ 「首屏 12 行」未达成（实测 9 行）—— 3 行文字的物理下限约 68px，再压需砍信息层级，见该文档第六节。

> ## ★ v10.6 增量（2026-09-14）—— 云存档「点不进详情页」根治（跨源名称匹配）
> 完整说明见 **`CODEX-DONE-v10.6.md`**。
> 承接 v10.5：那轮修的是**有 libId 的卡片**，本轮解决**根本没有 libId 的那一批** —— 那才是「点了没反应」的大头。
> 1. **根因**：`tools/build-saves.js` 的「清单名 ↔ 端游库」匹配**只有精确钥匙一层**。
>    清单 `Resident Evil 2` → `residentevil2`，库内 `Resident Evil 2:Remake` → `residentevil2remake`，
>    精确不等 ⇒ `libId = ''` ⇒ 云存档卡片点正文只弹 toast、**不开抽屉**。
>    5,741 条里 378 条无 libId，其中 **122 条标题其实就在库内** —— 不是数据缺失，是匹配器漏了。
> 2. **修法**：两层匹配（① 精确钥匙 → ② 连续子串）+ 三道防误配护栏
>    （数字一致性 / 多出部分必须能由修饰词拼成 / 中文系列名禁止模糊），多候选取「修饰最少」者。
> 3. **修复过程自身抓出三个缺陷**（都写进注释了）：
>    ① `anchorOf()` 原用 `k.match(/[a-z]+/)`，对纯字母键会匹配**整串** → 分桶退化成「一键一桶」→
>       只有带数字的查询碰得上，`Another World` 这类纯字母查询永远命中不了；
>    ② 「按词切分 + 完整词包含」在**去空白键**上不成立（`starcraftremastered` 是一个 token）→
>       该函数已删除，包含性与跨词子串防护统一交给 `extraIsDecoration`；
>    ③ 修饰词白名单误收 `vr`（`Bulletstorm`→子弹风暴VR、`World War Z`→僵尸世界大战VR、`Townsmen`→家园VR）
>       与单字母 `a`（`Vesper`→Vespera）→ 复核 247 条时抓到，已剔除。
> 4. **数字**：收录 5,741 → **5,923**；有 libId 5,363 → **5,609**（+246，其中模糊层救回 237，
>    **逐条人工复核零误配**）；无 libId 378 → **314**。浏览器实测**云存档首屏无详情入口 7/24 → 3/24**。
> 5. **新增第五条防线** `tools/test-saves-match.js`（44 条）+ `build-saves.js --dry` 干跑复核模式。
> **基线：结构 104/104、行为 118/118、emuhub 118/118、布局 77/77、别名 7/7、saves-match 44/44。**
> 页面未改（`index.html` `bb664b28…` / `emulator.html` `461e8430…` 与 v10.5 一致）；服务已重启（8123）。

> ## ★ v10.5 增量（2026-09-14）—— 点击语义 / XDGAME 详情解析 / 筛选条
> **点击语义 / XDGAME 详情解析 / 筛选条** 三处系统性修复 + 两个新筛选，完整说明见 **`CODEX-DONE-v10.5.md`**。
> 1. **XDGAME 详情解析全线失效（本轮最大发现，影响 ~1.4 万条）**：站点改版把标题挪进 `.article-title-text`，
>    旧代码 `clone().find('span').remove()` 把它当徽章删了 → 剩下**空白文本节点是 truthy** →
>    `h1Clone.text() || $('h1').text() || …` **被空白短路** → `title` 恒为 `""`。
>    类型（面包屑 `href` 由 `/sort/` 改 `/list/N/`、`/game/N/`）、容量（不再有独立字段）同样失效。
>    修法：`pickText()` **先 trim 再判空** + 面包屑末级 + `.article-tags` 标签 + 版本介绍里的 `容量xxGB`。
> 2. **卡片点击语义统一：有端游库命中就进详情**。原 `bhk` 优先于 `libId` → 「既命中库又有社区配置」的卡
>    点正文进了社区配置面板（用户原话「不是游戏详情页」）。社区配置降级为卡上 `📋 社区配置` 按钮。
> 3. **云存档卡片正文可点进详情**（上一版「防误触」把整卡点击吞掉 → 用户反馈「点击未跳转」）。
>    改为区域分工：`.cp` 只复制 / `.paths` 不跳转（可选中）/ 其它地方进详情；每行路径新增复制按钮。
> 4. **筛选条换行**：激活态改文案 → 按钮 +28px → 顶掉开关；改 ✓/○ 后浏览器实测**字形差 1.6px**，风险没根除。
>    最终方案：筛选独占一行 + 状态走**定宽伪元素** `.em-tg::before{width:1.1em}`，JS 只切 `.on` 类。
> 5. **新增 `data/xref.js` + 两个横切筛选**：🛠 有修改器（2,237）/ 💾 有云存档（5,354）/ 两边都有（1,589），
>    首页聚合库与手机专区都能筛，与既有条件 AND；手游卡片回填 `hasTr`/`hasSv` 角标。
> 6. **基线变了**：结构 **104/104** · 行为 **118/118** · 布局 **77/77** · 别名 **7/7** ·
>    `emulator.html` md5 **`461e84307f0da1aa9e993a00a1bbf40f`** · `index.html` **`bb664b2885bb66d274203aafa464d9bf`**。
> 7. **给 Codex 的建议**（未做，见 `CODEX-DONE-v10.5.md` 第七节）：`pickText` 抽公共工具（还有 4 处同类 `a||b||c`）·
>    给生成器加**选择器命中体检**（本次 XD 改版若能提前发现，1.4 万条详情不会空着）· 专区筛选装配抽 `createFilterBar()` 工厂。

> ## ★ v10.4 增量（2026-09-14）
> **手游专区搜索失效 + 封面未回落端游库**，完整说明见 **\`CODEX-DONE-v10.4.md\`**。
> 1. **搜索**：专区页顶栏「🔍 搜索」**点了完全没反应**。根因 —— \`$('#searchOpen')\` 绑定写在 \`bindRankUI()\` **内部**，
>    而生成器把派生页的 \`bindRankUI();\` **调用整行注释掉**（该函数还要绑专区页不存在的 \`#rankPills\`/\`#rankRefresh\`）→ 绑定从未执行。
>    修法：**提到函数之外**，作为两页共用的独立绑定（且从函数内删掉，避免首页绑两次）。
> 2. **封面**：端游库 **223 条** \`cover\` 是 XDGAME 站内相对路径（\`/uploads/…\`）→ 铺到 \`<img>\` 打本站 **404** → 卡片只剩色块。
>    **首页同样挂着**，只是专区首屏第一张（FIFA19）恰好是它。补 \`https://www.xdgame.com\` 前缀即恢复。
> 3. **新增 \`data/cover-url.js\`（封面 URL 归一化单一真源）**，被 \`gamesDb.js\`（load **+ upsert 入口**）与 \`build-mobilehub.js\` 引用。
>    **入口也要拦**：增量索引每次从源站重抓都会带回相对路径，不拦会把修好的覆盖回去。
> 4. **基线变了**：结构 **82/82**（原 72）· 行为 **108/108**（原 103）· 布局 **34/34** · 别名 **7/7** ·
>    \`emulator.html\` md5 **\`79096a4d8c7f29bae4ca745f2b0b7935\`** · \`index.html\` **\`cecc6fd7562cdb5c34d9824e663e794b\`**。
> 5. **⚠️ 第三次同类事故**（\`loadBhBlock\` / \`goEmuPage\` / 本次哑绑定）：生成器按「函数/整块」粒度摘除主页面代码，
>    而块里可能藏着两页都需要的公共能力。**凡是两页都要用的绑定，一律放在 \`bindRankUI()\` 定义之外。**
> 6. \`games.json\` 修复前已备份 → \`data/games.json.bak-2026-09-14-08-25-34\`，确认无异常后可删。

> ## ★ v10.3 增量（2026-09-14）
> **排序 / 容量 筛选条显示效果优化**，完整说明见 **`CODEX-DONE-v10.3.md`**。
> 1. **筛选条从「一行混排」改成「两行操作台」**：两行 `.filter-row`，行首带 `排序` / `容量` 标签（与上方分类行的「分类」同规格）；
>    `.filter-bar` 改为与 `.cat-panel` 同规格的白卡面板。
> 2. **两组统一到一套分段控件语言**（灰轨 + 白块选中，与顶栏 `.main-nav` 同语言）—— 原来是「蓝色实心胶囊 vs 白色凸起块」两套。
>    选中态不再用主色实心块（同屏已有分类的「全部」是实心块，两个会抢注意力）。
> 3. **修了三个 bug**：① `.sort-pills` 的 `margin:2px 0 12px` 把排序组顶离基线；
>    ② `.pc-badge` 让「🎮 有实测记录」未激活态发紫、激活态盖掉红橙渐变（一个开关两种态）；
>    ③ **`<760px` 整页横向溢出** —— nowrap 分段控件的 min-content 顺着栅格子项 `min-width:auto` 传染，把 `#colMain` 撑到 531px（视口 375）。
> 4. **基线变了**：结构 **72/72**（原 61）· 行为 **103/103** · 别名 **7/7** ·
>    **布局回归 34/34（新增）** · `emulator.html` md5 **`b22c7b04d4aa9c04716f08bb91350adc`** · `index.html` **`87431ae69f2a9b5d173057a2cb1eb547`**。
> 5. **新增第四条防线 `tools/test-filter-layout.js`**：三层测试（结构/jsdom/别名）**都算不出布局**，
>    本轮最严重的两个问题都是「测试全绿、线上错位」。该脚本真跑 Edge 量 6 个视口。用法见文件头注释。
> 6. `DESIGN.md` 本轮补了 **§4 筛选条实装规范 + §7 Do/Don't + §8 断点**，并在顶部声明「其余章节以代码为准」（旧稿主色写的 `#5B5BD6`，实为 `#2E6BFF`）。
>    **P2-1「同步三份滞后文档」因此缩小了一半范围**（DESIGN.md 组件节已部分同步，数字仍未同步）。
>

> ## ★ v10.2 增量（2026-09-14）—— 手机专区导航「单一出口」修正
> 手机专区**导航「单一出口」修正**，完整说明见 **`CODEX-DONE-v10.2.md`**。
> 1. **回首页只剩一个出口**：桌面看顶栏「🏠 首页」（已改成 `href="/"` 真跳转，高亮改到「📱 手机专区」）；
>    窄屏看底部 Tab「🏠 首页」。页内那个「← 返回聚合首页」按钮**已删除**。
> 2. **底部 Tab 已重写**：`热榜/最新/搜索/手机专区/关于` → **`首页/手机专区/搜索`**（原来的「最新」「关于」在专区页是死链，且窄屏顶栏隐藏时没有任何回首页入口）。
> 3. **又修了一个孤儿调用**：`goEmuPage`（点一次底部 Tab 抛一次 `ReferenceError`，与 v10.1 的 `loadBhBlock` 同类）。规律：派生页会随「跳转块」一起删掉一批函数定义，调用点却散落在共用脚本里。
> 4. **基线变了**：结构 **61/61**（原 53）· 行为 **103/103**（原 96）· `emulator.html` md5 `ed87c40e177120e687ed0bc5f4f83dad`。
> 5. **页面标记**：派生页现在是 `<body data-page="emulator">`，主源脚本靠 `IS_EMU_PAGE` 区分两页的顶栏语义。
>
> ## ★ v10.1 增量（2026-09-14，先看这段）
> 在 v10 基础上完成 **P0-3 / P0-2 / P1-1 / P1-6** 四项，完整说明见 **`CODEX-DONE-v10.1.md`**。
> **接手必知 4 件事**：
> 1. **端口已统一为单一真源**：`server.js` 里 `const PORT = parseInt(process.env.PORT,10) || 8123`，末尾 `listen(PORT, 30)`。源码 `grep 3456` 零命中，启动就是 `node server.js`。
> 2. **质量基线变了**：结构 **53/53**（原 45）· 行为 96/96 · 别名 7/7 · `emulator.html` md5 基线 `5815e9d6…`。
> 3. **顺带修了 `loadBhBlock` 孤儿调用 bug** —— 详情抽屉的「另一源也有收录」「同分类更多」现在才真正会显示。
> 4. **新增接口参数**：`GET /api/mobilehub/list?only=both`（只看双料）。
>
> ⚠️ **编辑约定**：同一文件的多处修改**不要在同一次里并发提交** —— 会互相覆盖（读-改-写竞态），本机实测踩过。请分次改或用脚本做原子替换。

# GameHub 游讯聚合站 · 交接文档

> **生成时间**：2026-09-10 17:12 ｜ **补充 v10**：2026-09-11
> **项目路径**：`E:\新建文件夹\WorkBuddy\2026-09-03-16-11-58\game-aggregator`
> **服务地址**：`http://127.0.0.1:8123/`（Express，`node server.js`）
> **文档用途**：把当前进度完整移交给其他智能体继续优化

---

## ★ v10 增量（2026-09-11）—— 手机专区新增「修改器 / 云存档」两个页签

手机专区**新增两个页签**：**修改器**（#trainers）与 **云存档**（#saves），页签数 **3 → 5**。

| 项 | 内容 |
|---|---|
| 修改器数据源 | `https://gamezonelabs.com/api/data/gcm`（**公开 GET，免密钥**，808KB JSON） |
| 修改器规模 | 3,589 条 / 5 来源（CE 表 1,846、风灵月影 1,152、社区 665、小幸 59、GCM 精选 20）/ **73.7% 命中端游库** |
| 云存档数据源 | `mtkennerly/ludusavi-manifest`（MIT，17MB YAML / 33 万行） |
| 云存档规模 | 5,741 款 / 13,097 条存档路径 / 920 条注册表项 / **1,117 款手机能玩**（= 页签数字口径） |
| 新增脚本 | `tools/fetch-trainers.js`、`tools/build-saves.js` |
| 新增索引 | `data/trainers.js`（+`trainers.json`）、`data/saves.js`（+`saves.json` 4.9MB） |
| 新增接口 | `/api/tools/stats`、`/api/trainers/{stats,list,match}`、`/api/saves/{stats,list,match}` |
| 搜索扩展 | `/api/search/all` **2 分组 → 4 分组**（`pc` / `mobile` / `trainer` / `save`） |
| 新依赖 | `js-yaml`（deps）、`jsdom` + `puppeteer-core`（devDeps）——**后两个原先没写进 package.json，被 npm 剪掉过** |
| 验收 | 结构 **45/45**、行为 **96/96**、生成器三连跑 md5 一致 |

### 接手 v10 必须知道的 4 件事

1. **匹配前先把标题按 `/` 切段**。端游库 `title` 是 `中文/English/别名` 拼接串，
   整串归一化会把斜杠吞成 `艾尔登法环eldenring`，匹配率从 **73.8% 假跌到 2%**。
   `tools/fetch-trainers.js` 的 `buildLibIndex()` 是正确写法的样板。
2. **修改器不提供下载直链**（有意为之）。GCM 走一次性 S3 签名 URL，依赖仓库外
   `secret_config` 的 `SIGNED_URL_DOWNLOAD_ENDPOINT` + `CLIENT_API_KEY`，无法离线复现。
   卡片给的是「获取方式」外链，别试图绕过。
3. **云存档清单是流式过滤的**，别改成 `yaml.load` 整份解析 —— 17MB / 33 万行会吃爆内存。
   见 `tools/build-saves.js` 的 `collectMatched()`。
4. **改 `data/*.js` 只读索引后要重启服务**（老规矩）。

---

## 一、项目是什么

**GameHub 游讯聚合站** —— 基于 **jidiyouxi.com（机地）** 与 **xdgame.com（XDGAME）** 两个源站构建的单机游戏信息聚合站。

核心定位：**只提供「详情页 + 更新内容」，不提供任何下载资源。**

从轮 11 起扩展出一条主线：**手机 PC 模拟器**（用安卓手机跑 PC 游戏），
聚合社区配置库、实测配置库、模拟器指南、机型兼容查询，并把手游数据与端游库做匹配。

---

## 二、当前架构（单源双页）

```
game-aggregator/
├── server.js               ★ Express 服务（39KB）+ 缓存 + 41 个路由
├── public/
│   ├── index.html          ★ 主源（126KB）—— 聚合首页（热榜 + 最新收录）
│   └── emulator.html       ★ 派生页（171KB）—— 手机专区（3 分区）
├── data/
│   ├── games.json          ★ 端游本地库（5.7MB，XDGAME 15,118 + 机地 46 = 15,164 款）
│   ├── gamesDb.js            本地库索引：load/upsert/search/browse/byIdGet/sizeGb
│   ├── index-state.json      索引断点/校准/机地同步状态
│   ├── bannerhub.json        社区配置索引（2,597 款，446KB）
│   ├── bannerhub-files.json  社区逐条配置明细（14,003 条，1.7MB，懒加载）
│   ├── bannerhub.js          社区库归一化匹配（★ 96.9% 命中率，很稳，别乱动）
│   ├── bannerhub/            仓库快照 raw/ + filelist.txt
│   ├── phonecfg.json         实测配置索引（1,037 条 / 1,025 款，803KB）
│   ├── phonecfg.js           实测库索引 + libKeys 匹配（保留 CJK 的钥匙）
│   ├── cn-names.json         手写/学到的中英别名表（143 条）
│   ├── mobilehub.json        ★ 手游中心合并索引（3,161 款，1.5MB）
│   ├── mobilehub.js          ★ 合并索引读写（list/stats/lookup/ensure/normKey）
│   ├── mobilehub-names.json  ★ 联网补名产物（344 条别名，见第六节）
│   ├── mobilehub-names.progress.json  ★ 补名断点文件
│   ├── emuguide.js           模拟器指南（5 层栈/芯片驱动/包装器/优化/避坑/帧率）
│   ├── soc-db.json           芯片规格库（1,444 款 / 44 厂商）
│   ├── device-board.json     主板代号 → SoC/CPU（200 条）
│   ├── turnip.json           Turnip 驱动构建看板
│   ├── gpu-tier.js           GPU 性能层级表（93 型号 → 统一性能分）
│   └── device-match.js       机型兼容匹配引擎（向下兼容推断）
├── tools/                    （17 个脚本，见第四节）
├── README.md                 ★ 5.2 万字完整文档（v9.3）
└── DESIGN.md                 页面设计规范
```

### ★ 单源双页架构（最重要的约束）

**`index.html` 是唯一编辑入口**，`emulator.html` 由 `tools/build-emulator-page.js` **派生**。

```bash
node tools/build-emulator-page.js     # 生成派生页（幂等，已验证连跑三次 md5 一致）
```

**改任何共享资产（CSS / 顶栏 / 抽屉 / 通用脚本）都只改 `index.html`，然后重跑生成器。**
直接改 `emulator.html` 会在下次重建时被覆盖。

---

## 三、页面信息架构（当前 = v9.3）

### 聚合首页 `index.html`

| 区域 | 内容 |
|---|---|
| 顶栏 | **只 2 个入口**：`🏠 首页` / `📱 手机专区`（指向 `/emulator.html`） |
| 热榜舞台 | 冠军大卡 + #2-10 三列网格，四档 pill（周/月/全站/社区） |
| 搜索 | 弹窗式（`Ctrl+K` / `/` 唤起），**统一搜全站**（端游库 + 手游中心双分组） |
| 最新收录 | 分类行 + 排序 + 行卡列表 + 右栏内容库状态 |
| 移动端 | 底部 Tab 5 项 |

### 手机专区 `emulator.html`（**3 分区 / 3 页签**）

| 页签 | hash | 内容 |
|---|---|---|
| **① 手游中心** | `#emu` | ★ 社区库 + 实测库**合并去重**的 3,161 款统一列表 |
| ② 模拟器指南 | `#eg` | 五层技术栈 / 芯片驱动对应 / 包装器对照 / 优化清单 / 避坑清单 |
| ③ 机型兼容 | `#dm` | 品牌 → 机型 → 可跑游戏（GPU 层级向下兼容推断）+ Turnip 看板 |

> **旧 `#pc` 深链会自动改写成 `emu`**（`bootTab()` 内），老书签不落空分区。

### 手游中心（本轮核心）

**合并卡字段**：封面 + 标题 + 别名行 + `N 套配置` pill + `M 条实测` pill + `实测帧率` pill
+ 来源徽标（社区配置 / 本站实测 / 社区+实测）+ GPU 标签。

**工具栏**：搜索框 · GPU 下拉 · 帧率档下拉（`#emuTier`）· 排序 5 档
· **「✓ 仅看匹配端游」开关（默认开）** · 刷新配置库按钮。

**排序选项**：`双料优先`（默认）/ 配置最多 / 帧率优先 / 最近上传 / 名称。

---

## 四、数据流水线

```
XDGAME 官网 ──┐
              ├─→ games.json（端游本地库 15,164 款）
机地话题   ──┘

BannerHub 仓库 ──→ bannerhub.json + bannerhub-files.json（社区库 2,597 款 / 14,003 配置）
《基础测试数据.xlsx》 ──→ phonecfg.json（实测库 1,025 款 / 1,037 条）
                                    │
                                    ▼
                        ★ build-mobilehub.js（合并去重）
                                    │
                                    ▼
                        mobilehub.json（手游中心 3,161 款）
                                    │
                    learn-mobilehub-names.js（联网补名）
                                    │
                                    ▼
                        mobilehub-names.json（别名表，回喂 build-mobilehub）
```

### 常用命令

```bash
node server.js                                  # 起服务（端口 8123）

# ★★ 改过 data/*.js 只读索引后必须重启服务
node tools/build-mobilehub.js                   # 重建手游中心合并索引
node tools/build-emulator-page.js               # 重建手机专区派生页
node tools/build-bannerhub.js                   # 重建社区配置索引
python tools/build-phonecfg.py                  # 重建实测配置索引（读 Excel）
python tools/clean-excel.py                     # 清洗 Excel → 基础测试数据-清洗版.xlsx

# 外部数据源刷新
node tools/fetch-sources.js                     # soc-db / device-board / turnip
bash tools/refresh-bannerhub.sh                 # 重新拉 BannerHub 快照
bash tools/refresh-sources.sh                   # 刷新外部源（含重启提示）

# 联网补名（见第六节，长耗时，务必后台跑）
node tools/learn-mobilehub-names.js
node tools/learn-mobilehub-names.js --limit=200  # 调试
node tools/learn-mobilehub-names.js --dry        # 不写盘
node tools/learn-mobilehub-names.js --fresh      # 忽略断点
```

### 自动化

已配置 WorkBuddy 定时任务「**GameHub 内容库每日自动同步**」——每天 **09:30** 执行 7 步：
① XD 增量 → ② BannerHub 社区配置库刷新 → ③ 实测配置库重建 → ④ 机地话题同步
→ ⑤-⑦ 汇报三套库规模（服务离线自动拉起）。

> **注意**：`build-mobilehub.js` **尚未纳入自动化**，目前需手动重跑。
> **注意**：`emuguide.js`（模拟器指南）是静态知识库，**不参与自动化**。

---

## 五、API 一览（41 个端点）

### 端游库 / 聚合

| 端点 | 说明 |
|---|---|
| `GET /api/health` | 存活检查 |
| `GET /api/feed?refresh=1` | 聚合两源最新条目（缓存 180s） |
| `GET /api/detail?url=&refresh=1` | 源站详情页实时解析（缓存 600s） |
| `GET /api/search?q=&mode=headless` | 跨站搜索 |
| `GET /api/hots` | 机地热榜（缓存 600s） |
| `GET /api/rank?p=week\|month\|year\|community` | 双热度合并榜（首页主体） |
| `GET /api/category?c=dzmx` | XDGAME 分类列表（13 类） |
| `GET /api/library/stats` | 本地库总量 / 按源统计 |
| `GET /api/library?q=&sizeMin=&sizeMax=&bh=1` | 本地库即时搜索 |
| `GET /api/library/browse?g=&sort=&sizeMin=&sizeMax=&bh=1` | 分类浏览（首页主干） |
| `GET /api/library/recent?limit=18` | 最近收录 |
| `GET /api/library/go?q=` | 取最匹配一条 |
| `GET /api/library/item?id=xd-3887` | 按 id 取单条 |
| `POST /api/library/index/incr?pages=10` | 增量更新 |
| `POST /api/library/index/calibrate` | 校准/断点续跑 |
| `POST /api/library/index/jidi` | 机地双源合并 |
| `GET /api/library/progress` | 任务进度 |
| `GET /snapshot.html` | 现场抓取快照 |

### 社区库（BannerHub）

| 端点 | 说明 |
|---|---|
| `GET /api/bh/stats` | 概览（2,597 款 / 14,003 配置） |
| `GET /api/bh/list?q=&sort=&gpu=&libOnly=1` | 列表（`libOnly=1` 降噪） |
| `GET /api/bh/match?t=` | 按标题反查 |
| `GET /api/bh/configs?k=<仓库键>` | ★ 某游戏逐条配置（机型/GPU/日期/下载直链） |
| `POST /api/bh/refresh` | 刷新配置库（spawn，热加载） |
| `GET /api/bh/refresh/state` | 刷新任务状态 |

### 实测库

| 端点 | 说明 |
|---|---|
| `GET /api/pc/stats` | 概览（1,037 条 / 1,025 款 / 可玩 543） |
| `GET /api/pc/list?q=&chip=&tier=&ok=1` | 列表（机型 + 帧率档筛选） |
| `GET /api/pc/match?t=&t2=` | 反查聚合 |
| `GET /api/pc/records?k=<游戏名>` | ★ 某游戏全部实测记录（逐条含帧率/备注/主程序） |

### ★ 手游中心（v9.3 新增）

| 端点 | 说明 |
|---|---|
| `GET /api/mobilehub/stats` | 概览：`{total,matched,unmatched,matchedRate,configs,records,playable,onlyBh,onlyPc,both,gpus,chips}` |
| `GET /api/mobilehub/list?q=&sort=both\|configs\|records\|fps\|name&gpu=&tier=&stats=all` | 合并列表。**默认 `sort=both` + 只返匹配端游库的**；`stats=all` 看全量 |
| `GET /api/mobilehub/match?t=` | 反查单款 |
| `GET /api/search/all?q=&limit=` | ★ **全站统一搜索**，双分组返回 `{pc:{count,items}, mobile:{count,items}}` |

### 指南 / 机型兼容

| 端点 | 说明 |
|---|---|
| `GET /api/emuguide` | 指南全文 |
| `GET /api/emuguide/chip?c=8gen3` | 芯片 → 推荐驱动（未知返回 `hit:false`） |
| `GET /api/device/stats` | 机型库规模（17 品牌 / 1,030 机型） |
| `GET /api/device/brands` | 品牌列表 |
| `GET /api/device/models?brand=&q=` | 机型列表 |
| `GET /api/device/match?model=` | ★ 某机型 → 可跑游戏（带 verdict） |
| `GET /api/device/chip?q=` | 芯片规格（1,444 款） |
| `GET /api/device/turnip` | Turnip 驱动构建看板 |

---

## 六、★ 联网补名任务（已完成，2026-09-10 17:20）

### 任务结果

```bash
# 最终状态
查询 1,312 款 ｜ 采纳 324 ｜ 拒绝 86 ｜ 错误 4
别名表累计 344 条
产物：data/mobilehub-names.json（完整，无 partial 标记）
```

**已完成的三步收尾**：
1. ✅ 补名任务跑完
2. ✅ `node tools/build-mobilehub.js` 已用新别名表重建索引
3. ✅ 服务已重启，新索引已生效

### 匹配率提升

| 指标 | 补名前 | 补名后 |
|---|---|---|
| 匹配端游库 | 1,513 / 3,166（47.8%） | **1,522 / 3,161（48.1%）** |
| 别名表 | 20 条 | **344 条** |

> **说明**：合并总数 3,166 → 3,161 是**正确的跨库去重**，不是数据丢失。
> 补名让 5 组原本分开的社区库/实测库条目被识别为同款并合并
> （如 `Heroes of Might and Magic V` + `5 5`、`NARUTO STORM` + `NARUTO STORM 4`）。
> 已验证这些条目**全部仍在列表中且配置数已累加**。

### 为什么慢（当时用户以为卡死）

| 乘数 | 数值 |
|---|---|
| 目标量 | 1,653 款（预过滤后 1,312） |
| 每款请求数 | 3 个接口（`storesearch` → `appdetails?l=schinese` → `?l=english`） |
| 限流 | `sleep(700)`/款 |
| **失败重试放大** | `storesearch` 对**纯英文关键词**会 `ECONNRESET`，单款 3–10 秒 → 总计 **约 30 分钟** |

**三道工程护栏**（原版「跑完才写盘」，中断就颗粒无收）：

| 护栏 | 作用 |
|---|---|
| `REQ_TIMEOUT = 8000` | 单请求 8 秒超时（`AbortSignal.timeout`） |
| `SAVE_EVERY = 25` | 每 25 款增量落盘产物 + 断点 |
| `mobilehub-names.progress.json` | 断点续跑，重跑自动跳过已处理项（`--fresh` 可忽略） |

### ★ 重要结论：匹配率天花板约 48%

抽查发现一批补名**成功**但**依然没匹配上**的条目，**不是 bug，是本地库真没收录**：

| 手游名 | 端游库实际 | 判定 |
|---|---|---|
| `Hitman Absolution` 杀手：赦免 | 库内无 | 库缺此作 |
| `Batman Arkham Asylum` | 库内只有**阿卡姆骑士** | 库缺此作 |
| `CoD Ghosts` 使命召唤：幽灵 | 库内无 | 库缺此作 |
| `Mafia II Classic` | 库内是**最终版** | 版本差异 |
| `Yakuza 0` | 人中之龙0 导演剪辑版 | ✅ 正确匹配 |

**根因**：手游库偏**老游戏/小体积/视觉小说**（这些才跑得动手机），
端游库偏**近两年 3A 新游** —— 两库定位天然错位。

> **要提升匹配率，方向是「扩端游库收录」，不是「继续调匹配算法」。**
> 已验证：护栏**没有为了凑匹配率而滥配**（不会把阿卡姆疯人院硬挂到骑士上）。

---

## 七、当前数据规模（基线）

| 指标 | 数值 |
|---|---|
| 端游本地库 | **15,164 款**（XDGAME 15,118 + 机地 46） |
| 手游中心合并 | **3,161 款** |
| ↳ 匹配端游库 | **1,522（48.1%）** |
| ↳ 未匹配 | 1,639 |
| 社区配置总套数 | **14,998** |
| 实测记录总条数 | **1,037** |
| 标记可玩 | 543 |
| 来源分布 | onlyBh 2,139 / onlyPc 934 / both 88 |
| 联网补名别名表 | **344 条** |
| 机型库 | 1,030 机型 / 17 品牌 |
| 芯片规格库 | 1,444 款 / 44 厂商 |

---

## 八、测试与质量保障（三层防线）

```bash
node tools/test-emulator-structure.js   # 静态结构体检 → 37/37 通过
node tools/test-emulator-page.js        # jsdom 行为回归 → 67/67 通过
node tools/test-alias-guard.js          # 别名护栏黑盒 → 7/7 通过
node tools/stat-match.js                # 匹配率与别名抽样
node tools/test-emuhub.js               # 已废弃，转调 test-emulator-page.js
```

| 层 | 位置 | 抓什么 |
|---|---|---|
| 1 | 生成器内 `throw` | 常量残留 / 分区 DOM 丢失 / 漏 `data-et` / CSS 泄漏 / **重复注入** |
| 2 | `test-emulator-structure.js` | 死 CSS / 废弃 id / 重复注入 / 漏 init（静态读文件正则） |
| 3 | `test-emulator-page.js` | 点得动：切换 / 深链 / 渲染 / 点击分流（jsdom 行为） |

**幂等验收**：生成器**连跑三次，md5 必须一致**。
（当前 `public/emulator.html` md5 = `0b95a70b401d804e5853de596f34dda1`）

---

## 九、★ 已知的坑（改代码前必读）

### 生成器 7 个坑（`build-emulator-page.js`，都已修，别再踩回去）

| # | 坑 | 后果 |
|---|---|---|
| 1 | `cut(lines,a,b)` **含两端行** | 追加内容落到 `<script>` 外成裸文本 |
| 2 | 非贪婪 `[\s\S]*?\n\}\)\(\);` **提前收尾** | 吞掉后面整块 |
| 3 | 拼接顺序必须 **SECTIONS → TAB** | TDZ 报 `Cannot access 'pcState'` |
| 4 | 派生页缺主源独有 DOM 依赖 | `addEventListener of null` 中断整段脚本 |
| 5 | head **从派生页自己截** → 假幂等 | 每跑一次涨一份 CSS（曾涨到 877KB / 9 个 `<style>`） |
| 6 | 派生页**新增分区**必须进生成器常量 | 重跑后被覆盖消失 |
| 7 | 替换块**改写法**后正则静默失配 | 主源常量残留 → 整页 JS 崩 |

### 坑 9（会**永久固化**错误）

**分区骨架从派生页自身截取** → `findLine` 返回 `-1` → `cut` **静默返回空串**
→ 写出的派生页丢了整个分区 → 下次又从「已丢的」页面截 → **错误被幂等地固化成正常状态**。

修法：骨架**硬编码成生成器常量**（`SECTIONS`），永不丢失。
**判据**：凡是生成器要重写的文件，其中内容**不能反过来当下一次生成的输入源**。

### 坑 10（「点了没反应」的真相）

```css
main[data-et].et-hide{display:none}   /* ← 属性选择器，必须有 data-et 才匹配 */
```

切换逻辑老老实实加了 `et-hide`，但**选择器匹配不上 → 完全没生效**。
迷惑点：`classList.contains('et-hide')` 返回 **true**，只断言 class 的测试**全绿**，
但浏览器里什么都没发生。**必须断言真实可见性/几何。**

### 坑 11（本轮新踩）

**幂等哨兵锚在「会被删掉的函数名」上** → 重建后**重复注入整份 SECTIONS_JS**
→ `Identifier 'EMU_PAGE_SIZE' has already been declared` **整页崩**。

修法：`const SEC_SENTINEL = /function initEmu\s*\(/;`（锚在长期存在的符号上）。

> **教训**：幂等哨兵**永远锚在「长期存在的符号」上**，绝不锚在「本次重构可能删掉」的函数名上。

### 其他注意事项

- **改过 `data/*.js` 只读索引后必须重启服务**（启动时加载）。
- `bannerhub.js` 的 96.9% 命中率很稳，**不要动**（CJK 匹配另写了 `phonecfg.js` 的 `libKeys`）。
- **测试桩两个坑**：① `beforeParse` 阶段 `w.fetch` 尚未定义；② 解构出 fetch 再调用丢 `this`。
- **Edge CDP 直连可用**（`--remote-debugging-port` + WebSocket），
  puppeteer 路径不可用；几何量测是排查「切换没反应」最快的手段。

---

## 十、可交给其他智能体的优化方向

### P0 —— 数据层（收益最大）

1. **扩端游库收录**（唯一能突破 48% 匹配率天花板的路径）
   - XDGAME 全量增量：`POST /api/library/index/incr` / `calibrate`
   - 机地扩容：逆向 App 私有 API（**有风险**，需评估）
2. **把 `build-mobilehub.js` 纳入每日 09:30 自动化**
   - 位置：现有 7 步流程后追加第 8 步

### P1 —— 前端体验

3. **手游中心加「只看双料」开关**（目前只能在排序里体现，没有独立筛选）
4. **手游中心加「按帧率档筛选」**（`#emuTier` 已有下拉，可做成多选）
5. **合并卡加「设备指纹」提示**（如「此配置需 Turnip 驱动」），与指南联动
6. **详情页补齐首图/封面**（部分条目 `libCover` 为空）
7. **手游中心卡片点击分流优化**（当前：有 `libId` → 详情；有 `bhKeys` → 社区配置面板）

### P2 —— 架构与内容

8. **`DESIGN.md` 同步到 v9.3**（目前落后，描述的还是 4 分区）
9. **README 图表化**：加一张信息架构图 / 数据流水线图
10. **`emulator-sections.js` 拆分**（三分区的驱动脚本在一个文件里，已超 1,000 行）

### P3 —— 质量

11. **补 `mobilehub` 相关测试**（当前 67 项断言里手游中心覆盖较浅）
12. **补 `build-mobilehub.js` 单测**（数字一致性护栏 `numConflict` 值得单独覆盖）

---

## 十一、快速上手 checklist（接手第一件事）

```bash
# 1. 进目录
cd "E:/新建文件夹/WorkBuddy/2026-09-03-16-11-58/game-aggregator"

# 2. 确认服务在跑（没有则起）
curl -s http://127.0.0.1:8123/api/health || node server.js &

# 3. 跑三层测试确认基线是绿的
node tools/test-emulator-structure.js   # 期望 37/37
node tools/test-emulator-page.js        # 期望 67/67

# 4. 确认生成器幂等（改东西之前先确认基线）
md5sum public/emulator.html
node tools/build-emulator-page.js
md5sum public/emulator.html             # 期望与上面一致

# 5. 看补名任务是否还在跑
node -e "const p=require('./data/mobilehub-names.progress.json');console.log(p.done.length,'/1653')"
```

**改代码的铁律**：
1. 改共享资产 → **只改 `index.html`** → 重跑生成器
2. 改完 → **跑三层测试** + **确认生成器幂等**
3. 改 `data/*.js` → **重启服务**
4. **任何破坏性操作前先备份**（本项目无 git 兜底）

---

## 十二、相关文档

| 文件 | 说明 |
|---|---|
| `CODEX-HANDOFF.md` | ★★ **2026-09-14 盘点**：项目全貌 / 位置固定表 / 文件功能字典 / 技术栈 / 端口约定 / 文档滞后清单 / 优化建议（交给 Codex 用的主文档） |
| `CODEX-TASKS.md` | ★★ **可直接复制粘贴的 Codex 任务 prompt 集**（P0-P3 共 11 条，每条含背景/约束/验收） |
| `CODEX-INDEX.md` | ★★ **交付物清单 + Codex 派发索引**（含首轮引导句、11 条派发句、推荐派发顺序） |
| `README.md` | ★ 5.2 万字完整技术文档（v9.3，**部分数字滞后，见 CODEX-HANDOFF.md 第 9 节**） |
| `DESIGN.md` | 页面设计规范（**内容落后，待同步**） |
| `.workbuddy/artifacts/2026-09-10-GameHub-优化轮19-手游中心合并与全站统一搜索.md` | 本轮交付说明 |
| `.workbuddy/memory/2026-09-10.md` | 当日完整工作日志（含轮 9-19 全部踩坑记录） |

**沉淀的 skill**：
- `~/.workbuddy/skills/single-source-dual-page/` —— 单源双页架构 + 11 个坑
- `~/.workbuddy/skills/cross-source-name-matching/` —— 跨源名称匹配 + 联网补名 + 多库合并
- `~/.workbuddy/skills/gpu-tier-cross-vendor/` —— 跨厂商 GPU 性能层级表