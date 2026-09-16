# DESIGN.md — GameHub 游讯聚合（机地 × XDGAME）

聚合站设计规范。来源站：jidiyouxi.com（机地，社区/榜单/新游）、xdgamer.com（XDGAME，每日更新流）。产品定位：**单机游戏信息聚合台——只做「详情页 + 更新情报」，不含任何下载资源**。
> **数值权威性**：本文件第 2/4/5/6 节的取色与尺寸写下时较早，**以 `public/index.html` 的 `:root` 变量与实现为准**
> （当前主色 `--c-primary:#2E6BFF`，非旧稿的 `#5B5BD6`）。第 4 节「筛选条 .filter-bar」是 **v10.3 实装规范**，与代码逐值对齐。

---

## 1. Visual Theme & Atmosphere（视觉主题与氛围）

- **设计哲学**：情报台 / 操作台感 —— 干净的浅色阅读面 + 一处深色 "仪表盘" 头，暗示"实时数据中枢"。
- **关键词**：`实时情报` `克制的电竞感` `卡片化` `高信息密度` `来源可辨`
- **光影质感**：浅底微阴影卡片；唯一深色面是顶部 hero（深蓝紫渐变 + 网点纹理 + 霓虹描边）；无毛玻璃泛滥，仅在 sticky header 用 `backdrop-filter: saturate(1.6) blur(14px)`。

## 2. Color Palette & Roles（调色板与角色）

| 角色 | HEX | CSS 变量 | 用途 |
|---|---|---|---|
| Primary / 情报紫 | `#5B5BD6` | `--c-primary` | 主按钮、链接、焦点环 |
| Primary Deep | `#4A3FA0` | `--c-primary-deep` | 渐变端点、hover |
| Hero Dark | `#141228` | `--c-hero` | hero 背景起点 |
| Hero Dark 2 | `#241D4E` | `--c-hero2` | hero 背景终点 |
| Accent Jidi | `#E6415D` | `--c-jidi` | 机地来源角标、机地数据强调 |
| Accent XD | `#0B7BFF` | `--c-xd` | XDGAME 来源角标、更新强调 |
| Score Gold | `#F59E0B` | `--c-score` | 高分 9.0+ |
| Bg | `#F5F6FA` | `--c-bg` | 页面底色 |
| Surface | `#FFFFFF` | `--c-surface` | 卡片 / 抽屉 / 表头 |
| Border | `#E5E8F0` | `--c-border` | 描边、分隔线 |
| Text 1 | `#13161F` | `--c-t1` | 标题 |
| Text 2 | `#5A6474` | `--c-t2` | 正文次要 |
| Text 3 | `#98A1B3` | `--c-t3` | 元信息 / 占位 |
| Success | `#16A34A` | `--c-ok` | 源站在线、刷新成功 |
| Warning | `#D97706` | `--c-warn` | 后端未连接 / 演示态 |
| Danger | `#DC2626` | `--c-danger` | 源站离线、错误 |
| Shadow 色 | `rgba(20,18,50,.08)` | `--shadow-color` | 全局阴影统一色相 |

## 3. Typography Rules（排版规则）

- **Font Family**：`-apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", Roboto, sans-serif`；数字/评分用 `"DIN Alternate", ui-monospace, monospace`（呼应机地原站的 DIN 序号风格）。
- **Type Scale**：

| 级别 | size/weight/lh | 场景 |
|---|---|---|
| Display（仅 hero） | 30px / 800 / 1.25 | 品牌区主标题 |
| H1（区块标题） | 20px / 750 / 1.4 | 板块标题 |
| H2（卡标题） | 15–16px / 650 / 1.5 | 卡片游戏名 |
| Body | 13px / 450 / 1.6 | 描述 / 详情正文 |
| Meta | 12px / 450 / 1.5 | 时间、类型、来源说明 |
| Nano | 11px / 500 / 1.4 | 角标、标签、按钮小字 |
| Score | 15–24px / 800 / 1 | 评分数字（DIN） |

## 4. Component Stylings（组件样式）

- **按钮 .btn**：radius `10px`；padding `9px 14px`；字号 13/600。
  - Primary：bg `--c-primary`、hover `#6E6AE8`、active translateY(1px)。
  - Ghost：透明、border `1px solid var(--c-border)`、hover border 加深 + bg `#F2F3F9`。
  - 主 CTA 大按钮（详情抽屉外链）radius `12px` padding `11px 18px`。
- **卡片 .card**：surface、`1px solid var(--c-border)`、radius `14px`；常态 `0 1px 2px var(--shadow-color)`；hover `translateY(-2px) + 0 10px 24px rgba(20,18,50,.10)`、border 转 `#C9CDE0`。
- **来源角标 .src-badge**：`inline-flex`、radius `6px`、padding `2px 7px`、Nano 字号 600；jidi=红、xd=蓝，白字；背景同色 12% 透明度 + 同色文字（浅色主题可读）。
- **评分徽章 .score-pill**：score>=9 → gold 底金字；≥8 → primary 底；否则中性灰；radius `8px` padding `2px 8px` DIN。
- **输入/搜索框**：h `36px` radius `10px` border `--c-border`；focus border primary + `0 0 0 3px rgba(91,91,214,.15)`。
- **Tag**：radius `999px` padding `2px 10px` bg `#EFF1F8` color `--c-t2`。
- **时间轴行卡**：左侧时间刻度（相对时间如 "刚刚 / 2小时前"），hover 高亮左侧 accent 条。
- **筛选条 .filter-bar（v10.3 实装规范）**：**面板**容器 —— bg `--c-surface`、`1px solid var(--c-border)`、radius `14px`、
  padding `11px 14px`、行距 `9px`、`margin-bottom:16px`（与 `.cat-panel` 同规格，使「分类 / 排序 / 容量」三行读作一个操作台）。
  - **行 .filter-row**：`display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-height:31px`。
  - **行首标签 .filter-lb**：`12px/700`、色 `--c-t3`、`letter-spacing:.5px`、`min-width:24px`（与分类行的「分类」同规格）。
  - **分段控件 .sort-pills / .size-pills**：`inline-flex;gap:3px`、bg `#F0F3F9`、radius `11px`、padding `3px`。**与顶栏 `.main-nav` 同一视觉语言。**
  - **选项 .sort-pill / .size-pill**：`12px/650`、色 `--c-t2`、radius `8px`、padding `5px 12px`；hover 转 `--c-primary`。
  - **选中态 `.on`**：bg `#fff` + 色 `--c-primary` + `0 1px 4px rgba(18,26,51,.13)`（**不是**主色实心块 —— 同一屏出现两个实心蓝块会互相抢注意力）。
  - **角标 .lb**（NEW / SCORE / SIZE / ALL / XS / S / M / L / XL）：DIN 字体、`9.5px/700`、`letter-spacing:.5px`、色 `--c-t3`，
    与主文案间距 `5px`（用 flex `gap`，**不用** `margin-right` —— 后者 2px 时会与中文挤成一串）。≤760px 时 `display:none`。
  - **只看开关 .bh-toggle**：`11.5px/700`、白底 + `1px solid var(--c-border)`、radius `8px`、padding `5px 11px`（与容量档位同高）。
    **未激活态两个开关必须完全一致**；激活态按维度分色：📱 社区配置 = `linear-gradient(135deg,#E6415D,#F97316)`，
    🎮 有实测记录 = `linear-gradient(135deg,#7C3AED,#4F46E5)`。
  - **结果计数 .filter-count**：`11.5px`、色 `--c-t3`、DIN、`margin-left:auto` 贴右。
## 5. Layout Principles（布局原则）

- 间距基数 `4px`（用 8/12/16/20/24/32 阶梯）。
- 容器 max-width `1180px`，padding `0 24px`；区块上下间距 `28–36px`。
- 首页两栏：主列（更新流）`minmax(0,1fr)` + 侧栏（机地热榜）`340px`；`<1024px` 单列。
- 游戏卡片网格：`repeat(auto-fill,minmax(240px,1fr))`，gap `16px`。
- 详情抽屉：`480px` 宽、右滑、遮罩 `rgba(13,11,35,.45)`。

## 6. Depth & Elevation（深度与层级）

- shadow-sm：`0 1px 2px var(--shadow-color)`
- shadow-md：`0 4px 14px rgba(20,18,50,.07)`
- shadow-lg（hero 上浮卡）：`0 18px 46px rgba(9,6,40,.38)`
- 层级：hero 内容 `z:1` / 纹理 `z:0`；sticky header `z:50`；抽屉遮罩 `z:90`；抽屉 `z:100`；toast `z:120`。
- hero 顶部网格纹理用 CSS 渐变线条（非图片）。

## 7. Do's and Don'ts

**Do's**
- 每个条目都必须带来源角标（机地/XDGAME），颜色全局一致。
- 时间一律相对化 + 悬停 title 显示绝对时间。
- 详情抽屉里始终展示"本站仅聚合信息，不提供任何下载"声明。
- 无封面的条目用标题首字渐变占位块（保证网格不破形）。
- 更新流按"今日 / 更早"折叠，减少噪音。
- 加载与刷新状态可见（骨架屏 / 状态灯 / toast）。
- 一个源失败时另一个源照常展示，并在状态区标黄。
- **一组内互斥的单选，全局只能有一套选中语言**（本项目 = 「灰轨 + 白块」）。同一屏里出现两套（一种蓝色实心、一种白色凸起）会让人重新学习一次。
**Don'ts**
- 不渲染机地序号榜卡片为封面卡（源站无 SSR 封面，避免破图）。
- 不展示下载按钮、不内嵌下载资源、不提供磁链/网盘文案。
- 不用纯 JS 渲染首屏结构（保证可用性），交互增强即可。
- 源站详情一律外链新窗口打开，不做 iframe 内嵌。
- 不把"发行日期"与"更新时间"两种字段混排成一种。
- 不要给「横向滚动 + 不换行」的控件留 `min-width:auto` —— 它的 min-content 会顺着 grid / flex 往上传染（实测把 `#colMain` 撑到 531px）。容器侧必须显式 `min-width:0`。
- 不要把分隔用的垂直 margin 加在 `align-items:center` 的 flex 子项上（旧 `.sort-pills` 的 `margin:2px 0 12px` 把整组顶离了基线）。
## 8. Responsive Behavior（响应式行为）

- 断点：`≥1200` 宽屏双栏；`1024–1199` 双栏压缩；`768–1023` 单栏 + 侧栏收纳为横向滚动小卡；`<768` 单列，网格 `2列` 收为横向滚动，抽屉占满宽、hero 标题 24px。
- 触摸目标 ≥ `40×40`（刷新、抽屉关闭、tab）。
- 字体缩放：标题 clamp()；正文不缩放；卡片 2 列最小宽度 160px。
- 详情抽屉在移动端为全屏面板，右上角固定关闭。
- **筛选条断点**：≤760px 时 `#colMain{min-width:0}`（解除栅格子项的自动最小尺寸）；分段控件 `flex:1 1 0;min-width:min(100%,260px)`
  撑满行宽并内部横滑，**260px 下限保证空间不足时「只看」开关换到下一行，而不是把控件压成 60px 宽**；英文角标 `.lb` 收起；
  `.fx-sp` 占位符隐藏；计数整行右对齐。
## 9. Agent Prompt Guide（AI 代理提示指南）

- **Quick Reference**：浅色情报台 UI；主色紫 `#5B5BD6`；机地红 `#E6415D` / XDGAME 蓝 `#0B7BFF` 双源角标；顶部深蓝紫 hero；卡片 14px 圆角微阴影；间距 4px 基数；详情抽屉 480px；两栏布局 1180px 容器；**仅信息聚合、永不出现下载入口**。
- **常用 Prompt**：
  1. 按 `feedItem` 数据结构渲染一个更新流卡片（含 src-badge、封面或首字占位、相对时间）。
  2. 生成详情抽屉骨架：cover 横幅 + 标题 + 评分 pill + 信息网格 + 简介 + 截图墙 + 双外链按钮 + 无下载声明。
  3. 实现"状态区"：三盏源站健康灯 + 上次抓取时刻 + 自动刷新倒计时。
  4. 把两个源站的条目合并成一条按时间倒序的时间线（XDGAME 更新 / 机地新游与热榜，kind 区分）。
  5. 空态 / 源站离线态：友善的离线卡片 + 重试按钮，数据不混入错误噪音。
- **迭代提示**：改色只改 CSS 变量；卡片 hover 幅度控制在 2px；新板块先加空态；保持双源字段语义分离；测试移动端抽屉关闭手势。
