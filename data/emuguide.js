/**
 * emuguide.js — 「模拟器指南」知识库模块
 *
 * 定位：本站「手游中心」解决「这款游戏在手机上跑多少帧」，本模块解决它之前/之后的问题——
 *         · 之前：我的芯片该装哪个驱动、选哪个构建？（装错了根本开不起来）
 *         · 之后：开起来了但卡/黑屏，该调什么？
 *         · 边界：哪些游戏结构上就不可能跑（反作弊 / DX12 / ARM 原生）？
 *         · 版本：2026 年这一堆「容器 / 驱动 / 包装器 / 翻译层」各该用哪一版？
 *
 * ★ v10.13 大修，两件事：
 *
 *   ① **修一个静默渲染 bug**：本文件用的是 `{dx,pick,why}` / `{t,d}` / `{c,e,why}` / `{g,f,s}`
 *      四套字段名，而前端 initEg 读的是 `x.name || x.n` 与 `x.desc || x.d`。
 *      结果「包装器对照表 / 避坑清单 / 帧率参考」三张表在页面上只剩一个空的加粗标签，
 *      优化清单则只剩说明、没有条目名 —— 数据在、页面空。
 *      现在统一为 **{name, desc}**（渲染层只认这两个主字段），并加一条契约。
 *
 *   ② **联网更新到 2026-09 的生态**（原内容停在 2026 上半年，驱动版本号已明显过时）：
 *        · Mesa Turnip 26.3.0 / Vulkan 1.4.362（build v26.3.0-20260910）
 *        · DXVK 3.x 要求 **Vulkan 1.4 基线** —— 老 Adreno 6xx + 旧 Turnip 会因此翻车，
 *          这是「为什么我换了新 DXVK 反而黑屏」最常见的原因，必须写进指南
 *        · 驱动按世代重排（含 Adreno 840 / 8 Elite Gen 5 与 A710/A720/A722 实验分支）
 *        · 翻译层 Box64 vs FEX-Emu 的分工，以及 ARM64EC「只仿真游戏、Wine 走原生」的演进
 *        · 新增第 ⑥ 节「版本门槛」：动手指南
 *
 * 数据来源：2026-09 联网调研（官方仓库 release 页 + 社区实测汇总），非本项目原创，
 *         故统一以注释标注来源，并在 UI 上明示「社区经验，非官方保证」。
 */

/** 五层技术栈：从游戏 exe 到屏幕像素，缺一层都跑不起来 */
const STACK = [
  {
    id: 'gpu',
    n: 5,
    name: 'GPU 驱动 · Turnip',
    sub: 'Mesa 开源 Vulkan 驱动',
    desc: '把 Vulkan 调用变成真实的 Adreno 屏幕像素。只对高通骁龙有效——联发科/三星的 Mali、Xclipse 没有对应开源驱动，只能走实验性的 Vortek。2026-09 上游为 Mesa 26.3.0（Vulkan 1.4.362）。',
    key: true,
  },
  {
    id: 'wrap',
    n: 4,
    name: '图形 API 桥 · DXVK / VKD3D',
    sub: 'DirectX → Vulkan',
    desc: 'DXVK 管 DX8~11，VKD3D-Proton 管 DX12。两个必须与上面的驱动版本**互相匹配**：DXVK 3.x 起以 Vulkan 1.4 为基线，老芯片配旧 Turnip 会直接黑屏——不匹配是黑屏与闪退的头号原因。',
  },
  {
    id: 'cpu',
    n: 3,
    name: 'CPU 指令翻译 · Box64 / FEX',
    sub: 'x86_64 → ARM64 实时翻译',
    desc: '把 Windows 程序的机器码翻译成手机芯片能读的指令。Box64 轻、wrapper 成熟，是 Winlator 的默认；FEX-Emu 走 SSA-IR 全局优化、完整支持 AVX/AVX2，精度更高但更重。翻译损耗后大约剩原生 50%~80% 性能，这就是手机帧率上限的来源。',
  },
  {
    id: 'api',
    n: 2,
    name: 'Windows API 兼容层 · Wine / Proton',
    sub: 'API 与注册表翻译（ARM64EC 新路径）',
    desc: '把注册表、窗口、音频、文件系统的调用翻译成 Linux/Android 调用。它不是模拟器，是兼容层。2026 的关键演进是 **ARM64EC**：把 Wine 本身编译成原生 ARM64，只仿真游戏的 x86-64 代码，让翻译层从「每条指令都在热路径上」变成「只在 ABI 边界出现」。',
  },
  {
    id: 'game',
    n: 1,
    name: '游戏本体 · Windows .exe',
    sub: 'x86 / x64 可执行文件',
    desc: 'ARM 芯片既看不懂 x86 指令、系统也不是 Windows——所以上面四层缺一不可。',
  },
];

/**
 * 芯片世代 → 推荐驱动 / 构建（2026-09 口径）。
 * `tier` 用于和实测库的芯片代号（8gen1 / 8gen3 / 8e / 870）建立映射。
 */
const CHIPS = [
  {
    gen: 'Adreno 6xx',
    soc: '骁龙 845 / 855 / 865 / 870 / 888',
    tier: '成熟',
    tone: 'ok',
    driver: 'Mr Purple T19（865）· T24（845）',
    alt: 'Turnip 24.3.0 R9v2 · K11MCH1 R5',
    build: '老设备专供构建 · 建议配 DXVK 2.x',
    note: 'Turnip 在这代已接近完整，2026 年 6xx 的官方开发基本进入平台期——瓶颈不是兼容性，而是算力本身。所以老芯片要挑「性能向」驱动而不是追新版本。注意：DXVK 3.x 要求 Vulkan 1.4 基线，而部分 6xx + 旧 Turnip 组合只到 1.3/1.1，硬上新 DXVK 会直接黑屏，留在 2.x 更稳。',
    keys: ['870', '888', '865'],
  },
  {
    gen: 'Adreno 7xx',
    soc: '骁龙 8 Gen 1 / 8+ Gen 1 / 8 Gen 2 / 8 Gen 3',
    tier: '稳定',
    tone: 'ok',
    driver: 'Balemuni Apex · Mr Purple T30',
    alt: 'Mr Purple T28（8 Gen 2）· StevenMXZ v26.3.0 R4',
    build: '官方 Winlator 11.2（默认）',
    note: '7xx 换过 GMEM（显存）管理方式，2023–2025 的 Turnip 开发几乎都在磨合它；到 Mesa v24 / v25 / v26 已基本解决。这批芯片算力过剩，原则是「稳定性优先」——用最新稳定版上游构建即可，不需要激进加速 hack。',
    keys: ['8gen1', '8gen2', '8gen3', '8pgen1'],
  },
  {
    gen: 'Adreno 8xx',
    soc: '骁龙 8 Elite（Adreno 830）/ 8 Elite Gen 5（Adreno 840）',
    tier: '前沿',
    tone: 'warn',
    driver: 'StevenMCZ Gen8 V36',
    alt: 'Banners-Turnip A8xx 实验变体',
    build: '必须 Gen8 / A8XX 专用构建',
    note: '⚠️ 8xx 架构大改（驱动日志里叫 Gen8），老稳定版驱动**直接加载失败、开箱即崩**。2026 上半年 Turnip v26.1.0 与 A8XX v20+ 系列才真正接入 Adreno 830 的配置，GMEM 问题随之解决。用这块芯片必须追最新 Gen8 专用构建，不能沿用通用稳定版。',
    keys: ['8e', '8egn5', '8elite'],
  },
  {
    gen: 'Adreno 7xx 实验子集',
    soc: '骁龙 7 Gen 4 等（Adreno 710 / 720 / 722）',
    tier: '实验',
    tone: 'warn',
    driver: 'Banners-Turnip A710/A720/A722 变体',
    alt: '通用 A6xx/A7xx 标准版（先试）',
    build: '需配 TU_DEBUG=sysmem（Winlator 再设 WRAPPER_BLIT=1）',
    note: '⚠️ 710/720/722 在上游 Mesa **没有正式支持**，社区靠注入硬件条目与魔术寄存器跑通（Vauzi-17 的研究）。早期结果不错，但仍属实验分支：先用标准版，黑屏/花屏再换这个，并强制 sysmem 模式绕开 GMEM 未稳的问题。',
    keys: [],
  },
  {
    gen: 'Mali / Xclipse',
    soc: '联发科天玑 / 三星 Exynos',
    tier: '受限',
    tone: 'bad',
    driver: 'Vortek',
    alt: 'VirGL · Zink（OpenGL 走 Gladio）',
    build: '官方 Winlator 11.2+（含 Vortek/Gladio）',
    note: '⚠️ 没有 Turnip 等价物，只能走实验性驱动。跑轻量/2D 尚可，重度 3D 会明显掉帧、花屏或直接起不来。同一个游戏在骁龙能跑 40 帧，换到 Mali 可能黑屏——这不是设置问题，是生态差距。',
    keys: [],
  },
];

/** DirectX 版本 → 包装器选择 */
const WRAPPERS = [
  {
    name: 'DirectX 8',
    desc: '用 D8VK（专用分支）或退回 WineD3D。老 2D 游戏甚至应该关掉 DXVK——兼容优先于性能。',
  },
  {
    name: 'DirectX 9 / 10 / 11',
    desc: '主战场，用 DXVK。2026-09 上游是 DXVK 3.1（3.0 起要求驱动具备 Vulkan 1.4）；老芯片配旧驱动请留在 2.7.x 分支。',
  },
  {
    name: 'DirectX 12',
    desc: '必须走 VKD3D-Proton（当前 3.0x）。但它对 DX12 的兼容仍最不完善，多数失败是「起不来」而不是「卡」。',
  },
  {
    name: '老 2D / DirectDraw',
    desc: '用 CNC DDraw 或 WineD3D。这类游戏的瓶颈通常在 CPU 翻译，不在图形。',
  },
];

/** 优化要点（按投入产出排序） */
const TUNING = [
  {
    name: '分辨率降到 720p，甚至 960×544',
    desc: '收益最大的一步。不要用手机原生 1080p/1440p——像素量翻倍会直接触发降频与烫机，帧数反而更低。',
  },
  {
    name: '一次只改一个变量',
    desc: '顺序固定为：驱动 → DX 包装器 → 翻译层预设。三个一起换，改好了也不知道是哪个起的作用，改坏了更没法定位。',
  },
  {
    name: '驱动与 DXVK 版本必须配套',
    desc: '两者不匹配是黑屏/闪退最常见的成因。DXVK 3.x 要 Vulkan 1.4；装不动就退回 2.x，而不是硬顶着黑屏调别的。',
  },
  {
    name: 'CPU 亲和性：绑性能核，但要留一个核',
    desc: '别把所有核都勾上——留至少一个性能核给 Android 处理系统任务，否则会被系统限速，反而更卡。',
  },
  {
    name: '翻译层预设：先 Performance，不稳再退 Compatibility',
    desc: '已经能跑的游戏开性能预设提升明显；一开就崩的，反而应该退回兼容预设。容器支持 ARM64EC 时优先用 FEX 路径，它只在 ABI 边界仿真，开销更低。',
  },
  {
    name: '每个游戏独立容器',
    desc: '一个游戏一套配置，避免改坏另一个游戏已经跑通的组合。',
  },
  {
    name: '游戏路径禁止中文',
    desc: 'exe 所在路径含中文会大概率闪退，这是社区反复验证的硬约束。',
  },
  {
    name: '散热与供电就是性能',
    desc: '摘掉手机壳、别在太阳下玩、别边充边长时间跑。持续降频的手机会表现成「Winlator 设置不对」，实际是散热问题。',
  },
  {
    name: '给容器留足存储余量',
    desc: 'Windows 安装程序习惯在游戏旁边解包，容器与游戏盘都要留出页面文件级别的空间，否则会在安装中途失败。',
  },
];

/** 避坑清单：这些不是配置问题，是结构上跑不了 */
const AVOID = [
  {
    name: '带内核级反作弊的网游',
    desc: '英雄联盟 · CS2 · 绝地求生 · 永劫无间 · 守望先锋 · Apex。EAC / BattlEye / Vanguard 工作在驱动层，翻译层无法满足，直接拦截闪退；硬试还有封号风险。',
  },
  {
    name: '纯 DX12 新作',
    desc: '赛博朋克 2077 · 荒野大镖客 2 · 星空。VKD3D-Proton 对 DX12 的兼容仍不完善，多数情况是起不来而非「卡」。',
  },
  {
    name: '强 DRM 加密单机',
    desc: '带 Denuvo / SecuROM 校验的正版 3A。校验失败直接崩溃，与性能无关。',
  },
  {
    name: '原生 ARM 版 Windows 程序 / UWP',
    desc: '微软商店应用。翻译层只认 x86/x64，原生 ARM 程序完全不识别。',
  },
  {
    name: '把「帧数低」全归因于模拟器',
    desc: '先看手机是否在降频、是否只给游戏留了 6GB 内存。很多「跑不动」其实是内存不足或温控，不是翻译层的问题。',
  },
];

/** 实测帧率参考（社区数据，用于给用户一个「大概能到多少」的心理预期） */
const BENCH = [
  { name: 'PES 2013', desc: '60 FPS（锁帧）· 1280×720 · 骁龙 870 级即可；社区跑通量第一的「入门验证机」' },
  { name: 'PES 2017', desc: '55~60 FPS · 1280×720 · 需给容器留 17GB 存储' },
  { name: 'GTA 5', desc: '25~35 FPS · 1280×720 · 需 8GB 内存以上 · 骁龙 865+' },
  { name: '辐射：新维加斯', desc: '55~60 FPS · 1280×720 中画质 · Turnip + DXVK' },
  { name: '上古卷轴 5：天际', desc: '40~50 FPS · 1280×720 低~中 · Box64 性能预设' },
  { name: '杀出重围：人类革命', desc: '35~45 FPS · 1280×720 低画质 · Turnip + DXVK' },
  { name: '空洞骑士 / 蔚蓝', desc: '60 FPS · 原生分辨率 · 2D 作品对 GPU 几乎无压力，主要看 CPU 翻译效率' },
  { name: '生化危机 4（2005 原版）', desc: '45~60 FPS · 1280×720 · 比 2023 重制版好跑得多，别把两作混为一谈' },
];

/**
 * ★ v10.13 新增：版本门槛
 * 「该装哪个版本」是新手问得最多、也最容易一句话答错的问题。
 * 这里把 2026-09 的实际版本口径固定下来，避免用户去翻一堆 release 页。
 */
const VERSIONS = [
  { name: '容器 / 前端 · Winlator 11.2.0', desc: '官方稳定版（2026-08）。社区分支另有 Star、Frost、Ludashi、aMod、CMOD 等，功能与坑各异——先跑通官方版再换分支，否则同时多了两个变量。' },
  { name: 'GPU 驱动 · Mesa Turnip 26.3.0', desc: 'Vulkan 1.4.362（构建 v26.3.0-20260910，来自 Banners-Turnip 每小时的 upstream 自动构建）。按世代选变体：A6xx/A7xx 标准、A710/A720/A722 实验、A8xx 实验。' },
  { name: '图形包装器 · DXVK 3.1 / 2.7.x', desc: 'DX8~11 的首选。3.x 以 Vulkan 1.4 为基线，新旗舰随便上；老 Adreno 6xx + 旧驱动请留在 2.7.x。DX12 另装 VKD3D-Proton 3.0x。' },
  { name: 'CPU 翻译层 · Box64 与 FEX-Emu', desc: 'Box64 轻量、wrapper 成熟，是默认选项；FEX-Emu 精度更高、完整支持 AVX/AVX2，适合重度 MOD 与小众游戏。两者没有绝对优劣，按游戏选。' },
  { name: '另一条路 · GameNative / GameHub', desc: '不是 Winlator 的分支，而是同赛道的新一代容器（GameNative 2026-09 已到 1.2.x），默认走 FEX+ARM64EC，对新旗舰支持更快。同一台手机可以并存，用来交叉验证「是游戏的问题还是容器的问题」。' },
  { name: '判断原则 · 谁新谁做基准', desc: '芯片越新，越应该追「专用新构建」；芯片越老，越应该守「稳定老构建 + 老 DXVK」。跨代套用是绝大多数「装完直接黑屏」的根因。' },
];

/** 芯片代号（实测库用法）→ 指南条目 id，用于面板内联动提示 */
function tierOfChip(code) {
  const c = String(code == null ? '' : code).toLowerCase();
  for (const chip of CHIPS) {
    if (chip.keys.includes(c)) return chip;
  }
  return null;
}

/** 全部指南数据（一次返回，体量小，前端无需分页） */
function guide() {
  return {
    ok: true,
    stack: STACK,
    chips: CHIPS,
    wrappers: WRAPPERS,
    tuning: TUNING,
    avoid: AVOID,
    bench: BENCH,
    versions: VERSIONS,
    src: '社区实测与公开文档整理（2026-09），非官方保证',
  };
}

/** 某芯片代号对应的驱动建议（供实测配置面板联动） */
function chipAdvice(code) {
  const chip = tierOfChip(code);
  if (!chip) return { ok: true, code: String(code || ''), hit: false };
  return {
    ok: true,
    code,
    hit: true,
    gen: chip.gen,
    soc: chip.soc,
    tier: chip.tier,
    tone: chip.tone,
    driver: chip.driver,
    note: chip.note,
  };
}

module.exports = { guide, chipAdvice, STACK, CHIPS, WRAPPERS, TUNING, AVOID, BENCH, VERSIONS, tierOfChip };
