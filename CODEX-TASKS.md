> ## ★ v10.1 增量（2026-09-14）—— 先看这段
> 本轮已由我完成 **P0-3 / P0-2 / P1-1 / P1-6** 四项，标题已标 `✅ [v10.1 已完成]`，**请勿重做**。
> 变更说明（改了什么 / 验收数据 / 踩过的坑）见 **`CODEX-DONE-v10.1.md`**。
> 要派活请从剩余项挑：**P0-1 · P1-4 · P2-1 · P2-2 · P2-5 · P3-1 · P3-4**。

# GameHub · Codex 任务包（可直接复制粘贴）

> 配套文档：`CODEX-HANDOFF.md`（项目全貌 / 位置固定 / 文件字典 / 已知的坑）
> 用法：**每条任务独立复制**，粘贴到 Codex 桌面端执行。任务之间无依赖，可按需挑。
> 通用约定已内联进每条 prompt，Codex 无需读本文即可独立执行。

---

## 通用上下文（每条 prompt 已内含，此处仅备查）

```
项目根：E:\新建文件夹\WorkBuddy\2026-09-03-16-11-58\game-aggregator
端口：8123（server.js:961，勿改）
前端主源：public/index.html（唯一编辑入口）
派生页：public/emulator.html（由 tools/build-emulator-page.js 生成，勿手改）
启动器：启动聚合站.bat
测试：node tools/test-emulator-structure.js（期望 45/45）
      node tools/test-emulator-page.js（期望 96/96，需服务在 8123）
铁律：改 data/*.js 后必须重启服务；改共享资产只改 index.html 后重跑生成器；
      任何破坏性操作前先备份（本项目无 git）。
```

---

## P0-1 · 扩端游库收录

```
你是 GameHub 游讯聚合站（Node.js + Express，端口 8123）的维护者。

项目根：E:\新建文件夹\WorkBuddy\2026-09-03-16-11-58\game-aggregator
启动：node server.js（服务可能已在跑，先 curl http://127.0.0.1:8123/api/health 确认）

【背景】
当前端游本地库 15,268 款（XDGAME 15,210 + 机地 58），手游中心 3,161 款里只有 48.1% 能匹配上端游库。
已确认这不是匹配算法问题，而是「端游库收录不足」——手游库偏老游戏/小体积/视觉小说，
端游库偏近两年 3A 新游，两库定位天然错位。要提升匹配率，唯一路径是扩端游库。

【任务】
1. 先跑 curl http://127.0.0.1:8123/api/library/index/state 看当前索引断点（nextPage / maxKnown）。
2. 调用 POST http://127.0.0.1:8123/api/library/index/calibrate 做校准/断点续跑，
   把 XDGAME 全量列表补齐到最新页。注意这是长任务（约 430 页），
   中途可用 GET /api/library/progress 看进度，中断了重跑 calibrate 会自动从断点续。
3. 跑完后再调 POST http://127.0.0.1:8123/api/library/index/jidi 同步机地话题。
4. 汇报前后对比：/api/library/stats 的 total / bySource，以及 /api/mobilehub/stats 的 matchedRate。

【约束】
- 不要碰 fetchers/indexer.js 的解析逻辑（已验证可用），只跑接口。
- 服务端 data/index-state.json 是断点文件，不要手动改。
- 如果 XD 源站结构变了导致解析失败，先停下来报告，不要瞎改解析器。

【验收】
/api/library/stats 的 total 明显增长；/api/mobilehub/stats 的 matched 与 matchedRate 上升。
输出一份前后对比表。
```

---

## ✅ [v10.1 已完成] P0-2 · 把三个数据脚本纳入每日自动化

```
你是 GameHub 项目（E:\新建文件夹\WorkBuddy\2026-09-03-16-11-58\game-aggregator）的维护者。

【背景】
本项目已有一个 WorkBuddy 定时任务「GameHub 内容库每日自动同步」，每天 09:30 跑 7 步：
① XD 增量（POST /api/library/index/incr?pages=10）
② BannerHub 社区配置库刷新（POST /api/bh/refresh + 轮询 /api/bh/refresh/state）
③ 实测配置库重建（python tools/build-phonecfg.py）
④ 机地话题同步（POST /api/library/index/jidi）
⑤-⑦ 汇报三套库规模（服务离线自动拉起）

但 v10 新增/遗留的三个脚本没纳入，导致数据会过期：
- node tools/build-mobilehub.js   （手游中心合并索引，未纳入）
- node tools/fetch-trainers.js    （修改器数据，未纳入）
- node tools/build-saves.js       （云存档数据，未纳入，会流式解析 17MB YAML，约 30-60s）

【任务】
把上述 3 步加到现有自动化流程里（作为第 5/6/7 步，规模汇报顺延到最后）。
用 automation_update 工具修改已有任务，**不要新建一个重复任务**。
注意：build-saves.js 依赖 .cache/ludusavi-manifest.yaml，如果文件不存在需要先下载
（源：https://github.com/mtkennerly/ludusavi-manifest ，MIT 许可，约 17MB）。
第 ④ 步之后必须是「重启服务」再跑 ⑤⑥⑦，因为三个产物都是 data/*.js 只读索引，
不重启不会生效 —— 但注意 build-saves/build-mobilehub 产出的是 .json，由对应 .js 读，
所以确实需要重启。请在流程里显式加入重启步骤。

【验收】
updated 后的自动化 prompt 里能看到完整的 10 步流程；
连续运行两次都在非失败状态下完成；最终汇报里能看到 trainers / saves / mobilehub 三套规模。
```

---

## ✅ [v10.1 已完成] P0-3 · 统一端口真源，删除死常量

```
你是 GameHub 项目（E:\新建文件夹\WorkBuddy\2026-09-03-16-11-58\game-aggregator）的维护者。

【问题】
server.js 里端口有两处写法，互相矛盾：
- 第 14 行：const PORT = process.env.PORT || 3456;   ← 这个常量声明后【全程未被使用】，是死代码
- 第 961 行：listen(parseInt(process.env.PORT, 10) || 8123, 30);  ← 真正生效

接手者读到第 14 行会以为端口是 3456，排查半天。实际端口固定是 8123。

【任务】
1. 全项目搜索确认 3456 只出现在这一处（记得排除 node_modules / package-lock.json / *.json 数据文件）。
2. 把第 14 行改为单一真源：const PORT = parseInt(process.env.PORT, 10) || 8123;
   并让第 961 行复用这个常量：listen(PORT, 30);
3. 顺便检查 server.js 里是否还有其他「声明了但没用到」的死常量，一并清理并列出。

【约束】
- 不要改端口默认值（必须仍是 8123）。
- 改完必须重启服务验证：curl http://127.0.0.1:8123/api/health 返回 ok。
- 改完跑 node tools/test-emulator-structure.js（期望 45/45）。

【验收】
grep 3456 在项目源码中零命中；服务在 8123 正常起；结构测试 45/45。
输出改动清单。
```

---

## ✅ [v10.1 已完成] P1-1 · 手游中心加「只看双料」独立开关

```
你是 GameHub 项目（E:\新建文件夹\WorkBuddy\2026-09-03-16-11-58\game-aggregator）的前端维护者。

【背景】
手机专区（public/emulator.html 的 #emu 页签「手游中心」）现在有工具栏：
搜索框 · GPU 下拉 · 帧率档下拉(#emuTier) · 排序 5 档 · 「✓ 仅看匹配端游」开关(默认开) · 刷新按钮。

数据里每条有 sources 字段，取值含 bh（社区配置库）/ pc（实测库），
两个都有的是「双料」。目前「双料优先」只在排序里体现（sort=both），
没有独立的筛选开关，用户没法「只看双料」。

【架构约束 —— 非常重要】
本项目是「单源双页」：public/index.html 是【唯一编辑入口】，
public/emulator.html 由 node tools/build-emulator-page.js 【派生】。
- 共享资产（CSS / 顶栏 / 抽屉 / 通用脚本）只改 index.html
- 手机专区专属内容（#emu 分区的 HTML 骨架 + 驱动脚本）在生成器里：
  - 骨架常量：tools/build-emulator-page.js 里的 SECTIONS
  - 驱动脚本：tools/emulator-sections.js（会被生成器内联吃进派生页）
- 改完必须跑：node tools/build-emulator-page.js

【任务】
在 #emu 工具栏加一个「只看双料」开关（checkbox），行为：
- 勾选后只显示 sources 同时含 bh 和 pc 的条目
- 与现有「仅看匹配端游」开关是 AND 关系
- 状态变化要立刻重新拉列表（不刷新页面）
- 用 localStorage 记住用户选择

【实现路径】
1. 后端：检查 GET /api/mobilehub/list 是否已支持按 sources 过滤。
   若不支持，在 server.js 该路由加一个参数（建议 stats=both 或 only=both），
   在 data/mobilehub.js 里实现过滤。
2. 前端：在 tools/emulator-sections.js 的 initEmu 里加开关 DOM 事件绑定 + 查询参数拼接。
3. 骨架：在 tools/build-emulator-page.js 的 SECTIONS 常量里加开关的 HTML。
4. 重跑生成器。

【验收 —— 必须全绿】
- node tools/test-emulator-structure.js  → 45/45（若新增断言，数字可上涨，但不能 FAIL）
- node tools/test-emulator-page.js       → 96/96（同上）
- node tools/build-emulator-page.js 连跑三次，md5sum public/emulator.html 必须一致
- 手工验证：勾选后列表条目数减少，且每条都能在 /api/mobilehub/list?...stats=all 里查到同时含 bh 和 pc
```

---

## P1-4 · 详情页补齐首图/封面

```
你是 GameHub 项目（E:\新建文件夹\WorkBuddy\2026-09-03-16-11-58\game-aggregator）的维护者。

【背景】
首页和手机专区的部分卡片 libCover 为空，导致封面破图或只剩首字占位块。
卡片数据来自 /api/mobilehub/list（手游中心）、/api/bh/list（社区库）、/api/pc/list（实测库），
这些接口的条目会平铺 libId / libTitle / libUrl / libCover（来自 data/games.json）。

【任务】
1. 先量化问题：写个一次性统计脚本（放 tools/ 下，命名如 stat-cover.js），
   统计三套库里 libCover 为空的比例，并抽样列出 20 个空封面条目的 libId。
2. 分析空封面条目的成因，分类：
   - a) 该游戏根本没匹配上端游库（libId 为空）→ 属于匹配问题，不是封面问题
   - b) 匹配上了但 games.json 里那条本身没封面 → 需要补封面源
   - c) 前端渲染逻辑问题 → 检查 index.html 的卡片渲染函数
3. 针对 b) 类，调研可行的封面补全源（如 Steam 官方 CDN
   https://shared.cdn.queniuqe.com/store_item_assets/steam/apps/{appid}/header.jpg），
   给出方案与预估覆盖率，先不要大批量刷。
4. 针对 c) 类，直接修。

【约束】
- 不要为了「看起来有封面」而给不匹配的游戏硬挂封面（会误导用户）。
- 首字渐变占位块（无封面时的降级）是设计要求，保留。
- 任何批量写 data/games.json 的操作前，先备份该文件。

【验收】
输出一份统计报告（空封面比例 / 成因分类 / 抽样清单 / 建议方案）；
若修了渲染逻辑，跑三层测试全绿 + 生成器幂等。
```

---

## ✅ [v10.1 已完成] P1-6 · 修改器 / 云存档与端游详情抽屉打通

```
你是 GameHub 项目（E:\新建文件夹\WorkBuddy\2026-09-03-16-11-58\game-aggregator）的前端维护者。

【背景】
v10 新增了两个页签：修改器（#tr）与云存档（#sv），数据来自
GET /api/trainers/match?t=<游戏名>  （返回 items[]，每条含 name/zh/version/source/libId）
GET /api/saves/match?t=<游戏名>     （返回 hit{...paths[]}，含存档落地路径）

但目前这两块数据【只在自己页签里能看】，端游详情抽屉（打开某个游戏详情时）
并没有显示「这个游戏有没有修改器 / 存档在哪」。用户要查还得手动切页签重搜。

【任务】
在端游详情抽屉里加两个区块：
1. 「修改器」区块：调 /api/trainers/match?t=<当前游戏标题>，有命中就列出
   版本号 + 来源徽标（fling 风灵月影 / cheat_table CE表 / community 社区 / xiaoxing 小幸 / gcm）+ 获取方式外链；
   无命中就显示「暂无收录」。
2. 「云存档」区块：调 /api/saves/match?t=<当前游戏标题>，有命中就列出存档落地路径
   （paths[].shown，已人性化，不要截断）+ 云同步徽标（cloud 字段，如 steam）+ 占位符注释说明；
   无命中就显示「暂无收录」。

【架构约束 —— 非常重要】
本项目是「单源双页」，public/index.html 是【唯一编辑入口】，
public/emulator.html 由 node tools/build-emulator-page.js 【派生】。
详情抽屉是共享资产，所以【只改 index.html】里的抽屉结构 + 渲染逻辑，然后重跑生成器。

【注意】
- 两个接口都有【子串检索兜底】：精确名不中时会退化为子串检索，所以传全名即可。
- 当前游戏标题可能是「中文/English/别名」斜杠拼接串（如 艾尔登法环/ELDEN RING），
  直接整体传参即可，接口内部已处理。
- 请求要懒加载（抽屉打开时才请求），不要进首包。

【验收】
- node tools/test-emulator-structure.js → 45/45
- node tools/test-emulator-page.js      → 96/96（新增断言可上涨）
- 生成器连跑三次 md5 一致
- 手工验证：打开《只狼》详情 → 云存档区块显示
  C:\Users\<用户名>\AppData\Roaming\Sekiro\<平台账号ID>\S0000.sl2
  打开《艾尔登法环》详情 → 修改器区块显示 4 个来源
```

---

## P2-1 · 同步三份滞后文档

```
你是 GameHub 项目（E:\新建文件夹\WorkBuddy\2026-09-03-16-11-58\game-aggregator）的文档维护者。

【背景】
项目已迭代到 v10（手机专区 5 页签：手游中心 / 修改器 / 云存档 / 模拟器指南 / 机型兼容），
但三份文档存在与实际不符的描述，会误导接手者。

【任务 —— 逐项修正以下滞后点】

README.md：
- test-emulator-page.js 注释「67 项断言」→ 96 项
- test-emulator-structure.js 注释「37 项」→ 45 项
- emulator.html 描述「3 个平级页签」→ 5 个（列出 5 个页签名与 hash：emu/tr/sv/eg/dm）
- 章节标题「v9.1：首页 / 手机专区 两段式」→ 更新到 v10
- /api/search/all 描述「双分组」→ 4 分组（pc / mobile / trainer / save）
- emulator-sections.js 描述「四个分区」→ 5 个（initEmu/initTr/initSv/initEg/initDm）
- API 表补充 v10 新增端点：
  /api/tools/stats、/api/trainers/{stats,list,match}、/api/saves/{stats,list,match}

HANDOFF.md：
- 第三节「3 分区 / 3 页签」→ 5 分区 / 5 页签，表格补 tr / sv 两行
- 第八节 结构 37/37 → 45/45、行为 67/67 → 96/96
- 第八节 md5 0b95a70b… → 09916f1fcb071ff59f5a83ef1a0d0420
- 第十一节 checklist 期望值 37/67 → 45/96
- 第二节目录树：server.js 39KB→44KB、41 路由→约 60 路由；
  index.html 126KB→137KB；emulator.html 171KB→203KB
- 第七节数据规模更新为最新（先 curl 拿实况）：
  /api/library/stats → 端游库 total
  /api/mobilehub/stats → 手游中心 total / matched / matchedRate
  /api/bh/stats → 社区库 games / configs
  /api/tools/stats → 修改器 total / saves total
- 补充 v10 的两个数据源脚本说明（fetch-trainers.js / build-saves.js）
- 第十节「可交给其他智能体的优化方向」更新为最新优先级

DESIGN.md：
- 补 v10 组件规范：修改器卡片（来源徽标按 source 配色 fling/cheat_table/community/xiaoxing/gcm）、
  云存档卡片（.paths .p 路径展示不截断、.tg.cloud 云同步徽标、.tg.phone 手机可玩徽标）、
  切换条（5 页签，≤760px 收起数字胶囊）
- 更新页面结构描述为「5 页签」

【约束】
- 只改文档，不要动任何代码或数据。
- 数字必须先用 curl 从运行中的服务实时取，不要照抄本文档里的旧数字。
- 保持各文档原有排版风格与中文行文习惯。

【验收】
三份文档中不再出现 37/67/3页签/双分组/四个分区/0b95a70b 等滞后表述；
所有数字与 curl 实况一致。输出一份「改了哪些行」的清单。
```

---

## P2-2 · 拆分 emulator-sections.js

```
你是 GameHub 项目（E:\新建文件夹\WorkBuddy\2026-09-03-16-11-58\game-aggregator）的重构者。

【背景】
tools/emulator-sections.js 已经 937 行 / 44 KB，里面塞了手机专区 5 个分区的全部驱动：
- initEmu（手游中心）+ emuCard + bindEmuCards + loadEmu
- initTr（修改器）+ trCard + bindTrCards + loadTr
- initSv（云存档）+ svCard + bindSvCards + loadSv
- initEg（模拟器指南）
- initDm（机型兼容）+ dmFmtScore + dmCard + dmRender + dmQuery + dmLoadTurnip
- 共用：panelShell + openBhPanel + openPcPanel（配置面板）

【★ 关键架构约束 —— 不满足就会炸】
这个文件不是「被 require 的模块」，而是被生成器【当字符串读进来内联】到派生页里的：
  tools/build-emulator-page.js  L108-109:
    const SECTIONS_JS_PATH = path.join(__dirname, 'emulator-sections.js');
    const SECTIONS_JS = fs.readFileSync(SECTIONS_JS_PATH, 'utf8');
然后整段塞进派生页的 <script>。所以：
- 【不能】改成多个文件用 import/require 互相引用（浏览器里没有 require）
- 【不能】加 export / module.exports
- 拆分后必须是「按顺序拼接成一段完整脚本」，且拼接顺序不能破坏函数声明与 TDZ

【任务】
把它拆成多个源文件（建议 tools/emu-sections/ 目录下，按分区拆），
再由 build-emulator-page.js 按固定顺序拼接（类似 SECTIONS → TAB 的顺序约束，
见 HANDOFF.md 第九节的坑 3：顺序错会报 Cannot access 'pcState'）。
注意也要处理 emulator-sections.js 里对 EMU_PAGE_SIZE 等常量的声明顺序。

【必须保住的验收 —— 一条都不能少】
1. node tools/build-emulator-page.js 连跑三次，md5sum public/emulator.html 完全一致
   （当前基线 09916f1fcb071ff59f5a83ef1a0d0420）
2. node tools/test-emulator-structure.js → 45/45
3. node tools/test-emulator-page.js      → 96/96
4. 拆分前后 public/emulator.html 的 md5 应保持一致（纯重构，不改行为）
5. 幂等哨兵仍是 const SEC_SENTINEL = /function initEmu\s*\(/;（锚在长期存在的符号上）

【建议做法】
- 先备份 public/emulator.html 与 tools/emulator-sections.js
- 拆完先只验证「拼接结果字符串与原文件逐字节相同」，再跑真生成器
- 任何一步 md5 变了就停下来定位，不要继续

【验收】
生成器三连 md5 一致且等于基线；三层测试全绿；emulator-sections.js 主文件显著变小。
输出拆分后的文件清单与各自行数。
```

---

## P3-1 · 补修改器 / 云存档 / 手游中心 测试

```
你是 GameHub 项目（E:\新建文件夹\WorkBuddy\2026-09-03-16-11-58\game-aggregator）的测试维护者。

【背景】
三层防线现状：
- tools/test-emulator-structure.js  静态结构体检  45 项断言
- tools/test-emulator-page.js       jsdom 行为回归 96 项断言（需服务在 8123）
- tools/test-alias-guard.js         别名护栏 7 项

v10 新增了两个页签（修改器 #tr / 云存档 #sv），手游中心（#emu）的覆盖也较浅。
目前这两个新分区基本没有专属断言。

【任务】
1. 在 test-emulator-structure.js 里补：
   - #trainers / #saves 两个 <main data-et="tr|sv"> 存在且唯一
   - 切换条里 tr / sv 两个页签按钮存在且顺序正确（emu, tr, sv, eg, dm）
   - ET_MAP 里 5 个映射齐全
   - 专属 CSS（.emu-grid.tr / .emu-grid.sv / .tg.src.* / .pill.ver / .paths .p / .tg.cloud / .tg.phone）在 <style> 内、未泄漏到外面
   - 未重复注入 SECTIONS（initTr / initSv 各只定义一次）

2. 在 test-emulator-page.js 里补：
   - 点击「修改器」页签 → 只有 #trainers 可见（必须断言真实可见性/几何，不能只断言 classList —— 见坑 10）
   - 点击「云存档」页签 → 只有 #saves 可见
   - 深链 #tr / #sv 直接打开对应分区
   - 修改器卡片渲染出 source 徽标与版本号
   - 云存档卡片渲染出存档路径（断言路径正则 [A-Z]:\ 开头，注意转义）
   - 「仅看匹配端游」开关与列表联动

【约束】
- 断言必须测「真实可见性」（getComputedStyle / offsetParent 等），不能只测 class 名 —— 历史上有过 class 对但浏览器无反应的坑。
- 测试桩两个老坑：① beforeParse 阶段 w.fetch 尚未定义；② 解构出 fetch 再调用会丢 this。
- 只加测试，不要为了「让测试通过」而改业务代码。

【验收】
两个测试文件断言数上升且全绿；故意改坏 #sv 的 data-et 属性后测试必须 FAIL（验证断言有效性）。
输出新增断言清单 + 断言有效性反证结果。
```

---

## P3-4 · 清理非运行依赖的临时文件

```
你是 GameHub 项目（E:\新建文件夹\WorkBuddy\2026-09-03-16-11-58\game-aggregator）的维护者。

【背景】
项目里有一些非运行依赖的临时/中间文件，影响目录整洁：
- _preview-cards.html（70KB）+ _preview-cards.js（3.9KB）：轮 19 的合并卡单页预览，已交付过，非运行依赖
- data/_gcm-raw.json（808KB）：修改器数据源接口的原始落盘，是 fetch-trainers.js 的中间产物，
  删了不影响运行（重跑脚本会重新生成）

【任务】
1. 先【只列出】上面的文件，以及你自己再扫一遍找到的其他「非运行依赖的临时文件」
   （排除 node_modules / .cache / _archived / *.bak-* / 数据产物 *.json）。
2. 对每个文件，明确说明：它是什么、是否被任何代码 require/readFile 引用、
   删掉会不会影响运行、删掉能否重新生成。
3. 把「确认可删」的清单给我确认，**等我确认后再执行删除**。
   删除时优先用系统回收站机制，不要直接永久删除。

【约束 —— 严格遵循】
- 这是项目目录操作，不是个人目录，但仍要谨慎：
  ① 先扫描出报告，不要边扫边删；
  ② 删除前必须逐个列出完整路径 + 理由；
  ③ 一次最多处理 10 个，删完立即复核；
  ④ 不要动 _archived/（那是刻意保留的备份）、不要动 .cache/（云存档源）、
     不要动 public/*.bak-v92（版本备份）、不要动任何 data/*.json 数据产物。
- 先做一次全量备份：cp -r public "public.bak-$(date +%Y%m%d-%H%M)"。

【验收】
输出扫描报告 + 引用关系核查结果 + 待删清单（等确认）。
```

---

## P2-5 · 引入 git 版本控制

```
你是 GameHub 项目（E:\新建文件夹\WorkBuddy\2026-09-03-16-11-58\game-aggregator）的维护者。

【背景】
本项目目前【没有 git】，任何改动都没有兜底，全靠手动备份。
项目结构：Node.js + Express 后端 + 零构建原生前端（public/index.html 主源 + 派生页 emulator.html）。
数据产物很大（data/games.json 5.8MB、saves.json 5.2MB、bannerhub-files.json 1.8MB）。
外部源码缓存在 .cache/ludusavi-manifest.yaml（17MB）。
node_modules 138 个包。

【任务】
1. 设计一份合适的 .gitignore，至少排除：
   node_modules/、.cache/、data/*.json 中的大数据产物（按需决定哪些入库）、
   public/*.bak-*、_preview-cards.*、data/_gcm-raw.json、*.log
   —— 请说明每个排除决策的理由，尤其是「数据产物要不要入库」这个取舍。
2. git init，做一次初始提交。
3. 检查是否有敏感信息（如 API key / token / 绝对路径中的用户名），
   有的话先处理再提交，不要直接提交进去。

【约束】
- 不要删除任何现有文件。
- 不要 force push 到任何远端（本项目目前无远端）。
- 提交信息用中文，格式清晰。
- data/*.json 是「可重新生成」的产物还是「不可再生」的数据，请你判断后给出建议，
  但【最终是否入库由我决定】—— 先给方案，等我确认再执行 git add。

【验收】
输出 .gitignore 方案（含排除理由 + 数据产物入库取舍建议）+ 敏感信息扫描结果。
等确认后再执行初始提交。
```

---

## 附：一句话任务索引

| 编号 | 标题 | 类型 | 优先级 |
|---|---|---|---|
| P0-1 | 扩端游库收录（突破 48% 匹配率） | 数据 | ★★★ |
| P0-2 | 三个数据脚本纳入每日自动化 | 运维 | ★★★ |
| P0-3 | 统一端口真源，删死常量 | 代码 | ★★★ |
| P1-1 | 手游中心「只看双料」开关 | 前端 | ★★ |
| P1-4 | 详情页补齐封面 | 前端/数据 | ★★ |
| P1-6 | 修改器/云存档接入详情抽屉 | 前端 | ★★ |
| P2-1 | 同步三份滞后文档 | 文档 | ★ |
| P2-2 | 拆分 emulator-sections.js | 重构 | ★ |
| P2-5 | 引入 git | 工程 | ★ |
| P3-1 | 补 v10 分区测试 | 测试 | ☆ |
| P3-4 | 清理临时文件 | 整洁 | ☆ |
